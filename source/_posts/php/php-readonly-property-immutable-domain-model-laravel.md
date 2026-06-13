---
title: PHP readonly Property 实战深度：Immutable Domain Model 在 Laravel 中的工程化
keywords: [PHP readonly Property, Immutable Domain Model, Laravel, 实战深度, 中的工程化, PHP]
date: 2026-06-10 04:25:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - PHP 8.1
  - readonly
  - 不可变对象
  - Domain Model
  - DTO
  - Laravel
  - 设计模式
description: PHP 8.1 readonly property 深度实战：readonly 构造器提升、DTO 不可变链、Eloquent 只读投影——在 Laravel 中构建 Immutable Domain Model 的完整工程化方案与踩坑记录
---


## 概述

PHP 8.1 引入的 `readonly` 属性，不仅仅是语法糖。它是 PHP 走向不可变编程范式的关键一步。在 Laravel 大型项目中，尤其是 B2C 电商这种领域模型复杂的场景，`readonly` 能从根本上消除一类 bug——**对象状态被意外修改**。

本文基于 30+ 仓库的实战经验，从底层原理到生产落地，完整讲解如何用 `readonly` 构建不可变领域模型。

---

## 核心概念：readonly 的本质

### readonly 属性的三条铁律

```php
class Money
{
    public function __construct(
        public readonly int $amount,
        public readonly string $currency,
    ) {}
}
```

**铁律一：只允许写入一次**

```php
$money = new Money(100, 'USD');
$money->amount = 200; // ❌ Error: readonly property Money::$amount cannot be modified
```

**铁律二：声明时必须初始化**

```php
class Order
{
    public readonly string $status; // ❌ 没有默认值 + 没有构造器初始化 = Fatal Error
}
```

**铁律三：不能有默认值（除 null）**

```php
class Config
{
    public readonly string $name = 'default'; // ❌ 不能给非 null 默认值
    public readonly ?string $optional = null;  // ✅ 允许 null 默认值
}
```

### readonly vs const vs final 的定位

| 特性 | `const` | `final` | `readonly` |
|------|---------|---------|------------|
| 适用对象 | 类/接口 | 方法/属性/类 | 属性 |
| 运行时可变 | ❌ 编译时常量 | ❌ 不可覆写 | ✅ 只能赋值一次 |
| 继承影响 | 子类可读 | 子类不可覆写 | 子类不可覆写（readonly 是 final 的子集） |
| 序列化 | ✅ | ✅ | ✅ |

**关键理解**：`readonly` 和 `final` 在属性层面的语义几乎一致，但 `readonly` 额外禁止了在构造器之外的任何赋值。这使得它天然适合构建 DTO 和值对象。

---

## 实战一：readonly 构造器提升

### 基础模式：构造器提升

PHP 8.0 引入了构造器提升（Constructor Promotion），8.1 在此基础上增加 `readonly`：

```php
// 传统写法（冗长）
class ProductSku
{
    private int $id;
    private string $sku;
    private string $name;
    private int $price;
    private string $currency;

    public function __construct(
        int $id,
        string $sku,
        string $name,
        int $price,
        string $currency
    ) {
        $this->id = $id;
        $this->sku = $sku;
        $this->name = $name;
        $this->price = $price;
        $this->currency = $currency;
    }
}

// readonly 构造器提升（简洁 + 不可变）
class ProductSku
{
    public function __construct(
        public readonly int $id,
        public readonly string $sku,
        public readonly string $name,
        public readonly int $price,
        public readonly string $currency,
    ) {}
}
```

### 实战场景：API 响应 DTO

在 B2C 电商中，API 响应需要从 Eloquent Model 转换为标准化的 DTO：

```php
class ProductListResponse
{
    /** @param ProductItemDto[] $items */
    public function __construct(
        public readonly array $items,
        public readonly int $total,
        public readonly int $page,
        public readonly int $perPage,
        public readonly bool $hasMore,
    ) {}

    public function toArray(): array
    {
        return [
            'items' => array_map(fn ($item) => $item->toArray(), $this->items),
            'pagination' => [
                'total' => $this->total,
                'page' => $this->page,
                'per_page' => $this->perPage,
                'has_more' => $this->hasMore,
            ],
        ];
    }
}

class ProductItemDto
{
    public function __construct(
        public readonly int $id,
        public readonly string $name,
        public readonly int $price,
        public readonly string $currency,
        public readonly string $imageUrl,
        public readonly float $rating,
        public readonly int $reviewCount,
    ) {}

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'price' => $this->price,
            'currency' => $this->currency,
            'image_url' => $this->imageUrl,
            'rating' => $this->rating,
            'review_count' => $this->reviewCount,
        ];
    }
}
```

