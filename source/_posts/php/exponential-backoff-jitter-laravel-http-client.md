---
title: 重试与退避策略实战：Exponential Backoff + Jitter——Laravel HTTP Client 的韧性设计模式
date: 2026-06-02 00:00:00
tags: [重试策略, Exponential Backoff, Jitter, Laravel, HTTP Client, 韧性设计]
keywords: [Exponential Backoff, Jitter, Laravel HTTP Client, 重试与退避策略实战, 的韧性设计模式, PHP]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 在微服务架构中，粗暴的重试会引发惊群效应，将瞬时故障放大为持续性过载。本文深入 Exponential Backoff + Jitter 算法原理，在 Laravel HTTP Client 中构建生产级韧性调用体系。涵盖重试预算限制、断路器模式、幂等键设计、Swoole 协程环境适配等进阶话题，含完整代码实现与 Prometheus 监控集成，帮助 B2C 电商团队应对外部 API 瞬态故障，保障系统高可用。
---


# 重试与退避策略实战：Exponential Backoff + Jitter——Laravel HTTP Client 的韧性设计模式

## 前言

在微服务架构中，你的 Laravel API 平均每次请求会调用 3-5 个外部服务：支付网关、物流 API、短信服务、推荐引擎……任何一个瞬时故障都可能导致用户看到 500 错误页。

重试是应对瞬态故障最简单有效的手段，但粗暴的重试（立即重试、固定间隔重试）可能引发"惊群效应"——所有客户端同时重试，把一个瞬时故障放大为持续性过载。

本文将深入 Exponential Backoff + Jitter 算法，在 Laravel HTTP Client 中构建生产级的韧性调用体系。

---

## 一、为什么需要重试策略

### 1.1 瞬态故障的分类

| 故障类型 | 示例 | 重试有效？ |
|---------|------|-----------|
| 网络抖动 | TCP 连接超时、DNS 解析延迟 | ✅ 有效 |
| 服务过载 | HTTP 503、429 Too Many Requests | ✅ 有效（需退避） |
| 限流触发 | Rate Limit Exceeded | ✅ 有效（需等待） |
| 服务崩溃 | HTTP 500、进程 OOM | ⚠️ 短期内可能恢复 |
| 配置错误 | HTTP 401/403 | ❌ 重试无意义 |
| 业务错误 | HTTP 422 Validation Error | ❌ 重试无意义 |

### 1.2 粗暴重试的灾难

假设一个支付 API 短暂不可用，100 个 Laravel Worker 同时发起重试：

```
时间线：
T=0s   支付 API 故障
T=1s   100 个 Worker 同时重试 → API 压力 ×2
T=2s   100 个 Worker 再次重试 → API 压力 ×3
T=3s   API 完全崩溃（被重试流量压垮）
```

这就是**惊群效应（Thundering Herd）**——重试非但没有解决问题，反而加重了故障。

---

## 二、Exponential Backoff 算法

### 2.1 基本原理

每次重试的等待时间呈指数增长：

```
wait_time = base * 2^attempt

base = 1s 时：
第 1 次重试: 等待 1s
第 2 次重试: 等待 2s
第 3 次重试: 等待 4s
第 4 次重试: 等待 8s
第 5 次重试: 等待 16s
```

### 2.2 带最大上限的 Exponential Backoff

防止等待时间过长：

```
wait_time = min(base * 2^attempt, max_delay)

base = 1s, max_delay = 30s 时：
第 1 次: 1s
第 2 次: 2s
第 3 次: 4s
第 4 次: 8s
第 5 次: 16s
第 6 次: 30s (上限)
第 7 次: 30s (上限)
```

### 2.3 PHP 实现

