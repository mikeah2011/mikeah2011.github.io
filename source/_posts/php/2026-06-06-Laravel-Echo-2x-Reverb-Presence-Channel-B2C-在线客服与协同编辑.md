---
title: Laravel Echo 2.x 实战：Reverb + Presence Channel 在 B2C 电商中的在线客服与协同编辑
date: 2026-06-06 10:00:00
tags: [Laravel Echo, Reverb, Presence Channel, WebSocket, 在线客服, 协同编辑, B2C]
categories:
  - php
cover: /images/covers/laravel-echo-2-reverb-presence-cover.jpg
description: 深入实战 Laravel Echo 2.x + Reverb 的 Presence Channel 方案，在 B2C 电商场景中落地在线客服系统与多人协同编辑器。涵盖 WebSocket 服务端部署、前端事件监听、CRDT 协同架构、生产环境踩坑经验，从零构建高性能实时交互功能，替代 Pusher 实现数据自主可控。
---

## 前言

在当今竞争激烈的 B2C 电商领域，实时交互能力已经从「锦上添花」变成了「核心基础设施」。用户在浏览商品时希望即时获得客服帮助，运营团队需要多人协同编辑商品详情页和营销活动文案，客服主管需要实时监控坐席状态和排队情况——这些场景无一例外地依赖 WebSocket 技术。

然而，在 Laravel 生态中，WebSocket 方案的选择一直是个让人纠结的问题。Pusher 虽好用但按消息计费，大规模场景下成本惊人；beyondcode 的 Laravel WebSockets 包长期不维护，已经无法兼容 Laravel 11；Socket.io 功能强大，但意味着要额外维护一套 Node.js 运维链路，对 PHP 团队来说增加了心智负担。

2024 年底，随着 Laravel 11.33 的发布，Laravel 官方终于推出了 **Reverb 1.0** 和 **Echo 2.x**，标志着 Laravel 生态正式拥有了「全栈实时解决方案」。Reverb 是一个纯 PHP 实现的 WebSocket 服务端，通过一条 Artisan 命令即可启动；Echo 2.x 则是全新架构的前端客户端库，内置 TypeScript 支持和可插拔连接器。

本文将从实际项目出发，详细介绍如何使用 Echo 2.x + Reverb 搭建 B2C 电商中的两个核心实时功能：**在线客服系统**和**多人协同编辑器**。不仅有完整的代码实现，还有我在生产环境中积累的八条踩坑经验和解决方案。

<!-- more -->

---

## 一、背景：为什么选 Echo 2.x + Reverb

### 1.1 传统方案的痛点

在 Reverb 出现之前，Laravel 生态的实时方案主要有三种选择，每一种都有各自的局限性。

**Pusher** 是最省心的选择，开箱即用，Laravel 原生支持。但它是托管服务，按照消息条数和连接数计费。对于 B2C 电商来说，一个活跃的在线客服系统每天可能产生数百万条消息，一个千人同时在线的商品直播间更会产生海量广播——Pusher 的账单会非常恐怖。更重要的是，数据需要经过 Pusher 的服务器中转，在数据合规日益严格的今天，很多企业对这一点有所顾虑。

**Laravel WebSockets（beyondcode）** 曾经是最流行的自托管方案，它在 Laravel 6-8 时代非常活跃。但遗憾的是，这个包已经长期没有维护更新，不兼容 Laravel 10+，更不用说 Laravel 11 了。如果你现在还在用它，实际上是在一个没有安全补丁的基础设施上构建业务。

**Socket.io + Node.js** 是另一个成熟方案，Socket.io 的生态非常丰富，支持自动降级、房间管理、命名空间等高级功能。但对于以 PHP 为主的团队来说，维护一套 Node.js 服务意味着需要掌握两套技术栈、两套部署流程、两套监控体系。很多中小型电商团队并没有专门的 Node.js 运维人员。

### 1.2 Reverb 的优势

Laravel Reverb 的出现，彻底改变了这个局面。它是 Laravel 官方团队基于 ReactPHP 和 Ratchet 构建的 WebSocket 服务端，具有以下核心优势：

**原生集成，零配置启动**。只需要 `composer require laravel/reverb` 然后 `php artisan reverb:start`，一条命令就能启动一个生产级的 WebSocket 服务。所有配置都通过 Laravel 标准的 `.env` 文件和 `config/reverb.php` 管理，PHP 开发者完全不需要学习新工具。

**Pusher 协议兼容**。Reverb 实现了 Pusher 协议，这意味着现有的 Laravel Broadcasting 代码几乎不需要修改就能从 Pusher 迁移到 Reverb。前端的 Echo 客户端也只需要改几行配置。这种「平滑迁移」的设计大大降低了切换成本。

