---

title: Laravel Event-Sourcing 入门实战-事件溯源在 B2C 电商中的应用场景与落地踩坑记录
keywords: [Laravel Event, Sourcing, B2C, 入门实战, 事件溯源在, 电商中的应用场景与落地踩坑记录]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-05 10:45:10
updated: 2026-05-05 10:47:51
categories:
- architecture
- php
tags:
- KKday
- Laravel
- 架构
- Event Sourcing
- CQRS
description: 从传统 CRUD 到事件溯源架构的完整转型指南——基于 Spatie Event Sourcing 在 Laravel B2C 电商项目中实现订单生命周期管理、库存变更追踪与审计日志，涵盖聚合根、Projector、Reactor 的实战代码，以及事件 Schema 演进、乐观锁并发、快照优化等四大踩坑解决方案与架构选型对比表。
---



# Laravel Event-Sourcing 入门实战：事件溯源在 B2C 电商中的应用场景与落地踩坑记录

## 为什么 CRUD 在电商场景下不够用？

在 KKday B2C 后端团队，大多数 Laravel 项目用经典的 CRUD 模式运行得很好。但当业务提出这些需求时，传统 CRUD 开始力不从心：

- **订单状态回溯**：「这个订单从创建到完成经历了哪些状态变更？每次变更是谁触发的？」
- **库存变更审计**：「商品 A 的库存在昨天下午为什么突然少了 50 件？是哪笔操作扣的？」
- **用户行为重放**：「如果当时用户的购物车里有这些商品，推荐引擎会返回什么结果？」

传统 CRUD 只存储「当前状态」，历史变更信息要么丢在日志里，要么写进一张冗余的 `audit_logs` 表——查询困难、关联复杂、回溯几乎不可能。

**Event Sourcing（事件溯源）** 的核心思想很简单：**不存储当前状态，而是存储所有导致当前状态的事件序列**。当前状态通过「重放事件」得到。

```
传统 CRUD:    购物车表 → { items: [...], total: 500 }  (只有最终状态)
Event Sourcing:
  → CartCreated { cart_id, user_id }
  → ItemAdded { product_id: 1, qty: 2, price: 100 }
  → ItemAdded { product_id: 2, qty: 1, price: 300 }
  → ItemQuantityChanged { product_id: 1, qty: 3 }
  (可以回到任意时间点的状态)
```

## 架构全景：Event Sourcing 如何融入 Laravel B2C 系统

```
┌─────────────────────────────────────────────────────────┐
│                    Laravel B2C API                       │
│                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │Controller│───→│  Aggregate   │───→│Event Store   │   │
│  │  (HTTP)  │    │  (Order,     │    │(event_       │   │
│  │          │    │   Cart,      │    │ streamings   │   │
│  │          │    │   Inventory) │    │  table)      │   │
│  └──────────┘    └──────┬───────┘    └──────┬───────┘   │
│                         │                   │           │
│                         ▼                   ▼           │
│                  ┌──────────────┐    ┌──────────────┐   │
│                  │Domain Events │    │ Projections  │   │
│                  │(触发副作用)   │    │(读模型/物化   │   │
│                  │              │    │ 视图)        │   │
│                  └──────┬───────┘    └──────┬───────┘   │
│                         │                   │           │
│          ┌──────────────┼───────────────────┘           │
│          ▼              ▼                               │
│   ┌────────────┐ ┌────────────┐ ┌──────────────┐       │
│   │ 通知服务    │ │ 订单快照表  │ │ 统计报表     │       │
│   │ (Slack/FCM)│ │(query side)│ │(analytics)   │       │
│   └────────────┘ └────────────┘ └──────────────┘       │
└─────────────────────────────────────────────────────────┘
```

在 Laravel 生态中，**Spatie/laravel-event-sourcing** 是最成熟的事件溯源包。它提供 Aggregate Root、Event Store、Projector、Reactors 等核心抽象。

## 环境搭建

```bash
composer require spatie/laravel-event-sourcing

# 发布配置和迁移
php artisan vendor:publish --provider="Spatie\EventSourcing\EventSourcingServiceProvider"
php artisan migrate
```