```php
class ExponentialBackoff
{
    public function __construct(
        private readonly float $baseDelay = 1.0,
        private readonly float $maxDelay = 30.0,
        private readonly float $multiplier = 2.0,
    ) {}

    public function getDelay(int $attempt): float
    {
        $delay = $this->baseDelay * pow($this->multiplier, $attempt);
        return min($delay, $this->maxDelay);
    }
}

// 使用
$backoff = new ExponentialBackoff(baseDelay: 1.0, maxDelay: 30.0);
$backoff->getDelay(0); // 1.0s
$backoff->getDelay(1); // 2.0s
$backoff->getDelay(2); // 4.0s
$backoff->getDelay(5); // 30.0s (上限)
```

---

## 三、Jitter：消除惊群效应的关键

### 3.1 为什么需要 Jitter

即使使用 Exponential Backoff，如果 100 个客户端在 T=0s 同时失败，它们会在相同的时间点重试：

```
100 个客户端，base=1s:
T=1s: 全部 100 个同时重试
T=2s: 全部 100 个同时重试
T=4s: 全部 100 个同时重试
```

Jitter 通过添加随机抖动，让重试时间分散开来。

### 3.2 三种 Jitter 策略

AWS Architecture Blog 推荐了三种 Jitter 策略：

**Full Jitter（完全随机）**
```
delay = random(0, base * 2^attempt)
```
范围最广，分散效果最好，但平均等待时间较短。

**Equal Jitter（等分随机）**
```
delay = base * 2^attempt / 2 + random(0, base * 2^attempt / 2)
```
保证最小等待时间（一半），同时保持随机性。

**Decorrelated Jitter（去相关随机）**
```
delay = min(max_delay, random(base, prev_delay * 3))
```
下一次延迟与上一次相关，但仍有随机性。适合需要逐步探索最优等待时间的场景。

### 3.3 PHP 实现

```php
class JitterStrategy
{
    /**
     * Full Jitter: 最大化分散，但平均等待时间较短
     * delay = random(0, min(base * 2^attempt, max_delay))
     */
    public static function full(
        int $attempt,
        float $base = 1.0,
        float $maxDelay = 30.0,
    ): float {
        $ceiling = min($base * pow(2, $attempt), $maxDelay);
        return mt_rand(0, (int)($ceiling * 1000)) / 1000;
    }

    /**
     * Equal Jitter: 保证最小等待时间
     * delay = half + random(0, half)
     */
    public static function equal(
        int $attempt,
        float $base = 1.0,
        float $maxDelay = 30.0,
    ): float {
        $ceiling = min($base * pow(2, $attempt), $maxDelay);
        $half = $ceiling / 2;
        return $half + (mt_rand(0, (int)($half * 1000)) / 1000);
    }

    /**
     * Decorrelated Jitter: 与上一次延迟相关
     * delay = min(max_delay, random(base, prev_delay * 3))
     */
    public static function decorrelated(
        float $prevDelay,
        float $base = 1.0,
        float $maxDelay = 30.0,
    ): float {
        $ceiling = min($maxDelay, $prevDelay * 3);
        $delay = $base + (mt_rand((int)($base * 1000), (int)($ceiling * 1000)) / 1000);
        return min($delay, $maxDelay);
    }
}
```

### 3.4 Jitter 效果对比

模拟 100 个客户端同时失败后的重试分布：

```
无 Jitter (Pure Exponential):
T=1s ████████████████████ 100 个
T=2s ████████████████████ 100 个
T=4s ████████████████████ 100 个

Full Jitter:
T=0-1s ████████████████████ 50 个 (平均)
T=1-2s ██████████████ 35 个
T=2-4s ██████████ 25 个
...

Equal Jitter:
T=0.5-1s █████████████ 40 个
T=1-2s ████████████████ 50 个
T=2-4s ██████████ 30 个
```

**AWS 的建议：默认使用 Full Jitter**，在高竞争场景下表现最好。

---

## 四、Laravel HTTP Client 重试配置

### 4.1 内置 retry() 方法

Laravel 的 HTTP Client 基于 Guzzle，原生支持重试：

