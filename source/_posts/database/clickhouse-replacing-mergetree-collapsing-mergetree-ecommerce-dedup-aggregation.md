---
title: "ClickHouse MergeTree 引擎深度实战：ReplacingMergeTree/CollapsingMergeTree 的电商埋点去重与增量聚合"
keywords: [ClickHouse MergeTree, ReplacingMergeTree, CollapsingMergeTree, 引擎深度实战, 的电商埋点去重与增量聚合, 数据库]
date: 2026-06-10 05:15:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - ClickHouse
  - MergeTree
  - ReplacingMergeTree
  - CollapsingMergeTree
  - 电商埋点
  - 数据去重
  - 增量聚合
  - OLAP
description: "深入实战 ClickHouse 的 ReplacingMergeTree 和 CollapsingMergeTree 引擎，以电商埋点场景为例，详解数据去重与增量聚合的核心原理、踩坑经验及 Laravel 集成方案。"
---


## 概述

在电商系统中，埋点数据天然存在两个核心问题：**重复写入**和**增量统计**。

用户浏览商品、加购、下单、支付——每一个行为事件都可能因为网络抖动、客户端重试、消息队列重复投递等原因被写入多次。同时，业务层需要实时统计 UV、转化率、GMV 等指标，要求底层存储支持高效的增量聚合。

ClickHouse 的 MergeTree 家族引擎正是为这类场景设计的。本文聚焦两个最常用的变体引擎：

- **ReplacingMergeTree**：按排序键去重，保留最新版本的行
- **CollapsingMergeTree**：通过 +1/-1 行实现逻辑删除，支持增量聚合的加减运算

以电商埋点为实战场景，从建表、写入、查询到 Laravel 集成，完整走一遍。

## 核心概念

### MergeTree 基础

MergeTree 是 ClickHouse 的核心引擎家族。所有变体都继承了 MergeTree 的基本能力：

- **数据按主键排序存储**，支持高效范围查询
- **后台异步合并**（merge），将多个 part 合并为更大的 part
- **分区**（PARTITION BY），按时间或其他维度切分数据
- **稀疏索引**，每 8192 行一个索引标记

### ReplacingMergeTree

ReplacingMergeTree 在合并阶段按排序键（ORDER BY）去重，保留 `version` 列值最大的那行。

关键特性：
- **去重发生在后台 merge 阶段**，不是实时的
- 同一 part 内的数据不会立即去重
- 查询时需要 `FINAL` 关键字或手动处理重复

### CollapsingMergeTree

CollapsingMergeTree 通过一个 `sign` 列（值为 +1 或 -1）标记行的状态：

- +1 表示"有效行"
- -1 表示"要抵消的行"
- 合并时，相同排序键的 +1 和 -1 行会互相抵消

这使得增量聚合成为可能：每次状态变更时，插入一条 -1 行抵消旧值，再插入一条 +1 行记录新值。

## 实战：电商埋点去重（ReplacingMergeTree）

### 建表

```sql
-- 电商用户行为埋点表
CREATE TABLE ecommerce.user_events
(
    event_id       String,          -- 唯一事件 ID（客户端生成）
    user_id        UInt64,
    session_id     String,
    event_type     LowCardinality(String),  -- view/add_cart/order/pay
    product_id     UInt64,
    category_id    UInt32,
    page_url       String,
    referrer_url   String,
    device_type    LowCardinality(String),  -- mobile/desktop/tablet
    browser        LowCardinality(String),
    country        LowCardinality(String),
    city           String,
    extra_json     String,          -- 扩展 JSON 字段
    event_time     DateTime,
    server_time    DateTime DEFAULT now(),
    version        UInt64           -- 版本号，越大越新
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMMDD(event_time)
ORDER BY (user_id, event_type, event_time, event_id)
SETTINGS index_granularity = 8192;
```

设计要点：
- `event_id` 作为去重的业务主键，但排序键包含了 `user_id`、`event_type`、`event_time`，使得同一用户同一类型的行为事件在物理上连续存储
- `version` 用事件时间戳或递增序列，确保重复写入时保留最新版本
- `LowCardinality` 优化低基数字段的存储和查询

### 写入数据

模拟重复写入场景：

