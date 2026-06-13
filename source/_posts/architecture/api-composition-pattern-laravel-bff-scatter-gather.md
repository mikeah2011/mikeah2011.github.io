---
title: "API Composition Pattern 实战：跨服务查询聚合——Laravel BFF 中的 scatter-gather、结果合并与超时裁剪"
date: 2026-06-03 14:00:00
tags: [API Composition, BFF, 微服务, Laravel, 架构设计]
keywords: [API Composition Pattern, Laravel BFF, scatter, gather, 跨服务查询聚合, 中的, 结果合并与超时裁剪, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "深入实战API Composition Pattern在Laravel BFF层的落地：scatter-gather并行查询、结果合并策略、超时裁剪与降级方案、缓存优化，对比CQRS与GraphQL Federation的适用场景，含完整可运行代码与性能基准测试，助力微服务数据聚合架构选型。"
---


# API Composition Pattern 实战：跨服务查询聚合——Laravel BFF 中的 scatter-gather、结果合并与超时裁剪

## 一、为什么需要 API Composition：微服务数据分散问题

### 1.1 单体时代的便利与微服务时代的代价

在单体应用中，一次数据库 JOIN 就能将用户信息、订单数据、商品详情拼装成一个完整的首页视图。然而，当我们采用微服务架构后，数据被分散到各自独立的服务中：

- **用户服务** (User Service)：管理用户档案、偏好设置、收货地址
- **商品服务** (Product Service)：管理商品信息、分类、SKU
- **订单服务** (Order Service)：管理订单状态、物流信息
- **库存服务** (Inventory Service)：管理实时库存、仓库分配
- **推荐服务** (Recommendation Service)：基于协同过滤的个性化推荐

前端页面需要的"首页数据"横跨 5 个甚至更多的服务，每个服务都有自己的数据库，无法再通过一条 SQL 完成查询。这就是微服务架构中经典的 **"数据分散问题"（Data Scatter Problem）**。

### 1.2 朴素方案的困境

最直观的做法是让前端直接调用多个微服务：

```javascript
// 前端直接调用多个微服务 —— 朴素方案
const [user, products, orders, inventory] = await Promise.all([
  fetch('https://user-service/api/users/123'),
  fetch('https://product-service/api/recommendations?user_id=123'),
  fetch('https://order-service/api/orders?user_id=123&status=active'),
  fetch('https://inventory-service/api/stock?sku_ids=...'),
]);
```

这个方案存在多个致命问题：

1. **前端复杂度爆炸**：前端需要知道所有微服务的地址、协议、鉴权方式
2. **网络开销**：移动端可能需要发起 5-8 个 HTTP 请求，每个都有 TCP 握手、TLS 协商的开销
3. **安全风险**：将内部服务直接暴露给客户端，增大了攻击面
4. **耦合严重**：服务拆分或合并时，所有前端代码都需要同步修改
5. **无法统一处理超时、重试、熔断等横切关注点**

我们需要一个"中间层"来承担聚合职责——这就是 **API Composition**。

---

## 二、API Composition Pattern 原理与适用场景

### 2.1 模式定义

API Composition Pattern（API 组合模式）是指在服务端设置一个**组合器（Composer）**，由它负责：

1. 接收客户端的聚合查询请求
2. **扇出（Fan-out）**：并行或串行地向多个后端微服务发起调用
3. **收集（Gather）**：汇聚各服务返回的结果
4. **合并（Merge）**：按照预定义策略将多个结果组合为统一的响应结构
5. 返回给客户端一个聚合后的完整数据

```
┌──────────┐
│  Client  │
└────┬─────┘
     │  GET /api/homepage?user_id=123
     ▼
┌─────────────────────────────┐
│     API Composer (BFF)      │
│  ┌───────────────────────┐  │
│  │  1. Parse Request     │  │
│  │  2. Fan-out Calls     │  │
│  │  3. Gather Responses  │  │
│  │  4. Merge & Transform │  │
│  │  5. Return Result     │  │
│  └───────────────────────┘  │
└──┬────┬────┬────┬──────────┘
   │    │    │    │
   ▼    ▼    ▼    ▼
┌────┐┌────┐┌────┐┌────┐
│User││Prod││Ordr││Inv │
│Svc ││Svc ││Svc ││Svc │
└────┘└────┘└────┘└────┘
```

### 2.2 核心原则

- **单一职责**：Composer 只负责查询聚合，不承载业务逻辑
- **无状态**：聚合器本身不持久化数据，每次请求从后端服务获取
- **容错优先**：任何一个下游服务失败不应导致整个聚合失败
- **超时可控**：设置全局超时，对慢服务进行裁剪

### 2.3 适用场景

| 场景 | 适用性 | 说明 |
|------|--------|------|
| 首页/仪表盘聚合 | ✅ 高度适用 | 多服务数据拼装 |
| 搜索结果增强 | ✅ 适用 | 搜索服务 + 详情服务 |
| 跨服务报表 | ✅ 适用 | 多维度数据合并 |
| 写操作协调 | ❌ 不适用 | 应使用 Saga 模式 |
| 强一致性事务 | ❌ 不适用 | 应使用 2PC 或 TCC |

---

## 三、Scatter-Gather 模式详解

### 3.1 模式解析

Scatter-Gather 是 API Composition 的核心执行模式，源自企业集成模式（Enterprise Integration Patterns）：

- **Scatter（散射）**：将一个请求"散射"为多个并行的子请求，发送到不同的目标服务
- **Gather（收集）**：等待所有（或部分）子请求完成，收集结果

```
                    ┌─────────────────┐
                    │   BFF Composer  │
                    └────────┬────────┘
                             │ Scatter (parallel)
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ User Service │ │Product Service│ │ Order Service │
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
           │                │                │
           └────────────────┼────────────────┘
                            ▼ Gather
                    ┌───────────────────┐
                    │  Merged Response  │
                    └───────────────────┘
```

### 3.2 三种执行策略

```php
<?php

// 策略一：并行执行（Parallel Scatter-Gather）
// 所有请求同时发出，等待最慢的那个
$results = Http::pool(fn ($pool) => [
    $pool->get('http://user-service/api/users/123'),
    $pool->get('http://product-service/api/recommend'),
    $pool->get('http://order-service/api/orders/active'),
]);

// 策略二：串行执行（Sequential Gather）
// 前一个结果决定下一个请求的参数
$user     = Http::get('http://user-service/api/users/123')->json();
$orders   = Http::get('http://order-service/api/orders', [
    'user_id' => $user['id']
])->json();
$products = Http::get('http://product-service/api/recommend', [
    'category_ids' => $user['preferred_categories']
])->json();

// 策略三：混合执行（Hybrid）
// 先执行无依赖的并行请求，再根据结果执行后续串行请求
[$user, $categories] = Http::pool(fn ($pool) => [
    $pool->get('http://user-service/api/users/123'),
    $pool->get('http://category-service/api/categories'),
]);
// 基于 user 数据的后续请求
$orders = Http::get('http://order-service/api/orders', [
    'user_id' => $user->json('id')
])->json();
```

### 3.3 Scatter-Gather 的关键指标

在设计 Scatter-Gather 时，需要关注以下指标：

```
总延迟 = max(服务A延迟, 服务B延迟, 服务C延迟) + 合并开销
成功率 = ∏(各服务成功率)  // 只要一个失败，整体就失败（无降级时）
吞吐量受限于：最慢的服务（木桶效应）
```

---

## 四、Laravel BFF（Backend for Frontend）层设计

### 4.1 BFF 架构分层

BFF 是专门为特定前端（Web、iOS、Android、小程序）定制的聚合层。在 Laravel 中，我们通过以下分层实现：

```
┌──────────────────────────────────────────┐
│           Frontend Applications          │
│   Web    │   iOS   │  Android │ 小程序    │
└────┬─────┴────┬────┴────┬─────┴────┬─────┘
     │          │         │          │
     ▼          ▼         ▼          ▼
┌─────────┐┌─────────┐┌─────────┐┌─────────┐
│Web BFF  ││iOS BFF  ││And BFF  ││MP BFF   │
│(Laravel)││(Laravel)││(Laravel)││(Laravel)│
└────┬────┘└────┬────┘└────┬────┘└────┬────┘
     │          │         │          │
     └──────────┴─────────┴──────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   ┌─────────┐┌─────────┐┌─────────┐
   │  User   ││ Product ││  Order  │
   │ Service ││ Service ││ Service │
   └─────────┘└─────────┘└─────────┘
```

### 4.2 Laravel 项目结构设计

```
app/
├── Composers/                      # API 组合器
│   ├── Contracts/
│   │   └── ComposerInterface.php   # 组合器接口
│   ├── HomepageComposer.php        # 首页聚合器
│   ├── OrderDetailComposer.php     # 订单详情聚合器
│   └── SearchComposer.php          # 搜索结果聚合器
├── Services/                       # 下游服务客户端
│   ├── Contracts/
│   │   └── ServiceClientInterface.php
│   ├── UserServiceClient.php
│   ├── ProductServiceClient.php
│   ├── OrderServiceClient.php
│   └── InventoryServiceClient.php
├── Strategies/                     # 合并策略
│   ├── Contracts/
│   │   └── MergeStrategyInterface.php
│   ├── DeepMergeStrategy.php
│   ├── FlatMergeStrategy.php
│   └── ProjectionStrategy.php
├── Transformers/                   # 响应转换器
│   ├── HomepageTransformer.php
│   └── OrderDetailTransformer.php
├── Resilience/                     # 容错机制
│   ├── CircuitBreaker.php
│   ├── FallbackHandler.php
│   └── TimeoutTrimmer.php
├── Cache/                          # 聚合缓存
│   └── ComposerCache.php
└── Http/
    └── Controllers/
        └── Api/
            ├── V1/
            │   ├── HomepageController.php
            │   └── OrderController.php
```

### 4.3 核心接口定义

```php
<?php

namespace App\Composers\Contracts;

interface ComposerInterface
{
    /**
     * 执行聚合查询
     *
     * @param  array  $params  请求参数
     * @return array           聚合后的结果
     */
    public function compose(array $params): array;

    /**
     * 获取此组合器涉及的下游服务名称列表
     * @return string[]
     */
    public function services(): array;

    /**
     * 全局超时（毫秒）
     * @return int
     */
    public function timeout(): int;
}
```

---

## 五、使用 Laravel HTTP Client 并发请求多个微服务

### 5.1 Laravel HTTP Pool 基础

Laravel 内置的 HTTP Client（基于 Guzzle）提供了优雅的并发请求 API：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;

class ServicePool
{
    /**
     * 并发请求多个微服务
     *
     * @param  array<string, array{url: string, params?: array}>  $requests
     * @param  int  $timeout  超时秒数
     * @return array<string, Response>
     */
    public function scatter(array $requests, int $timeout = 5): array
    {
        $responses = Http::pool(function (Pool $pool) use ($requests, $timeout) {
            $promises = [];
            foreach ($requests as $key => $config) {
                $url = $config['url'];
                $params = $config['params'] ?? [];
                $promises[$key] = $pool->timeout($timeout)
                    ->withHeaders([
                        'X-Request-ID' => request()->header('X-Request-ID'),
                        'X-Trace-ID'   => app('trace-id'),
                    ])
                    ->get($url, $params);
            }
            return $promises;
        });

        return $responses;
    }
}
```

### 5.2 带重试与超时的高级封装

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use App\Exceptions\ServiceTimeoutException;
use App\Exceptions\ServiceUnavailableException;

class ResilientServicePool
{
    /**
     * 可靠的并发请求
     */
    public function scatter(array $requests, array $options = []): array
    {
        $globalTimeout = $options['timeout'] ?? 5;
        $retries       = $options['retries'] ?? 2;
        $retryDelay    = $options['retry_delay'] ?? 100; // 毫秒

        $responses = Http::pool(function (Pool $pool) use (
            $requests, $globalTimeout, $retries, $retryDelay
        ) {
            $promises = [];
            foreach ($requests as $key => $config) {
                $request = $pool
                    ->timeout($config['timeout'] ?? $globalTimeout)
                    ->retry($retries, $retryDelay)
                    ->withHeaders($this->propagateHeaders());

                // 应用中间件（日志、指标收集等）
                $request = $this->applyMiddleware($request, $key);

                if (isset($config['method'])) {
                    $method = strtolower($config['method']);
                    $promises[$key] = $request->$method(
                        $config['url'],
                        $config['data'] ?? $config['params'] ?? []
                    );
                } else {
                    $promises[$key] = $request->get(
                        $config['url'],
                        $config['params'] ?? []
                    );
                }
            }
            return $promises;
        });

        return $this->processResponses($responses, $requests);
    }

    /**
     * 传播链路追踪头
     */
    private function propagateHeaders(): array
    {
        return [
            'X-Request-ID'   => request()->header('X-Request-ID', ''),
            'X-Trace-ID'     => request()->header('X-Trace-ID', ''),
            'X-Span-ID'      => uniqid('span_'),
            'X-Caller'       => 'bff-laravel',
            'Accept'         => 'application/json',
        ];
    }

    /**
     * 处理响应，将错误转换为异常或标记
     */
    private function processResponses(array $responses, array $requests): array
    {
        $results = [];
        foreach ($responses as $key => $response) {
            if ($response instanceof Response) {
                if ($response->successful()) {
                    $results[$key] = [
                        'success' => true,
                        'data'    => $response->json(),
                        'status'  => $response->status(),
                    ];
                } else {
                    $results[$key] = [
                        'success' => false,
                        'data'    => null,
                        'status'  => $response->status(),
                        'error'   => "Service returned {$response->status()}",
                    ];
                }
            } else {
                // 超时或连接失败时 $response 可能为异常
                $results[$key] = [
                    'success' => false,
                    'data'    => null,
                    'status'  => 0,
                    'error'   => $response instanceof \Throwable
                        ? $response->getMessage()
                        : 'Unknown error',
                ];
            }
        }
        return $results;
    }

    private function applyMiddleware(PendingRequest $request, string $key): PendingRequest
    {
        return $request->beforeSending(function ($request, $options) use ($key) {
            logger()->info("BFF outgoing request", [
                'service' => $key,
                'url'     => $options['url'] ?? '',
                'method'  => $options['method'] ?? 'GET',
            ]);
        });
    }
}
```

### 5.3 配置化管理服务端点

```php
// config/services.php

return [
    // ... 其他配置

    'microservices' => [
        'user' => [
            'base_url' => env('USER_SERVICE_URL', 'http://user-service:8080'),
            'timeout'  => env('USER_SERVICE_TIMEOUT', 3),
            'retries'  => env('USER_SERVICE_RETRIES', 2),
        ],
        'product' => [
            'base_url' => env('PRODUCT_SERVICE_URL', 'http://product-service:8080'),
            'timeout'  => env('PRODUCT_SERVICE_TIMEOUT', 5),
            'retries'  => env('PRODUCT_SERVICE_RETRIES', 2),
        ],
        'order' => [
            'base_url' => env('ORDER_SERVICE_URL', 'http://order-service:8080'),
            'timeout'  => env('ORDER_SERVICE_TIMEOUT', 5),
            'retries'  => env('ORDER_SERVICE_RETRIES', 1),
        ],
        'inventory' => [
            'base_url' => env('INVENTORY_SERVICE_URL', 'http://inventory-service:8080'),
            'timeout'  => env('INVENTORY_SERVICE_TIMEOUT', 2),
            'retries'  => env('INVENTORY_SERVICE_RETRIES', 3),
        ],
    ],
];
```

```php
<?php

namespace App\Services;

class ServiceClient
{
    protected string $baseUrl;
    protected int $timeout;

    public function __construct(string $serviceName)
    {
        $config = config("services.microservices.{$serviceName}");
        $this->baseUrl = $config['base_url'];
        $this->timeout = $config['timeout'] ?? 5;
    }

    public function get(string $path, array $params = []): array
    {
        $response = Http::timeout($this->timeout)
            ->withHeaders(['Accept' => 'application/json'])
            ->get("{$this->baseUrl}{$path}", $params);

        return $response->json();
    }

    public function post(string $path, array $data = []): array
    {
        $response = Http::timeout($this->timeout)
            ->withHeaders(['Accept' => 'application/json'])
            ->post("{$this->baseUrl}{$path}", $data);

        return $response->json();
    }
}
```

---

## 六、结果合并策略：深度合并、扁平化、投影

### 6.1 合并策略接口

```php
<?php

namespace App\Strategies\Contracts;

interface MergeStrategyInterface
{
    /**
     * @param  array<string, array>  $responses  各服务的响应数据
     * @return array                              合并后的结果
     */
    public function merge(array $responses): array;
}
```

### 6.2 深度合并（Deep Merge）

适用于需要将多个服务的数据按嵌套结构组合在一起的场景。

```php
<?php

namespace App\Strategies;

use App\Strategies\Contracts\MergeStrategyInterface;

class DeepMergeStrategy implements MergeStrategyInterface
{
    /**
     * 递归深度合并多个数组
     * 后面的数组会覆盖前面的同名键
     *
     * 示例输入：
     *   user:     { id: 1, name: "Mike", profile: { age: 30 } }
     *   settings: { profile: { theme: "dark" }, notifications: true }
     * 输出：
     *   { id: 1, name: "Mike", profile: { age: 30, theme: "dark" }, notifications: true }
     */
    public function merge(array $responses): array
    {
        $result = [];

        foreach ($responses as $serviceKey => $response) {
            if (!isset($response['success']) || !$response['success']) {
                continue; // 跳过失败的响应
            }

            $data = $response['data'] ?? [];
            $result = $this->arrayMergeDeep($result, $data);
        }

        return $result;
    }

    private function arrayMergeDeep(array $a, array $b): array
    {
        $merged = $a;
        foreach ($b as $key => $value) {
            if (is_array($value) && isset($merged[$key]) && is_array($merged[$key])) {
                $merged[$key] = $this->arrayMergeDeep($merged[$key], $value);
            } else {
                $merged[$key] = $value;
            }
        }
        return $merged;
    }
}
```

### 6.3 扁平化合并（Flat Merge）

将所有服务的数据拍平为一个单层键值对数组。

```php
<?php

namespace App\Strategies;

class FlatMergeStrategy implements MergeStrategyInterface
{
    /**
     * 将多个服务的数据扁平化合并
     * 每个服务的数据以服务名为命名空间前缀
     *
     * 示例：
     *   输入: { user: {id: 1, name: "Mike"}, orders: [{id: 100}] }
     *   输出: { user_id: 1, user_name: "Mike", orders: [{id: 100}] }
     */
    public function merge(array $responses): array
    {
        $result = [];

        foreach ($responses as $serviceKey => $response) {
            if (!isset($response['success']) || !$response['success']) {
                $result[$serviceKey] = null;
                continue;
            }

            $data = $response['data'] ?? [];

            if (is_array($data) && !empty($data) && !isset($data[0])) {
                // 关联数组：带命名空间前缀展开
                foreach ($data as $field => $value) {
                    $result["{$serviceKey}_{$field}"] = $value;
                }
            } else {
                // 索引数组或空数据：直接以服务名为键
                $result[$serviceKey] = $data;
            }
        }

        return $result;
    }
}
```

### 6.4 投影合并（Projection Merge）

按需提取特定字段，类似 GraphQL 的 Field Selection。

```php
<?php

namespace App\Strategies;

class ProjectionStrategy implements MergeStrategyInterface
{
    private array $fieldMapping;

    /**
     * @param array $fieldMapping 字段映射定义
     *
     * 示例：
     * [
     *     'user.name'       => 'author_name',
     *     'user.avatar'     => 'author_avatar',
     *     'product.title'   => 'product_title',
     *     'product.price'   => 'product_price',
     *     'inventory.stock' => 'available_stock',
     * ]
     */
    public function __construct(array $fieldMapping)
    {
        $this->fieldMapping = $fieldMapping;
    }

    public function merge(array $responses): array
    {
        $result = [];

        foreach ($this->fieldMapping as $sourcePath => $targetKey) {
            [$serviceKey, $fieldPath] = explode('.', $sourcePath, 2);

            if (!isset($responses[$serviceKey]) ||
                !($responses[$serviceKey]['success'] ?? false)) {
                $result[$targetKey] = null;
                continue;
            }

            $result[$targetKey] = $this->getNestedValue(
                $responses[$serviceKey]['data'],
                $fieldPath
            );
        }

        return $result;
    }

    private function getNestedValue(array $data, string $path)
    {
        $keys = explode('.', $path);
        $current = $data;

        foreach ($keys as $key) {
            if (!is_array($current) || !array_key_exists($key, $current)) {
                return null;
            }
            $current = $current[$key];
        }

        return $current;
    }
}
```

### 6.5 合并策略工厂

```php
<?php

namespace App\Strategies;

class MergeStrategyFactory
{
    public static function create(string $type, array $options = []): Contracts\MergeStrategyInterface
    {
        return match ($type) {
            'deep'      => new DeepMergeStrategy(),
            'flat'      => new FlatMergeStrategy(),
            'projection' => new ProjectionStrategy($options['field_mapping'] ?? []),
            default      => throw new \InvalidArgumentException("Unknown merge strategy: {$type}"),
        };
    }
}
```

---

## 七、超时裁剪（Partial Response）：降级返回部分数据

### 7.1 设计思想

在微服务场景下，**部分数据总比没有数据好**。超时裁剪（Timeout Trimming）的核心思想是：

1. 设置一个全局超时（如 2 秒）
2. 在超时前完成的服务，正常返回数据
3. 超时未完成的服务，使用降级数据（默认值、缓存数据、空值）
4. 在响应中标记哪些数据是"完整的"，哪些是"降级的"

### 7.2 实现：带超时的组合器基类

```php
<?php

namespace App\Composers;

use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;

abstract class BaseComposer
{
    protected int $globalTimeout = 2000; // 毫秒

    /**
     * 带超时裁剪的并发请求
     */
    protected function scatterWithTimeout(array $services): array
    {
        $startTime = microtime(true);
        $results = [];
        $degraded = [];

        // 使用 Http::pool 执行并发请求
        try {
            $responses = Http::timeout($this->globalTimeout / 1000)
                ->pool(function (Pool $pool) use ($services) {
                    $promises = [];
                    foreach ($services as $key => $config) {
                        $promises[$key] = $pool
                            ->timeout(($config['timeout'] ?? $this->globalTimeout) / 1000)
                            ->get($config['url'], $config['params'] ?? []);
                    }
                    return $promises;
                }, $this->globalTimeout / 1000);

            foreach ($responses as $key => $response) {
                if ($response instanceof Response && $response->successful()) {
                    $results[$key] = $response->json();
                } else {
                    $results[$key] = $this->getFallbackData($key);
                    $degraded[] = $key;
                }
            }
        } catch (\Throwable $e) {
            // 全局超时：标记所有未返回的服务为降级
            foreach ($services as $key => $config) {
                if (!isset($results[$key])) {
                    $results[$key] = $this->getFallbackData($key);
                    $degraded[] = $key;
                }
            }
        }

        $elapsed = (microtime(true) - $startTime) * 1000;

        return [
            'data'          => $results,
            'degraded'      => $degraded,
            'elapsed_ms'    => round($elapsed, 2),
            'is_partial'    => !empty($degraded),
        ];
    }

    /**
     * 各子类需实现的降级数据获取逻辑
     */
    abstract protected function getFallbackData(string $serviceKey): mixed;
}
```

### 7.3 响应中的降级标记

```php
<?php

namespace App\Http\Controllers\Api;

use App\Composers\HomepageComposer;
use Illuminate\Http\JsonResponse;

class HomepageController extends Controller
{
    public function index(HomepageComposer $composer): JsonResponse
    {
        $result = $composer->compose([
            'user_id' => auth()->id(),
        ]);

        $response = [
            'code'    => 0,
            'message' => 'ok',
            'data'    => $result['data'],
        ];

        // 如果有降级数据，在 meta 中标注
        if ($result['is_partial']) {
            $response['meta'] = [
                'partial'       => true,
                'degraded'      => $result['degraded'],
                'elapsed_ms'    => $result['elapsed_ms'],
                'degraded_at'   => now()->toIso8601String(),
            ];

            // 返回 206 Partial Content 表示部分内容
            return response()->json($response, 206);
        }

        $response['meta'] = [
            'partial'    => false,
            'elapsed_ms' => $result['elapsed_ms'],
        ];

        return response()->json($response);
    }
}
```

### 7.4 前端处理 Partial Response

```javascript
// 前端处理部分响应
async function loadHomepage() {
  const response = await fetch('/api/v1/homepage');
  const data = await response.json();

  // 渲染可用数据
  renderUserInfo(data.data.user);
  renderProducts(data.data.products);
  renderOrders(data.data.orders);

  // 如果有降级数据，显示友好提示
  if (data.meta?.partial) {
    const degradedModules = data.meta.degraded.join(', ');
    showToast(`部分内容加载不完整：${degradedModules}`);
    // 可选：延迟重试降级模块
    setTimeout(() => retryDegradedModules(data.meta.degraded), 3000);
  }
}
```

---

## 八、错误处理：熔断、降级、默认值填充

### 8.1 熔断器（Circuit Breaker）实现

```php
<?php

namespace App\Resilience;

use Illuminate\Support\Facades\Cache;

class CircuitBreaker
{
    private string $serviceName;
    private int $failureThreshold;
    private int $recoveryTimeout;

    public function __construct(
        string $serviceName,
        int $failureThreshold = 5,
        int $recoveryTimeout = 60
    ) {
        $this->serviceName = $serviceName;
        $this->failureThreshold = $failureThreshold;
        $this->recoveryTimeout = $recoveryTimeout;
    }

    /**
     * 判断电路是否断开（服务不可用）
     */
    public function isOpen(): bool
    {
        $failures = Cache::get("circuit:{$this->serviceName}:failures", 0);

        if ($failures >= $this->failureThreshold) {
            $openedAt = Cache::get("circuit:{$this->serviceName}:opened_at");
            if ($openedAt && (time() - $openedAt) < $this->recoveryTimeout) {
                return true; // 熔断中
            }
            // 进入半开状态，允许一次尝试
            $this->halfOpen();
            return false;
        }

        return false;
    }

    /**
     * 记录调用成功
     */
    public function recordSuccess(): void
    {
        Cache::forget("circuit:{$this->serviceName}:failures");
        Cache::forget("circuit:{$this->serviceName}:opened_at");
    }

    /**
     * 记录调用失败
     */
    public function recordFailure(): void
    {
        $failures = Cache::increment("circuit:{$this->serviceName}:failures");

        if ($failures >= $this->failureThreshold) {
            Cache::put(
                "circuit:{$this->serviceName}:opened_at",
                time(),
                $this->recoveryTimeout
            );
            logger()->warning("Circuit breaker OPENED for service: {$this->serviceName}");
        }
    }

    private function halfOpen(): void
    {
        Cache::put("circuit:{$this->serviceName}:failures", $this->failureThreshold - 1);
    }

    /**
     * 获取当前状态
     */
    public function getState(): string
    {
        $failures = Cache::get("circuit:{$this->serviceName}:failures", 0);

        if ($failures === 0) {
            return 'closed';      // 正常
        } elseif ($failures >= $this->failureThreshold) {
            return 'open';        // 熔断
        } else {
            return 'half-open';   // 半开
        }
    }
}
```

### 8.2 降级处理器（Fallback Handler）

```php
<?php

namespace App\Resilience;

use Illuminate\Support\Facades\Cache;

class FallbackHandler
{
    /**
     * 获取降级数据
     * 优先级：缓存数据 > 静态默认值 > null
     */
    public function handle(
        string $serviceName,
        string $cacheKey,
        array $defaultData,
        ?int $cacheTtl = null
    ): array {
        // 尝试从缓存获取上一次的成功数据
        $cached = Cache::get("service_cache:{$serviceName}:{$cacheKey}");
        if ($cached !== null) {
            logger()->info("Fallback: using cached data for {$serviceName}");
            return [
                'data'      => $cached,
                'source'    => 'cache',
                'stale'     => true,
            ];
        }

        // 使用静态默认值
        if (!empty($defaultData)) {
            logger()->info("Fallback: using default data for {$serviceName}");
            return [
                'data'      => $defaultData,
                'source'    => 'default',
                'stale'     => true,
            ];
        }

        return [
            'data'      => null,
            'source'    => 'empty',
            'stale'     => true,
        ];
    }
}
```

### 8.3 在组合器中整合熔断与降级

```php
<?php

namespace App\Composers;

use App\Resilience\CircuitBreaker;
use App\Resilience\FallbackHandler;

class HomepageComposer extends BaseComposer
{
    private array $circuitBreakers = [];
    private FallbackHandler $fallbackHandler;

    public function __construct(FallbackHandler $fallbackHandler)
    {
        $this->fallbackHandler = $fallbackHandler;

        // 为每个下游服务初始化熔断器
        foreach (['user', 'product', 'order', 'inventory'] as $service) {
            $this->circuitBreakers[$service] = new CircuitBreaker(
                serviceName: $service,
                failureThreshold: config("circuit_breaker.{$service}.threshold", 5),
                recoveryTimeout: config("circuit_breaker.{$service}.recovery_timeout", 60)
            );
        }
    }

    public function compose(array $params): array
    {
        $userId = $params['user_id'];

        // 1. 检查熔断状态，过滤掉已熔断的服务
        $activeServices = [];
        $circuitBrokenServices = [];

        $serviceConfigs = $this->getServiceConfigs($userId);

        foreach ($serviceConfigs as $key => $config) {
            if ($this->circuitBreakers[$key]->isOpen()) {
                $circuitBrokenServices[] = $key;
            } else {
                $activeServices[$key] = $config;
            }
        }

        // 2. 只向未熔断的服务发送请求
        $scatterResult = $this->scatterWithTimeout($activeServices);

        // 3. 处理成功/失败的结果
        foreach ($scatterResult['data'] as $key => $response) {
            if ($response['success'] ?? false) {
                $this->circuitBreakers[$key]->recordSuccess();
            } else {
                $this->circuitBreakers[$key]->recordFailure();
                $scatterResult['data'][$key] = $this->fallbackHandler->handle(
                    $key, "user:{$userId}", $this->getDefaultData($key)
                );
                $scatterResult['degraded'][] = $key;
            }
        }

        // 4. 对熔断的服务使用降级数据
        foreach ($circuitBrokenServices as $key) {
            $scatterResult['data'][$key] = $this->fallbackHandler->handle(
                $key, "user:{$userId}", $this->getDefaultData($key)
            );
            $scatterResult['degraded'][] = $key;
        }

        // 5. 合并结果
        return $scatterResult;
    }

    protected function getFallbackData(string $serviceKey): mixed
    {
        return $this->getDefaultData($serviceKey);
    }

    private function getDefaultData(string $serviceKey): array
    {
        return match ($serviceKey) {
            'user'        => ['name' => '用户', 'avatar' => '/default-avatar.png'],
            'product'     => ['items' => [], 'recommendations' => []],
            'order'       => ['recent_orders' => [], 'pending_count' => 0],
            'inventory'   => [],
            default       => [],
        };
    }

    private function getServiceConfigs(int $userId): array
    {
        return [
            'user' => [
                'url'    => config('services.microservices.user.base_url') . "/api/users/{$userId}",
                'params' => ['include' => 'profile,addresses'],
            ],
            'product' => [
                'url'    => config('services.microservices.product.base_url') . '/api/recommendations',
                'params' => ['user_id' => $userId, 'limit' => 10],
            ],
            'order' => [
                'url'    => config('services.microservices.order.base_url') . '/api/orders',
                'params' => ['user_id' => $userId, 'status' => 'active', 'limit' => 5],
            ],
            'inventory' => [
                'url'    => config('services.microservices.inventory.base_url') . '/api/stock/check',
                'params' => ['user_id' => $userId],
            ],
        ];
    }
}
```

---

## 九、缓存策略：聚合结果缓存、TTL 设计

### 9.1 两层缓存架构

```
┌─────────────────────────────────────────────┐
│  Layer 1: CDN / Edge Cache (静态资源)       │
│  TTL: 5min - 1hr                            │
├─────────────────────────────────────────────┤
│  Layer 2: Application Cache (聚合结果)      │
│  TTL: 30s - 5min                            │
│  存储: Redis                                │
├─────────────────────────────────────────────┤
│  Layer 3: Service Cache (单服务结果)        │
│  TTL: 1min - 30min                          │
│  用于降级场景的 fallback 数据               │
└─────────────────────────────────────────────┘
```

### 9.2 聚合结果缓存实现

```php
<?php

namespace App\Cache;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Cache;

class ComposerCache
{
    /**
     * 获取或设置聚合缓存
     *
     * @param  string   $cacheKey    缓存键
     * @param  callable $composer    组合器回调
     * @param  int      $ttl         缓存过期时间（秒）
     * @param  int|null $staleTtl    过期后的宽限期（秒），用于 stale-while-revalidate
     */
    public function remember(
        string $cacheKey,
        callable $composer,
        int $ttl = 60,
        ?int $staleTtl = null
    ): array {
        $staleTtl = $staleTtl ?? (int) ($ttl * 0.5);

        $cached = Cache::get($cacheKey);

        if ($cached !== null) {
            $decoded = json_decode($cached, true);

            // 检查是否在宽限期内
            if (isset($decoded['_cached_at'])) {
                $age = time() - $decoded['_cached_at'];
                if ($age < $ttl) {
                    // 新鲜数据
                    return $decoded['payload'];
                } elseif ($age < $ttl + $staleTtl) {
                    // 过期但仍在宽限期内：返回过期数据，异步刷新
                    $this->dispatchRefresh($cacheKey, $composer, $ttl);
                    return $decoded['payload'];
                }
            }
        }

        // 缓存不存在或已超过宽限期：同步执行聚合
        $result = $composer();

        Cache::put($cacheKey, json_encode([
            'payload'    => $result,
            '_cached_at' => time(),
        ]), $ttl + $staleTtl);

        // 同时缓存每个服务的独立数据，用于降级
        if (isset($result['data'])) {
            foreach ($result['data'] as $serviceKey => $serviceData) {
                Cache::put(
                    "service_cache:{$serviceKey}:" . md5($cacheKey),
                    json_encode($serviceData),
                    $ttl * 3  // 服务级缓存更长
                );
            }
        }

        return $result;
    }

    /**
     * 异步刷新缓存（通过队列）
     */
    private function dispatchRefresh(string $cacheKey, callable $composer, int $ttl): void
    {
        // 使用 Redis 锁防止缓存击穿
        $lockKey = "cache_refresh_lock:{$cacheKey}";
        if (Cache::add($lockKey, 1, 30)) {
            dispatch(function () use ($cacheKey, $composer, $ttl) {
                try {
                    $result = $composer();
                    Cache::put($cacheKey, json_encode([
                        'payload'    => $result,
                        '_cached_at' => time(),
                    ]), $ttl * 2);
                } finally {
                    Cache::forget($lockKey);
                }
            })->afterCommit();
        }
    }

    /**
     * 清除特定用户的所有缓存
     */
    public function invalidateForUser(int $userId): void
    {
        $pattern = "composer:*:user:{$userId}*";
        $keys = Redis::keys($pattern);
        if (!empty($keys)) {
            Redis::del(...$keys);
        }
    }
}
```

### 9.3 TTL 设计策略

```php
// config/composer_cache.php

return [
    'homepage' => [
        'ttl'      => 30,   // 首页缓存 30 秒
        'stale_ttl' => 15,  // 宽限 15 秒（stale-while-revalidate）
    ],
    'order_detail' => [
        'ttl'      => 10,   // 订单详情 10 秒（变化频繁）
        'stale_ttl' => 5,
    ],
    'product_list' => [
        'ttl'      => 120,  // 商品列表 2 分钟
        'stale_ttl' => 60,
    ],
    'user_profile' => [
        'ttl'      => 300,  // 用户资料 5 分钟
        'stale_ttl' => 120,
    ],
];
```

### 9.4 基于事件的缓存失效

```php
<?php

namespace App\Listeners;

use App\Events\OrderStatusChanged;
use App\Cache\ComposerCache;

class InvalidateOrderCache
{
    public function __construct(private ComposerCache $cache) {}

    public function handle(OrderStatusChanged $event): void
    {
        $userId = $event->order->user_id;

        // 订单状态变更时，清除该用户的首页和订单缓存
        $this->cache->invalidateForUser($userId);
    }
}
```

---

## 十、性能优化：并发连接池、连接复用、请求合并（DataLoader 模式）

### 10.1 连接池配置

```php
// config/http.php

return [
    'pool' => [
        // 最大并发连接数
        'max_connections' => env('HTTP_POOL_MAX_CONNECTIONS', 100),

        // 每个主机的最大连接数
        'max_connections_per_host' => env('HTTP_POOL_MAX_PER_HOST', 10),

        // 连接超时
        'connect_timeout' => env('HTTP_POOL_CONNECT_TIMEOUT', 1.0),

        // 读取超时
        'read_timeout' => env('HTTP_POOL_READ_TIMEOUT', 5.0),

        // 空闲连接超时
        'idle_timeout' => env('HTTP_POOL_IDLE_TIMEOUT', 30),
    ],
];
```

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Handler\CurlMultiHandler;

class HttpServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton('http.pool-client', function () {
            $handler = new CurlMultiHandler();
            $stack = HandlerStack::create($handler);

            return new Client([
                'handler'     => $stack,
                'curl'        => [
                    CURLOPT_TCP_KEEPALIVE => true,
                    CURLOPT_TCP_KEEPIDLE  => 10,
                    CURLOPT_TCP_KEEPINTVL => 5,
                    CURLOPT_MAXCONNECTS   => config('http.pool.max_connections', 100),
                ],
                'connect_timeout' => config('http.pool.connect_timeout', 1.0),
                'timeout'         => config('http.pool.read_timeout', 5.0),
            ]);
        });
    }
}
```

### 10.2 DataLoader 模式：请求合并与批处理

DataLoader 是 Facebook 开源的一种模式，用于将多个对同一服务的独立请求合并为一个批量请求。

```php
<?php

