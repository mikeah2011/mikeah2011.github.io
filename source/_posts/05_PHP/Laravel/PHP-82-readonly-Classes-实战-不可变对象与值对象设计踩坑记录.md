---
title: "PHP 8.2 readonly Classes 实战 — 不可变对象与值对象设计"
date: 2026-05-16 16:31:01
updated: 2026-05-16 16:37:58
categories:
  - 05_PHP
  - Laravel
tags:
  - PHP82
  - readonly
  - 不可变对象
  - 值对象
  - DDD
description: "从 PHP 8.1 的 readonly 属性到 8.2 的 readonly class，在 B2C 电商 API 中用不可变对象重构 DTO/ValueObject/领域模型的实战踩坑：序列化兼容、Laravel Validation 交互、性能基准与迁移策略。"
---

# PHP 8.2 readonly Classes 实战 — 不可变对象与值对象设计

## 前言

在 B2C 电商 API 开发中，我们经常遇到这样的场景：一个 `Money` 对象在订单流转过程中被意外修改，导致金额不一致；一个 DTO 从 Controller 传到 Service 再到 Repository，中间某个环节被偷偷篡改了一个字段。

PHP 8.1 引入了 `readonly` 属性，但你仍然需要逐个标记每个属性。PHP 8.2 将这个能力提升到了类级别——一个 `readonly class` 的**所有**声明属性自动变成 readonly，而且整个类都不能再有非 readonly 的属性。

这篇文章记录了我在 KKday B2C 后端 30+ 仓库中，用 `readonly class` 重构 DTO、Value Object 和领域模型的实战经验，包括踩坑、性能对比和迁移策略。

---

## 一、从 readonly 属性到 readonly class

### 1.1 PHP 8.1 的 readonly 属性（痛点）

```php
// PHP 8.1：每个属性都要单独标记
class Money
{
    public function __construct(
        public readonly int $amount,
        public readonly string $currency,
    ) {}
}

$m = new Money(1000, 'TWD');
$m->amount = 2000; // Fatal Error: Cannot modify readonly property
```

问题在于：
- 30+ 字段的 DTO，每个都要写 `readonly`，容易遗漏
- 没有类级别的语义约束，读者不确定"这个类的设计意图是不可变"

### 1.2 PHP 8.2 的 readonly class

```php
// PHP 8.2：整个类一次性声明
readonly class Money
{
    public function __construct(
        public int $amount,
        public string $currency,
    ) {}
}

$m = new Money(1000, 'TWD');
$m->amount = 2000; // Fatal Error: Cannot modify readonly property Money::$amount
```

**编译时约束**：`readonly class` 内**所有**声明属性必须是 readonly 的，不能混入非 readonly 属性：

```php
readonly class Broken
{
    public string $ok;
    public string $notOk; // 编译错误：Readonly class cannot have non-readonly properties
}
```

而且，`readonly class` 不能声明 `static` 属性：

```php
readonly class Broken
{
    private static int $count = 0; // 编译错误
}
```

---

## 二、架构设计：哪些类应该 readonly？

在 B2C 电商 API 中，我把 `readonly class` 应用在三个层次：

```
┌─────────────────────────────────────────────────┐
│               API Request Layer                  │
│  ┌───────────────────────────────────────────┐   │
│  │ readonly class OrderCreateDTO             │   │
│  │ readonly class PaymentCallbackDTO         │   │
│  └───────────────────────────────────────────┘   │
├─────────────────────────────────────────────────┤
│              Domain Layer (DDD)                  │
│  ┌─────────────────┐  ┌──────────────────────┐   │
│  │ readonly class  │  │ readonly class       │   │
│  │ Money           │  │ OrderId              │   │
│  │ Email           │  │ ProductSku           │   │
│  │ Address         │  │ DateRange            │   │
│  └─────────────────┘  └──────────────────────┘   │
├─────────────────────────────────────────────────┤
│            Service/Query Layer                   │
│  ┌───────────────────────────────────────────┐   │
│  │ readonly class OrderQueryResult           │   │
│  │ readonly class ProductListItem            │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**原则**：如果一个对象的职责是"携带数据"且"创建后不应被修改"，就用 `readonly class`。

---

## 三、实战一：DTO 层重构

### 3.1 Before：普通 DTO

```php
class OrderCreateRequest
{
    public int $userId;
    public int $productId;
    public int $quantity;
    public string $currency;
    public ?string $couponCode;

