---
title: "Laravel Queue Sharding 实战：按优先级/租户/业务域分片队列——高吞吐场景的队列架构演进与 Horizon 监控治理"
keywords: [Laravel Queue Sharding, Horizon, 按优先级, 租户, 业务域分片队列, 高吞吐场景的队列架构演进与, 监控治理, 架构]
date: 2026-06-09 18:18:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Queue
  - Redis
  - Horizon
  - 分片
  - 高并发
description: "深入探讨 Laravel 队列分片架构设计，涵盖按优先级、租户、业务域三种分片策略，结合 Horizon 实现精细化监控治理，支撑百万级消息吞吐。"
---


## 概述

当 Laravel 应用从单体走向多租户、从低并发走向高吞吐，单一队列的瓶颈会迅速暴露：消息堆积、优先级饥饿、租户间互相影响、监控粒度不足。Queue Sharding（队列分片）是解决这些问题的核心架构手段。

本文从实际生产场景出发，讲解三种分片策略的实现方式，配合 Horizon 监控治理，最终形成一套可落地的队列架构方案。

## 为什么需要队列分片

### 单队列的致命缺陷

```php
// 典型的单队列用法
dispatch(new SendEmail($user))->onQueue('default');
dispatch(new ProcessOrder($order))->onQueue('default');
dispatch(new SyncInventory($product))->onQueue('default');
```

问题：

1. **优先级饥饿**：低优先级的同步库存任务可能阻塞紧急的邮件发送
2. **租户噪声邻居**：大租户的消息洪流淹没小租户的任务
3. **业务域耦合**：订单、邮件、库存共用一个队列，一个 Worker 挂了影响全局
4. **监控无差别**：只能看到「队列整体积压」，无法定位具体瓶颈

### 分片的本质

分片 = 把一个逻辑队列拆成多个物理队列，每个队列有独立的 Worker 和配置。关键在于**分片键**的选择。

## 策略一：按优先级分片

最简单也最常用的分片方式。Laravel 原生支持，但很多团队没有用好。

### 队列定义

```php
// config/queue.php
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'default',
        'queue' => 'default',
        'retry_after' => 90,
        'block_for' => null,
    ],
],
```

### 优先级分片的 Job 基类

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

abstract class PriorityJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    // 优先级常量
    public const PRIORITY_CRITICAL = 'critical';
    public const PRIORITY_HIGH     = 'high';
    public const PRIORITY_NORMAL   = 'normal';
    public const PRIORITY_LOW      = 'low';

    /**
     * 子类覆写此方法指定优先级
     */
    public function getPriority(): string
    {
        return static::PRIORITY_NORMAL;
    }

    /**
     * 根据优先级自动分配队列名
     */
    public function __construct()
    {
        $this->onQueue($this->getPriority());
    }
}
```

### 具体 Job 实现

```php
<?php

namespace App\Jobs;

class SendUrgentNotification extends PriorityJob
{
    public function getPriority(): string
    {
        return static::PRIORITY_CRITICAL;
    }

    public function handle(): void
    {
        // 发送紧急通知
        $this->user->notify(new UrgentNotification($this->data));
    }
}

class SyncProductInventory extends PriorityJob
{
    public function getPriority(): string
    {
        return static::PRIORITY_LOW;
    }

    public function handle(): void
    {
        // 同步库存，允许延迟
        app(InventoryService::class)->sync($this->productId);
    }
}
```

### Horizon 配置：按优先级分配 Worker 比例

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-critical' => [
            'connection' => 'redis',
            'queue' => ['critical'],
            'balance' => 'auto',
            'maxProcesses' => 10,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 128,
            'tries' => 3,
            'timeout' => 60,
            'nice' => 0,
        ],
        'supervisor-high' => [
            'connection' => 'redis',
            'queue' => ['high'],
            'balance' => 'auto',
            'maxProcesses' => 8,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 128,
            'tries' => 3,
            'timeout' => 60,
            'nice' => 0,
        ],
        'supervisor-normal' => [
            'connection' => 'redis',
            'queue' => ['normal'],
            'balance' => 'auto',
            'maxProcesses' => 5,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 128,
            'tries' => 3,
            'timeout' => 60,
            'nice' => 0,
        ],
        'supervisor-low' => [
            'connection' => 'redis',
            'queue' => ['low'],
            'balance' => 'auto',
            'maxProcesses' => 3,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 128,
            'tries' => 3,
            'timeout' => 60,
            'nice' => 0,
        ],
    ],
],
```

