# Outbox Pattern（发件箱模式）

## 定义

Outbox Pattern（发件箱模式）是一种解决微服务架构中**数据库与消息队列双写一致性**问题的架构模式。核心思想：在同一个数据库事务中同时写入业务数据和待发送事件消息，再通过可靠的转发机制（CDC/轮询/事务消息）将事件异步投递到消息队列，保证**本地事务原子性 + 最终一致性**。

## 核心原理

### 双写困境

微服务中一个业务操作需要同时完成「写数据库」+「发消息到 MQ」，但这两个系统无法共享事务：

| 场景 | 问题 |
|------|------|
| DB 写入成功，MQ 发送失败 | 下游无感知，数据不一致 |
| MQ 发送成功，DB 写入失败 | 下游收到幽灵事件 |
| MQ 发送成功但延迟 | 下游读到过期数据 |

### Outbox 架构

```
┌─────────────────────────────────────────────────────────┐
│                   应用服务（Producer）                      │
│                                                          │
│  ┌──────────────┐    ┌──────────────────────────────┐   │
│  │  业务操作     │    │  数据库事务（单一事务）          │   │
│  │  创建订单     │───▶│  1. INSERT INTO orders ...     │   │
│  │              │    │  2. INSERT INTO outbox_events  │   │
│  └──────────────┘    └──────────────────────────────┘   │
│                              │                           │
└──────────────────────────────┼───────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  消息转发机制         │
                    │  (CDC / 轮询 / 事务消息)│
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   消息队列            │
                    │   (Kafka / RabbitMQ) │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   消费者（幂等消费）   │
                    └─────────────────────┘
```

### Outbox 表设计

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(255) NOT NULL,  -- 聚合类型（如 'Order'）
    aggregate_id VARCHAR(255) NOT NULL,    -- 聚合 ID（如订单号）
    event_type VARCHAR(255) NOT NULL,      -- 事件类型（如 'OrderCreated'）
    payload JSONB NOT NULL,                -- 事件载荷
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ NULL,         -- 发布时间（null = 未发送）
    INDEX idx_unpublished (published_at) WHERE published_at IS NULL
);
```

## 三种转发机制对比

| 维度 | Debezium CDC | 轮询发布（Polling） | 事务消息 |
|------|-------------|-------------------|---------|
| 原理 | 监听 binlog/WAL 变更 | 定时查询未发布记录 | MQ 原生事务支持 |
| 延迟 | 极低（毫秒级） | 中（取决于轮询间隔） | 低 |
| 侵入性 | **零侵入**（不改业务代码） | 需要额外轮询逻辑 | 需要 MQ SDK 集成 |
| 可靠性 | 高（数据库日志保证） | 中（可能漏发/重复） | 高（MQ 事务保证） |
| 基础设施 | 需部署 Debezium + Kafka Connect | 无额外依赖 | 需支持事务的 MQ |
| 适用场景 | 高吞吐、低延迟 | 小规模、简单架构 | RocketMQ 事务消息 |

### Debezium CDC 工作原理

```
Outbox 表 INSERT → binlog/WAL 写入 → Debezium Connector 捕获
    → Kafka Topic（OrderCreated 事件）→ 消费者
```

Debezium 的 `Outbox Event Router` SMT 自动将 Outbox 表的行变更转换为 Kafka 消息，无需编写任何转发代码。

### 轮询发布

```php
// Laravel 示例：定时任务轮询 Outbox 表
$outboxEvents = DB::table('outbox_events')
    ->whereNull('published_at')
    ->orderBy('created_at')
    ->limit(100)
    ->get();

foreach ($outboxEvents as $event) {
    Kafka::publish($event->event_type, $event->payload);
    DB::table('outbox_events')
        ->where('id', $event->id)
        ->update(['published_at' => now()]);
}
```

### 幂等消费

下游消费者必须处理重复消息（At-Least-Once 语义）：

```php
// 消费者幂等处理
$eventId = $message->header('event_id');
if (Cache::add("processed:{$eventId}", true, 86400)) {
    // 首次处理
    processOrderCreated($message->body());
} else {
    // 重复消息，跳过
    Log::info("Duplicate event skipped: {$eventId}");
}
```

## 与其他分布式事务方案对比

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|--------|------|--------|---------|
| **Outbox Pattern** | 最终一致 | 高 | 中 | DB + MQ 双写、事件驱动架构 |
| Saga | 最终一致 | 高 | 高 | 跨多服务业务流程编排 |
| TCC | 强一致 | 中 | 高 | 资源预留场景（支付/库存） |
| 2PC | 强一致 | 低 | 高 | 同构数据库，极少使用 |

## 实战案例

来自博客文章：[Outbox Pattern 深度实战：保证数据库与消息队列的最终一致性](/2026/06/06/outbox-pattern-debezium-cdc-polling-transactional-message/)

关键实战要点：
- 电商下单场景的 Outbox 表设计与事务代码
- Debezium Connector 配置（`OutboxEventRouter`、`table.field.*` 映射）
- Kafka 消费者幂等去重方案（Redis SETNX + 数据库唯一约束双重保障）
- 生产踩坑：Outbox 表膨胀（需定期清理已发布记录）、大事务导致 binlog 延迟

## 相关概念

- [事件驱动架构](事件驱动架构.md) - Outbox 是事件驱动的核心基础设施
- [事件最终一致性](事件最终一致性.md) - Outbox 保证最终一致性的具体实现
- [CDC与事件流](CDC与事件流.md) - Debezium CDC 的完整架构
- [分布式事务](分布式事务.md) - Outbox 在分布式事务谱系中的位置
- [Saga 编排模式](分布式事务.md) - 跨服务编排与 Outbox 互补
- [TCC 分布式事务](TCC分布式事务.md) - 强一致场景的替代方案

## 常见问题

**Q: Outbox 表需要清理吗？**
A: 需要。已发布的记录应定期清理（如保留 7 天），否则表会持续膨胀。可通过 pg_cron 或 Laravel Scheduler 定期清理。

**Q: Debezium CDC 和轮询怎么选？**
A: 高吞吐（>1000 TPS）选 Debezium（零侵入、毫秒延迟）。小规模（<100 TPS）选轮询（无需额外基础设施）。

**Q: Outbox 模式能保证消息顺序吗？**
A: 可以保证单个聚合内的事件顺序（通过 `aggregate_id` 分区到同一 Kafka Partition）。跨聚合的全局顺序不保证。

**Q: 和 Event Sourcing 有什么区别？**
A: Event Sourcing 用事件流作为数据的唯一存储。Outbox 中事件是业务数据的"副产品"，数据库仍是唯一事实来源。
