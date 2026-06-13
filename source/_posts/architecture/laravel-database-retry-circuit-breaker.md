---

title: Laravel Database Retry 与断路器实战：云 RDS 瞬态连接失败的自动恢复
keywords: [Laravel Database Retry, RDS, 与断路器实战, 瞬态连接失败的自动恢复, 架构]
date: 2026-06-10 06:28:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
- Laravel
- MySQL
- 重试机制
- 断路器
- 数据库
- 高可用
description: 云 RDS 瞬态连接失败是线上常见问题。本文从 Laravel 原生重试机制出发，逐步实现退避算法、断路器模式，最终构建一套完整的数据库连接弹性方案。
---



## 为什么需要 Database Retry？

线上 Laravel 应用跑在云 RDS（阿里云 RDS、AWS RDS、腾讯云 CDB）上，瞬态连接失败是家常便饭：

- **网络抖动**：跨可用区延迟飙升，TCP 握手超时
- **连接数打满**：慢查询堆积，`max_connections` 耗尽
- **主从切换**：RDS 故障转移期间有 30-60 秒不可用窗口
- **维护窗口**：自动备份、版本升级时短暂断连

这些故障的共同特征是：**短暂且可恢复**。如果每次连接失败就直接报 500，用户体验极差。正确的做法是——**快速重试，优雅降级**。

## 一、Laravel 原生重试机制

### 1.1 retry() 辅助函数

Laravel 内置的 `retry()` 是最简单的重试工具：

```php
use Illuminate\Support\Facades\DB;

$result = retry(3, function () {
    return DB::table('orders')->where('status', 'pending')->first();
}, 100); // 每次重试间隔 100ms
```

参数说明：
- 第一个参数：最大重试次数
- 第二个参数：回调函数
- 第三个参数：重试间隔（ms）

但这个方案太粗糙——没有指数退避、没有异常过滤、没有熔断。

### 1.2 sleep() 实现退避

手动加退避逻辑：

```php
$result = retry(5, function ($attempt, $exception) {
    if ($attempt > 1) {
        // 指数退避：100ms, 200ms, 400ms, 800ms, 1600ms
        $delay = pow(2, $attempt - 1) * 100;
        usleep($delay * 1000); // usleep 参数是微秒
    }
    
    return DB::table('orders')->where('status', 'pending')->first();
}, 0); // 不用 retry 自带的间隔，自己控制
```

问题在于：`usleep()` 会阻塞整个进程。在 FPM 模式下还好，在 Octane/Swoole 模式下会阻塞协程。

### 1.3 仅重试特定异常

这是关键——**不能所有异常都重试**。连接超时可以重试，SQL 语法错误重试一万次也没用：

```php
use PDOException;

$result = retry(3, function () {
    return DB::table('orders')->where('status', 'pending')->first();
}, 100, function (\Throwable $exception) {
    // 只重试瞬态错误
    return $this->isTransientError($exception);
});
```

瞬态错误判断函数：

```php
/**
 * 判断是否为可重试的瞬态数据库错误
 */
protected function isTransientError(\Throwable $exception): bool
{
    // PDO 连接异常
    if ($exception instanceof PDOException) {
        $message = $exception->getMessage();
        
        // 常见的瞬态错误关键词
        $transientPatterns = [
            'SQLSTATE\[HY000\]',           // 通用连接错误
            'Connection refused',
            'Connection timed out',
            'server has gone away',
            'Lost connection',
            'Too many connections',
            'Lock wait timeout exceeded',
            'Deadlock found',
            'MySQL server has gone away',
        ];
        
        foreach ($transientPatterns as $pattern) {
            if (stripos($message, $pattern) !== false) {
                return true;
            }
        }
    }
    
    // Laravel QueryException 包装
    if ($exception instanceof \Illuminate\Database\QueryException) {
        return $this->isTransientError($exception->getPrevious());
    }
    
    return false;
}
```

## 二、封装 DatabaseRetryService

把上面的逻辑封装成一个可复用的服务：

