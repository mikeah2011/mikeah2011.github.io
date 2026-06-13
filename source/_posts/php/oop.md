---

title: OOP - 面向对象
keywords: [OOP, 面向对象]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Laravel
- PHP
categories:
- php
date: 2021-03-20 15:05:07
description: 深入解析 PHP 面向对象编程的三大特性封装、继承和多态，系统讲解 SOLID 五大设计原则并配合完整代码示例。涵盖抽象类与接口的详细对比分析，策略模式、工厂模式、观察者模式三大常用设计模式的 PHP 实现。介绍 PHP 8.x 枚举、只读属性、命名参数、匹配表达式等新特性在面向对象中的实际应用，以及 Laravel 框架项目中常见的贫血模型、上帝控制器、过度依赖门面等反模式与重构技巧，帮助开发者写出高质量可维护的面向对象代码。
---




# 一句话

> **OOP = 把"数据"和"操作数据的方法"封装到一起，再用继承/多态在不改旧代码的前提下扩展新行为。**

它的对立面是「面向过程」（数据是数据，函数是函数）和「函数式」（数据不可变，靠函数组合）。三种范式各有适用场景，**OOP 不是唯一正解**。

面向对象编程的核心思想来自模拟现实世界中的实体和它们之间的关系。比如一个"用户"对象包含姓名、邮箱等属性，同时拥有注册、登录、修改密码等行为。这种把数据和行为绑定在一起的方式，让我们能够更好地组织和管理复杂的代码结构。

在 PHP 的发展历程中，面向对象的支持从 PHP 5 开始趋于成熟，经过 PHP 7 的性能大幅提升，再到 PHP 8 引入了枚举、联合类型、命名参数、只读属性等现代特性，PHP 的面向对象能力已经完全可以胜任大型企业级应用的开发需求。理解 OOP 的本质和正确使用方法，是写出可维护、可扩展代码的基础。

# 三大特性

## 1. 封装（Encapsulation）

把内部状态藏起来，只暴露必要接口。封装是面向对象最基础也是最重要的原则，它通过访问修饰符（`public`、`protected`、`private`）控制属性和方法的可见性，确保对象内部状态不会被外部随意篡改。

封装的价值在于：第一，隐藏实现细节，调用方只需要知道"做什么"而不需要知道"怎么做"；第二，保证数据一致性，所有对内部状态的修改都必须经过验证逻辑；第三，降低耦合度，内部实现可以自由更改而不影响外部调用代码。

```php
class BankAccount {
    private int $balance = 0;   // 外面碰不到

    public function deposit(int $amount): void {
        if ($amount <= 0) throw new InvalidArgumentException();
        $this->balance += $amount;
    }
    public function balance(): int { return $this->balance; }
}
```

**为什么有用**：调用方不需要知道余额怎么存的；以后改成数据库/Redis，外面零改动。

封装还能防止非法状态。想象一个 `Order` 类，如果没有封装，外部代码可以直接把状态从 `pending` 改成 `completed`，跳过支付流程：

```php
// 反模式：public 属性导致任意修改
class BadOrder {
    public string $status = 'pending';
    public int $total = 0;
}
$order = new BadOrder();
$order->status = 'completed';  // 没付款就完成了？！

// 正确做法：通过方法控制状态流转
class Order {
    private string $status = 'pending';
    private int $total;

    public function __construct(int $total) {
        if ($total <= 0) throw new InvalidArgumentException('订单金额必须大于 0');
        $this->total = $total;
    }

    public function complete(PaymentService $payment): void {
        if ($this->status !== 'pending') {
            throw new LogicException('只有待处理订单才能完成');
        }
        $payment->charge($this->total);
        $this->status = 'completed';
    }

    public function status(): string { return $this->status; }
}
```

## 2. 继承（Inheritance）

子类自动获得父类的属性和方法。继承是代码复用的重要手段，通过 `extends` 关键字，子类可以继承父类的所有公开和受保护的成员，并在此基础上扩展新的功能。

继承在实际项目中的典型应用包括：定义通用的基础控制器、创建共享行为的模型基类、实现模板方法模式等。但需要注意的是，继承建立了父子类之间的强耦合关系，父类的任何修改都可能影响到所有子类的行为，这就是所谓的"脆弱基类问题"。

```php
class Animal {
    public function eat(): string { return 'eating'; }
}
class Dog extends Animal {
    public function bark(): string { return 'woof'; }
}
(new Dog())->eat();   // 'eating'
```

