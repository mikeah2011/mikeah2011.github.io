# Kafka 深度实战

## 定义
Apache Kafka 是分布式事件流平台，以高吞吐、持久化、分区有序为核心特征。在 Laravel 微服务中常用于订单事件流、CDC 数据同步、日志聚合等场景。

## 核心原理

### 架构模型
- **Broker**：Kafka 集群节点，存储和转发消息
- **Topic**：逻辑消息通道，物理上分为多个 Partition
- **Partition**：有序、不可变的消息序列，支持水平扩展
- **Consumer Group**：同一组内消费者分摊消费 Partition，不同组独立消费
- **Offset**：消费者在 Partition 中的消费位置

### 关键特性
- **分区有序**：同一 Partition 内消息严格有序，跨 Partition 无序
- **持久化**：消息写入磁盘（顺序写），支持日志保留策略
- **高吞吐**：批量发送、零拷贝、页缓存、压缩
- **Exactly-Once 语义**：幂等 Producer + 事务 API

### 与 Laravel 集成
- `laravel-kafka` 包（matomo/laravel-kafka 或 confluent/kafka）
- Producer 发送领域事件到 Kafka Topic
- Consumer Worker 消费事件并调用 Laravel Handler

## 实战案例

来自博客文章：
- [Laravel-Kafka 消息队列异步解耦实战-KKday B2C API 订单处理与库存扣减真实踩坑记录](/2026/06/01/mq/Kafka/laravel-kafka-guide/) — Producer/Consumer 配置、分区策略、消费者组管理
- [Kafka + Debezium CDC 实战：数据库变更事件流](/2026/06/01/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/) — binlog 捕获、Schema Registry、Exactly-Once 语义
- [Kafka vs NATS vs Pulsar 2026 实战](/2026/06/01/kafka-vs-nats-vs-pulsar-2026-laravel-microservice-mq-comparison/) — 三大消息队列深度对比

### 常见踩坑
1. **消费者 Rebalance 风暴**：消费者频繁加入/退出导致 Rebalance，消费暂停
2. **分区数规划**：分区数 = 消费者数，过多分区导致 Broker 压力增大
3. **消息积压**：消费速度跟不上生产速度，需扩容消费者或增加分区
4. **Offset 管理**：自动提交 vs 手动提交，避免重复消费或丢失

## 相关概念
- [MQ 选型对比](MQ选型对比.md) — Kafka vs RabbitMQ vs Pulsar vs NATS 全方位对比
- [NATS 与 JetStream](NATS与JetStream.md) — 轻量级替代方案
- [Outbox 模式](Outbox模式.md) — 数据库与消息队列的最终一致性
- [消息可靠性保障](消息可靠性保障.md) — 幂等消费、死信队列、重试策略

## 常见问题

### Kafka vs Redis Stream？
- Kafka：高吞吐、持久化、分区有序、适合生产级事件流
- Redis Stream：轻量、低延迟、适合中等吞吐异步任务
- 决策：事件量 > 10K/s 或需要持久化保障 → Kafka；轻量异步 → Redis Stream

### 如何实现 Exactly-Once？
1. Producer 端：启用幂等（`enable.idempotence=true`）
2. Consumer 端：幂等消费（数据库唯一约束或幂等键）
3. 跨系统：Kafka 事务 API（read-process-write 模式）
