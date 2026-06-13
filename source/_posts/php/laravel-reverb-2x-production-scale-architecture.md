---

title: Laravel Reverb 2.x 实战进阶：水平扩展、Redis Pub/Sub 广播、Presence Channel 的生产级部署架构
keywords: [Laravel Reverb, Redis Pub, Sub, Presence Channel, 实战进阶, 水平扩展, 广播, 的生产级部署架构]
date: 2026-06-09 06:18:00
categories:
- php
tags:
- Reverb
- WebSocket
- Redis Pub/Sub
- Presence Channel
- 水平扩展
- 实时通信
- 生产部署
description: 从单机 Reverb 到多节点水平扩展的完整路径：Redis Pub/Sub 广播原理、Presence Channel 状态同步、Nginx 反向代理配置、Supervisor 进程管理，以及生产环境中踩过的每一个坑。
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
---



# Laravel Reverb 2.x 实战进阶：水平扩展、Redis Pub/Sub 广播、Presence Channel 的生产级部署架构

## 概述

Laravel Reverb 从 1.x 到 2.x 的演进，标志着 Laravel 生态终于拥有了一个**原生的、可水平扩展的** WebSocket 服务器。1.x 时期的 Reverb 更像是一个"单机玩具"——连接数受限于单进程内存，多节点部署时频道状态无法同步。2.x 彻底解决了这些问题。

本文将从实际生产需求出发，完整走一遍 Reverb 2.x 的进阶部署路径：

- **Redis Pub/Sub 广播**：多节点间的消息分发机制
- **Presence Channel**：在线用户状态的分布式同步
- **水平扩展架构**：Nginx 反向代理 + Sticky Session
- **Supervisor 进程管理**：Reverb 服务的高可用保障
- **生产踩坑**：心跳超时、内存泄漏、序列化陷阱

如果你已经跑通了 Reverb 的单节点 demo，准备把它推向生产环境，这篇文章就是为你写的。

## 核心概念：Reverb 2.x 的架构设计

### Reverb 的两种运行模式

Reverb 2.x 提供两种服务器模式，选择哪种取决于你的扩展需求：

| 模式 | 适用场景 | 扩展方式 |
|------|----------|----------|
| `reverb:start` | 单机、开发环境 | 垂直扩展（加 CPU/内存） |
| `reverb:start --scaling` | 多节点、生产环境 | 水平扩展（加机器） |

关键区别在于 `--scaling` 标志。开启后，Reverb 会使用 Redis Pub/Sub 来同步节点间的频道事件，而不是仅在本地内存中处理。

### 为什么需要 Redis Pub/Sub？

假设你有两台 Reverb 服务器 A 和 B，用户 Alice 连接在 A 上，用户 Bob 连接在 B 上。当 Alice 在 Presence Channel 中更新自己的状态时：

```
┌──────────────┐     Redis Pub/Sub     ┌──────────────┐
│  Reverb A    │ ◄──────────────────►  │  Reverb B    │
│  Alice 连接   │                       │  Bob 连接    │
└──────────────┘                       └──────────────┘
       ▲                                      ▲
       │                                      │
   Alice 更新状态 ──► 广播到 Redis ──► Bob 收到通知
```

没有 Redis Pub/Sub，Bob 永远看不到 Alice 的状态更新——因为它们在不同的进程/节点上。

### Presence Channel 的特殊性

Presence Channel（`presence-` 前缀）和普通 Channel 的区别：

- **普通 Channel**（`private-`、`channel-`）：只广播事件，不维护成员列表
- **Presence Channel**：除了广播，还要维护"谁在线"的状态列表

Presence Channel 的状态同步更复杂。每个节点需要知道：

1. 当前频道有哪些成员
2. 每个成员的 `user_info` 是什么
3. 成员何时加入/离开

在单机模式下，这些信息全部存在内存中。在 `--scaling` 模式下，这些信息必须通过 Redis 同步。

## 实战配置：从单机到多节点

### 第一步：基础配置

确保 `.env` 中的 Reverb 配置正确：

