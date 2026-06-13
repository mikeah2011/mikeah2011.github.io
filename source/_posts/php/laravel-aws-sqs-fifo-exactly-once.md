---

title: Laravel + AWS SQS FIFO 实战：严格顺序消息队列——订单处理的 Exactly-Once 语义与消息分组
keywords: [Laravel, AWS SQS FIFO, Exactly, Once, 严格顺序消息队列, 订单处理的, 语义与消息分组]
date: 2026-06-09 11:00:00
categories:
- php
tags:
- AWS
- SQS
- FIFO
- 消息队列
- 分布式
- 订单系统
description: 深入实战 Laravel 集成 AWS SQS FIFO 队列，详解 MessageGroupId、DeduplicationId 的设计与实现，解决订单处理中的严格顺序与 Exactly-Once 语义问题，包含完整代码示例与生产踩坑记录。
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
---



## 为什么需要 FIFO 队列

在 B2C 电商系统中，订单处理是最典型的需要严格顺序的场景。想象一下：

1. 用户下单 → 2. 扣减库存 → 3. 生成支付单 → 4. 发送确认邮件

如果消息乱序，可能出现"支付单已生成但库存还没扣"的灾难。Standard SQS 提供的是"至少一次"（At-Least-Once）投递，消息可能乱序、重复。FIFO 队列解决了这两个核心问题。

AWS SQS FIFO 相比 Standard SQS 的关键区别：

| 特性 | Standard SQS | FIFO SQS |
|------|-------------|----------|
| 顺序保证 | 无 | 严格 FIFO |
| 投递语义 | At-Least-Once | Exactly-Once（通过去重） |
| 吞吐量 | 无限制 | 3000 msg/s（批量） |
| 延迟 | 低 | 略高（排序开销） |
| 消息分组 | 无 | MessageGroupId 必须 |

## FIFO 的三个核心概念

### Message Group ID：消息分组

FIFO 队列通过 `MessageGroupId` 实现消息分组。**同一 Group 内的消息严格有序，不同 Group 之间完全独立、并行处理。**

这是 FIFO 队列最重要的设计维度。错误的分组策略会导致：

- **分组过粗**（所有订单一个 Group）：吞吐量退化为单线程，3000 msg/s 变成串行
- **分组过细**（每条消息一个 Group）：丧失顺序保证

### Deduplication ID：去重

FIFO 队列在 5 分钟窗口内，相同 `MessageDeduplicationId` 的消息只投递一次。这是实现 Exactly-Once 语义的关键机制。

### Content-Based Deduplication

如果你不想手动管理 DeduplicationId，可以开启内容去重——AWS 对消息体做 SHA-256 哈希，相同内容自动去重。但手动管理更可控。

## Laravel 集成 SQS FIFO

### 1. 安装与配置

```bash
composer require laravel/framework
# SQS 驱动已内置，无需额外包
```

`.env` 配置：

```env
QUEUE_CONNECTION=sqs

AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_DEFAULT_REGION=ap-southeast-1
AWS_QUEUE=order-processing.fifo
AWS_PREFIX=
```

### 2. 队列驱动配置

```php
// config/queue.php
'sqs' => [
    'driver' => 'sqs',
    'key' => env('AWS_ACCESS_KEY_ID'),
    'secret' => env('AWS_SECRET_ACCESS_KEY'),
    'prefix' => env('AWS_QUEUE_PREFIX', ''),
    'queue' => env('AWS_QUEUE', 'default'),
    'region' => env('AWS_DEFAULT_REGION', 'ap-southeast-1'),
    'after_commit' => true,  // 重要：事务提交后才入队
],
```

`after_commit => true` 是关键——防止数据库事务回滚但消息已发出的情况。

### 3. 创建 FIFO 队列

```bash
# 通过 Artisan 创建（需要先在 AWS 控制台或 CLI 创建 SQS FIFO 队列）
# Laravel 的 queue:create 不支持 FIFO 参数，建议用 AWS CLI

aws sqs create-queue \
  --queue-name order-processing.fifo \
  --attributes '{
    "FifoQueue": "true",
    "ContentBasedDeduplication": "false",
    "DeduplicationScope": "messageGroup",
    "FifoThroughputLimitPerGroup": "messageGroup"
  }'
```

> `DeduplicationScope: messageGroup` 和 `FifoThroughputLimitPerGroup: messageGroup` 是 FIFO 的高吞吐模式，允许不同 Group 并行，吞吐量从 300 msg/s 提升到 3000 msg/s。

## 实战：订单处理流水线

### 消息设计

