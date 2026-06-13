---

title: Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比
keywords: [Saga, Choreography vs Orchestration vs Temporal, Laravel, 编排模式深度实战, 分布式事务的三种实现路线对比]
date: 2026-06-05 10:00:00
tags:
- Saga
- 分布式
- Laravel
- 微服务
- Temporal
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: Saga 分布式事务模式深度实战，对比 Choreography 编舞模式、Orchestration 编排模式与 Temporal 工作流引擎三种实现路线。基于 Laravel 代码示例演示补偿事务、语义锁定、发件箱模式等核心机制，分析事件驱动架构下的最终一致性保障策略。涵盖超时熔断、可观测性、幂等性设计等生产级关注点，帮助架构师在微服务场景中做出合理的一致性与可用性权衡决策。
---



## 引言：为什么需要 Saga？单体事务 vs 分布式事务的困境

在单体应用时代，一个数据库事务就能解决几乎所有问题。用户下单时，我们可以在同一个 MySQL 事务中完成「扣减库存 → 创建订单 → 扣款 → 记录日志」这一系列操作，任何一步失败，`ROLLBACK` 就能让一切回到原点。这种模型简单、可靠，是绝大多数 Laravel 开发者的舒适区。

然而，当系统演进到微服务架构后，事情变得复杂了。订单服务、库存服务、支付服务、通知服务各自拥有独立的数据库，传统的 `BEGIN/COMMIT/ROLLBACK` 跨库事务不再适用。你无法在一个 HTTP 请求中同时操作四个服务的数据库——网络分区、服务宕机、消息延迟都可能让流程中断，而你既不能回滚远程操作，也不能假设"后面的步骤一定会成功"。

这就是分布式事务的核心困境：**如何在没有全局事务管理器的情况下，保证多个服务之间的数据一致性？**

传统的解决方案如 XA 两阶段提交（2PC）虽然理论完美，但在实际生产中问题重重：同步阻塞导致性能低下、协调者单点故障、锁持有时间过长……对于高吞吐的互联网应用，2PC 往往是不可接受的。

Saga 模式应运而生。它由 Hector Garcia-Molina 和 Kenneth Salem 在 1987 年提出，核心思想极其优雅：**将一个长事务拆分为一系列本地事务，每个本地事务都有对应的补偿操作；如果某一步失败，就按逆序执行之前所有步骤的补偿操作，实现最终一致性。**

## Saga 模式核心概念

### 补偿事务（Compensating Transaction）

补偿事务是 Saga 的灵魂。它不是"回滚"，而是一个独立的新操作，用来抵消之前操作的业务效果。例如：

- **正向操作**：扣减库存 10 件
- **补偿操作**：恢复库存 10 件（而非删除库存记录）

这里有一个关键区别：补偿操作必须是**语义上**的逆转，而不是数据库层面的撤销。因为正向操作可能已经被其他事务读取并使用，简单的回滚会破坏其他服务的数据完整性。

### 语义锁定（Semantic Lock）

在 Saga 执行过程中，资源处于一种"中间状态"。订单可能处于 `pending` 而非 `confirmed`，库存可能被标记为 `reserved` 而非 `deducted`。这种中间状态就是语义锁定——它告诉其他业务流程"这个资源正在被某个 Saga 使用，请勿修改"。

在 Laravel 中，我们通常用状态字段来实现语义锁定：

```php
// 订单状态机
enum OrderStatus: string
{
    case Pending    = 'pending';      // Saga 刚启动
    case StockReserved = 'stock_reserved'; // 库存已预留
    case Paid       = 'paid';         // 支付完成
    case Confirmed  = 'confirmed';    // Saga 成功完成
    case Cancelled  = 'cancelled';    // Saga 被补偿
}
```

### 最终一致性（Eventual Consistency）

Saga 不保证强一致性，它保证的是最终一致性——如果所有步骤都成功，系统最终会到达一致状态；如果某一步失败，补偿操作会让系统最终回到一致状态。但在这个"最终"到来之前，系统可能处于不一致的中间态。

这意味着你的业务必须能够容忍短暂的不一致。比如用户下单后，可能需要等几秒钟才能在订单列表中看到"已确认"的状态。这是 Saga 模式的基本假设，也是架构师需要和业务方沟通清楚的关键点。

## 方案一：Choreography 模式——事件驱动的去中心化编排

### 核心思想

Choreography（编舞）模式的灵感来自舞蹈编排：没有一个中心指挥，每个舞者（服务）根据音乐（事件）自主行动。每个服务完成自己的操作后，发布一个领域事件，其他服务监听这些事件并执行自己的逻辑。

**流程图示：**

```
订单服务 --[OrderCreated]--> 库存服务
库存服务 --[StockReserved]--> 支付服务
支付服务 --[PaymentCompleted]--> 通知服务
通知服务 --[NotificationSent]--> 订单服务（标记完成）
```

