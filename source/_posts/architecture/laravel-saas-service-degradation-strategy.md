---
title: 服务降级清单设计实战：Laravel SaaS 的功能优先级矩阵
date: 2026-06-10 08:16:00
categories:
  - architecture
keywords: [Laravel SaaS, 服务降级清单设计实战, 的功能优先级矩阵, 架构]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Laravel
  - SaaS
  - 服务降级
  - 高可用
  - 限流
description: 核心/重要/可选功能在资源受限时的优雅降级策略，附 Laravel 实战代码和踩坑记录。
---

# 服务降级清单设计实战：Laravel SaaS 的功能优先级矩阵

## 前言

SaaS 应用上线后总会遇到各种突发状况：数据库连接池打满、Redis 内存告警、第三方 API 超时、流量洪峰来袭。这时候如果系统直接挂掉，用户体验是最差的。更好的做法是**有策略地降级**——砍掉不重要的功能，保住核心链路。

这篇文章讲的是如何为 Laravel SaaS 项目设计一套**服务降级清单**，建立功能优先级矩阵，在资源受限时优雅降级。

## 什么是服务降级

服务降级的核心思想：**在系统资源不足时，主动放弃非核心功能的可用性，保障核心业务链路正常运行。**

和限流的区别：
- **限流**：控制进入系统的请求量，超出的直接拒绝
- **降级**：系统内部主动关闭某些功能，对外表现为"功能暂不可用"

两者通常配合使用：限流是第一道防线，降级是第二道。

## 功能优先级矩阵设计

### 三级分类

把 SaaS 的所有功能分为三级：

| 级别 | 定义 | 示例 | 降级行为 |
|------|------|------|----------|
| **P0 核心** | 没了这个功能，业务直接不可用 | 用户登录、订单创建、支付回调 | **永不降级**，必要时扩容 |
| **P1 重要** | 影响用户体验但不阻断业务 | 搜索推荐、订单详情页、消息通知 | **延迟降级**，资源紧张时降级 |
| **P2 可选** | 锦上添花的功能 | 数据报表、操作日志、个性化推荐 | **立即降级**，资源一紧张就砍 |

### 如何确定优先级

不是拍脑袋决定的，需要结合业务数据：

1. **流量占比**：哪些接口承载了 80% 的请求？
2. **收入关联**：哪些功能直接影响付费转化？
3. **依赖链路**：哪些功能依赖外部服务（第三方 API、消息队列）？
4. **资源消耗**：哪些功能消耗大量 CPU/内存/数据库连接？

### 实战：建立降级配置表

在 Laravel 项目中，用配置文件管理降级状态：

```php
<?php
// config/degradation.php

return [
    /*
    |--------------------------------------------------------------------------
    | 降级开关总控
    |--------------------------------------------------------------------------
    */
    'enabled' => env('DEGRADATION_ENABLED', false),

    /*
    |--------------------------------------------------------------------------
    | 功能降级配置
    |--------------------------------------------------------------------------
    | level: P0=核心(不降级), P1=重要, P2=可选
    | degraded: 是否已降级
    | fallback: 降级后的返回值或回调
    */
    'features' => [
        // P0 核心功能 - 永不降级
        'login' => [
            'level' => 'P0',
            'degraded' => false,
            'fallback' => null,
        ],
        'order_create' => [
            'level' => 'P0',
            'degraded' => false,
            'fallback' => null,
        ],
        'payment_callback' => [
            'level' => 'P0',
            'degraded' => false,
            'fallback' => null,
        ],

        // P1 重要功能 - 延迟降级
        'search' => [
            'level' => 'P1',
            'degraded' => false,
            'fallback' => 'App\Services\Degradation\SearchFallback@handle',
        ],
        'notification' => [
            'level' => 'P1',
            'degraded' => false,
            'fallback' => 'App\Services\Degradation\NotificationFallback@handle',
        ],
        'recommendation' => [
            'level' => 'P1',
            'degraded' => false,
            'fallback' => 'App\Services\Degradation\RecommendationFallback@handle',
        ],

        // P2 可选功能 - 立即降级
        'report' => [
            'level' => 'P2',
            'degraded' => false,
            'fallback' => 'App\Services\Degradation\ReportFallback@handle',
        ],
        'activity_log' => [
            'level' => 'P2',
            'degraded' => false,
            'fallback' => null,
        ],
        'personalization' => [
            'level' => 'P2',
            'degraded' => false,
            'fallback' => 'App\Services\Degradation\PersonalizationFallback@handle',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | 自动降级阈值
    |--------------------------------------------------------------------------
    */
    'auto' => [
        'enabled' => env('DEGRADATION_AUTO', true),
        'thresholds' => [
            'p1' => [
                'cpu_percent' => 80,
                'memory_percent' => 85,
                'db_connections_percent' => 70,
                'queue_wait_time_seconds' => 30,
            ],
            'p2' => [
                'cpu_percent' => 60,
                'memory_percent' => 70,
                'db_connections_percent' => 50,
                'queue_wait_time_seconds' => 10,
            ],
        ],
    ],
];
```

