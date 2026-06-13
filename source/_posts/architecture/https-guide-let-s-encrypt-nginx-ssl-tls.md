---
title: HTTPS-实战-Let-s-Encrypt-Nginx-SSL-TLS-配置与自动续期-Laravel-B2C-API踩坑记录
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-16 22:51:09
updated: 2026-05-16 22:54:14
categories:
  - architecture
  - infra
tags: [Laravel, Nginx, 安全, 监控]
keywords: [HTTPS, Let, Encrypt, Nginx, SSL, TLS, Laravel, B2C, API, 配置与自动续期]
description: 从零到 A+ 评级的 HTTPS 全链路实战。覆盖 Let's Encrypt 证书申请与自动续期、Nginx TLS 1.3 配置、OCSP Stapling、HSTS 安全头、通配符证书 DNS-01 Challenge、Laravel 强制 HTTPS 与安全 Cookie，以及生产环境中踩过的证书链、混合内容、续期失败等真实坑。



---

# HTTPS 实战：Let's Encrypt + Nginx SSL/TLS 配置与自动续期

## 前言

在 KKday B2C API 项目中，所有对外暴露的接口都必须走 HTTPS——这不是"最好有"，而是支付回调（Stripe/AliPay）的硬性要求、PCI DSS 合规的底线，也是 SEO 排名的基础信号。

然而，"把 HTTP 变成 HTTPS"远不是装个证书就完事。我见过太多团队拿到 SSL Labs B 评级就算"搞定了"，直到浏览器因为 HSTS 缺失、证书链不完整、混合内容等问题弹出警告时才来救火。

本文记录了我在 30+ 个 Laravel 项目中落地 HTTPS 的完整路径：从 Let's Encrypt 证书申请、Nginx TLS 硬化配置、自动续期机制，到生产环境踩过的每一个真实坑。

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTPS 请求生命周期                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Browser ──TLS 1.3 Handshake──▶ Nginx (443)                    │
│                                      │                          │
│                              ┌───────┴───────┐                  │
│                              │ SSL Termination│                  │
│                              │  OCSP Stapling │                  │
│                              │  HSTS Header   │                  │
│                              └───────┬───────┘                  │
│                                      │                          │
│                              HTTP (内网 9000)                    │
│                                      │                          │
│                              ┌───────┴───────┐                  │
│                              │  PHP-FPM      │                  │
│                              │  Laravel App  │                  │
│                              └───────────────┘                  │
│                                                                 │
│  证书管理：                                                      │
│  certbot ──ACME──▶ Let's Encrypt CA                            │
│       │                                                        │
│       ▼                                                        │
│  /etc/letsencrypt/live/{domain}/                               │
│    ├── fullchain.pem   (证书链)                                │
│    ├── privkey.pem     (私钥)                                  │
│    ├── cert.pem        (服务器证书)                             │
│    └── chain.pem       (中间证书)                               │
│                                                                 │
│  自动续期：                                                      │
│  systemd timer / cron ──▶ certbot renew ──▶ nginx -s reload    │
└─────────────────────────────────────────────────────────────────┘
```

## 一、Let's Encrypt 证书申请

### 1.1 安装 Certbot

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y certbot python3-certbot-nginx

# CentOS/RHEL
sudo dnf install -y certbot python3-certbot-nginx

# 验证安装
certbot --version
# certbot 2.9.0
```

### 1.2 申请标准域名证书（HTTP-01 Challenge）

最常见的方式，适用于有公网 IP 且 80 端口可达的服务器：

```bash
# 单域名
sudo certbot --nginx -d example.com

# 多域名（SAN 证书）
sudo certbot --nginx -d example.com -d www.example.com -d api.example.com

# 仅申请不修改 Nginx 配置（推荐手动配置）
sudo certbot certonly --nginx -d example.com -d www.example.com
```

Certbot 会通过 ACME 协议与 Let's Encrypt 通信：
1. 在 `/.well-known/acme-challenge/` 下放一个验证文件
2. Let's Encrypt 服务器 HTTP 访问该文件确认域名所有权
3. 签发证书到 `/etc/letsencrypt/live/example.com/`

### 1.3 申请通配符证书（DNS-01 Challenge）

B2C 项目经常需要 `*.api.example.com` 这样的通配符证书：

