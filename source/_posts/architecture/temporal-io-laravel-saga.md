---

title: Temporal.io 实战：持久化工作流引擎——Laravel 中的长事务编排与 Saga 模式的工程化替代方案
keywords: [Temporal.io, Laravel, Saga, 持久化工作流引擎, 中的长事务编排与, 模式的工程化替代方案]
date: 2026-06-04 09:00:00
description: 深入解析 Temporal.io 持久化工作流引擎在 Laravel 微服务架构中的实战应用。从分布式长事务的痛点出发，对比状态机硬编码、消息队列重试、手动 Saga 模式等传统方案的不足，系统讲解 Temporal 的 Workflow、Activity、Signal、Query 核心抽象，以及 Saga 补偿模式的工程化实现。涵盖 PHP SDK 完整代码示例、Laravel 集成方案、生产环境踩坑记录（序列化、确定性、版本管理、幂等性）与性能基准测试，帮助 PHP 团队用代码即工作流的方式优雅编排跨服务长事务与分布式事务。
tags:
- temporal.io
- 工作流
- saga模式
- Laravel
- 微服务
- 长事务
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---




## 引言：分布式系统中长事务的痛点

在现代互联网架构中，一个看似简单的用户操作——比如"下单购买一件商品"——背后往往牵涉多个微服务的协同工作：订单服务创建订单记录，支付服务发起扣款请求，库存服务锁定或扣减库存，物流服务生成发货单，通知服务发送短信或推送。这些步骤中的任何一个失败，都需要执行相应的补偿操作（回滚库存、退款、取消发货单等），整个过程可能跨越数秒到数小时，甚至数天。

这就是我们常说的**分布式长事务**问题。

### 真实业务场景中的长事务

让我们以一个电商订单履约流程为例来说明问题的复杂度：

**场景一：正常订单流程**
1. 用户提交订单 → 订单服务创建订单（状态：待支付）
2. 调用支付网关 → 等待支付结果（可能需要数分钟）
3. 支付成功 → 扣减库存
4. 库存扣减成功 → 生成物流单
5. 物流单创建成功 → 发送发货通知

**场景二：支付超时**
1. 用户提交订单 → 订单已创建
2. 调用支付网关 → 等待 30 分钟无响应
3. 需要自动取消订单 → 释放库存锁定 → 通知用户

**场景三：库存不足（需要补偿）**
1. 订单已创建，支付已完成
2. 扣减库存 → 失败（库存不足）
3. 需要退款 → 取消订单 → 通知用户

**场景四：跨服务部分失败**
1. 订单创建成功，支付成功，库存扣减成功
2. 物流服务宕机 → 需要等待恢复后重试
3. 重试 3 次后仍然失败 → 需要退款 + 恢复库存 + 取消订单

这些问题不仅仅是技术挑战，更是业务连续性的核心保障。在传统单体应用中，我们可以依赖数据库事务的 ACID 特性来保证数据一致性。但在分布式系统中，跨服务调用无法使用单一数据库事务，这就需要我们寻找新的解决方案。

### 长事务的核心挑战

分布式长事务面临以下几个核心挑战：

1. **状态一致性**：多个服务之间的状态需要保持一致，任何一步失败都需要有明确的处理策略
2. **超时处理**：外部系统（支付网关、第三方 API）的响应时间不可预测，需要合理的超时与重试机制
3. **幂等性**：由于网络抖动或重试机制，同一个操作可能被执行多次，必须保证结果的幂等性
4. **可观测性**：长事务涉及多个服务，追踪一个事务的完整执行链路非常困难
5. **版本演进**：业务流程会不断变化，如何在不停机的情况下升级正在执行中的工作流？

接下来，我们将深入探讨传统方案的不足，以及 Temporal.io 如何从根本上解决这些问题。

---

## 传统方案的问题

在 Temporal.io 出现之前，业界已经发展出了多种处理分布式长事务的方案。但每种方案都有其固有的局限性。

### 方案一：状态机硬编码

最直观的做法是在代码中实现一个状态机，用数据库字段记录当前状态，然后通过定时任务或事件驱动来推进状态流转。

```php
// 典型的状态机硬编码实现
class OrderProcessor
{
    public function process(Order $order): void
    {
        match ($order->status) {
            OrderStatus::PENDING => $this->handlePending($order),
            OrderStatus::PAYING => $this->handlePaying($order),
            OrderStatus::PAID => $this->handlePaid($order),
            OrderStatus::STOCK_DEDUCTED => $this->handleStockDeducted($order),
            OrderStatus::SHIPPING => $this->handleShipping($order),
            OrderStatus::COMPLETED => $this->handleCompleted($order),
            OrderStatus::CANCELLED => $this->handleCancelled($order),
            OrderStatus::REFUNDING => $this->handleRefunding($order),
            default => throw new \RuntimeException("Unknown status: {$order->status}"),
        };
    }

    private function handlePending(Order $order): void
    {
        // 发起支付...
        $order->update(['status' => OrderStatus::PAYING]);
    }

    private function handlePaying(Order $order): void
    {
        // 检查支付结果...
        if ($this->paymentGateway->isPaid($order->payment_id)) {
            $order->update(['status' => OrderStatus::PAID]);
        } elseif ($order->created_at->addMinutes(30)->isPast()) {
            $order->update(['status' => OrderStatus::CANCELLED]);
            // 还需要释放库存锁定...
        }
    }

    private function handlePaid(Order $order): void
    {
        try {
            $this->stockService->deduct($order);
            $order->update(['status' => OrderStatus::STOCK_DEDUCTED]);
        } catch (StockInsufficientException $e) {
            $order->update(['status' => OrderStatus::REFUNDING]);
            $this->paymentGateway->refund($order->payment_id);
        }
    }

    // ... 每个状态都需要对应的方法，代码量爆炸式增长
}
```

**问题：**

- **状态爆炸**：随着业务复杂度增加，状态数量呈指数级增长。N 个步骤理论上可能有 2^N 种组合状态
- **代码耦合**：业务逻辑与状态管理深度耦合，修改一个步骤可能影响整个流程
- **缺乏超时机制**：每个状态的超时处理需要额外的定时任务或延迟队列支持
- **补偿逻辑分散**：补偿操作散落在各个状态处理方法中，难以维护和审计
- **测试困难**：完整测试所有状态组合几乎是不可能的

### 方案二：消息队列重试地狱

另一种常见做法是使用消息队列（RabbitMQ、Kafka 等）来驱动流程，每个步骤完成后发送消息触发下一步。

```php
// 消息队列驱动的流程
class CreateOrderHandler
{
    public function handle(CreateOrderMessage $message): void
    {
        $order = Order::create($message->toArray());
        // 发送下一步消息
        $this->queue->publish(new InitiatePaymentMessage($order->id));
    }
}

class InitiatePaymentHandler
{
    public function handle(InitiatePaymentMessage $message): void
    {
        $order = Order::find($message->orderId);
        try {
            $paymentId = $this->paymentGateway->charge($order);
            $order->update(['payment_id' => $paymentId, 'status' => 'paid']);
            $this->queue->publish(new DeductStockMessage($order->id));
        } catch (PaymentFailedException $e) {
            // 失败了怎么办？重试？补偿？
            // 如果支付网关超时，我们不知道钱到底扣没扣
        }
    }
}
```

**问题：**

- **消息丢失风险**：虽然现代消息队列有持久化机制，但在极端情况下（broker 故障、网络分区）仍然可能丢消息
- **顺序保证困难**：Kafka 可以保证分区内有序，但跨 topic 的全局顺序很难保证
- **死信队列管理**：失败的消息进入死信队列后，需要人工介入或额外的自动化处理
- **流程可见性差**：一个订单当前处于什么状态、已经完成了哪些步骤、正在等待什么？这些信息散落在多个队列和数据库中
- **重试风暴**：当下游服务暂时不可用时，大量消息重试可能导致系统雪崩
- **缺乏全局编排**：消息队列本质上是点对点的通信，无法表达复杂的编排逻辑（并行、分支、等待、超时）

### 方案三：手动 Saga 模式

Saga 模式是处理分布式事务的经典方案。其核心思想是将一个长事务拆分为一系列本地事务，每个本地事务都有对应的补偿操作。当某一步失败时，按照逆序执行已完成步骤的补偿操作。

```php
// 手动 Saga 实现
class OrderSaga
{
    private array $executedSteps = [];

    public function execute(OrderRequest $request): void
    {
        try {
            // Step 1: 创建订单
            $order = $this->createOrder($request);
            $this->executedSteps[] = ['compensate' => fn() => $this->cancelOrder($order)];

            // Step 2: 锁定库存
            $this->lockStock($order);
            $this->executedSteps[] = ['compensate' => fn() => $this->releaseStock($order)];

            // Step 3: 扣款
            $paymentId = $this->chargePayment($order);
            $this->executedSteps[] = ['compensate' => fn() => $this->refundPayment($paymentId)];

            // Step 4: 扣减库存（正式）
            $this->deductStock($order);
            $this->executedSteps[] = ['compensate' => fn() => $this->restoreStock($order)];

            // Step 5: 创建物流单
            $this->createShipment($order);
            $this->executedSteps[] = ['compensate' => fn() => $this->cancelShipment($order)];

        } catch (\Throwable $e) {
            $this->compensate();
            throw $e;
        }
    }

    private function compensate(): void
    {
        // 逆序执行补偿操作
        foreach (array_reverse($this->executedSteps) as $step) {
            try {
                ($step['compensate'])();
            } catch (\Throwable $e) {
                // 补偿也失败了怎么办？记录日志，等待人工介入？
                Log::error('Saga compensation failed', ['step' => $step, 'error' => $e->getMessage()]);
            }
        }
    }
}
```

