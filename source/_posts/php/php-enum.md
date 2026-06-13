---
title: PHP Enum 序列化实战：Enum 与 JSON/Database/Queue 的互转——Laravel Cast、Job 序列化与 API 响应的类型安全闭环
keywords: [PHP Enum, Enum, JSON, Database, Queue, Laravel Cast, Job, API, 序列化实战, 的互转]
date: 2026-06-10 06:40:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - PHP
  - Laravel
  - Enum
  - Cast
  - JSON
  - Queue
  - Serialization
description: 深入讲解 PHP 8.1+ Enum 在 Laravel 中的序列化实战，覆盖 JSON 编解码、数据库映射、Queue Job 安全序列化、API 响应与表单请求校验，最终形成类型安全的数据闭环。
---


在 PHP 8.1 引入 Enum 之后，很多 Laravel 项目开始把原来的字符串常量、魔法值替换成 Enum，代码可读性和类型安全显著提升。但真正落地时，最常卡住的不是"怎么定义 Enum"，而是：

- Enum 如何在 API 响应里转成 JSON？
- Enum 如何落库？直接存 value 还是存 name？
- Redis/Queue/Job 序列化时，Enum 会不会炸？
- Form Request 校验怎么判断"这个值是合法枚举"？
- 多态关系、Laravel Pennant、Laravel Scout 等场景下，Enum 的边界在哪？

这篇文章的目标不是讲语法，而是用**真实可运行的 Laravel 代码**打通这些环节，让你拿到后直接复用。

---

## 一、为什么 Enum 容易序列化踩坑

先说结论：**PHP Enum 本身不是标量类型，它是一个类实例。**

这意味着：

1. `json_encode()` 会报 `json_encode(): Type of argument #1 ($value) must be a primitive type or JsonSerializable`，除非实现 `JsonSerializable`。
2. `json_decode()` 得到的是字符串，不会自动还原成 Enum 实例。
3. 数据库字段存的是 string 或 int，取出后需要手动或通过 Cast 还原。
4. Laravel Queue 序列化 Job 时，默认用 `serialize()`/`unserialize()`，Enum 能存活，但如果用了 Redis 队列 + JSON 序列化，就可能丢失类型。

所以，**"定义 Enum"和"在各个场景安全序列化 Enum"是两件事**，后者才是真正考验架构设计的地方。

---

## 二、Enum 的基础定义与自序列化

### 2.1 纯值 Enum（String backed）

```php
<?php

namespace App\Enums;

enum OrderStatus: string
{
    case Pending   = 'pending';
    case Paid      = 'paid';
    case Shipped   = 'shipped';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';

    /**
     * 给 API 响应用：返回 value 字符串
     */
    public function label(): string
    {
        return match ($this) {
            self::Pending   => '待支付',
            self::Paid      => '已支付',
            self::Shipped   => '已发货',
            self::Delivered => '已签收',
            self::Cancelled => '已取消',
        };
    }
}
```

### 2.2 自带 `JsonSerializable`

如果你希望 `json_encode()` 直接输出 value 而不是报错，最简单的方式是实现接口：

```php
<?php

namespace App\Enums;

enum OrderStatus: string implements \JsonSerializable
{
    case Pending   = 'pending';
    case Paid      = 'paid';
    case Shipped   = 'shipped';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';

    public function jsonSerialize(): string
    {
        return $this->value;
    }
}
```

这样：

```php
$status = OrderStatus::Paid;
echo json_encode($status); // "paid"
```

但有一个陷阱：**`json_decode()` 不会还原回来。**

```php
$json = json_encode($status);        // "paid"
$decoded = json_decode($json);       // "paid" (string)
$enum = OrderStatus::from($decoded); // OrderStatus::Paid ✅
```

这就是为什么每次从 JSON 取值后，需要手动 `::from()` 转换。

---

## 三、Laravel Cast：数据库 ↔ Enum 的桥梁

### 3.1 单字段 Cast

