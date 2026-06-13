---

title: PHP 8.5 Property Hooks 实战：计算属性与数据验证的声明式编程——替代 Accessor/Mutator 的底层原理与 Laravel
keywords: [PHP, Property Hooks, Accessor, Mutator, Laravel, 计算属性与数据验证的声明式编程, 替代, 的底层原理与]
description: 深入解析 PHP 8.5 Property Hooks 特性，详解 get/set 钩子语法、计算属性（Computed Properties）与声明式数据验证的实战用法。对比 Laravel Accessor/Mutator 传统方案，展示 Property Hooks 在类型安全、代码可读性与 OPcache JIT 性能优化上的全面优势。涵盖 Zend Engine 底层原理、Eloquent 模型集成适配、Value Object 模式、渐进式迁移指南及常见踩坑案例，助你掌握 PHP 声明式编程的里程碑特性。
date: 2026-06-04 08:00:00
tags:
- PHP
- PHP 8.5
- Property Hooks
- Laravel
- 声明式
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---





# PHP 8.5 Property Hooks 实战：计算属性与数据验证的声明式编程——替代 Accessor/Mutator 的底层原理与 Laravel 适配

## 一、引言：从 `__get/__set` 到 Property Hooks 的演进

PHP 的属性访问控制一直是社区长期关注的话题。自 PHP 5 引入魔术方法 `__get()` 和 `__set()` 以来，开发者便有了一种拦截属性访问的手段——但这种机制存在明显的缺陷：

1. **性能开销**：每次属性访问都会触发函数调用，且无法被 OPcache 充分优化。
2. **类型安全缺失**：`__get()` 返回 `mixed`，IDE 无法推导具体类型。
3. **代码可读性差**：拦截逻辑与属性声明分离，需要开发者在类的底部去寻找魔术方法的实现。
4. **调试困难**：断点无法精确打在某个属性的读写上。

