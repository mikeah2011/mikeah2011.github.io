---

feature: true
keywords: [Docker, Compose, Laravel, PHP, FPM, MySQL, Redis, Mailpit, 本地开发环境实战, 完整搭建指南]
cover: https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/laravel-code.jpg
images:
  - https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/laravel-code.jpg
title: Docker-Compose-Laravel-本地开发环境实战-PHP-FPM-8.3-MySQL-8.0-Redis-7-Mailpit-完整搭建指南
date: 2026-05-21 10:00:00
categories:
- devops
- database
tags:
- Docker
- Laravel
- MySQL
- PHP
- Redis
description: 从零搭建 Laravel 11+ 本地开发环境的完整指南 —— Docker Compose 编排 PHP-FPM 8.3 + MySQL 8.0 + Redis 7 + Mailpit，覆盖 Xdebug 远程调试、热重载、数据库初始化、健康检查等实战配置，附 Colima/M 芯片 Mac 专属踩坑记录。
---


## 一、为什么不用 Laravel Sail？

Laravel Sail 是官方提供的 Docker 开发环境，开箱即用。但在真实 B2C 项目中，你会遇到这些问题：

1. **多仓库共享基础设施**：30+ 个 Laravel 仓库如果每个都用 Sail，MySQL/Redis 实例会重复占用资源
2. **自定义扩展困难**：需要额外 PHP 扩展（如 `grpc`、`swoole`）时，Sail 的定制体验不好
3. **Xdebug 配置复杂**：Sail 默认不开启 Xdebug，手动配置容易踩坑
4. **Mailhog 已停止维护**：Sail 默认的 Mailhog 已被 Mailpit 取代

我们的方案：**维护一个共享的 `~/local-docker` 目录**，所有 Laravel 项目共用同一套基础设施。

```
架构图：本地开发环境拓扑

┌─────────────────────────────────────────────────────────────┐
│                     macOS (Colima)                          │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ PHP-FPM  │  │  Nginx   │  │  MySQL   │  │   Redis    │  │
│  │  8.3     │  │  1.25    │  │  8.0     │  │    7       │  │
│  │ :9000    │  │ :80/:443 │  │ :3306    │  │  :6379     │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       │              │             │               │         │
│       └──────────────┼─────────────┼───────────────┘         │
│                      │             │                         │
│               ┌──────┴──────┐ ┌────┴────┐                    │
│               │   Mailpit   │ │ phpMyAdmin│                   │
│               │  :8025      │ │  :8080   │                   │
│               └─────────────┘ └─────────┘                    │
│                                                             │
│  ~/local-docker/          ~/GitHub/{project}/               │
│  ├── docker-compose.yml   ├── app/                          │
│  ├── php-fpm-8.3/         ├── routes/                       │
│  ├── nginx/               ├── .env (DB_HOST=mysql)          │
│  └── mysql/               └── ...                           │
└─────────────────────────────────────────────────────────────┘
```

## 二、目录结构设计

```bash
~/local-docker/
├── docker-compose.yml          # 主编排文件
├── Makefile                    # 快捷命令
├── php-fpm-8.3/
│   ├── Dockerfile              # PHP-FPM 镜像构建
│   ├── php.ini                 # PHP 配置
│   ├── php-fpm.conf            # FPM 进程池配置
│   └── xdebug.ini              # Xdebug 配置
├── nginx/
│   ├── nginx.conf              # 全局配置
│   └── conf.d/
│       ├── default.conf        # 默认站点
│       └── laravel.conf        # Laravel 站点模板
├── mysql/
│   ├── my.cnf                  # MySQL 优化配置
│   └── init/
│       └── 01-create-databases.sql
├── redis/
│   └── redis.conf              # Redis 配置
└── .env                        # 环境变量（密码等，不入 Git）
```

## 三、docker-compose.yml 完整配置