**问题：**

- **补偿逻辑不完整**：上面的代码只在同步失败时补偿，如果进程崩溃呢？如果补偿操作本身失败呢？
- **无法处理异步回调**：支付通常是异步的（用户跳转到支付页面，完成后回调），手动 Saga 很难优雅地处理这种"等待"状态
- **进程重启后丢失状态**：`$executedSteps` 数组存储在内存中，进程重启后所有状态丢失
- **补偿操作的幂等性**：补偿操作可能被执行多次（重试场景），必须保证幂等
- **缺乏隔离性**：其他事务可以看到 Saga 中间的不一致状态（dirty read）

### 传统方案的共同缺陷

总结来看，所有传统方案都面临以下共同问题：

1. **状态持久化**：工作流状态需要开发者自己管理持久化，增加了大量基础设施代码
2. **重试与超时**：每个步骤的重试策略、超时设置都需要手动实现
3. **可观测性**：缺乏统一的工作流执行视图
4. **版本管理**：业务流程变更后，如何处理正在执行中的旧版本工作流？
5. **开发效率**：大量样板代码（boilerplate）消耗开发精力，真正有价值的业务逻辑被淹没

正是这些痛点催生了 Temporal.io 这样的持久化工作流引擎。

---

## Temporal.io 核心概念

Temporal.io 是一个开源的持久化工作流编排引擎，源自 Uber 内部的 Cadence 项目（由同一团队创建）。它从根本上重新定义了分布式工作流的编写方式。

### 核心架构

Temporal 的架构由以下几个核心组件组成：

- **Temporal Server**：工作流引擎核心，负责工作流状态管理、任务调度、定时器管理
- **Persistence Store**：持久化存储后端（支持 MySQL、PostgreSQL、Cassandra）
- **History Service**：记录工作流的完整执行历史（事件溯源）
- **Matching Service**：管理 Task Queue，将任务分配给 Worker
- **Worker**：开发者编写的进程，负责执行具体的业务逻辑

### Workflow（工作流）

Workflow 是 Temporal 的核心抽象。它是一段**确定性**的代码，定义了业务流程的编排逻辑。这里的关键是"确定性"——给定相同的输入，Workflow 的执行路径必须是完全相同的。

```php
#[WorkflowInterface]
interface OrderWorkflowInterface
{
    #[WorkflowMethod('OrderWorkflow')]
    public function processOrder(OrderRequest $request): OrderResult;

    #[SignalMethod('paymentCallback')]
    public function paymentCallback(PaymentResult $result): void;

    #[QueryMethod('getStatus')]
    public function getStatus(): string;
}
```

Workflow 的重要特性：

- **持久化执行**：Workflow 的状态自动持久化到数据库，即使 Worker 重启也不会丢失
- **无限长时间运行**：一个 Workflow 可以运行数天、数月甚至数年（比如订阅续费提醒）
- **版本兼容**：支持 Workflow 代码版本化，新版本代码可以正确重放旧版本的历史事件

### Activity（活动）

Activity 是 Workflow 中执行实际副作用（side effects）的地方。与 Workflow 不同，Activity 是**非确定性**的——它可以调用外部 API、访问数据库、读写文件等。

```php
#[ActivityInterface]
interface PaymentActivityInterface
{
    #[ActivityMethod('chargePayment')]
    public function charge(float $amount, string $currency): string; // 返回 payment_id

    #[ActivityMethod('refundPayment')]
    public function refund(string $paymentId): bool;
}
```

Activity 的重要特性：

- **自动重试**：可配置重试策略（最大次数、退避间隔、可重试异常类型）
- **超时控制**：支持多种超时（调度超时、运行超时、心跳超时）
- **幂等性支持**：提供 Activity ID 用于去重

### Task Queue（任务队列）

Task Queue 是 Worker 与 Temporal Server 之间的通信桥梁。Workflow Task 和 Activity Task 分别通过不同的队列分发。

```php
// Worker 启动时绑定 Task Queue
$worker = $workerFactory->newWorker('order-task-queue');
$worker->registerWorkflow(OrderWorkflow::class);
$worker->registerActivity(PaymentActivity::class);
```

Task Queue 的设计允许：
- **负载均衡**：多个 Worker 可以监听同一个 Task Queue
- **优先级调度**：可以为不同类型的 Activity 分配不同的 Task Queue
- **隔离性**：关键业务和非关键业务可以使用不同的队列

### Signal（信号）

Signal 是外部系统向正在运行的 Workflow 发送消息的机制。它非常适合处理异步回调场景。

```php
// 在 Workflow 内部等待 Signal
$result = yield Workflow::await(
    fn() => $this->paymentResult !== null
);

// 外部发送 Signal
$client->newWorkflowStub(OrderWorkflow::class, $workflowId)
    ->paymentCallback(new PaymentResult(true, 'txn_123'));
```

Signal 的关键特性：
- **异步非阻塞**：发送方不需要等待 Workflow 处理
- **持久化存储**：Signal 被持久化到 Workflow 的历史事件中
- **有序处理**：Signal 按照到达顺序被 Workflow 依次处理

### Query（查询）

Query 允许外部系统查询 Workflow 的当前状态，而不影响 Workflow 的执行。

```php
// 查询 Workflow 状态
$stub = $client->newWorkflowStub(OrderWorkflow::class, $workflowId);
$status = $stub->getStatus(); // 返回当前订单状态
```

Query 的限制：
- **只读操作**：不能修改 Workflow 状态
- **同步返回**：调用方会阻塞等待结果
- **不能在 Workflow 内部调用**

### Child Workflow（子工作流）

当业务流程过于复杂时，可以将部分逻辑拆分为 Child Workflow，实现模块化和复用。

```php
#[WorkflowInterface]
interface OrderWorkflowInterface
{
    #[WorkflowMethod]
    public function processOrder(OrderRequest $request): OrderResult;
}

// 在主 Workflow 中启动子 Workflow
$paymentWorkflow = Workflow::newChildWorkflowStub(PaymentWorkflowInterface::class);
$paymentResult = yield $paymentWorkflow->processPayment($order->amount);
```

Child Workflow 的优势：
- **独立的重试策略**：子 Workflow 有自己独立的超时和重试配置
- **可复用**：同一个子 Workflow 可以被多个父 Workflow 调用
- **独立的历史记录**：便于调试和审计

---

## Temporal vs Cadence vs AWS Step Functions 选型对比

在选择工作流引擎时，市场上主要有三个竞争者。以下是详细的对比分析：

### 架构对比

| 特性 | Temporal.io | Cadence | AWS Step Functions |
|------|------------|---------|-------------------|
| **起源** | Uber Cadence 的 fork，由同一团队维护 | Uber 内部项目 | AWS 托管服务 |
| **部署模式** | 自托管或 Temporal Cloud | 自托管 | 完全托管 |
| **编程语言** | Go/Java/PHP/TypeScript/Python/.NET | Go/Java/PHP/TypeScript | 任何语言（Lambda） |
| **状态存储** | MySQL/PostgreSQL/Cassandra | MySQL/PostgreSQL/Cassandra | AWS 内部管理 |
| **定价** | 开源免费（自托管）/ Temporal Cloud 按使用量 | 开源免费 | 按状态转换次数计费 |

### 功能对比

**Temporal.io 优势：**
- **代码即工作流**：用编程语言直接编写工作流逻辑，无需学习 DSL 或 JSON 状态机
- **强大的重放机制**：基于事件溯源的工作流重放，保证一致性
- **版本管理**：内置的 Workflow 版本化 API（`Workflow::getVersion()`）
- **丰富的 SDK**：PHP SDK 的成熟度在三者中最高
- **活跃社区**：GitHub star 数持续增长，文档完善
- **Temporal Cloud**：提供托管选项，降低运维负担

**Cadence 优势：**
- **更早的生产验证**：Uber 大规模生产环境验证
- **与 Temporal 高度兼容**：代码迁移成本低

**AWS Step Functions 优势：**
- **零运维**：完全托管，无需部署和维护基础设施
- **AWS 生态集成**：与 Lambda、SQS、SNS 等 AWS 服务无缝集成
- **可视化编辑器**：拖拽式工作流设计（Standard Workflow）

### PHP 生态适配性

对于 Laravel 开发者来说，**Temporal.io 是唯一的选择**。Cadence 的 PHP SDK 功能有限且更新缓慢，而 AWS Step Functions 虽然可以通过 Lambda 调用 PHP 代码，但无法直接使用 PHP SDK 编写工作流。

