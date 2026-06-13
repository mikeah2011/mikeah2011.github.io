---
title: GDPR Cookie Consent 实战：Cookie Banner、Consent 存储、第三方脚本按需加载——Laravel 应用的隐私合规工程化方案
keywords: [GDPR Cookie Consent, Cookie Banner, Consent, Laravel, 存储, 第三方脚本按需加载, 应用的隐私合规工程化方案, PHP]
date: 2026-06-10 06:08:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - GDPR
  - 隐私合规
  - Cookie
  - 第三方脚本
description: 深入实战 Laravel 应用的 GDPR Cookie 合规工程化方案，涵盖 Cookie Banner 组件设计、Consent 存储与版本管理、第三方脚本按需加载、审计日志完整实现，附完整可运行代码。
---


# GDPR Cookie Consent 实战：Laravel 应用的隐私合规工程化方案

## 概述

2026 年，GDPR 执法力度持续加强。Google Analytics 被罚、Cookie Banner 形同虚设被起诉的案例比比皆是。很多 Laravel 项目对 Cookie 合规的理解还停留在"加个弹窗就行"的阶段，实际差得远。

本文从工程化角度完整实现一套 GDPR Cookie Consent 方案，覆盖：

- Cookie Banner 前端交互与 Vue/Blade 集成
- Consent 数据库存储与版本管理（用户可随时撤回）
- 第三方脚本按需加载（Google Analytics、Facebook Pixel 等）
- 审计日志与合规报告
- 性能优化与 SEO 影响

目标是写完就能直接用，不是理论文章。

---

## 核心概念

### GDPR 对 Cookie 的要求

GDPR 把 Cookie 分三类：

| 类型 | 说明 | 是否需要同意 |
|------|------|-------------|
| **必要 Cookie** | 登录、CSRF、会话等 | ❌ 不需要 |
| **功能 Cookie** | 语言偏好、主题设置 | ⚠️ 建议获取 |
| **分析/广告 Cookie** | GA、FB Pixel、热力图 | ✅ 必须 |

关键原则：

1. **先同意后加载** — 没有用户同意，第三方脚本不能执行
2. **Granular Consent** — 用户可以单独同意/拒绝每类 Cookie
3. **Consent 可撤回** — 用户随时可以修改偏好
4. **审计可追溯** — 能证明什么时候、给了谁什么同意

### 合规 vs 不合规的常见做法

```php
// ❌ 不合规：默认全加载
<script src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<script>
  gtag('config', 'G-XXXX');
</script>

// ✅ 合规：只在用户同意后加载
<script>
  if (userConsent.analytics) {
    loadGoogleAnalytics('G-XXXX');
  }
</script>
```

---

## 数据库设计

### Consent 记录表

```php
// database/migrations/2026_06_10_000001_create_cookie_consents_table.php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cookie_consents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('visitor_id', 64)->index(); // 未登录用户用匿名 ID
            $table->json('consent_data');               // {"necessary":true,"analytics":false,"marketing":false}
            $table->string('consent_version', 32);      // 策略版本号
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->timestamp('consented_at');
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();

            $table->index(['visitor_id', 'consented_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cookie_consents');
    }
};
```

### Consent 策略版本表

```php
// database/migrations/2026_06_10_000002_create_cookie_consent_policies_table.php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cookie_consent_policies', function (Blueprint $table) {
            $table->id();
            $table->string('version', 32)->unique();
            $table->json('categories');        // 分类定义
            $table->json('required_cookies');  // 每类下必须展示的 Cookie 说明
            $table->text('policy_url');        // 完整隐私政策链接
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cookie_consent_policies');
    }
};
```

---

## Consent 管理服务

### 核心 Service

