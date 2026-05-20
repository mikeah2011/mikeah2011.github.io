---
title: GraphQL Federation 超图实战：订单、库存、价格子图拆分与网关鉴权缓存踩坑记录
date: 2026-05-03 08:52:00
categories:
  - 00_架构
tags: [BFF, Laravel, 微服务, 架构]description: 结合 Laravel BFF 对接 Apollo Router 的真实改造经验，记录 GraphQL Federation 在子图拆分、鉴权透传、N+1、缓存与发布兼容上的一套可落地实践。
---

我们把商品详情页从“Laravel BFF 串 4 个 REST 服务”改成 **GraphQL Federation 超图**，并不是为了把接口改得更潮，而是因为原方案在高峰期会同时出现三个问题：字段过取、下游接口爆炸、以及前端每加一个卡片都要补一次聚合逻辑。上线 Federation 之后，接口数确实少了，但真正难的不是 SDL 怎么写，而是**子图边界、鉴权透传、跨服务 N+1 和网关缓存一致性**。

这篇只讲我在生产里踩过的坑，不讲 GraphQL 入门。

## 一、我们最后落地的结构

```text
App / Web
   │
   ▼
Laravel BFF
   │  trace-id / user-id / locale
   ▼
Apollo Router
   │
   ├── Order Subgraph      (Node.js)
   ├── Inventory Subgraph  (Go)
   └── Pricing Subgraph    (Laravel)
            │
            ├── MySQL
            └── Redis
```

这里我刻意保留了 **Laravel BFF**，没有让客户端直连 Router。原因很实际：登录态、灰度 header、风控字段、AB 实验参数，本来就都在 BFF 里，直接放给客户端会让网关变成新的业务层。Federation 更适合做**领域查询编排**，不是替代所有边界层。

## 二、子图怎么拆，决定你后面要不要返工

我第一版拆分很失败：按页面模块拆成 `product-card`、`review-card`、`price-card`，结果一改 UI 就要改 schema。后来改成按领域归属拆：订单、库存、价格各自拥有实体和字段。

下面是订单子图的 SDL，是真正在跑的写法：

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external", "@requires"])

type Query {
  order(id: ID!): Order
}

type Order @key(fields: "id") {
  id: ID!
  orderNo: String!
  skuId: ID!
  quantity: Int!
  status: String!
  price: PriceSummary @external
  inventory: InventorySummary @external
  canRefund: Boolean! @requires(fields: "status")
}
```

订单服务只维护自己真正负责的数据；价格、库存是外部字段，避免把别人的模型复制一份到本服务里。`canRefund` 这种派生字段可以留在订单域，但前提是依赖关系明确。

对应 resolver：

```ts
import { buildSubgraphSchema } from '@apollo/subgraph';
import { startStandaloneServer } from '@apollo/server/standalone';
import { ApolloServer } from '@apollo/server';
import gql from 'graphql-tag';

const typeDefs = gql`${require('fs').readFileSync('./schema.graphql', 'utf8')}`;

const resolvers = {
  Query: {
    order: async (_: unknown, { id }: { id: string }, { dataSources }: any) => {
      return dataSources.orderRepo.findById(id);
    },
  },
  Order: {
    __resolveReference: async (ref: { id: string }, { dataSources }: any) => {
      return dataSources.orderRepo.findById(ref.id);
    },
    canRefund: (order: { status: string }) => ['paid', 'ticketed'].includes(order.status),
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
});

startStandaloneServer(server, {
  listen: { port: 4001 },
  context: async ({ req }) => ({
    headers: req.headers,
    dataSources: {
      orderRepo: new OrderRepository(),
    },
  }),
});
```

## 三、Laravel BFF 怎么接 Router，别把 header 丢了

很多团队接到最后，问题不在 GraphQL，而是请求到了 Router 以后，`x-user-id`、`x-locale`、`x-trace-id` 没继续往下传，导致库存服务打日志查不到人、价格服务命中默认币别。

我在 Laravel 里会统一封一个 Router Client：

```php
<?php

namespace App\Infrastructure\GraphQL;

use Illuminate\Support\Facades\Http;

class SupergraphClient
{
    public function query(string $query, array $variables = [], array $headers = []): array
    {
        $response = Http::baseUrl(config('services.supergraph.url'))
            ->withHeaders([
                'x-trace-id' => request()->header('x-trace-id', (string) str()->uuid()),
                'x-user-id' => (string) optional(auth()->user())->id,
                'x-locale' => app()->getLocale(),
            ] + $headers)
            ->timeout(1.5)
            ->post('/graphql', [
                'query' => $query,
                'variables' => $variables,
            ])
            ->throw()
            ->json();

        if (! empty($response['errors'])) {
            throw new \RuntimeException(json_encode($response['errors'], JSON_UNESCAPED_UNICODE));
        }

        return $response['data'] ?? [];
    }
}
```

然后在 BFF service 里只关心组合结果：

```php
$query = <<<'GRAPHQL'
query OrderDetail($id: ID!) {
  order(id: $id) {
    id
    orderNo
    status
    canRefund
    price { amount currency }
    inventory { sellable available }
  }
}
GRAPHQL;

