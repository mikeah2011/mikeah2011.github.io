---
title: Laravel API Security Audit 实战：OWASP ASVS Level 2 合规检查清单
keywords: [Laravel API Security Audit, OWASP ASVS Level, 合规检查清单]
date: 2026-06-10 09:15:00
categories:
  - security
cover: https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
tags:
  - Laravel
  - API安全
  - OWASP
  - ASVS
  - 安全审计
description: 基于 OWASP ASVS Level 2 标准，系统性地对 Laravel API 进行安全审计。涵盖认证、授权、输入验证、加密、日志、依赖管理六大维度，附带可运行的测试代码和自动化检查脚本。
---


## 概述

OWASP Application Security Verification Standard (ASVS) 是业界公认的应用安全验证标准。Level 2 适用于处理敏感业务数据的大多数应用——对 Laravel API 项目来说，这是最低的安全基线。

本文不是泛泛而谈的安全建议清单，而是一份**可执行的审计指南**。每个 ASVS 控制点都对应具体的 Laravel 实现方式、验证代码和修复方案。

**适用场景：**
- Laravel 8/9/10/11 构建的 RESTful API
- 使用 Sanctum 或 Passport 做认证
- 前后端分离架构，移动端/小程序对接

---

## 一、认证验证（V2 - Authentication）

### 1.1 密码存储策略（V2.1.1）

ASVS 要求密码使用自适应哈希算法存储。Laravel 默认使用 bcrypt，但你需要确认配置：

```php
// config/hashing.php
return [
    'driver' => 'bcrypt',
    'bcrypt' => [
        'rounds' => 12, // 至少 12 轮
    ],
];
```

**审计检查点：** 确认没有覆盖默认 driver 为 md5/sha1 的低安全实现。

```php
// tests/Feature/Security/HashingTest.php
namespace Tests\Feature\Security;

use Tests\TestCase;
use Illuminate\Support\Facades\Hash;

class HashingTest extends TestCase
{
    public function test_password_hashed_with_bcrypt(): void
    {
        $password = 'test-password-123';
        $hashed = Hash::make($password);

        $this->assertStringStartsWith('$2y$', $hashed);
        $this->assertTrue(Hash::check($password, $hashed));
    }

    public function test_bcrypt_rounds_at_least_12(): void
    {
        $config = config('hashing.bcrypt.rounds');
        $this->assertGreaterThanOrEqual(12, $config,
            'ASVS V2.1.1: bcrypt rounds 应至少为 12');
    }
}
```

### 1.2 密码强度策略（V2.1.2）

ASVS Level 2 要求密码最少 8 字符，支持最长 128 字符。Laravel 默认没有最大长度限制，需要显式添加：

```php
// app/Rules/StrongPassword.php
namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class StrongPassword implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $password = (string) $value;

        if (strlen($password) < 8) {
            $fail('密码长度不能少于 8 个字符。');
            return;
        }

        if (strlen($password) > 128) {
            $fail('密码长度不能超过 128 个字符。');
            return;
        }

        // 检查是否在常见弱密码列表中
        $weakPasswords = file_get_contents(resource_path('weak-passwords.txt'));
        $weakList = explode("\n", trim($weakPasswords));

        if (in_array(strtolower($password), array_map('strtolower', $weakList))) {
            $fail('该密码过于常见，请选择更安全的密码。');
            return;
        }
    }
}
```

注册时使用：

```php
// app/Http/Controllers/API/AuthController.php
public function register(RegisterRequest $request): JsonResponse
{
    $validated = $request->validated();
    $validated['password'] = Hash::make($validated['password']);

    $user = User::create($validated);

    return response()->json([
        'user' => new UserResource($user),
        'token' => $user->createToken('auth-token')->plainTextToken,
    ], 201);
}

// app/Http/Requests/RegisterRequest.php
public function rules(): array
{
    return [
        'name' => ['required', 'string', 'max:255'],
        'email' => ['required', 'email', 'unique:users,email'],
        'password' => ['required', 'confirmed', new StrongPassword],
    ];
}
```

