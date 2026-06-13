---
title: API 限流与计费联动实战：Redis Cell + Stripe Usage Records——按 API 调用量计费的 SaaS 流量治理与账单闭环
date: 2026-06-10 08:20:00
description: '深入解析SaaS场景下API限流与按量计费的完整联动方案。以Redis Cell模块实现精准令牌桶限流，结合Stripe Usage Records API构建实时用量上报与账单闭环，覆盖多租户配额管理、限流降级策略、计费对账等生产级问题，附完整Laravel实现代码与架构设计。'
tags: [Redis, Stripe, API限流, SaaS, 按量计费, Redis Cell, Laravel]
keywords: [API, Redis Cell, Stripe Usage Records, SaaS, 限流与计费联动实战, 调用量计费的, 流量治理与账单闭环, 数据库]
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---


## 引言：当限流遇上计费——SaaS 平台的流量治理困境

你做了一个 API 服务，卖给了 100 个客户。免费用户每分钟能调 60 次，Pro 用户每分钟 600 次，Enterprise 用户每分钟 6000 次。听起来很简单？加个中间件限流就行。

但产品经理说：我们要按实际调用量收费。每 1000 次 API 调用收 $0.05，超出套餐额度的部分按 $0.08/1000 次计费。月底出账单，用户能实时看到本月已用量。

这时候你会发现：**限流和计费是两个强耦合的需求**。限流决定了"用户此刻能不能调用"，计费决定了"用户这个月调用了多少次"。它们共享同一个计数器，但语义完全不同——限流要的是滑动窗口的瞬时判断，计费要的是累计周期的精确统计。

更棘手的是：你需要保证"被限流拒绝的请求不计费"、"计费数据不能丢"、"限流器挂了不能让请求无限涌入"。这不是一个 Redis key 能解决的问题。

本文将从零搭建一套生产级方案：**Redis Cell 做精准令牌桶限流 + Stripe Usage Records 做用量上报与账单闭环**，覆盖多租户配额、降级策略、计费对账等完整场景。

---

## 一、限流算法选型：为什么是 Redis Cell？

### 1.1 常见限流算法对比

| 算法 | 精度 | 内存占用 | 分布式友好 | 适用场景 |
|------|------|----------|-----------|---------|
| 固定窗口计数器 | 低（有边界突发） | 极低 | 简单 | 粗粒度限流 |
| 滑动窗口计数器 | 中 | 低 | 中等 | 通用场景 |
| 漏桶（Leaky Bucket） | 高 | 低 | 中等 | 平滑流量 |
| 令牌桶（Token Bucket） | 高 | 低 | 较好 | 允许突发流量 |
| Redis Cell（GCRA） | 极高 | 极低 | 极好 | 精准限流 + 低延迟 |

### 1.2 Redis Cell 的核心优势

Redis Cell 是 Redis 的一个扩展模块，实现了 **GCRA（Generic Cell Rate Algorithm）** 算法。它不是用 Lua 脚本模拟的，而是用 C 语言实现的原生模块，单次判断只需一次 Redis 命令调用，延迟在微秒级别。

```bash
# 安装 Redis Cell 模块（Docker 方式）
docker run -d --name redis-cell \
  -p 6379:6379 \
  redislabs/redismod:latest
```

核心命令只有一个——`CL.THROTTLE`：

```
CL.THROTTLE <key> <max_burst> <count> <period> [<quantity>]
```

参数解释：
- `key`：限流键，通常是 `rate_limit:tenant:{id}` 的格式
- `max_burst`：最大突发容量（桶的大小减 1）
- `count` / `period`：在 `period` 秒内允许 `count` 次请求
- `quantity`：本次请求消耗的令牌数（默认 1）

返回值是一个 5 元素数组：

```
1) (integer) 0      # 0=允许，1=拒绝
2) (integer) -1     # 限流后的剩余令牌数（-1 表示满）
3) (integer) -1     # 需要等待的秒数（-1 表示不需要等待）
4) (integer) 10     # 限流后的重试秒数（被拒绝时有意义）
5) (integer) 15     # 桶完全恢复的秒数
```

### 1.3 为什么不用 Laravel 自带的 RateLimiter？

