
title: WebSocket-实战-Laravel-Reverb-Pusher-实时通信-架构选型事件广播与生产环境踩坑记录
keywords: [WebSocket, Laravel, Reverb]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-17 03:35:37
updated: 2026-05-17 03:37:35
categories:
  - php
tags:
- Laravel
- WebSocket
- Reverb
- pusher
- Redis
- Broadcasting
description: '全面解析 Laravel WebSocket 实时通信架构设计，深入对比 Pusher 与 Reverb 长连接方案选型。涵盖 Reverb 安装配置、Private/Presence Channel 权限控制、Echo 前端集成、Redis Pub/Sub 水平扩展，以及 Nginx 代理与心跳保活等 9 大生产踩坑记录，附完整代码示例与 Supervisor 部署配置。

  '
---


# WebSocket 实战：Laravel Reverb / Pusher 实时通信——架构选型、事件广播与生产环境踩坑记录

## 前言

在 B2C 电商场景中，实时通信是提升用户体验的核心能力：

- **订单状态变更**：支付成功、发货、签收的即时通知
- **客服聊天**：买家与客服的实时对话
- **库存变更**：商品库存不足时的实时提醒
- **运营看板**：实时销售数据大屏

传统轮询（Polling）方案在高并发下浪费大量资源，而 Server-Sent Events（SSE）是单向的。当需要**双向实时通信**时，WebSocket 是最佳选择。

本文基于 KKday B2C Backend Team 的真实项目经验，完整记录从 Pusher 云服务迁移到 Laravel Reverb（自托管 WebSocket 服务器）的全过程。

## 架构选型：Pusher vs Laravel Reverb vs Soketi

| 维度 | Pusher 云 | Laravel Reverb | Soketi | Socket.io |
|------|-----------|---------------|--------|-----------|
| **托管方式** | SaaS 云服务 | 自托管 (Self-hosted) | 自托管 (Self-hosted) | 自托管 (Self-hosted) |
| **协议** | Pusher 协议 | Pusher 兼容 | Pusher 兼容 | 自有协议 |
| **费用** | $49/月起（按连接数计费） | 免费 (开源) | 免费 (开源) | 免费 (开源) |
| **连接数限制** | 按套餐 | 无限制 | 无限制 | 无限制 |
| **Laravel 集成** | 原生支持 | 一等公民 (L11+) | 需手动配置 | 无官方支持 |
| **水平扩展** | 自动 | Redis Pub/Sub | Redis Pub/Sub | Redis Adapter |
| **运维成本** | 零 | 中等（需管理进程） | 中等 | 中高（需 Node.js） |
| **PHP 生态** | 原生 SDK | 原生集成 | 需配置 pusher-php-server | Node.js 专属 |
| **适用场景** | 小团队快速上线 | 中大规模自控 | 替代 Reverb 方案 | Node.js 全栈 |
| **GitHub Stars** | N/A (闭源) | 2k+ | 5k+ | 60k+ |
| **生产成熟度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ (Laravel 11+) | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

> **选型建议**：如果你的团队以 PHP/Laravel 为主且追求数据主权和成本控制，**Laravel Reverb** 是首选；如果需要最成熟的云服务且预算充足，**Pusher** 仍然稳健；**Soketi** 适合需要 Pusher 兼容但不想依赖 Reverb 的场景。

### 我们的选型决策

KKday 初期使用 **Pusher 云服务**（快速上线），后期迁移到 **Laravel Reverb**（成本控制 + 数据主权）。核心原因：

1. **连接数成本**：Pusher 按 concurrent connections 计费，促销高峰期连接数暴增
2. **数据主权**：实时消息经过第三方云，存在合规风险
3. **Laravel 11 原生支持**：Reverb 作为官方一等公民，API 完全兼容 Pusher 协议

## 整体架构

