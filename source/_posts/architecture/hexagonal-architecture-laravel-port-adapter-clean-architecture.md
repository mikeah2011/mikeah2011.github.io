---
title: Hexagonal Architecture 进阶实战：Laravel 中的端口与适配器模式——对比 Clean Architecture 的落地差异
date: 2026-06-06 11:00:00
tags: [Hexagonal Architecture, 六边形架构, 端口与适配器, Clean Architecture, Laravel, 设计模式]
keywords: [Hexagonal Architecture, Laravel, Clean Architecture, 进阶实战, 中的端口与适配器模式, 的落地差异, 架构]
description: 深入对比六边形架构与 Clean Architecture 在 Laravel 项目中的落地差异，通过端口与适配器模式实现依赖反转，结合电商订单系统重构案例，手把手教你从传统 MVC 迁移到六边形架构，掌握 Laravel Service Container 绑定、渐进式迁移策略与 CQRS 集成的工程实践。
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


## 前言：当架构思想碰撞 Laravel 框架

在 Laravel 生态中，Controller → Service → Repository 的三层结构几乎成了"行业标准"。然而随着业务复杂度的攀升，开发者逐渐发现这种分层方式存在一个根本性问题：**依赖方向是反的**。Controller 依赖 Service，Service 依赖 Repository，Repository 依赖 Eloquent——业务逻辑被基础设施层层包裹，一旦需要替换外部依赖（比如从 MySQL 切换到 PostgreSQL，从 Stripe 切换到支付宝），改动面会波及整个调用链。

为了解决这个问题，架构社区先后提出了多种方案：六边形架构（Hexagonal Architecture）、洋葱架构（Onion Architecture）、整洁架构（Clean Architecture）。它们的核心思想高度一致——**依赖反转**，但在落地细节上各有侧重。

本文将从理论根源出发，深入对比六边形架构与 Clean Architecture 在 Laravel 项目中的落地差异，并通过一个电商订单系统的完整重构案例，展示从传统 MVC 迁移到六边形架构的全过程。

> **前置阅读建议**：本文假设你已具备 Laravel 基础和基本的架构设计概念。如果你是第一次接触六边形架构，建议先阅读[《六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录》](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)了解基础概念后再回来看这篇文章。

---

## 一、六边形架构的起源与核心思想

### 1.1 Alistair Cockburn 的原始构想

2005 年，Alistair Cockburn 在论文 *"Hexagonal Architecture"* 中首次提出了这个概念。他观察到一个普遍问题：大多数应用程序的架构是以"外部"为中心设计的——UI 驱动业务逻辑，数据库驱动数据模型。这导致业务逻辑与外部世界形成了紧耦合。

Cockburn 的核心洞察非常简单：

> **应用程序应该与外部世界通过"端口"通信，而不是直接依赖具体的技术实现。**

这个思想的革命性在于，它把应用程序从"被动响应外部请求"的角色，转变为"主动定义与外部世界交互契约"的角色。业务逻辑不再关心数据来自 Web 请求还是 CLI 命令，也不关心数据存储在 MySQL 还是 MongoDB——它只关心"我需要存取什么数据"和"我需要发送什么指令"。

### 1.2 "六边形"的隐喻

很多人好奇为什么是"六边形"而不是其他形状。Cockburn 本人解释过：**六边形没有任何特殊含义**，它只是一个比矩形更方便画图的形状——可以在任意边放置端口。关键是两点：

1. **内外分明**：内部是业务逻辑，外部是基础设施
2. **对称通信**：外部可以通过端口驱动内部（Driving Adapter），内部也可以通过端口驱动外部（Driven Adapter）

这打破了传统分层架构中"上层调用下层"的单向依赖，实现了真正的**双向通信、单向依赖**。

### 1.3 端口与适配器的角色

在 Cockburn 的模型中：

- **端口（Port）**：应用程序定义的接口，描述了"我需要什么能力"。端口是纯粹的契约，不包含任何实现细节。
- **适配器（Adapter）**：连接端口与外部世界的具体实现。适配器负责将外部技术的"语言"翻译成端口能理解的"语言"。

端口又分为两类：

| 端口类型 | 方向 | 说明 | Laravel 中的类比 |
|---------|------|------|----------------|
| **驱动端口（Driving Port）** | 外部 → 内部 | 外部系统用来"驱动"应用的接口 | Controller 接收的请求、CLI 命令 |
| **被驱动端口（Driven Port）** | 内部 → 外部 | 应用用来"调用"外部系统的接口 | Repository 接口、事件发布接口 |

适配器同样分为两类：

| 适配器类型 | 方向 | 说明 | Laravel 中的类比 |
|-----------|------|------|----------------|
| **驱动适配器（Driving Adapter）** | 外部 → 内部 | 将外部请求翻译成端口调用 | HTTP Controller、Artisan Command |
| **被驱动适配器（Driven Adapter）** | 内部 → 外部 | 实现被驱动端口的具体逻辑 | Eloquent Repository、Redis Cache |

这个分类至关重要。很多团队在实践六边形架构时混淆了驱动与被驱动的区别，导致架构混乱。

---

## 二、六边形架构 vs Clean Architecture：理论对比

### 2.1 三种架构的同心圆模型

Robert C. Martin（Uncle Bob）在 2012 年提出的 Clean Architecture，本质上是对六边形架构的"细化"。让我们用同心圆来理解三者的关系：