Laravel 的 `RateLimiter` 底层是 Redis 的 `INCR` + `EXPIRE`，本质上是固定窗口计数器。有两个致命问题：

1. **窗口边界突发**：用户在第 59 秒调了 59 次，第 60 秒（新窗口开始）又能调 60 次——实际 2 秒内调了 119 次，远超"60 次/分钟"的限制。
2. **计数不精确**：`INCR` 和 `EXPIRE` 不是原子操作，在高并发下可能丢失计数或 TTL 异常。

Redis Cell 的 GCRA 算法天然避免了窗口边界问题，而且单命令原子性保证了精确性。

---

## 二、架构设计：限流 + 计费的双引擎模型

### 2.1 整体架构

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Client    │────▶│  API Gateway     │────▶│  Laravel    │
│  Request    │     │  (Nginx/Kong)    │     │  Application│
└─────────────┘     └──────────────────┘     └──────┬──────┘
                                                     │
                                    ┌────────────────┼────────────────┐
                                    │                │                │
                              ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
                              │  Redis    │   │  Billing  │   │  Business │
                              │  Cell     │   │  Service  │   │  Logic    │
                              │  (限流)    │   │  (计费)    │   │           │
                              └─────┬─────┘   └─────┬─────┘   └───────────┘
                                    │               │
                              ┌─────▼─────┐   ┌─────▼─────┐
                              │  Redis    │   │  Stripe   │
                              │  Stream   │   │  Usage    │
                              │  (用量事件) │   │  Records  │
                              └───────────┘   └───────────┘
```

### 2.2 核心设计原则

**原则一：限流优先于计费**

请求进入后，先判断是否被限流。只有通过限流的请求才记录用量。这保证了"被拒绝的请求不计费"。

**原则二：计数器异步聚合上报**

限流用 Redis Cell 的实时计数器，计费用 Redis Stream 异步聚合后批量上报给 Stripe。两者解耦，避免计费逻辑拖慢 API 响应。

**原则三：最终一致性**

不要求限流计数和计费数据实时一致。通过定时对账任务修正差异，容忍分钟级别的延迟。

### 2.3 多租户配额数据结构

```bash
# Redis 中的 key 设计
# 限流键（Redis Cell 管理，自动过期）
rate_limit:tenant:{tenant_id}:api    # API 调用限流
rate_limit:tenant:{tenant_id}:export # 导出限流（独立配额）

# 用量统计键（手动维护）
usage:tenant:{tenant_id}:{YYYYMM}   # 月度累计用量（HLL 或 String）
usage:daily:{tenant_id}:{YYYYMMDD}  # 日用量明细

# Stripe 用量记录游标
billing:cursor:{tenant_id}:{YYYYMM} # 上次上报到 Stripe 的位置
```

---

## 三、Redis Cell 限流的 Laravel 实现

### 3.1 限流服务类

```php
<?php

namespace App\Services\RateLimit;

use Illuminate\Support\Facades\Redis;

class RedisCellRateLimiter
{
    /**
     * 判断请求是否被限流
     *
     * @param string $tenantId   租户 ID
     * @param int    $maxBurst   最大突发量（桶容量 - 1）
     * @param int    $count      时间窗口内允许的请求数
     * @param int    $period     时间窗口（秒）
     * @param int    $quantity   本次消耗的令牌数
     * @return RateLimitResult
     */
    public function check(
        string $tenantId,
        int    $maxBurst,
        int    $count,
        int    $period,
        int    $quantity = 1
    ): RateLimitResult {
        $key = "rate_limit:tenant:{$tenantId}:api";

        // CL.THROTTLE key max_burst count period quantity
        $result = Redis::command('CL.THROTTLE', [
            $key,
            $maxBurst,
            $count,
            $period,
            $quantity,
        ]);

        return new RateLimitResult(
            allowed:       $result[0] === 0,
            limit:         $count,
            remaining:     max(0, $result[1]),
            retryAfter:    $result[2] > 0 ? $result[2] : null,
            resetAfter:    $result[4],
        );
    }