```
┌──────────┐     WebSocket      ┌──────────────────┐
│  前端     │ ◄──────────────► │  Laravel Reverb   │
│  Echo     │   (ws://连接)     │  (WebSocket Server)│
└──────────┘                    └────────┬─────────┘
     ▲                                   │ Redis Pub/Sub
     │                                   ▼
     │                          ┌──────────────────┐
     │  HTTP REST               │  Redis Server     │
     ▼                          └────────┬─────────┘
┌──────────┐    Event::dispatch()       │
│  Laravel  │ ──────────────────────────┘
│  API      │
│  (PHP-FPM)│
└──────────┘
```

工作流程：

1. **前端**通过 Laravel Echo 建立 WebSocket 连接到 Reverb 服务器
2. **后端 API** 通过 `Event::dispatch()` 触发广播事件
3. **Laravel Broadcasting** 将事件推送到 Redis
4. **Reverb 服务器**订阅 Redis，将消息推送给对应的 WebSocket 客户端

## 第一部分：Laravel Reverb 安装与配置

### 1.1 安装 Reverb

```bash
# Laravel 11+ 项目
php artisan install:broadcasting

# 选择 Reverb 作为驱动
# 这会自动安装 laravel/reverb 并发布配置
```

安装后会生成两个关键配置文件：

```
config/reverb.php      # Reverb 服务器配置
config/broadcasting.php # 广播驱动配置
```

### 1.2 Reverb 服务器配置

```php
// config/reverb.php
return [
    'default' => env('REVERB_SERVER', 'reverb'),

    'servers' => [
        'reverb' => [
            'host' => env('REVERB_HOST', '0.0.0.0'),
            'port' => env('REVERB_PORT', 8080),
            'hostname' => env('REVERB_HOSTNAME'),
            'options' => [
                'tls' => [], // 生产环境 TLS 配置
            ],
            'max_request_size' => env('REVERB_MAX_REQUEST_SIZE', 10_000),
            'scaling' => [
                'enabled' => env('REVERB_SCALING_ENABLED', false),
                'channel' => env('REVERB_SCALING_CHANNEL', 'reverb'),
                'server' => [
                    'url' => env('REDIS_URL', 'tcp://127.0.0.1:6379'),
                ],
            ],
        ],
    ],

    'apps' => [
        [
            'id' => env('REVERB_APP_ID'),
            'key' => env('REVERB_APP_KEY'),
            'secret' => env('REVERB_APP_SECRET'),
            'path' => env('REVERB_APP_PATH', 'app'),
            'capacity' => env('REVERB_APP_CAPACITY', null),
            'allowed_origins' => env('REVERB_ALLOWED_ORIGINS', '*'),
        ],
    ],
];
```

### 1.3 环境变量配置

```bash
# .env
BROADCAST_CONNECTION=reverb

REVERB_APP_ID=your-app-id
REVERB_APP_KEY=your-app-key
REVERB_APP_SECRET=your-app-secret
REVERB_HOST=0.0.0.0
REVERB_PORT=8080
REVERB_SCALING_ENABLED=true  # 多实例部署时必须开启

# 前端连接使用
VITE_REVERB_APP_KEY="${REVERB_APP_KEY}"
VITE_REVERB_HOST="${REVERB_HOST}"
VITE_REVERB_PORT="${REVERB_PORT}"
VITE_REVERB_SCHEME="${REVERB_SCHEME}"
```

### 1.4 启动 Reverb 服务器

```bash
# 开发环境
php artisan reverb:start --debug

# 生产环境（配合 Supervisor）
php artisan reverb:start --host=0.0.0.0 --port=8080
```

## 第二部分：广播事件实战

### 2.1 定义广播事件——订单状态变更

```bash
php artisan make:event OrderStatusChanged
```

