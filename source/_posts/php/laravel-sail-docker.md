---
title: Laravel Sail 深度实战：Docker 开发环境的官方方案
keywords: [Laravel Sail, Docker, 深度实战, 开发环境的官方方案, PHP]
date: 2026-06-10 08:34:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel Sail
  - Docker
  - 开发环境
  - 容器化
  - Laravel
description: 深入实战 Laravel Sail，覆盖安装定制、多服务编排、数据库调试、性能调优与生产环境一致性保障，提供可运行的代码与配置示例。
---


在 Laravel 生态中，**Sail** 已经成为官方推荐的 Docker 开发环境方案。它把原本复杂的 `docker-compose` 配置封装成了一套简洁的命令行工具，让开发者可以在几分钟内启动一个完整的开发栈，同时保持与生产环境的一致性。本文将从安装到定制，从日常调试到性能调优，全方位拆解 Laravel Sail 的实战用法。

## 概述

Laravel Sail 的核心理念是**零配置启动**。执行 `./vendor/bin/sail up` 后，你会得到：

- PHP-FPM / Nginx 双进程模型
- MySQL / PostgreSQL / MariaDB（可选）
- Redis 缓存与队列
- Meilisearch / Elasticsearch 全文搜索（可选）
- Mailpit 邮件捕获
- MinIO S3 兼容存储（可选）

相比传统的 Homestead 或 Valet，Sail 的优势在于：

1. **环境一致性**：Docker 镜像保证了团队成员的开发环境完全相同
2. **零侵入**：不需要修改任何 `.env` 配置，默认端口、数据库连接都已经配好
3. **可定制**：`docker-compose.yml` 完全暴露，可以按需增删服务
4. **生产对齐**：同样的镜像可以用于 CI/CD 和生产部署

## 核心概念

### 架构模型

Sail 的 Docker 架构可以简化为以下拓扑：

```
宿主机 (macOS/Linux)
├── sail (CLI wrapper)
└── docker-compose
    ├── laravel.test (PHP-FPM + Nginx)
    ├── mysql (MySQL 8.0)
    ├── redis (Redis 7)
    ├── meilisearch (可选)
    ├── mailpit (可选)
    └── minio (可选)
```

**Sail 并不引入新的架构**，它只是把 `docker-compose` 的命令封装成了 `sail` 命令。你可以直接操作 `docker-compose.yml`，也可以完全不碰它。

### 进程模型：FPM vs artisan serve

默认情况下，Sail 使用 **PHP-FPM + Nginx** 双进程模型，这是生产环境的标准配置。但在开发中，你可能更习惯 `php artisan serve` 的单进程模型。

```php
// config/app.php 中的环境判断
if (env('APP_ENV') === 'local') {
    // Sail 环境下使用 FPM 模型
    // 开发机使用 artisan serve
}
```

实际开发中，FPM 模型的响应速度比 `artisan serve` 快 **3-5 倍**，因为 Nginx 负责静态资源和请求转发，PHP-FPM 负责动态内容。

### 端口映射

默认端口映射：

| 服务 | 宿主机端口 | 容器端口 |
|------|-----------|---------|
| Web (Nginx) | 80 | 80 |
| MySQL | 3306 | 3306 |
| Redis | 6379 | 6379 |
| Meilisearch | 7700 | 7700 |
| Mailpit | 8025 | 8025 |
| MinIO | 9000 | 9000 |

如果宿主机端口被占用，可以在 `.env` 中修改：

```env
# .env
SAIL_FORWARDED_PORT=8080      # Web 端口改为 8080
SAIL_MYSQL_FORWARDED_PORT=3307 # MySQL 端口改为 3307
SAIL_REDIS_FORWARDED_PORT=6380 # Redis 端口改为 6380
```

## 实战代码

### 1. 快速安装

```bash
# 新建 Laravel 项目并安装 Sail
composer create-project laravel/laravel my-app
cd my-app
composer require laravel/sail --dev

# 发布 Sail 配置
php artisan sail:install

# 启动（首次会拉取镜像，约 2-5 分钟）
./vendor/bin/sail up -d

# 验证
./vendor/bin/sail artisan --version
# Laravel Framework 12.x.x
```

### 2. 常用命令对照

```bash
# 传统方式 vs Sail 命令
php artisan migrate          → ./vendor/bin/sail artisan migrate
php artisan tinker           → ./vendor/bin/sail artisan tinker
php artisan queue:work       → ./vendor/bin/sail artisan queue:work
npm run dev                  → ./vendor/bin/sail npm run dev
composer install             → ./vendor/bin/sail composer install
```

为了简化，通常会设置 alias：

```bash
# ~/.zshrc 或 ~/.bashrc
alias sail='[ -f sail ] && bash sail || bash vendor/bin/sail'
```

设置后可以直接用 `sail up -d` 代替 `./vendor/bin/sail up -d`。

### 3. 自定义 PHP 版本

默认使用 PHP 8.2，如果需要 PHP 8.4：

```bash
# 重新安装并指定版本
php artisan sail:install --php=84
sail up -d
sail php -v
# PHP 8.4.x
```