```env
# 广播驱动
BROADCAST_CONNECTION=reverb

# Reverb 服务器配置
REVERB_APP_ID=your-app-id
REVERB_APP_KEY=your-app-key
REVERB_APP_SECRET=your-app-secret

# Redis 配置（用于 --scaling 模式）
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379

# 广播使用 Redis
REVERB_SCALING_REDIS_CONNECTION=broadcasting
```

`config/broadcasting.php` 中确认 Reverb 驱动配置：

```php
'reverb' => [
    'driver' => 'reverb',
    'key' => env('REVERB_APP_KEY'),
    'secret' => env('REVERB_APP_SECRET'),
    'app_id' => env('REVERB_APP_ID'),
    'options' => [
        'host' => env('REVERB_HOST', '0.0.0.0'),
        'port' => env('REVERB_PORT', 8080),
        'scheme' => env('REVERB_SCHEME', 'https'),
        'useTLS' => env('REVERB_SCHEME') === 'https',
    ],
],
```

`config/reverb.php` 中的关键配置：

```php
return [
    'default' => env('REVERB_SERVER', 'reverb'),

    'servers' => [
        'reverb' => [
            'host' => env('REVERB_HOST', '0.0.0.0'),
            'port' => env('REVERB_PORT', 8080),
            'hostname' => env('REVERB_HOST'),
            'options' => [
                'tls' => [],
            ],
            'max_request_size' => env('REVERB_MAX_REQUEST_SIZE', 10_000),
            'scaling' => [
                'enabled' => env('REVERB_SCALING_ENABLED', false),
                'channel' => [
                    'connection' => env('REVERB_SCALING_CONNECTION', 'reverb'),
                ],
            ],
            'pulse_ingest_interval' => env('REVERB_PULSE_INGEST_INTERVAL', 15),
        ],
    ],
];
```

### 第二步：Redis 配置优化

当使用 `--scaling` 模式时，Redis 成为关键组件。推荐使用专用的 Redis 实例：

```php
// config/database.php
'redis' => [
    'reverb' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'username' => env('REDIS_USERNAME'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => '0',  // 使用独立的 database 编号
        'read_timeout' => 60,
        'retry_after' => 60,
    ],
],
```

**为什么 `read_timeout` 和 `retry_after` 很重要？**

Reverb 的 Pub/Sub 订阅是一个长连接。如果 Redis 连接超时断开，所有通过该连接订阅的频道事件都会丢失。设置较长的超时可以减少意外断开的概率。

### 第三步：启动命令

单节点开发环境：

```bash
php artisan reverb:start
```

多节点生产环境（每个节点都执行）：

```bash
php artisan reverb:start --scaling --host=0.0.0.0 --port=8080
```

Supervisor 配置（推荐）：

```ini
[program:reverb]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/html/artisan reverb:start --scaling --host=0.0.0.0 --port=8080
autostart=true
autorestart=true
user=www-data
numprocs=1
redirect_stderr=true
stdout_logfile=/var/www/html/storage/logs/reverb.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stopwaitsecs=30
```

**注意 `numprocs=1`**：Reverb 本身就是多进程的（内部使用 Swoole/Revolt 的事件循环），不需要 Supervisor 再开多个进程。多开会导致端口冲突。

### 第四步：Nginx 反向代理

这是生产部署中最关键的一环。Nginx 需要正确处理 WebSocket 升级请求：

```nginx
# HTTP -> HTTPS 重定向
server {
    listen 80;
    server_name ws.yourdomain.com;
    return 301 https://$host$request_uri;
}

# WebSocket 服务
server {
    listen 443 ssl http2;
    server_name ws.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/ws.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ws.yourdomain.com/privkey.pem;

    # WebSocket 代理
    location /app {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 长连接超时（关键！）
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        # 关闭缓冲（实时推送）
        proxy_buffering off;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

**多节点部署时的 Nginx 配置**：

```nginx
upstream reverb_backend {
    # 必须使用 ip_hash 或 sticky，保证同一客户端始终连接同一节点
    ip_hash;
    
    server 10.0.1.1:8080;
    server 10.0.1.2:8080;
    server 10.0.1.3:8080;
}

