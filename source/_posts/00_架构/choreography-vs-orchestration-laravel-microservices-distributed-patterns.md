---
title: "Choreography vs Orchestration 实战：事件驱动 vs 工作流驱动——Laravel 微服务中的两种分布式编排范式深度对比"
date: 2026-06-06 00:00:00
categories:
  - 架构
tags:
  - 微服务
  - 事件驱动
  - 编排
  - laravel
  - 分布式
description: "深入对比 Laravel 微服务中 Choreography（编舞）与 Orchestration（编排）两种分布式协作范式。通过电商订单处理的完整可运行代码，详解事件驱动与工作流驱动的设计哲学、状态机编排、Pipeline 管道模式、Saga 补偿机制，以及核心交易编排+外围事件编舞的混合模式最佳实践。涵盖事件黑洞、上帝服务膨胀、补偿逻辑缺失等五大实战踩坑案例，附决策框架助你选型。"
cover: /images/covers/choreography-vs-orchestration-cover.jpg
---

在微服务架构的演进过程中，服务间的协作模式是决定系统可维护性、可观测性和弹性的关键因素。当我们把一个庞大的单体应用拆分成数十个独立部署的微服务后，一个看似简单的业务操作——比如"用户下单"——往往需要跨越多个服务协同完成：库存服务要验证库存、订单服务要创建记录、支付服务要扣款、通知服务要发送短信。这时候，**编排（Orchestration）** 和 **编舞（Choreography）** 这两种分布式协作范式就成为了架构师必须做出的核心选择。

这两种范式代表了完全不同的设计哲学：编舞追求极致的解耦和自治，编排追求流程的透明和可控。它们各有千秋，适用于不同的场景。本文将以 Laravel 生态为载体，通过真实可运行的代码示例，深入对比这两种范式的原理、实现、优劣与适用场景，帮助你在实际项目中做出更明智的架构决策。

## 一、概念解析：编舞与编排的本质区别

### 1.1 编舞（Choreography）

编舞模式源自舞蹈术语——多位舞者在舞台上根据音乐和彼此的动作自主反应，彼此之间通过微妙的信号进行协调，但没有一个中央指挥者。在微服务语境中，**编舞是一种去中心化的协作方式**：每个服务监听自己感兴趣的事件，当事件发生时自主决定是否以及如何响应，处理完成后发出自己的新事件，从而形成一条"事件链"。

这种模式的核心思想是：**没有一个服务知道整个业务流程的全貌**。每个服务只知道"当某件事发生时，我应该做什么"，至于谁触发了这件事、后续还有谁在监听，它并不关心也不需要关心。这种设计使得服务之间实现了真正的松耦合——添加一个新的消费者不需要修改生产者的任何代码。

**编舞模式的核心特征：**

- **无中央协调者**：没有一个服务掌握完整的业务流程视图，每个服务只关注自己的事件和行为
- **事件驱动通信**：服务之间通过发布和订阅事件进行异步通信，而非直接的方法调用
- **极度松耦合**：服务之间没有直接依赖关系，唯一的契约是事件的数据结构
- **去中心化决策**：每个监听器独立判断是否响应事件，自主决定执行什么操作
- **最终一致性**：整个系统通过事件的逐步传播达到最终一致状态，而非实时同步

### 1.2 编排（Orchestration）

编排模式源自交响乐指挥——一位指挥家（Orchestrator）手持指挥棒，掌控着每位乐手的演奏节奏和顺序，确保所有声部在正确的时间演奏正确的音符。在微服务语境中，**编排是一种中心化的协调方式**：由一个专门的协调服务（Orchestrator）按照预定义的工作流逻辑，主动调用各个下游服务，按照既定顺序完成整个业务流程。

编排模式的核心思想是：**有一个"导演"负责指挥整个演出**。这个导演知道完整的业务流程——第一步做什么、第二步做什么、出错了怎么回滚。它主动向每个服务发出命令，等待返回结果，然后根据结果决定下一步行动。流程的控制权始终在 Orchestrator 手中。

**编排模式的核心特征：**

- **中央协调者**：Orchestrator 掌握完整的业务流程知识，是整个系统的"大脑"
- **命令驱动通信**：协调者主动调用下游服务，等待返回结果，形成同步的调用链
- **流程集中管理**：业务逻辑集中在 Orchestrator 中定义，便于理解和修改
- **中心化错误处理**：所有异常在 Orchestrator 中统一捕获和处理
- **强事务支持**：可以在 Orchestrator 中使用数据库事务保证数据一致性

### 1.3 一个生动的比喻

想象一场音乐会的排练：

**编排模式**就像是排练交响乐——指挥家（Orchestrator）站在指挥台上，对着乐团发出明确的指令："弦乐组准备……三、二、一，开始！"每位乐手都看着指挥的手势，在正确的时间演奏正确的音符。如果有人出错了，指挥家可以立刻叫停、纠正、重新开始。

**编舞模式**就像是现代舞或即兴舞蹈——舞者们没有指挥，他们根据音乐的节奏和彼此的动作自主反应。一位舞者做出某个动作后，其他舞者看到这个信号，各自做出自己的回应。整个表演流畅自然，但如果有人理解错了信号，其他人可能做出不恰当的反应，而舞台上没有人能喊"停"。

## 二、Laravel 中的编舞模式实战

### 2.1 场景设定：电商订单处理流程

假设我们有一个电商平台，用户下单后需要完成以下步骤：
1. 验证库存是否充足
2. 创建订单记录
3. 扣减库存数量
4. 处理用户支付
5. 发送确认通知
6. 更新数据分析

在编舞模式下，每个步骤由独立的事件驱动完成，服务之间通过事件总线（如 Laravel Queue）进行解耦通信。

### 2.2 定义领域事件

首先，我们需要定义一组领域事件，这些事件是服务间通信的"语言"：

```php
// app/Events/OrderPlaced.php
namespace App\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderPlaced
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly string $orderId,
        public readonly string $userId,
        public readonly array $items,
        public readonly float $totalAmount
    ) {}
}

// app/Events/StockValidated.php
namespace App\Events;

class StockValidated
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly string $orderId,
        public readonly bool $isValid,
        public readonly array $validatedItems,
        public readonly ?string $failureReason = null
    ) {}
}

// app/Events/StockDeducted.php
namespace App\Events;

class StockDeducted
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly string $orderId,
        public readonly array $deductedItems
    ) {}
}

// app/Events/PaymentProcessed.php
namespace App\Events;

class PaymentProcessed
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly string $orderId,
        public readonly bool $success,
        public readonly ?string $transactionId = null,
        public readonly ?string $failureReason = null
    ) {}
}

// app/Events/OrderCompleted.php
namespace App\Events;

class OrderCompleted
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly string $orderId
    ) {}
}

// app/Events/OrderCancelled.php
namespace App\Events;

class OrderCancelled
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly string $orderId,
        public readonly string $reason
    ) {}
}
```

