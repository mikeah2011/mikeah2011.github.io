---
title: Laravel-Redis-Queue-Horizon-实战-队列监控失败重试与性能调优
date: 2026-05-05 09:36:00
updated: 2026-05-05 09:38:26
categories:
  - PHP
  - Laravel
tags: [Laravel, Redis, 性能优化, 消息队列]
description: Laravel Redis Queue + Horizon 完整实战：队列架构设计、Horizon 监控仪表盘配置、失败重试策略、Dead Letter Queue、生产环境性能调优，基于 B2C 电商 30+ 仓库的真实踩坑经验。
---

# Laravel Redis Queue + Horizon 实战：队列监控、失败重试与性能调优

> 在 B2C 电商场景中，队列是削峰填谷的核心基础设施。本文基于 KKday B2C 后端团队 30+ 仓库的真实生产经验，完整覆盖 Laravel Redis Queue + Horizon 的架构设计、监控配置、失败重试策略与性能调优实战。

## 架构全景

```
                    ┌─────────────────────────────────────────────┐
                    │              Laravel Application             │
                    │                                             │
                    │  Controller → dispatch(SendEmailJob::class) │
                    │                    │                        │
                    │            ┌───────▼────────┐               │
                    │            │  Redis Queue    │               │
                    │            │  (LPOP/BRPOP)   │               │
                    │            └───────┬────────┘               │
                    └────────────────────┼────────────────────────┘
                                         │
          ┌──────────────────────────────┼──────────────────────────────┐
          │                              │                              │
    ┌─────▼─────┐                  ┌─────▼─────┐                 ┌─────▼─────┐
    │  Worker 1 │                  │  Worker 2 │                 │  Worker 3 │
    │ high,default│               │ default   │                 │ low,backup│
    └─────┬─────┘                  └─────┬─────┘                 └─────┬─────┘
          │                              │                              │
          └──────────────────────────────┼──────────────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   Horizon Dashboard  │
                              │   (实时监控 + 告警)   │
                              └─────────────────────┘
```

## 一、Redis Queue 基础配置

### 1.1 队列驱动配置

```php
// config/queue.php
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'queue',           // 独立 Redis 连接，别和 cache 混用
        'queue' => env('REDIS_QUEUE', 'default'),
        'retry_after' => 90,               // Job 执行超时（秒），超过此时间视为失败
        'block_for' => 5,                  // BRPOP 阻塞时间（秒），减少 CPU 空轮询
        'after_commit' => false,           // 事务提交后才 dispatch
    ],

    // 高优先列队：支付回调、库存扣减
    'redis_high' => [
        'driver' => 'redis',
        'connection' => 'queue',
        'queue' => 'high,default',
        'retry_after' => 60,
        'block_for' => 2,
    ],

    // 低优先队列：邮件、报表、日志
    'redis_low' => [
        'driver' => 'redis',
        'connection' => 'queue',
        'queue' => 'low,default',
        'retry_after' => 300,
        'block_for' => 10,
    ],
],
```

```php
// config/database.php - 独立 Redis 连接
'redis' => [
    'queue' => [
        'host' => env('REDIS_QUEUE_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_QUEUE_PORT', 6379),
        'database' => 2,                  // 和 cache（0）、session（1）分开
        'read_timeout' => 60,             // 队列连接需要更长的读超时
    ],
],
```

> **踩坑 1**：曾经把 `queue` 和 `cache` 共用同一个 Redis database，促销高峰时缓存淘汰策略（allkeys-lru）直接把队列数据清了，导致 8000+ Job 丢失。**教训：队列必须用独立 Redis 实例或至少独立 database。**

