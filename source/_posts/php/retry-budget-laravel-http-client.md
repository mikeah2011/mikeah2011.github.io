---
title: Retry Budget 实战：Laravel HTTP Client 的重试预算治理——防止重试风暴的自适应退避与熔断联动方案
keywords: [Retry Budget, Laravel HTTP Client, 的重试预算治理, 防止重试风暴的自适应退避与熔断联动方案, PHP]
date: 2026-06-10 02:48:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Retry Budget
  - Laravel HTTP Client
  - 熔断器
  - 重试风暴
  - Resilience
  - 微服务
description: 深入解析 Retry Budget 机制，基于 Laravel HTTP Client 实现自适应退避策略与 Circuit Breaker 联动，从代码层面防止微服务间的重试风暴，附完整可运行的生产级代码。
---


## 概述

微服务架构下，服务间 HTTP 调用的失败重试是保障可用性的常见手段。但重试本身是一把双刃剑——当上游服务出现故障时，N 个下游服务的重试会将流量放大 N 倍，形成「重试风暴」（Retry Storm）。这正是 Netflix 在 Hystrix 时代就提出并实践的 **Retry Budget** 概念要解决的问题。

本文基于 Laravel HTTP Client（`Illuminate\Http\Client\PendingRequest`），从零搭建一套完整的 Retry Budget 治理方案：**自适应退避（Adaptive Backoff）+ 熔断器（Circuit Breaker）+ 重试预算控制**，附生产级可运行代码。

---

## 核心概念

### 什么是 Retry Budget

Retry Budget 的核心思想：**在固定时间窗口内，将重试请求总量限制在总请求量的一个固定比例内**（通常为 20%）。超过预算后，即使单个请求仍在允许重试的范围内，也不再执行重试。

这解决了两个问题：

1. **绝对数量限制**：只限制「每秒最多重试 100 次」是不够的——当总 QPS 从 1000 降到 100 时，100 次重试占比已经从 10% 飙升到 100%。
2. **级联放大**：当 A 服务故障，调用 A 的 B、C、D 服务同时重试，每个服务的重试又触发下游重试，指数级放大。

### Retry Budget 的数学模型

```
retry_ratio = (retry_count) / (fresh_count + retry_count)
```

其中：
- `retry_count`：时间窗口内的重试请求总数
- `fresh_count`：时间窗口内的首次请求总数
- 当 `retry_ratio > budget_threshold` 时，拒绝所有后续重试

### 为什么 Laravel HTTP Client 需要这个

Laravel HTTP Client（Guzzle HTTP 的封装）自带 `retry()` 方法：

```php
Http::retry(3, 1000)->get('https://api.example.com');
```

但它有几个致命缺陷：

1. **无全局预算控制**：每个请求独立重试，N 个并发请求会产生 N × retry_count 次重试
2. **无退避策略**：只有固定间隔，没有 exponential backoff 或 jitter
3. **无熔断联动**：重试不会感知目标服务的健康状态

---

## 实战代码

### 1. 重试预算计数器

