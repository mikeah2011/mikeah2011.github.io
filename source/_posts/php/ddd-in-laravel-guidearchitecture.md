---
title: 领域驱动设计 (DDD) 在 Laravel 中的实践
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags: [Laravel, DDD, 领域驱动设计, 聚合根, 值对象, 领域事件, 限界上下文, 架构]
keywords: [DDD, Laravel, 领域驱动设计, 中的实践, 技术杂谈, PHP]
categories:
  - misc
  - php
date: 2026-05-03 11:46:40
description: "本文深入探讨领域驱动设计（DDD）在 Laravel 项目中的落地实践，涵盖聚合根、值对象、领域事件、限界上下文等核心概念的完整代码实现。通过真实的踩坑案例，详解 Eloquent ORM 与 DDD 的冲突解决、跨聚合边界访问、领域事件可靠性保证等难题，提供从贫血模型到富领域模型的渐进式迁移方案与性能优化策略。"
updated: 2026-05-03 11:54:57



---

## 引言：为什么要引入 DDD？

在 Laravel 项目开发中，随着业务复杂度提升，传统的 MVC 架构往往陷入"贫血模型"的困境——Controller、Model、Service 各自为战，领域知识散落在各处。本文分享我们在实际项目中落地 DDD 的经验，包括完整的架构设计、代码实现和踩坑记录。

## 核心概念梳理

### 实体 vs 值对象

```php
// ❌ 贫血模型：Entity 只是一个数据容器
class User {
    public string $name;
    public int $age;
    
    // 直接修改属性，业务逻辑分散
    public function setAge(int $age) {
        $this->age = $age;
    }
}

// ✅ DDD 实践：丰富的 Entity
class User implements AggregateRoot {
    protected string $name;
    protected int $age;
    protected string $email;
    
    public function __construct(
        string $name, 
        int $age, 
        string $email
    ) {
        if ($this->validateAge($age)) {
            $this->age = $age;
        } else {
            throw new InvalidArgumentException('年龄必须在 1-120 之间');
        }
        
        // 业务规则内聚在 Entity 中
        $this->email = Address::build($email);  // 值对象
    }
    
    public function changeAge(int $age): void {
        if ($this->validateAge($age)) {
            $this->emitEvent(new AgeChangedEvent($this->name, $age));
            $this->age = $age;
        } else {
            throw new InvalidArgumentException('年龄变更失败');
        }
    }
    
    private function validateAge(int $age): bool {
        return $age >= 1 && $age <= 120;
    }
}

// ✅ 值对象：无身份，纯数据验证
class Address implements ValueObject {
    public string $street;
    public string $city;
    public string $province;
    
    protected array $postalCodeRules = [
        'CN' => '/^\d{6}$/',
        'US' => '/^\d{5}(?:-\d{4})?$/'
    ];
    
    public static function build(
        string $street, 
        string $city, 
        string $province, 
        string $postalCode = null,
        ?string $country = 'CN'
    ): self {
        return new self($street, $city, $province, $postalCode, $country);
    }
    
    public function __construct(
        string $street, 
        string $city, 
        string $province, 
        string $postalCode = null,
        ?string $country = 'CN'
    ) {
        if (!array_key_exists($country ?? 'CN', $this->postalCodeRules)) {
            throw new InvalidArgumentException('不支持的国家');
        }
        
        if (!$this->validatePostalCode($postalCode ?? '', $country)) {
            throw new InvalidArgumentException('邮编格式错误');
        }
        
        $this->street = trim($street);
        $this->city = trim($city);
        $this->province = trim($province);
        $this->postalCode = $postalCode;
        $this->country = $country ?? 'CN';
    }
    
    private function validatePostalCode(
        string $code, 
        string $country
    ): bool {
        return preg_match($this->postalCodeRules[$country] ?? '/^.{1,20}$/', $code);
    }
}
```

### 限界上下文（Bounded Context）

在大型系统中，同一个概念在不同上下文中可能有不同含义。例如"用户"在**订单上下文**中是买家，在**客服上下文**中是投诉人，在**营销上下文**中是推广目标。将这些不同的语义隔离开来，就是限界上下文的核心思想。

