---
title: OWASP Top 10 防护实战：SQL 注入/XSS/CSRF/SSRF Laravel B2C API 安全加固踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-16 18:40:51
updated: 2026-05-16 18:51:52
categories:
  - php
  - database
tags: [KKday, Laravel, 安全]
keywords: [OWASP Top, SQL, XSS, CSRF, SSRF Laravel B2C API, 防护实战, 注入, 安全加固踩坑记录, PHP, 数据库]
description: 基于 KKday B2C API 30+ 仓库实战经验，详解 OWASP Top 10 中最高频的四类攻击（SQL 注入、XSS、CSRF、SSRF）在 Laravel 项目中的防护策略、真实踩坑记录与防御纵深方案。



---

# OWASP Top 10 防护实战：SQL 注入 / XSS / CSRF / SSRF — Laravel B2C API 安全加固踩坑记录

> 基于 KKday B2C Backend Team 30+ 仓库实战，聚焦 OWASP Top 10 中最高频的四类攻击在 Laravel 项目中的防护策略与真实踩坑记录。

<!-- more -->

## 为什么需要专门聊 OWASP 防护？

Laravel 框架内置了大量安全机制——Eloquent 参数绑定、Blade 自动转义、CSRF Token 验证、`Http::` 客户端封装……但**框架提供的只是基线，不是终点**。在 30+ 仓库、上百个 API Endpoint 的实战中，我们踩过的坑几乎都出在「绕过框架默认行为」的场景里。

### 攻击面全景图

```
                    ┌──────────────────────────────────────────────┐
                    │              B2C API 攻击面                   │
                    │                                              │
  攻击者请求 ──────►│  ┌─────────┐   ┌──────────┐   ┌──────────┐  │
                    │  │  Route  │──►│Controller│──►│ Service  │  │
                    │  │ (CSRF)  │   │ (XSS)    │   │ (SQLi)   │  │
                    │  └─────────┘   └──────────┘   └──────────┘  │
                    │       │              │              │        │
                    │       ▼              ▼              ▼        │
                    │  ┌─────────┐   ┌──────────┐   ┌──────────┐  │
                    │  │Middleware│  │ Blade/   │   │ Eloquent/│  │
                    │  │VerifyCsrf│  │ Response │   │  Raw SQL │  │
                    │  └─────────┘   └──────────┘   └──────────┘  │
                    │                                    │        │
                    │                          ┌─────────▼──────┐ │
                    │                          │   MySQL/Redis  │ │
                    │                          │   (SSRF → 内网) │ │
                    │                          └────────────────┘ │
                    └──────────────────────────────────────────────┘
```

每一条链路上都有至少一个注入点。下面逐一拆解。

---

## 1. SQL 注入：ORM 不是万能药

### 1.1 Laravel 默认行为 vs 危险边界

Laravel Eloquent 的 `where()` 方法默认使用参数绑定，这是安全的：

```php
// ✅ 安全 — 参数绑定，自动转义
User::where('email', $request->input('email'))->first();

// ✅ 安全 — 数组条件也走参数绑定
Order::whereIn('status', $request->input('statuses'))->get();
```

**但以下场景会绕过保护：**

### 1.2 真实踩坑：`whereRaw()` + 字符串拼接

```php
// ❌ 致命漏洞 — 直接拼接用户输入到 SQL
$sort = $request->input('sort', 'id'); // 用户可控
$dir = $request->input('dir', 'ASC');  // 用户可控
Product::orderByRaw("{$sort} {$dir}")->paginate();

// 攻击者可以传：?sort=id;DROP TABLE products--&dir=ASC
// 虽然 Laravel/PDO 默认只执行第一条语句（多语句攻击受限），
// 但 ORDER BY 注入可以做 UNION SELECT、盲注等
```

**修复方案 — 白名单验证：**

```php
class ProductController extends Controller
{
    private const ALLOWED_SORT_COLUMNS = [
        'id', 'price', 'created_at', 'sales_count', 'rating',
    ];

    private const ALLOWED_DIRECTIONS = ['ASC', 'DESC'];

    public function index(Request $request)
    {
        $sort = in_array($request->input('sort'), self::ALLOWED_SORT_COLUMNS, true)
            ? $request->input('sort')
            : 'id';

        $dir = in_array(strtoupper($request->input('dir', 'ASC')), self::ALLOWED_DIRECTIONS, true)
            ? $request->input('dir')
            : 'ASC';

        return Product::orderBy($sort, $dir)->paginate(20);
    }
}
```