**Presence Channel 开箱即用**。Presence Channel 是实现「谁在线」功能的关键技术，它能够实时广播频道成员的加入和离开事件。在 Reverb 之前，要实现这个功能要么依赖 Pusher 的付费服务，要么自己基于 Private Channel 模拟，既麻烦又不可靠。Reverb 对 Presence Channel 的支持是原生的、完整的。

**水平扩展能力**。通过 Redis Pub/Sub，Reverb 支持多节点部署。当单台服务器无法承载所有 WebSocket 连接时，可以简单地增加节点并通过 Nginx 负载均衡分配连接，扩展方案清晰明确。

**零额外运行时依赖**。不需要 Node.js、不需要外部 SaaS 服务、不需要额外的消息中间件（Redis 用于水平扩展时才需要）。对于已经有 Laravel + Redis + MySQL 标准架构的电商项目来说，增加 Reverb 几乎没有额外的运维成本。

### 1.3 Echo 2.x vs 1.x 的核心差异

Echo 2.x 不是一个小版本迭代，而是一次架构层面的重构。如果你之前用过 Echo 1.x，以下几点变化值得特别关注：

**连接器可插拔架构**。Echo 1.x 的连接逻辑写死在构造函数中，而 2.x 采用了 Connector 模式，可以方便地替换或扩展连接层。这意味着你可以自定义认证头、添加请求拦截器、实现自定义的重连策略。

**内置 TypeScript 类型定义**。对于使用 TypeScript 的前端项目，2.x 提供了完整的类型推导，包括事件类型、频道类型、回调参数类型等。这在大型项目中能够显著减少运行时错误。

**指数退避重连**。1.x 的重连逻辑非常简单，就是固定间隔重试。2.x 实现了标准的指数退避算法，并且提供了 `onReconnecting`、`onReconnected`、`onConnectionError` 等生命周期钩子，让你可以精确控制重连行为。

**Whisper 功能增强**。Whisper 是 Echo 的「客户端广播」功能，数据不经过服务器端处理，直接在频道内转发。2.x 对 Whisper 的支持更加稳定，特别适合用于「正在输入」指示器这类高频低延迟的场景。

---

## 二、Reverb 服务端部署与 Laravel 配置

### 2.1 安装与初始化

安装 Reverb 非常简单，Laravel 提供了一个一体化的安装命令：

```bash
composer require laravel/reverb laravel/echo
php artisan install:broadcasting
```

`install:broadcasting` 命令会自动完成以下工作：发布 `config/reverb.php` 和 `config/broadcasting.php` 配置文件；在 `AppServiceProvider` 中注册 Reverb 的环境变量；生成前端的 `resources/js/echo.js` 初始化文件。整个过程只需要几秒钟。

### 2.2 环境变量配置

在 `.env` 文件中配置 Reverb 相关的环境变量。这里有一个容易混淆的地方：`REVERB_APP_ID`、`REVERB_APP_KEY`、`REVERB_APP_SECRET` 这三个变量是用于应用与 Reverb 服务之间的鉴权，不是 Pusher 的 Key。虽然变量名看起来类似，但它们是完全独立的：

```env
BROADCAST_CONNECTION=reverb

REVERB_APP_ID=123456
REVERB_APP_KEY=your-app-key
REVERB_APP_SECRET=your-app-secret

REVERB_SERVER_HOST=0.0.0.0
REVERB_SERVER_PORT=8080
```

`REVERB_SERVER_HOST` 设为 `0.0.0.0` 表示监听所有网络接口。在开发环境（如 Laravel Sail/Docker）中，这个值需要根据你的网络拓扑调整。

### 2.3 config/reverb.php 关键配置解读

配置文件中最值得关注的是 `capacity` 和 `scaling` 两个配置项。

`capacity` 决定了单个 Reverb 实例能够承载的最大连接数。这个值不设的话默认不限制，这在生产环境中是非常危险的。经验公式是：`capacity = (可用内存MB - 200) * 1000 / 4`，因为每个 WebSocket 连接大约占用 4KB 内存。一台 4GB 内存的服务器，建议将 capacity 设为 8000 左右。

`scaling.enabled` 用于开启多节点扩展。设为 `true` 时，Reverb 会使用 Redis Pub/Sub 在节点之间同步频道消息。需要注意的是，此时必须配置一个专用的 Redis 连接（`scaling.channel.connection`），建议使用独立的 Redis 数据库编号，避免与业务缓存互相干扰。

