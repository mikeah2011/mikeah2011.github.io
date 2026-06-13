---

title: Kafka 入门：分区、副本、消费者组与高吞吐消息架构
keywords: [Kafka, 分区, 副本, 消费者组与高吞吐消息架构, 消息队列]
cover: https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
tags:
- Kafka
- 消息队列
- 消息中间件
- PHP
- Laravel
- 分布式
- 高吞吐
categories:
  - mq
date: 2019-03-20 15:05:07
description: 深入解析Apache Kafka消息队列核心架构与原理：Broker集群、Topic与Partition分区机制、Consumer Group消费组与Rebalance重平衡、Producer生产者分区策略与acks确认机制。附PHP/Laravel实战代码示例，涵盖消息顺序性保证、死信队列DLQ处理、Exactly-Once语义、监控运维方案与生产环境踩坑案例总结，帮助后端工程师全面掌握Kafka高吞吐异步解耦架构设计。
---


## 一、为什么需要 Kafka？

在现代分布式系统架构中，消息队列（Message Queue）是实现**异步解耦**、**流量削峰**和**数据缓冲**的核心基础设施。Apache Kafka 作为 LinkedIn 于 2011 年开源的分布式流处理平台，凭借其**超高吞吐量**（单集群可达百万级 TPS）、**持久化存储**和**水平扩展**能力，已成为大数据与微服务架构中最受欢迎的消息中间件之一。

使用 `kafka` 可以对系统实现**解耦**、**流量削峰**、**缓冲**，并支持系统间的异步通信。

Kafka 的典型应用场景包括：

- **活动追踪（Activity Tracking）**：用户行为日志实时采集与分析
- **消息传递（Messaging）**：微服务间的异步通信与事件驱动架构
- **度量指标（Metrics）**：系统监控数据的聚合与传输
- **日志聚合（Log Aggregation）**：集中收集分布式系统的运行日志
- **流处理（Stream Processing）**：实时数据流的处理与转换（配合 Kafka Streams / Flink）
- **事件溯源（Event Sourcing）**：配合 CDC（Change Data Capture）实现数据库变更事件流

在活动追踪、消息传递、度量指标、日志记录和流式处理等场景中非常适合使用 `kafka`。

![图片](/images/640.png)

## 二、Kafka 整体架构

### 2.1 架构全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Kafka Cluster                                │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                         │
│  │ Broker 0 │  │ Broker 1 │  │ Broker 2 │    ...                  │
│  │          │  │          │  │          │                         │
│  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │                         │
│  │ │P0(L)│ │  │ │P1(L)│ │  │ │P2(L)│ │    Topic: order-events   │
│  │ │P2(F)│ │  │ │P0(F)│ │  │ │P1(F)│ │    Partition 0,1,2        │
│  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │                         │
│  └──────────┘  └──────────┘  └──────────┘                         │
│         ▲              ▲              ▲                             │
│         │              │              │                             │
└─────────┼──────────────┼──────────────┼─────────────────────────────┘
          │              │              │
   ┌──────┴──────┐       │       ┌──────┴──────┐
   │  Producer   │       │       │  Producer   │
   │ (OrderSvc)  │       │       │ (PaySvc)    │
   └─────────────┘       │       └─────────────┘
                         │
              ┌──────────┴──────────┐
              │   Consumer Group    │
              │  ┌─────┐  ┌─────┐  │
              │  │ C0  │  │ C1  │  │   每个 Consumer
              │  │P0,P1│  │P2   │  │   独占一个 Partition
              │  └─────┘  └─────┘  │
              └─────────────────────┘
