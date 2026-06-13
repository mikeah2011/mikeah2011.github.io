---
title: 负载均衡实战：Nginx Upstream + Laravel Session 共享方案踩坑记录
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-05 07:30:03
updated: 2026-05-05 07:32:58
categories:
  - architecture
  - php
tags: [KKday, Laravel, Nginx, Redis, 架构]
keywords: [Nginx Upstream, Laravel Session, 负载均衡实战, 共享方案踩坑记录, 架构, PHP]
description: 从单机 Laravel 到 Nginx 多实例负载均衡的真实踩坑记录。覆盖 Upstream 配置、Session 共享方案选型（Cookie / Sticky / Redis / Database）、健康检查、会话一致性与生产环境故障恢复。



---

# 前言

单机 Laravel 跑得好好的，一上负载均衡就出 bug —— 这是我在 KKday B2C API 项目中亲身经历的事。用户购物车突然清空、CSRF token 校验失败、后台登录莫名失效，全都是因为 **Session 粘性没处理好**。

本文记录的是从 `1 台 PHP-FPM` 扩到 `3 台 + Nginx Upstream` 的完整过程，包含 Nginx 配置、Session 共享方案选型、健康检查、以及一个生产环境 P0 故障的复盘。

**适用场景**：Laravel 8+ / PHP 8.0 / Nginx 1.22+ / Redis 6.x / Docker Compose 部署

---

# 一、架构全景

```
                    ┌─────────────────────────────────────┐
                    │           Client (Browser)           │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │        Nginx (Reverse Proxy)         │
                    │   upstream laravel_backend {         │
                    │       least_conn;                    │
                    │       server php-fpm-1:9000;         │
                    │       server php-fpm-2:9000;         │
                    │       server php-fpm-3:9000;         │
                    │   }                                  │
                    └──────┬──────────┬──────────┬────────┘
                           │          │          │
                    ┌──────▼──┐ ┌─────▼────┐ ┌──▼──────┐
                    │PHP-FPM 1│ │ PHP-FPM 2│ │PHP-FPM 3│
                    │ Laravel │ │ Laravel  │ │ Laravel │
                    └────┬────┘ └────┬─────┘ └────┬────┘
                         │           │            │
                    ┌────▼───────────▼────────────▼────┐
                    │     Shared State Layer            │
                    │  Redis (Session + Cache + Queue)  │
                    │  MySQL/PostgreSQL (Database)      │
                    └───────────────────────────────────┘
```

单机时代，Session 存在本地文件 (`storage/framework/sessions`)，没有任何问题。但当请求被分发到不同实例时，用户的第一个请求落在 `php-fpm-1`，第二个请求可能落在 `php-fpm-2` —— 如果 Session 没有共享，一切就崩了。

---

# 二、Nginx Upstream 配置实战

## 2.1 基础配置

```nginx
# /etc/nginx/conf.d/laravel-upstream.conf

upstream laravel_backend {
    # 负载策略选择
    least_conn;                   # 最少连接数（推荐 B2C 场景）
    # round-robin;                # 轮询（默认，适合无状态 API）
    # ip_hash;                    # IP 哈希（天然粘性，但 CDN 后面全是同一 IP）
    # hash $request_uri consistent;  # 一致性哈希（适合缓存场景）

    server php-fpm-1:9000  weight=3 max_fails=3 fail_timeout=30s;
    server php-fpm-2:9000  weight=3 max_fails=3 fail_timeout=30s;
    server php-fpm-3:9000  weight=3 max_fails=3 fail_timeout=30s;

    keepalive 32;  # 长连接池，减少 TCP 握手开销
}

server {
    listen 80;
    server_name api.kkday.com;

    location ~ \.php$ {
        fastcgi_pass laravel_backend;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;

        # 关键：必须传递这些 header
        fastcgi_param HTTP_X_FORWARDED_FOR   $proxy_add_x_forwarded_for;
        fastcgi_param HTTP_X_FORWARDED_PROTO $scheme;
        fastcgi_param HTTP_X_FORWARDED_HOST  $host;

        # FastCGI 超时设置
        fastcgi_connect_timeout 5s;
        fastcgi_send_timeout    60s;
        fastcgi_read_timeout    60s;

        # FastCGI 缓冲（避免大响应阻塞）
        fastcgi_buffers     16 16k;
        fastcgi_buffer_size 32k;

        # 长连接复用
        fastcgi_keep_conn on;
    }
}
```