```php
// config/reverb.php 核心配置
return [
    'default' => env('REVERB_SERVER', 'reverb'),
    'servers' => [
        'reverb' => [
            'host' => env('REVERB_SERVER_HOST', '0.0.0.0'),
            'port' => env('REVERB_SERVER_PORT', 8080),
            'scaling' => [
                'enabled' => env('REVERB_SCALING_ENABLED', false),
                'channel' => [
                    'connection' => env('REVERB_SCALING_CONNECTION', 'reverb'),
                ],
            ],
        ],
    ],
    'apps' => [
        [
            'app_id' => env('REVERB_APP_ID'),
            'key' => env('REVERB_APP_KEY'),
            'secret' => env('REVERB_APP_SECRET'),
            'capacity' => env('REVERB_APP_CAPACITY'),
            'allowed_origins' => env('REVERB_ALLOWED_ORIGINS', '*'),
        ],
    ],
];
```

### 2.4 启动与进程管理

开发环境直接运行 `php artisan reverb:start --debug` 即可，`--debug` 参数会在控制台输出详细的连接和消息日志，方便调试。

生产环境必须使用 Supervisor 管理 Reverb 进程，确保进程崩溃后自动重启：

```ini
[program:reverb]
command=php /var/www/artisan reverb:start
autostart=true
autorestart=true
user=www-data
redirect_stderr=true
stdout_logfile=/var/log/reverb.log
numprocs=1
```

注意 `numprocs=1`，Reverb 是单进程模型，启动多个实例会因为端口冲突而失败。水平扩展应该是启动多个独立的 Reverb 实例（不同端口），而不是用 Supervisor 启动多个同一命令的进程。

### 2.5 Nginx 反向代理配置

在生产环境中，Reverb 通常不会直接暴露给客户端，而是通过 Nginx 反向代理。这里有几个关键配置必须注意：

```nginx
server {
    listen 443 ssl http2;
    server_name ws.example.com;

    ssl_certificate /etc/ssl/certs/example.com.pem;
    ssl_certificate_key /etc/ssl/private/example.com.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

`proxy_read_timeout` 和 `proxy_send_timeout` 必须设为一个较大的值（如 86400 秒即 24 小时），否则 Nginx 会在默认的 60 秒超时后断开 WebSocket 连接。这是新手最容易遇到的问题，症状是连接建立后一分钟就断开，然后不断重连，日志中看不到任何错误。

---

## 三、Presence Channel 原理与鉴权

### 3.1 三种 Channel 类型对比

Laravel Broadcasting 支持三种 Channel 类型，理解它们的区别是正确选择技术方案的前提。

**Public Channel** 无需任何鉴权，任何知道频道名称的客户端都可以订阅。适用于公开的、不需要访问控制的信息，比如首页公告、全站促销通知等。

**Private Channel** 需要鉴权，客户端订阅时会向 `/broadcasting/auth` 发送请求，后端验证用户身份后才允许加入。但 Private Channel 只验证「能不能加入」，不维护成员列表——你不知道频道里有多少人、分别是谁。

**Presence Channel** 在 Private Channel 的基础上增加了成员管理功能。它不仅验证「能不能加入」，还会追踪「谁在里面」。当用户加入或离开时，频道中的其他用户会收到实时通知。加入频道后，可以通过 `here()` 方法获取当前所有成员的列表。

对于在线客服和协同编辑这两个场景，Presence Channel 是唯一合适的选择。在线客服需要知道「客服是否在线」，协同编辑需要知道「谁在编辑文档」，这些都依赖 Presence Channel 的成员追踪能力。

### 3.2 鉴权端点实现

Laravel 的 `BroadcastServiceProvider` 已经自动注册了 `/broadcasting/auth` 路由。你只需要在 `routes/channels.php` 中定义每个 Presence Channel 的鉴权逻辑。鉴权闭包的返回值非常关键：返回 `null` 表示拒绝加入，返回数组则表示允许加入，数组的内容会作为该用户的「存在信息」广播给频道中的其他成员。

```php
// routes/channels.php
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

// 在线客服会话频道
Broadcast::channel('customer-service.{sessionId}', function (User $user, string $sessionId) {
    $session = \App\Models\CustomerServiceSession::find($sessionId);

    if (!$session) {
        return null;
    }

    // 只有该会话的客户或被分配的客服才能加入
    if ($user->id === $session->customer_id) {
        return ['id' => $user->id, 'name' => $user->name, 'role' => 'customer'];
    }

    if ($user->id === $session->agent_id) {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'role' => 'agent',
            'avatar' => $user->avatar,
        ];
    }

    return null;
});