关键点：`critical` 队列分配 10 个进程，`low` 只分配 3 个。即使低优先级消息堆积，也不会抢占高优先级的处理资源。

## 策略二：按租户分片

SaaS 场景下，不同租户的业务量差异巨大。大租户的消息洪流可能阻塞小租户的任务处理。

### 租户分片分发器

```php
<?php

namespace App\Jobs\Middleware;

use Closure;

class TenantQueueMiddleware
{
    /**
     * 根据租户 ID 路由到对应的队列
     */
    public function handle(object $job, Closure $next): mixed
    {
        $tenantId = $this->resolveTenantId($job);

        if ($tenantId) {
            // 租户级别分片：tenant_{id}，或按租户等级分组
            $queueName = $this->resolveQueueByTenant($tenantId);
            $job->onQueue($queueName);
        }

        return $next($job);
    }

    private function resolveTenantId(object $job): ?int
    {
        // 从 Job 属性中提取租户 ID
        if (isset($job->tenantId)) {
            return $job->tenantId;
        }

        // 从关联模型中提取
        if (isset($job->model) && method_exists($job->model, 'getTenantId')) {
            return $job->model->getTenantId();
        }

        return null;
    }

    private function resolveQueueByTenant(int $tenantId): string
    {
        // 租户分级：大租户独占队列，小租户共享队列
        $tenant = cache()->remember("tenant:{$tenantId}:info", 3600, function () use ($tenantId) {
            return \App\Models\Tenant::find($tenantId);
        });

        if (!$tenant) {
            return 'tenant_default';
        }

        return match ($tenant->tier) {
            'enterprise' => "tenant_enterprise_{$tenantId}",
            'pro'        => "tenant_pro_" . ($tenantId % 4),  // 4 个 pro 队列轮询
            default      => 'tenant_default',
        };
    }
}
```

### 使用租户分片的 Job

```php
<?php

namespace App\Jobs;

use App\Jobs\Middleware\TenantQueueMiddleware;

class ProcessTenantOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tenantId;

    public function __construct(public Order $order)
    {
        $this->tenantId = $order->tenant_id;
    }

    /**
     * 注册中间件，自动路由到租户队列
     */
    public function middleware(): array
    {
        return [new TenantQueueMiddleware()];
    }

    public function handle(): void
    {
        app(OrderService::class)->process($this->order);
    }
}
```

### Horizon 配置：租户队列组

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-enterprise' => [
            'connection' => 'redis',
            'queue' => ['tenant_enterprise_1', 'tenant_enterprise_2'],
            'balance' => 'auto',
            'maxProcesses' => 15,  // 大租户专属高并发
            'tries' => 3,
            'timeout' => 120,
        ],
        'supervisor-pro' => [
            'connection' => 'redis',
            'queue' => ['tenant_pro_0', 'tenant_pro_1', 'tenant_pro_2', 'tenant_pro_3'],
            'balance' => 'auto',
            'maxProcesses' => 8,
            'tries' => 3,
            'timeout' => 60,
        ],
        'supervisor-default' => [
            'connection' => 'redis',
            'queue' => ['tenant_default'],
            'balance' => 'auto',
            'maxProcesses' => 5,
            'tries' => 3,
            'timeout' => 60,
        ],
    ],
],
```

## 策略三：按业务域分片

最贴近微服务思想的分片方式。不同业务域有独立的队列、Worker、重试策略。

### 业务域队列注册表

```php
<?php

namespace App\Support\Queue;

class DomainQueueRegistry
{
    /**
     * 业务域 → 队列配置映射
     */
    public const DOMAINS = [
        'order' => [
            'queue'         => 'domain_order',
            'max_processes' => 10,
            'timeout'       => 120,
            'tries'         => 5,
            'retry_after'   => 180,
            'memory'        => 256,
        ],
        'payment' => [
            'queue'         => 'domain_payment',
            'max_processes' => 8,
            'timeout'       => 90,
            'tries'         => 5,
            'retry_after'   => 120,
            'memory'        => 128,
        ],
        'notification' => [
            'queue'         => 'domain_notification',
            'max_processes' => 6,
            'timeout'       => 30,
            'tries'         => 3,
            'retry_after'   => 60,
            'memory'        => 64,
        ],
        'inventory' => [
            'queue'         => 'domain_inventory',
            'max_processes' => 5,
            'timeout'       => 60,
            'tries'         => 3,
            'retry_after'   => 90,
            'memory'        => 128,
        ],
        'analytics' => [
            'queue'         => 'domain_analytics',
            'max_processes' => 3,
            'timeout'       => 300,
            'tries'         => 2,
            'retry_after'   => 600,
            'memory'        => 512,
        ],
    ];

