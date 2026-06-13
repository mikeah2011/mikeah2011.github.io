---
title: 'Data Contract 实战：Pact-style 数据契约——Laravel 微服务间数据格式的版本化、验证与 Breaking Change 检测'
date: 2026-06-05 10:00:00
tags: [Data Contract, Laravel, 微服务, Pact, API 契约, Breaking Change]
categories:
  - architecture
cover: /images/covers/data-contract-pact-laravel-cover.jpg
description: "深入讲解 Laravel 微服务架构中数据契约（Data Contract）的实战落地：采用 Pact 消费者驱动契约测试模式，实现数据格式版本化、JSON Schema 自动化验证、Breaking Change CI 检测与 can-i-deploy 部署门禁。涵盖同步 API、异步事件、共享数据库三大数据流场景的契约治理全流程。"
---

## 前言：一个凌晨三点的生产事故

凌晨三点，告警电话响起。订单服务刚上线了一个"小改动"——把 `user_id` 从整型改成了 UUID 字符串，支付服务的下游消费逻辑全部崩溃。两个团队各自写了单元测试、各自通过了 CI，但没人知道这个字段类型变了。

这种故事在微服务架构里太常见了。服务之间通过 HTTP/gRPC/消息队列交换数据，但"约定"只存在于口头沟通、飞书文档或者某个人的记忆里。**当约定没有被代码化、没有被自动化守护，Break 只是时间问题。**

这篇文章记录我们团队如何从零开始，在 Laravel 微服务集群中引入 Pact-style 的数据契约机制，实现数据格式的版本化、自动化验证和 Breaking Change 检测。全是踩坑实录，不是教科书。

---

## 一、Data Contract vs API Contract：到底有什么区别？

这两个概念经常被混用，但在实践中关注点完全不同：

| 维度 | API Contract (接口契约) | Data Contract (数据契约) |
|------|------------------------|------------------------|
| **关注点** | 端点、方法、路由、参数签名 | 字段结构、类型、约束、语义 |
| **典型工具** | OpenAPI/Swagger、gRPC Proto | JSON Schema、Avro、Protobuf（数据层） |
| **版本粒度** | API 版本号 (v1, v2) | 字段级别的版本演进策略 |
| **Breaking Change 定义** | 删除端点、改必选参数 | 字段类型变更、删除字段、枚举值收缩 |
| **验证时机** | 请求/响应格式校验 | 事件消息体、数据库迁移、异步数据流 |

简单来说：**API Contract 回答"你能调什么"，Data Contract 回答"你收到的数据长什么样"。**

在微服务架构中，很多数据交换不走 HTTP API——而是通过消息队列（RabbitMQ、Kafka）、事件总线、甚至共享数据库。这些场景下 OpenAPI 管不了，你需要的是 Data Contract。

### 我们的痛点

我们的 Laravel 微服务集群里有三种数据流：

1. **同步 HTTP API**：订单服务调用用户服务获取用户信息
2. **异步事件**：订单创建后发布 `OrderCreated` 事件，支付服务、通知服务消费
3. **共享数据**：多个服务通过 Eloquent 读取同一个数据库的某些表

前两种占了 80% 的线上事故。HTTP API 还好说，有 OpenAPI 可以做 diff；但异步事件完全是"黑盒"——事件发布者改了字段结构，消费者直到上线才知道。

---

## 二、Pact 消费者驱动契约测试：核心理念

### 什么是消费者驱动契约 (CDC)

传统的契约测试是**提供者驱动**的：提供者定义接口，消费者去适配。CDC 反过来——**由消费者定义它期望的数据格式，提供者必须满足所有消费者的期望**。

Pact 是 CDC 的代表框架。核心流程：

```
1. 消费者编写测试：声明"我期望从提供者那里收到这样的数据"
2. 测试运行时生成 Pact 文件（JSON 格式的契约描述）
3. 提供者回放这些契约，验证自己是否能满足所有消费者的期望
4. 两端都通过 → 契约验证通过
```

### 为什么选 Pact 而不是只用 OpenAPI

OpenAPI 是"由内向外"的——开发者写代码，然后生成文档。Pact 是"由外向内"的——消费者先定义期望。

在我们的场景中，关键优势是：

