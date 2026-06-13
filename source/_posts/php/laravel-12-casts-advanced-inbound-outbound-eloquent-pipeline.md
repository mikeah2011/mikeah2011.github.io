---
title: 'Laravel 12.x Casts 进阶实战：自定义 Cast 类的底层原理——InboundCasts/OutboundCasts 与 Eloquent 序列化管道'
date: 2026-06-06 10:00:00
tags: [Laravel, Eloquent, PHP, Casts, ORM]
keywords: [Laravel, Casts, Cast, InboundCasts, OutboundCasts, Eloquent, 进阶实战, 自定义, 类的底层原理, 序列化管道]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: "Laravel 12.x 自定义 Cast 类深度实战指南，从源码层面剖析 Eloquent 序列化管道的 Inbound/Outbound/ForArray 三向数据转换机制。详解 CastsAttributes、InboundCasts、OutboundCasts 三大接口的使用场景与底层原理，手把手实现 Money 值对象 Cast、强类型 DTO Cast、JSON Schema 校验 Cast、加密 Cast 等 8 个生产级自定义 Cast 类。对比 Laravel 11 与 12 的接口变化（CastsInboundAttributes → InboundCasts），覆盖 Cast 注册优先级、单元测试策略、性能影响分析与常见踩坑案例，适合中高级 Laravel 开发者深入掌握 Eloquent 数据层定制能力。"
---


## 前言

在 Laravel 的 Eloquent ORM 中，`$casts` 属性是我们每天都在使用的特性——把数据库里的 JSON 字符串自动解码成 PHP 数组，把时间戳字符串转成 Carbon 实例，把整数 `0/1` 映射成布尔值。这些内置 Cast 用起来很爽，但当业务复杂度上升，你会发现自己越来越频繁地需要"自定义 Cast"。

你可能遇到过这样的场景：数据库里存的是以"分"为单位的整数金额，但业务层需要一个 `Money` 对象来运算和格式化；或者你需要把 JSON 字段映射成强类型的 DTO，而不是松散的关联数组；又或者你需要在数据入库时自动做清洗和规范化，出库时保持原样。这些需求都指向同一个核心能力——自定义 Cast 类。

Laravel 11 引入了 `CastsAttributes` 接口作为自定义 Cast 的标准写法，到了 Laravel 12.x，这套体系进一步完善，新增了 `InboundCasts` 和 `OutboundCasts` 两个接口，让你可以精细控制数据的序列化方向。更重要的是，Laravel 12 对旧接口名称做了规范化整理，废弃了冗长的 `CastsInboundAttributes`，推荐使用更简洁的 `InboundCasts`。

本文将从源码层面剖析 Eloquent 的序列化管道，手把手演示多种实战 Cast 类的编写，对比 Laravel 11 与 12 的变化，并总结踩坑经验与最佳实践。无论你是刚接触自定义 Cast 的中级开发者，还是想深入理解 Eloquent 内核的高级工程师，这篇文章都能给你带来实质性的收获。

---

## 一、基础知识回顾：Eloquent Cast 的三个方向

在深入自定义 Cast 之前，我们有必要先建立一个清晰的心智模型。在 Eloquent 模型中，一个属性的生命周期涉及三个数据转换方向，理解这三个方向是正确编写 Cast 类的前提。

| 方向 | 时机 | 说明 |
|------|------|------|
| **Inbound（入库）** | `setAttribute()` 被调用时 | PHP 值 → 数据库存储值 |
| **Outbound（出库）** | `getAttribute()` / `toArray()` / `toJson()` 被调用时 | 数据库原始值 → PHP 值 |
| **Outbound for Array** | `toArray()` / `toJson()` 时 | PHP 值 → JSON 安全的数组表示 |

第一个方向是"入库"（Inbound），发生在你给模型属性赋值并保存的时候。比如你给 `$order->amount` 赋了一个 `Money` 对象，Cast 需要把它转成数据库能存储的整数。第二个方向是"出库"（Outbound），发生在你从数据库读取模型并访问属性的时候。比如数据库里存的是 `9990`，Cast 需要把它转回 `Money` 对象。第三个方向是"出库到数组"（Outbound for Array），发生在你调用 `toArray()` 或 `toJson()` 时，Cast 返回的 PHP 对象需要被进一步转换为 JSON 安全的数组表示。

Laravel 12.x 提供了三个接口来分别覆盖这些方向。这三个接口的设计体现了"接口隔离原则"——如果你只需要处理一个方向的转换，不必实现另一个方向的空方法：

```php
// 双向转换（最常用）
interface CastsAttributes {
    public function get(Model $model, string $key, mixed $value, array $attributes): mixed;
    public function set(Model $model, string $key, mixed $value, array $attributes): mixed;
}

// 仅处理入库方向
interface InboundCasts {
    public function set(Model $model, string $key, mixed $value, array $attributes): mixed;
}

// 仅处理出库方向
interface OutboundCasts {
    public function get(Model $model, string $key, mixed $value, array $attributes): mixed;
}
```

注意这些接口中 `$attributes` 参数的设计——它包含当前模型的所有原始属性数组，这意味着你可以在 Cast 中访问同一行的其他字段值。这个设计在很多场景下非常有用，比如你可以根据同一行的 `currency` 字段来决定如何格式化 `amount` 字段。

---

## 二、CastsAttributes：双向 Cast 的完整用法

### 2.1 接口详解

`CastsAttributes` 是最常用的自定义 Cast 接口，同时处理入库和出库两个方向。它位于 `Illuminate\Contracts\Database\Eloquent` 命名空间下，是一个非常干净的接口，只有两个方法。任何需要在读写两个方向都做转换的场景，都应该优先考虑实现这个接口。

```php
namespace Illuminate\Contracts\Database\Eloquent;

use Illuminate\Database\Eloquent\Model;

interface CastsAttributes
{
    /**
     * 从数据库原始值转换为 PHP 值（出库方向）
     * $value 是 PDO 驱动返回的原始值（通常已经是 PHP 基础类型）
     * $attributes 是该行所有字段的原始值数组
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): mixed;

    /**
     * 从 PHP 值转换为数据库存储值（入库方向）
     * $value 是用户代码赋给属性的值（可能是任何类型）
     * $attributes 是该行所有字段的原始值数组（注意：包含的是尚未 Cast 的原始值）
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): mixed;
}
```

一个容易被忽视的细节是 `$attributes` 参数的含义。在 `get()` 方法中，`$attributes` 包含的是数据库原始值，而非 Cast 后的值。也就是说，如果你在同一行有另一个字段也使用了自定义 Cast，在 `$attributes` 中你看到的是那个字段的数据库原始值，而不是 Cast 后的 PHP 对象。如果你需要获取其他字段 Cast 后的值，可以通过 `$model` 对象来访问（但要注意可能触发循环依赖）。

### 2.2 实战一：自定义值对象 Cast（Money）

电商系统中金额处理是一个经典场景。数据库中存储以"分"为单位的整数可以避免浮点精度问题，但业务代码中直接操作分值既不直观也不安全。我们创建一个 `Money` 值对象，然后用 Cast 自动在数据库整数和 PHP 对象之间转换。

首先定义值对象类：

