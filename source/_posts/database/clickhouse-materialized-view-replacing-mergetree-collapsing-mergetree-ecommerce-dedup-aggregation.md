---
title: ClickHouse 物化视图实战进阶：ReplacingMergeTree/CollapsingMergeTree 的电商埋点去重与增量聚合——实时大屏的底层引擎设计
keywords: [ClickHouse, ReplacingMergeTree, CollapsingMergeTree, 物化视图实战进阶, 的电商埋点去重与增量聚合, 实时大屏的底层引擎设计, 数据库]
date: 2026-06-10 02:38:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - ClickHouse
  - ReplacingMergeTree
  - CollapsingMergeTree
  - 物化视图
  - 埋点去重
  - 实时聚合
  - 电商
  - 大屏
description: 深入 ClickHouse 物化视图引擎，详解 ReplacingMergeTree 与 CollapsingMergeTree 在电商埋点去重与增量聚合中的实战应用。从引擎原理到生产落地，含完整建表语句、物化视图配置、增量聚合 SQL、实时大屏对接方案，附 Laravel 集成代码与踩坑记录。
---


# ClickHouse 物化视图实战进阶：ReplacingMergeTree/CollapsingMergeTree 的电商埋点去重与增量聚合

在电商实时大屏场景中，ClickHouse 的物化视图是实现"写入即聚合"的关键引擎。本文将深入 ReplacingMergeTree 和 CollapsingMergeTree 两种引擎的去重机制，结合电商埋点的真实需求，从原理到落地完整走一遍。

## 为什么需要 ClickHouse 物化视图？

传统 OLAP 方案（MySQL + 定时任务聚合）在电商大屏场景下有几个致命问题：

1. **延迟高**：定时任务间隔 5-30 分钟，大屏数据严重滞后
2. **资源浪费**：每次聚合都要全表扫描，CPU 和 IO 压力大
3. **数据重复**：埋点上报存在重试机制，同一条事件可能被写入多次
4. **扩展性差**：数据量增长后，聚合任务越来越慢

ClickHouse 的物化视图解决了这些问题——数据写入时实时计算，写入完成即查询可用。但前提是选对引擎、用对去重策略。

## 引擎选型：ReplacingMergeTree vs CollapsingMergeTree

### ReplacingMergeTree：基于版本号的去重

ReplacingMergeTree 的去重逻辑很直观：**在同一个排序键范围内，保留版本号最大的那一行**。

```sql
CREATE TABLE ecommerce_events_rmt (
    event_id String,
    user_id UInt64,
    product_id UInt64,
    event_type LowCardinality(String),
    page_url String,
    referrer String,
    device LowCardinality(String),
    province LowCardinality(String),
    timestamp DateTime64(3),
    event_date Date DEFAULT toDate(timestamp),
    version UInt64 DEFAULT toUnixTimestamp64Milli(now64(3))
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type, user_id, event_id)
TTL event_date + INTERVAL 90 DAY;
```

**核心参数解读：**

- `version`：版本列。ClickHouse 合并时保留该列值最大的行
- `PARTITION BY`：按月分区，方便数据生命周期管理
- `ORDER BY`：排序键，也决定了去重范围——只有排序键相同的行才会去重

**关键陷阱：去重不是实时的！**

ReplacingMergeTree 的去重发生在后台合并（merge）阶段，不是写入时立即去重。这意味着：

```sql
-- 写入两条重复事件
INSERT INTO ecommerce_events_rmt VALUES
('evt_001', 1001, 5001, 'page_view', '/product/5001', '', 'mobile', '上海', now64(3), 1),
('evt_001', 1001, 5001, 'page_view', '/product/5001', '', 'mobile', '上海', now64(3), 2);

-- 立即查询，两条都还在
SELECT count() FROM ecommerce_events_rmt WHERE event_id = 'evt_001';
-- 结果：2

-- 等待后台合并后（或手动 OPTIMIZE），再去重
OPTIMIZE TABLE ecommerce_events_rmt FINAL;
SELECT count() FROM ecommerce_events_rmt WHERE event_id = 'evt_001';
-- 结果：1
```

