---
title: Cloudflare Durable Objects 实战：有状态边缘计算——对比传统 WebSocket 的会话持久化与 Laravel 实时应用
keywords: [Cloudflare Durable Objects, WebSocket, Laravel, 有状态边缘计算, 对比传统, 的会话持久化与, 实时应用, 架构]
date: 2026-06-10 01:39:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Cloudflare
  - Durable Objects
  - WebSocket
  - 边缘计算
  - 实时应用
  - Laravel
description: 深入讲解 Cloudflare Durable Objects 的核心概念、有状态边缘计算原理，与传统 WebSocket 会话持久化方案对比，并提供 Laravel 实时应用的完整集成方案与踩坑记录。
---


## 概述

传统 WebSocket 服务面临一个根本性问题：**连接有状态，但服务器无状态**。当客户端断线重连、服务器重启、或负载均衡切换节点时，会话状态就丢失了。你不得不引入 Redis、Memcached 等外部存储来持久化会话——这增加了架构复杂度和延迟。

Cloudflare Durable Objects（DO）从根本上解决了这个问题：**每个对象自带持久化存储，天然有状态**。它运行在 Cloudflare 的边缘网络上，延迟极低，且不需要你自己管理状态同步。

本文将：
1. 深入解析 Durable Objects 的核心架构
2. 与传统 WebSocket + Redis 方案做详细对比
3. 提供完整的 Laravel 集成方案
4. 记录生产环境中的踩坑经验

## 核心概念

### Durable Objects 是什么

Durable Objects 是 Cloudflare Workers 的扩展，每个 DO 实例是一个**单线程、有状态、可持久化**的 JavaScript 对象。它的核心特性：

- **全局唯一 ID**：每个 DO 有一个唯一的 `objectId`，客户端通过 ID 路由到同一个实例
- **单线程保证**：同一个 DO 的所有请求串行执行，无需加锁
- **内置存储**：每个 DO 自带 10GB 持久化存储（KV 存储 + SQL 存储）
- **WebSocket 原生支持**：DO 可以持有 WebSocket 连接，连接断开后状态不丢失
- **边缘运行**：在 Cloudflare 的 300+ 数据中心运行，延迟极低

### 架构对比

```
传统 WebSocket 方案：
┌──────────┐     ┌──────────────┐     ┌─────────┐
│  Client  │────▶│  WS Server   │────▶│  Redis  │
│          │     │  (Node/Go)   │     │  (会话)  │
└──────────┘     └──────────────┘     └─────────┘
                       │
                  负载均衡 / 多实例
                  需要 session 同步

Durable Objects 方案：
┌──────────┐     ┌─────────────────────────┐
│  Client  │────▶│  Cloudflare Edge        │
│          │     │  ┌───────────────────┐  │
│          │     │  │ Durable Object    │  │
│          │     │  │ (连接 + 存储)      │  │
│          │     │  └───────────────────┘  │
└──────────┘     └─────────────────────────┘
                       无外部依赖
                       天然有状态
```

### 关键 API

```javascript
// 1. 创建 DO 类
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  // 2. 处理请求
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      return this.handleWebSocket(request);
    }

    if (url.pathname === '/state') {
      return this.getState();
    }

    return new Response('Not Found', { status: 404 });
  }

  // 3. 处理 WebSocket 升级
  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    await this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // 4. 管理会话
  async handleSession(ws) {
    ws.accept();

    const id = crypto.randomUUID();
    this.sessions.set(id, { ws, connectedAt: Date.now() });

    ws.addEventListener('close', () => {
      this.sessions.delete(id);
    });

    ws.addEventListener('message', async (event) => {
      const data = JSON.parse(event.data);
      await this.processMessage(id, data);
    });
  }

  // 5. 处理消息并持久化
  async processMessage(senderId, data) {
    // 写入持久化存储
    await this.state.storage.put(`msg:${Date.now()}`, {
      sender: senderId,
      content: data.content,
      timestamp: Date.now(),
    });

    // 广播给所有连接的客户端
    for (const [id, session] of this.sessions) {
      if (id !== senderId) {
        session.ws.send(JSON.stringify({
          type: 'message',
          sender: senderId,
          content: data.content,
        }));
      }
    }
  }

  // 6. 从存储恢复状态
  async getState() {
    const keys = await this.state.storage.list({ prefix: 'msg:' });
    const messages = [];
    for (const key of keys) {
      messages.push(await this.state.storage.get(key));
    }
    return Response.json({ messages, activeSessions: this.sessions.size });
  }
}
```

### 绑定路由

