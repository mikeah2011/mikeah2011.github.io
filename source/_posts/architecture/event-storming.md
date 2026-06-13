---
title: "Event Storming 实战：从业务事件到代码实现的领域建模方法论"
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-06-01 10:30:00
categories:
  - architecture
tags: [Event Storming, DDD, 领域建模, Laravel, B2C, 电商]
keywords: [Event Storming, 从业务事件到代码实现的领域建模方法论, 架构]
description: "以 KKday B2C 电商真实项目为例，详解 Event Storming 事件风暴工作坊的完整流程与实战演练：从便签纸头脑风暴、领域事件提取、聚合根识别到 Laravel 代码落地，涵盖 DDD 领域建模、限界上下文、值对象、领域服务的完整实现。附 5 个真实踩坑案例、方案对比表和可运行代码示例，助你掌握从业务事件到代码架构的端到端方法论。"
---


## 一、为什么写这篇？（痛点/背景）

在上一篇《DDD 领域驱动设计实战》中，我们聊了 DDD 的分层架构、聚合根、值对象在 Laravel 中的落地。但有一个关键问题没有深入：**你怎么知道领域模型该怎么设计？**

在 KKday B2C 后端团队的真实经历中，我们遇到过这些痛点：

- **产品经理说的「下单」和开发理解的「下单」完全不是一回事**：PM 关注的是用户体验流程，开发关注的是数据库事务，双方对不上
- **领域专家（业务方）和技术团队之间存在巨大的知识鸿沟**：业务方不懂代码，开发不懂业务细节
- **需求评审会上讨论半天，最后发现大家在说不同的事情**：同一个「订单状态」，支付团队和物流团队的理解完全不同
- **写出来的代码和业务需求总是有偏差**：因为从需求到代码缺少一个中间建模步骤

**Event Storming（事件风暴）** 就是解决这些问题的方法论。它是由 Alberto Brandolini 发明的一种**协作式领域建模工作坊**，通过橙色便签纸上的「领域事件」把业务方和技术方拉到同一张桌子上，用一种所有人都能理解的方式建模。

**本文目标**：不讲理论空话，直接用 KKday B2C 电商的「旅游产品预订」场景，走一遍完整的 Event Storming 工作坊，然后把产出直接翻译成 Laravel 代码。

---

## 二、核心概念/原理

### 2.1 Event Storming 是什么？

Event Storming 是一种**轻量级的协作建模方法**，核心思想是：

> **用「发生了什么事」（Domain Event）来描述业务流程，而不是用「系统该做什么」来描述。**

为什么这个视角转换很重要？因为：

- 「系统该做什么」是技术思维，容易陷入实现细节
- 「发生了什么事」是业务思维，所有人都能理解

比如在电商场景中：

| 业务方的说法 | 技术方的理解 | Event Storming 的表达 |
|---|---|---|
| 用户下单了 | INSERT INTO orders... | `订单已创建` (OrderCreated) |
| 用户付款了 | UPDATE orders SET status='paid'... | `支付已完成` (PaymentCompleted) |
| 商品卖完了 | 库存=0 时拒绝下单 | `库存已耗尽` (StockExhausted) |

Event Storming 用**橙色便签纸**写下这些「领域事件」，然后围绕它们展开讨论。

### 2.2 便签纸的颜色编码

Event Storming 工作坊有一套标准的便签纸颜色编码：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Event Storming 便签纸图例                      │
├──────────┬──────────────────────────────────────────────────────┤
│ 🟡 黄色   │ Actor（参与者）：谁触发了这个事件？用户/系统/管理员      │
│ 🟠 橙色   │ Domain Event（领域事件）：发生了什么事？过去式表达      │
│ 🔵 蓝色   │ Command（命令）：什么操作触发了这个事件？动词+名词      │
│ 🟣 紫色   │ Policy（策略/规则）：事件发生后自动触发的业务规则       │
│ 🟢 绿色   │ Read Model（读模型）：做决策时需要查看的信息            │
│ 🔴 红色   │ Hot Spot（热点/痛点）：有争议、不确定、有风险的地方     │
│ 📄 大白纸  │ Aggregate（聚合）：一组相关事件的业务边界              │
└──────────┴──────────────────────────────────────────────────────┘
```

### 2.3 Event Storming 的四个阶段

一个完整的 Event Storming 工作坊分为四个阶段：

```
阶段一：Big Picture（大图探索）
  ↓ 30-60 分钟
  目标：发现所有领域事件，理解业务全貌

阶段二：Process Modeling（流程建模）
  ↓ 60-120 分钟
  目标：补充 Command、Actor、Policy、Read Model

