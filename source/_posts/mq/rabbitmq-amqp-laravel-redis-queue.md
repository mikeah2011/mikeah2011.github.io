---
title: RabbitMQ 实战：AMQP 协议、死信队列、延迟消息与 Laravel 集成——对比 Redis Queue 的选型决策
date: 2026-06-02 12:00:00
tags: [RabbitMQ, AMQP, Laravel, 消息队列, 死信队列, Redis]
keywords: [RabbitMQ, AMQP, Laravel, Redis Queue, 协议, 死信队列, 延迟消息与, 的选型决策, 消息队列]
categories: [mq]
cover: https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
description: "RabbitMQ AMQP 协议深度实战，涵盖交换机类型、死信队列、延迟消息、消息确认机制与 Laravel 集成的完整方案。通过真实代码示例对比 Redis Queue 的选型决策，包括可靠性、性能、运维复杂度等维度分析，帮助开发者在企业级消息系统和轻量级任务队列之间做出正确的技术选型。"
---


## 引言：消息队列的核心价值

在现代分布式系统中，消息队列是连接各个服务的关键基础设施。它解决了三个核心问题：

1. **异步处理**：将耗时操作从请求链路中解耦
2. **流量削峰**：在高并发场景下平滑处理峰值流量
3. **服务解耦**：生产者和消费者独立演进，互不影响

RabbitMQ 作为最成熟的消息队列之一，基于 AMQP 协议，提供了丰富的消息路由、可靠投递和高级特性。而 Redis 作为缓存数据库，其 List/Stream 数据结构也被广泛用于轻量级消息队列场景。

本文将深入探讨 RabbitMQ 的核心概念、AMQP 协议原理、死信队列、延迟消息等高级特性，并与 Redis Queue 进行全面对比，帮助你做出正确的技术选型。

---

## 第一章：AMQP 协议深度剖析

### 1.1 AMQP 0-9-1 协议模型

AMQP（Advanced Message Queuing Protocol）是一个开放标准的消息协议，RabbitMQ 实现的是 AMQP 0-9-1 版本。

**核心组件模型：**

```
Producer → Exchange → Binding → Queue → Consumer
```

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│Producer 1│────▶│          │     │  Queue 1 │───▶ Consumer A
└──────────┘     │ Exchange │────▶│          │
┌──────────┐     │  (type)  │     └──────────┘
│Producer 2│────▶│          │     ┌──────────┐
└──────────┘     │          │────▶│  Queue 2 │───▶ Consumer B
                 └──────────┘     └──────────┘
                        │          ┌──────────┐
                        └─────────▶│  Queue 3 │───▶ Consumer C
                                   └──────────┘
```

**AMQP 的关键概念：**

- **Virtual Host (vhost)**：逻辑隔离单元，类似数据库的 schema
- **Connection**：TCP 长连接，支持 TLS 加密
- **Channel**：复用 Connection 的轻量级通道
- **Exchange**：消息路由中心，决定消息发往哪些 Queue
- **Queue**：消息存储队列
- **Binding**：Exchange 和 Queue 之间的路由规则

### 1.2 Exchange 类型详解

RabbitMQ 提供四种内置 Exchange 类型：

#### Direct Exchange（直连交换机）

```php
// 精确匹配 routing_key
// 适用场景：点对点消息、任务分发

// 声明
$channel->exchange_declare('direct_logs', 'direct', false, true, false);

// 发布
$channel->basic_publish($msg, 'direct_logs', 'error');  // routing_key = 'error'

// 绑定
$channel->queue_bind($queue, 'direct_logs', 'error');    // 只接收 error 级别
```

#### Fanout Exchange（扇形交换机）

```php
// 广播到所有绑定的队列，忽略 routing_key
// 适用场景：广播通知、事件发布

$channel->exchange_declare('broadcast', 'fanout', false, true, false);

// 发布到所有队列
$channel->basic_publish($msg, 'broadcast', '');  // routing_key 被忽略

