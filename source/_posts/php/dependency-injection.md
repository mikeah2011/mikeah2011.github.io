---

title: 依赖注入（DI）与 IoC 容器
keywords: [DI, IoC, 依赖注入, 容器]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Laravel
- PHP
- 依赖注入
- ioc容器
- 设计模式
categories:
- php
date: 2021-04-12 10:00:00
description: 深入理解依赖注入（DI）与 IoC 容器：从三种注入方式、面向接口编程到 Laravel 容器的 bind/singleton/contextual binding 实战，再到 Symfony 容器对比、自动装配原理、循环依赖检测、PHPUnit 测试中的 Mock 技巧，以及构造器注入过多的踩坑经验。附手写 30 行 IoC 容器完整代码，帮助 PHP 开发者彻底掌握这一核心设计思想。
---



# 一句话

> **依赖注入（Dependency Injection）= 一个类不自己创建依赖，而是由外部传入。**
> **IoC 容器** = 自动帮你完成"传入"这个动作的工厂 + 注册表。

# 一、问题：为什么不能自己 new

```php
class OrderService {
    private MysqlOrderRepo $repo;
    public function __construct() {
        $this->repo = new MysqlOrderRepo(new PDO(...));   // ❌
    }
}
```

毛病：

1. **不可换实现** —— 想换 Redis？改源码
2. **不可测** —— 单元测试想 mock 数据库？改不动
3. **强耦合** —— `OrderService` 必须知道 `PDO` 的连接串
4. **依赖隐藏** —— 看构造器看不出它依赖谁

# 二、三种注入方式

## 1. 构造器注入（推荐）

```php
class OrderService {
    public function __construct(private OrderRepo $repo) {}
}
$svc = new OrderService(new MysqlOrderRepo($pdo));
```

**最佳实践**：依赖必填、对象不可变、看签名一目了然。

## 2. Setter 注入

```php
class OrderService {
    private OrderRepo $repo;
    public function setRepo(OrderRepo $repo): void { $this->repo = $repo; }
}
```

**适用**：可选依赖、运行时切换。缺点：对象创建后状态不完整。

## 3. 接口注入 / 属性注入

```php
class OrderService {
    #[Inject] public OrderRepo $repo;   // PHP 8 attribute，框架解析
}
```

**适用**：框架内部魔法。缺点：依赖魔法、IDE 补全难。

## 三种注入方式对比

| 维度 | 构造器注入 | Setter 注入 | 方法/属性注入 |
|------|-----------|------------|--------------|
| **依赖是否必填** | ✅ 必填，创建即就绪 | ❌ 可选，可能遗漏 | ❌ 可选 |
| **不可变性** | ✅ 可设 `readonly` | ❌ 可被多次覆盖 | ❌ 运行时可变 |
| **可测试性** | ✅ 直接 `new` 传 mock | ⚠️ 需要额外调用 setter | ⚠️ 需要框架支持 |
| **循环依赖** | ❌ 无法处理 | ✅ 可延迟设置 | ✅ 可延迟注入 |
| **代码可读性** | ✅ 签名即文档 | ⚠️ 需要阅读整个类 | ❌ 依赖魔法/注解 |
| **适用场景** | **绝大多数场景（首选）** | 可选依赖、打破循环 | 框架内部、AOP 切面 |

> **经验法则**：优先使用构造器注入；仅在依赖可选或需要打破循环依赖时使用 Setter 注入；属性注入仅限框架层面使用。

# 三、面向接口编程

DI 真正的价值要配合**接口**：

```php
interface OrderRepo {
    public function find(int $id): ?Order;
}
class MysqlOrderRepo implements OrderRepo { /*...*/ }
class RedisOrderRepo implements OrderRepo { /*...*/ }
class FakeOrderRepo  implements OrderRepo { /*for test*/ }

class OrderService {
    public function __construct(private OrderRepo $repo) {}   // 类型是接口！
}
```

测试时：

```php
$svc = new OrderService(new FakeOrderRepo());   // 不碰数据库就能测
```

