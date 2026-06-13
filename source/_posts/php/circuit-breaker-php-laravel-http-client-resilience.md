---

title: Circuit Breaker 深度实战：PHP 手写熔断器 vs Laravel HTTP Client 的 resilience 模式——从原理到生产落地
keywords: [Circuit Breaker, PHP, vs Laravel HTTP Client, resilience, 深度实战, 手写熔断器, 从原理到生产落地]
date: 2026-06-02 00:00:00
tags:
- circuit breaker
- 熔断器
- Laravel
- Resilience
- 高可用
categories:
- php
description: Circuit Breaker（熔断器）深度实战指南，从状态机原理到生产落地完整覆盖。手写基于 Redis 的分布式熔断器实现三状态机（Closed/Open/Half-Open）、失败计数与慢调用检测、半开探测与自动恢复；对比 Laravel HTTP Client 内置的 retry/timeout 重试机制，封装 ResilientHttpClient 将熔断器与 HTTP Client 结合。实战案例覆盖支付网关熔断降级（队列重试+人工兜底）、推荐服务降级（缓存→热门商品兜底）、Prometheus 指标采集与告警规则配置。适合微服务架构中需要构建高可用服务间调用的 Laravel 团队参考。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---




# Circuit Breaker 深度实战：PHP 手写熔断器 vs Laravel HTTP Client 的 resilience 模式——从原理到生产落地

## 前言

在微服务架构中，服务之间的远程调用是常态。当下游服务出现故障时，如果上游服务持续发送请求，不仅无法得到响应，还会加重下游服务的负担，导致故障蔓延——这就是**级联故障（Cascading Failure）**。

Circuit Breaker（熔断器）模式借鉴了电路中保险丝的原理：当检测到下游服务异常时，自动"断开"电路，停止发送请求，给下游服务恢复的时间。一段时间后，熔断器进入"半开"状态，尝试少量请求探测下游是否恢复，如果恢复则"闭合"电路，恢复正常调用。

本文将深入讲解 Circuit Breaker 的三种状态和算法原理，手写一个基于 Redis 的分布式熔断器，对比 Laravel HTTP Client 内置的重试和超时机制，最终给出生产环境的最佳实践。

## 一、Circuit Breaker 状态机

### 1.1 三种状态

```
                    失败次数超过阈值
    ┌──────────┐ ──────────────────▶ ┌──────────┐
    │          │                     │          │
    │  CLOSED  │                     │   OPEN   │
    │  (正常)  │                     │  (熔断)  │
    │          │ ◀────────────────── │          │
    │          │    探测成功          │          │
    └──────────┘                     └────┬─────┘
         ▲                               │
         │              超时时间到达       │
         │         ┌─────────────────────┘
         │         ▼
         │    ┌──────────┐
         │    │          │
         └────│ HALF-OPEN│
    探测成功   │  (半开)  │
              │          │ ───── 探测失败 ────▶ OPEN
              └──────────┘
```

**Closed（关闭/正常状态）**：
- 所有请求正常通过
- 统计失败次数
- 当失败次数超过阈值，切换到 Open 状态

**Open（打开/熔断状态）**：
- 所有请求立即失败，不发送到下游
- 启动超时计时器
- 超时后切换到 Half-Open 状态

**Half-Open（半开/探测状态）**：
- 允许少量请求通过（探测请求）
- 如果探测成功，切换到 Closed 状态
- 如果探测失败，切换回 Open 状态

### 1.2 关键参数

```php
<?php

/**
 * 熔断器配置
 */
class CircuitBreakerConfig
{
    public function __construct(
        // 失败次数阈值：连续失败多少次触发熔断
        public int $failureThreshold = 5,
        
        // 成功次数阈值：半开状态下连续成功多少次恢复
        public int $successThreshold = 3,
        
        // 熔断持续时间（秒）：Open 状态持续多久后进入 Half-Open
        public int $recoveryTimeout = 30,
        
        // 统计窗口时间（秒）：在这个时间窗口内统计失败次数
        public int $windowSize = 60,
        
        // 半开状态允许的探测请求数
        public int $halfOpenMaxRequests = 3,
        
        // 慢调用阈值（毫秒）：调用时间超过此值视为慢调用
        public int $slowCallThresholdMs = 500,
        
        // 慢调用比例阈值：慢调用比例超过此值触发熔断
        public float $slowCallRateThreshold = 0.5,
    ) {}
}
```

