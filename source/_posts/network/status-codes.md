---

title: HTTP 状态码大全：2xx/3xx/4xx/5xx 分类与 RESTful 最佳实践
keywords: [HTTP, xx, RESTful, 状态码大全, 分类与, 最佳实践]
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
tags:
- HTTP
- RESTful
- Laravel
- Nginx
- 网络
categories:
- network
date: 2019-03-20 15:05:07
description: 全面解析 HTTP 状态码，涵盖 1xx 到 5xx 五大类别的设计哲学与实际应用场景。深入讲解 200、301、302、304、400、401、403、404、429、500、502、503 等高频状态码在 Nginx、Apache 及 Laravel 框架中的处理方式，包含代码示例、重定向对比表、常见踩坑案例与排查思路，适合 RESTful API 开发者和后端工程师参考。
---



## 什么是 HTTP 状态码

HTTP 状态码（HTTP Status Code）是服务器在响应客户端请求时返回的三位数字代码，用来表示请求的处理结果。它属于 HTTP 响应状态行的一部分，完整格式为 `HTTP/1.1 200 OK`，其中 `200` 就是状态码，`OK` 是原因短语（Reason Phrase）。

状态码的核心价值在于**让客户端（浏览器、App、爬虫等）无需解析响应体就能快速判断请求结果**，从而决定后续行为——是直接展示数据、跳转页面，还是提示错误。

### 五大类别设计哲学

HTTP 状态码按照首位数字分为五大类，每一类都有一致的语义方向：

| 类别 | 语义方向 | 设计意图 |
| :--: | :------: | :------: |
| **1xx** | 信息性 | 协议层面的中间状态，告诉客户端"请求已收到，继续" |
| **2xx** | 成功 | 服务器已正确接收、理解并处理了请求 |
| **3xx** | 重定向 | 资源位置发生变化，客户端需要做进一步操作 |
| **4xx** | 客户端错误 | 请求本身有问题（语法错误、权限不足、资源不存在等） |
| **5xx** | 服务器错误 | 请求本身没问题，但服务器在处理时发生了内部错误 |

> **设计哲学要点**：4xx 和 5xx 的区分非常关键——4xx 表示"你（客户端）的锅"，5xx 表示"我（服务器）的锅"。这在 API 设计中决定了错误响应的责任归属和重试策略。

## 完整 HTTP 状态码列表

### 1xx：信息性状态码

1xx 状态码表示临时响应，客户端应继续后续操作。在日常开发中较少直接处理，但在某些协议协商场景中非常关键。

| 状态码 | 英文名称 | 中文描述 |
| :----: | :------: | :------: |
| 100 | Continue | 客户端应继续发送请求体。常见于 `Expect: 100-continue` 头部 |
| 101 | Switching Protocols | 服务器同意切换协议，如从 HTTP 升级到 WebSocket |

**实际场景**：
- **100 Continue**：当客户端发送大文件上传请求时，先发送头部带 `Expect: 100-continue`，服务器确认后返回 100，客户端再发送请求体。这样可以避免请求被拒绝时浪费带宽传输大量数据。
- **101 Switching Protocols**：WebSocket 握手时，客户端发送 `Upgrade: websocket` 头，服务器返回 101 表示同意切换到 WebSocket 协议。

### 2xx：成功状态码

2xx 表示请求已被服务器成功接收、理解并处理。这是开发者最希望看到的状态码类别。

| 状态码 | 英文名称 | 中文描述 |
| :----: | :------: | :------: |
| 200 | OK | 请求成功，返回相应资源 |
| 201 | Created | 请求成功并创建了新资源（常用于 POST 请求） |
| 202 | Accepted | 请求已接受但尚未处理完成（异步任务） |
| 203 | Non-Authoritative Information | 返回的元信息来自副本而非原始服务器 |
| 204 | No Content | 请求成功但无返回内容（常用于 DELETE 操作） |
| 205 | Reset Content | 请求成功，客户端应重置文档视图 |
| 206 | Partial Content | 成功处理了部分内容请求（断点续传） |