### Laravel 实现

在 Laravel 中，我们可以用事件系统 + 消息队列来实现 Choreography。首先用 `artisan make:event` 创建领域事件：

```php
// app/Events/OrderCreated.php
class OrderCreated
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly string $orderId,
        public readonly string $userId,
        public readonly array  $items,
        public readonly string $correlationId,
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('order-events');
    }
}
```

```php
// app/Events/StockReserved.php
class StockReserved
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly string $orderId,
        public readonly string $correlationId,
    ) {}
}

// app/Events/StockReservationFailed.php
class StockReservationFailed
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly string $orderId,
        public readonly string $reason,
        public readonly string $correlationId,
    ) {}
}
```

库存服务的监听器：

```php
// app/Listeners/ReserveStockListener.php
class ReserveStockListener
{
    public function handle(OrderCreated $event): void
    {
        try {
            DB::transaction(function () use ($event) {
                foreach ($event->items as $item) {
                    $affected = Stock::where('product_id', $item['product_id'])
                        ->where('quantity', '>=', $item['quantity'])
                        ->decrement('quantity', $item['quantity']);

                    if ($affected === 0) {
                        throw new InsufficientStockException($item['product_id']);
                    }

                    // 记录预留，用于补偿
                    StockReservation::create([
                        'order_id'    => $event->orderId,
                        'product_id'  => $item['product_id'],
                        'quantity'    => $item['quantity'],
                        'status'      => 'reserved',
                        'correlation_id' => $event->correlationId,
                    ]);
                }
            });

            // 库存预留成功，发布事件触发支付
            StockReserved::dispatch($event->orderId, $event->correlationId);

        } catch (InsufficientStockException $e) {
            // 库存不足，发布失败事件
            StockReservationFailed::dispatch(
                $event->orderId, $e->getMessage(), $event->correlationId
            );
        }
    }
}
```

支付服务的监听器：

```php
// app/Listeners/ProcessPaymentListener.php
class ProcessPaymentListener
{
    public function __construct(
        private PaymentGateway $gateway,
    ) {}

    public function handle(StockReserved $event): void
    {
        try {
            $order = Order::findOrFail($event->orderId);

            $result = $this->gateway->charge(
                $order->user_id,
                $order->total_amount,
                "Order #{$event->orderId}"
            );

            Payment::create([
                'order_id'    => $event->orderId,
                'transaction_id' => $result->transactionId,
                'amount'      => $order->total_amount,
                'status'      => 'completed',
                'correlation_id' => $event->correlationId,
            ]);

            PaymentCompleted::dispatch($event->orderId, $event->correlationId);

        } catch (PaymentFailedException $e) {
            // 支付失败，需要补偿库存
            StockReservationCancelled::dispatch(
                $event->orderId, $e->getMessage(), $event->correlationId
            );
            // 同时通知订单取消
            OrderCancelled::dispatch($event->orderId, $e->getMessage(), $event->correlationId);
        }
    }
}
```

补偿监听器（库存回滚）：

```php
// app/Listeners/CompensateStockListener.php
class CompensateStockListener
{
    public function handle(OrderCancelled $event): void
    {
        $reservations = StockReservation::where('order_id', $event->orderId)
            ->where('status', 'reserved')
            ->get();

        foreach ($reservations as $reservation) {
            DB::transaction(function () use ($reservation) {
                Stock::where('product_id', $reservation->product_id)
                    ->increment('quantity', $reservation->quantity);

                $reservation->update(['status' => 'compensated']);
            });
        }
    }
}
```

服务提供者中注册事件映射：

```php
// app/Providers/EventServiceProvider.php
protected $listen = [
    OrderCreated::class               => [ReserveStockListener::class],
    StockReserved::class              => [ProcessPaymentListener::class],
    StockReservationFailed::class     => [CompensateStockListener::class],
    PaymentCompleted::class           => [SendNotificationListener::class],
    OrderCancelled::class             => [CompensateStockListener::class],
];
```

### Choreography 的优势

1. **低耦合**：服务之间只通过事件通信，不需要知道彼此的存在
2. **高可用**：没有单点故障，每个服务独立运行
3. **易于扩展**：新增一个步骤只需添加新的事件监听器
4. **符合单一职责**：每个服务只关心自己的业务逻辑

### Choreography 的劣势

1. **流程不可见**：没有一个地方可以看到完整的业务流程
2. **调试困难**：出问题时需要追踪多个服务的事件链
3. **补偿逻辑分散**：补偿逻辑散落在各个服务中，难以保证一致性
4. **循环依赖风险**：服务之间的事件依赖关系可能变成网状结构

## 方案二：Orchestration 模式——中心协调器的状态机

### 核心思想

Orchestration（管弦乐编排）模式引入一个中心化的协调器（Orchestrator），由它来指挥整个 Saga 的执行流程。协调器知道每一步该做什么、失败了该怎么补偿，就像乐队指挥一样控制节奏。