```php
<?php

namespace App\ValueObjects;

use JsonSerializable;
use Stringable;

/**
 * 金额值对象
 * 内部以"分"（cents）为单位存储，避免浮点精度丢失
 * 支持多币种，通过 currency 字段标识
 */
final readonly class Money implements Stringable, JsonSerializable
{
    public function __construct(
        public int $cents,
        public string $currency = 'CNY',
    ) {}

    /**
     * 从十进制浮点数创建（如 99.90 → 9990 分）
     */
    public static function fromDecimal(float $amount, string $currency = 'CNY'): self
    {
        return new self(
            cents: (int) round($amount * 100),
            currency: $currency,
        );
    }

    /**
     * 转换为十进制浮点数（如 9990 分 → 99.90）
     */
    public function toDecimal(): float
    {
        return $this->cents / 100;
    }

    /**
     * 格式化输出，支持人民币和美元
     */
    public function format(): string
    {
        return match ($this->currency) {
            'CNY' => '¥' . number_format($this->toDecimal(), 2),
            'USD' => '$' . number_format($this->toDecimal(), 2),
            default => $this->currency . ' ' . number_format($this->toDecimal(), 2),
        };
    }

    /**
     * 金额加法，不同币种会抛出异常
     */
    public function add(self $other): self
    {
        if ($this->currency !== $other->currency) {
            throw new \InvalidArgumentException('Currency mismatch');
        }
        return new self($this->cents + $other->cents, $this->currency);
    }

    /**
     * 金额乘法（用于计算折扣、税费等）
     */
    public function multiply(float $factor): self
    {
        return new self(
            cents: (int) round($this->cents * $factor),
            currency: $this->currency,
        );
    }

    public function __toString(): string
    {
        return $this->format();
    }

    /**
     * JSON 序列化输出
     * 这个方法决定了 toJson() 和 toArray() 时的结构
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    public function toArray(): array
    {
        return [
            'cents' => $this->cents,
            'decimal' => $this->toDecimal(),
            'formatted' => $this->format(),
            'currency' => $this->currency,
        ];
    }
}
```

注意这里实现了 `JsonSerializable` 接口——这是确保 `toArray()` 和 `toJson()` 正确工作的关键，后面会详细解释原因。

接下来编写对应的 Cast 类：

```php
<?php

namespace App\Casts;

use App\ValueObjects\Money;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * 金额 Cast
 * 数据库存储：整数（分），如 9990
 * PHP 值：Money 对象
 * 同时读取同一行的 currency 字段来确定币种
 */
class MoneyCast implements CastsAttributes
{
    /**
     * 出库：数据库整数 → Money 对象
     *
     * @param  array{cents: int, currency?: string}  $attributes
     * @return Money
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): Money
    {
        // $value 是数据库中的整数值（单位：分）
        // 从同一行取 currency 字段，如果没有则默认 CNY
        // 这里读的是原始值，通常是一个字符串，但对于 VARCHAR 列来说是安全的
        $currency = $attributes['currency'] ?? 'CNY';

        return new Money(
            cents: (int) $value,
            currency: $currency,
        );
    }

    /**
     * 入库：Money 对象/浮点数/整数 → 数据库整数
     * 支持多种输入类型，提高 API 的灵活性
     *
     * @param  Money|float|int  $value
     * @return int
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): int
    {
        // 支持传入 Money 对象、浮点数或整数，让调用者可以选择方便的方式
        return match (true) {
            $value instanceof Money => $value->cents,
            is_float($value) => (int) round($value * 100),
            is_int($value) => $value,
            default => throw new \InvalidArgumentException(
                "Invalid value for MoneyCast: " . get_debug_type($value)
            ),
        };
    }
}
```

在模型中的使用：

```php
<?php

namespace App\Models;

use App\Casts\MoneyCast;
use App\ValueObjects\Money;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected function casts(): array
    {
        return [
            'amount'       => MoneyCast::class,
            'total_amount' => MoneyCast::class,
            'paid_at'      => 'datetime',
        ];
    }
}
```

使用示例——你会看到 Cast 在幕后做了多少工作：

```php
// 创建订单——传入 Money 对象，Cast 自动提取 cents 存入数据库
$order = Order::create([
    'amount'       => Money::fromDecimal(99.90),  // 自动存为 9990（分）
    'total_amount' => Money::fromDecimal(199.80),
    'currency'     => 'CNY',
]);

// 读取时自动转换为 Money 对象
echo $order->amount;           // ¥99.90
echo $order->amount->cents;    // 9990
echo $order->amount->currency; // CNY

// 可以直接用 Money 对象做运算
$sum = $order->amount->add($order->total_amount);
echo $sum; // ¥299.70

// JSON 输出时，JsonSerializable 会自动生效
echo json_encode($order->amount);
// {"cents":9990,"decimal":99.9,"formatted":"¥99.90","currency":"CNY"}

// 你也可以传入浮点数或整数，set() 方法会自动处理
$order->update(['amount' => 49.95]);     // 浮点数，自动转为 4995 分
$order->update(['amount' => 4995]);      // 整数，直接使用
```

---

### 2.3 实战二：自定义 JSON Cast（强类型 DTO）

Laravel 内置的 `array` 和 `json` Cast 只能转成普通的 PHP 关联数组。这在简单场景下够用，但当你的 JSON 结构变得复杂（嵌套对象、可选字段、类型约束），松散的数组就不够安全了。一个 typo 或者类型错误可能在运行时才会暴露。

我们的目标是：数据库中的 JSON 字段在出库时自动解码为强类型的 DTO 对象，入库时 DTO 对象自动编码为 JSON 字符串。

```php
<?php

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/**
 * 强类型 JSON Cast
 * 将数据库 JSON 字段映射为指定的 DTO 类实例
 *
 * 用法示例：
 *   'settings' => new TypedJsonCast(SettingsDTO::class),
 *   'metadata' => new TypedJsonCast(MetadataDTO::class),
 *
 * 要求 DTO 类必须实现静态的 fromArray(array): self 方法
 */
class TypedJsonCast implements CastsAttributes
{
    public function __construct(
        private readonly string $dtoClass,
    ) {
        // 在构造时验证 DTO 类存在且有 fromArray 方法
        if (!class_exists($this->dtoClass)) {
            throw new InvalidArgumentException(
                "DTO class [{$this->dtoClass}] does not exist."
            );
        }
        if (!method_exists($this->dtoClass, 'fromArray')) {
            throw new InvalidArgumentException(
                "DTO class [{$this->dtoClass}] must implement a static fromArray() method."
            );
        }
    }

    /**
     * 出库：JSON 字符串 → DTO 对象
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): mixed
    {
        if (is_null($value)) {
            return null;
        }

        // 数据库驱动可能已经返回解码后的数组，也可能是 JSON 字符串
        $data = is_string($value) ? json_decode($value, true) : $value;

        if (!is_array($data)) {
            throw new InvalidArgumentException(
                "Invalid JSON for cast key [{$key}]: expected array, got " . get_debug_type($data)
            );
        }

        return $this->dtoClass::fromArray($data);
    }

    /**
     * 入库：DTO 对象/数组 → JSON 字符串
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): mixed
    {
        if (is_null($value)) {
            return null;
        }

        // 如果已经是数组，直接编码
        if (is_array($value)) {
            return json_encode($value, JSON_UNESCAPED_UNICODE);
        }

        // 如果是 DTO 对象且有 toArray 方法，调用它
        if (is_object($value) && method_exists($value, 'toArray')) {
            return json_encode($value->toArray(), JSON_UNESCAPED_UNICODE);
        }

        // 如果是 DTO 对象且实现了 JsonSerializable
        if ($value instanceof \JsonSerializable) {
            return json_encode($value, JSON_UNESCAPED_UNICODE);
        }

        throw new InvalidArgumentException(
            "Expected instance of {$this->dtoClass}, array, or JsonSerializable for key [{$key}]"
        );
    }
}
```