    /**
     * 获取租户当前的限流配置
     */
    public function getQuota(string $tenantId): array
    {
        // 从数据库或配置中读取租户的套餐配额
        $tenant = app(TenantService::class)->find($tenantId);

        return match ($tenant->plan) {
            'free'       => ['max_burst' => 59,  'count' => 60,   'period' => 60],
            'pro'        => ['max_burst' => 599, 'count' => 600,  'period' => 60],
            'enterprise' => ['max_burst' => 5999,'count' => 6000, 'period' => 60],
            default      => ['max_burst' => 29,  'count' => 30,   'period' => 60],
        };
    }
}
```

### 3.2 限流结果值对象

```php
<?php

namespace App\Services\RateLimit;

class RateLimitResult
{
    public function __construct(
        public readonly bool  $allowed,
        public readonly int   $limit,
        public readonly int   $remaining,
        public readonly ?int  $retryAfter,
        public readonly int   $resetAfter,
    ) {}

    /**
     * 写入 HTTP 响应头（符合 IETF draft-ietf-httpapi-ratelimit-headers）
     */
    public function toHeaders(): array
    {
        $headers = [
            'RateLimit-Limit'     => $this->limit,
            'RateLimit-Remaining' => $this->remaining,
            'RateLimit-Reset'     => $this->resetAfter,
        ];

        if (!$this->allowed && $this->retryAfter !== null) {
            $headers['Retry-After'] = $this->retryAfter;
        }

        return $headers;
    }
}
```

### 3.3 限流中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\RateLimit\RedisCellRateLimiter;
use App\Services\Usage\UsageRecorder;
use Symfony\Component\HttpFoundation\Response;

class ApiRateLimit
{
    public function __construct(
        private RedisCellRateLimiter $limiter,
        private UsageRecorder $usageRecorder,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = $request->user()?->tenant_id
            ?? $request->header('X-Tenant-Id');

        if (!$tenantId) {
            return response()->json(['error' => 'Missing tenant context'], 401);
        }

        $quota = $this->limiter->getQuota($tenantId);
        $result = $this->limiter->check(
            tenantId:  $tenantId,
            maxBurst:  $quota['max_burst'],
            count:     $quota['count'],
            period:    $quota['period'],
            quantity:  $this->calculateWeight($request),
        );

        if (!$result->allowed) {
            return response()->json([
                'error'   => 'Rate limit exceeded',
                'message' => "请在 {$result->retryAfter} 秒后重试",
                'retry_after' => $result->retryAfter,
            ], 429)->withHeaders($result->toHeaders());
        }

        // 限流通过 → 执行业务逻辑
        $response = $next($request);

        // 限流通过 → 记录用量（异步）
        $this->usageRecorder->record(
            tenantId:  $tenantId,
            endpoint:  $request->path(),
            method:    $request->method(),
            weight:    $this->calculateWeight($request),
            status:    $response->getStatusCode(),
        );

        // 注入限流响应头
        foreach ($result->toHeaders() as $key => $value) {
            $response->headers->set($key, $value);
        }

        return $response;
    }

    /**
     * 根据端点计算请求权重
     * 不同 API 端点消耗的令牌数不同
     */
    private function calculateWeight(Request $request): int
    {
        $weights = config('api.weights', []);

        $route = $request->route()?->getName() ?? $request->path();

        foreach ($weights as $pattern => $weight) {
            if (str_contains($route, $pattern)) {
                return $weight;
            }
        }

        return 1; // 默认消耗 1 个令牌
    }
}
```

### 3.4 端点权重配置

```php
// config/api.php
return [
    'weights' => [
        'search'   => 5,    // 搜索接口消耗 5 倍
        'export'   => 10,   // 导出接口消耗 10 倍
        'upload'   => 3,    // 上传接口消耗 3 倍
        'webhook'  => 0,    // Webhook 不消耗配额
    ],
];
```

---

## 四、用量记录与 Stripe 计费集成

### 4.1 用量记录器：Redis Stream 异步聚合

为什么不用同步写数据库？因为每个 API 请求都写一次 MySQL，在高并发下数据库扛不住。用 Redis Stream 做缓冲，后台 Worker 批量消费。