### 1.3 真实踩坑：`DB::select()` 与字符串拼接

```php
// ❌ 完全绕过 Eloquent — 这是我们审计时发现最多的问题
$results = DB::select("
    SELECT * FROM orders
    WHERE user_id = {$userId}
    AND created_at >= '{$startDate}'
");

// ✅ 修复 — 使用绑定参数
$results = DB::select("
    SELECT * FROM orders
    WHERE user_id = ?
    AND created_at >= ?
", [$userId, $startDate]);
```

### 1.4 真实踩坑：LIKE 查询的特殊字符

```php
// ❌ % 和 _ 是 LIKE 通配符，用户输入可改变查询语义
User::where('name', 'LIKE', "%{$keyword}%")->get();
// 输入 "%" 可匹配所有记录

// ✅ 修复 — 转义通配符
$escaped = str_replace(['%', '_'], ['\\%', '\\_'], $keyword);
User::where('name', 'LIKE', "%{$escaped}%")->get();
```

### 1.5 架构层防御：SQL 审计中间件

```php
// app/Middleware/SqlAuditMiddleware.php
class SqlAuditMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        if (app()->environment('local', 'staging')) {
            DB::listen(function (QueryExecuted $query) {
                if (preg_match('/\b(UNION|SELECT)\b.*\b(FROM|WHERE)\b/i', $query->sql)
                    && $query->bindings !== []) {
                    Log::warning('SQL_AUDIT: suspicious raw query', [
                        'sql'      => $query->sql,
                        'bindings' => $query->bindings,
                        'time'     => $query->time,
                        'ip'       => $request->ip(),
                    ]);
                }
            });
        }

        return $next($request);
    }
}
```

---

## 2. XSS：Blade 自动转义的盲区

### 2.1 Blade `{{ }}` vs `{!! !!}` 的安全边界

```php
// ✅ 安全 — {{ }} 自动使用 htmlspecialchars() 转义
{{ $user->name }}

// ❌ 危险 — {!! !!} 直接输出 HTML，如果 $content 包含用户输入就是 XSS
{!! $product->description !!}
```

**踩坑记录**：在 B2C 后台管理系统中，富文本编辑器的商品描述（`description`）存储了 HTML 格式内容。开发直接用 `{!! !!}` 输出，结果被注入了 `<script>` 标签。

**修复方案 — 使用 HTMLPurifier 清洗：**

```php
// config/app.php
'providers' => [
    // Stevebaun\Purify\PurifyServiceProvider::class,
],

// Model 中使用 Cast
use Stevebaun\Purify\Casts\PurifyHtml;

class Product extends Model
{
    protected $casts = [
        'description' => PurifyHtml::class,
    ];
}

// Controller 中保存时清洗
$product->description = Purify::config()
    ->set('HTML.Allowed', 'p,b,i,u,em,strong,a[href],img[src|alt],ul,ol,li,h3,h4')
    ->set('Attr.AllowedFrameSrc', [])
    ->clean($request->input('description'));
```

### 2.2 API JSON Response 中的 XSS

很多人以为 API 返回 JSON 就不会 XSS。错！如果前端用 `v-html` 或 `innerHTML` 渲染，JSON 中的恶意内容照样执行。

```php
// ❌ 危险 — 返回未经转义的用户生成内容
return response()->json([
    'review' => $review->content, // "<img src=x onerror=alert(1)>"
]);

// ✅ 修复 — 在 Response 层统一转义
class SanitizeJsonResponse extends BaseResponse
{
    public function setContent($content): static
    {
        if (is_array($content) || is_object($content)) {
            $content = $this->sanitizeRecursive($content);
        }
        return parent::setContent($content);
    }

    private function sanitizeRecursive(mixed $value): mixed
    {
        if (is_string($value)) {
            return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        }
        if (is_array($value)) {
            return array_map([$this, 'sanitizeRecursive'], $value);
        }
        return $value;
    }
}
```

### 2.3 Content-Security-Policy (CSP) 头 — 最后的防线

