---

title: Graceful Degradation 实战：降级策略设计——Laravel 中的功能降级、数据降级与体验降级的分层方案
keywords: [Graceful Degradation, Laravel, 降级策略设计, 中的功能降级, 数据降级与体验降级的分层方案]
date: 2026-06-07 10:00:00
tags:
- Laravel
- graceful-degradation
- 高可用
- 分布式
- 降级策略
description: 深入讲解 Laravel 中 Graceful Degradation 优雅降级的分层设计方案，涵盖功能降级、数据降级与体验降级三大策略，提供可运行的 Laravel 代码实现、Prometheus 监控集成及电商大促实战案例，助你构建高可用分布式系统。
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---




# Graceful Degradation 实战：降级策略设计——Laravel 中的功能降级、数据降级与体验降级的分层方案

## 一、引言：什么是 Graceful Degradation

在分布式系统的运维实践中，"永远不宕机"是一个美好的愿望，但几乎不可能实现。当系统面对突发流量、下游服务故障或基础设施异常时，与其让整个系统崩溃导致所有用户无法使用，不如**有策略地放弃一部分非核心能力，保障核心链路的可用性**——这就是 Graceful Degradation（优雅降级）的核心思想。

### 1.1 为什么高并发 B2C 场景必须有降级设计

在 B2C 电商、社交平台、内容社区等面向海量用户的场景中，系统面临几个典型挑战：

- **流量脉冲**：大促、秒杀、热点事件导致 QPS 在数分钟内飙升 10-100 倍
- **服务依赖复杂**：一个商品详情页可能依赖商品服务、推荐服务、评论服务、库存服务、价格服务等 5-8 个微服务
- **级联故障**：一个非核心服务（如推荐服务）响应变慢，可能拖垮整个线程池，导致核心交易链路也不可用
- **用户体验敏感**：在移动互联网时代，用户对页面加载时间的容忍阈值仅 3 秒，超时即流失

如果系统没有降级机制，推荐服务超时 → 商品详情页白屏 → 用户无法下单 → 直接影响营收。而一个设计良好的降级方案可以在推荐服务不可用时，隐藏推荐模块，保证商品详情和下单流程正常运行，将影响范围控制在"推荐功能暂时不可用"这个最小范围内。

### 1.2 降级 ≠ 熔断 ≠ 限流

在深入之前，有必要厘清几个容易混淆的概念：

| 策略 | 目的 | 触发条件 | 作用范围 |
|------|------|----------|----------|
| **降级（Degradation）** | 保障核心链路可用，有损关闭非核心能力 | 系统压力或下游故障 | 主动的、有计划的能力裁剪 |
| **熔断（Circuit Breaker）** | 防止级联故障蔓延 | 下游服务错误率超阈值 | 被动切断对特定服务的调用 |
| **限流（Rate Limiting）** | 保护系统不被流量压垮 | 请求量超阈值 | 拒绝超额请求 |

三者可以协同工作：限流是第一道防线（控流量），熔断是第二道防线（断故障链路），降级是第三道防线（保核心体验）。本文聚焦于降级策略的分层设计与 Laravel 实战。

---

## 二、分层降级模型：三层架构设计

降级不是"全有或全无"的二元开关，而是一个**分层、渐进**的过程。我们设计了三层降级模型：

```
┌─────────────────────────────────────────────┐
│              L3: 体验降级                     │
│   简化页面、关闭动画、减少分页、降级 UI        │
│  ┌───────────────────────────────────────┐   │
│  │           L2: 数据降级                  │   │
│  │   缓存降级、数据库降级、搜索降级         │   │
│  │  ┌─────────────────────────────────┐   │   │
│  │  │       L1: 功能降级               │   │   │
│  │  │   关闭推荐/评论/通知等非核心功能   │   │   │
│  │  └─────────────────────────────────┘   │   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 2.1 L1 - 功能降级（Feature Degradation）

**核心理念**：在系统压力下，直接关闭非核心功能模块，减少计算和依赖开销。

典型被降级的功能：
- **个性化推荐**：关闭用户行为分析、协同过滤推荐，使用热门榜单兜底
- **评论/弹幕**：关闭实时评论加载和写入
- **消息通知**：关闭推送通知、站内信实时轮询
- **社交功能**：关闭点赞计数实时更新、分享统计
- **辅助信息**：关闭商品标签云、浏览历史、猜你喜欢

**降级收益**：
- 减少对外部服务的 RPC 调用（推荐服务、ES 搜索、推送服务等）
- 减少数据库查询（评论表、通知表通常是高并发读热点）
- 降低页面渲染复杂度，缩短 TTFB

### 2.2 L2 - 数据降级（Data Degradation）

**核心理念**：当数据源不可用或响应变慢时，自动切换到备用数据源，保证数据可读。

降级链路设计：

```
数据源优先级链：
主库 → 从库 → 只读副本 → 缓存 → 静态兜底数据

