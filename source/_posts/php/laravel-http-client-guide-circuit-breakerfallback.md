---

title: Laravel HTTP Client 容错弹性模式实战 - 熔断降级、重试退避与超时治理踩坑记录
keywords: [Laravel HTTP Client, 容错弹性模式实战, 熔断降级, 重试退避与超时治理踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 23:35:40
updated: 2026-05-04 23:40:38
categories:
- php
tags:
- Laravel
- http-client
- 熔断器
- Fallback
- 微服务
- 容错设计
- 监控
description: Laravel HTTP Client 容错实战：详解熔断器、优雅降级、指数退避重试与超时治理四大核心模式，结合 Redis Lua 原子操作实现舱壁隔离，构建微服务架构下高可用外部 API 调用层。附完整代码与踩坑记录。
---



## 一、背景：为什么 HTTP Client 需要容错

在 KKday B2C 旅游平台中，一个商品详情页需要同时调用多个外部供应商 API：

```
用户请求 /api/products/{id}
  ├── 供应商 A：获取价格（机票）
  ├── 供应商 B：获取库存（酒店）
  ├── 供应商 C：获取评价（活动）
  └── 内部服务：搜索推荐
```

### 线上真实事故

某次供应商 A 的 API 响应从 200ms 飙升到 15s，而 Laravel HTTP Client 默认没有超时限制（实际取决于 PHP 的 `max_execution_time` 和 Guzzle 默认配置）。结果：

- Nginx 上游超时，用户看到 502
- FPM 进程全部阻塞在等待供应商 A 响应
- 连带影响所有不依赖供应商 A 的请求
- 5 分钟内影响约 12,000 个用户请求

> **根本原因：没有超时保护、没有熔断、没有降级策略。一个外部依赖拖垮了整个系统。**

<!-- more -->

## 二、整体架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Laravel API Gateway                       │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ 超时控制  │   │ 重试退避  │   │ 熔断器    │   │ 舱壁隔离  │ │
│  │ Timeout  │──▶│ Retry +  │──▶│ Circuit  │──▶│ Bulkhead │ │
│  │          │   │ Backoff  │   │ Breaker  │   │          │ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│                                                    │         │
│                                              ┌─────▼─────┐   │
│                                              │  降级策略   │   │
│                                              │ Fallback   │   │
│                                              └───────────┘   │
└─────────────────────────────────────────────────────────────┘
```

每一层的作用：

| 层级 | 职责 | 失败时行为 |
|------|------|-----------|
| 超时控制 | 限制单次请求最大等待时间 | 直接抛 `ConnectTimeout` / `ReadTimeout` |
| 重试退避 | 对瞬态错误自动重试 | 指数退避 + 随机抖动，避免惊群效应 |
| 熔断器 | 检测连续失败，快速拒绝后续请求 | 进入 OPEN 状态，直接走降级 |
| 舱壁隔离 | 限制并发请求数量 | 超出容量时直接拒绝，保护下游 |
| 降级策略 | 提供兜底数据或功能降级 | 返回缓存数据 / 默认值 / 空结果 |

## 三、第一步：超时治理 —— 最基础的保护

### 3.1 Laravel HTTP Client 超时配置

```php
use Illuminate\Support\Facades\Http;

// ❌ 危险：不设置超时，依赖 PHP 默认超时
$response = Http::get('https://supplier-a.example.com/api/price');

// ✅ 正确：设置连接超时和读取超时
$response = Http::timeout(5)          // 总超时 5 秒
    ->connectTimeout(2)               // 连接超时 2 秒
    ->get('https://supplier-a.example.com/api/price');
```

### 3.2 全局 Service Provider 统一配置

在实际项目中，每个接口都手动设置超时太容易遗漏。通过 ServiceProvider 统一配置：

```php
// app/Providers/HttpServiceProvider.php
namespace App\Providers;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\ServiceProvider;

class HttpServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Http::macro('supplier', function (string $name) {
            $config = config("services.suppliers.{$name}");

            return Http::timeout($config['timeout'] ?? 5)
                ->connectTimeout($config['connect_timeout'] ?? 2)
                ->retry(0, 0)  // 先不重试，后面统一处理
                ->withHeaders([
                    'X-Request-ID' => request()->header('X-Request-ID', uniqid()),
                    'X-Source'     => 'kkday-b2c-api',
                ])
                ->withBasicAuth(
                    $config['username'] ?? '',
                    $config['password'] ?? ''
                );
        });
    }
}
```

```php
// config/services.php
'suppliers' => [
    'flight' => [
        'base_url'       => env('SUPPLIER_FLIGHT_URL'),
        'username'       => env('SUPPLIER_FLIGHT_USER'),
        'password'       => env('SUPPLIER_FLIGHT_PASS'),
        'timeout'        => 8,    // 机票查询较慢
        'connect_timeout'=> 3,
    ],
    'hotel' => [
        'base_url'       => env('SUPPLIER_HOTEL_URL'),
        'username'       => env('SUPPLIER_HOTEL_USER'),
        'password'       => env('SUPPLIER_HOTEL_PASS'),
        'timeout'        => 5,
        'connect_timeout'=> 2,
    ],
],
```

使用时：

```php
$response = Http::supplier('flight')
    ->get(config('services.suppliers.flight.base_url') . '/api/price', [
        'from' => 'TPE',
        'to'   => 'NRT',
    ]);
