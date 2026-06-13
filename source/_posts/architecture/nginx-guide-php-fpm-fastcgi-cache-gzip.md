---
title: "Nginx 配置实战：PHP-FPM 调优、FastCGI 缓存、Gzip 压缩 — Laravel B2C API 踩坑记录"
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-16 19:50:32
updated: 2026-05-16 19:53:26
categories:
  - architecture
  - runtime
tags: [Laravel, Nginx, PHP, 性能优化]
keywords: [Nginx, PHP, FPM, FastCGI, Gzip, Laravel B2C API, 配置实战, 调优, 缓存, 压缩]
description: "深入 Laravel B2C API 生产环境的 Nginx 性能优化实战：详解 PHP-FPM 进程池调优与 Unix Socket 连接选型、FastCGI 缓存策略从零到百分之八十命中率的完整路径、Gzip 压缩级别基准测试与隐藏陷阱排查。涵盖 upstream keepalive 连接复用、request_terminate_timeout 超时协调、缓存穿透防护与 X-Cache-Status 监控等七大踩坑记录，附可直接复用的生产级 Nginx 配置模板，助你系统性掌握 PHP-FPM 与 Nginx 协同调优的核心方法论。"



---

## 前言

在 KKday B2C API 的生产环境中，Nginx 不仅仅是"反向代理"那么简单。它同时承担了 **FastCGI 缓存层**、**Gzip 压缩**、**连接池管理** 三重职责。当流量从日均 50 万请求增长到 500 万时，每一个 Nginx 配置项的调优都直接影响 P99 延迟和服务器成本。

这篇文章记录了我们在 30+ Laravel 仓库的 Nginx 配置实战中踩过的坑，从 PHP-FPM 连接模型选型、FastCGI 缓存命中率优化、到 Gzip 压缩的隐藏性能陷阱。

<!--more-->

---

## 一、架构全景：Nginx 在 B2C API 中的位置

```
┌─────────────┐     ┌─────────────────────────────────────────────┐
│   Client     │────▶│  Nginx (Reverse Proxy + FastCGI Cache)      │
│  (Mobile/H5) │     │                                             │
└─────────────┘     │  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
                    │  │ Gzip    │  │ FastCGI  │  │ Rate      │  │
                    │  │ Module  │  │ Cache    │  │ Limiting  │  │
                    │  └─────────┘  └──────────┘  └───────────┘  │
                    │         │            │             │        │
                    └─────────┼────────────┼─────────────┼────────┘
                              ▼            ▼             ▼
                    ┌─────────────────────────────────────┐
                    │     PHP-FPM (Unix Socket / TCP)     │
                    │     Laravel B2C API                 │
                    └─────────────────────────────────────┘
                              │
                    ┌─────────┼──────────┐
                    ▼         ▼          ▼
                ┌──────┐  ┌──────┐  ┌──────┐
                │MySQL │  │Redis │  │ S3   │
                └──────┘  └──────┘  └──────┘
```

---

## 二、PHP-FPM 连接调优：Unix Socket vs TCP

### 2.1 连接方式选型

这是我们第一个踩坑的地方。最初所有项目默认使用 `127.0.0.1:9000` TCP 连接，在 QPS 突破 2000 时出现了大量 `connect() failed` 错误。

**对比测试结果：**

| 指标 | TCP (127.0.0.1:9000) | Unix Socket (/var/run/php-fpm.sock) |
|------|----------------------|-------------------------------------|
| 最大 QPS | ~3,200 | ~5,800 |
| P99 延迟 | 45ms | 18ms |
| TIME_WAIT 连接数 | 高（需调内核参数） | 无 |
| 跨服务器 | ✅ 支持 | ❌ 仅本机 |

**结论：同一台机器上，Unix Socket 比 TCP 快 40%-80%。**

### 2.2 Unix Socket 配置

