---
title: Google Cloud Run 实战：容器化 Laravel 应用的 Serverless 部署——对比 AWS Lambda 冷启动与成本
date: 2026-06-02 12:00:00
tags: [Google-Cloud-Run, Serverless, Docker, Laravel, AWS-Lambda]
keywords: [Google Cloud Run, Laravel, Serverless, AWS Lambda, 容器化, 应用的, 冷启动与成本, DevOps]
categories: [devops]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: "Google Cloud Run 容器化部署 Laravel 应用的完整实战指南，深入对比 AWS Lambda 的冷启动性能、成本模型和开发体验。涵盖 Dockerfile 最佳实践、PHP-FPM 优化、Cloud Run 扩缩容配置、VPC 网络设置、CI/CD 流水线搭建，以及生产环境的监控告警方案，帮助 Laravel 开发者选择最适合的 Serverless 部署策略。"
---


## 引言：Serverless 的新范式

Serverless 计算已经从"新兴技术"演变为"生产级基础设施"。然而，不同云厂商的 Serverless 产品在架构理念、开发体验和成本模型上存在显著差异。

Google Cloud Run 于 2019 年推出，采用了一种独特的"容器原生 Serverless"理念——你只需要提供一个容器镜像，Cloud Run 负责扩缩容、负载均衡和运维。这与 AWS Lambda 的"函数即服务"模式形成了鲜明对比。

对于 Laravel 开发者来说，Cloud Run 提供了一个极具吸引力的部署方案：
- 容器化部署，避免 Lambda 的运行时限制
- 支持长时间运行的请求（最长 60 分钟）
- 自动扩缩到零，按实际使用付费
- 无需管理服务器或集群

本文将深入探讨 Cloud Run 的核心概念、Laravel 容器化最佳实践、冷启动优化、与 AWS Lambda 的全面对比，以及生产环境部署的完整流程。

---

## 第一章：Cloud Run 核心概念

### 1.1 Cloud Run 的架构

```
┌─────────────────────────────────────────────────────┐
│                Google Cloud Run                      │
│                                                      │
│  ┌──────────────┐     ┌──────────────┐              │
│  │  Load        │     │  Container   │              │
│  │  Balancer    │────▶│  Instances   │              │
│  │  (全球)      │     │  (自动扩缩)  │              │
│  └──────────────┘     └──────────────┘              │
│         │                    │                       │
│         │              ┌─────┴─────┐                │
│         │              │ Container │                │
│         │              │  Runtime  │                │
│         │              │  (Docker) │                │
│         │              └───────────┘                │
│         │                                            │
│  ┌──────┴──────┐     ┌──────────────┐              │
│  │  Artifact   │     │  Cloud SQL   │              │
│  │  Registry   │     │  (可选)      │              │
│  └─────────────┘     └──────────────┘              │
└─────────────────────────────────────────────────────┘
```

### 1.2 关键概念

**Revision（修订版）**：
- 每次部署创建一个新的 Revision
- Revision 是不可变的
- 可以通过流量分割实现灰度发布

**Service（服务）**：
- 一个 Service 包含多个 Revision
- 管理流量路由和配置
- 可以配置环境变量、密钥、VPC 等

**Container Instance（容器实例）**：
- 运行你的容器镜像
- 根据请求量自动扩缩
- 可以缩容到零

### 1.3 执行环境

Cloud Run 提供两种执行环境：

| 特性 | 第一代 | 第二代 |
|------|--------|--------|
| 最大并发 | 1000 | 1000 |
| 最大实例 | 1000 | 1000 |
| 最大请求超时 | 60 分钟 | 60 分钟 |
| 最大内存 | 32 GB | 32 GB |
| 最大 CPU | 8 vCPU | 8 vCPU |
| 支持 GPU | ❌ | ✅ |
| 支持 HTTP/2 | ✅ | ✅ |
| 支持 gRPC | ✅ | ✅ |
| 支持 WebSocket | ✅ | ✅ |
| 启动时间 | 较快 | 较慢 |

**推荐**：使用第二代执行环境，获得更好的性能和功能支持。

---

## 第二章：Laravel 容器化

### 2.1 基础 Dockerfile

