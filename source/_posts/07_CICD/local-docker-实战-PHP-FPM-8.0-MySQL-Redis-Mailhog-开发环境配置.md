---
title: local-docker 实战 — PHP-FPM 8.0 + MySQL/Redis + Mailhog 开发环境配置
date: 2026-05-05 02:05:09
updated: 2026-05-05 02:07:40
categories:
  - 07_CICD
tags: [Docker, Laravel, PHP, 工程管理]description: KKday B2C 后端 30+ 仓库统一开发环境的完整配置指南 —— 从零搭建 local-docker，解决 MySQL/Redis/Mailhog 常见坑位，新成员 10 分钟跑起来。
---

# local-docker 实战：PHP-FPM 8.0 + MySQL/Redis + Mailhog 开发环境配置

> **一句话总结**：把 30+ 个 Laravel 仓库的本地开发环境统一成一个 `local-docker` 目录，新人 clone 完跑 `make up` 就能干活。

## 1. 为什么要统一 local-docker

KKday B2C 后端团队有 30+ 个 Git 仓库（BFF、搜索聚合、会员系统、支付网关……）。每个仓库都需要 MySQL、Redis、PHP-FPM，加上开发时必看的邮件通知。

在统一之前，团队遇到过这些痛点：

- **新人 Onboarding 慢**：装 MySQL、配 Redis、调 PHP 版本，半天起步
- **环境不一致**：小王 MySQL 8.0，小李 5.7，`GROUP BY` 行为完全不同
- **端口冲突**：本地 MySQL 占 3306，Docker 的 MySQL 也想用 3306
- **邮件没法看**：Laravel `Mail::send()` 发出去，收件箱空空如也

**解决方案**：在 `~/local-docker` 目录维护一套 docker-compose，所有仓库共享。

```
local-docker/
├── Makefile               # make up / make down / make ps
├── docker-compose.yml     # 核心服务定义
├── php-fpm-8.0/
│   ├── Dockerfile         # PHP-FPM 8.0 + 扩展
│   └── php.ini            # 覆盖默认配置
├── mysql/
│   ├── my.cnf             # 8.0 兼容性配置
│   └── init/              # 初始化 SQL
├── redis/
│   └── redis.conf         # 持久化 + 密码
└── mailhog/
    └── (无额外配置)
```

## 2. docker-compose.yml 完整配置

```yaml
# ~/local-docker/docker-compose.yml
version: '3.8'

services:
  php-fpm:
    build:
      context: ./php-fpm-8.0
      dockerfile: Dockerfile
    container_name: kkday-php-fpm
    volumes:
      # 关键：挂载整个开发目录
      - ${HOME}/GitHub:/var/www/html
      - ./php-fpm-8.0/php.ini:/usr/local/etc/php/conf.d/zz-custom.ini
    ports:
      - "9000:9000"
    networks:
      - kkday-local
    environment:
      - PHP_IDE_CONFIG=serverName=kkday.local
    restart: unless-stopped

  mysql:
    image: mysql:8.0
    container_name: kkday-mysql
    ports:
      - "3307:3306"          # ⚠️ 用 3307 避免与本地 MySQL 冲突
    volumes:
      - mysql_data:/var/lib/mysql
      - ./mysql/my.cnf:/etc/mysql/conf.d/custom.cnf
      - ./mysql/init:/docker-entrypoint-initdb.d
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: kkday_b2c
      MYSQL_USER: kkday
      MYSQL_PASSWORD: kkday123
    networks:
      - kkday-local
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: kkday-redis
    ports:
      - "6380:6379"          # ⚠️ 用 6380 避免冲突
    volumes:
      - redis_data:/data
      - ./redis/redis.conf:/usr/local/etc/redis/redis.conf
    command: redis-server /usr/local/etc/redis/redis.conf
    networks:
      - kkday-local
    restart: unless-stopped

  mailhog:
    image: mailhog/mailhog:latest
    container_name: kkday-mailhog
    ports:
      - "1025:1025"          # SMTP 端口
      - "8025:8025"          # Web UI 端口
    networks:
      - kkday-local
    restart: unless-stopped

volumes:
  mysql_data:
    driver: local
  redis_data:
    driver: local

networks:
  kkday-local:
    driver: bridge
```