```yaml
# ~/local-docker/docker-compose.yml
version: "3.8"

services:
  php-fpm:
    build:
      context: ./php-fpm-8.3
      dockerfile: Dockerfile
    container_name: local-php-fpm
    restart: unless-stopped
    volumes:
      # 挂载所有 Laravel 项目（只读代码 + 可写 storage）
      - ~/GitHub:/var/www/html:delegated
      # PHP 配置
      - ./php-fpm-8.3/php.ini:/usr/local/etc/php/php.ini:ro
      - ./php-fpm-8.3/xdebug.ini:/usr/local/etc/php/conf.d/xdebug.ini:ro
    environment:
      - PHP_OPCACHE_VALIDATE_TIMESTAMPS=1  # 开发环境必须关闭 OPcache 缓存
      - DB_HOST=mysql
      - REDIS_HOST=redis
      - MAIL_HOST=mailpit
      - MAIL_PORT=1025
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - local-net

  nginx:
    image: nginx:1.25-alpine
    container_name: local-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ~/GitHub:/var/www/html:delegated
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
    depends_on:
      - php-fpm
    networks:
      - local-net

  mysql:
    image: mysql:8.0
    container_name: local-mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql
      - ./mysql/my.cnf:/etc/mysql/conf.d/custom.cnf:ro
      - ./mysql/init:/docker-entrypoint-initdb.d:ro
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-root123}
      MYSQL_DATABASE: laravel
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${MYSQL_ROOT_PASSWORD:-root123}"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 30s
    networks:
      - local-net

  redis:
    image: redis:7-alpine
    container_name: local-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
      - ./redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - local-net

  mailpit:
    image: axllent/mailpit:latest
    container_name: local-mailpit
    restart: unless-stopped
    ports:
      - "8025:8025"   # Web UI
      - "1025:1025"   # SMTP
    environment:
      MP_MAX_MESSAGES: 5000
      MP_DATABASE: /tmp/mailpit.db
    networks:
      - local-net

  phpmyadmin:
    image: phpmyadmin:latest
    container_name: local-phpmyadmin
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      PMA_HOST: mysql
      PMA_PORT: 3306
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-root123}
    depends_on:
      mysql:
        condition: service_healthy
    networks:
      - local-net

volumes:
  mysql-data:
    driver: local
  redis-data:
    driver: local

networks:
  local-net:
    driver: bridge
```

**踩坑记录 #1：`depends_on` 不等于「服务就绪」**

早期版本我们用 `depends_on: [mysql]`，结果 Laravel 启动时 MySQL 还没初始化完，直接报 `Connection refused`。**必须加 `condition: service_healthy` + `healthcheck`**，Docker Compose 会等 healthcheck 通过才启动依赖服务。

**踩坑记录 #2：`delegated` 挂载模式**

Mac 上用 Docker 挂载 `~/GitHub` 目录时，如果没有 `:delegated`，文件同步会非常慢（尤其是 `vendor/` 目录）。Colima 用户需要额外配置 virtiofs：

```bash
# ~/.colima/default/colima.yaml
mountType: virtiofs
```

## 四、PHP-FPM 8.3 Dockerfile

```dockerfile
# ~/local-docker/php-fpm-8.3/Dockerfile
FROM php:8.3-fpm-bookworm

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    unzip \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    libonig-dev \
    libxml2-dev \
    libzip-dev \
    libicu-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# PHP 核心扩展
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
    pdo_mysql \
    mbstring \
    exif \
    pcntl \
    bcmath \
    gd \
    zip \
    intl \
    opcache \
    xml

# Redis 扩展（PECL）
RUN pecl install redis && docker-php-ext-enable redis

# Xdebug（开发环境专用）
RUN pecl install xdebug && docker-php-ext-enable xdebug

# Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Node.js（用于 Vite 前端构建）
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# PHP-FPM 进程池配置
RUN mv "$PHP_INI_DIR/php.ini-development" "$PHP_INI_DIR/php.ini"

WORKDIR /var/www/html

# 使用 www-data 用户
USER www-data
```

**踩坑记录 #3：Bookworm vs Bullseye**

PHP 8.3 默认基于 Debian Bookworm。如果你的项目依赖 `libssl1.1`（某些旧版 Swoole），需要手动降级到 Bullseye 基础镜像：

```dockerfile
FROM php:8.3-fpm-bullseye  # 而非 bookworm
```

## 五、Xdebug 3 配置（VS Code 联调）

```ini
; ~/local-docker/php-fpm-8.3/xdebug.ini
[xdebug]
zend_extension=xdebug
xdebug.mode=debug
xdebug.start_with_request=yes
xdebug.client_host=host.docker.internal
xdebug.client_port=9003
xdebug.idekey=VSCODE
xdebug.log_level=0
xdebug.discover_client_host=true
```