```php
// app/Http/Middleware/SecurityHeaders.php
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('Content-Security-Policy',
            "default-src 'self'; "
            . "script-src 'self' https://cdn.example.com; "
            . "style-src 'self' 'unsafe-inline'; "
            . "img-src 'self' data: https:; "
            . "connect-src 'self' https://api.example.com; "
            . "frame-ancestors 'none'; "
            . "base-uri 'self';"
        );
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');

        return $response;
    }
}
```

---

## 3. CSRF：API Token 场景的隐形陷阱

### 3.1 Laravel 默认 CSRF 机制

```php
// app/Http/Kernel.php — VerifyCsrfToken 中间件全局生效
// 对 POST/PUT/PATCH/DELETE 请求自动验证 _token
```

### 3.2 真实踩坑：API 路由误免 CSRF 验证

```php
// ❌ 危险 — 开发者为了方便把所有 api/ 路由都排除了 CSRF
protected $except = [
    'api/*',  // 这排除了所有 API 路由，包括用 Session 认证的 BFF 接口！
];

// ✅ 修复 — 只排除真正用 Token 认证的路由
protected $except = [
    'api/v*/payment/callback',  // 支付回调 — 第三方调用，无法带 CSRF
    'api/v*/webhook/*',          // Webhook — 外部系统调用
];
```

### 3.3 SPA + Sanctum 的双重 CSRF 防护

当使用 Laravel Sanctum 的 SPA 认证模式时，需要同时使用 Cookie 和 Token 两层验证：

```javascript
// 前端 axios 配置 — 关键：withCredentials 让 Sanctum Cookie 生效
axios.defaults.withCredentials = true;
axios.defaults.baseURL = 'https://api.example.com';

// 先获取 CSRF Cookie（Sanctum 要求）
await axios.get('/sanctum/csrf-cookie');

// 后续请求自动携带 X-XSRF-TOKEN Cookie
await axios.post('/api/orders', { product_id: 1 });
```

```php
// 后端 — 确保 SameSite 和 CORS 配置正确
// config/session.php
'secure'   => true,    // 只通过 HTTPS 传输
'same_site' => 'lax',  // 'none' 需要 secure=true 且跨域场景

// config/cors.php
'allowed_origins' => ['https://shop.example.com'], // 不要用 '*'
'supports_credentials' => true,  // 允许携带 Cookie
```

**踩坑记录**：把 `allowed_origins` 设为 `*` + `supports_credentials` 为 `true`，浏览器会直接拒绝——因为 CORS 规范禁止这个组合。

### 3.4 双重提交 Cookie 模式（Double Submit Cookie）

对于纯前端 SPA 且不使用 Sanctum 的场景：

```php
// 自定义中间件
class DoubleSubmitCsrf
{
    public function handle(Request $request, Closure $next): Response
    {
        $cookieToken = $request->cookie('csrf_token');
        $headerToken = $request->header('X-CSRF-TOKEN');

        if (!$cookieToken || !$headerToken || !hash_equals($cookieToken, $headerToken)) {
            return response()->json(['error' => 'CSRF token mismatch'], 419);
        }

        return $next($request);
    }
}
```

---

## 4. SSRF：最容易被忽略的高危漏洞

### 4.1 什么是 SSRF？

Server-Side Request Forgery — 攻击者通过你的服务端发起请求，访问内网资源（云元数据、Redis、数据库管理后台等）。

### 4.2 真实踩坑：URL 预览功能泄露内网

```php
// ❌ 致命 — 允许用户输入任意 URL，服务端直接请求
public function preview(Request $request)
{
    $url = $request->input('url');
    $response = Http::timeout(5)->get($url);

    return response($response->body(), $response->status())
        ->header('Content-Type', $response->header('Content-Type'));
}

// 攻击者可以传：
// ?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/
// → 获取 AWS IAM 密钥！

// ?url=http://redis:6379/
// → 通过 HTTP 请求操作 Redis（RESP 协议可伪装 HTTP 响应）
```

### 4.3 SSRF 防御方案：URL 验证 + IP 黑名单