## 二、手写 PHP 熔断器

### 2.1 状态枚举

```php
<?php

namespace App\Resilience\CircuitBreaker;

enum CircuitState: string
{
    case CLOSED = 'closed';
    case OPEN = 'open';
    case HALF_OPEN = 'half_open';
}
```

### 2.2 核心实现

```php
<?php

namespace App\Resilience\CircuitBreaker;

use Illuminate\Support\Facades\Redis;
use Psr\Log\LoggerInterface;

class RedisCircuitBreaker
{
    private string $name;
    private CircuitBreakerConfig $config;
    private LoggerInterface $logger;
    private string $keyPrefix;
    
    public function __construct(
        string $name,
        CircuitBreakerConfig $config,
        LoggerInterface $logger
    ) {
        $this->name = $name;
        $this->config = $config;
        $this->logger = $logger;
        $this->keyPrefix = "circuit_breaker:{$name}";
    }
    
    /**
     * 执行受保护的调用
     */
    public function execute(callable $action, callable $fallback = null): mixed
    {
        // 检查是否允许请求通过
        if (!$this->allowRequest()) {
            $this->logger->warning("Circuit breaker [{$this->name}] is OPEN, request rejected");
            
            if ($fallback) {
                return $fallback(new CircuitBreakerOpenException($this->name));
            }
            
            throw new CircuitBreakerOpenException($this->name);
        }
        
        $startTime = microtime(true);
        
        try {
            $result = $action();
            
            $duration = (microtime(true) - $startTime) * 1000;
            
            // 判断是否为慢调用
            if ($duration > $this->config->slowCallThresholdMs) {
                $this->recordSlowCall();
                $this->logger->info("Circuit breaker [{$this->name}] slow call detected", [
                    'duration_ms' => round($duration, 2),
                ]);
            }
            
            // 记录成功
            $this->recordSuccess();
            
            return $result;
            
        } catch (\Throwable $e) {
            $duration = (microtime(true) - $startTime) * 1000;
            
            // 记录失败
            $this->recordFailure();
            
            $this->logger->error("Circuit breaker [{$this->name}] call failed", [
                'exception' => $e->getMessage(),
                'duration_ms' => round($duration, 2),
            ]);
            
            if ($fallback) {
                return $fallback($e);
            }
            
            throw $e;
        }
    }
    
    /**
     * 检查是否允许请求通过
     */
    protected function allowRequest(): bool
    {
        $state = $this->getState();
        
        return match ($state) {
            CircuitState::CLOSED => true,
            CircuitState::OPEN => $this->shouldAttemptReset(),
            CircuitState::HALF_OPEN => $this->canAllowHalfOpenRequest(),
        };
    }
    
    /**
     * 获取当前状态
     */
    public function getState(): CircuitState
    {
        $stateStr = Redis::hget("{$this->keyPrefix}:state", 'current');
        
        return CircuitState::tryFrom($stateStr) ?? CircuitState::CLOSED;
    }
    
    /**
     * 设置状态
     */
    protected function setState(CircuitState $state): void
    {
        $previousState = $this->getState();
        
        Redis::pipeline(function ($pipe) use ($state) {
            $pipe->hset("{$this->keyPrefix}:state", 'current', $state->value);
            $pipe->hset("{$this->keyPrefix}:state", 'changed_at', time());
            
            if ($state === CircuitState::OPEN) {
                $pipe->hset("{$this->keyPrefix}:state", 'open_until', 
                    time() + $this->config->recoveryTimeout);
            }
            
            if ($state === CircuitState::HALF_OPEN) {
                $pipe->hset("{$this->keyPrefix}:state", 'half_open_requests', 0);
                $pipe->hset("{$this->keyPrefix}:state", 'half_open_successes', 0);
            }
            
            // 切换到 Closed 时重置计数器
            if ($state === CircuitState::CLOSED) {
                $pipe->del("{$this->keyPrefix}:failures");
                $pipe->del("{$this->keyPrefix}:slow_calls");
            }
        });
        
        $this->logger->info("Circuit breaker [{$this->name}] state changed", [
            'from' => $previousState->value,
            'to' => $state->value,
        ]);
    }
    
    /**
     * 判断是否应该尝试重置（Open → Half-Open）
     */
    protected function shouldAttemptReset(): bool
    {
        $openUntil = Redis::hget("{$this->keyPrefix}:state", 'open_until');
        
        if ($openUntil && time() >= (int) $openUntil) {
            $this->setState(CircuitState::HALF_OPEN);
            return true;
        }
        
        return false;
    }
    
    /**
     * 判断半开状态下是否允许请求通过
     */
    protected function canAllowHalfOpenRequest(): bool
    {
        $currentRequests = (int) Redis::hget(
            "{$this->keyPrefix}:state", 'half_open_requests'
        );
        
        return $currentRequests < $this->config->halfOpenMaxRequests;
    }
    
    /**
     * 记录成功
     */
    protected function recordSuccess(): void
    {
        $state = $this->getState();
        
        if ($state === CircuitState::HALF_OPEN) {
            $successes = Redis::hincrby("{$this->keyPrefix}:state", 'half_open_successes', 1);
            
            if ($successes >= $this->config->successThreshold) {
                $this->setState(CircuitState::CLOSED);
            }
        }
        
        if ($state === CircuitState::CLOSED) {
            // 重置连续失败计数
            Redis::del("{$this->keyPrefix}:consecutive_failures");
        }
    }
    
    /**
     * 记录失败
     */
    protected function recordFailure(): void
    {
        $state = $this->getState();
        
        if ($state === CircuitState::HALF_OPEN) {
            // 半开状态下的失败直接切回 Open
            $this->setState(CircuitState::OPEN);
            return;
        }
        
        if ($state === CircuitState::CLOSED) {
            // 增加连续失败计数
            $consecutiveFailures = Redis::incr("{$this->keyPrefix}:consecutive_failures");
            Redis::expire("{$this->keyPrefix}:consecutive_failures", $this->config->windowSize);
            
            // 检查是否超过阈值
            if ($consecutiveFailures >= $this->config->failureThreshold) {
                $this->setState(CircuitState::OPEN);
            }
            
            // 记录窗口内的失败次数（用于统计）
            $windowKey = "{$this->keyPrefix}:failures:" . floor(time() / $this->config->windowSize);
            Redis::incr($windowKey);
            Redis::expire($windowKey, $this->config->windowSize * 2);
        }
    }
    
    /**
     * 记录慢调用
     */
    protected function recordSlowCall(): void
    {
        $windowKey = "{$this->keyPrefix}:slow_calls:" . floor(time() / $this->config->windowSize);
        Redis::incr($windowKey);
        Redis::expire($windowKey, $this->config->windowSize * 2);
    }
    
    /**
     * 获取熔断器统计信息
     */
    public function getStats(): array
    {
        $state = $this->getState();
        $windowKey = "{$this->keyPrefix}:failures:" . floor(time() / $this->config->windowSize);
        $slowWindowKey = "{$this->keyPrefix}:slow_calls:" . floor(time() / $this->config->windowSize);
        
        return [
            'name' => $this->name,
            'state' => $state->value,
            'consecutive_failures' => (int) Redis::get("{$this->keyPrefix}:consecutive_failures"),
            'window_failures' => (int) Redis::get($windowKey),
            'window_slow_calls' => (int) Redis::get($slowWindowKey),
            'state_changed_at' => Redis::hget("{$this->keyPrefix}:state", 'changed_at'),
            'open_until' => Redis::hget("{$this->keyPrefix}:state", 'open_until'),
        ];
    }
    
    /**
     * 手动重置熔断器
     */
    public function reset(): void
    {
        $this->setState(CircuitState::CLOSED);
        Redis::del("{$this->keyPrefix}:consecutive_failures");
        Redis::del("{$this->keyPrefix}:failures");
        Redis::del("{$this->keyPrefix}:slow_calls");
    }
    
    /**
     * 手动触发熔断
     */
    public function trip(): void
    {
        $this->setState(CircuitState::OPEN);
    }
}
```