```

### 2.2 核心组件详解

| 组件 | 释义 | 备注 |
| --- | --- | --- |
| **Broker** | 服务代理节点 | 其实就是一个 Kafka 实例或服务节点，多个 Broker 构成了 Kafka Cluster |
| **Producer** | 生产者 | 也就是写入消息的一方，将消息写入 Broker 中 |
| **Consumer** | 消费者 | 也就是读取消息的一方，从 Broker 中读取消息 |
| **Consumer Group** | 消费组 | 一个或多个消费者构成一个消费组，不同的消费组可以订阅同一个主题的消息且互不影响 |
| **ZooKeeper / KRaft** | 集群协调 | Kafka 使用 ZooKeeper 来管理集群元数据与控制器选举；Kafka 3.3+ 已支持 KRaft 模式替代 ZooKeeper |
| **Topic** | 主题 | 每一个消息都属于某个主题，Kafka 通过主题来划分消息，是一个逻辑上的分类 |
| **Partition** | 分区 | 同一个主题下的消息还可以继续分成多个分区，一个分区只属于一个主题 |
| **Replica** | 副本 | 一个分区可以有多个副本来提高容灾性 |
| **Leader and Follower** | 主从 | 分区有了多个副本，那么就需要有同步方式。Kafka 使用一主多从进行消息同步，主副本提供读写的能力，而从副本不提供读写，仅仅作为主副本的备份 |
| **Offset** | 偏移 | 分区中的每一条消息都有一个所在分区的偏移量，这个偏移量唯一标识了该消息在当前这个分区的位置，并保证了在这个分区的顺序性，不过不保证跨分区的顺序性 |

## 三、Kafka 存储原理

### 3.1 追加日志（Append-Only Log）

简单来说，作为消息系统的 Kafka 本质上还是一个**分布式提交日志（Distributed Commit Log）**系统。既然是一个数据系统，那么就要解决两个根本问题：

- 当我们把数据交给 Kafka 的时候，Kafka 怎么存储；
- 当我们向 Kafka 要回数据的时候，Kafka 怎么返回。

![图片](/images/641.png)

目前大多数数据系统将数据存储在磁盘的格式有追加日志型以及 B+ 树型。而 Kafka 采用了**追加日志（Append-Only Log）**的格式将数据持久化到磁盘上，整体的结构如下图：

![图片](/images/642.png)

追加日志的格式可以带来写性能的提升（毕竟只需要往日志文件后面追加就可以了），但是同时对读的支持不是很友好。为了提升读性能，Kafka 需要额外的操作。

### 3.2 为什么追加写入如此高效？

- **顺序写磁盘**：机械硬盘顺序写入速度可达 600MB/s，远超随机写入。Kafka 利用操作系统的 Page Cache 和零拷贝（Zero-Copy）技术，写入性能接近内存
- **批量发送**：Producer 可以将多条消息打包成一个批次（Batch）发送，减少网络 I/O 次数
- **日志分段（Log Segment）**：每个 Partition 由多个 Segment 文件组成，旧 Segment 可以被清理或归档

### 3.3 Topic + Partition 两级结构

关于 Kafka 的数据是如何存储的是一个比较大的问题，这里先从逻辑层面开始。

```
Topic: order-events
├── Partition 0: [msg0, msg3, msg6, msg9, ...]   ← 位于 Broker 0 (Leader)
├── Partition 1: [msg1, msg4, msg7, msg10, ...]  ← 位于 Broker 1 (Leader)
└── Partition 2: [msg2, msg5, msg8, msg11, ...]  ← 位于 Broker 2 (Leader)

每个 Partition 内的消息通过 Offset 唯一标识：
Partition 0: offset=0 → msg0, offset=1 → msg3, offset=2 → msg6 ...
```

**关键特性**：

- 一个 Topic 可以有多个 Partition，实现**水平扩展**
- 每个 Partition 内的消息**严格有序**（通过 Offset 保证）
- 不同 Partition 之间**不保证顺序**
- 每个 Partition 可以有多个 Replica，分布在不同 Broker 上实现**高可用**

## 四、Producer 生产者深度解析

### 4.1 消息发送方式

消息的发送有三种方式：

| 发送方式 | 描述 | 可靠性 | 性能 |
| --- | --- | --- | --- |
| **发后即忘（Fire and Forget）** | 只管发送不管结果 | 最低，可能丢消息 | 最高 |
| **同步发送（Sync）** | 等集群确认写入成功再返回 | 最高 | 最低 |
| **异步发送（Async）** | 指定 Callback，Kafka 返回响应后回调 | 高 | 高 |

其中前两个是同步发送，后一个是异步发送。

### 4.2 ACKs 确认机制

那么生产者发送消息之后 Kafka 怎么才算确认呢？这涉及到 `acks` 参数：

| acks 值 | 含义 | 适用场景 |
| --- | --- | --- |
| `acks = 0` | 不等待任何响应，可能丢数据 | 日志收集等允许丢失的场景 |
| `acks = 1`（默认） | Leader 写入成功即返回 | 一般业务场景 |
| `acks = -1` / `all` | 所有 ISR 副本确认写入成功 | 金融、订单等不能丢数据的场景 |

> **ISR（In-Sync Replicas）**：与 Leader 保持同步的副本集合。如果 Follower 落后太多，会被移出 ISR。

### 4.3 PHP/Laravel Producer 代码示例

使用 `php-rdkafka` 扩展包（底层基于 librdkafka）：

```php
<?php