- **异步消息支持**：Pact 支持异步交互（消息 Pact），完美覆盖事件总线场景
- **消费者视角**：不会出现"提供者删了一个消费者在用的字段但文档没更新"的问题
- **Pact Broker**：中心化的契约仓库，支持版本兼容性检查

---

## 三、Laravel 中落地 Pact：完整实战

### 3.1 架构概览

假设我们的系统有三个 Laravel 微服务：

- `order-service`（订单服务）→ 发布 `OrderCreated` 事件
- `payment-service`（支付服务）→ 消费 `OrderCreated`
- `user-service`（用户服务）→ 提供用户信息 API

### 3.2 安装与配置

使用 PHP 版 Pact 库：

```bash
# 在消费者和提供者项目中都安装
composer require pact-foundation/pact-php --dev
```

配置 Pact Broker 地址（我们用 Docker 自托管）：

```php
// config/pact.php
return [
    'broker' => [
        'url'      => env('PACT_BROKER_URL', 'https://pact-broker.internal'),
        'username' => env('PACT_BROKER_USERNAME'),
        'password' => env('PACT_BROKER_PASSWORD'),
        'token'    => env('PACT_BROKER_TOKEN'),
    ],
    'provider_name'   => env('PACT_PROVIDER_NAME', 'order-service'),
    'consumer_name'   => env('PACT_CONSUMER_NAME', 'payment-service'),
];
```

### 3.3 消费者端：定义契约（支付服务）

在 `payment-service` 中编写消费者测试。这里演示异步消息场景——支付服务消费 `OrderCreated` 事件：

```php
<?php
// tests/Pact/OrderCreatedConsumerTest.php

namespace Tests\Pact;

use PhpPact\Consumer\MessageBuilder;
use PhpPact\Standalone\MockService\MockServerConfig;
use PHPUnit\Framework\TestCase;

class OrderCreatedConsumerTest extends TestCase
{
    public function testOrderCreatedEventStructure(): void
    {
        $config = new MockServerConfig();
        $config->setConsumer('payment-service')
               ->setProvider('order-service')
               ->setPactDir(__DIR__ . '/../../pacts');

        $builder = new MessageBuilder($config);

        // 定义消费者期望的消息体结构
        $builder
            ->given('an order has been created')
            ->uponReceiving('OrderCreated event')
            ->withContent([
                'event'     => 'OrderCreated',
                'version'   => '1.0',
                'timestamp' => $this->like('2026-01-01T00:00:00Z'),
                'payload'   => [
                    'order_id'         => $this->like('ORD-20260605-001'),
                    'user_id'          => $this->integer(12345),
                    'total_amount'     => $this->decimal(99.90),
                    'currency'         => $this->regex('CNY|USD|EUR', 'CNY'),
                    'items'            => $this->eachLike([
                        'product_id'    => $this->integer(1),
                        'product_name'  => $this->like('Test Product'),
                        'quantity'      => $this->integer(1),
                        'unit_price'    => $this->decimal(99.90),
                    ]),
                    'shipping_address' => [
                        'province' => $this->like('北京市'),
                        'city'     => $this->like('北京市'),
                        'district' => $this->like('朝阳区'),
                        'detail'   => $this->like('某某路123号'),
                    ],
                ],
            ]);

        $pact = $builder->build();
        $this->verifyOrderCreatedHandler($pact->getMessageContents());
    }

    private function verifyOrderCreatedHandler(array $message): void
    {
        // 模拟消费者处理逻辑，验证能正确解析消息
        $this->assertArrayHasKey('order_id', $message['payload']);
        $this->assertIsString($message['payload']['order_id']);
        $this->assertIsNumeric($message['payload']['user_id']);
        $this->assertIsArray($message['payload']['items']);
        $this->assertNotEmpty($message['payload']['items']);
    }
}
```

运行测试后会在 `pacts/` 目录生成 JSON 契约文件：

```json
{
  "consumer": { "name": "payment-service" },
  "provider": { "name": "order-service" },
  "messages": [
    {
      "description": "OrderCreated event",
      "providerStates": [{ "name": "an order has been created" }],
      "contents": {
        "event": "OrderCreated",
        "payload": {
          "order_id": "ORD-20260605-001",
          "user_id": 12345,
          "total_amount": 99.90,
          "currency": "CNY",
          "items": [...],
          "shipping_address": {...}
        }
      }
    }
  ]
}
```