## 降级服务核心实现

### DegradationService

这是降级的核心服务类，负责判断功能是否降级、执行降级逻辑：

```php
<?php

namespace App\Services\Degradation;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Log;

class DegradationService
{
    protected array $config;
    protected string $cacheKey = 'degradation:status';

    public function __construct()
    {
        $this->config = config('degradation', []);
    }

    /**
     * 判断某个功能是否已降级
     */
    public function isDegraded(string $feature): bool
    {
        if (!($this->config['enabled'] ?? false)) {
            return false;
        }

        $featureConfig = $this->config['features'][$feature] ?? null;
        if (!$featureConfig) {
            return false;
        }

        // P0 功能永不降级
        if ($featureConfig['level'] === 'P0') {
            return false;
        }

        // 从缓存读取实时降级状态（支持运行时动态切换）
        $degradedFeatures = Cache::get($this->cacheKey, []);

        return in_array($feature, $degradedFeatures)
            || ($featureConfig['degraded'] ?? false);
    }

    /**
     * 获取降级后的处理方式
     */
    public function getFallback(string $feature): mixed
    {
        $featureConfig = $this->config['features'][$feature] ?? null;

        if (!$featureConfig || !$featureConfig['fallback']) {
            return null;
        }

        $fallback = $featureConfig['fallback'];

        // 支持 Class@method 格式
        if (is_string($fallback) && str_contains($fallback, '@')) {
            [$class, $method] = explode('@', $fallback);

            return app($class)->{$method}();
        }

        // 支持闭包
        if (is_callable($fallback)) {
            return $fallback();
        }

        return $fallback;
    }

    /**
     * 运行时开启降级
     */
    public function degrade(string $feature, int $ttl = 3600): void
    {
        $degradedFeatures = Cache::get($this->cacheKey, []);

        if (!in_array($feature, $degradedFeatures)) {
            $degradedFeatures[] = $feature;
            Cache::put($this->cacheKey, $degradedFeatures, $ttl);
        }

        Log::warning("功能降级已开启: {$feature}", [
            'feature' => $feature,
            'ttl' => $ttl,
        ]);
    }

    /**
     * 运行时恢复功能
     */
    public function restore(string $feature): void
    {
        $degradedFeatures = Cache::get($this->cacheKey, []);
        $degradedFeatures = array_values(array_diff($degradedFeatures, [$feature]));
        Cache::put($this->cacheKey, $degradedFeatures, 3600);

        Log::info("功能降级已恢复: {$feature}");
    }

    /**
     * 批量降级指定级别的所有功能
     */
    public function degradeByLevel(string $level, int $ttl = 3600): void
    {
        $features = [];

        foreach ($this->config['features'] ?? [] as $name => $config) {
            if ($config['level'] === $level && $level !== 'P0') {
                $features[] = $name;
            }
        }

        Cache::put($this->cacheKey, $features, $ttl);

        Log::warning("批量降级: level={$level}", [
            'features' => $features,
            'ttl' => $ttl,
        ]);
    }

    /**
     * 获取当前降级状态概览
     */
    public function getStatus(): array
    {
        $degradedFeatures = Cache::get($this->cacheKey, []);
        $status = [];

        foreach ($this->config['features'] ?? [] as $name => $config) {
            $status[$name] = [
                'level' => $config['level'],
                'is_degraded' => in_array($name, $degradedFeatures),
                'has_fallback' => !empty($config['fallback']),
            ];
        }

        return $status;
    }
}
```

### 降级中间件

通过中间件在请求层拦截，降级的功能直接返回降级响应：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\Degradation\DegradationService;
use Symfony\Component\HttpFoundation\Response;

