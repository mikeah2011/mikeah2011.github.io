---
title: Laravel + GraphQL Federation 实战：微服务图的统一网关
keywords: [Laravel, GraphQL Federation, 微服务图的统一网关, 架构]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-06-09 13:21:00
categories:
  - architecture
tags:
  - Laravel
  - GraphQL
  - Apollo Federation
  - Lighthouse
  - 微服务
  - API Gateway
description: 当单体 Laravel 应用拆分成多个微服务后，前端面对多个 GraphQL 端点会很痛苦。本文用 Apollo Federation + Laravel Lighthouse 实战搭建统一网关，包含 Subgraph 拆分、Entity Reference、跨服务 Query 解析，以及踩坑记录。
---


## 前端的噩梦：多个 GraphQL 端点

假设你有一个电商系统，拆成了三个 Laravel 微服务：

- **用户服务**（User Service）：注册、登录、用户资料
- **商品服务**（Product Service）：商品 CRUD、库存、分类
- **订单服务**（Order Service）：下单、支付、物流

每个服务都有自己的 GraphQL 端点。前端要获取一个「订单详情页」的数据，需要：

1. 调订单服务拿订单基本信息
2. 拿到 `user_id` 后调用户服务拿用户昵称
3. 拿到 `product_ids` 后调商品服务拿商品详情

三次请求，前端自己做数据组装。这和 REST 时代的问题一模一样——只不过从 REST 换成了 GraphQL。

**GraphQL Federation 就是来解决这个问题的。** 它让你把多个独立的 GraphQL Schema（Subgraph）合并成一个统一的 Supergraph，前端只看到一个端点。

## 核心概念

### Federation 是什么

Apollo Federation 是 Apollo 公司提出的协议（现在已经是 v2），允许你把一个大的 GraphQL Schema 拆分到多个独立服务中，每个服务负责自己那部分 Schema，然后通过一个 Gateway 把它们合并。

```
┌─────────────┐
│   Gateway   │  ← 前端只和这个通信
│ (Supergraph)│
└──────┬──────┘
       │
  ┌────┼────┐
  │    │    │
  ▼    ▼    ▼
┌───┐┌───┐┌───┐
│ U ││ P ││ O │  ← 各自独立的 GraphQL 服务 (Subgraph)
│ s ││ r ││ r │
│ e ││ o ││ d │
│ r ││ d ││ e │
└───┘└───┘└───┘
```

### 关键概念

| 概念 | 说明 |
|------|------|
| **Subgraph** | 一个独立的 GraphQL 服务，暴露自己的一部分 Schema |
| **Supergraph** | Gateway 合并后的完整 Schema |
| **Entity** | 可以跨服务引用的类型，比如 `User`、`Product` |
| **`@key`** | 指定 Entity 的唯一标识字段，类似主键 |
| **`@external`** | 声明某个字段由其他服务提供 |
| **`@requires`** | 声明解析某个字段需要先从其他服务获取哪些字段 |

### Entity Reference 的工作原理

当订单服务需要返回用户信息时：

1. 订单服务在自己的 Schema 中声明 `User` 为 Entity Reference（只有 `id` 字段）
2. Gateway 看到订单查询需要 `User.name`，发现 `name` 由用户服务提供
3. Gateway 先从订单服务拿到 `User { id }`，然后拿着 `id` 去用户服务查询 `name`
4. 最后合并结果返回给前端

这就是 Federation 的魔法——**各服务只知道自己负责的字段，Gateway 负责编排查询顺序并合并结果。**

## 实战搭建

### 项目结构

```
graphql-federation-demo/
├── gateway/                 # Apollo Gateway (Node.js)
│   ├── package.json
│   └── index.js
├── user-service/            # Laravel 用户服务
│   ├── app/GraphQL/...
│   └── ...
├── product-service/         # Laravel 商品服务
│   ├── app/GraphQL/...
│   └── ...
└── order-service/           # Laravel 订单服务
    ├── app/GraphQL/...
    └── ...
```

### Step 1：搭建 Laravel Subgraph 服务