**为什么 DTO 必须是 readonly？**

- DTO 一旦创建就不应该被修改，它是数据的**快照**
- Controller 层传递 DTO 给 View/Resource，任何中间环节的修改都会导致数据不一致
- readonly 从语言层面保证了这一点，不需要靠开发者"自律"

---

## 实战二：DTO 不可变链

### 问题：传统 DTO 的修改风险

```php
// 传统可变 DTO —— 随时可能被意外修改
class OrderDto
{
    public int $orderId;
    public string $status;
    public int $totalAmount;

    public function toArray(): array { /* ... */ }
}

// 在某个 Service 中
$dto = new OrderDto();
$dto->orderId = $order->id;
$dto->status = $order->status;
$dto->totalAmount = $order->totalAmount;

// ... 传递给多个地方 ...

// 某个不知道的人在某个 Service 中
$dto->status = 'cancelled'; // 💥 污染了原始数据
```

### 解决：readonly + with 方法链

```php
class OrderDto
{
    public function __construct(
        public readonly int $orderId,
        public readonly string $status,
        public readonly int $totalAmount,
        public readonly string $currency,
        public readonly int $customerId,
        public readonly ?string $note,
    ) {}

    /**
     * 不可变更新：返回新实例，原实例不变
     */
    public function with(array $attributes): self
    {
        return new self(
            orderId: $attributes['orderId'] ?? $this->orderId,
            status: $attributes['status'] ?? $this->status,
            totalAmount: $attributes['totalAmount'] ?? $this->totalAmount,
            currency: $attributes['currency'] ?? $this->currency,
            customerId: $attributes['customerId'] ?? $this->customerId,
            note: $attributes['note'] ?? $this->note,
        );
    }

    public function toArray(): array
    {
        return [
            'order_id' => $this->orderId,
            'status' => $this->status,
            'total_amount' => $this->totalAmount,
            'currency' => $this->currency,
            'customer_id' => $this->customerId,
            'note' => $this->note,
        ];
    }
}
```

使用方式：

```php
$original = new OrderDto(
    orderId: 12345,
    status: 'pending',
    totalAmount: 9900,
    currency: 'TWD',
    customerId: 67890,
    note: null,
);

// 派生新实例，原实例不受影响
$withNote = $original->with(['note' => '请尽快发货']);
$cancelled = $original->with(['status' => 'cancelled']);

// 链式调用
$enriched = $original
    ->with(['status' => 'confirmed'])
    ->with(['note' => 'VIP 客户']);

// 原实例完全不变
echo $original->status;  // 'pending' ✅
echo $withNote->status;  // 'pending' ✅
echo $cancelled->status; // 'cancelled' ✅
```

### 进阶：泛型风格的 DTO 基类

```php
/**
 * 不可变 DTO 基类
 * 
 * @template T of array
 */
abstract class ImmutableDto
{
    /**
     * @param T $attributes
     */
    abstract public function toArray(): array;

    /**
     * 从数组创建实例
     * 
     * @param T $data
     */
    abstract public static function fromArray(array $data): static;

    /**
     * 不可变更新
     * 
     * @param T $attributes
     */
    public function with(array $attributes): static
    {
        return static::fromArray(
            array_merge($this->toArray(), $attributes)
        );
    }
}

// 使用
class ProductDto extends ImmutableDto
{
    public function __construct(
        public readonly int $id,
        public readonly string $name,
        public readonly int $price,
    ) {}

    public static function fromArray(array $data): static
    {
        return new static(
            id: $data['id'],
            name: $data['name'],
            price: $data['price'],
        );
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'price' => $this->price,
        ];
    }
}
```

---

## 实战三：Eloquent 只读投影

### 场景：从数据库查询构建不可变视图

在实际项目中，我们经常需要从 Eloquent Model 构建只读的"投影"对象，用于 API 输出、报表、导出等场景：