```sql
-- 第一次写入
INSERT INTO ecommerce.user_events VALUES
('evt_001', 10001, 'sess_abc', 'view', 2001, 101, '/product/2001', '/home', 'mobile', 'Chrome', 'CN', 'Shanghai', '{}', '2026-06-10 10:00:00', now(), 1),
('evt_002', 10001, 'sess_abc', 'add_cart', 2001, 101, '/product/2001', '/product/2001', 'mobile', 'Chrome', 'CN', 'Shanghai', '{}', '2026-06-10 10:01:00', now(), 1);

-- 重复写入（相同 event_id，相同 version）
INSERT INTO ecommerce.user_events VALUES
('evt_001', 10001, 'sess_abc', 'view', 2001, 101, '/product/2001', '/home', 'mobile', 'Chrome', 'CN', 'Shanghai', '{}', '2026-06-10 10:00:00', now(), 1);

-- 更新写入（相同 event_id，更高 version，extra_json 有修正）
INSERT INTO ecommerce.user_events VALUES
('evt_001', 10001, 'sess_abc', 'view', 2001, 101, '/product/2001', '/home', 'mobile', 'Chrome', 'CN', 'Shanghai', '{"corrected": true}', '2026-06-10 10:00:00', now(), 2);
```

### 查询去重

```sql
-- 不加 FINAL：可能返回重复行（取决于 merge 进度）
SELECT count() FROM ecommerce.user_events;

-- 加 FINAL：保证去重结果
SELECT count() FROM ecommerce.user_events FINAL;

-- 推荐方案：子查询取最新版本
SELECT *
FROM ecommerce.user_events
WHERE (user_id, event_type, event_time, event_id, version) IN (
    SELECT user_id, event_type, event_time, event_id, max(version)
    FROM ecommerce.user_events
    GROUP BY user_id, event_type, event_time, event_id
);
```

### FINAL 的性能陷阱

`FINAL` 关键字看似方便，但在大数据量下有严重性能问题：

```sql
-- ❌ 不推荐：全表扫描 + 实时去重，O(n) 内存
SELECT event_type, count() as cnt
FROM ecommerce.user_events FINAL
GROUP BY event_type;

-- ✅ 推荐：使用 argMax 获取最新版本
SELECT event_type, count() as cnt
FROM (
    SELECT event_type,
           argMax(extra_json, version) as latest_extra
    FROM ecommerce.user_events
    GROUP BY user_id, event_type, event_time, event_id
)
GROUP BY event_type;
```

`argMax(col, version)` 是 ReplacingMergeTree 的最佳搭档：按 version 取最大值对应的任意列，不触发 FINAL 的性能问题。

## 实战：增量聚合（CollapsingMergeTree）

### 场景：商品实时销量统计

电商需要实时统计每个商品的销量和销售额，支持订单状态变更（创建→支付→退款）。

```sql
-- 商品实时聚合表
CREATE TABLE ecommerce.product_sales_agg
(
    product_id     UInt64,
    sale_date      Date,
    order_count    Int64,       -- 订单数（可正可负）
    total_amount   Decimal(18,2), -- 总金额
    total_quantity Int64,       -- 总件数
    sign           Int8         -- +1 增加, -1 抵消
)
ENGINE = CollapsingMergeTree(sign)
PARTITION BY toYYYYMM(sale_date)
ORDER BY (product_id, sale_date);
```

### 数据写入

```sql
-- 订单创建：+1
INSERT INTO ecommerce.product_sales_agg VALUES
(2001, '2026-06-10', 1, 299.00, 2, 1),
(2002, '2026-06-10', 1, 599.00, 1, 1);

-- 订单 2001 发生退款：插入 -1 行抵消
INSERT INTO ecommerce.product_sales_agg VALUES
(2001, '2026-06-10', 1, 299.00, 2, -1);

-- 订单 2001 部分退款后重新下单：+1 行新值
INSERT INTO ecommerce.product_sales_agg VALUES
(2001, '2026-06-10', 1, 199.00, 1, 1);
```

### 正确查询

```sql
-- ❌ 错误：直接 sum 会把 +1 和 -1 混在一起
SELECT product_id, sum(order_count) as orders, sum(total_amount) as amount
FROM ecommerce.product_sales_agg
GROUP BY product_id;

-- ✅ 正确：使用 sumState + sumMerge，或手动过滤
SELECT product_id, sum(order_count) as orders, sum(total_amount) as amount
FROM ecommerce.product_sales_agg FINAL
GROUP BY product_id;
```