### 2.3 编写事件监听器

每个监听器负责处理一个特定的事件，并在处理完成后发出新的事件，驱动流程继续前进：

```php
// app/Listeners/ValidateStockListener.php
namespace App\Listeners;

use App\Events\OrderPlaced;
use App\Events\StockValidated;
use App\Services\InventoryService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

class ValidateStockListener implements ShouldQueue
{
    public function __construct(
        private InventoryService $inventory
    ) {}

    public function handle(OrderPlaced $event): void
    {
        Log::info("编舞模式：库存验证服务接收到订单事件", [
            'order_id' => $event->orderId,
            'items_count' => count($event->items),
        ]);

        // 验证库存可用性
        $isValid = $this->inventory->validateAvailability($event->items);

        // 验证完成后，发布新的事件驱动下一步
        StockValidated::dispatch(
            $event->orderId,
            $isValid,
            $event->items,
            $isValid ? null : '库存不足'
        );
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("库存验证失败", [
            'error' => $exception->getMessage()
        ]);
    }
}

// app/Listeners/DeductStockListener.php
namespace App\Listeners;

use App\Events\StockValidated;
use App\Events\StockDeducted;
use App\Events\OrderCancelled;
use App\Services\InventoryService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

class DeductStockListener implements ShouldQueue
{
    public function __construct(
        private InventoryService $inventory
    ) {}

    public function handle(StockValidated $event): void
    {
        if (!$event->isValid) {
            Log::warning("库存不足，取消订单", [
                'order_id' => $event->orderId,
                'reason' => $event->failureReason,
            ]);

            // 发布订单取消事件
            OrderCancelled::dispatch($event->orderId, $event->failureReason ?? '库存验证失败');
            return;
        }

        Log::info("编舞模式：库存扣减服务开始扣减库存", [
            'order_id' => $event->orderId
        ]);

        $this->inventory->deduct($event->orderId, $event->validatedItems);

        // 库存扣减完成，发布新事件驱动下一步
        StockDeducted::dispatch($event->orderId, $event->validatedItems);
    }
}

// app/Listeners/ProcessPaymentListener.php
namespace App\Listeners;

use App\Events\StockDeducted;
use App\Events\PaymentProcessed;
use App\Services\PaymentService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

class ProcessPaymentListener implements ShouldQueue
{
    public function __construct(
        private PaymentService $payment
    ) {}

    public function handle(StockDeducted $event): void
    {
        Log::info("编舞模式：支付服务开始处理支付", [
            'order_id' => $event->orderId
        ]);

        $result = $this->payment->process($event->orderId);

        // 处理支付结果，发布相应事件
        PaymentProcessed::dispatch(
            $event->orderId,
            $result->success,
            $result->transactionId,
            $result->success ? null : $result->failureReason
        );
    }
}

// app/Listeners/CompleteOrderListener.php
namespace App\Listeners;

use App\Events\PaymentProcessed;
use App\Events\OrderCompleted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CompleteOrderListener implements ShouldQueue
{
    public function handle(PaymentProcessed $event): void
    {
        if (!$event->success) {
            Log::warning("支付失败，订单未完成", [
                'order_id' => $event->orderId,
                'reason' => $event->failureReason,
            ]);
            return;
        }

        Log::info("编舞模式：订单完成，更新状态", [
            'order_id' => $event->orderId,
        ]);

        DB::table('orders')
            ->where('id', $event->orderId)
            ->update([
                'status' => 'completed',
                'transaction_id' => $event->transactionId,
                'completed_at' => now(),
            ]);

        // 发布订单完成事件
        OrderCompleted::dispatch($event->orderId);
    }
}

// app/Listeners/SendNotificationListener.php
namespace App\Listeners;

use App\Events\OrderCompleted;
use App\Services\NotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;

class SendNotificationListener implements ShouldQueue
{
    public function __construct(
        private NotificationService $notification
    ) {}

    public function handle(OrderCompleted $event): void
    {
        $this->notification->notifyOrderComplete($event->orderId);
    }
}

// app/Listeners/NotifyWarehouseListener.php
namespace App\Listeners;

use App\Events\OrderCompleted;
use App\Services\WarehouseService;
use Illuminate\Contracts\Queue\ShouldQueue;

class NotifyWarehouseListener implements ShouldQueue
{
    public function __construct(
        private WarehouseService $warehouse
    ) {}

    public function handle(OrderCompleted $event): void
    {
        $this->warehouse->scheduleFulfillment($event->orderId);
    }
}

// app/Listeners/UpdateAnalyticsListener.php
namespace App\Listeners;

use App\Events\OrderCompleted;
use App\Services\AnalyticsService;
use Illuminate\Contracts\Queue\ShouldQueue;

class UpdateAnalyticsListener implements ShouldQueue
{
    public function __construct(
        private AnalyticsService $analytics
    ) {}

    public function handle(OrderCompleted $event): void
    {
        $this->analytics->recordOrderCompletion($event->orderId);
    }
}
```

### 2.4 注册事件监听关系

```php
// app/Providers/EventServiceProvider.php
namespace App\Providers;

use Illuminate\Foundation\Support\Providers\EventServiceProvider as ServiceProvider;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        \App\Events\OrderPlaced::class => [
            \App\Listeners\ValidateStockListener::class,
        ],
        \App\Events\StockValidated::class => [
            \App\Listeners\DeductStockListener::class,
        ],
        \App\Events\StockDeducted::class => [
            \App\Listeners\ProcessPaymentListener::class,
        ],
        \App\Events\PaymentProcessed::class => [
            \App\Listeners\CompleteOrderListener::class,
        ],
        \App\Events\OrderCompleted::class => [
            \App\Listeners\SendNotificationListener::class,
            \App\Listeners\NotifyWarehouseListener::class,
            \App\Listeners\UpdateAnalyticsListener::class,
        ],
        \App\Events\OrderCancelled::class => [
            \App\Listeners\NotifyUserOfCancellation::class,
            \App\Listeners\RestoreInventoryListener::class,
        ],
    ];
}
```

### 2.5 发起流程

```php
// app/Services/OrderService.php
namespace App\Services;

use App\Events\OrderPlaced;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderService
{
    public function createOrder(array $data): string
    {
        $orderId = (string) Str::uuid();

        // 在数据库事务中创建订单
        DB::transaction(function () use ($orderId, $data) {
            DB::table('orders')->insert([
                'id' => $orderId,
                'user_id' => $data['user_id'],
                'items' => json_encode($data['items']),
                'total_amount' => $data['total_amount'],
                'status' => 'pending',
                'created_at' => now(),
            ]);
        });

        // 只发出一个事件，后续流程完全由事件链驱动
        // OrderService 不再参与后续流程
        OrderPlaced::dispatch(
            $orderId,
            $data['user_id'],
            $data['items'],
            $data['total_amount']
        );

        return $orderId;
    }
}
```