**实际场景**：
- **200 OK**：最常见，GET 请求返回页面或数据、POST 表单提交成功等。
- **201 Created**：RESTful API 中 POST 创建资源后的标准返回，响应头通常包含 `Location` 指向新资源的 URL。
- **204 No Content**：DELETE 请求成功后不返回数据体时使用；也常用于 PUT 更新成功但无需返回更新后资源的场景。
- **206 Partial Content**：大文件下载断点续传、视频流播放时的 Range 请求都依赖此状态码。

### 3xx：重定向状态码

3xx 系列表示客户端需要执行额外操作才能完成请求。重定向是 Web 开发中的核心机制，涉及 SEO、缓存和用户体验等关键问题。

| 状态码 | 英文名称 | 中文描述 |
| :----: | :------: | :------: |
| 300 | Multiple Choices | 资源有多种表示，客户端需选择 |
| 301 | Moved Permanently | 资源永久迁移到新地址 |
| 302 | Found | 资源临时重定向到另一个地址 |
| 303 | See Other | 用 GET 请求获取另一个 URI 的资源 |
| 304 | Not Modified | 资源未变化，使用缓存版本 |
| 305 | Use Proxy | 必须通过代理访问（已废弃） |
| 307 | Temporary Redirect | 临时重定向，保持请求方法不变 |
| 308 | Permanent Redirect | 永久重定向，保持请求方法不变 |

**实际场景**：
- **301 Moved Permanently**：网站改版时旧 URL 永久指向新 URL，搜索引擎会将权重转移到新地址。
- **302 Found**：临时活动页面跳转、A/B 测试时的临时分流。
- **304 Not Modified**：配合 `ETag` 或 `Last-Modified` 头部实现协商缓存，避免重复传输未变化的资源，是前端性能优化的关键。
- **307/308**：相比 302/301，严格保持请求方法不变（302 在某些浏览器中会将 POST 变为 GET）。

### 4xx：客户端错误状态码

4xx 表示客户端发送的请求有误，服务器无法或不愿处理。API 开发中 4xx 是返回给前端最重要的错误信号。

| 状态码 | 英文名称 | 中文描述 |
| :----: | :------: | :------: |
| 400 | Bad Request | 请求语法错误或参数无效 |
| 401 | Unauthorized | 未提供或提供了无效的身份认证信息 |
| 402 | Payment Required | 预留状态码（原始设计用于数字支付） |
| 403 | Forbidden | 服务器理解请求但拒绝授权 |
| 404 | Not Found | 请求的资源不存在 |
| 405 | Method Not Allowed | 请求方法不被允许（如用 POST 访问只读接口） |
| 406 | Not Acceptable | 无法生成客户端可接受的响应格式 |
| 407 | Proxy Authentication Required | 需要代理服务器的身份认证 |
| 408 | Request Timeout | 服务器等待请求超时 |
| 409 | Conflict | 请求与资源当前状态冲突 |
| 410 | Gone | 资源已永久删除 |
| 411 | Length Required | 需要 Content-Length 头部 |
| 412 | Precondition Failed | 前置条件校验失败 |
| 413 | Payload Too Large | 请求体过大 |
| 414 | URI Too Long | 请求 URI 过长 |
| 415 | Unsupported Media Type | 不支持的媒体类型 |
| 416 | Range Not Satisfiable | 请求范围无效 |
| 417 | Expectation Failed | Expect 头部无法满足 |
| 418 | I'm a Teapot | 彩蛋状态码（RFC 2324 / RFC 7168） |
| 422 | Unprocessable Entity | 请求格式正确但语义错误（常用于表单验证失败） |
| 429 | Too Many Requests | 请求频率超限，触发了限流 |

**实际场景**：
- **400 Bad Request**：API 参数校验失败、JSON 解析错误。
- **401 Unauthorized**：未携带 Token 或 Token 已过期。
- **403 Forbidden**：已认证但权限不足（如普通用户访问管理后台）。
- **404 Not Found**：最经典的错误页面，也常被开发者自定义为趣味 404 页面。
- **422 Unprocessable Entity**：Laravel 表单验证失败时默认返回此状态码。
- **429 Too Many Requests**：API 限流触发后的标准响应，通常配合 `Retry-After` 头部。