配合 DTO 使用——以通知设置为例：

```php
<?php

namespace App\DTOs;

use JsonSerializable;

/**
 * 用户通知设置 DTO
 * 对应数据库中的 JSON 字段
 */
final readonly class NotificationSettings implements JsonSerializable
{
    public function __construct(
        public bool $emailEnabled = true,
        public bool $smsEnabled = false,
        public bool $pushEnabled = true,
        public string $quietHoursStart = '22:00',
        public string $quietHoursEnd = '07:00',
        public array $channels = ['email'],
    ) {}

    /**
     * 从数据库 JSON 解码后的数组创建
     * 使用 snake_case 键名与数据库保持一致
     */
    public static function fromArray(array $data): self
    {
        return new self(
            emailEnabled: (bool) ($data['email_enabled'] ?? true),
            smsEnabled: (bool) ($data['sms_enabled'] ?? false),
            pushEnabled: (bool) ($data['push_enabled'] ?? true),
            quietHoursStart: $data['quiet_hours_start'] ?? '22:00',
            quietHoursEnd: $data['quiet_hours_end'] ?? '07:00',
            channels: $data['channels'] ?? ['email'],
        );
    }

    /**
     * 转换为数组（用于入库和 JSON 序列化）
     */
    public function toArray(): array
    {
        return [
            'email_enabled' => $this->emailEnabled,
            'sms_enabled' => $this->smsEnabled,
            'push_enabled' => $this->pushEnabled,
            'quiet_hours_start' => $this->quietHoursStart,
            'quiet_hours_end' => $this->quietHoursEnd,
            'channels' => $this->channels,
        ];
    }

    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}
```

模型中的使用：

```php
<?php

namespace App\Models;

use App\Casts\TypedJsonCast;
use App\DTOs\NotificationSettings;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    protected function casts(): array
    {
        return [
            'notification_settings' => new TypedJsonCast(NotificationSettings::class),
            'email_verified_at'     => 'datetime',
            'password'              => 'hashed',
        ];
    }
}
```

使用示例：

```php
$user = User::find(1);

// 自动解码为强类型 DTO——有 IDE 自动补全，有类型检查
$settings = $user->notification_settings;
echo $settings->emailEnabled;    // true
echo $settings->quietHoursStart; // 22:00
echo $settings->channels;        // ['email']

// 修改并保存——传入新的 DTO 对象即可
$user->update([
    'notification_settings' => new NotificationSettings(
        smsEnabled: true,
        pushEnabled: false,
        channels: ['email', 'sms', 'push'],
    ),
]);

// 也可以传入数组，set() 方法会自动处理
$user->update([
    'notification_settings' => [
        'email_enabled' => false,
        'sms_enabled' => true,
    ],
]);
```

---

## 三、InboundCasts：只关心入库方向

### 3.1 何时使用 InboundCasts

有些场景下，你只需要在数据写入数据库时做转换，读取时直接使用数据库返回的原始值即可。这时候用 `InboundCasts` 接口是最合适的，因为你不需要实现一个空的 `get()` 方法。

典型的使用场景包括以下几种：密码哈希——写入时做 bcrypt 或 argon2 哈希，读取时原样返回哈希字符串（Laravel 内置的 `hashed` Cast 就是这个思路）；数据清洗——写入时做 trim、转小写、去特殊字符，读取时已经是规范化的值；外部 ID 映射——写入时把内部 ID 转换为外部系统的 ID 格式；数据脱敏——写入时对敏感字段做单向加密或混淆。

```php
<?php

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\InboundCasts;
use Illuminate\Database\Eloquent\Model;

/**
 * 邮箱规范化 Cast
 * 入库时：统一转小写、去除首尾空白
 * 出库时：不处理（数据库中已经是规范化的值）
 *
 * 这种设计确保了查询时也能匹配到规范化后的值
 * 比如 User::where('email', 'JOHN@EXAMPLE.COM') 能找到 john@example.com
 */
class NormalizedEmail implements InboundCasts
{
    /**
     * 入库时：统一转小写、trim
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        return strtolower(trim($value));
    }
}
```

使用方式：

```php
class User extends Authenticatable
{
    protected function casts(): array
    {
        return [
            'email' => NormalizedEmail::class,
            // ...
        ];
    }
}

$user = new User();
$user->email = '  JOHN.Doe@Example.COM  ';
$user->save();
// 数据库中存储的是：john.doe@example.com

echo $user->email; // john.doe@example.com（从数据库读出来的已经是规范化的值）
```

### 3.2 InboundCasts 的注意点和局限

使用 `InboundCasts` 接口时有几个重要的注意点需要牢记。

首先，`InboundCasts` 接口**没有** `get()` 方法，这意味着 `getAttribute()` 返回的是数据库中的原始值（经过 PDO 驱动的默认类型转换后）。如果你的数据库列是 VARCHAR，返回的就是字符串；如果是 INT，返回的就是整数。没有额外的 PHP 层转换。

其次，`toArray()` 和 `toJson()` 也使用数据库原始值。如果你需要在 JSON 序列化时做特殊处理（比如把内部状态码转成人类可读的标签），应该使用 `CastsAttributes` 而非 `InboundCasts`。

第三，`InboundCasts` 不能与 `OutboundCasts` 组合使用——它们是两个独立的接口，不能同时实现。如果你需要同时处理两个方向，直接用 `CastsAttributes` 即可。

### 3.3 实战：手机号脱敏存储 Cast

```php
<?php

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\InboundCasts;
use Illuminate\Database\Eloquent\Model;

/**
 * 手机号加密存储 Cast
 * 入库时：AES-256-CBC 加密（可逆，需要查询时解密）
 * 出库时：返回密文，由应用层在需要时解密
 *
 * 注意：这里故意只实现 InboundCasts，因为解密逻辑比较复杂，
 * 涉及到搜索索引的考量，不适合在 Cast 中自动完成。
 * 实际项目中建议配合 access mutator 来做解密。
 */
class EncryptedPhone implements InboundCasts
{
    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if (is_null($value)) {
            return null;
        }

        // 简单演示，实际项目建议使用 Laravel 的 encrypt() / Crypt facade
        // 或者专门的加密服务
        return base64_encode(
            openssl_encrypt($value, 'aes-256-cbc', env('PHONE_ENCRYPT_KEY'), 0, substr(env('PHONE_ENCRYPT_KEY'), 0, 16))
        );
    }
}
```