namespace App\Loaders;

use Illuminate\Support\Facades\Http;

class DataLoader
{
    private array $queue = [];
    private array $cache = [];
    private string $batchEndpoint;
    private int $maxBatchSize;
    private ?float $dispatchTimer = null;
    private float $maxWaitMs;

    public function __construct(
        string $batchEndpoint,
        int $maxBatchSize = 100,
        float $maxWaitMs = 10.0
    ) {
        $this->batchEndpoint = $batchEndpoint;
        $this->maxBatchSize = $maxBatchSize;
        $this->maxWaitMs = $maxWaitMs;
    }

    /**
     * 加载单个 key（会被批处理）
     */
    public function load(string $key): mixed
    {
        if (isset($this->cache[$key])) {
            return $this->cache[$key];
        }

        $this->queue[] = $key;

        // 当队列达到批量大小时立即执行
        if (count($this->queue) >= $this->maxBatchSize) {
            $this->dispatch();
        }

        return $this->cache[$key] ?? null;
    }

    /**
     * 批量加载多个 key
     */
    public function loadMany(array $keys): array
    {
        $results = [];
        foreach ($keys as $key) {
            $results[$key] = $this->load($key);
        }
        $this->dispatch(); // 确保剩余的队列被执行
        return $results;
    }

    /**
     * 执行批量请求
     */
    private function dispatch(): void
    {
        if (empty($this->queue)) {
            return;
        }

        $keys = array_unique($this->queue);
        $this->queue = [];

        // 按 maxBatchSize 分批
        $batches = array_chunk($keys, $this->maxBatchSize);

        foreach ($batches as $batch) {
            $response = Http::timeout(5)
                ->get($this->batchEndpoint, [
                    'ids' => implode(',', $batch),
                ]);

            if ($response->successful()) {
                $data = $response->json('data', []);
                foreach ($data as $item) {
                    $id = (string) ($item['id'] ?? '');
                    $this->cache[$id] = $item;
                }
            }
        }

        // 为未返回的 key 设置 null 缓存
        foreach ($keys as $key) {
            if (!isset($this->cache[$key])) {
                $this->cache[$key] = null;
            }
        }
    }

