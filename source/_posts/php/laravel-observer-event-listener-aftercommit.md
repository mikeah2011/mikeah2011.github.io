---
title: 'Laravel Observer 与 Event Listener 的选型决策：afterCommit 时序、事务边界、队列化监听——为什么 Observer 不总是最佳选择'
date: 2026-06-06 12:00:00
tags: [Laravel, Observer, Event, 设计模式, 事务]
keywords: [Laravel Observer, Event Listener, afterCommit, Observer, 的选型决策, 时序, 事务边界, 队列化监听, 不总是最佳选择, PHP]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: "深度对比 Laravel Observer 与 Event Listener 在事务边界、afterCommit 时序和队列化监听上的本质差异，涵盖脏读陷阱、嵌套触发、Octane 状态泄漏等 15 个真实踩坑案例与决策树，帮助你选型时避免线上事故。"
---


## 前言：一个深夜告警引发的思考

凌晨两点，我被 PagerDuty 叫醒：生产环境的订单状态已经变成 `paid`，但用户支付回调接口返回 500。追查发现，`OrderObserver::updated()` 里发了一条 Slack 通知，通知里读取了 `order.items` 关联数据——但此时数据库事务还没提交，因为整个 `PayOrderService::handle()` 被包在 `DB::transaction()` 里。Observer 在事务内部同步触发，`items` 表的新记录还在未提交状态，读到的是旧数据，导致金额计算错误，通知服务抛异常，异常又回滚了整个事务。用户明明已经付了钱，订单却消失了。

这不是个例。在过去三年审阅 30+ 个 Laravel 仓库的过程中，我发现 Observer 与 Event Listener 的选型错误是线上事故的高频来源。大多数开发者知道两者「都能监听模型事件」，却不清楚它们在**事务边界**、**触发时序**、**队列化行为**上的本质差异。更令人担忧的是，很多技术博客和教程都在教初学者「在 Observer 里发通知」「在 Observer 里同步缓存」，却完全没提到这些操作在事务上下文中的风险。

这篇文章不是又一篇「Observer 怎么用」的入门教程，而是一份面向架构决策的深度选型指南。我会从事务安全的角度出发，详细分析 Observer 和 Event Listener 在不同时序场景下的行为差异，结合 30+ 个真实仓库中踩过的坑，给出一份可落地的选型决策框架。

---

## 一、Observer 与 Event Listener 的基础回顾与对比

在深入陷阱之前，必须先厘清两者的核心机制差异。很多选型错误的根源在于开发者对这两个机制的运行模型理解不够精确。

### 1.1 Observer：模型生命周期的同步监听

Observer 是 Laravel 对观察者模式的直接实现，绑定在单个 Eloquent 模型的生命周期上。它的核心特征是**同步执行且隐式触发**——当你调用 `$order->save()` 时，框架内部自动调用对应的 Observer 方法，你不需要写任何显式的 dispatch 语句。

```php
<?php

namespace App\Observers;

use App\Models\Order;
use Illuminate\Support\Facades\Log;

class OrderObserver
{
    public function created(Order $order): void
    {
        // 每次 Order::create() 成功后同步执行
        // 执行时机：数据库 INSERT 语句执行完毕后，但可能在事务提交前
        activity()->performedOn($order)->log('订单创建');
    }

    public function updated(Order $order): void
    {
        // 每次 $order->update() 或 $order->save() 后触发
        if ($order->wasChanged('status')) {
            activity()->performedOn($order)->log(
                "状态变更: {$order->getOriginal('status')} → {$order->status}"
            );
        }
    }

    public function deleted(Order $order): void
    {
        activity()->performedOn($order)->log('订单删除');
    }
}
```

注册方式有两种——服务提供者显式注册（推荐）和模型属性自动发现。在生产环境中，我强烈推荐显式注册，因为它避免了 Octane 环境下的自动发现问题，也能让代码审阅者一眼看到 Observer 的注册关系：

```php
<?php

// app/Providers/EventServiceProvider.php
public function boot(): void
{
    // 显式注册（推荐，Octane 兼容，代码可追溯）
    \App\Models\Order::observe(\App\Observers\OrderObserver::class);
    
    // 也可用 #[ObservedBy] 属性（Laravel 10+），但需要缓存清除后才能生效
}
```

Observer 支持的生命周期钩子非常完整，覆盖了模型从创建到删除的每个阶段：`creating` → `created` → `updating` → `updated` → `saving` → `saved` → `deleting` → `deleted` → `restoring` → `restored`。其中 `saving` 和 `saved` 在 create 和 update 时都会触发，这是一个常见的踩坑点——很多开发者在 `saved` 和 `created` 中同时写了逻辑，导致同一个 create 操作执行了两次副作用。

### 1.2 Event Listener：应用事件的异步/同步监听

Event 是 Laravel 的事件系统，它的定位比 Observer 更高层：不限于模型事件，任何业务动作都可以 `dispatch()`。事件描述的是**业务语义**（「订单已支付」「用户已注册」），而不是**技术动作**（「模型的 created 钩子触发了」）。

```php
<?php

// 定义事件——它是一个纯粹的数据传输对象
namespace App\Events;

use App\Models\Order;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Broadcasting\InteractsWithSockets;

class OrderPaid
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly Order $order,
        public readonly string $paymentMethod,
        public readonly float $amount,
        public readonly string $transactionId,
    ) {}
}

// 监听器——每个监听器负责一个独立的关注点
namespace App\Listeners;

use App\Events\OrderPaid;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Contracts\Events\ShouldHandleEventsAfterCommit;
use Illuminate\Queue\InteractsWithQueue;

class SendOrderPaidNotification implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    use InteractsWithQueue;

    public $queue = 'notifications';
    public $tries = 3;
    public $backoff = 60;

    public function handle(OrderPaid $event): void
    {
        Notification::send($event->order->user, new OrderPaidNotification($event->order));
    }

    public function failed(OrderPaid $event, \Throwable $exception): void
    {
        Log::error("订单 #{$event->order->id} 支付通知发送失败", [
            'exception' => $exception->getMessage(),
        ]);
    }
}

// 在 Service 中手动触发
OrderPaid::dispatch($order, 'alipay', 99.99, 'txn_abc123');
```