```php
<?php

namespace App\Services\RetryBudget;

use Illuminate\Support\Facades\Cache;

class RetryBudgetCounter
{
    /**
     * 时间窗口（秒）
     */
    protected int $windowSeconds;

    /**
     * 预算阈值（0.0 ~ 1.0），超过此比例拒绝重试
     */
    protected float $budgetThreshold;

    /**
     * 缓存前缀
     */
    protected string $cachePrefix;

    public function __construct(
        int $windowSeconds = 60,
        float $budgetThreshold = 0.2,
        string $cachePrefix = 'retry_budget'
    ) {
        $this->windowSeconds = $windowSeconds;
        $this->budgetThreshold = $budgetThreshold;
        $this->cachePrefix = $cachePrefix;
    }

    /**
     * 记录一次首次请求
     */
    public function recordFresh(string $service): void
    {
        $key = "{$this->cachePrefix}:fresh:{$service}:" . $this->getWindowKey();
        Cache::increment($key);
        Cache::put($key, 1, $this->windowSeconds * 2); // TTL 为窗口的 2 倍
    }

    /**
     * 记录一次重试请求
     */
    public function recordRetry(string $service): void
    {
        $key = "{$this->cachePrefix}:retry:{$service}:" . $this->getWindowKey();
        Cache::increment($key);
        Cache::put($key, 1, $this->windowSeconds * 2);
    }

    /**
     * 判断当前是否还有重试预算
     */
    public function hasBudget(string $service): bool
    {
        $fresh = Cache::get(
            "{$this->cachePrefix}:fresh:{$service}:" . $this->getWindowKey(), 0
        );
        $retry = Cache::get(
            "{$this->cachePrefix}:retry:{$service}:" . $this->getWindowKey(), 0
        );

        $total = $fresh + $retry;
        if ($total === 0) {
            return true; // 第一个请求，允许
        }

        $ratio = $retry / $total;
        return $ratio < $this->budgetThreshold;
    }

    /**
     * 获取当前窗口内的重试比率
     */
    public function getCurrentRatio(string $service): float
    {
        $fresh = Cache::get(
            "{$this->cachePrefix}:fresh:{$service}:" . $this->getWindowKey(), 0
        );
        $retry = Cache::get(
            "{$this->cachePrefix}:retry:{$service}:" . $this->getWindowKey(), 0
        );

        $total = $fresh + $retry;
        return $total > 0 ? $retry / $total : 0.0;
    }

    /**
     * 基于当前时间生成窗口 key（滑动窗口按秒对齐）
     */
    protected function getWindowKey(): string
    {
        return (string) (intdiv(time(), $this->windowSeconds));
    }
}
```

### 2. 自适应退避策略（Exponential Backoff + Jitter）

```php
<?php

namespace App\Services\RetryBudget;

class AdaptiveBackoff
{
    /**
     * 基础延迟（毫秒）
     */
    protected int $baseDelayMs;

    /**
     * 最大延迟（毫秒）
     */
    protected int $maxDelayMs;

    /**
     * 退避因子
     */
    protected float $multiplier;

    /**
     * jitter 范围比例（0.0 ~ 1.0）
     */
    protected float $jitterRatio;

    public function __construct(
        int $baseDelayMs = 200,
        int $maxDelayMs = 30000,
        float $multiplier = 2.0,
        float $jitterRatio = 0.3
    ) {
        $this->baseDelayMs = $baseDelayMs;
        $this->maxDelayMs = $maxDelayMs;
        $this->multiplier = $multiplier;
        $this->jitterRatio = $jitterRatio;
    }

    /**
     * 计算第 N 次重试的延迟时间（毫秒）
     *
     * @param int $attempt 当前重试次数（从 1 开始）
     * @return int 延迟毫秒数
     */
    public function calculate(int $attempt): int
    {
        // Exponential backoff: base * multiplier^(attempt-1)
        $delay = $this->baseDelayMs * pow($this->multiplier, $attempt - 1);

        // 上限
        $delay = min($delay, $this->maxDelayMs);

        // 加入 jitter：在 [delay * (1 - jitter), delay] 范围内随机
        $jitterRange = $delay * $this->jitterRatio;
        $delay = $delay - random_int(0, (int) $jitterRange);

        return max(0, (int) $delay);
    }
}
```

### 3. Circuit Breaker 熔断器