```php
<?php
// app/Services/CookieConsentService.php

declare(strict_types=1);

namespace App\Services;

use App\Models\CookieConsent;
use App\Models\CookieConsentPolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class CookieConsentService
{
    // Consent 数据在 Cookie 中的名称
    private const COOKIE_NAME = 'gdpr_consent';
    private const COOKIE_TTL = 365 * 24 * 60 * 60; // 1 年

    /**
     * 获取当前活跃的 Consent 策略
     */
    public function getActivePolicy(): CookieConsentPolicy
    {
        return Cache::remember('active_consent_policy', 3600, function () {
            return CookieConsentPolicy::where('is_active', true)->latest()->firstOrFail();
        });
    }

    /**
     * 获取访客的当前 Consent 状态
     */
    public function getVisitorConsent(Request $request): ?array
    {
        $visitorId = $this->resolveVisitorId($request);

        // 1. 先查 Cookie
        $cookieConsent = $request->cookie(self::COOKIE_NAME);
        if ($cookieConsent) {
            $decoded = json_decode(base64_decode($cookieConsent), true);
            if ($decoded && $this->isConsentValid($decoded)) {
                return $decoded;
            }
        }

        // 2. 再查数据库（用户登录后恢复）
        if ($request->user()) {
            $record = CookieConsent::where('user_id', $request->user()->id)
                ->whereNull('revoked_at')
                ->latest('consented_at')
                ->first();

            if ($record) {
                return $record->consent_data;
            }
        }

        // 3. 查匿名记录
        if ($visitorId) {
            $record = CookieConsent::where('visitor_id', $visitorId)
                ->whereNull('revoked_at')
                ->latest('consented_at')
                ->first();

            if ($record) {
                return $record->consent_data;
            }
        }

        return null; // 未设置，需要弹出 Banner
    }

    /**
     * 保存用户 Consent 选择
     */
    public function saveConsent(Request $request, array $categories): CookieConsent
    {
        $visitorId = $this->resolveVisitorId($request);
        $policy = $this->getActivePolicy();

        // 强制必要类始终为 true
        $consentData = array_merge(
            ['necessary' => true],
            $categories
        );

        // 验证分类合法
        $validCategories = array_keys($policy->categories);
        $consentData = array_filter($consentData, fn($key) => in_array($key, $validCategories), ARRAY_FILTER_USE_KEY);

        $record = CookieConsent::create([
            'user_id' => $request->user()?->id,
            'visitor_id' => $visitorId,
            'consent_data' => $consentData,
            'consent_version' => $policy->version,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'consented_at' => now(),
        ]);

        // 写入 Cookie
        $this->setConsentCookie($request, $consentData);

        return $record;
    }

    /**
     * 撤销 Consent
     */
    public function revokeConsent(Request $request): void
    {
        $visitorId = $this->resolveVisitorId($request);

        CookieConsent::where('visitor_id', $visitorId)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        // 清除 Cookie
        cookie()->forget(self::COOKIE_NAME);

        // 清缓存
        if ($request->user()) {
            Cache::forget("consent_{$request->user()->id}");
        }
    }

    /**
     * 检查特定类别是否已同意
     */
    public function hasConsent(Request $request, string $category): bool
    {
        $consent = $this->getVisitorConsent($request);
        return $consent[$category] ?? false;
    }

    /**
     * 生成需要注入的前端 JS 配置
     */
    public function getFrontendConfig(Request $request): string
    {
        $consent = $this->getVisitorConsent($request);
        $policy = $this->getActivePolicy();

        $config = [
            'consent' => $consent,
            'policy' => $policy->categories,
            'showBanner' => $consent === null,
        ];

        return 'window.__GDPR_CONFIG__ = ' . json_encode($config) . ';';
    }

    // ---- 私有方法 ----

    private function resolveVisitorId(Request $request): string
    {
        $existing = $request->cookie('visitor_id');
        if ($existing) {
            return $existing;
        }
        return Str::random(32);
    }

    private function setConsentCookie(Request $request, array $data): void
    {
        $encoded = base64_encode(json_encode($data));
        cookie()->queue(self::COOKIE_NAME, $encoded, self::COOKIE_TTL, '/', null, false, true);
    }

    private function isConsentValid(array $consent): bool
    {
        $policy = $this->getActivePolicy();
        return ($consent['_version'] ?? '') === $policy->version;
    }
}
```

### 注册 Service Provider

```php
<?php
// app/Providers/CookieConsentServiceProvider.php

namespace App\Providers;

use App\Services\CookieConsentService;
use Illuminate\Support\ServiceProvider;

class CookieConsentServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(CookieConsentService::class);
    }

    public function boot(): void
    {
        // 注入 Blade 指令
        \Blade::directive('gdprConsent', function () {
            return "<?php echo app(\App\Services\CookieConsentService::class)->getFrontendConfig(\$request ?? request()); ?>";
        });
    }
}
```

在 `config/app.php` 注册 Provider。

---

## 路由与控制器

### 路由定义