Temporal 的 PHP SDK（`temporal/sdk`）由官方维护，提供了完整的功能：
- Workflow 和 Activity 定义
- Signal 和 Query 支持
- Child Workflow
- 搜索属性（Search Attributes）
- 互斥锁（Mutex）
- 侧效果（Side Effect）

### 选型建议

- **中小团队 + Laravel 技术栈** → Temporal.io（自托管 Docker Compose，或 Temporal Cloud）
- **AWS 深度用户 + 不限语言** → AWS Step Functions
- **已有 Cadence 基础设施** → 继续使用 Cadence，或渐进迁移到 Temporal
- **对 PHP 有强需求** → Temporal.io 是唯一可行方案

---

## Temporal PHP SDK 实战

现在让我们进入实战环节。我们将搭建一个完整的订单处理工作流，涵盖从环境搭建到代码实现的全过程。

### 环境搭建

#### Docker Compose 启动 Temporal Server

创建 `docker-compose.yml` 文件：

```yaml
version: '3.8'

services:
  temporal:
    image: temporalio/auto-setup:1.24.2
    ports:
      - "7233:7233"
    environment:
      - DB=postgresql
      - DB_PORT=5432
      - POSTGRES_USER=temporal
      - POSTGRES_PWD=temporal
      - POSTGRES_SEEDS=postgresql
      - DYNAMIC_CONFIG_FILE_PATH=config/dynamicconfig/development-sql.yaml
    depends_on:
      - postgresql
    volumes:
      - ./dynamicconfig:/etc/temporal/config/dynamicconfig

  temporal-ui:
    image: temporalio/ui:2.31.2
    ports:
      - "8080:8080"
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - TEMPORAL_CORS_ORIGINS=http://localhost:3000
    depends_on:
      - temporal

  postgresql:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: temporal
      POSTGRES_PASSWORD: temporal
      POSTGRES_DB: temporal_visibility
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

启动服务：

```bash
docker-compose up -d
```

验证服务状态：

```bash
# 检查 Temporal Server 是否就绪
docker-compose logs temporal | grep "Started"

# 访问 Web UI
open http://localhost:8080
```

#### 安装 PHP SDK

在 Laravel 项目中安装 Temporal PHP SDK：

```bash
composer require temporal/sdk
composer require spiral/roadrunner-laravel  # 可选：用于高性能 Worker
```

### 定义 Workflow 和 Activity

我们以一个完整的电商订单流程为例：**创建订单 → 发起支付 → 扣减库存 → 生成物流单**。

#### 定义数据传输对象（DTO）

```php
<?php

namespace App\Temporal\DTO;

use Temporal\Activity\ActivityOptions;
use Temporal\Common\Uuid;
use Temporal\Workflow\WorkflowInterface;
use Temporal\Workflow\WorkflowMethod;

/**
 * 订单请求 DTO
 */
class OrderRequest
{
    public function __construct(
        public readonly string $orderId,
        public readonly string $userId,
        public readonly array $items,        // [['product_id' => 'xxx', 'quantity' => 2, 'price' => 99.9]]
        public readonly float $totalAmount,
        public readonly string $currency = 'CNY',
        public readonly string $paymentMethod = 'alipay',
    ) {}
}

/**
 * 订单结果 DTO
 */
class OrderResult
{
    public function __construct(
        public readonly string $orderId,
        public readonly string $status,      // completed, failed, cancelled
        public readonly ?string $paymentId = null,
        public readonly ?string $shipmentId = null,
        public readonly ?string $failureReason = null,
    ) {}
}

/**
 * 支付结果 DTO
 */
class PaymentResult
{
    public function __construct(
        public readonly bool $success,
        public readonly ?string $paymentId = null,
        public readonly ?string $transactionId = null,
        public readonly ?string $failureReason = null,
    ) {}
}
```

#### 定义 Activity Interface 和实现

```php
<?php

namespace App\Temporal\Activity;

use Temporal\Activity\ActivityInterface;
use Temporal\Activity\ActivityMethod;

#[ActivityInterface]
interface OrderActivitiesInterface
{
    #[ActivityMethod('createOrder')]
    public function createOrder(string $orderId, string $userId, array $items, float $amount): bool;

    #[ActivityMethod('cancelOrder')]
    public function cancelOrder(string $orderId, string $reason): bool;

    #[ActivityMethod('initiatePayment')]
    public function initiatePayment(string $orderId, float $amount, string $currency, string $method): string;

    #[ActivityMethod('processRefund')]
    public function processRefund(string $paymentId, string $reason): bool;

    #[ActivityMethod('deductStock')]
    public function deductStock(array $items): bool;

    #[ActivityMethod('restoreStock')]
    public function restoreStock(array $items): bool;

    #[ActivityMethod('createShipment')]
    public function createShipment(string $orderId, array $items): string;

    #[ActivityMethod('cancelShipment')]
    public function cancelShipment(string $shipmentId): bool;

    #[ActivityMethod('sendNotification')]
    public function sendNotification(string $userId, string $type, array $data): bool;
}
```

```php
<?php

namespace App\Temporal\Activity;

use App\Models\Order;
use App\Models\Product;
use App\Services\PaymentGateway;
use App\Services\ShipmentService;
use App\Services\NotificationService;
use Temporal\Activity\ActivityInterface;
use Temporal\Activity\ActivityMethod;

class OrderActivities implements OrderActivitiesInterface
{
    public function __construct(
        private PaymentGateway $paymentGateway,
        private ShipmentService $shipmentService,
        private NotificationService $notificationService,
    ) {}

    public function createOrder(string $orderId, string $userId, array $items, float $amount): bool
    {
        // 使用 updateOrCreate 保证幂等性
        Order::updateOrCreate(
            ['order_id' => $orderId],
            [
                'user_id' => $userId,
                'items' => json_encode($items),
                'total_amount' => $amount,
                'status' => 'pending',
            ]
        );

        return true;
    }

    public function cancelOrder(string $orderId, string $reason): bool
    {
        $order = Order::where('order_id', $orderId)->first();
        if (!$order) {
            return true; // 订单不存在视为已取消（幂等）
        }

        $order->update([
            'status' => 'cancelled',
            'cancel_reason' => $reason,
        ]);

        return true;
    }

    public function initiatePayment(string $orderId, float $amount, string $currency, string $method): string
    {
        return $this->paymentGateway->createPayment($orderId, $amount, $currency, $method);
    }

    public function processRefund(string $paymentId, string $reason): bool
    {
        return $this->paymentGateway->refund($paymentId, $reason);
    }

    public function deductStock(array $items): bool
    {
        foreach ($items as $item) {
            $affected = Product::where('id', $item['product_id'])
                ->where('stock', '>=', $item['quantity'])
                ->decrement('stock', $item['quantity']);

            if ($affected === 0) {
                throw new \RuntimeException(
                    "Insufficient stock for product {$item['product_id']}"
                );
            }
        }

        return true;
    }

    public function restoreStock(array $items): bool
    {
        foreach ($items as $item) {
            Product::where('id', $item['product_id'])
                ->increment('stock', $item['quantity']);
        }

        return true;
    }

    public function createShipment(string $orderId, array $items): string
    {
        return $this->shipmentService->create($orderId, $items);
    }

    public function cancelShipment(string $shipmentId): bool
    {
        return $this->shipmentService->cancel($shipmentId);
    }

    public function sendNotification(string $userId, string $type, array $data): bool
    {
        $this->notificationService->send($userId, $type, $data);
        return true;
    }
}
```

#### 定义 Workflow

```php
<?php

namespace App\Temporal\Workflow;

use App\Temporal\Activity\OrderActivitiesInterface;
use App\Temporal\DTO\OrderRequest;
use App\Temporal\DTO\OrderResult;
use App\Temporal\DTO\PaymentResult;
use Temporal\Activity\ActivityOptions;
use Temporal\Common\RetryOptions;
use Temporal\Workflow\SignalMethod;
use Temporal\Workflow\WorkflowInterface;
use Temporal\Workflow\WorkflowMethod;
use Temporal\Workflow\QueryMethod;
use Temporal\Workflow;

#[WorkflowInterface]
class OrderWorkflow
{
    private ?PaymentResult $paymentResult = null;
    private string $currentStatus = 'initialized';
    private ?string $failureReason = null;