```nginx
# /etc/nginx/conf.d/laravel-b2c.conf

server {
    listen 80;
    server_name api.example.com;

    root /var/www/b2c-api/public;
    index index.php;

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php-fpm-b2c.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;

        # 关键：启用 FastCGI 连接复用
        fastcgi_buffer_size 32k;
        fastcgi_buffers 16 16k;
        fastcgi_busy_buffers_size 64k;
    }
}
```

### 2.3 PHP-FPM 进程池配置踩坑

```ini
; /etc/php/8.0/fpm/pool.d/b2c.conf

[b2c]
user = www-data
group = www-data

; Unix Socket 权限设置（踩坑点：权限不对会导致 502）
listen = /var/run/php-fpm-b2c.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

; 进程管理：dynamic 模式适合 B2C API
pm = dynamic
pm.max_children = 50          ; 根据内存计算：可用内存 / 单进程内存
pm.start_servers = 10         ; 启动时的进程数
pm.min_spare_servers = 5      ; 最小空闲
pm.max_spare_servers = 20     ; 最大空闲
pm.max_requests = 1000        ; ⚠️ 重要：防内存泄漏

; 慢日志（定位性能瓶颈的利器）
slowlog = /var/log/php-fpm/b2c-slow.log
request_slowlog_timeout = 3s

; 单请求超时（与 Nginx fastcgi_read_timeout 配合）
request_terminate_timeout = 30s
```

**踩坑记录 #1：`pm.max_requests` 设为 0 的灾难**

某项目上线时忘记设 `pm.max_requests`（默认值 0 = 无限制），运行一周后 FPM 子进程内存从 40MB 膨胀到 300MB，触发 OOM Killer 直接杀进程，造成 502 集中爆发。修复后设为 1000，内存稳定在 45MB 左右。

**踩坑记录 #2：`request_terminate_timeout` 与 `fastcgi_read_timeout` 不一致**

Laravel B2C API 有个导出报表接口耗时 30-60 秒。Nginx 的 `fastcgi_read_timeout` 设了 60s，但 PHP-FPM 的 `request_terminate_timeout` 设了 30s。结果 FPM 先杀掉进程，Nginx 收到 `upstream prematurely closed connection`，返回 502。两者的值必须协调一致：

```nginx
# Nginx 侧
fastcgi_read_timeout 60s;

# PHP-FPM 侧
request_terminate_timeout 65s;  ; 留 5s 缓冲
```

---

## 三、FastCGI 缓存实战：从 0 到 80% 命中率

### 3.1 为什么需要 FastCGI 缓存？

B2C 电商有大量"读多写少"的接口：商品详情、分类列表、活动页、SEO 页面。这些接口的响应内容对所有用户几乎相同，但每次请求都打到 PHP-FPM → MySQL 链路，造成不必要的资源消耗。

FastCGI 缓存在 Nginx 层拦截请求，直接返回缓存的响应体，**跳过整个 PHP 执行链路**。

### 3.2 完整配置

```nginx
# 定义缓存区域
fastcgi_cache_path /var/cache/nginx/fastcgi
    levels=1:2
    keys_zone=B2C_CACHE:100m      # 100MB 元数据内存，约可存 80 万个 key
    max_size=2g                    # 磁盘缓存上限 2GB
    inactive=60m                   # 60 分钟无访问自动清除
    use_temp_path=off;

# 缓存 key 设计（踩坑重点）
fastcgi_cache_key "$scheme$request_method$host$request_uri";

server {
    listen 80;
    server_name api.example.com;

    # PHP 请求处理
    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php-fpm-b2c.sock;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

        # 启用缓存
        fastcgi_cache B2C_CACHE;
        fastcgi_cache_valid 200 301 302 10m;   # 正常响应缓存 10 分钟
        fastcgi_cache_valid 404          1m;   # 404 只缓存 1 分钟
        fastcgi_cache_valid any          0;    # 其他状态码不缓存

        # 缓存锁：防止缓存穿透（Cache Stampede）
        fastcgi_cache_lock on;
        fastcgi_cache_lock_timeout 5s;
        fastcgi_cache_lock_age 5s;

        # 缓存最少命中次数（防止一次性低价值缓存污染）
        fastcgi_cache_min_uses 2;

        # 调试用：在响应头中暴露缓存状态
        add_header X-Cache-Status $upstream_cache_status always;
    }

    # 排除不需要缓存的接口
    location ~ ^/(api/v[0-9]+)/(cart|checkout|order|payment|user) {
        fastcgi_pass unix:/var/run/php-fpm-b2c.sock;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

        # 禁止缓存
        fastcgi_cache off;
        add_header X-Cache-Status "BYPASS" always;
    }
}
```

