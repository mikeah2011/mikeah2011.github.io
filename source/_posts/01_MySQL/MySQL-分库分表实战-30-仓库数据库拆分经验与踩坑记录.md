---
title: MySQL-分库分表实战-30-仓库数据库拆分经验与踩坑记录
date: 2026-05-05 06:40:43
updated: 2026-05-05 06:42:39
categories:
  - MySQL
tags: [KKday, Laravel, MySQL]
description: 基于 KKday B2C 后端 30+ 仓库的分库分表实战经验，涵盖垂直拆分、水平分片、Laravel 多数据源配置、分布式 ID 生成、跨分片查询、数据迁移等核心场景，附真实代码与踩坑记录。
---

# MySQL 分库分表实战：30+ 仓库的数据库拆分经验与踩坑记录

> 系统上线一年后，`orders` 表突破 8000 万行，单表查询 P99 从 50ms 飙到 2s。垂直拆分、水平分片、读写分离……该用哪种？怎么用？这篇文章记录了我在 KKday B2C 后端 30+ 仓库中踩过的每一个坑。

---

## 1. 什么时候该考虑分库分表？

很多团队一上来就搞分库分表，结果引入大量复杂度却收益甚微。我的判断标准是**三道红线**：

```
┌─────────────────────────────────────────────────┐
│           什么时候该拆？三道红线                    │
├─────────────────────────────────────────────────┤
│ 🔴 单表行数 > 5000万，索引优化已穷尽               │
│ 🔴 单库写 QPS > 5000，CPU 持续 > 70%             │
│ 🔴 单表数据量 > 100GB，备份/恢复超 4 小时          │
├─────────────────────────────────────────────────┤
│ ✅ 先做：索引优化 → 读写分离 → 冷热分离             │
│ ❌ 别做：一上来就 16 分片，杀鸡用牛刀               │
└─────────────────────────────────────────────────┘
```

在 30+ 仓库中，**真正需要水平分片的只有 3 个**（订单、日志、用户行为）。其余的通过索引优化 + 读写分离就解决了。

---

## 2. 垂直拆分 vs 水平分片

### 2.1 垂直拆分：按业务边界拆库

这是最常见的第一步。在 B2C 电商场景中，我们把一个巨型单库按业务域拆开：

```
┌──────────────────────────────────────────────────────┐
│                    垂直拆分架构                        │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ order_db │  │ user_db  │  │ product_db│            │
│  │──────────│  │──────────│  │──────────│            │
│  │ orders   │  │ users    │  │ products │            │
│  │ payments │  │ profiles │  │ skus     │            │
│  │ refunds  │  │ addresses│  │ inventory│            │
│  └──────────┘  └──────────┘  └──────────┘            │
│       ▲              ▲             ▲                  │
│       └──────────────┼─────────────┘                  │
│                 BFF / API Gateway                     │
└──────────────────────────────────────────────────────┘
```

**踩坑 #1：跨库 JOIN 消失了**

垂直拆分后，`SELECT o.*, u.name FROM orders o JOIN users u` 直接报错。我们用 Laravel 的方式解决：

```php
// ❌ 拆分前：单库 JOIN（已不可能）
$orders = DB::table('orders')
    ->join('users', 'orders.user_id', '=', 'users.id')
    ->get();

// ✅ 拆分后：应用层组装
$orderIds = DB::connection('order_db')
    ->table('orders')
    ->where('status', 'paid')
    ->pluck('user_id')
    ->unique();

$users = DB::connection('user_db')
    ->table('users')
    ->whereIn('id', $orderIds)
    ->get()
    ->keyBy('id');

$orders = DB::connection('order_db')
    ->table('orders')
    ->where('status', 'paid')
    ->get()
    ->map(fn ($order) => (object) array_merge(
        (array) $order,
        ['user_name' => $users[$order->user_id]->name ?? 'Unknown']
    ));
```

**踩坑 #2：分布式事务**

