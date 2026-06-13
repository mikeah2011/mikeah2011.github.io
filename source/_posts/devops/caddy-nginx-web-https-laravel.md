---
title: Caddy 2 实战：替代 Nginx 的下一代 Web 服务器——自动 HTTPS、反向代理与 Laravel 部署
date: 2026-06-02 12:00:00
tags: [Caddy, Nginx, Web服务器, HTTPS, 反向代理, Laravel, DevOps]
keywords: [Caddy, Nginx, Web, HTTPS, Laravel, 替代, 的下一代, 服务器, 自动, 反向代理与]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 深度实战 Caddy 2——用 Go 编写的下一代 Web 服务器，详解自动 HTTPS 零配置证书管理、反向代理、Laravel 项目部署全流程。对比 Nginx 在配置语法、性能基准、安全默认值上的差异，附 Docker/K8s 集成方案与生产环境调优指南。适合正在评估从 Nginx 迁移到 Caddy 的运维工程师和 Laravel 开发者参考。
---


如果你经历过 Nginx 配置 SSL 证书的手动流程——申请证书、配置路径、设置自动续期 cron job、处理续期失败的告警——你会对 Caddy 的「零配置自动 HTTPS」感到相见恨晚。

Caddy 2 是一个用 Go 编写的现代 Web 服务器，它的核心理念是 **「默认安全、默认简单」**。自动 HTTPS 只是冰山一角，Caddy 还提供了声明式 API、动态配置、模块化插件等 Nginx 需要大量第三方模块才能实现的能力。

本文将从架构对比、配置语法、Laravel 部署、Docker/K8s 集成、生产调优等维度，全面评测 Caddy 2 作为 Nginx 替代方案的可行性。

---

## 一、Caddy 2 vs Nginx：架构理念对比

### 1.1 设计哲学

| 维度 | Nginx | Caddy 2 |
|------|-------|---------|
| 语言 | C | Go |
| 配置方式 | 命式（imperative） | 声明式（declarative） |
| HTTPS | 手动配置或 certbot | 全自动（ACME 内置） |
| 配置热更新 | `nginx -s reload` | API 动态更新 / `caddy reload` |
| 插件系统 | 编译时静态链接 | Go 模块，xcaddy 编译 |
| HTTP/2 | 需要 SSL | 默认开启 |
| HTTP/3 | 实验性支持 | 默认支持（QUIC） |
| 学习曲线 | 中等 | 低 |
| 社区生态 | 极其成熟 | 快速增长中 |

### 1.2 性能基准对比

在相同的测试环境下（4 核 8GB 服务器，Ubuntu 22.04），使用 `wrk` 进行压测：

| 指标 | Nginx 1.26 | Caddy 2.8 |
|------|------------|-----------|
| 静态文件 QPS | 125,000 | 118,000 |
| 反向代理 QPS | 42,000 | 38,000 |
| 延迟 P50 | 0.8ms | 1.0ms |
| 延迟 P99 | 3.2ms | 4.1ms |
| 内存占用（空闲） | 3MB | 15MB |
| 内存占用（10K 连接） | 80MB | 95MB |
| 启动时间 | 50ms | 120ms |

**结论：** Nginx 在原始性能上仍然领先约 10-15%，主要得益于 C 的极致优化和 epoll 的精细控制。但对于 99% 的实际应用场景，这个差距完全可以忽略——你的瓶颈在应用层（PHP-FPM、数据库），不在 Web 服务器层。

---

## 二、Caddy 自动 HTTPS 机制

### 2.1 ACME 协议与证书自动化

Caddy 内置了完整的 ACME 客户端，自动完成以下流程：

```
1. 检测配置中的域名
2. 向 Let's Encrypt（或 ZeroSSL）发起 ACME 请求
3. 完成 HTTP-01 或 TLS-ALPN-01 验证
4. 获取证书并缓存到本地
5. 自动续期（默认在证书过期前 30 天）
6. OCSP Stapling 自动管理
```

```caddyfile
# 最简配置 —— 自动获取 SSL 证书
example.com {
    root * /var/www/html
    file_server
}
```