### 3.3 从 PHP 侧控制缓存行为

仅靠 Nginx 配置不够——有些接口需要动态决定是否缓存（例如登录用户看到个性化内容时应该 BYPASS）。

```php
// app/Http/Middleware/FastCgiCacheControl.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class FastCgiCacheControl
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        // 已登录用户 + 个性化接口 → 不缓存
        if ($request->user() && $this->isPersonalizedRoute($request)) {
            $response->headers->set('X-Accel-Expires', '0');  // 告诉 Nginx 不缓存
            return $response;
        }

        // 商品详情、分类列表等公共接口 → 允许缓存
        if ($this->isCacheableRoute($request) && $response->getStatusCode() === 200) {
            $ttl = $this->getCacheTtl($request);
            $response->headers->set('X-Accel-Expires', (string) $ttl);
        }

        // 404 响应 → 短缓存
        if ($response->getStatusCode() === 404) {
            $response->headers->set('X-Accel-Expires', '60');
        }

        return $response;
    }

    private function isCacheableRoute(Request $request): bool
    {
        $patterns = [
            'api/*/products/*',     // 商品详情
            'api/*/categories',     // 分类列表
            'api/*/campaigns/*',    // 活动页
        ];

        foreach ($patterns as $pattern) {
            if ($request->is($pattern)) {
                return true;
            }
        }

        return false;
    }

    private function getCacheTtl(Request $request): int
    {
        return match (true) {
            $request->is('api/*/products/*') => 600,    // 商品 10 分钟
            $request->is('api/*/categories')  => 3600,   // 分类 1 小时
            $request->is('api/*/campaigns/*') => 300,    // 活动 5 分钟
            default => 60,
        };
    }

    private function isPersonalizedRoute(Request $request): bool
    {
        return $request->is([
            'api/*/cart*',
            'api/*/orders*',
            'api/*/user/*',
            'api/*/recommend*',  // 个性化推荐
        ]);
    }
}
```

### 3.4 缓存命中率监控

```bash
# 实时查看缓存命中率（HIT / MISS / BYPASS / EXPIRED）
tail -f /var/log/nginx/access.log | awk '{print $NF}' | sort | uniq -c | sort -rn

# 更精确的统计脚本
#!/bin/bash
# /usr/local/bin/nginx-cache-stats.sh

LOG="/var/log/nginx/access.log"
HOUR_AGO=$(date -d '1 hour ago' '+%d/%b/%Y:%H')

echo "=== FastCGI Cache Hit Rate (Last 1 Hour) ==="
grep "$HOUR_AGO" "$LOG" | \
    grep -oP 'X-Cache-Status: \K\w+' | \
    sort | uniq -c | sort -rn | \
    awk '{
        total += $1
        stats[$2] = $1
    }
    END {
        for (s in stats) {
            printf "%-10s %6d (%5.1f%%)\n", s, stats[s], stats[s]/total*100
        }
        printf "\nTotal requests: %d\n", total
        printf "Cache hit rate: %.1f%%\n", (stats["HIT"]/total)*100
    }'
```

**踩坑记录 #3：缓存 key 包含 `Cookie` 导致命中率为 0**