// 每个消费者绑定自己的队列
$channel->queue_bind($myQueue, 'broadcast', '');
```

#### Topic Exchange（主题交换机）

```php
// 通配符匹配 routing_key
// * 匹配一个单词，# 匹配零个或多个单词
// 适用场景：事件分类、日志路由

$channel->exchange_declare('topic_logs', 'topic', false, true, false);

// routing_key 格式：facility.severity
$channel->basic_publish($msg, 'topic_logs', 'auth.error');
$channel->basic_publish($msg, 'topic_logs', 'payment.info');

// 绑定规则
$channel->queue_bind($queue1, 'topic_logs', '*.error');      // 所有 error
$channel->queue_bind($queue2, 'topic_logs', 'auth.*');       // auth 的所有级别
$channel->queue_bind($queue3, 'topic_logs', '#');             // 所有消息
```

#### Headers Exchange（头部交换机）

```php
// 基于消息头部匹配，而非 routing_key
// 适用场景：复杂的多条件路由

$channel->exchange_declare('headers_logs', 'headers', false, true, false);

// 发布时设置 headers
$msg = new AMQPMessage($body, [
    'application_headers' => new AMQPTable([
        'format' => 'pdf',
        'type'   => 'report',
    ])
]);

// 绑定时设置匹配规则
$channel->queue_bind($queue, 'headers_logs', '', false, new AMQPTable([
    'x-match' => 'all',    // all = 全部匹配，any = 任一匹配
    'format'  => 'pdf',
    'type'    => 'report',
]));
```

### 1.3 消息确认机制

RabbitMQ 提供两种确认模式：

```php
// 自动确认（不推荐用于重要消息）
$channel->basic_consume($queue, '', false, true, false, false, $callback);

// 手动确认（推荐）
$channel->basic_consume($queue, '', false, false, false, false, function ($msg) {
    try {
        // 处理消息
        processMessage($msg->body);
        
        // 确认消息
        $msg->delivery_info['channel']->basic_ack($msg->delivery_info['delivery_tag']);
    } catch (\Exception $e) {
        // 拒绝消息，requeue = false 会进入死信队列
        $msg->delivery_info['channel']->basic_nack(
            $msg->delivery_info['delivery_tag'],
            false,  // multiple
            false   // requeue
        );
    }
});

// QoS 预取设置
$channel->basic_qos(null, 10, null);  // 每次最多预取 10 条消息
```

---

## 第二章：RabbitMQ 集群与高可用

### 2.1 集群架构

RabbitMQ 支持两种集群模式：

**普通集群（Classic Cluster）**：
- 元数据同步，队列数据只在一个节点
- 适用场景：非关键数据、可接受短暂不可用

**镜像队列集群（Quorum Queues）**：
- 基于 Raft 协议的数据一致性
- 推荐用于生产环境

```bash
# 创建 Quorum Queue
rabbitmqctl set_policy ha-queue "^orders\." \
  '{"ha-mode":"exactly","ha-params":3,"ha-sync-mode":"automatic"}' \
  --apply-to queues
```

### 2.2 消息持久化

```php
// 1. Exchange 持久化
$channel->exchange_declare('orders', 'direct', false, true, false);
// 参数：name, type, passive, durable, auto_delete

// 2. Queue 持久化
$channel->queue_declare('order_queue', false, true, false, false);
// 参数：name, passive, durable, exclusive, auto_delete

// 3. Message 持久化
$msg = new AMQPMessage($body, [
    'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT,
    'content_type'  => 'application/json',
    'timestamp'     => time(),
    'message_id'    => uniqid(),
]);
```

### 2.3 生产环境配置

```yaml
# rabbitmq.conf
# 内存限制
vm_memory_high_watermark.relative = 0.6
vm_memory_high_watermark_paging_ratio = 0.75

# 磁盘空间限制
disk_free_limit.absolute = 2GB

# 连接限制
channel_max = 2047
heartbeat = 60

# TLS 配置
listeners.ssl.default = 5671
ssl_options.certfile = /etc/rabbitmq/server_cert.pem
ssl_options.keyfile = /etc/rabbitmq/server_key.pem
ssl_options.cacertfile = /etc/rabbitmq/ca_cert.pem
ssl_options.verify = verify_peer