```php
<?php
// routes/web.php (追加)

use App\Http\Controllers\CookieConsentController;

Route::prefix('gdpr')->name('gdpr.')->group(function () {
    Route::post('/consent', [CookieConsentController::class, 'store'])->name('consent.store');
    Route::delete('/consent', [CookieConsentController::class, 'destroy'])->name('consent.destroy');
    Route::get('/consent/status', [CookieConsentController::class, 'status'])->name('consent.status');
    Route::get('/consent/policy', [CookieConsentController::class, 'policy'])->name('consent.policy');
});
```

### Controller

```php
<?php
// app/Http/Controllers/CookieConsentController.php

namespace App\Http\Controllers;

use App\Services\CookieConsentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CookieConsentController extends Controller
{
    public function __construct(
        private readonly CookieConsentService $consentService
    ) {}

    /**
     * 保存 Consent
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'categories' => 'required|array',
            'categories.*' => 'boolean',
        ]);

        $record = $this->consentService->saveConsent($request, $validated['categories']);

        return response()->json([
            'success' => true,
            'consent' => $record->consent_data,
        ]);
    }

    /**
     * 撤销 Consent
     */
    public function destroy(Request $request): JsonResponse
    {
        $this->consentService->revokeConsent($request);

        return response()->json([
            'success' => true,
            'message' => 'Consent revoked successfully.',
        ]);
    }

    /**
     * 查询当前 Consent 状态
     */
    public function status(Request $request): JsonResponse
    {
        $consent = $this->consentService->getVisitorConsent($request);
        $policy = $this->consentService->getActivePolicy();

        return response()->json([
            'consent' => $consent,
            'policy' => $policy->categories,
            'show_banner' => $consent === null,
        ]);
    }

    /**
     * 获取策略详情（隐私政策页面用）
     */
    public function policy(): JsonResponse
    {
        $policy = $this->consentService->getActivePolicy();

        return response()->json([
            'version' => $policy->version,
            'categories' => $policy->categories,
            'cookies' => $policy->required_cookies,
            'policy_url' => $policy->policy_url,
        ]);
    }
}
```

---

## 前端：Cookie Banner 组件

### Blade 模板

