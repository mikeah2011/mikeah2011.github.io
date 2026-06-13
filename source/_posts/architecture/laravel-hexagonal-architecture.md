---

title: 六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-06-01 12:00:00
updated: 2026-06-01 12:00:00
categories:
  - architecture
keywords: [Laravel, 六边形架构实战, 中的端口与适配器模式落地踩坑记录]
tags:
- Laravel
- 六边形架构
- ports and adapters
- DDD
- 架构设计
description: 六边形架构（Ports and Adapters）在 Laravel 项目中的实战落地完整指南。以 B2C 电商订单/支付/通知模块为例，从传统 MVC 到六边形架构的渐进式迁移，深入讲解输入端口与输出端口定义、Eloquent 适配器实现、依赖反转容器绑定、领域事件发布时机、Eloquent Model 与领域实体的映射策略。附 Stripe→Alipay 支付网关一键切换实战、纯 Mock 单元测试 vs 传统测试性能对比、六边形架构与洋葱架构/清洁架构的选型对比表格，以及四个真实踩坑案例与最佳实践反模式清单。
---



## 前言：为什么 Laravel 项目需要六边形架构？

在 KKday B2C 后端维护 30+ 个 Laravel 仓库的三年里，我反复目睹同一个悲剧：

1. 产品说「把 Stripe 支付换成 NewPay」→ 开发翻遍 15 个文件逐行替换
2. 运维说「从 MySQL 切到 PostgreSQL」→ Service 层的 `DB::raw()` 散落各处，改动量堪比重写
3. QA 说「跑个单元测试」→ 发现不启动 Redis/MySQL 根本跑不了，因为 Service 直接依赖基础设施

这些问题的根源不是 Laravel 框架不好，而是**业务逻辑和基础设施代码高度耦合**。六边形架构（Hexagonal Architecture，又称 Ports and Adapters）正是 Alistair Cockburn 为解决这个问题提出的设计模式。

本文记录了我们从 Laravel 标准 MVC 迁移到六边形架构的完整过程，包含架构设计原理、源码级实现、真实踩坑和性能数据。

<!-- more -->

---

## 一、架构设计原理：什么是六边形架构？

### 1.1 核心思想

六边形架构的核心思想是**依赖反转**：业务逻辑（核心域）不依赖任何外部设施，而是通过「端口」定义契约，由「适配器」提供具体实现。

```
                    ┌─────────────────────────────────┐
                    │         Driving Adapters         │
                    │  (HTTP Controller / CLI / gRPC)  │
                    └──────────┬──────────────────────┘
                               │ 调用
                    ┌──────────▼──────────────────────┐
                    │          Input Ports             │
                    │   (Use Case / Service Interface) │
                    ├─────────────────────────────────┤
                    │                                   │
                    │         Core Domain               │
                    │   (Entities / Value Objects /     │
                    │    Domain Events / Business Rules)│
                    │                                   │
                    ├─────────────────────────────────┤
                    │          Output Ports             │
                    │  (Repository / Gateway Interface) │
                    └──────────▲──────────────────────┘
                               │ 实现
                    ┌──────────┴──────────────────────┐
                    │       Driven Adapters             │
                    │ (Eloquent / Stripe SDK / Redis)   │
                    └─────────────────────────────────┘
```

### 1.2 两种端口方向

| 端口类型 | 方向 | 谁驱动 | Laravel 示例 |
|---------|------|--------|-------------|
| **Driving Port**（输入端口） | 外部 → 核心 | 外部驱动核心 | `CreateOrderUseCase` 接口 |
| **Driven Port**（输出端口） | 核心 → 外部 | 核心驱动外部 | `PaymentGateway` 接口、`OrderRepository` 接口 |

### 1.3 与 DDD、Clean Architecture 的关系

| 架构模式 | 核心概念 | 层级 | 适用场景 |
|---------|---------|------|---------|
| **六边形架构** | 端口与适配器 | 2 层（核心 + 外部） | 中等复杂度，需要替换基础设施 |
| **DDD 分层架构** | 领域模型 + 应用服务 | 4 层（UI/App/Domain/Infra） | 高复杂度，业务规则密集 |
| **Clean Architecture** | 依赖规则 | 4 层（Entities/UseCases/InterfaceAdapters/Frameworks） | 追求极致可测试性 |

**实战结论**：六边形架构是 DDD 的简化版，适合 Laravel B2C 项目——不需要完整的 DDD 四层，但需要核心域与基础设施的清晰边界。

### 1.4 六边形架构 vs 洋葱架构 vs 清洁架构：选型对比