最初的 `fastcgi_cache_key` 包含了 `$http_cookie`，以为这样可以区分登录/未登录用户。结果每个请求的 Cookie 都不同（`laravel_session`、GA 等），缓存 key 几乎每次都是唯一的，命中率接近 0%。

修复方案：去掉 Cookie，改用 `X-Accel-Expires` 头从 PHP 侧控制。

**踩坑记录 #4：缓存目录磁盘 I/O 爆炸**

缓存目录和 Laravel 日志目录放在同一个 SSD 分区。当缓存文件增长到 50 万+ 时，`inactive` 清理 + 新缓存写入导致 I/O 延迟飙升，间接影响 MySQL 查询。解决方案：缓存目录使用独立磁盘分区。

---

## 四、Gzip 压缩配置与陷阱

### 4.1 基础配置

```nginx
# /etc/nginx/nginx.conf (http 块)

# 启用 Gzip
gzip on;
gzip_vary on;                    # 添加 Vary: Accept-Encoding 头
gzip_proxied any;                # 代理请求也压缩
gzip_comp_level 5;               # 压缩级别 1-9，推荐 4-6
gzip_min_length 256;             # 小于 256B 不压缩（压缩后可能更大）
gzip_buffers 16 8k;
gzip_http_version 1.1;

# 压缩的 MIME 类型
gzip_types
    application/json
    application/javascript
    application/xml
    application/rss+xml
    text/css
    text/html
    text/plain
    text/xml
    application/vnd.api+json;    # JSON:API 格式
```

### 4.2 压缩级别调优

我们做了基准测试（以一个 50KB 的 JSON API 响应为例）：

| Level | 压缩后大小 | 压缩时间 | CPU 开销 | 推荐场景 |
|-------|-----------|---------|---------|---------|
| 1 | 14.2KB | 0.3ms | 极低 | 实时 API（默认推荐） |
| 4 | 12.1KB | 0.8ms | 低 | 平衡选择 |
| 6 | 11.5KB | 1.5ms | 中等 | 一般 Web 服务 |
| 9 | 11.2KB | 4.2ms | 高 | 静态资源预压缩 |

**B2C API 推荐 level 4-5**：在压缩比和 CPU 之间取得平衡。Level 9 比 Level 5 只小 3%，但 CPU 开销翻倍。

### 4.3 Gzip 踩坑

**踩坑记录 #5：对已经压缩的文件二次压缩**

某项目用 Nginx 对 `.js.gz` 和 `.css.gz` 预压缩文件又开了 Gzip，CPU 飙升。解决方案：

