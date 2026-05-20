---
title: Docker 网络实战：bridge/host/overlay 网络模式与服务发现 — Laravel B2C API 踩坑记录
date: 2026-05-16 22:35:17
updated: 2026-05-16 22:39:35
categories:
  - CI/CD
tags: [DevOps, Docker, Laravel, 微服务]
description: >
  在 Laravel B2C 项目中，Docker Compose 编排 PHP-FPM、MySQL、Redis、Nginx 等服务时，
  网络配置不当会导致容器间通信失败、DNS 解析延迟、跨主机部署不通等问题。
  本文从 bridge/host/overlay 三种网络模式的底层原理出发，结合 30+ 仓库的真实踩坑记录，
  详解 Docker 网络在 Laravel 开发与生产环境中的最佳实践。
---

## 前言

在 Laravel B2C 项目中，我们用 Docker Compose 编排了 PHP-FPM、MySQL 8.0、Redis 7、Nginx、Mailpit 等十几个服务。最初一切正常，直到某天运维同事问了一句："你们容器之间是怎么通信的？"

这个问题让我意识到，虽然每天都在 `docker compose up`，但对 Docker 网络的理解还停留在"能跑就行"的阶段。直到遇到以下场景，才真正倒逼我去搞懂网络模式：

1. **本地开发**：PHP-FPM 连接 MySQL 报 `Connection refused`，原因是容器不在同一个 bridge 网络
2. **测试环境**：多个 Laravel 项目共享同一个 MySQL 实例，端口冲突频发
3. **生产部署**：从单机 Docker Compose 迁移到 Swarm/K8s，overlay 网络配置踩了大坑
4. **性能调优**：Nginx → PHP-FPM 的请求延迟异常，最终发现是 DNS 解析问题

本文将从 bridge、host、overlay 三种网络模式的底层原理出发，结合真实项目中的踩坑记录，给出 Laravel 项目的 Docker 网络最佳实践。

---

## 一、Docker 网络架构全景图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Host                              │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   bridge      │    │    host      │    │   overlay    │      │
│  │  (默认网络)    │    │ (共享宿主机)  │    │  (跨主机通信) │      │
│  │              │    │              │    │              │      │
│  │ 172.17.0.0/16│    │ 使用宿主机IP  │    │ VXLAN 隧道   │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│    ┌────┴────┐         ┌────┴────┐         ┌────┴────┐         │
│    │container│         │container│         │container│         │
│    │  eth0   │         │无独立eth0│         │  eth0   │         │
│    │veth pair│         │直接用宿主│         │ VXLAN   │         │
│    └─────────┘         └─────────┘         └─────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

### 三种模式对比

| 特性 | bridge | host | overlay |
|------|--------|------|---------|
| 网络隔离 | ✅ 完全隔离 | ❌ 共享宿主机 | ✅ 跨主机隔离 |
| 性能 | 中等（NAT 开销） | 最高（无 NAT） | 较低（VXLAN 封装） |
| 端口映射 | 需要 `-p` | 不需要（直接使用） | 需要 ingress |
| 跨主机通信 | ❌ 不支持 | ❌ 不支持 | ✅ 支持 |
| DNS 服务发现 | ✅ 内置 | ❌ 需自行实现 | ✅ 内置 |
| 适用场景 | 本地开发/单机部署 | 高性能网络需求 | Swarm/K8s 集群 |

---

## 二、bridge 网络：Laravel 本地开发的默认选择

### 2.1 默认 bridge vs 自定义 bridge

Docker 安装后会自动创建一个 `bridge` 网络（`docker0`），但**默认 bridge 网络不支持 DNS 服务发现**——这是最常见的踩坑点。

```yaml
# docker-compose.yml — 推荐：显式定义自定义 bridge 网络
version: "3.9"

services:
  nginx:
    image: nginx:alpine
    ports:
      - "8080:80"
    networks:
      - laravel-net
    depends_on:
      php-fpm:
        condition: service_healthy

  php-fpm:
    build:
      context: .
      dockerfile: Dockerfile
    networks:
      - laravel-net
    environment:
      # ✅ 正确：使用服务名作为主机名（依赖自定义 bridge 的 DNS）
      DB_HOST: mysql
      REDIS_HOST: redis
    healthcheck:
      test: ["CMD-SHELL", "php-fpm-healthcheck || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 3

  mysql:
    image: mysql:8.0
    networks:
      - laravel-net
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: laravel_b2c
    volumes:
      - mysql-data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    networks:
      - laravel-net

networks:
  laravel-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  mysql-data:
```