### 5xx：服务器错误状态码

5xx 表示服务器在处理合法请求时发生了内部错误。这类错误通常需要后端工程师排查，是运维监控的重点。

| 状态码 | 英文名称 | 中文描述 |
| :----: | :------: | :------: |
| 500 | Internal Server Error | 服务器内部通用错误 |
| 501 | Not Implemented | 服务器不支持该请求方法 |
| 502 | Bad Gateway | 网关/代理从上游服务器收到无效响应 |
| 503 | Service Unavailable | 服务器暂时不可用（过载或维护） |
| 504 | Gateway Timeout | 网关/代理等待上游服务器响应超时 |
| 505 | HTTP Version Not Supported | 不支持的 HTTP 版本 |

**实际场景**：
- **500 Internal Server Error**：代码抛出未捕获异常、数据库连接失败等。
- **502 Bad Gateway**：Nginx 反向代理后端 PHP-FPM 或 Node.js 进程崩溃。
- **503 Service Unavailable**：服务器维护、部署期间或负载过高时返回，可配合 `Retry-After` 头部告知客户端何时重试。
- **504 Gateway Timeout**：后端接口响应过慢，超过了 Nginx 的 `proxy_read_timeout` 配置。

## 高频状态码深度解析

在日常开发和运维中，以下状态码出现频率最高，也最容易引发问题。本节将从**典型场景**、**Nginx/Apache 配置**和 **Laravel 处理方式**三个维度进行深入分析。

### 200 OK

**典型场景**：GET 请求获取数据、POST 提交表单成功。

**Laravel 处理**：

```php
// 返回 200 + JSON 数据
return response()->json(['data' => $users], 200);

// 返回 200 + 视图
return response()->view('welcome', ['name' => 'Laravel']);

// 返回 200 + 自定义头部
return response($content, 200)->header('X-Custom', 'value');
```

### 301 Moved Permanently

**典型场景**：网站域名更换、URL 结构调整、HTTP 到 HTTPS 的永久重定向。

**Nginx 配置**：

```nginx
# HTTP 永久重定向到 HTTPS
server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

# 旧域名永久重定向到新域名
server {
    listen 80;
    server_name old-domain.com;
    return 301 $scheme://new-domain.com$request_uri;
}
```

**Apache 配置**（`.htaccess`）：

```apache
# HTTP 到 HTTPS
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# www 到非 www
RewriteCond %{HTTP_HOST} ^www\.example\.com$ [NC]
RewriteRule ^(.*)$ https://example.com/$1 [L,R=301]
```

**Laravel 处理**：

```php
// 重定向辅助函数
return redirect()->route('new.route', [], 301);
return redirect()->to('/new-url', 301);

// 中间件中统一处理
return redirect()->secure($request->getRequestUri(), 301);
```

### 302 Found

**典型场景**：用户登录后跳转、临时活动页面、OAuth 回调后的跳转。

**Laravel 处理**：

```php
// 302 是 redirect() 的默认状态码
return redirect('/dashboard');

// 登录成功后跳转
return redirect()->intended('/dashboard');

// 在 RedirectResponse 中显式指定
return redirect()->route('login', [], 302);
```

### 304 Not Modified

**典型场景**：静态资源缓存（CSS/JS/图片）、API 条件请求（ETag/If-None-Match）。

**Nginx 配置**（自动生成 ETag）：

```nginx
location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
    etag on;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

**Laravel 处理**（手动实现协商缓存）：

```php
// 基于 ETag 的条件响应
$data = Cache::remember('posts', 60, fn() => Post::all());
$etag = md5(json_encode($data));

if (request()->header('If-None-Match') === $etag) {
    return response('', 304)->header('ETag', $etag);
}

return response()->json($data)->header('ETag', $etag);
```

### 400 Bad Request

**典型场景**：请求参数缺失或类型错误、JSON 格式不合法、请求头缺少必要字段。

**Laravel 处理**：

```php
// 手动返回 400
abort(400, '缺少必要参数: email');
return response()->json(['error' => '请求参数无效'], 400);