```php
// app/Services/SafeUrlFetcher.php
class SafeUrlFetcher
{
    private const BLOCKED_IP_RANGES = [
        '10.0.0.0/8',       // 内网 A 类
        '172.16.0.0/12',    // 内网 B 类
        '192.168.0.0/16',   // 内网 C 类
        '127.0.0.0/8',      // Loopback
        '169.254.0.0/16',   // Link-local / 云元数据
        '0.0.0.0/8',
        '100.64.0.0/10',    // CGNAT
        '192.0.0.0/24',
        '198.18.0.0/15',
    ];

    private const ALLOWED_SCHEMES = ['http', 'https'];
    private const ALLOWED_PORTS  = [80, 443, 8080, 8443];

    public function fetch(string $url): Http\Response
    {
        $parsed = parse_url($url);

        // 1. Scheme 验证
        if (!in_array($parsed['scheme'] ?? '', self::ALLOWED_SCHEMES, true)) {
            throw new InvalidArgumentException('Invalid URL scheme');
        }

        // 2. 解析真实 IP（防止 DNS Rebinding）
        $hostname = $parsed['host'];
        $ip = gethostbyname($hostname);

        if ($ip === $hostname) {
            throw new InvalidArgumentException('DNS resolution failed');
        }

        // 3. IP 黑名单检查
        if ($this->isBlockedIp($ip)) {
            Log::warning('SSRF_BLOCKED: blocked internal IP request', [
                'url' => $url, 'resolved_ip' => $ip, 'user' => auth()->id(),
            ]);
            throw new InvalidArgumentException('Access to internal network is forbidden');
        }

        // 4. 端口限制
        $port = $parsed['port'] ?? ($parsed['scheme'] === 'https' ? 443 : 80);
        if (!in_array($port, self::ALLOWED_PORTS, true)) {
            throw new InvalidArgumentException('Port not allowed');
        }

        // 5. 二次 DNS 解析（防 DNS Rebinding 攻击）
        $ip2 = gethostbyname($hostname);
        if ($ip !== $ip2) {
            throw new InvalidArgumentException('DNS rebinding detected');
        }

        return Http::timeout(5)
            ->withOptions([
                'curl' => [
                    CURLOPT_FOLLOWLOCATION => false, // 禁止跟随重定向
                    CURLOPT_RESOLVE        => ["{$hostname}:{$port}:{$ip}"], // 锁定 IP
                ],
            ])
            ->get($url);
    }

    private function isBlockedIp(string $ip): bool
    {
        $long = ip2long($ip);
        if ($long === false) return true;

        foreach (self::BLOCKED_IP_RANGES as $cidr) {
            [$subnet, $mask] = explode('/', $cidr);
            $subnetLong = ip2long($subnet);
            $maskLong   = ~((1 << (32 - $mask)) - 1);
            if (($long & $maskLong) === ($subnetLong & $maskLong)) {
                return true;
            }
        }
        return false;
    }
}
```

### 4.4 DNS Rebinding 攻击深度防护

DNS Rebinding 攻击利用第一次 DNS 解析通过验证、第二次 DNS 解析返回内网 IP 的时间差。上面的「二次解析 + CURLOPT_RESOLVE 锁定」方案可以防御，但更彻底的方案是使用流式 DNS：

```php
// 使用自定义 DNS Resolver 确保解析一致
$dns = new DNS\DnsResolver();
$ips = $dns->resolve($hostname);
foreach ($ips as $resolvedIp) {
    if ($this->isBlockedIp($resolvedIp)) {
        throw new InvalidArgumentException('Blocked IP in DNS response');
    }
}
```

---

## 5. 防御纵深总结

### 5.1 分层防御架构图

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: WAF / CDN 边缘层                                       │
│   → CloudFlare AWS WAF 阿里云 WAF                               │
│   → 规则: SQLi/XSS 模式匹配、IP 信誉、Bot 检测                   │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: Nginx / 网关层                                         │
│   → 请求体大小限制 (client_max_body_size)                        │
│   → Header 注入防护                                              │
│   → Rate Limiting                                               │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: Laravel 中间件层                                        │
│   → CSRF Token / Sanctum Token 验证                             │
│   → Input Sanitization (FormRequest)                            │
│   → Security Headers (CSP, X-Frame-Options)                     │
├─────────────────────────────────────────────────────────────────┤
│ Layer 4: 业务逻辑层                                              │
│   → 白名单验证 (排序/筛选参数)                                    │
│   → HTML 清洗 (HTMLPurifier)                                    │
│   → SSRF 防护 (SafeUrlFetcher)                                  │
├─────────────────────────────────────────────────────────────────┤
│ Layer 5: 数据访问层                                              │
│   → Eloquent ORM 参数绑定 (默认安全)                             │
│   → SQL 审计日志                                                │
│   → 数据库最小权限原则                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 安全 Checklist（每次 Code Review 必查）