**踩坑记录 #4：`host.docker.internal` 在 Colima 上不生效**

Docker Desktop 自动解析 `host.docker.internal` 到宿主机 IP，但 Colima 不会。解决方案：

```bash
# 获取 Colima 的网关 IP
COLIMA_IP=$(colima ssh -- ip route | grep default | awk '{print $3}')
echo "xdebug.client_host=$COLIMA_IP" >> ~/local-docker/php-fpm-8.3/xdebug.ini
```

或者更优雅的方案——在 `docker-compose.yml` 中添加：

```yaml
services:
  php-fpm:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

**VS Code `launch.json` 配置：**

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Listen for Xdebug",
            "type": "php",
            "request": "launch",
            "port": 9003,
            "pathMappings": {
                "/var/www/html/${workspaceFolderBasename}": "${workspaceFolder}"
            }
        }
    ]
}
```

## 六、MySQL 8.0 优化配置

```ini
# ~/local-docker/mysql/my.cnf
[mysqld]
# 基础配置
default-authentication-plugin = mysql_native_password
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

# 性能优化（开发环境适配）
innodb_buffer_pool_size = 256M
innodb_log_file_size = 64M
innodb_flush_log_at_trx_commit = 2  # 开发环境用 2，生产环境用 1
max_connections = 100

# 慢查询日志（开发调试用）
slow_query_log = 1
slow_query_log_file = /var/lib/mysql/slow.log
long_query_time = 1

# 时区
default-time-zone = '+08:00'

# 二进制日志（用于 Laravel 事件监听调试）
log-bin = mysql-bin
binlog_expire_logs_seconds = 86400
```

```sql
-- ~/local-docker/mysql/init/01-create-databases.sql
CREATE DATABASE IF NOT EXISTS `laravel` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `laravel_test` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `laravel_testing` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建开发专用用户（权限比 root 小，更安全）
CREATE USER IF NOT EXISTS 'laravel'@'%' IDENTIFIED BY 'laravel123';
GRANT ALL PRIVILEGES ON `laravel`.* TO 'laravel'@'%';
GRANT ALL PRIVILEGES ON `laravel_test`.* TO 'laravel'@'%';
GRANT ALL PRIVILEGES ON `laravel_testing`.* TO 'laravel'@'%';
FLUSH PRIVILEGES;
```

**踩坑记录 #5：`mysql_native_password` vs `caching_sha2_password`**

MySQL 8.0 默认使用 `caching_sha2_password`，但某些旧版 Laravel 或 PDO 驱动不支持。在 `my.cnf` 中强制指定 `mysql_native_password` 可以避免 `Authentication method unknown` 错误。

## 七、Nginx 配置

```nginx
# ~/local-docker/nginx/conf.d/laravel.conf
server {
    listen 80;
    server_name ~^(?<project>.+)\.test$;
    root /var/www/html/$project/public;
    index index.php;

    # Laravel 路由重写
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    # PHP-FPM 转发
    location ~ \.php$ {
        fastcgi_pass php-fpm:9000;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 300;
    }

    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

**使用方式**：配置 `/etc/hosts`：

```bash
# /etc/hosts
127.0.0.1 myproject.test
127.0.0.1 api.test
127.0.0.1 admin.test
```

然后访问 `http://myproject.test` 即可。

**踩坑记录 #6：Nginx 的 `$project` 变量解析**

`server_name ~^(?<project>.+)\.test$` 使用正则捕获组，Nginx 会自动把 `myproject.test` 中的 `myproject` 赋值给 `$project` 变量。**注意**：这个变量不能用在 `fastcgi_param` 中，只能用在 `root` 等指令里。

## 八、Makefile 快捷命令