**电商场景建议：** 如果大屏容忍 5-10 分钟的去重延迟，ReplacingMergeTree 足够。如果需要写入即去重，考虑 CollapsingMergeTree。

### CollapsingMergeTree：基于 sign 标记的精确去重

CollapsingMergeTree 使用一个 `sign` 列（+1/-1）来标记行的"生效"和"取消"，实现写入即语义正确的去重。

```sql
CREATE TABLE ecommerce_events_cmt (
    event_id String,
    user_id UInt64,
    product_id UInt64,
    event_type LowCardinality(String),
    page_url String,
    referrer String,
    device LowCardinality(String),
    province LowCardinality(String),
    timestamp DateTime64(3),
    event_date Date DEFAULT toDate(timestamp),
    sign Int8
)
ENGINE = CollapsingMergeTree(sign)
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type, user_id, event_id)
TTL event_date + INTERVAL 90 DAY;
```

**工作流程：**

1. 写入一条事件：`sign = 1`
2. 发现重复/错误：写入一条 `sign = -1` 的取消行
3. 合并时：`+1` 和 `-1` 相互抵消，结果为 0 的行被删除

```sql
-- 第一次写入（正常事件）
INSERT INTO ecommerce_events_cmt VALUES
('evt_002', 1002, 5002, 'add_to_cart', '/cart', '', 'mobile', '北京', now64(3), 1);

-- 重复写入（重试机制导致）
INSERT INTO ecommerce_events_cmt VALUES
('evt_002', 1002, 5002, 'add_to_cart', '/cart', '', 'mobile', '北京', now64(3), 1);

-- 用 sign=-1 取消其中一条
INSERT INTO ecommerce_events_cmt VALUES
('evt_002', 1002, 5002, 'add_to_cart', '/cart', '', 'mobile', '北京', now64(3), -1);
```

**CollapsingMergeTree 的合并规则：**

- 同一排序键范围内，`sign` 列的代数和决定最终状态
- 和为 0：行被删除（+1 和 -1 抵消）
- 和为 1：保留该行
- 和大于 1：保留但可能有重复警告

## 物化视图实战：埋点去重与增量聚合

### 场景一：ReplacingMergeTree 物化视图——实时去重 + 增量聚合

需求：原始事件表写入时，自动按小时聚合用户访问数据，同时保证事件去重。

```sql
-- 1. 原始事件表（ReplacingMergeTree）
CREATE TABLE ecommerce_events (
    event_id String,
    user_id UInt64,
    product_id UInt64,
    event_type LowCardinality(String),
    page_url String,
    referrer String,
    device LowCardinality(String),
    province LowCardinality(String),
    timestamp DateTime64(3),
    event_date Date DEFAULT toDate(timestamp),
    version UInt64 DEFAULT toUnixTimestamp64Milli(now64(3))
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type, user_id, event_id)
TTL event_date + INTERVAL 90 DAY;

-- 2. 物化视图：按小时聚合 UV/PV
CREATE MATERIALIZED VIEW ecommerce_hourly_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(hour_date)
ORDER BY (hour_date, hour, event_type, province, device)
AS
SELECT
    toDate(timestamp) AS hour_date,
    toStartOfHour(timestamp) AS hour,
    event_type,
    province,
    device,
    uniqState(user_id) AS uv,
    count() AS pv,
    uniqState(product_id) AS product_uv
FROM ecommerce_events
GROUP BY
    hour_date,
    hour,
    event_type,
    province,
    device;

-- 3. 查询聚合结果（合并去重状态）
SELECT
    hour_date,
    hour,
    event_type,
    province,
    device,
    uniqMerge(uv) AS uv,
    sum(pv) AS pv,
    uniqMerge(product_uv) AS product_uv
FROM ecommerce_hourly_mv
WHERE hour_date >= today() - 7
GROUP BY hour_date, hour, event_type, province, device
ORDER BY hour_date DESC, hour DESC;
```

**为什么用 `SummingMergeTree` 作为物化视图引擎？**

物化视图的目标是增量聚合。`SummingMergeTree` 会在合并时自动对数值列求和，配合 `uniqState`/`uniqMerge` 可以实现精确的去重计数。

### 场景二：CollapsingMergeTree 物化视图——精确去重的实时聚合

