
title: PHP 后期静态绑定：static 关键字与继承中的方法解析
keywords: [PHP]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- oop
- 继承
- 面向对象
- Laravel
categories:
  - php
date: 2019-03-20 15:05:07
description: '深入解析 PHP 后期静态绑定（Late Static Binding）的核心原理：self:: 在编译期锁死定义类、static:: 在运行期解析为实际调用类。本文从底层 Opcode 机制出发，结合 Laravel Eloquent 源码、trait 冲突案例和继承链踩坑实战，全面讲解 LSB 在工厂方法、单例、模板方法等场景中的最佳实践与常见陷阱。'
---




# 一句话总结

`self::` 在「定义时」就锁死指向当前类，`static::` 在「运行时」根据实际调用的类决定，这就是 **后期静态绑定（Late Static Binding，LSB）**，从 PHP 5.3 开始引入。这个看似简单的区别，在实际开发中却是无数 bug 的根源——尤其是当你使用 Laravel Eloquent、编写框架基类、或者在 trait 中定义通用方法时，搞错 `self` 和 `static` 的区别可能导致整个继承体系的行为异常。

# 问题起源：self:: 的"早绑定"局限

在 PHP 5.3 之前，开发者只能使用 `self::` 来引用当前类的静态成员。`self::` 的解析时机是编译期（Compile Time），也就是说在代码被编译为 Opcode 的那一刻，`self` 就已经被替换为定义它的那个类名，之后无论通过哪个子类调用，它都指向同一个类。

```php
class A {
    public static function create() {
        return new self();   // ← 永远是 A，编译时就确定了
    }
}
class B extends A {}

var_dump(B::create());   // object(A)  ❌ 不是 B，令人困惑
```

上面的代码中，尽管我们通过 `B::create()` 调用，但返回的却是 `A` 的实例。这是因为 `self` 在 `A` 类的方法体中被定义，编译器在编译 `A` 类时就把 `self` 解析为 `A`。`B` 类继承了这个方法，但继承的只是编译后的 Opcode，其中 `self` 已经变成了硬编码的 `A`。这种行为被称为"早绑定"（Early Binding），它在很多场景下无法满足需求——特别是当我们需要编写框架级别的基类，希望子类能够自动获得正确的类型时。

在 PHP 5.3 之前，开发者为了绕过这个限制，不得不使用一些 hack 手段，比如在每个子类中都重新定义一遍工厂方法，或者使用 `get_called_class()` 函数（PHP 5.3 同期引入的辅助函数）。这些方案要么导致大量重复代码，要么写法不够优雅。正是为了解决这个痛点，PHP 核心开发者引入了 `static::` 关键字。

# 解决方案：static:: 的"后期绑定"

PHP 5.3 引入的 `static::` 关键字，将静态成员的解析推迟到了运行时（Runtime）。当代码执行到 `static::` 时，Zend 引擎会根据当前的调用上下文来确定实际的目标类，而不是在编译时就写死。

```php
class A {
    public static function create() {
        return new static();  // ← 调用谁就是谁，运行时才确定
    }
}
class B extends A {}

var_dump(B::create());   // object(B)  ✅ 正确返回子类实例
var_dump(A::create());   // object(A)  ✅ 直接调用时返回自身
```

这里的 `static` 关键字在**运行时**才决定指向——当通过 `B::create()` 调用时，`static` 指向 `B`；当通过 `A::create()` 调用时，`static` 指向 `A`。这就是"后期"（Late）绑定的含义：绑定操作发生在运行时而非编译时。这个特性使得编写可继承的基类变得简单而直观，子类无需任何额外代码就能获得正确的行为。

# self:: vs parent:: vs static:: 详细对比

在 PHP 的静态成员访问中，有三个关键字需要理解：`self::`、`parent::` 和 `static::`。它们的解析时机和指向目标各不相同，下面的表格清晰地展示了三者的区别：