    public static function getQueue(string $domain): string
    {
        return static::DOMAINS[$domain]['queue'] ?? 'domain_default';
    }

    public static function getConfig(string $domain): array
    {
        return static::DOMAINS[$domain] ?? static::DOMAINS['order'];
    }
}
```

### 业务域 Job Trait

```php
<?php

namespace App\Jobs\Traits;

use App\Support\Queue\DomainQueueRegistry;

trait BelongsToDomain
{
    public function getDomain(): string
    {
        return property_exists($this, 'domain') ? $this->domain : 'default';
    }

    /**
     * 自动设置队列名和超时
     */
    public function configureForDomain(): void
    {
        $domain = $this->getDomain();
        $config = DomainQueueRegistry::getConfig($domain);

        $this->onQueue($config['queue']);
        $this->timeout = $config['timeout'];
        $this->tries = $config['tries'];
    }
}
```

### 使用示例

```php
<?php

namespace App\Jobs\Order;

use App\Jobs\Traits\BelongsToDomain;
use Illuminate\Contracts\Queue\ShouldQueue;

class CreateOrderShard implements ShouldQueue
{
    use BelongsToDomain;

    protected string $domain = 'order';

    public function __construct(public array $orderData)
    {
        $this->configureForDomain();
    }

    public function handle(): void
    {
        app(OrderService::class)->create($this->orderData);
    }
}

class ProcessPayment implements ShouldQueue
{
    use BelongsToDomain;

    protected string $domain = 'payment';

    public function __construct(public Payment $payment)
    {
        $this->configureForDomain();
    }

    public function handle(): void
    {
        app(PaymentGateway::class)->process($this->payment);
    }
}
```

## 组合分片：优先级 × 租户 × 业务域

生产环境往往需要组合多种分片策略。核心思路是**队列命名约定 + 动态路由**。

### 组合分片路由器

```php
<?php

namespace App\Jobs\Router;

use App\Support\Queue\DomainQueueRegistry;

class QueueShardRouter
{
    /**
     * 队列命名格式：{domain}_{priority}_{tenant_group}
     * 例：order_critical_enterprise_1, notification_normal_default
     */
    public static function resolve(object $job): string
    {
        $domain = $this->resolveDomain($job);
        $priority = $this->resolvePriority($job);
        $tenantGroup = $this->resolveTenantGroup($job);

        return implode('_', array_filter([
            $domain,
            $priority,
            $tenantGroup,
        ]));
    }

    private static function resolveDomain(object $job): string
    {
        if (method_exists($job, 'getDomain')) {
            return $job->getDomain();
        }

        // 从类名推断
        $class = class_basename($job);
        return match (true) {
            str_contains($class, 'Order')       => 'order',
            str_contains($class, 'Payment')     => 'payment',
            str_contains($class, 'Notification') => 'notification',
            str_contains($class, 'Inventory')   => 'inventory',
            default                             => 'default',
        };
    }

    private static function resolvePriority(object $job): string
    {
        if (method_exists($job, 'getPriority')) {
            return $job->getPriority();
        }

        return 'normal';
    }

    private static function resolveTenantGroup(object $job): string
    {
        $tenantId = $job->tenantId ?? null;

        if (!$tenantId) {
            return '';
        }

        $tier = cache()->remember("tenant:{$tenantId}:tier", 3600, function () use ($tenantId) {
            return \App\Models\Tenant::where('id', $tenantId)->value('tier') ?? 'default';
        });

        return match ($tier) {
            'enterprise' => "ent_{$tenantId}",
            'pro'        => 'pro',
            default      => '',
        };
    }
}
```

### 路由中间件

```php
<?php

namespace App\Jobs\Middleware;

use App\Jobs\Router\QueueShardRouter;
use Closure;

class ShardRoutingMiddleware
{
    public function handle(object $job, Closure $next): mixed
    {
        $queueName = QueueShardRouter::resolve($job);
        $job->onQueue($queueName);

        return $next($job);
    }
}
```

### 动态 Horizon 配置生成器

手动维护几十个队列的 Horizon 配置不现实。用脚本自动生成：

```php
<?php

