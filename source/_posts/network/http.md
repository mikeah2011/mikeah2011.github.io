---
title: HTTP
cover: /images/network-cover.png
tags: [HTTP, 网络协议, HTTPS, web, TCP]
categories: network
date: 2019-03-20 15:05:07
description: '全面解析HTTP协议核心知识：从HTTP/1.0到HTTP/3版本演进对比、请求方法与状态码详解、HTTPS与TLS安全握手原理、HTTP缓存机制（强缓存与协商缓存）、Cookie/Session/JWT认证方案对比，以及Keep-Alive、预连接、资源提示等HTTP性能优化实战技巧，助你深入理解Web核心协议并提升网站性能。'



---
**什么是HTTP?**

> 超文本传输协议，是一个基于请求与响应，无状态的，应用层的协议，常基于TCP/IP协议传输数据，互联网上应用最为广泛的一种网络协议,所有的WWW文件都必须遵守这个标准。设计HTTP的初衷是为了提供一种发布和接收HTML页面的方法。

**HTTP特点：**

1. 无状态：协议对客户端没有状态存储，对事物处理没有“记忆”能力，比如访问一个网站需要反复进行登录操作。
2. 无连接：HTTP/1.1之前，由于无状态特点，每次请求需要通过TCP三次握手四次挥手，和服务器重新建立连接。比如某个客户机在短时间多次请求同一个资源，服务器并不能区别是否已经响应过用户的请求，所以每次需要重新响应请求，需要耗费不必要的时间和流量。
3. 基于请求和响应：基本的特性，由客户端发起请求，服务端响应。
4. 简单快速、灵活。
5. 通信使用明文、请求和响应不会对通信方进行确认、无法保护数据的完整性。

**HTTP报文组成:**

1. 请求行：包括请求方法、URL、协议/版本
2. 请求头(Request Header)
3. 请求正文
4. 状态行
5. 响应头
6. 响应正文

![img](/images/HTTP.png)

**HTTP的缺点：**

1. 通信使用明文（不加密），内容可能会被窃听。
2. 不验证通信方的身份，因此有可能遭遇伪装。
3. 无法证明报文的完整性，所以有可能已遭篡改。

## HTTP版本演进

HTTP协议从诞生至今经历了多个版本的演进，每个版本都针对前一版本的不足进行了优化和改进。

### HTTP/1.0

- 每次请求都需要建立新的TCP连接，请求完成后立即断开。
- 引入了状态码、Content-Type头字段，支持多种内容类型。
- 不支持持久连接，性能较差。

### HTTP/1.1

HTTP/1.1 是目前使用最广泛的版本，相比1.0做了重大改进：

- **持久连接（keep-alive）**：默认启用长连接，同一TCP连接上可发送多个请求，减少建立和关闭连接的开销。
- **管线化（Pipelining）**：允许客户端在收到响应前连续发送多个请求，但存在队头阻塞（Head-of-Line Blocking）问题。
- **Host头字段**：支持同一IP地址上托管多个虚拟主机。
- **分块传输编码（Chunked Transfer Encoding）**：支持流式传输，不需要预先知道内容长度。
- **缓存机制增强**：引入 `Cache-Control`、`ETag` 等更精细的缓存控制头。

### HTTP/2

HTTP/2 于2015年正式发布，基于Google的SPDY协议，带来了革命性的改进：

- **多路复用（Multiplexing）**：同一连接上可以并行处理多个请求和响应，彻底解决了队头阻塞问题（应用层）。
- **头部压缩（HPACK）**：使用HPACK算法压缩头部，减少冗余头部传输，降低带宽消耗。
- **服务器推送（Server Push）**：服务器可以主动将客户端需要的资源推送到客户端缓存，减少请求延迟。
- **二进制分帧层**：将传输的数据分割为更小的帧，采用二进制编码，解析更高效。
- **流优先级**：客户端可以为请求分配优先级和依赖关系，优化资源加载顺序。

### HTTP/3

HTTP/3 是最新版本，于2022年被标准化为RFC 9114，最大的变化是底层传输协议从TCP改为QUIC：