迁移会创建 `stored_events` 表（事件存储）和 `snapshots` 表（快照缓存，避免重放过慢）。

```php
// config/event-sourcing.php
return [
    // 默认事件存储模型
    'stored_event_model' => \Spatie\EventSourcing\StoredEvents\Models\EloquentStoredEvent::class,

    // 快照存储模型
    'snapshot_model' => \Spatie\EventSourcing\Snapshots\EloquentSnapshot::class,

    // 事件序列化器（推荐用 JSON）
    'stored_event_repository' => \Spatie\EventSourcing\StoredEvents\Repositories\EloquentStoredEventRepository::class,

    // Projector 和 Reactor 的自动发现目录
    'projectors_directory' => app_path('Projectors'),
    'reactors_directory' => app_path('Reactors'),
];
```

## 实战一：订单生命周期的 Event Sourcing 实现

### 定义事件

```php
<?php
// app/Domain/Order/Events/OrderCreated.php
namespace App\Domain\Order\Events;

use Spatie\EventSourcing\StoredEvents\ShouldBeStored;

class OrderCreated extends ShouldBeStored
{
    public function __construct(
        public readonly string $orderUuid,
        public readonly int $userId,
        public readonly array $items,      // [{product_id, qty, unit_price}]
        public readonly string $currency,
        public readonly int $totalAmount,
    ) {}
}
```

```php
<?php
// app/Domain/Order/Events/OrderPaid.php
namespace App\Domain\Order\Events;

use Spatie\EventSourcing\StoredEvents\ShouldBeStored;

class OrderPaid extends ShouldBeStored
{
    public function __construct(
        public readonly string $orderUuid,
        public readonly string $paymentMethod,  // stripe / alipay
        public readonly string $transactionId,
        public readonly int $paidAmount,
    ) {}
}
```

```php
<?php
// app/Domain/Order/Events/OrderShipped.php
namespace App\Domain\Order\Events;

use Spatie\EventSourcing\StoredEvents\ShouldBeStored;

class OrderShipped extends ShouldBeStored
{
    public function __construct(
        public readonly string $orderUuid,
        public readonly string $trackingNumber,
        public readonly string $carrier,       // fedex / dhl / sf
    ) {}
}
```

```php
<?php
// app/Domain/Order/Events/OrderCancelled.php
namespace App\Domain\Order\Events;

use Spatie\EventSourcing\StoredEvents\ShouldBeStored;

class OrderCancelled extends ShouldBeStored
{
    public function __construct(
        public readonly string $orderUuid,
        public readonly string $reason,
        public readonly int $cancelledBy,  // user_id
    ) {}
}
```

### 定义聚合根（Aggregate Root）

聚合根是事件溯源的核心：它保证所有状态变更都通过事件记录。

