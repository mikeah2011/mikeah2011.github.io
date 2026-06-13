---

title: PHP 接口 vs 抽象类：面向对象设计的选型决策
keywords: [PHP, 接口, 抽象类, 面向对象设计的选型决策]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- 面向对象
- 设计模式
- SOLID
categories:
  - php
date: 2021-03-20 15:05:07
description: 深入解析PHP接口与抽象类的区别、使用场景及最佳实践。涵盖接口与抽象类的定义、SOLID原则、Laravel实战案例、PHP 8+新特性、PHPUnit测试技巧及常见反模式，帮助开发者在面向对象设计中做出正确的架构决策。
---




在PHP面向对象编程中，**接口（Interface）** 和 **抽象类（Abstract Class）** 是两个核心概念。它们都用于定义契约、实现多态，但适用场景截然不同。很多PHP初学者甚至有一定经验的开发者，在面对"该用接口还是抽象类"这个问题时，仍然会感到困惑。本文将从概念定义、代码示例、设计原则、实战案例等多个维度，深入剖析二者的异同与最佳实践，帮助你在实际项目中做出正确的架构决策。

<!-- more -->

---

## 一、接口（Interface）深度解析

### 1.1 什么是接口

接口是一种纯粹的**契约定义**，它规定了实现类必须具备哪些方法，但不提供任何实现细节。可以将接口理解为一份"合同"——任何签字（implements）的类都必须履行合同中的全部条款。

在面向对象设计中，接口的核心价值在于**解耦**。通过接口，我们可以将"做什么"与"怎么做"分离开来。调用方只需要知道对方能做什么（接口定义），而不需要关心对方具体怎么做的（实现细节）。这正是依赖倒置原则的核心思想。

接口的核心特征：

- **所有方法默认为 `public abstract`**（PHP 8 之前不能有方法体）
- **不能包含属性**（只能定义常量，且常量默认为 `public const`）
- **一个类可以实现多个接口**，这是接口最灵活的特性
- **接口可以继承接口**（支持多继承，一个接口可以 extends 多个接口）
- PHP 8.0 起，接口可以包含带默认实现的方法，使得在不破坏现有实现的前提下扩展接口成为可能
- 接口中的方法不能声明为 `private` 或 `protected`，始终是 `public`

### 1.2 接口基础语法

```php
<?php

/**
 * 支付接口 - 定义所有支付方式必须实现的方法
 * 任何支付渠道（支付宝、微信、银行卡等）都需要实现此接口
 */
interface PaymentInterface
{
    // 接口常量（隐式 public const）
    const MAX_RETRY = 3;
    const STATUS_SUCCESS = 'success';
    const STATUS_FAILED = 'failed';

    /**
     * 发起支付
     * @param float $amount 支付金额，单位为元
     * @param array $meta   额外参数，如商品信息、用户标识等
     * @return PaymentResult 支付结果对象
     */
    public function charge(float $amount, array $meta = []): PaymentResult;

    /**
     * 退款操作
     * @param string $transactionId 原始交易ID
     * @return bool 退款是否成功
     */
    public function refund(string $transactionId): bool;

    /**
     * 查询交易状态
     * @param string $transactionId 交易ID
     * @return string 交易状态常量
     */
    public function getStatus(string $transactionId): string;
}
```

在上面的例子中，我们定义了一个支付接口。这个接口不关心具体的支付渠道是什么，它只是规定了所有支付方式都必须具备三个核心能力：发起支付、退款、查询状态。任何类只要实现了这个接口，就必须提供这三个方法的具体实现。

### 1.3 多接口实现

一个类可以同时实现多个接口，这是接口相对于抽象类最大的优势之一。在PHP中，一个类只能继承一个抽象类（单继承），但可以实现任意数量的接口。这使得接口成为定义多维度行为的理想选择：

```php
<?php

/**
 * 可记录日志的接口
 * 任何需要被记录到日志系统的对象都应该实现此接口
 */
interface LoggableInterface
{
    /**
     * 将对象转换为日志友好的数组格式
     * 用于日志记录时自动序列化对象信息
     */
    public function toLogArray(): array;
}

/**
 * 可序列化的接口
 * 任何需要支持序列化/反序列化的对象都应实现此接口
 */
interface SerializableInterface
{
    public function serialize(): string;
    public function unserialize(string $data): static;
}

/**
 * 可缓存的接口
 * 任何需要被缓存系统管理的对象都应该实现此接口
 */
interface CacheableInterface
{
    /**
     * 获取缓存键名
     * 返回该对象在缓存系统中的唯一标识
     */
    public function getCacheKey(): string;

    /**
     * 获取缓存过期时间（秒）
     * 不同对象可能需要不同的缓存策略
     */
    public function getCacheTTL(): int;
}

/**
 * 订单类同时实现三个接口
 * 遵循接口隔离原则——每个接口只关注一个维度的行为
 * Order 既是可日志记录的，又是可序列化的，还是可缓存的
 */
class Order implements LoggableInterface, SerializableInterface, CacheableInterface
{
    public function __construct(
        private string $id,
        private float $amount,
        private string $status
    ) {}

    // 实现 LoggableInterface
    public function toLogArray(): array
    {
        return [
            'order_id' => $this->id,
            'amount' => $this->amount,
            'status' => $this->status,
            'logged_at' => date('Y-m-d H:i:s'),
        ];
    }

    // 实现 SerializableInterface
    public function serialize(): string
    {
        return json_encode([
            'id' => $this->id,
            'amount' => $this->amount,
            'status' => $this->status,
        ]);
    }

    public function unserialize(string $data): static
    {
        $decoded = json_decode($data, true);
        return new static($decoded['id'], $decoded['amount'], $decoded['status']);
    }

    // 实现 CacheableInterface
    public function getCacheKey(): string
    {
        return "order:{$this->id}";
    }

    public function getCacheTTL(): int
    {
        return 3600; // 订单缓存1小时
    }
}
```

通过多接口实现，`Order` 类获得了三种不同的行为能力，而这三种能力是通过三个独立的接口定义的，互不干扰。当我们将来需要给订单增加"可搜索"能力时，只需要再实现一个 `SearchableInterface` 即可，完全不影响现有代码。

### 1.4 接口继承接口

接口之间可以使用 `extends` 形成层级关系，而且一个接口可以同时继承多个接口：

```php
<?php

/**
 * 可读取文件的接口
 */
interface ReadableInterface
{
    public function read(string $path): string;
}

/**
 * 可写入文件的接口
 */
interface WritableInterface
{
    public function write(string $path, string $content): bool;
}

/**
 * FileSystemInterface 同时继承读和写能力
 * 形成一个更完整的文件系统接口
 */
interface FileSystemInterface extends ReadableInterface, WritableInterface
{
    public function delete(string $path): bool;
    public function exists(string $path): bool;
}

/**
 * 本地文件系统实现
 * 必须实现 FileSystemInterface 及其父接口中的所有方法
 */
class LocalFileSystem implements FileSystemInterface
{
    public function read(string $path): string
    {
        if (!$this->exists($path)) {
            throw new RuntimeException("File not found: {$path}");
        }
        return file_get_contents($path);
    }

    public function write(string $path, string $content): bool
    {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        return file_put_contents($path, $content) !== false;
    }

    public function delete(string $path): bool
    {
        if (!$this->exists($path)) {
            return true;
        }
        return unlink($path);
    }

    public function exists(string $path): bool
    {
        return file_exists($path);
    }
}
```

接口继承的好处在于，我们可以灵活地组合不同粒度的接口。如果一个函数只需要"读取"能力，它就可以只依赖 `ReadableInterface`；如果需要完整的文件系统能力，则依赖 `FileSystemInterface`。这种分层设计体现了接口隔离原则的精髓。

---

## 二、抽象类（Abstract Class）深度解析

### 2.1 什么是抽象类

抽象类是一种**不完整的类**，它既可以包含已实现的方法，也可以包含未实现的抽象方法。抽象类用于定义一个**模板/骨架**，子类通过继承来填充具体实现。

与接口不同，抽象类强调的是**代码复用**和**模板定义**。它适合用于多个相关子类之间共享通用逻辑的场景。抽象类中的抽象方法强制子类必须实现特定的步骤，而已经实现的方法则提供了可复用的公共逻辑。

