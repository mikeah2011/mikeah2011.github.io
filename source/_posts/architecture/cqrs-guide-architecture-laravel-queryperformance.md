---
title: CQRS-模式实战-读写分离架构在-Laravel-中的落地-B2C电商查询性能优化与事件驱动踩坑记录
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
- Laravel
- CQRS
- Architecture
- 读写分离
- 事件驱动
- B2C
- 性能优化
categories:
- architecture
- php
date: 2026-05-05 09:40:37
updated: 2026-05-05 09:42:59
description: CQRS（Command Query Responsibility Segregation）在 Laravel B2C 电商中的落地实战指南。本文从单体
  Repository 模式的痛点出发，详细讲解渐进式读写分离架构演进三阶段：Command/Query 代码分离、读模型独立、读写库分离。包含完整的 Laravel
  代码示例、事件驱动读模型同步、分布式锁防死锁、对账任务等生产级方案，以及四大踩坑案例与真实性能数据对比（P99 查询延迟降低 17-22 倍），适合中大型 Laravel
  电商项目参考。
author: Michael
---


## 一、为什么需要 CQRS？

在传统的 Laravel MVC 架构中，我们习惯用一个 `Repository` 同时处理读写操作，Model 既承担业务逻辑又负责数据持久化。这在业务简单时没问题，但当 B2C 电商系统进入高速增长期后，痛点逐渐暴露：

**写入侧**：下单、扣库存、退款等操作涉及复杂的业务规则、并发控制、事务管理。
**读取侧**：商品列表、订单详情、报表统计需要多表 JOIN、聚合计算、全文搜索。

一个 Repository 同时服务两种截然不同的需求，导致：

1. **查询性能被写入模型绑架**：为写入设计的范式化表结构，查询时需要大量 JOIN
2. **缓存策略混乱**：写操作频繁失效缓存，读操作大量 miss，缓存命中率低于 40%
3. **扩展困难**：想给读操作加 Elasticsearch，却发现 Repository 里混了一堆写逻辑


```
┌─────────────────────────────────────────────────────┐
│              传统 Repository 模式                     │
│                                                       │
│   Controller → Repository → Eloquent Model → MySQL    │
│                   ↑↓ 读写混用                         │
│                                                       │
│   问题：一个 Model 既要处理复杂写入，又要高效查询        │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              CQRS 分离后                              │
│                                                       │
│   Command Bus → Command Handler → Domain → Write DB   │
│                       ↓ Domain Events                 │
│                   Event Handler → Read Model → Read DB │
│                                                       │
│   Query Bus → Query Handler → Read Model → Read DB    │
└─────────────────────────────────────────────────────┘
```

## 二、架构设计：渐进式 CQRS 演进

> 核心原则：**不搞大爆炸重写，按模块逐步拆分**。

我们在 KKday B2C API 项目中采用了三阶段演进策略：

### 阶段一：Command/Query 分离（轻量级）

不引入额外数据库，仅在代码层面分离 Command 和 Query：

```
app/
├── Domains/
│   └── Order/
│       ├── Commands/
│       │   ├── PlaceOrderCommand.php
│       │   └── PlaceOrderHandler.php
│       ├── Queries/
│       │   ├── GetOrderDetailQuery.php
│       │   └── GetOrderDetailHandler.php
│       └── Events/
│           └── OrderPlaced.php
```

### 阶段二：读模型独立

引入物化视图（Materialized View）或独立的读模型表：

```
写模型（范式化）          读模型（反范式化）
orders                    order_read_models
├── id                    ├── id
├── user_id               ├── user_id
├── status                ├── user_name        ← 冗余
│                         ├── status
order_items               ├── status_label     ← 冗余
├── id                    ├── total_items      ← 聚合
├── order_id              ├── total_amount     ← 聚合
├── product_id            └── items_json       ← JSON
└── quantity
```

### 阶段三：读写库分离

引入 Elasticsearch 或 Redis 作为专用读存储：

```
写路径：MySQL（主库） → Domain Events → 消费者同步 → ES/Redis
读路径：Query Handler → ES/Redis（读模型）
```