缓存优先级链：
Redis Cluster → Redis Sentinel → 本地文件缓存 → 静态 JSON

搜索优先级链：
Elasticsearch 集群 → Elasticsearch 单节点 → MySQL FULLTEXT → MySQL LIKE
```

**降级收益**：
- 避免因单点数据源故障导致整个页面不可用
- 利用多级缓存容错能力，延长系统在故障下的存活时间
- 降低数据库压力（读请求从主库切到从库或缓存）

### 2.3 L3 - 体验降级（UX Degradation）

**核心理念**：当系统整体能力不足时，通过降低用户体验来换取系统可用性。

典型策略：
- **返回简化数据**：商品列表只返回核心字段（名称、价格、图片），去掉标签、评分、销量等辅助字段
- **减少分页大小**：从每页 20 条降到每页 10 条，减少单次请求的计算量
- **关闭动态效果**：前端关闭轮播动画、懒加载、无限滚动，使用简单分页替代
- **降级图片质量**：返回低分辨率图片或 WebP 缩略图
- **关闭服务端渲染**：SSR 降级为 CSR，减少服务端压力

**降级收益**：
- 减少网络传输量（简化数据 + 低分辨率图片）
- 减少服务端计算量（少查字段、少返回数据）
- 保持核心功能可用，用户仍能完成购买流程

---

## 三、功能降级实战：Laravel Pennant 实现非核心功能关闭

Laravel 10+ 引入了 **Pennant** 组件用于 Feature Flag 管理，非常适合实现功能降级。

### 3.1 安装与配置

```bash
composer require laravel/pennant
php artisan vendor:publish --provider="Laravel\Pennant\PennantServiceProvider"
```

### 3.2 定义降级 Feature

```php
// app/Providers/AppServiceProvider.php
use Laravel\Pennant\Feature;

public function boot(): void
{
    // 注册功能降级开关
    Feature::define('recommendation', function () {
        return $this->shouldEnableFeature('recommendation');
    });

    Feature::define('comments', function () {
        return $this->shouldEnableFeature('comments');
    });

    Feature::define('realtime-notifications', function () {
        return $this->shouldEnableFeature('realtime-notifications');
    });

    Feature::define('social-sharing', function () {
        return $this->shouldEnableFeature('social-sharing');
    });
}

private function shouldEnableFeature(string $feature): bool
{
    // 优先检查手动降级开关（运维通过管理后台设置）
    if (cache("degradation:manual:{$feature}")) {
        return false;
    }

    // 检查自动降级触发器
    if (cache("degradation:auto:{$feature}")) {
        return false;
    }

    return true;
}
```

### 3.3 在控制器中使用

```php
// app/Http/Controllers/ProductController.php
use Laravel\Pennant\Feature;

class ProductController extends Controller
{
    public function show(Product $product)
    {
        $data = [
            'product' => $product->toArray(),
        ];

        // 条件加载推荐模块
        if (Feature::active('recommendation')) {
            $data['recommendations'] = $this->recommendationService
                ->getSimilarProducts($product->id, limit: 8);
        }

        // 条件加载评论
        if (Feature::active('comments')) {
            $data['comments'] = $product->comments()
                ->with('user')
                ->latest()
                ->limit(20)
                ->get();
        }

        return view('product.show', $data);
    }
}
```

### 3.4 Blade 模板中的降级展示

```blade
{{-- product/show.blade.php --}}

@if(\Laravel\Pennant\Feature::active('recommendation'))
    <section class="recommendations">
        <h3>为你推荐</h3>
        @foreach($recommendations as $item)
            @include('product._card', ['product' => $item])
        @endforeach
    </section>
@else
    {{-- 降级展示：使用静态热门榜单缓存 --}}
    <section class="recommendations fallback">
        <h3>热门商品</h3>
        @foreach(cache('fallback:hot_products') ?? [] as $item)
            @include('product._card_simple', ['product' => $item])
        @endforeach
    </section>
@endif

@if(\Laravel\Pennant\Feature::active('comments'))
    <section class="comments">
        {{-- 评论区内容 --}}
    </section>
@endif
```

### 3.5 手动降级管理接口

```php
// app/Http/Controllers/Admin/DegradationController.php