或者手动修改 `docker-compose.yml`：

```yaml
services:
  laravel.test:
    build:
      context: ./docker/7.4
      dockerfile: Dockerfile
      args:
        WWWGROUP: '${WWWGROUP}'
    image: sail-8.4/app
    # ... 其余配置不变
```

### 4. 多数据库场景

实际项目经常需要多个数据库。在 `docker-compose.yml` 中添加：

```yaml
services:
  # ... 默认的 mysql 服务

  mysql-read:
    image: 'mysql/mysql-server:8.0'
    ports:
      - '${SAIL_MYSQL_READ_FORWARDED_PORT:-3307}:3306'
    environment:
      MYSQL_ROOT_PASSWORD: '${DB_PASSWORD}'
      MYSQL_DATABASE: '${DB_DATABASE}_read'
      MYSQL_USER: '${DB_USERNAME}'
      MYSQL_PASSWORD: '${DB_PASSWORD}'
    volumes:
      - 'sail-mysql-read:/var/lib/mysql'
    networks:
      - sail
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      retries: 3
      timeout: 5s

volumes:
  sail-mysql:
    driver: local
  sail-mysql-read:
    driver: local
```

在 `.env` 中配置读库连接：

```env
DB_READ_HOST=mysql-read
DB_READ_PORT=3306
DB_READ_DATABASE=laravel_read
DB_READ_USERNAME=sail
DB_READ_PASSWORD=password
```

在 `config/database.php` 中添加读库连接：

```php
'mysql_read' => [
    'driver' => 'mysql',
    'host' => env('DB_READ_HOST', 'mysql-read'),
    'port' => env('DB_READ_PORT', '3306'),
    'database' => env('DB_READ_DATABASE', 'laravel'),
    'username' => env('DB_READ_USERNAME', 'sail'),
    'password' => env('DB_READ_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'prefix' => '',
    'strict' => true,
    'engine' => null,
],
```

### 5. 添加 Mailpit 邮件调试

Mailpit 默认已经包含在 Sail 中，无需额外配置。发送邮件后访问 `http://localhost:8025` 即可查看所有捕获的邮件。

```php
// 在代码中正常发送邮件
Mail::to('user@example.com')->send(new OrderShipped($order));

// Mailpit 自动捕获，不会真正发送
// 访问 http://localhost:8025 查看
```

### 6. 添加 MinIO S3 存储

```yaml
services:
  minio:
    image: 'minio/minio:latest'
    ports:
      - '${SAIL_MINIO_FORWARDED_PORT:-9000}:9000'
      - '${SAIL_MINIO_FORWARDED_CONSOLE_PORT:-9001}:9001'
    environment:
      MINIO_ROOT_USER: 'sail'
      MINIO_ROOT_PASSWORD: 'password'
    volumes:
      - 'sail-minio:/data'
    command: server /data --console-address ":9001"
    networks:
      - sail
```

`.env` 配置：

```env
AWS_ACCESS_KEY_ID=sail
AWS_SECRET_ACCESS_KEY=password
AWS_DEFAULT_REGION=us-east-1
AWS_BUCKET=laravel
AWS_ENDPOINT=http://minio:9000
AWS_USE_PATH_STYLE_ENDPOINT=true
```

## 踩坑记录

### 坑 1：首次 `sail up` 超时

**现象**：首次启动时 `docker compose up` 超时，镜像拉取失败。

**原因**：默认镜像源在国内可能不稳定。

**解决**：配置 Docker 镜像加速器，或者在 `docker-compose.yml` 中指定镜像地址：

```yaml
services:
  laravel.test:
    image: registry.cn-hangzhou.aliyuncs.com/laravel/sail-8.2/app:latest
```

或者设置 Docker daemon 的镜像加速：

```json
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://registry.docker-cn.com"
  ]
}
```

### 坑 2：`sail artisan` 命令找不到

**现象**：运行 `sail artisan migrate` 报 `command not found`。

**原因**：Sail 的 CLI wrapper 需要可执行权限。

**解决**：

```bash
chmod +x vendor/bin/sail
# 或者重新安装
php artisan sail:install
```

### 坑 3：MySQL 数据库迁移后数据丢失

**现象**：`sail down -v` 后重新启动，数据库数据为空。

**原因**：`-v` 参数会删除 Docker 卷（volume），数据库文件存储在卷中。

**解决**：

```bash
# 保留数据的停用
sail down          # 不加 -v

# 只在需要重置时才加 -v
sail down -v       # 删除卷和数据
sail up -d         # 重新启动，数据库为空
sail artisan migrate:fresh --seed  # 重新迁移并填充
```

### 坑 4：宿主机无法连接容器内数据库

**现象**：Navicat 或 DBeaver 连接 `localhost:3306` 失败。

**原因**：端口映射未正确配置，或者容器未完全启动。

**解决**：

```bash
# 检查容器状态
sail ps

# 检查端口映射
docker port sail-mysql-1

# 如果容器已启动但仍无法连接，检查 MySQL 是否绑定到 0.0.0.0
sail mysql -e "SELECT @@bind_address;"
# 应该返回 0.0.0.0 或 *
```

