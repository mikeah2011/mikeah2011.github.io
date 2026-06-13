---
title: Choreography vs Orchestration 实战：事件驱动 vs 工作流驱动——Laravel 微服务中的两种分布式编排范式深度对比
date: 2026-06-06 00:00:00
tags: [微服务, choreography, orchestration, 事件驱动, laravel, saga]
description: "深度对比微服务架构中 Choreography（编舞）与 Orchestration（指挥）两种分布式协调范式。基于 Laravel 生态，通过电商订单全流程实战代码，从设计哲学、事件驱动架构、工作流编排实现、Saga 分布式事务补偿、错误处理、可观测性到性能扩展，全方位解析两种模式的优劣势与适用场景。附选型决策框架、Outbox 模式、幂等设计与生产踩坑指南，帮助架构师在事件驱动与工作流驱动之间做出最优选择。"
categories:
  - architecture
cover: /images/covers/choreography-vs-orchestration-cover.jpg
---

在微服务架构的演进过程中，服务间的协调方式一直是架构师面临的最核心挑战之一。随着业务复杂度的提升，单个用户操作往往需要跨越多个微服务协作完成，例如一笔电商订单的创建可能涉及订单服务、库存服务、支付服务、通知服务和物流服务。如何让这些服务高效、可靠地协同工作，直接决定了系统的可维护性、可观测性和扩展能力。

**Choreography（编舞模式）** 和 **Orchestration（指挥模式）** 是两种经典的分布式编排范式。前者以事件为纽带，让各服务自行协调，就像舞者在音乐中即兴协作；后者以中心化的指挥器统筹全局流程，就像交响乐团的指挥家掌控每一个演奏环节。本文将以 Laravel 生态为基础，通过电商订单场景的完整实战，从设计哲学、代码实现、错误处理、可观测性、性能扩展到实战踩坑，全方位深度对比这两种范式，并最终给出可落地的选型决策框架。

---

## 一、概念解析：Choreography 与 Orchestration

### 1.1 Choreography（编舞模式）

Choreography 是一种去中心化的协调方式。每个微服务在完成自身职责后发布一个事件（Event），其他服务根据自己的兴趣订阅并响应这些事件。没有中央协调器——每个服务"自行决定"如何对事件做出反应。

想象一场现代舞表演：每个舞者根据音乐的节奏和自己的理解即兴表演，他们之间没有导演在旁边指挥，但通过音乐（事件总线）形成了默契的协作。这种模式的核心理念是"**契约优于调用**"——服务之间通过约定好的事件格式进行通信，而不是直接调用彼此的接口。

**核心特征：**
- 服务之间通过事件总线（Event Bus）完全解耦，彼此不直接通信
- 没有单点控制，每个服务都是自治的独立单元
- 控制流隐含在事件链中，需要追踪才能理清完整的业务流程
- 新增服务只需订阅已有事件，无需修改任何上游代码
- 每个服务可以独立部署、独立扩展、独立演进

**典型适用场景：** 实时数据管道、日志收集、非关键业务通知、松耦合的辅助功能集成（如数据分析、推荐系统、审计日志）。

### 1.2 Orchestration（指挥模式）

Orchestration 是一种中心化的协调方式。一个专门的编排器（Orchestrator）负责定义和执行完整的业务流程。编排器依次调用各个服务、处理响应、编排分支逻辑、管理错误重试和补偿操作。

就像交响乐团的指挥家：他清楚每一个乐器的演奏时机、每一个乐段的起承转合，通过手势和眼神统一协调整个乐团的演奏。编排器就是微服务世界中的"指挥家"。

**核心特征：**
- 有一个明确的指挥器（Orchestrator / Workflow Engine）作为流程控制中心
- 控制流清晰可见，流程定义集中管理，一目了然
- 编排器了解所有参与服务的职责和接口
- 修改流程只需调整编排器逻辑，不影响参与服务
- 天然支持事务管理、补偿操作和状态追踪

**典型适用场景：** 复杂业务流程（审批流程、合同签署）、需要强一致性的核心交易、长期运行的工作流（订单履约、物流跟踪）、需要完整审计追踪的合规场景。

### 1.3 一张图看懂差异

```
Choreography（编舞）:
  Service A ──Event1──► Service B ──Event2──► Service C
  （去中心化，事件驱动，每个节点自治，控制流隐含在事件链中）

Orchestration（指挥）:
              ┌─── 调用 ──► Service A
  Orchestrator ── 调用 ──► Service B
              └─── 调用 ──► Service C
  （中心化，流程驱动，指挥器统筹全局，控制流集中可见）
```

---

## 二、核心区别：耦合度、控制流、可观测性

理解两种范式的本质差异，需要从多个维度进行深入分析。

### 2.1 耦合度

**Choreography 的耦合是"契约级"的：** 服务之间只依赖事件的 schema（结构定义），不直接调用彼此的接口。这意味着修改库存服务的内部实现不会影响订单服务——只要事件格式不变。这种解耦程度在理论上是最优的，但代价是失去了对全局流程的直接控制。

**Orchestration 的耦合是"接口级"的：** 编排器直接依赖每个参与服务的 API 接口。如果库存服务的接口发生变化，编排器也需要相应修改。但这种耦合是显式的、可控的，开发者可以清楚地知道哪些服务之间存在依赖关系。

### 2.2 控制流

**Choreography 的控制流是隐式的：** 它分散在事件链中。要理解"下单成功后会依次发生什么"，你需要追踪每一个事件的订阅者，可能涉及十几个监听器分布在不同的服务中。流程的可视化和文档化成为一项挑战。

**Orchestration 的控制流是显式的：** 它集中在编排器中。打开编排器的代码，你就能看到完整的业务流程：先做什么、后做什么、什么条件下走分支、失败了怎么补偿。流程的可视化和文档化变得自然且准确。

### 2.3 可观测性

**Choreography 的可观测性较差：** 由于事件分散在不同的服务和消息队列中，追踪一个请求的完整执行路径需要跨多个服务聚合日志和追踪数据。在生产环境中，如果没有完善的分布式追踪系统，调试将变成噩梦。

**Orchestration 的可观测性较好：** 所有流程状态集中在编排器中，监控系统可以轻松获取每个步骤的执行状态、耗时和错误信息。排障时可以直接定位到具体的步骤，大大降低了调试难度。

### 2.4 完整对比表

| 维度 | Choreography | Orchestration |
|------|-------------|---------------|
| **耦合度** | 低：服务只依赖事件契约 | 中高：编排器依赖所有参与服务 |
| **控制流** | 隐式：分散在事件链中 | 显式：集中在编排器中 |
| **可观测性** | 差：事件链分散，需跨服务追踪 | 好：流程集中，统一监控 |
| **灵活性** | 高：新增服务零侵入 | 中：需修改编排器 |
| **一致性管理** | 复杂：需每个服务自行实现补偿 | 简单：编排器统一管理 |
| **单点故障** | 无（去中心化） | 编排器是潜在单点 |
| **测试难度** | 高：端到端测试需完整事件链 | 低：可单独测试编排器 |
| **学习曲线** | 较陡：需要事件驱动思维 | 较平缓：传统流程控制思维 |
| **调试体验** | 差：需要分布式追踪工具 | 好：集中日志和状态管理 |

---

## 三、Choreography 实战：Laravel Events + Kafka

### 3.1 电商订单场景的事件驱动架构设计

在 Choreography 模式下，整个订单创建流程被拆分为一系列事件驱动的步骤。订单服务在创建订单后发布 `OrderCreated` 事件，库存服务、通知服务、物流服务分别订阅并响应这些事件，每个服务在完成自己的职责后又发布新的事件，形成一条事件链。