namespace App\Services\Kafka;

use RdKafka\Producer;
use RdKafka\ProducerTopic;
use RdKafka\Conf;

class KafkaProducer
{
    private Producer $producer;
    private ProducerTopic $topic;

    public function __construct(string $topicName = 'default-topic')
    {
        $conf = new Conf();

        // Kafka Broker 地址
        $conf->set('metadata.broker.list', env('KAFKA_BROKERS', 'localhost:9092'));

        // 消息确认机制：all 表示所有 ISR 副本确认
        $conf->set('acks', 'all');

        // 开启幂等生产者，防止网络重试导致消息重复
        $conf->set('enable.idempotence', 'true');

        // 消息压缩
        $conf->set('compression.type', 'snappy');

        // 批量发送配置
        $conf->set('batch.size', 16384);
        $conf->set('linger.ms', 5);

        // 消息发送失败重试次数
        $conf->set('retries', 3);
        $conf->set('retry.backoff.ms', 100);

        $this->producer = new Producer($conf);
        $this->topic = $this->producer->newTopic($topicName);
    }

    /**
     * 同步发送消息
     */
    public function produce(string $message, string $key = null, int $partition = RD_KAFKA_PARTITION_UA): void
    {
        $this->topic->produce($partition, 0, $message, $key);

        // poll 等待 broker 响应
        $this->producer->poll(0);

        // flush 确保消息已发送
        $result = $this->producer->flush(10000);
        if ($result !== RD_KAFKA_RESP_ERR_NO_ERROR) {
            throw new \RuntimeException("Kafka produce failed: " . rd_kafka_err2str($result));
        }
    }

    /**
     * 批量发送消息
     */
    public function produceBatch(array $messages, string $topicName = null): void
    {
        $topic = $topicName ? $this->producer->newTopic($topicName) : $this->topic;

        foreach ($messages as $msg) {
            $topic->produce(
                $msg['partition'] ?? RD_KAFKA_PARTITION_UA,
                0,
                json_encode($msg['data']),
                $msg['key'] ?? null
            );
            $this->producer->poll(0);
        }

        $this->producer->flush(10000);
    }

    public function __destruct()
    {
        $this->producer->flush(5000);
    }
}
```

### 4.4 Laravel 集成：事件驱动发送

```php
<?php

namespace App\Listeners;

use App\Events\OrderCreated;
use App\Services\Kafka\KafkaProducer;

class SendOrderToKafka
{
    private KafkaProducer $kafka;

    public function __construct()
    {
        $this->kafka = new KafkaProducer('order-events');
    }

    public function handle(OrderCreated $event): void
    {
        $order = $event->order;

        $payload = [
            'event_type' => 'ORDER_CREATED',
            'order_id'   => $order->id,
            'user_id'    => $order->user_id,
            'amount'     => $order->total_amount,
            'items'      => $order->items->toArray(),
            'created_at' => $order->created_at->toIso8601String(),
        ];

        // 使用订单ID作为消息Key，保证同一订单的消息进入同一Partition
        $this->kafka->produce(
            message: json_encode($payload, JSON_UNESCAPED_UNICODE),
            key: (string) $order->id
        );
    }
}
```

## 五、Consumer 消费者与 Consumer Group

### 5.1 Consumer Group 机制

Consumer Group 是 Kafka 实现**消息广播与负载均衡**的核心机制：

```
Topic: order-events (3 Partitions)

Consumer Group A (订单处理服务):
┌──────────┐  ┌──────────┐  ┌──────────┐
│Consumer-0│  │Consumer-1│  │Consumer-2│
│  消费 P0  │  │  消费 P1  │  │  消费 P2  │
└──────────┘  └──────────┘  └──────────┘
  → 3个消费者各消费1个分区，负载均衡

Consumer Group B (通知服务):
┌──────────┐
│Consumer-0│
│消费P0,P1,P2│   → 1个消费者消费全部分区
└──────────┘

