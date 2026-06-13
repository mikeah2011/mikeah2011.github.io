---
title: Laravel-Redis-Queue-Horizon-实战-队列监控失败重试与性能调优
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 09:36:00
updated: 2026-05-05 09:38:26
categories:
  - php
  - database
tags: [Laravel, Redis, 性能优化, 消息队列]
keywords: [Laravel, Redis, Queue, Horizon, 队列监控失败重试与性能调优, PHP, 数据库]
description: Laravel Redis Queue + Horizon 完整实战指南：覆盖 Redis 队列驱动配置、多优先级队列设计、Horizon 监控仪表盘搭建与告警配置、指数退避失败重试策略、Dead Letter Queue 处理、Redis 内存优化与连接池调优、生产环境 Supervisor 部署方案，结合 B2C 电商 30+ 仓库的真实踩坑经验，助你构建高可用消息队列架构。



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

## 八、实战案例：订单支付回调队列的完整链路

在 B2C 电商场景中，支付回调是最典型的高优先级队列场景。以下是我们在生产环境中处理支付回调的完整 Job 设计：

```php
<?php

namespace App\Jobs\Payment;

use App\Models\Order;
use App\Models\Payment;
use App\Services\PaymentGatewayService;
use App\Services\OrderStateMachine;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ProcessPaymentCallback implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $timeout = 30;
    public string $queue = 'payment_callback';

    public function __construct(
        public readonly string $transactionId,
        public readonly string $gateway,
    ) {
        // 支付回调必须等事务提交后才处理
        $this->afterCommit = true;
    }

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300];
    }

    public function handle(
        PaymentGatewayService $gateway,
        OrderStateMachine $stateMachine,
    ): void {
        // 1. 查询支付记录（幂等性检查）
        $payment = Payment::where('transaction_id', $this->transactionId)
            ->firstOrFail();

        if ($payment->status === 'completed') {
            Log::info('Payment already processed', [
                'transaction_id' => $this->transactionId,
            ]);
            return;
        }

        // 2. 向支付网关验证交易真实性
        $verified = $gateway->verify($this->gateway, $this->transactionId);

        DB::transaction(function () use ($payment, $verified, $stateMachine) {
            // 3. 更新支付状态
            $payment->update([
                'status' => $verified ? 'completed' : 'failed',
                'verified_at' => now(),
            ]);

            // 4. 推进订单状态机
            if ($verified) {
                $order = Order::findOrFail($payment->order_id);
                $stateMachine->transitionTo($order, 'paid');
            }
        });
    }

    public function failed(\Throwable $e): void
    {
        // 支付回调失败是最高级别告警
        Log::critical('Payment callback permanently failed', [
            'transaction_id' => $this->transactionId,
            'gateway' => $this->gateway,
            'error' => $e->getMessage(),
        ]);

        // 同时通知客服系统，人工介入
        \App\Facades\Slack::critical(
            "💳 支付回调永久失败 [{$this->gateway}]: tx={$this->transactionId}, error={$e->getMessage()}"
        );
    }
}
```

### 8.1 队列任务分发的事务安全

在实际项目中，很多 Bug 来自于 `dispatch()` 和数据库事务的时序问题：

```php
// ❌ 错误：事务未提交就 dispatch，Job 可能查不到数据
DB::transaction(function () use ($order) {
    $order->update(['status' => 'pending']);
    ProcessPaymentCallback::dispatch($order->transaction_id, 'stripe');
});
// 事务回滚后，Job 里查不到这个 Order

// ✅ 正确方式一：afterCommit = true（Job 内部设置）
class ProcessPaymentCallback implements ShouldQueue
{
    public function __construct(...)
    {
        $this->afterCommit = true;  // 等事务提交后才真正入队
    }
}

// ✅ 正确方式二：dispatchAfterCommit()（调用侧设置）
DB::transaction(function () use ($order) {
    $order->update(['status' => 'pending']);
    dispatch(new ProcessPaymentCallback($order->transaction_id, 'stripe'))
        ->afterCommit();
});
```