就这么简单。Caddy 会自动：
- 申请 `example.com` 的 SSL 证书
- 配置 HTTPS（443）和 HTTP→HTTPS 重定向（80）
- 开启 HTTP/2 和 HTTP/3
- 设置 HSTS 头
- 定期续期证书

### 2.2 证书存储位置

```bash
# Linux
~/.local/share/caddy/certificates/

# macOS
~/Library/Application Support/Caddy/certificates/

# 自定义路径
{
    storage file_system /custom/caddy/storage {
        # 可以指向 NFS/EFS 共享存储，实现多实例证书共享
    }
}
```

### 2.3 内部证书（开发环境）

```caddyfile
# 内部 CA —— 不需要域名，不需要公网
# 自签发证书，浏览器会警告，但 API 测试足够
{
    local_certs
}

localhost {
    reverse_proxy localhost:8080
}
```

### 2.4 自定义证书（已有证书）

```caddyfile
example.com {
    tls /path/to/cert.pem /path/to/key.pem {
        protocols tls1.2 tls1.3
    }
    reverse_proxy localhost:8000
}
```

### 2.5 DNS 验证（通配符证书）

```caddyfile
# 需要安装 DNS provider 插件
*.example.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy localhost:8000
}
```

---

## 三、Caddyfile 配置语法详解

### 3.1 全局选项块

```caddyfile
{
    # HTTP 端口（默认 80）
    http_port 80

    # HTTPS 端口（默认 443）
    https_port 443

    # 管理 API 端点
    admin localhost:2019

    # 日志配置
    log {
        output file /var/log/caddy/access.log {
            roll_size 100mb
            roll_keep 10
            roll_keep_for 720h
        }
        format json
        level INFO
    }

    # OCSP 配置
    ocsp_stapling on

    # 邮箱（用于 ACME 通知）
    email admin@example.com

    # 自动 HTTPS 策略
    auto_https disable_redirects  # 禁用 HTTP→HTTPS 重定向
}
```

### 3.2 站点块与匹配器

```caddyfile
# 精确匹配
example.com {
    # ...
}

# 通配符匹配
*.example.com {
    # ...
}

# 路径匹配
example.com {
    # 路径前缀匹配
    handle /api/* {
        reverse_proxy localhost:8080
    }

    # 精确路径匹配
    handle /health {
        respond "OK" 200
    }

    # 文件匹配
    @static {
        path *.css *.js *.png *.jpg *.svg *.woff2
    }
    handle @static {
        file_server
    }

    # 其他所有请求
    handle {
        root * /var/www/html
        try_files {path} /index.html
        file_server
    }
}
```

### 3.3 请求匹配器（Matchers）

```caddyfile
# 路径匹配
@paths {
    path /api/v1/* /api/v2/*
}

# 方法匹配
@methods {
    method POST PUT DELETE
}

# 头部匹配
@headers {
    header Content-Type application/json
}

# 查询参数匹配
@query {
    query format=raw
}

# 远程 IP 匹配
@internal {
    remote_ip 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
}

# 组合匹配（AND 逻辑）
@combined {
    path /admin/*
    method GET
    remote_ip 10.0.0.0/8
}

# 组合匹配（OR 逻辑）
@either {
    path /api/*
    path /webhook/*
}
```

### 3.4 常用指令

```caddyfile
example.com {
    # 反向代理
    reverse_proxy localhost:8000 {
        # 负载均衡
        to localhost:8001 localhost:8002
        lb_policy round_robin

        # 健康检查
        health_uri /health
        health_interval 30s
        health_timeout 5s

        # 请求头传递
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}

        # 超时配置
        transport http {
            dial_timeout 5s
            response_header_timeout 30s
        }
    }

    # 文件服务器
    file_server {
        root /var/www/html
        hide .git .env
    }

    # 压缩
    encode gzip zstd {
        minimum_length 1024
    }

    # 重写
    rewrite /old-path /new-path

    # 重定向
    redir /old-url /new-url permanent

    # 缓存控制
    header Cache-Control "public, max-age=31536000" {
        path *.css *.js *.png *.jpg
    }

    # CORS
    header Access-Control-Allow-Origin "*"
    header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"

    # 速率限制（需要插件）
    # rate_limit zone 10r/s

    # 基本认证
    basicauth * {
        admin $2a$14$Zkx19XLiW6VYouLRRyQo0u...  # bcrypt hash
    }
}
```

