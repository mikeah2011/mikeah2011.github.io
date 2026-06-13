---
title: Laravel + PostgreSQL CDC 实战：Debezium 驱动订单变更同步、乱序修复与补数回放踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 14:23:21
updated: 2026-05-04 14:24:58
categories:
  - php
  - database
tags: [Laravel, PostgreSQL, 消息队列, Debezium, CDC, Kafka]
keywords: [Laravel, PostgreSQL CDC, Debezium, 驱动订单变更同步, 乱序修复与补数回放踩坑记录, PHP, 数据库]
description: 结合订单中心与查询侧分离场景，深入记录如何在 Laravel 中用 PostgreSQL CDC + Debezium + Kafka 做变更数据捕获与同步。涵盖 Debezium 完整配置、Laravel Kafka Consumer 消费 CDC 事件、版本闸门乱序修复、补数回放 Artisan 命令，以及乱序、重复投递、DDL 漂移、Initial Snapshot 污染等真实生产踩坑清单。



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

## 补充：CDC 方案选型对比

在决定用 Debezium 之前，我横向评估了四种主流变更捕获方案。下面这张表总结了它们在 PostgreSQL 场景下的核心差异：

| 维度 | Debezium (pgoutput) | pg_logical / Logical Replication | 数据库触发器 (Trigger) | 应用层轮询 (Polling) |
| --- | --- | --- | --- | --- |
| **侵入性** | 零侵入，只读 WAL | 零侵入，原生复制协议 | 需新建触发器 + 辅助表 | 需应用层定时扫描 |
| **延迟** | 毫秒级（WAL tailing） | 秒级（取决于发送频率） | 实时（事务内同步） | 取决于轮询间隔（通常秒~分钟级） |
| **可靠性** | 依赖 WAL + Replication Slot | 原生，Slot 保障 | 触发器失败会回滚主事务 | 可能漏扫（gap/边界问题） |
| **DDL 兼容** | DDL 变更需手动处理 schema evolution | DDL 不自动同步到订阅端 | 不受影响 | 不受影响 |
| **运维复杂度** | 中（Kafka + Connector + Slot 管理） | 低（原生命令） | 低（但调试困难） | 最低 |
| **适合场景** | 跨系统事件流、多下游消费 | 同构库实时同步、零停机迁移 | 单库内轻量级事件广播 | 低频对账、兜底补数 |
| **Laravel 集成** | 需 Kafka/RabbitMQ 做中间层 | 可直接读订阅端表 | 可通过 NOTIFY 触发 Laravel 进程 | 直接 Eloquent 查询 |
| **生产成熟度** | 高（社区活跃，Confluent 背书） | 高（PostgreSQL 原生） | 中（需严格测试触发器逻辑） | 低（仅适合非关键链路） |

我最终选 Debezium 的原因不是它"最好"，而是我的场景需要**多下游消费 + 事件溯源能力**。如果只是单库同步或迁移，Logical Replication 的运维成本更低。

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

### Debezium 生产环境补充配置

上面的配置是精简版。以下是我在线上最终使用的完整配置，包含 Slot 运维、心跳、错误处理等生产必需项：

```json
{
  "name": "orders-cdc-production",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "postgres-primary.internal",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "${secrets:pg_debezium_password}",
    "database.dbname": "app",
    "database.sslmode": "verify-full",
    "database.sslrootcert": "/etc/debezium/certs/ca.pem",

    "topic.prefix": "orderdb",
    "plugin.name": "pgoutput",
    "slot.name": "orders_cdc_slot",
    "publication.name": "dbz_publication",
    "publication.autocreate.mode": "filtered",
    "table.include.list": "public.orders,public.order_items",

    "snapshot.mode": "initial",
    "snapshot.locking.mode": "none",
    "decimal.handling.mode": "string",
    "hstore.handling.mode": "json",
    "interval.handling.mode": "string",
    "time.precision.mode": "connect",

    "transforms": "unwrap",
    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.add.fields": "op,table,source.ts_ms,source.lsn",
    "transforms.unwrap.delete.handling.mode": "rewrite",
    "transforms.unwrap.drop.tombstones": "false",

    "heartbeat.interval.ms": "10000",
    "heartbeat.topics": "orderdb的心跳",
    "slot.max.retries": "6",
    "slot.retry.delay.ms": "10000",

    "errors.log.enable": "true",
    "errors.log.include.messages": "true",
    "errors.tolerance": "none",

    "max.batch.size": "4096",
    "max.queue.size": "8192",
    "poll.interval.ms": "500"
  }
}
```