class CheckDegradation
{
    public function __construct(
        protected DegradationService $degradation
    ) {}

    public function handle(Request $request, Closure $next, string $feature): Response
    {
        if ($this->degradation->isDegraded($feature)) {
            $fallback = $this->degradation->getFallback($feature);

            if ($fallback) {
                return $fallback;
            }

            // 默认降级响应
            return response()->json([
                'code' => 503,
                'message' => '该功能暂时不可用，请稍后再试',
                'feature' => $feature,
            ], 503);
        }

        return $next($request);
    }
}
```

注册中间件：

```php
// app/Http/Kernel.php
protected $middlewareAliases = [
    // ...
    'degrade' => \App\Http\Middleware\CheckDegradation::class,
];
```

路由中使用：

```php
Route::middleware('degrade:search')->group(function () {
    Route::get('/search', [SearchController::class, 'index']);
    Route::get('/search/suggest', [SearchController::class, 'suggest']);
});

Route::middleware('degrade:report')->group(function () {
    Route::get('/reports', [ReportController::class, 'index']);
    Route::get('/reports/export', [ReportController::class, 'export']);
});
```

## 自动降级：基于系统指标的智能判断

手动降级太慢了，真正线上出问题时需要自动触发。用一个 Artisan 命令定期检查系统指标：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\Degradation\DegradationService;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\DB;

class CheckSystemHealth extends Command
{
    protected $signature = 'health:check';
    protected $description = '检查系统健康状态，自动触发降级';

    public function handle(DegradationService $degradation): int
    {
        $metrics = $this->collectMetrics();
        $thresholds = config('degradation.auto.thresholds');

        // P2 功能：达到 P2 阈值就降级
        if ($this->exceedsThreshold($metrics, $thresholds['p2'])) {
            $this->warn('系统指标达到 P2 阈值，降级可选功能');
            $degradation->degradeByLevel('P2', 1800);
        }

        // P1 功能：达到 P1 阈值才降级
        if ($this->exceedsThreshold($metrics, $thresholds['p1'])) {
            $this->warn('系统指标达到 P1 阈值，降级重要功能');
            $degradation->degradeByLevel('P1', 1800);
        }

        // 指标恢复正常时自动恢复
        if (!$this->exceedsThreshold($metrics, $thresholds['p2'])) {
            $this->info('系统指标恢复正常，恢复所有降级功能');
            $degradation->restore('search');
            $degradation->restore('notification');
            $degradation->restore('recommendation');
            $degradation->restore('report');
            $degradation->restore('activity_log');
            $degradation->restore('personalization');
        }

        $this->table(
            ['指标', '当前值', '状态'],
            collect($metrics)->map(fn($v, $k) => [$k, $v, '✅'])->toArray()
        );

        return self::SUCCESS;
    }

    protected function collectMetrics(): array
    {
        return [
            'cpu_percent' => $this->getCpuUsage(),
            'memory_percent' => $this->getMemoryUsage(),
            'db_connections_percent' => $this->getDbConnectionUsage(),
            'queue_wait_time_seconds' => $this->getQueueWaitTime(),
        ];
    }

    protected function getCpuUsage(): float
    {
        $load = sys_getavgload();
        $cores = (int) shell_exec('nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1');

        return round(($load[0] / $cores) * 100, 2);
    }

    protected function getMemoryUsage(): float
    {
        $free = (int) shell_exec("free -m | awk '/Mem:/ {print $3/$2 * 100}'");

        return round($free, 2);
    }

    protected function getDbConnectionUsage(): float
    {
        try {
            $status = DB::select("SHOW STATUS LIKE 'Threads_connected'")[0]->Value ?? 0;
            $max = DB::select("SHOW VARIABLES LIKE 'max_connections'")[0]->Value ?? 1;

            return round(($status / $max) * 100, 2);
        } catch (\Exception $e) {
            return 0;
        }
    }

    protected function getQueueWaitTime(): int
    {
        try {
            $wait = Redis::llen('queues:default');

            return (int) $wait;
        } catch (\Exception $e) {
            return 0;
        }
    }

    protected function exceedsThreshold(array $metrics, array $thresholds): bool
    {
        foreach ($thresholds as $key => $threshold) {
            if (($metrics[$key] ?? 0) >= $threshold) {
                return true;
            }
        }

        return false;
    }
}
```

