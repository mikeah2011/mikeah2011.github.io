---

title: MySQL-分库分表实战-30-仓库数据库拆分经验与踩坑记录
keywords: [MySQL, 分库分表实战, 仓库数据库拆分经验与踩坑记录]
date: 2026-05-05 06:40:43
updated: 2026-05-05 06:42:39
categories:
- database
tags:
- KKday
- Laravel
- MySQL
description: 基于 KKday B2C 后端 30+ 仓库的 MySQL 分库分表实战经验，深度对比 ShardingSphere vs Vitess vs ProxySQL 三种中间件方案选型，涵盖垂直拆分、水平分片策略、Laravel 多数据源配置、Snowflake 分布式 ID 生成、跨分片分页查询与聚合统计、双写灰度数据迁移全流程，附 10 个真实踩坑案例、可运行的 SQL 与 Laravel 代码示例，适合千万级数据量的电商后端团队参考。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-01-content-1.jpg
- /images/content/databases-01-content-2.jpg
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

![MySQL 分库分表架构](/images/content/databases-01-content-1.jpg)

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

![水平分片架构](/images/content/databases-01-content-2.jpg)

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

## 8. 分库分表中间件深度对比：ShardingSphere vs Vitess vs ProxySQL

选择合适的分库分表中间件是架构决策的关键一环。以下是三种主流方案的深度对比：

| 维度 | ShardingSphere-Proxy | Vitess (PlanetScale) | ProxySQL |
|------|---------------------|---------------------|----------|
| **定位** | 分布式数据库中间件 | MySQL 集群编排系统 | 高级 MySQL 代理 |
| **分片能力** | ✅ 内置，支持 HASH/RANGE/复合分片 | ✅ 内置，基于 RANGE 分片 | ❌ 无原生分片，需配合应用层 |
| **协议透明** | ✅ MySQL 协议兼容，Laravel 零改动 | ✅ MySQL 协议兼容 | ✅ MySQL 协议兼容 |
| **跨分片 JOIN** | ✅ 支持，Proxy 层归并 | ⚠️ 有限支持，需 VReplication | ❌ 不支持 |
| **分布式事务** | ✅ XA 事务 + BASE | ✅ 2PC (Vitess 2PC) | ❌ 不支持 |
| **Online DDL** | ⚠️ 依赖外部工具 | ✅ 内置 Online DDL | ❌ 不支持 |
| **运维复杂度** | ⭐⭐⭐ 中等（需 ZooKeeper/Standalone） | ⭐⭐⭐⭐ 高（需 etcd + VTGate + VTTablet） | ⭐⭐ 低（单进程） |
| **Laravel 集成** | 改 host/port 即可，零代码 | 改 host/port 即可，零代码 | 改 host/port 即可，零代码 |
| **社区生态** | Apache 基金会，中国生态强 | CNCF 毕业项目，全球生态强 | 社区活跃，轻量级 |
| **适用规模** | 10~100 库 | 100~1000+ 库 | 读写分离 + 连接池 |
| **生产案例** | 京东、滴滴、当当 | Slack、GitHub、YouTube | Booking.com、Zalando |

**我们的选择：ShardingSphere-Proxy**

理由：
1. **Laravel 零改动**：ShardingSphere-Proxy 对 Laravel 暴露标准 MySQL 协议，只需要修改 `config/database.php` 的 host 和 port，不需要改任何业务代码
2. **分片策略灵活**：支持 INLINE 表达式自定义分片算法，我们的 `user_id % 5` 只需要一行 YAML
3. **跨分片查询内建**：Proxy 层自动做结果归并，Laravel 的 `orderBy`/`limit` 都能正确工作
4. **运维友好**：单实例部署即可（无需 ZooKeeper），配合 Docker Compose 一键启动

**Vitess 适合什么场景？**

如果团队规模大、数据库实例超过 100 个、需要 Online DDL 和自动扩缩容，Vitess 是更好的选择。PlanetScale（Vitess 商业版）提供了完整的 Serverless MySQL 体验，但成本较高。

**ProxySQL 的正确用法**

