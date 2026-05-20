---
title: Docker 多阶段构建实战 — PHP 应用镜像优化从 500MB 到 50MB
date: 2026-05-16 15:55:50
updated: 2026-05-16 16:03:22
categories:
  - 07_CICD
tags: [DevOps, Docker, Laravel, PHP]description: 从 500MB 的"胖镜像"瘦身到 50MB 的生产级镜像，记录 KKday B2C 后端 30+ 仓库的 Docker 多阶段构建实战经验，涵盖 Composer 缓存复用、扩展裁剪、vendor 清理等核心技巧。
---

# Docker 多阶段构建实战：PHP 应用镜像优化（500MB → 50MB）

> **一句话总结**：多阶段构建不是"高级技巧"，而是 PHP 生产镜像的标准做法——把编译环境和运行环境物理隔离，镜像体积直降 90%，部署速度从分钟级到秒级。

## 1. 问题：你的 Docker 镜像为什么这么大？

先看一个"能跑就行"的 Dockerfile 会产出什么样的镜像：

```dockerfile
# ❌ 典型的"单阶段" Dockerfile
FROM php:8.0-fpm

RUN apt-get update && apt-get install -y \
    git unzip libzip-dev libpng-dev libonig-dev libxml2-dev \
    && docker-php-ext-install pdo_mysql zip mbstring xml gd bcmath

COPY . /var/www/html
WORKDIR /var/www/html

RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
RUN composer install --no-dev --optimize-autoloader
```

构建出来的镜像：

```bash
$ docker images myapp
REPOSITORY   TAG       SIZE
myapp        latest    527MB
```

527MB！里面包含了什么？

| 层级 | 内容 | 大小 |
|------|------|------|
| PHP-FPM 基础镜像 | Debian + PHP | ~180MB |
| 构建依赖 | git, unzip, lib*-dev 等 | ~120MB |
| Composer 二进制 | PHP 包管理器 | ~5MB |
| vendor 目录 | 所有依赖（含 dev？） | ~150MB |
| 项目源码 | .git, tests, docs... | ~70MB |

**真相**：生产环境运行只需要 PHP-FPM 运行时 + vendor（production only）+ 项目代码。构建依赖、Composer 二进制、.git 目录、测试文件全是浪费。

## 2. 多阶段构建原理

Docker 多阶段构建（multi-stage build）的核心思想：

```
┌─────────────────────────────┐
│ Stage 1: Builder            │
│ ┌─────────────────────────┐ │
│ │ php:8.0-fpm             │ │
│ │ + 编译依赖 (lib*-dev)   │ │
│ │ + Composer               │ │
│ │ + composer install       │ │
│ │ + php artisan optimize   │ │
│ └─────────────────────────┘ │
│         ↓ COPY --from       │
│ Stage 2: Production         │
│ ┌─────────────────────────┐ │
│ │ php:8.0-fpm-alpine      │ │
│ │ + 运行时依赖 (libzip)   │ │
│ │ + vendor/ (production)   │ │
│ │ + 项目代码               │ │
│ └─────────────────────────┘ │
│         ↓ 只有这一层发布     │
│ Final Image: ~50MB          │
└─────────────────────────────┘
```

Stage 1 的所有中间层都不会进入最终镜像。我们只 `COPY` 需要的产出物到 Stage 2。

## 3. 实战：Laravel 项目多阶段 Dockerfile

这是我们在 KKday B2C 后端 30+ 仓库通用的模板：

