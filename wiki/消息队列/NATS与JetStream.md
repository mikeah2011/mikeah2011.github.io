# NATS 与 JetStream

## 定义
NATS 是轻量级、高性能的消息系统，JetStream 是 NATS 的持久化和流处理层。在 Laravel 微服务中适合事件通知、配置同步、IoT 数据采集等场景。

## 核心原理

### NATS 核心
- **Subject-Based Messaging**：基于主题的发布订阅
- **At-Most-Once**：核心 NATS 不保证消息持久化
- **极低延迟**：微秒级消息传递
- **轻量部署**：单二进制文件，资源占用极低

### JetStream 扩展
- **持久化**：消息持久化到流（Stream）
- **消费者组**：支持推/拉两种消费模式
- **At-Least-Once / Exactly-Once**：消息确认保障
- **KV 存储**：内置键值存储，适合配置同步
- **对象存储**：NATS Object Store

### 关键特性
- **Queue Groups**：类似 Kafka Consumer Group，负载均衡消费
- **请求回复**：原生支持 Request-Reply 模式
- **集群与超集群**：支持多数据中心部署
- **Leaf Nodes**：边缘节点连接中心集群

## 实战案例

来自博客文章：
- [Laravel + NATS JetStream 实战：订单通知削峰、Ack 重投与 KV 配置同步踩坑记录](/2026/06/01/php/Laravel/laravel-nats-jetstream-guide-ackkv/) — 订单通知削峰、Ack 重投、KV 配置同步
- [事件驱动架构全景实战：EventBridge/NATS/Pulsar 统一事件总线设计](/2026/06/01/事件驱动架构全景实战-EventBridge-NATS-Pulsar-统一事件总线设计/) — 从点对点到发布订阅的演进
- [Kafka vs NATS vs Pulsar 2026 实战](/2026/06/01/kafka-vs-nats-vs-pulsar-2026-laravel-microservice-mq-comparison/) — 三大消息队列深度对比

### Laravel 集成方式
1. **PHP 客户端**：`basjan/nats-php` 或 `chooglesoft/nats.php`
2. **Laravel Queue Driver**：社区包支持 `QUEUE_CONNECTION=nats`
3. **直接操作**：发布事件到 Subject，消费端订阅处理

### KV 配置同步场景
```
# 发布配置变更
$nc->publish('config.updated', json_encode(['key' => 'feature_flag', 'value' => true]));

# 订阅配置变更
$nc->subscribe('config.updated', function ($msg) {
    Cache::put('feature_flag', json_decode($msg->body)->value);
});
```

### 常见踩坑
1. **消息丢失**：核心 NATS 不持久化，需 JetStream 保障
2. **消费者重平衡**：Queue Group 成员变化时的消费中断
3. **内存压力**：大量未确认消息导致 Stream 内存增长

## 相关概念
- [MQ 选型对比](MQ选型对比.md) — 与 Kafka/RabbitMQ/Pulsar 对比
- [消息可靠性保障](消息可靠性保障.md) — 幂等消费、重试策略
- → [PHP-Laravel 知识图谱](../PHP-Laravel/部署与运维.md)：NATS JetStream 部署配置

## 常见问题

### NATS vs Kafka？
- NATS：轻量、低延迟、适合微服务间通信和 IoT
- Kafka：高吞吐、持久化、适合事件流和日志聚合
- 决策：延迟敏感、轻量部署 → NATS；事件回放、高吞吐 → Kafka

### 何时选择 JetStream？
- 需要消息持久化
- 需要消费者组和 ACK
- 需要 KV 存储或对象存储
- 需要 Exactly-Once 语义