### 3.4 提供者端：验证契约（订单服务）

在 `order-service` 中验证自己发出的消息能满足所有消费者的期望：

```php
<?php
// tests/Pact/OrderCreatedProviderTest.php

namespace Tests\Pact;

use PhpPact\Standalone\ProviderVerifier\Model\VerifierConfig;
use PhpPact\Standalone\ProviderVerifier\Verifier;
use PHPUnit\Framework\TestCase;

class OrderCreatedProviderTest extends TestCase
{
    public function testVerifyOrderCreatedConsumer(): void
    {
        $config = new VerifierConfig();
        $config->setProviderName('order-service')
               ->addProviderStateUrl('http://localhost:8080/pact-states')
               ->setBrokerUrl('https://pact-broker.internal')
               ->setPublishVerificationResults(true)
               ->setProviderVersion('1.2.3');

        $verifier = new Verifier($config);
        $verifier->addMessage(
            'OrderCreated event',
            function () {
                // 构造一个真实的 OrderCreated 消息
                $order = \App\Models\Order::factory()->create();
                return [
                    'event'     => 'OrderCreated',
                    'version'   => '1.0',
                    'timestamp' => now()->toIso8601String(),
                    'payload'   => [
                        'order_id'         => $order->order_no,
                        'user_id'          => $order->user_id,
                        'total_amount'     => (float) $order->total_amount,
                        'currency'         => $order->currency,
                        'items'            => $order->items->map(fn ($item) => [
                            'product_id'   => $item->product_id,
                            'product_name' => $item->product_name,
                            'quantity'     => $item->quantity,
                            'unit_price'   => (float) $item->unit_price,
                        ])->toArray(),
                        'shipping_address' => $order->shipping_address,
                    ],
                ];
            }
        );

        $result = $verifier->verify();
        $this->assertTrue($result, 'Provider failed to satisfy consumer pact');
    }
}
```

**踩坑记录 #1**：`publishVerificationResults` 必须设为 `true`，否则 Pact Broker 不知道提供者已经验证通过了，消费者端的 `can-i-deploy` 检查会一直失败。

### 3.5 HTTP API 场景的契约

对于同步 HTTP API（如用户服务），使用 HTTP Pact：

```php
<?php
// tests/Pact/UserApiConsumerTest.php

namespace Tests\Pact;

use PhpPact\Consumer\Model\ConsumerRequest;
use PhpPact\Consumer\Model\ProviderResponse;
use PhpPact\Consumer\InteractionBuilder;
use PhpPact\Standalone\MockService\MockServerConfig;
use PHPUnit\Framework\TestCase;

class UserApiConsumerTest extends TestCase
{
    public function testGetUserById(): void
    {
        $config = new MockServerConfig();
        $config->setConsumer('order-service')
               ->setProvider('user-service')
               ->setPactDir(__DIR__ . '/../../pacts');

        $builder = new InteractionBuilder($config);

        // 请求
        $request = new ConsumerRequest();
        $request->setMethod('GET')
                ->setPath('/api/v1/users/12345')
                ->addHeader('Accept', 'application/json')
                ->addHeader('Authorization', 'Bearer test-token');

        // 期望的响应
        $response = new ProviderResponse();
        $response->setStatus(200)
                 ->addHeader('Content-Type', 'application/json')
                 ->setBody([
                     'id'         => 12345,
                     'name'       => '张三',
                     'email'      => 'zhangsan@example.com',
                     'phone'      => '13800138000',
                     'created_at' => '2025-01-15T08:30:00Z',
                     'vip_level'  => 3,
                 ]);

        $builder->uponReceiving('a request for user 12345')
                ->given('user 12345 exists')
                ->with($request)
                ->willRespondWith($response);

        $result = $builder->verify();
        $this->assertTrue($result, 'Interaction verification failed');
    }
}
```

---

## 四、数据格式版本化策略：踩坑最多的部分

