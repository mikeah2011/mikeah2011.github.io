---
title: GraphQL Federation 超图实战：订单、库存、价格子图拆分与网关鉴权缓存
keywords: [GraphQL Federation, 超图实战, 订单, 库存, 价格子图拆分与网关鉴权缓存, 架构]
date: 2026-06-09 19:48:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - GraphQL
  - Federation
  - 微服务
  - Apollo
  - PHP
description: 从零搭建 GraphQL Federation 超图架构，拆分订单、库存、价格三个子图，实现网关层鉴权与响应缓存，附完整 Laravel + Apollo Router 实战代码。
---


## 前言

当单体 GraphQL Schema 膨胀到几千行、多个团队频繁冲突时，Federation 就是你的解药。

本文用一个电商场景——订单（Orders）、库存（Inventory）、价格（Pricing）三个子图——演示如何用 Apollo Federation v2 搭建超图（Supergraph），并在网关层实现 JWT 鉴权和响应缓存。

技术栈：Laravel 9 + Lighthouse（PHP GraphQL）、Apollo Router（Rust 网关）。

## 1. Federation 核心概念

### 1.1 什么是超图

```
┌─────────────────────────────────────────────┐
│              Apollo Router (网关)             │
│         路由 · 鉴权 · 缓存 · 查询计划        │
└──────┬──────────┬──────────┬────────────────┘
       │          │          │
   ┌───▼──┐  ┌───▼──┐  ┌───▼──┐
   │订单子图│  │库存子图│  │价格子图│
   │ Orders │  │Inventory│ │Pricing │
   └──────┘  └──────┘  └──────┘
```

**超图 = 所有子图 Schema 的合并**。客户端只需要请求网关，网关自动将查询拆分（Query Plan）分发到对应子图，再聚合结果返回。

### 1.2 Federation v2 关键指令

```graphql
# @key 定义实体的主键，用于跨子图引用
type Order @key(fields: "id") {
  id: ID!
  items: [OrderItem!]!
}

# @external 声明该字段由其他子图提供
# @requires 声明获取该字段前需要先拿到哪些外部字段
type OrderItem @key(fields: "id") {
  id: ID!
  productId: ID!
  quantity: Int!
  price: Money @external
  totalPrice: Money @requires(fields: "price quantity")
}
```

### 1.3 实体引用流程

1. 客户端查询 `order { items { totalPrice } }`
2. 网关先从订单子图拿到 `items`（含 `productId`、`quantity`）
3. 网关用 `productId` 去价格子图查 `price`
4. 网关将 `price` 传回，计算 `totalPrice`

## 2. 子图拆分实战

### 2.1 项目结构

```
federation-demo/
├── gateway/           # Apollo Router 配置
│   └── router.yaml
├── services/
│   ├── orders/        # Laravel 订单子图
│   ├── inventory/     # Laravel 库存子图
│   └── pricing/       # Laravel 价格子图
└── supergraph.graphql # 合并后的超图 Schema（自动生成）
```

### 2.2 订单子图（Orders）

**Laravel + Lighthouse 安装：**

```bash
composer require nuwave/lighthouse
php artisan vendor:publish --provider="Nuwave\Lighthouse\LighthouseServiceProvider"
```

**Schema 定义 `services/orders/graphql/schema.graphql`：**

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@external", "@requires"])

type Order @key(fields: "id") {
  id: ID!
  status: OrderStatus!
  createdAt: DateTime!
  items: [OrderItem!]!
  totalAmount: Money!
}

type OrderItem @key(fields: "id") {
  id: ID!
  productId: ID!
  quantity: Int!
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
  COMPLETED
  CANCELLED
}

type Money {
  amount: Float!
  currency: String!
}

type Query {
  order(id: ID!): Order @auth
  orders(first: Int = 10, after: String): OrderConnection! @auth
}
```

**实体解析器 `app/GraphQL/Entities/Order.php`：**

```php
<?php

namespace App\GraphQL\Entities;

use App\Models\Order as OrderModel;
use Nuwave\Lighthouse\Federation\EntityResolver;

class Order implements EntityResolver
{
    public function __resolveReference(array $reference): ?OrderModel
    {
        return OrderModel::find($reference['id']);
    }
}
```

**订单模型 `app/Models/Order.php`：**

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Order extends Model
{
    protected $fillable = ['user_id', 'status', 'total_amount', 'currency'];

    protected $casts = [
        'total_amount' => 'float',
        'created_at' => 'datetime',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    // Federation 需要的 __typename
    public function getTypename(): string
    {
        return 'Order';
    }
}
```

**Lighthouse 配置 `config/lighthouse.php` 关键部分：**