- **基于QUIC协议**：QUIC基于UDP构建，内置加密和多路复用，解决了TCP的队头阻塞问题（传输层）。
- **0-RTT连接建立**：支持0-RTT（零往返时间）握手，首次连接仅需1-RTT，后续连接可实现0-RTT，大幅降低延迟。
- **连接迁移**：基于连接ID而非IP+端口标识连接，网络切换（如WiFi转4G）时连接不中断。
- **内置TLS 1.3**：加密成为协议的固有部分，不再可选。

### HTTP各版本对比

| 特性 | HTTP/1.0 | HTTP/1.1 | HTTP/2 | HTTP/3 |
|------|----------|----------|--------|--------|
| 连接方式 | 短连接 | 持久连接 | 多路复用 | QUIC多路复用 |
| 头部压缩 | 无 | 无 | HPACK | QPACK |
| 队头阻塞 | 存在 | 存在（应用层解决） | TCP层仍存在 | 彻底解决 |
| 服务器推送 | 不支持 | 不支持 | 支持 | 支持 |
| 传输协议 | TCP | TCP | TCP | UDP（QUIC） |
| 加密 | 可选 | 可选 | 可选 | 强制TLS 1.3 |
| 连接建立延迟 | 1-RTT + TLS | 1-RTT + TLS | 1-RTT + TLS | 0-RTT / 1-RTT |

## HTTP请求方法详解

HTTP定义了多种请求方法，每种方法都有特定的语义。

### GET

获取资源，是最常用的方法。GET请求应该是安全的（不修改服务器资源）且幂等的（多次请求结果一致）。

### POST

提交数据给服务器，常用于创建资源。POST不是幂等的，多次提交可能产生多个资源。

### PUT

替换目标资源的所有当前表示。PUT是幂等的，多次请求结果一致。

### DELETE

删除指定资源。DELETE是幂等的，删除已删除的资源结果不变。

### PATCH

对资源进行部分修改。PATCH不一定是幂等的。

### OPTIONS

查询目标资源支持的通信选项，常用于CORS预检请求（Preflight Request）。

### 请求方法属性表

| 方法 | 作用 | 幂等 | 安全 | 是否有请求体 |
|------|------|------|------|-------------|
| GET | 获取资源 | ✅ | ✅ | 否（不推荐） |
| POST | 创建资源 | ❌ | ❌ | 是 |
| PUT | 替换资源 | ✅ | ❌ | 是 |
| DELETE | 删除资源 | ✅ | ❌ | 可选 |
| PATCH | 部分更新 | ❌ | ❌ | 是 |
| OPTIONS | 查询选项 | ✅ | ✅ | 否 |
| HEAD | 获取头部 | ✅ | ✅ | 否 |

> **说明**：安全（Safe）指不会修改服务器资源；幂等（Idempotent）指多次请求的结果与一次请求的结果相同。

## HTTP状态码分类

HTTP状态码由三位数字组成，分为五大类，用于表示服务器对请求的处理结果。

### 1xx — 信息性状态码

表示请求已被接收，继续处理。

- **100 Continue**：客户端应继续发送请求体。
- **101 Switching Protocols**：服务器同意切换协议（如升级到WebSocket）。

### 2xx — 成功状态码

表示请求已被成功处理。

- **200 OK**：请求成功，返回所请求的资源。
- **201 Created**：请求成功并创建了新资源（常用于POST响应）。
- **204 No Content**：请求成功，但无返回内容（常用于DELETE响应）。

### 3xx — 重定向状态码

表示需要进一步操作才能完成请求。
- **301 Moved Permanently**：资源永久重定向到新的URL，搜索引擎会更新索引。
- **302 Found**：资源临时重定向，搜索引擎保留原URL。
- **304 Not Modified**：资源未修改，客户端可使用缓存，配合 `If-Modified-Since` 或 `ETag` 使用。

### 常见状态码使用场景详解

#### 1xx — 信息性状态码

表示请求已被接收，继续处理。在实际开发中较少直接遇到。

| 状态码 | 含义 | 典型场景 |
|--------|------|----------|
| 100 | Continue | 客户端发送 `Expect: 100-continue` 后继续发送请求体 |
| 101 | Switching Protocols | HTTP 升级到 WebSocket |


#### 2xx — 成功状态码