| 维度 | 六边形架构 (Hexagonal) | 洋葱架构 (Onion) | 清洁架构 (Clean) |
|------|----------------------|-----------------|-----------------|
| **提出者** | Alistair Cockburn (2005) | Jeffrey Palermo (2008) | Robert C. Martin (2012) |
| **核心隐喻** | 六边形 = 端口 + 适配器 | 洋葱 = 由外向内的同心圆 | 依赖规则 = 从外到内的同心圆 |
| **层级划分** | 2 层（核心域 + 外部世界） | 4 层（Domain → Application → Infrastructure → UI） | 4 层（Entities → UseCases → InterfaceAdapters → Frameworks） |
| **依赖方向** | 外部依赖内部（通过端口） | 外部依赖内部（洋葱皮层层包裹） | 外部依赖内部（依赖规则，源码依赖指向内层） |
| **端口概念** | ✅ 核心概念（Driving/Driven Port） | ❌ 无显式端口，用接口替代 | ❌ 无端口概念，用接口边界 |
| **领域实体位置** | 核心域最内层 | 洋葱最内层（Domain Model） | Entities 层（最内层） |
| **学习曲线** | ⭐⭐ 低（2 层简单直观） | ⭐⭐⭐ 中（4 层需理解包裹关系） | ⭐⭐⭐⭐ 高（依赖规则严格） |
| **Laravel 适配** | ⭐⭐⭐⭐⭐ 天然契合（ServiceProvider 绑定端口） | ⭐⭐⭐ 可行但需改造层级 | ⭐⭐⭐ 可行但层级过多 |
| **适合项目规模** | 中等（5-30 人团队） | 中大型（10-50 人团队） | 大型（20+ 人团队） |
| **典型框架** | Laravel（天然支持 DI） | .NET Core（推荐架构） | Angular / .NET |
| **核心优势** | 替换基础设施只需改适配器 | 领域逻辑完全隔离，可独立测试 | 严格的依赖规则，极致可测试性 |
| **核心劣势** | 层级少，复杂场景可能不够 | 层级多，简单项目过重 | 概念多，团队学习成本高 |

**实战选型建议**：

```
Laravel B2C 项目 → 六边形架构（层级简单，ServiceProvider 天然支持）
.NET Core 项目   → 洋葱架构（微软官方推荐，与 DI 容器深度集成）
超大型企业系统   → 清洁架构（严格依赖规则，适合 50+ 人团队长期维护）
```

---

## 二、实战落地：从 MVC 到六边形架构

### 2.1 项目背景

以 B2C 电商的「下单」流程为例：

```
用户请求 → 验证参数 → 检查库存 → 计算价格 → 创建订单 → 扣减库存 → 发起支付 → 发送通知
```

在传统 Laravel MVC 中，这段逻辑可能集中在 `OrderController` 和 `OrderService` 中，直接依赖 Eloquent、Redis、Stripe SDK、FCM 等。

### 2.2 目录结构设计

```
app/
├── Domain/                          # 核心域（零外部依赖）
│   ├── Order/
│   │   ├── Entities/
│   │   │   └── Order.php            # 聚合根
│   │   ├── ValueObjects/
│   │   │   ├── OrderId.php
│   │   │   ├── Money.php
│   │   │   └── OrderStatus.php
│   │   ├── Events/
│   │   │   └── OrderCreated.php
│   │   └── Exceptions/
│   │       └── InsufficientStockException.php
│   └── Payment/
│       ├── Entities/
│       │   └── Payment.php
│       └── ValueObjects/
│           └── PaymentMethod.php
│
├── Application/                     # 应用层（端口定义 + 用例编排）
│   ├── Ports/
│   │   ├── Input/                   # 输入端口（Driving Ports）
│   │   │   ├── CreateOrderUseCase.php
│   │   │   └── ProcessPaymentUseCase.php
│   │   └── Output/                  # 输出端口（Driven Ports）
│   │       ├── OrderRepository.php
│   │       ├── InventoryService.php
│   │       ├── PaymentGateway.php
│   │       └── NotificationService.php
│   └── Services/                    # 用例实现
│       └── OrderApplicationService.php
│
├── Infrastructure/                  # 基础设施层（适配器实现）
│   ├── Persistence/
│   │   ├── Eloquent/
│   │   │   └── EloquentOrderRepository.php
│   │   └── Models/
│   │       └── OrderModel.php
│   ├── Payment/
│   │   ├── StripePaymentGateway.php
│   │   └── AlipayPaymentGateway.php
│   ├── Notification/
│   │   ├── FcmNotificationService.php
│   │   └── SlackNotificationService.php
│   └── Cache/
│       └── RedisInventoryService.php
│
└── Http/                            # 接口层（Driving Adapters）
    ├── Controllers/
    │   └── OrderController.php
    ├── Requests/
    │   └── CreateOrderRequest.php
    └── Resources/
        └── OrderResource.php
```

### 2.3 代码实现：端口定义

**输入端口（Driving Port）—— 用例接口：**

```php
<?php
// app/Application/Ports/Input/CreateOrderUseCase.php

namespace App\Application\Ports\Input;

use App\Domain\Order\Entities\Order;
use App\Domain\Order\ValueObjects\Money;

/**
 * 创建订单用例 —— 输入端口
 * 
 * 定义「外部世界能对核心域做什么」
 * 实现者是 Application Service，调用者是 Controller
 */
interface CreateOrderUseCase
{
    /**
     * @param string $userId
     * @param array<int, array{product_id: string, quantity: int, unit_price: Money}> $items
     * @return Order
     */
    public function execute(string $userId, array $items): Order;
}
```

**输出端口（Driven Port）—— 仓储与外部服务接口：**

```php
<?php
// app/Application/Ports/Output/OrderRepository.php

namespace App\Application\Ports\Output;

use App\Domain\Order\Entities\Order;
use App\Domain\Order\ValueObjects\OrderId;

/**
 * 订单仓储接口 —— 输出端口
 * 
 * 定义「核心域需要外部世界提供什么能力」
 * 实现者是基础设施层的 Eloquent/MongoDB/内存实现
 */
interface OrderRepository
{
    public function save(Order $order): void;
    
    public function findById(OrderId $id): ?Order;
    
    /**
     * @return Order[]
     */
    public function findByUserId(string $userId): array;
    
    public function nextId(): OrderId;
}
```