```php
use Illuminate\Support\Facades\Http;

$response = Http::retry([
    'times' => 3,               // 最多重试 3 次
    'sleep' => 1000,            // 每次重试间隔 1000ms（固定间隔，不推荐）
])->timeout(5)->get('https://api.payment.com/charge');
```

### 4.2 使用 Exponential Backoff + Jitter

```php
use Illuminate\Support\Facades\Http;

$response = Http::retry([
    'times' => 5,
    'sleepMilliseconds' => function (int $attempt) {
        // Exponential Backoff + Full Jitter
        $base = 1000; // 1 秒
        $maxDelay = 30000; // 30 秒
        $ceiling = min($base * pow(2, $attempt), $maxDelay);
        return random_int(0, $ceiling);
    },
    'throw' => false, // 不在重试用尽后抛异常
])->timeout(10)->get('https://api.payment.com/charge');
```

### 4.3 自定义重试中间件（更精细控制）

```php
// app/Http/Client/Middleware/RetryWithBackoff.php
class RetryWithBackoff
{
    public function __construct(
        private readonly int $maxRetries = 3,
        private readonly float $baseDelay = 1.0,
        private readonly float $maxDelay = 30.0,
        private readonly string $jitterType = 'full',
        private readonly array $retryableStatuses = [408, 429, 500, 502, 503, 504],
    ) {}

    public function __invoke(callable $handler): callable
    {
        return function (RequestInterface $request, array $options) use ($handler) {
            $retryCount = 0;

            $promise = $handler($request, $options);

            return $promise->then(
                function (ResponseInterface $response) use ($request, $options, $handler, &$retryCount) {
                    if (!$this->shouldRetry($response, $retryCount)) {
                        return $response;
                    }

                    return $this->doRetry($request, $options, $handler, $retryCount, $response);
                },
                function (\Exception $e) use ($request, $options, $handler, &$retryCount) {
                    if (!$this->shouldRetryOnException($e, $retryCount)) {
                        throw $e;
                    }

                    return $this->doRetry($request, $options, $handler, $retryCount);
                }
            );
        };
    }

    protected function shouldRetry(ResponseInterface $response, int &$retryCount): bool
    {
        if ($retryCount >= $this->maxRetries) {
            return false;
        }

        return in_array($response->getStatusCode(), $this->retryableStatuses);
    }

    protected function shouldRetryOnException(\Exception $e, int &$retryCount): bool
    {
        if ($retryCount >= $this->maxRetries) {
            return false;
        }

        // 连接超时、DNS 解析失败等瞬态错误
        return $e instanceof ConnectException
            || $e instanceof RequestException;
    }

    protected function delay(int $attempt): int
    {
        return match ($this->jitterType) {
            'full' => JitterStrategy::full($attempt, $this->baseDelay, $this->maxDelay),
            'equal' => JitterStrategy::equal($attempt, $this->baseDelay, $this->maxDelay),
            'decorrelated' => JitterStrategy::decorrelated(
                $this->baseDelay * pow(2, max(0, $attempt - 1)),
                $this->baseDelay,
                $this->maxDelay
            ),
        } * 1000; // 转为毫秒
    }
}
```

### 4.4 封装 ResilientHttpClient

```php
// app/Services/Http/ResilientHttpClient.php
class ResilientHttpClient
{
    private PendingRequest $client;

    public function __construct(
        private readonly int $retries = 3,
        private readonly int $timeoutSeconds = 10,
        private readonly string $jitterType = 'full',
    ) {
        $this->client = Http::timeout($this->timeoutSeconds)
            ->retry([
                'times' => $this->retries,
                'sleepMilliseconds' => fn(int $attempt) => $this->calculateDelay($attempt),
                'throw' => false,
            ])
            ->withHeaders([
                'X-Request-ID' => Str::uuid()->toString(),
                'X-Retry-Policy' => "{$this->retries}-exponential-{$this->jitterType}",
            ]);
    }

    protected function calculateDelay(int $attempt): int
    {
        $base = 1000;
        $max = 30000;

        return match ($this->jitterType) {
            'full' => random_int(0, min($base * pow(2, $attempt), $max)),
            'equal' => $ceiling = min($base * pow(2, $attempt), $max),
            'decorrelated' => random_int($base, min($max, $base * pow(2, $attempt) * 3)),
        };
    }

    public function get(string $url, array $query = []): Response
    {
        return $this->client->get($url, $query);
    }

    public function post(string $url, array $data = []): Response
    {
        return $this->client->post($url, $data);
    }

    public function withToken(string $token): static
    {
        $this->client = $this->client->withToken($token);
        return $this;
    }
}

// 使用
$client = new ResilientHttpClient(retries: 5, jitterType: 'full');
$response = $client->withToken($apiKey)->post('https://api.payment.com/charge', [
    'amount' => 9900,
    'currency' => 'JPY',
]);
```

