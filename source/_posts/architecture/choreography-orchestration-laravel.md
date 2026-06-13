---

title: Choreography vs Orchestration 实战：事件驱动 vs 工作流驱动——Laravel 微服务中的两种分布式编排范式深度对比
keywords: [Choreography vs Orchestration, Laravel, 事件驱动, 工作流驱动, 微服务中的两种分布式编排范式深度对比]
date: 2026-06-07 10:00:00
tags:
- 微服务
- 事件驱动
- 编排模式
- Laravel
- 分布式
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 深度对比微服务编排中的两种核心范式——Choreography 事件驱动与 Orchestration 工作流驱动。以 Laravel 为技术栈，通过订单处理、支付回调等真实业务场景，详解 Event/Listener、Redis Stream、Pipeline、Temporal 等实现方式，涵盖 Saga 补偿事务、幂等性保障、可观测性等生产踩坑经验，提供完整的选型决策树与混合架构最佳实践，助你在分布式系统设计中做出正确的编排模式决策。
---



## 引言

在微服务架构中，一个业务流程往往跨越多个服务协同完成。如何让这些服务"有条不紊"地协作，是架构设计中最关键的决策之一。**Choreography（编舞）** 和 **Orchestration（编排）** 是分布式系统中两种截然不同的服务协调范式——前者依赖事件驱动的去中心化协作，后者依赖工作流引擎的中心化调度。

本文将以 **Laravel 微服务** 为技术栈，结合订单处理、支付回调等真实业务场景，深入对比这两种模式的实现方式、优缺点与选型策略。

---

## 一、核心概念解析

### 1.1 Choreography（编舞模式）

**Choreography 是一种去中心化的协调方式。** 每个服务在完成自己的职责后，发布一个事件（Event），其他关心该事件的服务自主决定如何响应。没有"指挥官"，每个参与者自行监听、自行决策。

**核心特征：**
- 服务之间通过 **事件总线**（如 Kafka、RabbitMQ、Redis Stream）异步通信
- 每个服务只关心自己发布的事件和需要消费的事件
- 不存在中心控制器，流程分散在各服务的事件处理器中
- 天然支持松耦合和独立部署

**适用场景：** 服务数量较少（3-5 个）、流程简单、团队规模小、对实时性要求不高的系统。

### 1.2 Orchestration（编排模式）

**Orchestration 是一种中心化的协调方式。** 一个专门的协调者（Orchestrator）负责定义和执行整个业务流程，按顺序调用各个服务，处理异常和补偿逻辑。

**核心特征：**
- 存在一个 **中心化的流程定义**（工作流）
- 协调者显式调用各服务，掌控整个流程的生命周期
- 异常处理、重试、补偿逻辑集中在一处
- 流程可见性强，易于监控和调试

**适用场景：** 流程复杂（涉及多步骤、条件分支、长事务）、对一致性要求高、团队规模大、需要集中监控的系统。

---

## 二、核心区别对比

| 维度 | Choreography | Orchestration |
|------|-------------|---------------|
| **协调方式** | 去中心化，服务自主决策 | 中心化，由协调者统一调度 |
| **耦合度** | 松耦合，服务间仅通过事件通信 | 相对紧耦合，协调者依赖各服务接口 |
| **流程可见性** | 分散在各服务中，难以全局把控 | 集中定义，一目了然 |
| **异常处理** | 每个服务自行处理，逻辑分散 | 集中处理，补偿逻辑清晰 |
| **扩展性** | 添加新参与者只需订阅事件 | 需要修改工作流定义 |
| **调试难度** | 高，需追踪多个服务的日志 | 低，协调者提供完整执行轨迹 |
| **一致性保证** | 最终一致性 | 可实现强一致性或补偿事务 |
| **技术复杂度** | 低（初期），高（后期） | 高（初期），低（后期） |

---

## 三、Laravel 中的 Choreography 实现

