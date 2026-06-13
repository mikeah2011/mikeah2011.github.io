---

title: Outbox Pattern 实战：保证数据库与消息队列的最终一致性——Laravel + Debezium 的可靠事件发布
keywords: [Outbox Pattern, Laravel, Debezium, 保证数据库与消息队列的最终一致性, 的可靠事件发布]
date: 2026-06-02 00:00:00
tags:
- Outbox Pattern
- Debezium
- 消息队列
- 一致性
- Laravel
categories:
- php
description: Outbox Pattern 实战指南，解决微服务架构中数据库与消息队列的双写问题。详解 Outbox 表设计（JSON payload + 分区表）、Laravel OutboxWriter 事务内原子写入、HasOutboxEvents Trait 自动化事件记录、Debezium CDC Connector 注册与 EventRouter 配置、Kafka 消费者幂等性保证（processed_events 唯一键）、消费者组管理与死信队列。对比 Polling Publisher 与 CDC 两种实现方式的实时性/数据库负担/运维复杂度差异，附 Outbox 表膨胀、消息乱序、Debezium 断连、Schema 变更四大踩坑解决方案与 Prometheus 告警规则，适合需要保证事件驱动架构数据一致性的 Laravel 微服务团队参考。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---





# Outbox Pattern 实战：保证数据库与消息队列的最终一致性——Laravel + Debezium 的可靠事件发布

## 前言

在微服务架构中，服务间通信经常需要同时完成两个操作：更新数据库 + 发送消息到消息队列。看似简单的"先写数据库，再发消息"，实际上隐藏着一个经典难题——**双写问题（Dual Write Problem）**。

考虑以下场景：用户下单成功，订单写入数据库后，需要发送一条消息到 Kafka 通知库存服务扣减库存。如果数据库写入成功但消息发送失败（网络抖动、MQ 宕机），就会导致订单已创建但库存未扣减的数据不一致。

Outbox Pattern（发件箱模式）通过将消息写入数据库的 outbox 表（与业务数据在同一个事务中），然后通过 CDC（Change Data Capture）工具将 outbox 表的变更实时同步到消息队列，从而保证数据库与消息队列的最终一致性。

## 一、双写问题详解

### 1.1 为什么双写会失败

```php
<?php

// ❌ 错误的双写方式
class OrderService
{
    public function createOrder(array $data): Order
    {
        DB::beginTransaction();
        
        try {
            // 步骤 1：写入订单
            $order = Order::create($data);
            
            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
        
        // 步骤 2：发送消息（在事务外）
        // 如果这里失败了怎么办？
        // 数据库已经提交，但消息没发出去
        Kafka::publish('order-events', [
            'event' => 'order_created',
            'order_id' => $order->id,
        ]);
        
        return $order;
    }
}
```

这段代码有以下问题：

1. **步骤 1 成功，步骤 2 失败**：订单已创建，但库存服务不知道
2. **步骤 2 成功，但 MQ 处理失败**：消息已发送，但消费者处理失败
3. **网络分区**：MQ 暂时不可用，消息丢失

### 1.2 为什么不能在事务内发消息

```php
<?php

// ❌ 更糟糕的方案
DB::beginTransaction();

$order = Order::create($data);

// 在事务内发消息
Kafka::publish('order-events', [...]);

DB::commit();
```

这样做会导致：
- 事务持有时间变长（等待 MQ 确认），影响数据库性能
- 如果 MQ 响应慢，数据库连接被长时间占用
- 如果事务回滚，但消息已经发出去了（消息无法撤回）

## 二、Outbox Pattern 原理

### 2.1 核心思想

Outbox Pattern 的核心思想是：

1. **在同一个数据库事务中**，同时写入业务数据和 outbox 表
2. **异步读取 outbox 表**的变更，发送到消息队列
3. **标记已发送**的消息，避免重复发送