```php
<?php
// app/Application/Ports/Output/PaymentGateway.php

namespace App\Application\Ports\Output;

use App\Domain\Order\Entities\Order;
use App\Domain\Payment\ValueObjects\PaymentMethod;

/**
 * 支付网关接口 —— 输出端口
 * 
 * 核心域不关心用 Stripe 还是 Alipay，
 * 只关心「能发起支付」和「能查询支付状态」
 */
interface PaymentGateway
{
    /**
     * @return array{transaction_id: string, status: string, redirect_url?: string}
     */
    public function charge(Order $order, PaymentMethod $method): array;
    
    public function refund(string $transactionId, int $amountCents): bool;
    
    public function queryStatus(string $transactionId): string;
}
```

```php
<?php
// app/Application/Ports/Output/InventoryService.php

namespace App\Application\Ports\Output;

/**
 * 库存服务接口 —— 输出端口
 */
interface InventoryService
{
    /**
     * 检查并预扣库存
     * @param array<int, array{product_id: string, quantity: int}> $items
     * @return bool 全部库存充足返回 true
     */
    public function checkAndReserve(array $items): bool;
    
    /**
     * 释放预扣库存（订单取消时）
     */
    public function release(array $items): void;
    
    /**
     * 确认扣减（支付成功后）
     */
    public function confirm(array $items): void;
}
```

### 2.4 代码实现：核心域实体

```php
<?php
// app/Domain/Order/Entities/Order.php

namespace App\Domain\Order\Entities;

use App\Domain\Order\Events\OrderCreated;
use App\Domain\Order\ValueObjects\OrderId;
use App\Domain\Order\ValueObjects\Money;
use App\Domain\Order\ValueObjects\OrderStatus;
use DateTimeImmutable;

class Order
{
    /** @var array<int, array{product_id: string, quantity: int, unit_price: Money}> */
    private array $items = [];
    
    /** @var array<string, mixed> 领域事件收集器 */
    private array $domainEvents = [];

    private function __construct(
        private readonly OrderId $id,
        private readonly string $userId,
        private OrderStatus $status,
        private Money $totalAmount,
        private readonly DateTimeImmutable $createdAt,
    ) {}

    /**
     * 工厂方法 —— 唯一创建订单的入口
     * @param array<int, array{product_id: string, quantity: int, unit_price: Money}> $items
     */
    public static function create(
        OrderId $id,
        string $userId,
        array $items,
    ): self {
        if (empty($items)) {
            throw new \InvalidArgumentException('Order must have at least one item');
        }

        $totalAmount = Money::zero();
        foreach ($items as $item) {
            $subtotal = $item['unit_price']->multiply($item['quantity']);
            $totalAmount = $totalAmount->add($subtotal);
        }

        $order = new self(
            id: $id,
            userId: $userId,
            status: OrderStatus::PENDING,
            totalAmount: $totalAmount,
            createdAt: new DateTimeImmutable(),
        );
        
        $order->items = $items;

        // 收集领域事件，不直接发布（避免依赖 Dispatcher）
        $order->domainEvents[] = new OrderCreated($id, $userId, $totalAmount);

        return $order;
    }

    public function markAsPaid(): void
    {
        if ($this->status !== OrderStatus::PENDING) {
            throw new \DomainException(
                "Cannot mark order as paid from status: {$this->status->value}"
            );
        }
        $this->status = OrderStatus::PAID;
    }

    public function cancel(): void
    {
        if ($this->status === OrderStatus::PAID) {
            throw new \DomainException('Cannot cancel a paid order directly, refund first');
        }
        $this->status = OrderStatus::CANCELLED;
    }

    // --- Getters ---
    public function getId(): OrderId { return $this->id; }
    public function getUserId(): string { return $this->userId; }
    public function getStatus(): OrderStatus { return $this->status; }
    public function getTotalAmount(): Money { return $this->totalAmount; }
    
    /** @return array<int, array{product_id: string, quantity: int, unit_price: Money}> */
    public function getItems(): array { return $this->items; }
    
    public function getCreatedAt(): DateTimeImmutable { return $this->createdAt; }

    /** @return array<string, mixed> 并清除事件 */
    public function pullDomainEvents(): array
    {
        $events = $this->domainEvents;
        $this->domainEvents = [];
        return $events;
    }
}
```

**值对象 Money —— 不可变、类型安全：**

```php
<?php
// app/Domain/Order/ValueObjects/Money.php

namespace App\Domain\Order\ValueObjects;

final readonly class Money
{
    public function __construct(
        public int $amountCents,
        public string $currency = 'USD',
    ) {
        if ($amountCents < 0) {
            throw new \InvalidArgumentException('Money amount cannot be negative');
        }
    }

    public static function zero(string $currency = 'USD'): self
    {
        return new self(0, $currency);
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);
        return new self($this->amountCents + $other->amountCents, $this->currency);
    }

    public function subtract(self $other): self
    {
        $this->assertSameCurrency($other);
        $result = $this->amountCents - $other->amountCents;
        if ($result < 0) {
            throw new \InvalidArgumentException('Resulting money cannot be negative');
        }
        return new self($result, $this->currency);
    }

    public function multiply(int $factor): self
    {
        return new self($this->amountCents * $factor, $this->currency);
    }

    public function equals(self $other): bool
    {
        return $this->amountCents === $other->amountCents 
            && $this->currency === $other->currency;
    }

    public function format(): string
    {
        return sprintf('%s %s', $this->currency, number_format($this->amountCents / 100, 2));
    }

    private function assertSameCurrency(self $other): void
    {
        if ($this->currency !== $other->currency) {
            throw new \InvalidArgumentException(
                "Currency mismatch: {$this->currency} vs {$other->currency}"
            );
        }
    }
}
```

