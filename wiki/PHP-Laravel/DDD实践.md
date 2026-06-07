# DDD 领域驱动设计

## 定义

DDD（Domain-Driven Design）= 以业务领域为核心驱动软件设计。关注点从「技术分层」转向「业务建模」。

## 核心概念

### 限界上下文（Bounded Context）

```
订单上下文 → Order、OrderItem、OrderStatus
支付上下文 → Payment、Refund、Transaction
库存上下文 → Inventory、Stock、Reservation
```

同一个「商品」在不同上下文中含义不同。

### 聚合根（Aggregate Root）

```php
class Order extends AggregateRoot {
    private array $items = [];

    public function addItem(Product $product, int $qty): void {
        // 业务规则：同一商品不能重复添加
        if ($this->hasItem($product->id)) {
            throw new DuplicateItemException();
        }
        $this->items[] = new OrderItem($product, $qty);
        $this->recordThat(new ItemAdded($this->id, $product->id, $qty));
    }
}
```

聚合根是入口点，所有修改必须通过聚合根。

### 值对象（Value Object）

```php
readonly class Money {
    public function __construct(
        public int $amount,
        public string $currency,
    ) {}

    public function add(Money $other): Money {
        if ($this->currency !== $other->currency) {
            throw new CurrencyMismatchException();
        }
        return new Money($this->amount + $other->amount, $this->currency);
    }
}
```

值对象不可变，通过比较属性判等。

### 领域事件

```php
class OrderPlaced implements DomainEvent {
    public function __construct(
        public readonly int $orderId,
        public readonly Money $total,
        public readonly DateTimeImmutable $occurredAt,
    ) {}
}

// afterCommit 保证事件在事务提交后才触发
$aggregate->recordThat($event)->persist();
```

## Laravel 中的 DDD 分层

```
app/
├── Domain/           # 领域层（纯 PHP，不依赖框架）
│   ├── Order/
│   │   ├── Order.php            # 聚合根
│   │   ├── OrderItem.php        # 实体
│   │   ├── Money.php            # 值对象
│   │   └── OrderRepository.php  # 接口
│   └── Shared/
│       └── DomainEvent.php
├── Application/      # 应用层（用例编排）
│   └── PlaceOrderHandler.php
├── Infrastructure/   # 基础设施层（框架实现）
│   └── EloquentOrderRepo.php
└── Http/             # 接口层
    └── OrderController.php
```

## 踩坑记录

- **过度建模**：简单业务硬套 DDD → 负担大于收益
- **贫血模型**：只有 getter/setter 的「实体」不是 DDD
- **聚合边界不清**：聚合太大 → 事务冲突多；聚合太小 → 一致性难保

## 实战案例

来自博客文章：[DDD 在 Laravel 中的实践](/categories/PHP/ddd-in-laravel-guidearchitecture/) | [EventSauce 事件溯源](/categories/PHP/laravel-eventsauce-guide/) | [优惠券核销 DDD](/categories/PHP/laravel-ddd-guide-aftercommit/)

## 相关概念

- [CQRS 模式](CQRS模式.md) - 读写分离，常与 DDD 配合
- [事件驱动架构](事件驱动架构.md) - 领域事件的发布与订阅
- [Pipeline 模式](Pipeline模式.md) - 应用层的用例编排

## 常见问题

**Q: DDD 适合什么规模的项目？**
A: 复杂业务（电商、金融、物流）才值得。简单 CRUD 用三层架构即可。

**Q: Laravel 适合 DDD 吗？**
A: 适合，但需要约束。Laravel 是「约定优于配置」的框架，DDD 需要更多的手动分层。
