---
title: Apache Pulsar 实战：多租户消息系统与 Laravel 集成——对比 Kafka 的下一代事件流平台
date: 2026-06-02 12:00:00
tags: [Apache-Pulsar, Kafka, Laravel, 消息队列, 多租户, 事件流]
keywords: [Apache Pulsar, Laravel, Kafka, 多租户消息系统与, 的下一代事件流平台, 消息队列]
categories: [mq]
description: "Apache Pulsar 多租户消息系统深度实战：计算存储分离架构、BookKeeper 存储层、分层存储与 Geo-Replication。完整对比 Kafka 在多租户、扩缩容、消息模型上的差异，提供 Laravel 集成 Pulsar 客户端的完整代码示例，涵盖消费者组、死信队列、延迟消息等场景，帮你决策 Kafka vs Pulsar 的技术选型。"
cover: https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
---


## 引言：为什么需要下一代消息系统？

Apache Kafka 自 2011 年诞生以来，已成为事件流处理的事实标准。然而，随着云原生架构和多租户 SaaS 的兴起，Kafka 在某些场景下暴露出局限性：

1. **多租户支持不足**：Kafka 的多租户需要通过命名空间 hack 或多集群实现
2. **存储计算耦合**：Broker 既负责计算又存储数据，扩缩容不灵活
3. **运维复杂度高**：ZooKeeper 依赖（KRaft 模式正在改善）
4. **消息队列模式弱**：Kafka 本质是日志系统，不是传统消息队列

Apache Pulsar 由 Yahoo 于 2016 年开发，2018 年捐赠给 Apache 基金会。它采用计算存储分离架构，原生支持多租户，同时兼容队列和流两种消息模型。

本文将深入探讨 Pulsar 的架构原理、核心概念、与 Kafka 的全面对比，以及 Laravel 集成实战。

---

## 第一章：Pulsar 架构原理

### 1.1 计算存储分离

Pulsar 最核心的创新是计算存储分离架构：

```
┌─────────────────────────────────────────────────┐
│                  Pulsar Cluster                  │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Broker 1 │  │ Broker 2 │  │ Broker 3 │      │
│  │ (无状态) │  │ (无状态) │  │ (无状态) │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│       │              │              │             │
│  ┌────┴──────────────┴──────────────┴────┐      │
│  │          Apache BookKeeper            │      │
│  │  ┌────────┐ ┌────────┐ ┌────────┐    │      │
│  │  │Bookie 1│ │Bookie 2│ │Bookie 3│    │      │
│  │  └────────┘ └────────┘ └────────┘    │      │
│  └───────────────────────────────────────┘      │
│                                                  │
│  ┌───────────────────────────────────────┐      │
│  │     Tiered Storage (S3/HDFS/GCS)     │      │
│  └───────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

**与 Kafka 的关键区别：**

| 维度 | Kafka | Pulsar |
|------|-------|--------|
| 架构 | 计算存储耦合 | 计算存储分离 |
| 存储层 | Broker 本地磁盘 | BookKeeper |
| 扩展 | Broker 扩展需数据迁移 | Broker 无状态，即时扩展 |
| 数据均衡 | 需要手动 Rebalance | 自动负载均衡 |

### 1.2 BookKeeper 存储层

Apache BookKeeper 是 Pulsar 的存储层，提供：

```
Topic: orders
├── Partition 0
│   ├── Segment 1 (Bookie A)
│   ├── Segment 2 (Bookie B)
│   └── Segment 3 (Bookie C)
├── Partition 1
│   ├── Segment 1 (Bookie B)
│   ├── Segment 2 (Bookie C)
│   └── Segment 3 (Bookie A)
└── Partition 2
    ├── Segment 1 (Bookie C)
    ├── Segment 2 (Bookie A)
    └── Segment 3 (Bookie B)
```

**BookKeeper 的优势：**
- 每个 Segment 可以存储在不同的 Bookie 上
- 自动数据复制（默认 3 副本）
- 顺序写入，高吞吐
- Segment 级别的并行读写

### 1.3 分层存储

Pulsar 支持将冷数据自动迁移到对象存储：

```bash
# 配置分层存储
bin/pulsar-admin tenants update my-tenant \
  --allowed-clusters us-east \
  --admin-roles admin-role

