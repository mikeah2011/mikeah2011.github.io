---

title: Supabase Realtime 实战：数据库变更实时推送——Broadcast/Presence/Postgres Changes 与 Laravel
keywords: [Supabase Realtime, Broadcast, Presence, Postgres Changes, Laravel, 数据库变更实时推送]
date: 2026-06-07 10:00:00
tags:
- Supabase
- Realtime
- Laravel
- WebSocket
- postgres
- broadcast
- presence
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
description: 全面实战 Supabase Realtime 三大核心功能——Broadcast 自定义事件广播、Presence 在线状态管理与 Postgres Changes 数据库变更实时推送，结合 Laravel 后端集成方案深入讲解 JWT 认证、RLS 行级安全、Laravel Echo/Pusher/Ably 对比选型。包含生产级前端 RealtimeManager 封装、指数退避重连策略、自托管 Docker Compose 部署配置，以及连接风暴、REPLICA IDENTITY 踩坑等实战经验，助你构建低成本高可靠的实时数据架构。
---




## 前言

在现代 Web 应用开发中，实时数据推送已经从"锦上添花"变成了"刚需"。无论是即时聊天、协同编辑、实时仪表盘，还是电商秒杀场景中的库存同步，用户对实时性的期望越来越高。当一位用户在电商平台上完成了订单支付，他期望能够立即看到订单状态的更新，而不是需要手动刷新页面。当一个团队在协作编辑文档时，每个成员都希望能够实时看到其他人的光标位置和编辑内容。这些场景的背后，都需要一套高效可靠的实时数据推送机制。

传统方案中，Laravel 开发者通常依赖 Pusher、Ably 或 Laravel Echo Server 来实现 WebSocket 通信。这些方案虽然成熟稳定，但往往需要引入额外的基础设施和运维成本。Pusher 需要按消息量付费，Ably 的定价同样不低，而自建 Laravel Echo Server 则需要维护 Redis 和 WebSocket 服务器。对于中小型项目或者初创团队来说，这些成本可能会成为技术选型时的负担。

Supabase 作为开源的 Firebase 替代方案，自 2020 年推出以来迅速获得了开发社区的青睐。其 Realtime 模块基于 PostgreSQL 的逻辑复制（Logical Replication）和 Elixir 构建的 Realtime Server，提供了三种强大的实时能力：**Broadcast**、**Presence** 和 **Postgres Changes**。这三种能力分别对应了不同的实时场景需求，从简单的消息广播到复杂的数据库变更监听，覆盖了绝大多数实时应用场景。

更重要的是，Supabase Realtime 可以与 Laravel 后端无缝集成。Laravel 负责处理业务逻辑和数据持久化，而 Supabase Realtime 负责实时推送，两者各司其职，形成一套完整而优雅的实时架构。这种架构不仅降低了基础设施成本，还充分利用了 PostgreSQL 作为共享数据源的优势，让"写数据库即推送"成为现实。

本文将深入探讨 Supabase Realtime 的三大核心功能，通过实际代码示例展示如何将其与 Laravel 后端集成，对比传统方案的优劣，并给出生产环境的最佳实践建议。无论你是 Supabase 的新手还是有经验的 Laravel 开发者，都能从本文中获得有价值的参考。

---

## 一、Supabase Realtime 架构概览

### 1.1 Realtime Server 的技术栈与设计哲学

Supabase Realtime Server 使用 Elixir 语言编写，运行在 Erlang VM（BEAM）之上。这个技术选择并非偶然——Erlang/OTP 最初就是为电信系统设计的，天然具备处理海量并发连接和高容错的能力。一个单独的 Supabase Realtime Server 实例可以轻松处理数万条并发 WebSocket 连接，这对于实时应用场景来说至关重要。

Realtime Server 的核心设计哲学是"数据库即真相源"（Database as Single Source of Truth）。它不维护自己的状态存储，而是通过 PostgreSQL 的逻辑复制功能直接监听数据库的 WAL（Write-Ahead Log）。当数据库中发生数据变更时，WAL 中会记录这些变更，Realtime Server 通过逻辑复制槽（Replication Slot）读取这些变更记录，并将其转化为实时事件推送给对应的客户端。

这种设计带来了几个显著优势。首先，数据一致性得到保障，因为所有变更都来自同一个数据源。其次，不需要在应用层编写额外的推送逻辑，减少了出错的可能性。最后，PostgreSQL 的逻辑复制是可靠且高效的，即使在高并发写入场景下也能保持稳定的性能。

### 1.2 系统架构全景

让我们先从整体架构的角度来理解 Supabase Realtime 的工作方式：

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend   │────▶│  Realtime Server │────▶│   PostgreSQL    │
│  (WebSocket) │◀────│   (Elixir/BEAM)  │◀────│ (Logical Repl.) │
└─────────────┘     └──────────────────┘     └─────────────────┘
                           ▲
                           │
                    ┌──────┴───────┐
                    │   Laravel    │
                    │   Backend    │
                    │  (REST/SQL)  │
                    └──────────────┘
```

在这个架构中，前端通过 WebSocket 连接到 Realtime Server，订阅感兴趣的频道或事件。Laravel 后端通过正常的数据库操作写入数据，这些写入操作会被 PostgreSQL 的逻辑复制捕获，并由 Realtime Server 转化为实时事件推送给前端。整个过程对 Laravel 来说是透明的——你不需要在 Laravel 代码中添加任何推送逻辑，只需专注于业务逻辑的实现。

### 1.3 连接协议与通信机制

Supabase Realtime 使用 WebSocket 作为底层传输协议，通信格式基于 Phoenix Framework 的 Phoenix Channel 协议。客户端通过 Supabase JavaScript SDK 建立 WebSocket 连接，连接地址格式为：

```
wss://<project-ref>.supabase.co/realtime/v1?apikey=<anon-key>&vsn=1.0.0
```

连接建立后，客户端需要加入（join）特定的频道（Channel），然后在频道上监听事件或发送消息。每个频道都是独立的，不同频道之间的消息互不干扰。这种频道模型与 Pusher 的 Channel 概念类似，对于有 Pusher 使用经验的开发者来说非常容易理解。

Supabase Realtime 的消息格式遵循 JSON 标准，每条消息都包含以下关键字段：
- `event`：事件类型，如 `postgres_changes`、`broadcast`、`presence`
- `payload`：事件数据，包含具体的变更信息
- `ref`：消息引用 ID，用于请求-响应匹配
- `topic`：频道名称

### 1.4 认证机制详解

Supabase Realtime 支持多种认证方式，这为不同的集成场景提供了灵活性：

**匿名密钥（Anon Key）**：这是最基本的认证方式，适用于公开数据的访问。匿名密钥是公开的，可以安全地嵌入前端代码中。通过 RLS（行级安全）策略来控制数据访问范围。

**服务角色密钥（Service Role Key）**：拥有完全的数据访问权限，可以绕过 RLS 策略。这个密钥应该严格保密，只能在后端使用。在 Laravel 与 Supabase 集成时，Laravel 后端通常使用服务角色密钥来操作数据库。

**自定义 JWT Token**：Laravel 后端可以生成 Supabase 兼容的 JWT Token，前端使用该 Token 连接 Realtime。这种方式让你可以复用 Laravel 的用户认证体系，不需要在 Supabase Auth 中重新管理用户。

在与 Laravel 集成的典型场景中，认证流程如下：用户通过 Laravel Sanctum 或 Passport 完成登录认证，Laravel 后端生成 Supabase 兼容的 JWT Token 返回给前端，前端使用该 Token 初始化 Supabase 客户端并连接 Realtime Server。Realtime Server 会验证 Token 的有效性，并根据 Token 中的用户信息应用相应的 RLS 策略。

---

## 二、Broadcast：自定义事件广播

### 2.1 功能说明与适用场景

Broadcast 是 Supabase Realtime 中最基础也是最灵活的功能。它允许客户端向指定频道发送和接收自定义事件，数据通过 Realtime Server 直接中转，**不经过数据库**。这意味着 Broadcast 的延迟极低，因为消息不需要经过数据库写入和读取的过程。

Broadcast 的适用场景非常广泛。在即时聊天应用中，每条新消息可以通过 Broadcast 实时广播给所有在线用户。在表单协作场景中，用户的光标位置、输入状态可以通过 Broadcast 实时同步给其他协作者。在实时通知系统中，服务器端产生的各类通知可以通过 Broadcast 推送给目标用户。

与 Postgres Changes 不同，Broadcast 的数据不会持久化到数据库中。这意味着如果你需要消息持久化或历史记录功能，需要在应用层自行实现。但从另一个角度来看，这也使得 Broadcast 非常适合那些不需要持久化的临时数据传输场景。

### 2.2 前端代码示例

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
)

// 创建并订阅频道
const channel = supabase.channel('room-1', {
  config: {
    broadcast: { self: false } // 不接收自己发送的消息，避免回显
  }
})

// 监听自定义事件
channel.on('broadcast', { event: 'new-message' }, (payload) => {
  console.log('收到新消息:', payload)
  appendMessageToUI(payload.payload)
})

// 监听用户输入状态
channel.on('broadcast', { event: 'typing' }, (payload) => {
  showTypingIndicator(payload.payload.username)
})

// 订阅频道，等待连接就绪
channel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    console.log('成功连接到频道: room-1')
  }
})

// 发送消息
function sendMessage(text) {
  channel.send({
    type: 'broadcast',
    event: 'new-message',
    payload: {
      user: 'user-123',
      username: '张三',
      text: text,
      timestamp: new Date().toISOString()
    }
  })
}

// 发送输入状态
function sendTypingStatus(username) {
  channel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { username }
  })
}
```