**事件基类定义：**

```php
// app/Events/DomainEvent.php
namespace App\Events;

abstract class DomainEvent
{
    protected string $eventId;
    protected string $eventType;
    protected string $aggregateId;
    protected string $timestamp;
    protected array $metadata;

    public function __construct(string $aggregateId)
    {
        $this->eventId = (string) Str::uuid();
        $this->eventType = class_basename(static::class);
        $this->aggregateId = $aggregateId;
        $this->timestamp = now()->toIso8601String();
        $this->metadata = [
            'correlation_id' => Str::uuid(),
            'causation_id' => request()->header('X-Request-ID', 'system'),
        ];
    }

    public function toKafkaMessage(): array
    {
        return [
            'event_id' => $this->eventId,
            'event_type' => $this->eventType,
            'aggregate_id' => $this->aggregateId,
            'timestamp' => $this->timestamp,
            'metadata' => $this->metadata,
            'payload' => $this->payload(),
        ];
    }

    abstract public function payload(): array;
}
```

**订单创建事件：**

```php
// app/Events/OrderCreated.php
namespace App\Events;

use Illuminate\Support\Str;

class OrderCreated extends DomainEvent
{
    public function __construct(
        public readonly string $orderId,
        public readonly string $userId,
        public readonly array $items,
        public readonly float $totalAmount,
        public readonly string $shippingAddress,
    ) {
        parent::__construct($orderId);
    }

    public function payload(): array
    {
        return [
            'order_id' => $this->orderId,
            'user_id' => $this->userId,
            'items' => $this->items,
            'total_amount' => $this->totalAmount,
            'shipping_address' => $this->shippingAddress,
        ];
    }
}
```

**订单服务发布事件：**

```php
// app/Services/OrderService.php
namespace App\Services;

use App\Events\OrderCreated;
use App\Models\Order;
use App\Infrastructure\Kafka\KafkaPublisher;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function __construct(
        private KafkaPublisher $kafkaPublisher,
    ) {}

    public function createOrder(array $data): Order
    {
        return DB::transaction(function () use ($data) {
            $order = Order::create([
                'user_id' => $data['user_id'],
                'items' => $data['items'],
                'total_amount' => $data['total_amount'],
                'shipping_address' => $data['shipping_address'],
                'status' => 'created',
            ]);

            // 使用 Outbox Pattern 确保事件可靠性发布
            $event = new OrderCreated(
                orderId: $order->id,
                userId: $data['user_id'],
                items: $data['items'],
                totalAmount: $data['total_amount'],
                shippingAddress: $data['shipping_address'],
            );

            OutboxEvent::create([
                'event_id' => $event->eventId,
                'event_type' => $event->eventType,
                'aggregate_type' => 'Order',
                'aggregate_id' => $order->id,
                'payload' => json_encode($event->toKafkaMessage()),
                'published' => false,
            ]);

            return $order;
        });
    }
}
```

**库存服务监听器：**

```php
// app/Listeners/Inventory/ReserveInventory.php
namespace App\Listeners\Inventory;

use App\Events\OrderCreated;
use App\Events\InventoryReserved;
use App\Events\InventoryReservationFailed;
use App\Services\InventoryService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

class ReserveInventory implements ShouldQueue
{
    public function __construct(
        private InventoryService $inventoryService,
    ) {}

    public function handle(OrderCreated $event): void
    {
        Log::info('收到订单创建事件', [
            'order_id' => $event->orderId,
            'event_id' => $event->eventId,
        ]);

        try {
            $reservation = $this->inventoryService->reserve(
                orderId: $event->orderId,
                items: $event->items,
            );
            
            // 库存扣减成功，发布下一个事件
            event(new InventoryReserved(
                orderId: $event->orderId,
                userId: $event->userId,
                items: $event->items,
                totalAmount: $event->totalAmount,
                shippingAddress: $event->shippingAddress,
                reservationId: $reservation['id'],
            ));

            Log::info('库存扣减成功', ['order_id' => $event->orderId]);
        } catch (\App\Exceptions\InsufficientStockException $e) {
            Log::warning('库存不足', [
                'order_id' => $event->orderId,
                'reason' => $e->getMessage(),
            ]);
            
            event(new InventoryReservationFailed(
                orderId: $event->orderId,
                reason: $e->getMessage(),
            ));
        } catch (\Exception $e) {
            Log::error('库存扣减异常', [
                'order_id' => $event->orderId,
                'error' => $e->getMessage(),
            ]);
            throw $e; // 重试
        }
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('库存服务处理失败，将进入重试队列', [
            'error' => $exception->getMessage(),
        ]);
    }
}
```

**通知服务监听器：**

```php
// app/Listeners/Notification/SendOrderConfirmation.php
namespace App\Listeners\Notification;

use App\Events\InventoryReserved;
use App\Events\OrderNotificationSent;
use App\Services\NotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;

class SendOrderConfirmation implements ShouldQueue
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function handle(InventoryReserved $event): void
    {
        // 发送订单确认邮件
        $this->notificationService->sendOrderConfirmation(
            userId: $event->userId,
            orderId: $event->orderId,
            items: $event->items,
        );

        // 发送短信通知
        $this->notificationService->sendSms(
            userId: $event->userId,
            template: 'order_confirmed',
            data: ['order_id' => $event->orderId],
        );

        event(new OrderNotificationSent(
            orderId: $event->orderId,
            userId: $event->userId,
        ));
    }
}
```

**物流服务监听器：**

```php
// app/Listeners/Shipping/CreateShippingOrder.php
namespace App\Listeners\Shipping;

use App\Events\OrderNotificationSent;
use App\Events\ShippingOrderCreated;
use App\Services\ShippingService;
use Illuminate\Contracts\Queue\ShouldQueue;

class CreateShippingOrder implements ShouldQueue
{
    public function __construct(
        private ShippingService $shippingService,
    ) {}

    public function handle(OrderNotificationSent $event): void
    {
        $shipping = $this->shippingService->createOrder(
            orderId: $event->orderId,
        );

        event(new ShippingOrderCreated(
            orderId: $event->orderId,
            shippingOrderId: $shipping['id'],
        ));
    }
}
```

### 3.2 Kafka 事件广播配置

```php
// app/Infrastructure/Kafka/KafkaPublisher.php
namespace App\Infrastructure\Kafka;

use Junges\Kafka\Facades\Kafka;
use Junges\Kafka\Message\KafkaMessage;

class KafkaPublisher
{
    private string $defaultTopic;

    public function __construct()
    {
        $this->defaultTopic = config('kafka.default_topic', 'order-events');
    }

    public function publish(string $topic, array $message, array $headers = []): void
    {
        $kafkaMessage = (new KafkaMessage(json_encode($message)))
            ->withHeaders($headers)
            ->withKey($message['event_id'] ?? (string) Str::uuid());

        Kafka::publish()->usingTopic($topic)->send($kafkaMessage);
    }

    public function publishDomainEvent(DomainEvent $event, string $topic = null): void
    {
        $topic = $topic ?? $this->defaultTopic;
        $this->publish($topic, $event->toKafkaMessage());
    }
}
```

**事件消费者配置（Kafka Listener）：**

