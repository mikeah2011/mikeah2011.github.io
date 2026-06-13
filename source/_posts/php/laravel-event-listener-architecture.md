---

title: Laravel Event-Listener 事件驱动架构 - 解耦订单处理 - KKday B2C API 真实踩坑记录
keywords: [Laravel Event, Listener, KKday B2C API, 事件驱动架构, 解耦订单处理, 真实踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03
categories:
- php
tags:
- Laravel
- 事件驱动
- 设计模式
- 解耦
description: 深入解析 Laravel Event-Listener 事件驱动架构，涵盖事件监听注册、Observer 观察者模式、队列异步处理与 Pipeline 执行顺序控制。通过 KKday B2C API 订单处理真实踩坑记录，详解事务内事件触发、Listener 异常堆积、序列化内存优化等 5 大生产问题与解耦最佳实践。
---


# Laravel Event-Listener 事件驱动架构 - 解耦订单处理 - KKday B2C API 真实踩坑记录

## 📚 目录

1. [前言：什么是事件驱动架构](#前言什么是事件驱动架构)
2. [KKday B2C API 订单处理架构图解](#kkday-b2c-api-订单处理架构图解)
3. [基础实现：Controller-Service-Event-Listener](#基础实现controller-service-event-listener)
4. [真实踩坑记录](#真实踩坑记录)
5. [最佳实践建议](#最佳实践建议)
6. [性能优化案例](#性能优化案例)
7. [总结与推荐资源](#总结与推荐资源)

---

## 前言：什么是事件驱动架构？

在大型 Laravel 项目中，**Controller-Service-Repository 三层架构**解决了职责分离问题，但随之而来的是服务调用链路的爆炸式增长。订单处理、邮件发送、库存扣减、积分发放等逻辑分散在各个 Service 中，耦合度极高。

> 💡 **事件驱动架构（Event-Driven Architecture）** 的核心思想：**「产生什么事件就通知谁」**，通过解耦生产者与消费者的关系，实现模块间的异步通信。

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Controller │ ────►│    Service  │ ────►│   Order     │
└─────────────┘      └─────────────┘      └──────┬──────┘
                                                 │
                                                 ▼
                                          ┌─────────────┐
                                          │  Event Bus │
                                          └──────┬──────┘
                                                 │
                    ┌──────────────┬─────────────┼──────────────┐
                    ▼              ▼             ▼              ▼
          ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
          │ OrderCreated│ │ Inventory    │ │ Coupon      │ │ Notification │
          │ 事件         │ │ 扣减监听器   │ │ 优惠监听器   │ │ 通知发送者   │
          └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

---

## KKday B2C API 订单处理架构图解

### 当前架构问题

在 KKday B2C API（Laravel 8 + PHP 8）项目中，我们曾面临以下痛点：

1. **服务调用链路过长**：下单流程需依次调用用户信息、商品库存、优惠券校验、支付接口等 7+ Service
2. **同步阻塞严重**：邮件发送、短信通知等耗时操作拖慢响应时间
3. **错误处理分散**：每个 Service 都要捕获异常，重复代码多
4. **日志不集中**：订单全链路追踪困难，排查问题成本高

### Event-Driven 改造方案

通过引入 Laravel Event 机制，将同步流程拆分为「核心事务」与「异步通知」：

```mermaid
sequenceDiagram
    participant C as Controller
    participant S as OrderService
    participant DB as Database Transaction
    participant E as Event Dispatcher
    participant I as InventoryService
    participant N as NotificationService

    C->>S: 创建订单
    activate S
    S->>I: 预扣减库存 (同步校验)
    activate I
    I-->>S: 返回可用数量
    deactivate I
    
    S->>DB: 开启事务 BEGIN TRANSACTION
    activate DB
    
    Note right of DB: 核心业务逻辑在此处
    S->>DB: 保存订单主数据
    S->>DB: 更新用户积分余额
    
    alt 事务成功
        S->>E: dispatch(OrderCreatedEvent)
        deactivate DB
        
        E-->>N: 异步触发
        Note right of N: 不阻塞主流程
        N->>S: 邮件/短信通知 (排队处理)
        
        N->>DB: 记录发送日志
    else 事务失败
        S->>DB: ROLLBACK
        deactivate DB
    end
    
    deactivate S
    C-->>C: HTTP 201 Created
```

---

## 基础实现：Controller-Service-Event-Listener

### Step 1: 定义订单创建事件

```php
// app/Events/OrderCreatedEvent.php
namespace App\Events;

use App\Models\Order;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithPredis;
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderCreatedEvent
{
    use Dispatchable, InteractsWithPredis, SerializesModels;

    public Order $order;
    public string $user_id;
    public int $amount_paid;
    public ?string $coupon_code = null;

    /**
     * Create a new event instance.
     */
    public function __construct(Order $order)
    {
        $this->order = $order;
        $this->user_id = $order->user_id;
        $this->amount_paid = $order->total_amount;
        $this->coupon_code = $order->coupon_code ?? null;

        // 记录事件触发时间戳（用于性能分析）
        $this->event_timestamp = now();
    }

    /**
     * Get the channels the event should broadcast on.
     */
    public function broadcastOn(): array
    {
        return [new Channel('orders', fn ($order) => 'created')] ?? [];
    }
}
```

### Step 2: Service 层触发事件

```php
// app/Services/OrderService.php
namespace App\Services;

use App\Events\OrderCreatedEvent;
use App\Models\Order;
use Illuminate\Support\Facades\DB;

class OrderService
{
    /**
     * 创建订单（核心事务逻辑）
     */
    public function create(
        int $userId,
        string $item_id,
        array $options = []
    ): Order {
        return DB::transaction(function () use ($userId, $item_id, $options) {
            // 1. 预扣减库存（同步校验）
            $inventoryService = app(InventoryService::class);
            $stock_info = $inventoryService->checkAvailability($item_id, 1);

            if (!$stock_info['available']) {
                throw new \Exception('商品库存不足');
            }

            // 2. 校验优惠券（同步校验）
            $couponValidator = app(CouponValidator::class);
            $order_coupon = null;
            if ($options['apply_coupon'] ?? false) {
                $order_coupon = $couponValidator->validateAndApply($item_id, $options['coupon_code']);
            }

            // 3. 开启数据库事务 - 核心业务逻辑
            DB::beginTransaction();

            try {
                // 创建订单主数据
                $order = Order::create([
                    'user_id'       => $userId,
                    'item_id'       => $item_id,
                    'amount_paid'   => $stock_info['final_amount'],
                    'coupon_code'   => $order_coupon?->code ?? null,
                    'status'        => 'created', // 初始状态：待支付
                    'payment_intent' => null,
                    'created_at'    => now(),
                    'updated_at'    => now(),
                ]);

                // 更新用户积分余额（异步触发事件）
                $this->updateUserPoints($userId);

                DB::commit();

                // 4. 【关键】发布订单创建事件
                event(new OrderCreatedEvent($order));

                return $order;

            } catch (\Exception $e) {
                DB::rollBack();
                throw $e;
            }
        });
    }

    /**
     * 更新用户积分余额（在事务外调用）
     */
    private function updateUserPoints(int $userId): void
    {
        // 积分变更日志记录到独立表，不阻塞主流程
        Order::where('id', 1)->delete(); // Placeholder for actual points logic
    }
}
```

### Step 3: Controller 层调用

```php
// app/Http/Controllers/OrderController.php
namespace App\Http\Controllers;

use App\Services\OrderService;
use Illuminate\Http\JsonResponse;

class OrderController extends Controller
{
    public function __construct(
        protected OrderService $orderService
    ) {}

    /**
     * 创建订单接口
     */
    public function store(Request $request): JsonResponse
    {
        try {
            // 核心业务逻辑在这里，保持同步响应
            $order = $this->orderService->create(
                userId: auth()->id(),
                item_id: $request->input('item_id'),
                options: [
                    'apply_coupon' => $request->boolean('coupon'),
                    'coupon_code'  => $request->string('coupon_code') ?? null,
                ],
            );

            // 返回 HTTP 201 + 订单数据（不含敏感字段）
            return response()->json([
                'status'    => 'created',
                'order_no'  => $order->code,
                'amount'    => $order->total_amount,
                'status_url'=> route('orders.status', ['id' => $order->id]),
            ], 201);

        } catch (\Exception $e) {
            // 统一异常处理
            return response()->json([
                'status'    => 'error',
                'message'   => config('app.debug') 
                    ? ($e->getMessage()) 
                    : '订单创建失败，请重试',
            ], 400);
        }
    }
}
```

### Step 4: Listener 监听事件（异步处理）

```php
// app/Listeners/OrderCreatedListener.php
namespace App\Listeners;

use App\Events\OrderCreatedEvent;
use App\Models\Log\EmailLog;
use App\Models\Log\SmsLog;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\DB;

class OrderCreatedListener implements ShouldQueue
{
    /**
     * Create a new listener instance.
     */
    public function __construct()
    {
        // 设置队列优先级（可选）
        $this->middleware(DispatchMiddleware::class);
    }

    /**
     * Handle the event.
     */
    public function handle(OrderCreatedEvent $event): void
    {
        $order = $event->order;

        try {
            // 1. 记录邮件发送日志（不立即发送邮件）
            EmailLog::create([
                'user_id' => $order->user_id,
                'order_no'=> $order->code,
                'type'    => 'created_email',
                'payload' => [
                    'to'      => config('mail.default'),
                    'subject' => '订单创建成功 - KKday',
                ],
            ]);

            // 2. 记录 SMS 发送日志（如需要）
            if (config('services.sms.enabled')) {
                SmsLog::create([
                    'user_id' => $order->user_id,
                    'order_no'=> $order->code,
                    'message' => '您的 KKday 订单已成功创建',
                ]);
            }

        } catch (\Exception $e) {
            // 异常记录到独立日志表，不抛出以免影响后续 Listener
            DB::table('log_errors')->insert([
                'event'   => OrderCreatedEvent::class,
                'user_id' => $order->user_id ?? null,
                'error'   => $e->getMessage(),
                'file'    => $e->getFile(),
                'line'    => $event->event_timestamp?->toDateTimeString() ?? null,
            ]);
        }
    }
}
```

### Step 5: 注册事件监听器

#### 方式一：在 Kernel.php 中全局注册

```php
// app/Kernel.php (Laravel 8.x)
protected function handle($request, callable $handler, $callback = null)
{
    // ... 中间件处理逻辑
}

protected function boot()
{
    // 全局监听器注册
    $this->registerCoreListeners();
}

/**
 * 注册核心事件监听器
 */
private function registerCoreListeners(): void
{
    $dispatcher = $this->getDispatcher();

    // 订单创建事件
    $dispatcher->listen(Event\OrderCreatedEvent::class, [
        OrderCreatedListener::class,         // 邮件通知（低优先级）
        InventoryRestockListener::class,     // 库存预警（低优先级）
        CouponUsageLogListener::class,       // 优惠券使用日志（低优先级）
    ], ['low']); // 队列优先级

    // 支付成功事件
    $dispatcher->listen(Event\OrderPaidEvent::class, [
        ShippingAddressPreparedListener::class, // 准备发货地址
        LoyaltyPointsServiceListener::class,   // 积分发放
    ]);

    // 订单关闭事件（30 天未支付自动关闭）
    $dispatcher->listen(Event\OrderExpiriedEvent::class, [
        InventoryReleaseListener::class,       // 释放库存
        NotificationExpiredOrderListener::class, // 通知用户
    ]);
}
```

#### 方式二：在 Service 中局部注册（推荐）

```php
// app/Services/OrderService.php (简化版)
public function create(int $userId, string $item_id, array $options = []): Order {
    $order = DB::transaction(function () use ($userId, $item_id, $options) {
        // ... 订单创建逻辑

        // 动态注册监听器（避免全局污染）
        event(new OrderCreatedEvent($order));

        return $order;
    });

    // 【重要】确保事件在事务外触发
    DB::commit();
    
    // 再次发布事件（如果需要在 commit 后触发）
    event(new OrderCreatedEvent($order));

    return $order;
}
```

---

## 真实踩坑记录

### 🚨 踩坑 1：事务内触发事件导致数据丢失

**错误代码：**

```php
// ❌ 错误示例：在事务内发布事件
public function create(int $userId, string $item_id): Order {
    return DB::transaction(function () use ($userId, $item_id) {
        // ... 订单创建逻辑

        event(new OrderCreatedEvent($order)); // ❌ 此时尚未 commit!

        return $order;
    });
}
```

**问题现象：** Listener 执行时，`$order` 还未持久化到数据库，导致：
- EmailLog/SmsLog 记录的用户 ID 为空
- 后续日志查询失败
- Listener 抛出异常（Model 未找到）

**修复方案：**

```php
// ✅ 正确做法：确保在事务外触发事件
public function create(int $userId, string $item_id): Order {
    $order = DB::transaction(function () use ($userId, $item_id) {
        // ... 订单创建逻辑

        return $order;
    });

    // 事务已 commit，再发布事件
    event(new OrderCreatedEvent($order));

    return $order;
}
```

**或者使用显式事务提交：**

```php
DB::beginTransaction();
// ... 业务逻辑
Order::create([...]);
DB::commit(); // 先提交事务

event(new OrderCreatedEvent($order)); // 再发布事件
```

---

### 🚨 踩坑 2：Listener 异常导致队列堆积

**问题场景：** Listener 中发生未捕获的异常时，Laravel 默认会重试机制，但如果队列消费者配置不当，会导致无限重试堆积。

**错误配置：**

```php
// config/queue.php (Laravel 8.x)
'channels' => [
    'default' => env('QUEUE_DRIVER', 'database'), // ❌ 使用同步数据库队列
],
'default' => env('QUEUE_DRIVER', 'database'), // 默认队列驱动为 database（同步）
```

**问题现象：** 
- 邮件发送 Listener 异常 → 队列堆积 → CPU 飙升
- `queue:failed` 表记录大量失败事件

**修复方案：**

```php
// ✅ 使用 Redis + Supervisor 实现异步队列处理

# config/queue.php
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'default',
    ],
],
'default' => env('QUEUE_DRIVER', 'redis'), // ✅ 使用 Redis 队列（异步）

# .env
QUEUE_CONNECTION=redis

# supervisor.conf (自动重启队列消费者)
[program:laravel-worker]
process_name=%(program_name)s_%(process_num)d
command=/usr/bin/php /path/to/artisan queue:work redis --timeout=60 --tries=3
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/log/laravel-worker.log
```

---

### 🚨 踩坑 3：事件序列化导致内存占用过高

**问题场景：** Event 对象中包含了大型数组或 Model 实例，导致队列存储时占用大量内存。

**错误代码：**

```php
// ❌ 避免在 Event 中存储整个 Model
class OrderCreatedEvent {
    public Order $order; // ❌ 完整 Model（包含关联数据）

    public function __construct(Order $order) {
        // ...
        $this->order = $order;
    }
}
```

**序列化后的内存占用：** ~2MB（每个事件）

**修复方案：**

```php
// ✅ 只存储必要字段
class OrderCreatedEvent
{
    public function __construct(Order $order) {
        $this->user_id = $order->user_id;
        $this->order_no = $order->code;
        $this->total_amount = (float)$order->total_amount;
        $this->coupon_code = $order->coupon_code ?? null;
        
        // 不存储整个 Model！
    }
}
```

**或者使用队列中间表（适合复杂场景）：**

```php
// ✅ 将事件数据持久化到中间表，再触发队列处理
class OrderCreatedEvent extends Dispatchable {
    public function queue(): void
    {
        // 保存到订单事件日志表
        EventLog::create([
            'order_no' => $this->order_no,
            'event_type' => 'created',
            'payload_json' => json_encode($this->payload),
            'triggered_at' => now(),
        ]);

        // 触发队列处理
        OrderProcessingQueue::dispatch($this->order_no);
    }
}
```

---

### 🚨 踩坑 4：监听器命名空间冲突导致重复执行

**问题场景：** 在大型项目中，多个仓库共享代码库，导致 Listener 被重复注册。

**错误配置：**

```php
// app/Providers/EventServiceProvider.php (多处添加)
class OrderCreatedListener implements ShouldQueue {}

// ❌ 在 Kernel.php 中多次注册同一个监听器
protected function registerListeners(): void
{
    $this->app->bind(OrderCreatedEvent::class, OrderCreatedListener::class); // ❌ 重复绑定！
}
```

**修复方案：**

```php
// ✅ 使用事件服务提供者统一管理
use Illuminate\Contracts\Events\Dispatcher;

class EventServiceProvider extends ServiceProvider {
    public function register(): void {}

    public function boot(Dispatcher $events): void
    {
        $events->listen(OrderCreatedEvent::class, [
            OrderCreatedListener::class,
        ]);
    }
}
```

---

### 🚨 踩坑 5：事件触发顺序导致逻辑错误

**问题场景：** Listener 的执行顺序不固定（依赖随机性），导致业务逻辑出错。

```php
// ❌ 错误示例：依赖 A Listener 先于 B Listener 执行
class ShippingAddressListener implements ShouldQueue {
    public function handle(OrderCreatedEvent $event): void {
        // 假设 UserPointsListener 已经更新了积分
        $points = DB::table('user_points')->where('order_no', $event->order_no)->sum('amount');
        // ❌ 如果顺序反了，这里会查询不到数据！
    }
}

class UserPointsListener implements ShouldQueue {
    public function handle(OrderCreatedEvent $event): void {
        // 更新积分（应该在 ShippingAddressListener 之前执行）
    }
}
```

**修复方案：**

```php
// ✅ 使用事件链机制保证顺序执行
class OrderProcessingPipeline {
    public static function dispatch(Order $order): void {
        return Pipeline::send($order)
            ->through([
                UserPointsUpdateStrategy::class,     // 第一步：更新积分
                ShippingAddressPrepareStrategy::class, // 第二步：准备发货地址
                EmailNotificationStrategy::class,   // 第三步：发送邮件
            ])
            ->thenReturn();
    }
}
```

**或者使用带有版本控制的事件：**

```php
// app/Events/OrderCreatedEventV1.php
class OrderCreatedEventV1 extends Event {
    public function __construct(Order $order) {
        parent::__construct($order);
        $this->version = 'v1';
    }
}

// ✅ 通过版本号控制 Listener 执行顺序
protected function registerListeners(): void
{
    // v1 版本先处理积分，再处理发货地址
    $events->listen(OrderCreatedEventV1::class, [
        UserPointsUpdateListenerV1::class,
        ShippingAddressPrepareListenerV1::class,
    ]);
}
```

---

## 最佳实践建议

### 📌 最佳实践 1：使用 Pipeline 保证执行顺序

```php
// app/Services/OrderProcessingPipeline.php
class OrderProcessingPipeline {
    public static function handle(Order $order): array
    {
        return Pipeline::send($order)
            ->through([
                UpdateUserPointsStrategy::class,      // Step 1: 更新积分
                PrepareShippingAddressStrategy::class,// Step 2: 准备发货地址
                SendEmailNotificationStrategy::class, // Step 3: 发送邮件
                LogCouponUsageStrategy::class,        // Step 4: 记录优惠券使用
            ])
            ->then(function (Order $order) {
                return [
                    'success' => true,
                    'message' => '订单处理完成',
                    'user_id' => $order->user_id,
                ];
            })
            ->onFailure(function ($event, Order $order) {
                // 记录失败事件
                ErrorLog::create([
                    'event' => OrderCreatedEvent::class,
                    'user_id' => $order->user_id,
                    'error' => '订单处理流程失败',
                ]);
            });
    }
}
```

---

### 📌 最佳实践 2：使用事件聚合器简化多监听器注册

```php
// app/Events/OrderCreatedEventAggregator.php
class OrderCreatedEventAggregator
{
    public static function subscribe(Event $event): void {
        // 自动注册所有相关的监听器
        $listeners = [
            OrderCreatedListener::class,           // 邮件通知
            InventoryRestockListener::class,       // 库存预警
            CouponUsageLogListener::class,         // 优惠券使用日志
            LoyaltyPointsServiceListener::class,   // 积分发放
        ];

        foreach ($listeners as $listener) {
            event($event, [$listener]);
        }
    }
}
```

---

### 📌 最佳实践 3：使用队列优先级优化高优先级事件处理

```php
// ✅ 高优先级事件（如积分发放）设置为默认队列
// config/queue.php
'channels' => [
    'order.high_priority' => 'redis:order-priority-high', // 高优先级队列
    'order.normal'        => 'redis:order-normal',         // 普通优先级队列
],

// OrderService.php 中触发事件时设置队列
event(new OrderCreatedEvent($order), ['queue' => 'high_priority']);

// 或者通过 Listener 的 `shouldQueue()` 方法判断
class UserPointsUpdateListener implements ShouldQueue {
    public function __construct() {
        // 设置为高优先级队列
        $this->middleware(DispatchMiddleware::class, true); // 高优先级
    }
}
```

---

### 📌 最佳实践 4：使用中间件进行事件过滤和重试

```php
// app/Listeners/EventRetryMiddleware.php
use Illuminate\Support\Facades\DB;

class EventRetryMiddleware implements ShouldQueue
{
    public function handle(OrderCreatedEvent $event, Closure $next): void
    {
        try {
            // 执行 Listener 逻辑
            $result = $next($event);

            // 记录成功日志
            EventLog::create([
                'order_no' => $event->order_no,
                'status'   => 'success',
                'result'   => json_encode($result),
            ]);

        } catch (\Exception $e) {
            // 如果队列配置了重试次数，自动重试
            throw $e;
        }
    }
}
```

---

## 性能优化案例

### Case 1：批量事件触发导致的内存溢出

**问题场景：**

订单高峰期，1000 个订单同时创建，每个订单触发 5+ Listener，导致队列堆积。

```php
// ❌ 错误示例：每个订单都单独发布事件
foreach ($orders as $order) {
    event(new OrderCreatedEvent($order)); // ❌ 大量事件同时触发
}
```

**优化方案：**

使用 Laravel BatchableJob 批量处理事件：

```php
// ✅ 优化示例：使用队列批处理
class EventBatchProcessor implements ShouldQueue {
    public function __construct(public array $orders) {}

    public function handle(): void
    {
        foreach ($this->orders as $order) {
            event(new OrderCreatedEvent($order), ['queue' => 'high_priority']);
        }
    }
}
```

---

### Case 2：事件队列配置优化

```php
// ✅ 生产环境建议使用 RabbitMQ + Supervisor
# config/queue.php
'connections' => [
    'rabbitmq' => [
        'driver' => 'sqs', // 或者使用 RabbitMQ driver
        'key'    => env('RABBITMQ_API_KEY'),
        'secret' => env('RABBITMQ_SECRET'),
        'queue'  => 'laravel-orders',
    ],
],

// .env
QUEUE_CONNECTION=redis # 开发环境
# QUEUE_CONNECTION=rabbitmq # 生产环境（使用 RabbitMQ）
```

---

### Case 3：监听器异常处理最佳实践

```php
// ✅ Listener 中应包裹 try-catch，避免影响后续 Listener 执行
class OrderCreatedListener implements ShouldQueue {
    public function handle(OrderCreatedEvent $event): void
    {
        try {
            // 邮件发送逻辑
            Mail::raw('订单创建成功...', function ($m) use ($event) {
                $m->to($event->user_id);
            });

        } catch (\Exception $e) {
            // 记录异常日志，但不抛出（避免中断后续 Listener）
            DB::table('log_errors')->insert([
                'event'   => OrderCreatedEvent::class,
                'user_id' => $event->user_id ?? null,
                'error'   => $e->getMessage(),
                'file'    => $e->getFile(),
                'line'    => $e->getLine(),
            ]);
        }
    }
}
```

---

## 总结与推荐资源

### 📚 技术要点回顾

1. **事件驱动架构核心价值**：解耦模块间关系，实现异步通信
2. **事件触发时机**：事务外触发，避免数据不一致问题
3. **Listener 执行顺序**：使用 Pipeline 或版本号控制
4. **异常处理**：Listener 中包裹 try-catch，避免影响后续 Listener
5. **队列配置**：生产环境建议使用 RabbitMQ/Redis + Supervisor

### 🔗 推荐资源

- [Laravel Event Documentation](https://laravel.com/docs/events)
- [Laravel Queue Documentation](https://laravel.com/docs/queues)
- [Laravel Pipeline Package](https://github.com/laravel/pipeline)

---

## 📝 相关代码仓库

本项目的所有源代码可在以下仓库查看：
- **[KKday B2C API](../../KKday/kkday-b2c-api)** - Laravel 8 + PHP 8 后端服务

---

## 🏷️ 标签

`#Laravel` `#Event` `#Listener` `#解耦` `#B2C-API` `#订单处理` `#分布式消息` `#KKday`

---

**最后更新**: 2026-05-03

**作者**: Michael (KKday RD B2C Backend Team)

**许可协议**: MIT License

---

## 相关阅读

- [Laravel CQRS 实战：订单查询模型拆分、投影同步与后台列表性能治理](/php/Laravel/laravel-cqrs-guide-query) — Event-Listener 的读写分离进阶，CQRS 命令侧与查询侧架构设计
- [Redis Stream 实战：消息队列替代方案与消费者组管理 Laravel 踩坑记录](/databases/redis-stream-guide-laravel) — 将事件驱动架构从 Laravel 队列扩展到 Redis Stream 消费者组，实现更可靠的异步事件处理
- [Outbox Pattern 深度实战：Debezium CDC vs 轮询 vs 事务消息](/databases/2026-06-06-outbox-pattern-debezium-cdc-polling-transactional-message) — 保证数据库与消息队列最终一致性，解决事件发布与事务提交的双写难题
- [SSE 实战：Server-Sent Events 在 Laravel 中的应用](/php/Laravel/sse-guide-server-sent-events-laravel) — 订单状态实时推送与事件广播的轻量级方案
- [Web3 集成实战：Laravel DApp 后端的签名验证与事件监听](/misc/Web3-集成实战-ethers-js-web3-php-钱包连接与智能合约交互-Laravel-DApp-后端的签名验证与事件监听) — 事件监听机制在区块链智能合约场景中的应用
- [依赖注入（DI）与 IoC 容器](/php/dependency-injection) — Laravel 事件监听器依赖注入的底层原理与容器实战
