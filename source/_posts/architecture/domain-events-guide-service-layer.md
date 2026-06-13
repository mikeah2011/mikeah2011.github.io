---
title: Domain-Events-解耦实战-用事件驱动替代-Service-Layer-直接调用-Laravel-B2C-API踩坑记录
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-05 08:20:19
updated: 2026-05-05 08:22:17
categories:
  - architecture
  - ddd
tags: [DDD, Domain-Events, Laravel, 微服务, 架构]
keywords: [Domain, Events, Service, Layer, Laravel, B2C, API, 解耦实战, 用事件驱动替代, 直接调用]
description: 在 30+ 仓库的 Laravel B2C 项目中，Service Layer 膨胀是常见问题。本文详解如何用 Domain Events 替代 Service Layer 直接调用，实现订单、库存、通知的彻底解耦。包含完整重构代码对比、事件版本控制、生产踩坑（事件顺序/死信/调试）与 Pest 测试实战。



---

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

## 完整重构对比：胖 Service vs Domain Events

以下是一个真实的 B2C 订单场景，展示从 500 行的"上帝方法"到事件驱动架构的完整重构过程。

### 重构前：胖 Service（约 120 行核心方法）

```php
<?php
// app/Services/OrderService.php —— 所有副作用耦合在一起

namespace App\Services;

use App\Models\Order;
use App\DTOs\CreateOrderDTO;
use App\Services\InventoryService;
use App\Services\MemberService;
use App\Services\SlackService;
use App\Services\AuditLogService;
use App\Services\RecommendEngine;
use App\Services\FirebasePushService;
use App\Mail\OrderConfirmation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class OrderService
{
    public function __construct(
        private InventoryService $inventoryService,
        private MemberService $memberService,
        private SlackService $slack,
        private AuditLogService $auditLog,
        private RecommendEngine $recommendEngine,
        private FirebasePushService $firebase,
    ) {}

    public function placeOrder(CreateOrderDTO $dto): Order
    {
        return DB::transaction(function () use ($dto) {
            // 核心：创建订单
            $order = Order::create([
                'user_id'    => $dto->user_id,
                'order_number' => 'ORD-' . uniqid(),
                'total'      => $dto->calculateTotal(),
                'currency'   => $dto->currency,
                'status'     => 'pending',
            ]);

            // 副作用 1：扣减库存
            $this->inventoryService->deduct($dto->items);

            // 副作用 2：发送确认邮件
            Mail::to($dto->user_email)->send(new OrderConfirmation($order));

            // 副作用 3：更新会员积分
            $this->memberService->addPoints($order->user_id, $order->total);

            // 副作用 4：高价值订单通知 Slack
            if ($order->total >= 10000) {
                $this->slack->notify('#high-value-orders', "高价值订单 #{$order->order_number}");
            }

            // 副作用 5：审计日志
            $this->auditLog->record('order.created', [
                'order_id' => $order->id,
                'user_id'  => $order->user_id,
                'amount'   => $order->total,
                'ip'       => request()->ip(),
            ]);

            // 副作用 6：推荐引擎刷新
            $this->recommendEngine->refreshFor($order->user_id);

            // 副作用 7：Firebase 推送
            $this->firebase->send($dto->user_id, '下单成功', "订单 {$order->order_number}");

            return $order;
        });
    }
}
```

**问题清单**：
- 构造函数注入 6 个依赖，测试时需要全部 mock
- 每新增一个副作用（如微信通知），必须修改 `placeOrder()` 方法并同步修改测试
- 库存扣减失败会回滚整个事务，导致审计日志和通知丢失
- 所有操作同步执行，下单响应时间 = 所有副作用耗时之和

### 重构后：Domain Events 驱动