```php
// app/Infrastructure/Kafka/Consumers/OrderEventConsumer.php
namespace App\Infrastructure\Kafka\Consumers;

use App\Events\OrderCreated;
use App\Events\InventoryReserved;
use App\Events\OrderNotificationSent;
use Junges\Kafka\Contracts\KafkaConsumerMessage;
use Junges\Kafka\MessageHandlers\KafkaHandler;

class OrderEventConsumer implements KafkaHandler
{
    public function __invoke(KafkaConsumerMessage $message): void
    {
        $eventType = $message->headers['event_type'] ?? null;
        $payload = json_decode($message->payload, true);

        match ($eventType) {
            'OrderCreated' => $this->handleOrderCreated($payload),
            'InventoryReserved' => $this->handleInventoryReserved($payload),
            'OrderNotificationSent' => $this->handleOrderNotificationSent($payload),
            default => null,
        };
    }

    private function handleOrderCreated(array $payload): void
    {
        event(new OrderCreated(
            orderId: $payload['order_id'],
            userId: $payload['user_id'],
            items: $payload['items'],
            totalAmount: $payload['total_amount'],
            shippingAddress: $payload['shipping_address'],
        ));
    }

    // ... 其他事件处理方法
}
```

**优势总结：** 新增一个积分服务只需创建一个新的 Listener 订阅 `OrderCreated` 事件，无需修改订单服务的任何代码。各服务完全自治，可独立部署和扩展。这种零侵入的扩展方式是 Choreography 最大的魅力。

---

## 四、Orchestration 实战：集中式工作流编排

### 4.1 工作流步骤接口定义

在 Orchestration 模式下，我们定义统一的工作流步骤接口，每个步骤都包含执行和补偿两个方法：

```php
// app/Contracts/WorkflowStep.php
namespace App\Contracts;

interface WorkflowStep
{
    /**
     * 执行步骤，返回更新后的上下文
     */
    public function execute(array $context): array;

    /**
     * 补偿操作，用于回滚已执行的步骤
     */
    public function compensate(array $context): void;

    /**
     * 步骤名称，用于日志和监控
     */
    public function name(): string;
}
```

### 4.2 各步骤实现

**库存扣减步骤：**

```php
// app/Workflows/Steps/ReserveInventoryStep.php
namespace App\Workflows\Steps;

use App\Contracts\WorkflowStep;
use App\Services\InventoryService;

class ReserveInventoryStep implements WorkflowStep
{
    public function __construct(
        private InventoryService $inventoryService,
    ) {}

    public function name(): string
    {
        return '库存扣减';
    }

    public function execute(array $context): array
    {
        $reservation = $this->inventoryService->reserve(
            orderId: $context['order_id'],
            items: $context['items'],
        );

        return array_merge($context, [
            'inventory_reserved' => true,
            'reservation_id' => $reservation['id'],
            'reservation_expires_at' => $reservation['expires_at'],
        ]);
    }

    public function compensate(array $context): void
    {
        if (!empty($context['reservation_id'])) {
            $this->inventoryService->release(
                reservationId: $context['reservation_id'],
            );
        }
    }
}
```

**通知发送步骤：**

```php
// app/Workflows/Steps/SendNotificationStep.php
namespace App\Workflows\Steps;

use App\Contracts\WorkflowStep;
use App\Services\NotificationService;

class SendNotificationStep implements WorkflowStep
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function name(): string
    {
        return '发送通知';
    }

    public function execute(array $context): array
    {
        $this->notificationService->sendOrderConfirmation(
            userId: $context['user_id'],
            orderId: $context['order_id'],
            items: $context['items'],
        );

        $this->notificationService->sendSms(
            userId: $context['user_id'],
            template: 'order_confirmed',
            data: ['order_id' => $context['order_id']],
        );

        return array_merge($context, [
            'notification_sent' => true,
            'notification_sent_at' => now()->toIso8601String(),
        ]);
    }

    public function compensate(array $context): void
    {
        $this->notificationService->sendOrderCancelled(
            userId: $context['user_id'],
            orderId: $context['order_id'],
        );
    }
}
```

**物流单创建步骤：**

```php
// app/Workflows/Steps/CreateShippingStep.php
namespace App\Workflows\Steps;

use App\Contracts\WorkflowStep;
use App\Services\ShippingService;

class CreateShippingStep implements WorkflowStep
{
    public function __construct(
        private ShippingService $shippingService,
    ) {}

    public function name(): string
    {
        return '创建物流单';
    }

    public function execute(array $context): array
    {
        $shipping = $this->shippingService->createOrder(
            orderId: $context['order_id'],
            address: $context['shipping_address'],
            items: $context['items'],
        );

        return array_merge($context, [
            'shipping_order_id' => $shipping['id'],
            'shipping_tracking_number' => $shipping['tracking_number'],
            'shipping_created_at' => now()->toIso8601String(),
        ]);
    }

    public function compensate(array $context): void
    {
        if (!empty($context['shipping_order_id'])) {
            $this->shippingService->cancel(
                shippingOrderId: $context['shipping_order_id'],
            );
        }
    }
}
```

### 4.3 工作流引擎核心实现

```php
// app/Workflows/WorkflowEngine.php
namespace App\Workflows;

use App\Contracts\WorkflowStep;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

class WorkflowEngine
{
    private array $steps = [];
    private string $workflowId;

    public function __construct()
    {
        $this->workflowId = (string) \Illuminate\Support\Str::uuid();
    }

    public function addStep(WorkflowStep $step): self
    {
        $this->steps[] = $step;
        return $this;
    }

    public function execute(array $initialContext): WorkflowResult
    {
        $executedSteps = [];
        $context = array_merge($initialContext, [
            'workflow_id' => $this->workflowId,
            'started_at' => now()->toIso8601String(),
        ]);

        Log::info('工作流开始执行', [
            'workflow_id' => $this->workflowId,
            'steps' => array_map(fn($s) => $s->name(), $this->steps),
        ]);

        try {
            foreach ($this->steps as $index => $step) {
                Log::info("执行步骤: {$step->name()}", [
                    'workflow_id' => $this->workflowId,
                    'step_index' => $index,
                ]);

                $stepStart = microtime(true);
                $context = $step->execute($context);
                $stepDuration = round((microtime(true) - $stepStart) * 1000, 2);

                Log::info("步骤完成: {$step->name()}", [
                    'workflow_id' => $this->workflowId,
                    'duration_ms' => $stepDuration,
                ]);

                $executedSteps[] = $step;

                // 持久化工作流状态
                $this->saveState($context, $index);
            }

            Log::info('工作流执行成功', ['workflow_id' => $this->workflowId]);

            return new WorkflowResult(
                success: true,
                context: $context,
                executedSteps: array_map(fn($s) => $s->name(), $executedSteps),
            );
        } catch (\Exception $e) {
            Log::error('工作流执行失败', [
                'workflow_id' => $this->workflowId,
                'error' => $e->getMessage(),
                'failed_step' => $step->name(),
            ]);

            // 逆序执行补偿
            $this->compensate(array_reverse($executedSteps), $context);

            return new WorkflowResult(
                success: false,
                context: $context,
                error: $e->getMessage(),
                executedSteps: array_map(fn($s) => $s->name(), $executedSteps),
            );
        }
    }

    private function compensate(array $steps, array $context): void
    {
        foreach ($steps as $step) {
            try {
                Log::info("执行补偿: {$step->name()}", [
                    'workflow_id' => $this->workflowId,
                ]);
                $step->compensate($context);
            } catch (\Exception $e) {
                Log::error("补偿失败: {$step->name()}", [
                    'workflow_id' => $this->workflowId,
                    'error' => $e->getMessage(),
                ]);
                // 记录补偿失败，后续人工处理或重试
                CompensationLog::create([
                    'workflow_id' => $this->workflowId,
                    'step_name' => $step->name(),
                    'error' => $e->getMessage(),
                    'context' => json_encode($context),
                    'status' => 'pending',
                ]);
            }
        }
    }

    private function saveState(array $context, int $currentStep): void
    {
        WorkflowExecution::updateOrCreate(
            ['workflow_id' => $this->workflowId],
            [
                'current_step' => $currentStep,
                'context' => json_encode($context),
                'updated_at' => now(),
            ]
        );
    }
}
```