**坑**：继承是强耦合，父类改一行可能炸所有子类。**「优先组合，不要继承」** 是设计模式的第一条铁律。

继承超过 2 层基本都是设计问题。看看这个经典的继承噩梦：

```php
// 反模式：继承层次过深
class Base {}
class UserBase extends Base {}
class AdminUserBase extends UserBase {}
class SuperAdminUserBase extends AdminUserBase {}
// 任何一层改动，下面全部受牵连

// 正确做法：用组合 + Trait
class User {
    use HasRoles;
    use HasPermissions;
    use Notifiable;
}
trait HasRoles {
    public function assignRole(string $role): void { /* ... */ }
    public function hasRole(string $role): bool { /* ... */ return true; }
}
```

## 3. 多态（Polymorphism）

**同一个调用，不同的实现**。多态是面向对象编程中最强大的特性之一，它允许我们用统一的接口处理不同的实现，从而实现真正的"对扩展开放、对修改关闭"。

PHP 中实现多态的方式主要有两种：一种是通过接口定义契约，不同的类实现相同的接口提供不同的行为；另一种是通过继承和方法重写，子类覆盖父类的方法来改变行为。在实际开发中，接口驱动的多态更为常用，因为它避免了继承带来的强耦合问题。

多态的典型应用场景包括：支付方式的切换（支付宝、微信、银联）、日志输出方式的选择（文件、数据库、云服务）、通知渠道的扩展（邮件、短信、推送）等。每当我们需要在不修改调用方代码的前提下扩展新的实现时，就是多态发挥作用的时候。

```php
interface Payment {
    public function pay(int $amount): bool;
}
class Alipay   implements Payment { public function pay(int $a): bool { /*...*/ return true; } }
class WeChatPay implements Payment { public function pay(int $a): bool { /*...*/ return true; } }

function checkout(Payment $p, int $amount): void {
    $p->pay($amount);   // 不关心具体是哪种支付
}
```

**这是 OOP 最值钱的部分**：扩展新支付方式，`checkout()` 一个字都不用改。

# SOLID 五大原则

SOLID 是由 Robert C. Martin（Bob 大叔）提出的面向对象设计五大原则的首字母缩写。这五条原则的目标是让代码更容易理解、更容易维护、更容易扩展。在实际项目中，严格遵守每一条 SOLID 原则可能会导致过度工程化，但理解并有意识地运用这些原则，可以显著提升代码质量。

| 字母 | 名字 | 一句话 | 反例 |
|---|---|---|---|
| **S** | Single Responsibility | 一个类只做一件事 | `User` 类同时管理"用户数据 + 发邮件 + 存数据库" |
| **O** | Open / Closed | 对扩展开放，对修改关闭 | 加个新支付方式就要改 `checkout()` 的 if-else |
| **L** | Liskov Substitution | 子类必须能替换父类不出错 | `Square extends Rectangle` 改 width 同时改 height，违反父类语义 |
| **I** | Interface Segregation | 接口要小，不要逼实现类用不到的方法 | `IBird` 里塞 `fly()`，企鹅类被迫抛异常 |
| **D** | Dependency Inversion | 依赖抽象（接口），不依赖具体类 | 控制器直接 `new MysqlUserRepo()`，测试和切库都地狱 |

## S — 单一职责：代码示例

单一职责原则要求一个类只有一个引起它变化的原因。简单来说，一个类只应该负责一件事情。这样做的好处是当需求变化时，我们只需要修改一个地方，不会波及其他功能。在实际项目中，违反单一职责最常见的表现就是一个类同时处理业务逻辑、数据持久化和消息通知，导致修改任何一个功能都要冒着影响其他功能的风险。

```php
// 反模式：一个类干三件事
class UserService {
    public function register(array $data): User {
        $user = new User($data);
        DB::table('users')->insert($data);       // 职责1：持久化
        Mail::to($user->email)->send(new WelcomeMail()); // 职责2：通知
        Log::info("User registered: {$user->email}");     // 职责3：日志
        return $user;
    }
}

// 重构：每个类只管一件事
class UserRepository {
    public function save(User $user): void {
        DB::table('users')->insert($user->toArray());
    }
}
class WelcomeNotifier {
    public function notify(User $user): void {
        Mail::to($user->email)->send(new WelcomeMail());
    }
}
class RegistrationService {
    public function __construct(
        private UserRepository $repo,
        private WelcomeNotifier $notifier,
    ) {}
    public function register(array $data): User {
        $user = new User($data);
        $this->repo->save($user);
        $this->notifier->notify($user);
        return $user;
    }
}
```