```php
// app/Events/OrderStatusChanged.php
<?php

namespace App\Events;

use App\Models\Order;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderStatusChanged implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Order $order,
        public string $oldStatus,
        public string $newStatus,
    ) {}

    /**
     * 广播事件名称——前端 Echo 监听此名称
     */
    public function broadcastAs(): string
    {
        return 'order.status.changed';
    }

    /**
     * 广播数据——只暴露必要字段，防止敏感信息泄露
     */
    public function broadcastWith(): array
    {
        return [
            'order_id'     => $this->order->id,
            'order_no'     => $this->order->order_no,
            'old_status'   => $this->oldStatus,
            'new_status'   => $this->newStatus,
            'status_label' => $this->order->status_label,
            'updated_at'   => $this->order->updated_at->toIso8601String(),
        ];
    }

    /**
     * 广播频道——Private Channel 确保只有订单所属用户能收到
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('orders.' . $this->order->user_id),
        ];
    }
}
```

### 2.2 触发广播

```php
// app/Services/OrderService.php
<?php

namespace App\Services;

use App\Events\OrderStatusChanged;
use App\Models\Order;

class OrderService
{
    public function updateStatus(Order $order, string $newStatus): Order
    {
        $oldStatus = $order->status;

        // 业务校验：状态机流转合法性
        $this->assertValidTransition($oldStatus, $newStatus);

        $order->update(['status' => $newStatus]);

        // 触发广播——异步推送到 WebSocket 客户端
        OrderStatusChanged::dispatch($order, $oldStatus, $newStatus);

        return $order;
    }

    private function assertValidTransition(string $from, string $to): void
    {
        $allowed = [
            'pending'  => ['paid', 'cancelled'],
            'paid'     => ['processing', 'refunded'],
            'processing' => ['shipped', 'cancelled'],
            'shipped'  => ['delivered'],
            'delivered' => ['completed', 'returned'],
        ];

        if (!in_array($to, $allowed[$from] ?? [])) {
            throw new \DomainException(
                "非法状态流转: {$from} → {$to}"
            );
        }
    }
}
```

### 2.3 Presence Channel——客服聊天室

Presence Channel 不仅广播消息，还能告知"谁在线"：

```php
// app/Events/ChatMessageSent.php
<?php

namespace App\Events;

use App\Models\ChatMessage;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Queue\SerializesModels;

class ChatMessageSent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public ChatMessage $message,
    ) {}

    public function broadcastAs(): string
    {
        return 'chat.message.sent';
    }

    public function broadcastWith(): array
    {
        return [
            'id'         => $this->message->id,
            'room_id'    => $this->message->room_id,
            'user_id'    => $this->message->user_id,
            'user_name'  => $this->message->user->name,
            'content'    => $this->message->content,
            'type'       => $this->message->type, // text/image/file
            'created_at' => $this->message->created_at->toIso8601String(),
        ];
    }

    public function broadcastOn(): array
    {
        return [
            new PresenceChannel('chat.room.' . $this->message->room_id),
        ];
    }
}
```

### 2.4 Channel 授权

```php
// routes/channels.php
<?php

use App\Models\ChatRoom;
use App\Models\Order;
use Illuminate\Support\Facades\Broadcast;

// Private Channel：订单通知——只有订单所属用户能订阅
Broadcast::channel('orders.{userId}', function ($user, int $userId) {
    return (int) $user->id === $userId;
});

// Presence Channel：客服聊天室——房间成员才可加入
Broadcast::channel('chat.room.{roomId}', function ($user, int $roomId) {
    $room = ChatRoom::findOrFail($roomId);

    // 检查用户是否为该聊天室成员
    if (!$room->members()->where('user_id', $user->id)->exists()) {
        return null; // 拒绝授权
    }

    // 返回用户信息，会广播给 Presence Channel 的其他成员
    return [
        'id'   => $user->id,
        'name' => $user->name,
        'role' => $user->role, // buyer / agent
        'avatar' => $user->avatar_url,
    ];
});
```

## 第三部分：前端 Echo 集成

### 3.1 安装 Laravel Echo

```bash
npm install laravel-echo pusher-js
```

### 3.2 Echo 配置

