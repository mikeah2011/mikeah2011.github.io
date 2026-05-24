---
title: "Docker-多阶段构建实战-PHP-应用镜像优化-500MB到50MB踩坑记录"
date: 2026-05-05 10:56:07
updated: 2026-05-05 10:59:21
categories:
  - DevOps
  - Docker
tags: [CI/CD, DevOps, Docker, Laravel, PHP]
description: "在 KKday B2C 项目中，PHP-FPM 镜像从 520MB 优化到 48MB 的完整过程：多阶段构建、依赖裁剪、.dockerignore、层缓存治理、Alpine vs Debian 选型，以及 CI 流水线中的镜像推送踩坑记录。"



---
# Docker 多阶段构建实战：PHP 应用镜像从 500MB 优化到 50MB

## 前言

在 KKday B2C 后端团队，我们有 30+ 个 Laravel 仓库跑在 Docker 容器里。最初的 Dockerfile 就是一个"全家桶"模式——把 composer install、前端编译、配置文件全塞进一个镜像，打出来的包动辄 500MB+。每次 CI 构建推送镜像要花 2-3 分钟，K8s 拉取新 Pod 也要等半天。

这篇文章记录了我们从"能跑就行"到"镜像瘦身 90%"的完整过程，包含真实的踩坑、架构决策和可以直接复用的 Dockerfile 模板。

---

## 一、问题诊断：500MB 镜像里到底装了什么？

先用 `docker history` 看看到底是哪些层占了空间：

```bash
# 查看镜像层详情
docker history --no-trunc my-app:latest

# 或者用 dive 工具可视化分析
dive my-app:latest
```

典型的"胖镜像"分析结果：

```
IMAGE ID       CREATED BY                                      SIZE
a3f2c1d4e5b6   COPY . /var/www/html                            180MB   ← 源码 + vendor + node_modules
b7d8e9f0a1c2   RUN npm run production                          120MB   ← node_modules 残留
c4e5f6a7b8c9   RUN composer install --no-dev                   95MB    ← vendor 目录
d1e2f3a4b5c6   RUN apt-get install -y nodejs npm php-dev...    85MB    ← 构建工具残留
e8f9a0b1c2d3   FROM php:8.0-fpm                                43MB    ← 基础镜像
```

**核心发现**：
1. `node_modules` 和 `npm` 二进制文件被 COPY 进了最终镜像（只在编译前端资源时需要）
2. `composer install` 的 `--no-dev` 之前先跑了完整 install，dev 依赖的缓存还在
3. PHP 扩展编译工具（`php-dev`, `gcc`, `make`）编译完没删
4. `.git` 目录、测试文件、文档全被 COPY 进去了

---

## 二、多阶段构建架构

核心思路：**构建阶段和运行阶段分离**。构建阶段用完整的工具链编译依赖，运行阶段只复制编译产物。

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Stage 1: composer                     │
│  ┌─────────────────────────────────────────────────────┐│
│  │ php:8.0-fpm (完整版，含 composer)                    ││
│  │  - composer install --no-dev --optimize-autoloader  ││
│  │  - 产出: /app/vendor/ (精简依赖)                     ││
│  └─────────────────────────────────────────────────────┘│
│                         │ vendor/                        │
│                         ▼                                │
├─────────────────────────────────────────────────────────┤
│                    Stage 2: frontend                     │
│  ┌─────────────────────────────────────────────────────┐│
│  │ node:18-alpine                                      ││
│  │  - npm ci && npm run production                     ││
│  │  - 产出: /app/public/build/ (Vite/Mix 编译产物)     ││
│  └─────────────────────────────────────────────────────┘│
│                         │ public/build/                  │
│                         ▼                                │
├─────────────────────────────────────────────────────────┤
│                    Stage 3: runtime                      │
│  ┌─────────────────────────────────────────────────────┐│
│  │ php:8.0-fpm-alpine (极简基础镜像)                    ││
│  │  - COPY --from=composer /app/vendor /var/www/vendor ││
│  │  - COPY --from=frontend /app/public/build /var/...  ││
│  │  - COPY . /var/www/ (仅源码，不含 vendor/node_modules)││
│  │  - 最终产物: ~48MB                                  ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 2.2 完整 Dockerfile