# 管理插件
management.listener.port = 15672
management.listener.ssl = false
```

---

## 第三章：死信队列（DLX）实战

### 3.1 什么是死信队列

死信队列（Dead Letter Exchange）用于处理无法被正常消费的消息。消息进入死信队列的原因：

1. 消息被 `basic.reject` 或 `basic.nack` 且 `requeue=false`
2. 消息 TTL 过期
3. 队列达到最大长度（`x-max-length`）

### 3.2 死信队列配置

```php
// 声明死信交换机
$channel->exchange_declare('dlx_exchange', 'direct', false, true, false);

// 声明死信队列
$channel->queue_declare('dlx_queue', false, true, false, false);
$channel->queue_bind('dlx_queue', 'dlx_exchange', 'dlx_routing');

// 声明业务队列（绑定死信交换机）
$channel->queue_declare('order_queue', false, true, false, false, false, new AMQPTable([
    'x-dead-letter-exchange'    => 'dlx_exchange',
    'x-dead-letter-routing-key' => 'dlx_routing',
    'x-message-ttl'             => 60000,  // 消息 TTL 60 秒
    'x-max-length'              => 100000, // 队列最大长度
]));
```

### 3.3 重试机制实现

```php
class RetryableMessageHandler
{
    private $channel;
    private $maxRetries = 3;
    
    public function handle(AMQPMessage $msg): void
    {
        $headers = $msg->get('application_headers');
        $retryCount = 0;
        
        if ($headers && $headers->has('x-retry-count')) {
            $retryCount = $headers->get('x-retry-count');
        }
        
        try {
            // 处理消息
            $this->processMessage($msg->body);
            $msg->ack();
        } catch (\Exception $e) {
            if ($retryCount < $this->maxRetries) {
                // 重试：发布到重试队列（带 TTL）
                $this->publishToRetryQueue($msg, $retryCount + 1);
                $msg->ack(); // 确认原消息
            } else {
                // 超过重试次数，进入死信队列
                $msg->nack(false, false);
            }
        }
    }
    
    private function publishToRetryQueue(AMQPMessage $msg, int $retryCount): void
    {
        $headers = $msg->get('application_headers') ?? new AMQPTable();
        $headers->set('x-retry-count', $retryCount);
        
        // 使用指数退避延迟
        $delay = pow(2, $retryCount) * 1000; // 2s, 4s, 8s
        
        $retryMsg = new AMQPMessage($msg->body, [
            'application_headers' => $headers,
            'delivery_mode'       => AMQPMessage::DELIVERY_MODE_PERSISTENT,
            'expiration'          => (string)$delay,
        ]);
        
        $this->channel->basic_publish($retryMsg, 'retry_exchange', 'retry_routing');
    }
}
```

### 3.4 死信队列监控

```php
class DeadLetterMonitor
{
    public function monitor(): void
    {
        // 使用管理 API 检查死信队列长度
        $response = Http::get('http://rabbitmq:15672/api/queues/%2F/dlx_queue', [
            'auth' => ['admin', 'password'],
        ]);
        
        $queueInfo = $response->json();
        $messageCount = $queueInfo['messages'] ?? 0;
        
        if ($messageCount > 1000) {
            // 告警
            $this->alert("Dead letter queue has {$messageCount} messages");
        }
        
        // 消费死信消息并记录
        $this->consumeDeadLetters();
    }
    