```php
// 订单上下文中的 User —— 关注购买能力和收货地址
namespace App\Domain\OrderContext\Entities;

class Buyer {
    public function __construct(
        private string $id,
        private string $name,
        private CreditLimit $creditLimit,
        private Address $defaultShippingAddress
    ) {}

    public function canAfford(Money $amount): bool {
        return $this->creditLimit->isEnoughFor($amount);
    }

    public function getShippingAddress(): Address {
        return $this->defaultShippingAddress;
    }
}

// 客服上下文中的 User —— 关注工单和投诉历史
namespace App\Domain\CustomerService\Entities;

class Customer {
    public function __construct(
        private string $id,
        private string $name,
        private TicketCollection $openTickets,
        private ComplaintHistory $complaintHistory
    ) {}

    public function hasOpenComplaints(): bool {
        return $this->openTickets->hasType(TicketType::COMPLAINT);
    }

    public function isHighRisk(): bool {
        return $this->complaintHistory->count() > 5;
    }
}
```

**限界上下文之间的通信**通过领域事件或防腐层（Anti-Corruption Layer）实现：

```php
// 防腐层：订单上下文 → 库存上下文 的适配器
namespace App\Domain\OrderContext\Gateways;

class InventoryGateway {
    public function __construct(
        private InventoryHttpClient $client  // 基础设施层的 HTTP 客户端
    ) {}

    public function checkAvailability(string $sku, int $quantity): bool {
        // 调用库存微服务 API，而非直接查库——避免上下文耦合
        $response = $this->client->get("/api/inventory/{$sku}");
        return $response['available'] >= $quantity;
    }

    public function reserve(string $sku, int $quantity, string $orderId): ReservationId {
        $response = $this->client->post('/api/inventory/reserve', [
            'sku'      => $sku,
            'quantity' => $quantity,
            'order_id' => $orderId,
        ]);

        return new ReservationId($response['reservation_id']);
    }
}
```

> **经验法则**：一个限界上下文 = 一个独立的 Domain 子目录 = 一套独立的数据库表（微服务场景下为独立 schema）。如果两个模块频繁产生"共享模型"的冲动，说明它们应该被划分到不同的限界上下文中，通过事件或防腐层进行通信。

### 聚合根设计

```php
// ✅ Order 作为聚合根
class Order implements AggregateRoot {
    private string $id;
    private int $userId;
    private Collection $items;
    private Address $shippingAddress;
    private Money $totalAmount;
    private PaymentStatus $status;
    
    private function __construct() {}
    
    public static function create(
        string $id, 
        int $userId, 
        Collection $items, 
        Address $shippingAddress
    ): self {
        $order = new self();
        $order->setId($id);
        $order->setUserId($userId);
        $order->setItems($items);
        $order->setShippingAddress($shippingAddress);
        
        // 计算总金额（业务逻辑内聚）
        $total = $items->sum(fn(Item $item) => 
            Item::calculatePrice($item->price, $item->quantity)
        );
        $order->setTotalAmount(Money::fromDecimalPlaces($total));
        
        // 初始状态为待支付
        $order->setStatus(new PaymentStatus('pending'));
        
        return $order;
    }
    
    public function addItem(Item $item): void {
        if ($this->status->isCancelled()) {
            throw new AggregateException('已取消的订单无法添加商品');
        }
        
        // 验证库存逻辑放在 Domain Layer
        Inventory::checkAndReserve($item->sku, $item->quantity);
        
        $this->items->add($item);
        
        // 修改金额，触发事件
        $total = $this->items->sum(fn(Item $item) => 
            Item::calculatePrice($item->price, $item->quantity)
        );
        $this->setTotalAmount(Money::fromDecimalPlaces($total));
        
        $this->emitEvent(new OrderUpdatedEvent($this->id, $total));
    }
    
    public function pay(PaymentMethod $method): void {
        if ($this->status->isPaid()) {
            throw new AggregateException('订单已支付');
        }
        
        PaymentService::process(
            $this->totalAmount,
            $method,
            fn() => $this->setStatus(new PaymentStatus('paid'))
        );
        
        // 支付成功后发布事件，触发物流等环节
        $this->emitEvent(new OrderPaidEvent($this->id, $method->type));
    }
    
    private function setId(string $id): void {
        $this->id = $id;
    }
}

class PaymentStatus implements ValueObject {
    public function __construct(
        private string $value // pending|paid|cancelled|refunded
    ) {}
    
    public function isPaid(): bool {
        return $this->value === 'paid';
    }
    
    public function isCancelled(): bool {
        return $this->value === 'cancelled';
    }
}

class Money implements ValueObject {
    private int $amount;
    private string $currency;
    
    public static function fromDecimalPlaces(float $amount, string $currency = 'CNY'): self {
        // 使用整数运算避免浮点精度问题（分）
        return new self((int)round($amount * 100), $currency);
    }
    
    public function add(Money $other): Money {
        if ($this->currency !== $other->currency) {
            throw new InvalidArgumentException('货币类型不一致');
        }
        
        $newAmount = $this->amount + $other->amount;
        return Money::fromDecimalPlaces($newAmount / 100, $this->currency);
    }
}
```