### 1.2 Job 设计模式

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessOrderNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;                // 最大重试次数
    public int $maxExceptions = 3;        // 最大异常次数（区别于 tries）
    public int $timeout = 60;             // 单次执行超时（秒）
    public int $backoff = 30;             // 重试间隔基数（秒）
    public bool $deleteWhenMissingModels = true;  // 模型不存在时自动删除

    // 队列连接 + 队列名
    public string $queue = 'notifications';

    public function __construct(
        public readonly int $orderId,
        public readonly string $channel,  // email / sms / push
    ) {
        // afterCommit：确保数据库事务已提交后再 dispatch
        $this->afterCommit = true;
    }

    /**
     * 计算退避时间（指数退避 + 抖动）
     */
    public function backoff(): array
    {
        return [
            30,                              // 第1次重试：30s
            120,                             // 第2次重试：2min
            300,                             // 第3次重试：5min
            900,                             // 第4次重试：15min
            1800,                            // 第5次重试：30min
        ];
    }

    /**
     * 重试前的回调（可用于记录重试日志）
     */
    public function retrying(): void
    {
        Log::warning('OrderNotification retrying', [
            'order_id' => $this->orderId,
            'channel' => $this->channel,
            'attempts' => $this->attempts(),
        ]);
    }

    public function handle(): void
    {
        $order = \App\Models\Order::findOrFail($this->orderId);

        match ($this->channel) {
            'email' => $this->sendEmail($order),
            'sms'   => $this->sendSms($order),
            'push'  => $this->sendPush($order),
            default => Log::error("Unknown channel: {$this->channel}"),
        };
    }

    /**
     * Job 失败时的回调（发送告警、记录失败原因）
     */
    public function failed(\Throwable $exception): void
    {
        Log::error('OrderNotification permanently failed', [
            'order_id' => $this->orderId,
            'channel' => $this->channel,
            'exception' => $exception->getMessage(),
        ]);

        // 发送 Slack 告警
        \App\Facades\Slack::notify(
            "🚨 订单 #{$this->orderId} 的 {$this->channel} 通知永久失败：{$exception->getMessage()}"
        );
    }

    private function sendEmail(Order $order): void { /* ... */ }
    private function sendSms(Order $order): void { /* ... */ }
    private function sendPush(Order $order): void { /* ... */ }
}
```

> **踩坑 2**：`backoff` 如果只写一个数字 `[30]`，所有重试都等 30 秒。对于下游服务故障（如邮件网关宕机），这意味着你会疯狂重试 5 次全部失败。**正确做法：用数组实现指数退避。**

## 二、Horizon 监控仪表盘

### 2.1 安装与配置

```bash
composer require laravel/horizon
php artisan horizon:install
php artisan vendor:publish --tag=horizon-config
```

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['high', 'default', 'low'],
            'balance' => 'auto',              // 自动负载均衡
            'autoScalingStrategy' => 'time',  // 基于等待时间自动扩缩
            'maxProcesses' => 10,
            'maxTime' => 3600,                // Worker 最大运行时间（秒）
            'maxJobs' => 1000,                // 处理 N 个 Job 后重启 Worker（防内存泄漏）
            'memory' => 128,                  // 内存上限（MB），超了自动重启
            'tries' => 3,
            'timeout' => 60,
            'nice' => 0,                      // 进程优先级
        ],

        'supervisor-critical' => [
            'connection' => 'redis',
            'queue' => ['payment_callback', 'inventory_deduct'],
            'balance' => 'simple',            // 简单模式，不做负载均衡
            'maxProcesses' => 5,
            'maxTime' => 3600,
            'maxJobs' => 500,
            'memory' => 128,
            'tries' => 5,
            'timeout' => 30,
            'nice' => -5,                     // 更高优先级
        ],
    ],

    'staging' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['high', 'default', 'low'],
            'balance' => 'simple',
            'maxProcesses' => 3,
            'maxTime' => 3600,
            'maxJobs' => 500,
            'memory' => 128,
            'tries' => 3,
            'timeout' => 60,
        ],
    ],
],
```

### 2.2 Horizon 仪表盘关键指标

```
┌──────────────────────────────────────────────────────────────┐
│                    Horizon Dashboard                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Throughput ────────────────────────█ 1,234 jobs/min         │
│  Jobs Per Minute  ▁▂▃▅▇█▇▅▃▂▁                                │
│                                                              │
│  Wait Time ────────────────────────█ 0.3s avg               │
│  Queue Wait     ▁▁▁▂▃▁▁▁▁▁                                  │
│                                                              │
│  Active Workers ─────────────────── 8 / 10                   │
│  ████████████░░░░░░░░                                        │
│                                                              │
│  Failed Jobs ────────────────────── 2 (last 24h)            │
│  ▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁▁▁                                        │
│                                                              │
│  Queue Depth:                                                │
│  high:          0  (████████████████████)                    │
│  default:      12  (████████████░░░░░░░░)                    │
│  low:         156  (████░░░░░░░░░░░░░░░░)                    │
│  notifications: 89  (██████░░░░░░░░░░░░░░)                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 Horizon 告警配置

```php
// AppServiceProvider.php
use Laravel\Horizon\Horizon;