---

## 四、OutboundCasts：只关心出库方向

### 4.1 何时使用 OutboundCasts

`OutboundCasts` 适用于数据入库时不做任何转换、但读取时需要按特定方式解析或格式化的场景。这种情况在实际项目中虽然不如 `CastsAttributes` 常见，但在以下场景中非常有用。

第一个场景是兼容旧数据格式。假设你的系统正在从旧格式迁移到新格式，旧数据入库时不需要改动（保持兼容），但出库时需要按新格式解析。第二个场景是只读计算字段。数据库层面通过 GENERATED COLUMN 或视图实现的计算字段，入库时不需要 Cast（直接由数据库处理），但出库时需要转成 PHP 对象。第三个场景是外部数据源对接。有些字段的数据来自外部系统（通过 ETL 或同步任务写入），入库时不是通过 Eloquent 的 `setAttribute` 流程，但读取时需要统一格式化。

```php
<?php

namespace App\Casts;

use App\ValueObjects\Money;
use Illuminate\Contracts\Database\Eloquent\OutboundCasts;
use Illuminate\Database\Eloquent\Model;

/**
 * 旧系统金额 Cast
 * 旧系统以"元"为单位的 DECIMAL 存储，读取时转为 Money 对象
 * 写入时不处理，保持原始值（因为旧系统和其他写入路径不需要转换）
 */
class LegacyMoneyCast implements OutboundCasts
{
    /**
     * 旧系统以"元"为单位的浮点数存储，读取时转为 Money 对象
     * 写入时不处理，保持原始值
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): Money
    {
        return Money::fromDecimal(
            amount: (float) $value,
            currency: $attributes['currency'] ?? 'CNY',
        );
    }
}
```

使用示例：

```php
// 假设从旧系统迁移过来的订单数据
// 数据库中 amount 字段存储的是 99.90（DECIMAL 类型，元为单位）
$order = LegacyOrder::find(1);

// 出库时自动转为 Money 对象
echo $order->amount;         // ¥99.90
echo $order->amount->cents;  // 9990

// 入库时不做转换，直接存浮点数
$order->amount = 199.80;     // 数据库存 199.80
$order->save();
```

### 4.2 OutboundCasts 与 toArray 的交互

当使用 `OutboundCasts` 时，`get()` 方法返回的对象同样会经历 `toArray()` 中的序列化流程。如果你的返回对象实现了 `Arrayable` 或 `JsonSerializable`，它会被自动转换为数组或 JSON 安全的格式。如果不实现这些接口，对象会被原样放入数组——这通常不是你想要的结果。

---

## 五、Serializable 接口与 toArray() 的关系

### 5.1 问题场景

这是很多开发者遇到的一个经典坑：你的 Cast 类在 `get()` 中返回了一个自定义对象（比如 `Money`），单独访问属性时一切正常，但调用 `$model->toArray()` 或 `$model->toJson()` 时却报错或输出了意外的结果。

根本原因是 `toArray()` 的内部流程会尝试把 Cast 返回的对象进一步转换为数组。它依次检查对象是否实现了以下接口：`Arrayable`（调用 `toArray()`）、`JsonSerializable`（调用 `jsonSerialize()`）、`Jsonable`（调用 `toJson()`）。如果三个都不满足，对象会被原样放入数组，然后 `json_encode()` 可能无法正确序列化它。

### 5.2 解决方案

最直接的解决方案是让你的值对象实现 `JsonSerializable` 接口。这是 PHP 标准库提供的接口，`json_encode()` 会自动调用它的 `jsonSerialize()` 方法：

```php
// 让 Money 实现 JsonSerializable
final readonly class Money implements Stringable, JsonSerializable
{
    // ...之前的代码不变...

    /**
     * JsonSerializable 接口要求的方法
     * json_encode() 会自动调用它
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    public function toArray(): array
    {
        return [
            'cents' => $this->cents,
            'decimal' => $this->toDecimal(),
            'formatted' => $this->format(),
            'currency' => $this->currency,
        ];
    }
}
```

这样，当模型调用 `toJson()` 时，`Money` 对象会被正确序列化为：

```json
{
    "cents": 9990,
    "decimal": 99.9,
    "formatted": "¥99.90",
    "currency": "CNY"
}
```

如果你不实现 `JsonSerializable`，`json_encode()` 会尝试把对象转为公有属性的关联数组，结果可能是：

```json
{
    "cents": 9990,
    "currency": "CNY"
}
```

缺少了 `decimal` 和 `formatted` 这些计算属性，前端拿到的数据就少了一半。

---

## 六、参数化 Cast：带构造参数的 Cast 类

### 6.1 原理

Laravel 支持在 `$casts` 数组中直接实例化 Cast 类并传入构造参数。这意味着一个 Cast 类可以根据不同的参数处理不同类型的值，大大提高了复用性。

```php
protected function casts(): array
{
    return [
        // 无参数，使用类名
        'amount' => MoneyCast::class,

        // 带参数，使用实例
        'settings' => new TypedJsonCast(NotificationSettings::class),
        'metadata' => new TypedJsonCast(MetadataDTO::class),

        // 带多个参数
        'encrypted_ssn' => new EncryptedCast(algorithm: 'aes-256-gcm'),
        'encrypted_phone' => new EncryptedCast(algorithm: 'aes-128-cbc', compress: true),
    ];
}
```

Cast 类本质上就是一个普通 PHP 类，构造函数的参数在模型解析 `casts()` 方法时被传入。Laravel 的容器会自动处理这些实例化。

### 6.2 实战：参数化加密 Cast

```php
<?php

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Crypt;

/**
 * 参数化加密 Cast
 * 支持配置加密算法和是否压缩
 *
 * 用法示例：
 *   'ssn' => new EncryptedCast(),
 *   'medical_record' => new EncryptedCast(compress: true),
 *   'legacy_field' => new EncryptedCast(algorithm: 'aes-128-cbc'),
 */
class EncryptedCast implements CastsAttributes
{
    public function __construct(
        private readonly string $algorithm = 'aes-256-gcm',
        private readonly bool $compress = false,
    ) {}

    /**
     * 出库：解密
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if (is_null($value)) {
            return null;
        }

        try {
            $decrypted = Crypt::decryptString($value);

            // 如果启用了压缩，解压
            if ($this->compress) {
                return gzuncompress($decrypted);
            }

            return $decrypted;
        } catch (\Throwable $e) {
            // 解密失败时返回 null，避免整条记录读取失败
            // 在生产环境中，应该记录日志以便排查
            report($e);
            return null;
        }
    }

    /**
     * 入库：加密
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if (is_null($value)) {
            return null;
        }

        // 如果启用了压缩，先压缩再加密（对大文本效果显著）
        $processed = $this->compress ? gzcompress($value, 6) : $value;
        return Crypt::encryptString($processed);
    }
}
```

这个 Cast 类通过构造参数实现了灵活的配置：不同的字段可以使用不同的加密算法；对于大文本字段（如医疗记录）可以启用压缩来减少存储空间；解密失败时优雅降级返回 null 而不是抛出异常中断整个查询。

---

## 七、Eloquent 序列化管道源码剖析