```dockerfile
# ============================================================
# Stage 1: Composer Dependencies
# ============================================================
FROM composer:2.6 AS composer

WORKDIR /app

# 先复制依赖声明文件，利用层缓存
COPY composer.json composer.lock ./

# 安装生产依赖（不装 dev，优化 autoload）
RUN composer install \
    --no-dev \
    --no-interaction \
    --no-scripts \
    --no-autoloader \
    --prefer-dist

# 复制完整源码，运行 post-autoload-dump
COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative \
    && composer run-script post-autoload-dump

# ============================================================
# Stage 2: Frontend Assets (仅当有前端资源时)
# ============================================================
FROM node:18-alpine AS frontend

WORKDIR /app

# 同样先复制依赖声明文件
COPY package.json package-lock.json ./

# npm ci 比 npm install 更快更可靠（严格按 lock 文件）
RUN npm ci --no-audit --no-fund

COPY . .

# 编译前端资源
RUN npm run production

# ============================================================
# Stage 3: Production Runtime
# ============================================================
FROM php:8.0-fpm-alpine AS runtime

# 安装 PHP 扩展（不保留编译工具）
RUN apk add --no-cache --virtual .build-deps \
        $PHPIZE_DEPS \
        linux-headers \
        libzip-dev \
        oniguruma-dev \
    && docker-php-ext-install \
        pdo_mysql \
        mbstring \
        zip \
        bcmath \
        opcache \
    && pecl install redis-6.0.2 \
    && docker-php-ext-enable redis \
    # 关键：删除编译工具，只保留运行时依赖
    && apk del .build-deps \
    && apk add --no-cache \
        libzip \
        oniguruma \
        freetype \
        libpng \
        libjpeg-turbo

# PHP OPcache 配置
COPY docker/php/opcache.ini /usr/local/etc/php/conf.d/opcache.ini
COPY docker/php/uploads.ini /usr/local/etc/php/conf.d/uploads.ini
COPY docker/php/fpm.conf /usr/local/etc/php-fpm.d/zz-docker.conf

WORKDIR /var/www/html

# 从构建阶段复制产物
COPY --from=composer /app/vendor ./vendor
COPY --from=frontend /app/public/build ./public/build

# 复制应用源码（配合 .dockerignore 排除不需要的文件）
COPY . .

# 设置权限
RUN chown -R www-data:www-data \
        storage \
        bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

EXPOSE 9000
CMD ["php-fpm"]
```

---

## 三、关键优化点详解

### 3.1 .dockerignore：别把垃圾带进镜像

这是最容易被忽略但效果最显著的一步：

```gitignore
# .dockerignore
.git
.github
.idea
.vscode
node_modules
vendor                    # 由 composer stage 生成，不需要从 host 复制
tests
phpunit.xml
phpstan.neon
.php-cs-fixer.php
*.md
docker-compose*.yml
.env.example
.editorconfig
.editorconfig
storage/logs/*
storage/framework/cache/*
storage/framework/sessions/*
storage/framework/views/*
public/hot
```

**踩坑 #1**：我一开始没排除 `.git`，30+ 仓库的 `.git` 目录平均 40MB。加上去之后每个多了 40MB 的"免费"空间。

**踩坑 #2**：`vendor` 目录要不要排除？答案是——在多阶段构建中**一定要排除**。因为 `composer install` 在 Stage 1 里完成，host 上的 `vendor` 目录如果不排除，`COPY . .` 会覆盖掉 Stage 1 的精简产物，把 dev 依赖带进来。

### 3.2 Alpine vs Debian：选错基础镜像白忙活

| 维度 | `php:8.0-fpm` (Debian) | `php:8.0-fpm-alpine` |
|------|------------------------|----------------------|
| 基础镜像大小 | ~150MB | ~28MB |
| 扩展安装 | `apt-get` | `apk add` |
| musl libc 兼容性 | glibc（完美） | musl（偶尔踩坑） |
| DNS 解析 | 稳定 | 需要 `apk add bind-tools` |
| 启动速度 | ~2s | ~0.5s |

**踩坑 #3：Alpine 的 musl libc 与某些 PHP 扩展不兼容**

我们在 Alpine 上安装 `swoole` 时遇到编译失败：

```bash
# 错误：/usr/include/linux/errno.h: No such file or directory
apk add linux-headers   # 需要手动安装
```

还有一次 `grpc` 扩展在 Alpine 上直接 segfault。解决方案：对于需要 grpc/swoole 的服务，退回 `php:8.0-fpm`（Debian），其他纯 API 服务继续用 Alpine。

**最终策略**：80% 的服务用 Alpine，20% 需要特殊扩展的服务用 Debian。

### 3.3 层缓存治理：让 CI 构建时间减半

Docker 的层缓存机制：**只要某一层的内容变了，该层及之后的所有层都会重新构建**。

```dockerfile
# ❌ 错误做法：每次构建都重新安装依赖
COPY . /var/www/html
RUN composer install --no-dev

# ✅ 正确做法：先复制依赖声明，再复制源码
COPY composer.json composer.lock ./
RUN composer install --no-dev
COPY . .
```

**踩坑 #4**：`composer.lock` 的哈希值变化会导致整个 `composer install` 层失效。在 CI 中，如果 `composer.lock` 由 CI 自动生成（而不是从代码库读取），就会每次触发全量重建。

解决方案：确保 `composer.lock` 提交到 Git，CI 直接使用。

```yaml
# GitHub Actions 中的正确用法
- uses: actions/checkout@v4
  # actions/checkout 会自动拉取 composer.lock

- name: Build Docker image
  run: docker build -t my-app:${{ github.sha }} .
  # 此时 composer.lock 来自 Git，层缓存命中率高
```

### 3.4 只安装需要的 PHP 扩展

很多人照着网上教程装了一堆扩展，实际上 80% 都用不到：