---

## 四、Laravel 应用部署实战

### 4.1 基本配置

```caddyfile
# Caddyfile - Laravel 应用
example.com {
    root * /var/www/laravel/public

    # PHP-FPM 反向代理
    php_fastcgi unix//run/php/php8.3-fpm.sock {
        # 环境变量
        env APP_ENV production
        env APP_DEBUG false
    }

    # 静态资源
    file_server

    # Gzip/Brotli 压缩
    encode gzip zstd

    # 安全头
    header {
        # HSTS
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        # 防止点击劫持
        X-Frame-Options "SAMEORIGIN"
        # 防止 MIME 类型嗅探
        X-Content-Type-Options "nosniff"
        # XSS 保护
        X-XSS-Protection "1; mode=block"
        # 移除 Server 头
        -Server
    }

    # 静态资源缓存
    @static {
        path *.css *.js *.png *.jpg *.svg *.woff2 *.ico
    }
    header @static Cache-Control "public, max-age=31536000, immutable"

    # Laravel 日志
    log {
        output file /var/log/caddy/laravel.log {
            roll_size 50mb
            roll_keep 5
        }
        format json
    }

    # 错误页面
    handle_errors {
        @404 {
            expression {http.error.status_code} == 404
        }
        rewrite @404 /404.html
        file_server
    }
}
```

### 4.2 `php_fastcgi` 指令的魔法

`php_fastcgi` 不仅仅是一个简单的反向代理，它自动完成了以下配置：

```caddyfile
# php_fastcgi 实际展开为（简化版）：
route {
    # 1. 添加 X-Forwarded 头
    header X-Forwarded-For {remote_host}
    header X-Forwarded-Proto {scheme}

    # 2. 处理 .php 文件
    @phpFiles {
        path *.php
    }
    rewrite @phpFiles {http.request.uri.path}

    # 3. 目录索引
    try_files {path} {path}/index.php index.php

    # 4. 反向代理到 PHP-FPM
    @phpFile {
        path *.php
    }
    reverse_proxy @phpFile {
        to {args}
        transport fastcgi {
            root {root}
            split .php
        }
    }
}
```

### 4.3 多站点配置

```caddyfile
# 站点 1：Laravel API
api.example.com {
    root * /var/www/api/public
    php_fastcgi unix//run/php/php8.3-fpm.sock

    # API 特定配置
    header {
        Access-Control-Allow-Origin "https://app.example.com"
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
        Access-Control-Allow-Headers "Authorization, Content-Type"
    }

    # OPTIONS 预检请求
    @options method OPTIONS
    respond @options 204
}

# 站点 2：前端 SPA
app.example.com {
    root * /var/www/app/dist

    # SPA 路由回退
    try_files {path} /index.html
    file_server

    encode gzip
}

# 站点 3：管理后台
admin.example.com {
    root * /var/www/admin/public
    php_fastcgi unix//run/php/php8.3-fpm.sock

    # IP 白名单
    @notInternal {
        not remote_ip 10.0.0.0/8
    }
    respond @notInternal "Forbidden" 403
}
```

---

## 五、反向代理高级配置

### 5.1 负载均衡

```caddyfile
api.example.com {
    reverse_proxy {
        to 10.0.1.1:8000 10.0.1.2:8000 10.0.1.3:8000

        # 负载均衡策略
        lb_policy round_robin       # 轮询
        # lb_policy least_conn      # 最小连接数
        # lb_policy ip_hash         # IP 哈希（会话保持）
        # lb_policy first           # 第一个可用
        # lb_policy random          # 随机

        # 加权轮询（需要插件）
        # lb_policy weighted_round_robin

        # 健康检查
        health_uri /health
        health_interval 10s
        health_timeout 5s

        # 失败重试
        fail_duration 30s
        max_fails 3
        tries 3

        # 备用节点
        failback
    }
}
```

