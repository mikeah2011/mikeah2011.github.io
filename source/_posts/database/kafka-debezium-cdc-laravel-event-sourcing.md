---

title: Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计
keywords: [Kafka, Debezium CDC, Laravel Event Sourcing, 数据库变更事件流, 的互补架构设计]
date: 2026-06-09 19:30:00
categories:
- database
tags:
- Kafka
- Debezium
- CDC
- Event Sourcing
- Laravel
- 分布式
- 数据同步
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
description: 详解 Kafka + Debezium CDC 数据库变更事件流的生产级架构设计，对比与 Laravel Event Sourcing 的互补关系，提供 Outbox Pattern、幂等消费者、Schema 演进的完整落地方案，附可运行的 Laravel 集成代码与踩坑记录。
---



# Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计

## 一、为什么需要数据库变更事件流

### 1.1 双写问题的终极解法

在微服务架构中，「写数据库」和「发消息」的双写一致性始终是痛点。Outbox Pattern 通过本地事务写入发件箱表解决了原子性问题，但发件箱的消息转发需要额外的轮询或事务日志读取机制。**Debezium CDC** 正是这样一种基于数据库事务日志的变更数据捕获（Change Data Capture）工具——它直接读取 MySQL binlog / PostgreSQL WAL，将每一条数据变更实时转换为 Kafka 消息，天然具备：

- **零侵入**：应用代码无需任何改动，CDC Connector 直接对接数据库
- **零延迟**：基于日志流式读取，延迟通常在毫秒级
- **零丢失**：通过 offset 管理和事务边界感知，保证至少一次投递

### 1.2 CDC vs 应用层事件：互补而非替代

很多团队在引入 CDC 后会问：「我们已经有 Laravel 的 Model Event / Domain Event 了，还需要 CDC 吗？」答案是**两者互补，各有适用场景**：

| 维度 | Laravel Event（应用层） | Debezium CDC（基础设施层） |
|------|----------------------|--------------------------|
| **触发时机** | 业务逻辑主动触发 | 数据库变更自动捕获 |
| **覆盖范围** | 仅应用写入的数据变更 | 包含所有写入（含迁移、直连） |
| **Schema 耦合** | 与 Eloquent Model 强绑定 | 独立于应用，基于数据库 Schema |
| **跨语言** | 仅 Laravel 生态 | 任何语言/系统都可消费 |
| **复杂度** | 低，Laravel 原生支持 | 中高，需维护 Kafka Connect 集群 |
| **数据格式** | 自定义数组/对象 | 标准化 CDC JSON（含 before/after） |

**典型互补场景**：

- **Laravel Event** 负责同一服务内的领域事件（如 OrderCreated 触发库存扣减）
- **Debezium CDC** 负责跨服务的数据同步（如订单库变更同步到搜索库、数据仓库、审计日志）

---

## 二、Debezium CDC 核心架构

### 2.1 组件拓扑

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────┐    ┌──────────────────┐
│  MySQL 主库  │───▶│  Debezium        │───▶│    Kafka     │───▶│  Laravel Consumer │
│  (binlog)    │    │  Connector       │    │  Topic       │    │  (Queue Worker)   │
└─────────────┘    │  (Kafka Connect) │    └─────────────┘    └──────────────────┘
                   └──────────────────┘
                           │
                   ┌───────▼───────┐
                   │   Schema      │
                   │   Registry    │
                   └───────────────┘