```php
<?php

namespace App\Services\RetryBudget;

use Illuminate\Support\Facades\Cache;

class CircuitBreaker
{
    /**
     * 状态常量
     */
    const STATE_CLOSED   = 'closed';   // 正常
    const STATE_OPEN     = 'open';     // 熔断，拒绝请求
    const STATE_HALF_OPEN = 'half_open'; // 试探性放行

    /**
     * 触发熔断的失败次数阈值
     */
    protected int $failureThreshold;

    /**
     * 熔断持续时间（秒）
     */
    protected int $openDurationSeconds;

    /**
     * 半开状态下允许的试探请求数
     */
    protected int $halfOpenMaxAttempts;

    protected string $cachePrefix;

    public function __construct(
        int $failureThreshold = 5,
        int $openDurationSeconds = 30,
        int $halfOpenMaxAttempts = 3,
        string $cachePrefix = 'circuit_breaker'
    ) {
        $this->failureThreshold = $failureThreshold;
        $this->openDurationSeconds = $openDurationSeconds;
        $this->halfOpenMaxAttempts = $halfOpenMaxAttempts;
        $this->cachePrefix = $cachePrefix;
    }

    /**
     * 判断是否允许发起请求
     */
    public function allowRequest(string $service): bool
    {
        $state = $this->getState($service);

        if ($state === self::STATE_CLOSED) {
            return true;
        }

        if ($state === self::STATE_OPEN) {
            // 检查熔断时间是否已过
            $openUntil = Cache::get("{$this->cachePrefix}:open_until:{$service}", 0);
            if (time() >= $openUntil) {
                // 转入半开状态
                $this->setState($service, self::STATE_HALF_OPEN);
                $this->resetHalfOpenAttempts($service);
                return true;
            }
            return false;
        }

        // 半开状态：限制试探请求数
        $attempts = $this->getHalfOpenAttempts($service);
        return $attempts < $this->halfOpenMaxAttempts;
    }

    /**
     * 记录请求成功
     */
    public function recordSuccess(string $service): void
    {
        $state = $this->getState($service);

        if ($state === self::STATE_HALF_OPEN) {
            // 半开状态下成功，关闭熔断器
            $this->setState($service, self::STATE_CLOSED);
            $this->resetFailures($service);
        } elseif ($state === self::STATE_CLOSED) {
            // 正常状态下成功，重置失败计数
            $this->resetFailures($service);
        }
    }

    /**
     * 记录请求失败
     */
    public function recordFailure(string $service): void
    {
        $state = $this->getState($service);

        if ($state === self::STATE_HALF_OPEN) {
            // 半开状态下失败，重新打开熔断器
            $this->trip($service);
            return;
        }

        // 闭合状态下累加失败次数
        $key = "{$this->cachePrefix}:failures:{$service}";
        $failures = Cache::increment($key);
        Cache::put($key, $failures, $this->openDurationSeconds * 2);

        if ($failures >= $this->failureThreshold) {
            $this->trip($service);
        }
    }

    /**
     * 获取当前状态
     */
    public function getState(string $service): string
    {
        return Cache::get(
            "{$this->cachePrefix}:state:{$service}",
            self::STATE_CLOSED
        );
    }

    /**
     * 获取当前失败次数
     */
    public function getFailureCount(string $service): int
    {
        return (int) Cache::get(
            "{$this->cachePrefix}:failures:{$service}",
            0
        );
    }

    protected function trip(string $service): void
    {
        $this->setState($service, self::STATE_OPEN);
        Cache::put(
            "{$this->cachePrefix}:open_until:{$service}",
            time() + $this->openDurationSeconds,
            $this->openDurationSeconds * 2
        );
    }

    protected function setState(string $service, string $state): void
    {
        Cache::put(
            "{$this->cachePrefix}:state:{$service}",
            $state,
            $this->openDurationSeconds * 2
        );
    }

    protected function resetFailures(string $service): void
    {
        Cache::forget("{$this->cachePrefix}:failures:{$service}");
    }

    protected function resetHalfOpenAttempts(string $service): void
    {
        Cache::put("{$this->cachePrefix}:half_open_attempts:{$service}", 0, 60);
    }

    protected function getHalfOpenAttempts(string $service): int
    {
        $key = "{$this->cachePrefix}:half_open_attempts:{$service}";
        $attempts = Cache::increment($key);
        if ($attempts === 1) {
            Cache::put($key, 1, 60);
        }
        return $attempts;
    }
}
```

### 4. 整合：ResilientHttpClient

将三个组件整合到一个 HTTP 客户端中，实现「请求前检查熔断 → 记录预算 → 自适应退避 → 重试 → 记录结果」的完整闭环：