### 1.3 认证失败锁定（V2.2.1）

ASVS 要求在连续失败后实施账户锁定或延迟机制。用 Laravel 的 RateLimiter 实现：

```php
// app/Providers/AuthServiceProvider.php
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;

public function boot(): void
{
    RateLimiter::for('login', function (Request $request) {
        return Limit::perMinute(5)->by(
            $request->input('email') . '|' . $request->ip()
        );
    });
}

// app/Http/Controllers/API/AuthController.php
public function login(LoginRequest $request): JsonResponse
{
    $key = $request->input('email') . '|' . $request->ip();

    if (RateLimiter::tooManyAttempts('login:' . $key, 5)) {
        $seconds = RateLimiter::availableIn('login:' . $key);

        return response()->json([
            'message' => "登录尝试过多，请 {$seconds} 秒后重试。",
            'retry_after' => $seconds,
        ], 429);
    }

    if (!Auth::attempt($request->only('email', 'password'))) {
        RateLimiter::hit('login:' . $key, 60);

        // 记录失败事件
        event(new LoginFailed($request->input('email'), $request->ip()));

        return response()->json([
            'message' => '邮箱或密码错误。',
        ], 401);
    }

    RateLimiter::clear('login:' . $key);

    $user = Auth::user();
    $user->update(['last_login_at' => now()]);

    return response()->json([
        'user' => new UserResource($user),
        'token' => $user->createToken('auth-token')->plainTextToken,
    ]);
}
```

### 1.4 Token 安全（V2.3）

使用 Sanctum 时，需要确保 token 有合理的过期策略：

```php
// config/sanctum.php
return [
    'expiration' => 60 * 24, // 24 小时过期
];

// 对敏感操作使用短期 token
public function sensitiveAction(Request $request): JsonResponse
{
    $token = $request->user()->currentAccessToken();

    // 检查 token 创建时间，超过 15 分钟需要重新验证
    if ($token->created_at->addMinutes(15)->isPast()) {
        return response()->json([
            'message' => '操作需要重新验证身份',
            'error_code' => 'TOKEN_EXPIRED_FOR_ACTION',
        ], 403);
    }

    // 执行敏感操作...
}
```

---

## 二、授权验证（V4 - Access Control）

### 2.1 API 路由鉴权（V4.1）

每个 API 端点都必须有明确的认证和授权策略。审计时检查是否有"漏网之鱼"：

```php
// app/Http/Middleware/EnsureFullyAuthenticated.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class EnsureFullyAuthenticated
{
    public function handle(Request $request, Closure $next)
    {
        if (!$request->user()) {
            return response()->json([
                'message' => '未认证',
                'error_code' => 'UNAUTHENTICATED',
            ], 401);
        }

        // 检查用户状态
        if ($request->user()->is_banned) {
            return response()->json([
                'message' => '账户已被禁用',
                'error_code' => 'ACCOUNT_BANNED',
            ], 403);
        }

        return $next($request);
    }
}
```

**自动化审计脚本** — 检查路由是否有 `auth` 中间件：

```php
// tests/Feature/Security/RouteAuthTest.php
namespace Tests\Feature\Security;

use Tests\TestCase;
use Illuminate\Support\Facades\Route;

class RouteAuthTest extends TestCase
{
    /**
     * 检查所有 API 路由（公开路由白名单除外）都经过 auth 中间件
     */
    public function test_all_api_routes_require_auth(): void
    {
        // 公开路由白名单
        $publicRoutes = [
            'api/auth/login',
            'api/auth/register',
            'api/auth/forgot-password',
            'api/auth/reset-password',
            'api/health',
        ];

        $routes = Route::getRoutes()->getRoutesByMethod()['GET']
            + Route::getRoutes()->getRoutesByMethod()['POST']
            + Route::getRoutes()->getRoutesByMethod()['PUT']
            + Route::getRoutes()->getRoutesByMethod()['DELETE'];

        foreach ($routes as $route) {
            $uri = $route->uri();

            if (!str_starts_with($uri, 'api/')) {
                continue;
            }

            if (in_array($uri, $publicRoutes)) {
                continue;
            }

            $middleware = $route->gatherMiddleware();

            $this->assertTrue(
                in_array('auth:sanctum', $middleware) || in_array('auth', $middleware),
                "路由 [{$uri}] 缺少认证中间件"
            );
        }
    }
}
```