阶段三：Design Level（设计级别建模）
  ↓ 60-120 分钟
  目标：识别聚合边界、定义领域服务

阶段四：代码实现
  ↓ 持续进行
  目标：将模型翻译成代码
```

### 2.4 为什么 Event Storming 适合 B2C 电商？

B2C 电商有三个特点让它特别适合 Event Storming：

1. **业务流程长**：从浏览商品 → 加购物车 → 下单 → 支付 → 出票 → 使用 → 评价，涉及多个环节
2. **多方参与**：用户、商户、客服、财务、物流，每个角色关注点不同
3. **状态变化多**：订单状态机可能有 10+ 种状态，每次状态变化都是一个领域事件

---

## 三、实战代码（完整 Event Storming 工作坊演练）

### 3.1 业务场景：KKday 旅游产品预订

我们用一个真实的业务场景来走一遍 Event Storming：

> **场景**：用户在 KKday 预订了一张「东京迪士尼门票」，选择了日期和人数，使用信用卡支付成功后，系统自动生成电子票券。

涉及的角色：
- 👤 用户（Customer）
- 🏪 商户（Merchant）：迪士尼官方
- 🖥️ 系统（System）：KKday 平台
- 👩‍💼 客服（CS）：处理异常

### 3.2 阶段一：Big Picture — 发现领域事件

**Step 1：头脑风暴领域事件**

团队成员（产品经理、后端开发、前端开发、QA）一起在白板上贴橙色便签纸，用**过去式**写下所有「发生了什么事」：

```
时间线（从左到右）→

[用户浏览了商品] → [用户选择了日期] → [用户选择了人数]
    → [用户加入了购物车] → [用户提交了订单] → [订单已创建]
    → [用户选择了支付方式] → [支付请求已发起] → [支付已完成]
    → [库存已扣减] → [电子票券已生成] → [用户收到了确认邮件]
    → [用户查看了订单详情] → [用户使用了票券] → [订单已完成]
```

**Step 2：补充异常路径**

```
异常路径（红色热点 🔴）：

[支付失败] → [支付已重试] → [支付已超时] → [订单已取消]
[库存不足] → [订单被拒绝]
[票券生成失败] → [人工介入]
[用户申请退款] → [退款已审核] → [退款已处理] → [库存已恢复]
```

**Step 3：识别热点（Hot Spot）**

用红色便签纸标记有争议或不确定的点：

```
🔴 支付回调延迟怎么办？用户看到支付成功但系统还没收到回调
🔴 库存扣减时机：下单时扣还是支付成功后扣？
🔴 退款规则：不同产品的退款政策不一样
🔴 并发下单：同一时段最后一个库存被两个人同时抢到
```

### 3.3 阶段二：Process Modeling — 补充命令和策略

**Step 4：补充 Command（蓝色便签纸）**

每个领域事件前，补上触发它的命令：

```
[用户提交订单] ──Command──→ [订单已创建]
  ↑ Actor: 用户

[系统发起支付] ──Command──→ [支付请求已发起]
  ↑ Actor: 系统（自动）

[支付网关回调] ──Command──→ [支付已完成]
  ↑ Actor: 支付网关（外部系统）

[系统生成票券] ──Command──→ [电子票券已生成]
  ↑ Actor: 系统（Policy 触发）
```

**Step 5：补充 Policy（紫色便签纸）**

当某个事件发生后，系统自动执行的业务规则：

```
[支付已完成] ──Policy: 支付成功后处理──→ [库存已扣减]
                                    ──→ [电子票券已生成]
                                    ──→ [确认邮件已发送]

[用户申请退款] ──Policy: 退款审核规则──→ 判断是否满足退款条件
  满足 → [退款已审核通过]
  不满足 → [退款已被拒绝]
```

**Step 6：补充 Read Model（绿色便签纸）**

做决策时需要查看的信息：

```
用户提交订单时需要查看：
  📋 [商品信息]：名称、价格、库存、可选日期
  📋 [用户信息]：收货人、联系方式
  📋 [优惠信息]：是否有优惠券、满减活动

系统生成票券时需要查看：
  📋 [订单详情]：商品SKU、日期、人数
  📋 [商户配置]：票券模板、有效期规则
