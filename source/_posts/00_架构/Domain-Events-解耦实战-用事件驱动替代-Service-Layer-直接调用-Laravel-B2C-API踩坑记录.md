---
title: Domain-Events-解耦实战-用事件驱动替代-Service-Layer-直接调用-Laravel-B2C-API踩坑记录
date: 2026-05-05 08:20:19
updated: 2026-05-05 08:22:17
categories:
  - 00_架构
  - 05_PHP
tags: [KKday, Laravel, 架构]---

## 前言：Service Layer 胖到什么程度你会考虑重构？

在 KKday B2C Backend 的 30+ 仓库中，我们大量使用 Controller 薄 + Service 厚的模式。这在初期非常高效，但随着业务膨胀，`OrderService::placeOrder()` 方法往往会变成一个 500 行的"上帝方法"——发通知、扣库存、记录积分、更新会员等级、推 Slack 告警、写审计日志，全部揉在一起。

```php
// ❌ 典型的胖 Service：所有副作用耦合在一个方法中
class OrderService
{
    public function placeOrder(CreateOrderDTO $dto): Order
    {
        // 1. 创建订单
        $order = $this->orderRepo->create($dto->toArray());

        // 2. 扣减库存（同步）
        $this->inventoryService->deduct($dto->items);

        // 3. 发送确认邮件（同步）
        $this->mailer->sendOrderConfirmation($order);

        // 4. 更新会员积分（同步）
        $this->memberService->addPoints($order->user_id, $order->total);

        // 5. 推送 Slack 通知（同步）
        $this->slack->notify("#orders", "新订单 #{$order->id}");

        // 6. 写审计日志（同步）
        $this->auditLog->record('order.created', $order);

        // 7. 触发推荐引擎刷新（同步）
        $this->recommendEngine->refreshFor($order->user_id);

        return $order;
    }
}
```

这段代码有三个致命问题：
1. **职责不清**：下单核心逻辑和副作用（通知/日志/积分）完全耦合
2. **难以测试**：测一个下单需要 mock 7 个依赖
3. **扩展困难**：新增一个副作用（比如推 Firebase 通知）就要改 Service 方法

这篇文章记录我们如何用 **Domain Events** 模式将这些副作用从 Service Layer 中剥离，以及在 Laravel 中的真实落地过程。

---

## 架构图：事件驱动前后的对比

```
┌─────────────────────────────────────────────────────────┐
│                    重构前：同步耦合                        │
│                                                         │
│  Controller → OrderService ─┬→ InventoryService         │
│                              ├→ Mailer                   │
│                              ├→ MemberService            │
│                              ├→ Slack                    │
│                              ├→ AuditLog                 │
│                              └→ RecommendEngine          │
│         所有依赖在 Service 中直接注入，紧耦合               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    重构后：事件驱动                        │
│                                                         │
│  Controller → OrderService → OrderPlaced Event          │
│                                    │                    │
│                              Event Dispatcher           │
│                     ┌───────────┼───────────┐           │
│                     ▼           ▼           ▼           │
│              DeductInventory  SendEmail  AddPoints       │
│              LogToAudit       NotifySlack  ...           │
│                                                         │
│         Service 只关心核心逻辑，副作用由 Listener 接管      │
└─────────────────────────────────────────────────────────┘
```

---

## Step 1：定义 Domain Event

在 Laravel 中，Event 本质上是一个普通的 PHP 类（POPO），携带足够的上下文数据。

```php
<?php
// app/Domain/Order/Events/OrderPlaced.php

namespace App\Domain\Order\Events;

use App\Models\Order;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderPlaced
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly Order $order,
        public readonly array $metadata = [], // 额外上下文：来源渠道、设备类型等
    ) {}
}
```

**踩坑 1：Event 不要直接传 Eloquent Model**

`SerializesModels` 会把 Model 序列化成 ID，Listener 反序列化时会重新查询数据库。如果 Model 在 Listener 执行前被删除（比如订单被取消），会抛 `ModelNotFoundException`。

我们的做法：关键字段在构造函数中提取出来：

```php
class OrderPlaced
{
    public readonly int $orderId;
    public readonly int $userId;
    public readonly string $orderNumber;
    public readonly Money $totalAmount;

    public function __construct(Order $order, public readonly array $metadata = [])
    {
        // 立即提取，不再依赖 Model 的延迟加载
        $this->orderId = $order->id;
        $this->userId = $order->user_id;
        $this->orderNumber = $order->order_number;
        $this->totalAmount = Money::of($order->total, $order->currency);
    }
}
```

---

## Step 2：编写 Listener

每个 Listener 只负责一个副作用，遵循单一职责原则。