### 8.2 队列优先级与流量控制

在促销高峰期，如何避免低优先级任务饿死高优先级任务：

```php
// 在 AppServiceProvider 中注册中间件限流
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Support\Facades\Queue;

Queue::before(function (JobProcessing $event) {
    $job = $event->job;
    $queueName = $job->getQueue();

    // 监控队列等待时间，如果 high 队列堆积，暂停 low 队列消费
    if ($queueName === 'low') {
        $highDepth = Redis::connection('queue')->llen('queues:high');
        $defaultDepth = Redis::connection('queue')->llen('queues:default');

        if ($highDepth > 100 || $defaultDepth > 500) {
            // 临时释放 Job，稍后重试（让 Worker 去消费更重要的任务）
            $job->release(30);
            Log::info('Low priority job deferred due to high queue depth', [
                'high_depth' => $highDepth,
                'default_depth' => $defaultDepth,
            ]);
        }
    }
});
```

### 8.3 队列任务的批量分发与进度追踪

处理批量导入或报表生成等大任务时，需要将任务拆分并追踪进度：

```php
<?php

namespace App\Jobs\Batch;

class BatchImportProducts implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;
    public string $queue = 'default';

    public function __construct(
        public readonly int $importJobId,
        public readonly array $productData,
        public readonly int $batchIndex,
        public readonly int $totalBatches,
    ) {}

    public function handle(): void
    {
        $importJob = ImportJob::findOrFail($this->importJobId);

        try {
            foreach ($this->productData as $item) {
                Product::updateOrCreate(
                    ['sku' => $item['sku']],
                    $item
                );
            }

            // 更新进度
            DB::table('import_jobs')
                ->where('id', $this->importJobId)
                ->increment('processed_batches');

            // 检查是否所有批次完成
            $job = ImportJob::find($this->importJobId);
            if ($job->processed_batches >= $this->totalBatches) {
                $job->update(['status' => 'completed', 'completed_at' => now()]);
                // 发送完成通知
                Slack::info("📊 批量导入完成: {$this->totalBatches} 批次，共处理 {$job->total_rows} 条数据");
            }

        } catch (\Exception $e) {
            $importJob->update(['status' => 'failed', 'error_message' => $e->getMessage()]);
            throw $e;
        }
    }

    public function failed(\Throwable $e): void
    {
        $importJob = ImportJob::find($this->importJobId);
        if ($importJob) {
            $importJob->update(['status' => 'failed', 'error_message' => $e->getMessage()]);
        }
    }
}

// 分发示例：将 10000 条数据拆成每 500 条一个批次
$products = ProductSource::getAll();
$batches = array_chunk($products, 500);
$totalBatches = count($batches);

$importJob = ImportJob::create([
    'total_rows' => count($products),
    'total_batches' => $totalBatches,
    'status' => 'processing',
]);

foreach ($batches as $index => $batch) {
    BatchImportProducts::dispatch(
        $importJob->id,
        $batch,
        $index + 1,
        $totalBatches
    )->onQueue('low');
}
```

### 8.4 使用 Job 链实现复杂工作流

当一个业务流程需要多个 Job 按顺序执行时，使用 Job 链（Chain）可以确保执行顺序：

```php
use Illuminate\Support\Facades\Bus;

// 示例：订单处理工作流
// 1. 验证库存 → 2. 扣减库存 → 3. 创建支付单 → 4. 发送通知
Bus::chain([
    new ValidateInventoryJob($orderId),
    new DeductInventoryJob($orderId),
    new CreatePaymentJob($orderId),
    new ProcessPaymentCallback($transactionId, 'stripe'),
])->onConnection('redis')
  ->onQueue('high')
  ->catch(function (\Throwable $e, $job) {
      // 链中任何一个 Job 失败都会执行这里
      Log::critical('Order processing chain failed', [
          'order_id' => $orderId,
          'failed_job' => get_class($job),
          'error' => $e->getMessage(),
      ]);
  })
  ->then(function () {
      Log::info('Order processing chain completed', ['order_id' => $orderId]);
  })
  ->dispatch();
```