```php
<?php

namespace App\Jobs\Orders;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class OrderCreatedJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public int $orderId,
        public string $orderNo,
    ) {
        // 关键：FIFO 配置
        $this->queue = 'order-processing.fifo';
        $this->onQueue('order-processing.fifo');
    }

    public function handle(): void
    {
        // 1. 扣减库存
        $this->reserveStock();

        // 2. 派发下一步：生成支付单
        GeneratePaymentJob::dispatch(
            orderId: $this->orderId,
            orderNo: $this->orderNo,
        )->onQueue('order-processing.fifo');
    }

    private function reserveStock(): void
    {
        // 扣减逻辑...
    }
}
```

### 消息分组策略

这是整个设计中最关键的部分。订单处理的分组策略：

```php
<?php

namespace App\Services;

class OrderMessageGroupId
{
    /**
     * 订单处理场景：按订单 ID 分组
     * 同一订单的所有步骤严格顺序执行
     * 不同订单完全并行
     */
    public static function forOrder(int $orderId): string
    {
        return (string) $orderId;
    }

    /**
     * 库存扣减场景：按 SKU 分组
     * 同一 SKU 的扣减操作严格顺序
     * 不同 SKU 并行
     */
    public static function forSku(string $sku): string
    {
        return $sku;
    }
}
```

### 手动设置 MessageGroupId

Laravel 默认不直接暴露 SQS FIFO 的 `MessageGroupId` 参数。需要通过自定义 Job 或扩展 Queue 来实现：

```php
<?php

namespace App\Jobs\Orders;

use Aws\Sqs\SqsClient;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

class PaymentCreatedJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 3;

    public function __construct(
        public int $orderId,
        public int $paymentId,
    ) {
        $this->queue = 'order-processing.fifo';
    }

    public function handle(): void
    {
        // 处理支付回调...
    }

    /**
     * 通过 rawBody 手动设置 MessageGroupId 和 MessageDeduplicationId
     */
    public function rawBody($job, $data): string
    {
        $body = json_decode($data, true);

        return json_encode(array_merge($body, [
            'MessageGroupId' => OrderMessageGroupId::forOrder($this->orderId),
            'MessageDeduplicationId' => "payment_{$this->paymentId}",
        ]));
    }
}
```

更实用的方式是直接在 dispatch 时通过 SQS client 发送：

```php
<?php

namespace App\Services;

use Aws\Sqs\SqsClient;

class SqsFifoService
{
    public function __construct(
        private SqsClient $sqs,
    ) {}

    /**
     * 发送 FIFO 消息并指定分组和去重 ID
     */
    public function send(
        string $queueUrl,
        string $messageBody,
        string $groupId,
        string $deduplicationId,
    ): void {
        $this->sqs->sendMessage([
            'QueueUrl' => $queueUrl,
            'MessageBody' => $messageBody,
            'MessageGroupId' => $groupId,
            'MessageDeduplicationId' => $deduplicationId,
            'MessageAttributes' => [
                'DataType' => ['StringValue' => 'String', 'BinaryValue' => null],
                'StringValueType' => ['StringValue' => 'application/json'],
            ],
        ]);
    }
}
```

### 完整的订单处理流水线

```php
<?php

namespace App\Jobs\Orders;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

class OrderProcessingPipeline implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(
        public int $orderId,
    ) {
        $this->queue = 'order-processing.fifo';
    }

    public function handle(): void
    {
        $order = \App\Models\Order::findOrFail($this->orderId);

        Log::info("Processing order {$order->order_no}", [
            'step' => 'start',
            'status' => $order->status,
        ]);

        $pipeline = new \App\Pipelines\OrderPipeline([
            \App\Pipelines\Steps\ReserveStock::class,
            \App\Pipelines\Steps\CreatePayment::class,
            \App\Pipelines\Steps\ReservePayment::class,
            \App\Pipelines\Steps\SendConfirmation::class,
        ]);

        $pipeline->process($order, function ($order) {
            $order->update(['status' => 'processing']);
        });
    }
}
```

### Pipeline 步骤示例

```php
<?php

namespace App\Pipelines\Steps;

use App\Models\Order;
use Closure;

class ReserveStock
{
    public function handle(Order $order, Closure $next): Order
    {
        $stockService = app(\App\Services\StockService::class);

        // 同步扣减（在同一 FIFO Group 内，保证顺序）
        foreach ($order->items as $item) {
            $stockService->reserve(
                sku: $item->sku,
                quantity: $item->quantity,
                orderId: $order->id,
            );
        }

        $order->update(['status' => 'stock_reserved']);

        return $next($order);
    }
}
```

## 去重策略：Exactly-Once 的关键

### 为什么需要去重

SQS 的 At-Least-Once 保证意味着消息可能被投递多次。FIFO 队列通过 `MessageDeduplicationId` 实现去重。

### 去重 ID 的设计原则