每个 Laravel 服务用 [Lighthouse](https://lighthouse-php.com/) 来暴露 GraphQL Schema。需要安装 Lighthouse 和 Federation 插件。

```bash
# 在每个 Laravel 服务中执行
composer require nuwave/lighthouse
composer require nuwave/lighthouse-federation

# 发布配置
php artisan vendor:publish --tag=lighthouse-schema
php artisan vendor:publish --tag=lighthouse-federation
```

> ⚠️ **版本提示**：`nuwave/lighthouse-federation` 需要和 Lighthouse 主版本匹配。Lighthouse v6 对应 Federation v0.7+，安装前先检查 `composer show nuwave/lighthouse` 的版本。

### Step 2：用户服务 Schema

`user-service/graphql/schema.graphql`：

```graphql
type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
    avatar: String
    phone: String
    created_at: DateTime!
}

type Query {
    user(id: ID!): User @auth
    users(limit: Int = 20, offset: Int = 0): [User!]! @auth
}

type Mutation {
    updateProfile(input: UpdateProfileInput!): User! @auth
}

input UpdateProfileInput {
    name: String
    avatar: String
    phone: String
}
```

`@key(fields: "id")` 告诉 Federation：这个 `User` 类型可以通过 `id` 字段被其他服务引用。

在 Resolver 中实现 `__resolveReference`：

```php
<?php

namespace App\GraphQL\Types;

use App\Models\User;

class UserDirective extends \Nuwave\Lighthouse\Schema\Directives\BaseDirective
{
    // Lighthouse Federation 会自动处理 __resolveReference
    // 只需要确保 User model 的 find 方法能通过 id 查到数据
}
```

Lighthouse Federation 插件会自动为标记了 `@key` 的类型生成 `__resolveReference`。你需要配置 Entity Resolver：

```php
// user-service/config/lighthouse.php (追加)
'federation' => [
    'entities' => [
        'User' => [
            'resolver' => \App\Models\User::class,
            'key' => 'id', // 用哪个字段查找
        ],
    ],
],
```

或者用更灵活的方式，手动注册：

```php
// user-service/app/Providers/FederationServiceProvider.php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Nuwave\Lighthouse\Federation\FederationServiceProvider as BaseFederation;

class FederationServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->register(BaseFederation::class);
    }
}
```

### Step 3：商品服务 Schema

`product-service/graphql/schema.graphql`：

```graphql
type Product @key(fields: "id") {
    id: ID!
    name: String!
    description: String
    price: Float!
    stock: Int!
    category: Category!
    images: [String!]
    created_at: DateTime!
}

type Category {
    id: ID!
    name: String!
    slug: String!
}

extend type Query {
    product(id: ID!): Product
    products(
        category_id: ID
        keyword: String
        limit: Int = 20
        offset: Int = 0
    ): [Product!]!
}

# 为 Federation 扩展 User 类型，添加该服务负责的字段
extend type User @key(fields: "id") {
    id: ID! @external
    # 如果商品服务需要展示「用户收藏的商品」之类的字段，在这里扩展
    favorite_products: [Product!]!
}
```

注意 `extend type User`——这告诉 Gateway：商品服务也可以为 `User` 类型提供字段（这里是 `favorite_products`）。`id: ID! @external` 表示 `id` 不是由商品服务提供的，而是从其他服务传过来的。

### Step 4：订单服务 Schema

`order-service/graphql/schema.graphql`：

```graphql
type Order @key(fields: "id") {
    id: ID!
    status: OrderStatus!
    total_amount: Float!
    items: [OrderItem!]!
    user: User!
    created_at: DateTime!
    paid_at: DateTime
    shipped_at: DateTime
}

type OrderItem {
    id: ID!
    product: Product!
    quantity: Int!
    price: Float!
}

enum OrderStatus {
    PENDING
    PAID
    SHIPPED
    DELIVERED
    CANCELLED
}

extend type Query {
    order(id: ID!): Order @auth
    my_orders(status: OrderStatus, limit: Int = 20): [Order!]! @auth
}

extend type Mutation {
    createOrder(input: CreateOrderInput!): Order! @auth
}

input CreateOrderInput {
    items: [CreateOrderItemInput!]!
}

input CreateOrderItemInput {
    product_id: ID!
    quantity: Int!
}

# 为 Federation 扩展 User，让订单服务可以解析「用户的订单列表」
extend type User @key(fields: "id") {
    id: ID! @external
    orders(status: OrderStatus, limit: Int = 20): [Order!]!
}
```

订单服务的 Schema 引用了 `User` 和 `Product` 类型。当 Gateway 收到一个查询订单的请求，需要返回订单中用户的 `name` 和商品的 `name` 时，Gateway 会自动：

1. 从订单服务获取订单数据和关联的 `User.id`、`Product.id`
2. 用这些 ID 去用户服务和商品服务获取对应的 `name` 字段
3. 合并后返回

### Step 5：实现跨服务引用的 Resolver

订单服务需要解析 `Order.user` 和 `OrderItem.product`。在 Laravel 中：

```php
<?php

namespace App\GraphQL\Resolvers;

use App\Models\Order;

class OrderResolver
{
    /**
     * 解析订单中的用户信息
     * 返回的数组包含 __typename 和 key 字段
     * Gateway 会用这些信息去用户服务查询完整数据
     */
    public function resolveUser(Order $order): array
    {
        return [
            '__typename' => 'User',
            'id' => $order->user_id,
        ];
    }

    /**
     * 解析订单项中的商品信息
     */
    public function resolveProduct($orderItem): array
    {
        return [
            '__typename' => 'Product',
            'id' => $orderItem->product_id,
        ];
    }

    /**
     * 用户的订单列表（Federation 扩展字段）
     */
    public function resolveUserOrders(array $user, ?string $status = null, int $limit = 20): array
    {
        $query = Order::where('user_id', $user['id'])
            ->orderByDesc('created_at')
            ->limit($limit);

        if ($status) {
            $query->where('status', $status);
        }

        return $query->get()->all();
    }
}
```

对应的 GraphQL directive 配置：

```graphql
# order-service/graphql/schema.graphql 中的类型定义
type Order @key(fields: "id") {
    id: ID!
    # ...
    user: User! @belongsTo(relation: "user")  # Lighthouse 自动处理关联
}

# 但 Federation 场景下，user 字段需要返回 Reference 而非完整 User
# 所以需要用自定义 resolver
```

更稳妥的方式是用 `@method` directive 返回 reference：

```graphql
type Order @key(fields: "id") {
    id: ID!
    status: OrderStatus!
    total_amount: Float!
    items: [OrderItem!]!
    user: User! @method(name: "resolveUserForFederation")
    created_at: DateTime!
}
```

在 Order model 中：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Order extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Federation 需要：返回 User 的 Reference
     */
    public function resolveUserForFederation(): array
    {
        return [
            '__typename' => 'User',
            'id' => (string) $this->user_id,
        ];
    }
}
```

### Step 6：搭建 Apollo Gateway

Gateway 用 Node.js + Apollo Server 搭建：

```bash
mkdir gateway && cd gateway
npm init -y
npm install @apollo/server @apollo/gateway graphql
```

`gateway/index.js`：

```javascript
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { ApolloGateway, IntrospectAndCompose, RemoteGraphQLDataSource } from '@apollo/gateway';