# 四、IoC 容器：自动注入

手动 `new` 几十层依赖太累，IoC 容器替你做：

```php
$container->bind(OrderRepo::class, MysqlOrderRepo::class);
$svc = $container->make(OrderService::class);   // 自动 new MysqlOrderRepo + PDO
```

## 30 行手写一个容器

```php
class Container {
    private array $bindings = [];

    public function bind(string $abstract, string|callable $concrete): void {
        $this->bindings[$abstract] = $concrete;
    }

    public function make(string $abstract): object {
        $concrete = $this->bindings[$abstract] ?? $abstract;
        if (is_callable($concrete)) return $concrete($this);

        $ref = new ReflectionClass($concrete);
        $ctor = $ref->getConstructor();
        if (!$ctor) return new $concrete();

        $args = [];
        foreach ($ctor->getParameters() as $p) {
            $type = $p->getType();
            if ($type && !$type->isBuiltin()) {
                $args[] = $this->make($type->getName());   // 递归注入
            }
        }
        return $ref->newInstanceArgs($args);
    }
}

// 用法
$c = new Container();
$c->bind(OrderRepo::class, MysqlOrderRepo::class);
$svc = $c->make(OrderService::class);
```

Laravel / Symfony 的容器本质就是这套，加了**单例、上下文绑定、循环依赖检测、属性注入**等增强。

## PSR-11 容器接口标准

