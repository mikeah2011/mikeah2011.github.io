---
title: 领域驱动设计 (DDD) 在 Laravel 中的实践
tags: [Laravel, 架构]
categories:
  - Misc
  - Laravel
date: 2026-05-03 11:46:40
description: "领域驱动设计 (DDD) 在 Laravel 中的实践"
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

---

*本文经验来自实际项目落地，如有疑问欢迎讨论。*