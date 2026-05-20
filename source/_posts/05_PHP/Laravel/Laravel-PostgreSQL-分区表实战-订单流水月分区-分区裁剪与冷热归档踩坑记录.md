---
title: Laravel + PostgreSQL 分区表实战：订单流水月分区、分区裁剪与冷热归档踩坑记录
date: 2026-05-03 11:25:22
updated: 2026-05-03 11:29:03
categories:
  - PHP
  - Laravel
tags: [Laravel, MySQL, PostgreSQL, 监控]
description: 结合订单流水表持续膨胀的生产问题，记录一套在 Laravel 中落地 PostgreSQL 月分区、分区裁剪、历史归档与在线迁移的实战方案，重点覆盖 DDL 设计、写入路由、查询改造与真实踩坑。
---

订单系统最难处理的表，往往不是 `orders`，而是不断追加的 `order_events`、`payment_logs` 这类流水表。它们写多读少，但一旦运营要查三个月前的退款链路、财务要导半年的支付对账，单表很快就会从“还能忍”变成“谁查谁卡”。我在一个 Laravel 订单中心里踩过这类坑：`payment_logs` 跑到 1.8 亿行后，普通索引还在，写入也没报错，但后台按时间筛选的 P95 已经接近 4 秒，VACUUM 和备份窗口也越来越难排。

最后真正把问题压下去的，不是继续补索引，而是把这张典型流水表改成 **按月分区 + 热冷分层归档**。核心思想很简单：**高频查询永远只扫最近几个月，历史数据可查，但不该持续拖累在线写入。**

## 一、我最后落地的结构

```text
            +---------------- Laravel API / Job ----------------+
            | write payment log / query by time range           |
            +---------------------------+-----------------------+
                                        |
                                        v
                         payment_logs (PARTITIONED TABLE)
                 +------------+------------+------------+------------+
                 | 2026_05    | 2026_04    | 2026_03    | history... |
                 | hot data   | hot data   | warm data  | cold data  |
                 +------------+------------+------------+------------+
                        |              |                       |
                        +------ partition pruning ------------+
                                        |
                                        v
                               archive / detach / backup
```

这里我只对**明显按时间访问**的流水表做分区，订单主表依旧保持普通表。原因很现实：主表查询维度太杂，强行分区容易把唯一约束、跨分区查询和应用复杂度一起抬上来；流水表则天然适合按时间切。

## 二、PostgreSQL 分区表 DDL 设计

先建母表：

```sql
CREATE TABLE payment_logs (
    id BIGSERIAL NOT NULL,
    order_id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    provider VARCHAR(16) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

然后按月建子分区：

```sql
CREATE TABLE payment_logs_2026_05
PARTITION OF payment_logs
FOR VALUES FROM ('2026-05-01 00:00:00') TO ('2026-06-01 00:00:00');

CREATE INDEX idx_payment_logs_2026_05_order_created
ON payment_logs_2026_05 (order_id, created_at DESC);

CREATE INDEX idx_payment_logs_2026_05_tenant_created
ON payment_logs_2026_05 (tenant_id, created_at DESC);
```

这里最容易忽略的是主键。因为 PostgreSQL 分区表上的唯一约束必须包含分区键，所以我没有再坚持单列 `id` 主键，而是改成 `(id, created_at)`。如果业务真的依赖全局唯一 `id` 做外键，建议把流水表从“被引用对象”改成“只追加日志”，不要硬把旧模型套进来。

## 三、Laravel 写入层不用知道分区名

应用侧只写母表，PostgreSQL 会自动路由到对应分区：

```php
final class PaymentLog extends Model
{
    protected $table = 'payment_logs';

    protected $fillable = [
        'order_id',
        'tenant_id',
        'event_type',
        'provider',
        'payload',
        'created_at',
    ];

    protected $casts = [
        'payload' => 'array',
        'created_at' => 'datetime',
    ];
}

PaymentLog::create([
    'order_id' => $orderId,
    'tenant_id' => $tenantId,
    'event_type' => 'capture_succeeded',
    'provider' => 'stripe',
    'payload' => $callbackPayload,
    'created_at' => now(),
]);
```

真正要做的是**提前建未来分区**。我在 Laravel 里放了一个调度命令，每天检查未来两个月是否存在，不存在就补：

```php
final class EnsurePaymentLogPartitions extends Command
{
    protected $signature = 'app:ensure-payment-log-partitions';

    public function handle(): int
    {
        foreach ([0, 1, 2] as $offset) {
            $start = now()->startOfMonth()->addMonths($offset);
            $end = (clone $start)->addMonth();
            $suffix = $start->format('Y_m');

            DB::statement(sprintf(
                "CREATE TABLE IF NOT EXISTS payment_logs_%s PARTITION OF payment_logs FOR VALUES FROM ('%s') TO ('%s')",
                $suffix,
                $start->format('Y-m-d H:i:s'),
                $end->format('Y-m-d H:i:s'),
            ));
        }

        return self::SUCCESS;
    }
}
```

## 四、查询不改写法，就吃不到分区裁剪红利

我最开始以为改成分区表后会自动变快，结果第一轮压测几乎没变化。问题出在代码里大量存在：

```php
PaymentLog::query()
    ->where('order_id', $orderId)
    ->whereDate('created_at', '>=', $from)
    ->whereDate('created_at', '<=', $to)
    ->latest('created_at')
    ->limit(100)
    ->get();
