---

title: 分布式事务实战-Saga-模式在订单库存支付中的应用-Laravel-B2C-API踩坑记录
keywords: [Saga, Laravel, B2C, API, 分布式事务实战, 模式在订单库存支付中的应用, 踩坑记录]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-16 16:12:27
updated: 2026-05-16 16:22:05
categories:
- architecture
- microservice
tags:
- KKday
- Laravel
- 微服务
description: 在 B2C 电商场景下，订单创建涉及库存扣减、支付发起、优惠券核销等多个跨服务操作，如何保证数据一致性？本文深入 Saga 模式的编排式（Orchestration）与协同式（Choreography）两种实现方案对比，结合 Laravel B2C API 真实项目经验，从 SagaStep 接口设计、Context 数据传递、Orchestrator 核心编排到状态持久化，完整覆盖补偿事务设计、幂等性保障、悬挂与空回滚处理、长事务锁优化、补偿失败告警与人工介入等五大生产踩坑点，并提供可运行的 PHPUnit 测试用例与 Saga 执行状态表设计。
---



# 分布式事务实战：Saga 模式在订单/库存/支付中的应用

## 前言：为什么需要分布式事务？

在 KKday B2C API 的订单流程中，一次「下单」操作需要跨多个服务完成：

1. **库存服务** — 扣减商品库存
2. **优惠券服务** — 核销用户优惠券
3. **订单服务** — 创建订单记录
4. **支付服务** — 发起支付请求
5. **通知服务** — 发送下单成功通知

传统单体架构中，我们可以用一个数据库事务包裹所有操作。但在微服务架构下，每个服务有独立的数据库，**本地事务无法跨越服务边界**。

这就是分布式事务要解决的核心问题：**如何在多个独立服务之间保证数据一致性？**

<!-- more -->

## 分布式事务方案对比

在实际选型前，我们调研了主流方案：

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|--------|------|--------|----------|
| 2PC（两阶段提交） | 强一致 | 低 | 中 | 金融转账 |
| TCC（Try-Confirm-Cancel） | 强一致 | 中 | 高 | 资金类操作 |
| **Saga** | **最终一致** | **高** | **中** | **电商订单** |
| 本地消息表 | 最终一致 | 高 | 低 | 异步通知 |
| 事务消息（RocketMQ） | 最终一致 | 高 | 中 | 消息驱动 |

**我们最终选择了 Saga 模式**，原因：

- B2C 电商场景允许「最终一致性」，不需要强一致
- Saga 不需要锁定资源，性能远优于 2PC/TCC
- 每个步骤有明确的补偿操作，易于理解和维护

## Saga 模式的两种实现方式

### 1. 协同式（Choreography）：事件驱动

每个服务监听事件，自行决定下一步操作：

```
用户下单 → OrderService 发布 OrderCreated 事件
    ↓
InventoryService 监听到 → 扣减库存 → 发布 InventoryReserved 事件
    ↓
PaymentService 监听到 → 发起支付 → 发布 PaymentCompleted 事件
    ↓
NotificationService 监听到 → 发送通知
```

**优点**：服务间松耦合，无中心协调器
**缺点**：流程分散在各服务中，难以追踪和调试

### 2. 编排式（Orchestration）：中心协调

由一个 Saga Orchestrator 统一编排所有步骤：

```
Orchestrator:
  Step 1 → 调用 InventoryService.reserve()
  Step 2 → 调用 CouponService.claim()
  Step 3 → 调用 OrderService.create()
  Step 4 → 调用 PaymentService.initiate()
  
  如果 Step 3 失败：
    补偿 Step 2 → CouponService.revert()
    补偿 Step 1 → InventoryService.release()
```

**我们选择了编排式**，因为订单流程步骤明确、分支较多，集中编排更容易管理。

## Laravel 实战：编排式 Saga 实现

### 核心架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Saga Orchestrator                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Reserve  │→ │  Claim   │→ │  Create  │→ │ Initiate│ │
│  │Inventory │  │ Coupon   │  │  Order   │  │ Payment │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │              │              │              │      │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐       │      │
│  │ Release  │← │ Revert   │← │  Cancel  │← 失败回滚    │
│  │Inventory │  │ Coupon   │  │  Order   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
         │              │              │              │
    ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  ┌────▼────┐
    │Inventory │  │ Coupon   │  │  Order   │  │ Payment │
    │ Service  │  │ Service  │  │ Service  │  │ Service │
    └──────────┘  └──────────┘  └──────────┘  └─────────┘