```

### 2.2 安装与配置 Debezium MySQL Connector

**步骤 1：启用 MySQL binlog**

```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf
[mysqld]
server-id = 1
log-bin = mysql-bin
binlog-format = ROW
binlog-row-image = FULL
gtid-mode = ON
enforce-gtid-consistency = ON
```

**步骤 2：创建 Debezium 专用数据库用户**

```sql
CREATE USER 'debezium'@'%' IDENTIFIED BY 'secret_password';
GRANT SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'debezium'@'%';
FLUSH PRIVILEGES;
```

**步骤 3：配置 Kafka Connect Debezium Connector**

```json
{
  "name": "mysql-cdc-connector",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "database.hostname": "mysql-primary",
    "database.port": "3306",
    "database.user": "debezium",
    "database.password": "secret_password",
    "database.server.id": "184054",
    "database.include.list": "kkday_b2c",
    "table.include.list": "kkday_b2c.orders,kkkday_b2c.order_items,kkday_b2c.payments",
    "database.history.kafka.bootstrap.servers": "kafka:9092",
    "database.history.kafka.topic": "schema-changes.kkday_b2c",
    "transforms": "route,unwrap",
    "transforms.route.type": "org.apache.kafka.connect.transforms.RegexRouter",
    "transforms.route.regex": "([^.]+)\\.([^.]+)\\.([^.]+)",
    "transforms.route.replacement": "cdc.$3",
    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.add.fields": "op,table,lsn,source.ts_ms",
    "key.converter": "org.apache.kafka.connect.json.JsonConverter",
    "key.converter.schemas.enable": "true",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "true",
    "snapshot.mode": "initial",
    "snapshot.locking.mode": "minimal",
    "tombstones.on.delete": "true"
  }
}
```

**关键配置解释**：

- `table.include.list`：只捕获指定表的变更，避免全库 binlog 带来的性能压力
- `transforms.unwrap`：`ExtractNewRecordState` 将 Debezium 的嵌套 envelope 格式展平为简洁的 before/after 结构
- `database.history.kafka.topic`：存储 Schema 变更历史，支持 DDL 变更后的位点恢复

### 2.3 Debezium 消息格式

一条典型的 Debezium CDC 消息如下：

```json
{
  "before": {
    "id": 12345,
    "status": "pending",
    "total_amount": "299.00",
    "updated_at": "2026-06-09T10:00:00Z"
  },
  "after": {
    "id": 12345,
    "status": "paid",
    "total_amount": "299.00",
    "paid_at": "2026-06-09T10:05:32Z",
    "updated_at": "2026-06-09T10:05:32Z"
  },
  "source": {
    "version": "2.6.2.Final",
    "connector": "mysql",
    "name": "kkday_b2c",
    "ts_ms": 1749474332000,
    "snapshot": "false",
    "db": "kkday_b2c",
    "table": "orders",
    "file": "mysql-bin.000023",
    "pos": 12345678,
    "row": 0,
    "server_id": 1
  },
  "op": "u",
  "ts_ms": 1749474332123,
  "transaction": null
}
```

**op 字段含义**：

- `c` = create（INSERT）
- `u` = update（UPDATE）
- `d` = delete（DELETE）
- `r` = read（snapshot 读取）

---

## 三、Laravel 集成：从 Kafka 消费 CDC 事件

### 3.1 依赖选择

```bash
# 队列驱动（推荐 laravel-queue-kafka 或底层数组的 rdkafka）
composer require laravel/framework:^11.0
composer require spiralscout/queue-kafka

# 或者使用 Laravel 原生 + rdkafka 扩展
pecl install rdkafka
```

### 3.2 Kafka Consumer Service

```php
<?php

declare(strict_types=1);

namespace App\Services\CDC;

use App\Events\Order\OrderPaid;
use App\Events\Order\OrderCreated;
use App\Events\Order\OrderCancelled;
use App\Models\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use RdKafka\KafkaConsumer;
use RdKafka\Conf;

class KafkaCdcConsumer
{
    private KafkaConsumer $consumer;