Laravel 内置的事件系统（Event/Listener）是实现 Choreography 的天然利器。结合队列（Queue）和事件广播，可以构建完整的事件驱动架构。

### 3.1 示例一：订单创建事件链

```php
// app/Events/OrderCreated.php
class OrderCreated
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly Order $order,
        public readonly array $items
    ) {}
}

// app/Listeners/ReserveInventory.php — 库存服务监听订单创建
class ReserveInventory
{
    public function handle(OrderCreated $event): void
    {
        foreach ($event->items as $item) {
            Inventory::where('product_id', $item['product_id'])
                ->decrement('stock', $item['quantity']);
        }

        // 发布库存预留成功事件，触发下一步
        InventoryReserved::dispatch($event->order);
    }
}

// app/Listeners/SendOrderConfirmation.php — 通知服务监听
class SendOrderConfirmation
{
    public function handle(OrderCreated $event): void
    {
        Mail::to($event->order->user->email)
            ->send(new OrderConfirmationMail($event->order));
    }
}

// app/Providers/EventServiceProvider.php
protected $listen = [
    OrderCreated::class => [
        ReserveInventory::class,
        SendOrderConfirmation::class,
    ],
    InventoryReserved::class => [
        ProcessPayment::class,
    ],
];
```

### 3.2 示例二：支付回调事件链

```php
// app/Events/PaymentSucceeded.php
class PaymentSucceeded
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly Payment $payment,
        public readonly Order $order
    ) {}
}

// app/Listeners/UpdateOrderStatus.php
class UpdateOrderStatus
{
    public function handle(PaymentSucceeded $event): void
    {
        $event->order->update(['status' => 'paid']);
        OrderPaid::dispatch($event->order);
    }
}

// app/Listeners/CreateShippingTask.php
class CreateShippingTask
{
    public function handle(PaymentSucceeded $event): void
    {
        ShippingService::createTask($event->order);
    }
}

// app/Listeners/AwardLoyaltyPoints.php
class AwardLoyaltyPoints
{
    public function handle(PaymentSucceeded $event): void
    {
        $points = (int) ($event->order->total_amount / 10);
        LoyaltyService::addPoints($event->order->user_id, $points);
    }
}
```

### 3.3 示例三：基于 Redis Stream 的跨服务事件

```php
// 使用 Redis Stream 实现跨微服务的 Choreography
// 服务 A：订单服务发布事件
class OrderEventPublisher
{
    public function publishedOrderCreated(Order $order): void
    {
        Redis::xadd('order.events', '*', [
            'event' => 'OrderCreated',
            'order_id' => $order->id,
            'payload' => json_encode([
                'user_id' => $order->user_id,
                'total' => $order->total_amount,
            ]),
            'timestamp' => now()->toIso8601String(),
        ]);
    }
}

// 服务 B：库存服务消费事件
class InventoryEventConsumer
{
    public function consume(): void
    {
        while (true) {
            $messages = Redis::xreadgroup(
                'inventory_group', 'worker-1',
                ['order.events' => '>'], 10, 1000
            );

            foreach ($messages['order.events'] ?? [] as $id => $msg) {
                $payload = json_decode($msg['payload'], true);

                if ($msg['event'] === 'OrderCreated') {
                    $this->reserveStock($payload['order_id']);
                }

                Redis::xack('order.events', 'inventory_group', $id);
            }
        }
    }
}
```

---

## 四、Laravel 中的 Orchestration 实现

### 4.1 示例一：使用 Laravel Workflow 定义订单流程