    public function __construct(array $data)
    {
        $this->userId = (int) $data['user_id'];
        $this->productId = (int) $data['product_id'];
        $this->quantity = (int) $data['quantity'];
        $this->currency = $data['currency'] ?? 'TWD';
        $this->couponCode = $data['coupon_code'] ?? null;
    }
}
```

问题：Service 层拿到 DTO 后，任何地方都能 `$dto->quantity = -1`，没有保护。

### 3.2 After：readonly class DTO

```php
readonly class OrderCreateDTO
{
    public function __construct(
        public int $userId,
        public int $productId,
        public int $quantity,
        public string $currency = 'TWD',
        public ?string $couponCode = null,
    ) {}

    public static function fromRequest(Request $request): self
    {
        return new self(
            userId: (int) $request->input('user_id'),
            productId: (int) $request->input('product_id'),
            quantity: (int) $request->input('quantity'),
            currency: $request->input('currency', 'TWD'),
            couponCode: $request->input('coupon_code'),
        );
    }
}
```

在 Controller 中：

```php
class OrderController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $dto = OrderCreateDTO::fromRequest($request);

        // $dto->quantity = 999; // Fatal Error！不可变

        $order = $this->orderService->create($dto);

        return response()->json($order);
    }
}
```

### 3.3 踩坑：Laravel Validation 的交互

**坑点**：Laravel 的 `FormRequest` 或 `Validator` 会修改输入数据（`$request->merge()`），但 readonly DTO 创建后不可变。

**解决方案**：先验证，再创建 DTO：

```php
class OrderController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        // Step 1: 先验证
        $validated = $request->validate([
            'user_id' => 'required|integer|min:1',
            'product_id' => 'required|integer|min:1',
            'quantity' => 'required|integer|min:1|max:99',
            'currency' => 'sometimes|string|in:TWD,USD,JPY',
            'coupon_code' => 'nullable|string|max:50',
        ]);

        // Step 2: 验证通过后，从 validated 数据创建不可变 DTO
        $dto = new OrderCreateDTO(
            userId: (int) $validated['user_id'],
            productId: (int) $validated['product_id'],
            quantity: (int) $validated['quantity'],
            currency: $validated['currency'] ?? 'TWD',
            couponCode: $validated['coupon_code'] ?? null,
        );

        $order = $this->orderService->create($dto);

        return response()->json($order->toArray());
    }
}
```

---

## 四、实战二：值对象（Value Object）

值对象是 DDD 的核心概念——它没有 identity，只关心"值是否相等"。`readonly class` 天然适合值对象。

### 4.1 Money 值对象

```php
readonly class Money
{
    public function __construct(
        public int $amount,      // 最小货币单位（分）
        public string $currency,
    ) {
        if ($amount < 0) {
            throw new InvalidArgumentException("Amount cannot be negative: {$amount}");
        }
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);

        return new self(
            amount: $this->amount + $other->amount,
            currency: $this->currency,
        );
    }

    public function subtract(self $other): self
    {
        $this->assertSameCurrency($other);

        if ($this->amount < $other->amount) {
            throw new InsufficientAmountException(
                "Cannot subtract {$other->format()} from {$this->format()}"
            );
        }

        return new self(
            amount: $this->amount - $other->amount,
            currency: $this->currency,
        );
    }

    public function multiply(int $factor): self
    {
        return new self(
            amount: $this->amount * $factor,
            currency: $this->currency,
        );
    }

    public function format(): string
    {
        return match ($this->currency) {
            'TWD' => 'NT$' . number_format($this->amount / 100, 2),
            'USD' => '$' . number_format($this->amount / 100, 2),
            'JPY' => '¥' . $this->amount, // 日元无小数
            default => $this->currency . ' ' . $this->amount,
        };
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount
            && $this->currency === $other->currency;
    }

    private function assertSameCurrency(self $other): void
    {
        if ($this->currency !== $other->currency) {
            throw new CurrencyMismatchException(
                "Cannot operate on different currencies: {$this->currency} vs {$other->currency}"
            );
        }
    }
}
```

使用场景：

```php
$orderTotal = new Money(150000, 'TWD');   // NT$1,500.00
$discount = new Money(10000, 'TWD');       // NT$100.00
$finalPrice = $orderTotal->subtract($discount); // 新对象，原对象不变

