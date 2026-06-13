---
title: Docker 多阶段构建实战 — PHP 应用镜像优化从 500MB 到 50MB
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-16 15:55:50
updated: 2026-05-16 16:03:22
categories:
  - devops
  - docker
tags: [DevOps, Docker, Laravel, PHP]
keywords: [Docker, PHP, MB, 多阶段构建实战, 应用镜像优化从, DevOps]
description: Docker 多阶段构建是 PHP 镜像瘦身的核心手段。本文基于 KKday B2C 后端 30+ Laravel 仓库的实战经验，详解 Dockerfile 优化全流程：多阶段构建原理与完整示例、Composer 缓存复用、Alpine 最小化基础镜像选型、镜像层分析工具 dive 的使用、COPY 顺序对构建缓存的影响，以及常见踩坑案例排查。附镜像大小对比表格，从 500MB 压缩到 50MB，部署速度提升 10 倍，CVE 漏洞减少 93%。



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
| 8 | 扩展安装失败 | `docker-php-ext-install` 报错 | 先装 `*-dev` 依赖，或用 Alpine 的 `apk add php80-xxx` |
| 9 | `COPY --from` 路径错误 | 构建成功但运行时报 `No such file` | 用 `COPY --from=builder /app/vendor ./vendor`，注意绝对路径 |

### 7.1 深入理解：COPY 顺序如何影响构建缓存

Docker 的层缓存是**逐层匹配**的——一旦某一层的输入发生变化，该层及后续所有层都会重新构建。这意味着 `COPY` 的顺序直接决定了缓存命中率：

```dockerfile
# ❌ 错误顺序：源码变化 → vendor 重新安装
COPY . .
RUN composer install --no-dev

# ✅ 正确顺序：先拷贝依赖描述，再拷贝源码
COPY composer.json composer.lock ./
RUN composer install --no-dev
COPY . .
```

为什么？因为 `composer.json` 和 `composer.lock` 很少变动（只有加/删/升级依赖时才变），所以 `RUN composer install` 这一层几乎总是命中缓存。而源码（`COPY . .`）每次提交都在变，放在后面不会影响前面的层。

### 7.2 PHP 扩展安装失败排查清单

当 `docker-php-ext-install` 报错时，90% 是以下原因：

| 报错信息 | 原因 | 解法 |
|---------|------|------|
| `error: Cannot find libxxx` | 缺少 `-dev` 包 | `apk add --no-cache libxxx-dev` 或 `libxxx-dev` |
| `phpize not found` | 没装 `php-dev` 工具链 | `apk add --no-cache $PHPIZE_DEPS` |
| `configure: error: ...` | 依赖版本不兼容 | 检查 Alpine 仓库的扩展版本是否匹配 PHP 版本 |
| `Segmentation fault` | Alpine musl 兼容性问题 | 尝试用 `docker-php-ext-install` 而非 `apk add php80-xxx` |

**最佳实践**：在 Alpine 上优先用预编译的 `apk add php80-xxx`，比源码编译快 10 倍且更稳定。如果 Alpine 仓库没有你要的扩展，再用 `docker-php-ext-install`。

## 8. 镜像层分析工具 dive