ProxySQL 不是分库分表方案，而是**读写分离 + 连接池 + 查询缓存**的最佳选择。在我们的 27 个不需要分片的仓库中，有 8 个用 ProxySQL 做读写分离，效果显著：

```yaml
# proxysql.cnf 核心配置
mysql_servers:
  - address: mysql-master
    port: 3306
    hostgroup: 10  # 写组
  - address: mysql-slave-1
    port: 3306
    hostgroup: 20  # 读组
  - address: mysql-slave-2
    port: 3306
    hostgroup: 20

mysql_query_rules:
  - match_pattern: "^SELECT .*"
    destination_hostgroup: 20  # SELECT 路由到读组
    apply: 1
  - match_pattern: "^(INSERT|UPDATE|DELETE).*"
    destination_hostgroup: 10  # 写操作路由到主库
    apply: 1
```

```php
// Laravel 配置 ProxySQL（比原生读写分离更强大）
// config/database.php
'proxy_mysql' => [
    'driver' => 'mysql',
    'host' => env('PROXYSQL_HOST', '127.0.0.1'),
    'port' => (int) env('PROXYSQL_PORT', 6033),  // ProxySQL 默认端口
    'database' => env('DB_DATABASE'),
    'username' => env('PROXYSQL_USER'),
    'password' => env('PROXYSQL_PASS'),
    // 不需要配 read/write，ProxySQL 自动路由
],
```

### 8.1 分片算法对比：HASH vs RANGE vs 一致性哈希

| 算法 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|----------|
| **HASH_MOD** | `user_id % N` | 均匀分布、简单 | 扩容需数据迁移 | 分片数固定 |
| **RANGE** | 按 ID 范围划分 | 范围查询高效 | 热点写入（自增 ID） | 时间序列数据 |
| **一致性哈希** | 哈希环 + 虚拟节点 | 扩容只需迁移 1/N 数据 | 实现复杂 | 频繁扩容 |
| **基因法** | ID 末 N 位编码分片信息 | 精确定位分片 | ID 生成需特殊处理 | 高性能场景 |

**踩坑 #8：HASH_MOD 扩容是灾难**

`user_id % 5` 改成 `user_id % 8`，几乎 100% 的数据需要重新分布。生产环境扩容必须用**双写 + 灰度切流**（和数据迁移一样的流程），预计耗时 2-4 周。

我们的最终方案：**预留分片数**。初始就按 8 库 4 表（32 个物理分片）规划，前期只用 3 库，剩余 5 库以空库形式存在。扩容时只需把数据从旧库迁移到空库，不需要改分片算法。

```sql
-- 预留分片：初始只有 ds0~ds2 有数据，ds3~ds7 为空
-- 扩容时的数据迁移 SQL（伪代码）
INSERT INTO ds3.orders_0 SELECT * FROM ds0.orders_0 WHERE user_id % 8 = 3;
INSERT INTO ds4.orders_0 SELECT * FROM ds0.orders_0 WHERE user_id % 8 = 4;
-- ... 逐表迁移，双写期间新旧库同时写入
```

### 8.2 MySQL 分区表 vs 分库分表：何时用哪个？

很多团队混淆了**分区表**和**分库分表**。它们解决的问题不同：

| 维度 | MySQL 分区表 | 分库分表 |
|------|-------------|----------|
| **透明性** | ✅ 完全透明，SQL 不改 | ❌ 需中间件或改代码 |
| **性能上限** | 单机瓶颈（CPU/IO） | 可跨机器扩展 |
| **运维成本** | ⭐ 低（MySQL 内建） | ⭐⭐⭐⭐ 高（中间件+多实例） |
| **适用数据量** | 单表 5000 万~5 亿 | 单表 > 5 亿或写 QPS > 5000 |
| **跨分区查询** | ✅ MySQL 自动路由 | ⚠️ 需中间件支持 |

**我们的经验**：`logs` 和 `user_behaviors` 表用 MySQL RANGE 分区（按月），单机扛住了 3 亿行数据，延迟从 2s 降到 50ms。只有 `orders` 表因为写 QPS 太高（峰值 8000/s），才真正需要分库分表。