在 Model 里声明：

```php
<?php

namespace App\Models;

use App\Enums\OrderStatus;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $casts = [
        'status' => OrderStatus::class,
    ];
}
```

**效果：**

- 写入时：`$order->status = OrderStatus::Paid;` → 数据库存 `'paid'`
- 读取时：`$order->status` → 返回 `OrderStatus::Paid` 实例
- 直接查询：`Order::where('status', OrderStatus::Paid)->get();` ✅

### 3.2 自定义 Cast（处理特殊需求）

如果你的数据库字段存的是整数（比如 `1=pending, 2=paid`），需要写一个自定义 Cast：

```php
<?php

namespace App\Casts;

use App\Enums\OrderStatus;
use Illuminate\Contracts\Casts\CastsAttributes;

class OrderStatusCast implements CastsAttributes
{
    public function get($model, $key, $value, $attributes)
    {
        if (is_null($value)) {
            return null;
        }

        // 数据库存的是整数
        $map = [
            1 => OrderStatus::Pending,
            2 => OrderStatus::Paid,
            3 => OrderStatus::Shipped,
            4 => OrderStatus::Delivered,
            5 => OrderStatus::Cancelled,
        ];

        return $map[$value] ?? throw new \InvalidArgumentException("Invalid order status: {$value}");
    }

    public function set($model, $key, $value, $attributes)
    {
        if ($value instanceof OrderStatus) {
            $map = [
                OrderStatus::Pending   => 1,
                OrderStatus::Paid      => 2,
                OrderStatus::Shipped   => 3,
                OrderStatus::Delivered => 4,
                OrderStatus::Cancelled => 5,
            ];

            return $map[$value] ?? throw new \InvalidArgumentException("Cannot map enum to integer");
        }

        throw new \InvalidArgumentException("Expected OrderStatus instance");
    }
}
```

使用：

```php
protected $casts = [
    'status' => OrderStatusCast::class,
];
```

### 3.3 数组/JSON 字段里的 Enum

如果你有一个 `json` 类型的字段存了多个状态：

```php
// migration
$table->json('tags')->nullable();

// model
protected $casts = [
    'tags' => 'array',
];
```

`tags` 里的值不会自动还原成 Enum。需要在访问器里处理：

```php
public function getTagsAttribute($value)
{
    $decoded = is_array($value) ? $value : json_decode($value, true);

    return array_map(
        fn (string $tag) => TagEnum::from($tag),
        $decoded ?? []
    );
}
```

---

## 四、API 响应：Enum 的序列化与文档

### 4.1 直接输出 value

如果 Enum 实现了 `JsonSerializable`，API Resource 里可以直接返回：

```php
<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class OrderResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'     => $this->id,
            'status' => $this->status,       // 自动 json_encode 为 "paid"
            'total'  => $this->total,
        ];
    }
}
```

前端收到：`{ "status": "paid" }`

### 4.2 同时输出 value + label

更友好的做法是同时返回枚举值和中文标签：

```php
// app/Enums/OrderStatus.php
public function toArray(): array
{
    return [
        'value' => $this->value,
        'label' => $this->label(),
    ];
}
```

API Resource：

```php
return [
    'id'     => $this->id,
    'status' => $this->status->toArray(),
    // ...
];
```

前端收到：

```json
{
    "id": 1,
    "status": {
        "value": "paid",
        "label": "已支付"
    }
}
```

这种模式在后台管理系统里非常实用——表格里显示 label，筛选时传 value。

### 4.3 OpenAPI/Swagger 文档

如果你用 `L5-Swagger` 或 `Scribe`，Enum 的文档生成通常依赖 PHPDoc：

```php
/**
 * @property OrderStatus $status
 */
class Order extends Model
{
    // ...
}
```

在 Schema 里手动指定枚举值：

```php
/**
 * @OA\Schema(
 *     schema="OrderStatus",
 *     type="string",
 *     enum={"pending","paid","shipped","delivered","cancelled"}
 * )
 */
```

