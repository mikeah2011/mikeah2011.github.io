# 消息队列知识图谱

> 面向 Hexo 博客文章整理的消息队列 Wiki。本索引串联 Kafka、RabbitMQ、Pulsar、NATS、Redis Stream 等消息中间件，覆盖选型对比、深度实战、可靠性保障与 Laravel 集成。

## 核心概念

### 📊 选型与对比
- [MQ 选型对比](MQ选型对比.md) - Kafka vs RabbitMQ vs Pulsar vs NATS vs Redis Stream 全方位对比
- [消息可靠性保障](消息可靠性保障.md) - 幂等消费、死信队列、重试策略、端到端不丢失

### 🚀 深度实战
- [Kafka 深度实战](Kafka深度实战.md) - 分区、消费者组、Exactly-Once、Laravel 集成
- [RabbitMQ 与 AMQP](RabbitMQ与AMQP.md) - Exchange 路由、死信队列、延迟消息、Laravel 集成
- [Apache Pulsar](Apache-Pulsar.md) - 多租户、计算存储分离、统一消息模型
- [NATS 与 JetStream](NATS与JetStream.md) - 轻量消息、KV 存储、Laravel 集成

### 🔄 一致性模式
- [Outbox 模式](Outbox模式.md) - 数据库与消息队列的最终一致性，Debezium CDC/轮询/事务消息

## 主题关系图

### 1. 选型是第一步
选择消息队列需要考虑吞吐量、延迟、可靠性、运维复杂度和生态成熟度。不同场景适合不同的 MQ。

- 相关页：[MQ 选型对比](MQ选型对比.md)
- 相关文章：
  - [MQ 消息队列深度对比：RabbitMQ vs Kafka vs RocketMQ 选型指南](/2026/06/01/mq/mq-comparison/)
  - [Kafka vs NATS vs Pulsar 2026 实战](/2026/06/01/kafka-vs-nats-vs-pulsar-2026-laravel-microservice-mq-comparison/)

### 2. 高吞吐事件流场景首选 Kafka
Kafka 以分区有序、持久化、高吞吐为核心，适合订单事件流、日志聚合、CDC 数据同步。

