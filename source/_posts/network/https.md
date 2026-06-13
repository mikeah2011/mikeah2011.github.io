---

title: HTTPS 深度解析：TLS 握手、证书链与 Laravel HTTPS 配置
keywords: [HTTPS, TLS, Laravel HTTPS, 深度解析, 握手, 证书链与]
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
tags:
- HTTPS
- TLS
- SSL
- 网络安全
- HTTP
- Laravel
- 证书
- CA
categories:
- network
- infra
date: 2017-03-20 15:05:07
description: HTTPS全称Hyper Text Transfer Protocol over SecureSocket Layer，是以安全为目标的HTTP通道。通过TLS/SSL加密层保护数据传输的机密性与完整性，防止中间人攻击与数据窃听。本文深入讲解HTTPS原理、TLS握手流程、证书类型对比、Let's Encrypt实战配置及PHP/Laravel强制HTTPS方案。
---


HTTPS（Hyper Text Transfer Protocol over SecureSocket Layer）是以安全为目标的HTTP通道，简单讲是HTTP的安全版，即HTTP下加入SSL/TLS层。HTTPS的安全基础是SSL（Secure Socket Layer）及其继任者TLS（Transport Layer Security），因此加密的详细内容就需要SSL/TLS。HTTPS协议的主要作用可以分为两种：一种是建立一个信息安全通道，来保证数据传输的安全；另一种就是确认网站的真实性。

<!-- more -->

![img](/images/HTTPS.png)

HTTPS 并非是应用层的一种新协议。只是 HTTP 通信接口部分用SSL（Secure Socket Layer）和 TLS（Transport Layer Security）协议代替而已。通常，HTTP 直接和 TCP 通信。当使用 SSL时，则演变成先和 SSL通信，再由 SSL和 TCP 通信了。简言之，所谓 HTTPS，其实就是身披SSL协议这层外壳的 HTTP。

## HTTPS通讯方式

1. 客户使用https的URL访问Web服务器，要求与Web服务器建立SSL连接。
2. Web服务器收到客户端请求后，会将网站的证书信息（证书中包含公钥）传送一份给客户端。
3. 客户端的浏览器与Web服务器开始协商SSL连接的安全等级，也就是信息加密的等级。
4. 客户端的浏览器根据双方同意的安全等级，建立会话密钥，然后利用网站的公钥将会话密钥加密，并传送给网站。
5. Web服务器利用自己的私钥解密出会话密钥。
6. Web服务器利用会话密钥加密与客户端之间的通信。

![img](/images/HTTPS_1.png)

## 为什么HTTPS安全

1. SSL不仅提供加密处理，加密方式为混合加密。
2. SSL而且还使用了一种被称为证书的手段，可用于确定方。证书由值得信任的第三方机构颁发，用以证明服务器和客户端是实际存在的。另外，伪造证书从技术角度来说是异常困难的一件事。所以只要能够确认通信方（服务器或客户端）持有的证书。

![img](/images/HTTPS_2.png)

**加密方法**

> **对称加密：**加密和解密同用一个密钥的方式称为共享密钥加密（Common keycrypto system），也被叫做对称密钥加密.

对成加密的方式效率比较低，加密速度慢。另外对称加密存在安全隐患的问题，堆成加密的密钥必须要传到对方对方才能解密，要是对方在密钥传输的过程获取到密钥，那不是密钥失去了加密的意义，所以完全使用对称加密也是不安全的。

> **非对称加密：**公开密钥加密使用一对非对称的密钥。一把叫做私有密钥（private key），另一把叫做公开密钥（public key）。顾名思义，私有密钥不能让其他任何人知道，而公开密钥则可以随意发布，任何人都可以获得。公钥加密，私钥解密使用公开密钥加密方式，发送密文的一方使用对方的公开密钥进行加密处理，对方收到被加密的信息后，再使用自己的私有密钥进行解密。

那么非对称个加密就一定安全吗？非对称加密也不安全，为什么呢？因为存在中间伪造公钥和私钥，假如在公钥传给对方的时候，有人获取到公钥，虽然她不能用你的公钥做什么，但是它截获公钥后，把自己伪造的公钥发送给对方，这样对方获取的就不是真正的公钥，当对方用公钥进行加密文件，再将文件发送给对方，这样即使截获人没有获取到真正的私钥，但是加密时的公钥是截获人的，他获取到加密文件，只需要用自己的私钥进行解密就成功获取到文件了。