几个关键补充：

1. **`snapshot.locking.mode: none`**：快照期间不锁表，避免影响线上写入。代价是快照可能读到不一致数据，但配合版本闸门可以兜底。
2. **`heartbeat.interval.ms`**：当没有数据变更时，Connector 仍会发送心跳保持 Replication Slot 存活。不设心跳的话，Slot 可能被 `max_replication_slots` 回收。
3. **`errors.tolerance: none`**：遇到无法处理的消息（如字段类型不匹配）直接报错停止，而不是静默跳过。生产上宁可停 Connector 也不允许脏数据流过。
4. **`source.lsn` 字段**：在 payload 中携带 WAL LSN，方便下游做精确排查和补数定位。
5. **`snapshot.mode` 的其他选项**：`never`（跳过快照，只消费新变更）、`schema_only`（只同步 schema 不同步数据）、`exported`（配合外部快照工具）。首次上线建议用 `initial`，之后故障恢复用 `no_data`。

### 用 Docker Compose 快速搭建 Debezium + Kafka 环境

如果你想本地验证整条链路，这是我用的 `docker-compose.yml` 精简版：

```yaml
version: '3.8'
services:
  zookeeper:
    image: quay.io/debezium/zookeeper:2.5
    ports: ["2181:2181"]

  kafka:
    image: quay.io/debezium/kafka:2.5
    ports: ["9092:9092"]
    environment:
      ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    depends_on: [zookeeper]

  postgres:
    image: postgres:15
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    command: >
      postgres
        -c wal_level=logical
        -c max_replication_slots=4
        -c max_wal_senders=4

  connect:
    image: quay.io/debezium/connect:2.5
    ports: ["8083:8083"]
    environment:
      BOOTSTRAP_SERVERS: kafka:9092
      GROUP_ID: connect-cluster
      CONFIG_STORAGE_TOPIC: connect-configs
      OFFSET_STORAGE_TOPIC: connect-offsets
      STATUS_STORAGE_TOPIC: connect-status
    depends_on: [kafka, postgres]
```

启动后，用 `curl` 注册 Connector：

```bash
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @connector-config.json

# 验证 Connector 状态
curl http://localhost:8083/connectors/orders-cdc/status | jq .
```

### Replication Slot 运维要点

Debezium 依赖 PostgreSQL 的 Replication Slot 来保证 WAL 不被清理。但 Slot 是有代价的：

```sql
-- 查看 Slot 状态和 WAL 堆积量
SELECT
    slot_name,
    plugin,
    active,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;
```

如果 `retained_wal` 持续增长，说明 Consumer 消费不过来或者 Connector 已经断开。**必须设置告警**，否则 WAL 会把磁盘撑满，导致整个数据库不可用。我的经验是设置 `retained_wal > 1GB` 的告警阈值。

Slot 意外丢失（比如数据库重启后 Slot 被清理）会导致 Connector 报 `requested wal segment ... has already been removed` 错误。此时需要重新创建 Slot 并从快照重新同步。


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

这段代码的价值不在"优雅"，而在于它能扛住三件事：重复投递、乱序消息、历史回放。

## 补充：完整的 Kafka Consumer 集成方案