| 关键字 | 解析时机 | 指向目标 | 典型用例 | 性能 | 潜在风险 |
| ---------- | -------- | ---------------------- | ---------------------------- | ---- | ---- |
| `self::` | 编译期 | 当前定义所在的类 | 访问不会被子类覆盖的内部常量/方法 | 最快（编译期确定） | 子类无法覆盖，可能不符合预期 |
| `parent::` | 编译期 | 直接父类 | 在子类中调用父类同名方法并扩展 | 最快 | 硬编码父类层级，多层继承时需注意 |
| `static::` | 运行期 | 实际被调用的那个子类 | 工厂方法、单例、模板方法 | 略慢（运行期转发） | 子类可能意外覆盖，需配合 `final` 约束 |

需要特别注意的是，`self::` 和 `parent::` 都是在编译期完成解析的，因此它们的性能完全相同，不存在运行时的额外开销。而 `static::` 由于需要在运行时查询调用上下文，理论上会有极微小的性能差异（纳秒级别），在实际业务代码中完全可以忽略。

# 编译期解析 vs 运行期解析：底层机制详解

要真正理解 `self::` 和 `static::` 的区别，必须了解 PHP 内部的编译和执行流程。很多开发者只知道"一个编译时一个运行时"，但不清楚具体机制，导致在复杂场景下无法做出正确判断。

## PHP 的执行阶段

PHP 代码从源码到最终执行，经历了三个核心阶段：

```
源码 → [词法分析/Lexer] → Token 流 → [语法分析/Parser] → AST → [编译/Compiler] → Opcode → [Zend VM 执行]
```

第一个阶段是词法分析，将源代码文本切分为一个个 Token（标记）。第二个阶段是语法分析，将 Token 流转换为抽象语法树（AST）。第三个阶段是编译，将 AST 转换为 Zend 虚拟机能直接执行的 Opcode 字节码。最后由 Zend VM 逐条执行这些 Opcode。

**`self::` 的解析发生在编译阶段。** 当编译器将 AST 转换为 Opcode 时，遇到 `self::` 会直接将其替换为定义该方法或常量的类名。也就是说，生成的 Opcode 中已经没有 `self` 这个符号了，取而代之的是一个确定的、硬编码的类名字符串。这意味着无论后续代码如何运行，`self::` 的目标类永远不会改变。

**`static::` 的解析推迟到执行阶段。** 编译器在生成 Opcode 时会保留 `static` 关键字的语义，生成一条特殊的指令（如 `FETCH_CLASS_NAME`），交给 Zend VM 在执行阶段根据当前的调用上下文（存储在 `execute_data->called_scope` 中）来动态确定目标类。

## 用 Opcode 验证解析时机差异

我们可以通过查看编译后的 Opcode 来直观地看到两者的区别：

```php
class A {
    public static function who() {
        echo self::class;     // 编译期 → 直接编码为 'A'
        echo static::class;   // 运行期 → 需要查 execute_data
    }
}
class B extends A {}
B::who();
```

使用 PHP 的 VLD 扩展或 opcache 调试工具查看生成的 Opcode：

```
// self::class → 编译器直接生成 "A" 字符串常量
L1: ECHO "A"

// static::class → 生成 FETCH_CLASS_NAME 指令，运行时才解析
L2: FETCH_CLASS_NAME ~1
L3: ECHO ~1
```

关键差异一目了然：`self::` 在编译时就变成了一个字符串常量 `"A"`，而 `static::` 则生成了一条需要在运行时执行的指令。这就是为什么 `self::` 的性能略优于 `static::`——前者在编译时就完成了所有工作，后者则需要在每次执行时额外查询一次调用上下文。但在绝大多数业务场景中，这个纳秒级的差异完全可以忽略不计。

## called_scope 的传递机制

当通过 `B::who()` 调用继承自 `A` 的方法时，Zend 引擎的内部机制如下：