抽象类的核心特征：

- **可以包含具体实现的方法**——子类直接继承使用
- **可以包含抽象方法**——子类必须实现这些方法，否则编译报错
- **可以定义成员变量（属性）**——这是与接口的关键区别之一
- **只能被单继承**——PHP 不支持多继承
- **构造函数可以是 protected 或 public**——控制实例化方式
- **可以定义 private、protected、public 任意修饰符的方法**
- **不能被直接实例化**——必须通过子类继承后才能使用

### 2.2 抽象类基础语法

```php
<?php

/**
 * 通知抽象类 - 提供通知发送的通用骨架
 * 所有通知类型（邮件、短信、推送等）都继承此抽象类
 */
abstract class AbstractNotification
{
    // 具体属性——子类共享这些状态
    protected string $recipient;
    protected string $message;
    protected array $attachments = [];
    protected DateTimeImmutable $createdAt;

    public function __construct(string $recipient, string $message)
    {
        $this->recipient = $recipient;
        $this->message = $message;
        $this->createdAt = new DateTimeImmutable();
    }

    /**
     * 抽象方法：子类必须实现具体发送逻辑
     * 每种通知渠道的发送方式不同，所以留给子类去实现
     */
    abstract protected function doSend(): bool;

    /**
     * 具体方法：定义发送的模板流程（模板方法模式）
     * 这是整个发送过程的骨架，子类不应该覆盖这个方法
     */
    final public function send(): bool
    {
        $this->validate();       // 步骤1：验证
        $this->beforeSend();     // 步骤2：发送前处理
        $result = $this->doSend(); // 步骤3：实际发送（子类实现）
        $this->afterSend($result); // 步骤4：发送后处理
        return $result;
    }

    /**
     * 具体方法：验证收件人信息
     * 提供默认实现，子类可以覆盖以添加额外验证
     */
    protected function validate(): void
    {
        if (empty($this->recipient)) {
            throw new InvalidArgumentException('收件人不能为空');
        }
    }

    /**
     * 钩子方法：发送前的准备工作
     * 默认为空实现，子类可以选择性覆盖
     */
    protected function beforeSend(): void
    {
        // 默认空实现，子类可覆盖
    }

    /**
     * 钩子方法：发送后的处理逻辑
     * 默认为空实现，子类可以选择性覆盖
     */
    protected function afterSend(bool $success): void
    {
        // 默认空实现，子类可覆盖
    }

    /**
     * 具体方法：添加附件
     * 提供流式接口，所有通知类型都可以使用
     */
    public function attach(string $file): static
    {
        if (!file_exists($file)) {
            throw new InvalidArgumentException("附件不存在: {$file}");
        }
        $this->attachments[] = $file;
        return $this;
    }
}
```

### 2.3 模板方法模式（Template Method Pattern）

抽象类最经典的应用场景是**模板方法模式**——在抽象类中定义算法骨架，将某些步骤延迟到子类中实现。这种模式的核心思想是：固定不变的部分由父类定义，变化的部分由子类决定。

```php
<?php

/**
 * 邮件通知实现
 * 继承 AbstractNotification 并实现 doSend 方法
 */
class EmailNotification extends AbstractNotification
{
    private string $subject;

    public function __construct(string $recipient, string $message, string $subject = '系统通知')
    {
        parent::__construct($recipient, $message);
        $this->subject = $subject;
    }

    /**
     * 实现抽象方法：具体的邮件发送逻辑
     * 这里只关注邮件特有的发送方式
     */
    protected function doSend(): bool
    {
        $headers = "From: noreply@example.com\r\n";
        $headers .= "Content-Type: text/html; charset=UTF-8\r\n";

        return mail($this->recipient, $this->subject, $this->message, $headers);
    }

    /**
     * 覆盖钩子方法：在发送前给邮件主题加上前缀
     */
    protected function beforeSend(): void
    {
        $this->subject = "[{$this->createdAt->format('Y-m-d')}] {$this->subject}";
    }
}

/**
 * 短信通知实现
 * 继承 AbstractNotification 并实现特有的发送和验证逻辑
 */
class SmsNotification extends AbstractNotification
{
    private string $senderId;

    public function __construct(string $recipient, string $message, string $senderId = 'SYSTEM')
    {
        parent::__construct($recipient, $message);
        $this->senderId = $senderId;
    }

    /**
     * 实现抽象方法：具体的短信发送逻辑
     * 调用第三方短信网关API
     */
    protected function doSend(): bool
    {
        // 模拟调用短信API
        $client = new SmsGatewayClient();
        return $client->send(
            to: $this->recipient,
            message: $this->message,
            sender: $this->senderId
        );
    }

    /**
     * 覆盖验证方法：添加手机号格式校验
     * 先调用父类的通用验证，再添加短信特有的验证
     */
    protected function validate(): void
    {
        parent::validate(); // 调用父类的通用验证
        if (!preg_match('/^1[3-9]\d{9}$/', $this->recipient)) {
            throw new InvalidArgumentException("无效的手机号: {$this->recipient}");
        }
    }

    /**
     * 覆盖钩子方法：发送后记录短信发送日志
     */
    protected function afterSend(bool $success): void
    {
        $logData = [
            'recipient' => $this->recipient,
            'sender' => $this->senderId,
            'success' => $success,
            'sent_at' => date('Y-m-d H:i:s'),
        ];
        // 记录到短信发送日志
        logger()->channel('sms')->info('短信发送结果', $logData);
    }
}

/**
 * 推送通知实现
 * 用于移动端推送通知
 */
class PushNotification extends AbstractNotification
{
    private string $deviceToken;
    private string $platform; // ios 或 android

    public function __construct(string $deviceToken, string $message, string $platform = 'ios')
    {
        parent::__construct($deviceToken, $message);
        $this->deviceToken = $deviceToken;
        $this->platform = $platform;
    }

    protected function doSend(): bool
    {
        return match ($this->platform) {
            'ios' => $this->sendToAPNs(),
            'android' => $this->sendToFCM(),
            default => throw new RuntimeException("不支持的推送平台: {$this->platform}"),
        };
    }

    private function sendToAPNs(): bool
    {
        // 调用苹果推送服务
        return true;
    }

    private function sendToFCM(): bool
    {
        // 调用 Firebase Cloud Messaging
        return true;
    }
}
```

通过模板方法模式，我们实现了以下效果：发送通知的通用流程（验证 → 前处理 → 发送 → 后处理）在 `AbstractNotification` 中只定义一次，所有子类都遵循这个流程。子类只需要关心自己特有的发送逻辑，无需重复编写流程控制代码。当我们需要在发送流程中添加一个新步骤（比如"限流检查"），只需要修改抽象类中的 `send` 方法，所有子类自动获得这个新功能。

---

## 三、接口 vs 抽象类：决策树

在实际开发中，如何选择接口还是抽象类？以下是一套实用的决策流程，帮助你快速做出判断：

```
需要定义一个契约/能力？
├── 是 → 多个不相关的类都需要实现这个能力？
│   ├── 是 → 使用【接口】
│   │   （不同体系的类需要共同行为时，接口是最佳选择）
│   └── 否 → 需要共享代码/状态（属性）？
│       ├── 是 → 子类之间有"is-a"关系？
│       │   ├── 是 → 使用【抽象类】
│       │   │   （如：Dog is a Animal，共享通用属性和方法）
│       │   └── 否 → 考虑使用【Trait】
│       │       （如：多个类需要日志能力，但不存在继承关系）
│       └── 否 → 只定义方法签名即可？
│           └── 是 → 使用【接口】
│               （轻量级契约，实现方有最大自由度）
└── 否 → 需要多重继承？
    ├── 是 → 使用【接口】（或 Trait）
    │   （PHP 不支持类的多继承，但支持多接口实现和多 Trait 使用）
    └── 否 → 使用【抽象类】
        （单一继承链中共享代码和模板）
```

**简明原则对照表：**

