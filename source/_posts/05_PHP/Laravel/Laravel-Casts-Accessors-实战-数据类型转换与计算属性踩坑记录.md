---
title: Laravel-Casts-Accessors-实战-数据类型转换与计算属性踩坑记录
date: 2026-05-05 12:25:26
updated: 2026-05-05 12:27:45
categories:
  - 05_PHP
  - Laravel
tags:
  - Laravel
  - Eloquent
  - Casts
  - Accessors
  - Attribute
  - API 设计
description: 在 Laravel B2C API 项目里，Casts 与 Accessors 用得好可以把金额、时间、快照字段和响应格式统一；用不好则会制造精度丢失、N+1 与序列化性能问题。本文从订单模型实战出发，拆解数据类型转换、计算属性设计和线上踩坑修复策略。
---

# Laravel Casts & Accessors 实战：数据类型转换与计算属性踩坑记录

在 B2C API 里，`Eloquent Model` 最容易失控的地方不是查询本身，而是“数据库值进来以后到底应该长什么样”。订单金额到底是 `decimal`、`int cents` 还是 Value Object？`paid_at` 到底要不要强制 UTC？前端想拿一个 `buyer_summary` 字段，是放 SQL、Accessor 还是 Resource？

我在订单、支付、退款三类模块里踩过不少坑，最后总结出一个原则：**Casts 负责持久化格式转换，Accessors 负责轻量只读投影，复杂展示逻辑放 Resource 或 DTO，不要全塞进 Model。**

## 一、先看落地架构

```text
┌──────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ Controller   │ ---> │ OrderQueryService│ ---> │   Order Model     │
└──────────────┘      └──────────────────┘      └──────────────────┘
                                                          │
                                               DB columns │ total_amount_cents
                                                          │ currency
                                                          │ snapshot(json)
                                                          │ paid_at(utc)
                                                          ▼
                                               ┌──────────────────┐
                                               │ Casts Layer       │
                                               │ - MoneyCast       │
                                               │ - immutable_date  │
                                               │ - array/json      │
                                               └──────────────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────┐
                                               │ Accessors Layer   │
                                               │ - total_label     │
                                               │ - buyer_summary   │
                                               └──────────────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────┐
                                               │ API Resource      │
                                               │ 最终输出给前端     │
                                               └──────────────────┘
```

这个分层的关键价值，是把“存储格式”和“输出格式”拆开。数据库可以继续保存最稳定、最好索引的结构，但业务层拿到的是更安全的对象。

## 二、用自定义 Cast 解决金额精度和 JSON 快照混乱

订单金额如果直接存 `decimal(10,2)`，在 PHP 里参与折扣、退款、汇率换算时很容易混进浮点误差。我最后统一改成“分”为单位的整数，并用自定义 Cast 转成值对象：

```php
<?php

namespace App\Values;

final class Money
{
    public function __construct(
        public readonly int $amount,
        public readonly string $currency,
    ) {}

    public function format(): string
    {
        return sprintf('%s %.2f', $this->currency, $this->amount / 100);
    }
}
```

```php
<?php

namespace App\Casts;

use App\Values\Money;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

final class MoneyCast implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): Money
    {
        return new Money(
            amount: (int) $attributes['total_amount_cents'],
            currency: $attributes['currency'] ?? 'TWD',
        );
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): array
    {
        if (! $value instanceof Money) {
            throw new InvalidArgumentException('total_amount must be instance of Money');
        }

        return [
            'total_amount_cents' => $value->amount,
            'currency' => $value->currency,
        ];
    }
}
```

然后在 `Order` 模型里统一声明：

```php
<?php

namespace App\Models;

use App\Casts\MoneyCast;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $appends = ['total_label', 'buyer_summary'];

    protected function casts(): array
    {
        return [
            'total_amount' => MoneyCast::class,
            'snapshot' => 'array',
            'paid_at' => 'immutable_datetime',
        ];
    }

    protected function totalLabel(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->total_amount->format(),
        );
    }

    protected function buyerSummary(): Attribute
    {
        return Attribute::make(
            get: fn () => sprintf(
                '%s <%s>',
                data_get($this->snapshot, 'buyer.name', 'guest'),
                data_get($this->snapshot, 'buyer.email', 'n/a'),
            ),
        );
    }
}
```

这段代码在线上最大的价值，不是“写法优雅”，而是**Controller、Service、Resource 从此不再关心 cents 与 json path 细节**。

## 三、真正的边界：Accessor 只能做轻计算，不能做 I/O

很多团队第一次用 Accessor，很容易写出这种代码：

```php
protected function latestOperatorName(): Attribute
{
    return Attribute::make(
        get: fn () => $this->logs()->latest()->value('operator_name')
    );
}
```

单笔详情页没事，但后台列表一次拉 100 笔订单，就会额外打 100 次 SQL，标准 N+1。这个坑我在退款工单列表里踩过，接口从 180ms 直接涨到 2.4s。

正确做法有两个：

1. 要么在查询层先 `with()` 或 join 把数据拿齐；
2. 要么把展示逻辑挪到 `JsonResource`，只消费已经准备好的字段。

例如：

```php
public function toArray($request): array
{
    return [
        'id' => $this->id,
        'order_no' => $this->order_no,
        'total_amount' => $this->total_amount->format(),
        'buyer_summary' => $this->buyer_summary,
        'paid_at' => optional($this->paid_at)?->setTimezone('Asia/Taipei')->toDateTimeString(),
    ];
}
```

## 四、三个真实踩坑记录

### 1. 金额 Cast 写对了，筛选却全坏了

我们曾把 `total_amount` 做成值对象后，忘记后台筛选仍然是 `where('total_amount', '>', 1000)`。结果 SQL 实际根本没有这个字段，线上直接报错。修复方式是：**查询条件永远基于真实列名**，也就是 `total_amount_cents`。

### 2. `appends` 在列表接口很好用，在导出接口很致命

`$appends` 会参与每一条模型序列化。订单导出 5 万笔时，即使 `buyer_summary` 只是字符串拼接，也会放大 CPU 开销。后面我们把导出改成：查询时 `setAppends([])`，导出 DTO 自己拼字段，CPU 直接降了接近 30%。

### 3. 时间字段 cast 成 `datetime` 后被前端误解时区

`paid_at` 存 UTC，本地开发却默认 `Asia/Taipei`，导致测试环境“看起来正确”，一到海外站就错 8 小时。后来统一规则：**数据库只存 UTC，Model cast 成 `immutable_datetime`，最终显示时区只在 Resource 转换。**

## 五、我现在的落地准则

- **Casts**：只处理数据库字段到 PHP 类型的转换，尤其适合金额、枚举、JSON、加密字段。
- **Accessors**：只做零 I/O、零副作用的轻量计算，不查库、不打 API、不读 Redis。
- **复杂响应字段**：放到 `Resource/DTO`，不要让 Model 变成万能格式化工厂。
- **列表性能**：谨慎使用 `$appends`，大批量场景最好显式关闭。
- **查询过滤**：永远使用真实列名，不要对 Cast 后的“虚拟语义字段”直接写 SQL 条件。

Casts 与 Accessors 真正的价值，不是语法糖，而是让领域模型保持稳定的输入输出边界。它们用得好，Model 会更像一个可靠的数据适配层；用不好，就会变成隐藏 SQL、隐藏时区、隐藏性能问题的黑箱。

如果你正在重构一批历史 Laravel 代码，我会建议优先先做三件事：金额整型化、时间 UTC 化、重计算字段从 Accessor 迁出。通常这三刀下去，Bug 和误解会先少一半。