配合 Scheduler 每分钟执行一次：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    $schedule->command('health:check')->everyMinute();
}
```

## Fallback 实现：降级后给用户什么

降级不是直接返回 503，要给用户有意义的响应。下面是几个典型的 Fallback 实现：

### 搜索降级：返回热门结果

```php
<?php

namespace App\Services\Degradation;

use Illuminate\Support\Facades\Cache;

class SearchFallback
{
    public function handle()
    {
        // 降级时返回缓存的热门搜索结果，而不是实时搜索
        $hotResults = Cache::remember('search:fallback:hot', 3600, function () {
            return \App\Models\Product::query()
                ->orderByDesc('view_count')
                ->limit(20)
                ->get(['id', 'title', 'price', 'image']);
        });

        return response()->json([
            'code' => 200,
            'message' => '搜索服务繁忙，为您展示热门商品',
            'data' => $hotResults,
            'degraded' => true,
        ]);
    }
}
```

### 通知降级：静默处理

```php
<?php

namespace App\Services\Degradation;

use Illuminate\Support\Facades\Log;

class NotificationFallback
{
    public function handle()
    {
        // 通知降级时，将消息写入队列延迟发送，而不是实时推送
        Log::info('通知服务已降级，消息将延迟发送');

        return response()->json([
            'code' => 200,
            'message' => '消息已接收，将在稍后推送',
            'degraded' => true,
        ]);
    }
}
```

### 报表降级：返回缓存数据

```php
<?php

namespace App\Services\Degradation;

use Illuminate\Support\Facades\Cache;

class ReportFallback
{
    public function handle()
    {
        $cachedReport = Cache::get('report:fallback:latest');

        if ($cachedReport) {
            return response()->json([
                'code' => 200,
                'message' => '报表服务繁忙，展示最近缓存数据',
                'data' => $cachedReport,
                'degraded' => true,
                'cached_at' => Cache::get('report:fallback:cached_at'),
            ]);
        }

        return response()->json([
            'code' => 503,
            'message' => '报表服务暂时不可用，请稍后再试',
            'degraded' => true,
        ], 503);
    }
}
```

## 降级管理 API

给运维团队提供降级管理接口：

```php
<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Degradation\DegradationService;
use Illuminate\Http\Request;

class DegradationController extends Controller
{
    public function __construct(
        protected DegradationService $degradation
    ) {}

    /**
     * GET /admin/degradation/status
     * 查看降级状态
     */
    public function status()
    {
        return response()->json([
            'code' => 200,
            'data' => $this->degradation->getStatus(),
        ]);
    }

    /**
     * POST /admin/degradation/degrade
     * 手动开启降级
     */
    public function degrade(Request $request)
    {
        $request->validate([
            'feature' => 'required|string',
            'ttl' => 'integer|min:60|max:86400',
        ]);

        $this->degradation->degrade(
            $request->input('feature'),
            $request->input('ttl', 3600)
        );

        return response()->json([
            'code' => 200,
            'message' => "功能 {$request->input('feature')} 已降级",
        ]);
    }

    /**
     * POST /admin/degradation/restore
     * 手动恢复功能
     */
    public function restore(Request $request)
    {
        $request->validate([
            'feature' => 'required|string',
        ]);

        $this->degradation->restore($request->input('feature'));

        return response()->json([
            'code' => 200,
            'message' => "功能 {$request->input('feature')} 已恢复",
        ]);
    }

    /**
     * POST /admin/degradation/batch
     * 批量降级
     */
    public function batch(Request $request)
    {
        $request->validate([
            'level' => 'required|in:P1,P2',
            'ttl' => 'integer|min:60|max:86400',
        ]);

        $this->degradation->degradeByLevel(
            $request->input('level'),
            $request->input('ttl', 3600)
        );

        return response()->json([
            'code' => 200,
            'message' => "已批量降级 {$request->input('level')} 级功能",
        ]);
    }
}
```

注册路由时加好权限中间件：

```php
Route::middleware(['auth:sanctum', 'admin'])->prefix('admin/degradation')->group(function () {
    Route::get('/status', [DegradationController::class, 'status']);
    Route::post('/degrade', [DegradationController::class, 'degrade']);
    Route::post('/restore', [DegradationController::class, 'restore']);
    Route::post('/batch', [DegradationController::class, 'batch']);
});
```

## 配合 Feature Flag 使用

Laravel 自带的 `Feature` facade 也可以配合降级使用：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Gate;
use App\Services\Degradation\DegradationService;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 基于降级状态的 Feature Gate
        Gate::define('use-search', function ($user) {
            return !app(DegradationService::class)->isDegraded('search');
        });

        Gate::define('view-report', function ($user) {
            return !app(DegradationService::class)->isDegraded('report');
        });
    }
}
```