```html
<!-- resources/views/components/cookie-consent.blade.php -->

<div id="cookie-consent-banner" x-data="cookieConsent()" x-show="showBanner"
     x-transition:enter="transition ease-out duration-300"
     x-transition:enter-start="opacity-0 translate-y-4"
     x-transition:enter-end="opacity-100 translate-y-0"
     x-transition:leave="transition ease-in duration-200"
     x-transition:leave-start="opacity-100 translate-y-0"
     x-transition:leave-end="opacity-0 translate-y-4"
     class="fixed bottom-0 inset-x-0 z-50 p-4 md:p-6">
    
    <div class="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
        
        <!-- 标题 -->
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            🍪 Cookie 设置
        </h3>
        
        <!-- 说明文字 -->
        <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">
            我们使用 Cookie 来改善您的浏览体验、提供个性化内容和分析网站流量。
            您可以选择接受所有 Cookie，或自定义您的偏好设置。
            <a href="{{ route('gdpr.consent.policy') }}" class="text-blue-600 hover:underline" target="_blank">
                查看完整隐私政策
            </a>
        </p>
        
        <!-- 分类开关 -->
        <div class="space-y-3 mb-6">
            <!-- 必要 Cookie（始终开启，不可关闭） -->
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                    <span class="font-medium text-gray-900 dark:text-white">必要 Cookie</span>
                    <span class="ml-2 text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded">始终启用</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">登录、安全、会话等基础功能所必需</p>
                </div>
                <input type="checkbox" checked disabled
                       class="w-5 h-5 text-green-600 rounded border-gray-300">
            </div>
            
            <!-- 分析 Cookie -->
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                    <span class="font-medium text-gray-900 dark:text-white">分析 Cookie</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Google Analytics、网站性能分析</p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" x-model="categories.analytics" class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>
            
            <!-- 营销 Cookie -->
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                    <span class="font-medium text-gray-900 dark:text-white">营销 Cookie</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Facebook Pixel、广告追踪、再营销</p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" x-model="categories.marketing" class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>
        </div>
        
        <!-- 按钮组 -->
        <div class="flex flex-col sm:flex-row gap-3">
            <button @click="acceptAll()"
                    class="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
                接受全部
            </button>
            <button @click="saveChoices()"
                    class="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-900 dark:text-white font-medium rounded-lg transition-colors">
                保存偏好
            </button>
            <button @click="rejectAll()"
                    class="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium rounded-lg transition-colors">
                仅必要
            </button>
        </div>
    </div>
</div>

@push('scripts')
<script>
function cookieConsent() {
    return {
        showBanner: false,
        categories: {
            necessary: true,
            analytics: false,
            marketing: false,
        },
        
        init() {
            // 从服务端注入的配置读取
            const config = window.__GDPR_CONFIG__;
            if (config) {
                this.showBanner = config.showBanner;
                if (config.consent) {
                    this.categories = { ...this.categories, ...config.consent };
                }
            } else {
                this.showBanner = true;
            }
        },
        
        async saveChoices() {
            await this.postConsent(this.categories);
            this.showBanner = false;
            this.loadThirdPartyScripts();
        },
        
        async acceptAll() {
            this.categories = { necessary: true, analytics: true, marketing: true };
            await this.postConsent(this.categories);
            this.showBanner = false;
            this.loadThirdPartyScripts();
        },
        
        async rejectAll() {
            this.categories = { necessary: true, analytics: false, marketing: false };
            await this.postConsent(this.categories);
            this.showBanner = false;
        },
        
        async postConsent(categories) {
            try {
                await fetch('{{ route("gdpr.consent.store") }}', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
                    },
                    body: JSON.stringify({ categories }),
                });
            } catch (e) {
                console.error('Failed to save consent:', e);
            }
        },
        
        loadThirdPartyScripts() {
            if (this.categories.analytics) {
                this.loadGoogleAnalytics();
            }
            if (this.categories.marketing) {
                this.loadFacebookPixel();
            }
        },
        
        loadGoogleAnalytics() {
            if (document.getElementById('ga-script')) return;
            
            const script = document.createElement('script');
            script.id = 'ga-script';
            script.async = true;
            script.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
            document.head.appendChild(script);
            
            window.dataLayer = window.dataLayer || [];
            function gtag() { dataLayer.push(arguments); }
            gtag('js', new Date());
            gtag('config', 'G-XXXXXXX', { anonymize_ip: true });
        },
        
        loadFacebookPixel() {
            if (document.getElementById('fb-pixel')) return;
            
            !function(f,b,e,v,n,t,s){/*FB Pixel boilerplate*/
                if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;t.id='fb-pixel';
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
            
            fbq('init', 'YOUR_PIXEL_ID');
            fbq('track', 'PageView');
        },
    }
}
</script>
@endpush
```

### 布局文件引入

```html
<!-- resources/views/layouts/app.blade.php -->
<head>
    @gdprConsent   {{-- 注入 GDPR 配置 --}}
</head>
<body>
    @yield('content')
    
    <x-cookie-consent />
</body>
```

---

## 第三方脚本按需加载

### 通用脚本加载器

```javascript
// resources/js/third-party-scripts.js

class ThirdPartyLoader {
    constructor() {
        this.loaded = new Set();
    }

    /**
     * 安全加载外部脚本
     */
    load(id, src, options = {}) {
        if (this.loaded.has(id)) return;
        
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.id = id;
            script.src = src;
            script.async = true;
            
            if (options.attrs) {
                Object.entries(options.attrs).forEach(([key, value]) => {
                    script.setAttribute(key, value);
                });
            }
            
            script.onload = () => {
                this.loaded.add(id);
                resolve();
            };
            script.onerror = reject;
            
            document.head.appendChild(script);
        });
    }

    /**
     * 延迟加载（页面空闲时）
     */
    loadWhenIdle(id, src, options = {}) {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => this.load(id, src, options), { timeout: 5000 });
        } else {
            setTimeout(() => this.load(id, src, options), 1000);
        }
    }

    /**
     * 基于 Intersection Observer 的视口加载
     */
    loadOnVisible(elementSelector, id, src, options = {}) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.load(id, src, options);
                    observer.disconnect();
                }
            });
        }, { rootMargin: '200px' });
        
        const el = document.querySelector(elementSelector);
        if (el) observer.observe(el);
    }

    /**
     * 移除已加载的脚本（用户撤回 Consent 时）
     */
    remove(id) {
        const script = document.getElementById(id);
        if (script) {
            script.remove();
            this.loaded.delete(id);
        }
    }
}

window.thirdPartyLoader = new ThirdPartyLoader();
```

### Laravel Mix/Vite 集成