```php
<?php

namespace App\Services;

class DeduplicationKey
{
    /**
     * 订单支付：唯一支付操作
     */
    public static function forPayment(int $paymentId): string
    {
        return "payment_{$paymentId}";
    }

    /**
     * 库存扣减：订单+SKU 组合
     */
    public static function forStockReservation(int $orderId, string $sku): string
    {
        return "stock_{$orderId}_{$sku}";
    }

    /**
     * 邮件发送：唯一事件 ID
     */
    public static function forEmail(int $emailId): string
    {
        return "email_{$emailId}";
    }
}
```

### 通过 Eloquent 事件自动触发

```php
<?php

namespace App\Observers;

use App\Models\Order;
use App\Jobs\Orders\OrderCreatedJob;

class OrderObserver
{
    public function created(Order $order): void
    {
        OrderCreatedJob::dispatch(
            orderId: $order->id,
            orderNo: $order->order_no,
        )
        ->onQueue('order-processing.fifo');
    }
}
```

配合 `after_commit`，确保数据库事务成功后才入队。

## 多队列策略：拆分读写路径

订单系统中，不同操作的顺序要求不同。可以拆分为多个 FIFO 队列：

```
订单核心流水线（严格顺序）：
  order-processing.fifo → [创建支付] → [扣减库存] → [生成支付单]

库存管理（按 SKU 顺序）：
  stock-management.fifo → [SKU-A 操作1] → [SKU-A 操作2]

通知（无严格顺序要求）：
  order-notifications.fifo → [邮件] → [短信] → [Push]
```

```php
<?php

namespace App\Services;

class QueueRouter
{
    /**
     * 根据操作类型路由到合适的 FIFO 队列
     */
    public static function forJob(string $jobClass): string
    {
        return match ($jobClass) {
            \App\Jobs\Orders\PaymentCreatedJob::class,
            \App\Jobs\Orders\StockReservedJob::class,
            \App\Jobs\Orders\OrderConfirmedJob::class,
                => 'order-processing.fifo',

            \App\Jobs\Inventory\StockAdjustJob::class,
                => 'stock-management.fifo',

            \App\Jobs\Notifications\*::class,
                => 'order-notifications.fifo',

            default => 'order-processing.fifo',
        };
    }
}
```

## 死信队列（DLQ）处理

FIFO 队列的 DLQ 也是 FIFO，失败消息的顺序也被保留：

```bash
aws sqs create-queue \
  --queue-name order-processing-dlq.fifo \
  --attributes '{
    "FifoQueue": "true",
    "ContentBasedDeduplication": "false"
  }'

# 设置红队策略
aws sqs set-queue-attributes \
  --queue-url https://sqs.ap-southeast-1.amazonaws.com/xxx/order-processing.fifo \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:ap-southeast-1:xxx:order-processing-dlq.fifo\",\"maxReceiveCount\":\"3\"}"
  }'
```

### DLQ 消费与重试

```php
<?php

namespace App\Jobs\Orders;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

class DlqReplayJob implements ShouldQueue
{
    use InteractsWithQueue, Queueable;

    public int $tries = 1;

    public function __construct(
        public string $originalQueue,
        public string $messageBody,
    ) {}

    public function handle(): void
    {
        $message = json_decode($this->messageBody, true);

        Log::warning('Replaying DLQ message', [
            'queue' => $this->originalQueue,
            'body' => $message,
        ]);

        // 重新发送到原队列
        $sqs = app(\Aws\Sqs\SqsClient::class);
        $queueUrl = config("services.sqs.queues.{$this->originalQueue}");

        $sqs->sendMessage([
            'QueueUrl' => $queueUrl,
            'MessageBody' => $this->messageBody,
            'MessageGroupId' => $message['MessageGroupId'] ?? 'default',
            'MessageDeduplicationId' => uniqid('replay_', true),
        ]);
    }
}
```

## 监控与告警

### CloudWatch 告警配置

```bash
# FIFO 队列深度告警
aws cloudwatch put-metric-alarm \
  --alarm-name "SQS-FIFO-Depth-High" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=QueueName,Value=order-processing.fifo

# Age of Oldest Message（消息积压）
aws cloudwatch put-metric-alarm \
  --alarm-name "SQS-FIFO-Age-High" \
  --metric-name ApproximateAgeOfOldestMessage \
  --namespace AWS/SQS \
  --statistic Maximum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 300 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=QueueName,Value=order-processing.fifo
```