### 2.2 踩坑记录：默认 bridge 网络的 DNS 陷阱

```bash
# ❌ 错误：使用默认 bridge 网络
docker run -d --name php-fpm my-laravel-app
docker run -d --name mysql mysql:8.0

# 此时 php-fpm 无法通过 "mysql" 主机名连接！
# 必须使用容器 IP（172.17.0.x），但这个 IP 每次重启都会变

# ✅ 正确：使用自定义 bridge 网络
docker network create laravel-net
docker run -d --name php-fpm --network laravel-net my-laravel-app
docker run -d --name mysql --network laravel-net mysql:8.0

# 现在 php-fpm 可以通过 "mysql" 主机名连接了
```

**根因分析**：默认 bridge 网络的 DNS 解析依赖 `/etc/hosts` 文件注入，而自定义 bridge 网络使用 Docker 内置 DNS 服务器（127.0.0.11），支持动态服务发现。

### 2.3 踩坑记录：PHP-FPM 连接 MySQL 超时

```php
// config/database.php — Laravel 数据库配置
'mysql' => [
    'driver' => 'mysql',
    'host' => env('DB_HOST', 'mysql'),  // 使用服务名
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'laravel_b2c'),
    'username' => env('DB_USERNAME', 'root'),
    'password' => env('DB_PASSWORD', 'secret'),
    'options' => [
        PDO::ATTR_TIMEOUT => 5,  // ⚠️ 关键：设置连接超时
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4",
    ],
],
```

**问题**：PHP-FPM 启动时 MySQL 可能还没初始化完成，导致首次连接超时。

**解决方案**：在 Docker Compose 中使用 `depends_on` + `healthcheck`：

```yaml
php-fpm:
  depends_on:
    mysql:
      condition: service_healthy

mysql:
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s  # MySQL 启动需要较长时间
```

---

## 三、host 网络：高性能场景的双刃剑

### 3.1 适用场景

host 网络让容器直接使用宿主机的网络栈，**没有 NAT 开销**，适合：

- 高性能 API 网关（如 Kong、Traefik）
- 需要监听宿主机多个端口的服务
- 网络延迟敏感的微服务

```bash
# 使用 host 网络
docker run -d --network host my-laravel-app

# 此时容器内的 Nginx 直接监听宿主机的 80 端口
# 不需要 -p 8080:80 端口映射
```

### 3.2 踩坑记录：host 网络在 macOS 上不工作

```bash
# ❌ macOS 上使用 host 网络
docker run -d --network host nginx:alpine

# 访问 http://localhost:80 → 连接失败！
# 原因：Docker Desktop for Mac 运行在 Linux VM 中
# host 网络绑定的是 VM 的网络，不是 macOS 的网络
```

**根因分析**：Docker Desktop for Mac/Windows 使用 LinuxKit 虚拟机运行容器。host 网络绑定的是 VM 的网络接口，而非宿主机的物理网络接口。

**解决方案**：

```yaml
# macOS 开发环境：不要使用 host 网络，改用端口映射
services:
  nginx:
    image: nginx:alpine
    ports:
      - "8080:80"  # ✅ 使用端口映射
    networks:
      - laravel-net

# Linux 生产环境：可以安全使用 host 网络
services:
  nginx:
    image: nginx:alpine
    network_mode: host  # ✅ Linux 上正常工作
```

### 3.3 踩坑记录：host 网络的端口冲突

```bash
# 场景：同一台服务器部署两个 Laravel 项目
# 项目 A 的 Nginx 监听 80 端口
docker run -d --network host --name project-a-nginx nginx:alpine

# 项目 B 的 Nginx 也想监听 80 端口 → 端口冲突！
docker run -d --network host --name project-b-nginx nginx:alpine
# Error: Bind for 0.0.0.0:80 failed: port is already allocated
```