Event Listener 的核心优势在于**显式触发**和**一对多分发**。当你看到 `OrderPaid::dispatch(...)` 这行代码时，你立刻知道这里发出了一个业务事件。你可以在 IDE 中全局搜索 `OrderPaid::dispatch` 或 `event(new OrderPaid` 来找到所有触发点。而 Observer 的触发点藏在 `Order::create()` 内部，你需要先知道「Order 注册了 Observer」这个前提，才能理解代码的完整行为。

### 1.3 一张表看清本质差异

理解两者差异的关键在于把握三个维度：触发方式的显隐性、执行时机的确定性、以及事务上下文的传递方式。

| 维度 | Observer | Event Listener |
|------|----------|----------------|
| **绑定对象** | 单个 Model 的 CRUD 生命周期 | 任意业务动作，不限于模型 |
| **触发方式** | 隐式（Model 方法内部自动触发） | 显式（手动 `dispatch()`/`event()`） |
| **执行时机** | 同步，在 Model 操作的调用栈内 | 可同步、可队列化异步 |
| **事务上下文** | 继承 Model 操作所在的事务 | 默认也在同一事务，但可精细控制 |
| **可队列化** | 不直接支持，需手动 dispatch Job | 原生支持 `ShouldQueue` 接口 |
| **代码可搜索性** | 差，grep 找不到触发点 | 好，`dispatch()` 可全局搜索 |
| **执行顺序控制** | 多 Observer 顺序不确定 | 可在 EventServiceProvider 中显式排列 |
| **适用范围** | 单模型的细粒度副作用 | 跨模型的业务流程编排 |

理解了这些基础差异后，我们来看真正危险的部分——事务边界问题。

---

## 二、afterCommit 时序问题：事务未提交时 Observer 触发的副作用陷阱

这是 Observer 最容易踩、也最致命的坑。在审阅的 30+ 个仓库中，有超过一半存在或曾经存在这个问题。原因很简单：Laravel 官方文档虽然提到了 `ShouldHandleEventsAfterCommit`，但大部分教程和入门指南都没有强调它的重要性。

### 2.1 问题重现

考虑一个典型的电商下单场景。`CreateOrderService` 在一个数据库事务中完成订单创建、库存扣减、明细写入和优惠券核销四个步骤。这四个步骤必须在一个事务中执行，任何一步失败都需要回滚全部操作：

```php
<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Product;
use App\Models\Coupon;
use Illuminate\Support\Facades\DB;

class CreateOrderService
{
    public function handle(array $data): Order
    {
        return DB::transaction(function () use ($data) {
            // 1. 创建订单
            $order = Order::create([
                'user_id' => $data['user_id'],
                'total'   => $data['total'],
                'status'  => 'pending',
            ]);

            // 2. 扣减库存——如果库存不足会抛异常，整个事务回滚
            foreach ($data['items'] as $item) {
                $affected = Product::where('id', $item['product_id'])
                    ->where('stock', '>=', $item['quantity'])
                    ->decrement('stock', $item['quantity']);
                    
                if (!$affected) {
                    throw new InsufficientStockException($item['product_id']);
                }
            }

            // 3. 创建订单明细
            $order->items()->createMany($data['items']);

            // 4. 扣减优惠券
            if ($data['coupon_id'] ?? null) {
                Coupon::where('id', $data['coupon_id'])->update(['used_at' => now()]);
            }

            return $order;
        });
    }
}
```

现在看对应的 Observer。很多开发者的第一反应是在 `created` 方法里发通知、同步缓存、记录日志。看起来很合理，对吧？

```php
<?php

namespace App\Observers;

use App\Models\Order;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Log;

class OrderObserver
{
    public function created(Order $order): void
    {
        // ❌ 致命陷阱：此时事务还没提交！
        //
        // 如果步骤 2（扣减库存）失败导致异常，事务会回滚
        // 但这条 Slack 通知已经发出去了——无法撤回
        // 用户在 Slack 上看到一个「新订单 #12345」的消息
        // 但实际上这个订单已经被回滚了，根本不存在
        Notification::route('slack', config('services.slack.webhook'))
            ->notify(new NewOrderSlackNotification($order));

        // ❌ 更严重的问题：关联数据读取
        // order->items 是在步骤 3 才创建的
        // 而 Observer 在步骤 1（Order::create）之后就触发了
        // 此时 items 表的记录还在未提交状态
        $totalItems = $order->items()->count(); // 返回 0！
        Log::info("新订单 #{$order->id}，共 {$totalItems} 件商品");
        
        // ❌ 如果通知模板依赖 items 数据来计算总价
        // 这里会得到一个总价为 0 的通知，用户看到「订单金额：¥0.00」
    }
}
```

**执行时序图**可以帮助我们直观理解这个问题：

```
DB::transaction 开始
│
├── Order::create()
│   │
│   └── OrderObserver::created() 触发 ← ⚠️ 事务还没提交！
│       ├── 发 Slack 通知 → 已发出，无法撤回
│       ├── 读 order.items → 返回 0 条（还没创建）
│       └── 发送金额为 ¥0 的通知 → 用户困惑
│
├── 扣减库存
│   └── 库存不足 → 抛出 InsufficientStockException
│
├── DB::transaction 回滚 ← 一切都回滚了，但通知已经发出
│
└── 用户收到 500 错误 + Slack 上收到一个不存在的订单通知
```

### 2.2 afterCommit 解决方案详解

Laravel 提供了 `ShouldHandleEventsAfterCommit` 接口来解决这个问题。实现该接口后，Observer 的所有方法会在最外层事务提交后才执行。如果当前没有活跃事务，方法会立即执行（行为不变）：

```php
<?php

namespace App\Observers;

use App\Models\Order;
use Illuminate\Contracts\Events\ShouldHandleEventsAfterCommit;

class OrderObserver implements ShouldHandleEventsAfterCommit
{
    public function created(Order $order): void
    {
        // ✅ 现在是事务提交后执行的
        // 所有数据库操作已经持久化，可以安全读取
        $order->loadMissing('items.product', 'user');
        
        Notification::route('slack', config('services.slack.webhook'))
            ->notify(new NewOrderSlackNotification($order));

        $totalItems = $order->items->count(); // ✅ 能读到完整数据
        Log::info("新订单 #{$order->id}，共 {$totalItems} 件商品");
    }

    public function updated(Order $order): void
    {
        if ($order->wasChanged('status') && $order->status === 'paid') {
            // ✅ 事务提交后才发送支付确认
            Mail::to($order->user)->send(new OrderPaidMail($order));
        }
    }
}
```