| 状态码 | 含义 | 典型场景 |
|--------|------|----------|
| 200 | OK | GET/PUT 请求成功，返回资源 |
| 201 | Created | POST 创建资源成功（如创建用户） |
| 204 | No Content | DELETE 成功，或无需返回内容的 PUT |
| 206 | Partial Content | 断点续传、视频流播放（Range 请求） |

```bash
# 断点续传示例
curl -r 0-999 https://example.com/large-file.zip -o part1.bin
curl -r 1000- https://example.com/large-file.zip -o part2.bin
```

#### 3xx — 重定向状态码

| 状态码 | 含义 | 典型场景 |
|--------|------|----------|
| 301 | Moved Permanently | 域名更换、HTTP 重定向到 HTTPS |
| 302 | Found | 临时跳转（登录后重定向） |
| 304 | Not Modified | 缓存命中，无需重新下载资源 |
| 307 | Temporary Redirect | 临时重定向且保持请求方法 |
| 308 | Permanent Redirect | 永久重定向且保持 POST 方法 |

```bash
# 查看重定向链
curl -L -v https://example.com 2>&1 | grep -i "Location:"
# 304 缓存验证示例
curl -H "If-None-Match: \"abc123\"" https://example.com/style.css -v
curl -H "If-Modified-Since: Wed, 21 Oct 2025 07:28:00 GMT" https://example.com/style.css -v
```

#### 4xx — 客户端错误状态码

| 状态码 | 含义 | 典型场景 |
|--------|------|----------|
| 400 | Bad Request | JSON 格式错误、缺少必填参数 |
| 401 | Unauthorized | 未携带 Token 或 Token 过期 |
| 403 | Forbidden | 无权限访问管理员接口 |
| 404 | Not Found | API 路径错误或资源已删除 |
| 405 | Method Not Allowed | 用 GET 访问仅支持 POST 的接口 |
| 408 | Request Timeout | 客户端发送请求超时 |
| 409 | Conflict | 创建重复资源（如重复用户名） |
| 413 | Payload Too Large | 上传文件超过服务器限制 |
| 429 | Too Many Requests | API 限流（每分钟最多 N 次请求） |

```bash
# 模拟 401 错误
curl https://api.example.com/protected-resource
# 模拟 429 限流
for i in {1..100}; do curl https://api.example.com/data; done
```

#### 5xx — 服务器错误状态码

| 状态码 | 含义 | 典型场景 |
|--------|------|----------|
| 500 | Internal Server Error | 代码未捕获的异常、数据库连接失败 |
| 502 | Bad Gateway | Nginx 反向代理后端服务宕机 |
| 503 | Service Unavailable | 服务器维护、流量过载（返回 Retry-After） |
| 504 | Gateway Timeout | 后端服务响应过慢，网关超时 |

```bash
# 检查 503 响应的 Retry-After 头
curl -I https://example.com/api/data 2>&1 | grep -i "Retry-After"
```

## HTTPS原理

HTTPS（HTTP Secure）是在HTTP的基础上加入了SSL/TLS安全层，用于在不安全的网络中提供安全的通信。

### 对称加密与非对称加密

**对称加密**：加密和解密使用相同的密钥。速度快，但密钥分发困难。常见算法有AES、DES。

**非对称加密**：使用一对密钥——公钥和私钥。公钥加密的数据只能用私钥解密，反之亦然。安全性高，但速度慢。常见算法有RSA、ECC。

HTTPS巧妙地结合了两种加密方式：

1. 使用**非对称加密**安全地交换对称加密的密钥。
2. 使用**对称加密**加密后续的通信数据。

### TLS握手过程

以TLS 1.2为例，完整的握手过程如下：

1. **Client Hello**：客户端发送支持的TLS版本、加密套件列表和一个随机数（Client Random）。
2. **Server Hello**：服务器选择加密套件，返回数字证书和另一个随机数（Server Random）。
3. **客户端验证证书**：客户端验证服务器证书的合法性（证书链、有效期、是否被吊销）。
4. **密钥交换**：客户端生成预主密钥（Pre-Master Secret），用服务器公钥加密后发送。
5. **生成会话密钥**：双方使用 Client Random + Server Random + Pre-Master Secret 生成对称会话密钥。
6. **加密通信开始**：双方使用会话密钥进行对称加密通信。

> TLS 1.3 将握手简化为1-RTT（甚至0-RTT），移除了不安全的加密算法，提升了安全性和性能。

