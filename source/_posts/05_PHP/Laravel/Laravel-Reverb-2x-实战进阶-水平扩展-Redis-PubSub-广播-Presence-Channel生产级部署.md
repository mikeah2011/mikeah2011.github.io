---
title: 'Laravel Reverb 2.x 实战进阶：水平扩展、Redis Pub/Sub 广播、Presence Channel 的生产级部署架构'
date: 2026-06-07 11:00:00
tags: [Laravel, Reverb, WebSocket, Redis, 实时通信, 部署]
categories: [Laravel/PHP]
cover: /images/covers/laravel-reverb-2x-production-cover.jpg
description: Laravel Reverb 2.x 生产级部署全攻略：架构原理、Redis Pub/Sub 水平扩展、Presence Channel 跨节点同步、Nginx/Supervisor 配置、负载均衡策略及真实踩坑排障指南。
---

Laravel Reverb 从 1.x 正式迈入 2.x 时代后，带来了许多关键性改进：原生水平扩展能力、更成熟的 Redis Pub/Sub 广播机制、Presence Channel 的全面优化，以及对生产环境更友好的连接管理。如果你已经用 Reverb 跑通了本地 demo，却在部署到生产环境时遇到了"连不上""丢消息""多节点不同步"等问题，那么这篇文章就是为你准备的。

本文将从架构原理出发，逐步拆解 Reverb 2.x 的每一个核心模块，最终给出一套可直接落地的生产级部署方案。

---

## 一、Reverb 2.x 架构原理总览

### 1.1 为什么选择 Reverb 而不是继续用 Pusher？

在 Reverb 出现之前，Laravel 生态中处理实时广播的标准方案是 Pusher Channels。Pusher 是 SaaS 服务，按连接数和消息量计费。对于中小项目来说成本可控，但当你面对以下场景时，Pusher 的局限就暴露出来了：

- **数据主权**：敏感行业（金融、医疗、政府）不允许消息经过第三方服务器。
- **成本线性增长**：10 万并发连接时，Pusher 的账单可能比你整台服务器还贵。
- **定制化需求**：需要自定义消息协议、特殊认证逻辑或与内部系统深度集成。

Reverb 的本质是一个由 Laravel 团队维护的、基于 Ratchet/ReactPHP 的 WebSocket 服务器，它完全兼容 Pusher 协议。这意味着你现有的 `broadcasting.php` 配置和前端 `pusher-js` 客户端代码几乎可以零修改地迁移到 Reverb。

### 1.2 Reverb 2.x 的内部架构

Reverb 2.x 的核心进程模型可以用一句话概括：**单进程事件循环 + HTTP/WebSocket 协议复用 + Pub/Sub 消息总线**。

```
┌─────────────────────────────────────────────────┐
│                 Nginx / HAProxy                  │
│              (反向代理 + SSL 终结)                │
└──────────┬──────────────────┬───────────────────┘
           │ HTTP (8080)      │ WebSocket (8080)
           ▼                  ▼
┌─────────────────────────────────────────────────┐
│            Reverb Server (Node 1)               │
│  ┌───────────────────────────────────────────┐  │
│  │  ReactPHP Event Loop (stream_select)     │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐ │  │
│  │  │ WS Conn │  │ HTTP API │  │ Pub/Sub │ │  │
│  │  │ Manager │  │ Handler  │  │ Adapter │ │  │
│  │  └─────────┘  └──────────┘  └────┬────┘ │  │
│  └───────────────────────────────────┼───────┘  │
└──────────────────────────────────────┼──────────┘
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                    ┌──────────┐ ┌──────────┐ ┌──────────┐
                    │  Redis   │ │  Redis   │ │  Redis   │
                    │  Node 1  │ │  Node 2  │ │  Node 3  │
                    └──────────┘ └──────────┘ └──────────┘
                          (Redis Pub/Sub 消息总线)
```

关键要点：

1. **ReactPHP Event Loop**：Reverb 底层使用 ReactPHP 的事件循环，单进程就能处理数万并发连接。这是 Node.js 之外，PHP 生态中少有的高性能事件驱动架构。
2. **协议复用**：同一个端口同时处理 HTTP 请求（用于 REST API 广播）和 WebSocket 升级请求。
3. **Redis Pub/Sub 作为消息总线**：这是水平扩展的关键。当 Node 1 上的客户端触发了广播事件，消息通过 Redis Pub/Sub 发布到所有订阅了该 channel 的 Reverb 节点，确保全局一致性。