1. PHP 发起 `B::who()` 的调用
2. Zend VM 在方法查找阶段，发现 `B` 没有自己的 `who()` 方法，沿继承链找到 `A::who()`
3. 在准备执行 `A::who()` 的 Opcode 之前，Zend VM 将 `B` 的 `class_entry` 指针写入执行上下文的 `called_scope` 字段
4. 执行过程中遇到 `static::` 相关的 Opcode，从 `execute_data->called_scope` 中读取 `B` 的 `class_entry`
5. `static::` 被解析为 `B`

这个机制确保了即使方法实际定义在父类中，`static::` 也能正确地指向最初发起调用的子类。这也是为什么 Laravel Eloquent 能够在 `Model` 基类中使用 `static::` 来自动适配所有子类的根本原因。

# self:: vs static:: 的详细对比代码示例

## 常量解析差异

常量是 `self::` 和 `static::` 差异最常见的场景之一。在配置管理、环境检测等场景中，选择正确的关键字至关重要：

```php
class Config {
    const ENV = 'production';

    public static function getEnv(): string {
        return self::ENV;    // 永远返回 'production'，编译时确定
    }

    public static function getEnvDynamic(): string {
        return static::ENV;  // 运行时决定，子类可以覆盖
    }
}

class DevConfig extends Config {
    const ENV = 'development';
}

echo Config::getEnv();          // production ✅
echo DevConfig::getEnv();       // production — self:: 锁死了 Config，无法被子类改变

echo Config::getEnvDynamic();   // production ✅
echo DevConfig::getEnvDynamic(); // development — static:: 指向实际调用类 DevConfig
```

在这个例子中，`getEnv()` 使用了 `self::ENV`，因此无论通过哪个子类调用，都永远返回 `'production'`。而 `getEnvDynamic()` 使用了 `static::ENV`，子类 `DevConfig` 通过覆盖常量 `ENV` 就能改变返回值。在实际项目中，你需要根据业务语义来选择：如果常量代表的是不可变的内部约定（如协议版本号），就用 `self::`；如果常量需要在子类中被定制化（如数据库配置），就用 `static::`。

## 方法解析差异

除了常量，方法调用同样受 `self::` 和 `static::` 的影响。在日志系统、通知系统等需要多态行为的场景中，这一点尤为重要：

```php
class Logger {
    protected static function getChannel(): string {
        return 'default';
    }

    public function log(string $msg): void {
        // 如果用 self::getChannel() → 永远输出 'default'
        // 用 static::getChannel() → 运行时用实际类的实现
        echo '[' . static::getChannel() . '] ' . $msg . PHP_EOL;
    }
}

class AppLogger extends Logger {
    protected static function getChannel(): string {
        return 'app';
    }
}

class DbLogger extends Logger {
    protected static function getChannel(): string {
        return 'database';
    }
}

(new Logger())->log('test');      // [default] test
(new AppLogger())->log('test');   // [app] test      ✅ 正确使用了子类的通道
(new DbLogger())->log('test');    // [database] test  ✅ 正确使用了子类的通道
```

这里的 `Logger` 基类定义了 `log()` 方法的通用逻辑，但日志通道的具体名称由子类通过覆盖 `getChannel()` 来决定。如果 `log()` 方法中使用了 `self::getChannel()`，那么所有子类的日志都会输出到 `'default'` 通道，子类的覆盖完全失效——这在排查问题时会非常令人困惑。

## 链式调用中的差异

在构建查询构造器、流式 API 等链式调用场景中，`static::` 的作用尤为突出：

```php
class QueryBuilder {
    protected string $table = '';

    public static function table(string $name): static {
        $instance = new static();  // 运行时创建实际调用类的实例
        $instance->table = $name;
        return $instance;
    }

    public function dump(): void {
        echo 'Class: ' . static::class . ', Table: ' . $this->table . PHP_EOL;
    }
}

class UserQuery extends QueryBuilder {}

UserQuery::table('users')->dump();
// 输出: Class: UserQuery, Table: users ✅
// 如果用 self:: 替代 static::，new self() 会创建 QueryBuilder 而非 UserQuery
```