public function boot(): void
{
    // 队列等待时间超过 60 秒触发告警
    Horizon::routeSlackNotificationsTo('#queue-alerts');
    Horizon::night();  // 暗色主题（不影响功能，但看着舒服）
}
```

```php
// config/app.php - 注册 Horizon 门面（如果不是 Laravel 自动发现）
'aliases' => Facade::defaultAliases()->merge([
    'Horizon' => Laravel\Horizon\Horizon::class,
])->toArray(),
```

> **踩坑 3**：Horizon 的 `balance` 策略设为 `auto` 后，如果某个队列突然涌入大量 Job（比如促销瞬间 5 万单），Horizon 会快速扩 Worker 到 `maxProcesses`。但如果 `maxProcesses` 设太高，每个 Worker 都吃内存，可能导致 OOM。**建议：`maxProcesses` 根据单个 Worker 内存占用（通常 40-80MB）和服务器总内存反推。**

## 三、失败重试与 Dead Letter Queue

### 3.1 重试策略矩阵

```
┌────────────────────────────────────────────────────────────────┐
│                    Job 重试策略决策树                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Job 执行失败                                                  │
│      │                                                         │
│      ├─ 是临时性错误？（网络超时、限流）                           │
│      │     ├─ Yes → 指数退避重试（backoff）                     │
│      │     │         ├─ tries > maxAttempts?                   │
│      │     │         │     ├─ Yes → 进入 failed_jobs 表        │
│      │     │         │     └─ No  → 等待后重试                  │
│      │     │         └─                                      │
│      │     └─ No → 检查是否为永久性错误                          │
│      │            ├─ 模型不存在 → deleteWhenMissingModels       │
│      │            ├─ 参数错误 → failed() + 告警                 │
│      │            └─ 业务异常 → 自定义处理                      │
│      │                                                         │
│      └─ failed_jobs 表                                         │
│            ├─ 手动重试：php artisan queue:retry {id}           │
│            ├─ 批量重试：php artisan queue:retry --queue=default │
│            └─ 清空：php artisan queue:flush                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 自定义失败 Job 处理器

```php
<?php

namespace App\Queue;

use Illuminate\Queue\Failed\FailedJobProviderInterface;

class MonitoredFailedJobProvider implements FailedJobProviderInterface
{
    public function __construct(
        private readonly FailedJobProviderInterface $inner,
        private readonly \App\Services\AlertService $alertService,
    ) {}

    public function log($connection, $queue, $payload, $exception): string|false
    {
        $id = $this->inner->log($connection, $queue, $payload, $exception);

        // 解析 payload 获取 Job 类名
        $decoded = json_decode($payload, true);
        $jobClass = $decoded['displayName'] ?? 'Unknown';

        // 高优先队列的失败 Job 立即告警
        if (in_array($queue, ['payment_callback', 'inventory_deduct'])) {
            $this->alertService->critical("🔴 高优先队列 Job 失败", [
                'job' => $jobClass,
                'queue' => $queue,
                'exception' => $exception->getMessage(),
            ]);
        } else {
            // 其他队列聚合告警（5 分钟内同一 Job 类只告一次）
            $this->alertService->aggregate("queue_failure:{$jobClass}", 300);
        }

        return $id;
    }

    public function all(): array { return $this->inner->all(); }
    public function find(string $id): object|null { return $this->inner->find($id); }
    public function forget(string $id): bool { return $this->inner->forget($id); }
    public function flush(?int $hours = null): bool { return $this->inner->flush($hours); }
}
```

```php
// AppServiceProvider.php
use Illuminate\Support\ServiceProvider;
use Illuminate\Queue\Failed\NullFailedJobProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 包装默认的失败 Job Provider
        $this->app->extend('queue.failer', function ($failer, $app) {
            return new MonitoredFailedJobProvider(
                $failer,
                $app->make(\App\Services\AlertService::class),
            );
        });
    }
}
```

### 3.3 重试特定异常类型