```dockerfile
# Dockerfile - Laravel on Cloud Run

# 阶段 1：构建阶段
FROM composer:2.7 AS composer

WORKDIR /app

# 复制依赖文件
COPY composer.json composer.lock ./

# 安装依赖（生产环境优化）
RUN composer install \
    --no-dev \
    --no-interaction \
    --no-scripts \
    --no-autoloader \
    --prefer-dist

# 复制应用代码
COPY . .

# 生成优化的自动加载文件
RUN composer dump-autoload --optimize --classmap-authoritative

# 运行 Laravel 优化命令
RUN php artisan config:cache && \
    php artisan route:cache && \
    php artisan view:cache && \
    php artisan event:cache

# 阶段 2：生产镜像
FROM php:8.3-fpm-alpine AS production

# 安装系统依赖
RUN apk add --no-cache \
    nginx \
    supervisor \
    libzip-dev \
    libpng-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    oniguruma-dev \
    icu-dev \
    linux-headers

# 安装 PHP 扩展
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
    pdo_mysql \
    mbstring \
    zip \
    gd \
    bcmath \
    intl \
    opcache \
    pcntl

# 安装 Redis 扩展
RUN apk add --no-cache --virtual .build-deps $PHPIZE_DEPS \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del .build-deps

# 配置 PHP
COPY docker/php.ini /usr/local/etc/php/conf.d/custom.ini
COPY docker/opcache.ini /usr/local/etc/php/conf.d/opcache.ini

# 配置 Nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/default.conf /etc/nginx/conf.d/default.conf

# 配置 Supervisor
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 复制应用代码（从构建阶段）
COPY --from=composer /app /var/www/html

WORKDIR /var/www/html

# 设置文件权限
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html/storage \
    && chmod -R 755 /var/www/html/bootstrap/cache

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Cloud Run 监听端口
ENV PORT=8080

# 启动 Supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
```

### 2.2 Nginx 配置

```nginx
# docker/nginx.conf
user www-data;
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log warn;

events {
    worker_connections 1024;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    
    access_log /var/log/nginx/access.log main;
    
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 100M;
    
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss;
    
    include /etc/nginx/conf.d/*.conf;
}
```

```nginx
# docker/default.conf
server {
    listen 8080;
    server_name _;
    root /var/www/html/public;
    index index.php;
    
    # 安全头
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header X-XSS-Protection "1; mode=block";
    
    # 静态文件缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff2|woff|ttf|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
    
    # Laravel 路由
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
    
    # PHP-FPM
    location ~ \.php$ {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 300;
        fastcgi_buffering off;
    }
    
    # 健康检查端点
    location /health {
        access_log off;
        return 200 '{"status":"ok"}';
        add_header Content-Type application/json;
    }
    
    # 拒绝访问隐藏文件
    location ~ /\. {
        deny all;
    }
}
```

### 2.3 Supervisor 配置

```ini
# docker/supervisord.conf
[supervisord]
nodaemon=true
user=root
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid

[program:php-fpm]
command=/usr/local/sbin/php-fpm
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:nginx]
command=/usr/sbin/nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:laravel-queue]
command=php /var/www/html/artisan queue:work sqs --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
stopwaitsecs=3600
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:laravel-schedule]
command=/bin/sh -c "while true; do php /var/www/html/artisan schedule:run --verbose --no-interaction & sleep 60; done"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

### 2.4 PHP 配置优化

```ini
; docker/php.ini
[PHP]
memory_limit = 256M
upload_max_filesize = 100M
post_max_size = 100M
max_execution_time = 300
max_input_time = 300
max_input_vars = 3000

date.timezone = UTC

; Session 配置（使用 Redis）
session.save_handler = redis
session.save_path = "tcp://${REDIS_HOST}:6379?auth=${REDIS_PASSWORD}"

; 生产环境错误处理
display_errors = Off
display_startup_errors = Off
error_reporting = E_ALL
log_errors = On
error_log = /var/log/php/error.log
```

```ini
; docker/opcache.ini
[opcache]
opcache.enable = 1
opcache.memory_consumption = 256
opcache.interned_strings_buffer = 16
opcache.max_accelerated_files = 20000
opcache.validate_timestamps = 0
opcache.save_comments = 1
opcache.jit = 1255
opcache.jit_buffer_size = 128M
```

---

## 第三章：Cloud Run 部署

### 3.1 使用 gcloud CLI 部署

```bash
# 1. 设置项目
export PROJECT_ID=my-project
export REGION=asia-east1
export SERVICE_NAME=laravel-app

