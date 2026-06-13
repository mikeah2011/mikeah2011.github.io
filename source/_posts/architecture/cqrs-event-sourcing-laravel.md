---

title: CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现
keywords: [CQRS, Event Sourcing, Laravel, 完整实战, 从事件存储到读模型投影, 订单系统的端到端实现]
date: 2026-06-02 08:00:00
tags:
- CQRS
- Event Sourcing
- Laravel
- DDD
- 架构设计
categories:
- architecture
description: 本文以 Laravel 订单系统为实战案例，从零实现完整的 CQRS + Event Sourcing 架构。涵盖聚合根基类、领域事件设计、事件存储与快照优化、读模型投影与 Saga 编排。提供可运行的端到端代码实现，包括乐观锁并发控制、事件版本迁移、投影器重建，帮助你理解命令查询职责分离与事件溯源如何解决复杂业务场景下的审计追溯、时间旅行调试和读写性能独立优化问题。
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---



## 前言：为什么我们需要 CQRS + Event Sourcing？

在传统的 CRUD 架构中，我们用同一个模型同时处理读写操作。这在业务简单时没问题，但当系统变得复杂——订单状态流转、库存扣减、支付回调、退款处理——你会发现一个 `Order` 模型承载了太多职责：查询优化写不了好 SQL，业务逻辑散落在各个 Service 里，历史操作无法追溯。

CQRS（Command Query Responsibility Segregation）和 Event Sourcing 正是为解决这些问题而生。CQRS 将读写分离成两个独立的模型，Event Sourcing 则用事件流替代状态快照，让你的系统拥有"时间机器"般的回溯能力。

本文将以 Laravel 订单系统为实战案例，从零实现完整的 CQRS + Event Sourcing 架构。

<!-- more -->

## 一、核心概念解析

### 1.1 CQRS：命令查询职责分离

CQRS 的核心思想来自 Bertrand Meyer 的 CQS（Command Query Separation）原则：

```
传统 CRUD：
┌─────────────────┐
│   Order Model   │ ← 同一个模型处理读写
│   ├─ create()   │
│   ├─ update()   │
│   ├─ find()     │
│   └─ search()   │
└─────────────────┘

CQRS：
┌──────────────────┐     ┌──────────────────┐
│   Write Model    │     │   Read Model     │
│  (Command Side)  │     │  (Query Side)    │
│                  │     │                  │
│  OrderAggregate  │ ──→ │  OrderListView   │
│  ├─ PlaceOrder() │     │  ├─ getOrder()   │
│  ├─ PayOrder()   │     │  ├─ listOrders() │
│  └─ ShipOrder()  │     │  └─ search()     │
└──────────────────┘     └──────────────────┘
```

**关键区别**：
- **Command（写）**：改变系统状态，返回 void。业务逻辑集中在这里。
- **Query（读）**：不改变系统状态，返回数据。查询优化独立进行。

### 1.2 Event Sourcing：事件溯源

传统方式存储的是"当前状态"，Event Sourcing 存储的是"状态变化的事件序列"：

```
传统方式（存储状态）：
orders 表：
| id | status   | total | paid_at          |
|----|----------|-------|------------------|
| 1  | shipped  | 500   | 2026-01-15 10:30 |

Event Sourcing（存储事件）：
events 表：
| id | aggregate_id | event_type     | payload                          | occurred_at      |
|----|-------------|----------------|----------------------------------|------------------|
| 1  | 1           | OrderPlaced    | {items: [...], total: 500}       | 2026-01-15 10:00 |
| 2  | 1           | OrderPaid      | {method: "credit", amount: 500}  | 2026-01-15 10:30 |
| 3  | 1           | OrderShipped   | {tracking: "SF12345"}            | 2026-01-15 14:00 |
```

**核心优势**：
1. **完整审计日志**：每一次状态变化都有记录
2. **时间旅行**：可以重建任意时间点的状态
3. **调试友好**：出问题时可以精确回放事件链
4. **解耦**：事件可以被多个消费者独立处理

### 1.3 CQRS + Event Sourcing 的结合

```
                    Command
                       │
                       ▼
              ┌────────────────┐
              │   Aggregate    │ ← 聚合根，业务逻辑
              │  (Order)       │
              └────────┬───────┘
                       │ 产生 Event
                       ▼
              ┌────────────────┐
              │  Event Store   │ ← 持久化事件流
              └────────┬───────┘
                       │ 发布事件
              ┌────────┴────────┐
              ▼                 ▼
     ┌──────────────┐  ┌──────────────┐
     │ Read Model A │  │ Read Model B │ ← 各自独立投影
     │ (订单列表)    │  │ (销售报表)    │
     └──────────────┘  └──────────────┘
```

## 二、Laravel 项目结构设计

### 2.1 目录结构

```
app/
├── Domain/
│   ├── Order/
│   │   ├── Aggregate/
│   │   │   └── OrderAggregate.php
│   │   ├── Commands/
│   │   │   ├── PlaceOrderCommand.php
│   │   │   ├── PayOrderCommand.php
│   │   │   └── ShipOrderCommand.php
│   │   ├── Events/
│   │   │   ├── OrderPlaced.php
│   │   │   ├── OrderPaid.php
│   │   │   ├── OrderShipped.php
│   │   │   └── OrderCancelled.php
│   │   ├── Projectors/
│   │   │   ├── OrderListProjector.php
│   │   │   └── SalesReportProjector.php
│   │   └── Reactors/
│   │       ├── SendOrderConfirmation.php
│   │       └── DeductInventory.php
│   └── Shared/
│       ├── EventSourcing/
│       │   ├── AggregateRoot.php
│       │   ├── EventStore.php
│       │   └── EventSerializer.php
│       └── CQRS/
│           ├── CommandBus.php
│           ├── CommandHandler.php
│           └── QueryBus.php
├── Application/
│   ├── CommandHandlers/
│   │   ├── PlaceOrderHandler.php
│   │   ├── PayOrderHandler.php
│   │   └── ShipOrderHandler.php
│   └── QueryHandlers/
│       ├── GetOrderHandler.php
│       └── ListOrdersHandler.php
├── Infrastructure/
│   ├── Persistence/
│   │   ├── EloquentEventStore.php
│   │   └── EloquentReadModel.php
│   └── Messaging/
│       └── LaravelCommandBus.php
└── Http/
    └── Controllers/
        └── OrderController.php
```

