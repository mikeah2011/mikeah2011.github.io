---
title: Laravel EventSauce 事件溯源实战：订单状态机、快照重建与读模型投影踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 00:15:06
updated: 2026-05-05 00:17:52
categories:
  - php
tags: [Laravel, 架构]
keywords: [Laravel EventSauce, 事件溯源实战, 订单状态机, 快照重建与读模型投影踩坑记录, PHP]
description: 深入实战指南：如何在 Laravel 中使用 EventSauce 实现事件溯源（Event Sourcing）与 DDD 领域驱动设计。本文以 B2C 退单流程为案例，详细讲解聚合根建模、事件持久化适配器、快照机制优化、CQRS 读模型投影、乐观锁并发冲突处理及生产环境踩坑记录，助你掌握 Laravel 事件溯源的完整落地方案。



---

DDD 那篇讲了聚合边界和领域事件，但只保留了"最终一致性通知"这一个维度。真正让事件溯源有价值的，是另一件事——**把每一次状态变更记录为不可变事件，让聚合根可以从事件流中完整重建**。好处不只是审计，而是你在任何时候都能回答"这个订单为什么变成了退款中"。

我用 EventSauce 在一个 B2C 退单流程里做了完整落地。下面记录的是真实遇到的问题，不是教程式的"先装包再复制"。

## 一、为什么选 EventSauce

Laravel 生态里做事件溯源有三条路：

| 方案 | 优点 | 缺点 |
|---|---|---|
| 自建 event_logs 表 | 完全可控 | 需要自己处理快照、并发、投影 |
| `spatie/laravel-event-sourcing` | Laravel 原生集成 | 底层封装厚，调试困难 |
| `eventsauce/event-sauce` | 框架无关、设计纯净 | 需要自己写 Laravel adapter |

我选了 EventSauce，因为它**没有隐藏任何魔法**。AggregateRoot 就是一个纯 PHP 类，事件就是普通 PHP 对象，持久化完全由你控制。在 Laravel 项目里集成成本不高，但调试成本低得多。

```bash
composer require eventsauce/event-sauce
composer require eventsauce/clock
```

## 二、聚合根建模

以退单流程为例。一个退款单（RefundOrder）有明确的生命周期：创建 → 审核 → 退款中 → 成功/失败。每次状态变更都是一个事件。

