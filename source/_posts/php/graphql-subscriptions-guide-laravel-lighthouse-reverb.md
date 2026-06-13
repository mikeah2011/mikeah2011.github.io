---

title: GraphQL Subscriptions 实战：Laravel Lighthouse + Reverb 打通库存变更实时推送与鉴权续期踩坑记录
keywords: [GraphQL Subscriptions, Laravel Lighthouse, Reverb, 打通库存变更实时推送与鉴权续期踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 09:26:32
categories:
- php
tags:
- Laravel
- WebSocket
- GraphQL
- subscriptions
- 实时推送
- Lighthouse
- Reverb
description: 在 Laravel BFF 中使用 Lighthouse GraphQL + Reverb WebSocket 落地 Subscriptions 实时库存推送，覆盖 Schema 设计、频道鉴权、JWT 续期、多标签页连接控制、事件风暴防护与内存泄漏踩坑，并提供 GraphQL Subscriptions vs SSE vs 轮询的完整对比。
---



做 GraphQL 时，很多团队把查询层做得很漂亮，但一到"库存变更、订单状态变化、价格波动"这类实时场景，就又退回轮询。原因很现实：**Query/Mutation 好上手，Subscriptions 真正难的是连接生命周期、鉴权、事件风暴和多实例部署**。我这次在 Laravel BFF 里把商品库存提醒从 5 秒轮询改成 GraphQL Subscriptions，接口层统一成 GraphQL 之后，前端少写了一套 SSE/WebSocket 协议适配，后端也终于把"查库存"和"推库存变化"放进同一套 schema 管理。

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

这里我刻意把"谁产生库存变化"和"谁消费推送"拆开：后台改库存、订单扣库存、支付超时回补库存，都只负责发领域事件；真正面向前端的推送模型，由 BFF 统一整理后广播。这样不会把下游服务的字段震荡直接暴露给前端。

## 二、Schema 先别写花，先把订阅粒度收紧

一开始我做过 `inventoryChanged(productIds: [ID!]!)`，结果前端一个页面订 20 个商品，后端就很难做频道隔离和权限判定。后来改成"一个商品一个频道"，简单很多：

```graphql
# 定义推送负载
type InventoryPayload {
  productId: ID!
  sku: String!
  warehouse: String!
  sellable: Int!
  reserved: Int!
  version: Int!
  changedAt: DateTime!
  reason: String
}

# 订阅根类型
type Subscription {
  "订阅单个商品的库存变更，自动映射到 private-inventory.{productId} 频道"
  inventoryChanged(productId: ID!): InventoryPayload
    @subscribe(resolver: "App\\GraphQL\\Subscriptions\\InventorySubscription@resolve")
}

# 可选：批量订阅（事件聚合后再推送）
type InventoryBatchPayload {
  shopId: ID!
  changes: [InventoryPayload!]!
  aggregatedAt: DateTime!
}

type Subscription {
  "订阅整个店铺的库存变更，适合后台运营看板"
  shopInventoryChanged(shopId: ID!): InventoryBatchPayload
    @subscribe(resolver: "App\\GraphQL\\Subscriptions\\ShopInventorySubscription@resolve")
}
```

这个设计的好处有两个：

1. 频道名天然稳定：`private-inventory.{productId}`。
2. 权限判断可以按商品或商家维度做，不会出现一个订阅混进一批无权限商品。

### Lighthouse 配置要点

在 `config/lighthouse.php` 中确保订阅相关配置正确：

```php
// config/lighthouse.php
'subscriptions' => [
    // 使用 Redis 作为订阅存储，在多实例部署时必须启用
    'storage' => \Nuwave\Lighthouse\Subscriptions\Storage\RedisStorageManager::class,

    // 广播驱动，配合 Laravel Broadcasting 使用
    'broadcaster' => \Nuwave\Lighthouse\Subscriptions\Broadcasters\LighthouseBroadcaster::class,

    // 订阅排队，避免阻塞主进程
    'queue' => [
        'enable' => true,
        'queue_name' => 'lighthouse-subscriptions',
        'connection' => 'redis',
    ],
],
```

同时在 `config/broadcasting.php` 中注册 Reverb 驱动：

```php
// config/broadcasting.php
'reverb' => [
    'driver' => 'reverb',
    'app_id' => env('REVERB_APP_ID'),
    'app_key' => env('REVERB_APP_KEY'),
    'app_secret' => env('REVERB_APP_SECRET'),
    'options' => [
        'host' => env('REVERB_HOST'),
        'port' => env('REVERB_PORT', 443),
        'scheme' => env('REVERB_SCHEME', 'https'),
        'useTLS' => env('REVERB_SCHEME', 'https') === 'https',
    ],
],
```

## 三、Reverb WebSocket 服务器配置

Reverb 是 Laravel 官方推出的 WebSocket 服务器，替代 Pusher 方案。部署时需要注意以下配置：

### 安装与基础配置

```bash
php artisan install:broadcasting
# 选择 Reverb 作为广播驱动

# 安装 Reverb
composer require laravel/reverb
php artisan reverb:install
```

### 环境变量配置

```env
# .env
BROADCAST_CONNECTION=reverb

REVERB_APP_ID=inventory-app
REVERB_APP_KEY=your-app-key
REVERB_APP_SECRET=your-app-secret
REVERB_HOST=reverb.example.com
REVERB_PORT=443
REVERB_SCHEME=https

# Reverb 服务器配置
REVERB_SERVER_HOST=0.0.0.0
REVERB_SERVER_PORT=8080

# 队列配置（必须，否则广播会阻塞 HTTP 请求）
QUEUE_CONNECTION=redis
```

### Reverb 服务器配置文件

```php
// config/reverb.php
return [
    'default' => env('REVERB_SERVER', 'reverb'),

    'servers' => [
        'reverb' => [
            'host' => env('REVERB_SERVER_HOST', '0.0.0.0'),
            'port' => env('REVERB_SERVER_PORT', 8080),
            'hostname' => env('REVERB_HOST'),
            'options' => [
                'tls' => [
                    'local_cert' => env('REVERB_TLS_CERT'),
                    'local_pk' => env('REVERB_TLS_KEY'),
                ],
            ],
            'max_request_size' => env('REVERB_MAX_REQUEST_SIZE', 10_000),
            'scaling' => [
                'enabled' => env('REVERB_SCALING_ENABLED', false),
                'channel' => env('REVERB_SCALING_CHANNEL', 'reverb'),
            ],
            'pulse_ingest_interval' => env('REVERB_PULSE_INGEST_INTERVAL', 15),
        ],
    ],

    'apps' => [
        [
            'id' => env('REVERB_APP_ID'),
            'key' => env('REVERB_APP_KEY'),
            'secret' => env('REVERB_APP_SECRET'),
            'allowed_origins' => ['*'], // 生产环境必须限制域名
            'ping_interval' => env('REVERB_PING_INTERVAL', 60),
            'max_message_size' => env('REVERB_MAX_MESSAGE_SIZE', 10_000),
            'max_connections' => env('REVERB_MAX_CONNECTIONS', 1000),
        ],
    ],
];
```

### Supervisor 进程管理

在生产环境中 Reverb 必须作为守护进程运行：

```ini
[program:reverb]
command=php /var/www/app/artisan reverb:start
autostart=true
autorestart=true
user=www-data
redirect_stderr=true
stdout_logfile=/var/log/reverb.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
```

### Nginx 反向代理配置

```nginx
server {
    listen 443 ssl http2;
    server_name reverb.example.com;

    ssl_certificate /etc/ssl/certs/reverb.crt;
    ssl_certificate_key /etc/ssl/private/reverb.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 超时配置
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

## 四、频道鉴权的完整实现

频道鉴权一定要单独写，别偷懒直接 `return auth()->check();`。实际项目中需要做到以下几点：

### 完整的鉴权代码

```php
<?php

// routes/channels.php

use Illuminate\Support\Facades\Broadcast;

// 库存频道鉴权：需要检查用户对该商品的查看权限
Broadcast::channel('inventory.{productId}', function ($user, int $productId) {
    // 1. 基础登录检查
    if (!$user) {
        return false;
    }

    // 2. 商品存在性检查
    $product = \App\Models\Product::find($productId);
    if (!$product) {
        return false;
    }

    // 3. 业务权限检查：商家只能看自己的商品库存
    if ($user->isMerchant() && $product->shop_id !== $user->shop_id) {
        return false;
    }

    // 4. 授权检查
    if (!$user->can('viewInventory', $product)) {
        return false;
    }

    // 返回给客户端的数据（可选，前端可用 Presence Channel 感知）
    return [
        'user_id' => $user->id,
        'permissions' => ['view', 'notify'],
    ];
});

// 店铺库存频道鉴权（用于运营看板）
Broadcast::channel('shop-inventory.{shopId}', function ($user, int $shopId) {
    if (!$user || !$user->isMerchant()) {
        return false;
    }

    // 商家只能订阅自己的店铺
    if ($user->shop_id !== $shopId) {
        return false;
    }

    return [
        'user_id' => $user->id,
        'role' => $user->role,
    ];
});

// 管理员频道：跨店铺监控
Broadcast::channel('admin-inventory', function ($user) {
    if (!$user || !$user->isAdmin()) {
        return false;
    }

    return [
        'user_id' => $user->id,
        'admin_level' => $user->admin_level,
    ];
});
```

### 前端 WebSocket 连接与鉴权

前端我用 Apollo Client，WebSocket 连接里把 access token 动态带上，否则 token 刷新后老连接会一直拿旧凭证：

```ts
import { createClient } from 'graphql-ws'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { ApolloClient, InMemoryCache } from '@apollo/client'

// 动态获取 token 的连接工厂
export const wsClient = createClient({
  url: 'wss://reverb.example.com/graphql/subscriptions',
  retryAttempts: Infinity, // 无限重试
  shouldRetry: () => true,
  retryWait: async (retries) => {
    // 指数退避，最大 10 秒
    const delay = Math.min(1000 * 2 ** retries, 10_000)
    await new Promise((resolve) => setTimeout(resolve, delay))
  },
  connectionParams: async () => ({
    // 每次重连时重新获取 token
    Authorization: `Bearer ${await getValidAccessToken()}`,
    'x-request-id': crypto.randomUUID(),
  }),
  on: {
    connecting: () => console.log('[WS] 正在连接...'),
    connected: () => console.log('[WS] 已连接'),
    closed: () => console.log('[WS] 连接关闭'),
    error: (err) => console.error('[WS] 连接错误:', err),
  },
})

// 创建 Apollo Client
const wsLink = new GraphQLWsLink(wsClient)

export const apolloClient = new ApolloClient({
  link: wsLink,
  cache: new InMemoryCache(),
})

// Token 刷新后主动重建连接
async function getValidAccessToken(): Promise<string> {
  const token = localStorage.getItem('access_token')
  const expiresAt = Number(localStorage.getItem('token_expires_at') || 0)

  // Token 即将过期（提前 60 秒刷新）
  if (Date.now() > expiresAt - 60_000) {
    const newToken = await refreshToken()
    // 刷新后断开旧连接，下次连接会使用新 token
    wsClient.terminate()
    return newToken
  }

  return token
}
```

### Redis 广播驱动配置

在多实例部署时，必须使用 Redis 作为广播中枢，否则实例 A 的事件无法推送到实例 B 的订阅连接：

```php
// config/broadcasting.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    // 使用专用的 Redis 频道前缀
    'options' => [
        'prefix' => 'broadcast:',
    ],
],
```

## 五、Laravel 里的关键代码

### 广播事件定义

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
        public readonly string $sku,
        public readonly string $warehouse,
        public readonly int $sellable,
        public readonly int $reserved,
        public readonly int $version,
        public readonly string $changedAt,
        public readonly ?string $reason = null,
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
            'sku' => $this->sku,
            'warehouse' => $this->warehouse,
            'sellable' => $this->sellable,
            'reserved' => $this->reserved,
            'version' => $this->version,
            'changedAt' => $this->changedAt,
            'reason' => $this->reason,
        ];
    }
}
```