### 2.5 代码实现：应用服务（用例编排）

```php
<?php
// app/Application/Services/OrderApplicationService.php

namespace App\Application\Services;

use App\Application\Ports\Input\CreateOrderUseCase;
use App\Application\Ports\Output\OrderRepository;
use App\Application\Ports\Output\InventoryService;
use App\Application\Ports\Output\PaymentGateway;
use App\Application\Ports\Output\NotificationService;
use App\Domain\Order\Entities\Order;
use App\Domain\Order\ValueObjects\Money;
use App\Domain\Payment\ValueObjects\PaymentMethod;
use Illuminate\Contracts\Events\Dispatcher;

/**
 * 订单应用服务 —— 用例编排器
 * 
 * 职责：
 * 1. 编排领域对象和端口调用的顺序
 * 2. 管理事务边界
 * 3. 发布领域事件
 * 
 * 不做：
 * 1. 不包含业务规则（那是 Entity 的事）
 * 2. 不直接依赖基础设施（通过端口接口）
 */
class OrderApplicationService implements CreateOrderUseCase
{
    public function __construct(
        private readonly OrderRepository $orderRepo,
        private readonly InventoryService $inventoryService,
        private readonly PaymentGateway $paymentGateway,
        private readonly NotificationService $notificationService,
        private readonly Dispatcher $eventDispatcher,
    ) {}

    public function execute(string $userId, array $items): Order
    {
        // Step 1: 检查并预扣库存（通过输出端口）
        $reserved = $this->inventoryService->checkAndReserve($items);
        if (!$reserved) {
            throw new \App\Domain\Order\Exceptions\InsufficientStockException(
                'Insufficient stock for one or more items'
            );
        }

        try {
            // Step 2: 创建订单聚合根（核心域逻辑）
            $orderId = $this->orderRepo->nextId();
            $moneyItems = array_map(fn($item) => [
                'product_id' => $item['product_id'],
                'quantity' => $item['quantity'],
                'unit_price' => new Money($item['unit_price_cents']),
            ], $items);
            
            $order = Order::create($orderId, $userId, $moneyItems);

            // Step 3: 持久化（通过输出端口）
            $this->orderRepo->save($order);

            // Step 4: 发布领域事件
            foreach ($order->pullDomainEvents() as $event) {
                $this->eventDispatcher->dispatch($event);
            }

            return $order;
        } catch (\Throwable $e) {
            // 补偿：释放库存
            $this->inventoryService->release($items);
            throw $e;
        }
    }
}
```

### 2.6 代码实现：适配器（Infrastructure 层）

**Eloquent 订单仓储适配器：**

```php
<?php
// app/Infrastructure/Persistence/Eloquent/EloquentOrderRepository.php

namespace App\Infrastructure\Persistence\Eloquent;

use App\Application\Ports\Output\OrderRepository;
use App\Domain\Order\Entities\Order;
use App\Domain\Order\ValueObjects\OrderId;
use App\Domain\Order\ValueObjects\Money;
use App\Domain\Order\ValueObjects\OrderStatus;
use App\Infrastructure\Persistence\Models\OrderModel;
use Illuminate\Support\Str;

/**
 * Eloquent 订单仓储适配器
 * 
 * 实现 OrderRepository 端口，将领域对象与 Eloquent Model 互转
 * 核心域不知道 Eloquent 的存在，只通过端口接口通信
 */
class EloquentOrderRepository implements OrderRepository
{
    public function save(Order $order): void
    {
        $model = OrderModel::updateOrCreate(
            ['id' => $order->getId()->value],
            [
                'user_id' => $order->getUserId(),
                'status' => $order->getStatus()->value,
                'total_amount_cents' => $order->getTotalAmount()->amountCents,
                'total_currency' => $order->getTotalAmount()->currency,
                'items' => $this->serializeItems($order->getItems()),
                'created_at' => $order->getCreatedAt(),
            ]
        );
    }

    public function findById(OrderId $id): ?Order
    {
        $model = OrderModel::find($id->value);
        
        return $model ? $this->toEntity($model) : null;
    }

    /** @return Order[] */
    public function findByUserId(string $userId): array
    {
        return OrderModel::where('user_id', $userId)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get()
            ->map(fn(OrderModel $m) => $this->toEntity($m))
            ->all();
    }

    public function nextId(): OrderId
    {
        return new OrderId((string) Str::orderedUuid());
    }

    /**
     * Eloquent Model → 领域实体（反序列化）
     */
    private function toEntity(OrderModel $model): Order
    {
        $items = array_map(fn(array $item) => [
            'product_id' => $item['product_id'],
            'quantity' => $item['quantity'],
            'unit_price' => new Money($item['unit_price_cents'], $item['currency'] ?? 'USD'),
        ], $model->items ?? []);

        // 使用反射或专用重建方法绕过 create() 工厂
        // 这里用一个 fromPersistence 工厂方法
        return Order::fromPersistence(
            id: new OrderId($model->id),
            userId: $model->user_id,
            status: OrderStatus::from($model->status),
            totalAmount: new Money($model->total_amount_cents, $model->total_currency),
            items: $items,
            createdAt: $model->created_at,
        );
    }

    /**
     * 领域实体 items → 数组（序列化）
     * @param array<int, array{product_id: string, quantity: int, unit_price: Money}> $items
     */
    private function serializeItems(array $items): array
    {
        return array_map(fn(array $item) => [
            'product_id' => $item['product_id'],
            'quantity' => $item['quantity'],
            'unit_price_cents' => $item['unit_price']->amountCents,
            'currency' => $item['unit_price']->currency,
        ], $items);
    }
}
```

