---
title: Laravel Horizon 深度实战进阶：自定义 Job 标签、Metrics Dashboard、Silenced Jobs 与多队列优先级的生产级运维
keywords: [Laravel Horizon, Job, Metrics Dashboard, Silenced Jobs, 深度实战进阶, 自定义, 标签, 与多队列优先级的生产级运维, PHP]
date: 2026-06-10 05:25:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Horizon
  - Redis
  - 队列
  - 运维
description: 深入 Laravel Horizon 生产级运维实践，涵盖自定义 Job 标签体系、Metrics Dashboard 搭建、Silenced Jobs 静默策略、多队列优先级调度，以及 Supervisor 调优的完整方案。
---


## 概述

Laravel Horizon 是 Redis 队列的官方管理面板，开箱即用的 Dashboard 和 Supervisor 管理让它成为 Laravel 项目队列运维的首选。但在生产环境中，默认配置远远不够——你需要精细化的 Job 标签来快速定位任务、Metrics Dashboard 来监控队列健康、Silenced Jobs 来降低噪音、以及多队列优先级来保障核心业务的及时处理。

本文基于实际生产环境经验，系统讲解 Horizon 的进阶运维技巧。

## 一、自定义 Job 标签体系

### 1.1 标签的作用

Horizon 的标签（Tags）是 Dashboard 中筛选和搜索 Job 的核心维度。默认情况下，Horizon 会用 Job 类名作为标签，但在生产中你需要更多语义化的标签。

### 1.2 手动定义标签

在 Job 类中实现 `tags()` 方法：

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SendOrderNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public int $orderId,
        public string $channel, // email, sms, wechat
        public string $priority = 'normal'
    ) {}

    public function tags(): array
    {
        return [
            'order:' . $this->orderId,
            'channel:' . $this->channel,
            'priority:' . $this->priority,
            'notification',
        ];
    }

    public function handle(): void
    {
        // 发送逻辑
    }
}
```

### 1.3 基于模型的动态标签

对于 Eloquent 模型关联的 Job，可以自动生成关联标签：

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use App\Models\Order;
use App\Models\User;

class ProcessOrderPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public Order $order
    ) {}

    public function tags(): array
    {
        return [
            'order:' . $this->order->id,
            'user:' . $this->order->user_id,
            'amount:' . $this->order->total_amount,
            'payment',
            'critical',
        ];
    }

    public function handle(): void
    {
        // 支付处理逻辑
    }
}
```

### 1.4 全局标签中间件

如果希望所有 Job 都带上环境和时间戳标签，可以用中间件：

```php
<?php

namespace App\Jobs\Middleware;

use Closure;

class AddGlobalTagsMiddleware
{
    public function handle(object $job, Closure $next): mixed
    {
        // Horizon 通过 $job->tags() 获取标签
        // 这里无法直接修改 tags，但可以在 Job 基类中统一处理

        return $next($job);
    }
}
```

更实用的做法是创建一个 BaseJob 抽象类：

```php
<?php

namespace App\Jobs;

abstract class BaseJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function tags(): array
    {
        $tags = static::class;
        if (method_exists($this, 'customTags')) {
            $tags = array_merge((array) $tags, $this->customTags());
        }
        return array_merge((array) $tags, [
            'env:' . app()->environment(),
        ]);
    }

    abstract protected function customTags(): array;
}
```

## 二、Metrics Dashboard 搭建

### 2.1 Horizon 内置 Metrics

Horizon 自带基础 Metrics，通过 `/horizon/dashboard` 访问。但生产环境需要更细粒度的监控。

### 2.2 自定义 Metrics 收集

在 `AppServiceProvider` 中注册自定义指标：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Laravel\Horizon\Horizon;

class HorizonServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 配置 Horizon 的 Metrics 周期
        Horizon::trimRecentJobsHours(24);
        Horizon::trimCompletedJobsHours(48);

        // 自定义 Metrics 格式化
        Horizon::night(function () {
            // 每日清理：删除超过 7 天的失败 Job 记录
            $this->cleanOldFailedJobs();
        });
    }

    protected function cleanOldFailedJobs(): void
    {
        $cutoff = now()->subDays(7);
        \DB::table('failed_jobs')
            ->where('failed_at', '<', $cutoff)
            ->delete();
    }
}
```

### 2.3 队列深度监控

编写一个 Artisan 命令来定期采集队列深度数据：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;

class QueueMetricsCollect extends Command
{
    protected $signature = 'queue:metrics-collect';
    protected $description = '采集队列深度指标并写入时序数据';

    public function handle(): int
    {
        $queues = config('horizon.defaults.supervisor-1.queues', ['default']);

        foreach ($queues as $queue) {
            $length = Redis::llen("queues:{$queue}");
            $pending = Redis::llen("queues:{$queue}:pending") ?? 0;

            // 写入自定义存储（如 InfluxDB、Prometheus Pushgateway）
            $this->line(json_encode([
                'timestamp' => now()->toIso8601String(),
                'queue' => $queue,
                'length' => $length,
                'pending' => $pending,
            ]));
        }

        return self::SUCCESS;
    }
}
```

### 2.4 Grafana + Prometheus 集成

在 `config/horizon.php` 中配置 Metrics 导出：

```php
'metrics' => [
    'thumbnail_snapshots' => [
        'job' => 'short',
        'queue' => 'short',
    ],
],
```

使用 `horizon:status` 命令配合自定义 Exporter，将数据推送到 Prometheus：

```bash
# 在 crontab 中每分钟采集
* * * * * cd /path/to/project && php artisan queue:metrics-collect >> /var/log/queue-metrics.log
```

## 三、Silenced Jobs 静默策略

### 3.1 什么是 Silenced Jobs

某些 Job 运行频率极高（如心跳检测、日志轮转），在 Horizon Dashboard 中产生大量噪音。Silenced Jobs 让这些 Job 不在 Recent Jobs 列表中显示，但仍正常执行。

### 3.2 配置 Silenced Jobs

在 `config/horizon.php` 中：

```php
'silenced' => [
    App\Jobs\HeartbeatCheck::class,
    App\Jobs\LogRotation::class,
    App\Jobs\CacheWarmup::class,
    App\Jobs\SyncSessionData::class,
],
```

### 3.3 基于标签的动态静默

如果不想硬编码类名，可以用标签筛选：

```php
<?php

namespace App\Providers;

use Laravel\Horizon\Horizon;
use Illuminate\Support\ServiceProvider;

class HorizonServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 通过 middleware 实现基于标签的静默
        Horizon::filter(function ($job) {
            // 如果 Job 有 'silent' 标签，不显示在 Dashboard
            if (method_exists($job, 'tags')) {
                return !in_array('silent', $job->tags());
            }
            return true;
        });
    }
}
```

对应 Job 中添加标签：

```php
class HeartbeatCheck implements ShouldQueue
{
    public function tags(): array
    {
        return ['heartbeat', 'silent'];
    }
}
```

### 3.4 静默 Job 的监控补偿

静默不代表不关注。为静默 Job 单独建立监控：

```php
<?php

namespace App\Jobs\Middleware;

class SilentJobMonitorMiddleware
{
    public function handle(object $job, Closure $next): mixed
    {
        $start = microtime(true);

        $result = $next($job);

        $duration = microtime(true) - $start;

        // 如果执行超过阈值，记录告警
        if ($duration > 30) { // 30 秒
            \Log::warning('Silent job slow execution', [
                'job' => get_class($job),
                'duration' => round($duration, 2),
                'queue' => $job->queue ?? 'default',
            ]);
        }

        return $result;
    }
}
```

## 四、多队列优先级调度

### 4.1 队列优先级设计原则

生产环境中，不同业务的 Job 优先级差异巨大：

| 优先级 | 队列名 | 典型场景 | Worker 数量 |
|--------|--------|----------|-------------|
| P0 - 紧急 | critical | 支付回调、库存扣减 | 3-5 |
| P1 - 高 | high | 订单通知、短信发送 | 2-3 |
| P2 - 普通 | default | 数据同步、报表生成 | 2 |
| P3 - 低 | low | 日志清理、缓存预热 | 1 |

### 4.2 Horizon 配置