**六边形架构（2 层）**：
```
┌─────────────────────────────────┐
│  External (Adapters)            │
│  ┌───────────────────────────┐  │
│  │  Internal (Domain + App)  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

**Clean Architecture（4 层）**：
```
┌─────────────────────────────────────┐
│  Frameworks & Drivers               │
│  ┌───────────────────────────────┐  │
│  │  Interface Adapters           │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │  Application Business   │  │  │
│  │  │  ┌───────────────────┐  │  │  │
│  │  │  │  Enterprise       │  │  │  │
│  │  │  │  Business Rules   │  │  │  │
│  │  │  └───────────────────┘  │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**洋葱架构（4 层）**：
```
Domain Model → Domain Services → Application Services → Infrastructure
```

### 2.2 关键差异分析

| 维度 | 六边形架构 | Clean Architecture | 洋葱架构 |
|------|-----------|-------------------|---------|
| **层数** | 2 层（核心 + 外部） | 4 层（实体/用例/适配器/框架） | 4 层（模型/领域服务/应用服务/基础设施） |
| **核心抽象** | 端口（Port） | 用例（Use Case） | 领域服务（Domain Service） |
| **依赖规则** | 外部依赖内部 | 外层依赖内层 | 外层依赖内层 |
| **复杂度** | 较低，灵活 | 较高，规范 | 中等 |
| **适用场景** | 中等复杂度，需要替换基础设施 | 高复杂度，企业级应用 | DDD 驱动的项目 |
| **核心创新** | 端口与适配器的显式定义 | 用例驱动的业务流程编排 | 领域模型的中心地位 |

### 2.3 一个常见误解

很多人认为"Clean Architecture 包含了六边形架构"，这个说法只对了一半。Clean Architecture 的第三层（Interface Adapters）确实对应了六边形架构的适配器概念，但 Clean Architecture 对内部分层更精细——它将业务逻辑拆分为"实体规则"和"用例编排"两个独立层次，而六边形架构将它们合并为"核心域"。

在实际 Laravel 项目中，**六边形架构通常比 Clean Architecture 更容易落地**，因为：

1. Laravel 本身不是企业级框架，项目复杂度通常达不到 Clean Architecture 的四层需求
2. 六边形架构的两层结构与 Laravel 的 Service Container 更自然地结合
3. 过度分层反而增加了认知负担和维护成本

---

## 三、Laravel 中的落地实践：分层详解

### 3.1 目录结构设计

在深入代码之前，先看一个经过实战验证的目录结构：

```
app/
├── Domain/                          # 核心域（六边形内部）
│   ├── Order/                       # 限界上下文
│   │   ├── Order.php                # 实体
│   │   ├── OrderId.php              # 值对象
│   │   ├── OrderStatus.php          # 枚举
│   │   ├── OrderItem.php            # 值对象
│   │   ├── OrderRepository.php      # 被驱动端口（接口）
│   │   ├── PaymentGateway.php       # 被驱动端口（接口）
│   │   ├── OrderService.php         # 领域服务
│   │   └── Events/
│   │       ├── OrderPlaced.php      # 领域事件
│   │       └── OrderCancelled.php
│   └── Product/
│       ├── Product.php
│       ├── ProductRepository.php    # 被驱动端口
│       └── StockService.php
│
├── Application/                     # 应用层（用例编排）
│   ├── Order/
│   │   ├── PlaceOrderCommand.php    # 命令
│   │   ├── PlaceOrderHandler.php    # 命令处理器（用例）
│   │   ├── CancelOrderCommand.php
│   │   ├── CancelOrderHandler.php
│   │   └── Queries/
│   │       ├── GetOrderQuery.php
│   │       └── GetOrderHandler.php
│   └── Shared/
│       └── CommandBus.php           # 命令总线接口
│
├── Infrastructure/                  # 基础设施（适配器）
│   ├── Persistence/
│   │   ├── Eloquent/
│   │   │   ├── EloquentOrderRepository.php    # 被驱动适配器
│   │   │   ├── EloquentProductRepository.php
│   │   │   └── Models/
│   │   │       ├── OrderModel.php             # Eloquent 模型
│   │   │       └── ProductModel.php
│   │   └── Migrations/
│   ├── Payment/
│   │   ├── StripePaymentGateway.php           # 被驱动适配器
│   │   └── AlipayPaymentGateway.php
│   ├── Messaging/
│   │   ├── LaravelEventBus.php
│   │   └── RedisQueuePublisher.php
│   └── Providers/
│       └── HexagonalServiceProvider.php       # 依赖绑定
│
├── Http/                            # 驱动适配器（HTTP）
│   ├── Controllers/
│   │   ├── OrderController.php
│   │   └── OrderQueryController.php
│   ├── Requests/
│   │   └── PlaceOrderRequest.php
│   └── Resources/
│       └── OrderResource.php
│
└── Console/                         # 驱动适配器（CLI）
    └── Commands/
        └── ProcessOrderCommand.php
```

### 3.2 Domain 层：实体、值对象与领域服务

Domain 层是六边形架构的核心，它**不依赖任何外部框架**（不引入 Laravel 的任何命名空间）。

**值对象 OrderId**：

```php
<?php

namespace App\Domain\Order;

use InvalidArgumentException;

final class OrderId
{
    private string $value;

    public function __construct(string $value)
    {
        if (empty($value)) {
            throw new InvalidArgumentException('OrderId cannot be empty');
        }
        $this->value = $value;
    }

    public static function generate(): self
    {
        return new self(bin2hex(random_bytes(16)));
    }

    public function value(): string
    {
        return $this->value;
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }

    public function __toString(): string
    {
        return $this->value;
    }
}
```