在链式调用中，如果第一个静态方法使用了 `self::`，那么整个调用链返回的实例类型都会错误，后续的方法调用也会基于错误的类型继续执行，这种 bug 在复杂的流式 API 中极难排查。

# 典型应用场景

## 1. 工厂方法模式

工厂方法是 `static::` 最经典的应用场景。基类定义创建对象的通用流程，子类通过继承自动获得创建正确类型实例的能力，无需重复编写任何代码：

```php
abstract class Model {
    public static function create(array $attributes) {
        $instance = new static();   // 子类各自实例，运行时确定
        return $instance->fill($attributes);
    }
}
class User extends Model {}
User::create(['name' => 'John']);   // 返回 User 实例，而非 Model
```

## 2. 模板方法配合常量覆盖

模板方法模式中，基类定义算法骨架，子类通过覆盖常量或方法来定制具体行为。`static::` 使得基类能够在运行时访问子类提供的定制化值：

```php
class Base {
    const TABLE = 'base';
    public static function table() {
        return static::TABLE;   // 运行时获取子类定义的表名
    }
}
class Order extends Base {
    const TABLE = 'orders';
}
echo Order::table();   // orders ✅
```

## 3. 注册表模式与配置驱动

在需要根据调用类自动推断配置的场景中，`static::` 可以避免大量的条件判断和配置映射：

```php
class Service {
    protected static function getConfigKey(): string {
        return static::class . '.config';
    }

    public static function loadConfig(): array {
        $key = static::getConfigKey();
        return config($key);  // 自动加载对应类的配置
    }
}

class PaymentService extends Service {}
class NotificationService extends Service {}

// 自动加载 payment.config 和 notification.config
PaymentService::loadConfig();
NotificationService::loadConfig();
```

# Laravel Eloquent 中的真实应用

Laravel 的 Eloquent ORM 是后期静态绑定在真实框架中最经典、最全面的实践。`Model` 基类中大量使用 `static::` 和 `new static()` 来实现零配置的子类继承——你只需要创建一个继承 `Model` 的类，定义表名（甚至不定义也行，Eloquent 会自动推断），就能获得完整的 CRUD 能力。

```php
// Illuminate\Database\Eloquent\Model 源码简化
abstract class Model {
    protected $table;

    // new static() —— 调用方是哪个子类就实例化哪个
    public static function create(array $attributes) {
        $model = new static($attributes);
        $model->save();
        return $model;
    }

    // static::query() —— 每个子类自动获取自己的查询构建器
    public static function find($id, $columns = ['*']) {
        return static::query()->find($id, $columns);
    }

    // getTable() 用 static 获取子类自动推断的表名
    public function getTable() {
        return $this->table ?? Str::snake(Str::pluralStudly(class_basename(static::class)));
    }
}

class User extends Model {}       // → users 表（自动推断）
class OrderItem extends Model {}  // → order_items 表（自动推断）
```

正是因为 `new static()` 的后期绑定，`User::create([...])` 返回的是 `User` 实例而不是 `Model` 实例，`User::find(1)` 也自动查询 `users` 表。如果改用 `new self()`，所有子类的 `create()` 和 `find()` 都会返回 `Model` 实例——Eloquent 将完全无法工作。可以说，没有后期静态绑定，就没有 Eloquent 优雅的继承体系。

## Eloquent 中 static:: 的完整应用链

Eloquent 中 `static::` 的使用远不止实例化和表名推断，它贯穿了模型的整个生命周期：

```php
// 1. 查询入口 —— static::query() 确保使用子类的 connection、table 和 scopes
public static function query(): Builder {
    return static::newQuery();
}

// 2. 新建查询构建器 —— 每个子类获得独立的 Builder 实例
protected function newQueryWithoutScopes(): Builder {
    return new Builder($this->newQueryWithoutRelationships());
}

// 3. 序列化 —— static::class 确保 JSON 中返回正确的类名
public function jsonSerialize(): mixed {
    return $this->toArray();
}

// 4. 事件系统 —— static::class 用于确定模型事件的触发来源
protected static function boot() {
    // 每个子类各自调用 boot 一次
    // static:: 确保事件监听器注册到正确的模型类
}
```