```
                    ┌─────────────┐
                    │ Orchestrator │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   订单服务            库存服务            支付服务
```

### Laravel 实现

首先定义 Saga 步骤和 Saga 状态：

```php
// app/Sagas/OrderSagaStep.php
enum OrderSagaStep: string
{
    case CreateOrder      = 'create_order';
    case ReserveStock     = 'reserve_stock';
    case ProcessPayment   = 'process_payment';
    case SendNotification = 'send_notification';
    case Completed        = 'completed';
    case Failed           = 'failed';
}
```

```php
// app/Sagas/OrderSagaState.php
class OrderSagaState
{
    private string $state = 'pending';
    private array  $completedSteps = [];
    private ?string $failureReason = null;

    public function __construct(
        public readonly string $orderId,
        public readonly string $correlationId,
        public readonly array  $orderData,
    ) {}

    public function markStepCompleted(OrderSagaStep $step): void
    {
        $this->completedSteps[] = $step;
    }

    public function markFailed(string $reason): void
    {
        $this->state = 'failed';
        $this->failureReason = $reason;
    }

    public function markCompleted(): void
    {
        $this->state = 'completed';
    }

    public function getCompletedSteps(): array
    {
        return $this->completedSteps;
    }

    public function isFailed(): bool
    {
        return $this->state === 'failed';
    }
}
```

核心协调器实现：

```php
// app/Sagas/OrderSagaOrchestrator.php
class OrderSagaOrchestrator
{
    private array $steps = [];
    private array $compensations = [];

    public function __construct(
        private OrderService $orderService,
        private StockService $stockService,
        private PaymentService $paymentService,
        private NotificationService $notificationService,
    ) {
        $this->registerSteps();
    }

    private function registerSteps(): void
    {
        $this->steps = [
            OrderSagaStep::CreateOrder => fn(OrderSagaState $state) =>
                $this->orderService->create($state->orderData, $state->correlationId),

            OrderSagaStep::ReserveStock => fn(OrderSagaState $state) =>
                $this->stockService->reserve($state->orderId, $state->orderData['items']),

            OrderSagaStep::ProcessPayment => fn(OrderSagaState $state) =>
                $this->paymentService->charge($state->orderId),

            OrderSagaStep::SendNotification => fn(OrderSagaState $state) =>
                $this->notificationService->sendOrderConfirmation($state->orderId),
        ];

        // 注意：补偿操作的注册顺序与执行顺序相反
        $this->compensations = [
            OrderSagaStep::CreateOrder => fn(OrderSagaState $state) =>
                $this->orderService->cancel($state->orderId),

            OrderSagaStep::ReserveStock => fn(OrderSagaState $state) =>
                $this->stockService->release($state->orderId),

            OrderSagaStep::ProcessPayment => fn(OrderSagaState $state) =>
                $this->paymentService->refund($state->orderId),

            // SendNotification 不需要补偿——通知已发出无法撤回
        ];
    }

    public function execute(array $orderData): OrderSagaState
    {
        $state = new OrderSagaState(
            orderId: Str::uuid()->toString(),
            correlationId: Str::uuid()->toString(),
            orderData: $orderData,
        );

        foreach ($this->steps as $step => $action) {
            try {
                $action($state);
                $state->markStepCompleted($step);

                // 持久化状态到数据库，防止协调器崩溃
                $this->persistState($state, $step);

            } catch (\Throwable $e) {
                $state->markFailed($e->getMessage());

                // 执行补偿——逆序回滚已完成的步骤
                $this->compensate($state);

                Log::error("Saga failed at step {$step->value}", [
                    'order_id'       => $state->orderId,
                    'correlation_id' => $state->correlationId,
                    'error'          => $e->getMessage(),
                ]);

                throw new SagaExecutionException($step, $e);
            }
        }

        $state->markCompleted();
        return $state;
    }

    private function compensate(OrderSagaState $state): void
    {
        $completedSteps = array_reverse($state->getCompletedSteps());

        foreach ($completedSteps as $step) {
            if (!isset($this->compensations[$step])) {
                continue;
            }

            try {
                ($this->compensations[$step])($state);
                Log::info("Compensation completed for step {$step->value}", [
                    'order_id' => $state->orderId,
                ]);
            } catch (\Throwable $e) {
                // 补偿失败是严重问题，记录并告警
                Log::critical("Compensation FAILED for step {$step->value}", [
                    'order_id' => $state->orderId,
                    'error'    => $e->getMessage(),
                ]);

                // 将失败的补偿放入死信队列，等待人工介入
                $this->pushToDeadLetterQueue($state, $step, $e);
            }
        }
    }

    private function persistState(OrderSagaState $state, OrderSagaStep $step): void
    {
        SagaExecution::updateOrCreate(
            ['correlation_id' => $state->correlationId],
            [
                'order_id'       => $state->orderId,
                'current_step'   => $step->value,
                'completed_steps' => $state->getCompletedSteps(),
                'status'         => $state->isFailed() ? 'failed' : 'in_progress',
                'state_data'     => json_encode($state->orderData),
            ]
        );
    }

    private function pushToDeadLetterQueue(
        OrderSagaState $state,
        OrderSagaStep $step,
        \Throwable $error
    ): void {
        DB::table('saga_dead_letters')->insert([
            'correlation_id' => $state->correlationId,
            'order_id'       => $state->orderId,
            'failed_step'    => $step->value,
            'error'          => $error->getMessage(),
            'state_snapshot'  => json_encode($state),
            'created_at'     => now(),
        ]);
    }
}
```