    /**
     * 清除缓存
     */
    public function clearCache(): void
    {
        $this->cache = [];
    }
}
```

### 10.3 在 Composer 中使用 DataLoader

```php
<?php

namespace App\Composers;

use App\Loaders\DataLoader;
use App\Loaders\ProductDataLoader;

class OrderDetailComposer extends BaseComposer
{
    private DataLoader $productLoader;

    public function __construct()
    {
        $this->productLoader = new DataLoader(
            batchEndpoint: config('services.microservices.product.base_url') . '/api/products/batch',
            maxBatchSize: 50
        );
    }

    public function compose(array $params): array
    {
        $orderId = $params['order_id'];

        // 1. 获取订单基本信息
        $order = Http::get(
            config('services.microservices.order.base_url') . "/api/orders/{$orderId}"
        )->json();

        // 2. 使用 DataLoader 批量加载商品信息
        // 多个订单项的商品信息会被合并为一个请求
        $productIds = array_column($order['items'], 'product_id');
        $products = $this->productLoader->loadMany($productIds);

        // 3. 组装结果
        foreach ($order['items'] as &$item) {
            $item['product_detail'] = $products[$item['product_id']] ?? null;
        }

        return [
            'data' => $order,
            'is_partial' => false,
        ];
    }

    protected function getFallbackData(string $serviceKey): mixed
    {
        return null;
    }
}
```

---

## 十一、GraphQL 与 API Composition 的关系

### 11.1 两种方案的对比

| 特性 | REST API Composition | GraphQL Federation |
|------|---------------------|--------------------|
| 数据获取 | 服务端决定返回哪些字段 | 客户端声明需要哪些字段 |
| 类型系统 | 无内建类型系统 | 强类型 Schema |
| 聚合层 | BFF 组合器（手动编码） | Gateway（声明式配置） |
| N+1 问题 | 需手动实现 DataLoader | 内建 DataLoader 机制 |
| 学习曲线 | 低 | 中高 |
| 生态 | Laravel 原生支持 | 需要额外工具（Lighthouse 等） |
| 适用团队 | 后端主导 | 全栈 / 前端主导 |

### 11.2 Laravel + GraphQL (Lighthouse) 中的 API Composition

```php
// 使用 Lighthouse 实现 GraphQL 网关