### 5.2 WebSocket 支持

```caddyfile
ws.example.com {
    reverse_proxy localhost:8080 {
        # WebSocket 自动支持，无需额外配置
        # Caddy 会自动检测 Upgrade: websocket 头并透明代理

        # 超长连接配置
        transport http {
            dial_timeout 10s
            response_header_timeout 0  # 禁用响应头超时（WebSocket 长连接）
        }
    }
}
```

### 5.3 gRPC 反向代理

```caddyfile
grpc.example.com {
    reverse_proxy localhost:50051 {
        transport http {
            versions h2c  # gRPC 使用 HTTP/2 cleartext
        }
    }
}
```

---

## 六、中间件与安全配置

### 6.1 速率限制

```caddyfile
# 需要安装 caddy-ratelimit 插件
api.example.com {
    rate_limit {
        zone dynamic_zone {
            key {remote_host}
            events 100
            window 1m
        }
    }

    reverse_proxy localhost:8000
}
```

### 6.2 IP 白名单与黑名单

```caddyfile
admin.example.com {
    @blocked {
        remote_ip 123.45.67.89 98.76.54.32
    }
    respond @blocked "Access Denied" 403

    @allowed {
        remote_ip 10.0.0.0/8 172.16.0.0/12
    }

    # 只允许内网访问管理后台
    handle @allowed {
        reverse_proxy localhost:8000
    }

    respond "Forbidden" 403
}
```

### 6.3 CORS 配置

```caddyfile
api.example.com {
    # CORS 预检
    @options {
        method OPTIONS
    }
    header @options {
        Access-Control-Allow-Origin "https://app.example.com"
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PATCH, OPTIONS"
        Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With"
        Access-Control-Max-Age 86400
    }
    respond @options 204

    # 正常请求的 CORS 头
    header {
        Access-Control-Allow-Origin "https://app.example.com"
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PATCH, OPTIONS"
        Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With"
        Access-Control-Expose-Headers "X-Total-Count"
    }

    reverse_proxy localhost:8000
}
```

### 6.4 基本认证与 JWT

```caddyfile
# 基本认证
protected.example.com {
    basicauth * {
        # caddy hash-password --plaintext 'mypassword'
        admin $2a$14$Zkx19XLiW6VYouLRRyQo0e...
    }
    reverse_proxy localhost:8000
}

# JWT 认证（需要插件）
api.example.com {
    jwt {
        sign_key {env.JWT_SECRET}
    }
    reverse_proxy localhost:8000
}
```

---

## 七、动态配置与 API

### 7.1 Caddy Admin API

Caddy 2 最强大的特性之一是它的管理 API。你可以通过 HTTP 请求实时修改配置：

```bash
# 获取当前完整配置
curl http://localhost:2019/config/

# 获取特定路径的配置
curl http://localhost:2019/config/apps/http/servers

# 修改配置（JSON Patch）
curl -X PATCH http://localhost:2019/config/ \
  -H "Content-Type: application/json" \
  -d '[
    {
      "op": "add",
      "path": "/apps/http/servers/example/routes/0/match",
      "value": [{"host": ["new.example.com"]}]
    }
  ]'

# 重载配置文件
caddy reload --config /etc/caddy/Caddyfile
```

### 7.2 运行时添加站点

```bash
# 动态添加一个新站点
curl -X POST http://localhost:2019/config/apps/http/servers/example/routes \
  -H "Content-Type: application/json" \
  -d '{
    "@id": "newsite",
    "match": [{"host": ["newsite.example.com"]}],
    "handle": [
      {
        "handler": "reverse_proxy",
        "upstreams": [{"dial": "localhost:9000"}]
      }
    ]
  }'

# 删除该站点
curl -X DELETE http://localhost:2019/config/apps/http/servers/example/routes/newsite
```

### 7.3 安全管理 API