```nginx
# 静态资源用 gzip_static，避免二次压缩
location ~* \.(js|css|svg|json)$ {
    gzip_static on;    # 优先使用 .gz 文件
    gzip on;           # 没有 .gz 文件时在线压缩
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

**踩坑记录 #6：Gzip 与 ETag 冲突**

Nginx 默认的 ETag 对 Gzip 压缩后的响应会重新计算（因为内容变了），导致浏览器缓存失效。修复：

```nginx
# 使用 Last-Modified 替代 ETag
etag off;
if_modified_since before;
gzip_vary on;   # 关键：告诉 CDN 和浏览器内容因编码不同而变化
```

**踩坑记录 #7：SSE（Server-Sent Events）被 Gzip 截断**

Laravel B2C API 用 SSE 推送订单状态更新。Gzip 默认会等数据积累到 `gzip_buffers` 才一次性压缩输出，导致前端收不到实时事件。

```nginx
# SSE 接口禁用 Gzip
location /api/v1/orders/*/stream {
    gzip off;
    proxy_buffering off;      # 同时关闭代理缓冲
    chunked_transfer_encoding on;
    fastcgi_pass unix:/var/run/php-fpm-b2c.sock;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

    # 禁止超时（SSE 长连接）
    fastcgi_read_timeout 0;
}
```

---

## 五、完整生产配置模板

综合以上所有优化，这是我们在 KKday B2C API 中使用的生产级 Nginx 配置模板：

```nginx
# /etc/nginx/conf.d/b2c-api-production.conf

# FastCGI 缓存路径
fastcgi_cache_path /var/cache/nginx/b2c
    levels=1:2
    keys_zone=B2C_API:100m
    max_size=2g
    inactive=60m
    use_temp_path=off;

fastcgi_cache_key "$scheme$request_method$host$request_uri";

server {
    listen 80;
    server_name api.example.com;
    root /var/www/b2c-api/public;
    index index.php;

    # 安全头
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Gzip（API 场景推荐 level 4）
    gzip on;
    gzip_vary on;
    gzip_comp_level 4;
    gzip_min_length 256;
    gzip_proxied any;
    gzip_types application/json application/javascript text/css text/xml
               application/xml application/vnd.api+json;

    # 静态资源
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        gzip_static on;
        access_log off;
    }

    # SSE 接口（禁用缓冲和压缩）
    location ~ ^/api/.*/(stream|events)$ {
        gzip off;
        fastcgi_pass unix:/var/run/php-fpm-b2c.sock;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_cache off;
        fastcgi_read_timeout 0;
        fastcgi_buffering off;
    }

    # 不缓存的 API（购物车、订单、支付、用户）
    location ~ ^/api/.*/(cart|checkout|order|payment|user|auth) {
        fastcgi_pass unix:/var/run/php-fpm-b2c.sock;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_cache off;
        add_header X-Cache-Status "BYPASS" always;
    }

    # 可缓存的 API（商品、分类、活动）
    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php-fpm-b2c.sock;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

        # FastCGI 缓存
        fastcgi_cache B2C_API;
        fastcgi_cache_valid 200 301 302 10m;
        fastcgi_cache_valid 404 1m;
        fastcgi_cache_valid any 0;
        fastcgi_cache_lock on;
        fastcgi_cache_lock_timeout 5s;
        fastcgi_cache_min_uses 2;
        add_header X-Cache-Status $upstream_cache_status always;

        # Buffer 配置
        fastcgi_buffer_size 32k;
        fastcgi_buffers 16 16k;
        fastcgi_busy_buffers_size 64k;

        # 超时
        fastcgi_connect_timeout 5s;
        fastcgi_send_timeout 30s;
        fastcgi_read_timeout 30s;
    }

    # 拒绝非 PHP 请求
    location ~ /\.(?!well-known).* {
        deny all;
    }

    # 健康检查端点
    location = /health {
        access_log off;
        return 200 "OK\n";
    }
}
```

---

## 六、性能调优 Checklist

在部署前，逐项检查以下配置：

```bash
# 1. 测试 Nginx 配置语法
nginx -t

# 2. 检查 PHP-FPM Socket 权限
ls -la /var/run/php-fpm-b2c.sock
# 应该是 srw-rw---- www-data www-data

# 3. 验证缓存目录权限
mkdir -p /var/cache/nginx/b2c
chown -R nginx:nginx /var/cache/nginx/b2c

# 4. 检查内核参数（TCP 场景需要）
sysctl net.core.somaxconn           # 建议 >= 65535
sysctl net.ipv4.tcp_tw_reuse        # 建议 = 1
sysctl net.ipv4.ip_local_port_range # 建议 1024 65535

# 5. 压测验证
wrk -t12 -c400 -d30s http://api.example.com/api/v1/products/1
# 关注：Requests/sec、Latency P99、Socket errors