**观察这个流程的关键点：** `OrderService` 创建完订单并发出 `OrderPlaced` 事件后，就完全退出了流程。整个后续处理由事件链驱动——每个监听器处理完事件后发出新的事件，驱动下一个环节。**没有任何一个服务知道完整的业务流程**，这就是编舞模式的精髓所在。

流程图如下：

```
用户下单 → OrderService → 发布 OrderPlaced
                                ↓
              ValidateStockListener → 发布 StockValidated
                                          ↓
              DeductStockListener → 发布 StockDeducted
                                        ↓
              ProcessPaymentListener → 发布 PaymentProcessed
                                            ↓
              CompleteOrderListener → 发布 OrderCompleted
                                          ↓
                    ┌──────────┼──────────┐
                    ↓          ↓          ↓
              SendNotification NotifyWarehouse UpdateAnalytics
```

## 三、Laravel 中的编排模式实战

### 3.1 Orchestrator 的基本实现

在编排模式下，我们需要一个显式的协调者来管理整个流程的执行。这个协调者知道完整的业务流程，并主动调用每个服务完成相应的步骤。

```php
// app/Workflow/OrderWorkflow.php
namespace App\Workflow;

use App\Services\InventoryService;
use App\Services\PaymentService;
use App\Services\NotificationService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class OrderWorkflow
{
    public function __construct(
        private InventoryService $inventory,
        private PaymentService $payment,
        private NotificationService $notification,
    ) {}

    /**
     * 执行订单创建的完整工作流
     * Orchestrator 掌握完整的流程控制权
     */
    public function execute(array $data): array
    {
        $orderId = Str::uuid()->toString();

        Log::info("编排模式：Orchestrator 开始执行订单工作流", [
            'order_id' => $orderId
        ]);

        try {
            // 步骤 1：创建订单记录
            $this->createOrderRecord($orderId, $data);

            // 步骤 2：验证库存
            $stockValid = $this->inventory->validateAvailability($data['items']);
            if (!$stockValid) {
                return $this->fail($orderId, '库存验证失败');
            }

            // 步骤 3：扣减库存
            $this->inventory->deduct($orderId, $data['items']);

            // 步骤 4：处理支付
            $paymentResult = $this->payment->process($orderId);
            if (!$paymentResult->success) {
                // 支付失败，需要回滚库存
                $this->inventory->restore($orderId, $data['items']);
                return $this->fail($orderId, '支付处理失败：' . $paymentResult->failureReason);
            }

            // 步骤 5：发送确认通知
            $this->notification->notifyOrderComplete($orderId);

            // 步骤 6：更新订单状态为完成
            $this->completeOrder($orderId, $paymentResult->transactionId);

            Log::info("编排模式：订单工作流执行完成", [
                'order_id' => $orderId
            ]);

            return [
                'success' => true,
                'order_id' => $orderId,
                'transaction_id' => $paymentResult->transactionId,
            ];

        } catch (Throwable $e) {
            Log::error("编排模式：工作流执行异常", [
                'order_id' => $orderId,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            return $this->fail($orderId, '系统异常：' . $e->getMessage());
        }
    }

    private function createOrderRecord(string $orderId, array $data): void
    {
        DB::table('orders')->insert([
            'id' => $orderId,
            'user_id' => $data['user_id'],
            'items' => json_encode($data['items']),
            'total_amount' => $data['total_amount'],
            'status' => 'pending',
            'created_at' => now(),
        ]);
    }

    private function completeOrder(string $orderId, string $transactionId): void
    {
        DB::table('orders')
            ->where('id', $orderId)
            ->update([
                'status' => 'completed',
                'transaction_id' => $transactionId,
                'completed_at' => now(),
            ]);
    }

    private function fail(string $orderId, string $reason): array
    {
        DB::table('orders')
            ->where('id', $orderId)
            ->update([
                'status' => 'failed',
                'failure_reason' => $reason,
                'failed_at' => now(),
            ]);

        Log::warning("编排模式：订单流程失败", [
            'order_id' => $orderId,
            'reason' => $reason
        ]);

        return ['success' => false, 'order_id' => $orderId, 'reason' => $reason];
    }
}
```

### 3.2 带状态机的高级编排模式

对于更复杂的业务流程，我们可以结合状态机实现更健壮的编排。状态机可以持久化工作流的当前状态，即使系统崩溃也能从断点恢复：

