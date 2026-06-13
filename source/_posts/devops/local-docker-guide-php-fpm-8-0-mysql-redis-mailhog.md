---

title: local-docker 实战 — PHP-FPM 8.0 + MySQL/Redis + Mailhog 开发环境配置
keywords: [local, docker, PHP, FPM, MySQL, Redis, Mailhog, 开发环境配置]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-05 02:05:09
updated: 2026-05-05 02:07:40
categories:
- devops
- database
tags:
- Docker
- Laravel
- PHP
- 工程管理
description: KKday B2C 后端 30+ 个 Laravel 仓库统一本地开发环境的完整实战指南 —— 从零搭建 local-docker（PHP-FPM 8.0 + MySQL + Redis + Mailhog），详解 Dockerfile 与 docker-compose 配置，解决容器权限、hostname 互通、邮件捕获等常见坑位，附 Makefile 速查与 FAQ，新成员 10 分钟跑起来。
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

## 13. Makefile 常用命令速查

日常开发中最常用的命令，建议贴在显示器旁边：

| 命令 | 作用 | 使用场景 |
|------|------|----------|
| `make up` | 构建并启动所有服务（后台） | 每天开工第一步 |
| `make down` | 停止并移除所有容器 | 下班或切换项目前 |
| `make ps` | 查看容器运行状态 | 确认服务是否正常 |
| `make logs` | 实时查看所有服务日志（最近 100 行） | 排查报错 |
| `make logs SVC=mysql` | 只看 MySQL 日志 | 数据库问题排查 |
| `make rebuild` | 强制无缓存重新构建镜像 | Dockerfile 修改后 |
| `make shell-php` | 进入 PHP-FPM 容器 bash | 跑 artisan / composer |
| `make shell-mysql` | 连接 MySQL 命令行 | 执行 SQL / 查数据 |
| `make shell-redis` | 连接 Redis CLI | 调试缓存 / 队列 |
| `make env-docker` | 切换 `.env` 为容器内模式 | 容器内跑 Laravel |
| `make env-local` | 切换 `.env` 为宿主机模式 | `php artisan serve` |
| `make clean` | 清理停止的容器和悬空镜像 | 磁盘空间不足时 |
| `make db-dump` | 导出数据库到 SQL 文件 | 备份 / 分享数据 |
| `make db-restore` | 从 SQL 文件恢复数据库 | 还原备份 |

完整的 Makefile 补充命令：

```makefile
# 支持指定服务看日志
SVC ?=
logs:
	$(COMPOSE) logs -f --tail=100 $(SVC)

# 数据库导出（带时间戳）
TIMESTAMP = $(shell date +%Y%m%d_%H%M%S)
db-dump:
	docker exec kkday-mysql mysqldump -ukkday -pkkday123 kkday_b2c \
		> ./backups/kkday_b2c_$(TIMESTAMP).sql
	@echo "✅ 数据库已导出到 ./backups/kkday_b2c_$(TIMESTAMP).sql"

# 数据库恢复
db-restore:
	@test -f $(FILE) || (echo "❌ 用法: make db-restore FILE=path/to/dump.sql" && exit 1)
	docker exec -i kkday-mysql mysql -ukkday -pkkday123 kkday_b2c < $(FILE)
	@echo "✅ 数据库已恢复"

# 一键清理 + 重建
nuke: clean
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d
	@echo "✅ 全部重建完成"
```

> **小技巧**：`make logs SVC=php-fpm` 只看某个服务的日志。在 Makefile 里加上：
> ```makefile
> logs:
> 	$(COMPOSE) logs -f --tail=100 $(SVC)
> ```

## 14. 环境方案对比

市面上常见的本地开发环境方案有很多，以下是与 local-docker 的详细对比：

| 维度 | local-docker（本文） | Laravel Sail | Vagrant (Homestead) | 原生安装 |
|------|---------------------|--------------|---------------------|----------|
| **启动速度** | ⚡ 快（已构建镜像 < 30s） | ⚡ 快（首次拉镜像慢） | 🐢 慢（启动 VM 1-2 min） | ⚡ 即时 |
| **资源占用** | 🟢 低（共享容器） | 🟡 中（每项目一套） | 🔴 高（完整 VM） | 🟢 最低 |
| **多项目共享** | ✅ 所有仓库共用一套 | ❌ 每个项目独立 | ❌ 一个 VM 一套 | ⚠️ 端口易冲突 |
| **环境一致性** | ✅ Docker 镜像保证 | ✅ Docker 镜像保证 | ✅ VM 保证 | ❌ 依赖本地版本 |
| **学习成本** | 🟡 需懂 Docker Compose | 🟢 低（Laravel 官方） | 🟡 需懂 Vagrant/HCL | 🟢 低 |
| **M 芯片 Mac** | ✅ Colima 原生支持 | ✅ 原生支持 | ⚠️ 需 ARM box | ✅ 原生 |
| **适用团队规模** | 10-50 人（多仓库） | 1-5 人（单项目） | 5-20 人 | 1-2 人 |
| **邮件调试** | ✅ Mailhog 内置 | ✅ Mailpit 内置 | ⚠️ 需额外配置 | ❌ 需自建 |
| **IDE 调试** | ✅ Xdebug + PHPStorm | ✅ Xdebug + PHPStorm | ✅ Xdebug + PHPStorm | ✅ 原生最方便 |
| **维护成本** | 🟡 需维护 Dockerfile | 🟢 Laravel 官方维护 | 🟡 需维护 Vagrantfile | 🔴 版本升级痛苦 |