**实体 Order**：

```php
<?php

namespace App\Domain\Order;

use App\Domain\Order\Events\OrderPlaced;
use App\Domain\Order\Events\OrderCancelled;
use DateTimeImmutable;
use InvalidArgumentException;
use RuntimeException;

class Order
{
    private OrderId $id;
    private string $customerId;
    /** @var OrderItem[] */
    private array $items;
    private OrderStatus $status;
    private DateTimeImmutable $createdAt;
    private ?DateTimeImmutable $cancelledAt;
    private array $domainEvents = [];

    private function __construct(
        OrderId $id,
        string $customerId,
        array $items,
        OrderStatus $status
    ) {
        $this->id = $id;
        $this->customerId = $customerId;
        $this->items = $items;
        $this->status = $status;
        $this->createdAt = new DateTimeImmutable();
        $this->cancelledAt = null;
    }

    public static function place(
        string $customerId,
        array $items,
        StockService $stockService
    ): self {
        if (empty($items)) {
            throw new InvalidArgumentException('Order must have at least one item');
        }

        // 业务规则：检查库存
        foreach ($items as $item) {
            if (!$stockService->isAvailable($item->productId(), $item->quantity())) {
                throw new RuntimeException(
                    "Product {$item->productId()} has insufficient stock"
                );
            }
        }

        $order = new self(
            OrderId::generate(),
            $customerId,
            $items,
            OrderStatus::PENDING
        );

        // 记录领域事件
        $order->domainEvents[] = new OrderPlaced(
            $order->id,
            $order->customerId,
            $order->totalAmount()
        );

        return $order;
    }

    public function cancel(): void
    {
        if ($this->status !== OrderStatus::PENDING) {
            throw new RuntimeException('Only pending orders can be cancelled');
        }

        $this->status = OrderStatus::CANCELLED;
        $this->cancelledAt = new DateTimeImmutable();

        $this->domainEvents[] = new OrderCancelled($this->id);
    }

    public function totalAmount(): float
    {
        return array_reduce(
            $this->items,
            fn(float $sum, OrderItem $item) => $sum + $item->subtotal(),
            0.0
        );
    }

    // Getters...
    public function id(): OrderId { return $this->id; }
    public function customerId(): string { return $this->customerId; }
    /** @return OrderItem[] */
    public function items(): array { return $this->items; }
    public function status(): OrderStatus { return $this->status; }
    public function createdAt(): DateTimeImmutable { return $this->createdAt; }
    public function cancelledAt(): ?DateTimeImmutable { return $this->cancelledAt; }

    /** @return array */
    public function pullDomainEvents(): array
    {
        $events = $this->domainEvents;
        $this->domainEvents = [];
        return $events;
    }
}
```

注意几个关键设计决策：

1. **构造函数是 private 的**：只能通过 `place()` 工厂方法创建订单，确保业务规则在创建时就被执行
2. **实体不继承任何框架类**：没有 `extends Model`，没有 `use SoftDeletes`
3. **领域事件在实体内部产生**：当状态变化时，实体记录事件，由应用层负责分发

**被驱动端口 OrderRepository**：

```php
<?php

namespace App\Domain\Order;

interface OrderRepository
{
    public function save(Order $order): void;
    public function findById(OrderId $id): ?Order;
    public function findByCustomerId(string $customerId): array;
    public function nextId(): OrderId;
}
```

这就是一个典型的"被驱动端口"——领域层定义"我需要存取订单"的契约，但不关心具体怎么存取。

### 3.3 Application 层：用例与命令处理器

Application 层负责**编排**业务流程，它调用 Domain 层的实体和服务，但不包含业务规则本身。

**命令 PlaceOrderCommand**：

```php
<?php

namespace App\Application\Order;

final class PlaceOrderCommand
{
    public function __construct(
        public readonly string $customerId,
        /** @var array{product_id: string, quantity: int, price: float}[] */
        public readonly array $items
    ) {}
}
```

**命令处理器 PlaceOrderHandler**：

```php
<?php

namespace App\Application\Order;

use App\Domain\Order\Order;
use App\Domain\Order\OrderItem;
use App\Domain\Order\OrderRepository;
use App\Domain\Order\PaymentGateway;
use App\Domain\Order\StockService;
use App\Domain\Shared\EventBus;

class PlaceOrderHandler
{
    public function __construct(
        private OrderRepository $orders,
        private StockService $stockService,
        private PaymentGateway $payment,
        private EventBus $events
    ) {}

    public function handle(PlaceOrderCommand $command): Order
    {
        // 1. 构建值对象
        $items = array_map(
            fn(array $item) => new OrderItem(
                $item['product_id'],
                $item['quantity'],
                $item['price']
            ),
            $command->items
        );

        // 2. 创建订单实体（业务规则在实体内部执行）
        $order = Order::place(
            $command->customerId,
            $items,
            $this->stockService
        );

        // 3. 持久化订单
        $this->orders->save($order);

        // 4. 扣减库存
        foreach ($items as $item) {
            $this->stockService->deduct($item->productId(), $item->quantity());
        }

        // 5. 预创建支付
        $this->payment->reserve($order->id(), $order->totalAmount());

        // 6. 发布领域事件
        foreach ($order->pullDomainEvents() as $event) {
            $this->events->dispatch($event);
        }

        return $order;
    }
}
```

注意 Handler 的构造函数——它依赖的全是**接口**（端口），不依赖任何具体实现。这就是依赖倒置原则（DIP）在 Laravel 中的体现。

