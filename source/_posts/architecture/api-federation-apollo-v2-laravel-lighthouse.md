---
title: API Federation 实战：Apollo Federation v2 + Laravel Lighthouse——微服务 GraphQL 超图的统一网关与鉴权
keywords: [API Federation, Apollo Federation v2, Laravel Lighthouse, GraphQL, 微服务, 超图的统一网关与鉴权, 架构]
date: 2026-06-09 15:54:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - GraphQL
  - Apollo Federation
  - Laravel
  - Lighthouse
  - 微服务
  - API Gateway
description: 从零搭建 Apollo Federation v2 超图网关，整合多个 Laravel Lighthouse 子图服务，实现跨服务类型扩展、统一鉴权与分布式追踪。
---


## 为什么需要 Federation

单体 GraphQL 服务在业务膨胀后会遇到几个典型问题：

- Schema 文件超过 5000 行，新同事看不懂
- 单次部署影响所有团队的变更
- 不同业务域的 Resolver 耦合在一起，互相 import 模型

Apollo Federation v2 的思路是：每个微服务（子图）只负责自己领域的一部分 Schema，通过 Gateway 合并成一张完整的超图（Supergraph）。客户端只看到一个端点，背后是 N 个独立部署的子图。

## 架构总览

```
客户端
  │
  ▼
Apollo Router (Gateway)  ← port 4000
  │
  ├─▶ 用户子图 (Laravel + Lighthouse)  ← port 8001
  ├─▶ 商品子图 (Laravel + Lighthouse)  ← port 8002
  └─▶ 订单子图 (Laravel + Lighthouse)  ← port 8003
```

每个子图是一个独立的 Laravel 项目，使用 Lighthouse 库暴露 GraphQL Schema。Gateway 负责合并 Schema、路由查询、拼装结果。

## 子图搭建（以用户服务为例）

### 安装 Lighthouse

```bash
composer create-project laravel/laravel user-service
cd user-service
composer require nuwave/lighthouse
php artisan lighthouse:publish
```

### 定义 User Schema

```graphql
# graphql/schema.graphql
type User @key(fields: "id") {
  id: ID!
  name: String!
  email: String!
  avatar: String
  createdAt: DateTime!
}

type Query {
  user(id: ID!): User @auth
  me: User @auth
}
```

`@key(fields: "id")` 是 Federation 的核心指令，告诉 Gateway：这个实体可以通过 `id` 字段被其他子图引用。

### 实现 Entity Resolver

Federation 需要一个专门的 `_entities` 查询，让 Gateway 能通过 `id` 批量获取实体：

```php
// app/GraphQL/Directives/UserEntityDirective.php
<?php

namespace App\GraphQL\Directives;

use Nuwave\Lighthouse\Schema\Directives\BaseDirective;
use Nuwave\Lighthouse\Support\Contracts\FieldResolver;

class UserEntityDirective extends BaseDirective implements FieldResolver
{
    public function resolveField($rootValue)
    {
        // Federation 会传入 __typename 和 key 字段
        return \App\Models\User::find($rootValue['id']);
    }
}
```

更简洁的方式是用 Lighthouse 内置的 Federation 支持：

```php
// app/GraphQL/Queries/EntitiesQuery.php
<?php

namespace App\GraphQL\Queries;

use App\Models\User;
use GraphQL\Type\Definition\ResolveInfo;
use Nuwave\Lighthouse\Support\Contracts\GraphQLContext;

class EntitiesQuery
{
    public function __invoke($root, array $args, GraphQLContext $context, ResolveInfo $info)
    {
        $representations = $args['representations'];
        $results = collect();

        foreach ($representations as $rep) {
            if ($rep['__typename'] === 'User') {
                $results->push(User::find($rep['id']));
            }
        }

        return $results;
    }
}
```

对应 Schema：

```graphql
# graphql/federation.graphql
extend schema
  @link(
    url: "https://specs.apollo.dev/federation/v2.5"
    import: ["@key", "@external", "@requires", "@provides"]
  )

type Query {
  _entities(representations: [_Any!]!): [_Entity]!
  _service: _Service!
}

union _Entity = User

scalar _Any
scalar _Service
```

### 鉴权方案

子图级别用 Laravel Sanctum 做 Token 鉴权：

```php
// app/GraphQL/Directives/AuthDirective.php
<?php

namespace App\GraphQL\Directives;

use Nuwave\Lighthouse\Schema\Directives\BaseDirective;
use Nuwave\Lighthouse\Support\Contracts\Directive;

class AuthDirective extends BaseDirective implements Directive
{
    public static function definition(): string
    {
        return <<<'GRAPHQL'
directive @auth on FIELD_DEFINITION
GRAPHQL;
    }
}
```

在 Resolver 中注入认证逻辑：