### TLS 1.2 vs TLS 1.3 握手流程对比

| 对比项 | TLS 1.2 | TLS 1.3 |
|--------|---------|---------|
| 握手往返次数 | 2-RTT | 1-RTT（首次）/ 0-RTT（恢复） |
| 密钥交换 | RSA / DHE / ECDHE | 仅支持 (EC)DHE（前向保密） |
| 加密套件协商 | 复杂，支持多种组合 | 简化为5种，移除不安全算法 |
| 0-RTT 支持 | 不支持 | 支持（有重放攻击风险） |
| 证书加密 | 握手明文传输 | 服务器证书加密传输 |
| 会话恢复 | Session ID / Session Ticket | PSK（Pre-Shared Key）模式 |

**TLS 1.3 握手流程图解（1-RTT）：**

```
Client                                          Server
  |                                               |
  |---- ClientHello + KeyShare + supported_versions -->|
  |                                               |
  |<--- ServerHello + KeyShare + EncryptedExtensions --|
  |<--- Encrypted { Certificate, CertificateVerify } --|
  |<--- Encrypted { Finished } -------------------|
  |                                               |
  |---- Encrypted { Finished } ----------------->|
  |                                               |
  |<=========== Application Data ==============>|
```

**TLS 1.2 握手流程图解（2-RTT）：**

```
Client                                          Server
  |                                               |
  |---- ClientHello ----------------------------->|
  |<--- ServerHello + Certificate + ServerHelloDone|
  |                                               |
  |---- ClientKeyExchange + ChangeCipherSpec ---->|
  |---- Finished -------------------------------->|
  |<--- ChangeCipherSpec + Finished --------------|
  |                                               |
  |<=========== Application Data ==============>|
```

**查看服务器 TLS 版本的 curl 命令：**

```bash
# 查看服务器支持的 TLS 版本
curl -v --tlsv1.2 https://example.com 2>&1 | grep -i "SSL\|TLS"
openssl s_client -connect example.com:443 -tls1_2
openssl s_client -connect example.com:443 -tls1_3
```

### 数字证书与证书链

数字证书由**证书颁发机构（CA）**签发，用于验证服务器身份。证书链的验证过程：

1. 服务器证书（由中间CA签发）
2. 中间CA证书（由根CA签发）
3. 根CA证书（预置在操作系统/浏览器中）

客户端从服务器证书开始，逐级向上验证，直到找到可信的根CA证书。这就是**信任链（Chain of Trust）**机制。

## HTTP性能优化

### HTTP 缓存机制详解

HTTP 缓存是提升性能最重要的手段之一，分为**强缓存**和**协商缓存**两级。

#### 缓存决策流程

```
请求资源 → 强缓存是否命中？
  ├── 命中（200 from cache）→ 直接使用本地缓存，不发请求
  └── 未命中 → 发起请求 → 协商缓存是否命中？
        ├── 命中（304 Not Modified）→ 使用本地缓存
        └── 未命中（200 OK）→ 返回新资源
```

#### 强缓存

强缓存生效时，浏览器直接从本地缓存读取，**不会发送请求到服务器**。

| 头字段 | 示例 | 说明 |
|--------|------|------|
| `Cache-Control: max-age` | `max-age=3600` | 资源在 3600 秒内有效（HTTP/1.1，优先级高） |
| `Cache-Control: no-cache` | `no-cache` | 不使用强缓存，走协商缓存 |
| `Cache-Control: no-store` | `no-store` | 完全不缓存，每次请求全新资源 |
| `Cache-Control: public` | `public` | CDN 和浏览器均可缓存 |
| `Cache-Control: private` | `private` | 仅浏览器可缓存，CDN 不缓存 |
| `Expires` | `Thu, 01 Dec 2025 16:00:00 GMT` | 绝对过期时间（HTTP/1.0 遗留，优先级低于 max-age） |

```bash
# 查看缓存头
curl -I https://example.com/style.css
# 输出示例：
# Cache-Control: max-age=31536000, public
# Expires: Thu, 01 Dec 2026 16:00:00 GMT
# ETag: "5f7b3a1c-1a2b"
# Last-Modified: Sat, 03 Oct 2025 12:00:00 GMT
```

#### 协商缓存

