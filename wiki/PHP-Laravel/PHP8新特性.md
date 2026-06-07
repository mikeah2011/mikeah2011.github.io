# PHP 8.x 新特性

> 从 PHP 8.0 到 8.5 的核心语言特性演进，涵盖属性钩子、JIT 改进、异步生态、类型系统增强与开发者体验提升。

## 定义

PHP 8.x 系列是 PHP 语言现代化的关键阶段，每一代都带来显著的语言级改进：

| 版本 | 核心特性 |
|------|----------|
| 8.0 | JIT 编译器、联合类型、Named Arguments、Attributes、Match 表达式 |
| 8.1 | 枚举（Enum）、Fibers、只读属性、交集类型 |
| 8.2 | 只读类（Readonly Class）、DNF 类型、弃用动态属性 |
| 8.3 | 类常量类型声明、`#[Override]` 注解、json_validate() |
| 8.4 | 属性钩子（Property Hooks）、不对称可见性（Asymmetric Visibility）、管道操作符（Pipe Operator） |
| 8.5 | JIT Trace-Based 策略升级、Fibers 增强、原生异步 I/O |

## 核心原理

### 属性钩子（Property Hooks）

PHP 8.4 引入的属性钩子允许在类属性上定义 `get` 和 `set` 钩子，拦截属性的读取和写入操作，告别样板 getter/setter：

```php
class User
{
    public string $email {
        set(string $value) {
            if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException("Invalid email");
            }
            $this->email = strtolower($value);
        }
    }

    // 虚拟属性：没有 backing field
    public string $displayName {
        get => $this->firstName . ' ' . $this->lastName;
    }
}
```

**关键能力**：
- **虚拟属性**：只有 `get` 钩子不需要 backing field，实现计算属性
- **继承覆盖**：子类可以覆盖父类的属性钩子
- **缓存透明化**：在钩子中实现延迟加载，对调用者完全透明

### 不对称可见性（Asymmetric Visibility）

```php
class Money
{
    // 外部只读，内部可写
    public private(set) int $amount;
    public private(set) string $currency;

    public function __construct(int $amount, string $currency)
    {
        $this->amount = $amount;
        $this->currency = $currency;
    }
}
```

解决了长期存在的"公开属性但限制外部修改"的痛点，特别适合 DTO 和 Value Object。

### 管道操作符（Pipe Operator）

```php
$result = $input
    |> strlen(...)
    |> abs(...)
    |> strtoupper(...);
// 等价于 strtoupper(abs(strlen($input)))
```

告别嵌套回调，实现函数式链式数据处理。

### JIT 编译器演进

| 阶段 | 策略 | 性能 |
|------|------|------|
| 8.0 | Function JIT | 计算密集型提升 5-10% |
| 8.5 | Trace-Based JIT | 计算密集型提升 50-200% |

Trace-Based JIT 通过识别热路径（hot path）进行类型特化与内联优化。

### Fibers 增强

PHP 8.1 引入 Fiber 作为协程原语，8.5 进一步增强：
- 改进的栈切换机制
- 更好的异常传播
- 与事件循环的集成优化

## 实战案例

### 属性钩子实现缓存透明化

来自博客：[PHP 8.5 新特性前瞻：属性钩子、JIT 改进与异步生态演进](/2026/06/02/PHP-8.5-新特性前瞻-属性钩子-JIT改进与异步生态演进/)

```php
class Product
{
    private ?array $cachedReviews = null;

    public array $reviews {
        get {
            return $this->cachedReviews ??= Review::where('product_id', $this->id)->get()->toArray();
        }
    }
}
// 调用者直接用 $product->reviews，无需知道缓存逻辑
```

### Asymmetric Visibility 实现 DTO

来自博客：[PHP 8.5 Asymmetric Visibility 实战](/2026/06/01/PHP-8.5-Asymmetric-Visibility-实战-只读公开可写私有的属性设计-Laravel-DTO与Value-Object的优雅实现/)

```php
class OrderDTO
{
    public private(set) string $id;
    public private(set) Money $total;
    protected(set) string $status;

    public function markAsPaid(): void
    {
        $this->status = 'paid'; // 内部可修改
    }
}
```

### Pipe Operator 数据处理管道

来自博客：[PHP 8.5 Pipe Operator 实战](/2026/06/01/PHP-8.5-Pipe-Operator-实战-链式数据处理管道-告别嵌套回调的函数式编程新范式/)

```php
$cleaned = $rawInput
    |> fn($v) => trim($v)
    |> fn($v) => strip_tags($v)
    |> fn($v) => mb_strtolower($v)
    |> fn($v) => preg_replace('/\s+/', ' ', $v);
```

## 相关概念

- [面向对象编程](面向对象.md) - PHP OOP 基础
- [垃圾回收机制](垃圾回收.md) - 内存管理
- [进程、线程与协程](进程线程协程.md) - Fibers 协程模型
- [PHP 高性能运行时](PHP高性能运行时.md) - Octane/Swoole/FrankenPHP

## 常见问题

**Q: 属性钩子和 __get/__set 魔术方法有什么区别？**
A: 属性钩子是声明式的、类型安全的、针对单个属性的；魔术方法是命令式的、全局拦截的、缺乏类型安全。

**Q: 属性钩子会影响性能吗？**
A: 编译后的属性钩子在 C 层面执行，性能接近普通属性访问，比魔术方法快得多。

**Q: JIT 对 Web 请求有明显提升吗？**
A: 传统 PHP-FPM 短生命周期模型下 JIT 收益有限（启动开销），但在 Octane/Swoole 长驻进程中 JIT 的热路径优化效果显著。