```

### Step 1：定义 Saga Step 接口

```php
<?php
// app/Saga/Contracts/SagaStep.php

namespace App\Saga\Contracts;

interface SagaStep
{
    /**
     * 执行正向操作
     */
    public function execute(SagaContext $context): SagaContext;

    /**
     * 执行补偿操作（回滚）
     */
    public function compensate(SagaContext $context): void;

    /**
     * 步骤名称（用于日志和追踪）
     */
    public function getName(): string;
}
```

### Step 2：Saga Context — 跨步骤数据传递

```php
<?php
// app/Saga/SagaContext.php

namespace App\Saga;

class SagaContext
{
    private array $data = [];
    private array $completedSteps = [];
    private ?string $error = null;

    public function set(string $key, mixed $value): self
    {
        $this->data[$key] = $value;
        return $this;
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->data[$key] ?? $default;
    }

    public function markCompleted(string $stepName): self
    {
        $this->completedSteps[] = $stepName;
        return $this;
    }

    public function getCompletedSteps(): array
    {
        return $this->completedSteps;
    }

    public function setError(string $error): self
    {
        $this->error = $error;
        return $this;
    }

    public function hasError(): bool
    {
        return $this->error !== null;
    }

    public function getError(): ?string
    {
        return $this->error;
    }
}
```

### Step 3：具体 Step 实现 — 库存扣减

```php
<?php
// app/Saga/Steps/ReserveInventoryStep.php

namespace App\Saga\Steps;

use App\Saga\Contracts\SagaStep;
use App\Saga\SagaContext;
use App\Services\InventoryService;
use Illuminate\Support\Facades\Log;

class ReserveInventoryStep implements SagaStep
{
    public function __construct(
        private InventoryService $inventoryService
    ) {}

    public function getName(): string
    {
        return 'reserve_inventory';
    }

    public function execute(SagaContext $context): SagaContext
    {
        $items = $context->get('order_items');

        // 生成幂等键，防止重复扣减
        $idempotencyKey = $context->get('saga_id') . '_inventory';

        $result = $this->inventoryService->batchReserve(
            items: $items,
            idempotencyKey: $idempotencyKey,
            ttl: 900 // 预留 15 分钟
        );

        if (!$result['success']) {
            throw new \RuntimeException(
                "库存预留失败: {$result['message']}"
            );
        }

        $context->set('reservation_ids', $result['reservation_ids']);
        Log::info('Saga: 库存预留成功', [
            'saga_id' => $context->get('saga_id'),
            'reservation_ids' => $result['reservation_ids'],
        ]);

        return $context;
    }

    public function compensate(SagaContext $context): void
    {
        $reservationIds = $context->get('reservation_ids', []);

        if (empty($reservationIds)) {
            Log::warning('Saga: 库存补偿跳过，无预留记录', [
                'saga_id' => $context->get('saga_id'),
            ]);
            return;
        }

        $this->inventoryService->batchRelease($reservationIds);

        Log::info('Saga: 库存补偿成功', [
            'saga_id' => $context->get('saga_id'),
            'reservation_ids' => $reservationIds,
        ]);
    }
}
```

### Step 4：Orchestrator 核心实现

```php
<?php
// app/Saga/OrderSagaOrchestrator.php

namespace App\Saga;

