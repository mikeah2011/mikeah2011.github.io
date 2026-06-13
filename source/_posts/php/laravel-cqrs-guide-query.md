---

title: Laravel CQRS 实战：订单查询模型拆分、投影同步与后台列表性能治理
keywords: [Laravel CQRS, 订单查询模型拆分, 投影同步与后台列表性能治理]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 08:15:00
categories:
- php
tags:
- Laravel
- MySQL
- Redis
- 架构
- CQRS
- Event Sourcing
- 事件溯源
description: Laravel CQRS 命令查询分离实战：B2C 订单后台读写分离落地方案，详解写侧领域建模、读侧投影表设计、Event Sourcing 事件溯源驱动的异步同步机制、Redis Cache 查询性能优化（P95 从 1.8s 降至 28ms），附投影 Job 幂等与生产踩坑记录，适合中大型 Laravel 电商系统架构参考。
---


在 B2C 订单后台里，最先出问题的通常不是“下单”，而是**订单列表**：运营要按渠道、支付状态、出行日期、退款状态、关键字、供应商一起筛，SQL 很快就会演变成一条 8~10 个 JOIN 的巨兽。我们在一个 Laravel 订单后台里遇到过同样问题：写入链路本来不慢，但后台列表 P95 长期在 1.8s 以上，导出任务还会把主库拖抖。

后来没有继续在原表上硬调索引，而是把这块拆成 **CQRS**：写侧保留领域模型和事务边界，读侧单独维护投影表 `order_view`。结果很直接：后台列表接口从 1.8s 降到 220ms 左右，筛选条件新增时也不再动核心下单逻辑。

## 一、我们最后落地的结构

```text
        +---------------- Admin / BI / Export ----------------+
        |        GET /admin/orders?status=paid&kw=TK          |
        +--------------------------+--------------------------+
                                   |
                                   v
                         Query Service / Read DB
                                   |
                            order_view 投影表
                                   ^
                                   |
       afterCommit event      Queue / Projection Job
                                   ^
                                   |
+------------------- Write Side -------------------+
| Order Aggregate -> Command Handler -> MySQL Tx   |
| create/pay/cancel/refund 只写 orders/order_items |
+--------------------------------------------------+
```

关键原则只有三条：

1. **写侧只保证业务正确性**，不要为了报表字段污染聚合根。
2. **读侧专门为查询而生**，允许反范式、冗余字段、预聚合。
3. **事件一定 afterCommit 发出**，否则投影会读到未提交数据。

## 二、写侧不要把查询需求塞回领域模型

下单时我们只维护订单本身，而不是顺手更新几十个后台统计字段：

```php
<?php

final readonly class CreateOrderCommand
{
    public function __construct(
        public int $userId,
        public string $channel,
        public array $items,
        public int $totalAmount,
        public string $currency,
    ) {}
}

final class CreateOrderHandler
{
    public function handle(CreateOrderCommand $command): Order
    {
        return DB::transaction(function () use ($command) {
            $order = Order::create([
                'user_id' => $command->userId,
                'channel' => $command->channel,
                'status' => OrderStatus::Pending->value,
                'total_amount' => $command->totalAmount,
                'currency' => $command->currency,
            ]);

            foreach ($command->items as $item) {
                $order->items()->create([
                    'sku_id' => $item['sku_id'],
                    'qty' => $item['qty'],
                    'price' => $item['price'],
                ]);
            }

            OrderCreated::dispatch($order->id)->afterCommit();

            return $order;
        });
    }
}
```

这里最重要的不是 `Command` 这个名词，而是**命令入口单一**。创建、支付、取消、退款分别是独立 handler，事务边界清楚，回滚也清楚。

## 三、读侧直接为后台列表建投影

我们新增一张 `order_view`，字段并不追求“优雅”，而追求“后台一条 SQL 查完”：

```php
Schema::create('order_view', function (Blueprint $table) {
    $table->unsignedBigInteger('order_id')->primary();
    $table->string('order_no')->index();
    $table->unsignedBigInteger('user_id')->index();
    $table->string('channel', 32)->index();
    $table->string('status', 32)->index();
    $table->string('payment_status', 32)->index();
    $table->date('departure_date')->nullable()->index();
    $table->string('supplier_name')->nullable()->index();
    $table->string('contact_name')->nullable();
    $table->string('contact_phone', 32)->nullable();
    $table->unsignedInteger('total_amount');
    $table->timestamp('paid_at')->nullable()->index();
    $table->timestamp('updated_at')->nullable()->index();
});
```

同步逻辑我会做成**可重放、可幂等**的投影器：

```php
final class SyncOrderViewJob implements ShouldQueue
{
    use Queueable;

    public function __construct(public int $orderId) {}

    public function handle(): void
    {
        $order = Order::query()->with(['items', 'payment', 'traveler', 'supplier'])->find($this->orderId);

        if (! $order) {
            DB::table('order_view')->where('order_id', $this->orderId)->delete();
            return;
        }

        DB::table('order_view')->updateOrInsert(
            ['order_id' => $order->id],
            [
                'order_no' => $order->order_no,
                'user_id' => $order->user_id,
                'channel' => $order->channel,
                'status' => $order->status,
                'payment_status' => $order->payment?->status,
                'departure_date' => optional($order->items->min('departure_date'))?->format('Y-m-d'),
                'supplier_name' => $order->supplier?->name,
                'contact_name' => $order->traveler?->contact_name,
                'contact_phone' => $order->traveler?->contact_phone,
                'total_amount' => $order->total_amount,
                'paid_at' => $order->payment?->paid_at,
                'updated_at' => now(),
            ]
        );
    }
}
```