**关键限制**：`ShouldHandleEventsAfterCommit` 是 Observer 级别的，一旦实现，该 Observer 的**所有方法**都会在事务提交后执行。你不能选择让 `created` 延迟而 `updated` 不延迟。如果你有这种需求，应该拆分成两个 Observer，或者改用 Event Listener。

另一个重要细节：如果你的 Observer 需要在事务内做一些记录性操作（比如审计日志，需要和业务数据在同一个事务中，失败一起回滚），同时又需要在事务后做一些通知性操作（比如发邮件，不能因为回滚而发出去），那你需要将这两种关注点分开处理——要么拆成两个 Observer，要么用 Observer + Event 的组合模式。

### 2.3 Event Listener 的 afterCommit 控制更灵活

Event Listener 在事务控制上提供了远比 Observer 更精细的能力。每个 Listener 可以独立决定自己是在事务内执行还是事务后执行：

```php
<?php

// 在 EventServiceProvider 中，同一个事件的多个 Listener 可以有不同的事务策略
protected $listen = [
    OrderCreated::class => [
        WriteAuditLog::class,              // 不实现 afterCommit → 事务内同步执行
        SendNotification::class,           // 实现 afterCommit → 事务提交后执行
        SyncToElasticsearch::class,        // 实现 afterCommit + ShouldQueue → 事务提交后入队
    ],
];
```

```php
<?php

// 审计日志——在事务内执行，失败一起回滚
class WriteAuditLog
{
    public function handle(OrderCreated $event): void
    {
        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id'   => $event->order->getKey(),
            'event'          => 'created',
            'new_values'     => $event->order->getAttributes(),
        ]);
        // 如果事务回滚，这条审计日志也会回滚——这是正确的行为
        // 审计日志应该和业务数据保持一致性
    }
}

// 通知——事务提交后执行，避免发出无效通知
class SendNotification implements ShouldHandleEventsAfterCommit
{
    public function handle(OrderCreated $event): void
    {
        Notification::send(
            $event->order->user,
            new OrderCreatedNotification($event->order)
        );
    }
}

// ES 同步——事务提交后入队，异步执行
class SyncToElasticsearch implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderCreated $event): void
    {
        $event->order->searchable();
    }
}
```

这种精细控制是 Observer 无法提供的。Observer 要么全延迟，要么全不延迟。而 Event Listener 可以让同一个事件的不同处理者各自选择最合适的事务策略。

### 2.4 DB::afterCommit 的兜底方案

无论 Observer 还是 Event Listener，在某些极端场景下你可能需要手动控制事务边界。`DB::afterCommit()` 是一个底层 API，它将闭包推迟到最外层事务提交后执行：

```php
<?php

public function created(Order $order): void
{
    // 手动将某个特定操作推迟到事务提交后
    // 这在你需要 Observer 的大部分方法在事务内执行、但某个特定操作需要延迟时很有用
    DB::afterCommit(function () use ($order) {
        // 这段代码在最外层事务提交后执行
        // 如果当前没有活跃事务，立即执行
        Cache::forget("user_orders_{$order->user_id}");
        event(new OrderCreated($order));
    });
    
    // 审计日志仍然在事务内执行
    AuditLog::create([...]);
}
```

`DB::afterCommit()` 的一个好处是它不依赖于接口实现，可以在任何地方使用。但坏处是它让代码的事务行为变得不透明——你必须仔细阅读代码才能知道哪些操作在事务内、哪些在事务外。在团队协作中，这种隐式的控制方式容易造成维护混乱。

---

## 三、事务边界问题：Observer 中读取未提交数据的风险

除了「发出去的通知撤不回来」这种明显的副作用问题，还有一类更隐蔽的陷阱：Observer 在事务内读取的数据可能不是最终一致的状态。

### 3.1 脏读陷阱：基于未提交数据做决策

在事务内部，Observer 可以看到当前事务中已经执行的变更（通过 Eloquent 的内存状态），但看不到其他并发事务的未提交变更。更危险的是，Observer 可能基于一个「半成品」的状态做决策：

```php
<?php

namespace App\Observers;

use App\Models\Product;
use Illuminate\Support\Facades\Cache;

class ProductObserver
{
    public function updated(Product $product): void
    {
        // ❌ 陷阱：product->stock 是内存中的新值（已减 1）
        // 但数据库中的实际值取决于事务是否提交
        //
        // 场景：秒杀商品，库存从 5 减到 4
        // Observer 里看到 stock=4，认为还有余量，不做任何处理
        // 但后续步骤失败，事务回滚，实际库存还是 5
        // Observer 基于错误的 stock=4 做了决策，错过了低库存预警
        if ($product->stock < 10) {
            $this->notifyLowStock($product);
        }
        
        // ❌ 更隐蔽的问题：并发场景
        // 事务 A 把库存从 10 减到 9（未提交）
        // 事务 B 也把库存从 10 减到 9（未提交）
        // 两个事务都读到 stock=9，都认为还有余量
        // 但实际库存只有 8（两笔各扣 1）
        // 这就是经典的「丢失更新」问题在 Observer 中的体现
    }
}
```

### 3.2 关联数据不一致

更隐蔽的问题是跨表关联数据的读取。Observer 的触发时机取决于它绑定的是哪个钩子——`created` 在 INSERT 之后触发，但此时事务中后续的操作（比如创建关联数据）可能还没执行：

```php
<?php

class OrderObserver
{
    public function created(Order $order): void
    {
        // ❌ order->items 在同一事务中可能还没创建
        // Order::create() 触发了 Observer，但 createMany 是后面才执行的
        $items = $order->items; // 空集合
        
        // ❌ 更危险：跨模型关联
        // shipping_addresses 表的记录可能还在未提交状态
        $address = $order->shippingAddress; // null
        
        // 结果：发送的通知中缺少关键信息
        // 「您的订单已创建，收货地址：无，商品明细：无」
        $this->sendWarehouseNotification($order, $items, $address);
    }
}
```

**解决方案**：使用 `ShouldHandleEventsAfterCommit` 确保在事务提交后再读取数据，或者在 Observer 方法中显式刷新关联关系：

```php
<?php

class OrderObserver implements ShouldHandleEventsAfterCommit
{
    public function created(Order $order): void
    {
        // ✅ afterCommit 后再读，确保数据已提交且完整
        $order->loadMissing('items.product', 'shippingAddress', 'user');
        $this->sendWarehouseNotification($order);
    }
}
```

### 3.3 并发事务的隔离级别影响