### 订阅解析器

把 Lighthouse 订阅解析器收口到一个类里：

```php
<?php

namespace App\GraphQL\Subscriptions;

use Nuwave\Lighthouse\Subscriptions\Subscriber;
use Nuwave\Lighthouse\Schema\Types\GraphQLContext;

final class InventorySubscription
{
    /**
     * 解析订阅参数，生成频道标识
     */
    public function resolve(mixed $root, array $args, GraphQLContext $context, mixed $resolveInfo): Subscriber
    {
        return Subscriber::named("inventory.{$args['productId']}")
            ->with(['productId' => $args['productId']]);
    }
}
```

### 事件发布器（与事务解耦）

```php
<?php

namespace App\Services\Inventory;

use App\Events\InventoryChanged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

final class InventoryService
{
    /**
     * 扣减库存（带乐观锁和事务保护）
     */
    public function deduct(int $productId, int $quantity, string $orderId): bool
    {
        return DB::transaction(function () use ($productId, $quantity, $orderId) {
            $product = \App\Models\Product::lockForUpdate()->find($productId);

            if (!$product || $product->sellable < $quantity) {
                return false;
            }

            $oldVersion = $product->version;

            // 乐观锁更新
            $updated = $product->newQuery()
                ->where('id', $productId)
                ->where('version', $oldVersion)
                ->update([
                    'sellable' => DB::raw("sellable - {$quantity}"),
                    'reserved' => DB::raw("reserved + {$quantity}"),
                    'version' => DB::raw('version + 1'),
                    'updated_at' => now(),
                ]);

            if (!$updated) {
                Log::warning('库存扣减乐观锁冲突', [
                    'product_id' => $productId,
                    'expected_version' => $oldVersion,
                ]);
                return false;
            }

            // 事务提交后广播，绝对不能在事务内广播！
            // 否则前端可能收到推送但数据库已经回滚
            return true;
        });
    }

    /**
     * 在队列任务中发布广播事件
     * 由 model.updated 事件触发，确保事务已提交
     */
    public function broadcastChange(int $productId): void
    {
        $product = \App\Models\Product::find($productId);
        if (!$product) return;

        InventoryChanged::dispatch(
            productId: $product->id,
            sku: $product->sku,
            warehouse: $product->warehouse,
            sellable: $product->sellable,
            reserved: $product->reserved,
            version: $product->version,
            changedAt: now()->toIso8601String(),
            reason: 'stock_deduction',
        );
    }
}
```