```

`whereDate()` 会把列包进函数，优化器没法稳定做分区裁剪。改成**原始时间范围**后，执行计划才会只扫命中的月分区：

```php
PaymentLog::query()
    ->where('order_id', $orderId)
    ->where('created_at', '>=', $from->startOfDay())
    ->where('created_at', '<', $to->addDay()->startOfDay())
    ->orderByDesc('created_at')
    ->limit(100)
    ->get();
```

这次改完后，最近 30 天的支付流水查询从 3 秒级掉到 300ms 左右，最关键的是波动变小了。

## 五、冷热归档怎么做才不影响线上

我们的做法不是直接 `DELETE` 老数据，而是按月 `DETACH PARTITION` 后单独备份：

```sql
ALTER TABLE payment_logs DETACH PARTITION payment_logs_2025_10;
ALTER TABLE payment_logs_2025_10 RENAME TO payment_logs_2025_10_archive;
```

脱离母表后，这张历史表就不会再参与在线查询计划。需要查旧账时，单独挂只读库或者做归档库检索。相比在线大批量删除，这种方式对 WAL、锁和 autovacuum 都友好得多。

## 六、在线迁移不要停机硬切

如果旧表已经跑在生产上，最危险的动作就是直接 `ALTER TABLE` 期待它原地变成分区表。我的实际做法是：**新建分区表、批量回填、灰度双写、只读校验、最后切换表名**。这样虽然步骤多，但每一步都可回滚。

先准备回填命令，按主键窗口搬数据，避免一次事务过大：

```php
final class BackfillPaymentLogsToPartitionedTable extends Command
{
    protected $signature = 'app:backfill-payment-logs {--chunk=5000}';

    public function handle(): int
    {
        $chunk = (int) $this->option('chunk');
        $lastId = 0;

        do {
            $rows = DB::table('payment_logs_legacy')
                ->where('id', '>', $lastId)
                ->orderBy('id')
                ->limit($chunk)
                ->get();

            if ($rows->isEmpty()) {
                break;
            }

            DB::transaction(function () use ($rows) {
                foreach ($rows as $row) {
                    DB::table('payment_logs')->insert([
                        'id' => $row->id,
                        'order_id' => $row->order_id,
                        'tenant_id' => $row->tenant_id,
                        'event_type' => $row->event_type,
                        'provider' => $row->provider,
                        'payload' => $row->payload,
                        'created_at' => $row->created_at,
                    ]);
                }
            });

            $lastId = $rows->last()->id;
        } while (true);

        return self::SUCCESS;
    }
}
```

切换当天我会先让新写入走双写几分钟，再比对计数和抽样数据：

```sql
SELECT date_trunc('day', created_at) AS day, count(*)
FROM payment_logs_legacy
GROUP BY 1
ORDER BY 1 DESC;

SELECT date_trunc('day', created_at) AS day, count(*)
FROM payment_logs
GROUP BY 1
ORDER BY 1 DESC;
```

真正上线后，这个步骤帮我挡掉过一次事故：回填脚本里少带了 `tenant_id`，因为做了按天计数和按订单抽样校验，切换前就把问题抓出来了。分区方案本身不复杂，**复杂的是迁移路径**。

## 七、三个最容易翻车的坑

### 坑一：没提前建分区，月初零点直接写爆

PostgreSQL 不会替你自动建下个月分区。没有目标分区时，插入会直接报错。这个坑在测试环境不明显，但生产月初一定会出事，所以要把建分区动作前置到调度任务和监控里。

### 坑二：把所有索引建在每个分区上，写入反而更慢

分区不是索引免死金牌。流水表上我只保留 `(order_id, created_at)` 和 `(tenant_id, created_at)` 两类高频索引，低频查询走归档库或接受慢查，不再无脑复制旧表上的所有索引。

### 坑三：误把分区表当分库分表

分区解决的是**单机内大表管理和查询裁剪**，不是无限扩容。它不能替代真正的分库分表，也不能天然解决热点租户写入。如果问题是单租户流量过热，还是要从业务路由、队列削峰或独立库拆分下手。

## 七、我的取舍建议

如果你的表同时满足这三个条件：**数据持续追加、查询强依赖时间范围、历史数据访问频率显著下降**，那 PostgreSQL 分区表非常值得上。对 Laravel 来说，它的好处在于应用代码改动并不大，难点主要集中在 DDL 设计、查询写法和运维自动化。真正上线后我最大的体感不是“峰值更高”，而是数据库终于不再被历史流水持续拖着跑：热数据查询更稳，归档更清晰，备份和清理也都恢复到了可控状态。