### 2.3 Laravel 后端集成方式

Laravel 后端可以通过多种方式与 Broadcast 集成，以下是两种最常用的方案：

**方式一：通过 REST API 发送广播**

Supabase 提供了 REST API 端点，允许服务端直接向频道发送广播消息。这种方式的优势在于，Laravel 可以在任何业务逻辑处理完成后触发广播，实现服务端主动推送。

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SupabaseRealtimeService
{
    private string $url;
    private string $anonKey;
    private string $serviceRoleKey;

    public function __construct()
    {
        $this->url = config('services.supabase.url');
        $this->anonKey = config('services.supabase.anon_key');
        $this->serviceRoleKey = config('services.supabase.service_role_key');
    }

    /**
     * 通过 Supabase REST API 向 Realtime 频道发送广播
     *
     * @param string $channel 频道名称
     * @param string $event 事件名称
     * @param array $payload 事件数据
     * @return bool 是否发送成功
     */
    public function broadcast(string $channel, string $event, array $payload): bool
    {
        try {
            $response = Http::withHeaders([
                'apikey' => $this->serviceRoleKey,
                'Authorization' => "Bearer {$this->serviceRoleKey}",
                'Content-Type' => 'application/json',
            ])->post("{$this->url}/realtime/v1/api/broadcast", [
                'channel' => $channel,
                'event' => $event,
                'payload' => $payload,
            ]);

            return $response->successful();
        } catch (\Exception $e) {
            Log::error('Supabase Broadcast 发送失败', [
                'channel' => $channel,
                'event' => $event,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * 向多个频道发送广播
     */
    public function broadcastToMany(array $channels, string $event, array $payload): bool
    {
        $results = array_map(
            fn($channel) => $this->broadcast($channel, $event, $payload),
            $channels
        );

        return !in_array(false, $results);
    }
}
```

**方式二：在 Laravel Job 中异步发送广播**

对于不需要立即推送的场景，可以将广播任务放到队列中异步处理，避免阻塞主请求流程：

```php
<?php

namespace App\Jobs;

use App\Services\SupabaseRealtimeService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class BroadcastNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private string $channel,
        private string $event,
        private array $payload
    ) {}

    public function handle(SupabaseRealtimeService $realtime): void
    {
        $realtime->broadcast($this->channel, $this->event, $this->payload);
    }
}
```

### 2.4 配置文件设置

在 Laravel 项目的 `config/services.php` 中添加 Supabase 配置：

```php
'supabase' => [
    'url' => env('SUPABASE_URL'),
    'anon_key' => env('SUPABASE_ANON_KEY'),
    'service_role_key' => env('SUPABASE_SERVICE_ROLE_KEY'),
    'jwt_secret' => env('SUPABASE_JWT_SECRET'),
],
```

在 `.env` 文件中配置对应的环境变量：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_JWT_SECRET=your-jwt-secret
```

### 2.5 Broadcast 的高级配置与性能优化

Supabase Broadcast 提供了多项高级配置选项，帮助开发者根据具体需求优化性能和行为：

```javascript
const channel = supabase.channel('room-1', {
  config: {
    broadcast: {
      self: false,    // 是否接收自己发送的消息
      ack: true,      // 是否需要服务端确认收到
    }
  }
})

// 带确认的发送：等待服务端确认消息已送达
const result = await channel.send({
  type: 'broadcast',
  event: 'important-message',
  payload: { text: '这是一条重要消息' }
})

if (result === 'ok') {
  console.log('消息已确认送达所有订阅者')
} else {
  console.warn('消息可能未送达，需要重试')
}
```

在高并发场景下，建议对 Broadcast 的发送频率进行限制。例如，在实现"正在输入"状态同步时，可以使用节流（throttle）机制，限制状态更新的发送频率为每秒最多一次：

```javascript
let lastTypingSent = 0

function throttledTypingNotification() {
  const now = Date.now()
  if (now - lastTypingSent > 1000) {
    channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { username: '张三' }
    })
    lastTypingSent = now
  }
}
```

---

## 三、Presence：在线状态管理

### 3.1 功能说明与底层机制

Presence 是 Supabase Realtime 中用于管理用户在线状态的高级功能。它可以追踪哪些用户当前在线、用户当前正在进行什么操作、用户何时加入和离开频道等信息。Presence 的底层使用了 CRDT（Conflict-free Replicated Data Type，无冲突复制数据类型）算法来处理分布式环境下的状态同步问题。

CRDT 是一种分布式数据结构，它的特点是即使在多个节点同时更新状态的情况下，也能够保证最终一致性，而不需要复杂的冲突解决机制。这使得 Presence 在网络不稳定或多个用户同时加入离开时，依然能够保持状态的准确性和一致性。

Presence 的状态数据结构是键值对形式的，每个用户可以设置任意的状态信息。这些状态信息会自动同步给频道内的所有订阅者。当用户离开（无论是正常退出还是网络断开）时，其状态会自动被清除。

### 3.2 典型应用场景

Presence 功能在许多实际场景中都有广泛应用。在在线教育平台中，教师可以看到哪些学生当前在线、正在查看哪个课程内容。在协同编辑应用中，所有协作者可以看到谁正在编辑文档的哪个部分，避免编辑冲突。在多人游戏中，Presence 可以用来管理玩家的在线状态和当前位置。在客服系统中，客服人员可以看到用户的在线状态，从而决定是否需要发送消息。

### 3.3 前端代码示例

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
)

// 创建 Presence 频道
const channel = supabase.channel('online-users', {
  config: {
    presence: {
      key: 'user-123' // 用户唯一标识，用于区分不同用户
    }
  }
})

// 监听 Presence 的各种事件
channel
  .on('presence', { event: 'sync' }, () => {
    // sync 事件在任何状态变更后触发，返回完整的当前状态
    const state = channel.presenceState()
    console.log('当前在线用户列表:', state)
    renderOnlineUsers(state)
  })
  .on('presence', { event: 'join' }, ({ key, newPresences }) => {
    // 有新用户加入频道
    console.log('用户加入:', key, newPresences)
    showToast(`${newPresences[0].username} 已上线`)
  })
  .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
    // 有用户离开频道
    console.log('用户离开:', key, leftPresences)
    showToast(`${leftPresences[0].username} 已离开`)
  })

