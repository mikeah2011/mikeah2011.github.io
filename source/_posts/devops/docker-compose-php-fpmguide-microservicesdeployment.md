---
title: Docker Compose + PHP-FPM 实战：KKday B2C API 微服务部署经验
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-02
categories:
  - devops
  - docker
tags: [Docker, PHP, PHP-FPM, Docker Compose, 微服务, DevOps, Laravel, 容器化]
keywords: [Docker Compose, PHP, FPM, KKday B2C API, 微服务部署经验, DevOps]
description: 基于 KKday B2C API 真实项目的 Docker Compose + PHP-FPM 微服务部署实战指南。涵盖 Dockerfile 多阶段构建、健康检查与启动顺序配置、PHP-FPM 内存泄漏排查与 OPcache 调优、Composer 缓存污染治理等踩坑经验，适合 PHP 开发者掌握企业级 Docker 微服务部署全流程。



---

# Docker Compose + PHP-FPM 实战：KKday B2C API 微服务部署经验

## 📌 前言

在 KKday B2C API 项目中，我们采用 **Docker Compose + PHP-FPM-8.0** 作为基础运行环境。本文将基于真实踩坑记录，分享微服务部署的完整实战经验。

> 💡 **关键词**：`PHP 8.0` `Laravel BFF` `Docker Compose` `PHP-FPM` `微服务部署`

---

## 🔍 架构选型对比

### 传统单体 vs 微服务

```
┌─────────────────────────────────────────────────────────────┐
│                    传统单体应用                               │
├─────────────────────────────────────────────────────────────┤
│  app: php-fpm-8.0 (单一容器，所有业务逻辑)                   │
│  db: MySQL/MariaDB                                          │
│  cache: Redis                                                │
│  queue: RabbitMQ/SQS                                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     微服务架构                                │
├─────────────────────────────────────────────────────────────┤
│  api-gateway: Nginx/Envoy                                   │
│  ─────────────────────────────────────────────────         │
│  service-a: php-fpm-8.0 (订单)                               │
│  service-b: php-fpm-8.0 (用户)                               │
│  service-c: python-fastapi (支付)                            │
│  db-sharding: MySQL Cluster                                  │
│  cache-cluster: Redis Cluster                                │
└─────────────────────────────────────────────────────────────┘
```

### Laravel BFF 中间层选择

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **PHP-FPM + Docker** | 生态完善、Laravel 原生支持 | 语言绑定强、需编译扩展 | ✅ **KKday 主选方案** |
| Node.js + Express | 前端技术栈统一、非阻塞 I/O | PHP 业务迁移成本高 | 前后端同团队 |
| Python FastAPI | 数据科学友好、AI 集成方便 | Laravel 生态差异大 | AI 特色服务 |

---

## 💡 为什么选择 Docker Compose + PHP-FPM

在 KKday B2C 项目的实际选型过程中，我们团队对比了多种部署方案，最终选择了 Docker Compose + PHP-FPM 的组合。核心原因如下：

**第一，团队技术栈统一。** 我们的后端团队以 PHP/Laravel 为主力开发语言，PHP-FPM 是最成熟的 PHP 进程管理器，能够保证与现有代码库的完全兼容。相比迁移到 Go 或 Rust 等语言带来的重写成本，PHP-FPM 方案的落地风险最低。

**第二，Docker Compose 学习曲线平缓。** 相比 Kubernetes 需要掌握 Pod、Service、Ingress、ConfigMap 等大量抽象概念，Docker Compose 只需要一个 YAML 文件即可完成多容器编排。对于初期团队规模在 5-10 人的 B2C 项目来说，这套方案的运维复杂度完全可控。

**第三，开发与生产环境一致性。** 通过 Docker Compose，开发者本地 `docker compose up` 即可启动完整的开发环境，与线上生产环境的容器镜像保持一致，极大减少了"本地能跑线上挂"的经典问题。我们甚至将数据库初始化脚本、Redis 配置、Nginx 反向代理规则全部纳入 Compose 编排，确保每个开发者的环境完全一致。

### 我们的技术栈全景

在 KKday B2C API 中，完整的容器化技术栈包括：

```
┌──────────────────────────────────────────────────────────────┐
│                      KKday B2C 技术栈全景                      │
├──────────────────────────────────────────────────────────────┤
│  前端层    │  Next.js (SSR) / Flutter (移动端)                  │
│  网关层    │  Nginx (反向代理/限流/SSL 终止)                     │
│  应用层    │  Laravel 8.x + PHP 8.0 FPM                        │
│  任务队列  │  Laravel Horizon + Redis                           │
│  缓存层    │  Redis 7 (Session/Cache/Queue)                     │
│  数据层    │  MySQL 8.0 (主从) + Elasticsearch 7.x              │
│  存储层    │  MinIO (S3 兼容) / Azure Blob Storage               │
│  监控层    │  Prometheus + Grafana + Sentry                      │
│  CI/CD    │  GitHub Actions + Docker Registry                   │
└──────────────────────────────────────────────────────────────┘
```

这套方案在我们上线初期支撑了日均 50 万次 API 请求，单节点 PHP-FPM 容器的 QPS 稳定在 800-1200 之间，完全满足了业务需求。当流量增长到日均 200 万次请求时，我们才开始考虑横向扩容方案。

---

## 🔧 微服务拆分策略与实践

在 KKday B2C 项目中，微服务的拆分并非一步到位，而是经历了一个渐进式的演进过程。最初的单体 Laravel 应用承载了所有业务逻辑，包括订单管理、用户认证、支付处理、商品搜索、营销活动等模块。随着业务规模的增长，单体应用的部署频率和故障隔离能力逐渐成为瓶颈。

### 第一步：按业务域拆分（Domain-Driven Design）

我们首先按照领域驱动设计（DDD）的原则，将单体应用拆分为四个核心微服务：