## O — 开闭原则：用策略替代 if-else

开闭原则的核心思想是：软件实体应该对扩展开放、对修改关闭。当我们需要添加新功能时，应该通过编写新代码来实现，而不是修改已有的代码。在实践中，最常见的违反开闭原则的场景就是大量的 if-else 或 switch-case 分支判断。每新增一种类型就要修改判断逻辑，随着类型越来越多，代码会变得越来越脆弱。解决办法通常是引入策略模式或工厂模式，让新增类型只需要添加新类而不需要改动已有代码。

```php
// 反模式：每加一种运费计算就要改这个方法
class ShippingCostCalculator {
    public function calculate(string $type, float $weight): float {
        if ($type === 'express') return $weight * 15;
        if ($type === 'standard') return $weight * 5;
        if ($type === 'free') return 0;
        throw new InvalidArgumentException("Unknown: $type");
    }
}

// 开闭：新增策略不动旧代码
interface ShippingStrategy {
    public function cost(float $weight): float;
}
class ExpressShipping implements ShippingStrategy {
    public function cost(float $w): float { return $w * 15; }
}
class StandardShipping implements ShippingStrategy {
    public function cost(float $w): float { return $w * 5; }
}
class FreeShipping implements ShippingStrategy {
    public function cost(float $w): float { return 0; }
}
// 新加"经济航运"只需新增一个 EconomicShipping 类，原有代码零修改
```

## L — 里氏替换：经典违反案例

里氏替换原则要求所有子类都必须能够替换其父类而不影响程序的正确性。换句话说，如果一段代码依赖于某个父类，那么传入任何子类的实例，程序都应该正常工作。违反这个原则的典型场景是子类改变了父类的行为契约，比如父类的方法不会抛异常，但子类重写后却抛出了异常，或者子类对输入参数有更严格的限制。最经典的例子就是正方形继承长方形的问题。

```php
// 反模式：Square 改变了 Rectangle 的行为契约
class Rectangle {
    protected int $width;
    protected int $height;
    public function setWidth(int $w): void  { $this->width = $w; }
    public function setHeight(int $h): void { $this->height = $h; }
    public function area(): int { return $this->width * $this->height; }
}
class Square extends Rectangle {
    public function setWidth(int $w): void  { $this->width = $w; $this->height = $w; }
    public function setHeight(int $h): void { $this->width = $h; $this->height = $h; }
}
// 测试失败：期望 area = 50，实际 area = 25
$r = new Square();
$r->setWidth(10);
$r->setHeight(5);
assert($r->area() === 50); // 💥 25

// 正确方案：用独立的 Shape 接口
interface Shape {
    public function area(): int;
}
class Rectangle implements Shape {
    public function __construct(private int $w, private int $h) {}
    public function area(): int { return $this->w * $this->h; }
}
class Square implements Shape {
    public function __construct(private int $side) {}
    public function area(): int { return $this->side ** 2; }
}
```

## I — 接口隔离

接口隔离原则强调不应该强迫一个类依赖它不需要的接口。在设计接口时，我们应该保持接口小而专一，让实现类只需要关心自己真正需要的方法。如果一个大接口里包含了多个不相关的方法，那么实现类就不得不实现一些它根本用不到的方法，这不仅增加了代码量，还增加了维护负担。正确做法是将大接口拆分为多个小接口，让每个类只实现它真正需要的接口。

```php
// 反模式：一个大接口，逼企鹅实现 fly()
interface Bird {
    public function eat(): void;
    public function fly(): void;
    public function swim(): void;
}
class Penguin implements Bird {
    public function eat(): void { /* OK */ }
    public function fly(): void { throw new Exception('企鹅不会飞！'); } // 💥
    public function swim(): void { /* OK */ }
}

// 正确：拆成小接口
interface Eatable { public function eat(): void; }
interface Flyable { public function fly(): void; }
interface Swimmable { public function swim(): void; }

class Penguin implements Eatable, Swimmable {
    public function eat(): void { /* ... */ }
    public function swim(): void { /* ... */ }
}
```

## D — 依赖反转