### 1.3 Reverb 2.x vs 1.x 的关键变化

Reverb 2.x 在架构上做了几项重要调整：

- **连接存储可插拔**：1.x 版本中连接元数据存储在进程内存中，无法跨节点共享。2.x 引入了可配置的连接存储后端（Redis/Database），使得 Presence Channel 的成员列表可以在多节点间同步。
- **Channel 划分优化**：Private Channel 和 Presence Channel 的鉴权流程更加健壮，支持自定义 Authenticator。
- **心跳机制改进**：引入了更灵活的 heartbeat 配置，解决了 NAT 超时和云服务商空闲连接断开的问题。
- **统计与监控 API**：内置 `/api/channels`、`/api/users` 等诊断端点，方便接入 Prometheus/Grafana。

---

## 二、WebSocket 服务配置详解

### 2.1 安装与基础配置

安装 Reverb 的第一步：

```bash
composer require laravel/reverb
php artisan reverb:install
```

安装完成后，`config/reverb.php` 会自动生成。以下是 2.x 版本中最关键的配置项：

```php
// config/reverb.php
return [
    'default' => env('REVERB_SERVER', 'reverb'),

    'servers' => [
        'reverb' => [
            'host' => env('REVERB_HOST', '0.0.0.0'),
            'port' => env('REVERB_PORT', 8080),
            'hostname' => env('REVERB_HOSTNAME'),
            'max_request_size' => env('REVERB_MAX_REQUEST_SIZE', 10_000),
            'options' => [
                'tls' => [],
            ],
        ],
    ],

    // 水平扩展的核心配置
    'scaling' => [
        'enabled' => true,  // 开启多节点支持
        'channel' => [
            'connection' => env('REVERB_SCALING_CONNECTION', 'reverb'),
        ],
    ],

    // Presence Channel 的连接存储
    'connection' => [
        'type' => 'redis',  // 2.x 新增：可选 redis / database / memory
        'prefix' => env('REVERB_CONNECTION_PREFIX', 'reverb:connection:'),
    ],

    'pulse_ingest_interval' => env('REVERB_PULSE_INGEST_INTERVAL', 15),
];
```

### 2.2 广播驱动配置

将 Laravel 的广播驱动切换到 Reverb：

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
        'useTLS' => env('REVERB_SCHEME') === 'https',
    ],
],
```

`.env` 文件中的关键变量：

```env
BROADCAST_CONNECTION=reverb

REVERB_APP_ID=my-app-id
REVERB_APP_KEY=my-app-key
REVERB_APP_SECRET=my-app-secret
REVERB_HOST=reverb.yourdomain.com
REVERB_PORT=443
REVERB_SCHEME=https