server {
    listen 443 ssl http2;
    server_name ws.yourdomain.com;

    location /app {
        proxy_pass http://reverb_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_buffering off;
    }
}
```

**`ip_hash` 是必须的**，原因在踩坑部分详述。

## Presence Channel 实战：在线用户列表

### 定义 Presence Channel

```php
// routes/channels.php
use App\Models\ChatRoom;
use App\Models\User;

Broadcast::channel('chat.room.{room}', function (User $user, ChatRoom $room) {
    if ($room->members()->where('user_id', $user->id)->exists()) {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'avatar' => $user->avatar_url,
            'role' => $room->getMemberRole($user->id),
        ];
    }
});
```

返回的数组就是 `user_info`，会广播给频道中的所有成员。

### 前端订阅 Presence Channel

```javascript
// resources/js/bootstrap.js
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

window.Echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERT_HOST,
    wsPort: import.meta.env.VITE_REVERT_PORT ?? 80,
    wssPort: import.meta.env.VITE_REVERT_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERT_SCHEME ?? 'https') === 'https',
    enabledTransports: ['ws', 'wss'],
});

// 订阅 Presence Channel
const channel = window.Echo.join(`chat.room.${roomId}`);

// 有人加入
channel.here((users) => {
    console.log('当前在线用户:', users);
    // users 是一个数组，包含所有在线成员的 user_info
});

// 新成员加入
channel.joining((user) => {
    console.log(`${user.name} 加入了聊天室`);
});

// 成员离开
channel.leaving((user) => {
    console.log(`${user.name} 离开了聊天室`);
});

// 监听自定义事件
channel.listen('NewMessage', (e) => {
    console.log('新消息:', e.message);
});

// 监听 whisper（客户端直发，不经过后端广播）
channel.listenForWhisper('typing', (e) => {
    console.log(`${e.name} 正在输入...`);
});
```

### 后端触发事件

```php
// app/Events/ChatMessageSent.php
namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ChatMessageSent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Message $message,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PresenceChannel('chat.room.' . $this->message->room_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'NewMessage';
    }

    public function broadcastWith(): array
    {
        return [
            'message' => [
                'id' => $this->message->id,
                'content' => $this->message->content,
                'user' => [
                    'id' => $this->message->user->id,
                    'name' => $this->message->user->name,
                    'avatar' => $this->message->user->avatar_url,
                ],
                'created_at' => $this->message->created_at->toIso8601String(),
            ],
        ];
    }
}
```

### 手动广播 Presence 状态变更

有些场景需要主动管理 Presence 状态，比如"用户正在输入"的提示：

```php
// app/Http/Controllers/ChatController.php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Broadcast;

class ChatController extends Controller
{
    /**
     * 广播"正在输入"状态（通过 whisper）
     * 注意：whisper 不经过后端，直接通过 WebSocket 转发
     * 这个方法仅用于需要服务端触发的场景
     */
    public function broadcastTyping(Request $request, int $roomId)
    {
        // whisper 通常由前端直接发送，这里展示服务端触发的方式
        broadcast(new \App\Events\UserTyping(
            user: $request->user(),
            roomId: $roomId,
        ))->toOthers();

        return response()->json(['status' => 'ok']);
    }
}
```

## 多节点扩展：生产级部署架构

### 架构图

```
                    ┌─────────────────┐
                    │   Cloudflare /   │
                    │   CDN / DNS      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Nginx / LB    │
                    │  (Sticky Session)│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐ ┌──▼──────────┐ ┌──▼──────────┐
     │  Web Server 1   │ │ Web Server 2│ │ Web Server 3│
     │  ┌────────────┐ │ │             │ │             │
     │  │ PHP-FPM    │ │ │  PHP-FPM   │ │  PHP-FPM   │
     │  │ + Reverb   │ │ │  + Reverb  │ │  + Reverb  │
     │  └─────┬──────┘ │ │      │     │ │      │     │
     └────────┼────────┘ └──────┼─────┘ └──────┼─────┘
              │                 │              │
              └────────┬────────┘──────────────┘
                       │
              ┌────────▼────────┐
              │   Redis Cluster  │
              │  (Pub/Sub 同步)   │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │   MySQL / PgSQL  │
              │   (持久化存储)     │
              └─────────────────┘