```dockerfile
# ❌ 过度安装
RUN docker-php-ext-install \
    pdo_mysql pdo_pgsql pdo_sqlite \
    mysqli \
    mbstring \
    zip \
    bcmath \
    gd \
    intl \
    xml \
    soap \
    xsl \
    imap \
    ldap \
    exif \
    pcntl \
    shmop \
    sysvmsg sysvsem sysvshm

# ✅ 按需安装（B2C API 服务只需要这些）
RUN docker-php-ext-install \
    pdo_mysql \
    mbstring \
    zip \
    bcmath \
    opcache
```

每个扩展平均增加 1-3MB，砍掉 10 个不需要的扩展就是 10-30MB 的收益。

---

## 四、进阶优化技巧

### 4.1 利用 BuildKit 的 `--mount=type=cache` 缓存包管理器

Docker BuildKit 支持挂载缓存目录，避免每次构建都重新下载：

```dockerfile
# syntax=docker/dockerfile:1.4

FROM composer:2.6 AS composer
WORKDIR /app
COPY composer.json composer.lock ./

# mount=type=cache 让 composer 缓存在构建之间持久化
RUN --mount=type=cache,target=/tmp/cache \
    COMPOSER_CACHE_DIR=/tmp/cache \
    composer install --no-dev --no-interaction --prefer-dist
```

### 4.2 生产环境镜像清理

在 runtime stage 最后加一层"清理"：

```dockerfile
# 删除不必要的文件
RUN rm -rf \
    tests \
    .env.example \
    phpunit.xml \
    phpstan.neon \
    .php-cs-fixer.php \
    README.md \
    CHANGELOG.md \
    node_modules \
    resources/js \
    resources/sass \
    webpack.mix.js \
    vite.config.js \
    package.json \
    package-lock.json
```

### 4.3 最终镜像大小对比

```
优化前 (Debian + 全家桶):
├── 基础镜像:     150MB
├── PHP 扩展:      85MB  (含编译工具)
├── Composer:      95MB  (含 dev 依赖)
├── Node/NPM:     120MB  (node_modules 残留)
├── 源码 + .git:   80MB
└── 总计:         530MB

优化后 (Alpine + 多阶段):
├── 基础镜像:      28MB
├── PHP 扩展:      12MB  (编译工具已删)
├── Composer:      35MB  (仅 prod 依赖)
├── 前端资源:       3MB  (仅编译产物)
├── 源码:         -12MB  (精简后)
└── 总计:          48MB   ↓ 91%
```

---

## 五、CI/CD 集成踩坑

### 5.1 GitHub Actions 中的镜像构建

```yaml
# .github/workflows/docker-build.yml
name: Build & Push Docker Image

on:
  push:
    branches: [main, staging]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE }}:${{ github.sha }}
            ${{ env.REGISTRY }}/${{ env.IMAGE }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**踩坑 #5**：`cache-from: type=gha` 是 GitHub Actions 的缓存后端。如果不用 Buildx + GHA Cache，每次构建都会从零开始，多阶段构建的优势就浪费了一半。

### 5.2 K8s 部署时的镜像拉取优化

```yaml
# Pod 配置
spec:
  containers:
    - name: php-fpm
      image: my-registry.com/my-app:abc123
      imagePullPolicy: IfNotPresent  # 如果节点已有该镜像，不再拉取
```

从 500MB → 48MB 后，K8s 拉取时间从 15s 降到 ~2s，Pod 启动速度提升了 7 倍。

---

## 六、踩坑记录汇总

| # | 问题 | 原因 | 解决方案 |
|---|------|------|---------|
| 1 | 镜像多了 40MB | `.git` 目录未排除 | `.dockerignore` 加 `.git` |
| 2 | dev 依赖混入镜像 | host 的 `vendor` 覆盖了 stage 产物 | `.dockerignore` 排除 `vendor` |
| 3 | Alpine 编译 swoole 失败 | musl libc 缺少 `linux-headers` | `apk add linux-headers` 或退回 Debian |
| 4 | CI 每次全量构建 | `composer.lock` 未提交 Git | 确保 lock 文件在版本控制中 |
| 5 | GHA 缓存未命中 | 未使用 Buildx + GHA Cache | `cache-from: type=gha` |

---

## 七、总结

Docker 多阶段构建不是什么高深技术，但要做到"真的瘦下来"需要关注几个细节：

1. **分阶段复制依赖**：先 `composer.json` + `lock`，再源码，利用层缓存
2. **精简基础镜像**：Alpine 能省 120MB，但要评估扩展兼容性
3. **排除不需要的东西**：`.dockerignore` 比什么都重要
4. **编译工具只留运行时**：`apk del .build-deps` 不能忘
5. **CI 缓存治理**：BuildKit + GHA Cache 才能发挥多阶段的优势

最终成果：镜像从 530MB → 48MB，CI 推送时间从 3 分钟 → 20 秒，K8s Pod 启动从 15 秒 → 2 秒。对 30+ 个仓库来说，这个优化的规模效应是显著的。