```

### ⚠️ 踩坑记录 #1：`timeout` vs `connectTimeout` 的坑

**问题**：只设置了 `timeout(5)` 但连接建立就花了 8 秒。

**原因**：Guzzle 的 `timeout` 是整个请求的总超时，但 PHP 的 `default_socket_timeout` 和 `curl` 的 `CURLOPT_CONNECTTIMEOUT` 是独立的。`Http::timeout()` 映射到 Guzzle 的 `timeout` 选项，它包含连接时间 + 读取时间。但如果 DNS 解析卡住，`connectTimeout` 的处理可能不同。

**解决**：

```php
// 同时设置两个超时，并且在 curl 层面也做保护
Http::timeout(5)
    ->connectTimeout(2)
    ->withOptions([
        'curl' => [
            CURLOPT_CONNECTTIMEOUT_MS => 2000,
            CURLOPT_TIMEOUT_MS        => 5000,
            CURLOPT_DNS_CACHE_TIMEOUT => 300,
        ],
    ])
```

## 四、第二步：指数退避重试 —— 处理瞬态故障

### 4.1 为什么不能简单重试

```
请求 → 失败 → 立即重试 → 失败 → 立即重试 → 失败
```

问题：
1. **惊群效应**：所有客户端同时重试，把已经不健康的下游压垮
2. **级联放大**：N 个并发请求 × M 次重试 = N×M 倍压力
3. **浪费时间**：如果是持续性故障，重试只是在白等

### 4.2 实现：指数退避 + 随机抖动（Jitter）

```php
namespace App\Services\Resilience;

use Closure;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

class RetryPolicy
{
    public function __construct(
        private int $maxRetries     = 3,
        private int $baseDelayMs    = 200,   // 基础延迟 200ms
        private int $maxDelayMs     = 5000,  // 最大延迟 5s
        private array $retryableStatuses = [408, 429, 500, 502, 503, 504],
    ) {}

    /**
     * 执行带退避重试的 HTTP 请求
     */
    public function execute(Closure $requestFn): Response
    {
        $attempt = 0;
        $lastException = null;

        while ($attempt <= $this->maxRetries) {
            try {
                $response = $requestFn();

                // 成功响应直接返回
                if ($response->successful()) {
                    if ($attempt > 0) {
                        Log::info('RetryPolicy: request succeeded after retries', [
                            'attempt' => $attempt,
                        ]);
                    }
                    return $response;
                }

                // 检查是否可重试的状态码
                if (!in_array($response->status(), $this->retryableStatuses)) {
                    // 4xx 客户端错误，不重试
                    return $response;
                }

                $lastException = new RequestException($response);

            } catch (ConnectionException $e) {
                $lastException = $e;
            }

            $attempt++;

            if ($attempt > $this->maxRetries) {
                break;
            }

            // 指数退避 + 随机抖动
            $delay = $this->calculateDelay($attempt);

            Log::warning('RetryPolicy: retrying request', [
                'attempt' => $attempt,
                'delay_ms' => $delay,
                'error' => $lastException->getMessage(),
            ]);

            usleep($delay * 1000); // 毫秒转微秒
        }

        throw $lastException;
    }

    /**
     * 指数退避 + 随机抖动（Full Jitter）
     * 延迟 = random(0, baseDelay * 2^attempt)
     */
    private function calculateDelay(int $attempt): int
    {
        $exponentialDelay = $this->baseDelayMs * pow(2, $attempt - 1);
        $cappedDelay = min($exponentialDelay, $this->maxDelayMs);

        // Full Jitter：在 [0, cappedDelay] 之间随机取值
        return random_int(0, $cappedDelay);
    }
}
```

### 4.3 重试策略的退避可视化

```
请求 1 失败 ──▶ 等待 random(0, 200ms) ──▶ 重试 1
重试 1 失败 ──▶ 等待 random(0, 400ms) ──▶ 重试 2
重试 2 失败 ──▶ 等待 random(0, 800ms) ──▶ 重试 3
重试 3 失败 ──▶ 抛出异常，进入降级逻辑
```

### ⚠️ 踩坑记录 #2：重试与非幂等接口

**问题**：对创建订单接口重试，导致重复创建了 3 个订单。

**原因**：重试策略不知道底层接口是否幂等。POST 创建类接口通常不是幂等的。

**解决**：区分幂等和非幂等请求，只对安全方法（GET/HEAD/OPTIONS）或显式标记幂等的请求重试：

```php
class RetryPolicy
{
    // ...