### 2.3 异常类

```php
<?php

namespace App\Resilience\CircuitBreaker;

class CircuitBreakerOpenException extends \RuntimeException
{
    private string $circuitName;
    
    public function __construct(string $circuitName)
    {
        $this->circuitName = $circuitName;
        parent::__construct(
            "Circuit breaker [{$circuitName}] is OPEN. Request rejected."
        );
    }
    
    public function getCircuitName(): string
    {
        return $this->circuitName;
    }
}
```

### 2.4 熔断器管理器

```php
<?php

namespace App\Resilience\CircuitBreaker;

use Illuminate\Support\Facades\Redis;

/**
 * 熔断器管理器
 * 管理多个熔断器实例，提供统一的监控接口
 */
class CircuitBreakerManager
{
    /** @var array<string, RedisCircuitBreaker> */
    private array $breakers = [];
    
    /**
     * 获取或创建熔断器
     */
    public function breaker(
        string $name,
        ?CircuitBreakerConfig $config = null
    ): RedisCircuitBreaker {
        if (!isset($this->breakers[$name])) {
            $this->breakers[$name] = new RedisCircuitBreaker(
                $name,
                $config ?? new CircuitBreakerConfig(),
                app('log')
            );
        }
        
        return $this->breakers[$name];
    }
    
    /**
     * 获取所有熔断器状态
     */
    public function getAllStats(): array
    {
        return array_map(
            fn($breaker) => $breaker->getStats(),
            $this->breakers
        );
    }
    
    /**
     * 重置所有熔断器
     */
    public function resetAll(): void
    {
        foreach ($this->breakers as $breaker) {
            $breaker->reset();
        }
    }
    
    /**
     * 获取处于 Open 状态的熔断器
     */
    public function getOpenBreakers(): array
    {
        return array_filter(
            $this->getAllStats(),
            fn($stats) => $stats['state'] === CircuitState::OPEN->value
        );
    }
}
```