```javascript
// wrangler.toml 或 src/index.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 通过 URL 路径获取 DO 实例
    // 例如：/chat/room-123 会路由到 objectId 为 "room-123" 的 DO
    if (url.pathname.startsWith('/chat/')) {
      const roomId = url.pathname.split('/')[2];
      const id = env.CHAT_ROOM.idFromName(roomId);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

## 实战：Laravel 集成 Durable Objects

### 场景：实时协作白板

假设我们要做一个实时协作白板应用，用户可以在 Canvas 上画图，其他用户实时看到。

### 第一步：创建 Durable Object Worker

```javascript
// whiteboard-worker/src/index.js
export class Whiteboard {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.state.blockConcurrencyWhile(async () => {
      // 启动时从存储恢复状态
      this.drawingData = await this.state.storage.get('drawingData') || [];
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      return this.handleWebSocket(request);
    }

    if (url.pathname === '/state') {
      return Response.json({
        drawingData: this.drawingData,
        activeUsers: this.sessions.size,
      });
    }

    // REST API：获取历史数据
    if (url.pathname === '/history' && request.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const data = this.drawingData.slice(-limit);
      return Response.json({ data, total: this.drawingData.length });
    }

    return new Response('Not Found', { status: 404 });
  }

  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    server.accept();
    const userId = crypto.randomUUID();

    this.sessions.set(userId, {
      ws: server,
      connectedAt: Date.now(),
      cursor: null,
    });

    // 发送当前状态给新用户
    server.send(JSON.stringify({
      type: 'init',
      drawingData: this.drawingData,
      activeUsers: this.sessions.size,
      userId,
    }));

    // 广播用户加入
    this.broadcast({
      type: 'user_joined',
      userId,
      activeUsers: this.sessions.size,
    }, userId);

    server.addEventListener('message', async (event) => {
      const data = JSON.parse(event.data);
      await this.handleMessage(userId, data);
    });