```php
<?php
// app/Services/OrderService.php —— 只保留核心逻辑

namespace App\Services;

use App\Domain\Order\Events\OrderPlaced;
use App\DTOs\CreateOrderDTO;
use App\Models\Order;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function __construct(
        private OrderRepository $orderRepo,
    ) {}

    public function placeOrder(CreateOrderDTO $dto): Order
    {
        return DB::transaction(function () use ($dto) {
            $order = $this->orderRepo->create([
                'user_id'      => $dto->user_id,
                'order_number' => 'ORD-' . uniqid(),
                'total'        => $dto->calculateTotal(),
                'currency'     => $dto->currency,
                'status'       => 'pending',
            ]);

            // 一行代码，所有副作用由 Listener 接管
            OrderPlaced::dispatch($order, [
                'user_email' => $dto->user_email,
                'channel'    => $dto->channel,
                'ip'         => request()->ip(),
            ]);

            return $order;
        });
    }
}

// app/Listeners/DeductInventoryOnOrderPlaced.php
class DeductInventoryOnOrderPlaced implements ShouldQueue
{
    public $queue = 'inventory';
    public $tries = 3;
    public $backoff = [10, 30, 60];

    public function handle(OrderPlaced $event): void
    {
        $order = Order::with('items.product')->find($event->orderId);
        app(InventoryService::class)->deduct($order->items);
    }
}

// app/Listeners/UpdateMemberPointsOnOrderPlaced.php
class UpdateMemberPointsOnOrderPlaced implements ShouldQueue
{
    public $queue = 'members';

    public function handle(OrderPlaced $event): void
    {
        app(MemberService::class)->addPoints($event->userId, $event->totalAmount->getAmount());
    }
}

// app/Listeners/NotifyFirebaseOnOrderPlaced.php
class NotifyFirebaseOnOrderPlaced implements ShouldQueue
{
    public $queue = 'notifications';

    public function handle(OrderPlaced $event): void
    {
        app(FirebasePushService::class)->send(
            $event->userId, '下单成功', "订单 {$event->orderNumber}"
        );
    }
}
```

**重构收益对比**：

| 指标 | 重构前 | 重构后 |
|------|--------|--------|
| Service 依赖数 | 6 个 | 1 个（Repository） |
| Service 方法行数 | ~120 行 | ~20 行 |
| 新增副作用改动 | 改 Service + 改测试 | 新增 Listener 文件即可 |
| 测试 mock 数量 | 6 个 | 0 个（断言 Event） |
| 库存失败影响 | 回滚整笔事务 | 仅库存 Listener 失败，邮件/积分不受影响 |

---

## 事件模式横向对比：Domain Events vs Observer vs Event Sourcing vs CQRS

很多团队在选型时会混淆这四种模式。它们都涉及"事件"，但解决的问题完全不同：

| 维度 | Domain Events | Observer Pattern | Event Sourcing | CQRS |
|------|--------------|-----------------|----------------|------|
| **核心思想** | 领域层发布事件，解耦副作用 | Model 生命周期钩子 | 状态 = 事件序列的重放 | 读写分离独立模型 |
| **耦合方向** | Service → Event（松耦合） | Model → Observer（中耦合） | 无状态存储，只有事件流 | Command Model ≠ Query Model |
| **典型场景** | 订单下单后通知/积分/日志 | User::created 后发欢迎邮件 | 金融系统审计追溯 | 高并发读写分离 |
| **Laravel 实现** | `Event::dispatch()` + Listener | `$dispatchesEvents` + Observer | 需自建 Event Store | 独立 Read/Write Repository |
| **时间旅行** | ❌ 不支持 | ❌ 不支持 | ✅ 核心能力 | ❌ 不支持 |
| **查询优化** | ❌ 不直接优化 | ❌ 不直接优化 | ❌ 读性能差 | ✅ 核心能力 |
| **实现复杂度** | ⭐⭐ 低 | ⭐ 最低 | ⭐⭐⭐⭐⭐ 很高 | ⭐⭐⭐ 中等 |
| **适用团队** | 3+ 人中型团队 | 任何规模 | 有领域专家的成熟团队 | 高并发场景团队 |

**选型建议**：

- **刚起步**：先用 Observer 处理 Model 级别的简单钩子
- **副作用超过 4 个**：升级到 Domain Events，把副作用从 Service 中剥离
- **需要审计追溯 / 金融合规**：引入 Event Sourcing（但成本很高，慎用）
- **读写比例 10:1 以上**：CQRS 分离查询模型，配合投影表优化读性能

> 💡 这四种模式并不互斥。一个系统可以同时使用 Domain Events（解耦副作用）+ CQRS（读写分离）+ Event Sourcing（审计追溯）。关键是按需引入，不要过度设计。

---

## Event 版本控制与向后兼容

在长期维护的项目中，Event 的 schema 会随业务迭代而变化。如果处理不当，新旧版本的 Listener 可能互相冲突。

### 场景：OrderPlaced 新增 `coupon_id` 字段

```php
// V1：原始版本
class OrderPlaced
{
    public function __construct(
        public readonly int $orderId,
        public readonly int $userId,
        public readonly string $orderNumber,
        public readonly Money $totalAmount,
    ) {}
}

// V2：新增优惠券字段 —— 如何向后兼容？
class OrderPlaced
{
    public const VERSION = 2;

    public function __construct(
        public readonly int $orderId,
        public readonly int $userId,
        public readonly string $orderNumber,
        public readonly Money $totalAmount,
        public readonly ?int $couponId = null, // 可选字段，默认 null
    ) {}
}
```