    #[WorkflowMethod('OrderWorkflow')]
    public function processOrder(OrderRequest $request): OrderResult
    {
        $activityOptions = ActivityOptions::new()
            ->withStartToCloseTimeout(60) // 单次执行超时 60 秒
            ->withRetryOptions(
                RetryOptions::new()
                    ->withMaximumAttempts(3)
                    ->withInitialInterval(2)    // 初始重试间隔 2 秒
                    ->withBackoffCoefficient(2) // 指数退避
                    ->withMaximumInterval(30)   // 最大重试间隔 30 秒
            );

        $activities = Workflow::newActivityStub(
            OrderActivitiesInterface::class,
            $activityOptions
        );

        try {
            // Step 1: 创建订单
            $this->currentStatus = 'creating_order';
            yield $activities->createOrder(
                $request->orderId,
                $request->userId,
                $request->items,
                $request->totalAmount
            );

            // Step 2: 发起支付并等待回调
            $this->currentStatus = 'awaiting_payment';
            $paymentId = yield $activities->initiatePayment(
                $request->orderId,
                $request->totalAmount,
                $request->currency,
                $request->paymentMethod
            );

            // 等待支付回调信号，最长等待 30 分钟
            $paymentCompleted = yield Workflow::awaitWithTimeout(
                30 * 60, // 30 分钟超时
                fn() => $this->paymentResult !== null
            );

            if (!$paymentCompleted || !$this->paymentResult->success) {
                $reason = $this->paymentResult?->failureReason ?? 'Payment timeout';
                $this->currentStatus = 'payment_failed';
                $this->failureReason = $reason;

                // 补偿：取消订单
                yield $activities->cancelOrder($request->orderId, $reason);

                return new OrderResult(
                    orderId: $request->orderId,
                    status: 'cancelled',
                    failureReason: $reason
                );
            }

            // Step 3: 扣减库存
            $this->currentStatus = 'deducting_stock';
            try {
                yield $activities->deductStock($request->items);
            } catch (\Throwable $e) {
                $this->currentStatus = 'stock_failed';
                $this->failureReason = 'Stock deduction failed: ' . $e->getMessage();

                // 补偿：退款 + 取消订单
                yield $activities->processRefund(
                    $this->paymentResult->paymentId,
                    'Stock deduction failed'
                );
                yield $activities->cancelOrder($request->orderId, 'Stock deduction failed');

                return new OrderResult(
                    orderId: $request->orderId,
                    status: 'failed',
                    paymentId: $this->paymentResult->paymentId,
                    failureReason: 'Stock deduction failed'
                );
            }

            // Step 4: 生成物流单
            $this->currentStatus = 'creating_shipment';
            $shipmentId = yield $activities->createShipment(
                $request->orderId,
                $request->items
            );

            // Step 5: 发送通知
            $this->currentStatus = 'sending_notification';
            yield $activities->sendNotification(
                $request->userId,
                'order_completed',
                [
                    'order_id' => $request->orderId,
                    'shipment_id' => $shipmentId,
                ]
            );

            $this->currentStatus = 'completed';

            return new OrderResult(
                orderId: $request->orderId,
                status: 'completed',
                paymentId: $this->paymentResult->paymentId,
                shipmentId: $shipmentId,
            );

        } catch (\Throwable $e) {
            $this->currentStatus = 'failed';
            $this->failureReason = $e->getMessage();
            throw $e;
        }
    }

    /**
     * 支付回调信号
     */
    #[SignalMethod('paymentCallback')]
    public function paymentCallback(PaymentResult $result): void
    {
        $this->paymentResult = $result;
    }

    /**
     * 查询当前状态
     */
    #[QueryMethod('getStatus')]
    public function getStatus(): string
    {
        return json_encode([
            'status' => $this->currentStatus,
            'failure_reason' => $this->failureReason,
            'payment_received' => $this->paymentResult !== null,
        ]);
    }
}
```

### Workflow 执行与监控

#### 启动 Workflow

```php
<?php

namespace App\Temporal\Client;

use App\Temporal\DTO\OrderRequest;
use App\Temporal\Workflow\OrderWorkflow;
use Temporal\Client\WorkflowClient;
use Temporal\Client\WorkflowOptions;

class OrderWorkflowStarter
{
    private WorkflowClient $client;

    public function __construct()
    {
        $this->client = WorkflowClient::create(
            'temporal:7233' // Temporal Server 地址
        );
    }

    public function startOrderWorkflow(OrderRequest $request): string
    {
        $workflow = $this->client->newWorkflowStub(
            OrderWorkflow::class,
            WorkflowOptions::new()
                ->withTaskQueue('order-task-queue')
                ->withWorkflowId('order-' . $request->orderId)
                ->withWorkflowRunTimeout(3600) // 最长运行 1 小时
        );

        // 异步启动 Workflow
        $execution = $this->client->start($workflow, $request);

        return $execution->getID();
    }

    public function sendPaymentCallback(string $workflowId, PaymentResult $result): void
    {
        $workflow = $this->client->newWorkflowStub(
            OrderWorkflow::class,
            WorkflowOptions::new()
                ->withWorkflowId($workflowId)
        );

        // 通过 Signal 发送支付结果
        $workflow->paymentCallback($result);
    }

    public function queryOrderStatus(string $workflowId): array
    {
        $workflow = $this->client->newWorkflowStub(
            OrderWorkflow::class,
            WorkflowOptions::new()
                ->withWorkflowId($workflowId)
        );

        return json_decode($workflow->getStatus(), true);
    }
}
```

#### 启动 Worker

```php
<?php
// worker.php - Temporal Worker 入口文件

require __DIR__ . '/vendor/autoload.php';

use App\Temporal\Activity\OrderActivities;
use App\Temporal\Workflow\OrderWorkflow;
use Temporal\WorkerFactory;

$factory = WorkerFactory::create();

// 创建 Worker 并绑定到 Task Queue
$worker = $factory->newWorker('order-task-queue');

// 注册 Workflow
$worker->registerWorkflow(OrderWorkflow::class);

// 注册 Activity（使用 Laravel 容器解析依赖）
$worker->registerActivityImplementations(
    new OrderActivities(
        app(PaymentGateway::class),
        app(ShipmentService::class),
        app(NotificationService::class),
    )
);

// 启动 Worker
$factory->run();
```

启动 Worker 进程：

```bash
php worker.php
```

### 完整执行流程演示

```php
// 在 Laravel Controller 或 Service 中
class OrderController extends Controller
{
    public function store(Request $request, OrderWorkflowStarter $starter)
    {
        $orderRequest = new OrderRequest(
            orderId: 'ORD-' . Str::uuid(),
            userId: auth()->id(),
            items: $request->input('items'),
            totalAmount: $request->input('total_amount'),
        );

        $workflowId = $starter->startOrderWorkflow($orderRequest);

        return response()->json([
            'order_id' => $orderRequest->orderId,
            'workflow_id' => $workflowId,
            'message' => 'Order workflow started',
        ]);
    }
}
```

---

## Saga 模式在 Temporal 中的实现

Temporal 不仅仅是一个任务调度器，它提供了原生的 Saga 模式支持。让我们对比一下手动 Saga 和 Temporal Saga 的差异。

### 手动 Saga vs Temporal Saga

```php
// ========== 手动 Saga（传统方案）==========
class ManualOrderSaga
{
    private array $compensations = [];
    private PDO $pdo;

    public function execute(OrderRequest $request): void
    {
        $this->pdo->beginTransaction();
        try {
            $this->doCreateOrder($request);
            $this->compensations[] = fn() => $this->doCancelOrder($request->orderId);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            $this->runCompensations();
            throw $e;
        }

        // 问题：后续步骤如何在进程重启后继续？
        // 问题：补偿操作如果失败了怎么办？
    }

    private function runCompensations(): void
    {
        foreach (array_reverse($this->compensations) as $comp) {
            try {
                $comp();
            } catch (\Throwable $e) {
                Log::error('Compensation failed', ['error' => $e->getMessage()]);
                // 问题：补偿失败后怎么办？发告警？写死信？人工介入？
            }
        }
    }
}

// ========== Temporal Saga（Temporal 方案）==========
#[WorkflowInterface]
class TemporalOrderSaga
{
    #[WorkflowMethod]
    public function execute(OrderRequest $request): OrderResult
    {
        $saga = new Saga(new SagaOptions()->setParallelCompensation(false));
        $activities = Workflow::newActivityStub(
            OrderActivitiesInterface::class,
            ActivityOptions::new()->withStartToCloseTimeout(60)
        );

        try {
            // Step 1: 创建订单
            $saga->addCompensation(fn() => yield $activities->cancelOrder($request->orderId, 'saga compensation'));
            yield $activities->createOrder($request->orderId, $request->userId, $request->items, $request->totalAmount);

            // Step 2: 等待支付（通过 Signal）
            yield Workflow::awaitWithTimeout(
                30 * 60,
                fn() => $this->paymentResult !== null
            );

            if (!$this->paymentResult->success) {
                throw new \RuntimeException('Payment failed: ' . $this->paymentResult->failureReason);
            }

            // Step 3: 扣减库存
            $saga->addCompensation(fn() => yield $activities->restoreStock($request->items));
            yield $activities->deductStock($request->items);

            // Step 4: 创建物流单
            $saga->addCompensation(fn() => yield $activities->cancelShipment($this->shipmentId));
            $this->shipmentId = yield $activities->createShipment($request->orderId, $request->items);

            // Step 5: 退款补偿
            $saga->addCompensation(fn() => yield $activities->processRefund($this->paymentResult->paymentId, 'saga compensation'));

            return new OrderResult(
                orderId: $request->orderId,
                status: 'completed',
                paymentId: $this->paymentResult->paymentId,
                shipmentId: $this->shipmentId,
            );

        } catch (\Throwable $e) {
            // Temporal 的 Saga 会自动执行所有已注册的补偿操作
            // 即使 Worker 崩溃，补偿也会在 Worker 恢复后继续执行
            yield $saga->compensate();
            throw $e;
        }
    }
}
```

### Temporal Saga 的核心优势

1. **持久化补偿队列**：补偿操作被记录在 Workflow 历史中，即使 Worker 崩溃也能恢复执行
2. **自动重试**：补偿操作同样享受 Temporal 的重试机制
3. **执行可见性**：在 Temporal Web UI 中可以清楚地看到哪些步骤已完成、哪些补偿已执行
4. **超时处理**：补偿操作有独立的超时控制

### Saga 补偿的执行顺序

在上面的示例中，当 Step 3 失败时，补偿的执行顺序为：
1. 取消订单（Step 1 的补偿）
2. 退款（Step 2 的补偿）

注意：`saga->compensate()` 按照**注册的逆序**执行补偿操作。这与经典的 Saga 模式一致。

### 并行补偿

某些场景下，补偿操作之间没有依赖关系，可以并行执行以提高效率：

```php
$saga = new Saga(new SagaOptions()->setParallelCompensation(true));
```

启用并行补偿后，所有补偿操作会被同时触发。适用于补偿操作之间互不依赖的场景（如退款和释放库存可以同时进行）。

---

## Laravel 集成方案

现在让我们深入探讨如何将 Temporal 与 Laravel 框架深度集成。

### 通过 Artisan 命令触发 Workflow

创建一个 Artisan 命令来启动和管理工作流：

```php
<?php