**设计决策**：

| 决策 | 原因 |
|------|------|
| MySQL 用 3307 而非 3306 | 避免与 brew install 的 MySQL 冲突 |
| Redis 用 6380 而非 6379 | 同上，很多开发者本地也跑 Redis |
| PHP-FPM 挂载 `${HOME}/GitHub` | 所有仓库共享一个容器，不用每个仓库起一套 |
| Mailhog 无额外配置 | 开箱即用，只看邮件，不需要持久化 |

## 3. PHP-FPM 8.0 Dockerfile

这是最容易踩坑的部分。KKday 项目依赖的扩展比较多：

```dockerfile
# ~/local-docker/php-fpm-8.0/Dockerfile
FROM php:8.0-fpm-bullseye

# 系统依赖
RUN apt-get update && apt-get install -y \
    git curl zip unzip libpng-dev libjpeg-dev libfreetype6-dev \
    libonig-dev libxml2-dev libzip-dev libpq-dev \
    libicu-dev libgmp-dev \
    && rm -rf /var/lib/apt/lists/*

# PHP 扩展（一次性装完，减少镜像层数）
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
        sockets

# Redis 扩展（PECL 安装）
RUN pecl install redis \
    && docker-php-ext-enable redis

# Composer
COPY --from=composer:2.6 /usr/bin/composer /usr/bin/composer

# Xdebug（开发环境专用）
RUN pecl install xdebug \
    && docker-php-ext-enable xdebug

# 配置 PHP-FPM 监听方式
RUN sed -i 's/listen = 127.0.0.1:9000/listen = 0.0.0.0:9000/' \
    /usr/local/etc/php-fpm.d/zz-docker.conf

WORKDIR /var/www/html

# 非 root 用户（避免文件权限问题）
RUN groupadd -g 1000 www && useradd -u 1000 -g www www
RUN chown -R www:www /var/www/html
```

```ini
; ~/local-docker/php-fpm-8.0/php.ini
[PHP]
memory_limit = 512M
upload_max_filesize = 64M
post_max_size = 64M
max_execution_time = 120

[xdebug]
xdebug.mode = debug
xdebug.client_host = host.docker.internal
xdebug.client_port = 9003
xdebug.start_with_request = yes
xdebug.idekey = PHPSTORM
```

### 踩坑记录：文件权限问题

**现象**：容器内 PHP-FPM 以 `www` 用户运行，但 `~/GitHub` 下的文件 owner 是宿主机的 `michael`（uid 501）。Laravel 写 `storage/logs/` 时报 `Permission denied`。

**解法**：让容器内 `www` 用户的 uid 和宿主机一致：

```dockerfile
# 改为宿主机的 uid
RUN groupadd -g 20 www && useradd -u 501 -g www www
```

或者更通用的做法——在 `.env` 里传参：

```yaml
# docker-compose.yml
php-fpm:
  build:
    args:
      - HOST_UID=${HOST_UID:-501}
      - HOST_GID=${HOST_GID:-20}
```

```dockerfile
# Dockerfile
ARG HOST_UID=501
ARG HOST_GID=20
RUN groupadd -g ${HOST_GID} www && useradd -u ${HOST_UID} -g www www
```

## 4. MySQL 8.0 配置

```ini
# ~/local-docker/mysql/my.cnf
[mysqld]
# 兼容 Laravel 默认的 utf8mb4
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

# 开发环境放宽限制，避免 GROUP BY 报错
# 生产环境不要这样配！
sql_mode = STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION

# 慢查询日志（开发环境有用）
slow_query_log = 1
long_query_time = 1
slow_query_log_file = /var/log/mysql/slow.log

# InnoDB 缓冲池（开发机内存有限，给 256M 够用）
innodb_buffer_pool_size = 256M

# 允许 Laravel 使用 JSON 列的默认值
default_authentication_plugin = mysql_native_password

[client]
default-character-set = utf8mb4
```

### 初始化 SQL

