---

title: PHP 版本对比：PHP 5.x vs 7.x vs 8.x 新特性与性能差异
keywords: [PHP, 版本对比, 新特性与性能差异]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- PHP 8
- JIT
- 版本升级
- PHP Features
- 枚举
- 纤程
categories:
- php
date: 2021-03-20 15:05:07
description: 全面梳理PHP版本演进历程，从PHP 4到PHP 8.4各版本新特性深度对比分析。涵盖命名参数、JIT即时编译器原理与配置、枚举类型与回标枚举、只读属性与只读类、match模式匹配表达式、纤程Fiber协程编程、属性钩子Property Hooks等PHP8核心新特性。附完整可运行代码示例、JIT编译原理详解与性能基准测试数据、各版本内存占用与请求吞吐量对比，以及从PHP7到PHP8的完整迁移指南与各版本破坏性变更排查清单，帮助开发者快速掌握PHP8新特性及版本升级要点。
---






# PHP 版本演进全景：从 PHP 4 到 PHP 8.4

PHP 自 1995 年诞生以来，经历了数十个大版本迭代。每一次升级都带来了语言层面的重大突破——从 PHP 5 引入完整的面向对象体系，到 PHP 7 用全新 Zend Engine 实现性能翻倍，再到 PHP 8 以 JIT 编译、枚举、纤程等特性彻底拥抱现代编程范式。本文将系统梳理各版本核心特性，提供可运行的代码示例，对比性能差异，并给出从 PHP 7.x 迁移到 8.x 的完整指南。

---

## 一、版本特性总览表