```php
<?php

namespace App\Services\Usage;

use Illuminate\Support\Facades\Redis;
use Carbon\Carbon;

class UsageRecorder
{
    private const STREAM_KEY = 'stream:api_usage';

    /**
     * 记录一次 API 调用用量
     * 写入 Redis Stream，由后台 Worker 异步处理
     */
    public function record(
        string $tenantId,
        string $endpoint,
        string $method,
        int    $weight = 1,
        int    $status = 200,
    ): void {
        // 1. 写入 Redis Stream（异步消费）
        Redis::command('XADD', [
            self::STREAM_KEY,
            '*', // 自动生成 ID
            'tenant_id', $tenantId,
            'endpoint',  $endpoint,
            'method',    $method,
            'weight',    $weight,
            'status',    $status,
            'ts',        now()->toISOString(),
        ]);

        // 2. 更新月度累计计数器（实时查询用）
        $monthKey = "usage:tenant:{$tenantId}:" . now()->format('Ym');
        Redis::command('INCRBY', [$monthKey, $weight]);
        Redis::command('EXPIRE', [$monthKey, 86400 * 35]); // 35 天过期

        // 3. 更新日维度计数器
        $dayKey = "usage:daily:{$tenantId}:" . now()->format('Ymd');
        Redis::command('INCRBY', [$dayKey, $weight]);
        Redis::command('EXPIRE', [$dayKey, 86400 * 7]); // 7 天过期
    }

    /**
     * 获取租户本月累计用量
     */
    public function getCurrentMonthUsage(string $tenantId): int
    {
        $monthKey = "usage:tenant:{$tenantId}:" . now()->format('Ym');
        return (int) Redis::command('GET', [$monthKey]) ?? 0;
    }
}
```

### 4.2 Redis Stream 消费者：批量写入数据库

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\DB;
use App\Models\ApiUsageLog;