# 配置卸载策略
bin/pulsar-admin namespaces set-offload-threshold my-tenant/my-ns \
  --size 10G  # 超过 10GB 卸载到 S3

# 配置 S3 存储
bin/pulsar-admin namespaces set-offload-policies my-tenant/my-ns \
  --offload-deletion-lag 7d \
  --s3-bucket my-pulsar-offload \
  --s3-region us-east-1
```

---

## 第二章：Pulsar 核心概念

### 2.1 多租户模型

Pulsar 的多租户是原生支持的：

```
Pulsar Cluster
├── Tenant: company-a
│   ├── Namespace: production
│   │   ├── Topic: orders
│   │   └── Topic: payments
│   └── Namespace: staging
│       └── Topic: orders
├── Tenant: company-b
│   ├── Namespace: production
│   │   └── Topic: events
│   └── Namespace: development
│       └── Topic: test
```

**层级结构：**
- **Tenant（租户）**：最高层级，代表一个组织或团队
- **Namespace（命名空间）**：租户下的逻辑分组
- **Topic（主题）**：消息的实际载体

```bash
# 创建租户
bin/pulsar-admin tenants create my-company \
  --admin-roles admin1,admin2 \
  --allowed-clusters us-east,us-west

# 创建命名空间
bin/pulsar-admin namespaces create my-company/production

# 设置配额
bin/pulsar-admin namespaces set-deduplication my-company/production --enable
bin/pulsar-admin namespaces set-persistence my-company/production \
  --bookkeeper-ensemble 3 \
  --bookkeeper-write-quorum 3 \
  --bookkeeper-ack-quorum 2 \
  --ml-mark-delete-max-rate 0
```

### 2.2 Topic 类型

Pulsar 支持三种 Topic 类型：

#### Exclusive（独占模式）

```python
# 只有一个消费者可以订阅
consumer = client.subscribe(topic, subscription_name='my-sub',
                           consumer_type=pulsar.ConsumerType.Exclusive)
```

#### Shared（共享模式）

```python
# 多个消费者共享订阅，消息轮询分发
consumer = client.subscribe(topic, subscription_name='my-sub',
                           consumer_type=pulsar.ConsumerType.Shared)
```

#### Key_Shared（键共享模式）

```python
# 相同 key 的消息总是发送给同一个消费者
consumer = client.subscribe(topic, subscription_name='my-sub',
                           consumer_type=pulsar.ConsumerType.Key_Shared)
```

### 2.3 Subscription 类型

```
Topic: orders
├── Subscription: email-service (Exclusive)
│   └── Consumer: email-worker-1
├── Subscription: inventory-service (Shared)
│   ├── Consumer: inventory-worker-1
│   ├── Consumer: inventory-worker-2
│   └── Consumer: inventory-worker-3
├── Subscription: analytics (Failover)
│   ├── Consumer: analytics-primary
│   └── Consumer: analytics-backup
└── Subscription: audit (Key_Shared)
    ├── Consumer: audit-worker-1 (key: user-1, user-3)
    └── Consumer: audit-worker-2 (key: user-2, user-4)
```

```python
import pulsar

client = pulsar.Client('pulsar://localhost:6650')

# 生产者
producer = client.create_producer('persistent://my-company/production/orders')

for order in orders:
    producer.send(
        json.dumps(order).encode('utf-8'),
        partition_key=str(order['user_id']),  # 用于 Key_Shared
        properties={
            'order_type': order['type'],
            'priority': str(order['priority']),
        }
    )

# 消费者（Shared 模式）
consumer = client.subscribe(
    'persistent://my-company/production/orders',
    subscription_name='order-processor',
    consumer_type=pulsar.ConsumerType.Shared,
    negative_ack_redelivery_delay_ms=5000,
    ack_timeout_millis=30000,
)

while True:
    msg = consumer.receive(timeout_millis=1000)
    try:
        process_order(json.loads(msg.data().decode('utf-8')))
        consumer.acknowledge(msg)
    except Exception as e:
        consumer.negative_acknowledge(msg)  # 重新投递
```

### 2.4 消息路由与分区

```python
# 自定义消息路由
class OrderRouter(pulsar.PartitionRoutingPolicy):
    def get_partition(self, message, topic_metadata):
        order_type = message.properties().get('order_type', 'default')
        
        if order_type == 'vip':
            return 0  # VIP 订单路由到分区 0
        elif order_type == 'international':
            return 1  # 国际订单路由到分区 1
        else:
            return random.randint(2, topic_metadata.num_partitions - 1)