```php
// app/Workflow/StatefulOrderOrchestrator.php
namespace App\Workflow;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use App\Services\InventoryService;
use App\Services\PaymentService;
use App\Services\NotificationService;

class StatefulOrderOrchestrator
{
    // 定义状态转换表：每个状态对应的可执行操作
    private const STATE_MACHINE = [
        'created'          => ['validate_stock'],
        'stock_validated'  => ['deduct_stock'],
        'stock_deducted'   => ['process_payment'],
        'payment_done'     => ['send_notification'],
        'notified'         => ['complete_order'],
        'completed'        => [],
        'failed'           => [],
    ];

    private const STATE_TRANSITIONS = [
        'created'          => 'stock_validated',
        'stock_validated'  => 'stock_deducted',
        'stock_deducted'   => 'payment_done',
        'payment_done'     => 'notified',
        'notified'         => 'completed',
    ];

    public function __construct(
        private InventoryService $inventory,
        private PaymentService $payment,
        private NotificationService $notification,
    ) {}

    /**
     * 启动一个新的工作流实例
     */
    public function start(string $userId, array $items, float $totalAmount): string
    {
        $orderId = Str::uuid()->toString();

        DB::table('workflow_instances')->insert([
            'id'         => $orderId,
            'type'       => 'order',
            'state'      => 'created',
            'payload'    => json_encode([
                'user_id' => $userId,
                'items'   => $items,
                'total_amount' => $totalAmount,
            ]),
            'metadata'   => json_encode([]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 同时创建订单记录
        DB::table('orders')->insert([
            'id' => $orderId,
            'user_id' => $userId,
            'items' => json_encode($items),
            'total_amount' => $totalAmount,
            'status' => 'pending',
            'created_at' => now(),
        ]);

        Log::info("状态机：工作流实例已创建", ['order_id' => $orderId]);

        // 立即推进工作流
        $this->advance($orderId);

        return $orderId;
    }

    /**
     * 推进工作流到下一个状态
     * 这是状态机的核心方法，可被外部调用来恢复中断的工作流
     */
    public function advance(string $orderId): void
    {
        $instance = DB::table('workflow_instances')
            ->where('id', $orderId)
            ->lockForUpdate()
            ->first();

        if (!$instance || in_array($instance->state, ['completed', 'failed'])) {
            return;
        }

        $payload = json_decode($instance->payload, true);
        $actions = self::STATE_MACHINE[$instance->state] ?? [];

        foreach ($actions as $action) {
            try {
                $shouldContinue = $this->executeAction($action, $orderId, $payload);

                if (!$shouldContinue) {
                    // 动作返回 false，说明流程应该终止
                    return;
                }
            } catch (\Throwable $e) {
                Log::error("状态机：步骤执行失败", [
                    'order_id' => $orderId,
                    'action'   => $action,
                    'state'    => $instance->state,
                    'error'    => $e->getMessage(),
                ]);

                $this->transitionTo($orderId, 'failed', [
                    'failed_action' => $action,
                    'error' => $e->getMessage(),
                ]);
                return;
            }
        }

        // 所有动作执行成功，推进到下一个状态
        $nextState = self::STATE_TRANSITIONS[$instance->state] ?? null;

        if ($nextState) {
            $this->transitionTo($orderId, $nextState);
        }
    }

    /**
     * 执行具体的工作流动作
     */
    private function executeAction(string $action, string $orderId, array $payload): bool
    {
        Log::info("状态机：执行动作", [
            'order_id' => $orderId,
            'action' => $action,
        ]);

        return match ($action) {
            'validate_stock' => $this->executeValidateStock($orderId, $payload),
            'deduct_stock'   => $this->executeDeductStock($orderId, $payload),
            'process_payment' => $this->executeProcessPayment($orderId),
            'send_notification' => $this->executeSendNotification($orderId),
            'complete_order' => $this->executeCompleteOrder($orderId),
            default => true,
        };
    }

    private function executeValidateStock(string $orderId, array $payload): bool
    {
        $isValid = $this->inventory->validateAvailability($payload['items']);
        if (!$isValid) {
            $this->transitionTo($orderId, 'failed', [
                'failed_action' => 'validate_stock',
                'error' => '库存验证失败',
            ]);
            return false;
        }
        return true;
    }

    private function executeDeductStock(string $orderId, array $payload): bool
    {
        $this->inventory->deduct($orderId, $payload['items']);
        return true;
    }

    private function executeProcessPayment(string $orderId): bool
    {
        $result = $this->payment->process($orderId);
        if (!$result->success) {
            $payload = $this->getPayload($orderId);
            // 补偿：回滚库存
            $this->inventory->restore($orderId, $payload['items']);

            $this->transitionTo($orderId, 'failed', [
                'failed_action' => 'process_payment',
                'error' => '支付失败：' . $result->failureReason,
            ]);
            return false;
        }
        return true;
    }

    private function executeSendNotification(string $orderId): bool
    {
        $this->notification->notifyOrderComplete($orderId);
        return true;
    }

    private function executeCompleteOrder(string $orderId): bool
    {
        DB::table('orders')
            ->where('id', $orderId)
            ->update([
                'status' => 'completed',
                'completed_at' => now(),
            ]);
        return true;
    }

    private function transitionTo(string $orderId, string $newState, array $meta = []): void
    {
        $existingMeta = json_decode(
            DB::table('workflow_instances')->where('id', $orderId)->value('metadata') ?? '{}',
            true
        );

        DB::table('workflow_instances')->where('id', $orderId)->update([
            'state' => $newState,
            'metadata' => json_encode(array_merge($existingMeta, $meta)),
            'updated_at' => now(),
        ]);

        Log::info("状态机：状态转换", [
            'order_id' => $orderId,
            'new_state' => $newState,
        ]);

        // 如果不是终态，继续推进
        if (!in_array($newState, ['completed', 'failed'])) {
            $this->advance($orderId);
        }
    }

    private function getPayload(string $orderId): array
    {
        $payload = DB::table('workflow_instances')->where('id', $orderId)->value('payload');
        return json_decode($payload, true);
    }
}
```

### 3.3 使用 Laravel Pipeline 模式实现编排

Laravel 的 Pipeline 组件提供了一种优雅的管道式编排方式，特别适合步骤之间需要"传递数据"的场景：

```php
// app/Workflow/Pipeline/OrderPipeline.php
namespace App\Workflow\Pipeline;

use Illuminate\Pipeline\Pipeline;

class OrderPipeline
{
    public function execute(array $orderData): array
    {
        return app(Pipeline::class)
            ->send($orderData)
            ->through([
                \App\Workflow\Pipeline\Steps\CreateOrderStep::class,
                \App\Workflow\Pipeline\Steps\ValidateStockStep::class,
                \App\Workflow\Pipeline\Steps\DeductStockStep::class,
                \App\Workflow\Pipeline\Steps\ProcessPaymentStep::class,
                \App\Workflow\Pipeline\Steps\SendNotificationStep::class,
                \App\Workflow\Pipeline\Steps\FinalizeOrderStep::class,
            ])
            ->thenReturn();
    }
}

// app/Workflow/Pipeline/Steps/CreateOrderStep.php
namespace App\Workflow\Pipeline\Steps;

use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CreateOrderStep
{
    public function handle(array $data, Closure $next): array
    {
        $data['order_id'] = Str::uuid()->toString();

        DB::table('orders')->insert([
            'id'           => $data['order_id'],
            'user_id'      => $data['user_id'],
            'items'        => json_encode($data['items']),
            'total_amount' => $data['total_amount'],
            'status'       => 'pending',
            'created_at'   => now(),
        ]);

        return $next($data);
    }
}

// app/Workflow/Pipeline/Steps/ValidateStockStep.php
namespace App\Workflow\Pipeline\Steps;

use Closure;
use App\Services\InventoryService;

class ValidateStockStep
{
    public function handle(array $data, Closure $next): array
    {
        $inventory = app(InventoryService::class);

        if (!$inventory->validateAvailability($data['items'])) {
            $data['failed'] = true;
            $data['failure_reason'] = '库存验证失败';
            return $data; // 提前终止管道
        }

        return $next($data);
    }
}

// app/Workflow/Pipeline/Steps/DeductStockStep.php
namespace App\Workflow\Pipeline\Steps;

use Closure;
use App\Services\InventoryService;

class DeductStockStep
{
    public function handle(array $data, Closure $next): array
    {
        if (isset($data['failed'])) {
            return $data; // 跳过后续步骤
        }

        app(InventoryService::class)->deduct($data['order_id'], $data['items']);

        return $next($data);
    }
}
```

### 3.4 编排模式的触发方式

```php
// app/Services/OrderService.php
namespace App\Services;

use App\Workflow\OrderWorkflow;
use App\Workflow\StatefulOrderOrchestrator;
use App\Workflow\Pipeline\OrderPipeline;

class OrderService
{
    public function __construct(
        private OrderWorkflow $workflow,
    ) {}

    /**
     * 基本编排模式
     */
    public function createOrder(array $data): array
    {
        return $this->workflow->execute($data);
    }

    /**
     * 从外部调用状态机推进（用于恢复中断的流程）
     */
    public function resumeWorkflow(string $orderId): void
    {
        app(StatefulOrderOrchestrator::class)->advance($orderId);
    }
}
```