REVERB_SCALING_CONNECTION=reverb
```

> **注意**：`REVERB_APP_ID`、`APP_KEY`、`APP_SECRET` 三者需要在所有 Reverb 节点间保持一致，它们用于 REST API 广播请求的签名验证。

---

## 三、水平扩展：多节点 Redis Pub/Sub 广播

### 3.1 为什么单节点不够？

单个 Reverb 进程在现代硬件上可以轻松承载 1-5 万并发连接。但生产环境中你必须面对以下现实：

- **单点故障**：一个进程挂掉，所有连接断开。
- **垂直扩展上限**：单台机器的 CPU、内存和带宽终有上限。
- **地理分布**：如果你的用户分布在多个地区，就近部署节点可以显著降低延迟。

### 3.2 Redis Pub/Sub 的工作原理

Reverb 2.x 的水平扩展依赖 Redis Pub/Sub（发布/订阅）模式。其核心逻辑是：

1. 每个 Reverb 节点在启动时，会为所有活跃 channel 订阅对应的 Redis channel。
2. 当某个节点收到客户端的广播请求（通过 REST API 或 WebSocket 事件），它会将消息发布到 Redis。
3. 所有订阅了该 channel 的 Reverb 节点都会收到消息，并将其转发给各自节点上连接的客户端。

```
Client A (Node 1)  ──broadcast──>  Node 1  ──publish──>  Redis  ──subscribe──>  Node 2  ──push──>  Client B (Node 2)
```

这意味着即使 Client A 和 Client B 连接在不同的 Reverb 节点上，他们依然能够收到彼此的消息。

### 3.3 部署多节点实例

假设你有两台服务器（或两个容器），它们共享同一个 Redis 实例：

**节点 1 (reverb-1):**

```bash
php artisan reverb:start --host=0.0.0.0 --port=8080
```

**节点 2 (reverb-2):**

```bash
php artisan reverb:start --host=0.0.0.0 --port=8080
```

两个节点的关键配置完全相同，唯一的区别是它们由负载均衡器分配不同的入口 IP。

### 3.4 Redis 集群与 Sentinel

在高可用场景下，你不能依赖单个 Redis 实例。推荐使用 Redis Sentinel 或 Redis Cluster：

```env
# .env
REDIS_CLIENT=predis
REDIS_SENTINEL_HOST=sentinel-1:26379;sentinel-2:26379;sentinel-3:26379
REDIS_SENTINEL_SERVICE=mymaster
```

```php
// config/database.php
'redis' => [
    'client' => env('REDIS_CLIENT', 'predis'),
    'reverb' => [
        'driver' => 'sentinel',
        'sentinel_host' => explode(';', env('REDIS_SENTINEL_HOST')),
        'sentinel_port' => (int) env('REDIS_SENTINEL_PORT', 26379),
        'sentinel_service' => env('REDIS_SENTINEL_SERVICE', 'mymaster'),
        'password' => env('REDIS_PASSWORD'),
        'database' => (int) env('REDIS_REVERB_DB', 0),
    ],
],
```

> **踩坑提醒**：Redis Pub/Sub 是"fire and forget"的——如果某个 Reverb 节点短暂断开与 Redis 的连接，期间发布的消息将永久丢失。因此要确保 Redis 连接的稳定性，配合 `max_execution_time` 和重连策略。

---

## 四、Presence Channel 实战

Presence Channel 是 Reverb 中最强大也最容易踩坑的功能。它允许你在 Private Channel 的基础上，实时追踪哪些用户在"在线"状态。

### 4.1 定义 Presence Channel

```php
// routes/channels.php
use App\Models\User;

Broadcast::channel('chat.room.{roomId}', function (User $user, int $roomId) {
    if ($user->canJoinRoom($roomId)) {
        return ['id' => $user->id, 'name' => $user->name, 'avatar' => $user->avatar_url];
    }
}, ['presence' => true]);
```

返回的数组数据会广播给该 channel 上的其他所有成员。

### 4.2 前端监听 Presence 事件

```javascript
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    wsPort: import.meta.env.VITE_REVERB_PORT ?? 80,
    wssPort: import.meta.env.VITE_REVERB_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',
    enabledTransports: ['ws', 'wss'],
});

const channel = Echo.join(`chat.room.${roomId}`)
    .here((users) => {
        // 当前在线的所有用户（进入时回调一次）
        console.log('在线用户:', users);
        this.onlineUsers = users;
    })
    .joining((user) => {
        // 新用户加入
        console.log(`${user.name} 加入了房间`);
        this.onlineUsers.push(user);
    })
    .leaving((user) => {
        // 用户离开
        console.log(`${user.name} 离开了房间`);
        this.onlineUsers = this.onlineUsers.filter(u => u.id !== user.id);
    })
    .error((error) => {
        console.error('Presence Channel 错误:', error);
    });
```

### 4.3 后端广播 Presence 相关事件

```php
// 在控制器或 Service 中
use Illuminate\Support\Facades\Broadcast;

// 方法一：通过 Echo 直接广播自定义事件
broadcast(new NewMessage($message))->toOthers();

// 方法二：直接使用 Broadcast facade
Broadcast::on('chat.room.' . $message->room_id)
    ->as('new.message')
    ->with(['message' => $message->toArray()])
    ->toOthers()
    ->broadcast();