| 场景 | 推荐方案 | 说明 |
|:---:|:---:|:---|
| 定义能力契约，不关心实现 | **接口** | 只定义"做什么"，不定义"怎么做" |
| 需要多重"继承" | **接口** | 一个类可实现多个接口 |
| 共享代码和状态（属性） | **抽象类** | 接口不能有成员变量 |
| 模板方法模式 | **抽象类** | 定义算法骨架，延迟步骤到子类 |
| 需要构造函数初始化 | **抽象类** | 接口没有构造函数 |
| 跨不同层次的对象共享行为 | **接口** | 如 CacheableInterface，不同类型都可以缓存 |
| 同一继承树下的代码复用 | **抽象类** | 子类共享公共逻辑 |
| 需要在测试中轻松 Mock | **接口** | PHPUnit Mock 接口比 Mock 抽象类更方便 |
| 定义常量组 | **接口** | 接口常量可以被实现类直接访问 |

---

## 四、接口 vs 抽象类 vs Trait：三方对比

在PHP中，除了接口和抽象类，**Trait** 也是实现代码复用的重要机制。三者各有所长，下面从多个维度进行详细对比：

| 区别维度 | 接口（Interface） | 抽象类（Abstract Class） | Trait |
|:---:|:---:|:---:|:---:|
| 定义关键字 | `interface` | `abstract class` | `trait` |
| 引入方式 | `implements` | `extends` | `use` |
| 多重使用 | ✅ 可实现多个 | ❌ 只能继承一个 | ✅ 可 use 多个 |
| 方法实现 | PHP 8.0 起可有默认实现 | ✅ 可有具体方法 | ✅ 可有具体方法 |
| 抽象方法 | ✅（隐式抽象，无需关键字） | ✅（需显式声明 abstract） | ✅（需显式声明 abstract） |
| 属性/状态 | ❌ 只能有常量 | ✅ 可定义成员变量 | ✅ 可定义成员变量 |
| 构造函数 | ❌ 不支持 | ✅ 支持 | ❌ 不推荐 |
| 访问修饰符 | 只能 public | public/protected/private | public/protected/private |
| 主要用途 | 定义契约规范 | 共享代码骨架和模板 | 水平复用行为片段 |
| 语义关系 | 能力关系（can-do） | 继承关系（is-a） | 行为组合（has-behavior） |
| instanceof 检测 | ✅ 支持 | ✅ 支持 | ❌ 不支持 |
| 多态支持 | ✅ 完整支持 | ✅ 完整支持 | ⚠️ 有限支持 |
| 解耦程度 | 最高 | 中等 | 最低 |
| 自动加载 | ✅ 单独文件 | ✅ 单独文件 | ✅ 单独文件 |

### Trait 补充说明

Trait 是PHP 5.4引入的一种代码复用机制，它既不是接口也不是类，而是一种**代码复制粘贴的语法糖**。Trait 中的代码在编译时会被"复制"到使用它的类中，因此它不属于继承体系，也不会影响 `instanceof` 检测。

```php
<?php

// Trait 示例
trait TimestampsTrait
{
    protected ?DateTimeImmutable $createdAt = null;
    protected ?DateTimeImmutable $updatedAt = null;

    public function bootTimestamps(): void
    {
        $this->createdAt = new DateTimeImmutable();
    }

    public function touch(): void
    {
        $this->updatedAt = new DateTimeImmutable();
    }
}

trait SoftDeleteTrait
{
    protected ?DateTimeImmutable $deletedAt = null;

    public function softDelete(): void
    {
        $this->deletedAt = new DateTimeImmutable();
    }

    public function restore(): void
    {
        $this->deletedAt = null;
    }

    public function isTrashed(): bool
    {
        return $this->deletedAt !== null;
    }
}

// 一个类可以同时使用多个 Trait，组合不同的行为片段
class Article
{
    use TimestampsTrait, SoftDeleteTrait;

    public function __construct(
        private string $title,
        private string $content
    ) {
        $this->bootTimestamps(); // 来自 TimestampsTrait
    }
}
```

---

## 五、SOLID 原则与接口/抽象类

SOLID 是面向对象设计的五大原则，其中**接口隔离原则**和**依赖倒置原则**与接口和抽象类的设计密切相关。理解这两个原则，能帮助我们更好地在实际项目中运用接口和抽象类。

### 5.1 接口隔离原则（Interface Segregation Principle, ISP）

> "不应该强迫客户端依赖它们不使用的接口。"

这个原则的核心思想是：接口应该小而精，不应该将不相关的方法放在同一个接口中。当一个接口过于"肥胖"时，实现类被迫实现自己不需要的方法，这会导致代码僵化和不必要的耦合。

**反模式——胖接口（Fat Interface）：**

```php
<?php

// ❌ 错误设计：一个接口包含了太多不相关的方法
interface WorkerInterface
{
    public function work(): void;
    public function eat(): void;
    public function sleep(): void;
    public function attendMeeting(): void;
    public function writeReport(): void;
}

// Robot 需要工作和写报告，但不需要吃东西和睡觉
// 然而由于接口要求，它被迫实现这些无意义的方法
class Robot implements WorkerInterface
{
    public function work(): void
    {
        echo "机器人正在工作\n";
    }

    public function eat(): void
    {
        // ❌ 机器人不需要吃东西！这里只能写空实现或者抛异常
        throw new BadMethodCallException('Robot does not eat');
    }

    public function sleep(): void
    {
        // ❌ 机器人不需要睡觉！
        throw new BadMethodCallException('Robot does not sleep');
    }

    public function attendMeeting(): void
    {
        echo "机器人正在参加会议\n";
    }

    public function writeReport(): void
    {
        echo "机器人正在生成报告\n";
    }
}
```

**正确做法——拆分为小接口：**

```php
<?php

// ✅ 正确设计：每个接口只关注一个职责维度
interface WorkableInterface
{
    public function work(): void;
}

interface FeedableInterface
{
    public function eat(): void;
    public function sleep(): void;
}

interface ReportableInterface
{
    public function writeReport(): void;
}

interface MeetingAttendableInterface
{
    public function attendMeeting(): void;
}

// 人类员工实现了所有接口——因为人类确实需要工作、吃饭、睡觉、开会、写报告
class HumanWorker implements WorkableInterface, FeedableInterface, ReportableInterface, MeetingAttendableInterface
{
    public function work(): void { echo "正在努力工作\n"; }
    public function eat(): void { echo "正在吃午餐\n"; }
    public function sleep(): void { echo "正在休息\n"; }
    public function writeReport(): void { echo "正在撰写报告\n"; }
    public function attendMeeting(): void { echo "正在参加会议\n"; }
}

// 机器人只实现它需要的接口——不再被迫实现不相关的方法
class Robot implements WorkableInterface, ReportableInterface, MeetingAttendableInterface
{
    public function work(): void { echo "机器人24小时不间断工作\n"; }
    public function writeReport(): void { echo "自动生成数据分析报告\n"; }
    public function attendMeeting(): void { echo "机器人通过视频接入会议\n"; }
}
```

通过拆分接口，每个类只依赖它真正需要的接口，代码的耦合度大大降低。当我们修改 `FeedableInterface` 时，`Robot` 类完全不受影响。

### 5.2 依赖倒置原则（Dependency Inversion Principle, DIP）

> "高层模块不应该依赖低层模块，二者都应该依赖于抽象。"
> "抽象不应该依赖于细节，细节应该依赖于抽象。"

依赖倒置原则是实现松耦合架构的关键。它的核心思想是：不要让业务逻辑层（高层）直接依赖数据库、缓存、外部服务等基础设施层（低层），而是通过接口（抽象）来解耦它们。