// 协同编辑频道
Broadcast::channel('collab-edit.{documentId}', function (User $user, string $documentId) {
    $document = \App\Models\ProductDescription::find($documentId);

    if (!$document || !$user->can('edit', $document)) {
        return null;
    }

    return [
        'id' => $user->id,
        'name' => $user->name,
        'color' => $user->cursor_color,
    ];
});

// 客服坐席大厅（所有在线客服可见）
Broadcast::channel('agent-hall', function (User $user) {
    if (!$user->hasRole('customer_service_agent')) {
        return null;
    }

    return [
        'id' => $user->id,
        'name' => $user->name,
        'avatar' => $user->avatar,
        'skills' => $user->agent_skills,
        'max_concurrent' => $user->max_concurrent_sessions ?? 5,
    ];
});
```

### 3.3 前端订阅 Presence Channel

前端通过 Echo 的 `join()` 方法订阅 Presence Channel。`join()` 与 `private()` 和 `channel()` 的区别在于它返回的是一个 PresenceChannel 对象，支持 `here()`、`joining()`、`leaving()` 三个额外的回调方法：

```javascript
import Echo from 'laravel-echo';

const echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    wsPort: import.meta.env.VITE_REVERB_PORT ?? 443,
    wssPort: import.meta.env.VITE_REVERB_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',
    enabledTransports: ['ws', 'wss'],
});

const channel = echo.join('customer-service.123')
    .here((users) => {
        console.log('当前在线用户:', users);
    })
    .joining((user) => {
        console.log(`${user.name} 加入了会话`);
    })
    .leaving((user) => {
        console.log(`${user.name} 离开了会话`);
    })
    .listen('.message.sent', (e) => {
        console.log('新消息:', e.message);
    });