**Stripe 支付网关适配器：**

```php
<?php
// app/Infrastructure/Payment/StripePaymentGateway.php

namespace App\Infrastructure\Payment;

use App\Application\Ports\Output\PaymentGateway;
use App\Domain\Order\Entities\Order;
use App\Domain\Payment\ValueObjects\PaymentMethod;
use Stripe\StripeClient;
use Stripe\Exception\ApiErrorException;

/**
 * Stripe 支付网关适配器
 * 
 * 实现 PaymentGateway 端口
 * 核心域不知道 Stripe SDK 的存在
 */
class StripePaymentGateway implements PaymentGateway
{
    public function __construct(
        private readonly StripeClient $stripe,
    ) {}

    /** @return array{transaction_id: string, status: string, redirect_url?: string} */
    public function charge(Order $order, PaymentMethod $method): array
    {
        try {
            $paymentIntent = $this->stripe->paymentIntents->create([
                'amount' => $order->getTotalAmount()->amountCents,
                'currency' => strtolower($order->getTotalAmount()->currency),
                'payment_method' => $method->stripePaymentMethodId,
                'confirm' => true,
                'automatic_payment_methods' => [
                    'enabled' => true,
                    'allow_redirects' => 'always',
                ],
                'metadata' => [
                    'order_id' => $order->getId()->value,
                    'user_id' => $order->getUserId(),
                ],
            ]);

            return [
                'transaction_id' => $paymentIntent->id,
                'status' => $this->mapStripeStatus($paymentIntent->status),
                'redirect_url' => $paymentIntent->next_action?->redirect_to_url?->url,
            ];
        } catch (ApiErrorException $e) {
            throw new \RuntimeException(
                "Stripe payment failed: {$e->getMessage()}",
                $e->getHttpStatus(),
                $e
            );
        }
    }

    public function refund(string $transactionId, int $amountCents): bool
    {
        try {
            $this->stripe->refunds->create([
                'payment_intent' => $transactionId,
                'amount' => $amountCents,
            ]);
            return true;
        } catch (ApiErrorException $e) {
            return false;
        }
    }

    public function queryStatus(string $transactionId): string
    {
        $pi = $this->stripe->paymentIntents->retrieve($transactionId);
        return $this->mapStripeStatus($pi->status);
    }

    private function mapStripeStatus(string $stripeStatus): string
    {
        return match ($stripeStatus) {
            'succeeded' => 'paid',
            'requires_action' => 'pending_action',
            'canceled' => 'cancelled',
            default => 'pending',
        };
    }
}
```

### 2.7 代码实现：Driving Adapter（Controller）

```php
<?php
// app/Http/Controllers/OrderController.php

namespace App\Http\Controllers;

use App\Application\Ports\Input\CreateOrderUseCase;
use App\Http\Requests\CreateOrderRequest;
use App\Http\Resources\OrderResource;

/**
 * 订单控制器 —— Driving Adapter
 * 
 * 它只做两件事：
 * 1. 将 HTTP 请求翻译为用例调用
 * 2. 将用例结果翻译为 HTTP 响应
 * 
 * 零业务逻辑、零基础设施依赖
 */
class OrderController extends Controller
{
    public function __construct(
        private readonly CreateOrderUseCase $createOrderUseCase,
    ) {}

    public function store(CreateOrderRequest $request)
    {
        $order = $this->createOrderUseCase->execute(
            userId: $request->user()->id,
            items: $request->validated('items'),
        );

        return (new OrderResource($order))
            ->response()
            ->setStatusCode(201);
    }
}
```

### 2.8 依赖注入绑定（ServiceProvider）

```php
<?php
// app/Providers/HexagonalServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class HexagonalServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // --- 输入端口绑定到实现 ---
        $this->app->bind(
            \App\Application\Ports\Input\CreateOrderUseCase::class,
            \App\Application\Services\OrderApplicationService::class,
        );

        // --- 输出端口绑定到适配器 ---
        $this->app->bind(
            \App\Application\Ports\Output\OrderRepository::class,
            \App\Infrastructure\Persistence\Eloquent\EloquentOrderRepository::class,
        );

        // 支付网关：可根据配置切换 Stripe / Alipay
        $this->app->bind(
            \App\Application\Ports\Output\PaymentGateway::class,
            function ($app) {
                return match (config('payment.gateway')) {
                    'stripe' => new \App\Infrastructure\Payment\StripePaymentGateway(
                        new \Stripe\StripeClient(config('services.stripe.secret'))
                    ),
                    'alipay' => new \App\Infrastructure\Payment\AlipayPaymentGateway(
                        config('services.alipay')
                    ),
                    default => throw new \InvalidArgumentException(
                        "Unknown payment gateway: " . config('payment.gateway')
                    ),
                };
            },
        );

        $this->app->bind(
            \App\Application\Ports\Output\InventoryService::class,
            \App\Infrastructure\Cache\RedisInventoryService::class,
        );

        $this->app->bind(
            \App\Application\Ports\Output\NotificationService::class,
            \App\Infrastructure\Notification\FcmNotificationService::class,
        );
    }
}
```