use App\Saga\Contracts\SagaStep;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class OrderSagaOrchestrator
{
    /** @var SagaStep[] */
    private array $steps = [];

    public function addStep(SagaStep $step): self
    {
        $this->steps[] = $step;
        return $this;
    }

    public function execute(array $initialData = []): SagaContext
    {
        $context = new SagaContext();
        $context->set('saga_id', Str::uuid()->toString());

        foreach ($initialData as $key => $value) {
            $context->set($key, $value);
        }

        $executedSteps = [];

        Log::info('Saga 开始执行', [
            'saga_id' => $context->get('saga_id'),
            'steps' => array_map(fn($s) => $s->getName(), $this->steps),
        ]);

        foreach ($this->steps as $step) {
            try {
                $context = $step->execute($context);
                $context->markCompleted($step->getName());
                $executedSteps[] = $step;

                Log::info("Saga Step 完成: {$step->getName()}", [
                    'saga_id' => $context->get('saga_id'),
                ]);
            } catch (\Throwable $e) {
                Log::error("Saga Step 失败: {$step->getName()}", [
                    'saga_id' => $context->get('saga_id'),
                    'error' => $e->getMessage(),
                ]);

                $context->setError($e->getMessage());

                // 反向补偿已执行的步骤
                $this->compensate($executedSteps, $context);

                throw new SagaExecutionException(
                    "Saga 执行失败于 {$step->getName()}: {$e->getMessage()}",
                    0,
                    $e
                );
            }
        }

        Log::info('Saga 全部完成', [
            'saga_id' => $context->get('saga_id'),
        ]);

        return $context;
    }

    /**
     * 反向补偿：后执行的先回滚
     */
    private function compensate(array $executedSteps, SagaContext $context): void
    {
        $reversedSteps = array_reverse($executedSteps);

        foreach ($reversedSteps as $step) {
            try {
                $step->compensate($context);
                Log::info("Saga 补偿成功: {$step->getName()}", [
                    'saga_id' => $context->get('saga_id'),
                ]);
            } catch (\Throwable $e) {
                // 补偿失败需要告警，人工介入
                Log::critical("Saga 补偿失败: {$step->getName()}", [
                    'saga_id' => $context->get('saga_id'),
                    'error' => $e->getMessage(),
                ]);

                // 记录到补偿失败表，等待人工处理
                $this->recordCompensationFailure($step, $context, $e);
            }
        }
    }

    private function recordCompensationFailure(
        SagaStep $step,
        SagaContext $context,
        \Throwable $e
    ): void {
        DB::table('saga_compensation_failures')->insert([
            'saga_id' => $context->get('saga_id'),
            'step_name' => $step->getName(),
            'error_message' => $e->getMessage(),
            'context_data' => json_encode($context->getCompletedSteps()),
            'created_at' => now(),
        ]);
    }
}
```

### Step 5：在 Service 中使用

```php
<?php
// app/Services/OrderCreationService.php

namespace App\Services;

use App\Saga\Steps\ReserveInventoryStep;
use App\Saga\Steps\ClaimCouponStep;
use App\Saga\Steps\CreateOrderStep;
use App\Saga\Steps\InitiatePaymentStep;
use App\Saga\OrderSagaOrchestrator;

class OrderCreationService
{
    public function __construct(
        private ReserveInventoryStep $inventoryStep,
        private ClaimCouponStep $couponStep,
        private CreateOrderStep $orderStep,
        private InitiatePaymentStep $paymentStep,
    ) {}

    public function createOrder(array $orderData): array
    {
        $orchestrator = app(OrderSagaOrchestrator::class);

        $orchestrator
            ->addStep($this->inventoryStep)
            ->addStep($this->couponStep)
            ->addStep($this->orderStep)
            ->addStep($this->paymentStep);

        $context = $orchestrator->execute([
            'user_id' => $orderData['user_id'],
            'order_items' => $orderData['items'],
            'coupon_id' => $orderData['coupon_id'] ?? null,
            'payment_method' => $orderData['payment_method'],
            'total_amount' => $orderData['total_amount'],
        ]);

        return [
            'order_id' => $context->get('order_id'),
            'payment_url' => $context->get('payment_url'),
            'saga_id' => $context->get('saga_id'),
        ];
    }
}
```

## 踩坑记录：生产环境的真实教训

### 踩坑 1：补偿操作的幂等性问题

**问题**：网络超时导致补偿操作被重试，库存被释放了两次。

```php
// ❌ 错误实现：不保证幂等
public function compensate(SagaContext $context): void
{
    $this->inventoryService->batchRelease(
        $context->get('reservation_ids')
    );
}