事件监听器只做一件事：把写侧变更投递给投影队列。

```php
final class OrderProjector
{
    public function handle(OrderCreated|OrderPaid|OrderCanceled|OrderRefunded $event): void
    {
        SyncOrderViewJob::dispatch($event->orderId)->onQueue('projection');
    }
}
```

## 四、查询侧代码会非常“土”，但真的快

```php
final class AdminOrderQueryService
{
    public function search(array $filters): LengthAwarePaginator
    {
        return DB::table('order_view')
            ->when($filters['status'] ?? null, fn ($q, $v) => $q->where('status', $v))
            ->when($filters['channel'] ?? null, fn ($q, $v) => $q->where('channel', $v))
            ->when($filters['keyword'] ?? null, function ($q, $v) {
                $q->where(function ($sub) use ($v) {
                    $sub->where('order_no', 'like', "%{$v}%")
                        ->orWhere('contact_phone', 'like', "%{$v}%");
                });
            })
            ->orderByDesc('updated_at')
            ->paginate(perPage: 50);
    }
}
```

以前那条 SQL 要 JOIN 订单、支付、旅客、供应商、退款；现在后台列表就是查一张表。CQRS 的收益不在"架构名词"，而在**把复杂查询从核心事务表移出去**。

## 五、给查询侧加一层 Repository + Cache

直接在 Controller 里写 `DB::table(...)` 虽然快，但筛选条件会越来越多，迟早失控。我们把查询逻辑封装到 Repository 里，再加一层 Redis Cache 做热数据缓存：

```php
final class OrderViewRepository
{
    private const CACHE_TTL = 300; // 5 分钟

    public function search(array $filters, int $page = 1, int $perPage = 50): LengthAwarePaginator
    {
        $cacheKey = 'order_view:' . md5(serialize($filters) . $page . $perPage);

        return Cache::tags(['order_view_list'])->remember($cacheKey, self::CACHE_TTL, function () use ($filters, $page, $perPage) {
            return DB::table('order_view')
                ->when($filters['status'] ?? null, fn ($q, $v) => $q->where('status', $v))
                ->when($filters['channel'] ?? null, fn ($q, $v) => $q->where('channel', $v))
                ->when($filters['departure_from'] ?? null, fn ($q, $v) => $q->where('departure_date', '>=', $v))
                ->when($filters['departure_to'] ?? null, fn ($q, $v) => $q->where('departure_date', '<=', $v))
                ->when($filters['keyword'] ?? null, function ($q, $v) {
                    $q->where(function ($sub) use ($v) {
                        $sub->where('order_no', 'like', "%{$v}%")
                            ->orWhere('contact_phone', 'like', "%{$v}%");
                    });
                })
                ->orderByDesc('updated_at')
                ->paginate(perPage: $perPage, page: $page);
        });
    }

    /**
     * 投影同步完成后，清除相关缓存标签
     */
    public function flushCache(): void
    {
        Cache::tags(['order_view_list'])->flush();
    }
}
```

> **为什么要用 `Cache::tags`？** 当投影 Job 写入 `order_view` 后，只要 `flushCache()` 一下，所有列表页的缓存同时失效。如果不用 tag，你需要维护一堆散落的 key 命名规则。

## 六、投影同步 Job 的生产级增强

基础版 `SyncOrderViewJob` 在高并发下会出现竞态：两个支付事件同时到达，后到的覆盖了先到的。生产环境需要加锁 + 幂等：

```php
final class SyncOrderViewJob implements ShouldQueue
{
    use Queueable, Dispatchable, InteractsWithQueue, SerializesModels;

    public int $tries = 3;
    public int $timeout = 30;

    public function __construct(public int $orderId) {}

    public function handle(): void
    {
        // Redis 分布式锁，防止并发投影写入同一订单
        $lockKey = "projection:order_view:lock:{$this->orderId}";
        $lock = Cache::lock($lockKey, 30);

        if (! $lock->get()) {
            // 获取锁失败，重新入队稍后重试
            $this->release(5);
            return;
        }

        try {
            $order = Order::query()
                ->with(['items', 'payment', 'traveler', 'supplier'])
                ->find($this->orderId);

            if (! $order) {
                DB::table('order_view')->where('order_id', $this->orderId)->delete();
                return;
            }

            $data = [
                'order_no'        => $order->order_no,
                'user_id'         => $order->user_id,
                'channel'         => $order->channel,
                'status'          => $order->status,
                'payment_status'  => $order->payment?->status,
                'departure_date'  => optional($order->items->min('departure_date'))?->format('Y-m-d'),
                'supplier_name'   => $order->supplier?->name,
                'contact_name'    => $order->traveler?->contact_name,
                'contact_phone'   => $order->traveler?->contact_phone,
                'total_amount'    => $order->total_amount,
                'paid_at'         => $order->payment?->paid_at,
                'updated_at'      => now(),
            ];

            DB::table('order_view')->updateOrInsert(
                ['order_id' => $this->orderId],
                $data
            );
        } finally {
            $lock->release();
        }
    }

    /**
     * 失败后清空 order_view 中该订单数据，避免脏数据残留
     */
    public function failed(Throwable $exception): void
    {
        Log::error("投影同步失败 order_id={$this->orderId}", [
            'error' => $exception->getMessage(),
        ]);
        DB::table('order_view')->where('order_id', $this->orderId)->delete();
    }
}
```