```php
<?php

namespace App\Services\Database;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use PDOException;

class DatabaseRetryService
{
    /**
     * 最大重试次数
     */
    protected int $maxAttempts = 3;

    /**
     * 基础延迟（毫秒）
     */
    protected int $baseDelayMs = 100;

    /**
     * 最大延迟（毫秒）
     */
    protected int $maxDelayMs = 5000;

    /**
     * 带指数退避的数据库操作重试
     *
     * @param callable $operation  数据库操作
     * @param int|null $maxAttempts 重试次数覆盖
     * @return mixed
     * @throws \Throwable
     */
    public function execute(callable $operation, ?int $maxAttempts = null)
    {
        $attempts = $maxAttempts ?? $this->maxAttempts;
        $lastException = null;

        for ($i = 1; $i <= $attempts; $i++) {
            try {
                return $operation($i);
            } catch (\Throwable $e) {
                $lastException = $e;

                if (!$this->isTransientError($e) || $i >= $attempts) {
                    throw $e;
                }

                $delay = $this->calculateDelay($i);

                Log::warning('Database operation failed, retrying', [
                    'attempt'    => $i,
                    'max'        => $attempts,
                    'delay_ms'   => $delay,
                    'exception'  => $e->getMessage(),
                    'error_code' => $e->getCode(),
                ]);

                usleep($delay * 1000);
            }
        }

        throw $lastException;
    }

    /**
     * 指数退避 + 随机抖动
     *
     * 第 1 次重试：100-200ms
     * 第 2 次重试：200-400ms
     * 第 3 次重试：400-800ms
     * ...
     */
    protected function calculateDelay(int $attempt): int
    {
        $baseDelay = $this->baseDelayMs * pow(2, $attempt - 1);
        $jitter = random_int(0, (int) ($baseDelay * 0.5));
        $totalDelay = $baseDelay + $jitter;

        return min($totalDelay, $this->maxDelayMs);
    }

    /**
     * 判断是否为瞬态错误
     */
    protected function isTransientError(\Throwable $exception): bool
    {
        if ($exception instanceof PDOException) {
            $message = $exception->getMessage();

            $patterns = [
                'SQLSTATE\[HY000\]',
                'Connection refused',
                'Connection timed out',
                'server has gone away',
                'Lost connection',
                'Too many connections',
                'Lock wait timeout exceeded',
                'Deadlock found',
                'MySQL server has gone away',
                'WSREP has not yet prepared node for application use',
            ];

            foreach ($patterns as $pattern) {
                if (stripos($message, $pattern) !== false) {
                    return true;
                }
            }
        }

        if ($exception instanceof \Illuminate\Database\QueryException) {
            return $this->isTransientError($exception->getPrevious());
        }

        return false;
    }

    public function setMaxAttempts(int $maxAttempts): static
    {
        $this->maxAttempts = $maxAttempts;
        return $this;
    }

    public function setBaseDelayMs(int $baseDelayMs): static
    {
        $this->baseDelayMs = $baseDelayMs;
        return $this;
    }
}
```

注册到 Service Provider：

```php
// app/Providers/AppServiceProvider.php
public function register(): void
{
    $this->app->singleton(DatabaseRetryService::class, function () {
        return (new DatabaseRetryService())
            ->setMaxAttempts(config('database.retry.max_attempts', 3))
            ->setBaseDelayMs(config('database.retry.base_delay_ms', 100));
    });
}
```

配置项：

```php
// config/database.php
'retry' => [
    'max_attempts' => env('DB_RETRY_MAX_ATTEMPTS', 3),
    'base_delay_ms' => env('DB_RETRY_BASE_DELAY_MS', 100),
],
```

使用方式：

```php
/** @var DatabaseRetryService $retry */
$retry = app(DatabaseRetryService::class);

$order = $retry->execute(fn () => DB::table('orders')->find($orderId));
```

## 三、断路器模式（Circuit Breaker）

重试解决的是「单次请求的瞬态故障」，但当数据库持续不可用时，继续重试只会浪费资源、拖慢响应。断路器的核心思想：

> **如果连续失败次数超过阈值，直接「熔断」——后续请求不再尝试数据库操作，而是走降级逻辑，直到探测期结束。**

状态机：

```
CLOSED（正常）──[失败次数超限]──→ OPEN（熔断）
     ↑                                │
     │                          [超时到期]
     │                                ↓
     └────[探测成功]──── HALF_OPEN（半开）←┘
```

### 3.1 基于 Cache 的断路器实现