### 3.4 Infrastructure 层：适配器实现

**Eloquent 适配器**：

```php
<?php

namespace App\Infrastructure\Persistence\Eloquent;

use App\Domain\Order\Order;
use App\Domain\Order\OrderId;
use App\Domain\Order\OrderItem;
use App\Domain\Order\OrderRepository;
use App\Infrastructure\Persistence\Eloquent\Models\OrderModel;

class EloquentOrderRepository implements OrderRepository
{
    public function save(Order $order): void
    {
        $model = OrderModel::updateOrCreate(
            ['order_id' => $order->id()->value()],
            [
                'customer_id' => $order->customerId(),
                'status' => $order->status()->value,
                'total_amount' => $order->totalAmount(),
                'cancelled_at' => $order->cancelledAt(),
                'items' => array_map(fn(OrderItem $item) => [
                    'product_id' => $item->productId(),
                    'quantity' => $item->quantity(),
                    'price' => $item->price(),
                ], $order->items()),
            ]
        );
    }

    public function findById(OrderId $id): ?Order
    {
        $model = OrderModel::where('order_id', $id->value())->first();

        if (!$model) {
            return null;
        }

        return $this->toEntity($model);
    }

    public function findByCustomerId(string $customerId): array
    {
        return OrderModel::where('customer_id', $customerId)
            ->get()
            ->map(fn(OrderModel $m) => $this->toEntity($m))
            ->toArray();
    }

    public function nextId(): OrderId
    {
        return OrderId::generate();
    }

    private function toEntity(OrderModel $model): Order
    {
        // 从 Eloquent Model 还原为领域实体
        // 这里需要使用反射或者受保护的重建方法
        return Order::reconstitute(
            new OrderId($model->order_id),
            $model->customer_id,
            array_map(
                fn(array $item) => new OrderItem(
                    $item['product_id'],
                    $item['quantity'],
                    $item['price']
                ),
                $model->items
            ),
            OrderStatus::from($model->status),
            $model->created_at,
            $model->cancelled_at
        );
    }
}
```

**支付网关适配器**：

```php
<?php

namespace App\Infrastructure\Payment;

use App\Domain\Order\OrderId;
use App\Domain\Order\PaymentGateway;

class StripePaymentGateway implements PaymentGateway
{
    public function __construct(
        private \Stripe\StripeClient $stripe
    ) {}

    public function reserve(OrderId $orderId, float $amount): string
    {
        $intent = $this->stripe->paymentIntents->create([
            'amount' => (int)($amount * 100),
            'currency' => 'usd',
            'capture_method' => 'manual',
            'metadata' => ['order_id' => $orderId->value()],
        ]);

        return $intent->id;
    }

    public function capture(string $paymentId): bool
    {
        $this->stripe->paymentIntents->capture($paymentId);
        return true;
    }

    public function refund(string $paymentId, float $amount): bool
    {
        $this->stripe->refunds->create([
            'payment_intent' => $paymentId,
            'amount' => (int)($amount * 100),
        ]);
        return true;
    }
}
```

---

## 四、Laravel Service Container 与六边形架构的结合

### 4.1 接口绑定

六边形架构的"最后一公里"是将端口与适配器在容器中绑定。这是 Laravel 最擅长的事情：

```php
<?php

namespace App\Infrastructure\Providers;

use Illuminate\Support\ServiceProvider;
use App\Domain\Order\OrderRepository;
use App\Domain\Order\PaymentGateway;
use App\Domain\Order\StockService;
use App\Domain\Shared\EventBus;
use App\Infrastructure\Persistence\Eloquent\EloquentOrderRepository;
use App\Infrastructure\Persistence\Eloquent\EloquentProductRepository;
use App\Infrastructure\Payment\StripePaymentGateway;
use App\Infrastructure\Messaging\LaravelEventBus;

class HexagonalServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 端口 → 适配器绑定
        $this->app->bind(OrderRepository::class, EloquentOrderRepository::class);
        $this->app->bind(PaymentGateway::class, StripePaymentGateway::class);
        $this->app->bind(StockService::class, EloquentStockService::class);
        $this->app->bind(EventBus::class, LaravelEventBus::class);
    }
}
```

### 4.2 上下文绑定：同一接口不同实现

在实际项目中，你可能需要根据不同的上下文（测试、生产、不同租户）使用不同的适配器实现。Laravel 的 `Contextual Binding` 完美支持这一需求：

```php
// 在 ServiceProvider 中
$this->app->when(PlaceOrderHandler::class)
    ->needs(OrderRepository::class)
    ->give(EloquentOrderRepository::class);

$this->app->when(ExportOrderHandler::class)
    ->needs(OrderRepository::class)
    ->give(ReadOnlyOrderRepository::class);

// 测试环境
$this->app->when(PlaceOrderHandler::class)
    ->needs(OrderRepository::class)
    ->give(InMemoryOrderRepository::class);
```

### 4.3 Tagged Bindings：批量管理适配器

当适配器数量增长时，可以用 Laravel 的 Tag 特性批量管理：

```php
// 注册
$this->app->tag([
    StripePaymentGateway::class,
    AlipayPaymentGateway::class,
    WechatPayGateway::class,
], 'payment-gateways');

// 使用
public function __construct(
    #[Tagged('payment-gateways')] iterable $gateways
) {
    $this->gateways = $gateways;
}
```

---

## 五、实战案例：电商订单系统的六边形架构重构