```
┌─────────────────────────────────────────────────────────────────┐
│                        Outbox Pattern                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────────────────────┐          │
│  │  Application  │    │      Database (MySQL)         │          │
│  │              │    │                              │          │
│  │  Create Order│───▶│  BEGIN;                      │          │
│  │              │    │    INSERT INTO orders ...     │          │
│  │              │    │    INSERT INTO outbox ...     │          │
│  │              │    │  COMMIT;                     │          │
│  └──────────────┘    └──────────────┬───────────────┘          │
│                                      │                          │
│                                      │ Binlog                   │
│                                      ▼                          │
│                         ┌────────────────────────┐              │
│                         │      Debezium          │              │
│                         │   (CDC Connector)      │              │
│                         └────────────┬───────────┘              │
│                                      │                          │
│                                      │ Publish                  │
│                                      ▼                          │
│                         ┌────────────────────────┐              │
│                         │   Kafka / RabbitMQ     │              │
│                         │   (Message Broker)     │              │
│                         └────────────┬───────────┘              │
│                                      │                          │
│                                      │ Consume                  │
│                                      ▼                          │
│                         ┌────────────────────────┐              │
│                         │   Consumer Services    │              │
│                         │   (Stock, Payment...)  │              │
│                         └────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 两种实现方式

**Polling Publisher（轮询发布者）**：
- 应用程序定期轮询 outbox 表，获取未发送的消息
- 实现简单，但有延迟，且轮询增加数据库负担

**CDC（Change Data Capture）**：
- 通过读取数据库的 Binlog/WAL，实时捕获 outbox 表的变更
- 实时性好，不增加数据库负担，但架构复杂

本文重点讲解 CDC 方式（使用 Debezium）。

## 三、数据库设计

### 3.1 Outbox 表设计

```sql
CREATE TABLE `outbox_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `aggregate_type` VARCHAR(255) NOT NULL COMMENT '聚合类型（如 order, user, item）',
    `aggregate_id` VARCHAR(255) NOT NULL COMMENT '聚合 ID',
    `event_type` VARCHAR(255) NOT NULL COMMENT '事件类型（如 order.created, order.paid）',
    `payload` JSON NOT NULL COMMENT '事件数据',
    `metadata` JSON DEFAULT NULL COMMENT '元数据（trace_id, user_id 等）',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `processed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已处理（CDC 方式可以不用）',
    PRIMARY KEY (`id`),
    INDEX `idx_aggregate` (`aggregate_type`, `aggregate_id`),
    INDEX `idx_created_at` (`created_at`),
    INDEX `idx_processed` (`processed`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Outbox 事件表 - 用于可靠事件发布';
```

### 3.2 为什么用 JSON 存储 Payload

使用 JSON 而非单独列存储事件数据的原因：

1. **灵活性**：不同事件类型的数据结构不同，JSON 可以灵活适配
2. **自包含**：事件数据自包含，消费者不需要回查业务表
3. **序列化简单**：直接从 JSON 解析，不需要复杂的映射

### 3.3 清理策略

```sql
-- 定期清理已处理的旧事件（保留 7 天）
DELETE FROM outbox_events 
WHERE processed = 1 
AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY);