理解了 `static::` 在 Eloquent 中的作用，你就能明白为什么自定义模型时不需要手动指定表名、不需要重写 `find()` 方法、不需要为每个模型单独实现 `create()` ——后期静态绑定让基类的通用逻辑在子类上自动获得了正确的多态行为。

# trait 中后期静态绑定的行为差异

trait 中使用 `self::` 和 `static::` 的行为与普通的类继承略有不同，这是很多开发者容易忽略的细节。由于 trait 的本质是代码复制粘贴，它的静态成员解析规则与类继承存在微妙但重要的差异。

## trait 中 self:: 的解析规则

在 trait 中，`self::` 解析为**使用该 trait 的类**，而非 trait 本身。这是因为 trait 不是独立的类，它的代码在编译时会被"复制"到使用它的类中，因此 `self::` 在 trait 中的语义等同于在使用类中直接编写：

```php
trait HasName {
    public function getName(): string {
        return self::class;  // 解析为使用 trait 的类，而非 trait 本身
    }
}

class User {
    use HasName;
}

class Admin {
    use HasName;
}

echo (new User())->getName();   // User ✅ — self:: 指向 User
echo (new Admin())->getName();  // Admin ✅ — self:: 指向 Admin
```

看起来在简单场景下 `self::` 和 `static::` 行为一致？确实如此。但在**继承链**中，两者的差异就显现出来了：

```php
trait HasType {
    public static function getType(): string {
        return self::class;  // 编译时绑定到直接使用 trait 的类
    }
}

class Base {
    use HasType;
}

class Child extends Base {}

echo Base::getType();   // Base   ✅
echo Child::getType();  // Base   ❌ 不是 Child！
// self:: 在 Base 的编译上下文中就已经确定为 Base 了
```

当 `Child` 继承了 `Base`（而 `Base` 使用了 `HasType` trait），`Child::getType()` 调用的是 `Base` 中通过 trait 复制进来的方法。在这个方法中，`self::` 在编译 `Base` 类时就被解析为 `Base`，因此即使通过 `Child` 调用，返回的仍然是 `Base`。

而如果使用 `static::`，结果就完全不同了：

```php
trait HasType {
    public static function getType(): string {
        return static::class;  // 运行时解析，指向实际调用类
    }
}

class Base {
    use HasType;
}

class Child extends Base {}

echo Base::getType();   // Base   ✅
echo Child::getType();  // Child  ✅ 运行时正确指向 Child
```

## trait 中的常量覆盖问题

trait 中引用常量时，`self::` 和 `static::` 的行为差异同样存在：

```php
trait Timestampable {
    public function getFormat(): string {
        return static::DATE_FORMAT;  // 运行时查找使用类的常量
    }
}

class Article {
    use Timestampable;
    const DATE_FORMAT = 'Y-m-d';
}

class Event {
    use Timestampable;
    const DATE_FORMAT = 'H:i:s';
}

echo (new Article())->getFormat();  // Y-m-d ✅
echo (new Event())->getFormat();    // H:i:s ✅
```

如果将 `static::DATE_FORMAT` 改为 `self::DATE_FORMAT`，那么在继承链中调用时可能出现意外结果。

**trait 最佳实践**：在 trait 中几乎总是应该使用 `static::` 而非 `self::`，除非你明确需要在编译时锁死某个值并且不希望子类改变。这是因为在 trait 的使用场景中，多态行为是最常见的需求。

# 踩坑案例：继承链过深导致的 bug

## 案例一：三层继承中的静态属性共享陷阱

这是一个在实际项目中非常容易出现的问题。当多层继承中的子类没有重新声明静态属性时，`static::` 可能会访问到父类的共享属性：