## 六、多标签页连接控制方案

一位运营同时开 8 个后台页签时，浏览器会建立 8 条 WS。这不仅浪费服务器连接数，在内存紧张的 Reverb 实例上可能直接打满连接上限。

### BroadcastChannel 方案

在前端用 `BroadcastChannel` 共享主连接，其他标签页只订阅本地分发：

```ts
// shared-ws-manager.ts

const CHANNEL_NAME = 'graphql-ws-shared'
const LEADER_KEY = 'ws-leader-tab-id'
const HEARTBEAT_INTERVAL = 5000

class SharedWebSocketManager {
  private tabId: string
  private isLeader: boolean = false
  private broadcastChannel: BroadcastChannel
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private unsubscribe: (() => void) | null = null

  constructor() {
    this.tabId = crypto.randomUUID()
    this.broadcastChannel = new BroadcastChannel(CHANNEL_NAME)
    this.setupMessageRelay()
    this.electLeader()
  }

  private setupMessageRelay() {
    // 非 leader 标签页监听 leader 转发的消息
    this.broadcastChannel.onmessage = (event) => {
      const { type, payload } = event.data

      if (type === 'subscription-data') {
        // 转发到本地 Apollo Client
        this.notifyLocalSubscribers(payload)
      }

      if (type === 'leader-heartbeat') {
        // Leader 存活，重置超时
        this.resetLeaderTimeout()
      }

      if (type === 'leader-election') {
        // 有新 leader 产生
        this.isLeader = false
      }
    }

    // 标签页关闭时清理
    window.addEventListener('beforeunload', () => {
      if (this.isLeader) {
        localStorage.removeItem(LEADER_KEY)
      }
    })
  }

  private electLeader() {
    const currentLeader = localStorage.getItem(LEADER_KEY)

    if (!currentLeader) {
      // 没有 leader，自己成为 leader
      localStorage.setItem(LEADER_KEY, this.tabId)
      this.isLeader = true
      this.startHeartbeat()
      this.connectRealWebSocket()
    } else {
      // 已有 leader，等待心跳超时
      this.isLeader = false
      this.waitForLeaderTimeout()
    }
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      localStorage.setItem(LEADER_KEY, this.tabId)
      this.broadcastChannel.postMessage({ type: 'leader-heartbeat' })
    }, HEARTBEAT_INTERVAL)
  }

  private waitForLeaderTimeout() {
    // 等待 leader 心跳超时后重新选举
    setTimeout(() => {
      const currentLeader = localStorage.getItem(LEADER_KEY)
      if (!currentLeader || currentLeader === this.tabId) {
        this.isLeader = true
        localStorage.setItem(LEADER_KEY, this.tabId)
        this.startHeartbeat()
        this.connectRealWebSocket()
      }
    }, HEARTBEAT_INTERVAL * 2)
  }

  private connectRealWebSocket() {
    // 只有 leader 标签页才建立真实 WS 连接
    // ... 连接 graphql-ws client
  }

  private notifyLocalSubscribers(payload: any) {
    // 通知本标签页的 Apollo 订阅
  }
}

// 单例导出
export const wsManager = new SharedWebSocketManager()
```