依赖反转原则包含两层含义：第一，高层模块不应该依赖低层模块，两者都应该依赖抽象；第二，抽象不应该依赖细节，细节应该依赖抽象。在实际应用中，这意味着我们不应该在控制器或业务逻辑类中直接 `new` 一个具体的数据库操作类，而是应该依赖一个接口，通过构造函数注入具体实现。这样做的好处是显而易见的：测试时可以用 Mock 对象替代真实数据库，切换存储引擎时只需要提供新的实现类，业务逻辑完全不需要改动。

```php
// 反模式：控制器直接依赖具体实现
class UserController {
    public function show(int $id): JsonResponse {
        $repo = new MysqlUserRepo();  // 写死了 MySQL
        $user = $repo->find($id);
        return response()->json($user);
    }
}

// 正确：依赖接口，容器注入
class UserController {
    public function __construct(private UserRepo $repo) {}
    public function show(int $id): JsonResponse {
        return response()->json($this->repo->find($id));
    }
}
// 测试时注入 MockUserRepo，生产注入 MysqlUserRepo，切换零成本
```

## 一个 SOLID 友好的例子

下面这个例子综合运用了 SOLID 五项原则：通过接口定义用户仓库契约（依赖反转），每个实现类只做一件特定的事（单一职责），新增缓存实现不需要修改服务层代码（开闭原则），子类实现可以替换接口而不影响调用方（里氏替换），接口只定义了查询方法不会强迫实现不需要的操作（接口隔离）。

```php
// D: 依赖抽象
interface UserRepo {
    public function find(int $id): ?User;
}

// S: 只做"用 MySQL 查用户"这一件事
class MysqlUserRepo implements UserRepo {
    public function __construct(private PDO $db) {}
    public function find(int $id): ?User { /* SQL */ return null; }
}

// O: 想换 Redis 就再写个 RedisUserRepo，不动 UserService
class UserService {
    public function __construct(private UserRepo $repo) {}
    public function profile(int $id): ?User {
        return $this->repo->find($id);
    }
}
```

# 抽象类 vs 接口：对比

在 PHP 面向对象设计中，抽象类和接口是最常用的两种抽象机制，但它们的适用场景截然不同。简单来说，当你需要定义"是什么"的关系时用抽象类（IS-A），比如"猫是动物"；当你需要定义"能做什么"的能力时用接口（CAN-DO），比如"猫会跳跃"。一个类只能继承一个抽象类，但可以实现多个接口，这使得接口更适合定义跨继承体系的通用能力。在 PHP 8 中，接口也支持定义默认实现和常量，两者的能力差距在逐渐缩小，但语义差异仍然重要。

| 特性 | 抽象类（Abstract Class） | 接口（Interface） |
|---|---|---|
| 实例化 | ❌ 不能直接 `new` | ❌ 不能直接 `new` |
| 方法实现 | ✅ 可以有具体方法 | ❌（PHP 8 前），✅ PHP 8 起可以有默认实现 |
| 属性 | ✅ 可以有普通属性 | ❌ 只能有常量（const） |
| 构造函数 | ✅ 有 | ❌ 没有 |
| 继承数量 | 单继承（只能 extends 一个） | 多实现（可以 implements 多个） |
| 访问修饰符 | ✅ 任意 | 默认 public，PHP 8 可以是 protected |
| 设计语义 | "是什么"（IS-A） | "能做什么"（CAN-DO） |
| 典型场景 | 多个子类共享部分实现 | 定义跨继承体系的能力契约 |

```php
// 抽象类：共享"骨架"逻辑
abstract class Report {
    abstract protected function query(): array;

    // 抽象类提供公共的"骨架"方法
    public function generate(): string {
        $data = $this->query();
        return $this->format($data);
    }

    protected function format(array $data): string {
        return json_encode($data, JSON_PRETTY_PRINT);
    }
}

class SalesReport extends Report {
    protected function query(): array {
        return ['sales' => 10000]; // 查数据库
    }
}

// 接口：定义能力契约，不关心"怎么实现"
interface Exportable {
    public function toCsv(): string;
    public function toPdf(): string;
}

class SalesReport extends Report implements Exportable {
    protected function query(): array { return []; }
    public function toCsv(): string { return 'csv...'; }
    public function toPdf(): string { return 'pdf...'; }
}
```

# 常用设计模式：OOP 实战利器

设计模式是面向对象设计中经过反复验证的最佳实践方案。GoF（四人帮）将 23 种经典设计模式分为三大类：创建型模式关注对象的创建方式，结构型模式关注类和对象的组合方式，行为型模式关注对象之间的通信方式。在日常 PHP 开发中，最常用的是策略模式、工厂模式和观察者模式，它们分别解决了算法切换、对象创建和事件通知的常见问题。