```php
<?php

namespace App\Services\Database;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class CircuitBreaker
{
    protected string $key;
    protected int $failureThreshold;
    protected int $recoveryTimeout;  // 秒
    protected int $halfOpenMaxAttempts;

    public function __construct(
        string $key = 'db_circuit',
        int $failureThreshold = 5,
        int $recoveryTimeout = 60,
        int $halfOpenMaxAttempts = 1
    ) {
        $this->key = $key;
        $this->failureThreshold = $failureThreshold;
        $this->recoveryTimeout = $recoveryTimeout;
        $this->halfOpenMaxAttempts = $halfOpenMaxAttempts;
    }

    /**
     * 断路器是否处于 OPEN 状态（禁止访问）
     */
    public function isOpen(): bool
    {
        return Cache::get("{$this->key}_state") === 'open';
    }

    /**
     * 断路器是否处于 HALF_OPEN 状态（允许探测）
     */
    public function isHalfOpen(): bool
    {
        return Cache::get("{$this->key}_state") === 'half_open';
    }

    /**
     * 记录一次成功
     */
    public function recordSuccess(): void
    {
        $state = Cache::get("{$this->key}_state");

        if ($state === 'half_open') {
            // 探测成功，恢复 CLOSED
            $this->reset();
            Log::info('Circuit breaker CLOSED', ['key' => $this->key]);
        }

        // CLOSED 状态下重置失败计数
        Cache::forget("{$this->key}_failures");
    }

    /**
     * 记录一次失败
     */
    public function recordFailure(): void
    {
        $failures = Cache::increment("{$this->key}_failures");
        $state = Cache::get("{$this->key}_state", 'closed');

        if ($state === 'half_open') {
            // 半开状态下失败，重新熔断
            $this->trip();
            Log::warning('Circuit breaker OPEN (half-open failure)', [
                'key' => $this->key,
            ]);
            return;
        }

        if ($failures >= $this->failureThreshold) {
            $this->trip();
            Log::warning('Circuit breaker OPEN', [
                'key'      => $this->key,
                'failures' => $failures,
            ]);
        }
    }

    /**
     * 执行带断路器保护的操作
     */
    public function execute(callable $operation, callable $fallback = null)
    {
        if ($this->isOpen()) {
            // 检查是否进入半开状态
            $trippedAt = Cache::get("{$this->key}_tripped_at", 0);
            if (time() - $trippedAt >= $this->recoveryTimeout) {
                Cache::put("{$this->key}_state", 'half_open', now()->addMinutes(5));
                Log::info('Circuit breaker HALF_OPEN', ['key' => $this->key]);
            } else {
                // 仍在熔断期
                if ($fallback) {
                    return $fallback();
                }
                throw new CircuitBreakerOpenException(
                    "Circuit breaker [{$this->key}] is OPEN"
                );
            }
        }

        try {
            $result = $operation();
            $this->recordSuccess();
            return $result;
        } catch (\Throwable $e) {
            $this->recordFailure();

            if ($fallback) {
                return $fallback($e);
            }

            throw $e;
        }
    }

    /**
     * 触发熔断
     */
    protected function trip(): void
    {
        Cache::put("{$this->key}_state", 'open', now()->addSeconds($this->recoveryTimeout * 2));
        Cache::put("{$this->key}_tripped_at", time(), now()->addSeconds($this->recoveryTimeout * 2));
    }

    /**
     * 重置断路器到 CLOSED
     */
    public function reset(): void
    {
        Cache::forget("{$this->key}_state");
        Cache::forget("{$this->key}_failures");
        Cache::forget("{$this->key}_tripped_at");
    }
}
```

异常类：

```php
<?php

namespace App\Services\Database;

class CircuitBreakerOpenException extends \RuntimeException {}
```

### 3.2 组合使用：Retry + CircuitBreaker

将重试和断路器组合，形成完整的弹性方案：

```php
<?php

namespace App\Services\Database;

class ResilientDatabase
{
    public function __construct(
        protected DatabaseRetryService $retry,
        protected CircuitBreaker $circuitBreaker
    ) {}

    /**
     * 带重试 + 断路器的数据库操作
     */
    public function query(callable $operation, ?callable $fallback = null)
    {
        return $this->circuitBreaker->execute(
            // 正常路径：带重试
            fn () => $this->retry->execute($operation),
            // 降级路径
            $fallback
        );
    }
}
```

注册：

```php
$this->app->singleton(ResilientDatabase::class, function ($app) {
    return new ResilientDatabase(
        $app->make(DatabaseRetryService::class),
        new CircuitBreaker(
            key: 'primary_db',
            failureThreshold: 5,
            recoveryTimeout: 60
        )
    );
});
```

使用：