```php
class ProductSummary
{
    public function __construct(
        public readonly int $id,
        public readonly string $name,
        public readonly int $price,
        public readonly string $category,
        public readonly int $stockQuantity,
        public readonly float $averageRating,
        public readonly int $totalReviews,
        public readonly bool $isInStock,
    ) {}

    /**
     * 从 Product Model 投影
     */
    public static function fromModel(Product $product): self
    {
        return new self(
            id: $product->id,
            name: $product->name,
            price: $product->price,
            category: $product->category->name,
            stockQuantity: $product->stock_quantity,
            averageRating: $product->reviews()->avg('rating') ?? 0,
            totalReviews: $product->reviews()->count(),
            isInStock: $product->stock_quantity > 0,
        );
    }

    /**
     * 批量投影
     */
    public static function fromCollection($products): array
    {
        return $products->map(fn ($p) => self::fromModel($p))->all();
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'price' => $this->price,
            'category' => $this->category,
            'stock_quantity' => $this->stockQuantity,
            'average_rating' => $this->averageRating,
            'total_reviews' => $this->totalReviews,
            'is_in_stock' => $this->isInStock,
        ];
    }
}
```

### 场景：查询结果的不可变包装

```php
class OrderSearchResult
{
    /** @param OrderDto[] $orders */
    public function __construct(
        public readonly array $orders,
        public readonly int $total,
        public readonly array $filters,
        public readonly \DateTimeImmutable $executedAt,
    ) {}

    public static function fromQuery(Builder $query, array $filters, int $perPage, int $page): self
    {
        $paginator = $query->paginate($perPage, ['*'], 'page', $page);

        $orders = $paginator->getCollection()
            ->map(fn (Order $order) => new OrderDto(
                orderId: $order->id,
                status: $order->status,
                totalAmount: $order->total_amount,
                currency: $order->currency,
                customerId: $order->customer_id,
                note: $order->note,
            ))
            ->all();

        return new self(
            orders: $orders,
            total: $paginator->total(),
            filters: $filters,
            executedAt: new \DateTimeImmutable('now', new \DateTimeZone('Asia/Shanghai')),
        );
    }

    public function toArray(): array
    {
        return [
            'orders' => array_map(fn ($o) => $o->toArray(), $this->orders),
            'total' => $this->total,
            'filters' => $this->filters,
            'executed_at' => $this->executedAt->format('Y-m-d H:i:s'),
        ];
    }
}
```

---

## 实战四：readonly 与 Laravel 集成

### 问题：Laravel 序列化与 readonly

Laravel 的队列、缓存等组件需要序列化对象。readonly 属性在反序列化时有特殊行为：

```php
// ✅ readonly DTO 可以正常序列化和反序列化
$dto = new OrderDto(
    orderId: 123,
    status: 'pending',
    totalAmount: 5000,
    currency: 'TWD',
    customerId: 456,
    note: null,
);

$serialized = serialize($dto);
$unserialized = unserialize($serialized);

// $unserialized 的属性值完全保留
echo $unserialized->orderId; // 123
```

### 问题：Laravel Form Request 与 readonly

Form Request 的 `validated()` 返回数组，不会触发 readonly 问题。但如果想在 FormRequest 中构建 readonly DTO：

```php
class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'product_id' => 'required|integer|exists:products,id',
            'quantity' => 'required|integer|min:1|max:100',
            'note' => 'nullable|string|max:500',
        ];
    }

    /**
     * 构建不可变的订单 DTO
     */
    public function toOrderDto(): OrderDto
    {
        return new OrderDto(
            orderId: 0, // 待分配
            status: 'pending',
            totalAmount: $this->calculateTotal(),
            currency: 'TWD',
            customerId: $this->user()->id,
            note: $this->input('note'),
        );
    }

    private function calculateTotal(): int
    {
        $product = Product::findOrFail($this->input('product_id'));
        return $product->price * $this->input('quantity');
    }
}
```

### 问题：Eloquent Accessor 与 readonly

Eloquent 的 accessor 返回的值不能直接赋值给 readonly 属性（因为 readonly 属性必须在构造时赋值）。正确做法是在构造时通过 accessor 获取数据：

```php
class ProductResource extends JsonResource
{
    public function toArray($request): array
    {
        // 从 Model 构建 readonly DTO，而非直接操作 Model
        $dto = ProductSummary::fromModel($this->resource);

        return [
            'data' => $dto->toArray(),
            'meta' => [
                'cached_at' => now()->toISOString(),
            ],
        ];
    }
}
```

---

## 踩坑记录

### 坑 1：readonly 属性不能在子类中覆写为非 readonly

```php
class Base
{
    public readonly string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}

class Child extends Base
{
    public string $name; // ❌ 子类不能把 readonly 降级为普通属性
}
```

**解决方案**：如果子类需要可变属性，应该重新设计，而不是降级父类的 readonly。