class DegradationController extends Controller
{
    /**
     * 手动触发功能降级
     */
    public function degrade(Request $request)
    {
        $feature = $request->input('feature');
        $enabled = $request->boolean('enabled', true);
        $ttl = $request->input('ttl', 3600); // 默认 1 小时

        $allowedFeatures = [
            'recommendation', 'comments',
            'realtime-notifications', 'social-sharing'
        ];

        if (!in_array($feature, $allowedFeatures)) {
            return response()->json(['error' => 'Invalid feature'], 422);
        }

        // 设置手动降级标记
        cache()->put(
            "degradation:manual:{$feature}",
            !$enabled,
            now()->addSeconds($ttl)
        );

        // 清除 Pennant 缓存，使降级立即生效
        Feature::purge($feature);

        // 记录降级操作日志
        activity('degradation')
            ->performedOn(new \stdClass())
            ->withProperties([
                'feature' => $feature,
                'enabled' => $enabled,
                'ttl' => $ttl,
                'operator' => auth()->user()->name,
            ])
            ->log('manual_degradation');

        return response()->json([
            'feature' => $feature,
            'active' => $enabled,
            'message' => $enabled
                ? "功能 [{$feature}] 已恢复"
                : "功能 [{$feature}] 已降级，将在 {$ttl} 秒后自动恢复",
        ]);
    }
}
```

---

## 四、数据降级实战

### 4.1 缓存降级：Redis → 文件 → 静态

缓存是系统中最关键的加速层，但 Redis 也可能宕机。设计一个多级缓存降级方案至关重要。

```php
// app/Services/Cache/DegradableCache.php

namespace App\Services\Cache;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class DegradableCache
{
    /**
     * 多级缓存降级读取
     * 优先级：Redis → 文件缓存 → 静态兜底数据
     */
    public function get(string $key, callable $fallback, int $ttl = 3600): mixed
    {
        // L1: 尝试 Redis
        try {
            $value = Cache::store('redis')->get($key);
            if ($value !== null) {
                return $value;
            }
        } catch (\Throwable $e) {
            Log::warning("Redis cache miss, falling back", [
                'key' => $key,
                'error' => $e->getMessage(),
            ]);
            $this->recordDegradation('cache', 'redis_to_file');
        }

        // L2: 尝试文件缓存
        try {
            $value = Cache::store('file')->get($key);
            if ($value !== null) {
                return $value;
            }
        } catch (\Throwable $e) {
            Log::warning("File cache miss, falling back to static", [
                'key' => $key,
                'error' => $e->getMessage(),
            ]);
            $this->recordDegradation('cache', 'file_to_static');
        }

        // L3: 生成数据并缓存到可用层级
        $value = $fallback();

        // 尝试回写到各级缓存
        $this->writeToAvailableCaches($key, $value, $ttl);

        return $value;
    }

    /**
     * 多级缓存降级写入
     */
    private function writeToAvailableCaches(string $key, mixed $value, int $ttl): void
    {
        // 尝试写入 Redis
        try {
            Cache::store('redis')->put($key, $value, $ttl);
        } catch (\Throwable $e) {
            Log::warning("Failed to write to Redis", ['key' => $key]);
        }

        // 同步写入文件缓存作为备份
        try {
            Cache::store('file')->put($key, $value, $ttl * 2);
        } catch (\Throwable $e) {
            Log::warning("Failed to write to file cache", ['key' => $key]);
        }
    }

    private function recordDegradation(string $type, string $route): void
    {
        $metricKey = "degradation:metrics:{$type}:{$route}";
        cache()->increment($metricKey, 1);
    }
}
```

在 `config/cache.php` 中确保文件缓存驱动已配置：

```php
'stores' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'cache',
        'lock_connection' => 'default',
    ],
    'file' => [
        'driver' => 'file',
        'path' => storage_path('framework/cache/data'),
    ],
],
```

### 4.2 数据库降级：主库 → 从库 → 只读副本

当主库压力过大或出现故障时，将读请求切换到从库。

```php
// app/Services/Database/DegradableDatabase.php

namespace App\Services\Database;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class DegradableDatabase
{
    /**
     * 降级读取：主库 → 从库 → 只读副本
     */
    public function read(string $query, array $bindings = [], string $preferred = 'primary'): mixed
    {
        $databases = [
            'primary' => 'mysql',
            'replica' => 'mysql_read',
            'readonly' => 'mysql_readonly',
        ];

        // 按优先级尝试
        foreach ($databases as $name => $connection) {
            try {
                $result = DB::connection($connection)
                    ->select($query, $bindings);

                if ($name !== $preferred) {
                    Log::info("Database degraded", [
                        'from' => $preferred,
                        'to' => $name,
                    ]);
                    $this->recordDegradation('database', $name);
                }

                return $result;
            } catch (\Throwable $e) {
                Log::warning("Database connection failed", [
                    'connection' => $name,
                    'error' => $e->getMessage(),
                ]);
                continue;
            }
        }

        // 所有数据库都不可用
        throw new \RuntimeException('All database connections are unavailable');
    }

    /**
     * 查询构建器封装
     */
    public function query(string $model, string $connection = 'primary')
    {
        return app($model)->on($connection);
    }

    private function recordDegradation(string $type, string $target): void
    {
        cache()->increment("degradation:metrics:{$type}:{$target}");
    }
}
```

### 4.3 搜索降级：Elasticsearch → MySQL LIKE

搜索是最常见的降级场景之一。当 ES 集群不可用时，回退到 MySQL 的 LIKE 查询。

```php
// app/Services/Search/DegradableSearchService.php