### 服务端连接数限制

在 Reverb 配置中设置最大连接数，防止单用户爆破连接：

```php
// 在 Reverb App 配置中
'max_connections' => 1000, // 单 App 最大连接数

// 在 Nginx 层做更细粒度的限流
// 限制单 IP 最大并发 WebSocket 连接数
limit_conn_zone $binary_remote_addr zone=ws_conn:10m;

server {
    location / {
        limit_conn ws_conn 10; # 单 IP 最多 10 个 WS 连接
    }
}
```

## 七、JWT 续期与 Subscription 生命周期管理

WebSocket 是长连接，JWT 过期后 HTTP 请求可以自动刷新，但 WS 不会。这导致一个尴尬局面：用户登录后订阅了库存变化，半小时后 JWT 过期，WS 连接可能断开或者鉴权失败。

### 前端 Token 续期方案

```ts
class TokenManager {
  private refreshPromise: Promise<string> | null = null

  async getValidToken(): Promise<string> {
    const token = localStorage.getItem('access_token')
    const expiresAt = Number(localStorage.getItem('token_expires_at') || 0)

    // Token 有效，直接返回
    if (Date.now() < expiresAt - 120_000) {
      return token
    }

    // 防止并发刷新
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh()
    }

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async doRefresh(): Promise<string> {
    const refresh = localStorage.getItem('refresh_token')
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${refresh}`,
      },
    })

    if (!res.ok) {
      // Refresh token 也过期了，跳转登录
      window.location.href = '/login'
      throw new Error('Refresh token expired')
    }

    const data = await res.json()
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    localStorage.setItem('token_expires_at', String(Date.now() + data.expires_in * 1000))

    // 主动断开旧 WS，让 graphql-ws 自动重连并携带新 token
    wsClient.terminate()

    return data.access_token
  }
}

export const tokenManager = new TokenManager()
```

### 后端 Token 校验中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Tymon\JWTAuth\Facades\JWTAuth;
use Tymon\JWTAuth\Exceptions\TokenExpiredException;
use Tymon\JWTAuth\Exceptions\TokenInvalidException;

class WsTokenGuard
{
    /**
     * WebSocket 连接建立时的 Token 校验
     * 与 HTTP 中间件不同，WS 连接只在建立时校验一次
     * 后续消息推送通过频道鉴权控制
     */
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken()
            ?? $request->query('token');

        if (!$token) {
            return response()->json(['error' => 'Missing token'], 401);
        }

        try {
            $user = JWTAuth::setToken($token)->authenticate();
            $request->setUserResolver(fn () => $user);
        } catch (TokenExpiredException) {
            // WS 连接时 token 已过期，拒绝连接
            return response()->json(['error' => 'Token expired'], 401);
        } catch (TokenInvalidException) {
            return response()->json(['error' => 'Token invalid'], 401);
        }

        return $next($request);
    }
}
```

## 八、实时推送方案对比：GraphQL Subscriptions vs SSE vs 轮询