```php
<?php
// app/Domain/Order/OrderAggregateRoot.php
namespace App\Domain\Order;

use App\Domain\Order\Events\OrderCreated;
use App\Domain\Order\Events\OrderPaid;
use App\Domain\Order\Events\OrderShipped;
use App\Domain\Order\Events\OrderCancelled;
use Spatie\EventSourcing\AggregateRoots\AggregateRoot;

class OrderAggregateRoot extends AggregateRoot
{
    private string $state = 'pending';
    private array $items = [];
    private ?string $paymentTransactionId = null;

    // 命令方法：产生事件
    public function createOrder(string $orderUuid, int $userId, array $items, string $currency, int $totalAmount): self
    {
        $this->recordThat(new OrderCreated(
            orderUuid: $orderUuid,
            userId: $userId,
            items: $items,
            currency: $currency,
            totalAmount: $totalAmount,
        ));
        return $this;
    }

    public function pay(string $paymentMethod, string $transactionId, int $paidAmount): self
    {
        if ($this->state !== 'pending') {
            throw new \DomainException("Cannot pay order in state: {$this->state}");
        }

        $this->recordThat(new OrderPaid(
            orderUuid: $this->uuid(),
            paymentMethod: $paymentMethod,
            transactionId: $transactionId,
            paidAmount: $paidAmount,
        ));
        return $this;
    }

    public function ship(string $trackingNumber, string $carrier): self
    {
        if ($this->state !== 'paid') {
            throw new \DomainException("Cannot ship order in state: {$this->state}");
        }

        $this->recordThat(new OrderShipped(
            orderUuid: $this->uuid(),
            trackingNumber: $trackingNumber,
            carrier: $carrier,
        ));
        return $this;
    }

    public function cancel(string $reason, int $cancelledBy): self
    {
        if (in_array($this->state, ['shipped', 'completed', 'cancelled'])) {
            throw new \DomainException("Cannot cancel order in state: {$this->state}");
        }

        $this->recordThat(new OrderCancelled(
            orderUuid: $this->uuid(),
            reason: $reason,
            cancelledBy: $cancelledBy,
        ));
        return $this;
    }

    // 事件应用方法：更新内存状态（不触发副作用）
    protected function applyOrderCreated(OrderCreated $event): void
    {
        $this->state = 'pending';
        $this->items = $event->items;
    }

    protected function applyOrderPaid(OrderPaid $event): void
    {
        $this->state = 'paid';
        $this->paymentTransactionId = $event->transactionId;
    }

    protected function applyOrderShipped(OrderShipped $event): void
    {
        $this->state = 'shipped';
    }

    protected function applyOrderCancelled(OrderCancelled $event): void
    {
        $this->state = 'cancelled';
    }
}
```

### 在 Service 中使用聚合根

```php
<?php
// app/Services/OrderService.php
namespace App\Services;

use App\Domain\Order\OrderAggregateRoot;
use Illuminate\Support\Str;

class OrderService
{
    public function createOrder(int $userId, array $items, string $currency): string
    {
        $orderUuid = Str::uuid()->toString();
        $totalAmount = array_reduce($items, fn($carry, $item) => $carry + ($item['unit_price'] * $item['qty']), 0);

        OrderAggregateRoot::retrieve($orderUuid)
            ->createOrder($orderUuid, $userId, $items, $currency, $totalAmount)
            ->persist();

        return $orderUuid;
    }

    public function payOrder(string $orderUuid, string $paymentMethod, string $transactionId, int $paidAmount): void
    {
        OrderAggregateRoot::retrieve($orderUuid)
            ->pay($paymentMethod, $transactionId, $paidAmount)
            ->persist();
    }

    public function shipOrder(string $orderUuid, string $trackingNumber, string $carrier): void
    {
        OrderAggregateRoot::retrieve($orderUuid)
            ->ship($trackingNumber, $carrier)
            ->persist();
    }

    public function cancelOrder(string $orderUuid, string $reason, int $cancelledBy): void
    {
        OrderAggregateRoot::retrieve($orderUuid)
            ->cancel($reason, $cancelledBy)
            ->persist();
    }
}
```

## 实战二：Projector 构建读模型（查询优化）

事件存储负责写入，但查询不能每次都重放事件——这就是 **Projector** 的作用：监听事件，维护一张「物化视图」表。

```php
<?php
// app/Projectors/OrderProjector.php
namespace App\Projectors;

use App\Domain\Order\Events\OrderCreated;
use App\Domain\Order\Events\OrderPaid;
use App\Domain\Order\Events\OrderShipped;
use App\Domain\Order\Events\OrderCancelled;
use App\Models\OrderSnapshot;
use Spatie\EventSourcing\EventHandlers\Projectors\Projector;

class OrderProjector extends Projector
{
    public function onOrderCreated(OrderCreated $event): void
    {
        OrderSnapshot::create([
            'order_uuid' => $event->orderUuid,
            'user_id' => $event->userId,
            'state' => 'pending',
            'items' => json_encode($event->items),
            'currency' => $event->currency,
            'total_amount' => $event->totalAmount,
        ]);
    }

    public function onOrderPaid(OrderPaid $event): void
    {
        OrderSnapshot::where('order_uuid', $event->orderUuid)->update([
            'state' => 'paid',
            'payment_method' => $event->paymentMethod,
            'transaction_id' => $event->transactionId,
            'paid_at' => now(),
        ]);
    }

    public function onOrderShipped(OrderShipped $event): void
    {
        OrderSnapshot::where('order_uuid', $event->orderUuid)->update([
            'state' => 'shipped',
            'tracking_number' => $event->trackingNumber,
            'carrier' => $event->carrier,
            'shipped_at' => now(),
        ]);
    }

    public function onOrderCancelled(OrderCancelled $event): void
    {
        OrderSnapshot::where('order_uuid', $event->orderUuid)->update([
            'state' => 'cancelled',
            'cancel_reason' => $event->reason,
            'cancelled_at' => now(),
        ]);
    }
}
```