理解 Cast 的最好方式是深入源码，看看数据从用户代码到数据库、再从数据库回到用户代码的完整管道。下面我们逐行追踪 Laravel 12 的源码。

### 7.1 数据入库流程（set 方向）

当调用 `$model->save()` 或 `$model::create()` 时，数据经过以下管道：

```
用户赋值 → setAttribute() → Cast set() → Dirty 检测 → Builder::insert/update → DB
```

让我们逐步追踪源码。

**第一步：`Model::setAttribute()`——属性赋值的入口**

当执行 `$model->amount = $money` 时，Laravel 的 `__set()` 魔术方法会调用 `setAttribute()`：

```php
// Illuminate\Database\Eloquent\Model
public function setAttribute($key, $value)
{
    // 第一优先级：检查是否有自定义的 Accessor（修改器）
    // 通过 method_exists($this, 'set'.Str::studly($key).'Attribute') 判断
    if ($this->hasSetMutator($key)) {
        return $this->setMutatedAttributeValue($key, $value);
    }

    // 第二优先级：检查是否有 Cast 定义
    if ($this->hasCast($key)) {
        // 这里会调用 Cast 的 set() 方法
        $this->attributes[$key] = $this->castAttribute($key, $value);
        return $this;
    }

    // 第三优先级：处理 JSON 路径访问（如 settings->theme）
    if (Str::contains($key, '->')) {
        return $this->fillJsonAttribute($key, $value);
    }

    // 最后：直接赋值
    $this->attributes[$key] = $value;

    return $this;
}
```

注意第一优先级是 Mutator/Accessor——如果你同时定义了 Cast 和同名的 Accessor，Accessor 会优先执行，Cast 会被完全跳过。这是一个常见的坑。

**第二步：`Model::castAttribute()` → `setCastAttribute()`——Cast 的实际执行**

```php
// Illuminate\Database\Eloquent\Concerns\HasAttributes
protected function castAttribute($key, $value)
{
    // getCastType() 返回 Cast 类名或内置类型字符串
    $castType = $this->getCastType($key);

    // 如果是自定义 Cast 类（不是内置的 int/bool/json 等）
    if ($this->isCustomCaster($castType)) {
        return $this->setCastAttribute($key, $value);
    }

    // 内置类型走各自的转换逻辑...
    // 这里省略内置类型的处理
}

protected function setCastAttribute($key, $value)
{
    // 解析 Cast 类实例
    $caster = $this->resolveCasterClass($key);

    // 根据接口类型调用 set()
    if ($caster instanceof CastsAttributes) {
        $this->attributes[$key] = $caster->set(
            $this, $key, $value, $this->getAttributes()
        );
    } elseif ($caster instanceof InboundCasts) {
        $this->attributes[$key] = $caster->set(
            $this, $key, $value, $this->getAttributes()
        );
    }
    // 注意：OutboundCasts 在 set 方向不生效

    return $this->attributes[$key];
}
```

**第三步：`resolveCasterClass()`——解析 Cast 类实例**

```php
protected function resolveCasterClass($key)
{
    $castType = $this->getCasts()[$key];

    // 如果已经是对象实例（如 new TypedJsonCast(Foo::class)），直接返回
    if (is_object($castType)) {
        return $castType;
    }

    // 否则实例化类名
    // 这就是为什么 casts() 中可以写 'amount' => MoneyCast::class
    return new $castType();
}
```

### 7.2 数据出库流程（get 方向）

```
数据库原始值 → PDO 绑定 → getAttribute() → castAttribute() → Cast get() → Mutator → 返回
```

**`Model::getAttribute()` → `getAttributeValue()`——属性读取的入口**

```php
// Illuminate\Database\Eloquent\Concerns\HasAttributes
public function getAttributeValue($key)
{
    // 第一步：检查是否是关系方法
    if ($this->hasRelation($key)) {
        return $this->getRelationValue($key);
    }

    // 第二步：从内部 attributes 数组获取原始值
    $value = $this->getAttributeFromArray($key);

    // 第三步：Cast 转换（最高优先级的类型转换）
    if ($this->hasCast($key)) {
        return $this->castAttribute($key, $value);
    }

    // 第四步：Accessor（访问器）
    if ($this->hasGetMutator($key)) {
        return $this->mutateAttribute($key, $value);
    }

    // 第五步：日期类型检查
    if ($value && $this->isDateAttribute($key)) {
        return $this->asDateTime($value);
    }

    return $value;
}
```

注意出库时 Cast 的优先级是高于 Accessor 的（第三步 vs 第四步），这与入库时相反（入库时 Accessor 优先）。这个不对称性容易造成困惑。

**`castAttribute()` 出库时的关键逻辑：**

```php
protected function castAttribute($key, $value)
{
    $castType = $this->getCastType($key);

    // null 值直接返回 null
    if (is_null($value) && in_array($castType, $this->nullableCastTypes())) {
        return null;
    }

    // 对内置类型做路由分发
    return match ($castType) {
        'int', 'integer' => (int) $value,
        'real', 'float', 'double' => (float) $value,
        'string' => (string) $value,
        'bool', 'boolean' => (bool) $value,
        'object' => $this->fromJson($value, true),
        'array', 'json' => $this->fromJson($value),
        'collection' => new BaseCollection($this->fromJson($value)),
        'date' => $this->asDate($value),
        'datetime', 'immutable_datetime' => $this->asDateTime($value),
        'timestamp' => $this->asTimestamp($value),
        // 其他内置类型...

        // 自定义 Cast 类走 default 分支
        default => $this->resolveCasterClass($key)->get(
            $this, $key, $value, $this->getAttributes()
        ),
    };
}
```

### 7.3 JSON 序列化流程（toArray / toJson）

当调用 `$model->toArray()` 或 API 返回 JSON 响应时，会触发完整的序列化管道：

```php
// Arrayable trait
public function toArray()
{
    return array_merge(
        $this->attributesToArray(),  // 处理普通属性
        $this->relationsToArray(),   // 处理关联关系
    );
}

// HasAttributes trait
public function attributesToArray()
{
    // 第一步：获取可数组化的属性
    $attributes = $this->getArrayableAttributes();

    // 第二步：遍历所有 Cast 定义，对有 Cast 的属性做转换
    foreach ($this->getCasts() as $key => $value) {
        if (!array_key_exists($key, $attributes)) {
            continue;
        }

        // 调用 Cast 的 get() 方法做出库转换
        $attributes[$key] = $this->castAttribute($key, $attributes[$key]);

        // 第三步：对 Cast 返回的对象做进一步序列化
        // 这一步非常关键，它决定了你的值对象在 JSON 中的表示形式
        if ($attributes[$key] instanceof Arrayable) {
            $attributes[$key] = $attributes[$key]->toArray();
        } elseif ($attributes[$key] instanceof JsonSerializable) {
            $attributes[$key] = $attributes[$key]->jsonSerialize();
        } elseif ($attributes[$key] instanceof Jsonable) {
            $attributes[$key] = json_decode($attributes[$key]->toJson(), true);
        }
        // 如果都不满足，对象被原样放入数组——这通常会导致问题
    }

    // 第四步：合并 Accessor 产生的额外字段
    foreach ($this->getMutatedAttributes() as $key) {
        if (!array_key_exists($key, $attributes)) {
            continue;
        }

        $attributes[$key] = $this->mutateAttributeForArray($key, $attributes[$key]);
    }

    return $attributes;
}
```