```php
// app/GraphQL/Queries/UserQueries.php
<?php

namespace App\GraphQL\Queries;

use App\Models\User;

class UserQueries
{
    public function user($root, array $args)
    {
        // 从 Gateway 传递的 header 中获取 token
        $token = request()->bearerToken();
        if (!$token) {
            throw new \GraphQL\Error\UserError('Unauthorized');
        }

        return User::findOrFail($args['id']);
    }

    public function me($root, array $args)
    {
        return auth()->user();
    }
}
```

## 商品子图

```graphql
# graphql/schema.graphql
type Product @key(fields: "id") {
  id: ID!
  name: String!
  price: Float!
  stock: Int!
  category: Category!
  sellerId: ID!
  seller: User! @requires(fields: "sellerId")
}

type Category {
  id: ID!
  name: String!
  products: [Product!]!
}

extend type User @key(fields: "id") {
  id: ID! @external
  products: [Product!]!
}

type Query {
  product(id: ID!): Product
  products(categoryId: ID): [Product!]!
}
```

注意 `extend type User @key(fields: "id")`——这是 Federation 的跨服务类型扩展。商品服务声明"我知道有个 User 类型，它的 key 是 id，我还能给它附加 products 字段"。

对应的 Resolver：

```php
// app/GraphQL/Types/UserTypeExtension.php
<?php

namespace App\GraphQL\Types;

use App\Models\Product;

class UserTypeExtension
{
    public function products($root, array $args)
    {
        return Product::where('seller_id', $root['id'])->get();
    }
}
```

这样当客户端查询：

```graphql
query {
  me {
    name
    products {
      name
      price
    }
  }
}
```

Gateway 会先调用户子图拿 `me`，再调商品子图拿 `products`，自动拼装。

## 订单子图

```graphql
# graphql/schema.graphql
type Order @key(fields: "id") {
  id: ID!
  userId: ID!
  user: User! @requires(fields: "userId")
  items: [OrderItem!]!
  total: Float!
  status: OrderStatus!
  createdAt: DateTime!
}

type OrderItem {
  productId: ID!
  product: Product! @requires(fields: "productId")
  quantity: Int!
  price: Float!
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
  COMPLETED
  CANCELLED
}

extend type User @key(fields: "id") {
  id: ID! @external
  orders: [Order!]!
}

extend type Product @key(fields: "id") {
  id: ID! @external
  orderCount: Int!
}

type Query {
  order(id: ID!): Order @auth
  myOrders: [Order!]! @auth
}
```

## Gateway 配置

### 安装 Apollo Router

```bash
# macOS
brew install apollo-router

# 或者下载二进制
curl -sSL https://router.apollo.dev/download/nix/latest | sh
```

### 超图配置

```yaml
# supergraph.yaml
federation_version: 2
subgraphs:
  user:
    routing_url: http://localhost:8001/graphql
    schema:
      subgraph_url: http://localhost:8001/graphql
  product:
    routing_url: http://localhost:8002/graphql
    schema:
      subgraph_url: http://localhost:8002/graphql
  order:
    routing_url: http://localhost:8003/graphql
    schema:
      subgraph_url: http://localhost:8003/graphql
```

### 生成超图 Schema

```bash
rover supergraph compose --config ./supergraph.yaml > supergraph.graphql
```

### 启动 Gateway

```bash
# router.yaml
supergraph:
  listen: 0.0.0.0:4000
  introspection: true

cors:
  origins:
    - http://localhost:3000
  methods:
    - GET
    - POST

headers:
  all:
    request:
      - propagate:
          named: Authorization
```

```bash
apollo-router --config router.yaml --supergraph supergraph.graphql
```

Gateway 启动后，所有客户端请求统一打到 `http://localhost:4000/graphql`。

## 统一鉴权中间件

Gateway 层的鉴权不应该解析业务逻辑，而是做 Token 校验和转发：

```php
// app/Http/Middleware/FederationAuth.php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class FederationAuth
{
    public function handle(Request $request, Closure $next)
    {
        // 从 Gateway 透传的 header 中提取用户信息
        $userId = $request->header('X-User-Id');
        $userRole = $request->header('X-User-Role');

        if ($userId) {
            // 将 Gateway 注入的用户信息设到 auth guard
            auth()->setUser(
                \App\Models\User::find($userId)
            );
        }

        return $next($request);
    }
}
```

在 Lighthouse 的 config 中注册中间件：

```php
// config/lighthouse.php
'middleware' => [
    \App\Http\Middleware\FederationAuth::class,
],
```

## Apollo Router 插件：JWT 验证

在 Gateway 层用 Rust 插件做 JWT 验证，避免每个子图重复实现：