### 2.5 Laravel Service Provider 注册

```php
<?php

namespace App\Providers;

use App\Resilience\CircuitBreaker\CircuitBreakerConfig;
use App\Resilience\CircuitBreaker\CircuitBreakerManager;
use Illuminate\Support\ServiceProvider;

class CircuitBreakerServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(CircuitBreakerManager::class, function () {
            $manager = new CircuitBreakerManager();
            
            // 预注册常用的熔断器
            $manager->breaker('payment-gateway', new CircuitBreakerConfig(
                failureThreshold: 3,
                recoveryTimeout: 60,
                slowCallThresholdMs: 2000,
            ));
            
            $manager->breaker('user-service', new CircuitBreakerConfig(
                failureThreshold: 5,
                recoveryTimeout: 30,
                slowCallThresholdMs: 500,
            ));
            
            $manager->breaker('item-service', new CircuitBreakerConfig(
                failureThreshold: 10,
                recoveryTimeout: 15,
                slowCallThresholdMs: 300,
            ));
            
            $manager->breaker('recommendation-service', new CircuitBreakerConfig(
                failureThreshold: 5,
                recoveryTimeout: 30,
                slowCallThresholdMs: 200,
            ));
            
            return $manager;
        });
    }
}
```

## 三、Laravel HTTP Client 的 Resilience 模式

### 3.1 Laravel 12.x HTTP Client 增强

Laravel 的 HTTP Client（基于 Guzzle）提供了内置的重试和超时机制：

```php
<?php

use Illuminate\Support\Facades\Http;

// 基础重试
$response = Http::retry(3, 1000)->get('http://user-service/api/users/1');

// 指数退避重试
$response = Http::retry(3, 1000, function ($attempt, $exception) {
    // 指数退避：1s, 2s, 4s
    return 1000 * pow(2, $attempt - 1);
})->get('http://user-service/api/users/1');

// 超时设置
$response = Http::timeout(5)->get('http://user-service/api/users/1');

// 连接超时 + 读取超时
$response = Http::connectTimeout(3)->timeout(10)->get('http://user-service/api/users/1');

// 重试时判断是否需要重试
$response = Http::retry(3, 1000, function ($exception, $request) {
    // 只在服务端错误时重试，客户端错误不重试
    if ($exception instanceof \Illuminate\Http\Client\ConnectionException) {
        return true;
    }
    
    $response = $exception->response;
    if ($response && $response->serverError()) {
        return true;
    }
    
    return false;
}, false)->get('http://user-service/api/users/1');
```