---

## 五、高级重试模式

### 5.1 带 Retry-After 头的智能重试

```php
class SmartRetryClient
{
    public function requestWithRetry(string $method, string $url, array $options = []): Response
    {
        $maxRetries = 5;
        $attempt = 0;

        while ($attempt < $maxRetries) {
            $response = Http::timeout(10)->$method($url, $options);

            if ($response->successful()) {
                return $response;
            }

            if ($response->status() === 429) {
                // 尊重 Retry-After 头
                $retryAfter = $response->header('Retry-After');
                if ($retryAfter && is_numeric($retryAfter)) {
                    $delay = (int)$retryAfter * 1000;
                } else {
                    $delay = JitterStrategy::full($attempt) * 1000;
                }
            } elseif (in_array($response->status(), [500, 502, 503, 504])) {
                $delay = JitterStrategy::full($attempt) * 1000;
            } else {
                // 4xx 错误（非 429）不重试
                return $response;
            }

            usleep($delay * 1000);
            $attempt++;
        }

        return $response; // 返回最后一次响应
    }
}
```

### 5.2 重试预算（Retry Budget）

限制重试的总体占比，防止重试流量超过正常流量：

```php
class RetryBudget
{
    private int $requestCount = 0;
    private int $retryCount = 0;

    public function __construct(
        private readonly float $maxRetryRatio = 0.2, // 重试不超过总请求的 20%
        private readonly int $minRequestsForBudget = 10, // 至少 10 个请求后才启用预算
    ) {}

    public function canRetry(): bool
    {
        $this->requestCount++;

        if ($this->requestCount < $this->minRequestsForBudget) {
            return true; // 请求量少时不限制
        }

        $currentRatio = $this->retryCount / $this->requestCount;

        if ($currentRatio >= $this->maxRetryRatio) {
            Log::warning('重试预算耗尽', [
                'request_count' => $this->requestCount,
                'retry_count' => $this->retryCount,
                'ratio' => $currentRatio,
            ]);
            return false;
        }

        $this->retryCount++;
        return true;
    }

    public function reset(): void
    {
        $this->requestCount = 0;
        $this->retryCount = 0;
    }
}

// 全局重试预算
$retryBudget = app(RetryBudget::class);

$response = Http::retry([
    'times' => 3,
    'sleepMilliseconds' => fn(int $attempt) => JitterStrategy::full($attempt) * 1000,
    'when' => fn() => $retryBudget->canRetry(),
])->get('https://api.external.com/data');
```

### 5.3 幂等性保证

重试的前提是操作幂等——多次执行与一次执行效果相同：

```php
class IdempotentPayment
{
    public function charge(float $amount, string $currency): PaymentResult
    {
        // 使用幂等键确保重试安全
        $idempotencyKey = Str::uuid()->toString();

        return Http::retry([
            'times' => 3,
            'sleepMilliseconds' => fn(int $attempt) => JitterStrategy::full($attempt) * 1000,
        ])
        ->withHeaders([
            'Idempotency-Key' => $idempotencyKey,
        ])
        ->post('https://api.stripe.com/v1/charges', [
            'amount' => (int)($amount * 100),
            'currency' => $currency,
            'source' => 'tok_visa',
        ])
        ->throw()
        ->json();
    }
}
```

