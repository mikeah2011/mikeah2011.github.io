# Outbox 模式

## 定义
Outbox 模式（发件箱模式）是解决数据库写入与消息发送之间一致性问题的架构模式。核心思想：将消息先写入数据库的 Outbox 表（与业务数据在同一事务中），再通过独立进程转发到消息队列，保证"数据库操作 + 消息发送"的原子性。

## 核心原理

### 问题场景
```
// 问题代码：数据库提交成功，但消息发送失败
DB::transaction(function () {
    Order::create($data);           // ✅ 成功
    Kafka::publish('order.created', $data);  // ❌ 失败
});
// 结果：数据库有订单，但下游服务不知道
```

### Outbox 解决方案
```
// 正确做法：消息写入 Outbox 表（同一事务）
DB::transaction(function () {
    Order::create($data);           // 业务表
    Outbox::create([                // Outbox 表
        'aggregate_type' => 'Order',
        'aggregate_id' => $order->id,
        'event_type' => 'OrderCreated',
        'payload' => json_encode($data),
        'status' => 'pending',
    ]);
});

// 独立进程：轮询 Outbox 表，发送到 MQ
// 发送成功后标记为 'sent'
```

### 三种转发机制

| 机制 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **轮询（Polling）** | 定时查询 Outbox 表 | 实现简单 | 延迟高、DB 压力大 |
| **CDC（Debezium）** | 监听 binlog 变更 | 延迟低、无侵入 | 运维复杂 |
| **事务消息** | MQ 原生支持 | 原子性好 | 依赖 MQ 实现 |

### Debezium CDC 方案
```
MySQL binlog → Debezium → Kafka Topic → Consumer
     ↑
Outbox 表写入（同一事务）
```

优势：
- 无需轮询，延迟低（毫秒级）
- 不增加数据库查询压力
- 与业务代码完全解耦

## 实战案例

来自博客文章：
- [Outbox Pattern 深度实战：保证数据库与消息队列的最终一致性](/2026/06/01/databases/2026-06-06-outbox-pattern-debezium-cdc-polling-transactional-message/) — Debezium CDC vs 轮询 vs 事务消息的选型决策
- [Outbox Pattern 实战：Laravel + Debezium 的可靠事件发布](/2026/06/01/05_PHP/Laravel/Outbox-Pattern-实战-保证数据库与消息队列的最终一致性-Laravel-Debezium/) — Laravel 实现细节
- [Kafka + Debezium CDC 实战](/2026/06/01/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/) — CDC 与 Event Sourcing 互补

### Laravel 实现要点
1. **Outbox 表设计**：aggregate_type、event_type、payload、status、retry_count
2. **事务写入**：`DB::transaction()` 内同时写业务表和 Outbox 表
3. **轮询 Worker**：Laravel Command 定时查询 pending 记录并发送
4. **幂等发送**：Outbox 记录 ID 作为消息唯一标识
5. **清理策略**：sent 记录定期归档或删除

### 常见踩坑
1. **Outbox 表膨胀**：大量 pending 记录未及时发送
2. **消息顺序**：轮询可能乱序，需按 aggregate_id 排序
3. **重试风暴**：发送失败后无限重试，需设置上限
4. **CDC 运维**：Debezium Connector 配置和监控

## 相关概念
- [消息可靠性保障](消息可靠性保障.md) — 幂等消费、死信队列
- [MQ 选型对比](MQ选型对比.md) — 消息队列选型
- → [架构设计知识图谱](../架构设计/事件最终一致性.md)：Outbox/Inbox 模式
- → [架构设计知识图谱](../架构设计/CDC与事件流.md)：Debezium CDC 集成

## 常见问题

### Outbox vs 事务消息？
- Outbox：通用方案，不依赖特定 MQ，但需要额外表和 Worker
- 事务消息：MQ 原生支持（如 RocketMQ），实现简单但依赖 MQ
- 决策：多 MQ 混用 → Outbox；单一 MQ → 考虑事务消息

### 如何保证消息不丢？
1. Outbox 表与业务表同一事务写入（原子性）
2. 轮询 Worker 确认发送成功后才标记 sent
3. 消费端幂等处理（唯一约束或幂等键）
4. 定期对账：比对 Outbox 记录与 MQ 消息