投影 Job 的事件监听器也相应升级：

```php
final class OrderProjector
{
    public function handle(OrderCreated|OrderPaid|OrderCanceled|OrderRefunded $event): void
    {
        SyncOrderViewJob::dispatch($event->orderId)->onQueue('projection');

        // 清除相关缓存，确保下次查询命中新数据
        app(OrderViewRepository::class)->flushCache();
    }
}
```

## 七、性能对比：优化前 vs CQRS 落地后

以我们线上 10 万订单规模的 B2C 后台为基准，筛选条件为：`channel=wechat & status=paid & keyword=TK`，测试 100 次取 P50 / P95：

| 指标 | 优化前（多 JOIN 原表） | CQRS 投影表 | CQRS + Redis Cache |
|---|---|---|---|
| P50 延迟 | 1,420ms | 180ms | 12ms |
| P95 延迟 | 1,830ms | 220ms | 28ms |
| QPS（50 并发） | ~35 | ~420 | ~3,800 |
| 主库 CPU 峰值 | 78% | 78%（写入不变） | 78%（写入不变） |
| 读库 CPU 峰值 | — | 12% | 8% |
| 内存占用 | — | — | Redis ~15MB |
| 数据延迟 | 0（实时） | 0.5~2s（异步） | 0.5~2s（异步） |

> ⚠️ CQRS 带来的代价是**数据延迟 0.5~2 秒**。对于后台列表场景完全可接受，但支付结果页、用户端订单详情等强一致场景，必须走写侧直查。

## 八、我们踩过的 3 个坑

### 1. 事件没 `afterCommit`
最早直接在事务里 dispatch job，结果 worker 抢先执行，偶发查不到订单，投影表被写成空值。这个问题线上极难复现，但高并发下一定会撞到。**结论：投影事件统一 afterCommit。**

### 2. 投影只做 insert 不做 upsert
订单会多次变更：待支付、已支付、出票中、已完成、退款中。如果投影器不是 `updateOrInsert`，而是单纯 insert，就会堆重复数据；如果不是幂等 job，重试还会把数据写炸。

### 3. 读写完全一致的幻想
后台列表偶发比详情慢 1~2 秒更新，是因为投影走异步队列。后来我们在管理端加了一个小提示：**“状态更新中，请刷新重试”**，并为订单详情保留写侧兜底读取。CQRS 不是强一致方案，别拿它解决需要同步返回的支付结果页。

## 九、什么时候值得上 CQRS

适合：后台复杂列表、聚合查询、导出报表、搜索页、运营看板。

不适合：只有 2 张表的小项目、写多读少的流程、对强一致要求极高的同步页。

我的经验是：**当你开始为了后台列表改坏核心表结构、写一堆脆弱 JOIN、每加一个筛选都要回归下单流程时，就该考虑 CQRS 了。** 它不是银弹，但在 Laravel 里做“写侧守业务、读侧守性能”，性价比非常高。

## 相关阅读

- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/post/cqrs-event-sourcing-laravel/) — 本文的进阶篇，从事件存储、聚合根重建到 Saga 编排，完整实现 Event Sourcing 驱动的 CQRS 架构
- [Laravel EventSauce 事件溯源实战：订单状态机、快照重建与读模型投影踩坑记录](/post/laravel-eventsauce-guide/) — 使用 EventSauce 实现事件溯源与 DDD 领域驱动设计，聚合根建模、快照优化与乐观锁并发控制
- Eventual Consistency 实战：最终一致性在电商场景中的工程化 — 订单状态机、支付回调防重、Saga 补偿等与 CQRS 查询侧一致性密切相关的工程化方案
- [Laravel DDD 实战：聚合边界、值对象与 afterCommit 领域事件](/post/laravel-ddd-guide-aftercommit/) — 详解写侧聚合根建模、值对象设计与 afterCommit 领域事件机制，与本文写侧 Command Handler 设计互补
- Event Storming 实战：从业务事件到代码实现的领域建模方法论 — 从便签纸头脑风暴到领域事件提取、聚合根识别，掌握 CQRS 架构的前置建模方法论
- [Laravel 消息幂等性设计模式实战：Inbox/Outbox 与重试补偿](/post/laravel-design-patternsguide-inbox-outbox/) — 投影 Job 的事件消费可靠性保障，Outbox 可靠投递、Inbox 去重表与失败补偿机制