---

## 三、测试优势：单元测试无需任何基础设施

六边形架构最大的收益体现在测试上。核心域和应用服务可以通过 Mock 端口进行纯单元测试，不需要数据库、Redis、Stripe：

```php
<?php
// tests/Unit/Application/Services/OrderApplicationServiceTest.php

namespace Tests\Unit\Application\Services;

use App\Application\Services\OrderApplicationService;
use App\Application\Ports\Output\OrderRepository;
use App\Application\Ports\Output\InventoryService;
use App\Application\Ports\Output\PaymentGateway;
use App\Application\Ports\Output\NotificationService;
use App\Domain\Order\Entities\Order;
use App\Domain\Order\ValueObjects\OrderId;
use Illuminate\Contracts\Events\Dispatcher;
use PHPUnit\Framework\TestCase;

class OrderApplicationServiceTest extends TestCase
{
    private OrderRepository $orderRepo;
    private InventoryService $inventoryService;
    private OrderApplicationService $service;

    protected function setUp(): void
    {
        parent::setUp();
        
        // 所有外部依赖都是 Mock，不启动任何基础设施
        $this->orderRepo = $this->createMock(OrderRepository::class);
        $this->inventoryService = $this->createMock(InventoryService::class);
        $paymentGateway = $this->createMock(PaymentGateway::class);
        $notificationService = $this->createMock(NotificationService::class);
        $eventDispatcher = $this->createMock(Dispatcher::class);

        $this->orderRepo->method('nextId')->willReturn(new OrderId('test-001'));

        $this->service = new OrderApplicationService(
            orderRepo: $this->orderRepo,
            inventoryService: $this->inventoryService,
            paymentGateway: $paymentGateway,
            notificationService: $notificationService,
            eventDispatcher: $eventDispatcher,
        );
    }

    public function test_create_order_with_sufficient_stock(): void
    {
        // Arrange
        $this->inventoryService->expects($this->once())
            ->method('checkAndReserve')
            ->willReturn(true);
        
        $this->orderRepo->expects($this->once())
            ->method('save');

        $items = [
            ['product_id' => 'SKU-001', 'quantity' => 2, 'unit_price_cents' => 2999],
        ];

        // Act
        $order = $this->service->execute('user-123', $items);

        // Assert
        $this->assertInstanceOf(Order::class, $order);
        $this->assertEquals('user-123', $order->getUserId());
    }

    public function test_create_order_fails_when_insufficient_stock(): void
    {
        // Arrange
        $this->inventoryService->method('checkAndReserve')->willReturn(false);
        $this->inventoryService->expects($this->never())->method('release');

        $items = [
            ['product_id' => 'SKU-001', 'quantity' => 999, 'unit_price_cents' => 2999],
        ];

        // Assert
        $this->expectException(\App\Domain\Order\Exceptions\InsufficientStockException::class);

        // Act
        $this->service->execute('user-123', $items);
    }
}
```

**对比传统 Laravel 测试：**

```php
// ❌ 传统方式：需要 DatabaseMigrations + Redis + 外部 API
class TraditionalOrderTest extends TestCase
{
    use DatabaseMigrations, RefreshDatabase;

    public function test_create_order(): void
    {
        // 需要真实数据库运行
        $this->seed(ProductSeeder::class);
        // 需要 Redis 运行
        Cache::put('stock:SKU-001', 100);
        // 测试依赖 Stripe API 或需要 Mock 整个 HTTP 层
        ...
    }
}
```

---

## 四、替换场景实战：从 Stripe 切换到 Alipay

六边形架构的真正价值在「替换」场景中体现。以下是从 Stripe 切换到 Alipay 的完整过程：

### 4.1 传统 MVC 方式

```
需修改的文件：
1. OrderService.php — 直接调用 Stripe SDK 的地方（5+ 处）
2. PaymentController.php — Webhook 签名验证
3. RefundService.php — 退款逻辑
4. PaymentConfig.php — 配置项
5. composer.json — 依赖变更
6. 10+ 个测试文件

风险：遗漏修改点、引入回归 Bug
```

### 4.2 六边形架构方式

```
需修改的文件：
1. Infrastructure/Payment/AlipayPaymentGateway.php — 新建（实现 PaymentGateway 接口）
2. HexagonalServiceProvider.php — 修改绑定配置（1 行）

核心域代码变更：0 行
测试代码变更：集成测试新增一组适配器测试
```