### 5.1 传统 Controller-Service-Repository 的问题

让我们先看看一个典型的 Laravel 订单处理代码：

```php
// 传统方式：Controller
class OrderController extends Controller
{
    public function store(PlaceOrderRequest $request)
    {
        $order = Order::create([
            'customer_id' => auth()->id(),
            'status' => 'pending',
            'total_amount' => 0,
        ]);

        $total = 0;
        foreach ($request->items as $item) {
            $product = Product::findOrFail($item['product_id']);

            if ($product->stock < $item['quantity']) {
                return back()->withErrors(['stock' => '库存不足']);
            }

            $order->items()->create([
                'product_id' => $product->id,
                'quantity' => $item['quantity'],
                'price' => $product->price,
            ]);

            $product->decrement('stock', $item['quantity']);
            $total += $product->price * $item['quantity'];
        }

        $order->update(['total_amount' => $total]);

        // 支付
        $stripe = new \Stripe\StripeClient(config('services.stripe.secret'));
        $intent = $stripe->paymentIntents->create([...]);

        // 通知
        Mail::to(auth()->user())->send(new OrderPlacedMail($order));

        // 事件
        event(new OrderPlaced($order));

        return redirect()->route('orders.show', $order);
    }
}
```

这段代码的问题一目了然：

1. **业务逻辑泄漏到 Controller**：库存检查、金额计算、状态管理全在 Controller 里
2. **直接依赖 Eloquent**：`Order::create()`、`Product::findOrFail()` 硬编码
3. **直接依赖 Stripe**：支付逻辑与 HTTP 层耦合
4. **无法单元测试**：必须启动完整的 Laravel 应用、连接数据库
5. **不可替换**：从 Stripe 切换到支付宝，需要修改 Controller 代码

### 5.2 重构为 Command → Handler → Port → Adapter

重构的核心思路是将上述代码拆解为四个层次：

**第一层：驱动适配器（Controller）只做翻译**

```php
<?php

namespace App\Http\Controllers;

use App\Http\Requests\PlaceOrderRequest;
use App\Application\Order\PlaceOrderCommand;
use App\Application\Shared\CommandBus;
use Illuminate\Http\JsonResponse;

class OrderController extends Controller
{
    public function __construct(
        private CommandBus $commandBus
    ) {}

    public function store(PlaceOrderRequest $request): JsonResponse
    {
        // Controller 只负责翻译：HTTP Request → Command
        $command = new PlaceOrderCommand(
            customerId: auth()->id(),
            items: $request->validated('items')
        );

        $order = $this->commandBus->dispatch($command);

        return response()->json([
            'order_id' => $order->id()->value(),
            'total' => $order->totalAmount(),
            'status' => $order->status()->value,
        ], 201);
    }
}
```

**第二层：命令处理器编排业务流程**

（已在 3.3 节展示 PlaceOrderHandler）

**第三层：领域实体执行业务规则**

（已在 3.2 节展示 Order 实体）

**第四层：适配器实现外部集成**

（已在 3.4 节展示 EloquentOrderRepository 和 StripePaymentGateway）

### 5.3 完整的请求流程

让我们跟踪一个完整的下单请求流程：

```
HTTP POST /api/orders
    │
    ▼
[Driving Adapter] OrderController::store()
    │  翻译 HTTP Request → PlaceOrderCommand
    ▼
[Application] CommandBus → PlaceOrderHandler::handle()
    │
    ▼
[Domain] Order::place()          ← 业务规则在此执行
    │  - 检查库存
    │  - 创建订单实体
    │  - 计算总金额
    │  - 记录领域事件
    │
    ▼
[Driven Port] OrderRepository::save()
    │
    ▼
[Driven Adapter] EloquentOrderRepository::save()
    │  - 转换实体为 Eloquent Model
    │  - 持久化到数据库
    │
    ▼
[Driven Port] StockService::deduct()
    │
    ▼
[Driven Adapter] EloquentStockService::deduct()
    │  - 扣减库存
    │
    ▼
[Driven Port] PaymentGateway::reserve()
    │
    ▼
[Driven Adapter] StripePaymentGateway::reserve()
    │  - 调用 Stripe API
    │
    ▼
[Driven Port] EventBus::dispatch()
    │
    ▼
[Driven Adapter] LaravelEventBus::dispatch()
    │  - 触发 Laravel 事件系统
    ▼
返回 Order 实体 → Controller 转换为 JSON Response
```

---

## 六、端口设计原则：依赖倒置与接口隔离

### 6.1 依赖倒置在 Laravel 中的实践

依赖倒置原则（DIP）要求：**高层模块不应依赖低层模块，两者都应依赖抽象**。在六边形架构中，这意味着：

```php
// ❌ 错误：领域层依赖基础设施
namespace App\Domain\Order;

use Illuminate\Database\Eloquent\Model;

class Order extends Model  // 依赖了 Eloquent！
{
    // ...
}

// ✅ 正确：领域层定义接口，基础设施实现
namespace App\Domain\Order;

interface OrderRepository  // 纯接口，无外部依赖
{
    public function save(Order $order): void;
    public function findById(OrderId $id): ?Order;
}
```

### 6.2 接口隔离原则（ISP）

接口隔离原则要求：**客户端不应被迫依赖它不使用的接口**。在实践中：