### 领域事件驱动架构

```php
// 领域事件定义
class DomainEvent {
    protected array $payload = [];
    
    public function getPayload(): array { return $this->payload; }
    public function setPayload(array $payload): void { $this->payload = $payload; }
}

class AgeChangedEvent extends DomainEvent {
    public string $name;
    public int $newAge;
    
    public function __construct(string $name, int $age) {
        $this->name = $name;
        $this->newAge = $age;
    }
}

class OrderUpdatedEvent extends DomainEvent {
    public string $orderId;
    public Money $totalAmount;
    
    public function __construct(string $orderId, Money $amount) {
        $this->orderId = $orderId;
        $this->totalAmount = $amount;
    }
}

class OrderPaidEvent extends DomainEvent {
    public string $orderId;
    public string $paymentMethod;
    
    public function __construct(string $orderId, string $method) {
        $this->orderId = $orderId;
        $this->paymentMethod = $method;
    }
}

// 事件订阅器实现（配合 Event Dispatcher）
class OrderPaidEventHandler implements ShouldHandleDomainEvents {

    public function handle(OrderPaidEvent $event): void {
        // 异步发送短信通知
        Notification::send($event->orderId, new PaymentSuccessNotification());

        // 创建物流订单
        LogisticsService::createOrder(
            orderNumber: 'EXP-' . $event->orderId,
            recipientAddressId: Order::fromOrderId($event->orderId)->shippingAddress->id
        );

        // 更新库存（扣减已下单但未发货的商品）
        Inventory::reserveToOrder($event->orderId);
    }

    public function shouldHandle(OrderPaidEvent $event): bool {
        return true;
    }
}
```

### 领域服务（Domain Service）vs 应用服务

初学者最容易混淆领域服务和应用服务。两者的核心区别如下：

| 维度 | 领域服务（Domain Service） | 应用服务（Application Service） |
|------|---------------------------|-------------------------------|
| **职责** | 封装不自然属于任何实体的领域逻辑 | 编排用例流程，协调多个聚合 |
| **依赖** | 只依赖领域层接口 | 依赖领域层 + 基础设施层 |
| **示例** | 价格计算引擎、风控策略、折扣策略 | 订单下单流程、转账编排 |
| **可测试性** | 纯单元测试，无需 Mock 框架 | 需要 Mock Repository/Gateway |
| **是否感知框架** | 否（纯 PHP 类） | 可以感知 Laravel（如事务管理） |

```php
// ✅ 领域服务：跨聚合的纯业务逻辑，不依赖任何框架
namespace App\Domain\Services;

class PricingService {
    public function __construct(
        private DiscountPolicyInterface $discountPolicy,
        private TaxCalculatorInterface $taxCalculator
    ) {}

    public function calculateOrderTotal(
        Collection $items,
        ?CouponCode $coupon,
        Address $shippingAddress
    ): OrderTotal {
        $subtotal = $items->reduce(
            fn(Money $carry, OrderItem $item) => $carry->add($item->getSubtotal()),
            Money::zero('CNY')
        );

        // 应用折扣策略（策略模式）
        $discount = $this->discountPolicy->calculate($subtotal, $coupon);
        $afterDiscount = $subtotal->subtract($discount);

        // 计算税费（根据收货地址的税务规则）
        $tax = $this->taxCalculator->calculate($afterDiscount, $shippingAddress);

        return new OrderTotal(
            subtotal: $subtotal,
            discount: $discount,
            tax: $tax,
            grandTotal: $afterDiscount->add($tax)
        );
    }
}

// ✅ 应用服务：编排用例流程，协调多个领域对象
class PlaceOrderCommand {
    public function __construct(
        private OrderRepositoryInterface $orderRepo,
        private PricingService $pricingService,       // 领域服务
        private InventoryGateway $inventoryGateway,    // 基础设施
        private EventDispatcherInterface $dispatcher   // 领域事件
    ) {}

    public function execute(PlaceOrderDTO $dto): OrderId {
        // 1. 验证库存（通过基础设施层）
        foreach ($dto->items as $item) {
            if (!$this->inventoryGateway->checkAvailability($item->sku, $item->quantity)) {
                throw new InsufficientStockException($item->sku);
            }
        }

        // 2. 计算价格（领域服务，纯业务逻辑）
        $pricingResult = $this->pricingService->calculateOrderTotal(
            OrderItem::fromDTOs($dto->items),
            $dto->couponCode ? CouponCode::fromString($dto->couponCode) : null,
            Address::fromDTO($dto->shippingAddress)
        );

        // 3. 创建订单（聚合根）
        $order = Order::place(
            OrderId::generate(),
            $dto->userId,
            OrderItem::fromDTOs($dto->items),
            $pricingResult
        );

        // 4. 持久化 + 事件发布
        $this->orderRepo->save($order);
        $this->dispatcher->dispatchAll($order->pullDomainEvents());

        return $order->getId();
    }
}
```