```php
<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldRetryUntil;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Contracts\Queue\ShouldQueue;

class SyncExternalInventoryJob implements ShouldQueue, ShouldRetryUntil
{
    use Dispatchable, InteractsWithQueue, SerializesModels;

    public int $tries = 10;
    public int $backoff = 60;

    /**
     * 指定重试截止时间（不是次数，而是时间）
     */
    public function retryUntil(): \DateTime
    {
        return now()->addHours(2);  // 最多重试 2 小时
    }

    /**
     * 根据异常类型决定是否重试
     */
    public function retryUsing(): array
    {
        return [
            // 这些异常会重试
            \App\Exceptions\ExternalApiTimeoutException::class,
            \App\Exceptions\RateLimitExceededException::class,
            // 这些异常不会重试（立即进入 failed）
            \App\Exceptions\InvalidInventoryDataException::class,
        ];
    }

    public function handle(): void
    {
        // 捕获异常时，只有在 $retryUsing 中的才会被重试
    }
}
```

> **踩坑 4**：曾经有个 Job 在 `handle()` 里 catch 了所有异常并 `return`（认为是"优雅降级"），结果 Horizon 永远不会认为它失败，`failed()` 回调也不会触发。**教训：如果你 catch 了异常，请用 `$this->fail($exception)` 手动标记失败。**

## 四、性能调优实战

### 4.1 Worker 配置调优

```bash
# 生产环境推荐的 Horizon 启动命令
php artisan horizon

# 如果不用 Horizon，直接用 queue:work
php artisan queue:work redis \
    --queue=high,default,low \
    --tries=3 \
    --timeout=60 \
    --sleep=5 \
    --max-time=3600 \
    --max-jobs=1000 \
    --memory=128 \
    --backoff=30
```

### 4.2 Supervisor 配置（不用 Horizon 时）

```ini
[program:laravel-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/app/artisan queue:work redis --sleep=5 --tries=3 --timeout=60 --max-time=3600
autostart=true
autorestart=true
stopwaitsecs=60
user=www-data
numprocs=8
redirect_stderr=true
stdout_logfile=/var/log/laravel-worker.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5

; 环境变量
environment=REDIS_QUEUE_HOST="10.0.1.50",QUEUE_CONNECTION="redis"
```

### 4.3 Redis 性能调优

```php
// config/database.php
'redis' => [
    'queue' => [
        'host' => env('REDIS_QUEUE_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => 6379,
        'database' => 2,
        'read_timeout' => 60,
        // 关键：队列专用 Redis 建议关闭持久化（RDB/AOF）
        // 因为 failed_jobs 表已经是持久化存储
    ],
],
```

```bash
# Redis 配置优化（/etc/redis/redis.conf）

# 队列专用 Redis：关闭持久化（提高写入性能）
save ""
appendonly no

# 内存策略：不要用 allkeys-lru！用 noeviction
maxmemory-policy noeviction

# 最大内存（根据队列深度设置）
maxmemory 2gb

# Lua 脚本超时
lua-time-limit 5000
```

> **踩坑 5**：队列 Redis 开了 `allkeys-lru` 策略后，促销高峰时内存满了，LRU 淘汰了正在等待的 Job 数据。Worker 端报 `RedisException: NOAUTH` 或者直接静默丢 Job。**教训：队列 Redis 必须用 `noeviction`，内存满时拒绝写入而非丢数据。**

### 4.4 队列深度监控与自动扩缩

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Log;

class MonitorQueueDepth extends Command
{
    protected $signature = 'queue:monitor-depth {--threshold=1000} {--interval=30}';
    protected $description = 'Monitor queue depth and trigger scaling alerts';

    public function handle(): int
    {
        $threshold = (int) $this->option('threshold');
        $interval = (int) $this->option('interval');

        $this->info("Monitoring queue depth (threshold: {$threshold}, interval: {$interval}s)");

        while (true) {
            $queues = ['high', 'default', 'low', 'notifications'];
            $total = 0;

            foreach ($queues as $queue) {
                $depth = Redis::connection('queue')->llen("queues:{$queue}");
                $total += $depth;

                if ($depth > $threshold / count($queues)) {
                    Log::warning("Queue [{$queue}] depth exceeds threshold", [
                        'depth' => $depth,
                        'threshold' => $threshold / count($queues),
                    ]);
                }
            }

            if ($total > $threshold) {
                Log::critical("Total queue depth exceeds threshold", [
                    'total' => $total,
                    'threshold' => $threshold,
                ]);

                // 可以触发 K8s HPA 或者发送告警
                $this->alert("Total queue depth: {$total} exceeds {$threshold}");
            }

            sleep($interval);
        }
    }
}
```

### 4.5 连接池与持久化连接

```php
// config/queue.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'queue',
    'queue' => 'default',
    'retry_after' => 90,
    'block_for' => 5,

    // Laravel 10+ 支持持久化连接
    // 避免每个 Job 执行都建立新的 Redis 连接
],
```

```bash
# PHP-FPM 配置中，持久化连接需要 opcache + phpredis 扩展
# 不要用 Predis（纯 PHP 实现，性能差），用 phpredis（C 扩展）