## 策略模式（Strategy）

运行时切换算法，消灭 if-else 地狱。策略模式将一系列算法封装成独立的类，使得它们可以互相替换。在电商项目中，不同的会员等级对应不同的折扣策略；在支付系统中，不同的支付渠道对应不同的扣款逻辑；在物流系统中，不同的配送方式对应不同的运费计算规则。这些场景都适合用策略模式来消除条件分支。策略模式的核心是定义一个策略接口，让具体的策略类实现该接口，客户端通过构造函数或配置来决定使用哪种策略。

```php
interface DiscountStrategy {
    public function apply(float $amount): float;
}

class NoDiscount implements DiscountStrategy {
    public function apply(float $amount): float { return $amount; }
}

class PercentageDiscount implements DiscountStrategy {
    public function __construct(private float $percent) {}
    public function apply(float $amount): float {
        return $amount * (1 - $this->percent / 100);
    }
}

class FixedDiscount implements DiscountStrategy {
    public function __construct(private float $fixed) {}
    public function apply(float $amount): float {
        return max(0, $amount - $this->fixed);
    }
}

class OrderPricer {
    public function __construct(private DiscountStrategy $discount) {}
    public function total(float $amount): float {
        return $this->discount->apply($amount);
    }
}

// 使用：客户端决定策略，OrderPricer 完全不关心
$pricer = new OrderPricer(new PercentageDiscount(10));
echo $pricer->total(200); // 180
```

## 工厂模式（Factory）

把对象创建逻辑集中管理，客户端不需要知道具体类名。工厂模式的核心价值在于将对象的创建和使用分离。在实际项目中，对象的创建可能涉及复杂的配置读取、依赖解析和参数校验，这些逻辑不应该散落在业务代码中。通过工厂类，我们把创建逻辑集中管理，客户端只需要告诉工厂"我要什么"，而不需要知道"怎么造"。工厂模式在 Laravel 中随处可见，比如 `Auth::guard()` 根据配置返回不同的认证守卫实例，`Storage::disk()` 根据配置返回不同的文件存储实例，底层都用了工厂模式。

```php
class NotificationFactory {
    public static function create(string $type): Notifiable {
        return match ($type) {
            'email' => new EmailNotification(),
            'sms'   => new SmsNotification(),
            'push'  => new PushNotification(),
            default => throw new InvalidArgumentException("不支持的通知类型: $type"),
        };
    }
}

interface Notifiable {
    public function send(string $to, string $message): bool;
}

class EmailNotification implements Notifiable {
    public function send(string $to, string $msg): bool {
        // 发邮件
        return true;
    }
}
class SmsNotification implements Notifiable {
    public function send(string $to, string $msg): bool { return true; }
}
class PushNotification implements Notifiable {
    public function send(string $to, string $msg): bool { return true; }
}

// 使用
$notifier = NotificationFactory::create('sms');
$notifier->send('+8613800000000', '您的验证码是 1234');
```

## 观察者模式（Observer）

事件驱动解耦，一个动作触发多个处理逻辑。观察者模式定义了一种一对多的依赖关系，当被观察对象的状态发生改变时，所有依赖于它的观察者都会收到通知并自动更新。在 Laravel 框架中，事件系统就是观察者模式的典型应用，通过 `Event::listen()` 注册监听器，当事件触发时所有监听器依次执行。订单支付完成后，可能需要同时扣减库存、生成发票、发送邮件通知、记录日志，这些操作彼此独立，适合用观察者模式解耦。每个观察者只关心自己需要处理的逻辑，新增或移除某个观察者不会影响其他部分。

```php
class OrderEvent {
    public function __construct(
        public readonly int $orderId,
        public readonly string $status,
        public readonly float $amount,
    ) {}
}

interface OrderObserver {
    public function handle(OrderEvent $event): void;
}

class InventoryObserver implements OrderObserver {
    public function handle(OrderEvent $event): void {
        echo "扣减库存，订单 #{$event->orderId}\n";
    }
}

class InvoiceObserver implements OrderObserver {
    public function handle(OrderEvent $event): void {
        echo "生成发票，订单 #{$event->orderId}\n";
    }
}

class NotificationObserver implements OrderObserver {
    public function handle(OrderEvent $event): void {
        echo "发送通知，订单 #{$event->orderId}\n";
    }
}

class OrderEventDispatcher {
    private array $observers = [];

    public function subscribe(OrderObserver $observer): void {
        $this->observers[] = $observer;
    }

    public function dispatch(OrderEvent $event): void {
        foreach ($this->observers as $observer) {
            $observer->handle($event);
        }
    }
}

// 使用
$dispatcher = new OrderEventDispatcher();
$dispatcher->subscribe(new InventoryObserver());
$dispatcher->subscribe(new InvoiceObserver());
$dispatcher->subscribe(new NotificationObserver());
$dispatcher->dispatch(new OrderEvent(orderId: 1001, status: 'paid', amount: 299.0));
```