在 `config/horizon.php` 中配置多 Supervisor：

```php
'environments' => [
    'production' => [
        'supervisor-critical' => [
            'connection' => 'redis',
            'queue' => ['critical'],
            'balance' => 'auto',
            'autoScalingStrategy' => 'time',
            'maxProcesses' => 5,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 256,
            'tries' => 3,
            'timeout' => 120,
            'nice' => 0, // 高优先级进程
        ],
        'supervisor-high' => [
            'connection' => 'redis',
            'queue' => ['high'],
            'balance' => 'auto',
            'autoScalingStrategy' => 'time',
            'maxProcesses' => 3,
            'maxTime' => 3600,
            'maxJobs' => 500,
            'memory' => 256,
            'tries' => 3,
            'timeout' => 90,
            'nice' => 5,
        ],
        'supervisor-default' => [
            'connection' => 'redis',
            'queue' => ['default'],
            'balance' => 'auto',
            'autoScalingStrategy' => 'time',
            'maxProcesses' => 2,
            'maxTime' => 3600,
            'maxJobs' => 200,
            'memory' => 256,
            'tries' => 3,
            'timeout' => 60,
            'nice' => 10,
        ],
        'supervisor-low' => [
            'connection' => 'redis',
            'queue' => ['low'],
            'balance' => 'auto',
            'autoScalingStrategy' => 'time',
            'maxProcesses' => 1,
            'maxTime' => 7200,
            'maxJobs' => 100,
            'memory' => 128,
            'tries' => 1,
            'timeout' => 300,
            'nice' => 15,
        ],
    ],
],
```

### 4.3 Job 分发到指定队列

```php
<?php

namespace App\Jobs;

class ProcessPaymentCallback extends BaseJob
{
    public function __construct(
        public array $callbackData
    ) {
        // 构造函数中指定队列
        $this->onQueue('critical');
    }

    protected function customTags(): array
    {
        return ['payment', 'callback', 'critical'];
    }

    public function handle(): void
    {
        // 处理支付回调
    }
}
```

### 4.4 动态队列分配

根据业务逻辑动态决定 Job 去哪个队列：

```php
<?php

namespace App\Services;

use App\Jobs\SendNotification;

class NotificationDispatcher
{
    public function dispatch(array $data, string $urgency = 'normal'): void
    {
        $queue = match ($urgency) {
            'urgent' => 'critical',
            'high' => 'high',
            'low' => 'low',
            default => 'default',
        };

        SendNotification::dispatch($data)->onQueue($queue);
    }
}
```

## 五、Supervisor 调优

### 5.1 自动扩缩容策略

Horizon 支持两种自动扩缩容策略：

```php
// 基于时间：队列中 Job 等待时间超过阈值就扩容
'autoScalingStrategy' => 'time',

// 基于数量：队列中 Job 数量超过阈值就扩容
'autoScalingStrategy' => 'size',
```

推荐使用 `time` 策略，因为它更直接反映用户体验。

### 5.2 内存和超时调优

```php
'supervisor-default' => [
    'connection' => 'redis',
    'queue' => ['default'],
    'balance' => 'auto',
    'maxProcesses' => 5,
    'maxTime' => 3600,      // 单个进程最大运行时间（秒）
    'maxJobs' => 1000,      // 单个进程最大处理 Job 数
    'memory' => 256,        // 内存上限（MB），超过自动重启
    'tries' => 3,           // 最大重试次数
    'timeout' => 60,        // 单个 Job 超时时间
    'sleep' => 3,           // 队列为空时休眠时间
    'retryAfter' => 90,     // Job 未完成时的重试等待时间
    'nice' => 0,            // 进程优先级（-20 到 20）
],
```

### 5.3 平衡策略详解

```php
// 不平衡：所有进程处理同一队列
'balance' => false,

// 自动平衡：根据队列负载动态分配进程
'balance' => 'auto',

// 自动平衡 + 按时间扩缩
'autoScalingStrategy' => 'time',
'balanceCooldown' => 3,  // 扩缩冷却时间（轮次）
'balanceMaxShift' => 1,  // 每次最大调整进程数
```

## 六、生产环境踩坑记录