```

### 4.4 Presence Channel 的多节点同步问题

在 2.x 之前，Presence Channel 是 Reverb 最大的痛点之一。因为成员列表存储在单节点内存中，当你水平扩展到多个节点时，Node A 上的 `here()` 回调看不到 Node B 上的用户。

Reverb 2.x 通过引入 **Redis-based connection store** 解决了这个问题。开启方式：

```env
REVERB_CONNECTION_STORE=redis
```

开启后，每个用户加入 Presence Channel 时，其连接信息（user data、socket ID、timestamp）都会被写入 Redis。当任何节点查询 `here()` 列表时，它从 Redis 中读取全局数据而非本地内存。

```php
// config/reverb.php
'connection' => [
    'type' => 'redis',
    'prefix' => 'reverb:presence:',
    'ttl' => 60, // 连接信息的 TTL，单位秒
],
```

---

## 五、与 Pusher / Socket.io 的对比

| 特性 | Laravel Reverb 2.x | Pusher Channels | Socket.io (Node.js) |
|------|--------------------|-----------------|--------------------|
| **协议** | Pusher Protocol | Pusher Protocol | 自定义协议 |
| **部署方式** | 自托管 | SaaS | 自托管 |
| **水平扩展** | Redis Pub/Sub | 内置（SaaS） | Redis Adapter |
| **Presence Channel** | 原生支持 | 原生支持 | 需要额外库（socket.io-redis） |
| **Laravel 集成** | 一等公民 | 官方支持 | 需要手动适配 |
| **客户端库** | pusher-js（复用） | pusher-js | socket.io-client |
| **成本** | 服务器成本 | 按连接数/消息量 | 服务器成本 |
| **TLS 支持** | 通过 Nginx/HAProxy | 内置 | 通过 Nginx |
| **监控** | 内置诊断 API | Dashboard | 自建 |
| **学习曲线** | 低（Laravel 开发者） | 低 | 中等 |

选型建议：

- **已经用 Laravel，需要自托管**：Reverb 是唯一的选择，没有之一。
- **不想管运维，预算充足**：Pusher 依然是最省心的方案。
- **Node.js 全栈团队，需要高度定制**：Socket.io 更灵活，但需要自己处理大量基础设施。

---

## 六、生产级 Nginx / SSL / Supervisor 配置

### 6.1 Nginx 反向代理配置

这是整个部署中最容易出错的环节。WebSocket 连接需要特殊的 Nginx 配置：

```nginx
# /etc/nginx/sites-available/reverb
upstream reverb_backend {
    # 多节点负载均衡
    server 127.0.0.1:8080 weight=1;
    server 127.0.0.1:8081 weight=1;  # 第二个 Reverb 实例

    # 保持长连接
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name reverb.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/reverb.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reverb.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://reverb_backend;
        proxy_http_version 1.1;

        # WebSocket 升级所需的 Headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";

        # 传递客户端真实 IP
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置 —— WebSocket 长连接需要更大的超时
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # 禁用缓冲，确保消息实时推送
        proxy_buffering off;
        proxy_cache off;
    }
}
```

### 6.2 Supervisor 进程管理

在生产环境中，你**必须**使用 Supervisor 来管理 Reverb 进程。直接运行 `php artisan reverb:start` 在终端中，SSH 断开后进程就会终止。

```ini
; /etc/supervisor/conf.d/reverb.conf
[program:reverb]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/your-app/artisan reverb:start --host=0.0.0.0 --port=8080
autostart=true
autorestart=true
user=www-data
redirect_stderr=true
stdout_logfile=/var/log/reverb/reverb.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stopwaitsecs=30
stopsignal=QUIT
numprocs=1
```

> **重要**：`numprocs` 设置为 1。Reverb 是单进程事件循环模型，你不需要在同一台机器上启动多个相同端口的 Reverb 进程。要扩展，请使用多个不同端口或不同机器。

```bash
# 生效配置
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start reverb:*
```

### 6.3 Systemd 替代方案（可选）

如果你的环境不使用 Supervisor，也可以用 Systemd：

```ini
# /etc/systemd/system/reverb.service
[Unit]
Description=Laravel Reverb WebSocket Server
After=network.target redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/your-app
ExecStart=/usr/bin/php /var/www/your-app/artisan reverb:start --host=0.0.0.0 --port=8080
Restart=always
RestartSec=5
StandardOutput=append:/var/log/reverb/reverb.log
StandardError=append:/var/log/reverb/reverb-error.log