需求：每个 user_id 对每个 product_id 的事件需要精确去重（一个用户对一个商品只算一次 page_view）。

```sql
-- 1. 原始事件表（CollapsingMergeTree）
CREATE TABLE ecommerce_events_collapsing (
    event_id String,
    user_id UInt64,
    product_id UInt64,
    event_type LowCardinality(String),
    page_url String,
    device LowCardinality(String),
    province LowCardinality(String),
    timestamp DateTime64(3),
    event_date Date DEFAULT toDate(timestamp),
    sign Int8
)
ENGINE = CollapsingMergeTree(sign)
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type, user_id, product_id, event_id)
TTL event_date + INTERVAL 90 DAY;

-- 2. 物化视图：按天聚合商品级 UV
CREATE MATERIALIZED VIEW ecommerce_product_uv_mv
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(agg_date)
ORDER BY (agg_date, event_type, product_id)
AS
SELECT
    event_date AS agg_date,
    event_type,
    product_id,
    uniqState(user_id) AS unique_users,
    count() AS total_events,
    uniqState(province) AS unique_provinces
FROM ecommerce_events_collapsing
WHERE sign = 1  -- 只聚合正向事件
GROUP BY agg_date, event_type, product_id;

-- 3. 查询商品级 UV（自动合并去重状态）
SELECT
    agg_date,
    event_type,
    product_id,
    uniqMerge(unique_users) AS uv,
    sum(total_events) AS pv,
    uniqMerge(unique_provinces) AS province_count
FROM ecommerce_product_uv_mv
WHERE agg_date >= today() - 30
GROUP BY agg_date, event_type, product_id
ORDER BY agg_date DESC, uv DESC
LIMIT 100;
```

**关键设计：`WHERE sign = 1`**

在 CollapsingMergeTree 的物化视图中，只聚合 `sign = 1` 的行。取消行（`sign = -1`）不会进入聚合视图，这是精确去重的核心。

### 场景三：实时大屏——全链路聚合视图

电商大屏通常需要多个维度的实时数据。下面是一个完整的多维度聚合方案：

```sql
-- 1. 实时 PV/UV 大屏（分钟级）
CREATE MATERIALIZED VIEW realtime_dashboard_mv
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(agg_date)
ORDER BY (agg_date, time_slot, event_type, province, device)
AS
SELECT
    event_date AS agg_date,
    toStartOfMinute(timestamp) AS time_slot,
    event_type,
    province,
    device,
    uniqState(user_id) AS uv,
    count() AS pv,
    uniqState(product_id) AS product_uv,
    uniqState(page_url) AS page_uv
FROM ecommerce_events
WHERE sign = 1
GROUP BY agg_date, time_slot, event_type, province, device;

-- 2. 商品实时排行（Top 100）
CREATE MATERIALIZED VIEW product_ranking_mv
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(agg_date)
ORDER BY (agg_date, event_type, product_id)
AS
SELECT
    event_date AS agg_date,
    event_type,
    product_id,
    uniqState(user_id) AS uv,
    count() AS pv
FROM ecommerce_events
WHERE sign = 1 AND event_type IN ('page_view', 'add_to_cart', 'purchase')
GROUP BY agg_date, event_type, product_id;

-- 3. 转化漏斗（实时）
CREATE MATERIALIZED VIEW conversion_funnel_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(agg_date)
ORDER BY (agg_date, funnel_step, province)
AS
SELECT
    event_date AS agg_date,
    CASE event_type
        WHEN 'page_view' THEN 1
        WHEN 'add_to_cart' THEN 2
        WHEN 'checkout' THEN 3
        WHEN 'purchase' THEN 4
    END AS funnel_step,
    province,
    uniqState(user_id) AS uv,
    count() AS pv
FROM ecommerce_events
WHERE sign = 1 AND event_type IN ('page_view', 'add_to_cart', 'checkout', 'purchase')
GROUP BY agg_date, funnel_step, province;
```

## 去重策略选择指南