producer = client.create_producer(
    'persistent://my-company/production/orders',
    message_routing_mode=pulsar.PartitionRoutingMode.CustomPartition,
    custom_partition_router=OrderRouter()
)
```

---

## 第三章：Pulsar Functions

### 3.1 Pulsar Functions 概述

Pulsar Functions 是轻量级计算框架，类似于 Kafka Streams 但更简单：

```python
# 简单的过滤函数
def filter_vip_orders(message):
    order = json.loads(message.data().decode('utf-8'))
    
    if order.get('user_type') == 'vip':
        return json.dumps(order)  # 输出到下一个 Topic
    else:
        return None  # 过滤掉

# 部署函数
"""
bin/pulsar-admin functions create \
  --py filter_vip.py \
  --classname filter_vip_orders \
  --inputs persistent://my-company/production/orders \
  --output persistent://my-company/production/vip-orders \
  --name vip-filter
"""

# 窗口聚合函数
from pulsar.functions import Context

def aggregate_order_amount(message, context: Context):
    order = json.loads(message.data().decode('utf-8'))
    amount = order['amount']
    
    # 使用 Pulsar 的 Counter 状态管理
    current = context.get_counter('total_amount') or 0
    context.incr_counter('total_amount', amount)
    
    count = context.get_counter('order_count') or 0
    context.incr_counter('order_count', 1)
    
    # 每 100 个订单输出一次汇总
    if count % 100 == 0:
        context.publish(
            'persistent://my-company/production/order-stats',
            json.dumps({
                'total_amount': current + amount,
                'order_count': count + 1,
                'average_amount': (current + amount) / (count + 1),
            }).encode('utf-8')
        )
```

### 3.2 Pulsar Functions vs Kafka Streams

| 特性 | Pulsar Functions | Kafka Streams |
|------|-----------------|---------------|
| 部署模型 | 独立部署（容器/进程） | 嵌入应用 |
| 状态管理 | 内置 Counter/State | RocksDB 本地状态 |
| 窗口支持 | 简单窗口 | 丰富窗口类型 |
| 编程语言 | Java/Python/Go | Java |
| 学习曲线 | 低 | 中等 |
| 适用场景 | 简单 ETL/过滤/路由 | 复杂流处理 |

---

## 第四章：与 Kafka 全面对比

### 4.1 架构对比

| 维度 | Kafka | Pulsar |
|------|-------|--------|
| 架构模式 | 计算存储耦合 | 计算存储分离 |
| 存储层 | Broker 本地磁盘 | BookKeeper |
| 元数据管理 | KRaft / ZooKeeper | ZooKeeper / etcd |
| 多租户 | 命名空间 hack | 原生支持 |
| 消息模型 | 日志追加 | 队列 + 流 |
| 消息确认 | 偏移量提交 | 独立 ACK |
| 消息回溯 | 按偏移量/时间 | 按时间/消息 ID |
| 分层存储 | 需要额外配置 | 原生支持 |
| 跨地域复制 | MirrorMaker | 原生 Geo-Replication |

### 4.2 消息模型对比

**Kafka 的日志模型：**
```
Topic: orders (Partition 0)
[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, ...]
 ↑              ↑              ↑
Consumer A     Consumer B     Consumer C
(offset: 0)    (offset: 4)    (offset: 8)

特点：
- 消费者通过偏移量追踪进度
- 消息不会被删除（保留期策略）
- 多个消费者组可以独立消费
```

**Pulsar 的队列+流模型：**
```
Topic: orders
├── Subscription A (流模式 - Exclusive)
│   └── Consumer: analytics-service
├── Subscription B (队列模式 - Shared)
│   ├── Consumer: worker-1 (pending: msg-3, msg-6)
│   ├── Consumer: worker-2 (pending: msg-4, msg-7)
│   └── Consumer: worker-3 (pending: msg-5)
└── Subscription C (键共享模式 - Key_Shared)
    ├── Consumer: shard-1 (key: user-1, user-3)
    └── Consumer: shard-2 (key: user-2, user-4)