[dive](https://github.com/wagoodman/dive) 是分析 Docker 镜像层的神器，能直观展示每一层的文件变化，帮你找出"胖层"。

### 8.1 安装

```bash
# macOS
brew install dive

# Linux
wget https://github.com/wagoodman/dive/releases/download/v0.12.0/dive_0.12.0_linux_amd64.deb
sudo apt install ./dive_0.12.0_linux_amd64.deb

# Docker（无需安装）
docker run --rm -it \
    -v /var/run/docker.sock:/var/run/docker.sock \
    wagoodman/dive:latest myapp:latest
```

### 8.2 使用

```bash
# 分析镜像（交互式 TUI）
dive myapp:latest

# CI 模式（非交互，输出分析报告）
dive myapp:latest --ci

# 分析构建过程
CI=true dive build -t myapp:latest .
```

### 8.3 dive 输出解读

```
Image name: myapp:latest
Total Image size: 48 MB
Potential wasted space: 1.2 MB

├── Layers ──────────────────────────────
│   Layer 1:  28 MB  ← Alpine 基础镜像
│   Layer 2:   3 MB  ← apk add 运行时依赖
│   Layer 3:  12 MB  ← PHP 扩展
│   Layer 4:   2 MB  ← vendor（压缩后）
│   Layer 5:   3 MB  ← 项目代码
│
├── Image Details ───────────────────────
│   Efficiency: 97.5%  ← 层复用率
│   Wasted:      1.2 MB  ← 重复文件浪费空间
│
└── Recommendations ────────────────────
    ✓ 镜像效率良好
    ⚠ vendor/ 中有 2MB 的 dev 文件残留
```

**关键指标**：
- **Efficiency**（效率）：越高越好，代表层复用率。低于 80% 说明有大量重复拷贝
- **Wasted space**（浪费空间）：不同层中重复出现的文件。合并 `RUN` 指令可以减少
- **每层文件列表**：点击每层可以看到新增/修改/删除的文件，快速定位"胖层"

### 8.4 dive 实战：发现隐藏的 200MB

```bash
$ dive myapp:latest

# 发现 Layer 3 有 200MB！展开一看：
# /var/cache/apt/archives/  ← apt 缓存没清理！
# /usr/share/doc/            ← 文档文件
# /usr/share/man/            ← man 手册
```

**修复**：

```dockerfile
# 修复前：残留 200MB 缓存
RUN apt-get update && apt-get install -y libzip-dev
RUN docker-php-ext-install zip

# 修复后：单层合并 + 清理缓存
RUN apt-get update && apt-get install -y --no-install-recommends libzip-dev \
    && docker-php-ext-install zip \
    && apt-get purge -y --auto-remove libzip-dev \
    && rm -rf /var/lib/apt/lists/*
```

或者直接用 Alpine，`apk add --no-cache` 天生就不会留缓存。

## 9. 镜像大小对比表格（各层详细分析）

| 层级 | 单阶段（Before） | 多阶段（After） | 说明 |
|------|-----------------|----------------|------|
| **基础镜像** | 451 MB (Debian) | 28 MB (Alpine) | Debian → Alpine，体积缩小 16 倍 |
| **构建依赖** | 120 MB | 0 MB（不进入生产镜像） | git, unzip, lib*-dev 等全部在 Stage 1 |
| **Composer 二进制** | 5 MB | 0 MB（不进入生产镜像） | 只在 Stage 1 使用 |
| **PHP 扩展** | 85 MB（源码编译） | 12 MB（预编译 apk） | Alpine 预编译扩展比源码编译小 7 倍 |
| **vendor 目录** | 150 MB（含 dev） | 12 MB（production only） | `--no-dev` 去掉测试框架等 |
| **项目源码** | 70 MB（含 .git） | 3 MB（.dockerignore 过滤） | 排除 .git, tests, node_modules 等 |
| **系统缓存** | 46 MB（apt 缓存） | 0 MB | `apk add --no-cache` 不留缓存 |
| **合计** | **527 MB** | **48 MB** | **减少 91%** |

> **Tip**：用 `docker history myapp:latest` 可以快速查看每层大小。更精确的分析请用 `dive`（见第 8 节）。

## 10. 总结

多阶段构建不是什么高级技巧，而是 PHP Docker 化的**基本功**。核心就三个原则：

1. **编译和运行物理隔离**：构建依赖永远不进生产镜像
2. **最小化基础镜像**：Alpine > Debian-slim > Debian > Ubuntu
3. **利用层缓存**：先 COPY 依赖描述文件（composer.json），后 COPY 源码

在 KKday B2C 后端 30+ 仓库中，我们用这套模板统一了所有 Laravel 项目的 Dockerfile，新人不用理解 Docker 细节，照着模板改 `composer.json` 就行。镜像从平均 500MB 降到 50MB 以下，CI 构建时间缩短 90%，Trivy 漏洞数减少 93%。

这不是"锦上添花"，而是"救命稻草"——当你有 30 个服务、每次部署要推送镜像到跨区域 Registry 时，50MB 和 500MB 的差距直接决定了你的部署窗口是 5 分钟还是 50 分钟。

---

## 相关阅读

- [Docker 29.x 实战：BuildKit、多阶段构建与镜像优化策略踩坑记录](/categories/DevOps/docker-29-x-guide-buildkit-imageoptimization/)
- [Docker Compose Laravel 本地开发环境实战：PHP-FPM 8.3 + MySQL 8.0 + Redis 7 + Mailpit 完整搭建指南](/categories/DevOps/docker-compose-laravel-guide-php-fpm-8-3-mysql-redis-mailpit-guide/)
- [GitHub Actions + Composer Cache：构建时间从 20s→5s 的优化实战踩坑记录](/categories/DevOps/github-actions-composer-cache-20s5s-optimization/)
- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/categories/运维/2026-06-02-Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/)
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/CI/CD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