// 自定义 DataSource，把认证信息透传给各 Subgraph
class AuthenticatedDataSource extends RemoteGraphQLDataSource {
  willSendRequest({ request, context }) {
    // 从 Gateway 的 context 中拿 token，转发给各服务
    if (context.authToken) {
      request.http.headers.set('Authorization', context.authToken);
    }
  }
}

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: 'users', url: 'http://localhost:8001/graphql' },
      { name: 'products', url: 'http://localhost:8002/graphql' },
      { name: 'orders', url: 'http://localhost:8003/graphql' },
    ],
  }),
  buildService({ url }) {
    return new AuthenticatedDataSource({ url });
  },
});

const server = new ApolloServer({
  gateway,
  // Federation 不支持 subscriptions，需要单独处理
  // subscriptions: false,
});

const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 },
  // 从请求中提取认证信息
  context: async ({ req }) => {
    const authToken = req.headers.authorization || '';
    return { authToken };
  },
});

console.log(`🚀 Gateway ready at ${url}`);
```

### Step 7：启动和测试

```bash
# 终端 1：启动用户服务
cd user-service && php artisan serve --port=8001

# 终端 2：启动商品服务
cd product-service && php artisan serve --port=8002

# 终端 3：启动订单服务
cd order-service && php artisan serve --port=8003

# 终端 4：启动 Gateway
cd gateway && node index.js
```

Gateway 启动后，在 `http://localhost:4000` 可以访问合并后的 Playground。

测试跨服务查询：