// ✅ 正确实现：基于 saga_id 的幂等键
public function compensate(SagaContext $context): void
{
    $idempotencyKey = $context->get('saga_id') . '_inventory_release';
    
    if ($this->isAlreadyCompensated($idempotencyKey)) {
        Log::info('库存补偿已执行，跳过');
        return;
    }

    $this->inventoryService->batchRelease(
        $context->get('reservation_ids'),
        $idempotencyKey
    );

    $this->markCompensated($idempotencyKey);
}
```

**教训**：每一个正向操作和补偿操作都必须是幂等的。我们用 Redis SET + EX 做幂等检查：

```php
private function isAlreadyCompensated(string $key): bool
{
    return Redis::set("saga:idempotent:{$key}", '1', 'NX', 'EX', 3600) === false;
}
```

### 踩坑 2：悬挂（Suspension）问题

**问题**：用户下单后取消，但库存预留的 15 分钟 TTL 过期后，延迟到达的支付回调又触发了订单创建。

```php
// 在 OrderService.create() 中加入状态检查
public function create(SagaContext $context): SagaContext
{
    $userId = $context->get('user_id');
    $sagaId = $context->get('saga_id');

    // 检查是否已取消（防止悬挂）
    $cancelled = DB::table('saga_cancellations')
        ->where('saga_id', $sagaId)
        ->exists();

    if ($cancelled) {
        throw new SagaSuspensionException(
            "Saga {$sagaId} 已被取消，拒绝创建订单"
        );
    }

    // 正常创建逻辑...
}
```

### 踩坑 3：空回滚（Empty Rollback）

**问题**：CreateOrderStep 执行超时，Orchestrator 发起补偿，但订单实际上并未创建成功，执行删除操作时抛出异常。

```php
public function compensate(SagaContext $context): void
{
    $orderId = $context->get('order_id');

    // ✅ 空回滚处理：如果订单不存在，直接跳过
    if ($orderId === null) {
        Log::info('订单补偿：订单未创建，跳过删除');
        return;
    }

    $order = Order::find($orderId);
    if ($order === null) {
        Log::info("订单补偿：订单 {$orderId} 不存在，跳过");
        return;
    }

    $order->update(['status' => 'cancelled']);
    Log::info("订单补偿：订单 {$orderId} 已取消");
}
```

### 踩坑 4：补偿失败的告警与人工介入

**问题**：补偿操作本身也可能失败（如库存服务宕机），导致数据不一致。

我们设计了补偿失败处理机制：

```php
// database/migrations/xxx_create_saga_compensation_failures_table.php
Schema::create('saga_compensation_failures', function (Blueprint $table) {
    $table->id();
    $table->string('saga_id', 36)->index();
    $table->string('step_name');
    $table->text('error_message')->nullable();
    $table->json('context_data')->nullable();
    $table->enum('status', ['pending', 'resolved', 'escalated'])
          ->default('pending');
    $table->text('resolution_note')->nullable();
    $table->timestamp('resolved_at')->nullable();
    $table->timestamps();
});
```

配合定时任务 + Slack 告警：

```php
// app/Jobs/CheckSagaCompensationFailures.php
class CheckSagaCompensationFailures implements ShouldQueue
{
    public function handle(): void
    {
        $failures = DB::table('saga_compensation_failures')
            ->where('status', 'pending')
            ->where('created_at', '<', now()->subMinutes(5))
            ->get();

        if ($failures->isNotEmpty()) {
            // 发送 Slack 告警
            Notification::route('slack', config('services.slack.webhook'))
                ->notify(new SagaCompensationFailureAlert($failures));
        }
    }
}
```

### 踩坑 5：长事务与数据库锁

**问题**：CreateOrderStep 中在一个 DB::transaction 里做了太多操作，导致行锁持有时间过长。

```php
// ❌ 长事务：持有锁跨越了外部 API 调用
public function execute(SagaContext $context): SagaContext
{
    return DB::transaction(function () use ($context) {
        $order = Order::create([...]);
        $order->items()->createMany([...]);
        
        // ⚠️ 外部 API 调用在事务内！
        $this->couponService->claim($context->get('coupon_id'));
        
        return $context->set('order_id', $order->id);
    });
}