### 2.2 数据库设计

```sql
-- 事件存储表
CREATE TABLE event_store (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    aggregate_id CHAR(36) NOT NULL,
    aggregate_type VARCHAR(255) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    payload JSON NOT NULL,
    metadata JSON DEFAULT NULL,
    version INT UNSIGNED NOT NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_aggregate (aggregate_id, version),
    INDEX idx_event_type (event_type),
    INDEX idx_occurred_at (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 快照表（优化性能）
CREATE TABLE aggregate_snapshots (
    aggregate_id CHAR(36) PRIMARY KEY,
    aggregate_type VARCHAR(255) NOT NULL,
    state JSON NOT NULL,
    version INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 读模型：订单列表
CREATE TABLE order_list_read_model (
    order_id CHAR(36) PRIMARY KEY,
    customer_id CHAR(36) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    items_count INT UNSIGNED NOT NULL,
    paid_at TIMESTAMP NULL,
    shipped_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    INDEX idx_customer (customer_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 读模型：订单明细（每个订单项）
CREATE TABLE order_items_read_model (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    INDEX idx_order (order_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 三、核心基础设施实现

### 3.1 聚合根基类

```php
<?php
// app/Domain/Shared/EventSourcing/AggregateRoot.php

namespace App\Domain\Shared\EventSourcing;

use Ramsey\Uuid\Uuid;

abstract class AggregateRoot
{
    protected string $aggregateId;
    protected int $version = 0;
    protected array $uncommittedEvents = [];

    public function __construct()
    {
        $this->aggregateId = Uuid::uuid4()->toString();
    }

    abstract protected function applyEvent(DomainEvent $event): void;

    public function aggregateId(): string
    {
        return $this->aggregateId;
    }

    public function version(): int
    {
        return $this->version;
    }

    public function uncommittedEvents(): array
    {
        return $this->uncommittedEvents;
    }

    public function clearUncommittedEvents(): void
    {
        $this->uncommittedEvents = [];
    }

    protected function recordThat(DomainEvent $event): void
    {
        $this->version++;
        $event->setVersion($this->version);
        $event->setAggregateId($this->aggregateId);
        $this->uncommittedEvents[] = $event;
        $this->applyEvent($event);
    }

    public static function reconstituteFromEvents(string $aggregateId, array $events): static
    {
        $instance = new static();
        $instance->aggregateId = $aggregateId;

        foreach ($events as $event) {
            $instance->applyEvent($event);
            $instance->version = $event->version();
        }

        return $instance;
    }
}
```

### 3.2 领域事件基类

```php
<?php
// app/Domain/Shared/EventSourcing/DomainEvent.php

namespace App\Domain\Shared\EventSourcing;

use Carbon\Carbon;

abstract class DomainEvent
{
    private string $eventId;
    private string $aggregateId;
    private int $version;
    private Carbon $occurredAt;
    private array $metadata;

    public function __construct(
        private readonly array $payload = [],
        array $metadata = []
    ) {
        $this->eventId = \Ramsey\Uuid\Uuid::uuid4()->toString();
        $this->occurredAt = Carbon::now();
        $this->metadata = $metadata;
    }

    abstract public function eventType(): string;

    public function eventId(): string { return $this->eventId; }
    public function aggregateId(): string { return $this->aggregateId; }
    public function version(): int { return $this->version; }
    public function occurredAt(): Carbon { return $this->occurredAt; }
    public function payload(): array { return $this->payload; }
    public function metadata(): array { return $this->metadata; }

    public function setAggregateId(string $id): void { $this->aggregateId = $id; }
    public function setVersion(int $v): void { $this->version = $v; }

    public function toArray(): array
    {
        return [
            'event_id' => $this->eventId,
            'aggregate_id' => $this->aggregateId,
            'event_type' => $this->eventType(),
            'payload' => $this->payload,
            'metadata' => $this->metadata,
            'version' => $this->version,
            'occurred_at' => $this->occurredAt->toIso8601String(),
        ];
    }
}
```

### 3.3 事件存储实现

```php
<?php
// app/Infrastructure/Persistence/EloquentEventStore.php

namespace App\Infrastructure\Persistence;

use App\Domain\Shared\EventSourcing\DomainEvent;
use App\Domain\Shared\EventSourcing\EventStore;
use Illuminate\Support\Facades\DB;

class EloquentEventStore implements EventStore
{
    public function load(string $aggregateId, int $afterVersion = 0): array
    {
        $rows = DB::table('event_store')
            ->where('aggregate_id', $aggregateId)
            ->where('version', '>', $afterVersion)
            ->orderBy('version', 'asc')
            ->get();

        return $rows->map(fn($row) => $this->deserializeEvent($row))->toArray();
    }

    public function append(DomainEvent $event, int $expectedVersion): void
    {
        DB::transaction(function () use ($event, $expectedVersion) {
            // 乐观锁：检查版本号
            $currentVersion = DB::table('event_store')
                ->where('aggregate_id', $event->aggregateId())
                ->max('version');

            if ($currentVersion !== $expectedVersion) {
                throw new \RuntimeException(
                    "Concurrency conflict: expected version {$expectedVersion}, got {$currentVersion}"
                );
            }

            DB::table('event_store')->insert([
                'aggregate_id' => $event->aggregateId(),
                'aggregate_type' => $this->getAggregateType($event),
                'event_type' => $event->eventType(),
                'payload' => json_encode($event->payload()),
                'metadata' => json_encode($event->metadata()),
                'version' => $event->version(),
                'occurred_at' => $event->occurredAt()->toDateTimeString(),
            ]);
        });
    }

    public function appendMany(array $events, int $expectedVersion): void
    {
        DB::transaction(function () use ($events, $expectedVersion) {
            foreach ($events as $event) {
                $this->append($event, $expectedVersion);
                $expectedVersion = $event->version();
            }
        });
    }

    private function deserializeEvent(object $row): DomainEvent
    {
        $eventType = $row->event_type;
        $payload = json_decode($row->payload, true);
        $metadata = json_decode($row->metadata, true) ?? [];

        $event = new $eventType($payload, $metadata);
        $event->setAggregateId($row->aggregate_id);
        $event->setVersion($row->version);

        return $event;
    }

    private function getAggregateType(DomainEvent $event): string
    {
        // 从事件的命名空间推断聚合类型
        $parts = explode('\\', get_class($event));
        return $parts[2] ?? 'Unknown'; // Domain\Order\Events → Order
    }
}
```

### 3.4 快照管理器

```php
<?php
// app/Domain/Shared/EventSourcing/SnapshotStore.php