```

### Sticky Session 的必要性

WebSocket 协议有一个关键特性：**连接建立后，所有后续数据帧必须走同一个 TCP 连接**。如果 Nginx 在 WebSocket 握手后把后续请求转发到另一台服务器，连接会立即断开。

`ip_hash` 确保同一个 IP 的请求始终转发到同一台服务器。但更精确的做法是使用 `sticky` 模块：

```nginx
upstream reverb_backend {
    sticky cookie srv_id expires=1h domain=.yourdomain.com path=/;

    server 10.0.1.1:8080;
    server 10.0.1.2:8080;
    server 10.0.1.3:8080;
}
```

`sticky` 比 `ip_hash` 更精确，因为同一 NAT 下的不同用户可能共享 IP。

### 健康检查与故障转移

```nginx
upstream reverb_backend {
    ip_hash;

    server 10.0.1.1:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.2:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.3:8080 max_fails=3 fail_timeout=30s;
}
```

当某台 Reverb 服务器连续 3 次健康检查失败后，Nginx 会将其标记为不可用，持续 30 秒。这期间新的 WebSocket 连接会被路由到其他节点。

**但已有的连接会直接断开**——客户端需要自己实现重连逻辑。

### 前端重连策略

```javascript
// 自动重连
window.Echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERT_HOST,
    wsPort: import.meta.env.VITE_REVERT_PORT ?? 80,
    wssPort: import.meta.env.VITE_REVERT_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERT_SCHEME ?? 'https') === 'https',
    enabledTransports: ['ws', 'wss'],
    // 重连配置
    activityTimeout: 30000,    // 30秒无活动触发心跳
    pongTimeout: 10000,        // 心跳响应超时
    unavailableTimeout: 10000, // 连接不可用超时
});
```

## 踩坑记录

### 坑 1：心跳超时导致连接断开

**现象**：用户连接后几分钟就断开，日志显示 `WebSocket connection closed`。

**原因**：Nginx 的 `proxy_read_timeout` 默认 60 秒。如果 Reverb 的心跳间隔大于 60 秒，Nginx 会认为连接空闲而断开。

**解决**：确保 Reverb 的心跳间隔小于 Nginx 的 `proxy_read_timeout`：

```nginx
# nginx.conf
proxy_read_timeout 300s;  # 5分钟
proxy_send_timeout 300s;
```

```php
// config/reverb.php
'servers' => [
    'reverb' => [
        'options' => [
            // 心跳间隔（秒）
            'activity_timeout' => 30,
            'pong_timeout' => 10,
        ],
    ],
],
```

### 坑 2：Presence Channel 成员列表不一致

**现象**：Node A 显示频道有 3 个成员，Node B 显示 5 个成员。

**原因**：`--scaling` 模式未开启，或者 Redis 连接配置错误。

**排查步骤**：

```bash
# 1. 确认启动命令有 --scaling
ps aux | grep reverb

# 2. 检查 Redis 连接
redis-cli ping

# 3. 检查 Redis Pub/Sub 是否正常
redis-cli SUBSCRIBE "reverb:chat.room.1"

# 4. 在另一个终端触发事件，观察是否收到消息
```

**解决**：确认所有节点都使用 `--scaling` 启动，且 Redis 连接配置一致。

### 坑 3：内存持续增长

**现象**：Reverb 进程的内存从 50MB 逐渐增长到 500MB+。

**原因**：断开的连接没有被正确清理，`user_info` 数据堆积。

**解决**：

```php
// config/reverb.php
'servers' => [
    'reverb' => [
        'options' => [
            // 连接清理间隔
            'cleanup_interval' => 60,
            // 最大连接数限制
            'max_connections' => 10000,
        ],
    ],
],
```

另外，定期重启 Reverb 进程：

```ini
; supervisor.conf
[program:reverb]
command=php /var/www/html/artisan reverb:start --scaling
; 每天凌晨 3 点重启
; 使用外部 cron 实现，Supervisor 本身不支持定时重启
```

```bash
# crontab
0 3 * * * supervisorctl restart reverb
```

### 坑 4：事件序列化失败

**现象**：广播事件时出现 `Serialization of 'Closure' is not allowed`。

**原因**：事件类中包含了不可序列化的对象（如 Closure、PDO 连接）。

**解决**：

```php
class ChatMessageSent implements ShouldBroadcast
{
    use SerializesModels;

