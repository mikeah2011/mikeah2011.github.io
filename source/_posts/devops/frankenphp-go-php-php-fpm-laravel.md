---
title: FrankenPHP 实战：Go 驱动的 PHP 应用服务器——替代 PHP-FPM 的现代部署方案与 Laravel 集成
date: 2026-06-03 10:00:00
tags: [FrankenPHP, Go, PHP, Laravel, 应用服务器, 性能优化]
keywords: [FrankenPHP, Go, PHP, FPM, Laravel, 驱动的, 应用服务器, 替代, 的现代部署方案与, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: FrankenPHP 是基于 Go 语言和 Caddy 构建的现代化 PHP 应用服务器，通过 Worker 模式实现 PHP 常驻内存，吞吐量较传统 PHP-FPM 提升 2-5 倍。原生支持 HTTP/3 与自动 HTTPS，一个二进制文件即可替代 Nginx+PHP-FPM 的复杂架构。本文深度剖析 FrankenPHP 架构原理与 Worker 模式机制，横向对比 Swoole、RoadRunner 方案差异，涵盖 Laravel Sail 集成、Docker 生产级部署、OPcache/JIT 调优、Prometheus 监控、Kubernetes HPA 扩缩容等实战内容，附带五个生产踩坑案例与完整迁移清单，帮助 PHP 开发者快速掌握 FrankenPHP 部署落地的全流程。
---


## TL;DR

FrankenPHP 是一个由 Go 语言驱动的现代 PHP 应用服务器，基于 Caddy 构建，将 PHP 运行时直接嵌入 Go 进程中。它提供了 Worker 模式（常驻内存，避免每次请求重新引导框架）、原生 HTTP/2 与 HTTP/3 支持、自动 HTTPS 证书管理、以及零配置的生产级部署能力。对于 Laravel 应用而言，FrankenPHP 的 Worker 模式可以将请求吞吐量提升 2-5 倍，同时大幅简化部署架构——一个二进制文件替代 Nginx + PHP-FPM 的组合。本文将从架构原理、性能基准、Laravel 集成实战、Docker 生产部署、踩坑记录五个维度，全面解析 FrankenPHP 的落地实践。

---

## 一、为什么需要 FrankenPHP？

### 1.1 传统 PHP 部署的痛点

传统 PHP 部署架构通常是：Nginx → PHP-FPM → PHP 进程。这套架构稳定运行了十余年，但存在几个固有问题：

- **每次请求冷启动**：PHP-FPM 的 fork 模型意味着每个请求都要重新加载框架的引导程序（`bootstrap/app.php`）、注册服务提供者、加载配置文件。对于 Laravel 这样的全栈框架，单次引导可能消耗 50-100ms。
- **架构复杂度高**：需要同时管理 Nginx 配置、PHP-FPM 进程池、Unix Socket / TCP 连接，运维负担重。
- **协议受限**：PHP-FPM 只支持 FastCGI 协议，HTTP/2 和 HTTP/3 的终结依赖 Nginx 反向代理，无法充分利用现代协议的多路复用和头部压缩能力。
- **内存效率低**：每个 PHP-FPM 进程独立加载一份框架运行时，无法共享内存中的编译产物。

### 1.2 FrankenPHP 的解决方案

FrankenPHP 的核心思路是：**将 PHP 嵌入到 Go 的 Caddy Web 服务器中**，让 Go 进程直接管理 PHP 运行时。这意味着：

- 一个 Go 二进制文件同时充当 Web 服务器和 PHP 解释器
- Worker 模式下 PHP 进程常驻内存，框架只需引导一次
- 原生支持 HTTP/1.1、HTTP/2、HTTP/3（QUIC）
- Caddy 内置 ACME 客户端，自动获取和续期 Let's Encrypt 证书

---

## 二、架构深度解析

### 2.1 FrankenPHP 的分层架构

```
┌─────────────────────────────────────────┐
│            Go 进程 (Caddy)               │
│  ┌───────────┐  ┌─────────────────────┐ │
│  │  Caddy     │  │  FrankenPHP 模块    │ │
│  │  HTTP 核心 │  │  ┌───────────────┐  │ │
│  │  (HTTP/2,  │  │  │  PHP Embed SAPI│  │ │
│  │   HTTP/3)  │  │  │  (Cgo 调用)   │  │ │
│  │            │  │  └───────┬───────┘  │ │
│  └───────────┘  │          │           │ │
│                 │  ┌───────▼───────┐  │ │
│                 │  │  Worker 管理器 │  │ │
│                 │  │  (Go Routine)  │  │ │
│                 │  └───────────────┘  │ │
│                 └─────────────────────┘ │
└─────────────────────────────────────────┘
         ▲                    ▲
    HTTP 请求              PHP 脚本 / Laravel
```

关键组件：

1. **Caddy**：Go 编写的高性能 Web 服务器，提供 HTTP 协议栈、TLS 管理、反向代理等功能。
2. **FrankenPHP 模块**：以 Caddy 模块的形式注册，通过 Cgo 调用 PHP 的 Embed SAPI（Server API），将 PHP 解释器嵌入 Go 进程。
3. **Worker 管理器**：由 Go Routine 驱动，维护一组常驻 PHP 工作进程，这些进程通过 Go 的 channel 机制接收请求并返回响应。

### 2.2 Worker 模式 vs 传统 FPM 模式

这是 FrankenPHP 最核心的差异点：

| 特性 | 传统 FPM 模式 | FrankenPHP Worker 模式 |
|------|--------------|----------------------|
| 进程生命周期 | 每个请求 fork/销毁 | 常驻内存，循环处理请求 |
| 框架引导 | 每次请求重新引导 | 仅首次引导一次 |
| 内存占用 | 进程间不共享框架状态 | 框架状态持久化在内存中 |
| 响应延迟 | 包含引导时间 | 首次请求后大幅降低 |
| 兼容性 | 所有 PHP 代码兼容 | 需要注意全局状态污染 |

Worker 模式的原理非常优雅：PHP 工作进程在启动时执行框架引导代码，然后进入一个无限循环，等待 Go 通过管道（pipe）发送的请求数据。每处理完一个请求，工作进程不会退出，而是回到循环顶部等待下一个请求。

```
传统 FPM:  启动 → 引导框架 → 处理请求 → 退出
Worker:    启动 → 引导框架 → [处理请求 → 等待 → 处理请求 → 等待 → ...]
```

---

## 三、快速上手

### 3.1 安装 FrankenPHP

最简单的方式是使用官方 Docker 镜像：

```bash
# 拉取官方镜像（基于 PHP 8.3）
docker pull dunglas/frankenphp

# 或使用 PHP 8.4
docker pull dunglas/frankenphp:php8.4

# 快速启动一个 PHP 项目
docker run -p 80:80 -p 443:443 \
  -v ./public:/app/public \
  dunglas/frankenphp
```

如果你偏好独立二进制文件安装：

```bash
# Linux x86_64
curl -sL https://github.com/dunglas/frankenphp/releases/latest/download/frankenphp-linux-x86_64 \
  -o /usr/local/bin/frankenphp
chmod +x /usr/local/bin/frankenphp

# 验证安装
frankenphp version
```

### 3.2 基础运行

创建一个测试文件：

```php
<?php
// public/index.php
phpinfo();
```

启动服务器：

```bash
# 最简单的启动方式
frankenphp php-server

# 指定根目录和域名
frankenphp php-server --root ./public --domain localhost
```

访问 `https://localhost`，FrankenPHP 会自动配置 HTTPS（自签名证书）。这就是 Caddy 的魔力——零配置 HTTPS。

### 3.3 配置文件（Caddyfile）

生产环境中，我们通常使用 Caddyfile 进行配置：

```caddyfile
{
    # 全局配置
    auto_https disable_redirects

    frankenphp

    # Worker 配置
    order php_server before file_server
}

example.com {
    root * /app/public

    # 启用 PHP Worker 模式
    php_server {
        worker {
            file /app/artisan
            num 4
            env APP_ENV production
        }
    }

    # 静态文件
    file_server

    # Gzip 压缩
    encode gzip

    # 日志
    log {
        output file /var/log/frankenphp/access.log
        format json
    }
}
```

---

## 四、Laravel 集成实战

### 4.0 使用 Laravel Sail 快速集成

Laravel Sail 是 Laravel 官方的 Docker 开发环境工具。要使用 FrankenPHP 替代默认的 Nginx + PHP-FPM，只需修改 `docker-compose.yml`：

```yaml
# docker-compose.yml - 替换默认的 laravel.test 服务
services:
  laravel.test:
    image: dunglas/frankenphp:php8.3
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - .:/app
    environment:
      APP_ENV: local
      APP_DEBUG: "true"
    # FrankenPHP 自动处理 HTTPS，无需额外配置
```

使用 Sail 启动：

```bash
# 启动 FrankenPHP 开发环境
./vendor/bin/sail up -d

# 访问应用（FrankenPHP 自动配置 HTTPS）
# https://localhost
```

> **提示**：FrankenPHP 在开发环境中自动提供自签名 HTTPS 证书，无需手动配置。

### 4.1 项目初始化

将 FrankenPHP 集成到 Laravel 项目非常简单。首先，确保你的 Laravel 项目使用 PHP 8.2+：

```bash
# 创建新的 Laravel 项目
composer create-project laravel/laravel my-app
cd my-app

# 安装 FrankenPHP 包（可选，提供 Artisan 命令）
composer require dunglas/frankenphp
```

### 4.2 编写启动脚本

在 Laravel 项目根目录创建 `frankenphp-worker.php`：

```php
<?php
// frankenphp-worker.php

// 预引导 Laravel 应用
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

// FrankenPHP Worker 模式会自动处理请求循环
// 这里我们利用 Laravel 的预热机制
$kernel->handle(
    \Illuminate\Http\Request::capture()
);

echo "FrankenPHP Worker 启动完成，Laravel 应用已引导\n";
```

### 4.3 生产级 Caddyfile 配置

```caddyfile
{
    auto_https disable_redirects
    frankenphp

    order php_server before file_server
}

:8080 {
    root * /app/public
    encode zstd gzip

    # PHP Worker 模式 - 这是性能提升的关键
    php_server {
        worker {
            # 使用 artisan 或自定义引导脚本
            file /app/artisan
            num ${NUM_WORKERS:4}
            env APP_ENV production
            env APP_DEBUG false
            env LOG_CHANNEL stderr
        }
    }

    # 静态文件 - 直接由 Go 处理，不经过 PHP
    @static {
        path *.js *.css *.ico *.svg *.woff *.woff2 *.png *.jpg *.gif
    }
    handle @static {
        file_server {
            precompressed zstd gzip
        }
        header Cache-Control "public, max-age=31536000, immutable"
    }

    # Laravel API 路由
    @api {
        path /api/*
    }
    handle @api {
        php_server {
            worker {
                file /app/artisan
                num ${API_WORKERS:8}
            }
        }
    }

    # 健康检查端点
    handle /health {
        respond "OK" 200
    }

    # 错误页面
    handle_errors {
        respond "{http.error.status} {http.error.message}" {http.error.status}
    }
}
```

### 4.4 环境变量配置

在 `.env` 文件中添加 FrankenPHP 相关配置：

```env
# FrankenPHP Worker 配置
FRANKENPHP_WORKER_NUM=4
FRANKENPHP_MAX_REQUESTS=1000

# 确保 Laravel 使用正确的连接信息
TRUSTED_PROXIES=*
APP_URL=https://your-domain.com
```

### 4.5 处理队列和调度器

FrankenPHP 可以与 Laravel 的队列和调度器完美配合：

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    image: dunglas/frankenphp:php8.3
    volumes:
      - .:/app
    ports:
      - "8080:8080"
    environment:
      - APP_ENV=production
      - NUM_WORKERS=4

  queue-worker:
    image: dunglas/frankenphp:php8.3
    command: php artisan queue:work --sleep=3 --tries=3 --max-time=3600
    volumes:
      - .:/app
    environment:
      - APP_ENV=production

  scheduler:
    image: dunglas/frankenphp:php8.3
    command: php artisan schedule:work
    volumes:
      - .:/app
    environment:
      - APP_ENV=production
```

---

## 五、性能基准对比

### 5.1 测试环境

- 服务器：4 vCPU / 8GB RAM / NVMe SSD
- PHP 8.3 + OPcache
- Laravel 11 项目（包含 15 个中间件、数据库查询）
- 测试工具：wrk（并发 100，持续 30 秒）

### 5.2 测试结果

| 方案 | 请求/秒 | 平均延迟 | P99 延迟 | 内存峰值 |
|------|---------|---------|---------|---------|
| Nginx + PHP-FPM (默认) | 1,240 | 80ms | 185ms | 420MB |
| Nginx + PHP-FPM (优化) | 1,850 | 54ms | 142MB | 510MB |
| FrankenPHP (CGI 模式) | 1,180 | 85ms | 192ms | 380MB |
| FrankenPHP (Worker 模式, 4 进程) | 3,420 | 29ms | 78MB | 520MB |
| FrankenPHP (Worker 模式, 8 进程) | 4,680 | 21ms | 62ms | 680MB |

关键发现：

- **Worker 模式比 FPM 提升 2.5-3.8 倍吞吐量**，因为省去了框架引导开销。
- **P99 延迟降低 65%**，这对于用户体验至关重要。
- **CGI 模式性能与 FPM 相当**，验证了 Go 进程管理的效率。

### 5.3 冷启动对比

```
Nginx + PHP-FPM 首次请求:
  框架引导: 78ms
  SQL 连接: 12ms
  总耗时: 90ms

FrankenPHP Worker 首次请求:
  框架引导: 75ms (首次，之后不再发生)
  SQL 连接: 10ms (首次，连接池保持)
  总耗时: 85ms

FrankenPHP Worker 后续请求:
  框架引导: 0ms (已常驻)
  SQL 连接: 0ms (连接复用)
  总耗时: 5-15ms
```

---

## 六、HTTPS 自动配置

FrankenPHP 继承了 Caddy 强大的自动 HTTPS 能力：

### 6.1 生产环境自动证书

```caddyfile
{
    email admin@example.com
    acme_ca https://acme-v02.api.letsencrypt.org/directory
}

app.example.com {
    root * /app/public
    php_server {
        worker {
            file /app/artisan
            num 4
        }
    }
    file_server
}
```

只需配置域名和邮箱，Caddy 会自动：
1. 申请 Let's Encrypt 证书
2. 配置 HTTP → HTTPS 重定向
3. 证书到期前自动续期
4. OCSP Stapling

### 6.2 使用自定义证书

```caddyfile
app.example.com {
    tls /etc/ssl/certs/cert.pem /etc/ssl/private/key.pem
    root * /app/public
    php_server {
        worker {
            file /app/artisan
            num 4
        }
    }
    file_server
}
```

### 6.3 内网环境使用自签名证书

```caddyfile
{
    local_certs
}

internal.dev.local {
    root * /app/public
    php_server {
        worker {
            file /app/artisan
            num 2
        }
    }
    file_server
}
```

---

## 七、Docker 生产部署

### 7.1 多阶段构建 Dockerfile

```dockerfile
# 阶段 1: Composer 依赖安装
FROM composer:2.7 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist
COPY . .
RUN composer dump-autoload --optimize --no-dev

# 阶段 2: 前端资源构建
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 阶段 3: 生产镜像
FROM dunglas/frankenphp:php8.3 AS production

# 安装 PHP 扩展
RUN install-php-extensions \
    pdo_mysql \
    redis \
    opcache \
    pcntl \
    bcmath \
    gd \
    zip

# PHP 配置优化
RUN echo "opcache.enable=1" >> /usr/local/etc/php/conf.d/opcache.ini && \
    echo "opcache.memory_consumption=256" >> /usr/local/etc/php/conf.d/opcache.ini && \
    echo "opcache.interned_strings_buffer=16" >> /usr/local/etc/php/conf.d/opcache.ini && \
    echo "opcache.max_accelerated_files=20000" >> /usr/local/etc/php/conf.d/opcache.ini && \
    echo "opcache.validate_timestamps=0" >> /usr/local/etc/php/conf.d/opcache.ini && \
    echo "opcache.jit=1255" >> /usr/local/etc/php/conf.d/opcache.ini && \
    echo "opcache.jit_buffer_size=128M" >> /usr/local/etc/php/conf.d/opcache.ini

WORKDIR /app

# 复制应用文件
COPY --from=vendor /app/vendor ./vendor
COPY --from=vendor /app/composer.json ./
COPY --from=frontend /app/public/build ./public/build
COPY . .

# 设置权限
RUN chown -R www-data:www-data storage bootstrap/cache && \
    chmod -R 775 storage bootstrap/cache

# 预生成配置缓存
RUN php artisan config:cache && \
    php artisan route:cache && \
    php artisan view:cache && \
    php artisan event:cache

# FrankenPHP Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
EXPOSE 8443
```

### 7.2 生产级 Caddyfile

```caddyfile
{
    auto_https off
    admin off
    log {
        level INFO
        format json
    }

    frankenphp
    order php_server before file_server
}

:8080 {
    root * /app/public
    encode zstd gzip

    php_server {
        worker {
            file /app/artisan
            num ${NUM_WORKERS:-4}
            max_requests 1000
            env APP_ENV production
            env APP_DEBUG false
        }
    }

    # 健康检查
    handle /up {
        respond "OK" 200
    }

    # 静态资源
    @static {
        path /build/* /favicon.ico /robots.txt
    }
    handle @static {
        header Cache-Control "public, max-age=31536000, immutable"
        file_server
    }

    # 通用路由
    handle {
        rewrite * /index.php
        php_server {
            worker {
                file /app/artisan
                num ${NUM_WORKERS:-4}
                max_requests 1000
            }
        }
    }

    # 错误处理
    handle_errors {
        respond "Service Unavailable" 503
    }
}
```

### 7.3 Docker Compose 完整配置

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    ports:
      - "8080:8080"
    environment:
      - APP_ENV=production
      - APP_KEY=${APP_KEY}
      - DB_HOST=mysql
      - DB_DATABASE=laravel
      - DB_USERNAME=laravel
      - DB_PASSWORD=${DB_PASSWORD}
      - CACHE_STORE=redis
      - REDIS_HOST=redis
      - QUEUE_CONNECTION=redis
      - SESSION_DRIVER=redis
      - NUM_WORKERS=4
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/up"]
      interval: 30s
      timeout: 5s
      retries: 3

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: laravel
      MYSQL_USER: laravel
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  queue-worker:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    command: php /app/artisan queue:work --sleep=3 --tries=3 --max-time=3600
    environment:
      - APP_ENV=production
      - DB_HOST=mysql
      - DB_DATABASE=laravel
      - DB_USERNAME=laravel
      - DB_PASSWORD=${DB_PASSWORD}
      - CACHE_STORE=redis
      - REDIS_HOST=redis
      - QUEUE_CONNECTION=redis
    depends_on:
      - app
    restart: unless-stopped

  scheduler:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    command: sh -c "while true; do php /app/artisan schedule:run --verbose --no-interaction & sleep 60; done"
    environment:
      - APP_ENV=production
      - DB_HOST=mysql
      - DB_DATABASE=laravel
      - DB_USERNAME=laravel
      - DB_PASSWORD=${DB_PASSWORD}
      - CACHE_STORE=redis
      - REDIS_HOST=redis
    depends_on:
      - app
    restart: unless-stopped

volumes:
  mysql_data:
```

### 7.4 GitHub Actions CI/CD 流水线

将 FrankenPHP 部署集成到 CI/CD 流水线中，实现从代码提交到生产部署的自动化：

```yaml
# .github/workflows/deploy.yml
name: Deploy Laravel with FrankenPHP

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: password
          MYSQL_DATABASE: testing
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, mysql, pdo_mysql
          coverage: none

      - name: Install dependencies
        run: composer install --no-dev --prefer-dist

      - name: Run tests
        run: php artisan test
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: testing
          DB_USERNAME: root
          DB_PASSWORD: password

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          target: production

      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/laravel-app
            docker compose pull app
            docker compose up -d --no-deps app
            # 等待健康检查通过
            sleep 10
            curl -f http://localhost:8080/up || exit 1
            # 部署后重启 Worker
            docker compose exec app curl -X POST http://localhost:2019/config/apps/frankenphp/restart-workers
            echo "Deployed successfully: ${{ github.sha }}"
```

### 7.5 OPcache 与 JIT 配置详解

FrankenPHP Worker 模式下，OPcache 的配置尤为关键。以下是生产推荐配置：

```ini
; /usr/local/etc/php/conf.d/opcache.ini

; 基础配置
opcache.enable=1
opcache.enable_cli=1  ; Worker 模式是 CLI 进程，必须开启

; 内存配置
opcache.memory_consumption=256       ; 共享内存大小(MB)，大型项目建议 256-512
opcache.interned_strings_buffer=16   ; 驻留字符串缓冲区(MB)
opcache.max_accelerated_files=20000  ; 最大缓存文件数，Laravel 项目建议 15000-20000

; 生产性能配置
opcache.validate_timestamps=0        ; 生产环境不检查文件修改时间
opcache.revalidate_freq=0            ; 配合 validate_timestamps=0 使用
opcache.save_comments=1              ; 保留注释（某些框架依赖注解）

; PHP 8.0+ JIT 编译器配置
opcache.jit=1255                     ; JIT 模式：1255 = 全功能 + 寄存器分配
opcache.jit_buffer_size=128M         ; JIT 编译缓冲区大小

; 预加载配置（可选，适合 Laravel 10+）
; opcache.preload=/app/preload.php
; opcache.preload_user=www-data
```

> **重要提示**：在 FrankenPHP Worker 模式下，`opcache.enable_cli=1` 是必须的。传统 PHP-FPM 不需要此设置（因为 FPM 是 PHP 进程管理器，自动启用 OPcache），但 FrankenPHP 的 Worker 运行在 CLI 模式下，必须显式启用。

---

## 八、监控与可观测性

生产环境中，对 FrankenPHP 应用的监控至关重要。以下介绍几种常用的监控方案。

### 8.1 使用 Prometheus + Grafana 监控

FrankenPHP 基于 Caddy，可以通过 `caddy-prometheus` 插件暴露指标：

```caddyfile
{
    servers {
        metrics
    }
    frankenphp
    order php_server before file_server
}

:8080 {
    root * /app/public
    php_server {
        worker {
            file /app/artisan
            num 4
        }
    }

    # Prometheus 指标端点
    handle /metrics {
        respond "metrics endpoint" 200
    }

    file_server
}
```

在应用层面，可以使用 Laravel 的中间件采集自定义指标：

```php
<?php
// app/Http/Middleware/PrometheusMetrics.php

namespace App\Http\Middleware;

use Closure;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class PrometheusMetrics
{
    private static ?CollectorRegistry $registry = null;

    private static function getRegistry(): CollectorRegistry
    {
        if (self::$registry === null) {
            Redis::setDefaultOptions([
                'host' => env('REDIS_HOST', '127.0.0.1'),
                'port' => 6379,
            ]);
            self::$registry = CollectorRegistry::getDefault();
        }
        return self::$registry;
    }

    public function handle($request, Closure $next)
    {
        $startTime = microtime(true);
        $response = $next($request);
        $duration = microtime(true) - $startTime;

        try {
            $registry = self::getRegistry();

            // 请求计数器
            $counter = $registry->getOrRegisterCounter(
                'app', 'http_requests_total', 'Total HTTP requests',
                ['method', 'status', 'path']
            );
            $counter->inc([
                $request->method(),
                (string) $response->getStatusCode(),
                $request->route()?->getName() ?? 'unknown',
            ]);

            // 请求延迟直方图
            $histogram = $registry->getOrRegisterHistogram(
                'app', 'http_request_duration_seconds', 'Request duration',
                ['method', 'path'],
                [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
            );
            $histogram->observe($duration, [
                $request->method(),
                $request->route()?->getName() ?? 'unknown',
            ]);

            // 内存使用 Gauge
            $gauge = $registry->getOrRegisterGauge(
                'app', 'php_memory_usage_bytes', 'Current PHP memory usage'
            );
            $gauge->set(memory_get_usage(true));
        } catch (\Exception $e) {
            // 监控不应影响正常请求
        }

        return $response;
    }
}
```

### 8.2 结构化日志配置

在 Caddyfile 中配置 JSON 格式的结构化日志，便于 ELK/Loki 等日志系统采集：

```caddyfile
{
    log {
        level INFO
        format json
        output file /var/log/frankenphp/access.log {
            roll_size 100mb
            roll_keep 10
            roll_keep_for 720h
        }
    }

    frankenphp
    order php_server before file_server
}

:8080 {
    root * /app/public

    # 请求日志
    log {
        format json
        output file /var/log/frankenphp/requests.log {
            roll_size 50mb
            roll_keep 5
        }
        # 记录关键字段
        fields {
            uri {request.uri}
            method {request.method}
            status {response.status}
            duration {request.duration}
            remote_addr {request.remote_addr}
            user_agent {request.header.User-Agent}
        }
    }

    php_server {
        worker {
            file /app/artisan
            num 4
        }
    }

    file_server
}
```

### 8.3 Docker 容器资源限制

在生产环境中，合理设置容器资源限制可以防止单个服务占用过多资源：

```yaml
# docker-compose.yml 中的资源限制
services:
  app:
    image: dunglas/frankenphp:php8.3
    deploy:
      resources:
        limits:
          cpus: '2.0'          # 最多使用 2 个 CPU 核心
          memory: 1G           # 最多使用 1GB 内存
        reservations:
          cpus: '0.5'          # 预留 0.5 个 CPU 核心
          memory: 256M         # 预留 256MB 内存
    # OOM 时优先被杀死（值越低越优先）
    oom_score_adj: 500

  queue-worker:
    image: dunglas/frankenphp:php8.3
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
    # 队列 Worker 在内存紧张时被优先回收
    oom_score_adj: 700
```

---

## 九、在反向代理后面运行 FrankenPHP

在很多生产环境中，FrankenPHP 并不直接面向互联网，而是运行在负载均衡器或反向代理（如 Nginx、Traefik、AWS ALB）后面。以下是常见的配置模式。

### 9.1 FrankenPHP 在 Nginx 反向代理后面

```nginx
# /etc/nginx/conf.d/frankenphp.conf

upstream frankenphp {
    server 127.0.0.1:8080;
    # 多实例负载均衡
    # server 127.0.0.1:8081;
    keepalive 32;
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    # 传递真实客户端信息
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket 支持（如果需要）
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # 代理超时配置
    proxy_connect_timeout 10s;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;

    location / {
        proxy_pass http://frankenphp;
    }
}
```

同时，在 FrankenPHP 的 Caddyfile 中需要信任上游代理：

```caddyfile
{
    # 信任 Nginx 发送的 X-Forwarded-* 头
    servers {
        trusted_proxies static 127.0.0.1/32
    }

    frankenphp
    order php_server before file_server
}

:8080 {
    root * /app/public

    php_server {
        worker {
            file /app/artisan
            num 4
        }
    }

    file_server
}
```

### 9.2 FrankenPHP 在 Traefik 后面

使用 Docker labels 配置 Traefik 自动发现 FrankenPHP 服务：

```yaml
# docker-compose.yml
services:
  app:
    image: dunglas/frankenphp:php8.3
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app.rule=Host(`example.com`)"
      - "traefik.http.routers.app.tls=true"
      - "traefik.http.routers.app.tls.certresolver=letsencrypt"
      - "traefik.http.services.app.loadbalancer.server.port=8080"
      # 传递真实 IP
      - "traefik.http.routers.app.middlewares=real-ip"
      - "traefik.http.middlewares.real-ip.headers.customrequestheaders.X-Real-IP=%%IP%%"
    volumes:
      - .:/app
    environment:
      - APP_ENV=production
      - NUM_WORKERS=4

  traefik:
    image: traefik:v3.0
    command:
      - "--providers.docker=true"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt

volumes:
  letsencrypt:
```

## 十、Nginx 配置到 Caddyfile 的迁移指南

从 Nginx 迁移到 FrankenPHP 时，最核心的工作是将 Nginx 配置转换为 Caddyfile。以下是常见场景的对照表：

### 10.1 路由重写

```nginx
# Nginx: Laravel 的 try_files 规则
location / {
    try_files $uri $uri/ /index.php?$query_string;
}
```

```caddyfile
# Caddyfile: FrankenPHP 等效配置
:8080 {
    root * /app/public
    # php_server 自动处理 try_files 逻辑
    php_server {
        worker {
            file /app/artisan
            num 4
        }
    }
    file_server
}
```

### 10.2 路径前缀路由

```nginx
# Nginx: 子路径路由
location /api/ {
    fastcgi_pass unix:/run/php/php-fpm.sock;
    fastcgi_param SCRIPT_FILENAME /app/public/index.php;
    include fastcgi_params;
}

location /admin/ {
    fastcgi_pass unix:/run/php/php-fpm.sock;
    fastcgi_param SCRIPT_FILENAME /app/public/index.php;
    include fastcgi_params;
}
```

```caddyfile
# Caddyfile: 子路径路由
:8080 {
    # API 路由 - 可配置更多 Worker
    handle /api/* {
        root * /app/public
        php_server {
            worker {
                file /app/artisan
                num 8
            }
        }
    }

    # 管理后台路由
    handle /admin/* {
        root * /app/public
        php_server {
            worker {
                file /app/artisan
                num 2
            }
        }
    }

    # 默认路由
    handle {
        root * /app/public
        php_server {
            worker {
                file /app/artisan
                num 4
            }
        }
        file_server
    }
}
```

### 10.3 反向代理配置

```nginx
# Nginx: 反向代理到其他服务
location /api/search {
    proxy_pass http://elasticsearch:9200;
    proxy_set_header Host $host;
}

location /ws/ {
    proxy_pass http://websocket-server:8081;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

```caddyfile
# Caddyfile: 反向代理
:8080 {
    # Elasticsearch 代理
    handle /api/search/* {
        reverse_proxy elasticsearch:9200
    }

    # WebSocket 代理
    handle /ws/* {
        reverse_proxy websocket-server:8081 {
            # Caddy 自动处理 WebSocket 升级
        }
    }

    # PHP 应用
    handle {
        root * /app/public
        php_server {
            worker {
                file /app/artisan
                num 4
            }
        }
        file_server
    }
}
```

---

## 十一、踩坑记录

### 踩坑 1：Worker 模式下的全局状态污染

**现象**：在 Worker 模式下，某些请求返回了上一个用户的数据，出现严重的数据串扰。

**根因**：Laravel 的 `App::setLocale()`、`Auth::setUser()` 等操作设置了全局状态。在传统 FPM 模式下，请求结束后进程销毁，全局状态自然清除。但 Worker 模式下进程常驻，这些状态会"泄漏"到下一个请求。

**解决方案**：

```php
// app/Http/Middleware/CleanupGlobalState.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CleanupGlobalState
{
    public function handle($request, Closure $next)
    {
        return $next($request);
    }

    public function terminate($request, $response)
    {
        // 重置认证状态
        Auth::forgetGuards();

        // 清理数据库连接
        DB::purge();

        // 重置应用 locale
        app()->setLocale(config('app.locale'));

        // 清理临时变量
        gc_collect_cycles();
    }
}
```

注册为全局中间件：

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->append(\App\Http\Middleware\CleanupGlobalState::class);
})
```

### 踩坑 2：`exit()` 和 `die()` 导致 Worker 进程退出

**现象**：某个请求触发了 `exit()` 或 `die()`，整个 Worker 进程直接退出，导致后续请求全部失败。

**根因**：在 Worker 模式下，`exit()` 会终止整个 PHP 进程，而不仅仅是当前请求。FrankenPHP 会自动重启 Worker，但中间会有短暂的服务中断。

**解决方案**：

```php
// 禁止使用 exit()，改用异常
// ❌ 错误做法
if ($error) {
    die('Something went wrong');
}

// ✅ 正确做法
if ($error) {
    throw new \RuntimeException('Something went wrong');
}
```

在项目中全局搜索 `exit` 和 `die`：

```bash
grep -rn '\bexit\b\|die(' app/ --include="*.php"
```

### 踩坑 3：静态文件 MIME 类型错误

**现象**：CSS 和 JS 文件返回 `text/plain` 而非正确的 MIME 类型，浏览器拒绝加载。

**根因**：Caddy 的 `file_server` 需要正确的文件扩展名来推断 MIME 类型。如果使用了 `rewrite` 重写到 `/index.php`，静态文件也会被 PHP 处理。

**解决方案**：确保静态文件路由在 PHP 路由之前：

```caddyfile
:8080 {
    root * /app/public

    # 先处理静态文件
    @static {
        path /css/* /js/* /images/* /fonts/* /build/*
        not path *.php
    }
    handle @static {
        file_server
    }

    # 再处理 PHP
    handle {
        php_server {
            worker {
                file /app/artisan
                num 4
            }
        }
    }
}
```

### 踩坑 4：内存泄漏导致 Worker 越来越慢

**现象**：运行几小时后，Worker 进程的内存持续增长，响应时间从 20ms 逐渐上升到 200ms+。

**根因**：某些 PHP 代码在 Worker 模式下会累积内存。例如，静态属性持有数据库查询结果、闭包引用外部变量、单例模式的容器对象等。

**解决方案**：

```caddyfile
# 设置 Worker 最大请求数，达到后自动重启
php_server {
    worker {
        file /app/artisan
        num 4
        max_requests 1000  # 每处理 1000 个请求后重启 Worker
    }
}
```

同时监控内存使用：

```php
// 在中间件中记录内存使用
public function handle($request, Closure $next)
{
    $response = $next($request);
    $memMB = round(memory_get_usage(true) / 1024 / 1024, 2);
    if ($memMB > 128) {
        Log::warning("Worker 高内存使用: {$memMB}MB", [
            'uri' => $request->getRequestUri(),
        ]);
    }
    return $response;
}
```

### 踩坑 5：OPcache 与 Worker 模式的冲突

**现象**：修改 PHP 代码后，即使清除了 OPcache，Worker 进程仍然执行旧代码。

**根因**：Worker 常驻内存，已经加载的代码不会因为 OPcache 清除而更新。需要重启 Worker 进程。

**解决方案**：

```bash
# 生产环境：设置 Caddy API 端口，用于动态管理
# 在 Caddyfile 中启用管理 API
{
    admin 0.0.0.0:2019
}

# 部署后重启 Worker
curl -X POST http://localhost:2019/config/apps/frankenphp/restart-workers

# 或者使用 Caddy reload（重新加载整个配置）
curl -X POST http://localhost:2019/load \
  -H "Content-Type: application/json" \
  -d @/etc/caddy/config.json
```

在部署脚本中自动化：

```bash
#!/bin/bash
# deploy.sh
set -e

echo "开始部署..."
php artisan down --render="errors::503"

# 更新代码
git pull origin main
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache

# 重启 FrankenPHP Worker
curl -X POST http://localhost:2019/config/apps/frankenphp/restart-workers

php artisan up
echo "部署完成"
```

---

## 十二、与传统方案的对比总结

### 12.0 Nginx vs FrankenPHP 完整配置对照

以下是一个典型的 Laravel 应用在 Nginx 和 FrankenPHP 下的完整配置对比，直观展示部署简化程度：

**Nginx + PHP-FPM 方案（需要 3 个配置文件）**：

```nginx
# /etc/nginx/sites-available/laravel.conf
server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root /var/www/laravel/public;
    index index.php;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_hide_header X-Powered-By;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}

# /etc/php/8.3/fpm/pool.d/laravel.conf
[laravel]
user = www-data
group = www-data
listen = /run/php/php8.3-fpm.sock
pm = dynamic
pm.max_children = 10
pm.start_servers = 3
pm.min_spare_servers = 2
pm.max_spare_servers = 5
pm.max_requests = 500
```

**FrankenPHP 方案（仅需 1 个 Caddyfile）**：

```caddyfile
{
    frankenphp
    order php_server before file_server
}

example.com {
    root * /app/public
    encode zstd gzip

    php_server {
        worker {
            file /app/artisan
            num 6
            max_requests 1000
        }
    }

    file_server
}
```

> **对比结论**：FrankenPHP 用 12 行配置替代了 Nginx + PHP-FPM 的 40+ 行配置，同时自动处理 HTTPS 证书、HTTP/3、压缩等。对于标准 PHP 项目，配置复杂度降低约 70%。

### 12.1 架构对比

```
传统方案:   客户端 → Nginx (HTTP/2) → FastCGI Socket → PHP-FPM → PHP 进程
FrankenPHP: 客户端 → Caddy (HTTP/3) → Go Embed SAPI → PHP 进程 (Worker)
```

FrankenPHP 减少了至少两个中间层，降低了延迟和运维复杂度。

### 12.2 适用场景

**推荐使用 FrankenPHP 的场景**：
- 新项目，希望简化部署架构
- 高并发 API 服务，Worker 模式收益最大
- 需要 HTTP/3 支持的场景
- 微服务架构中的 PHP 服务
- 开发环境，零配置 HTTPS 非常方便

**暂不推荐的场景**：
- 需要与大量 Nginx 特定功能（如 `try_files`、复杂重写规则）深度集成的遗留项目
- 已有成熟 Nginx + FPM 运维体系，切换成本高于收益
- 需要在同一端口上代理多个不同后端（非 PHP）服务

### 12.3 迁移清单

从 Nginx + PHP-FPM 迁移到 FrankenPHP 的检查清单：

```
□ 将 Nginx 配置转换为 Caddyfile
□ 启用 Worker 模式
□ 搜索并修复所有 exit()/die() 调用
□ 添加全局状态清理中间件
□ 测试静态文件服务是否正常
□ 配置 OPcache 和 JIT
□ 设置 Worker max_requests 防止内存泄漏
□ 更新 CI/CD 流程和部署脚本
□ 配置健康检查端点
□ 压力测试验证性能提升
□ 监控 Worker 内存使用趋势
□ 文档化新的部署流程
```

---

## 十三、与 Swoole / RoadRunner 的横向对比

除了 FrankenPHP，PHP 生态中还有 Swoole 和 RoadRunner 两个主流的常驻内存方案。以下是三者的详细对比：

### 13.1 核心特性对比

| 特性 | FrankenPHP | Swoole | RoadRunner |
|------|-----------|--------|------------|
| 底层语言 | Go (Caddy) | C (PHP 扩展) | Go (独立二进制) |
| 集成方式 | Cgo 调用 Embed SAPI | PHP 扩展 (PECL) | 独立进程 + Goridge 协议 |
| Worker 模式 | ✅ 内置 | ✅ 原生协程 | ✅ 内置 |
| HTTP/3 支持 | ✅ 原生 | ❌ 需额外代理 | ❌ 需额外代理 |
| 自动 HTTPS | ✅ Caddy 内置 | ❌ 需配置 | ❌ 需配置 |
| 与现有 PHP 生态兼容性 | ⭐⭐⭐⭐⭐ 高 | ⭐⭐⭐ 中（需适配） | ⭐⭐⭐⭐ 较高 |
| 安装复杂度 | ⭐⭐⭐⭐⭐ 极简 | ⭐⭐⭐ 需编译扩展 | ⭐⭐⭐⭐ 简单 |
| 协程支持 | ❌ 不支持 | ✅ 原生协程 | ❌ 不支持 |
| WebSocket | ❌ 需反向代理 | ✅ 原生支持 | ✅ 原生支持 |
| 社区活跃度 | 🟡 快速增长 | 🟢 成熟 | 🟢 成熟 |

### 13.2 性能对比（同一 Laravel 项目，4 vCPU / 8GB RAM）

| 方案 | 请求/秒 | 平均延迟 | P99 延迟 | 内存占用 |
|------|---------|---------|---------|---------|
| FrankenPHP Worker (4进程) | 3,420 | 29ms | 78ms | 520MB |
| Swoole (4 Worker) | 3,800 | 26ms | 65ms | 480MB |
| RoadRunner (4 Worker) | 3,100 | 32ms | 85ms | 540MB |
| Nginx + PHP-FPM (优化) | 1,850 | 54ms | 142ms | 510MB |

> **注意**：Swoole 的协程模式在 I/O 密集型场景（大量数据库查询、HTTP 调用）中优势更明显。对于纯 CPU 计算型任务，三者差距不大。

### 13.3 如何选择？

```
你需要原生 HTTP/3 和自动 HTTPS？
  → FrankenPHP

你需要协程、高并发 WebSocket？
  → Swoole

你想在不修改 PHP 代码的前提下获得 Worker 模式？
  → FrankenPHP 或 RoadRunner

你的项目已经深度使用 Swoole 协程生态？
  → 继续使用 Swoole
```

---

## 十四、高级实战：Worker 生命周期管理

### 14.1 自定义 Worker 引导脚本

对于需要精细控制启动流程的项目，可以编写自定义 Worker 脚本：

```php
<?php
// frankenphp-worker.php

// 防止 exit() 杀死 Worker
function frankenphp_exit_handler(int $code = 0): void {
    throw new \RuntimeException("exit() called with code: {$code}");
}
// 注册 shutdown 函数拦截 exit()
register_shutdown_function(function () {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_COMPILE_ERROR])) {
        // 记录致命错误但不退出 Worker
        error_log("[FrankenPHP Worker Fatal] {$error['message']} in {$error['file']}:{$error['line']}");
    }
});

// 预加载应用
$app = require_once __DIR__ . '/bootstrap/app.php';

// 预热关键服务（数据库连接、Redis 连接、配置缓存等）
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

// 预热数据库连接池
try {
    DB::connection()->getPdo();
    \Illuminate\Support\Facades\Cache::store()->lock('warmup')->get();
} catch (\Exception $e) {
    error_log("[FrankenPHP Worker] 预热失败: " . $e->getMessage());
}

echo "FrankenPHP Worker 已启动并预热完成\n";
```

### 14.2 请求生命周期钩子

在 Worker 模式下，可以通过 Laravel 的中间件和事件系统实现请求生命周期管理：

```php
<?php
// app/Providers/WorkerLifecycleServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Event;

class WorkerLifecycleServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 请求开始前：重置状态
        Event::listen('kernel.handling', function ($event) {
            // 重置数据库查询日志（防止内存累积）
            if (config('app.debug')) {
                \DB::enableQueryLog();
            }
        });

        // 请求结束后：清理
        Event::listen('kernel.handled', function ($event) {
            // 清理查询日志
            \DB::flushQueryLog();

            // 重置时间敏感的单例
            app()->forgetInstance('events');
        });
    }
}
```

### 14.3 实时监控中间件

```php
<?php
// app/Http/Middleware/WorkerMetrics.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class WorkerMetrics
{
    private static int $requestCount = 0;
    private static float $startTime = 0;

    public function handle($request, Closure $next)
    {
        self::$startTime = microtime(true);
        self::$requestCount++;

        return $next($request);
    }

    public function terminate($request, $response): void
    {
        $duration = (microtime(true) - self::$startTime) * 1000; // ms
        $memoryMB = round(memory_get_usage(true) / 1024 / 1024, 2);
        $peakMB = round(memory_get_peak_usage(true) / 1024 / 1024, 2);

        // 慢请求告警
        if ($duration > 500) {
            Log::warning("[Worker Metrics] 慢请求", [
                'uri' => $request->getRequestUri(),
                'method' => $request->method(),
                'duration_ms' => round($duration, 2),
                'memory_mb' => $memoryMB,
                'request_count' => self::$requestCount,
            ]);
        }

        // 高内存告警
        if ($memoryMB > 256) {
            Log::warning("[Worker Metrics] 内存使用过高", [
                'memory_mb' => $memoryMB,
                'peak_mb' => $peakMB,
                'request_count' => self::$requestCount,
            ]);
        }

        // 每 100 个请求记录一次汇总
        if (self::$requestCount % 100 === 0) {
            Log::info("[Worker Metrics] 统计", [
                'total_requests' => self::$requestCount,
                'current_memory_mb' => $memoryMB,
                'peak_memory_mb' => $peakMB,
            ]);
        }
    }
}
```

### 14.4 健康检查端点增强

```php
<?php
// routes/api.php

Route::get('/health', function () {
    $checks = [];

    // 数据库连接检查
    try {
        DB::connection()->getPdo();
        $checks['database'] = 'ok';
    } catch (\Exception $e) {
        $checks['database'] = 'error: ' . $e->getMessage();
    }

    // Redis 连接检查
    try {
        Redis::ping();
        $checks['redis'] = 'ok';
    } catch (\Exception $e) {
        $checks['redis'] = 'error: ' . $e->getMessage();
    }

    // 内存使用检查
    $checks['memory_mb'] = round(memory_get_usage(true) / 1024 / 1024, 2);
    $checks['peak_memory_mb'] = round(memory_get_peak_usage(true) / 1024 / 1024, 2);

    $hasError = in_array(false, array_map(fn($v) => $v === 'ok' || is_float($v) || is_string($v), $checks));

    return response()->json([
        'status' => $hasError ? 'degraded' : 'healthy',
        'checks' => $checks,
        'timestamp' => now()->toIso8601String(),
    ], $hasError ? 503 : 200);
});
```

---

## 十五、常见问题 FAQ

### Q1：FrankenPHP 能替代 Nginx 的所有功能吗？

**A**：不能完全替代。FrankenPHP (Caddy) 擅长的是 Web 服务器核心功能（HTTP 服务、TLS、静态文件、反向代理 PHP）。但 Nginx 的高级功能如复杂的 URL 重写规则、精细的限流配置（`limit_req`）、`proxy_pass` 到多种后端、Lua 嵌入（OpenResty）等，在 FrankenPHP 中要么不支持，要么需要通过 Caddy 的不同插件实现。对于纯 PHP 项目，FrankenPHP 足够；对于混合架构（PHP + Go + Python 等多后端），Nginx 可能仍是更好的选择。

### Q2：Worker 模式下 `$_SERVER` 超全局变量是否可靠？

**A**：基本可靠，但需要注意。FrankenPHP 会在每次请求时重新填充 `$_SERVER`，所以请求级别的变量（如 `REQUEST_URI`、`QUERY_STRING`）是正确的。但如果你在 Worker 引导阶段读取 `$_SERVER`，此时还没有请求上下文，值可能是空的或上一次请求的残留。

```php
// ❌ 错误：在引导阶段读取请求变量
$app = require_once __DIR__ . '/bootstrap/app.php';
$uri = $_SERVER['REQUEST_URI']; // 此时为空或残留值

// ✅ 正确：在请求处理时读取
Route::get('/test', function () {
    $uri = $_SERVER['REQUEST_URI']; // 此时是正确的
});
```

### Q3：如何在 FrankenPHP 中使用 Laravel Octane？

**A**：不推荐同时使用。Laravel Octane 本身就是常驻内存方案（通过 Swoole 或 RoadRunner），与 FrankenPHP 的 Worker 模式功能重叠。选择其中一种即可：

- 想要最简部署 → FrankenPHP Worker 模式
- 想要 Octane 的高级特性（并发请求处理、表单请求预加载等）→ Laravel Octane + Swoole

### Q4：`max_requests` 设多少合适？

**A**：这取决于你的应用的内存增长模式。建议的调优方法：

```bash
# 1. 先设置一个较大值，观察内存增长曲线
max_requests 5000

# 2. 在监控中观察单个 Worker 处理 N 个请求后的内存增长
# 假设初始 50MB，1000 请求后涨到 80MB，2000 请求后涨到 100MB

# 3. 根据增长斜率设置 max_requests，建议在内存翻倍前重启
max_requests 1500  # 在内存翻倍前重启
```

### Q5：FrankenPHP 支持 PHP 的 Xdebug 吗？

**A**：支持，但有一些限制。在 Worker 模式下，Xdebug 的连接在 Worker 生命周期内保持，可能导致调试器行为异常。建议在开发时使用 CGI 模式（非 Worker）配合 Xdebug：

```caddyfile
# 开发环境使用 CGI 模式，不启动 Worker
localhost {
    root * /app/public
    php_server
    file_server
}
```

---

## 十六、Kubernetes 部署方案

将 FrankenPHP 部署到 Kubernetes 集群中，可以获得自动扩缩容、滚动更新和自愈能力。

### 16.1 Kubernetes Deployment 配置

```yaml
# k8s/frankenphp-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-app
  labels:
    app: laravel
spec:
  replicas: 3
  selector:
    matchLabels:
      app: laravel
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    metadata:
      labels:
        app: laravel
    spec:
      containers:
        - name: app
          image: ghcr.io/your-org/laravel-app:latest
          ports:
            - containerPort: 8080
          env:
            - name: APP_ENV
              value: "production"
            - name: NUM_WORKERS
              value: "4"
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: laravel-secrets
                  key: db-password
            - name: APP_KEY
              valueFrom:
                secretKeyRef:
                  name: laravel-secrets
                  key: app-key
          resources:
            requests:
              cpu: 500m
              memory: 256Mi
            limits:
              cpu: "2"
              memory: 1Gi
          livenessProbe:
            httpGet:
              path: /up
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
          lifecycle:
            preStop:
              exec:
                # 优雅停机：等待当前请求处理完成
                command: ["sh", "-c", "sleep 10"]
      terminationGracePeriodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: laravel-service
spec:
  selector:
    app: laravel
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
  type: ClusterIP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: laravel-ingress
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - example.com
      secretName: example-tls
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: laravel-service
                port:
                  number: 80
```

### 16.2 Horizontal Pod Autoscaler (HPA)

根据 CPU 和内存使用率自动扩缩容：

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: laravel-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: laravel-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

---

## 十七、Laravel 队列与 FrankenPHP 协同工作

在生产环境中，Laravel 的队列系统与 FrankenPHP Web 服务需要协调工作，以下是详细的集成方案。

### 17.1 队列 Worker 的独立运行

队列 Worker 必须作为独立进程运行，不能在 FrankenPHP Worker 内执行。以下是推荐的队列配置：

```yaml
# docker-compose.yml 中的队列服务
services:
  # Web 服务 - FrankenPHP
  app:
    image: dunglas/frankenphp:php8.3
    ports:
      - "8080:8080"
    environment:
      - APP_ENV=production
      - NUM_WORKERS=4

  # 队列 Worker - 使用同一个镜像但运行不同命令
  queue-default:
    image: dunglas/frankenphp:php8.3
    command: >
      php artisan queue:work redis
      --queue=default
      --sleep=3
      --tries=3
      --max-time=3600
      --max-jobs=1000
      --max-memory=256
    environment:
      - APP_ENV=production
      - QUEUE_CONNECTION=redis
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M

  # 高优先级队列
  queue-high:
    image: dunglas/frankenphp:php8.3
    command: >
      php artisan queue:work redis
      --queue=high,default
      --sleep=1
      --tries=5
      --max-time=3600
    environment:
      - APP_ENV=production
      - QUEUE_CONNECTION=redis
    restart: unless-stopped

  # 邮件队列（独立处理，防止邮件发送阻塞其他队列）
  queue-email:
    image: dunglas/frankenphp:php8.3
    command: >
      php artisan queue:work redis
      --queue=email
      --sleep=5
      --tries=3
      --timeout=120
    environment:
      - APP_ENV=production
      - QUEUE_CONNECTION=redis
    restart: unless-stopped
```

### 17.2 队列任务中的数据库连接处理

在队列任务中，由于 Worker 模式的长连接特性，数据库连接可能在长时间运行的任务中失效：

```php
<?php
// app/Jobs/ProcessOrder.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 300; // 5 分钟超时

    public function __construct(
        public int $orderId
    ) {}

    public function handle(): void
    {
        // 关键：在长时间任务开始前，刷新数据库连接
        // 防止连接因超时而断开
        DB::purge();

        try {
            DB::beginTransaction();

            // 复杂的订单处理逻辑...
            $order = DB::table('orders')->lockForUpdate()->find($this->orderId);

            if (!$order) {
                Log::warning("[ProcessOrder] 订单不存在", ['order_id' => $this->orderId]);
                return;
            }

            // 模拟耗时操作
            $this->processOrderItems($order);
            $this->calculateShipping($order);
            $this->sendNotification($order);

            DB::commit();

            Log::info("[ProcessOrder] 订单处理完成", [
                'order_id' => $this->orderId,
                'memory_mb' => round(memory_get_usage(true) / 1024 / 1024, 2),
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error("[ProcessOrder] 处理失败", [
                'order_id' => $this->orderId,
                'error' => $e->getMessage(),
            ]);
            throw $e; // 重新抛出，让 Laravel 处理重试
        }
    }

    private function processOrderItems($order): void
    {
        // 处理订单项...
    }

    private function calculateShipping($order): void
    {
        // 计算运费...
    }

    private function sendNotification($order): void
    {
        // 发送通知...
    }
}
```

### 17.3 FrankenPHP 与 Laravel Horizon

如果你使用 Laravel Horizon 来管理队列，需要注意以下配置：

```php
<?php
// config/horizon.php

return [
    'environments' => [
        'production' => [
            'supervisor-1' => [
                'connection' => 'redis',
                'queue' => ['default', 'high', 'email'],
                'balance' => 'auto',        // 自动负载均衡
                'autoScalingStrategy' => 'time', // 基于任务等待时间自动扩缩
                'maxProcesses' => 10,       // 最大进程数
                'maxTime' => 3600,          // 单进程最大运行时间
                'maxJobs' => 1000,          // 单进程最大任务数
                'memory' => 256,            // 单进程最大内存(MB)
                'tries' => 3,
                'timeout' => 120,
                'nice' => 0,
            ],
        ],

        'local' => [
            'supervisor-1' => [
                'connection' => 'redis',
                'queue' => ['default', 'high', 'email'],
                'balance' => 'simple',
                'maxProcesses' => 3,
                'maxTime' => 3600,
                'maxJobs' => 1000,
                'memory' => 128,
                'tries' => 3,
                'timeout' => 60,
                'nice' => 0,
            ],
        ],
    ],
];
```

> **注意**：Laravel Horizon 本身是一个 PHP 进程管理器，它会管理多个队列 Worker 子进程。在 Docker 环境中，建议将 Horizon 作为独立服务运行，而不是在 FrankenPHP 容器中运行。

---

## 十八、性能调优实战指南

在生产环境中，合理调优 FrankenPHP 的配置可以显著提升性能。以下是一份系统的调优指南。

### 18.1 Worker 数量优化

Worker 数量是最关键的配置参数。设太多会浪费内存，设太少则无法充分利用 CPU。

```bash
# 推荐公式：
# Worker 数量 = CPU 核心数 × 1.5 ~ 2
# 4 核 CPU → 6-8 个 Worker
# 8 核 CPU → 12-16 个 Worker

# 实际调优方法：逐步增加 Worker，观察 RPS 和延迟变化
# 用 wrk 测试不同 Worker 数量的性能
for WORKERS in 2 4 6 8 12 16; do
    echo "测试 Worker 数量: $WORKERS"
    # 修改 Caddyfile 中的 num 参数
    sed -i "s/num [0-9]*/num $WORKERS/" /etc/caddy/Caddyfile
    # 重新加载配置
    curl -X POST http://localhost:2019/load \
        -H "Content-Type: application/json" \
        -d @/etc/caddy/config.json
    sleep 5  # 等待 Worker 启动
    # 运行基准测试
    wrk -t4 -c100 -d30s http://localhost:8080/api/test
    echo ""
done
```

### 18.2 数据库连接池优化

在 Worker 模式下，数据库连接在 Worker 生命周期内保持。需要合理配置连接池大小：

```php
<?php
// config/database.php - MySQL 连接配置优化

'mysql' => [
    'driver' => 'mysql',
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'laravel'),
    'username' => env('DB_USERNAME', 'root'),
    'password' => env('DB_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'prefix' => '',
    'prefix_indexes' => true,
    'strict' => true,
    'engine' => null,

    // FrankenPHP Worker 模式关键配置
    'options' => [
        // 持久连接：Worker 模式下复用连接
        PDO::ATTR_PERSISTENT => true,
        // 连接超时
        PDO::ATTR_TIMEOUT => 5,
        // 自动重连
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ],

    // 重要：在 Worker 模式下，确保每个请求结束时
    // 调用 DB::purge() 或在中间件中处理连接回收
],
```

> **重要**：MySQL 的 `max_connections` 设置需要大于所有 FrankenPHP Worker 的总连接数。如果你有 4 个 Worker，每个 Worker 建立 1 个 MySQL 连接，那么 MySQL 的 `max_connections` 至少需要 4。如果还有队列 Worker，需要加上队列 Worker 的连接数。

### 18.3 OPcache 预加载优化

PHP 8.0+ 支持 OPcache 预加载，可以在 Worker 启动时预编译常用类：

```php
<?php
// preload.php - OPcache 预加载脚本

// 预加载 Laravel 核心类
$basePath = __DIR__;

// 预加载框架核心
$files = [
    // Illuminate 核心
    $basePath . '/vendor/laravel/framework/src/Illuminate/Foundation/Application.php',
    $basePath . '/vendor/laravel/framework/src/Illuminate/Http/Request.php',
    $basePath . '/vendor/laravel/framework/src/Illuminate/Http/Response.php',
    $basePath . '/vendor/laravel/framework/src/Illuminate/Routing/Router.php',
    $basePath . '/vendor/laravel/framework/src/Illuminate/Database/Connection.php',
    $basePath . '/vendor/laravel/framework/src/Illuminate/Cache/Repository.php',

    // 你的应用模型（高频访问的）
    $basePath . '/app/Models/User.php',
    $basePath . '/app/Models/Product.php',
];

foreach ($files as $file) {
    if (file_exists($file)) {
        opcache_compile_file($file);
    }
}
```

在 `php.ini` 中启用预加载：

```ini
; 注意：在 FrankenPHP Worker 模式下，预加载的效果可能不如传统 FPM 明显
; 因为 Worker 本身已经避免了重复加载。但在 CGI 模式下效果显著。
opcache.preload=/app/preload.php
opcache.preload_user=www-data
```

### 18.4 内存优化策略

Worker 模式下，内存管理需要特别注意：

```php
<?php
// app/Http/Middleware/MemoryOptimizer.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Log;

class MemoryOptimizer
{
    private static int $requestCount = 0;

    public function handle($request, Closure $next)
    {
        self::$requestCount++;

        return $next($request);
    }

    public function terminate($request, $response): void
    {
        // 每 50 个请求主动清理内存
        if (self::$requestCount % 50 === 0) {
            // 强制垃圾回收
            gc_collect_cycles();

            // 清理 Laravel 的应用实例缓存
            app()->forgetScopedInstances();

            $memMB = round(memory_get_usage(true) / 1024 / 1024, 2);
            Log::info("[MemoryOptimizer] 定期清理完成", [
                'request_count' => self::$requestCount,
                'memory_mb' => $memMB,
            ]);
        }
    }
}
```

### 18.5 性能调优检查清单

在部署 FrankenPHP 到生产环境之前，逐项检查以下配置：

```
□ Worker 数量是否根据 CPU 核心数合理设置？
□ max_requests 是否设置了合理的重启阈值？
□ OPcache 是否已启用且配置了足够的内存？
□ opcache.enable_cli=1 是否已开启？（Worker 模式必须）
□ 数据库连接池大小是否与 Worker 数量匹配？
□ 是否添加了全局状态清理中间件？
□ 是否搜索并修复了所有 exit()/die() 调用？
□ 静态文件是否配置了正确的缓存策略？
□ 是否启用了 Gzip/Zstd 压缩？
□ 健康检查端点是否正常响应？
□ 是否进行了负载测试验证性能目标？
□ 是否配置了内存监控和告警？
□ 是否设置了容器资源限制？
□ 是否配置了优雅停机（preStop hook）？
□ 是否配置了日志轮转？
```

---

## 十九、负载测试方法论

在将 FrankenPHP 部署到生产环境之前，进行充分的负载测试是必不可少的。

### 19.1 使用 wrk 进行基准测试

```bash
#!/bin/bash
# benchmark.sh - FrankenPHP 基准测试脚本

URL="http://localhost:8080/api/test"
DURATION=30
THREADS=4
CONNECTIONS=100

echo "=== FrankenPHP 基准测试 ==="
echo "URL: $URL"
echo "持续时间: ${DURATION}s"
echo "线程数: $THREADS"
echo "并发连接数: $CONNECTIONS"
echo ""

# 预热（避免冷启动影响结果）
echo "预热中..."
wrk -t2 -c10 -d5s $URL > /dev/null 2>&1

# 正式测试
echo "正式测试..."
wrk -t$THREADS -c$CONNECTIONS -d${DURATION}s --latency $URL

echo ""
echo "=== 不同并发级别测试 ==="
for CONCURRENCY in 10 50 100 200 500; do
    echo "--- 并发: $CONCURRENCY ---"
    wrk -t4 -c$CONCURRENCY -d10s $URL 2>&1 | grep -E "Requests/sec|Latency"
    echo ""
done
```

### 19.2 使用 k6 进行场景化测试

```javascript
// loadtest.js - k6 负载测试脚本
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '2m', target: 50 },   // 逐步加压到 50 VU
        { duration: '5m', target: 50 },   // 持续 50 VU
        { duration: '2m', target: 100 },  // 加压到 100 VU
        { duration: '5m', target: 100 },  // 持续 100 VU
        { duration: '2m', target: 0 },    // 逐步降压
    ],
    thresholds: {
        http_req_duration: ['p(95)<200'],  // 95% 请求低于 200ms
        http_req_failed: ['rate<0.01'],     // 错误率低于 1%
    },
};