### 2.2 对象级授权（V4.2）

用户只能访问自己的资源，不能通过篡改 ID 访问他人的数据——这是最常见的 API 漏洞之一：

```php
// app/Http/Controllers/API/OrderController.php
public function show(Order $order): JsonResponse
{
    // 方式一：在控制器中手动检查
    if ($order->user_id !== auth()->id()) {
        abort(403, '无权访问该订单');
    }

    return response()->json(new OrderResource($order));
}

// 方式二：使用 Policy（推荐）
// app/Policies/OrderPolicy.php
namespace App\Policies;

use App\Models\Order;
use App\Models\User;

class OrderPolicy
{
    public function view(User $user, Order $order): bool
    {
        return $user->id === $order->user_id;
    }

    public function update(User $user, Order $order): bool
    {
        return $user->id === $order->user_id
            && $order->status === Order::STATUS_PENDING;
    }

    public function delete(User $user, Order $order): bool
    {
        return $user->id === $order->user_id
            && $order->status === Order::STATUS_PENDING;
    }
}

// 在 Controller 中使用
public function show(Order $order): JsonResponse
{
    $this->authorize('view', $order);

    return response()->json(new OrderResource($order));
}
```

### 2.3 批量赋值保护（V4.4）

确保 Model 的 `$fillable` 或 `$guarded` 正确配置，防止通过 `mass assignment` 篡改关键字段：

```php
// app/Models/User.php
class User extends Authenticatable
{
    // 明确列出允许批量赋值的字段
    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    // 或者使用 $guarded 阻止关键字段
    protected $guarded = [
        'id',
        'is_admin',
        'is_banned',
        'email_verified_at',
        'role',
    ];
}

// 审计测试
public function test_user_mass_assignment_blocked(): void
{
    $user = User::factory()->create();

    // 尝试通过 mass assignment 修改敏感字段
    $user->update([
        'is_admin' => true,
        'role' => 'super_admin',
    ]);

    $user->refresh();

    $this->assertFalse($user->is_admin);
    $this->assertNotEquals('super_admin', $user->role);
}
```

---

## 三、输入验证（V5 - Validation & Encoding）

### 3.1 请求验证（V5.1）

所有 API 输入必须通过 FormRequest 验证，禁止直接使用 `$request->all()` 存入数据库：

```php
// app/Http/Requests/UpdateProfileRequest.php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['sometimes', 'string', 'regex:/^1[3-9]\d{9}$/'],
            'avatar' => ['sometimes', 'url', 'max:2048'],
            'bio' => ['sometimes', 'string', 'max:500'],
        ];
    }

    // 自定义错误消息
    public function messages(): array
    {
        return [
            'phone.regex' => '请输入有效的手机号码',
            'avatar.url' => '头像必须是有效的 URL',
        ];
    }
}
```

**禁止的做法：**

```php
// ❌ 危险：直接使用 $request->all()
$user->update($request->all());

// ✅ 安全：使用 validated()
$user->update($request->validated());
```

### 3.2 SQL 注入防护（V5.2）

Laravel 的 Eloquent 和 Query Builder 默认使用参数绑定，但原生查询需要特别注意：

```php
// ❌ SQL 注入风险
$users = DB::select("SELECT * FROM users WHERE name = '" . $request->input('name') . "'");

// ✅ 参数绑定
$users = DB::select('SELECT * FROM users WHERE name = ?', [$request->input('name')]);

// ✅ 使用 named bindings
$users = DB::select('SELECT * FROM users WHERE name = :name', [
    'name' => $request->input('name'),
]);

// ✅ whereRaw 中使用参数绑定
$users = User::whereRaw('YEAR(created_at) = ?', [$year])->get();

// ❌ 危险：whereRaw 中直接拼接
$users = User::whereRaw("YEAR(created_at) = {$year}")->get();
```