```php
<?php

// 定义接口——这是"抽象"层
interface UserRepositoryInterface
{
    public function findById(int $id): ?User;
    public function findByEmail(string $email): ?User;
    public function save(User $user): bool;
    public function delete(int $id): bool;
}

// 低层实现1：MySQL 实现
class MysqlUserRepository implements UserRepositoryInterface
{
    public function findById(int $id): ?User
    {
        $row = DB::table('users')->where('id', $id)->first();
        return $row ? User::fromDatabase($row) : null;
    }

    public function findByEmail(string $email): ?User
    {
        $row = DB::table('users')->where('email', $email)->first();
        return $row ? User::fromDatabase($row) : null;
    }

    public function save(User $user): bool
    {
        return DB::table('users')->updateOrInsert(
            ['id' => $user->id],
            $user->toDatabaseArray()
        );
    }

    public function delete(int $id): bool
    {
        return DB::table('users')->where('id', $id)->delete() > 0;
    }
}

// 低层实现2：Redis 缓存实现
class CachedUserRepository implements UserRepositoryInterface
{
    public function __construct(
        private UserRepositoryInterface $inner, // 装饰器模式
        private int $ttl = 3600
    ) {}

    public function findById(int $id): ?User
    {
        $cacheKey = "user:{$id}";
        $cached = Redis::get($cacheKey);

        if ($cached !== null) {
            return User::fromArray(json_decode($cached, true));
        }

        $user = $this->inner->findById($id);
        if ($user) {
            Redis::setex($cacheKey, $this->ttl, json_encode($user->toArray()));
        }
        return $user;
    }

    public function findByEmail(string $email): ?User
    {
        return $this->inner->findByEmail($email);
    }

    public function save(User $user): bool
    {
        $result = $this->inner->save($user);
        if ($result) {
            Redis::del("user:{$user->id}"); // 清除缓存
        }
        return $result;
    }

    public function delete(int $id): bool
    {
        $result = $this->inner->delete($id);
        if ($result) {
            Redis::del("user:{$id}");
        }
        return $result;
    }
}

// 高层模块：UserService 只依赖接口，不关心底层是 MySQL 还是 Redis
class UserService
{
    public function __construct(
        private UserRepositoryInterface $repository  // 依赖抽象，不是具体实现
    ) {}

    public function getUser(int $id): User
    {
        $user = $this->repository->findById($id);
        if (!$user) {
            throw new UserNotFoundException("用户 #{$id} 不存在");
        }
        return $user;
    }

    public function register(string $name, string $email, string $password): User
    {
        // 检查邮箱是否已注册
        if ($this->repository->findByEmail($email)) {
            throw new DuplicateEmailException("邮箱 {$email} 已被注册");
        }

        $user = new User(
            name: $name,
            email: $email,
            password: password_hash($password, PASSWORD_BCRYPT)
        );

        $this->repository->save($user);
        return $user;
    }
}

// 在 ServiceProvider 中配置依赖关系
// 可以轻松切换实现，无需修改 UserService 的任何代码
$app->bind(UserRepositoryInterface::class, function ($app) {
    return new CachedUserRepository(
        new MysqlUserRepository(),
        ttl: config('cache.user_ttl', 3600)
    );
});
```

通过依赖倒置原则，我们实现了以下效果：`UserService`（高层）不直接依赖 `MysqlUserRepository`（低层），而是依赖 `UserRepositoryInterface`（抽象）。当我们需要把数据库从 MySQL 切换到 PostgreSQL，或者增加缓存层时，只需要创建新的实现类并在容器中重新绑定即可，`UserService` 的代码完全不需要修改。同时，在测试中我们可以轻松地用 Mock 对象替换真实实现。

---

## 六、Laravel 实战案例

### 6.1 Repository 模式（基于接口）

Laravel 项目中常用的 Repository 模式，核心就是通过接口解耦业务逻辑和数据访问层。这种模式在大型项目中尤为重要，它使得业务逻辑不直接依赖 Eloquent ORM，方便后续替换数据源或编写测试。

```php
<?php

// 定义接口——业务层依赖的契约
namespace App\Repositories\Contracts;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

interface ArticleRepositoryInterface
{
    public function paginate(int $perPage = 15): LengthAwarePaginator;
    public function findById(int $id): Article;
    public function findBySlug(string $slug): ?Article;
    public function create(array $data): Article;
    public function update(int $id, array $data): Article;
    public function delete(int $id): bool;
    public function findByCategory(string $category): Collection;
    public function search(string $keyword): Collection;
}

// Eloquent 实现——数据访问层的具体实现
namespace App\Repositories;

use App\Models\Article;
use App\Repositories\Contracts\ArticleRepositoryInterface;

class EloquentArticleRepository implements ArticleRepositoryInterface
{
    public function __construct(
        private Article $model
    ) {}

    public function paginate(int $perPage = 15): LengthAwarePaginator
    {
        return $this->model
            ->with(['author', 'category', 'tags'])
            ->latest()
            ->paginate($perPage);
    }

    public function findById(int $id): Article
    {
        return $this->model->with(['author', 'category'])->findOrFail($id);
    }

    public function findBySlug(string $slug): ?Article
    {
        return $this->model->where('slug', $slug)->first();
    }

    public function create(array $data): Article
    {
        return $this->model->create($data);
    }

    public function update(int $id, array $data): Article
    {
        $article = $this->findById($id);
        $article->update($data);
        return $article->refresh();
    }

    public function delete(int $id): bool
    {
        return $this->findById($id)->delete();
    }

    public function findByCategory(string $category): Collection
    {
        return $this->model
            ->whereHas('category', fn($q) => $q->where('slug', $category))
            ->with(['author', 'tags'])
            ->latest()
            ->get();
    }

    public function search(string $keyword): Collection
    {
        return $this->model
            ->where('title', 'LIKE', "%{$keyword}%")
            ->orWhere('content', 'LIKE', "%{$keyword}%")
            ->with(['author'])
            ->limit(20)
            ->get();
    }
}

// 在 AppServiceProvider 中绑定接口到实现
$this->app->bind(
    ArticleRepositoryInterface::class,
    EloquentArticleRepository::class
);

// 控制器中注入接口——控制器不关心具体实现是 Eloquent 还是其他
class ArticleController extends Controller
{
    public function __construct(
        private ArticleRepositoryInterface $articles
    ) {}

    public function index()
    {
        return view('articles.index', [
            'articles' => $this->articles->paginate(),
        ]);
    }

    public function show(string $slug)
    {
        $article = $this->articles->findBySlug($slug);
        abort_unless($article, 404);
        return view('articles.show', compact('article'));
    }

    public function search(Request $request)
    {
        $results = $this->articles->search($request->input('q'));
        return view('articles.search', compact('results'));
    }
}
```

### 6.2 控制器基类（基于抽象类）

Laravel 的 Controller 本身就是抽象类的一个经典应用。我们可以在此基础上，利用抽象类的模板方法模式来定义控制器的通用行为：

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Foundation\Validation\ValidatesRequests;
use Illuminate\Routing\Controller as BaseController;
use Illuminate\Http\JsonResponse;

/**
 * 管理后台控制器基类
 * 利用抽象类定义管理后台控制器的通用骨架
 */
abstract class AdminController extends BaseController
{
    use AuthorizesRequests, ValidatesRequests;

    /**
     * 子类必须定义的权限标识
     * 用于权限中间件自动检测
     */
    protected string $permission;

    /**
     * 子类可选定义的资源名称
     * 用于提示信息、面包屑等
     */
    protected string $resourceName = '记录';

    public function __construct()
    {
        $this->middleware('auth');
        $this->middleware("can:{$this->permission}");
        $this->initialize();
    }

    /**
     * 钩子方法：子类可覆盖的初始化逻辑
     * 在构造函数最后执行，此时中间件已注册
     */
    protected function initialize(): void
    {
        // 默认空实现
    }

    /**
     * 抽象方法：子类必须定义面包屑导航
     * 确保每个管理页面都有统一的导航结构
     */
    abstract protected function breadcrumbs(): array;

    /**
     * 通用的成功响应方法
     * 提供统一的JSON响应格式，所有子类都可以使用
     */
    protected function respondWithSuccess(string $message, mixed $data = null, int $code = 200): JsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => $message,
            'data' => $data,
            'breadcrumbs' => $this->breadcrumbs(),
        ], $code);
    }

    /**
     * 通用的错误响应方法
     */
    protected function respondWithError(string $message, int $code = 400): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $message,
        ], $code);
    }
}

/**
 * 文章管理控制器
 * 继承 AdminController，只需实现抽象方法和定义业务逻辑
 */
class ArticleAdminController extends AdminController
{
    protected string $permission = 'manage-articles';
    protected string $resourceName = '文章';

    protected function breadcrumbs(): array
    {
        return [
            ['label' => '首页', 'url' => '/admin'],
            ['label' => '文章管理', 'url' => '/admin/articles'],
        ];
    }

    protected function initialize(): void
    {
        $this->middleware('throttle:60,1');
    }

