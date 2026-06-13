---
title: Laravel CSP 动态策略实战：按租户/按页面/按用户角色的 Content Security Policy 动态生成
keywords: [Laravel CSP, Content Security Policy, 动态策略实战, 按租户, 按页面, 按用户角色的, 动态生成]
date: 2026-06-10 01:58:00
categories:
  - security
cover: https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
tags:
  - Laravel
  - CSP
  - XSS
  - 多租户
  - SaaS
  - Content-Security-Policy
description: 多租户 SaaS 系统中，不同租户需要不同的 CSP 策略。本文从中间件、策略类、缓存、Nonce 集成四个维度，实现按租户/按页面/按用户角色动态生成 Content-Security-Policy 响应头，附完整可运行代码。
---


## 为什么多租户 SaaS 需要动态 CSP？

Content-Security-Policy 是防御 XSS 的最后一道防线。但在多租户 SaaS 场景下，一个「万能」的 CSP 策略根本不存在：

- **租户 A** 用了 Google Analytics 和 Stripe，需要 `connect-src` 放行 `*.google-analytics.com` 和 `*.stripe.com`
- **租户 B** 自己接了第三方支付，需要 `frame-src` 放行 `*.alipay.com`
- **管理后台** 需要 `unsafe-inline`（某些老旧组件），但前端商店页面不需要
- **某些页面** 需要加载外部 CDN 图片，其他页面不允许

写死一个 CSP 头 = 要么太松（等于没有），要么太严（功能全挂）。必须动态生成。

## 核心设计思路

```
请求进入 → 中间件拦截
         → 解析当前租户（tenant_id / domain）
         → 解析当前页面路由
         → 解析当前用户角色
         → 查找/生成对应的 CSP 策略
         → 注入 Nonce（如需 inline script）
         → 设置响应头
```

关键原则：**每个请求只计算一次 CSP，缓存在请求生命周期内**。

## 第一步：安装 spatie/laravel-csp

```bash
composer require spatie/laravel-csp
php artisan vendor:publish --provider="Spatie\Csp\CspServiceProvider"
```

发布配置文件后你会得到 `config/csp.php`，我们后面会大幅改造它。

## 第二步：定义策略类基础结构

```php
<?php
// app/Csp/Policies/BaseTenantPolicy.php

namespace App\Csp\Policies;

use Spatie\Csp\Policies\Policy;
use Spatie\Csp\Directive;
use App\Models\Tenant;

abstract class BaseTenantPolicy extends Policy
{
    protected ?Tenant $tenant = null;
    protected ?string $routeName = null;
    protected ?string $userRole = null;

    public function configure(): void
    {
        // 从请求中解析上下文
        $this->tenant = app('currentTenant');
        $this->routeName = request()->route()?->getName();
        $this->userRole = auth()->user()?->role ?? 'guest';

        // 子类实现具体策略
        $this->applyDirectives();
    }

    abstract protected function applyDirectives(): void;

    /**
     * 通用基础策略 —— 所有租户共享的安全底线
     */
    protected function applyBaseDirectives(): void
    {
        $this
            ->addDirective(Directive::BASE, "'self'")
            ->addDirective(Directive::DEFAULT, "'self'")
            ->addDirective(Directive::FONT, "'self'", 'https://fonts.gstatic.com')
            ->addDirective(Directive::IMG, "'self'", 'data:', 'https:')
            ->addDirective(Directive::FORM_ACTION, "'self'")
            ->addDirective(Directive::FRAME_ANCESTORS, "'self'")
            ->addDirective(Directive::OBJECT, "'none'");
    }
}
```

## 第三步：实现动态租户策略