### 8.5 使用 Job Middleware 实现限流与重试控制

Laravel Job Middleware 允许你为 Job 添加可复用的横切关注点：

```php
<?php

namespace App\Jobs\Middleware;

use Illuminate\Support\Facades\Redis;

class RateLimitedJob
{
    protected int $maxAttempts;
    protected int $decayMinutes;

    public function __construct(int $maxAttempts = 10, int $decayMinutes = 1)
    {
        $this->maxAttempts = $maxAttempts;
        $this->decayMinutes = $decayMinutes;
    }

    public function handle(object $job, \Closure $next): void
    {
        $key = 'rate-limiter:' . get_class($job);

        $currentAttempts = (int) Redis::connection('cache')
            ->get($key);

        if ($currentAttempts >= $this->maxAttempts) {
            // 超过限流阈值，延迟 60 秒后重试
            $job->release(60);
            return;
        }

        Redis::connection('cache')->incr($key);
        Redis::connection('cache')->expire(
            $key,
            $this->decayMinutes * 60
        );

        $next($job);
    }
}

// 在 Job 中使用
class CallExternalApiJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, SerializesModels;

    public function middleware(): array
    {
        return [new RateLimitedJob(5, 1)]; // 每分钟最多 5 次
    }

    public function handle(): void
    {
        // 调用外部 API
        $response = Http::timeout(10)
            ->retry(3, 1000)
            ->post('https://api.example.com/endpoint');

        if ($response->failed()) {
            throw new ExternalApiException('API call failed');
        }
    }
}
```

## 九、队列监控告警的 Prometheus + Grafana 方案

Horizon Dashboard 适合日常查看，但生产环境需要持久化的监控指标。以下是基于 Prometheus 的队列监控方案：

```php
<?php

namespace App\Jobs\Monitoring;

use Illuminate\Support\Facades\Prometheus;

class QueueMetricsCollector
{
    /**
     * 采集队列指标（配合 Artisan Schedule 每分钟执行）
     */
    public static function collect(): void
    {
        $queues = config('queue.depth_monitor.queues', ['high', 'default', 'low']);

        foreach ($queues as $queue) {
            // 队列深度
            $depth = Redis::connection('queue')->llen("queues:{$queue}");
            Prometheus::gauge('queue_depth', "Queue depth for {$queue}", ['queue' => $queue])
                ->set($depth);

            // 队列等待时间（最近一次 Job 的等待时间）
            $waitTime = self::calculateWaitTime($queue);
            Prometheus::histogram('queue_wait_seconds', "Queue wait time for {$queue}", ['queue' => $queue])
                ->observe($waitTime);
        }

        // Worker 数量
        $workers = self::getActiveWorkerCount();
        Prometheus::gauge('queue_workers_active', 'Active queue workers')
            ->set($workers);
    }

    /**
     * 计算队列等待时间（基于 Job payload 中的时间戳）
     */
    private static function calculateWaitTime(string $queue): float
    {
        $job = Redis::connection('queue')->lindex("queues:{$queue}", -1);
        if (!$job) return 0;

        $payload = json_decode($job, true);
        $createdAt = $payload['data']['command'] ?? null;

        // 从 Job payload 反序列化获取创建时间
        // 实际实现需要根据 Job 序列化方式调整
        return 0;
    }

    private static function getActiveWorkerCount(): int
    {
        // 通过 Horizon API 或 Supervisor 获取活跃 Worker 数
        return \Laravel\Horizon\Horizon::workers()->count();
    }
}
```

```bash
# config/schedule.php
$schedule->call([QueueMetricsCollector::class, 'collect'])->everyMinute();
```

```
# Grafana Dashboard JSON 关键面板配置
# 队列深度趋势图（告警阈值 = 1000）
# Worker 活跃数趋势图
# 失败 Job 数趋势图
# 队列等待时间 P95 分位图
```

## 十、常见问题排查速查表