[Install]
WantedBy=multi-user.target
```

---

## 七、负载均衡策略

### 7.1 粘性会话（Sticky Session）问题

WebSocket 连接是**有状态的**——一旦建立，客户端与特定服务器之间的连接会持续数小时甚至数天。这意味着普通的 Round Robin 负载均衡在 WebSocket 场景下存在两个问题：

1. **握手阶段**：WebSocket 握手是一个 HTTP 请求，如果被分发到不同的 Reverb 节点，握手会失败。
2. **Presence Channel**：同一用户的所有连接必须在同一节点上，否则 `leaving` 事件可能无法正确触发。

**解决方案**：使用 Nginx 的 `ip_hash` 策略确保来自同一客户端 IP 的请求始终被路由到同一节点。

```nginx
upstream reverb_backend {
    ip_hash;
    server 127.0.0.1:8080;
    server 127.0.0.1:8081;
}
```

### 7.2 L4 vs L7 负载均衡

- **L7（应用层）**：Nginx 做反向代理。优点是可以做 SSL 终结、路径路由、Header 修改。缺点是 Nginx 需要维护每个 WebSocket 连接的状态，内存消耗较大。
- **L4（传输层）**：HAProxy 或云厂商的 NLB 做 TCP 转发。优点是性能更好，支持更多并发连接。缺点是不能做 SSL 终结（需要在 Reverb 节点上配置 TLS）。

推荐方案：**Nginx 做 SSL 终结 + L4 负载均衡器做 TCP 转发**。

```haproxy
# HAProxy 配置示例
frontend reverb_front
    bind *:443
    mode tcp
    option tcplog
    tcp-request inspect-delay 5s
    default_backend reverb_back

backend reverb_back
    mode tcp
    balance source  # 类似 ip_hash
    server reverb1 10.0.0.1:8080 check
    server reverb2 10.0.0.2:8080 check
```

### 7.3 云原生环境（Kubernetes）

在 K8s 中部署 Reverb 需要注意：

```yaml
# k8s/reverb-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reverb-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: reverb
  template:
    metadata:
      labels:
        app: reverb
    spec:
      containers:
      - name: reverb
        image: your-registry/your-app:latest
        command: ["php", "artisan", "reverb:start", "--host=0.0.0.0"]
        ports:
        - containerPort: 8080
        env:
        - name: REVERB_SCALING_CONNECTION
          value: "reverb"
        # ... 其他环境变量
---
apiVersion: v1
kind: Service
metadata:
  name: reverb-service
spec:
  type: LoadBalancer
  # 关键：使用 ClientIP 亲和性
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 3600
  ports:
  - port: 443
    targetPort: 8080
    protocol: TCP
  selector:
    app: reverb
```

---

## 八、连接管理与心跳机制

### 8.1 WebSocket 心跳的工作原理

WebSocket 协议本身定义了 Ping/Pong 帧用于心跳检测。但在实际生产环境中，很多中间层（Nginx、云负载均衡器、CDN、NAT 网关）会在连接空闲一段时间后主动断开连接。

Reverb 2.x 的心跳机制默认行为：

```
客户端 ──ping──> Reverb  (每 30 秒)
Reverb   ──pong──> 客户端  (响应)
```

如果 Reverb 在 60 秒内没有收到客户端的 Ping，则认为连接已断开，触发 `leaving` 事件。

### 8.2 心跳配置优化

```javascript
// 前端 Echo 配置
window.Echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    wsPort: import.meta.env.VITE_REVERB_PORT,
    wssPort: import.meta.env.VITE_REVERB_PORT,
    forceTLS: true,
    enabledTransports: ['ws', 'wss'],

    // 心跳配置
    activityTimeout: 30000,    // 30秒无活动则发送 Ping
    pongTimeout: 10000,        // 等待 Pong 响应 10 秒
    unavailableTimeout: 30000, // 连接不可用 30 秒后触发重连
});
```

```php
// config/reverb.php
'servers' => [
    'reverb' => [
        // ...
        'options' => [
            'max_connections' => 10000,
            'ping_interval' => 30,    // 每 30 秒发送一次 Ping
            'ping_timeout' => 60,     // 60 秒未响应则断开
        ],
    ],
],
```

### 8.3 自动重连策略

客户端断线后，指数退避重连是最稳健的策略：

```javascript
// Echo 内置了自动重连，但你可以自定义策略
const echo = new Echo({
    // ...
    wsHost: import.meta.env.VITE_REVERB_HOST,
});

// 监听连接状态变化
echo.connector.pusher.connection.bind('state_change', (states) => {
    console.log(`连接状态: ${states.previous} -> ${states.current}`);

    if (states.current === 'disconnected') {
        // 通知用户连接已断开
        showReconnectionBanner();
    }

    if (states.current === 'connected') {
        // 重新加入 Presence Channel
        hideReconnectionBanner();
    }
});
```

### 8.4 连接数监控

Reverb 2.x 内置了诊断 API：

```bash
# 查看所有 channel 及其订阅者数量
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
     http://localhost:8080/api/channels