// app/Console/Commands/GenerateHorizonConfig.php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class GenerateHorizonConfig extends Command
{
    protected $signature = 'horizon:generate-config';
    protected $description = '根据队列注册表自动生成 Horizon 配置';

    public function handle(): void
    {
        $domains = ['order', 'payment', 'notification', 'inventory', 'analytics'];
        $priorities = ['critical', 'high', 'normal', 'low'];
        $tenantGroups = ['', 'pro', 'ent'];

        $supervisors = [];

        foreach ($domains as $domain) {
            foreach ($priorities as $priority) {
                foreach ($tenantGroups as $group) {
                    $queueName = implode('_', array_filter([$domain, $priority, $group]));

                    // 根据优先级和域分配进程数
                    $maxProcesses = match ($priority) {
                        'critical' => 10,
                        'high'     => 6,
                        'normal'   => 4,
                        'low'      => 2,
                    };

                    // enterprise 租户额外加进程
                    if ($group === 'ent') {
                        $maxProcesses += 5;
                    }

                    $supervisors["supervisor-{$queueName}"] = [
                        'connection'   => 'redis',
                        'queue'        => [$queueName],
                        'balance'      => 'auto',
                        'maxProcesses' => $maxProcesses,
                        'maxTime'      => 3600,
                        'maxJobs'      => 1000,
                        'memory'       => 128,
                        'tries'        => 3,
                        'timeout'      => 60,
                    ];
                }
            }
        }

        $config = config('horizon');
        $config['environments']['production'] = array_merge(
            $config['environments']['production'] ?? [],
            $supervisors
        );

        $this->info('生成了 ' . count($supervisors) . ' 个 supervisor 配置');
        $this->info('请将以下配置合并到 config/horizon.php');
        $this->line(json_encode($supervisors, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
}
```

## 踩坑记录

### 坑 1：Redis 连接数爆炸

每个队列一个 Redis 连接，分片多了连接数会暴涨。

**解决方案**：使用 Redis 连接池 + 共享连接。

```php
// config/database.php
'redis' => [
    'options' => [
        'prefix' => 'laravel_',
    ],
    'default' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'username' => env('REDIS_USERNAME'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => '0',
        'read_write_timeout' => 60,
        'persistent' => true,  // 启用持久连接
    ],
],
```

```php
// Horizon 配置中，多个 supervisor 共享同一个 connection
'supervisor-order-critical' => [
    'connection' => 'redis',  // 共享
    'queue' => ['order_critical'],
    // ...
],
'supervisor-payment-critical' => [
    'connection' => 'redis',  // 共享
    'queue' => ['payment_critical'],
    // ...
],
```

### 坑 2：队列饥饿——低优先级永远不执行

如果高优先级消息持续涌入，低优先级 Worker 可能永远抢不到任务。

**解决方案**：Horizon 的 `balance` 策略 + 队列权重。

```php
// config/horizon.php
'supervisor-balanced' => [
    'connection' => 'redis',
    'queue' => ['critical', 'high', 'normal', 'low'],
    'balance' => 'auto',           // 自动负载均衡
    'maxProcesses' => 20,          // 总进程数
    'balanceMaxShift' => 5,        // 每次最多调整 5 个进程
    'balanceCooldown' => 3,        // 调整间隔 3 秒
    'autoScalingStrategy' => 'time', // 基于处理时间自动缩放
],
```

`balance => 'auto'` 会让 Horizon 根据各队列的待处理数量动态分配进程，避免饥饿。

### 坑 3：跨域事务一致性

订单创建后派发支付 Job，如果分片后支付队列处理延迟，用户体验会变差。

**解决方案**：关键路径用同步 dispatch + 队列兜底。

```php
<?php

namespace App\Services\OrderService;

class OrderService
{
    public function create(array $data): Order
    {
        return DB::transaction(function () use ($data) {
            $order = Order::create($data);

            // 关键路径：同步 dispatch（在当前请求内完成）
            ProcessPayment::dispatch($order->payment)
                ->onConnection('sync')  // 同步执行
                ->onQueue('payment_critical');

            // 非关键路径：异步队列
            SendOrderConfirmation::dispatch($order)
                ->onQueue('notification_normal');

            return $order;
        });
    }
}
```

### 坑 4：Horizon 仪表板权限泄露

Horizon 默认没有权限控制，生产环境暴露就是安全漏洞。

```php
// app/Providers/HorizonServiceProvider.php
protected function gate(): void
{
    Gate::define('viewHorizon', function ($user) {
        return in_array($user->email, [
            'admin@example.com',
        ]);
    });
}
```

### 坑 5：死信队列（Dead Letter Queue）管理

分片后，每个队列的失败任务分散在各处，排查困难。

**解决方案**：统一失败任务收集器。

```php
<?php

namespace App\Jobs\Middleware;

use Illuminate\Support\Facades\Redis;

class FailedJobCollectorMiddleware
{
    public function handle(object $job, \Closure $next): void
    {
        try {
            $next($job);
        } catch (\Throwable $e) {
            // 记录到统一的失败任务哈希
            Redis::hSet('failed_jobs:summary', $job->getJobId(), json_encode([
                'queue'     => $job->queue ?? 'default',
                'job_class' => get_class($job),
                'exception' => $e->getMessage(),
                'failed_at' => now()->toIso8601String(),
                'attempts'  => $job->attempts(),
            ]));

            throw $e;
        }
    }
}
```

## 监控治理：Horizon 深度配置

### 自定义 Horizon 指标

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Laravel\Horizon\Horizon;

class HorizonServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 队列积压告警
        Horizon::routeMailNotificationsTo('ops@example.com');
        Horizon::routeSlackNotificationsTo('#queue-alerts');

        // 自定义等待时间阈值
        Horizon::night();

        // 监控特定队列的等待时间
        $this->monitorQueueWaitTimes();
    }

    private function monitorQueueWaitTimes(): void
    {
        // 每分钟检查一次
        $this->callEvery(function () {
            $queues = ['critical', 'high', 'normal', 'low'];

            foreach ($queues as $queue) {
                $waitTime = \Illuminate\Support\Facades\Redis::llen("queues:{$queue}") * 0.1;

                if ($waitTime > 30) { // 超过 30 秒
                    \Log::warning("队列 [{$queue}] 等待时间过长", [
                        'wait_time_seconds' => $waitTime,
                        'queue_depth' => \Illuminate\Support\Facades\Redis::llen("queues:{$queue}"),
                    ]);
                }
            }
        }, 60);
    }
}
```

### 队列健康检查 API

```php
<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Redis;

class QueueHealthController extends Controller
{
    public function index(): JsonResponse
    {
        $queues = [
            'critical', 'high', 'normal', 'low',
            'order_critical', 'payment_critical',
            'notification_normal',
        ];

        $health = [];

        foreach ($queues as $queue) {
            $pending = Redis::llen("queues:{$queue}");
            $processing = $this->getProcessingCount($queue);

            $health[$queue] = [
                'pending'    => $pending,
                'processing' => $processing,
                'status'     => $this->resolveStatus($pending),
            ];
        }

        $overallStatus = collect($health)->contains('status', 'critical')
            ? 'critical'
            : (collect($health)->contains('status', 'warning') ? 'warning' : 'healthy');

        return response()->json([
            'status' => $overallStatus,
            'queues' => $health,
            'checked_at' => now()->toIso8601String(),
        ]);
    }

    private function getProcessingCount(string $queue): int
    {
        return (int) Redis::get("queue:{$queue}:processing_count") ?? 0;
    }

    private function resolveStatus(int $pending): string
    {
        return match (true) {
            $pending > 10000 => 'critical',
            $pending > 1000  => 'warning',
            default          => 'healthy',
        };
    }
}
```

## 总结

| 分片策略 | 适用场景 | 复杂度 | 效果 |
|---------|---------|--------|------|
| 按优先级 | 所有项目 | 低 | 解决优先级饥饿 |
| 按租户 | SaaS 多租户 | 中 | 隔离租户影响 |
| 按业务域 | 复杂业务系统 | 中 | 故障隔离 + 独立扩缩容 |
| 组合分片 | 高吞吐生产环境 | 高 | 全方位治理 |

**核心原则**：

1. **先简单后复杂**：从优先级分片开始，按需引入租户和业务域分片
2. **命名约定统一**：`{domain}_{priority}_{tenant_group}` 格式贯穿始终
3. **监控先行**：分片前先有队列监控，分片后才能对比效果
4. **自动化配置**：队列数量多时，用脚本生成 Horizon 配置，避免手动维护出错
5. **关注 Redis 资源**：分片意味着更多连接和内存，提前规划 Redis 容量

队列分片不是银弹，但在高吞吐场景下，它是从「能跑」到「能扛」的关键一步。