在选型时，我对比了三种方案，这里给出量化对比：

| 维度 | GraphQL Subscriptions | Server-Sent Events (SSE) | 短轮询 (Polling) |
|------|----------------------|--------------------------|-------------------|
| **协议** | WebSocket (graphql-ws) | HTTP/1.1 长连接 | HTTP 请求 |
| **方向** | 全双工 | 单向（服务端→客户端） | 客户端主动拉取 |
| **延迟** | < 50ms | 50-200ms | 取决于轮询间隔（通常 1-5s） |
| **连接数** | 每个订阅 1 条 WS | 每个订阅 1 条 HTTP 长连接 | 每次轮询新连接 |
| **协议统一** | ✅ 与 Query/Mutation 同一 Schema | ❌ 需要独立 API | ❌ 需要独立 API |
| **类型安全** | ✅ 自动生成 TS 类型 | ❌ 需手动定义 | ❌ 需手动定义 |
| **浏览器兼容性** | 需要 WS 支持（现代浏览器均支持） | ✅ 所有浏览器 | ✅ 所有浏览器 |
| **代理/防火墙** | 可能被拦截 | 几乎不会被拦截 | 不受影响 |
| **服务端复杂度** | 高（WS 服务器 + 频道管理 + 鉴权） | 中（HTTP 长连接管理） | 低 |
| **多实例部署** | 需要 Redis Pub/Sub | 需要消息队列 | 无特殊要求 |
| **带宽消耗** | 低（仅推送变更） | 低 | 高（重复请求） |
| **适用场景** | 已有 GraphQL 体系的实时推送 | 简单单向推送 | 低频更新、容错要求高 |
| **Laravel 生态** | Lighthouse + Reverb | `response()->stream()` | `Cache + 定时请求` |

### 选型建议详解

**选 GraphQL Subscriptions 的场景**：团队已经在使用 Lighthouse 做查询和变更，前端通过 GraphQL Schema 自动生成 TypeScript 类型定义，这种情况下使用 Subscriptions 是最自然的选择。整个实时推送能力与现有的查询、变更共享同一套类型系统，前端不需要额外维护一套独立的数据模型。特别适合已经在 BFF 层做了大量数据整合的项目，因为 Subscription 的 payload 类型可以复用 Query 返回的类型定义，只需要额外加几个字段。

**选 Server-Sent Events 的场景**：如果你的需求是纯粹的服务端向客户端单向推送，比如通知提醒、构建进度、文件上传进度这种场景，SSE 足够了。它基于标准 HTTP 协议，几乎不会被企业防火墙或反向代理拦截，浏览器兼容性极好。而且 SSE 天然支持自动重连，不需要像 WebSocket 那样自己实现重连逻辑。缺点是不支持客户端向服务端的双向通信，如果你需要在订阅过程中发送控制信号（比如暂停、切换频道），就需要额外的 HTTP 请求来配合。

**选短轮询的场景**：变更频率很低（比如每分钟才更新一次）、实时性要求不高的场景，轮询反而最简单可靠。轮询没有长连接的维护成本，不需要 WebSocket 服务器，不需要担心连接断开和重连，服务端可以复用现有的 HTTP 接口。缺点是如果用户量大且轮询间隔短，会产生大量无意义的请求。建议在轮询时配合 ETag 或 Last-Modified 头部做条件请求，避免重复传输相同数据。

**混合方案的实际案例**：在我们的实际项目中，最终采用了混合方案——核心库存页面用 GraphQL Subscriptions 获取实时更新，运营看板用 SSE 推送聚合后的统计指标，而一些低频变更（如仓库补货通知）仍然用 30 秒一次的轮询。三种方案共享同一个 Laravel 后端，通过不同的路由和中间件分别处理。这种混合方案虽然增加了少量维护成本，但每个场景都用了最适合的技术，整体效果比强行统一要好。

## 九、生产里真正有用的三个控制点

### 1. 版本号去重

库存系统常见"先减后补"，消息可能乱序到前端。我的做法很直接：payload 带 `version`，前端只接受更大的版本，避免旧消息覆盖新状态。

```ts
const { data } = useInventoryChangedSubscription({
  variables: { productId },
})

useEffect(() => {
  if (data && data.inventoryChanged.version > lastVersionRef.current) {
    lastVersionRef.current = data.inventoryChanged.version
    updateDisplay(data.inventoryChanged)
  }
}, [data])
```

### 2. 广播与事务解耦

库存扣减在事务里更新，但广播绝不能早于提交。我最后统一改成事务提交后 dispatch 事件，不然前端已经收到"库存不足"，数据库却因为回滚没落盘，排查特别恶心。

推荐的做法是使用 Model Observer 或者 `afterCommit` 机制：

```php
// 在 InventoryChanged 事件的构造函数中自动等待事务提交
use Illuminate\Database\Eloquent\Model;
use Illuminate\Events\Dispatchable;

class InventoryChanged implements ShouldBroadcastNow
{
    use Dispatchable;

    // 使用 Laravel 的 afterCommit 特性
    // 当在事务中 dispatch 时，等到事务提交后才真正广播
    public $afterCommit = true;

    // ... 其他代码
}
```