```php
<?php
// app/Domain/Refund/RefundOrderAggregate.php

declare(strict_types=1);

namespace App\Domain\Refund;

use EventSauce\EventSourcing\AggregateRoot;
use EventSauce\EventSourcing\AggregateRootBehaviour;

final class RefundOrderAggregate extends AggregateRoot
{
    use AggregateRootBehaviour;

    private RefundStatus $status = RefundStatus::Pending;
    private int $amountCents;
    private string $reason;
    private ?string $rejectionReason = null;
    private int $retryCount = 0;

    // ---- 命令方法（业务入口）----

    public static function request(
        string $orderId,
        int $amountCents,
        string $reason,
    ): self {
        $instance = self::retrieve($orderId);
        $instance->recordThat(new RefundRequested(
            orderId: $orderId,
            amountCents: $amountCents,
            reason: $reason,
            requestedAt: now(),
        ));
        return $instance;
    }

    public function approve(string $reviewer): void
    {
        if ($this->status !== RefundStatus::Pending) {
            throw new InvalidStateTransition(
                "Cannot approve refund in {$this->status->value} state"
            );
        }
        $this->recordThat(new RefundApproved(
            orderId: $this->aggregateRootId()->toString(),
            reviewer: $reviewer,
            approvedAt: now(),
        ));
    }

    public function reject(string $reviewer, string $reason): void
    {
        if ($this->status !== RefundStatus::Pending) {
            throw new InvalidStateTransition(
                "Cannot reject refund in {$this->status->value} state"
            );
        }
        $this->recordThat(new RefundRejected(
            orderId: $this->aggregateRootId()->toString(),
            reviewer: $reviewer,
            reason: $reason,
            rejectedAt: now(),
        ));
    }

    public function processPayment(string $paymentGatewayRef): void
    {
        if ($this->status !== RefundStatus::Approved) {
            throw new InvalidStateTransition(
                "Cannot process payment in {$this->status->value} state"
            );
        }
        $this->recordThat(new RefundPaymentProcessing(
            orderId: $this->aggregateRootId()->toString(),
            paymentGatewayRef: $paymentGatewayRef,
            startedAt: now(),
        ));
    }

    public function confirmSuccess(string $transactionId): void
    {
        $this->recordThat(new RefundSucceeded(
            orderId: $this->aggregateRootId()->toString(),
            transactionId: $transactionId,
            completedAt: now(),
        ));
    }

    public function markFailed(string $errorCode, string $errorMessage): void
    {
        $this->recordThat(new RefundFailed(
            orderId: $this->aggregateRootId()->toString(),
            errorCode: $errorCode,
            errorMessage: $errorMessage,
            failedAt: now(),
        ));
    }

    // ---- 事件应用方法（重建状态）----

    protected function applyRefundRequested(RefundRequested $event): void
    {
        $this->status = RefundStatus::Pending;
        $this->amountCents = $event->amountCents;
        $this->reason = $event->reason;
    }

    protected function applyRefundApproved(RefundApproved $event): void
    {
        $this->status = RefundStatus::Approved;
    }

    protected function applyRefundRejected(RefundRejected $event): void
    {
        $this->status = RefundStatus::Rejected;
        $this->rejectionReason = $event->reason;
    }

    protected function applyRefundPaymentProcessing(RefundPaymentProcessing $event): void
    {
        $this->status = RefundStatus::Processing;
    }

    protected function applyRefundSucceeded(RefundSucceeded $event): void
    {
        $this->status = RefundStatus::Succeeded;
    }

    protected function applyRefundFailed(RefundFailed $event): void
    {
        $this->status = RefundStatus::Failed;
        $this->retryCount++;
    }

    // ---- 查询方法 ----

    public function isRetryable(): bool
    {
        return $this->status === RefundStatus::Failed && $this->retryCount < 3;
    }

    public function getStatus(): RefundStatus
    {
        return $this->status;
    }
}
```

**关键设计**：`apply*` 方法是纯函数，只修改内部状态，不调外部服务。命令方法（approve、reject）负责业务校验并 `recordThat`。EventSauce 会在 `recordThat` 时自动调用对应的 apply 方法。

## 三、事件持久化——Laravel 适配器

EventSauce 的 Repository 需要一个 MessageRepository 实现。最简单的方案是用一张 `event_messages` 表：

```php
<?php
// database/migrations/xxxx_create_event_messages_table.php

Schema::create('event_messages', function (Blueprint $table) {
    $table->uuid('message_id')->primary();
    $table->string('aggregate_root_id', 255)->index();
    $table->integer('version')->unsigned();
    $table->string('event_class', 255);
    $table->json('payload');
    $table->timestamp('recorded_at');
    $table->string('correlation_id')->nullable();
    $table->string('causation_id')->nullable();

    $table->unique(['aggregate_root_id', 'version']);
    $table->index(['aggregate_root_id', 'version'], 'idx_aggregate_version');
});
```

实现 MessageRepository：