```php
<?php
// app/Listeners/DeductInventoryOnOrderPlaced.php

namespace App\Listeners;

use App\Domain\Order\Events\OrderPlaced;
use App\Services\InventoryService;
use Illuminate\Contracts\Queue\ShouldQueue;

class DeductInventoryOnOrderPlaced implements ShouldQueue
{
    // 使用队列异步执行，不阻塞下单主流程
    public $queue = 'inventory';
    public $tries = 3;
    public $backoff = [10, 30, 60]; // 指数退避

    public function __construct(
        private InventoryService $inventoryService,
    ) {}

    public function handle(OrderPlaced $event): void
    {
        $this->inventoryService->deductByOrderId($event->orderId);
    }

    // 处理失败时的兜底逻辑
    public function failed(OrderPlaced $event, \Throwable $exception): void
    {
        \Log::critical('Inventory deduction failed', [
            'order_id' => $event->orderId,
            'exception' => $exception->getMessage(),
        ]);

        // 通知运营手动处理
        app(SlackService::class)->notify(
            '#critical',
            "⚠️ 库存扣减失败：订单 #{$event->orderNumber}"
        );
    }
}
```

```php
<?php
// app/Listeners/SendOrderConfirmationEmail.php

namespace App\Listeners;

use App\Domain\Order\Events\OrderPlaced;
use App\Mail\OrderConfirmation;
use Illuminate\Contracts\Queue\ShouldQueue;

class SendOrderConfirmationEmail implements ShouldQueue
{
    public $queue = 'notifications';
    public $tries = 5; // 邮件发送允许更多重试

    public function handle(OrderPlaced $event): void
    {
        \Mail::to($event->metadata['user_email'])
            ->send(new OrderConfirmation($event->orderId, $event->orderNumber));
    }
}
```

```php
<?php
// app/Listeners/AuditOrderCreation.php

namespace App\Listeners;

use App\Domain\Order\Events\OrderPlaced;

class AuditOrderCreation
{
    // 审计日志同步写入，不需要队列
    public function handle(OrderPlaced $event): void
    {
        app('audit')->record('order.created', [
            'order_id' => $event->orderId,
            'user_id' => $event->userId,
            'amount' => $event->totalAmount->getAmount(),
            'channel' => $event->metadata['channel'] ?? 'web',
            'ip' => $event->metadata['ip'] ?? null,
        ]);
    }
}
```

---

## Step 3：注册 Event → Listener 映射

```php
<?php
// app/Providers/EventServiceProvider.php

protected $listen = [
    OrderPlaced::class => [
        DeductInventoryOnOrderPlaced::class,
        SendOrderConfirmationEmail::class,
        UpdateMemberPoints::class,
        RefreshRecommendEngine::class,
        NotifySlackOnHighValueOrder::class, // 只有高价值订单才通知
        AuditOrderCreation::class,
    ],
];
```

**踩坑 2：Listener 的执行顺序**

Laravel 默认按注册顺序执行 Listener。如果你的 Listener 之间有依赖关系（比如必须先扣库存成功才能发确认邮件），需要手动控制：

```php
// 方法 1：在 EventServiceProvider 中指定顺序
protected $listen = [
    OrderPlaced::class => [
        DeductInventoryOnOrderPlaced::class,   // 必须先扣库存
        SendOrderConfirmationEmail::class,      // 扣完才发邮件
    ],
];

// 方法 2（推荐）：用 shouldQueue + 延迟
class SendOrderConfirmationEmail implements ShouldQueue
{
    public $delay = 30; // 延迟 30 秒执行，给库存扣减留时间
}
```

---

## Step 4：重构后的 Service

```php
class OrderService
{
    public function placeOrder(CreateOrderDTO $dto): Order
    {
        return DB::transaction(function () use ($dto) {
            // 1. 核心业务：创建订单
            $order = $this->orderRepo->create([
                'user_id' => $dto->user_id,
                'items' => $dto->items->toArray(),
                'total' => $dto->calculateTotal(),
                'currency' => $dto->currency,
                'status' => OrderStatus::PENDING,
            ]);

            // 2. 发布领域事件（数据库事务提交后才触发）
            OrderPlaced::dispatch($order, [
                'user_email' => $dto->user_email,
                'channel' => $dto->channel,
                'ip' => request()->ip(),
            ]);

            return $order;
        });
    }
}
```

从 7 个依赖注入变成了 0 个——Service 只需要 `OrderRepository` 和事件系统。

**踩坑 3：事务 + 事件的时序问题**

如果你直接在事务内 `dispatch` 事件，队列 Worker 可能在事务 commit 之前就尝试处理事件，导致读到不存在的数据。

```php
// ❌ 危险：事件可能在事务提交前就被 Worker 消费
DB::transaction(function () {
    $order = Order::create([...]);
    OrderPlaced::dispatch($order); // Worker 可能立即执行，但事务还没提交
});

// ✅ 正确：使用 afterCommit
DB::transaction(function () {
    $order = Order::create([...]);
    // Laravel 8.38+ 支持 afterCommit
    event(new OrderPlaced($order)); // 事务提交后才 dispatch
});

// 或者在 Event 中显式标记
class OrderPlaced
{
    use Dispatchable, SerializesModels;
    public bool $afterCommit = true; // 关键！
}
```

---

## 进阶模式：条件化 Listener

不是所有订单都需要触发所有副作用。比如只有高价值订单才推 Slack 通知：

