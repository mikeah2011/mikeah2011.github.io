---
title: Laravel Response Cache 实战：全页缓存与局部缓存策略踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-16 20:50:45
updated: 2026-05-16 20:55:31
categories:
  - php
tags: [KKday, Laravel, Redis, 性能优化, 缓存]
keywords: [Laravel Response Cache, 全页缓存与局部缓存策略踩坑记录, PHP]
description: 在 KKday B2C API 项目中，全页缓存（Response Cache）是提升高并发场景下响应速度的关键手段。本文从 spatie/laravel-response-cache 出发，深入讲解 HTTP 响应缓存的架构设计、缓存失效策略、局部缓存（ESI/Edge-Side Includes 思路）、认证用户场景处理，以及生产环境中真实踩过的坑。



---

# Laravel Response Cache 实战：全页缓存与局部缓存策略踩坑记录

## 前言

在 B2C 电商场景中，商品详情页、活动页、首页等公开页面的访问量占总流量的 60-80%，但这些页面的数据变化频率远低于访问频率。**如果每次请求都走完整的 Laravel Pipeline → Controller → Service → DB → Response，这是对计算资源的巨大浪费。**

之前我们聊过 Laravel 框架层面的四层缓存（Route/Config/View/Query），但那都是「应用内部」的优化。**Response Cache 是在 HTTP 响应层面做缓存**——直接把整个响应体（或部分响应）存起来，下次请求直接返回，连 PHP 代码都不用执行。

本文基于 KKday B2C API 的真实项目经验，讲清楚：

1. 全页缓存的架构设计与选型
2. `spatie/laravel-response-cache` 实战配置
3. 缓存失效策略（手动/自动/事件驱动）
4. 局部缓存：混合动态内容的方案
5. 认证用户的缓存隔离
6. 生产环境踩坑全记录

---

## 架构全景：缓存层级与 Response Cache 的定位

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Request                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1: CDN / Nginx Cache (静态资源 + 公开页面)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │ CloudFront   │  │ Nginx proxy_ │  │ FastCGI Cache       │    │
│  │ Cache        │  │ cache        │  │                     │    │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘    │
│         │                 │                      │               │
│         ▼                 ▼                      ▼               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Layer 2: Response Cache (spatie/laravel-response-cache)  │   │
│  │  → 全页缓存，存储在 Redis，跳过整个 Laravel Pipeline       │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │ (cache miss)                       │
│                             ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Layer 3: Application Cache (Cache::remember / Query Cache)│   │
│  │  → 部分数据缓存，仍需执行 Controller 逻辑                   │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │ (cache miss)                       │
│                             ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Layer 4: Database / External API                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**关键区别**：
- **Layer 1 (CDN/Nginx)**：在 Web Server 层面拦截，不进入 PHP 进程
- **Layer 2 (Response Cache)**：在 Laravel Middleware 层面拦截，进入 PHP 但跳过业务逻辑
- **Layer 3 (Application Cache)**：在业务逻辑内部缓存数据，仍需执行 Controller

Response Cache 是 CDN 和应用缓存之间的「中间地带」——当 CDN 因为个性化需求无法缓存时（如需要检测 Cookie、路径有动态部分），Response Cache 是最佳选择。

---

## spatie/laravel-response-cache 实战

### 安装与基础配置

```bash
composer require spatie/laravel-response-cache
php artisan vendor:publish --provider="Spatie\ResponseCache\ResponseCacheServiceProvider"
```

发布配置文件后，核心配置项：

```php
// config/responsecache.php
return [
    // 缓存驱动，默认使用 config/cache.php 中的 default
    'cache_store' => env('RESPONSE_CACHE_DRIVER', 'redis'),

    // 缓存过期时间（分钟），0 = 永不过期
    'cache_lifetime_in_minutes' => 60 * 24, // 24 小时

    // 缓存哪些 HTTP 方法
    'cacheable_http_methods' => [
        'GET', 'HEAD',
    ],

    // 是否在响应中添加缓存标记头
    'add_cache_time_header' => true,

    // 配置自定义的 CacheProfile（判断哪些请求该缓存）
    'cache_profile' => \Spatie\ResponseCache\CacheProfiles\CacheAllSuccessfulGetRequests::class,

    // 中间件组
    'middleware' => [
        \Spatie\ResponseCache\Middlewares\CacheResponse::class,
    ],

    // 缓存标签（用于批量清除）
    'cache_tag' => 'response-cache',
];
```