```php
// 使用 laravel-workflow 包定义工作流
use Workflow\Workflow;
use Workflow\Activity;

class ProcessOrderWorkflow extends Workflow
{
    public function execute(Order $order): string
    {
        // 步骤 1：验证库存
        $inventoryResult = $this->activity(
            ValidateInventoryActivity::class,
            ['order_id' => $order->id]
        );

        if (!$inventoryResult['available']) {
            return 'insufficient_stock';
        }

        // 步骤 2：预留库存
        $this->activity(
            ReserveInventoryActivity::class,
            ['order_id' => $order->id]
        );

        // 步骤 3：处理支付（可能需要重试）
        try {
            $payment = $this->activity(
                ProcessPaymentActivity::class,
                ['order_id' => $order->id, 'amount' => $order->total_amount]
            );
        } catch (\Exception $e) {
            // 支付失败，补偿：释放库存
            $this->activity(
                ReleaseInventoryActivity::class,
                ['order_id' => $order->id]
            );
            return 'payment_failed';
        }

        // 步骤 4：更新订单状态 & 发货
        $this->activity(UpdateOrderStatusActivity::class, [
            'order_id' => $order->id,
            'status' => 'paid',
        ]);

        $this->activity(CreateShippingActivity::class, [
            'order_id' => $order->id,
        ]);

        return 'completed';
    }
}
```

### 4.2 示例二：使用 Temporal（通过 Temporal PHP SDK）编排支付回调

```php
// 通过 Temporal Workflow 编排支付回调的完整流程
use Temporal\Workflow;
use Temporal\Activity;

#[Workflow\WorkflowInterface]
class PaymentCallbackWorkflow
{
    #[Workflow\Run]
    public function execute(PaymentCallbackDTO $callback): string
    {
        $paymentActivity = Workflow::newActivityStub(
            PaymentActivityInterface::class,
            Activity\ActivityOptions::new()->withStartToCloseTimeout(
                \Carbon\CarbonInterval::seconds(30)
            )
        );

        // 1. 验证支付签名
        $isValid = yield $paymentActivity->verifySignature($callback);
        if (!$isValid) {
            return 'invalid_signature';
        }

        // 2. 幂等检查
        $exists = yield $paymentActivity->checkIdempotency($callback->transaction_id);
        if ($exists) {
            return 'already_processed';
        }

        // 3. 更新订单状态
        yield $paymentActivity->updateOrderStatus(
            $callback->order_id,
            'paid',
            $callback->transaction_id
        );

        // 4. 并行执行后续操作
        yield Promise::all([
            $paymentActivity->sendConfirmationEmail($callback->order_id),
            $paymentActivity->syncToErp($callback->order_id),
            $paymentActivity->updateAnalytics($callback->order_id),
        ]);

        return 'success';
    }
}
```

### 4.3 示例三：Laravel 内置 Pipeline + 状态机模拟简单编排

```php
// 使用 Laravel Pipeline 模拟轻量级 Orchestration
use Illuminate\Pipeline\Pipeline;

class OrderProcessingOrchestrator
{
    public function process(Order $order): PipelineResult
    {
        return app(Pipeline::class)
            ->send($order)
            ->through([
                ValidateStockStep::class,
                ReserveStockStep::class,
                ProcessPaymentStep::class,
                ConfirmOrderStep::class,
                CreateShipmentStep::class,
                NotifyCustomerStep::class,
            ])
            ->thenReturn();
    }
}

class ProcessPaymentStep
{
    public function handle(Order $order, Closure $next): Order
    {
        try {
            $payment = PaymentGateway::charge(
                $order->payment_method,
                $order->total_amount
            );
            $order->payment_id = $payment->id;
        } catch (PaymentException $e) {
            // 编排器在这里统一处理补偿
            StockService::release($order->id);
            $order->status = 'payment_failed';
            return $order;
        }

        return $next($order);
    }
}
```

---

## 五、选型决策指南

### 什么时候选择 Choreography？

✅ **选 Choreography 的信号：**
- 业务流程在 3-5 步以内，逻辑简单直接
- 各服务高度自治，团队独立负责不同服务
- 对最终一致性可接受（如通知、积分、统计）
- 系统初期需要快速迭代，不想被流程引擎拖累
- 基础设施已有成熟的消息中间件（Kafka、RabbitMQ）