// 在 FormRequest 中自定义验证错误的响应
class StoreUserRequest extends FormRequest
{
    protected function failedValidation(Validator $validator)
    {
        throw new HttpResponseException(
            response()->json([
                'error' => '参数验证失败',
                'details' => $validator->errors()
            ], 400)
        );
    }
}
```

### 401 Unauthorized

**典型场景**：未携带认证信息、Token 过期或无效、API Key 缺失。

**Laravel 处理**：

```php
// abort 方式
abort(401, '未授权，请先登录');

// JSON API 响应
return response()->json([
    'error' => 'Unauthenticated',
    'message' => '请提供有效的认证 Token'
], 401);

// 自定义 Authenticate 中间件的未认证响应
protected function unauthenticated($request, AuthenticationException $exception)
{
    return $request->expectsJson()
        ? response()->json(['message' => '未授权'], 401)
        : redirect()->guest(route('login'));
}
```

**Nginx 配置**（HTTP Basic Auth 时返回 401）：

```nginx
location /admin {
    auth_basic "Admin Area";
    auth_basic_user_file /etc/nginx/.htpasswd;
}
```

### 403 Forbidden

**典型场景**：用户已认证但权限不足、IP 黑名单、目录浏览被禁止。

**Laravel 处理**：

```php
// abort 方式
abort(403, '无权访问此资源');

// 在 Gate/Policy 中使用
Gate::define('edit-post', function (User $user, Post $post) {
    return $user->id === $post->user_id;
});

// 控制器中检查权限
$this->authorize('edit-post', $post);  // 自动抛出 403

// JSON 方式
return response()->json(['error' => '权限不足'], 403);
```

**Nginx 配置**（禁止访问隐藏文件）：

```nginx
location ~ /\. {
    deny all;
    return 403;
}
```

### 404 Not Found

**典型场景**：资源不存在、URL 拼写错误、接口被下线。

**Laravel 处理**：

```php
// 手动返回 404
abort(404, '文章不存在');

// 模型找不到时自动 404（Route Model Binding）
Route::get('/posts/{post}', function (Post $post) {
    return $post;
});
// 若 $post 不存在，Laravel 自动返回 404

// 自定义 404 响应（Handler.php）
public function render($request, Throwable $e)
{
    if ($e instanceof NotFoundHttpException) {
        return response()->json([
            'error' => 'Resource not found',
            'path' => $request->path()
        ], 404);
    }
    return parent::render($request, $e);
}
```

**Nginx 自定义 404 页面**：

```nginx
error_page 404 /custom_404.html;
location = /custom_404.html {
    root /usr/share/nginx/html;
    internal;
}
```

### 408 Request Timeout

**典型场景**：客户端建立连接后长时间未发送数据、网络不稳定导致请求超时。

**Nginx 配置**：

```nginx
# 等待客户端发送请求头的超时时间
client_header_timeout 60s;

# 等待客户端发送请求体的超时时间
client_body_timeout 60s;
```

> **注意**：408 通常由服务器（而非应用层）自动生成。在 Laravel 中一般不需要手动返回 408，它更多出现在 Nginx/负载均衡层。

### 429 Too Many Requests

**典型场景**：API 限流（Rate Limiting）、防爬虫、防暴力破解。

**Laravel 处理**（内置 `Throttle` 中间件）：

```php
// 路由限流：每分钟最多 60 次请求
Route::middleware('throttle:60,1')->group(function () {
    Route::get('/api/data', [DataController::class, 'index']);
});

// 自定义限流响应
RateLimiter::for('api', function (Request $request) {
    return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip())
        ->response(function (Request $request, array $headers) {
            return response()->json([
                'error' => '请求过于频繁，请稍后再试',
                'retry_after' => $headers['Retry-After'] ?? 60
            ], 429, $headers);
        });
});
```

**Nginx 限流配置**：

```nginx
# 定义限流区域
limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;