-- 或使用分区表（推荐用于高吞吐场景）
ALTER TABLE outbox_events PARTITION BY RANGE (UNIX_TIMESTAMP(created_at)) (
    PARTITION p202601 VALUES LESS THAN (UNIX_TIMESTAMP('2026-02-01')),
    PARTITION p202602 VALUES LESS THAN (UNIX_TIMESTAMP('2026-03-01')),
    PARTITION p202603 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

## 四、Laravel 实现

### 4.1 Outbox Eloquent Model

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;

class OutboxEvent extends Model
{
    protected $table = 'outbox_events';
    
    protected $fillable = [
        'aggregate_type',
        'aggregate_id',
        'event_type',
        'payload',
        'metadata',
    ];
    
    protected $casts = [
        'payload' => 'array',
        'metadata' => 'array',
        'processed' => 'boolean',
    ];
    
    /**
     * 未处理的事件
     */
    public function scopeUnprocessed(Builder $query): Builder
    {
        return $query->where('processed', false);
    }
    
    /**
     * 按聚合类型查询
     */
    public function scopeByAggregate(Builder $query, string $type): Builder
    {
        return $query->where('aggregate_type', $type);
    }
}
```

### 4.2 Outbox Writer

```php
<?php

namespace App\Outbox;

use App\Models\OutboxEvent;
use Illuminate\Support\Facades\DB;

/**
 * Outbox 写入器
 * 负责在数据库事务中写入 outbox 事件
 */
class OutboxWriter
{
    /**
     * 在当前事务中写入 outbox 事件
     * 
     * 使用方式：
     * DB::transaction(function () use ($order, $writer) {
     *     $order = Order::create($data);
     *     $writer->write('order', $order->id, 'order.created', [
     *         'order_id' => $order->id,
     *         'user_id' => $order->user_id,
     *         'total_amount' => $order->total_amount,
     *     ]);
     * });
     */
    public function write(
        string $aggregateType,
        string $aggregateId,
        string $eventType,
        array $payload,
        ?array $metadata = null
    ): OutboxEvent {
        return OutboxEvent::create([
            'aggregate_type' => $aggregateType,
            'aggregate_id' => $aggregateId,
            'event_type' => $eventType,
            'payload' => $payload,
            'metadata' => $metadata ?? $this->buildMetadata(),
        ]);
    }
    
    /**
     * 批量写入 outbox 事件
     */
    public function writeBatch(array $events): void
    {
        $now = now();
        
        $events = array_map(function ($event) use ($now) {
            return array_merge($event, [
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }, $events);
        
        OutboxEvent::insert($events);
    }
    
    /**
     * 构建默认元数据
     */
    protected function buildMetadata(): array
    {
        return [
            'trace_id' => request()->header('X-Request-ID', uniqid()),
            'source_service' => config('app.name'),
            'timestamp' => now()->toIso8601String(),
        ];
    }
}
```

### 4.3 在业务代码中使用

```php
<?php

namespace App\Services\Order;

use App\Models\Order;
use App\Outbox\OutboxWriter;
use Illuminate\Support\Facades\DB;

class OrderService
{
    private OutboxWriter $outboxWriter;
    
    public function __construct(OutboxWriter $outboxWriter)
    {
        $this->outboxWriter = $outboxWriter;
    }
    
    /**
     * 创建订单（原子写入业务数据 + outbox 事件）
     */
    public function createOrder(array $data): Order
    {
        return DB::transaction(function () use ($data) {
            // 1. 创建订单
            $order = Order::create([
                'user_id' => $data['user_id'],
                'order_no' => $this->generateOrderNo(),
                'total_amount' => $data['total_amount'],
                'status' => 'pending',
            ]);
            
            // 2. 创建订单明细
            foreach ($data['items'] as $item) {
                $order->items()->create($item);
            }
            
            // 3. 写入 outbox 事件（在同一事务中）
            $this->outboxWriter->write(
                aggregateType: 'order',
                aggregateId: $order->id,
                eventType: 'order.created',
                payload: [
                    'order_id' => $order->id,
                    'order_no' => $order->order_no,
                    'user_id' => $order->user_id,
                    'total_amount' => $order->total_amount,
                    'items' => $order->items->toArray(),
                ],
                metadata: [
                    'trace_id' => request()->header('X-Request-ID'),
                    'source_service' => 'order-service',
                    'ip_address' => request()->ip(),
                ]
            );
            
            return $order;
        });
    }
    
    /**
     * 订单支付成功
     */
    public function markAsPaid(int $orderId, array $paymentData): Order
    {
        return DB::transaction(function () use ($orderId, $paymentData) {
            $order = Order::findOrFail($orderId);
            
            // 1. 更新订单状态
            $order->update([
                'status' => 'paid',
                'paid_at' => now(),
                'payment_no' => $paymentData['payment_no'],
            ]);
            
            // 2. 写入 outbox 事件
            $this->outboxWriter->write(
                aggregateType: 'order',
                aggregateId: $order->id,
                eventType: 'order.paid',
                payload: [
                    'order_id' => $order->id,
                    'order_no' => $order->order_no,
                    'user_id' => $order->user_id,
                    'total_amount' => $order->total_amount,
                    'payment_no' => $paymentData['payment_no'],
                    'paid_at' => now()->toIso8601String(),
                ]
            );
            
            return $order;
        });
    }
    
    /**
     * 取消订单
     */
    public function cancelOrder(int $orderId, string $reason): Order
    {
        return DB::transaction(function () use ($orderId, $reason) {
            $order = Order::findOrFail($orderId);
            
            $order->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancel_reason' => $reason,
            ]);
            
            $this->outboxWriter->write(
                aggregateType: 'order',
                aggregateId: $order->id,
                eventType: 'order.cancelled',
                payload: [
                    'order_id' => $order->id,
                    'order_no' => $order->order_no,
                    'user_id' => $order->user_id,
                    'reason' => $reason,
                ]
            );
            
            return $order;
        });
    }
}
```

### 4.4 Outbox Event Trait

为了简化使用，可以创建一个 Trait：

```php
<?php

namespace App\Outbox;

use App\Models\OutboxEvent;
use Illuminate\Support\Facades\DB;

trait HasOutboxEvents
{
    /**
     * 待写入的 outbox 事件
     */
    protected array $pendingOutboxEvents = [];
    
    /**
     * 记录 outbox 事件（延迟写入）
     */
    protected function recordOutboxEvent(
        string $eventType,
        array $payload,
        ?array $metadata = null
    ): void {
        $this->pendingOutboxEvents[] = [
            'aggregate_type' => $this->getAggregateType(),
            'aggregate_id' => $this->getAggregateId(),
            'event_type' => $eventType,
            'payload' => $payload,
            'metadata' => $metadata,
        ];
    }
    
    /**
     * 刷新 outbox 事件到数据库
     */
    public function flushOutboxEvents(): void
    {
        if (empty($this->pendingOutboxEvents)) {
            return;
        }
        
        $now = now();
        $events = array_map(function ($event) use ($now) {
            return array_merge($event, [
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }, $this->pendingOutboxEvents);
        
        OutboxEvent::insert($events);
        
        $this->pendingOutboxEvents = [];
    }
    
    protected function getAggregateType(): string
    {
        return class_basename($this);
    }
    
    protected function getAggregateId(): string
    {
        return (string) $this->getKey();
    }
}

// 使用示例
class Order extends Model
{
    use HasOutboxEvents;
    
    protected static function booted(): void
    {
        static::created(function (Order $order) {
            $order->recordOutboxEvent('order.created', [
                'order_id' => $order->id,
                'order_no' => $order->order_no,
                'user_id' => $order->user_id,
            ]);
        });
        
        static::updated(function (Order $order) {
            if ($order->wasChanged('status')) {
                $order->recordOutboxEvent('order.status_changed', [
                    'order_id' => $order->id,
                    'old_status' => $order->getOriginal('status'),
                    'new_status' => $order->status,
                ]);
            }
        });
    }
}
```

## 五、Debezium CDC 集成

### 5.1 Debezium 架构

Debezium 是一个开源的 CDC 平台，它读取数据库的 Binlog，将变更事件发送到 Kafka：

```
MySQL Binlog ──▶ Debezium Connector ──▶ Kafka Topic ──▶ Consumer
```

### 5.2 Docker Compose 环境搭建

```yaml
version: '3.8'

services:
  # Zookeeper
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
    ports:
      - "2181:2181"

  # Kafka
  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on:
      - zookeeper
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    ports:
      - "9092:9092"

  # Kafka Connect with Debezium
  kafka-connect:
    image: quay.io/debezium/connect:2.5
    depends_on:
      - kafka
    environment:
      BOOTSTRAP_SERVERS: kafka:9092
      GROUP_ID: connect-cluster
      CONFIG_STORAGE_TOPIC: connect-configs
      OFFSET_STORAGE_TOPIC: connect-offsets
      STATUS_STORAGE_TOPIC: connect-status
      KEY_CONVERTER: org.apache.kafka.connect.json.JsonConverter
      VALUE_CONVERTER: org.apache.kafka.connect.json.JsonConverter
      KEY_CONVERTER_SCHEMAS_ENABLE: false
      VALUE_CONVERTER_SCHEMAS_ENABLE: false
    ports:
      - "8083:8083"

  # Kafka UI (可选，用于调试)
  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    depends_on:
      - kafka
    environment:
      KAFKA_CLUSTERS_0_NAME: local
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
    ports:
      - "8080:8080"
```

### 5.3 注册 Debezium Connector

```bash
# 注册 MySQL CDC Connector
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "outbox-connector",
    "config": {
      "connector.class": "io.debezium.connector.mysql.MySqlConnector",
      "database.hostname": "mysql",
      "database.port": "3306",
      "database.user": "debezium",
      "database.password": "debezium_password",
      "database.server.id": "1",
      "topic.prefix": "ecommerce",
      "database.include.list": "ecommerce",
      "table.include.list": "ecommerce.outbox_events",
      "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
      "schema.history.internal.kafka.topic": "schema-changes.outbox",
      
      "transforms": "outbox",
      "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
      "transforms.outbox.table.field.event.key": "aggregate_id",
      "transforms.outbox.table.field.event.type": "event_type",
      "transforms.outbox.table.field.event.payload": "payload",
      "transforms.outbox.route.by.field": "aggregate_type",
      "transforms.outbox.route.topic.replacement": "events.${routedByValue}",
      "transforms.outbox.table.expand.json.payload": "true",
      "transforms.outbox.collection.expanded.json.payload": "true",
      
      "key.converter": "org.apache.kafka.connect.json.JsonConverter",
      "key.converter.schemas.enable": "false",
      "value.converter": "org.apache.kafka.connect.json.JsonConverter",
      "value.converter.schemas.enable": "false"
    }
  }'
```

### 5.4 Debezium Outbox EventRouter 配置详解

`EventRouter` 是 Debezium 专门为 Outbox Pattern 设计的 SMT（Single Message Transform）：

```json
{
  "transforms": "outbox",
  "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
  
  "transforms.outbox.table.field.event.key": "aggregate_id",
  "transforms.outbox.table.field.event.type": "event_type",
  "transforms.outbox.table.field.event.payload": "payload",
  "transforms.outbox.table.field.event.timestamp": "created_at",
  "transforms.outbox.table.field.event.source": "metadata",
  
  "transforms.outbox.route.by.field": "aggregate_type",
  "transforms.outbox.route.topic.replacement": "events.${routedByValue}",
  
  "transforms.outbox.table.expand.json.payload": "true",
  "transforms.outbox.collection.expanded.json.payload": "true",
  
  "transforms.outbox.debezium.expand.json.payload": "true",
  
  "transforms.outbox.table.fields.additional.placement": "metadata:source"
}
```

配置说明：
- `table.field.event.key`：消息的 Key 字段
- `table.field.event.type`：事件类型字段
- `table.field.event.payload`：事件数据字段
- `route.by.field`：路由字段，决定消息发送到哪个 topic
- `route.topic.replacement`：topic 名称模板

## 六、消费者实现

### 6.1 Laravel Kafka 消费者

```php
<?php

namespace App\Consumers;

use Illuminate\Support\Facades\Log;

class OrderEventConsumer
{
    /**
     * 处理 order.created 事件
     */
    public function handleOrderCreated(array $event): void
    {
        $orderId = $event['payload']['order_id'];
        $userId = $event['payload']['user_id'];
        $totalAmount = $event['payload']['total_amount'];
        
        Log::info('Processing order.created event', [
            'order_id' => $orderId,
            'user_id' => $userId,
        ]);
        
        try {
            // 扣减库存
            $this->deductStock($event['payload']['items']);
            
            // 更新用户积分
            $this->addPoints($userId, (int) ($totalAmount / 100));
            
            // 发送订单确认通知
            $this->sendOrderConfirmation($userId, $orderId);
            
            Log::info('order.created event processed successfully', [
                'order_id' => $orderId,
            ]);
            
        } catch (\Exception $e) {
            Log::error('Failed to process order.created event', [
                'order_id' => $orderId,
                'exception' => $e->getMessage(),
            ]);
            
            throw $e; // 让 Kafka 重试
        }
    }
    
    /**
     * 处理 order.paid 事件
     */
    public function handleOrderPaid(array $event): void
    {
        $orderId = $event['payload']['order_id'];
        
        Log::info('Processing order.paid event', ['order_id' => $orderId]);
        
        // 确认库存扣减
        $this->confirmStockDeduction($orderId);
        
        // 通知仓库发货
        $this->notifyWarehouse($orderId);
    }
    
    /**
     * 处理 order.cancelled 事件
     */
    public function handleOrderCancelled(array $event): void
    {
        $orderId = $event['payload']['order_id'];
        
        Log::info('Processing order.cancelled event', ['order_id' => $orderId]);
        
        // 恢复库存
        $this->restoreStock($orderId);
        
        // 退款（如果已支付）
        $this->processRefund($orderId);
    }
    
    /**
     * 幂等性检查
     */
    protected function isProcessed(string $eventId): bool
    {
        return DB::table('processed_events')
            ->where('event_id', $eventId)
            ->exists();
    }
    
    /**
     * 标记事件已处理
     */
    protected function markProcessed(string $eventId, string $eventType): void
    {
        DB::table('processed_events')->insert([
            'event_id' => $eventId,
            'event_type' => $eventType,
            'processed_at' => now(),
        ]);
    }
}
```

### 6.2 幂等性保证

消费者必须保证幂等性——同一条消息被消费多次，结果应该相同：

```sql
-- 消费者幂等性表
CREATE TABLE `processed_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` VARCHAR(255) NOT NULL COMMENT '事件唯一 ID（Debezium 生成）',
    `event_type` VARCHAR(255) NOT NULL,
    `processed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_event_id` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

```php
<?php

namespace App\Consumers;

use Illuminate\Support\Facades\DB;

/**
 * 幂等事件消费者基类
 */
abstract class IdempotentEventConsumer
{
    /**
     * 处理事件（带幂等性保护）
     */
    public function process(string $eventId, string $eventType, array $payload): void
    {
        // 幂等性检查
        if ($this->isAlreadyProcessed($eventId)) {
            \Log::info("Event already processed, skipping", [
                'event_id' => $eventId,
                'event_type' => $eventType,
            ]);
            return;
        }
        
        // 执行业务逻辑
        DB::transaction(function () use ($eventId, $eventType, $payload) {
            $this->handleEvent($eventType, $payload);
            $this->markAsProcessed($eventId, $eventType);
        });
    }
    
    protected function isAlreadyProcessed(string $eventId): bool
    {
        return DB::table('processed_events')
            ->where('event_id', $eventId)
            ->exists();
    }
    
    protected function markAsProcessed(string $eventId, string $eventType): void
    {
        DB::table('processed_events')->insert([
            'event_id' => $eventId,
            'event_type' => $eventType,
            'processed_at' => now(),
        ]);
    }
    
    abstract protected function handleEvent(string $eventType, array $payload): void;
}
```

### 6.3 消费者组管理

```php
<?php

// routes/consumers.php 或 config/consumers.php

return [
    /*
    |--------------------------------------------------------------------------
    | Kafka 消费者组配置
    |--------------------------------------------------------------------------
    */
    
    'groups' => [
        'stock-service' => [
            'topics' => ['events.order'],
            'handler' => \App\Consumers\StockEventConsumer::class,
            'concurrency' => 3,
            'auto_commit' => false,
        ],
        
        'notification-service' => [
            'topics' => ['events.order', 'events.user'],
            'handler' => \App\Consumers\NotificationEventConsumer::class,
            'concurrency' => 2,
            'auto_commit' => false,
        ],
        
        'analytics-service' => [
            'topics' => ['events.order', 'events.user', 'events.item'],
            'handler' => \App\Consumers\AnalyticsEventConsumer::class,
            'concurrency' => 1,
            'auto_commit' => true,
        ],
    ],
    
    /*
    | 死信队列配置
    */
    'dead_letter' => [
        'enabled' => true,
        'topic' => 'events.dead-letter',
        'max_retries' => 3,
    ],
];
```

## 七、对比：Polling Publisher vs CDC

### 7.1 Polling Publisher 实现

如果不想引入 Debezium，可以用简单的轮询方式：

```php
<?php

namespace App\Outbox;

use App\Models\OutboxEvent;
use Illuminate\Support\Facades\Redis;

class PollingPublisher
{
    private string $kafkaTopic;
    private int $batchSize;
    private int $pollIntervalMs;
    
    public function __construct(
        string $kafkaTopic = 'events',
        int $batchSize = 100,
        int $pollIntervalMs = 1000
    ) {
        $this->kafkaTopic = $kafkaTopic;
        $this->batchSize = $batchSize;
        $this->pollIntervalMs = $pollIntervalMs;
    }
    
    /**
     * 启动轮询发布
     */
    public function run(): void
    {
        \Log::info('Starting polling publisher');
        
        while (true) {
            try {
                $published = $this->publishPendingEvents();
                
                if ($published > 0) {
                    \Log::info("Published {$published} events");
                }
                
            } catch (\Exception $e) {
                \Log::error('Polling publisher error', [
                    'exception' => $e->getMessage(),
                ]);
            }
            
            usleep($this->pollIntervalMs * 1000);
        }
    }
    
    /**
     * 发布待处理的事件
     */
    protected function publishPendingEvents(): int
    {
        // 使用分布式锁确保只有一个实例在发布
        $lock = Redis::lock('outbox:publishing:lock', 30);
        
        if (!$lock->get()) {
            return 0;
        }
        
        try {
            $events = OutboxEvent::unprocessed()
                ->orderBy('id')
                ->limit($this->batchSize)
                ->lockForUpdate()
                ->get();
            
            if ($events->isEmpty()) {
                return 0;
            }
            
            foreach ($events as $event) {
                $this->publishEvent($event);
                
                $event->update(['processed' => true]);
            }
            
            return $events->count();
            
        } finally {
            $lock->release();
        }
    }
    
    /**
     * 发布单个事件到 Kafka
     */
    protected function publishEvent(OutboxEvent $event): void
    {
        $topic = "{$this->kafkaTopic}.{$event->aggregate_type}";
        
        $message = [
            'event_id' => "outbox:{$event->id}",
            'event_type' => $event->event_type,
            'aggregate_type' => $event->aggregate_type,
            'aggregate_id' => $event->aggregate_id,
            'payload' => $event->payload,
            'metadata' => $event->metadata,
            'timestamp' => $event->created_at->toIso8601String(),
        ];
        
        Kafka::publish($topic, $event->aggregate_id, $message);
    }
}
```

### 7.2 对比总结

| 维度 | Polling Publisher | CDC (Debezium) |
|------|------------------|----------------|
| 实时性 | 秒级延迟（取决于轮询间隔） | 毫秒级延迟 |
| 数据库负担 | 增加（轮询查询） | 几乎无影响（读 Binlog） |
| 运维复杂度 | 低 | 高（需要维护 Debezium + Kafka Connect） |
| 消息顺序 | 可控（按 ID 排序） | 可能乱序（并发 Binlog 事件） |
| 适用场景 | 低吞吐、简单场景 | 高吞吐、高可用场景 |
| 故障恢复 | 重试未处理的事件 | 从 Binlog 位点恢复 |

## 八、生产环境最佳实践

### 8.1 常见踩坑

**坑 1：Outbox 表膨胀**

如果不定期清理 outbox 表，数据量会持续增长，影响查询性能。

**解决方案**：
- 设置 TTL，定期清理已处理的旧事件
- 使用分区表，按时间自动过期
- CDC 方式可以不用 `processed` 字段，依赖 Binlog 位点

**坑 2：消息顺序问题**

Debezium 并行处理 Binlog 事件，可能导致同一聚合的消息乱序。

**解决方案**：
- 使用 `aggregate_id` 作为 Kafka 的 Partition Key，同一聚合的消息进入同一 Partition
- 消费者按 Partition 顺序消费

**坑 3：Debezium 连接中断**

MySQL 主从切换或网络中断可能导致 Debezium 断开。

**解决方案**：
- 配置 Debezium 的重连策略
- 监控 Debezium Connector 状态
- 使用 Kafka Connect 的分布式模式（多实例）

**坑 4：Schema 变更**

Outbox 表结构变更可能导致 Debezium 解析失败。

**解决方案**：
- 使用 JSON 格式存储 payload（灵活）
- Schema 变更前先暂停 Connector
- 使用 Schema Registry 管理 schema 版本

### 8.2 监控要点

```php
<?php

namespace App\Monitoring;

class OutboxMonitor
{
    /**
     * 监控指标
     */
    public function getMetrics(): array
    {
        return [
            // Outbox 表积压量
            'pending_events' => OutboxEvent::unprocessed()->count(),
            
            // 最旧未处理事件的时间
            'oldest_pending_age_seconds' => $this->getOldestPendingAge(),
            
            // 事件写入速率（每分钟）
            'write_rate_per_minute' => $this->getWriteRate(),
            
            // Debezium Connector 状态
            'connector_status' => $this->getConnectorStatus(),
            
            // Kafka Consumer Lag
            'consumer_lag' => $this->getConsumerLag(),
        ];
    }
    
    /**
     * 获取最旧未处理事件的年龄（秒）
     */
    protected function getOldestPendingAge(): int
    {
        $oldest = OutboxEvent::unprocessed()
            ->orderBy('created_at')
            ->first();
        
        if (!$oldest) {
            return 0;
        }
        
        return now()->diffInSeconds($oldest->created_at);
    }
}
```

### 8.3 告警规则

```yaml
groups:
  - name: outbox_alerts
    rules:
      # Outbox 积压告警
      - alert: OutboxBacklogHigh
        expr: outbox_pending_events > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Outbox event backlog is high: {{ $value }}"
      
      # 最旧事件过老
      - alert: OutboxOldestEventStale
        expr: outbox_oldest_pending_age_seconds > 300
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Oldest unprocessed outbox event is {{ $value }}s old"
      
      # Debezium Connector 异常
      - alert: DebeziumConnectorFailed
        expr: debezium_connector_status{state="FAILED"} == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Debezium connector {{ $labels.connector }} is FAILED"
```

## 九、总结

Outbox Pattern 是解决数据库与消息队列一致性的标准方案。通过 Laravel + Debezium 的组合：

1. **原子性保证**：业务数据和事件在同一事务中写入
2. **可靠传输**：通过 CDC 实时捕获变更，不丢失消息
3. **最终一致性**：即使暂时不一致，最终也会趋于一致
4. **幂等消费**：消费者保证幂等，处理重复消息无副作用

对于中小规模系统，Polling Publisher 足够简单可靠；对于高吞吐场景，Debezium CDC 是更优的选择。无论哪种方式，Outbox Pattern 都是微服务架构中保证数据一致性的必备武器。

## 相关阅读

- [分布式 ID 生成实战：Snowflake/ULID/UUIDv7 在 Laravel 中的选型——对比自增主键的利弊](/categories/Laravel/分布式ID生成实战-Snowflake-ULID-UUIDv7在Laravel中的选型/)
- [Circuit Breaker 深度实战：PHP 手写熔断器 vs Laravel HTTP Client 的 resilience 模式——从原理到生产落地](/categories/Laravel/PHP/Circuit-Breaker-深度实战-PHP-手写熔断器-vs-Laravel-HTTP-Client-resilience-模式/)