两个 Group 互不影响，各自维护自己的 Offset！
```

**核心规则**：

- 一个 Partition 只能被同一 Consumer Group 内的**一个** Consumer 消费
- 一个 Consumer 可以消费**多个** Partition
- Consumer 数量**超过** Partition 数量时，多余的 Consumer 会空闲
- 不同 Consumer Group 独立消费，互不影响，实现**消息广播**

### 5.2 Consumer Group Rebalance（重平衡）

当 Consumer Group 内的成员发生变化时，Kafka 会触发 **Rebalance**，重新分配 Partition 的消费权。触发条件包括：

| 触发条件 | 说明 |
| --- | --- |
| 新 Consumer 加入 Group | 消费者启动或重新连接 |
| Consumer 离开 Group | 消费者主动退出或崩溃 |
| Consumer 心跳超时 | `session.timeout.ms` 内未发送心跳 |
| Topic Partition 数量变化 | 管理员增加了 Partition |

#### Rebalance 策略

Kafka 提供多种分区分配策略：

1. **RangeAssignor（范围分配）**：按 Topic 的 Partition 范围分配，可能导致分配不均匀
2. **RoundRobinAssignor（轮询分配）**：将所有 Topic 的 Partition 轮询分配给所有 Consumer，分配更均匀
3. **StickyAssignor（粘性分配）**：在保证均衡的前提下，尽量保持上一次的分配结果，减少 Rebalance 时的 Partition 迁移
4. **CooperativeStickyAssignor（协作式粘性分配）**：Kafka 2.4+ 引入，支持增量式 Rebalance，避免 Stop-the-World 式的全局暂停

#### Rebalance 的影响与优化

Rebalance 期间，**所有 Consumer 会暂停消费**，这会导致：

- 消费延迟增加
- 可能出现重复消费（如果未开启幂等处理）

**优化建议**：

```php
// 在 Laravel Kafka Consumer 配置中优化 Rebalance
$conf = new \RdKafka\Conf();

// 设置合理的会话超时时间（默认10s，建议10-30s）
$conf->set('session.timeout.ms', '30000');

// 心跳间隔（建议 session.timeout.ms 的 1/3）
$conf->set('heartbeat.interval.ms', '10000');

// 使用协作式粘性分配减少 Rebalance 影响
$conf->set('partition.assignment.strategy', 'cooperative-sticky');

// 关闭自动提交 Offset，改为手动提交，避免重复消费
$conf->set('enable.auto.commit', 'false');
```

### 5.3 PHP/Laravel Consumer 代码示例

```php
<?php

namespace App\Services\Kafka;

use RdKafka\KafkaConsumer;
use RdKafka\Conf;
use RdKafka\Message;
use Illuminate\Support\Facades\Log;

class KafkaConsumerService
{
    private KafkaConsumer $consumer;
    private bool $running = true;

    public function __construct(string $groupId, array $topics)
    {
        $conf = new Conf();

        $conf->set('group.id', $groupId);
        $conf->set('metadata.broker.list', env('KAFKA_BROKERS', 'localhost:9092'));

        // 关闭自动提交，手动控制 Offset
        $conf->set('enable.auto.commit', 'false');

        // 从最早的消息开始消费（首次启动时）
        $conf->set('auto.offset.reset', 'earliest');

        // Rebalance 回调
        $conf->setRebalanceCb(function (KafkaConsumer $consumer, $err, array $partitions) {
            switch ($err) {
                case RD_KAFKA_RESP_ERR__ASSIGN_PARTITIONS:
                    Log::info('Kafka Rebalance: 分配分区', ['partitions' => $partitions]);
                    $consumer->assign($partitions);
                    break;
                case RD_KAFKA_RESP_ERR__REVOKE_PARTITIONS:
                    Log::info('Kafka Rebalance: 撤销分区', ['partitions' => $partitions]);
                    $consumer->assign([]);
                    break;
            }
        });

        $this->consumer = new KafkaConsumer($conf);
        $this->consumer->subscribe($topics);
    }