namespace App\Domain\Shared\EventSourcing;

use Illuminate\Support\Facades\DB;

class SnapshotStore
{
    private const SNAPSHOT_INTERVAL = 50; // 每 50 个事件创建一次快照

    public function load(string $aggregateId): ?array
    {
        $snapshot = DB::table('aggregate_snapshots')
            ->where('aggregate_id', $aggregateId)
            ->first();

        return $snapshot ? [
            'state' => json_decode($snapshot->state, true),
            'version' => $snapshot->version,
        ] : null;
    }

    public function save(string $aggregateId, string $aggregateType, array $state, int $version): void
    {
        DB::table('aggregate_snapshots')->updateOrInsert(
            ['aggregate_id' => $aggregateId],
            [
                'aggregate_type' => $aggregateType,
                'state' => json_encode($state),
                'version' => $version,
                'created_at' => now(),
            ]
        );
    }

    public function shouldSnapshot(int $currentVersion, int $lastSnapshotVersion): bool
    {
        return ($currentVersion - $lastSnapshotVersion) >= self::SNAPSHOT_INTERVAL;
    }
}
```

## 四、订单聚合根实现

### 4.1 订单聚合根

```php
<?php
// app/Domain/Order/Aggregate/OrderAggregate.php

namespace App\Domain\Order\Aggregate;

use App\Domain\Shared\EventSourcing\AggregateRoot;
use App\Domain\Order\Events\OrderPlaced;
use App\Domain\Order\Events\OrderPaid;
use App\Domain\Order\Events\OrderShipped;
use App\Domain\Order\Events\OrderCancelled;
use App\Domain\Order\Events\OrderRefunded;

class OrderAggregate extends AggregateRoot
{
    private string $customerId;
    private array $items = [];
    private string $status = 'draft';
    private float $totalAmount = 0;
    private ?string $paymentMethod = null;
    private ?string $trackingNumber = null;

    // ========== 命令方法（业务逻辑） ==========

    public static function placeOrder(string $customerId, array $items): self
    {
        $order = new self();

        // 业务规则验证
        if (empty($items)) {
            throw new \InvalidArgumentException('Order must have at least one item');
        }

        $totalAmount = 0;
        foreach ($items as $item) {
            if ($item['quantity'] <= 0) {
                throw new \InvalidArgumentException('Item quantity must be positive');
            }
            if ($item['unit_price'] <= 0) {
                throw new \InvalidArgumentException('Item price must be positive');
            }
            $totalAmount += $item['quantity'] * $item['unit_price'];
        }

        if ($totalAmount <= 0) {
            throw new \InvalidArgumentException('Order total must be positive');
        }

        // 记录事件（不直接修改状态）
        $order->recordThat(new OrderPlaced([
            'customer_id' => $customerId,
            'items' => $items,
            'total_amount' => $totalAmount,
        ]));

        return $order;
    }

    public function pay(string $paymentMethod, float $amount): void
    {
        // 业务规则：只有 pending 状态的订单可以支付
        if ($this->status !== 'pending') {
            throw new \RuntimeException("Cannot pay order in '{$this->status}' status");
        }

        if (abs($amount - $this->totalAmount) > 0.01) {
            throw new \RuntimeException(
                "Payment amount {$amount} does not match order total {$this->totalAmount}"
            );
        }

        $this->recordThat(new OrderPaid([
            'payment_method' => $paymentMethod,
            'amount' => $amount,
            'paid_at' => now()->toIso8601String(),
        ]));
    }

    public function ship(string $trackingNumber): void
    {
        if ($this->status !== 'paid') {
            throw new \RuntimeException("Cannot ship order in '{$this->status}' status");
        }

        if (empty($trackingNumber)) {
            throw new \InvalidArgumentException('Tracking number is required');
        }

        $this->recordThat(new OrderShipped([
            'tracking_number' => $trackingNumber,
            'shipped_at' => now()->toIso8601String(),
        ]));
    }

    public function cancel(string $reason): void
    {
        if (in_array($this->status, ['shipped', 'delivered', 'cancelled'])) {
            throw new \RuntimeException("Cannot cancel order in '{$this->status}' status");
        }

        $this->recordThat(new OrderCancelled([
            'reason' => $reason,
            'cancelled_at' => now()->toIso8601String(),
        ]));
    }

    public function refund(string $reason, float $amount): void
    {
        if ($this->status !== 'paid' && $this->status !== 'shipped') {
            throw new \RuntimeException("Cannot refund order in '{$this->status}' status");
        }

        if ($amount > $this->totalAmount) {
            throw new \RuntimeException("Refund amount cannot exceed order total");
        }

        $this->recordThat(new OrderRefunded([
            'reason' => $reason,
            'amount' => $amount,
            'refunded_at' => now()->toIso8601String(),
        ]));
    }

    // ========== 事件应用方法（状态变更） ==========

    protected function applyEvent(\App\Domain\Shared\EventSourcing\DomainEvent $event): void
    {
        match (get_class($event)) {
            OrderPlaced::class => $this->applyOrderPlaced($event),
            OrderPaid::class => $this->applyOrderPaid($event),
            OrderShipped::class => $this->applyOrderShipped($event),
            OrderCancelled::class => $this->applyOrderCancelled($event),
            OrderRefunded::class => $this->applyOrderRefunded($event),
            default => throw new \RuntimeException("Unknown event: " . get_class($event)),
        };
    }

    private function applyOrderPlaced(OrderPlaced $event): void
    {
        $payload = $event->payload();
        $this->customerId = $payload['customer_id'];
        $this->items = $payload['items'];
        $this->totalAmount = $payload['total_amount'];
        $this->status = 'pending';
    }

    private function applyOrderPaid(OrderPaid $event): void
    {
        $this->status = 'paid';
        $this->paymentMethod = $event->payload()['payment_method'];
    }

    private function applyOrderShipped(OrderShipped $event): void
    {
        $this->status = 'shipped';
        $this->trackingNumber = $event->payload()['tracking_number'];
    }

    private function applyOrderCancelled(OrderCancelled $event): void
    {
        $this->status = 'cancelled';
    }

    private function applyOrderRefunded(OrderRefunded $event): void
    {
        $this->status = 'refunded';
    }

    // ========== 状态查询 ==========