```php
<?php
// app/Csp/Policies/TenantDynamicPolicy.php

namespace App\Csp\Policies;

use Spatie\Csp\Directive;

class TenantDynamicPolicy extends BaseTenantPolicy
{
    protected function applyDirectives(): void
    {
        // 1. 安全底线
        $this->applyBaseDirectives();

        // 2. 租户自定义域名
        $this->applyTenantDomains();

        // 3. 租户第三方集成
        $this->applyTenantIntegrations();

        // 4. 页面级覆盖
        $this->applyPageOverrides();

        // 5. 角色级覆盖
        $this->applyRoleOverrides();
    }

    /**
     * 把租户自己的域名加进 CSP
     */
    protected function applyTenantDomains(): void
    {
        if (!$this->tenant) {
            return;
        }

        $domains = [
            $this->tenant->domain,
            "cdn.{$this->tenant->domain}",
            "api.{$this->tenant->domain}",
        ];

        // 过滤掉 null
        $domains = array_filter($domains);

        $this->addDirective(Directive::CONNECT, ...$domains);
        $this->addDirective(Directive::IMG, ...$domains);
    }

    /**
     * 根据租户已安装的第三方集成，动态添加 CSP 源
     */
    protected function applyTenantIntegrations(): void
    {
        if (!$this->tenant) {
            return;
        }

        $integrations = $this->tenant->integrations ?? [];

        $cspMap = [
            'google_analytics' => [
                Directive::CONNECT => ['*.google-analytics.com', '*.googletagmanager.com'],
                Directive::IMG     => ['*.google-analytics.com', '*.googletagmanager.com'],
                Directive::SCRIPT  => ['*.googletagmanager.com', 'https://www.google-analytics.com'],
            ],
            'stripe' => [
                Directive::FRAME  => ['js.stripe.com', 'hooks.stripe.com'],
                Directive::SCRIPT => ['js.stripe.com'],
                Directive::CONNECT => ['api.stripe.com'],
            ],
            'alipay' => [
                Directive::FRAME   => ['*.alipay.com', 'render.alipay.com'],
                Directive::CONNECT => ['*.alipay.com'],
            ],
            'wechat_pay' => [
                Directive::FRAME   => ['*.tenpay.com'],
                Directive::CONNECT => ['*.tenpay.com', '*.wechat.com'],
            ],
            'sentry' => [
                Directive::CONNECT => ['*.sentry.io', 'ingest.sentry.io'],
                Directive::SCRIPT  => ['browser.sentry-cdn.com'],
            ],
            'google_maps' => [
                Directive::SCRIPT  => ['maps.googleapis.com', 'maps.gstatic.com'],
                Directive::IMG     => ['*.googleapis.com', '*.gstatic.com'],
                Directive::FRAME   => ['www.google.com', 'maps.google.com'],
            ],
        ];

        foreach ($integrations as $integration) {
            if (!isset($cspMap[$integration])) {
                continue;
            }

            foreach ($cspMap[$integration] as $directive => $sources) {
                $this->addDirective($directive, ...$sources);
            }
        }
    }

    /**
     * 页面级覆盖：某些路由需要特殊策略
     */
    protected function applyPageOverrides(): void
    {
        // 支付页面需要额外的 frame 源
        if (str_starts_with($this->routeName ?? '', 'payment.')) {
            $this->addDirective(Directive::FRAME, 'https:');
        }

        // 文件上传页面允许 blob
        if (str_starts_with($this->routeName ?? '', 'upload.')) {
            $this->addDirective(Directive::IMG, 'blob:');
            $this->addDirective(Directive::CONNECT, 'blob:');
        }

        // 嵌入式页面允许被 iframe
        if (str_starts_with($this->routeName ?? '', 'embed.')) {
            $this->addDirective(Directive::FRAME_ANCESTORS, '*');
        }
    }

    /**
     * 角色级覆盖：管理员后台可能需要更宽松的策略
     */
    protected function applyRoleOverrides(): void
    {
        // 管理后台：允许 inline script（兼容老旧后台组件）
        if ($this->userRole === 'admin' && str_starts_with($this->routeName ?? '', 'admin.')) {
            $this->addDirective(Directive::SCRIPT, "'unsafe-inline'", "'unsafe-eval'");
            $this->addDirective(Directive::STYLE, "'unsafe-inline'");
        }

        // API 路由：不需要 script/img
        if (str_starts_with($this->routeName ?? '', 'api.')) {
            $this->addDirective(Directive::SCRIPT, "'none'");
            $this->addDirective(Directive::IMG, "'none'");
            $this->addDirective(Directive::STYLE, "'none'");
        }
    }
}
```