使用 Laravel Pipeline 的优雅替代方案：

```php
// 利用 Pipeline 模式实现更流式的编排
public function executeWithPipeline(array $orderData): OrderSagaState
{
    $state = new OrderSagaState(
        orderId: Str::uuid()->toString(),
        correlationId: Str::uuid()->ToString(),
        orderData: $orderData,
    );

    try {
        app(Pipeline::class)
            ->send($state)
            ->through([
                CreateOrderPipe::class,
                ReserveStockPipe::class,
                ProcessPaymentPipe::class,
                SendNotificationPipe::class,
            ])
            ->thenReturn();

    } catch (SagaStepException $e) {
        $this->compensate($state);
        throw $e;
    }

    return $state;
}
```

每个 Pipe 的实现：

```php
// app/Sagas/Pipes/CreateOrderPipe.php
class CreateOrderPipe
{
    public function __construct(private OrderService $service) {}

    public function handle(OrderSagaState $state, \Closure $next): OrderSagaState
    {
        $this->service->create($state->orderData, $state->correlationId);
        $state->markStepCompleted(OrderSagaStep::CreateOrder);

        return $next($state);
    }
}
```

### Orchestration 的优势

1. **流程可见**：所有步骤在一个类中定义，一目了然
2. **易于调试**：可以在协调器中添加断点、日志、监控
3. **集中管理补偿**：补偿逻辑集中定义，不会遗漏
4. **状态持久化**：可以将 Saga 状态存储到数据库，支持恢复

### Orchestration 的劣势

1. **单点风险**：协调器是单点，需要做好高可用
2. **耦合度高**：协调器需要知道所有服务的接口
3. **协调器膨胀**：随着业务增长，协调器可能变得臃肿

## 方案三：Temporal.io——持久化工作流引擎

### 核心思想

Temporal 是一个持久化工作流引擎，它将工作流定义为代码（Workflow as Code），底层自动处理重试、超时、故障恢复等分布式系统难题。开发者只需关注业务逻辑，不用操心基础设施问题。

### PHP SDK 集成

首先安装 Temporal PHP SDK：

```bash
composer require temporal/sdk
```

定义 Activity（每个最小操作单元）：

```php
// app/Temporal/Activities/OrderActivities.php
use Temporal\Activity\ActivityInterface;
use Temporal\Activity\ActivityMethod;

#[ActivityInterface]
class OrderActivities
{
    public function __construct(
        private OrderService $orderService,
        private StockService $stockService,
        private PaymentService $paymentService,
        private NotificationService $notificationService,
    ) {}

    #[ActivityMethod]
    public function createOrder(array $orderData): string
    {
        return $this->orderService->create($orderData);
    }

    #[ActivityMethod]
    public function reserveStock(string $orderId, array $items): bool
    {
        return $this->stockService->reserve($orderId, $items);
    }

    #[ActivityMethod]
    public function processPayment(string $orderId): string
    {
        return $this->paymentService->charge($orderId);
    }

    #[ActivityMethod]
    public function sendNotification(string $orderId, string $type): bool
    {
        return $this->notificationService->send($orderId, $type);
    }

    // 补偿 Activity
    #[ActivityMethod]
    public function cancelOrder(string $orderId): bool
    {
        return $this->orderService->cancel($orderId);
    }

    #[ActivityMethod]
    public function releaseStock(string $orderId): bool
    {
        return $this->stockService->release($orderId);
    }

    #[ActivityMethod]
    public function refundPayment(string $orderId): bool
    {
        return $this->paymentService->refund($orderId);
    }
}
```

定义 Workflow（核心编排逻辑）：