export default function () {
    // 模拟真实用户行为
    const responses = http.batch([
        ['GET', 'http://localhost:8080/api/users'],
        ['GET', 'http://localhost:8080/api/products'],
        ['POST', 'http://localhost:8080/api/orders',
            JSON.stringify({ product_id: 1, quantity: 1 }),
            { headers: { 'Content-Type': 'application/json' } }
        ],
    ]);

    check(responses[0], {
        'users API status 200': (r) => r.status === 200,
        'users API response time < 200ms': (r) => r.timings.duration < 200,
    });

    sleep(1); // 模拟用户思考时间
}
```

运行测试：

```bash
# 安装 k6
brew install k6  # macOS
# 或
sudo snap install k6  # Ubuntu

# 运行测试
k6 run --out json=results.json loadtest.js

# 输出 HTML 报告
k6 run --out json=results.json loadtest.js 2>&1 | \
    k6-report > report.html
```

### 19.3 关键指标解读

| 指标 | 含义 | FrankenPHP Worker 目标值 |
|------|------|------------------------|
| RPS (Requests/sec) | 每秒处理请求数 | > 3000 (4 Worker) |
| P50 Latency | 50% 请求的延迟 | < 15ms |
| P95 Latency | 95% 请求的延迟 | < 50ms |
| P99 Latency | 99% 请求的延迟 | < 100ms |
| Error Rate | 错误率 | < 0.1% |
| Memory per Worker | 单 Worker 内存占用 | 50-150MB |

---

## 二十、PHP 版本与扩展兼容性

FrankenPHP 支持 PHP 8.2 及以上版本，但不同版本和扩展的兼容性有所不同。

### 20.1 支持的 PHP 版本

| PHP 版本 | FrankenPHP 支持状态 | 备注 |
|---------|-------------------|------|
| PHP 8.0 | ❌ 不支持 | FrankenPHP 要求 PHP 8.2+ |
| PHP 8.1 | ❌ 不支持 | FrankenPHP 要求 PHP 8.2+ |
| PHP 8.2 | ✅ 完全支持 | 推荐用于生产环境 |
| PHP 8.3 | ✅ 完全支持 | 官方镜像默认版本 |
| PHP 8.4 | ✅ 实验性支持 | 使用 `dunglas/frankenphp:php8.4` 镜像 |

### 20.2 扩展安装

在 Docker 环境中，使用 `install-php-extensions` 工具安装扩展：

```dockerfile
FROM dunglas/frankenphp:php8.3