# 查看特定 channel 的详细信息
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
     http://localhost:8080/api/channels/chat.room.1

# 查看所有在线用户
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
     http://localhost:8080/users
```

你可以在 Laravel 中封装一个简单的监控端点：

```php
// app/Http/Controllers/Admin/ReverbController.php
class ReverbController extends Controller
{
    public function stats()
    {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('reverb.servers.reverb.options.api_key'),
        ])->get('http://127.0.0.1:8080/api/channels');

        return view('admin.reverb-stats', [
            'channels' => $response->json(),
        ]);
    }
}
```

---

## 九、真实踩坑与排障指南

### 踩坑 1：Nginx 502 Bad Gateway

**症状**：WebSocket 握手时返回 502，HTTP REST API 正常。

**原因**：Nginx 的 `proxy_pass` 目标地址错误，或 Reverb 进程未启动。

**解决**：

```bash
# 检查 Reverb 进程是否在运行
sudo supervisorctl status reverb:*

# 检查端口是否监听
ss -tlnp | grep 8080

# 检查 Nginx 错误日志
tail -f /var/log/nginx/error.log
```

### 踩坑 2：WebSocket 连接建立成功但很快断开

**症状**：浏览器控制台看到 WebSocket 连接成功，但 30-60 秒后断开。

**原因**：云服务商（AWS ALB、GCP LB）或中间代理的空闲连接超时设置过短。

**解决**：

- AWS ALB：设置 Idle Timeout 为 300 秒。
- Nginx：`proxy_read_timeout 300s; proxy_send_timeout 300s;`
- 确保客户端心跳间隔小于代理空闲超时的一半。

### 踩坑 3：Presence Channel 的 `here()` 返回空数组

**症状**：用户成功加入了 Presence Channel，但 `here()` 回调中没有数据。

**原因**：多节点部署时未开启 Redis connection store，或 channel callback 返回了 `null`。

**解决**：

```php
// routes/channels.php
// ❌ 错误：返回 null 会导致鉴权失败
Broadcast::channel('chat.room.{id}', function ($user, $id) {
    return true;  // 只返回 true，没有用户数据
});

// ✅ 正确：必须返回包含用户信息的数组
Broadcast::channel('chat.room.{id}', function ($user, $id) {
    return ['id' => $user->id, 'name' => $user->name];
}, ['presence' => true]);
```

### 踩坑 4：广播事件发出了，但客户端收不到

**症状**：`php artisan tinker` 中执行 `broadcast(new SomeEvent())` 无报错，但前端无反应。

**排查步骤**：

1. 确认事件实现了 `ShouldBroadcast` 接口。
2. 确认事件中的 `broadcastOn()` 返回了正确的 channel 名称。
3. 确认前端 Echo 监听的 channel 名称与后端一致（注意 `private-` / `presence-` 前缀由客户端自动添加）。
4. 检查浏览器 Network 面板中 WebSocket 帧是否有消息。
5. 检查 Reverb 日志：`tail -f /var/log/reverb/reverb.log`。

```php
// 一个完整的可广播事件
class NewMessage implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Message $message) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('chat.room.' . $this->message->room_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'chat.message.new';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->message->id,
            'body' => $this->message->body,
            'user' => [
                'id' => $this->message->user->id,
                'name' => $this->message->user->name,
            ],
            'created_at' => $this->message->created_at->toIso8601String(),
        ];
    }
}
```

### 踩坑 5：Redis Pub/Sub 导致内存泄漏

**症状**：长时间运行后 Redis 内存持续增长，最终 OOM。

**原因**：Reverb 订阅了大量 channel 但未正确 unsubscribe。

**解决**：Reverb 2.x 已修复此问题。如果仍在 1.x 上，升级到 2.x。同时监控 Redis 的 `pubsub channels` 数量：

```bash
redis-cli pubsub channels | wc -l
redis-cli info memory | grep used_memory_human
```

### 踩坑 6：SSL/TLS 握手失败

**症状**：`wss://` 连接直接失败，浏览器报 ERR_SSL_PROTOCOL_ERROR。

**原因**：Nginx 配置了 SSL，但 `proxy_pass` 指向的 Reverb 用的是 `http`，而客户端直接尝试用 `wss://` 连接 Reverb 端口。

**解决**：确保客户端连接的是 Nginx 的 443 端口，而不是 Reverb 的 8080 端口。SSL 终结在 Nginx 层完成，Reverb 内部用明文 HTTP 即可。