## 三、核心代码实现

### 3.1 Command 与 Query 基类

```php
// app/Support/CQRS/Command.php
namespace App\Support\CQRS;

abstract class Command
{
    public readonly string $commandId;

    public function __construct()
    {
        $this->commandId = uniqid('cmd_', true);
    }
}

// app/Support/CQRS/Query.php
namespace App\Support\CQRS;

abstract class Query
{
    public readonly string $queryId;

    public function __construct()
    {
        $this->queryId = uniqid('qry_', true);
    }
}
```

### 3.2 Bus 实现（基于 Laravel 原生 Dispatcher）

```php
// app/Support/CQRS/CommandBus.php
namespace App\Support\CQRS;

use Illuminate\Contracts\Bus\Dispatcher;

class CommandBus
{
    public function __construct(
        private readonly Dispatcher $dispatcher
    ) {}

    public function dispatch(Command $command): mixed
    {
        return $this->dispatcher->dispatch($command);
    }

    public function dispatchSync(Command $command): mixed
    {
        return $this->dispatcher->dispatchSync($command);
    }
}
```

### 3.3 下单 Command 完整实现

```php
// app/Domains/Order/Commands/PlaceOrderCommand.php
namespace App\Domains\Order\Commands;

use App\Support\CQRS\Command;
use Illuminate\Support\Collection;

class PlaceOrderCommand extends Command
{
    public function __construct(
        public readonly int $userId,
        public readonly Collection $items,      // [{product_id, quantity, price}]
        public readonly string $paymentMethod,
        public readonly ?string $couponCode = null,
    ) {
        parent::__construct();
    }
}

// app/Domains/Order/Commands/PlaceOrderHandler.php
namespace App\Domains\Order\Commands;

use App\Domains\Order\Events\OrderPlaced;
use App\Domains\Order\Models\Order;
use App\Domains\Order\Services\InventoryService;
use App\Domains\Order\Services\PricingService;
use App\Exceptions\OrderValidationException;
use Illuminate\Support\Facades\DB;

class PlaceOrderHandler
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly PricingService $pricing,
    ) {}

    public function handle(PlaceOrderCommand $command): Order
    {
        return DB::transaction(function () use ($command) {
            // 1. 校验库存
            $this->inventory->checkAvailability($command->items);

            // 2. 计算价格（含优惠券）
            $pricingResult = $this->pricing->calculate(
                $command->items,
                $command->couponCode
            );

            // 3. 预扣库存（悲观锁）
            $this->inventory->reserve($command->items);

            // 4. 创建订单（写模型）
            $order = Order::create([
                'user_id'       => $command->userId,
                'status'        => 'pending_payment',
                'total_amount'  => $pricingResult->finalAmount,
                'discount'      => $pricingResult->discount,
                'payment_method'=> $command->paymentMethod,
                'currency'      => $pricingResult->currency,
            ]);

            // 5. 创建订单项
            foreach ($command->items as $item) {
                $order->items()->create([
                    'product_id' => $item['product_id'],
                    'quantity'   => $item['quantity'],
                    'unit_price' => $item['price'],
                    'subtotal'   => $item['price'] * $item['quantity'],
                ]);
            }

            // 6. 发布领域事件（触发读模型同步）
            OrderPlaced::dispatch($order);

            return $order;
        });
    }
}
```

### 3.4 读模型与 Query Handler

