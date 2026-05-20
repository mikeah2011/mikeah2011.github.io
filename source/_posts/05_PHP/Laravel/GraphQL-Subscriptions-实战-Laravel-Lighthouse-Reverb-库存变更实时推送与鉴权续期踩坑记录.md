---
title: GraphQL Subscriptions 实战：Laravel Lighthouse + Reverb 打通库存变更实时推送与鉴权续期踩坑记录
date: 2026-05-03 09:26:32
categories:
  - 05_PHP
  - Laravel
tags: [Laravel, WebSocket]description: 结合 Laravel BFF 的库存查询场景，记录一套用 Lighthouse + Reverb 落地 GraphQL Subscriptions 的生产实践，重点覆盖事件发布、频道鉴权、多标签页连接控制、JWT 续期与真实踩坑记录。
---

做 GraphQL 时，很多团队把查询层做得很漂亮，但一到“库存变更、订单状态变化、价格波动”这类实时场景，就又退回轮询。原因很现实：**Query/Mutation 好上手，Subscriptions 真正难的是连接生命周期、鉴权、事件风暴和多实例部署**。我这次在 Laravel BFF 里把商品库存提醒从 5 秒轮询改成 GraphQL Subscriptions，接口层统一成 GraphQL 之后，前端少写了一套 SSE/WebSocket 协议适配，后端也终于把“查库存”和“推库存变化”放进同一套 schema 管理。

先说结论：如果你的实时消息只是后台广播，直接上 Reverb 足够；但如果你已经有 Lighthouse、前端又依赖 GraphQL schema 做类型生成，那么 **Subscriptions 的价值不是更快，而是协议统一**。

## 一、落地后的结构

```text
Browser / App
   │
   ├── HTTP: Query / Mutation
   └── WS: GraphQL Subscription
           │
           ▼
Laravel BFF
   ├── Lighthouse Schema
   ├── Subscription Resolver
   ├── Reverb Channel Auth
   └── InventoryChanged Event
           │
           ▼
   Redis Pub/Sub / Queue
           │
           ▼
Inventory Service / Admin Backoffice
```

这里我刻意把“谁产生库存变化”和“谁消费推送”拆开：后台改库存、订单扣库存、支付超时回补库存，都只负责发领域事件；真正面向前端的推送模型，由 BFF 统一整理后广播。这样不会把下游服务的字段震荡直接暴露给前端。

## 二、Schema 先别写花，先把订阅粒度收紧

一开始我做过 `inventoryChanged(productIds: [ID!]!)`，结果前端一个页面订 20 个商品，后端就很难做频道隔离和权限判定。后来改成“一个商品一个频道”，简单很多：

```graphql
type InventoryPayload {
  productId: ID!
  sellable: Int!
  reserved: Int!
  version: Int!
  changedAt: DateTime!
}

type Subscription {
  inventoryChanged(productId: ID!): InventoryPayload
    @subscribe(resolver: "App\\GraphQL\\Subscriptions\\InventorySubscription@resolve")
}
```

这个设计的好处有两个：

1. 频道名天然稳定：`private-inventory.{productId}`。
2. 权限判断可以按商品或商家维度做，不会出现一个订阅混进一批无权限商品。

## 三、Laravel 里的关键代码

先定义广播事件，注意 `broadcastOn()` 和 payload 要完全可控，不要把 Eloquent Model 整个丢出去：

```php
<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

final class InventoryChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly int $productId,
        public readonly int $sellable,
        public readonly int $reserved,
        public readonly int $version,
        public readonly string $changedAt,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("inventory.{$this->productId}")];
    }

    public function broadcastAs(): string
    {
        return 'inventory.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'productId' => $this->productId,
            'sellable' => $this->sellable,
            'reserved' => $this->reserved,
            'version' => $this->version,
            'changedAt' => $this->changedAt,
        ];
    }
}
```

再把 Lighthouse 订阅解析器收口到一个类里：

```php
<?php

namespace App\GraphQL\Subscriptions;

use Nuwave\Lighthouse\Subscriptions\Subscriber;

final class InventorySubscription
{
    public function resolve(mixed $root, array $args, GraphQLContext $context, mixed $resolveInfo): Subscriber
    {
        return Subscriber::named("inventory.{$args['productId']}");
    }
}
```

频道鉴权一定要单独写，别偷懒直接 `return auth()->check();`：

```php
<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('inventory.{productId}', function ($user, int $productId) {
    return $user->can('viewInventory', $productId);
});
```

前端我用 Apollo Client，WebSocket 连接里把 access token 动态带上，否则 token 刷新后老连接会一直拿旧凭证：

```ts
import { createClient } from 'graphql-ws'

export const wsClient = createClient({
  url: 'wss://bff.example.com/graphql/subscriptions',
  connectionParams: async () => ({
    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    'x-request-id': crypto.randomUUID(),
  }),
})
```

## 四、生产里真正有用的三个控制点

### 1. 版本号去重
库存系统常见“先减后补”，消息可能乱序到前端。我的做法很直接：payload 带 `version`，前端只接受更大的版本，避免旧消息覆盖新状态。

### 2. 广播与事务解耦
库存扣减在事务里更新，但广播绝不能早于提交。我最后统一改成事务提交后 dispatch 事件，不然前端已经收到“库存不足”，数据库却因为回滚没落盘，排查特别恶心。

### 3. 多标签页复用连接
一位运营同时开 8 个后台页签时，浏览器会建立 8 条 WS。后来我在前端用 `BroadcastChannel` 共享主连接，其他标签页只订阅本地分发，Reverb 连接数直接降了一截。

## 五、踩坑记录

### 坑一：订阅成功，但始终收不到消息
问题不在 Lighthouse，而是 `broadcastAs()` 写了 `inventory.updated`，前端监听的却是 schema 里的 `inventoryChanged`。**GraphQL 字段名、广播事件名、频道名是三套概念**，混一个就全断。

### 坑二：JWT 已刷新，WS 连接还拿旧 token
HTTP 请求会自动带新 token，但旧的 WebSocket 不会自动重连。我的做法是在 refresh token 成功后主动关闭 `graphql-ws` 连接并重建，不要指望服务端热更新 metadata。

### 坑三：多实例下本机能推，线上偶发失踪
根因是只有 HTTP 层走了负载均衡，广播节点之间没共享消息。补上 Redis 作为广播中枢后，A 机收到库存变更，B 机上的订阅连接才能同步收到事件。

### 坑四：高峰期消息太密，前端卡顿
最开始后台每次库存字段变化都推一次，秒杀时一个商品几百条更新，React 列表疯狂重渲染。后来把 300ms 内的变更在 BFF 侧做合并，只推最终 sellable 值，用户体验比“绝对实时”更重要。

## 六、我最后的判断

GraphQL Subscriptions 不适合所有场景。像支付结果、物流轨迹这类“分钟级变化”，轮询更便宜；但商品库存、客服会话、后台运营看板这种已经深度 GraphQL 化的系统，用 Lighthouse + Reverb 统一查询和推送协议，维护成本会明显下降。

如果只记一个经验，就是这句：**Subscriptions 的核心不是把消息发出去，而是保证消息只发给该收到的人、按正确顺序到达，并且在 token 过期和实例扩容后仍然稳定。** 这部分处理好了，GraphQL 实时层才算真的可用。