// 订阅频道并追踪当前用户状态
channel.subscribe(async (status) => {
  if (status === 'SUBSCRIBED') {
    const presenceTrackStatus = await channel.track({
      user_id: 'user-123',
      username: '张三',
      avatar_url: 'https://example.com/avatar.jpg',
      online_at: new Date().toISOString(),
      editing_document: null,
      status: 'online' // online, busy, away
    })
    console.log('Presence 追踪状态:', presenceTrackStatus)
  }
})

// 动态更新用户状态
async function updateEditingStatus(documentId) {
  await channel.track({
    user_id: 'user-123',
    username: '张三',
    online_at: new Date().toISOString(),
    editing_document: documentId,
    status: 'editing'
  })
}

// 更新用户忙碌状态
async function setBusyStatus() {
  await channel.track({
    user_id: 'user-123',
    username: '张三',
    online_at: new Date().toISOString(),
    editing_document: null,
    status: 'busy'
  })
}

// 页面卸载时取消追踪
window.addEventListener('beforeunload', () => {
  channel.untrack()
})

// 渲染在线用户列表的示例函数
function renderOnlineUsers(state) {
  const container = document.getElementById('online-users')
  container.innerHTML = ''

  for (const [key, presences] of Object.entries(state)) {
    presences.forEach(presence => {
      const userEl = document.createElement('div')
      userEl.className = `user-status ${presence.status}`
      userEl.innerHTML = `
        <img src="${presence.avatar_url}" class="avatar" />
        <span class="username">${presence.username}</span>
        <span class="status-indicator">${presence.status}</span>
        ${presence.editing_document
          ? `<span class="editing">编辑中: ${presence.editing_document}</span>`
          : ''
        }
      `
      container.appendChild(userEl)
    })
  }
}
```

### 3.4 Laravel 后端的 Presence 管理

虽然 Presence 的核心逻辑在前端，但 Laravel 后端有时也需要查询当前的在线状态。例如，在管理后台显示当前在线用户数量，或者根据在线用户数量动态调整服务器资源。

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class SupabasePresenceService
{
    private string $url;
    private string $serviceRoleKey;

    public function __construct()
    {
        $this->url = config('services.supabase.url');
        $this->serviceRoleKey = config('services.supabase.service_role_key');
    }

    /**
     * 查询频道内的在线 Presence 列表
     *
     * @param string $channelName 频道名称
     * @return array 在线用户列表
     */
    public function getPresence(string $channelName): array
    {
        $cacheKey = "presence:{$channelName}";

        // 缓存 5 秒，避免频繁请求
        return Cache::remember($cacheKey, 5, function () use ($channelName) {
            $response = Http::withHeaders([
                'apikey' => $this->serviceRoleKey,
                'Authorization' => "Bearer {$this->serviceRoleKey}",
            ])->get("{$this->url}/realtime/v1/api/presence", [
                'channel' => $channelName,
            ]);

            return $response->json() ?? [];
        });
    }

    /**
     * 获取频道内的在线用户数量
     */
    public function getOnlineCount(string $channelName): int
    {
        $presence = $this->getPresence($channelName);
        return count($presence);
    }
}
```

---

## 四、Postgres Changes：数据库变更实时推送

### 4.1 功能说明与核心原理

Postgres Changes 是 Supabase Realtime 中最强大也最具特色的功能。它利用 PostgreSQL 的逻辑复制（Logical Replication）机制，监听数据库表的 INSERT、UPDATE、DELETE 操作，并将这些变更实时推送给订阅了相应频道的客户端。

这是 Supabase Realtime 与其他实时推送方案最本质的区别。使用 Pusher 或 Ably 时，你需要在应用代码中手动调用广播函数来触发推送——每当有数据变更，你都需要编写额外的代码来发送通知。而使用 Postgres Changes，你只需正常操作数据库，所有的变更都会自动被捕获并推送。这不仅简化了代码逻辑，还降低了遗漏推送的风险。

PostgreSQL 的逻辑复制工作原理如下：当数据库发生写入操作时，变更信息会被记录到 WAL（Write-Ahead Log，预写日志）中。逻辑复制通过读取 WAL 中的变更记录，并将其转化为逻辑变更事件（INSERT、UPDATE、DELETE），然后传递给订阅者。Supabase Realtime Server 就是这些订阅者之一，它将接收到的变更事件通过 WebSocket 推送给前端客户端。

### 4.2 适用场景分析

Postgres Changes 特别适合以下场景：

**实时数据仪表盘**：当数据库中的业务数据发生变化时，仪表盘上的图表和指标可以自动更新，无需手动刷新。这对于运营监控、销售看板等场景非常有用。

**库存变更通知**：在电商系统中，商品库存的变化可以通过 Postgres Changes 实时推送给相关页面，确保用户看到的库存信息始终是最新的。

**订单状态实时更新**：当后台管理系统更新了订单状态，客户前端可以立即收到通知并更新界面，提升用户体验。

**多人协同编辑**：在协同编辑场景中，当一个用户修改了文档内容并保存到数据库后，其他用户可以立即看到变更，实现真正的实时协作。

**审计日志实时流**：在安全审计场景中，数据库的操作记录可以通过 Postgres Changes 实时推送到审计面板，帮助安全团队及时发现异常行为。

### 4.3 前端代码示例

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
)

// 监听整个表的所有变更
const changes = supabase
  .channel('db-changes')
  .on(
    'postgres_changes',
    {
      event: '*',           // * 表示所有事件，也可以是 INSERT/UPDATE/DELETE
      schema: 'public',
      table: 'orders'
    },
    (payload) => {
      console.log('数据库变更:', payload)
      handleOrderChange(payload)
    }
  )
  .subscribe()

// 只监听新增记录
const insertOnly = supabase
  .channel('new-products')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'products'
    },
    (payload) => {
      console.log('新商品上架:', payload.new)
      showToast(`新商品: ${payload.new.name}`)
    }
  )
  .subscribe()

// 带过滤条件的监听：只关注特定用户的订单变更
const filteredChanges = supabase
  .channel('my-orders')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: 'user_id=eq.user-123' // 只监听 user_id 等于 'user-123' 的行
    },
    (payload) => {
      console.log('我的订单状态变更:', payload.new)
      updateOrderStatusUI(payload.new)
    }
  )
  .subscribe()

// 事件回调的 payload 结构说明：
// {
//   commit_timestamp: '2024-01-15T10:30:00Z',  // 变更发生的时间戳
//   eventType: 'INSERT',                         // 事件类型
//   new: { id: 1, name: '商品A', price: 99.9 }, // INSERT/UPDATE 时包含新行数据
//   old: { id: 1 },                              // DELETE/UPDATE 时包含旧行数据
//   schema: 'public',                            // 表所在的 schema
//   table: 'products',                           // 表名
//   errors: null                                 // 错误信息
// }
```

### 4.4 PostgreSQL 前置条件配置

要使用 Postgres Changes 功能，需要确保 PostgreSQL 的相关配置正确。如果你使用的是 Supabase 托管服务，大部分配置已经自动完成。但如果是自托管或使用其他 PostgreSQL 实例，需要手动配置：

```sql
-- 第一步：确保 wal_level 设置为 logical
-- 这个配置通常需要在 postgresql.conf 中修改，或者通过 ALTER SYSTEM 设置
ALTER SYSTEM SET wal_level = 'logical';

-- 第二步：设置 REPLICA IDENTITY
-- DEFAULT 模式只记录主键值，UPDATE/DELETE 事件中只包含主键信息
-- FULL 模式记录所有列值，可以获取完整的旧行数据
ALTER TABLE orders REPLICA IDENTITY FULL;

-- 第三步：将表添加到 Realtime publication
-- Supabase 托管服务中，publication 名称为 supabase_realtime
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE order_status_history;