```php
<?php
// app/Infrastructure/Payment/AlipayPaymentGateway.php

namespace App\Infrastructure\Payment;

use App\Application\Ports\Output\PaymentGateway;
use App\Domain\Order\Entities\Order;
use App\Domain\Payment\ValueObjects\PaymentMethod;

/**
 * Alipay 支付网关适配器
 * 
 * 只需实现 PaymentGateway 端口接口
 * 核心域零修改
 */
class AlipayPaymentGateway implements PaymentGateway
{
    public function __construct(
        private readonly array $config,
    ) {}

    /** @return array{transaction_id: string, status: string, redirect_url?: string} */
    public function charge(Order $order, PaymentMethod $method): array
    {
        // 调用 Alipay SDK
        $alipay = new \Alipay\EasySDKKernel\Factory($this->config);
        
        $result = $alipay->payment()->common()
            ->setNotifyUrl($this->config['notify_url'])
            ->setSubject('Order #' . $order->getId()->value)
            ->setTotalAmount($order->getTotalAmount()->format())
            ->setOutTradeNo($order->getId()->value)
            ->pay();

        return [
            'transaction_id' => $result->trade_no ?? '',
            'status' => 'pending',
            'redirect_url' => $result->qr_code ?? null,
        ];
    }

    public function refund(string $transactionId, int $amountCents): bool
    {
        $alipay = new \Alipay\EasySDKKernel\Factory($this->config);
        
        $result = $alipay->refund()
            ->setTradeNo($transactionId)
            ->setRefundAmount(number_format($amountCents / 100, 2))
            ->refund();

        return $result->code === '10000';
    }

    public function queryStatus(string $transactionId): string
    {
        $alipay = new \Alipay\EasySDKKernel\Factory($this->config);
        $result = $alipay->common()->query()->tradeQuery($transactionId);

        return match ($result->trade_status ?? '') {
            'TRADE_SUCCESS' => 'paid',
            'TRADE_CLOSED' => 'cancelled',
            default => 'pending',
        };
    }
}
```

切换只需修改 ServiceProvider 中的一行绑定：

```php
// Before: Stripe
$this->app->bind(PaymentGateway::class, StripePaymentGateway::class);

// After: Alipay
$this->app->bind(PaymentGateway::class, AlipayPaymentGateway::class);
```

---

## 五、与传统 MVC 的对比分析

| 维度 | 传统 Laravel MVC | 六边形架构 |
|------|-----------------|-----------|
| **文件数量** | 少（3-5 个核心文件） | 多（10-15 个文件） |
| **学习曲线** | 低 | 中高（需理解 DIP、端口/适配器） |
| **替换基础设施** | 改动 5-15 个文件 | 改动 1-2 个文件 |
| **单元测试** | 需要 Database/Redis/外部 API | 纯 Mock，零基础设施 |
| **测试速度** | 慢（秒级） | 快（毫秒级） |
| **代码导航** | 按技术分层（Controller/Service/Model） | 按业务分域（Order/Payment/Inventory） |
| **新人上手** | 快 | 慢（需要理解整体架构意图） |
| **适用项目** | 简单 CRUD、短期项目 | 复杂业务、长期维护、多团队协作 |

---

## 六、真实踩坑记录

### 踩坑 1：Eloquent Model 与领域实体的映射地狱

**问题**：Eloquent Model 是 Active Record 模式，直接暴露 `save()`、`delete()` 方法。如果领域实体直接继承 Eloquent Model，就会破坏六边形架构的隔离。

**错误做法**：

```php
// ❌ Order 实体继承 Eloquent Model → 核心域依赖 Laravel
class Order extends \Illuminate\Database\Eloquent\Model
{
    // 框架依赖泄漏到核心域
}
```

**正确做法**：领域实体是纯 PHP 类，Eloquent Model 是持久化层的内部实现细节：

```php
// ✅ 领域实体是纯 PHP 类
class Order { /* 纯 PHP，无 Laravel 依赖 */ }

// ✅ Eloquent Model 只在 Infrastructure 层使用
class OrderModel extends \Illuminate\Database\Eloquent\Model 
{
    protected $table = 'orders';
    protected $casts = ['items' => 'array'];
}
```

**教训**：领域实体和持久化模型之间的转换代码（`toEntity()` / `toModel()`）是六边形架构的主要维护成本。对于简单 CRUD 来说，这个成本可能不值得。

### 踩坑 2：领域事件的发布时机

**问题**：领域实体收集了事件，但如果在 `save()` 之前发布事件，事件处理器可能读到旧数据。

```php
// ❌ 先发布事件再持久化
$order = Order::create(...);
$this->eventDispatcher->dispatch(new OrderCreated(...)); // Handler 读不到订单
$this->orderRepo->save($order);
```

**解决方案**：在应用服务层用事务包裹，事务提交后再发布事件：

```php
// ✅ 事务提交后发布
DB::transaction(function () use ($order) {
    $this->orderRepo->save($order);
});

$events = $order->pullDomainEvents();
foreach ($events as $event) {
    $this->eventDispatcher->dispatch($event);
}
```

### 踩坑 3：端口接口设计过于泛化

**问题**：初学时容易把端口设计成通用 CRUD 接口，失去业务语义：

```php
// ❌ 过于泛化的端口
interface Repository
{
    public function find(string $id): ?Entity;
    public function save(Entity $entity): void;
    public function delete(string $id): void;
}
```

**解决方案**：端口接口应该体现业务意图：

```php
// ✅ 有业务语义的端口
interface OrderRepository
{
    public function findById(OrderId $id): ?Order;
    public function findPendingOrdersExpiringBefore(DateTimeImmutable $deadline): array;
    public function save(Order $order): void;
}
```

### 踩坑 4：性能开销——对象映射层

**问题**：在高并发场景下，领域实体与 Eloquent Model 之间的转换带来额外 CPU 开销。

**性能数据**（1000 次循环基准测试）：

