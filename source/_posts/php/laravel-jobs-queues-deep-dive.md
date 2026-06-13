---

title: Laravel Jobs & Queues 深度实战：延迟队列、批量任务与失败重试策略踩坑记录
keywords: [Laravel Jobs, Queues, 深度实战, 延迟队列, 批量任务与失败重试策略踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-16 17:51:16
updated: 2026-05-16 17:55:11
categories:
- php
tags:
- Laravel
- Redis
- 消息队列
description: 深入 Laravel Jobs & Queues 生产实战：延迟队列实现订单超时取消、Bus::batch 批量任务编排、失败重试策略与死信队列处理，涵盖 Redis/Database/SQS/RabbitMQ 队列驱动对比、Horizon 监控配置及内存泄漏等生产环境踩坑案例，来自 B2C 电商项目的真实经验。
---


# Laravel Jobs & Queues 深度实战：延迟队列、批量任务与失败重试策略

> 之前写过 Laravel Redis Queue + Horizon 的基础实战和失败任务处理策略，但那些偏"怎么做"。这篇文章补上"怎么做对"——三个在 B2C 电商项目中反复踩坑的高阶场景。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Laravel Application                   │
│                                                         │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────┐ │
│  │Controller│──▶│  Job Dispatch │──▶│   Queue Driver  │ │
│  └──────────┘   └──────────────┘   │    (Redis)       │ │
│                                     └────────┬────────┘ │
│                                              │          │
│                    ┌─────────────────────────┼───────┐  │
│                    │         Horizon Supervisor       │  │
│                    │                                  │  │
│                    │  ┌─────────┐  ┌──────────────┐  │  │
│                    │  │default  │  │ notifications │  │  │
│                    │  │  Queue  │  │    Queue      │  │  │
│                    │  └────┬────┘  └──────┬───────┘  │  │
│                    │       │              │           │  │
│                    │  ┌────▼────┐  ┌──────▼───────┐  │  │
│                    │  │ Worker  │  │   Worker      │  │  │
│                    │  │ Pool(5) │  │  Pool(3)      │  │  │
│                    │  └────┬────┘  └──────┬───────┘  │  │
│                    └───────┼──────────────┼──────────┘  │
│                            │              │             │
│                    ┌───────▼──────────────▼──────────┐  │
│                    │         Failed Jobs Table        │  │
│                    │   (MySQL + Redis dead-letter)    │  │
│                    └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 队列驱动对比：Redis vs Database vs SQS vs RabbitMQ

在选型之前，先了解各驱动的核心差异：

| 特性 | Redis | Database | SQS | RabbitMQ |
|------|-------|----------|-----|----------|
| **吞吐量** | 高（10K+/s） | 低（~500/s） | 高（标准队列无限制） | 高（10K+/s） |
| **延迟** | 极低（<1ms） | 中等（轮询间隔） | 低（标准 ~0ms，FIFO ~ms） | 极低（<1ms） |
| **持久化** | 依赖 AOF/RDB（可丢数据） | MySQL/PostgreSQL（天然持久） | S3 存储（14 天保留） | 磁盘持久化（可配置） |
| **优先级队列** | 支持（多队列权重） | 不原生支持 | 支持（FIFO 优先级） | 原生支持 |
| **延迟任务** | 支持（ZSET 实现） | 支持 | 支持（最大 15 分钟） | 插件支持（delayed_message_exchange） |
| **死信队列** | 需自行实现 | 需自行实现 | 原生支持（DLQ 配置） | 原生支持（DLX） |
| **运维复杂度** | 低 | 最低（无额外组件） | 最低（托管服务） | 高（需独立部署） |
| **适用场景** | 通用，中小规模首选 | 开发/测试，低吞吐量 | AWS 生态，Serverless | 大规模，复杂路由需求 |
| **Laravel batch 支持** | ✅ | ✅ | ❌（需 SQS FIFO workaround） | ✅ |

**选型建议**：中小项目直接用 Redis + Horizon，吞吐高且生态成熟；AWS 原生架构选 SQS（注意 FIFO 队列的 300 msg/s 上限）；对消息可靠性要求极高且有运维团队的选 RabbitMQ；Database driver 仅用于开发测试。

---

## 一、延迟队列：订单超时取消的正确姿势

### 业务场景

用户下单后 30 分钟未支付，自动取消订单并释放库存。听起来简单？在日均 10 万单的 B2C 场景下，踩过的坑远比想象多。

### 方案一：delay() 直接延迟派发

```php
// app/Jobs/CancelUnpaidOrder.php
class CancelUnpaidOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 30;

    public function __construct(
        public readonly int $orderId,
        public readonly int $userId,
    ) {}

    public function handle(): void
    {
        $order = Order::find($this->orderId);

        // 关键判断：订单状态可能在 30 分钟内已经变更
        if (!$order || $order->status !== OrderStatus::UNPAID) {
            return; // 幂等退出，不是失败
        }

        DB::transaction(function () use ($order) {
            $order->update(['status' => OrderStatus::CANCELLED]);
            // 释放库存
            foreach ($order->items as $item) {
                InventoryService::release($item->sku, $item->quantity);
            }
        });

        Log::info('Order cancelled by timeout', [
            'order_id' => $this->orderId,
        ]);
    }
}

// 下单时派发
CancelUnpaidOrder::dispatch($order->id, $order->user_id)
    ->delay(now()->addMinutes(30));
```

**踩坑 1：delay() 不是精确计时器**

`delay()` 只是告诉 Redis "这个时间之前不要出队"。如果 Worker 满负载，实际执行时间可能延迟 1-5 分钟。在 B2C 场景下，"30 分钟超时取消"变成"30-35 分钟取消"是可以接受的，但要在产品层面提前告知。

**踩坑 2：Redis 重启导致延迟任务丢失**

Redis 默认 RDB 持久化不是实时的。如果 Redis 进程崩溃，未持久化的延迟任务会丢失。解决方案：

```php
// config/queue.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'queue' => env('REDIS_QUEUE', 'default'),
    'retry_after' => 180, // 超过这个秒数未完成的任务会被重新出队
    'block_for' => null,
],
```

配合 Redis AOF 持久化（`appendonly yes` + `appendfsync everysec`），将数据丢失窗口从分钟级压缩到秒级。

**踩坑 3：数据库事务未提交就开始 Job**

这是最隐蔽的 bug：

```php
// ❌ 错误：事务可能还没提交，Job 就开始执行了
DB::beginTransaction();
$order = Order::create([...]);
CancelUnpaidOrder::dispatch($order->id, $order->user_id)
    ->delay(now()->addMinutes(30));
DB::commit();

// ✅ 正确：使用 afterCommit 或 Bus::afterCommit
DB::transaction(function () {
    $order = Order::create([...]);
    CancelUnpaidOrder::dispatch($order->id, $order->user_id)
        ->delay(now()->addMinutes(30));
});

// 或者显式声明
CancelUnpaidOrder::dispatch($order->id, $order->user_id)
    ->delay(now()->addMinutes(30))
    ->afterCommit();
```

---

## 二、Bus::batch 批量任务编排

### 业务场景

运营后台批量导入 5000 个商品，需要：1) 校验数据 → 2) 批量写入 → 3) 同步 Elasticsearch → 4) 通知运营完成。任何一个步骤失败需要回滚并告警。