PHP-FIG 制定的 [PSR-11](https://www.php-fig.org/psr/psr-11/) 规范了容器的最小接口，让组件可以在不同框架间无缝切换：

```php
namespace Psr\Container;

interface ContainerInterface {
    public function get(string $id);          // 找不到抛 NotFoundExceptionInterface
    public function has(string $id): bool;    // 判断是否能解析
}

interface NotFoundExceptionInterface extends ContainerExceptionInterface {}
interface ContainerExceptionInterface extends \Throwable {}
```

**实际意义**：你写的类只要依赖 `Psr\Container\ContainerInterface`，就能在 Laravel、Symfony、Slim 等任何兼容 PSR-11 的框架中运行。

```php
// 遵循 PSR-11 的服务类
class ReportGenerator {
    public function __construct(private ContainerInterface $container) {}

    public function generate(): void {
        // 通过标准接口获取依赖，不绑定具体框架
        $template = $this->container->get('report.template');
        // ...
    }
}
```

> **注意**：直接依赖容器本身已经是 Service Locator 模式的变体。应优先使用构造器注入，仅在需要**动态解析**（如根据运行时字符串获取服务）时才注入容器。

# 五、DI vs Service Locator

很多人混淆两者：

```php
// DI（推荐）：依赖在构造器里声明
class OrderService {
    public function __construct(private OrderRepo $repo) {}
}

// Service Locator（反模式）：依赖藏在内部
class OrderService {
    public function process() {
        $repo = ServiceLocator::get(OrderRepo::class);   // ❌
    }
}
```

Service Locator 把依赖隐藏到方法内部，**等于没做 DI**。

**Service Locator 的具体危害：**

1. **依赖不透明** —— 看构造器完全不知道类依赖什么，必须通读全部源码
2. **编译期无法检查** —— 写错一个类名，只有运行到那行代码才会报错
3. **紧耦合容器** —— 换框架就要改所有 `ServiceLocator::get()` 调用
4. **Mock 困难** —— 测试时必须配置全局容器，无法简单传入 mock

```php
// ❌ Service Locator：依赖藏在内部，测试噩梦
class OrderService {
    public function __construct(private ContainerInterface $container) {}

    public function placeOrder(Order $order): int {
        $repo    = $this->container->get(OrderRepo::class);      // 隐藏依赖 #1
        $payment = $this->container->get(PaymentGateway::class); // 隐藏依赖 #2
        $mailer  = $this->container->get(Mailer::class);         // 隐藏依赖 #3
        // ...业务逻辑
    }
}

// ✅ DI：依赖一目了然，测试简单
class OrderService {
    public function __construct(
        private OrderRepo $repo,
        private PaymentGateway $payment,
        private Mailer $mailer,
    ) {}

    public function placeOrder(Order $order): int {
        // 直接使用 $this->repo、$this->payment、$this->mailer
        // ...业务逻辑
    }
}
```

# 六、什么时候**不用** DI

- 极小脚本 / 一次性工具
- 全是静态工具函数（无状态）
- 性能极致敏感的热路径（容器有反射开销，但生产环境一般已编译/缓存掉）

# 七、Laravel 容器实战

Laravel 的容器是整个框架的基石。以下是常用 API：

```php
// 基本绑定
app()->bind(OrderRepo::class, MysqlOrderRepo::class);
$repo = app()->make(OrderRepo::class);   // 每次返回新实例

// 单例绑定 —— 整个请求周期只创建一次
app()->singleton(CacheManager::class, function ($app) {
    return new CacheManager($app['config']['cache']);
});
$cache = app(CacheManager::class);       // app() 是 make() 的简写

// 实例绑定 —— 直接塞现成对象
app()->instance('app.version', '1.0.0');

// 上下文绑定 —— 同一接口，不同场景走不同实现
app()->when(OrderController::class)
      ->needs(OrderRepo::class)
      ->give(MysqlOrderRepo::class);

app()->when(AdminOrderController::class)
      ->needs(OrderRepo::class)
      ->give(RedisOrderRepo::class);

// 标签绑定 —— 批量注册，批量解析
app()->tag([MysqlOrderRepo::class, RedisOrderRepo::class], 'repos');
$repos = app()->tagged('repos');
```

## 自动解析（Automatic Resolution）

即使不手动 `bind`，Laravel 也能通过反射自动解析**具体类**：

```php
class OrderService {
    public function __construct(
        private MysqlOrderRepo $repo,  // 具体类，不需要 bind
        private Mailer $mailer,        // 具体类，自动解析
    ) {}
}

// 不需要任何 bind，直接 make
$svc = app(OrderService::class);
// Laravel 自动：new OrderService(new MysqlOrderRepo(...), new Mailer(...))
```

**自动解析的前提**：构造器参数必须有类型提示，且类型是具体类（非接口）。对于接口，必须显式 `bind`。

## 容器绑定实战：ServiceProvider

在真实 Laravel 项目中，绑定通常放在 `ServiceProvider` 中：

```php
// app/Providers/RepositoryServiceProvider.php
class RepositoryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 接口 → 实现绑定
        $this->app->bind(OrderRepo::class, function ($app) {
            return new MysqlOrderRepo(
                $app->make('db.connection'),  // 从容器获取数据库连接
                $app->make('config')->get('database.orders_table')
            );
        });

        // 单例：配置类整个请求周期只解析一次
        $this->app->singleton(AppConfig::class, function () {
            return new AppConfig(config('app'));
        });

        // 上下文绑定：同一接口在不同控制器走不同实现
        $this->app->when(ApiOrderController::class)
                  ->needs(OrderRepo::class)
                  ->give(fn ($app) => new RedisOrderRepo($app->make('redis')));

        $this->app->when(WebOrderController::class)
                  ->needs(OrderRepo::class)
                  ->give(MysqlOrderRepo::class);
    }
}
```

## 上下文绑定详解（Contextual Binding）

当同一个接口在不同地方需要不同实现时，上下文绑定是最佳方案：

```php
interface Logger {
    public function log(string $message): void;
}

class FileLogger implements Logger { /* 写文件 */ }
class SlackLogger implements Logger { /* 发 Slack */ }

class OrderService {
    public function __construct(private Logger $logger) {}  // 用 FileLogger
}

class PaymentService {
    public function __construct(private Logger $logger) {}  // 用 SlackLogger
}

// 在 ServiceProvider 中配置
app()->when(OrderService::class)
      ->needs(Logger::class)
      ->give(FileLogger::class);

app()->when(PaymentService::class)
      ->needs(Logger::class)
      ->give(SlackLogger::class);
```

# 八、Symfony 容器 vs Laravel 容器

| 特性 | Laravel 容器 | Symfony 容器 |
|------|-------------|-------------|
| 配置方式 | PHP 代码 (`bind`/`singleton`) | YAML / XML / PHP 注解 |
| 编译阶段 | 无（运行时反射） | 有（预编译为 PHP 类） |
| 自动装配 | 通过反射自动解析类型提示 | `autowiring: true`，编译期解析 |
| 性能 | 开发快，生产需缓存配置 | 编译后零反射开销 |
| 上下文绑定 | `when()->needs()->give()` | `AutowireLocator` + TaggedIterator |
| 循环依赖 | 运行时报错 | 编译期检测并报错 |

# 九、自动装配（Autowiring）原理

自动装配的核心思想：**通过反射读取构造器的类型提示，自动递归解析所有依赖。**

```
容器解析 OrderService
  → 发现构造器需要 OrderRepo 类型
    → 查找 OrderRepo 的绑定
      → 如果是接口，取绑定实现；如果是具体类，直接 new
        → 递归解析该实现的构造器依赖...
```

这就是第四节手写容器中 `ReflectionClass` 所做的事。生产环境中框架会将解析结果缓存，避免每次请求都做反射。

**注意**：如果构造器参数没有类型提示（如 `string`、`int`），容器无法自动装配，必须手动提供：

```php
app()->when(OrderService::class)
      ->needs('$tableName')
      ->give('orders');
```

# 十、循环依赖检测与解决

当 A 依赖 B、B 又依赖 A 时，递归解析会无限循环：

```php
class ServiceA {
    public function __construct(private ServiceB $b) {}
}
class ServiceB {
    public function __construct(private ServiceA $a) {}
}
// $container->make(ServiceA::class);  // 💥 无限递归
```

**解决方案：**

1. **提取共同依赖到第三个类**（推荐）
2. **使用 Setter 注入打破循环**
3. **使用 Lazy Proxy**：Laravel 9+ 的 `defer` / Symfony 的 ProxyManager

# 十一、DI 在 PHPUnit 测试中的实战

## 可测试 vs 不可测试的服务

先看一个**不可测试**的例子——没有 DI：

```php
// ❌ 不可测试：硬编码依赖，无法 mock
class OrderService {
    private MysqlOrderRepo $repo;
    private SmtpMailer $mailer;

    public function __construct() {
        $this->repo  = new MysqlOrderRepo(new PDO('mysql:host=localhost;dbname=shop', 'root', ''));
        $this->mailer = new SmtpMailer('smtp.gmail.com', 587, 'user', 'pass');
    }

    public function placeOrder(Order $order): int {
        $id = $this->repo->save($order);
        $this->mailer->send($order->email, 'Order Confirmed', "Order #{$id}");
        return $id;
    }
}

// 测试？—— 必须连真实数据库和 SMTP 服务器 😱
```

对比**可测试**的版本——使用 DI：

```php
// ✅ 可测试：依赖通过构造器注入
class OrderService {
    public function __construct(
        private OrderRepo $repo,    // 接口类型
        private Mailer $mailer,     // 接口类型
    ) {}

    public function placeOrder(Order $order): int {
        $id = $this->repo->save($order);
        $this->mailer->send($order->email, 'Order Confirmed', "Order #{$id}");
        return $id;
    }
}
```

测试时轻松注入 mock，不碰任何外部设施：

```php
use PHPUnit\Framework\TestCase;

class OrderServiceTest extends TestCase
{
    public function testCreateOrder(): void
    {
        // 1. 用 Mock 替代真实数据库
        $mockRepo = $this->createMock(OrderRepo::class);
        $mockRepo->expects($this->once())
                 ->method('save')
                 ->with($this->isInstanceOf(Order::class))
                 ->willReturn(42);

        // 2. 注入 mock 到被测类
        $service = new OrderService($mockRepo);

        // 3. 执行业务逻辑
        $orderId = $service->placeOrder(new Order(...));

        // 4. 断言
        $this->assertEquals(42, $orderId);
    }
}
```

这就是 DI 最核心的收益——**不依赖任何基础设施就能写出可靠的单元测试。**

# 十二、踩坑案例：构造器注入过多

当你写出这样的代码时，说明类的职责太多了：

```php
class OrderService {
    public function __construct(
        private OrderRepo $repo,
        private PaymentGateway $payment,
        private Mailer $mailer,
        private Logger $logger,
        private Cache $cache,
        private EventDispatcher $events,  // 第 6 个！
    ) {}
}
```

**经验法则：超过 5 个构造器依赖，就应该考虑拆分。**

**解决方案：**

1. **Extract Class** —— 把通知逻辑抽到 `OrderNotifier`，把事件分发抽到 `OrderEventPublisher`
2. **引入 Facade / 领域服务** —— 让一个小类只关心一件事
3. **使用 DTO 聚合参数** —— 如果多个参数相关，用一个值对象打包

好的设计：

```php
class OrderService {
    public function __construct(
        private OrderRepo $repo,
        private OrderPaymentProcessor $payment,
        private OrderNotifier $notifier,
    ) {}
}
```

# 十三、常见 DI 陷阱

## 陷阱一：循环依赖

当 A 依赖 B、B 又依赖 A 时，容器递归解析会无限循环：

```php
class UserService {
    public function __construct(private NotificationService $notifier) {}
}

class NotificationService {
    public function __construct(private UserService $userSvc) {}  // 💥 循环！
}
```

**解决方法**：

| 方案 | 做法 | 适用场景 |
|------|------|---------|
| 提取第三个类 | 把公共逻辑抽到 `UserNotifier` | 推荐，从设计层面消除循环 |
| Setter 注入 | `NotificationService` 改用 setter 接收 `UserService` | 快速修复，但降低可测试性 |
| Lazy Proxy | 用 `ProxyManager` 生成代理对象，延迟解析 | Symfony 原生支持 |

## 陷阱二：隐式 Service Locator

注入容器看似方便，实则回到了 Service Locator 模式：

```php
// ❌ 看似 DI，实则是 Service Locator
class ReportService {
    public function __construct(private Application $app) {}  // 注入了整个容器

    public function generate(): void {
        // 依赖全部隐藏在方法内部
        $db    = $this->app->make(Database::class);
        $cache = $this->app->make(Cache::class);
        $pdf   = $this->app->make(PdfRenderer::class);
    }
}

// ✅ 正确做法：明确声明所有依赖
class ReportService {
    public function __construct(
        private Database $db,
        private Cache $cache,
        private PdfRenderer $pdf,
    ) {}

    public function generate(): void {
        // 所有依赖一目了然
    }
}
```

## 陷阱三：过度抽象

不是所有类都需要接口。如果你只有一个实现，且短期内不会替换，直接注入具体类即可：

```php
// ❌ 过度抽象：只有一个实现的接口毫无意义
interface DateTimeFormatterInterface {
    public function format(DateTime $dt): string;
}
class DateTimeFormatter implements DateTimeFormatterInterface { /* ... */ }

// ✅ 直接注入具体类
class ReportService {
    public function __construct(private DateTimeFormatter $formatter) {}
}
```

> **何时该抽象**：当存在多种实现（MySQL/Redis/Fake）、需要测试替换、或遵循框架约定时。

# 参考

- Martin Fowler, *Inversion of Control Containers and the Dependency Injection pattern*: <https://martinfowler.com/articles/injection.html>
- PHP-FIG PSR-11 Container Interface: <https://www.php-fig.org/psr/psr-11/>

# 相关阅读

- [面向对象编程](/posts/php/oop)
- [设计模式](/posts/php/design-patterns)
- [PHP 生命周期](/posts/php/lifecycle)
- [instanceof 与 method_exists](/posts/php/instanceofmethod-exists)