**选择建议**：

- **个人 / 小项目** → Laravel Sail 开箱即用，省心
- **团队多仓库** → local-docker（本文方案），统一环境，避免重复构建
- **需要完整 Linux 环境** → Vagrant，适合需要 systemd / cron 等系统级服务的场景
- **追求极致性能** → 原生安装，但要接受版本管理的痛苦

## 15. 常见问题排查（FAQ）

### Q1: MySQL 连接拒绝（Connection refused）

**错误信息**：
```
SQLSTATE[HY000] [2002] Connection refused
SQLSTATE[HY000] [2002] No such file or directory
```

**排查步骤**：

```bash
# 1. 确认 MySQL 容器是否在运行
docker ps | grep mysql

# 2. 查看 MySQL 日志，是否有启动错误
docker logs kkday-mysql --tail=50

# 3. 测试容器内连通性（从 PHP-FPM 容器内测试）
docker exec kkday-php-fpm php -r "
  \$pdo = new PDO('mysql:host=kkday-mysql;port=3306', 'kkday', 'kkday123');
  echo '连接成功';
"

# 4. 测试宿主机连通性（端口映射）
mysql -h 127.0.0.1 -P 3307 -ukkday -pkkday123 kkday_b2c
```

**常见原因与解法**：

| 原因 | 解法 |
|------|------|
| `.env` 里用了 `localhost` 而非容器名 | 容器内运行时改为 `DB_HOST=kkday-mysql` |
| 宿主机连接时用了 3306 而非 3307 | 改为 `DB_PORT=3307` 或 `mysql -P 3307` |
| MySQL 还没启动完成就连接了 | 加 `depends_on` 或用 healthcheck 等待 |
| Docker 网络异常 | `docker network ls && docker network inspect kkday-local` |

**推荐使用 healthcheck 等待 MySQL 就绪**：

```yaml
# docker-compose.yml
mysql:
  image: mysql:8.0
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
    interval: 5s
    timeout: 3s
    retries: 10
  # ...

php-fpm:
  depends_on:
    mysql:
      condition: service_healthy
```

### Q2: Redis 认证失败（NOAUTH Authentication required）

**错误信息**：
```
NOAUTH Authentication required
READONLY You can't write against a read only replica
```

**排查步骤**：

```bash
# 1. 测试 Redis 连通性
docker exec kkday-redis redis-cli ping
# 期望输出: PONG

# 2. 如果 redis.conf 设了密码，测试时需要带密码
docker exec kkday-redis redis-cli -a yourpassword ping

# 3. 检查 .env 里的 Redis 配置
grep REDIS .env
# 确认 REDIS_HOST=kkday-redis, REDIS_PORT=6379, REDIS_PASSWORD=你的密码

# 4. 清除 Laravel 缓存配置（改了 .env 后必须做）
php artisan config:clear
php artisan cache:clear
```

**常见原因与解法**：

| 原因 | 解法 |
|------|------|
| `redis.conf` 里设了 `requirepass` 但 `.env` 没配 | 在 `.env` 加 `REDIS_PASSWORD=yourpassword` |
| 用了 sentinel/cluster 模式但只配了单机 | 开发环境用单机模式即可 |
| Laravel 缓存了旧配置 | `php artisan config:clear` |
| Redis 6+ 默认开启 protected-mode | `redis.conf` 加 `protected-mode no` 或设密码 |

### Q3: Mailhog 收不到邮件

**错误信息**：Laravel 发邮件后 `http://localhost:8025` 收件箱为空。

**排查步骤**：