上面的 `SyncOrderReadModelConsumer` 是核心消费逻辑。但一个生产可用的 CDC Consumer 还需要：队列 Job 定义、Kafka 消息反序列化、错误处理与重试、Dead Letter 兜底。下面是完整的集成方案。

### Kafka 连接配置

在 `config/kafka.php`（或 `.env`）中配置 Kafka 连接：

```php
<?php

return [
    'brokers' => explode(',', env('KAFKA_BROKERS', 'localhost:9092')),
    'consumer_group' => env('KAFKA_CONSUMER_GROUP', 'order-cdc-consumer'),
    'topics' => [
        'cdc_events' => env('KAFKA_CDC_TOPIC', 'orderdb.public.orders'),
        'dead_letter' => env('KAFKA_DLQ_TOPIC', 'orderdb.cdc.dead-letter'),
    ],
    'security_protocol' => env('KAFKA_SECURITY_PROTOCOL', 'plaintext'),
    'sasl_mechanism' => env('KAFKA_SASL_MECHANISM', 'PLAIN'),
];
```

### Artisan Command：消费 CDC 事件

我选择用 Artisan Command 而不是 Laravel Queue 的 `kafka` driver，因为 CDC 消费需要更精细的控制（手动提交 offset、控制消费速率、精确重试策略）：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use RdKafka\Conf;
use RdKafka\KafkaConsumer;
use RdKafka\Message;
use App\Services\Cdc\CdcEventHandler;
use App\Services\Cdc\DeadLetterPublisher;

class ConsumeCdcEvents extends Command
{
    protected $signature = 'cdc:consume
                            {--topic=orderdb.public.orders : Kafka topic to consume}
                            {--group=order-cdc-consumer : Consumer group ID}
                            {--max-batch=100 : Max messages per batch before offset commit}
                            {--sleep=1000 : Sleep ms between empty polls}';

    protected $description = 'Consume Debezium CDC events from Kafka and project to read models';

    public function handle(
        CdcEventHandler $handler,
        DeadLetterPublisher $dlq
    ): int {
        $conf = new Conf();
        $conf->set('bootstrap.servers', config('kafka.brokers', ['localhost:9092']));
        $conf->set('group.id', $this->option('group'));
        $conf->set('auto.offset.reset', 'earliest');

        // 手动提交 offset，不依赖 auto.commit
        $conf->set('enable.auto.commit', 'false');
        $conf->set('enable.auto.offset.store', 'false');

        // 会话超时：Consumer 崩溃后多久触发 rebalance
        $conf->set('session.timeout.ms', '30000');
        $conf->set('max.poll.interval.ms', '300000');

        // 心跳间隔
        $conf->set('heartbeat.interval.ms', '10000');

        $consumer = new KafkaConsumer($conf);
        $consumer->subscribe([$this->option('topic')]);

        $this->info("Starting CDC consumer on topic: {$this->option('topic')}");
        $batchCount = 0;
        $maxBatch = (int) $this->option('max-batch');

        while (true) {
            $message = $consumer->consume(1000);

            switch ($message->err) {
                case RD_KAFKA_RESP_ERR_NO_ERROR:
                    try {
                        $handler->handle($message->payload);
                        $consumer->storeMessageOffsets($message);
                        $batchCount++;

                        if ($batchCount >= $maxBatch) {
                            $consumer->commit($message);
                            $batchCount = 0;
                            $this->line("Committed offset at: " . $message->offset);
                        }
                    } catch (\Throwable $e) {
                        $this->error("Failed to process message: {$e->getMessage()}");

                        // 校验失败或格式错误 -> Dead Letter
                        $dlq->publish($message->payload, $e);
                        $consumer->commit($message);

                        // 连续失败计数，超过阈值暂停
                        $handler->incrementFailureCount();
                        if ($handler->getFailureCount() >= 10) {
                            $this->error("Too many consecutive failures, pausing for 60s...");
                            sleep(60);
                            $handler->resetFailureCount();
                        }
                    }
                    break;

                case RD_KAFKA_RESP_ERR__PARTITION_EOF:
                    // 分区末尾，没有新消息
                    if ($batchCount > 0) {
                        $consumer->commit($message);
                        $batchCount = 0;
                    }
                    break;

                case RD_KAFKA_RESP_ERR__TIMED_OUT:
                    // 正常超时，继续轮询
                    break;

                default:
                    $this->error("Kafka error: " . $message->errstr());
                    return static::FAILURE;
            }
        }
    }
}
```

### Dead Letter Queue 发布器

当消息无法处理时（字段校验失败、schema 不兼容等），旁路到 Dead Letter Topic，不允许静默丢消息：

```php
<?php

