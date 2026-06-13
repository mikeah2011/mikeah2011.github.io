---

title: Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署
keywords: [Coolify, Heroku, Vercel, PaaS, Laravel, 开源, 替代, 自托管, 平台与, 一键部署]
date: 2026-06-02 10:00:00
tags:
- coolify
- PaaS
- 自托管
- DevOps
- Laravel
- 部署
- Docker
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: Coolify 是开源自托管 PaaS 平台，提供类似 Heroku/Vercel 的一键部署体验，支持 Git 仓库、Docker 镜像、Docker Compose 多种部署方式，内置自动 SSL、数据库管理、实时日志和回滚功能。本文深入讲解 Coolify 架构设计与安装配置，结合 Laravel 应用的完整部署流程，包括 Dockerfile 最佳实践、Docker Compose 多服务编排、Nginx 配置、环境变量管理、数据库备份和 CI/CD 自动部署，帮助开发者以极低成本实现生产级应用托管。
---



Coolify 是一个开源的、自托管的 PaaS（Platform as a Service）平台，它可以让你在自己的服务器上获得类似 Heroku、Vercel 或 Netlify 的部署体验。与这些商业平台不同的是，Coolify 让你完全掌控自己的基础设施——数据不会离开你的服务器，没有供应商锁定，而且成本只需要一台 VPS 的费用。本文将深入讲解 Coolify 的架构设计、安装配置、Laravel 应用部署、以及在生产环境中的最佳实践。

## 一、Coolify 是什么？

### 1.1 核心特性

Coolify 提供了以下核心能力：

- **一键部署**：支持 Git 仓库、Docker 镜像、Docker Compose 等多种部署方式
- **自动 SSL**：集成 Let's Encrypt，自动申请和续期 SSL 证书
- **多服务器支持**：可以在一台或多台服务器上管理应用
- **内置数据库**：一键部署 PostgreSQL、MySQL、Redis、MongoDB 等数据库
- **实时日志**：查看应用的实时日志和资源使用情况
- **回滚支持**：一键回滚到之前的版本
- **Webhook 集成**：支持 GitHub/GitLab 的自动部署
- **团队协作**：多用户、多项目、权限管理

### 1.2 与商业平台对比

| 特性 | Coolify (自托管) | Heroku | Vercel | Railway |
|------|-----------------|--------|--------|---------|
| 月成本 | $5-20 (VPS) | $7-500+ | $20-150+ | $5-100+ |
| 数据主权 | ✅ 完全控制 | ❌ | ❌ | ❌ |
| 自定义域名 | ✅ 免费 | ✅ | ✅ | ✅ |
| SSL 证书 | ✅ 自动 | ✅ 自动 | ✅ 自动 | ✅ 自动 |
| 数据库 | ✅ 内置 | ✅ 附加 | ❌ 需外部 | ✅ 内置 |
| Docker 支持 | ✅ 原生 | ✅ | ✅ | ✅ |
| 自定义构建 | ✅ 灵活 | ⚠️ 有限 | ✅ | ✅ |
| 供应商锁定 | ✅ 无 | ❌ | ⚠️ | ⚠️ |
| 学习曲线 | 中等 | 低 | 低 | 低 |

### 1.3 架构设计

Coolify 的架构分为三个主要组件：

```
┌─────────────────────────────────────────────┐
│                  Coolify UI                  │
│              (Next.js + Svelte)              │
├─────────────────────────────────────────────┤
│              Coolify API                     │
│           (PHP + Laravel)                    │
├─────────────────────────────────────────────┤
│         Docker Engine + Traefik              │
│    (容器编排 + 反向代理 + SSL)                │
├─────────────────────────────────────────────┤
│            你的服务器/VPS                     │
│       (Ubuntu/Debian/CentOS/RHEL)            │
└─────────────────────────────────────────────┘
```