### 基础实现

```php
// app/Jobs/BatchProductImport.php
class BatchProductImport implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(
        public readonly array $rows,
        public readonly int $batchId,
    ) {}

    public function handle(): void
    {
        if ($this->batch()->cancelled()) {
            return; // 批量任务被取消，立即退出
        }

        foreach ($this->rows as $row) {
            $validated = ProductValidator::validate($row);
            if (!$validated->passes()) {
                // 记录校验失败但不中断整个 batch
                $this->batch()->recordFailedJob(
                    $this->job->getJobId(),
                    new \RuntimeException("Row {$row['sku']}: {$validated->errors()->first()}")
                );
                continue;
            }

            Product::updateOrCreate(
                ['sku' => $row['sku']],
                $validated->validated(),
            );
        }
    }
}
```

### 编排完整流程

```php
// app/Services/ProductImportService.php
class ProductImportService
{
    public function import(array $csvData, int $userId): string
    {
        $chunks = collect($csvData)->chunk(100); // 每 100 行一个 Job
        $batchId = Str::uuid();

        $batch = Bus::batch([
            // 第一阶段：校验 + 写入（并行）
            ...$chunks->map(fn ($chunk) => new BatchProductImport(
                $chunk->toArray(),
                $batchId,
            )),

            // 第二阶段：ES 同步（串行，在所有写入完成后）
            new SyncProductsToElasticsearch($batchId),

            // 第三阶段：通知
            new NotifyImportComplete($batchId, $userId),
        ])
            ->name("Product Import #{$batchId}")
            ->onQueue('imports')           // 隔离队列，不影响业务
            ->allowFailures()              // 允许部分失败，不回滚成功部分
            ->then(fn (Batch $batch) => Log::info("Batch {$batch->id} all done"))
            ->catch(fn (Batch $batch, Throwable $e) => Log::error("Batch failed", [
                'batch_id' => $batch->id,
                'error' => $e->getMessage(),
            ]))
            ->finally(fn (Batch $batch) => Cache::forget("import:progress:{$batchId}"))
            ->dispatch();

        return $batch->id;
    }
}
```