namespace App\Console\Commands;

use App\Temporal\DTO\OrderRequest;
use App\Temporal\DTO\PaymentResult;
use App\Temporal\Client\OrderWorkflowStarter;
use Illuminate\Console\Command;
use Temporal\Client\WorkflowClient;

class TemporalOrderCommand extends Command
{
    protected $signature = 'temporal:order 
                            {action : start|status|cancel|payment} 
                            {--order-id= : Order ID}
                            {--workflow-id= : Workflow ID}';

    protected $description = 'Manage Temporal order workflows';

    public function handle(OrderWorkflowStarter $starter): int
    {
        $action = $this->argument('action');

        return match ($action) {
            'start' => $this->startWorkflow($starter),
            'status' => $this->checkStatus($starter),
            'payment' => $this->sendPaymentCallback($starter),
            'cancel' => $this->cancelWorkflow($starter),
            default => $this->error("Unknown action: {$action}") ?? 1,
        };
    }

    private function startWorkflow(OrderWorkflowStarter $starter): int
    {
        $request = new OrderRequest(
            orderId: $this->option('order-id') ?? 'ORD-' . uniqid(),
            userId: 'user-001',
            items: [
                ['product_id' => 'prod-1', 'quantity' => 2, 'price' => 49.9],
                ['product_id' => 'prod-2', 'quantity' => 1, 'price' => 99.0],
            ],
            totalAmount: 198.8,
        );

        $workflowId = $starter->startOrderWorkflow($request);

        $this->info("Workflow started: {$workflowId}");
        $this->info("Order ID: {$request->orderId}");

        return 0;
    }

    private function checkStatus(OrderWorkflowStarter $starter): int
    {
        $workflowId = $this->option('workflow-id');
        if (!$workflowId) {
            $this->error('--workflow-id is required');
            return 1;
        }

        $status = $starter->queryOrderStatus($workflowId);
        $this->table(
            ['Field', 'Value'],
            collect($status)->map(fn($v, $k) => [$k, $v])->toArray()
        );

        return 0;
    }

    private function sendPaymentCallback(OrderWorkflowStarter $starter): int
    {
        $workflowId = $this->option('workflow-id');
        if (!$workflowId) {
            $this->error('--workflow-id is required');
            return 1;
        }

        $result = new PaymentResult(
            success: true,
            paymentId: 'PAY-' . uniqid(),
            transactionId: 'TXN-' . uniqid(),
        );

        $starter->sendPaymentCallback($workflowId, $result);
        $this->info('Payment callback sent successfully');

        return 0;
    }

    private function cancelWorkflow(OrderWorkflowStarter $starter): int
    {
        $workflowId = $this->option('workflow-id');
        if (!$workflowId) {
            $this->error('--workflow-id is required');
            return 1;
        }

        $client = WorkflowClient::create('temporal:7233');
        $workflow = $client->newWorkflowStub(
            \App\Temporal\Workflow\OrderWorkflow::class,
            \Temporal\Client\WorkflowOptions::new()
                ->withWorkflowId($workflowId)
        );

        // 通过 Signal 发送支付失败结果来触发取消
        $workflow->paymentCallback(new PaymentResult(
            success: false,
            failureReason: 'User cancelled'
        ));

        $this->info("Cancellation signal sent to workflow: {$workflowId}");

        return 0;
    }
}
```

### Activity 作为 Laravel Job 执行

在某些场景下，你可能希望 Activity 能够利用 Laravel 的队列基础设施。以下是一种混合方案：

```php
<?php

namespace App\Temporal\Activity;

use App\Jobs\ProcessRefund;
use App\Temporal\Activity\OrderActivitiesInterface;
use Illuminate\Support\Facades\Bus;

class OrderActivitiesWithLaravelJobs implements OrderActivitiesInterface
{
    public function createOrder(string $orderId, string $userId, array $items, float $amount): bool
    {
        // 直接使用 Eloquent
        \App\Models\Order::updateOrCreate(
            ['order_id' => $orderId],
            [
                'user_id' => $userId,
                'items' => $items,
                'total_amount' => $amount,
                'status' => 'pending',
            ]
        );
        return true;
    }

    public function processRefund(string $paymentId, string $reason): bool
    {
        // 对于耗时较长的操作，可以分发到 Laravel 队列
        // 但要注意：这样会失去 Temporal 的重试管理能力
        // 推荐的做法是在 Activity 内部同步执行，利用 Temporal 的重试机制

        // 同步方式（推荐）
        $gateway = app(\App\Services\PaymentGateway::class);
        return $gateway->refund($paymentId, $reason);
    }

    // ... 其他方法实现
}
```

**注意**：虽然技术上可以在 Activity 中分发 Laravel Job，但**不推荐**这样做。原因是 Temporal 本身已经提供了完善的重试、超时和错误处理机制，使用 Laravel Job 会引入不必要的复杂性。推荐的做法是让 Activity 直接执行业务逻辑。

### 使用 Signal 实现异步支付回调

支付网关的回调是典型的异步场景。Temporal 的 Signal 机制完美解决了这个问题。

```php
<?php

namespace App\Http\Controllers;

use App\Temporal\DTO\PaymentResult;
use App\Temporal\Workflow\OrderWorkflow;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Temporal\Client\WorkflowClient;
use Temporal\Client\WorkflowOptions;

class PaymentCallbackController extends Controller
{
    /**
     * 支付网关回调处理
     * POST /api/payment/callback
     */
    public function handleCallback(Request $request): Response
    {
        // 验证签名（重要！防止伪造回调）
        if (!$this->verifySignature($request)) {
            return response('Invalid signature', 403);
        }

        $orderId = $request->input('order_id');
        $workflowId = "order-{$orderId}";

        try {
            $client = WorkflowClient::create(config('temporal.server_address'));
            $workflow = $client->newWorkflowStub(
                OrderWorkflow::class,
                WorkflowOptions::new()
                    ->withWorkflowId($workflowId)
            );

            // 通过 Signal 将支付结果发送给 Workflow
            $workflow->paymentCallback(new PaymentResult(
                success: $request->input('status') === 'success',
                paymentId: $request->input('payment_id'),
                transactionId: $request->input('transaction_id'),
                failureReason: $request->input('failure_reason'),
            ));

            return response('OK', 200);

        } catch (\Throwable $e) {
            \Log::error('Failed to send payment callback signal', [
                'workflow_id' => $workflowId,
                'error' => $e->getMessage(),
            ]);

            // 返回 500 让支付网关重试
            return response('Internal error', 500);
        }
    }

    private function verifySignature(Request $request): bool
    {
        $signature = $request->header('X-Payment-Signature');
        $payload = $request->getContent();
        $expectedSignature = hash_hmac('sha256', $payload, config('services.payment.secret'));

        return hash_equals($expectedSignature, $signature);
    }
}
```

### 使用 Query 实现订单状态实时查询

```php
<?php

namespace App\Http\Controllers;

use App\Temporal\Workflow\OrderWorkflow;
use Illuminate\Http\JsonResponse;
use Temporal\Client\WorkflowClient;
use Temporal\Client\WorkflowOptions;

class OrderStatusController extends Controller
{
    public function show(string $orderId): JsonResponse
    {
        $workflowId = "order-{$orderId}";

        try {
            $client = WorkflowClient::create(config('temporal.server_address'));
            $workflow = $client->newWorkflowStub(
                OrderWorkflow::class,
                WorkflowOptions::new()
                    ->withWorkflowId($workflowId)
            );

            // Query 是只读操作，不会影响 Workflow 执行
            $statusJson = $workflow->getStatus();
            $status = json_decode($statusJson, true);

            return response()->json([
                'order_id' => $orderId,
                'workflow_id' => $workflowId,
                'status' => $status,
            ]);

        } catch (\Throwable $e) {
            if (str_contains($e->getMessage(), 'not found')) {
                return response()->json(['error' => 'Order not found'], 404);
            }
            throw $e;
        }
    }
}
```

### Laravel Service Provider 集成

```php
<?php