## 四、深度对比：编舞 vs 编排

### 4.1 全维度对比表

| 维度 | 编舞（Choreography） | 编排（Orchestration） |
|------|----------------------|----------------------|
| **流程可见性** | 低：流程分散在各个事件和监听器中，难以获得全局视图 | 高：流程在 Orchestrator 中集中定义，一目了然 |
| **服务耦合度** | 极低：服务间只通过事件契约解耦，彼此独立 | 中等：Orchestrator 与所有参与者存在直接依赖 |
| **系统扩展性** | 高：添加新参与者只需注册新的监听器，无需修改已有代码 | 中等：修改流程需要修改 Orchestrator 的代码 |
| **错误处理** | 复杂：需要设计补偿事件、死信队列、重试策略 | 简单：在 Orchestrator 中用 try-catch 统一处理 |
| **调试难度** | 高：事件链可能很长，跨服务追踪困难 | 低：流程线性执行，断点调试方便 |
| **事务一致性** | 弱：需要最终一致性模式（如 Saga 补偿） | 强：可在 Orchestrator 中使用数据库事务保证原子性 |
| **系统性能** | 高：异步非阻塞，各服务可并行处理 | 中等：同步顺序执行，存在阻塞等待 |
| **团队协作** | 需要团队共享事件契约，沟通成本较高 | 流程定义集中，职责边界清晰 |
| **测试复杂度** | 高：需要模拟事件总线和多个监听器的交互 | 低：直接测试 Orchestrator 的方法调用即可 |
| **运维监控** | 需要分布式追踪工具（如 Jaeger、Zipkin） | 可用简单的日志和状态表进行追踪 |
| **代码膨胀** | 分散在各个监听器中，单个文件较简洁 | 集中在 Orchestrator 中，容易膨胀成"上帝服务" |
| **团队学习曲线** | 较陡：需要理解事件驱动架构的思维模式 | 较平缓：同步编程模型更直观 |

### 4.2 编舞模式的优势深度分析

**天然的微服务解耦**：编舞模式下，每个服务都是真正独立的。库存服务不需要知道订单服务的存在，通知服务也不需要知道支付服务的实现细节。它们只关心事件的数据结构，不关心事件的来源和去向。这种解耦使得团队可以独立开发、测试和部署各个服务。

**高吞吐量与非阻塞**：由于事件驱动的异步特性，生产者发出事件后可以立即返回，不需要等待消费者处理完成。消费者也可以根据自己的节奏处理事件。这使得系统在高并发场景下依然能保持良好的响应性能。

**去中心化无单点故障**：编舞模式没有中央协调者，因此不存在单点故障（事件总线除外）。即使某个监听器暂时不可用，其他服务的运行不受影响，待监听器恢复后可以从队列中继续消费未处理的事件。

**灵活的横向扩展**：由于服务间完全解耦，我们可以轻松地为某个高负载的监听器增加实例数量，而不需要修改其他任何服务的代码。例如，如果支付处理是瓶颈，只需增加 ProcessPaymentListener 的队列消费者数量。

### 4.3 编排模式的优势深度分析

**业务流程显式定义**：编排模式最大的优势是"流程即代码"。当新人加入团队时，只需要阅读 Orchestrator 的代码就能理解完整的业务流程。这大大降低了知识传递的成本。

**统一的错误处理和补偿**：所有异常在 Orchestrator 中集中处理。当某个步骤失败时，Orchestrator 可以根据预定义的策略进行重试、回滚或报警。这比编舞模式中分散的错误处理要可靠得多。

**事务控制简单**：在编排模式下，Orchestrator 可以在数据库事务中执行多个步骤，保证数据的一致性。例如，在订单创建流程中，扣减库存和创建订单记录可以在同一个事务中完成，要么全部成功，要么全部回滚。

**易于调试和监控**：由于流程是线性执行的，调试时只需要在 Orchestrator 中设置断点即可。日志也是集中记录的，不需要跨多个服务关联日志。

### 4.4 编舞模式的劣势深度分析

**业务流程难以追踪**：由于流程分散在各个监听器中，想要了解"一个订单从创建到完成经历了哪些步骤"变得非常困难。你可能需要阅读数十个监听器的代码，才能拼凑出完整的流程图。

**错误处理复杂**：当某个环节出错时，需要设计补偿机制来回滚之前的操作。例如，如果支付失败了，需要回滚库存扣减。在编舞模式下，这需要定义额外的补偿事件（如 `PaymentFailed` → 触发 `RestoreInventoryListener`），增加了系统的复杂度。

**事件风暴风险**：在高并发场景下，大量的事件可能同时涌入事件总线，导致系统过载。如果事件处理不及时，可能引发雪崩效应。

### 4.5 编排模式的劣势深度分析

**单点瓶颈风险**：Orchestrator 作为中央协调者，容易成为性能瓶颈。如果 Orchestrator 处理不过来，整个流程都会被阻塞。

**代码膨胀风险**：随着业务复杂度增加，Orchestrator 的代码可能膨胀成"上帝服务"——一个包含数千行代码的庞大类，难以维护和测试。

**耦合度较高**：Orchestrator 需要了解所有参与者的服务接口，当某个服务的接口发生变化时，可能需要修改 Orchestrator 的代码。

## 五、何时选择哪种模式？

### 5.1 选择编舞模式的典型场景

```php
// 场景一：社交媒体的消息推送系统
// 用户发帖后，多个下游系统独立响应，彼此之间无感知、无依赖

// NotificationService 监听帖子创建事件
class NotifyFollowersListener implements ShouldQueue
{
    public function handle(PostCreated $event): void
    {
        $followers = User::whereFollowing($event->authorId)->get();
        foreach ($followers as $follower) {
            Notification::send($follower, new NewPostNotification($event->postId));
        }
    }
}

// SearchIndexService 监听帖子创建事件
class IndexPostListener implements ShouldQueue
{
    public function handle(PostCreated $event): void
    {
        app(SearchEngine::class)->index($event->postId, $event->content, $event->tags);
    }
}

// AnalyticsService 监听帖子创建事件
class TrackPostCreationListener implements ShouldQueue
{
    public function handle(PostCreated $event): void
    {
        app(AnalyticsService::class)->record('post_created', [
            'author' => $event->authorId,
            'category' => $event->category,
            'tags' => $event->tags,
        ]);
    }
}

// RecommendationService 监听帖子创建事件
class UpdateRecommendationsListener implements ShouldQueue
{
    public function handle(PostCreated $event): void
    {
        app(RecommendationEngine::class)->recalculateForCategory($event->category);
    }
}

// ContentModerationService 监听帖子创建事件
class ModerateContentListener implements ShouldQueue
{
    public function handle(PostCreated $event): void
    {
        app(ModerationService::class)->analyze($event->postId, $event->content);
    }
}
```