### 什么时候选择 Orchestration？

✅ **选 Orchestration 的信号：**
- 业务流程涉及 5 步以上，有条件分支和异常处理
- 需要强一致性和事务补偿（如订单-支付-发货）
- 流程需要可视化监控和审计追踪
- 多团队协作，需要一个"全局视角"来理解流程
- 涉及长事务或人工审批环节

### 混合策略：最佳实践

**在实际项目中，最佳方案往往是混合使用：**

- **核心交易流程**（订单→支付→发货）使用 **Orchestration**，保证一致性和可追踪
- **辅助流程**（通知→积分→统计）使用 **Choreography**，保持松耦合和独立性

```php
// 混合架构示例：Orchestration 驱动核心流程，Choreography 驱动辅助流程
class OrderOrchestrator
{
    public function createOrder(CreateOrderRequest $request): Order
    {
        // 核心流程：Orchestration 控制
        $order = Order::create($request->validated());

        // Orchestration: 同步执行关键步骤
        $this->pipeline->send($order)->through([
            ReserveStockStep::class,
            ProcessPaymentStep::class,
        ]);

        // Choreography: 异步事件驱动辅助流程
        OrderCreated::dispatch($order); // 触发通知、积分、统计等

        return $order;
    }
}
```

---

## 六、生产踩坑与最佳实践

在生产环境中落地这两种模式，会遇到大量教科书不会提及的问题。以下是团队在实际项目中踩过的坑和总结的应对策略。

### 6.1 Choreography 模式的典型陷阱

#### 陷阱一：事件链断裂导致数据不一致

在 Choreography 中，事件链是分散的——如果中间某个 Listener 处理失败，后续事件不会触发，数据就静默地不一致了。

```php
// ❌ 错误示例：Listener 异常会导致后续事件链断裂
class ReserveInventory
{
    public function handle(OrderCreated $event): void
    {
        // 如果这里抛出异常，InventoryReserved 不会被 dispatch
        foreach ($event->items as $item) {
            Inventory::where('product_id', $item['product_id'])
                ->decrement('stock', $item['quantity']);
        }
        InventoryReserved::dispatch($event->order);
    }
}
```

**解决方案：使用带重试的队列 + 死信队列（DLQ）：**

```php
// ✅ 正确做法：Listener 实现 ShouldQueue + 重试 + 失败回退
class ReserveInventory implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $backoff = 30; // 重试间隔递增：30s, 60s, 120s, ...

    public function handle(OrderCreated $event): void
    {
        foreach ($event->items as $item) {
            $updated = Inventory::where('product_id', $item['product_id'])
                ->where('stock', '>=', $item['quantity'])
                ->decrement('stock', $item['quantity']);

            if ($updated === 0) {
                // 库存不足，主动抛出异常触发重试
                throw new InsufficientStockException(
                    "Product {$item['product_id']} out of stock"
                );
            }
        }

        InventoryReserved::dispatch($event->order);
    }

    public function failed(OrderCreated $event, \Throwable $exception): void
    {
        // 进入死信队列，人工介入或告警
        Log::critical('Inventory reservation failed', [
            'order_id' => $event->order->id,
            'error' => $exception->getMessage(),
        ]);
        // 发布失败事件，通知订单服务回滚
        InventoryReservationFailed::dispatch($event->order, $exception->getMessage());
    }
}
```

#### 陷阱二：隐式依赖导致事件顺序问题

当多个 Listener 同时监听同一个事件时，执行顺序是不确定的。如果 Listener B 依赖 Listener A 的结果，就会出问题。

```php
// ❌ 危险模式：两个 Listener 同时监听 OrderCreated
// 但 SendOrderConfirmation 需要等 ReserveInventory 完成
OrderCreated::class => [
    ReserveInventory::class,      // 可能先执行
    SendOrderConfirmation::class, // 可能先执行！
];
```