```yaml
services:
  # 订单服务 - 处理所有订单相关的业务逻辑
  order-service:
    build: ./services/order
    environment:
      - SERVICE_NAME=order
      - DB_CONNECTION=mysql
      - DB_HOST=order-db
    networks:
      - service-mesh

  # 用户认证服务 - 管理用户注册、登录、权限
  auth-service:
    build: ./services/auth
    environment:
      - SERVICE_NAME=auth
      - JWT_SECRET=${JWT_SECRET}
      - REDIS_HOST=redis
    networks:
      - service-mesh

  # 支付网关服务 - 对接第三方支付渠道
  payment-service:
    build: ./services/payment
    environment:
      - SERVICE_NAME=payment
      - PAYMENT_GATEWAY=${PAYMENT_GATEWAY}
      - WEBHOOK_SECRET=${WEBHOOK_SECRET}
    networks:
      - service-mesh

  # 商品搜索服务 - 基于 Elasticsearch 的商品检索
  search-service:
    build: ./services/search
    environment:
      - SERVICE_NAME=search
      - ES_HOST=elasticsearch
    networks:
      - service-mesh
```

### 第二步：服务间通信方式选择

微服务之间的通信方式直接影响系统的可靠性和性能。我们最终选择了 HTTP REST API + Redis 队列的混合方案：

| 通信方式 | 适用场景 | 优点 | 缺点 |
|---------|---------|------|------|
| 同步 HTTP REST | 用户认证、商品查询 | 实时响应、简单直接 | 阻塞式调用、级联故障风险 |
| Redis 队列 (Horizon) | 订单处理、邮件发送 | 异步解耦、削峰填谷 | 延迟不可控、调试困难 |
| 事件驱动 (Redis Pub/Sub) | 库存变更通知 | 广播式通知、扩展性好 | 消息丢失风险、无重试机制 |

> 💡 **踩坑经验**：在初期我们尝试了 gRPC 作为服务间通信方式，但发现 PHP 生态对 gRPC 的支持不够成熟，编译 protobuf 扩展经常在 Docker 构建时失败。最终我们回归了更稳定的 HTTP REST API 方案，配合 Laravel HTTP Client 的连接池复用，性能损失控制在 5% 以内。另外一个容易被忽略的问题是服务间的超时设置，默认的 PHP-FPM 超时时间为 60 秒，对于长时间运行的异步任务来说可能不够用，建议根据业务场景适当调整。

### 第三步：共享库提取与包管理

为了避免微服务之间出现重复代码，我们使用 Composer Path Repository 将公共逻辑提取为独立包：

```json
// composer.json（各微服务）
{
    "repositories": [
        {
            "type": "path",
            "url": "../packages/*",
            "options": {
                "symlink": true
            }
        }
    ],
    "require": {
        "kkday/shared-auth": "^2.0",
        "kkday/shared-logger": "^1.5",
        "kkday/shared-validation": "^1.0"
    }
}
```

这种方式的优势在于：
1. **本地开发时自动软链接**，无需每次都发布到私有包仓库
2. **生产环境可切换为版本号**，确保各服务使用稳定的共享库版本
3. **统一依赖版本**，避免不同服务依赖同一库的不同版本导致兼容性问题

---

## 🛠️ Docker Compose 实战配置

### 基础 compose.yaml 模板

```yaml
version: '3.8'

services:
  # === Nginx (反向代理/静态资源) ===
  web:
    image: nginx:alpine
    container_name: api-gateway-01
    restart: always
    ports:
      - "8080:80"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./storage/logs/nginx:/var/log/nginx
      - ./public:/usr/share/nginx/html:ro
    depends_on:
      - api
    networks:
      - app

  # === Laravel API (PHP-FPM) ===
  api:
    build:
      context: ./app
      dockerfile: Dockerfile
      args:
        APP_ENV: production
        APP_DEBUG: false
    container_name: kkday-api-01
    restart: always
    volumes:
      - ./app/storage/logs:/var/log/www-data
      - ./app/storage/cache:/var/cache/app
    environment:
      - APP_ENV=production
      - APP_DEBUG=false
      - PHP_VERSION=8.0.30
    ports:
      - "9001:9000"  # XHPP监听端口
    networks:
      - app
    depends_on:
      - db
      - redis
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 512M

  # === MySQL (主数据库) ===
  db:
    image: mysql:8.0
    container_name: kkday-mysql-01
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_SECRET}
    ports:
      - "3306:3306"
    volumes:
      - db_data:/var/lib/mysql
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  # === Redis (缓存/队列) ===
  redis:
    image: redis:7-alpine
    container_name: kkday-redis-01
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  # === PHP Adminer (管理界面) ===
  adminer:
    image: adminer:4.8
    container_name: kkday-adminer-01
    restart: always
    ports:
      - "8081:8080"
    environment:
      - ADMINER_DEFAULT_SERVER=mysql=${DB_HOST}

networks:
  app:
    driver: bridge

volumes:
  db_data:
  redis_data:
```

### Dockerfile 最佳实践

```dockerfile
# === 基础镜像选择 ===
FROM php:8.0-fpm

# === 1. 设置环境变量 ===
ENV DEBIAN_FRONTEND=noninteractive
ENV APP_ENV=production

# === 2. 升级系统包 ===
RUN apt-get update && apt-get install -y \
    git\
    libpng-dev\
    libonig-dev\
    libxml2-dev\
    libzip-dev\
    zip\
    unzip\
    curl\
    wget

# === 3. PHP 扩展编译 ===
RUN docker-php-ext-install \
    pdo_mysql\
    bcmath\
    calendar\
    mbstring\
    soap\
    xml\
    intl

# === 4. Composer 安装 ===
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# === 5. Laravel 项目依赖 ===
WORKDIR /var/www/html
COPY composer.* ./
RUN composer install --no-dev --optimize-autoloader --classmap-authoritative

# === 6. Artisan 优化命令 ===
RUN chmod -R 775 storage bootstrap/cache && \
    php artisan config:cache && \
    php artisan route:cache && \
    php artisan view:cache

# === 7. 设置 PHP-FPM 环境变量 ===
ENV APP_DEBUG=false APP_ENV=production

EXPOSE 9000

CMD ["php-fpm"]
```