```sql
-- ~/local-docker/mysql/init/01-create-databases.sql
CREATE DATABASE IF NOT EXISTS kkday_b2c;
CREATE DATABASE IF NOT EXISTS kkday_b2c_test;
CREATE DATABASE IF NOT EXISTS kkday_search;
CREATE DATABASE IF NOT EXISTS kkday_member;

-- 给测试库单独授权
GRANT ALL PRIVILEGES ON kkday_b2c_test.* TO 'kkday'@'%';
FLUSH PRIVILEGES;
```

**踩坑记录：MySQL 8.0 的 `ONLY_FULL_GROUP_BY`**

> Laravel 的 `groupBy()` 查询如果没包含 SELECT 里所有非聚合列，MySQL 8.0 默认会报错。
> 开发环境去掉 `ONLY_FULL_GROUP_BY` 不能算"正确做法"，但能让你快速跑通代码。
> 真正的修法是在代码层面用子查询或 `ANY_VALUE()`。

## 5. Redis 配置

```conf
# ~/local-docker/redis/redis.conf
bind 0.0.0.0
port 6379

# 持久化（开发环境用 RDB 够了，AOF 太慢）
save 60 1000
rdbcompression yes

# 内存限制（开发环境给 256M 足够）
maxmemory 256mb
maxmemory-policy allkeys-lru

# 日志
loglevel notice
```

## 6. Laravel 项目 `.env` 对接

每个 Laravel 仓库的 `.env` 配置如下：

```env
# ~/GitHub/any-laravel-project/.env
DB_CONNECTION=mysql
DB_HOST=kkday-mysql        # ⚠️ 用 Docker 网络内部 hostname
DB_PORT=3306               # 容器内部端口始终是 3306
DB_DATABASE=kkday_b2c
DB_USERNAME=kkday
DB_PASSWORD=kkday123

REDIS_HOST=kkday-redis     # ⚠️ 用 Docker 网络内部 hostname
REDIS_PORT=6379            # 容器内部端口始终是 6379

MAIL_MAILER=smtp
MAIL_HOST=kkday-mailhog    # ⚠️ 用 Docker 网络内部 hostname
MAIL_PORT=1025
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
```

**⚠️ 关键坑位：hostname 要用容器名而非 localhost**

当 Laravel 代码也跑在 Docker 容器内（`php-fpm` 容器）时，必须用 Docker 网络内部的 hostname（`kkday-mysql`、`kkday-redis`），而非 `127.0.0.1`。

但如果代码在宿主机运行（比如 `php artisan serve`），则需要用 `127.0.0.1:3307`、`127.0.0.1:6380`。

**团队的解法**：维护两份 `.env`：

```bash
# .env.docker  → 给容器内运行用
# .env.local   → 给宿主机运行用
# Makefile 里用 symlink 切换
make env-docker   # ln -sf .env.docker .env
make env-local    # ln -sf .env.local .env
```

## 7. Makefile 封装

```makefile
# ~/local-docker/Makefile
COMPOSE = docker compose -f docker-compose.yml

.PHONY: up down ps logs env-docker env-local rebuild

up:
	$(COMPOSE) up -d --build
	@echo "✅ 服务启动完成"
	@echo "  MySQL:    127.0.0.1:3307"
	@echo "  Redis:    127.0.0.1:6380"
	@echo "  MailHog:  http://localhost:8025"
	@echo "  PHP-FPM:  127.0.0.1:9000"

down:
	$(COMPOSE) down

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f --tail=100

rebuild:
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d

# 快速进入容器
shell-php:
	docker exec -it kkday-php-fpm bash

shell-mysql:
	docker exec -it kkday-mysql mysql -ukkday -pkkday123 kkday_b2c

shell-redis:
	docker exec -it kkday-redis redis-cli
```

## 8. Mailhog 实战：验证 Laravel 邮件

Mailhog 是开发环境的邮件捕获工具。所有发出去的邮件不会真发，而是存在 Mailhog 里，通过 Web UI 查看。

```php
// 代码里正常发邮件
Mail::to('user@example.com')->send(new OrderConfirmation($order));
```

打开 `http://localhost:8025`，就能看到邮件内容、附件、HTML 渲染效果。

### 踩坑记录：Mailhog 与 Gmail SMTP 的冲突