### 4.1 版本化方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **URL 版本化** `/api/v1/` `/api/v2/` | 清晰、简单 | 版本膨胀严重、维护成本高 | 公开 API |
| **Header 版本化** `Accept: application/vnd.api.v2+json` | URL 干净 | 客户端实现复杂 | 内部 API |
| **事件 Payload 内嵌版本** `"version": "1.0"` | 最灵活 | 需要消费者做版本路由 | 消息队列事件 |
| **Schema Registry** (Avro/Protobuf) | 强类型、自动兼容性检查 | 引入额外基础设施 | 大规模集群 |

我们选择了**混合方案**：

- HTTP API 用 URL 版本化（`/api/v1/users`）
- 消息队列事件用 Payload 内嵌版本号
- 两种都通过 Pact Broker 统一管理契约

### 4.2 事件版本化实战

在 `order-service` 中，我们用一个版本路由机制来处理不同版本的事件：

```php
<?php
// app/Events/Concerns/Versionable.php

namespace App\Events\Concerns;

trait Versionable
{
    protected string $eventVersion = '1.0';

    public function getEventVersion(): string
    {
        return $this->eventVersion;
    }

    public function setEventVersion(string $version): static
    {
        $this->eventVersion = $version;
        return $this;
    }

    /**
     * 根据版本号选择序列化策略
     */
    public function toPayload(): array
    {
        return match ($this->eventVersion) {
            '1.0' => $this->toV1Payload(),
            '2.0' => $this->toV2Payload(),
            default => throw new \InvalidArgumentException(
                "Unsupported event version: {$this->eventVersion}"
            ),
        };
    }
}
```

```php
<?php
// app/Events/OrderCreated.php

namespace App\Events;

use App\Events\Concerns\Versionable;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderCreated
{
    use Dispatchable, SerializesModels, Versionable;

    public function __construct(
        public readonly \App\Models\Order $order,
    ) {}

    protected function toV1Payload(): array
    {
        return [
            'event'     => 'OrderCreated',
            'version'   => '1.0',
            'timestamp' => now()->toIso8601String(),
            'payload'   => [
                'order_id'         => $this->order->order_no,
                'user_id'          => $this->order->user_id,       // 整型
                'total_amount'     => (float) $this->order->total_amount,
                'currency'         => $this->order->currency,
                'items'            => $this->formatItemsV1(),
                'shipping_address' => $this->order->shipping_address,
            ],
        ];
    }

    protected function toV2Payload(): array
    {
        return [
            'event'     => 'OrderCreated',
            'version'   => '2.0',
            'timestamp' => now()->toIso8601String(),
            'payload'   => [
                'order_id'     => $this->order->order_no,
                'user_id'      => (string) $this->order->uuid,     // 改为 UUID 字符串
                'total_amount' => [
                    'value'    => (string) $this->order->total_amount,
                    'currency' => $this->order->currency,
                ],                                                   // 结构化金额
                'items'        => $this->formatItemsV2(),
                'shipping'     => $this->formatShippingV2(),        // 字段重命名
            ],
        ];
    }

    private function formatItemsV1(): array
    {
        return $this->order->items->map(fn ($item) => [
            'product_id'   => $item->product_id,
            'product_name' => $item->product_name,
            'quantity'     => $item->quantity,
            'unit_price'   => (float) $item->unit_price,
        ])->toArray();
    }

    private function formatItemsV2(): array
    {
        return $this->order->items->map(fn ($item) => [
            'product' => [
                'id'   => $item->product_id,
                'name' => $item->product_name,
            ],
            'quantity'   => $item->quantity,
            'unit_price' => [
                'value'    => (string) $item->unit_price,
                'currency' => $this->order->currency,
            ],
        ])->toArray();
    }

    private function formatShippingV2(): array
    {
        $addr = $this->order->shipping_address;
        return [
            'region'  => $addr['province'] ?? '',
            'city'    => $addr['city'] ?? '',
            'district' => $addr['district'] ?? '',
            'address'  => $addr['detail'] ?? '',
            'postal_code' => $addr['postal_code'] ?? null,
        ];
    }
}
```

**踩坑记录 #2**：v1 到 v2 的 `user_id` 从整型变成 UUID 字符串，这就是我们开头那个凌晨三点事故的根因。有了 Pact 契约后，这种改动在 CI 阶段就会被拦截——因为 `payment-service` 的消费者契约里声明了 `"user_id": 12345`（整型），提供者返回字符串类型，契约验证直接失败。