class ConsumeUsageStream implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    private const STREAM_KEY   = 'stream:api_usage';
    private const GROUP        = 'billing_workers';
    private const CONSUMER     = 'worker-1';
    private const BATCH_SIZE   = 100;
    private const BLOCK_MS     = 5000;

    public function handle(): void
    {
        // 确保 Consumer Group 存在
        try {
            Redis::command('XGROUP', [
                'CREATE', self::STREAM_KEY, self::GROUP, '0', 'MKSTREAM'
            ]);
        } catch (\Throwable $e) {
            // Group 已存在，忽略
        }

        while (true) {
            // 读取一批消息
            $messages = Redis::command('XREADGROUP', [
                'GROUP', self::GROUP, self::CONSUMER,
                'COUNT', self::BATCH_SIZE,
                'BLOCK', self::BLOCK_MS,
                'STREAMS', self::STREAM_KEY, '>',
            ]);

            if (empty($messages) || empty($messages[self::STREAM_KEY])) {
                break; // 没有新消息，退出
            }

            $records = [];
            $messageIds = [];

            foreach ($messages[self::STREAM_KEY] as $id => $fields) {
                $records[] = [
                    'tenant_id'  => $fields['tenant_id'],
                    'endpoint'   => $fields['endpoint'],
                    'method'     => $fields['method'],
                    'weight'     => (int) $fields['weight'],
                    'status'     => (int) $fields['status'],
                    'called_at'  => $fields['ts'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
                $messageIds[] = $id;
            }

            // 批量写入数据库
            DB::table('api_usage_logs')->insert($records);

            // 确认消费
            foreach ($messageIds as $id) {
                Redis::command('XACK', [
                    self::STREAM_KEY, self::GROUP, $id
                ]);
            }
        }
    }
}
```

### 4.3 Stripe Usage Records 上报

```php
<?php

namespace App\Services\Billing;

use App\Models\Tenant;
use App\Models\ApiUsageLog;
use Illuminate\Support\Facades\Log;
use Stripe\Stripe;
use Stripe\UsageRecord;
use Stripe\Exception\ApiErrorException;

class StripeUsageReporter
{
    public function __construct()
    {
        Stripe::setApiKey(config('services.stripe.secret'));
    }

    /**
     * 将某租户的用量上报到 Stripe
     * 建议每小时或每天运行一次
     */
    public function report(string $tenantId, ?string $subscriptionItemId = null): void
    {
        $tenant = Tenant::findOrFail($tenantId);

        // 获取上次上报的游标（最后一条已上报的记录 ID）
        $cursor = $this->getCursor($tenantId);

        // 查询未上报的用量记录
        $query = ApiUsageLog::where('tenant_id', $tenantId)
            ->where('reported_to_stripe', false)
            ->orderBy('id');

        if ($cursor) {
            $query->where('id', '>', $cursor);
        }

        $logs = $query->limit(10000)->get();

        if ($logs->isEmpty()) {
            Log::info("Tenant {$tenantId}: no new usage to report");
            return;
        }

        // 按小时聚合（Stripe 限制：同一 subscription_item 的同一 timestamp 会被合并）
        $grouped = $logs->groupBy(function ($log) {
            return (string) strtotime(
                substr($log->called_at, 0, 13) . ':00:00'
            );
        });

        $subscriptionItemId ??= $tenant->stripe_subscription_item_id;

        $reportedIds = [];

        foreach ($grouped as $timestamp => $hourLogs) {
            $totalQuantity = $hourLogs->sum('weight');

            try {
                UsageRecord::create($subscriptionItemId, [
                    'quantity'   => $totalQuantity,
                    'timestamp'  => (int) $timestamp,
                    'action'     => 'increment',
                ]);

                $reportedIds = array_merge(
                    $reportedIds,
                    $hourLogs->pluck('id')->toArray()
                );

                Log::info("Tenant {$tenantId}: reported {$totalQuantity} units at {$timestamp}");

            } catch (ApiErrorException $e) {
                Log::error("Stripe usage report failed for tenant {$tenantId}: " . $e->getMessage());
                break; // 失败时中断，下次重试
            }
        }

        // 标记已上报
        if (!empty($reportedIds)) {
            ApiUsageLog::whereIn('id', $reportedIds)
                ->update(['reported_to_stripe' => true]);

            // 更新游标
            $this->updateCursor($tenantId, end($reportedIds));
        }
    }

    /**
     * 获取上报游标
     */
    private function getCursor(string $tenantId): ?int
    {
        $monthKey = now()->format('Ym');
        $key = "billing:cursor:{$tenantId}:{$monthKey}";
        return Redis::command('GET', [$key]) ? (int) Redis::command('GET', [$key]) : null;
    }

    private function updateCursor(string $tenantId, int $lastId): void
    {
        $monthKey = now()->format('Ym');
        $key = "billing:cursor:{$tenantId}:{$monthKey}";
        Redis::command('SET', [$key, $lastId]);
        Redis::command('EXPIRE', [$key, 86400 * 35]);
    }
}
```

### 4.4 定时任务调度

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每小时消费一次用量 Stream
    $schedule->job(new ConsumeUsageStream)
        ->hourly()
        ->withoutOverlapping();

    // 每天凌晨 2 点上报 Stripe 用量
    $schedule->call(function () {
        $tenants = Tenant::whereNotNull('stripe_subscription_item_id')
            ->where('status', 'active')
            ->get();

        foreach ($tenants as $tenant) {
            dispatch(new ReportUsageToStripe($tenant->id));
        }
    })->dailyAt('02:00');

    // 每月 1 号 00:05 生成上月账单对账报告
    $schedule->call(function () {
        dispatch(new GenerateReconciliationReport(now()->subMonth()));
    })->monthlyOn(1, '00:05');
}
```

---

## 五、进阶场景：多维度配额与降级策略

### 5.1 多维度独立限流

一个租户可能同时受到多个维度的限流约束：

```php
/**
 * 多维度限流检查
 */
public function checkMultiDimension(string $tenantId, Request $request): ?RateLimitResult
{
    $dimensions = [
        // 维度 1：每分钟请求数
        'per_minute' => [
            'key'     => "rate_limit:{$tenantId}:min",
            'burst'   => 59,
            'count'   => 60,
            'period'  => 60,
        ],
        // 维度 2：每小时请求数
        'per_hour' => [
            'key'     => "rate_limit:{$tenantId}:hour",
            'burst'   => 3599,
            'count'   => 3600,
            'period'  => 3600,
        ],
        // 维度 3：每日费用上限（按权重模拟金额）
        'daily_cost' => [
            'key'     => "rate_limit:{$tenantId}:daily_cost",
            'burst'   => 99999,
            'count'   => 100000,
            'period'  => 86400,
        ],
    ];

    foreach ($dimensions as $name => $config) {
        $result = Redis::command('CL.THROTTLE', [
            $config['key'],
            $config['burst'],
            $config['count'],
            $config['period'],
            1,
        ]);

        if ($result[0] === 1) {
            return new RateLimitResult(
                allowed:    false,
                limit:      $config['count'],
                remaining:  0,
                retryAfter: (int) $result[2],
                resetAfter: (int) $result[4],
                dimension:  $name, // 标记是哪个维度触发的
            );
        }
    }

    return null; // 所有维度都通过
}
```

### 5.2 限流降级策略

当 Redis Cell 不可用时，不能让请求无限涌入：

```php
/**
 * 带降级的限流检查
 */
public function checkWithFallback(string $tenantId): RateLimitResult
{
    try {
        return $this->check($tenantId, ...$this->getQuota($tenantId));
    } catch (\Throwable $e) {
        Log::critical("Redis Cell unavailable, activating fallback: " . $e->getMessage());

        // 降级方案：使用本地缓存计数（粗糙但安全）
        return $this->fallbackCheck($tenantId);
    }
}

/**
 * 降级方案：基于 Redis INCR 的固定窗口限流
 * 当 Redis Cell 模块不可用时的应急方案
 */
private function fallbackCheck(string $tenantId): RateLimitResult
{
    $key = "rate_limit:fallback:{$tenantId}:" . floor(time() / 60);
    $count = Redis::command('INCR', [$key]);
    if ($count === 1) {
        Redis::command('EXPIRE', [$key, 65]); // 多留 5 秒余量
    }

    $quota = $this->getQuota($tenantId);
    $limit = $quota['count'];

    return new RateLimitResult(
        allowed:    $count <= $limit,
        limit:      $limit,
        remaining:  max(0, $limit - $count),
        retryAfter: $count > $limit ? 60 - (time() % 60) : null,
        resetAfter: 60 - (time() % 60),
    );
}
```

### 5.3 计费对账

定期核对 Redis 中的用量计数和数据库中的实际记录：

```php
/**
 * 月度计费对账
 */
public function reconcile(Carbon $month): array
{
    $tenants = Tenant::where('status', 'active')->get();
    $discrepancies = [];

    foreach ($tenants as $tenant) {
        $monthStr = $month->format('Ym');

        // Redis 中的月度累计值
        $redisKey = "usage:tenant:{$tenant->id}:{$monthStr}";
        $redisUsage = (int) Redis::command('GET', [$redisKey]) ?? 0;

        // 数据库中的实际记录总和
        $dbUsage = ApiUsageLog::where('tenant_id', $tenant->id)
            ->whereRaw("DATE_FORMAT(called_at, '%Y%m') = ?", [$monthStr])
            ->sum('weight');

        // Stripe 已上报的量
        $reportedUsage = ApiUsageLog::where('tenant_id', $tenant->id)
            ->whereRaw("DATE_FORMAT(called_at, '%Y%m') = ?", [$monthStr])
            ->where('reported_to_stripe', true)
            ->sum('weight');

        $diff = abs($redisUsage - $dbUsage);

        if ($diff > $redisUsage * 0.01) { // 偏差超过 1% 则告警
            $discrepancies[] = [
                'tenant_id'     => $tenant->id,
                'redis_usage'   => $redisUsage,
                'db_usage'      => $dbUsage,
                'reported'      => $reportedUsage,
                'diff'          => $diff,
                'diff_percent'  => round($diff / max($redisUsage, 1) * 100, 2),
            ];
        }
    }

    return $discrepancies;
}
```

---

## 六、踩坑记录

### 6.1 Redis Cell 的 `max_burst` 参数容易搞错

`max_burst` 是桶容量减 1，不是桶容量。如果你想允许最多 60 个请求，`max_burst` 应该是 59。这个设计来自 GCRA 算法的内部实现——它记录的是"理论到达时间（TAT）"和"当前时间"之间的差值。

```bash
# 正确：每分钟 60 次，桶容量 60，max_burst = 59
CL.THROTTLE rate_limit:user:1 59 60 60

# 错误：max_burst 写成 60，实际允许 61 次
CL.THROTTLE rate_limit:user:1 60 60 60
```

### 6.2 Stripe Usage Record 的 timestamp 有去重逻辑

同一 `subscription_item` + 同一 `timestamp`（秒级）的多次调用，Stripe 会累加 quantity 而不是创建新记录。这在重试场景下是安全的，但如果你需要精确到每次调用的记录，需要确保 timestamp 不重复。

### 6.3 Redis Stream 的 Consumer Group 需要手动创建

`XREADGROUP` 在 Group 不存在时会报错，而不是自动创建。必须先 `XGROUP CREATE`，且要加 `MKSTREAM` 参数防止 Stream 不存在时报错。

### 6.4 月度计数器跨月重置

`usage:tenant:{id}:202606` 这个 key 在 6 月结束时不会自动消失（有 35 天 TTL），但新月份的 key 是独立的。注意定时任务中读取"当月"数据时要用 `now()->format('Ym')` 而不是从旧 key 读。

### 6.5 并发消费 Redis Stream 的竞态条件

多个 Worker 同时消费同一个 Consumer Group 时，`XREADGROUP` 保证消息不会被重复分配。但如果 Worker 处理中途崩溃，消息会变成 PEL（Pending Entries List）中的 pending 状态。需要定期用 `XAUTOCLAIM` 回收超时消息：

```bash
# 回收超过 5 分钟未确认的消息
XAUTOCLAIM stream:api_usage billing_workers worker-2 300000 0-0
```

---

## 七、监控与告警

### 7.1 关键指标

```php
// Prometheus 指标注册
use Prometheus\CollectorRegistry;

// 限流拒绝率
$counter = $registry->registerCounter(
    'api', 'rate_limit_rejected_total', '', ['tenant_id', 'dimension']
);

// Stripe 上报成功率
$counter = $registry->registerCounter(
    'api', 'stripe_usage_report_total', '', ['tenant_id', 'status']
);

// 用量对账偏差
$gauge = $registry->registerGauge(
    'api', 'usage_discrepancy_percent', '', ['tenant_id']
);
```

### 7.2 告警规则（Prometheus）

```yaml
groups:
  - name: api_rate_limiting
    rules:
      # 限流拒绝率超过 10%
      - alert: HighRateLimitRejection
        expr: |
          sum(rate(api_rate_limit_rejected_total[5m])) by (tenant_id)
          / sum(rate(api_rate_limit_total[5m])) by (tenant_id) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Tenant {{ $labels.tenant_id }} 限流拒绝率超过 10%"

      # Stripe 上报失败
      - alert: StripeUsageReportFailure
        expr: |
          increase(api_stripe_usage_report_total{status="error"}[1h]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Stripe 用量上报失败，请检查 API Key 和网络连接"

      # 计费对账偏差
      - alert: UsageDiscrepancy
        expr: api_usage_discrepancy_percent > 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Tenant {{ $labels.tenant_id }} 用量偏差 {{ $value }}%，需要人工核实"
```

---

## 总结

API 限流和计费看似是两个独立的需求，但在 SaaS 场景下它们共享同一个核心数据——API 调用量。本文的方案通过三个层次将它们解耦：

1. **实时层（Redis Cell）**：微秒级限流判断，保证 API 不被过载，同时确保被拒绝的请求不计费。
2. **缓冲层（Redis Stream）**：异步聚合用量数据，避免计费逻辑拖慢 API 响应。
3. **持久层（MySQL + Stripe）**：批量写入数据库并上报到 Stripe，通过定时对账保证最终一致性。

关键设计决策回顾：

- **Redis Cell 而非 Laravel RateLimiter**：GCRA 算法精度更高，无窗口边界问题。
- **Stream 而非同步写库**：高并发下数据库不会成为瓶颈。
- **游标 + 增量上报**：避免重复上报，支持断点续传。
- **降级策略**：Redis Cell 挂了退回固定窗口限流，不丢请求。
- **月度对账**：容忍分钟级延迟，但定期核对确保数据正确。

如果你正在做一个按量计费的 API 平台，这套方案可以直接落地。核心逻辑不超过 500 行 PHP 代码，但覆盖了生产环境中 90% 的边界情况。
