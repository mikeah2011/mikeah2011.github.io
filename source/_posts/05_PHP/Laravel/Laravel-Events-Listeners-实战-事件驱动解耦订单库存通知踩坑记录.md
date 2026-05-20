---
title: Laravel Events & Listeners 实战：事件驱动解耦订单/库存/通知
date: 2026-05-05 11:55:39
updated: 2026-05-05 11:57:28
categories:
  - PHP
  - Laravel
tags: [KKday, Laravel, 架构]---

## 前言

在 B2C 电商项目中，一个「下单」动作往往牵连大量后续逻辑：扣减库存、发送通知、更新统计、记录日志……如果把这些全部塞进 Controller 或 Service，代码会迅速膨胀成一团难以维护的意大利面。

Laravel 的 Events & Listeners 系统提供了一种优雅的解耦方案。但「优雅」不代表「无脑用」——在 30+ 仓库的实战中，我踩过不少坑。本文从真实项目出发，分享 Events & Listeners 的正确打开方式。

<!-- more -->

## 一、架构全景：Events & Listeners 是什么

```
┌─────────────┐     dispatch      ┌──────────────────┐
│  Service /  │ ──────────────▶   │   Event Object    │
│  Controller │                   │  (OrderPlaced)    │
└─────────────┘                   └────────┬─────────┘
                                           │
                          ┌────────────────┼────────────────┐
                          ▼                ▼                ▼
                   ┌──────────┐    ┌──────────┐    ┌──────────┐
                   │ Listener │    │ Listener │    │ Listener │
                   │ 减库存    │    │ 发通知    │    │ 记日志    │
                   └──────────┘    └──────────┘    └──────────┘
```

核心思想：**发布者不关心谁在监听**。Service 只负责 `dispatch` 一个事件，后续逻辑由各自的 Listener 独立处理。

## 二、定义事件与监听器

### 2.1 创建事件类

```bash
php artisan make:event OrderPlaced
```

```php
// app/Events/OrderPlaced.php
namespace App\Events;

use App\Models\Order;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderPlaced
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly Order $order,
        public readonly string $paymentMethod,
    ) {}
}
```

**关键点**：事件类本质上是一个 DTO（Data Transfer Object），只携带数据，不包含业务逻辑。使用 `readonly` 属性（PHP 8.1+）确保数据不可变。

### 2.2 创建监听器

```bash
php artisan make:listener DeductInventory --event=OrderPlaced
php artisan make:listener SendOrderNotification --event=OrderPlaced
php artisan make:listener RecordOrderLog --event=OrderPlaced
```

```php
// app/Listeners/DeductInventory.php
namespace App\Listeners;

use App\Events\OrderPlaced;
use App\Services\InventoryService;

class DeductInventory
{
    public function __construct(
        private readonly InventoryService $inventoryService,
    ) {}

    public function handle(OrderPlaced $event): void
    {
        foreach ($event->order->items as $item) {
            $this->inventoryService->deduct(
                skuId: $item->sku_id,
                quantity: $item->quantity,
                orderId: $event->order->id,
            );
        }
    }
}
```

```php
// app/Listeners/SendOrderNotification.php
namespace App\Listeners;

use App\Events\OrderPlaced;
use App\Notifications\OrderConfirmationNotification;

class SendOrderNotification
{
    public function handle(OrderPlaced $event): void
    {
        $event->order->user->notify(
            new OrderConfirmationNotification($event->order)
        );
    }
}
```

### 2.3 注册绑定

在 `EventServiceProvider` 中注册映射关系：

```php
// app/Providers/EventServiceProvider.php
protected $listen = [
    OrderPlaced::class => [
        DeductInventory::class,
        SendOrderNotification::class,
        RecordOrderLog::class,
    ],
];
```

> **Laravel 11+**：如果没有 `EventServiceProvider`，可以在 `AppServiceProvider` 的 `boot()` 中使用 `Event::listen()` 注册，或依赖自动发现（监听器类名符合命名规范时自动注册）。

## 三、在 Service 层分发事件

```php
// app/Services/OrderService.php
namespace App\Services;

use App\Events\OrderPlaced;
use App\Models\Order;

class OrderService
{
    public function placeOrder(array $data): Order
    {
        $order = Order::create([
            'user_id' => auth()->id(),
            'total' => $this->calculateTotal($data['items']),
            'status' => 'pending',
        ]);

        // 创建订单明细...

        // 分发事件 —— 不关心谁在监听
        OrderPlaced::dispatch($order, $data['payment_method']);

        return $order;
    }
}
```