# 6. 验证缓存命中
curl -I http://api.example.com/api/v1/products/1 | grep X-Cache-Status
# 第一次应该是 MISS，第二次应该是 HIT
```

---

## 总结

| 维度 | 配置项 | 推荐值 | 说明 |
|------|--------|--------|------|
| 连接方式 | fastcgi_pass | Unix Socket | 同机部署时优先使用 |
| FPM 进程管理 | pm | dynamic | max_children 根据内存计算 |
| 内存保护 | pm.max_requests | 1000 | 防内存泄漏 |
| 缓存区域 | keys_zone | 100m | 约 80 万 key |
| 缓存大小 | max_size | 2g | 根据磁盘和缓存命中率调整 |
| 缓存锁 | fastcgi_cache_lock | on | 防止缓存穿透 |
| Gzip 级别 | gzip_comp_level | 4-5 | CPU 与压缩比的平衡 |
| 最小压缩 | gzip_min_length | 256B | 避免小文件压缩后更大 |

Nginx 的配置不是一个"设完就忘"的事情。建议结合 Prometheus + Grafana 监控 `$upstream_cache_status` 分布、PHP-FPM 活跃进程数、以及 Gzip 压缩比，在生产环境中持续调优。

---

## 七、常见踩坑总结与排错指南

在生产环境中，Nginx + PHP-FPM 的组合看似简单，但细节决定成败。以下是我们在 30+ Laravel 项目中总结的高频问题及排错思路：

### 7.1 502 Bad Gateway 排查清单

当 Nginx 返回 502 时，按照以下顺序逐项排查：

```bash
# 1. 检查 PHP-FPM 进程是否存活
ps aux | grep php-fpm
# 如果没有 worker 进程，说明 FPM 已崩溃

# 2. 检查 Socket 文件是否存在且权限正确
ls -la /var/run/php-fpm-b2c.sock
# 正确输出示例：srw-rw---- 1 www-data www-data 0 Jun 7 10:00 /var/run/php-fpm-b2c.sock
# 如果是 srw-rw-r--（mode 不是 0660），Nginx 的 worker 进程（nginx 用户）将无法连接

# 3. 检查 PHP-FPM 错误日志
tail -100 /var/log/php-fpm/b2c-error.log
# 常见错误：
#   - "unable to bind listening socket" → 端口/Socket 被占用
#   - "pool b2c has been requested to close" → 进程池配置异常
#   - "pm.max_children is too low" → 进程池打满

# 4. 检查 Nginx 错误日志
tail -100 /var/log/nginx/error.log | grep "upstream"
# 常见错误：
#   - "connect() failed (111: Connection refused)" → Socket 路径错误或 FPM 未启动
#   - "upstream prematurely closed connection" → FPM 超时或 crash
#   - "no live upstreams" → upstream 配置有误
```

### 7.2 FastCGI 缓存失效排查

当缓存命中率异常低时，按以下步骤排查：

```bash
# 1. 确认缓存目录存在且有写入权限
ls -la /var/cache/nginx/b2c/
# 如果目录为空或不存在，说明缓存写入失败

# 2. 检查 Nginx worker 用户对缓存目录的写权限
sudo -u nginx touch /var/cache/nginx/b2c/test_write
# 如果报 permission denied，修复权限：
sudo chown -R nginx:nginx /var/cache/nginx/b2c

# 3. 检查磁盘空间（缓存写满后会停止缓存新内容）
df -h /var/cache/nginx/
# 如果使用率超过 90%，考虑增大 max_size 或清理旧缓存

