---
title: Docker Compose + PHP-FPM 实战：KKday B2C API 微服务部署经验
date: 2026-05-02
categories:
  - DevOps
  - Docker
tags: [Docker, PHP]
description: 真实项目中的 Docker Compose + PHP-FPM 微服务部署实战经验，包含服务依赖启动、缓存挂载、性能调优等完整案例



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

---

## ⚠️ 真实踩坑记录与解决方案

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

**📬 欢迎反馈：**

如有 Docker Compose 相关问题，请在 GitHub Issues 提交讨论。

**🌟 Star Support：**

如果喜欢本文，请为仓库点 Star ⭐️ 支持！