协商缓存需要**发送请求到服务器验证**，如果资源未更新，服务器返回 `304 Not Modified`。

| 方案 | 请求头 | 响应头 | 精确度 | 说明 |
|------|--------|--------|--------|------|
| 时间对比 | `If-Modified-Since` | `Last-Modified` | 秒级 | 基于文件修改时间 |
| 内容对比 | `If-None-Match` | `ETag` | 精确 | 基于内容哈希，优先级更高 |

```bash
# 第一次请求，获取 ETag 和 Last-Modified
curl -I https://example.com/data.json
# ETag: "abc123"
# Last-Modified: Wed, 21 Oct 2025 07:28:00 GMT

# 第二次请求，携带验证头
curl -H 'If-None-Match: "abc123"' \
     -H 'If-Modified-Since: Wed, 21 Oct 2025 07:28:00 GMT' \
     -I https://example.com/data.json
# 响应：304 Not Modified（资源未变化，使用缓存）
```

#### 实际缓存策略推荐

```nginx
# Nginx 缓存配置示例
# HTML 文件：协商缓存（内容经常变化）
location ~* \.html$ {
    add_header Cache-Control "no-cache";
    add_header ETag "";
}

# 静态资源（JS/CSS/图片）：强缓存 + 文件名哈希
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    add_header Cache-Control "max-age=31536000, public, immutable";
}

# API 响应：不缓存
location /api/ {
    add_header Cache-Control "no-store";
}
```

### 连接优化

- **keep-alive**：复用TCP连接，减少握手开销。HTTP/1.1默认启用。

```bash
# 查看 Keep-Alive 设置
curl -I https://example.com | grep -i "keep-alive"
# 输出：Keep-Alive: timeout=5, max=100

# 显式使用 Keep-Alive 连接（curl 默认支持）
curl --keepalive-time 60 https://example.com/page1 https://example.com/page2
```
- **HTTP/2多路复用**：单连接并行传输多路请求。

### 传输优化

- **Gzip/Brotli压缩**：对文本资源进行压缩传输，可减少60%-80%的传输大小。
- **减少Cookie大小**：Cookie会随每个请求发送，过大会影响性能。

### 缓存策略

HTTP缓存分为**强缓存**和**协商缓存**两种：

**强缓存**（不发请求，直接使用本地缓存）：
- `Cache-Control: max-age=3600`：资源在3600秒内有效。
- `Expires: Thu, 01 Dec 2025 16:00:00 GMT`：指定过期时间（HTTP/1.0遗留）。

**协商缓存**（发送请求验证资源是否更新）：
- `Last-Modified` / `If-Modified-Since`：基于资源最后修改时间。
- `ETag` / `If-None-Match`：基于资源内容的哈希值，更精确。

当协商缓存生效时，服务器返回 `304 Not Modified`，客户端继续使用本地缓存。

### CDN加速

CDN（Content Delivery Network）通过在全球部署边缘节点，将资源缓存到离用户最近的节点，减少网络延迟。结合HTTP缓存头，可以显著提升静态资源的加载速度。

### HTTP 性能优化实战

#### 预连接（Preconnect）

```html
<!-- 提前建立与第三方域名的连接（DNS + TCP + TLS） -->
<link rel="preconnect" href="https://cdn.example.com">
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
```

#### 预加载（Preload）

```html
<!-- 当前页面一定会用到的关键资源，提前加载 -->
<link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/css/critical.css" as="style">
<link rel="preload" href="/js/app.js" as="script">
```

#### 预获取（Prefetch）

```html
<!-- 下一个页面可能用到的资源，空闲时加载 -->
<link rel="prefetch" href="/next-page.html">
<link rel="prefetch" href="/images/hero.webp">
```

#### DNS 预解析

```html
<!-- 提前解析第三方域名的 DNS -->
<link rel="dns-prefetch" href="//cdn.example.com">
<link rel="dns-prefetch" href="//analytics.google.com">
```

#### 性能优化 curl 验证