在 Blade 模板中：

```blade
@can('view-report')
    <a href="/reports">查看报表</a>
@else
    <span class="text-muted">报表服务暂时不可用</span>
@endcan
```

## 踩坑记录

### 坑 1：降级状态不一致

多台服务器时，降级配置存在本地缓存中会导致不一致。

**解决方案**：降级状态统一存 Redis，不用文件缓存：

```php
// 改用 Redis 存储降级状态
protected string $cacheKey = 'degradation:status';

public function isDegraded(string $feature): bool
{
    // 强制使用 Redis，避免文件缓存不一致
    return Redis::sismember($this->cacheKey, $feature);
}
```

### 坑 2：降级后忘记恢复

手动降级后，开发人员忘记恢复，功能一直不可用。

**解决方案**：给降级操作加 TTL，自动过期恢复：

```php
public function degrade(string $feature, int $ttl = 3600): void
{
    Redis::sadd($this->cacheKey, $feature);
    Redis::expire($this->cacheKey, $ttl);  // 整个集合设置过期

    // 或者用单独的 key 记录每个功能的过期时间
    Redis::setex("degradation:feature:{$feature}", $ttl, '1');
}
```

### 坑 3：降级与限流冲突

已经降级的功能，限流中间件还在正常工作，导致降级响应也被限流。

**解决方案**：降级中间件放在限流中间件之前：

```php
// 路由中间件顺序
Route::middleware(['degrade:search', 'throttle:60,1'])->group(function () {
    Route::get('/search', [SearchController::class, 'index']);
});
```

### 坑 4：降级监控盲区

降级后没有告警，运维不知道哪些功能已经挂了。

**解决方案**：降级操作触发时发送告警：

```php
public function degrade(string $feature, int $ttl = 3600): void
{
    // ... 降级逻辑 ...

    // 发送告警
    \App\Notifications\DegradationAlert::dispatch($feature, $ttl);

    // 记录到监控系统
    \Log::channel('slack')->warning("⚠️ 功能降级: {$feature}", [
        'feature' => $feature,
        'ttl' => $ttl,
        'server' => gethostname(),
    ]);
}
```

### 坑 5：数据库连接池耗尽时降级查询也失败

降级 Fallback 里还在查数据库，但数据库连接池已经满了。

**解决方案**：Fallback 逻辑尽量用缓存，不查数据库：

```php
class SearchFallback
{
    public function handle()
    {
        // 不查数据库，直接用缓存
        $results = Cache::get('search:fallback:hot', collect());

        if ($results->isEmpty()) {
            // 缓存也没有，返回静态兜底数据
            return response()->json([
                'message' => '搜索服务维护中',
                'data' => [],
            ], 503);
        }

        return response()->json(['data' => $results]);
    }
}
```

## 完整的降级流程图

```
请求进入
    ↓
[降级中间件] → 功能已降级？ → 是 → 返回 Fallback 响应
    ↓ 否
[限流中间件] → 超过阈值？ → 是 → 返回 429
    ↓ 否
[业务逻辑] → 正常处理
    ↓
[健康检查任务]
    ↓
指标超标？ → 是 → 自动开启降级 → 发送告警
    ↓ 否
指标恢复？ → 是 → 自动恢复功能
```

## 总结

服务降级不是"系统挂了"的替代方案，而是**有计划地牺牲非核心功能来保全核心业务**的策略。

核心要点：

1. **功能分级是基础**：P0/P1/P2 三级分类要和业务团队一起定，不能开发团队自己拍脑袋
2. **自动化是关键**：手动降级太慢，基于系统指标的自动降级才能应对突发流量
3. **Fallback 要有意义**：降级不是返回 503，而是给用户一个降级但可用的体验
4. **状态要统一存储**：多服务器环境下用 Redis 统一管理降级状态
5. **监控要跟上**：降级操作要触发告警，不能静默降级

最后，降级清单需要定期 Review。随着业务发展，功能的优先级会变化——去年的 P2 功能可能是今年的核心卖点。每个季度和业务团队一起过一遍降级清单，保持它和当前业务状态一致。
