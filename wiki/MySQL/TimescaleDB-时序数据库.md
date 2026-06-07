# TimescaleDB 时序数据库

## 定义

TimescaleDB 是 PostgreSQL 的时序数据扩展，在不改变 SQL 语法的前提下，将时序数据的写入性能提升 10-100 倍，查询速度提升 10-1000 倍。它与 Laravel 的 PostgreSQL 驱动无缝集成，不需要安装任何新的 PHP 扩展。

## 核心原理

### Hypertable（超级表）

Hypertable 是 TimescaleDB 的核心抽象，表面是一张普通 PG 表，底层自动按时间维度分区为多个 Chunk：

```sql
CREATE TABLE sensor_data (
    time        TIMESTAMPTZ NOT NULL,
    sensor_id   INTEGER NOT NULL,
    temperature DOUBLE PRECISION,
    humidity    DOUBLE PRECISION
);
SELECT create_hypertable('sensor_data', 'time',
    chunk_time_interval => INTERVAL '1 day');
```

### 连续聚合（Continuous Aggregate）

类似物化视图，但会自动增量刷新：

```sql
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    avg(temperature) AS avg_temp,
 max(humidity) AS max_humidity,
    count(*) AS reading_count
FROM sensor_data
GROUP BY bucket, sensor_id;
```

### 数据保留策略

```sql
SELECT add_retention_policy('sensor_data', INTERVAL '12 months');
```

### 压缩

```sql
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('sensor_data', INTERVAL '7 days');
```

## 时序数据库选型对比

| 特性 | TimescaleDB | InfluxDB | QuestDB | ClickHouse |
|------|-------------|----------|---------|------------|
| 底层存储 | PostgreSQL | 自研 TSM | 列式存储 | 列式存储 |
| SQL 兼容 | 完全兼容 PG SQL | InfluxQL / Flux | SQL（部分） | SQL（方言） |
| 事务支持 | ✅ 完整 ACID | ❌ | ❌ | ❌ |
| JOIN 支持 | ✅ 与 PG 表 | ❌ | 有限 | ✅ |
| 压缩率 | 10-20x | 10-20x | 10-50x | 10-100x |
| ORM 集成 | Eloquent 原生 | 需自定义驱动 | 需自定义驱动 | 需自定义驱动 |

## Laravel 集成

无需额外扩展，直接使用 PostgreSQL 驱动：

```php
// Model
class SensorData extends Model
{
    protected $table = 'sensor_data';
    protected $casts = ['time' => 'datetime'];
}

// 查询最近 24 小时的小时聚合
SensorData::query()
    ->selectRaw("time_bucket('1 hour', time) as bucket, avg(temperature) as avg_temp")
    ->where('time', '>=', now()->subDay())
    ->groupBy('bucket')
    ->orderBy('bucket')
    ->get();
```

### 批量写入优化

```php
// 使用 COPY 命令批量写入（10 万行/秒）
DB::connection('pgsql')->statement(
    "COPY sensor_data (time, sensor_id, temperature, humidity) FROM STDIN WITH CSV"
);
```

## 实战案例

来自博客文章：
- [TimescaleDB 实战：时序数据库在 Laravel 中的集成——IoT 数据、用户行为分析与物化视图踩坑记录](/categories/数据库/TimescaleDB-实战-时序数据库在Laravel中的集成/)

## 相关概念

- [ClickHouse + Laravel 集成](ClickHouse-Laravel-集成.md) - 列式 OLAP 引擎
- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - PostgreSQL 生态
- [分区表](分区表.md) - MySQL 分区策略对比
- [CDC 与事件流](../架构设计/CDC与事件流.md) - 时序数据采集管道

## 常见问题

**Q: TimescaleDB 与 ClickHouse 如何选型？**
A: 如果已有 PostgreSQL 基础设施、需要事务一致性、或数据量在 TB 级以内，选 TimescaleDB。如果数据量在 PB 级、纯分析场景、不需要事务，选 ClickHouse。

**Q: Hypertable 的 Chunk 间隔如何设置？**
A: 默认 7 天。高频写入场景建议 1 天，低频场景可以设 1 个月。Chunk 太小会导致 Chunk 数量爆炸，太大会影响查询裁剪效率。

**Q: 如何处理乱序写入？**
A: TimescaleDB 默认允许乱序写入，但极端乱序（超过 Chunk 间隔）会导致数据写入错误的 Chunk。建议在应用层做时间窗口缓冲。