location /api/ {
    limit_req zone=api burst=10 nodelay;
    limit_req_status 429;
    proxy_pass http://backend;
}
```

### 500 Internal Server Error

**典型场景**：代码未捕获异常、数据库连接失败、文件权限问题、内存溢出。

**Laravel 处理**：

```php
// 在 Handler.php 中自定义 500 响应
public function render($request, Throwable $e)
{
    if ($e instanceof \Error || $e instanceof \Exception) {
        return response()->json([
            'error' => '服务器内部错误',
            'message' => app()->isProduction() ? '请联系管理员' : $e->getMessage()
       ], 500);
    }
    return parent::render($request, $e);
}

// 主动抛出 500（不建议滥用）
abort(500, '数据库连接失败');
```

**Nginx 处理**（代理错误时返回 500）：

```nginx
# 当后端返回 500 时显示自定义页面
error_page 500 /custom_500.html;
proxy_intercept_errors on;
```

### 502 Bad Gateway

**典型场景**：Nginx 反向代理后端服务崩溃（PHP-FPM 进程被 kill、Node.js 进程 OOM）、后端端口未监听。

**Nginx 排查配置**：

```nginx
# 检查 upstream 是否存活
upstream backend {
    server 127.0.0.1:9000 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:9001 max_fails=3 fail_timeout=30s;
}

server {
    location ~ \.php$ {
        fastcgi_pass backend;
        fastcgi_read_timeout 30s;
        fastcgi_connect_timeout 5s;
        fastcgi_send_timeout 30s;
    }
}
```

**排查步骤**：
1. 检查后端进程是否存活：`systemctl status php-fpm` 或 `pm2 list`
2. 检查端口是否监听：`ss -tlnp | grep 9000`
3. 查看 Nginx 错误日志：`tail -f /var/log/nginx/error.log`
4. 检查后端错误日志：`tail -f /var/log/php-fpm/error.log`

### 503 Service Unavailable

**典型场景**：服务器维护、部署期间、负载过高、数据库连接池耗尽。

**Nginx 配置**（维护模式）：

```nginx
# 维护模式页面
server {
    listen 80;
    server_name example.com;
    root /var/www/maintenance;

    # 存在此文件时进入维护模式
    if (-f /var/www/maintenance.flag) {
        return 503;
    }

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
}

error_page 503 @maintenance;
location @maintenance {
    root /var/www/maintenance;
    try_files /maintenance.html =503;
}
```

**Laravel 处理**：

```php
// artisan down 命令返回 503
php artisan down --render="errors::503" --retry=60

// 编程方式返回 503
return response()->json([
    'error' => '服务维护中，请稍后再试'
], 503, ['Retry-After' => '3600']);

// abort 方式
abort(503, '服务暂时不可用');
```

## 重定向状态码对比：301 vs 302 vs 307 vs 308

重定向状态码是日常开发中最容易混淆的部分。以下是四种常见重定向状态码的详细对比：

| 特性 | 301 | 302 | 307 | 308 |
| :--- | :--: | :--: | :--: | :--: |
| **语义** | 永久重定向 | 临时重定向 | 临时重定向 | 永久重定向 |
| **是否缓存** | ✅ 浏览器会缓存 | ❌ 不缓存 | ❌ 不缓存 | ✅ 浏览器会缓存 |
| **方法是否改变** | ⚠️ 早期浏览器会将 POST 变为 GET | ⚠️ 部分浏览器将 POST 变为 GET | ✅ 严格保持原方法 | ✅ 严格保持原方法 |
| **SEO 权重转移** | ✅ 传递链接权重 | ❌ 不传递 | ❌ 不传递 | ✅ 传递链接权重 |
| **适用场景** | 域名永久迁移、URL 结构永久变更 | 临时活动页面、A/B 测试 | 临时重定向且需保持方法（如 POST 表单） | 永久迁移且需保持方法 |
| **RFC 规范** | RFC 7231 | RFC 7231 | RFC 7231 | RFC 7538 |

### 选型指南

```
需要重定向 → 是永久变更吗？
├── 是 → 需要保持请求方法不变吗？
│   ├── 是 → 308
│   └── 否 → 301
└── 否 → 需要保持请求方法不变吗？
    ├── 是 → 307
    └── 否 → 302