> **混合加密机制（对称加密与非对称加密结合的方式）**顾名思义也就是对称加密和非对称加密的方式相结合。

![img](/images/HTTPS_3.png)

如何证明公开没要本身的真实性。因为在公开秘钥传输的过程中，可能真正的公开秘钥已经被攻击者替换掉了。

为了解决上述问题，于是除了CA认证证书。服务器将CA证书发送给客户端，以进行公开密钥加密方式通信。接到证书的客户端可使用数字证书认证机构的公开密钥，对那张证书上的数字签名进行验证，一旦验证通过，客户端便可明确两件事：

- 一：认证服务器的公开密钥的是真实有效的数字证书认证机构；
- 二：服务器的公开密钥是值得信赖的。

那么公开密钥如何交接给客户端是一件非常重要的事，因此多数浏览器开发商发布版本时，会事先在内部植入常用认证机关的公开密钥，这样就确保公钥是使用认证机构的公钥避免了公钥伪造的过程，进而确保了安全。

![img](/images/HTTPS_4.webp)

## TLS 1.2 vs TLS 1.3：核心差异与改进

TLS 1.3（RFC 8446，2018年发布）是TLS协议的重大升级，相比TLS 1.2带来了显著的安全性与性能提升。

### TLS 1.3 的关键改进

| 特性 | TLS 1.2 | TLS 1.3 |
|------|---------|---------|
| 握手往返次数 | 2-RTT（两次往返） | 1-RTT（一次往返），支持 0-RTT 恢复 |
| 密钥协商算法 | RSA、DHE、ECDHE 等多种 | 仅保留 (EC)DHE，移除RSA密钥交换 |
| 加密套件数量 | 大量（含不安全的） | 仅5个，全部基于AEAD |
| 前向保密 | 可选（取决于套件选择） | 强制要求前向保密（PFS） |
| 握手过程可见性 | 部分明文传输 | 大部分握手内容加密 |
| 0-RTT | 不支持 | 支持（Early Data） |
| 密钥导出 | PRF-based | HKDF-based |
| 已移除的不安全特性 | 含压缩、CBC模式、RC4等 | 全部移除 |

### TLS 1.3 支持的加密套件

TLS 1.3 仅保留5种安全的加密套件：

```
TLS_AES_128_GCM_SHA256
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256
TLS_AES_128_CCM_SHA256
TLS_AES_128_CCM_8_SHA256
```

全部采用AEAD（Authenticated Encryption with Associated Data）模式，消除了CBC模式的Padding Oracle攻击风险。

### TLS 1.3 握手流程

```
Client                                Server
  |                                      |
  |--- ClientHello + KeyShare ----------->|  (1-RTT)
  |    (支持的密码套件、密钥共享)             |
  |                                      |
  |<-- ServerHello + KeyShare ------------|
  |    {EncryptedExtensions}              |
  |    {Certificate*}                     |
  |    {CertificateVerify*}              |
  |    {Finished}                         |
  |                                      |
  |--- {Finished} ----------------------->|  握手完成
  |                                      |
  |<------------ Application Data ------>|  0-RTT恢复时可直接发送
```

> **重要提示：** TLS 1.3 的 0-RTT 模式虽然性能优秀，但存在重放攻击风险。对于涉及资金交易等敏感操作，建议不要在 0-RTT Early Data 中发送状态修改请求。

## 证书类型（DV、OV、EV）对比

| 特性 | DV（域名验证） | OV（组织验证） | EV（扩展验证） |
|------|--------------|--------------|--------------|
| 验证内容 | 仅验证域名所有权 | 验证域名 + 组织真实性 | 严格审核域名、组织、法律实体 |
| 签发时间 | 分钟级 | 1-3个工作日 | 1-2周 |
| 浏览器显示 | 锁图标 | 锁图标 | 锁图标（部分旧浏览器显示绿色地址栏） |
| 证书内容 | 仅包含域名信息 | 包含组织名称和域名 | 包含完整的组织信息 |
| 价格 | 免费 - 低价 | 中等 | 较高 |
| 适用场景 | 个人网站、博客 | 企业官网、电商平台 | 金融、银行、大型企业 |
| 代表性CA | Let's Encrypt、ZeroSSL | DigiCert、Comodo | DigiCert、Entrust |
| 信任等级 | 基本 | 中等 | 最高 |