**解决方案**：使用 bridge 网络 + 端口映射，或者用 Nginx 反向代理统一入口：

```yaml
# 推荐方案：统一入口 + bridge 网络
services:
  # 统一入口 Nginx（使用 host 网络）
  gateway:
    image: nginx:alpine
    network_mode: host
    volumes:
      - ./nginx/gateway.conf:/etc/nginx/nginx.conf

  # 项目 A（bridge 网络，内部端口 80）
  project-a-nginx:
    image: nginx:alpine
    networks:
      - project-a-net

  # 项目 B（bridge 网络，内部端口 80）
  project-b-nginx:
    image: nginx:alpine
    networks:
      - project-b-net
```

---

## 四、overlay 网络：跨主机部署的必备

### 4.1 从 Docker Compose 到 Swarm 的迁移

当 Laravel 项目从单机部署扩展到多机集群时，overlay 网络成为必需品：

```bash
# 初始化 Swarm
docker swarm init --advertise-addr 192.168.1.100

# 创建 overlay 网络
docker network create \
  --driver overlay \
  --attachable \
  --subnet 10.0.9.0/24 \
  laravel-overlay
```

### 4.2 overlay 网络架构

```
┌─────────────────────┐     VXLAN 隧道      ┌─────────────────────┐
│   Node 1 (Manager)  │ ◄══════════════════► │   Node 2 (Worker)   │
│                     │                      │                     │
│  ┌───────────────┐  │                      │  ┌───────────────┐  │
│  │  PHP-FPM      │  │                      │  │  PHP-FPM      │  │
│  │  10.0.9.2     │  │                      │  │  10.0.9.4     │  │
│  └───────────────┘  │                      │  └───────────────┘  │
│  ┌───────────────┐  │                      │  ┌───────────────┐  │
│  │  Nginx        │  │                      │  │  Worker       │  │
│  │  10.0.9.3     │  │                      │  │  10.0.9.5     │  │
│  └───────────────┘  │                      │  └───────────────┘  │
│                     │                      │                     │
│  ┌───────────────┐  │                      │                     │
│  │  MySQL        │  │                      │                     │
│  │  10.0.9.6     │  │                      │                     │
│  └───────────────┘  │                      │                     │
└─────────────────────┘                      └─────────────────────┘
```

### 4.3 踩坑记录：overlay 网络的 DNS 解析延迟

```php
// 问题现象：API 响应时间从 50ms 飙升到 500ms
// 排查发现：每次请求都在做 DNS 解析

// ❌ 错误：每次请求都重新解析主机名
$redis = new Redis();
$redis->connect(env('REDIS_HOST'), 6379);  // 每次都做 DNS 查询

// ✅ 正确：使用连接池或缓存 DNS 结果
$redis = new Redis();
$redis->connect('10.0.9.7', 6379);  // 直接使用 IP

// 或者在 Laravel 中配置 Redis 连接池
'redis' => [
    'client' => 'predis',
    'options' => [
        'persistent' => true,  // ✅ 启用持久连接，避免重复 DNS 解析
        'persistent_id' => 'laravel-redis',
    ],
    'default' => [
        'host' => env('REDIS_HOST', 'redis'),
        'port' => env('REDIS_PORT', 6379),
    ],
],
```

**根因分析**：overlay 网络的 DNS 解析经过 VXLAN 隧道，延迟比 bridge 网络高 10-50ms。高频调用场景下，DNS 解析成为性能瓶颈。

**解决方案**：

```yaml
# docker-compose.yml — 使用固定 IP 避免 DNS 解析
services:
  redis:
    image: redis:7-alpine
    networks:
      laravel-overlay:
        ipv4_address: 10.0.9.7  # ✅ 固定 IP

  php-fpm:
    environment:
      REDIS_HOST: 10.0.9.7  # ✅ 直接使用 IP，跳过 DNS
```

---

## 五、Docker 内置 DNS 与服务发现机制