**踩坑 4：Bus::batch 在 Database Driver 下的 `job_batches` 表**

Redis driver 下 batch 元数据存在 Redis 里，重启风险同上。Database driver 需要创建 `job_batches` 表：

```bash
php artisan queue:batches-table
php artisan migrate
```

但 Database driver 有一个严重问题——**batch 内 job 数量超过 1000 时性能急剧下降**，因为每完成一个 job 都要更新 `job_batches` 表的 `pending_jobs` 计数。我们的解决方案是混合策略：元数据用 Database（可靠），执行用 Redis（快）。

**踩坑 5：$this->batch()->cancelled() 检查时机**

必须在循环内检查，而不是只在 handle() 开头检查一次。一个处理 5000 行的 Job 可能跑 30 秒，期间用户取消了 batch，后面的行不应该继续写入。

---

## 三、失败重试策略：不是简单设 $tries 就完事

### 三级重试模型

```
┌──────────────────────────────────────────────────────────────┐
│                     失败重试策略分层                           │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │  Level 1    │  │  Level 2     │  │  Level 3            │ │
│  │  即时重试    │  │  指数退避     │  │  死信队列 + 告警     │ │
│  │             │  │              │  │                     │ │
│  │ $tries = 3  │  │ $backoff     │  │ failed() 回调       │ │
│  │ $backoff=0  │  │ [60,300,900] │  │ → Slack/钉钉告警    │ │
│  │             │  │              │  │ → 人工介入          │ │
│  │ 网络抖动    │  │ 服务暂时不可用│  │ 业务逻辑错误        │ │
│  └─────────────┘  └──────────────┘  └─────────────────────┘ │
│       ↓ 失败         ↓ 失败           ↓ 入库                 │
│       重试           重试            failed_jobs              │
└──────────────────────────────────────────────────────────────┘
```

### 生产级重试 Job 实现

```php
class ProcessPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $maxExceptions = 3;

    public function __construct(
        public readonly int $orderId,
        public readonly string $paymentMethod,
    ) {}

    /**
     * 指数退避：10s → 30s → 90s → 270s → 810s
     */
    public function backoff(): array
    {
        return [10, 30, 90, 270, 810];
    }

    /**
     * 最大生存时间：超过 30 分钟不再重试
     */
    public function retryUntil(): \DateTime
    {
        return now()->addMinutes(30);
    }

    /**
     * 判断异常是否值得重试
     */
    public function retryUntilException(\Throwable $exception): bool
    {
        // 这些异常不重试，直接进 failed_jobs
        $dontRetry = [
            InvalidPaymentMethodException::class,
            InsufficientBalanceException::class,
            OrderNotFoundException::class,
        ];

        foreach ($dontRetry as $ex) {
            if ($exception instanceof $ex) {
                return false;
            }
        }

        return true; // 其他异常（网络超时、服务不可用）可以重试
    }

    public function handle(): void
    {
        $order = Order::findOrFail($this->orderId);

        // 业务状态检查：防止重复扣款
        if ($order->payment_status !== PaymentStatus::PENDING) {
            Log::warning('Payment already processed', [
                'order_id' => $this->orderId,
                'current_status' => $order->payment_status,
            ]);
            return;
        }

        try {
            $result = PaymentGateway::charge($order->amount, $this->paymentMethod);

            $order->update([
                'payment_status' => PaymentStatus::PAID,
                'paid_at' => now(),
                'transaction_id' => $result->transactionId,
            ]);

            // 触发后续流程
            OrderPaid::dispatch($order);
        } catch (GatewayTimeoutException $e) {
            // 网关超时：可能是真的超时，也可能是延迟响应
            // 重试前先查询一次支付状态
            $status = PaymentGateway::queryStatus($order->id);
            if ($status === 'PAID') {
                $order->update(['payment_status' => PaymentStatus::PAID]);
                return;
            }
            throw $e; // 未支付，抛出让框架重试
        }
    }

    /**
     * 所有重试都失败后的处理
     */
    public function failed(\Throwable $exception): void
    {
        $order = Order::find($this->orderId);
        if (!$order) return;

        $order->update([
            'payment_status' => PaymentStatus::FAILED,
            'failure_reason' => $exception->getMessage(),
        ]);

        // 告警通知
        Notification::route('slack', config('services.slack.webhook'))
            ->notify(new PaymentFailedNotification($order, $exception));

        Log::error('Payment job permanently failed', [
            'order_id' => $this->orderId,
            'exception' => $exception->getMessage(),
            'attempts' => $this->attempts(),
        ]);
    }
}
```