    public function index(ArticleRepositoryInterface $repo)
    {
        return $this->respondWithSuccess('获取成功', $repo->paginate());
    }

    public function store(Request $request, ArticleRepositoryInterface $repo)
    {
        $validated = $this->validate($request, [
            'title' => 'required|string|max:255',
            'content' => 'required|string',
            'category_id' => 'required|exists:categories,id',
        ]);

        $article = $repo->create($validated);
        return $this->respondWithSuccess("{$this->resourceName}创建成功", $article, 201);
    }
}
```

---

## 七、接口 + 抽象类组合模式

在复杂项目中，接口与抽象类经常**配合使用**，形成"接口定义契约 → 抽象类提供骨架 → 具体类填充细节"的三层结构。这种组合模式在框架设计和大型应用中非常常见：

```php
<?php

// 第一层：接口定义契约
// 接口只关心"缓存系统应该有哪些能力"
interface CacheDriverInterface
{
    public function get(string $key): mixed;
    public function set(string $key, mixed $value, int $ttl = 3600): bool;
    public function delete(string $key): bool;
    public function flush(): bool;
    public function has(string $key): bool;
}

// 第二层：抽象类提供通用骨架
// 抽象类实现所有驱动共享的通用逻辑（键名规范化、连接管理、模板方法等）
abstract class AbstractCacheDriver implements CacheDriverInterface
{
    protected array $config;
    protected bool $connected = false;
    protected string $prefix;

    public function __construct(array $config)
    {
        $this->config = $config;
        $this->prefix = $config['prefix'] ?? '';
    }

    // 模板方法：统一 get 的流程
    final public function get(string $key): mixed
    {
        $this->ensureConnected();
        $key = $this->normalizeKey($key);
        $value = $this->doGet($key);
        $this->logAccess('get', $key, $value !== null);
        return $value;
    }

    // 模板方法：统一 set 的流程
    final public function set(string $key, mixed $value, int $ttl = 3600): bool
    {
        $this->ensureConnected();
        $key = $this->normalizeKey($key);
        $result = $this->doSet($key, $value, $ttl);
        $this->logAccess('set', $key, $result);
        return $result;
    }

    final public function has(string $key): bool
    {
        return $this->get($key) !== null;
    }

    // 抽象方法：子类必须实现底层存储逻辑
    abstract protected function doGet(string $key): mixed;
    abstract protected function doSet(string $key, mixed $value, int $ttl): bool;
    abstract protected function doConnect(): bool;

    // 通用方法：确保连接已建立
    protected function ensureConnected(): void
    {
        if (!$this->connected) {
            $this->connected = $this->doConnect();
            if (!$this->connected) {
                throw new RuntimeException('缓存驱动连接失败');
            }
        }
    }

    // 通用方法：键名规范化
    protected function normalizeKey(string $key): string
    {
        return $this->prefix ? "{$this->prefix}:{$key}" : $key;
    }

    // 通用方法：访问日志
    protected function logAccess(string $operation, string $key, bool $hit): void
    {
        if ($this->config['debug'] ?? false) {
            logger()->debug("缓存[{$operation}]", ['key' => $key, 'hit' => $hit]);
        }
    }
}

// 第三层：具体实现
// Redis 驱动：只需关注 Redis 特有的连接和操作逻辑
class RedisCacheDriver extends AbstractCacheDriver
{
    private ?\Redis $redis = null;

    protected function doConnect(): bool
    {
        $this->redis = new \Redis();
        $connected = $this->redis->connect(
            $this->config['host'] ?? '127.0.0.1',
            $this->config['port'] ?? 6379,
            timeout: $this->config['timeout'] ?? 1.0
        );
        if ($connected && isset($this->config['password'])) {
            $this->redis->auth($this->config['password']);
        }
        return $connected;
    }

    protected function doGet(string $key): mixed
    {
        $value = $this->redis->get($key);
        return $value !== false ? unserialize($value) : null;
    }

    protected function doSet(string $key, mixed $value, int $ttl): bool
    {
        return $this->redis->setex($key, $ttl, serialize($value));
    }

    public function delete(string $key): bool
    {
        $this->ensureConnected();
        return (bool) $this->redis->del($this->normalizeKey($key));
    }

    public function flush(): bool
    {
        $this->ensureConnected();
        return $this->redis->flushDB();
    }
}

// 文件缓存驱动：只需关注文件系统特有的操作逻辑
class FileCacheDriver extends AbstractCacheDriver
{
    private string $cacheDir;

    protected function doConnect(): bool
    {
        $this->cacheDir = $this->config['directory'] ?? sys_get_temp_dir() . '/cache';
        if (!is_dir($this->cacheDir)) {
            return mkdir($this->cacheDir, 0755, true);
        }
        return true;
    }

    protected function doGet(string $key): mixed
    {
        $file = $this->getFilePath($key);
        if (!file_exists($file)) {
            return null;
        }
        $content = file_get_contents($file);
        $data = unserialize($content);
        // 检查是否过期
        if ($data['expires_at'] < time()) {
            unlink($file);
            return null;
        }
        return $data['value'];
    }

    protected function doSet(string $key, mixed $value, int $ttl): bool
    {
        $file = $this->getFilePath($key);
        $data = serialize([
            'value' => $value,
            'expires_at' => time() + $ttl,
        ]);
        return file_put_contents($file, $data, LOCK_EX) !== false;
    }

    public function delete(string $key): bool
    {
        $file = $this->getFilePath($this->normalizeKey($key));
        return file_exists($file) ? unlink($file) : true;
    }

    public function flush(): bool
    {
        $files = glob($this->cacheDir . '/*.cache');
        foreach ($files as $file) {
            unlink($file);
        }
        return true;
    }

    private function getFilePath(string $key): string
    {
        return $this->cacheDir . '/' . md5($key) . '.cache';
    }
}
```

这个三层结构的优势非常清晰：接口定义了缓存系统应该有哪些能力，任何新增的缓存驱动（Memcached、APCu、数据库等）都必须实现这些能力。抽象类封装了所有驱动共享的逻辑（连接管理、键名规范化、日志记录等），避免了重复代码。具体驱动类只关心自己的底层存储实现，不需要处理通用流程。

---

## 八、PHP 8+ 新特性与接口

### 8.1 接口中的默认方法（PHP 8.0+）

PHP 8.0 允许接口中定义带方法体的方法，这使得在不破坏现有实现的前提下扩展接口成为可能。在之前的PHP版本中，一旦接口发布并被多个类实现，就很难再向接口添加新方法，因为所有实现类都必须实现新方法。PHP 8.0 的接口默认方法解决了这个问题：

```php
<?php

interface FormattableInterface
{
    /**
     * 核心方法：转换为数组格式
     * 所有实现类必须覆盖此方法
     */
    public function toArray(): array;

    /**
     * PHP 8.0：接口中的默认实现
     * 基于 toArray() 自动生成 JSON 格式
     * 实现类可以不覆盖此方法，直接使用默认实现
     */
    public function toJson(int $flags = 0): string
    {
        return json_encode($this->toArray(), $flags | JSON_UNESCAPED_UNICODE);
    }

    /**
     * PHP 8.0：接口中的默认实现
     * 基于 toArray() 自动生成 XML 格式
     */
    public function toXml(): string
    {
        $array = $this->toArray();
        $xml = new \SimpleXMLElement('<?xml version="1.0" encoding="UTF-8"?><root/>');
        array_walk_recursive($array, function ($value, $key) use ($xml) {
            $xml->addChild(is_numeric($key) ? "item_{$key}" : $key, (string) $value);
        });
        return $xml->asXML();
    }

    /**
     * PHP 8.0：更实用的默认方法
     * 生成人类可读的摘要文本
     */
    public function toSummary(int $maxLen = 100): string
    {
        $json = $this->toJson();
        return mb_strlen($json) > $maxLen ? mb_substr($json, 0, $maxLen) . '...' : $json;
    }
}

/**
 * Product 类只需实现 toArray()
 * toJson()、toXml()、toSummary() 都使用接口的默认实现
 */
class Product implements FormattableInterface
{
    public function __construct(
        private string $name,
        private float $price,
        private string $category
    ) {}

    public function toArray(): array
    {
        return [
            'name' => $this->name,
            'price' => $this->price,
            'category' => $this->category,
        ];
    }