# PHP 8.x OOP 新特性

PHP 8 系列的发布标志着 PHP 语言现代化的重大飞跃。从 8.0 的命名参数和联合类型，到 8.1 的枚举和只读属性，再到 8.2 的只读类和独立类型，每一次更新都让 PHP 的面向对象能力更加强大。这些新特性不仅让代码更简洁、更安全，还让 PHP 开发者能够写出更接近其他现代语言风格的代码。下面重点介绍几个对面向对象编程影响最大的新特性。

## 枚举（PHP 8.1）

用枚举替代魔术字符串，编译期就报错。在 PHP 8.1 之前，我们通常用类常量或魔术字符串来表示有限的状态集合，比如订单状态、支付方式等。这种方式的问题是缺乏类型约束，传错一个字符串值不会有任何编译期错误，只能在运行时才发现问题。PHP 8.1 的原生枚举完美解决了这个问题，它是一个独立的类型，支持标量底层类型（`string` 或 `int`），可以定义方法，还可以用 `match` 表达式进行模式匹配，让状态机的实现更加优雅和安全。

```php
enum OrderStatus: string {
    case Pending    = 'pending';
    case Paid       = 'paid';
    case Shipped    = 'shipped';
    case Completed  = 'completed';
    case Cancelled  = 'cancelled';
}

class Order {
    public function __construct(
        public OrderStatus $status = OrderStatus::Pending,
    ) {}

    public function pay(): void {
        if ($this->status !== OrderStatus::Pending) {
            throw new LogicException('只有待付款订单才能支付');
        }
        $this->status = OrderStatus::Paid;
    }
}

// 类型安全，传错值编译器直接报错
$order = new Order();
$order->pay();
echo $order->status->value; // 'paid'
```

## readonly 属性（PHP 8.1）

只读属性只能在构造函数中赋值一次，天然保证不可变。在面向对象设计中，值对象（Value Object）是一个非常重要的概念，它表示一个不可变的值，比如金额、坐标、时间段等。在没有 `readonly` 之前，我们需要手动将属性设为 `private` 并提供 getter 方法来防止外部修改，代码冗余且容易遗漏。`readonly` 属性让值对象的实现变得简洁优雅，构造完成后属性就自动不可变，编译器会在运行时阻止任何修改尝试。这对于并发环境下的数据安全尤为重要。

```php
class Money {
    public function __construct(
        public readonly int $amount,
        public readonly string $currency = 'CNY',
    ) {}
}

$m = new Money(1000);
$m->amount = 2000; // 💥 Fatal Error: Cannot modify readonly property
```

## readonly 类（PHP 8.2）

整个类的所有属性都是 `readonly`，适合值对象。PHP 8.2 引入了 `readonly` 修饰符用于整个类，相当于把类中所有属性都标记为 `readonly`。这对于值对象（如坐标、金额、时间范围）和数据传输对象（DTO）特别有用，只需要一个关键字就能确保整个类的不可变性。需要注意的是，`readonly` 类的所有属性必须在构造函数中初始化，且不能有静态属性。如果某个属性确实需要可变，就不要用 `readonly` 类，而是单独标记属性。

```php
readonly class Coordinates {
    public function __construct(
        public float $lat,
        public float $lng,
    ) {}
}

$pos = new Coordinates(39.9042, 116.4074);
echo $pos->lat; // 39.9042
$pos->lat = 0;  // 💥 Fatal Error
```

## 命名参数（PHP 8.0）

调用时按参数名传值，跳过中间有默认值的参数。命名参数是 PHP 8.0 引入的一项重要特性，它允许调用函数时按参数名而非位置来传递参数值。这对于有多个默认参数的函数特别有用，以前想要跳过中间的默认参数而指定后面的参数，必须把中间的参数也传一遍，现在可以直接用命名参数跳过。命名参数还能显著提高代码的可读性，特别是当参数含义不明显时，比如 `createUser('John', 25, true)` 就不如 `createUser(name: 'John', age: 25, active: true)` 直观。