namespace App\Services\Cdc;

use RdKafka\Producer;
use RdKafka\ProducerTopic;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class DeadLetterPublisher
{
    private Producer $producer;
    private ProducerTopic $topic;

    public function __construct()
    {
        $conf = new \RdKafka\Conf();
        $conf->set('bootstrap.servers', config('kafka.brokers', ['localhost:9092']));

        $this->producer = new Producer($conf);
        $this->topic = $this->producer->newTopic(
            config('kafka.topics.dead_letter', 'orderdb.cdc.dead-letter')
        );
    }

    public function publish(string $payload, \Throwable $error): void
    {
        $deadLetter = json_encode([
            'original_payload' => json_decode($payload, true),
            'error_message' => $error->getMessage(),
            'error_class' => get_class($error),
            'failed_at' => now()->toIso8601String(),
            'retry_count' => 0,
        ], JSON_UNESCAPED_UNICODE);

        $this->topic->produce(
            RD_KAFKA_PARTITION_UA,
            0,
            $deadLetter
        );
        $this->producer->flush(5000);

        // 同时写入 Redis 队列供人工检查
        Redis::rpush('cdc:dead-letter:queue', $deadLetter);

        Log::warning('CDC message sent to dead letter', [
            'error' => $error->getMessage(),
            'payload_preview' => substr($payload, 0, 200),
        ]);
    }
}
```

### 乱序处理的完整实现

CDC 消息乱序是生产中最常见的问题。除了前面提到的版本闸门，还需要处理以下场景：

**场景一：Kafka Partition 内乱序**

Debezium 保证同一 primary key 的消息在同一 partition 内有序。但当 Kafka rebalance 或 Connector 重启时，可能出现轻微乱序。版本闸门可以完美处理这种情况。

**场景二：跨 Partition 乱序**

如果 `orders` 和 `order_items` 共用一个 topic（通过 `table.include.list`），不同表的变更可能在不同 partition。消费端需要按业务维度（order_id）做排序：

```php
<?php

namespace App\Services\Cdc;

use Illuminate\Support\Facades\Cache;

class OutOfOrderHandler
{
    /**
     * 检查消息是否可以安全处理
     * 如果当前有同一 order_id 的消息正在处理中，先排队等待
     */
    public function canProcess(int $orderId, int $version): bool
    {
        $lockKey = "cdc:lock:order:{$orderId}";
        $currentVersion = Cache::get($lockKey, 0);

        // 当前版本号小于等于已处理的版本号，说明是旧消息
        if ($version <= $currentVersion) {
            return false;
        }

        // 尝试获取分布式锁，如果已经被占用说明同一订单有消息正在处理
        if (!Cache::lock($lockKey . ':processing', 30)->get()) {
            // 排队等待
            $this->waitForLock($lockKey . ':processing', 10);
        }

        return true;
    }

    /**
     * 标记消息已处理，更新版本号
     */
    public function markProcessed(int $orderId, int $version): void
    {
        $lockKey = "cdc:lock:order:{$orderId}";
        Cache::put($lockKey, $version, 3600);
        Cache::lock($lockKey . ':processing')->forceRelease();
    }