**踩坑 6：retryUntil() 和 $tries 的冲突**

当两者同时存在时，**先达到的条件生效**。如果 `$tries = 3` 但 `retryUntil()` 允许 30 分钟，框架会先检查 tries 是否耗尽。建议二选一：
- 简单场景用 `$tries` + `$backoff`
- 复杂场景用 `retryUntil()` 管理总时间窗口

**踩坑 7：重试时 Job 被序列化，状态可能过时**

Laravel 用 `SerializesModels` trait 序列化 Model。每次重试会重新从数据库加载 Model。但如果你在构造函数里传了原始值（不是 Model），重试时拿到的是旧数据。解决：要么传 Model ID 在 handle() 里重新查询，要么用 `SerializesModels` 保证一致性。

**踩坑 8：`maxExceptions` 不等于 `$tries`**

`maxExceptions` 控制的是异常次数，`$tries` 控制的是尝试次数。如果 Job 在 handle() 里手动 catch 了异常并 return，不会计入 `maxExceptions`，但会计入 `$tries`。

---

## 四、Horizon 监控配置详解

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['default'],
            'balance' => 'auto',           // 自动负载均衡
            'autoScalingStrategy' => 'time', // 基于等待时间扩缩
            'maxProcesses' => 10,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 128,
            'tries' => 3,
            'timeout' => 60,
            'nice' => 0,
        ],
        'supervisor-imports' => [
            'connection' => 'redis',
            'queue' => ['imports'],         // 独立 supervisor
            'balance' => 'false',           // 不自动扩缩
            'maxProcesses' => 3,            // 限制并发，保护 DB
            'maxTime' => 7200,
            'memory' => 256,
            'tries' => 1,
            'timeout' => 300,
        ],
        'supervisor-notifications' => [
            'connection' => 'redis',
            'queue' => ['notifications'],
            'balance' => 'auto',
            'maxProcesses' => 5,
            'tries' => 5,
            'timeout' => 30,
        ],
    ],
],
```

### Horizon 仪表盘关键监控指标

Horizon Dashboard (`/horizon`) 提供以下核心指标，生产环境建议配合定时巡检：

| 指标 | 含义 | 告警阈值建议 |
|------|------|-------------|
| **Jobs Per Minute** | 每分钟处理的 Job 数量 | 骤降 >50% 需排查 Worker 或上游 |
| **Queue Wait Time** | Job 在队列中的等待时间 | >60s 需扩容 Worker |
| **Runtime** | Job 平均执行时间 | 超过 timeout 的 80% 需优化 |
| **Failed Jobs** | 失败 Job 数量 | >0 即需关注（按业务敏感度定） |
| **Active Processes** | 当前活跃 Worker 数 | 接近 maxProcesses 需扩容 |

### Supervisor 参数详解

| 参数 | 说明 | 生产建议 |
|------|------|---------|
| **`balance`** | `auto`（自动扩缩容）、`false`（固定进程数）、`simple`（简单平衡） | 业务队列用 `auto`，导入队列用 `false` |
| **`autoScalingStrategy`** | `time`（基于等待时间）或 `size`（基于队列长度） | 推荐 `time`，更贴近实际体验 |
| **`maxTime`** | 单个 Worker 最大运行时间（秒），防止内存泄漏导致僵死 | 3600-7200 |
| **`maxJobs`** | 单个 Worker 最大处理 Job 数，超过后自动重启 | 1000-5000 |
| **`memory`** | 内存上限（MB），超过后自动重启 Worker | 128-256（视 Job 复杂度） |
| **`nice`** | 进程优先级（-20 到 19，越低优先级越高） | 默认 0，关键业务可设 -10 |

### Horizon 告警通知

```php
// app/Providers/HorizonServiceProvider.php
protected function schedule(Schedule $schedule): void
{
    $schedule->command('horizon:snapshot')->everyFiveMinutes();

    // 每分钟检查队列健康状态
    $schedule->call(function () {
        $metrics = app(HorizonRepository::class)->metrics();
        $waitTimes = $metrics['wait'] ?? [];

        foreach ($waitTimes as $queue => $waitSeconds) {
            if ($waitSeconds > 120) {
                Notification::route('slack', config('services.slack.webhook'))
                    ->notify(new QueueBacklogNotification($queue, $waitSeconds));
            }
        }

        // 检查失败率
        $failedCount = DB::table('failed_jobs')
            ->where('failed_at', '>=', now()->subMinutes(5))
            ->count();

        if ($failedCount > 10) {
            Notification::route('slack', config('services.slack.webhook'))
                ->notify(new HighFailureRateNotification($failedCount));
        }
    })->everyMinute();
}
```

### 生产环境 Supervisor 进程管理

```ini
; /etc/supervisor/conf.d/horizon.conf
[program:horizon]
command=php /var/www/artisan horizon
autostart=true
autorestart=true
user=www-data
redirect_stderr=true
stdout_logfile=/var/log/horizon.log
stopwaitsecs=3600      ; 等待当前 Job 完成再停止，防止数据丢失
stopasgroup=true
killasgroup=true
```

> ⚠️ **不要用 `artisan queue:work` 直接跑生产环境**。Horizon 提供的进程管理、负载均衡、优雅停止和监控面板是裸 Worker 无法替代的。部署时使用 `php artisan horizon:terminate` 触发优雅重启，而不是直接 kill 进程。

---

## 五、死信队列处理策略

当 Job 重试耗尽进入 `failed_jobs` 表后，需要系统化的处理策略，而不是简单地 `artisan queue:retry all`。

### 死信分类原则

不是所有失败都该自动重试。将失败 Job 分为三类：

| 类别 | 特征 | 处理策略 |
|------|------|---------|
| **暂时性故障** | 数据库连接超时、Redis 断连、HTTP 503 | 自动重试（延迟递增） |
| **业务逻辑错误** | 参数校验失败、余额不足、订单状态不一致 | 记录日志 + 通知业务方 |
| **数据损坏** | 序列化失败、Model 已删除、JSON 解析错误 | 人工介入 + 数据修复 |

### 自动处理工作流

```php
// app/Console/Commands/ProcessDeadLetters.php
class ProcessDeadLetters extends Command
{
    protected $signature = 'queue:process-dead-letters {--max=100} {--age=1440}';