---

## 十、部署检查清单

在将 Reverb 推上生产环境之前，请逐项检查：

### 基础设施层
- [ ] Redis 实例已部署且可访问（推荐 Redis 7.x+）
- [ ] Redis 密码已设置（`requirepass`）
- [ ] 如果使用 Redis Sentinel/Cluster，连接配置已测试
- [ ] 服务器防火墙已开放 Reverb 端口（内部通信）
- [ ] SSL 证书已申请并配置（Let's Encrypt / 企业证书）

### 应用层
- [ ] `.env` 中 `BROADCAST_CONNECTION=reverb`
- [ ] `REVERB_APP_ID` / `APP_KEY` / `APP_SECRET` 在所有节点一致
- [ ] `config/reverb.php` 中 `scaling.enabled = true`
- [ ] Presence Channel 的 channel callback 返回了用户数据数组
- [ ] 所有广播事件实现了 `ShouldBroadcast` 接口

### Nginx 层
- [ ] WebSocket 升级 Headers 已配置（`Upgrade` / `Connection`）
- [ ] `proxy_read_timeout` 设置为 300 秒或更长
- [ ] `proxy_buffering off` 已设置
- [ ] SSL 证书链完整（中间证书不缺失）
- [ ] 域名 DNS 已解析到正确 IP

### 进程管理层
- [ ] Supervisor 已安装且 Reverb 进程配置正确
- [ ] `autorestart=true` 已设置
- [ ] 日志文件路径已创建且有写权限
- [ ] 日志轮转（logrotate）已配置

### 监控层
- [ ] Reverb 诊断 API 可访问（`/api/channels`）
- [ ] Redis 内存监控已接入（Prometheus + Grafana）
- [ ] WebSocket 连接数监控已接入
- [ ] 进程崩溃告警已配置（Supervisor event listener / PagerDuty）

### 测试层
- [ ] 多标签页测试 Presence Channel 的 joining / leaving 事件
- [ ] 跨节点广播测试（模拟 2+ Reverb 实例）
- [ ] 断线重连测试（手动断开网络后恢复）
- [ ] 长连接存活测试（保持连接 1 小时以上）
- [ ] 压力测试（推荐使用 Artillery 或 k6）

---

## 十一、性能调优建议

### 11.1 Reverb 进程优化

```bash
# 增加文件描述符限制（每个 WebSocket 连接消耗一个 fd）
ulimit -n 65535

# 在 /etc/security/limits.conf 中持久化
www-data soft nofile 65535
www-data hard nofile 65535
```

### 11.2 PHP OPcache 优化

```ini
; /etc/php/8.3/cli/conf.d/10-opcache.ini
opcache.enable=1
opcache.memory_consumption=256
opcache.jit_buffer_size=128M
opcache.jit=1255
```

### 11.3 内核参数调优

```bash
# /etc/sysctl.conf
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
```

---

## 总结

Laravel Reverb 2.x 终于补齐了生产级部署的最后一块拼图。通过 Redis Pub/Sub 实现的消息总线让多节点部署变得可行，Presence Channel 的 Redis 连接存储解决了跨节点状态同步的难题，而完善的诊断 API 则让运维不再是黑盒。

回顾全文的核心要点：

1. **架构上**：Reverb 是单进程事件循环 + Redis Pub/Sub 消息总线的架构，天然适合水平扩展。
2. **部署上**：Nginx 做 SSL 终结和 WebSocket 代理，Supervisor 管理进程生命周期，Redis Sentinel/Cluster 保证消息总线高可用。
3. **扩展上**：通过 `ip_hash` 或 `sessionAffinity` 解决有状态连接的负载均衡问题，通过 Redis connection store 解决 Presence Channel 的跨节点同步。
4. **运维上**：利用内置诊断 API + Prometheus + Grafana 建立完整的监控体系，用日志和告警覆盖常见的故障场景。

Reverb 不是银弹——它仍然是相对年轻的项目，与经过十年打磨的 Socket.io 和商业级的 Pusher 相比，在边缘场景的稳定性上还有提升空间。但对于 Laravel 生态的开发者来说，它是目前最自然、最集成的 WebSocket 方案。在正确的架构设计和运维保障下，Reverb 2.x 完全可以胜任生产级别的实时通信需求。

---

*如果这篇文章对你有帮助，欢迎在评论区分享你在 Reverb 部署中的踩坑经历，或者提出任何问题。*