    private function waitForLock(string $lockKey, int $maxWait): void
    {
        $start = time();
        while (time() - $start < $maxWait) {
            if (Cache::lock($lockKey, 10)->get()) {
                return;
            }
            usleep(100000); // 100ms
        }
        throw new \RuntimeException("Failed to acquire lock within {$maxWait}s");
    }
}
```

**场景三：慢消费导致的消息堆积**

当 Consumer 因为某个大事务导致的批量更新而变慢时，后续消息会堆积。这时候需要：

```php
<?php

// 在 Consumer 的 handle 方法中，检测到大批量消息时自动扩容
public function handleBatch(array $messages): void
{
    if (count($messages) > 500) {
        $this->warn("Large batch detected ({$count} messages), processing with chunked strategy");

        $chunks = array_chunk($messages, 100);
        foreach ($chunks as $chunkIndex => $chunk) {
            DB::transaction(function () use ($chunk) {
                foreach ($chunk as $message) {
                    $this->handleSingle($message);
                }
            });

            // 每个 chunk 之间短暂休息，避免锁表时间过长
            usleep(50000); // 50ms
        }
    } else {
        DB::transaction(function () use ($messages) {
            foreach ($messages as $message) {
                $this->handleSingle($message);
            }
        });
    }
}
```

### 启动脚本与 Supervisor 配置

CDC Consumer 是长驻进程，需要 Supervisor 保活：

```ini
[program:cdc-consumer]
command=php artisan cdc:consume --topic=orderdb.public.orders --group=order-cdc-consumer
process_name=%(program_name)s
autostart=true
autorestart=true
startsecs=5
stopwaitsecs=30
stopasgroup=true
killasgroup=true
numprocs=1
redirect_stderr=true
stdout_logfile=/var/log/cdc-consumer.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stop信号=SIGTERM
stopsignal=SIGKILL
```

生产建议跑 2-3 个 Consumer 实例（同一 group），利用 Kafka 的 partition 分配实现并行消费。但要注意：**同一 order_id 的消息必须被同一个 Consumer 处理**，所以 partition 数量决定了并行度上限。我建议 partition 数量 = Consumer 实例数。


## 五、三次真实踩坑记录

### 1. 初始快照把旧订单当新订单

`snapshot.mode=initial` 首次启动会扫全表。如果消费端把快照当成业务新增事件，报表和通知都会重放一遍。我的处理是：快照只做幂等投影，不触发任何副作用。

### 2. 字段升级后 consumer 不报错，但数据已经脏了

有次 `status` 新增一个更长的枚举值，主库没问题，读侧验证规则还是旧集合，结果 consumer 没崩，只是悄悄跳过更新。后来我加了 dead letter topic，凡是字段校验失败一律旁路，不允许静默丢消息。

### 3. 补数回放不能和实时流共用 group

第一次补数时，我让回放任务直接进线上 consumer group，结果 offset 被推进，实时流瞬间乱掉。正确做法是：**补数单独 group，写入仍然经过版本闸门**，这样即使和实时流交错，也不会把新状态冲掉。

## 踩坑清单速查表

为了方便快速定位问题，我把生产中遇到的所有 CDC 相关坑整理成一张表：

| 问题 | 症状 | 根因 | 解决方案 |
| --- | --- | --- | --- |
| WAL 撑爆磁盘 | 数据库拒绝写入，报 `no space left` | Replication Slot 未消费，WAL 无法清理 | 设置 `retained_wal > 1GB` 告警；Slot 未激活时及时清理 |
| 快照重复通知 | 上线后用户收到 N 次"新订单"通知 | `snapshot.mode=initial` 全表扫描被当新增事件 | Consumer 识别快照消息（检查 `source.snapshot` 字段），跳过副作用 |
| 旧版本覆盖新数据 | 读模型状态回退 | 乱序消息 + 无版本检查 | 读侧必须先比较版本号，`version <= current` 则跳过 |
| 字段校验静默失败 | Consumer 不报错但数据没更新 | 新增字段后 Consumer 旧 schema 校验不通过 | 启用 `errors.tolerance=none`；校验失败进 Dead Letter |
| 补数冲掉实时流 | 补数期间线上读模型状态跳变 | 补数和实时流共用 Consumer Group | 补数用独立 Group；写入仍走版本闸门 |
| Connector 反复重启 | Debezium Connector 状态为 FAILED | Slot 丢失或 `wal_sender_timeout` 超时 | 重建 Slot + 检查 `max_replication_slots` 和 `max_wal_senders` |
| 金额精度丢失 | 订单金额分变成元 | Debezium 默认 `decimal.handling.mode=double` | 设置 `decimal.handling.mode=string` |
| DELETE 消息丢失 | 下游删除了记录但读模型未同步 | `ExtractNewRecordState` 默认丢弃 tombstone | 设置 `drop.tombstones=false` + `delete.handling.mode=rewrite` |
| Kafka Consumer 假死 | Lag 持续增长但 CPU 很低 | `max.poll.interval.ms` 过大导致 rebalance 缩减实例 | 调小 `max.poll.interval.ms`；设置消费超时告警 |
| DDL 变更后 Connector 崩溃 | 表结构变更后 Connector 报 schema error | Debezium 缓存了旧 schema | 重启 Connector 触发 schema 刷新；大改用 `schema_only` 模式 |


## 六、补数能力必须提前准备

CDC 不是"永不丢数据"的魔法，真正可靠的是你能不能把一段历史安全重建。我保留了一个命令，按订单区间直接重放主库数据到读模型。

### Artisan 补数命令

这是一个完整的 Artisan Command，支持按 ID 区间、时间范围、状态筛选进行补数，并自带进度条和速率控制：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\Order;
use App\Models\OrderReadModel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ReplayOrderReadModel extends Command
{
    protected $signature = 'cdc:replay-read-model
                            {--from-id= : Start order ID (inclusive)}
                            {--to-id= : End order ID (inclusive)}
                            {--from-date= : Start date (Y-m-d)}
                            {--to-date= : End date (Y-m-d)}
                            {--status= : Filter by order status}
                            {--chunk-size=500 : Records per chunk}
                            {--dry-run : Preview without writing}
                            {--force : Skip confirmation prompt}';

    protected $description = 'Replay order data from primary DB to read model (backfill)';

    public function handle(): int
    {
        $query = Order::query();

        // 按 ID 区间筛选
        if ($fromId = $this->option('from-id')) {
            $query->where('id', '>=', $fromId);
        }
        if ($toId = $this->option('to-id')) {
            $query->where('id', '<=', $toId);
        }

        // 按时间范围筛选
        if ($fromDate = $this->option('from-date')) {
            $query->where('created_at', '>=', $fromDate);
        }
        if ($toDate = $this->option('to-date')) {
            $query->where('created_at', '<=', $toDate . ' 23:59:59');
        }

        // 按状态筛选
        if ($status = $this->option('status')) {
            $query->where('status', $status);
        }

        $total = $query->count();
        if ($total === 0) {
            $this->warn('No orders found matching the criteria.');
            return static::SUCCESS;
        }

        $this->info("Found {$total} orders to replay.");

        if ($this->option('dry-run')) {
            $this->info('Dry run mode - no data will be written.');
            return static::SUCCESS;
        }

        if (!$this->option('force') && !$this->confirm("Replay {$total} orders? This will update the read model.")) {
            return static::SUCCESS;
        }

        $bar = $this->output->createProgressBar($total);
        $bar->start();
        $processed = 0;
        $failed = 0;

        $query->orderBy('id')
            ->chunkById((int) $this->option('chunk-size'), function ($orders) use (&$processed, &$failed, $bar) {
                foreach ($orders as $order) {
                    try {
                        DB::transaction(function () use ($order) {
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
                        });
                        $processed++;
                    } catch (\Throwable $e) {
                        $failed++;
                        Log::error("Replay failed for order {$order->id}", [
                            'error' => $e->getMessage(),
                        ]);
                    }
                    $bar->advance();
                }
            });

        $bar->finish();
        $this->newLine();
        $this->info("Replay complete: {$processed} processed, {$failed} failed.");

        if ($failed > 0) {
            $this->warn("Check logs for failed records. Use --dry-run to preview first.");
        }

        return $failed > 0 ? static::FAILURE : static::SUCCESS;
    }
}
```