-- 验证配置
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
SELECT relname, relreplident FROM pg_class WHERE relname = 'orders';
```

`REPLICA IDENTITY` 的设置对 Postgres Changes 的行为有重要影响。默认情况下（`DEFAULT` 模式），UPDATE 和 DELETE 事件的 `old` 字段只包含主键信息。如果你需要获取完整的旧行数据来比较变更前后的差异，必须将 `REPLICA IDENTITY` 设置为 `FULL`。但请注意，`FULL` 模式会增加 WAL 日志的大小，对于字段很多的宽表来说可能会有性能影响。

### 4.5 Laravel 后端的自然集成

这是 Laravel 与 Supabase Realtime 集成的最优雅方式——你只需正常操作数据库，Realtime 自动推送。这种"零侵入"的集成方式意味着你不需要修改现有的 Laravel 业务代码，不需要在每个数据变更点添加推送逻辑。

```php
<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderStatusHistory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class OrderService
{
    /**
     * 更新订单状态
     *
     * 写入数据库后，订阅了 Postgres Changes 的客户端会自动收到推送。
     * 你不需要在这里添加任何推送代码，Supabase Realtime 会自动处理。
     *
     * @param Order $order 要更新的订单
     * @param string $status 新状态
     * @param string|null $note 备注
     * @return Order 更新后的订单
     */
    public function updateStatus(Order $order, string $status, ?string $note = null): Order
    {
        $oldStatus = $order->status;

        // 使用数据库事务确保数据一致性
        DB::transaction(function () use ($order, $status, $oldStatus, $note) {
            $order->update([
                'status' => $status,
                'updated_at' => now(),
            ]);

            // 记录状态变更历史
            $order->statusHistory()->create([
                'old_status' => $oldStatus,
                'new_status' => $status,
                'changed_by' => auth()->user()?->name ?? 'system',
                'note' => note,
            ]);
        });

        // 事务提交后，Postgres Changes 会自动推送以下变更：
        // 1. orders 表的 UPDATE 事件（status 字段变更）
        // 2. order_status_history 表的 INSERT 事件（新历史记录）

        Log::info('订单状态已更新', [
            'order_id' => $order->id,
            'old_status' => $oldStatus,
            'new_status' => $status,
        ]);

        return $order->fresh();
    }

    /**
     * 批量更新商品库存
     *
     * 每次 UPDATE 操作都会触发 Postgres Changes 推送。
     * 如果批量操作频繁，建议在前端使用防抖机制处理。
     */
    public function updateStock(array $items): void
    {
        DB::transaction(function () use ($items) {
            foreach ($items as $item) {
                DB::table('products')
                    ->where('id', $item['product_id'])
                    ->where('stock', '>=', $item['quantity'])
                    ->decrement('stock', $item['quantity']);
            }
        });
    }
}
```

### 4.6 前端处理 Postgres Changes 的生产级封装

在实际项目中，直接使用 Supabase 的原始 API 可能会显得繁琐且容易出错。下面是一个生产级的封装示例，包含了防抖、批量处理、错误重连等高级特性：

```javascript
class RealtimeManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient
    this.channels = new Map()
    this.listeners = new Map()
  }

  /**
   * 订阅表变更，支持防抖和批量处理
   *
   * @param {string} tableName 表名
   * @param {object} options 配置选项
   * @returns {object} 频道对象
   */
  subscribeTable(tableName, options = {}) {
    const {
      event = '*',
      schema = 'public',
      filter = null,
      onInsert = null,
      onUpdate = null,
      onDelete = null,
      onChange = null,
      batchInterval = 100, // 批量处理间隔（毫秒）
      onError = null,
    } = options

    let pendingChanges = []
    let batchTimer = null

    // 构建订阅配置
    const channelConfig = { event, schema, table: tableName }
    if (filter) channelConfig.filter = filter

    // 生成唯一频道名称
    const channelName = `db-${tableName}-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const channel = this.supabase
      .channel(channelName)
      .on('postgres_changes', channelConfig, (payload) => {
        // 收集变更到批量队列
        pendingChanges.push(payload)

        // 使用防抖策略，将短时间内的多个变更合并处理
        if (!batchTimer) {
          batchTimer = setTimeout(() => {
            this.processBatch([...pendingChanges], {
              onInsert, onUpdate, onDelete, onChange
            })
            pendingChanges = []
            batchTimer = null
          }, batchInterval)
        }
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`已订阅表: ${tableName}`)
        }
        if (status === 'CHANNEL_ERROR') {
          console.error(`频道错误: ${tableName}`, err)
          onError?.(err)
        }
        if (status === 'TIMED_OUT') {
          console.warn(`订阅超时: ${tableName}`)
          onError?.(new Error('Channel subscription timed out'))
        }
      })

    this.channels.set(tableName, channel)
    return channel
  }

  /**
   * 批量处理变更事件
   */
  processBatch(changes, handlers) {
    changes.forEach(payload => {
      // 触发通用变更回调
      handlers.onChange?.(payload)

      // 根据事件类型触发特定回调
      switch (payload.eventType) {
        case 'INSERT':
          handlers.onInsert?.(payload.new, payload)
          break
        case 'UPDATE':
          handlers.onUpdate?.(payload.new, payload.old, payload)
          break
        case 'DELETE':
          handlers.onDelete?.(payload.old, payload)
          break
      }
    })
  }

  /**
   * 取消订阅指定表
   */
  unsubscribe(tableName) {
    const channel = this.channels.get(tableName)
    if (channel) {
      this.supabase.removeChannel(channel)
      this.channels.delete(tableName)
      console.log(`已取消订阅: ${tableName}`)
    }
  }

  /**
   * 取消所有订阅
   */
  unsubscribeAll() {
    for (const [name, channel] of this.channels) {
      this.supabase.removeChannel(channel)
    }
    this.channels.clear()
    console.log('已取消所有订阅')
  }

  /**
   * 获取当前活跃频道数量
   */
  getActiveChannelCount() {
    return this.channels.size
  }
}

// 使用示例
const manager = new RealtimeManager(supabase)

// 订单表变更监听
manager.subscribeTable('orders', {
  event: 'UPDATE',
  filter: 'user_id=eq.current-user-id',
  batchInterval: 200,
  onUpdate: (newOrder, oldOrder, payload) => {
    if (newOrder.status !== oldOrder.status) {
      showNotification(`订单 ${newOrder.id.slice(0, 8)} 状态变更为: ${newOrder.status}`)
    }
    if (newOrder.total_amount !== oldOrder.total_amount) {
      showNotification(`订单金额已更新: ${newOrder.total_amount}`)
    }
  },
  onError: (err) => {
    console.error('订单监听出错:', err)
    // 可以在这里实现重连逻辑
  }
})

// 商品库存监听
manager.subscribeTable('products', {
  event: 'UPDATE',
  onUpdate: (newProduct, oldProduct) => {
    if (oldProduct.stock > 0 && newProduct.stock === 0) {
      showToast(`${newProduct.name} 已售罄`)
    }
  }
})

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  manager.unsubscribeAll()
})
```

---

## 五、完整架构设计：Laravel + Supabase Realtime 深度集成

### 5.1 架构设计原则

在设计 Laravel 与 Supabase Realtime 的集成架构时，应遵循以下几个核心原则：

**关注点分离**：Laravel 负责业务逻辑、数据验证、认证授权和 REST API，Supabase Realtime 负责实时推送。两者通过 PostgreSQL 数据库连接，互不耦合。

**单一数据源**：PostgreSQL 是唯一的事实来源（Single Source of Truth）。所有数据变更都通过 Laravel 写入 PostgreSQL，然后由 Supabase Realtime 自动推送给前端。这避免了数据不一致的问题。

**最小权限原则**：前端使用 anon key 和 RLS 策略访问数据，Laravel 后端使用 service role key 操作数据。确保每个组件只拥有完成其功能所需的最小权限。

### 5.2 系统架构全景图

```
┌──────────────────────────────────────────────────────────────┐
│                        客户端（浏览器/APP）                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Vue/React  │  │  Supabase   │  │  Realtime UI        │  │
│  │  App Logic  │  │  JS Client  │  │  (通知/状态/数据流)   │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────┘  │
│         │                │                                    │
│         │ HTTP           │ WebSocket                          │
└─────────┼────────────────┼────────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────┐  ┌──────────────────┐
│   Laravel API   │  │  Supabase        │
│   (REST/GraphQL)│  │  Realtime Server │
│                 │  │  (Elixir/BEAM)   │
│  ┌───────────┐  │  └────────┬─────────┘
│  │  Eloquent │  │           │
│  │  Models   │  │           │ Logical Replication
│  └─────┬─────┘  │           │
│        │        │           │
│        ▼        │           ▼
│  ┌──────────────┴───────────────┐
│  │        PostgreSQL             │
│  │   (Supabase Hosted / Self)   │
│  └──────────────────────────────┘
└─────────────────┘
```

在这个架构中，数据流分为两个路径：

**写入路径（HTTP）**：前端通过 HTTP 请求调用 Laravel API，Laravel 处理业务逻辑并写入 PostgreSQL。这是传统的请求-响应模式。

**推送路径（WebSocket）**：PostgreSQL 的变更通过逻辑复制推送给 Supabase Realtime Server，Realtime Server 再通过 WebSocket 推送给前端。这是实时推送模式。

两条路径互不干扰，但通过 PostgreSQL 数据库保持数据一致性。这种设计使得 Laravel 后端可以完全保持传统的 REST API 风格，不需要引入 WebSocket 或事件驱动的复杂性。

### 5.3 认证集成方案详解

认证是 Laravel 与 Supabase 集成中最关键的环节之一。下面介绍两种主流的认证集成方案：

#### 5.3.1 方案一：Laravel Sanctum + 自定义 Supabase JWT

这种方案适用于使用 Laravel 自有认证系统的项目。Laravel 负责用户认证，生成 Supabase 兼容的 JWT Token 供前端使用。

```php
<?php

namespace App\Services;

use App\Models\User;
use Firebase\JWT\JWT;

class SupabaseJwtService
{
    /**
     * 为 Laravel 用户生成 Supabase 兼容的 JWT Token
     *
     * 前端使用此 Token 连接 Supabase Realtime，
     * Realtime Server 会根据 Token 中的信息应用 RLS 策略。
     *
     * @param User $user Laravel 用户模型
     * @return string JWT Token
     */
    public function generateToken(User $user): string
    {
        $now = now();

        $payload = [
            'sub' => (string) $user->id,              // 用户唯一标识
            'email' => $user->email,                    // 用户邮箱
            'role' => 'authenticated',                  // Supabase 角色
            'aud' => 'authenticated',                   // 受众
            'iat' => $now->timestamp,                   // 签发时间
            'exp' => $now->addHours(24)->timestamp,     // 过期时间
            'user_metadata' => [                        // 自定义用户元数据
                'name' => $user->name,
                'avatar' => $user->avatar,
                'role' => $user->role,
            ],
        ];

        return JWT::encode(
            $payload,
            config('services.supabase.jwt_secret'),
            'HS256'
        );
    }
}
```

Token 获取端点：

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SupabaseJwtService;
use Illuminate\Http\JsonResponse;

class SupabaseTokenController extends Controller
{
    /**
     * 获取 Supabase Realtime 连接所需的 JWT Token
     *
     * 前端在初始化 Supabase 客户端时调用此接口获取 Token，
     * 然后使用该 Token 建立 WebSocket 连接。
     */
    public function __invoke(SupabaseJwtService $jwtService): JsonResponse
    {
        $user = auth()->user();

        if (!$user) {
            return response()->json(['error' => '未认证'], 401);
        }

        $token = $jwtService->generateToken($user);

        return response()->json([
            'access_token' => $token,
            'token_type' => 'bearer',
            'expires_in' => 86400,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
        ]);
    }
}
```

#### 5.3.2 方案二：使用 Supabase Auth + Laravel 验证

如果你选择使用 Supabase Auth 进行用户认证，可以在 Laravel 中验证 Supabase 签发的 JWT Token：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Firebase\JWT\ExpiredException;

class VerifySupabaseToken
{
    /**
     * 验证 Supabase JWT Token 的中间件
     *
     * 从请求中提取 Bearer Token，使用 Supabase 的 JWT Secret 验证其有效性，
     * 并将解码后的用户信息注入到请求对象中。
     */
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json(['error' => '未提供认证 Token'], 401);
        }

        try {
            $decoded = JWT::decode(
                $token,
                new Key(config('services.supabase.jwt_secret'), 'HS256')
            );

            // 验证 audience 字段
            if ($decoded->aud !== 'authenticated') {
                return response()->json(['error' => 'Token 受众无效'], 401);
            }

            // 将 Supabase 用户信息注入请求
            $request->merge([
                'supabase_user' => [
                    'id' => $decoded->sub,
                    'email' => $decoded->email,
                    'metadata' => $decoded->user_metadata ?? null,
                ]
            ]);

            return $next($request);

        } catch (ExpiredException $e) {
            return response()->json(['error' => 'Token 已过期，请重新登录'], 401);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Token 无效'], 401);
        }
    }
}
```

### 5.4 行级安全（RLS）配置

RLS 是 Supabase 安全模型的核心。通过 RLS 策略，你可以精确控制哪些用户可以访问哪些数据行。对于 Realtime 来说，RLS 确保用户只能接收到他们有权查看的数据变更。

```sql
-- 启用 RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 策略 1：用户只能查看自己的订单
CREATE POLICY "Users can view own orders"
ON orders FOR SELECT
USING (auth.uid()::text = user_id);

-- 策略 2：用户只能创建属于自己的订单
CREATE POLICY "Users can create own orders"
ON orders FOR INSERT
WITH CHECK (auth.uid()::text = user_id);

-- 策略 3：用户只能更新自己的订单（且只能更新特定字段）
CREATE POLICY "Users can update own orders"
ON orders FOR UPDATE
USING (auth.uid()::text = user_id)
WITH CHECK (auth.uid()::text = user_id);

-- 对于管理后台，创建一个绕过 RLS 的角色
-- Laravel 后端使用 service_role key 连接，自动绕过 RLS
-- 前端使用 anon key 连接，受 RLS 策略约束
```

---

## 六、与 Laravel Echo / Pusher / Ably 的全面对比

### 6.1 功能特性对比

选择实时推送方案时，了解各个方案的优劣至关重要。以下是 Supabase Realtime 与 Laravel 生态中其他主流方案的详细对比：

| 特性 | Supabase Realtime | Laravel Echo + Pusher | Laravel Echo + Ably |
|------|-------------------|----------------------|---------------------|
| **WebSocket 支持** | ✅ 原生支持 | ✅ 原生支持 | ✅ 原生支持 |
| **数据库变更监听** | ✅ Postgres Changes（原生） | ❌ 需手动调用 broadcast() | ❌ 需手动调用 broadcast() |
| **Presence 功能** | ✅ 内置 CRDT | ✅ Pusher Presence Channel | ✅ 内置 Presence |
| **自定义广播** | ✅ Broadcast API | ✅ Channel Broadcasting | ✅ Channel Broadcasting |
| **与 Laravel 集成** | 需手动集成 | ✅ 原生支持（开箱即用） | ✅ 原生支持 |
| **行级安全（RLS）** | ✅ 原生集成 | ❌ 不支持 | ❌ 不支持 |
| **自托管能力** | ✅ 开源可自托管 | ❌ Pusher 是 SaaS 服务 | ❌ Ably 是 SaaS 服务 |
| **免费额度** | 200-500 连接，200MB 数据传输 | 200K 消息/天，100 连接 | 6M 消息/月，100 连接 |
| **消息延迟** | 通常 <100ms | 通常 <100ms | 通常 <100ms |
| **SDK 生态** | JS/Flutter/Swift/Kotlin | JS/iOS/Android（通过 Echo） | 多语言 SDK |

### 6.2 架构复杂度对比

**方案 A：Laravel Echo + Pusher 的数据流**

```
浏览器 ──WebSocket──▶ Pusher 服务器
                         ▲
                    手动触发广播
                         │
                    Laravel ──▶ MySQL
```

在这种架构中，每当数据库有变更时，你需要在 Laravel 代码中手动调用 `broadcast()` 函数。这意味着你必须在每个数据变更点都添加推送逻辑，增加了代码量和出错的可能性。

**方案 B：Supabase Realtime 的数据流**

```
浏览器 ──WebSocket──▶ Supabase Realtime ──Logical Repl.──▶ PostgreSQL
                                                          ▲
                                                     Laravel（写入）
```

在这种架构中，Laravel 只需要正常写入数据库，Supabase Realtime 通过逻辑复制自动捕获变更并推送。代码更简洁，逻辑更清晰。

### 6.3 成本对比分析

对于中小型项目，成本往往是技术选型的重要考量因素：

**Pusher**：免费计划提供每天 200,000 条消息和 100 个并发连接。超出后按消息量计费，标准计划从 $49/月起。

**Ably**：免费计划提供每月 6,000,000 条消息和 100 个并发连接。超出后按消息量和连接数计费。

**Supabase Realtime**：免费计划提供 200 个并发 Realtime 连接和 200MB 数据传输。Pro 计划 $25/月提供 500 个连接和 5GB 数据传输，同时还包含数据库、存储、Auth 等其他功能。

从性价比角度看，Supabase 的 Pro 计划不仅提供 Realtime 功能，还包含了完整的 BaaS 套件，对于需要一站式解决方案的项目来说非常划算。

### 6.4 选择建议

**选择 Supabase Realtime 的场景**：
- 项目已使用或计划使用 Supabase 作为后端
- 需要监听数据库变更的实时推送（核心需求）
- 需要行级安全控制
- 预算有限，希望最大化免费额度
- 需要自托管能力

**选择 Laravel Echo + Pusher/Ably 的场景**：
- 已有成熟的 Pusher/Ably 基础设施和付费计划
- 团队对 Laravel Echo 生态非常熟悉
- 需要复杂的频道授权逻辑（Pusher 的 Private Channel 机制更成熟）
- 对连接数和消息量有极高要求
- 不使用 PostgreSQL 数据库

**混合方案**：实际项目中，两种方案可以并存。数据库变更通过 Supabase Postgres Changes 推送，自定义业务事件通过 Laravel Echo 广播。这样既能享受 Postgres Changes 的自动化便利，又能利用 Laravel Echo 的成熟生态。

---

## 七、生产环境注意事项与最佳实践

### 7.1 连接管理与资源优化

Supabase 的每个计划都有连接数限制，合理管理连接资源至关重要。在实际项目中，应该避免为每个数据需求创建独立的频道连接，而是尽量复用频道，通过过滤器来区分不同的数据订阅需求。

一个常见的错误是在组件挂载时创建订阅、在组件卸载时取消订阅，但如果页面中有大量组件，可能会导致连接数超出限制。更好的做法是集中管理所有 Realtime 连接，使用单例模式或状态管理库来协调不同组件的订阅需求。

对于大型应用，建议实现一个连接池管理器，统一管理所有 Realtime 频道的创建、复用和销毁。当连接数接近限制时，优先保留高优先级的订阅，临时挂起低优先级的订阅。

### 7.2 网络断线重连策略

WebSocket 连接可能因网络波动而断开，实现可靠的重连机制是生产环境的基本要求。推荐使用指数退避（Exponential Backoff）策略来实现重连：

```javascript
class ResilientRealtime {
  constructor(supabaseClient) {
    this.supabase = supabaseClient
    this.subscriptions = []
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.baseDelay = 1000 // 基础延迟 1 秒
    this.maxDelay = 30000 // 最大延迟 30 秒
  }

  /**
   * 计算指数退避延迟时间
   */
  getBackoffDelay() {
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.reconnectAttempts),
      this.maxDelay
    )
    // 添加随机抖动，避免多个客户端同时重连造成雪崩
    const jitter = delay * 0.1 * Math.random()
    return delay + jitter
  }

  /**
   * 带重连逻辑的订阅方法
   */
  subscribeWithRetry(channel, config, callback) {
    const doSubscribe = () => {
      const ch = this.supabase
        .channel(channel)
        .on('postgres_changes', config, callback)
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            this.reconnectAttempts = 0
            console.log(`Realtime 连接成功: ${channel}`)
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`Realtime 连接异常: ${channel}, 状态: ${status}`)
            this.scheduleReconnect(channel, config, callback)
          }
        })

      return ch
    }

    return doSubscribe()
  }

  /**
   * 安排重连
   */
  scheduleReconnect(channel, config, callback) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('达到最大重连次数，停止重连。请检查网络连接或 Supabase 服务状态。')
      // 可以在这里触发用户通知或降级方案
      this.onReconnectFailed?.()
      return
    }

    const delay = this.getBackoffDelay()
    this.reconnectAttempts++

    console.log(`${Math.round(delay / 1000)}秒后尝试第${this.reconnectAttempts}次重连...`)

    setTimeout(() => {
      this.subscribeWithRetry(channel, config, callback)
    }, delay)
  }
}
```

### 7.3 性能优化策略

**1. 使用过滤器减少数据传输量**

在订阅 Postgres Changes 时，始终使用过滤器来缩小数据范围。监听整个大表的所有变更会产生大量不必要的网络流量和处理开销。

```javascript
// ❌ 不推荐：监听整个大表的所有变更
channel.on('postgres_changes', {
  event: '*',
  schema: 'public',
  table: 'large_table'
}, callback)

// ✅ 推荐：使用过滤器精确匹配
channel.on('postgres_changes', {
  event: 'INSERT',
  schema: 'public',
  table: 'large_table',
  filter: 'status=eq.active'
}, callback)
```

**2. 处理高频更新的防抖策略**

当数据库表的更新频率很高时（如实时股价、传感器数据），客户端可能会收到大量的更新事件。使用防抖（debounce）或节流（throttle）机制来控制 UI 更新频率，避免界面卡顿。

```javascript
function debounce(callback, delay = 300) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => callback(...args), delay)
  }
}

// 使用防抖处理高频更新
const debouncedUpdate = debounce((payload) => {
  updateUI(payload.new)
}, 500)

channel.on('postgres_changes', {
  event: 'UPDATE',
  schema: 'public',
  table: 'frequently_updated_table'
}, debouncedUpdate)
```

**3. 页面可见性管理**

当用户将页面切换到后台标签页时，可以暂停 Realtime 订阅以节省资源。当用户切换回来时，重新激活订阅并获取最新的数据快照。

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 页面隐藏：取消订阅，节省连接资源
    manager.unsubscribeAll()
  } else {
    // 页面可见：重新订阅，并获取最新数据快照
    fetchLatestData() // HTTP 请求获取最新数据
    setupSubscriptions() // 重新建立 Realtime 订阅
  }
})
```

### 7.4 监控与调试

在生产环境中，建立完善的监控体系可以帮助你及时发现和解决问题：

```javascript
// 启用 Supabase 日志
const supabase = createClient(url, key, {
  realtime: {
    params: {
      log_level: 'info' // 可选: debug, info, warn, error
    }
  }
})