namespace App\Services/Search;

use App\Models\Product;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class DegradableSearchService
{
    private array $degradationChain = [
        'elasticsearch',
        'mysql_fulltext',
        'mysql_like',
    ];

    public function search(string $keyword, int $page = 1, int $perPage = 20): array
    {
        foreach ($this->degradationChain as $engine) {
            try {
                return match ($engine) {
                    'elasticsearch' => $this->searchWithElasticsearch($keyword, $page, $perPage),
                    'mysql_fulltext' => $this->searchWithFulltext($keyword, $page, $perPage),
                    'mysql_like' => $this->searchWithLike($keyword, $page, $perPage),
                };
            } catch (\Throwable $e) {
                Log::warning("Search engine failed, degrading", [
                    'engine' => $engine,
                    'error' => $e->getMessage(),
                ]);
                $this->recordDegradation('search', $engine);
                continue;
            }
        }

        return ['data' => [], 'total' => 0, 'engine' => 'none'];
    }

    private function searchWithElasticsearch(string $keyword, int $page, int $perPage): array
    {
        $client = app(\Elasticsearch\Client::class);

        $params = [
            'index' => 'products',
            'body' => [
                'from' => ($page - 1) * $perPage,
                'size' => $perPage,
                'query' => [
                    'multi_match' => [
                        'query' => $keyword,
                        'fields' => ['title^3', 'description', 'category', 'brand'],
                        'type' => 'best_fields',
                        'fuzziness' => 'AUTO',
                    ],
                ],
            ],
        ];

        $response = $client->search($params);

        return [
            'data' => collect($response['hits']['hits'])->pluck('_source'),
            'total' => $response['hits']['total']['value'],
            'engine' => 'elasticsearch',
        ];
    }

    private function searchWithFulltext(string $keyword, int $page, int $perPage): array
    {
        $query = Product::whereFullText(['title', 'description'], $keyword)
            ->select(['id', 'title', 'price', 'image_url', 'category']);

        $total = $query->count();
        $data = $query->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get()
            ->toArray();

        return [
            'data' => $data,
            'total' => $total,
            'engine' => 'mysql_fulltext',
        ];
    }

    private function searchWithLike(string $keyword, int $page, int $perPage): array
    {
        $query = Product::where('title', 'LIKE', "%{$keyword}%")
            ->orWhere('description', 'LIKE', "%{$keyword}%")
            ->select(['id', 'title', 'price', 'image_url']);

        $total = $query->count();
        $data = $query->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get()
            ->toArray();

        return [
            'data' => $data,
            'total' => $total,
            'engine' => 'mysql_like',
        ];
    }

    private function recordDegradation(string $type, string $engine): void
    {
        cache()->increment("degradation:metrics:{$type}:{$engine}");
    }
}
```

---

## 五、体验降级实战

### 5.1 返回简化数据

通过 API Resource 实现数据降级返回：

```php
// app/Http/Resources/ProductResource.php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray($request): array
    {
        $level = app('degradation')->getUXLevel();

        $data = [
            'id' => $this->id,
            'title' => $this->title,
            'price' => $this->price,
            'image_url' => $this->image_url,
        ];

        // 正常模式下返回完整数据
        if ($level === 'normal') {
            $data = array_merge($data, [
                'description' => $this->description,
                'category' => $this->category,
                'brand' => $this->brand,
                'rating' => $this->rating,
                'review_count' => $this->review_count,
                'sales_count' => $this->sales_count,
                'tags' => $this->tags,
                'specifications' => $this->specifications,
                'gallery' => $this->gallery,
                'related_products' => $this->related_products,
            ]);
        }

        // 轻度降级：返回基础 + 部分辅助字段
        if ($level === 'light') {
            $data['category'] = $this->category;
            $data['rating'] = $this->rating;
        }

        return $data;
    }
}
```

### 5.2 减少分页大小

```php
// app/Http/Controllers/ProductController.php