### 3. 多标签页复用连接

一位运营同时开 8 个后台页签时，浏览器会建立 8 条 WS。后来我在前端用 `BroadcastChannel` 共享主连接，其他标签页只订阅本地分发，Reverb 连接数直接降了一截。

## 十、踩坑记录

### 坑一：订阅成功，但始终收不到消息

问题不在 Lighthouse，而是 `broadcastAs()` 写了 `inventory.updated`，前端监听的却是 schema 里的 `inventoryChanged`。**GraphQL 字段名、广播事件名、频道名是三套概念**，混一个就全断。

**排查步骤**：
1. 确认频道名是否一致：`private-inventory.{productId}`
2. 确认事件名是否一致：`broadcastAs()` 返回值 vs 前端 schema 字段名
3. 确认鉴权是否通过：检查 `channels.php` 中的 callback 是否返回 truthy 值
4. 确认 Redis 驱动：多实例必须用 Redis，否则广播只在本地生效

### 坑二：JWT 已刷新，WS 连接还拿旧 token

HTTP 请求会自动带新 token，但旧的 WebSocket 不会自动重连。我的做法是在 refresh token 成功后主动关闭 `graphql-ws` 连接并重建，不要指望服务端热更新 metadata。

### 坑三：多实例下本机能推，线上偶发失踪

根因是只有 HTTP 层走了负载均衡，广播节点之间没共享消息。补上 Redis 作为广播中枢后，A 机收到库存变更，B 机上的订阅连接才能同步收到事件。

**解决方案**：
```bash
# 确保所有实例连接同一个 Redis
REDIS_HOST=shared-redis.internal
REDIS_PORT=6379

# 确保广播驱动为 redis
BROADCAST_CONNECTION=redis

# 使用专用的 Reverb 队列
php artisan reverb:start --queue=reverb-broadcast
```

### 坑四：高峰期消息太密，前端卡顿

最开始后台每次库存字段变化都推一次，秒杀时一个商品几百条更新，React 列表疯狂重渲染。后来把 300ms 内的变更在 BFF 侧做合并，只推最终 sellable 值，用户体验比"绝对实时"更重要。

**BFF 侧事件聚合方案**：

```php
<?php

namespace App\Listeners;

use App\Events\InventoryChanged;
use Illuminate\Support\Facades\Cache;

class AggregateInventoryChanges
{
    private const DEBOUNCE_MS = 300;

    public function handle(InventoryChanged $event): void
    {
        $key = "inventory_aggregate_{$event->productId}";

        // 存入缓冲区
        Cache::put($key, [
            'productId' => $event->productId,
            'sellable' => $event->sellable,
            'reserved' => $event->reserved,
            'version' => $event->version,
            'changedAt' => $event->changedAt,
        ], now()->addMilliseconds(self::DEBOUNCE_MS * 2));

        // 使用延迟任务做最终广播
        BroadcastInventoryAggregated::dispatch($event->productId)
            ->delay(now()->addMilliseconds(self::DEBOUNCE_MS));
    }
}
```

### 坑五：事件风暴导致 Redis 内存暴涨

大促时几万个商品同时变更，每条变更都往 Redis 写一条广播消息。如果订阅者连接慢或者断开，Redis 的输出缓冲区会持续增长，最终 OOM。

**解决方案**：
- 设置 Redis `client-output-buffer-limit` 限制每个订阅者的缓冲区大小
- 使用 `broadcastQueue` 将广播放入队列，配合消费者限流
- 对高频商品做采样：变更频率 > 50次/秒的商品，降级为 1 秒合并推送

```redis
# redis.conf
client-output-buffer-limit pubsub 32mb 8mb 60
```

### 坑六：连接数打满，新用户无法订阅

Reverb 默认最大连接数是 1000，但单台服务器理论可以支撑更多。实际瓶颈在于 PHP 的内存限制。

**优化方案**：

```env
# .env
# 调整 Reverb 连接上限
REVERB_MAX_CONNECTIONS=5000

# 增加 PHP 内存限制（Reverb 进程单独配置）
PHP_MEMORY_LIMIT=512M
```

```bash
# 监控 Reverb 连接数
php artisan reverb:connections

# 查看连接详情
php artisan reverb:connections --format=json | jq '.total'
```

## 十一、事件风暴防护的进阶方案

事件风暴是 GraphQL Subscriptions 最难处理的问题之一。不同于 HTTP 请求可以限流，WebSocket 推送一旦触发就无法撤回。

### 滑动窗口限流器