```makefile
# ~/local-docker/Makefile
.PHONY: up down restart logs ps shell mysql redis

# 启动所有服务
up:
	docker compose up -d
	@echo "✅ 服务已启动"
	@echo "  📧 Mailpit:    http://localhost:8025"
	@echo "  🗄️  phpMyAdmin: http://localhost:8080"
	@echo "  🔴 Redis:      localhost:6379"
	@echo "  🐬 MySQL:      localhost:3306"

# 停止所有服务
down:
	docker compose down

# 重启
restart:
	docker compose restart

# 查看日志
logs:
	docker compose logs -f --tail=100

# 查看状态
ps:
	docker compose ps

# 进入 PHP-FPM 容器
shell:
	docker compose exec php-fpm bash

# 进入指定项目的 artisan
artisan:
	@read -p "项目目录名: " project; \
	docker compose exec -w /var/www/html/$$project php-fpm php artisan $(filter-out $@,$(MAKECMDGOALS))

# MySQL 控制台
mysql:
	docker compose exec mysql mysql -ularavel -plaravel123

# Redis 控制台
redis:
	docker compose exec redis redis-cli

# 重建 PHP-FPM 镜像（Dockerfile 变更后）
build:
	docker compose build --no-cache php-fpm
	docker compose up -d php-fpm

# 清理所有数据（危险！会删除数据库）
nuke:
	docker compose down -v
	@echo "⚠️  所有卷已删除，数据库数据已清除"
```

## 九、Laravel 项目 .env 配置

```env
# 在各 Laravel 项目的 .env 中
DB_CONNECTION=mysql
DB_HOST=mysql          # ← Docker 服务名，不是 localhost
DB_PORT=3306
DB_DATABASE=laravel
DB_USERNAME=laravel
DB_PASSWORD=laravel123

REDIS_HOST=redis       # ← Docker 服务名
REDIS_PORT=6379
REDIS_PASSWORD=null

MAIL_MAILER=smtp
MAIL_HOST=mailpit      # ← Docker 服务名
MAIL_PORT=1025
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
MAIL_FROM_ADDRESS="dev@local.test"
MAIL_FROM_NAME="${APP_NAME}"

# OPcache 开发环境必须关闭缓存验证
PHP_OPCACHE_VALIDATE_TIMESTAMPS=1
```

**踩坑记录 #7：`DB_HOST` 用 `localhost` 还是服务名？**

在 Docker 网络中，容器之间通过**服务名**通信（如 `mysql`、`redis`）。如果你用 `localhost`，PHP-FPM 容器会尝试连接自己内部的 3306 端口——那里没有 MySQL。

只有从**宿主机**（如用 `artisan` 命令行）直接连接时，才需要用 `127.0.0.1:3306`（Docker 映射出来的端口）。

## 十、开发工作流实战

### 日常开发流程

```bash
# 1. 启动环境
cd ~/local-docker && make up

# 2. 进入项目目录
cd ~/GitHub/my-laravel-project

# 3. 安装依赖（在宿主机执行，利用 Composer 缓存）
composer install

# 4. 运行 artisan 命令（通过 Docker）
docker compose -f ~/local-docker/docker-compose.yml exec \
  -w /var/www/html/my-laravel-project php-fpm \
  php artisan migrate

# 5. 启动 Vite 开发服务器（在宿主机执行）
npm run dev

# 6. 访问 http://myproject.test
```

### Xdebug 调试流程

```
时序图：Xdebug 调试请求流

Browser                    Nginx                   PHP-FPM               VS Code
  │                          │                       │                     │
  │── GET /api/users ───────>│                       │                     │
  │                          │── fastcgi_pass ──────>│                     │
  │                          │                       │── init breakpoint ─>│
  │                          │                       │   (port 9003)       │
  │                          │                       │                     │
  │                          │                       │<── set breakpoints──│
  │                          │                       │                     │
  │                          │                       │── hit breakpoint ──>│
  │                          │                       │   ($user = User::)  │
  │                          │                       │                     │
  │                          │                       │<── step over/into──│
  │                          │                       │                     │
  │                          │                       │── response ────────>│
  │                          │<── response ──────────│                     │
  │<── 200 JSON ─────────────│                       │                     │
```

### 数据库快速操作

```bash
# 创建数据库迁移
docker compose -f ~/local-docker/docker-compose.yml exec \
  -w /var/www/html/my-project php-fpm \
  php artisan make:migration create_orders_table

# 执行迁移
docker compose -f ~/local-docker/docker-compose.yml exec \
  -w /var/www/html/my-project php-fpm \
  php artisan migrate

# 回滚
docker compose -f ~/local-docker/docker-compose.yml exec \
  -w /var/www/html/my-project php-fpm \
  php artisan migrate:rollback

# Seed 测试数据
docker compose -f ~/local-docker/docker-compose.yml exec \
  -w /var/www/html/my-project php-fpm \
  php artisan db:seed
```