**自动化扫描脚本** — 搜索代码中的 SQL 注入风险：

```bash
#!/bin/bash
# scripts/audit-sql-injection.sh

echo "=== 扫描 SQL 注入风险 ==="

# 检查 whereRaw/selectRaw 中的变量拼接
echo "\n--- whereRaw/selectRaw 变量拼接 ---"
grep -rn 'Raw\s*(.*\$' app/ --include="*.php" | grep -v 'node_modules'

# 检查 DB::select 直接拼接
echo "\n--- DB::select 原生拼接 ---"
grep -rn 'DB::select\s*(".*\$\|DB::select\s*(\x27.*\$' app/ --include="*.php"

# 检查 DB::statement
echo "\n--- DB::statement ---"
grep -rn 'DB::statement\s*(".*\$\|DB::statement\s*(\x27.*\$' app/ --include="*.php"
```

### 3.3 XSS 防护（V5.3）

API 响应需要正确设置 Content-Type 并对输出进行编码：

```php
// app/Http/Middleware/ApiSecurityHeaders.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class ApiSecurityHeaders
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        $response->headers->set('Content-Type', 'application/json; charset=utf-8');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('X-XSS-Protection', '1; mode=block');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');

        return $response;
    }
}
```

在 `bootstrap/app.php`（Laravel 11）或 `app/Http/Kernel.php` 中注册。

---

## 四、密码学与传输安全（V6 - Cryptography）

### 4.1 强制 HTTPS（V6.2）

```php
// app/Providers/AppServiceProvider.php
public function boot(): void
{
    // 生产环境强制 HTTPS
    if ($this->app->environment('production')) {
        URL::forceScheme('https');
    }
}

// .env
FORCE_HTTPS=true
```

### 4.2 敏感数据加密存储（V6.3）

用户敏感信息（身份证、银行卡号等）必须加密存储，不能只做哈希：

```php
// app/Models/UserProfile.php
class UserProfile extends Model
{
    // 使用 Laravel 的 encrypted cast
    protected $casts = [
        'id_card_number' => 'encrypted',
        'bank_account' => 'encrypted',
        'real_name' => 'encrypted',
    ];
}

// 手动加密/解密
use Illuminate\Support\Facades\Crypt;

// 存储时加密
$profile->id_card_number = Crypt::encryptString($request->input('id_card_number'));

// 读取时解密
$idCard = Crypt::decryptString($profile->id_card_number);
```

### 4.3 API 密钥管理（V6.4）

禁止在代码中硬编码 API 密钥，必须通过环境变量管理：

```php
// ❌ 硬编码
$stripeKey = 'sk_live_abc123...';

// ✅ 环境变量
$stripeKey = config('services.stripe.secret');

// config/services.php
return [
    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
    ],
];
```

**审计脚本** — 扫描代码中的硬编码密钥：

```bash
#!/bin/bash
# scripts/audit-secrets.sh

echo "=== 扫描硬编码密钥 ==="

# API Key 模式
grep -rn 'api_key\|apikey\|secret_key\|SECRET_KEY\|password\s*=\s*["\x27][^e]' app/ config/ --include="*.php" | grep -v 'env\|config\|env('

# Token 模式
grep -rn 'token.*=.*["\x27][A-Za-z0-9]\{20,\}' app/ config/ --include="*.php" | grep -v 'env\|config'

# AWS/Stripe/Twilio 等
grep -rn 'sk_live_\|sk_test_\|AKIA\|SG\.\|AC[a-z0-9]\{32\}' app/ config/ --include="*.php"
```

---

## 五、日志与监控（V7 - Error Handling & Logging）

### 5.1 安全事件日志（V7.1）

关键安全事件必须记录，但不能记录敏感数据：