```javascript
// resources/js/echo.js
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

const echo = new Echo({
    broadcaster: 'reverb', // Laravel 11+ 使用 'reverb'
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    wsPort: import.meta.env.VITE_REVERB_PORT ?? 80,
    wssPort: import.meta.env.VITE_REVERB_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',
    enabledTransports: ['ws', 'wss'],
});

export default echo;
```

### 3.3 监听事件

```javascript
// resources/js/bootstrap.js
import echo from './echo';

// 监听 Private Channel —— 订单状态变更
echo.private(`orders.${userId}`)
    .listen('.order.status.changed', (event) => {
        console.log('订单状态变更:', event);

        // 更新 UI
        showToast(`订单 ${event.order_no} 状态已更新: ${event.status_label}`);

        // 更新订单列表中的对应项
        orderStore.updateOrderStatus(event.order_id, event.new_status);
    });

// 监听 Presence Channel —— 客服聊天
echo.join(`chat.room.${roomId}`)
    .here((users) => {
        // 当前在线用户列表
        console.log('在线用户:', users);
        chatStore.setOnlineUsers(users);
    })
    .joining((user) => {
        // 新用户加入
        console.log(`${user.name} 加入聊天室`);
        chatStore.addOnlineUser(user);
    })
    .leaving((user) => {
        // 用户离开
        console.log(`${user.name} 离开聊天室`);
        chatStore.removeOnlineUser(user);
    })
    .listen('.chat.message.sent', (event) => {
        // 收到新消息
        chatStore.appendMessage(event);
        scrollToBottom();
    });
```

## 第四部分：生产部署踩坑记录

### 踩坑 1：Nginx 反向代理 WebSocket 断连

**现象**：WebSocket 连接建立后 60 秒自动断开，客户端不断重连。

**根因**：Nginx 默认 `proxy_read_timeout` 为 60 秒，WebSocket 空闲超过此时间被断开。

```nginx
# ❌ 错误配置——缺少 WebSocket 相关 header 和超时设置
server {
    location /app {
        proxy_pass http://127.0.0.1:8080;
    }
}

# ✅ 正确配置
server {
    location /app {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 关键：延长超时到 300 秒，配合心跳保活
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### 踩坑 2：Redis Pub/Sub 与 Laravel Queue 冲突

**现象**：广播事件有时送达，有时丢失。`queue:work` 日志中看到事件被消费但 WebSocket 客户端没收到。

**根因**：`broadcasting.php` 中 Redis 驱动默认使用 `queue` 连接，事件被 Queue Worker 消费后没有转发到 Reverb。

```php
// config/broadcasting.php
// ❌ 错误：使用了 queue 连接，事件会被 Queue Worker 截获
'redis' => [
    'driver' => 'redis',
    'connection' => 'default', // 与 queue 共用连接
],