### 注册中间件

```php
// app/Http/Kernel.php
protected $middlewareGroups = [
    'web' => [
        // ... 其他中间件
    ],
    'api' => [
        // ... 其他中间件
        \Spatie\ResponseCache\Middlewares\CacheResponse::class,
    ],
];
```

或者在路由中单独使用：

```php
// routes/api.php
Route::middleware(['cacheResponse:60'])->group(function () {
    // 这些路由的响应会被缓存 60 分钟
    Route::get('/products/{slug}', [ProductController::class, 'show']);
    Route::get('/campaigns/{id}', [CampaignController::class, 'show']);
    Route::get('/categories', [CategoryController::class, 'index']);
});
```

### 自定义 CacheProfile：精确控制缓存范围

默认的 `CacheAllSuccessfulGetRequests` 会缓存所有成功的 GET 请求，这在 B2C API 中过于粗暴。我们需要自定义：

```php
<?php

namespace App\CacheProfiles;

use Illuminate\Http\Request;
use Spatie\ResponseCache\CacheProfiles\CacheAllSuccessfulGetRequests;

class CachePublicApiRequests extends CacheAllSuccessfulGetRequests
{
    /**
     * 判断该请求是否应该被缓存
     */
    public function shouldCacheRequest(Request $request): bool
    {
        // 1. 已认证用户的请求不缓存（有个性化数据）
        if ($request->user()) {
            return false;
        }

        // 2. 只缓存特定的公开路由
        $cacheableRoutes = [
            'api.products.show',
            'api.products.index',
            'api.campaigns.show',
            'api.categories.index',
            'api.home.banners',
            'api.home.recommendations',
        ];

        $routeName = $request->route()?->getName();
        if (!in_array($routeName, $cacheableRoutes)) {
            return false;
        }

        // 3. 带查询参数的筛选请求不缓存（组合太多）
        if ($request->has(['sort', 'filter', 'page'])) {
            return false;
        }

        return parent::shouldCacheRequest($request);
    }

    /**
     * 判断该响应是否值得缓存
     */
    public function shouldCacheResponse($response): bool
    {
        // 只缓存 200 状态码
        if ($response->getStatusCode() !== 200) {
            return false;
        }

        // 响应体太小不值得缓存
        if (strlen($response->getContent()) < 100) {
            return false;
        }

        return parent::shouldCacheResponse($response);
    }
}
```

在配置文件中引用：

```php
'cache_profile' => \App\CacheProfiles\CachePublicApiRequests::class,
```

---

## 缓存失效策略：三种模式

### 模式一：手动清除（按路由/按标签）

```php
use Spatie\ResponseCache\ResponseCache;

class ProductController extends Controller
{
    public function update(UpdateProductRequest $request, Product $product)
    {
        $product->update($request->validated());

        // 清除该商品的缓存
        app(ResponseCache::class)->forget('/api/products/' . $product->slug);

        // 或清除所有商品相关的缓存（需要配合 CacheProfile 中的 cacheTags）
        app(ResponseCache::class)->forget('/api/products/*');

        return new ProductResource($product);
    }
}
```

### 模式二：事件驱动自动失效

这是我们在项目中最推荐的方式。通过 Model Observer 或 Domain Event 触发缓存清除：

```php
<?php

namespace App\Observers;

use App\Models\Product;
use Spatie\ResponseCache\ResponseCache;

class ProductObserver
{
    public function __construct(
        private ResponseCache $responseCache
    ) {}

    public function updated(Product $product): void
    {
        // 清除该商品的响应缓存
        $this->clearProductCache($product);

        // 如果商品状态变更（上架/下架），清除列表缓存
        if ($product->wasChanged('status')) {
            $this->clearProductListCache();
        }

        // 如果价格变更，清除活动页缓存
        if ($product->wasChanged('price')) {
            $this->clearCampaignCache();
        }
    }

    public function deleted(Product $product): void
    {
        $this->clearProductCache($product);
        $this->clearProductListCache();
    }

    private function clearProductCache(Product $product): void
    {
        $urls = [
            "/api/products/{$product->slug}",
            "/api/products/{$product->id}",
        ];

        foreach ($urls as $url) {
            $this->responseCache->forget($url);
        }
    }

    private function clearProductListCache(): void
    {
        $this->responseCache->forget('/api/products');
        $this->responseCache->forget('/api/categories');
    }

    private function clearCampaignCache(): void
    {
        $this->responseCache->forget('/api/home/recommendations');
    }
}
```