在 MySQL 的默认隔离级别（REPEATABLE READ）下，事务内的读取看到的是事务开始时的一致性快照。这意味着即使其他事务已经提交了新数据，当前事务中的 Observer 也看不到。这在需要跨事务协调的场景下会导致问题：

```php
<?php

// 场景：并发下单
// 用户 A 在 T1 时刻创建订单
// 用户 B 在 T2 时刻创建订单（T2 > T1，但 A 的事务还没提交）
// 
// 如果 Observer 里需要查询「当前系统待处理订单数」来做限流决策
// 在 REPEATABLE READ 下，B 的 Observer 看不到 A 的未提交订单
// 限流逻辑基于不完整的数据做判断，可能导致超卖
```

这种问题的解决方案通常不是在 Observer 层面，而是在业务逻辑层面使用悲观锁（`SELECT ... FOR UPDATE`）或乐观锁（版本号机制）。但理解 Observer 在事务内的可见性边界，对于正确设计这些机制至关重要。

---

## 四、队列化监听：ShouldQueue 接口在 Observer vs Event 中的行为差异

队列化是 Laravel 处理耗时操作的标准方式。但 `ShouldQueue` 接口在 Observer 和 Event Listener 中的行为完全不同，这个差异经常被忽略。

### 4.1 Observer 不能直接实现 ShouldQueue

首先要明确一个基本事实：**Observer 类本身不能实现 `ShouldQueue` 接口**。Observer 是一个普通的 PHP 类，不是 Job。它由框架在模型操作的同步调用栈中实例化和调用，没有经过队列的序列化/反序列化流程。

如果你尝试让 Observer 实现 `ShouldQueue`，不会报错，但也不会有任何队列化效果——方法仍然同步执行。这是一个非常具有迷惑性的行为，因为看起来「编译通过了，运行也没报错」，但实际上队列化完全没有生效。

```php
<?php

// ❌ 这不会报错，但也不会队列化——方法仍然同步执行
class OrderObserver implements ShouldQueue
{
    public function created(Order $order): void
    {
        // 这段代码仍然在同步调用栈中执行
        // ShouldQueue 接口对 Observer 类没有实际效果
        Http::post('https://api.external.com/notify', [...]); // 仍然阻塞
    }
}
```

### 4.2 在 Observer 方法内手动 dispatch Job

要让 Observer 触发的操作异步执行，正确做法是在 Observer 方法内部 dispatch 一个独立的 Job：

```php
<?php

class OrderObserver
{
    public function created(Order $order): void
    {
        // ✅ dispatch 独立的 Job，而非让 Observer 自己队列化
        SendOrderCreatedNotificationJob::dispatch($order);
        SyncOrderToElasticsearchJob::dispatch($order);
    }
}
```

**但这引入了一个新问题**：dispatch 的时机。如果 Observer 在事务内触发，`dispatch()` 会在事务提交前就把 Job 放入队列。如果事务最终回滚了，队列中的 Job 仍然存在。消费者 Worker 执行这个 Job 时，会发现对应的订单数据不存在，导致 Job 失败。

虽然 Job 可以配置重试，但「事务回滚 → Job 失败 → 重试 → 还是失败 → 最终进入 failed_jobs 表」这个链路会产生大量噪音，掩盖真正的错误。更重要的是，如果 Job 的逻辑不是幂等的（比如发邮件、扣积分），重试可能导致重复执行。

```php
<?php

class OrderObserver
{
    public function created(Order $order): void
    {
        // ❌ 事务未提交时 Job 已入队
        // 如果事务回滚，Job 消费者找不到这个订单
        SendOrderCreatedNotificationJob::dispatch($order);
    }
}
```

**正确做法**：使用 `afterCommit` 延迟 dispatch 时机：

```php
<?php

class OrderObserver implements ShouldHandleEventsAfterCommit
{
    public function created(Order $order): void
    {
        // ✅ 事务提交后才 dispatch，Job 只在数据真正持久化后才入队
        SendOrderCreatedNotificationJob::dispatch($order);
        SyncOrderToElasticsearchJob::dispatch($order);
    }
}

// 或者在 dispatch 链上指定（Laravel 9+）
class OrderObserver
{
    public function created(Order $order): void
    {
        // ✅ 在 dispatch 时指定 afterCommit
        SendOrderCreatedNotificationJob::dispatch($order)->afterCommit();
    }
}
```

### 4.3 Event Listener 的队列化行为完全符合预期

Event Listener 的队列化是框架原生支持的，行为直觉且可控：

```php
<?php

namespace App\Listeners;

use App\Events\OrderPaid;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Contracts\Events\ShouldHandleEventsAfterCommit;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

class SendOrderPaidNotification implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    use InteractsWithQueue;

    // 队列和重试配置
    public $queue = 'notifications';
    public $tries = 3;
    public $backoff = [60, 300, 900]; // 递增退避：1分钟、5分钟、15分钟

    public function handle(OrderPaid $event): void
    {
        Notification::send(
            $event->order->user,
            new OrderPaidNotification($event->order)
        );
    }

    // Job 失败后的最终处理（重试耗尽后）
    public function failed(OrderPaid $event, \Throwable $exception): void
    {
        Log::error("订单 #{$event->order->id} 支付通知最终发送失败", [
            'exception' => $exception->getMessage(),
            'user_id'   => $event->order->user_id,
        ]);
        
        // 可以写入一个待补偿表，由人工或定时任务处理
        FailedNotification::create([
            'notifiable_type' => 'order_paid',
            'notifiable_id'   => $event->order->id,
            'error'           => $exception->getMessage(),
        ]);
    }
}
```

**关键优势**：当 Listener 同时实现 `ShouldQueue` 和 `ShouldHandleEventsAfterCommit` 时，Laravel 框架会自动确保 Job 在事务提交后才放入队列。你不需要手动写 `DB::afterCommit()` 或 `->afterCommit()`，框架的事件调度器会帮你处理这个时序问题。

### 4.4 队列化行为对比总结

| 场景 | Observer | Event Listener |
|------|----------|----------------|
| 直接队列化 | ❌ 不支持，Observer 不是 Job | ✅ 实现 `ShouldQueue` 即可 |
| 事务内 dispatch | Job 立即入队，回滚后 Job 仍存在 | 同左，需配合 `afterCommit` |
| 事务后 dispatch | 需手动 `DB::afterCommit()` 或 `->afterCommit()` | 实现 `ShouldHandleEventsAfterCommit` 自动处理 |
| 失败重试 | 需要自己写 Job 的 `$tries` 逻辑 | `$tries` + `$backoff` 原生支持 |
| 失败回调 | 需要自己处理 | `failed()` 方法原生支持 |
| 队列指定 | 手动在 Job 中配置 | `$queue` 属性直接配置 |
| 延迟 dispatch | `dispatch()->delay(now()->addMinutes(5))` | Listener 内部用 `dispatch()` 或配置 delay |