gcloud config set project $PROJECT_ID

# 2. 构建并推送镜像
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

# 3. 部署到 Cloud Run
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 2 \
  --min-instances 0 \
  --max-instances 10 \
  --concurrency 80 \
  --timeout 300 \
  --set-env-vars "APP_ENV=production,APP_DEBUG=false" \
  --set-cloudsql-instances $PROJECT_ID:$REGION:my-db

# 4. 更新流量分配（灰度发布）
gcloud run services update-traffic $SERVICE_NAME \
  --region $REGION \
  --to-revisions=LATEST=100
```

### 3.2 使用 Cloud Build 自动化

```yaml
# cloudbuild.yaml
steps:
  # 构建镜像
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/$REPO_NAME:$COMMIT_SHA', '.']
  
  # 推送到 Container Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/$REPO_NAME:$COMMIT_SHA']
  
  # 部署到 Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - '$REPO_NAME'
      - '--image'
      - 'gcr.io/$PROJECT_ID/$REPO_NAME:$COMMIT_SHA'
      - '--region'
      - 'asia-east1'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'

images:
  - 'gcr.io/$PROJECT_ID/$REPO_NAME:$COMMIT_SHA'

options:
  machineType: 'E2_HIGHCPU_8'
```

### 3.3 使用 Terraform 部署

```hcl
# main.tf
provider "google" {
  project = var.project_id
  region  = var.region
}

# Cloud Run Service
resource "google_cloud_run_v2_service" "laravel" {
  name     = "laravel-app"
  location = var.region
  
  template {
    containers {
      image = "gcr.io/${var.project_id}/laravel-app:latest"
      
      ports {
        container_port = 8080
      }
      
      resources {
        limits = {
          cpu    = "2"
          memory = "1Gi"
        }
      }
      
      env {
        name  = "APP_ENV"
        value = "production"
      }
      
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }
      
      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 10
        period_seconds        = 3
        failure_threshold     = 3
      }
      
      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }
    
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
    
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
  }
  
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# Cloud SQL Instance
resource "google_sql_database_instance" "main" {
  name             = "laravel-db"
  database_version = "MYSQL_8_0"
  region           = var.region
  
  settings {
    tier = "db-f1-micro"
    
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.main.id
    }
    
    backup_configuration {
      enabled = true
    }
  }
}

# VPC Connector
resource "google_vpc_access_connector" "connector" {
  name          = "laravel-vpc"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.main.name
}

# Secret Manager
resource "google_secret_manager_secret" "db_password" {
  secret_id = "db-password"
  
  replication {
    auto {}
  }
}