### 多阶段构建优化（Multi-stage Build）

在实际生产环境中，我们采用了多阶段构建策略来显著减小最终镜像体积。原始的单阶段构建镜像体积约为 1.2GB，而多阶段构建后缩小到约 380MB，镜像拉取速度提升了近 3 倍。

```dockerfile
# === 阶段一：安装依赖（构建阶段） ===
FROM php:8.0-fpm AS builder

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git \
    libpng-dev \
    libonig-dev \
    libxml2-dev \
    libzip-dev \
    zip \
    unzip \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install pdo_mysql bcmath mbstring opcache intl xml

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html
COPY composer.* ./
RUN composer install --no-dev --optimize-autoloader --classmap-authoritative

# === 阶段二：运行时镜像（精简） ===
FROM php:8.0-fpm AS production

# 仅复制构建产物
COPY --from=builder /usr/local/lib/php/extensions/ /usr/local/lib/php/extensions/
COPY --from=builder /usr/local/etc/php/ /usr/local/etc/php/
COPY --from=builder /var/www/html/vendor/ /var/www/html/vendor/
COPY . /var/www/html

WORKDIR /var/www/html
RUN chmod -R 775 storage bootstrap/cache \
    && php artisan config:cache \
    && php artisan route:cache \
    && php artisan view:cache

EXPOSE 9000
CMD ["php-fpm"]
```

> 💡 **踩坑提醒**：多阶段构建中，`COPY --from=builder` 只能复制构建产物，不能复制 `apt-get install` 安装的系统包。如果运行时还需要某些系统库（如 `libzip`），必须在最终阶段重新安装。

### 健康检查端点实现（Laravel 路由）

Docker Compose 的 `healthcheck` 需要一个可访问的 HTTP 端点。在 Laravel 中，推荐在 `routes/api.php` 中添加如下健康检查路由：

```php
// routes/api.php
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

Route::get('/health', function () {
    $checks = [];

    // 数据库连接检测
    try {
        DB::connection()->getPdo();
        $checks['database'] = 'ok';
    } catch (Exception $e) {
        $checks['database'] = 'error: ' . $e->getMessage();
    }

    // Redis 连接检测
    try {
        Redis::ping();
        $checks['redis'] = 'ok';
    } catch (Exception $e) {
        $checks['redis'] = 'error: ' . $e->getMessage();
    }

    // 磁盘空间检测
    $freeSpace = disk_free_space('/');
    $checks['disk_free_mb'] = round($freeSpace / 1024 / 1024);

    $status = collect($checks)->every(fn($v) => $v === 'ok' || is_numeric($v));

    return response()->json([
        'status'  => $status ? 'healthy' : 'degraded',
        'checks'  => $checks,
        'version' => config('app.version', 'unknown'),
    ], $status ? 200 : 503);
});
```

### Nginx 反向代理配置（连接 PHP-FPM）

Nginx 与 PHP-FPM 容器之间的通信是部署中的关键环节。以下是我们经过线上验证的 Nginx 配置，包含了超时控制、缓冲区设置和静态资源缓存策略：

```nginx
server {
    listen 80;
    server_name api.kkday.example.com;

    # 静态资源缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff2)$ {
        root /usr/share/nginx/html/public;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Laravel 路由请求转发给 PHP-FPM
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass api:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;

        # 超时设置
        fastcgi_read_timeout 60;
        fastcgi_send_timeout 60;
        fastcgi_connect_timeout 10;

        # 缓冲区设置
        fastcgi_buffer_size 128k;
        fastcgi_buffers 4 256k;
        fastcgi_busy_buffers_size 256k;
    }

    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
    }
}
```

---

## ⚠️ 真实踩坑记录与解决方案

在生产环境中部署 PHP-FPM 微服务，总会遇到各种意想不到的问题。以下是我们团队在 KKday 项目中遇到的四个高频踩坑场景，每个都附有完整的排查思路和解决方案。

### 🐛 问题 1：服务启动顺序导致的数据库连接失败

#### ❌ Before（错误配置）

```yaml
services:
  api:
    # 没有 healthcheck 和 depends_on
    ports:
      - "9001:9000"
    
  db:
    volumes:
      - db_data:/var/lib/mysql
    
volumes:
  db_data:
```

#### ✅ After（正确配置）

```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    
  db:
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  db_data:
    driver: local
```

**踩坑点总结：**

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| MySQL 初始化失败 | 服务未完全启动就连接 | `healthcheck` + `condition: service_healthy` |
| Redis ACL 拒绝连接 | 容器外权限配置错误 | 修改 docker-entrypoint-initdb.d/脚本或重启 |

---

### 🐛 问题 2：PHP-FPM 内存泄漏与 OOM 崩溃

#### ❌ Before（无优化配置）

```dockerfile
FROM php:8.0-fpm
# 无内存限制，频繁重启
```

#### ✅ After（生产环境优化）

```dockerfile
# 设置 PHP 内存限制
ENV PHP_MEMORY_LIMIT=256M
ENV OPcache.enable=1
ENV OPcache.memory_consumption=256
ENV OPcache.max_accelerated_files=40000

RUN apt-get update && apt-get install -y \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# 自定义 supervisor.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
```

**supervisor.conf 配置：**

```ini
[program:php-fpm]
command=php-fpm
user=www-data
autostart=true
autorestart=true
stderr_logfile=/var/log/php-fpm.err.log
stdout_logfile=/var/log/php-fpm.out.log
numprocs=2          # 启动 2 个 worker

[program:supervisor]
command=supervisord -c /etc/supervisor/conf.d/supervisord.conf
user=root
autostart=true
autorestart=true
```