特点：
- 消息可以被独立确认
- 支持延迟消息和死信队列
- 同时支持流和队列两种消费模式
```

### 4.3 性能对比

基于典型场景的基准测试（3 节点集群，3 副本）：

| 场景 | Kafka | Pulsar |
|------|-------|--------|
| 发布吞吐量（MB/s） | 200 | 180 |
| 消费吞吐量（MB/s） | 250 | 220 |
| P99 发布延迟 | 5ms | 8ms |
| P99 消费延迟 | 2ms | 3ms |
| 队列模式吞吐量 | N/A | 150K msg/s |
| 100 个消费者组 | 性能下降 30% | 性能下降 10% |
| 扩展到 1000 Topic | 需要 Rebalance | 即时生效 |

### 4.4 运维对比

| 维度 | Kafka | Pulsar |
|------|-------|--------|
| 组件数量 | Broker + KRaft/ZK | Broker + BookKeeper + ZK |
| 扩容复杂度 | 高（需要数据迁移） | 低（无状态 Broker） |
| 数据均衡 | 手动/自动 Rebalance | 自动负载均衡 |
| 监控工具 | JMX + 第三方 | Prometheus 原生集成 |
| 跨地域复制 | MirrorMaker 2 | 内置 Geo-Replication |
| 升级影响 | 需要滚动重启 | Broker 无状态，影响小 |

---

## 第五章：Laravel 集成

### 5.1 PHP 客户端选择

Pulsar 官方提供 Java/Python/C++/Go 客户端，PHP 需要使用社区库或 REST API：

**方案一：使用 REST API（推荐）**

```php
// app/Services/PulsarClient.php
class PulsarClient
{
    private string $baseUrl;
    private string $token;
    private HttpClient $http;
    
    public function __construct()
    {
        $this->baseUrl = config('pulsar.http_url', 'http://localhost:8080');
        $this->token = config('pulsar.token');
        $this->http = Http::withHeaders([
            'Authorization' => "Bearer {$this->token}",
            'Content-Type'  => 'application/json',
        ])->baseUrl($this->baseUrl);
    }
    
    public function publish(string $topic, array $message, array $properties = []): array
    {
        $payload = [
            'payload'     => base64_encode(json_encode($message)),
            'properties'  => $properties,
            'key'         => $message['key'] ?? null,
            'eventTime'   => microtime(true) * 1000,
        ];
        
        $response = $this->http->post("/topics/{$topic}/publish", $payload);
        
        return $response->json();
    }
    
    public function consume(string $topic, string $subscription, int $maxMessages = 10): array
    {
        $response = $this->http->get(
            "/topics/{$topic}/subscription/{$subscription}/receive",
            ['maxMessages' => $maxMessages]
        );
        
        return collect($response->json())->map(function ($msg) {
            return [
                'messageId' => $msg['messageId'],
                'data'      => json_decode(base64_decode($msg['data']), true),
                'properties'=> $msg['properties'] ?? [],
            ];
        })->toArray();
    }
    
    public function acknowledge(string $topic, string $subscription, string $messageId): void
    {
        $this->http->post(
            "/topics/{$topic}/subscription/{$subscription}/acknowledge/{$messageId}"
        );
    }
    
    public function negativeAcknowledge(string $topic, string $subscription, string $messageId): void
    {
        $this->http->post(
            "/topics/{$topic}/subscription/{$subscription}/negativeAcknowledge/{$messageId}"
        );
    }
}
```

**方案二：使用 Pulsar PHP 扩展**

```php
// 安装：pecl install pulsar
$pulsar = new \Pulsar\Client('pulsar://localhost:6650');

// 生产者
$producer = $pulsar->createProducer('persistent://my-company/production/orders');
$producer->send(json_encode($order));

// 消费者
$consumer = $pulsar->subscribe(
    'persistent://my-company/production/orders',
    'order-processor',
    \Pulsar\ConsumerType::SHARED
);

while ($msg = $consumer->receive(1000)) {
    try {
        processOrder(json_decode($msg->getData(), true));
        $consumer->acknowledge($msg);
    } catch (\Exception $e) {
        $consumer->negativeAcknowledge($msg);
    }
}
```

### 5.2 Laravel Queue 驱动

创建自定义 Pulsar Queue 驱动：

```php
// app/Queue/PulsarQueue.php
class PulsarQueue extends Queue
{
    private PulsarClient $client;
    