```php
// ❌ 过于庞大的接口
interface OrderRepository
{
    public function save(Order $order): void;
    public function findById(OrderId $id): ?Order;
    public function findByCustomerId(string $customerId): array;
    public function findByDateRange(DateTime $from, DateTime $to): array;
    public function exportToCsv(array $filters): string;
    public function generateReport(): array;
    public function syncWithERP(): void;
}

// ✅ 接口隔离：按职责拆分
interface OrderWriter
{
    public function save(Order $order): void;
}

interface OrderReader
{
    public function findById(OrderId $id): ?Order;
    public function findByCustomerId(string $customerId): array;
}

interface OrderExporter
{
    public function exportToCsv(array $filters): string;
    public function generateReport(): array;
}
```

在 Laravel 中，你可以利用接口组合（Interface Segregation + Multiple Inheritance of Interface）：

```php
// 适配器可以实现多个接口
class EloquentOrderRepository implements OrderWriter, OrderReader
{
    // 同时实现读写能力
}

class ReadOnlyOrderRepository implements OrderReader
{
    // 只读副本，用于查询场景
}
```

### 6.3 端口粒度的权衡

端口设计中一个常见的纠结是粒度问题。太粗的端口会导致适配器臃肿，太细的端口会导致接口爆炸。实战中的经验法则：

- **按限界上下文（Bounded Context）组织端口**：`OrderRepository`、`ProductRepository` 而不是 `DatabaseRepository`
- **端口的方法签名使用领域语言**：`reserve()` 而不是 `createPaymentIntent()`
- **一个端口对应一个业务关注点**：如果一个接口的方法在不同场景下被不同使用，考虑拆分

---

## 七、测试策略

### 7.1 六边形架构的测试优势

六边形架构最大的回报体现在测试上。由于领域层不依赖任何外部设施，我们可以用纯 PHP 进行单元测试：

```php
<?php

namespace Tests\Unit\Domain\Order;

use App\Domain\Order\Order;
use App\Domain\Order\OrderItem;
use App\Domain\Order\OrderStatus;
use App\Domain\Order\StockService;
use PHPUnit\Framework\TestCase;
use Mockery;

class OrderTest extends TestCase
{
    /** @test */
    public function it_can_place_an_order_with_available_stock(): void
    {
        // Arrange
        $stockService = Mockery::mock(StockService::class);
        $stockService->shouldReceive('isAvailable')
            ->with('product-1', 2)
            ->andReturn(true);

        $items = [new OrderItem('product-1', 2, 99.99)];

        // Act
        $order = Order::place('customer-1', $items, $stockService);

        // Assert
        $this->assertEquals(OrderStatus::PENDING, $order->status());
        $this->assertEquals(199.98, $order->totalAmount());
        $this->assertCount(1, $order->pullDomainEvents());
    }

    /** @test */
    public function it_throws_when_stock_insufficient(): void
    {
        $stockService = Mockery::mock(StockService::class);
        $stockService->shouldReceive('isAvailable')
            ->andReturn(false);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('insufficient stock');

        Order::place('customer-1', [new OrderItem('product-1', 10, 10)], $stockService);
    }

    /** @test */
    public function it_cannot_cancel_a_shipped_order(): void
    {
        $order = Order::reconstitute(
            new OrderId('test-id'),
            'customer-1',
            [],
            OrderStatus::SHIPPED,
            new \DateTimeImmutable(),
            null
        );

        $this->expectException(\RuntimeException::class);
        $order->cancel();
    }
}
```

注意：这个测试**不需要 Laravel TestCase**，不需要数据库，不需要 `RefreshDatabase` trait，运行速度极快。

### 7.2 集成测试：验证适配器

集成测试用于验证适配器是否正确实现了端口契约：

```php
<?php

namespace Tests\Integration\Infrastructure;

use App\Infrastructure\Persistence\Eloquent\EloquentOrderRepository;
use App\Domain\Order\Order;
use App\Domain\Order\OrderItem;
use App\Domain\Order\OrderStatus;
use Tests\TestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;

class EloquentOrderRepositoryTest extends TestCase
{
    use RefreshDatabase;

    private EloquentOrderRepository $repository;

    protected function setUp(): void
    {
        parent::setUp();
        $this->repository = app(EloquentOrderRepository::class);
    }

    /** @test */
    public function it_can_save_and_retrieve_an_order(): void
    {
        // 创建实体
        $order = Order::reconstitute(
            $this->repository->nextId(),
            'customer-123',
            [new OrderItem('prod-1', 3, 50.0)],
            OrderStatus::PENDING,
            new \DateTimeImmutable(),
            null
        );

        // 保存
        $this->repository->save($order);

        // 检索
        $retrieved = $this->repository->findById($order->id());

        $this->assertNotNull($retrieved);
        $this->assertEquals($order->id()->value(), $retrieved->id()->value());
        $this->assertEquals(150.0, $retrieved->totalAmount());
    }
}
```

### 7.3 端口契约测试

一个更高级的技巧是编写**契约测试（Contract Test）**，确保所有适配器实现都满足端口契约：

```php
<?php

namespace Tests\Contract;

use App\Domain\Order\OrderRepository;
use PHPUnit\Framework\TestCase;

abstract class OrderRepositoryContractTest extends TestCase
{
    abstract protected function createRepository(): OrderRepository;

    /** @test */
    public function it_returns_null_for_nonexistent_order(): void
    {
        $repo = $this->createRepository();
        $result = $repo->findById(new OrderId('nonexistent'));
        $this->assertNull($result);
    }

    /** @test */
    public function it_can_save_and_retrieve(): void
    {
        $repo = $this->createRepository();
        // ... 通用测试逻辑
    }
}

// InMemory 实现的测试
class InMemoryOrderRepositoryTest extends OrderRepositoryContractTest
{
    protected function createRepository(): OrderRepository
    {
        return new InMemoryOrderRepository();
    }
}

// Eloquent 实现的测试
class EloquentOrderRepositoryTest extends OrderRepositoryContractTest
{
    use RefreshDatabase;

    protected function createRepository(): OrderRepository
    {
        return app(EloquentOrderRepository::class);
    }
}
```

