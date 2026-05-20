---
title: Laravel Jobs & Queues 深度实战：延迟队列、批量任务与失败重试策略踩坑记录
date: 2026-05-16 17:51:16
updated: 2026-05-16 17:55:11
categories:
  - PHP
  - Laravel
tags: [Laravel, Redis, 消息队列]
description: 深入 Laravel Jobs & Queues 的三个高阶场景：延迟队列实现订单超时取消、Bus::batch 批量任务编排、以及生产级失败重试策略。来自 KKday B2C API 的真实踩坑记录。
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

## 四、Horizon 配置最佳实践

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

---

## 总结

Laravel Queue 系统的表层 API 很简单，但在生产环境的复杂场景下，延迟精度、事务边界、批量编排、重试策略每一个都是独立的坑。核心原则：

1. **延迟任务要容差**：不要依赖精确到秒的延迟执行
2. **批量任务要分阶段**：用 `Bus::batch` 的 stage 能力实现串并行编排
3. **重试策略要分层**：即时重试 → 指数退避 → 死信告警，针对不同异常类型
4. **永远检查幂等**：Job 可能被重复执行，业务逻辑必须是幂等的

> 下一篇会聊聊 Laravel Pipeline 模式在复杂订单处理流中的应用，同样是深度实战。