**使用方式：**

```php
// app/Services/OrderService.php
namespace App\Services;

use App\Workflows\WorkflowEngine;
use App\Workflows\Steps\ReserveInventoryStep;
use App\Workflows\Steps\SendNotificationStep;
use App\Workflows\Steps\CreateShippingStep;
use App\Models\Order;

class OrderService
{
    public function createOrder(array $data): array
    {
        $order = Order::create([
            'user_id' => $data['user_id'],
            'items' => $data['items'],
            'total_amount' => $data['total_amount'],
            'shipping_address' => $data['shipping_address'],
            'status' => 'processing',
        ]);

        $workflow = new WorkflowEngine();
        $result = $workflow
            ->addStep(new ReserveInventoryStep())
            ->addStep(new SendNotificationStep())
            ->addStep(new CreateShippingStep())
            ->execute([
                'order_id' => $order->id,
                'user_id' => $data['user_id'],
                'items' => $data['items'],
                'total_amount' => $data['total_amount'],
                'shipping_address' => $data['shipping_address'],
            ]);

        if ($result->success) {
            $order->update(['status' => 'completed']);
        } else {
            $order->update([
                'status' => 'failed',
                'error_message' => $result->error,
            ]);
        }

        return $result->toArray();
    }
}
```

### 4.4 基于 Temporal 的持久化编排（进阶方案）

对于需要长时间运行、支持暂停恢复、具备完善重试机制的场景，推荐使用 Temporal 工作流引擎：

```php
// 使用 Temporal PHP SDK 定义工作流
namespace App\Temporal\Workflows;

use Temporal\Workflow;

#[Workflow\WorkflowInterface]
class OrderTemporalWorkflow
{
    #[Workflow\WorkflowMethod]
    public function execute(array $orderData): mixed
    {
        // 步骤1：扣减库存（设置30秒超时）
        $reservation = yield Workflow::executeActivity(
            'ReserveInventoryActivity',
            args: [$orderData],
            startToCloseTimeout: '30s',
            retryPolicy: [
                'maximumAttempts' => 3,
                'initialInterval' => '1s',
                'maximumInterval' => '10s',
            ],
        );

        // 步骤2：发送通知（设置10秒超时）
        yield Workflow::executeActivity(
            'SendNotificationActivity',
            args: [$orderData, $reservation],
            startToCloseTimeout: '10s',
        );

        // 步骤3：创建物流单（设置30秒超时）
        $shipping = yield Workflow::executeActivity(
            'CreateShippingActivity',
            args: [$orderData],
            startToCloseTimeout: '30s',
        );

        return [
            'reservation' => $reservation,
            'shipping' => $shipping,
            'status' => 'completed',
        ];
    }

    /**
     * Temporal 原生支持工作流查询，可以随时获取执行状态
     */
    #[Workflow\QueryMethod]
    public function getStatus(): array
    {
        return [
            'workflow_id' => Workflow::getInfo()->execution->workflowID,
            'status' => 'running', // Temporal 自动追踪
        ];
    }
}

// Activity 实现
namespace App\Temporal\Activities;

use Temporal\Activity;

#[Activity\ActivityInterface]
class OrderActivities
{
    #[Activity\ActivityMethod]
    public function reserveInventory(array $orderData): array
    {
        return app(InventoryService::class)->reserve(
            orderId: $orderData['order_id'],
            items: $orderData['items'],
        );
    }

    #[Activity\ActivityMethod]
    public function sendNotification(array $orderData, array $reservation): void
    {
        app(NotificationService::class)->sendOrderConfirmation(
            userId: $orderData['user_id'],
            orderId: $orderData['order_id'],
        );
    }

    #[Activity\ActivityMethod]
    public function createShipping(array $orderData): array
    {
        return app(ShippingService::class)->createOrder(
            orderId: $orderData['order_id'],
            address: $orderData['shipping_address'],
        );
    }
}
```

**Temporal 的核心优势：**
- 工作流状态自动持久化，编排器重启后可恢复
- 原生支持超时、重试、补偿
- 支持工作流的暂停、恢复、信号发送
- 提供完善的 UI 界面（Temporal Web UI）用于监控和调试
- 自动处理编排器的高可用和故障转移

---

## 五、电商订单场景完整对比

以「下单→扣库存→发通知→生成物流单」为例，深入分析两种范式的执行差异。

### 5.1 Choreography 执行流程详解

```
用户点击"下单"按钮
  ↓
OrderService 接收请求，创建订单（本地事务）
  ↓
发布 OrderCreated 事件到 Kafka（Outbox Pattern）
  ↓（异步，毫秒级延迟）
Kafka Consumer 消费事件，触发 Laravel Event
  ↓
InventoryService 监听 OrderCreated → 扣减库存
  ↓
发布 InventoryReserved 事件
  ↓（异步）
NotificationService 监听 InventoryReserved → 发送确认邮件和短信
  ↓
发布 OrderNotificationSent 事件
  ↓（异步）
ShippingService 监听 OrderNotificationSent → 创建物流单
  ↓
发布 ShippingOrderCreated 事件
  ↓
整个流程完成
```

**Choreography 的执行特点：**

1. **响应时间极短：** 用户点击下单后，系统只需创建订单并发布事件，整个过程在几十毫秒内完成。用户可以立即看到"订单已创建"的反馈，后续的库存扣减、通知发送、物流创建都在后台异步完成。

2. **事件链追踪困难：** 如果物流单创建失败，你需要从 `ShippingService` 的日志开始，反向追踪到 `OrderNotificationSent` 事件，再到 `NotificationService`，再到 `InventoryReserved` 事件，最后到 `OrderCreated` 事件。这条追踪链可能跨越多个服务、多个日志系统。

3. **中间状态可见：** 在事件传播期间，订单可能处于一种"半完成"的状态：库存已扣减但通知尚未发送。这在某些业务场景下是可以接受的，但在需要强一致性的场景下则是问题。

4. **服务间零依赖：** 订单服务不需要知道库存服务、通知服务、物流服务的存在。每个服务只关心自己订阅的事件，完全自治。

### 5.2 Orchestration 执行流程详解

```
用户点击"下单"按钮
  ↓
OrderService 接收请求，创建订单
  ↓
调用 OrderWorkflowEngine 执行工作流
  ↓
WorkflowEngine 执行步骤1：ReserveInventoryStep → 扣减库存
  ↓（同步调用，等待响应）
WorkflowEngine 执行步骤2：SendNotificationStep → 发送通知
  ↓（同步调用，等待响应）
WorkflowEngine 执行步骤3：CreateShippingStep → 创建物流单
  ↓（同步调用，等待响应）
所有步骤完成，返回成功结果
  ↓
订单状态更新为"已完成"
```

**Orchestration 的执行特点：**

1. **流程完全可控：** 编排器清楚地知道每一步该做什么、什么时候做、失败了怎么处理。整个流程的执行顺序、超时时间、重试策略都在编排器中统一管理。

2. **上下文完整流转：** 编排器在步骤之间传递完整的上下文信息。库存扣减后获得的 `reservation_id` 可以直接传递给后续步骤和补偿操作，无需跨服务查询。

3. **补偿逻辑集中：** 如果物流创建失败，编排器可以立即执行逆序补偿：发送取消通知、释放库存、更新订单状态。所有补偿操作在同一上下文中执行，确保一致性。