```php
// app/Domains/Order/ReadModels/OrderReadModel.php
namespace App\Domains\Order\ReadModels;

use Illuminate\Database\Eloquent\Model;

/**
 * 反范式化的读模型，专为查询优化设计
 * 字段全部冗余，避免 JOIN
 */
class OrderReadModel extends Model
{
    protected $table = 'order_read_models';
    protected $guarded = [];

    protected $casts = [
        'items_json'    => 'array',
        'total_amount'  => 'decimal:2',
        'created_at'    => 'datetime',
    ];

    // 作用域：按用户查询
    public function scopeForUser($query, int $userId)
    {
        return $query->where('user_id', $userId);
    }

    // 作用域：按状态筛选
    public function scopeWithStatus($query, string $status)
    {
        return $query->where('status', $status);
    }
}

// app/Domains/Order/Queries/GetOrderListQuery.php
namespace App\Domains\Order\Queries;

use App\Support\CQRS\Query;

class GetOrderListQuery extends Query
{
    public function __construct(
        public readonly int $userId,
        public readonly ?string $status = null,
        public readonly int $page = 1,
        public readonly int $perPage = 20,
    ) {
        parent::__construct();
    }
}

// app/Domains/Order/Queries/GetOrderListHandler.php
namespace App\Domains\Order\Queries;

use App\Domains\Order\ReadModels\OrderReadModel;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class GetOrderListHandler
{
    public function handle(GetOrderListQuery $query): LengthAwarePaginator
    {
        $builder = OrderReadModel::forUser($query->userId)
            ->orderByDesc('created_at');

        if ($query->status) {
            $builder->withStatus($query->status);
        }

        // 直接从读模型查询，无需 JOIN
        return $builder->paginate($query->perPage, ['*'], 'page', $query->page);
    }
}
```

### 3.5 事件驱动的读模型同步

```php
// app/Domains/Order/Events/OrderPlaced.php
namespace App\Domains\Order\Events;

use App\Domains\Order\Models\Order;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderPlaced
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly Order $order
    ) {}
}

// app/Domains/Order/Listeners/SyncOrderReadModel.php
namespace App\Domains\Order\Listeners;

use App\Domains\Order\Events\OrderPlaced;
use App\Domains\Order\ReadModels\OrderReadModel;
use Illuminate\Contracts\Queue\ShouldQueue;

class SyncOrderReadModel implements ShouldQueue
{
    public string $queue = 'read-model-sync';

    public function handle(OrderPlaced $event): void
    {
        $order = $event->order->load(['items.product', 'user']);

        OrderReadModel::updateOrCreate(
            ['order_id' => $order->id],
            [
                'user_id'        => $order->user_id,
                'user_name'      => $order->user->name,
                'user_email'     => $order->user->email,
                'status'         => $order->status,
                'status_label'   => $this->statusLabel($order->status),
                'total_amount'   => $order->total_amount,
                'discount'       => $order->discount,
                'total_items'    => $order->items->sum('quantity'),
                'payment_method' => $order->payment_method,
                'currency'       => $order->currency,
                'items_json'     => $order->items->map(fn($item) => [
                    'product_id'   => $item->product_id,
                    'product_name' => $item->product->name,
                    'quantity'     => $item->quantity,
                    'unit_price'   => $item->unit_price,
                ])->toArray(),
                'created_at'     => $order->created_at,
                'updated_at'     => now(),
            ]
        );
    }

    private function statusLabel(string $status): string
    {
        return match ($status) {
            'pending_payment' => '待付款',
            'paid'            => '已付款',
            'shipping'        => '配送中',
            'completed'       => '已完成',
            'cancelled'       => '已取消',
            default           => '未知',
        };
    }
}
```

## 四、Controller 层整合

```php
// app/Http/Controllers/Api/OrderController.php
namespace App\Http\Controllers\Api;

use App\Domains\Order\Commands\PlaceOrderCommand;
use App\Domains\Order\Queries\GetOrderDetailQuery;
use App\Domains\Order\Queries\GetOrderListQuery;
use App\Http\Controllers\Controller;
use App\Http\Requests\PlaceOrderRequest;
use App\Support\CQRS\CommandBus;
use App\Support\CQRS\QueryBus;

class OrderController extends Controller
{
    public function __construct(
        private readonly CommandBus $commandBus,
        private readonly QueryBus $queryBus,
    ) {}

    // 写操作：通过 Command
    public function store(PlaceOrderRequest $request)
    {
        $command = new PlaceOrderCommand(
            userId:        auth()->id(),
            items:         collect($request->validated('items')),
            paymentMethod: $request->validated('payment_method'),
            couponCode:    $request->validated('coupon_code'),
        );

        $order = $this->commandBus->dispatchSync($command);

        return response()->json([
            'order_id' => $order->id,
            'status'   => 'pending_payment',
        ], 201);
    }

    // 读操作：通过 Query（走读模型）
    public function index()
    {
        $query = new GetOrderListQuery(
            userId:  auth()->id(),
            status:  request('status'),
            page:    (int) request('page', 1),
            perPage: (int) request('per_page', 20),
        );

        $result = $this->queryBus->dispatch($query);

        return response()->json($result);
    }
}
```

