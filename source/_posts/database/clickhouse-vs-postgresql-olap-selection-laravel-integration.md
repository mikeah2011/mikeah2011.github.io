---

title: ClickHouse vs PostgreSQL 分析查询对比：OLAP 场景下的选型决策与 Laravel 集成
keywords: [ClickHouse vs PostgreSQL, OLAP, Laravel, 分析查询对比, 场景下的选型决策与]
date: 2026-06-02 10:00:00
description: ClickHouse vs PostgreSQL OLAP 选型实战指南，基于千万级订单明细表的真实性能对比。详解行存与列存的本质差异、ClickHouse MergeTree 引擎优化技巧、PostgreSQL 物化视图与列存扩展方案，以及 Debezium CDC 实时同步架构。包含 Laravel 集成代码、硬件成本对比（TCO 分析）、数据一致性校验方案，帮助团队在 5000 万行以下用 PostgreSQL、1 亿行以上引入 ClickHouse 的选型决策。
tags:
- ClickHouse
- PostgreSQL
- OLAP
- Laravel
- 数据库
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---



# ClickHouse vs PostgreSQL 分析查询对比：OLAP 场景下的选型决策与 Laravel 集成

## 前言

在 KKday B2C API 的演进过程中，我们遇到了一个经典的架构难题：OLTP 业务跑在 MySQL/PostgreSQL 上很顺畅，但运营报表、数据分析、BI 看板等 OLAP 查询越来越慢，一张千万级的订单明细表做 GROUP BY 聚合经常超时 30 秒以上。

团队内部出现了两种声音：
- **A 方案**：直接用 PostgreSQL 的列存扩展（cstore_fdw / 列式索引），不引入新组件
- **B 方案**：引入 ClickHouse 作为分析引擎，通过 ETL 同步数据

这篇文章记录了我们从技术调研、基准测试、架构设计到最终落地的完整过程，希望能给面临类似选型困境的团队一些参考。

---

## 一、OLAP vs OLTP：为什么传统关系型数据库做分析会慢？

### 1.1 行存 vs 列存的本质差异

传统关系型数据库（MySQL、PostgreSQL）采用**行存储**（Row-oriented Storage），每一行的数据在磁盘上连续存放：

```
行存布局：
| order_id | user_id | amount | status | created_at | product_name |
| 100001   | 5001    | 299.00 | paid   | 2026-01-15 | 东京塔门票     |
| 100002   | 5002    | 159.00 | paid   | 2026-01-15 | 大阪周游卡     |
```

这种布局对 OLTP 非常友好——读取一行完整记录只需要一次磁盘 IO。但对于 OLAP 查询（如 `SELECT status, SUM(amount) FROM orders GROUP BY status`），数据库需要扫描全表，即使只需要 2 列，也必须把每行的 6 列全部读入内存。

ClickHouse 采用**列存储**（Column-oriented Storage），同一列的数据连续存放：

```
列存布局：
order_id 列：[100001, 100002, 100003, ...]
user_id 列：  [5001, 5002, 5003, ...]
amount 列：   [299.00, 159.00, 459.00, ...]
status 列：   [paid, paid, refunded, ...]
```

对于只涉及少量列的聚合查询，列存只需要读取相关列的数据块，IO 量可能只有行存的 1/5 甚至 1/10。

### 1.2 压缩效率的差异

列存还有一个巨大的优势：**同类型数据连续存储，压缩率极高**。

- `status` 列只有几个枚举值，压缩后几乎零开销
- `amount` 列是浮点数，使用 Gorilla 编码或 Delta 编码可以压缩到原始大小的 10%-20%
- `created_at` 列是单调递增的时间戳，Delta 编码效果极好

在我们的实测中，ClickHouse 的 1 亿行订单数据压缩后磁盘占用仅为 PostgreSQL 的 1/8。

### 1.3 查询执行引擎的差异