**生产环境监控：**

```bash
# 1. 监控内存使用
watch -n 5 'docker stats kkday-api-01 --no-stream | head -n1'

# 2. 查看 PHP-FPM 错误日志
tail -f /var/log/php-fpm.err.log

# 3. OPcache 分析
php artisan tinker
>>> var_dump(OPcache_get_status());
```

---

### 🐛 问题 3：Composer 缓存污染导致版本不一致

#### ❌ Before（无优化）

```yaml
api:
  volumes:
    - ./vendor:/var/www/html/vendor
    # 未清理 vendor 目录
```

#### ✅ After（推荐配置）

```yaml
api:
  build:
    context: ./app
    dockerfile: Dockerfile
    args:
      APP_ENV: production
  
  volumes:
    # 只挂载必要目录
    - ./storage/logs:/var/log/www-data:ro
    - ./public:/usr/share/nginx/html:ro
    # vendor/和bootstrap/cache/不挂载，使用容器内缓存
    
  environment:
    - COMPOSER_MEMORY_LIMIT=-1
```

**Dockerfile 中清理缓存：**

```dockerfile
# 构建阶段：安装依赖
RUN composer install --no-dev \
    && composer dump-autoload --strict --optimize \
    && rm -rf /var/cache/apk/* \
    && apt-get clean

# 运行时：保留必要数据
VOLUME ["/var/log/www-data"]
```

---

### 🐛 问题 4：PHP 8.0 与 PHP 8.1 版本不兼容

#### ❌ Before（硬编码版本）

```yaml
api:
  build:
    context: ./app
    dockerfile: Dockerfile
    
# Dockerfile 中固定版本
RUN apt-get update && apt-get install -y \
    php8.0-fpm \
    php8.0-cli \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2...
```

#### ✅ After（动态版本管理）

```yaml
api:
  build:
    context: ./app
    dockerfile: Dockerfile
    args:
      PHP_VERSION: "8.0"   # 可配置，默认 8.0
      EXTENSIONS: "mbstring pdo_mysql opcache intl"
```

**Dockerfile 版本管理：**

```dockerfile
ARG PHP_VERSION=8.0

FROM php:${PHP_VERSION}-fpm

# 检查依赖
RUN dpkg -l | grep "${PHP_VERSION}" || { \
    echo "PHP ${PHP_VERSION} 未找到，切换到最新版"; \
    apt-get update && apt-get install -y php-fpm \
    && rm -rf /var/lib/apt/lists/* \
    && exit 0 \
}

# 安装扩展
RUN docker-php-ext-install pdo_mysql mbstring opcache intl
```

---

### 🐛 问题 5：容器间 DNS 解析失败导致服务无法通信

#### 现象描述

在微服务架构中，经常遇到一个容器无法通过服务名访问另一个容器的情况。例如，API 容器尝试连接 `db:3306` 时提示 `Could not resolve host: db`。这个问题在开发环境中尤为常见，通常是因为 Docker Compose 的网络配置不正确。

#### 排查步骤

```bash
# 1. 检查容器是否在同一网络中
docker network inspect <network_name> | grep -A5 "Containers"

# 2. 进入容器测试 DNS 解析
docker compose exec api nslookup db
docker compose exec api ping db

# 3. 检查容器的 /etc/hosts 文件
docker compose exec api cat /etc/hosts

# 4. 查看 Docker 网络列表
docker network ls | grep <project_name>
```

#### 根因分析与解决方案

最常见的原因是服务名拼写错误或网络配置遗漏。在 Docker Compose 中，同一 `services` 下的容器默认共享一个网络，可以通过服务名互相访问。但如果手动指定了 `networks`，则只有在同一网络中的容器才能互相通信。

**最佳实践**：建议在 `docker-compose.yaml` 中显式定义网络，避免使用默认网络。同时，确保所有需要互相通信的服务都加入了同一个自定义网络。此外，可以在 `api` 容器的 `/etc/hosts` 中添加静态解析条目，作为 DNS 解析失败时的备用方案：

```yaml
services:
  api:
    extra_hosts:
      - "db:172.20.0.3"   # 静态 IP 作为备用
      - "redis:172.20.0.4"
    networks:
      - backend

  db:
    networks:
      backend:
        ipv4_address: 172.20.0.3

  redis:
    networks:
      backend:
        ipv4_address: 172.20.0.4

networks:
  backend:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/24
```

---

## 🔍 常见 Docker 构建问题排查指南

在容器化部署过程中，Docker 构建阶段是问题最高发的环节。以下是我们在 KKday 项目中总结的常见构建错误及其排查方法：

### 问题：Docker 镜像构建缓慢

**现象**：每次执行 `docker build` 都需要重新安装所有依赖，耗时超过 10 分钟。

**根因分析**：Docker 的分层构建机制依赖缓存命中。当 Dockerfile 中某一层的内容发生变化时，该层及其后续所有层都会重新构建。常见的缓存失效场景包括：`COPY . .` 放在安装依赖之前、`apt-get update` 和 `apt-get install` 不在同一层、文件时间戳变化导致缓存失效。

**解决方案**：在 Dockerfile 中合理安排指令顺序，将不常变化的操作放在前面。具体来说，应该先复制 `composer.json` 和 `composer.lock`，执行 `composer install`，然后再复制整个项目代码。这样只要依赖没有变化，`composer install` 这一层就能命中缓存：

```dockerfile
# ❌ 错误顺序：任何文件变化都会触发重新安装
COPY . .
RUN composer install

# ✅ 正确顺序：依赖不变时命中缓存
COPY composer.json composer.lock ./
RUN composer install --no-dev
COPY . .
```

### 问题：容器启动后立即退出（Exit Code 1）

**现象**：执行 `docker compose up` 后，PHP-FPM 容器立即退出，`docker compose ps` 显示状态为 `Exit 1`。