```php
<?php

namespace App\Services\Subscription;

use Illuminate\Support\Facades\Redis;

class SubscriptionRateLimiter
{
    /**
     * 滑动窗口限流：防止短时间内推送过多消息
     * 窗口大小 1 秒，最大推送 100 条
     */
    public function shouldThrottle(string $channel, int $maxPerSecond = 100): bool
    {
        $key = "sub_rate:{$channel}";
        $now = microtime(true);
        $windowStart = $now - 1;

        // 使用 Redis 有序集合实现滑动窗口
        Redis::zremrangebyscore($key, '-inf', $windowStart);
        $count = Redis::zcard($key);

        if ($count >= $maxPerSecond) {
            return true; // 限流
        }

        Redis::zadd($key, $now, uniqid());
        Redis::expire($key, 2);

        return false;
    }

    /**
     * 按频道做事件合并
     * 相同频道在窗口内的变更只保留最新一条
     */
    public function coalesce(string $channel, array $payload, int $windowMs = 300): void
    {
        $key = "sub_coalesce:{$channel}";

        // 用 hash 存储，相同 key 自动覆盖
        Redis::hset($key, 'payload', json_encode($payload));
        Redis::hset($key, 'last_update', now()->toIso8601String());
        Redis::expire($key, max(1, intdiv($windowMs, 1000) + 1));

        // 标记需要合并广播
        if (!Redis::exists("{$key}:pending")) {
            Redis::setex("{$key}:pending", 1, '1');
            BroadcastCoalescedPayload::dispatch($channel)
                ->delay(now()->addMilliseconds($windowMs));
        }
    }
}
```

## 十二、本地开发与测试策略

GraphQL Subscriptions 的开发和测试比普通的查询与变更有意思得多，因为你需要同时运行 WebSocket 服务器、处理异步事件发布、模拟网络延迟和连接断开。下面分享我在本地开发环境中的实践。

### 本地 Reverb 服务器启动

在开发环境中，Reverb 不需要 Nginx 反向代理，可以直接用 artisan 命令启动。但要注意，如果你的前端开发服务器运行在不同的端口（比如 Vite 的 5173），需要在 Reverb 配置的 `allowed_origins` 中添加 `http://localhost:5173`，否则浏览器的跨域策略会阻止 WebSocket 连接。开发时建议同时打开三个终端窗口分别运行 Laravel 开发服务器、Reverb WebSocket 服务器和队列消费者，这样可以清楚地看到每个组件的日志输出。

```bash
# 终端 1：启动 Laravel 开发服务器
php artisan serve

# 终端 2：启动 Reverb WebSocket 服务器（带调试输出）
php artisan reverb:start --debug

# 终端 3：启动队列消费者
php artisan queue:work --queue=lighthouse-subscriptions,default
```

### 使用 PHPUnit 测试 Subscription

测试 Subscription 的核心难点在于它是异步的——你发布一个事件，然后需要验证推送是否到达了正确的频道。Lighthouse 提供了测试辅助工具，但实际测试中还需要配合 Laravel 的事件假面来验证事件是否被正确广播。下面是一个完整的测试用例，覆盖了订阅建立、频道验证和版本去重三个核心逻辑。

```php
<?php

namespace Tests\Feature\GraphQL;

use App\Events\InventoryChanged;
use Illuminate\Support\Facades\Event;
use Nuwave\Lighthouse\Testing\MakesGraphQLRequests;
use Tests\TestCase;

class InventorySubscriptionTest extends TestCase
{
    use MakesGraphQLRequests;

    public function test_can_subscribe_to_inventory_changes(): void
    {
        $user = \App\Models\User::factory()->create();

        $response = $this->actingAs($user)->graphQL(/** @lang GraphQL */ '
            subscription {
                inventoryChanged(productId: "42") {
                    productId
                    sellable
                    version
                }
            }
        ');

        $response->assertStatus(200);
    }

    public function test_inventory_event_broadcasts_to_correct_channel(): void
    {
        Event::fake([InventoryChanged::class]);

        $service = app(\App\Services\Inventory\InventoryService::class);
        $service->broadcastChange(42);

        Event::assertDispatched(InventoryChanged::class, function ($event) {
            return $event->productId === 42
                && $event->broadcastOn()[0]->name === 'inventory.42';
        });
    }

    public function test_version_deduplication(): void
    {
        // 模拟乱序消息：先收到版本 3，再收到版本 2
        // 前端应该忽略版本 2 的消息
        $payload1 = ['version' => 3, 'sellable' => 100];
        $payload2 = ['version' => 2, 'sellable' => 50];

        // 在前端代码中测试这个逻辑
        // 这里演示后端确保版本号递增
        $this->assertTrue($payload1['version'] > $payload2['version']);
    }
}
```

### 压力测试建议

在上线之前，建议用 `graphql-ws` 的客户端库写一个简单的压力测试脚本，模拟多个客户端同时订阅和接收消息。重点观察两个指标：消息端到端延迟和服务器内存占用趋势。如果内存持续增长没有回落，说明存在连接泄漏或缓冲区未清理的问题。压力测试可以帮助你提前发现连接数上限、内存瓶颈和消息积压等生产问题，避免上线后才手忙脚乱地排查。建议在预发布环境做至少 30 分钟的持续压力测试，观察趋势曲线是否平稳。

## 十三、监控与可观测性

生产环境中运行 WebSocket 推送系统，必须建立完善的监控体系。没有监控的实时推送系统就像蒙着眼睛开车——出问题的时候你根本不知道。

### 关键指标监控

需要关注的核心指标包括：当前活跃连接数、消息推送延迟（从事件产生到客户端收到的时间差）、推送失败率、频道订阅数量分布、每秒消息吞吐量。这些指标可以通过 Reverb 内置的 Pulse 集成或者自定义的 Metrics 中间件来采集。