    /**
     * 消费循环
     */
    public function consume(callable $handler, int $timeoutMs = 1000): void
    {
        while ($this->running) {
            $message = $this->consumer->consume($timeoutMs);

            switch ($message->err) {
                case RD_KAFKA_RESP_ERR_NO_ERROR:
                    try {
                        $handler($message);
                        // 处理成功后手动提交 Offset
                        $this->consumer->commit($message);
                    } catch (\Throwable $e) {
                        Log::error('Kafka 消息处理失败', [
                            'topic'     => $message->topic_name,
                            'partition' => $message->partition,
                            'offset'    => $message->offset,
                            'error'     => $e->getMessage(),
                        ]);
                        // 发送到死信队列
                        $this->sendToDeadLetterQueue($message, $e);
                    }
                    break;

                case RD_KAFKA_RESP_ERR__PARTITION_EOF:
                    // 分区末尾，无新消息，继续等待
                    break;

                case RD_KAFKA_RESP_ERR__TIMED_OUT:
                    // 超时，继续等待
                    break;

                default:
                    Log::error('Kafka 消费异常', ['error' => $message->errstr()]);
                    $this->running = false;
                    break;
            }
        }
    }

    /**
     * 发送到死信队列
     */
    private function sendToDeadLetterQueue(Message $message, \Throwable $e): void
    {
        $dlqProducer = new KafkaProducer($message->topic_name . '.dlq');
        $dlqPayload = json_encode([
            'original_topic'     => $message->topic_name,
            'original_partition' => $message->partition,
            'original_offset'    => $message->offset,
            'original_key'       => $message->key,
            'original_payload'   => $message->payload,
            'error_message'      => $e->getMessage(),
            'error_trace'        => $e->getTraceAsString(),
            'failed_at'          => now()->toIso8601String(),
            'retry_count'        => 0,
        ], JSON_UNESCAPED_UNICODE);

        $dlqProducer->produce($dlqPayload);

        Log::warning('消息已发送到死信队列', [
            'dlq_topic' => $message->topic_name . '.dlq',
            'original_offset' => $message->offset,
        ]);
    }

    public function stop(): void
    {
        $this->running = false;
    }
}
```

## 六、Partition 分区策略

### 6.1 分区的意义

Partition 是 Kafka 实现**水平扩展**和**并行消费**的基本单位。合理的分区策略直接影响：

- **吞吐量**：分区越多，并行度越高
- **消息顺序性**：同一 Partition 内有序，跨 Partition 无序
- **负载均衡**：消息在 Partition 间的分布均匀程度

### 6.2 Producer 端分区策略

#### 策略一：指定分区（Partition 指定）

```php
// 直接指定消息发送到 Partition 0
$topic->produce(0, 0, $message, $key);
```

> 适用场景：明确知道目标分区，如按地区分配分区。

#### 策略二：按 Key 哈希（Key Hashing）

```php
// 使用订单ID作为Key，相同Key的消息一定进入同一Partition
$topic->produce(RD_KAFKA_PARTITION_UA, 0, $message, $orderId);
```

默认分区器的计算逻辑：`partition = hash(key) % numPartitions`

> 适用场景：需要保证同一业务实体（如同一用户、同一订单）的消息顺序性。这是**最常用**的分区策略。

#### 策略三：轮询（Round Robin）

当消息没有指定 Key 且未指定 Partition 时，Kafka 默认使用**轮询策略**将消息均匀分配到所有 Partition。

> 适用场景：不需要消息顺序性，追求最大吞吐量。

#### 自定义分区器示例

```php
<?php

namespace App\Services\Kafka;

use RdKafka;

/**
 * 自定义分区器：按用户ID取模，保证同一用户的消息进入同一分区
 */
class UserPartitioner implements RdKafka\Partitioner
{
    public function partition(
        int $partition_cnt,
        string $topic,
        ?string $key,
        $key_len,
        ?string $msg,
        $msg_len
    ): int {
        if ($key === null) {
            // 无Key时轮询
            return rand(0, $partition_cnt - 1);
        }

        // 使用 CRC32 对 Key 哈希，再取模
        return crc32($key) % $partition_cnt;
    }
}
```

### 6.3 分区数量规划

| 场景 | 建议分区数 | 说明 |
| --- | --- | --- |
| 低吞吐业务（<1000 msg/s） | 3-6 | 足够并行，运维简单 |
| 中等吞吐（1000-10000 msg/s） | 12-30 | 按消费者数量的 2-3 倍规划 |
| 高吞吐（>10000 msg/s） | 30-100+ | 需要配合 Broker 数量和磁盘 I/O |

> **注意**：分区数越多，Rebalance 时间越长，文件句柄占用也越多。**分区数只能增加不能减少**。

## 七、消息顺序性保证

### 7.1 Kafka 的顺序性模型

Kafka 只保证**单个 Partition 内的消息有序**，不保证跨 Partition 的顺序。

```
Partition 0: msg1 → msg2 → msg3 → msg4  (严格有序 ✓)
Partition 1: msg5 → msg6 → msg7 → msg8  (严格有序 ✓)