### 5.4 断路器集成

当重试持续失败时，断路器可以快速失败，避免无意义的重试：

```php
// app/Services/Resilience/CircuitBreaker.php
class CircuitBreaker
{
    private const STATE_CLOSED = 'closed';     // 正常
    private const STATE_OPEN = 'open';         // 熔断
    private const STATE_HALF_OPEN = 'half_open'; // 试探

    public function __construct(
        private readonly string $service,
        private readonly int $failureThreshold = 5,
        private readonly int $recoveryTimeout = 30,
        private readonly int $halfOpenMaxAttempts = 3,
    ) {}

    public function execute(callable $action, callable $fallback = null): mixed
    {
        if ($this->isOpen()) {
            if ($this->shouldTryRecovery()) {
                $this->halfOpen();
            } else {
                return $fallback ? $fallback() : throw new CircuitOpenException($this->service);
            }
        }

        try {
            $result = $action();
            $this->recordSuccess();
            return $result;
        } catch (\Throwable $e) {
            $this->recordFailure();
            throw $e;
        }
    }

    protected function isOpen(): bool
    {
        return Cache::get("circuit:{$this->service}:state") === self::STATE_OPEN;
    }

    protected function shouldTryRecovery(): bool
    {
        $openedAt = Cache::get("circuit:{$this->service}:opened_at", 0);
        return time() - $openedAt >= $this->recoveryTimeout;
    }

    protected function halfOpen(): void
    {
        Cache::put("circuit:{$this->service}:state", self::STATE_HALF_OPEN, 60);
    }

    protected function recordSuccess(): void
    {
        Cache::forget("circuit:{$this->service}:failures");
        Cache::put("circuit:{$this->service}:state", self::STATE_CLOSED, 300);
    }

    protected function recordFailure(): void
    {
        $failures = Cache::increment("circuit:{$this->service}:failures");

        if ($failures >= $this->failureThreshold) {
            Cache::put("circuit:{$this->service}:state", self::STATE_OPEN, $this->recoveryTimeout * 2);
            Cache::put("circuit:{$this->service}:opened_at", time(), $this->recoveryTimeout * 2);

            Log::critical("断路器打开: {$this->service}", ['failures' => $failures]);
        }
    }
}
```

---

## 六、Laravel 队列任务的重试策略

### 6.1 Job 自带重试

```php
class ProcessPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;           // 最多重试 5 次
    public int $backoff = 0;         // 使用自定义延迟
    public int $maxExceptions = 3;   // 最大异常次数

    public function __construct(
        public readonly int $orderId,
    ) {}

    public function handle(): void
    {
        $order = Order::findOrFail($this->orderId);
        PaymentService::charge($order);
    }

    /**
     * 自定义 Exponential Backoff 延迟
     */
    public function backoff(): array
    {
        return [
            JitterStrategy::full(0) * 1000,  // 第 1 次: ~0-1s
            JitterStrategy::full(1) * 1000,  // 第 2 次: ~0-2s
            JitterStrategy::full(2) * 1000,  // 第 3 次: ~0-4s
            JitterStrategy::full(3) * 1000,  // 第 4 次: ~0-8s
            JitterStrategy::full(4) * 1000,  // 第 5 次: ~0-16s
        ];
    }

    /**
     * 判断是否应该重试
     */
    public function retryUntil(): \DateTime
    {
        return now()->addMinutes(30); // 30 分钟内可以重试
    }

    /**
     * 失败后的处理
     */
    public function failed(\Throwable $exception): void
    {
        Order::where('id', $this->orderId)->update(['status' => 'payment_failed']);
        Log::error('支付任务最终失败', [
            'order_id' => $this->orderId,
            'exception' => $exception->getMessage(),
        ]);
    }
}
```

### 6.2 队列中间件：重试 + 断路器