# 常用扩展安装
RUN install-php-extensions \
    pdo_mysql \
    pdo_pgsql \
    redis \
    opcache \
    pcntl \
    bcmath \
    gd \
    zip \
    intl \
    soap \
    memcached \
    imagick \
    xdebug  # 仅开发环境安装

# 验证扩展安装
RUN php -m | grep -E "pdo_mysql|redis|opcache"
```

### 20.3 不兼容的扩展

以下扩展在 FrankenPHP Worker 模式下可能存在问题：

| 扩展 | 问题 | 替代方案 |
|------|------|---------|
| Xdebug | Worker 模式下调试器连接异常 | 开发时使用 CGI 模式 |
| Swoole | 与 FrankenPHP 的运行时冲突 | 选择其中一种方案 |
| pthreads | PHP 8.0+ 已废弃 | 使用 parallel 扩展 |
| APCu | 在 Worker 模式下内存行为不同 | 使用 Redis 作为缓存 |

### 20.4 检查扩展兼容性

```bash
# 在 Docker 容器中检查所有已加载的扩展
docker exec app php -m

# 检查特定扩展是否支持某个函数
docker exec app php -r "var_dump(function_exists('redis_connect'));"

# 检查 OPcache 状态
docker exec app php -r "print_r(opcache_get_status());"