为了简化命令，可以在各项目中添加 shell alias：

```bash
# ~/.zshrc
alias art='docker compose -f ~/local-docker/docker-compose.yml exec -w /var/www/html/$(basename $(pwd)) php-fpm php artisan'
alias dc='docker compose -f ~/local-docker/docker-compose.yml'
```

然后就可以这样用：

```bash
cd ~/GitHub/my-project
art migrate              # = php artisan migrate
art tinker               # = php artisan tinker
art queue:work           # = php artisan queue:work
dc exec php-fpm bash     # 进入容器 shell
```

## 十一、踩坑记录汇总

| # | 问题 | 原因 | 解决方案 |
|---|------|------|----------|
| 1 | MySQL 连接被拒 | `depends_on` 不等 healthcheck | 加 `condition: service_healthy` |
| 2 | Mac 文件同步慢 | Docker 挂载性能 | 用 `:delegated` + Colima `virtiofs` |
| 3 | Bookworm 缺旧 SSL 库 | PHP 8.3 默认 Bookworm | 换 `bullseye` 基础镜像 |
| 4 | Xdebug 连不上宿主机 | Colima 不解析 `host.docker.internal` | 加 `extra_hosts` 配置 |
| 5 | MySQL 认证失败 | `caching_sha2_password` 不兼容 | 改用 `mysql_native_password` |
| 6 | Nginx 404 | `$project` 变量不生效 | 确认正则捕获组语法 |
| 7 | 容器间连接失败 | 用了 `localhost` 而非服务名 | 用 Docker 服务名（如 `mysql`） |

## 十二、与 Laravel Sail 的对比

| 特性 | 本文方案 | Laravel Sail |
|------|----------|--------------|
| 多项目共享 | ✅ 一套基础设施 | ❌ 每个项目独立 |
| 自定义扩展 | ✅ 自由修改 Dockerfile | ⚠️ 需要自定义 Dockerfile |
| Xdebug 集成 | ✅ 预配置好 | ⚠️ 需要手动开启 |
| 邮件测试 | ✅ Mailpit（现代） | ⚠️ Mailhog（已停维） |
| 学习成本 | ⚠️ 需理解 Docker | ✅ `sail up` 即可 |
| 升级维护 | ⚠️ 手动维护 | ✅ Composer 升级 |

**建议**：个人项目或学习阶段用 Sail；团队开发、多仓库场景用本文方案。

## 总结

这套 local-docker 环境在 KKday 团队已经稳定运行一年以上，覆盖 30+ 个 Laravel 仓库的日常开发。核心优势：

1. **统一性**：新人 `git clone` + `make up`，10 分钟开始开发
2. **性能**：Colima + virtiofs，M 芯片 Mac 上接近原生速度
3. **可调试**：Xdebug 3 预配置，VS Code 一键断点
4. **可扩展**：需要新服务（如 Elasticsearch）时，加一个 service 即可

---

*本文基于 KKday B2C Backend Team 的 local-docker 实际使用经验，涉及 PHP-FPM 8.3 / MySQL 8.0 / Redis 7 / Mailpit / Colima / Xdebug 3。所有配置均已在 M2 Pro MacBook 上验证通过。*

## 相关阅读

- [Docker Compose 5.x 实战：多服务编排、健康检查与开发环境搭建踩坑记录](/DevOps/Docker/docker-compose-5-x-guide-orchestration-laravel/)
- [local-docker 实战 — PHP-FPM 8.0 + MySQL/Redis + Mailhog 开发环境配置](/DevOps/MySQL/local-docker-guide-php-fpm-8-0-mysql-redis-mailhog/)
- [Docker 网络实战：bridge/host/overlay 网络模式与服务发现](/DevOps/Docker/docker-guide-bridge-host-overlay-service-discovery/)
- [Colima vs Lima vs Docker Desktop：macOS 容器运行时选型对比实战](/DevOps/Docker/colima-vs-lima-vs-docker-desktop-macos-containervs/)
- [Docker Compose + PHP-FPM 实战：KKday B2C API 微服务部署经验](/DevOps/Docker/docker-compose-php-fpmguide-microservicesdeployment/)