**现象**：有个开发者同时配了 `MAIL_MAILER=smtp` + Gmail SMTP（端口 587 + TLS），结果 Laravel 优先走了 Gmail 而非 Mailhog，测试邮件发到了真实用户邮箱。

**教训**：开发环境的 `.env` 一定要用 Mailhog 的明文 SMTP（端口 1025，无加密），不要混用真实邮件服务商。在 `.env.example` 里写死：

```env
# 开发环境强制用 Mailhog，不要改
MAIL_MAILER=smtp
MAIL_HOST=mailhog
MAIL_PORT=1025
MAIL_ENCRYPTION=null
```

## 9. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    macOS 开发机 (M2 Pro)                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │            Colima (Lima VM + Docker)              │    │
│  │                                                    │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐         │    │
│  │  │ PHP-FPM  │ │ MySQL 8.0│ │ Redis 7  │         │    │
│  │  │  8.0     │ │  (3307)  │ │  (6380)  │         │    │
│  │  │  (9000)  │ └──────────┘ └──────────┘         │    │
│  │  └──────────┘                                     │    │
│  │  ┌──────────┐                                     │    │
│  │  │ MailHog  │  ← SMTP (1025) + Web UI (8025)     │    │
│  │  └──────────┘                                     │    │
│  │                                                    │    │
│  │  kkday-local network                               │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ~/GitHub/           ← 30+ Laravel 仓库                  │
│  ~/local-docker/     ← 统一开发环境配置                    │
└─────────────────────────────────────────────────────────┘
```

## 10. 踩坑汇总

| # | 坑位 | 现象 | 解法 |
|---|------|------|------|
| 1 | 文件权限 | Laravel 写 storage/ 报 Permission denied | 容器 uid 与宿主机一致 |
| 2 | hostname | 连接数据库超时 | 容器内用容器名，宿主机用 127.0.0.1 |
| 3 | MySQL GROUP BY | 8.0 默认 ONLY_FULL_GROUP_BY | my.cnf 去掉或代码里用 ANY_VALUE() |
| 4 | Mailhog 不生效 | 邮件走了 Gmail SMTP | .env 强制配 1025 端口 |
| 5 | Xdebug 连不上 | host.docker.internal 解析失败 | Colima 需要 `--network-address` |
| 6 | 磁盘爆满 | Docker 镜像 + volume 累积 | 定期 `docker system prune` + `fstrim` |
| 7 | compose 版本 | `version: '3.8'` 在新版 Docker 里报警告 | 升级 Docker Compose v2，删掉 version 字段 |
| 8 | init SQL 不执行 | 修改 init/ 后容器不重新初始化 | `docker volume rm` 后重建 |

## 11. 与 Colima 的配合

这套 local-docker 在 Colima（M 芯片 Mac）上已经跑了半年多，性能优于 Docker Desktop：

```bash
# 启动 Colima（vz + virtiofs，性能最佳）
colima start --cpu 4 --memory 8 --disk 60 \
  --vm-type vz --mount-type virtiofs

# 然后正常启动 local-docker
cd ~/local-docker && make up
```

> 详细的 Colima vs Docker Desktop 性能对比，参见：[Colima 替代 Docker Desktop 实战](/00_架构/Colima替代DockerDesktop实战/)

## 12. 新人 Onboarding Checklist

1. `brew install colima docker docker-compose` → 装 Colima 套件
2. `colima start --vm-type vz --mount-type virtiofs` → 启动 VM
3. `git clone git@github.com:kkday/local-docker.git ~/local-docker` → 拉取配置
4. `cd ~/local-docker && make up` → 启动所有服务
5. 打开 `http://localhost:8025` 确认 Mailhog 可访问
6. `make shell-mysql` 确认 MySQL 连通
7. 进入任意 Laravel 项目，`cp .env.example .env` → 修改数据库连接
8. `php artisan migrate --seed` → 跑迁移
9. `php artisan serve` → 访问 `http://localhost:8000`

**平均耗时**：10 分钟以内（不含 clone 代码的时间）。

---

*本文基于 KKday B2C Backend Team 的 local-docker 实际使用经验，涉及 PHP-FPM 8.0 / MySQL 8.0 / Redis 7 / Mailhog / Colima。配置已覆盖 30+ 个 Laravel 仓库的日常开发需求。*