注册 Observer：

```php
// AppServiceProvider.php
public function boot(): void
{
    Product::observe(ProductObserver::class);
    Campaign::observe(CampaignObserver::class);
}
```

### 模式三：定时全量刷新（Cron 策略）

对于变化不频繁但影响面广的数据（如首页推荐、分类树），可以用定时任务强制刷新：

```php
// app/Console/Commands/RefreshResponseCache.php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Spatie\ResponseCache\ResponseCache;

class RefreshResponseCache extends Command
{
    protected $signature = 'response-cache:refresh {--tag= : 按标签清除}';
    protected $description = '刷新全局响应缓存';

    public function handle(ResponseCache $responseCache): int
    {
        $tag = $this->option('tag');

        if ($tag) {
            $responseCache->clear($tag);
            $this->info("已清除标签 [{$tag}] 的响应缓存");
        } else {
            $responseCache->clear();
            $this->info('已清除全部响应缓存');
        }

        // 预热关键页面
        $this->call('response-cache:warm', [
            '--url' => [
                '/api/products',
                '/api/categories',
                '/api/home/banners',
                '/api/home/recommendations',
            ],
        ]);

        return Command::SUCCESS;
    }
}
```

```bash
# 每天凌晨 3 点全量刷新 + 预热
0 3 * * * cd /var/www && php artisan response-cache:refresh
```

---

## 局部缓存：混合动态内容

全页缓存最大的挑战是：**页面中部分内容是动态的**。比如商品详情页中：

- 商品信息（低频变化）→ 可缓存
- 库存状态（高频变化）→ 不能缓存
- 促销倒计时（实时）→ 不能缓存
- 用户评价（中频变化）→ 可短期缓存

### 方案一：前端混合（API 拆分）

```javascript
// 前端请求方案：主数据走缓存 API，动态数据走实时 API
async function loadProductPage(slug) {
    // 主数据：命中 Response Cache（24h TTL）
    const product = await fetch(`/api/products/${slug}`);

    // 动态数据：不走缓存（实时查询）
    const [stock, countdown] = await Promise.all([
        fetch(`/api/products/${slug}/stock`),       // 无缓存
        fetch(`/api/products/${slug}/promotions`),   // 无缓存
    ]);

    renderPage(product, stock, countdown);
}
```

后端 Controller：

```php
class ProductController extends Controller
{
    // 主数据：走 Response Cache
    public function show(Product $product)
    {
        return new ProductResource($product->load('category', 'images', 'specifications'));
    }
}

class ProductStockController extends Controller
{
    // 库存：不走缓存，实时查询
    public function show(Product $product)
    {
        return response()->json([
            'stock' => $product->availableStock(),
            'warehouse' => $product->nearestWarehouse(),
        ])->header('Cache-Control', 'no-store');
    }
}
```

### 方案二：Cache-Control 指令分层

```php
class ProductController extends Controller
{
    public function show(Product $product)
    {
        $response = new ProductResource($product->load('category', 'images'));

        // 根据数据新鲜度设置不同的缓存策略
        if ($product->isHotDeal()) {
            // 热卖商品：短缓存，支持 stale-while-revalidate
            return $response->withHeaders([
                'Cache-Control' => 'public, max-age=60, stale-while-revalidate=300',
            ]);
        }

        // 普通商品：长缓存
        return $response->withHeaders([
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }
}
```

### 方案三：ESI 思路（Edge-Side Includes 概念）

虽然 Laravel 不原生支持 ESI，但我们可以用类似思路，在 Middleware 层面注入动态片段：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class InjectDynamicContent
{
    /**
     * 在 Response Cache 返回后，替换占位符为动态内容
     */
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        if (!$response instanceof \Illuminate\Http\Response) {
            return $response;
        }

        $content = $response->getContent();

        // 检测缓存响应中的占位符并替换为实时数据
        if (str_contains($content, '{{STOCK_PLACEHOLDER}}')) {
            $productId = $request->route('product')?->id;
            if ($productId) {
                $stock = cache()->remember("stock:{$productId}", 10, function () use ($productId) {
                    return \App\Models\Product::find($productId)->availableStock();
                });
                $content = str_replace('{{STOCK_PLACEHOLDER}}', $stock, $content);
            }
        }

        $response->setContent($content);
        return $response;
    }
}
```

> **注意**：这种方式只适用于 Blade 渲染的页面。对于纯 JSON API，方案一（前端混合）是更好的选择。

---

## 认证用户的缓存隔离

### 问题描述

在 B2C 场景中，同一个 API 端点对不同用户可能返回不同数据：

```php
// GET /api/products/{slug}
// - 未登录用户：看到标准价格
// - VIP 会员：看到会员折扣价
// - 已登录普通用户：看到个性化推荐
```

如果不对用户做隔离，Response Cache 可能把 A 用户的个性化数据返回给 B 用户。

### 解决方案：按用户特征构建缓存标识

```php
<?php