4. **响应时间较长：** 用户需要等待整个工作流完成才能得到反馈。如果每个步骤耗时200ms，三个步骤加上网络延迟，总耗时可能达到1-2秒。

### 5.3 时间线对比

```
Choreography 时间线：
├── 0ms    用户下单
├── 50ms   订单创建完成，返回"下单成功"（用户看到响应）
├── 200ms  库存扣减完成
├── 500ms  通知发送完成
├── 800ms  物流单创建完成
└── 800ms  整个流程异步完成

Orchestration 时间线：
├── 0ms    用户下单
├── 50ms   订单创建完成
├── 300ms  库存扣减完成
├── 500ms  通知发送完成
├── 800ms  物流单创建完成
└── 800ms  返回"下单成功"给用户（用户看到响应）
```

---

## 六、Saga 模式在两种范式中的实现差异

Saga 模式是解决分布式事务问题的核心方案。在微服务架构中，一个业务操作可能涉及多个服务的本地事务，Saga 通过定义一系列补偿操作来保证最终一致性。两种范式下 Saga 的实现有本质区别。

### 6.1 Choreography-based Saga

在 Choreography 模式下，Saga 的补偿逻辑分散在各个服务中。每个服务监听失败事件，自行决定如何补偿：

```php
// 订单取消事件处理器（补偿入口）
class OrderCancelledHandler implements ShouldQueue
{
    public function handle(OrderCancelled $event): void
    {
        // 释放库存
        InventoryReservation::where('order_id', $event->orderId)
            ->update(['status' => 'released']);
        
        // 取消物流单
        ShippingOrder::where('order_id', $event->orderId)
            ->update(['status' => 'cancelled']);
        
        // 发送取消通知
        Notification::create([
            'user_id' => $event->userId,
            'template' => 'order_cancelled',
            'data' => ['order_id' => $event->orderId],
        ]);
    }
}

// 库存扣减失败的补偿处理器
class InventoryReservationFailedHandler implements ShouldQueue
{
    public function handle(InventoryReservationFailed $event): void
    {
        // 通知订单服务回滚订单状态
        Order::where('id', $event->orderId)
            ->update([
                'status' => 'cancelled',
                'cancel_reason' => $event->reason,
                'cancelled_at' => now(),
            ]);
    }
}

// 物流单创建失败的补偿处理器
class ShippingCreationFailedHandler implements ShouldQueue
{
    public function handle(ShippingCreationFailed $event): void
    {
        // 释放库存
        event(new ReleaseInventory(
            orderId: $event->orderId,
            reservationId: $event->reservationId,
        ));
        
        // 发送取消通知
        event(new OrderCancelled(
            orderId: $event->orderId,
            userId: $event->userId,
            reason => '物流服务异常',
        ));
    }
}
```

**Choreography-based Saga 的关键特征：**

- 补偿逻辑像事件链一样层层传递，每个服务只负责自己的补偿操作
- 补偿的触发依赖事件的可靠性（如果补偿事件丢失，Saga 会卡住）
- 无法保证补偿的原子性——可能库存已释放但通知未发送
- 调试 Saga 的执行路径需要跨多个服务聚合日志
- 适合简单的补偿场景，复杂的补偿逻辑容易失控

### 6.2 Orchestration-based Saga

在 Orchestration 模式下，Saga 的补偿逻辑集中在编排器中统一管理：

```php
class OrderSagaOrchestrator
{
    private array $compensationStack = [];
    private string $sagaId;

    public function __construct()
    {
        $this->sagaId = (string) Str::uuid();
    }

    public function execute(array $orderData): SagaResult
    {
        $this->compensationStack = [];

        try {
            // 步骤1：扣减库存
            $reservation = app(InventoryService::class)->reserve($orderData);
            $this->pushCompensation('release_inventory', [
                'reservation_id' => $reservation['id'],
            ]);

            // 步骤2：发送通知
            app(NotificationService::class)->sendConfirmation($orderData);
            $this->pushCompensation('cancel_notification', [
                'order_id' => $orderData['order_id'],
            ]);

            // 步骤3：创建物流
            $shipping = app(ShippingService::class)->create($orderData);
            $this->pushCompensation('cancel_shipping', [
                'shipping_order_id' => $shipping['id'],
            ]);

            return SagaResult::success($this->sagaId);
        } catch (\Exception $e) {
            $this->compensate($e->getMessage());
            return SagaResult::failure($this->sagaId, $e->getMessage());
        }
    }

    private function pushCompensation(string $action, array $params): void
    {
        $this->compensationStack[] = [
            'action' => $action,
            'params' => $params,
        ];
    }

    private function compensate(string $reason): void
    {
        Log::info("Saga 开始补偿", [
            'saga_id' => $this->sagaId,
            'reason' => $reason,
            'steps_to_compensate' => count($this->compensationStack),
        ]);

        foreach (array_reverse($this->compensationStack) as $compensation) {
            try {
                match ($compensation['action']) {
                    'release_inventory' => app(InventoryService::class)->release(
                        $compensation['params']['reservation_id']
                    ),
                    'cancel_notification' => app(NotificationService::class)->cancel(
                        $compensation['params']['order_id']
                    ),
                    'cancel_shipping' => app(ShippingService::class)->cancel(
                        $compensation['params']['shipping_order_id']
                    ),
                };
            } catch (\Exception $e) {
                Log::error("Saga 补偿失败", [
                    'saga_id' => $this->sagaId,
                    'action' => $compensation['action'],
                    'error' => $e->getMessage(),
                ]);
                // 记录到补偿日志表，由定时任务重试
                CompensationLog::create([
                    'saga_id' => $this->sagaId,
                    'action' => $compensation['action'],
                    'params' => json_encode($compensation['params']),
                    'error' => $e->getMessage(),
                    'status' => 'pending_retry',
                ]);
            }
        }
    }
}
```

### 6.3 两种 Saga 实现的关键差异对比

| 维度 | Choreography-based Saga | Orchestration-based Saga |
|------|------------------------|-------------------------|
| **补偿触发** | 事件驱动，分散在各服务 | 集中式，编排器统一调用 |
| **状态追踪** | 需要跨服务聚合日志 | 编排器中有完整上下文 |
| **补偿原子性** | 弱（无法保证全部补偿完成） | 强（编排器控制补偿顺序） |
| **代码修改** | 新增补偿步骤零侵入 | 需修改编排器代码 |
| **调试体验** | 差（需要分布式追踪） | 好（集中日志和状态） |
| **故障恢复** | 复杂（需要事件重放机制） | 简单（编排器状态持久化） |
| **适用场景** | 简单补偿、松耦合场景 | 复杂补偿、需要强一致性 |

---

## 七、错误处理与补偿机制深度对比

### 7.1 Choreography 的错误处理策略

Choreography 中的错误处理依赖事件驱动的补偿链。每个服务需要独立处理自己的错误，并通过事件通知其他服务进行补偿：

```php
// 带重试的事件处理器
class ReserveInventory implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 5;

    public function handle(OrderCreated $event): void
    {
        try {
            app(InventoryService::class)->reserve(
                orderId: $event->orderId,
                items: $event->items,
            );
        } catch (InsufficientStockException $e) {
            // 不可重试的异常，立即触发补偿
            event(new InventoryReservationFailed(
                orderId: $event->orderId,
                reason => $e->getMessage(),
            ));
            return; // 不抛出异常，避免进入重试队列
        } catch (TransientException $e) {
            // 可重试的异常，抛出让 Laravel Queue 重试
            throw $e;
        }
    }

    public function failed(\Throwable $exception): void
    {
        // 3次重试全部失败，进入死信队列
        // 记录到人工处理队列
        DeadLetterLog::create([
            'event_type' => 'OrderCreated',
            'aggregate_id' => $this->orderId,
            'error' => $exception->getMessage(),
            'retry_count' => $this->attempts(),
        ]);
    }
}
```