### 6.1 Redis 内存爆炸

**问题**：Job 的 payload 过大导致 Redis 内存快速膨胀。

**解决**：

```php
// 在 Job 中使用 SerializesModels 时，只传递 ID
class HeavyJob implements ShouldQueue
{
    use SerializesModels;

    public function __construct(
        public int $userId  // 只传 ID，不传整个模型
    ) {}

    public function handle(): void
    {
        $user = User::findOrFail($this->userId); // 用时再查
    }
}
```

### 6.2 Job 重复执行

**问题**：同一 Job 被多个 Worker 重复处理。

**解决**：使用 `WithoutOverlapping` 中间件：

```php
<?php

namespace App\Jobs\Middleware;

use Illuminate\Support\Facades\Cache;

class WithoutOverlapping
{
    public function __construct(
        private string $key,
        private int $expires = 3600
    ) {}

    public function handle(object $job, Closure $next): mixed
    {
        $lock = Cache::lock("job_overlap:{$this->key}", $this->expires);

        if (!$lock->get()) {
            // 重新入队，延迟执行
            $job->release(30);
            return;
        }

        try {
            return $next($job);
        } finally {
            $lock->release();
        }
    }
}
```

### 6.3 失败 Job 堆积

**问题**：失败 Job 不断重试，占用队列资源。

**解决**：配置 `retryAfter` 和失败 Job 自动清理：

```php
// config/queue.php
'redis' => [
    'connection' => 'default',
    'queue' => env('REDIS_QUEUE', 'default'),
    'retry_after' => 90,  // 90 秒未完成视为失败
    'block_for' => null,
],
```

### 6.4 Horizon Dashboard 权限

**问题**：Dashboard 暴露在公网，存在安全风险。

**解决**：在 `app/Providers/HorizonServiceProvider.php` 中：

```php
public function boot(): void
{
    Horizon::auth(function ($request) {
        // 只允许内网或 VPN 访问
        return in_array($request->ip(), [
            '127.0.0.1',
            '10.0.0.0/8',
            '172.16.0.0/12',
            '192.168.0.0/16',
        ]) || app()->environment('local');
    });
}
```

## 七、监控告警最佳实践

### 7.1 队列积压告警

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Notification;
use App\Notifications\QueueBacklogAlert;

class QueueBacklogMonitor extends Command
{
    protected $signature = 'queue:backlog-monitor';
    protected $description = '监控队列积压并发送告警';

    private array $thresholds = [
        'critical' => 10,
        'high' => 50,
        'default' => 200,
        'low' => 500,
    ];

    public function handle(): int
    {
        foreach ($this->thresholds as $queue => $threshold) {
            $length = Redis::llen("queues:{$queue}");

            if ($length > $threshold) {
                Notification::route('slack', config('services.slack.webhook'))
                    ->notify(new QueueBacklogAlert($queue, $length, $threshold));
            }
        }

        return self::SUCCESS;
    }
}
```

### 7.2 失败 Job 告警

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Laravel\Horizon\Horizon;
use Illuminate\Support\Facades\Notification;
use App\Notifications\JobFailedAlert;

class HorizonServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Horizon::failing(function ($connection, $queue, $job) {
            // 关键队列的 Job 失败立即告警
            if (in_array($queue, ['critical', 'high'])) {
                Notification::route('slack', config('services.slack.webhook'))
                    ->notify(new JobFailedAlert($job, $queue));
            }
        });
    }
}
```

## 总结

Laravel Horizon 的生产级运维需要关注四个维度：

1. **标签体系**：让你能从海量 Job 中快速定位问题，按订单、用户、业务线多维筛选
2. **Metrics 监控**：Horizon 内置 Metrics 够用，但生产环境建议接入 Grafana/Prometheus 做长期趋势分析
3. **静默策略**：高频低价值 Job 配置 Silenced，降低 Dashboard 噪音，但别忘了单独监控
4. **队列优先级**：按业务重要性分队列，关键队列多进程、短超时，低优先级队列少进程、长超时

最后，记住运维的黄金法则：**监控先行，告警兜底，日志可追溯**。不要等出了问题才想起来加监控。