```php
/** @var ResilientDatabase $db */
$db = app(ResilientDatabase::class);

// 带降级的查询
$order = $db->query(
    fn () => DB::table('orders')->find($orderId),
    fn (\Throwable $e) => Cache::get("order_cache_{$orderId}") // 降级读缓存
);
```

## 四、Laravel 数据库层配置

### 4.1 PDO 连接超时

在 `config/database.php` 中配置合理的超时：

```php
'mysql' => [
    'driver'   => 'mysql',
    'host'     => env('DB_HOST'),
    'database' => env('DB_DATABASE'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    
    // 连接超时（秒）—— 建议 3-5 秒
    'options' => [
        PDO::ATTR_TIMEOUT => 5,
        // 开启持久连接减少握手开销
        PDO::ATTR_PERSISTENT => true,
    ],
    
    // Laravel 8+ 的连接重试
    'retry_on_error' => true,
    
    // 严格模式下只在这些错误码上重试
    'error_map' => [
        2006 => true, // MySQL server has gone away
        2013 => true, // Lost connection to MySQL server during query
        2002 => true, // Can't connect to MySQL server
    ],
],
```

`retry_on_error` 是 Laravel 8.60+ 引入的，底层会在 `reconnectIfMissingConnection()` 时自动重连。

### 4.2 队列 Worker 的数据库重连

队列 Worker 长时间运行，最容易遇到连接超时。在 `config/queue.php` 中：

```php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'queue' => env('REDIS_QUEUE', 'default'),
    'retry_after' => 90,   // 任务超时秒数
    'block_for' => null,
    
    // Worker 进程的数据库重连
    'after_commit' => false,
],
```

在队列 Job 中手动重连：

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;

class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function handle(): void
    {
        // Worker 运行久了连接可能断，先 ping 一下
        DB::reconnect();
        
        // 如果 reconnect 也失败，会抛异常触发重试
        DB::table('orders')
            ->where('id', $this->orderId)
            ->update(['processed' => true]);
    }
}
```

## 五、Laravel Octane / Swoole 环境的特殊处理

Octane 环境下，数据库连接是常驻内存的。连接断了不会自动重建，必须在请求前重连：

```php
// app/Http/Middleware/EnsureDatabaseConnection.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\DB;
use PDOException;

class EnsureDatabaseConnection
{
    public function handle($request, Closure $next)
    {
        try {
            // 尝试一个轻量查询检测连接
            DB::connection()->getPdo();
        } catch (PDOException) {
            // 连接已断，强制重连
            DB::reconnect();
        }

        return $next($request);
    }
}
```

在 Octane 配置中注册中间件：

```php
// config/octane.php
'middleware' => [
    EnsureDatabaseConnection::class,
],
```

## 六、监控与告警

重试和熔断都是「静默」处理的——如果不监控，出了问题你根本不知道。

### 6.1 重试事件统计

```php
// 在 DatabaseRetryService 的 execute 方法中
Log::channel('database')->info('db_retry', [
    'attempt'    => $i,
    'delay_ms'   => $delay,
    'exception'  => $e->getMessage(),
    'query_time' => microtime(true) - $startTime,
]);
```

配置独立的日志通道：

```php
// config/logging.php
'channels' => [
    'database' => [
        'driver' => 'daily',
        'path' => storage_path('logs/database-retry.log'),
        'days' => 30,
        'tap' => [App\Logging\DatabaseRetryFormatter::class],
    ],
],
```

### 6.2 断路器状态监控

暴露一个健康检查接口：

```php
// routes/api.php
Route::get('/health/database', function () {
    $breaker = app(CircuitBreaker::class);
    
    $state = 'closed';
    if ($breaker->isOpen()) $state = 'open';
    elseif ($breaker->isHalfOpen()) $state = 'half_open';
    
    return response()->json([
        'status' => $state === 'closed' ? 'healthy' : 'degraded',
        'circuit_breaker' => $state,
        'timestamp' => now()->toIso8601String(),
    ], $state === 'closed' ? 200 : 503);
});
```

配合 Prometheus + Grafana 或者阿里云 ARMS 监控断路器状态变化。

## 七、踩坑记录

### 坑 1：重试导致幂等性问题

**场景**：重试 `INSERT` 操作，第一次其实成功了但响应丢失，重试时 `Duplicate entry`。

**解决**：写操作要先检查或用 `INSERT IGNORE`、`ON DUPLICATE KEY UPDATE`：

```php
DB::table('user_logs')->insertOrIgnore([
    'user_id' => $userId,
    'action'  => 'login',
    'ip'      => $request->ip(),
    'created_at' => now(),
]);
```

### 坑 2：连接池耗尽时的重试风暴

**场景**：数据库连接数打满，所有请求都在重试，重试本身又占连接，雪崩。

**解决**：在断路器熔断后，新请求直接走降级，不再排队等待：

```php
// 降级策略：读缓存，写队列
$fallback = function (\Throwable $e) use ($orderId) {
    // 读操作降级到缓存
    $cached = Cache::get("order_{$orderId}");
    if ($cached) return $cached;
    
    // 写操作降级到队列延迟写入
    if ($this->isWriteOperation) {
        Queue::later(30, new RetryWrite($this->data));
        return ['queued' => true];
    }
    
    throw $e;
};
```

### 坑 3：主从切换期间读到旧数据

**场景**：主从切换后，从库还有延迟，读到了切换前的数据。

**解决**：关键操作强制走主库：

```php
// 切换后 60 秒内强制读主库
Cache::put('force_read_primary', true, 60);