```yaml
# router.yaml
authentication:
  router:
    jwt:
      jwks:
        url: http://user-service:8001/.well-known/jwks.json
      header_name: Authorization
      header_value_prefix: "Bearer "

# 验证通过后注入用户信息到子图请求头
headers:
  all:
    request:
      - propagate:
          named: Authorization
      - insert:
          name: X-User-Id
          value: "${claims.sub}"
      - insert:
          name: X-User-Role
          value: "${claims.role}"
```

## 分布式追踪

Federation 查询可能涉及多个子图的串联调用，没有追踪就是瞎子。

```yaml
# router.yaml
telemetry:
  instrumentation:
    spans:
      mode: spec_compliant
  exporters:
    tracing:
      otlp:
        endpoint: http://jaeger:4317
        protocol: grpc
    metrics:
      prometheus:
        listen: 0.0.0.0:9090
        path: /metrics
```

每个子图也接入 OpenTelemetry：

```php
// app/Providers/AppServiceProvider.php
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\Exporter\Otlp\OtlpGrpcExporter;

public function register()
{
    $exporter = new OtlpGrpcExporter([
        'endpoint' => env('OTEL_ENDPOINT', 'http://jaeger:4317'),
    ]);

    $tracerProvider = TracerProvider::builder()
        ->addSpanProcessor(
            new SimpleSpanProcessor($exporter)
        )
        ->build();

    $tracer = $tracerProvider->getTracer('user-service');
    app()->instance('tracer', $tracer);
}
```

## 性能优化：DataLoader 批量查询

N+1 问题在 Federation 下会被放大——Gateway 每拼装一个字段就调一次子图。

```php
// app/GraphQL/DataLoaders/UserDataLoader.php
<?php

namespace App\GraphQL\DataLoaders;

use App\Models\User;
use Illuminate\Support\Collection;

class UserDataLoader
{
    protected array $buffer = [];

    public function load(int $id): User
    {
        $this->buffer[] = $id;
        return User::findOrFail($id); // 实际应延迟批量
    }

    public function loadMany(array $ids): Collection
    {
        return User::whereIn('id', $ids)->get()->keyBy('id');
    }
}
```

Lighthouse 5+ 内置了 `@lazyLoad` 指令，推荐直接使用：

```graphql
type OrderItem {
  product: Product! @lazyLoad
}
```

## 踩坑记录

### 1. Schema 循环依赖

商品子图引用 User，订单子图引用 User 和 Product。如果三方互相 extend，Gateway 启动会报循环依赖。解决办法：只允许单向扩展，User 不反向引用 Product。

### 2. `_entities` 批量大小

Gateway 默认一次传多少个 representation 给子图？答案是不限。当一个查询关联 1000 个订单时，子图会收到 1000 个 id。需要在子图做分批处理：

```php
public function __invoke($root, array $args)
{
    $representations = collect($args['representations']);
    $results = $representations->chunk(100)->flatMap(function ($chunk) {
        $ids = $chunk->pluck('id');
        return User::whereIn('id', $ids)->get()->keyBy('id');
    });

    return $representations->map(fn($rep) => $results[$rep['id']] ?? null)->values();
}
```

### 3. 类型冲突

两个子图都定义了 `DateTime` scalar，Gateway 会报类型冲突。统一在 Gateway 端定义公共 scalar，或者各子图用 Lighthouse 的 `@scalar` 指令指向同一个实现。

### 4. 热重载问题

开发时改了子图 Schema，Gateway 不会自动感知。需要重新 compose 超图：

```bash
# 开发环境用 watch 模式
rover supergraph compose --config ./supergraph.yaml --watch > supergraph.graphql
```

### 5. 错误传播

子图返回的错误会被 Gateway 包装成统一格式，但原始错误信息可能丢失。配置：

```yaml
# router.yaml
include_subgraph_errors:
  all: true  # 开发环境打开，生产环境关闭
```

## 生产部署清单

- Gateway 用 Docker 部署，子图各自独立 CI/CD
- Schema Registry 用 Apollo Studio 或自建 Rover
- 每次子图发布前跑 `roster subgraph check` 验证兼容性
- Gateway 限流用 `traffic_shaping` 插件
- 子图健康检查暴露 `/health` 端点

```yaml
# router.yaml
traffic_shaping:
  router:
    timeout: 30s
  all:
    timeout: 10s
  subgraphs:
    order-service:
      timeout: 15s
```

## 总结

Apollo Federation v2 + Laravel Lighthouse 的组合适合以下场景：

- 团队按业务域划分，各自独立开发部署
- 需要统一 API 入口，客户端不想维护多个端点
- 跨服务关联查询频繁（用户→商品→订单这种链式查询）

不适合的场景：

- 服务数量 < 3，单体 GraphQL 更简单
- 团队没有 GraphQL 经验，学习成本高
- 对延迟极度敏感（多一跳 Gateway 会增加 5-10ms）

核心决策点：**先确认你的查询真的需要跨服务拼装，再决定上 Federation。很多所谓的"微服务"用 REST + BFF 模式就够了。**