这就解释了为什么你的值对象需要实现 `Arrayable` 或 `JsonSerializable` 接口——不实现的话，`toArray()` 时对象会被原样放入数组，导致 `json_encode` 时出现类型错误或意外结构。更具体地说，PHP 的 `json_encode()` 在遇到未实现 `JsonSerializable` 的对象时，会尝试序列化所有公有属性，如果对象包含了不可序列化的资源或循环引用，就会导致 JSON 编码失败。

---

## 八、Laravel 11 vs 12 中 Casts 的变化

### 8.1 Laravel 11 的 Cast 体系

Laravel 11 是一个重要的里程碑版本，它引入了 `casts()` 方法替代了传统的 `$casts` 属性，提供了更好的类型提示和 IDE 支持。同时引入了 `CastsAttributes` 和 `CastsInboundAttributes` 两个核心接口。

```php
// Laravel 11 的典型写法
class User extends Model
{
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'options' => 'array',
        ];
    }
}
```

### 8.2 Laravel 12 的改进与变化

Laravel 12 在 Cast 体系上做了几个有意义的改进。以下表格详细对比了两个版本的差异：

| 特性 | Laravel 11 | Laravel 12 |
|------|-----------|-----------|
| `$casts` 数组属性 | 支持（推荐 `casts()` 方法） | 仍支持，但 `casts()` 是唯一推荐方式 |
| `CastsAttributes` | ✅ 双向 Cast | ✅ 双向 Cast |
| `CastsInboundAttributes` | ✅ 仅入库 Cast | ⚠️ 标记为 deprecated，推荐 `InboundCasts` |
| `InboundCasts` | ✅ 可用 | ✅ 推荐使用 |
| `OutboundCasts` | ✅ 可用 | ✅ 正式推荐 |
| `$casts` 中使用 `new` 实例化 | ✅ 支持 | ✅ 支持，类型提示更完善 |
| Cast 参数化 | ✅ 支持 | ✅ 支持，有更好的 IDE 补全 |
| `withoutCasting()` | ✅ 支持 | ✅ 支持 |
| Cast 与 Accessor 优先级 | Accessor 在入库时优先 | 行为不变，文档更清晰 |
| PHP 最低版本要求 | 8.2 | 8.3+ |

**变化一：接口名称规范化**

这是最重要的变化。`CastsInboundAttributes` 这个名字又长又不好记，Laravel 12 推荐使用更简洁的 `InboundCasts`。旧接口仍然存在但已被标记为废弃，在未来的版本中会被移除。

```php
// Laravel 11 风格（已废弃）
use Illuminate\Contracts\Database\Eloquent\CastsInboundAttributes;

class HashPassword implements CastsInboundAttributes
{
    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        return bcrypt($value);
    }
}

// Laravel 12 推荐风格
use Illuminate\Contracts\Database\Eloquent\InboundCasts;

class HashPassword implements InboundCasts
{
    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        return bcrypt($value);
    }
}
```

**变化二：`OutboundCasts` 正式推荐**

在 Laravel 11 中 `OutboundCasts` 就已存在，但文档中几乎没有提及，大多数开发者不知道它的存在。Laravel 12 的文档和官方博客中正式将其纳入推荐方案。

**变化三：更强的类型约束**

Laravel 12 充分利用了 PHP 8.3+ 的类型系统特性，Cast 方法的参数和返回值类型更加严格，配合现代 IDE（PhpStorm、VS Code + Intelephense）能提供更好的自动补全和类型检查。

### 8.3 迁移建议

如果你正在从 Laravel 11 升级到 12，建议按以下步骤处理 Cast 相关的迁移：

第一步，全局搜索 `CastsInboundAttributes`，替换为 `InboundCasts`。这可以通过 IDE 的全局替换或 Rector 来自动化完成。

第二步，检查所有自定义 Cast 类，确保 null 值处理是一致的。Laravel 12 对 null 值的处理更加严格。

第三步，验证所有值对象都实现了 `JsonSerializable` 或 `Arrayable` 接口，确保 `toArray()` 和 `toJson()` 正常工作。

第四步，运行完整的测试套件，特别关注模型的序列化输出。

---

## 九、实战案例：枚举 Cast 的正确姿势

### 9.1 PHP 8.1+ 原生枚举 + Cast

Laravel 12 内置了对 PHP 8.1+ BackedEnum 的 Cast 支持，你只需要在 `casts()` 中写上枚举类名即可：

```php
<?php

namespace App\Enums;

/**
 * 订单状态枚举
 * 使用 string-backed 枚举，值与数据库存储一致
 */
enum OrderStatus: string
{
    case Pending = 'pending';
    case Processing = 'processing';
    case Shipped = 'shipped';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';

    /**
     * 中文标签
     */
    public function label(): string
    {
        return match ($this) {
            self::Pending => '待处理',
            self::Processing => '处理中',
            self::Shipped => '已发货',
            self::Delivered => '已送达',
            self::Cancelled => '已取消',
        };
    }

    /**
     * 颜色标识
     */
    public function color(): string
    {
        return match ($this) {
            self::Pending => '#f0ad4e',
            self::Processing => '#5bc0de',
            self::Shipped => '#5cb85c',
            self::Delivered => '#337ab7',
            self::Cancelled => '#d9534f',
        };
    }

    /**
     * 允许的状态转换
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Pending => [self::Processing, self::Cancelled],
            self::Processing => [self::Shipped, self::Cancelled],
            self::Shipped => [self::Delivered, self::Cancelled],
            self::Delivered => [],
            self::Cancelled => [],
        };
    }

    /**
     * 是否可以转换到目标状态
     */
    public function canTransitionTo(self $target): bool
    {
        return in_array($target, $this->allowedTransitions(), true);
    }
}
```

模型中直接使用枚举类名作为 Cast：

```php
class Order extends Model
{
    protected function casts(): array
    {
        return [
            'status' => OrderStatus::class,    // Laravel 内置支持
            'priority' => Priority::class,      // 同样适用于 int-backed 枚举
        ];
    }
}
```

Laravel 内部实际上使用了一个内部的枚举处理器来处理这个转换。简化后的源码逻辑如下：

```php
// Laravel 框架内部的枚举 Cast 处理逻辑（简化版）
// 实际实现更复杂，这里只展示核心思路

// 出库
if ($value !== null && enum_exists($castType)) {
    // BackedEnum::from() 如果找不到匹配值会抛异常
    // 所以 Laravel 内部用的是 tryFrom()，找不到返回 null
    return $castType::tryFrom($value);
}

// 入库
if ($value instanceof $castType) {
    // BackedEnum 有 value 属性
    return $value->value;
}
// 如果传入的是原始值，尝试转换
return $castType::from($value)->value;
```

### 9.2 自定义枚举 Cast：带额外元数据的序列化

Laravel 内置的枚举 Cast 只会输出枚举的原始值（如 `'pending'`）。但在前端渲染时，你通常还需要标签、颜色等元数据。这时可以自定义一个 Cast：