// ✅ 正确：使用独立的 Redis 连接
'redis' => [
    'driver' => 'redis',
    'connection' => 'broadcast', // 独立连接
],
```

```php
// config/database.php —— 添加独立的 broadcast 连接
'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),

    'default' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_DB', '0'),
    ],

    // 广播专用——独立连接，不与 Queue 混用
    'broadcast' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_BROADCAST_DB', '1'),
    ],
],
```

### 踩坑 3：Reverb 多实例水平扩展

**现象**：部署 2 个 Reverb 实例后，用户 A 连接实例 1 发消息，用户 B 连接实例 2 收不到。

**根因**：Reverb 实例之间不共享 WebSocket 连接状态，必须开启 Redis Scaling。

```bash
# .env —— 必须开启 scaling
REVERB_SCALING_ENABLED=true
```

```php
// config/reverb.php
'scaling' => [
    'enabled' => env('REVERB_SCALING_ENABLED', false),
    'channel' => env('REVERB_SCALING_CHANNEL', 'reverb'),
    'server' => [
        'url' => env('REDIS_URL', 'tcp://127.0.0.1:6379'),
    ],
],
```

### 踩坑 4：前端 Echo 认证失败 403

**现象**：`echo.private('orders.1')` 报 403 Forbidden。

**根因**：Broadcasting 认证路由未启用 CSRF Token 或 Sanctum 中间件冲突。

```php
// bootstrap/app.php (Laravel 11)
->withMiddleware(function (Middleware $middleware) {
    // 确保 broadcasting 路由在 web 中间件组中
    $middleware->web(append: [
        \Illuminate\Routing\Middleware\SubstituteBindings::class,
    ]);
})
```

```javascript
// 前端：确保 CSRF Token 正确传递
const echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    // ...
    authorizer: (channel, options) => {
        return {
            authorize: (socketId, callback) => {
                axios.post('/broadcasting/auth', {
                    socket_id: socketId,
                    channel_name: channel.name,
                })
                .then(response => callback(false, response.data))
                .catch(error => callback(true, error));
            }
        };
    },
});
```

### 踩坑 5：广播事件队列化导致延迟

**现象**：事件触发后客户端 3-5 秒才收到，高峰期甚至 10 秒+。

**根因**：`ShouldBroadcast` 接口默认走 Queue，事件在队列中排队等待。

```php
// ❌ 默认行为：走队列，有延迟
class OrderStatusChanged implements ShouldBroadcast { ... }

// ✅ 方案一：同步广播（低延迟，但阻塞请求）
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class OrderStatusChanged implements ShouldBroadcastNow { ... }

// ✅ 方案二：专用高优先级队列（推荐）
class OrderStatusChanged implements ShouldBroadcast
{
    // 指定专用队列——不与业务 Job 抢资源
    public function broadcastQueue(): string
    {
        return 'broadcasts';
    }
}
```

```bash
# Supervisor 配置——专用 broadcast worker
[program:broadcast-worker]
command=php /var/www/artisan queue:work redis --queue=broadcasts --tries=3 --max-time=60
numprocs=2
autostart=true
autorestart=true
```

### 踩坑 6：连接数暴涨导致内存溢出

**现象**：促销活动期间 Reverb 进程内存持续增长，最终 OOM Kill。

**根因**：每个 WebSocket 连接占用约 50-100KB 内存，万级连接需要 500MB-1GB。

```bash
# 监控当前连接数
php artisan reverb:status

# 输出示例：
# Connections: 8,542
# Channels: 1,203
# Memory: 847 MB
```

**解决方案**：

```php
// config/reverb.php —— 设置单实例连接上限
'apps' => [
    [
        'id' => env('REVERB_APP_ID'),
        'key' => env('REVERB_APP_KEY'),
        'secret' => env('REVERB_APP_SECRET'),
        'capacity' => 5000, // 单实例最大连接数
    ],
],
```

```bash
# 监控脚本——连接数超阈值自动告警
#!/bin/bash
MAX_CONNECTIONS=4000
CURRENT=$(php artisan reverb:status --connections 2>/dev/null)

if [ "$CURRENT" -gt "$MAX_CONNECTIONS" ]; then
    curl -X POST "https://hooks.slack.com/..." \
        -d "{\"text\":\"⚠️ Reverb 连接数告警: ${CURRENT}/${MAX_CONNECTIONS}\"}"
fi
```

### 踩坑 7：WebSocket 心跳（Ping/Pong）配置不当

**现象**：Reverb 服务器与客户端连接正常建立，但空闲 30-60 秒后被 Nginx/云负载均衡器断开，客户端反复重连。

**根因**：WebSocket 连接本身无数据传输时，中间层（Nginx、ALB、CDN）会因空闲超时断开连接。心跳机制用于保活。

```javascript
// 前端 Echo 心跳配置
const echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    wsPort: import.meta.env.VITE_REVERB_PORT ?? 80,
    wssPort: import.meta.env.VITE_REVERB_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',
    enabledTransports: ['ws', 'wss'],
    // 心跳配置：每 30 秒发送一次 ping
    activityTimeout: 30000,   // 30 秒无活动则发送 ping
    pongTimeout: 10000,       // 10 秒未收到 pong 视为断开
});
```

```bash
# Nginx 侧配合：将 proxy_read_timeout 设为心跳间隔的 2-3 倍
proxy_read_timeout 90s;  # 30s 心跳 × 3 = 90s
```

> **最佳实践**：心跳间隔应小于中间层最小空闲超时值。AWS ALB 默认 60 秒，Nginx 默认 60 秒，建议心跳设为 25-30 秒。

### 踩坑 8：SSL/TLS WSS 连接在生产环境失败

**现象**：本地开发 `ws://` 正常，部署到生产后 `wss://` 连接失败，浏览器报 `WebSocket connection to 'wss://...' failed`。