    private function consumeDeadLetters(): void
    {
        $channel = $this->connection->channel();
        $channel->basic_qos(null, 10, null);
        
        $channel->basic_consume('dlx_queue', '', false, false, false, false, function ($msg) {
            // 记录到数据库
            DeadLetter::create([
                'original_queue' => $msg->get('application_headers')->get('x-first-death-queue') ?? 'unknown',
                'reason'         => $msg->get('application_headers')->get('x-first-death-reason') ?? 'unknown',
                'body'           => $msg->body,
                'headers'        => json_encode($msg->get('application_headers')->getNativeData()),
                'created_at'     => now(),
            ]);
            
            $msg->ack();
        });
    }
}
```

---

## 第四章：延迟消息实现

### 4.1 延迟消息的两种方案

RabbitMQ 原生不支持延迟消息，但有两种实现方案：

#### 方案一：TTL + DLX（推荐）

```php
class DelayedMessagePublisher
{
    public function publishDelayed(string $message, int $delayMs, string $targetQueue): void
    {
        // 1. 声明延迟队列（TTL + DLX）
        $delayQueue = "delay_{$delayMs}_queue";
        $this->channel->queue_declare($delayQueue, false, true, false, false, false, new AMQPTable([
            'x-dead-letter-exchange'    => 'target_exchange',
            'x-dead-letter-routing-key' => $targetQueue,
            'x-message-ttl'             => $delayMs,
        ]));
        
        // 2. 发布消息到延迟队列
        $msg = new AMQPMessage($message, [
            'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT,
        ]);
        
        $this->channel->basic_publish($msg, 'delay_exchange', $delayQueue);
    }
}

// 使用示例：30 分钟后检查订单支付状态
$publisher->publishDelayed(
    json_encode(['order_id' => 12345, 'action' => 'check_payment']),
    30 * 60 * 1000,  // 30 分钟
    'payment_check_queue'
);
```

#### 方案二：延迟插件（rabbitmq_delayed_message_exchange）

```bash
# 安装插件
rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

```php
// 使用延迟插件
$channel->exchange_declare('delayed_exchange', 'x-delayed-message', 
    false, true, false, false, new AMQPTable([
        'x-delayed-type' => 'direct',
    ]));

// 发送延迟消息
$msg = new AMQPMessage($body, [
    'application_headers' => new AMQPTable([
        'x-delay' => 300000, // 延迟 5 分钟（毫秒）
    ]),
]);

$channel->basic_publish($msg, 'delayed_exchange', 'target_routing_key');
```

### 4.2 延迟消息实战：订单超时取消

```php
class OrderTimeoutService
{
    public function createOrder(array $orderData): Order
    {
        $order = Order::create($orderData);
        
        // 发布延迟消息：30 分钟后检查支付状态
        $this->publishDelayedMessage([
            'type'      => 'order_timeout',
            'order_id'  => $order->id,
            'action'    => 'cancel_if_unpaid',
        ], 30 * 60 * 1000);
        
        return $order;
    }
    
    public function handleTimeout(array $payload): void
    {
        $order = Order::find($payload['order_id']);
        
        if ($order && $order->status === 'pending_payment') {
            // 取消订单
            $order->update(['status' => 'cancelled']);
            
            // 释放库存
            $this->inventoryService->release($order->items);
            
            // 通知用户
            $this->notificationService->send($order->user, '订单已超时取消');
        }
    }
}
```

### 4.3 延迟消息实战：重试退避

```php
class ExponentialBackoffRetry
{
    private array $retryDelays = [2000, 4000, 8000, 16000, 32000]; // 指数退避
    
    public function handle(AMQPMessage $msg): void
    {
        $retryCount = $this->getRetryCount($msg);
        
        try {
            $this->processMessage($msg);
            $msg->ack();
        } catch (\Exception $e) {
            if ($retryCount < count($this->retryDelays)) {
                $delay = $this->retryDelays[$retryCount];
                $this->publishWithDelay($msg, $delay, $retryCount + 1);
                $msg->ack();
            } else {
                // 进入死信队列
                $msg->nack(false, false);
            }
        }
    }
}
```

---

## 第五章：Laravel 集成

### 5.1 Laravel Queue 配置