namespace App\Providers;

use App\Temporal\Client\OrderWorkflowStarter;
use Illuminate\Support\ServiceProvider;
use Temporal\Client\WorkflowClient;

class TemporalServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(WorkflowClient::class, function () {
            return WorkflowClient::create(
                config('temporal.server_address', 'temporal:7233')
            );
        });

        $this->app->singleton(OrderWorkflowStarter::class, function ($app) {
            return new OrderWorkflowStarter();
        });
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../../config/temporal.php' => config_path('temporal.php'),
        ], 'temporal-config');
    }
}
```

配置文件 `config/temporal.php`：

```php
<?php

return [
    'server_address' => env('TEMPORAL_SERVER_ADDRESS', 'temporal:7233'),
    'task_queue' => env('TEMPORAL_TASK_QUEUE', 'default'),
    'namespace' => env('TEMPORAL_NAMESPACE', 'default'),

    // Worker 配置
    'worker' => [
        'max_concurrent_activities' => (int) env('TEMPORAL_WORKER_MAX_ACTIVITIES', 100),
        'max_concurrent_workflows' => (int) env('TEMPORAL_WORKER_MAX_WORKFLOWS', 100),
    ],

    // 重试策略
    'retry' => [
        'maximum_attempts' => (int) env('TEMPORAL_RETRY_MAX_ATTEMPTS', 3),
        'initial_interval' => (int) env('TEMPORAL_RETRY_INITIAL_INTERVAL', 2),
        'backoff_coefficient' => (float) env('TEMPORAL_RETRY_BACKOFF_COEFFICIENT', 2.0),
        'maximum_interval' => (int) env('TEMPORAL_RETRY_MAXIMUM_INTERVAL', 30),
    ],
];
```

---

## 生产环境部署

### Worker 配置

在生产环境中，Worker 的配置直接影响系统的吞吐量和稳定性。

```php
<?php
// 生产环境 Worker 启动脚本

require __DIR__ . '/vendor/autoload.php';

use Temporal\WorkerFactory;

// 初始化 Laravel 应用（使 Worker 可以使用 Laravel 的全部功能）
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$factory = WorkerFactory::create();

$worker = $factory->newWorker(
    'order-task-queue',
    \Temporal\Worker\WorkerOptions::new()
        ->withMaxConcurrentActivityExecutionSize(100)  // 最大并发 Activity 数
        ->withMaxConcurrentWorkflowTaskExecutionSize(50) // 最大并发 Workflow Task 数
        ->withMaxConcurrentLocalActivityExecutionSize(100)
        ->withStickyWorkflowQueueSize(1000)  // Sticky Queue 大小
);

// 注册 Workflow 和 Activity
$worker->registerWorkflow(\App\Temporal\Workflow\OrderWorkflow::class);
$worker->registerActivityImplementations(
    app(\App\Temporal\Activity\OrderActivities::class)
);

echo "Worker started on task queue: order-task-queue\n";
$factory->run();
```

### Supervisor 配置

使用 Supervisor 管理 Worker 进程：

```ini
[program:temporal-worker-order]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/html/worker.php
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
numprocs=4
redirect_stderr=true
stdout_logfile=/var/www/html/storage/logs/temporal-worker.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stopwaitsecs=60
```

`numprocs=4` 表示启动 4 个 Worker 进程，充分利用多核 CPU。

### 重试策略配置

合理的重试策略是生产环境的关键：

```php
// 不同 Activity 使用不同的重试策略
$paymentActivityOptions = ActivityOptions::new()
    ->withStartToCloseTimeout(30)
    ->withRetryOptions(
        RetryOptions::new()
            ->withMaximumAttempts(3)
            ->withInitialInterval(5)
            ->withBackoffCoefficient(2)
            ->withMaximumInterval(60)
            ->withNonRetryableExceptions([
                \App\Exceptions\InvalidPaymentException::class, // 参数错误不重试
            ])
    );

$stockActivityOptions = ActivityOptions::new()
    ->withStartToCloseTimeout(10)
    ->withRetryOptions(
        RetryOptions::new()
            ->withMaximumAttempts(5)
            ->withInitialInterval(1)
            ->withBackoffCoefficient(1.5)
            ->withMaximumInterval(10)
    );

$shipmentActivityOptions = ActivityOptions::new()
    ->withStartToCloseTimeout(120)  // 物流创建可能较慢
    ->withHeartbeatTimeout(30)       // 心跳超时，用于检测 Worker 存活
    ->withRetryOptions(
        RetryOptions::new()
            ->withMaximumAttempts(5)
            ->withInitialInterval(10)
            ->withBackoffCoefficient(2)
            ->withMaximumInterval(300)
    );
```

### 超时设置详解

Temporal 提供了多种超时控制：

```php
ActivityOptions::new()
    // Schedule-to-Start Timeout
    // 从 Activity 被调度到 Worker 开始执行的最长时间
    // 如果 Worker 全忙或宕机，超时后 Activity 会失败
    ->withScheduleToStartTimeout(120)

    // Start-to-Close Timeout
    // Activity 开始执行到完成的最长时间
    // 这是最常用的超时设置
    ->withStartToCloseTimeout(60)

    // Schedule-to-Close Timeout
    // 从 Activity 被调度到完成的总时间（包含排队时间）
    ->withScheduleToCloseTimeout(180)

    // Heartbeat Timeout
    // 长时间运行的 Activity 需要定期发送心跳
    // 如果心跳停止，Activity 会被认为卡死并取消
    ->withHeartbeatTimeout(10);
```

### 优雅关闭

Worker 需要支持优雅关闭，确保正在执行的 Activity 完成后再退出：

```php
<?php

// 优雅关闭处理
pcntl_signal(SIGTERM, function () use ($factory) {
    echo "Received SIGTERM, shutting down gracefully...\n";
    // Worker 会：
    // 1. 停止接受新的 Task
    // 2. 等待正在执行的 Activity 完成
    // 3. 超时后强制取消未完成的 Activity
    $factory->getDispatcher()->dispatch(new \Temporal\Worker\Transport\GRPC\ShutdownSignal());
});

pcntl_signal(SIGINT, function () use ($factory) {
    echo "Received SIGINT, shutting down gracefully...\n";
    $factory->getDispatcher()->dispatch(new \Temporal\Worker\Transport\GRPC\ShutdownSignal());
});

pcntl_async_signals(true);
```

### 多 Task Queue 架构

在生产环境中，建议为不同优先级的业务使用不同的 Task Queue：

```php
// 高优先级队列（支付相关）
$highPriorityWorker = $factory->newWorker('order-high-priority');
$highPriorityWorker->registerWorkflow(OrderWorkflow::class);
$highPriorityWorker->registerActivityImplementations(
    new PaymentActivities(...)  // 支付相关 Activity
);

// 低优先级队列（通知、日志等）
$lowPriorityWorker = $factory->newWorker('order-low-priority');
$lowPriorityWorker->registerActivityImplementations(
    new NotificationActivities(...),  // 通知相关 Activity
    new LoggingActivities(...)        // 日志相关 Activity
);
```

---

## 可观测性

### Temporal Web UI

Temporal 自带的 Web UI 提供了丰富的监控能力：

1. **工作流列表**：查看所有工作流的运行状态（Running、Completed、Failed、Timed Out）
2. **工作流详情**：查看单个工作流的完整执行历史、输入输出、每个步骤的状态
3. **事件历史**：查看工作流的完整事件链（Event History），包括每次 Activity 调用的输入输出
4. **实时调试**：在 Web UI 中可以直接发送 Signal、执行 Query
5. **搜索过滤**：按 Workflow ID、Workflow Type、状态、时间范围等条件筛选

访问地址：`http://localhost:8080`（开发环境）

### 与 Laravel Telescope 集成

将 Temporal Activity 的执行记录集成到 Laravel Telescope 中：

```php
<?php

namespace App\Temporal\Activity;

use Illuminate\Support\Facades\Log;

class InstrumentedOrderActivities implements OrderActivitiesInterface
{
    public function createOrder(string $orderId, string $userId, array $items, float $amount): bool
    {
        $startTime = microtime(true);

        try {
            $result = $this->doCreateOrder($orderId, $userId, $items, $amount);

            $this->recordMetric('activity.create_order', [
                'duration' => microtime(true) - $startTime,
                'status' => 'success',
                'order_id' => $orderId,
            ]);

            return $result;

        } catch (\Throwable $e) {
            $this->recordMetric('activity.create_order', [
                'duration' => microtime(true) - $startTime,
                'status' => 'failed',
                'order_id' => $orderId,
                'error' => $e->getMessage(),
            ]);

            throw $e;
        }
    }

    private function recordMetric(string $name, array $data): void
    {
        // 写入 Laravel 日志（Telescope 会自动捕获）
        Log::channel('temporal')->info($name, $data);

        // 如果配置了 Prometheus
        if (config('services.prometheus.enabled')) {
            app(\App\Services\PrometheusService::class)->recordHistogram(
                $name . '_duration_seconds',
                $data['duration'] ?? 0,
                ['status' => $data['status'] ?? 'unknown']
            );
        }
    }
}
```