```php
class BaseModel {
    protected static string $connection = 'mysql';

    public static function getConnection(): string {
        return static::$connection;
    }
}

class TenantModel extends BaseModel {
    protected static string $connection = 'tenant_db';
}

class User extends TenantModel {
    // 没有覆盖 $connection，看似会继承 TenantModel 的 'tenant_db'
}

class Admin extends TenantModel {
    protected static string $connection = 'admin_db';
}

// 初看之下一切正常
echo User::getConnection();   // tenant_db ✅
echo Admin::getConnection();  // admin_db  ✅
```

但问题出在静态属性的初始化时机上。PHP 的静态属性在类被首次使用时初始化，而子类如果没有显式声明静态属性，访问时会沿继承链向上查找。在某些复杂的运行时场景中（如热重载、反射、序列化），静态属性的状态可能被意外污染。

## 案例二：单例模式中的继承陷阱

这是 `static::` 与静态属性结合时最经典的坑：

```php
class Application {
    protected static ?Application $instance = null;

    public static function getInstance(): static {
        if (static::$instance === null) {
            static::$instance = new static();
        }
        return static::$instance;
    }
}

class AdminApp extends Application {}

$app1 = Application::getInstance();
$app2 = AdminApp::getInstance();

// 期望：$app1 和 $app2 是不同的实例
// 实际：$app2 返回的是 Application 实例！

var_dump($app2 instanceof Application); // true
var_dump($app2 instanceof AdminApp);    // false ❌ 出乎意料！
```

问题的根源在于：当 `Application::getInstance()` 首次执行时，`static::$instance` 被赋值为 `Application` 的实例。当 `AdminApp::getInstance()` 执行时，`static::$instance` 沿继承链查找到的仍然是 `Application` 中那个已经被赋值的属性，因此条件判断 `=== null` 为 `false`，直接返回了 `Application` 的实例。

**修复方案**：使用注册表模式，为每个类维护独立的实例：

```php
class Application {
    protected static array $instances = [];

    public static function getInstance(): static {
        $class = static::class;
        if (!isset(static::$instances[$class])) {
            static::$instances[$class] = new static();
        }
        return static::$instances[$class];
    }
}

class AdminApp extends Application {}

$app1 = Application::getInstance();
$app2 = AdminApp::getInstance();

var_dump($app2 instanceof AdminApp);  // true ✅ 每个子类独立的实例
```

这个修复利用了数组的 key 来隔离不同类的实例，同时保留了 `static::` 的多态特性。这是 Laravel 等大型框架中处理类似问题的标准模式。

## 案例三：多层继承中的方法覆盖遗漏

```php
class Repository {
    public static function find(int $id): static {
        return static::query()->find($id);
    }

    protected static function query(): object {
        echo "Base query\n";
        return new \stdClass();
    }
}

class UserRepository extends Repository {
    protected static function query(): object {
        echo "User query\n";
        return new \stdClass();
    }
}

class AdminRepository extends UserRepository {
    // 忘记覆盖 query()，继承了 UserRepository 的实现
    // 如果未来 UserRepository 的 query() 行为发生变化
    // AdminRepository 也会受到意外影响
}

AdminRepository::find(1);
// 输出: "User query" — 可能不是期望的行为
// 理想情况下 AdminRepository 应该有自己的 query() 实现
```

在深层继承链中，由于 `static::` 的运行时解析特性，方法的实际执行路径取决于继承链上最近的实现。如果中间某一层的实现发生了变化，所有没有显式覆盖的子类都会受到影响。这在团队协作和长期维护的项目中尤其危险。

## 案例四：静态属性在继承中的共享与隔离

```php
class Model {
    protected static array $events = [];
}

class User extends Model {
    // 没有重新声明 $events
}

class Order extends Model {
    // 也没有重新声明 $events
}

User::$events['created'] = 'sendWelcomeEmail';

// 问题：static::$events 实际上是同一个数组
// Order 的 events 也会包含 'created' 事件
var_dump(Order::$events); // ['created' => 'sendWelcomeEmail'] ❌ 被污染了！
```