---

## 五、Queue 与 Job：序列化的隐形炸弹

这是最容易出问题的场景。Laravel Queue 的序列化行为取决于驱动：

### 5.1 驱动差异

| 驱动 | 序列化方式 | Enum 安全性 |
|------|-----------|------------|
| `sync` | PHP serialize | ✅ 安全 |
| `database` | PHP serialize | ✅ 安全 |
| `redis` | PHP serialize（默认） | ✅ 安全 |
| `redis` + `serializer = json` | JSON encode | ❌ 可能丢失类型 |
| `sqs` | JSON encode | ❌ 可能丢失类型 |

### 5.2 Job 里使用 Enum

```php
<?php

namespace App\Jobs;

use App\Enums\OrderStatus;
use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SendOrderShippedNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public Order $order,
        public OrderStatus $newStatus,
    ) {}

    public function handle(): void
    {
        $this->order->update(['status' => $this->newStatus]);

        // 发送通知...
    }
}
```

调度：

```php
SendOrderShippedNotification::dispatch($order, OrderStatus::Shipped);
```

**PHP serialize 模式下，Enum 实例会被完整保存，反序列化后仍是 `OrderStatus::Shipped`。**

### 5.3 JSON 序列化场景的保护

如果你的 Queue 配置了 JSON 序列化（比如用了 `laravel/serializer` 包或自定义了 JSON serializer），需要在 Job 里做防御：

```php
<?php

namespace App\Jobs;

use App\Enums\OrderStatus;
use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

class SendOrderShippedNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /**
     * 手动声明属性类型，不用 SerializesModels
     * 序列化时自动调用 __serialize()
     */
    protected int $orderId;
    protected string $newStatusValue;

    public function __construct(
        public Order $order,
        public OrderStatus $newStatus,
    ) {
        $this->orderId = $order->id;
        $this->newStatusValue = $newStatus->value;
    }

    public function handle(): void
    {
        $order = Order::findOrFail($this->orderId);
        $status = OrderStatus::from($this->newStatusValue);

        $order->update(['status' => $status]);
    }
}
```

这样即使 JSON 序列化丢掉了 Enum 类型，也能从字符串安全还原。

### 5.4 Laravel Horizon 的 JSON 模式

Horizon 默认用 Redis + PHP serialize，但如果你在 `config/horizon.php` 里配置了 JSON 序列化：

```php
'redis' => [
    'serializer' => 'json',
],
```

那所有 Job 的构造函数参数都必须是**标量或 JSON-safe 类型**。建议在这种场景下，Job 参数只传 `orderId` 和 `statusValue`（string），在 `handle()` 里再查库还原。

---

## 六、表单请求与校验

### 6.1 直接用 Enum 做校验规则

Laravel 内置了 `Rule::enum()`：

```php
<?php

namespace App\Http\Requests;

use App\Enums\OrderStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateOrderStatusRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'status' => ['required', Rule::enum(OrderStatus::class)],
        ];
    }
}
```

前端传 `{"status": "paid"}`，校验通过后：

```php
$status = OrderStatus::from($request->input('status'));
```

### 6.2 数组字段的枚举校验

如果字段是数组（多选状态）：

```php
public function rules(): array
{
    return [
        'statuses'   => ['required', 'array'],
        'statuses.*' => ['required', Rule::enum(OrderStatus::class)],
    ];
}
```

### 6.3 自定义枚举校验消息

```php
public function messages(): array
{
    return [
        'status.enum' => '无效的订单状态，允许的值：' . implode(', ', array_column(OrderStatus::cases(), 'value')),
    ];
}
```

---

## 七、进阶场景

### 7.1 多态关系中的 Enum

如果你有 `MorphMany` 或 `MorphTo` 关系，且关联模型有 Enum 字段：