**关键问题：** 在 Choreography 中，如果补偿事件本身发布失败（例如 Kafka 暂时不可用），整个 Saga 将卡在中间状态。需要额外的机制来检测和恢复这种状态——例如定期扫描"悬挂"的订单，检查其状态是否长时间未更新。

### 7.2 Orchestration 的错误处理策略

Orchestration 的错误处理和补偿集中在编排器中，支持更精细的控制：

```php
class OrderOrchestratorWithAdvancedErrorHandling
{
    public function executeWithGracefulDegradation(array $data): array
    {
        try {
            // 主流程执行
            return $this->execute($data);
        } catch (InventoryException $e) {
            // 库存服务异常：可以降级处理
            if ($this->canDegradateInventory($data)) {
                return $this->executeWithDegradedInventory($data);
            }
            $this->compensate($data);
            return ['success' => false, 'error' => '库存服务异常'];
        } catch (NotificationException $e) {
            // 通知服务异常：不影响主流程，记录失败即可
            Log::warning('通知服务异常，但不影响订单创建', [
                'order_id' => $data['order_id'],
            ]);
            return ['success' => true, 'warning' => '通知发送失败，稍后重试'];
        } catch (\Exception $e) {
            // 其他异常：执行完整补偿
            $this->compensate($data);
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    private function compensate(array $data): void
    {
        // 编排器可以根据异常类型选择性补偿
        foreach (array_reverse($this->compensationStack) as $compensation) {
            $compensation->execute();
        }
    }
}
```

**优势：** Orchestration 可以实现更复杂的错误处理策略，如降级处理、选择性补偿、基于异常类型的差异化处理等。所有逻辑集中在编排器中，便于测试和维护。

---

## 八、可观测性与调试难度对比

### 8.1 Choreography 的可观测性挑战

在 Choreography 中追踪一个请求的完整执行路径是最大的挑战。事件分散在不同的服务、不同的消息队列、不同的日志系统中。

**必须引入的可观测性工具链：**

```php
// 使用 OpenTelemetry 实现分布式追踪
namespace App\Tracing;

use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class EventTracingMiddleware
{
    public function handle($event, $next)
    {
        $tracer = OpenTelemetry::getTracer('order-service');
        
        // 创建 span 记录事件处理
        $span = $tracer->spanBuilder("process-event: " . class_basename($event))
            ->setSpanKind(SpanKind::CONSUMER)
            ->setAttribute('event.type', class_basename($event))
            ->setAttribute('event.order_id', $event->orderId ?? 'unknown')
            ->startSpan();

        try {
            $scope = $tracer->activate($span);
            $result = $next($event);
            $span->setStatus(StatusCode::OK);
            return $result;
        } catch (\Exception $e) {
            $span->setStatus(StatusCode::ERROR, $e->getMessage());
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }
}
```

**调试流程示例：** 当订单 `ORD-12345` 的物流单创建失败时，调试步骤如下：

1. 打开 Jaeger UI，搜索 trace ID
2. 找到 OrderCreated 事件的处理链路
3. 逐个查看每个服务的 span 耗时和状态
4. 发现 ShippingService 的 span 报错："地址解析服务不可用"
5. 定位到问题根因

**痛点总结：**
- 需要搭建和维护完整的可观测性基础设施（Jaeger + Prometheus + Grafana）
- 事件之间的因果关系需要通过 trace ID 手动建立
- 某个步骤卡住时，难以区分是"还在执行"还是"已经失败但补偿事件未发出"
- 需要额外的监控系统来发现"孤悬"的事件（已发布但无人消费）

### 8.2 Orchestration 的可观测性优势

Orchestration 的可观测性天然优于 Choreography，因为流程状态集中在编排器中：

```php
// 工作流状态查询接口
class WorkflowStatusController extends Controller
{
    public function show(string $orderId)
    {
        $execution = WorkflowExecution::where('order_id', $orderId)
            ->with('steps')
            ->firstOrFail();

        return response()->json([
            'order_id' => $orderId,
            'workflow_status' => $execution->status,
            'current_step' => $execution->current_step,
            'steps' => $execution->steps->map(fn($step) => [
                'name' => $step->name,
                'status' => $step->status,
                'started_at' => $step->started_at,
                'completed_at' => $step->completed_at,
                'duration_ms' => $step->duration_ms,
                'error' => $step->error,
            ]),
            'started_at' => $execution->started_at,
            'completed_at' => $execution->completed_at,
            'total_duration_ms' => $execution->total_duration_ms,
        ]);
    }
}
```

**优势总结：**
- 所有步骤状态集中记录在一张表中，查询简单
- 可以精确知道流程卡在哪一步，以及该步骤的执行耗时
- 支持暂停、恢复、人工干预等运维操作
- 可以生成完整的执行报告，用于性能分析和优化
- 结合 Temporal Web UI，可以可视化整个工作流的执行过程

---

## 九、性能与扩展性对比

### 9.1 性能特征深度分析

| 维度 | Choreography | Orchestration |
|------|-------------|---------------|
| **请求响应延迟** | 极低（仅发布事件的时间，通常 < 50ms） | 较高（等待流程完成，通常 500ms-2s） |
| **吞吐量** | 高（各服务独立扩展，事件可并行处理） | 中（受限于编排器的处理能力） |
| **资源消耗** | 分布在各服务（水平扩展） | 集中在编排器（需要纵向扩展或集群） |
| **延迟可预测性** | 低（异步事件链的延迟不可预测） | 高（同步调用，延迟可控） |
| **背压处理** | 依赖消息队列（Kafka 天然支持背压） | 需要编排器自行实现 |

### 9.2 扩展性分析

**Choreography 的扩展优势：**

```php
// 新增积分服务，零侵入——只需创建新的 Listener
class AwardPointsListener implements ShouldQueue
{
    public function handle(OrderCreated $event): void
    {
        $points = (int) ($event->totalAmount / 10); // 每消费10元获1积分
        PointsService::award($event->userId, $points);
    }
}

// 新增数据分析服务，零侵入
class AnalyticsListener implements ShouldQueue
{
    public function handle(OrderCreated $event): void
    {
        AnalyticsService::trackPurchase([
            'user_id' => $event->userId,
            'amount' => $event->totalAmount,
            'items_count' => count($event->items),
        ]);
    }
}

// 新增审计日志服务，零侵入
class AuditLogListener implements ShouldQueue
{
    public function handle(OrderCreated $event): void
    {
        AuditLog::create([
            'action' => 'order_created',
            'aggregate_id' => $event->orderId,
            'user_id' => $event->userId,
            'payload' => json_encode($event->payload()),
        ]);
    }
}
```

新增积分服务、数据分析服务、审计日志服务都只需创建新的 Listener，订阅 `OrderCreated` 事件即可，完全不影响现有的任何服务。

**Orchestration 的扩展方式：**

```php
// 新增步骤需要修改编排器
class OrderWorkflow
{
    public function steps(): array
    {
        return [
            ReserveInventoryStep::class,      // 已有
            AwardPointsStep::class,           // 新增
            SendNotificationStep::class,      // 已有
            CreateShippingStep::class,        // 已有
            AuditLogStep::class,              // 新增
            AnalyticsTrackStep::class,        // 新增
        ];
    }
}
```

虽然需要修改编排器，但这种修改是显式的、可控的，可以配合代码审查和自动化测试来保证质量。