// 监控连接状态
supabase.realtime.onOpen(() => {
  console.log('[Realtime] WebSocket 连接已建立')
  metrics.recordConnection() // 上报连接指标
})

supabase.realtime.onClose(() => {
  console.log('[Realtime] WebSocket 连接已关闭')
  metrics.recordDisconnection()
})

supabase.realtime.onError((error) => {
  console.error('[Realtime] WebSocket 错误:', error)
  metrics.recordError(error)
  alerting.notify('Realtime 连接异常', error)
})
```

建议在 Grafana 或其他监控面板中追踪以下关键指标：
- WebSocket 连接数和连接时长
- 消息接收频率和延迟
- 断线重连次数
- 频道订阅数量
- 内存使用情况

### 7.5 安全最佳实践

实时系统的安全性不容忽视。以下是几条关键的安全建议：

**始终启用 RLS**：确保 Realtime 订阅遵循行级安全策略，防止用户访问未授权的数据。在 Supabase 控制台中，可以测试 RLS 策略的有效性。

**Token 安全管理**：JWT Token 应该设置合理的过期时间（建议不超过 24 小时），并在过期前刷新。不要在前端代码中硬编码 Token 或密钥。

**敏感数据过滤**：不要通过 Realtime 推送密码、密钥、支付信息等敏感数据。可以通过数据库视图来过滤敏感字段。

**速率限制**：在前端实现 Broadcast 消息的发送频率限制，防止恶意用户通过高频发送消息来消耗资源。

**日志审计**：记录关键的实时事件（如谁在什么时间订阅了哪个频道），便于安全审计和问题排查。

```sql
-- 创建安全视图，过滤敏感字段
CREATE VIEW safe_orders AS
SELECT
    id,
    user_id,
    status,
    total_amount,
    created_at,
    updated_at
    -- 排除 payment_info, internal_notes 等敏感字段