```php
// app/Events/SecurityEvent.php
namespace App\Events;

class SecurityEvent
{
    public function __construct(
        public readonly string $event,
        public readonly ?int $userId,
        public readonly string $ip,
        public readonly ?string $userAgent,
        public readonly array $context = [],
    ) {}

    public function toArray(): array
    {
        return [
            'event' => $this->event,
            'user_id' => $this->userId,
            'ip' => $this->ip,
            'user_agent' => $this->userAgent,
            'context' => $this->context,
            'timestamp' => now()->toISOString(),
        ];
    }
}

// app/Listeners/LogSecurityEvent.php
namespace App\Listeners;

use App\Events\SecurityEvent;
use Illuminate\Support\Facades\Log;

class LogSecurityEvent
{
    public function handle(SecurityEvent $event): void
    {
        Log::channel('security')->info($event->event, $event->toArray());
    }
}
```

需要记录的安全事件清单：

```php
// 需要触发 SecurityEvent 的场景
$securityEvents = [
    'login_success',           // 登录成功
    'login_failed',            // 登录失败
    'login_locked',            // 账户锁定
    'password_changed',        // 密码修改
    'password_reset_requested',// 请求重置密码
    'token_refreshed',         // Token 刷新
    'permission_denied',       // 权限拒绝
    'sensitive_action',        // 敏感操作（删除账户、修改邮箱等）
    'api_key_created',         // API Key 创建
    'api_key_revoked',         // API Key 吊销
];
```

### 5.2 日志脱敏（V7.3）

日志中禁止记录密码、Token、信用卡号等敏感信息：

```php
// app/Logging/SecurityLogFormatter.php
namespace App\Logging;

use Monolog\Formatter\JsonFormatter;
use Monolog\LogRecord;

class SecurityLogFormatter extends JsonFormatter
{
    private array $sensitiveKeys = [
        'password', 'password_confirmation', 'token',
        'secret', 'api_key', 'credit_card', 'cvv',
        'id_card', 'ssn', 'access_token', 'refresh_token',
    ];

    public function format(LogRecord $record): string
    {
        $record['extra'] = $this->sanitize($record['extra']);
        $record['context'] = $this->sanitize($record['context']);

        return parent::format($record);
    }

    private function sanitize(array $data): array
    {
        foreach ($data as $key => $value) {
            if (in_array(strtolower($key), $this->sensitiveKeys)) {
                $data[$key] = '***REDACTED***';
            } elseif (is_array($value)) {
                $data[$key] = $this->sanitize($value);
            }
        }

        return $data;
    }
}
```

---

## 六、依赖安全（V14 - Configuration）

### 6.1 依赖漏洞扫描

```bash
# 使用 composer audit 检查已知漏洞
composer audit

# 输出 JSON 格式报告
composer audit --format=json

# 集成到 CI/CD
composer audit --no-dev --locked || exit 1
```

### 6.2 自动化依赖检查脚本

```bash
#!/bin/bash
# scripts/audit-dependencies.sh

echo "=== Composer 依赖漏洞扫描 ==="
composer audit 2>&1

echo "\n=== 过期依赖检查 ==="
composer outdated --direct --no-interaction 2>&1

echo "\n=== NPM 依赖漏洞扫描（如有前端） ==="
if [ -f "package.json" ]; then
    npm audit 2>&1
fi
```

### 6.3 Laravel 安全配置检查清单

```php
// config/app.php 安全相关配置
return [
    // 生产环境必须关闭 debug
    'debug' => (bool) env('APP_DEBUG', false),

    // 生产环境使用强 APP_KEY
    'key' => env('APP_KEY'),
];

// config/session.php
return [
    // Session 安全配置
    'secure' => env('SESSION_SECURE_COOKIE', true),    // 仅 HTTPS
    'http_only' => true,                                // JS 不可读
    'same_site' => 'lax',                               // CSRF 防护
    'lifetime' => 120,                                  // 2 小时过期
];
```

---

## 七、自动化审计工具集成

### 7.1 PHPUnit 安全测试套件

把上面的安全检查整合到一个测试套件中：

```xml
<!-- phpunit.xml -->
<testsuites>
    <testsuite name="Security">
        <directory>tests/Feature/Security</directory>
    </testsuite>
</testsuites>
```