| 特性 | PostgreSQL | ClickHouse |
|------|-----------|------------|
| 执行模型 | Volcano Iterator Model（逐行处理） | 向量化执行（批量处理） |
| 并行查询 | 支持（有限） | 原生多线程并行 |
| 索引 | B-Tree / GiST / GIN | 主键稀疏索引 + 跳数索引 |
| 物化视图 | 支持（增量更新有限） | 原生支持，实时增量聚合 |
| JOIN 策略 | Hash/Nested Loop/Merge | Hash/Join/Sort-Merge，但大表 JOIN 非强项 |

---

## 二、PostgreSQL OLAP 能力深度评估

很多人不知道，PostgreSQL 在 OLAP 方面其实有相当强的能力，不一定需要引入 ClickHouse。

### 2.1 PostgreSQL 的 OLAP 武器库

**并行查询（Parallel Query）**

```sql
-- PostgreSQL 会自动利用多核并行执行
EXPLAIN ANALYZE
SELECT status, COUNT(*), SUM(amount)
FROM orders
WHERE created_at >= '2026-01-01'
GROUP BY status;

-- 输出中会看到 Parallel Seq Scan / Parallel HashAggregate
```

PostgreSQL 从 9.6 开始支持并行查询，14+ 版本对并行的利用更加成熟。在 8 核机器上，一个全表聚合查询可以接近 4-5 倍加速。

**BRIN 索引（Block Range Index）**

对于时间序列数据，BRIN 索引比 B-Tree 索引小 100 倍以上：

```sql
-- 创建 BRIN 索引，只占用几 MB
CREATE INDEX idx_orders_created_brin
ON orders USING BRIN (created_at)
WITH (pages_per_range = 32);

-- 查询会自动利用 BRIN 索引跳过无关数据块
SELECT DATE(created_at), COUNT(*), SUM(amount)
FROM orders
WHERE created_at >= '2026-01-01' AND created_at < '2026-02-01'
GROUP BY DATE(created_at);
```

**物化视图（Materialized View）**

```sql
CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT
    DATE(created_at) AS sale_date,
    status,
    COUNT(*) AS order_count,
    SUM(amount) AS total_amount,
    AVG(amount) AS avg_amount
FROM orders
GROUP BY DATE(created_at), status;

-- 定期刷新
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales;
```

**CTAS（Create Table As Select）预聚合**

```sql
CREATE TABLE agg_daily_sales AS
SELECT
    DATE(created_at) AS sale_date,
    region,
    product_category,
    COUNT(*) AS order_count,
    SUM(amount) AS total_amount
FROM orders o
JOIN products p ON o.product_id = p.id
GROUP BY DATE(created_at), region, product_category;
```

**列存扩展（Cstore_fdw / Citus Columnar）**

```sql
-- 安装 Citus Columnar 扩展
CREATE EXTENSION columnar;

-- 创建列存表
CREATE TABLE analytics_events (
    event_id BIGINT,
    user_id BIGINT,
    event_type VARCHAR(50),
    properties JSONB,
    created_at TIMESTAMPTZ
) USING columnar;

-- 压缩设置
ALTER TABLE analytics_events SET (columnar.compression = 'zstd');
ALTER TABLE analytics_events SET (columnar.stripe_row_count = 150000);
```

### 2.2 PostgreSQL OLAP 的性能实测

我们在一台 8 核 32GB 的机器上，用 1 亿行订单数据做了测试：

| 查询类型 | PostgreSQL 16 | 说明 |
|---------|---------------|------|
| 单表 COUNT | 12s | Parallel Seq Scan |
| 单表 GROUP BY（2 列） | 18s | Parallel HashAggregate |
| 时间范围 + 聚合 | 3.2s | BRIN 索引命中 |
| 物化视图查询 | 0.05s | 直接读预计算结果 |
| 3 表 JOIN + 聚合 | 45s | 性能急剧下降 |

**结论**：PostgreSQL 在简单聚合、预计算场景下表现不错，但涉及复杂多表 JOIN 和即席查询（Ad-hoc Query）时力不从心。

---

## 三、ClickHouse OLAP 能力深度评估

### 3.1 ClickHouse 的核心优势

**MergeTree 引擎**

ClickHouse 的核心存储引擎 MergeTree 系列，天生为分析场景设计：