$data = app(SupergraphClient::class)->query($query, ['id' => $orderId]);
```

这样做的好处是：超时、日志、错误映射都收口在一层，而不是散在 Controller 里。

## 四、最大的坑：跨子图 N+1 比 REST 更隐蔽

我们第一次压测时，Router 看起来只收了一次查询，但库存服务的 SQL 却飙到了每请求 20 多条。原因是 `_entities` 查询把 20 个 sku 一条条打进库存子图，resolver 里又逐个查库。

修正方式不是“加机器”，而是**批量解析**。以库存子图为例：

```go
func (r *entityResolver) InventoryByRepresentations(ctx context.Context, reps []Representation) ([]*model.InventorySummary, error) {
    skuIDs := make([]int64, 0, len(reps))
    for _, rep := range reps {
        skuIDs = append(skuIDs, rep.SkuID)
    }

    rows, err := r.repo.BatchGetSellable(ctx, skuIDs)
    if err != nil {
        return nil, err
    }

    result := make([]*model.InventorySummary, 0, len(reps))
    for _, skuID := range skuIDs {
        row := rows[skuID]
        result = append(result, &model.InventorySummary{
            SkuID:     skuID,
            Sellable:  row.Available > 0,
            Available: row.Available,
        })
    }

    return result, nil
}
```

上线后，库存子图单次查询 SQL 从 **23 条降到 3 条**。Federation 不会自动帮你解决 N+1，只是把问题藏得更深。

## 五、Router 层缓存不要缓存“错人”的数据

另一个很痛的坑是缓存。我们曾经把整条 GraphQL response 按 query hash 缓存，结果会员价被游客命中，问题一出来就只能紧急回滚。后来改成两个原则：

1. **带用户态、币别、站点的查询绝不做整包共享缓存。**
2. **只缓存子图里真正公共的数据**，比如库存快照、基础价目，不缓存订单态结果。

Apollo Router 侧我会至少区分这些维度：

```yaml
headers:
  all:
    request:
      - propagate:
          named: "x-trace-id"
      - propagate:
          named: "x-user-id"
      - propagate:
          named: "x-locale"
```

如果必须做 response cache，key 里至少要带上 `x-user-id`、`x-locale`、`currency`。否则不是性能优化，是数据串号。

## 六、发布兼容性：先发子图，再发 Router

生产上最容易出事故的时刻不是高峰，而是 schema 发布。我们有次先升级 Router 的 supergraph schema，库存子图还没发，结果 `inventory.available` 字段在 query plan 里已经存在，但下游实例还没认得，直接报 500。

后来固定成这个顺序：

```text
1. 子图先发布兼容版本
2. Rover 校验 schema compose
3. Router 拉新 supergraph
4. 灰度流量 5%
5. 全量切换
```

并且坚持两条规则：

- 新字段只能追加，不能重定义语义。
- 删除字段先 deprecate，一个发布周期后再移除。

## 七、我最后保留的三条实战经验

### 1. Federation 适合“跨域聚合”，不适合把所有 REST 重写一遍
如果一个字段只在单服务内部消费，没必要硬塞进超图。超图的成本在于治理，而不是 schema 漂亮。

### 2. Router 不是业务层
鉴权校验、AB 实验、风控判定仍然放在 BFF。Router 负责编排，不负责做一堆 if/else。

### 3. 先看 query plan，再看代码
很多性能问题不是 resolver 本身慢，而是 query plan 把子图调用顺序拉长了。排障时我会先看 Router trace，再决定要不要改 schema 关系。

## 八、踩坑记录总结

- **坑 1：按页面拆子图**，导致 UI 一变 schema 跟着抖。
- **坑 2：header 没透传**，用户态、币别、trace 全丢。
- **坑 3：`_entities` 引发跨子图 N+1**，压测看总请求数没问题，SQL 却爆炸。
- **坑 4：缓存 key 维度不完整**，直接把会员价串给游客。
- **坑 5：先发 Router 再发子图**，组合成功不代表实例都兼容。

如果你的团队已经有多个领域服务、前端又经常抱怨“同一页面要拉很多接口”，那 Federation 值得做；但前提是你愿意一起补上 **schema 治理、发布顺序、trace、批量查询** 这些配套。否则它只会把原来的 REST 问题，换一种更难排查的方式再来一遍。