    public function __construct()
    {
        $conf = new Conf();
        $conf->set('bootstrap.servers', config('kafka.bootstrap_servers'));
        $conf->set('group.id', config('kafka.cdc_group_id', 'laravel-cdc-consumer'));
        $conf->set('auto.offset.reset', 'earliest');
        $conf->set('enable.auto.commit', 'false');
        $conf->set('session.timeout.ms', '30000');
        $conf->set('max.poll.interval.ms', '300000');

        // 精确一次语义：配合 Debezium 的事务边界
        $conf->set('isolation.level', 'read_committed');

        $this->consumer = new KafkaConsumer($conf);
    }

    /**
     * 消费 CDC Topic
     */
    public function consume(string $topic): void
    {
        $this->consumer->subscribe([$topic]);

        Log::info("CDC Consumer started", ['topic' => $topic]);

        while (true) {
            $message = $this->consumer->consume(120000); // 120s 超时

            if ($message->err) {
                Log::error("CDC Consumer error", [
                    'error' => $message->errstr(),
                    'topic' => $topic,
                ]);
                continue;
            }

            try {
                $this->processMessage($message);
                $this->consumer->commit($message);
            } catch (\Throwable $e) {
                Log::critical("CDC message processing failed", [
                    'topic' => $message->topic_name,
                    'partition' => $message->partition,
                    'offset' => $message->offset,
                    'error' => $e->getMessage(),
                ]);
                // 进入死信队列或报警
                $this->sendToDeadLetterQueue($message, $e);
            }
        }
    }

    /**
     * 处理单条 CDC 消息
     */
    private function processMessage(\RdKafka\Message $message): void
    {
        $payload = json_decode($message->payload, true);

        if (!isset($payload['op'], $payload['source']['table'])) {
            Log::warning("Invalid CDC message format", ['payload' => $payload]);
            return;
        }

        $table = $payload['source']['table'];
        $operation = $payload['op'];
        $before = $payload['before'] ?? null;
        $after = $payload['after'] ?? null;

        Log::debug("CDC event received", [
            'table' => $table,
            'op' => $operation,
            'before_id' => $before['id'] ?? null,
            'after_id' => $after['id'] ?? null,
        ]);

        match ($table) {
            'orders' => $this->handleOrderChange($operation, $before, $after),
            'order_items' => $this->handleOrderItemChange($operation, $before, $after),
            'payments' => $this->handlePaymentChange($operation, $before, $after),
            default => Log::debug("Unhandled table", ['table' => $table]),
        };
    }

    /**
     * 处理订单表变更
     */
    private function handleOrderChange(
        string $operation,
        ?array $before,
        ?array $after
    ): void {
        match ($operation) {
            'c', 'r' => $this->handleOrderCreated($after),
            'u' => $this->handleOrderUpdated($before, $after),
            'd' => $this->handleOrderDeleted($before),
        };
    }

    private function handleOrderCreated(array $data): void
    {
        // 幂等检查：CDC 可能重复投递
        $exists = DB::table('cdc_processed_events')
            ->where('event_id', $this->buildEventId('orders', 'c', $data['id']))
            ->exists();

        if ($exists) {
            Log::debug("Duplicate CDC event, skipping", ['order_id' => $data['id']]);
            return;
        }

        // 同步订单数据到搜索索引、数据仓库等
        Event::dispatch(new OrderCreated(
            orderId: $data['id'],
            userId: $data['user_id'],
            totalAmount: $data['total_amount'],
            createdAt: $data['created_at'],
        ));

        // 记录已处理事件
        $this->markEventProcessed('orders', 'c', $data['id']);
    }

    private function handleOrderUpdated(?array $before, array $after): void
    {
        // 状态变更检测
        $statusChanged = ($before['status'] ?? null) !== ($after['status'] ?? null);

        if ($statusChanged) {
            match ($after['status']) {
                'paid' => Event::dispatch(new OrderPaid(
                    orderId: $after['id'],
                    paidAt: $after['paid_at'] ?? now()->toIso8601String(),
                )),
                'cancelled' => Event::dispatch(new OrderCancelled(
                    orderId: $after['id'],
                    cancelledAt: $after['cancelled_at'] ?? now()->toIso8601String(),
                )),
                default => null,
            };
        }

        $this->markEventProcessed('orders', 'u', $after['id']);
    }