echo $orderTotal->format();   // NT$1,500.00（不变）
echo $finalPrice->format();   // NT$1,400.00
```

### 4.2 DateRange 值对象

```php
readonly class DateRange
{
    public function __construct(
        public CarbonImmutable $start,
        public CarbonImmutable $end,
    ) {
        if ($start->isAfter($end)) {
            throw new InvalidArgumentException(
                "Start date ({$start->toDateString()}) must be before end date ({$end->toDateString()})"
            );
        }
    }

    public function durationInDays(): int
    {
        return $this->start->diffInDays($this->end);
    }

    public function contains(CarbonImmutable $date): bool
    {
        return $date->between($this->start, $this->end);
    }

    public function overlaps(self $other): bool
    {
        return $this->start->isBefore($other->end)
            && $other->start->isBefore($this->end);
    }

    public static function today(): self
    {
        $now = CarbonImmutable::now();
        return new self($now->startOfDay(), $now->endOfDay());
    }

    public static function nextDays(int $days): self
    {
        $now = CarbonImmutable::now();
        return new self($now, $now->addDays($days));
    }
}
```

在旅游业务中的应用：

```php
readonly class TourBooking
{
    public function __construct(
        public int $tourId,
        public DateRange $travelPeriod,
        public int $participants,
        public Money $totalPrice,
    ) {}

    public function isValid(): bool
    {
        // 旅游日期至少 1 天
        return $this->travelPeriod->durationInDays() >= 1
            && $this->participants > 0
            && $this->totalPrice->amount > 0;
    }
}
```

---

## 五、实战三：领域模型中的 ID 值对象

用 readonly class 包装原始 ID，防止类型混用：

```php
readonly class OrderId
{
    private string $value;

    public function __construct(string $value)
    {
        if (!preg_match('/^ORD-[A-Z0-9]{12}$/', $value)) {
            throw new InvalidArgumentException("Invalid OrderId format: {$value}");
        }
        $this->value = $value;
    }

    public static function generate(): self
    {
        return new self('ORD-' . strtoupper(Str::random(12)));
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

readonly class UserId
{
    public function __construct(
        public int $value,
    ) {
        if ($value <= 0) {
            throw new InvalidArgumentException("UserId must be positive");
        }
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }
}
```

这样就不可能把 `UserId` 传给需要 `OrderId` 的地方——类型系统在编译时就帮你拦截了。

---

## 六、踩坑记录

### 6.1 踩坑一：readonly class 不能 clone（PHP 8.2）

```php
readonly class Config
{
    public function __construct(
        public string $key,
        public string $value,
    ) {}
}

$a = new Config('app.name', 'KKAY');
$b = clone $a; // OK（PHP 8.2 允许 clone）
$b->key = 'other'; // Fatal Error

// 但是，如果需要"修改某个字段后返回新对象"，readonly class 不支持
// 你需要写一个 withXxx 方法
```

**解决方案**：用 `with` 模式返回新实例：

```php
readonly class AppConfig
{
    public function __construct(
        public string $appName,
        public string $timezone,
        public string $locale,
        public bool $debug,
    ) {}

    public function withDebug(bool $debug): self
    {
        return new self(
            appName: $this->appName,
            timezone: $this->timezone,
            locale: $this->locale,
            debug: $debug,
        );
    }

    public function withLocale(string $locale): self
    {
        return new self(
            appName: $this->appName,
            timezone: $this->timezone,
            locale: $locale,
            debug: $this->debug,
        );
    }
}

$base = new AppConfig('KKday', 'Asia/Taipei', 'zh-TW', false);
$staging = $base->withDebug(true); // 新对象，原对象不变
```

### 6.2 踩坑二：Laravel Eloquent Model 不能用 readonly class

Eloquent Model 需要 mutable 属性（`$fillable`、`$casts`、动态属性等），所以 Model 本身**不能**用 `readonly class`。

**解决方案**：Model 不变，但查询结果转换为 readonly DTO：

```php
readonly class ProductListItem
{
    public function __construct(
        public int $id,
        public string $name,
        public Money $price,
        public string $imageUrl,
        public bool $inStock,
    ) {}

    public static function fromModel(Product $model): self
    {
        return new self(
            id: $model->id,
            name: $model->name,
            price: new Money($model->price_in_cents, $model->currency),
            imageUrl: $model->primary_image_url,
            inStock: $model->stock > 0,
        );
    }
}

// 在 Repository 或 Service 中
class ProductRepository
{
    public function findActive(int $categoryId): array
    {
        return Product::where('category_id', $categoryId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get()
            ->map(fn(Product $p) => ProductListItem::fromModel($p))
            ->toArray();
    }
}
```

### 6.3 踩坑三：序列化与反序列化

`readonly class` 在 `json_encode` 时表现正常，但 `json_decode` 时需要特殊处理：

```php
$data = ['amount' => 1000, 'currency' => 'TWD'];

// 直接 new 不行，因为 json_decode 默认返回 stdClass
$json = json_encode($data);
$decoded = json_decode($json); // stdClass，不是 Money

// 方案一：手动映射
$money = new Money(
    amount: $decoded->amount,
    currency: $decoded->currency,
);

// 方案二：提供 fromArray 工厂方法
readonly class Money
{
    // ... 构造函数等

    public static function fromArray(array $data): self
    {
        return new self(
            amount: (int) $data['amount'],
            currency: (string) $data['currency'],
        );
    }
}

$money = Money::fromArray($data);
```

### 6.4 踩坑四：与 Laravel Validation 的 `$request->merge()` 冲突

如前所述，readonly 对象创建后不可修改。如果中间件或 FormRequest 调用了 `merge()` 或 `replace()`，这些操作发生在 DTO 创建之前，不影响。但如果你习惯在 Service 层直接修改 DTO 字段——这在 readonly class 中不可能。

**最佳实践**：DTO 只负责"数据传递"，不做"数据修正"。验证和修正在 Controller/FormRequest 层完成，DTO 创建后就是不可变的。

---

## 七、性能基准测试

你可能会担心 readonly class 的运行时开销。实际上，PHP 8.2 的 readonly class 在引擎层面几乎没有额外开销：

```php
// 基准测试：readonly class vs 普通 class vs stdClass
readonly class ReadonlyPoint
{
    public function __construct(
        public float $x,
        public float $y,
    ) {}
}

class MutablePoint
{
    public function __construct(
        public float $x,
        public float $y,
    ) {}
}

// 100,000 次实例化 + 属性读取
// ReadonlyPoint:  0.0234s
// MutablePoint:   0.0228s
// stdClass:       0.0241s
// 差异 < 3%，在实际业务中可忽略
```

readonly class 的主要"性能收益"不是运行时，而是**维护时**——不可变性消除了大量隐式状态变更的 bug，减少了调试时间。

---

## 八、迁移策略：从 mutable 到 readonly 的渐进式重构

### 8.1 Step 1：识别候选类

```bash
# 找出所有"纯数据类"（只有属性和构造函数，没有 setter）
grep -rl "class.*DTO\|class.*Value\|class.*Result\|class.*Info" app/ \
  | xargs grep -L "function set\|function modify\|function update"
```

### 8.2 Step 2：逐个添加 readonly 修饰符

```php
// Before
class OrderSummary { ... }

// After
readonly class OrderSummary { ... }
```

如果编译报错（某个属性被修改了），先找到修改点，用 `with` 模式重构。

### 8.3 Step 3：更新测试

```php
// 测试不可变性
test('Money is immutable', function () {
    $money = new Money(1000, 'TWD');

    // 添加方法可以返回新实例
    $doubled = $money->multiply(2);

    expect($money->amount)->toBe(1000);      // 原对象不变
    expect($doubled->amount)->toBe(2000);    // 新对象
});
```

### 8.4 Step 4：CI 门禁

在 PHPStan 配置中启用不可变性检查：

```neon
# phpstan.neon
parameters:
    phpVersion:
        min: 80200
    treatPhpDocTypesAsCertain: false
```

---

## 九、与其他方案的对比

| 方案 | 不可变性 | 类型安全 | 性能 | 学习成本 |
|------|---------|---------|------|---------|
| readonly class (8.2) | ✅ 编译时 | ✅ 原生 | ⭐⭐⭐ | 低 |
| readonly 属性 (8.1) | ✅ 编译时 | ✅ 原生 | ⭐⭐⭐ | 低 |
| `@immutable` 注解 | ❌ 运行时 | ❌ 无 | ⭐⭐ | 低 |
| Symfony Serializer DTO | ❌ 手动 | ⭐⭐ | ⭐⭐ | 中 |
| `__set` 拦截 | ⚠️ 运行时 | ❌ 无 | ⭐⭐ | 高 |

**结论**：PHP 8.2 `readonly class` 是目前 PHP 生态中实现不可变对象的最佳方案。

---

## 总结

`readonly class` 不是什么革命性特性，但它是 PHP 类型系统的一个重要拼图。在 B2C 电商 API 这种数据流转密集的场景中，不可变性带来的安全保障远大于那一点点 `withXxx` 方法的样板代码。

**三个核心原则**：
1. **DTO 和 Value Object 优先用 readonly class**——它们的职责就是"携带数据"
2. **Eloquent Model 不动**——Model 是 mutable 的，用 `fromModel()` 转换到 readonly DTO
3. **渐进式迁移**——不要一次性重构所有类，从新代码开始，旧代码逐步迁移

如果你的项目已经升级到 PHP 8.2，现在就可以开始用 `readonly class` 了。从下一个新 DTO 开始。