### 版本控制最佳实践

1. **新增字段用可选参数**：`?int $couponId = null` 保证 V1 Listener 不会报错
2. **不删除旧字段**：如果需要废弃字段，标记 `@deprecated` 并保留至少 2 个版本周期
3. **Event 中携带版本号**：便于 Listener 做条件分支
4. **队列中的持久化事件**：如果使用 `ShouldQueue`，队列中可能残留旧版本事件，Listener 必须能处理旧格式

```php
// Listener 中的版本兼容写法
class ApplyCouponOnOrderPlaced implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        // V1 事件没有 couponId，直接跳过
        if (!isset($event->couponId) || $event->couponId === null) {
            return;
        }

        $this->couponService->markUsed($event->couponId, $event->orderId);
    }
}
```

5. **Consumer-Driven Contract**：在 CI 中用 Pact 等工具验证 Event Producer 和 Consumer 的兼容性

---

## 生产环境三大陷阱与解决方案

### 陷阱一：事件顺序不可控导致数据不一致

**问题**：用户下单后连续触发 `OrderPlaced` → `OrderPaid`，但队列 Worker 并发处理，可能导致 `OrderPaid` 先于 `OrderPlaced` 被消费。

```php
// ❌ 两个事件可能乱序到达
OrderPlaced::dispatch($order);
OrderPaid::dispatch($order); // 可能先被 Worker 消费
```

**解决方案**：

```php
// 方案 A：关键路径同步，非关键路径异步
class OrderService
{
    public function placeOrder(CreateOrderDTO $dto): Order
    {
        $order = $this->createOrder($dto);

        // 同步 dispatch：保证在当前请求内执行完毕
        event(new OrderPlaced($order)); // Listener 实现 ShouldQueue = 异步，不实现 = 同步

        return $order;
    }

    public function markPaid(Order $order): void
    {
        $order->update(['status' => 'paid']);

        // 使用 Redis Stream 或 Kafka 保证同一订单的事件有序
        // Laravel 的 Queue 不保证顺序，需要消息队列层面解决
        event(new OrderPaid($order));
    }
}

// 方案 B：对同一聚合根的事件使用同一队列 + 单一消费者
class OrderPlaced implements ShouldQueue
{
    public $queue = 'order-events'; // 所有订单事件进同一队列
}

class OrderPaid implements ShouldQueue
{
    public $queue = 'order-events'; // 保证同一队列内的 FIFO
}

// 消费者配置：单 Worker + 单进程处理 order-events 队列
// php artisan queue:work --queue=order-events --max-jobs=1
```

### 陷阱二：死信队列（Dead Letter Queue）与事件丢失

**问题**：Listener 重试 3 次后仍失败，事件被丢弃。如果是库存扣减这种关键事件，数据就永久不一致了。

```php
// ❌ 默认行为：重试失败后事件消失
class DeductInventoryOnOrderPlaced implements ShouldQueue
{
    public $tries = 3;

    public function failed(OrderPlaced $event, \Throwable $e): void
    {
        // 只记了日志，没有补偿机制
        Log::critical('Inventory deduction failed', ['order_id' => $event->orderId]);
    }
}
```

**解决方案：Dead Letter Queue + 补偿机制**

```php
// config/queue.php — 配置 Dead Letter Queue
'redis' => [
    'driver' => 'redis',
    'queue'  => 'default',
    'retry_after' => 90,
    'dead_letter_queue' => 'dead-letter', // 重试耗尽后转入
],

// app/Jobs/ProcessDeadLetterJob.php — 定时扫描死信队列
class ProcessDeadLetterJob implements ShouldQueue
{
    public $queue = 'dead-letter-processor';

    public function handle(): void
    {
        // 从死信队列取出事件，尝试恢复或告警
        while ($payload = Redis::lpop('queues:dead-letter')) {
            $event = unserialize($payload);

            // 尝试重新 dispatch（最多再试 2 次）
            if ($this->shouldRetry($event)) {
                event($event);
            } else {
                // 彻底失败，通知人工介入
                app(SlackService::class)->notify('#dead-letters', sprintf(
                    '❌ 事件 %s 处理失败，需人工介入。数据: %s',
                    get_class($event),
                    json_encode($event),
                ));
            }
        }
    }
}

// 在 app/Console/Kernel.php 中注册定时任务
$schedule->call(new ProcessDeadLetterJob)->everyFiveMinutes();
```

