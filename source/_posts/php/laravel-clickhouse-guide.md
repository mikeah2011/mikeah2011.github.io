---

title: Laravel + ClickHouse 实战：埋点宽表、物化视图与漏斗报表性能治理踩坑记录
keywords: [Laravel, ClickHouse, 埋点宽表, 物化视图与漏斗报表性能治理踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 14:30:56
updated: 2026-05-04 14:32:11
categories:
- php
tags:
- Laravel
- MySQL
- 工程管理
- 性能优化
description: Laravel + ClickHouse 实战：从 MySQL 迁移到 OLAP 列式存储的完整落地过程。涵盖埋点宽表设计、批量写入优化、物化视图聚合、漏斗查询性能治理（P95 从 6.8s 降至 420ms）与 4 个生产踩坑修复，适合做用户行为分析和运营报表的 Laravel 团队参考。
---


在后台运营报表场景里，最容易被低估的不是“写接口”，而是**行为埋点查询**。我接手过一个 Laravel B2C 后台，商品浏览、加购、提交订单、支付成功都先落在 MySQL，运营每天查漏斗、渠道转化、活动效果。数据量上来后，问题很快出现：单日埋点 1200 万行，读库高峰期 P95 超过 **6.8s**，导出一跑，业务查询也跟着抖。

这次改造没有继续给 MySQL 硬塞索引，而是把**行为分析**从交易库里剥离出来，Laravel 只负责采集和投递，查询侧改到 ClickHouse。最终结果很直接：同一份日漏斗报表，从 6.8s 降到 **420ms**；再加上物化视图后，后台常用维度查询能稳定在 **90~150ms**。

## 一、最终落地结构

```text
Web / App
   │
   ▼
Laravel API
   │  afterCommit 记录 outbox_event
   ▼
Queue Job 批量刷数
   │
   ├── ClickHouse user_action_events
   │        └── Materialized View -> funnel_daily
   │
   └── 失败重试 / 死信告警

Admin BI / 内部报表
   │
   ▼
Laravel Report Query Service
   │
   └── ClickHouse 聚合查询
```

这里我刻意没有让控制器直接写 ClickHouse，而是保留了一层 `outbox_event`。原因很现实：报表链路允许秒级延迟，但不能因为 ClickHouse 抖一下就拖垮下单事务。

## 二、宽表先按“查询维度”设计，不按对象模型设计

一开始最容易犯的错，是照着前端埋点 JSON 原样入库，结果字段散、类型乱、查询永远要 `JSONExtract`。后来我把高频维度直接摊平成宽表：

```sql
CREATE TABLE user_action_events
(
    event_date Date,
    event_time DateTime64(3, 'Asia/Shanghai'),
    event_uuid UUID,
    user_id UInt64,
    session_id String,
    source LowCardinality(String),
    route LowCardinality(String),
    event_name LowCardinality(String),
    product_id UInt64,
    order_id UInt64,
    amount UInt32,
    properties String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_name, source, route, user_id, event_time, event_uuid)
TTL event_date + INTERVAL 180 DAY DELETE;
```

几个关键点：

1. `event_name/source/route` 用 `LowCardinality(String)`，节省字典存储和扫描成本。
2. `PARTITION BY` 只按月，不要按天切太碎，不然后期 merge 压力会很难看。
3. `properties` 只保留低频扩展字段，高频筛选条件一定要单独拆列。

## 三、Laravel 侧只做批量写入，不做逐条直插

我最后用的是 `smi2/phpclickhouse`，重点不是“能连上”，而是**批量**。逐条插入在低峰期看不出问题，高峰会被 HTTP 往返和小批次 merge 拖死。

```php
<?php

namespace App\Infrastructure\Analytics;

use ClickHouseDB\Client;

final class ClickHouseEventWriter
{
    public function __construct(private readonly Client $client)
    {
        $this->client->database(config('services.clickhouse.database'));
        $this->client->settings()->set('async_insert', 1);
        $this->client->settings()->set('wait_for_async_insert', 1);
    }

    public function insert(array $events): void
    {
        if ($events === []) {
            return;
        }

        $rows = array_map(static fn (array $event) => [
            'event_date' => substr($event['event_time'], 0, 10),
            'event_time' => $event['event_time'],
            'event_uuid' => $event['event_uuid'],
            'user_id' => (int) $event['user_id'],
            'session_id' => (string) $event['session_id'],
            'source' => (string) $event['source'],
            'route' => (string) $event['route'],
            'event_name' => (string) $event['event_name'],
            'product_id' => (int) ($event['product_id'] ?? 0),
            'order_id' => (int) ($event['order_id'] ?? 0),
            'amount' => (int) ($event['amount'] ?? 0),
            'properties' => json_encode($event['properties'] ?? [], JSON_UNESCAPED_UNICODE),
        ], $events);

        $this->client->insertAssocBulk('user_action_events', $rows);
    }
}
```

配套的 Job 会先 claim 一批 outbox，再统一刷入，成功后回写状态：

```php
<?php

final class FlushAnalyticsEventsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(OutboxEventRepository $repo, ClickHouseEventWriter $writer): void
    {
        $batch = $repo->claimPending('analytics.event', 1000);

        if ($batch === []) {
            return;
        }

        try {
            $writer->insert(array_map(fn ($event) => $event->payload, $batch));
            $repo->markDone(array_column($batch, 'id'));
        } catch (\Throwable $e) {
            $repo->release(array_column($batch, 'id'), $e->getMessage());
            throw $e;
        }
    }
}
```

这里批次我实际压到 **500~1000** 比较稳。再大，单包体积和失败重试成本都不太好看。

## 四、常用漏斗不要每次扫明细，直接上物化视图

原始明细表适合追查，但后台首页最常查的是天级漏斗。这个场景直接建物化视图：

```sql
CREATE TABLE funnel_daily
(
    d Date,
    source LowCardinality(String),
    view_users AggregateFunction(uniqExact, UInt64),
    cart_users AggregateFunction(uniqExact, UInt64),
    submit_users AggregateFunction(uniqExact, UInt64),
    pay_users AggregateFunction(uniqExact, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(d)
ORDER BY (d, source);

CREATE MATERIALIZED VIEW funnel_daily_mv TO funnel_daily AS
SELECT
    toDate(event_time) AS d,
    source,
    uniqExactStateIf(user_id, event_name = 'view_product') AS view_users,
    uniqExactStateIf(user_id, event_name = 'add_to_cart') AS cart_users,
    uniqExactStateIf(user_id, event_name = 'submit_order') AS submit_users,
    uniqExactStateIf(user_id, event_name = 'pay_order') AS pay_users
FROM user_action_events
GROUP BY d, source;
```

查询时不要直接 `SELECT *`，而是要 merge state：

```sql
SELECT
    d,
    source,
    uniqExactMerge(view_users) AS uv_view,
    uniqExactMerge(cart_users) AS uv_cart,
    uniqExactMerge(submit_users) AS uv_submit,
    uniqExactMerge(pay_users) AS uv_pay
FROM funnel_daily
WHERE d BETWEEN '2026-05-01' AND '2026-05-03'
GROUP BY d, source
ORDER BY d, source;
```

这一步做完后，Laravel 报表服务就只需要拼过滤条件，不再碰复杂多层子查询。

## 五、Laravel 查询层怎么收口

我没有让控制器直接拼 SQL，而是单独做一个 `FunnelReportService`，把时间范围、渠道过滤、返回结构统一收口。这样做的好处是后面切换口径时，只改服务层，不会把 ClickHouse 方言散落到每个 Controller。

```php
<?php

final class FunnelReportService
{
    public function __construct(private readonly ClickHouseQueryClient $client) {}

    public function daily(string $startDate, string $endDate, array $sources = []): array
    {
        $bindings = [
            'start' => $startDate,
            'end' => $endDate,
        ];

        $sourceFilter = '';

        if ($sources !== []) {
            $quoted = array_map(fn (string $source) => "'" . addslashes($source) . "'", $sources);
            $sourceFilter = ' AND source IN (' . implode(',', $quoted) . ')';
        }

        $sql = <<<SQL
SELECT
    d,
    source,
    uniqExactMerge(view_users) AS uv_view,
    uniqExactMerge(cart_users) AS uv_cart,
    uniqExactMerge(submit_users) AS uv_submit,
    uniqExactMerge(pay_users) AS uv_pay
FROM funnel_daily
WHERE d BETWEEN {start:Date} AND {end:Date}{$sourceFilter}
GROUP BY d, source
ORDER BY d ASC, source ASC
SQL;

        return $this->client->select($sql, $bindings);
    }
}
```

这里还有一个经验：**报表服务不要暴露“任意 SQL 能力”给业务层**。一旦 Controller 能自由拼接字段，最后很快就会回到 MySQL 时代那种每个页面一套口径、没人敢改的状态。

## 六、历史数据回填不能跟线上写入抢资源

上线前我们还做了一次三个月历史数据回灌。这个阶段最危险的是一次性全量导入，把线上 merge 和查询都打爆。我的做法是按天分片回放，每批次先从 MySQL 导出到 NDJSON，再通过离线 worker 低峰导入 ClickHouse，同时对账当天 UV/订单数是否一致。

真正省事的不是“导入成功”，而是**导入失败后能从哪一天继续**。所以每个回填任务我都记录 `biz_date + chunk_no`，失败后只重跑断点，不重新扫整个月。这个机制在第一次回灌时救过命：当时 5 月 1 日活动数据里混入坏 JSON，任务在第 37 个分片炸掉，如果没有断点续跑，只能整天重来。

## 七、我在生产里踩过的 4 个坑

### 1. 时区错了，整张报表会“看起来没错但总数不对”
最早 `event_time` 用 UTC，后台却按上海时间看日报，凌晨 0 点到 8 点的数据全跑到前一天。修法不是前端硬转，而是库表直接统一 `DateTime64(3, 'Asia/Shanghai')`，并且 Laravel 写入前就格式化好。

### 2. 不要把所有字段都塞 JSON
我一开始偷懒把 `channel/campaign/device` 放进 `properties`，结果报表 SQL 里到处是 `JSONExtractString`，CPU 飙得很明显。经验是：**会出现在 WHERE / GROUP BY 的字段必须拆列**。

### 3. at-least-once 重试会制造重复事件
队列重试后，ClickHouse 明细表会出现重复。我的处理不是强依赖实时去重，而是用 `event_uuid` 做离线核对，并让报表口径优先使用 `uniqExact(user_id)` 这类聚合，避免简单 `count()` 失真。

### 4. 小批量高频插入会把 merge 打爆
最开始每 50 条 flush 一次，结果 `system.parts` 持续膨胀，查询性能反而变差。后来把批次调到 500+，并开启 `async_insert`，后台波峰才稳下来。

## 八、为什么这次改造值得

这套方案最有价值的地方，不是“换了个更快的数据库”，而是把**交易存储**和**分析查询**彻底分开了。Laravel 继续维护业务事务，ClickHouse 专注做聚合、扫描和报表，职责清楚后，排障和扩容都简单很多。

如果你的 Laravel 项目已经出现下面这些信号：运营报表长期拖慢读库、埋点 SQL 越写越像 ETL、导出任务和线上查询互相抢资源，那基本就不是"再补一个索引"能解决的问题了。把报表链路独立到 ClickHouse，通常会比继续在 MySQL 上硬扛更划算。

## 相关阅读

- [ClickHouse vs PostgreSQL 分析查询对比：OLAP 场景下的选型决策与 Laravel 集成](/categories/01_MySQL/2026-06-02-clickhouse-vs-postgresql-olap-selection-laravel-integration/) — 千万级订单明细表的真实性能对比，详解行存与列存的本质差异、MergeTree 引擎优化与 TCO 成本分析，帮你决定该选 ClickHouse 还是 PostgreSQL 做 OLAP。
- [DuckDB + Laravel 实战：嵌入式 OLAP 引擎——在 PHP 进程内做百万级数据分析](/categories/05_PHP/Laravel/2026-06-06-DuckDB-Laravel-实战-嵌入式OLAP引擎-百万级数据分析零基础设施方案/) — 如果数据量在百万级且不想部署独立 OLAP 集群，DuckDB 嵌入式方案可以在 PHP 进程内完成漏斗分析与审计日志聚合，零基础设施成本。
- [dbt 实战：SQL 优先的数据转换框架——Laravel 项目的数据仓库建模与版本化治理](/categories/架构/dbt-data-build-tool-实战-SQL优先数据转换框架-Laravel数据仓库建模与版本化治理/) — 当 ClickHouse 里的原始宽表越来越多，用 dbt 做 Staging → Marts 分层建模，可以让你的数据仓库像代码一样版本化和可测试。