## 2.2 踩坑 1：`least_conn` vs `round-robin`

我们在生产环境最初用的是 `round-robin`（默认轮询），结果发现一个诡异的问题：**同一用户的请求被均匀分到 3 台机器，但其中一台的 CPU 飙到 90%，另外两台只有 30%**。

原因是轮询不考虑每台机器当前正在处理的连接数。某些慢请求（报表导出、大文件上传）会长时间占用进程，轮询继续往这台机器塞新请求，导致雪崩。

改用 `least_conn` 后，新请求会优先分配给当前连接数最少的实例，负载更均匀。

```nginx
# least_conn 效果示意
# php-fpm-1: 当前 5 连接
# php-fpm-2: 当前 3 连接  ← 新请求分配到这里
# php-fpm-3: 当前 4 连接
```

## 2.3 踩坑 2：`ip_hash` 在 CDN 后面失效

我们一度想用 `ip_hash` 来实现天然的 Session 粘性（同一 IP 始终打到同一实例）。但问题是：

```
Client → CDN (Cloudflare) → Nginx → PHP-FPM
         ↑
         这层会把所有客户端 IP 变成 CDN 节点 IP
```

Cloudflare / AWS CloudFront 的出口 IP 段是有限的，`ip_hash` 会把所有用户路由到同一台 PHP-FPM，等于没有负载均衡。

**解决方案**：必须用 CDN 传递的真实 IP header：

```nginx
# 从 CDN header 获取真实 IP
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
# ... Cloudflare 全部 IP 段
real_ip_header CF-Connecting-IP;
real_ip_recursive on;
```

但即使配了真实 IP，我们最终还是放弃了 `ip_hash`，转用 Redis Session —— 因为移动网络用户的 IP 会变（4G/WiFi 切换），IP 粘性会导致 Session 中断。

---

# 三、Session 共享方案选型

这是整个改造中最关键的决策。我们评估了 4 种方案：

## 3.1 方案对比矩阵

| 方案 | 实现复杂度 | 扩展性 | 故障影响 | 适用场景 |
|------|-----------|--------|---------|---------|
| Cookie Session | 低 | 好 | 无 | 数据量 < 4KB |
| Sticky Session (ip_hash) | 低 | 差 | 实例宕机丢 Session | 小规模临时方案 |
| Redis Session | 中 | 好 | Redis 宕机全局影响 | **推荐：B2C 生产** |
| Database Session | 中 | 中 | 数据库压力增加 | Redis 不可用时的降级 |

## 3.2 Redis Session（生产方案）

Laravel 修改 `.env`：

```env
SESSION_DRIVER=redis
SESSION_CONNECTION=session
SESSION_LIFETIME=120
SESSION_EXPIRE_ON_CLOSE=false
```

`config/database.php` 中独立配置 Session Redis 连接：

```php
'redis' => [
    'client' => 'predis',
    'options' => [
        'cluster' => env('REDIS_CLUSTER', false),
        'prefix' => env('REDIS_PREFIX', 'kkday_'),
    ],
    'default' => [
        'url'      => env('REDIS_URL'),
        'host'     => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port'     => env('REDIS_PORT', 6379),
        'database' => env('REDIS_DB', 0),
    ],
    // 独立 Session 连接 —— 不要和业务缓存混用
    'session' => [
        'url'      => env('REDIS_SESSION_URL'),
        'host'     => env('REDIS_SESSION_HOST', '127.0.0.1'),
        'password' => env('REDIS_SESSION_PASSWORD'),
        'port'     => env('REDIS_SESSION_PORT', 6379),
        'database' => env('REDIS_SESSION_DB', 1),  // 用独立 DB
    ],
],
```

**为什么要独立 Redis DB？**

我们踩过一个坑：业务缓存和 Session 共用 `DB 0`，某次做缓存清理（`FLUSHDB`）时，把所有用户的 Session 也一起清掉了。瞬间几千个用户被踢出登录，客服电话被打爆。

独立 DB 后，清理业务缓存用 `FLUSHDB`，Session 数据不受影响。

## 3.3 踩坑 3：Cookie Session 的 4KB 限制

我们最初把用户的购物车数据存在 Cookie Session 里（`SESSION_DRIVER=cookie`），单机时没问题。上负载均衡后偶尔出现 CSRF token 校验失败。