---

## 五、性能影响：Observer 的隐式耦合 vs Event 的显式解耦

Observer 和 Event Listener 在性能上的差异不仅仅是「快」和「慢」的问题，更核心的是**可预测性**和**可观测性**的差异。

### 5.1 Observer 的性能陷阱：批量操作

Observer 最大的性能问题来自**隐式触发**——你调用一个看起来很简单的 `create()` 或 `update()`，背后可能触发了一连串你没注意到的 Observer 逻辑。

批量操作是这个陷阱的重灾区。Laravel 提供了两种批量写入方式，它们在 Observer 触发上有本质区别：

```php
<?php

// 方式一：insert() —— 原生 SQL INSERT，不触发 Observer
// 适合批量导入、数据迁移等场景
Order::insert([
    ['user_id' => 1, 'total' => 100, 'status' => 'pending'],
    ['user_id' => 2, 'total' => 200, 'status' => 'pending'],
    // ... 1000 条
]);
// ✅ 一次 SQL，不触发 Observer

// 方式二：create() —— 通过 Model 创建，触发 Observer
// 每次 create 都会触发 creating → created → saving → saved
foreach ($batchData as $data) {
    Order::create($data);
    // ❌ 1000 条数据 = 4000 次 Observer 调用
    // 如果 Observer 里有 HTTP 请求或邮件发送，那就是 1000 次外部调用
}
```

很多开发者在写批量导入功能时，下意识地用了 `create()` 而不是 `insert()`，因为 `create()` 更直观，也更「Laravel 风格」。但当数据量达到几千条时，Observer 的累积开销会变得非常可观。

**解决方案**：

```php
<?php

// 方式一：临时禁用 Observer
Order::withoutEvents(function () {
    foreach ($orders as $orderData) {
        Order::create($orderData); // Observer 不会触发
    }
});

// 方式二：使用 insert()（拿不到 Model 实例和自增 ID）
Order::insert($orderDataArray);

// 方式三：批量创建后手动触发一次 Observer（最灵活）
$orders = collect($orderDataArray)->map(fn($data) => new Order($data));
Order::insert($orders->map->getAttributes()->toArray());
// 手动触发一次批量处理
event(new OrdersBulkCreated($orders));
```

### 5.2 Observer 中的同步外部调用

Observer 的同步执行特性意味着，如果你在 Observer 中调用了外部 API、发送了邮件、或者执行了任何耗时操作，这些操作会直接阻塞当前请求的响应时间：

```php
<?php

class OrderObserver
{
    public function created(Order $order): void
    {
        // ❌ 同步调用外部 API，每次创建订单都阻塞
        // HubSpot API 平均响应 200ms，P99 响应 2s
        // 这意味着你的订单创建接口的 P99 延迟会增加 2s
        Http::timeout(5)->post('https://api.hubspot.com/contacts', [
            'email' => $order->user->email,
            'properties' => ['last_order_id' => $order->id],
        ]);
    }
}
```

在高并发场景下，这种同步外部调用会导致请求队列堆积，最终可能触发 PHP-FPM 的 worker 上限，导致整个服务不可用。

Event Listener 的显式调用模式让这种性能影响完全可预期——你可以在代码审阅时精确看到每个请求触发了多少个事件，每个事件有多少个监听器，哪些是同步的、哪些是队列化的。

### 5.3 性能监控的差异

Observer 的隐式触发让性能监控变得困难。一个简单的 `$order->save()` 调用，背后可能触发了三个 Observer，每个 Observer 里又有不同的副作用逻辑。在 APM（应用性能监控）工具中，这些 Observer 的执行时间会被计入 `save()` 的耗时，但你很难从调用栈中看出具体是哪个 Observer 花了最多时间。

```php
<?php

// 在 Controller 或 Service 中
$stopwatch->start('create-order');
$order = Order::create($data);
$stopwatch->stop('create-order');
// 这个计时包含了所有 Observer 的执行时间
// 一个简单的 create() 耗时 200ms，其中 180ms 是 Observer 里发的 HTTP 请求
// 但在你的日志里，你只看到「create-order: 200ms」
// 你不知道这 200ms 花在了哪里
```

而 Event Listener 的显式调用让每个步骤的耗时都是可见的：

```php
<?php

$stopwatch->start('create-order');
$order = Order::create($data); // 不含 Observer 的额外开销
$stopwatch->stop('create-order');

$stopwatch->start('dispatch-events');
event(new OrderCreated($order));
$stopwatch->stop('dispatch-events');
// 两个阶段的耗时分别可见，性能瓶颈一目了然
```

### 5.4 隐式耦合的维护成本

除了运行时性能，Observer 的隐式耦合还带来了长期的维护成本。当一个新成员加入团队，看到 `Order::create($data)` 这行代码时，他无法直接知道背后触发了哪些副作用。他需要：

1. 查看 `Order` 模型上是否注册了 Observer（可能在 `EventServiceProvider`，可能在 `#[ObservedBy]` 属性，可能在某个 `AppServiceProvider`）
2. 打开 Observer 文件，逐个方法查看
3. 追踪 Observer 方法中调用的外部服务

这个认知成本在项目规模增长后会变得非常高。当一个模型有 3 个 Observer，每个 Observer 有 5 个方法，你很难追踪一个简单的 `save()` 调用到底产生了多少副作用。

Event 的显式调用模式让这一切变得透明。`event(new OrderCreated($order))` 这行代码本身就是一个文档——它告诉你「这里发出了一个 OrderCreated 事件」。至于谁在监听这个事件，你可以在 `EventServiceProvider` 中一目了然。

---

## 六、实际选型决策树

基于以上分析，我总结了一个实用的选型决策流程。这个决策树不是教条式的规则，而是基于实际项目经验的指导原则。

### 6.1 决策流程