```graphql
query {
  my_orders(status: PAID, limit: 10) {
    id
    status
    total_amount
    created_at
    # 用户信息来自用户服务
    user {
      id
      name
      email
    }
    items {
      quantity
      price
      # 商品信息来自商品服务
      product {
        name
        price
        images
      }
    }
  }
}
```

一个查询，Gateway 自动从三个服务拉取数据并合并。前端完全不知道背后有三个服务。

## 实际踩坑记录

### 坑 1：循环依赖导致超时

当订单服务引用了 User 类型，用户服务又想展示用户的订单时，如果查询写得不好，Gateway 可能会无限递归。

**症状**：查询超时，Gateway 日志中反复出现对同一服务的请求。

**解决**：确保 Entity Reference 只返回 `id`，不要在 Reference 中嵌套需要再次 Federation 解析的字段。上面代码中的 `resolveUserForFederation` 只返回 `{ __typename, id }` 就是这个原因。

### 坑 2：Laravel Session 中间件干扰 Federation

Laravel 默认的 `web` 中间件组包含 session 和 CSRF 中间件，Federation 的服务间通信是纯 HTTP POST，不需要这些。

**症状**：Gateway 请求 Subgraph 时收到 419 或 session 错误。

**解决**：给 GraphQL 路由单独配置中间件：

```php
// user-service/routes/web.php 或 api.php
Route::post('/graphql', function () {
    return app()->make('graphql')->execute();
})->middleware(['api']);  // 只用 api 中间件组
```

或者在 `config/lighthouse.php` 中配置：

```php
'route' => [
    'middleware' => ['api'],
    // ...
],
```

### 坑 3：`@key` 字段必须在 Subgraph 中可查

Federation 需要通过 `@key` 字段来查找 Entity。如果用户服务的 `User` 类型 `@key(fields: "id")` 但没有暴露 `user(id: ID!)` 这样的查询入口，Gateway 就无法解析 Reference。

**症状**：Gateway 返回 `Cannot query field "user" on type "Query"` 或类似的 Schema 合并错误。

**解决**：确保每个标记了 `@key` 的类型，对应的 Query 字段存在且可用。用户服务必须有 `user(id: ID!): User` 查询。

### 坑 4：`DateTime` 类型不一致

不同 Laravel 服务可能用了不同的 DateTime scalar 实现。Lighthouse 默认的 `DateTime` 格式和某些自定义 scalar 可能冲突。

**症状**：Gateway 合并 Schema 时报 scalar 类型冲突。

**解决**：所有服务统一用 Lighthouse 的默认 `DateTime` scalar，或者在每个服务中定义相同的自定义 scalar：

```graphql
# 所有服务中保持一致
scalar DateTime @scalar(class: "Nuwave\\Lighthouse\\Schema\\Types\\Scalars\\DateTime")
```

### 坑 5：生产环境不用 IntrospectAndCompose

开发时用 `IntrospectAndCompose` 很方便，它会自动从各 Subgraph 拉取 Schema 并合并。但生产环境不推荐，因为：

1. 启动时要等所有 Subgraph 就绪
2. 每次 Gateway 重启都要重新 introspect，有延迟
3. 无法做 Schema 校验和灰度发布

**生产方案**：用 `rover` CLI 预先组合 Schema：

```bash
# 安装 Apollo Rover CLI
npm install -g @apollo/rover

# 本地组合 Schema
rover supergraph compose --config ./supergraph-config.yaml > supergraph.graphql
```

`supergraph-config.yaml`：

```yaml
federation_version: 2
subgraphs:
  users:
    routing_url: http://user-service:8001/graphql
    schema:
      subgraph_url: http://localhost:8001/graphql
  products:
    routing_url: http://product-service:8002/graphql
    schema:
      subgraph_url: http://localhost:8002/graphql
  orders:
    routing_url: http://order-service:8003/graphql
    schema:
      subgraph_url: http://localhost:8003/graphql
```

然后在 Gateway 中加载预组合的 Schema：

```javascript
import { readFileSync } from 'fs';

const gateway = new ApolloGateway({
  supergraphSdl: readFileSync('./supergraph.graphql').toString(),
  buildService({ url }) {
    return new AuthenticatedDataSource({ url });
  },
});
```

## 性能优化

### DataLoader 解决 N+1

Federation 本身不会帮你解决 N+1 问题。当查询 10 个订单的用户信息时，Gateway 会向用户服务发送一个包含 10 个 `User` Reference 的批量查询（`_entities`），这比 10 次单独查询好，但你的 Subgraph 内部的数据库查询仍然可能有 N+1。