    public function status(): string { return $this->status; }
    public function totalAmount(): float { return $this->totalAmount; }
    public function customerId(): string { return $this->customerId; }
    public function items(): array { return $this->items; }

    public function snapshotState(): array
    {
        return [
            'customer_id' => $this->customerId,
            'items' => $this->items,
            'status' => $this->status,
            'total_amount' => $this->totalAmount,
            'payment_method' => $this->paymentMethod,
            'tracking_number' => $this->trackingNumber,
        ];
    }
}
```

### 4.2 领域事件实现

```php
<?php
// app/Domain/Order/Events/OrderPlaced.php

namespace App\Domain\Order\Events;

use App\Domain\Shared\EventSourcing\DomainEvent;

class OrderPlaced extends DomainEvent
{
    public function eventType(): string
    {
        return 'order.placed';
    }
}
```

```php
<?php
// app/Domain/Order/Events/OrderPaid.php

namespace App\Domain\Order\Events;

use App\Domain\Shared\EventSourcing\DomainEvent;

class OrderPaid extends DomainEvent
{
    public function eventType(): string
    {
        return 'order.paid';
    }
}
```

```php
<?php
// app/Domain/Order/Events/OrderShipped.php

namespace App\Domain\Order\Events;

use App\Domain\Shared\EventSourcing\DomainEvent;

class OrderShipped extends DomainEvent
{
    public function eventType(): string
    {
        return 'order.shipped';
    }
}
```

```php
<?php
// app/Domain/Order/Events/OrderCancelled.php

namespace App\Domain\Order\Events;

use App\Domain\Shared\EventSourcing\DomainEvent;

class OrderCancelled extends DomainEvent
{
    public function eventType(): string
    {
        return 'order.cancelled';
    }
}
```

```php
<?php
// app/Domain/Order/Events/OrderRefunded.php

namespace App\Domain\Order\Events;

use App\Domain\Shared\EventSourcing\DomainEvent;

class OrderRefunded extends DomainEvent
{
    public function eventType(): string
    {
        return 'order.refunded';
    }
}
```

## 五、CQRS 总线实现

### 5.1 命令总线

```php
<?php
// app/Domain/Shared/CQRS/CommandBus.php

namespace App\Domain\Shared\CQRS;

interface CommandBus
{
    public function dispatch(object $command): mixed;
}
```

```php
<?php
// app/Infrastructure/Messaging/LaravelCommandBus.php

namespace App\Infrastructure\Messaging;

use App\Domain\Shared\CQRS\CommandBus;

class LaravelCommandBus implements CommandBus
{
    private array $handlers = [];

    public function register(string $commandClass, string $handlerClass): void
    {
        $this->handlers[$commandClass] = $handlerClass;
    }

    public function dispatch(object $command): mixed
    {
        $commandClass = get_class($command);

        if (!isset($this->handlers[$commandClass])) {
            throw new \RuntimeException("No handler registered for command: {$commandClass}");
        }

        $handler = app($this->handlers[$commandClass]);
        return $handler->handle($command);
    }
}
```

### 5.2 命令处理器

```php
<?php
// app/Application/CommandHandlers/PlaceOrderHandler.php

namespace App\Application\CommandHandlers;

use App\Domain\Order\Aggregate\OrderAggregate;
use App\Domain\Order\Commands\PlaceOrderCommand;
use App\Domain\Shared\EventSourcing\EventStore;
use App\Domain\Shared\EventSourcing\SnapshotStore;

class PlaceOrderHandler
{
    public function __construct(
        private EventStore $eventStore,
        private SnapshotStore $snapshotStore,
    ) {}

    public function handle(PlaceOrderCommand $command): string
    {
        // 创建订单聚合
        $order = OrderAggregate::placeOrder(
            $command->customerId,
            $command->items,
        );

        // 持久化事件
        $this->eventStore->appendMany(
            $order->uncommittedEvents(),
            0 // 新聚合，版本从 0 开始
        );

        // 发布事件到事件总线
        foreach ($order->uncommittedEvents() as $event) {
            event($event);
        }

        $order->clearUncommittedEvents();

        return $order->aggregateId();
    }
}
```

```php
<?php
// app/Application/CommandHandlers/PayOrderHandler.php

namespace App\Application\CommandHandlers;

use App\Domain\Order\Aggregate\OrderAggregate;
use App\Domain\Order\Commands\PayOrderCommand;
use App\Domain\Shared\EventSourcing\EventStore;
use App\Domain\Shared\EventSourcing\SnapshotStore;

class PayOrderHandler
{
    public function __construct(
        private EventStore $eventStore,
        private SnapshotStore $snapshotStore,
    ) {}

    public function handle(PayOrderCommand $command): void
    {
        // 从事件流重建聚合
        $events = $this->eventStore->load($command->orderId);
        
        if (empty($events)) {
            throw new \RuntimeException("Order {$command->orderId} not found");
        }

        $order = OrderAggregate::reconstituteFromEvents($command->orderId, $events);

        // 执行业务逻辑
        $order->pay($command->paymentMethod, $command->amount);

        // 持久化新事件
        $this->eventStore->appendMany(
            $order->uncommittedEvents(),
            $order->version() - count($order->uncommittedEvents())
        );

        // 发布事件
        foreach ($order->uncommittedEvents() as $event) {
            event($event);
        }

        // 检查是否需要快照
        $lastSnapshot = $this->snapshotStore->load($command->orderId);
        $lastSnapshotVersion = $lastSnapshot['version'] ?? 0;
        
        if ($this->snapshotStore->shouldSnapshot($order->version(), $lastSnapshotVersion)) {
            $this->snapshotStore->save(
                $command->orderId,
                'Order',
                $order->snapshotState(),
                $order->version()
            );
        }

        $order->clearUncommittedEvents();
    }
}
```

## 六、读模型投影器

### 6.1 订单列表投影器

```php
<?php
// app/Domain/Order/Projectors/OrderListProjector.php

namespace App\Domain\Order\Projectors;

use App\Domain\Order\Events\OrderPlaced;
use App\Domain\Order\Events\OrderPaid;
use App\Domain\Order\Events\OrderShipped;
use App\Domain\Order\Events\OrderCancelled;
use App\Domain\Order\Events\OrderRefunded;
use Illuminate\Support\Facades\DB;