```dockerfile
# ============================================
# Stage 1: Composer Dependencies
# ============================================
FROM composer:2.7 AS composer

WORKDIR /app
COPY composer.json composer.lock ./

# 关键技巧：只装 production 依赖，跳过 autoload 优化（后面做）
RUN composer install \
    --no-dev \
    --no-scripts \
    --no-autoloader \
    --prefer-dist \
    --no-interaction

COPY . .

RUN composer dump-autoload --optimize --classmap-authoritative

# ============================================
# Stage 2: Frontend Assets (如果有)
# ============================================
FROM node:20-alpine AS frontend

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY . .
RUN npm run build

# ============================================
# Stage 3: Production Image
# ============================================
FROM php:8.0-fpm-alpine AS production

# 只装运行时依赖，不装 *-dev
RUN apk add --no-cache \
    libzip \
    libpng \
    libjpeg-turbo \
    oniguruma \
    libxml2 \
    freetype \
    icu-libs

# 安装 PHP 扩展（使用预编译的扩展，不用源码编译）
RUN apk add --no-cache \
    php80-zip \
    php80-gd \
    php80-mbstring \
    php80-xml \
    php80-bcmath \
    php80-pdo_mysql \
    php80-opcache \
    || docker-php-ext-install zip gd mbstring xml bcmath pdo_mysql

WORKDIR /var/www/html

# 从 Stage 1 拷贝 vendor
COPY --from=composer /app/vendor ./vendor
COPY --from=composer /app/composer.json ./

# 从 Stage 2 拷贝前端产物
COPY --from=frontend /app/public/build ./public/build

# 拷贝项目代码（注意 .dockerignore）
COPY . .

# 优化 Laravel
RUN php artisan view:cache 2>/dev/null || true \
    && php artisan config:cache 2>/dev/null || true \
    && php artisan route:cache 2>/dev/null || true \
    && chmod -R 755 storage bootstrap/cache

EXPOSE 9000
CMD ["php-fpm"]
```

### 3.1 .dockerignore 是必须的

没有 `.dockerignore`，`COPY . .` 会把所有东西都塞进去：

```gitignore
# .dockerignore
.git
.github
.idea
.vscode
node_modules
vendor
tests
phpunit.xml
phpstan.neon
.env
.env.*
*.md
docker-compose*.yml
Makefile
.php-cs-fixer.cache
.phpunit.result.cache
storage/logs/*
storage/framework/cache/*
storage/framework/sessions/*
storage/framework/views/*
```

**踩坑记录 #1**：漏掉 `.git` 目录是新手最常见的错误。一个有 3 年历史的仓库，`.git` 可能超过 200MB。

### 3.2 Composer 缓存复用技巧

如果每次都 `composer install`，网络依赖会导致构建时间不稳定。用 BuildKit 缓存挂载：

```dockerfile
# 需要 DOCKER_BUILDKIT=1
RUN --mount=type=cache,target=/tmp/cache \
    --mount=type=cache,target=/root/.composer/cache \
    composer install \
    --no-dev \
    --no-scripts \
    --no-autoloader \
    --prefer-dist \
    --no-interaction
```

**踩坑记录 #2**：`--mount=type=cache` 在 CI 环境（GitHub Actions、Jenkins）中默认不生效，需要显式设置 `DOCKER_BUILDKIT=1` 并且用 `docker buildx build` 替代 `docker build`。

## 4. 对比：优化前 vs 优化后

| 指标 | 单阶段（Before） | 多阶段（After） | 改善 |
|------|-----------------|----------------|------|
| 镜像大小 | 527MB | 48MB | **-91%** |
| 构建时间（无缓存） | 3m 20s | 1m 45s | **-47%** |
| 构建时间（有缓存） | 2m 10s | 12s | **-91%** |
| CVE 漏洞数（Trivy 扫描） | 87 | 6 | **-93%** |
| 部署时间（推送到 Registry） | 45s | 8s | **-82%** |

### 4.1 为什么 Alpine 比 Debian 小这么多？

```bash
# Debian 基础镜像
$ docker images php:8.0-fpm
REPOSITORY   TAG       SIZE
php          8.0-fpm   451MB

# Alpine 基础镜像
$ docker images php:8.0-fpm-alpine
REPOSITORY   TAG             SIZE
php          8.0-fpm-alpine  28MB
```

**差了 16 倍**。Alpine 用 musl libc 替代 glibc，用 busybox 替代 GNU coreutils，极简主义到极致。

**踩坑记录 #3**：Alpine 的 musl libc 和 glibc 有个经典坑——DNS 解析行为不同。`getaddrinfo()` 在 musl 下默认不支持 `search` 域名搜索，导致 Laravel 的 `DB_HOST=mysql` 在某些 Kubernetes 环境下解析失败。解决方案：用 FQDN（`mysql.default.svc.cluster.local`）或者在 `/etc/resolv.conf` 加 `options ndots:5`。