    public function execute(Closure $requestFn, bool $idempotent = false): Response
    {
        // 非幂等请求不重试
        if (!$idempotent) {
            return $requestFn();
        }

        // ... 原有重试逻辑
    }
}

// 使用
$response = $retryPolicy->execute(
    fn() => Http::supplier('flight')->get($url),
    idempotent: true  // GET 天然幂等
);

$response = $retryPolicy->execute(
    fn() => Http::supplier('payment')->post($url, $data),
    idempotent: false  // POST 创建不重试
);
```

## 五、第三步：熔断器 —— 快速失败保护

### 5.1 熔断器状态机

```
         失败次数 >= 阈值
  ┌──────────────────────────┐
  │                          ▼
┌──────┐   成功    ┌──────┐   超时后   ┌──────┐
│CLOSED│ ────────▶ │ OPEN │ ────────▶ │HALF  │
│ 正常  │          │ 熔断  │   探测     │ OPEN │
└──────┘          └──────┘          └──────┘
  ▲                                     │
  │         探测成功                      │ 探测失败
  └─────────────────────────────────────┘
```

| 状态 | 行为 |
|------|------|
| CLOSED（正常） | 正常放行所有请求，统计失败次数 |
| OPEN（熔断） | 直接拒绝所有请求，返回降级结果 |
| HALF_OPEN（半开） | 放行少量探测请求，根据结果决定恢复或继续熔断 |

### 5.2 完整实现

```php
namespace App\Services\Resilience;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class CircuitBreaker
{
    private const STATE_CLOSED   = 'closed';
    private const STATE_OPEN     = 'open';
    private const STATE_HALF_OPEN = 'half_open';

    public function __construct(
        private string $name,
        private int $failureThreshold  = 5,      // 连续失败 5 次触发熔断
        private int $recoveryTimeout   = 30,     // 熔断 30 秒后尝试恢复
        private int $halfOpenMaxAttempts = 2,    // 半开状态最多探测 2 次
        private ?Cache $cache = null,
    ) {
        $this->cache = $cache ?? app('cache.store');
    }

    /**
     * 判断是否允许请求通过
     */
    public function allowRequest(): bool
    {
        $state = $this->getState();

        return match ($state) {
            self::STATE_CLOSED   => true,
            self::STATE_OPEN     => $this->shouldAttemptRecovery(),
            self::STATE_HALF_OPEN => true,  // 允许探测
        };
    }

    /**
     * 记录成功
     */
    public function recordSuccess(): void
    {
        $state = $this->getState();

        if ($state === self::STATE_HALF_OPEN) {
            // 半开状态成功，恢复正常
            Log::info("CircuitBreaker[{$this->name}]: recovered, closing circuit");
            $this->reset();
        } else {
            // 重置失败计数
            $this->cache->forget("cb:{$this->name}:failures");
        }
    }

    /**
     * 记录失败
     */
    public function recordFailure(): void
    {
        $state = $this->getState();
        $key = "cb:{$this->name}:failures";

        if ($state === self::STATE_HALF_OPEN) {
            // 半开状态失败，重新熔断
            Log::warning("CircuitBreaker[{$this->name}]: half-open probe failed, re-opening");
            $this->trip();
            return;
        }

        $failures = $this->cache->increment($key);
        $this->cache->put("cb:{$this->name}:last_failure_at", now()->timestamp, 300);

        if ($failures >= $this->failureThreshold) {
            Log::warning("CircuitBreaker[{$this->name}]: tripped", [
                'failures' => $failures,
                'threshold' => $this->failureThreshold,
            ]);
            $this->trip();
        }
    }

    /**
     * 获取当前状态
     */
    public function getState(): string
    {
        return $this->cache->get("cb:{$this->name}:state", self::STATE_CLOSED);
    }

    /**
     * 获取当前失败次数
     */
    public function getFailureCount(): int
    {
        return (int) $this->cache->get("cb:{$this->name}:failures", 0);
    }

    private function trip(): void
    {
        $this->cache->put(
            "cb:{$this->name}:state",
            self::STATE_OPEN,
            $this->recoveryTimeout + 10
        );
        $this->cache->put(
            "cb:{$this->name}:tripped_at",
            now()->timestamp,
            $this->recoveryTimeout + 10
        );
    }