```php
<?php
// app/Http/Middleware/InjectThirdPartyScripts.php

namespace App\Http\Middleware;

use App\Services\CookieConsentService;
use Closure;
use Illuminate\Http\Request;

class InjectThirdPartyScripts
{
    public function __construct(
        private readonly CookieConsentService $consentService
    ) {}

    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        // 只在 HTML 响应中注入
        if (str_contains($response->headers->get('Content-Type', ''), 'text/html')) {
            $content = $response->getContent();
            
            $scripts = $this->buildScripts($request);
            
            // 在 </head> 前注入
            $content = str_replace('</head>', $scripts . '</head>', $content);
            
            $response->setContent($content);
        }

        return $response;
    }

    private function buildScripts(Request $request): string
    {
        $html = "\n<!-- GDPR-gated third-party scripts -->\n";
        $html .= '<script>window.thirdPartyLoader = window.thirdPartyLoader || {loaded:new Set()};</script>' . "\n";

        // 分析类脚本（只有用户同意才注册，由前端 JS 决定是否加载）
        $html .= '<script data-gdpr-category="analytics">';
        $html .= 'window.__GDPR_SCRIPTS__ = window.__GDPR_SCRIPTS__ || [];';
        $html .= 'window.__GDPR_SCRIPTS__.push({';
        $html .= '  id: "ga-script",';
        $html .= '  src: "https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX",';
        $html .= '  category: "analytics"';
        $html .= '});';
        $html .= '</script>' . "\n";

        return $html;
    }
}
```

注册中间件：

```php
// app/Http/Kernel.php
protected $middleware = [
    // ... 其他中间稿
    \App\Http\Middleware\InjectThirdPartyScripts::class,
];
```

---

## 审计日志

### 审计日志 Service

```php
<?php
// app/Services/CookieConsentAuditService.php

namespace App\Services;

use App\Models\CookieConsent;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CookieConsentAuditService
{
    /**
     * 导出特定用户的全部 Consent 历史（GDPR 数据主体请求用）
     */
    public function exportUserHistory(int $userId): array
    {
        $records = CookieConsent::where('user_id', $userId)
            ->orderBy('consented_at')
            ->get();

        return [
            'user_id' => $userId,
            'total_records' => $records->count(),
            'history' => $records->map(fn($r) => [
                'consent_data' => $r->consent_data,
                'version' => $r->consent_version,
                'ip_address' => $r->ip_address,
                'consented_at' => $r->consented_at->toIso8601String(),
                'revoked_at' => $r->revoked_at?->toIso8601String(),
            ])->toArray(),
        ];
    }

    /**
     * 统计各分类同意率（合规报告用）
     */
    public function getConsentStats(string $period = '30d'): array
    {
        $since = now()->sub($period === '30d' ? 30 : 90, 'day');

        $stats = CookieConsent::where('consented_at', '>=', $since)
            ->whereNull('revoked_at')
            ->selectRaw("
                COUNT(*) as total,
                SUM(CASE WHEN JSON_EXTRACT(consent_data, '$.analytics') = true THEN 1 ELSE 0 END) as analytics_opt_in,
                SUM(CASE WHEN JSON_EXTRACT(consent_data, '$.marketing') = true THEN 1 ELSE 0 END) as marketing_opt_in
            ")
            ->first();

        return [
            'period' => $period,
            'total_consents' => $stats->total,
            'analytics_opt_in_rate' => $stats->total > 0
                ? round($stats->analytics_opt_in / $stats->total * 100, 1)
                : 0,
            'marketing_opt_in_rate' => $stats->total > 0
                ? round($stats->marketing_opt_in / $stats->total * 100, 1)
                : 0,
        ];
    }

    /**
     * 清理过期的匿名 Consent 记录（数据最小化原则）
     */
    public function cleanupAnonymous(int $keepDays = 365): int
    {
        $cutoff = now()->subDays($keepDays);

        return CookieConsent::whereNull('user_id')
            ->where('consented_at', '<', $cutoff)
            ->delete();
    }
}
```

---

## 踩坑记录

### 1. 同意了但还是加载了脚本

**问题**：用户在 Banner 上点了"仅必要"，但 GA 还是加载了。

**原因**：在 Blade 模板里直接写了 `<script src="ga...">`，不经过 Consent 检查。

**解决**：所有第三方脚本必须通过 `ThirdPartyLoader` 加载，绝对不能直接写 `<script src>`。建议用 ESLint 规则禁止直接引入外部脚本：