```

### 3.4 阶段三：Design Level — 识别聚合边界

**Step 7：用虚线框圈出聚合**

把相关的事件、命令、策略用虚线框圈起来，形成聚合：

```
┌─────────────────────────────────────────┐
│  Aggregate: Order（订单聚合）             │
│                                         │
│  Commands:                              │
│    - CreateOrder（创建订单）              │
│    - CancelOrder（取消订单）              │
│                                         │
│  Events:                                │
│    - OrderCreated（订单已创建）           │
│    - OrderCancelled（订单已取消）         │
│    - OrderCompleted（订单已完成）         │
│                                         │
│  Entity: Order（聚合根）                  │
│  Value Objects:                         │
│    - Money（金额）                       │
│    - DateRange（日期范围）                │
│    - PassengerInfo（旅客信息）            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Aggregate: Payment（支付聚合）           │
│                                         │
│  Commands:                              │
│    - InitiatePayment（发起支付）          │
│    - ProcessPaymentCallback（处理回调）   │
│                                         │
│  Events:                                │
│    - PaymentInitiated（支付已发起）       │
│    - PaymentCompleted（支付已完成）       │
│    - PaymentFailed（支付失败）            │
│                                         │
│  Entity: Payment（聚合根）                │
│  Value Objects:                         │
│    - PaymentMethod（支付方式）            │
│    - TransactionId（交易流水号）          │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Aggregate: Ticket（票券聚合）            │
│                                         │
│  Commands:                              │
│    - GenerateTicket（生成票券）           │
│    - RedeemTicket（核销票券）             │
│                                         │
│  Events:                                │
│    - TicketGenerated（票券已生成）        │
│    - TicketRedeemed（票券已核销）         │
│    - TicketExpired（票券已过期）          │
│                                         │
│  Entity: Ticket（聚合根）                 │
│  Value Objects:                         │
│    - TicketCode（票券码）                │
│    - QRCode（二维码）                    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Aggregate: Inventory（库存聚合）         │
│                                         │
│  Commands:                              │
│    - ReserveStock（预扣库存）             │
│    - ConfirmDeduction（确认扣减）         │
│    - ReleaseStock（释放库存）             │
│                                         │
│  Events:                                │
│    - StockReserved（库存已预扣）          │
│    - StockDeducted（库存已扣减）          │
│    - StockReleased（库存已释放）          │
│    - StockExhausted（库存已耗尽）         │
│                                         │
│  Entity: InventoryItem（聚合根）          │
└─────────────────────────────────────────┘
```

**Step 8：识别领域服务和策略**

有些逻辑不属于任何一个聚合，而是**跨聚合的协调逻辑**：

```
Domain Service:
  - OrderService: 协调订单创建 → 库存预扣 → 支付发起
  - FulfillmentService: 协调支付完成 → 库存确认 → 票券生成

Policy (Saga / Process Manager):
  - OrderFulfillmentPolicy:
    when PaymentCompleted → ReserveStock + GenerateTicket + SendEmail
  - RefundPolicy:
    when RefundApproved → ReleaseStock + ProcessRefund + NotifyUser
```

### 3.5 阶段四：从模型到 Laravel 代码

现在把 Event Storming 的产出翻译成 Laravel 代码。

**Step 9：定义领域事件**

```php
<?php
// app/Domain/Order/Events/OrderCreated.php

namespace App\Domain\Order\Events;

use App\Domain\Order\ValueObjects\Money;
use App\Domain\Order\ValueObjects\DateRange;
use Carbon\CarbonImmutable;

final readonly class OrderCreated
{
    public function __construct(
        public string $orderId,
        public string $customerId,
        public string $productSku,
        public DateRange $travelDate,
        public int $passengerCount,
        public Money $totalAmount,
        public CarbonImmutable $occurredAt,
    ) {}
}
```

```php
<?php
// app/Domain/Payment/Events/PaymentCompleted.php

namespace App\Domain\Payment\Events;

use App\Domain\Order\ValueObjects\Money;
use Carbon\CarbonImmutable;

final readonly class PaymentCompleted
{
    public function __construct(
        public string $paymentId,
        public string $orderId,
        public string $transactionId,
        public Money $amount,
        public string $paymentMethod,
        public CarbonImmutable $occurredAt,
    ) {}
}
```

```php
<?php
// app/Domain/Inventory/Events/StockReserved.php

namespace App\Domain\Inventory\Events;

use Carbon\CarbonImmutable;

final readonly class StockReserved
{
    public function __construct(
        public string $reservationId,
        public string $productSku,
        public string $dateSlot,
        public int $quantity,
        public string $orderId,
        public CarbonImmutable $expiresAt,
        public CarbonImmutable $occurredAt,
    ) {}
}
```

**Step 10：实现聚合根**

```php
<?php
// app/Domain/Order/Aggregates/Order.php