```php
class Logger {
    public function log(
        string $message,
        string $level = 'info',
        bool $toFile = false,
        ?string $channel = null,
    ): void {
        echo "[$level] $message (channel: $channel)\n";
    }
}

$logger = new Logger();
// 以前要这样：
$logger->log('订单创建', 'info', false, 'order');
// 现在可以直接跳过 toFile：
$logger->log('订单创建', level: 'info', channel: 'order');
```

## match 表达式（PHP 8.0）

替代冗长的 `switch`，支持严格类型比较并返回值。`match` 表达式是 PHP 8.0 中最常用的控制流改进之一，它使用严格比较（`===`）而非松散比较（`==`），并支持返回值，可以直接用在赋值语句中。相比 `switch`，`match` 更简洁、更安全，不需要 `break` 语句防止穿透，也不会因为类型松散比较而产生意外结果。在面向对象编程中，`match` 特别适合与枚举配合使用，实现类型安全的状态机和策略选择。

```php
function statusCodeMessage(int $code): string {
    return match (true) {
        $code >= 200 && $code < 300 => '成功',
        $code >= 300 && $code < 400 => '重定向',
        $code >= 400 && $code < 500 => '客户端错误',
        $code >= 500                => '服务器错误',
        default                     => '未知',
    };
}
```

## 构造器属性提升（PHP 8.0）

构造函数参数直接声明为属性，减少样板代码。在 PHP 8.0 之前，定义一个类的属性需要三步：声明属性、写构造函数参数、在构造函数中赋值。构造器属性提升将这三步合并为一步，直接在构造函数参数前加上访问修饰符，PHP 会自动将其提升为类属性并赋值。这项特性在依赖注入场景中特别有用，因为依赖注入的类通常有大量构造函数参数需要存储为属性。

```php
// 以前要写一堆 $this->xxx = $xxx
class UserServiceOld {
    private UserRepository $repo;
    private Mailer $mailer;
    public function __construct(UserRepository $repo, Mailer $mailer) {
        $this->repo = $repo;
        $this->mailer = $mailer;
    }
}

// PHP 8：一行搞定
class UserService {
    public function __construct(
        private UserRepository $repo,
        private Mailer $mailer,
    ) {}
}
```

# Laravel 中常见的 OOP 反模式

Laravel 是 PHP 生态中最流行的框架，它的优雅语法和强大功能让开发效率大幅提升，但也容易让开发者忽视面向对象设计的基本原则。由于 Laravel 提供了大量的便利方法和门面模式，很多初学者会写出高度耦合、难以测试的代码。下面列出 Laravel 项目中最常见的四个面向对象反模式，以及相应的重构方案。这些问题在中小型项目中尤为普遍，随着项目规模增长会逐渐暴露其弊端。

## 1. 贫血模型（Anemic Model）

贫血模型是 Martin Fowler 提出的一个概念，指的是模型对象只有数据（属性和 getter/setter），没有业务行为，所有的业务逻辑都堆积在服务层或控制器中。在 Laravel 项目中，很多开发者习惯把 Eloquent Model 当作纯数据容器，所有的业务判断和状态变更都写在 Controller 或 Service 里，导致 Model 层毫无存在感。正确的做法是让 Model 承载与自身状态相关的业务逻辑，比如订单的支付、退款、取消等状态变更操作都应该定义在 Order 模型中，这样代码更内聚、更易测试、更符合面向对象的设计思想。

```php
// 反模式：Model 只有属性没有业务逻辑，Controller 里全是过程式代码
class Order extends Model {
    protected $fillable = ['status', 'total', 'user_id'];
}

class OrderController {
    public function pay(Order $order) {
        $order->status = 'paid';           // 业务逻辑泄漏到控制器
        $order->paid_at = now();
        $order->save();
        Mail::to($order->user)->send(new OrderPaidMail($order));
        Log::info("Order paid: {$order->id}");
    }
}

// 正确：Model 承载业务行为
class Order extends Model {
    public function markAsPaid(): void {
        $this->update(['status' => 'paid', 'paid_at' => now()]);
        OrderPaid::dispatch($this);  // 事件驱动解耦通知
    }
}
```

## 2. God Controller