```markdown
## SQL 注入防护
- [ ] 所有 DB::select() / DB::raw() 使用参数绑定
- [ ] ORDER BY / GROUP BY 字段使用白名单验证
- [ ] LIKE 查询转义 % 和 _ 通配符
- [ ] 数据库用户只有 SELECT/INSERT/UPDATE/DELETE 权限，无 DROP/ALTER

## XSS 防护
- [ ] Blade 模板中没有 {!! !!} 或已做 HTMLPurifier 清洗
- [ ] API Response 中不含未转义的用户生成内容 (UGC)
- [ ] CSP Header 已配置且未使用 'unsafe-eval'
- [ ] 前端未使用 v-html / innerHTML 渲染不可信内容

## CSRF 防护
- [ ] Web 路由使用 CSRF Token（VerifyCsrfToken 中间件）
- [ ] API 路由使用 Sanctum/Passport Token 认证
- [ ] CORS 配置未使用 '*' + credentials 组合
- [ ] 支付/敏感操作有二次确认机制

## SSRF 防护
- [ ] 所有用户可控的 URL 请求经过 SafeUrlFetcher 验证
- [ ] 内网 IP 段已加入黑名单（含 169.254 云元数据）
- [ ] HTTP Client 禁止跟随重定向（或重定向后重新验证）
- [ ] 云服务 IMDSv2 已启用（AWS 场景）
```

### 5.3 自动化安全扫描工具推荐

```bash
# PHPStan 安全扩展 — 静态分析检测不安全的 SQL 拼接
composer require --dev phpstan/phpstan
phpstan analyse --level=8 app/ --configuration phpstan-security.neon

# Enlightn Security Checker — 依赖漏洞扫描
composer require --dev enlightn/security-checker
php artisan security:check

# OWASP ZAP 动态扫描（CI 集成）
docker run -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
    -t https://staging-api.example.com \
    -r zap-report.html
```

---

## 踩坑记录汇总

| # | 场景 | 问题 | 根因 | 修复方案 |
|---|------|------|------|----------|
| 1 | 商品列表排序 | `orderByRaw("{$sort} {$dir}")` 可注入 | 信任前端传参 | 白名单验证排序字段 |
| 2 | 后台富文本 | `{!! $product->description !!}` XSS | 存储了未清洗的 HTML | HTMLPurifier Cast |
| 3 | URL 预览 | `Http::get($userUrl)` SSRF 泄露 AWS 密钥 | 未校验目标 IP | SafeUrlFetcher + IP 黑名单 |
| 4 | SPA 认证 | CORS `*` + `credentials: true` 不生效 | 浏览器规范禁止此组合 | 指定具体域名 |
| 5 | 报表导出 | `DB::select("...{$date}...")` 日期注入 | 直接拼接字符串 | 参数绑定 |
| 6 | 搜索过滤 | `LIKE "%{$input}%"` 通配符注入 | 未转义 `%` 和 `_` | `str_replace` 转义 |
| 7 | 文件上传预览 | 重定向到 `file:///etc/passwd` | 未禁止重定向跟随 | `CURLOPT_FOLLOWLOCATION => false` |

---

## 写在最后

安全防护不是一次性任务，而是需要持续投入的过程：

1. **Code Review 时必查安全 Checklist** — 把上面的 Checklist 粘到 CR 模板里
2. **CI 流水线集成静态分析** — PHPStan Level 8 + enlightn/security-checker
3. **定期依赖漏洞扫描** — `composer audit` 应该成为日常习惯
4. **最小权限原则** — 数据库用户、API Token、云服务 IAM 都遵循最小权限
5. **纵深防御** — 任何单一层级都可能被突破，多层叠加才可靠

Laravel 框架已经帮你挡了 80% 的攻击，但剩下 20% 全在你的业务代码里。希望这篇文章能帮你避开我们在 30+ 仓库中踩过的每一个坑。

---

## 相关阅读

- [API Security 深度实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击](/categories/Laravel/api-security-jwt-blacklist-hmac-signature-replay-protection/)
- [PHPStan Level 8 实战：静态分析类型安全与渐进式升级踩坑记录](/categories/Laravel/phpstan-level-8-guide/)
- [Laravel 事务回滚边界控制 - KKday B2C-API 真实踩坑记录](/categories/Laravel/laravel-transaction/)