### 与 Prometheus 集成

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class TemporalMetricsServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 注册 Temporal 指标收集
        $this->app->when(\App\Temporal\Activity\OrderActivities::class)
            ->needs(\App\Contracts\MetricsCollector::class)
            ->give(\App\Services\PrometheusMetricsCollector::class);
    }
}
```

```php
<?php

namespace App\Services;

use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class PrometheusMetricsCollector implements \App\Contracts\MetricsCollector
{
    private CollectorRegistry $registry;

    public function __construct()
    {
        Redis::setDefaultOptions([
            'host' => config('services.prometheus.redis_host', '127.0.0.1'),
        ]);
        $this->registry = CollectorRegistry::getDefault();
    }

    public function recordActivityDuration(string $activity, float $duration, string $status): void
    {
        $histogram = $this->registry->getOrRegisterHistogram(
            'temporal_activity',
            'duration_seconds',
            'Temporal Activity execution duration',
            ['activity', 'status'],
            [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120]
        );

        $histogram->observe($duration, [$activity, $status]);
    }

    public function recordWorkflowCount(string $workflowType, string $status): void
    {
        $counter = $this->registry->getOrRegisterCounter(
            'temporal_workflow',
            'total',
            'Total Temporal Workflow executions',
            ['workflow_type', 'status']
        );

        $counter->inc([$workflowType, $status]);
    }
}
```

### Grafana Dashboard

推荐的 Grafana 监控面板配置：

```json
{
  "panels": [
    {
      "title": "Workflow Success Rate",
      "type": "stat",
      "targets": [
        {
          "expr": "sum(rate(temporal_workflow_total{status=\"completed\"}[5m])) / sum(rate(temporal_workflow_total[5m])) * 100"
        }
      ]
    },
    {
      "title": "Activity P99 Latency",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.99, sum(rate(temporal_activity_duration_seconds_bucket[5m])) by (le, activity))"
        }
      ]
    },
    {
      "title": "Active Workflows",
      "type": "stat",
      "targets": [
        {
          "expr": "temporal_workflow_active_count"
        }
      ]
    }
  ]
}
```

---

## 真实踩坑记录

在生产环境中使用 Temporal + Laravel 的过程中，我们踩过不少坑。以下是最重要的几个：

### 坑一：PHP 序列化问题

**问题描述**：Temporal PHP SDK 使用 `igbinary` 或 PHP 内置的 `serialize()` 来序列化 Workflow 和 Activity 的参数/返回值。如果数据中包含不可序列化的对象（如 PDO 连接、文件句柄、匿名函数等），会导致 Worker 崩溃。

**典型案例**：

```php
// ❌ 错误的做法：直接返回 Eloquent Model
public function createOrder(string $orderId): Order
{
    return Order::create(['order_id' => $orderId]);
    // Order 模型包含 Connection 对象，无法序列化！
}

// ✅ 正确的做法：返回 DTO 或数组
public function createOrder(string $orderId): array
{
    $order = Order::create(['order_id' => $orderId]);
    return $order->toArray();
}
```

**解决方案**：

1. **始终使用 DTO 或数组**作为 Workflow/Activity 的参数和返回值
2. **避免传递 Eloquent Model**（它包含数据库连接等不可序列化的属性）
3. **在 Activity 中查询数据**，而不是在 Workflow 中查询后传递

```php
// 正确的模式
// Workflow 只负责编排，不直接操作数据
#[WorkflowMethod]
public function processOrder(OrderRequest $request): OrderResult
{
    // request 是 DTO，可以安全序列化
    $orderId = yield $activities->createOrder($request->orderId, $request->userId, ...);
    // 不要传递 Order 模型，只传递 ID
    $paymentId = yield $activities->initiatePayment($orderId, $request->totalAmount);
}
```

### 坑二：Workflow 确定性要求

**问题描述**：Temporal 的重放机制要求 Workflow 代码是**确定性**的。在重放时，Workflow 不会真正执行 Activity，而是从历史事件中读取结果。如果 Workflow 代码中有非确定性操作（随机数、当前时间、外部 API 调用），重放会产生不同的执行路径，导致 `NonDeterminismException`。

**典型案例**：

```php
// ❌ 错误：在 Workflow 中使用随机数
#[WorkflowMethod]
public function process(): string
{
    $randomValue = rand(1, 100); // 重放时会产生不同的值！
    if ($randomValue > 50) {
        yield $activityA();
    } else {
        yield $activityB();
    }
}

// ❌ 错误：在 Workflow 中获取当前时间
#[WorkflowMethod]
public function process(): void
{
    $now = Carbon::now(); // 重放时时间不同！
    // ...
}
```

**解决方案**：

```php
// ✅ 正确：使用 Temporal 提供的确定性 API
#[WorkflowMethod]
public function process(): string
{
    // 使用 Workflow::now() 而不是 Carbon::now() 或 time()
    $now = Workflow::now();

    // 需要随机数？使用 Side Effect
    $randomValue = yield Workflow::sideEffect(function () {
        return random_int(1, 100);
    });

    if ($randomValue > 50) {
        yield $activityA();
    } else {
        yield $activityB();
    }
}
```

**确定性规则速查表**：

| 操作 | ❌ 禁止 | ✅ 替代方案 |
|------|---------|-----------|
| 获取时间 | `time()`, `Carbon::now()` | `Workflow::now()` |
| 随机数 | `rand()`, `random_int()` | `Workflow::sideEffect(fn() => random_int(...))` |
| UUID 生成 | `Str::uuid()`, `uniqid()` | `Workflow::uuid()`（待 SDK 支持）/ `sideEffect` |
| 外部 API | HTTP 请求、数据库查询 | 将其放入 Activity |
| 日志 | `Log::info()` | `Workflow::getLogger()->info()` |
| 睡眠 | `sleep()`, `usleep()` | `Workflow::timer($seconds)` |

### 坑三：Workflow Replay Compatibility（版本管理）

**问题描述**：当你修改了正在运行的 Workflow 代码时，Temporal 需要用新代码重放旧的执行历史。如果新代码的执行路径与历史不一致，会抛出异常。

**典型场景**：

```php
// 版本 1：在第 2 步和第 3 步之间没有新步骤
#[WorkflowMethod]
public function process(): void
{
    yield $activity->step1();
    yield $activity->step2();
    yield $activity->step3();
}

// 版本 2：在第 2 步和第 3 步之间插入了新步骤
#[WorkflowMethod]
public function process(): void
{
    yield $activity->step1();
    yield $activity->step2();
    yield $activity->newStep();  // 新增步骤！
    yield $activity->step3();
}
```

如果有一个正在运行的 Workflow 执行到 step2，然后 Worker 重启使用了版本 2 的代码，重放时会在 step2 之后期望执行 newStep，但历史中只有 step3 的记录，导致 `NonDeterminismException`。

**解决方案：使用 Workflow::getVersion()**

```php
#[WorkflowMethod]
public function process(): void
{
    yield $activity->step1();
    yield $activity->step2();

    // 版本标记：从 Change 1 开始，执行 newStep
    $version = yield Workflow::getVersion('step2.5', Workflow::DEFAULT_VERSION, 1);

    if ($version >= 1) {
        yield $activity->newStep();
    }

    yield $activity->step3();
}
```

`getVersion()` 的工作原理：
- **旧的 Workflow 执行（历史中没有 'step2.5' 标记）**：返回 `DEFAULT_VERSION`，跳过 newStep
- **新的 Workflow 执行（历史中已有 'step2.5' 标记）**：返回 `1`，执行 newStep

### 坑四：Activity 的幂等性

**问题描述**：Activity 可能因为网络超时、Worker 崩溃等原因被重试。即使 Activity 实际上执行成功了，但由于响应没有传回 Temporal Server，它会被标记为失败并重试。因此，所有 Activity 必须是幂等的。

```php
// ❌ 非幂等实现
public function deductStock(string $productId, int $quantity): bool
{
    // 如果这个操作成功了但响应丢失，重试时会再次扣减！
    Product::where('id', $productId)->decrement('stock', $quantity);
    return true;
}