```sql
CREATE TABLE orders (
    order_id UInt64,
    user_id UInt64,
    product_id UInt32,
    amount Decimal(10, 2),
    status Enum8('pending' = 1, 'paid' = 2, 'shipped' = 3, 'refunded' = 4),
    region LowCardinality(String),
    created_at DateTime
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (region, created_at, user_id)
SETTINGS index_granularity = 8192;
```

关键设计点：
- **PARTITION BY**：按月分区，查询时自动裁剪无关分区
- **ORDER BY**：决定数据在磁盘上的物理排序，等价于稀疏索引
- **LowCardinality**：对低基数列（如 status、region）使用字典编码，查询速度提升 5-10 倍

**向量化执行引擎**

ClickHouse 的查询引擎一次处理 8192 行（一个 Granule），利用 SIMD 指令并行处理：

```sql
-- 这个查询在 ClickHouse 上通常 0.5s 内完成（1 亿行）
SELECT
    toStartOfMonth(created_at) AS month,
    region,
    count() AS orders,
    sum(amount) AS revenue,
    uniq(user_id) AS unique_users
FROM orders
WHERE created_at >= '2026-01-01'
GROUP BY month, region
ORDER BY month, revenue DESC;
```

**物化视图（实时增量聚合）**

ClickHouse 的物化视图与 PostgreSQL 不同，它是**实时增量**的——每次 INSERT 数据时，物化视图自动增量更新：

```sql
-- 创建目标表
CREATE TABLE agg_orders_by_day (
    day Date,
    region String,
    order_count SimpleAggregateFunction(sum, UInt64),
    total_amount SimpleAggregateFunction(sum, Decimal(10,2)),
    unique_users AggregateFunction(uniq, UInt64)
) ENGINE = AggregatingMergeTree()
ORDER BY (day, region);

-- 创建物化视图，自动增量聚合
CREATE MATERIALIZED VIEW mv_orders_by_day
TO agg_orders_by_day
AS SELECT
    toDate(created_at) AS day,
    region,
    count() AS order_count,
    sum(amount) AS total_amount,
    uniqState(user_id) AS unique_users
FROM orders
GROUP BY day, region;

-- 查询时直接读聚合结果，毫秒级响应
SELECT
    day,
    region,
    order_count,
    total_amount,
    uniqMerge(unique_users) AS unique_users
FROM agg_orders_by_day
WHERE day >= '2026-01-01'
GROUP BY day, region, order_count, total_amount
ORDER BY day;
```

### 3.2 ClickHouse 的基准测试数据

同样 1 亿行数据，同一台机器：

| 查询类型 | ClickHouse | PostgreSQL | 加速比 |
|---------|------------|------------|--------|
| 单表 COUNT | 0.3s | 12s | 40x |
| 单表 GROUP BY（2 列） | 0.5s | 18s | 36x |
| 时间范围 + 聚合 | 0.08s | 3.2s | 40x |
| 物化视图查询 | 0.003s | 0.05s | 17x |
| 3 表 JOIN + 聚合 | 2.1s | 45s | 21x |
| 去重（uniq） | 0.4s | 25s+ | 62x |
| Top N 排序 | 0.6s | 15s | 25x |

### 3.3 ClickHouse 的短板

ClickHouse 不是万能的，了解它的短板同样重要：

**不适合点查（Point Query）**

```sql
-- 这个查询在 ClickHouse 上可能需要 100ms+
SELECT * FROM orders WHERE order_id = 100001;
-- 因为 ClickHouse 的主键是稀疏索引，不能精确定位单行
```

**不适合频繁 UPDATE/DELETE**

```sql
-- ClickHouse 的 DELETE 是 Mutation，异步执行，性能差
ALTER TABLE orders DELETE WHERE order_id = 100001;
-- 这个操作可能需要几秒到几分钟

-- UPDATE 也是 Mutation
ALTER TABLE orders UPDATE status = 'refunded' WHERE order_id = 100001;
```

**大表 JOIN 有上限**

```sql
-- 两张大表 JOIN（各 1 亿行）可能消耗大量内存
SELECT *
FROM orders o
JOIN users u ON o.user_id = u.user_id;  -- 可能 OOM
```

**事务支持有限**