```php
<?php

namespace App\Casts;

use App\Enums\OrderStatus;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * 带元数据的订单状态 Cast
 * toArray() 时输出完整的枚举信息
 */
class OrderStatusCast implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): OrderStatus
    {
        return OrderStatus::from($value);
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        if ($value instanceof OrderStatus) {
            return $value->value;
        }

        // 支持传入字符串值
        return OrderStatus::from($value)->value;
    }
}
```

然后让 `OrderStatus` 实现 `JsonSerializable`，在 `jsonSerialize` 中返回完整信息：

```php
// 在 OrderStatus 枚举中添加
enum OrderStatus: string implements \JsonSerializable
{
    // ...之前的代码不变...

    public function jsonSerialize(): array
    {
        return [
            'value' => $this->value,
            'label' => $this->label(),
            'color' => $this->color(),
        ];
    }
}
```

这样 `toArray()` 时输出的就是：

```json
{
    "status": {
        "value": "pending",
        "label": "待处理",
        "color": "#f0ad4e"
    }
}
```

---

## 十、踩坑记录与最佳实践

在实际项目中使用自定义 Cast 时，我踩过不少坑。这里把最有代表性的几个记录下来，希望能帮你避免同样的问题。

### 坑 1：Cast 与 Mutator 的优先级陷阱

入库时 Mutator 优先于 Cast，出库时 Cast 优先于 Mutator。这个不对称性是一个常见的困惑来源。

```php
class User extends Model
{
    protected function casts(): array
    {
        return ['email' => NormalizedEmail::class];
    }

    // 注意：入库时这个 Accessor 优先级高于 Cast！
    // Cast 的 set() 根本不会被执行！
    public function setEmailAttribute($value): void
    {
        $this->attributes['email'] = strtolower($value);
    }

    // 出库时 Cast 优先于这个 Accessor
    // Cast 的 get() 会先执行，返回的是数据库原始值
    public function getEmailAttribute($value): string
    {
        return strtoupper($value); // 这个会覆盖 Cast 的 get 输出
    }
}
```

建议二选一，不要混用 Cast 和同名 Accessor。如果确实需要两层转换，用 Cast 包含所有逻辑，或者用 Accessor 包含所有逻辑。

### 坑 2：Cast 中不要触发模型保存或其他副作用

Cast 是一个纯转换层，它应该只做数据格式的转换，不应该有任何副作用。以下是一个反面示例：

```php
// ❌ 危险：Cast 的 get 中触发了 save，会导致无限循环
public function get(Model $model, string $key, mixed $value, array $attributes): mixed
{
    $result = $this->decode($value);

    // 不要在 Cast 中做这种事！
    // $model->update(['cached_decoded' => $result]);  // 会再次触发 set → 死循环
    // event(new DataDecoded($model));                   // 不应该在转换层发事件
    // Cache::put("model_{$model->id}_{$key}", $result); // 不应该在 Cast 中做缓存

    return $result;
}
```

### 坑 3：`$attributes` 包含的是原始值

在 Cast 的 `get()` 方法中，`$attributes` 数组包含的是**未经 Cast 处理的原始数据库值**。这是一个非常容易犯错的地方。

```php
public function get(Model $model, string $key, mixed $value, array $attributes): mixed
{
    // $attributes['other_casted_field'] 是原始值，不是 Cast 后的对象
    // 如果 other_casted_field 的 Cast 会把字符串转为对象
    // 这里拿到的仍然是原始字符串

    // ✅ 安全：读取不需要 Cast 的原始字段（如 currency 字段）
    $currency = $attributes['currency'] ?? 'CNY';

    // ⚠️ 需要注意：读取需要 Cast 的字段的原始值
    $rawStatus = $attributes['status']; // 可能是 'pending' 字符串

    // ❌ 不建议：通过 $model 访问其他 Cast 属性
    // 这可能触发另一个 Cast 的 get()，造成循环依赖或 N+1 问题
    // $status = $model->status; // 可能触发 OrderStatusCast::get()

    return new Money((int) $value, $currency);
}
```

### 坑 4：null 值处理不当导致的空指针

这是生产环境中最常见的 Cast 崩溃原因之一。数据库中的字段经常是可空的，但 Cast 的开发者往往只考虑了正常值的转换，忽略了 null 的情况。

```php
// ❌ 错误：没有处理 null
public function get(Model $model, string $key, mixed $value, array $attributes): Money
{
    return new Money((int) $value, $attributes['currency'] ?? 'CNY');
    // 如果 $value 是 null，(int) null = 0，返回 Money(0)，语义错误
    // 用户的余额从 null（未设置）变成了 0（已设置但为空），逻辑完全不同
}

// ✅ 正确：显式处理 null
public function get(Model $model, string $key, mixed $value, array $attributes): ?Money
{
    if (is_null($value)) {
        return null; // 保持 null，不要转为零值
    }
    return new Money((int) $value, $attributes['currency'] ?? 'CNY');
}
```

### 坑 5：Cast 的 set() 返回值类型与数据库列类型不匹配

这个坑比较隐蔽，通常不会在开发阶段暴露，而是在数据量增大或使用特定数据库驱动时才出现。

```php
// ❌ 潜在问题：set() 返回字符串，但数据库列是 BIGINT
public function set(Model $model, string $key, mixed $value, array $attributes): string
{
    return (string) $value; // 返回 "9990"，但数据库期望整数 9990
}

// ✅ 正确：返回值类型与数据库列类型一致
public function set(Model $model, string $key, mixed $value, array $attributes): int
{
    return (int) $value; // 返回 9990，匹配 BIGINT 列
}
```

### 最佳实践清单

基于以上踩坑经验和社区的最佳实践，这里给出一份可操作的清单：

1. **Cast 类应该是无状态的**——除了构造函数参数，不要存储任何实例变量。Eloquent 可能在请求生命周期内多次复用同一个 Cast 实例。

2. **使用 `readonly` 修饰符**——PHP 8.2+ 支持 `readonly` 类，可以防止意外修改。Cast 类的所有构造参数都应该是 `readonly` 的。

3. **值对象必须实现 `JsonSerializable`**——这是确保 `toJson()` 正常工作的最可靠方式。`Arrayable` 也可以，但 `JsonSerializable` 是 PHP 原生接口，兼容性更好。

4. **使用参数化 Cast**——不要在一个 Cast 类中硬编码多种行为，而是通过构造参数让 Cast 类可配置。`new TypedJsonCast(Foo::class)` 比写多个类似的 Cast 类好得多。

5. **始终处理 null 值**——在 `get()` 和 `set()` 中都要处理 null，保持语义一致性。数据库中的 NULL 和零值（如空字符串、0、空数组）在业务语义上是完全不同的。

6. **set() 的返回值类型要与数据库列类型匹配**——BIGINT 列返回 `int`，TEXT 列返回 `string`，JSON 列返回 JSON 字符串。类型不匹配可能导致 PDO 绑定异常或数据截断。

7. **一个 Cast 类只做一件事**——遵循单一职责原则。如果一个 Cast 类需要处理多种数据类型或多种转换逻辑，说明它应该被拆分。