namespace App\CacheProfiles;

use Illuminate\Http\Request;
use Spatie\ResponseCache\CacheProfiles\CacheAllSuccessfulGetRequests;

class UserAwareCacheProfile extends CacheAllSuccessfulGetRequests
{
    /**
     * 基于请求构建缓存标识
     * 默认只用 URL + HTTP 方法，我们需要加入用户特征
     */
    protected function useCacheNameSuffix(Request $request): string
    {
        $parts = [];

        // 1. 用户角色标识（不存 user_id，避免缓存碎片化）
        if ($user = $request->user()) {
            $parts[] = 'role_' . $user->role; // 'guest', 'member', 'vip'
        } else {
            $parts[] = 'guest';
        }

        // 2. 地区/语言（多语言站点）
        $parts[] = 'locale_' . app()->getLocale();

        // 3. 币种（价格不同）
        if ($currency = $request->header('X-Currency')) {
            $parts[] = 'currency_' . $currency;
        }

        return implode('_', $parts);
    }
}
```

这样，同一个 URL 会根据用户角色、语言、币种生成不同的缓存 Key：

```
responsecache:GET:/api/products/bali-tour:role_vip_locale_zh-TW_currency_TWD
responsecache:GET:/api/products/bali-tour:guest_locale_en_US_currency_USD
```

### 更激进的方案：VIP 不走 Response Cache

在我们的实际项目中，VIP 用户只占总流量的 5-10%，但他们的数据变化频率高（个性化推荐、专属价格）。对 VIP 用户直接跳过 Response Cache，用 Application Cache 处理：

```php
public function shouldCacheRequest(Request $request): bool
{
    // VIP 用户不走 Response Cache
    if ($request->user()?->isVip()) {
        return false;
    }

    return parent::shouldCacheRequest($request);
}
```

---

## 生产环境踩坑全记录

### 踩坑 1：缓存序列化导致数据丢失

**现象**：某些 API 响应缓存后，再次读取时 JSON 中的 `null` 变成了空字符串 `""`。

**根因**：PHP 的 `serialize()` 会保留类型信息，但某些缓存驱动（如 APCu）在反序列化时可能丢失 `null` 类型。

**解决**：统一使用 Redis 作为 Response Cache 的存储驱动：

```php
// config/responsecache.php
'cache_store' => 'redis',

// config/database.php 中确保 Redis 配置正确
'redis' => [
    'response-cache' => [
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', 6379),
        'database' => 3, // 专用数据库，避免和业务 Redis 混用
    ],
],
```

### 踩坑 2：中间件顺序导致缓存了错误内容

**现象**：商品详情页缓存了「已下架」状态的商品数据，但数据库中商品已上架。

**根因**：中间件执行顺序问题。`CacheResponse` 在 `VerifyCsrfToken` 之后，但商品状态检查的 Middleware 在 `CacheResponse` 之后，导致缓存了未做状态校验的响应。

**解决**：`CacheResponse` 必须放在所有业务中间件之后：

```php
// app/Http/Kernel.php
protected $middlewareGroups = [
    'api' => [
        // 先执行这些
        \App\Http\Middleware\VerifyApiToken::class,
        \App\Http\Middleware\CheckProductStatus::class,
        \App\Http\Middleware\SetLocale::class,
        \App\Http\Middleware\TrackAnalytics::class,

        // 最后才执行缓存（这样缓存的是经过所有中间件处理后的最终响应）
        \Spatie\ResponseCache\Middlewares\CacheResponse::class,
    ],
];
```

### 踩坑 3：缓存雪崩——定时刷新时所有缓存同时失效

**现象**：凌晨 3 点定时任务清空全部缓存后，瞬间涌入的请求全部打到数据库，DB CPU 飙到 90%。

**解决**：分批清除 + 预热 + 随机过期时间：

```php
// app/Console/Commands/RefreshResponseCache.php
public function handle(ResponseCache $responseCache): int
{
    $urls = $this->getCacheableUrls();

    // 分批清除，每批间隔 30 秒
    foreach (array_chunk($urls, 10) as $batch) {
        foreach ($batch as $url) {
            $responseCache->forget($url);
        }

        // 预热这一批
        foreach ($batch as $url) {
            $this->warmUrl($url);
        }

        sleep(30);
    }

    return Command::SUCCESS;
}