    public function handle(): int
    {
        $maxAge = now()->subMinutes($this->option('age'));

        $failed = DB::table('failed_jobs')
            ->where('failed_at', '>=', $maxAge)
            ->limit($this->option('max'))
            ->get();

        $transient = 0;
        $permanent = 0;

        foreach ($failed as $job) {
            $exception = unserialize($job->exception);

            if ($this->isTransient($exception)) {
                $this->call('queue:retry', ['id' => $job->id]);
                $transient++;
            } else {
                $permanent++;
                $this->archivePermanentFailure($job, $exception);
            }
        }

        $this->info("Processed: {$transient} retried, {$permanent} archived.");

        if ($permanent > 0) {
            Notification::route('slack', config('services.slack.webhook'))
                ->notify(new DeadLetterAlertNotification($permanent));
        }

        return self::SUCCESS;
    }

    private function isTransient(\Throwable $e): bool
    {
        return $e instanceof \Illuminate\Database\QueryException
            || $e instanceof \GuzzleHttp\Exception\ConnectException
            || $e instanceof \RedisException;
    }

    private function archivePermanentFailure(object $job, \Throwable $e): void
    {
        DB::table('dead_letter_archive')->insert([
            'job_id'      => $job->id,
            'connection'  => $job->connection,
            'queue'       => $job->queue,
            'payload'     => $job->payload,
            'exception'   => (string) $e,
            'failed_at'   => $job->failed_at,
            'archived_at' => now(),
        ]);
    }
}
```

```bash
# 调度：每 30 分钟自动处理死信
# app/Console/Kernel.php
$schedule->command('queue:process-dead-letters --max=200 --age=60')
    ->everyThirtyMinutes()
    ->withoutOverlapping();