这样查询订单列表直接走 `OrderSnapshot` 表，性能和传统 CRUD 一致：

```php
// 查询完全不走 Event Store，走快照表
$orders = OrderSnapshot::where('user_id', $userId)
    ->where('state', 'paid')
    ->orderBy('paid_at', 'desc')
    ->paginate(20);
```

## 实战三：Reactor 处理副作用（通知/扣库存）

Reactor 和 Projector 的区别：**Projector 是可重放的**（删掉数据重放事件可以重建），**Reactor 不可重放**（发通知/扣库存只执行一次）。

```php
<?php
// app/Reactors/OrderReactor.php
namespace App\Reactors;

use App\Domain\Order\Events\OrderPaid;
use App\Domain\Order\Events\OrderCancelled;
use App\Domain\Inventory\InventoryAggregateRoot;
use App\Notifications\OrderPaidNotification;
use App\Models\OrderSnapshot;
use Spatie\EventSourcing\EventHandlers\Reactors\Reactor;

class OrderReactor extends Reactor
{
    public function onOrderPaid(OrderPaid $event): void
    {
        // 扣减库存（走库存聚合根，产生库存事件）
        $order = OrderSnapshot::where('order_uuid', $event->orderUuid)->first();
        foreach (json_decode($order->items, true) as $item) {
            InventoryAggregateRoot::retrieve($item['product_id'])
                ->deduct($item['qty'], $event->orderUuid)
                ->persist();
        }

        // 发送通知
        $order->user->notify(new OrderPaidNotification($order));
    }

    public function onOrderCancelled(OrderCancelled $event): void
    {
        // 退还库存
        $order = OrderSnapshot::where('order_uuid', $event->orderUuid)->first();
        foreach (json_decode($order->items, true) as $item) {
            InventoryAggregateRoot::retrieve($item['product_id'])
                ->restore($item['qty'], $event->orderUuid)
                ->persist();
        }
    }
}
```

## 实战四：库存聚合根——防超卖的事件溯源版本

```php
<?php
// app/Domain/Inventory/Events/StockDeducted.php
namespace App\Domain\Inventory\Events;

use Spatie\EventSourcing\StoredEvents\ShouldBeStored;

class StockDeducted extends ShouldBeStored
{
    public function __construct(
        public readonly string $productUuid,
        public readonly int $quantity,
        public readonly string $orderUuid,
    ) {}
}
```

```php
<?php
// app/Domain/Inventory/InventoryAggregateRoot.php
namespace App\Domain\Inventory;

use App\Domain\Inventory\Events\StockDeducted;
use App\Domain\Inventory\Events\StockRestored;
use Spatie\EventSourcing\AggregateRoots\AggregateRoot;

class InventoryAggregateRoot extends AggregateRoot
{
    private int $availableQty = 0;

    public function initialize(int $initialQty): self
    {
        $this->availableQty = $initialQty;
        return $this;
    }

    public function deduct(int $qty, string $orderUuid): self
    {
        if ($qty > $this->availableQty) {
            throw new \DomainException("Insufficient stock: available={$this->availableQty}, requested={$qty}");
        }

        $this->recordThat(new StockDeducted(
            productUuid: $this->uuid(),
            quantity: $qty,
            orderUuid: $orderUuid,
        ));
        return $this;
    }

    public function restore(int $qty, string $orderUuid): self
    {
        $this->recordThat(new StockRestored(
            productUuid: $this->uuid(),
            quantity: $qty,
            orderUuid: $orderUuid,
        ));
        return $this;
    }

    protected function applyStockDeducted(StockDeducted $event): void
    {
        $this->availableQty -= $event->quantity;
    }

    protected function applyStockRestored(StockRestored $event): void
    {
        $this->availableQty += $event->quantity;
    }
}
```