```bash
# 通配符证书必须用 DNS-01 Challenge
sudo certbot certonly --manual --preferred-challenges dns \
  -d "*.example.com" -d example.com
```

交互式会要求你在 DNS 中添加一条 `_acme-challenge.example.com TXT` 记录。

**自动化 DNS-01（以 Cloudflare 为例）**：

```bash
# 安装 Cloudflare 插件
pip install certbot-dns-cloudflare

# 创建凭证文件
sudo mkdir -p /etc/letsencrypt
sudo tee /etc/letsencrypt/cloudflare.ini > /dev/null << 'EOF'
dns_cloudflare_api_token = YOUR_CLOUDFLARE_API_TOKEN
EOF
sudo chmod 600 /etc/letsencrypt/cloudflare.ini

# 申请通配符证书
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d "*.example.com" -d example.com
```

## 二、Nginx SSL/TLS 配置

### 2.1 基础 HTTPS 配置

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    # 301 永久重定向到 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    # ─── 证书配置 ───
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # ─── TLS 协议版本 ───
    # 只允许 TLS 1.2 和 1.3，禁用所有 SSL 和 TLS 1.0/1.1
    ssl_protocols TLSv1.2 TLSv1.3;

    # ─── 加密套件 ───
    # TLS 1.2 使用服务端推荐的套件顺序
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';

    # TLS 1.3 的套件由协议自动选择，无需配置 ssl_ciphers

    # ─── 会话缓存 ───
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;  # 禁用 Session Ticket 以保证前向保密

    # ─── OCSP Stapling ───
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;
    resolver 8.8.8.8 1.1.1.1 valid=300s;
    resolver_timeout 5s;

    # ─── 安全响应头 ───
    # HSTS: 告诉浏览器只用 HTTPS 访问，有效期 2 年，包含子域名
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # 其他安全头（配合 CSP 文章使用）
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # ─── Laravel 应用 ───
    root /var/www/example.com/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;

        # 传递原始协议信息给 Laravel
        fastcgi_param HTTPS on;
        fastcgi_param HTTP_X_FORWARDED_PROTO https;
    }

    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
    }
}
```

### 2.2 Nginx SSL 配置片段化（多站点复用）

30+ 个项目的最佳实践是把 SSL 配置抽成 snippet：

```nginx
# /etc/nginx/snippets/ssl-params.conf

ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
ssl_ecdh_curve secp384r1;

ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;

ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 1.1.1.1 valid=300s;
resolver_timeout 5s;

# DH 参数（可选，增强 TLS 1.2 安全性）
# ssl_dhparam /etc/nginx/dhparam.pem;

add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
```

```nginx
# /etc/nginx/snippets/ssl-example-com.conf

ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;
```

```nginx
# 站点配置只需两行引入
server {
    listen 443 ssl http2;
    server_name example.com;
    include snippets/ssl-params.conf;
    include snippets/ssl-example-com.conf;
    # ... 其他配置
}
```

## 三、自动续期机制

Let's Encrypt 证书有效期只有 90 天。必须配置自动续期。

### 3.1 systemd Timer（推荐）

```bash
# 检查 certbot 是否已创建 timer
sudo systemctl list-timers | grep certbot

# 如果没有，手动创建
sudo tee /etc/systemd/system/certbot-renew.timer > /dev/null << 'EOF'
[Unit]
Description=Certbot renewal timer

[Timer]
OnCalendar=*-*-* 02,14:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo tee /etc/systemd/system/certbot-renew.service > /dev/null << 'EOF'
[Unit]
Description=Certbot renewal

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now certbot-renew.timer
```

### 3.2 cron 方式（传统）

```bash
# 每天凌晨 3 点和下午 3 点各检查一次
sudo crontab -e
0 3,15 * * * certbot renew --quiet --deploy-hook "systemctl reload nginx" >> /var/log/certbot-renew.log 2>&1
```

### 3.3 验证续期是否正常

```bash
# 模拟续期（dry-run）
sudo certbot renew --dry-run

# 检查证书到期时间
sudo certbot certificates

# 或者用 openssl 检查
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -dates
```

## 四、Laravel 应用层 HTTPS 配置

### 4.1 强制 HTTPS

```php
// app/Providers/AppServiceProvider.php