## 四、同步 vs 异步：何时用哪个

### 4.1 同步监听器（默认）

默认情况下，Listener 是**同步执行**的。这意味着 `dispatch()` 会等待所有 Listener 执行完毕才返回。

**适用场景**：
- 必须在请求返回前完成的逻辑（如扣减库存）
- 需要保证事务一致性的操作

### 4.2 异步监听器

实现 `ShouldQueue` 接口即可：

```php
// app/Listeners/SendOrderNotification.php
use Illuminate\Contracts\Queue\ShouldQueue;

class SendOrderNotification implements ShouldQueue
{
    public $queue = 'notifications';
    public $tries = 3;
    public $backoff = 60;

    public function handle(OrderPlaced $event): void
    {
        // 这段代码会在队列 worker 中执行
        $event->order->user->notify(
            new OrderConfirmationNotification($event->order)
        );
    }
}
```

### 4.3 实战架构图：同步与异步混合

```
┌─────────────────────────────────────────────────────────┐
│                    OrderService::placeOrder()            │
│                           │                              │
│                    OrderPlaced::dispatch()                │
│                           │                              │
│           ┌───────────────┼───────────────┐              │
│           ▼ (同步)        ▼ (同步)        ▼ (异步队列)    │
│    DeductInventory   RecordOrderLog   SendNotification   │
│    (必须立即完成)    (审计日志)      (邮件/短信/Slack)     │
│                                                          │
│    ◄── 请求等待 ──►  ◄── 请求等待 ──►  ◄── 立即返回 ──►  │
└─────────────────────────────────────────────────────────┘
```

## 五、踩坑记录（血泪教训）

### 踩坑 1：事件中的 Model 序列化陷阱

```php
// ❌ 错误：Listener 实现 ShouldQueue 但事件中传递了闭包
class OrderPlaced
{
    public function __construct(
        public Order $order,  // 队列化时会序列化 Model
    ) {}
}
```

**问题**：当 Listener 是异步队列时，`SerializesModels` 会在序列化时只存储 Model ID，反序列化时重新从数据库查询。如果在分发事件后、Listener 执行前，该 Model 被删除了，会抛出 `ModelNotFoundException`。

**解决方案**：

```php
// ✅ 正确：在 Listener 中处理 Model 不存在的情况
class SendOrderNotification implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        $order = $event->order;

        // 重新加载，确保数据最新
        if (!$order || !$order->exists) {
            logger()->warning('Order not found when processing notification', [
                'order_id' => $event->order->id ?? 'unknown',
            ]);
            return;
        }

        $order->user->notify(new OrderConfirmationNotification($order));
    }

    public function failed(OrderPlaced $event, \Throwable $exception): void
    {
        // 失败时的兜底处理
        logger()->error('Order notification failed', [
            'order_id' => $event->order->id,
            'error' => $exception->getMessage(),
        ]);
    }
}
```

### 踩坑 2：事件监听器的执行顺序

**问题**：如果 `DeductInventory` 和 `SendOrderNotification` 都是同步的，但通知需要包含库存扣减后的结果，顺序就变得重要了。

**解决方案**：使用 `$listen` 中的数组顺序，或通过 `Listener` 的 `$after` 属性：

```php
class SendOrderNotification
{
    public $after = [DeductInventory::class];

    public function handle(OrderPlaced $event): void
    {
        // 此时库存已扣减，可以安全地读取最新状态
    }
}
```

### 踩坑 3：事件中的事务边界

**问题**：如果 `OrderService::placeOrder()` 在一个数据库事务中，事件在事务提交前分发，同步 Listener 中的数据库操作可能读到未提交的数据。

```php
// ❌ 危险：事件在事务内分发
DB::transaction(function () use ($data) {
    $order = Order::create([...]);
    OrderPlaced::dispatch($order);  // Listener 立即执行，可能读到脏数据
});
```

**解决方案**：使用 `afterCommit` 或 `dispatchAfterCommit`：

```php
// ✅ 正确：事务提交后再分发事件
DB::transaction(function () use ($data) {
    $order = Order::create([...]);
    OrderPlaced::dispatch($order)->afterCommit();
});
```

或者在事件类中声明：

```php
class OrderPlaced
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly Order $order,
        public readonly string $paymentMethod,
    ) {
        $this->afterCommit = true;  // 事务提交后再触发
    }
}
```

### 踩坑 4：循环事件导致的无限递归

**问题**：Listener 中修改了 Model，触发了 Model Observer，Observer 又分发了事件……