整体消费顺序可能是: msg1, msg5, msg2, msg6, msg3, msg7 ... (无序 ✗)
```

### 7.2 如何保证业务消息有序？

**方案一：单 Partition（简单但牺牲吞吐量）**

将 Topic 设置为只有 1 个 Partition，所有消息严格有序。但这样无法水平扩展，吞吐量受限于单机性能。

**方案二：按业务 Key 路由到同一 Partition（推荐）**

```php
// 同一订单的所有事件（创建、支付、发货）使用相同的 Key
// 这样它们一定会进入同一个 Partition，保证顺序
$producer->produce($orderId, json_encode([
    'event' => 'ORDER_PAID',
    'order_id' => $orderId,
    'paid_at' => now()->toIso8601String(),
]));
```

> 这是最常用的方案，既保证了同一业务实体的顺序性，又充分利用了多 Partition 的并行能力。

**方案三：顺序消费 + 幂等处理**

在消费端实现幂等性，即使消息乱序到达也能正确处理：

```php
// 通过数据库乐观锁或版本号实现幂等
DB::transaction(function () use ($message) {
    $order = Order::where('id', $message['order_id'])
        ->where('version', $message['version'] - 1)
        ->lockForUpdate()
        ->first();

    if ($order) {
        $order->status = $message['new_status'];
        $order->version = $message['version'];
        $order->save();
    }
});
```

## 八、死信队列（Dead Letter Queue）

### 8.1 什么是死信队列？

当消费者反复处理某条消息失败时（如数据格式错误、下游服务不可用），该消息会阻塞整个 Partition 的消费进度。**死信队列（DLQ）**是专门存储这类"无法处理"消息的特殊队列，让主队列消费可以继续进行。

### 8.2 DLQ 设计模式

```
┌───────────┐     处理成功     ┌────────────┐
│  Topic    │ ──────────────→  │  提交 Offset │
│ (主队列)  │                  └────────────┘
└───────────┘
     │ 处理失败（重试N次后仍失败）
     ▼
┌───────────┐     人工排查     ┌────────────┐
│  Topic.dlq│ ──────────────→  │  修复后重放  │
│ (死信队列) │                  └────────────┘
└───────────┘
```

### 8.3 Laravel 集成 DLQ 的实现

```php
<?php

namespace App\Services\Kafka;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class RetryableConsumer
{
    private const MAX_RETRIES = 3;
    private const RETRY_DELAY_SECONDS = [10, 30, 60]; // 指数退避

    public function handle(KafkaMessage $message): void
    {
        $retryKey = "kafka:retry:{$message->topic}:{$message->partition}:{$message->offset}";
        $retryCount = Cache::get($retryKey, 0);

        try {
            // 业务处理逻辑
            $this->processMessage($message);

            // 成功则清除重试计数
            Cache::forget($retryKey);

        } catch (\Throwable $e) {
            if ($retryCount >= self::MAX_RETRIES) {
                // 超过最大重试次数，发送到死信队列
                $this->sendToDLQ($message, $e, $retryCount);
                Cache::forget($retryKey);
                Log::error("消息超过最大重试次数，已发送到DLQ", [
                    'topic' => $message->topic,
                    'offset' => $message->offset,
                    'retries' => $retryCount,
                ]);
            } else {
                // 记录重试次数，延迟后重新消费
                $delay = self::RETRY_DELAY_SECONDS[$retryCount] ?? 60;
                Cache::put($retryKey, $retryCount + 1, now()->addSeconds($delay));

                Log::warning("消息处理失败，将重试", [
                    'topic' => $message->topic,
                    'offset' => $message->offset,
                    'retry' => $retryCount + 1,
                    'error' => $e->getMessage(),
                ]);

                throw $e; // 不提交 Offset，等待重试
            }
        }
    }