    // toJson()、toXml()、toSummary() 使用接口默认实现，无需重复编写
}

/**
 * Order 类覆盖了 toJson()，提供了自定义的JSON格式
 */
class Order implements FormattableInterface
{
    public function __construct(
        private string $id,
        private float $amount,
        private string $status
    ) {}

    public function toArray(): array
    {
        return [
            'order_id' => $this->id,
            'total_amount' => $this->amount,
            'current_status' => $this->status,
        ];
    }

    // 覆盖默认实现，提供自定义的 JSON 输出
    public function toJson(int $flags = 0): string
    {
        return json_encode([
            'type' => 'order',
            'data' => $this->toArray(),
            'generated_at' => date('c'),
        ], $flags);
    }
}
```

### 8.2 联合类型（Union Types, PHP 8.0+）

PHP 8.0 引入了联合类型，允许参数和返回值声明多种可能的类型。这在接口设计中非常有用，可以让接口更加灵活：

```php
<?php

interface CacheInterface
{
    /**
     * 使用联合类型，返回值可以是字符串、数组或null
     * null 表示缓存未命中
     */
    public function get(string $key): string|array|null;

    /**
     * 值可以是字符串或数组
     */
    public function set(string $key, string|array $value, int $ttl = 0): bool;
}

interface SerializerInterface
{
    /**
     * 序列化结果可以是对象或数组
     */
    public function serialize(mixed $data): string;
    public function unserialize(string $data): object|array;

    /**
     * 判断是否可以反序列化
     */
    public function canUnserialize(string $data): bool;
}

interface ResponseBuilderInterface
{
    /**
     * 响应体可以是字符串、数组（自动转JSON）或 StreamableInterface
     */
    public function body(string|array|StreamableInterface $content): static;
    public function build(): Response;
}
```

### 8.3 命名参数（Named Arguments, PHP 8.0+）

命名参数与接口结合使用时，可以大幅提升代码的可读性，尤其是当接口方法有多个可选参数时：

```php
<?php

interface ReportGeneratorInterface
{
    /**
     * 生成报告
     * 拥有多个参数，使用命名参数调用时更清晰
     */
    public function generate(
        string $type,
        DateTimeInterface $from,
        DateTimeInterface $to,
        string $format = 'pdf',
        bool $includeCharts = true,
        bool $includeSummary = true,
        string $locale = 'zh_CN'
    ): Report;
}

class SalesReportGenerator implements ReportGeneratorInterface
{
    public function generate(
        string $type,
        DateTimeInterface $from,
        DateTimeInterface $to,
        string $format = 'pdf',
        bool $includeCharts = true,
        bool $includeSummary = true,
        string $locale = 'zh_CN'
    ): Report {
        // 实现逻辑
        return new Report(/* ... */);
    }
}

// 调用时使用命名参数，即使跳过中间的参数也很清晰
$generator = new SalesReportGenerator();
$report = $generator->generate(
    type: 'monthly',
    from: new DateTime('2024-01-01'),
    to: new DateTime('2024-01-31'),
    format: 'excel',
    includeCharts: false  // 明确指定不包含图表
);
```

### 8.4 Match 表达式与接口结合

PHP 8.0 的 `match` 表达式比 `switch` 更简洁、更安全，与接口配合使用可以让策略选择更加优雅：

```php
<?php

interface NotificationChannelInterface
{
    public function send(Notification $notification): bool;
    public function getType(): string;
    public function supports(Notification $notification): bool;
}

class EmailChannel implements NotificationChannelInterface
{
    public function send(Notification $notification): bool { /* ... */ }
    public function getType(): string { return 'email'; }
    public function supports(Notification $notification): bool
    {
        return filter_var($notification->recipient, FILTER_VALIDATE_EMAIL) !== false;
    }
}

class SmsChannel implements NotificationChannelInterface
{
    public function send(Notification $notification): bool { /* ... */ }
    public function getType(): string { return 'sms'; }
    public function supports(Notification $notification): bool
    {
        return preg_match('/^1[3-9]\d{9}$/', $notification->recipient);
    }
}

class NotificationDispatcher
{
    /**
     * @param NotificationChannelInterface[] $channels
     */
    public function __construct(private array $channels) {}

    /**
     * 自动匹配合适的发送渠道
     */
    public function dispatch(Notification $notification): bool
    {
        foreach ($this->channels as $channel) {
            if ($channel->supports($notification)) {
                return $channel->send($notification);
            }
        }
        throw new RuntimeException('没有找到合适的通知渠道');
    }

    /**
     * 指定渠道发送
     */
    public function dispatchTo(Notification $notification, string $channelType): bool
    {
        $channel = match ($channelType) {
            'email' => $this->findChannel('email'),
            'sms' => $this->findChannel('sms'),
            'push' => $this->findChannel('push'),
            default => throw new InvalidArgumentException("未知的通知渠道: {$channelType}")
        };

        return $channel->send($notification);
    }

    private function findChannel(string $type): NotificationChannelInterface
    {
        foreach ($this->channels as $channel) {
            if ($channel->getType() === $type) {
                return $channel;
            }
        }
        throw new RuntimeException("渠道 '{$type}' 未注册");
    }
}
```

### 8.5 枚举实现接口（PHP 8.1+）

PHP 8.1 引入了原生枚举（Enum），枚举可以实现接口，这使得枚举类型也能遵守接口契约：

```php
<?php

interface HasLabelInterface
{
    public function label(): string;
}

interface HasColorInterface
{
    public function color(): string;
}

/**
 * 订单状态枚举
 * 同时实现两个接口，既有人类可读的标签，又有对应的颜色
 */
enum OrderStatus: string implements HasLabelInterface, HasColorInterface
{
    case Pending = 'pending';
    case Processing = 'processing';
    case Shipped = 'shipped';
    case Completed = 'completed';
    case Cancelled = 'cancelled';
    case Refunded = 'refunded';

    public function label(): string
    {
        return match ($this) {
            self::Pending => '待处理',
            self::Processing => '处理中',
            self::Shipped => '已发货',
            self::Completed => '已完成',
            self::Cancelled => '已取消',
            self::Refunded => '已退款',
        };
    }

    public function color(): string
    {
        return match ($this) {
            self::Pending => '#f0ad4e',
            self::Processing => '#5bc0de',
            self::Shipped => '#337ab7',
            self::Completed => '#5cb85c',
            self::Cancelled => '#d9534f',
            self::Refunded => '#f0ad4e',
        };
    }

    /**
     * 判断状态是否允许取消
     */
    public function canCancel(): bool
    {
        return in_array($this, [self::Pending, self::Processing]);
    }

    /**
     * 获取下一个可能的状态列表
     */
    public function nextStates(): array
    {
        return match ($this) {
            self::Pending => [self::Processing, self::Cancelled],
            self::Processing => [self::Shipped, self::Cancelled],
            self::Shipped => [self::Completed, self::Refunded],
            self::Completed => [self::Refunded],
            self::Cancelled => [],
            self::Refunded => [],
        };
    }
}

// 使用枚举实现的接口
function renderStatusBadge(HasLabelInterface $item): string
{
    $color = $item instanceof HasColorInterface ? $item->color() : '#999';
    return "<span style=\"color: {$color}\">{$item->label()}</span>";
}

echo renderStatusBadge(OrderStatus::Processing); // <span style="color: #5bc0de">处理中</span>
```

### 8.6 只读属性与接口（PHP 8.2+）

```php
<?php

interface IdentifiableInterface
{
    public function getId(): string;
}

interface TimestampableInterface
{
    public function getCreatedAt(): DateTimeImmutable;
}

/**
 * PHP 8.2 只读类
 * 配合接口使用，创建不可变的数据对象
 */
readonly class UserData implements IdentifiableInterface, TimestampableInterface
{
    public function __construct(
        private string $id,
        private string $name,
        private string $email,
        private DateTimeImmutable $createdAt
    ) {}

    public function getId(): string { return $this->id; }
    public function getCreatedAt(): DateTimeImmutable { return $this->createdAt; }
    public function getName(): string { return $this->name; }
    public function getEmail(): string { return $this->email; }
}
```

---

## 九、PHPUnit 测试与接口 Mock

### 9.1 接口 Mock 基础

接口在测试中最大的价值在于**轻松替换依赖**。当我们的代码依赖接口时，可以在测试中使用 PHPUnit 的 Mock 系统创建接口的虚拟实现，无需启动真实数据库、调用真实API或访问真实文件系统：

```php
<?php