| 维度 | ReplacingMergeTree | CollapsingMergeTree |
|------|-------------------|-------------------|
| 去重时机 | 后台合并（延迟） | 写入即语义正确 |
| 实现复杂度 | 低（只需版本列） | 高（需要取消行） |
| 适用场景 | 允许延迟去重的聚合 | 需要精确去重的场景 |
| 写入量 | 1x | 1x（去重时需额外写入） |
| 查询复杂度 | 需要 FINAL 或 argMax | 需要 WHERE sign=1 |
| 性能 | 更好（写入少） | 稍差（写入多一倍） |

**电商场景推荐：**

- **实时大屏聚合**：ReplacingMergeTree + 物化视图（SummingMergeTree/AggregatingMergeTree）
- **用户行为去重**：CollapsingMergeTree（一个用户对一个商品只算一次）
- **订单状态追踪**：CollapsingMergeTree（+1 创建订单，-1 取消/更新）

## Laravel 集成实战

### ClickHouse 连接配置

```php
// config/clickhouse.php
return [
    'default' => [
        'driver' => 'clickhouse',
        'host' => env('CLICKHOUSE_HOST', '127.0.0.1'),
        'port' => env('CLICKHOUSE_PORT', 8123),
        'database' => env('CLICKHOUSE_DATABASE', 'ecommerce'),
        'username' => env('CLICKHOUSE_USERNAME', 'default'),
        'password' => env('CLICKHOUSE_PASSWORD', ''),
        'options' => [
            'timeout' => 30,
            'retry' => 3,
        ],
    ],
];
```

### 事件写入服务

```php
<?php

namespace App\Services\ClickHouse;

use Illuminate\Support\Facades\DB;

class EventWriter
{
    /**
     * 写入埋点事件（ReplacingMergeTree 版本）
     */
    public function writeEvent(array $event): void
    {
        $data = [
            'event_id' => $event['event_id'],
            'user_id' => $event['user_id'],
            'product_id' => $event['product_id'] ?? 0,
            'event_type' => $event['event_type'],
            'page_url' => $event['page_url'] ?? '',
            'referrer' => $event['referrer'] ?? '',
            'device' => $event['device'] ?? 'unknown',
            'province' => $event['province'] ?? '未知',
            'timestamp' => $event['timestamp'] ?? now()->toDateTimeString(),
            'version' => round(microtime(true) * 1000), // 毫秒时间戳作为版本
        ];

        DB::connection('clickhouse')->table('ecommerce_events')->insert($data);
    }

    /**
     * 写入 CollapsingMergeTree 事件（带 sign）
     */
    public function writeCollapsingEvent(array $event): void
    {
        $data = [
            'event_id' => $event['event_id'],
            'user_id' => $event['user_id'],
            'product_id' => $event['product_id'] ?? 0,
            'event_type' => $event['event_type'],
            'page_url' => $event['page_url'] ?? '',
            'device' => $event['device'] ?? 'unknown',
            'province' => $event['province'] ?? '未知',
            'timestamp' => $event['timestamp'] ?? now()->toDateTimeString(),
            'sign' => 1, // 正向事件
        ];

        DB::connection('clickhouse')->table('ecommerce_events_collapsing')->insert($data);
    }

    /**
     * 取消重复事件（CollapsingMergeTree 专用）
     */
    public function cancelEvent(string $eventId): void
    {
        // 查询原始事件，写入 sign=-1 的取消行
        $original = DB::connection('clickhouse')
            ->table('ecommerce_events_collapsing')
            ->where('event_id', $eventId)
            ->where('sign', 1)
            ->first();

        if ($original) {
            $cancel = (array) $original;
            $cancel['sign'] = -1;
            DB::connection('clickhouse')->table('ecommerce_events_collapsing')->insert($cancel);
        }
    }
}
```

### 实时大屏查询服务