ClickHouse 不支持 ACID 事务，不支持外键约束，不适合做业务主库。

---

## 四、选型决策树

根据我们的实战经验，总结出以下决策流程：

```
你的查询模式是什么？
│
├── 简单聚合 + 数据量 < 5000 万行
│   └── PostgreSQL 就够了（物化视图 + BRIN 索引）
│
├── 简单聚合 + 数据量 > 5000 万行
│   └── ClickHouse（MergeTree + 物化视图）
│
├── 复杂多表 JOIN + 即席查询
│   └── ClickHouse（但需要做好数据建模，尽量宽表化）
│
├── 实时数据摄入 + 秒级查询
│   └── ClickHouse（Kafka Engine + 物化视图）
│
├── 需要频繁 UPDATE/DELETE
│   └── PostgreSQL（或 PostgreSQL + ClickHouse 双写）
│
├── 需要 ACID 事务
│   └── PostgreSQL
│
└── 混合场景（OLTP + OLAP）
    └── PostgreSQL 做主库 + ClickHouse 做分析库（ETL 同步）
```

### 4.1 场景对照表

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 运营日报/周报 | PostgreSQL 物化视图 | 数据量小，刷新频率低 |
| 实时大屏 | ClickHouse | 需要毫秒级响应 |
| 用户行为分析 | ClickHouse | 亿级事件数据，高基数去重 |
| 订单明细查询 | PostgreSQL | 点查 + 事务 |
| AB 实验分析 | ClickHouse | 多维度 GROUP BY + 去重 |
| 财务报表 | PostgreSQL | 需要精确 + 事务一致性 |
| 日志分析 | ClickHouse | 海量写入 + 时间范围聚合 |
| BI 自助查询 | ClickHouse | 即席查询，不可预测的 SQL |

---

## 五、Laravel 集成实战

### 5.1 架构设计

我们最终采用的架构是：**PostgreSQL 做 OLTP 主库 + ClickHouse 做 OLAP 分析库 + ETL 同步**

```
┌─────────────┐     INSERT      ┌──────────────┐
│  Laravel    │ ───────────────→ │  PostgreSQL  │  (OLTP 主库)
│  B2C API    │                  │  订单/用户/商品 │
└──────┬──────┘                  └──────────────┘
       │                              │
       │ Debezium CDC /               │ ETL (定时)
       │ pg_chameleon                  ↓
       │                     ┌──────────────┐
       │    SELECT           │  ClickHouse  │  (OLAP 分析库)
       └───────────────────→ │  宽表/聚合表    │
                             └──────────────┘
```

### 5.2 Laravel 数据库配置

```php
// config/database.php
'connections' => [
    'pgsql' => [
        'driver' => 'pgsql',
        'host' => env('DB_HOST', '127.0.0.1'),
        'port' => env('DB_PORT', '5432'),
        'database' => env('DB_DATABASE', 'b2c_api'),
        'username' => env('DB_USERNAME', 'postgres'),
        'password' => env('DB_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'schema' => 'public',
    ],

    'clickhouse' => [
        'driver' => 'clickhouse',
        'host' => env('CLICKHOUSE_HOST', '127.0.0.1'),
        'port' => env('CLICKHOUSE_PORT', '8123'),
        'database' => env('CLICKHOUSE_DATABASE', 'analytics'),
        'username' => env('CLICKHOUSE_USER', 'default'),
        'password' => env('CLICKHOUSE_PASSWORD', ''),
        'options' => [
            'timeout' => 30,
            'connect_timeout' => 5,
        ],
    ],
],
```

### 5.3 使用 smi2/phpclickhouse 包

```bash
composer require smi2/phpclickhouse
```