**根因**：Reverb 服务器自身未配置 TLS，需要通过 Nginx 反向代理终止 SSL。

```nginx
# Nginx SSL 终止 + WebSocket 反向代理（完整配置）
server {
    listen 443 ssl http2;
    server_name ws.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/ws.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ws.your-domain.com/privkey.pem;

    location /app {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

> **注意**：`.env` 中 `REVERB_PORT=443`，`REVERB_SCHEME=https`，前端 `forceTLS: true`。Reverb 服务端监听 8080（明文），Nginx 负责 SSL 终止。

### 踩坑 9：客户端断线后未正确重连

**现象**：用户网络切换（Wi-Fi → 4G）后 WebSocket 断开，页面不再收到推送，刷新页面才恢复。

**根因**：Echo 默认重连策略是指数退避，最大间隔可能很长。需要自定义重连逻辑。

```javascript
// 自定义重连策略
const echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    wsPort: import.meta.env.VITE_REVERB_PORT ?? 80,
    wssPort: import.meta.env.VITE_REVERB_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',
    enabledTransports: ['ws', 'wss'],
});

// 监听连接状态变化
echo.connector.pusher.connection.bind('state_change', (states) => {
    const { current, previous } = states;
    console.log(`WebSocket 状态: ${previous} → ${current}`);

    if (current === 'disconnected') {
        showToast('实时连接已断开，正在重连...', 'warning');
    }
    if (current === 'connected') {
        showToast('实时连接已恢复', 'success');
    }
    if (current === 'failed') {
        showToast('实时连接失败，请刷新页面', 'error');
    }
});
```

> **进阶方案**：对于移动端 App，结合 `navigator.onLine` 事件和 Page Visibility API，在页面恢复可见时主动触发重连。

## 第五部分：Pusher → Reverb 迁移指南

如果你已有 Pusher 代码，迁移到 Reverb 几乎零成本——因为 Reverb 兼容 Pusher 协议：

```php
// 迁移前（Pusher）
// .env
BROADCAST_DRIVER=pusher
PUSHER_APP_ID=xxx
PUSHER_APP_KEY=xxx
PUSHER_APP_SECRET=xxx
PUSHER_HOST=
PUSHER_PORT=443
PUSHER_SCHEME=https

// 迁移后（Reverb）
// .env
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=xxx
REVERB_APP_KEY=xxx
REVERB_APP_SECRET=xxx
REVERB_HOST=reverb.your-domain.com
REVERB_PORT=443
REVERB_SCHEME=https
```

前端 Echo 代码只需改一行：

```javascript
// 迁移前
const echo = new Echo({
    broadcaster: 'pusher',
    key: import.meta.env.VITE_PUSHER_APP_KEY,
    cluster: 'ap1',
    // ...
});