    public function size($queue = null): int
    {
        $topic = $this->getTopic($queue);
        return $this->client->getStats($topic)['msgInCounter'] ?? 0;
    }
    
    public function push($job, $data = '', $queue = null): mixed
    {
        return $this->pushRaw($this->createPayload($job, $data), $queue);
    }
    
    public function pushRaw($payload, $queue = null, array $options = []): mixed
    {
        $topic = $this->getTopic($queue);
        
        $result = $this->client->publish($topic, [
            'job'     => $payload,
            'attempts'=> 0,
        ], [
            'queue'   => $queue ?? 'default',
            'delay'   => $options['delay'] ?? 0,
        ]);
        
        return $result['messageId'];
    }
    
    public function later($delay, $job, $data = '', $queue = null): mixed
    {
        $payload = $this->createPayload($job, $data);
        
        return $this->pushRaw($payload, $queue, [
            'delay' => $this->getSeconds($delay),
        ]);
    }
    
    public function pop($queue = null): ?Job
    {
        $topic = $this->getTopic($queue);
        $subscription = $this->getSubscription($queue);
        
        $messages = $this->client->consume($topic, $subscription, 1);
        
        if (empty($messages)) {
            return null;
        }
        
        $msg = $messages[0];
        
        return new PulsarJob(
            $this->container,
            $this->client,
            $msg,
            $topic,
            $subscription,
            $queue
        );
    }
    
    private function getTopic(?string $queue): string
    {
        return config('pulsar.namespace') . '/' . ($queue ?? config('pulsar.queue'));
    }
    
    private function getSubscription(?string $queue): string
    {
        return ($queue ?? config('pulsar.queue')) . '-subscription';
    }
}
```

```php
// app/Queue/Jobs/PulsarJob.php
class PulsarJob extends Job
{
    private PulsarClient $client;
    private array $message;
    private string $topic;
    private string $subscription;
    
    public function getRawBody(): string
    {
        return $this->message['data']['job'];
    }
    
    public function attempts(): int
    {
        return $this->message['data']['attempts'] ?? 1;
    }
    
    public function delete(): void
    {
        parent::delete();
        $this->client->acknowledge(
            $this->topic,
            $this->subscription,
            $this->message['messageId']
        );
    }
    
    public function release($delay = 0): void
    {
        parent::release($delay);
        
        $this->client->negativeAcknowledge(
            $this->topic,
            $this->subscription,
            $this->message['messageId']
        );
    }
}
```

### 5.3 配置文件

```php
// config/pulsar.php
return [
    'http_url'   => env('PULSAR_HTTP_URL', 'http://localhost:8080'),
    'service_url'=> env('PULSAR_SERVICE_URL', 'pulsar://localhost:6650'),
    'token'      => env('PULSAR_TOKEN'),
    
    'tenant'     => env('PULSAR_TENANT', 'my-company'),
    'namespace'  => env('PULSAR_NAMESPACE', 'persistent://my-company/production'),
    'queue'      => env('PULSAR_QUEUE', 'default'),
    
    'consumer' => [
        'subscription_type'     => 'shared',
        'negative_ack_delay'    => 5000,  // 5 秒后重新投递
        'ack_timeout'           => 30000, // 30 秒超时
        'max_messages'          => 10,
    ],
    
    'dead_letter' => [
        'max_redeliver_count' => 3,
        'retry_letter_topic'  => 'persistent://my-company/production/retry',
        'dead_letter_topic'   => 'persistent://my-company/production/dead-letter',
    ],
];
```

---

## 第六章：Pulsar 高级特性

### 6.1 Geo-Replication（跨地域复制）

```bash
# 启用跨地域复制
bin/pulsar-admin clusters create us-east \
  --broker-url pulsar://us-east-broker:6650 \
  --url http://us-east-broker:8080

bin/pulsar-admin clusters create eu-west \
  --broker-url pulsar://eu-west-broker:6650 \
  --url http://eu-west-broker:8080

# 配置租户的可用集群
bin/pulsar-admin tenants update my-company \
  --allowed-clusters us-east,eu-west

# 异步复制（默认）
# 生产者在本地集群写入，异步复制到其他集群

# 同步复制（强一致性）
producer = client.create_producer(
    topic,
    send_timeout_millis=30000,
    batching_enabled=False,
    message_routing_mode=pulsar.PartitionRoutingMode.RoundRobinDistribution
)
```

### 6.2 延迟消息

```python
# Pulsar 原生支持延迟消息
producer = client.create_producer(
    'persistent://my-company/production/orders',
    # 启用延迟投递
)