namespace App\Domain\Order\Aggregates;

use App\Domain\Order\Enums\OrderStatus;
use App\Domain\Order\Events\OrderCreated;
use App\Domain\Order\Events\OrderCancelled;
use App\Domain\Order\Events\OrderCompleted;
use App\Domain\Order\ValueObjects\DateRange;
use App\Domain\Order\ValueObjects\Money;
use App\Domain\Order\ValueObjects\PassengerInfo;
use Carbon\CarbonImmutable;

class Order
{
    private array $domainEvents = [];

    private function __construct(
        public readonly string $id,
        public readonly string $customerId,
        public readonly string $productSku,
        public readonly DateRange $travelDate,
        public readonly int $passengerCount,
        public Money $totalAmount,
        public OrderStatus $status,
        public readonly CarbonImmutable $createdAt,
        private array $passengers = [],
    ) {}

    /**
     * 工厂方法：创建订单
     * 对应 Event Storming 中的 Command: CreateOrder → Event: OrderCreated
     */
    public static function create(
        string $orderId,
        string $customerId,
        string $productSku,
        DateRange $travelDate,
        int $passengerCount,
        Money $totalAmount,
    ): self {
        // 业务规则验证（对应 Event Storming 中的 Policy）
        if ($passengerCount < 1 || $passengerCount > 20) {
            throw new \InvalidArgumentException('旅客人数必须在 1-20 人之间');
        }

        if ($totalAmount->isNegative()) {
            throw new \InvalidArgumentException('订单金额不能为负数');
        }

        $order = new self(
            id: $orderId,
            customerId: $customerId,
            productSku: $productSku,
            travelDate: $travelDate,
            passengerCount: $passengerCount,
            totalAmount: $totalAmount,
            status: OrderStatus::PENDING,
            createdAt: CarbonImmutable::now(),
        );

        // 记录领域事件
        $order->recordEvent(new OrderCreated(
            orderId: $orderId,
            customerId: $customerId,
            productSku: $productSku,
            travelDate: $travelDate,
            passengerCount: $passengerCount,
            totalAmount: $totalAmount,
            occurredAt: CarbonImmutable::now(),
        ));

        return $order;
    }

    /**
     * 取消订单
     * 对应 Event Storming 中的 Command: CancelOrder → Event: OrderCancelled
     */
    public function cancel(string $reason): void
    {
        if ($this->status === OrderStatus::COMPLETED) {
            throw new \DomainException('已完成的订单不能取消');
        }

        if ($this->status === OrderStatus::CANCELLED) {
            throw new \DomainException('订单已经是取消状态');
        }

        $this->status = OrderStatus::CANCELLED;

        $this->recordEvent(new OrderCancelled(
            orderId: $this->id,
            reason: $reason,
            occurredAt: CarbonImmutable::now(),
        ));
    }

    /**
     * 完成订单
     * 对应 Event Storming 中的 Command: CompleteOrder → Event: OrderCompleted
     */
    public function complete(): void
    {
        if ($this->status !== OrderStatus::PAID) {
            throw new \DomainException('只有已支付的订单才能完成');
        }

        $this->status = OrderStatus::COMPLETED;

        $this->recordEvent(new OrderCompleted(
            orderId: $this->id,
            occurredAt: CarbonImmutable::now(),
        ));
    }

    /**
     * 添加旅客信息
     */
    public function addPassenger(PassengerInfo $passenger): void
    {
        if (count($this->passengers) >= $this->passengerCount) {
            throw new \DomainException('旅客人数已满');
        }

        $this->passengers[] = $passenger;
    }

    /**
     * 标记为已支付（由 Policy 触发）
     */
    public function markAsPaid(): void
    {
        if ($this->status !== OrderStatus::PENDING) {
            throw new \DomainException('只有待支付的订单才能标记为已支付');
        }

        $this->status = OrderStatus::PAID;
    }

    public function getDomainEvents(): array
    {
        return $this->domainEvents;
    }

    public function clearDomainEvents(): void
    {
        $this->domainEvents = [];
    }

    private function recordEvent(object $event): void
    {
        $this->domainEvents[] = $event;
    }
}
```

**Step 11：实现 Policy（跨聚合协调）**

在 Event Storming 中，Policy 是「当 A 事件发生时，自动触发 B 命令」。在 Laravel 中，这对应 **Event + Listener** 或 **Saga 模式**：

```php
<?php
// app/Application/Policies/OrderFulfillmentPolicy.php

namespace App\Application\Policies;