```php
// app/Temporal/Workflows/OrderWorkflow.php
use Temporal\Workflow\WorkflowInterface;
use Temporal\Workflow\WorkflowMethod;
use Temporal\Workflow\ActivityOptions;
use Temporal\Common\RetryOptions;
use Temporal\Activity\ActivityOptions as ActOpts;

#[WorkflowInterface]
class OrderWorkflow
{
    private array $completedActivities = [];

    #[WorkflowMethod]
    public function processOrder(CreateOrderRequest $request): OrderResult
    {
        // 配置 Activity 选项：超时、重试策略
        $activityOptions = ActivityOptions::new()
            ->withStartToCloseTimeout(CarbonInterval::seconds(30))
            ->withRetryOptions(
                RetryOptions::new()
                    ->withMaximumAttempts(3)
                    ->withInitialInterval(CarbonInterval::seconds(1))
                    ->withBackoffCoefficient(2.0)
                    ->withMaximumInterval(CarbonInterval::seconds(30))
            );

        $activities = Workflow::newActivityStub(
            OrderActivities::class,
            $activityOptions
        );

        try {
            // Step 1: 创建订单
            $orderId = $activities->createOrder($request->toArray());
            $this->completedActivities[] = 'createOrder';

            // Step 2: 预留库存
            $activities->reserveStock($orderId, $request->items);
            $this->completedActivities[] = 'reserveStock';

            // Step 3: 处理支付
            $transactionId = $activities->processPayment($orderId);
            $this->completedActivities[] = 'processPayment';

            // Step 4: 发送通知
            $activities->sendNotification($orderId, 'order_confirmed');

            return new OrderResult(
                success: true,
                orderId: $orderId,
                transactionId: $transactionId,
            );

        } catch (\Throwable $e) {
            // 执行补偿
            yield $this->compensate($activities, $orderId);

            return new OrderResult(
                success: false,
                orderId: $orderId ?? null,
                error: $e->getMessage(),
            );
        }
    }

    /**
     * 补偿逻辑：逆序回滚已完成的 Activity
     */
    private async function compensate(
        OrderActivities $activities,
        ?string $orderId
    ): void {
        $reverseSteps = array_reverse($this->completedActivities);

        foreach ($reverseSteps as $step) {
            match ($step) {
                'processPayment' => $activities->refundPayment($orderId),
                'reserveStock'   => $activities->releaseStock($orderId),
                'createOrder'    => $activities->cancelOrder($orderId),
                default          => null,
            };
        }
    }
}
```

启动 Worker 和调用 Workflow：

```php
// app/Console/Commands/TemporalWorkerCommand.php
class TemporalWorkerCommand extends Command
{
    protected $signature = 'temporal:worker';
    protected $description = 'Start Temporal worker';

    public function handle(): void
    {
        $worker = WorkerFactory::create();

        // 注册 Workflow 和 Activity
        $worker->registerWorkflowTypes(OrderWorkflow::class);
        $worker->registerActivityImplementations(
            new OrderActivities(
                app(OrderService::class),
                app(StockService::class),
                app(PaymentService::class),
                app(NotificationService::class),
            )
        );

        $worker->run();
    }
}

// 在 Controller 中发起 Workflow
class OrderController extends Controller
{
    public function store(OrderRequest $request)
    {
        $client = WorkflowClient::create('localhost:7233');

        $workflow = $client->newWorkflowStub(
            OrderWorkflow::class,
            WorkflowOptions::new()
                ->withTaskQueue('order-queue')
                ->withWorkflowExecutionTimeout(CarbonInterval::minutes(5))
        );

        // 异步执行
        $run = $client->start($workflow, CreateOrderRequest::fromRequest($request));

        return response()->json([
            'workflow_id' => $run->getID(),
            'run_id'      => $run->getRunID(),
            'message'     => 'Order processing started',
        ]);
    }

    // 查询 Workflow 状态
    public function status(string $workflowId)
    {
        $client = WorkflowClient::create('localhost:7233');
        $workflow = $client->newWorkflowStubById($workflowId);

        return response()->json([
            'status' => $workflow->query('status'),
        ]);
    }
}
```

### Temporal 的优势

1. **持久化执行**：Workflow 代码可以运行数天甚至数月，自动从故障中恢复
2. **内置重试**：精细化的重试策略，指数退避、最大重试次数等
3. **版本管理**：支持 Workflow 代码的版本迁移，不影响正在运行的实例
4. **可观测性**：Temporal Web UI 提供完整的执行历史和调试界面
5. **语言无关**：同一工作流可以用不同语言的 Activity 实现

### Temporal 的劣势

1. **基础设施成本**：需要维护 Temporal Server（依赖 Cassandra 或 PostgreSQL）
2. **学习曲线**：需要理解 Temporal 的概念模型
3. **PHP SDK 限制**：相比 Go/Java SDK，PHP SDK 在某些高级功能上支持不足
4. **调试复杂度**：异步执行模型让本地调试更具挑战性

## 三种方案全面对比