这些痛点催生了社区长达数年的讨论。2024 年，PHP 核心开发者 Ilija Tovilo 正式提交了 **Property Hooks RFC**（[PHP RFC: Property Hooks](https://wiki.php.net/rfc/property-hooks)），并在 PHP 8.4 中被投票通过、在 PHP 8.5 中正式落地。这是继枚举、Fibers、只读属性之后，PHP 在"声明式编程"方向上的又一里程碑。

Property Hooks 让你直接在属性声明处定义读写行为——无需魔术方法、无需额外的方法声明——像写 JavaScript 的 getter/setter 或 C# 的属性访问器一样自然。

```php
class User
{
    public string $fullName {
        get => $this->firstName . ' ' . $this->lastName;
        set {
            [$this->firstName, $this->lastName] = explode(' ', $value, 2);
        }
    }

    public function __construct(
        public string $firstName = '',
        public string $lastName = '',
    ) {}
}

$user = new User('John', 'Doe');
echo $user->fullName;          // "John Doe"
$user->fullName = 'Jane Smith';
echo $user->firstName;         // "Jane"
```

这段代码清晰地展示了 Property Hooks 的核心价值：**属性即行为**。读取 `$user->fullName` 时执行拼接逻辑，赋值时自动拆分——所有逻辑都内联在属性声明处，一目了然。

---

## 二、Property Hooks RFC 核心概念

### 2.1 基本语法

Property Hooks 允许在类的属性声明中定义 `get` 和 `set` 两个钩子：

```php
class Example
{
    // 完整形式：get 和 set 各自用花括号包裹
    public string $name {
        get {
            return strtolower($this->name);
        }
        set {
            $this->name = trim($value);
        }
    }

    // 简写形式：箭头函数风格
    public string $upper {
        get => strtoupper($this->name);
    }
}
```

### 2.2 `get` Hook

- 当属性被**读取**时自动触发。
- 必须有返回值，返回类型必须与属性声明的类型兼容。
- 使用 `$this->propertyName` 访问底层真实值（即 backing value）。
- 如果 `get` hook 是唯一的 hook（没有 `set`），则该属性为**只读计算属性**，不存在 backing value，此时 `$this->propertyName` 在 `get` 中递归调用自身会导致栈溢出。

### 2.3 `set` Hook

- 当属性被**赋值**时自动触发。
- 通过隐式变量 `$value` 获取传入的值。
- 可以通过 `$this->propertyName = $value` 存储到 backing value。
- 可以完全不存储值（如将数据写入外部存储），也可以修改后再存储。

### 2.4 继承与覆盖

Property Hooks 完全参与继承体系：

```php
class Base
{
    public string $name {
        get => 'base';
    }
}

class Child extends Base
{
    public string $name {
        get => 'child: ' . parent::$name::get();
    }
}
```

子类可以通过 `parent::$propertyName::get()` 或 `parent::$propertyName::set($value)` 调用父类的 hook 实现。

### 2.5 接口与抽象 Hook

接口可以声明带 hook 的属性：

```php
interface HasSlug
{
    public string $slug {
        get;
        set;
    }
}

class Article implements HasSlug
{
    public string $title = '';
    public string $slug {
        get => strtolower(str_replace(' ', '-', $this->title));
        set => $this->title = ucwords(str_replace('-', ' ', $value));
    }
}
```

当接口只声明 `get;` 或 `set;`（无实现体）时，实现类**必须**提供对应的 hook 实现。

### 2.6 `readonly` 与 Property Hooks 的关系

```php
class Config
{
    public readonly string $env {
        get => $this->env ?? ($_ENV['APP_ENV'] ?? 'production');
    }
}
```

`readonly` 属性可以搭配 `get` hook，但 `readonly` 属性不能有 `set` hook，因为 readonly 属性只能初始化一次。

---

## 三、与 C# 属性访问器的对比

PHP 8.5 的 Property Hooks 与 C# 的属性访问器（Property Accessors）在概念上高度相似，但有一些关键差异：

| 特性 | C# | PHP 8.5 Property Hooks |
|---|---|---|
| 语法位置 | 属性声明内 `{ get; set; }` | 属性声明内 `{ get {...} set {...} }` |
| 自动属性 | `{ get; set; }` 自动生成 backing field | `{ get; set; }` 不允许——必须至少有一个 hook 有实现体 |
| 访问修饰符 | `public get; private set;` | 不支持单独的访问修饰符 |
| `init` 语义 | `{ get; init; }` 只在初始化时赋值 | 使用 `readonly` 属性 + `get` hook 实现类似效果 |
| 底层机制 | CLR 内建支持，编译为 `get_PropertyName()` / `set_PropertyName()` 方法 | Zend Engine 内建支持，编译为独立的 hook 函数指针 |

**C# 示例：**

```csharp
public class User
{
    private string _firstName;
    public string FirstName
    {
        get => _firstName;
        set => _firstName = value?.Trim() ?? throw new ArgumentNullException();
    }
    public string FullName => $"{FirstName} LastName"; // 计算属性
}
```

**PHP 8.5 等价实现：**

```php
class User
{
    public string $firstName {
        set => $this->firstName = trim($value);
        get => $this->firstName;
    }
    public string $fullName {
        get => $this->firstName . ' LastName';
    }
}
```

PHP 版本更加简洁——不需要声明私有的 backing field，引擎自动处理。

---

## 四、计算属性（Computed Properties）实战

计算属性是 Property Hooks 最直观的应用场景：属性的值由其他属性动态计算得出，不占用独立的存储空间。

### 4.1 几何计算

```php
class Rectangle
{
    public function __construct(
        public float $width,
        public float $height,
    ) {}

    public float $area {
        get => $this->width * $this->height;
    }

    public float $perimeter {
        get => 2 * ($this->width + $this->height);
    }

    public float $diagonal {
        get => sqrt($this->width ** 2 + $this->height ** 2);
    }
}

$rect = new Rectangle(3.0, 4.0);
echo $rect->area;      // 12
echo $rect->perimeter;  // 14
echo $rect->diagonal;   // 5

$rect->width = 6.0;
echo $rect->area;      // 24 —— 动态响应 width 变化
```

### 4.2 用户画像计算

```php
class UserProfile
{
    public function __construct(
        public string $firstName = '',
        public string $lastName = '',
        public \DateTimeImmutable $birthDate = new \DateTimeImmutable('2000-01-01'),
    ) {}

    public string $fullName {
        get => trim($this->firstName . ' ' . $this->lastName);
        set {
            $parts = explode(' ', $value, 2);
            $this->firstName = $parts[0] ?? '';
            $this->lastName = $parts[1] ?? '';
        }
    }

    public int $age {
        get => $this->birthDate->diff(new \DateTimeImmutable())->y;
    }

    public bool $isAdult {
        get => $this->age >= 18;
    }

    public string $avatarUrl {
        get => 'https://ui-avatars.com/api/?name=' . urlencode($this->fullName);
    }
}

$profile = new UserProfile('张', '三', new \DateTimeImmutable('1995-06-15'));
echo $profile->fullName;   // "张 三"
echo $profile->age;        // 30（假设当前 2025 年）
echo $profile->isAdult;    // true
echo $profile->avatarUrl;  // "https://ui-avatars.com/api/?name=%E5%BC%A0+%E4%B8%89"

$profile->fullName = '李 四';
echo $profile->firstName;  // "李"
```

### 4.3 带缓存的计算属性

对于计算成本较高的属性，可以引入缓存机制：

```php
class ExpensiveComputation
{
    private ?float $_cachedResult = null;
    private array $_rawData = [];

    public function __construct(array $data)
    {
        $this->_rawData = $data;
    }

    public array $data {
        get => $this->_rawData;
        set {
            $this->_rawData = $value;
            $this->_cachedResult = null; // 数据变化时清除缓存
        }
    }

    public float $result {
        get {
            if ($this->_cachedResult === null) {
                // 模拟耗时计算
                $this->_cachedResult = array_reduce(
                    $this->_rawData,
                    fn(float $carry, float $item) => $carry + sqrt($item),
                    0.0
                );
            }
            return $this->_cachedResult;
        }
    }
}
```

> 注意：上面的缓存方案通过私有属性 `$_cachedResult` 实现。Property Hooks 中可以自由访问其他私有属性，这保证了封装性和灵活性的平衡。

---

## 五、数据验证 Hook 实战

Property Hooks 的另一大核心应用是**声明式数据验证**——在赋值时自动校验数据，确保对象始终处于合法状态。

### 5.1 基础验证

```php
class User
{
    public string $email {
        set {
            if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
                throw new \InvalidArgumentException("Invalid email: {$value}");
            }
            $this->email = strtolower(trim($value));
        }
        get => $this->email;
    }

    public int $age {
        set {
            if ($value < 0 || $value > 150) {
                throw new \OutOfRangeException("Age must be between 0 and 150, got {$value}");
            }
            $this->age = $value;
        }
        get => $this->age;
    }

    public string $username {
        set {
            if (!preg_match('/^[a-zA-Z0-9_]{3,20}$/', $value)) {
                throw new \InvalidArgumentException(
                    'Username must be 3-20 chars, alphanumeric and underscore only'
                );
            }
            $this->username = strtolower($value);
        }
        get => $this->username;
    }
}

$user = new User();
$user->email = '  John@Example.COM  ';
echo $user->email; // "john@example.com"

$user->age = 25;
try {
    $user->age = -1;
} catch (\OutOfRangeException $e) {
    echo $e->getMessage(); // "Age must be between 0 and 150, got -1"
}
```

### 5.2 链式验证与 Value Object 模式

Property Hooks 天然适合实现 Value Object（值对象）模式：

```php
class Money
{
    public function __construct(
        private readonly string $currency,
    ) {}

    public float $amount {
        set {
            if ($value < 0) {
                throw new \InvalidArgumentException('Amount cannot be negative');
            }
            $this->amount = round($value, 2);
        }
        get => $this->amount ?? 0.0;
    }

    public string $formatted {
        get => $this->currency . ' ' . number_format($this->amount, 2);
    }

    public function add(self $other): self
    {
        if ($this->currency !== $other->currency) {
            throw new \InvalidArgumentException('Currency mismatch');
        }
        $result = new self($this->currency);
        $result->amount = $this->amount + $other->amount;
        return $result;
    }
}

$price = new Money('USD');
$price->amount = 19.99;
echo $price->formatted; // "USD 19.99"

$price->amount = 19.999;
echo $price->amount;    // 20 —— 被 round 修正

$price2 = new Money('USD');
$price2->amount = 5.01;
$total = $price->add($price2);
echo $total->formatted; // "USD 25.01"
```

### 5.3 日期范围验证

```php
class Event
{
    private ?\DateTimeImmutable $_end = null;

    public string $title {
        set {
            if (empty(trim($value))) {
                throw new \InvalidArgumentException('Event title cannot be empty');
            }
            $this->title = trim($value);
        }
        get => $this->title ?? '';
    }

    public \DateTimeImmutable $start {
        set {
            $this->start = $value;
            // 如果结束时间已设置，确保开始时间在结束时间之前
            if ($this->_end !== null && $value > $this->_end) {
                throw new \InvalidArgumentException('Start date must be before end date');
            }
        }
        get => $this->start ?? new \DateTimeImmutable();
    }

    public \DateTimeImmutable $end {
        set {
            if ($value < $this->start) {
                throw new \InvalidArgumentException('End date must be after start date');
            }
            $this->end = $value;
            $this->_end = $value;
        }
        get => $this->end ?? $this->start;
    }

    public string $duration {
        get {
            $interval = $this->start->diff($this->end);
            return $interval->format('%d days, %h hours');
        }
    }
}
```

---

## 六、替代 Laravel Accessor/Mutator 的具体方案

### 6.1 Laravel 传统 Accessor/Mutator 回顾

在 Laravel 11 之前，Eloquent 模型通过 `getXxxAttribute()` 和 `setXxxAttribute()` 方法定义访问器和修改器：

```php
// Laravel 10 及之前
class User extends Model
{
    protected function firstName(): Attribute
    {
        return Attribute::make(
            get: fn (mixed $value) => ucfirst($value),
            set: fn (mixed $value) => strtolower($value),
        );
    }
}
```

这种模式虽然比魔术方法好，但仍有不足：

- **与属性声明分离**：访问器方法和属性不在一起，需要来回跳转。
- **依赖框架约定**：必须遵循 `getXxxAttribute` 或使用 `Attribute` 类。
- **无法被静态分析完全覆盖**：IDE 需要 Laravel 插件才能理解 `$user->first_name` 的类型。

### 6.2 使用 Property Hooks 替代

假设 Laravel 的 Eloquent 底层适配了 Property Hooks（详见第九节），我们可以这样重写模型：

```php
use Illuminate\Database\Eloquent\Model;

class User extends Model
{
    // 传统属性 —— 映射到数据库
    protected string $first_name = '';
    protected string $last_name = '';

    // Property Hooks 替代 Accessor/Mutator
    public string $first_name {
        get => ucfirst($this->first_name);
        set => $this->first_name = strtolower(trim($value));
    }

    public string $last_name {
        get => ucfirst($this->last_name);
        set => $this->last_name = strtolower(trim($value));
    }

    // 计算属性 —— 替代 getFullNameAttribute
    public string $fullName {
        get => $this->first_name . ' ' . $this->last_name;
        set {
            [$this->first_name, $this->last_name] = explode(' ', $value, 2);
        }
    }

    // 数据验证 —— 替代 set 组合中的验证逻辑
    public string $email {
        set {
            if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
                throw new \InvalidArgumentException("Invalid email: {$value}");
            }
            $this->email = strtolower($value);
        }
        get => $this->email;
    }
}
```

### 6.3 对比优势

| 维度 | Laravel Attribute API | Property Hooks |
|---|---|---|
| 位置 | 独立方法，与属性分离 | 内联在属性声明处 |
| 类型安全 | 需要 `@property` 注解 | 原生类型声明 |
| 静态分析 | 需要 PHPStan/Larastan 插件 | 原生支持 |
| 可读性 | 需要跳转到方法 | 一目了然 |
| 框架依赖 | 绑定 Laravel | PHP 原生，框架无关 |
| 测试性 | 需要通过模型实例测试 | 可独立测试（POPO） |

### 6.4 纯 PHP 的 Eloquent-like 模型

Property Hooks 让你可以在不依赖任何框架的情况下，构建具备 ORM 行为的领域模型：

```php
abstract class Entity
{
    protected array $_attributes = [];

    public function __get(string $name): mixed
    {
        // Property Hooks 已经处理了带 hook 的属性
        // 这里只处理动态属性（来自数据库的原始字段）
        return $this->_attributes[$name] ?? null;
    }

    public function __set(string $name, mixed $value): void
    {
        $this->_attributes[$name] = $value;
    }

    public function toArray(): array
    {
        return $this->_attributes;
    }
}

class Product extends Entity
{
    public string $name {
        get => $this->_attributes['name'] ?? '';
        set {
            $this->_attributes['name'] = trim($value);
        }
    }

    public float $price {
        get => (float) ($this->_attributes['price'] ?? 0);
        set {
            if ($value < 0) {
                throw new \InvalidArgumentException('Price cannot be negative');
            }
            $this->_attributes['price'] = round($value, 2);
        }
    }

    public float $priceWithTax {
        get => round($this->price * 1.13, 2);
    }
}
```

---

## 七、底层实现原理

### 7.1 Zend Engine 层面

Property Hooks 的实现位于 Zend Engine 的属性表（property table）中。在 PHP 8.5 引擎中：

1. **属性条目扩展**：`zend_property_info` 结构体新增了 `get_hook` 和 `set_hook` 两个函数指针字段。
2. **读取拦截**：当执行 `FETCH_OBJ_R`（读取对象属性）操作码时，引擎检查目标属性是否有 `get` hook。如果有，调用 hook 函数而非直接从属性表读取。
3. **写入拦截**：当执行 `ASSIGN_OBJ` 操作码时，引擎检查是否有 `set` hook。如果有，先调用 hook 函数。
4. **Backing Value**：如果 `set` hook 中执行了 `$this->propName = $value`（自引用赋值），引擎将其写入底层的 backing slot，避免再次触发 hook。

### 7.2 OPcache 优化

这是 Property Hooks 相比 `__get/__set` 的核心性能优势。传统魔术方法无法被 OPcache JIT 编译优化，因为引擎需要在运行时动态查找方法。而 Property Hooks：

1. **静态绑定**：hook 函数在编译期就与属性绑定，OPcache 可以在编译字节码阶段直接内联 hook 函数指针。
2. **JIT 兼容**：PHP 8.5 的 JIT 编译器（DynamoRIO/IR-based）可以直接将简单的 hook（如 `get => $this->x + $this->y`）编译为机器码，无需函数调用开销。
3. **内联缓存（Inline Cache）**：当同一位置多次访问同一类的 hooked 属性时，inline cache 命中率极高，跳过类型检查。

### 7.3 内存布局

```c
// 简化的 zend_property_info 结构
struct _zend_property_info {
    uint32_t offset;          // 属性在对象中的偏移量
    uint32_t flags;
    zend_string *name;
    zend_class_entry *ce;
    zend_type type;
    zend_function *get_hook;  // PHP 8.5 新增
    zend_function *set_hook;  // PHP 8.5 新增
};
```

当一个属性只有 `get` hook 而没有 `set` hook 时，引擎不分配 backing slot（存储空间），因为该属性永远不会存储值。这意味着纯计算属性的内存开销为零。

---

## 八、性能影响分析

### 8.1 基准测试设计

```php
// 测试三种属性访问方式的性能

// 1. 普通属性
class PlainUser {
    public string $name = 'test';
    public string $upper = '';
}

// 2. Property Hooks
class HookUser {
    public string $name = 'test';
    public string $upper {
        get => strtoupper($this->name);
    }
}

// 3. 魔术方法
class MagicUser {
    public string $name = 'test';
    public function __get(string $prop): mixed {
        return match($prop) {
            'upper' => strtoupper($this->name),
            default => null,
        };
    }
}

$iterations = 1_000_000;

// 测试 1：普通属性
$plain = new PlainUser();
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    $plain->upper = strtoupper($plain->name);
}
$plainTime = (hrtime(true) - $start) / 1e6;

// 测试 2：Property Hooks
$hook = new HookUser();
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    $_ = $hook->upper;
}
$hookTime = (hrtime(true) - $start) / 1e6;

// 测试 3：魔术方法
$magic = new MagicUser();
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    $_ = $magic->upper;
}
$magicTime = (hrtime(true) - $start) / 1e6;

echo "Plain: {$plainTime}ms\n";
echo "Hooks: {$hookTime}ms\n";
echo "Magic: {$magicTime}ms\n";
```

### 8.2 预期结果

在 PHP 8.5 + OPcache + JIT 环境下，预期性能表现如下：

| 访问方式 | 相对性能 | 说明 |
|---|---|---|
| 普通属性 | 1.0x（基准） | 最快，直接内存读写 |
| Property Hooks（简单逻辑） | ~1.2-1.5x | 接近普通属性，JIT 可内联 |
| Property Hooks（复杂逻辑） | ~2-5x | 取决于 hook 函数复杂度 |
| `__get()` 魔术方法 | ~3-8x | 无法 JIT 优化，需要动态查找 |
| Laravel `Attribute` 访问器 | ~4-10x | 涉及对象创建和闭包调用 |

**关键结论**：Property Hooks 的性能远优于 `__get/__set` 魔术方法，对于简单计算逻辑，甚至接近普通属性的性能水平。相比 Laravel 的 `Attribute` API，性能提升更为显著，因为消除了 `Attribute` 对象创建和闭包调用的开销。

### 8.3 内存分析

- 有 backing value 的 hook 属性：内存开销与普通属性相同。
- 无 backing value 的纯计算属性（只有 `get` hook）：不分配存储空间，内存开销为零。
- hook 函数本身：存储在类的方法表中，与普通方法共享相同的内存结构。

---

## 九、与 Laravel Eloquent 的集成适配

### 9.1 适配方案设计

Laravel 要支持 Property Hooks，需要在 Eloquent 的属性读写路径中识别并调用 hooked 属性。以下是适配的核心思路：

```php
namespace Illuminate\Database\Eloquent\Concerns;

trait HasPropertyHooks
{
    /**
     * 重写属性获取逻辑：优先检查 Property Hooks
     */
    public function getAttribute(string $key): mixed
    {
        // 如果属性有 get hook，让引擎自动处理
        // Property Hooks 在引擎层面已经拦截了访问
        // 但 Eloquent 的动态属性（来自 $attributes 数组）需要额外处理
        if (property_exists($this, $key) && $this->hasPropertyHook($key, 'get')) {
            return parent::getAttribute($key);
        }

        // 传统 Eloquent 属性访问
        if (array_key_exists($key, $this->attributes) ||
            array_key_exists($key, $this->casts)) {
            return $this->getAttributeValue($key);
        }

        // 关联和自定义访问器
        return parent::getAttribute($key);
    }

    /**
     * 重写属性设置逻辑
     */
    public function setAttribute(string $key, mixed $value): static
    {
        if (property_exists($this, $key) && $this->hasPropertyHook($key, 'set')) {
            $this->$key = $value; // 触发 Property Hook
            return $this;
        }

        // 传统 Eloquent 属性设置
        return parent::setAttribute($key, $value);
    }

    /**
     * 检查属性是否有指定类型的 hook
     */
    private function hasPropertyHook(string $property, string $type): bool
    {
        $reflection = new \ReflectionProperty($this, $property);
        return $type === 'get'
            ? $reflection->hasHook('get')
            : $reflection->hasHook('set');
    }
}
```

### 9.2 Eloquent 模型中的实际使用

```php
use Illuminate\Database\Eloquent\Model;

/**
 * @property-read string $full_name
 * @property-read float  $price_with_tax
 * @property string      $email
 */
class Product extends Model
{
    use HasPropertyHooks;

    protected $table = 'products';
    protected $fillable = ['name', 'price', 'email', 'category'];

    // 存储到数据库时的格式化
    public string $email {
        set {
            $this->email = strtolower(trim($value));
        }
        get => $this->email;
    }

    // 带验证的数值属性
    public float $price {
        set {
            if ($value < 0) {
                throw new \InvalidArgumentException('Price cannot be negative');
            }
            $this->price = round($value, 2);
        }
        get => $this->price;
    }

    // 计算属性 —— 不存储到数据库
    public string $full_name {
        get => trim(($this->attributes['first_name'] ?? '') . ' '
            . ($this->attributes['last_name'] ?? ''));
    }

    public float $price_with_tax {
        get => round($this->price * 1.13, 2);
    }

    /**
     * 判断哪些属性是计算属性（不存储到数据库）
     */
    public function getComputedProperties(): array
    {
        return ['full_name', 'price_with_tax'];
    }

    /**
     * 重写 toArray，排除计算属性或包含计算属性
     */
    public function toArray(): array
    {
        $array = parent::toArray();

        // 添加计算属性
        foreach ($this->getComputedProperties() as $prop) {
            $array[$prop] = $this->$prop;
        }

        return $array;
    }
}
```

### 9.3 JSON 序列化集成

```php
class Article extends Model
{
    public string $slug {
        get => strtolower(str_replace(' ', '-', $this->attributes['title'] ?? ''));
    }

    public string $summary {
        get => mb_substr(strip_tags($this->attributes['body'] ?? ''), 0, 150) . '...';
    }

    // 确保 API 返回时包含计算属性
    protected function casts(): array
    {
        return [
            'created_at' => 'datetime:Y-m-d',
            'updated_at' => 'datetime:Y-m-d',
        ];
    }
}

// Controller 中
return response()->json([
    'data' => $article->toArray()
    // 自动包含 slug, summary 等计算属性
]);
```

### 9.4 表单请求验证集成

Property Hooks 的验证能力可以与 Laravel 的 Form Request 配合使用，实现分层验证：

```php
// Form Request 负责输入验证
class UpdateUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'email' => 'required|email',
            'age' => 'required|integer|min:0|max:150',
        ];
    }
}

// Model 的 Property Hook 负责数据规范化
class User extends Model
{
    public string $email {
        set => $this->email = strtolower(trim($value));
        get => $this->email;
    }

    public int $age {
        set {
            if ($value < 0 || $value > 150) {
                throw new \OutOfRangeException("Invalid age: {$value}");
            }
            $this->age = $value;
        }
        get => $this->age;
    }
}

// Controller
class UserController extends Controller
{
    public function update(UpdateUserRequest $request, User $user)
    {
        // Form Request 已经验证过了，Property Hook 做最后的数据规范化
        $user->update($request->validated());
        return response()->json($user);
    }
}
```

---

## 十、迁移指南：现有项目如何逐步采用

### 10.1 迁移策略总览

建议采用**渐进式迁移**，分三个阶段推进：

```
阶段一：新代码全部使用 Property Hooks（0 成本）
阶段二：在模型重构时替换 Accessor/Mutator（中等成本）
阶段三：统一底层工具类和 Value Object（较高成本）
```

### 10.2 阶段一：新代码优先

从今天起，所有新写的 Eloquent 模型和领域类都使用 Property Hooks：

```php
// ✅ 新代码 —— 使用 Property Hooks
class NewFeature extends Model
{
    public string $display_name {
        get => ucfirst($this->attributes['name'] ?? '');
        set => $this->display_name = trim($value);
    }
}

// ❌ 不要再写这样的代码
class OldStyle extends Model
{
    public function getDisplayNameAttribute(): string
    {
        return ucfirst($this->attributes['name']);
    }
}
```

### 10.3 阶段二：逐步替换

当你重构现有模型时，按以下步骤操作：

1. **识别**：用 `grep -r "Attribute"` 找到所有 Accessor/Mutator。
2. **转换**：将 `getXxxAttribute()` 转换为 `get` hook，将 `setXxxAttribute()` 转换为 `set` hook。
3. **测试**：确保行为不变，特别注意边界情况。
4. **验证**：运行完整的测试套件。

```php
// 之前
class User extends Model
{
    protected function fullName(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->first_name . ' ' . $this->last_name,
        );
    }

    protected function email(): Attribute
    {
        return Attribute::make(
            get: fn (string $value) => strtolower($value),
            set: fn (string $value) => strtolower($value),
        );
    }
}

// 之后
class User extends Model
{
    public string $full_name {
        get => $this->first_name . ' ' . $this->last_name;
    }

    public string $email {
        get => strtolower($this->attributes['email'] ?? '');
        set => $this->email = strtolower($value);
    }
}
```

### 10.4 阶段三：Value Object 重构

将常见的值对象（如 Money、Address、DateRange）用 Property Hooks 重写：

```php
class Address
{
    public function __construct(
        public string $street = '',
        public string $city = '',
        public string $state = '',
        public string $zip = '',
    ) {}

    public string $zip {
        set {
            if (!preg_match('/^\d{5}(-\d{4})?$/', $value)) {
                throw new \InvalidArgumentException("Invalid ZIP code: {$value}");
            }
            $this->zip = $value;
        }
        get => $this->zip;
    }

    public string $formatted {
        get => "{$this->street}, {$this->city}, {$this->state} {$this->zip}";
    }

    public string $singleLine {
        get => str_replace(["\n", "\r"], ' ', $this->formatted);
    }
}
```

### 10.5 PHP 版本兼容性

如果项目需要同时支持 PHP 8.3/8.4 和 8.5，可以使用条件代码：

```php
// composer.json: "php": "^8.3"

class User extends Model
{
    #if PHP_VERSION_ID >= 80500
    public string $full_name {
        get => $this->first_name . ' ' . $this->last_name;
    }
    #else
    public function getFullNameAttribute(): string
    {
        return $this->first_name . ' ' . $this->last_name;
    }
    #endif
}
```

> 实际项目中更推荐的做法是：在 PHP 8.5 发布后，将最低版本要求提升到 8.5，然后统一迁移。

---

## 十一、高级模式与最佳实践

### 11.1 不可变对象（Immutable Object）

```php
class Color
{
    public function __construct(
        public readonly int $red {
            set {
                if ($value < 0 || $value > 255) {
                    throw new \OutOfRangeException("Red must be 0-255");
                }
                $this->red = $value;
            }
        },
        public readonly int $green {
            set {
                if ($value < 0 || $value > 255) {
                    throw new \OutOfRangeException("Green must be 0-255");
                }
                $this->green = $value;
            }
        },
        public readonly int $blue {
            set {
                if ($value < 0 || $value > 255) {
                    throw new \OutOfRangeException("Blue must be 0-255");
                }
                $this->blue = $value;
            }
        },
    ) {}

    public string $hex {
        get => sprintf('#%02x%02x%02x', $this->red, $this->green, $this->blue);
    }

    public float $luminance {
        get => (0.299 * $this->red + 0.587 * $this->green + 0.114 * $this->blue) / 255;
    }

    public bool $isLight {
        get => $this->luminance > 0.5;
    }
}

$bg = new Color(255, 255, 255);
echo $bg->hex;        // "#ffffff"
echo $bg->isLight;    // true
```

### 11.2 双向绑定的配置对象

```php
class AppConfig
{
    private array $_store = [];

    public function __get(string $key): mixed
    {
        return $this->_store[$key] ?? null;
    }

    public function __set(string $key, mixed $value): void
    {
        $this->_store[$key] = $value;
    }
}

class App
{
    public function __construct(
        private AppConfig $config,
    ) {}

    public string $appName {
        get => $this->config->name ?? 'My App';
        set => $this->config->name = $value;
    }

    public bool $debug {
        get => $this->config->debug ?? false;
        set => $this->config->debug = (bool) $value;
    }

    public string $logLevel {
        get {
            $level = $this->config->log_level ?? 'info';
            return in_array($level, ['debug', 'info', 'warning', 'error'])
                ? $level
                : 'info';
        }
        set {
            if (!in_array($value, ['debug', 'info', 'warning', 'error'])) {
                throw new \InvalidArgumentException("Invalid log level: {$value}");
            }
            $this->config->log_level = $value;
        }
    }
}
```

### 11.3 事件驱动的属性变更

```php
class Observable
{
    private array $_listeners = [];

    public function onPropertyChange(string $property, callable $callback): void
    {
        $this->_listeners[$property][] = $callback;
    }

    protected function notifyChange(string $property, mixed $oldValue, mixed $newValue): void
    {
        foreach ($this->_listeners[$property] ?? [] as $callback) {
            $callback($oldValue, $newValue);
        }
    }
}

class UserState extends Observable
{
    private string $_status = 'inactive';

    public string $status {
        get => $this->_status;
        set {
            $old = $this->_status;
            $this->_status = $value;
            $this->notifyChange('status', $old, $value);
        }
    }
}

// 使用
$user = new UserState();
$user->onPropertyChange('status', function ($old, $new) {
    echo "Status changed from '{$old}' to '{$new}'\n";
});
$user->status = 'active'; // 输出: Status changed from 'inactive' to 'active'
```

---

## 十二、常见踩坑案例与解决方案

### 12.1 纯计算属性中的递归调用

这是新手最容易犯的错误——在只有 `get` hook 的属性中访问 `$this->propertyName`，会导致无限递归：

```php
// ❌ 致命错误：栈溢出
class Circle
{
    public function __construct(
        public float $radius,
    ) {}

    public float $area {
        // 错误！$this->area 会再次触发 get hook，无限递归
        get => $this->area * 2;
    }
}

// ✅ 正确做法：访问底层属性进行计算
class Circle
{
    public function __construct(
        public float $radius,
    ) {}

    public float $area {
        get => M_PI * $this->radius ** 2;  // 访问 radius，不是 area
    }

    public float $doubleArea {
        get => $this->area * 2;  // 这里访问 area 是安全的，因为 area 有独立的计算逻辑
    }
}
```

**规则**：只有当属性同时拥有 `set` hook（即存在 backing value）时，在 `get` hook 中访问 `$this->propertyName` 才是安全的。纯计算属性（只有 `get`）必须访问其他属性。

### 12.2 `set` hook 中忘记存储值

```php
// ❌ 赋值后读取为 null
class User
{
    public string $name {
        set {
            // 只做了验证，但忘记存储！
            if (empty(trim($value))) {
                throw new \InvalidArgumentException('Name cannot be empty');
            }
            // 缺少: $this->name = trim($value);
        }
        get => $this->name;
    }
}

$user = new User();
$user->name = 'John';
echo $user->name; // null —— 值没有被存储

// ✅ 正确：验证后必须存储
class User
{
    public string $name {
        set {
            if (empty(trim($value))) {
                throw new \InvalidArgumentException('Name cannot be empty');
            }
            $this->name = trim($value);  // 必须存储到 backing value
        }
        get => $this->name;
    }
}
```

### 12.3 `readonly` 属性与 `set` hook 冲突

```php
// ❌ 编译错误：readonly 属性不能有 set hook
class Config
{
    public readonly string $env {
        get => $this->env ?? 'production';
        set => $this->env = $value;  // Fatal: readonly + set 不兼容
    }
}

// ✅ 正确：readonly 属性只能搭配 get hook
class Config
{
    public readonly string $env {
        get => $this->env ?? ($_ENV['APP_ENV'] ?? 'production');
    }
}
```

### 12.4 类型不兼容

```php
// ❌ 返回类型不兼容
class User
{
    public string $name {
        get {
            return 42;  // Fatal: get hook 返回 int，但属性声明为 string
        }
    }
}

// ✅ 确保 hook 返回类型与属性声明一致
class User
{
    public string $name {
        get => (string) $this->name;  // 类型转换
    }
}
```

### 12.5 与 `__get/__set` 的优先级陷阱

```php
class LegacyModel
{
    public string $displayName {
        get => 'Hooked: ' . $this->displayName;
    }

    public function __get(string $name): mixed
    {
        // Property Hooks 优先级高于 __get
        // 但动态属性（未声明的属性）仍然走 __get
        return $this->dynamicAttributes[$name] ?? null;
    }
}

$model = new LegacyModel();
echo $model->displayName;  // 触发 Property Hook，不是 __get
echo $model->unknown;      // 触发 __get
```

**注意**：Property Hooks 与 `__get/__set` 可以共存——已声明的 hooked 属性走 hook，未声明的属性走魔术方法。

### 12.6 接口约束遗漏实现

```php
// ❌ 编译错误：未实现接口声明的 hook
interface HasSlug
{
    public string $slug { get; set; }
}

class Article implements HasSlug
{
    public string $title = '';
    // Fatal: 未实现 $slug 的 get/set hook
}

// ✅ 必须实现所有声明的 hook
class Article implements HasSlug
{
    public string $title = '';
    public string $slug {
        get => strtolower(str_replace(' ', '-', $this->title));
        set => $this->title = ucwords(str_replace('-', ' ', $value));
    }
}
```

---

## 十三、总结与展望

### 13.1 核心要点回顾

1. **Property Hooks 是 PHP 声明式编程的重大进步**：它将属性的读写行为内联到声明处，消除了魔术方法的性能和类型安全问题。
2. **计算属性零内存开销**：只有 `get` hook 的属性不分配 backing value，JIT 可内联优化。
3. **数据验证内联化**：`set` hook 天然适合声明式验证，让对象始终处于合法状态。
4. **完美替代 Laravel Accessor/Mutator**：代码更清晰、类型更安全、性能更优。
5. **渐进式迁移可行**：新代码优先使用，旧代码在重构时逐步替换。

### 13.2 生态影响展望

- **Laravel**：预计 Laravel 12+ 将原生支持 Property Hooks，`Attribute` API 逐步废弃。
- **PHPStan/Psalm**：静态分析工具将原生理解 Property Hooks，提供更精确的类型推导。
- **框架无关**：Property Hooks 是 PHP 原生特性，Symfony、Yii 等框架也可以利用。
- **领域驱动设计（DDD）**：Property Hooks 将大幅简化 Value Object 和 Entity 的实现，推动 PHP 社区向 DDD 靠拢。

### 13.3 未来 RFC 方向

- **参数化 Hook**：允许 hook 接收额外参数，如 `$prop(index)` 的数组式访问。
- **Hook 组合**：类似 trait 的 hook 复用机制，避免在多个类中重复相同的验证逻辑。
- **静态属性 Hook**：将 hook 机制扩展到静态属性。

PHP 8.5 Property Hooks 的引入，标志着 PHP 在类型安全和声明式编程方向上迈出了关键一步。对于 Laravel 开发者而言，现在正是理解并掌握这一特性的最佳时机——它将从根本上改变我们编写 Eloquent 模型和领域对象的方式。

---

## 相关阅读

- [PHP 8.5 Asymmetric Visibility 实战：只读公开、可写私有的属性设计——Laravel DTO 与 Value Object 的优雅实现](/2026/06/04/PHP-8.5-Asymmetric-Visibility-实战-只读公开可写私有的属性设计-Laravel-DTO与Value-Object的优雅实现/) —— PHP 8.5 的另一项属性访问控制新特性，与 Property Hooks 配合使用可实现更精细的封装
- [PHP 8.5 Pipe Operator 实战：链式数据处理管道——告别嵌套回调的函数式编程新范式](/2026/06/04/PHP-8.5-Pipe-Operator-实战-链式数据处理管道-告别嵌套回调的函数式编程新范式/) —— 同属 PHP 8.5 新特性，Pipe Operator 与 Property Hooks 一起构成 PHP 声明式编程的核心工具集
- [Laravel Pint + Rector + PHPStan 三剑客联动：代码风格、重构、类型安全的一站式质量治理流水线](/2026/06/04/Laravel-Pint-Rector-PHPStan-三剑客联动-代码风格重构类型安全的一站式质量治理流水线/) —— 配合静态分析工具，确保 Property Hooks 代码的类型安全与风格一致性