**解决方案：事件链分级 + 显式中间事件：**

```php
// ✅ 正确做法：使用中间事件形成明确的事件链
// OrderCreated → ReserveInventory → InventoryReserved → SendConfirmation
// 而非 OrderCreated → [ReserveInventory, SendConfirmation] 并行

protected $listen = [
    OrderCreated::class => [
        ReserveInventory::class,  // 完成后发布 InventoryReserved
    ],
    InventoryReserved::class => [
        ProcessPayment::class,    // 完成后发布 PaymentProcessed
    ],
    PaymentProcessed::class => [
        SendOrderConfirmation::class, // 确保在支付完成后才发通知
    ],
];
```

#### 陷阱三：事件风暴（Event Storm）

一个事件触发了多个 Listener，每个 Listener 又发布新事件，新事件又触发更多 Listener，形成指数级事件风暴。

```php
// ❌ 危险模式：事件级联放大
// OrderCreated → 3 Listeners → 每个发布新事件 → 9 个新事件 → ...
```

**解决方案：设置事件处理深度限制和熔断：**

```php
// 在事件中携带处理深度元数据
class OrderCreated
{
    public function __construct(
        public readonly Order $order,
        public readonly array $items,
        public readonly int $chainDepth = 0, // 事件链深度
    ) {}

    public function shouldProcess(int $maxDepth = 5): bool
    {
        return $this->chainDepth < $maxDepth;
    }
}

// Listener 中检查深度
class SomeListener
{
    public function handle(OrderCreated $event): void
    {
        if (!$event->shouldProcess()) {
            Log::warning('Event chain depth exceeded, skipping');
            return;
        }
        // ... 业务逻辑
    }
}
```

### 6.2 Orchestration 模式的典型陷阱

#### 陷阱一：Orchestrator 成为上帝类（God Class）

随着业务增长，Orchestrator 会不断膨胀，最终变成一个包含所有业务逻辑的怪物类。

```php
// ❌ 典型的"上帝 Orchestrator"——包含所有业务逻辑
class OrderOrchestrator
{
    public function process(Order $order): string
    {
        // 500 行代码，包含验证、库存、支付、发货、通知、积分、退款...
    }
}
```

**解决方案：职责分离，Orchestrator 只负责流程编排：**

```php
// ✅ 正确做法：Orchestrator 只编排，不包含业务逻辑
class OrderOrchestrator
{
    public function __construct(
        private readonly InventoryStep $inventory,
        private readonly PaymentStep $payment,
        private readonly ShippingStep $shipping,
        private readonly NotificationStep $notification,
    ) {}

    public function process(Order $order): WorkflowResult
    {
        // 每一步都是独立的 Activity/Step，职责清晰
        $inventoryResult = $this->inventory->reserve($order);
        if ($inventoryResult->failed()) {
            return WorkflowResult::failed('insufficient_stock');
        }

        $paymentResult = $this->payment->charge($order);
        if ($paymentResult->failed()) {
            $this->inventory->release($order); // 补偿
            return WorkflowResult::failed('payment_failed');
        }

        $this->shipping->createTask($order);
        $this->notification->sendConfirmation($order);

        return WorkflowResult::success();
    }
}
```

#### 陷阱二：补偿逻辑不完整（Partial Compensation）

这是 Saga 模式最常见的问题——前序步骤都执行成功了，但后续步骤失败，需要回滚。如果补偿逻辑不完整，数据就会不一致。

```php
// ❌ 补偿逻辑遗漏：只补偿了库存，没有补偿积分
try {
    $this->inventory->reserve($order);
    $this->payment->charge($order);
    $this->loyalty->addPoints($order); // 积分加了
    $this->shipping->createTask($order); // 这里失败了！
} catch (\Exception $e) {
    $this->payment->refund($order);
    $this->inventory->release($order);
    // ❌ 遗漏：$this->loyalty->deductPoints($order)
}
```