> **关键原则**：领域服务不应该知道"谁调用了它"。它接收纯领域对象（Entity、ValueObject），返回纯领域对象。所有与外部世界的交互（数据库、HTTP、队列）都交给应用服务和基础设施层处理。

## Laravel 中的架构分层

### 项目目录结构

```
app/
├── Domain/           # 领域层（核心业务）
│   ├── Entities/     # Entity
│   ├── ValueObjects/# ValueObject
│   ├── Aggregates/   # AggregateRoot
│   └── Events/       # DomainEvent + EventSubscriber
│
├── Infrastructure/   # 基础设施层（具体实现）
│   ├── Repositories/ # Repository 接口实现
│   ├── Services/     # Application Service
│   └── Gateways/     # External API (Payment, SMS, Email)
│
├── Application/      # 应用层（编排领域服务）
│   ├── Commands/     # Use Case
│   └── DTOs/         # Data Transfer Object
│
└── Presentation/     # 表现层
    ├── Controllers/
    ├── Middleware/
    └── Resources/

config/
├── domain.php        # DDD 配置
└── repositories.php  # Repository 绑定
```

### 依赖注入配置

```php
// config/domains.php
return [
    'entity_manager' => Illuminate\Database\Eloquent\Model::class,
    
    // Repository 策略模式
    'repositories' => [
        'order' => \App\Infrastructure\Repositories\OrderRepository::class,
        'user'   => \App\Infrastructure\Repositories\UserRepository::class,
    ],
    
    // Event Dispatcher 订阅器
    'event_subscribers' => [
        OrderPaidEvent::class => [\App\Domain\Events\OrderPaidEventHandler::class],
        AgeChangedEvent::class => [\App\Domain\Events\AgeChangedEventHandler::class],
    ],
];

// Bootstrap 中初始化领域层
$app->singleton('domain.event.dispatcher', function ($app) {
    $dispatcher = new Events();
    
    foreach ($config['event_subscribers'] as $event => $subscribers) {
        foreach (array_flatten($subscribers) as $subscriber) {
            if (!$dispatcher->hasSubscriber($event)) {
                $dispatcher->subscribe(new ReflectionClass($event), $subscriber);
            }
        }
    }
    
    return $dispatcher;
});

// 使用领域服务编排 Use Case
class OrderCheckoutCommand implements CommandInterface {
    
    public function __construct(
        private OrderRepository $orderRepo,
        private PaymentGatewayFactory $paymentGateway
    ) {}
    
    public function execute(OrderCreateDTO $dto): OrderSummary {
        // 1. 获取聚合根（从 Repository）
        $user = $this->orderRepo->findUser($dto->userId);
        
        // 2. 创建订单（Domain Layer 方法）
        $items = collect($dto->items)->map(fn(array $item) => Item::create(
            $item['sku'], 
            $item['quantity']
        ));
        
        $order = Order::create(
            OrderId::generate(),
            $user->id,
            $items,
            Address::buildFromDatabase($dto->shippingAddressId)
        );
        
        // 3. 支付（应用层编排）
        $paymentMethod = $this->paymentGateway->getByType($dto->paymentMethod);
        $order->pay($paymentMethod);
        
        // 4. 持久化（Domain Event 自动触发）
        $this->orderRepo->save($order);
        
        return new OrderSummary($order);
    }
}

// Use Case 控制器调用
class OrderController {
    
    public function checkout(OrderCheckoutCommand $command, Request $request) {
        $dto = new OrderCreateDTO(
            userId: $request->user()->id,
            items: json_decode($request->input('items')),
            shippingAddressId: $request->input('shipping_address_id'),
            paymentMethod: $request->input('payment_method')
        );
        
        return response()->json([
            'order' => $command->execute($dto)->toArray(),
        ]);
    }
}
```