```bash
# 测量连接建立时间
curl -w "DNS: %{time_namelookup}s\nConnect: %{time_connect}s\nTLS: %{time_appconnect}s\nTTFB: %{time_starttransfer}s\nTotal: %{time_total}s\n" \
  -o /dev/null -s https://example.com

# 测试 HTTP/2 是否启用
curl -v --http2 https://example.com 2>&1 | grep "HTTP/2"

# 测试 HTTP/3 是否启用
curl -v --http3 https://example.com 2>&1 | grep "HTTP/3"

# 测试 Gzip/Brotli 压缩效果
curl -H "Accept-Encoding: gzip" -w "Size: %{size_download}\n" -o /dev/null -s https://example.com
curl -H "Accept-Encoding: br" -w "Size: %{size_download}\n" -o /dev/null -s https://example.com
```

### Cookie / Session / JWT 认证对比

在 HTTP 无状态协议的基础上，有多种方案实现用户认证：

| 对比项 | Cookie + Session | JWT (JSON Web Token) |
|--------|-----------------|---------------------|
| 存储位置 | 服务端（Session）+ 客户端（Cookie） | 客户端（LocalStorage/Cookie） |
| 状态 | 有状态（服务端存储会话） | 无状态（Token 自包含信息） |
| 扩展性 | 多服务器需共享 Session（Redis 等） | 天然支持分布式，无需共享存储 |
| 跨域 | 受同源策略限制 | 可轻松跨域 |
| 安全性 | Cookie 自带 HttpOnly、Secure 标志 | 需自行防范 XSS（存储在 JS 可访问处） |
| 续签 | 服务端控制过期时间 | 续签较复杂（需滑动过期或双 Token） |
| 典型场景 | 传统 Web 应用、服务端渲染 | SPA、移动端 API、微服务间认证 |

```bash
# Cookie + Session 示例：登录后自动携带 Cookie
curl -c cookies.txt -X POST https://example.com/login \
  -d "username=admin&password=123456"
curl -b cookies.txt https://example.com/dashboard

# JWT 示例：登录获取 Token，后续请求携带
TOKEN=$(curl -s -X POST https://api.example.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"123456"}' | jq -r '.token')
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/me
```

## 实战代码示例

### 使用 curl 调试 HTTP 请求

```bash
# 查看完整的请求和响应头
curl -v https://example.com

# 使用 POST 方法发送 JSON 数据
curl -X POST https://api.example.com/users \
  -H "Content-Type: application/json" \
  -d '{"name": "张三", "email": "zhangsan@example.com"}'

# 只获取响应头（类似 HEAD 请求）
curl -I https://example.com

# 跟随重定向
curl -L https://example.com/moved

# 使用 GET 请求并携带认证头
curl -H "Authorization: Bearer your-token" https://api.example.com/me
```

### 使用 PHP cURL 发起 HTTP 请求

```php
<?php
$ch = curl_init('https://api.example.com/data');

// 设置请求头
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer your-token'
]);

// 设置为 POST 请求
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    'name'  => '张三',
    'email' => 'zhangsan@example.com'
]));

// 返回响应而不是直接输出
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

// 设置超时时间（秒）
curl_setopt($ch, CURLOPT_TIMEOUT, 10);

// 验证 SSL 证书
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$errorMsg = curl_error($ch);
curl_close($ch);

if ($httpCode === 200) {
    $data = json_decode($response, true);
    print_r($data);
} else {
    echo "请求失败，HTTP状态码: {$httpCode}, 错误: {$errorMsg}";
}
```

### PHP 响应状态码设置

```php
<?php
// 设置 200 OK 并返回 JSON
http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['status' => 'ok', 'message' => '操作成功']);

// 返回 404 Not Found
http_response_code(404);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['error' => '资源不存在']);

// 返回 301 永久重定向
http_response_code(301);
header('Location: https://example.com/new-url');
exit;
```

## 相关阅读

- [HTTPS — HTTP的安全层](/2019/03/20/network/https/) — 深入理解 HTTPS 加密原理与证书机制
- [TCP/IP 协议详解](/2019/03/20/network/tcp-ip/) — 理解 HTTP 底层传输协议
- [TCP 三次握手与四次挥手](/2019/03/20/network/three-way-handshake/) — 掌握 TCP 连接建立与断开过程
- [HTTP状态码详解](/2019/03/20/network/status-codes/) — 更全面的状态码分类与排查指南
- [Socket编程入门](/2019/03/20/network/socket/) — 从底层理解网络通信
- [UDP 协议详解](/2019/03/20/network/udp/) — 了解 HTTP/3 底层协议 QUIC 的基础