# 延迟 30 分钟
producer.send(
    json.dumps(order).encode('utf-8'),
    deliver_after=30 * 60 * 1000  # 毫秒
)

# 指定投递时间
from datetime import datetime, timedelta
deliver_at = datetime.now() + timedelta(hours=1)

producer.send(
    json.dumps(order).encode('utf-8'),
    deliver_at=deliver_at.timestamp() * 1000
)
```

### 6.3 死信队列

```python
# 配置死信队列
consumer = client.subscribe(
    'persistent://my-company/production/orders',
    'order-processor',
    consumer_type=pulsar.ConsumerType.Shared,
    
    # 死信队列配置
    dead_letter_policy=pulsar.ConsumerDeadLetterPolicy(
        max_redeliver_count=3,
        dead_letter_topic='persistent://my-company/production/orders-DLQ',
        retry_letter_topic='persistent://my-company/production/orders-RETRY',
        initial_subscription_name='dlq-subscription',
        # 初始订阅名（用于首次创建 DLQ topic 时创建的订阅）
    ),
    
    # 重试延迟
    negative_ack_redelivery_delay_ms=5000,
)

# 消费死信消息
dlq_consumer = client.subscribe(
    'persistent://my-company/production/orders-DLQ',
    'dlq-processor',
    consumer_type=pulsar.ConsumerType.Exclusive,
)

while True:
    msg = dlq_consumer.receive()
    try:
        # 记录死信消息
        log_dead_letter(msg)
        dlq_consumer.acknowledge(msg)
    except Exception:
        pass
```

### 6.4 Schema Registry

```python
from pulsar.schema import *

# 定义 Avro Schema
class OrderRecord(Record):
    order_id = String()
    user_id = String()
    amount = Double()
    items = Array(String())
    created_at = Long()

# 使用 Schema 创建生产者
producer = client.create_producer(
    'persistent://my-company/production/orders',
    schema=AvroSchema(OrderRecord),
)

# 发送消息（自动序列化）
order = OrderRecord(
    order_id='12345',
    user_id='user-1',
    amount=99.99,
    items=['item-1', 'item-2'],
    created_at=int(datetime.now().timestamp() * 1000),
)
producer.send(order)

# 使用 Schema 创建消费者（自动反序列化）
consumer = client.subscribe(
    'persistent://my-company/production/orders',
    'order-processor',
    schema=AvroSchema(OrderRecord),
)

msg = consumer.receive()
order = msg.value()  # 自动反序列化为 OrderRecord
consumer.acknowledge(msg)
```

---

## 第七章：生产环境部署

### 7.1 Docker Compose 部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ZooKeeper (Pulsar 依赖)
  zookeeper:
    image: apachepulsar/pulsar:3.3.0
    command: bin/pulsar zookeeper
    environment:
      ZK_SERVERS: zookeeper
    ports:
      - "2181:2181"
    volumes:
      - zk-data:/pulsar/data/zookeeper

  # BookKeeper
  bookie:
    image: apachepulsar/pulsar:3.3.0
    command: bin/pulsar bookie
    environment:
      BOOKIE_MEM: "-Xms512m -Xmx512m -XX:MaxDirectMemorySize=512m"
      clusterName: pulsar-cluster-1
      zkServers: zookeeper:2181
    depends_on:
      - zookeeper
    volumes:
      - bookie-data:/pulsar/data/bookkeeper

  # Pulsar Broker
  broker:
    image: apachepulsar/pulsar:3.3.0
    command: bin/pulsar broker
    environment:
      PULSAR_MEM: "-Xms512m -Xmx512m -XX:MaxDirectMemorySize=512m"
      clusterName: pulsar-cluster-1
      zookeeperServers: zookeeper:2181
      configurationStoreServers: zookeeper:2181
    ports:
      - "6650:6650"  # Pulsar protocol
      - "8080:8080"  # HTTP admin API
    depends_on:
      - zookeeper
      - bookie

  # Pulsar Manager (可选)
  manager:
    image: apachepulsar/pulsar-manager:latest
    ports:
      - "9527:9527"
    environment:
      SPRING_CONFIGURATION_FILE: /pulsar-manager/pulsar-manager/application.properties
    depends_on:
      - broker

volumes:
  zk-data:
  bookie-data:
```