```sql
-- orders 表的月度分区（配合分库分表使用）
CREATE TABLE orders_0 (
    id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
    PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
    PARTITION p202603 VALUES LESS THAN (TO_DAYS('2026-04-01')),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

## 9. 真实踩坑案例补充

### 踩坑 #9：ShardingSphere 的 `INSERT ... ON DUPLICATE KEY UPDATE` 陷阱

ShardingSphere-Proxy 对 `INSERT ... ON DUPLICATE KEY UPDATE` 的支持有限。如果分片键不在 `ON DUPLICATE KEY UPDATE` 的唯一索引中，会导致**跨分片更新失败**。

```sql
-- ❌ 会报错：sharding column user_id is not in unique key
INSERT INTO orders (order_id, user_id, status)
VALUES (123, 456, 'pending')
ON DUPLICATE KEY UPDATE status = 'paid';
-- order_id 是唯一索引，但分片键是 user_id

-- ✅ 正确做法：拆成两步
UPDATE orders SET status = 'paid' WHERE order_id = 123 AND user_id = 456;
-- 如果 affected_rows = 0，再 INSERT
INSERT INTO orders (order_id, user_id, status) VALUES (123, 456, 'pending');
```

### 踩坑 #10：连接池耗尽导致雪崩

ShardingSphere-Proxy 默认连接池大小为 128。在 20 个物理分片的场景下，每个前端连接需要占用 20 个后端连接（每个分片一个），所以 ShardingSphere-Proxy 最多只能服务 `128 / 20 = 6` 个前端连接。

```yaml
# ShardingSphere server.yaml - 调大连接池
authority:
  users:
    - user: root@%
      password: root
  privilege:
    type: ALL_PERMITTED

props:
  proxy-frontend-database-protocol-type: MySQL
  proxy-frontend-executor-size: 64          # 前端线程数
  proxy-backend-executor-suitable: OLTP     # OLTP 场景优化
  proxy-frontend-max-connections: 500       # 最大前端连接数
```

**经验公式**：`proxy-frontend-max-connections >= Laravel php-fpm worker 数 × 2`

### 踩坑 #11：GROUP BY 在分片上的行为差异

```php
// ❌ 这条 SQL 在分片上可能返回错误结果
DB::connection('sharding_orders')
    ->table('orders')
    ->selectRaw('status, COUNT(*) as cnt')
    ->groupBy('status')
    ->get();
// ShardingSphere 会：1) 每个分片执行 GROUP BY  2) 在 Proxy 层合并
// 但如果某个分片没有某个 status，合并后该 status 的 COUNT 可能不准

// ✅ 更安全的做法：用 global_counters 表或异步聚合
// 或者确保 GROUP BY 的列是分片键相关的（同一个 status 的数据在同一个分片）
```

> 💡 **延伸阅读**：
> - [Laravel + MySQL 索引性能调研笔记](/01_MySQL/索引/Laravel-MySQL-索引性能调研笔记-EXPLAIN-分析覆盖索引最左前缀原则/)
> - [百万级数据表查询优化实战](/01_MySQL/百万级数据表查询优化实战-Laravel-B2C-API-EXPLAIN-深度分析索引重构与分页治理踩坑记录/)
> - [Redis Lua 脚本原子操作实战](/06_Redis/Redis-Lua-脚本原子操作实战-分布式限流库存扣减排行榜-Laravel-B2C-API踩坑记录/)

## 相关阅读

- [PlanetScale Serverless MySQL 实战：Vitess 驱动的无服务器数据库——与 Laravel 集成的分支工作流、Online DDL 与性能基准](/01_MySQL/planetscale-serverless-mysql-laravel-vitess-workflow-benchmark/)
- [数据库分区表实战：MySQL Range/List/Hash 分区——Laravel 中的月度订单表分区策略与查询路由](/01_MySQL/2026-06-05-MySQL-分区表实战-Range-List-Hash-Laravel月度订单分区策略与查询路由/)
- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/00_架构/saga-orchestration-pattern-laravel-distributed-transaction/)