### 4.3 消费者端的版本兼容处理

```php
<?php
// app/Listeners/HandleOrderCreated.php

namespace App\Listeners;

use App\Events\Contracts\OrderCreatedEvent;

class HandleOrderCreated
{
    public function handle(OrderCreatedEvent $event): void
    {
        $payload = $event->toPayload();

        // 根据版本路由处理逻辑
        match ($payload['version']) {
            '1.0' => $this->handleV1($payload['payload']),
            '2.0' => $this->handleV2($payload['payload']),
            default => $this->handleV1($payload['payload']), // 降级到 v1
        };
    }

    protected function handleV1(array $payload): void
    {
        $userId      = $payload['user_id'];          // int
        $totalAmount = $payload['total_amount'];      // float
        $currency    = $payload['currency'];           // string
        // ...
    }

    protected function handleV2(array $payload): void
    {
        $userId      = $payload['user_id'];           // string UUID
        $totalAmount = $payload['total_amount']['value']; // string
        $currency    = $payload['total_amount']['currency'];
        // ...
    }
}
```

---

## 五、Breaking Change 检测：自动拦截破坏性变更

### 5.1 什么是 Breaking Change

在数据契约语境下，Breaking Change 包括：

| 变更类型 | 是否 Breaking | 说明 |
|---------|:------------:|------|
| 新增可选字段 | ❌ | 消费者忽略未知字段即可 |
| 删除字段 | ✅ | 消费者可能依赖该字段 |
| 字段重命名 | ✅ | 等价于删旧+加新 |
| 字段类型变更 (int→string) | ✅ | 消费者类型解析失败 |
| 枚举值新增 | ❌ | 消费者不关心新值 |
| 枚举值删除 | ✅ | 消费者可能正在使用该值 |
| 必选字段变为必选（从可选） | ✅ | 旧提供者不发该字段 |
| 嵌套结构变更 | ✅ | 子结构的所有规则递归适用 |

### 5.2 使用 oasdiff 检测 OpenAPI Breaking Change

对于 HTTP API，我们用 [oasdiff](https://github.com/Tufin/oasdiff) 做 OpenAPI diff：

```bash
# 安装
brew install oasdiff

# 检测 breaking changes
oasdiff breaking openapi-v1.yaml openapi-v2.yaml
```

在 CI 中集成：

```yaml
# .github/workflows/api-contract-check.yml
name: API Contract Breaking Change Check

on:
  pull_request:
    paths:
      - 'openapi/**'

jobs:
  check-breaking-changes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install oasdiff
        run: |
          curl -sSL https://github.com/Tufin/oasdiff/releases/latest/download/oasdiff_linux_amd64.tar.gz | tar xz
          sudo mv oasdiff /usr/local/bin/

      - name: Get base OpenAPI spec
        run: git show origin/main:openapi/openapi.yaml > /tmp/base-spec.yaml

      - name: Check breaking changes
        run: |
          oasdiff breaking \
            /tmp/base-spec.yaml \
            openapi/openapi.yaml \
            --format yaml \
            --fail-on ERR

      - name: Generate changelog
        if: always()
        run: |
          oasdiff changelog \
            /tmp/base-spec.yaml \
            openapi/openapi.yaml \
            --format markdown > /tmp/changelog.md

      - name: Comment PR with changelog
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const changelog = fs.readFileSync('/tmp/changelog.md', 'utf8');
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## API 契约变更分析\n\n${changelog}`
            });
```

### 5.3 事件契约的 Breaking Change 检测

消息队列事件没有 OpenAPI，需要自建检测。我们基于 JSON Schema diff 实现了一套轻量方案：

```php
<?php
// app/Console/Commands/CheckEventContractChanges.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use JsonSchema\Validator;

class CheckEventContractChanges extends Command
{
    protected $signature = 'pact:check-breaking-changes
                            {--event= : 事件名称}
                            {--old-version= : 旧版本号}
                            {--new-version= : 新版本号}';

    protected $description = '检测事件数据契约的破坏性变更';

    private array $breakingChanges = [];