    // 不要在构造函数中注入不可序列化的对象
    public function __construct(
        public Message $message,  // OK，Model 可序列化
        // public \Closure $callback, // BAD！Closure 不可序列化
    ) {}

    // 如果必须传递复杂数据，在 broadcastWith 中转换
    public function broadcastWith(): array
    {
        return [
            'message' => $this->message->toArray(),
        ];
    }
}
```

### 坑 5：HTTPS 下 WebSocket 连接失败

**现象**：本地 HTTP 环境正常，部署到生产环境后 WebSocket 连接失败。

**原因**：生产环境使用 HTTPS，但 WebSocket 连接仍尝试使用 `ws://` 而非 `wss://`。

**解决**：

```php
// config/reverb.php
'servers' => [
    'reverb' => [
        'scheme' => env('REVERB_SCHEME', 'https'),
        'options' => [
            'tls' => [
                'cert' => env('REVERB_TLS_CERT'),
                'key' => env('REVERB_TLS_KEY'),
            ],
        ],
    ],
],
```

前端配置：

```javascript
window.Echo = new Echo({
    // ...
    forceTLS: true,
    enabledTransports: ['ws', 'wss'],  // 优先 wss
});
```

### 坑 6：多节点广播延迟

**现象**：消息从 Node A 发出后，Node B 的用户要 2-3 秒才能收到。

**原因**：Redis Pub/Sub 的 `read_timeout` 设置过短，导致 Reverb 频繁重连 Redis。

**解决**：

```php
// config/database.php
'redis' => [
    'reverb' => [
        'read_timeout' => 60,
        'retry_after' => 60,
        'persistent' => true,  // 使用持久连接
    ],
],
```

## 监控与运维

### 关键指标监控

```php
// app/Console/Commands/ReverbStatus.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;

class ReverbStatus extends Command
{
    protected $signature = 'reverb:status';
    protected $description = '查看 Reverb 服务状态';

    public function handle(): int
    {
        // 检查 Redis 连接
        try {
            Redis::connection('reverb')->ping();
            $this->info('✓ Redis 连接正常');
        } catch (\Exception $e) {
            $this->error('✗ Redis 连接失败: ' . $e->getMessage());
            return 1;
        }

        // 检查 Pub/Sub 通道
        $channels = Redis::connection('reverb')->pubsubChannels('reverb:*');
        $this->info('活跃频道数: ' . count($channels));

        return 0;
    }
}
```

### 日志配置

```php
// config/logging.php
'channels' => [
    'reverb' => [
        'driver' => 'daily',
        'path' => storage_path('logs/reverb.log'),
        'level' => 'info',
        'days' => 14,
    ],
],
```

## 总结

Laravel Reverb 2.x 的生产部署，核心在于理解三个层面的问题：

1. **网络层**：Nginx 的 WebSocket 升级配置、Sticky Session、超时设置
2. **应用层**：Redis Pub/Sub 的连接管理、Presence Channel 的状态同步、事件序列化
3. **运维层**：Supervisor 进程管理、健康检查、日志监控

关键决策清单：

- ✅ 生产环境必须开启 `--scaling`
- ✅ Nginx 必须配置 Sticky Session（`ip_hash` 或 `sticky`）
- ✅ Redis 使用独立实例，`read_timeout` 设为 60+
- ✅ Supervisor 管理 Reverb 进程，配置自动重启
- ✅ 前端实现重连逻辑，处理连接断开
- ✅ 监控 Redis 连接状态和活跃频道数

Reverb 2.x 让 Laravel 的实时通信能力从"demo 级别"提升到了"生产级别"。但和所有分布式系统一样，细节决定成败。希望这篇文章帮你避开了我踩过的那些坑。