**解决方案：使用 Saga 补偿表显式记录每一步：**

```php
// ✅ 正确做法：使用补偿日志确保每一步都有对应回滚
class SagaOrchestrator
{
    private array $compensationLog = [];

    public function execute(Order $order): void
    {
        try {
            $this->executeStep('reserve_inventory', $order, function () use ($order) {
                return InventoryService::reserve($order);
            });

            $this->executeStep('charge_payment', $order, function () use ($order) {
                return PaymentService::charge($order);
            });

            $this->executeStep('add_loyalty', $order, function () use ($order) {
                return LoyaltyService::addPoints($order);
            });

            $this->executeStep('create_shipping', $order, function () use ($order) {
                return ShippingService::createTask($order);
            });
        } catch (\Exception $e) {
            $this->compensate($order, $e);
        }
    }

    private function executeStep(
        string $stepName,
        Order $order,
        callable $action
    ): void {
        $result = $action();
        // 记录补偿函数，按逆序执行
        $this->compensationLog[$stepName] = fn() => match ($stepName) {
            'reserve_inventory' => InventoryService::release($order),
            'charge_payment' => PaymentService::refund($order),
            'add_loyalty' => LoyaltyService::deductPoints($order),
            'create_shipping' => ShippingService::cancelTask($order),
        };
    }

    private function compensate(Order $order, \Throwable $error): void
    {
        // 逆序执行补偿
        foreach (array_reverse($this->compensationLog) as $step => $compensate) {
            try {
                $compensate();
                Log::info("Compensation completed: {$step}");
            } catch (\Exception $e) {
                // 补偿失败也要记录，可能需要人工介入
                Log::critical("Compensation failed: {$step}", [
                    'order_id' => $order->id,
                    'original_error' => $error->getMessage(),
                    'compensation_error' => $e->getMessage(),
                ]);
            }
        }
    }
}
```

#### 陷阱三：Orchestrator 长时间阻塞

同步编排时，如果某个 Step 执行时间很长（如第三方支付回调等待），Orchestrator 会一直阻塞，占用资源。

**解决方案：使用异步等待 + 超时机制：**

```php
// ✅ 使用 Laravel Workflow 的异步等待能力
class PaymentWaitOrchestrator extends Workflow
{
    public function execute(Order $order): string
    {
        // 提交支付请求
        $this->activity(SubmitPaymentActivity::class, [
            'order_id' => $order->id,
            'amount' => $order->total_amount,
        ]);

        // 异步等待支付回调（最长 30 分钟）
        $result = yield ActivityWithTimeout::make(
            WaitForPaymentCallbackActivity::class,
            ['order_id' => $order->id],
            timeout: 1800 // 30 分钟
        );

        if ($result === 'timeout') {
            $this->activity(CancelOrderActivity::class, ['order_id' => $order->id]);
            return 'payment_timeout';
        }

        $this->activity(ConfirmOrderActivity::class, ['order_id' => $order->id]);
        return 'completed';
    }
}
```

### 6.3 两种模式共同面临的挑战

#### 幂等性保障

无论哪种模式，消费者/Activity 都可能被重复调用（网络重试、消息重发）。每个处理逻辑都必须是幂等的。

```php
// ✅ 幂等性保障：使用幂等键表
class ProcessPaymentActivity
{
    public function execute(int $orderId, float $amount): PaymentResult
    {
        $idempotencyKey = "payment:order:{$orderId}";

        // 检查是否已处理
        if ($existing = IdempotencyKey::find($idempotencyKey)) {
            return PaymentResult::from($existing->response);
        }

        // 处理支付
        $result = PaymentGateway::charge($amount);

        // 记录幂等键
        IdempotencyKey::create([
            'key' => $idempotencyKey,
            'response' => $result->toArray(),
            'expires_at' => now()->addDays(30),
        ]);

        return $result;
    }
}
```

#### 可观测性（Observability）