```

> **最佳实践**：在 RESTful API 中，推荐使用 **307** 代替 302，使用 **308** 代替 301，以确保请求方法不被意外改变。

## 踩坑案例与排查思路

### 案例一：301 永久缓存导致重定向循环

**问题描述**：开发环境中将 `/old-page` 301 重定向到 `/new-page`，后来又将 `/new-page` 301 重定向回 `/old-page`，导致浏览器死循环。

**根因**：301 状态码会被浏览器**永久缓存**。即使服务器端修改了重定向规则，浏览器仍会使用本地缓存的旧重定向，形成循环。

**解决方案**：

```bash
# 1. 清除浏览器缓存（开发者工具 → Network → 勾选 Disable cache）
# 2. 使用隐身模式测试
# 3. 开发环境中使用 302 或 307 代替 301
# 4. 在 Nginx 中添加缓存控制头
add_header Cache-Control "no-store, no-cache, must-revalidate" always;
```

**教训**：
- 开发/测试环境永远使用 **302/307**（临时重定向）
- 只在确认 URL 永久变更后才使用 **301/308**
- 上线前用 `curl -I` 确认响应头中的 `Location` 和 `Cache-Control`

### 案例二：502 Bad Gateway vs 504 Gateway Timeout

**问题描述**：用户反馈"网站打不开"，日志中出现 502 和 504，两者含义不同但表现相似。

**对比分析**：

| 维度 | 502 Bad Gateway | 504 Gateway Timeout |
| :--- | :--- | :--- |
| **含义** | 网关/代理收到上游的**无效响应** | 网关/代理等待上游响应**超时** |
| **常见原因** | 后端进程崩溃、端口未监听、连接被拒绝 | 后端接口响应慢、数据库查询卡住、外部 API 超时 |
| **Nginx 关键日志** | `connect() failed`、`recv() failed` | `upstream timed out` |
| **排查方向** | 检查后端进程状态、端口监听、权限 | 检查慢查询、增加超时配置、优化接口性能 |

**Nginx 排查命令**：

```bash
# 查看 Nginx 错误日志中的 502/504 信息
tail -f /var/log/nginx/error.log | grep -E "upstream|connect|timed out"

# 检查后端进程
ps aux | grep php-fpm
systemctl status php-fpm

# 检查端口
ss -tlnp | grep 9000

# 检查连接数
ss -s
```

**Nginx 超时配置优化**：

```nginx
location ~ \.php$ {
    fastcgi_pass unix:/run/php/php8.2-fpm.sock;
    fastcgi_connect_timeout 5s;      # 连接后端超时
    fastcgi_send_timeout 60s;        # 发送请求超时
    fastcgi_read_timeout 120s;       # 读取响应超时（关键！）
    fastcgi_buffer_size 32k;
    fastcgi_buffers 8 32k;
}

# 全局代理超时
proxy_connect_timeout 5s;
proxy_send_timeout 60s;
proxy_read_timeout 120s;
```

### 案例三：403 Forbidden 的常见陷阱

**问题描述**：Nginx 返回 403 Forbidden，但文件明明存在且权限正确。

**常见原因排查**：

```bash
# 1. 检查目录是否有执行权限（最常见的坑！）
ls -la /var/www/html/
# 目录需要 x（执行）权限才能被访问
chmod 755 /var/www/html/

# 2. 检查 index 文件是否存在
ls /var/www/html/index.html /var/www/html/index.php

# 3. 检查 Nginx 的 index 指令
# nginx.conf 中是否有 index index.php index.html;

# 4. 检查 SELinux（CentOS/RHEL 常见）
getenforce
setsebool -P httpd_can_network_connect 1
# 或设置文件上下文
restorecon -Rv /var/www/html/