**排查步骤**：

```bash
# 1. 查看容器退出码和最后的日志
docker compose logs api
# 关注 "exit code" 和 "error" 关键字

# 2. 进入已停止的容器调试（需要 --entrypoint）
docker compose run --rm --entrypoint /bin/sh api

# 3. 检查 PHP-FPM 配置是否正确
docker compose run --rm api php-fpm -tt

# 4. 检查文件权限
docker compose run --rm api ls -la /var/www/html/storage
```

**常见原因**：`.env` 文件缺失或格式错误、数据库连接配置指向了错误的容器名称、`storage/` 目录权限不足导致日志无法写入、OPcache 配置参数拼写错误。

### 问题：容器内时区不正确

**现象**：PHP 日志和数据库记录的时间戳与本地时间相差 8 小时（东八区偏移）。

**解决方案**：在 Dockerfile 中设置时区环境变量，并安装时区数据包：

```dockerfile
# 安装时区数据
RUN apt-get update && apt-get install -y tzdata \
    && ln -sf /usr/share/zoneinfo/Asia/Taipei /etc/localtime \
    && echo "Asia/Taipei" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# 设置 PHP 时区
RUN echo "date.timezone = Asia/Taipei" >> /usr/local/etc/php/php.ini
```

或者在 `docker-compose.yaml` 中通过环境变量传递：

```yaml
services:
  api:
    environment:
      - TZ=Asia/Taipei
      - PHP_TZ=Asia/Taipei
```

---

## 🔒 容器安全加固实战

在 B2C 电商系统中，容器安全直接关系到用户数据和资金安全。以下是我们在 KKday 项目中实施的安全加固措施：

### 1. 非 Root 用户运行容器

默认情况下，Docker 容器以 root 用户运行，这意味着一旦应用被攻破，攻击者将获得容器内的最高权限。我们通过在 Dockerfile 中创建专用用户来降低风险：

```dockerfile
# 创建非 root 用户
RUN groupadd -r appuser && useradd -r -g appuser -d /var/www/html appuser

# 设置文件权限
RUN chown -R appuser:appuser /var/www/html
USER appuser

CMD ["php-fpm"]
```

### 2. 网络隔离与最小暴露

在生产环境中，数据库和缓存服务不应该暴露到宿主机。我们通过 Docker 网络实现了服务间的最小化通信：

```yaml
services:
  db:
    ports: []  # 不暴露端口到宿主机
    networks:
      - internal

  redis:
    ports: []  # 不暴露端口到宿主机
    networks:
      - internal

  api:
    networks:
      - internal  # 内部网络访问 db/redis
      - frontend  # 前端网络接受请求

networks:
  internal:
    driver: bridge
    internal: true  # 无法从宿主机直接访问
  frontend:
    driver: bridge
```

### 3. 只读文件系统与资源限制

对于生产环境，我们将容器文件系统设为只读，仅挂载必要的可写目录：

```yaml
services:
  api:
    read_only: true
    tmpfs:
      - /tmp
      - /var/run/php
    volumes:
      - storage-writable:/var/www/html/storage:rw
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 512M
        reservations:
          cpus: '1'
          memory: 256M
```

### 4. 敏感信息管理

绝对不要在 `docker-compose.yaml` 中硬编码密码和密钥。我们使用 Docker Secrets 或环境变量文件来管理敏感信息：

```bash
# 正确做法：使用 .env 文件（已加入 .gitignore）
# .env
DB_PASSWORD=your_secure_password_here
REDIS_PASSWORD=redis_secret
JWT_SECRET=your_jwt_secret_key

# 错误做法：直接写在 yaml 中
# DB_PASSWORD: your_password  # ❌ 绝对不要这样做
```

```yaml
# compose.yaml 中引用 .env 文件
services:
  db:
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_PASSWORD}
```

> ⚠️ **安全提醒**：确保 `.env` 文件已被 `.gitignore` 排除。在 CI/CD 流水线中，使用 GitHub Secrets 或 Vault 等工具来注入敏感信息，而不是将它们存储在代码仓库中。

---

## 🎯 生产环境最佳实践

### 1. 使用 Docker Compose Profile（多环境管理）

```yaml
# compose.yaml.prod (生产)
version: '3.8'
services:
  api:
    # 生产配置
    environment:
      APP_ENV: production
      CACHE_DRIVER: redis
      QUEUE_CONNECTION: redis
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 512M
  
  # development (开发)
services:
  api-dev:
    build:
      args:
        APP_ENV: development
        APP_DEBUG: true

# 快速切换环境
docker-compose -f compose.yaml.prod up -d
# 或
docker-compose -f compose.yaml dev up -d
```

### 2. 使用 Docker Compose Up-Down（自动清理）

```bash
# 一键部署 + 清理旧数据
docker compose -f compose.yaml.prod \
  --build \
  --remove-orphans \
  down \
  up -d

# 查看状态
docker compose ps

# 进入容器调试
docker exec -it kkday-api-01 /bin/bash

# 重启特定服务
docker compose restart api
```

### 3. 使用 Docker Compose Watch（自动重新部署）

```yaml
api:
  # 监听代码变化自动重建
  volumes:
    - ./app:/var/www/html
    - ./vendor:/var/www/html/vendor:ro
  build:
    context: ./app
    dockerfile: Dockerfile
    target: production
```

### 4. 使用 Docker Compose Volumes（持久化数据）

```yaml
db:
  volumes:
    - db_data:/var/lib/mysql
  healthcheck:
    test: ["CMD", "mysqladmin", "ping"]

# 备份脚本
./scripts/backup.sh
```

### 5. 使用 Docker Compose Networks（网络隔离）

```yaml
services:
  web:
    networks:
      - front
  api:
    networks:
      - back
  db:
    networks:
      - back

networks:
  front:
    driver: bridge
  back:
    internal: true  # 内部网络，不暴露
```