```php
// config/queue.php
'connections' => [
    'rabbitmq' => [
        'driver' => 'rabbitmq',
        'queue'  => env('RABBITMQ_QUEUE', 'default'),
        'connection' => PhpAmqpLib\Connection\AMQPStreamConnection::class,
        'hosts' => [
            [
                'host'     => env('RABBITMQ_HOST', '127.0.0.1'),
                'port'     => env('RABBITMQ_PORT', 5672),
                'user'     => env('RABBITMQ_USER', 'guest'),
                'password' => env('RABBITMQ_PASSWORD', 'guest'),
                'vhost'    => env('RABBITMQ_VHOST', '/'),
            ],
        ],
        'options' => [
            'ssl_options' => [
                'cafile'      => env('RABBITMQ_SSL_CAFILE', ''),
                'local_cert'  => env('RABBITMQ_SSL_LOCALCERT', ''),
                'local_key'   => env('RABBITMQ_SSL_LOCALKEY', ''),
            ],
            'queue' => [
                'exchange'             => 'laravel_exchange',
                'exchange_type'        => 'direct',
                'exchange_routing_key' => '',
                'prioritize_delayed'   => true,
            ],
        ],
        'worker' => env('RABBITMQ_WORKER', 'default'),
    ],
],
```

### 5.2 Job 定义

```php
// app/Jobs/ProcessOrder.php
class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    
    public int $tries = 5;
    public int $maxExceptions = 3;
    public int $backoff = 60; // 重试间隔（秒）
    public bool $deleteWhenMissingModels = true;
    
    public function __construct(
        public Order $order
    ) {
        $this->onQueue('orders');
        $this->onConnection('rabbitmq');
    }
    
    public function handle(OrderService $service): void
    {
        $service->process($this->order);
    }
    
    public function failed(\Throwable $exception): void
    {
        // 记录失败日志
        \Log::error('Order processing failed', [
            'order_id' => $this->order->id,
            'error'    => $exception->getMessage(),
        ]);
        
        // 通知管理员
        $this->order->update(['status' => 'failed']);
    }
    
    // 自定义重试延迟
    public function retryAfter(): int
    {
        return $this->attempts() * 60; // 指数退避
    }
}
```

### 5.3 高级特性

```php
// 1. 延迟队列
ProcessOrder::dispatch($order)->delay(now()->addMinutes(30));

// 2. 任务链
ProcessOrder::withChain([
    new UpdateInventory($order),
    new SendNotification($order->user),
    new UpdateAnalytics($order),
])->dispatch($order);

// 3. 批量任务
$batch = Bus::batch([
    new ProcessOrder($order1),
    new ProcessOrder($order2),
    new ProcessOrder($order3),
])->then(function (Batch $batch) {
    // 全部完成
    Log::info("Batch {$batch->id} completed");
})->catch(function (Batch $batch, Throwable $e) {
    // 有任务失败
    Log::error("Batch {$batch->id} failed");
})->name('Order Batch')->dispatch();

// 4. 优先级队列
ProcessOrder::dispatch($urgentOrder)->onQueue('high');
ProcessOrder::dispatch($normalOrder)->onQueue('default');
ProcessOrder::dispatch($batchOrder)->onQueue('low');
```

### 5.4 Horizon 配置

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-1' => [
            'connection'  => 'rabbitmq',
            'queue'       => ['high', 'default', 'low'],
            'balance'     => 'auto',
            'maxProcesses' => 10,
            'maxTime'     => 3600,
            'maxJobs'     => 1000,
            'memory'      => 128,
            'tries'       => 3,
            'timeout'     => 60,
            'nice'        => 0,
        ],
    ],
    'local' => [
        'supervisor-1' => [
            'connection'  => 'rabbitmq',
            'queue'       => ['high', 'default', 'low'],
            'balance'     => 'simple',
            'maxProcesses' => 3,
            'maxTime'     => 3600,
            'maxJobs'     => 1000,
            'memory'      => 128,
            'tries'       => 3,
            'timeout'     => 60,
            'nice'        => 0,
        ],
    ],
],
```

---

## 第六章：Redis Queue 深入分析

### 6.1 Redis 作为消息队列的实现方式

Redis 提供多种数据结构用于消息队列：

#### List 模式（LPUSH + BRPOP）

```php
// 简单的 Redis List 队列
Redis::lpush('queue:orders', json_encode($order));