```bash
# 1. 确认 Mailhog 容器在运行
docker ps | grep mailhog

# 2. 测试 SMTP 端口连通性
docker exec kkday-php-fpm sh -c "echo 'test' | nc -w3 kkday-mailhog 1025"

# 3. 用 telnet 手动发一封测试邮件
docker exec -it kkday-php-fpm bash
apt-get install -y telnet
telnet kkday-mailhog 1025
# 输入以下内容：
# HELO test
# MAIL FROM:<test@test.com>
# RCPT TO:<user@example.com>
# DATA
# Subject: Test Email
#
# Hello from Mailhog!
# .
# QUIT

# 4. 检查 Laravel 的邮件配置
php artisan tinker
# >>> Mail::raw('Test', function($msg) { $msg->to('test@test.com')->subject('Test'); });
```

**常见原因与解法**：

| 原因 | 解法 |
|------|------|
| `.env` 里 `MAIL_HOST` 不对 | 容器内用 `kkday-mailhog`，宿主机用 `127.0.0.1` |
| 混用了 Gmail/SES 等真实 SMTP | 开发环境 `.env` 强制配 Mailhog，不要混用 |
| `MAIL_ENCRYPTION=tls` 导致连不上 | Mailhog 不支持 TLS，改为 `null` |
| 队列异步发邮件，队列 worker 没跑 | `php artisan queue:work` 或同步发 `MAIL_MAILER=log` |

### Q4: Docker 磁盘空间不足

**错误信息**：
```
ERROR: failed to solve: no space left on device
Error response from daemon: write /var/lib/docker/...: no space left on device
```

**排查步骤**：

```bash
# 1. 查看 Docker 磁盘使用详情
docker system df -v

# 2. 查看哪些镜像/容器/卷最占空间
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | sort -k3 -h
docker volume ls --format "table {{.Name}}\t{{.Driver}}" | head -20

# 3. 清理悬空镜像（dangling images）
docker image prune -f

# 4. 清理停止的容器
docker container prune -f

# 5. 清理未使用的卷（⚠️ 会删除数据！）
docker volume prune -f

# 6. 一键清理所有未使用资源（慎用）
docker system prune -af --volumes

# 7. Colima 用户额外操作：fstrim 回收已删除文件的空间
colima ssh -- sudo fstrim /var/lib/docker
```

**预防措施**：

```bash
# 定期清理脚本（可以加到 crontab）
#!/bin/bash
echo "=== Docker 磁盘清理 ==="
docker image prune -f
docker container prune -f
docker system df
echo "=== 清理完成 ==="
```

> **Colima 用户注意**：Colima 的 VM 磁盘默认不会自动回收空间。每次大量删除镜像后，记得跑 `colima ssh -- sudo fstrim /var/lib/docker`。

### Q5: Xdebug 连不上 IDE

**错误信息**：PHPStorm 断点不生效，Xdebug 日志显示 `Could not connect to debugging client`。

**排查步骤**：

```bash
# 1. 确认 Xdebug 已加载
docker exec kkday-php-fpm php -m | grep xdebug

# 2. 检查 Xdebug 配置
docker exec kkday-php-fpm php -i | grep xdebug.client
# 期望: xdebug.client_host => host.docker.internal
# 期望: xdebug.client_port => 9003

# 3. 测试 host.docker.internal 是否可解析（Colima 用户注意）
docker exec kkday-php-fpm getent hosts host.docker.internal
# 如果解析失败，说明 Colima 没有启用 --network-address

# 4. 检查 PHPStorm 是否在监听 9003
# PHPStorm → Settings → PHP → Debug → Xdebug → 端口: 9003
# 确认 "Start listening for PHP Debug Connections" 已点击
```

**常见原因与解法**：

| 原因 | 解法 |
|------|------|
| Colima 没有 `--network-address` | `colima start --network-address` 重启 VM |
| PHPStorm 没有监听 9003 | 点击电话图标 "Start Listening" |
| IDE Key 不匹配 | `php.ini` 里 `xdebug.idekey=PHPSTORM`，PHPStorm 也设为 `PHPSTORM` |
| 防火墙阻断 | macOS 系统偏好设置 → 防火墙 → 允许 PHPStorm 接收入站连接 |
| Xdebug 版本与 PHP 不兼容 | PHP 8.0 用 Xdebug 3.x，不要用 2.x |

**Colima 用户完整配置**：

```bash
# 启动 Colima 时必须加 --network-address
colima start --cpu 4 --memory 8 --disk 60 \
  --vm-type vz --mount-type virtiofs \
  --network-address

# 验证 VM 有独立 IP
colima list
# 输出会多一列 ADDRESS，如 192.168.105.2
```

## 16. 性能调优小贴士

开发环境虽然不需要生产级性能，但卡顿会严重影响开发体验。以下是实测有效的调优方法：

### 16.1 挂载性能优化（macOS 重点）

macOS 的文件系统挂载是 Docker 性能的最大瓶颈。Colima + virtiofs 比默认的 sshfs 快 3-5 倍：