- **Coolify UI**：基于 Next.js 和 Svelte 的管理界面
- **Coolify API**：基于 Laravel 的后端 API，处理部署逻辑
- **Docker Engine**：容器运行时，管理所有应用容器
- **Traefik**：反向代理和负载均衡器，处理路由和 SSL

## 二、安装 Coolify

### 2.1 系统要求

- **操作系统**：Ubuntu 22.04/24.04、Debian 12、CentOS Stream 9、RHEL 9
- **最低配置**：1 CPU、1GB RAM、20GB 磁盘
- **推荐配置**：2 CPU、4GB RAM、50GB 磁盘
- **网络**：公网 IP 或者可以通过 Tailscale/WireGuard 访问

### 2.2 一键安装

```bash
# 方法一：一键安装脚本（推荐）
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# 方法二：使用 Docker Compose 手动安装
git clone https://github.com/coollabsio/coolify.git
cd coolify
cp .env.production.example .env.production

# 编辑 .env.production
vim .env.production

# 启动服务
docker compose up -d
```

### 2.3 安装后的初始配置

安装完成后，访问 `http://your-server-ip:8000` 进行初始配置：

1. **创建管理员账户**
2. **配置服务器 SSH 密钥**（用于连接远程服务器）
3. **配置域名和 SSL**（推荐使用域名访问）

```bash
# 配置域名（假设域名是 coolify.example.com）
# 在 DNS 中添加 A 记录指向服务器 IP

# 在 Coolify UI 中配置：
# Settings → Configuration → Domain: coolify.example.com
# Coolify 会自动申请 Let's Encrypt SSL 证书
```

### 2.4 多服务器配置

Coolify 支持管理多台服务器：

```bash
# 在目标服务器上安装 Docker
curl -fsSL https://get.docker.com | bash

# 在 Coolify UI 中添加服务器：
# Servers → Add Server
# - Name: production-server
# - IP: 192.168.1.100
# - Port: 22
# - User: root
# - SSH Key: 选择或生成新的 SSH 密钥
```

## 三、Laravel 应用部署

### 3.1 准备 Laravel 项目

在部署之前，确保你的 Laravel 项目已经准备好：

```bash
# 1. 确保 .env.example 包含所有必要的环境变量
cat .env.example

# 2. 确保 Dockerfile 存在（如果没有，Coolify 会自动生成）
# 但推荐自己编写以获得更好的控制

# 3. 确保 .dockerignore 存在
cat .dockerignore
```

```dockerfile
# Dockerfile（推荐的 Laravel 生产镜像）
FROM php:8.4-fpm AS base

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    git curl zip unzip libpng-dev libjpeg-dev libfreetype6-dev \
    libonig-dev libxml2-dev libzip-dev libpq-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install pdo_mysql mbstring exif pcntl bcmath gd zip \
    && pecl install redis && docker-php-ext-enable redis \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 安装 Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# 依赖安装阶段
FROM base AS dependencies
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

# 生产镜像
FROM base AS production

COPY . /var/www/html
COPY --from=dependencies /var/www/html/vendor /var/www/html/vendor

RUN composer dump-autoload --optimize \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html/storage \
    && chmod -R 755 /var/www/html/bootstrap/cache

# PHP 配置
COPY docker/php.ini /usr/local/etc/php/conf.d/app.ini
COPY docker/www.conf /usr/local/etc/php-fpm.d/www.conf

EXPOSE 9000
CMD ["php-fpm"]
```

```dockerignore
# .dockerignore
/node_modules
/.git
/.github
/.vscode
/storage/logs/*
/storage/framework/cache/*
/storage/framework/sessions/*
/storage/framework/testing/*
/bootstrap/cache/*
.env
.env.backup
docker-compose.yml
docker-compose.*.yml
```

### 3.2 使用 Docker Compose 部署

对于需要多个服务的 Laravel 应用，推荐使用 Docker Compose：