**选择编舞模式的判断条件：**

- 流程中的每个步骤可以独立执行，不需要等待前一步的返回结果
- 下游服务数量较多（超过 5 个）且可能经常变化
- 系统对吞吐量要求高，需要异步并行处理能力
- 团队对事件驱动架构有丰富经验，熟悉消息中间件
- 不需要严格的事务保证，可以接受最终一致性
- 服务部署在不同的技术栈或团队维护

### 5.2 选择编排模式的典型场景

```php
// 场景二：银行转账流程
// 金额必须严格按照顺序处理，需要强事务保证

class TransferOrchestrator
{
    public function __construct(
        private AccountRepository $accounts,
        private TransactionRepository $transactions,
        private FraudDetectionService $fraudDetection,
    ) {}

    /**
     * 转账操作——强事务要求，必须使用编排模式
     * 每一步都必须在同一个事务中完成
     */
    public function transfer(
        string $fromAccountId,
        string $toAccountId,
        float $amount,
        string $currency
    ): array {
        // 使用数据库事务 + 行锁保证并发安全
        return DB::transaction(function () use (
            $fromAccountId, $toAccountId, $amount, $currency
        ) {
            // 步骤 1：锁定源账户（悲观锁，防止并发转账）
            $fromAccount = $this->accounts->lockForUpdate($fromAccountId);

            // 步骤 2：验证源账户状态
            if ($fromAccount->status !== 'active') {
                throw new \DomainException('源账户状态异常');
            }

            // 步骤 3：检查余额是否充足
            if ($fromAccount->balance < $amount) {
                throw new \DomainException('余额不足');
            }

            // 步骤 4：欺诈检测
            $this->fraudDetection->check($fromAccountId, $amount);

            // 步骤 5：锁定目标账户
            $toAccount = $this->accounts->lockForUpdate($toAccountId);

            // 步骤 6：扣减源账户余额
            $this->accounts->debit($fromAccountId, $amount, $currency);

            // 步骤 7：增加目标账户余额
            $this->accounts->credit($toAccountId, $amount, $currency);

            // 步骤 8：记录交易流水
            $transaction = $this->transactions->create([
                'from_account' => $fromAccountId,
                'to_account'   => $toAccountId,
                'amount'       => $amount,
                'currency'     => $currency,
                'type'         => 'transfer',
                'status'       => 'completed',
            ]);

            return [
                'success' => true,
                'transaction_id' => $transaction->id,
                'from_balance' => $fromAccount->balance - $amount,
                'to_balance' => $toAccount->balance + $amount,
            ];
        });
    }
}
```

**选择编排模式的判断条件：**

- 流程中有严格的顺序依赖和事务要求（如金融交易、库存扣减）
- 步骤较少（通常 3-8 个），流程相对固定不会频繁变化
- 需要清晰的错误处理、重试和回滚机制
- 业务逻辑复杂，需要集中管理便于理解和维护
- 团队更熟悉传统的同步编程模型
- 需要满足合规要求（如金融行业审计）

### 5.3 混合模式：实际项目中的最佳实践

在真实项目中，我们通常不会非此即彼地选择单一模式，而是根据流程各阶段的特点混合使用编舞和编排：

```php
// 顶层流程用编排——核心交易流程，需要事务保护
class CreateOrderOrchestrator
{
    public function __construct(
        private InventoryService $inventory,
        private PaymentService $payment,
    ) {}

    public function execute(array $data): string
    {
        $orderId = DB::transaction(function () use ($data) {
            // 编排：核心交易流程在事务中同步执行
            $orderId = (string) Str::uuid();

            DB::table('orders')->insert([
                'id' => $orderId,
                'user_id' => $data['user_id'],
                'items' => json_encode($data['items']),
                'total_amount' => $data['total_amount'],
                'status' => 'processing',
                'created_at' => now(),
            ]);

            $this->inventory->deduct($data['items']);
            $this->payment->charge($orderId, $data['total_amount']);

            DB::table('orders')
                ->where('id', $orderId)
                ->update(['status' => 'created']);

            return $orderId;
        });

        // 编舞：后续通知和分析异步执行，最终一致性即可
        OrderCreated::dispatch($orderId);
        // 下面的事件会触发：
        // - SendConfirmationEmailListener
        // - UpdateAnalyticsListener
        // - NotifyWarehouseListener
        // - UpdateRecommendationsListener

        return $orderId;
    }
}
```

这种混合模式的好处是：**核心交易逻辑用编排保证数据一致性，外围功能用编舞实现服务解耦**。这是目前微服务架构中最常见也最实用的模式。

## 六、实战中的常见陷阱与解决方案

### 陷阱一：编舞模式下的"事件黑洞"

在编舞模式中，最常见的问题是事件发出后无人监听，或者监听器静默失败，导致事件被"吞掉"而没有任何人知道。

```php
// ❌ 错误示例：事件发出后无人监听
// OrderPlaced::dispatch($orderId);
// 如果 EventServiceProvider 中没有注册对应的 Listener，事件就被静默丢弃了

// ✅ 解决方案一：使用事件注册表确保所有事件都有监听器
class EventRegistry
{
    private const KNOWN_EVENTS = [
        \App\Events\OrderPlaced::class      => 'ValidateStockListener',
        \App\Events\StockValidated::class    => 'DeductStockListener',
        \App\Events\StockDeducted::class     => 'ProcessPaymentListener',
        \App\Events\PaymentProcessed::class  => 'CompleteOrderListener',
        \App\Events\OrderCompleted::class    => 'SendNotificationListener',
        \App\Events\OrderCancelled::class    => 'NotifyCancellationListener',
    ];

    /**
     * 在应用启动时检查所有事件是否都有对应的监听器
     */
    public static function validate(): void
    {
        foreach (self::KNOWN_EVENTS as $eventClass => $expectedHandler) {
            $listeners = \Illuminate\Support\Facades\Event::getListeners($eventClass);

            if (empty($listeners)) {
                logger()->critical("事件黑洞检测：事件 {$eventClass} 没有任何监听器！", [
                    'expected_handler' => $expectedHandler,
                ]);

                // 可以发送到监控系统（如 Sentry）
                if (app()->environment('production')) {
                    report(new \RuntimeException(
                        "未处理的事件: {$eventClass}, 预期处理器: {$expectedHandler}"
                    ));
                }
            }
        }
    }
}

// ✅ 解决方案二：使用队列的 failed_jobs 表追踪失败的监听器
// 在 AppServiceProvider 中注册失败任务的回调
public function boot(): void
{
    \Illuminate\Queue\Events\JobExceptionOccurring::class;
    Queue::exceptionOccurred(function ($connection, $job, $exception) {
        Log::critical("队列任务执行失败", [
            'job' => $job->resolveName(),
            'exception' => $exception->getMessage(),
            'payload' => $job->getRawBody(),
        ]);
    });
}
```