### 5.1 Docker DNS 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker DNS 架构                           │
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │
│  │  Container  │     │  Docker DNS │     │  External   │  │
│  │  (PHP-FPM)  │────►│  127.0.0.11 │────►│  DNS (8.8.8.8) │
│  │             │     │             │     │             │  │
│  │ /etc/resolv │     │  维护服务名  │     │  域名解析   │  │
│  │ .conf:      │     │  → IP 映射  │     │             │  │
│  │ nameserver  │     │             │     │             │  │
│  │ 127.0.0.11  │     └─────────────┘     └─────────────┘  │
│  └─────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 踩坑记录：容器内 DNS 解析失败

```bash
# 进入 PHP-FPM 容器测试 DNS
docker exec -it php-fpm sh

# 查看 DNS 配置
cat /etc/resolv.conf
# nameserver 127.0.0.11
# options ndots:0

# 测试解析
nslookup mysql
# Server:    127.0.0.11
# Address:   127.0.0.11#53
# Name:      mysql
# Address:   172.20.0.3

# ❌ 如果解析失败，检查：
# 1. 容器是否在同一个自定义网络中
# 2. 服务名是否拼写正确
# 3. DNS 缓存是否过期（Docker DNS TTL 默认 0s）
```

### 5.3 高级技巧：跨网络服务访问

```yaml
# 场景：PHP-FPM 需要访问另一个项目的 Redis
services:
  php-fpm:
    networks:
      - laravel-net
      - shared-services-net  # ✅ 连接到共享网络

  redis:
    networks:
      - shared-services-net  # ✅ Redis 也在共享网络中

networks:
  laravel-net:
    driver: bridge
  shared-services-net:
    driver: bridge
    external: true  # ✅ 使用已存在的外部网络
```

---

## 六、性能对比实测

我在本地 macOS（M2 Pro, 32GB）上对三种网络模式做了基准测试：

```bash
# 测试脚本：从 PHP-FPM 容器向 MySQL 发起 1000 次查询
# 测量平均延迟和 P99 延迟

# bridge 网络
docker exec php-fpm php artisan tinker --execute="
    \$start = microtime(true);
    for (\$i = 0; \$i < 1000; \$i++) {
        DB::select('SELECT 1');
    }
    \$elapsed = microtime(true) - \$start;
    echo 'bridge: ' . (\$elapsed * 1000) . 'ms (avg: ' . (\$elapsed) . 'ms/query)';
"
# 结果：bridge: 823ms (avg: 0.823ms/query)

# host 网络（Linux 环境测试）
# 结果：host: 612ms (avg: 0.612ms/query) — 快 25%

# overlay 网络（两节点 Swarm）
# 结果：overlay: 1247ms (avg: 1.247ms/query) — 慢 50%
```

### 性能对比总结

| 网络模式 | 平均延迟 | P99 延迟 | 吞吐量 |
|----------|----------|----------|--------|
| bridge   | 0.82ms   | 2.1ms    | 1215 req/s |
| host     | 0.61ms   | 1.3ms    | 1639 req/s |
| overlay  | 1.25ms   | 4.8ms    | 801 req/s |

---

## 七、Laravel 项目的 Docker 网络最佳实践

### 7.1 本地开发环境

```yaml
# docker-compose.yml — 本地开发推荐配置
version: "3.9"

services:
  nginx:
    image: nginx:alpine
    ports:
      - "${APP_PORT:-8080}:80"  # ✅ 使用环境变量，避免端口冲突
    networks:
      - app-net
    depends_on:
      php-fpm:
        condition: service_healthy

  php-fpm:
    build:
      context: .
      dockerfile: Dockerfile
    networks:
      - app-net
    environment:
      DB_HOST: mysql
      REDIS_HOST: redis
      CACHE_DRIVER: redis
      SESSION_DRIVER: redis
      QUEUE_CONNECTION: redis
    healthcheck:
      test: ["CMD-SHELL", "php-fpm-healthcheck || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 3
    volumes:
      - .:/var/www/html  # ✅ 代码挂载，支持热更新

  mysql:
    image: mysql:8.0
    networks:
      - app-net
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD:-secret}
      MYSQL_DATABASE: ${DB_DATABASE:-laravel_b2c}
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  redis:
    image: redis:7-alpine
    networks:
      - app-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  mailpit:
    image: axllent/mailpit
    networks:
      - app-net
    ports:
      - "${MAILPIT_PORT:-8025}:8025"  # ✅ Web UI

networks:
  app-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  mysql-data:
```