    private function sendToDLQ(KafkaMessage $message, \Throwable $e, int $retryCount): void
    {
        $dlqTopic = $message->topic . '.dlq';
        $producer = new KafkaProducer($dlqTopic);

        $producer->produce(json_encode([
            'original_topic'  => $message->topic,
            'original_offset' => $message->offset,
            'original_key'    => $message->key,
            'payload'         => $message->payload,
            'error'           => $e->getMessage(),
            'retry_count'     => $retryCount,
            'failed_at'       => now()->toIso8601String(),
        ], JSON_UNESCAPED_UNICODE));
    }

    private function processMessage(KafkaMessage $message): void
    {
        // 实际业务逻辑
    }
}
```

### 8.4 DLQ 监控与告警

建议对 DLQ 设置专门的消费者进行监控：

```php
// DLQ 监控消费者：将死信消息持久化到数据库并发送告警
$dlqConsumer = new KafkaConsumerService('dlq-monitor-group', [
    'order-events.dlq',
    'payment-events.dlq',
    'inventory-events.dlq',
]);

$dlqConsumer->consume(function ($message) {
    // 持久化到数据库
    DeadLetterMessage::create([
        'original_topic' => $message->original_topic,
        'payload'        => $message->payload,
        'error'          => $message->error,
    ]);

    // 发送告警通知
    Notification::route('slack', '#kafka-alerts')
        ->notify(new DeadLetterAlert($message));
});
```

## 九、Exactly-Once 语义

### 9.1 三种投递语义

| 语义 | 含义 | 实现难度 |
| --- | --- | --- |
| **At-Most-Once** | 消息最多投递一次，可能丢失 | 低 |
| **At-Least-Once** | 消息至少投递一次，可能重复 | 中 |
| **Exactly-Once** | 消息恰好投递一次，不丢不重 | 高 |

### 9.2 Kafka 实现 Exactly-Once 的机制

1. **幂等生产者（Idempotent Producer）**：通过 Producer 端的序列号（Sequence Number）机制，保证在网络重试时同一消息不会被重复写入
2. **事务性生产（Transactional Producer）**：将多个消息的发送包装在一个 Kafka 事务中，要么全部成功要么全部回滚
3. **消费端幂等**：消费者需要自行实现幂等处理（如数据库唯一约束、乐观锁等）

```php
// 开启幂等生产者
$conf->set('enable.idempotence', 'true');
$conf->set('transactional.id', 'order-producer-tx-1');
```

> **注意**：Kafka 的 Exactly-Once 目前主要保证 Producer → Broker 这一端。跨系统的 Exactly-Once 需要消费端配合实现幂等。

## 十、Laravel 集成方案

### 10.1 基于 Laravel Queue 的 Kafka 驱动

社区提供了多个 Laravel Kafka 驱动包：

| 包名 | 特点 |
| --- | --- |
| `mateusjunges/laravel-kafka` | 功能全面，支持 Producer/Consumer/Consumer Group |
| `php-kafka/laravel-kafka` | 轻量级，基于 php-rdkafka |
| 自行封装 | 如上面代码示例，灵活可控 |

### 10.2 基于 Artisan Command 的消费者

```php
<?php

namespace App\Console\Commands;

use App\Services\Kafka\KafkaConsumerService;
use Illuminate\Console\Command;

class KafkaConsumeCommand extends Command
{
    protected $signature = 'kafka:consume
                            {--topic=* : 要消费的 Topic 列表}
                            {--group= : Consumer Group ID}';

    protected $description = '启动 Kafka 消费者进程';