### 回溯库存状态——Event Sourcing 的杀手级功能

```php
// 查看某个商品在某个时间点的库存状态
$aggregate = InventoryAggregateRoot::retrieve($productUuid);

// 获取该聚合根的所有事件
$events = $aggregate->getStoredEvents();

// 过滤出某个时间段的库存变更
$filteredEvents = $events->filter(function ($event) {
    return in_array(class_basename($event->event_class), ['StockDeducted', 'StockRestored'])
        && $event->created_at->between('2026-05-01', '2026-05-05');
});

foreach ($filteredEvents as $event) {
    echo "{$event->created_at} | {$event->event_class} | qty: {$event->event->quantity} | order: {$event->event->orderUuid}\n";
}

// 输出：
// 2026-05-01 10:00 | StockDeducted | qty: 2 | order: ord-001
// 2026-05-02 14:30 | StockDeducted | qty: 5 | order: ord-002
// 2026-05-03 09:00 | StockRestored | qty: 2 | order: ord-001  (用户退货)
```

## 踩坑记录：我们遇到的真实问题

### 踩坑一：事件过多导致重放极慢

**问题**：一个高频商品的库存事件积累了 10 万条，每次 retrieve 要重放全部事件，响应时间 > 5 秒。

**解决**：使用 **Snapshot（快照）** 机制，每 500 个事件自动创建快照：

```php
// 在 AggregateRoot 中配置快照阈值
class InventoryAggregateRoot extends AggregateRoot
{
    // 每 500 个事件创建一次快照
    protected function getSnapshotThreshold(): int
    {
        return 500;
    }
}

// 定时任务：批量为高频聚合根创建快照
php artisan event-sourcing:create-snapshots InventoryAggregateRoot
```

### 踩坑二：Projector 处理失败导致读写不一致

**问题**：订单已支付（事件已写入），但 Projector 更新快照表时数据库连接超时，导致订单状态还是 `pending`。

**解决**：

```php
// 配置 Projector 使用 catch-up 机制
// config/event-sourcing.php
'queue' => 'event-sourcing',  // 用独立队列

// Projector 标记为可 catch-up
class OrderProjector extends Projector
{
    use CatchUp;  // Spatie 提供的 trait，启动时自动追赶未处理事件
}

// 定时任务：确保所有 Projector 同步
php artisan event-sourcing:replay "App\Projectors\OrderProjector"
```

### 踩坑三：事件 Schema 变更后的兼容性

**问题**：`OrderCreated` 事件初期没有 `currency` 字段，后来加上了。旧事件反序列化时报错。

**解决**：使用 **Event Upcaster** 模式：

```php
<?php
// app/Domain/Order/Events/Upcasters/OrderCreatedUpcaster.php
namespace App\Domain\Order\Events\Upcasters;

use Spatie\EventSourcing\EventHandlers\Upcasters\Upcaster;

class OrderCreatedUpcaster extends Upcaster
{
    public function upcast(array $eventAttributes, string $eventClass): array
    {
        if ($eventClass === \App\Domain\Order\Events\OrderCreated::class) {
            // 旧事件没有 currency 字段，给默认值
            if (!isset($eventAttributes['currency'])) {
                $eventAttributes['currency'] = 'TWD';
            }
        }
        return $eventAttributes;
    }
}
```

### 踩坑四：并发写入导致聚合根状态竞争

**问题**：同一订单同时收到支付回调和取消请求，两个聚合根同时重放事件，状态不一致。