```php
// ❌ 死循环场景
class DeductInventory
{
    public function handle(OrderPlaced $event): void
    {
        // 更新库存 → 触发 Inventory Observer → Observer 又触发事件 → 💥
        $event->order->items->each(function ($item) {
            $item->sku->decrement('stock', $item->quantity);
        });
    }
}
```

**解决方案**：使用 `withoutEvents()` 或在 Observer 中加守卫条件：

```php
// ✅ 安全操作，避免触发 Observer
Inventory::withoutEvents(function () use ($event) {
    foreach ($event->order->items as $item) {
        DB::table('inventories')
            ->where('sku_id', $item->sku_id)
            ->decrement('stock', $item->quantity);
    }
});
```

### 踩坑 5：测试中的事件干扰

**问题**：单元测试时，不希望真的发送通知或扣减库存。

```php
// ✅ 测试中使用 Event Fake
public function test_order_placement(): void
{
    Event::fake([OrderPlaced::class]);

    $response = $this->postJson('/api/orders', [...]);

    $response->assertStatus(201);
    Event::assertDispatched(OrderPlaced::class, function ($event) {
        return $event->order->total === 199.00;
    });

    // 验证 Listener 没有真正执行（通知没发、库存没减）
    Event::assertNothingDispatched(SendOrderNotification::class);
}
```

## 六、Events vs Observers vs 直接调用：如何选择

| 维度 | Events & Listeners | Observers | Service 直接调用 |
|------|-------------------|-----------|-----------------|
| 触发时机 | 任意业务点 | Model 生命周期（created/updated/deleted） | 代码执行到该行时 |
| 解耦程度 | 高（发布者不关心监听者） | 中（绑定在 Model 上） | 低（直接依赖） |
| 可测试性 | 高（可 Fake） | 中 | 低 |
| 适用场景 | 跨模块业务事件 | 单模型的 CRUD 前后钩子 | 强耦合的业务流程 |
| 典型案例 | 下单→减库存/发通知/记日志 | 用户创建→初始化配置 | 创建订单→立即生成明细 |

**我的经验法则**：
- 涉及 **多个模块/领域** 的后续逻辑 → Events & Listeners
- 只涉及 **单个 Model 的生命周期** → Observers
- **强耦合、必须同步返回结果** → 直接调用

## 七、生产环境的最佳实践

### 7.1 事件命名规范

```php
// ✅ 动词过去式，明确表示「已发生」
OrderPlaced::class
PaymentCompleted::class
InventoryDeducted::class

// ❌ 避免模糊命名
OrderEvent::class      // 什么事件？
ProcessOrder::class    // 听起来像命令
```

### 7.2 监听器职责单一

```php
// ❌ 一个 Listener 做太多事
class HandleOrderPlaced
{
    public function handle(OrderPlaced $event): void
    {
        $this->deductInventory($event);
        $this->sendNotification($event);
        $this->recordLog($event);
        $this->updateStats($event);
    }
}

// ✅ 每个 Listener 只做一件事
class DeductInventory { /* 只管扣库存 */ }
class SendOrderNotification { /* 只管发通知 */ }
class RecordOrderLog { /* 只管记日志 */ }
class UpdateOrderStats { /* 只管更新统计 */ }
```

### 7.3 使用 EventSubscriber 集中管理

```php
// app/Listeners/OrderEventSubscriber.php
class OrderEventSubscriber
{
    public function handleOrderPlaced(OrderPlaced $event): void { /* ... */ }
    public function handleOrderCancelled(OrderCancelled $event): void { /* ... */ }

    public function subscribe(Dispatcher $events): array
    {
        return [
            OrderPlaced::class => 'handleOrderPlaced',
            OrderCancelled::class => 'handleOrderCancelled',
        ];
    }
}
```

## 总结

Laravel Events & Listeners 不是银弹，但在正确的场景下，它是解耦复杂业务逻辑的利器。关键原则：

1. **事件只携带数据**，不包含业务逻辑
2. **同步与异步要分清**：库存扣减必须同步，通知可以异步
3. **注意事务边界**：使用 `afterCommit` 避免脏读
4. **防止循环依赖**：`withoutEvents()` 是安全阀
5. **测试时用 `Event::fake()`**，隔离外部副作用

在 B2C 电商的订单流中，一个 `OrderPlaced` 事件可以优雅地串联起库存、通知、日志、统计等多个模块，而 Service 层只需要一行 `dispatch()`。这才是事件驱动的真正价值。
