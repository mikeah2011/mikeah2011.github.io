---
title: Laravel + PostgreSQL CDC 实战：Debezium 驱动订单变更同步、乱序修复与补数回放踩坑记录
date: 2026-05-04 14:23:21
updated: 2026-05-04 14:24:58
categories:
  - 05_PHP
  - Laravel
tags: [Laravel, PostgreSQL, 消息队列]description: 结合订单中心与查询侧分离场景，记录如何在 Laravel 中用 PostgreSQL CDC + Debezium + Kafka 做变更同步，重点处理乱序、重复投递、DDL 漂移与补数回放等真实生产坑。
---

我最近把一个 Laravel 订单中心里“下单后顺手同步搜索、报表、运营看板”的流程，改成了 **PostgreSQL CDC**。原因很现实：以前在事务里同时写主库、发 MQ、刷新读模型，只要任一环节失败，就会出现“主库成功、下游没跟上”的脏状态，最后只能靠人工补单。

这次我把可靠变更捕获下沉到数据库层：Laravel 只负责把订单写对，Debezium 订阅 PostgreSQL WAL，把 `orders`、`order_items` 变更推到 Kafka，再由 Laravel 消费构建查询模型。这样做的关键收益不是炫技，而是**少掉应用层最容易漏消息的一跳**。

## 一、落地后的架构

```text
Laravel Order Service
(write orders / order_items)
          |
          v
PostgreSQL 15 (WAL / logical replication)
          |
          v
Debezium Connector
          |
          v
Kafka Topic
          |
          v
Laravel Projector Consumer
(version gate + idempotent upsert)
          |
          v
order_read_models / search / BI
```

我这里坚持一个边界：**交易库只写业务真相，不负责通知下游。** 同步责任交给 CDC，读侧只处理投影和补数。

## 二、先补版本号，不然下游永远会被乱序打穿

只靠 `updated_at` 判断新旧不够稳。高并发下同秒更新、批量补数、分区回放都可能让旧消息覆盖新状态。我最后在 `orders` 表上加了显式版本号。

```sql
ALTER TABLE orders
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

CREATE TABLE order_read_models (
    order_id BIGINT PRIMARY KEY,
    order_no VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    version BIGINT NOT NULL,
    source_updated_at TIMESTAMP NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

Laravel 写侧每次状态推进时同步递增版本：

```php
<?php

DB::transaction(function () use ($orderId) {
    $order = Order::query()->lockForUpdate()->findOrFail($orderId);

    if ($order->status !== OrderStatus::PENDING) {
        return;
    }

    $order->status = OrderStatus::PAID;
    $order->paid_at = now();
    $order->version++;
    $order->save();
});
```

这个字段后面就是读侧的生命线：**重复消息可以重放，旧版本不能回写。**

## 三、Debezium 配置别一上来扫全库

我第一次偷懒把整个 `public` schema 都同步出去，结果审计表、任务表、失败重试表全进了 Kafka，topic 数量和 consumer 负担一起爆炸。上线后我只保留关键交易表。

```json
{
  "name": "orders-cdc",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "secret",
    "database.dbname": "app",
    "topic.prefix": "orderdb",
    "plugin.name": "pgoutput",
    "slot.name": "orders_cdc_slot",
    "publication.autocreate.mode": "filtered",
    "table.include.list": "public.orders,public.order_items",
    "snapshot.mode": "initial",
    "decimal.handling.mode": "string",
    "transforms": "unwrap",
    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.add.fields": "op,table,source.ts_ms"
  }
}
```

两个配置特别有用：

- `ExtractNewRecordState`：让 Laravel 直接拿到扁平 payload，不用自己拆 Debezium envelope。
- `decimal.handling.mode=string`：金额如果被不同语言消费成不同数值格式，后面做 JSON 比对和签名经常出事故。

## 四、Laravel 读侧一定要先过版本闸门，再 upsert

很多团队做 CDC 时，consumer 收到消息就直接 `updateOrCreate()`。这在补数回放和 Kafka rebalance 时非常危险。我线上最终保留的是“先锁行、再比较版本、最后落库”。

```php
<?php