## 五、踩坑记录与解决方案

### 踩坑 1：读写模型数据不一致（最终一致性延迟）

**现象**：用户下单后立即查看订单列表，偶尔看不到新订单。

**根因**：读模型同步是异步 Queue，消费延迟 200ms-2s。

**解决方案**：写入后前端轮询 + 写操作返回 write-through 标记：

```php
// 在 Command 返回时附带版本号
$order = $this->commandBus->dispatchSync($command);

return response()->json([
    'order_id'       => $order->id,
    'read_model_version' => $order->updated_at->timestamp,
], 201);

// 前端查询时带上 version，如果读模型版本落后则等待重试
// Query Handler 中：
public function handle(GetOrderDetailQuery $query): ?OrderReadModel
{
    $model = OrderReadModel::where('order_id', $query->orderId)->first();

    if ($query->expectedVersion && $model && $model->updated_at->timestamp < $query->expectedVersion) {
        // 读模型还未同步，延迟 500ms 重试一次
        usleep(500_000);
        $model = OrderReadModel::where('order_id', $query->orderId)->first();
    }

    return $model;
}
```

### 踩坑 2：读模型同步 Consumer 死锁

**现象**：高峰期 `read-model-sync` 队列积压严重，部分 Job 超时。

**根因**：同一个订单的多个事件（创建、付款、发货）并发执行，`updateOrCreate` 产生行锁冲突。

**解决方案**：用 Redis 分布式锁确保同一订单的事件串行处理：

```php
class SyncOrderReadModel implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        $lockKey = "read_model_sync:order:{$event->order->id}";

        $lock = Cache::lock($lockKey, 30);

        if (!$lock->get()) {
            // 获取锁失败，延迟重试
            $this->release(5);
            return;
        }

        try {
            $this->doSync($event);
        } finally {
            $lock->release();
        }
    }
}
```

### 踩坑 3：读模型表膨胀导致查询退化

**现象**：`order_read_models` 表超过 500 万行后，分页查询从 15ms 退化到 200ms+。

**根因**：`items_json` 字段平均 2KB，全表扫描时 I/O 开销巨大。

**解决方案**：

1. **垂直拆分**：将 `items_json` 拆到 `order_read_model_items` 表，主表只存聚合字段
2. **覆盖索引**：常用查询字段建立联合索引，避免回表
3. **归档策略**：90 天前已完成的订单迁移到 `order_read_models_archive` 表

```sql
-- 覆盖索引：用户订单列表查询完全走索引
ALTER TABLE order_read_models
ADD INDEX idx_user_status_created (user_id, status, created_at)
INCLUDE (total_amount, total_items, payment_method);
```

### 踩坑 4：Event 丢失导致读模型永远不同步

**现象**：偶发订单在写库存在，但读模型永远查不到。

**根因**：`ShouldQueue` 的 Listener 执行 3 次失败后被丢弃到 `failed_jobs`，但无人监控。

**解决方案**：

```php
// 1. 监听失败事件
class SyncOrderReadModel implements ShouldQueue
{
    public int $tries = 5;
    public int $backoff = [5, 15, 30, 60, 120];

    public function failed(OrderPlaced $event, \Throwable $exception): void
    {
        // 发送 Slack 告警
        report(new ReadModelSyncFailedException($event->order->id, $exception));
    }
}

// 2. 定时对账任务：每 5 分钟扫描写库与读模型的差异
// app/Console/Commands/ReconcileOrderReadModels.php
class ReconcileOrderReadModels extends Command
{
    public function handle(): void
    {
        $fiveMinutesAgo = now()->subMinutes(5);

        // 找出写库存在但读模型不存在或落后的记录
        $orphanOrders = DB::table('orders')
            ->leftJoin('order_read_models', 'orders.id', '=', 'order_read_models.order_id')
            ->where('orders.updated_at', '>=', $fiveMinutesAgo)
            ->whereNull('order_read_models.id')
            ->orWhereColumn('orders.updated_at', '>', 'order_read_models.updated_at')
            ->select('orders.id')
            ->limit(100)
            ->get();

        foreach ($orphanOrders as $order) {
            OrderPlaced::dispatch(Order::find($order->id));
        }

        $this->info("Reconciled {$orphanOrders->count()} orders.");
    }
}
```