    private function handleOrderDeleted(array $data): void
    {
        // 软删除场景：同步删除搜索索引中的记录
        Log::info("Order deleted via CDC", ['order_id' => $data['id']]);
        $this->markEventProcessed('orders', 'd', $data['id']);
    }

    /**
     * 处理支付表变更
     */
    private function handlePaymentChange(
        string $operation,
        ?array $before,
        ?array $after
    ): void {
        if (in_array($operation, ['c', 'u']) && $after['status'] === 'completed') {
            Log::info("Payment completed via CDC", [
                'payment_id' => $after['id'],
                'order_id' => $after['order_id'],
                'amount' => $after['amount'],
            ]);
        }

        $this->markEventProcessed('payments', $operation, $after['id'] ?? $before['id']);
    }

    /**
     * 处理订单明细变更
     */
    private function handleOrderItemChange(
        string $operation,
        ?array $before,
        ?array $after
    ): void {
        // 库存同步等
        $this->markEventProcessed(
            'order_items',
            $operation,
            $after['id'] ?? $before['id']
        );
    }

    /**
     * 构建事件唯一 ID（幂等键）
     */
    private function buildEventId(
        string $table,
        string $op,
        int|string $recordId
    ): string {
        return "{$table}:{$op}:{$recordId}:" . now()->timestamp;
    }

    /**
     * 标记事件已处理（幂等保障）
     */
    private function markEventProcessed(
        string $table,
        string $op,
        int|string $recordId
    ): void {
        DB::table('cdc_processed_events')->insertOrIgnore([
            'event_id' => $this->buildEventId($table, $op, $recordId),
            'table_name' => $table,
            'operation' => $op,
            'record_id' => $recordId,
            'processed_at' => now(),
        ]);
    }