class SyncOrderReadModelConsumer
{
    public function handle(array $payload): void
    {
        $orderId = (int) $payload['id'];
        $version = (int) ($payload['version'] ?? 0);

        DB::transaction(function () use ($payload, $orderId, $version) {
            $current = OrderReadModel::query()->lockForUpdate()->find($orderId);

            if ($current && $current->version >= $version) {
                return;
            }

            OrderReadModel::query()->updateOrCreate(
                ['order_id' => $orderId],
                [
                    'order_no' => $payload['order_no'],
                    'status' => $payload['status'],
                    'total_amount' => $payload['total_amount'],
                    'version' => $version,
                    'source_updated_at' => $payload['updated_at'],
                    'payload' => $payload,
                ]
            );
        });
    }
}
```

这段代码的价值不在“优雅”，而在于它能扛住三件事：重复投递、乱序消息、历史回放。

## 五、三次真实踩坑记录

### 1. 初始快照把旧订单当新订单

`snapshot.mode=initial` 首次启动会扫全表。如果消费端把快照当成业务新增事件，报表和通知都会重放一遍。我的处理是：快照只做幂等投影，不触发任何副作用。

### 2. 字段升级后 consumer 不报错，但数据已经脏了

有次 `status` 新增一个更长的枚举值，主库没问题，读侧验证规则还是旧集合，结果 consumer 没崩，只是悄悄跳过更新。后来我加了 dead letter topic，凡是字段校验失败一律旁路，不允许静默丢消息。

### 3. 补数回放不能和实时流共用 group

第一次补数时，我让回放任务直接进线上 consumer group，结果 offset 被推进，实时流瞬间乱掉。正确做法是：**补数单独 group，写入仍然经过版本闸门**，这样即使和实时流交错，也不会把新状态冲掉。

## 六、补数能力必须提前准备

CDC 不是“永不丢数据”的魔法，真正可靠的是你能不能把一段历史安全重建。我保留了一个命令，按订单区间直接重放主库数据到读模型。

```php
<?php

Order::query()
    ->whereBetween('id', [$fromId, $toId])
    ->orderBy('id')
    ->chunkById(500, function ($orders) {
        foreach ($orders as $order) {
            OrderReadModel::query()->updateOrCreate(
                ['order_id' => $order->id],
                [
                    'order_no' => $order->order_no,
                    'status' => $order->status,
                    'total_amount' => $order->total_amount,
                    'version' => $order->version,
                    'source_updated_at' => $order->updated_at,
                    'payload' => $order->toArray(),
                ]
            );
        }
    });
```

## 七、监控别只看 connector 活着，要看业务是否追平

我线上最有用的不是 Debezium 进程存活告警，而是“主库和读侧到底差多少”。下面这个 SQL 我挂到了 Grafana，每分钟跑一次：

```sql
SELECT
    EXTRACT(EPOCH FROM (
        (SELECT MAX(updated_at) FROM orders) -
        (SELECT MAX(source_updated_at) FROM order_read_models)
    )) AS lag_seconds;
```

如果 `lag_seconds` 持续放大，就说明问题已经从基础设施层溢出到业务层了。再结合 Kafka consumer lag，基本可以快速判断到底是 connector 卡住、consumer 跑慢，还是消息格式兼容出了问题。

## 八、上线前我会强制演练这三件事

第一，**停 consumer 30 分钟再恢复**，确认版本闸门能扛住消息堆积后的乱序回放。第二，**手动改一条历史订单状态并回放区间补数**，确认补数工具不会破坏实时流。第三，**模拟字段新增**，比如给 `orders` 增加 `channel_code`，验证 consumer 没升级时是否会进入 dead letter，而不是静默吞掉。

这三件事如果不提前做，CDC 在 demo 环境永远很顺，一到生产就会暴露“可恢复性不够”的问题。

## 九、我的结论

如果你的 Laravel 交易服务已经出现“主事务里还要同步多个下游”的味道，CDC 很值得上。但前提只有两个：**写侧必须有单调版本号，读侧必须是幂等投影。** 没有这两个前提，Debezium 只会把复杂度搬家，不会减少复杂度。

这套方案上线后，我把订单写接口从“事务里做三件事”收敛成“只写主库一件事”，事务时长明显下降，最重要的是补数终于有了标准动作。对交易系统来说，**可重放、可观测、可兜底**，比“同步时看起来更快”重要得多。