### 3.2 HTTP Client 熔断器封装

将手写的熔断器与 Laravel HTTP Client 结合：

```php
<?php

namespace App\Resilience;

use App\Resilience\CircuitBreaker\CircuitBreakerManager;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

class ResilientHttpClient
{
    private CircuitBreakerManager $breakerManager;
    private string $serviceName;
    private string $baseUrl;
    private array $defaultOptions;
    
    public function __construct(
        CircuitBreakerManager $breakerManager,
        string $serviceName,
        string $baseUrl,
        array $defaultOptions = []
    ) {
        $this->breakerManager = $breakerManager;
        $this->serviceName = $serviceName;
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->defaultOptions = $defaultOptions;
    }
    
    /**
     * 创建带熔断器的 HTTP 请求
     */
    protected function createRequest(): PendingRequest
    {
        $request = Http::baseUrl($this->baseUrl)
            ->timeout($this->defaultOptions['timeout'] ?? 5)
            ->connectTimeout($this->defaultOptions['connect_timeout'] ?? 3)
            ->withHeaders($this->defaultOptions['headers'] ?? [])
            ->retry(
                $this->defaultOptions['retries'] ?? 2,
                $this->defaultOptions['retry_delay_ms'] ?? 500,
            );
        
        return $request;
    }
    
    /**
     * GET 请求（带熔断保护）
     */
    public function get(string $uri, array $query = []): \Illuminate\Http\Client\Response
    {
        $breaker = $this->breakerManager->breaker($this->serviceName);
        
        return $breaker->execute(
            action: function () use ($uri, $query) {
                $response = $this->createRequest()->get($uri, $query);
                
                if ($response->serverError()) {
                    throw new \RuntimeException(
                        "Server error: {$response->status()}"
                    );
                }
                
                return $response;
            },
            fallback: function (\Throwable $e) {
                \Log::warning("Circuit breaker fallback for {$this->serviceName}", [
                    'exception' => $e->getMessage(),
                ]);
                
                // 返回缓存的降级响应
                return $this->getDegradedResponse();
            }
        );
    }
    
    /**
     * POST 请求（带熔断保护）
     */
    public function post(string $uri, array $data = []): \Illuminate\Http\Client\Response
    {
        $breaker = $this->breakerManager->breaker($this->serviceName);
        
        return $breaker->execute(
            action: function () use ($uri, $data) {
                $response = $this->createRequest()->post($uri, $data);
                
                if ($response->serverError()) {
                    throw new \RuntimeException(
                        "Server error: {$response->status()}"
                    );
                }
                
                return $response;
            }
        );
    }
    
    /**
     * 降级响应
     */
    protected function getDegradedResponse(): \Illuminate\Http\Client\Response
    {
        // 返回一个空的成功响应，让调用方处理降级逻辑
        return Http::response([
            'code' => 0,
            'message' => 'Service temporarily unavailable',
            'data' => null,
            'degraded' => true,
        ], 200);
    }
}
```

### 3.3 在 Laravel 中使用

```php
<?php

namespace App\Services;

use App\Resilience\ResilientHttpClient;

class UserService
{
    private ResilientHttpClient $client;
    
    public function __construct(ResilientHttpClient $client)
    {
        $this->client = $client;
    }
    
    public function getUser(int $userId): ?array
    {
        $response = $this->client->get("/api/users/{$userId}");
        
        // 检查是否为降级响应
        if ($response->json('degraded')) {
            // 从缓存获取
            return cache()->get("user:{$userId}");
        }
        
        return $response->json('data');
    }
}

// 服务注册
$this->app->bind(ResilientHttpClient::class, function ($app) {
    return new ResilientHttpClient(
        $app->make(CircuitBreakerManager::class),
        'user-service',
        config('services.user_service.url'),
        [
            'timeout' => 5,
            'connect_timeout' => 3,
            'retries' => 2,
            'retry_delay_ms' => 500,
            'headers' => [
                'X-Service-Name' => 'order-service',
            ],
        ]
    );
});
```