| 维度 | Choreography | Orchestration | Temporal |
|------|-------------|---------------|----------|
| **耦合度** | 低（事件驱动） | 中（协调器依赖各服务） | 中（Activity 接口） |
| **流程可见性** | 差（逻辑分散） | 好（集中在一个类） | 优秀（Web UI 可视化） |
| **复杂度** | 低（前期）/ 高（后期） | 中 | 高（基础设施） |
| **可观测性** | 需要额外工具 | 自建监控 | 开箱即用 |
| **容错能力** | 依赖消息队列 | 需自建重试机制 | 内置完善 |
| **扩展性** | 好（无单点） | 中（协调器是单点） | 好（Worker 水平扩展） |
| **补偿管理** | 分散，易遗漏 | 集中，易管理 | 集中，可版本化 |
| **适用规模** | 小型微服务 | 中型系统 | 大型分布式系统 |
| **运维成本** | 低 | 中 | 高 |
| **学习曲线** | 低 | 中 | 高 |

## 实战代码示例：订单创建的三种完整实现

让我们用一个统一的场景来展示三种方案的完整实现差异。

**业务场景**：用户下单购买商品，流程为 创建订单 → 预留库存 → 处理支付 → 发送通知。

### Choreography 实现——完整事件流

```php
// 1. Controller 发起
class OrderController extends Controller
{
    public function store(OrderRequest $request)
    {
        $orderId = Str::uuid()->toString();
        $correlationId = Str::uuid()->toString();

        OrderCreated::dispatch($orderId, $request->user()->id, $request->items, $correlationId);

        return response()->json([
            'order_id'       => $orderId,
            'correlation_id' => $correlationId,
            'status'         => 'processing',
        ], 202);
    }
}

// 2. 库存服务监听器
class ReserveStockOnOrderCreated implements ShouldQueue
{
    public function handle(OrderCreated $event): void
    {
        try {
            foreach ($event->items as $item) {
                $stock = Stock::lockForUpdate()
                    ->where('product_id', $item['product_id'])
                    ->first();

                if ($stock->quantity < $item['quantity']) {
                    throw new InsufficientStockException();
                }

                $stock->decrement('quantity', $item['quantity']);

                StockReservation::create([
                    'order_id'    => $event->orderId,
                    'product_id'  => $item['product_id'],
                    'quantity'    => $item['quantity'],
                    'status'      => 'reserved',
                ]);
            }

            StockReserved::dispatch($event->orderId, $event->correlationId);

        } catch (\Throwable $e) {
            StockReservationFailed::dispatch(
                $event->orderId, $e->getMessage(), $event->correlationId
            );
        }
    }
}

// 3. 补偿监听器——库存回滚
class CompensateStockOnFailure implements ShouldQueue
{
    public function handle(StockReservationFailed|OrderCancelled $event): void
    {
        StockReservation::where('order_id', $event->orderId)
            ->where('status', 'reserved')
            ->each(function (StockReservation $reservation) {
                Stock::where('product_id', $reservation->product_id)
                    ->increment('quantity', $reservation->quantity);
                $reservation->update(['status' => 'compensated']);
            });
    }
}
```

### Orchestration 实现——完整协调器

```php
class OrderSagaOrchestrator
{
    // ... (上面已展示完整代码)

    /**
     * 从断点恢复 Saga（用于协调器重启后恢复未完成的事务）
     */
    public function resume(string $correlationId): OrderSagaState
    {
        $execution = SagaExecution::where('correlation_id', $correlationId)
            ->where('status', 'in_progress')
            ->firstOrFail();

        $state = new OrderSagaState(
            orderId: $execution->order_id,
            correlationId: $correlationId,
            orderData: json_decode($execution->state_data, true),
        );

        // 从上次中断的步骤继续
        $allSteps = OrderSagaStep::cases();
        $startIndex = array_search(
            OrderSagaStep::from($execution->current_step),
            $allSteps
        );

        for ($i = $startIndex + 1; $i < count($allSteps); $i++) {
            $step = $allSteps[$i];
            try {
                ($this->steps[$step])($state);
                $state->markStepCompleted($step);
                $this->persistState($state, $step);
            } catch (\Throwable $e) {
                $state->markFailed($e->getMessage());
                $this->compensate($state);
                throw new SagaExecutionException($step, $e);
            }
        }

        $state->markCompleted();
        return $state;
    }
}
```

### Temporal 实现——带信号和查询的高级版本