## 第四步：Nonce 集成

在现代 CSP 中，`'unsafe-inline'` 是大忌。用 Nonce 替代：

```php
<?php
// app/Csp/Policies/TenantDynamicPolicy.php（补充）

class TenantDynamicPolicy extends BaseTenantPolicy
{
    // ... 上面已有代码 ...

    /**
     * 为非管理员页面启用 Nonce
     */
    protected function applyDirectives(): void
    {
        $this->applyBaseDirectives();
        $this->applyTenantDomains();
        $this->applyTenantIntegrations();
        $this->applyPageOverrides();
        $this->applyRoleOverrides();

        // 非管理员页面使用 Nonce
        if ($this->userRole !== 'admin') {
            $this->addNonce(Directive::SCRIPT);
            $this->addNonce(Directive::STYLE);
        }
    }
}
```

在 Blade 模板中使用 Nonce：

```blade
{{-- 获取 CSP Nonce --}}
@php
    $nonce = app(\Spatie\Csp\Nonce\NonceGenerator::class)->generate();
@endphp

<script nonce="{{ $nonce }}">
    // 你的 inline script
    window.APP_CONFIG = @json($config);
</script>

<style nonce="{{ $nonce }}">
    .dynamic-theme { color: {{ $tenant->theme_color }}; }
</style>
```

## 第五步：中间件组装

```php
<?php
// app/Http/Middleware/ApplyDynamicCsp.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Spatie\Csp\AddCspHeaders;
use App\Csp\Policies\TenantDynamicPolicy;

class ApplyDynamicCsp
{
    /**
     * 解析租户 → 设置到容器 → 让 CSP 中间件读取
     */
    public function handle(Request $request, Closure $next)
    {
        // 从域名或子域名解析租户
        $tenant = $this->resolveTenant($request);
        app()->instance('currentTenant', $tenant);

        // 把动态策略注入到 CSP 中间件
        config(['csp.policy' => TenantDynamicPolicy::class]);

        return $next($request);
    }

    protected function resolveTenant(Request $request)
    {
        $host = $request->getHost();

        // 方式 1: 子域名模式 tenant.example.com
        $subdomain = explode('.', $host)[0];

        return \App\Models\Tenant::where('subdomain', $subdomain)
            ->orWhere('domain', $host)
            ->first();
    }
}
```

注册中间件（Laravel 11+ 在 `bootstrap/app.php`）：

```php
<?php
// bootstrap/app.php

use App\Http\Middleware\ApplyDynamicCsp;

return Application::configure(basePath: dirname(__DIR__))
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->web(append: [
            ApplyDynamicCsp::class,
            \Spatie\Csp\AddCspHeaders::class,
        ]);
    })
    ->create();
```

## 第六步：租户 CSP 配置管理

让租户在后台自己配置 CSP，存数据库：

```php
<?php
// app/Models/TenantCspConfig.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TenantCspConfig extends Model
{
    protected $table = 'tenant_csp_configs';

    protected $casts = [
        'allowed_domains' => 'array',  // ["*.google-analytics.com", "cdn.example.com"]
        'integrations'    => 'array',  // ["google_analytics", "stripe"]
        'custom_rules'    => 'array',  // 完整自定义规则
    ];

    protected $fillable = [
        'tenant_id',
        'directive',      // script-src, img-src, connect-src 等
        'allowed_domains',
        'integrations',
        'custom_rules',
        'enabled',
    ];

    public function tenant()
    {
        return $this->belongsTo(Tenant::class);
    }
}
```

迁移文件：

```php
<?php
// database/migrations/2026_06_10_000000_create_tenant_csp_configs_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_csp_configs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('directive'); // script-src, img-src, etc.
            $table->json('allowed_domains')->nullable();
            $table->json('integrations')->nullable();
            $table->json('custom_rules')->nullable();
            $table->boolean('enabled')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'directive']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_csp_configs');
    }
};
```

## 第七步：CSP 报告收集

CSP 违规报告是调优策略的关键数据源：