```php
class Comment extends Model
{
    protected $casts = [
        'type' => CommentType::class, // CommentType: 'review', 'question', 'complaint'
    ];
}

class Post extends Model
{
    public function comments()
    {
        return $this->morphMany(Comment::class, 'commentable');
    }
}
```

查询时可以直接用 Enum 过滤：

```php
$post->comments()->where('type', CommentType::Review)->get();
```

但要注意：**多态关系的 `type` 字段本身是字符串**，不要和 Enum 混淆。

### 7.2 Enum 与 Laravel Scout

如果你用 Scout 做全文搜索，且搜索结果需要还原 Enum：

```php
class Order extends Model
{
    use Searchable;

    public function toSearchableArray(): array
    {
        return [
            'id'     => $this->id,
            'status' => $this->status->value, // 存标量
        ];
    }
}
```

搜索结果取出后，需要手动还原：

```php
$results = Order::search('paid')->get();
$results->each(function ($order) {
    // $order->status 已经是 Enum 实例（因为 Cast）
});
```

### 7.3 Enum 与 Laravel Pennant

Laravel Pennant 的 Feature Flag 可以用 Enum 定义：

```php
enum Feature: string
{
    case NewCheckout = 'new-checkout';
    case BetaSearch  = 'beta-search';
}

// 使用
if (Feature::NewCheckout->active()) {
    // ...
}
```

### 7.4 Enum 序列化与缓存

Redis 缓存场景下：

```php
// 写入
Cache::remember('order:1:status', 3600, fn () => Order::find(1)->status);

// 取出
$status = Cache::get('order:1:status');
// 如果用 PHP serialize（默认），取出后是 OrderStatus 实例 ✅
// 如果用 JSON serializer，取出后是字符串，需要 ::from() 还原
```

建议在缓存层统一用 `->value` 存字符串，取出时 `::from()` 还原，避免序列化差异：

```php
// 写入
Cache::put('order:1:status', Order::find(1)->status->value, 3600);

// 取出
$status = OrderStatus::from(Cache::get('order:1:status'));
```

---

## 八、踩坑记录

### 坑 1：`json_encode()` 报错

```
json_encode(): Type of argument #1 ($value) must be a primitive type or JsonSerializable
```

**原因**：Enum 实例直接传给 `json_encode()`。

**解决**：实现 `JsonSerializable`，或者在输出时用 `$enum->value`。

### 坑 2：`json_decode()` 不还原 Enum

```php
$json = json_encode(OrderStatus::Paid); // "paid"
$decoded = json_decode($json);          // "paid" (string)
// 不是 OrderStatus::Paid！
```

**解决**：永远用 `OrderStatus::from($decoded)` 手动还原。

### 坑 3：Queue JSON 序列化丢失类型

```php
// Job 构造函数
public function __construct(public OrderStatus $status) {}

// 如果 Queue 用 JSON 序列化，$status 反序列化后可能是 string
```

**解决**：Job 参数用标量，在 `handle()` 里 `::from()` 还原。

### 坑 4：数据库迁移不兼容

```php
// 旧的 migration
$table->string('status'); // 存的是字符串

// 新的 Enum Cast
protected $casts = ['status' => OrderStatus::class];
```

如果数据库里有脏数据（不在 Enum cases 里的值），`from()` 会抛异常。

**解决**：先清洗数据，或用自定义 Cast 做 fallback：

```php
public function get($model, $key, $value, $attributes)
{
    try {
        return OrderStatus::from($value);
    } catch (\ValueError) {
        return OrderStatus::Pending; // 默认值
    }
}
```

### 坑 5：Enum 不能作为数组键

```php
$statuses = [
    OrderStatus::Paid => '已支付', // ❌ 语法错误
];
```

**解决**：用 `->value`：

```php
$statuses = [
    OrderStatus::Paid->value => '已支付', // ✅
];
```

---

## 九、完整示例：一个 Order 的全链路

把上面的内容串起来，看一个完整的 Order 从创建到通知的全链路：