### 坑 2：readonly 与 `#[LazyLoading]` 冲突

```php
class Order
{
    public readonly int $id;
    public readonly string $status;
    // ...
}

// 如果使用 Laravel 的 lazy loading
$order = Order::find(1); // Eloquent Model 不是 readonly DTO，这没问题
// 但如果你把 Eloquent Model 声明为 readonly... 
```

**关键区分**：readonly DTO 是从 Eloquent Model **投影**出来的，不是 Eloquent Model 本身。Eloquent Model 继承自 `Model`，其属性是动态的，不适合声明为 readonly。

### 坑 3：readonly 属性的默认值陷阱

```php
class Config
{
    // ❌ 不能有非 null 默认值
    public readonly string $name = 'default';

    // ✅ 允许 null 默认值
    public readonly ?string $name = null;

    // ✅ 通过构造器提升 + 默认参数值
    public function __construct(
        public readonly string $name = 'default', // PHP 8.1 不允许
    ) {}
}
```

PHP 8.1 中，readonly 属性**不能在声明时赋默认值**（null 除外）。如果需要默认值，用构造器参数的默认值：

```php
class Config
{
    public function __construct(
        public readonly string $name = 'default', // PHP 8.1 允许构造器参数默认值
        public readonly int $timeout = 30,
    ) {}
}
```

### 坑 4：反射修改 readonly 属性

```php
$money = new Money(100, 'USD');

// 通过反射可以绕过 readonly 限制（不推荐）
$reflection = new \ReflectionProperty($money, 'amount');
$reflection->setValue($money, 200); // 不会报错！

// 但在 PHP 8.2+ 中这会触发 deprecation warning
// PHP 9.0 可能会禁止这种行为
```

**建议**：不要依赖反射绕过 readonly。如果需要修改，设计上就有问题。

### 坑 5：readonly 与 Laravel 队列的 `dispatch` 参数

```php
// ❌ 错误：不能在 Job 中直接接收 readonly DTO
class ProcessOrderJob implements ShouldQueue
{
    public function __construct(
        public readonly OrderDto $orderDto, // ✅ 可以，因为 Job 构造时赋值
    ) {}

    public function handle(): void
    {
        // $this->orderDto 的属性是只读的
        // 但对象本身可以被替换
        $this->orderDto = $this->orderDto->with(['status' => 'processing']); // ✅ 替换整个对象
    }
}
```

---

## 最佳实践总结

### 什么时候用 readonly

| 场景 | 推荐 | 原因 |
|------|------|------|
| API 响应 DTO | ✅ readonly | 数据快照，不应修改 |
| 值对象（Money, Address 等） | ✅ readonly | 值语义，相等性由值决定 |
| 配置对象 | ✅ readonly | 配置加载后不变 |
| Eloquent Model | ❌ 不用 | Eloquent 是可变的 ORM 层 |
| FormRequest | ❌ 不用 | Request 本身就是可变的 |
| 中间件传递的上下文 | ⚠️ 考虑 | 如果只需要传递，readonly 更安全 |

### 设计原则

1. **DTO 层必须 readonly**：API 输出、队列 Job 参数、事件 Payload 都应该用 readonly DTO
2. **用 `with()` 替代直接赋值**：需要"修改"时，创建新实例而非修改原实例
3. **构造器是唯一写入点**：readonly 属性只能在构造器中赋值，这是特性不是限制
4. **投影而非继承**：不要让 DTO 继承 Eloquent Model，而是从 Model 投影到 readonly DTO
5. **序列化安全**：readonly DTO 可以正常 serialize/unserialize，放心用于队列和缓存

### 性能考量

readonly 属性的性能影响几乎为零。PHP 引擎对 readonly 的检查在编译期完成，运行时的开销仅仅是赋值时的一次检查。在 B2C 电商的高并发场景中，readonly DTO 的创建和传递不会成为瓶颈。

---

## 总结

PHP 8.1 的 `readonly` 属性是构建不可变领域模型的基石。在 Laravel 大型项目中：

- **readonly DTO** 消除了数据传递中的意外修改
- **`with()` 方法链** 提供了安全的不可变更新
- **Eloquent 投影** 在可变 ORM 层和不可变业务层之间建立了清晰边界
- **序列化兼容** 让 readonly DTO 可以无缝集成 Laravel 队列和缓存

从"能用"到"用好"，关键在于理解 readonly 的设计意图：**让不可变成为默认，让可变成为例外**。这不仅仅是代码风格的改变，更是编程思维的升级。