## 四、对比分析

### 4.1 手写熔断器 vs Laravel HTTP Client

| 特性 | 手写熔断器 | Laravel HTTP Client |
|------|-----------|---------------------|
| 熔断状态机 | ✅ 完整的三状态机 | ❌ 无 |
| 失败计数 | ✅ 基于 Redis 分布式计数 | ❌ 无 |
| 慢调用检测 | ✅ 支持 | ❌ 无 |
| 重试机制 | ❌ 需自己实现 | ✅ 内置支持 |
| 退避策略 | ❌ 需自己实现 | ✅ 支持自定义 |
| 超时控制 | ❌ 需自己实现 | ✅ 内置支持 |
| 分布式支持 | ✅ Redis 共享状态 | ❌ 单机 |
| 可观测性 | ✅ 可自定义指标 | ❌ 需额外接入 |
| 复杂度 | 高 | 低 |

### 4.2 推荐方案

**简单场景**：直接使用 Laravel HTTP Client 的 retry + timeout
**中等复杂度**：Laravel HTTP Client + 简单的失败计数熔断
**高可用要求**：手写 Redis 熔断器 + Laravel HTTP Client

## 五、生产环境实战

### 5.1 完整的支付网关集成

```php
<?php

namespace App\Services\Payment;

use App\Resilience\CircuitBreaker\CircuitBreakerConfig;
use App\Resilience\CircuitBreaker\CircuitBreakerManager;
use App\Resilience\CircuitBreaker\CircuitBreakerOpenException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class PaymentGatewayService
{
    private CircuitBreakerManager $breakerManager;
    private string $gatewayUrl;
    private string $apiKey;
    
    public function __construct(
        CircuitBreakerManager $breakerManager
    ) {
        $this->breakerManager = $breakerManager;
        $this->gatewayUrl = config('services.payment.gateway_url');
        $this->apiKey = config('services.payment.api_key');
    }
    
    /**
     * 创建支付
     */
    public function createPayment(array $orderData): PaymentResult
    {
        $breaker = $this->breakerManager->breaker('payment-gateway', new CircuitBreakerConfig(
            failureThreshold: 3,
            recoveryTimeout: 60,
            successThreshold: 2,
            slowCallThresholdMs: 2000,
        ));
        
        try {
            $result = $breaker->execute(
                action: function () use ($orderData) {
                    $response = Http::timeout(10)
                        ->connectTimeout(5)
                        ->retry(2, 1000)
                        ->withHeaders([
                            'Authorization' => "Bearer {$this->apiKey}",
                            'X-Idempotency-Key' => $orderData['order_no'],
                        ])
                        ->post("{$this->gatewayUrl}/v1/payments", [
                            'amount' => $orderData['total_amount'],
                            'currency' => 'CNY',
                            'order_no' => $orderData['order_no'],
                            'description' => "Order {$orderData['order_no']}",
                            'return_url' => $orderData['return_url'],
                            'notify_url' => $orderData['notify_url'],
                        ]);
                    
                    if ($response->failed()) {
                        throw new PaymentException(
                            "Payment gateway error: {$response->status()}",
                            $response->json()
                        );
                    }
                    
                    return new PaymentResult(
                        success: true,
                        paymentId: $response->json('payment_id'),
                        paymentUrl: $response->json('payment_url'),
                    );
                },
                fallback: function (\Throwable $e) use ($orderData) {
                    return $this->handlePaymentFallback($e, $orderData);
                }
            );
            
            return $result;
            
        } catch (CircuitBreakerOpenException $e) {
            // 熔断器打开，记录并返回降级结果
            \Log::critical("Payment circuit breaker is OPEN", [
                'order_no' => $orderData['order_no'],
                'breaker_stats' => $breaker->getStats(),
            ]);
            
            return new PaymentResult(
                success: false,
                error: 'Payment service temporarily unavailable',
                retryable: true,
            );
        }
    }
    
    /**
     * 支付降级处理
     */
    protected function handlePaymentFallback(
        \Throwable $e,
        array $orderData
    ): PaymentResult {
        // 记录异常
        \Log::error("Payment gateway call failed, using fallback", [
            'order_no' => $orderData['order_no'],
            'exception' => $e->getMessage(),
        ]);
        
        // 将支付请求放入队列，稍后重试
        dispatch(new RetryPaymentJob($orderData))
            ->delay(now()->addMinutes(5));
        
        return new PaymentResult(
            success: false,
            error: 'Payment is being processed, please wait',
            retryable: true,
            queued: true,
        );
    }
    
    /**
     * 查询支付状态
     */
    public function getPaymentStatus(string $paymentId): PaymentStatusResult
    {
        $breaker = $this->breakerManager->breaker('payment-gateway');
        
        return $breaker->execute(
            action: function () use ($paymentId) {
                $response = Http::timeout(5)
                    ->retry(2, 500)
                    ->withHeader('Authorization', "Bearer {$this->apiKey}")
                    ->get("{$this->gatewayUrl}/v1/payments/{$paymentId}");
                
                if ($response->failed()) {
                    throw new PaymentException(
                        "Failed to get payment status: {$response->status()}"
                    );
                }
                
                return new PaymentStatusResult(
                    paymentId: $paymentId,
                    status: $response->json('status'),
                    paidAt: $response->json('paid_at'),
                );
            },
            fallback: function () use ($paymentId) {
                // 从本地缓存获取最后已知状态
                $cached = Cache::get("payment_status:{$paymentId}");
                
                return new PaymentStatusResult(
                    paymentId: $paymentId,
                    status: $cached['status'] ?? 'unknown',
                    fromCache: true,
                );
            }
        );
    }
}
```