```

### Redis 死信队列实现

如果使用 Redis 驱动，可以用 ZSET 实现时间有序的死信存储：

```php
// app/Listeners/JobFailedListener.php
class JobFailedListener
{
    public function handle(JobFailed $event): void
    {
        $payload = json_decode($event->job->getRawBody(), true);

        Redis::zadd('dead_letter_queue', [
            json_encode([
                'job'       => $payload,
                'exception' => $event->exception->getMessage(),
                'failed_at' => now()->toIso8601String(),
                'queue'     => $event->job->getQueue(),
            ]) => microtime(true), // score = 时间戳
        ]);

        // 保留最近 7 天的死信，自动淘汰旧数据
        Redis::zremrangebyscore('dead_letter_queue', 0, now()->subDays(7)->getTimestamp());
    }
}
```

---

## 六、生产环境踩坑案例

### 踩坑 9：Worker 内存泄漏

**现象**：Horizon 监控显示 Worker 内存持续增长，运行数小时后触发 OOM。

```php
// ❌ 常见的内存泄漏写法
class SyncLargeDataset implements ShouldQueue
{
    public function handle(): void
    {
        // 全量加载 → 内存爆炸
        $products = Product::all(); // 10 万条记录

        foreach ($products as $product) {
            Cache::put("product:{$product->id}", $product, 3600);
        }
    }
}

// ✅ 正确：chunk + 内存回收
class SyncLargeDataset implements ShouldQueue
{
    public function handle(): void
    {
        Product::query()
            ->with('category')
            ->chunkById(500, function (Collection $products) {
                foreach ($products as $product) {
                    Cache::put("product:{$product->id}", $product, 3600);
                }
                unset($products);
                gc_collect_cycles();
            });
    }
}
```

**排查技巧**：在 Job 中插入内存监控：

```php
Log::debug('Memory usage', [
    'job'    => class_basename($this),
    'memory' => round(memory_get_usage(true) / 1024 / 1024, 2) . 'MB',
    'peak'   => round(memory_get_peak_usage(true) / 1024 / 1024, 2) . 'MB',
]);
```

### 踩坑 10：SerializesModels 导致重试时状态不一致

**现象**：Job 重试时使用了旧的 Model 数据，业务逻辑执行错误。

```php
// ❌ 问题：构造函数捕获了 Model 快照，重试时反序列化的是旧对象
class SendOrderNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(public Order $order) {}

    public function handle(): void
    {
        // $this->order->status 可能是过时的
        if ($this->order->status === OrderStatus::PAID) { /* ... */ }
    }
}

// ✅ 正确：只传 ID，在 handle() 中重新查询
class SendOrderNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(public readonly int $orderId) {}

    public function handle(): void
    {
        $order = Order::with('items')->findOrFail($this->orderId);
        if ($order->status !== OrderStatus::PAID) {
            return; // 幂等退出
        }
    }
}
```

### 踩坑 11：不可序列化对象导致 Job 入队失败

**现象**：Job dispatch 成功但 Worker 拉取时报 `unserialize()` 错误。

```php
// ❌ PDO、Closure、resource 都不能序列化
class ProcessReport implements ShouldQueue
{
    public function __construct(
        public PDO $connection,
        public \Closure $callback,
    ) {}
}

// ✅ 构造函数只接受标量、数组、Eloquent Model
class ProcessReport implements ShouldQueue
{
    public function __construct(
        public readonly string $connectionName,
        public readonly string $reportType,
        public readonly array $parameters,
    ) {}