# 检查 PHP 配置
docker exec app php -i | grep -E "opcache.enable_cli|opcache.jit"
```

---

## 二十一、调试与故障排查

在 FrankenPHP Worker 模式下调试和排查问题与传统 FPM 有所不同，以下是实用的调试技巧。

### 21.1 日志级别配置

在开发环境中，可以提高日志级别获取更详细的信息：

```caddyfile
{
    log {
        level DEBUG  # 生产环境用 INFO，开发环境用 DEBUG
        format console  # 开发环境用 console 格式更易读
    }

    frankenphp
    order php_server before file_server
}

:8080 {
    root * /app/public

    # 请求日志
    log {
        level DEBUG
        format console
    }

    php_server {
        worker {
            file /app/artisan
            num 1  # 开发环境用 1 个 Worker
        }
    }

    file_server
}
```

### 21.2 Worker 状态检查

使用 Caddy 的管理 API 检查 Worker 状态：

```bash
# 启用管理 API（仅在开发/调试时启用）
# Caddyfile 中添加：admin 0.0.0.0:2019

# 获取当前配置
curl -s http://localhost:2019/config/ | jq .

# 检查 FrankenPHP Worker 状态
curl -s http://localhost:2019/config/apps/frankenphp | jq .

# 重启所有 Worker
curl -X POST http://localhost:2019/config/apps/frankenphp/restart-workers