```yaml
# docker-compose.yml
version: '3.8'

services:
  # PHP-FPM 应用
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: laravel-app
    restart: unless-stopped
    working_dir: /var/www/html
    volumes:
      - .:/var/www/html
    networks:
      - internal
    depends_on:
      - redis
      - mysql
    environment:
      - APP_ENV=production
      - APP_DEBUG=false
      - DB_CONNECTION=mysql
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_DATABASE=${DB_DATABASE}
      - DB_USERNAME=${DB_USERNAME}
      - DB_PASSWORD=${DB_PASSWORD}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - CACHE_DRIVER=redis
      - SESSION_DRIVER=redis
      - QUEUE_CONNECTION=redis

  # Nginx Web 服务器
  web:
    image: nginx:alpine
    container_name: laravel-web
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - .:/var/www/html
      - ./docker/nginx.conf:/etc/nginx/conf.d/default.conf
    networks:
      - internal
    depends_on:
      - app

  # 队列 Worker
  queue:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: laravel-queue
    restart: unless-stopped
    command: php artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
    volumes:
      - .:/var/www/html
    networks:
      - internal
    depends_on:
      - app
      - redis

  # Laravel Scheduler
  scheduler:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: laravel-scheduler
    restart: unless-stopped
    command: >
      sh -c "
        while true; do
          php artisan schedule:run --verbose --no-interaction &
          sleep 60
        done
      "
    volumes:
      - .:/var/www/html
    networks:
      - internal
    depends_on:
      - app
      - redis

  # MySQL 数据库
  mysql:
    image: mysql:8.0
    container_name: laravel-mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_DATABASE}
      MYSQL_USER: ${DB_USERNAME}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - internal
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis
  redis:
    image: redis:7-alpine
    container_name: laravel-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - internal
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  internal:
    driver: bridge

volumes:
  mysql-data:
  redis-data:
```

```nginx
# docker/nginx.conf
server {
    listen 80;
    server_name _;
    root /var/www/html/public;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    index index.php;

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \.php$ {
        fastcgi_pass app:9000;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 3.3 在 Coolify 中部署

#### 方法一：从 Git 仓库部署

1. **在 Coolify UI 中创建新项目**：
   - Projects → New Project
   - 输入项目名称

2. **创建新资源**：
   - 点击 "New Resource"
   - 选择 "Application"

3. **配置 Git 仓库**：
   - Source: GitHub/GitLab
   - Repository: 选择你的 Laravel 仓库
   - Branch: main

4. **配置构建**：
   - Build Pack: Docker Compose 或 Dockerfile
   - 如果选择 Docker Compose，指定 compose 文件路径
   - 如果选择 Dockerfile，指定 Dockerfile 路径

5. **配置环境变量**：

```env
APP_NAME=MyApp
APP_ENV=production
APP_KEY=base64:your-app-key
APP_DEBUG=false
APP_URL=https://your-domain.com

DB_CONNECTION=mysql
DB_HOST=mysql
DB_PORT=3306
DB_DATABASE=laravel
DB_USERNAME=laravel
DB_PASSWORD=your-secure-password

REDIS_HOST=redis
REDIS_PORT=6379

CACHE_DRIVER=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis

MAIL_MAILER=smtp
MAIL_HOST=smtp.mailtrap.io
MAIL_PORT=587
MAIL_USERNAME=your-username
MAIL_PASSWORD=your-password
```

6. **配置域名**：
   - Domains: 添加你的域名（如 `https://your-app.example.com`）
   - Coolify 会自动配置 Traefik 路由和 SSL 证书

7. **部署**：
   - 点击 "Deploy" 按钮
   - 等待构建和部署完成

#### 方法二：使用 Docker Compose

如果你的项目已经有 `docker-compose.yml`，可以直接使用：

1. 在 Coolify 中选择 "Docker Compose" 作为 Build Pack
2. 指定 compose 文件路径（通常是根目录的 `docker-compose.yml`）
3. Coolify 会自动解析服务并配置路由

### 3.4 部署后配置