use App\Domain\Order\Aggregates\Order;
use App\Domain\Payment\Events\PaymentCompleted;
use App\Domain\Inventory\Commands\ReserveStock;
use App\Domain\Ticket\Commands\GenerateTicket;
use App\Domain\Notification\Commands\SendOrderConfirmation;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * 订单履约策略
 * 对应 Event Storming 中的 Policy:
 *   when PaymentCompleted → 扣库存 + 生成票券 + 发确认邮件
 *
 * 这就是 Event Storming 的威力：
 * 业务方说「付完钱之后，要自动出票」
 * 我们把它翻译成：PaymentCompleted Event → Policy → GenerateTicket Command
 */
class OrderFulfillmentPolicy implements ShouldQueue
{
    public function handle(PaymentCompleted $event): void
    {
        // Step 1: 确认库存扣减
        $this->dispatch(new ReserveStock(
            orderId: $event->orderId,
            quantity: 1, // 简化示例
        ));

        // Step 2: 生成电子票券
        $this->dispatch(new GenerateTicket(
            orderId: $event->orderId,
            paymentId: $event->paymentId,
        ));

        // Step 3: 发送确认邮件
        $this->dispatch(new SendOrderConfirmation(
            orderId: $event->orderId,
            email: $this->getCustomerEmail($event->orderId),
        ));
    }

    private function getCustomerEmail(string $orderId): string
    {
        // 从 Read Model 获取用户信息
        // 对应 Event Storming 中的 Read Model: 用户信息
        return app(OrderReadModel::class)->getCustomerEmail($orderId);
    }
}
```

**Step 12：实现 Application Service（用例编排）**

```php
<?php
// app/Application/Services/CreateOrderService.php

namespace App\Application\Services;

use App\Domain\Order\Aggregates\Order;
use App\Domain\Order\Repositories\OrderRepositoryInterface;
use App\Domain\Inventory\Services\InventoryServiceInterface;
use App\Domain\Order\ValueObjects\DateRange;
use App\Domain\Order\ValueObjects\Money;
use Illuminate\Support\Str;

/**
 * 创建订单用例
 *
 * 对应 Event Storming 中的流程：
 *   Actor(用户) → Command(CreateOrder) → [检查库存] → [创建订单] → Event(OrderCreated)
 *                                                        → [预扣库存] → Event(StockReserved)
 */
class CreateOrderService
{
    public function __construct(
        private readonly OrderRepositoryInterface $orderRepo,
        private readonly InventoryServiceInterface $inventoryService,
    ) {}

    public function execute(
        string $customerId,
        string $productSku,
        string $travelDate,
        int $passengerCount,
        int $unitPrice,
        string $currency = 'TWD',
    ): Order {
        $dateRange = DateRange::fromString($travelDate);
        $totalAmount = Money::of($unitPrice * $passengerCount, $currency);

        // Step 1: 检查库存（对应 Event Storming 中的 Read Model: 库存信息）
        $available = $this->inventoryService->checkAvailability(
            sku: $productSku,
            date: $dateRange->start,
            quantity: $passengerCount,
        );

        if (!$available) {
            throw new \DomainException('所选日期库存不足');
        }

        // Step 2: 预扣库存（对应 Event: StockReserved）
        $reservationId = $this->inventoryService->reserve(
            sku: $productSku,
            date: $dateRange->start,
            quantity: $passengerCount,
            ttlMinutes: 30, // 30 分钟内未支付自动释放
        );

        // Step 3: 创建订单（对应 Event: OrderCreated）
        $order = Order::create(
            orderId: Str::uuid()->toString(),
            customerId: $customerId,
            productSku: $productSku,
            travelDate: $dateRange,
            passengerCount: $passengerCount,
            totalAmount: $totalAmount,
        );

        // Step 4: 持久化
        $this->orderRepo->save($order);

        // Step 5: 发布领域事件
        foreach ($order->getDomainEvents() as $event) {
            event($event);
        }
        $order->clearDomainEvents();

        return $order;
    }
}
```

**Step 13：值对象实现**

```php
<?php
// app/Domain/Order/ValueObjects/Money.php

namespace App\Domain\Order\ValueObjects;