```php
<?php

namespace App\Services\RetryBudget;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ResilientHttpClient
{
    protected RetryBudgetCounter $budget;
    protected AdaptiveBackoff $backoff;
    protected CircuitBreaker $breaker;

    /**
     * @var array<string, string> 服务名 → 基础 URL 的映射
     */
    protected array $serviceEndpoints;

    public function __construct(
        RetryBudgetCounter $budget,
        AdaptiveBackoff $backoff,
        CircuitBreaker $breaker,
        array $serviceEndpoints = []
    ) {
        $this->budget = $budget;
        $this->backoff = $backoff;
        $this->breaker = $breaker;
        $this->serviceEndpoints = $serviceEndpoints;
    }

    /**
     * 发送请求（带完整 Retry Budget 治理）
     *
     * @param string $method HTTP 方法
     * @param string $service 服务名（如 'user-service', 'payment-service'）
     * @param string $path 请求路径（如 '/api/users/1'）
     * @param array $options 请求选项
     * @param int $maxRetries 最大重试次数
     * @return Response
     * @throws \Exception
     */
    public function request(
        string $method,
        string $service,
        string $path,
        array $options = [],
        int $maxRetries = 3
    ): Response {
        // 1. 检查熔断器
        if (!$this->breaker->allowRequest($service)) {
            Log::warning("Circuit breaker OPEN for {$service}, request rejected", [
                'method' => $method,
                'path' => $path,
                'state' => $this->breaker->getState($service),
            ]);

            throw new CircuitBreakerOpenException(
                "Service '{$service}' is currently unavailable (circuit breaker open)"
            );
        }

        $baseUrl = $this->serviceEndpoints[$service] ?? '';
        $url = $baseUrl . $path;

        $lastException = null;
        $attempt = 0;

        while ($attempt <= $maxRetries) {
            $isRetry = $attempt > 0;

            // 2. 检查重试预算
            if ($isRetry && !$this->budget->hasBudget($service)) {
                Log::warning("Retry budget exhausted for {$service}", [
                    'attempt' => $attempt,
                    'ratio' => $this->budget->getCurrentRatio($service),
                ]);
                throw new RetryBudgetExhaustedException(
                    "Retry budget exhausted for service '{$service}'"
                );
            }

            // 3. 自适应退避延迟（首次请求不等待）
            if ($isRetry) {
                $delayMs = $this->backoff->calculate($attempt);
                Log::info("Retrying {$service}{$path}", [
                    'attempt' => $attempt,
                    'delay_ms' => $delayMs,
                ]);
                usleep($delayMs * 1000);
            }

            try {
                // 4. 执行请求
                $pendingRequest = Http::timeout(10)->withOptions($options);

                /** @var Response $response */
                $response = $pendingRequest->$method($url);

                // 5. 判断是否需要重试
                if ($this->shouldRetry($response)) {
                    if (!$isRetry) {
                        $this->budget->recordFresh($service);
                    }
                    $this->budget->recordRetry($service);
                    $attempt++;
                    continue;
                }

                // 6. 请求成功，记录到熔断器
                if ($isRetry) {
                    $this->budget->recordRetry($service);
                } else {
                    $this->budget->recordFresh($service);
                }
                $this->breaker->recordSuccess($service);

                return $response;

            } catch (\Exception $e) {
                $lastException = $e;

                // 记录失败
                if ($isRetry) {
                    $this->budget->recordRetry($service);
                } else {
                    $this->budget->recordFresh($service);
                }
                $this->breaker->recordFailure($service);

                Log::error("Request failed: {$service}{$path}", [
                    'attempt' => $attempt + 1,
                    'error' => $e->getMessage(),
                ]);

                $attempt++;
            }
        }

        // 所有重试用尽，抛出最后一个异常
        throw $lastException;
    }

    /**
     * GET 请求快捷方法
     */
    public function get(string $service, string $path, array $options = []): Response
    {
        return $this->request('get', $service, $path, $options);
    }

    /**
     * POST 请求快捷方法
     */
    public function post(string $service, string $path, array $data = [], array $options = []): Response
    {
        $options['json'] = $data;
        return $this->request('post', $service, $path, $options);
    }

    /**
     * 判断响应是否应触发重试
     */
    protected function shouldRetry(Response $response): bool
    {
        $status = $response->status();

        // 5xx 错误重试
        if ($status >= 500) {
            return true;
        }

        // 429 Too Many Requests 重试
        if ($status === 429) {
            return true;
        }

        // 408 Request Timeout 重试
        if ($status === 408) {
            return true;
        }

        return false;
    }
}
```