```php
<?php
// app/Infrastructure/EventSourcing/EloquentMessageRepository.php

declare(strict_types=1);

namespace App\Infrastructure\EventSourcing;

use EventSauce\EventSourcing\AggregateRootId;
use EventSauce\EventSourcing\Message;
use EventSauce\EventSourcing\MessageRepository;
use EventSauce\EventSourcing\Serialization\MessageSerializer;
use Illuminate\Support\Facades\DB;

final class EloquentMessageRepository implements MessageRepository
{
    public function __construct(
        private readonly MessageSerializer $serializer,
    ) {}

    public function persist(Message ...$messages): void
    {
        $rows = [];
        foreach ($messages as $message) {
            $serialized = $this->serializer->serializeMessage($message);
            $rows[] = [
                'message_id'         => $serialized['headers']['event_id'],
                'aggregate_root_id'  => $serialized['headers']['aggregate_root_id'],
                'version'            => $serialized['headers']['aggregate_version'],
                'event_class'        => $serialized['headers']['event_type'],
                'payload'            => json_encode($serialized['event']),
                'recorded_at'        => now()->toDateTimeString(),
                'correlation_id'     => $serialized['headers']['correlation_id'] ?? null,
                'causation_id'       => $serialized['headers']['causation_id'] ?? null,
            ];
        }

        // 批量插入 + 忽略重复（幂等写入）
        DB::table('event_messages')->insertOrIgnore($rows);
    }

    public function retrieveAll(AggregateRootId $id): iterable
    {
        $rows = DB::table('event_messages')
            ->where('aggregate_root_id', $id->toString())
            ->orderBy('version')
            ->get();

        foreach ($rows as $row) {
            $payload = json_decode($row->payload, true);
            yield $this->serializer->unserializePayload([
                'event'   => $payload,
                'headers' => [
                    'event_id'           => $row->message_id,
                    'aggregate_root_id'  => $row->aggregate_root_id,
                    'aggregate_version'  => (int) $row->version,
                    'event_type'         => $row->event_class,
                    'recorded_at'        => $row->recorded_at,
                    'correlation_id'     => $row->correlation_id,
                    'causation_id'       => $row->causation_id,
                ],
            ]);
        }
    }

    public function retrieveAllAfterVersion(
        AggregateRootId $id,
        int $version
    ): iterable {
        $rows = DB::table('event_messages')
            ->where('aggregate_root_id', $id->toString())
            ->where('version', '>', $version)
            ->orderBy('version')
            ->get();

        foreach ($rows as $row) {
            $payload = json_decode($row->payload, true);
            yield $this->serializer->unserializePayload([
                'event'   => $payload,
                'headers' => [
                    'event_id'           => $row->message_id,
                    'aggregate_root_id'  => $row->aggregate_root_id,
                    'aggregate_version'  => (int) $row->version,
                    'event_type'         => $row->event_class,
                    'recorded_at'        => $row->recorded_at,
                    'correlation_id'     => $row->correlation_id,
                    'causation_id'       => $row->causation_id,
                ],
            ]);
        }
    }
}
```

## 四、快照机制——解决长生命周期聚合的性能问题

当一个订单经历了 50+ 次事件变更（重试、部分退款、多次审核），每次重建都要加载全部事件。快照机制在版本 N 处打一个"检查点"，下次只加载 N 之后的增量事件。

```php
<?php
// app/Infrastructure/EventSourcing/SnapshottingMessageRepository.php

declare(strict_types=1);

namespace App\Infrastructure\EventSourcing;

use EventSauce\EventSourcing\AggregateRoot;
use EventSauce\EventSourcing\AggregateRootId;
use EventSauce\EventSourcing\Message;
use EventSauce\EventSourcing\MessageRepository;
use EventSauce\EventSourcing\Snapshotting\Snapshot;
use EventSauce\EventSourcing\Snapshotting\SnapshotRepository;
use Illuminate\Support\Facades\DB;

final class SnapshottingMessageRepository implements MessageRepository
{
    private const SNAPSHOT_THRESHOLD = 20;

    public function __construct(
        private readonly MessageRepository $inner,
        private readonly SnapshotRepository $snapshotRepository,
    ) {}

    public function persist(Message ...$messages): void
    {
        $this->inner->persist(...$messages);

        // 每 N 个事件自动拍快照
        $lastMessage = end($messages);
        if ($lastMessage) {
            $version = $lastMessage->header('aggregate_version');
            if ($version > 0 && $version % self::SNAPSHOT_THRESHOLD === 0) {
                $this->takeSnapshot($lastMessage);
            }
        }
    }

    public function retrieveAll(AggregateRootId $id): iterable
    {
        return $this->inner->retrieveAll($id);
    }

    public function retrieveAllAfterVersion(
        AggregateRootId $id,
        int $version
    ): iterable {
        return $this->inner->retrieveAllAfterVersion($id, $version);
    }

    private function takeSnapshot(Message $message): void
    {
        // 从消息中提取聚合根，序列化为快照
        $aggregateRoot = $message->aggregateRoot();
        $this->snapshotRepository->persist(new Snapshot(
            aggregateRootId: $message->aggregateRootId(),
            aggregateRootVersion: $message->header('aggregate_version'),
            aggregateRoot: $aggregateRoot,
        ));
    }
}
```