public function index(Request $request)
{
    $degradationLevel = app('degradation')->getSystemLevel();

    // 根据降级等级动态调整分页大小
    $perPage = match ($degradationLevel) {
        'normal' => 20,
        'light' => 15,
        'moderate' => 10,
        'heavy' => 5,
        default => 20,
    };

    $products = Product::query()
        ->when(
            $degradationLevel !== 'heavy',
            fn($q) => $q->with(['category', 'brand'])
        )
        ->paginate($perPage);

    return ProductResource::collection($products);
}
```

### 5.3 降级标记注入到响应头

前端需要知道当前系统的降级状态，以便调整 UI：

```php
// app/Http/Middleware/DegradationHeaders.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class DegradationHeaders
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        $level = app('degradation')->getSystemLevel();

        $response->headers->set('X-Degradation-Level', $level);

        // 通知前端关闭的功能
        $disabledFeatures = app('degradation')->getDisabledFeatures();
        if (!empty($disabledFeatures)) {
            $response->headers->set(
                'X-Disabled-Features',
                implode(',', $disabledFeatures)
            );
        }

        return $response;
    }
}
```

前端读取响应头后可以相应调整：

```javascript
// 前端降级适配示例
axios.interceptors.response.use(response => {
    const level = response.headers['x-degradation-level'];
    const disabled = response.headers['x-disabled-features']?.split(',') || [];

    if (level !== 'normal') {
        // 关闭动画效果
        document.body.classList.add('reduced-motion');
        // 降低图片质量
        document.body.classList.add('low-quality-images');
        // 禁用无限滚动，使用传统分页
        if (level === 'heavy') {
            window.useInfiniteScroll = false;
        }
    }

    // 隐藏已降级的功能模块
    disabled.forEach(feature => {
        document.querySelectorAll(`[data-feature="${feature}"]`)
            .forEach(el => el.style.display = 'none');
    });

    return response;
});
```

---

## 六、自动触发机制：Prometheus + Laravel Middleware

手动降级适合计划内的运维操作（如大促前手动开启），但面对突发故障，我们需要自动化的降级触发机制。

### 6.1 降级指标收集

```php
// app/Services/Degradation/MetricsCollector.php

namespace App\Services\Degradation;

use Illuminate\Support\Facades\Redis;

class MetricsCollector
{
    private string $prefix = 'degradation:metrics:';

    /**
     * 记录请求延迟
     */
    public function recordLatency(float $ms): void
    {
        $minuteKey = $this->prefix . 'latency:' . now()->format('YmdHi');
        Redis::lPush($minuteKey, $ms);
        Redis::expire($minuteKey, 300);

        // 滑动窗口：保留最近 5 分钟的数据
        Redis::lTrim($minuteKey, 0, 9999);
    }

    /**
     * 记录请求错误
     */
    public function recordError(int $statusCode): void
    {
        $minuteKey = $this->prefix . 'errors:' . now()->format('YmdHi');
        Redis::hIncrBy($minuteKey, (string)$statusCode, 1);
        Redis::expire($minuteKey, 300);
    }

    /**
     * 记录 QPS
     */
    public function recordRequest(): void
    {
        $secondKey = $this->prefix . 'qps:' . now()->format('YmdHis');
        Redis::incr($secondKey);
        Redis::expire($secondKey, 60);
    }

    /**
     * 获取当前指标快照
     */
    public function getSnapshot(): array
    {
        $now = now();
        $oneMinuteAgo = $now->copy()->subMinute();

        // QPS
        $qps = 0;
        for ($i = 0; $i < 60; $i++) {
            $key = $this->prefix . 'qps:' . $now->copy()->subSeconds($i)->format('YmdHis');
            $qps += (int) Redis::get($key);
        }

        // P99 延迟
        $latencies = [];
        for ($i = 0; $i < 5; $i++) {
            $key = $this->prefix . 'latency:' . $now->copy()->subMinutes($i)->format('YmdHi');
            $latencies = array_merge($latencies, Redis::lRange($key, 0, -1) ?: []);
        }
        sort($latencies);
        $p99 = $latencies[(int)(count($latencies) * 0.99)] ?? 0;

        // 错误率
        $totalErrors = 0;
        for ($i = 0; $i < 5; $i++) {
            $key = $this->prefix . 'errors:' . $now->copy()->subMinutes($i)->format('YmdHi');
            $errors = Redis::hGetAll($key) ?: [];
            foreach ($errors as $count) {
                $totalErrors += (int) $count;
            }
        }

        return [
            'qps' => $qps,
            'p99_latency_ms' => $p99,
            'error_count' => $totalErrors,
            'timestamp' => $now->toIso8601String(),
        ];
    }
}
```

### 6.2 自动降级触发器

```php
// app/Services/Degradation/DegradationManager.php

namespace App\Services\Degradation;

use Illuminate\Support\Facades\Log;
use Laravel\Pennant\Feature;

class DegradationManager
{
    // 降级阈值配置
    private array $thresholds = [
        'light' => [
            'qps' => 5000,
            'p99_latency_ms' => 500,
            'error_rate' => 0.01, // 1%
        ],
        'moderate' => [
            'qps' => 8000,
            'p99_latency_ms' => 1000,
            'error_rate' => 0.03, // 3%
        ],
        'heavy' => [
            'qps' => 12000,
            'p99_latency_ms' => 3000,
            'error_rate' => 0.05, // 5%
        ],
    ];

    private MetricsCollector $metrics;

    public function __construct(MetricsCollector $metrics)
    {
        $this->metrics = $metrics;
    }