### 陷阱二：编排模式下的"上帝服务"

当 Orchestrator 承担了太多职责时，它会膨胀成一个难以维护的"上帝服务"。

```php
// ❌ 错误示例：Orchestrator 包含了所有业务逻辑
class GodOrchestrator
{
    public function createOrder(array $data): array
    {
        // 500+ 行代码，混合了数据验证、业务规则、
        // 外部服务调用、错误处理、日志记录、缓存管理...
        // 这样的代码难以阅读、测试和维护
    }
}

// ✅ 正确做法：Orchestrator 只负责流程编排，业务逻辑委托给领域服务
class LeanOrchestrator
{
    public function __construct(
        private OrderDomainService $orderDomain,
        private InventoryDomainService $inventoryDomain,
        private PaymentDomainService $paymentDomain,
        private NotificationDomainService $notificationDomain,
    ) {}

    public function execute(array $data): array
    {
        // 每个方法调用清晰表达"做什么"，具体"怎么做"委托给领域服务
        $orderId = $this->orderDomain->create($data);
        $this->inventoryDomain->reserve($orderId, $data['items']);
        $this->paymentDomain->charge($orderId, $data['amount']);
        $this->orderDomain->markAsReady($orderId);
        $this->notificationDomain->sendConfirmation($orderId);

        return ['order_id' => $orderId, 'status' => 'completed'];
    }
    // Orchestrator 的核心职责：描述流程步骤的顺序和条件
    // 不应该包含任何具体的业务逻辑实现
}
```

### 陷阱三：编舞模式下的补偿逻辑缺失

在编舞模式中，当某个环节失败时，需要回滚之前已经完成的操作。如果没有设计补偿机制，可能导致数据不一致。

```php
// ❌ 错误示例：支付失败后没有回滚库存
class ProcessPaymentListener implements ShouldQueue
{
    public function handle(StockDeducted $event): void
    {
        $result = $this->payment->process($event->orderId);

        if (!$result->success) {
            // 💥 问题：库存已扣减但未回滚！
            // 用户的钱没扣，但库存已经扣了，数据不一致
            Log::error("支付失败", ['order_id' => $event->orderId]);
            return;
        }

        PaymentProcessed::dispatch($event->orderId, true, $result->transactionId);
    }
}

// ✅ 正确做法：实现 Saga 补偿模式
class ProcessPaymentListener implements ShouldQueue
{
    public function handle(StockDeducted $event): void
    {
        $result = $this->payment->process($event->orderId);

        if (!$result->success) {
            // 支付失败，发布补偿事件回滚库存
            PaymentFailed::dispatch(
                $event->orderId,
                '支付处理失败：' . $result->failureReason
            );
            return;
        }

        PaymentProcessed::dispatch($event->orderId, true, $result->transactionId);
    }
}

// 补偿监听器：处理支付失败，回滚库存
class HandlePaymentFailedListener implements ShouldQueue
{
    public function __construct(
        private InventoryService $inventory
    ) {}

    public function handle(PaymentFailed $event): void
    {
        // 查找订单信息，获取之前扣减的库存详情
        $order = DB::table('orders')->where('id', $event->orderId)->first();

        if ($order) {
            // 补偿：回滚库存
            $items = json_decode($order->items, true);
            $this->inventory->restore($event->orderId, $items);
        }

        // 更新订单状态为已取消
        DB::table('orders')
            ->where('id', $event->orderId)
            ->update([
                'status' => 'cancelled',
                'cancellation_reason' => $event->reason,
                'cancelled_at' => now(),
            ]);

        // 通知用户
        OrderCancelled::dispatch($event->orderId, $event->reason);
    }
}
```

### 陷阱四：编排模式下的超时与重试

Orchestrator 调用下游服务时，如果某个服务响应缓慢或暂时不可用，需要有重试和超时机制：

```php
// ✅ 为 Orchestrator 添加超时和重试机制
class ResilientOrchestrator
{
    public function __construct(
        private OrderWorkflow $workflow,
    ) {}

    public function executeWithRetry(array $data, int $maxRetries = 3): array
    {
        $lastException = null;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                Log::info("工作流执行尝试", [
                    'attempt' => $attempt,
                    'max_retries' => $maxRetries,
                ]);

                return $this->workflow->execute($data);

            } catch (\Throwable $e) {
                $lastException = $e;

                Log::warning("工作流执行失败，准备重试", [
                    'attempt' => $attempt,
                    'error' => $e->getMessage(),
                ]);

                if ($attempt < $maxRetries) {
                    // 指数退避策略：1s, 2s, 4s...
                    $delay = pow(2, $attempt);
                    Log::info("等待 {$delay} 秒后重试");
                    sleep($delay);
                }
            }
        }

        Log::error("工作流执行最终失败，已用尽所有重试机会", [
            'total_attempts' => $maxRetries,
            'last_error' => $lastException?->getMessage(),
        ]);

        throw $lastException;
    }
}
```

### 陷阱五：事件版本兼容性

当事件的数据结构需要变更时，编舞模式面临着版本兼容性的挑战：

```php
// ❌ 错误：直接修改事件结构，导致旧的监听器崩溃
class OrderPlaced
{
    public function __construct(
        public readonly string $orderId,
        public readonly string $userId,
        public readonly array $items,
        // 新增字段，但旧消费者可能不认识这个字段
        public readonly array $shipping_address,
    ) {}
}

// ✅ 正确做法：使用事件版本控制和向后兼容
class OrderPlaced
{
    public function __construct(
        public readonly string $orderId,
        public readonly string $userId,
        public readonly array $items,
        public readonly array $metadata = [], // 扩展字段放在 metadata 中
        public readonly int $eventVersion = 1, // 事件版本号
    ) {}

    /**
     * 向后兼容：获取运费信息，v1 事件可能没有这个字段
     */
    public function getShippingAddress(): ?array
    {
        return $this->metadata['shipping_address'] ?? null;
    }
}

// 监听器中兼容处理不同版本的事件
class CalculateShippingListener implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        $shippingAddress = $event->getShippingAddress();

        if ($shippingAddress === null && $event->eventVersion < 2) {
            // v1 事件没有运费信息，从用户资料中获取
            $shippingAddress = $this->getDefaultAddress($event->userId);
        }

        // 继续处理...
    }
}
```

## 七、可观测性与调试最佳实践

### 7.1 编舞模式的分布式追踪

在编舞模式下，由于事件链可能跨越多个服务，分布式追踪变得尤为重要：