```bash
# 启动 Colima 时指定 virtiofs（推荐）
colima start --vm-type vz --mount-type virtiofs

# 验证挂载类型
mount | grep virtiofs
```

如果仍然觉得慢，可以考虑只挂载需要的目录，而不是整个 `~/GitHub`：

```yaml
# docker-compose.yml — 精确挂载
volumes:
  - ${HOME}/GitHub/project-a:/var/www/html/project-a
  - ${HOME}/GitHub/project-b:/var/www/html/project-b
```

### 16.2 MySQL 查询缓存

开发环境频繁跑 migration 和 seed，可以适当调大 InnoDB 缓冲池：

```ini
# mysql/my.cnf
[mysqld]
innodb_buffer_pool_size = 512M    # 给开发机 8G 内存的话，512M 够用
innodb_log_file_size = 256M       # 减少磁盘写入
innodb_flush_log_at_trx_commit = 2  # 开发环境放宽，生产环境必须为 1
```

### 16.3 PHP OPcache 配置

开发环境的 OPcache 配置和生产完全不同——需要频繁失效：

```ini
; php.ini — 开发环境 OPcache
[opcache]
opcache.enable = 1
opcache.revalidate_freq = 0        # 每次请求都检查文件变更
opcache.validate_timestamps = 1    # 必须开启
opcache.max_accelerated_files = 10000
opcache.memory_consumption = 256
opcache.jit_buffer_size = 64M      # PHP 8.0 JIT
```

### 16.4 Redis 持久化策略

开发环境用 RDB 够了，AOF 会拖慢写入速度：

```conf
# redis/redis.conf
save 60 1000          # 60 秒内有 1000 次写入才持久化
appendonly no          # 关闭 AOF（开发环境）
```

如果遇到 Redis 内存爆满（大量队列任务），可以临时清空：

```bash
docker exec kkday-redis redis-cli FLUSHALL
```

## 17. 团队协作规范

多人共用一套 local-docker 环境时，需要约定一些规范，避免互相踩脚：

### 17.1 容器命名与端口规范

所有容器统一以 `kkday-` 前缀命名，端口映射固定：

| 服务 | 容器名 | 宿主机端口 | 容器内端口 |
|------|--------|-----------|-----------|
| PHP-FPM | kkday-php-fpm | 9000 | 9000 |
| MySQL | kkday-mysql | 3307 | 3306 |
| Redis | kkday-redis | 6380 | 6379 |
| Mailhog | kkday-mailhog | 1025 / 8025 | 1025 / 8025 |

> **为什么不用默认端口？** 很多开发者本地装了 MySQL（brew install mysql），默认占了 3306。如果 Docker 也用 3306 就会冲突。统一用 3307/6380 可以避免这类问题。

### 17.2 数据库命名规范

每个仓库在 `kkday_b2c` 数据库里建自己的表，表名加仓库前缀：

```sql
-- bff 仓库
CREATE TABLE bff_products (...);
CREATE TABLE bff_categories (...);

-- member 仓库
CREATE TABLE member_users (...);
CREATE TABLE member_profiles (...);
```

### 17.3 `.env.example` 约定

每个仓库的 `.env.example` 必须包含完整的 Docker 环境配置：

```env
# .env.example — 开发环境默认配置（local-docker）
DB_CONNECTION=mysql
DB_HOST=kkday-mysql
DB_PORT=3306
DB_DATABASE=kkday_b2c
DB_USERNAME=kkday
DB_PASSWORD=kkday123

REDIS_HOST=kkday-redis
REDIS_PORT=6379

MAIL_MAILER=smtp
MAIL_HOST=kkday-mailhog
MAIL_PORT=1025
MAIL_ENCRYPTION=null
```

新人 clone 仓库后，直接 `cp .env.example .env` 即可，零配置。

---

*本文基于 KKday B2C Backend Team 的 local-docker 实际使用经验，涉及 PHP-FPM 8.0 / MySQL 8.0 / Redis 7 / Mailhog / Colima。配置已覆盖 30+ 个 Laravel 仓库的日常开发需求。*

## 相关阅读

- [Docker Compose 5.x 实战](/categories/DevOps/docker-compose-5-x-guide-orchestration-laravel/) — Compose 新特性与多服务编排实战
- [Docker-Compose-Laravel 本地开发环境实战](/categories/DevOps/docker-compose-laravel-guide-php-fpm-8-3-mysql-redis-mailpit-guide/) — PHP-FPM 8.3 + Mailpit 新一代方案
- [Docker 网络实战](/categories/DevOps/docker-guide-bridge-host-overlay-service-discovery/) — Bridge/Host/Overlay 网络模式详解