---

## 八、与 DDD 的结合

### 8.1 六边形架构是 DDD 的物理实现

六边形架构与 DDD 的关系可以用一个比喻来理解：DDD 定义了"设计什么"，六边形架构定义了"代码放哪里"。

| DDD 概念 | 六边形架构对应位置 |
|---------|----------------|
| 实体（Entity） | Domain 层 |
| 值对象（Value Object） | Domain 层 |
| 聚合根（Aggregate Root） | Domain 层的实体 |
| 领域服务（Domain Service） | Domain 层 |
| 领域事件（Domain Event） | Domain 层定义，Application 层分发 |
| 仓储（Repository） | Domain 层定义接口，Infrastructure 层实现 |
| 应用服务（Application Service） | Application 层的 Handler |
| 限界上下文（Bounded Context） | Domain 层的子目录划分 |

### 8.2 聚合根在六边形架构中的实现

```php
<?php

namespace App\Domain\Order;

// Order 是聚合根，所有对 OrderItem 的操作必须通过 Order
class Order
{
    // ...

    public function addItem(string $productId, int $quantity, float $price): void
    {
        if ($this->status !== OrderStatus::PENDING) {
            throw new RuntimeException('Cannot modify a non-pending order');
        }

        $this->items[] = new OrderItem($productId, $quantity, $price);
    }

    public function removeItem(string $productId): void
    {
        if ($this->status !== OrderStatus::PENDING) {
            throw new RuntimeException('Cannot modify a non-pending order');
        }

        $this->items = array_values(array_filter(
            $this->items,
            fn(OrderItem $item) => $item->productId() !== $productId
        ));
    }
}
```

---

## 九、六边形架构的优缺点与适用场景

### 9.1 优势

1. **可测试性**：领域逻辑可以纯单元测试，不依赖框架
2. **可替换性**：切换存储、支付、消息队列等外部依赖，只需更换适配器
3. **业务聚焦**：开发者关注业务规则而非框架 API
4. **并行开发**：前后端、不同适配器可以独立开发
5. **框架无关**：理论上可以从 Laravel 迁移到 Symfony 而不改动领域层

### 9.2 劣势

1. **初期开发成本高**：需要定义接口、编写映射代码、维护多层结构
2. **学习曲线陡峭**：团队需要理解端口、适配器、依赖反转等概念
3. **代码量增加**：同一个功能需要接口 + 实现 + 映射，代码量约为 MVC 的 1.5-2 倍
4. **过度设计风险**：简单 CRUD 项目套用六边形架构是杀鸡用牛刀
5. **实体映射成本**：领域实体与 Eloquent Model 之间的转换代码是主要维护负担

### 9.3 适用场景判断矩阵

| 项目特征 | 建议架构 | 理由 |
|---------|---------|------|
| 简单 CRUD，< 10 个表 | 标准 MVC | 六边形架构的额外成本不值得 |
| 中等复杂度，有外部集成 | 六边形架构（2层） | 需要可替换的外部依赖 |
| 高复杂度，长期维护 | Clean Architecture（4层） | 需要更精细的职责划分 |
| 微服务架构 | 六边形架构 + DDD | 每个服务是一个限界上下文 |
| 快速原型开发 | MVC 或 Livewire | 速度优先，架构后补 |

---

## 十、渐进式迁移策略

### 10.1 从 MVC 到六边形架构的四步迁移

对于现有 Laravel 项目，不建议一次性重构。推荐渐进式迁移：

**Phase 1：提取端口接口（1-2 周）**

```php
// 在 app/Domain/ 目录下定义接口
// 但实现仍使用现有的 Repository/Service
app/Domain/Order/OrderRepository.php  // 新增接口
app/Repositories/OrderRepository.php  // 现有实现，改为 implements OrderRepository
```

**Phase 2：提取领域实体（2-4 周）**

```php
// 将 Eloquent Model 中的业务逻辑迁移到纯 PHP 实体
app/Domain/Order/Order.php  // 纯 PHP 实体
app/Models/Order.php        // 瘦身为纯数据模型
```

**Phase 3：提取命令处理器（2-4 周）**

```php
// 将 Service 层的业务编排迁移到 Handler
app/Application/Order/PlaceOrderHandler.php
app/Services/OrderService.php  // 逐步废弃
```

**Phase 4：重构适配器（持续）**

```php
// 将基础设施代码迁移到 Infrastructure 目录
app/Infrastructure/Persistence/EloquentOrderRepository.php
app/Infrastructure/Payment/StripePaymentGateway.php
```

### 10.2 Strangler Fig 模式

借鉴 Strangler Fig（绞杀者榕树）模式，新功能用六边形架构开发，旧功能逐步迁移：

```php
// 路由中混合使用新旧架构
Route::post('/orders', [OrderController::class, 'store']);           // 新：六边形
Route::get('/orders/{id}', [LegacyOrderController::class, 'show']); // 旧：MVC

// 在 LegacyOrderController 中逐步引入端口
class LegacyOrderController extends Controller
{
    public function show(string $id)
    {
        // 第一步：通过端口获取数据
        $order = app(OrderReader::class)->findById(new OrderId($id));

        // 仍然返回 Blade 视图（旧的展示方式）
        return view('orders.show', compact('order'));
    }
}
```