```
你需要监听一个操作吗？
│
├── 否 → 不需要 Observer 或 Event
│
└── 是 → 这个操作与单个模型的 CRUD 生命周期直接相关吗？
    │
    ├── 否 → 用 Event + Listener
    │        （业务流程编排、跨模型协调、自定义业务动作）
    │
    └── 是 → 这个副作用需要在事务内执行吗？
        │
        ├── 是（审计日志、数据校验、自动字段填充）
        │   └── 这个操作涉及多个模型吗？
        │       ├── 是 → 用 Event + Listener（保持事务一致性的同时跨模型协调）
        │       └── 否 → 用 Observer（单模型同步操作）
        │
        └── 否（发通知、同步缓存、调用外部 API）
            └── 这个操作需要跨模型协调吗？
                ├── 是 → 用 Event + Listener + ShouldHandleEventsAfterCommit
                └── 否 → 用 Observer + ShouldHandleEventsAfterCommit
```

### 6.2 适合用 Observer 的场景

**场景一：模型审计日志**

审计日志是 Observer 最经典的应用场景。它的特点是：纯记录性操作、与单个模型绑定、不涉及跨模型协调、失败时应该回滚（和业务数据保持一致性）。

```php
<?php

class AuditObserver implements ShouldHandleEventsAfterCommit
{
    public function created(Model $model): void
    {
        AuditLog::create([
            'auditable_type' => get_class($model),
            'auditable_id'   => $model->getKey(),
            'event'          => 'created',
            'new_values'     => $model->getAttributes(),
            'user_id'        => auth()->id(),
            'ip_address'     => request()->ip(),
        ]);
    }

    public function updated(Model $model): void
    {
        if (empty($model->getDirty())) return;
        
        AuditLog::create([
            'auditable_type' => get_class($model),
            'auditable_id'   => $model->getKey(),
            'event'          => 'updated',
            'old_values'     => $model->getOriginal(),
            'new_values'     => $model->getAttributes(),
            'user_id'        => auth()->id(),
        ]);
    }

    public function deleted(Model $model): void
    {
        AuditLog::create([
            'auditable_type' => get_class($model),
            'auditable_id'   => $model->getKey(),
            'event'          => $model->isForceDeleting() ? 'force_deleted' : 'soft_deleted',
            'old_values'     => $model->getAttributes(),
            'user_id'        => auth()->id(),
        ]);
    }
}
```

注意这里用了 `ShouldHandleEventsAfterCommit`——审计日志虽然需要和业务数据保持一致性，但如果放在事务内执行，读取 `auth()->id()` 可能在某些队列 Worker 环境下返回 null。放在事务后执行，既能确保数据已提交，又能正确读取请求上下文。

**场景二：模型字段自动计算和填充**

这类操作必须在保存前同步执行，不能延迟，不能队列化。Observer 的 `saving` 钩子是唯一正确的位置：

```php
<?php

class ProductObserver
{
    public function saving(Product $product): void
    {
        // 自动计算含税价——必须在保存前执行
        $product->price_with_tax = $product->price * (1 + $product->tax_rate);
        
        // 自动生成 slug——必须在保存前执行
        $product->slug = Str::slug($product->name);
        
        // 搜索向量生成——必须在保存前执行
        $product->search_vector = strtolower(
            $product->name . ' ' . $product->description
        );
    }
}
```

**场景三：模型级别的缓存清理**

缓存清理是纯副作用操作，与单个模型绑定，不需要业务逻辑编排。Observer 的 `updated` 和 `deleted` 钩子是最自然的位置：

```php
<?php

class ProductObserver implements ShouldHandleEventsAfterCommit
{
    public function updated(Product $product): void
    {
        Cache::forget("product_{$product->id}");
        Cache::forget("product_{$product->id}_detail");
        Cache::forget("product_{$product->id}_reviews");
        
        // 清理列表缓存
        Cache::tags(['products', 'product_list'])->flush();
    }

    public function deleted(Product $product): void
    {
        Cache::forget("product_{$product->id}");
        Cache::tags(['products'])->flush();
    }
}
```

### 6.3 适合用 Event Listener 的场景

**场景一：下单后的一系列下游操作**

一个「下单」动作可能触发五到八个独立的下游操作。这些操作各自独立，可以失败和重试，不应该在同一个同步调用栈中执行。Event 的一对多分发模式完美匹配这个场景：

```php
<?php

class OrderPlaced
{
    use Dispatchable;
    
    public function __construct(
        public readonly Order $order,
        public readonly array $paymentInfo,
    ) {}
}

// 每个 Listener 负责一个独立的关注点
class DeductInventory implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderPlaced $event): void { /* 扣减库存 */ }
}

class SendOrderConfirmation implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderPlaced $event): void { /* 发送确认邮件 */ }
}

class NotifyWarehouse implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderPlaced $event): void { /* 通知仓库发货 */ }
}

class SyncToErp implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderPlaced $event): void { /* 同步到 ERP 系统 */ }
}

class AwardPoints implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderPlaced $event): void { /* 发放积分 */ }
}
```

**场景二：跨模型的业务流程编排**

当一个操作需要协调多个模型的状态变更时，Event 是唯一合理的选择。Observer 绑定在单个模型上，无法表达跨模型的业务语义：

```php
<?php

class PaymentProcessed
{
    public function __construct(
        public readonly Payment $payment,
        public readonly Order $order,
        public readonly User $user,
    ) {}
}

class UpdateOrderStatus
{
    public function handle(PaymentProcessed $event): void
    {
        $event->order->update(['status' => 'paid', 'paid_at' => now()]);
    }
}

class ActivateSubscription
{
    public function handle(PaymentProcessed $event): void
    {
        if ($event->order->type === 'subscription') {
            $event->user->subscription()->activate();
        }
    }
}

class GenerateInvoice
{
    public function handle(PaymentProcessed $event): void
    {
        Invoice::createForOrder($event->order);
    }
}
```

**场景三：需要精确控制执行顺序**

当多个处理步骤之间有依赖关系时，Event Listener 的执行顺序可以在 `EventServiceProvider` 中显式定义。而多个 Observer 对同一模型事件的执行顺序是不确定的（取决于 PHP 的类加载顺序和注册顺序）：

```php
<?php

// EventServiceProvider.php
protected $listen = [
    OrderPlaced::class => [
        ValidateInventory::class,        // 先验证库存
        DeductInventory::class,          // 再扣减库存（依赖验证结果）
        CreateInvoice::class,            // 再开发票（依赖库存扣减结果）
        SendOrderConfirmation::class,    // 最后发通知（依赖前面所有步骤）
    ],
];
```

---

## 七、30+ 仓库的真实踩坑案例

