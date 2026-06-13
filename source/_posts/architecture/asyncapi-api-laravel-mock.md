---
title: 'AsyncAPI 实战：事件驱动架构的 API 规范——Laravel 微服务中的事件文档化、Mock 与代码生成'
date: 2026-06-04 11:00:00
tags: [AsyncAPI, 事件驱动, 微服务, Laravel, 消息队列, API规范]
keywords: [AsyncAPI, API, Laravel, Mock, 事件驱动架构的, 规范, 微服务中的事件文档化, 与代码生成, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "AsyncAPI 是事件驱动架构的 API 规范标准，本文以 Laravel 微服务为背景，详解如何使用 AsyncAPI 规范消息契约、搭建 Mock 服务器、自动生成 DTO 与消费者骨架代码、在 CI/CD 中集成契约测试。涵盖 Kafka/RabbitMQ/Redis Streams 多 Broker 场景，实现事件通信的文档化、可测试与可治理。"
---


在微服务架构中，REST API 之间的契约可以通过 OpenAPI（Swagger）来规范，团队之间可以基于这份契约并行开发、自动生成客户端 SDK、运行契约测试。但当我们的架构演进到事件驱动模式——服务之间通过 Kafka、RabbitMQ 或 Redis Streams 进行异步通信时，OpenAPI 就显得力不从心了。

本文将从一个 Laravel 微服务开发者的视角，详细介绍如何使用 AsyncAPI 来规范事件驱动架构中的消息契约，实现事件文档化、Mock 服务器搭建、代码生成，以及在 CI/CD 流水线中集成契约测试。

<!-- more -->

## 为什么需要 AsyncAPI？

### 事件驱动架构中的痛点

假设我们正在开发一个 B2C 电商平台，系统被拆分为以下微服务：

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  用户服务    │    │  订单服务    │    │  库存服务    │
│  user-svc   │    │  order-svc  │    │  stock-svc  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       │          ┌───────┴───────┐          │
       │          │               │          │
       ▼          ▼               ▼          ▼
  ┌─────────────────────────────────────────────┐
  │           消息中间件 (Kafka/RabbitMQ)         │
  │  user.registered  │  order.created          │
  │  user.updated     │  order.paid             │
  │  user.deleted     │  order.cancelled        │
  └─────────────────────────────────────────────┘
       │          │               │          │
       ▼          ▼               ▼          ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ 支付服务  │ │ 通知服务  │ │ 物流服务  │ │ 积分服务  │
  │ pay-svc  │ │notify-svc│ │ship-svc  │ │point-svc │
  └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

在这个架构中，服务间的协作完全依赖异步消息。但随之而来的问题非常现实：

**第一，消息格式没有统一文档。** 订单服务发出的 `order.created` 事件到底包含哪些字段？数据类型是什么？通知服务的开发者需要翻看订单服务的源码才能知道。当订单服务重构了事件类却没有通知下游，通知服务就可能在生产环境崩溃。

**第二，联调成本极高。** 开发通知服务时，必须先启动消息中间件、跑起整个订单服务、手动下一单才能触发事件。这种端到端的联调方式效率极低。

**第三，缺乏契约保障。** 即使服务间有口头约定，但没有任何机制能够在 CI 阶段检测到契约是否被破坏。

### AsyncAPI 是什么

AsyncAPI 是一个开源规范项目，用于定义异步 API 的标准。它之于事件驱动架构，就如同 OpenAPI 之于 REST API。AsyncAPI 规范允许我们用 YAML 或 JSON 格式来描述：

- 服务间通过哪些**频道（Channels）** 通信
- 每个频道上传输的**消息（Messages）** 结构
- 消息的**数据模式（Schemas）** 与验证规则
- 通信的**绑定协议（Bindings）**，如 Kafka、AMQP、Redis 等

### AsyncAPI 与 OpenAPI 的对比

| 特性 | OpenAPI | AsyncAPI |
|------|---------|----------|
| 通信模式 | 同步请求-响应 | 异步发布-订阅 / 点对点 |
| 核心概念 | Paths + Operations | Channels + Messages |
| 协议支持 | HTTP | Kafka, AMQP, MQTT, Redis, WebSocket 等 |
| 代码生成 | 客户端/服务端 SDK | 生产者/消费者代码 |
| 社区工具 | Swagger UI, Codegen | AsyncAPI Studio, Generator, CLI |

关键区别在于：OpenAPI 描述的是"客户端请求一个资源，服务端返回结果"，而 AsyncAPI 描述的是"一个生产者发出一条消息，一个或多个消费者接收处理"。两者不是替代关系，而是互补关系——在微服务中，服务间通常同时使用 REST 同步调用和事件异步通信。

## AsyncAPI 规范深度解析

### 规范整体结构

让我们直接看一个贴近实战的完整示例。以电商订单事件为例：

```yaml
asyncapi: '3.0.0'
info:
  title: Order Service Events
  version: '1.2.0'
  description: |
    订单服务发出的事件规范，供下游服务（通知、库存、支付、物流）订阅消费。
  contact:
    name: 平台架构组
    email: arch@company.com

servers:
  production:
    host: kafka-broker-01.company.com:9092
    protocol: kafka
    description: 生产环境 Kafka 集群
  staging:
    host: staging-kafka.company.com:9092
    protocol: kafka
    description: 预发布环境

defaultContentType: application/json
```

这里 `info` 元数据非常关键——在团队规模扩大后，谁负责这个事件、版本号是多少、去哪里找人，这些信息都是维护契约的基础设施。`servers` 部分定义了不同环境的 Broker 地址。

### 频道（Channels）

频道是 AsyncAPI 的核心概念，对应消息中间件中的 Topic、Queue 或 Channel：

```yaml
channels:
  order.created:
    address: order.events.created
    description: 当用户成功创建订单后发出
    messages:
      orderCreated:
        $ref: '#/components/messages/OrderCreated'
    bindings:
      kafka:
        topic: order.events.created
        partitions: 12
        replicas: 3

  order.paid:
    address: order.events.paid
    description: 当订单支付成功后发出
    messages:
      orderPaid:
        $ref: '#/components/messages/OrderPaid'

  order.cancelled:
    address: order.events.cancelled
    description: 当订单被取消（用户取消或超时未支付）
    messages:
      orderCancelled:
        $ref: '#/components/messages/OrderCancelled'
```

`address` 是逻辑地址，`bindings` 中可以配置协议特定的细节。对于 Kafka，可以指定 topic 名称、分区数、副本因子；对于 RabbitMQ，可以指定 exchange、routing key 等。

### 消息（Messages）与模式（Schemas）

消息定义是整个规范中最有价值的部分——它精确描述了每条消息的结构：

```yaml
components:
  messages:
    OrderCreated:
      name: order.created
      title: 订单创建事件
      summary: 用户成功创建订单后发出的事件
      contentType: application/json
      headers:
        type: object
        properties:
          correlationId:
            type: string
            format: uuid
            description: 请求追踪 ID
          timestamp:
            type: string
            format: date-time
      payload:
        $ref: '#/components/schemas/OrderCreatedPayload'
      examples:
        - name: 普通订单示例
          headers:
            correlationId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
            timestamp: '2026-06-01T10:30:00Z'
          payload:
            orderId: 'ORD-20260601-000001'
            userId: 10086
            totalAmount: 299.00
            currency: 'CNY'
            items:
              - productId: 'SKU-A001'
                productName: '无线蓝牙耳机'
                quantity: 1
                unitPrice: 299.00
            shippingAddress:
              province: '广东省'
              city: '深圳市'
              district: '南山区'
              detail: '科技园南路 XX 号'
            createdAt: '2026-06-01T10:30:00Z'

  schemas:
    OrderCreatedPayload:
      type: object
      required:
        - orderId
        - userId
        - totalAmount
        - currency
        - items
        - shippingAddress
        - createdAt
      properties:
        orderId:
          type: string
          pattern: '^ORD-\d{8}-\d{6}$'
          description: 订单号，格式 ORD-YYYYMMDD-NNNNNN
          examples: ['ORD-20260601-000001']
        userId:
          type: integer
          minimum: 1
          description: 用户 ID
        totalAmount:
          type: number
          format: float
          minimum: 0.01
          description: 订单总金额
        currency:
          type: string
          enum: ['CNY', 'USD', 'EUR']
          description: 货币类型
        items:
          type: array
          minItems: 1
          items:
            $ref: '#/components/schemas/OrderItem'
        shippingAddress:
          $ref: '#/components/schemas/Address'
        createdAt:
          type: string
          format: date-time

    OrderItem:
      type: object
      required: [productId, productName, quantity, unitPrice]
      properties:
        productId:
          type: string
        productName:
          type: string
        quantity:
          type: integer
          minimum: 1
        unitPrice:
          type: number
          format: float
          minimum: 0

    Address:
      type: object
      required: [province, city, district, detail]
      properties:
        province:
          type: string
        city:
          type: string
        district:
          type: string
        detail:
          type: string
```

注意 payload 中的 `required` 字段和 `pattern` 验证——这些约束就是契约的核心。当订单服务修改了 `orderId` 的格式，契约测试会立即发现并阻止不兼容的变更。

### 协议绑定（Bindings）

AsyncAPI 的 Bindings 机制允许我们为不同消息中间件配置协议特有参数：

```yaml
# Kafka 绑定
bindings:
  kafka:
    topic: order.events.created
    partitions: 12
    replicas: 3
    key:
      type: string
      description: 使用 orderId 作为分区键，保证同一订单的事件有序

# RabbitMQ 绑定
bindings:
  amqp:
    exchange:
      name: order.events
      type: topic
      durable: true
    routingKey: order.created
    queue:
      name: notification-service.order.created
      durable: true
      exclusive: false
      autoDelete: false

# Redis Streams 绑定
bindings:
  redis:
    channel: order:events:created
    method: xadd
```

在 Laravel 项目中，你可以根据实际使用的消息中间件选择对应的 binding 配置。很多团队在开发环境使用 Redis Streams（轻量），生产环境使用 Kafka（高吞吐），AsyncAPI 规范可以同时在 `servers` 和 `bindings` 中描述这两种场景。

### 操作（Operations）

AsyncAPI 3.0 引入了 Operations 来描述服务的行为——谁生产、谁消费：

```yaml
operations:
  emitOrderCreated:
    action: send
    channel:
      $ref: '#/channels/order.created'
    summary: 订单服务发出订单创建事件
    bindings:
      kafka:
        groupId: order-service-producer

  onOrderCreated:
    action: receive
    channel:
      $ref: '#/channels/order.created'
    summary: 各下游服务消费订单创建事件
    bindings:
      kafka:
        groupId: notification-service
```

`action: send` 表示生产者发送消息，`action: receive` 表示消费者接收消息。

## Laravel 中的事件驱动架构模式

### 在 Laravel 中发送异步事件

在 Laravel 微服务中，我们通常将事件分为两类：本地事件（用于本服务内的解耦）和集成事件（用于跨服务通信）。后者才是需要 AsyncAPI 规范化的对象。

```php
<?php

namespace App\Events\Integration;

use App\DTOs\OrderCreatedDTO;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderCreatedIntegrationEvent
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly OrderCreatedDTO $order
    ) {}

    public function toPayload(): array
    {
        return [
            'orderId'        => $this->order->orderId,
            'userId'         => $this->order->userId,
            'totalAmount'    => $this->order->totalAmount,
            'currency'       => $this->order->currency,
            'items'          => $this->order->items,
            'shippingAddress' => $this->order->shippingAddress,
            'createdAt'      => $this->order->createdAt->toIso8601String(),
        ];
    }
}
```

事件监听器负责将消息发送到消息中间件：

```php
<?php

namespace App\Listeners\Integration;

use App\Events\Integration\OrderCreatedIntegrationEvent;
use App\Services\MessageBroker\MessageBrokerInterface;
use Illuminate\Contracts\Queue\ShouldQueue;

class PublishOrderCreatedToBroker implements ShouldQueue
{
    public function __construct(
        private readonly MessageBrokerInterface $broker
    ) {}

    public function handle(OrderCreatedIntegrationEvent $event): void
    {
        $this->broker->publish(
            topic: 'order.events.created',
            key: $event->order->orderId,
            payload: $event->toPayload(),
            headers: [
                'correlationId' => request()->header('X-Correlation-Id', ''),
                'eventType'     => 'order.created',
                'version'       => '1.2.0',
                'timestamp'     => now()->toIso8601String(),
            ]
        );
    }
}
```

消息中间件适配层：

```php
<?php

namespace App\Services\MessageBroker;

class KafkaBroker implements MessageBrokerInterface
{
    public function __construct(
        private readonly string $brokers
    ) {}

    public function publish(
        string $topic,
        string $key,
        array $payload,
        array $headers = []
    ): void {
        $conf = new \RdKafka\Conf();
        $conf->set('metadata.broker.list', $this->brokers);

        $producer = new \RdKafka\Producer($conf);
        $topicInstance = $producer->newTopic($topic);

        $topicInstance->produce(
            RD_KAFKA_PARTITION_UA,
            0,
            json_encode($payload, JSON_UNESCAPED_UNICODE),
            $key
        );

        $producer->flush(5000);
    }
}
```

### 消费者端实现

```php
<?php

namespace App\Listeners\Integration;

use App\Services\MessageBroker\ConsumerInterface;
use App\Services\NotificationService;

class OrderCreatedConsumer implements ConsumerInterface
{
    public function __construct(
        private readonly NotificationService $notificationService
    ) {}

    public function getTopic(): string
    {
        return 'order.events.created';
    }

    public function getGroupId(): string
    {
        return 'notification-service';
    }

    public function handle(array $payload, array $headers): void
    {
        // 1. 根据 AsyncAPI 规范验证消息格式
        $this->validatePayload($payload);

        // 2. 业务处理
        $this->notificationService->sendOrderConfirmation(
            userId: $payload['userId'],
            orderId: $payload['orderId'],
            items: $payload['items']
        );
    }

    private function validatePayload(array $payload): void
    {
        // 使用 AsyncAPI 生成的验证器（后文详述）
        $validator = new OrderCreatedPayloadValidator();
        $validator->validateOrFail($payload);
    }
}
```

## 使用 AsyncAPI Generator 进行代码生成

AsyncAPI Generator 是官方提供的代码生成工具，支持为多种语言和框架生成代码。

### 安装与配置

```bash
# 安装 AsyncAPI CLI
npm install -g @asyncapi/cli

# 验证规范文件
asyncapi validate asyncapi/order-service.yaml

# 生成 HTML 文档
asyncapi generate fromTemplate asyncapi/order-service.yaml \
  @asyncapi/html-template -o docs/events
```

### 生成 PHP 消息验证器

虽然 AsyncAPI Generator 目前对 PHP 的原生支持不如 Node.js/Java 成熟，但我们可以使用社区模板或自定义模板来生成 PHP 代码：

```bash
# 使用自定义模板生成 PHP DTO 和验证器
asyncapi generate fromTemplate asyncapi/order-service.yaml \
  @company/asyncapi-php-template \
  -o app/Generated \
  --param namespace=App\\Generated\\AsyncAPI
```

生成的 PHP DTO 类如下所示：

```php
<?php

namespace App\Generated\AsyncAPI\Schemas;

use App\Generated\AsyncAPI\BaseSchema;
use App\Generated\AsyncAPI\ValidationException;

class OrderCreatedPayload extends BaseSchema
{
    public string $orderId;
    public int $userId;
    public float $totalAmount;
    public string $currency;
    /** @var OrderItem[] */
    public array $items;
    public Address $shippingAddress;
    public string $createdAt;

    private const REQUIRED_FIELDS = [
        'orderId', 'userId', 'totalAmount',
        'currency', 'items', 'shippingAddress', 'createdAt'
    ];

    private const ORDER_ID_PATTERN = '/^ORD-\d{8}-\d{6}$/';

    public static function fromArray(array $data): self
    {
        // 检查必填字段
        foreach (self::REQUIRED_FIELDS as $field) {
            if (!array_key_exists($field, $data)) {
                throw new ValidationException("缺少必填字段: {$field}");
            }
        }

        // 验证 orderId 格式
        if (!preg_match(self::ORDER_ID_PATTERN, $data['orderId'])) {
            throw new ValidationException(
                "orderId 格式不匹配: {$data['orderId']}"
            );
        }

        // 验证金额
        if ($data['totalAmount'] < 0.01) {
            throw new ValidationException('totalAmount 必须大于 0');
        }

        // 验证货币
        if (!in_array($data['currency'], ['CNY', 'USD', 'EUR'])) {
            throw new ValidationException("不支持的货币: {$data['currency']}");
        }

        $instance = new self();
        $instance->orderId = $data['orderId'];
        $instance->userId = $data['userId'];
        $instance->totalAmount = $data['totalAmount'];
        $instance->currency = $data['currency'];
        $instance->items = array_map(
            fn(array $item) => OrderItem::fromArray($item),
            $data['items']
        );
        $instance->shippingAddress = Address::fromArray($data['shippingAddress']);
        $instance->createdAt = $data['createdAt'];

        return $instance;
    }
}
```

有了自动生成的验证器，在消费者端就可以直接调用 `OrderCreatedPayload::fromArray($payload)` 来确保接收到的消息符合契约。

### 生成消费者框架代码

更实用的做法是生成消费者骨架代码，开发者只需填充业务逻辑：

```php
<?php
// 此文件由 asyncapi-generator 自动生成，请勿手动修改
// 来源: asyncapi/order-service.yaml
// 版本: 1.2.0
// 生成时间: 2026-06-01T10:00:00Z

namespace App\Generated\AsyncAPI\Consumers;

use App\Generated\AsyncAPI\Schemas\OrderCreatedPayload;

/**
 * 消费频道: order.events.created
 * 消息类型: OrderCreated
 * 消费组: notification-service
 */
abstract class AbstractOrderCreatedConsumer
{
    abstract protected function handleOrderCreated(
        OrderCreatedPayload $payload,
        array $headers
    ): void;

    public function consume(string $rawPayload, array $rawHeaders): void
    {
        $payload = OrderCreatedPayload::fromArray(
            json_decode($rawPayload, true)
        );

        $this->handleOrderCreated($payload, $rawHeaders);
    }
}
```

## Mock 服务器：脱离真实 Broker 的开发体验

### AsyncAPI Mock Server 工作原理

AsyncAPI 的 Mock 服务器根据规范中的 `examples` 自动生成模拟消息，无需启动真实的 Kafka 或 RabbitMQ。这对本地开发和前端联调极为有用。

```
┌─────────────────────────────────────────┐
│           AsyncAPI Mock Server          │
│                                         │
│  1. 读取 asyncapi.yaml                  │
│  2. 解析 channels/messages/examples     │
│  3. 启动 WebSocket 服务                  │
│  4. 按配置间隔发送模拟消息                  │
│                                         │
└──────────────┬──────────────────────────┘
               │ WebSocket
               ▼
┌─────────────────────────────────────────┐
│        Laravel 消费者应用                 │
│                                         │
│  OrderCreatedConsumer                   │
│  OrderPaidConsumer                      │
│  OrderCancelledConsumer                 │
└─────────────────────────────────────────┘
```

### 使用 AsyncAPI CLI 启动 Mock

```bash
# 安装并启动 Mock 服务器
asyncapi mock asyncapi/order-service.yaml

# 指定频道和间隔
asyncapi mock asyncapi/order-service.yaml \
  --channel order.created \
  --interval 5000
```

### Laravel 中集成 Mock 连接

在 `.env` 中通过环境变量切换真实 Broker 和 Mock 服务器：

```php
// config/messaging.php
return [
    'driver' => env('MESSAGE_BROKER_DRIVER', 'kafka'),

    'mock' => [
        'enabled' => env('MOCK_BROKER_ENABLED', false),
        'host'    => env('MOCK_BROKER_HOST', 'ws://localhost:3000'),
    ],

    'kafka' => [
        'brokers' => env('KAFKA_BROKERS', 'localhost:9092'),
    ],

    'rabbitmq' => [
        'host'     => env('RABBITMQ_HOST', 'localhost'),
        'port'     => env('RABBITMQ_PORT', 5672),
        'user'     => env('RABBITMQ_USER', 'guest'),
        'password' => env('RABBITMQ_PASSWORD', 'guest'),
    ],

    'redis' => [
        'connection' => env('REDIS_CONNECTION', 'default'),
    ],
];
```

本地 `.env` 开发配置：

```env
MESSAGE_BROKER_DRIVER=kafka
KAFKA_BROKERS=localhost:9092
MOCK_BROKER_ENABLED=true
MOCK_BROKER_HOST=ws://localhost:3000
```

## 集成 Kafka、RabbitMQ 和 Redis Streams

### 适配器模式统一接口

在 Laravel 中使用适配器模式来支持多种消息中间件：

```php
<?php

namespace App\Services\MessageBroker;

interface MessageBrokerInterface
{
    public function publish(
        string $topic,
        string $key,
        array $payload,
        array $headers = []
    ): void;
}

interface ConsumerInterface
{
    public function getTopic(): string;
    public function getGroupId(): string;
    public function handle(array $payload, array $headers): void;
}
```

Kafka 适配器：

```php
<?php

namespace App\Services\MessageBroker;

class KafkaBroker implements MessageBrokerInterface
{
    private \RdKafka\Producer $producer;

    public function __construct(string $brokers)
    {
        $conf = new \RdKafka\Conf();
        $conf->set('metadata.broker.list', $brokers);
        $conf->set('queue.buffering.max.ms', 50);
        $conf->set('compression.type', 'snappy');
        $this->producer = new \RdKafka\Producer($conf);
    }

    public function publish(
        string $topic,
        string $key,
        array $payload,
        array $headers = []
    ): void {
        $topicHandle = $this->producer->newTopic($topic);
        $topicHandle->produce(
            RD_KAFKA_PARTITION_UA,
            0,
            json_encode($payload, JSON_UNESCAPED_UNICODE),
            $key
        );
        $this->producer->flush(5000);
    }
}
```

RabbitMQ 适配器：

```php
<?php

namespace App\Services\MessageBroker;

use PhpAmqpLib\Connection\AMQPStreamConnection;
use PhpAmqpLib\Message\AMQPMessage;
use PhpAmqpLib\Wire\AMQPTable;

class RabbitMQBroker implements MessageBrokerInterface
{
    private AMQPStreamConnection $connection;

    public function __construct(
        string $host, int $port,
        string $user, string $password
    ) {
        $this->connection = new AMQPStreamConnection(
            $host, $port, $user, $password
        );
    }

    public function publish(
        string $topic,
        string $key,
        array $payload,
        array $headers = []
    ): void {
        $channel = $this->connection->channel();

        $channel->exchange_declare($topic, 'topic', false, true, false);

        $msg = new AMQPMessage(
            json_encode($payload, JSON_UNESCAPED_UNICODE),
            [
                'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT,
                'content_type'  => 'application/json',
                'application_headers' => new AMQPTable($headers),
                'message_id'    => $key,
            ]
        );

        $channel->basic_publish($msg, $topic, $key);
        $channel->close();
    }
}
```

Redis Streams 适配器：

```php
<?php

namespace App\Services\MessageBroker;

use Illuminate\Support\Facades\Redis;

class RedisStreamsBroker implements MessageBrokerInterface
{
    public function publish(
        string $topic,
        string $key,
        array $payload,
        array $headers = []
    ): void {
        $streamKey = str_replace('.', ':', $topic);

        $entry = array_merge(
            ['payload' => json_encode($payload, JSON_UNESCAPED_UNICODE)],
            $headers
        );

        Redis::xAdd($streamKey, '*', $entry);
    }
}
```

通过 Laravel 的服务容器绑定，可以轻松在不同环境切换驱动：

```php
// AppServiceProvider.php
$this->app->bind(MessageBrokerInterface::function ($app) {
    return match (config('messaging.driver')) {
        'kafka'    => new KafkaBroker(config('messaging.kafka.brokers')),
        'rabbitmq' => new RabbitMQBroker(...),
        'redis'    => new RedisStreamsBroker(),
        default    => throw new \RuntimeException('Unsupported broker'),
    };
});
```

## 契约测试：在 CI/CD 中守护事件一致性

### 契约测试的核心思想

契约测试验证的是：**生产者发出的消息是否符合 AsyncAPI 规范中定义的 schema**。不同于端到端测试，契约测试不需要真实的 Broker——它只验证消息格式。

```
┌──────────────────────────────────────────────────┐
│                   CI 流水线                        │
│                                                  │
│  1. 代码变更 → 触发 CI                            │
│  2. 生产者单元测试生成样本消息                       │
│  3. 使用 AsyncAPI schema 验证样本消息               │
│  4. 验证通过 → 可合并；验证失败 → 阻止合并           │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 使用 PHPUnit 进行契约测试

```php
<?php

namespace Tests\Unit\Contract;

use App\Events\Integration\OrderCreatedIntegrationEvent;
use App\DTOs\OrderCreatedDTO;
use App\DTOs\OrderItemDTO;
use App\DTOs\AddressDTO;
use App\Generated\AsyncAPI\Schemas\OrderCreatedPayload;
use App\Generated\AsyncAPI\ValidationException;
use Tests\TestCase;
use Opis\JsonSchema\Validator;
use Opis\JsonSchema\Resolvers\SchemaResolver;

class OrderCreatedContractTest extends TestCase
{
    private array $asyncapiSchema;

    protected function setUp(): void
    {
        parent::setUp();

        // 加载 AsyncAPI 规范中提取的 JSON Schema
        $this->asyncapiSchema = json_decode(
            file_get_contents(base_path('asyncapi/schemas/order-created.json')),
            true
        );
    }

    public function test_event_payload_matches_asyncapi_schema(): void
    {
        // 1. 构造一个真实的事件
        $dto = new OrderCreatedDTO(
            orderId: 'ORD-20260601-000001',
            userId: 10086,
            totalAmount: 299.00,
            currency: 'CNY',
            items: [
                new OrderItemDTO('SKU-A001', '无线蓝牙耳机', 1, 299.00),
            ],
            shippingAddress: new AddressDTO(
                '广东省', '深圳市', '南山区', '科技园南路 XX 号'
            ),
            createdAt: now()
        );

        $event = new OrderCreatedIntegrationEvent($dto);
        $payload = $event->toPayload();

        // 2. 用生成的 DTO 类验证
        $parsed = OrderCreatedPayload::fromArray($payload);
        $this->assertNotEmpty($parsed->orderId);

        // 3. 用 JSON Schema 验证器严格验证
        $validator = new Validator();
        $result = $validator->validate($payload, $this->asyncapiSchema);

        $this->assertTrue(
            $result->isValid(),
            '消息格式不符合 AsyncAPI 规范: ' .
            json_encode($result->error(), JSON_UNESCAPED_UNICODE)
        );
    }

    public function test_event_payload_fails_with_missing_required_field(): void
    {
        $invalidPayload = [
            'orderId' => 'ORD-20260601-000001',
            // 缺少 userId
            'totalAmount' => 299.00,
            'currency' => 'CNY',
            'items' => [],
            'shippingAddress' => [
                'province' => '广东省',
                'city' => '深圳市',
                'district' => '南山区',
                'detail' => '科技园南路 XX 号',
            ],
            'createdAt' => '2026-06-01T10:30:00Z',
        ];

        $validator = new Validator();
        $result = $validator->validate($invalidPayload, $this->asyncapiSchema);

        $this->assertFalse($result->isValid());
    }
}
```

### 消费者端契约测试

```php
<?php

namespace Tests\Unit\Contract;

use App\Generated\AsyncAPI\Schemas\OrderCreatedPayload;
use App\Generated\AsyncAPI\ValidationException;
use Tests\TestCase;

class ConsumerContractTest extends TestCase
{
    public function test_consumer_can_parse_valid_example_from_asyncapi(): void
    {
        // 直接使用 AsyncAPI 规范中的示例消息
        $examplePayload = [
            'orderId'        => 'ORD-20260601-000001',
            'userId'         => 10086,
            'totalAmount'    => 299.00,
            'currency'       => 'CNY',
            'items'          => [
                [
                    'productId'   => 'SKU-A001',
                    'productName' => '无线蓝牙耳机',
                    'quantity'    => 1,
                    'unitPrice'   => 299.00,
                ],
            ],
            'shippingAddress' => [
                'province' => '广东省',
                'city'     => '深圳市',
                'district' => '南山区',
                'detail'   => '科技园南路 XX 号',
            ],
            'createdAt'      => '2026-06-01T10:30:00Z',
        ];

        // 确保消费者能成功解析 AsyncAPI 定义的示例
        $payload = OrderCreatedPayload::fromArray($examplePayload);

        $this->assertEquals('ORD-20260601-000001', $payload->orderId);
        $this->assertCount(1, $payload->items);
        $this->assertEquals('CNY', $payload->currency);
    }
}
```

## CI/CD 流水线集成

### GitHub Actions 配置

```yaml
# .github/workflows/asyncapi-contract.yml
name: AsyncAPI Contract Tests

on:
  push:
    paths:
      - 'asyncapi/**'
      - 'app/Events/Integration/**'
      - 'app/Generated/AsyncAPI/**'
  pull_request:
    paths:
      - 'asyncapi/**'
      - 'app/Events/Integration/**'

jobs:
  validate-spec:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install AsyncAPI CLI
        run: npm install -g @asyncapi/cli

      - name: Validate AsyncAPI Spec
        run: asyncapi validate asyncapi/order-service.yaml

      - name: Generate Documentation
        run: |
          asyncapi generate fromTemplate asyncapi/order-service.yaml \
            @asyncapi/html-template -o docs/events

  contract-tests:
    runs-on: ubuntu-latest
    needs: validate-spec
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: rdkafka

      - name: Install Dependencies
        run: composer install --no-progress

      - name: Run Contract Tests
        run: php artisan test --filter=ContractTest

      - name: Diff Schema Changes
        if: github.event_name == 'pull_request'
        run: |
          echo "### AsyncAPI Schema 变更" >> $GITHUB_STEP_SUMMARY
          diff <(git show origin/main:asyncapi/order-service.yaml) \
               asyncapi/order-service.yaml || true
```

### 版本管理策略

AsyncAPI 规范文件应该和代码一起版本控制，并遵循语义化版本：

```yaml
info:
  version: '1.2.0'
  # MAJOR: 不兼容的变更（删除字段、修改类型）
  # MINOR: 向后兼容的新增（增加可选字段、新增频道）
  # PATCH: 文档修正、示例更新
```

推荐使用 `asyncapi-diff` 工具检测版本间的不兼容变更：

```bash
# 安装 diff 工具
npm install -g @asyncapi/diff

# 检测规范变更的兼容性
asyncapi diff asyncapi/order-service-v1.yaml asyncapi/order-service.yaml \
  --format=markdown \
  --output=CHANGES.md
```

## 实战案例：B2C 电商平台的事件规范治理

### 规范文件目录结构

在一个典型的 Laravel 微服务项目中，我们这样组织 AsyncAPI 相关文件：

```
order-service/
├── asyncapi/
│   ├── order-service.yaml          # 主规范文件
│   ├── schemas/
│   │   ├── order-created.json      # 提取的 JSON Schema
│   │   ├── order-paid.json
│   │   └── order-cancelled.json
│   ├── examples/
│   │   ├── order-created.json      # 丰富的示例消息
│   │   └── order-paid.json
│   └── bindings/
│       ├── kafka.yaml              # 协议绑定配置
│       └── rabbitmq.yaml
├── app/
│   ├── Events/
│   │   └── Integration/
│   │       ├── OrderCreatedIntegrationEvent.php
│   │       ├── OrderPaidIntegrationEvent.php
│   │       └── OrderCancelledIntegrationEvent.php
│   ├── Generated/
│   │   └── AsyncAPI/               # 自动生成的代码
│   │       ├── Schemas/
│   │       │   ├── OrderCreatedPayload.php
│   │       │   └── OrderPaidPayload.php
│   │       └── Consumers/
│   │           └── AbstractOrderCreatedConsumer.php
│   └── Listeners/
│       └── Integration/
│           └── PublishOrderCreatedToBroker.php
└── tests/
    └── Unit/
        └── Contract/
            ├── OrderCreatedContractTest.php
            └── ConsumerContractTest.php
```

### 多服务事件治理

当平台规模扩大到十几个微服务时，建议将所有 AsyncAPI 规范集中管理：

```
platform-events/
├── README.md
├── services/
│   ├── user-service.yaml
│   ├── order-service.yaml
│   ├── payment-service.yaml
│   ├── inventory-service.yaml
│   ├── notification-service.yaml
│   └── shipping-service.yaml
├── shared-schemas/
│   ├── common.yaml                 # 通用模式（金额、地址、用户信息）
│   └── error-event.yaml           # 错误事件规范
└── .github/
    └── workflows/
        └── validate-all.yml       # 批量校验所有规范
```

每个服务的开发者修改自己的 AsyncAPI 规范时，CI 会自动运行：

1. **语法校验**：确保 YAML 格式正确
2. **引用检查**：确保所有 `$ref` 指向的 schema 存在
3. **兼容性检查**：确保 minor/patch 版本的变更向后兼容
4. **文档生成**：自动生成最新的事件文档站点

### 生成交互式文档

```bash
# 生成并部署事件文档站点
asyncapi generate fromTemplate \
  platform-events/services/order-service.yaml \
  @asyncapi/html-template \
  --param=baseHref=/events/order-service/ \
  --param=sidebarOrganization=byTags \
  -o docs-output/order-service
```

生成的文档站点支持：

- 浏览所有频道和消息定义
- 查看消息示例
- 交互式消息验证（输入 JSON 自动校验）
- 按协议过滤（只看 Kafka 或只看 RabbitMQ）

## 常见陷阱与最佳实践

### 避免过度设计

不要一开始就为整个平台定义所有事件。推荐渐进式推进：

1. 从一个最痛的服务间通信开始（比如 order → notification）
2. 完成该通信的 AsyncAPI 规范、契约测试、文档生成
3. 在团队内推广，让其他服务间通信也接入
4. 最终建立统一的事件目录

### 消息设计原则

**事件应该是事实的记录，而不是命令。** `OrderCreated` 比 `SendNotification` 更好——前者描述了发生了什么，后者描述了要做什么。这让多个消费者可以根据同一个事件做出不同的反应。

**消息应包含消费者所需的所有数据。** 如果通知服务需要订单详情，那 `OrderCreated` 事件就应该包含订单信息，而不是只包含订单 ID 让通知服务再去查询。这种"事件携带"模式减少了服务间的耦合，但也需要注意消息体积。

**版本演进策略：** 新增可选字段用 minor 版本；删除字段或修改类型必须用 major 版本，并通知所有下游服务迁移。

### 与 Laravel Event Sourcing 结合

如果你使用 `spatie/laravel-event-sourcing` 等包实现 Event Sourcing，AsyncAPI 规范同样适用于 CQRS 中的事件存储——将领域事件和集成事件分离，只对集成事件做 AsyncAPI 规范化。

## 总结

AsyncAPI 为事件驱动架构提供了标准化的契约描述方式。对 Laravel 微服务开发者而言，它的核心价值在于：

**文档化**——消除了"翻源码看事件格式"的低效方式，所有消息格式集中在一份 YAML 规范中。

**代码生成**——从规范自动生成 DTO、验证器和消费者骨架代码，减少手工编写 boilerplate。

**Mock 开发**——开发者无需启动真实 Broker 即可进行本地开发和调试。

**契约测试**——在 CI/CD 中自动检测消息格式的不兼容变更，防止生产环境事故。

**团队协作**——前端、后端、QA 可以基于同一份规范并行开发，AsyncAPI 规范就是团队间的"事件通信合同"。

如果你的 Laravel 项目已经采用微服务架构并通过消息队列进行服务间通信，那么引入 AsyncAPI 规范将是一个投入产出比极高的改进。从一个服务间的事件通信开始，逐步扩展到全平台事件治理，让事件驱动架构的每一次消息传递都有据可查、有规可循。

## 相关阅读

- [Schema Registry 实战：Confluent/Apicurio API 契约演进——事件驱动系统中的 Schema 兼容性治理](/post/schema-registry-confluent-apicurio-api/)
- [事件驱动架构全景实战：EventBridge/NATS/Pulsar 统一事件总线设计](/post/eventbridge-nats-pulsar/)
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/post/kafka-debezium-cdc-laravel-event-sourcing/)
- [SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案的工程选型](/post/sse-websocket-http-streaming-laravel/)