```javascript
// .eslintrc.js
module.exports = {
    rules: {
        'no-restricted-syntax': [
            'error',
            {
                selector: 'Literal[value=/googletagmanager|facebook\\.net/i]',
                message: 'Third-party scripts must be loaded via ThirdPartyLoader with GDPR consent check.',
            },
        ],
    },
};
```

### 2. SEO 影响——GA 加载延迟导致转化数据不准

**问题**：用户同意后才加载 GA，但很多用户在同意前就离开了，导致流量数据偏低。

**分析**：这是 GDPR 合规的必然代价，不是 bug。但可以用以下方式减轻影响：

```javascript
// 在用户同意后立即触发页面浏览事件
if (window.gtag) {
    gtag('event', 'page_view', {
        // 标记这是延迟加载后的首次 page_view
        consent_delay: true,
    });
}
```

在 GA4 报告中用这个维度区分延迟加载和正常加载的流量。

### 3. 同意版本变更——旧用户的 Consent 失效

**问题**：更新了 Cookie 策略（比如新增了 `preferences` 分类），但老用户的 Cookie 里没有这个字段。

**解决**：`consent_version` 字段是关键。每次检查 Consent 时比对版本号：

```php
private function isConsentValid(array $consent): bool
{
    $policy = $this->getActivePolicy();
    // 版本号不匹配 → 旧 Consent 失效 → 弹出 Banner
    return ($consent['_version'] ?? '') === $policy->version;
}
```

同时在保存时写入版本号：

```php
$consentData['_version'] = $policy->version;
```

### 4. 用户登录后 Cookie 和数据库记录不同步

**问题**：匿名用户点了"接受全部"，登录后在设置里点了"拒绝分析"。但 Cookie 还是旧的。

**解决**：登录事件中清除旧的匿名 Consent，以数据库记录为准：

```php
<?php
// app/Listeners/SyncConsentOnLogin.php

namespace App\Listeners;

use App\Services\CookieConsentService;
use Illuminate\Auth\Events\Login;

class SyncConsentOnLogin
{
    public function __construct(
        private readonly CookieConsentService $consentService
    ) {}

    public function handle(Login $event): void
    {
        // 登录后以数据库中最新的用户 Consent 为准
        // Cookie 会在下次请求时被数据库记录覆盖
        $user = $event->user;
        $record = \App\Models\CookieConsent::where('user_id', $user->id)
            ->whereNull('revoked_at')
            ->latest('consented_at')
            ->first();

        if ($record) {
            $this->consentService->setConsentCookie(request(), $record->consent_data);
        }
    }
}
```

### 5. 同意弹窗在页面闪烁

**问题**：页面加载时先显示 Banner，JS 加载后才隐藏（因为判断用户已同意）。

**解决**：在 `<head>` 中注入内联 JS 提前判断：

```html
<head>
    <script>
        // 阻塞渲染，避免闪烁
        (function() {
            var consent = document.cookie.match(/gdpr_consent=([^;]+)/);
            if (consent) {
                document.documentElement.classList.add('gdpr-consented');
            }
        })();
    </script>
    <style>
        /* 未同意时显示 Banner，已同意时隐藏 */
        html:not(.gdpr-consented) #cookie-consent-banner { display: flex !important; }
        html.gdpr-consented #cookie-consent-banner { display: none !important; }
    </style>
</head>
```

这样 Banner 只在用户真正未同意时才显示，不会闪烁。

---

## 总结

GDPR Cookie 合规不是一个弹窗的事，而是一套完整的工程体系：

1. **数据层** — Consent 记录持久化到数据库，支持版本管理和审计追溯
2. **服务层** — ConsentService 统一管理同意/撤回/查询，Cookie 和数据库双写双读
3. **前端层** — Alpine.js 驱动的 Banner 组件，Granular Consent 开关，按需加载脚本
4. **加载层** — ThirdPartyLoader 封装所有外部脚本加载，ESLint 规则防止绕过
5. **审计层** — 合规报告、数据主体请求导出、匿名数据清理

实际项目中，最容易踩的坑是"以为加了弹窗就完事了"——第三方脚本的加载时机、版本变更时的旧用户处理、登录后的状态同步，这些才是合规的真正难点。

GDPR 合规本质上是一个持续工程，不是一次性任务。策略会变，分类会加，审计会查。把它当成代码的一部分来维护，比事后补救省十倍力气。