```php
<?php

// 1. 定义 Enum
// app/Enums/OrderStatus.php
enum OrderStatus: string implements \JsonSerializable
{
    case Pending   = 'pending';
    case Paid      = 'paid';
    case Shipped   = 'shipped';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';

    public function jsonSerialize(): string
    {
        return $this->value;
    }

    public function label(): string
    {
        return match ($this) {
            self::Pending   => '待支付',
            self::Paid      => '已支付',
            self::Shipped   => '已发货',
            self::Delivered => '已签收',
            self::Cancelled => '已取消',
        };
    }
}
```

```php
<?php

// 2. Model + Cast
// app/Models/Order.php
namespace App\Models;

use App\Enums\OrderStatus;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $fillable = ['user_id', 'total', 'status'];

    protected $casts = [
        'status' => OrderStatus::class,
        'total'  => 'decimal:2',
    ];
}
```

```php
<?php

// 3. Form Request 校验
// app/Http/Requests/StoreOrderRequest.php
namespace App\Http\Requests;

use App\Enums\OrderStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreOrderRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'user_id' => ['required', 'exists:users,id'],
            'total'   => ['required', 'numeric', 'min:0'],
            'status'  => ['sometimes', Rule::enum(OrderStatus::class)],
        ];
    }
}
```

```php
<?php

// 4. Controller
// app/Http/Controllers/OrderController.php
namespace App\Http\Controllers;

use App\Enums\OrderStatus;
use App\Http\Requests\StoreOrderRequest;
use App\Http\Resources\OrderResource;
use App\Models\Order;

class OrderController extends Controller
{
    public function store(StoreOrderRequest $request)
    {
        $order = Order::create([
            'user_id' => $request->input('user_id'),
            'total'   => $request->input('total'),
            'status'  => OrderStatus::from($request->input('status', 'pending')),
        ]);

        return new OrderResource($order);
    }

    public function ship(Order $order)
    {
        $order->update(['status' => OrderStatus::Shipped]);

        \App\Jobs\SendOrderShippedNotification::dispatch($order, OrderStatus::Shipped);

        return new OrderResource($order->fresh());
    }
}
```

```php
<?php

// 5. Job
// app/Jobs/SendOrderShippedNotification.php
namespace App\Jobs;

use App\Enums\OrderStatus;
use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

class SendOrderShippedNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    protected int $orderId;
    protected string $statusValue;

    public function __construct(
        public Order $order,
        public OrderStatus $newStatus,
    ) {
        $this->orderId = $order->id;
        $this->statusValue = $newStatus->value;
    }

    public function handle(): void
    {
        $order = Order::findOrFail($this->orderId);
        $status = OrderStatus::from($this->statusValue);

        $order->update(['status' => $status]);

        // 发送通知逻辑...
        \Log::info("Order #{$order->id} status updated to {$status->value}");
    }
}
```

```php
<?php

// 6. API Resource
// app/Http/Resources/OrderResource.php
namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class OrderResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id'        => $this->id,
            'user_id'   => $this->user_id,
            'total'     => $this->total,
            'status'    => [
                'value' => $this->status->value,
                'label' => $this->status->label(),
            ],
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
```

---

## 十、总结

PHP Enum 在 Laravel 中的序列化不是单一问题，而是一个**贯穿数据库、API、Queue、缓存的链路问题**。核心原则：

1. **数据库层**：用 Laravel Cast 自动转换，保持 Enum 实例在 Model 层的统一。
2. **API 层**：实现 `JsonSerializable` 输出 value，或用 Resource 手动组装 value + label。
3. **Queue 层**：Job 参数尽量用标量，反序列化后手动 `::from()`，避免序列化驱动差异带来的坑。
4. **校验层**：用 `Rule::enum()` 保证传入值的合法性。
5. **缓存层**：统一存 `->value`，取出时 `::from()`，避免序列化格式不一致。

把这些环节打通，就能在 Laravel 项目里安全、优雅地使用 Enum，不再被序列化问题困扰。