```bash
# 在 Coolify 的 Terminal 中执行 Laravel 命令

# 运行数据库迁移
php artisan migrate --force

# 创建存储链接
php artisan storage:link

# 缓存配置
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan event:cache

# 创建管理员用户
php artisan db:seed --class=AdminUserSeeder
```

## 四、数据库管理

### 4.1 使用 Coolify 内置数据库

Coolify 可以一键部署各种数据库：

1. **在 Coolify UI 中添加数据库**：
   - 点击 "New Resource"
   - 选择 "Database"
   - 选择数据库类型（PostgreSQL、MySQL、MariaDB、MongoDB、Redis）

2. **配置数据库**：
   - 名称、版本、端口
   - Root 密码和用户密码

3. **连接到应用**：
   - 数据库会自动加入到同一个 Docker 网络
   - 在应用中使用容器名作为主机名

### 4.2 数据库备份

```bash
# 使用 Coolify 的内置备份功能
# 在数据库资源页面 → Backups → 配置备份计划

# 或者手动备份
# 在 Coolify Terminal 中执行
mysqldump -h mysql -u root -p laravel > /tmp/backup.sql

# 使用 Laravel 的备份包
composer require spatie/laravel-backup

# config/backup.php
return [
    'backup' => [
        'name' => env('APP_NAME', 'laravel-backup'),
        'source' => [
            'files' => [
                'include' => [
                    base_path(),
                ],
                'exclude' => [
                    base_path('vendor'),
                    base_path('node_modules'),
                    base_path('.git'),
                    base_path('storage/app'),
                ],
            ],
            'databases' => [
                'mysql',
            ],
        ],
        'database_dump_compressor' => null,
        'destination' => [
            'filename_prefix' => '',
            'disks' => [
                'local',
                's3',  // 可选：备份到 S3
            ],
        ],
    ],
];
```

### 4.3 数据库监控

```php
// app/Console/Commands/CheckDatabaseHealth.php
class CheckDatabaseHealth extends Command
{
    protected $signature = 'db:health';
    protected $description = 'Check database health';

    public function handle(): int
    {
        try {
            DB::connection()->getPdo();
            $this->info('Database connection: OK');

            $version = DB::selectOne('SELECT VERSION() as version');
            $this->info("MySQL Version: {$version->version}");

            $size = DB::selectOne("
                SELECT
                    ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
                FROM information_schema.tables
                WHERE table_schema = ?
            ", [config('database.connections.mysql.database')]);

            $this->info("Database Size: {$size->size_mb} MB");

            return 0;
        } catch (\Exception $e) {
            $this->error("Database connection failed: {$e->getMessage()}");
            return 1;
        }
    }
}
```

## 五、生产环境最佳实践

### 5.1 环境变量管理

```bash
# Coolify 支持环境变量的版本管理
# 在 UI 中可以为不同环境（dev/staging/prod）配置不同的变量

# 敏感变量使用 Secret
# 在 Coolify UI 中标记为 Secret，不会在日志中显示
```

### 5.2 SSL 证书配置

Coolify 使用 Traefik 自动管理 SSL 证书：

```yaml
# Coolify 会自动为你的域名申请 Let's Encrypt 证书
# 如果你需要使用自定义证书：

# 1. 在 Coolify UI 中上传证书
# Settings → Certificates → Add Certificate

# 2. 在应用中配置使用自定义证书
# 应用设置 → Advanced → SSL Certificate
```

### 5.3 域名配置

```bash
# 1. 在 DNS 中添加 A 记录
# your-domain.com → your-server-ip

# 2. 在 Coolify UI 中配置域名
# 应用设置 → Domains → Add Domain
# 输入: https://your-domain.com

# 3. Coolify 会自动：
# - 配置 Traefik 路由规则
# - 申请 SSL 证书
# - 配置 HTTP → HTTPS 重定向
```

### 5.4 监控和告警