在审阅大量 Laravel 仓库的过程中，我积累了大量 Observer 相关的踩坑案例。以下是按频率排序的高频问题：

### 案例 1：Observer 中 dispatch Job 的事务边界问题（12/30 仓库存在）

这是最高频的问题。开发者在 Observer 的 `created` 或 `updated` 方法中直接 `dispatch()` Job，但没有意识到 Observer 在事务内触发，Job 会在事务提交前入队。

```php
<?php

// ❌ 原始代码
class OrderObserver
{
    public function created(Order $order): void
    {
        SendInvoiceJob::dispatch($order);
    }
}

// 问题复现路径：
// 1. CreateOrderService 在 DB::transaction 中创建 Order
// 2. Observer 触发，SendInvoiceJob 入队
// 3. 后续步骤失败，事务回滚
// 4. 队列 Worker 执行 Job，找不到订单
// 5. Job 失败，进入重试队列，反复失败
```

```php
<?php

// ✅ 修复方案
class OrderObserver implements ShouldHandleEventsAfterCommit
{
    public function created(Order $order): void
    {
        SendInvoiceJob::dispatch($order);
    }
}
```

### 案例 2：Observer 中同步调用外部 API（8/30 仓库存在）

```php
<?php

// ❌ 原始代码
class CustomerObserver
{
    public function created(Customer $customer): void
    {
        // HubSpot API 超时时拖慢整个注册请求
        Http::timeout(5)->post('https://api.hubspot.com/contacts', [
            'email' => $customer->email,
        ]);
    }
}
```

```php
<?php

// ✅ 修复方案
class CustomerObserver implements ShouldHandleEventsAfterCommit
{
    public function created(Customer $customer): void
    {
        SyncToCrmJob::dispatch($customer)->onQueue('external-api');
    }
}
```

### 案例 3：Observer 嵌套触发的连锁反应（6/30 仓库存在）

```php
<?php

class PostObserver
{
    public function created(Post $post): void
    {
        // 更新用户文章计数
        $post->user->increment('post_count');
        // ❌ 这会触发 UserObserver::updated()
        // 形成了 PostObserver → Model → UserObserver 的嵌套调用链
    }
}

class UserObserver
{
    public function updated(User $user): void
    {
        if ($user->wasChanged('post_count')) {
            Notification::send($user, new PostCountUpdated($user));
        }
    }
}
```

```php
<?php

// ✅ 修复方案：用 withoutEvents 打断嵌套
class PostObserver
{
    public function created(Post $post): void
    {
        User::withoutEvents(function () use ($post) {
            $post->user->increment('post_count');
        });
    }
}
```

### 案例 4：Observer 在 Octane 环境下的状态泄漏（5/30 仓库存在）

```php
<?php

class OrderObserver
{
    // ❌ Octane 环境下 Observer 是单例，实例属性跨请求共享
    private int $processedCount = 0;

    public function created(Order $order): void
    {
        $this->processedCount++;
        // 第 1 个请求 processedCount=1，第 100 个请求 processedCount=100
        // 而且如果某个请求重置了它，其他请求也会受影响
    }
}
```

```php
<?php

// ✅ 修复方案：不在 Observer 中维护实例状态
class OrderObserver
{
    public function created(Order $order): void
    {
        $count = Cache::increment('orders_processed_today');
        if ($count % 100 === 0) {
            SendSlackMessageJob::dispatch("今日已处理 {$count} 个订单");
        }
    }
}
```

### 案例 5：软删除 Observer 的 `deleted` vs `trashed` 混淆（4/30 仓库存在）

```php
<?php

class ArticleObserver
{
    public function deleted(Article $article): void
    {
        // ❌ 软删除和硬删除都会触发 deleted()
        // 无法区分，导致软删除时误删搜索索引
        SearchIndex::where('article_id', $article->id)->delete();
    }
}
```

```php
<?php

// ✅ 修复方案
class ArticleObserver
{
    public function deleted(Article $article): void
    {
        if ($article->isForceDeleting()) {
            // 硬删除：彻底清理
            SearchIndex::where('article_id', $article->id)->delete();
            Storage::delete($article->cover_image);
        } else {
            // 软删除：只隐藏
            SearchIndex::where('article_id', $article->id)
                ->update(['is_visible' => false]);
        }
    }
}
```

### 更多高频踩坑模式速查表

| # | 问题 | 影响频率 | 影响 | 修复方案 |
|---|------|----------|------|----------|
| 6 | Observer 中 `auth()` 在队列 Worker 中为 null | 4/30 | 审计日志丢失 user_id | 通过 Model 属性传递或在 dispatch 时附加 |
| 7 | 多 Observer 执行顺序不确定 | 3/30 | 偶发数据不一致 | 改用 Event 显式排序 |
| 8 | Observer 中 `Mail::to()` 同步发邮件拖慢请求 | 3/30 | 接口延迟 >2s | 队列化 |
| 9 | `Model::withoutEvents()` 忘记在闭包内使用 | 3/30 | 后续操作不触发 Observer | 确保闭包正确使用 |
| 10 | Observer 在 `replicate()` 时意外触发 | 2/30 | 创建重复关联数据 | 检查 `$model->exists` |
| 11 | `saved` 和 `created`/`updated` 重复触发 | 2/30 | 副作用执行两次 | 选择其一，不要混用 |
| 12 | Observer 中使用 `Request` Facade 在 Octane 下拿到错误请求 | 2/30 | 数据错误 | 注入 Request 或用 Model 数据 |
| 13 | `pivot` 表的 Observer 注册被忽略 | 2/30 | 中间表变更无感知 | 用 Event 或手动 dispatch |
| 14 | Observer 中 `refresh()` 触发无限循环 | 1/30 | 栈溢出 | 避免在 Observer 中 refresh |
| 15 | Observer 注册在 `register()` 而非 `boot()` | 1/30 | 依赖未就绪 | 统一用 `boot()` |

---

## 八、最佳实践总结

### 8.1 黄金法则

1. **Observer 只做单模型的轻量级副作用**：字段自动填充、审计日志、缓存清理。任何涉及外部调用、跨模型协调、复杂业务判断的操作都不应该放在 Observer 里。
2. **Event 负责业务流程编排**：跨模型操作、通知发送、外部系统同步、积分发放。一个事件对应一个业务语义，一个监听器对应一个关注点。
3. **永远默认 `ShouldHandleEventsAfterCommit`**：除非你明确需要在事务内执行（比如审计日志需要和业务数据在同一事务中回滚），否则 Observer 和 Event Listener 都应该在事务提交后执行。
4. **Observer 中不调用外部服务**：HTTP 请求、邮件发送、消息推送一律通过 Job 队列化。同步外部调用是性能杀手和故障放大器。
5. **不在 Observer 中维护实例状态**：Octane 环境下 Observer 是单例，实例属性会跨请求泄漏。使用缓存或数据库来追踪状态。