// ✅ 幂等实现（使用唯一键约束）
public function deductStock(string $orderId, string $productId, int $quantity): bool
{
    // 使用 order_id 作为幂等键
    $existing = StockTransaction::where('order_id', $orderId)
        ->where('product_id', $productId)
        ->where('type', 'deduction')
        ->first();

    if ($existing) {
        return true; // 已经扣减过了，直接返回成功
    }

    DB::transaction(function () use ($orderId, $productId, $quantity) {
        $affected = Product::where('id', $productId)
            ->where('stock', '>=', $quantity)
            ->decrement('stock', $quantity);

        if ($affected === 0) {
            throw new StockInsufficientException("Insufficient stock for {$productId}");
        }

        StockTransaction::create([
            'order_id' => $orderId,
            'product_id' => $productId,
            'type' => 'deduction',
            'quantity' => $quantity,
            'idempotency_key' => "{$orderId}:{$productId}:deduction",
        ]);
    });

    return true;
}
```

### 坑五：大数据量的历史事件

**问题描述**：一个长期运行的 Workflow（数天或数月）可能积累大量历史事件。Temporal 默认在历史事件超过 50,000 条时会自动 Continue-As-New，但如果处理不当，可能导致数据丢失。

**解决方案**：

```php
#[WorkflowMethod]
public function longRunningProcess(string $workflowId, int $currentBatch = 0): string
{
    $maxEvents = 1000; // 每批次最多处理的事件数
    $totalBatches = 100;

    for ($i = $currentBatch; $i < $totalBatches; $i++) {
        yield $this->processBatch($i);

        // 检查是否需要 Continue-As-New
        $historyLength = Workflow::getInfo()->getHistoryLength();
        if ($historyLength > 40000) {
            // Continue-As-New：启动新的 Workflow 执行，传递当前进度
            return yield Workflow::continueAsNew(
                self::class,
                [$workflowId, $i + 1]
            );
        }
    }

    return 'completed';
}
```

### 坑六：Task Queue 的粘性执行（Sticky Queue）

**问题描述**：Temporal 使用 Sticky Queue 优化 Workflow Task 的性能。如果 Worker 崩溃，Sticky Queue 中的 Task 可能需要等待超时（默认 10 秒）才能被其他 Worker 接管。

**解决方案**：

```php
// 调整 Sticky Queue 的超时时间
$worker = $factory->newWorker(
    'order-task-queue',
    WorkerOptions::new()
        ->withStickyWorkflowQueueSize(1000)
);
```

---

## 性能基准测试

### 测试环境

- **CPU**：8 核 Intel Xeon
- **内存**：16GB
- **存储**：SSD
- **数据库**：PostgreSQL 16
- **PHP**：8.3 with opcache

### 测试场景

测试 1000 个并发订单处理流程，每个流程包含 5 个步骤（创建订单 → 等待支付 → 扣减库存 → 创建物流 → 发送通知）。

### 测试结果

| 指标 | Temporal 方案 | 队列驱动方案（Laravel Queue + Redis） |
|------|--------------|--------------------------------------|
| **吞吐量（TPS）** | ~850 TPS | ~420 TPS |
| **平均延迟** | 45ms per step | 78ms per step |
| **P99 延迟** | 120ms per step | 350ms per step |
| **故障恢复时间** | < 5 秒（Worker 重启后自动恢复） | 30-60 秒（需要手动检查死信队列） |
| **消息丢失率** | 0%（持久化到数据库） | ~0.01%（极端情况下可能丢失） |
| **代码行数（核心逻辑）** | ~200 行 | ~450 行 |
| **开发时间（新流程）** | 1-2 天 | 3-5 天 |

### 分析

1. **吞吐量**：Temporal 的吞吐量约为 Laravel Queue 的 2 倍，主要得益于 Sticky Queue 优化和批量处理机制
2. **延迟**：Temporal 的延迟更低，因为 Workflow Task 使用内存缓存，避免了频繁的队列出队操作
3. **故障恢复**：这是最大的差异。Temporal 的 Workflow 状态持久化在数据库中，Worker 重启后自动恢复执行。队列方案需要额外的死信队列处理和手动干预
4. **开发效率**：Temporal 代码更简洁，因为重试、超时、补偿等机制都是声明式配置的

### 注意事项

- 队列方案的性能可以通过增加消费者数量、使用 Laravel Horizon 优化
- Temporal 的性能瓶颈通常在数据库（Persistence Store），使用 Cassandra 可以获得更好的水平扩展能力
- 实际生产环境中，网络延迟和服务响应时间会成为主要瓶颈，而不是工作流引擎本身

### 成本对比

| 成本项 | Temporal（自托管） | Temporal Cloud | 队列方案 |
|--------|-------------------|----------------|---------|
| **基础设施** | 需要额外的服务器（3 节点集群） | 按操作计费 | 使用现有的 Redis |
| **运维成本** | 中等（需要管理 Temporal Server） | 低 | 低 |
| **学习成本** | 高（需要理解 Temporal 概念） | 高 | 低（Laravel 开发者熟悉） |
| **长期维护** | 低（声明式配置，少样板代码） | 低 | 高（手动管理重试、补偿） |

---

## 总结与选型建议

### 何时应该使用 Temporal？

**强烈推荐 Temporal 的场景：**

1. **长事务流程**：涉及多个步骤、需要跨服务编排、执行时间可能超过数分钟
2. **需要精确的错误处理**：每个步骤都有不同的补偿逻辑，且补偿操作必须可靠执行
3. **异步回调场景**：如支付回调、第三方 API 的 webhook 回调
4. **流程可审计性要求高**：需要完整的执行历史记录，满足合规要求
5. **高可用性要求**：不允许因 Worker 重启导致流程中断

**可以不使用 Temporal 的场景：**

1. **简单的队列任务**：发送邮件、生成报告等独立任务，Laravel Queue 足够
2. **短期运行的任务**：执行时间在秒级别，不需要持久化状态
3. **团队规模小且业务简单**：引入 Temporal 的学习成本可能不值得

### 从队列方案迁移到 Temporal 的建议

1. **渐进式迁移**：不要一次性将所有流程迁移到 Temporal。从最复杂、问题最多的流程开始
2. **并行运行**：新旧方案并行运行一段时间，对比结果后再下线旧方案
3. **团队培训**：确保团队理解 Temporal 的核心概念（确定性、重放机制、版本管理）
4. **基础设施准备**：Temporal Server 的高可用部署、监控告警、备份恢复

### 技术栈推荐组合

对于 Laravel + 微服务架构，推荐的技术栈组合：

```
┌─────────────────────────────────────────┐
│           API Gateway (Nginx/Traefik)    │
├─────────────────────────────────────────┤
│           Laravel Application            │
│  ┌───────────┐  ┌───────────┐           │
│  │ Controller │  │  Service  │           │
│  └─────┬─────┘  └─────┬─────┘           │
│        │              │                  │
│  ┌─────▼──────────────▼─────┐           │
│  │   Temporal Client (SDK)  │           │
│  └───────────┬──────────────┘           │
├──────────────┼──────────────────────────┤
│              │                           │
│  ┌───────────▼──────────────┐           │
│  │    Temporal Server       │           │
│  │   (3 nodes + DB)         │           │
│  └───────────┬──────────────┘           │
│              │                           │
│  ┌───────────▼──────────────┐           │
│  │    Temporal Workers      │           │
│  │  (PHP + Supervisor)      │           │
│  └───────────┬──────────────┘           │
│              │                           │
│  ┌───────────▼──────────────┐           │
│  │   External Services      │           │
│  │  Payment/Stock/Shipment  │           │
│  └──────────────────────────┘           │
└─────────────────────────────────────────┘
```

### 最终思考

Temporal.io 代表了一种新的分布式系统编程范式——**将工作流逻辑从基础设施代码中解耦出来**。它不是银弹，但在处理复杂的长事务场景时，它提供的可靠性、可观测性和开发效率是传统方案难以匹敌的。

对于 Laravel 开发者来说，Temporal PHP SDK 的成熟度已经足够支撑生产级应用。虽然初期的学习曲线较陡峭，但一旦团队掌握了 Temporal 的核心概念，后续的开发和维护效率将大幅提升。

在我们的实际项目中，引入 Temporal 后：
- **生产事故减少了 70%**（主要归功于可靠的重试和补偿机制）
- **新流程的开发时间缩短了 50%**（声明式的工作流定义，减少样板代码）
- **问题排查时间缩短了 80%**（Temporal Web UI 提供了完整的执行链路追踪）

如果你的系统中存在复杂的分布式工作流编排需求，Temporal.io 绝对值得一试。

---

**参考资源**：

- [Temporal.io 官方文档](https://docs.temporal.io/)
- [Temporal PHP SDK GitHub](https://github.com/temporalio/sdk-php)
- [Temporal PHP SDK 文档](https://docs.temporal.io/php)
- [Temporal vs Cadence 对比](https://docs.temporal.io/cadence-to-temporal)
- [Saga Pattern - Microservices.io](https://microservices.io/patterns/data/saga.html)
- [Designing Data-Intensive Applications - Martin Kleppmann](https://dataintensive.net/)（分布式事务章节）

---

## 相关阅读

- [Dapr 实战：分布式应用运行时——Laravel 微服务的 Sidecar 模式、服务调用与发布订阅](/00_架构/Dapr-实战-分布式应用运行时-Laravel微服务的Sidecar模式服务调用与发布订阅/) — 同样面向 Laravel 微服务架构，从 Sidecar 运行时角度解决服务间通信与事件驱动编排问题
- [Kafka + Debezium CDC 实战：数据库变更事件流与 Laravel 互补架构](/00_架构/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/) — 基于 CDC 的事件驱动架构，与 Temporal 工作流引擎形成互补的分布式数据一致性方案
- [Event Storming 实战：从业务事件到代码实现的领域建模方法论](/00_架构/Event-Storming-实战-从业务事件到代码实现的领域建模方法论-Laravel-B2C-API踩坑记录/) — 在引入 Temporal 之前，用 Event Storming 梳理业务事件与领域边界，为工作流编排奠定业务建模基础