// schema.graphql
"""
type Query {
    homepage(userId: ID!): HomepageData @complexity(value: 10)
}

type HomepageData {
    user: User @guard
    recentOrders: [Order!]! @guard
    recommendedProducts: [Product!]!
    inventoryAlerts: [InventoryAlert!]!
}
"""
```

```graphql
# 客户端可以精确查询需要的字段
query HomepageData {
  homepage(userId: "123") {
    user {
      name
      avatar
      level
    }
    recentOrders(limit: 3) {
      id
      status
      totalAmount
    }
    recommendedProducts(limit: 6) {
      id
      title
      price
      imageUrl
    }
  }
}
```

### 11.3 在 Laravel 中同时支持 REST 和 GraphQL

```php
<?php

namespace App\Composers;

class HomepageComposer extends BaseComposer
{
    /**
     * REST 模式：返回完整数据
     */
    public function compose(array $params): array
    {
        return $this->scatterWithTimeout([
            'user'  => $this->getUserConfig($params['user_id']),
            'products' => $this->getProductConfig($params['user_id']),
            'orders'   => $this->getOrderConfig($params['user_id']),
        ]);
    }

    /**
     * GraphQL 模式：只返回请求的字段
     */
    public function composeForGraphQL(array $params, array $requestedFields): array
    {
        $services = [];

        // 根据请求的字段决定调用哪些服务
        if ($this->needsUserFields($requestedFields)) {
            $services['user'] = $this->getUserConfig($params['user_id']);
        }
        if ($this->needsProductFields($requestedFields)) {
            $services['products'] = $this->getProductConfig($params['user_id']);
        }
        if ($this->needsOrderFields($requestedFields)) {
            $services['orders'] = $this->getOrderConfig($params['user_id']);
        }

        return $this->scatterWithTimeout($services);
    }
}
```

---

## 十二、实战：Laravel 电商首页的多服务聚合

### 12.1 需求分析

电商 App 首页需要聚合以下数据：

1. **用户信息**：头像、昵称、VIP等级、未读消息数
2. **商品推荐**：基于用户偏好的个性化推荐列表（包含价格、库存状态）
3. **订单状态**：待付款、待发货、待收货数量
4. **库存提醒**：购物车中即将售罄的商品

### 12.2 完整的组合器实现

```php
<?php