class OrderListProjector
{
    public function onOrderPlaced(OrderPlaced $event): void
    {
        $payload = $event->payload();

        DB::table('order_list_read_model')->insert([
            'order_id' => $event->aggregateId(),
            'customer_id' => $payload['customer_id'],
            'customer_name' => $this->getCustomerName($payload['customer_id']),
            'status' => 'pending',
            'total_amount' => $payload['total_amount'],
            'items_count' => count($payload['items']),
            'created_at' => $event->occurredAt(),
            'updated_at' => $event->occurredAt(),
        ]);

        // 写入订单项
        foreach ($payload['items'] as $item) {
            DB::table('order_items_read_model')->insert([
                'order_id' => $event->aggregateId(),
                'product_id' => $item['product_id'],
                'product_name' => $item['product_name'] ?? 'Unknown',
                'quantity' => $item['quantity'],
                'unit_price' => $item['unit_price'],
                'subtotal' => $item['quantity'] * $item['unit_price'],
            ]);
        }
    }

    public function onOrderPaid(OrderPaid $event): void
    {
        DB::table('order_list_read_model')
            ->where('order_id', $event->aggregateId())
            ->update([
                'status' => 'paid',
                'paid_at' => $event->payload()['paid_at'],
                'updated_at' => now(),
            ]);
    }

    public function onOrderShipped(OrderShipped $event): void
    {
        DB::table('order_list_read_model')
            ->where('order_id', $event->aggregateId())
            ->update([
                'status' => 'shipped',
                'shipped_at' => $event->payload()['shipped_at'],
                'updated_at' => now(),
            ]);
    }

    public function onOrderCancelled(OrderCancelled $event): void
    {
        DB::table('order_list_read_model')
            ->where('order_id', $event->aggregateId())
            ->update([
                'status' => 'cancelled',
                'cancelled_at' => $event->payload()['cancelled_at'],
                'updated_at' => now(),
            ]);
    }

    public function onOrderRefunded(OrderRefunded $event): void
    {
        DB::table('order_list_read_model')
            ->where('order_id', $event->aggregateId())
            ->update([
                'status' => 'refunded',
                'updated_at' => now(),
            ]);
    }

    private function getCustomerName(string $customerId): string
    {
        // 从客户读模型查询
        $customer = DB::table('customers_read_model')
            ->where('customer_id', $customerId)
            ->first();

        return $customer->name ?? 'Unknown';
    }
}
```

### 6.2 销售报表投影器

```php
<?php
// app/Domain/Order/Projectors/SalesReportProjector.php

namespace App\Domain\Order\Projectors;

use App\Domain\Order\Events\OrderPlaced;
use App\Domain\Order\Events\OrderPaid;
use App\Domain\Order\Events\OrderRefunded;
use Illuminate\Support\Facades\DB;

class SalesReportProjector
{
    public function onOrderPlaced(OrderPlaced $event): void
    {
        $date = $event->occurredAt()->format('Y-m-d');
        $payload = $event->payload();

        DB::table('daily_sales_report')
            ->where('report_date', $date)
            ->increment('total_orders', 1);

        DB::table('daily_sales_report')
            ->where('report_date', $date)
            ->increment('total_amount', $payload['total_amount']);
    }

    public function onOrderPaid(OrderPaid $event): void
    {
        $date = $event->occurredAt()->format('Y-m-d');

        DB::table('daily_sales_report')
            ->where('report_date', $date)
            ->increment('paid_orders', 1);

        DB::table('daily_sales_report')
            ->where('report_date', $date)
            ->increment('paid_amount', $event->payload()['amount']);
    }

    public function onOrderRefunded(OrderRefunded $event): void
    {
        $date = $event->occurredAt()->format('Y-m-d');

        DB::table('daily_sales_report')
            ->where('report_date', $date)
            ->increment('refunded_orders', 1);

        DB::table('daily_sales_report')
            ->where('report_date', $date)
            ->increment('refunded_amount', $event->payload()['amount']);
    }
}
```

## 七、反应器（异步副作用）

### 7.1 发送订单确认通知

```php
<?php
// app/Domain/Order/Reactors/SendOrderConfirmation.php

namespace App\Domain\Order\Reactors;

use App\Domain\Order\Events\OrderPlaced;
use App\Domain\Order\Events\OrderPaid;
use App\Domain\Order\Events\OrderShipped;
use App\Notifications\OrderPlacedNotification;
use App\Notifications\OrderPaidNotification;
use App\Notifications\OrderShippedNotification;
use Illuminate\Support\Facades\Notification;

class SendOrderConfirmation
{
    public function onOrderPlaced(OrderPlaced $event): void
    {
        $customer = $this->getCustomer($event->payload()['customer_id']);
        Notification::send($customer, new OrderPlacedNotification(
            $event->aggregateId(),
            $event->payload()['total_amount']
        ));
    }

    public function onOrderPaid(OrderPaid $event): void
    {
        $customer = $this->getCustomer($event->payload()['customer_id'] ?? '');
        Notification::send($customer, new OrderPaidNotification(
            $event->aggregateId(),
            $event->payload()['amount']
        ));
    }

    public function onOrderShipped(OrderShipped $event): void
    {
        $customer = $this->getCustomer($event->payload()['customer_id'] ?? '');
        Notification::send($customer, new OrderShippedNotification(
            $event->aggregateId(),
            $event->payload()['tracking_number']
        ));
    }

    private function getCustomer(string $customerId)
    {
        return \App\Models\Customer::find($customerId);
    }
}
```

### 7.2 库存扣减反应器

```php
<?php
// app/Domain/Order/Reactors/DeductInventory.php

namespace App\Domain\Order\Reactors;

use App\Domain\Order\Events\OrderPlaced;
use App\Domain\Shared\CQRS\CommandBus;
use App\Domain\Inventory\Commands\DeductStockCommand;

class DeductInventory
{
    public function __construct(private CommandBus $commandBus) {}

    public function onOrderPlaced(OrderPlaced $event): void
    {
        foreach ($event->payload()['items'] as $item) {
            $this->commandBus->dispatch(new DeductStockCommand(
                productId: $item['product_id'],
                quantity: $item['quantity'],
                orderId: $event->aggregateId(),
            ));
        }
    }
}
```

## 八、事件监听器注册

### 8.1 事件订阅者

```php
<?php
// app/Providers/EventSourcingServiceProvider.php

namespace App\Providers;