## 架构示意图

```
┌─────────────────────────────────────────────────────────────┐
│                      Presentation Layer                       │
│           ┌─────────────┐    ┌─────────────┐                 │
│           │ Controllers │    │  Middleware │                 │
│           └─────────────┼──┬─┴─────────────┤                 │
│                         │  │                │                 │
│                         ▼  ▼                │                 │
│                   ┌─────────────────────────────┐            │
│                   │    Application Layer        │            │
│                   │     Use Case Commands       │            │
│                   │    (Orchestration Layer)   │            │
│                   └──────────────────┬─────────┘            │
└─────────────────────────────────────┼───────────────────────┘
                                      │
                              ┌───────▼───────┐
                              │Domain Layer   │◄──事件发布点
                              │  (Core Business)    ───────────> Event Dispatcher
                              │   Entity       │                 │
                              │ Aggregates     │◄────────────────┼── Domain Events
                              │ ValueObjects   │                 │
                              └───────────────┘                 │
                                       ▲                        │
                                       │                        │
                              ┌────────▼────────┐               │
                              │Infrastructure   │               │
                              │  Layer          │               │
                              │Repository Impl.│               │
                              │Gateway Impl.   │               │
                              └────────────────┘               │
                                       ▲                       │
                                       │                       │
                              ┌────────▼─────────┐              │
                              │   External APIs  │              │
                              │ (Payment, SMS)  │              │
                              └─────────────────┘              │
                                                           ┌───┴───┐
                                                           ▼──────► Persistence (DB/Cache/MQ)
```

## 踩坑记录与解决方案

### 坑 1：Laravel Eloquent ORM 与 DDD 的冲突

**问题现象：**
直接使用 `$user = User::find($id)` 会返回贫血的 Model，无法调用领域方法。

**错误代码：**
```php
// ❌ 违反单一职责，Model 变成了 Repository
class User extends Model {
    public function placeOrder($items) {
        // 订单逻辑应该在 Domain Layer，不应该在 Model 中
        $order = Order::createWithItems($this->id, $items);
    }
}
```

**解决方案：**
使用 Trait 辅助 + Repository 分离：

```php
// app/Domain/Entities/User.php
class User implements AggregateRoot {
    
    public function placeOrder(Collection $items, ShippingAddress $shipping): Order {
        return Order::createWithItems(
            $this->getId(),
            $items->map(fn(ItemDTO $dto) => Item::fromDto($dto)),
            $shipping
        );
    }
}

// app/Infrastructure/Repositories/UserRepository.php
class UserRepository implements UserRepositoryInterface {
    
    use EloquentEntityTrait; // 辅助 Trait
    
    protected array $mapping = [
        'id' => 'id',
        'name' => 'name',
        'email' => 'email',
    ];
    
    public function findUser(int $id): User {
        $model = User::where('id', $id)->first();
        
        // 将 Eloquent Model 转换为 Domain Entity
        return new User(
            id: (string)$model->id,
            name: $model->name,
            email: $model->email
        );
    }
}

// app/Domain/Traits/EloquentEntityTrait.php
trait EloquentEntityTrait {
    
    protected string $table;
    
    protected function fromModel(Model $model): static {
        // 根据 mapping 规则转换
        return new self(...array_map(fn($key) => 
            $model[$this->mapping[$key] ?? $key], 
            array_keys((new ReflectionClass($this))->getConstructor()->getParameters())
        ));
    }
}
```

### 坑 2：跨领域访问破坏边界

**问题现象：**
聚合根 A 中直接调用聚合根 B 的领域方法，导致事务粒度失控。

**错误代码：**
```php
class User {
    
    public function transferFundsTo(User $target, int $amount) {
        // ❌ 破坏了聚合边界
        $target->addBalance($amount);  // 调用外部聚合的领域方法
        
        // 应该通过 Application Service 编排
        TransferService::transfer($this, $target, $amount);
    }
}
```

**解决方案：**
使用 Application Service 作为编排者：