```php
<?php

namespace App\Services\ClickHouse;

use Illuminate\Support\Facades\DB;

class DashboardQuery
{
    /**
     * 查询实时 PV/UV（分钟级）
     */
    public function getRealtimeMetrics(string $eventType = null, int $minutes = 30): array
    {
        $query = DB::connection('clickhouse')
            ->table('realtime_dashboard_mv')
            ->select([
                'time_slot',
                DB::raw('uniqMerge(uv) AS uv'),
                DB::raw('sum(pv) AS pv'),
            ])
            ->where('agg_date', today())
            ->where('time_slot', '>=', now()->subMinutes($minutes))
            ->groupBy('time_slot')
            ->orderBy('time_slot');

        if ($eventType) {
            $query->where('event_type', $eventType);
        }

        return $query->get()->toArray();
    }

    /**
     * 查询商品实时排行
     */
    public function getProductRanking(string $eventType = 'purchase', int $limit = 100): array
    {
        return DB::connection('clickhouse')
            ->table('product_ranking_mv')
            ->select([
                'product_id',
                DB::raw('uniqMerge(uv) AS uv'),
                DB::raw('sum(pv) AS pv'),
            ])
            ->where('agg_date', today())
            ->where('event_type', $eventType)
            ->groupBy('product_id')
            ->orderByDesc('pv')
            ->limit($limit)
            ->get()
            ->toArray();
    }

    /**
     * 查询转化漏斗
     */
    public function getConversionFunnel(string $province = null): array
    {
        $query = DB::connection('clickhouse')
            ->table('conversion_funnel_mv')
            ->select([
                'funnel_step',
                DB::raw('uniqMerge(uv) AS uv'),
                DB::raw('sum(pv) AS pv'),
            ])
            ->where('agg_date', today())
            ->groupBy('funnel_step')
            ->orderBy('funnel_step');

        if ($province) {
            $query->where('province', $province);
        }

        return $query->get()->toArray();
    }

    /**
     * 按省份统计（地域大屏）
     */
    public function getProvinceStats(): array
    {
        return DB::connection('clickhouse')
            ->table('realtime_dashboard_mv')
            ->select([
                'province',
                DB::raw('uniqMerge(uv) AS uv'),
                DB::raw('sum(pv) AS pv'),
            ])
            ->where('agg_date', today())
            ->where('event_type', 'page_view')
            ->groupBy('province')
            ->orderByDesc('uv')
            ->get()
            ->toArray();
    }
}
```

### API 接口（Controller）

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ClickHouse\DashboardQuery;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    public function __construct(
        private DashboardQuery $query
    ) {}

    public function realtimeMetrics(): JsonResponse
    {
        $data = $this->query->getRealtimeMetrics(minutes: 60);

        return response()->json([
            'code' => 0,
            'data' => $data,
            'updated_at' => now()->toDateTimeString(),
        ]);
    }

    public function productRanking(): JsonResponse
    {
        $data = $this->query->getProductRanking(limit: 50);

        return response()->json([
            'code' => 0,
            'data' => $data,
        ]);
    }

    public function conversionFunnel(): JsonResponse
    {
        $data = $this->query->getConversionFunnel();

        return response()->json([
            'code' => 0,
            'data' => $data,
        ]);
    }

    public function provinceStats(): JsonResponse
    {
        $data = $this->query->getProvinceStats();

        return response()->json([
            'code' => 0,
            'data' => $data,
        ]);
    }
}
```

## 踩坑记录

### 坑 1：ReplacingMergeTree 查询结果不一致

**现象：** 同一条 SQL 连续查询两次，返回不同的行数。

**原因：** 后台合并尚未完成，`FINAL` 关键字可以强制去重，但性能开销大。

**解决方案：**

```sql
-- 方案 1：查询时加 FINAL（性能差，适合小表）
SELECT * FROM ecommerce_events FINAL;

-- 方案 2：用 argMax 取最新版本（推荐）
SELECT
    event_id,
    argMax(user_id, version) AS user_id,
    argMax(event_type, version) AS event_type,
    max(version) AS version
FROM ecommerce_events
WHERE event_date = today()
GROUP BY event_id;