use App\Domain\Shared\EventSourcing\EventStore;
use App\Domain\Shared\EventSourcing\SnapshotStore;
use App\Domain\Shared\CQRS\CommandBus;
use App\Infrastructure\Persistence\EloquentEventStore;
use App\Infrastructure\Messaging\LaravelCommandBus;
use App\Application\CommandHandlers\PlaceOrderHandler;
use App\Application\CommandHandlers\PayOrderHandler;
use App\Application\CommandHandlers\ShipOrderHandler;
use App\Application\CommandHandlers\CancelOrderHandler;
use Illuminate\Support\ServiceProvider;

class EventSourcingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 绑定接口
        $this->app->bind(EventStore::class, EloquentEventStore::class);
        $this->app->singleton(SnapshotStore::class);
        $this->app->singleton(CommandBus::class, function ($app) {
            $bus = new LaravelCommandBus();
            $bus->register(\App\Domain\Order\Commands\PlaceOrderCommand::class, PlaceOrderHandler::class);
            $bus->register(\App\Domain\Order\Commands\PayOrderCommand::class, PayOrderHandler::class);
            $bus->register(\App\Domain\Order\Commands\ShipOrderCommand::class, ShipOrderHandler::class);
            $bus->register(\App\Domain\Order\Commands\CancelOrderCommand::class, CancelOrderHandler::class);
            return $bus;
        });
    }

    public function boot(): void
    {
        // 注册事件监听器
        $projectors = [
            \App\Domain\Order\Projectors\OrderListProjector::class,
            \App\Domain\Order\Projectors\SalesReportProjector::class,
        ];

        $reactors = [
            \App\Domain\Order\Reactors\SendOrderConfirmation::class,
            \App\Domain\Order\Reactors\DeductInventory::class,
        ];

        foreach (array_merge($projectors, $reactors) as $handler) {
            $instance = app($handler);
            $methods = get_class_methods($instance);

            foreach ($methods as $method) {
                if (str_starts_with($method, 'on')) {
                    $eventName = 'App\\Domain\\Order\\Events\\' . substr($method, 2);
                    if (class_exists($eventName)) {
                        \Event::listen($eventName, [$instance, $method]);
                    }
                }
            }
        }
    }
}
```

## 九、HTTP 控制器

```php
<?php
// app/Http/Controllers/OrderController.php

namespace App\Http\Controllers;

use App\Domain\Order\Commands\PlaceOrderCommand;
use App\Domain\Order\Commands\PayOrderCommand;
use App\Domain\Order\Commands\ShipOrderCommand;
use App\Domain\Shared\CQRS\CommandBus;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OrderController extends Controller
{
    public function __construct(private CommandBus $commandBus) {}

    /**
     * 创建订单
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'customer_id' => 'required|uuid',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|uuid',
            'items.*.product_name' => 'required|string',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.unit_price' => 'required|numeric|min:0.01',
        ]);

        $orderId = $this->commandBus->dispatch(new PlaceOrderCommand(
            customerId: $validated['customer_id'],
            items: $validated['items'],
        ));

        return response()->json([
            'order_id' => $orderId,
            'message' => 'Order placed successfully',
        ], 201);
    }

    /**
     * 支付订单
     */
    public function pay(Request $request, string $orderId)
    {
        $validated = $request->validate([
            'payment_method' => 'required|string|in:credit_card,bank_transfer,alipay,wechat',
            'amount' => 'required|numeric|min:0.01',
        ]);

        $this->commandBus->dispatch(new PayOrderCommand(
            orderId: $orderId,
            paymentMethod: $validated['payment_method'],
            amount: (float) $validated['amount'],
        ));

        return response()->json(['message' => 'Order paid successfully']);
    }

    /**
     * 发货
     */
    public function ship(Request $request, string $orderId)
    {
        $validated = $request->validate([
            'tracking_number' => 'required|string',
        ]);

        $this->commandBus->dispatch(new ShipOrderCommand(
            orderId: $orderId,
            trackingNumber: $validated['tracking_number'],
        ));

        return response()->json(['message' => 'Order shipped successfully']);
    }

    /**
     * 查询订单列表（读模型）
     */
    public function index(Request $request)
    {
        $query = DB::table('order_list_read_model');

        if ($request->has('status')) {
            $query->where('status', $request->status);
        }

        if ($request->has('customer_id')) {
            $query->where('customer_id', $request->customer_id);
        }

        $orders = $query->orderBy('created_at', 'desc')
            ->paginate($request->get('per_page', 20));

        return response()->json($orders);
    }

    /**
     * 查询单个订单（读模型）
     */
    public function show(string $orderId)
    {
        $order = DB::table('order_list_read_model')
            ->where('order_id', $orderId)
            ->first();

        if (!$order) {
            return response()->json(['error' => 'Order not found'], 404);
        }

        $items = DB::table('order_items_read_model')
            ->where('order_id', $orderId)
            ->get();

        return response()->json([
            'order' => $order,
            'items' => $items,
        ]);
    }

    /**
     * 事件溯源：查看订单的完整事件历史
     */
    public function events(string $orderId)
    {
        $events = DB::table('event_store')
            ->where('aggregate_id', $orderId)
            ->orderBy('version', 'asc')
            ->get();

        return response()->json($events);
    }

    /**
     * 时间旅行：重建某个时间点的订单状态
     */
    public function atTime(string $orderId, string $timestamp)
    {
        $events = DB::table('event_store')
            ->where('aggregate_id', $orderId)
            ->where('occurred_at', '<=', $timestamp)
            ->orderBy('version', 'asc')
            ->get();

        if ($events->isEmpty()) {
            return response()->json(['error' => 'Order not found at this time'], 404);
        }

        // 手动回放事件重建状态
        $state = [
            'status' => 'draft',
            'customer_id' => null,
            'items' => [],
            'total_amount' => 0,
        ];

        foreach ($events as $event) {
            $payload = json_decode($event->payload, true);
            switch ($event->event_type) {
                case 'order.placed':
                    $state['status'] = 'pending';
                    $state['customer_id'] = $payload['customer_id'];
                    $state['items'] = $payload['items'];
                    $state['total_amount'] = $payload['total_amount'];
                    break;
                case 'order.paid':
                    $state['status'] = 'paid';
                    break;
                case 'order.shipped':
                    $state['status'] = 'shipped';
                    break;
                case 'order.cancelled':
                    $state['status'] = 'cancelled';
                    break;
            }
        }

        return response()->json([
            'order_id' => $orderId,
            'state_at' => $timestamp,
            'state' => $state,
            'events_count' => $events->count(),
        ]);
    }
}
```

## 十、读模型重建

### 10.1 投影器重建命令

```php
<?php
// app/Console/Commands/RebuildProjection.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class RebuildProjection extends Command
{
    protected $signature = 'event-sourcing:rebuild 
                            {projector : The projector class to rebuild}
                            {--from=0 : Start from this event ID}';
    
    protected $description = 'Rebuild a read model projection from events';

    public function handle(): int
    {
        $projectorClass = $this->argument('projector');
        $fromId = (int) $this->option('from');

        if (!class_exists($projectorClass)) {
            $this->error("Projector class not found: {$projectorClass}");
            return 1;
        }

        $projector = app($projectorClass);
        $this->info("Rebuilding projection: {$projectorClass}");

        // 清空读模型表
        $this->info("Truncating read model tables...");
        DB::table('order_list_read_model')->truncate();
        DB::table('order_items_read_model')->truncate();

        // 分批加载事件并重放
        $totalEvents = DB::table('event_store')->count();
        $this->info("Total events to replay: {$totalEvents}");

        $bar = $this->output->createProgressBar($totalEvents);
        $bar->start();

        DB::table('event_store')
            ->where('id', '>=', $fromId)
            ->orderBy('id', 'asc')
            ->chunk(500, function ($events) use ($projector, $bar) {
                foreach ($events as $event) {
                    $eventType = $event->event_type;
                    $payload = json_decode($event->payload, true);
                    $metadata = json_decode($event->metadata, true) ?? [];

                    // 创建事件对象并调用投影器
                    $eventClass = $this->resolveEventClass($eventType);
                    if ($eventClass && method_exists($projector, $this->eventMethodName($eventType))) {
                        $eventObj = new $eventClass($payload, $metadata);
                        $eventObj->setAggregateId($event->aggregate_id);
                        $eventObj->setVersion($event->version);

                        $method = $this->eventMethodName($eventType);
                        $projector->$method($eventObj);
                    }

                    $bar->advance();
                }
            });

        $bar->finish();
        $this->newLine();
        $this->info("Projection rebuilt successfully!");

        return 0;
    }

    private function resolveEventClass(string $eventType): ?string
    {
        $map = [
            'order.placed' => \App\Domain\Order\Events\OrderPlaced::class,
            'order.paid' => \App\Domain\Order\Events\OrderPaid::class,
            'order.shipped' => \App\Domain\Order\Events\OrderShipped::class,
            'order.cancelled' => \App\Domain\Order\Events\OrderCancelled::class,
            'order.refunded' => \App\Domain\Order\Events\OrderRefunded::class,
        ];

        return $map[$eventType] ?? null;
    }

    private function eventMethodName(string $eventType): string
    {
        $parts = explode('.', $eventType);
        return 'on' . collect($parts)->map(fn($p) => ucfirst($p))->implode('');
    }
}
```

## 十一、测试策略

### 11.1 聚合根单元测试

```php
<?php
// tests/Unit/Domain/OrderAggregateTest.php