    public function handle(): int
    {
        $topics = $this->option('topic');
        $groupId = $this->option('group') ?? config('kafka.group_id');

        $this->info("启动 Kafka 消费者: Group={$groupId}, Topics=" . implode(',', $topics));

        $consumer = new KafkaConsumerService($groupId, $topics);

        // 注册信号处理，优雅退出
        pcntl_signal(SIGTERM, fn() => $consumer->stop());
        pcntl_signal(SIGINT, fn() => $consumer->stop());

        $consumer->consume(function ($message) {
            $payload = json_decode($message->payload, true);

            // 根据 event_type 分发到不同的 Handler
            match ($payload['event_type'] ?? '') {
                'ORDER_CREATED'  => app(OrderCreatedHandler::class)->handle($payload),
                'ORDER_PAID'     => app(OrderPaidHandler::class)->handle($payload),
                'ORDER_SHIPPED'  => app(OrderShippedHandler::class)->handle($payload),
                default          => \Log::warning('未知事件类型', $payload),
            };
        });

        return self::SUCCESS;
    }
}
```

## 十一、监控与运维

### 11.1 关键监控指标

| 指标 | 说明 | 告警阈值建议 |
| --- | --- | --- |
| **Consumer Lag** | 消费者落后生产者的消息数 | >10000 条 |
| **Under-Replicated Partitions** | 副本不足的分区数 | >0 |
| **ISR Shrink/Expand Rate** | ISR 集合变化频率 | 频繁变化需排查 |
| **Request Rate** | 每秒请求数 | 突增突降需关注 |
| **Disk Usage** | 磁盘使用率 | >80% 需扩容 |
| **Leader Election Rate** | Leader 选举频率 | >0 需排查 Broker 健康 |

### 11.2 常用运维命令

```bash
# 查看 Topic 列表
kafka-topics.sh --bootstrap-server localhost:9092 --list

# 查看 Topic 详情
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic order-events

# 查看 Consumer Group 消费进度
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group order-service-group

# 手动重置 Consumer Group 的 Offset
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group order-service-group \
  --topic order-events \
  --reset-offsets --to-earliest --execute

# 生产测试消息
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic order-events
```

## 十二、生产环境踩坑总结

### 踩坑 1：Consumer Lag 持续增长

**现象**：Consumer 消费速度跟不上生产速度，Lag 越来越大。

**原因**：消费逻辑中包含了同步 HTTP 调用或耗时数据库操作。

**解决**：
- 消费逻辑中避免同步调用外部服务，改为异步处理
- 增加 Consumer 实例数量（不超过 Partition 数量）
- 增加 Partition 数量以提高并行度

### 踩坑 2：Rebalance 频繁触发

**现象**：消费过程中频繁出现 Rebalance 日志，消费延迟波动大。

**原因**：`session.timeout.ms` 设置过短，Consumer GC 停顿导致心跳超时。

**解决**：
- 增大 `session.timeout.ms`（建议 30s）
- 增大 `max.poll.interval.ms`（建议 5min）
- 使用 `CooperativeStickyAssignor` 减少 Rebalance 影响

### 踩坑 3：消息重复消费

**现象**：同一条消息被处理了多次。

**原因**：自动提交 Offset 开启，但在提交前 Consumer 崩溃，重启后从上次提交的 Offset 重新消费。

**解决**：
- 关闭自动提交，改为处理成功后手动提交
- 消费逻辑实现幂等处理（数据库唯一约束、Redis SETNX 等）

### 踩坑 4：磁盘空间不足

**现象**：Broker 报错磁盘空间不足，新消息无法写入。

**原因**：日志保留策略（`log.retention.hours`）设置过长或 Topic 数据量过大。

**解决**：
- 合理设置 `log.retention.hours`（默认 168 小时 / 7 天）
- 设置 `log.retention.bytes` 限制单个 Partition 的大小
- 使用 `log.cleanup.policy=compact` 对需要保留最新状态的 Topic 进行日志压缩

### 踩坑 5：跨机房延迟导致 ISR 不稳定

**现象**：多机房部署时 Follower 频繁进出 ISR，导致 acks=all 写入失败。

**解决**：
- 使用 `min.insync.replicas=2`（3 副本场景）确保至少 2 个副本确认
- 跨机房场景使用 `acks=1` 或配置机房亲和的 Rack Awareness
- 设置合理的 `replica.lag.time.max.ms`

[参考](https://mp.weixin.qq.com/s/A5Dl_8reejqjMWFiI1iV4g)

## 相关阅读

- [Laravel-Kafka 消息队列异步解耦实战——KKday B2C API 真实踩坑记录](/categories/MQ/2026-05-03-Laravel-Kafka-消息队列异步解耦实战/)
- [MQ 消息队列深度对比：RabbitMQ vs Kafka vs RocketMQ 选型指南](/categories/MQ/mq-comparison/)
- [MQ 面试经](/categories/MQ/message-queue/)
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/categories/架构/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
- [RabbitMQ 实战：AMQP 协议、死信队列、延迟消息与 Laravel 集成](/categories/MQ/2026-06-02-RabbitMQ-AMQP-死信队列-延迟消息-Laravel-集成-对比Redis-Queue选型/)