```php
// app/Jobs/Middleware/RetryWithCircuitBreaker.php
class RetryWithCircuitBreaker
{
    public function __construct(
        private readonly string $service,
        private readonly int $maxRetries = 3,
    ) {}

    public function handle(object $job, \Closure $next): void
    {
        $circuitBreaker = app(CircuitBreaker::class, ['service' => $this->service]);
        $retryCount = 0;

        $circuitBreaker->execute(
            action: function () use ($job, &$retryCount) {
                while ($retryCount < $this->maxRetries) {
                    try {
                        $job->handle();
                        return;
                    } catch (\Throwable $e) {
                        $retryCount++;
                        if ($retryCount >= $this->maxRetries) {
                            throw $e;
                        }

                        $delay = JitterStrategy::full($retryCount) * 1000;
                        usleep($delay * 1000);
                    }
                }
            },
            fallback: function () use ($job) {
                // 断路器打开时，延迟任务而不是立即失败
                $job->release(now()->addMinutes(5));
            }
        );

        $next($job);
    }
}

// 在 Job 中使用
class CallExternalAPI implements ShouldQueue
{
    public function middleware(): array
    {
        return [new RetryWithCircuitBreaker('external-api')];
    }
}
```

---

## 七、测试重试策略

### 7.1 单元测试

```php
// tests/Unit/Services/RetryStrategyTest.php
class RetryStrategyTest extends TestCase
{
    public function test_exponential_backoff_delays_increase(): void
    {
        $backoff = new ExponentialBackoff(baseDelay: 1.0, maxDelay: 30.0);

        $this->assertEquals(1.0, $backoff->getDelay(0));
        $this->assertEquals(2.0, $backoff->getDelay(1));
        $this->assertEquals(4.0, $backoff->getDelay(2));
        $this->assertEquals(8.0, $backoff->getDelay(3));
    }

    public function test_delay_never_exceeds_max(): void
    {
        $backoff = new ExponentialBackoff(baseDelay: 1.0, maxDelay: 10.0);

        $this->assertLessThanOrEqual(10.0, $backoff->getDelay(10));
        $this->assertLessThanOrEqual(10.0, $backoff->getDelay(20));
    }

    public function test_full_jitter_returns_within_range(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $delay = JitterStrategy::full(attempt: 3, base: 1.0, maxDelay: 30.0);
            $this->assertGreaterThanOrEqual(0, $delay);
            $this->assertLessThanOrEqual(8.0, $delay); // min(1 * 2^3, 30) = 8
        }
    }

    public function test_equal_jitter_guarantees_minimum(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $delay = JitterStrategy::equal(attempt: 3, base: 1.0, maxDelay: 30.0);
            $this->assertGreaterThanOrEqual(4.0, $delay); // 8 / 2 = 4
            $this->assertLessThanOrEqual(8.0, $delay);
        }
    }
}
```

### 7.2 HTTP Mock 测试

```php
class PaymentClientRetryTest extends TestCase
{
    public function test_retries_on_503_then_succeeds(): void
    {
        Http::fake([
            'api.payment.com/*' => Http::sequence()
                ->push('', 503)  // 第 1 次: 503
                ->push('', 503)  // 第 2 次: 503
                ->push(['status' => 'success'], 200),  // 第 3 次: 成功
        ]);

        $client = new ResilientHttpClient(retries: 3);
        $response = $client->post('https://api.payment.com/charge', ['amount' => 100]);

        $this->assertTrue($response->successful());
        Http::assertSentCount(3);
    }

    public function test_gives_up_after_max_retries(): void
    {
        Http::fake([
            'api.payment.com/*' => Http::response('', 503),
        ]);

        $client = new ResilientHttpClient(retries: 3);
        $response = $client->post('https://api.payment.com/charge', ['amount' => 100]);

        $this->assertEquals(503, $response->status());
        Http::assertSentCount(4); // 1 initial + 3 retries
    }

    public function test_does_not_retry_on_422(): void
    {
        Http::fake([
            'api.payment.com/*' => Http::response(['error' => 'Invalid'], 422),
        ]);

        $client = new ResilientHttpClient(retries: 3);
        $response = $client->post('https://api.payment.com/charge', ['amount' => -1]);

        $this->assertEquals(422, $response->status());
        Http::assertSentCount(1); // 不重试
    }
}
```