分布式系统中最难的不是写代码，而是排查问题。无论哪种模式，都需要完善的可观测性。

```php
// ✅ 使用 Correlation ID 串联整个调用链
class CorrelationMiddleware
{
    public function handle($request, Closure $next)
    {
        $correlationId = $request->header('X-Correlation-Id')
            ?? (string) Str::uuid();

        // 写入上下文，所有后续日志都会带上
        Log::withContext(['correlation_id' => $correlationId]);
        app()->instance('correlation_id', $correlationId);

        $response = $next($request);
        $response->headers->set('X-Correlation-Id', $correlationId);

        return $response;
    }
}

// 在事件中携带 Correlation ID
class OrderCreated
{
    public function __construct(
        public readonly Order $order,
        public readonly array $items,
        public readonly string $correlationId,
    ) {}
}

// 在 Listener 中记录链路
class ReserveInventory
{
    public function handle(OrderCreated $event): void
    {
        Log::info('Reserving inventory', [
            'correlation_id' => $event->correlationId,
            'order_id' => $event->order->id,
            'step' => 'reserve_inventory',
        ]);
        // ...
    }
}
```

### 6.4 踩坑案例：真实项目中的教训

#### 案例一：Choreography 下的订单"幽灵状态"

**问题描述：** 一个电商系统的订单创建流程使用 Choreography 模式。用户下单后，库存服务扣减成功但支付服务超时。由于事件链断裂，订单状态永远停在"待支付"，但库存已经被扣掉了。用户重新下单时发现库存不足。

**根因分析：**
- 事件处理失败后没有重试机制
- 没有设置事件过期时间，过时的事件被延迟消费后产生冲突
- 缺少全局的流程状态检查点

**解决方案：**
1. 引入事件过期时间（TTL），过期事件自动丢弃
2. 添加定时对账任务，扫描异常订单状态
3. 关键路径改用 Orchestration，辅助流程保持 Choreography

#### 案例二：Orchestrator 性能瓶颈

**问题描述：** 一个订单处理 Orchestrator 需要串行调用 8 个服务，每个服务平均耗时 200ms，总耗时 1.6 秒。高并发时 Orchestrator 线程池耗尽，整个系统响应变慢。

**根因分析：**
- 所有步骤串行执行，但部分步骤之间没有依赖关系
- Orchestrator 使用同步调用，没有利用并行能力

**解决方案：**

```php
// ✅ 将无依赖关系的步骤并行执行
class OptimizedOrderOrchestrator extends Workflow
{
    public function execute(Order $order): string
    {
        // 步骤 1：验证库存（必须先完成）
        yield $this->activity(ValidateInventoryActivity::class, $order->id);

        // 步骤 2-3：库存预留 + 风控检查（可并行）
        yield Promise::all([
            $this->activity(ReserveInventoryActivity::class, $order->id),
            $this->activity(RiskCheckActivity::class, $order->id),
        ]);

        // 步骤 4：支付（依赖前面的结果）
        $paymentResult = yield $this->activity(
            ProcessPaymentActivity::class, $order->id
        );

        // 步骤 5-7：后续操作（可并行）
        yield Promise::all([
            $this->activity(UpdateOrderStatusActivity::class, $order->id),
            $this->activity(CreateShippingActivity::class, $order->id),
            $this->activity(SendNotificationActivity::class, $order->id),
        ]);

        return 'completed';
    }
}
// 总耗时从 1.6s 降到 ~0.8s
```

---

## 七、扩展对比：与其他分布式模式的关系

Choreography 和 Orchestration 并非孤立存在，它们与 Saga、CQRS、Event Sourcing 等模式有着密切的关系。

### 7.1 与 Saga 模式的关系

**Saga = Orchestration/Choreography + 补偿事务。** Saga 本质上是一种分布式事务管理策略，而 Choreography 和 Orchestration 是 Saga 的两种实现方式。