### 7.2 Kubernetes 部署（使用 Helm）

```bash
# 添加 Helm 仓库
helm repo add apache https://pulsar.apache.org/charts
helm repo update

# 安装 Pulsar
helm install pulsar apache/pulsar \
  --set initialize=true \
  --set components.functions=true \
  --set components.pulsar_manager=true \
  --set zookeeper.replicaCount=3 \
  --set bookkeeper.replicaCount=3 \
  --set broker.replicaCount=3 \
  --set bookkeeper.configData.PULSAR_MEM="-Xms4g -Xmx4g -XX:MaxDirectMemorySize=4g" \
  --set broker.configData.PULSAR_MEM="-Xms4g -Xmx4g -XX:MaxDirectMemorySize=4g"
```

### 7.3 监控配置

```yaml
# Prometheus 配置
scrape_configs:
  - job_name: 'pulsar-brokers'
    static_configs:
      - targets: ['broker-1:8080', 'broker-2:8080', 'broker-3:8080']
    metrics_path: /metrics

  - job_name: 'pulsar-bookkeepers'
    static_configs:
      - targets: ['bookie-1:8080', 'bookie-2:8080', 'bookie-3:8080']
    metrics_path: /metrics

# Grafana Dashboard
# 推荐使用 Apache Pulsar 官方 Grafana Dashboard
# https://github.com/apache/pulsar/tree/master/grafana
```

```php
// Laravel Pulsar 监控
class PulsarMonitor
{
    public function collectMetrics(): array
    {
        $stats = Http::get('http://broker:8080/admin/v2/persistent/my-company/production/orders/stats');
        
        return [
            'msg_in_rate'       => $stats['msgRateIn'],
            'msg_out_rate'      => $stats['msgRateOut'],
            'msg_throughput_in' => $stats['msgThroughputIn'],
            'msg_throughput_out'=> $stats['msgThroughputOut'],
            'storage_size'      => $stats['storageSize'],
            'publishers'        => $stats['publishers'],
            'consumers'         => collect($stats['subscriptions'])->sum(fn($s) => count($s['consumers'])),
            'backlog'           => collect($stats['subscriptions'])->sum(fn($s) => $s['msgBacklog']),
        ];
    }
    
    public function checkAlerts(): void
    {
        $metrics = $this->collectMetrics();
        
        if ($metrics['backlog'] > 10000) {
            Alert::warning("Pulsar backlog is {$metrics['backlog']}");
        }
        
        if ($metrics['consumers'] === 0) {
            Alert::critical("Pulsar topic has no consumers");
        }
    }
}
```

---

## 第八章：Kafka 迁移指南

### 8.1 迁移策略

从 Kafka 迁移到 Pulsar 可以采用以下策略：

**策略一：双写双读（推荐）**

```php
class DualWriteProducer
{
    private KafkaProducer $kafka;
    private PulsarClient $pulsar;
    
    public function publish(string $topic, array $message): void
    {
        // 阶段 1：双写
        $this->kafka->publish($topic, $message);
        $this->pulsar->publish($topic, $message);
        
        // 阶段 2：Pulsar 为主，Kafka 为备份
        // $this->pulsar->publish($topic, $message);
        
        // 阶段 3：完全迁移到 Pulsar
        // $this->pulsar->publish($topic, $message);
    }
}

class DualReadConsumer
{
    public function consume(string $topic): array
    {
        // 同时从两个系统消费
        $kafkaMessages = $this->kafka->consume($topic);
        $pulsarMessages = $this->pulsar->consume($topic);
        
        // 去重并合并
        return $this->deduplicate(array_merge($kafkaMessages, $pulsarMessages));
    }
}
```

**策略二：MirrorMaker 迁移**

```bash
# 使用 Pulsar 的 Kafka Connect 插件
# 先从 Kafka 复制数据到 Pulsar，再切换消费者

# 1. 部署 Kafka Connect with Pulsar Connector
# 2. 配置 MirrorSourceConnector
# 3. 切换消费者到 Pulsar
# 4. 切换生产者到 Pulsar
# 5. 停止 MirrorMaker
```

### 8.2 API 兼容性

Pulsar 提供 Kafka 协议兼容层：