### Laravel 队列监控

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class QueueMonitor
{
    public static function checkFifoHealth(): array
    {
        $sqs = app(\Aws\Sqs\SqsClient::class);
        $queueUrl = config('services.sqs.queues.order-processing.fifo');

        $result = $sqs->getQueueAttributes([
            'QueueUrl' => $queueUrl,
            'AttributeNames' => [
                'ApproximateNumberOfMessages',
                'ApproximateNumberOfMessagesNotVisible',
                'ApproximateAgeOfOldestMessage',
            ],
        ]);

        $attrs = $result->get('Attributes');

        $health = [
            'visible' => (int) ($attrs['ApproximateNumberOfMessages'] ?? 0),
            'in_flight' => (int) ($attrs['ApproximateNumberOfMessagesNotVisible'] ?? 0),
            'oldest_age' => (int) ($attrs['ApproximateAgeOfOldestMessage'] ?? 0),
        ];

        $health['status'] = match (true) {
            $health['oldest_age'] > 600 => 'critical',
            $health['oldest_age'] > 300 => 'warning',
            default => 'healthy',
        };

        return $health;
    }
}
```

## 踩坑记录

### 踩坑 1：MessageGroupId 为空导致 400 错误

**症状**：消息发送报 `Invalid request: Missing required key in request body: MessageGroupId`。

**原因**：Laravel 的 SQS 驱动默认不会自动填充 `MessageGroupId`，必须手动设置。

**解决**：在 Job 的 `rawBody` 方法中设置，或通过 SQS Client 直接发送。

### 踩坑 2：分组导致吞吐量骤降

**症状**：从 Standard 迁移到 FIFO 后，处理速度从 3000 msg/s 降到 300 msg/s。

**原因**：使用了 `FifoQueue: true` 但没开启高吞吐模式，默认每个队列只支持 300 msg/s。

**解决**：设置 `DeduplicationScope: messageGroup` 和 `FifoThroughputLimitPerGroup: messageGroup`，不同 Group 可以并行。

### 踩坑 3：5 分钟去重窗口过长

**症状**：重试逻辑中，相同 `MessageDeduplicationId` 的消息在 5 分钟内被静默丢弃。

**原因**：SQS FIFO 的去重窗口固定 5 分钟，无法配置。

**解决**：在 DeduplicationId 中加入时间戳或唯一标识（如 UUID），确保每次重试生成不同的 ID。

```php
// ❌ 错误：重试时 ID 不变
$dedupId = "payment_{$paymentId}";

// ✅ 正确：加入时间戳保证唯一性
$dedupId = "payment_{$paymentId}_" . now()->timestamp;
```

### 踩坑 4：after_commit 与 FIFO 的微妙交互

**症状**：事务回滚了但消息已发出。

**原因**：默认 `after_commit = false`，消息在事务提交前就发送。

**解决**：必须设置 `after_commit => true`。但注意——如果事务中 dispatch 了多个 Job，只有最后一个会收到事务提交后的回调。建议用 `Bus::batch()` 管理。

### 踩坑 5：DLQ 消费顺序混乱

**症状**：DLQ 中的消息处理顺序与原队列不一致。

**原因**：DLQ 的消费方式不对，用了并行消费。

**解决**：DLQ 消费必须使用 FIFO 队列 + 单一消费者（或同一 GroupId 保证顺序）。

## 性能调优

### 批量发送

```php
// SQS FIFO 支持批量发送（最多 10 条），同一 batch 内的消息必须同一 GroupId
$sqs->sendMessageBatch([
    'QueueUrl' => $queueUrl,
    'Entries' => collect($orders)->map(fn($order) => [
        'Id' => (string) $order->id,
        'MessageBody' => json_encode(['order_id' => $order->id]),
        'MessageGroupId' => (string) $order->id,
        'MessageDeduplicationId' => "order_{$order->id}_" . now()->timestamp,
    ])->toArray(),
]);
```

### 预留并发

如果同一 Group 内的操作可以部分并行（如不同 SKU 的库存扣减），可以拆分为多个 Group：

```php
// 订单拆单：每个子单一个 Group，同一子单内严格顺序
foreach ($order->subOrders as $subOrder) {
    $job = new ProcessSubOrderJob($subOrder->id);
    // 使用子单 ID 作为 GroupId，实现子单间并行、子单内串行
}
```

## 总结

| 决策点 | 推荐方案 |
|--------|---------|
| 分组粒度 | 订单维度（同一订单严格顺序，不同订单并行） |
| 去重策略 | 手动管理 DeduplicationId，避免 5 分钟窗口陷阱 |
| 队列拆分 | 核心流水线 / 库存管理 / 通知 分开队列 |
| 事务安全 | `after_commit => true`，配合 `Bus::batch()` |
| DLQ 策略 | DLQ 也用 FIFO，单消费者保证处理顺序 |
| 吞吐优化 | 开启 `messageGroup` 级别的高吞吐模式 |

FIFO 队列不是银弹，但在订单处理、支付回调、库存同步这类场景中，它是目前 AWS SQS 提供的最可靠的顺序保证方案。设计好 MessageGroupId 的粒度，是整个方案的核心。

---

> 参考：[AWS SQS FIFO 文档](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queue-how-does-it-work.html) · [Laravel Queue 文档](https://laravel.com/docs/11.x/queues) · KKday B2C API 订单处理实战