    public function handle(): void
    {
        $connection = DB::connection($this->connectionName);
        // ...
    }
}
```

**排查技巧**：开发环境用 `dispatch_now()` 在同步模式下验证 Job 的序列化/反序列化。

### 踩坑 12：Redis 队列与业务缓存互相阻塞

**现象**：队列消费突然卡住，排查发现是同一 Redis 实例上的大 Key 操作阻塞了队列命令。

```php
// config/queue.php —— 使用独立的 Redis 连接
'redis' => [
    'driver' => 'redis',
    'connection' => 'queue',    // ⚠️ 必须独立连接
    'queue' => 'default',
    'retry_after' => 180,
    'block_for' => 5,
],

// config/database.php
'redis' => [
    'queue' => [
        'host' => env('REDIS_QUEUE_HOST', '127.0.0.1'),
        'port' => 6379,
        'database' => 3, // 与业务缓存（database 0/1/2）隔离
    ],
],
```

> 核心原则：队列和业务缓存必须使用不同的 Redis database（甚至不同的 Redis 实例），避免互相阻塞。

---

## 踩坑总结

| # | 问题 | 根因 | 解决方案 |
|---|------|------|----------|
| 1 | 延迟任务执行不准时 | Worker 负载高时出队延迟 | 产品层面接受 ±5 分钟误差 |
| 2 | Redis 重启任务丢失 | RDB 持久化非实时 | 开启 AOF + `retry_after` |
| 3 | 事务未提交就开始 Job | Job 比事务先执行 | `afterCommit()` 或包在 `DB::transaction()` 内 |
| 4 | Batch 元数据性能瓶颈 | 大 batch 频繁更新计数列 | 混合存储策略，小 batch 才用 DB driver |
| 5 | batch cancelled 检查遗漏 | 只在开头检查一次 | 循环内持续检查 |
| 6 | retryUntil 与 $tries 冲突 | 两个条件同时存在 | 二选一，推荐 retryUntil |
| 7 | 重试时数据过时 | 传原始值而非 Model ID | 在 handle() 内重新查询 |
| 8 | maxExceptions 误解 | 与 $tries 计数逻辑不同 | 明确区分"异常次数"和"尝试次数" |
| 9 | Worker 内存泄漏 | 大数据集全量加载 + 未释放 | `chunkById` + `unset` + `gc_collect_cycles()` |
| 10 | SerializesModels 状态不一致 | 重试时反序列化旧 Model | 传 ID，在 handle() 重新查询 |
| 11 | 序列化不可序列化对象 | PDO/Closure/resource 入构造函数 | 构造函数只接受标量和 Model |
| 12 | Redis 队列阻塞 | 队列与业务共用 Redis 连接 | 独立 Redis database/实例 |

---

## 总结

Laravel Queue 系统的表层 API 很简单，但在生产环境的复杂场景下，延迟精度、事务边界、批量编排、重试策略每一个都是独立的坑。核心原则：

1. **延迟任务要容差**：不要依赖精确到秒的延迟执行
2. **批量任务要分阶段**：用 `Bus::batch` 的 stage 能力实现串并行编排
3. **重试策略要分层**：即时重试 → 指数退避 → 死信告警，针对不同异常类型
4. **永远检查幂等**：Job 可能被重复执行，业务逻辑必须是幂等的

> 下一篇会聊聊 Laravel Pipeline 模式在复杂订单处理流中的应用，同样是深度实战。

## 相关阅读

- [Redis Stream 实战：消息队列替代方案与消费者组管理](/categories/Redis/redis-stream-guide-laravel/) —— 当 Redis Queue 不满足需求时，Redis Stream 提供了更灵活的消费者组模式
- [Laravel Redis 分布式锁失效场景实战](/categories/Redis/laravel-redis-distributedlockguide/) —— 队列幂等性保障离不开分布式锁，了解锁失效场景才能避免重复执行
- [Laravel 数据导入导出实战：Excel/CSV 大文件处理与队列化踩坑记录](/categories/PHP/Laravel/Laravel-数据导入导出实战-Excel-CSV-大文件处理与队列化踩坑记录/) —— 大文件处理必须结合队列化方案，与本文 Bus::batch 场景高度相关