# IAM - 允许公开访问
resource "google_cloud_run_service_iam_member" "public" {
  service  = google_cloud_run_v2_service.laravel.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
```

---

## 第四章：冷启动优化

### 4.1 冷启动的影响因素

冷启动时间 = 容器启动时间 + 运行时启动时间 + 应用初始化时间

**影响因素：**
1. 镜像大小：影响容器拉取时间
2. PHP 扩展数量：影响 PHP 启动时间
3. Composer 自动加载：影响应用初始化
4. OPcache 预热：首次请求需要编译
5. 数据库连接：连接池初始化

### 4.2 镜像优化

```dockerfile
# 使用多阶段构建减小镜像大小
FROM composer:2.7 AS composer
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --no-scripts --no-autoloader --prefer-dist
COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative

# 使用 Alpine 基础镜像（更小）
FROM php:8.3-fpm-alpine AS production

# 只安装必要的扩展
RUN docker-php-ext-install pdo_mysql opcache

# 复制应用
COPY --from=composer /app /var/www/html

# 镜像大小对比：
# - Ubuntu 基础：~500MB
# - Alpine 基础：~200MB
# - Distroless：~150MB
```

### 4.3 PHP OPcache 预加载

```php
// config/preload.php
<?php

// 预加载关键类
require_once __DIR__ . '/vendor/autoload.php';

// 预编译 Blade 模板
$finder = new \Illuminate\View\FileViewFinder(
    app('files'),
    [resource_path('views')]
);

// 预热配置缓存
app()->make(\Illuminate\Config\Repository::class);

// 预热路由缓存
app()->make(\Illuminate\Routing\Router::class);
```

```ini
; opcache.ini - 启用预加载
opcache.preload = /var/www/html/config/preload.php
opcache.preload_user = www-data
```

### 4.4 最小实例配置

```bash
# 设置最小实例数以减少冷启动
gcloud run deploy laravel-app \
  --min-instances 1 \      # 保持至少 1 个实例运行
  --max-instances 10 \
  --cpu 2 \
  --memory 1Gi
```

**成本权衡：**
- `min-instances=0`：零成本但有冷启动
- `min-instances=1`：最低 $7/月，几乎无冷启动
- `min-instances=3`：最低 $21/月，完全无冷启动

### 4.5 冷启动基准测试

基于 Laravel 应用的冷启动时间测试：

| 配置 | 冷启动时间 | 说明 |
|------|-----------|------|
| Alpine + 全部扩展 | 8-12 秒 | 默认配置 |
| Alpine + 精简扩展 | 4-8 秒 | 只装必要扩展 |
| Alpine + OPcache 预加载 | 3-5 秒 | 启用预加载 |
| Alpine + min-instances=1 | <1 秒 | 几乎无冷启动 |
| Distroless + 精简 | 2-4 秒 | 最小镜像 |

---

## 第五章：AWS Lambda 对比

### 5.1 架构对比

| 特性 | Cloud Run | AWS Lambda |
|------|----------|------------|
| 计算模型 | 容器 | 函数 |
| 运行时 | 任意容器 | 预定义运行时 |
| 最大执行时间 | 60 分钟 | 15 分钟 |
| 最大内存 | 32 GB | 10 GB |
| 最大 CPU | 8 vCPU | 6 vCPU |
| 最大包大小 | 32 GB（镜像） | 250 MB（解压后） |
| 并发 | 1000/实例 | 1/调用 |
| 容器支持 | ✅ 原生 | ⚠️ Lambda Container |
| WebSocket | ✅ | ❌ |
| HTTP/2 | ✅ | ❌ |
| gRPC | ✅ | ❌ |

### 5.2 开发体验对比

**Cloud Run：**
```bash
# 本地开发
docker build -t my-app .
docker run -p 8080:8080 my-app

# 部署
gcloud run deploy my-app --image gcr.io/my-project/my-app
```

**AWS Lambda：**
```bash
# 使用 Serverless Framework
serverless deploy

# 或使用 AWS SAM
sam build
sam deploy --guided
```

**Laravel 特殊处理：**

Cloud Run 不需要特殊处理，直接运行标准的 Laravel 应用。

Lambda 需要使用 Bref 或 Vapor：
```php
// Lambda 特殊处理：session、文件系统等
// serverless.yml
provider:
  runtime: php-83-fpm
  
plugins:
  - ./vendor/bref/bref
  
functions:
  api:
    handler: public/index.php
    runtime: php-83-fpm
    events:
      - httpApi: '*'
```

### 5.3 冷启动对比

| 场景 | Cloud Run | AWS Lambda |
|------|----------|------------|
| PHP 冷启动 | 3-8 秒 | 5-15 秒 |
| 最小实例支持 | ✅ min-instances | ✅ Provisioned Concurrency |
| 最小实例成本 | ~$7/月/实例 | ~$15/月/1000并发 |
| 预热机制 | ✅ 内置 | ⚠️ 需要配置 |

**Cloud Run 冷启动优化：**
- 镜像优化：4-8 秒 → 2-4 秒
- OPcache 预加载：2-4 秒 → 1-3 秒
- min-instances=1：<1 秒

**Lambda 冷启动优化：**
- 使用 ARM64 架构：减少 10-20%
- 使用 SnapStart（Java）：减少 80%
- Provisioned Concurrency：消除冷启动（但成本高）

### 5.4 成本对比

**场景：每月 1000 万次请求，每次平均 200ms，256MB 内存**

| 成本项 | Cloud Run | AWS Lambda |
|--------|----------|------------|
| 计算费用 | $15 | $20 |
| 请求费用 | $4 | $2 |
| 内存费用 | 包含在计算中 | $5 |
| 网络费用 | $1 | $1 |
| **总计** | **~$20/月** | **~$28/月** |

**场景：每月 1 亿次请求，每次平均 500ms，1GB 内存**

| 成本项 | Cloud Run | AWS Lambda |
|--------|----------|------------|
| 计算费用 | $300 | $400 |
| 请求费用 | $40 | $20 |
| 内存费用 | 包含在计算中 | $100 |
| 网络费用 | $10 | $10 |
| **总计** | **~$350/月** | **~$530/月** |

**Cloud Run 成本优势：**
- 内存和 CPU 是打包计费，更灵活
- 最小实例成本更低
- 支持并发处理，单位请求成本更低

---

## 第六章：Laravel 特殊配置

### 6.1 Session 管理

Cloud Run 是无状态的，Session 不能存储在本地文件系统：

```php
// config/session.php
'driver' => env('SESSION_DRIVER', 'redis'),

// Redis 配置
'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),
    'default' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_DB', '0'),
    ],
],
```

### 6.2 文件存储

Cloud Run 的文件系统是临时的，文件不能存储在本地：

```php
// config/filesystems.php
'default' => env('FILESYSTEM_DISK', 'gcs'),