public function boot(): void
{
    // 生产环境强制 HTTPS
    if ($this->app->environment('production')) {
        \Illuminate\Support\Facades\URL::forceScheme('https');
        // 如果在负载均衡器后面终止 SSL
        // \Illuminate\Support\Facades\URL::forceRootUrl('https://example.com');
    }
}
```

### 4.2 TrustProxies（反向代理场景）

当 Nginx 终止 SSL 后通过 HTTP 转发给 Laravel 时，需要信任代理头：

```php
// app/Http/Middleware/TrustProxies.php

protected $proxies = [
    '10.0.0.0/8',      // 内网代理
    '172.16.0.0/12',
    '192.168.0.0/16',
];

protected $headers = Request::HEADER_X_FORWARDED_FOR
    | Request::HEADER_X_FORWARDED_HOST
    | Request::HEADER_X_FORWARDED_PORT
    | Request::HEADER_X_FORWARDED_PROTO
    | Request::HEADER_X_FORWARDED_AWS_ELB;
```

### 4.3 安全 Cookie 配置

```php
// config/session.php
'secure' => env('SESSION_SECURE_COOKIE', true),  // 生产环境只通过 HTTPS 传输
'same_site' => 'lax',  // 防 CSRF，同时允许正常的跨站导航

// config/cookie.php（Laravel 11+）
'secure' => env('COOKIE_SECURE', true),
'http_only' => true,
'same_site' => 'lax',
```

### 4.4 Nginx 传递协议信息

确保 Laravel 能正确识别 HTTPS 请求：

```nginx
# 在 fastcgi_pass 之后添加
fastcgi_param HTTPS on;
fastcgi_param HTTP_X_FORWARDED_PROTO https;
fastcgi_param HTTP_X_FORWARDED_FOR $remote_addr;
```

## 五、SSL Labs A+ 评级检查清单

```
┌────────────────────────────────────────────────────────┐
│              SSL Labs A+ 评级检查清单                    │
├──────────┬─────────────────────────────────────────────┤
│ 检查项    │ 要求                                        │
├──────────┼─────────────────────────────────────────────┤
│ 协议      │ 仅 TLS 1.2 + TLS 1.3                       │
│ 密钥      │ RSA 2048+ 或 ECDSA 256+                    │
│ 前向保密  │ ECDHE 密钥交换                              │
│ OCSP     │ Stapling 已启用                              │
│ HSTS     │ max-age ≥ 63072000 (2年)                    │
│ 证书链    │ 完整（fullchain.pem 包含中间证书）            │
│ 会话票证  │ 禁用（保证前向保密）                          │
│ DH 参数  │ 2048+ 位（如使用）                           │
└──────────┴─────────────────────────────────────────────┘
```

### 5.1 SSL Labs 评级对比速查

不同评级之间的差距往往只在一两个配置项，下面是各评级的核心差异：

| 评级 | 协议 | 密钥 | 前向保密 | HSTS | OCSP Stapling | 证书链 | 典型场景 |
|------|------|------|----------|------|---------------|--------|----------|
| A+ | TLS 1.2 + 1.3 | RSA 2048+ / ECDSA 256+ | ECDHE | ≥ 2年 + includeSubDomains + preload | ✅ | 完整 fullchain | 生产环境标准配置 |
| A | TLS 1.2 + 1.3 | RSA 2048+ / ECDSA 256+ | ECDHE | 无或 max-age < 2年 | ✅ | 完整 | 缺少 HSTS 或未提交 preload |
| B | TLS 1.0/1.1 + 1.2 | RSA 2048+ | 可选 | 无 | 可选 | 完整 | 向后兼容旧客户端 |
| C | TLS 1.0 | RSA 1024+ | 无 | 无 | 无 | 可能不完整 | 已废弃的旧系统 |
| F | 无 TLS / 已知漏洞 | < RSA 1024 | 无 | 无 | 无 | 缺失 | 配置错误或未部署 |

**从 A 升级到 A+ 的关键操作：**
1. `add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;`
2. 到 [hstspreload.org](https://hstspreload.org/) 提交域名
3. 等待浏览器厂商审核（通常 1-4 周）

> ⚠️ **注意**：提交 HSTS Preload 前，确保所有子域名（包括开发/测试环境）都已支持 HTTPS，否则将被锁死在 HTTPS 上。

验证命令：

```bash
# 在线检查
# https://www.ssllabs.com/ssltest/analyze.html?d=example.com