```php
<?php

namespace App\GraphQL\Resolvers;

use App\Models\User;
use Illuminate\Database\Eloquent\Collection;

class EntityResolver
{
    /**
     * 批量解析 User Entity References
     * Federation 会调用 _entities 查询，传入多个 Reference
     */
    public function resolveUsers(array $representations): Collection
    {
        $ids = array_column($representations, 'id');

        return User::whereIn('id', $ids)->get();
    }
}
```

确保 Lighthouse 配置了 `@hasMany` 等关联的 eager loading：

```graphql
type Order @key(fields: "id") {
    id: ID!
    items: [OrderItem!]! @hasMany  # Lighthouse 会自动 eager load
}
```

### 缓存策略

Gateway 层可以加 Redis 缓存，对高频查询做响应缓存：

```javascript
import { RedisCache } from 'apollo-server-cache-redis';

const server = new ApolloServer({
  gateway,
  cache: new RedisCache({
    host: 'redis-host',
    port: 6379,
  }),
});
```

对于不常变化的数据（如商品分类），可以在 Subgraph 层用 Laravel Cache：

```php
public function categories(): Collection
{
    return Cache::remember('categories', 3600, function () {
        return Category::all();
    });
}
```

### 查询复杂度限制

Federation Gateway 合并后的查询可能非常复杂，需要限制防止恶意查询：

```javascript
import { ApolloServerPluginUsageReporting } from '@apollo/server';

const server = new ApolloServer({
  gateway,
  plugins: [
    ApolloServerPluginUsageReporting({
      sendVariableValues: { none: true },
    }),
  ],
  validationRules: [
    // 限制查询深度
    createDepthLimitRule(10),
    // 限制查询复杂度
    createComplexityLimitRule(1000),
  ],
});
```

## 和 REST API Gateway 的对比

| 维度 | REST + Kong/Nginx | GraphQL Federation |
|------|-------------------|--------------------|
| 数据获取 | 前端多次请求，自己合并 | 一次查询，Gateway 合并 |
| 类型安全 | 依赖 OpenAPI 文档 | Schema 级别的类型检查 |
| 学习曲线 | 低（REST 大家都会） | 高（Federation 概念多） |
| 调试难度 | 低（每个请求独立） | 高（跨服务解析链路长） |
| 适用场景 | CRUD 简单、服务少 | 复杂查询多、前端需求变化快 |
| 团队规模 | 小团队友好 | 大团队收益更高 |

**我的建议**：如果团队不到 5 个服务，前端查询需求不复杂，用 REST + API Gateway 就够了。Federation 的收益在服务数量 > 5、前端聚合需求频繁时才明显。

## 什么时候不该用 Federation

1. **服务数量少于 3 个**：直接用一个 GraphQL 端点就够了，拆 Federation 增加了复杂度但没收益
2. **团队对 GraphQL 不熟悉**：先在一个服务中用 Lighthouse 跑通，再考虑 Federation
3. **主要是事件驱动架构**：如果你的服务之间主要通过消息队列通信，Federation 的同步查询模式可能不适合
4. **性能极端敏感**：Federation 的 Gateway 合并查询会增加延迟（通常 10-50ms），极端场景可能不可接受

## 总结

Federation 不是银弹，但它确实解决了微服务架构中「前端数据聚合」的核心痛点。关键要点：

1. **Entity Reference 是核心**——理解 `{ __typename, id }` 的工作原理，就理解了 Federation 的 80%
2. **Gateway 是瓶颈也是优势**——它集中了认证、限流、缓存，但也引入了单点
3. **生产环境用预组合 Schema**——不要依赖运行时 introspect
4. **Laravel Lighthouse 生态成熟**——`nuwave/lighthouse-federation` 已经能覆盖大部分场景
5. **先跑通再优化**——别一上来就搞复杂的数据加载策略，先把 Federation 环路跑通

代码仓库：[github.com/mikeah2011/graphql-federation-demo](https://github.com/mikeah2011/graphql-federation-demo)（待创建）

---

*本文基于 Apollo Federation v2 + Lighthouse v6 编写。如果你用的是 v1，`@key` 和 `extend type` 的语法略有不同，参考 [Apollo 官方迁移指南](https://www.apollographql.com/docs/federation/federation-2/moving-to-federation-2)。*