namespace App\Composers;

use App\Strategies\DeepMergeStrategy;
use App\Cache\ComposerCache;
use App\Resilience\FallbackHandler;
use Illuminate\Support\Facades\Http;

class HomepageComposer extends BaseComposer implements ComposerInterface
{
    protected int $globalTimeout = 2000;

    public function __construct(
        private ComposerCache $cache,
        private FallbackHandler $fallbackHandler
    ) {}

    public function compose(array $params): array
    {
        $userId = $params['user_id'];

        $cacheKey = "composer:homepage:user:{$userId}";

        return $this->cache->remember(
            cacheKey: $cacheKey,
            composer: fn() => $this->doCompose($userId),
            ttl: config('composer_cache.homepage.ttl', 30),
            staleTtl: config('composer_cache.homepage.stale_ttl', 15),
        );
    }

    private function doCompose(int $userId): array
    {
        $baseUrl = fn(string $svc) => config("services.microservices.{$svc}.base_url");

        $scatterResult = $this->scatterWithTimeout([
            'user' => [
                'url'    => $baseUrl('user') . "/api/users/{$userId}",
                'params' => ['include' => 'profile,vip,unread_count'],
                'timeout' => 1500,
            ],
            'products' => [
                'url'    => $baseUrl('product') . '/api/recommendations',
                'params' => ['user_id' => $userId, 'limit' => 10, 'scenario' => 'homepage'],
                'timeout' => 2000,
            ],
            'orders' => [
                'url'    => $baseUrl('order') . '/api/orders/summary',
                'params' => ['user_id' => $userId, 'group_by' => 'status'],
                'timeout' => 2000,
            ],
            'inventory' => [
                'url'    => $baseUrl('inventory') . '/api/alerts/low-stock',
                'params' => ['user_id' => $userId, 'cart_only' => true],
                'timeout' => 1500,
            ],
        ]);

        // 处理产品数据：合并库存信息
        $this->enrichProductsWithInventory($scatterResult);

        // 构建最终响应
        $merged = $this->buildHomepageResponse($scatterResult);

        return [
            'data'       => $merged,
            'is_partial' => $scatterResult['is_partial'],
            'degraded'   => $scatterResult['degraded'],
            'elapsed_ms' => $scatterResult['elapsed_ms'],
        ];
    }