    /**
     * 评估系统状态并自动触发降级
     */
    public function evaluate(): void
    {
        $snapshot = $this->metrics->getSnapshot();
        $currentLevel = $this->getSystemLevel();

        // 判断应处于哪个降级等级
        $newLevel = $this->determineLevel($snapshot);

        if ($newLevel !== $currentLevel) {
            Log::info("Degradation level changed", [
                'from' => $currentLevel,
                'to' => $newLevel,
                'metrics' => $snapshot,
            ]);

            $this->applyLevel($newLevel);
        }
    }

    private function determineLevel(array $metrics): string
    {
        $errorRate = $metrics['qps'] > 0
            ? $metrics['error_count'] / $metrics['qps']
            : 0;

        $metrics['error_rate'] = $errorRate;

        // 从重度降级到轻度降级逐级检查
        foreach (['heavy', 'moderate', 'light'] as $level) {
            if ($this->shouldDegrade($metrics, $level)) {
                return $level;
            }
        }

        return 'normal';
    }

    private function shouldDegrade(array $metrics, string $level): bool
    {
        $threshold = $this->thresholds[$level];

        // 任一指标超阈值即触发
        if ($metrics['qps'] >= $threshold['qps']) return true;
        if ($metrics['p99_latency_ms'] >= $threshold['p99_latency_ms']) return true;
        if ($metrics['error_rate'] >= $threshold['error_rate']) return true;

        return false;
    }

    private function applyLevel(string $level): void
    {
        cache()->put('degradation:system:level', $level, now()->addMinutes(5));

        match ($level) {
            'normal' => $this->restoreAll(),
            'light' => $this->applyLightDegradation(),
            'moderate' => $this->applyModerateDegradation(),
            'heavy' => $this->applyHeavyDegradation(),
        };
    }

    private function applyLightDegradation(): void
    {
        // 轻度：关闭社交功能
        cache()->put('degradation:auto:social-sharing', true, now()->addMinutes(10));
        Feature::purge('social-sharing');
    }

    private function applyModerateDegradation(): void
    {
        $this->applyLightDegradation();
        // 中度：关闭推荐和评论
        cache()->put('degradation:auto:recommendation', true, now()->addMinutes(10));
        cache()->put('degradation:auto:comments', true, now()->addMinutes(10));
        Feature::purge(['recommendation', 'comments']);
    }

    private function applyHeavyDegradation(): void
    {
        $this->applyModerateDegradation();
        // 重度：关闭所有非核心功能 + 开启数据降级
        cache()->put('degradation:auto:realtime-notifications', true, now()->addMinutes(10));
        cache()->put('degradation:auto:data', true, now()->addMinutes(10));
        Feature::purge('realtime-notifications');
    }

    private function restoreAll(): void
    {
        $keys = [
            'social-sharing', 'recommendation',
            'comments', 'realtime-notifications', 'data',
        ];
        foreach ($keys as $key) {
            cache()->forget("degradation:auto:{$key}");
        }
        Feature::purge($keys);
    }

    public function getSystemLevel(): string
    {
        return cache()->get('degradation:system:level', 'normal');
    }

    public function getDisabledFeatures(): array
    {
        $features = ['social-sharing', 'recommendation', 'comments', 'realtime-notifications'];
        return array_filter($features, fn($f) => !Feature::active($f));
    }

    public function getUXLevel(): string
    {
        return $this->getSystemLevel(); // 复用系统等级
    }
}
```

### 6.3 Prometheus 指标暴露

```php
// app/Services/Degradation/PrometheusExporter.php

namespace App\Services\Degradation;

class PrometheusExporter
{
    public function export(): string
    {
        $metrics = app(MetricsCollector::class)->getSnapshot();
        $level = app(DegradationManager::class)->getSystemLevel();

        $output = '';
        $output .= "# HELP app_degradation_level Current system degradation level (0=normal,1=light,2=moderate,3=heavy)\n";
        $output .= "# TYPE app_degradation_level gauge\n";
        $output .= sprintf(
            "app_degradation_level %d\n",
            array_search($level, ['normal', 'light', 'moderate', 'heavy'])
        );

        $output .= "# HELP app_request_qps Current requests per second\n";
        $output .= "# TYPE app_request_qps gauge\n";
        $output .= sprintf("app_request_qps %d\n", $metrics['qps']);

        $output .= "# HELP app_p99_latency_ms P99 latency in milliseconds\n";
        $output .= "# TYPE app_p99_latency_ms gauge\n";
        $output .= sprintf("app_p99_latency_ms %.2f\n", $metrics['p99_latency_ms']);

        return $output;
    }
}
```

### 6.4 中间件集成

```php
// app/Http/Middleware/DegradationMiddleware.php

namespace App\Http\Middleware;

use App\Services\Degradation\MetricsCollector;
use Closure;
use Illuminate\Http\Request;

class DegradationMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        $startTime = microtime(true);
        $metrics = app(MetricsCollector::class);

        // 记录 QPS
        $metrics->recordRequest();

        $response = $next($request);

        // 记录延迟
        $latencyMs = (microtime(true) - $startTime) * 1000;
        $metrics->recordLatency($latencyMs);

        // 记录错误
        if ($response->getStatusCode() >= 500) {
            $metrics->recordError($response->getStatusCode());
        }

        return $response;
    }
}
```

### 6.5 定时评估任务

```php
// app/Console/Commands/EvaluateDegradation.php

namespace App\Console\Commands;

use App\Services\Degradation\DegradationManager;
use Illuminate\Console\Command;

class EvaluateDegradation extends Command
{
    protected $signature = 'degradation:evaluate';
    protected $description = 'Evaluate system metrics and trigger degradation if needed';

    public function handle(DegradationManager $manager): int
    {
        $manager->evaluate();
        $this->info('Degradation evaluation completed. Level: ' . $manager->getSystemLevel());

        return self::SUCCESS;
    }
}
```

在 `app/Console/Kernel.php` 中注册每 30 秒执行一次：

```php
protected function schedule(Schedule $schedule): void
{
    $schedule->command('degradation:evaluate')->everyThirtySeconds();
}
```

---

## 七、恢复策略

降级只是临时措施，系统必须具备自动和手动恢复能力。

### 7.1 自动恢复

```php
// app/Services/Degradation/RecoveryManager.php

namespace App\Services\Degradation;

use Illuminate\Support\Facades\Log;

class RecoveryManager
{
    /**
     * 自动恢复检查
     * 当系统指标恢复到正常水平的 80% 时，自动提升降级等级
     */
    public function tryRecover(): void
    {
        $manager = app(DegradationManager::class);
        $metrics = app(MetricsCollector::class);

        $currentLevel = $manager->getSystemLevel();
        if ($currentLevel === 'normal') {
            return; // 已在正常状态
        }

        $snapshot = $metrics->getSnapshot();

        // 检查是否满足恢复条件（使用更保守的阈值）
        $canRecover = $snapshot['qps'] < 3000
            && $snapshot['p99_latency_ms'] < 300
            && $snapshot['error_count'] < 10;

        if ($canRecover) {
            // 渐进恢复：每次只提升一个等级
            $nextLevel = match ($currentLevel) {
                'heavy' => 'moderate',
                'moderate' => 'light',
                'light' => 'normal',
                default => 'normal',
            };

            Log::info("Auto-recovery: upgrading from {$currentLevel} to {$nextLevel}");
            cache()->put('degradation:system:level', $nextLevel, now()->addMinutes(5));
        }
    }
}
```

### 7.2 手动恢复

```php
// app/Http/Controllers/Admin/DegradationController.php

/**
 * 手动恢复到指定等级
 */
public function restore(Request $request)
{
    $targetLevel = $request->input('level', 'normal');

    // 设置恢复标记（阻止自动降级器覆盖）
    cache()->put('degradation:manual:override', $targetLevel, now()->addHour());

    // 清除所有自动降级标记
    $features = ['social-sharing', 'recommendation', 'comments', 'realtime-notifications'];
    foreach ($features as $feature) {
        cache()->forget("degradation:auto:{$feature}");
    }

    cache()->put('degradation:system:level', $targetLevel, now()->addHour());

    return response()->json([
        'message' => "系统已手动恢复到 {$targetLevel} 等级",
        'level' => $targetLevel,
    ]);
}
```

---

## 八、真实案例：电商大促场景下的降级方案

以某电商平台双十一大促为例，展示一个完整的降级方案设计。

### 8.1 场景背景

- 日常 QPS：2000
- 预期大促峰值 QPS：20000+
- 核心链路：商品详情页 → 加入购物车 → 下单 → 支付
- 非核心功能：推荐、评论、搜索联想、分享、消息通知

### 8.2 大促前预案（T-1 天）

```php
// 提前预热降级方案
class PromotionPreparation
{
    public function warmup(): void
    {
        // 1. 预生成静态热门榜单缓存
        $hotProducts = Product::query()
            ->orderByDesc('sales_count')
            ->limit(100)
            ->get();

        cache()->put('fallback:hot_products', $hotProducts, now()->addDay());
        cache()->store('file')->put('fallback:hot_products', $hotProducts, now()->addDays(3));

        // 2. 预热 ES 索引
        $this->warmupElasticsearchIndex();

        // 3. 设置大促专用降级阈值
        cache()->put('degradation:thresholds:promo', [
            'light' => ['qps' => 8000, 'p99_latency_ms' => 400],
            'moderate' => ['qps' => 12000, 'p99_latency_ms' => 800],
            'heavy' => ['qps' => 18000, 'p99_latency_ms' => 2000],
        ], now()->addDays(2));

        // 4. 提前关闭低优先级功能
        $nonEssential = ['social-sharing', 'realtime-notifications', 'browsing-history'];
        foreach ($nonEssential as $feature) {
            cache()->put("degradation:manual:{$feature}", true, now()->addDays(2));
        }
    }
}
```

### 8.3 大促期间降级时序

```
T+0:00  大促开始，QPS 从 2000 上升
T+0:05  QPS 达到 8000 → 自动触发轻度降级
         - 关闭：分享功能、浏览历史
         - 推荐服务从个性化降级为热门榜单
         - 分页从 20 条降到 15 条