```php
class NotifySlackOnHighValueOrder implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        // 条件判断放在 Listener 内部，Service 不需要知道
        if ($event->totalAmount->isLessThan(Money::of(10000, 'TWD'))) {
            return; // 低于 1 万 TWD 的订单不通知
        }

        app(SlackService::class)->notify('#high-value-orders', sprintf(
            '🎉 高价值订单 #%s，金额：%s %s',
            $event->orderNumber,
            $event->totalAmount->getCurrency()->getCurrencyCode(),
            $event->totalAmount->getAmount(),
        ));
    }
}
```

---

## 与 Service Layer 直接调用的对比

| 维度 | Service 直接调用 | Domain Events |
|------|-----------------|---------------|
| 耦合度 | 高：Service 知道所有副作用 | 低：Service 只发事件 |
| 可测试性 | 需要 mock 7 个依赖 | 只需断言 Event 被 dispatch |
| 扩展性 | 新增副作用改 Service | 新增 Listener 即可 |
| 执行模式 | 同步阻塞 | 可异步（ShouldQueue） |
| 错误隔离 | 一个失败全链路挂 | Listener 互相隔离 |
| 可追溯性 | 差：日志分散 | 好：Event 是天然的审计点 |

```php
// 测试对比：事件驱动的测试更简洁

// ❌ 重构前：mock 大量依赖
public function test_place_order()
{
    $this->mock(InventoryService::class)->expects('deduct')->once();
    $this->mock(Mailer::class)->expects('sendOrderConfirmation')->once();
    $this->mock(MemberService::class)->expects('addPoints')->once();
    $this->mock(SlackService::class)->expects('notify')->once();
    $this->mock(AuditLog::class)->expects('record')->once();
    // ... 每次新增副作用都要改测试
    $this->service->placeOrder($dto);
}

// ✅ 重构后：只断言事件被触发
public function test_place_order_dispatches_event()
{
    Event::fake();

    $order = $this->service->placeOrder($dto);

    Event::assertDispatched(OrderPlaced::class, function ($event) use ($order) {
        return $event->orderId === $order->id;
    });
}
```

---

## 生产环境踩坑记录

### 踩坑 4：Listener 死循环

如果 Listener 内部又触发了相同的事件，会无限循环：

```php
// ❌ 危险示范
class UpdateOrderStats implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        $stats = OrderStats::updateOrCreate([...]);
        // 如果 updateOrCreate 触发了 model saved event，又触发新的 Listener...
    }
}

// ✅ 解法：在 Listener 中使用 withoutEvents
class UpdateOrderStats implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        Order::withoutEvents(function () use ($event) {
            // 禁止 Model Event 在此回调中触发
            $this->updateStats($event);
        });
    }
}
```

### 踩坑 5：队列积压导致用户体验问题

如果库存扣减放在异步队列中，用户下单后可能看到"下单成功"但库存还没扣。竞品此时已经把同一件商品卖出去了。

```php
// 解决方案：关键路径同步，非关键路径异步
class DeductInventoryOnOrderPlaced implements ShouldQueue
{
    // 不要 ShouldQueue！库存扣减必须同步
}

// 只有这些可以异步：
class SendOrderConfirmationEmail implements ShouldQueue {}    // ✅
class NotifySlackOnHighValueOrder implements ShouldQueue {}   // ✅
class RefreshRecommendEngine implements ShouldQueue {}        // ✅
class AuditOrderCreation {}                                    // ✅ 同步也没问题，很快
```

**经验法则**：影响数据一致性的操作（库存/余额/状态变更）同步执行，仅影响用户体验的通知类操作异步执行。

### 踩坑 6：Redis Queue Worker OOM

当事件携带大数组时（比如含 100 个商品的订单），`SerializesModels` 会序列化整个 payload 到 Redis。如果队列积压，Redis 内存会快速膨胀。

```php
// 解法：Event 只传 ID，Listener 自己查询
class OrderPlaced
{
    public function __construct(
        public readonly int $orderId,  // 只传 ID，不传整个 Model
    ) {}
}

class DeductInventoryOnOrderPlaced implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        $order = Order::with('items.product')->find($event->orderId);
        // 在 Listener 内部按需查询
    }
}
```

---

## 何时不该用 Domain Events

事件驱动不是银弹，以下场景不适合：

1. **调用方需要返回值**：比如扣库存需要返回剩余数量来做业务判断
2. **需要严格的执行顺序保证**：事件 dispatch 后无法保证顺序
3. **事务一致性要求极高**：跨 Listener 的回滚很复杂
4. **团队规模小**：两个 Listener 用事件驱动是过度设计

我们的经验：当一个 Service 方法的副作用超过 **4 个**时，就应该考虑用事件来拆分。

---

## 总结

Domain Events 的核心价值不在于技术实现（Laravel 的 Event 系统很成熟），而在于**架构思维的转变**：从"我来做这件事"变成"我宣布发生了这件事，谁关心谁处理"。

在 KKday 30+ 仓库的实践中，我们发现事件驱动最适合的场景是：**订单流程、支付回调、用户状态变更**这类"一个动作触发多个副作用"的业务节点。而像库存扣减、余额变动这种需要强一致性的操作，仍然保持同步调用。

混合使用同步 Service + 异步 Event，才是 Laravel B2C 项目中真正实用的架构模式。