    public function handle(): int
    {
        $event      = $this->option('event');
        $oldVersion = $this->option('old-version');
        $newVersion = $this->option('new-version');

        $basePath = base_path("contracts/events/{$event}");
        $oldSchema = json_decode(
            File::get("{$basePath}/v{$oldVersion}/schema.json"), true
        );
        $newSchema = json_decode(
            File::get("{$basePath}/v{$newVersion}/schema.json"), true
        );

        $this->compareSchemas($oldSchema, $newSchema, 'payload');

        if (empty($this->breakingChanges)) {
            $this->info("✅ 未检测到破坏性变更");
            return Command::SUCCESS;
        }

        $this->error("❌ 检测到 " . count($this->breakingChanges) . " 个破坏性变更：");
        $this->newLine();

        foreach ($this->breakingChanges as $change) {
            $this->error("  ⚠️  [{$change['type']}] {$change['path']}: {$change['detail']}");
        }

        return Command::FAILURE;
    }

    private function compareSchemas(
        array $old,
        array $new,
        string $path
    ): void {
        // 检查字段删除
        $oldProps = $old['properties'] ?? [];
        $newProps = $new['properties'] ?? [];

        foreach ($oldProps as $field => $oldDef) {
            if (!isset($newProps[$field])) {
                // 字段被删除 → 检查是否是必选字段
                $required = $new['required'] ?? [];
                $oldRequired = $old['required'] ?? [];

                $this->breakingChanges[] = [
                    'type'   => 'FIELD_REMOVED',
                    'path'   => "{$path}.{$field}",
                    'detail' => "字段被删除",
                ];
                continue;
            }

            // 检查类型变更
            $oldType = $oldDef['type'] ?? 'any';
            $newType = $newProps[$field]['type'] ?? 'any';

            if ($oldType !== $newType) {
                $this->breakingChanges[] = [
                    'type'   => 'TYPE_CHANGED',
                    'path'   => "{$path}.{$field}",
                    'detail' => "类型从 {$oldType} 变为 {$newType}",
                ];
                continue;
            }

            // 递归检查嵌套对象
            if ($oldType === 'object' && isset($newProps[$field]['properties'])) {
                $this->compareSchemas(
                    $oldDef,
                    $newProps[$field],
                    "{$path}.{$field}"
                );
            }

            // 检查枚举值收缩
            if (isset($oldDef['enum'])) {
                $oldEnums = $oldDef['enum'];
                $newEnums = $newProps[$field]['enum'] ?? [];
                $removed = array_diff($oldEnums, $newEnums);

                if (!empty($removed)) {
                    $this->breakingChanges[] = [
                        'type'   => 'ENUM_VALUE_REMOVED',
                        'path'   => "{$path}.{$field}",
                        'detail' => "枚举值被移除: " . implode(', ', $removed),
                    ];
                }
            }
        }

        // 检查新增的必选字段
        $newRequired = $new['required'] ?? [];
        $oldRequired = $old['required'] ?? [];
        $addedRequired = array_diff($newRequired, $oldRequired);

        foreach ($addedRequired as $field) {
            $this->breakingChanges[] = [
                'type'   => 'REQUIRED_FIELD_ADDED',
                'path'   => "{$path}.{$field}",
                'detail' => "新增必选字段（旧版本数据不含此字段）",
            ];
        }
    }
}
```

### 5.4 JSON Schema 存储结构

```
contracts/
└── events/
    └── OrderCreated/
        ├── v1.0/
        │   └── schema.json
        ├── v2.0/
        │   └── schema.json
        └── CHANGELOG.md
```

`contracts/events/OrderCreated/v1.0/schema.json`：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["event", "version", "timestamp", "payload"],
  "properties": {
    "event": { "type": "string", "const": "OrderCreated" },
    "version": { "type": "string", "const": "1.0" },
    "timestamp": { "type": "string", "format": "date-time" },
    "payload": {
      "type": "object",
      "required": ["order_id", "user_id", "total_amount", "currency", "items"],
      "properties": {
        "order_id": { "type": "string" },
        "user_id": { "type": "integer" },
        "total_amount": { "type": "number" },
        "currency": { "type": "string", "enum": ["CNY", "USD", "EUR", "JPY"] },
        "items": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["product_id", "product_name", "quantity", "unit_price"],
            "properties": {
              "product_id": { "type": "integer" },
              "product_name": { "type": "string" },
              "quantity": { "type": "integer", "minimum": 1 },
              "unit_price": { "type": "number" }
            }
          }
        },
        "shipping_address": {
          "type": "object",
          "required": ["province", "city", "district", "detail"],
          "properties": {
            "province": { "type": "string" },
            "city": { "type": "string" },
            "district": { "type": "string" },
            "detail": { "type": "string" }
          }
        }
      }
    }
  }
}
```