# 命令行快速检查
nmap --script ssl-enum-ciphers -p 443 example.com

# 检查证书链完整性
echo | openssl s_client -connect example.com:443 -servername example.com -showcerts 2>/dev/null | grep -E "Certificate chain|depth|verify"
```

## 六、踩坑记录

### 坑 1：证书链不完整导致 Android/旧浏览器报错

**现象**：Chrome/Firefox 正常，但 Android 4.x 和部分旧版 Java 客户端报 `SSLHandshakeException`。

**原因**：使用了 `cert.pem` 而非 `fullchain.pem`。`cert.pem` 只包含服务器证书，不含 Let's Encrypt 的中间证书（ISRG Root X1 → R3 → 你的证书）。

```nginx
# ❌ 错误：缺少中间证书
ssl_certificate /etc/letsencrypt/live/example.com/cert.pem;

# ✅ 正确：使用完整证书链
ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
```

**教训**：永远用 `fullchain.pem`，不要用 `cert.pem`。

### 坑 2：续期失败导致证书过期

**现象**：某天突然收到浏览器"连接不安全"警告，检查发现证书已过期。

**原因**：certbot 续期时 Nginx 的 80 端口被防火墙拦截（安全组规则被误改），HTTP-01 Challenge 验证失败。

**修复**：

```bash
# 1. 确保 80 端口可达
sudo ufw allow 80/tcp
# 或检查云厂商安全组

# 2. 手动续期
sudo certbot renew --force-renewal

# 3. 添加监控告警
# 检查证书剩余天数，不足 14 天时告警
```

监控脚本：

```bash
#!/bin/bash
# /opt/scripts/check-cert-expiry.sh

DOMAIN="example.com"
EXPIRY=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)
EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s)
NOW_EPOCH=$(date +%s)
DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

if [ "$DAYS_LEFT" -lt 14 ]; then
    echo "⚠️ 证书将在 ${DAYS_LEFT} 天后过期！" | mail -s "SSL 证书告警: $DOMAIN" ops@example.com
fi
```

### 坑 3：HSTS 预加载导致开发环境无法访问

**现象**：配置了 HSTS `includeSubDomains; preload` 并提交到 HSTS Preload List 后，开发环境的 `dev.example.com`（HTTP）完全无法访问。

**原因**：HSTS Preload 是全局生效的——一旦你的域名被加入浏览器的预加载列表，所有主流浏览器都会强制 HTTPS，包括子域名。

**教训**：
- `preload` 要谨慎使用，确认所有子域名都已支持 HTTPS
- 开发/测试环境使用独立域名（如 `dev.example.local`），不要放在被预加载的域名下
- 如果已经误提交，移除过程需要数月

### 坑 4：混合内容（Mixed Content）导致页面功能异常

**现象**：HTTPS 页面加载了，但部分 API 调用、图片、JS 资源被浏览器拦截，控制台报 `Mixed Content`。

**排查方法**：

```bash
# 用 curl 检查响应中是否有 http:// 链接
curl -s https://example.com | grep -i 'http://'

# Chrome DevTools → Security 面板 → 查看 Mixed Content 列表
```

**Laravel 层面修复**：

```php
// app/Providers/AppServiceProvider.php
public function boot(): void
{
    if ($this->app->environment('production')) {
        URL::forceScheme('https');
    }
}

// 确保 asset() 和 url() 生成 https 链接
// config/app.php
'asset_url' => env('ASSET_URL', 'https://cdn.example.com'),
```

**Nginx 层面修复**（Content-Security-Policy 升级不安全请求）：

```nginx
add_header Content-Security-Policy "upgrade-insecure-requests" always;
```

### 坑 5：Let's Encrypt Rate Limit 触发

**现象**：新域名申请证书时报 `too many certificates already issued for example.com`。

**原因**：Let's Encrypt 对每个注册域名每周最多签发 50 个证书（Duplicate Certificate Limit 5/周）。

**教训**：
- 先用 `--staging` 环境测试，确认配置正确后再申请正式证书
- 多域名合并到一个 SAN 证书，而非每个子域名单独申请
- 通配符证书是减少申请次数的最佳方案

```bash
# 使用 staging 环境测试
sudo certbot certonly --staging --nginx -d example.com -d www.example.com
```

### 坑 6：Nginx reload 后旧 Worker 持有旧证书

**现象**：证书续期后，部分请求仍返回旧证书。

**原因**：`nginx -s reload` 时，旧的 worker 进程在处理完当前请求前不会退出，持有旧证书的内存映射。

**解决**：

```bash
# reload 后等待几秒，或直接 restart
sudo systemctl restart nginx