use PHPUnit\Framework\TestCase;

class UserServiceTest extends TestCase
{
    private UserService $service;
    private $mockRepository;

    protected function setUp(): void
    {
        // 创建接口的 Mock 对象
        // Mock 对象不会执行任何真实逻辑，完全由测试控制
        $this->mockRepository = $this->createMock(UserRepositoryInterface::class);
        $this->service = new UserService($this->mockRepository);
    }

    /**
     * 测试：当用户存在时，getUser 应该返回用户对象
     */
    public function testGetUserReturnsUserWhenFound(): void
    {
        $expectedUser = new User(1, '张三', 'zhangsan@example.com');

        // 配置 Mock：当调用 findById(1) 时返回预期的用户对象
        $this->mockRepository
            ->method('findById')
            ->with(1)
            ->willReturn($expectedUser);

        $result = $this->service->getUser(1);

        // 验证返回了正确的用户
        $this->assertEquals($expectedUser, $result);
        $this->assertEquals('张三', $result->name);
    }

    /**
     * 测试：当用户不存在时，应该抛出异常
     */
    public function testGetUserThrowsWhenNotFound(): void
    {
        // 配置 Mock：当调用任何 findById 时返回 null
        $this->mockRepository
            ->method('findById')
            ->willReturn(null);

        $this->expectException(UserNotFoundException::class);
        $this->service->getUser(999);
    }

    /**
     * 测试：注册新用户时，save 方法应该被调用一次
     */
    public function testRegisterCallsSaveOnce(): void
    {
        // 配置：findByEmail 返回 null（邮箱未被注册）
        $this->mockRepository
            ->method('findByEmail')
            ->willReturn(null);

        // 设置期望：save 方法应该恰好被调用一次
        $this->mockRepository
            ->expects($this->once())
            ->method('save')
            ->willReturn(true);

        $this->service->register('李四', 'lisi@example.com', 'password123');
    }

    /**
     * 测试：邮箱重复时不应该调用 save
     */
    public function testRegisterDoesNotSaveWhenEmailExists(): void
    {
        $existingUser = new User(1, '已存在', 'lisi@example.com');

        $this->mockRepository
            ->method('findByEmail')
            ->willReturn($existingUser);

        // 设置期望：save 方法不应该被调用
        $this->mockRepository
            ->expects($this->never())
            ->method('save');

        $this->expectException(DuplicateEmailException::class);
        $this->service->register('李四', 'lisi@example.com', 'password123');
    }
}
```

### 9.2 使用 Mock 验证接口交互

除了模拟返回值，我们还可以使用 Mock 来验证方法是否被正确调用，以及调用参数是否正确：

```php
<?php

class CheckoutServiceTest extends TestCase
{
    /**
     * 测试：结账流程中，支付、记录日志、清除缓存应该按顺序调用
     */
    public function testCheckoutFlowWithMultipleInterfaces(): void
    {
        // 分别 Mock 三个不同的接口
        $paymentMock = $this->createMock(PaymentInterface::class);
        $logMock = $this->createMock(LoggableInterface::class);
        $cacheMock = $this->createMock(CacheableInterface::class);

        // 配置支付接口：充电99.99元应该成功
        $paymentResult = new PaymentResult(
            success: true,
            transactionId: 'TXN-12345',
            paidAt: new DateTimeImmutable()
        );
        $paymentMock
            ->expects($this->once())
            ->method('charge')
            ->with(99.99, $this->isType('array'))
            ->willReturn($paymentResult);

        // 配置缓存接口：应该清除用户购物车缓存
        $cacheMock
            ->expects($this->once())
            ->method('delete')
            ->with('cart:user:42');

        // 创建结账服务，注入 Mock 依赖
        $checkoutService = new CheckoutService(
            payment: $paymentMock,
            logger: $logMock,
            cache: $cacheMock
        );

        // 执行结账
        $order = $checkoutService->checkout(
            userId: 42,
            items: [['product_id' => 1, 'price' => 99.99]],
            amount: 99.99
        );

        // 验证订单状态
        $this->assertTrue($order->isPaid());
        $this->assertEquals('TXN-12345', $order->transactionId);
    }

    /**
     * 测试：支付失败时不应该清除缓存
     */
    public function testCheckoutDoesNotClearCacheOnPaymentFailure(): void
    {
        $paymentMock = $this->createMock(PaymentInterface::class);
        $logMock = $this->createMock(LoggableInterface::class);
        $cacheMock = $this->createMock(CacheableInterface::class);

        $paymentMock
            ->method('charge')
            ->willReturn(new PaymentResult(success: false, transactionId: '', paidAt: null));

        // 支付失败时，缓存不应该被清除
        $cacheMock->expects($this->never())->method('delete');

        $checkoutService = new CheckoutService(
            payment: $paymentMock,
            logger: $logMock,
            cache: $cacheMock
        );

        $this->expectException(PaymentFailedException::class);
        $checkoutService->checkout(userId: 42, items: [], amount: 99.99);
    }
}
```

### 9.3 使用匿名类快速创建测试用的接口实现

在简单的测试场景中，我们可以使用匿名类快速创建接口的测试实现，而不需要创建完整的 Mock：

```php
<?php

class FormattableTest extends TestCase
{
    public function testToJsonIncludesAllFields(): void
    {
        // 使用匿名类快速创建接口实现
        $item = new class (['name' => '测试商品', 'price' => 99.9]) implements FormattableInterface {
            public function __construct(private array $data) {}
            public function toArray(): array { return $this->data; }
        };

        $json = $item->toJson();
        $decoded = json_decode($json, true);

        $this->assertEquals('测试商品', $decoded['name']);
        $this->assertEquals(99.9, $decoded['price']);
    }
}
```

---

## 十、常见反模式与错误

在使用接口和抽象类的过程中，有一些常见的错误和反模式需要避免。这些反模式在实际项目中非常普遍，识别并避免它们可以显著提升代码质量。

### 10.1 反模式一：God Interface（万能接口）

一个接口包含了太多不相关的方法，违反了接口隔离原则。这是最常见的反模式之一：

```php
<?php

// ❌ 错误：一个接口做了太多事情
interface ApplicationServiceInterface
{
    public function createUser(array $data): User;
    public function deleteUser(int $id): bool;
    public function createOrder(array $data): Order;
    public function processPayment(float $amount): bool;
    public function sendNotification(string $message): bool;
    public function generateReport(string $type): Report;
    public function logActivity(string $action): void;
}

// 问题：
// 1. 只想实现用户管理的类被迫实现支付和通知方法
// 2. 修改通知逻辑可能影响所有实现类
// 3. 无法独立替换某一个功能模块

// ✅ 正确：拆分为职责单一的接口
interface UserManagementInterface
{
    public function createUser(array $data): User;
    public function deleteUser(int $id): bool;
}

interface OrderServiceInterface
{
    public function createOrder(array $data): Order;
}

interface PaymentServiceInterface
{
    public function processPayment(float $amount): bool;
}

interface NotificationServiceInterface
{
    public function sendNotification(string $message): bool;
}
```

### 10.2 反模式二：接口中暴露实现细节

接口应该定义"做什么"，而不是"怎么做"。如果接口中引用了具体的实现类，就失去了抽象的意义：

```php
<?php

// ❌ 错误：接口中暴露了具体实现类型
interface DatabaseInterface
{
    public function getPDO(): PDO;  // 泄露了 PDO 实现细节
    public function getQueryBuilder(): \Illuminate\Database\Query\Builder; // 绑定到 Laravel
}

// 问题：换掉底层数据库驱动（如从 MySQL 换到 MongoDB）时，接口也要改

// ✅ 正确：接口只暴露业务行为
interface DatabaseInterface
{
    public function select(string $query, array $params = []): array;
    public function insert(string $table, array $data): int;
    public function update(string $table, array $data, array $where): int;
    public function delete(string $table, array $where): int;
    public function transaction(callable $callback): mixed;
}
```

### 10.3 反模式三：过度使用抽象类

将所有通用代码塞进一个万能抽象类，违反了单一职责原则。抽象类应该专注于定义一个模板/骨架，而不是成为代码的垃圾场：

```php
<?php