'disks' => [
    'gcs' => [
        'driver' => 'gcs',
        'key_file_path' => env('GOOGLE_CLOUD_KEY_FILE', ''),
        'project_id' => env('GOOGLE_CLOUD_PROJECT_ID', ''),
        'bucket' => env('GOOGLE_CLOUD_STORAGE_BUCKET', ''),
        'path_prefix' => env('GOOGLE_CLOUD_STORAGE_PATH_PREFIX', ''),
        'storage_api_uri' => env('GOOGLE_CLOUD_STORAGE_API_URI', ''),
    ],
    
    // 临时文件使用本地
    'local' => [
        'driver' => 'local',
        'root' => storage_path('app/private'),
    ],
],
```

### 6.3 队列处理

Cloud Run 支持长时间运行，可以直接在容器内运行队列 worker：

```ini
; supervisord.conf
[program:laravel-queue]
command=php /var/www/html/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
numprocs=2
process_name=%(program_name)s_%(process_num)02d
stopwaitsecs=3600
```

或者使用 Cloud Tasks 作为队列后端：

```php
// config/queue.php
'connections' => [
    'cloudtasks' => [
        'driver' => 'cloudtasks',
        'project' => env('GOOGLE_CLOUD_PROJECT_ID'),
        'location' => env('GOOGLE_CLOUD_LOCATION', 'asia-east1'),
        'queue' => env('CLOUD_TASKS_QUEUE', 'default'),
    ],
],
```

### 6.4 数据库连接

Cloud Run 使用 VPC Connector 连接 Cloud SQL：

```php
// config/database.php
'mysql' => [
    'driver' => 'mysql',
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'forge'),
    'username' => env('DB_USERNAME', 'forge'),
    'password' => env('DB_PASSWORD', ''),
    'unix_socket' => env('DB_SOCKET', '/cloudsql/PROJECT:REGION:INSTANCE'),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'prefix' => '',
    'strict' => true,
    'engine' => null,
],
```

### 6.5 环境变量管理

使用 Secret Manager 管理敏感配置：

```bash
# 创建 Secret
gcloud secrets create db-password --replication-policy="automatic"
echo -n "my-secure-password" | gcloud secrets versions add db-password --data-file=-

# 部署时引用 Secret
gcloud run deploy laravel-app \
  --set-secrets "DB_PASSWORD=db-password:latest" \
  --set-secrets "APP_KEY=app-key:latest"