> **选择建议：** 个人项目和中小型网站推荐使用 Let's Encrypt（免费DV证书）；对品牌形象和用户信任有较高要求的企业网站建议使用OV或EV证书。

## Let's Encrypt / Certbot 实战配置

Let's Encrypt 是由 ISRG（Internet Security Research Group）提供的免费、自动化、开放的证书颁发机构，已成为全球使用最广泛的SSL证书来源。

### 安装 Certbot

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install certbot

# 如果使用 Nginx
sudo apt install python3-certbot-nginx

# 如果使用 Apache
sudo apt install python3-certbot-apache

# CentOS / RHEL / AlmaLinux
sudo dnf install certbot
sudo dnf install python3-certbot-nginx  # Nginx 插件
```

### 使用 Nginx 插件自动配置

```bash
# 自动获取证书并配置 Nginx
sudo certbot --nginx -d example.com -d www.example.com

# 仅获取证书（不自动修改 Nginx 配置）
sudo certbot certonly --nginx -d example.com -d www.example.com

# 使用 Webroot 模式（适合已有 Nginx 配置的场景）
sudo certbot certonly --webroot -w /var/www/html -d example.com
```

### 使用 Standalone 模式

```bash
# 临时启动内置Web服务器验证（需要80端口空闲）
sudo certbot certonly --standalone -d example.com -d www.example.com
```

### 使用 DNS 验证（通配符证书）

```bash
# DNS 验证方式获取通配符证书
sudo certbot certonly --manual --preferred-challenges dns -d "*.example.com" -d example.com

# 使用 Cloudflare DNS 插件自动化
sudo apt install python3-certbot-dns-cloudflare
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini -d "*.example.com" -d example.com
```

### 自动续期

```bash
# 测试续期是否正常
sudo certbot renew --dry-run

# 添加 crontab 自动续期（每天凌晨2点检查）
sudo crontab -e
# 添加以下行：
0 2 * * * /usr/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
```

### 证书文件路径

```bash
/etc/letsencrypt/live/example.com/
├── fullchain.pem   # 证书链（服务器证书 + 中间证书）
├── privkey.pem     # 私钥
├── cert.pem        # 服务器证书
└── chain.pem       # 中间证书链
```

## PHP/Laravel HTTPS 强制实施方案

### 方案一：Nginx 配置强制跳转

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    # 301永久重定向到HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # TLS 协议版本
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS（强制浏览器使用HTTPS访问）
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    root /var/www/example.com/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

### 方案二：Apache .htaccess 强制跳转

```apache
# 在项目根目录 .htaccess 中添加
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

### 方案三：Laravel 中间件强制 HTTPS

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ForceHttps
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!$request->secure() && app()->environment('production')) {
            return redirect()->secure($request->getRequestUri(), 301);
        }

        return $next($request);
    }
}
```

在 `bootstrap/app.php`（Laravel 11+）或 `app/Http/Kernel.php` 中注册：

```php
// Laravel 11+ bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->append(\App\Http\Middleware\ForceHttps::class);
})

// Laravel 10 及之前 app/Http/Kernel.php
// 在 $middleware 数组中添加
\App\Http\Middleware\ForceHttps::class,
```

### 方案四：Laravel AppServiceProvider 统一设置

```php
<?php

namespace App\Providers;

use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        if ($this->app->environment('production')) {
            URL::forceScheme('https');
            // 如果使用负载均衡器终止SSL
            // $this->app['request']->server->set('HTTPS', true);
        }
    }
}
```

### 方案五：Trusted Proxy 场景（负载均衡/CDN后端）

当应用部署在 Nginx 反向代理、Cloudflare、AWS ALB 等后端时，需要配置 Trusted Proxy：

```php
// config/trustedproxy.php 或 app/Http/Middleware/TrustProxies.php
protected $proxies = [
    '10.0.0.0/8',          // 内网代理
    '172.16.0.0/12',
    '192.168.0.0/16',
    // Cloudflare IP 范围
];