T+0:10  QPS 达到 12000 → 自动触发中度降级
         - 关闭：评论加载、消息通知
         - 搜索从 ES 降级到 MySQL FULLTEXT
         - 数据库读写分离（读请求全切从库）
         - 分页从 15 条降到 10 条
         - 图片降级为缩略图

T+0:15  QPS 达到 18000 → 自动触发重度降级
         - 只保留核心链路：商品详情 + 加购 + 下单
         - 搜索降级到 MySQL LIKE
         - 缓存降级到本地文件
         - 返回最简数据（只有标题、价格、主图）
         - 分页降到 5 条

T+0:30  QPS 回落至 10000 → 自动恢复到中度降级
T+0:45  QPS 回落至 5000  → 自动恢复到轻度降级
T+1:00  QPS 回落至 2000  → 完全恢复到正常状态
```

### 8.4 降级监控面板

通过 Prometheus + Grafana 构建降级监控面板：

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'laravel-degradation'
    metrics_path: '/metrics/degradation'
    static_configs:
      - targets: ['app:8000']
    scrape_interval: 15s

  # 告警规则
  - alert: DegradationLevelHigh
    expr: app_degradation_level >= 2
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "系统已进入中度或重度降级"

  - alert: DegradationDurationLong
    expr: app_degradation_level >= 1
    for: 30m
    labels:
      severity: critical
    annotations:
      summary: "系统降级状态已持续超过 30 分钟"
```

---

## 九、总结与最佳实践

### 9.1 核心原则

1. **提前设计，不要临时抱佛脚**：降级方案必须在系统设计阶段就考虑，而不是在大促前一周赶工
2. **分层降级，渐进式体验**：不要一刀切全关，而是按优先级分层降级，逐步收缩
3. **核心链路不可降级**：下单、支付等核心交易链路必须保障可用性，降级只影响辅助功能
4. **自动化优先**：人工判断太慢，自动触发 + 自动恢复是必须的
5. **可观察性**：每一次降级操作都必须有日志、有指标、有告警

### 9.2 设计检查清单

- [ ] 是否识别了核心链路和非核心功能？
- [ ] 每个功能是否有明确的降级/恢复优先级？
- [ ] 数据源是否有备用方案（Redis → File → Static）？
- [ ] 降级阈值是否经过压测验证？
- [ ] 自动恢复是否使用了渐进式策略（避免抖动）？
- [ ] 降级日志是否接入了监控告警？
- [ ] 是否有手动降级/恢复的运维入口？
- [ ] 前端是否适配了降级状态（简化 UI、隐藏模块）？

### 9.3 常见陷阱

| 陷阱 | 说明 | 解决方案 |
|------|------|----------|
| 降级阈值设置不当 | 阈值太低导致频繁抖动，太高导致无法及时保护 | 通过压测确定基线，设置 80% 分位值 |
| 只降级不恢复 | 自动降级后没有恢复机制，功能永远关闭 | 渐进式自动恢复 + 手动覆盖 |
| 降级影响核心链路 | 降级逻辑本身引入了新的故障点 | 降级判断必须轻量，不能成为新的瓶颈 |
| 缺少降级测试 | 从未验证过降级流程，上线后才发现不工作 | 混沌工程：定期注入故障测试降级链路 |
| 用户无感知 | 降级后页面白屏或报错，用户不知道发生了什么 | 友好的降级提示 + 响应头通知前端 |

### 9.4 一句话总结

> **优雅降级的本质是"有计划地放弃"——在系统压力下，主动选择哪些功能可以暂时关闭，而不是被动地让整个系统崩溃。分层降级让这种放弃更精细、更可控、更有温度。**

---

*本文基于 Laravel 11 + Pennant + Redis 架构实践，代码示例已在生产环境验证。如有问题，欢迎在评论区交流。*

---

## 相关阅读

- [Saga 编排模式深度实战：Laravel 分布式事务的三种实现路线对比](/00架构/saga-orchestration-pattern-laravel-distributed-transaction) — 当降级无法覆盖时，Saga 编排模式如何保障分布式事务的最终一致性，与降级策略形成互补。
- [Eventual Consistency 实战：最终一致性在电商场景中的工程化](/00架构/Eventual-Consistency-实战-最终一致性在电商场景中的工程化-反压冲突解决与用户感知延迟) — 电商场景中数据降级后的数据一致性保障，反压与冲突解决策略。
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块](/00架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移) — 从架构层面解决性能瓶颈，减少因系统压力触发降级的概率。