### 8.2 推荐的 Observer 模板

```php
<?php

namespace App\Observers;

use Illuminate\Contracts\Events\ShouldHandleEventsAfterCommit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

/**
 * 通用 Observer 模板
 * 
 * 设计原则：
 * 1. 实现 ShouldHandleEventsAfterCommit 确保事务安全
 * 2. 只做记录性（审计日志）和缓存性（清理缓存）操作
 * 3. 耗时操作通过 Job 队列化
 * 4. 不调用外部 API，不发邮件，不发通知
 * 5. 不维护实例状态，Octane 兼容
 */
class BaseModelObserver implements ShouldHandleEventsAfterCommit
{
    public function created(Model $model): void
    {
        $this->auditLog($model, 'created');
        $this->clearRelatedCache($model);
    }

    public function updated(Model $model): void
    {
        if (empty($model->getDirty())) return;
        $this->auditLog($model, 'updated');
        $this->clearRelatedCache($model);
    }

    public function deleted(Model $model): void
    {
        $event = $model->isForceDeleting() ? 'force_deleted' : 'soft_deleted';
        $this->auditLog($model, $event);
        $this->clearRelatedCache($model);
    }

    protected function auditLog(Model $model, string $event): void
    {
        activity()
            ->performedOn($model)
            ->withProperties([
                'old' => $event === 'updated' ? $model->getOriginal() : null,
                'new' => $model->getAttributes(),
            ])
            ->log($event);
    }

    protected function clearRelatedCache(Model $model): void
    {
        $class = class_basename($model);
        Cache::forget(strtolower($class) . "_{$model->getKey()}");
    }
}
```

### 8.3 何时选择 Event 而非 Observer 的信号

当你发现自己在做以下任何一件事时，说明这个操作不应该放在 Observer 里：

- 在 Observer 中 dispatch 多个不同的 Job——说明有多个独立的下游操作，应该用 Event 的一对多分发
- 在 Observer 中调用其他 Model 的方法——说明涉及跨模型协调，超出了 Observer 的职责范围
- 在 Observer 中使用复杂的 `if/else` 做业务判断——说明这是业务流程编排，应该用 Event
- 需要控制多个处理步骤的执行顺序——Observer 的执行顺序不确定，应该用 Event
- 需要在测试中 mock Observer 的部分方法——说明 Observer 承担了太多职责

### 8.4 Observer 与 Event 的组合模式

在同一个项目中，Observer 和 Event 可以而且应该共存。关键是让它们各司其职——Observer 处理模型级别的轻量同步操作，Event 处理业务级别的流程编排：

```php
<?php

// Observer 处理轻量级同步副作用
class OrderObserver implements ShouldHandleEventsAfterCommit
{
    public function created(Order $order): void
    {
        // 审计日志——同步写入，轻量操作
        activity()->performedOn($order)->log('created');
        
        // 缓存清理——同步执行，轻量操作
        Cache::forget("user_orders_{$order->user_id}");
        
        // 触发业务事件——将复杂的下游操作交给 Event 引擎
        // Observer 只负责「告知」发生了什么，不负责「处理」该做什么
        event(new OrderPlaced($order));
    }
}

// Event 处理复杂的业务流程
class DeductInventory implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderPlaced $event): void { /* 扣减库存 */ }
}

class SendNotification implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderPlaced $event): void { /* 发送通知 */ }
}

class SyncToErp implements ShouldQueue, ShouldHandleEventsAfterCommit
{
    public function handle(OrderPlaced $event): void { /* 同步 ERP */ }
}
```

这种分层模式让 Observer 保持轻量和可预测（只有审计日志和缓存清理，无外部依赖），同时通过 Event 引擎驱动复杂的异步业务流程（队列化、独立重试、独立失败处理）。

---

## 结语

Observer 和 Event Listener 不是对立的选择，而是不同抽象层次的工具。Observer 是模型级别的细粒度监听，适合做「模型发生了什么变化」的同步响应——字段计算、审计记录、缓存清理。Event 是业务级别的流程编排，适合做「某件事发生后需要做哪些事」的异步协调——通知发送、外部同步、跨模型联动。

选择的关键不在于「哪个更方便」，而在于**哪个更符合你的事务边界和执行时序需求**。当你下次写 Observer 时，先问自己三个问题：

1. **这个操作需要在事务内执行还是事务后执行？** 如果在事务后，必须实现 `ShouldHandleEventsAfterCommit`
2. **这个操作会不会因为事务回滚而产生不可逆的副作用？** 如果会（发邮件、调 API），必须队列化
3. **这个操作需要和哪些其他操作协调？** 如果涉及多个下游操作，应该用 Event

想清楚这三个问题，Observer 还是 Event Listener，答案自然就出来了。

最后分享一个经验法则：**如果你不确定该用 Observer 还是 Event，那就用 Event。** Event 的显式性让它在任何场景下都是安全的选择——你可以随时在 Event Listener 中加入 `ShouldQueue` 和 `ShouldHandleEventsAfterCommit`，可以随时调整监听器的执行顺序，可以随时增加新的监听器。而 Observer 的隐式性让它在后期维护中充满了意外。一个最初只做「写审计日志」的 Observer，在项目演进过程中很容易被加入「发通知」「调 API」「同步 ES」等逻辑，最终变成一个无法维护的上帝 Observer。

---

## 相关阅读

- [Laravel Context 实战：请求级上下文传播、日志关联、队列透传与多租户标识的统一治理](/categories/PHP/Laravel/2026-06-06-Laravel-Context-实战-请求级上下文传播-日志关联-队列透传与多租户标识的统一治理/)
- [Retry & Dead Letter Queue 深度实战：Laravel 队列失败消息治理](/categories/PHP/Laravel/2026-06-06-Retry-Dead-Letter-Queue-深度实战-Laravel队列失败消息治理/)
- [Laravel Pipeline 源码：闭包洋葱模型](/categories/PHP/Laravel/2026-06-05-laravel-pipeline-source-closure-onion-model/)