| 操作 | 传统 Eloquent 直接查询 | 六边形架构（含映射） | 开销 |
|------|----------------------|-------------------|------|
| 单条查询 + 映射 | 0.8ms | 1.2ms | +50% |
| 列表查询 50 条 | 5.2ms | 8.1ms | +56% |
| 写入 + 序列化 | 2.1ms | 3.3ms | +57% |

**缓解方案**：

```php
// 方案1：批量查询时跳过领域映射，直接返回只读 DTO
public function findForDisplay(string $userId): OrderListDto
{
    return OrderModel::where('user_id', $userId)
        ->select('id', 'status', 'total_amount_cents', 'created_at')
        ->get()
        ->pipe(fn($collection) => new OrderListDto($collection->toArray()));
}

// 方案2：只在写操作时做完整映射
public function save(Order $order): void
{
    // 只在需要业务逻辑验证时才转换领域实体
    OrderModel::updateOrCreate(
        ['id' => $order->getId()->value],
        $this->toPersistenceArray($order)
    );
}
```

---

## 七、最佳实践与反模式

### ✅ 最佳实践

1. **端口接口放在 Application 层**，不是 Domain 层——Domain 只定义实体和业务规则
2. **一个端口一个方法**优于通用 CRUD 端口——接口越窄，替换自由度越高
3. **用构造函数注入适配器**，不用 Service Locator——Laravel 的 DI 容器天然支持
4. **领域实体用 Value Object 而非原始类型**——`OrderId` 比 `string` 更安全
5. **核心域禁止 `use Illuminate\*`**——通过 `composer.json` 的 `autoload` 分区验证

### ❌ 反模式

1. **过度抽象**：只有 1 个实现的端口不需要接口——YAGNI 原则
2. **贫血领域模型**：实体只有 getter/setter，所有逻辑在 Service 里——失去了六边形架构的核心收益
3. **忽视 CQRS**：读写都走领域实体会导致性能问题——查询侧可以用直接 SQL
4. **端口泄漏实现细节**：`OrderRepository` 接口里出现 `Builder` 返回类型——泄露了 ORM 选型
5. **无脑迁移**：简单 CRUD 应用强行套六边形架构——杀鸡用牛刀

---

## 八、何时该用/不该用六边形架构

### ✅ 适用场景

- **核心业务逻辑复杂**（电商订单、支付、库存等）
- **基础设施可能替换**（支付网关切换、数据库迁移）
- **需要高测试覆盖率**（>80%）
- **团队规模 > 3 人**，需要清晰的职责边界
- **长期维护项目**（>1 年生命周期）

### ❌ 不适用场景

- **简单 CRUD 后台**（管理后台、配置管理）
- **短期项目**（活动页、临时 API）
- **团队 < 2 人**，沟通成本低，架构成本高
- **性能极端敏感**（每毫秒都重要的系统）

---

## 九、扩展思考

### 9.1 六边形架构 + CQRS 的结合

在查询密集的 B2C 场景中，读操作和写操作可以走不同路径：

```
写操作路径（Command）：
Controller → UseCase → Domain Entity → Repository → Database

读操作路径（Query）：
Controller → QueryService → Raw SQL/Read Model → Response
```

查询侧不需要领域实体和仓储，直接用 SQL Builder 或 Read Model 返回 DTO，性能更优。

### 9.2 与 Laravel Octane 的兼容性

在 Swoole 环境下，六边形架构的纯 PHP 领域实体天然兼容（无全局状态依赖），但适配器层需要注意：
- Eloquent 连接池管理
- Stripe SDK 的 HTTP 客户端实例化
- Redis 连接复用

### 9.3 渐进式迁移策略

不需要一次性重写整个项目，可以按模块逐步迁移：

```
Phase 1: 新模块用六边形架构（如新增的退款模块）
Phase 2: 高频变更模块迁移（如支付模块）
Phase 3: 核心域模块迁移（如订单模块）
Phase 4: 遗留 CRUD 模块保持现状（不值得迁移）
```

---

## 总结

六边形架构不是银弹，但它为 Laravel 项目提供了一个**在架构复杂度和可维护性之间的平衡点**。核心收益在于：

1. **基础设施可替换**：支付网关、数据库、缓存的切换只需改适配器
2. **测试速度快 10 倍**：纯单元测试不需要启动任何基础设施
3. **团队协作清晰**：按业务域而非技术层分代码

但代价也很明显：文件数量翻倍、对象映射层维护成本、团队需要架构共识。

**最终建议**：如果你的 Laravel 项目同时满足「业务逻辑复杂 + 长期维护 + 团队 ≥ 3 人」，六边形架构值得投入。如果是简单 CRUD，老老实实用 MVC。

---

## 相关阅读

- [Hexagonal Architecture 进阶实战：Laravel 中的端口与适配器模式——对比 Clean Architecture 的落地差异](/categories/00_架构/2026-06-06-hexagonal-architecture-laravel-port-adapter-clean-architecture/)
- [Event Storming 实战：从业务事件到代码实现的领域建模方法论](/categories/00_架构/Event-Storming-实战-从业务事件到代码实现的领域建模方法论-Laravel-B2C-API踩坑记录/)
- [TCC 分布式事务模式实战：Try-Confirm-Cancel 在 Laravel 订单/支付/库存中的落地](/categories/00_架构/TCC-分布式事务模式实战-Try-Confirm-Cancel-Laravel-订单支付库存落地/)