```php
<?php

namespace App\Providers;

use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Redis;

class ReverbMetricsProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 每 30 秒采集一次连接状态
        $this->app->terminating(function () {
            $connections = Redis::hgetall('reverb:connections');
            $total = count($connections);

            // 推送到 Prometheus / Grafana / DataDog
            app('metrics')->gauge('reverb.active_connections', $total);
        });
    }
}
```

### 告警策略

建议设置以下告警规则：活跃连接数超过服务器承载上限的百分之八十时触发预警；单个频道的订阅者数量异常激增时触发预警（可能意味着前端 Bug 导致重复订阅）；消息推送延迟超过 2 秒时触发告警；WebSocket 连接断开率突然升高时触发告警。这些告警可以帮助你在问题影响用户之前及时介入处理。

### 连接泄漏排查

连接泄漏是 WebSocket 服务器最常见的内存问题。前端页面关闭时如果没有正确断开 WebSocket 连接，服务端会一直维持这些"僵尸连接"，直到心跳超时才会清理。排查方法是定期检查连接列表，对比最后心跳时间与当前时间，清理超时连接。同时在前端确保页面 `beforeunload` 事件中调用 `wsClient.terminate()` 断开连接。

```php
<?php

// Artisan 命令：清理僵尸连接
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;

class CleanupStaleConnections extends Command
{
    protected $signature = 'reverb:cleanup-stale {--timeout=120}';
    protected $description = '清理超过指定秒数未发送心跳的僵尸连接';

    public function handle(): int
    {
        $timeout = (int) $this->option('timeout');
        $connections = Redis::hgetall('reverb:connections');
        $cleaned = 0;

        foreach ($connections as $connectionId => $lastSeen) {
            if (time() - (int) $lastSeen > $timeout) {
                Redis::hdel('reverb:connections', $connectionId);
                $cleaned++;
            }
        }

        $this->info("清理了 {$cleaned} 个僵尸连接，剩余 " . (count($connections) - $cleaned) . " 个活跃连接");
        return Command::SUCCESS;
    }
}
```

## 十四、常见问题速查

以下是我在团队内部整理的高频问题解答，供快速参考：

**问：Reverb 和 Pusher 应该选哪个？** 如果你的团队希望完全掌控 WebSocket 服务器、不想依赖第三方付费服务，选 Reverb。Reverb 是 Laravel 官方维护的开源方案，与 Laravel Echo、Broadcasting 组件深度集成。Pusher 的优势在于不需要自己运维 WebSocket 服务器，但有连接数和消息数的付费限制。对于中小团队来说，Reverb 在大多数场景下是更经济的选择。

**问：Subscription 支持批量订阅多个商品吗？** 技术上可以，但不推荐。一个订阅对应一个频道的做法更清晰，权限判断更简单，频道隔离也更彻底。如果你真的需要批量订阅，建议在前端管理多个独立的订阅连接，而不是在后端做一个支持多商品参数的订阅类型。这样每个订阅的权限和生命周期都可以独立控制。

**问：Reverb 能支撑多少并发连接？** 取决于服务器内存和 CPU。在 4GB 内存的单台服务器上，经过优化配置后通常可以稳定支撑 5000 到 8000 个并发 WebSocket 连接。如果需要更多连接，可以通过启动多个 Reverb 实例配合 Redis 集群来横向扩展。需要注意的是，PHP 的内存限制对 Reverb 进程影响较大，建议将运行 Reverb 的 PHP 内存限制设置为 512MB 以上。

**问：前端刷新页面后订阅会丢失吗？** 会。WebSocket 连接断开后所有订阅都会丢失，页面刷新时需要重新建立连接和订阅。这是正常的，不需要特别处理。但如果你希望在短时间内页面刷新后能快速恢复订阅，可以在前端把当前订阅的频道列表保存在 `sessionStorage` 中，页面加载后自动恢复之前的订阅。

## 十五、我最后的判断

GraphQL Subscriptions 不适合所有场景。像支付结果、物流轨迹这类"分钟级变化"，轮询更便宜；但商品库存、客服会话、后台运营看板这种已经深度 GraphQL 化的系统，用 Lighthouse + Reverb 统一查询和推送协议，维护成本会明显下降。

如果只记一个经验，就是这句：**Subscriptions 的核心不是把消息发出去，而是保证消息只发给该收到的人、按正确顺序到达，并且在 token 过期和实例扩容后仍然稳定。** 这部分处理好了，GraphQL 实时层才算真的可用。

---

## 相关阅读

- [SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案的工程选型——Laravel 中的三种推送架构深度对比](/00_架构/2026-06-03-SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型) — 从工程选型角度深入对比三种实时通信方案的优劣势与适用场景
- [WebSocket 实战：Laravel Reverb + Pusher 实时通信架构选型、事件广播与生产环境踩坑记录](/php/Laravel/websocket-guide-laravel-reverb-pusher-architecture) — 详解 Reverb 与 Pusher 的架构差异和迁移实践
- [Laravel Reverb 实战：订单状态实时推送与多实例部署踩坑记录](/php/Laravel/laravel-reverb-guide-deployment) — 从部署运维角度详解 Reverb 的 Nginx 配置、Supervisor 进程管理与 Redis 多实例同步