```php
class FundTransferCommand implements CommandInterface {
    
    private UserRepository $userRepo;
    
    public function __construct(UserRepository $repo) {
        $this->userRepo = $repo;
    }
    
    public function execute(TransferDTO $dto): TransferResult {
        // 只读取，不调用领域方法
        $sourceUser = $this->userRepo->findUserById($dto->sourceId);
        $targetUser = $this->userRepo->findUserById($dto->targetId);
        
        // 通过 Infrastructure 的 Service 层调用
        TransferGateway::execute(
            source: $sourceUser,
            target: $targetUser,
            amount: $dto->amount
        );
        
        return new TransferResult(
            transactionId: TransferGateway::getTransactionId(),
            success: true
        );
    }
}

// Infrastructure 中的 Transfer Gateway
class TransferGateway {
    
    private UserRepositoryInterface $userRepo;
    private PaymentGateway $paymentGateway;
    
    public function execute(User $source, User $target, int $amount): string {
        // 使用支付网关的 API
        return $this->paymentGateway->transfer(
            fromAccount: $source->getAccountId(),
            toAccount: $target->getAccountId(),
            amount: $amount
        );
    }
}
```

### 坑 3：领域事件在异步环境中的可靠性保证

**问题现象：**
`OrderPaidEvent` 触发的物流创建、短信通知等异步操作可能失败，导致数据不一致。

**解决方案：**
使用消息队列 + 重试机制：

```php
// app/Infrastructure/EventDispatchers/PersistentEventDispatcher.php
class PersistentEventDispatcher implements EventDispatcherInterface {
    
    private Queue $queue;
    private DatabaseRepository $eventStore;
    
    public function dispatch(Event $event): void {
        try {
            // 1. 写入数据库（确保事件不丢失）
            $this->eventStore->store($event);
            
            // 2. 推送到消息队列
            $payload = json_encode([
                'type' => get_class($event),
                'payload' => (array)$event,
                'occurred_at' => now()->toDateTimeString(),
            ]);
            
            $this->queue->push('domain.events', $payload);
            
        } catch (Exception $e) {
            // 抛出异常，由 Laravel 的 Exception Handler 处理重试
            throw new DomainException(
                'Event dispatch failed: ' . $e->getMessage(),
                0,
                $e
            );
        }
    }
    
    public function retryFailedEvents(): void {
        $failedEvents = $this->eventStore->getFailedEvents();
        
        foreach ($failedEvents as $event) {
            try {
                // 重新发布
                $this->dispatch($event);
                
                // 标记为成功
                $this->eventStore->markAsSuccess($event->id);
                
            } catch (Exception $e) {
                // 记录失败日志，等待下次重试
                $this->eventStore->incrementRetryCount($event->id);
                
                Log::error('Event dispatch failed again', [
                    'event_id' => $event->id,
                    'retry_count' => $event->retries,
                    'message' => $e->getMessage(),
                ]);
            }
        }
    }
}

// 在 Console Kernel 中触发重试
Console::kernel()->schedule(function (Scheduler $scheduler) {
    $scheduler->command('events:retry-failed')->everyMinute()
                ->onFailure(function () {
                    // 记录失败事件
                });
});
```

## 性能优化建议

### 1. Repository 层添加缓存

```php
// app/Infrastructure/Repositories/OrderRepository.php
class OrderRepository implements OrderRepositoryInterface {
    
    private Redis $redis;
    
    public function __construct(Redis $redis) {
        $this->redis = $redis;
    }
    
    public function findById(string $id): Order {
        // 1. 先查缓存
        $cached = $this->redis->get("order:{$id}");
        
        if ($cached) {
            return new Order(json_decode($cached, true));
        }
        
        // 2. 查数据库
        $model = Order::where('id', $id)->first();
        
        if (!$model) {
            return null;
        }
        
        // 3. 写入缓存
        $this->redis->set(
            "order:{$id}",
            json_encode($this->convertToDomainEntity($model)),
            ['expire' => 3600]
        );
        
        return $this->convertToDomainEntity($model);
    }
    
    private function convertToDomainEntity(Model $model): Order {
        // 将 Eloquent Model 转换为 Domain Entity
        // ...
    }
}

// 使用 Redis Tag-based Cache 清理
public function markAsPaid(string $orderId, PaymentResult $result): void {
    $order = new Order(/*...*/);
    $this->save($order);
    
    // 标记相关缓存过期
    Cache::tags(['orders', "orders.{$orderId}"])->flush();
}
```