```bash
# Coolify 内置了基本的监控功能
# 在应用页面可以查看：
# - CPU 使用率
# - 内存使用率
# - 磁盘使用率
# - 网络流量
# - 容器日志

# 配置告警通知
# Settings → Notifications → Add Notification
# 支持：Email, Slack, Discord, Telegram, Webhook
```

### 5.5 日志管理

```php
// Laravel 日志配置
// config/logging.php
'channels' => [
    'stack' => [
        'driver' => 'stack',
        'channels' => ['daily', 'stderr'],
        'ignore_exceptions' => false,
    ],

    'daily' => [
        'driver' => 'daily',
        'path' => storage_path('logs/laravel.log'),
        'level' => 'info',
        'days' => 14,
    ],

    'stderr' => [
        'driver' => 'monolog',
        'level' => env('LOG_LEVEL', 'debug'),
        'handler' => Monolog\Handler\StreamHandler::class,
        'formatter' => Monolog\Formatter\JsonFormatter::class,
        'with' => [
            'stream' => 'php://stderr',
        ],
    ],
],
```

### 5.6 性能优化

```bash
# 1. PHP OPcache 配置
# docker/php.ini
opcache.enable=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0  # 生产环境关闭时间戳验证
opcache.save_comments=1
opcache.jit=1255  # PHP 8.4 JIT 配置
opcache.jit_buffer_size=256M

# 2. Laravel 缓存
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan event:cache

# 3. Composer 优化
composer install --no-dev --optimize-autoloader

# 4. Nginx 缓存
# 在 nginx.conf 中添加静态资源缓存
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## 六、CI/CD 集成

### 6.1 GitHub Actions 自动部署

```yaml
# .github/workflows/deploy.yml
name: Deploy to Coolify

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          extensions: dom, curl, mbstring, zip, pdo, mysql, pdo_mysql
          coverage: none

      - name: Install Dependencies
        run: composer install --prefer-dist --no-progress

      - name: Run Tests
        env:
          DB_CONNECTION: sqlite
          DB_DATABASE: ":memory:"
        run: php artisan test

      - name: Run Pint
        run: vendor/bin/pint --test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Coolify Deployment
        run: |
          curl -X POST "${{ secrets.COOLIFY_WEBHOOK_URL }}" \
            -H "Content-Type: application/json" \
            -d '{"branch": "main"}'
```

### 6.2 GitLab CI 自动部署

```yaml
# .gitlab-ci.yml
stages:
  - test
  - deploy

test:
  stage: test
  image: php:8.4-cli
  script:
    - composer install --prefer-dist --no-progress
    - php artisan test
  only:
    - main

deploy:
  stage: deploy
  script:
    - curl -X POST "${COOLIFY_WEBHOOK_URL}" -H "Content-Type: application/json" -d '{"branch": "main"}'
  only:
    - main
  when: on_success
```

## 七、故障排查

### 7.1 常见问题

**问题 1：部署失败**

```bash
# 查看构建日志
# 在 Coolify UI 中：应用 → Deployments → 点击失败的部署 → 查看日志

# 常见原因：
# 1. Dockerfile 语法错误
# 2. 环境变量缺失
# 3. 依赖安装失败
# 4. 端口冲突

# 解决方案：
# - 检查 Dockerfile 语法
# - 确保所有环境变量都已配置
# - 查看构建日志中的具体错误信息
```

**问题 2：应用无法访问**

```bash
# 检查容器状态
docker ps -a

# 检查容器日志
docker logs laravel-app
docker logs laravel-web

# 检查 Traefik 配置
docker logs coolify-traefik

# 检查网络连通性
docker exec laravel-web curl http://app:9000
```

**问题 3：数据库连接失败**

```bash
# 检查数据库容器状态
docker ps | grep mysql

# 检查数据库日志
docker logs laravel-mysql

# 测试数据库连接
docker exec -it laravel-app php artisan tinker
>>> DB::connection()->getPdo();
```

**问题 4：SSL 证书问题**

```bash
# 检查 Traefik 日志
docker logs coolify-traefik 2>&1 | grep -i acme