| Saga 实现方式 | 编排模式 | 适用场景 |
|---|---|---|
| **Saga Choreography** | 每个服务监听事件并执行本地事务 + 发布补偿事件 | 步骤少（< 5），简单流程 |
| **Saga Orchestration** | Orchestrator 调用各服务并管理补偿逻辑 | 步骤多，复杂条件分支 |

### 7.2 与 CQRS + Event Sourcing 的关系

**CQRS（命令查询职责分离）** 和 **Event Sourcing（事件溯源）** 天然适合 Choreography 模式：

- **Event Sourcing** 将状态变更存储为事件序列，与 Choreography 的事件驱动完美契合
- **CQRS** 的写端发布事件，读端消费事件构建查询模型，本质就是一种 Choreography

```php
// CQRS + Event Sourcing 在 Laravel 中的实现
class OrderAggregate
{
    private array $events = [];

    public function createOrder(array $items): void
    {
        // 命令验证
        $this->recordEvent(new OrderCreated($items));
    }

    public function pay(string $transactionId): void
    {
        $this->recordEvent(new OrderPaid($transactionId));
    }

    private function recordEvent(DomainEvent $event): void
    {
        $this->events[] = $event;
        // 事件存储 + 事件发布（Choreography 的基础）
        EventStore::append($event);
        event($event); // 触发 Laravel 事件系统
    }
}
```

### 7.3 与消息队列的选型关系

消息中间件的选择会直接影响 Choreography 的实现质量：

| 特性 | RabbitMQ | Kafka | Redis Stream |
|---|---|---|---|
| 消息持久化 | ✅ | ✅ | ✅（AOF） |
| 消费者组 | ✅ | ✅ | ✅ |
| 消息回溯 | ❌ | ✅ | ✅ |
| 延迟消息 | ✅（插件） | ❌ | ❌ |
| 吞吐量 | 中 | 高 | 中高 |
| 运维复杂度 | 中 | 高 | 低 |
| 适合场景 | 传统微服务 | 大数据/日志 | 轻量级/快速启动 |

---

## 八、总结

| | Choreography | Orchestration |
|---|---|---|
| **一句话总结** | 服务通过事件自主协作 | 协调者统一指挥服务 |
| **Laravel 实现** | Event + Listener + Queue | Pipeline + Workflow / Temporal |
| **最大优势** | 松耦合、可扩展 | 流程清晰、易调试 |
| **最大风险** | 流程难以追踪、隐式依赖 | 协调者成为单点、强耦合 |
| **适合团队** | 小团队、独立服务 | 大团队、复杂流程 |
| **一致性** | 最终一致性 | 强一致性（通过补偿） |
| **监控难度** | 高（需要分布式追踪） | 低（集中式日志） |
| **扩展成本** | 低（订阅新事件即可） | 中（需修改工作流） |

**最终建议：** 不要教条地选择某一种模式。理解业务复杂度和技术团队的运维能力，将 Choreography 的灵活性与 Orchestration 的可控性结合，才是构建可演进微服务架构的正确路径。

**快速决策清单：**
1. 流程 ≤ 3 步且无强一致性要求 → **Choreography**
2. 流程 ≥ 5 步且有补偿事务需求 → **Orchestration**
3. 核心交易流程 + 辅助通知流程 → **混合模式**
4. 已有 Kafka/RabbitMQ → Choreography 实现成本低
5. 需要可视化流程监控 → Orchestration（配合 Temporal 或 Laravel Workflow）

---

## 相关阅读

- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/post/saga-orchestration-pattern-laravel-distributed-transaction/)
- [Data Consistency Patterns 实战：Saga/TCC/2PC/XA 在 Laravel 中的选型决策树](/post/data-consistency-patterns-laravel-saga-tcc-2pc-xa/)
- [Kafka vs NATS vs Pulsar 2026 实战：三大消息队列深度对比——Laravel 微服务选型](/post/kafka-nats-pulsar-laravel/)