// 在查询时
$query = DB::table('orders');
if (Cache::get('force_read_primary')) {
    $query = $query->useWritePdo(); // Laravel 9+ 的 read/write 分离
}
```

### 坑 4：PDO 持久连接导致的诡异问题

**场景**：开了 `PDO::ATTR_PERSISTENT`，切换数据库后连接还连着旧库。

**解决**：持久连接在云 RDS 场景下利大于弊，建议关闭，用连接池替代：

```php
'options' => [
    PDO::ATTR_TIMEOUT => 5,
    PDO::ATTR_PERSISTENT => false, // 云 RDS 建议关闭
],
```

如果用 Swoole 连接池，持久连接更是多余的。

## 八、完整调用示例

```php
<?php

namespace App\Http\Controllers;

use App\Services\Database\ResilientDatabase;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class OrderController extends Controller
{
    public function show(int $orderId): JsonResponse
    {
        /** @var ResilientDatabase $db */
        $db = app(ResilientDatabase::class);

        $order = $db->query(
            // 正常路径
            function () use ($orderId) {
                return DB::table('orders')
                    ->join('users', 'users.id', '=', 'orders.user_id')
                    ->where('orders.id', $orderId)
                    ->select('orders.*', 'users.name as user_name')
                    ->first();
            },
            // 降级路径：读缓存
            function (\Throwable $e) use ($orderId) {
                report($e); // 上报 Sentry

                $cached = Cache::get("order_snapshot_{$orderId}");
                if ($cached) {
                    return (object) array_merge($cached, [
                        '_from_cache' => true,
                        '_cache_time' => Cache::get("order_snapshot_{$orderId}_time"),
                    ]);
                }

                return null;
            }
        );

        if (!$order) {
            return response()->json(['error' => '订单不存在'], 404);
        }

        if (isset($order->_from_cache)) {
            return response()->json([
                'data' => $order,
                'warning' => '数据来自缓存，可能不是最新',
            ]);
        }

        // 写入快照缓存供降级使用
        Cache::put("order_snapshot_{$orderId}", (array) $order, 3600);
        Cache::put("order_snapshot_{$orderId}_time", now()->toIso8601String(), 3600);

        return response()->json(['data' => $order]);
    }
}
```

## 总结

| 层级 | 机制 | 解决的问题 |
|------|------|-----------|
| PDO 连接 | `ATTR_TIMEOUT` + `retry_on_error` | 连接握手超时 |
| 应用层 | `DatabaseRetryService` + 指数退避 | 瞬态查询失败 |
| 架构层 | `CircuitBreaker` 断路器 | 持续不可用时快速降级 |
| 运行时 | Octane 重连中间件 | 常驻进程连接断开 |
| 缓存层 | 读缓存降级 + 写队列 | 断路器熔断期间的业务连续性 |

核心原则：

1. **只重试瞬态错误**，SQL 语法错误重试没意义
2. **指数退避 + 抖动**，避免重试风暴（Thundering Herd）
3. **断路器兜底**，连续失败就熔断，别让数据库雪崩扩散到应用层
4. **降级比报错好**，缓存数据比 500 错误页强
5. **监控一切**，重试次数、断路器状态、降级命中率都要有指标

云 RDS 不是银弹，瞬态故障是它的常态而非异常。做好弹性设计，才能在凌晨三点安心睡觉。