```php
// app/Services/ClickHouseService.php
namespace App\Services;

use ClickHouseDB\Client;

class ClickHouseService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client([
            'host' => config('database.connections.clickhouse.host'),
            'port' => config('database.connections.clickhouse.port'),
            'username' => config('database.connections.clickhouse.username'),
            'password' => config('database.connections.clickhouse.password'),
            'database' => config('database.connections.clickhouse.database'),
        ]);
    }

    /**
     * 查询日销售报表
     */
    public function getDailySales(string $startDate, string $endDate): array
    {
        $statement = $this->client->select(
            'SELECT
                day,
                region,
                order_count,
                total_amount,
                avg_order_value
            FROM agg_orders_by_day
            WHERE day BETWEEN :start AND :end
            ORDER BY day DESC',
            [
                'start' => $startDate,
                'end' => $endDate,
            ]
        );

        return $statement->rows();
    }

    /**
     * 查询用户漏斗分析
     */
    public function getFunnelAnalysis(string $date): array
    {
        $statement = $this->client->select(
            'SELECT
                funnel_step,
                count() AS users,
                round(count() / first_value(count()) OVER (ORDER BY funnel_step), 4) AS conversion_rate
            FROM user_events
            WHERE event_date = :date
            GROUP BY funnel_step
            ORDER BY funnel_step',
            ['date' => $date]
        );

        return $statement->rows();
    }

    /**
     * 批量写入事件数据
     */
    public function insertEvents(array $events): void
    {
        $this->client->insert(
            'user_events',
            $events,
            ['event_id', 'user_id', 'event_type', 'event_data', 'event_date', 'created_at']
        );
    }
}
```

### 5.4 使用 Laravel Database 直连 ClickHouse

如果你更喜欢用 Laravel 的 DB Facade，可以通过 HTTP 接口直连：

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Support\Facades\DB;

public function boot(): void
{
    // 自定义 ClickHouse 连接（通过 HTTP 接口）
    DB::extend('clickhouse', function (array $config) {
        $pdo = new \PDO(
            "clickhouse:host={$config['host']};port={$config['port']};dbname={$config['database']}",
            $config['username'] ?? 'default',
            $config['password'] ?? '',
            [
                \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            ]
        );

        return new \Illuminate\Database\Connection($pdo, $config['database'], '', $config);
    });
}
```

### 5.5 ETL 数据同步方案

我们使用了两种同步方式：

**方案一：定时全量/增量同步（适合小表）**

```php
// app/Jobs/SyncOrdersToClickHouse.php
namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;

class SyncOrdersToClickHouse implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 3;

    public function handle(): void
    {
        $lastSyncTime = cache('clickhouse:last_order_sync', '2026-01-01');

        // 从 PostgreSQL 增量读取
        $orders = DB::connection('pgsql')
            ->table('orders')
            ->join('products', 'orders.product_id', '=', 'products.id')
            ->join('users', 'orders.user_id', '=', 'users.id')
            ->where('orders.updated_at', '>', $lastSyncTime)
            ->select(
                'orders.id',
                'orders.user_id',
                'orders.product_id',
                'orders.amount',
                'orders.status',
                'orders.created_at',
                'products.category',
                'users.region'
            )
            ->limit(10000)
            ->get();

        if ($orders->isEmpty()) {
            return;
        }

        // 写入 ClickHouse
        $ch = app(ClickHouseService::class);
        $rows = $orders->map(fn($o) => [
            $o->id,
            $o->user_id,
            $o->product_id,
            $o->amount,
            $o->status,
            $o->category,
            $o->region,
            $o->created_at->format('Y-m-d H:i:s'),
        ])->toArray();

        $ch->insertEvents($rows);

        // 更新同步时间点
        cache(['clickhouse:last_order_sync' => $orders->last()->updated_at]);

        // 如果还有更多数据，继续同步
        if ($orders->count() === 10000) {
            self::dispatch();
        }
    }
}
```

**方案二：Debezium CDC 实时同步（推荐生产环境）**

```
PostgreSQL → Debezium (WAL 读取) → Kafka → ClickHouse Kafka Engine
```

```sql
-- ClickHouse 端创建 Kafka 引擎表
CREATE TABLE orders_kafka (
    order_id UInt64,
    user_id UInt64,
    product_id UInt32,
    amount Decimal(10, 2),
    status String,
    region String,
    created_at DateTime
) ENGINE = Kafka()
SETTINGS
    kafka_broker_list = 'kafka:9092',
    kafka_topic_list = 'cdc.orders',
    kafka_group_name = 'clickhouse_orders_consumer',
    kafka_format = 'JSONEachRow',
    kafka_num_consumers = 3;