## 5. 进阶技巧

### 5.1 分离 vendor 和源码的增量部署

如果每次部署都要传输完整镜像，30 个微服务 × 50MB = 1.5GB。可以进一步优化：

```dockerfile
# 只更新 vendor 和项目代码，保留基础层缓存
FROM myregistry.com/base/php-8.0-fpm:latest AS base

COPY --from=composer /app/vendor ./vendor
COPY . .

# 利用 Docker 层缓存：基础层不变时只传输增量
```

### 5.2 测试镜像 vs 生产镜像分离

不要在同一个 Dockerfile 里既做测试又做生产：

```dockerfile
# Dockerfile.test —— 给 CI 用
FROM php:8.0-fpm-alpine

# 保留 dev 依赖
COPY --from=composer /app/vendor ./vendor
COPY . .

RUN vendor/bin/phpunit --coverage-clover=coverage.xml
```

### 5.3 镜像安全扫描

生产镜像发出去之前必须扫一遍：

```bash
# Trivy 扫描
trivy image myregistry.com/myapp:latest

# Grype 扫描（备选）
grype myregistry.com/myapp:latest

# Docker Scout（Docker Desktop 内置）
docker scout cves myregistry.com/myapp:latest
```

**踩坑记录 #4**：我们在 CI 中加了 Trivy 扫描门禁，有一次 `composer.lock` 里锁定了一个有 CVE 的 `guzzlehttp/guzzle` 版本。因为多阶段构建的 vendor 是干净的，Trivy 直接定位到了具体包。如果是单阶段镜像，vendor 混在一堆系统库里，排查起来非常痛苦。

## 6. CI/CD 集成示例

```yaml
# .github/workflows/docker-build.yml
name: Docker Build & Push

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            myregistry.com/myapp:${{ github.sha }}
            myregistry.com/myapp:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Security scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: myregistry.com/myapp:${{ github.sha }}
          severity: CRITICAL,HIGH
          exit-code: 1
```

## 7. 常见坑位汇总

| # | 坑 | 表现 | 解法 |
|---|---|---|---|
| 1 | 漏 `.dockerignore` | 镜像 500MB+，构建慢 | 必须加 `.git`, `node_modules`, `vendor` |
| 2 | BuildKit 未启用 | `--mount=type=cache` 无效 | `DOCKER_BUILDKIT=1` |
| 3 | Alpine musl DNS | `getaddrinfo()` 解析失败 | 用 FQDN 或设 `ndots:5` |
| 4 | dev 依赖混入 | 镜像含测试框架，CVE 多 | `--no-dev` + 独立 test 镜像 |
| 5 | `COPY . .` 太早 | vendor 被覆盖，层缓存失效 | 先 `COPY composer.json`，后 `COPY . .` |
| 6 | 未清理 apt 缓存 | 构建层残留 200MB+ | Alpine 用 `apk add --no-cache` |
| 7 | OPcache 缓存未预热 | 首次请求 300ms+ | `php artisan optimize` 在构建时执行 |

## 8. 总结

多阶段构建不是什么高级技巧，而是 PHP Docker 化的**基本功**。核心就三个原则：

1. **编译和运行物理隔离**：构建依赖永远不进生产镜像
2. **最小化基础镜像**：Alpine > Debian-slim > Debian > Ubuntu
3. **利用层缓存**：先 COPY 依赖描述文件（composer.json），后 COPY 源码

在 KKday B2C 后端 30+ 仓库中，我们用这套模板统一了所有 Laravel 项目的 Dockerfile，新人不用理解 Docker 细节，照着模板改 `composer.json` 就行。镜像从平均 500MB 降到 50MB 以下，CI 构建时间缩短 90%，Trivy 漏洞数减少 93%。

这不是"锦上添花"，而是"救命稻草"——当你有 30 个服务、每次部署要推送镜像到跨区域 Registry 时，50MB 和 500MB 的差距直接决定了你的部署窗口是 5 分钟还是 50 分钟。
