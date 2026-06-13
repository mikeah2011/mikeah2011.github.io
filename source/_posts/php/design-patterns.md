---

title: PHP 常见设计模式：单例、工厂、策略、观察者实战
keywords: [PHP, 常见设计模式, 单例, 工厂, 策略, 观察者实战]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- 设计模式
- Laravel
- 架构
- SOLID
categories:
- php
date: 2021-03-20 15:05:07
description: 本文系统讲解 PHP 设计模式，涵盖单例模式、工厂模式、观察者模式、策略模式、装饰器模式等核心设计模式的原理与代码实现，并结合 Laravel 框架实际应用案例，帮助开发者掌握设计模式选型策略。内容包含创建型、结构型、行为型三大分类详解与 SOLID 原则实践指导，适合 PHP 中高级开发者提升架构设计能力。
---




设计模式是面向对象软件设计中经过反复验证的解决方案模板。掌握设计模式不仅能提升代码的可维护性和扩展性，更是从"能用"走向"优雅"的必经之路。本文将结合 PHP 语言特性与 Laravel 框架实践，系统讲解最常用的设计模式。

## 设计模式分类总览

| 分类 | 包含模式 | 核心目标 |
| :---: | :--- | :--- |
| **创建型** | 单例、工厂、抽象工厂、建造者、原型 | 将对象的创建与使用分离 |
| **结构型** | 适配器、装饰器、代理、外观、组合、桥接 | 组合类或对象以获得更大的结构 |
| **行为型** | 观察者、策略、模板方法、责任链、状态、命令 | 定义对象间的通信与职责分配 |

## 单例模式（Singleton）

**核心思想**：保证一个类仅有一个实例，并提供一个全局访问点。常用于数据库连接、配置管理、日志记录等场景。

```php
<?php

declare(strict_types=1);

class Database
{
    private static ?Database $instance = null;
    private \PDO $connection;

    // 私有构造函数，禁止外部 new
    private function __construct()
    {
        $this->connection = new \PDO(
            'mysql:host=localhost;dbname=myapp',
            'root',
            'password',
            [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]
        );
    }

    // 禁止克隆
    private function __clone() {}

    // 禁止反序列化
    public function __wakeup()
    {
        throw new \RuntimeException('Cannot unserialize singleton');
    }

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getConnection(): \PDO
    {
        return $this->connection;
    }
}

// 使用
$db = Database::getInstance();
$db2 = Database::getInstance();
var_dump($db === $db2); // true，始终是同一个实例
```

**注意**：在 PHP-FPM 模式下，每次请求都是独立进程，单例仅在单次请求内有效。但在 Swoole/OpenSwoole 常驻内存环境下，单例会跨请求共享，需特别注意连接池和状态清理。

## 工厂模式（Factory）

**核心思想**：将对象的创建逻辑封装到专门的工厂类中，使调用方无需知道具体的实例化细节。

### 简单工厂

```php
<?php

interface PaymentMethod
{
    public function pay(float $amount): bool;
}

class Alipay implements PaymentMethod
{
    public function pay(float $amount): bool
    {
        echo "支付宝支付 {$amount} 元\n";
        return true;
    }
}

class WechatPay implements PaymentMethod
{
    public function pay(float $amount): bool
    {
        echo "微信支付 {$amount} 元\n";
        return true;
    }
}

class PaymentFactory
{
    public static function create(string $type): PaymentMethod
    {
        return match ($type) {
            'alipay' => new Alipay(),
            'wechat' => new WechatPay(),
            default => throw new \InvalidArgumentException("不支持的支付方式: {$type}"),
        };
    }
}

// 使用
$payment = PaymentFactory::create('alipay');
$payment->pay(99.9);
```

### 工厂方法模式

当产品种类较多时，可以定义一个工厂接口，让每个子工厂负责创建一种产品：

```php
<?php

interface LoggerFactory
{
    public function createLogger(): LoggerInterface;
}

class FileLoggerFactory implements LoggerFactory
{
    public function createLogger(): LoggerInterface
    {
        return new FileLogger('/var/log/app.log');
    }
}

class RedisLoggerFactory implements LoggerFactory
{
    public function createLogger(): LoggerInterface
    {
        return new RedisLogger('tcp://127.0.0.1:6379');
    }
}
```

## 观察者模式（Observer）