一笔订单涉及 `order_db.orders` + `user_db.user_points` + `product_db.inventory` 三个库，没法用单库事务。我们用 **Saga 模式 + 补偿队列**：

```php
// app/Jobs/OrderSagaJob.php
class OrderSagaJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(): void
    {
        $steps = [
            new DeductInventoryStep($this->orderId, $this->items),
            new DeductUserPointsStep($this->orderId, $this->userId, $this->points),
            new CreatePaymentStep($this->orderId, $this->amount),
        ];

        $completedSteps = [];

        try {
            foreach ($steps as $step) {
                $step->execute();
                $completedSteps[] = $step;
            }
        } catch (\Throwable $e) {
            // 补偿回滚：逆序执行 compensate()
            foreach (array_reverse($completedSteps) as $step) {
                $step->compensate();
            }
            throw $e;
        }
    }
}
```

---

### 2.2 水平分片：按规则拆行

当单表行数突破 5000 万时，垂直拆分不够了，需要水平分片。我们用 **ShardingSphere-Proxy** 做中间件层，对 Laravel 应用透明。

```
┌────────────────────────────────────────────────────────────┐
│                   水平分片架构                               │
│                                                            │
│  Laravel API                                              │
│       │                                                    │
│       ▼                                                    │
│  ┌─────────────────┐                                       │
│  │ ShardingSphere   │  ← 对 Laravel 暴露单一 MySQL 连接     │
│  │    Proxy         │                                       │
│  └────────┬────────┘                                       │
│           │                                                │
│     ┌─────┼─────┬─────┬─────┐                             │
│     ▼     ▼     ▼     ▼     ▼                             │
│  ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐                     │
│  │ db0 ││ db1 ││ db2 ││ db3 ││ db4 │                     │
│  │_t0  ││_t0  ││_t0  ││_t0  ││_t0  │                     │
│  │_t1  ││_t1  ││_t1  ││_t1  ││_t1  │                     │
│  │_t2  ││_t2  ││_t2  ││_t2  ││_t2  │                     │
│  │_t3  ││_t3  ││_t3  ││_t3  ││_t3  │                     │
│  └─────┘└─────┘└─────┘└─────┘└─────┘                     │
│  5 库 × 4 表 = 20 个物理分片                                │
└────────────────────────────────────────────────────────────┘
```

分片算法选择（orders 表为例）：

```yaml
# ShardingSphere rules.yaml
rules:
  - !SHARDING
    tables:
      orders:
        actualDataNodes: ds${0..4}.orders_${0..3}
        databaseStrategy:
          standard:
            shardingColumn: user_id
            shardingAlgorithmName: user_db_hash
        tableStrategy:
          standard:
            shardingColumn: order_id
            shardingAlgorithmName: order_id_hash
    shardingAlgorithms:
      user_db_hash:
        type: HASH_MOD
        props:
          sharding-count: 5
      order_id_hash:
        type: HASH_MOD
        props:
          sharding-count: 4
```

**踩坑 #3：分片键选错 = 灾难**

最初我们用 `created_at` 做分片键（按月分），结果：
- 热点写入：月末最后一天写入量暴增，单库打满
- 跨片查询：`WHERE user_id = 123` 需要扫所有 20 个分片

最终改为 `user_id` 做库级分片键：同一个用户的所有订单在同一个库，`user_id` 维度的查询只需命中 1 个库。

**踩坑 #4：分布式 ID 生成**

自增 ID 在分片环境下会冲突。我们用 **Snowflake 改良版**：