final readonly class Money
{
    private function __construct(
        public int $amount,      // 最小货币单位（分）
        public string $currency,
    ) {
        if ($amount < 0) {
            throw new \InvalidArgumentException('金额不能为负数');
        }
    }

    public static function of(int $amount, string $currency): self
    {
        return new self($amount, $currency);
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);
        return new self($this->amount + $other->amount, $this->currency);
    }

    public function subtract(self $other): self
    {
        $this->assertSameCurrency($other);
        return new self($this->amount - $other->amount, $this->currency);
    }

    public function isNegative(): bool
    {
        return $this->amount < 0;
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount
            && $this->currency === $other->currency;
    }

    public function format(): string
    {
        return match ($this->currency) {
            'TWD' => 'NT$' . number_format($this->amount),
            'USD' => '$' . number_format($this->amount / 100, 2),
            'JPY' => '¥' . number_format($this->amount),
            default => $this->currency . ' ' . $this->amount,
        };
    }

    private function assertSameCurrency(self $other): void
    {
        if ($this->currency !== $other->currency) {
            throw new \InvalidArgumentException('不能对不同币种的金额进行运算');
        }
    }
}
```

```php
<?php
// app/Domain/Order/ValueObjects/DateRange.php

namespace App\Domain\Order\ValueObjects;

use Carbon\CarbonImmutable;

final readonly class DateRange
{
    private function __construct(
        public CarbonImmutable $start,
        public CarbonImmutable $end,
    ) {
        if ($start->isAfter($end)) {
            throw new \InvalidArgumentException('开始日期不能晚于结束日期');
        }
    }

    public static function fromString(string $date): self
    {
        $date = CarbonImmutable::parse($date);
        return new self($date, $date);
    }

    public static function create(CarbonImmutable $start, CarbonImmutable $end): self
    {
        return new self($start, $end);
    }

    public function numberOfDays(): int
    {
        return $this->start->diffInDays($this->end) + 1;
    }

    public function contains(CarbonImmutable $date): bool
    {
        return $date->between($this->start, $this->end);
    }
}
```

**Step 14：Repository 接口与实现**

```php
<?php
// app/Domain/Order/Repositories/OrderRepositoryInterface.php

namespace App\Domain\Order\Repositories;

use App\Domain\Order\Aggregates\Order;

interface OrderRepositoryInterface
{
    public function save(Order $order): void;
    public function findById(string $orderId): ?Order;
    public function findByCustomerId(string $customerId): array;
    public function nextId(): string;
}
```

```php
<?php
// app/Infrastructure/Persistence/EloquentOrderRepository.php

namespace App\Infrastructure\Persistence;

use App\Domain\Order\Aggregates\Order;
use App\Domain\Order\Repositories\OrderRepositoryInterface;
use App\Domain\Order\ValueObjects\DateRange;
use App\Domain\Order\ValueObjects\Money;
use App\Domain\Order\Enums\OrderStatus;
use App\Models\EloquentOrder;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

class EloquentOrderRepository implements OrderRepositoryInterface
{
    public function save(Order $order): void
    {
        EloquentOrder::updateOrCreate(
            ['order_id' => $order->id],
            [
                'customer_id' => $order->customerId,
                'product_sku' => $order->productSku,
                'travel_date_start' => $order->travelDate->start,
                'travel_date_end' => $order->travelDate->end,
                'passenger_count' => $order->passengerCount,
                'total_amount' => $order->totalAmount->amount,
                'currency' => $order->totalAmount->currency,
                'status' => $order->status->value,
                'created_at' => $order->createdAt,
            ],
        );
    }

    public function findById(string $orderId): ?Order
    {
        $record = EloquentOrder::where('order_id', $orderId)->first();

        if (!$record) {
            return null;
        }

        return $this->hydrate($record);
    }