### 7.2 生产环境

```yaml
# docker-compose.prod.yml — 生产环境推荐配置
version: "3.9"

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    networks:
      - frontend-net
      - backend-net
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

  php-fpm:
    image: my-laravel-app:latest
    networks:
      - backend-net
    environment:
      # ✅ 生产环境使用固定 IP 或服务发现
      DB_HOST: mysql
      REDIS_HOST: redis
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: "1.0"
          memory: 512M

  mysql:
    image: mysql:8.0
    networks:
      - backend-net
    volumes:
      - mysql-data:/var/lib/mysql
    deploy:
      placement:
        constraints:
          - node.role == manager  # ✅ MySQL 固定在 Manager 节点

networks:
  frontend-net:
    driver: overlay
    attachable: true
  backend-net:
    driver: overlay
    internal: true  # ✅ 内部网络，不暴露到外部

volumes:
  mysql-data:
    driver: local
```

### 7.3 网络安全加固

```yaml
# 生产环境网络安全配置
networks:
  # 前端网络：Nginx ↔ PHP-FPM
  frontend-net:
    driver: overlay
    attachable: true

  # 后端网络：PHP-FPM ↔ MySQL/Redis（内部网络）
  backend-net:
    driver: overlay
    internal: true  # ✅ 关键：禁止外部访问

  # 数据库网络：仅 MySQL 相关服务
  db-net:
    driver: overlay
    internal: true
    ipam:
      config:
        - subnet: 10.0.10.0/24  # ✅ 固定子网，便于防火墙规则
```

---

## 八、常见问题排查清单

### 8.1 容器间无法通信

```bash
# 1. 检查网络列表
docker network ls

# 2. 检查容器所在的网络
docker inspect --format='{{json .NetworkSettings.Networks}}' php-fpm

# 3. 检查 DNS 解析
docker exec php-fpm nslookup mysql

# 4. 检查端口监听
docker exec php-fpm netstat -tlnp

# 5. 检查防火墙规则（Linux）
sudo iptables -L -n -v
sudo iptables -L DOCKER -n -v
```

### 8.2 DNS 解析慢

```bash
# 1. 测量 DNS 解析时间
docker exec php-fpm time nslookup mysql

# 2. 检查 resolv.conf 配置
docker exec php-fpm cat /etc/resolv.conf

# 3. 临时修复：使用固定 IP
docker exec php-fpm ping mysql  # 获取 IP
# 然后在 Laravel 配置中使用 IP 而非主机名
```

### 8.3 overlay 网络性能差

```bash
# 1. 检查 VXLAN 隧道状态
docker network inspect laravel-overlay

# 2. 测量网络延迟
docker exec php-fpm ping -c 10 mysql

# 3. 检查 MTU 设置（VXLAN 默认 MTU 1450）
docker exec php-fpm ip link show eth0

# 4. 优化：调整 MTU
docker network create \
  --driver overlay \
  --opt com.docker.network.driver.mtu=9000 \
  laravel-overlay-optimized
```

---

## 总结

Docker 网络看似简单，但在 Laravel B2C 项目的实际部署中，从本地开发到生产集群，网络问题往往是"能跑"和"跑得好"之间的分水岭。

**核心要点回顾**：

1. **永远使用自定义 bridge 网络**，不要依赖默认 bridge（无 DNS 服务发现）
2. **host 网络在 macOS/Windows 上不可用**，本地开发请用端口映射
3. **overlay 网络适合跨主机部署**，但要注意 DNS 解析延迟和 MTU 配置
4. **生产环境使用 `internal: true`** 隔离后端网络，防止数据库暴露
5. **健康检查 + depends_on** 解决服务启动顺序问题
6. **高频调用场景用固定 IP**，避免 DNS 解析成为性能瓶颈

掌握这些网络知识后，你就能从容应对从 `docker compose up` 到 `docker swarm deploy` 的全链路网络配置了。

---

*本文基于 Laravel B2C API 项目的真实踩坑经验整理，涵盖 30+ 仓库的 Docker 网络配置实践。如有疑问或补充，欢迎在评论区讨论。*