**核心思想**：定义对象间的一对多依赖关系，当一个对象状态改变时，所有依赖它的对象都会自动收到通知并更新。在 Laravel 中，这直接对应 **事件/监听器（Event/Listener）** 机制。

```php
<?php

declare(strict_types=1);

// 事件基类
class EventEmitter
{
    private array $listeners = [];

    public function on(string $event, callable $callback): void
    {
        $this->listeners[$event][] = $callback;
    }

    public function emit(string $event, mixed $data = null): void
    {
        foreach ($this->listeners[$event] ?? [] as $callback) {
            $callback($data);
        }
    }
}

// 订单类 - 被观察者
class Order extends EventEmitter
{
    public function complete(): void
    {
        // 订单完成的业务逻辑...
        echo "订单已完成\n";

        // 通知所有观察者
        $this->emit('order.completed', $this);
    }
}

// 使用
$order = new Order();

// 注册多个观察者
$order->on('order.completed', function ($order) {
    echo "📧 发送订单完成邮件\n";
});

$order->on('order.completed', function ($order) {
    echo "📊 更新统计数据\n";
});

$order->on('order.completed', function ($order) {
    echo "🎁 发放积分奖励\n";
});

$order->complete();
// 输出：
// 订单已完成
// 📧 发送订单完成邮件
// 📊 更新统计数据
// 🎁 发放积分奖励
```

## 策略模式（Strategy）

**核心思想**：定义一系列算法，将每个算法封装起来，使它们可以相互替换。策略模式让算法的变化独立于使用算法的客户端。

```php
<?php

declare(strict_types=1);

// 策略接口
interface DiscountStrategy
{
    public function calculate(float $price): float;
}

// 无折扣
class NoDiscount implements DiscountStrategy
{
    public function calculate(float $price): float
    {
        return $price;
    }
}

// VIP 8 折
class VipDiscount implements DiscountStrategy
{
    public function calculate(float $price): float
    {
        return $price * 0.8;
    }
}

// 满减策略
class FullReductionDiscount implements DiscountStrategy
{
    public function __construct(
        private float $threshold = 200,
        private float $reduction = 30,
    ) {}

    public function calculate(float $price): float
    {
        if ($price >= $this->threshold) {
            return $price - $this->reduction;
        }
        return $price;
    }
}

// 上下文类
class PriceCalculator
{
    public function __construct(private DiscountStrategy $strategy) {}

    public function setStrategy(DiscountStrategy $strategy): void
    {
        $this->strategy = $strategy;
    }

    public function getFinalPrice(float $price): float
    {
        return $this->strategy->calculate($price);
    }
}

// 使用
$calculator = new PriceCalculator(new NoDiscount());
echo $calculator->getFinalPrice(300) . "\n"; // 300

$calculator->setStrategy(new VipDiscount());
echo $calculator->getFinalPrice(300) . "\n"; // 240

$calculator->setStrategy(new FullReductionDiscount(200, 50));
echo $calculator->getFinalPrice(300) . "\n"; // 250
```

## 装饰器模式（Decorator）

**核心思想**：动态地给对象添加额外职责，比继承更灵活。装饰器模式在不修改原始类的情况下扩展功能。

```php
<?php

declare(strict_types=1);

// 基础接口
interface Notifier
{
    public function send(string $message): void;
}

// 基础实现 - 短信通知
class SmsNotifier implements Notifier
{
    public function send(string $message): void
    {
        echo "📱 短信: {$message}\n";
    }
}

// 装饰器基类
abstract class NotifierDecorator implements Notifier
{
    public function __construct(protected Notifier $notifier) {}

    public function send(string $message): void
    {
        $this->notifier->send($message);
    }
}

// 日志装饰器
class LoggingDecorator extends NotifierDecorator
{
    public function send(string $message): void
    {
        echo "[LOG] 发送通知前记录日志\n";
        parent::send($message);
        echo "[LOG] 发送通知后记录日志\n";
    }
}

// 加密装饰器
class EncryptionDecorator extends NotifierDecorator
{
    public function send(string $message): void
    {
        $encrypted = base64_encode($message);
        echo "🔒 加密消息: {$encrypted}\n";
        parent::send($encrypted);
    }
}

// 使用 - 组合多个装饰器
$notifier = new LoggingDecorator(
    new EncryptionDecorator(
        new SmsNotifier()
    )
);
$notifier->send('你好，这是一条测试消息');
// 输出：
// [LOG] 发送通知前记录日志
// 🔒 加密消息: 5L2g5aW977yM6L+Z5piv5LiA5p2h5rWL6K+V5raI5oGv
// 📱 短信: 5L2g5aW977yM6L+Z5piv5LiA5p2h5rWL6K+V5raI5oGv
// [LOG] 发送通知后记录日志
```