-- 方案 3：定期手动触发合并（适合非高峰时段）
OPTIMIZE TABLE ecommerce_events;
```

### 坑 2：CollapsingMergeTree 的 sign 写入顺序

**现象：** 取消行（`sign=-1`）先于正向行（`sign=1`）写入，导致合并后数据丢失。

**原因：** CollapsingMergeTree 要求正向行必须先于取消行写入（在同一个合并范围内）。

**解决方案：** 使用 `VersionedCollapsingMergeTree`，通过 `version` 列保证顺序：

```sql
CREATE TABLE ecommerce_events_versioned (
    event_id String,
    user_id UInt64,
    event_type LowCardinality(String),
    timestamp DateTime64(3),
    event_date Date DEFAULT toDate(timestamp),
    sign Int8,
    version UInt64
)
ENGINE = VersionedCollapsingMergeTree(sign, version)
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type, user_id, event_id);
```

### 坑 3：物化视图不支持 DELETE

**现象：** 尝试在物化视图上执行 `DELETE`，报错不支持。

**原因：** ClickHouse 物化视图是只读的，不支持直接修改。

**解决方案：** 通过原始表操作，物化视图会自动同步。或者用 `ALTER TABLE ... DELETE` 操作原始表，物化视图在下次合并时自动更新。

### 坑 4：大屏数据延迟超过预期

**现象：** 写入数据后 30 分钟大屏还没更新。

**原因：** 物化视图的聚合结果需要等待后台合并。大分区（比如按月分区）合并频率低。

**解决方案：**

```sql
-- 缩小分区粒度，增加合并频率
PARTITION BY (toYYYYMM(event_date), toDayOfMonth(event_date))  -- 按天分区

-- 或者降低合并触发阈值
SET max_bytes_to_merge_at_max_space_in_pool = 104857600;  -- 100MB
```

### 坑 5：`uniqState` 内存溢出

**现象：** 查询 `uniqMerge(uv)` 时 OOM。

**原因：** `uniqState` 使用 HyperLogLog，但基数极高时内存占用会显著增长。

**解决方案：**

```sql
-- 使用 uniqCombined 替代 uniq（更低内存，略有精度损失）
uniqCombinedState(user_id) AS uv
-- 查询时
uniqCombinedMerge(uv) AS uv

-- 或者限制基数上限
uniqCombinedState(12)(user_id) AS uv  -- 使用 2^12 精度
```

## 性能优化建议

### 1. 写入优化

```sql
-- 批量写入，减少 parts 数量
INSERT INTO ecommerce_events VALUES
(...), (...), (...);  -- 一次写入多行

-- 控制写入频率，避免产生过多小 parts
-- 建议每秒写入不超过 1000 行
```

### 2. 查询优化

```sql
-- 避免 SELECT *，只查询需要的列
SELECT time_slot, uniqMerge(uv) AS uv, sum(pv) AS pv
FROM realtime_dashboard_mv
WHERE agg_date = today()
GROUP BY time_slot;

-- 使用 PREWHERE 替代 WHERE（自动优化）
SELECT * FROM ecommerce_events PREWHERE event_type = 'purchase';

-- 避免大范围扫描，始终带分区键条件
SELECT * FROM ecommerce_events
WHERE event_date = today()  -- 必须带分区键
  AND event_type = 'purchase';
```

### 3. 物化视图监控

```sql
-- 查看物化视图的 parts 数量（过多需要合并）
SELECT
    table,
    count() AS parts_count,
    formatReadableSize(sum(bytes_on_disk)) AS total_size
FROM system.parts
WHERE database = 'ecommerce'
  AND table LIKE '%_mv'
GROUP BY table;

-- 手动触发物化视图的合并
OPTIMIZE TABLE ecommerce_hourly_mv;
```

## 总结

| 场景 | 推荐引擎 | 去重策略 | 聚合引擎 |
|------|---------|---------|---------|
| 埋点实时聚合 | ReplacingMergeTree | 版本号（延迟去重） | SummingMergeTree |
| 用户行为精确去重 | CollapsingMergeTree | sign 标记（写入即去重） | AggregatingMergeTree |
| 订单状态追踪 | VersionedCollapsingMergeTree | sign + version | AggregatingMergeTree |
| 大屏实时数据 | ReplacingMergeTree | 版本号（允许延迟） | AggregatingMergeTree |

核心原则：**选择取决于你对去重延迟的容忍度**。允许 5-10 分钟延迟，用 ReplacingMergeTree 更简单高效；需要精确去重，用 CollapsingMergeTree 但要处理好写入顺序。

在电商实时大屏场景中，ClickHouse 物化视图 + Laravel 集成是一个非常实用的方案。写入即聚合、分钟级延迟、百万级 QPS 支持，这些都是传统 MySQL + 定时任务方案无法比拟的。