这是 PHP 静态属性的一个根本特性：子类如果不重新声明同名静态属性，所有子类共享父类的那个属性。Laravel 的 Eloquent 通过在 `boot()` 方法中使用运行时注册机制巧妙地解决了这个问题，而不是依赖静态属性的自动隔离。

# 何时应该用 self:: 而非 static::

`static::` 并非万能。当一个值**绝不应该被子类改变**时，`self::` 才是正确选择。这不是性能问题，而是安全性问题——`self::` 提供了一种编译时保证，确保某些关键值不会在继承链中被意外修改。

```php
class PaymentGateway {
    const VERSION = '2.0';           // API 版本，不能被子类篡改
    const SIGN_ALGO = 'SHA256';      // 签名算法，安全相关

    public function getVersion(): string {
        return self::VERSION;         // ✅ 永远是 '2.0'
        // return static::VERSION;    // ❌ 子类可能覆盖成 '1.0'，导致安全风险
    }

    public function getSignAlgo(): string {
        return self::SIGN_ALGO;       // ✅ 永远是 'SHA256'
    }
}

class LocalGateway extends PaymentGateway {
    const VERSION = '1.0';           // 错误或恶意覆盖
    const SIGN_ALGO = 'MD5';         // 弱算法，不应被使用
}

echo (new PaymentGateway())->getVersion();  // '2.0' — self:: 保证一致
echo (new LocalGateway())->getVersion();    // '2.0' — 仍然是 2.0，安全
echo (new LocalGateway())->getSignAlgo();   // 'SHA256' — 安全算法不受子类影响
```

**经验法则总结**：
- 涉及安全相关配置（加密算法、密钥、签名方式）→ 始终用 `self::`
- 涉及版本号、协议版本等不可变约定 → 始终用 `self::`
- 涉及内部实现细节（私有工具方法、调试标记）→ 用 `self::`
- 涉及业务逻辑扩展点（表名、通道、配置）→ 用 `static::`

# 常见陷阱

## 陷阱一：构造函数中的链式调用导致意外递归

```php
class QueryBuilder {
    protected array $wheres = [];

    public function __construct() {
        $this->wheres = [];
    }

    public static function make(): static {
        return new static();  // 这里会触发子类的构造函数
    }
}

class UserQuery extends QueryBuilder {
    protected string $table = 'users';

    public function __construct() {
        parent::__construct();
        // ⚠️ 当 UserQuery::make() 被调用时，new static() 创建 UserQuery 实例
        // 会触发这个构造函数
        // 如果构造函数中有副作用（如注册事件、写日志），要小心
        echo "UserQuery constructed\n";
    }
}

UserQuery::make(); // 输出: "UserQuery constructed\n"
```

## 陷阱二：trait 中使用 self:: 导致继承链断裂

```php
trait HasSlug {
    public static function fromSlug(string $slug): static {
        // return self::where('slug', $slug)->first();  // ❌ 可能指向错误的类
        return static::where('slug', $slug)->first();   // ✅ 运行时指向实际调用类
    }
}

class Article extends Model { use HasSlug; }
class Page extends Model { use HasSlug; }
```

## 陷阱三：final 方法与 static:: 的常见误解

```php
class Base {
    final public static function instance(): static {
        return new static();
    }
}

// 很多人以为 final 会阻止 static:: 的多态行为，实际上不会
// final 只禁止子类"覆盖方法体"，但 static:: 的后期绑定仍然生效
class Child extends Base {}
var_dump(Child::instance());  // object(Child) ✅ 子类实例，不是 Base
```

## 陷阱四：静态属性未重新声明导致子类间数据污染

```php
class CacheStore {
    protected static array $data = [];
    
    public static function set(string $key, $value): void {
        static::$data[$key] = $value;
    }
    
    public static function get(string $key) {
        return static::$data[$key] ?? null;
    }
}

class FileCache extends CacheStore {}
class RedisCache extends CacheStore {}

FileCache::set('foo', 'bar');
// 如果 FileCache 没有重新声明 $data
// static::$data 实际上指向 CacheStore 的同一个数组
// RedisCache::get('foo') 可能返回 'bar' — 数据被污染了！
```