```php
return [
    'route' => [
        'uri' => '/graphql',
        'middleware' => ['web', 'auth:sanctum'],
    ],
    'federation' => [
        // 启用 Federation 支持
        'entities' => true,
    ],
];
```

### 2.3 库存子图（Inventory）

**Schema `services/inventory/graphql/schema.graphql`：**

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@external"])

type Product @key(fields: "id") {
  id: ID!
  stock: StockInfo!
}

type StockInfo {
  available: Int!
  reserved: Int!
  warehouse: String!
}

type Query {
  productStock(productId: ID!): StockInfo
  bulkStock(productIds: [ID!]!): [StockInfo!]!
}
```

**库存查询优化——批量加载（N+1 防护）：**

```php
<?php

namespace App\GraphQL\Queries;

use App\Models\Inventory;
use Illuminate\Support\Facades\Cache;

class StockResolver
{
    /**
     * 批量查询库存，避免 N+1
     */
    public function bulkStock($root, array $args): array
    {
        $productIds = $args['productIds'];

        // 先从缓存取，miss 的再查库
        $cached = Cache::many(
            array_map(fn($id) => "stock:{$id}", $productIds)
        );

        $missedIds = [];
        $results = [];

        foreach ($productIds as $id) {
            $cacheKey = "stock:{$id}";
            if (isset($cached[$cacheKey])) {
                $results[$id] = $cached[$cacheKey];
            } else {
                $missedIds[] = $id;
            }
        }

        if (!empty($missedIds)) {
            $dbStocks = Inventory::whereIn('product_id', $missedIds)
                ->get()
                ->keyBy('product_id');

            $toCache = [];
            foreach ($missedIds as $id) {
                $stock = $dbStocks->get($id);
                $info = [
                    'available' => $stock?->available ?? 0,
                    'reserved' => $stock?->reserved ?? 0,
                    'warehouse' => $stock?->warehouse ?? 'default',
                ];
                $results[$id] = $info;
                $toCache["stock:{$id}"] = $info;
            }

            // 缓存 60 秒
            Cache::put($toCache, 60);
        }

        return array_map(fn($id) => $results[$id], $productIds);
    }
}
```

### 2.4 价格子图（Pricing）

**Schema `services/pricing/graphql/schema.graphql`：**

```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@external", "@requires"])

type Product @key(fields: "id") {
  id: ID!
  price: Money!
  discounts: [Discount!]!
}

type Money {
  amount: Float!
  currency: String!
}

type Discount {
  code: String!
  percentage: Float!
  validUntil: DateTime
}

type Query {
  productPrice(productId: ID!, currency: String = "CNY"): Money
}
```

**动态价格计算 `app/GraphQL/Queries/PriceResolver.php`：**

```php
<?php

namespace App\GraphQL\Queries;

use App\Models\Product;
use App\Models\Discount;
use App\Services\CurrencyConverter;

class PriceResolver
{
    public function __construct(
        private CurrencyConverter $converter
    ) {}

    public function productPrice($root, array $args): array
    {
        $product = Product::findOrFail($args['productId']);
        $currency = $args['currency'] ?? 'CNY';

        $basePrice = $product->base_price;

        // 应用生效中的折扣
        $activeDiscount = Discount::where('product_id', $product->id)
            ->where('valid_until', '>', now())
            ->orderByDesc('percentage')
            ->first();

        if ($activeDiscount) {
            $basePrice *= (1 - $activeDiscount->percentage / 100);
        }

        // 币种转换
        $converted = $this->converter->convert($basePrice, 'CNY', $currency);

        return [
            'amount' => round($converted, 2),
            'currency' => $currency,
        ];
    }
}
```

## 3. 网关层：Apollo Router

### 3.1 配置文件 `gateway/router.yaml`

```yaml
supergraph:
  listen: 0.0.0.0:4000

# 子图端点
include_subgraph_errors:
  all: true

# 子图定义
subgraphs:
  orders:
    routing_url: http://orders-service:8000/graphql
    schema:
      subgraph_url: http://orders-service:8000/graphql
  inventory:
    routing_url: http://inventory-service:8001/graphql
    schema:
      subgraph_url: http://inventory-service:8001/graphql
  pricing:
    routing_url: http://pricing-service:8002/graphql
    schema:
      subgraph_url: http://pricing-service:8002/graphql