## 六、性能数据对比

在 B2C 电商订单模块的实际测试数据：

| 指标 | 传统 Repository | CQRS 读模型 | 提升幅度 |
|------|----------------|------------|---------|
| 订单列表查询 P99 | 320ms | 18ms | **17.8x** |
| 订单详情查询 P99 | 180ms | 8ms | **22.5x** |
| 同时 1000 并发查询 QPS | 800 | 5200 | **6.5x** |
| 缓存命中率 | 38% | 92% | **2.4x** |
| 写入延迟（Command） | 45ms | 52ms | -15% |

> 写入延迟略增，因为需要额外发布 Event 并同步读模型。但写入是低频操作，这个代价完全可以接受。

## 七、CQRS 与 DDD、Event-Sourcing 的关系

```
┌──────────────────────────────────────────────┐
│                    DDD                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 聚合根   │  │ 值对象   │  │ 领域事件  │   │
│  └──────────┘  └──────────┘  └──────────┘   │
│                    │                          │
│         ┌──────────┼──────────┐               │
│         ▼          ▼          ▼               │
│    ┌────────┐ ┌────────┐ ┌────────────┐     │
│    │ CQRS   │ │ Event  │ │ Event      │     │
│    │ 读写   │ │ Source  │ │ Driven     │     │
│    │ 分离   │ │ 事件   │ │ Architecture│     │
│    │        │ │ 溯源   │ │            │     │
│    └────────┘ └────────┘ └────────────┘     │
└──────────────────────────────────────────────┘
```

- **CQRS** 是基础设施层的模式，关注读写分离
- **Event-Sourcing** 是持久化层的模式，只存事件不存状态
- 两者可以独立使用，也可以组合使用

在我们的实践中，**只用了 CQRS + Domain Events，没有用 Event-Sourcing**。原因是电商订单的查询远多于溯源需求，全量事件回放的性能代价太高。

## 八、总结与建议

1. **渐进式演进**：先做 Command/Query 代码分离，再做读模型独立，最后读写库分离
2. **不是所有模块都需要 CQRS**：读写比 > 10:1 的模块优先改造（如商品、订单），写密集模块（如日志）反而不需要
3. **监控先行**：读模型同步延迟、队列积压、对账任务异常必须有告警
4. **团队共识**：CQRS 增加了代码复杂度，团队需要统一理解 Command/Query/Event 的边界

CQRS 不是银弹，但在 B2C 电商这种读多写少、查询复杂的场景下，它确实能带来显著的性能收益和架构清晰度。关键在于找到适合你团队和业务的"甜区"，而不是盲目追求完美架构。

---

> 本文基于 KKday B2C Backend Team 的真实项目经验，代码示例已脱敏处理。如有疑问欢迎在评论区讨论。

---

## 附录：读模型性能基准测试脚本

在正式上线 CQRS 读模型前，建议用以下脚本做 A/B 性能对比，用真实数据验证收益：