```

---

## 第七章：CI/CD 集成

### 7.1 GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloud Run

on:
  push:
    branches: [main]

env:
  PROJECT_ID: my-project
  REGION: asia-east1
  SERVICE_NAME: laravel-app

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: test
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3
      
      redis:
        image: redis:7
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, libxml, mbstring, zip, pdo, mysql, redis
          coverage: none
      
      - name: Install Dependencies
        run: composer install --no-interaction --prefer-dist
      
      - name: Run Tests
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: test
          DB_USERNAME: root
          DB_PASSWORD: root
          REDIS_HOST: 127.0.0.1
        run: php artisan test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Cloud SDK
        uses: google-github-actions/setup-gcloud@v2
        with:
          project_id: ${{ env.PROJECT_ID }}
          service_account_key: ${{ secrets.GCP_SA_KEY }}
      
      - name: Build and Push Image
        run: |
          gcloud builds submit \
            --tag gcr.io/$PROJECT_ID/$SERVICE_NAME:$GITHUB_SHA
      
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy $SERVICE_NAME \
            --image gcr.io/$PROJECT_ID/$SERVICE_NAME:$GITHUB_SHA \
            --region $REGION \
            --platform managed \
            --allow-unauthenticated \
            --set-env-vars "APP_ENV=production,APP_DEBUG=false" \
            --set-secrets "DB_PASSWORD=db-password:latest,APP_KEY=app-key:latest"
      
      - name: Run Migrations
        run: |
          gcloud run jobs create migrate-$GITHUB_SHA \
            --image gcr.io/$PROJECT_ID/$SERVICE_NAME:$GITHUB_SHA \
            --region $REGION \
            --command "php" \
            --args "artisan,migrate,--force"
          
          gcloud run jobs execute migrate-$GITHUB_SHA --region $REGION
          gcloud run jobs delete migrate-$GITHUB_SHA --region $REGION --quiet
```

### 7.2 蓝绿部署

```bash
# 1. 部署新版本（不分配流量）
gcloud run deploy laravel-app \
  --image gcr.io/my-project/laravel-app:v2 \
  --no-traffic

# 2. 检查新版本健康状态
curl https://v2---laravel-app-xxxx.run.app/health

# 3. 分配 10% 流量到新版本
gcloud run services update-traffic laravel-app \
  --to-revisions=v2=10,v1=90

# 4. 观察指标，逐步增加流量
gcloud run services update-traffic laravel-app \
  --to-revisions=v2=50,v1=50

# 5. 完全切换
gcloud run services update-traffic laravel-app \
  --to-revisions=v2=100

# 6. 回滚（如果需要）
gcloud run services update-traffic laravel-app \
  --to-revisions=v1=100
```

---

## 第八章：监控与可观测性

### 8.1 Cloud Monitoring 集成

```php
// app/Providers/AppServiceProvider.php
use Google\Cloud\Monitoring\V3\MetricServiceClient;
use Google\Cloud\Monitoring\V3\Point;
use Google\Cloud\Monitoring\V3\TimeInterval;
use Google\Cloud\Monitoring\V3\TypedValue;
use Google\Protobuf\Timestamp;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(MetricServiceClient::class);
    }
    
    public function boot(): void
    {
        // 记录自定义指标
        $this->recordCustomMetrics();
    }
    
    private function recordCustomMetrics(): void
    {
        $client = app(MetricServiceClient::class);
        $projectName = $client->projectName(config('services.gcp.project_id'));
        
        $interval = new TimeInterval();
        $now = time();
        $interval->setEndTime(new Timestamp(['seconds' => $now]));
        
        $point = new Point();
        $point->setInterval($interval);
        $point->setValue(new TypedValue(['int64_value' => $this->getQueueSize()]));
        
        // 发送到 Cloud Monitoring
        // ...
    }
}
```

### 8.2 日志配置

```php
// config/logging.php
'channels' => [
    'stack' => [
        'driver' => 'stack',
        'channels' => ['stderr'],
        'ignore_exceptions' => false,
    ],
    
    'stderr' => [
        'driver' => 'monolog',
        'handler' => Monolog\Handler\StreamHandler::class,
        'formatter' => Monolog\Formatter\JsonFormatter::class,
        'with' => [
            'stream' => 'php://stderr',
        ],
    ],
],
```

### 8.3 告警配置

```hcl
# Terraform 告警配置
resource "google_monitoring_alert_policy" "high_latency" {
  display_name = "High Latency Alert"
  combiner     = "OR"
  
  conditions {
    display_name = "Latency above 2 seconds"
    
    condition_threshold {
      filter     = "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_latencies\""
      duration   = "60s"
      comparison = "COMPARISON_GT"
      
      threshold_value = 2000  # 2 秒
      
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
    }
  }
  
  notification_channels = [google_monitoring_notification_channel.email.name]
}
```