8. **Cast 和 Accessor 不要同时使用**——选其一即可。混用会导致优先级困惑和维护困难。

9. **编写独立的单元测试**——Cast 类应该有独立的测试，覆盖正常值、null 值、边界值、非法输入等场景。不要只在模型测试中间接验证 Cast 行为。

10. **在 Cast 中避免调用 `$model` 的属性访问器**——这可能触发其他 Cast 的执行，造成循环依赖或意想不到的性能问题。如果确实需要，通过 `$model->getRawOriginal()` 方法获取原始值。

---

## 十一、完整实战：端到端示例

下面展示一个完整的用户模型示例，综合运用本文介绍的多种 Cast 技术。这个例子涵盖了值对象、DTO、枚举、加密等典型场景：

```php
<?php

namespace App\Models;

use App\Casts\EncryptedCast;
use App\Casts\MoneyCast;
use App\Casts\TypedJsonCast;
use App\DTOs\NotificationSettings;
use App\Enums\OrderStatus;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    protected $table = 'users';

    protected function casts(): array
    {
        return [
            // 内置类型——Laravel 自动处理
            'email_verified_at' => 'datetime',
            'password' => 'hashed',

            // 值对象 Cast——数据库整数 ↔ Money 对象
            'balance' => MoneyCast::class,

            // 参数化 JSON Cast——数据库 JSON ↔ 强类型 DTO
            'notification_settings' => new TypedJsonCast(NotificationSettings::class),

            // 参数化加密 Cast——入库加密，出库解密
            'id_number' => new EncryptedCast(compress: true),

            // 枚举 Cast——数据库字符串 ↔ PHP 枚举
            'status' => OrderStatus::class,
        ];
    }
}
```

对应的数据库迁移：

```php
Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('email')->unique();
    $table->timestamp('email_verified_at')->nullable();
    $table->string('password');
    $table->bigInteger('balance')->default(0);           // MoneyCast: 分为单位
    $table->string('currency', 3)->default('CNY');       // MoneyCast 读取此字段确定币种
    $table->json('notification_settings')->nullable();   // TypedJsonCast
    $table->text('id_number')->nullable();               // EncryptedCast: 密文存储
    $table->string('status')->default('pending');        // OrderStatus 枚举
    $table->timestamps();
});
```

完整的业务代码示例——从创建到查询到序列化，展示 Cast 在每个环节的作用：

```php
use App\ValueObjects\Money;
use App\DTOs\NotificationSettings;
use App\Enums\OrderStatus;

// ========== 创建用户 ==========
$user = User::create([
    'name' => '张三',
    'email' => '  Zhang.San@EXAMPLE.com  ',         // NormalizedEmail Cast: 自动 trim + lowercase
    'password' => 'secret-password',                  // Hashed Cast: 自动 bcrypt
    'balance' => Money::fromDecimal(1000.50),         // MoneyCast: 存为 100050（分）
    'currency' => 'CNY',
    'notification_settings' => new NotificationSettings(
        smsEnabled: true,
        pushEnabled: false,
    ),
    'id_number' => '110101199001011234',              // EncryptedCast: AES 加密后存储
    'status' => OrderStatus::Pending,
]);

// ========== 读取用户 ==========
$user = User::find(1);

// Money 对象——可以直接调用方法和属性
echo $user->balance->format();        // ¥1,000.50
echo $user->balance->cents;           // 100050
echo $user->balance->currency;        // CNY

// DTO 对象——有完整的类型提示和自动补全
echo $user->notification_settings->emailEnabled; // true
echo $user->notification_settings->quietHoursStart; // 22:00

// 枚举——直接调用枚举方法
echo $user->status->label();          // 待处理
echo $user->status->color();          // #f0ad4e
var_dump($user->status === OrderStatus::Pending); // true

// ========== 修改用户 ==========
$user->update([
    // Money 运算
    'balance' => $user->balance->add(Money::fromDecimal(500.00)),
    // 枚举状态转换
    'status' => OrderStatus::Processing,
]);

// ========== JSON 输出（API 响应） ==========
return response()->json($user);
// 输出示例（部分字段）：
// {
//   "balance": {"cents": 150050, "decimal": 1500.50, "formatted": "¥1,500.50", "currency": "CNY"},
//   "notification_settings": {"email_enabled": true, "sms_enabled": true, "push_enabled": false, ...},
//   "status": {"value": "processing", "label": "处理中", "color": "#5bc0de"},
//   "id_number": "解密后的身份证号",
//   ...
// }
```

---

## 总结

Laravel 12.x 的 Cast 体系已经非常成熟和完善，三个接口覆盖了所有数据转换场景：

- **`CastsAttributes`**：双向转换，最常用的接口，适合值对象、DTO、强类型 JSON、加密字段等需要读写双向转换的场景。
- **`InboundCasts`**：仅入库转换，适合数据清洗、密码哈希、规范化、单向加密等只需要在写入时做处理的场景。
- **`OutboundCasts`**：仅出库转换，适合兼容旧数据格式、只读计算字段、外部数据源对接等只需要在读取时做处理的场景。

理解 Eloquent 的序列化管道是正确使用 Cast 的关键。数据从用户代码到数据库的完整路径是：`setAttribute()` → `castAttribute()` → Cast `set()` → `$attributes` 数组 → `Builder` → 数据库。反方向则是：数据库 → PDO → `$attributes` 数组 → `getAttribute()` → `castAttribute()` → Cast `get()` → PHP 对象 → `toArray()`/`toJson()` 序列化。

记住 Cast 是**纯转换层**——它不应该是有状态的，不应该有副作用，应该正确处理 null 值，返回类型应该与数据库列类型匹配。将业务逻辑封装到值对象和 DTO 中，用 Cast 做胶水层连接 Eloquent 和领域模型，这是 Laravel 高质量应用的常见模式，也是本文推荐的架构实践。

---

> **参考文档**
>
> - [Laravel 12.x 官方文档 - Eloquent: Mutators](https://laravel.com/docs/12.x/eloquent-mutators)
> - [Laravel 12.x 源码 - `Illuminate\Database\Eloquent\Concerns\HasAttributes`](https://github.com/laravel/framework/blob/12.x/src/Illuminate/Database/Eloquent/Concerns/HasAttributes.php)
> - [Laravel 12.x 源码 - `Illuminate\Contracts\Database\Eloquent`](https://github.com/laravel/framework/tree/12.x/src/Illuminate/Contracts/Database/Eloquent)
> - [PHP 8.1 BackedEnum RFC](https://wiki.php.net/rfc/backed_enums)
> - [PHP JsonSerializable 接口文档](https://www.php.net/manual/en/class.jsonserializable.php)

---

## 相关阅读

- [PHP 8 Trait + Enum 重构实战：Laravel 30 个设计模式最佳实践](/categories/Laravel/php-8-trait-enum-laravel-30/)
- [Rector 自动化重构指南：Laravel 30 大代码升级范式](/categories/Laravel/rector-php-automationguide-laravel-30/)
- [PHP Fiber 协程并发编程指南：从零实现 Laravel 并发 API 调用](/categories/Laravel/php-fiber-concurrencyguide-laravel-concurrencyapi/)