### 5.2 推荐服务降级策略

```php
<?php

namespace App\Services\Recommendation;

class RecommendationService
{
    private CircuitBreakerManager $breakerManager;
    
    /**
     * 获取推荐结果
     */
    public function getRecommendations(int $userId, string $scene, int $limit = 20): array
    {
        $breaker = $this->breakerManager->breaker('recommendation-service', new CircuitBreakerConfig(
            failureThreshold: 5,
            recoveryTimeout: 30,
            slowCallThresholdMs: 200,
        ));
        
        return $breaker->execute(
            action: function () use ($userId, $scene, $limit) {
                $response = Http::timeout(3)
                    ->retry(1, 200)
                    ->get('http://recommendation-service/api/recommend', [
                        'user_id' => $userId,
                        'scene' => $scene,
                        'limit' => $limit,
                    ]);
                
                if ($response->failed()) {
                    throw new \RuntimeException("Recommendation service error");
                }
                
                return $response->json('data');
            },
            fallback: function () use ($userId, $scene, $limit) {
                // 降级策略 1：使用缓存的推荐结果
                $cached = Cache::get("recommendations:{$userId}:{$scene}");
                
                if ($cached) {
                    return $cached;
                }
                
                // 降级策略 2：使用热门商品
                return $this->getHotItems($scene, $limit);
            }
        );
    }
    
    /**
     * 热门商品降级
     */
    protected function getHotItems(string $scene, int $limit): array
    {
        return Cache::remember("hot_items:{$scene}", 300, function () use ($scene, $limit) {
            return Item::where('status', 'active')
                ->orderByDesc('sales_count_7d')
                ->limit($limit)
                ->get()
                ->toArray();
        });
    }
}
```

## 六、监控与告警

### 6.1 Prometheus 指标采集