```php
<?php
// app/Http/Controllers/CspReportController.php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class CspReportController extends Controller
{
    public function store(Request $request)
    {
        $report = $request->json()->all();

        Log::channel('csp')->warning('CSP Violation', [
            'tenant'     => app('currentTenant')?->id,
            'document'   => $report['csp-report']['document-uri'] ?? null,
            'violated'   => $report['csp-report']['violated-directive'] ?? null,
            'blocked'    => $report['csp-report']['blocked-uri'] ?? null,
            'source'     => $report['csp-report']['source-file'] ?? null,
            'line'       => $report['csp-report']['line-number'] ?? null,
        ]);

        return response('', 204);
    }
}
```

注册路由和报告端点：

```php
// routes/web.php
Route::post('/csp-report', [CspReportController::class, 'store'])
    ->name('csp.report')
    ->withoutMiddleware(['web', 'csrf']);
```

在策略中启用报告：

```php
// 在 BaseTenantPolicy 的 applyBaseDirectives() 中
$this
    ->addDirective(Directive::REPORT_URI, route('csp.report'))
    ->addDirective(Directive::REPORT_TO, 'csp-endpoint');
```

## 第八步：缓存优化

每个请求都重新计算 CSP 会带来性能损耗。用请求级缓存 + Redis 缓存双层优化：

```php
<?php
// app/Csp/Policies/TenantDynamicPolicy.php（补充缓存逻辑）

use Illuminate\Support\Facades\Cache;

class TenantDynamicPolicy extends BaseTenantPolicy
{
    /**
     * 重写 configure，加入缓存层
     */
    public function configure(): void
    {
        $this->tenant = app('currentTenant');
        $this->routeName = request()->route()?->getName();
        $this->userRole = auth()->user()?->role ?? 'guest';

        $cacheKey = $this->buildCacheKey();

        // 请求级缓存（同一请求内不重复计算）
        static $requestCache = [];
        if (isset($requestCache[$cacheKey])) {
            $this->directives = $requestCache[$cacheKey];
            return;
        }

        // Redis 缓存（5 分钟）
        $cached = Cache::tags(['csp'])->get($cacheKey);
        if ($cached) {
            $this->directives = $cached;
            $requestCache[$cacheKey] = $cached;
            return;
        }

        $this->applyDirectives();

        Cache::tags(['csp'])->put($cacheKey, $this->directives, now()->addMinutes(5));
        $requestCache[$cacheKey] = $this->directives;
    }

    protected function buildCacheKey(): string
    {
        $tenantId = $this->tenant?->id ?? 'default';
        $route = $this->routeName ?? 'unknown';
        $role = $this->userRole ?? 'guest';

        return "csp:{$tenantId}:{$route}:{$role}";
    }
}
```

当租户修改 CSP 配置时清除缓存：

```php
// app/Observers/TenantCspConfigObserver.php

namespace App\Observers;

use App\Models\TenantCspConfig;
use Illuminate\Support\Facades\Cache;

class TenantCspConfigObserver
{
    public function saved(TenantCspConfig $config): void
    {
        Cache::tags(['csp'])->flush();
    }

    public function deleted(TenantCspConfig $config): void
    {
        Cache::tags(['csp'])->flush();
    }
}
```

## 踩坑记录

### 1. `report-uri` 和 `report-to` 的区别

`report-uri` 是 CSP Level 2，兼容性好但已废弃。`report-to` 是 CSP Level 3，需要配合 `Reporting-Endpoints` 响应头。建议两个都加：

```php
$this
    ->addDirective(Directive::REPORT_URI, route('csp.report'))
    ->addDirective(Directive::REPORT_TO, 'csp-endpoint');
```

别忘了在 nginx 中添加 `Reporting-Endpoints` 头：

```nginx
add_header Reporting-Endpoints 'csp-endpoint="/csp-report"';
```

### 2. Safari 的 Nonce bug

Safari 15.4 之前的版本对 Nonce 有 bug，inline script 加了 nonce 也会被拦截。解决方案：同时保留 `'unsafe-inline'` 作为 fallback（有 nonce 时浏览器会优先用 nonce，忽略 `unsafe-inline`）。

### 3. 动态添加 CDN 图片不要用 `*`