# 验证新证书已生效
echo | openssl s_client -connect example.com:443 2>/dev/null | openssl x509 -noout -serial
```

## 常见问题快速排查表

| 问题 | 现象 | 原因 | 修复 |
|------|------|------|------|
| 证书过期 | 浏览器报"连接不安全"、ERR_CERT_DATE_INVALID | 自动续期失败、cron/timer 未运行 | `certbot renew --force-renewal`；检查定时任务 |
| 证书链不完整 | 旧浏览器/Android 报 SSLHandshakeException，Chrome 正常 | 使用了 `cert.pem` 而非 `fullchain.pem` | `ssl_certificate` 改为 `fullchain.pem` |
| 混合内容 | HTTPS 页面部分资源被拦截，控制台 Mixed Content 警告 | HTML/JS 中硬编码了 `http://` 链接 | Nginx 加 `upgrade-insecure-requests`；Laravel 加 `URL::forceScheme('https')` |
| HSTS 预加载锁死 | 提交 preload 后子域名 HTTP 无法访问 | 所有子域名必须先支持 HTTPS | 无法快速撤销，需等待浏览器更新（数月） |
| 续期失败（Rate Limit） | 报 `too many certificates already issued` | Let's Encrypt 每周限 50 张/域名 | 先用 `--staging` 测试；合并多域名为 SAN 证书 |
| OCSP Stapling 超时 | 首次连接延迟高、`ssl_stapling_verify` 报错 | DNS 解析慢或上游 CA 不可达 | 配置 `resolver 8.8.8.8 1.1.1.1 valid=300s` |
| 证书续期后旧证书残留 | 部分请求仍返回旧证书 | Nginx reload 时旧 worker 未退出 | `systemctl restart nginx` 而非 `reload` |
| TLS 握手失败 | 客户端报 handshake_failure | ssl_ciphers 过于严格、客户端不支持 | 保留 TLS 1.2 兼容套件；用 `nmap --script ssl-enum-ciphers` 验证 |

## 七、Laravel B2C API 特殊场景

### 7.1 支付回调必须 HTTPS

Stripe 和 AliPay 的 Webhook 回调必须走 HTTPS：

```php
// Stripe Webhook URL 必须是 https://
// config/services.php
'stripe' => [
    'webhook_url' => env('STRIPE_WEBHOOK_URL', 'https://api.example.com/webhooks/stripe'),
],
```

### 7.2 Nginx + HTTPS 性能优化

```nginx
# 启用 TLS 1.3 0-RTT（注意重放攻击风险）
ssl_early_data on;

# 在 location 中添加
proxy_set_header Early-Data $ssl_early_data;

# 启用 HTTP/2 Server Push（谨慎使用）
http2_push_preload on;
```

### 7.3 负载均衡场景的 SSL 终止

```
                    ┌─────────────────┐
  HTTPS ──────────▶ │  LB (AWS ALB)   │
                    │  SSL Termination │
                    └────────┬────────┘
                             │ HTTP
                    ┌────────┴────────┐
              ┌─────┤   Nginx (×N)    ├─────┐
              │     │   反向代理       │     │
              │     └────────┬────────┘     │
              │              │              │
        ┌─────┴───┐  ┌──────┴───┐  ┌──────┴───┐
        │ PHP-FPM │  │ PHP-FPM  │  │ PHP-FPM  │
        │ Laravel │  │ Laravel  │  │ Laravel  │
        └─────────┘  └──────────┘  └──────────┘
```

```nginx
# Nginx 配置（信任上游 LB 的 X-Forwarded-Proto）
set_real_ip_from 10.0.0.0/8;
real_ip_header X-Forwarded-Proto;

# 确保 Laravel 看到的是 HTTPS
if ($http_x_forwarded_proto = 'https') {
    set $fe_https on;
}
fastcgi_param HTTPS $fe_https;
```

## 八、HSTS Preload 提交流程

配置好 HSTS 头之后，还可以将域名提交到浏览器厂商的 HSTS Preload List，确保浏览器在**首次访问**时就强制使用 HTTPS（而不是等第一次 HTTPS 响应后才记住 HSTS）。