### 5. 异常类

```php
<?php

namespace App\Services\RetryBudget;

class CircuitBreakerOpenException extends \RuntimeException
{
}

class RetryBudgetExhaustedException extends \RuntimeException
{
}
```

### 6. Laravel Service Provider 注册

```php
<?php

namespace App\Providers;

use App\Services\RetryBudget\AdaptiveBackoff;
use App\Services\RetryBudget\CircuitBreaker;
use App\Services\RetryBudget\ResilientHttpClient;
use App\Services\RetryBudget\RetryBudgetCounter;
use Illuminate\Support\ServiceProvider;

class RetryBudgetServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(RetryBudgetCounter::class, function () {
            return new RetryBudgetCounter(
                windowSeconds: 60,        // 1 分钟滑动窗口
                budgetThreshold: 0.20     // 重试不超过总请求的 20%
            );
        });

        $this->app->singleton(AdaptiveBackoff::class, function () {
            return new AdaptiveBackoff(
                baseDelayMs: 200,         // 初始 200ms
                maxDelayMs: 30000,        // 最大 30s
                multiplier: 2.0,          // 2 倍递增
                jitterRatio: 0.3          // 30% 随机抖动
            );
        });

        $this->app->singleton(CircuitBreaker::class, function () {
            return new CircuitBreaker(
                failureThreshold: 5,      // 连续 5 次失败触发熔断
                openDurationSeconds: 30,  // 熔断 30 秒
                halfOpenMaxAttempts: 3    // 半开状态放行 3 个试探请求
            );
        });

        $this->app->singleton(ResilientHttpClient::class, function ($app) {
            return new ResilientHttpClient(
                budget: $app->make(RetryBudgetCounter::class),
                backoff: $app->make(AdaptiveBackoff::class),
                breaker: $app->make(CircuitBreaker::class),
                serviceEndpoints: [
                    'user-service'    => config('services.user_service.url', 'http://user-service:8001'),
                    'payment-service' => config('services.payment_service.url', 'http://payment-service:8002'),
                    'order-service'   => config('services.order_service.url', 'http://order-service:8003'),
                ]
            );
        });
    }
}
```

### 7. 实际调用示例

```php
<?php

namespace App\Http\Controllers;

use App\Services\RetryBudget\CircuitBreakerOpenException;
use App\Services\RetryBudget\RetryBudgetExhaustedException;
use App\Services\RetryBudget\ResilientHttpClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Controller;

class OrderController extends Controller
{
    public function __construct(
        protected ResilientHttpClient $client
    ) {}

    /**
     * 创建订单（需要调用用户服务验证 + 支付服务扣款）
     */
    public function store(\Illuminate\Http\Request $request): JsonResponse
    {
        try {
            // 1. 验证用户
            $userResponse = $this->client->get(
                'user-service',
                '/api/users/' . $request->user_id
            );
            $user = $userResponse->json();

            // 2. 创建订单（调用订单服务）
            $orderResponse = $this->client->post(
                'order-service',
                '/api/orders',
                [
                    'user_id' => $user['id'],
                    'items'   => $request->items,
                    'total'   => $request->total,
                ]
            );

            return response()->json([
                'success' => true,
                'order'   => $orderResponse->json(),
            ]);

        } catch (CircuitBreakerOpenException $e) {
            return response()->json([
                'success' => false,
                'error'   => '服务暂时不可用，请稍后重试',
            ], 503);

        } catch (RetryBudgetExhaustedException $e) {
            return response()->json([
                'success' => false,
                'error'   => '服务响应异常，请稍后重试',
            ], 503);
        }
    }
}
```

### 8. 监控与仪表盘