# 手动触发证书申请
# 在 Coolify UI 中：应用 → Domains → 点击 "Renew Certificate"

# 检查 DNS 解析
dig your-domain.com +short
```

### 7.2 性能诊断

```bash
# 查看容器资源使用
docker stats

# 查看系统资源
htop
df -h
free -m

# 查看网络连接
netstat -tlnp

# 查看 Laravel 日志
tail -f storage/logs/laravel.log

#使用 Laravel Telescope（开发环境）
composer require laravel/telescope --dev
php artisan telescope:install
php artisan migrate
```

## 八、踩坑实战：生产环境常见陷阱

### 8.1 容器内文件权限问题

Laravel 部署到 Docker 后最常见的问题是 `storage` 和 `bootstrap/cache` 目录权限不对，表现为日志写入失败或视图缓存报错：

```bash
# 症状：The stream or file could not be opened in append mode

# 原因：Docker 构建时以 root 身份创建文件，但 PHP-FPM 以 www-data 用户运行
# 解决：在 Dockerfile 最后切换用户
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache
USER www-data

# 如果使用 volume 挂载（开发环境），需要在 entrypoint 中处理：
#!/bin/sh
chown -R www-data:www-data /var/www/html/storage
chown -R www-data:www-data /var/www/html/bootstrap/cache
exec "$@"
```

### 8.2 Coolify 环境变量不生效

Coolify 的环境变量通过 `.env` 文件注入，但 Laravel 有配置缓存机制，两者会冲突：

```bash
# ❌ 错误做法：先缓存配置再改环境变量
php artisan config:cache
# 之后在 Coolify UI 修改环境变量 → 不会生效！

# ✅ 正确做法：每次部署后重新缓存
# 在 Coolify 的 Deploy Script 中添加：
php artisan config:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

### 8.3 MySQL 容器启动顺序与健康检查

Laravel 应用容器可能在 MySQL 完全就绪前启动，导致首次部署失败：

```yaml
# docker-compose.yml - 正确的 depends_on 配置
services:
  app:
    depends_on:
      mysql:
        condition: service_healthy  # 关键：等待健康检查通过
      redis:
        condition: service_healthy

  mysql:
    image: mysql:8.0
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "--silent"]
      interval: 5s
      timeout: 3s
      retries: 30
      start_period: 30s  # MySQL 首次启动需要较长时间初始化
```

### 8.4 Traefik 与自定义 Nginx 端口冲突

Coolify 默认使用 Traefik 作为反向代理，如果你的 Docker Compose 中也暴露了 80/443 端口，会产生冲突：

```yaml
# ❌ 错误：直接暴露 80 端口
services:
  web:
    ports:
      - "80:80"    # 与 Traefik 冲突！

# ✅ 正确：只暴露内部端口，让 Traefik 代理
services:
  web:
    # 不要暴露端口，或只暴露非标准端口
    expose:
      - "80"       # 仅容器网络内部可见
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app.rule=Host(`your-domain.com`)"
      - "traefik.http.routers.app.entrypoints=websecure"
      - "traefik.http.services.app.loadbalancer.server.port=80"
```

### 8.5 队列 Worker 内存泄漏

长时间运行的 Laravel Queue Worker 在 Docker 中可能出现内存泄漏：

```php
// ✅ 推荐配置：限制处理数量和运行时间
// docker-compose.yml
queue:
  command: >
    php artisan queue:work redis
    --sleep=3
    --tries=3
    --max-time=3600
    --max-jobs=1000
    --max-memory=256
    --timeout=90
  restart: unless-stopped  # 崩溃后自动重启

// 监控队列健康状态的 Artisan 命令
// app/Console/Commands/QueueHealthCheck.php
class QueueHealthCheck extends Command
{
    protected $signature = 'queue:health';

    public function handle(): int
    {
        $size = Queue::size();
        $this->info("Queue size: {$size}");

        if ($size > 1000) {
            // 发送告警
            Log::warning("Queue backlog detected: {$size} jobs pending");
            return 1;
        }

        return 0;
    }
}
```