运行安全测试：

```bash
php artisan test --testsuite=Security
```

### 7.2 CI/CD 安全门禁

```yaml
# .github/workflows/security-audit.yml
name: Security Audit

on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Install Dependencies
        run: composer install --no-progress

      - name: Composer Audit
        run: composer audit

      - name: Run Security Tests
        run: php artisan test --testsuite=Security

      - name: Static Analysis (PHPStan)
        run: vendor/bin/phpstan analyse app/ --level=6
```

### 7.3 ASVS 合规检查脚本

```php
// scripts/asvs-checklist.php
<?php

$checklist = [
    'V2.1.1' => ['密码哈希算法', 'bcrypt >= 12 rounds'],
    'V2.1.2' => ['密码强度', '>= 8 字符, <= 128 字符'],
    'V2.2.1' => ['登录失败锁定', '5 次/分钟限制'],
    'V2.3'   => ['Token 过期', 'Sanctum 24h 过期'],
    'V4.1'   => ['路由鉴权', '所有 API 路由有 auth 中间件'],
    'V4.2'   => ['对象级授权', 'Policy 检查资源归属'],
    'V4.4'   => ['批量赋值', 'Model $fillable/$guarded 配置'],
    'V5.1'   => ['输入验证', 'FormRequest 验证所有输入'],
    'V5.2'   => ['SQL 注入', '参数绑定，无 Raw 拼接'],
    'V5.3'   => ['XSS 防护', '正确的 Content-Type'],
    'V6.2'   => ['HTTPS', '生产环境强制 HTTPS'],
    'V6.3'   => ['敏感数据加密', 'encrypted cast'],
    'V6.4'   => ['密钥管理', '环境变量，无硬编码'],
    'V7.1'   => ['安全日志', '关键事件记录'],
    'V7.3'   => ['日志脱敏', '敏感字段 REDACTED'],
    'V14'    => ['依赖安全', 'composer audit 通过'],
];

foreach ($checklist as $id => [$desc, $impl]) {
    echo "  [{$id}] {$desc}: {$impl}\n";
}
```

---

## 踩坑记录

### 1. Sanctum Token 过期不生效

`config/sanctum.php` 的 `expiration` 配置修改后需要清除缓存：

```bash
php artisan config:clear
php artisan cache:clear
```

### 2. Policy 不生效的坑

Laravel 11 中 Policy 自动发现的路径变了，需要在 `AppServiceProvider` 中显式注册或确认 `app/Policies` 目录存在：

```php
// app/Providers/AuthServiceProvider.php
protected $policies = [
    Order::class => OrderPolicy::class,
    UserProfile::class => UserProfilePolicy::class,
];
```

### 3. RateLimiter 在队列环境中丢失

如果 API 跑在 Queue Worker 里，`RateLimiter` 默认使用 `cache` 驱动。确保 `.env` 中 cache driver 不是 `array`：

```env
CACHE_DRIVER=redis
```

### 4. encrypted cast 的 null 值处理

`encrypted` cast 在值为 `null` 时会抛异常，需要在存储前检查：

```php
$profile->id_card_number = $request->input('id_card_number')
    ? Crypt::encryptString($request->input('id_card_number'))
    : null;
```

---

## 总结

OWASP ASVS Level 2 合规不是一个一次性的项目，而是持续的安全治理过程。核心要点：

1. **认证**：bcrypt + 密码强度 + 失败锁定 + Token 过期
2. **授权**：每个端点都有认证中间件 + Policy 做对象级控制
3. **输入**：FormRequest 验证 + 参数绑定防 SQL 注入
4. **加密**：HTTPS 强制 + 敏感数据 encrypted cast + 无硬编码密钥
5. **日志**：安全事件记录 + 敏感数据脱敏
6. **依赖**：定期 `composer audit` + CI/CD 门禁

把安全测试集成到 CI/CD 流水线中，让安全成为开发流程的一部分，而不是事后补救。代码在合并前就该通过安全检查——这才是 Level 2 的真正含义。