| 现象 | 可能原因 | 排查命令 / 解决方案 |
|------|---------|---------------------|
| Job 能入队但 Worker 不消费 | Queue 连接配置错误，或 Redis 数据库号不一致 | `php artisan queue:work redis --queue=default -vvv` 查看详细输出 |
| Worker 启动后立即退出 | 内存超限（OOM）或 PHP Fatal Error | 检查 `/var/log/supervisor/*.log`，确认 `memory_limit` 和 `maxJobs` 设置 |
| Job 大量堆积 | Worker 数不足或下游依赖慢 | `redis-cli LLEN queues:default` 检查队列深度，考虑增加 `maxProcesses` |
| 同一个 Job 反复重试 | 异常未被 catch，或 `retryUsing()` 配置不当 | 检查 `failed_jobs` 表中的异常消息，调整 `tries` 或 `maxExceptions` |
| Horizon Dashboard 无数据 | Horizon 未启动或 Redis 驱动不对 | `php artisan horizon` 确认进程运行中，检查 `config/horizon.php` 的 `redis` 连接配置 |
| 部署后 Job 找不到 Model | 代码部署后旧 Job 引用了已删除/迁移的 Model | 设置 `$deleteWhenMissingModels = true`，避免孤儿 Job |
| 促销高峰 OOM | `maxProcesses` 过高，单个 Worker 内存未限制 | `maxProcesses = 服务器内存 / 单Worker内存(80MB)`，设置 `memory=128` |

## 十一、Redis 队列底层原理与调试技巧

### 11.1 Redis 队列的数据结构

理解 Redis 队列的底层存储结构对于排查问题至关重要。当一个 Laravel Job 被分发到 Redis 队列时，实际上涉及三个 Redis 数据结构：List（队列本身）、Hash（Job 元数据）和 Sorted Set（延迟队列）。

普通 Job 入队时，Redis 会执行 LPUSH 操作将序列化后的 Job payload 推入 `queues:default` 这个 List 的头部。当 Worker 消费时，通过 BRPOP 从 List 尾部阻塞弹出。这意味着先进入队列的 Job 会先被执行，保证了先进先出的顺序性。

延迟 Job（设置了 delay 属性的 Job）不会直接进入 List，而是先进入一个 Sorted Set，score 是预期执行的时间戳。Laravel 内部有一个定时任务（`Illuminate\Queue\RedisQueue::retrieveNextJob`）会周期性地检查 Sorted Set 中是否有到期的 Job，到期后将其移入 List 等待消费。

### 11.2 使用 Redis CLI 直接调试队列

当 Horizon Dashboard 无法正常显示数据，或者需要排查队列堆积原因时，直接操作 Redis 是最有效的手段：

```bash
# 查看所有队列的长度
redis-cli KEYS 'queues:*' | while read key; do echo "$key: $(redis-cli LLEN $key)"; done

# 查看特定队列的前 3 个 Job 内容（生产环境慎用，大 payload 会刷屏）
redis-cli LANGE queues:default 0 2

# 检查延迟队列中等待处理的 Job 数量
redis-cli ZCARD queues:delayed

# 查看失败 Job 的 payload（用于分析失败原因）
php artisan queue:failed

# 监控 Redis 实时操作（看 Worker 是否在正常消费）
redis-cli MONITOR | grep -E 'LPUSH|BRPOP|LLEN'

# 查看 Redis 内存使用情况
redis-cli INFO memory | grep used_memory_human
```

### 11.3 常见 Redis 队列问题的诊断流程

当遇到队列异常时，建议按照以下步骤排查：首先确认 Worker 进程是否存活，通过 `ps aux | grep queue:work` 查看进程列表。如果进程存活，检查 Redis 连接是否正常，使用 `redis-cli PING` 确认 Redis 服务可达。接着检查队列深度是否异常增长，使用 `LLEN` 命令查看。如果队列深度在持续增长，说明消费速度跟不上生产速度，需要增加 Worker 数量或优化 Job 执行效率。如果队列深度稳定但某些 Job 长时间不被执行，可能是 Job 的 Queue 名称配置错误，或者 Worker 监听的队列列表中不包含该队列。最后检查是否有锁死的 Job（即某个 Job 执行时间过长占用了 Worker），此时需要调整 `retry_after` 和 `timeout` 参数，确保超时后 Job 能被释放。