# 4. 清理所有缓存（谨慎操作）
rm -rf /var/cache/nginx/b2c/*
# 之后第一个请求一定是 MISS，之后的相同请求应该是 HIT

# 5. 查看实时缓存状态
curl -sI http://api.example.com/api/v1/products/1 | grep X-Cache-Status
# 常见值含义：
#   HIT   - 命中缓存（正常）
#   MISS  - 未命中（首次请求或缓存过期）
#   BYPASS - 被 PHP 侧 X-Accel-Expires: 0 显式跳过
#   EXPIRED - 缓存已过期，正在重新生成
#   STALE  - 缓存过期但 nginx 返回旧内容（需配置 stale）
```

### 7.3 PHP-FPM 内存泄漏诊断

```bash
# 1. 监控 FPM 进程内存变化（每 10 秒采样一次）
while true; do
    ps -eo pid,rss,comm | grep "php-fpm: pool" | awk '{printf "%s %sMB %s\n", $1, $2/1024, $3}'
    sleep 10
done

# 2. 如果发现某个 worker 内存持续增长超过 200MB，说明有内存泄漏
# 常见原因：
#   - 大数组在循环中未释放
#   - 文件句柄未关闭（fopen 但没有 fclose）
#   - 数据库连接未释放（长事务 + 连接池）

# 3. 临时紧急处理：重启 PHP-FPM
sudo systemctl restart php8.0-fpm
# 注意：这会导致所有正在进行的请求中断

# 4. 优雅重启（不中断当前请求）
sudo kill -USR2 $(cat /var/run/php-fpm.pid)
# 旧 worker 处理完当前请求后退出，新 worker 启动
```

---

## 八、Nginx upstream keepalive 与连接池进阶

### 8.1 为什么需要 upstream keepalive

默认情况下，Nginx 每次转发 FastCGI 请求都会创建一个新的 TCP/Unix Socket 连接。在高并发场景下，频繁的连接创建和销毁带来不必要的开销。`keepalive` 指令允许 Nginx 复用已建立的 upstream 连接。

```nginx
upstream php_fpm {
    server unix:/var/run/php-fpm-b2c.sock;

    # 保持 32 个空闲连接
    keepalive 32;
}

server {
    location ~ \.php$ {
        fastcgi_pass php_fpm;

        # 必须设置，否则 keepalive 不生效
        fastcgi_keep_conn on;

        # FastCGI 的 keepalive 通过 connection: keep-alive 实现
        fastcgi_param HTTP_CONNECTION $http_connection;
    }
}
```

> **踩坑记录 #8：keepalive 在 Unix Socket 下的特殊行为**
> Unix Socket 模式下 keepalive 的效果不如 TCP 模式明显，因为 Socket 连接不涉及 TCP 三次握手。但在高并发场景下，仍然建议开启以减少文件描述符的创建和销毁开销。

### 8.2 连接超时参数协调

以下三个超时参数需要协调配置，否则会出现诡异的 502 或 504 错误：

```nginx
# Nginx → PHP-FPM 的连接超时（建立连接的最大等待时间）
fastcgi_connect_timeout 5s;

# Nginx → PHP-FPM 的发送超时（向 FPM 发送请求体的最大等待时间）
fastcgi_send_timeout 30s;

# Nginx ← PHP-FPM 的读取超时（等待 FPM 返回响应的最大等待时间）
# ⚠️ 必须 >= PHP-FPM 的 request_terminate_timeout
fastcgi_read_timeout 60s;
```

| 参数 | 作用 | 与 PHP-FPM 的关系 | 推荐值 |
|------|------|-------------------|--------|
| `fastcgi_connect_timeout` | 连接建立超时 | 无直接关系 | 3-5s |
| `fastcgi_send_timeout` | 发送请求超时 | 应 > PHP 执行时间 | 30s |
| `fastcgi_read_timeout` | 读取响应超时 | **必须 >= request_terminate_timeout** | 60s |
| `request_terminate_timeout` | PHP-FPM 单请求最大执行时间 | 与 fastcgi_read_timeout 配合 | 65s |

---

## 九、安全加固配置

Nginx 在 Laravel B2C API 中的安全角色不仅仅是"反向代理"，还需要做好以下防护：

```nginx
# 1. 隐藏 Nginx 版本号（防止针对性攻击）
server_tokens off;

# 2. 禁止访问敏感文件（.env、.git 等）
location ~ /\.(env|git|svn|htaccess|htpasswd) {
    deny all;
    return 404;
}

# 3. 限制请求体大小（防止恶意大文件上传导致内存耗尽）
client_max_body_size 20M;

# 4. 安全响应头
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# 5. 速率限制（防止暴力攻击和爬虫滥用）
# 在 http 块中定义限速区域
# limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

# 在需要限速的 location 中使用
location ~ ^/api/ {
    # limit_req zone=api_limit burst=20 nodelay;
    # limit_req_status 429;   # 返回 Too Many Requests
    fastcgi_pass unix:/var/run/php-fpm-b2c.sock;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
}

# 6. CORS 配置（移动端 API 场景）
# location ~ \.php$ {
#     add_header Access-Control-Allow-Origin "https://app.example.com" always;
#     add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
#     add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With" always;
#     add_header Access-Control-Max-Age 86400 always;
# }
```

> **踩坑记录 #9：CORS preflight OPTIONS 请求未正确处理**
> 前端发送跨域请求时，浏览器会先发 OPTIONS preflight 请求。如果 Nginx 没有正确返回 CORS 响应头，前端会收到 405 Method Not Allowed。解决方案：在 Nginx 层为 OPTIONS 请求返回 200 空响应。

---

## 十、性能监控与持续调优

### 10.1 Nginx 状态监控模块

```nginx
# 启用 stub_status 模块
location /nginx_status {
    stub_status;
    allow 127.0.0.1;     # 仅允许本机访问
    allow 10.0.0.0/8;    # 允许内网访问
    deny all;
    access_log off;
}
```

访问 `http://localhost/nginx_status` 会返回：

```
Active connections: 256
server accepts handled requests
 12345 12345 567890
Reading: 0 Writing: 5 Waiting: 251
```

### 10.2 Prometheus + Grafana 监控配置

```yaml
# prometheus.yml - Nginx 监控配置
scrape_configs:
  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx-exporter:9113']

  - job_name: 'php-fpm'
    static_configs:
      - targets: ['php-fpm-exporter:9253']
```

关键监控指标：

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| `nginx_connections_active` | 活跃连接数 | > 5000 |
| `nginx_http_requests_total` | 每秒请求数 | 根据基线 |
| `phpfpm_active_processes` | 活跃进程数 | > 80% max_children |
| `phpfpm_total_process_requests` | 累计请求数 | 配合 max_requests 监控 |
| `nginx_cache_hit_rate` | 缓存命中率 | < 60% 需排查 |
| `upstream_response_time_avg` | 平均响应时间 | > 200ms |

### 10.3 自动化健康检查脚本

```bash
#!/bin/bash
# /usr/local/bin/nginx-health-check.sh

API_URL="http://api.example.com/health"
ALERT_EMAIL="ops@example.com"

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$API_URL")

if [ "$RESPONSE" != "200" ]; then
    echo "[$(date)] Health check failed with HTTP $RESPONSE" >> /var/log/health-check.log

    # 检查 PHP-FPM 状态
    FPM_STATUS=$(systemctl is-active php8.0-fpm)
    if [ "$FPM_STATUS" != "active" ]; then
        echo "[$(date)] PHP-FPM is down, attempting restart" >> /var/log/health-check.log
        sudo systemctl restart php8.0-fpm
    fi

    # 发送告警邮件
    echo "Health check failed at $(date). HTTP Status: $RESPONSE. PHP-FPM: $FPM_STATUS" | \
        mail -s "[ALERT] Nginx/PHP-FPM Health Check Failed" "$ALERT_EMAIL"
fi
```

将此脚本添加到 crontab，每分钟执行一次：

```bash
* * * * * /usr/local/bin/nginx-health-check.sh
```

---

## 相关阅读

- [PHP-FPM Worker 生命周期深度剖析](/categories/PHP/php-fpm-worker-lifecycle/)
- [PHP OPcache JIT 联合调优实战](/categories/PHP/PHP-OPcache-JIT-联合调优实战-JIT-buffer预热-opcache.jit参数组合与生产环境性能基准/)
- [Laravel Cache Warming 实战：缓存预热策略与自动化](/categories/PHP/Laravel/Laravel-Cache-Warming-实战-缓存预热策略与自动化/)