## 九、安全加固

### 8.1 服务器安全

```bash
# 1. 配置防火墙
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw deny 8000/tcp   # Coolify UI（只允许通过域名访问）
ufw enable

# 2. 禁用 root 密码登录
# /etc/ssh/sshd_config
PermitRootLogin prohibit-password
PasswordAuthentication no

# 3. 配置 fail2ban
apt install fail2ban
systemctl enable fail2ban

# 4. 定期更新系统
apt update && apt upgrade -y
```

### 8.2 应用安全

```php
// .env 安全配置
APP_DEBUG=false
APP_ENV=production

// 强制 HTTPS
// app/Providers/AppServiceProvider.php
public function boot(): void
{
    if (app()->environment('production')) {
        URL::forceScheme('https');
        URL::forceRootUrl(config('app.url'));
    }
}

// 安全头
// app/Http/Middleware/SecurityHeaders.php
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');
        $response->headers->set('X-XSS-Protection', '1; mode=block');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

        return $response;
    }
}
```

## 九、成本分析

### 9.1 VPS 成本对比

| 提供商 | 配置 | 月成本 | 适用场景 |
|--------|------|--------|---------|
| Hetzner CX22 | 2 vCPU, 4GB RAM, 40GB | €4.49 | 小型项目 |
| Hetzner CX32 | 4 vCPU, 8GB RAM, 80GB | €8.49 | 中型项目 |
| DigitalOcean | 2 vCPU, 4GB RAM, 80GB | $24 | 小型项目 |
| Vultr | 2 vCPU, 4GB RAM, 80GB | $24 | 小型项目 |
| AWS EC2 t3.medium | 2 vCPU, 4GB RAM | ~$30 | 灵活扩展 |

### 9.2 与商业平台成本对比

假设一个中型 Laravel 应用（2 vCPU, 4GB RAM, 数据库, Redis）：

| 方案 | 月成本 | 年成本 |
|------|--------|--------|
| Coolify + Hetzner | ~$10 | ~$120 |
| Heroku Standard | ~$50 | ~$600 |
| Vercel Pro | ~$20 | ~$240 |
| Railway Pro | ~$20 | ~$240 |

**Coolify 的成本优势非常明显**：同样的配置，成本只有商业平台的 1/5 到 1/10。

## 十、总结

Coolify 是一个优秀的自托管 PaaS 平台，它让 Laravel 开发者可以在自己的服务器上获得类似 Heroku/Vercel 的部署体验，同时保持对数据和基础设施的完全控制。

**Coolify 的核心优势**：

1. **成本低廉**：只需一台 VPS 的费用，没有额外的平台费用
2. **数据主权**：数据完全在你的服务器上，没有第三方访问
3. **无供应商锁定**：使用标准的 Docker 技术，随时可以迁移
4. **功能完整**：自动 SSL、数据库管理、日志监控、团队协作
5. **社区活跃**：开源项目，持续更新，社区支持

**适用场景**：

- 个人项目和 side projects
- 小团队的内部工具
- 初创公司的 MVP 部署
- 对数据主权有要求的项目
- 需要自定义基础设施的项目

**不适用场景**：

- 需要全球 CDN 和边缘计算的项目（考虑 Vercel/Cloudflare）
- 需要自动扩展到数百台服务器的项目（考虑 AWS/GCP）
- 不想管理任何基础设施的项目（考虑 Heroku/Railway）

如果你正在寻找一个既能降低成本、又能保持对基础设施控制的部署方案，Coolify 绝对值得一试。

## 相关阅读

- [Ansible 实战：Laravel 应用自动化部署与配置管理](/categories/CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [Terraform 实战：Laravel 应用基础设施即代码](/categories/CICD/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
- [监控告警实战：Prometheus + Grafana 告警规则设计](/categories/运维/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/)