// ✅ 优化：先完成外部调用，再写入数据库
public function execute(SagaContext $context): SagaContext
{
    // 先调用外部服务（不需要数据库锁）
    $couponResult = $this->couponService->claim(
        $context->get('coupon_id')
    );

    // 再写入数据库（事务尽可能短）
    $order = DB::transaction(function () use ($context, $couponResult) {
        $order = Order::create([
            'user_id' => $context->get('user_id'),
            'total_amount' => $context->get('total_amount'),
            'coupon_id' => $couponResult['claimed_coupon_id'],
            'status' => 'pending',
        ]);

        $order->items()->createMany(
            $this->buildOrderItems($context->get('order_items'))
        );

        return $order;
    });

    return $context->set('order_id', $order->id);
}
```

## Saga 状态持久化

生产环境中，Saga 的执行状态必须持久化，防止 Orchestrator 崩溃后无法恢复：

```php
// database/migrations/xxx_create_saga_executions_table.php
Schema::create('saga_executions', function (Blueprint $table) {
    $table->id();
    $table->string('saga_id', 36)->unique();
    $table->string('saga_type'); // 'order_creation', 'refund' 等
    $table->enum('status', ['running', 'completed', 'compensating', 'failed']);
    $table->json('context_data');
    $table->json('completed_steps')->default('[]');
    $table->text('error_message')->nullable();
    $table->timestamps();
});
```

Orchestrator 执行过程中每完成一步，都更新状态：

```php
// 在 Orchestrator 中
private function persistState(SagaContext $context, string $status): void
{
    DB::table('saga_executions')->updateOrInsert(
        ['saga_id' => $context->get('saga_id')],
        [
            'status' => $status,
            'context_data' => json_encode($context->toArray()),
            'completed_steps' => json_encode($context->getCompletedSteps()),
            'updated_at' => now(),
        ]
    );
}
```

## 协同式 Saga 的补充：事件驱动

对于非关键路径（如通知），我们采用协同式补充：

```php
// 订单创建成功后发布事件
class OrderCreatedEvent
{
    public function __construct(
        public readonly string $orderId,
        public readonly string $sagaId,
        public readonly int $userId,
    ) {}
}

// 通知服务监听
class SendOrderNotificationListener
{
    public function handle(OrderCreatedEvent $event): void
    {
        // 异步发送，失败不影响主流程
        Notification::send(
            User::find($event->userId),
            new OrderCreatedNotification($event->orderId)
        );
    }
}
```

## Saga 各步骤失败场景速查表

在实际生产中，不同步骤失败时的补偿行为和影响各不相同。以下是各步骤失败时的速查表：

| 失败步骤 | 已完成操作 | 需要补偿的操作 | 补偿难度 | 潜在风险 |
|----------|-----------|---------------|---------|---------|
| InventoryReserve 失败 | 无 | 无 | 无需补偿 | 库存不足被误判为成功 |
| CouponClaim 失败 | 库存已预留 | 释放库存预留 | 低 | 预留 TTL 过期前补偿完成即可 |
| OrderCreate 失败 | 库存预留 + 优惠券核销 | 释放库存 + 退还优惠券 | 中 | 优惠券退还可能触发空回滚 |
| PaymentInitiate 失败 | 库存预留 + 优惠券核销 + 订单已创建 | 释放库存 + 退还优惠券 + 取消订单 | 高 | 订单状态回滚需保证幂等 |

> **经验法则**：步骤越靠后，补偿成本越高。因此将「最可能失败」的步骤放在前面（如库存检查），可以降低整体补偿开销。

## PHPUnit 测试：验证 Saga 补偿流程

以下是一个可运行的测试用例，验证当中间步骤失败时，已完成步骤是否被正确补偿：

```php
<?php
// tests/Unit/Saga/OrderSagaOrchestratorTest.php

namespace Tests\Unit\Saga;

use App\Saga\Contracts\SagaStep;
use App\Saga\OrderSagaOrchestrator;
use App\Saga\SagaContext;
use App\Saga\Exceptions\SagaExecutionException;
use PHPUnit\Framework\TestCase;