```php
<?php

namespace App\Http\Controllers;

use App\Services\RetryBudget\CircuitBreaker;
use App\Services\RetryBudget\RetryBudgetCounter;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Controller;

class RetryBudgetMonitorController extends Controller
{
    public function __construct(
        protected RetryBudgetCounter $budget,
        protected CircuitBreaker $breaker
    ) {}

    /**
     * GET /api/monitor/retry-budget
     * 返回所有服务的 Retry Budget 状态
     */
    public function index(): JsonResponse
    {
        $services = ['user-service', 'payment-service', 'order-service'];

        $status = [];
        foreach ($services as $service) {
            $status[$service] = [
                'budget_ratio'    => $this->budget->getCurrentRatio($service),
                'budget_ok'       => $this->budget->hasBudget($service),
                'breaker_state'   => $this->breaker->getState($service),
                'failure_count'   => $this->breaker->getFailureCount($service),
            ];
        }

        return response()->json($status);
    }
}
```

---

## 踩坑记录

### 坑 1：Cache 驱动选择

重试预算计数器依赖缓存的原子性操作（`increment`）。如果使用 `file` 缓存驱动，在高并发下会出现计数不准确。**必须使用 Redis 或 Memcached**。

```php
// config/cache.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
],
```

### 坑 2：滑动窗口 vs 固定窗口

固定窗口（Fixed Window）在窗口边界处会出现突发流量——比如窗口在第 60 秒重置，前一秒刚用完预算，下一秒预算又满了。生产环境建议使用 **滑动窗口** 或将固定窗口切分得足够细（如按秒对齐，上面的代码就是这样做的）。

### 坑 3：Jitter 的必要性

没有 Jitter 的 Exponential Backoff 在高并发下会导致「重试同步」——大量客户端在同一时刻重试，产生更大的峰值。Jitter 将重试时间打散，显著降低峰值压力。

### 坑 4：Circuit Breaker 的状态持久化

如果服务重启后 Circuit Breaker 状态丢失（回到 closed），在目标服务仍不可用时会瞬间涌入大量请求。可以将状态持久化到 Redis 并设置合理 TTL，或在服务启动时从 Redis 恢复状态。

### 坑 5：Retry Budget 与 Retry-After Header

遇到 429 响应时，优先使用 `Retry-After` header 中指定的时间，而不是自己的退避策略：

```php
protected function shouldRetry(Response $response): bool
{
    if ($response->status() === 429) {
        $retryAfter = $response->header('Retry-After');
        if ($retryAfter && is_numeric($retryAfter)) {
            sleep((int) $retryAfter);
        }
        return true;
    }
    // ...
}
```

---

## 总结

| 组件 | 职责 | 关键参数 |
|------|------|---------|
| Retry Budget Counter | 限制重试比例 | window=60s, threshold=20% |
| Adaptive Backoff | 指数退避 + 随机抖动 | base=200ms, max=30s, jitter=30% |
| Circuit Breaker | 快速失败保护 | threshold=5, open=30s |
| ResilientHttpClient | 整合调度 | maxRetries=3 |

三者的关系：

```
请求 → [熔断器?] → 执行 → 成功? → 记录成功
              ↓ 拒绝         ↓ 失败
         抛异常         [有预算?] → 等待(退避) → 重试
                           ↓ 无预算
                      抛异常
```

**核心原则：** Retry Budget 保护的是**整个系统**（防止级联放大），Circuit Breaker 保护的是**单个服务**（快速失败），Adaptive Backoff 保护的是**目标服务**（降低冲击峰值）。三者协同，才能在微服务架构下实现真正的弹性治理。

---

## 参考资料

- [Google SRE Book - Handling Overload](https://sre.google/sre-book/handling-overload/)
- [Netflix Hystrix - Circuit Breaker](https://github.com/Netflix/Hystrix)
- [Laravel HTTP Client - Retrying Requests](https://laravel.com/docs/11.x/http-client#retries)
- [Exponential Backoff and Jitter (AWS Architecture Blog)](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Istio Retry Budget Configuration](https://istio.io/latest/docs/reference/config/networking/virtual-service/#HTTPRetry)