# 安装 phpredis
pecl install redis
echo "extension=redis.so" >> /usr/local/etc/php/conf.d/redis.ini
```

> **踩坑 6**：用 Predis 客户端在高并发下出现 `Connection timed out`，原因是 Predis 是纯 PHP 实现，每个请求都建立新连接。换用 phpredis C 扩展后，QPS 从 2000 提升到 8000+。**生产环境务必用 phpredis。**

## 五、生产环境部署 Checklist

```
✅ 独立 Redis 实例（队列/缓存/Session 分开）
✅ Redis 持久化关闭（noeviction + save ""）
✅ Horizon 配置 auto scaling（time-based）
✅ maxProcesses 根据内存反推（不是越多越好）
✅ maxJobs 设置（防内存泄漏，每 1000 Job 重启 Worker）
✅ failed_jobs 表定期清理（php artisan queue:prune-failed --hours=48）
✅ 指数退避（backoff 数组），不是固定间隔
✅ 高优先队列独立 Supervisor（nice -5）
✅ Slack/PagerDuty 告警集成
✅ phpredis C 扩展（不是 Predis）
✅ afterCommit = true（避免事务未提交就 dispatch）
✅ deleteWhenMissingModels = true（避免孤儿 Job）
✅ Horizon Dashboard 鉴权（生产环境必须加认证）
```

## 六、Horizon Dashboard 鉴权

```php
// app/Providers/HorizonServiceProvider.php
protected function gate(): void
{
    Gate::define('viewHorizon', function ($user) {
        return in_array($user->email, [
            'admin@kkday.com',
            'devops@kkday.com',
        ]);
    });
}
```

```php
// routes/web.php - 生产环境限制 IP
Route::middleware(['auth', 'can:viewHorizon'])
    ->prefix('horizon')
    ->group(function () {
        Horizon::auth(function ($request) {
            // 双重验证：IP 白名单 + 用户鉴权
            $allowedIps = config('horizon.allowed_ips', ['127.0.0.1']);
            if (!in_array($request->ip(), $allowedIps)) {
                return false;
            }
            return $request->user()?->can('viewHorizon') ?? false;
        });
    });
```

## 七、常见踩坑总结

| 踩坑 | 症状 | 解决方案 |
|------|------|---------|
| Redis 数据库混用 | 促销高峰队列数据被 LRU 淘汰 | 独立 Redis 实例 + `noeviction` |
| Predis 客户端 | 高并发连接超时 | 换用 phpredis C 扩展 |
| backoff 固定值 | 下游故障时疯狂重试 | 指数退避数组 |
| catch + return | Job 静默"成功"，不触发 failed | `$this->fail($exception)` 手动标记 |
| balance=auto + maxProcesses 太大 | OOM 导致 Worker 全部挂掉 | 反推 maxProcesses = 内存 / 单Worker |
| afterCommit=false | 事务未提交就 dispatch，模型查询 404 | `$this->afterCommit = true` |
| 没设置 maxJobs | Worker 内存持续增长直到 OOM | `maxJobs=1000` 定期重启 |

## 结语

队列看似简单，但在生产环境中涉及 Redis 配置、Worker 管理、失败处理、监控告警等多个维度。核心原则：

1. **隔离**：队列 Redis 独立，高/低优先队列分开
2. **韧性**：指数退避 + 手动标记失败 + Dead Letter Queue
3. **可观测**：Horizon Dashboard + 队列深度监控 + 告警
4. **资源控制**：maxProcesses / maxJobs / memory 三管齐下

> 本文基于 KKday B2C 后端团队 30+ 仓库的真实生产经验，希望对你的队列架构设计有所启发。如有疑问，欢迎在评论区讨论。