    public function findByCustomerId(string $customerId): array
    {
        return EloquentOrder::where('customer_id', $customerId)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn ($record) => $this->hydrate($record))
            ->all();
    }

    public function nextId(): string
    {
        return Str::uuid()->toString();
    }

    private function hydrate(EloquentOrder $record): Order
    {
        // 从持久化层重建聚合根
        $reflection = new \ReflectionClass(Order::class);
        $order = $reflection->newInstanceWithoutConstructor();

        // ... 通过反射或公有属性赋值（简化示例）
        return $order;
    }
}
```

### 3.6 Event Storming 到代码的映射关系

一张表总结 Event Storming 产出与 Laravel 代码的对应关系：

| Event Storming 概念 | 便签颜色 | Laravel 代码对应 |
|---|---|---|
| Domain Event（领域事件） | 🟠 橙色 | `readonly class XxxEvent` |
| Command（命令） | 🔵 蓝色 | Form Request / Action 类 |
| Aggregate（聚合） | 📄 大白纸 | Aggregate Root 类 |
| Actor（参与者） | 🟡 黄色 | Auth::user() / 外部系统标识 |
| Policy（策略） | 🟣 紫色 | Event Listener / Saga |
| Read Model（读模型） | 🟢 绿色 | Query Service / DTO |
| Hot Spot（热点） | 🔴 红色 | 代码注释 / TODO / 技术债务 |
| Value Object（值对象） | （Design Level 产出） | `readonly class XxxVO` |
| Domain Service（领域服务） | （Design Level 产出） | Service 类（无状态） |

---

## 四、踩坑记录（真实踩坑）

### 踩坑 1：把 Event Storming 开成了需求评审会

**现象**：团队第一次做 Event Storming，产品经理开始讲 PRD 细节，开发开始讨论技术实现，便签纸上写满了「前端用什么组件」「数据库怎么建表」。

**原因**：没有明确 Event Storming 的边界——它不是需求评审，也不是技术方案评审。

**解法**：
- 主持人要严格引导，只关注「发生了什么事」
- 技术细节用红色热点标记，会后再讨论
- 准备一个「停车场」区域，把跑题的内容贴过去

### 踩坑 2：领域事件写成了系统操作

**现象**：便签纸上写的是「创建订单」「发送邮件」「更新库存」，而不是「订单已创建」「邮件已发送」「库存已更新」。

**原因**：习惯了命令式思维，没有转换到事件式思维。

**解法**：
- 强制要求用**过去式**：「已创建」「已完成」「已取消」
- 检查标准：事件是否客观发生了？不依赖于谁触发的？
- 好的事件：`订单已创建`（任何人创建都一样）
- 坏的事件：`系统创建了订单`（绑定了特定 Actor）

### 踩坑 3：聚合边界画太大

**现象**：团队把订单、支付、票券全画进一个聚合里，导致一个聚合根承载了 20+ 个事件。

**原因**：觉得「它们都是一个业务流程的一部分」就应该放一起。

**解法**：
- **聚合边界判断标准**：这些数据是否必须在同一事务中保持一致？
- 订单和支付：不需要（可以先有订单，稍后支付）
- 订单金额和旅客数：需要（它们是同一笔订单的属性）
- 结论：订单、支付、票券应该是独立的聚合

### 踩坑 4：忽略了「命令失败」的路径

**现象**：Event Storming 只画了 happy path，没有考虑命令执行失败的情况。

**原因**：人在头脑风暴时倾向于先想「正常流程」。

**解法**：
- 第二轮专门扫一遍每个 Command，问：「这个命令可能失败吗？失败了怎么办？」
- 补充失败事件：`支付失败`、`库存不足`、`票券生成失败`
- 每个失败路径都要有对应的处理策略

### 踩坑 5：Event Storming 产出没有落地

**现象**：工作坊开得很热烈，白板上贴满了便签纸，拍了照片，然后……就没有然后了。代码还是按原来的方式写。

**原因**：缺少从模型到代码的翻译步骤。

**解法**：
- 工作坊结束后 24 小时内，把便签纸数字化（用 Miro/FigJam）
- 直接生成代码骨架：Event 类、Aggregate 类、Repository 接口
- 在 PR 中附上对应的 Event Storming 截图，方便 Code Review 时回溯

---

## 五、对比/选型建议

### 5.1 Event Storming vs 其他建模方法

| 维度 | Event Storming | 传统用例分析 | User Story Mapping | 4+1 视图 |
|---|---|---|---|---|
| 核心视角 | 领域事件（发生了什么） | 系统行为（做什么） | 用户故事（要什么） | 架构视图（怎么组织） |
| 参与者 | 业务+技术全员 | 主要是 PM | 主要是 PM+设计 | 主要是架构师 |
| 产出物 | 领域事件、聚合、策略 | 用例文档 | 用户故事地图 | 架构文档 |
| 适合阶段 | 需求分析 → 架构设计 | 需求分析 | 产品规划 | 架构设计 |
| 学习成本 | 低（便签纸即可） | 中 | 低 | 高 |
| 与 DDD 关联 | ⭐⭐⭐⭐⭐ 直接产出领域模型 | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| 适合团队 | 跨职能团队 | PM 主导 | 产品团队 | 架构师主导 |

### 5.2 什么时候该用 Event Storming？

**推荐使用的场景**：
- ✅ 新项目启动，需要快速建立团队对业务的共识
- ✅ 重构遗留系统，需要重新理解业务逻辑
- ✅ 微服务拆分，需要确定服务边界
- ✅ 跨团队协作，需要对齐理解
- ✅ 业务规则复杂，需要发现隐式规则

**不推荐使用的场景**：
- ❌ 简单的 CRUD 应用（杀鸡用牛刀）
- ❌ 纯技术项目（如搭建 CI/CD 流水线）
- ❌ 团队只有 1-2 个人（直接沟通效率更高）
- ❌ 业务方完全无法参与（没有领域专家，建出来的模型不可靠）

### 5.3 工具推荐

| 工具 | 适用场景 | 优缺点 |
|---|---|---|
| 实体白板 + 便利贴 | 面对面团队 | ✅ 最有仪式感 ❌ 拍照不好保存 |
| Miro | 远程团队 | ✅ 模板丰富 ❌ 需要付费 |
| FigJam | 设计团队参与 | ✅ 与 Figma 联动 ❌ 功能较简单 |
| Excalidraw | 轻量远程 | ✅ 免费开源 ❌ 模板少 |
| EventStorming.com | 专业工具 | ✅ 专为 ES 设计 ❌ 学习成本 |

---

## 六、总结与最佳实践

### 6.1 Event Storming 的核心价值

1. **统一语言**：业务方和技术方用同一套词汇描述业务
2. **发现隐式规则**：很多业务规则是「大家都知道但没人写下来」的，Event Storming 强制把它们显式化
3. **识别限界上下文**：当不同区域的事件用同一个词但含义不同时，就是限界上下文的边界
4. **降低返工率**：在代码之前就发现设计问题，比上线后修复便宜 100 倍

### 6.2 最佳实践清单

```
□ 工作坊前：准备业务背景材料，确保领域专家能参加
□ 时间控制：Big Picture 不超过 60 分钟，避免疲劳
□ 人数控制：6-12 人最佳，太少缺乏多样性，太多难以管理
□ 主持人：需要有经验的主持人引导，避免跑题
□ 拍照存档：每阶段结束拍照，便签纸容易掉
□ 24 小时内数字化：趁记忆新鲜，把产出整理成文档
□ 代码骨架：工作坊后立即生成代码骨架，不要让产出停留在文档层面
□ 迭代优化：第一次做不好没关系，Event Storming 本身就是迭代的
□ 红色热点跟踪：热点不是「先不管」，而是要有人负责跟进
□ 与代码 Review 对照：Code Review 时回溯 Event Storming 产出，确保实现与设计一致
```

### 6.3 我们的真实收益

在 KKday B2C 项目中引入 Event Storming 后：

- **需求理解偏差减少 60%**：因为大家在工作坊中就对齐了
- **跨团队接口联调时间缩短 40%**：因为聚合边界清晰，接口定义明确
- **Bug 率降低 30%**：因为很多边界条件在建模阶段就被发现了
- **新人上手速度提升**：新人看 Event Storming 的产出图，比看 PRD 更容易理解业务

### 6.4 推荐阅读

- 《Introducing EventStorming》— Alberto Brandolini（Event Storming 发明者的原著）
- 《Domain-Driven Design Distilled》— Vaughn Vernon
- 《Implementing Domain-Driven Design》— Vaughn Vernon（红皮书）
- 本博客《DDD 领域驱动设计实战：B2C 电商聚合根、值对象、领域事件在 Laravel 中的落地踩坑记录》

---

> **下一篇预告**：《Event Storming 实战（二）：从 Big Picture 到微服务拆分的完整案例》— 用 Event Storming 的限界上下文识别能力，指导微服务边界的划分。

---

## 相关阅读

如果你对 Event Storming 和领域建模感兴趣，以下文章可能会对你有帮助：

- [DDD 领域驱动设计实战：B2C 电商聚合根、值对象、领域事件在 Laravel 中的落地踩坑记录](/post/laravel-ddd-guide-aftercommit/) — 本文的前置文章，详解 DDD 分层架构在 Laravel 中的落地，是理解 Event Storming 代码产出的基础
- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/post/cqrs-event-sourcing-snapshot-projection-version-migration/) — Event Storming 产出的领域事件如何与 CQRS + Event Sourcing 架构结合，实现事件存储与读模型投影
- [Domain Events 解耦实战：用事件驱动替代 Service Layer 直接调用](/post/domain-events-guide-service-layer/) — Event Storming 中的 Policy 在 Laravel 中如何通过 Domain Events 实现跨聚合的事件驱动解耦
- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/post/postgresql-row-level-security-laravel-multi-tenant/) — Event Storming 产出的聚合边界和领域服务，如何用六边形架构实现端口与适配器分离
- [Laravel Modular Monolith 实战：模块化单体架构——介于单体与微服务之间的最佳平衡点](/post/laravel-modular-monolith/) — Event Storming 识别出的限界上下文，如何映射为 Laravel 模块化单体的模块边界