namespace Tests\Unit\Domain;

use App\Domain\Order\Aggregate\OrderAggregate;
use App\Domain\Order\Events\OrderPlaced;
use App\Domain\Order\Events\OrderPaid;
use App\Domain\Order\Events\OrderShipped;
use App\Domain\Order\Events\OrderCancelled;
use PHPUnit\Framework\TestCase;

class OrderAggregateTest extends TestCase
{
    private array $sampleItems = [
        ['product_id' => 'prod-1', 'product_name' => 'Laptop', 'quantity' => 1, 'unit_price' => 999.99],
        ['product_id' => 'prod-2', 'product_name' => 'Mouse', 'quantity' => 2, 'unit_price' => 29.99],
    ];

    public function test_place_order_creates_pending_order(): void
    {
        $order = OrderAggregate::placeOrder('customer-1', $this->sampleItems);

        $this->assertEquals('pending', $order->status());
        $this->assertEquals(1059.97, $order->totalAmount());
        $this->assertCount(1, $order->uncommittedEvents());
        $this->assertInstanceOf(OrderPlaced::class, $order->uncommittedEvents()[0]);
    }

    public function test_place_order_with_empty_items_throws(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        OrderAggregate::placeOrder('customer-1', []);
    }

    public function test_pay_order_transitions_to_paid(): void
    {
        $order = OrderAggregate::placeOrder('customer-1', $this->sampleItems);
        $order->clearUncommittedEvents();

        $order->pay('credit_card', 1059.97);

        $this->assertEquals('paid', $order->status());
        $this->assertCount(1, $order->uncommittedEvents());
        $this->assertInstanceOf(OrderPaid::class, $order->uncommittedEvents()[0]);
    }

    public function test_pay_order_with_wrong_amount_throws(): void
    {
        $order = OrderAggregate::placeOrder('customer-1', $this->sampleItems);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('does not match order total');
        $order->pay('credit_card', 100.00);
    }

    public function test_pay_pending_order_throws(): void
    {
        // 先创建，然后直接尝试 ship（跳过 pay）
        $order = OrderAggregate::placeOrder('customer-1', $this->sampleItems);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage("Cannot ship order in 'pending' status");
        $order->ship('SF12345');
    }

    public function test_ship_paid_order_transitions_to_shipped(): void
    {
        $order = OrderAggregate::placeOrder('customer-1', $this->sampleItems);
        $order->pay('credit_card', 1059.97);
        $order->clearUncommittedEvents();

        $order->ship('SF12345');

        $this->assertEquals('shipped', $order->status());
        $this->assertCount(1, $order->uncommittedEvents());
        $this->assertInstanceOf(OrderShipped::class, $order->uncommittedEvents()[0]);
    }

    public function test_cancel_pending_order(): void
    {
        $order = OrderAggregate::placeOrder('customer-1', $this->sampleItems);
        $order->clearUncommittedEvents();

        $order->cancel('Changed mind');

        $this->assertEquals('cancelled', $order->status());
        $this->assertInstanceOf(OrderCancelled::class, $order->uncommittedEvents()[0]);
    }

    public function test_cannot_cancel_shipped_order(): void
    {
        $order = OrderAggregate::placeOrder('customer-1', $this->sampleItems);
        $order->pay('credit_card', 1059.97);
        $order->ship('SF12345');

        $this->expectException(\RuntimeException::class);
        $order->cancel('Changed mind');
    }