```php
// ❌ 危险：允许所有 https 图片
$this->addDirective(Directive::IMG, 'https:');

// ✅ 安全：只允许特定 CDN
$this->addDirective(Directive::IMG, 'https://cdn.tenant-a.com', 'https://images.tenant-b.com');
```

### 4. 管理后台的 `unsafe-eval` 风险

某些富文本编辑器（如 CKEditor 4）需要 `unsafe-eval`。如果无法升级，至少：

- 限制只在管理后台路由生效
- 加上 `require-trusted-types-for 'script'`（Trusted Types API）
- 记录所有 eval 使用的审计日志

### 5. CSP 头大小限制

某些 CDN 和反向代理对响应头有大小限制（通常 8KB）。如果租户配置了大量第三方集成，CSP 头可能超限。解决方案：

- 合并重复域名
- 用通配符 `*.example.com` 代替列举子域名
- 考虑用 CSP `<meta>` 标签（但不支持 `frame-ancestors` 和 `report-uri`）

## 完整请求流程图

```
用户请求 https://tenant-a.example.com/dashboard
         │
         ▼
    ApplyDynamicCsp 中间件
         │
         ├─ 解析域名 → tenant-a
         ├─ 查询 Tenant::where('subdomain', 'tenant-a')
         ├─ app()->instance('currentTenant', $tenant)
         │
         ▼
    TenantDynamicPolicy::configure()
         │
         ├─ buildCacheKey() → "csp:42:dashboard:user"
         ├─ 缓存命中？→ 直接返回
         │
         ├─ applyBaseDirectives()    → 安全底线
         ├─ applyTenantDomains()     → tenant-a.com, cdn.tenant-a.com
         ├─ applyTenantIntegrations() → google_analytics, stripe
         ├─ applyPageOverrides()     → dashboard 无特殊
         ├─ applyRoleOverrides()     → 普通用户，不加 unsafe-inline
         ├─ addNonce(SCRIPT)         → nonce-abc123
         │
         ▼
    AddCspHeaders 中间件
         │
         └─ 设置响应头:
            Content-Security-Policy:
              default-src 'self';
              script-src 'self' 'nonce-abc123' *.googletagmanager.com https://www.google-analytics.com js.stripe.com;
              img-src 'self' data: https: *.google-analytics.com *.googletagmanager.com tenant-a.com cdn.tenant-a.com;
              connect-src 'self' *.google-analytics.com *.googletagmanager.com tenant-a.com cdn.tenant-a.com api.tenant-a.com api.stripe.com;
              frame-src js.stripe.com hooks.stripe.com;
              font-src 'self' https://fonts.gstatic.com;
              form-action 'self';
              frame-ancestors 'self';
              object-src 'none';
              report-uri /csp-report;
```

## 测试验证

```bash
# 1. 检查响应头
curl -I https://tenant-a.example.com/dashboard | grep -i content-security

# 2. 测试违规报告
curl -X POST https://tenant-a.example.com/csp-report \
  -H "Content-Type: application/csp-report" \
  -d '{
    "csp-report": {
      "document-uri": "https://tenant-a.example.com/dashboard",
      "violated-directive": "script-src",
      "blocked-uri": "https://evil.com/malicious.js",
      "source-file": "inline"
    }
  }'

# 3. 检查日志
tail -f storage/logs/csp.log
```

## 总结

多租户 SaaS 的 CSP 动态化核心要点：

1. **不要写死 CSP** — 用策略类 + 中间件动态生成
2. **分层设计** — 租户层 → 集成层 → 页面层 → 角色层，逐层叠加
3. **Nonce 替代 unsafe-inline** — 管理后台可特殊处理
4. **缓存是必须的** — 请求级 + Redis 双层缓存
5. **报告收集** — 上线初期用 `Content-Security-Policy-Report-Only` 观察，不要直接 enforce
6. **让租户自己配置** — 存数据库，提供管理界面，修改后清除缓存

CSP 不是一劳永逸的配置，而是需要持续调优的动态系统。先 Report-Only 跑两周，看违规报告调整策略，再切换到 enforce 模式。