---

## 十一、常见踩坑与最佳实践

### 11.1 踩坑一：Eloquent Model 污染领域实体

**问题**：开发者习惯让领域实体继承 Eloquent Model，导致领域层依赖框架。

**解决**：严格分离领域实体和持久化模型，使用映射器（Mapper）或手动转换。

### 11.2 踩坑二：贫血领域模型

**问题**：实体只有 getter/setter，所有逻辑在 Handler 或 Service 中，失去了六边形架构的核心收益。

**解决**：将业务规则（状态校验、金额计算、业务约束）放在实体内部，Handler 只做编排。

### 11.3 踩坑三：端口粒度失控

**问题**：要么端口过于庞大（一个 Repository 接口 20 个方法），要么过于细碎（每个字段一个接口）。

**解决**：按限界上下文和聚合根组织端口，遵循接口隔离原则。

### 11.4 踩坑四：在 Domain 层使用 Facade

**问题**：在领域实体或服务中使用 `Cache::get()`、`Log::info()` 等 Facade。

**解决**：通过依赖注入传入缓存、日志等能力的接口。

### 11.5 踩坑五：忽略领域事件

**问题**：在 Handler 中直接调用通知、缓存清理等副作用代码，导致 Handler 臃肿。

**解决**：使用领域事件解耦，让副作用代码订阅事件而非直接调用。

### 11.6 最佳实践清单

1. **Domain 目录不引入任何 Laravel 命名空间**（`use Illuminate\...`）
2. **实体通过工厂方法创建**，构造函数设为 private 或 protected
3. **值对象是不可变的**（immutable），所有属性 readonly
4. **一个 Handler 对应一个 Command**，遵循 CQRS 的 Single Responsibility
5. **适配器接口返回领域对象**，不返回 Eloquent Collection
6. **测试中使用 InMemory 适配器**替代真实数据库
7. **持续重构**：不要试图一步到位，渐进式迁移更安全
8. **Code Review 关注依赖方向**：确保 Domain 不依赖 Infrastructure

---

## 十二、进阶话题：六边形架构 + CQRS

在更复杂的场景下，六边形架构可以与 CQRS（Command Query Responsibility Segregation）结合：

```php
// 命令端（写）：走完整的六边形架构
app/Application/Order/PlaceOrderCommand.php
app/Application/Order/PlaceOrderHandler.php
app/Domain/Order/Order.php
app/Infrastructure/Persistence/EloquentOrderRepository.php

// 查询端（读）：直接使用 Eloquent，跳过领域层
app/Application/Order/Queries/GetOrderQuery.php
app/Application/Order/Queries/GetOrderHandler.php
app/Infrastructure/ReadModels/OrderReadModel.php
```

查询端不需要走完整的端口-适配器流程，直接使用 Eloquent 优化查询即可。这种"写走六边形、读走直连"的模式在实际项目中非常实用。

---

## 总结

六边形架构不是银弹，但它为 Laravel 项目提供了一个**在架构复杂度和可维护性之间的优秀平衡点**。通过本文的对比分析和实战案例，我们可以看到：

1. **六边形架构与 Clean Architecture 的核心差异**在于层数和复杂度——六边形架构的两层结构更适合 Laravel 项目
2. **端口与适配器的本质**是依赖反转原则的显式化——通过接口定义契约，通过实现提供能力
3. **Laravel 的 Service Container**是六边形架构落地的最佳粘合剂——接口绑定、上下文绑定、Tag 绑定完美支持端口-适配器模式
4. **渐进式迁移**是将现有 MVC 项目迁移到六边形架构的最安全路径

**最终建议**：如果你的 Laravel 项目同时满足「业务逻辑复杂 + 长期维护 + 团队 ≥ 3 人」这三个条件，六边形架构值得投入。如果是简单 CRUD，老老实实用 MVC。架构是为人服务的，不是人为架构服务的。

---

> **相关阅读**：
> - [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)
> - [DDD 在 Laravel 中的实战指南](/categories/架构/2026-06-01-ddd-in-laravel-guidearchitecture/)
> - [Functional Core, Imperative Shell 实战：Laravel 函数式核心](/categories/架构/2026-06-06-functional-core-imperative-shell-laravel/)
> - [Laravel Modular Monolith 实战：模块化单体架构](/categories/架构/2026-06-04-Laravel-Modular-Monolith-实战-模块化单体架构-介于单体与微服务之间的最佳平衡点/)

## 相关阅读

- [WebTransport 实战：HTTP/3 上的双向通信——对比 WebSocket 的低延迟传输协议与 Laravel 实时应用集成](/categories/架构/WebTransport-实战-HTTP3-双向通信-对比WebSocket低延迟传输协议-Laravel实时应用集成/)
- [AI Agent Orchestration Patterns 2026：Supervisor/Router/Swarm/DAG 四种编排模式的适用场景与工程选型](/categories/架构/AI-Agent-Orchestration-Patterns-2026-Supervisor-Router-Swarm-DAG-编排模式选型/)
- [Developer Productivity Metrics 实战：SPACE 框架度量开发者效能——DORA 之外的代码质量、协作效率与满意度追踪](/categories/架构/Developer-Productivity-Metrics-SPACE框架度量开发者效能-DORA之外的代码质量协作效率与满意度追踪/)