## 十二、生产环境最佳实践与踩坑复盘

### 12.1 队列架构设计的四个核心原则

经过大量生产环境的验证，我们总结了队列架构设计的四个核心原则。第一个原则是隔离，即队列使用的 Redis 实例必须与缓存和 Session 完全隔离。我们在实际项目中曾因为共享 Redis 数据库导致促销高峰期缓存淘汰策略清空了队列数据，造成数千个任务丢失。第二个原则是幂等，即所有 Job 必须设计为可安全重复执行。当 Worker 执行超时被 `retry_after` 机制重新分配时，同一个 Job 可能被执行多次。因此在 `handle` 方法开头必须检查任务状态，避免重复处理造成数据不一致。第三个原则是可观测，即每个 Job 都应该有完整的执行日志和指标上报。通过 Horizon Dashboard、Prometheus 指标和结构化日志三个维度实现全方位监控。第四个原则是优雅降级，即当某个队列的消费速度跟不上时，应该有预案自动降低低优先级任务的消费频率，确保核心业务链路不受影响。

### 12.2 部署流程中的注意事项

在生产环境部署 Laravel 队列服务时，有几个关键节点需要特别注意。部署新代码后，应该先停止 Horizon 进程，等待当前正在执行的 Job 完成（通过 `php artisan horizon:terminate` 实现优雅停止），然后再启动新版本的 Horizon。这个流程可以避免正在执行的 Job 使用旧版代码逻辑而导致数据不一致。同时建议在 `config/horizon.php` 中设置 `maxJobs` 参数，让 Worker 每处理一定数量的 Job 后自动重启，防止长时间运行导致内存泄漏。在多服务器部署场景下，需要确保所有服务器的 Horizon 配置保持一致，特别是队列名称、Worker 数量和超时设置。建议使用版本控制工具（如 Ansible 或 Docker）来管理配置，避免手动修改导致的配置漂移问题。

### 12.3 性能基准测试方法

在对队列系统进行性能调优之前，建议先建立基准指标。可以通过以下方式测量：在测试环境中模拟不同量级的任务分发，记录每个任务从入队到执行完成的端到端延迟。同时监控 Redis 的每秒操作数（通过 `redis-cli INFO stats` 中的 `instantaneous_ops_per_sec` 指标获取）和 CPU 内存占用情况。根据基准测试结果，可以合理设置 Horizon 的 `maxProcesses` 参数。一般经验值是每个 Worker 占用约四十到八十兆内存，根据服务器总内存反推最大 Worker 数量。此外还需要关注 Redis 的连接数限制，每个 Worker 都需要一个 Redis 连接，如果连接数超出 Redis 的 `maxclients` 配置，会导致连接被拒绝。

### 12.4 团队协作中的队列规范

在多人协作的项目中，建议制定统一的队列命名规范和代码规范。队列命名建议采用 `{业务域}_{优先级}` 的格式，例如 `payment_high`、`notification_low`。Job 类的命名应该清晰表达业务语义，例如 `SendOrderConfirmationEmail` 而不是 `EmailJob`。每个 Job 都必须定义合理的超时时间和重试次数，不能使用默认值，因为不同业务场景的容忍度差异很大。建议在代码审查时将 Job 的超时和重试配置作为必检项，避免遗漏。对于关键业务链路的 Job，应该在 `failed` 方法中集成告警通知，确保失败任务能被及时发现和处理。

## 相关阅读

- [Redis 高并发](/databases/high-concurrency) — Redis 高并发场景下的性能瓶颈与优化策略
- [Redis Lua 脚本原子操作实战](/databases/redis-lua-guide-distributedrate-limiting) — 分布式限流、库存扣减、排行榜的 Redis Lua 原子操作方案
- [Ansible 实战：Laravel 应用自动化部署与配置管理](/07_CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录) — Laravel 生产环境的自动化部署与配置管理