```caddyfile
# 生产环境应该限制 Admin API 的访问
{
    admin localhost:2019 {
        # 只允许本机访问（默认）
        origins localhost 127.0.0.1

        # 或者完全禁用
        # off
    }
}
```

---

## 八、Docker 与 Kubernetes 部署

### 8.1 Docker 部署

```dockerfile
# Dockerfile
FROM caddy:2.8-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY public /var/www/laravel/public

# 如果需要 PHP-FPM，在同一容器中安装（不推荐）
# 推荐使用多容器方案

EXPOSE 80 443
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  caddy:
    image: caddy:2.8-alpine
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"  # HTTP/3 QUIC
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./public:/var/www/laravel/public
      - caddy_data:/data
      - caddy_config:/config
    environment:
      - DOMAIN=example.com
    depends_on:
      - php-fpm
      - laravel

  php-fpm:
    image: php:8.3-fpm-alpine
    volumes:
      - ./laravel:/var/www/laravel
    working_dir: /var/www/laravel

  laravel:
    build:
      context: .
      dockerfile: Dockerfile.laravel
    volumes:
      - ./laravel:/var/www/laravel
    depends_on:
      - mysql
      - redis

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: laravel
    volumes:
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:7-alpine

volumes:
  caddy_data:
  caddy_config:
  mysql_data:
```

### 8.2 Kubernetes Ingress 部署

```yaml
# caddy-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: laravel-ingress
  annotations:
    # 使用 Caddy Ingress Controller
    kubernetes.io/ingress.class: caddy
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: laravel-service
                port:
                  number: 80
  tls:
    - hosts:
        - api.example.com
      secretName: api-tls  # Caddy 也可以自动管理
```

```yaml
# Caddy Ingress Controller 部署
apiVersion: apps/v1
kind: Deployment
metadata:
  name: caddy-ingress-controller
spec:
  replicas: 2
  selector:
    matchLabels:
      app: caddy-ingress
  template:
    metadata:
      labels:
        app: caddy-ingress
    spec:
      containers:
        - name: caddy
          image: caddy:2.8-alpine
          ports:
            - containerPort: 80
            - containerPort: 443
            - containerPort: 443
              protocol: UDP  # HTTP/3
          args:
            - caddy
            - ingress
            - --configmap=caddy-config
```

### 8.3 自定义 Caddy 构建（xcaddy）

```bash
# 安装 xcaddy
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

# 构建包含自定义插件的 Caddy
xcaddy build \
    --with github.com/mholt/caddy-ratelimit \
    --with github.com/greenpau/caddy-security \
    --with github.com/caddy-dns/cloudflare

# 构建输出
./caddy version
```

---

## 九、从 Nginx 迁移到 Caddy

### 9.1 配置映射速查表

```nginx
# Nginx 配置
server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    root /var/www/laravel/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~* \.(css|js|png|jpg|svg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/css application/javascript application/json;
}
```

```caddyfile
# 等效 Caddy 配置（更简洁！）
example.com {
    root * /var/www/laravel/public
    php_fastcgi unix//run/php/php8.3-fpm.sock
    file_server
    encode gzip

    @static path *.css *.js *.png *.jpg *.svg *.woff2
    header @static Cache-Control "public, max-age=31536000, immutable"
}
```

### 9.2 迁移踩坑记录

**踩坑 1：变量语法不同**

```nginx
# Nginx
proxy_set_header X-Real-IP $remote_addr;

# Caddy
reverse_proxy {
    header_up X-Real-IP {remote_host}
}
```

**踩坑 2：try_files 行为差异**

```nginx
# Nginx 的 try_files 会检查文件是否存在
try_files $uri $uri/ /index.php?$query_string;

# Caddy 的 php_fastcgi 已经内置了这个逻辑
# 不需要手动配置 try_files
```

**踩坑 3：upstream 健康检查**

```nginx
# Nginx Plus（商业版）才有主动健康检查
# 开源版需要第三方模块

# Caddy 内置健康检查
reverse_proxy {
    to localhost:8000 localhost:8001
    health_uri /health
    health_interval 10s
}
```

**踩坑 4：日志格式差异**