FROM orders;

-- 启用视图的 RLS
ALTER VIEW safe_orders SET (security_invoker = true);

-- 将视图添加到 Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE safe_orders;
```

---

## 八、常见问题排查指南

### 8.1 客户端收不到 Postgres Changes 推送

这是最常见的问题，排查步骤如下：

1. **检查表是否添加到 publication**：
```sql
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

2. **检查 RLS 策略是否允许 Realtime 服务读取数据**：
在 Supabase 控制台的 SQL Editor 中测试 RLS 策略。

3. **检查 REPLICA IDENTITY 设置**：
```sql
SELECT relname, relreplident FROM pg_class WHERE relname = 'your_table';
-- 0 = default, 1 = nothing, 2 = all, 3 = index
```

4. **确认 JWT Token 中的用户身份与 RLS 策略匹配**：
解码 JWT Token，检查 `sub` 字段是否与 RLS 策略中使用的用户标识一致。

### 8.2 连接频繁断开的排查

连接频繁断开可能由多种原因造成：

- **网络不稳定**：检查客户端网络环境，实现指数退避重连机制
- **JWT Token 过期**：确保在 Token 过期前及时刷新
- **超过连接数限制**：检查当前计划的连接数上限，优化连接复用
- **防火墙或代理拦截 WebSocket**：确保防火墙允许 WSS 协议的长连接