---

## 八、监控与可观测性

### 8.1 重试指标收集

```php
// app/Services/RetryMetrics.php
class RetryMetrics
{
    public function recordRetry(string $service, int $attempt, string $reason): void
    {
        // Prometheus 计数器
        app(Prometheus::class)->getOrRegisterCounter(
            'http_client_retries_total',
            'Total HTTP client retries',
            ['service', 'attempt', 'reason']
        )->inc([$service, (string)$attempt, $reason]);

        // 日志
        Log::info('HTTP 重试', [
            'service' => $service,
            'attempt' => $attempt,
            'reason' => $reason,
        ]);
    }

    public function recordRetryBudgetExhausted(string $service): void
    {
        app(Prometheus::class)->getOrRegisterCounter(
            'retry_budget_exhausted_total',
            'Retry budget exhaustion events',
            ['service']
        )->inc([$service]);
    }
}
```

### 8.2 Grafana 告警规则

```yaml
groups:
  - name: retry_alerts
    rules:
      # 重试率过高
      - alert: HighRetryRate
        expr: |
          rate(http_client_retries_total[5m])
          /
          rate(http_client_requests_total[5m]) > 0.1
        for: 5m
        annotations:
          summary: "HTTP 重试率超过 10%"

      # 重试预算耗尽
      - alert: RetryBudgetExhausted
        expr: rate(retry_budget_exhausted_total[5m]) > 0
        for: 1m
        annotations:
          summary: "重试预算已耗尽，部分请求被拒绝重试"
```

---

## 九、最佳实践总结

### 9.1 策略选择指南

| 场景 | 推荐策略 | 原因 |
|------|---------|------|
| 外部 API 调用 | Exponential + Full Jitter | 高并发下分散效果最好 |
| 数据库重连 | Exponential + Equal Jitter | 保证最小等待避免频繁连接 |
| 队列任务重试 | 指数递增延迟 | 队列本身已分散 |
| 限流场景 (429) | Respect Retry-After | 尊重服务端指示 |

### 9.2 重试检查清单

- [ ] 只重试幂等操作
- [ ] 设置最大重试次数
- [ ] 使用 Exponential Backoff + Jitter
- [ ] 设置最大延迟上限
- [ ] 区分可重试和不可重试的错误码
- [ ] 实现重试预算限制
- [ ] 集成断路器
- [ ] 记录重试指标用于监控
- [ ] 为关键操作设置幂等键
- [ ] 测试重试逻辑

---

## 总结

重试策略看似简单，但在分布式系统中是韧性的基石：

1. **Exponential Backoff** 防止客户端在服务端恢复前持续施压
2. **Jitter** 消除惊群效应，是大规模系统的关键差异化因素
3. **重试预算** 防止重试流量占总流量比例失控
4. **断路器** 在持续失败时快速失败，保护系统资源
5. **幂等性** 是重试安全的前提条件

从今天开始，为你的每一个外部 API 调用添加正确的重试策略吧。

---

## 相关阅读

- [API 版本控制进阶：URL/Header/MediaType 三种策略的工程实践](/categories/05_PHP/Laravel/API-版本控制进阶-URL-Header-MediaType-三种策略的工程实践/)
- [Laravel Sanctum 实战：SPA/API 令牌认证与移动端适配](/categories/05_PHP/Laravel/Laravel-Sanctum-实战-SPA-API-令牌认证与移动端适配/)
- [敏感数据保护实战：加密存储、脱敏展示、审计日志合规](/categories/05_PHP/Laravel/敏感数据保护实战-加密存储脱敏展示审计日志合规-Laravel-B2C-API踩坑记录/)
