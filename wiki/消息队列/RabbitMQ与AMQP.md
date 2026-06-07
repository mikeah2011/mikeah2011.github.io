# RabbitMQ 与 AMQP

## 定义
RabbitMQ 是基于 AMQP（Advanced Message Queuing Protocol）的开源消息代理，以灵活的路由、可靠投递、死信队列为核心特征。在 Laravel 中通过 `php-amqplib` 集成，适合需要复杂路由和延迟消息的场景。

## 核心原理

### AMQP 模型
- **Producer**：发送消息到 Exchange
- **Exchange**：路由消息到 Queue，支持多种路由策略
- **Queue**：存储消息的缓冲区
- **Consumer**：从 Queue 消费消息
- **Binding**：Exchange 到 Queue 的路由规则

### Exchange 类型
| 类型 | 路由规则 | 适用场景 |
|------|----------|----------|
| Direct | 精确匹配 Routing Key | 点对点、任务分发 |
| Topic | 通配符匹配（`*` 和 `#`） | 发布订阅、按主题路由 |
| Fanout | 广播到所有绑定 Queue | 事件广播、通知 |
| Headers | 基于消息头匹配 | 复杂路由条件 |

### 关键特性
- **确认机制（ACK）**：消费者确认后才从 Queue 移除消息
- **持久化**：Queue 和消息可持久化到磁盘
- **死信队列（DLX）**：消费失败的消息路由到死信 Exchange
- **延迟消息**：通过 TTL + DLX 实现延迟投递
- **优先级队列**：支持消息优先级排序

## 实战案例

来自博客文章：
- [RabbitMQ 实战：AMQP 协议、死信队列、延迟消息与 Laravel 集成](/2026/06/01/mq/RabbitMQ-AMQP-死信队列-延迟消息-Laravel-集成-对比Redis-Queue选型/) — 死信队列配置、延迟消息实现、与 Redis Queue 对比

### Laravel 集成方式
1. **Queue Driver**：`QUEUE_CONNECTION=rabbitmq`（需 `vladimir-yuldashev/laravel-queue-rabbitmq`）
2. **原生 AMQP**：`php-amqplib/php-amqplib` 直接操作 Exchange/Queue
3. **Horizon 监控**：配合 Laravel Horizon 监控队列状态

### 常见踩坑
1. **消息确认顺序**：异步 ACK 可能导致消息乱序处理
2. **死信循环**：死信消息再次消费失败会循环，需设置重试上限
3. **连接管理**：长连接断开后的重连策略
4. **内存告警**：大量未消费消息导致 Broker 内存压力

## 相关概念
- [MQ 选型对比](MQ选型对比.md) — 与 Kafka/Pulsar/NATS 对比
- [消息可靠性保障](消息可靠性保障.md) — 幂等消费、重试策略
- [Outbox 模式](Outbox模式.md) — 数据库与 MQ 最终一致性
- → [Redis 知识图谱](../Redis/消息队列.md)：Redis Stream 轻量队列

## 常见问题

### RabbitMQ vs Kafka？
- RabbitMQ：传统消息代理，灵活路由，适合任务分发和 RPC
- Kafka：事件流平台，高吞吐持久化，适合事件溯源和日志聚合
- 决策：需要复杂路由和延迟消息 → RabbitMQ；需要高吞吐和事件回放 → Kafka

### 如何实现延迟消息？
1. **TTL + DLX 方式**：消息设置 TTL，过期后路由到死信 Exchange
2. **延迟插件**：`rabbitmq_delayed_message_exchange` 插件原生支持
3. **Laravel 方式**：`dispatch(new Job)->delay(now()->addMinutes(30))`