## Laravel 框架中的设计模式实践

Laravel 框架大量运用了设计模式，理解这些模式有助于更好地使用框架。

### 服务容器 — 单例 + 工厂 + 依赖注入

```php
// 绑定单例
$this->app->singleton(DeploymentService::class, function ($app) {
    return new DeploymentService(
        $app->make(GitClient::class),
        $app->make(DockerClient::class),
    );
});

// 自动解析（工厂 + DI）
public function __construct(private DeploymentService $service) {}
```

### 事件系统 — 观察者模式

```php
// 定义事件
class OrderShipped
{
    public function __construct(public Order $order) {}
}

// 注册监听器
protected $listen = [
    OrderShipped::class => [
        SendShipmentNotification::class,
        UpdateInventoryStock::class,
        NotifyWarehouse::class,
    ],
];

// 触发事件
event(new OrderShipped($order));
```

### 中间件 — 装饰器/责任链模式

```php
// 每个中间件都装饰了核心请求处理
// 一层套一层，类似装饰器模式
Route::middleware(['auth', 'throttle:60,1', 'log'])->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index']);
});
```

### 策略 — 策略模式

```php
// 定义策略
class PostPolicy
{
    public function update(User $user, Post $post): bool
    {
        return $user->id === $post->user_id;
    }
}

// 使用策略
if ($user->can('update', $post)) {
    // 允许更新
}
```

### Facade — 代理/外观模式

```php
// Facade 提供静态接口访问容器中的实例
Cache::put('key', 'value', 600);
// 实际调用 app('cache')->put('key', 'value', 600)
```

## 设计模式选型指南

| 场景 | 推荐模式 | 说明 |
| :--- | :--- | :--- |
| 全局只需要一个实例 | 单例模式 | 配置管理、连接池、日志器 |
| 创建逻辑复杂或需解耦 | 工厂模式 | 支付方式、日志驱动、缓存驱动 |
| 一个动作触发多个后续操作 | 观察者模式 | 订单事件、用户注册后通知 |
| 同一接口多种算法实现 | 策略模式 | 折扣计算、排序算法、税率规则 |
| 不修改原类增加功能 | 装饰器模式 | 日志、缓存、权限检查的叠加 |
| 调用链层层处理 | 责任链模式 | 中间件、审批流程、验证器 |
| 不兼容接口间的适配 | 适配器模式 | 第三方 SDK 集成、协议转换 |
| 复杂对象分步构建 | 建造者模式 | SQL 查询构建器、HTTP 请求构造 |

## SOLID 原则与设计模式的关系

设计模式是 SOLID 原则的具体实践：

- **S（单一职责）** → 每个类只负责一件事，策略模式、工厂模式都是典型体现
- **O（开闭原则）** → 装饰器模式、观察者模式让扩展无需修改已有代码
- **L（里氏替换）** → 工厂模式和策略模式依赖接口编程，子类可替换父类
- **I（接口隔离）** → 小而精的接口，避免胖接口
- **D（依赖倒置）** → 依赖注入容器（Laravel Service Container）的理论基础

## 总结

设计模式不是银弹，关键是理解问题场景后选择合适的模式。在 PHP/Laravel 生态中，框架已经帮你实践了大量模式，理解这些模式的原理能让你写出更优雅、更易维护的代码。建议从单例、工厂、观察者这三个最常用的模式开始，在项目中逐步实践。

## 相关阅读

- [Laravel 设计模式实战：Inbox/Outbox 模式](/2025/01/01/php/Laravel/laravel-design-patternsguide-inbox-outbox/) — 深入了解 Laravel 中的 Inbox/Outbox 架构模式
- [Laravel 服务容器与依赖注入指南](/2025/01/01/php/Laravel/service-container-guide-dependency-injection/) — 理解 Laravel IoC 容器的底层实现
- [Laravel 事件/监听器架构详解](/2025/01/01/php/Laravel/laravel-event-listener-architecture/) — 观察者模式在 Laravel 中的完整实践