### 使用 AggregatingMergeTree 优化

对于高频聚合查询，CollapsingMergeTree 的 FINAL 仍然有性能开销。更好的方案是结合 `AggregatingMergeTree`：

```sql
-- 使用 AggregatingMergeTree 存储预聚合状态
CREATE TABLE ecommerce.product_sales_agg_v2
(
    product_id     UInt64,
    sale_date      Date,
    order_count    AggregateFunction(sum, Int64),
    total_amount   AggregateFunction(sum, Decimal(18,2)),
    total_quantity AggregateFunction(sum, Int64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(sale_date)
ORDER BY (product_id, sale_date);

-- 写入时使用 State 函数
INSERT INTO ecommerce.product_sales_agg_v2
SELECT
    product_id,
    sale_date,
    sumState(toInt64(1)) as order_count,
    sumState(amount) as total_amount,
    sumState(quantity) as total_quantity
FROM (
    SELECT 2001 as product_id, '2026-06-10' as sale_date, 299.00 as amount, toInt64(2) as quantity
)
GROUP BY product_id, sale_date;

-- 查询时使用 Merge 函数
SELECT
    product_id,
    sale_date,
    sumMerge(order_count) as orders,
    sumMerge(total_amount) as amount,
    sumMerge(total_quantity) as qty
FROM ecommerce.product_sales_agg_v2
GROUP BY product_id, sale_date;
```

## 踩坑记录

### 坑 1：FINAL 不是万能的

`FINAL` 只保证当前 part 内的去重，如果两个相同排序键的行在不同 part 中，merge 前 FINAL 也无法去重。

解决方案：
- 写入时保证幂等性（相同数据只写一次）
- 查询时使用子查询 + `argMax` 替代 FINAL
- 定期执行 `OPTIMIZE TABLE ... FINAL` 强制合并（仅用于测试或低频场景）

### 坑 2：CollapsingMergeTree 的 -1 行丢失

如果 -1 行和 +1 行被分配到不同 part，且其中一个 part 被合并时另一个还没写入，就会导致 -1 行被"丢弃"。

```sql
-- 错误模式：先写 +1，隔很久再写 -1
INSERT INTO product_sales_agg VALUES (2001, '2026-06-10', 1, 299.00, 2, 1);
-- ... 30 秒后 ...
INSERT INTO product_sales_agg VALUES (2001, '2026-06-10', 1, 299.00, 2, -1);
```

解决方案：
- 尽量在同一个 INSERT 中写入 +1 和 -1 行
- 使用 `VersionedCollapsingMergeTree`，它会在合并时检查版本号

### 坑 3：LowCardinality 的陷阱

`LowCardinality(String)` 适合基数在几千以内的字段。如果字段值种类过多（如 `page_url`），反而会增加内存消耗：

```sql
-- ❌ page_url 可能有几十万种值，不适合 LowCardinality
page_url LowCardinality(String)

-- ✅ 用普通 String
page_url String

-- ✅ 或者用 LowCardinality 存储归一化后的路径模板
page_template LowCardinality(String)  -- /product/{id}
```

### 坑 4：排序键设计影响查询性能

排序键决定了数据的物理排列顺序。如果查询条件不包含排序键的前缀列，ClickHouse 需要全表扫描：

```sql
-- 排序键 (user_id, event_type, event_time, event_id)

-- ✅ 高效：命中排序键前缀
SELECT * FROM user_events WHERE user_id = 10001;
SELECT * FROM user_events WHERE user_id = 10001 AND event_type = 'view';

-- ❌ 低效：跳过前缀列
SELECT * FROM user_events WHERE event_type = 'view';
SELECT * FROM user_events WHERE event_time > '2026-06-10';
```

排序键设计原则：
- 把等值查询条件的列放前面
- 把范围查询条件的列放后面
- 把基数低的列放前面

### 坑 5：Decimal 精度与聚合

`Decimal(18,2)` 在聚合时可能出现精度问题：

```sql
-- 如果金额字段是 Float64，聚合结果可能不精确
-- 永远使用 Decimal 类型存储金额
amount Decimal(18,2)  -- ✅ 精确
amount Float64        -- ❌ 有精度丢失风险
```

## Laravel 集成