控制器超过 500 行、同时处理路由、验证、业务逻辑、响应格式化。这是 Laravel 新手项目中最常见的问题之一，由于 Artisan 命令生成的控制器骨架太方便了，很多人把所有的代码都堆到控制器里，导致一个控制器动辄上千行。按照单一职责原则，控制器只应该负责接收请求、调用业务逻辑、返回响应这三件事。参数验证应该用 FormRequest，业务逻辑应该抽到 Service 类，数据格式化应该用 API Resource。这样每个类都小而专注，修改某个功能只需要改对应的类，不用在巨石控制器里大海捞针。

```php
// 反模式
class ProductController {
    public function store(Request $request) {
        // 20 行验证
        // 30 行业务逻辑
        // 10 行文件上传
        // 15 行发送通知
        // 5 行返回响应
    }
}

// 正确：拆分为 FormRequest + Service + Resource
class StoreProductRequest extends FormRequest {
    public function rules(): array { return ['name' => 'required|max:255']; }
}
class ProductService {
    public function create(array $data): Product { return Product::create($data); }
}
class ProductController {
    public function __construct(private ProductService $service) {}
    public function store(StoreProductRequest $request): ProductResource {
        return new ProductResource($this->service->create($request->validated()));
    }
}
```

## 3. 滥用 Facade 导致难以测试

```php
// 反模式：直接调用 Facade，单元测试无法 mock
class ReportService {
    public function generate(): void {
        $data = DB::table('orders')->get();       // 直接依赖 DB Facade
        Cache::put('report', $data, 3600);         // 直接依赖 Cache Facade
    }
}

// 正确：依赖注入
class ReportService {
    public function __construct(
        private ConnectionInterface $db,
        private CacheInterface $cache,
    ) {}
    public function generate(): void {
        $data = $this->db->table('orders')->get();
        $this->cache->put('report', $data, 3600);
    }
}
```

## 4. 巨大的 Eloquent Scope

```php
// 反模式：scope 嵌套 10 层条件
public function scopeAdvancedFilter($query, array $filters) {
    if ($filters['status'] ?? null) $query->where('status', $filters['status']);
    if ($filters['min_price'] ?? null) $query->where('price', '>=', $filters['min_price']);
    if ($filters['max_price'] ?? null) $query->where('price', '<=', $filters['max_price']);
    if ($filters['category'] ?? null) $query->where('category', $filters['category']);
    // 还有 15 个 if...
}

// 正确：每个条件一个 scope，组合使用
class Product extends Model {
    public function scopeStatus(Builder $q, string $s): void { $q->where('status', $s); }
    public function scopePriceBetween(Builder $q, float $min, float $max): void {
        $q->whereBetween('price', [$min, $max]);
    }
}
// 调用
Product::status('active')->priceBetween(10, 100)->get();
```

# 什么时候**不要**用 OOP

- **简单脚本** / 一次性数据处理 → 函数式或过程式更轻
- **数据为主、行为很少** → 用 DTO / struct / record 即可，硬塞 method 反而麻烦
- **领域天然函数式**（管道、流处理、纯计算）→ FP 更合适

# 常见误区

1. **类越多越 OOP** —— 错。一堆只有 getter/setter 的"贫血模型"和过程式没区别。
2. **继承越深越显设计能力** —— 错。继承超过 2 层基本都是问题信号。
3. **设计模式必须用** —— 模式是事后总结，不是事前框框。先写出能跑的代码，重复 3 次再考虑抽象。
4. **接口越多越解耦** —— 错。如果只有一个实现，接口是过度设计。
5. **new 是毒药** —— "不要 new 对象"只适用于需要替换的依赖，值对象和简单 DTO 直接 new 没问题。

# 相关阅读

- [常见的设计模式](/categories/PHP/design-patterns/) — 单例、工厂、观察者、装饰器等 23 种模式的 PHP 实现
- [接口与抽象类](/categories/PHP/vs-interfaceabstract/) — 接口与抽象类的深入对比与选型指南
- [PHP 垃圾回收机制（GC）](/categories/PHP/gc/) — 引用计数、循环引用收集与内存泄漏排查
- [Laravel Service Container 实战：依赖注入](/categories/PHP/service-container-guide-dependency-injection/) — DI 容器的原理与 Laravel 绑定技巧
- [Laravel Event-Listener 事件驱动架构](/categories/PHP/laravel-event-listener-architecture/) — 用事件解耦订单处理，真实踩坑记录

# 参考

- Robert C. Martin, *Clean Architecture*（SOLID 出处）
- 《设计模式》GoF — 23 个模式分创建/结构/行为三大类
- PHP The Right Way: <https://phptherightway.com/>