```php
// app/Services/SnowflakeIdGenerator.php
class SnowflakeIdGenerator
{
    private int $epoch = 1609459200000; // 2021-01-01
    private int $machineId;
    private int $sequence = 0;
    private int $lastTimestamp = 0;

    public function __construct(int $machineId)
    {
        $this->machineId = $machineId & 0x3FF; // 10 bit, max 1023
    }

    public function nextId(): string
    {
        $timestamp = (int) (microtime(true) * 1000);

        if ($timestamp === $this->lastTimestamp) {
            $this->sequence = ($this->sequence + 1) & 0xFFF; // 12 bit
            if ($this->sequence === 0) {
                while ($timestamp <= $this->lastTimestamp) {
                    $timestamp = (int) (microtime(true) * 1000);
                }
            }
        } else {
            $this->sequence = 0;
        }

        $this->lastTimestamp = $timestamp;

        // 41 bit timestamp | 10 bit machine | 12 bit sequence
        $id = (($timestamp - $this->epoch) << 22)
            | ($this->machineId << 12)
            | $this->sequence;

        return (string) $id;
    }
}

// 使用方式
$generator = new SnowflakeIdGenerator(config('app.machine_id'));
$orderId = $generator->nextId(); // "6781234567890123456"
```

---

## 3. Laravel 多数据源配置实战

Laravel 原生支持多数据库连接，分库场景下配置如下：

```php
// config/database.php
'connections' => [
    // 垂直拆分：业务库
    'order_db' => [
        'driver' => 'mysql',
        'host' => env('ORDER_DB_HOST', '127.0.0.1'),
        'database' => env('ORDER_DB_DATABASE', 'order_db'),
        'username' => env('ORDER_DB_USERNAME'),
        'password' => env('ORDER_DB_PASSWORD'),
        // 读写分离
        'read' => [
            'host' => [
                env('ORDER_DB_READ_HOST_1', '127.0.0.1'),
                env('ORDER_DB_READ_HOST_2', '127.0.0.1'),
            ],
        ],
        'write' => [
            'host' => [
                env('ORDER_DB_WRITE_HOST', '127.0.0.1'),
            ],
        ],
        'sticky' => true, // 本次请求写后读走主库
    ],

    // 水平分片：走 ShardingSphere-Proxy
    'sharding_orders' => [
        'driver' => 'mysql',
        'host' => env('SHARDING_PROXY_HOST', '127.0.0.1'),
        'port' => (int) env('SHARDING_PROXY_PORT', 3307),
        'database' => 'orders', // 逻辑库名
        'username' => env('SHARDING_PROXY_USER'),
        'password' => env('SHARDING_PROXY_PASS'),
    ],
],
```

**踩坑 #5：`sticky` 选项必须开**

不开 `sticky` 时，同一请求内先写后读，读请求可能路由到还没同步的从库，导致「写完读不到」的幻觉。这是分库后最常被报的「数据丢失」Bug，其实数据没丢，是从库延迟。

---

## 4. 跨分片查询与聚合

水平分片后最痛的问题：**分页查询和聚合统计**。

### 4.1 跨分片分页

```php
// ❌ 直接 OFFSET/LIMIT 在分片上会错
// ShardingSphere 会把每个分片的 OFFSET 0, 100 拼起来，结果不对

// ✅ 正确做法：归并排序 + 二次查询
class ShardedPaginator
{
    public function paginate(string $table, array $where, int $page, int $perPage): array
    {
        // 第一次：只查各分片的 ID + 排序键（轻量）
        $shardIds = DB::connection('sharding_orders')
            ->table($table)
            ->where($where)
            ->orderBy('created_at', 'desc')
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->pluck('id');

        if ($shardIds->isEmpty()) {
            return ['data' => [], 'total' => 0];
        }

        // 第二次：用精确 ID 查完整数据
        $data = DB::connection('sharding_orders')
            ->table($table)
            ->whereIn('id', $shardIds)
            ->orderBy('created_at', 'desc')
            ->get();

        return ['data' => $data, 'total' => $shardIds->count()];
    }
}
```

### 4.2 跨分片 COUNT/聚合

**踩坑 #6：千万别在分片上做 `SELECT COUNT(*)`**

ShardingSphere 会向所有 20 个分片发 `COUNT(*)`，然后在 Proxy 层求和。如果数据量大，这个操作会很慢且消耗大量内存。

我们的方案：**维护一张全局计数表 + 异步更新**。