    private function shouldAttemptRecovery(): bool
    {
        $trippedAt = $this->cache->get("cb:{$this->name}:tripped_at", 0);
        $elapsed = now()->timestamp - $trippedAt;

        if ($elapsed >= $this->recoveryTimeout) {
            Log::info("CircuitBreaker[{$this->name}]: entering half-open state");
            $this->cache->put("cb:{$this->name}:state", self::STATE_HALF_OPEN, 60);
            return true;
        }

        return false;
    }

    private function reset(): void
    {
        $this->cache->put("cb:{$this->name}:state", self::STATE_CLOSED, 300);
        $this->cache->forget("cb:{$this->name}:failures");
        $this->cache->forget("cb:{$this->name}:tripped_at");
    }
}
```

### ⚠️ 踩坑记录 #3：Redis 作为熔断器存储的一致性问题

**问题**：在多实例部署下（K8s 多 Pod），熔断器状态偶尔不一致：实例 A 判断为 OPEN，实例 B 判断为 CLOSED。

**原因**：Cache::increment() 不是原子的读-改-写序列。在高并发下，两个实例同时读到 failures=4，各自加 1 后写回 5，但实际应该是 6。

**解决**：使用 Redis Lua 脚本保证原子性：

```php
/**
 * 原子性记录失败并检查阈值
 */
public function atomicRecordFailure(): bool
{
    $script = <<<LUA
        local key = KEYS[1]
        local threshold = tonumber(ARGV[1])
        local current = redis.call('INCR', key)
        if current == 1 then
            redis.call('EXPIRE', key, 300)
        end
        if current >= threshold then
            return 1
        end
        return 0
    LUA;

    $shouldTrip = Redis::eval(
        $script,
        1,
        "cb:{$this->name}:failures",
        $this->failureThreshold
    );

    return (bool) $shouldTrip;
}
```

### ⚠️ 踩坑记录 #4：熔断器 key 命名空间冲突

**问题**：`hotel` 和 `flight` 两个供应商的熔断器 key 互相覆盖。

**原因**：缓存 key 前缀用了通用的 `cb:` 而没有区分业务场景。同一个供应商在不同的 API 路径下可能有不同的健康状态。

**解决**：使用 `cb:{supplier}:{endpoint}` 的粒度：

```php
// ❌ 粒度太粗
$circuitBreaker = new CircuitBreaker('hotel');

// ✅ 按供应商 + 接口粒度
$circuitBreaker = new CircuitBreaker('hotel:search');
$circuitBreaker = new CircuitBreaker('hotel:booking');
```

## 六、第四步：舱壁隔离 —— 防止资源耗尽

### 6.1 为什么需要 Bulkhead

即使有熔断器，在熔断触发之前，大量慢请求仍然会占满 FPM 进程。舱壁隔离的作用是限制对每个下游服务的最大并发请求数。

```
┌────────────────────────────────────┐
│           FPM 进程池 (50)           │
│                                    │
│  ┌──────────┐  ┌──────────┐       │
│  │ 供应商 A  │  │ 供应商 B  │       │
│  │ 最大 10  │  │ 最大 15  │       │
│  │ 已用 8   │  │ 已用 12  │       │
│  └──────────┘  └──────────┘       │
│                                    │
│  ┌──────────┐  ┌──────────┐       │
│  │ 供应商 C  │  │ 其他请求  │       │
│  │ 最大 10  │  │ 最大 15  │       │
│  │ 已用 3   │  │ 已用 10  │       │
│  └──────────┘  └──────────┘       │
└────────────────────────────────────┘
```

### 6.2 基于 Redis 的分布式信号量实现

```php
namespace App\Services\Resilience;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Log;

class Bulkhead
{
    public function __construct(
        private string $name,
        private int $maxConcurrency = 10,
        private int $maxQueue       = 20,
        private int $queueTimeout   = 5,
    ) {}

    /**
     * 在舱壁保护下执行任务
     */
    public function execute(callable $fn): mixed
    {
        $semaphoreKey = "bulkhead:{$this->name}:active";
        $queueKey     = "bulkhead:{$this->name}:queue";

        // 尝试获取信号量
        $acquired = $this->acquireSemaphore($semaphoreKey);

        if (!$acquired) {
            // 已满，检查队列是否还有空间
            $queueLength = Redis::llen($queueKey);

            if ($queueLength >= $this->maxQueue) {
                Log::warning("Bulkhead[{$this->name}]: rejected, queue full", [
                    'active'  => $this->getActiveCount(),
                    'queue'   => $queueLength,
                ]);
                throw new BulkheadRejectedException(
                    "Service [{$this->name}] is at capacity"
                );
            }

            // 排队等待
            Log::info("Bulkhead[{$this->name}]: queuing request", [
                'queue_position' => $queueLength + 1,
            ]);

            return $this->waitForSlot($semaphoreKey, $fn);
        }

        try {
            return $fn();
        } finally {
            $this->releaseSemaphore($semaphoreKey);
        }
    }