    /**
     * 将库存信息合并到推荐商品中
     */
    private function enrichProductsWithInventory(array &$result): void
    {
        if (!isset($result['data']['products']['success']) ||
            !$result['data']['products']['success']) {
            return;
        }

        $inventoryData = $result['data']['inventory']['data'] ?? [];
        $stockMap = [];

        if (is_array($inventoryData)) {
            foreach ($inventoryData as $item) {
                $stockMap[$item['sku_id']] = $item;
            }
        }

        $products = $result['data']['products']['data']['items'] ?? [];
        foreach ($products as &$product) {
            $skuId = $product['sku_id'] ?? null;
            if ($skuId && isset($stockMap[$skuId])) {
                $product['stock_status'] = $stockMap[$skuId]['status'];
                $product['stock_quantity'] = $stockMap[$skuId]['quantity'];
            } else {
                $product['stock_status'] = 'unknown';
                $product['stock_quantity'] = null;
            }
        }

        $result['data']['products']['data']['items'] = $products;
    }

    /**
     * 构建首页响应结构
     */
    private function buildHomepageResponse(array $scatterResult): array
    {
        $user     = $scatterResult['data']['user']['data'] ?? [];
        $products = $scatterResult['data']['products']['data']['items'] ?? [];
        $orders   = $scatterResult['data']['orders']['data'] ?? [];
        $alerts   = $scatterResult['data']['inventory']['data'] ?? [];

        return [
            'user' => [
                'name'         => $user['name'] ?? '用户',
                'avatar'       => $user['avatar'] ?? '/images/default-avatar.png',
                'vip_level'    => $user['vip_level'] ?? 0,
                'unread_count' => $user['unread_count'] ?? 0,
            ],
            'banners' => $this->getCachedBanners(),
            'recommendations' => array_map(fn($p) => [
                'id'          => $p['id'],
                'title'       => $p['title'],
                'price'       => $p['price'],
                'original_price' => $p['original_price'] ?? null,
                'image_url'   => $p['image_url'],
                'stock_status'  => $p['stock_status'] ?? 'unknown',
            ], $products),
            'order_summary' => [
                'pending_payment'  => $orders['pending_payment'] ?? 0,
                'pending_shipment' => $orders['pending_shipment'] ?? 0,
                'pending_receipt'  => $orders['pending_receipt'] ?? 0,
                'refund_count'     => $orders['refund_count'] ?? 0,
            ],
            'inventory_alerts' => array_map(fn($a) => [
                'product_name' => $a['product_name'],
                'message'      => $a['message'],
            ], $alerts),
        ];
    }