```php
// 每次下单后，通过消息队列异步更新计数
class UpdateOrderCountJob implements ShouldQueue
{
    public function handle(): void
    {
        DB::table('global_counters')
            ->where('key', 'total_orders')
            ->increment('value');

        // 按日期的计数也同步更新
        DB::table('global_counters')
            ->where('key', 'orders_' . now()->format('Ymd'))
            ->increment('value');
    }
}
```

---

## 5. 数据迁移：从单表到分片

这是最危险的环节。我们用**双写 + 灰度切流**方案：

```
┌─────────────────────────────────────────────────────┐
│               数据迁移四阶段                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Phase 1: 影子表                                      │
│   单表(orders) ──复制──> 分片表(orders_0~19)         │
│   读：单表                                          │
│                                                     │
│ Phase 2: 双写                                        │
│   写：同时写 单表 + 分片表                            │
│   读：单表                                          │
│                                                     │
│ Phase 3: 数据校验                                     │
│   对比 单表 vs 分片表 的数据一致性                     │
│   不一致则修复后重跑校验                              │
│                                                     │
│ Phase 4: 灰度切读                                    │
│   5% 流量读分片表 → 20% → 50% → 100%               │
│   全量切读成功后，停止双写，下线单表                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**踩坑 #7：双写期间的 `LAST_INSERT_ID()` 行为异常**

双写时，先插单表再插分片表。如果用 `LAST_INSERT_ID()` 获取自增 ID，分片表的插入会改变返回值，导致后续逻辑取到错误的 ID。解决方案：改用 Snowflake ID，完全不依赖数据库自增。

---

## 6. 分库分表的替代方案

在 30+ 仓库中，有 27 个仓库最终**不需要**分库分表。以下是更轻量的替代方案：

| 方案 | 适用场景 | 复杂度 | 我们用的仓库数 |
|------|---------|--------|--------------|
| 索引优化 | 查询慢但数据量 < 5000 万 | ⭐ | 15 |
| 读写分离 | 写少读多，读 QPS > 3000 | ⭐⭐ | 8 |
| 冷热分离 | 历史数据多但访问少 | ⭐⭐ | 6 |
| 垂直拆分 | 业务边界清晰，单库 > 50 张表 | ⭐⭐⭐ | 4 |
| 水平分片 | 单表 > 5000 万行 | ⭐⭐⭐⭐⭐ | 3 |

---

## 7. 总结：分库分表 Checklist

在决定分库分表前，按顺序过一遍：

```
□ 1. 索引优化做了吗？EXPLAIN 分析了吗？
□ 2. 读写分离做了吗？从库分担负载了吗？
□ 3. 冷热数据分离了吗？历史归档了吗？
□ 4. 垂直拆分做了吗？业务库独立了吗？
□ 5. 真的需要水平分片吗？数据量到 5000 万了吗？
□ 6. 分片键选对了吗？能覆盖 80% 的查询条件吗？
□ 7. 分布式 ID 方案定了吗？不依赖自增了吗？
□ 8. 跨分片查询方案有了吗？分页/聚合怎么处理？
□ 9. 数据迁移方案定了吗？灰度切流还是停机迁移？
□ 10. 回滚方案有了吗？双写能随时切回单表吗？
```

分库分表不是银弹，它是最后的手段。在 30+ 仓库的实战中，绝大多数性能问题通过索引优化和读写分离就解决了。只有当你确实触碰到了单机瓶颈，才应该走上这条复杂度最高的路。

---

> 💡 **延伸阅读**：
> - [Laravel + MySQL 索引性能调研笔记](/01_MySQL/索引/Laravel-MySQL-索引性能调研笔记-EXPLAIN-分析覆盖索引最左前缀原则/)
> - [百万级数据表查询优化实战](/01_MySQL/百万级数据表查询优化实战-Laravel-B2C-API-EXPLAIN-深度分析索引重构与分页治理踩坑记录/)
> - [Redis Lua 脚本原子操作实战](/06_Redis/Redis-Lua-脚本原子操作实战-分布式限流库存扣减排行榜-Laravel-B2C-API踩坑记录/)