protected $headers = Request::HEADER_X_FORWARDED_FOR |
                     Request::HEADER_X_FORWARDED_HOST |
                     Request::HEADER_X_FORWARDED_PORT |
                     Request::HEADER_X_FORWARDED_PROTO |
                     Request::HEADER_X_FORWARDED_AWS_ELB;
```

## HTTPS 性能优化

HTTPS 的加密握手会带来一定的性能开销，以下优化手段可以显著提升HTTPS网站的响应速度。

### 1. OCSP Stapling

默认情况下，浏览器需要向CA的OCSP服务器验证证书有效性，这会增加额外的延迟。OCSP Stapling让服务器主动获取并缓存OCSP响应，直接在TLS握手时发送给客户端。

```nginx
server {
    listen 443 ssl;

    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;
}
```

### 2. TLS Session Resume（会话恢复）

通过Session Cache和Session Ticket减少完整握手次数：

```nginx
# Session Cache：存储会话参数，避免重复握手
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;

# Session Ticket：允许客户端跨服务器恢复会话
ssl_session_tickets on;
ssl_session_ticket_key /etc/nginx/ssl/ticket.key;
```

### 3. HTTP/2 协议支持

HTTP/2 在HTTPS基础上带来多路复用、头部压缩、服务器推送等性能优化：

```nginx
server {
    listen 443 ssl http2;  # 启用HTTP/2
    # 或使用 http3-quic 支持
    # listen 443 quic reuseport;
    # add_header Alt-Svc 'h3=":443"; ma=86400';
}
```

### 4. SSL 缓冲与 TCP Fast Open

```nginx
# SSL 缓冲：减少系统调用
ssl_buffer_size 4k;

# TCP Fast Open：减少TCP握手延迟
server {
    listen 443 ssl http2 fastopen=256;
}
```

### 5. 证书链优化

```bash
# 使用完整证书链，避免浏览器额外请求中间证书
# Let's Encrypt 的 fullchain.pem 已经包含中间证书
ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
# 使用 ECDSA 密钥代替 RSA（更短的密钥、更快的握手）
# ECDSA 256位 ≈ RSA 3072位 的安全性
```

## HTTPS vs HTTP/2 vs HTTP/3 关系

| 特性 | HTTP/1.1 + TLS 1.2 | HTTP/2 + TLS 1.2 | HTTP/2 + TLS 1.3 | HTTP/3（QUIC） |
|------|-------------------|-------------------|-------------------|----------------|
| 传输层 | TCP | TCP | TCP | UDP（QUIC） |
| 加密层 | TLS 1.2 | TLS 1.2 | TLS 1.3 | 内建TLS 1.3 |
| 多路复用 | 无 | 有（但存在队头阻塞） | 有 | 有（无队头阻塞） |
| 握手延迟 | 2-RTT | 2-RTT + TLS | 1-RTT + TLS | 1-RTT（含加密） |
| 连接迁移 | 不支持 | 不支持 | 不支持 | 支持 |
| 浏览器支持 | 全部 | 主流浏览器 | 主流浏览器 | Chrome/Edge/Firefox |

> **HTTP/3 的核心创新**是使用QUIC协议替代TCP，将TLS 1.3集成到传输层中，实现了真正的0-RTT连接建立，并解决了TCP的队头阻塞问题。在Nginx中可通过`listen 443 quic`启用HTTP/3支持。

## 常见 HTTPS 错误与排查

### 1. `ERR_CERT_DATE_INVALID` - 证书过期或时间错误

```bash
# 检查证书有效期
openssl x509 -in /path/to/cert.pem -noout -dates

# 检查服务器证书
openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -dates

# 解决：更新证书 / 检查服务器系统时间
sudo certbot renew
sudo timedatectl set-ntp true
```

### 2. `ERR_CERT_AUTHORITY_INVALID` - 证书链不完整

```bash
# 检查证书链完整性
openssl s_client -connect example.com:443 -servername example.com
# 查看 "Verify return code" 是否为 0 (ok)

