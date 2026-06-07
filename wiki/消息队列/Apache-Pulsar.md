# Apache Pulsar

## 定义
Apache Pulsar 是云原生分布式消息流平台，以计算存储分离、多租户、统一消息模型为核心特征。在 Laravel 微服务中适合需要多租户隔离和灵活消息语义的场景。

## 核心原理

### 架构模型
- **Broker**：无状态计算层，处理消息路由
- **BookKeeper**：持久化存储层，分布式日志存储
- **Topic**：消息通道，支持分区和非分区
- **Subscription**：消费订阅模式，支持多种语义

### 订阅模式
| 模式 | 语义 | 适用场景 |
|------|------|----------|
| Exclusive | 独占消费 | 严格有序场景 |
| Shared | 负载均衡消费 | 任务分发 |
| Failover | 主备切换消费 | 高可用场景 |
| Key_Shared | 按 Key 分配 | 有序 + 负载均衡 |

### 关键特性
- **计算存储分离**：Broker 无状态，存储在 BookKeeper
- **多租户**：Tenant → Namespace → Topic 层级隔离
- **统一消息模型**：同时支持队列和流两种语义
- **分层存储**：冷数据自动卸载到对象存储（S3/GCS）
- **Pulsar Functions**：轻量级流处理

## 实战案例

来自博客文章：
- [Apache Pulsar 实战：多租户消息系统与 Laravel 集成——对比 Kafka 的下一代事件流平台](/2026/06/01/mq/Apache-Pulsar-多租户消息系统-Laravel集成-对比Kafka/) — 多租户配置、Laravel 集成、与 Kafka 对比
- [Kafka vs NATS vs Pulsar 2026 实战](/2026/06/01/kafka-vs-nats-vs-pulsar-2026-laravel-microservice-mq-comparison/) — 三大消息队列深度对比
- [事件驱动架构全景实战：EventBridge/NATS/Pulsar 统一事件总线设计](/2026/06/01/事件驱动架构全景实战-EventBridge-NATS-Pulsar-统一事件总线设计/) — 统一事件总线设计

### Laravel 集成方式
1. **PHP 客户端**：`apache/pulsar-client-php`（社区维护）
2. **REST API**：Pulsar HTTP 接口
3. **消息桥接**：通过 Kafka 兼容层（KoP）使用 Laravel Kafka 包

### 常见踩坑
1. **BookKeeper 运维复杂度**：需要独立运维存储层
2. **社区生态**：PHP 客户端不如 Kafka 成熟
3. **延迟开销**：计算存储分离带来的额外网络跳转

## 相关概念
- [MQ 选型对比](MQ选型对比.md) — 与 Kafka/RabbitMQ/NATS 对比
- [消息可靠性保障](消息可靠性保障.md) — 幂等消费、重试策略
- [Outbox 模式](Outbox模式.md) — 数据库与 MQ 最终一致性

## 常见问题

### Pulsar vs Kafka？
- Pulsar：计算存储分离、多租户、统一消息模型
- Kafka：成熟生态、高吞吐、社区活跃
- 决策：多租户、冷热分离 → Pulsar；成熟生态、高吞吐 → Kafka

### 何时选择 Pulsar？
- 需要多租户隔离（SaaS 场景）
- 需要同时支持队列和流语义
- 需要分层存储降低成本
- 需要轻量级流处理（Pulsar Functions）