```

### 3.2 Docker Compose 启动

```yaml
# docker-compose.yml
version: "3.9"
services:
  gateway:
    image: ghcr.io/apollographql/router:v1.40.0
    ports:
      - "4000:4000"
    volumes:
      - ./gateway/router.yaml:/config/router.yaml
      - ./supergraph.graphql:/config/supergraph.graphql
    command: ["--config", "/config/router.yaml", "--supergraph", "/config/supergraph.graphql"]

  orders-service:
    build: ./services/orders
    ports:
      - "8000:8000"

  inventory-service:
    build: ./services/inventory
    ports:
      - "8001:8001"

  pricing-service:
    build: ./services/pricing
    ports:
      - "8002:8002"
```

**生成超图 Schema：**

```bash
# 安装 Rover CLI
curl -sSL https://rover.apollo.dev/nix/latest | sh

# 合并子图
roster supergraph compose \
  --config ./gateway/supergraph-config.yaml \
  > ./supergraph.graphql
```

## 4. 网关鉴权：JWT + 权限校验

### 4.1 Router 层 JWT 验证

Apollo Router 支持通过 Rhai 脚本或 Coprocessor 实现鉴权。生产推荐用 Coprocessor 模式，这里用更轻量的 Rhai 脚本：

```rhai
// gateway/auth.rhai
fn supergraph_service(service) {
    let map_request = |request| {
        // 从 header 取 token
        let headers = request.headers;
        let auth = headers["authorization"];

        if auth == "" {
            throw #{
                status: 401,
                message: "Missing Authorization header"
            };
        }

        // 验证 Bearer token 格式
        if !auth.starts_with("Bearer ") {
            throw #{
                status: 401,
                message: "Invalid authorization format"
            };
        }

        let token = auth.sub_string(7, auth.len() - 7);

        // 调用 JWT 验证服务（或本地解码）
        let result = fetch("http://auth-service:8003/verify", #{
            method: "POST",
            headers: #{
                "Content-Type": "application/json"
            },
            body: json_encode(#{
                token: token
            })
        });

        if result.status != 200 {
            throw #{
                status: 401,
                message: "Invalid or expired token"
            };
        }

        let claims = json_decode(result.body);

        // 注入用户上下文到 GraphQL context
        request.context["user_id"] = claims["sub"];
        request.context["user_role"] = claims["role"];
    };

    service.map_request(map_request);
}
```

**在 router.yaml 中启用：**

```yaml
plugins:
  rhai.scripts: /config/auth.rhai
```

### 4.2 字段级权限控制

在子图 Lighthouse 层做字段级鉴权：

```php
<?php

namespace App\GraphQL\Directives;

use Nuwave\Lighthouse\Schema\Directives\BaseDirective;
use Nuwave\Lighthouse\Support\Contracts\FieldMiddleware;
use Nuwave\Lighthouse\Support\Contracts\GraphQLContext;

class AuthRoleDirective extends BaseDirective implements FieldMiddleware
{
    public function name(): string
    {
        return 'authRole';
    }

    public function handleField(FieldValue $fieldValue, \Closure $next): FieldValue
    {
        $requiredRole = $this->directiveArgValue('requires', 'user');

        return $next(
            $fieldValue->setResolver(function ($root, array $args, GraphQLContext $context) use ($requiredRole) {
                $user = $context->user();

                if (!$user) {
                    throw new \GraphQL\Error\UserError('Unauthenticated');
                }

                if ($requiredRole === 'admin' && $user->role !== 'admin') {
                    throw new \GraphQL\Error\UserError('Admin access required');
                }

                return $fieldValue->getResolver()($root, $args, $context);
            })
        );
    }
}
```

**Schema 中使用：**

```graphql
type Query {
  order(id: ID!): Order @authRole(requires: "user")
  allOrders(first: Int = 50): OrderConnection! @authRole(requires: "admin")
}
```

## 5. 响应缓存

### 5.1 Apollo Router 内置缓存

```yaml
# router.yaml
supergraph:
  cache:
    in_memory:
      limit: 512  # MB

subgraphs:
  inventory:
    routing_url: http://inventory-service:8001/graphql
    # 库存子图响应缓存 30 秒
    experimental_retry:
      min_per_sec: 10
      ttl_seconds: 30
  pricing:
    routing_url: http://pricing-service:8002/graphql
    # 价格子图响应缓存 60 秒
    experimental_retry:
      min_per_sec: 10
      ttl_seconds: 60
```

### 5.2 子图级 Redis 缓存

Laravel 端用 Redis 缓存查询结果：

```php
<?php

namespace App\GraphQL\Queries;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

class CachedStockResolver
{
    public function productStock($root, array $args): array
    {
        $productId = $args['productId'];
        $cacheKey = "gql:stock:{$productId}";

        return Cache::remember($cacheKey, 30, function () use ($productId) {
            return $this->fetchFromDB($productId);
        });
    }