**更优雅的方案**：使用 Laravel 的 `failed_jobs` 表 + 自定义 Failed Job Provider：

```bash
# 查看所有失败的事件
php artisan queue:failed

# 重试特定失败事件
php artisan queue:retry 5

# 重试所有失败事件
php artisan queue:retry all
```

### 陷阱三：调试困难 —— "这个数据是谁改的？"

**问题**：传统 Service 调用可以在方法入口加断点，但事件驱动后，数据变更分散在多个 Listener 中，出了 bug 很难追踪。

**解决方案**：

```php
// 方案 1：Event 中携带 trace_id，贯穿所有 Listener
class OrderPlaced
{
    public readonly string $traceId;

    public function __construct(
        public readonly int $orderId,
        // ...
    ) {
        $this->traceId = app('request')->header('X-Trace-Id')
            ?? uniqid('evt-');
    }
}

// 所有 Listener 记录 trace_id
class DeductInventoryOnOrderPlaced implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        Log::info('Deducting inventory', [
            'trace_id' => $event->traceId,
            'order_id' => $event->orderId,
        ]);
        // ...
    }
}

// 方案 2：使用 Laravel Telescope（开发环境）
// Telescope 会自动记录所有 Event 的 dispatch 和 listen，可视化查看事件链路
// composer require laravel/telescope --dev

// 方案 3：自定义 Event Dispatcher 装饰器，记录所有事件的 dispatch 时间和 Listener 执行耗时
class LoggingEventDispatcher extends Dispatcher
{
    public function dispatch($event, $payload = [], $halt = false)
    {
        $start = microtime(true);
        $result = parent::dispatch($event, $payload, $halt);
        $elapsed = microtime(true) - $start;

        Log::debug('Event dispatched', [
            'event'    => is_object($event) ? get_class($event) : $event,
            'elapsed'  => round($elapsed * 1000, 2) . 'ms',
            'halted'   => $halt,
        ]);

        return $result;
    }
}
```

---

## 测试 Domain Events：Pest / PHPUnit 实战

事件驱动架构的测试优势在于：**Service 测试只关注核心逻辑，Listener 测试只关注单一副作用**。以下是完整的测试策略。

### 测试 1：Service 层 —— 断言 Event 被正确 dispatch

```php
<?php
// tests/Feature/OrderServiceTest.php

use App\Domain\Order\Events\OrderPlaced;
use App\Services\OrderService;
use App\DTOs\CreateOrderDTO;
use Illuminate\Support\Facades\Event;

// Pest 语法
it('dispatches OrderPlaced event when order is created', function () {
    Event::fake();

    $dto = CreateOrderDTO::from([
        'user_id'    => 1,
        'items'      => [['product_id' => 100, 'qty' => 2]],
        'currency'   => 'TWD',
        'user_email' => 'test@example.com',
        'channel'    => 'web',
    ]);

    $order = app(OrderService::class)->placeOrder($dto);

    // 断言：Event 被 dispatch 且携带正确的数据
    Event::assertDispatched(OrderPlaced::class, function (OrderPlaced $event) use ($order) {
        return $event->orderId === $order->id
            && $event->userId === 1
            && $event->totalAmount->getAmount() === $order->total;
    });

    // 断言：只 dispatch 了一次
    Event::assertDispatchedTimes(OrderPlaced::class, 1);
});

it('does not dispatch event when order creation fails', function () {
    Event::fake();

    $dto = CreateOrderDTO::from([
        'user_id' => 99999, // 不存在的用户
        'items'   => [],
    ]);

    try {
        app(OrderService::class)->placeOrder($dto);
    } catch (\Throwable $e) {
        // 预期失败
    }

    Event::assertNotDispatched(OrderPlaced::class);
});
```

### 测试 2：Listener 层 —— 隔离测试每个副作用

```php
<?php
// tests/Unit/Listeners/DeductInventoryOnOrderPlacedTest.php

use App\Domain\Order\Events\OrderPlaced;
use App\Listeners\DeductInventoryOnOrderPlaced;
use App\Services\InventoryService;
use Mockery;

it('deducts inventory when OrderPlaced event is handled', function () {
    // 构造事件（不需要真实数据库）
    $event = new OrderPlaced(
        orderId: 123,
        userId: 1,
        orderNumber: 'ORD-001',
        totalAmount: Money::of(5000, 'TWD'),
    );

    // Mock 依赖
    $inventoryService = Mockery::mock(InventoryService::class);
    $inventoryService->shouldReceive('deductByOrderId')
        ->once()
        ->with(123);

    // 直接实例化 Listener 并调用 handle
    $listener = new DeductInventoryOnOrderPlaced($inventoryService);
    $listener->handle($event);
});
```