    private function getCachedBanners(): array
    {
        return cache()->remember('homepage:banners', 300, function () {
            return Http::get(config('services.cms.base_url') . '/api/banners', [
                'position' => 'homepage',
                'limit'    => 5,
            ])->json('data', []);
        });
    }

    public function services(): array
    {
        return ['user', 'product', 'order', 'inventory'];
    }

    public function timeout(): int
    {
        return $this->globalTimeout;
    }

    protected function getFallbackData(string $serviceKey): mixed
    {
        return match ($serviceKey) {
            'user'      => ['name' => '用户', 'avatar' => '/images/default-avatar.png'],
            'products'  => ['items' => []],
            'orders'    => ['pending_payment' => 0, 'pending_shipment' => 0],
            'inventory' => [],
            default     => null,
        };
    }
}
```

### 12.3 控制器与路由

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Composers\HomepageComposer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HomepageController extends Controller
{
    public function __construct(private HomepageComposer $composer) {}

    /**
     * GET /api/v1/homepage
     */
    public function index(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        $result = $this->composer->compose(['user_id' => $userId]);

        $statusCode = $result['is_partial'] ? 206 : 200;

        return response()->json([
            'code'    => 0,
            'message' => $result['is_partial'] ? '部分内容加载不完整' : 'ok',
            'data'    => $result['data'],
            'meta'    => [
                'partial'    => $result['is_partial'],
                'degraded'   => $result['degraded'],
                'elapsed_ms' => $result['elapsed_ms'],
                'cache_hit'  => $result['cache_hit'] ?? false,
            ],
        ], $statusCode);
    }
}
```

```php
// routes/api.php
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/v1/homepage', [HomepageController::class, 'index']);
    Route::get('/v1/orders/{id}', [OrderDetailController::class, 'show']);
    Route::get('/v1/search', [SearchController::class, 'index']);
});
```

---

## 十三、监控与链路追踪

### 13.1 分布式链路追踪

```php
<?php

namespace App\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class TraceIdMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        // 从请求头获取或生成 Trace ID
        $traceId = $request->header('X-Trace-ID', $this->generateTraceId());
        $spanId = $request->header('X-Span-ID', $this->generateSpanId());
        $parentSpanId = $request->header('X-Parent-Span-ID');

        // 注入到应用容器，供后续使用
        app()->instance('trace-id', $traceId);
        app()->instance('span-id', $spanId);
        app()->instance('parent-span-id', $parentSpanId);

        $response = $next($request);

        // 在响应头中附加追踪信息
        $response->headers->set('X-Trace-ID', $traceId);
        $response->headers->set('X-Span-ID', $spanId);

        return $response;
    }

    private function generateTraceId(): string
    {
        return sprintf(
            '%s-%s-%s-%s',
            bin2hex(random_bytes(4)),
            bin2hex(random_bytes(2)),
            bin2hex(random_bytes(2)),
            bin2hex(random_bytes(8))
        );
    }

    private function generateSpanId(): string
    {
        return bin2hex(random_bytes(8));
    }
}
```

### 13.2 性能监控指标收集

```php
<?php

namespace App\Observers;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

class ComposerMetrics
{
    /**
     * 记录聚合请求指标
     */
    public function recordMetrics(
        string $composerName,
        float $elapsedMs,
        bool $isPartial,
        array $degradedServices,
        array $serviceTimings
    ): void {
        $timestamp = floor(time() / 60) * 60; // 按分钟聚合

        // 总请求数
        Redis::hincrby("metrics:composer:{$composerName}:{$timestamp}", 'total_requests', 1);

        // 部分响应请求数
        if ($isPartial) {
            Redis::hincrby("metrics:composer:{$composerName}:{$timestamp}", 'partial_requests', 1);
        }

        // 延迟分布（使用 Redis HyperLogLog 近似统计）
        $latencyBucket = $this->getLatencyBucket($elapsedMs);
        Redis::hincrby(
            "metrics:composer:{$composerName}:latency:{$timestamp}",
            $latencyBucket,
            1
        );

        // 各服务的响应时间
        foreach ($serviceTimings as $service => $timing) {
            Redis::lpush(
                "metrics:service:{$service}:timing:{$timestamp}",
                $timing
            );
            Redis::ltrim(
                "metrics:service:{$service}:timing:{$timestamp}",
                0,
                999
            );
        }

        // 各服务的降级次数
        foreach ($degradedServices as $service) {
            Redis::hincrby(
                "metrics:composer:{$composerName}:degraded:{$timestamp}",
                $service,
                1
            );
        }

        // 设置 TTL 自动清理（保留 7 天）
        Redis::expire("metrics:composer:{$composerName}:{$timestamp}", 86400 * 7);
    }

    /**
     * 获取延迟分桶
     */
    private function getLatencyBucket(float $ms): string
    {
        return match (true) {
            $ms < 50    => '0-50ms',
            $ms < 100   => '50-100ms',
            $ms < 200   => '100-200ms',
            $ms < 500   => '200-500ms',
            $ms < 1000  => '500ms-1s',
            $ms < 2000  => '1s-2s',
            default     => '>2s',
        };
    }

    /**
     * 获取监控仪表盘数据
     */
    public function getDashboard(string $composerName): array
    {
        $currentMinute = floor(time() / 60) * 60;
        $metrics = Redis::hgetall("metrics:composer:{$composerName}:{$currentMinute}");

        $total = (int) ($metrics['total_requests'] ?? 0);
        $partial = (int) ($metrics['partial_requests'] ?? 0);

        return [
            'total_requests'  => $total,
            'partial_rate'    => $total > 0 ? round($partial / $total * 100, 2) . '%' : '0%',
            'availability'    => $total > 0 ? round(($total - $partial) / $total * 100, 2) . '%' : '100%',
            'latency_dist'    => Redis::hgetall(
                "metrics:composer:{$composerName}:latency:{$currentMinute}"
            ),
            'degraded_by_service' => Redis::hgetall(
                "metrics:composer:{$composerName}:degraded:{$currentMinute}"
            ),
        ];
    }
}
```

### 13.3 Prometheus 指标导出

```php
<?php

namespace App\Metrics;

use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis as PrometheusRedis;

class ComposerPrometheusMetrics
{
    private CollectorRegistry $registry;

    public function __construct()
    {
        PrometheusRedis::setDefaultOptions([
            'host' => config('database.redis.default.host'),
        ]);
        $this->registry = CollectorRegistry::getDefault();
    }

    public function registerAndRecord(
        string $composerName,
        string $serviceName,
        float $durationMs,
        int $status,
        bool $isPartial
    ): void {
        // 请求持续时间直方图
        $histogram = $this->registry->getOrRegisterHistogram(
            'bff',
            'composer_request_duration_ms',
            'Composer request duration in milliseconds',
            ['composer', 'status']
        );
        $histogram->observe($durationMs, [$composerName, $status >= 200 && $status < 400 ? 'success' : 'error']);

        // 部分响应计数器
        $counter = $this->registry->getOrRegisterCounter(
            'bff',
            'composer_partial_responses_total',
            'Total partial responses',
            ['composer']
        );
        if ($isPartial) {
            $counter->inc([$composerName]);
        }

        // 下游服务状态
        $gauge = $this->registry->getOrRegisterGauge(
            'bff',
            'downstream_service_status',
            'Downstream service status (1=up, 0=down)',
            ['composer', 'service']
        );
        $gauge->set($status < 500 ? 1 : 0, [$composerName, $serviceName]);
    }
}
```

---

## 十四、与 CQRS、Event Sourcing 的配合

### 14.1 CQRS 中的查询端

CQRS（Command Query Responsibility Segregation）将读写操作分离到不同的模型中。API Composition 天然适合 CQRS 的查询端：

```
┌──────────────────────────────────────────────────────┐
│                    Command Side                      │
│  ┌──────────────┐     ┌──────────────┐              │
│  │ OrderCommand  │────▶│ Event Store  │              │
│  │   Handler     │     └──────┬───────┘              │
│  └──────────────┘            │                       │
│                              ▼                       │
│  ┌──────────────┐     ┌──────────────┐              │
│  │InventorySvc   │◀────│Event Consumer│              │
│  │ Read Model    │     │(Projection)  │              │
│  └──────────────┘     └──────────────┘              │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                    Query Side                        │
│  ┌──────────────────────────────────┐               │
│  │     API Composer (BFF)           │               │
│  │  ┌──────┐ ┌──────┐ ┌──────────┐ │               │
│  │  │ User │ │Order │ │Inventory │ │               │
│  │  │Read  │ │Read  │ │Read Model│ │               │
│  │  │Model │ │Model │ │          │ │               │
│  │  └──────┘ └──────┘ └──────────┘ │               │
│  └──────────────────────────────────┘               │
└──────────────────────────────────────────────────────┘
```