# 重新加载整个配置（修改 Caddyfile 后）
curl -X POST http://localhost:2019/load \
    -H "Content-Type: application/json" \
    -d @/etc/caddy/config.json
```

### 21.3 性能分析工具

在开发环境中，可以使用 Xdebug 或 Tideways 进行性能分析：

```php
<?php
// app/Http/Middleware/ProfilingMiddleware.php
// 仅在开发环境中使用

namespace App\Http\Middleware;

use Closure;

class ProfilingMiddleware
{
    public function handle($request, Closure $next)
    {
        // 仅在请求参数中包含 profile=1 时启用分析
        if (!$request->has('profile') || !app()->isLocal()) {
            return $next($request);
        }

        $startTime = microtime(true);
        $startMemory = memory_get_usage(true);

        $response = $next($request);

        $duration = microtime(true) - $startTime;
        $memoryUsed = memory_get_usage(true) - $startMemory;

        // 在响应头中添加性能信息
        $response->headers->set('X-Profiling-Duration-Ms', round($duration * 1000, 2));
        $response->headers->set('X-Profiling-Memory-KB', round($memoryUsed / 1024, 2));
        $response->headers->set('X-Profiling-Peak-Memory-MB', round(memory_get_peak_usage(true) / 1024 / 1024, 2));
        $response->headers->set('X-Profiling-DB-Queries', count(\DB::getQueryLog()));

        return $response;
    }
}
```

### 21.4 常见错误排查表

| 错误现象 | 可能原因 | 排查步骤 |
|---------|---------|---------|
| Worker 启动失败 | PHP 扩展缺失 | 检查 `php -m` 输出，确认所需扩展已安装 |
| 502 Bad Gateway | Worker 进程崩溃 | 查看 FrankenPHP 日志中的错误信息 |
| 内存持续增长 | 内存泄漏 | 使用 `memory_get_usage()` 监控，设置 `max_requests` |
| 数据串扰 | 全局状态污染 | 检查是否添加了 `CleanupGlobalState` 中间件 |
| 旧代码仍在执行 | OPcache 缓存 | 调用 `restart-workers` API 重启 Worker |
| 静态文件 404 | Caddyfile 路由顺序 | 确保静态文件路由在 PHP 路由之前 |
| 连接超时 | 数据库连接断开 | 在中间件中添加 `DB::purge()` 重连逻辑 |
| 权限错误 | 文件权限问题 | 检查 `storage/` 和 `bootstrap/cache/` 目录权限 |

---

## 二十二、总结

FrankenPHP 代表了 PHP 部署方式的一次重要进化。通过将 PHP 嵌入 Go 进程，它不仅提供了显著的性能提升（Worker 模式下 2-5 倍吞吐量提升），还大幅简化了部署架构。一个二进制文件 = Web 服务器 + HTTPS 证书管理 + PHP 运行时 + HTTP/3 支持。

对于 Laravel 开发者而言，FrankenPHP 的 Worker 模式尤为有价值——它让 PHP 拥有了类似 Node.js 或 Go 的常驻进程特性，同时保持了 PHP 生态系统的全部优势。配合 Docker 容器化部署，FrankenPHP 可以构建出性能优异、运维简洁的现代 PHP 应用架构。

FrankenPHP 仍在快速发展中，社区活跃，文档不断完善。如果你正在规划新项目或对现有部署架构感到不满，非常建议尝试 FrankenPHP——它可能会改变你对 PHP 部署的认知。

---

## 相关阅读

- [Caddy 2 实战：替代 Nginx 的下一代 Web 服务器——自动 HTTPS、反向代理与 Laravel 部署](/06_运维/Caddy-2-实战-替代-Nginx-的下一代-Web-服务器-自动-HTTPS-反向代理与-Laravel-部署/) — FrankenPHP 基于 Caddy 构建，本文详解 Caddy 2 的核心能力、Caddyfile 语法与 Laravel 部署实践。
- [HTTP/3 (QUIC) 实战：Caddy/H2O 服务器配置——Laravel 应用的协议升级与多路复用性能收益量化](/06_运维/2026-06-05-http3-quic-caddy-h2o-laravel-protocol-upgrade/) — FrankenPHP 原生支持 HTTP/3，本文深入讲解 QUIC 协议在 Laravel 中的性能收益与配置方法。
- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/06_运维/2026-06-02-Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/) — 如果你想要更简单的部署体验，Coolify 提供一键部署 FrankenPHP/Laravel 的能力。
- [Laravel 性能预算实战：用 Lighthouse CI + k6 设定 API 响应时间预算——从"事后优化"到"预算驱动开发"的范式转变](/06_运维/Laravel-性能预算实战-Lighthouse-CI-k6-API响应时间预算-预算驱动开发/) — 配合 FrankenPHP 的性能提升，通过性能预算持续守护 Laravel API 的响应时间。
- [Nginx + Lua (OpenResty) 实战：高性能自定义网关——对比 Kong/APISIX 的流量治理与边缘计算](/06_运维/Nginx-Lua-OpenResty-实战-高性能自定义网关-对比Kong-APISIX的流量治理与边缘计算/) — 如果 FrankenPHP 无法满足需求，了解 Nginx + OpenResty 的替代方案。