### 测试 3：条件化 Listener —— 只对高价值订单触发

```php
<?php
// tests/Unit/Listeners/NotifySlackOnHighValueOrderTest.php

use App\Domain\Order\Events\OrderPlaced;
use App\Listeners\NotifySlackOnHighValueOrder;
use Illuminate\Support\Facades\Http;

it('sends Slack notification for orders over 10000 TWD', function () {
    Http::fake();

    $event = new OrderPlaced(
        orderId: 456,
        userId: 1,
        orderNumber: 'ORD-002',
        totalAmount: Money::of(15000, 'TWD'),
    );

    $listener = new NotifySlackOnHighValueOrder();
    $listener->handle($event);

    Http::assertSent(function ($request) {
        return $request->url() === 'https://hooks.slack.com/...'
            && str_contains($request->body(), '高价值订单');
    });
});

it('does not send Slack notification for low-value orders', function () {
    Http::fake();

    $event = new OrderPlaced(
        orderId: 789,
        userId: 1,
        orderNumber: 'ORD-003',
        totalAmount: Money::of(500, 'TWD'),
    );

    $listener = new NotifySlackOnHighValueOrder();
    $listener->handle($event);

    Http::assertNothingSent();
});
```

### 测试 4：集成测试 —— 验证 Event → Listener 完整链路

```php
<?php
// tests/Integration/OrderPlacedEventTest.php

use App\Domain\Order\Events\OrderPlaced;
use App\Models\Order;
use Illuminate\Support\Facades\Queue;

it('queues all async listeners when OrderPlaced is dispatched', function () {
    Queue::fake();

    $order = Order::factory()->create();
    event(new OrderPlaced($order));

    // 验证异步 Listener 被推入队列
    Queue::assertPushed(\App\Listeners\DeductInventoryOnOrderPlaced::class);
    Queue::assertPushed(\App\Listeners\SendOrderConfirmationEmail::class);
    Queue::assertPushed(\App\Listeners\UpdateMemberPointsOnOrderPlaced::class);
});
```

**测试金字塔建议**：

| 层级 | 测试对象 | 数量 | 工具 |
|------|---------|------|------|
| Unit | Listener 逻辑 | 多（每个 Listener 独立测试） | Mockery + Pest |
| Feature | Service → Event dispatch | 少（只测核心 Service） | Event::fake() |
| Integration | Event → Listener 全链路 | 适量 | Queue::fake() + Database |

---

## 总结

Domain Events 的核心价值不在于技术实现（Laravel 的 Event 系统很成熟），而在于**架构思维的转变**：从"我来做这件事"变成"我宣布发生了这件事，谁关心谁处理"。

在 30+ 仓库的实践中，我们发现事件驱动最适合的场景是：**订单流程、支付回调、用户状态变更**这类"一个动作触发多个副作用"的业务节点。而像库存扣减、余额变动这种需要强一致性的操作，仍然保持同步调用。

**落地 Checklist**：

1. ✅ 先识别"上帝方法"——副作用超过 4 个的 Service 方法
2. ✅ 用 Domain Events 拆分副作用，关键路径同步、非关键路径异步
3. ✅ Event 中携带 trace_id，方便调试
4. ✅ 配置 Dead Letter Queue + 失败告警，防止事件丢失
5. ✅ 写好 Event/Listener 的单元测试，用 Event::fake() 隔离 Service 测试
6. ✅ Event schema 变更时保持向后兼容，新增字段用可选参数

---

## 相关阅读

- [Laravel CQRS 实战：订单查询模型拆分、投影同步与后台列表性能治理](/categories/PHP-Laravel/laravel-cqrs-guide-query/)
- [Laravel + gRPC 微服务通信实战：Proto 定义、Deadline 透传与连接复用](/categories/PHP-Laravel/laravel-grpc-microservicesguide-proto-deadline/)
- [Outbox Pattern 深度实战：保证数据库与消息队列的最终一致性](/categories/Databases/2026-06-06-outbox-pattern-debezium-cdc-polling-transactional-message/)

混合使用同步 Service + 异步 Event，才是 Laravel B2C 项目中真正实用的架构模式。