---

## 📊 性能调优实战

### PHP-FPM 优化参数

```ini
# php-fpm.conf
pm = dynamic
pm.max_children = 75
pm.start_servers = 5
pm.min_spare_servers = 5
pm.max_spare_servers = 35
pm.max_requests = 1000

[www]
user = www-data
group = www-data
listen = 127.0.0.1:9000

; 监听 Unix Socket（推荐）
listen = /var/run/php/php8.0-fpm.sock
listen.owner = www-data
listen.group = www-data
```

### OPcache 优化参数

```ini
; opcache.ini
opcache.enable=1
opcache.memory_consumption=256
opcache.max_accelerated_files=40000
opcache.validate_timestamps=0
opcache.revalidate_freq=60
opcache.fast_shutdown=1
opcache.interned_strings_buffer=16
```

### 数据库连接池优化

```env
DB_CONNECTION=mysql
DB_HOST=db
DB_PORT=3306
DB_DATABASE=kiday_api_production
DB_USERNAME=kiday_user
DB_PASSWORD=${DB_SECRET}
DB_TIMEOUT=5.0          # 超时时间 5 秒
DB_RETRY=3              # 重连 3 次
```

### Redis 连接池优化

```env
CACHE_DRIVER=redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=null
REDIS_PREFIX=kkday_
REDIS_DATABASE=0
```

### 数据卷备份与恢复策略

在生产环境中，数据库数据的持久化和备份是重中之重。以下是我们在 KKday 项目中使用的自动化备份方案：

```bash
#!/bin/bash
# scripts/backup.sh - 每日自动备份脚本
set -e

BACKUP_DIR="/backup/mysql/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# 导出数据库
docker exec kkday-mysql-01 mysqldump \
    -u root \
    -p"${DB_PASSWORD}" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    "${DB_NAME}" | gzip > "$BACKUP_DIR/${DB_NAME}_$(date +%H%M%S).sql.gz"

# 清理 7 天前的备份
find /backup/mysql/ -mtime +7 -type d -exec rm -rf {} + 2>/dev/null || true

echo "备份完成: $BACKUP_DIR"
```

恢复数据的命令如下：

```bash
# 从备份恢复数据库
gunzip < /backup/mysql/20260501/kkday_api_143022.sql.gz \
  | docker exec -i kkday-mysql-01 mysql \
    -u root -p"${DB_PASSWORD}" "${DB_NAME}"
```

> ⚠️ **踩坑提醒**：使用 `mysqldump --single-transaction` 可以在不锁表的情况下导出一致性快照，这对于在线生产的 B2C 系统至关重要。如果忘记加这个参数，可能会导致导出过程中数据不一致。

---

## 🧪 健康检查与监控

### 1. 自定义 Health Check

```yaml
api:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 40s
```

### 2. Laravel Telescope 监控

```env
TELESCOPE_ENABLED=true
TELESCOPE_DASHBOARD_URL=http://localhost:8081
```

### 3. Prometheus + Grafana 监控

```yaml
api:
  ports:
    - "9001:9000"  # XHPP
  volumes:
    - ./metrics:/var/www/html/storage/metrics:ro
```

### 4. Docker 日志排障实战

在生产环境中，快速定位问题根源是运维效率的关键。以下是我们在 KKday 项目中常用的日志分析方法：

**查看容器实时日志：**

```bash
# 查看 PHP-FPM 容器的最近 100 行日志
docker compose logs --tail=100 -f api

# 同时查看多个容器的日志
docker compose logs -f api web db

# 按时间过滤日志（仅查看最近 5 分钟）
docker compose logs --since=5m api
```

**日志文件结构化分析：**

```bash
# 统计 PHP-FPM 错误日志中的错误类型分布
docker exec kkday-api-01 bash -c \
  "cat /var/log/php-fpm.err.log | grep -oP '\[\w+-\w+\]' | sort | uniq -c | sort -rn"

# 查找最近的 OOM (Out of Memory) 记录
docker exec kkday-api-01 bash -c \
  "grep -i 'oom\|out of memory\|killed process' /var/log/php-fpm.err.log | tail -20"

# 分析请求响应时间（通过 Nginx access log）
docker exec api-gateway-01 bash -c \
  "awk '{print \$NF}' /var/log/nginx/access.log | sort -n | tail -20"
```

**一键导出诊断信息（用于远程协助）：**

```bash
#!/bin/bash
# scripts/diagnose.sh - 导出容器诊断信息
DIAG_DIR="diagnose_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DIAG_DIR"

docker compose ps > "$DIAG_DIR/containers.txt"
docker compose logs --no-color > "$DIAG_DIR/all-logs.txt"
docker stats --no-stream > "$DIAG_DIR/stats.txt"
docker system df > "$DIAG_DIR/disk-usage.txt"

# 导出 PHP-FPM 状态
docker exec kkday-api-01 php-fpm -tt 2>&1 > "$DIAG_DIR/php-fpm-test.txt"

tar czf "${DIAG_DIR}.tar.gz" "$DIAG_DIR"
rm -rf "$DIAG_DIR"
echo "诊断信息已导出: ${DIAG_DIR}.tar.gz"
```

---

## 🏁 开发环境快速搭建指南

对于新加入团队的开发者，从零搭建本地开发环境是第一步。以下是完整的初始化流程，确保你能在 10 分钟内跑起整个项目。

### 前置条件检查

在开始之前，请确认你的开发机器满足以下条件：

| 依赖项 | 最低版本 | 推荐版本 | 安装方式（macOS） |
|--------|---------|---------|-----------------|
| Docker Desktop | 4.15+ | 最新版 | `brew install --cask docker` |
| Colima（替代方案） | 0.6+ | 最新版 | `brew install colima` |
| PHP CLI（可选） | 8.0+ | 8.0 | `brew install php@8.0` |
| Git | 2.30+ | 最新版 | `brew install git` |