# 解决：使用 fullchain.pem 而非 cert.pem
ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
```

### 3. `ERR_SSL_PROTOCOL_ERROR` - TLS版本或套件不兼容

```bash
# 检查服务器支持的TLS版本
nmap --script ssl-enum-ciphers -p 443 example.com

# 解决：确保支持TLS 1.2+
ssl_protocols TLSv1.2 TLSv1.3;
```

### 4. Mixed Content（混合内容）警告

```html
<!-- 错误：在HTTPS页面加载HTTP资源 -->
<script src="http://cdn.example.com/app.js"></script>
<img src="http://example.com/image.png">

<!-- 解决：使用协议相对URL或直接使用HTTPS -->
<script src="https://cdn.example.com/app.js"></script>
<!-- 或使用 CSP Header -->
<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">
```

### 5. HTTPS 重定向循环

```nginx
# 问题：Cloudflare Flexible SSL + Nginx 同时做重定向导致循环
# 解决：检查 X-Forwarded-Proto 头
if ($http_x_forwarded_proto = "http") {
    return 301 https://$host$request_uri;
}
```

## 生产环境安全最佳实践

### 1. 强制启用 HSTS

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

> 设置后浏览器将在 `max-age` 期间内始终使用HTTPS访问，即使用户手动输入 `http://`。`preload` 可提交到 [HSTS Preload List](https://hstspreload.org/)。

### 2. 配置安全响应头

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self' https:; script-src 'self' 'unsafe-inline' https://cdn.example.com; style-src 'self' 'unsafe-inline'" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

### 3. 定期轮换证书与密钥

```bash
# Let's Encrypt 证书有效期仅90天，建议自动续期
# 定期检查续期状态
sudo certbot certificates

# 对于自签名或商业证书，建议每年轮换
# 密钥轮换时建议生成新的私钥，而非继续使用旧密钥
```

### 4. 禁用不安全的TLS版本与弱密码套件

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
```

### 5. 使用 ECDSA 证书提升性能

```bash
# 生成 ECDSA 密钥（比 RSA 更小更快）
openssl ecparam -genkey -name prime256v1 -out /etc/ssl/private/example.com-ecdsa.key
openssl req -new -x509 -key /etc/ssl/private/example.com-ecdsa.key -out /etc/ssl/certs/example.com-ecdsa.crt -days 365 -subj "/CN=example.com"

# Let's Encrypt 支持 ECDSA
sudo certbot certkey-type ecdsa --elliptic-curve secp384r1
```

### 6. 监控证书到期

```bash
# 简单的证书到期检查脚本
#!/bin/bash
DOMAIN="example.com"
EXPIRY=$(echo | openssl s_client -connect ${DOMAIN}:443 -servername ${DOMAIN} 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)
EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s)
NOW_EPOCH=$(date +%s)
DAYS_LEFT=$(( ($EXPIRY_EPOCH - $NOW_EPOCH) / 86400 ))

if [ $DAYS_LEFT -lt 14 ]; then
    echo "WARNING: Certificate for $DOMAIN expires in $DAYS_LEFT days!"
    # 发送告警（邮件、Slack、钉钉等）
fi
```

## 总结

HTTPS已不再是可选项，而是现代Web应用的标配。从搜索引擎排名权重的提升（Google明确将HTTPS作为排名信号），到浏览器对HTTP网站的"不安全"警告，再到用户对数据安全的期待，HTTPS在生产环境中是必须的基础设施。通过合理选择证书类型、正确配置TLS参数、实施性能优化策略，可以在保证安全性的同时获得优秀的用户体验。

## 相关阅读

- [HTTP 协议详解](/2019/03/20/network/http/) - HTTP 协议基础、请求方法、状态码与缓存机制
- [TCP/IP 协议](/2016/03/20/network/tcp-ip/) - 传输层协议基础，理解 HTTPS 底层依赖
- [HTTP 状态码详解](/2019/03/20/network/status-codes/) - 常见HTTP状态码含义与使用场景
- [网络安全基础（XSS / CSRF / SQL 注入 / SSRF）](/2020/08/15/network/network-security/) - Web 安全攻防基础，HTTPS 无法防护的攻击类型
- [HTTP 三次握手](/2017/03/20/network/three-way-handshake/) - TCP 连接建立过程，TLS 握手的基础