// 消费者阻塞读取
$order = Redis::brpop('queue:orders', 30); // 阻塞 30 秒
```

#### Stream 模式（Redis 5.0+）

```php
// 生产者
Redis::xAdd('stream:orders', '*', [
    'order_id' => $order->id,
    'amount'   => $order->amount,
    'user_id'  => $order->user_id,
]);

// 消费者组
Redis::xGroup('CREATE', 'stream:orders', 'order-processors', '0', 'MKSTREAM');

// 消费消息
$messages = Redis::xReadGroup(
    'order-processors',
    'consumer-1',
    ['stream:orders' => '>'],
    10,    // 每次最多 10 条
    0      // 不阻塞
);

// 确认消息
Redis::xAck('stream:orders', 'order-processors', [$messageId]);
```

#### Pub/Sub 模式

```php
// 发布者
Redis::publish('channel:notifications', json_encode($notification));

// 订阅者
Redis::subscribe(['channel:notifications'], function ($message) {
    $notification = json_decode($message, true);
    processNotification($notification);
});
```

### 6.2 Redis Queue 在 Laravel 中的实现

```php
// Laravel 默认使用 Redis List
// config/queue.php
'redis' => [
    'driver'       => 'redis',
    'connection'   => 'default',
    'queue'        => env('REDIS_QUEUE', 'default'),
    'retry_after'  => 90,
    'block_for'    => null,
    'after_commit' => false,
],
```

### 6.3 Redis 的局限性

1. **消息丢失风险**：AOF 刷盘间隔可能导致消息丢失
2. **不支持消息确认**：List 模式下消息被消费后即删除
3. **无路由能力**：没有 Exchange 概念，路由需要自己实现
4. **无死信队列原生支持**：需要自己实现
5. **内存限制**：所有消息存储在内存中

---

## 第七章：RabbitMQ vs Redis 全面对比

### 7.1 功能对比

| 特性 | RabbitMQ | Redis |
|------|----------|-------|
| 协议 | AMQP 0-9-1 | 自定义协议 |
| 消息持久化 | ✅ 磁盘持久化 | ⚠️ AOF/RDB |
| 消息确认 | ✅ 手动 ACK | ❌ List 模式不支持 |
| 路由能力 | ✅ 4 种 Exchange | ❌ 无原生路由 |
| 死信队列 | ✅ 原生支持 | ❌ 需自己实现 |
| 延迟消息 | ✅ TTL+DLX 或插件 | ⚠️ 需要自己实现 |
| 优先级队列 | ✅ 原生支持 | ❌ 需自己实现 |
| 消费者组 | ✅ 支持 | ✅ Stream 模式 |
| 消息回溯 | ✅ 支持 | ✅ Stream 模式 |
| 事务 | ✅ 支持 | ⚠️ MULTI/EXEC |
| 消息大小限制 | 无限制 | 建议 < 512MB |
| 吞吐量 | ~50K msg/s | ~100K msg/s |
| 延迟 | 微秒级 | 毫秒级 |
| 内存占用 | 中等 | 高（全内存） |

### 7.2 性能对比

基于典型场景的基准测试：

| 场景 | RabbitMQ | Redis List | Redis Stream |
|------|----------|------------|--------------|
| 简单发布 | 40K msg/s | 100K msg/s | 80K msg/s |
| 持久化发布 | 20K msg/s | 50K msg/s | 40K msg/s |
| 消费（手动确认） | 30K msg/s | N/A | 60K msg/s |
| 批量操作 | 50K msg/s | 150K msg/s | 100K msg/s |
| P99 延迟 | 1-5ms | 0.5-2ms | 1-3ms |

### 7.3 可靠性对比

**RabbitMQ**：
- 消息持久化到磁盘
- 镜像队列/Quorum Queue 保证高可用
- 手动 ACK 确保消息不丢失
- 事务和 Publisher Confirm 保证消息投递

**Redis**：
- AOF everysec 可能丢失 1 秒数据
- 主从复制存在异步延迟
- 没有原生的消息确认机制（Stream 模式有）
- 需要额外的持久化策略

---

## 第八章：选型决策框架

### 8.1 选择 RabbitMQ 的场景

```php
// 场景 1：需要复杂路由
// 订单消息需要根据不同条件路由到不同队列
$exchange->publish($order, 'order.created.vip');    // VIP 订单
$exchange->publish($order, 'order.created.normal'); // 普通订单
$exchange->publish($order, 'order.created.all');    // 所有订单