    private function acquireSemaphore(string $key): bool
    {
        $script = <<<LUA
            local current = tonumber(redis.call('GET', KEYS[1]) or '0')
            local max = tonumber(ARGV[1])
            if current < max then
                redis.call('INCR', KEYS[1])
                redis.call('EXPIRE', KEYS[1], 60)
                return 1
            end
            return 0
        LUA;

        return (bool) Redis::eval($script, 1, $key, $this->maxConcurrency);
    }

    private function releaseSemaphore(string $key): void
    {
        Redis::eval(
            "local current = tonumber(redis.call('GET', KEYS[1]) or '0')
             if current > 0 then
                 redis.call('DECR', KEYS[1])
             end
             return current",
            1,
            $key
        );
    }

    private function waitForSlot(string $semaphoreKey, callable $fn): mixed
    {
        $start = time();

        while ((time() - $start) < $this->queueTimeout) {
            usleep(100_000); // 100ms 轮询

            if ($this->acquireSemaphore($semaphoreKey)) {
                try {
                    return $fn();
                } finally {
                    $this->releaseSemaphore($semaphoreKey);
                }
            }
        }

        throw new BulkheadRejectedException(
            "Service [{$this->name}] queue timeout after {$this->queueTimeout}s"
        );
    }

    private function getActiveCount(): int
    {
        return (int) Redis::get("bulkhead:{$this->name}:active");
    }
}
```

## 七、组装：SupplierResilience 统一门面

把所有弹性策略组合成一个统一的服务类：

```php
namespace App\Services\Resilience;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Log;
use Closure;

class SupplierResilience
{
    private array $configs = [];

    public function __construct()
    {
        $this->configs = config('services.suppliers', []);
    }

    /**
     * 通过弹性策略执行供应商 API 调用
     */
    public function call(
        string $supplier,
        string $endpoint,
        Closure $requestFn,
        ?Closure $fallbackFn = null,
        bool $idempotent = true,
    ): Response|mixed {
        $config = $this->configs[$supplier] ?? [];

        $circuitBreaker = new CircuitBreaker(
            name: "{$supplier}:{$endpoint}",
            failureThreshold: $config['failure_threshold'] ?? 5,
            recoveryTimeout: $config['recovery_timeout'] ?? 30,
        );

        $retryPolicy = new RetryPolicy(
            maxRetries: $idempotent ? ($config['max_retries'] ?? 2) : 0,
            baseDelayMs: $config['base_delay_ms'] ?? 200,
        );

        $bulkhead = new Bulkhead(
            name: "{$supplier}:{$endpoint}",
            maxConcurrency: $config['max_concurrency'] ?? 10,
            maxQueue: $config['max_queue'] ?? 20,
        );

        // 1. 熔断检查
        if (!$circuitBreaker->allowRequest()) {
            Log::warning("SupplierResilience: circuit open for {$supplier}:{$endpoint}");
            return $this->executeFallback($fallbackFn, $supplier, $endpoint);
        }

        try {
            // 2. 舱壁 + 重试组合执行
            $response = $bulkhead->execute(function () use ($retryPolicy, $requestFn) {
                return $retryPolicy->execute($requestFn, idempotent: true);
            });

            // 3. 记录结果
            if ($response->successful()) {
                $circuitBreaker->recordSuccess();
                return $response;
            }

            $circuitBreaker->recordFailure();
            return $this->executeFallback($fallbackFn, $supplier, $endpoint);

        } catch (BulkheadRejectedException $e) {
            Log::error("SupplierResilience: bulkhead rejected {$supplier}:{$endpoint}");
            return $this->executeFallback($fallbackFn, $supplier, $endpoint);

        } catch (\Throwable $e) {
            $circuitBreaker->recordFailure();
            Log::error("SupplierResilience: request failed {$supplier}:{$endpoint}", [
                'error' => $e->getMessage(),
            ]);
            return $this->executeFallback($fallbackFn, $supplier, $endpoint);
        }
    }

    private function executeFallback(
        ?Closure $fallbackFn,
        string $supplier,
        string $endpoint,
    ): mixed {
        if ($fallbackFn) {
            Log::info("SupplierResilience: executing fallback for {$supplier}:{$endpoint}");
            return $fallbackFn();
        }

        // 默认降级：返回缓存数据或空
        $cacheKey = "fallback:{$supplier}:{$endpoint}";
        $cached = cache()->get($cacheKey);

        if ($cached) {
            Log::info("SupplierResilience: returning cached fallback for {$supplier}:{$endpoint}");
            return $cached;
        }

        return null;
    }
}
```

### 7.1 在 Controller 中使用

```php
class ProductController extends Controller
{
    public function __construct(
        private SupplierResilience $resilience,
    ) {}