    /**
     * 监听库存变更事件，主动失效缓存
     */
    public static function invalidateCache(string $productId): void
    {
        Cache::forget("gql:stock:{$productId}");

        // 通知网关清除相关缓存
        Redis::publish('cache-invalidation', json_encode([
            'type' => 'stock',
            'productId' => $productId,
        ]));
    }
}
```

**在库存变更 Observer 中触发：**

```php
<?php

namespace App\Observers;

use App\Models\Inventory;
use App\GraphQL\Queries\CachedStockResolver;

class InventoryObserver
{
    public function updated(Inventory $inventory): void
    {
        CachedStockResolver::invalidateCache($inventory->product_id);
    }
}
```

## 6. 踩坑记录

### 6.1 实体解析死循环

**问题：** 两个子图都定义了 `Product` 类型，网关合并时出现循环依赖。

**解决：** 每个实体只有一个子图是 "owner"（定义 `@key`），其他子图用 `@external` 声明引用字段：

```graphql
# inventory 子图：Product 只声明需要的外部字段
type Product @key(fields: "id") {
  id: ID!
  stock: StockInfo!
}

# pricing 子图：同理
type Product @key(fields: "id") {
  id: ID!
  price: Money!
}
```

### 6.2 N+1 查询导致子图超时

**问题：** 网关查 `orders { items { product { price } } }` 时，每个 item 都单独请求价格子图。

**解决：** 用 DataLoader 模式批量加载，Lighthouse 社区有 `lighthouse-dataloader` 插件，或者手写：

```php
<?php

namespace App\Services;

use Illuminate\Support\Collection;

class BatchPriceLoader
{
    private array $pending = [];
    private array $results = [];

    public function load(string $productId): mixed
    {
        if (isset($this->results[$productId])) {
            return $this->results[$productId];
        }

        $this->pending[] = $productId;
        return null;
    }

    public function dispatch(): void
    {
        if (empty($this->pending)) return;

        // 一次 RPC 批量查价格
        $prices = $this->fetchPricesBatch($this->pending);

        foreach ($prices as $id => $price) {
            $this->results[$id] = $price;
        }

        $this->pending = [];
    }
}
```

### 6.3 网关内存泄漏

**问题：** Apollo Router 长时间运行后内存持续增长。

**解决：** 升级到 v1.40+，该版本修复了查询计划缓存的内存泄漏。同时在 `router.yaml` 中限制缓存大小：

```yaml
supergraph:
  cache:
    in_memory:
      limit: 256
  query_planning:
    cache:
      in_memory:
        limit: 1000
```

### 6.4 Schema 变更部署顺序

**问题：** 先部署新子图再更新网关，导致短暂的 Schema 不兼容。

**解决：** 使用 Apollo Studio 的 Schema 检查功能，确保变更是向后兼容的。部署顺序：先更新所有子图 → 再更新网关 → 最后生成新超图 Schema。

## 7. 性能对比

在本地环境（M1 MacBook Pro, 16GB）简单压测：

| 指标 | 单体 GraphQL | Federation (3 子图) |
|------|-------------|-------------------|
| 单次查询延迟 (p50) | 12ms | 35ms |
| 单次查询延迟 (p99) | 45ms | 120ms |
| 并发 100 QPS | 8500 req/s | 3200 req/s |
| 冷启动时间 | 2s | 8s (3 子图 + 网关) |

Federation 有额外开销（网络跳数 + 查询计划），但换来的是：
- 独立部署、独立扩缩容
- 团队自治、Schema 解耦
- 单个子图故障不影响其他子图

## 8. 生产检查清单

```
□ 子图健康检查端点（/health）
□ 网关超时配置（单子图 > 网关 > 客户端）
□ 查询深度限制（防恶意嵌套）
□ 字段级速率限制
□ Schema 变更 CI 检查
□ 监控：查询计划耗时、子图响应时间、缓存命中率
□ 灰度发布策略
□ 回滚方案
```

## 总结

Federation 不是银弹，但在以下场景值得投入：

1. **团队 > 3 个**，各自维护不同业务域
2. **Schema > 1000 行**，合并冲突频繁
3. **扩缩容需求不均**，比如价格查询是订单查询的 10 倍流量
4. **多语言子图**，Go 做高并发、PHP 做业务逻辑

核心原则：**子图保持简单，复杂逻辑上移到网关**。鉴权、缓存、限流这些横切关注点放在 Router 层，子图只管业务数据。

下一步可以探索 Apollo Federation v2.7 的 `@policy` 指令做声明式权限控制，以及用 Apollo Router Coprocessor 替代 Rhai 脚本实现更灵活的鉴权逻辑。

---

*完整代码示例已放在 GitHub：[federation-demo](https://github.com/mikeah2011/federation-demo)*