### 补数使用示例

```bash
# 预览：查看某个 ID 区间有多少订单
php artisan cdc:replay-read-model --from-id=10000 --to-id=20000 --dry-run

# 补数：重放指定日期范围的订单
php artisan cdc:replay-read-model --from-date=2026-04-01 --to-date=2026-04-07 --force

# 精准补数：只补特定状态的订单
php artisan cdc:replay-read-model --status=cancelled --from-id=50000 --to-id=60000

# 交互式补数（推荐生产使用）
php artisan cdc:replay-read-model --from-id=30000 --to-id=40000
# 会提示：Replay 1234 orders? This will update the read model. (yes/no)
```

### 补数时的速率控制

补数写入不能太快，否则会拖垮读模型数据库。我在命令中加了速率限制：

```php
// 在 chunk 循环中添加
$startChunk = microtime(true);

// ... 处理逻辑 ...

$elapsed = microtime(true) - $startChunk;
$sleepTime = max(0, (50 - $elapsed) * 1000000); // 控制每 chunk 至少 50ms
if ($sleepTime > 0) {
    usleep((int) $sleepTime);
}
```

对于大批量补数（>10万条），建议拆分成多个小区间执行，每次执行后检查读模型数据库的连接数和慢查询：

```sql
-- 补数期间监控
SELECT count(*) AS active_connections,
       state,
       wait_event_type
FROM pg_stat_activity
WHERE datname = 'app_read'
GROUP BY state, wait_event_type;
```