```bash
# 启用 KoP（Kafka on Pulsar）
bin/pulsar-admin namespaces set-persistence my-company/production \
  --bookkeeper-ensemble 3 \
  --bookkeeper-write-quorum 3 \
  --bookkeeper-ack-quorum 2

# 配置 KoP
# 在 broker.conf 中添加：
kafkaListeners=kafka://0.0.0.0:9092
kafkaAdvertisedListeners=kafka://broker:9092

# 使用 Kafka 客户端连接 Pulsar
# PHP 生产者（使用 php-rdkafka）
$conf = new \RdKafka\Conf();
$conf->set('metadata.broker.list', 'localhost:9092');

$producer = new \RdKafka\Producer($conf);
$topic = $producer->newTopic('orders');
$topic->produce(RD_KAFKA_PARTITION_UA, 0, json_encode($order));
$producer->flush(10000);
```

---

## 第九章：选型决策

### 9.1 选择 Pulsar 的场景

1. **多租户 SaaS**：原生多租户支持，无需额外架构
2. **云原生部署**：计算存储分离，易于 K8s 部署和扩缩容
3. **混合消息模型**：同时需要队列和流两种消费模式
4. **跨地域部署**：内置 Geo-Replication
5. **冷数据归档**：原生分层存储支持

### 9.2 选择 Kafka 的场景

1. **生态系统成熟**：Kafka Streams、Connect、ksqlDB
2. **团队经验**：Kafka 社区更大，文档更丰富
3. **极低延迟**：Kafka 的 P99 延迟略低于 Pulsar
4. **已有基础设施**：迁移成本高
5. **流处理密集**：Kafka Streams 生态更成熟

### 9.3 决策矩阵

| 需求 | 推荐 |
|------|------|
| 多租户 SaaS | ✅ Pulsar |
| 云原生 K8s | ✅ Pulsar |
| 混合队列+流 | ✅ Pulsar |
| 跨地域复制 | ✅ Pulsar |
| 极低延迟 | ✅ Kafka |
| 成熟生态 | ✅ Kafka |
| 团队熟悉 | 看团队 |
| 已有基础设施 | 看现状 |

---

## 第十章：总结

### 10.1 Pulsar 的核心优势

1. **计算存储分离**：独立扩展 Broker 和 BookKeeper
2. **原生多租户**：Tenant → Namespace → Topic 三层隔离
3. **混合消息模型**：同时支持队列和流消费模式
4. **分层存储**：冷数据自动归档到对象存储
5. **Geo-Replication**：内置跨地域复制

### 10.2 Pulsar 的不足

1. **组件复杂度**：需要 ZooKeeper + BookKeeper + Broker
2. **社区规模**：相比 Kafka 较小
3. **PHP 生态**：官方不提供 PHP 客户端
4. **学习曲线**：概念较多，上手需要时间

### 10.3 最终建议

- 如果你正在构建多租户 SaaS 平台，Pulsar 是更好的选择
- 如果你需要成熟的生态系统和社区支持，选择 Kafka
- 如果你已经在使用 Kafka，可以考虑渐进式迁移
- 无论选择哪个，都要深入理解其架构和最佳实践

---

## 参考资料

1. [Apache Pulsar Official Documentation](https://pulsar.apache.org/docs/)
2. [Pulsar vs Kafka](https://pulsar.apache.org/docs/concepts-overview/)
3. [Apache BookKeeper Documentation](https://bookkeeper.apache.org/docs/)
4. [Pulsar Geo-Replication](https://pulsar.apache.org/docs/geo-replication/)
5. [Laravel Queue Documentation](https://laravel.com/docs/queues)
6. [KoP - Kafka on Pulsar](https://github.com/streamnative/kop)

## 相关阅读

- [RabbitMQ 实战：AMQP 协议、死信队列、延迟消息与 Laravel 集成——对比 Redis Queue 的选型决策](/categories/mq/RabbitMQ-AMQP-死信队列-延迟消息-Laravel-集成-对比Redis-Queue选型/)
- [Redis Stream 实战：消息队列替代方案与消费者组管理 Laravel 踩坑记录](/categories/databases/redis-stream-guide-laravel/)
- [Laravel-Kafka 消息队列异步解耦实战——KKday B2C API 订单处理与库存扣减真实踩坑记录](/categories/mq/Kafka/laravel-kafka-guide/)