### 一键初始化脚本

我们将所有初始化步骤封装成了一个脚本，新开发者只需执行一条命令即可完成环境搭建：

```bash
#!/bin/bash
# scripts/setup.sh - 新开发者环境初始化
set -e

echo "🚀 KKday B2C API 开发环境初始化"

# 1. 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker Desktop 或 Colima"
    echo "   colima start --cpu 4 --memory 8 --disk 50"
    exit 1
fi

# 2. 复制环境变量文件
if [ ! -f .env ]; then
    echo "📋 创建 .env 文件..."
    cp .env.example .env
    echo "⚠️  请编辑 .env 文件，填写数据库密码等配置"
fi

# 3. 创建必要的目录
mkdir -p storage/logs storage/cache bootstrap/cache

# 4. 构建并启动所有服务
echo "🔨 构建 Docker 镜像（首次约需 5-8 分钟）..."
docker compose build --parallel

echo "🚀 启动所有服务..."
docker compose up -d

# 5. 等待服务就绪
echo "⏳ 等待数据库就绪..."
sleep 10

# 6. 执行数据库迁移
echo "🗄️ 执行数据库迁移..."
docker compose exec api php artisan migrate --force

# 7. 安装前端依赖（如果有）
if [ -f "package.json" ]; then
    echo "📦 安装前端依赖..."
    docker compose exec api npm install
fi

echo ""
echo "✅ 环境搭建完成！"
echo "   API 地址: http://localhost:8080"
echo "   数据库管理: http://localhost:8081"
echo "   进入容器: docker compose exec api /bin/bash"
echo "   查看日志: docker compose logs -f api"
```

### 开发环境 vs 生产环境配置对比

为了保证开发体验的同时不影响生产稳定性，我们在两个环境之间做了明确的配置区分：

| 配置项 | 开发环境 | 生产环境 | 说明 |
|--------|---------|---------|------|
| `APP_DEBUG` | `true` | `false` | 开发环境显示详细错误 |
| `LOG_LEVEL` | `debug` | `warning` | 生产环境减少日志噪音 |
| `OPcache` | 关闭 | 开启 | 开发时代码变化需要实时生效 |
| `Xdebug` | 启用 | 禁用 | 远程调试用，生产必须关闭 |
| `MySQL 端口` | 暴露 3306 | 不暴露 | 开发时允许本地工具连接 |
| `Redis 端口` | 暴露 6379 | 不暴露 | 开发时允许 Redis Desktop 连接 |

```yaml
# compose.override.yaml（开发环境覆盖配置）
services:
  api:
    environment:
      - APP_DEBUG=true
      - LOG_LEVEL=debug
      - XDEBUG_MODE=debug
      - XDEBUG_CONFIG=client_host=host.docker.internal
    volumes:
      - ./app:/var/www/html  # 热重载挂载

  db:
    ports:
      - "3306:3306"  # 开发时暴露数据库端口

  redis:
    ports:
      - "6379:6379"  # 开发时暴露 Redis 端口
```

---

## 📝 常用 Docker Compose 命令

| 命令 | 说明 |
|------|------|
| `docker compose up -d` | 后台启动服务 |
| `docker compose down` | 停止并删除容器、网络、卷 |
| `docker compose build` | 重新构建镜像 |
| `docker compose restart <service>` | 重启指定服务 |
| `docker compose logs -f <service>` | 查看日志 |
| `docker compose ps` | 查看所有容器状态 |
| `docker compose exec -it <service> /bin/bash` | 进入容器 |
| `docker compose scale api=3` | 横向扩容服务 |

---

## 🚀 CI/CD 流水线与自动化部署

在 KKday B2C 项目中，我们使用 GitHub Actions 实现了完整的 CI/CD 流水线。每次代码推送到主分支时，系统会自动执行构建、测试、镜像推送和生产部署的全流程。

### GitHub Actions 工作流配置

```yaml
# .github/workflows/deploy.yaml
name: Build & Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # === 第一阶段：代码质量检查 ===
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.0'
          tools: phpstan, pint
      - name: Run Pint (代码风格检查)
        run: vendor/bin/pint --test
      - name: Run PHPStan (静态分析)
        run: vendor/bin/phpstan analyse --memory-limit=2G

  # === 第二阶段：单元测试 ===
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test_password
          MYSQL_DATABASE: test_db
        ports: ['3306:3306']
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.0'
          extensions: pdo_mysql, redis
      - run: composer install --no-progress
      - name: Run PHPUnit
        run: vendor/bin/phpunit --coverage-clover=coverage.xml

  # === 第三阶段：构建镜像并推送 ===
  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
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
          context: ./app
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # === 第四阶段：生产环境部署 ===
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - name: Deploy to production server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/kkday-api
            docker compose pull
            docker compose up -d --remove-orphans
            docker compose exec api php artisan migrate --force
            docker system prune -f
```

### 部署流水线的三个关键优化

**优化一：Docker 层缓存加速构建。** 通过 GitHub Actions 的 `cache-from` 和 `cache-to` 参数，我们将 Docker 构建时间从平均 8 分钟缩短到了 2 分钟以内。秘诀在于将 `composer install` 和 `apt-get` 等耗时操作放在 Dockerfile 的前几层，这样只要依赖没有变化，后续层就能直接使用缓存。

**优化二：蓝绿部署减少停机时间。** 我们使用 `docker compose up -d --remove-orphans` 命令实现滚动更新。新容器启动并通过健康检查后，旧容器才会被停止，整个过程中服务保持可用。在实际操作中，我们观察到单次部署的停机时间约为 3-5 秒，远优于传统的停机部署方式。

**优化三：数据库迁移的安全执行。** 在生产环境中运行 `php artisan migrate` 需要格外谨慎。我们在迁移脚本中加入了前置检查，确保数据库连接正常且备份已完成：