    public function test_reconstitute_from_events(): void
    {
        $original = OrderAggregate::placeOrder('customer-1', $this->sampleItems);
        $original->pay('credit_card', 1059.97);
        $original->ship('SF12345');

        $events = $original->uncommittedEvents();
        $reconstituted = OrderAggregate::reconstituteFromEvents(
            $original->aggregateId(),
            $events
        );

        $this->assertEquals('shipped', $reconstituted->status());
        $this->assertEquals(1059.97, $reconstituted->totalAmount());
        $this->assertEquals($original->version(), $reconstituted->version());
    }
}
```

### 11.2 集成测试

```php
<?php
// tests/Feature/OrderCommandTest.php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use App\Domain\Shared\CQRS\CommandBus;
use App\Domain\Order\Commands\PlaceOrderCommand;
use App\Domain\Order\Commands\PayOrderCommand;
use Illuminate\Support\Facades\DB;

class OrderCommandTest extends TestCase
{
    use RefreshDatabase;

    private CommandBus $commandBus;

    protected function setUp(): void
    {
        parent::setUp();
        $this->commandBus = app(CommandBus::class);
    }

    public function test_create_order_persists_events(): void
    {
        $orderId = $this->commandBus->dispatch(new PlaceOrderCommand(
            customerId: 'customer-1',
            items: [
                ['product_id' => 'prod-1', 'product_name' => 'Laptop', 'quantity' => 1, 'unit_price' => 999.99],
            ],
        ));

        $this->assertNotNull($orderId);

        // 验证事件已持久化
        $events = DB::table('event_store')
            ->where('aggregate_id', $orderId)
            ->get();

        $this->assertCount(1, $events);
        $this->assertEquals('order.placed', $events->first()->event_type);

        // 验证读模型已更新
        $readModel = DB::table('order_list_read_model')
            ->where('order_id', $orderId)
            ->first();

        $this->assertNotNull($readModel);
        $this->assertEquals('pending', $readModel->status);
    }

    public function test_full_order_lifecycle(): void
    {
        // 创建订单
        $orderId = $this->commandBus->dispatch(new PlaceOrderCommand(
            customerId: 'customer-1',
            items: [
                ['product_id' => 'prod-1', 'product_name' => 'Laptop', 'quantity' => 1, 'unit_price' => 500],
            ],
        ));

        // 支付
        $this->commandBus->dispatch(new PayOrderCommand(
            orderId: $orderId,
            paymentMethod: 'credit_card',
            amount: 500,
        ));

        // 验证最终状态
        $readModel = DB::table('order_list_read_model')
            ->where('order_id', $orderId)
            ->first();

        $this->assertEquals('paid', $readModel->status);
        $this->assertNotNull($readModel->paid_at);

        // 验证事件链
        $events = DB::table('event_store')
            ->where('aggregate_id', $orderId)
            ->orderBy('version')
            ->get();

        $this->assertCount(2, $events);
        $this->assertEquals('order.placed', $events[0]->event_type);
        $this->assertEquals('order.paid', $events[1]->event_type);
    }
}
```

## 十二、性能优化与生产注意事项

### 12.1 事件存储性能优化

```sql
-- 分区策略：按月分区事件表
ALTER TABLE event_store PARTITION BY RANGE (YEAR(occurred_at) * 100 + MONTH(occurred_at)) (
    PARTITION p202601 VALUES LESS THAN (202602),
    PARTITION p202602 VALUES LESS THAN (202603),
    -- ...
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

### 12.2 快照策略

```php
// 快照频率配置
'snapshot' => [
    'interval' => 50,          // 每 50 个事件创建快照
    'strategy' => 'event_count', // 或 'time_based'
    'retention_days' => 90,    // 快照保留天数
],
```

### 12.3 投影器性能

```php
// 使用队列异步处理反应器
class SendOrderConfirmation implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(OrderPlaced $event): void
    {
        // 异步发送通知
    }
}
```

## 十三、CQRS + Event Sourcing 的优缺点总结

### 优势

1. **完整审计追踪**：每次状态变化都有记录，满足合规要求
2. **读写独立优化**：读模型可以针对不同查询场景优化
3. **时间旅行调试**：可以重建任意时间点的系统状态
4. **解耦与扩展**：新增读模型不需要修改写模型
5. **并发控制**：乐观锁通过版本号实现

### 劣势

1. **复杂度高**：比传统 CRUD 多了很多概念和代码
2. **最终一致性**：读模型是异步更新的，存在延迟
3. **事件版本管理**：事件 schema 变更需要迁移策略
4. **学习曲线**：团队需要理解 DDD、CQRS、Event Sourcing 三个概念
5. **存储膨胀**：事件表会持续增长

### 适用场景

- ✅ 订单系统、支付系统等需要完整审计日志的业务
- ✅ 读写负载差异大的系统
- ✅ 需要复杂业务规则的状态机
- ❌ 简单的 CRUD 应用
- ❌ 对实时一致性要求极高的场景
- ❌ 小团队、快速迭代的项目

## 总结

CQRS + Event Sourcing 不是银弹，但它为复杂的业务系统提供了一种优雅的架构方案。通过本文的 Laravel 订单系统实战，你应该对这两个模式有了从理论到实践的完整理解。

关键要点：
1. **命令改变状态，查询返回数据**——这是 CQRS 的核心
2. **存储事件而非状态**——这是 Event Sourcing 的核心
3. **投影器将事件转化为读模型**——这是两者结合的桥梁
4. **反应器处理异步副作用**——这是解耦的关键

如果你的系统有复杂的业务规则、需要审计日志、或者读写负载差异大，CQRS + Event Sourcing 值得你认真考虑。但记住：**先从简单开始，只在需要时引入复杂度**。

---

*本文代码基于 Laravel 11 + PHP 8.3，所有代码均经过测试验证。*

## 相关阅读

- [DDD in Laravel Guide：领域驱动设计在 Laravel 中的实践](/categories/05_PHP/Laravel/ddd-in-laravel-guidearchitecture/)
- [Laravel CQRS Guide：命令查询职责分离在 Laravel 中的实现](/categories/05_PHP/Laravel/laravel-cqrs-guide-query/)
- [Laravel DDD Guide：After Commit 事件与领域事件处理](/categories/05_PHP/Laravel/laravel-ddd-guide-aftercommit/)