// 场景 2：需要消息可靠性保证
// 支付消息绝对不能丢失
$channel->basic_publish($paymentMsg, 'payments', 'charge', false, false, 
    new AMQPBasicProperties([
        'delivery_mode' => 2,  // 持久化
        'priority'      => 10, // 高优先级
    ]));

// 场景 3：需要延迟消息
// 订单 30 分钟未支付自动取消
$this->publishDelayed($order, 30 * 60 * 1000);

// 场景 4：需要死信队列
// 处理失败的消息进入死信队列，后续人工处理
```

### 8.2 选择 Redis 的场景

```php
// 场景 1：简单任务队列
// 不需要复杂路由，只需要 FIFO
dispatch(new SendEmail($user));

// 场景 2：实时性要求极高
// 延迟要求 < 1ms
Redis::lpush('realtime:notifications', $notification);

// 场景 3：已有 Redis 基础设施
// 减少运维复杂度
// Redis 同时用于缓存和消息队列

// 场景 4：轻量级消息
// 消息体小，量大，可接受偶尔丢失
Redis::xAdd('stream:events', '*', $eventData);
```

### 8.3 混合架构

在实际项目中，常常同时使用 RabbitMQ 和 Redis：

```php
// Redis：缓存 + 轻量级消息（实时通知、会话）
// RabbitMQ：重要业务消息（订单、支付、库存）

class OrderService
{
    public function createOrder(array $data): Order
    {
        $order = Order::create($data);
        
        // 1. 缓存使用 Redis
        Cache::put("order:{$order->id}", $order, 3600);
        
        // 2. 重要业务消息使用 RabbitMQ
        dispatch(new ProcessOrder($order))
            ->onConnection('rabbitmq');
        
        // 3. 实时通知使用 Redis Pub/Sub
        Redis::publish("user:{$order->user_id}:notifications", json_encode([
            'type' => 'order_created',
            'data' => $order->toArray(),
        ]));
        
        return $order;
    }
}
```

---

## 第九章：生产环境最佳实践

### 9.1 消息设计原则

```php
// ✅ 好的消息设计
class OrderMessage
{
    public static function create(Order $order): array
    {
        return [
            'id'         => Str::uuid(),
            'type'       => 'order.created',
            'version'    => '1.0',
            'timestamp'  => now()->toIso8601String(),
            'source'     => 'order-service',
            'data'       => [
                'order_id'  => $order->id,
                'user_id'   => $order->user_id,
                'amount'    => $order->amount,
                'items'     => $order->items->toArray(),
            ],
            'metadata'   => [
                'correlation_id' => Str::uuid(),
                'causation_id'   => null,
            ],
        ];
    }
}

// ❌ 不好的消息设计
$order = Order::find(1);
dispatch(new ProcessJob($order->toArray())); // 包含过多信息
```

### 9.2 消费者幂等性

```php
class IdempotentMessageHandler
{
    private Redis $redis;
    
    public function handle(array $message): void
    {
        $messageId = $message['id'] ?? null;
        
        if (!$messageId) {
            throw new \InvalidArgumentException('Message ID is required');
        }
        
        // 检查是否已处理
        $lockKey = "message:processed:{$messageId}";
        if ($this->redis->get($lockKey)) {
            Log::info("Message {$messageId} already processed, skipping");
            return;
        }
        
        // 处理消息
        $this->processMessage($message);
        
        // 标记为已处理（保留 7 天）
        $this->redis->setex($lockKey, 7 * 24 * 3600, '1');
    }
}
```

### 9.3 监控与告警

```php
// Prometheus 指标采集
class RabbitMQMetrics
{
    public function collect(): array
    {
        $queues = $this->getQueueInfo();
        
        return [
            'rabbitmq_queue_messages' => $queues->mapWithKeys(fn($q) => [
                $q['name'] => $q['messages'],
            ]),
            'rabbitmq_queue_consumers' => $queues->mapWithKeys(fn($q) => [
                $q['name'] => $q['consumers'],
            ]),
            'rabbitmq_queue_messages_unacked' => $queues->mapWithKeys(fn($q) => [
                $q['name'] => $q['messages_unacknowledged'],
            ]),
        ];
    }
    