```php
#[WorkflowInterface]
class AdvancedOrderWorkflow
{
    private bool $cancelled = false;
    private array $completedSteps = [];

    #[WorkflowMethod]
    public function processOrder(CreateOrderRequest $request): OrderResult
    {
        $activities = Workflow::newActivityStub(
            OrderActivities::class,
            ActivityOptions::new()
                ->withStartToCloseTimeout(CarbonInterval::seconds(30))
                ->withRetryOptions(
                    RetryOptions::new()
                        ->withMaximumAttempts(3)
                        ->withNonRetryableExceptions([
                            InsufficientStockException::class,
                            PaymentDeclinedException::class,
                        ])
                )
        );

        // 使用 Promise 并行执行独立操作
        $orderId = yield $activities->createOrder($request->toArray());

        try {
            yield $activities->reserveStock($orderId, $request->items);

            // 检查是否被取消
            if ($this->cancelled) {
                yield $activities->releaseStock($orderId);
                yield $activities->cancelOrder($orderId);
                return OrderResult::cancelled($orderId);
            }

            $transactionId = yield $activities->processPayment($orderId);

            // 异步通知，不阻塞主流程
            Workflow::detached(
                fn() => $activities->sendNotification($orderId, 'confirmed')
            );

            return OrderResult::success($orderId, $transactionId);

        } catch (\Throwable $e) {
            // 自动补偿
            yield $activities->releaseStock($orderId);
            yield $activities->cancelOrder($orderId);
            return OrderResult::failed($orderId, $e->getMessage());
        }
    }

    // 外部信号：允许用户取消订单
    #[SignalMethod]
    public function cancel(): void
    {
        $this->cancelled = true;
    }

    // 查询方法：获取当前状态
    #[QueryMethod]
    public function getStatus(): array
    {
        return [
            'completed_steps' => $this->completedSteps,
            'cancelled'       => $this->cancelled,
        ];
    }
}
```

## 生产环境踩坑指南

### 1. 消息丢失问题

**Choreography 模式中最常见的陷阱。** 事件发布和数据库操作不在同一个事务中。

```php
// ❌ 错误做法：数据库提交后发布事件，如果事件发布失败就丢失了
DB::transaction(function () use ($order) {
    $order->save();
});
OrderCreated::dispatch($order); // 这里可能失败

// ✅ 正确做法：使用事务性发件箱（Transactional Outbox）模式
DB::transaction(function () use ($order) {
    $order->save();
    // 写入本地事件表
    OutboxEvent::create([
        'event_type'   => OrderCreated::class,
        'payload'      => json_encode([...]),
        'published'    => false,
    ]);
});

// 后台任务定期扫描并发布事件
class OutboxPublisher implements ShouldQueue
{
    public function handle(): void
    {
        OutboxEvent::where('published', false)
            ->chunk(100, function ($events) {
                foreach ($events as $event) {
                    try {
                        event(unserialize($event->payload));
                        $event->update(['published' => true]);
                    } catch (\Throwable $e) {
                        Log::warning('Failed to publish outbox event', [
                            'id' => $event->id,
                        ]);
                    }
                }
            });
    }
}
```

### 2. 幂等性保障

**任何分布式系统都必须保证幂等性。** 网络抖动、消费者重试都可能导致同一条消息被处理多次。

```php
// 使用 idempotency_key 表保证幂等
class ReserveStockOnOrderCreated implements ShouldQueue
{
    public function handle(OrderCreated $event): void
    {
        $idempotencyKey = "stock_reserve:{$event->orderId}";

        // 原子性检查和插入
        $lock = IdempotencyKey::firstOrCreate(
            ['key' => $idempotencyKey],
            ['processed_at' => now()]
        );

        if ($lock->wasRecentlyCreated === false && $lock->processed_at !== null) {
            // 已处理过，直接跳过
            return;
        }

        try {
            // 执行业务逻辑
            $this->doReserve($event);

            $lock->update(['processed_at' => now(), 'status' => 'success']);

        } catch (\Throwable $e) {
            $lock->update(['status' => 'failed', 'error' => $e->getMessage()]);
            throw $e;
        }
    }
}
```

### 3. 补偿失败的处理

补偿操作本身也可能失败。这是 Saga 模式中最棘手的问题之一。

```php
// 带重试和死信队列的补偿执行器
class CompensatingTransactionExecutor
{
    private int $maxRetries = 5;

    public function executeWithRetry(
        string $correlationId,
        callable $compensation,
        string $stepName,
    ): void {
        $attempt = 0;

        while ($attempt < $this->maxRetries) {
            try {
                $compensation();
                return; // 成功，退出

            } catch (\Throwable $e) {
                $attempt++;

                if ($attempt >= $this->maxRetries) {
                    // 超过最大重试次数，进入人工介入队列
                    ManualIntervention::create([
                        'correlation_id' => $correlationId,
                        'step'           => $stepName,
                        'error'          => $e->getMessage(),
                        'attempts'       => $attempt,
                        'requires_action' => true,
                    ]);

                    // 发送告警
                    Notification::route('slack', config('alerts.slack'))
                        ->notify(new CompensationFailedAlert(
                            $correlationId, $stepName, $e->getMessage()
                        ));

                    return;
                }

                // 指数退避
                sleep(pow(2, $attempt));
            }
        }
    }
}
```

### 4. 超时处理