**解决**：使用乐观锁——`stored_events` 表的 `aggregate_version` 字段：

```php
// Spatie 默认支持，persist() 时自动检查版本号
// 如果版本冲突，抛出 CouldNotPersistAggregate 异常

// 在 Controller 中捕获并重试
public function handlePaymentCallback(Request $request)
{
    try {
        $this->orderService->payOrder(
            $request->order_uuid,
            $request->payment_method,
            $request->transaction_id,
            $request->amount
        );
    } catch (CouldNotPersistAggregate $e) {
        // 版本冲突，延迟重试
        PayOrderJob::dispatch($request->all())->delay(now()->addSeconds(2));
    }
}
```

## 实战五：Event Sourcing 测试策略

事件溯源的最大优势之一是**确定性重放**——这让测试变得异常简单：

```php
<?php
// tests/Unit/OrderAggregateRootTest.php
namespace Tests\Unit;

use App\Domain\Order\OrderAggregateRoot;
use App\Domain\Order\Events\{OrderCreated, OrderPaid, OrderShipped, OrderCancelled};
use Tests\TestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;

class OrderAggregateRootTest extends TestCase
{
    use RefreshDatabase;

    private array $sampleItems = [
        ['product_id' => 1, 'qty' => 2, 'unit_price' => 1000],
        ['product_id' => 2, 'qty' => 1, 'unit_price' => 3000],
    ];

    /** @test */
    public function it_creates_order_and_records_events(): void
    {
        $uuid = 'test-order-001';
        $aggregate = OrderAggregateRoot::retrieve($uuid)
            ->createOrder($uuid, 1, $this->sampleItems, 'TWD', 5000)
            ->persist();

        // 验证事件流
        $events = OrderAggregateRoot::retrieve($uuid)->getStoredEvents();
        $this->assertCount(1, $events);
        $this->assertInstanceOf(OrderCreated::class, $events->first()->event);
        $this->assertEquals(5000, $events->first()->event->totalAmount);
    }

    /** @test */
    public function it_prevents_payment_on_non_pending_order(): void
    {
        $uuid = 'test-order-002';
        OrderAggregateRoot::retrieve($uuid)
            ->createOrder($uuid, 1, $this->sampleItems, 'TWD', 5000)
            ->persist();
        OrderAggregateRoot::retrieve($uuid)
            ->pay('stripe', 'txn-001', 5000)
            ->persist();

        // 第二次支付应该抛异常
        $this->expectException(\DomainException::class);
        OrderAggregateRoot::retrieve($uuid)
            ->pay('stripe', 'txn-002', 5000)
            ->persist();
    }

    /** @test */
    public function it_can_rebuild_state_from_events(): void
    {
        $uuid = 'test-order-003';

        // 通过多次 retrieve 模拟事件重放
        OrderAggregateRoot::retrieve($uuid)
            ->createOrder($uuid, 1, $this->sampleItems, 'TWD', 5000)
            ->persist();

        // 重新 retrieve —— 状态完全从事件重建
        $restored = OrderAggregateRoot::retrieve($uuid);
        // 内部 state 应该是 'pending'，items 已填充
        // 可以继续正常操作
    }

    /** @test */
    public function it_prevents_cancelling_shipped_order(): void
    {
        $uuid = 'test-order-004';
        OrderAggregateRoot::retrieve($uuid)
            ->createOrder($uuid, 1, $this->sampleItems, 'TWD', 5000)
            ->persist();
        OrderAggregateRoot::retrieve($uuid)
            ->pay('stripe', 'txn-001', 5000)
            ->persist();
        OrderAggregateRoot::retrieve($uuid)
            ->ship('SF12345678', 'sf')
            ->persist();

        $this->expectException(\DomainException::class);
        OrderAggregateRoot::retrieve($uuid)
            ->cancel('changed mind', 1)
            ->persist();
    }
}
```

### 项目结构参考

采用事件溯源后，典型的 Laravel 领域层目录结构：