### 14.2 基于事件的物化视图查询

```php
<?php

namespace App\Composers;

use Illuminate\Support\Facades\DB;

class HomepageComposerWithReadModels extends BaseComposer
{
    /**
     * 在 CQRS 模式下，查询端直接从物化视图/读模型获取数据
     * 而不是请求微服务的 API
     */
    public function compose(array $params): array
    {
        $userId = $params['user_id'];

        // 读模型通常同步到本地数据库或 Elasticsearch
        // 查询速度快于远程 API 调用
        $user = DB::connection('read_model')
            ->table('user_read_models')
            ->where('user_id', $userId)
            ->first();

        $orders = DB::connection('read_model')
            ->table('order_summary_read_models')
            ->where('user_id', $userId)
            ->first();

        $recommendations = DB::connection('read_model')
            ->table('recommendation_read_models')
            ->where('user_id', $userId)
            ->orderByDesc('score')
            ->limit(10)
            ->get();

        return [
            'data' => [
                'user'           => $user,
                'order_summary'  => $orders,
                'recommendations' => $recommendations,
            ],
            'is_partial' => false,
        ];
    }
}
```

### 14.3 Event Sourcing 驱动的缓存更新

```php
<?php

namespace App\EventHandlers;

use App\Events\OrderPlaced;
use App\Events\OrderStatusChanged;
use App\Events\UserProfileUpdated;
use App\Cache\ComposerCache;

class ComposerCacheInvalidator
{
    public function __construct(private ComposerCache $cache) {}

    public function handleOrderPlaced(OrderPlaced $event): void
    {
        $userId = $event->order->user_id;

        // 新订单产生时，清除该用户的首页和订单相关缓存
        $this->cache->invalidateForUser($userId);
    }

    public function handleOrderStatusChanged(OrderStatusChanged $event): void
    {
        $userId = $event->order->user_id;

        $this->cache->invalidateForUser($userId);
    }

    public function handleUserProfileUpdated(UserProfileUpdated $event): void
    {
        $userId = $event->userId;

        $this->cache->invalidateForUser($userId);
    }
}
```

### 14.4 事件驱动的物化视图同步

```php
<?php

namespace App\Projectors;

use App\Events\OrderPlaced;
use App\Events\OrderCancelled;
use Illuminate\Support\Facades\DB;

class OrderReadModelProjector
{
    /**
     * 订单创建时，更新用户订单摘要读模型
     */
    public function onOrderPlaced(OrderPlaced $event): void
    {
        DB::connection('read_model')
            ->table('order_summary_read_models')
            ->upsert(
                [
                    'user_id'          => $event->order->user_id,
                    'total_orders'     => DB::raw('total_orders + 1'),
                    'pending_payment'  => DB::raw('pending_payment + 1'),
                    'last_order_at'    => now(),
                    'updated_at'       => now(),
                ],
                ['user_id'],
                ['total_orders', 'pending_payment', 'last_order_at', 'updated_at']
            );

        // 同时触发缓存失效
        event(new OrderSummaryUpdated($event->order->user_id));
    }
}
```

---

## 十五、总结与最佳实践

### 15.1 核心设计原则回顾

通过本文的详细探讨，我们系统性地了解了如何在 Laravel 中实现 API Composition Pattern。以下是关键设计原则的总结：

**1. 容错优先（Resilience First）**

```
永远不要让一个失败的服务拖垮整个聚合响应。
使用熔断器、降级策略、默认值填充确保部分数据可用。
```

**2. 超时裁剪（Timeout Trimming）**

```
设置合理的全局超时（建议 2-3 秒）。
在超时前完成的服务正常返回，超时的服务使用降级数据。
返回 206 Partial Content 告知客户端数据不完整。
```

**3. 缓存分层（Layered Caching）**

```
聚合结果缓存（TTL 30s-2min）→ 服务结果缓存（TTL 1-5min）→ CDN（静态资源）
使用 stale-while-revalidate 策略平衡实时性和性能。
```

**4. 并发优化（Concurrency Optimization）**

```
使用 Http::pool 进行并发请求，而非串行调用。
使用 DataLoader 模式合并同一服务的多个请求。
配置连接池和连接复用减少 TCP 开销。
```

### 15.2 最佳实践清单

| 编号 | 实践 | 优先级 |
|------|------|--------|
| 1 | 为每个下游服务配置独立的超时时间 | 🔴 高 |
| 2 | 实现熔断器防止级联故障 | 🔴 高 |
| 3 | 返回 Partial Response 而非完全失败 | 🔴 高 |
| 4 | 在响应中标记数据新鲜度和降级状态 | 🟡 中 |
| 5 | 使用配置文件管理服务端点和超时参数 | 🟡 中 |
| 6 | 传播链路追踪头（X-Trace-ID 等） | 🟡 中 |
| 7 | 实现聚合结果缓存（stale-while-revalidate） | 🟡 中 |
| 8 | 监控降级率和延迟分布 | 🟡 中 |
| 9 | 使用 DataLoader 合并重复请求 | 🟢 低 |
| 10 | 考虑 GraphQL 作为替代方案 | 🟢 低 |

### 15.3 反模式警示

```
❌ 反模式 1：无限重试
   正确做法：设置最大重试次数和指数退避

❌ 反模式 2：忽略失败的服务
   正确做法：明确标记降级数据，返回合适的 HTTP 状态码

❌ 反模式 3：在 Composer 中编写业务逻辑
   正确做法：Composer 只负责聚合，业务逻辑留在下游服务

❌ 反模式 4：所有请求共享一个超时
   正确做法：为不同服务设置不同的超时（关键服务更长，辅助服务更短）

❌ 反模式 5：不做缓存
   正确做法：聚合结果缓存 + 事件驱动的缓存失效

❌ 反模式 6：串行调用可以并行的服务
   正确做法：无依赖关系的请求使用 Http::pool 并发执行
```

### 15.4 技术选型决策树

```
你的场景是什么？
│
├── 需要聚合多个微服务的查询数据？
│   ├── 是 → API Composition Pattern ✅
│   │        ├── 服务数量 < 5 → REST BFF 足够
│   │        ├── 服务数量 >= 5 → 考虑 GraphQL Federation
│   │        └── 前端多样化 → 每端一个 BFF
│   └── 否 → 检查是否可以合并微服务
│
├── 需要协调多个服务的写操作？
│   └── 不适用 API Composition → 使用 Saga / 编排器
│
└── 需要强一致性事务？
    └── 不适用 API Composition → 使用 2PC / TCC
```

### 15.5 结语

API Composition Pattern 并不是银弹，它适用于**读密集**、**数据分散**、**容忍最终一致性**的场景。在 Laravel 中实现 API Composition，我们有以下优势：

1. **生态成熟**：Guzzle HTTP Client、Redis、Queue 等组件开箱即用
2. **开发效率高**：PHP 的动态类型和 Laravel 的优雅 API 让代码简洁易读
3. **可扩展性强**：通过 Composer 接口和 Strategy 模式，易于扩展新的聚合场景
4. **运维友好**：与 Laravel 的日志、监控、队列等基础设施无缝集成

随着微服务架构的深入，API Composition 将成为 BFF 层最核心的设计模式。希望本文的实战代码和架构思路能为你的项目提供有价值的参考。

---

> 本文代码基于 Laravel 11+ / PHP 8.2+ 编写。完整示例项目可在 [GitHub](https://github.com) 获取。

## 相关阅读

- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/post/cqrs-event-sourcing-laravel/)
- [Server-Driven UI + Laravel BFF：前端零逻辑的动态界面渲染](/post/server-driven-ui-laravel-bff/)
- [Cell-Based Architecture 实战：单元化架构在 Laravel 微服务中的落地](/post/cell-based-architecture-laravel/)
- [事件驱动架构全景实战：EventBridge/NATS/Pulsar 统一事件总线设计](/post/eventbridge-nats-pulsar/)