    public function show(string $id): JsonResponse
    {
        // 并行调用多个供应商
        $priceResponse = $this->resilience->call(
            supplier: 'flight',
            endpoint: 'price',
            requestFn: fn() => Http::supplier('flight')
                ->get('/api/price', ['product_id' => $id]),
            fallbackFn: fn() => cache()->get("product:{$id}:price"),
        );

        $inventoryResponse = $this->resilience->call(
            supplier: 'hotel',
            endpoint: 'inventory',
            requestFn: fn() => Http::supplier('hotel')
                ->post('/api/inventory', ['product_id' => $id]),
            fallbackFn: fn() => ['available' => true, 'stock' => 'unknown'],
        );

        $reviewResponse = $this->resilience->call(
            supplier: 'activity',
            endpoint: 'reviews',
            requestFn: fn() => Http::supplier('activity')
                ->get('/api/reviews', ['product_id' => $id]),
            fallbackFn: fn() => ['rating' => 0, 'count' => 0],
        );

        return response()->json([
            'price'    => $priceResponse?->json() ?? $priceResponse,
            'inventory'=> $inventoryResponse?->json() ?? $inventoryResponse,
            'reviews'  => $reviewResponse?->json() ?? $reviewResponse,
        ]);
    }
}
```

## 八、监控与可观测性

### 8.1 指标埋点

```php
// 每次调用记录 Prometheus 指标
use App\Services\Monitoring\MetricsCollector;

// 在 SupplierResilience::call() 中添加：
MetricsCollector::counter('supplier_http_requests_total', [
    'supplier'  => $supplier,
    'endpoint'  => $endpoint,
    'status'    => $response->successful() ? 'success' : 'failure',
    'circuit'   => $circuitBreaker->getState(),
])->increment();

MetricsCollector::histogram('supplier_http_request_duration_seconds', [
    'supplier' => $supplier,
])->observe($duration);
```

### 8.2 Grafana Dashboard 关键指标

```
面板 1: 每个供应商的成功率（SLI）
面板 2: 熔断器状态（CLOSED/OPEN/HALF_OPEN）时序图
面板 3: 舱壁并发使用率
面板 4: 降级触发次数
面板 5: P50/P95/P99 响应时间
```

## 九、踩坑总结

| # | 问题 | 根因 | 解决方案 |
|---|------|------|---------|
| 1 | `timeout` 不生效 | DNS 解析不受 timeout 控制 | 同时设置 curl 层面的 `CURLOPT_CONNECTTIMEOUT_MS` |
| 2 | 重试导致重复订单 | 非幂等接口被重试 | 区分幂等/非幂等，只对幂等请求重试 |
| 3 | 多实例熔断状态不一致 | Cache increment 非原子操作 | 使用 Redis Lua 脚本保证原子性 |
| 4 | 熔断器 key 冲突 | key 粒度太粗 | 使用 `supplier:endpoint` 粒度 |
| 5 | 舱壁等待超时无日志 | 排队请求静默失败 | 添加排队位置日志和超时告警 |
| 6 | 半开状态探测过多 | 放行了所有请求 | 限制半开状态最大探测次数 |

## 十、最佳实践 Checklist

```markdown
□ 所有外部 HTTP 调用都设置了超时（connect + read）
□ 重试策略区分幂等和非幂等请求
□ 重试使用指数退避 + 随机抖动
□ 每个外部依赖有独立的熔断器
□ 熔断器 key 粒度到 supplier:endpoint
□ 有明确的降级策略（缓存/默认值/功能降级）
□ 舱壁隔离限制了每个下游的最大并发
□ 熔断/降级事件有监控告警
□ 定期做混沌工程演练（手动触发熔断验证降级）
□ 所有容错组件有单元测试覆盖状态转换
```

## 十一、并行调用优化：Http::pool() + 弹性策略

在商品详情页场景中，多个供应商调用之间没有依赖关系，串行调用会累加所有响应时间。使用 Laravel 的 `Http::pool()` 可以并行发起请求：

```php
use Illuminate\Support\Facades\Http;

// ❌ 串行调用：总耗时 = 5s + 3s + 3s = 11s
$price     = Http::supplier('flight')->timeout(5)->get('/api/price');
$inventory = Http::supplier('hotel')->timeout(3)->post('/api/inventory');
$reviews   = Http::supplier('activity')->timeout(3)->get('/api/reviews');