### 安装 ClickHouse 驱动

```bash
composer require smi2/phpclickhouse
```

### 封装 Service

```php
<?php

namespace App\Services\ClickHouse;

use ClickHouse\Client;

class ClickHouseService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(
            config('clickhouse.host', 'localhost'),
            config('clickhouse.port', 8123),
            config('clickhouse.username', 'default'),
            config('clickhouse.password', '')
        );
    }

    /**
     * 批量写入埋点事件（幂等，基于 event_id 去重）
     */
    public function insertEvents(array $events): void
    {
        $rows = array_map(function ($event) {
            return [
                'event_id'    => $event['event_id'],
                'user_id'     => (int)$event['user_id'],
                'session_id'  => $event['session_id'],
                'event_type'  => $event['event_type'],
                'product_id'  => (int)$event['product_id'],
                'category_id' => (int)$event['category_id'],
                'page_url'    => $event['page_url'],
                'referrer_url'=> $event['referrer_url'] ?? '',
                'device_type' => $event['device_type'] ?? 'unknown',
                'browser'     => $event['browser'] ?? 'unknown',
                'country'     => $event['country'] ?? '',
                'city'        => $event['city'] ?? '',
                'extra_json'  => json_encode($event['extra'] ?? []),
                'event_time'  => $event['event_time'],
                'server_time' => date('Y-m-d H:i:s'),
                'version'     => $event['version'] ?? time(),
            ];
        }, $events);

        $this->client->insert(
            'ecommerce.user_events',
            $rows,
            ['event_id', 'user_id', 'session_id', 'event_type', 'product_id',
             'category_id', 'page_url', 'referrer_url', 'device_type', 'browser',
             'country', 'city', 'extra_json', 'event_time', 'server_time', 'version']
        );
    }

    /**
     * 查询商品实时销量（使用 argMax 避免 FINAL 性能问题）
     */
    public function getProductSales(string $date, array $productIds = []): array
    {
        $sql = "
            SELECT
                product_id,
                count() as order_count,
                sumMerge(total_amount_state) as total_amount,
                sumMerge(total_qty_state) as total_quantity
            FROM (
                SELECT
                    product_id,
                    sumState(order_count) as order_count,
                    sumState(total_amount) as total_amount_state,
                    sumState(total_quantity) as total_qty_state
                FROM ecommerce.product_sales_agg
                WHERE sale_date = :date
                " . (!empty($productIds) ? "AND product_id IN :ids" : "") . "
                GROUP BY product_id, sale_date
            )
            GROUP BY product_id
        ";

        $params = ['date' => $date];
        if (!empty($productIds)) {
            $params['ids'] = $productIds;
        }

        return $this->client->select($sql, $params)->rows();
    }

    /**
     * UV 统计（使用 argMax 去重）
     */
    public function getUVByEventType(string $startDate, string $endDate): array
    {
        $sql = "
            SELECT
                event_type,
                uniq(user_id) as uv,
                count() as pv
            FROM (
                SELECT
                    user_id,
                    event_type,
                    event_id,
                    argMax(event_time, version) as event_time
                FROM ecommerce.user_events
                WHERE event_time >= :start AND event_time < :end
                GROUP BY user_id, event_type, event_id
            )
            GROUP BY event_type
            ORDER BY pv DESC
        ";

        return $this->client->select($sql, [
            'start' => $startDate,
            'end'   => $endDate,
        ])->rows();
    }

    /**
     * 写入销量变更（+1 / -1 模式）
     */
    public function applySalesChange(int $productId, string $date, array $change): void
    {
        $this->client->insert(
            'ecommerce.product_sales_agg',
            [[
                'product_id'   => $productId,
                'sale_date'    => $date,
                'order_count'  => $change['order_count'],
                'total_amount' => $change['total_amount'],
                'total_quantity'=> $change['total_quantity'],
                'sign'         => $change['sign'], // +1 or -1
            ]],
            ['product_id', 'sale_date', 'order_count', 'total_amount', 'total_quantity', 'sign']
        );
    }
}
```

### 在 Laravel 中使用