### 9.3 数据一致性窗口

Choreography 的异步特性意味着在事件传播期间存在数据不一致窗口。例如：

- 订单已创建，但库存尚未扣减 → 前端显示"订单创建成功"但实际可能库存不足
- 库存已扣减，但通知尚未发送 → 用户不知道订单状态
- 通知已发送，但物流单尚未创建 → 用户看到确认信息但物流单不存在

这种不一致窗口在大多数业务场景下是可以接受的（最终一致性），但在金融、医疗等高合规性场景下可能成为问题。

Orchestration 通过同步调用缩小了这个窗口，但代价是增加了响应延迟。需要根据业务需求在一致性和性能之间做出权衡。

---

## 十、实战踩坑记录

### 10.1 消息丢失——最隐蔽的定时炸弹

**问题描述：** 在高并发场景下，Laravel 的 `event()` 函数配合 Kafka 可能出现消息丢失。特别是当 Kafka 集群发生分区重平衡或 broker 重启时，fire-and-forget 模式发送的消息可能悄然消失。

**踩坑经历：** 某次线上事故中，订单服务正常返回了"下单成功"，但库存服务没有收到事件。用户看到订单成功但实际未扣减库存，导致超卖。排查后发现是 Kafka producer 在发送时遇到了网络抖动，消息被丢弃但 producer 未抛出异常。

**解决方案：事务性发件箱（Outbox Pattern）**

```php
// 确保事件发布和业务操作在同一事务中
class OrderService
{
    public function createOrder(array $data): Order
    {
        return DB::transaction(function () use ($data) {
            // 业务操作
            $order = Order::create($data);
            
            // 事件保存到本地数据库（事务保证一致性）
            OutboxEvent::create([
                'event_id' => Str::uuid(),
                'event_type' => 'OrderCreated',
                'aggregate_type' => 'Order',
                'aggregate_id' => $order->id,
                'payload' => json_encode([
                    'order_id' => $order->id,
                    'user_id' => $data['user_id'],
                    'items' => $data['items'],
                    'total_amount' => $order->total_amount,
                ]),
                'published' => false,
                'created_at' => now(),
            ]);
            
            return $order;
        });
    }
}

// 独立进程（定时任务或 Supervisor 守护进程）扫描并发布事件
class OutboxProcessor
{
    public function process(): void
    {
        OutboxEvent::where('published', false)
            ->orderBy('created_at')
            ->chunkById(100, function ($events) {
                foreach ($events as $event) {
                    try {
                        Kafka::publish('order-events')
                            ->withMessage(new KafkaMessage($event->payload))
                            ->send();
                        
                        $event->update([
                            'published' => true,
                            'published_at' => now(),
                        ]);
                    } catch (\Exception $e) {
                        Log::error('事件发布失败', [
                            'event_id' => $event->event_id,
                            'error' => $e->getMessage(),
                        ]);
                        // 不更新 published 状态，下次重试
                    }
                }
            });
    }
}
```

### 10.2 死循环事件——看不见的性能黑洞

**问题描述：** 两个服务互相监听对方的事件，形成事件循环。例如：订单服务发布 `OrderCreated`，库存服务处理后发布 `InventoryReserved`，订单服务又监听 `InventoryReserved` 并发布 `OrderUpdated`，库存服务又监听 `OrderUpdated` 并发布 `InventoryUpdated`……

**踩坑经历：** 某次上线后，Kafka 的消费者 lag 突然飙升，CPU 使用率飙升到 100%。排查发现是两个服务的事件处理器形成了循环：`OrderCreated` → `InventoryReserved` → `OrderUpdated` → `InventoryUpdated` → `OrderSynced` → `InventorySynced` ……事件在两个服务之间无限循环。

**解决方案：**

```php
// 方案1：在事件元数据中标记已处理的服务
class DomainEvent
{
    public array $processedBy = [];

    public function markProcessed(string $service): self
    {
        $this->processedBy[] = $service;
        return $this;
    }
}

class InventoryReservedHandler implements ShouldQueue
{
    public function handle(InventoryReserved $event): void
    {
        // 如果事件已经被库存服务处理过，跳过
        if (in_array('InventoryService', $event->processedBy)) {
            Log::info('跳过重复处理', ['event_id' => $event->eventId]);
            return;
        }

        // 处理逻辑...
        
        // 标记已处理
        $event->markProcessed('InventoryService');
    }
}

// 方案2：设计单向事件流，避免循环依赖
// 正确的事件流设计应该是单向的：
// OrderCreated → InventoryReserved → NotificationSent → ShippingCreated
// 而不是：
// OrderCreated ↔ InventoryReserved（双向）
```

### 10.3 编排器单点故障——Orchestration 的阿喀琉斯之踵

**问题描述：** 在 Orchestration 模式下，如果编排器所在的服务器宕机，所有正在执行的工作流都会中断。如果编排器的状态只保存在内存中，重启后将丢失所有执行上下文。

**踩坑经历：** 某次服务器重启后，30多个正在执行的订单工作流全部丢失。这些订单的库存已扣减但物流单未创建，用户投诉大量涌入。

**解决方案：**

```php
// 方案1：编排器状态持久化到数据库
class PersistedWorkflowEngine
{
    public function execute(array $data): WorkflowResult
    {
        // 创建持久化执行记录
        $execution = WorkflowExecution::create([
            'workflow_id' => $this->workflowId,
            'order_id' => $data['order_id'],
            'status' => 'running',
            'current_step' => 0,
            'context' => json_encode($data),
            'created_at' => now(),
        ]);

        try {
            foreach ($this->steps as $index => $step) {
                // 更新当前步骤
                $execution->update(['current_step' => $index]);
                
                $context = json_decode($execution->context, true);
                $context = $step->execute($context);
                
                // 持久化更新后的上下文
                $execution->update(['context' => json_encode($context)]);
            }
            
            $execution->update(['status' => 'completed']);
            return WorkflowResult::success($context);
        } catch (\Exception $e) {
            $execution->update([
                'status' => 'failed',
                'error_message' => $e->getMessage(),
            ]);
            throw $e;
        }
    }
}

// 方案2：使用 Temporal 实现自动故障恢复
// Temporal 工作流引擎会自动持久化所有工作流状态
// 编排器进程重启后，Temporal 会自动恢复执行
// 无需手动管理状态持久化
```

### 10.4 其他常见踩坑

**消息顺序问题：** Kafka 虽然保证分区内消息有序，但不同分区的消息可能乱序。如果事件处理依赖顺序（如先创建订单再扣库存），需要确保相关事件发送到同一个分区（使用 order_id 作为 partition key）。

**重复消费问题：** Kafka 消费者可能重复消费同一条消息（例如 rebalance 后）。所有事件处理器都需要实现幂等性：

```php
class ReserveInventory implements ShouldQueue
{
    public function handle(OrderCreated $event): void
    {
        // 幂等性检查：检查是否已经处理过这个事件
        if (ProcessedEvent::where('event_id', $event->eventId)->exists()) {
            return;
        }

        // 使用数据库乐观锁或 Redis 分布式锁防止并发处理
        $lock = Redis::lock("inventory:{$event->orderId}", 30);
        if (!$lock->get()) {
            throw new CouldNotAcquireLockException();
        }

        try {
            // 执行库存扣减...
            
            // 记录事件已处理
            ProcessedEvent::create([
                'event_id' => $event->eventId,
                'processed_at' => now(),
            ]);
        } finally {
            $lock->release();
        }
    }
}
```

---

## 十一、选型决策树

选择合适的编排范式需要综合考虑多个因素。以下是一个实用的决策框架：