private function warmUrl(string $url): void
{
    try {
        Http::timeout(5)->get(config('app.url') . $url);
    } catch (\Exception $e) {
        logger()->warning("预热失败: {$url}", ['error' => $e->getMessage()]);
    }
}
```

加入随机 jitter 的 TTL：

```php
// config/responsecache.php
'cache_lifetime_in_minutes' => function () {
    // 基础 TTL 24 小时，随机 ±2 小时，避免缓存同时过期
    $base = 60 * 24;
    $jitter = random_int(-120, 120);
    return $base + $jitter;
},
```

### 踩坑 4：调试时忘记清除缓存

**现象**：修改了 Controller 代码，但 API 返回的还是旧数据。

**根因**：Response Cache 缓存了完整的 HTTP 响应，修改代码不会自动清除缓存。

**解决**：

```php
// 开发环境禁用 Response Cache
// config/responsecache.php
'enabled' => !app()->isLocal(),

// 或者在路由中用中间件参数控制
Route::middleware(['cacheResponse:0'])->group(function () {
    // TTL 为 0 表示不缓存
});

// 部署脚本中加入缓存清除
// deploy.sh
php artisan response-cache:clear
php artisan config:cache
php artisan route:cache
```

### 踩坑 5：Vary Header 导致 CDN 缓存碎片化

**现象**：同一个商品页面在 CDN 层面产生了 200+ 个缓存版本，命中率极低。

**根因**：Response Cache 添加了 `Vary: Accept, Accept-Encoding, Accept-Language, Authorization`，而 CDN 根据 Vary 头为每个组合创建独立缓存。

**解决**：

```php
// 在 Response 中覆盖 Vary Header
class SanitizeVaryHeader
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        if ($response instanceof Response) {
            // 只保留必要的 Vary 字段
            $response->headers->set('Vary', 'Accept-Encoding, Accept-Language');
        }

        return $response;
    }
}
```

---

## 性能对比数据

在 KKday 商品详情页 API 上的实测数据（QPS = 1000，并发 50）：

| 指标 | 无缓存 | Application Cache (Query) | Response Cache |
|------|--------|--------------------------|----------------|
| 平均响应时间 | 180ms | 45ms | 8ms |
| P99 响应时间 | 520ms | 120ms | 25ms |
| DB 查询数/请求 | 12 | 3 | 0 |
| PHP 内存占用/请求 | 18MB | 12MB | 4MB |
| CPU 使用率 | 75% | 35% | 12% |

**Response Cache 比 Application Cache 快 5-6 倍**，因为它跳过了整个 Laravel Pipeline（Middleware、Controller、Service 都不执行）。

---

## 总结：缓存策略选型矩阵

| 场景 | 推荐方案 | TTL | 原因 |
|------|---------|-----|------|
| 首页/活动页 | Response Cache | 1-4h | 高访问量、低变化频率 |
| 商品详情（公开） | Response Cache | 30min-1h | 核心页面、流量大 |
| 商品列表（筛选） | Application Cache | 5-15min | 参数组合多、缓存碎片化 |
| 搜索结果 | 不缓存 / Application Cache | 0-5min | 个性化强 |
| 用户中心 | 不缓存 | - | 完全个人数据 |
| 库存/价格 | 不缓存 + CDN 短缓存 | 10-30s | 实时性要求高 |

**核心原则**：先在 CDN 层拦截，拦截不住的到 Response Cache，Response Cache 拦截不住的到 Application Cache，最后才是直接查数据库。每一层都是下一层的「保镖」。

---

*本文基于 KKday B2C API 项目实战经验，涵盖了 spatie/laravel-response-cache 的配置、自定义 CacheProfile、缓存失效策略、局部缓存方案、认证用户隔离以及生产环境的 5 个经典踩坑。Response Cache 不是银弹，但在高并发的公开页面场景下，它能带来显著的性能提升。*