```php
<?php

namespace App\Http\Controllers;

use App\Services\ClickHouse\ClickHouseService;

class AnalyticsController extends Controller
{
    public function dashboard(ClickHouseService $ch)
    {
        $today = date('Y-m-d');

        // 今日各事件类型 UV/PV
        $eventStats = $ch->getUVByEventType($today, date('Y-m-d', strtotime('+1 day')));

        // Top 10 商品销量
        $topProducts = $ch->getProductSales($today);

        return response()->json([
            'event_stats' => $event_stats,
            'top_products' => array_slice($topProducts, 0, 10),
        ]);
    }
}
```

### 消费 Kafka 写入 ClickHouse

在实际生产中，埋点数据通常通过 Kafka 消费后写入 ClickHouse：

```php
<?php

namespace App\Jobs;

use App\Services\ClickHouse\ClickHouseService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;

class ConsumeEventToClickHouse implements ShouldQueue
{
    use Queueable;

    public function handle(ClickHouseService $ch): void
    {
        $consumer = new \RdKafka\KafkaConsumer([
            'metadata.broker.list' => config('kafka.brokers'),
            'group.id'             => 'clickhouse-event-writer',
            'auto.offset.reset'    => 'latest',
        ]);

        $consumer->subscribe(['user-events']);

        $batch = [];
        $lastFlush = time();

        while (true) {
            $message =->consume(100);

            if ($message->err === RD_KAFKA_RESP_ERR_NO_ERROR) {
                $event = json_decode($message->payload, true);
                $event['version'] = $event['timestamp'] ?? time();
                $batch[] = $event;
            }

            // 每 1000 条或每 5 秒批量写入
            if (count($batch) >= 1000 || (time() - $lastFlush >= 5 && !empty($batch))) {
                $ch->insertEvents($batch);
                $batch = [];
                $lastFlush = time();
            }
        }
    }
}
```

## 性能优化建议

### 1. 合理设置 merge 参数

```xml
<!-- config.xml 或 users.xml -->
<merge_tree>
    <!-- 增大 max_suspicious_broken_parts，避免小 part 过多导致 merge 失败 -->
    <max_suspicious_broken_parts>50</max_suspicious_broken_parts>

    <!-- 控制并发 merge 数量 -->
    <number_of_free_entries_in_pool_to_execute_mutation>10</number_of_free_entries_in_pool_to_execute_mutation>
</merge_tree>
```

### 2. 使用 TTL 自动清理历史数据

```sql
-- 保留 90 天数据，自动删除过期 part
ALTER TABLE ecommerce.user_events
MODIFY TTL event_time + INTERVAL 90 DAY;
```

### 3. 物化视图预聚合

```sql
-- 创建实时聚合视图
CREATE MATERIALIZED VIEW ecommerce.event_type_stats_mv
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMMDD(event_time)
ORDER BY (event_time, event_type)
AS SELECT
    toStartOfMinute(event_time) as event_time,
    event_type,
    countState() as event_count,
    uniqState(user_id) as uv
FROM ecommerce.user_events
GROUP BY event_time, event_type;
```

### 4. 监控 Merge 健康度

```sql
-- 查看各 part 的行数分布，判断 merge 是否正常
SELECT
    partition,
    count() as parts_count,
    sum(rows) as total_rows,
    min(rows) as min_rows,
    max(rows) as max_rows
FROM system.parts
WHERE database = 'ecommerce'
  AND table = 'user_events'
  AND active = 1
GROUP BY partition
ORDER BY partition;
```

## 总结

| 场景 | 引擎选择 | 核心要点 |
|------|---------|---------|
| 幂等去重（埋点） | ReplacingMergeTree | 用 `argMax` 替代 `FINAL`，版本号选时间戳 |
| 增量聚合（订单统计） | CollapsingMergeTree | +1/-1 必须在同一 INSERT，配合 AggregatingMergeTree |
| 实时预聚合 | AggregatingMergeTree | 物化视图 + State/Merge 函数 |
| 高并发写入 | Buffer 引擎包装 | Buffer → MergeTree，减少 part 数量 |

ReplacingMergeTree 和 CollapsingMergeTree 是 ClickHouse 解决数据一致性的两大利器。前者适合"去重"，后者适合"加减"。理解它们的合并语义和查询陷阱，才能在电商埋点这类高频写入场景中游刃有余。

记住一个原则：**ClickHouse 的一致性保证是最终一致，不是实时一致。** 设计表结构和查询时，始终要考虑"merge 尚未完成"的中间状态。