```php
// 使用 Laravel 的上下文传播机制
class OrderPlaced
{
    use Dispatchable, SerializesModels;

    public string $traceId;
    public string $spanId;

    public function __construct(
        public readonly string $orderId,
        public readonly string $userId,
        public readonly array $items,
    ) {
        // 从 HTTP 请求或上级上下文中获取 traceId
        $this->traceId = request()?->header('X-Trace-Id')
            ?? Context::get('trace_id')
            ?? \Illuminate\Support\Str::uuid()->toString();
        $this->spanId = \Illuminate\Support\Str::uuid()->toString();
    }
}

// 在每个监听器中记录上下文信息
class ValidateStockListener implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        // 将 traceId 传递给日志上下文
        Log::context([
            'trace_id' => $event->traceId,
            'span_id' => $event->spanId,
            'order_id' => $event->orderId,
            'step' => 'validate_stock',
        ]);

        Log::info("开始验证库存");

        // 业务逻辑...

        // 在发出新事件时传递 traceId
        StockValidated::dispatch(
            $event->orderId,
            $isValid,
            $event->items
        );
    }
}
```

### 7.2 编排模式的执行追踪

编排模式天然提供了清晰的追踪点，因为所有逻辑都集中在 Orchestrator 中：

```php
// 为 Orchestrator 添加详细的执行日志
class TracedOrchestrator
{
    public function execute(array $data): array
    {
        $traceId = \Illuminate\Support\Str::uuid()->toString();
        $stepLogs = [];
        $totalStart = microtime(true);

        Log::context(['trace_id' => $traceId]);

        // 步骤 1：验证库存
        $start = microtime(true);
        $stockValid = $this->inventory->validateAvailability($data['items']);
        $stepLogs[] = [
            'step' => 'validate_stock',
            'duration_ms' => round((microtime(true) - $start) * 1000, 2),
            'result' => $stockValid ? 'success' : 'failed',
        ];

        if (!$stockValid) {
            return ['success' => false, 'reason' => '库存不足', 'trace_id' => $traceId];
        }

        // 步骤 2：扣减库存
        $start = microtime(true);
        $this->inventory->deduct($data['order_id'], $data['items']);
        $stepLogs[] = [
            'step' => 'deduct_stock',
            'duration_ms' => round((microtime(true) - $start) * 1000, 2),
            'result' => 'success',
        ];

        // 步骤 3：处理支付
        $start = microtime(true);
        $paymentResult = $this->payment->process($data['order_id']);
        $stepLogs[] = [
            'step' => 'process_payment',
            'duration_ms' => round((microtime(true) - $start) * 1000, 2),
            'result' => $paymentResult->success ? 'success' : 'failed',
        ];

        // 记录完整的执行日志
        Log::info("工作流执行完成", [
            'trace_id' => $traceId,
            'steps' => $stepLogs,
            'total_duration_ms' => round((microtime(true) - $totalStart) * 1000, 2),
        ]);

        return ['success' => true, 'trace_id' => $traceId, 'steps' => $stepLogs];
    }
}
```

## 八、总结与决策框架

### 快速决策指南

```
你的业务流程需要严格的事务保证吗？
├── 是 → 选择编排模式
│       典型场景：金融交易、订单核心流程、库存管理
└── 否 → 你的流程步骤之间有强依赖关系吗？
        ├── 是 → 选择编排模式
        │       典型场景：审批流程、多步骤表单、数据迁移
        └── 否 → 选择编舞模式
                典型场景：通知推送、日志收集、数据分析、推荐更新
```

### 核心设计原则

1. **编舞适合"反应型"系统**：每个服务对事件做出独立反应，适合松耦合、高吞吐、需要快速迭代的场景。编舞的价值在于让系统中的每个组件都能专注于自己的领域职责，而不需要了解全局流程。

2. **编排适合"指令型"系统**：Orchestrator 发出明确指令并控制流程节奏，适合需要事务保证、清晰的错误处理和回滚机制的场景。编排的价值在于让业务流程变得透明、可控、易于调试。

3. **混合模式是最实用的选择**：核心交易流程用编排保证数据一致性，外围功能用编排实现服务解耦。这种模式兼顾了两种范式的优点，是目前业界最推荐的实践。

4. **不要过度设计**：如果一个服务的流程只有 3 步且变化不频繁，用简单的编排就足够了。编舞模式的优势在服务数量多、变化频繁时才能真正体现。过早引入事件驱动架构可能带来不必要的复杂度。

5. **可观测性是底线**：无论选择哪种模式，分布式追踪（如 OpenTelemetry）、结构化日志和监控告警都是必须的基础设施。没有可观测性的微服务系统就像没有仪表盘的飞机——你不知道它在飞向哪里。

6. **事件契约要版本化**：在编舞模式下，事件的数据结构就是服务间的"合同"。一旦发布就要保持向后兼容，新字段通过可选的 metadata 扩展，废弃字段通过版本号标记。

### 关键指标对比总结

| 选择维度 | 推荐编舞 | 推荐编排 |
|---------|---------|---------|
| 服务数量 | 多（> 5 个） | 少（3-5 个） |
| 流程变化频率 | 高 | 低 |
| 数据一致性要求 | 最终一致即可 | 强一致 |
| 吞吐量要求 | 高 | 中等 |
| 团队经验 | 事件驱动经验丰富 | 同步编程经验丰富 |
| 调试需求 | 可接受分布式追踪 | 需要单步调试 |
| 扩展需求 | 频繁添加新服务 | 流程相对稳定 |

记住，**没有银弹**。编舞和编排不是非此即彼的选择，而是可以根据系统不同部分的需求灵活组合的工具。关键在于理解每种模式的本质特征，然后根据业务需求、团队能力和运维条件做出最合适的决策。在微服务架构的世界里，最好的架构不是最"纯粹"的架构，而是最适合你当前业务阶段和团队能力的架构。

---

> **延伸阅读：**
> - Sam Newman, *Building Microservices* — 第 4 章 "Implementing Microservice Communications"，深入讲解了微服务间通信的各种模式
> - Chris Richardson, *Microservices Patterns* — 第 7 章详细讨论了 Saga 模式和编排/编舞的选择
> - Martin Fowler, *The Microservice Premium* — 关于微服务何时值得引入的深度思考

## 相关阅读

- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/saga-orchestration-pattern-laravel-distributed-transaction/) — 深入对比 Saga 模式下 Choreography、Orchestration 和 Temporal 三种实现路线
- [Data Consistency Patterns 实战：Saga/TCC/2PC/XA 在 Laravel 中的选型决策树](/data-consistency-patterns-laravel-saga-tcc-2pc-xa/) — 从理论到生产落地的完整数据一致性选型路径
- [Distributed Tracing 深度实战：Trace Context 传播、Baggage 透传与采样策略](/2026-06-06-distributed-tracing-trace-context-baggage-sampling-laravel-microservice/) — Laravel 微服务的因果可观测性与分布式追踪实践
> - Gregor Hohpe, *Enterprise Integration Patterns* — 消息模式的经典参考，其中的 Message Broker 模式是编舞的基础设施
