---

title: Laravel-Casts-Accessors-实战-数据类型转换与计算属性踩坑记录
keywords: [Laravel, Casts, Accessors, 数据类型转换与计算属性踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 12:25:26
updated: 2026-05-05 12:27:45
categories:
- php
tags:
- Laravel
- Eloquent
- 数据类型
- PHP
- Casts
- Accessors
- Value Object
description: 深入 Laravel Casts 与 Accessors 的数据类型转换实战，涵盖内置类型（decimal、encrypted、array、枚举）与自定义 Cast 值对象的完整用法。从订单模型真实案例出发，拆解 Accessor 计算属性设计、可写属性、多字段合并等模式，并对比 Casts vs Accessors vs Resources vs DTOs 的选型决策。附带精度丢失、N+1 查询、时区偏移、序列化性能等线上踩坑记录与优化方案，助你打造更干净的 Eloquent 数据适配层。
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

这个分层的关键价值，是把"存储格式"和"输出格式"拆开。数据库可以继续保存最稳定、最好索引的结构，但业务层拿到的是更安全的对象。

## 二、内置 Cast 类型速查与代码示例

在写自定义 Cast 之前，先搞清楚 Laravel 内置的 Cast 类型能覆盖多少场景。很多坑其实来自"不知道内置的已经够用"。

### 2.1 数值与精度：`decimal` vs `integer`

```php
// ❌ 浮点数直接存数据库 — 精度丢失重灾区
protected $casts = [
    'price' => 'float',       // 19.99 可能变成 19.989999999999995
    'discount_rate' => 'float',
];

// ✅ 推荐方案 1：存整数（分），Cast 成 Money 值对象
protected function casts(): array
{
    return [
        'total_amount_cents' => 'integer',  // 纯整数，无精度问题
        'discount_rate' => 'decimal:4',     // 强制保留 4 位小数
    ];
}
```

> **精度损失实战案例**：某电商项目用 `decimal(10,2)` 存价格，PHP 里做 `0.1 + 0.2` 得到 `0.30000000000000004`，前端显示 `¥0.30` 时用了四舍五入看似正确，但后端对账时 `1000 * 0.3` 得到 `299.99999999999994`，和实际 `300` 不一致，导致财务报表差了几分钱。**解法：金额一律用整数（分）存储，绝不存浮点。**

### 2.2 数组与 JSON：`array` / `json` / `encrypted`

```php
protected function casts(): array
{
    return [
        // 从 JSON 字段读写 — 自动 json_encode / json_decode
        'metadata' => 'array',
        'settings' => 'json',
        
        // 加密存储 — 读取时自动解密，写入时自动加密
        'api_secret' => 'encrypted',
        'credit_card_token' => 'encrypted:array',  // 加密 + JSON
    ];
}
```

`encrypted` Cast 依赖 `APP_KEY`，适用于敏感配置、Token 等字段。注意：**加密字段无法直接用 SQL 做 `WHERE` 过滤**，只能全量取出后在 PHP 层筛选。

### 2.3 日期时间：`datetime` / `immutable_datetime`

```php
protected function casts(): array
{
    return [
        // 可变 Carbon 对象 — 默认行为
        'created_at' => 'datetime',
        
        // 不可变 CarbonImmutable — 推荐，避免意外修改
        'paid_at' => 'immutable_datetime',
        
        // 只关心日期，不关心时间
        'birthday' => 'date',
        
        // 自定义格式
        'expires_at' => 'datetime:Y-m-d',
    ];
}
```

> **时区陷阱**：数据库存 UTC，`config/app.php` 的 `timezone` 设 `UTC`，在 Resource 里再转换目标时区。永远不要在 Model 层 `->setTimezone()`，否则序列化时会出现不可预测的偏移。

### 2.4 布尔值与枚举

```php
// PHP 8.1+ 原生枚举 Cast
protected function casts(): array
{
    return [
        'status' => OrderStatus::class,   // backed enum
        'is_active' => 'boolean',          // 0/1 → true/false
    ];
}

enum OrderStatus: string
{
    case Pending   = 'pending';
    case Paid      = 'paid';
    case Shipped   = 'shipped';
    case Cancelled = 'cancelled';
}
```

枚举 Cast 是 Laravel 10+ 的杀手级特性。数据库存字符串 `paid`，PHP 层直接拿到 `OrderStatus::Paid` 枚举实例，配合 `match` 表达式做状态流转，比 string 比较安全得多。

## 三、用自定义 Cast 解决金额精度和 JSON 快照混乱

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

## 四、Accessor 进阶：计算属性、可写属性与多字段合并

Laravel 11 的 Accessor 语法用 `Attribute::make()` 替代了旧的 `getXxxAttribute()` 写法，更清晰也更容易组合。

### 4.1 只读计算属性

最简单的场景：从已有字段派生展示值。

```php
protected function totalLabel(): Attribute
{
    return Attribute::make(
        get: fn () => $this->total_amount->format(),
    );
}

// 在模板中使用：$order->total_label → "TWD 299.00"
```

### 4.2 可写 Accessor（Set Mutator）

当需要在赋值时做转换，比如前端传 `"active"` 但数据库存 `1`：

```php
use Illuminate\Database\Eloquent\Casts\Attribute;

protected function isActive(): Attribute
{
    return Attribute::make(
        get: fn (string $value) => in_array($value, ['active', '1', 'true', true]),
        set: fn (bool $value) => ['is_active' => $value ? 1 : 0],
    );
}

// $user->isActive = true;  → 数据库存 1
// $user->isActive;         → 返回 true
```

### 4.3 多字段合并 Accessor

一个 Accessor 读取多个数据库字段，对外只暴露一个虚拟字段：

```php
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
```

### 4.4 `$appends` vs `$hidden` 控制序列化

```php
class Order extends Model
{
    // 这些字段会自动出现在 toArray() / toJson() 中
    protected $appends = ['total_label', 'buyer_summary'];
    
    // 这些字段会被排除（敏感数据）
    protected $hidden = ['internal_notes', 'cost_price_cents'];
    
    // 虚拟字段 — 不是数据库列，但可被 Accessor 定义
    protected function costPriceCents(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->total_amount_cents - $this->profit_cents,
        );
    }
}
```

> **注意**：`$appends` 会在每条模型序列化时触发对应的 Accessor。列表页拉 500 条时，如果有 3 个 appends，就会执行 1500 次 Accessor 计算。对于轻量计算没问题，但如果涉及关联查询就会变成 N+1 地狱。

## 五、Casts vs Accessors vs Resources vs DTOs：四者对比表

很多 Laravel 开发者搞不清这四个概念的边界，导致所有逻辑都塞进 Model，最终变成一个几百行的 God Model。

| 维度 | Casts | Accessors | API Resources | DTOs (spatie/laravel-data) |
|------|-------|-----------|---------------|---------------------------|
| **职责** | 数据库值 ↔ PHP 类型 | 虚拟计算字段 | 响应格式输出 | 请求验证 + 响应格式 |
| **触发时机** | Eloquent 读写时 | `toArray()` / 属性访问时 | `toArray()` 显式调用 | 请求/响应转换时 |
| **有无 I/O** | 无 | 必须无 | 可以有（但不推荐） | 可以有 |
| **能否写 SQL** | 能（基于真实列名） | ❌ | ❌ | ❌ |
| **典型场景** | 金额值对象、枚举、加密、JSON | `full_name`、`total_label` | API 响应标准化 | 表单验证 + 响应格式化 |
| **性能影响** | 每次读写都触发 | 仅属性访问时触发 | 显式调用时 | 显式调用时 |
| **推荐复杂度** | 简单类型转换 | 轻量计算（无 I/O） | 复杂展示逻辑 | 跨层数据传递 |

**选择决策树**：

```
需要转换数据库字段类型？
├── 是 → 用 Cast（金额、枚举、加密、JSON）
└── 否 → 需要计算虚拟字段？
    ├── 轻量计算（字符串拼接、格式化）→ 用 Accessor
    └── 需要关联查询 / 外部 API？
        ├── API 响应 → 用 Resource
        └── 跨层传递 → 用 DTO
```

## 六、性能优化：大数据量场景实战

### 6.1 $appends 在导出时关闭

```php
// ✅ 导出场景：关闭所有 appends
$orders = Order::query()
    ->setAppends([])  // 关闭虚拟字段，减少计算
    ->select(['id', 'order_no', 'total_amount_cents', 'status', 'paid_at'])
    ->cursor()        // 用 cursor 替代 get，减少内存占用
    ->each(function ($order) use ($handle) {
        fputcsv($handle, [
            $order->id,
            $order->order_no,
            $order->total_amount_cents / 100,
            $order->status,
        ]);
    });
```

### 6.2 批量序列化避免 N+1

```php
// ❌ 每条记录触发独立的 Accessor → N+1
$orders = Order::all();
foreach ($orders as $order) {
    $order->total_label;  // 每次都重新计算
}

// ✅ 预加载 + 批量计算
$orders = Order::with(['items', 'payments'])->get();
$orders->each(function ($order) {
    $order->total_label;  // 只计算一次
});
```

### 6.3 加密字段的性能代价

`encrypted` Cast 每次读取都执行 AES 解密。如果有大量加密字段，建议：

```php
// ❌ 全量加密 — 每行每个字段都解密
protected function casts(): array
{
    return [
        'secret_1' => 'encrypted',
        'secret_2' => 'encrypted',
        'secret_3' => 'encrypted',
    ];
}

// ✅ 只加密真正敏感的字段
protected function casts(): array
{
    return [
        'api_secret' => 'encrypted',  // 只有这个需要加密
        'config' => 'json',           // 非敏感，不加密
    ];
}
```

### 6.4 序列化时排除大字段

```php
// 列表接口排除 snapshot（可能几十 KB）
$orders = Order::query()
    ->select(['id', 'order_no', 'total_amount_cents', 'status'])
    ->get();

// 或者用 $hidden 临时隐藏
class OrderResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->id,
            'total_amount' => $this->total_amount->format(),
            // snapshot 太大，列表不返回
        ];
    }
}
```

## 七、真正的边界：Accessor 只能做轻计算，不能做 I/O

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

## 八、三个真实踩坑记录

### 1. 金额 Cast 写对了，筛选却全坏了

我们曾把 `total_amount` 做成值对象后，忘记后台筛选仍然是 `where('total_amount', '>', 1000)`。结果 SQL 实际根本没有这个字段，线上直接报错。修复方式是：**查询条件永远基于真实列名**，也就是 `total_amount_cents`。

### 2. `appends` 在列表接口很好用，在导出接口很致命

`$appends` 会参与每一条模型序列化。订单导出 5 万笔时，即使 `buyer_summary` 只是字符串拼接，也会放大 CPU 开销。后面我们把导出改成：查询时 `setAppends([])`，导出 DTO 自己拼字段，CPU 直接降了接近 30%。

### 3. 时间字段 cast 成 `datetime` 后被前端误解时区

`paid_at` 存 UTC，本地开发却默认 `Asia/Taipei`，导致测试环境“看起来正确”，一到海外站就错 8 小时。后来统一规则：**数据库只存 UTC，Model cast 成 `immutable_datetime`，最终显示时区只在 Resource 转换。**

## 九、落地准则速查清单

经过多个项目验证，以下是我现在严格遵守的规则：

- **Casts**：只处理数据库字段到 PHP 类型的转换，尤其适合金额、枚举、JSON、加密字段。不要在 Cast 里做业务逻辑。
- **Accessors**：只做零 I/O、零副作用的轻量计算，不查库、不打 API、不读 Redis。如果 Accessor 超过 5 行代码，考虑拆到 Service 或 Helper。
- **复杂响应字段**：放到 `Resource/DTO`，不要让 Model 变成万能格式化工厂。Resource 是给前端看的，DTO 是给后端层间传递的。
- **列表性能**：谨慎使用 `$appends`，大批量场景最好显式关闭。导出超过 1 万条时用 `cursor()` + `setAppends([])`。
- **查询过滤**：永远使用真实列名，不要对 Cast 后的"虚拟语义字段"直接写 SQL 条件。
- **加密字段**：只加密真正敏感的字段（API Secret、Token），配置信息不要用 `encrypted`，否则查询和调试都很痛苦。
- **时间时区**：数据库一律存 UTC，Cast 成 `immutable_datetime`，只在 Resource 层做时区转换。禁止在 Model 层调用 `setTimezone()`。

Casts 与 Accessors 真正的价值，不是语法糖，而是让领域模型保持稳定的输入输出边界。它们用得好，Model 会更像一个可靠的数据适配层；用不好，就会变成隐藏 SQL、隐藏时区、隐藏性能问题的黑箱。

如果你正在重构一批历史 Laravel 代码，我会建议优先先做三件事：金额整型化、时间 UTC 化、重计算字段从 Accessor 迁出。通常这三刀下去，Bug 和误解会先少一半。

## 相关阅读

- [spatie/laravel-data DTO 实战 - 强类型数据传输与 API 响应规范化踩坑记录](/php/Laravel/laravel-data-dto-guide-api/)：配合 Casts 使用 DTO 层，进一步规范 API 请求与响应的数据类型。
- [PHP Enum 替魔术字符串 - 30+ 仓库重构经验与最佳实践](/php/Laravel/php-enum-30/)：Laravel Casts 中 Enum 类型的进阶应用，消除魔术字符串的完整重构策略。
- [Laravel Scopes 实战：查询作用域封装与复杂筛选条件复用踩坑记录](/php/Laravel/laravel-scopes-guide-query/)：Model 层查询封装的另一面，与 Casts/Accessors 配合打造更干净的 Eloquent 代码。