### 坑 5：`sail npm run dev` 端口冲突

**现象**：Vite 开发服务器启动后无法访问，或者报端口被占用。

**原因**：Vite 默认监听 5173 端口，但宿主机可能已有进程占用。

**解决**：

```javascript
// vite.config.js
export default defineConfig({
    server: {
        host: '0.0.0.0',  // 必须绑定到 0.0.0.0，不能是 localhost
        port: 5173,
        strictPort: true,  // 端口被占用时直接报错
    },
});
```

确保 `.env` 中有：

```env
VITE_APP_URL=http://localhost:80
```

### 坑 6：性能问题——文件同步慢

**现象**：`sail npm install` 或文件操作非常慢。

**原因**：macOS 上 Docker Desktop 的文件系统挂载（bind mount）性能较差。

**解决**：

```yaml
# 方案 1：使用 Docker volumes 替代 bind mount
services:
  laravel.test:
    volumes:
      - 'app:/var/www/html'  # Docker volume
      # 而不是 - .:/var/www/html

# 方案 2：使用 Mutagen 同步（推荐）
# 安装 Mutagen
brew install mutagen-io/mutagen/mutagen

# 启动同步
mutagen sync create . \
  sail@docker://sail-laravel.test/var/www/html \
  --name=laravel-sync \
  --ignore=".git,vendor,node_modules"

# 方案 3：在 Docker Desktop 中启用 VirtioFS
# Settings > General > Use VirtioFS for file sharing
```

### 坑 7：生产环境一致性问题

**现象**：Sail 环境下测试通过，部署到生产环境后出错。

**原因**：开发镜像和生产镜像的 PHP 扩展不一致。

**解决**：自定义 Dockerfile，确保扩展对齐：

```dockerfile
# docker/Dockerfile
FROM php:8.2-fpm

# 安装与生产环境相同的扩展
RUN apt-get update && apt-get install -y \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    libzip-dev \
    libicu-dev \
    libonig-dev \
    unzip \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install pdo_mysql mbstring zip intl bcmath opcache \
    && pecl install redis && docker-php-ext-enable redis

# 生产环境禁用的扩展，在开发中也禁用
# RUN pecl install xdebug && docker-php-ext-enable xdebug
```

在 `docker-compose.yml` 中使用自定义镜像：

```yaml
services:
  laravel.test:
    build:
      context: ./docker
      dockerfile: Dockerfile
```

## 最佳实践

### 1. Git 忽略配置

在 `.gitignore` 中添加：

```gitignore
/.docker
docker-compose.override.yml
```

`docker-compose.override.yml` 用于本地覆盖，不影响团队其他成员：

```yaml
# docker-compose.override.yml（不提交到 Git）
services:
  laravel.test:
    environment:
      XDEBUG_MODE: develop,debug
      XDEBUG_CLIENT_HOST: host.docker.internal
      XDEBUG_CLIENT_PORT: 9003
```

### 2. 环境变量管理

```bash
# 复制默认配置
cp .env.example .env

# Sail 会自动处理 Docker 环境变量
# 你只需要关注 .env 中的应用配置
sail artisan key:generate
sail artisan migrate
```

### 3. 数据库备份

```bash
# 备份
sail mysql -e "mysqldump -u sail -ppassword laravel > backup_$(date +%Y%m%d).sql"

# 恢复
sail mysql laravel < backup_20260610.sql
```

### 4. 日志查看

```bash
# 所有服务的日志
sail logs

# 特定服务的日志
sail logs laravel.test
sail logs mysql

# 实时跟踪
sail logs -f laravel.test
```

### 5. 性能调优

```yaml
# docker-compose.yml
services:
  laravel.test:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
    environment:
      PHP_OPCACHE_ENABLE: 1
      PHP_OPCACHE_ENABLE_CLI: 0
      PHP_OPCACHE_MEMORY_CONSUMPTION: 256
      PHP_OPCACHE_JIT: 1255
      PHP_OPCACHE_JIT_BUFFER_SIZE: 128M
```

## 总结

Laravel Sail 把 Docker 开发环境的复杂度降到了最低，同时保留了完全的可定制性。对于 Laravel 开发者来说，它解决了三个核心问题：

1. **环境一致性**：团队成员、CI/CD、生产环境使用相同的镜像
2. **开发效率**：`sail up -d` 一条命令启动完整开发栈
3. **生产对齐**：开发环境的配置可以平滑迁移到生产

在实际使用中，建议：

- **新项目**：直接使用 Sail，零配置即可开始
- **老项目**：逐步迁移，先跑通核心服务，再添加辅助服务
- **团队协作**：统一 `docker-compose.yml` 和 `sail` 版本，避免环境差异
- **性能敏感**：考虑 Mutagen 同步或 Docker volumes，避免 macOS 文件系统瓶颈

Sail 不是银弹，但它确实是 Laravel 生态中最优雅的 Docker 集成方案。掌握了它的定制能力，你就能构建出既高效又可靠的开发环境。