// 迁移后
const echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    // ...
});
```

**后端 PHP 代码完全不需要改**——事件、Channel 授权、广播逻辑全部兼容。

## 第六部分：监控与告警

### Reverb 健康检查

```php
// app/Http/Controllers/HealthController.php
public function reverbHealth(): JsonResponse
{
    try {
        $status = Cache::remember('reverb:status', 10, function () {
            return [
                'server'  => 'running',
                'connections' => $this->getConnectionCount(),
                'channels'    => $this->getChannelCount(),
                'memory_mb'   => round(memory_get_usage(true) / 1024 / 1024, 2),
            ];
        });

        return response()->json($status);
    } catch (\Throwable $e) {
        return response()->json([
            'server' => 'error',
            'message' => $e->getMessage(),
        ], 503);
    }
}
```

## 总结

| 维度 | 推荐方案 |
|------|---------|
| 小团队 / 快速上线 | Pusher 云服务 |
| 中大规模 / 成本敏感 | Laravel Reverb |
| 已有 Pusher 代码 | 直接迁移到 Reverb（零改动） |
| 多实例部署 | 开启 Redis Scaling |
| 高优先级广播 | `ShouldBroadcastNow` + 专用队列 |

**关键经验**：
1. **永远用 Private Channel**——除非你明确需要公开数据
2. **广播队列必须独立**——不要和业务 Job 共享队列
3. **Nginx 必须配置 WebSocket header**——否则连接建立即断
4. **多实例必须开 Scaling**——否则消息跨实例丢失
5. **监控连接数**——防止 OOM 导致服务雪崩
6. **配置心跳保活**——避免中间层空闲断连
7. **SSL 终止交给 Nginx**——Reverb 自身不需要配置证书
8. **自定义重连策略**——确保移动端/弱网环境下的连接恢复

## 相关阅读

### Laravel WebSocket & Reverb 系列

- [Laravel Reverb WebSocket 实时通信系统实战：从入门到生产级部署](/php/Laravel/laravel-reverb-websocket/)
- [Laravel Reverb 实战：订单状态实时推送与多实例部署踩坑记录](/php/Laravel/laravel-reverb-guide-deployment/)
- [Laravel Echo 2.x + Reverb Presence Channel：B2C 在线客服与协同编辑实战](/05_PHP/Laravel/2026-06-06-Laravel-Echo-2x-Reverb-Presence-Channel-B2C-在线客服与协同编辑/)
- [Laravel Broadcasting Reverb Private Presence Channel：B2C 实时通知](/05_PHP/Laravel/2026-06-06-Laravel-Broadcasting-Reverb-Private-Presence-Channel-B2C-Realtime-Notification/)
- [GraphQL Subscriptions 实战：Laravel Lighthouse + Reverb 打通库存变更实时推送](/php/Laravel/graphql-subscriptions-guide-laravel-lighthouse-reverb/)

### 实时通信方案对比

- [SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案工程选型](/00_架构/2026-06-03-SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型/)
- [Long-Polling vs SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案对比](/00_架构/Long-Polling-vs-SSE-vs-WebSocket-vs-HTTP-Streaming-实战-实时通信方案对比/)
- [SSE Server-Sent Events 实战：Laravel 单向实时推送方案对比](/php/Laravel/sse-guide-server-sent-events-laravel/)
- [WebTransport 实战：HTTP/3 双向通信，对比 WebSocket 低延迟传输协议](/00_架构/WebTransport-实战-HTTP3-双向通信-对比WebSocket低延迟传输协议-Laravel实时应用集成/)

### Laravel 事件驱动 & 队列

- [Laravel Event-Listener 事件驱动架构 - 解耦订单处理](/php/Laravel/laravel-event-listener-architecture/)
- [Laravel Jobs & Queues 深度解析：广播队列与优先级调度](/php/Laravel/laravel-jobs-queues-deep-dive/)
- [Supabase Realtime 实战：数据库变更实时推送与 Laravel 集成](/databases/Supabase-Realtime-实战-数据库变更实时推送-Broadcast-Presence-Postgres-Changes-Laravel实时架构集成/)
- [Elixir Phoenix LiveView 实战：函数式语言做实时 Web，对比 Laravel Reverb](/00_架构/Elixir-Phoenix-LiveView-实战-函数式语言做实时Web-对比Laravel-Reverb与WebSocket的开发体验/)