快照表：

```sql
CREATE TABLE event_snapshots (
    aggregate_root_id VARCHAR(255) PRIMARY KEY,
    version           INT UNSIGNED NOT NULL,
    state             JSON NOT NULL,
    snapshot_class    VARCHAR(255) NOT NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**踩坑：快照序列化的版本兼容性**

快照存的是聚合根的序列化状态。一旦聚合根新增字段（比如加了 `$refundChannel`），旧快照反序列化时会丢失这个字段。

解法：给聚合根加 `__unserialize` 钩子，处理向后兼容：

```php
protected function applyRefundRequested(RefundRequested $event): void
{
    $this->status = RefundStatus::Pending;
    $this->amountCents = $event->amountCents;
    $this->reason = $event->reason;
}

// 快照反序列化时的兜底
public function __unserialize(array $data): void
{
    foreach ($data as $key => $value) {
        if (property_exists($this, $key)) {
            $this->$key = $value;
        }
    }
    // 新字段兜底默认值
    $this->refundChannel ??= RefundChannel::Online;
}
```

## 五、读模型投影——CQRS 的另一半

事件溯源天然适合 CQRS：写模型是事件流，读模型是投影出来的查询表。

```php
<?php
// app/Infrastructure/Projection/RefundOrderReadModel.php

declare(strict_types=1);

namespace App\Infrastructure\Projection;

use App\Domain\Refund\RefundApproved;
use App\Domain\Refund\RefundFailed;
use App\Domain\Refund\RefundPaymentProcessing;
use App\Domain\Refund\RefundRejected;
use App\Domain\Refund\RefundRequested;
use App\Domain\Refund\RefundSucceeded;
use Illuminate\Support\Facades\DB;

final class RefundOrderReadModel
{
    public function onRefundRequested(RefundRequested $event): void
    {
        DB::table('refund_orders_read')->insert([
            'order_id'     => $event->orderId,
            'amount_cents' => $event->amountCents,
            'reason'       => $event->reason,
            'status'       => 'pending',
            'created_at'   => $event->requestedAt->toDateTimeString(),
            'updated_at'   => $event->requestedAt->toDateTimeString(),
        ]);
    }

    public function onRefundApproved(RefundApproved $event): void
    {
        DB::table('refund_orders_read')
            ->where('order_id', $event->orderId)
            ->update([
                'status'     => 'approved',
                'reviewer'   => $event->reviewer,
                'updated_at' => $event->approvedAt->toDateTimeString(),
            ]);
    }

    public function onRefundRejected(RefundRejected $event): void
    {
        DB::table('refund_orders_read')
            ->where('order_id', $event->orderId)
            ->update([
                'status'           => 'rejected',
                'rejection_reason' => $event->reason,
                'updated_at'       => $event->rejectedAt->toDateTimeString(),
            ]);
    }

    public function onRefundSucceeded(RefundSucceeded $event): void
    {
        DB::table('refund_orders_read')
            ->where('order_id', $event->orderId)
            ->update([
                'status'         => 'succeeded',
                'transaction_id' => $event->transactionId,
                'updated_at'     => $event->completedAt->toDateTimeString(),
            ]);
    }

