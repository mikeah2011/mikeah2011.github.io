# ClickHouse + Laravel 集成

## 定义

ClickHouse 是 Yandex 开源的列式 OLAP 数据库，专为大规模数据分析场景设计。其核心优势在于列式存储、向量化执行、数据压缩和多核并行查询，在亿级数据量的聚合分析场景中比 MySQL 快 50-200 倍。

## 核心原理

### 列式存储 vs 行式存储

| 维度 | MySQL（行式） | ClickHouse（列式） |
|------|--------------|-------------------|
| 存储方式 | 按行连续存储 | 按列连续存储 |
| I/O 效率 | 读整行，含无用列 | 只读取需要的列 |
| 压缩比 | 低（数据类型混杂） | 高（同类型连续，1:5~1:10） |
| 适用场景 | OLTP（高频增删改） | OLAP（聚合分析） |

### MergeTree 引擎家族

MergeTree 是 ClickHouse 的核心表引擎，设计思想：**写入时不做重，后台异步合并**。

```sql
CREATE TABLE ecommerce.events
(
    event_id       UUID,
    user_id        UInt64,
    event_type     LowCardinality(String),
    amount         Decimal64(2),
    event_date     Date,
    event_time     DateTime
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type, user_id)
TTL event_date + INTERVAL 12 MONTH;
```

**引擎变体**：

| 引擎 | 用途 |
|------|------|
| `MergeTree` | 基础引擎，通用场景 |
| `ReplacingMergeTree` | 按排序键去重（最终一致性） |
| `SummingMergeTree` | 后台自动汇总数值列 |
| `AggregatingMergeTree` | 预聚合（配合物化视图） |
| `CollapsingMergeTree` | 用 +1/-1 标记实现行级逻辑删除 |
| `VersionedCollapsingMergeTree` | 带版本号的折叠合并 |

### 物化视图（Materialized View）

物化视图是 ClickHouse 实现实时聚合的核心机制。写入数据时自动触发预聚合，查询时直接读取聚合结果：

```sql
-- 创建物化视图：按天按事件类型预聚合
CREATE MATERIALIZED VIEW ecommerce.events_daily_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type)
AS SELECT
    event_date,
    event_type,
    count() AS event_count,
    sum(amount) AS total_amount,
    uniqState(user_id) AS unique_users
FROM ecommerce.events
GROUP BY event_date, event_type;
```

### 性能对比（1 亿条记录）

| 查询类型 | MySQL 8.0 | ClickHouse 24.x | 加速比 |
|---------|-----------|-----------------|--------|
| COUNT 全表 | 45.2s | 0.8s | 56x |
| 按日期分组 PV | 68.5s | 0.3s | 228x |
| 多维聚合 | 185.7s | 0.9s | 206x |
| 漏斗分析 | 210.4s | 1.5s | 140x |

## Laravel 集成方案

### 方案 1：原生 TCP 客户机（推荐）

```php
// config/database.php
'clickhouse' => [
    'driver' => 'clickhouse',
    'host' => env('CLICKHOUSE_HOST', 'localhost'),
    'port' => env('CLICKHOUSE_PORT', 8123),
    'database' => env('CLICKHOUSE_DATABASE', 'default'),
    'username' => env('CLICKHOUSE_USER', 'default'),
    'password' => env('CLICKHOUSE_PASSWORD', ''),
],
```

### 方案 2：HTTP API 直接调用

```php
$response = Http::timeout(30)->post('http://clickhouse:8123/', [
    'query' => 'SELECT event_type, count() FROM events GROUP BY event_type',
]);
```

### 与 MySQL 的双写策略

- **OLTP 写 MySQL**，通过 binlog CDC（Debezium）异步同步到 ClickHouse
- **OLAP 查 ClickHouse**，聚合结果通过 API 返回给 Laravel

## 实战案例

来自博客文章：
- [ClickHouse + Laravel 实战进阶：MergeTree 引擎、物化视图与实时 OLAP](/categories/数据库/2026-06-07-clickhouse-laravel-mergetree-materialized-view-realtime-olap/)
- [ClickHouse vs PostgreSQL 分析查询对比](/2026/06/02/clickhouse-vs-postgresql-olap-selection-laravel-integration/)

## 相关概念

- [OLAP 选型](OLAP选型.md) - ClickHouse vs PostgreSQL 分析引擎选型
- [MySQL HeatWave](MySQL-HeatWave.md) - MySQL 原生 HTAP 方案
- [TiDB NewSQL](TiDB-NewSQL.md) - 分布式 SQL + HTAP
- [CDC 与事件流](../架构设计/CDC与事件流.md) - binlog 同步到 ClickHouse

## 常见问题

**Q: ClickHouse 适合做主数据库吗？**
A: 不适合。ClickHouse 不支持高效的单行 UPDATE/DELETE，不适合 OLTP 场景。应作为分析层，与 MySQL/PostgreSQL 配合使用。

**Q: 如何处理 ClickHouse 的数据一致性？**
A: ClickHouse 是最终一致性模型。ReplacingMergeTree 在后台合并时去重，但查询时可能看到重复数据。使用 `FINAL` 关键字或 `OPTIMIZE TABLE` 强制合并。

**Q: 分片键和排序键如何选择？**
A: 排序键（ORDER BY）决定数据在分片内的物理排序和索引，应选择最常用的查询过滤列。分片键决定数据在集群间的分布，应选择数据均匀分布的列（如 user_id）。