    server.addEventListener('close', () => {
      this.sessions.delete(userId);
      this.broadcast({
        type: 'user_left',
        userId,
        activeUsers: this.sessions.size,
      });
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(userId, data) {
    switch (data.type) {
      case 'draw': {
        const entry = {
          userId,
          points: data.points,
          color: data.color,
          width: data.width,
          timestamp: Date.now(),
        };

        this.drawingData.push(entry);

        // 持久化：每 50 条保存一次
        if (this.drawingData.length % 50 === 0) {
          await this.state.storage.put('drawingData', this.drawingData);
        }

        // 广播给其他人
        this.broadcast({
          type: 'draw',
          entry,
        }, userId);
        break;
      }

      case 'cursor': {
        const session = this.sessions.get(userId);
        if (session) {
          session.cursor = { x: data.x, y: data.y };
        }
        this.broadcast({
          type: 'cursor',
          userId,
          x: data.x,
          y: data.y,
        }, userId);
        break;
      }

      case 'clear': {
        this.drawingData = [];
        await this.state.storage.put('drawingData', []);
        this.broadcast({ type: 'clear' });
        break;
      }

      case 'undo': {
        // 移除最后一条该用户的操作
        const lastIdx = this.drawingData.findLastIndex(
          (d) => d.userId === userId
        );
        if (lastIdx !== -1) {
          this.drawingData.splice(lastIdx, 1);
          await this.state.storage.put('drawingData', this.drawingData);
          this.broadcast({ type: 'undo', index: lastIdx });
        }
        break;
      }
    }
  }

  broadcast(data, excludeUserId = null) {
    const message = JSON.stringify(data);
    for (const [id, session] of this.sessions) {
      if (id !== excludeUserId) {
        session.ws.send(message);
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/board/')) {
      const boardId = url.pathname.split('/')[2];
      const id = env.WHITEBOARD.idFromName(boardId);
      const stub = env.WHITEBOARD.get(id);
      return stub.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

### 第二步：wrangler 配置

```toml
# wrangler.toml
name = "whiteboard-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "WHITEBOARD", class_name = "Whiteboard" }
]

[[migrations]]
tag = "v1"
new_classes = ["Whiteboard"]
```

### 第三步：Laravel 后端集成

```php
// app/Http/Controllers/WhiteboardController.php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class WhiteboardController extends Controller
{
    private string $workerUrl;
    private string $apiToken;

    public function __construct()
    {
        $this->workerUrl = config('services.cloudflare.worker_url');
        $this->apiToken = config('services.cloudflare.api_token');
    }

    /**
     * 获取白板历史数据
     */
    public function history(string $boardId)
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiToken}",
        ])->get("{$this->workerUrl}/board/{$boardId}/state");

        if ($response->failed()) {
            return response()->json(['error' => 'Failed to fetch board state'], 502);
        }

        return response()->json($response->json());
    }

    /**
     * 生成连接 token（防滥用）
     */
    public function connectToken(Request $request, string $boardId)
    {
        $user = $request->user();

        $token = \Laravel\Sanctum\PersonalAccessToken::create([
            'name' => "board-{$boardId}",
            'abilities' => ['board:connect'],
            'expires_at' => now()->addHours(24),
        ]);

        return response()->json([
            'ws_url' => "{$this->workerUrl}/board/{$boardId}/ws",
            'token' => $token->plainTextToken,
            'board_id' => $boardId,
        ]);
    }

    /**
     * 通过 Cloudflare API 管理 DO（需要 REST API）
     */
    public function adminStats(string $boardId)
    {
        $accountId = config('services.cloudflare.account_id');
        $namespaceId = config('services.cloudflare.do_namespace_id');

        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiToken}",
            'Content-Type' => 'application/json',
        ])->get(
            "https://api.cloudflare.com/client/v4/accounts/{$accountId}/workers/durable_objects/namespaces/{$namespaceId}/objects/{$boardId}/do/state"
        );

        return response()->json($response->json());
    }
}
```

```php
// routes/api.php
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/boards/{boardId}/history', [WhiteboardController::class, 'history']);
    Route::post('/boards/{boardId}/connect', [WhiteboardController::class, 'connectToken']);
    Route::get('/boards/{boardId}/admin/stats', [WhiteboardController::class, 'adminStats']);
});
```

### 第四步：前端连接

```javascript
// resources/js/whiteboard.js
class WhiteboardClient {
  constructor(boardId, token) {
    this.boardId = boardId;
    this.token = token;
    this.ws = null;
    this.userId = null;
    this.drawingData = [];
    this.handlers = new Map();
  }

  async connect() {
    // 从 Laravel 获取连接信息
    const res = await fetch(`/api/boards/${this.boardId}/connect`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    const { ws_url, token } = await res.json();

    // 连接 WebSocket（DO 支持原生 WebSocket，不需要 Socket.IO）
    this.ws = new WebSocket(`${ws_url}?token=${token}`);

    this.ws.onopen = () => {
      console.log('Connected to Durable Object');
      this.emit('connected');
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      console.log('Disconnected, reconnecting in 2s...');
      setTimeout(() => this.connect(), 2000);
      this.emit('disconnected');
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'init':
        this.userId = data.userId;
        this.drawingData = data.drawingData;
        this.emit('init', data);
        break;

      case 'draw':
        this.drawingData.push(data.entry);
        this.emit('draw', data.entry);
        break;

      case 'cursor':
        this.emit('cursor', data);
        break;

      case 'clear':
        this.drawingData = [];
        this.emit('clear');
        break;

      case 'undo':
        this.drawingData.splice(data.index, 1);
        this.emit('undo', data);
        break;

      case 'user_joined':
      case 'user_left':
        this.emit('userChange', data);
        break;
    }
  }

  // 发送绘图数据
  draw(points, color, width) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'draw',
        points,
        color,
        width,
      }));
    }
  }

  // 发送光标位置
  sendCursor(x, y) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'cursor',
        x, y,
      }));
    }
  }

  clear() {
    this.ws?.send(JSON.stringify({ type: 'clear' }));
  }

  undo() {
    this.ws?.send(JSON.stringify({ type: 'undo' }));
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.handlers.get(event) || [];
    handlers.forEach((h) => h(data));
  }
}

// 使用
const client = new WhiteboardClient('room-123', window.USER_TOKEN);
client.on('draw', (entry) => renderToCanvas(entry));
client.on('cursor', ({ userId, x, y }) => updateCursor(userId, x, y));
client.on('userChange', ({ activeUsers }) => updateUserCount(activeUsers));
client.connect();
```

## 踩坑记录

### 1. DO 的 CPU 时间限制

每个 DO 每次请求有 **30 秒 CPU 时间**限制（注意不是挂钟时间，是实际 CPU 执行时间）。对于高并发场景，这个限制很容易触碰。

```javascript
// ❌ 错误：在单个请求中处理所有广播
async handleMessage(userId, data) {
  for (const [id, session] of this.sessions) {
    await session.ws.send(message); // 如果 sessions 很多，CPU 时间会超
  }
}

// ✅ 正确：批量发送，避免 async 等待
broadcast(data, excludeUserId = null) {
  const message = JSON.stringify(data);
  const batch = [];
  for (const [id, session] of this.sessions) {
    if (id !== excludeUserId) {
      batch.push(session.ws.send(message));
    }
  }
  // send() 本身是同步的，不需要 await
}
```

### 2. 存储写入的频率控制

频繁写入存储会消耗 CPU 时间。生产环境中建议：

```javascript
// ❌ 每条消息都写存储
async handleMessage(userId, data) {
  this.drawingData.push(entry);
  await this.state.storage.put('drawingData', this.drawingData); // 太频繁
}

// ✅ 批量写入 + 定时保存
async handleMessage(userId, data) {
  this.drawingData.push(entry);

  // 每 50 条或每 30 秒保存一次
  if (this.drawingData.length % 50 === 0) {
    await this.saveState();
  }

  // 使用 alarm 定时保存
  if (!this.alarmScheduled) {
    await this.state.storage.setAlarm(Date.now() + 30000);
    this.alarmScheduled = true;
  }
}

async alarm() {
  await this.saveState();
  this.alarmScheduled = false;
}
```

### 3. 连接数限制

每个 DO 最多支持 **400 个并发 WebSocket 连接**。如果一个聊天室有 500 人，你需要分片：

```javascript
// 分片策略：按用户 ID 哈希分到多个 DO
function getShardedObjectId(roomId, userId) {
  const shardCount = 4; // 每个房间分 4 个 shard
  const shard = hashCode(userId) % shardCount;
  return `${roomId}-shard-${shard}`;
}
```

### 4. DO 的全球分布

DO 默认只在**一个位置**运行（你选择的区域）。如果用户分布在全球，需要考虑：

```javascript
// 方案 1：使用 Workers 的地理位置路由
// 在 wrangler.toml 中配置
// routes = [{ pattern = "*.example.com/*", zone_name = "example.com" }]

// 方案 2：使用 Durable Objects 的 location hint
export class MyDO {
  constructor(state, env) {
    // 告诉 Cloudflare 这个 DO 应该靠近哪个区域
    state.blockConcurrencyWhile(async () => {
      // 如果是亚太用户，设置 hint
      await this.state.storage.setLocationHint('wnam'); // 西北美
    });
  }
}
```

### 5. 与 Laravel 的认证对接

DO Worker 和 Laravel 是分离的服务，认证需要额外处理：

```javascript
// Worker 端验证 token
async handleWebSocket(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  // 验证 token（调用 Laravel API 或用 JWT）
  const valid = await this.verifyToken(token);
  if (!valid) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 继续处理 WebSocket
}
```

```php
// Laravel 端生成 token
public function connectToken(Request $request, string $boardId)
{
    // 生成 JWT 给 Worker 验证
    $payload = [
        'sub' => $request->user()->id,
        'board' => $boardId,
        'iat' => time(),
        'exp' => time() + 86400,
    ];

    $token = JWT::encode($payload, config('app.worker_secret'), 'HS256');

    return response()->json([
        'ws_url' => config('services.cloudflare.worker_url') . "/board/{$boardId}/ws",
        'token' => $token,
    ]);
}
```

### 6. 定价与免费额度

Cloudflare Durable Objects 的定价：

- **免费额度**：每个账户每月 100,000 个请求
- **超出后**：$0.15 / 100,000 请求
- **存储**：$0.20 / GB·月（前 5GB 免费）
- **WebSocket 连接**：$0.20 / 100,000 连接

对于中小规模应用，免费额度基本够用。但如果要做大规模的实时应用，需要仔细计算成本。

## 与传统方案的详细对比

| 维度 | 传统 WebSocket + Redis | Cloudflare Durable Objects |
|------|----------------------|---------------------------|
| 延迟 | 取决于服务器位置，通常 50-200ms | 边缘网络，通常 10-50ms |
| 状态管理 | 需要 Redis 等外部存储 | 内置持久化存储 |
| 扩展性 | 需要自己处理分片和负载均衡 | Cloudflare 自动处理 |
| 运维成本 | 需要管理服务器、Redis 集群 | 全托管，无需运维 |
| 单线程保证 | 需要分布式锁 | 天然单线程，无需加锁 |
| 冷启动 | 无（常驻进程） | 有（但通常 < 5ms） |
| 调试 | 本地可调试 | 需要 `wrangler dev` |
| 供应商锁定 | 低（WebSocket 是标准协议） | 高（Cloudflare 专有） |
| 复杂度 | 高（需要管理多个服务） | 低（单个 Worker + DO） |

## 总结

Cloudflare Durable Objects 为实时应用提供了一种**更简洁、更高效**的架构选择。它特别适合：

- **聊天应用**：聊天室天然对应一个 DO 实例
- **协作编辑**：多人实时编辑同一个文档/画布
- **游戏状态**：游戏房间的状态管理
- **实时通知**：基于订阅的推送系统

但它不是银弹。**供应商锁定**是最大的风险，一旦深度使用，迁移到其他平台的成本很高。建议在核心业务逻辑中保持抽象层，这样即使要迁移，也能最小化改动。

对于 Laravel 项目，DO 可以作为**实时通信层**的补充，核心业务逻辑仍然在 Laravel 中处理。这种混合架构既利用了 DO 的边缘优势，又保持了 Laravel 的开发效率。

> 核心思路：**Laravel 负责业务逻辑，DO 负责实时通信和状态同步**。两者通过 API 和 Token 认证打通。