---

## 第九章：最佳实践总结

### 9.1 容器最佳实践

```dockerfile
# ✅ 好的做法
# 1. 使用多阶段构建
FROM composer:2.7 AS composer
# ... 安装依赖

FROM php:8.3-fpm-alpine AS production
# ... 生产镜像

# 2. 使用非 root 用户
RUN addgroup -g 1000 -S www && adduser -u 1000 -S www -G www
USER www

# 3. 合并 RUN 指令减少层数
RUN apk add --no-cache \
    nginx \
    supervisor \
    && docker-php-ext-install pdo_mysql opcache

# 4. 使用 .dockerignore
# .dockerignore
.git
node_modules
.env
tests
```

### 9.2 安全最佳实践

```bash
# 1. 使用 Secret Manager
gcloud secrets create app-key --replication-policy="automatic"
echo -n "base64:key=..." | gcloud secrets versions add app-key --data-file=-

# 2. 限制公开访问
gcloud run services set-iam-policy laravel-app policy.yaml

# 3. 使用 VPC Connector
gcloud compute networks vpc-access connectors create laravel-vpc \
  --region asia-east1 \
  --subnet my-subnet

# 4. 启用 Cloud Armor
gcloud compute security-policies create laravel-policy
```

### 9.3 性能最佳实践

```bash
# 1. 设置合理的并发数
gcloud run deploy laravel-app --concurrency 80

# 2. 使用最小实例
gcloud run deploy laravel-app --min-instances 1

# 3. 配置 CPU 分配
gcloud run deploy laravel-app --cpu 2 --memory 1Gi

# 4. 启用 HTTP/2
# Cloud Run 默认支持 HTTP/2，无需额外配置
```

---

## 第十章：总结

### 10.1 Cloud Run 的优势

1. **容器原生**：任何容器都可以部署，无运行时限制
2. **长连接支持**：WebSocket、gRPC、长轮询
3. **高并发**：单实例可处理 1000 并发请求
4. **成本效益**：按实际使用计费，扩缩到零
5. **开发体验**：本地 Docker 开发，部署一条命令

### 10.2 选择 Cloud Run 的场景

- Laravel 应用需要容器化部署
- 需要长时间运行的请求或任务
- 需要 WebSocket 或 gRPC 支持
- 希望避免 Lambda 的运行时限制
- 需要更灵活的扩缩容控制

### 10.3 选择 Lambda 的场景

- 纯函数计算（无状态、短时间）
- 深度集成 AWS 生态系统
- 团队已有 Lambda 经验
- 需要极细粒度的按调用计费

### 10.4 最终建议

对于 Laravel 开发者，Cloud Run 是一个极具吸引力的选择。它提供了容器的灵活性和 Serverless 的便利性，避免了 Lambda 对 PHP 的特殊处理需求。

通过合理的容器优化和配置，你可以在 Cloud Run 上获得极低的冷启动时间和优秀的性能表现，同时享受比 Lambda 更优惠的成本模型。

---

## 参考资料

1. [Google Cloud Run Documentation](https://cloud.google.com/run/docs)
2. [Cloud Run Pricing](https://cloud.google.com/run/pricing)
3. [Laravel on Cloud Run](https://cloud.google.com/run/docs/quickstarts/laravel)
4. [AWS Lambda vs Cloud Run](https://cloud.google.com/blog/products/serverless/cloud-run-vs-aws-lambda)
5. [Cloud Run Best Practices](https://cloud.google.com/run/docs/best-practices)

## 相关阅读

- [Railway vs Fly.io vs Render：2026 年 Laravel 应用云部署平台选型对比](/categories/运维/Railway-vs-Fly-io-vs-Render-2026年Laravel应用云部署平台选型对比/)
- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/categories/运维/2026-06-02-Coolify-实战-开源Heroku-Vercel替代-自托管PaaS平台与Laravel一键部署/)
- [Terraform 实战：Laravel 应用基础设施即代码](/categories/DevOps/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