class OrderSagaOrchestratorTest extends TestCase
{
    /** @test */
    public function it_compensates_completed_steps_on_failure(): void
    {
        $step1 = new FakeStep('inventory', shouldFail: false);
        $step2 = new FakeStep('coupon', shouldFail: false);
        $step3 = new FakeStep('order', shouldFail: true); // 此步失败

        $orchestrator = new OrderSagaOrchestrator();
        $orchestrator->addStep($step1)->addStep($step2)->addStep($step3);

        $this->expectException(SagaExecutionException::class);

        try {
            $orchestrator->execute(['user_id' => 1]);
        } finally {
            // 验证：step1 和 step2 被补偿，step3 未被补偿
            $this->assertTrue($step1->compensated);
            $this->assertTrue($step2->compensated);
            $this->assertFalse($step3->compensated);
        }
    }

    /** @test */
    public function it_executes_all_steps_when_no_failure(): void
    {
        $step1 = new FakeStep('inventory', shouldFail: false);
        $step2 = new FakeStep('coupon', shouldFail: false);
        $step3 = new FakeStep('order', shouldFail: false);

        $orchestrator = new OrderSagaOrchestrator();
        $orchestrator->addStep($step1)->addStep($step2)->addStep($step3);

        $context = $orchestrator->execute(['user_id' => 1]);

        $this->assertNull($context->getError());
        $this->assertFalse($step1->compensated);
        $this->assertFalse($step2->compensated);
        $this->assertFalse($step3->compensated);
    }

    /** @test */
    public function it_compensates_in_reverse_order(): void
    {
        $compensationOrder = [];

        $step1 = new FakeStep('inventory', shouldFail: false, onCompensate: function () use (&$compensationOrder) {
            $compensationOrder[] = 'inventory';
        });
        $step2 = new FakeStep('coupon', shouldFail: false, onCompensate: function () use (&$compensationOrder) {
            $compensationOrder[] = 'coupon';
        });
        $step3 = new FakeStep('order', shouldFail: true);

        $orchestrator = new OrderSagaOrchestrator();
        $orchestrator->addStep($step1)->addStep($step2)->addStep($step3);

        try {
            $orchestrator->execute(['user_id' => 1]);
        } catch (SagaExecutionException) {}

        // 验证补偿顺序：后执行的先回滚
        $this->assertEquals(['coupon', 'inventory'], $compensationOrder);
    }
}

/**
 * 测试用 Fake Step 实现
 */
class FakeStep implements SagaStep
{
    public bool $compensated = false;
    private ?\Closure $onCompensate;

    public function __construct(
        private string $name,
        private bool $shouldFail,
        ?\Closure $onCompensate = null
    ) {
        $this->onCompensate = $onCompensate;
    }

    public function execute(SagaContext $context): SagaContext
    {
        if ($this->shouldFail) {
            throw new \RuntimeException("Step [{$this->name}] failed");
        }
        return $context;
    }

    public function compensate(SagaContext $context): void
    {
        $this->compensated = true;
        if ($this->onCompensate) {
            ($this->onCompensate)();
        }
    }

    public function getName(): string
    {
        return $this->name;
    }
}
```

运行测试：

```bash
php artisan test --filter=OrderSagaOrchestratorTest
```

## 总结

Saga 模式在 B2C 电商场景中的核心价值：

1. **最终一致性**：允许中间状态存在，但保证最终数据一致
2. **高可用**：不锁定资源，不影响系统吞吐
3. **可追溯**：每个步骤的状态都可持久化和查询
4. **可恢复**：通过补偿和重试机制，自动修复异常

**关键经验**：

- 所有操作（正向 + 补偿）必须幂等
- 必须处理「空回滚」和「悬挂」问题
- 补偿失败要有告警和人工介入机制
- 事务要尽可能短，避免在事务内调用外部 API
- Saga 状态必须持久化，支持断点恢复

分布式事务没有银弹，Saga 模式用「最终一致」换取了「高可用」，这在电商场景下是值得的权衡。

---

## 相关阅读

- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/categories/架构/saga-orchestration-pattern-laravel-distributed-transaction/)
- [TCC 分布式事务模式实战：Try-Confirm-Cancel 在 Laravel 订单/支付/库存中的落地](/categories/架构/TCC-分布式事务模式实战-Try-Confirm-Cancel-Laravel-订单支付库存落地/)
- [Choreography vs Orchestration 实战：事件驱动 vs 工作流驱动——Laravel 微服务分布式编排范式深度对比](/categories/架构/choreography-vs-orchestration-event-driven-vs-workflow-driven-laravel-microservices/)