### 11.1 核心决策维度

```
┌─────────────────────────────────────────────────────┐
│                编排范式选型决策树                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. 业务流程是否需要强一致性？                        │
│     ├── 是 ──► Orchestration                        │
│     └── 否 ──► 继续判断                              │
│                                                     │
│  2. 是否需要长时间运行的工作流？                      │
│     │    （超过10秒、需要暂停/恢复）                  │
│     ├── 是 ──► Orchestration + Temporal             │
│     └── 否 ──► 继续判断                              │
│                                                     │
│  3. 流程是否频繁变更？                               │
│     │    （每周/每月都有新的业务规则）                 │
│     ├── 是 ──► Orchestration（集中管理更灵活）        │
│     └── 否 ──► 继续判断                              │
│                                                     │
│  4. 是否需要完整的审计追踪？                          │
│     │    （合规要求、金融场景）                       │
│     ├── 是 ──► Orchestration                        │
│     └── 否 ──► 继续判断                              │
│                                                     │
│  5. 微服务数量是否超过10个？                          │
│     ├── 是 ──► Choreography（避免编排器过于复杂）     │
│     └── 否 ──► 继续判断                              │
│                                                     │
│  6. 团队是否熟悉事件驱动架构？                        │
│     ├── 是 ──► Choreography                         │
│     └── 否 ──► Orchestration（学习曲线更平缓）        │
│                                                     │
│  7. 是否追求极致的解耦和独立部署？                    │
│     ├── 是 ──► Choreography                         │
│     └── 否 ──► Orchestration                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 11.2 场景速查表

| 业务场景 | 推荐范式 | 原因 |
|---------|---------|------|
| 电商订单核心流程 | Orchestration | 需要强一致性和完整补偿 |
| 用户注册后的欢迎流程 | Choreography | 松耦合，发送邮件/分配积分/创建空间可并行 |
| 金融转账 | Orchestration | 强一致性要求，需要精确的补偿控制 |
| 日志收集与分析 | Choreography | 高吞吐量，松耦合，允许最终一致性 |
| 审批工作流 | Orchestration | 流程复杂，需要暂停/恢复/分支 |
| 实时通知推送 | Choreography | 高并发，可并行处理多个通知渠道 |
| 物流跟踪 | Orchestration | 长时间运行，需要状态持久化 |
| 推荐系统数据管道 | Choreography | 事件驱动，高吞吐量，最终一致性 |
| 合同签署流程 | Orchestration | 合规要求，需要完整审计追踪 |
| 用户行为分析 | Choreography | 实时数据流，高并发处理 |

### 11.3 混合架构：最常见的实践

在实际项目中，最理想的架构往往是混合使用两种范式：

```
核心业务流程（Orchestration）：
  用户下单 → 扣库存 → 扣款 → 生成物流单
  （Orchestrator 集中管理，保证一致性）

辅助功能（Choreography）：
  订单创建事件 → 发送欢迎邮件
  订单创建事件 → 更新用户画像
  订单创建事件 → 推送到数据分析平台
  订单创建事件 → 触发积分奖励
  （各服务独立订阅，松耦合，最终一致性）
```

这种混合架构既保证了核心业务的一致性和可靠性，又保持了辅助功能的灵活性和扩展性。

---

## 十二、总结与最佳实践

### 12.1 核心总结

**Choreography** 是一种去中心化的事件驱动编排范式。它通过事件总线实现服务间的完全解耦，每个服务根据自己的兴趣订阅事件并独立响应。这种模式的最大优势是灵活性和扩展性——新增服务零侵入，各服务完全自治。但代价是控制流隐式化、可观测性差、一致性管理复杂。

**Orchestration** 是一种中心化的工作流驱动编排范式。它通过编排器统一协调所有参与服务，集中管理流程控制、错误处理和补偿操作。这种模式的最大优势是流程清晰、状态可控、补偿逻辑集中。但代价是编排器成为潜在的复杂度集中点和单点故障。

**Saga 模式** 在两种范式下有本质差异：Choreography-based Saga 的补偿逻辑分散在各个服务中，通过事件链触发；Orchestration-based Saga 的补偿逻辑集中在编排器中，通过逆序执行实现。

### 12.2 十大最佳实践

1. **从 Orchestration 开始，渐进式演进。** 除非你的团队对事件驱动架构非常熟悉，否则先用 Orchestration 建立清晰的流程骨架，后续再根据需要将非核心流程拆分为 Choreography。

2. **Outbox Pattern 是事件可靠性的生命线。** 无论选择哪种范式，只要涉及事件发布，就必须实现 Outbox Pattern。业务操作和事件保存在同一数据库事务中，由独立进程负责发布。

3. **所有事件处理器必须实现幂等性。** Kafka 消费者可能重复消费同一条消息，事件处理器必须通过数据库唯一约束、Redis 分布式锁或消息 ID 去重等方式保证幂等性。

4. **Choreography 模式下分布式追踪不可或缺。** 必须接入 OpenTelemetry + Jaeger（或 Zipkin）来实现跨服务的链路追踪，否则调试将成为噩梦。

5. **Orchestration 模式下编排器必须持久化状态。** 使用数据库持久化工作流执行状态，或使用 Temporal 等专业工作流引擎。切勿将状态仅保存在内存中。

6. **为死信队列（DLQ）设置监控告警。** 反复失败的消息会堆积在死信队列中，必须设置监控和告警机制，及时发现和处理。

7. **事件 Schema 必须版本化管理。** 使用 Schema Registry（如 Confluent Schema Registry）或在事件中嵌入版本号，支持向后兼容，避免 Schema 变更导致消费者崩溃。

8. **定期演练补偿流程。** 补偿逻辑往往在开发时编写但从未真正执行过。需要定期通过混沌工程或模拟故障来验证补偿逻辑的正确性。

9. **监控事件端到端延迟。** 在 Choreography 中，事件从发布到被所有消费者处理完成的端到端延迟是关键指标。设置告警阈值，及时发现事件积压。

10. **根据团队规模和技术栈选择。** 小团队、技术栈统一、服务数量少 → 优先 Orchestration（降低复杂度）。大团队、服务数量多、需要高度自治 → 优先 Choreography（提高扩展性）。

---

> **最后的话：** Choreography 和 Orchestration 不是非此即彼的选择，而是架构设计工具箱中的两把利器。大多数成熟的微服务系统都在不同层面混合使用两种范式——核心交易流程用 Orchestration 保证一致性，非核心辅助功能用 Choreography 保持解耦。关键在于理解每种范式的优势和局限，根据业务需求、团队能力和系统复杂度做出合理选择，并在实践中持续演进。架构设计没有银弹，只有最适合当前场景的决策。

---

## 相关阅读

- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/架构/saga-编排模式深度实战-choreography-vs-orchestration-vs-temporal-laravel分布式事务三种实现路线对比/)
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/架构/kafka-debezium-cdc-实战-数据库变更事件流-laravel互补架构/)
- [Data Contract 实战：Pact-style 数据契约——Laravel 微服务间数据格式的版本化、验证与 Breaking Change 检测](/架构/data-contract-pact-style-laravel微服务数据契约版本化验证breaking-change检测/)
- [API Composition Pattern 实战：跨服务查询聚合——Laravel BFF 中的 scatter-gather、结果合并与超时裁剪](/架构/api-composition-pattern-实战-跨服务查询聚合-laravel-bff-scatter-gather/)
- [Laravel Modular Monolith 实战：模块化单体架构——介于单体与微服务之间的最佳平衡点](/架构/laravel-modular-monolith-实战-模块化单体架构-介于单体与微服务之间的最佳平衡点/)