### 8.3 性能问题的优化

如果发现 Realtime 推送延迟过高或客户端卡顿，可以从以下几个方面优化：

- 减少不必要的订阅，只订阅真正需要的数据
- 使用过滤器缩小数据范围
- 对高频更新使用防抖或节流策略
- 避免在 `sync` 回调中执行耗时操作

---

## 九、自托管 Supabase Realtime

对于需要完全控制数据和基础设施的团队，Supabase Realtime 可以自托管部署。以下是一个基本的 Docker Compose 配置示例：

```yaml
version: '3.8'

services:
  realtime:
    image: supabase/realtime:v2.25.0
    ports:
      - "4000:4000"
    environment:
      DB_HOST: your-postgres-host
      DB_NAME: postgres
      DB_USER: postgres
      DB_PASSWORD: your-password
      DB_PORT: 5432
      PORT: 4000
      JWT_SECRET: your-jwt-secret
      SECURE_CHANNELS: "true"
      SLOT_NAME: realtime_replication_slot
      TEMPORARY_SLOT: "true"
      MAX_REPLICATION_LAG_MB: 1000
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: your-password
    volumes:
      - pgdata:/var/lib/postgresql/data
    command:
      - postgres
      - -c
      - wal_level=logical
      - -c
      - max_replication_slots=5
      - -c
      - max_wal_senders=5
    restart: unless-stopped

volumes:
  pgdata:
```

自托管的优势在于完全的数据控制权和定制灵活性，但需要承担运维成本，包括服务器管理、安全更新、性能调优等工作。

---

## 十、实战踩坑案例与快速启动指南

### 10.1 踩坑案例一：REPLICA IDENTITY 设置导致 UPDATE 事件缺少旧行数据

**问题描述**：客户端订阅了 `postgres_changes` 的 `UPDATE` 事件，但回调中 `payload.old` 只有主键信息，无法比较变更前后的差异。

**原因分析**：PostgreSQL 默认的 `REPLICA IDENTITY` 是 `DEFAULT` 模式，UPDATE/DELETE 事件的 `old` 字段只包含主键值，不包含其他列的旧行数据。

**解决方案**：
```sql
-- 将表的 REPLICA IDENTITY 设置为 FULL
ALTER TABLE orders REPLICA IDENTITY FULL;

-- 验证设置是否生效
SELECT relname, relreplident FROM pg_class WHERE relname = 'orders';
-- relreplident 应显示为 'f' (full)
```

**注意事项**：`FULL` 模式会显著增加 WAL 日志大小（每行所有列都会被记录）。对于字段数超过 50 的宽表，建议在应用层只 UPDATE 需要变更的字段，避免全行写入。

### 10.2 踩坑案例二：连接风暴导致 Realtime 订阅失败

**问题描述**：页面包含 10+ 个 React 组件，每个组件独立订阅不同的 Realtime 频道，导致连接数超出 Supabase 免费计划的 200 连接限制，部分订阅报 `CHANNEL_ERROR`。

**原因分析**：每个 `supabase.channel()` 调用都会建立独立的 WebSocket 连接（或复用底层连接但增加频道数量）。在组件级别各自管理订阅会导致资源浪费和连接爆炸。

**解决方案**：
```javascript
// ❌ 错误做法：每个组件独立订阅
function OrderList() {
  useEffect(() => {
    supabase.channel('orders').on('postgres_changes', { ... }, handler).subscribe()
  }, [])
}
function ProductList() {
  useEffect(() => {
    supabase.channel('products').on('postgres_changes', { ... }, handler).subscribe()
  }, [])
}
// 10 个组件 = 10 个独立频道，连接数快速增长

// ✅ 正确做法：集中管理订阅，复用频道
// realtime-manager.js（全局单例）
const globalChannel = supabase.channel('app-global')
globalChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (p) => {
  window.dispatchEvent(new CustomEvent('order-change', { detail: p }))
})
globalChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (p) => {
  window.dispatchEvent(new CustomEvent('product-change', { detail: p }))
})
globalChannel.subscribe()

// 组件中监听自定义事件，无需各自建立连接
function OrderList() {
  useEffect(() => {
    const handler = (e) => { /* 处理订单变更 */ }
    window.addEventListener('order-change', handler)
    return () => window.removeEventListener('order-change', handler)
  }, [])
}
```

### 10.3 踩坑案例三：RLS 策略阻止 Realtime 推送

**问题描述**：Laravel 后端通过 service_role key 写入数据，但前端使用 anon key 订阅的 Realtime 推送为空。

**原因分析**：RLS 策略基于 `auth.uid()` 过滤数据，而前端的 anon key 没有对应的用户身份信息，导致所有数据行被 RLS 策略拒绝。

**解决方案**：确保前端使用有效的 Supabase JWT Token 连接 Realtime，或者为 Realtime 创建专用的 RLS 策略：
```sql
-- 为 Realtime 推送创建宽松的 SELECT 策略
CREATE POLICY "Allow realtime read for authenticated"
ON orders FOR SELECT
TO authenticated
USING (true);
```

### 10.4 踩坑案例四：Laravel Eloquent 静默属性导致 Postgres Changes 收不到变更

**问题描述**：使用 `$hidden` 或 `$appends` 隐藏字段后，数据库实际写入的值与 Eloquent 模型不一致，导致 Realtime 推送的 `payload.new` 数据与预期不符。