|                             版本                             |                             核心特性                             |
| :----------------------------------------------------------: | :----------------------------------------------------------: |
|                              4                               | 支持 autoload、PDO 和 MySQLi、类型约束，纯过程式语言，没太多复杂的 |
|                             5.2                              |                 支持JSON，完全实现了面向对象                 |
|                             5.3                              | 匿名函数，魔术方法，命名空间，后期静态变量绑定，hereDoc、nowDoc、const、三元运算、Phar |
|                             5.4                              | (无需修改ini配置)短标签，数组简写，Traits工具类，内置Web服务器 |
|                             5.5                              |       yield迭代器、生成器(foreach)，foreach支持list()        |
|                             5.6                              | 增强常量、命名空间，可变函数参数，**幂运算，大文件上传，php://input可重用 |
| [7.0](http://php.net/manual/zh/migration70.new-features.php) | 新版ZendEngine引擎，匿名类，返回类型声明，变量类型、错误异常、zval使用栈内存等许多新特性 |
| [7.1](http://php.net/manual/zh/migration71.new-features.php) | 可空(NullLable)类型、list简写[]、指定key，const常量可指定权限，多异常捕获处理 |
|                             7.2                              | 新的对象类型，逆变和协变，通过名称加载扩展，允许重写抽象方法，使用argon2算法生成密码散列，新增ext/PDO字符串扩展类型 |
|                             7.3                              |                   取数组第一个/最后一个键                    |
|                             7.4                              |     数组延展操作符(...$a)、箭头函数(=>)，空合并运算赋值      |
|                             8.0                              | 注解、JIT、命名参数、联合类型、构造器属性提升，match表达式、nullsafe运算符、改进了类型系统、错误处理、语法一致性 |
|                             8.1                              | 枚举、只读属性、first-class可调用语法、纤程、交集类型和性能改进等 |
|                             8.2                              | 只读类（readonly class）、独立类型 `true`/`false`/`null`、`Random` 扩展、动态属性弃用、常量在 trait 中 |
|                             8.3                              | 类型化类常量、`#[Override]` 注解、`json_validate()`、深拷贝 `Randomizer::getBytesFromString()`、类常量枚举 |
|                             8.4                              | 属性钩子（property hooks）、不对称可见性、`new` 表达式无需括号、惰性对象、`#[\Deprecated]` 注解、JIT 改进 |

---

## 二、重点版本代码示例

### PHP 7.0 — 返回类型声明 & 匿名类

PHP 7.0 是 PHP 历史上性能提升最大的版本之一，Zend Engine 3 带来了约 2 倍的速度提升。同时引入了开发者期盼已久的返回类型声明和匿名类。

```php
// 返回类型声明 — 让函数签名更加完整
function divide(float $a, float $b): float {
    if ($b === 0.0) {
        throw new \InvalidArgumentException('Division by zero');
    }
    return $a / $b;
}

// 可空返回类型（7.1 增强）
function findUser(int $id): ?User {
    return $this->repository->findById($id); // 可返回 null
}

// 匿名类 — 一次性实现接口，无需单独创建文件
$logger = new class implements \Psr\Log\LoggerInterface {
    public function log($level, string|\Stringable $message, array $context = []): void {
        echo "[{$level}] {$message}\n";
    }
};

// 实际应用场景：快速创建 Mock 对象或事件监听器
$dispatcher->listen('user.created', new class {
    public function handle(UserCreated $event): void {
        Mail::to($event->user->email)->send(new WelcomeMail($event->user));
    }
});
```

### PHP 7.1 — 可空类型 & 多异常捕获

```php
// 可空类型 — 参数或返回值可以是 null
function getUser(int $id): ?User {
    // ?User 等价于 User|null
    return $this->db->find($id);
}

// 多异常捕获 — 一个 catch 块处理多种异常类型
try {
    $order = $service->process($input);
} catch (InvalidOrderException | InsufficientStockException $e) {
    Log::warning('Order failed', ['error' => $e->getMessage()]);
    return response()->json(['error' => $e->getMessage()], 422);
} catch (\Throwable $e) {
    Log::error('Unexpected error', ['exception' => $e]);
    return response()->json(['error' => 'Internal error'], 500);
}

// list() 简写与指定 key
$data = ['name' => 'Alice', 'age' => 30, 'city' => 'Beijing'];
['name' => $name, 'city' => $city] = $data;
// $name = 'Alice', $city = 'Beijing'
```

### PHP 7.2 — 类型系统增强

```php
// object 类型声明 — PHP 7.2 新增
function processEntity(object $entity): void {
    // 接受任何对象，排除标量和数组
}

// 逆变（contravariance）：参数类型可以更宽泛
interface Repository {
    public function save($entity): void;
}
class UserRepository implements Repository {
    // ✅ PHP 7.2 允许参数类型更宽泛（逆变）
    public function save($entity): void {
        // parent 用 $entity，子类也可以用更宽的类型
    }
}

// 密码散列 — argon2i 算法（7.2 新增 PASSWORD_ARGON2I）
$hash = password_hash($password, PASSWORD_ARGON2I, [
    'memory_cost' => 65536,
    'time_cost'   => 4,
    'threads'     => 3,
]);
```

### PHP 7.4 — 箭头函数 & 空合并赋值 & 类型属性

PHP 7.4 是 PHP 8.0 之前的重要过渡版本，引入了箭头函数、类型化属性等实用特性。

```php
// 箭头函数 — 自动捕获外部变量（闭包的简写形式）
$nums = [1, 2, 3, 4, 5];
$squared = array_map(fn($n) => $n ** 2, $nums);
// [1, 4, 9, 16, 25]

$threshold = 10;
$filtered = array_filter($nums, fn($n) => $n > $threshold);
// 自动捕获 $threshold，无需 use 关键字

// 空合并赋值 — ??= 仅当变量为 null 时赋值
$config['timeout'] ??= 30;
// 等价于: $config['timeout'] = $config['timeout'] ?? 30;

// 类型化属性 — 终于可以在类中声明属性类型
class User {
    private int $id;
    private string $name;
    private ?string $email = null;  // 可空属性，带默认值
    private array $roles = [];

    public function __construct(int $id, string $name) {
        $this->id = $id;
        $this->name = $name;
    }
}

// 数组展开操作符 — 在数组字面量中使用 ...
$defaults = ['timeout' => 30, 'retries' => 3];
$config = [...$defaults, 'debug' => true, 'timeout' => 60];
// ['timeout' => 60, 'retries' => 3, 'debug' => true]  — 后者覆盖前者
```

### PHP 8.0 — 命名参数 & match 表达式 & 联合类型

PHP 8.0 是 PHP 语言的里程碑版本，引入了 JIT 编译器、命名参数、联合类型、match 表达式、构造器属性提升、注解等重量级特性。

```php
// 命名参数 — 跳过中间参数的默认值，提升可读性
$conn = new PDO(
    dsn: 'mysql:host=localhost;dbname=app',
    username: 'root',
    password: 'secret',
    options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

// 命名参数的实际价值：处理有大量可选参数的函数
$html = htmlspecialchars($string, double_encode: false);
// 无需再写 htmlspecialchars($string, ENT_COMPAT, 'UTF-8', false)

// match 表达式 — 严格比较，返回值，替代冗长的 switch
$statusText = match($statusCode) {
    200 => 'OK',
    301, 302 => 'Redirect',
    404 => 'Not Found',
    500 => 'Server Error',
    default => 'Unknown',
};

// match 用于类型判断（结合 instanceof）
function formatValue(mixed $value): string {
    return match(true) {
        is_int($value)    => "Integer: {$value}",
        is_string($value) => "String: {$value}",
        is_null($value)   => 'NULL',
        default           => gettype($value),
    };
}

// 联合类型 — 参数或返回值可以是多种类型之一
function formatNumber(int|float $num): string {
    return number_format($num, 2);
}

class Cache {
    private array $store = [];

    public function get(string $key): mixed {
        return $this->store[$key] ?? null;
    }

    public function set(string $key, string|int|float|bool|array $value): void {
        $this->store[$key] = $value;
    }
}

// 构造器属性提升 — 一步完成属性声明和构造赋值
class Point {
    public function __construct(
        private float $x,
        private float $y,
        private float $z = 0.0,
    ) {}
    // 自动创建 $this->x, $this->y, $this->z 属性
}

// nullsafe 运算符 — 链式调用中优雅处理 null
$country = $user?->address?->country ?? 'Unknown';
// 如果 $user 或 $address 为 null，整个表达式返回 null，不会报错
```

### PHP 8.1 — 枚举 & 纤程 & 只读属性

PHP 8.1 引入了开发者期待已久的原生枚举类型、纤程（Fibers）和只读属性，大幅提升了语言的表达力。

```php
// 纯枚举 — 不带值，类似常量集合
enum Color {
    case Red;
    case Green;
    case Blue;
}

// 回标枚举 — 带标量值，可与数据库字段映射
enum OrderStatus: string {
    case Pending  = 'pending';
    case Paid     = 'paid';
    case Shipped  = 'shipped';
    case Complete = 'complete';

    // 枚举可以有方法
    public function label(): string {
        return match($this) {
            self::Pending  => '待支付',
            self::Paid     => '已支付',
            self::Shipped  => '已发货',
            self::Complete => '已完成',
        };
    }

    // 枚举可以实现接口
    public function color(): Color {
        return match($this) {
            self::Pending  => Color::Red,
            self::Paid     => Color::Green,
            self::Shipped  => Color::Blue,
            self::Complete => Color::Green,
        };
    }
}

// 枚举的实用方法
OrderStatus::from('pending');      // OrderStatus::Pending
OrderStatus::tryFrom('invalid');   // null（不会抛异常）
OrderStatus::cases();              // 返回所有 case 的数组

// 只读属性 — 一次赋值后不可修改
class Money {
    public function __construct(
        public readonly int $amount,    // 只读：构造后不可修改
        public readonly string $currency = 'CNY',
    ) {}
}

$m = new Money(10000, 'CNY');
echo $m->amount;   // 10000
// $m->amount = 20000; // ❌ Error: Cannot modify readonly property

// 纤程（Fibers）— 用户态协程，同步写法实现异步逻辑
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('first');    // 暂停并返回值
    echo "Got: $value\n";
    $value2 = Fiber::suspend('second');  // 再次暂停
    echo "Got: $value2\n";
});

$result = $fiber->start();     // 'first'
echo "Suspended with: $result\n";
$fiber->resume('hello');       // 输出 'Got: hello'
$result2 = $fiber->suspend();  // 'second'
$fiber->resume('world');       // 输出 'Got: world'
// 纤程执行完毕

// 纤程的实际应用：HTTP 客户端异步请求
class AsyncHttpClient {
    public function get(string $url): string {
        // Fiber::suspend 暂停当前纤程，将控制权交给调度器
        // 调度器在 I/O 就绪后 resume 纤程
        return Fiber::suspend(new PendingRequest($url));
    }
}

// 交集类型 — 参数必须同时满足多个接口约束
function cacheItem(Cacheable&Serializable $item): void {
    // $item 必须同时实现 Cacheable 和 Serializable
}
```

### PHP 8.2 — 只读类 & Random 扩展

```php
// 只读类 — 所有属性自动为 readonly
readonly class Point3D {
    public function __construct(
        public float $x,
        public float $y,
        public float $z,
    ) {}
}

$p = new Point3D(1.0, 2.0, 3.0);
// $p->x = 5.0; // ❌ Error: Cannot modify readonly property

// 独立类型 true / false / null
function alwaysTrue(): true {
    return true; // 返回类型只能是 true
}

function alwaysNull(): null {
    return null;
}

// Random 扩展 — 面向对象的随机数生成器
use Random\Randomizer;
use Random\Engine\Secure;

$randomizer = new Randomizer(new Secure());
$randomizer->getInt(1, 100);         // 1-100 的随机整数
$randomizer->getBytes(16);           // 16 字节的随机字符串
$randomizer->shuffleArray([1,2,3]);  // 随机打乱数组
$randomizer->shuffleBytes('hello');  // 随机打乱字符串

// 动态属性弃用 — 未来版本将完全移除
// #[\AllowDynamicProperties] 注解可以显式允许动态属性
#[\AllowDynamicProperties]
class LegacyClass {
    // 这个类允许动态属性，但不推荐
}
```

### PHP 8.3 — 类型化类常量 & json_validate

```php
// 类型化类常量 — 常量也可以声明类型
interface CacheInterface {
    public const int    TTL_DEFAULT = 3600;
    public const string DRIVER_FILE = 'file';
}

class RedisCache implements CacheInterface {
    public const int    TTL_DEFAULT = 7200;       // 类型必须兼容
    public const string DRIVER_FILE = 'redis';
    public const string DRIVER_REDIS = 'redis';
}

// #[Override] 注解 — 明确标注方法覆盖了父类
class AdminUser extends User {
    #[\Override]  // 如果父类删除了 getRole()，IDE 和运行时都会报错
    public function getRole(): string {
        return 'admin';
    }
}

// json_validate — 高效验证 JSON 格式（不需要解析整个 JSON）
$jsonString = '{"name": "PHP", "version": 8.3}';
if (json_validate($jsonString)) {
    $data = json_decode($jsonString, true);
}

// 对比 json_decode 的优势：不分配内存解析，仅验证格式
// 性能提升约 2-5 倍（对于只需要验证的场景）
```

### PHP 8.4 — 属性钩子 & 不对称可见性

PHP 8.4 引入的属性钩子（Property Hooks）是近年来最具变革性的特性之一，它让计算属性、数据验证、懒加载等模式可以用声明式语法实现，大幅简化了 getter/setter 的样板代码。

```php
// 属性钩子 — 计算属性无需手写 getter
class User {
    public function __construct(
        public string $first,
        public string $last,
    ) {}

    // 只读钩子：每次访问自动计算，无需手动调用方法
    public string $fullName {
        get => $this->first . ' ' . $this->last;
    }
}

echo (new User('张', '三'))->fullName; // '张 三'

// 读写钩子 — 带验证的属性
class Temperature {
    private float $celsius;

    public function __construct(float $celsius) {
        $this->celsius = $celsius;
    }

    // fahrenheit 属性：读取时自动转换，写入时反向计算
    public float $fahrenheit {
        get => $this->celsius * 9 / 5 + 32;
        set => $this->celsius = ($value - 32) * 5 / 9;
    }
}

$t = new Temperature(100);
echo $t->fahrenheit; // 212
$t->fahrenheit = 32;
echo $t->celsius;    // 0

// 不对称可见性：外部只读，内部可写
class Product {
    public private(set) float $price;
    public protected(set) string $status = 'draft';

    public function publish(): void {
        $this->status = 'published'; // 子类内部可写
    }

    public function applyDiscount(float $rate): void {
        $this->price *= (1 - $rate); // 内部可以写
    }
}

$p = new Product();
$p->price;        // ✅ OK — 读
// $p->price = 10; // ❌ 编译错误 — 外部不可写

// 懒加载对象 — 延迟初始化，首次访问时才实例化
class Container {
    // LazyObject：只有在真正访问时才创建实例
    public function getService(): Service {
        // PHP 8.4 的 lazy 对象特性让依赖注入更高效
        return new class extends Service {
            // 首次方法调用时才初始化
        };
    }
}

// #[\Deprecated] 注解 — 标记弃用的方法或类
class Helper {
    #[\Deprecated(message: 'Use newMethod() instead', since: '2.1.0')]
    public function oldMethod(): void {
        // 调用时 PHP 会产生 E_USER_DEPRECATED 警告
    }

    public function newMethod(): void {
        // 新的实现
    }
}
```

---

## 三、JIT 编译详解

JIT（Just-In-Time，即时编译）是 PHP 8.0 引入的最重要的底层优化技术。它在运行时将热点代码（频繁执行的代码路径）编译为机器码，跳过 Zend VM 的解释执行层，从而大幅提升 CPU 密集型任务的性能。

### JIT 的工作原理

PHP 的 JIT 编译器基于 DynASM（动态汇编器），工作流程如下：

```
PHP 源码 → 词法分析 → AST → OPCode（字节码）→ JIT 编译 → 机器码
                                        ↑
                                   OPCache 缓存
```

1. **OPCache 阶段**：PHP 源码被编译为 OPCode 并缓存（这是所有版本都有的优化）
2. **JIT 分析**：运行时收集代码执行热度，标记热点函数
3. **机器码生成**：将热点 OPCode 编译为 x86/ARM 机器码
4. **直接执行**：后续调用直接执行机器码，跳过 Zend VM

### JIT 配置参数

```ini
; php.ini 中的 JIT 配置
opcache.enable=1
opcache.jit_buffer_size=256M    ; JIT 代码缓冲区大小
opcache.jit=1255                ; JIT 模式配置

; opcache.jit 参数解析（4 位数字）：
; 第 1 位：禁用(0) / 启用(1) / 启用并生成 profile(2)
; 第 2 位：不使用寄存器分配(0) / 使用局部寄存器分配(1) / 全局(2)
; 第 3 位：不内联(0) / 内联(1) / 内联+特化(2)
; 第 4 位：无优化(0) / 基本块(1) / 类型推测+SSA(2) / SSA+调用推测(3) / 最大优化(5)

; 常用配置组合：
; 1255 — 适合大多数 Web 应用（启用 + 寄存器 + 内联 + 最大优化）
; 1235 — 适合内存敏感场景（启用 + 寄存器 + 不内联 + 最大优化）
; 1205 — 保守配置（启用 + 无寄存器 + 无内联 + 最大优化）
;   0  — 禁用 JIT
```

### JIT 性能基准测试

以下是基于 PHP 8.0-8.4 的典型基准测试结果（数据为相对值，实际效果因代码而异）：

| 测试场景 | PHP 7.4 | PHP 8.0 (无 JIT) | PHP 8.0 (JIT) | PHP 8.4 (JIT) |
|---|---|---|---|---|
| 纯 CPU 计算（斐波那契） | 1.0x | 1.05x | 1.8x | 2.2x |
| 数学密集（矩阵运算） | 1.0x | 1.08x | 2.5x | 3.1x |
| 正则表达式匹配 | 1.0x | 1.03x | 1.2x | 1.4x |
| Web 应用（Laravel） | 1.0x | 1.05x | 1.05-1.10x | 1.10-1.15x |
| WordPress 请求 | 1.0x | 1.04x | 1.03-1.05x | 1.05-1.08x |

**关键结论**：
- **CPU 密集型任务**（数学计算、图像处理、加密解密）：JIT 收益显著，提升 50%-200%
- **Web 请求场景**（Laravel、WordPress）：JIT 收益有限（5%-15%），因为瓶颈在 I/O 和数据库
- **PHP 8.4 的 IR 框架**进一步优化了 JIT，比 8.0 的 JIT 额外提升 10%-20%
- **OPcache 的贡献远大于 JIT**：仅启用 OPcache 就能获得 50%-100% 的性能提升

### JIT 的最佳实践

```php
// JIT 对以下场景收益最大：

// 1. 数学计算密集型
function matrixMultiply(array $a, array $b): array {
    $n = count($a);
    $result = array_fill(0, $n, array_fill(0, $n, 0));
    for ($i = 0; $i < $n; $i++) {
        for ($j = 0; $j < $n; $j++) {
            for ($k = 0; $k < $n; $k++) {
                $result[$i][$j] += $a[$i][$k] * $b[$k][$j];
            }
        }
    }
    return $result;
}

// 2. 循环密集型数据处理
function processLargeDataset(array $records): array {
    $results = [];
    foreach ($records as $record) {
        $score = $record['math'] * 0.4
               + $record['english'] * 0.3
               + $record['science'] * 0.3;
        $results[] = [
            'id'    => $record['id'],
            'score' => $score,
            'grade' => match(true) {
                $score >= 90 => 'A',
                $score >= 80 => 'B',
                $score >= 70 => 'C',
                $score >= 60 => 'D',
                default      => 'F',
            },
        ];
    }
    return $results;
}

// 3. 加密/解密密集型（JIT 优化底层算法）
// 这类场景 OPcache + JIT 组合效果最佳
```

---

## 四、性能对比：PHP 5.6 vs 7.x vs 8.x

PHP 版本升级不仅是语法层面的改进，更带来了显著的性能提升。以下数据基于公开的基准测试和实际项目经验整理：

### 内存使用对比

| 版本 | zval 大小 | 对象大小 | 内存使用（典型 Web 请求） |
|---|---|---|---|
| PHP 5.6 | 24 bytes | 96+ bytes | ~40MB |
| PHP 7.0 | 16 bytes | 32 bytes | ~18MB |
| PHP 8.0 | 16 bytes | 32 bytes | ~16MB |
| PHP 8.4 | 16 bytes | 32 bytes | ~14MB |

PHP 7.0 的 zval 改用栈内存分配，内存占用降低约 50%。这是 PHP 7 性能飞跃的关键原因之一。

### 请求吞吐量对比

| 测试项目 | PHP 5.6 | PHP 7.4 | PHP 8.0 | PHP 8.2 | PHP 8.4 |
|---|---|---|---|---|---|
| 空请求（hello world） | 1.0x | 2.5x | 2.7x | 2.8x | 2.9x |
| WordPress 首页 | 1.0x | 2.2x | 2.3x | 2.4x | 2.5x |
| Laravel API | 1.0x | 2.0x | 2.1x | 2.2x | 2.3x |
| 纯计算脚本 | 1.0x | 2.5x | 3.0x (JIT) | 3.5x (JIT) | 4.0x (JIT) |

### 升级的实际收益

**从 PHP 5.6 升级到 PHP 7.4**：性能提升约 100%-150%，这是性价比最高的升级路径。仅需修改少量语法不兼容的地方，就能获得翻倍的性能。

**从 PHP 7.4 升级到 PHP 8.0**：Web 应用性能提升约 5%-10%，CPU 密集任务（开启 JIT）提升约 50%-100%。主要收益来自新特性的代码简化。

**从 PHP 8.0 升级到 PHP 8.4**：Web 应用性能提升约 5%-8%，JIT 优化进一步带来 10%-20% 的 CPU 密集任务加速。

---

## 五、PHP 7.x 到 8.x 完整迁移指南

### 5.1 PHP 7.x → 8.0 破坏性变更

这是影响最大的迁移路径，以下是必须注意的变更：

```php
// ❌ 1. 字符串与数字比较行为变化
// PHP 7: 0 == "foo" → true（松散比较，字符串转为 0）
// PHP 8: 0 == "foo" → false（只在涉及数字字符串时做数字比较）
var_dump(0 == "foo");    // PHP 7: true, PHP 8: false
var_dump(0 == "0");      // PHP 7: true, PHP 8: true（数字字符串）
var_dump(0 == "");       // PHP 7: true, PHP 8: false

// ❌ 2. @ 运算符不再抑制 fatal error
// PHP 7: @unlink($file) 即使报 fatal error 也被抑制
// PHP 8: @ 不再抑制 fatal error，必须用 try-catch
try {
    $result = @someFunction(); // 仍然抑制 E_WARNING
} catch (\Error $e) {
    // PHP 8 中 fatal error 会到这里
}

// ❌ 3. array_key_exists() 不再支持对象
// PHP 7: array_key_exists('key', $object) 可以工作
// PHP 8: 只能用于数组，对象用 property_exists() 或 isset()
$exists = property_exists($object, 'key') && isset($object->key);

// ❌ 4. 部分函数签名变更
// 某些内部函数不再允许传 null 给非 nullable 参数
strlen(null);  // PHP 7: 0, PHP 8: TypeError

// ❌ 5. Match 表达式是严格比较（===）
// match(0) { '0' => 'match' } 不会匹配（而 switch 会）
$result = match(0) {
    '0' => 'This will NOT match',
    0   => 'This matches',
};
```

### 5.2 PHP 8.0 → 8.1 破坏性变更

```php
// ❌ 1. FILTER_SANITIZE_STRING 弃用
// PHP 7: filter_var($str, FILTER_SANITIZE_STRING)
// PHP 8.1: 使用 htmlspecialchars() 或 FILTER_SANITIZE_FULL_SPECIAL_CHARS
$clean = filter_var($input, FILTER_SANITIZE_FULL_SPECIAL_CHARS);

// ❌ 2. $GLOBALS 不能整体写入
// PHP 7: $GLOBALS = [...]; // 可以
// PHP 8.1: 不允许，必须逐个写入 $GLOBALS['key'] = ...;

// ❌ 3. 隐式 int→float 窄化弃用
function foo(float $x) {}
foo(42); // PHP 8.1: 正常（int→float 是合法的窄化）

// 但以下情况会弃用警告：
function bar(int $x) {}
bar(3.14); // PHP 8.1: Deprecated（float→int 窄化丢失精度）

// ❌ 4. 只读属性初始化限制
class User {
    public readonly string $name;
}
$user = new User();
$user->name = 'PHP';    // 第一次赋值 OK
// $user->name = '8.1'; // ❌ Error: Cannot modify readonly property
```

### 5.3 PHP 8.1 → 8.2 破坏性变更

```php
// ❌ 1. 动态属性弃用
class User {
    public string $name;
}
$user = new User();
$user->age = 25; // PHP 8.2: Deprecated
// 解决方案：添加 #[\AllowDynamicProperties] 注解，或定义正式属性

// ❌ 2. ${var} 字符串插值弃用
$name = 'PHP';
// PHP 7/8.0: "Hello ${name}"          // OK
// PHP 8.1: "Hello ${name}"            // Deprecated
// 替代方案：使用 {$name} 或 {$obj->prop}
echo "Hello {$name}";                  // ✅ 推荐

// ❌ 3. 部分可调用结构弃用
// PHP 8.2 弃用了一些隐式的可调用转换
$fn = 'strlen';   // OK
$fn = 'self::method'; // Deprecated（隐式静态方法调用）
```

### 5.4 PHP 8.2 → 8.3 破坏性变更

```php
// ❌ 1. 类型化常量必须与父类兼容
interface HasDefault {
    const string DEFAULT = 'default';
}
class Impl implements HasDefault {
    const string DEFAULT = 'custom'; // ✅ 类型必须是 string
    // const int DEFAULT = 42;       // ❌ TypeError
}

// ❌ 2. get_class() / get_parent_class() 无参调用弃用
// PHP 8.2: get_class()         // Deprecated
// PHP 8.3: 必须传参数
echo get_class($this);         // ✅ 推荐
echo $this::class;             // ✅ 更简洁的替代方案
```

### 5.5 PHP 8.3 → 8.4 破坏性变更

```php
// ❌ 1. E_STRICT 常量移除
// E_STRICT 在 PHP 8.4 中不再存在，之前用它的代码需要替换

// ❌ 2. 隐式可空参数类型弃用
// PHP 8.3: function foo(string $x = null) {}  // 隐式 nullable
// PHP 8.4: 必须显式声明
function foo(?string $x = null): void {}       // ✅ 显式 nullable

// ❌ 3. 部分类/接口的内部变更
// 某些实现细节变化可能影响继承了内部类的用户代码
```

### 5.6 升级检查工具

在升级前，使用以下工具自动化检查兼容性问题：

```bash
# 1. PHP_CodeSniffer — 检查 PHP 版本兼容性
composer require --dev squizlabs/php_codesniffer
vendor/bin/phpcs --standard=PHPCompatibility \
    --runtime-set testVersion 8.4 \
    src/

# 2. Rector — 自动修复不兼容代码
composer require --dev rector/rector
vendor/bin/rector process src/ --set=php84

# 3. PHPStan / Psalm — 静态分析找出类型问题
composer require --dev phpstan/phpstan
vendor/bin/phpstan analyse src/ --level=8

# 4. phan — PHP 静态分析器（支持 AST 分析）
# 配置 .phan/config.php 指定目标 PHP 版本
```

---

## 六、如何选择 PHP 版本

| 场景 | 推荐版本 | 理由 |
|---|---|---|
| 新项目开发 | PHP 8.4 | 最新特性 + 最佳性能 + 长期支持 |
| Laravel 11+ | PHP 8.2+ | 官方最低要求 |
| 遗留系统维护 | PHP 8.1 → 8.4 | 逐步升级，先升级到 8.1 再迭代 |
| 共享主机 | PHP 8.2 | 大多数主机已支持，稳定性好 |
| Swoole/Hyperf | PHP 8.1+ | 协程支持 + 枚举 + Fiber |
| 性能敏感型 | PHP 8.4 + JIT | CPU 密集任务 JIT 收益最大 |

**重要提示**：PHP 官方只对最近的两个大版本提供安全更新。截至 2026 年 6 月，PHP 8.3 和 8.4 处于活跃支持状态。低于 8.2 的版本已停止安全更新，强烈建议尽快升级。

---

## 相关阅读

- [PHP 8.4 新特性实战：从内存管理到性能提升](/post/php-84/) — 深入解析 PHP 8.4 的 JIT 优化、协程支持与 OPcache 调优
- [OPcache 深度解析](/post/opcache-1/) — PHP 生产环境性能优化的第一道关卡，涵盖 JIT 与预加载
- [PHP5与PHP7核心差异对比](/post/php5php7/) — PHP 5 到 PHP 7 的性能优化原理与新特性详解
- [PHP 垃圾回收机制（GC）](/post/gc/) — zval 引用计数、循环引用检测与内存泄漏排查