### 补数幂等性保证

补数命令的幂等性由 `updateOrCreate` + 版本闸门双重保证：

1. **`updateOrCreate`**：同一个 order_id 多次执行不会产生重复记录
2. **版本闸门**：如果读模型已有更高版本，补数不会覆盖

但有一个边界情况需要注意：**补数期间如果有实时 CDC 消息到达**，可能会出现"补数写的版本 5 和实时消息的版本 6 交错"的情况。由于版本闸门的存在，这不会导致数据错误，但可能导致一次额外的 DB 查询。这是可接受的。


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

这套方案上线后，我把订单写接口从"事务里做三件事"收敛成"只写主库一件事"，事务时长明显下降，最重要的是补数终于有了标准动作。对交易系统来说，**可重放、可观测、可兜底**，比"同步时看起来更快"重要得多。

## 相关阅读

- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/架构/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
- [Outbox Pattern 实战：保证数据库与消息队列的最终一致性——Laravel + Debezium 的可靠事件发布](/Laravel/Outbox-Pattern-实战-保证数据库与消息队列的最终一致性-Laravel-Debezium/)
- [PostgreSQL Logical Replication 实战：零停机数据迁移与实时数据同步](/MySQL/PostgreSQL-Logical-Replication-实战-零停机数据迁移与实时数据同步/)
- [Laravel + PostgreSQL LISTEN/NOTIFY 实战：事务提交后事件广播、连接池与负载均衡踩坑记录](/PHP/Laravel/laravel-postgresql-listen-notify-guide-transaction-load-balancing/)
- [Laravel-Kafka 消息队列异步解耦实战：KKday B2C API 订单处理与库存扣减真实踩坑记录](/MQ/Kafka/laravel-kafka-guide/)