    public function onRefundFailed(RefundFailed $event): void
    {
        DB::table('refund_orders_read')
            ->where('order_id', $event->orderId)
            ->update([
                'status'       => 'failed',
                'error_code'   => $event->errorCode,
                'error_message'=> $event->errorMessage,
                'updated_at'   => $event->failedAt->toDateTimeString(),
            ]);
    }
}
```

投影注册到 EventSauce 的 Consumer：

```php
<?php
// app/Providers/EventSourcingServiceProvider.php

namespace App\Providers;

use App\Domain\Refund\RefundApproved;
use App\Domain\Refund\RefundFailed;
use App\Domain\Refund\RefundPaymentProcessing;
use App\Domain\Refund\RefundRequested;
use App\Domain\Refund\RefundSucceeded;
use App\Infrastructure\Projection\RefundOrderReadModel;
use EventSauce\EventSourcing\Consumer;
use EventSauce\EventSourcing\Message;
use Illuminate\Support\ServiceProvider;

class EventSourcingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(Consumer::class, function () {
            $readModel = app(RefundOrderReadModel::class);
            return new class ($readModel) implements Consumer {
                public function __construct(
                    private readonly RefundOrderReadModel $model
                ) {}

                public function handle(Message $message): void
                {
                    $event = $message->event();
                    match (true) {
                        $event instanceof RefundRequested
                            => $this->model->onRefundRequested($event),
                        $event instanceof RefundApproved
                            => $this->model->onRefundApproved($event),
                        $event instanceof RefundFailed
                            => $this->model->onRefundFailed($event),
                        $event instanceof RefundSucceeded
                            => $this->model->onRefundSucceeded($event),
                        default => null,
                    };
                }
            };
        });
    }
}
```

**踩坑：投影失败导致读模型不一致**

投影和写模型之间没有事务绑定。如果 `refund_orders_read` 插入失败（比如字段超长），事件已经写入 event_messages，但读模型没有更新。

解法：投影失败时记录到 `failed_projections` 表，用定时任务重试：

```sql
CREATE TABLE failed_projections (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(36) NOT NULL,
    event_class VARCHAR(255) NOT NULL,
    error_message TEXT,
    payload JSON,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_unretried (retry_count, created_at)
);
```

## 六、并发冲突处理——乐观锁

当两个请求同时修改同一个退款单（比如审核和用户撤回同时发起），事件溯源天然提供版本冲突检测：

```php
<?php
// app/Infrastructure/EventSourcing/OptimisticLockingRepository.php

declare(strict_types=1);

namespace App\Infrastructure\EventSourcing;

use EventSauce\EventSourcing\AggregateRoot;
use EventSauce\EventSourcing\AggregateRootId;
use EventSauce\EventSourcing\AggregateRootRepository;
use EventSauce\EventSourcing\Message;
use Illuminate\Support\Facades\DB;

final class OptimisticLockingRepository implements AggregateRootRepository
{
    public function __construct(
        private readonly AggregateRootRepository $inner,
    ) {}

    public function retrieve(AggregateRootId $id): AggregateRoot
    {
        return $this->inner->retrieve($id);
    }