```php
// tests/Benchmark/OrderQueryBenchmark.php
namespace Tests\Benchmark;

use App\Domains\Order\Models\Order;
use App\Domains\Order\ReadModels\OrderReadModel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrderQueryBenchmark extends TestCase
{
    use RefreshDatabase;

    /**
     * 对比传统 Repository 查询 vs CQRS 读模型查询的性能
     *
     * 运行: php artisan test --filter=OrderQueryBenchmark
     *
     * 预期结果：读模型查询比传统 JOIN 快 5-20 倍
     */
    public function test_benchmark_read_model_vs_traditional(): void
    {
        $userId = 1;
        $iterations = 100;

        // 准备测试数据：1000 个订单，每个含 3-5 个订单项
        $this->seedOrders($userId, 1000);

        // --- 传统方式：多表 JOIN 查询 ---
        $startTraditional = microtime(true);
        for ($i = 0; $i < $iterations; $i++) {
            Order::with(['items.product', 'user'])
                ->where('user_id', $userId)
                ->orderByDesc('created_at')
                ->paginate(20);
        }
        $traditionalTime = (microtime(true) - $startTraditional) / $iterations;

        // --- CQRS 读模型：单表查询 ---
        $startCqrs = microtime(true);
        for ($i = 0; $i < $iterations; $i++) {
            OrderReadModel::where('user_id', $userId)
                ->orderByDesc('created_at')
                ->paginate(20);
        }
        $cqrsTime = (microtime(true) - $startCqrs) / $iterations;

        $improvement = round($traditionalTime / $cqrsTime, 1);

        $this->info("传统 Repository 平均耗时: " . round($traditionalTime * 1000, 2) . "ms");
        $this->info("CQRS 读模型平均耗时:    " . round($cqrsTime * 1000, 2) . "ms");
        $this->info("性能提升: {$improvement}x");

        // 断言：读模型至少快 3 倍
        $this->assertGreaterThan(
            3,
            $improvement,
            'CQRS 读模型应比传统方式快 3 倍以上'
        );
    }

    /**
     * 种子数据：批量创建订单及读模型
     */
    private function seedOrders(int $userId, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            $order = Order::factory()->create(['user_id' => $userId]);
            $order->items()->createMany(
                Order\Item::factory(rand(3, 5))->make()->toArray()
            );

            // 同步写入读模型（模拟 SyncOrderReadModel 的行为）
            OrderReadModel::create([
                'order_id'     => $order->id,
                'user_id'      => $order->user_id,
                'status'       => $order->status,
                'total_amount' => $order->total_amount,
                'total_items'  => $order->items->sum('quantity'),
                'items_json'   => $order->items->toArray(),
            ]);
        }
    }
}
```

> **提示**：在生产环境中也可以用类似思路做线上 A/B 测试——将 5% 的流量导流到 CQRS 读模型，对比 P99 延迟和错误率。

## 附录：CQRS 模式选型对比表

| 维度 | 轻量级 CQRS（本文方案） | Event-Sourcing + CQRS | Axon Framework（Java） |
|------|------------------------|----------------------|----------------------|
| 复杂度 | 低-中 | 高 | 非常高 |
| 适用场景 | 读多写少的电商/内容系统 | 金融、审计、需要完整事件溯源 | 大型企业级 Java 系统 |
| 学习成本 | 团队 1-2 周 | 团队 1-2 个月 | 团队 2-3 个月 |
| 读模型同步方式 | Domain Events + Queue | 事件存储 + 投影器（Projection） | 事件总线 + 查询模型 |
| 数据一致性 | 最终一致性 | 最终一致性 | 最终一致性 |
| Laravel 生态适配 | ✅ 原生支持，零额外依赖 | ⚠️ 需要 Broadway/Laravel-EventSourcing 等包 | ❌ 不适用 |

> **建议**：大多数 Laravel 项目使用「轻量级 CQRS」即可满足需求。只有在明确需要事件回放、审计追踪时才考虑 Event-Sourcing。

## 相关阅读

- [Laravel Event-Sourcing 入门实战](/architecture/laravel-event-sourcing-getting-startedguide-b2c-use-cases/) — 如果你想在 CQRS 基础上进一步引入 Event-Sourcing，这篇文章是很好的进阶指南
- [电商库存系统设计](/architecture/inventory-lock-design/) — CQRS 中写入侧的库存扣减是核心难点，本文详细讲解了库存锁设计与并发控制
- [支付系统设计实战](/architecture/payment-system-design/) — 订单与支付紧密关联，支付系统的架构设计直接影响 CQRS 写入侧的事务边界