```php
<?php

namespace App\Resilience\Monitoring;

use App\Resilience\CircuitBreaker\CircuitBreakerManager;
use Prometheus\CollectorRegistry;

class CircuitBreakerMetricsCollector
{
    private CircuitBreakerManager $manager;
    private CollectorRegistry $registry;
    
    public function __construct(
        CircuitBreakerManager $manager,
        CollectorRegistry $registry
    ) {
        $this->manager = $manager;
        $this->registry = $registry;
    }
    
    /**
     * 注册指标
     */
    public function register(): void
    {
        // 熔断器状态
        $this->registry->registerGauge(
            'circuit_breaker',
            'state',
            'Circuit breaker state (0=closed, 1=open, 2=half_open)',
            ['name']
        );
        
        // 失败计数
        $this->registry->registerCounter(
            'circuit_breaker',
            'failures_total',
            'Total circuit breaker failures',
            ['name']
        );
        
        // 成功计数
        $this->registry->registerCounter(
            'circuit_breaker',
            'successes_total',
            'Total circuit breaker successes',
            ['name']
        );
        
        // 慢调用计数
        $this->registry->registerCounter(
            'circuit_breaker',
            'slow_calls_total',
            'Total slow calls detected',
            ['name']
        );
        
        // 状态变更计数
        $this->registry->registerCounter(
            'circuit_breaker',
            'state_changes_total',
            'Total state changes',
            ['name', 'from', 'to']
        );
    }
    
    /**
     * 采集指标
     */
    public function collect(): void
    {
        $allStats = $this->manager->getAllStats();
        
        foreach ($allStats as $name => $stats) {
            $stateValue = match ($stats['state']) {
                'closed' => 0,
                'open' => 1,
                'half_open' => 2,
                default => -1,
            };
            
            $this->registry->getGauge('circuit_breaker', 'state')
                ->set($stateValue, [$name]);
            
            $this->registry->getCounter('circuit_breaker', 'failures_total')
                ->incBy($stats['window_failures'], [$name]);
        }
    }
}
```

### 6.2 告警规则

```yaml
groups:
  - name: circuit_breaker_alerts
    rules:
      # 熔断器打开告警
      - alert: CircuitBreakerOpen
        expr: circuit_breaker_state == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Circuit breaker {{ $labels.name }} is OPEN"
          description: "The circuit breaker has been open for more than 1 minute"
      
      # 熔断器频繁切换
      - alert: CircuitBreakerFlapping
        expr: increase(circuit_breaker_state_changes_total[5m]) > 5
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Circuit breaker {{ $labels.name }} is flapping"
          description: "State changed {{ $value }} times in 5 minutes"
      
      # 慢调用比例过高
      - alert: CircuitBreakerHighSlowCallRate
        expr: |
          rate(circuit_breaker_slow_calls_total[5m]) / 
          (rate(circuit_breaker_successes_total[5m]) + rate(circuit_breaker_failures_total[5m])) > 0.3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High slow call rate for {{ $labels.name }}"
```

## 七、总结

### 7.1 选型建议

| 场景 | 推荐方案 |
|------|---------|
| 内部服务调用，低并发 | Laravel HTTP Client retry + timeout |
| 外部 API 调用，中等并发 | Laravel HTTP Client + 简单计数熔断 |
| 核心链路，高可用要求 | Redis 分布式熔断器 + 完整降级策略 |
| 支付等关键路径 | 熔断器 + 队列重试 + 人工兜底 |

### 7.2 最佳实践

1. **分层防护**：超时 → 重试 → 熔断 → 降级，层层递进
2. **合理阈值**：根据下游服务的实际能力设置阈值，不要一刀切
3. **降级先行**：熔断前必须有降级方案，否则熔断等于直接报错
4. **监控告警**：熔断器状态必须监控，状态变更必须告警
5. **定期演练**：通过混沌工程定期验证熔断和降级是否正常工作
6. **避免级联**：每个服务的熔断器独立配置，避免一个服务的熔断导致整条链路不可用

Circuit Breaker 不是万能的，它只是弹性架构中的一环。结合限流、降级、重试、超时等手段，才能构建真正高可用的微服务系统。

## 相关阅读

- [重试与退避策略实战：Exponential Backoff + Jitter——Laravel HTTP Client 的韧性设计模式](/categories/Laravel/PHP/重试与退避策略实战-Exponential-Backoff-Jitter-Laravel-HTTP-Client韧性设计模式/)
- [Strangler Fig Pattern 实战：Laravel 单体到微服务的渐进式迁移——用 Anti-Corruption Layer 隔离遗留系统](/categories/Laravel/PHP/Strangler-Fig-Pattern-实战-Laravel-单体到微服务的渐进式迁移/)
- [Outbox Pattern 实战：保证数据库与消息队列的最终一致性——Laravel + Debezium 的可靠事件发布](/categories/Laravel/PHP/Outbox-Pattern-实战-保证数据库与消息队列的最终一致性-Laravel-Debezium/)