```
app/
├── Domain/
│   ├── Order/
│   │   ├── OrderAggregateRoot.php
│   │   ├── Events/
│   │   │   ├── OrderCreated.php
│   │   │   ├── OrderPaid.php
│   │   │   ├── OrderShipped.php
│   │   │   ├── OrderCancelled.php
│   │   │   └── Upcasters/
│   │   │       └── OrderCreatedUpcaster.php
│   │   └── Projections/
│   │       └── OrderSnapshot.php
│   └── Inventory/
│       ├── InventoryAggregateRoot.php
│       └── Events/
│           ├── StockDeducted.php
│           └── StockRestored.php
├── Projectors/
│   └── OrderProjector.php
├── Reactors/
│   └── OrderReactor.php
└── Services/
    └── OrderService.php
```

## 何时该用 Event Sourcing，何时不该？

### Event Sourcing vs 传统 CRUD vs Versioned Model 对比

| 维度 | 传统 CRUD | Versioned Model | Event Sourcing |
|------|-----------|----------------|----------------|
| 数据存储 | 当前状态 | 版本快照表 | 事件流 |
| 审计能力 | ❌ 需额外表 | ⚠️ 快照对比 | ✅ 天然完整 |
| 状态回溯 | ❌ 不支持 | ⚠️ 仅快照点 | ✅ 任意时间点 |
| 实现复杂度 | ⭐ 低 | ⭐⭐ 中 | ⭐⭐⭐ 高 |
| 查询性能 | ✅ 最优 | ✅ 优秀 | ⚠️ 需 Projector |
| 存储成本 | ✅ 最低 | ⚠️ 中等 | ❌ 事件累积 |
| 适用团队 | 任何团队 | 2-5 人团队 | 需 DDD 经验 |
| 典型场景 | CMS / 配置 | 博客 / 文章 | 电商 / 金融 |

| 场景 | 推荐方案 | 原因 |
|------|----------|------|
| 订单生命周期 | ✅ Event Sourcing | 状态多、需审计、需回溯 |
| 库存变更追踪 | ✅ Event Sourcing | 金融级准确性要求 |
| 用户偏好设置 | ❌ CRUD | 简单读写，无需审计 |
| 文章/内容管理 | ❌ CRUD | 状态简单，可用 Version 模型 |
| 支付流水 | ✅ Event Sourcing | 合规要求，必须可追溯 |
| 配置管理 | ❌ CRUD | 键值对即可满足 |

**经验法则**：如果你需要回答「这个状态是怎么来的？」，用 Event Sourcing；如果只需要「现在是什么状态？」，用 CRUD。

## 总结

Event Sourcing 在 Laravel B2C 电商中的核心价值：

1. **完整审计链**：每次状态变更都是一个事件，天然满足合规要求
2. **时间旅行**：任意时间点的状态都可以通过重放事件得到
3. **读写分离**：Projector 维护读模型，写入和查询互不干扰
4. **副作用解耦**：Reactor 处理通知/扣库存等副作用，与核心逻辑分离
5. **Bug 回放**：生产环境 Bug 可以在测试环境重放事件复现

但代价也很明显：架构复杂度上升、需要额外维护 Projector/Reactor、事件 Schema 演进需要谨慎处理。**建议从一个限界上下文（如订单或库存）开始试点，而非全盘改造。**

## 相关阅读

- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/00_架构/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/00_架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)
- [Hexagonal Architecture 进阶实战：Laravel 端口与适配器模式——对比 Clean Architecture](/00_架构/2026-06-06-hexagonal-architecture-laravel-port-adapter-clean-architecture/)
- [Server-Driven UI 实战：后端驱动前端渲染——JSON UI 描述协议在 Laravel BFF 中的落地](/00_架构/server-driven-ui-laravel-bff/)
- [Data Mesh 实战：领域数据产品化——Laravel 微服务中的数据所有权联邦治理](/00_架构/2026-06-03-Data-Mesh-实战-领域数据产品化-Laravel-微服务中的数据所有权联邦治理与自助查询层/)

相关包版本：`spatie/laravel-event-sourcing ^7.0` + `Laravel 10.x` + `PHP 8.1+`