-- 物化视图自动将 Kafka 数据写入 MergeTree
CREATE MATERIALIZED VIEW orders_mv TO orders AS
SELECT * FROM orders_kafka;

-- 最终的 MergeTree 表
CREATE TABLE orders (
    order_id UInt64,
    user_id UInt64,
    product_id UInt32,
    amount Decimal(10, 2),
    status LowCardinality(String),
    region LowCardinality(String),
    created_at DateTime
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (region, created_at, user_id);
```

---

## 六、踩坑记录

### 踩坑一：ClickHouse 的 JOIN 顺序很重要

```sql
-- ❌ 错误：大表在前，小表在后（默认 JOIN 算法是 hash join，右表加载到内存）
SELECT o.*, p.name
FROM orders o  -- 1 亿行
JOIN products p ON o.product_id = p.product_id;  -- 1 万行

-- ✅ 正确：小表在前，大表在后（或者使用 JOIN 算子提示）
SELECT o.*, p.name
FROM products p
JOIN orders o ON p.product_id = o.product_id;

-- 或者使用 settings
SET joined_subquery_requires_alias = 0;
SELECT /*+ JOIN_ORDER(orders, products) */ o.*, p.name
FROM orders o
JOIN products p ON o.product_id = p.product_id;
```

### 踩坑二：LowCardinality 滥用导致性能下降

```sql
-- ❌ 错误：高基数列使用 LowCardinality（如 user_id，有数百万不同值）
CREATE TABLE events (
    user_id LowCardinality(UInt64),  -- 错误！基数太高
    event_type LowCardinality(String),  -- 正确！只有几十种事件
    ...
);
```

LowCardinality 适用于基数 < 10000 的列。对于 user_id 这种高基数列，直接用普通类型。

### 踩坑三：分区过多导致查询变慢

```sql
-- ❌ 错误：按天分区，一年 365 个分区，每个分区只有几万行
CREATE TABLE events (
    ...
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(created_at);  -- 分区太多！

-- ✅ 正确：按月分区
CREATE TABLE events (
    ...
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at);  -- 一年 12 个分区
```

ClickHouse 的每个分区都有独立的数据块和索引，分区过多会导致：
- 打开文件数过多
- 元数据管理开销增大
- 合并（Merge）压力增大

### 踩坑四：PostgreSQL 物化视图的并发刷新死锁

```sql
-- ❌ 错误：多个进程同时刷新同一个物化视图
REFRESH MATERIALIZED VIEW mv_daily_sales;  -- 会加排他锁

-- ✅ 正确：使用 CONCURRENTLY + 分布式锁
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales;
-- 同时在 Laravel 中加分布式锁
```

```php
use Illuminate\Support\Facades\Cache;

$lock = Cache::lock('refresh_mv_daily_sales', 600);
if ($lock->get()) {
    try {
        DB::statement('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales');
    } finally {
        $lock->release();
    }
}
```

### 踩坑五：数据一致性问题

CDC 同步存在延迟，运营人员看到的 ClickHouse 数据可能滞后几秒到几分钟。

解决方案：
1. **标注数据时效性**：在报表 UI 上显示"数据截至 X 分钟前"
2. **关键指标双查**：实时性要求高的指标查 PostgreSQL，历史分析查 ClickHouse
3. **最终一致性校验**：定时任务对比两边数据，发现不一致告警

```php
// 定时校验任务
public function handle(): void
{
    $today = now()->toDateString();

    $pgCount = DB::connection('pgsql')
        ->table('orders')
        ->whereDate('created_at', $today)
        ->count();

    $chCount = app(ClickHouseService::class)
        ->query("SELECT count() FROM orders WHERE toDate(created_at) = '{$today}'")
        ->fetchOne();

    $diff = abs($pgCount - $chCount);
    $threshold = max(100, $pgCount * 0.001); // 0.1% 或至少 100 条

    if ($diff > $threshold) {
        // 告警
        Notification::route('slack', config('app.alert_channel'))
            ->notify(new DataInconsistencyAlert($today, $pgCount, $chCount));
    }
}
```

---

## 七、成本对比

### 7.1 硬件成本

| 方案 | 机器配置 | 月成本（云上） | 数据规模 |
|------|---------|---------------|---------|
| PostgreSQL 单机 | 8C 32G 500G SSD | ~¥2000/月 | 1 亿行 |
| PostgreSQL + 只读副本 | 8C 32G * 2 | ~¥4000/月 | 1 亿行 |
| ClickHouse 单机 | 8C 32G 1T SSD | ~¥2500/月 | 1 亿行 |
| ClickHouse 集群（3 分片） | 8C 32G * 3 | ~¥7500/月 | 10 亿行 |

### 7.2 运维成本

- **PostgreSQL**：团队已熟悉，运维成本低
- **ClickHouse**：需要学习新组件，但社区成熟，文档完善
- **混合方案**：额外的 ETL 管道维护成本

### 7.3 总体 TCO（3 年）

对于数据量在 1 亿行以内的场景，PostgreSQL 物化视图方案的 TCO 最低。超过 1 亿行后，ClickHouse 的性能优势开始体现，虽然运维成本略高，但节省的查询时间和开发复杂度抵消了这部分成本。

---

## 八、最终方案与效果

### 8.1 我们的选择

经过 2 周的基准测试和团队讨论，我们最终选择了**混合方案**：

- **PostgreSQL**：继续作为 OLTP 主库，处理订单、用户、商品等核心业务
- **ClickHouse**：作为 OLAP 分析库，承载报表、大屏、BI 查询
- **Debezium CDC**：实时同步，延迟 < 5 秒
- **Redis**：缓存高频查询结果（如实时大屏数据）

### 8.2 效果数据

| 指标 | 优化前（纯 PostgreSQL） | 优化后（PG + CH） |
|------|----------------------|------------------|
| 运营日报查询 | 35s | 0.3s |
| 实时大屏刷新 | 8s（全量计算） | 0.1s（ClickHouse 物化视图） |
| BI 自助查询 | 经常超时 | 平均 1.2s |
| 数据同步延迟 | N/A | < 5s（CDC） |
| 运维复杂度 | 低 | 中 |

### 8.3 成本增加

- ClickHouse 集群（3 节点）：约 ¥7500/月
- Debezium + Kafka：约 ¥2000/月
- 总增量：约 ¥9500/月

换来的是分析查询性能提升 30-100 倍，运营团队不再抱怨报表加载慢，BI 团队可以自由探索数据。

---

## 九、总结与建议

### 选型建议

1. **数据量 < 5000 万行，查询模式固定**：用 PostgreSQL 物化视图 + BRIN 索引，成本最低
2. **数据量 > 1 亿行，或需要即席查询**：引入 ClickHouse
3. **需要实时性 + 分析能力**：PostgreSQL 做主库 + ClickHouse 做分析库 + CDC 同步
4. **团队规模小，不想引入新组件**：先用 PostgreSQL 列存扩展（Citus Columnar），性能不够再考虑 ClickHouse

### 核心原则

- **不要过早引入 ClickHouse**：PostgreSQL 的 OLAP 能力比你想象的强
- **不要硬扛**：当 PostgreSQL 的查询时间超过 10 秒且无法优化时，就是引入 ClickHouse 的信号
- **数据建模比引擎选择更重要**：宽表化、预聚合、合理的 ORDER BY 键，比换引擎效果更显著

---

*本文基于 KKday B2C API 真实踩坑经验整理，涉及的性能数据基于 8C32G 云服务器测试环境，实际效果因硬件和数据分布而异。*

## 相关阅读

- [MySQL 9.x 新特性实战：向量搜索、JSON 增强、性能改进与 Laravel 适配](/categories/MySQL/2026-06-02-MySQL-9.x-新特性实战-向量搜索-JSON增强-性能改进与Laravel适配/)
- [TiDB Laravel Integration：NewSQL 分布式数据库指南](/categories/MySQL/tidb-laravel-integration-newsql-guide/)
- [Database Connection Pool：PgBouncer vs ProxySQL vs Supabase 对比](/categories/MySQL/database-connection-pool-pgbouncer-proxysql-supabase-comparison/)