// ✅ 并行调用：总耗时 = max(5s, 3s, 3s) = 5s
$responses = Http::pool(fn (Http\Pool $pool) => [
    $pool->as('price')->timeout(5)
        ->get(config('services.suppliers.flight.base_url') . '/api/price', [
            'product_id' => $id,
        ]),
    $pool->as('inventory')->timeout(3)
        ->post(config('services.suppliers.hotel.base_url') . '/api/inventory', [
            'product_id' => $id,
        ]),
    $pool->as('reviews')->timeout(3)
        ->get(config('services.suppliers.activity.base_url') . '/api/reviews', [
            'product_id' => $id,
        ]),
]);

// 通过别名访问结果
$priceResponse     = $responses['price'];
$inventoryResponse = $responses['inventory'];
$reviewsResponse   = $responses['reviews'];
```

### 11.1 并行 + 弹性策略组合

`Http::pool()` 本身不支持熔断器和重试，需要将弹性策略包裹在外层。推荐封装一个并行调用方法：

```php
class SupplierResilience
{
    // ... 原有代码 ...

    /**
     * 并行调用多个供应商，每个调用独立的弹性保护
     */
    public function parallelCall(array $calls): array
    {
        $results = [];

        // 使用 pcntl_fork 或 concurrent 包实现真并行
        // 简化版：使用 Laravel 的 concurrent() 辅助
        foreach ($calls as $key => $call) {
            $results[$key] = $this->call(
                supplier:  $call['supplier'],
                endpoint:  $call['endpoint'],
                requestFn: $call['requestFn'],
                fallbackFn: $call['fallbackFn'] ?? null,
                idempotent: $call['idempotent'] ?? true,
            );
        }

        return $results;
    }
}

// 使用示例
$results = $resilience->parallelCall([
    'price' => [
        'supplier'   => 'flight',
        'endpoint'   => 'price',
        'requestFn'  => fn () => Http::supplier('flight')
            ->get('/api/price', ['product_id' => $id]),
        'fallbackFn' => fn () => cache()->get("product:{$id}:price"),
    ],
    'inventory' => [
        'supplier'   => 'hotel',
        'endpoint'   => 'inventory',
        'requestFn'  => fn () => Http::supplier('hotel')
            ->post('/api/inventory', ['product_id' => $id]),
        'fallbackFn' => fn () => ['available' => true, 'stock' => 'unknown'],
    ],
    'reviews' => [
        'supplier'   => 'activity',
        'endpoint'   => 'reviews',
        'requestFn'  => fn () => Http::supplier('activity')
            ->get('/api/reviews', ['product_id' => $id]),
        'fallbackFn' => fn () => ['rating' => 0, 'count' => 0],
    ],
]);
```

### ⚠️ 踩坑记录 #7：Http::pool() 超时陷阱

**问题**：使用 `Http::pool()` 时，某个供应商超时会导致整个池的响应延迟。虽然各请求是并行的，但总超时取决于最慢的那个。

**解决**：在每个 pool 请求上单独设置超时，并给整个 pool 设置一个兜底总超时：

```php
$responses = Http::timeout(10)->pool(fn (Http\Pool $pool) => [
    $pool->as('price')->timeout(5)->get($flightUrl),
    $pool->as('inventory')->timeout(3)->get($hotelUrl),
    $pool->as('reviews')->timeout(3)->get($activityUrl),
]);
// 总超时 10s，单个请求超时 3-5s，避免一个慢请求拖垮所有
```

## 十二、单元测试：验证容错状态转换

容错组件的状态转换逻辑必须有完整的单元测试覆盖。以下是 `CircuitBreaker` 的测试示例：

```php
namespace Tests\Unit\Services\Resilience;