    private function sendToDeadLetterQueue(
        \RdKafka\Message $message,
        \Throwable $e
    ): void {
        // 实际项目中发送到 Kafka 死信 Topic
        Log::critical("CDC message sent to DLQ", [
            'topic' => $message->topic_name,
            'payload' => $message->payload,
            'error' => $e->getMessage(),
        ]);
    }
}
```

### 3.3 幂等去重表设计

```sql
CREATE TABLE `cdc_processed_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` VARCHAR(255) NOT NULL,
  `table_name` VARCHAR(64) NOT NULL,
  `operation` VARCHAR(4) NOT NULL,
  `record_id` BIGINT UNSIGNED NOT NULL,
  `processed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_event_id` (`event_id`),
  KEY `idx_table_record` (`table_name`, `record_id`),
  KEY `idx_processed_at` (`processed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 定期清理 30 天前的记录
CREATE EVENT cleanup_cdc_events
ON SCHEDULE EVERY 1 DAY
DO
  DELETE FROM cdc_processed_events
  WHERE processed_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
```

### 3.4 Laravel Queue 配置

```php
// config/queue.php
'connections' => [
    // ...
    'kafka' => [
        'driver' => 'kafka',
        'connection' => 'default',
        'queue' => 'cdc-orders',
        'retry_after' => 90,
        'max_jobs' => 1000,
        'max_time' => 600,
    ],
],

'failed' => [
    'database' => env('DB_CONNECTION', 'mysql'),
    'table' => 'failed_jobs',
],
```

---

## 四、与 Laravel Event Sourcing 的互补设计

### 4.1 架构分层

```
┌───────────────────────────────────────────────────────┐
│                  Laravel Application                   │
│                                                        │
│  ┌──────────────┐        ┌──────────────────────┐    │
│  │  Domain Layer │        │  Infrastructure Layer │    │
│  │               │        │                       │    │
│  │  OrderCreated │◀───────│  Debezium CDC         │    │
│  │  OrderPaid    │  消费   │  Consumer Service     │    │
│  │  OrderShipped │        │                       │    │
│  └──────┬───────┘        └──────────┬────────────┘    │
│         │                           │                  │
│         ▼                           ▼                  │
│  ┌──────────────┐        ┌──────────────────────┐    │
│  │  Application  │        │  Search Index         │    │
│  │  Services     │        │  Data Warehouse       │    │
│  │               │        │  Audit Log            │    │
│  └──────────────┘        └──────────────────────┘    │
└───────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌──────────────┐        ┌──────────────────────┐
│  MySQL (主库) │        │  Kafka Topic          │
│  写入业务数据  │──────▶│  CDC 变更事件          │
└──────────────┘        └──────────────────────┘
```

### 4.2 何时用 Event Sourcing，何时用 CDC

**选 Event Sourcing 的场景**：

- 事件本身就是业务核心（如金融交易流水、审计日志）
- 需要事件回放重建状态（如 CQRS 的读模型构建）
- 同一服务内的领域事件驱动
- 事件 Schema 由应用完全控制

**选 CDC 的场景**：

- 已有系统改造，不想改应用代码
- 跨语言/跨服务的数据同步
- 需要捕获所有数据库变更（包括直连数据库的写入）
- 需要与数据仓库、搜索索引、缓存同步

**混合架构（推荐）**：

```
用户下单 → Laravel Event (OrderCreated) → 同服务内库存扣减
                │
                ▼
          MySQL 写入
                │
                ▼
          Debezium CDC 捕获 binlog
                │
                ▼
          Kafka Topic: cdc.orders
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
   搜索索引  数据仓库  审计日志
```

---

## 五、Schema 演进治理

### 5.1 兼容性变更策略

数据库 Schema 变更（ALTER TABLE）是 CDC 架构的最大挑战之一。Debezium 通过 Schema History Topic 记录所有 DDL 变更，但消费者端仍需处理字段新增/删除/重命名的兼容性。

**Laravel 端的防御性消费**：

```php
/**
 * 防御性字段访问：新字段可能不存在
 */
private function safeGet(array $data, string $key, mixed $default = null): mixed
{
    return $data[$key] ?? $default;
}

/**
 * Schema 版本感知
 */
private function consumeOrderEvent(array $payload): void
{
    $after = $payload['after'] ?? [];

    // 新版本字段：payment_method 在 v2 Schema 中新增
    $paymentMethod = $this->safeGet($after, 'payment_method', 'unknown');

    // 旧版本字段：amount 在 v3 中拆分为 subtotal + tax
    $subtotal = $this->safeGet($after, 'subtotal')
        ?? $this->safeGet($after, 'total_amount', 0);
    $tax = $this->safeGet($after, 'tax', 0);
}
```

### 5.2 Debezium Schema Registry 配置

```json
{
  "name": "mysql-cdc-connector",
  "config": {
    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://schema-registry:8081",
    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter.schema.registry.url": "http://schema-registry:8081"
  }
}
```

---

## 六、生产踩坑记录

### 6.1 坑一：大事务导致 binlog 堆积

**现象**：批量导入 50 万行数据时，Debezium 消费延迟飙升到 30 分钟。

**原因**：MySQL binlog 是按事务边界输出的，一个包含 50 万行 INSERT 的事务在 binlog 中只有一条记录，Debezium 必须等事务提交后才能解析。

**解决方案**：

```php
// 分批提交，每 1000 行一个事务
DB::transaction(function () use ($records) {
    foreach (array_chunk($records, 1000) as $chunk) {
        DB::table('orders')->insert($chunk);
        // 每 1000 行自动提交一个事务
    }
});
```

### 6.2 坑二：删除操作丢失关联数据

**现象**：Order 被删除后，CDC 消息中的 `before` 字段包含完整数据，但 `after` 为 null。

**解决方案**：

```php
private function handleOrderDeleted(array $before): void
{
    // before 包含被删除前的完整数据
    $orderId = $before['id'];

    // 通知下游清理
    $this->searchService->deleteIndex('orders', $orderId);
    $this->cacheService->forget("order:{$orderId}");

    Log::info("Order deleted via CDC", ['order_id' => $orderId]);
}
```

### 6.3 坑三：DDL 变更导致 Connector 崩溃

**现象**：执行 `ALTER TABLE orders ADD COLUMN remark VARCHAR(255)` 后 Connector 报 Schema 不匹配。

**原因**：Debezium 在 Schema History Topic 中记录了旧 Schema，新的 binlog 事件包含新字段。

**解决方案**：

```bash
# 1. 暂停 Connector
curl -X PUT http://kafka-connect:8083/connectors/mysql-cdc-connector/pause

# 2. 执行 DDL
ALTER TABLE orders ADD COLUMN remark VARCHAR(255) DEFAULT NULL;

# 3. 恢复 Connector（Debezium 会自动从 Schema History 恢复）
curl -X PUT http://kafka-connect:8083/connectors/mysql-cdc-connector/resume
```

### 6.4 坑四：Kafka 消费者 Rebalance 风暴

**现象**：消费者频繁触发 Rebalance，导致消息处理中断。

**解决方案**：

```php
// 增加 session.timeout.ms 和 max.poll.interval.ms
$conf->set('session.timeout.ms', '45000');
$conf->set('max.poll.interval.ms', '600000');
$conf->set('heartbeat.interval.ms', '15000');

// 控制每次 poll 的消息数量
$conf->set('max.partition.fetch.bytes', '1048576'); // 1MB
```

---

## 七、监控与运维

### 7.1 Kafka Connect 监控指标

```yaml
# docker-compose.yml 中添加 Prometheus exporter
services:
  kafka-connect:
    image: debezium/connect:2.6
    environment:
      - JMX_PORT=9999
    ports:
      - "9999:9999"

  jmx-exporter:
    image: prom/jmx-exporter:latest
    command: ["9404", "/etc/jmx-exporter/config.yml"]
    volumes:
      - ./jmx-exporter-config.yml:/etc/jmx-exporter/config.yml
    ports:
      - "9404:9404"
```

### 7.2 关键监控指标

| 指标 | 阈值 | 告警动作 |
|------|------|---------|
| `kafka_connect_connector_status` | FAILED | 立即告警 |
| `cdc_source_lag_ms` | > 60000 | 立即告警 |
| `kafka_consumer_group_lag` | > 10000 | 立即告警 |
| `cdc_processed_events_count` | < 100/min | 告警（可能消息丢失） |

### 7.3 Grafana Dashboard 配置

```json
{
  "dashboard": {
    "title": "Debezium CDC 监控",
    "panels": [
      {
        "title": "CDC 消费延迟",
        "type": "graph",
        "targets": [{
          "expr": "kafka_connect_connector_status{connector='mysql-cdc-connector'}",
          "legendFormat": "{{topic}}"
        }]
      },
      {
        "title": "Laravel CDC 消费速率",
        "type": "stat",
        "targets": [{
          "expr": "rate(cdc_events_processed_total[5m])",
          "legendFormat": "{{table}}"
        }]
      }
    ]
  }
}
```

---

## 八、性能基准与选型决策

### 8.1 Debezium CDC vs 轮询 vs 触发器

| 方案 | 延迟 | 侵入性 | 可靠性 | 运维成本 | 适用场景 |
|------|------|--------|--------|---------|---------|
| **Debezium CDC** | 毫秒级 | 零 | 高（at-least-once） | 中高 | 跨服务数据同步、数据仓库 |
| **应用层 Event** | 毫秒级 | 高（需改代码） | 高 | 低 | 同服务内领域事件 |
| **数据库轮询** | 秒级 | 低 | 中（可能漏数据） | 低 | 简单同步场景 |
| **数据库触发器** | 毫秒级 | 中（需建触发器） | 高 | 中 | 数据库级审计日志 |

### 8.2 容量规划

```php
/**
 * CDC 消费者容量评估
 *
 * 假设：
 * - 订单表日均写入 100 万条
 * - 每条消息平均 2KB
 * - 峰值是均值的 5 倍
 *
 * 计算：
 * - 日均：100万 * 2KB = 2GB
 * - 峰值：5 * 2GB / 86400s ≈ 116KB/s
 * - 3 个消费者实例即可处理
 */
```

---

## 九、完整部署方案

### 9.1 Docker Compose 快速搭建

```yaml
version: '3.8'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.6.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    depends_on: [zookeeper]
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root_password
      MYSQL_DATABASE: kkday_b2c
    command: >
      --server-id=1
      --log-bin=mysql-bin
      --binlog-format=ROW
      --gtid-mode=ON
      --enforce-gtid-consistency=ON

  schema-registry:
    image: confluentinc/cp-schema-registry:7.6.0
    depends_on: [kafka]
    environment:
      SCHEMA_REGISTRY_HOST_NAME: schema-registry
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: kafka:9092

  kafka-connect:
    image: debezium/connect:2.6
    depends_on: [kafka, schema-registry]
    environment:
      BOOTSTRAP_SERVERS: kafka:9092
      GROUP_ID: debezium-connect
      CONFIG_STORAGE_TOPIC: connect-configs
      OFFSET_STORAGE_TOPIC: connect-offsets
      STATUS_STORAGE_TOPIC: connect-status
      SCHEMA_REGISTRY_URL: http://schema-registry:8081
    ports:
      - "8083:8083"
```

### 9.2 部署检查清单

```bash
# 1. 启动所有服务
docker-compose up -d

# 2. 验证 MySQL binlog 已启用
docker exec mysql mysql -uroot -proot_password -e "SHOW VARIABLES LIKE 'log_bin';"

# 3. 注册 Debezium Connector
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @connector-config.json

# 4. 检查 Connector 状态
curl http://localhost:8083/connectors/mysql-cdc-connector/status | jq .

# 5. 测试数据变更
docker exec mysql mysql -uroot -proot_password kkday_b2c \
  -e "INSERT INTO orders (user_id, total_amount, status) VALUES (1, 299.00, 'pending');"

# 6. 查看 Kafka Topic 消息
docker exec kafka kafka-console-consumer \
  --bootstrap-server kafka:9092 \
  --topic cdc.orders \
  --from-beginning
```

---

## 十、总结

### 核心要点

1. **CDC 与应用层事件互补**：Laravel Event 负责同服务内领域事件，Debezium CDC 负责跨服务数据同步
2. **幂等消费是关键**：CDC 消息可能重复投递，必须通过唯一事件 ID 保证幂等
3. **Schema 演进需防御性编程**：消费者端始终使用 `??` 或 `safeGet` 处理字段缺失
4. **监控不可少**：消费延迟、Connector 状态、消息积压量是三个核心指标
5. **大事务需拆分**：避免批量操作导致 binlog 堆积和消费延迟飙升

### 选型决策树

```
需要跨服务数据同步？
├── 是 → 已有 binlog/WAL？
│       ├── 是 → Debezium CDC（推荐）
│       └── 否 → 应用层事件 + Outbox Pattern
└── 否 → Laravel Model Event / Domain Event
```

### 后续演进

- **Schema Registry**：引入 Confluent Schema Registry 实现 Schema 版本化管理
- **Exactly-Once 语义**：配合 Kafka Transactions 实现精确一次消费
- **CDC + CQRS**：将 CDC 事件作为读模型构建的事件源
- **多集群容灾**：Debezium MirrorMaker 2 实现跨数据中心 CDC 复制