// ❌ 错误：一个抽象类包含了30多个方法，做了太多事情
abstract class BaseRepository
{
    // 各种混杂的方法堆在一起
    abstract protected function getModel(): Model;
    
    public function all() { /* ... */ }
    public function find() { /* ... */ }
    public function create() { /* ... */ }
    public function update() { /* ... */ }
    public function delete() { /* ... */ }
    public function paginate() { /* ... */ }
    public function search() { /* ... */ }
    public function export() { /* ... */ }   // 不属于 Repository 核心职责
    public function import() { /* ... */ }   // 不属于 Repository 核心职责
    public function log() { /* ... */ }      // 不属于 Repository 核心职责
    public function cache() { /* ... */ }    // 不属于 Repository 核心职责
}

// ✅ 正确：抽象类只保留核心模板，其他行为通过 Trait 组合
trait Exportable
{
    public function export(string $format = 'csv'): string
    {
        // 导出逻辑
    }
}

trait Importable
{
    public function import(string $file): int
    {
        // 导入逻辑
    }
}

trait Loggable
{
    public function log(string $action, array $data = []): void
    {
        // 日志记录逻辑
    }
}

abstract class BaseRepository
{
    protected abstract function getModel(): Model;
    
    // 只保留 Repository 的核心职责
    public function all() { return $this->getModel()->all(); }
    public function find(int $id) { return $this->getModel()->findOrFail($id); }
    public function create(array $data) { return $this->getModel()->create($data); }
}

class ArticleRepository extends BaseRepository
{
    use Exportable, Loggable; // 按需组合行为

    protected function getModel(): Model
    {
        return new Article();
    }
}

class UserRepository extends BaseRepository
{
    use Importable, Loggable; // 不同的 Repository 使用不同的 Trait

    protected function getModel(): Model
    {
        return new User();
    }
}
```

### 10.4 反模式四：标记接口（空接口）

没有定义任何方法的空接口缺乏实际约束能力。虽然在 Java 中标记接口有其用途（如 `Serializable`），但在PHP中有更好的替代方案（如属性注解或 PHP 8.0 的 Attribute）：

```php
<?php

// ⚠️ 不推荐：空接口没有任何实际约束
interface DeletableInterface
{
    // 空的！没有任何方法定义
}

class Article implements DeletableInterface
{
    // 实现了接口，但没有实际约束
    // 可能忘记实现 delete 方法，也没有编译报错
}

// ✅ 更好：至少定义一个方法，让接口有实际的约束能力
interface DeletableInterface
{
    public function delete(): bool;
    public function isDeletable(): bool;
    public function getDeletedAt(): ?DateTimeImmutable;
}

// ✅ 或者使用 PHP 8.0 Attribute 替代标记接口
#[Attribute(Attribute::TARGET_CLASS)]
class SoftDeletable {}

#[SoftDeletable]
class Article
{
    // 使用 Attribute 标记，语义更清晰
}
```

### 10.5 反模式五：在接口中定义构造函数参数

构造函数的参数签名是实现细节，不应该被接口约束。不同的实现可能需要不同的依赖注入：

```php
<?php

// ❌ 错误：接口不应该约束构造函数签名
interface CacheDriverInterface
{
    public function __construct(string $host, int $port); // 不推荐！
    public function get(string $key): mixed;
    public function set(string $key, mixed $value, int $ttl): bool;
}

// 问题：
// 1. 文件缓存不需要 host 和 port
// 2. Redis 可能还需要 password 和 database 编号
// 3. 构造函数签名变了，接口也要改，所有实现类都要改

// ✅ 正确：构造函数是实现细节，不应该出现在接口中
interface CacheDriverInterface
{
    public function get(string $key): mixed;
    public function set(string $key, mixed $value, int $ttl): bool;
    public function delete(string $key): bool;
}

// 每个实现类自由决定自己的构造参数
class RedisCacheDriver implements CacheDriverInterface
{
    public function __construct(private string $host, private int $port, private string $password = '') {}
    // ...
}

class FileCacheDriver implements CacheDriverInterface
{
    public function __construct(private string $directory) {}
    // ...
}
```

---

## 十一、接口类型提示与类型安全

### 11.1 方法参数中的接口约束

在方法参数中使用接口类型提示，可以确保传入的对象具备特定的能力，同时保持足够的灵活性：

```php
<?php

class ReportExporter
{
    /**
     * 接受任何实现了 FormattableInterface 的对象
     * 无论是 Product、Order、User，只要实现了该接口就可以导出
     */
    public function export(FormattableInterface $data, string $format): string
    {
        return match ($format) {
            'json' => $data->toJson(),
            'xml' => $data->toXml(),
            'array' => print_r($data->toArray(), true),
            default => throw new InvalidArgumentException("不支持的导出格式: {$format}")
        };
    }

    /**
     * 批量导出——接收一个接口数组
     * @param FormattableInterface[] $items
     */
    public function exportBatch(array $items, string $format): string
    {
        $results = array_map(
            fn(FormattableInterface $item) => $this->export($item, $format),
            $items
        );

        return match ($format) {
            'json' => json_encode($results),
            'array' => print_r($results, true),
            default => implode("\n---\n", $results),
        };
    }
}
```

### 11.2 接口作为返回类型

返回接口类型可以让调用方不依赖具体实现，同时内部可以灵活更换实现：

```php
<?php

class CacheFactory
{
    /**
     * 返回接口类型，调用方不关心具体是 Redis 还是 File 缓存
     */
    public function create(string $driver = null): CacheDriverInterface
    {
        $driver = $driver ?? config('cache.default');

        return match ($driver) {
            'redis' => new RedisCacheDriver(config('cache.redis')),
            'file' => new FileCacheDriver(config('cache.file')),
            default => throw new InvalidArgumentException("未知的缓存驱动: {$driver}"),
        };
    }
}
```

---

## 十二、总结与最佳实践

### 何时选择接口

- ✅ 定义跨不同继承体系的公共行为——接口不绑定于任何继承树
- ✅ 需要多重实现——一个类可以实现任意数量的接口
- ✅ 遵循依赖倒置原则——通过接口解耦模块之间的依赖关系
- ✅ 编写可测试的代码——Mock 接口比 Mock 具体类和抽象类简单得多
- ✅ 定义服务契约——如 Laravel 的 Repository 模式、Cache 驱动等
- ✅ 需要在不同项目间共享契约——接口是API设计的核心

### 何时选择抽象类

- ✅ 多个子类共享公共代码和状态（属性）——抽象类可以持有状态
- ✅ 实现模板方法模式——定义算法骨架，延迟步骤到子类
- ✅ 子类之间有明确的"is-a"继承关系——如 Dog is an Animal
- ✅ 需要构造函数来初始化共享状态——接口没有构造函数
- ✅ 需要 protected 属性或方法——接口只能 public
- ✅ 需要控制子类的实现方式——如 final 方法防止子类覆盖

### 黄金法则

1. **优先使用接口**——接口的灵活性远高于抽象类，能够适应更多的设计需求
2. **接口定义契约，抽象类提供骨架，具体类填充细节**——三者各司其职，形成清晰的分层
3. **保持接口小而精**——遵循接口隔离原则，一个接口只关注一个维度的能力
4. **不要为了使用而使用**——如果简单的具体类就能满足需求，不需要引入接口或抽象类增加复杂度
5. **组合优于继承**——Trait 可以替代部分抽象类的职责，提供更灵活的代码复用方式

掌握接口与抽象类的正确使用方式，是编写可维护、可测试、可扩展的 PHP 应用程序的关键一步。在实际开发中，建议根据项目的规模和复杂度来选择合适的设计方案：小型项目中不必过度设计，中大型项目中合理使用接口和抽象类可以显著提升代码的可维护性和可扩展性。

---

## 相关阅读

- [PHP OOP 面向对象编程](/categories/PHP/oop/)
- [PHP 依赖注入](/categories/PHP/dependency-injection/)
- [PHP 代码优化](/categories/PHP/code-optimization/)
- [PHP 自动加载](/categories/PHP/autoloading/)
