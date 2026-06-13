---
title: 订单状态机实战：用 Laravel + XState 实现复杂订单流转——可视化状态图与事件驱动
date: 2026-06-02 00:00:00
tags: [状态机, Laravel, XState, 订单系统, 事件驱动]
keywords: [Laravel, XState, 订单状态机实战, 实现复杂订单流转, 可视化状态图与事件驱动, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: B2C 电商订单状态机实战教程，使用 Laravel spatie/laravel-model-states 实现后端状态管理，前端 XState 可视化状态图。涵盖状态转换并发控制与幂等性保障、事件驱动架构集成、审计日志记录、守卫条件与并行子状态机扩展模式。包含完整 PHP 与 TypeScript 代码示例、真实踩坑案例与测试策略，告别 if-else 状态管理噩梦。
---


## 前言

B2C 电商的订单系统看似简单——创建、支付、发货、完成，但实际业务中充满了复杂的状态流转：取消、退款、部分发货、超时关闭、售后申请……当团队用一堆 `if-else` 和数据库字段 `status` 硬编码状态逻辑时，代码很快就会变成维护噩梦。本文记录了在 Laravel 项目中引入状态机模式的完整实战经验，包括后端的 `spatie/laravel-model-states` 和前端的 XState 可视化状态图。

<!-- more -->

## 一、为什么需要状态机？

### 1.1 传统方式的问题

```php
// ❌ 典型的 if-else 状态管理
public function pay(Order $order)
{
    if ($order->status !== 'pending') {
        throw new InvalidOrderStateException('只有待支付订单才能支付');
    }
    if ($order->is_expired) {
        throw new OrderExpiredException();
    }
    $order->status = 'paid';
    $order->paid_at = now();
    $order->save();

    // 触发后续逻辑...
    if ($order->has_coupon) {
        // 核销优惠券
    }
    if ($order->is_presale) {
        // 预售逻辑
    }
}
```

问题：
- 状态转换规则散落在各个方法中，无法一目了然地看到"从 A 状态可以到哪些状态"
- 新增状态（如"部分退款"）需要修改所有相关方法
- 无法在编译期或启动期校验状态转换的合法性
- 前端展示状态标签时需要硬编码所有可能的状态

### 1.2 状态机的核心概念

```
                  ┌──────────┐
     创建订单      │          │  超时/取消
  ──────────────→ │ pending  │ ──────────→ ┌──────────┐
                  │          │              │ cancelled│
                  └────┬─────┘              └──────────┘
                       │ 支付
                       ▼
                  ┌──────────┐
                  │          │  申请退款
                  │  paid    │ ──────────→ ┌──────────┐
                  │          │              │ refunding│
                  └────┬─────┘              └────┬─────┘
                       │ 发货                    │ 退款成功
                       ▼                         ▼
                  ┌──────────┐              ┌──────────┐
                  │          │              │ refunded │
                  │ shipped  │              └──────────┘
                  │          │
                  └────┬─────┘
                       │ 签收
                       ▼
                  ┌──────────┐
                  │ completed│
                  └──────────┘
```

## 二、后端：spatie/laravel-model-states

### 2.1 安装与配置

```bash
composer require spatie/laravel-model-states
php artisan make:state OrderStates/Pending
php artisan make:state OrderStates/Paid
php artisan make:state OrderStates/Shipped
php artisan make:state OrderStates/Completed
php artisan make:state OrderStates/Cancelled
php artisan make:state OrderStates/Refunding
php artisan make:state OrderStates/Refunded
```

### 2.2 定义状态类

```php
// app/States/OrderStates/OrderState.php
abstract class OrderState extends State
{
    abstract public function color(): string;
    abstract public function label(): string;
    abstract public function allowedTransitions(): array;

    public function canTransitionTo(string $stateClass): bool
    {
        return in_array($stateClass, $this->allowedTransitions());
    }
}

// app/States/OrderStates/Pending.php
class Pending extends OrderState
{
    public function color(): string { return 'orange'; }
    public function label(): string { return '待支付'; }

    public function allowedTransitions(): array
    {
        return [Paid::class, Cancelled::class];
    }

    public function paid(): Paid
    {
        return $this->transitionTo(Paid::class);
    }

    public function cancel(): Cancelled
    {
        return $this->transitionTo(Cancelled::class);
    }
}

// app/States/OrderStates/Paid.php
class Paid extends OrderState
{
    public function color(): string { return 'green'; }
    public function label(): string { return '已支付'; }

    public function allowedTransitions(): array
    {
        return [Shipped::class, Refunding::class, Cancelled::class];
    }

    public function shipped(): Shipped
    {
        return $this->transitionTo(Shipped::class);
    }

    public function refund(): Refunding
    {
        return $this->transitionTo(Refunding::class);
    }
}

// app/States/OrderStates/Shipped.php
class Shipped extends OrderState
{
    public function color(): string { return 'blue'; }
    public function label(): string { return '已发货'; }

    public function allowedTransitions(): array
    {
        return [Completed::class, Refunding::class];
    }
}

// app/States/OrderStates/Completed.php
class Completed extends OrderState
{
    public function color(): string { return 'gray'; }
    public function label(): string { return '已完成'; }

    public function allowedTransitions(): array
    {
        return []; // 终态，不可转换
    }
}

// app/States/OrderStates/Cancelled.php
class Cancelled extends OrderState
{
    public function color(): string { return 'red'; }
    public function label(): string { return '已取消'; }

    public function allowedTransitions(): array
    {
        return []; // 终态
    }
}

// app/States/OrderStates/Refunding.php
class Refunding extends OrderState
{
    public function color(): string { return 'purple'; }
    public function label(): string { return '退款中'; }

    public function allowedTransitions(): array
    {
        return [Refunded::class, Paid::class]; // 退款可驳回
    }
}

// app/States/OrderStates/Refunded.php
class Refunded extends OrderState
{
    public function color(): string { return 'gray'; }
    public function label(): string { return '已退款'; }

    public function allowedTransitions(): array
    {
        return []; // 终态
    }
}
```

### 2.3 Model 集成

```php
// app/Models/Order.php
class Order extends Model
{
    protected $casts = [
        'state' => OrderState::class,
        'paid_at' => 'datetime',
        'shipped_at' => 'datetime',
        'completed_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    // 状态转换的允许配置
    public function registerStates(): void
    {
        $this->addState('state', OrderState::class)
            ->allowTransition(Pending::class, Paid::class)
            ->allowTransition(Pending::class, Cancelled::class)
            ->allowTransition(Paid::class, Shipped::class)
            ->allowTransition(Paid::class, Refunding::class)
            ->allowTransition(Paid::class, Cancelled::class)
            ->allowTransition(Shipped::class, Completed::class)
            ->allowTransition(Shipped::class, Refunding::class)
            ->allowTransition(Refunding::class, Refunded::class)
            ->allowTransition(Refunding::class, Paid::class);
    }
}
```

### 2.4 状态转换事件（Side Effects）

```php
// app/States/OrderStates/Paid.php — 增加 onEnter 回调
class Paid extends OrderState
{
    public function onEnter(): void
    {
        $order = $this->model;

        // 记录支付时间
        $order->update(['paid_at' => now()]);

        // 核销优惠券
        if ($order->coupon_id) {
            app(CouponService::class)->consume($order->coupon_id, $order->id);
        }

        // 扣减库存（从预扣变为实际扣减）
        foreach ($order->items as $item) {
            app(InventoryService::class)->confirmDeduction($item->sku_id, $item->quantity);
        }

        // 触发领域事件
        OrderPaid::dispatch($order);
    }
}

// app/States/OrderStates/Shipped.php
class Shipped extends OrderState
{
    public function onEnter(): void
    {
        $order = $this->model;
        $order->update(['shipped_at' => now()]);

        // 发送短信通知
        app(NotificationService::class)->sendShippingNotification($order);

        // 启动自动确认收货定时任务（15天）
        AutoConfirmDelivery::dispatch($order)
            ->delay(now()->addDays(15));
    }
}

// app/States/OrderStates/Cancelled.php
class Cancelled extends OrderState
{
    public function onEnter(): void
    {
        $order = $this->model;
        $order->update(['cancelled_at' => now()]);

        // 释放库存
        foreach ($order->items as $item) {
            app(InventoryService::class)->releaseStock($item->sku_id, $item->quantity);
        }

        // 退回优惠券
        if ($order->coupon_id) {
            app(CouponService::class)->revert($order->coupon_id);
        }

        // 如果已支付，触发退款
        if ($order->paid_at) {
            app(RefundService::class)->initiateRefund($order);
        }
    }
}
```

**踩坑 1：`onEnter` 中抛异常会导致状态已写入数据库但后续逻辑未执行。** 解决方案：在状态转换外层包裹事务。

```php
public function pay(Order $order): Order
{
    return DB::transaction(function () use ($order) {
        // 加行锁防止并发
        $order = Order::where('id', $order->id)->lockForUpdate()->first();

        // 状态机校验 + 转换
        $order->state->transitionTo(Paid::class);

        return $order->refresh();
    });
}
```

### 2.5 状态变更的审计日志

```php
// app/Models/StateTransitionLog.php
class StateTransitionLog extends Model
{
    protected $fillable = [
        'model_type', 'model_id',
        'from_state', 'to_state',
        'triggered_by', 'context',
    ];
}

// app/Observers/OrderObserver.php
class OrderObserver
{
    public function updated(Order $order): void
    {
        if ($order->wasChanged('state')) {
            StateTransitionLog::create([
                'model_type' => Order::class,
                'model_id' => $order->id,
                'from_state' => $order->getOriginal('state'),
                'to_state' => $order->state,
                'triggered_by' => auth()->id() ?? 'system',
                'context' => request()->all(),
            ]);
        }
    }
}
```

## 三、前端：XState 可视化状态图

### 3.1 安装 XState

```bash
npm install xstate @xstate/vue
```

### 3.2 定义状态机

```typescript
// resources/js/machines/orderMachine.ts
import { createMachine, assign } from 'xstate';

interface OrderContext {
  orderId: number;
  status: string;
  paidAt: string | null;
  shippedAt: string | null;
  trackingNumber: string | null;
  error: string | null;
}

type OrderEvent =
  | { type: 'PAY'; orderId: number }
  | { type: 'SHIP'; trackingNumber: string }
  | { type: 'CONFIRM_DELIVERY' }
  | { type: 'CANCEL' }
  | { type: 'REQUEST_REFUND'; reason: string }
  | { type: 'APPROVE_REFUND' }
  | { type: 'REJECT_REFUND' };

export const orderMachine = createMachine({
  id: 'order',
  initial: 'pending',
  context: {
    orderId: 0,
    status: 'pending',
    paidAt: null,
    shippedAt: null,
    trackingNumber: null,
    error: null,
  } as OrderContext,
  states: {
    pending: {
      on: {
        PAY: {
          target: 'paid',
          actions: assign({
            paidAt: () => new Date().toISOString(),
          }),
        },
        CANCEL: 'cancelled',
      },
      after: {
        // 30 分钟超时自动取消
        1800000: 'cancelled',
      },
    },
    paid: {
      on: {
        SHIP: {
          target: 'shipped',
          actions: assign({
            shippedAt: () => new Date().toISOString(),
            trackingNumber: (_, event) => event.trackingNumber,
          }),
        },
        CANCEL: 'cancelled',
        REQUEST_REFUND: 'refunding',
      },
    },
    shipped: {
      on: {
        CONFIRM_DELIVERY: 'completed',
        REQUEST_REFUND: 'refunding',
      },
      after: {
        // 15 天自动确认收货
        1296000000: 'completed',
      },
    },
    completed: {
      type: 'final',
    },
    cancelled: {
      type: 'final',
    },
    refunding: {
      on: {
        APPROVE_REFUND: 'refunded',
        REJECT_REFUND: 'paid',
      },
    },
    refunded: {
      type: 'final',
    },
  },
});
```

### 3.3 Vue 组件集成

```vue
<!-- resources/js/components/OrderStateMachine.vue -->
<template>
  <div class="order-state-machine">
    <!-- 状态标签 -->
    <div class="status-badge" :class="state.value">
      {{ stateLabels[state.value] }}
    </div>

    <!-- 操作按钮（根据当前状态动态显示） -->
    <div class="actions">
      <button
        v-for="action in availableActions"
        :key="action.event"
        @click="send(action.event)"
        :class="action.class"
      >
        {{ action.label }}
      </button>
    </div>

    <!-- 状态流转历史 -->
    <div class="history">
      <div
        v-for="(log, index) in transitionHistory"
        :key="index"
        class="history-item"
      >
        <span class="time">{{ log.time }}</span>
        <span class="arrow">→</span>
        <span class="state">{{ stateLabels[log.to] }}</span>
        <span class="by">by {{ log.triggeredBy }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMachine } from '@xstate/vue';
import { orderMachine } from '../machines/orderMachine';
import { computed } from 'vue';

const props = defineProps<{
  orderId: number;
  initialStatus: string;
  history: Array<{ time: string; to: string; triggeredBy: string }>;
}>();

const { state, send } = useMachine(orderMachine, {
  context: { orderId: props.orderId, status: props.initialStatus },
});

const stateLabels: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
  refunding: '退款中',
  refunded: '已退款',
};

const availableActions = computed(() => {
  const actions: Array<{ event: string; label: string; class: string }> = [];

  switch (state.value.value) {
    case 'pending':
      actions.push({ event: 'PAY', label: '去支付', class: 'btn-primary' });
      actions.push({ event: 'CANCEL', label: '取消订单', class: 'btn-danger' });
      break;
    case 'paid':
      actions.push({ event: 'SHIP', label: '发货', class: 'btn-primary' });
      actions.push({ event: 'CANCEL', label: '取消', class: 'btn-danger' });
      actions.push({ event: 'REQUEST_REFUND', label: '申请退款', class: 'btn-warning' });
      break;
    case 'shipped':
      actions.push({ event: 'CONFIRM_DELIVERY', label: '确认收货', class: 'btn-primary' });
      actions.push({ event: 'REQUEST_REFUND', label: '申请退款', class: 'btn-warning' });
      break;
    case 'refunding':
      actions.push({ event: 'APPROVE_REFUND', label: '同意退款', class: 'btn-success' });
      actions.push({ event: 'REJECT_REFUND', label: '驳回退款', class: 'btn-danger' });
      break;
  }

  return actions;
});
</script>
```

### 3.4 状态图可视化

XState 最大的优势之一是可以自动生成可视化状态图。使用 `@xstate/graph`：

```typescript
import { getSimplePaths } from '@xstate/graph';
import { orderMachine } from './orderMachine';

// 获取所有可能的状态路径
const paths = getSimplePaths(orderMachine);

paths.forEach(path => {
  console.log(
    path.state.map(s => s.value).join(' → '),
    `[${path.steps.map(s => s.event?.type).join(', ')}]`
  );
});
```

输出示例：
```
pending → paid → shipped → completed [PAY, SHIP, CONFIRM_DELIVERY]
pending → paid → refunding → refunded [PAY, REQUEST_REFUND, APPROVE_REFUND]
pending → cancelled [CANCEL]
```

**踩坑 2：XState 的 `after` 在页面关闭后不工作。** 超时自动取消不能依赖前端定时器，必须在后端用 Laravel Queue + Delay 实现。前端只负责展示倒计时。

## 四、并发控制与幂等性

### 4.1 状态转换的并发安全

```php
class OrderStateTransitionService
{
    // 使用悲观锁保证并发安全
    public function transition(int $orderId, string $targetState, string $triggeredBy): Order
    {
        return DB::transaction(function () use ($orderId, $targetState, $triggeredBy) {
            $order = Order::where('id', $orderId)->lockForUpdate()->first();

            if (!$order) {
                throw new OrderNotFoundException();
            }

            // 校验转换合法性
            if (!$order->state->canTransitionTo($targetState)) {
                throw new InvalidStateTransitionException(
                    "不能从 {$order->state} 转换到 {$targetState}"
                );
            }

            // 执行转换
            $order->state->transitionTo($targetState);
            $order->transitioned_by = $triggeredBy;
            $order->save();

            return $order;
        });
    }

    // 带重试的乐观锁方案（高并发场景）
    public function transitionWithRetry(int $orderId, string $targetState): Order
    {
        $maxRetries = 3;

        for ($i = 0; $i < $maxRetries; $i++) {
            try {
                return $this->transition($orderId, $targetState, 'system');
            } catch (QueryException $e) {
                if ($i === $maxRetries - 1) throw $e;
                usleep(random_int(10000, 50000)); // 10-50ms 随机退避
            }
        }

        throw new StateTransitionFailedException();
    }
}
```

**踩坑 3：支付回调并发导致重复扣款。** 支付渠道可能短时间内发送多次回调。解决方案：在 `paid` 状态转换中加入幂等校验——如果已经是 `paid` 则忽略。

```php
public function handlePaymentCallback(PaymentCallback $callback): void
{
    $order = Order::find($callback->orderId);

    // 幂等：已支付直接返回
    if ($order->state->is(Paid::class)) {
        Log::info("Order {$order->id} already paid, skipping");
        return;
    }

    $this->stateTransitionService->transition(
        $order->id,
        Paid::class,
        'payment_callback'
    );
}
```

## 五、与业务事件的集成

### 5.1 事件驱动架构

```php
// app/Listeners/Order/OnOrderPaid.php
class OnOrderPaid
{
    public function handle(OrderPaid $event): void
    {
        $order = $event->order;

        // 分配仓库
        app(WarehouseService::class)->assignWarehouse($order);

        // 通知仓库拣货
        app(PickingService::class)->createPickingTask($order);

        // 更新用户等级积分
        app(UserLevelService::class)->addPoints($order->user_id, $order->total_amount);

        // 发送支付成功通知
        app(NotificationService::class)->sendPaymentConfirmation($order);
    }
}

// app/Listeners/Order/OnOrderCancelled.php
class OnOrderCancelled
{
    public function handle(OrderCancelled $event): void
    {
        $order = $event->order;

        // 通知仓库取消拣货
        if ($order->picking_task) {
            app(PickingService::class)->cancelPickingTask($order->picking_task);
        }

        // 释放优惠券
        if ($order->coupon_usage) {
            app(CouponService::class)->release($order->coupon_usage);
        }

        // 发送取消通知
        app(NotificationService::class)->sendCancellationNotice($order);
    }
}
```

### 5.2 状态机与 Laravel Events 的桥接

```php
// app/States/OrderStates/OrderState.php — 基类增加事件分发
abstract class OrderState extends State
{
    public function transitionTo(string $newState): State
    {
        $oldState = get_class($this);
        $result = parent::transitionTo($newState);

        // 自动分发状态变更事件
        event(new OrderStateChanged(
            $this->model,
            $oldState,
            $newState,
        ));

        return $result;
    }
}
```

## 六、测试策略

```php
// tests/Unit/OrderStateMachineTest.php
class OrderStateMachineTest extends TestCase
{
    /** @test */
    public function pending_can_transition_to_paid(): void
    {
        $order = Order::factory()->create(['state' => Pending::class]);

        $order->state->transitionTo(Paid::class);

        $this->assertTrue($order->fresh()->state->is(Paid::class));
    }

    /** @test */
    public function completed_cannot_transition_to_any_state(): void
    {
        $order = Order::factory()->create(['state' => Completed::class]);

        $this->expectException(InvalidStateTransitionException::class);
        $order->state->transitionTo(Paid::class);
    }

    /** @test */
    public function payment_callback_is_idempotent(): void
    {
        $order = Order::factory()->create(['state' => Pending::class]);

        // 第一次支付
        app(OrderStateTransitionService::class)
            ->transition($order->id, Paid::class, 'callback');
        $this->assertTrue($order->fresh()->state->is(Paid::class));

        // 第二次支付（幂等，不抛异常）
        app(OrderStateTransitionService::class)
            ->transition($order->id, Paid::class, 'callback');
        $this->assertTrue($order->fresh()->state->is(Paid::class));
    }

    /** @test */
    public function concurrent_payment_callbacks_only_one_succeeds(): void
    {
        $order = Order::factory()->create(['state' => Pending::class]);

        // 模拟并发：用两个进程同时支付
        $processes = [];
        for ($i = 0; $i < 2; $i++) {
            $processes[] = Process::fromShellCommandline(
                "php artisan order:pay {$order->id}"
            )->start();
        }

        foreach ($processes as $process) {
            $process->wait();
        }

        $this->assertTrue($order->fresh()->state->is(Paid::class));
        $this->assertCount(1, StateTransitionLog::where('model_id', $order->id)->get());
    }
}
```

## 七、状态机的扩展模式

### 7.1 并行状态（子状态机）

```php
// 物流状态和支付状态可以并行
class Shipped extends OrderState
{
    public function allowedTransitions(): array
    {
        return [Completed::class, Refunding::class];
    }

    // 子状态机：物流追踪
    public function tracking(): TrackingState
    {
        return $this->model->tracking_state;
    }
}

// app/Models/Order.php — 增加物流状态
protected $casts = [
    'state' => OrderState::class,
    'tracking_state' => TrackingState::class, // 并行状态
];
```

### 7.2 守卫条件（Guard）

```php
class Paid extends OrderState
{
    public function canShip(): bool
    {
        $order = $this->model;
        return $order->items->every(fn($item) =>
            app(InventoryService::class)->isAvailable($item->sku_id, $item->quantity)
        );
    }

    // 带守卫的转换
    public function tryShip(): ?Shipped
    {
        if (!$this->canShip()) {
            throw new InsufficientStockException();
        }
        return $this->transitionTo(Shipped::class);
    }
}
```

## 总结

引入状态机模式带来的收益：

1. **代码可读性**：所有状态转换规则集中在状态类中，一目了然
2. **编译期安全**：非法转换在启动期就能发现，不会到运行时才报错
3. **业务对齐**：产品经理可以直接看状态图理解系统行为
4. **测试友好**：每个状态转换独立可测
5. **前后端一致**：后端 Laravel States + 前端 XState 保证状态逻辑一致

## 相关阅读

- [PCI DSS 合规实战：支付系统安全标准落地——Laravel 应用中的 Token 化、审计日志与网络分段](/06_运维/2026-06-02-PCI-DSS-合规实战-支付系统安全标准落地-Laravel-Token化-审计日志与网络分段/)
- [Tech Lead 实战：从 Senior Engineer 到 Tech Lead 的角色跃迁](/00_架构/Tech-Lead-实战-从Senior-Engineer到Tech-Lead角色跃迁/)
- [Laravel Redis 分布式锁失效场景实战](/databases/laravel-redis-distributedlockguide/)
- [工程效能度量实战：DORA 四大指标在 Laravel 团队中的落地](/07_CICD/工程效能度量实战-DORA四大指标-Laravel团队落地/)

但也要注意不要过度设计——简单的 CRUD 应用不需要状态机。当你的 `if-else` 超过 3 层嵌套、状态超过 5 种时，才是引入状态机的时机。