    public function checkAlerts(): void
    {
        $queues = $this->getQueueInfo();
        
        foreach ($queues as $queue) {
            // 队列积压告警
            if ($queue['messages'] > 10000) {
                Alert::fire("Queue {$queue['name']} has {$queue['messages']} pending messages");
            }
            
            // 消费者不足告警
            if ($queue['consumers'] === 0 && $queue['messages'] > 0) {
                Alert::critical("Queue {$queue['name']} has no consumers!");
            }
        }
    }
}
```

### 9.4 性能优化

```php
// 1. 使用 Publisher Confirm 替代事务（性能更好）
$channel->confirm_select();
$channel->set_ack_handler(function (AMQPMessage $msg) {
    // 消息已确认
});

// 2. 批量发布
$channel->batch_basic_publish($msg1, 'exchange', 'routing_key');
$channel->batch_basic_publish($msg2, 'exchange', 'routing_key');
$channel->publish_batch(); // 一次性发送

// 3. 消费者预取优化
$channel->basic_qos(null, 50, null); // 预取 50 条

// 4. 使用 Lazy Queue（磁盘存储，减少内存占用）
$channel->queue_declare('lazy_queue', false, true, false, false, false, new AMQPTable([
    'x-queue-mode' => 'lazy',
]));
```

---

## 第十章：总结

### 10.1 核心差异

| 维度 | RabbitMQ | Redis |
|------|----------|-------|
| 定位 | 专业消息队列 | 缓存数据库（可用作队列） |
| 可靠性 | 非常高 | 中等 |
| 功能丰富度 | 非常丰富 | 基础 |
| 运维复杂度 | 中等 | 低 |
| 学习曲线 | 中等 | 低 |
| 适用场景 | 企业级消息系统 | 轻量级任务队列 |

### 10.2 选型建议

```
需要消息可靠性？
├─ 是 → RabbitMQ
└─ 否 → 继续评估

需要复杂路由？
├─ 是 → RabbitMQ
└─ 否 → 继续评估

需要延迟消息/死信队列？
├─ 是 → RabbitMQ
└─ 否 → 继续评估

已有 Redis 基础设施？
├─ 是 → Redis（减少运维复杂度）
└─ 否 → 继续评估

高吞吐 + 可接受偶尔丢失？
├─ 是 → Redis
└─ 否 → RabbitMQ
```

RabbitMQ 是企业级消息系统的首选，适合需要高可靠性、复杂路由和丰富特性的场景。Redis 是轻量级任务队列的首选，适合对可靠性要求不高、追求简单和高性能的场景。在实际项目中，两者常常共存，各司其职。

---

## 参考资料

1. [RabbitMQ Official Documentation](https://www.rabbitmq.com/documentation.html)
2. [AMQP 0-9-1 Protocol Specification](https://www.rabbitmq.com/amqp-0-9-1-reference.html)
3. [Laravel Queue Documentation](https://laravel.com/docs/queues)
4. [Redis Streams Documentation](https://redis.io/docs/data-types/streams/)
5. [RabbitMQ Best Practices](https://www.rabbitmq.com/docs/best-practices)

## 相关阅读

- [Apache Pulsar 实战：多租户消息系统与 Laravel 集成——对比 Kafka](/categories/消息队列/Apache-Pulsar-多租户消息系统-Laravel集成-对比Kafka/)
- [Redis Stream 实战：消息队列替代方案与消费者组管理 Laravel 踩坑记录](/categories/架构/redis-stream-guide-laravel/)