### 2. 避免在领域层直接查询数据库

```php
// ✅ 正确：Repository 返回 Domain Entity
class OrderCommand {
    
    public function __construct(
        private UserRepository $userRepo,
        private OrderRepository $orderRepo
    ) {}
    
    public function execute(OrderDTO $dto): OrderResult {
        // Repository 只负责获取聚合根，不关心实现细节
        $user = $this->userRepo->findUser($dto->userId);
        $existingOrder = $this->orderRepo->findByUserIdAndStatus(
            $dto->userId,
            OrderStatus::CREATED
        );
        
        // 领域层处理业务逻辑
        if ($existingOrder) {
            throw new DuplicateOrderException('用户已有创建中的订单');
        }
        
        // ...
    }
}

// ❌ 错误：在 Use Case 中直接调用 Model
class OrderCommand {
    
    public function execute(OrderDTO $dto): OrderResult {
        // Repository 接口不暴露 Model
        $existingOrder = Order::where('user_id', $dto->userId)
                             ->where('status', 'created')
                             ->first();  // ❌ 违反依赖倒置
        
        // ...
    }
}
```

## 架构方案对比

在 Laravel 项目中，常见的架构方案有三种。以下是它们在关键维度上的横向对比，帮助你根据项目阶段做出务实的选择：

| 维度 | 传统 MVC + Service Layer | 领域驱动设计（DDD） | CQRS + Event Sourcing |
|------|------------------------|--------------------|-----------------------|
| **适用场景** | CRUD 为主、业务逻辑简单 | 业务复杂、领域规则多 | 高并发读写分离、需审计追踪 |
| **学习成本** | ★★☆☆☆ | ★★★★☆ | ★★★★★ |
| **代码量** | 少（脚手架即可生成） | 多（显式建模开销） | 最多（读写双模型 + 事件存储） |
| **业务规则归属** | 散落在 Controller/Service | 内聚在 Entity/Domain Service | 命令处理器 + 聚合根 |
| **可测试性** | 差（强依赖 Laravel 框架） | 好（纯 PHP 单元测试） | 好（事件可回放验证） |
| **数据库耦合** | 高（Eloquent 到处使用） | 低（通过 Repository 抽象） | 极低（事件存储即真理源） |
| **团队要求** | 初级即可上手 | 需要领域建模经验 | 需要事件驱动架构经验 |
| **推荐项目** | 后台管理系统、CMS | 电商、金融、SaaS 平台 | 金融交易、订单履约 |

> **务实建议**：不必在项目一开始就全面引入 DDD。当 `app/Services/` 下的文件超过 30 个、业务规则开始交叉耦合、一个 Service 改动引发多处回归时，再逐步将核心模块迁移到领域模型。

## 总结与最佳实践

1. **领域层是核心**：保持纯粹的 PHP 类，不依赖 Laravel 的 Eloquent、Facades、Services。使用 Repository 抽象所有数据访问。

2. **使用 DTO 作为输入输出容器**：DTO 可以包含验证逻辑，适合在 Application Layer 中使用。

3. **事件驱动架构**：通过领域事件解耦异步操作，但要注意事件的幂等性和持久化。

4. **测试策略**：
   - Unit Test：测试 Entity、ValueObject、Domain Event（独立于基础设施）
   - Integration Test：测试 Use Case + Repository 实现
   - Acceptance Test：端到端的业务流程

5. **逐步迁移**：不必一次性重构整个项目，选择边界清晰的业务模块逐步引入 DDD。

DDD 不是银弹，但对于复杂业务系统，它能帮助团队建立清晰的领域模型，让代码真正反映业务知识，而非仅仅是 CRUD 操作。在实践中，关键是保持耐心、持续迭代，并根据团队能力逐步深入。

## 相关阅读

- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/) —— DDD 的领域层如何通过端口与适配器实现依赖反转
- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/categories/架构/CQRS-Event-Sourcing-完整实战-从事件存储到读模型投影-Laravel订单系统的端到端实现/) —— 将本文的领域事件进一步升级为完整的事件溯源架构
- [Event Storming 实战：从业务事件到代码实现的领域建模方法论](/categories/架构/Event-Storming-实战-从业务事件到代码实现的领域建模方法论-Laravel-B2C-API踩坑记录/) —— 在动手写代码之前，如何用 Event Storming 工作坊发现聚合和限界上下文的边界

---

*本文经验来自实际项目落地，如有疑问欢迎讨论。*