```

---

## 四、实战一：B2C 电商在线客服系统

### 4.1 系统架构概述

我们的在线客服系统需要支持以下核心功能：顾客发起咨询后自动匹配合适的客服坐席，客服和顾客之间的实时消息推送，客服坐席状态的实时监控（在线、忙碌、离开、离线），等待队列的实时更新和管理，以及商品卡片、订单卡片等富媒体消息的发送。

系统采用经典的三层架构：前端（Vue 3 + TypeScript）通过 WebSocket 与 Reverb 保持长连接，后端（Laravel 11）负责业务逻辑处理和消息持久化，Redis 用于存储客服实时状态和等待队列。

### 4.2 数据模型设计

首先是客服会话表，它记录了每一次顾客咨询的完整生命周期。每条记录关联一个顾客和一个客服，状态流转为：等待分配（waiting）→ 进行中（active）→ 已关闭（closed）。`metadata` 字段使用 JSON 类型存储与该会话相关的附加信息，比如顾客正在浏览的商品 ID、涉及的订单号等，方便客服快速了解上下文：

```php
// database/migrations/xxxx_create_customer_service_sessions_table.php
Schema::create('customer_service_sessions', function (Blueprint $table) {
    $table->id();
    $table->foreignId('customer_id')->constrained('users');
    $table->foreignId('agent_id')->nullable()->constrained('users');
    $table->string('channel');
    $table->enum('status', ['waiting', 'active', 'closed'])->default('waiting');
    $table->string('subject')->nullable();
    $table->json('metadata')->nullable();
    $table->timestamp('assigned_at')->nullable();
    $table->timestamp('closed_at')->nullable();
    $table->timestamps();

    $table->index(['status', 'agent_id']);
});
```

聊天消息表记录了所有的对话内容。`type` 字段区分消息类型——纯文本、图片、商品卡片、订单卡片和系统消息（如「客服已接入」「会话已转接」等）。对于商品卡片和订单卡片这类结构化消息，具体的商品信息或订单快照存储在 `attachments` 字段中，这样即使商品下架或订单状态变更，聊天记录中仍然保留发送时的完整信息：

```php
// database/migrations/xxxx_create_chat_messages_table.php
Schema::create('chat_messages', function (Blueprint $table) {
    $table->id();
    $table->foreignId('session_id')->constrained('customer_service_sessions');
    $table->foreignId('sender_id')->constrained('users');
    $table->enum('type', ['text', 'image', 'product_card', 'order_card', 'system']);
    $table->text('content');
    $table->json('attachments')->nullable();
    $table->timestamps();

    $table->index(['session_id', 'created_at']);
});
```

### 4.3 客服坐席状态管理

客服坐席的状态管理是整个客服系统的基石。我们需要一个高效的机制来存储和查询坐席的实时状态，同时在状态变更时通知管理后台。

我选择使用 Redis Hash 来存储坐席状态，而不是数据库。原因很简单：坐席状态变更非常频繁（每次接听电话、切换忙碌、离开座位都会触发），使用数据库会造成大量的写入压力。Redis 的内存操作性能是数据库的两个数量级以上。

状态管理器的核心方法包括三个：`setStatus()` 用于设置坐席状态并广播变更事件；`getStatus()` 用于查询单个坐席的状态；`getAvailableAgents()` 用于查找所有可用的坐席，支持按技能标签过滤和按负载排序。

`getAvailableAgents()` 方法的实现值得详细说明。它从 Redis 中读取所有坐席的状态数据，过滤出状态为「在线空闲」的坐席，再过滤掉已经达到最大并发会话数的坐席，然后根据技能标签进行筛选（比如「退款」类咨询只分配给具有退款处理技能的坐席），最后按当前活跃会话数升序排列——优先分配给负载最低的坐席，实现负载均衡。

### 4.4 会话自动分配逻辑

当顾客发起咨询时，系统会尝试自动分配坐席。分配流程如下：

首先，根据咨询主题推断所需的技能标签。比如顾客在咨询主题中包含「退款」关键词，就匹配 `refund` 技能标签；包含「物流」就匹配 `logistics`。这一步可以通过简单的关键词映射实现，也可以接入 NLP 服务做更精准的意图识别。

然后，调用 `getAvailableAgents()` 查找符合技能要求的可用坐席。如果有可用坐席，就将当前负载最低的坐席分配给该会话，将会话状态更新为 `active`，将坐席状态更新为 `busy`，并广播会话分配事件。

如果没有可用坐席，就将顾客加入等待队列。等待队列使用 Redis List 实现，`LPUSH` 入队、`RPOP` 出队，天然的先进先出顺序。同时广播等待队列更新事件，让管理后台能够实时显示排队人数。

当某个坐席结束会话状态恢复为空闲时，系统需要检查等待队列中是否有待分配的会话，如果有就立即分配。这个机制确保了客服资源的充分利用。

### 4.5 消息实时推送

聊天消息通过事件广播实现实时推送。核心事件类需要实现 `ShouldBroadcast` 接口，并在 `broadcastOn()` 方法中指定 Presence Channel。这里有一个重要的设计决策：消息先持久化到数据库，再通过事件广播推送。这样即使 WebSocket 连接暂时中断，用户刷新页面后仍然能从数据库加载完整的聊天记录。

事件类使用 `broadcastAs()` 方法自定义事件名称（避免 Laravel 自动添加的 `.` 前缀造成混淆），使用 `broadcastWith()` 方法精确控制广播的数据结构——只传输必要的字段，减少网络传输量。

```php
class ChatMessageSent implements ShouldBroadcast
{
    public function __construct(
        public ChatMessage $message,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PresenceChannel('customer-service.' . $this->message->session_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'chat.message.sent';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->message->id,
            'sender_id' => $this->message->sender_id,
            'sender_name' => $this->message->sender->name,
            'type' => $this->message->type,
            'content' => $this->message->content,
            'attachments' => $this->message->attachments,
            'created_at' => $this->message->created_at->toIso8601String(),
        ];
    }
}
```

### 4.6 前端聊天组件设计

前端聊天组件（Vue 3 组合式 API）的核心逻辑是：在组件挂载时加入 Presence Channel，通过 `here()` 获取当前在线的客服信息，通过 `joining()` 和 `leaving()` 监听客服的上下线状态，通过 `listen()` 监听新消息事件。

一个特别值得注意的交互细节是「正在输入」指示器。当客服在输入框中打字时，顾客端应该显示「对方正在输入...」的动画提示。这个功能使用 Echo 的 Whisper 实现——Whisper 是客户端到客户端的直接广播，数据不经过服务器端处理，延迟极低。客户端通过 `channel.whisper('typing', { userId })` 广播输入状态，对方通过 `listenForWhisper('typing', callback)` 接收。

商品卡片和订单卡片的发送是 B2C 电商客服的特色功能。客服可以直接从后台的商品库或订单库中选择一个商品/订单，以卡片形式发送给顾客。前端渲染时根据 `message.type` 字段分发到不同的组件：`<ProductCard>` 渲染商品卡片（包含商品图片、名称、价格、购买链接），`<OrderCard>` 渲染订单卡片（包含订单号、商品列表、物流状态）。

---

## 五、实战二：多人协同编辑

### 5.1 场景分析

在 B2C 电商后台，运营团队经常需要协同编辑商品详情页、营销文案、活动规则等文档。理想的协同编辑体验应该包含以下要素：实时看到其他协作者的存在（头像、光标位置），每个人的光标用不同颜色标识以区分，选中的文本区域用对应颜色高亮显示，所有编辑操作实时同步到所有协作者，两人同时编辑同一段落时不会导致内容丢失或错乱。

### 5.2 OT vs CRDT：算法选型

协同编辑的核心技术难点是冲突解决。当两个人同时编辑同一个文档时，如何保证最终结果的一致性？这需要一个冲突解决算法。

**OT（Operational Transformation）** 是 Google Docs 使用的经典方案。它的核心思想是：每个编辑操作都附带一个版本号，当服务器收到一个操作时，会将其与已经应用的操作序列进行「变换」，使操作在当前文档状态下仍然正确。OT 的优点是实现相对直观，缺点是变换逻辑的正确性很难保证，特别是对于复杂的富文本操作。

**CRDT（Conflict-free Replicated Data Type）** 是近年来兴起的新方案。与 OT 不同，CRDT 是一种数据结构层面的冲突解决策略——数据结构本身就保证了无论操作以什么顺序应用，最终结果都是一致的。这意味着不需要中心化的服务器来做变换，每个客户端可以独立应用操作，然后通过同步协议合并。

对于我们的场景，我强烈推荐 **CRDT 方案**，具体实现使用 **Y.js** 这个成熟的 CRDT 库。原因有三：第一，Y.js 的冲突解决是算法层面保证正确的，不存在 OT 那种边界 case 的问题；第二，Y.js 支持去中心化同步，Reverb 只需要做简单的消息转发，不需要复杂的变换逻辑；第三，Y.js 生态丰富，与 ProseMirror/TipTap 编辑器有成熟的集成方案。

### 5.3 后端设计

后端在协同编辑中的职责相对简单：主要是通过 Presence Channel 广播 Y.js 的增量更新（`update`），以及同步光标位置。

每个文档对应一个 Presence Channel（`collab-edit.{documentId}`）。当某个协作者的编辑器产生变更时，Y.js 会生成一个 `update` 二进制数据，前端通过 Whisper 将这个 update 广播给频道中的其他协作者。其他协作者收到后调用 `Y.applyUpdate(ydoc, update)` 将变更应用到本地的 Y.js 文档，编辑器随之更新。

后端还需要维护一个文档快照机制。Y.js 文档的大小会随着编辑操作不断增长，如果不做清理，长期编辑后会导致内存膨胀和同步变慢。解决方案是定期保存文档快照——将当前 Y.js 文档状态序列化后存入数据库或 Redis，同时清理历史操作日志。建议每 100 次操作或每小时保存一次快照，只保留最近 50 条操作日志用于断线重连时的增量同步。

### 5.4 前端实现

前端使用 TipTap 编辑器（基于 ProseMirror）配合 Y.js 的协作扩展。TipTap 提供了两个关键的扩展：`Collaboration` 用于将编辑器状态绑定到 Y.js 文档，`CollaborationCursor` 用于渲染远程协作者的光标。

Y.js 文档的 `update` 事件是实现同步的核心。当本地编辑器产生变更时，Y.js 文档会触发 `update` 事件，我们需要将这个 update 通过 Presence Channel 广播出去。当收到远程 update 时，调用 `Y.applyUpdate` 应用到本地文档，TipTap 的 Collaboration 扩展会自动响应文档变更并更新编辑器内容。

光标同步的实现需要注意性能优化。光标位置的更新频率非常高（每次键盘输入、鼠标点击都会触发），如果每次都广播，会产生大量的 Whisper 消息。建议使用节流（throttle）策略，限制光标同步频率为每 100 毫秒最多一次。这个频率足以提供流畅的光标追踪体验，同时不会造成网络拥塞。

远程光标的渲染需要为每个协作者创建一个 DOM 元素，包含一条竖线（光标位置）和一个标签（用户名）。使用 CSS 的 `position: absolute` 定位，通过 `getBoundingClientRect()` 获取编辑器中对应位置的坐标。每个协作者分配一个独特的颜色（可以使用预设的颜色列表，也可以基于用户 ID 的哈希值生成）。

### 5.5 冲突检测与合并策略

虽然 Y.js 在数据结构层面保证了冲突解决的正确性，但在用户体验层面，我们仍然需要额外的冲突检测机制。例如，当两个运营人员同时编辑商品价格时，虽然 Y.js 能保证文档不会损坏，但语义层面的冲突（一个改成 99 元，一个改成 88 元）需要业务层来处理。

我的方案是：在 Y.js 之外，维护一个「字段锁」机制。当某个用户开始编辑某个关键字段（如商品价格、库存数量）时，通过 Presence Channel 广播「字段锁定」事件，其他用户看到该字段被锁定后无法编辑（显示灰色遮罩和锁定者的名字）。编辑完成后广播「字段解锁」事件。

这个机制通过 Presence Channel 的 Whisper 实现，不经过服务器端处理，响应速度极快。字段锁有自动过期机制（默认 30 秒），防止用户编辑到一半离开导致字段永久锁定。

---

## 六、性能优化与水平扩展

### 6.1 单节点性能优化

在单节点场景下，性能优化主要集中在三个方面。

**连接数优化**。每个 WebSocket 连接大约占用 4KB 内存和一个文件描述符。确保操作系统的文件描述符限制足够高（`ulimit -n` 建议设为 65535 以上），同时在 Reverb 配置中合理设置 `capacity` 上限。

**消息体积优化**。广播事件的 `broadcastWith()` 方法应该只返回必要的字段，避免传输大量冗余数据。对于富文本内容，可以考虑压缩后再传输。Presence Channel 的用户信息（鉴权闭包返回的数组）也要尽量精简，因为这些信息会随着成员加入/离开被反复广播。

**心跳优化**。Reverb 默认的心跳间隔是 60 秒。对于需要快速检测连接断开的场景（如客服系统），可以将心跳间隔缩短到 30 秒。但不建议设得更低，因为心跳本身也会消耗带宽和处理能力。配合心跳超时设为 10 秒，意味着一个连接断开后最多 40 秒就能被检测到。

### 6.2 多节点水平扩展

当单机无法承载所有 WebSocket 连接时，需要水平扩展。水平扩展的架构是：多个 Reverb 节点通过 Redis Pub/Sub 同步频道消息，前端通过 Nginx 负载均衡连接到不同节点。

水平扩展的关键配置步骤：首先，在 `.env` 中设置 `REVERB_SCALING_ENABLED=true` 并配置 Redis 连接。然后，为每个 Reverb 节点分配不同的端口（如 8080、8081、8082），使用 Supervisor 分别管理。最后，配置 Nginx upstream 将 WebSocket 连接分发到各节点。

这里有一个非常重要的细节：Nginx 的负载均衡策略必须使用 `ip_hash`，不能使用默认的轮询（round-robin）。原因是 WebSocket 连接是有状态的——客户端与某个特定节点建立了长连接后，后续的 HTTP 鉴权请求（`/broadcasting/auth`）也必须路由到同一个节点，否则会鉴权失败。`ip_hash` 策略保证了同一 IP 的请求总是路由到同一节点，从而保证了会话一致性。

```nginx
upstream reverb_cluster {
    ip_hash;
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
    server 10.0.0.3:8080;
}
```

### 6.3 监控与告警

生产环境中，Reverb 的监控至关重要。建议监控以下指标：活跃连接数（接近 capacity 上限时告警）、消息吞吐量（每分钟消息数，异常波动时告警）、内存使用量（持续增长可能意味着内存泄漏）、进程存活状态（Supervisor 可以自动重启，但需要告警通知运维人员）。

可以编写一个定时运行的 Artisan 命令来采集这些指标，通过 Laravel 的通知系统（邮件、钉钉、飞书等）发送告警。同时建议将 Reverb 的日志接入 ELK 或 Loki 等日志系统，方便排查问题。

---

## 七、踩坑记录与解决方案

在生产环境中使用 Echo 2.x + Reverb 的过程中，我总结了八条踩坑经验，每一条都是真实遇到的问题和对应的解决方案。

**踩坑一：`capacity` 未设置导致 OOM**。Reverb 进程运行几天后内存暴涨，最终被系统的 OOM Killer 杀死。排查发现是 `capacity` 配置为空，意味着不限制连接数，恶意脚本或爬虫创建了大量连接。解决方案是在配置中明确设置 `capacity` 值，经验公式是 `(可用内存MB - 200) * 1000 / 4`。

**踩坑二：Nginx 默认超时断开 WebSocket**。WebSocket 连接稳定运行 60 秒后就会断开，然后不断重连。这个问题困扰了我很久，因为日志中看不到任何错误。最终发现是 Nginx 的 `proxy_read_timeout` 默认值是 60 秒，必须显式设置为更大的值（如 86400 秒）。

**踩坑三：前端 OT 同步复杂度过高**。最初尝试在前端使用 OT 方案，多人同时编辑时文档内容频繁出现错乱。调试了两周后，发现是 OT 的变换逻辑有几个边界 case 没处理好。最终改用 Y.js 的 CRDT 方案，冲突解决由算法保证正确性，彻底解决了这个问题。

**踩坑四：Y.js 文档膨胀**。协同编辑器使用几天后越来越卡，内存占用持续增长。原因是 Y.js 的操作日志没有定期清理。解决方案是定期保存文档快照并清理历史操作日志，只保留最近的 50 条操作用于增量同步。

**踩坑五：负载均衡策略错误导致鉴权失败**。多节点部署后，鉴权随机失败。排查发现使用了 Nginx 的默认轮询策略，同一用户的 HTTP 鉴权请求和 WebSocket 握手请求被分发到不同节点。解决方案是使用 `ip_hash` 策略。

**踩坑六：Presence Channel 的 `here()` 返回空数组**。加入频道后 `here()` 回调返回空数组，但实际应该有其他在线用户。原因是 `broadcastOn()` 方法中误用了 `Channel`（Public Channel）而不是 `PresenceChannel`。Public Channel 没有成员管理功能，所以 `here()` 永远返回空数组。这个错误非常隐蔽，因为订阅和广播都不会报错，只是所有与「在线状态」相关的功能都不工作。

**踩坑七：`toOthers()` 不生效导致消息重复**。发送消息后发送者也收到了事件，导致消息在界面上显示两条。原因是 `toOthers()` 需要客户端在 HTTP 请求中正确传递 `socket_id`，但当 CSRF Token 过期时，请求被拦截导致 `socket_id` 未能正确传递。解决方案是确保 CSRF Token 有效，或者改用 API Token 认证。

**踩坑八：Redis Pub/Sub 的消息丢失**。多节点部署后偶尔出现消息丢失。原因是 Redis Pub/Sub 是「发送即忘」模式，如果某个订阅者暂时断开连接，期间发布的消息就会丢失。解决方案是对于关键消息（如客服聊天消息），在广播的同时将消息持久化到数据库，前端通过 API 拉取缺失的消息，保证消息的最终一致性。

---

## 八、总结与选型建议

### 技术选型决策建议

对于 B2C 电商的实时功能需求，技术选型可以从以下几个维度来考量：

如果你的团队以 PHP 为主，已经在用 Laravel 生态，那么 **Echo 2.x + Reverb** 是最自然的选择。它让实时功能完全融入 Laravel 的开发范式——事件、广播、频道鉴权都使用你熟悉的 API，前端 Echo 客户端也是 Laravel 生态的一部分。整个技术栈统一，学习成本和维护成本最低。

如果你的日均消息量在十万以下，对成本不太敏感，**Pusher** 仍然是最省心的选择。它完全托管，不需要你自己运维 WebSocket 服务，Laravel 对它的支持也非常成熟。但一旦消息量上来，账单会成为持续的痛点。

如果你的团队有 Node.js 运维能力，且需要非常复杂的实时功能（如游戏服务器、复杂的状态同步），**Socket.io + Node.js** 可能更适合。它在实时通信领域的功能丰富度和社区成熟度目前仍然是最强的。

### 最终结论

Laravel Echo 2.x + Reverb 的组合，让 B2C 电商开发者第一次能够用纯 PHP 技术栈构建出媲美一线互联网公司的实时交互体验。从在线客服的即时响应到协同编辑的毫秒级同步，从客服坐席的状态监控到等待队列的实时更新，Reverb 用最 Laravel 的方式解决了这些需求。

虽然 Reverb 作为一个相对年轻的项目，在超大规模部署的生产验证和社区生态丰富度方面还有提升空间，但对于绝大多数 B2C 电商场景来说，它已经足够好了。而且随着 Laravel 社区的持续投入，Reverb 的成熟度会快速提升。现在入场，正是最佳时机。

---

## 参考资料

- [Laravel Reverb 官方文档](https://laravel.com/docs/11.x/reverb)
- [Laravel Echo 官方文档](https://laravel.com/docs/11.x/broadcasting)
- [Y.js 官方文档](https://docs.yjs.dev/)
- [TipTap 协作编辑指南](https://tiptap.dev/docs/collaboration/getting-started)
- [OT vs CRDT 论文对比](https://www.researchgate.net/publication/328685217)

## 相关阅读

- [PartyKit 实战：实时协作后端——多人编辑、在线状态、实时光标与 Laravel 应用集成](/categories/架构/PartyKit-实战-实时协作后端-多人编辑在线状态实时光标与Laravel应用集成/)
- [Supabase 实战：开源 Firebase 替代——实时数据库、Auth、Edge Functions 与 Laravel B2C 集成](/categories/架构/2026-06-03-Supabase-实战-开源Firebase替代-实时数据库Auth与Laravel集成/)
- [MQTT + Laravel 实战：IoT 消息协议与 PHP 后端集成——设备数据采集、指令下发与规则引擎](/categories/PHP/Laravel/MQTT-Laravel-实战-IoT消息协议与PHP后端集成-设备数据采集指令下发与规则引擎/)