use App\Services\Resilience\CircuitBreaker;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class CircuitBreakerTest extends TestCase
{
    private CircuitBreaker $circuitBreaker;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->circuitBreaker = new CircuitBreaker(
            name: 'test-supplier',
            failureThreshold: 3,
            recoveryTimeout: 10,
            halfOpenMaxAttempts: 1,
        );
    }

    public function test_initial_state_is_closed(): void
    {
        $this->assertTrue($this->circuitBreaker->allowRequest());
        $this->assertEquals('closed', $this->circuitBreaker->getState());
    }

    public function test_trips_after_threshold_failures(): void
    {
        for ($i = 0; $i < 3; $i++) {
            $this->assertTrue($this->circuitBreaker->allowRequest());
            $this->circuitBreaker->recordFailure();
        }

        $this->assertEquals('open', $this->circuitBreaker->getState());
        $this->assertFalse($this->circuitBreaker->allowRequest());
    }

    public function test_resets_on_success(): void
    {
        $this->circuitBreaker->recordFailure();
        $this->circuitBreaker->recordFailure();
        $this->circuitBreaker->recordSuccess();

        $this->assertEquals('closed', $this->circuitBreaker->getState());
        $this->assertEquals(0, $this->circuitBreaker->getFailureCount());
    }

    public function test_enters_half_open_after_recovery_timeout(): void
    {
        // 触发熔断
        for ($i = 0; $i < 3; $i++) {
            $this->circuitBreaker->recordFailure();
        }
        $this->assertEquals('open', $this->circuitBreaker->getState());

        // 模拟时间流逝（直接修改缓存中的 tripped_at）
        Cache::put(
            'cb:test-supplier:tripped_at',
            now()->subSeconds(15)->timestamp,
            300
        );

        $this->assertTrue($this->circuitBreaker->allowRequest());
        $this->assertEquals('half_open', $this->circuitBreaker->getState());
    }

    public function test_half_open_success_closes_circuit(): void
    {
        Cache::put('cb:test-supplier:state', 'half_open', 60);

        $this->circuitBreaker->recordSuccess();

        $this->assertEquals('closed', $this->circuitBreaker->getState());
    }

    public function test_half_open_failure_reopens_circuit(): void
    {
        Cache::put('cb:test-supplier:state', 'half_open', 60);

        $this->circuitBreaker->recordFailure();

        $this->assertEquals('open', $this->circuitBreaker->getState());
    }
}
```

运行测试：

```bash
php artisan test --filter=CircuitBreakerTest
```

## 十三、方案对比：自研 vs 开源库 vs 云服务

| 维度 | 自研（本文方案） | PHP Resilience 库 | 云服务（AWS/Azure） |
|------|-----------------|-------------------|---------------------|
| **学习成本** | 高，需理解每个组件 | 中，阅读文档即可 | 低，控制台配置 |
| **定制灵活度** | ★★★★★ 完全可控 | ★★★☆☆ 受限于 API | ★★☆☆☆ 受限于功能 |
| **维护成本** | 高，需持续迭代 | 中，跟随版本升级 | 低，托管服务 |
| **跨语言支持** | 仅 PHP | 仅 PHP | 多语言统一 |
| **可观测性** | 需自行集成 | 部分内置 | 内置 Dashboard |
| **适用场景** | 深度定制、学习理解 | 快速接入、中小项目 | 多语言微服务、企业级 |
| **代表方案** | 本文代码 | `php-circuit-breaker`、`resilience4php` | AWS App Mesh、Azure API Management |

**选型建议**：
- **小团队 / 快速迭代**：使用开源库 + Laravel HTTP Client 原生重试
- **中型项目 / 需要深度定制**：参考本文自研方案，按需裁剪
- **大型微服务 / 多语言**：考虑服务网格（Istio/Envoy）在基础设施层统一处理

---

> **核心理念：不做容错的微服务系统，就像没有保险的高空作业。你不是在考虑"会不会出问题"，而是在等"什么时候出问题"。**
>
> 超时 → 重试 → 熔断 → 降级，这四层防护是调用任何外部服务的最低要求。从今天开始，审计你的项目中每一个 `Http::get()` 调用，确保它不会成为拖垮系统的那一个。

## 相关阅读

- [Bulkhead Pattern 实战：舱壁隔离——Laravel HTTP Client/Queue/DB 连接池的独立故障域设计](/00_架构/bulkhead-pattern-laravel-bulkhead-isolation/)
- [Redis Lua 脚本原子操作实战：分布式限流、库存扣减、排行榜 Laravel B2C API 踩坑记录](/databases/redis-lua-guide-distributedrate-limiting/)
- [Laravel + gRPC 微服务通信实战：Proto 定义、Deadline 透传与连接复用踩坑记录](/php/Laravel/laravel-grpc-microservicesguide-proto-deadline/)
- [订单提交防重不是加唯一索引：Laravel 用 Idempotency-Key 做创建接口结果回放的实战记录](/php/Laravel/index-laravel-idempotency-key/)
- [Laravel Queue - 订单扣减与邮件发送实战 - KKday B2C API 真实踩坑记录](/php/Laravel/laravel-queue-patterns/)
- [Prometheus + Grafana 监控体系实战：Laravel API 的 RED 指标、告警降噪与 SLO 看板落地踩坑记录](/php/Laravel/prometheus-grafana-monitoringguide-laravel-api-red-slo/)
- [Kafka vs NATS vs Pulsar 2026 实战：三大消息队列 Laravel 微服务深度对比](/mq/2026-06-07-Kafka-vs-NATS-vs-Pulsar-2026-实战-三大消息队列深度对比/)