    public function persist(AggregateRoot $aggregateRoot): void
    {
        // EventSauce 在 persist 时会检查版本号
        // 如果数据库中已有更高版本的事件，INSERT 会因唯一键冲突失败
        try {
            $this->inner->persist($aggregateRoot);
        } catch (\Exception $e) {
            if (str_contains($e->getMessage(), 'Duplicate entry')) {
                throw new ConcurrencyException(
                    "Aggregate {$aggregateRoot->aggregateRootId()} "
                    . "was modified concurrently. Please retry."
                );
            }
            throw $e;
        }
    }
}
```

## 七、架构总览

```text
                         ┌──────────────────────────────────────────────────────┐
                         │                 Laravel Application                 │
                         │                                                      │
  HTTP Request ─────►    │  Controller ──► AggregateRootRepository              │
                         │                    │                                 │
                         │                    ▼                                 │
                         │            RefundOrderAggregate                      │
                         │            (命令校验 + recordThat)                    │
                         │                    │                                 │
                         │                    ▼                                 │
                         │         EloquentMessageRepository                    │
                         │            (event_messages 表)                       │
                         │                    │                                 │
                         │              ┌─────┴──────┐                          │
                         │              ▼            ▼                          │
                         │         Snapshot      Consumer                       │
                         │         Repository    (投影到读模型)                   │
                         │              │            │                          │
                         │              ▼            ▼                          │
                         │     event_snapshots  refund_orders_read              │
                         │     (快照表)         (读模型表,查询用)                 │
                         └──────────────────────────────────────────────────────┘
```

## 八、生产踩坑总结

### 1. 事件膨胀

退单流程平均每个聚合 15-20 个事件，但遇到重试风暴时能到 100+。没有快照的话，重建一次要 200ms+。**快照阈值设为 20，超过就拍快照**，重建时间降回 5ms 以内。

### 2. 投影延迟

同步投影在高并发下成为瓶颈。解法：投影改为异步队列消费，读模型有几秒延迟。前端轮询或 WebSocket 通知最终一致性。

### 3. 事件 Schema 演化

给事件加字段时，旧事件反序列化会报错。**每个事件类加一个 `#[Version('2')]` 标注，注册 Upcaster 做字段补全**：

```php
final class RefundRequestedUpcaster implements EventUpcaster
{
    public function upcast(array $eventData, string $version): array
    {
        if ($version === '1') {
            // v1 没有 refund_channel 字段，补默认值
            $eventData['refund_channel'] = 'online';
        }
        return $eventData;
    }
}
```

### 4. 删除不是删除

事件不可变，"删除"一个退款单只能发 `RefundCancelled` 事件。读模型投影时标记为 deleted，但事件流永存。**这是特性不是 bug**——审计和合规需要它。

### 5. 测试便利性

事件溯源最大的测试好处：给定一组事件 → 执行一个命令 → 断言产出的事件。完全不需要 mock 数据库：

```php
it('cannot approve already rejected refund', function () {
    $aggregate = RefundOrderAggregate::retrieve('ORD-001');
    
    $this->withEvents(new RefundRequested(
        orderId: 'ORD-001',
        amountCents: 5000,
        reason: 'wrong item',
        requestedAt: now(),
    ))->expectToFail(InvalidStateTransition::class)
      ->on(fn () => $aggregate->approve('admin@test.com'));
});
```

## 九、什么时候不该用事件溯源

实话说，不是所有模块都需要事件溯源。退单流程有明确的状态机、需要审计追溯、有并发冲突——适合。但像用户资料修改这种 CRUD，用事件溯源就是过度设计。

判断标准很简单：**如果你需要回答"为什么变成了这样"，用事件溯源；如果只需要知道"现在是什么样"，用传统 CRUD。**

## 相关阅读

- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/posts/00_架构/CQRS-Event-Sourcing-完整实战-从事件存储到读模型投影-Laravel订单系统的端到端实现/) — 更完整的 CQRS + Event Sourcing 架构实现，包含 Saga 编排与投影器重建
- [Event Storming 实战：从业务事件到代码实现的领域建模方法论——Laravel B2C API 踩坑记录](/posts/00_架构/Event-Storming-实战-从业务事件到代码实现的领域建模方法论-Laravel-B2C-API踩坑记录/) — 从 Event Storming 事件风暴到 DDD 领域建模的完整方法论
- [事件驱动架构全景实战：EventBridge、NATS、Pulsar 统一事件总线设计](/posts/00_架构/事件驱动架构全景实战-EventBridge-NATS-Pulsar-统一事件总线设计/) — 宏观视角理解事件溯源在事件驱动架构中的定位