# 5. 检查 PHP-FPM 用户和 Nginx 用户是否一致
ps aux | grep -E "nginx|php-fpm"
```

### 案例四：429 Too Many Requests 的优雅处理

**问题描述**：API 被限流后客户端收到 429，但没有实现重试逻辑，导致用户体验差。

**前端最佳实践**（基于 `Retry-After` 头部实现指数退避重试）：

```javascript
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        const response = await fetch(url, options);

        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter
                ? parseInt(retryAfter) * 1000
                : Math.pow(2, i) * 1000;  // 指数退避

            console.warn(`请求被限流，${delay / 1000}秒后重试...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        return response;
    }

    throw new Error('请求失败，已达最大重试次数');
}
```

### 案例五：304 Not Modified 不生效

**问题描述**：明明设置了 `ETag`，但浏览器始终返回 200 而非 304。

**排查清单**：
1. 检查响应是否包含 `ETag` 头部
2. 检查请求是否包含 `If-None-Match` 头部
3. 检查 `Cache-Control` 是否设置为 `no-cache`（这会禁用缓存协商）
4. Nginx 代理是否剥离了 `ETag` 头（某些 CDN 会去掉）
5. `gzip` 是否修改了 `ETag`（Nginx 的 `gzip on` 可能导致 `ETag` 被加上 `W/` 前缀变成弱验证）

```nginx
# 确保 ETag 在 gzip 后仍然有效
gzip on;
gzip_vary on;  # 添加 Vary: Accept-Encoding 头
etag on;
```

## Laravel 中返回状态码的最佳实践

### 统一 API 响应格式

建议封装一个统一的 API 响应方法，保持状态码使用的一致性：

```php
// app/Helpers/ApiResponse.php
trait ApiResponse
{
    protected function success($data = null, string $message = 'OK', int $code = 200)
    {
        return response()->json([
            'status' => 'success',
            'message' => $message,
            'data' => $data,
        ], $code);
    }

    protected function error(string $message, int $code = 400, $errors = null)
    {
        return response()->json([
            'status' => 'error',
            'message' => $message,
            'errors' => $errors,
        ], $code);
    }

    protected function notFound(string $message = '资源不存在')
    {
        return $this->error($message, 404);
    }

    protected function unauthorized(string $message = '未授权')
    {
        return $this->error($message, 401);
    }

    protected function forbidden(string $message = '权限不足')
    {
        return $this->error($message, 403);
    }

    protected function rateLimited(int $retryAfter = 60)
    {
        return $this->error('请求过于频繁', 429, ['retry_after' => $retryAfter]);
    }

    protected function serverError(string $message = '服务器内部错误')
    {
        return $this->error($message, 500);
    }
}
```

### 控制器使用示例

```php
class PostController extends Controller
{
    use ApiResponse;

    public function show($id)
    {
        $post = Post::find($id);

        if (!$post) {
            return $this->notFound('文章不存在');
        }

        return $this->success($post);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => 'required|max:255',
            'body'  => 'required',
        ]);

        $post = Post::create($validated);

        return $this->success($post, '文章创建成功', 201);
    }

    public function destroy($id)
    {
        $post = Post::findOrFail($id);

        if (auth()->id() !== $post->user_id) {
            return $this->forbidden('无权删除此文章');
        }

        $post->delete();

        return response('', 204);
    }
}
```

## 总结

HTTP 状态码是 Web 开发中最基础但最重要的概念之一。正确使用状态码可以：

- **提高 API 的可读性**：客户端无需解析响应体就能判断请求结果
- **优化 SEO**：搜索引擎根据 301/302/404 等状态码决定页面索引策略
- **提升用户体验**：通过 304 缓存减少加载时间，通过 429 限流保护服务
- **简化运维监控**：通过监控 5xx 状态码比例快速发现服务异常

记住核心原则：
- **2xx 表示成功**，不要用 200 返回错误信息
- **4xx 表示客户端错误**，要给出明确的错误原因
- **5xx 表示服务器错误**，要记录日志并及时修复
- **301 要慎用**，因为它会被浏览器永久缓存
- **开发环境优先使用 302/307**，避免缓存干扰

## 相关阅读

- [HTTP协议详解](/categories/Network/http/)
- [HTTPS与网络安全](/categories/Network/https/)
- [TCP/IP协议](/categories/Network/tcp-ip/)
- [三次握手四次挥手](/categories/Network/three-way-handshake/)