### 8.1 提交前提条件

| 条件 | 要求 |
|------|------|
| HSTS 头 | `max-age >= 63072000`（2年） |
| includeSubDomains | 必须包含 |
| preload | 必须包含 |
| 所有子域名 | 必须全部支持 HTTPS（包括开发/测试环境） |
| 根域名 | 必须可访问 HTTPS |
| 重定向 | HTTP → HTTPS 301 重定向（非 302） |

### 8.2 提交步骤

```bash
# 1. 确认 HSTS 头已正确配置
curl -sI https://example.com | grep -i strict-transport
# Strict-Transport-Security: max-age=63072000; includeSubDomains; preload

# 2. 确认所有子域名都支持 HTTPS
curl -sI http://api.example.com | grep -i strict-transport
curl -sI http://admin.example.com | grep -i strict-transport

# 3. 确认 HTTP → HTTPS 重定向
curl -sI http://example.com | head -1
# HTTP/1.1 301 Moved Permanently
```

然后到 [hstspreload.org](https://hstspreload.org/) 提交：
1. 输入域名 `example.com`
2. 点击 "Submit Domain"
3. 等待浏览器厂商审核（Chrome/Edge/Firefox/Safari 会定期同步列表）
4. 审核通过后，下次浏览器更新时你的域名就会被加入预加载列表

### 8.3 撤销 HSTS Preload（高风险操作）

如果需要撤销，流程非常漫长：
1. 从 Nginx 配置中移除 `preload` 指令（保留 `max-age=63072000; includeSubDomains`）
2. 在 hstspreload.org 提交移除请求
3. 等待浏览器厂商更新列表（可能需要数月）
4. **在此期间，已缓存 HSTS 的浏览器仍会强制 HTTPS**

> ⚠️ 这就是为什么我在前面强调：**提交 HSTS Preload 前务必确认所有子域名都已支持 HTTPS**。一旦提交，撤销成本极高。

## 总结

```
HTTPS 落地检查清单：
□ 证书使用 fullchain.pem（非 cert.pem）
□ 仅启用 TLS 1.2 + TLS 1.3
□ 启用 OCSP Stapling
□ 配置 HSTS（max-age ≥ 2年）
□ 自动续期 + 监控告警（剩余 < 14 天）
□ 禁用 Session Tickets（保证前向保密）
□ Laravel URL::forceScheme('https')
□ 安全 Cookie（secure + httpOnly + same_site=lax）
□ SSL Labs 评级 ≥ A+
□ 支付回调 URL 全部 HTTPS
```

HTTPS 不是一劳永逸的事情。证书会过期、配置会过时、新的攻击向量会出现。把它当作持续运维的一部分——配置好自动续期、加上监控告警、定期跑一次 SSL Labs 检查——才是生产环境的正确姿势。

---

## 相关阅读

- [Nginx 配置实战：PHP-FPM 调优、FastCGI 缓存、Gzip 压缩](/architecture/nginx-guide-php-fpm-fastcgi-cache-gzip) — Nginx 性能优化的完整指南，与本文的 SSL 配置形成互补
- [CSP 内容安全策略实战：防御 XSS 攻击](/architecture/csp-guide-xss-laravel-nonce-strict-dynamic) — CSP 与 HSTS 同为安全响应头，本文提到的 `add_header` 配置可结合 CSP 一起落地
- [CORS 跨域资源共享配置与安全策略](/architecture/cors-guide) — CORS 配置中的安全头与本文的 HTTPS 安全头相互配合
- [负载均衡实战：Nginx Upstream + Laravel Session 共享](/architecture/load-balancingguide-nginx-upstream-laravel-session) — 负载均衡场景下的 SSL 终止与本文第七节内容直接相关
- [Webhook 集成最佳实践：签名验证、重试与幂等处理](/architecture/webhook-best-practices) — Stripe/AliPay 的 Webhook 回调必须走 HTTPS，签名验证依赖证书有效性

> 📌 **参考链接**
> - [Let's Encrypt Rate Limits](https://letsencrypt.org/docs/rate-limits/)
> - [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
> - [SSL Labs Server Test](https://www.ssllabs.com/ssltest/)
> - [HSTS Preload List](https://hstspreload.org/)