排查发现：购物车商品较多时，Cookie 大小超过 4KB，浏览器会直接截断。而 Laravel 的 `_token` 是存在 Session Cookie 末尾的 —— 被截断后 token 丢失，所有 POST 请求报 419 错误。

```php
// 复现代码
session()->put('cart', $largeCartData); // 购物车数据 > 4KB
session()->regenerateToken();           // token 正常生成
// 但浏览器发送时 Cookie 被截断，_token 丢失
```

**教训**：任何有用户交互的 B2C 应用，Session 都不应该用 Cookie Driver。

## 3.4 踩坑 4：Session 过期时间与 Redis TTL 不一致

```php
// config/session.php
'lifetime' => env('SESSION_LIFETIME', 120),  // 分钟

// Redis TTL 对应的是秒
// Laravel 内部会自动转换，但如果你手动操作 Redis：
$redis->setex('session:' . $sessionId, 120, $data); // ← 这是 120 秒
// 而 Laravel 配置是 120 分钟！
```

我们在做 Session 统计时，手动查 Redis 的 TTL 发现只有 120 秒，以为 Session 配置有误，debug 了半天才发现是单位搞混了。

---

# 四、健康检查与故障转移

## 4.1 Nginx 被动健康检查

```nginx
upstream laravel_backend {
    least_conn;

    # max_fails: 连续失败 3 次后标记为不可用
    # fail_timeout: 标记为不可用后，30 秒后重新尝试
    server php-fpm-1:9000 max_fails=3 fail_timeout=30s;
    server php-fpm-2:9000 max_fails=3 fail_timeout=30s;
    server php-fpm-3:9000 max_fails=3 fail_timeout=30s;
}
```

被动检查的问题：**只有在请求发到故障实例并失败后，才会标记为不可用**。这意味着至少有一个用户会请求失败。

## 4.2 Nginx Plus 主动健康检查（或开源替代）

Nginx Plus（商业版）支持主动健康检查：

```nginx
# Nginx Plus 语法（开源版不支持）
upstream laravel_backend {
    zone laravel_backend 64k;
    least_conn;
    server php-fpm-1:9000;
    server php-fpm-2:9000;
    server php-fpm-3:9000;
}

server {
    location /health {
        proxy_pass http://laravel_backend/health;
        health_check interval=5s fails=3 passes=2;
        # 每 5 秒探测一次，连续 3 次失败标记不可用，2 次成功恢复
    }
}
```

开源替代方案：用 Lua 模块或外部工具（Consul / keepalived）。

我们的实践是用 Laravel 自带的健康检查端点：

```php
// routes/web.php
Route::get('/health', function () {
    try {
        // 检查数据库连接
        DB::connection()->getPdo();
        // 检查 Redis 连接
        Redis::ping();
        return response()->json([
            'status' => 'healthy',
            'timestamp' => now()->toIso8601String(),
        ]);
    } catch (\Throwable $e) {
        return response()->json([
            'status' => 'unhealthy',
            'error' => $e->getMessage(),
        ], 503);
    }
});
```

然后用外部监控脚本定期探测：

```bash
#!/bin/bash
# health_check.sh - 用 cron 每 10 秒运行一次

HEALTH_URL="http://localhost/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL --max-time 5)

if [ "$RESPONSE" != "200" ]; then
    echo "$(date): Health check failed (HTTP $RESPONSE)" >> /var/log/nginx_health.log
    # 可选：自动重启 PHP-FPM
    # systemctl restart php-fpm
fi
```

---

# 五、Docker Compose 完整配置

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:1.24-alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./src:/var/www/html
    depends_on:
      - php-fpm-1
      - php-fpm-2
      - php-fpm-3

  php-fpm-1:
    build:
      context: .
      dockerfile: Dockerfile.php-fpm
    volumes:
      - ./src:/var/www/html
    environment:
      - CONTAINER_ID=php-fpm-1
    depends_on:
      - redis-session
      - mysql

  php-fpm-2:
    build:
      context: .
      dockerfile: Dockerfile.php-fpm
    volumes:
      - ./src:/var/www/html
    environment:
      - CONTAINER_ID=php-fpm-2
    depends_on:
      - redis-session
      - mysql

  php-fpm-3:
    build:
      context: .
      dockerfile: Dockerfile.php-fpm
    volumes:
      - ./src:/var/www/html
    environment:
      - CONTAINER_ID=php-fpm-3
    depends_on:
      - redis-session
      - mysql

  redis-session:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_session_data:/data

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: kkday_b2c
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  redis_session_data:
  mysql_data:
```

---

# 六、生产环境 P0 故障复盘

## 故障现象

某次上线后，用户反馈率突然飙升：购物车丢失、重复扣款、CSRF 419 错误。影响约 15% 的请求。

## 根因分析

```
用户请求 → Nginx (round-robin) → php-fpm-1
    ↓
Session 写入 Redis（php-fpm-1 连接的 Redis 主节点）
    ↓
第二次请求 → Nginx (round-robin) → php-fpm-2
    ↓
Session 读取 Redis（php-fpm-2 连接的 Redis 从节点）→ 读到旧数据！
```

**根因**：我们用的是 Redis 主从架构，Session 写入主节点后，从节点有 **毫秒级同步延迟**。当请求被负载均衡到不同的 PHP-FPM 实例，而这些实例配置的 Redis 读写分离时，就会读到未同步的旧 Session。

## 解决方案

```php
// config/database.php
'session' => [
    'host'     => env('REDIS_SESSION_HOST', '127.0.0.1'),
    'port'     => env('REDIS_SESSION_PORT', 6379),
    'database' => env('REDIS_SESSION_DB', 1),
    // 关键：Session 必须走主节点读写，不要走从节点
    'read_write_hosts' => true,  // predis: 强制读写都走主节点
],
```

或者更简单：**Session 的 Redis 连接不要配读写分离**，直接连主节点。

```env
# .env
REDIS_SESSION_HOST=redis-master  # 直接连主节点
# 不要配 REDIS_SESSION_READ_HOST
```

---

# 七、最佳实践总结

## 7.1 配置检查清单

```
✅ Session 驱动 → Redis（不要用 Cookie / File）
✅ Session Redis 独立 DB → 和业务缓存分开
✅ Session 连接直连主节点 → 不走读写分离
✅ 负载策略 → least_conn（不要 round-robin）
✅ CDN 场景 → 配置 real_ip_header 获取真实 IP
✅ 健康检查 → /health 端点 + 外部监控
✅ FastCGI 超时 → connect=5s, send=60s, read=60s
✅ keepalive → upstream 32，fastcgi_keep_conn on
✅ Session lifetime → Redis TTL 与 Laravel 配置单位一致
```

## 7.2 Session 共享决策树

```
需要 Session 共享？
├── 数据量 < 4KB + 纯 API 无状态 → Cookie Session
├── 有少量有状态页面 + 临时方案 → Sticky Session (ip_hash)
├── B2C 有状态应用 + 生产环境 → Redis Session ✅
│   ├── Redis 主从 → Session 强制走主节点
│   ├── Redis Cluster → 用 hashtag 保证同一用户在同一分片
│   └── 独立 Redis 实例 → 最佳隔离方案
└── Redis 不可用降级 → Database Session（性能较差）
```

## 7.3 监控告警

```nginx
# Nginx 日志格式增加 upstream 信息
log_format upstream_log '$remote_addr - $remote_user [$time_local] '
    '"$request" $status $body_bytes_sent '
    '"$http_referer" "$http_user_agent" '
    'upstream=$upstream_addr '
    'upstream_status=$upstream_status '
    'upstream_response_time=$upstream_response_time';
```

关键监控指标：
- `upstream_response_time`：各实例响应时间差异
- `upstream_status`：5xx 分布在哪台实例
- `upstream_connect_time`：连接建立时间（健康度指标）

---

# 结语

从单机到负载均衡，最大的挑战不是 Nginx 配置本身，而是 **Session 一致性**。Redis Session 是最稳妥的方案，但必须注意：读写分离带来的主从延迟、独立 Redis DB 避免误操作、Cookie 大小限制这三大陷阱。

一句话总结：**先解决 Session 共享，再上负载均衡，顺序不能反**。

---

## 相关阅读

- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/Architecture/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/) —— 当负载均衡也无法解决 PHP-FPM 性能瓶颈时，用 Go 重写热点模块是进阶之路
- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/Architecture/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/) —— 从架构层面解耦 Laravel 业务逻辑，让负载均衡下的多实例部署更健壮
- [Cell-Based Architecture 实战：单元化架构在 Laravel 微服务中的落地](/Architecture/Cell-Based-Architecture-单元化架构Laravel微服务落地/) —— 当单组负载均衡不够时，单元化架构实现故障隔离与独立扩缩