- 相关页：[Kafka 深度实战](Kafka深度实战.md)
- 相关文章：
  - [Laravel-Kafka 消息队列异步解耦实战](/2026/06/01/mq/Kafka/laravel-kafka-guide/)
  - [Kafka + Debezium CDC 实战](/2026/06/01/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
  - [Kafka](/2026/06/01/mq/kafka/)

### 3. 复杂路由和延迟消息选 RabbitMQ
RabbitMQ 以 AMQP 协议、灵活路由、死信队列为核心，适合任务分发、延迟消息、RPC 调用。

- 相关页：[RabbitMQ 与 AMQP](RabbitMQ与AMQP.md)
- 相关文章：
  - [RabbitMQ 实战：AMQP 协议、死信队列、延迟消息与 Laravel 集成](/2026/06/01/mq/RabbitMQ-AMQP-死信队列-延迟消息-Laravel-集成-对比Redis-Queue选型/)

### 4. 轻量部署和低延迟选 NATS
NATS 以极低延迟、轻量部署为核心，适合微服务间通信、IoT 数据采集、配置同步。

- 相关页：[NATS 与 JetStream](NATS与JetStream.md)
- 相关文章：
  - [Laravel + NATS JetStream 实战](/2026/06/01/php/Laravel/laravel-nats-jetstream-guide-ackkv/)
  - [事件驱动架构全景实战](/2026/06/01/事件驱动架构全景实战-EventBridge-NATS-Pulsar-统一事件总线设计/)

### 5. 多租户和云原生选 Pulsar
Pulsar 以计算存储分离、多租户为核心，适合 SaaS 场景和需要灵活消息语义的系统。

- 相关页：[Apache Pulsar](Apache-Pulsar.md)
- 相关文章：
  - [Apache Pulsar 实战：多租户消息系统与 Laravel 集成](/2026/06/01/mq/Apache-Pulsar-多租户消息系统-Laravel集成-对比Kafka/)

### 6. 可靠性是消息系统的生命线
无论选择哪种 MQ，都需要保障消息不丢失、不重复、可追踪。

- 相关页：[消息可靠性保障](消息可靠性保障.md)、[Outbox 模式](Outbox模式.md)
- 相关文章：
  - [Outbox Pattern 深度实战](/2026/06/01/databases/2026-06-06-outbox-pattern-debezium-cdc-polling-transactional-message/)
  - [Outbox Pattern 实战：Laravel + Debezium](/2026/06/01/05_PHP/Laravel/Outbox-Pattern-实战-保证数据库与消息队列的最终一致性-Laravel-Debezium/)

## 关键概念导航

| 概念 | 说明 | 关联页面 |
|------|------|----------|
| 分区有序 | Kafka Partition 内严格有序 | [Kafka 深度实战](Kafka深度实战.md) |
| 消费者组 | 同组分摊消费，不同组独立消费 | [Kafka 深度实战](Kafka深度实战.md) |
| Exactly-Once | 幂等 Producer + 事务 API | [Kafka 深度实战](Kafka深度实战.md) |
| Exchange 路由 | Direct/Topic/Fanout/Headers | [RabbitMQ 与 AMQP](RabbitMQ与AMQP.md) |
| 死信队列 | 消费失败的消息路由到 DLX | [RabbitMQ 与 AMQP](RabbitMQ与AMQP.md)、[消息可靠性保障](消息可靠性保障.md) |
| 延迟消息 | TTL + DLX 或延迟插件 | [RabbitMQ 与 AMQP](RabbitMQ与AMQP.md) |
| 多租户 | Tenant → Namespace → Topic | [Apache Pulsar](Apache-Pulsar.md) |
| 计算存储分离 | Broker 无状态 + BookKeeper 存储 | [Apache Pulsar](Apache-Pulsar.md) |
| JetStream | NATS 持久化和流处理层 | [NATS 与 JetStream](NATS与JetStream.md) |
| KV 存储 | NATS 内置键值存储 | [NATS 与 JetStream](NATS与JetStream.md) |
| Outbox 模式 | 数据库与 MQ 原子写入 | [Outbox 模式](Outbox模式.md) |
| CDC 转发 | Debezium 监听 binlog | [Outbox 模式](Outbox模式.md) |
| 幂等消费 | 唯一约束/幂等键/状态机 | [消息可靠性保障](消息可靠性保障.md) |
| 指数退避 | 重试间隔指数增长 + 抖动 | [消息可靠性保障](消息可靠性保障.md) |

## 阅读建议

1. 先读 [MQ 选型对比](MQ选型对比.md) 了解各 MQ 的定位和适用场景。
2. 根据场景选择对应的深度实战页：
   - 高吞吐事件流 → [Kafka 深度实战](Kafka深度实战.md)
   - 复杂路由任务分发 → [RabbitMQ 与 AMQP](RabbitMQ与AMQP.md)
   - 轻量低延迟 → [NATS 与 JetStream](NATS与JetStream.md)
   - 多租户云原生 → [Apache Pulsar](Apache-Pulsar.md)
3. 读 [消息可靠性保障](消息可靠性保障.md) 理解端到端不丢失的工程化方案。
4. 读 [Outbox 模式](Outbox模式.md) 理解数据库与 MQ 的一致性保障。
5. 结合 [Laravel 集成](../Redis/Laravel集成.md) 和 [队列与事件系统](../PHP-Laravel/队列与事件系统.md) 理解 PHP 落地方式。

## 学习路径

```
入门 ─────────────────────────────────────────────────────────────── 进阶

1. MQ 选型对比（了解各 MQ 定位）
   │
   ├─→ 2a. Kafka 深度实战（高吞吐事件流）
   ├─→ 2b. RabbitMQ 与 AMQP（灵活路由）
   ├─→ 2c. NATS 与 JetStream（轻量低延迟）
   └─→ 2d. Apache Pulsar（多租户云原生）
   │
   ▼
3. 消息可靠性保障（幂等、死信、重试）
   │
   ▼
4. Outbox 模式（数据库与 MQ 一致性）
   │
   ▼
5. 实战踩坑与生产调优
```

## 跨领域关联
- → [Redis 知识图谱](../Redis/index.md)：Redis Stream 轻量队列、分布式锁
- → [PHP-Laravel 知识图谱](../PHP-Laravel/index.md)：Laravel Queue、事件系统、NATS 集成
- → [架构设计知识图谱](../架构设计/index.md)：事件驱动架构、CDC 事件流、分布式事务、Outbox 模式
- → [MySQL 知识图谱](../MySQL/index.md)：binlog、CDC、主从复制
- → [DevOps 知识图谱](../DevOps/index.md)：Kafka/Pulsar 集群部署与监控