---

## 六、CI/CD 完整集成方案

把所有检测串到一起，形成完整的守护流水线：

```yaml
# .github/workflows/data-contract-pipeline.yml
name: Data Contract Pipeline

on:
  pull_request:
    paths:
      - 'app/Events/**'
      - 'app/Listeners/**'
      - 'contracts/**'
      - 'openapi/**'
      - 'tests/Pact/**'

jobs:
  # 第一步：JSON Schema 破坏性变更检测
  schema-breaking-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: 8.3

      - name: Install dependencies
        run: composer install --no-progress

      - name: Check event schema breaking changes
        run: |
          for event_dir in contracts/events/*/; do
            event=$(basename "$event_dir")
            versions=($(ls -v "$event_dir" | grep '^v'))
            if [ ${#versions[@]} -ge 2 ]; then
              old="${versions[-2]}"
              new="${versions[-1]}"
              echo "Checking $event: $old → $new"
              php artisan pact:check-breaking-changes \
                --event="$event" \
                --old-version="${old#v}" \
                --new-version="${new#v}"
            fi
          done

  # 第二步：消费者契约生成
  consumer-pact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: 8.3

      - name: Install dependencies
        run: composer install --no-progress

      - name: Run consumer pact tests
        run: vendor/bin/phpunit --testsuite=pact

      - name: Publish pacts
        run: |
          npx @pact-foundation/pact-cli publish pacts/ \
            --consumer-app-version=$(git rev-parse --short HEAD) \
            --branch=${{ github.head_ref }}

  # 第三步：提供者验证
  provider-verify:
    needs: consumer-pact
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: test_db
        ports:
          - 3306:3306

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: 8.3

      - name: Install dependencies
        run: composer install --no-progress

      - name: Setup environment
        run: |
          cp .env.testing .env
          php artisan key:generate
          php artisan migrate --force

      - name: Verify provider pacts from broker
        run: |
          php artisan pact:verify \
            --provider=order-service \
            --broker-url=${{ secrets.PACT_BROKER_URL }}

  # 第四步：部署就绪检查
  can-i-deploy:
    needs: [consumer-pact, provider-verify]
    runs-on: ubuntu-latest
    steps:
      - name: Check can-i-deploy
        run: |
          npx @pact-foundation/pact-cli can-i-deploy \
            --pacticipant=payment-service \
            --version=$(git rev-parse --short HEAD) \
            --to-environment=staging
```

**踩坑记录 #3**：`can-i-deploy` 检查需要 Pact Broker 开启 Webhook 来触发提供者验证。我们一开始没有配置 Webhook，导致提供者端的新代码从未被触发验证，`can-i-deploy` 永远报 "no verification results"。解决方法是在 Broker 中为每个 provider 配置验证 Webhook，指向 CI 的 workflow dispatch。

**踩坑记录 #4**：Pact Broker 的版本号必须唯一且可排序。我们最初用 `git short hash`，但短 hash 不可排序，导致 Broker 的 "latest" 判断逻辑出错。最终改为 `git describe --tags --always`（如 `v1.2.3-5-gabcdef`），问题解决。

---

## 七、生产环境踩坑记录与最佳实践

### 踩坑 #5：Eloquent Cast 导致契约不一致

Laravel Eloquent 的 `$casts` 属性会悄悄改变字段类型。例如：

```php
// Order 模型
protected $casts = [
    'total_amount' => 'decimal:2',  // Eloquent 返回字符串 "99.90"
    'metadata'     => 'array',       // 返回 PHP array
    'paid_at'      => 'datetime',    // 返回 Carbon 实例
];
```

但你的 Pact 契约里可能写的是 `'total_amount' => $this->decimal(99.90)`（float）。序列化后是 `99.9`（去掉尾零），而 `decimal:2` cast 返回 `"99.90"`（字符串）。