# PHP 8.x 与 static 关键字的演进

PHP 8.0 及之后的版本对 `static` 关键字的支持进一步增强，使得后期静态绑定在类型系统层面得到了正式认可：

- **PHP 8.0**：引入 `static` 作为返回类型声明（`function foo(): static`），与后期静态绑定语义一致——返回类型自动为实际调用类。这是官方对 LSB 在类型系统层面的正式支持，使得 IDE 和静态分析工具能够正确推断返回类型。
- **PHP 8.1**：引入枚举（`enum`）类型，但枚举不支持 `static::` 绑定（枚举没有子类概念），这是开发者在使用枚举时容易混淆的新场景。
- **PHP 8.2**：废弃动态属性（`#[\AllowDynamicProperties]`），促使更多框架使用 `static::` 配合工厂方法创建实例，避免直接 `new $class()` 绕过构造函数的风险。
- **静态分析工具**（PHPStan、Psalm）：能正确推断 `static::` 的返回类型为 `static`（即调用者类型），但对 `self::` 推断为定义类本身。在严格模式下，这会影响类型安全检查的结果和代码的通过率。

```php
// PHP 8.0+ 推荐写法 —— 使用 : static 返回类型声明
class Repository {
    public static function find(int $id): static {
        return static::query()->findOrFail($id);
    }
}
```

PHP 8.0 引入的 `: static` 返回类型声明是对后期静态绑定特性的最重要补充。它不仅在运行时保证了正确的类型，还在静态分析阶段提供了类型安全保证。在现代 PHP 项目中，所有返回 `static` 类型的工厂方法都应该使用这个返回类型声明。

# 实战决策速查表

在日常开发中，面对 `self::`、`static::` 和 `parent::` 的选择，可以参考下面的决策表：

| 场景 | 推荐用法 | 原因 |
|------|----------|------|
| 工厂方法创建实例 | `new static()` | 子类各自返回正确类型 |
| 访问子类可覆盖的常量 | `static::CONST` | 允许子类自定义配置 |
| 访问不可变常量（版本号、密钥） | `self::CONST` | 防止子类篡改关键值 |
| trait 中的方法调用 | `static::method()` | 确保宿主类的正确解析 |
| 调用父类的原始实现 | `parent::method()` | 明确意图，编译期确定 |
| PHP 8.0+ 返回类型声明 | `: static` | 官方类型系统支持 |
| 单例模式 | `new static()` + 注册表 | 避免子类共享同一实例 |
| 静态属性隔离 | 每个子类重新声明 | PHP 静态属性本身不自动隔离 |

# 小结

后期静态绑定是 PHP 面向对象体系中最容易被忽略却最常踩坑的特性之一。掌握以下核心要点，就能在绝大多数场景中做出正确选择：

- 写库/框架的抽象基类，几乎都应该用 `static::`，给子类留出扩展空间
- 写"绝不允许子类覆盖"的安全相关内部细节，才用 `self::`
- Laravel Eloquent 的整个继承体系就是靠 `static::` 实现的零配置继承
- PHP 8.0+ 的 `: static` 返回类型声明是官方对后期绑定的正式类型系统认可
- 在 trait 中优先使用 `static::`，避免继承链中的意外行为
- 注意静态属性的共享特性，必要时每个子类需要重新声明

# 相关阅读

- [OOP 面向对象](/categories/PHP/oop/) — 理解面向对象基础概念，为后期静态绑定打下根基
- [接口与抽象类](/categories/PHP/vs-interfaceabstract/) — 抽象类与 static:: 在设计模式中的配合使用
- [依赖注入（DI）与 IoC 容器](/categories/PHP/dependency-injection/) — 从 static:: 工厂方法到依赖注入的进阶之路
- [常见的设计模式](/categories/PHP/design-patterns/) — 工厂方法、单例、模板方法等模式中 static:: 的实际应用