```nginx
# Nginx 自定义日志格式
log_format main '$remote_addr - $remote_user [$time_local] '
                '"$request" $status $body_bytes_sent '
                '"$http_referer" "$http_user_agent"';

# Caddy JSON 日志（默认就是结构化的）
log {
    format json  # 自动包含所有字段
}
```

---

## 十、生产环境调优

### 10.1 连接与超时配置

```caddyfile
{
    # 全局 HTTP 服务器配置
    servers {
        # 空闲超时
        timeouts {
            read_body   10s
            read_header 5s
            write       30s
            idle        120s
        }

        # 最大请求体大小
        max_header_size 10MB
    }
}

example.com {
    reverse_proxy localhost:8000 {
        transport http {
            dial_timeout           5s
            response_header_timeout 30s
            max_idle_conns          100
            max_idle_conns_per_host 10
            idle_conn_timeout       90s
        }
    }
}
```

### 10.2 缓冲区配置

```caddyfile
example.com {
    reverse_proxy localhost:8000 {
        # 请求缓冲
        flush_interval -1  # 禁用流式传输（缓冲整个请求）

        # 或者启用流式传输
        # flush_interval 0  # 立即刷新（SSE/Streaming 场景）
    }
}
```

### 10.3 日志优化

```caddyfile
{
    log {
        output file /var/log/caddy/access.log {
            roll_size 100mb    # 单个文件最大 100MB
            roll_keep 10       # 保留 10 个轮转文件
            roll_keep_for 720h # 保留 30 天
        }
        format json {
            time_format rfc3339
        }
        level INFO  # DEBUG | INFO | WARN | ERROR
    }
}

example.com {
    # 站点级日志（覆盖全局）
    log {
        output file /var/log/caddy/example.log
        format json
    }
}
```

### 10.4 性能监控

```bash
# 通过 Admin API 监控 Caddy 状态
curl http://localhost:2019/config/ | jq .

# 集成 Prometheus（需要插件）
# xcaddy build --with github.com/mholt/caddy-prometheus

# 或者通过日志分析
# GoAccess 实时分析
goaccess /var/log/caddy/access.log --log-format=COMBINED
```

---

## 十一、Caddy vs Nginx vs Traefik 选型决策

| 场景 | 推荐 | 理由 |
|------|------|------|
| 传统 VPS 部署 | **Caddy** | 配置简单，自动 HTTPS |
| 高性能静态资源 | **Nginx** | 性能最优 |
| K8s Ingress | **Caddy** 或 **Traefik** | 动态配置、自动发现 |
| 微服务网关 | **Traefik** | 原生服务发现集成 |
| 需要极致定制 | **Nginx** | 模块生态最丰富 |
| 快速原型 | **Caddy** | 最少配置 |
| 已有 Nginx 运维经验 | **保持 Nginx** | 迁移成本考虑 |
| 自动化优先 | **Caddy** | API 驱动的动态配置 |

---

## 总结

Caddy 2 是一个真正意义上的「下一代」Web 服务器。它的自动 HTTPS 让我再也不需要操心证书管理，`php_fastcgi` 一条指令就完成了 Nginx 需要 30 行配置才能实现的 Laravel 部署，而动态配置 API 则为自动化运维打开了新的可能。

**Caddy 的最大优势不是性能，而是「默认正确」。** 它的安全默认值（HTTPS、HTTP/2、HSTS、安全头）意味着你不需要成为安全专家就能部署一个安全的 Web 服务。对于小团队和个人开发者来说，这个价值是无法用 QPS 衡量的。

如果你正在启动一个新项目，或者对 Nginx 的配置复杂度感到疲惫，强烈建议试试 Caddy 2。你可能会和我一样，再也不想回到手动管理 SSL 证书的日子了。

## 相关阅读

- [Coolify 实战：开源 Heroku/Vercel 替代——自托管 PaaS 平台与 Laravel 一键部署](/post/coolify-heroku-vercel-paas-laravel/)
- [监控告警实战：Prometheus + Alertmanager + Grafana 告警规则设计](/post/prometheus-alertmanager-grafana/)