**原因分析**：Postgres Changes 监听的是 PostgreSQL WAL 中的原始数据，而非 Eloquent 序列化后的数据。如果 Eloquent 在 `saving` 事件中修改了属性值，Realtime 推送的仍然是修改前的数据库值。

**解决方案**：确保在 Eloquent 事件中直接操作数据库字段值（通过 `DB::table()`），而不是在模型层修改后依赖 Eloquent 自动保存。对于必须在模型层修改的场景，使用 `updateQuietly()` 确保触发数据库写入。

### 10.5 快速启动：5 分钟跑通 Supabase Realtime + Laravel

下面是完整的可运行示例，包含前端和 Laravel 后端的核心代码：

**步骤 1：安装 Supabase 客户端**
```bash
npm init -y && npm install @supabase/supabase-js
```

**步骤 2：前端订阅代码（Node.js 可直接运行）**
```javascript
// realtime-demo.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// 1. 监听 orders 表的新增订单
supabase
  .channel('demo-orders')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'orders' },
    (payload) => {
      console.log('📦 新订单:', JSON.stringify(payload.new, null, 2))
    }
  )
  .subscribe((status) => {
    console.log('频道状态:', status)
  })

// 2. 监听用户在线状态
const presenceChannel = supabase.channel('demo-online', {
  config: { presence: { key: `user-${Math.random().toString(36).slice(2, 8)}` } }
})

presenceChannel
  .on('presence', { event: 'sync' }, () => {
    const state = presenceChannel.presenceState()
    console.log('👥 在线用户:', Object.keys(state).length)
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await presenceChannel.track({ online_at: new Date().toISOString() })
    }
  })

// 3. 发送广播消息
supabase
  .channel('demo-broadcast')
  .on('broadcast', { event: 'ping' }, (payload) => {
    console.log('💬 收到广播:', payload.payload)
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await supabase.channel('demo-broadcast').send({
        type: 'broadcast',
        event: 'ping',
        payload: { message: 'Hello from demo!' }
      })
    }
  })

console.log('✅ Realtime 订阅已启动，等待事件...')
```

**步骤 3：运行**
```bash
SUPABASE_URL=https://your-project.supabase.co SUPABASE_ANON_KEY=xxx node realtime-demo.js
```

**步骤 4：Laravel 后端发送广播（在 Artisan 命令中测试）**
```php
<?php
// app/Console/Commands/TestRealtimeBroadcast.php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Env;

class TestRealtimeBroadcast extends Command
{
    protected $signature = 'realtime:test';
    protected $description = '测试 Supabase Realtime 广播发送';

    public function handle(): int
    {
        $url = Env::get('SUPABASE_URL');
        $key = Env::get('SUPABASE_SERVICE_ROLE_KEY');

        $response = Http::withHeaders([
            'apikey' => $key,
            'Authorization' => "Bearer {$key}",
        ])->post("{$url}/realtime/v1/api/broadcast", [
            'channel' => 'demo-broadcast',
            'event' => 'ping',
            'payload' => ['message' => 'Hello from Laravel!', 'time' => now()->toISOString()],
        ]);

        $this->info($response->successful() ? '✅ 广播发送成功' : '❌ 发送失败');
        return $response->successful() ? 0 : 1;
    }
}
```

```bash
php artisan realtime:test
```

运行后，前端控制台应立即输出收到的广播消息，验证 Realtime 链路畅通。

### 10.6 Supabase Realtime 三大功能速查对比表

| 维度 | Broadcast | Presence | Postgres Changes |
|------|-----------|----------|------------------|
| **数据持久化** | ❌ 不存储 | ❌ 不存储 | ✅ 写入数据库 |
| **延迟** | 极低（<50ms） | 低（<100ms） | 低-中（<200ms） |
| **适用场景** | 即时消息、光标同步、打字状态 | 在线用户列表、协作者状态 | 订单状态、库存变更、审计日志 |
| **数据来源** | 客户端发送 | 客户端 track | PostgreSQL WAL |
| **过滤能力** | 无（全量广播） | 无（全量同步） | ✅ 支持 SQL filter |
| **认证要求** | 匿名 key 可用 | 匿名 key 可用 | 需 RLS + JWT Token |
| **Laravel 集成** | 需手动调用 API | 仅前端逻辑 | 零侵入（写 DB 即推送） |
| **连接消耗** | 每频道 1 连接 | 每频道 1 连接 | 每表 1 订阅 |

---

## 十一、总结与展望

Supabase Realtime 为 Laravel 开发者提供了一种全新的实时数据推送范式。通过 Broadcast、Presence 和 Postgres Changes 三大功能，开发者可以构建从简单的消息广播到复杂的数据库变更实时推送在内的各种实时应用。

**核心优势总结**：

第一，**数据库驱动的自动化推送**。Postgres Changes 让"写数据库即推送"成为现实，大幅简化了实时逻辑的实现。你不需要在每个数据变更点手动调用推送函数，只需专注于业务逻辑的实现。

第二，**行级安全的天然集成**。PostgreSQL 的 RLS 策略与 Realtime 的无缝结合，确保了数据安全的同时实现了实时推送，这在其他方案中是难以实现的。

第三，**成本效益显著**。对于中小型项目，Supabase 的免费计划已经能够满足大部分需求。即便是付费计划，其性价比也远高于单独购买 Pusher 或 Ably 的服务。

第四，**开源与可自托管**。Supabase 完全开源，你可以选择使用托管服务，也可以自行部署，不会被供应商锁定。

**需要关注的方面**：

与 Laravel Echo 的集成不如 Pusher/Ably 那样开箱即用，需要一定的前期投入来搭建认证和配置。连接数限制需要在架构设计时提前考虑，避免上线后才发现连接资源不足。团队需要学习 Supabase 的新概念和 API，有一定的学习曲线。

展望未来，随着 Supabase 生态的不断完善和 Laravel 社区的积极探索，两者的集成将会变得更加便捷。特别是随着 Supabase Edge Functions 的成熟和服务端 SDK 的完善，Laravel 与 Supabase Realtime 的集成方案将会更加丰富和可靠。

对于新项目，特别是已经使用或计划使用 PostgreSQL 作为数据库的项目，Supabase Realtime 是一个值得认真考虑的实时方案。对于已有 Laravel Echo + Pusher 基础设施的项目，可以采用混合架构逐步迁移，在新功能中尝试 Supabase Realtime，通过渐进式的策略平滑过渡。

实时技术正在快速演进，没有一种方案能够完美适用于所有场景。理解每种方案的优劣，根据项目的具体需求、团队的技术栈和预算约束做出合适的技术选型，才是架构师的核心能力所在。希望本文能够为你的技术选型提供有价值的参考。

---

## 参考资料

- [Supabase Realtime 官方文档](https://supabase.com/docs/guides/realtime)
- [Supabase Realtime GitHub 仓库](https://github.com/supabase/realtime)
- [PostgreSQL 逻辑复制官方文档](https://www.postgresql.org/docs/current/logical-replication.html)
- [Laravel Broadcasting 文档](https://laravel.com/docs/broadcasting)
- [Supabase JavaScript Client 文档](https://supabase.com/docs/reference/javascript/introduction)
- [Supabase 行级安全指南](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Phoenix Channel 协议规范](https://hexdocs.pm/phoenix/channels.html)
- [CRDT 算法简介](https://crdt.tech/)

## 相关阅读

- [Laravel Broadcasting 深度实战：Reverb + Private Channel + Presence Channel——B2C 电商的实时通知与在线状态架构](/categories/05_PHP/Laravel/2026-06-06-Laravel-Broadcasting-Reverb-Private-Presence-Channel-B2C-Realtime-Notification/)
- [Redis Stream 实战：消息队列替代方案与消费者组管理 Laravel 踩坑记录](/categories/databases/redis-stream-guide-laravel/)
- [Laravel Database Notification 实战：用数据库驱动替代 Redis 驱动的通知系统——可审计、可查询的消息中心](/categories/05_PHP/Laravel/laravel-database-notification-auditable-message-center/)