**解决方案**：契约测试中的 matcher 必须和 Eloquent 实际输出一致。我们写了一个 trait 统一处理：

```php
<?php
// tests/Concerns/PayloadAssertions.php

namespace Tests\Concerns;

trait PayloadAssertions
{
    protected function assertPayloadMatchesSchema(
        array $payload,
        string $schemaPath
    ): void {
        $schema = json_decode(
            file_get_contents($schemaPath), false
        );

        $validator = new \JsonSchema\Validator();
        $validator->validate(
            json_decode(json_encode($payload)),
            $schema
        );

        if (!$validator->isValid()) {
            $errors = array_map(
                fn ($e) => "{$e->getProperty()}: {$e->getMessage()}",
                $validator->getErrors()
            );
            $this->fail(
                "Payload does not match schema:\n" . implode("\n", $errors)
            );
        }
    }
}
```

### 踩坑 #6：消费者契约"过度约束"

初期有个同事在消费者契约里把所有字段都标记为 required，导致提供者端连加个可选字段都会报 breaking change。

**最佳实践**：消费者契约只声明自己**实际使用**的字段。Pact 的理念是"消费者只关心自己需要的"——你不用的字段，不要写进契约。

### 最佳实践清单

1. **契约即文档**：`contracts/` 目录和代码一起版本管理，不要放在外部系统
2. **向后兼容优先**：新增字段用可选字段，不要改已有字段类型
3. **双写过渡期**：大版本变更时，提供者同时发 v1 和 v2 事件，消费者逐步迁移
4. **Sunset 时间表**：每个旧版本设明确的下线日期，在事件里加 `deprecated_in` 字段
5. **契约测试独立于业务测试**：不要把 Pact 测试和 PHPUnit 单元测试混在一起，单独跑
6. **使用 `can-i-deploy`**：部署前必须过这个门禁，不能跳过

---

## 八、效果与总结

引入 Pact-style 数据契约后的三个月数据：

| 指标 | 之前 | 之后 |
|------|------|------|
| 因数据格式变更导致的生产事故 | 每月 3-5 次 | 0 次 |
| 微服务上线前的回归测试时间 | 2-3 天（人工联调） | 30 分钟（自动化） |
| 跨团队沟通成本 | 高（飞书群里@来@去） | 低（契约就是沟通语言） |
| Breaking Change 发现阶段 | 生产环境 | PR Review 阶段 |

核心价值不是某个工具，而是**把"约定"从人脑搬到了代码里**。当约定有了代码表达、有了自动化守护、有了 CI 门禁，微服务之间的信任就有了技术保障。

---

## 九、延伸阅读

- [Pact 官方文档](https://docs.pact.io/)——消费者驱动契约的权威参考
- [oasdiff](https://github.com/Tufin/oasdiff)——OpenAPI diff 和 breaking change 检测
- [Data Contracts by Andrew Jones](https://andrew-jones.com/blog/)——数据契约概念的深度解读
- [Confluent Schema Registry](https://docs.confluent.io/platform/current/schema-registry/)——大规模 Kafka 场景的 Schema 管理
- [json-schema-diff-validator](https://github.com/zowe/json-schema-diff-validator)——JSON Schema diff 工具

---

## 相关阅读

- [Schema Registry 实战：Confluent Apicurio——API 契约演进与 Schema 兼容性治理](/categories/架构/2026-06-03-Schema-Registry-实战-Confluent-Apicurio-API契约演进-Schema兼容性治理/)
- [API 生命周期管理实战：设计、版本控制、废弃通知与客户端迁移——Sunset Header 与 Deprecation 标准](/categories/架构/API生命周期管理实战-设计版本控制废弃通知客户端迁移-Sunset-Header与Deprecation标准/)
- [API Abuse Prevention 实战：Bot 检测、速率限制、指纹识别——Laravel API 反爬与反滥用工程化方案](/categories/架构/API-Abuse-Prevention-实战-Bot检测-速率限制-指纹识别-Laravel-API反爬与反滥用工程化方案/)
- [Go gRPC 实战：高性能微服务通信——Proto 定义、流式调用与 Laravel 集成](/categories/架构/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/)

---

*本文基于作者在 Laravel 微服务架构中的真实实践，部分代码经过脱敏简化。如有疑问欢迎在评论区讨论。*