```php
// 在 Orchestration 中添加超时控制
class OrderSagaOrchestrator
{
    private array $stepTimeouts = [
        OrderSagaStep::CreateOrder      => 10,  // 10 秒
        OrderSagaStep::ReserveStock     => 15,  // 15 秒
        OrderSagaStep::ProcessPayment   => 30,  // 30 秒
        OrderSagaStep::SendNotification => 5,   // 5 秒
    ];

    private function executeWithTimeout(
        OrderSagaStep $step,
        callable $action,
        OrderSagaState $state
    ): mixed {
        $timeout = $this->stepTimeouts[$step];

        try {
            return rescue(
                fn() => retry(
                    3,
                    fn() => $action($state),
                    fn(\Throwable $e) => sleep(1)
                ),
                fn(\Throwable $e) => throw new SagaStepTimeoutException($step, $timeout),
                $timeout * 1000
            );
        } catch (SagaStepTimeoutException $e) {
            Log::error("Saga step {$step->value} timed out after {$timeout}s");
            throw $e;
        }
    }
}
```

### 5. 消息顺序保障

Choreography 模式下，事件可能乱序到达。使用 Laravel 的消息队列时，可以通过设置 Queue 的 `retryAfter` 和消息分组来缓解：

```php
// 使用消息分组保证同一订单的事件顺序处理
class ReserveStockOnOrderCreated implements ShouldQueue
{
    public string $queue = 'stock-operations';

    // Laravel 支持通过 middleware 实现消息分组
    public function middleware(): array
    {
        return [
            new WithoutOverlapping("stock-{$this->orderId}"),
        ];
    }
}
```

## 选型决策树

面对一个新项目，如何选择合适的 Saga 实现方案？以下决策树可以帮助你：

```
你的系统有几个服务参与事务？
│
├── 2-3 个服务
│   ├── 流程简单、线性？
│   │   └── ✅ Choreography（事件驱动，最简单）
│   └── 流程有分支、条件？
│       └── ✅ Orchestration（集中控制，更清晰）
│
├── 4-6 个服务
│   ├── 团队有 DevOps 能力？
│   │   ├── 是 → ✅ Temporal（可观测性优势明显）
│   │   └── 否 → ✅ Orchestration（维护成本更低）
│   └── 事务需要长时间运行（小时/天级）？
│       └── ✅ Temporal（持久化执行是唯一选择）
│
└── 7+ 个服务
    └── ✅ Temporal（手动管理 Choreography/Orchestration 已不可行）
```

**更实用的判断标准：**

- **选 Choreography 当**：团队小、服务少、流程简单、需要快速上线
- **选 Orchestration 当**：流程复杂、需要集中管控、团队熟悉状态机模式
- **选 Temporal 当**：对可靠性要求极高、需要长时间运行的工作流、有专职平台团队

## 总结与最佳实践

Saga 模式是解决分布式事务的核心手段，三种实现各有千秋：

1. **Choreography** 是最轻量的方案，适合快速迭代的小型系统，但随着服务数量增长，事件依赖图会变得难以维护。

2. **Orchestration** 是最务实的方案，集中化的协调器让流程清晰可追踪，适合大多数中等规模的微服务系统。

3. **Temporal** 是最"终极"的方案，它将分布式系统的复杂性封装在引擎内部，适合对可靠性要求极高的大型系统。

**无论选择哪种方案，以下最佳实践都应遵守：**

- **幂等性是底线**：所有操作必须幂等，重复调用不能产生副作用
- **补偿必须可靠**：补偿失败比正向操作失败更危险，必须有完善的告警和人工介入机制
- **发件箱模式**：在 Choreography 中使用 Transactional Outbox 保证事件不丢失
- **可观测性先行**：为每个 Saga 分配 correlationId，贯穿所有日志和监控
- **语义锁定**：用状态字段标记中间态，避免其他流程误读数据
- **超时与熔断**：每个步骤都要有超时控制，避免一个慢服务拖垮整个 Saga
- **渐进式采用**：从核心业务流程开始，不要一上来就把所有事务都 Saga 化

分布式事务没有银弹，Saga 也不例外。它的本质是在**一致性**和**可用性**之间做出取舍——放弃强一致性，换取系统的高可用和松耦合。理解了这个本质，你就能在具体场景中做出正确的架构决策。

---

> **参考资源**
>
> - Garcia-Molina, H., & Salem, K. (1987). Sagas. ACM SIGMOD Record.
> - Richardson, C. (2018). Microservices Patterns. Manning Publications.
> - [Temporal PHP SDK 文档](https://docs.temporal.io/php)
> - [Laravel Events 文档](https://laravel.com/docs/events)

## 相关阅读

- [Data Contract 实战：Pact-style 数据契约——Laravel 微服务间数据格式的版本化、验证与 Breaking Change 检测](/post/data-contract-pact-style-laravel-breaking-change/)
- [Progressive Delivery 实战：Feature Flag + 渐进式发布——Unleash + Argo Rollouts 的完整工程化工作流](/post/progressive-delivery-feature-flag-unleash-argo-rollouts/)
- [Ansible 实战：Laravel 应用自动化部署与配置管理踩坑记录](/post/ansible-laravel-ssh/)