```bash
#!/bin/bash
# scripts/safe-migrate.sh
set -e

echo "检查数据库连接..."
docker exec kkday-mysql-01 mysqladmin ping -h localhost
if [ $? -ne 0 ]; then
    echo "数据库连接失败，终止迁移"
    exit 1
fi

echo "执行数据库迁移..."
docker compose exec -T api php artisan migrate --force

echo "迁移完成，清理缓存..."
docker compose exec -T api php artisan config:cache
docker compose exec -T api php artisan route:cache
```

---

## 📌 附录：完整示例文件

### Dockerfile（精简版）

```dockerfile
# === 基础镜像 ===
FROM php:8.0-fpm

# === 设置环境变量 ===
ENV DEBIAN_FRONTEND=noninteractive \
    APP_ENV=production \
    PHP_VERSION=8.0.30

# === 安装系统依赖 ===
RUN apt-get update && apt-get install -y \
    git\
    libpng-dev\
    libonig-dev\
    libxml2-dev\
    libzip-dev\
    zip\
    unzip\
    curl\
    wget\
    && rm -rf /var/lib/apt/lists/*

# === 安装 PHP 扩展 ===
RUN docker-php-ext-install pdo_mysql bcmath mbstring opcache intl xml

# === Composer 安装 ===
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# === 设置工作目录 ===
WORKDIR /var/www/html

# === 生产环境优化 ===
ENV OPcache.enable=1 \
    OPcache.memory_consumption=256 \
    OPcache.max_accelerated_files=40000 \
    APP_DEBUG=false \
    APP_ENV=production

# === Laravel 依赖安装 ===
COPY composer.* ./
RUN composer install --no-dev --optimize-autoloader --classmap-authoritative \
    && composer dump-autoload --strict --optimize

# === Artisan 缓存 ===
RUN chmod -R 775 storage bootstrap/cache

EXPOSE 9000

CMD ["php-fpm"]
```

---

## 📊 容器编排方案对比

| 特性 | Docker Compose | Kubernetes | Docker Swarm |
|------|----------------|------------|--------------|
| **学习曲线** | ⭐ 低 | ⭐⭐⭐ 高 | ⭐⭐ 中 |
| **适用规模** | 单机/小团队 | 大规模集群 | 中等规模 |
| **自动扩缩容** | ❌ 手动 | ✅ HPA/VPA | ✅ 内置 |
| **服务发现** | ✅ 内置 DNS | ✅ CoreDNS | ✅ 内置 |
| **滚动更新** | ⚠️ 基础支持 | ✅ 细粒度控制 | ✅ 内置 |
| **配置管理** | .env 文件 | ConfigMap/Secret | Docker Config |
| **生态工具** | Docker Desktop | Helm/Istio/Prometheus | Portainer |
| **推荐场景** | 开发/测试/小规模微服务 | 生产级大规模部署 | 中等规模生产环境 |

> 💡 **选择建议**：本文的 Docker Compose 方案适合 **中小规模微服务部署**，当服务数量超过 10+ 或需要自动扩缩容时，建议迁移至 Kubernetes。参考下方相关阅读获取 K8s 部署指南。

---

## ✅ 总结与建议

### 📋 Checklist（部署前必做）

- [ ] 安装 Docker Desktop / Colima
- [ ] 配置 `docker-compose.yaml.prod`
- [ ] 创建 `.env` 环境变量文件
- [ ] 准备数据库迁移脚本
- [ ] 配置 Nginx 反向代理
- [ ] 测试健康检查端点 `/health`
- [ ] 设置监控告警规则

### 🎯 下一步优化方向

1. **Kubernetes 编排** → 学习 K8s 部署 Laravel B2C API 集群
2. **Service Mesh** → 使用 Linkerd/Istio 实现服务网格
3. **CI/CD 流水线** → GitHub Actions + Argo CD 自动化部署
4. **容器可观测性** → Prometheus + Grafana + Jaeger

---

## 📚 相关阅读

- [Docker BuildKit 镜像优化实战指南](/devops/docker-29-x-guide-buildkit-imageoptimization/) — 深入理解多阶段构建、缓存挂载与镜像体积优化技巧
- [Kubernetes HPA 自动扩缩容实战：Laravel API 集群](/devops/kubernetes-hpa-guide-laravel/) — 从 Docker Compose 迁移至 K8s，实现基于 CPU/自定义指标的弹性伸缩
- [Kubernetes Minikube/Kind/K3s 本地开发指南](/devops/kubernetes-minikube-kind-k3s-guide-laravel/) — 在本地环境搭建 K8s 集群，无缝衔接 Laravel 微服务部署
- [Azure Container Apps 实战：Laravel 微服务部署与自动扩缩容](/06_运维/Azure-Container-Apps-实战-Laravel-微服务-Azure-部署与自动扩缩容/) — 云原生 Serverless 容器平台的另一种选择
- [监控告警实战：Prometheus + Alertmanager + Grafana](/06_运维/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/) — 配合本文的健康检查，构建完整的容器监控体系
- [Docker Compose Laravel 本地开发环境实战 PHP-FPM 8.3 MySQL 8.0 Redis 7 Mailpit 完整搭建指南](/categories/devops/docker-compose-laravel-guide-php-fpm-8-3-mysql-redis-mailpit-guide/)
- [Docker 网络实战：bridge/host/overlay 网络模式与服务发现](/categories/devops/docker-guide-bridge-host-overlay-service-discovery/)
- [Kubernetes Ingress 实战：Nginx/Traefik 配置与 TLS Laravel B2C API 部署踩坑记录](/categories/devops/kubernetes-ingress-guide-nginx-traefik-tls-deployment/)

---

**📬 欢迎反馈：**

如有 Docker Compose 相关问题，请在 GitHub Issues 提交讨论。

**🌟 Star Support：**

如果喜欢本文，请为仓库点 Star ⭐️ 支持！
