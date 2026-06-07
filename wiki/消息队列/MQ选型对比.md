# MQ 选型对比

## 定义
消息队列选型是在 Kafka、RabbitMQ、Pulsar、NATS、Redis Stream 等方案中，根据业务场景选择最合适的消息中间件。选型维度包括吞吐量、延迟、可靠性、运维复杂度、生态成熟度。

## 核心对比

### 全方位对比表

| 维度 | Kafka | RabbitMQ | Pulsar | NATS/JetStream | Redis Stream |
|------|-------|----------|--------|----------------|--------------|
| **定位** | 事件流平台 | 消息代理 | 云原生消息流 | 轻量消息系统 | 轻量队列 |
| **吞吐量** | 极高（百万/s） | 中等（万/s） | 高（百万/s） | 高（百万/s） | 中等（万/s） |
| **延迟** | 毫秒级 | 微秒级 | 毫秒级 | 微秒级 | 微秒级 |
| **持久化** | ✅ 磁盘 | ✅ 磁盘 | ✅ BookKeeper | ✅ JetStream | ✅ RDB/AOF |
| **消费模式** | Pull | Push | Push/Pull | Push/Pull | Pull |
| **消费者组** | ✅ | ✅ | ✅ | ✅ Queue Groups | ✅ |
| **消息回放** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **死信队列** | 需自建 | ✅ 原生 | ✅ | 需自建 | 需自建 |
| **延迟消息** | 需自建 | ✅ 插件/TTL | ✅ | 需自建 | 需自建 |
| **多租户** | ❌ | ❌ | ✅ | ❌ | ❌ |
| **运维复杂度** | 高 | 中 | 高 | 低 | 低 |
| **PHP 生态** | 成熟 | 成熟 | 弱 | 中等 | Laravel 原生 |

### 选型决策树

```
需要消息队列
    │
    ├─ 事件流/日志聚合/高吞吐
    │   └─→ Kafka
    │
    ├─ 复杂路由/延迟消息/任务分发
    │   └─→ RabbitMQ
    │
    ├─ 多租户/计算存储分离/统一消息模型
    │   └─→ Pulsar
    │
    ├─ 轻量部署/低延迟/微服务通信
    │   └─→ NATS/JetStream
    │
    └─ 已有 Redis/轻量异步/中等吞吐
        └─→ Redis Stream
```

## 按场景推荐

### 电商 B2C 全链路
- **订单事件流**：Kafka（高吞吐、持久化、事件回放）
- **任务分发**：RabbitMQ（灵活路由、死信队列）
- **实时通知**：NATS（低延迟、轻量部署）
- **配置同步**：NATS KV（内置键值存储）

### IoT 数据采集
- **设备数据上报**：MQTT → NATS（轻量、低延迟）
- **数据管道**：Kafka（高吞吐、持久化）
- **规则引擎**：Pulsar Functions（轻量流处理）

### 微服务事件驱动
- **领域事件**：Kafka 或 Pulsar（持久化、回放）
- **命令分发**：RabbitMQ（点对点、确认机制）
- **广播通知**：NATS Pub/Sub（低延迟、广播）

## 实战案例

来自博客文章：
- [MQ 消息队列深度对比：RabbitMQ vs Kafka vs RocketMQ 选型指南](/2026/06/01/mq/mq-comparison/) — 传统 MQ 选型对比
- [Kafka vs NATS vs Pulsar 2026 实战](/2026/06/01/kafka-vs-nats-vs-pulsar-2026-laravel-microservice-mq-comparison/) — 三大消息队列深度对比
- [事件驱动架构全景实战](/2026/06/01/事件驱动架构全景实战-EventBridge-NATS-Pulsar-统一事件总线设计/) — 统一事件总线设计

## 相关概念
- [Kafka 深度实战](Kafka深度实战.md) — 分区、消费者组、Exactly-Once
- [RabbitMQ 与 AMQP](RabbitMQ与AMQP.md) — Exchange、死信队列、延迟消息
- [NATS 与 JetStream](NATS与JetStream.md) — 轻量消息、KV 存储
- [Apache Pulsar](Apache-Pulsar.md) — 多租户、计算存储分离
- [消息可靠性保障](消息可靠性保障.md) — 幂等、重试、死信
- [Outbox 模式](Outbox模式.md) — 数据库与 MQ 最终一致性

## 常见问题

### 如何从 Redis Queue 迁移到 Kafka？
1. 双写期：同时发送到 Redis Queue 和 Kafka Topic
2. 双消费期：两个消费者同时处理，验证结果一致
3. 切换期：停止 Redis Queue 消费，只消费 Kafka
4. 清理期：确认无问题后下线 Redis Queue

### 消息队列的成本如何评估？
- **Kafka**：存储成本高（多副本），运维成本高
- **RabbitMQ**：内存成本高（消息堆积时），运维成本中
- **Pulsar**：BookKeeper 存储成本，运维成本高
- **NATS**：资源占用低，运维成本低
- **Redis Stream**：复用 Redis，无额外成本
