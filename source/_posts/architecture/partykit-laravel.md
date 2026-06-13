---
title: PartyKit 实战：实时协作后端——多人编辑、在线状态、实时光标与 Laravel 应用集成
date: 2026-06-04 09:00:00
tags: [PartyKit, 实时协作, WebSocket, Laravel, CRDT, Yjs, Cloudflare, Durable Objects]
keywords: [PartyKit, Laravel, 实时协作后端, 多人编辑, 在线状态, 实时光标与, 应用集成, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "PartyKit 实战指南：基于 Cloudflare Durable Objects 构建实时协作后端，结合 CRDT/Yjs 实现多人文档编辑、在线状态与实时光标同步，深度集成 Laravel 完成 JWT 认证、数据持久化与 Webhook 回调，并与 Pusher、Ably、Laravel Reverb 进行架构对比与成本分析，适合全栈开发者快速落地 WebSocket 实时协作功能。"
---


## 引言

在当今 Web 应用开发中，实时协作已成为产品经理清单上的"必选项"。无论是 Google Docs 风格的多人文档编辑、Figma 式的协同设计、还是 Notion 般的团队知识库，用户对"所见即所得的多人实时体验"的期望越来越高。然而，构建一个稳定可靠的实时协作后端却充满技术挑战——WebSocket 连接管理、冲突解决算法、在线状态感知、光标同步、断线重连、数据持久化……每一项都是深水区。

传统的做法是自建 WebSocket 服务器，或者集成 Pusher、Ably 等第三方实时消息服务。前者运维成本高，后者灵活性受限且费用不菲。2023 年，PartyKit 作为一个基于 Cloudflare Durable Objects 的开源实时协作框架横空出世，为开发者提供了第三条路径：**用 serverless 的方式构建有状态的实时后端**。

本文将深入探讨 PartyKit 的架构原理，并手把手带你实现一个完整的实时协作系统——涵盖多人文档编辑（基于 CRDT/Yjs）、在线状态感知（Presence）、实时光标同步，以及与 Laravel 后端应用的深度集成（认证、数据持久化、Webhook 回调）。文章末尾还会将 PartyKit 与 Pusher、Ably、Laravel Reverb 进行全面对比，并给出性能与成本分析。

---

## 第一部分：PartyKit 架构解析

### 1.1 什么是 PartyKit

PartyKit 是一个开源的实时协作框架，由 Cloudflare 团队成员推动开发，底层运行在 Cloudflare Workers 和 Durable Objects 之上。它的核心理念是：**每一个实时协作的"房间"（Room）就是一个轻量级的、有状态的 serverless 计算单元**。

```
┌─────────────────────────────────────────────────────────────────┐
│                        PartyKit 架构总览                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client A ──WebSocket──┐                                        │
│                        │    ┌──────────────────────────┐        │
│  Client B ──WebSocket──┼───▶│  Cloudflare Edge Network  │        │
│                        │    │  (全球 300+ 节点)          │        │
│  Client C ──WebSocket──┘    │                            │        │
│                             │  ┌──────────────────────┐ │        │
│                             │  │   Durable Object      │ │        │
│                             │  │   (Party/Room)        │ │        │
│                             │  │                       │ │        │
│                             │  │  - WebSocket 管理     │ │        │
│                             │  │  - 状态存储 (内存+磁盘)│ │        │
│                             │  │  - 消息路由与广播     │ │        │
│                             │  │  - 业务逻辑处理       │ │        │
│                             │  └──────────────────────┘ │        │
│                             └──────────────────────────┘        │
│                                            │                    │
│                                            ▼                    │
│                               ┌──────────────────────┐          │
│                               │   Laravel 后端 API    │          │
│                               │  (数据持久化/Webhook) │          │
│                               └──────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Cloudflare Durable Objects 深度解析

PartyKit 的核心能力来自 Cloudflare Durable Objects（以下简称 DO）。理解 DO 是理解 PartyKit 的关键。

**传统 Serverless 的痛点**：传统的 serverless 函数（如 AWS Lambda、Cloudflare Workers）是无状态的，每次请求都是独立的执行实例。这意味着你无法在内存中维持 WebSocket 连接列表、无法进行需要多步交互的实时协议。

**Durable Objects 的突破**：DO 是一种有状态的、单线程的、可全局协调的计算原语。每个 DO 实例：

- **唯一性**：通过 ID 唯一标识，全球只有一个活跃实例
- **单线程执行**：所有对该 DO 的请求按序处理，天然避免并发问题
- **持久存储**：内置 Storage API，数据自动持久化到磁盘
- **WebSocket 支持**：原生支持 WebSocket 连接的"hijack"（接管）
- **就近运行**：DO 会自动迁移到离使用者最近的数据中心

```javascript
// Durable Object 的核心生命周期（PartyKit 抽象层之下）
export class MyParty {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.storage = ctx.storage;
    this.connections = new Map();
  }

  // 处理 HTTP 请求和 WebSocket 升级
  async fetch(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.ctx.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // 接收 WebSocket 消息
  async webSocketMessage(ws, message) {
    const data = JSON.parse(message);
    // 广播给所有连接的客户端
    this.broadcast(ws, data);
  }

  // 连接关闭
  async webSocketClose(ws) {
    this.connections.delete(ws);
  }
}
```

### 1.3 PartyKit 的核心抽象

PartyKit 在 DO 之上封装了更友好的开发者体验：

```typescript
// partykit 的 server.ts - PartyKit Server 的完整接口
import type {
  PartyKitServer,
  PartyKitRoom,
  PartyKitContext,
} from "partykit/server";

export default class Server implements PartyKitServer {
  constructor(readonly room: PartyKitRoom) {}

  // 当 WebSocket 连接建立时触发
  onConnect(
    conn: PartyKitConnection,
    ctx: PartyKitContext
  ) {
    console.log(
      `新连接: ${conn.id}, 房间: ${this.room.id}`
    );

    // 发送欢迎消息
    conn.send(JSON.stringify({
      type: "welcome",
      connectionId: conn.id,
      timestamp: Date.now(),
    }));
  }

  // 当收到 WebSocket 消息时触发
  onMessage(
    message: string | ArrayBuffer,
    sender: PartyKitConnection
  ) {
    // 广播给房间内的其他所有连接
    this.room.broadcast(message, [sender.id]);
  }

  // 当 HTTP 请求到达时触发
  async onRequest(req: PartyKitRequest) {
    return new Response(
      JSON.stringify({
        connections: [...this.room.getConnections()].length,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
```

**PartyKit 的关键优势**：

| 特性 | 说明 |
|------|------|
| 零运维 | 无需管理 WebSocket 服务器、负载均衡器 |
| 全球边缘部署 | 自动在最近的 Cloudflare 节点运行 |
| 按房间隔离 | 每个文档/房间独立的 DO 实例，故障隔离 |
| 有状态 + 持久化 | 内存状态 + Storage API 持久化 |
| 弹性扩展 | 从 0 到百万并发，无需配置 |
| TypeScript 原生 | 一等公民 TypeScript 支持 |

---

## 第二部分：CRDT vs OT —— 冲突解决算法选型

### 2.1 问题的根源

当多个用户同时编辑同一文档时，一个不可避免的问题出现了：**冲突**。用户 A 在第 10 行插入"Hello"的同时，用户 B 在第 10 行插入了"World"，最终文档应该是什么样子？

解决这个问题有两种主流算法：**OT（Operational Transformation）** 和 **CRDT（Conflict-free Replicated Data Type）**。

### 2.2 OT（Operational Transformation）

OT 是 Google Docs 采用的经典方案。它的核心思想是：**通过对操作进行变换（Transformation），使得不同客户端的操作序列最终达到一致状态**。

```
客户端 A 的操作: Insert("Hello", position=10)
客户端 B 的操作: Insert("World", position=10)

服务端收到 A 的操作后，需要对 B 的操作进行变换:
B' = Transform(B, A) → Insert("World", position=15)
// 因为 A 在位置 10 插入了 5 个字符，B 的插入位置需要后移

最终结果: "...Hello World..."
```

**OT 的局限性**：

- 需要一个中心化的服务端来做变换协调
- 变换函数的实现复杂度随支持的操作类型指数增长
- 对网络延迟敏感，需要严格的因果序保证
- 难以实现真正的去中心化

### 2.3 CRDT（Conflict-free Replicated Data Type）

CRDT 是近年来兴起的新范式。它的核心思想是：**设计一种数据结构，使得任意顺序合并来自不同副本的操作，最终都能自动收敛到一致状态**。

```
客户端 A 的操作: Insert("Hello", id=A1, origin=null)
客户端 B 的操作: Insert("World", id=B1, origin=null)

两者操作各自带有唯一 ID 和因果关系引用：
A1 的位置参考: null（文档开头）
B1 的位置参考: null（文档开头）

合并时，通过 ID 的字典序或预定义规则确定最终顺序：
A1 < B1 → "Hello" 排在 "World" 前面

最终结果: "HelloWorld"
```

### 2.4 对比总结

| 维度 | OT | CRDT |
|------|------|------|
| 中心化依赖 | 必须有中心服务器 | 可去中心化 |
| 冲突解决 | 服务端变换函数 | 本地自动合并 |
| 实现复杂度 | 随操作类型指数增长 | 算法复杂但库封装良好 |
| 延迟敏感性 | 高（需等待服务端确认） | 低（本地即时生效） |
| 内存占用 | 较低 | 较高（需维护元数据） |
| 典型代表 | Google Docs, ShareDB | Yjs, Automerge, Diamond Types |
| 离线编辑 | 困难 | 天然支持 |
| 大文档性能 | 优秀 | Yjs 优化后优秀 |

**本文选择 CRDT（Yjs）的原因**：

1. PartyKit 生态与 Yjs 深度集成（`y-partykit` 官方包）
2. CRDT 天然适合 serverless 架构——不依赖有状态的变换服务端
3. 支持离线编辑和断线重连，用户体验更好
4. Yjs 是目前性能最优、生态最完善的 CRDT 实现

---

## 第三部分：Yjs 集成实践

### 3.1 Yjs 核心概念

Yjs 是一个高性能的 CRDT 实现库，其核心数据结构包括：

- **Y.Doc**：文档根对象，包含所有共享数据
- **Y.Text**：共享的富文本（支持格式标记）
- **Y.Array**：共享的有序数组
- **Y.Map**：共享的键值映射
- **Y.XmlFragment**：共享的 XML 结构（适合富文本编辑器）
- **Awareness**：用于同步临时状态（光标位置、在线状态等）

```
┌─────────────────────────────────────────────────────────┐
│                    Y.Doc 数据结构                         │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Y.XmlText  │  │   Y.Map     │  │  Y.Array    │     │
│  │  (正文内容)  │  │  (元数据)    │  │  (评论列表)  │     │
│  │             │  │             │  │             │     │
│  │ <p>段落1</p>│  │ title: "..."│  │ [comment1,  │     │
│  │ <p>段落2</p>│  │ author: "." │  │  comment2]  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │              Awareness Protocol                │       │
│  │                                                │       │
│  │  User A: cursor {line: 5, col: 12}           │       │
│  │  User B: cursor {line: 8, col: 3}            │       │
│  │  User A: selection {anchor: 10, head: 25}    │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### 3.2 初始化 Yjs 文档

```typescript
import * as Y from "yjs";

// 创建文档
const doc = new Y.Doc();

// 定义共享数据结构
const yText = doc.getText("document");    // 文档正文
const yMeta = doc.getMap("metadata");     // 文档元数据
const yComments = doc.getArray("comments"); // 评论列表

// 监听变更
yText.observe((event) => {
  console.log("文本变更:", event.delta);
  // delta 格式示例:
  // [{ insert: "Hello" }, { retain: 10 }, { delete: 5 }]
});

// 应用编辑操作
doc.transact(() => {
  yText.insert(0, "Hello, World!");
  yMeta.set("title", "我的文档");
  yMeta.set("updatedAt", Date.now());
});
```

### 3.3 Yjs 的 Update 编码与同步

Yjs 使用高效的二进制编码来传输文档更新：

```typescript
import * as Y from "yjs";

// 编码增量更新
const doc = new Y.Doc();

// 监听更新事件，生成二进制增量
doc.on("update", (update: Uint8Array, origin: any) => {
  // update 是一个紧凑的二进制编码
  // 可以发送给其他副本进行合并
  console.log("增量更新大小:", update.byteLength, "bytes");
  sendToServer(update);
});

// 在另一端合并更新
const remoteDoc = new Y.Doc();
function applyRemoteUpdate(update: Uint8Array) {
  Y.applyUpdate(remoteDoc, update);
}

// 全量状态编码（用于初始化同步）
const fullState = Y.encodeStateAsUpdate(doc);
console.log("全量状态大小:", fullState.byteLength, "bytes");

// 仅获取差异增量（基于向量时钟）
const remoteVector = Y.encodeStateVector(remoteDoc);
const diff = Y.encodeStateAsUpdate(doc, remoteVector);
console.log("差异增量大小:", diff.byteLength, "bytes");
```

### 3.4 y-partykit：PartyKit 的 Yjs 集成包

`y-partykit` 是 PartyKit 官方提供的 Yjs 集成包，封装了 Yjs 文档的 WebSocket 同步、持久化、Awareness 管理等核心逻辑：

```typescript
// 安装
// npm install y-partykit yjs

import { onConnect } from "y-partykit";

export default {
  onConnect(conn, room) {
    // 一行代码搞定 Yjs 同步
    onConnect(conn, room, {
      // 文档持久化选项
      persist: {
        mode: "snapshot", // 或 "history"
      },
      // 回调钩子
      callback: {
        handler: (doc) => {
          console.log("文档更新，当前内容长度:", 
            doc.getText("document").length);
        },
      },
    });
  },
};
```

`y-partykit` 内部做了什么：

1. **文档管理**：为每个房间维护一个 `Y.Doc` 实例
2. **同步协议**：实现 Yjs 的 sync step 1/2 协议，确保新连接的客户端获得完整文档
3. **Awareness 传播**：将客户端的 awareness 状态（光标、选区等）广播给房间内其他客户端
4. **持久化**：支持将文档状态持久化到 PartyKit 的 Storage
5. **垃圾回收**：定期清理过时的更新历史，控制内存和存储占用

---

## 第四部分：多人文档编辑实现

### 4.1 项目结构

```
partykit-collab/
├── partykit/                  # PartyKit 服务端代码
│   ├── server.ts              # PartyKit Server 入口
│   ├── yjs-server.ts          # Yjs 同步服务
│   ├── auth.ts                # 认证中间件
│   └── persistence.ts         # 持久化策略
├── src/                       # 前端客户端代码
│   ├── lib/
│   │   ├── yjs-client.ts      # Yjs 客户端封装
│   │   ├── awareness.ts       # 在线状态管理
│   │   └── cursor-sync.ts     # 光标同步
│   ├── components/
│   │   ├── Editor.tsx          # 编辑器组件
│   │   ├── CursorOverlay.tsx   # 光标覆盖层
│   │   └── PresenceBar.tsx     # 在线状态栏
│   └── App.tsx
├── partykit.json              # PartyKit 配置
├── package.json
└── tsconfig.json
```

### 4.2 PartyKit 配置

```json
// partykit.json
{
  "name": "collab-editor",
  "main": "partykit/server.ts",
  "serve": {
    "path": "public",
    "build": {
      "command": "npm run build:client"
    }
  },
  "vars": {
    "LARAVEL_API_URL": "https://api.example.com",
    "JWT_SECRET": "your-jwt-secret-key"
  }
}
```

### 4.3 PartyKit 服务端实现

```typescript
// partykit/server.ts
import type {
  PartyKitServer,
  PartyKitRoom,
  PartyKitConnection,
  PartyKitContext,
} from "partykit/server";
import { onConnect } from "y-partykit";
import { verifyToken } from "./auth";
import { persistDocument, loadDocument } from "./persistence";

export default class CollabServer implements PartyKitServer {
  constructor(readonly room: PartyKitRoom) {}

  // 处理连接请求（包括认证）
  async onConnect(
    conn: PartyKitConnection,
    ctx: PartyKitContext
  ) {
    // 从 URL 参数或 headers 中获取认证信息
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      conn.close(4001, "Missing authentication token");
      return;
    }

    // 验证 JWT token
    const user = await verifyToken(
      token,
      this.room.env.JWT_SECRET
    );

    if (!user) {
      conn.close(4003, "Invalid token");
      return;
    }

    // 将用户信息存储在连接的 tags 中
    // 后续在 Yjs awareness 中会用到
    console.log(
      `[Room ${this.room.id}] User ${user.name} (${user.id}) connected`
    );

    // 使用 y-partykit 处理 Yjs 同步
    onConnect(conn, this.room, {
      persist: {
        mode: "snapshot",
        // 自定义加载函数，从 Laravel API 获取文档
        load: async (roomId: string) => {
          return await loadDocument(roomId, this.room.env);
        },
      },
      readOnly: false,
      callback: {
        // 文档更新时触发
        handler: async (doc) => {
          // 定期将文档状态推送到 Laravel 后端
          await persistDocument(
            this.room.id,
            doc,
            this.room.env
          );
        },
      },
      // 设置文档 GC 策略
      gcFilter: (s) => {
        return true; // 保留所有内容
      },
    });
  }

  // HTTP 请求处理（供 Laravel Webhook 调用）
  async onRequest(req: Request) {
    const url = new URL(req.url);

    // API: 获取房间状态
    if (url.pathname === "/api/status") {
      const connections = [
        ...this.room.getConnections(),
      ];
      return new Response(
        JSON.stringify({
          roomId: this.room.id,
          activeConnections: connections.length,
          users: connections.map((c) => ({
            id: c.id,
            // tags 中存储了用户信息
          })),
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // API: 强制广播消息给房间
    if (req.method === "POST" && url.pathname === "/api/broadcast") {
      const body = await req.json();
      this.room.broadcast(JSON.stringify(body));
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response("Not Found", { status: 404 });
  }

  // 连接关闭
  onClose(conn: PartyKitConnection) {
    console.log(
      `[Room ${this.room.id}] Connection ${conn.id} closed`
    );
  }
}
```

### 4.4 客户端集成 —— 基于 Tiptap 编辑器

```typescript
// src/lib/yjs-client.ts
import * as Y from "yjs";
import { WebsocketProvider } from "y-partykit/provider";

export interface CollabClientOptions {
  host: string;       // PartyKit 主机地址
  room: string;       // 房间/文档 ID
  token: string;      // 认证 token
  user: {
    id: string;
    name: string;
    color: string;
  };
}

export function createCollabClient(options: CollabClientOptions) {
  const doc = new Y.Doc();

  // 创建 PartyKit WebSocket Provider
  const provider = new WebsocketProvider(
    options.host,
    options.room,
    doc,
    {
      // 传递认证 token
      params: {
        token: options.token,
      },
      // 连接协议
      protocol: "wss",
      // 自动重连
      connect: true,
    }
  );

  // 设置 Awareness（在线状态信息）
  provider.awareness.setLocalStateField("user", {
    id: options.user.id,
    name: options.user.name,
    color: options.user.color,
  });

  // 监听连接状态
  provider.on("status", (event: { status: string }) => {
    console.log("连接状态:", event.status);
    // event.status: "connected" | "disconnected" | "connecting"
  });

  provider.on("sync", (synced: boolean) => {
    console.log("文档同步状态:", synced);
  });

  return {
    doc,
    provider,
    awareness: provider.awareness,
    // 获取共享文本结构
    yText: doc.getText("document"),
    yMeta: doc.getMap("metadata"),
    // 销毁函数
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}
```

```tsx
// src/components/Editor.tsx
import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { createCollabClient } from "../lib/yjs-client";

interface EditorProps {
  documentId: string;
  token: string;
  user: {
    id: string;
    name: string;
    color: string;
  };
}

const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ||
  "collab-editor.partykit.dev";

export function Editor({ documentId, token, user }: EditorProps) {
  const clientRef = useRef<ReturnType<typeof createCollabClient>>();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 禁用默认历史记录，使用 Yjs 的协作历史
        history: false,
      }),
      // Yjs 协作扩展 —— 核心！
      Collaboration.configure({
        document: clientRef.current?.yText,
      }),
      // 协作光标扩展
      CollaborationCursor.configure({
        provider: clientRef.current?.provider,
        user: {
          name: user.name,
          color: user.color,
        },
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-lg max-w-none focus:outline-none min-h-[500px] p-8",
      },
    },
  }, [
    // 依赖项：当 client 变化时重新创建编辑器
    clientRef.current?.yText,
    clientRef.current?.provider,
  ]);

  useEffect(() => {
    // 初始化 Yjs 客户端
    const client = createCollabClient({
      host: PARTYKIT_HOST,
      room: documentId,
      token,
      user,
    });
    clientRef.current = client;

    return () => {
      client.destroy();
    };
  }, [documentId, token]);

  return (
    <div className="editor-container">
      <EditorContent editor={editor} />
    </div>
  );
}
```

---

## 第五部分：在线状态（Presence）实现

### 5.1 Presence 的概念与用途

在线状态（Presence）是实时协作应用的基础能力之一。它回答了以下问题：

- 当前有多少人在查看这个文档？
- 他们分别是谁？
- 他们当前在编辑文档的哪个部分？
- 他们是否正在输入？

Yjs 的 Awareness 协议是实现 Presence 的理想选择。Awareness 是一种"最终一致"的临时状态同步机制——每个客户端维护自己的本地状态，通过广播告知其他客户端，状态会自动过期（客户端离线后自动清除）。

### 5.2 Awareness 数据结构设计

```typescript
// src/lib/awareness.ts
import type { Awareness } from "y-protocols/awareness";

export interface UserPresence {
  // 基础信息
  user: {
    id: string;
    name: string;
    avatar?: string;
    color: string;
  };
  // 编辑状态
  cursor: {
    anchor: number;   // 光标锚点位置
    head: number;     // 光标头部位置
  };
  // 活动状态
  activity: {
    lastActive: number;   // 最后活动时间戳
    isTyping: boolean;    // 是否正在输入
    focusedField?: string; // 聚焦的字段名（多字段场景）
  };
  // 连接元数据
  connection: {
    joinedAt: number;      // 加入时间
    clientVersion: string; // 客户端版本号
  };
}

export class PresenceManager {
  private awareness: Awareness;
  private typingTimeout: NodeJS.Timeout | null = null;

  constructor(awareness: Awareness) {
    this.awareness = awareness;
    this.setupHeartbeat();
  }

  // 设置本地用户信息
  setUserInfo(user: UserPresence["user"]) {
    this.awareness.setLocalStateField("user", user);
  }

  // 更新光标位置
  updateCursor(anchor: number, head: number) {
    this.awareness.setLocalStateField("cursor", {
      anchor,
      head,
    });
    this.touchActivity(true);
  }

  // 标记正在输入
  markTyping() {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.awareness.setLocalStateField("activity", {
      lastActive: Date.now(),
      isTyping: true,
    });

    // 2 秒后自动清除"正在输入"状态
    this.typingTimeout = setTimeout(() => {
      this.awareness.setLocalStateField("activity", {
        lastActive: Date.now(),
        isTyping: false,
      });
    }, 2000);
  }

  // 触摸活动时间
  private touchActivity(isTyping: boolean = false) {
    this.awareness.setLocalStateField("activity", {
      lastActive: Date.now(),
      isTyping,
    });
  }

  // 获取所有在线用户
  getOnlineUsers(): Map<number, UserPresence> {
    const states = this.awareness.getStates();
    const users = new Map<number, UserPresence>();

    states.forEach((state, clientId) => {
      if (state.user) {
        users.set(clientId, state as UserPresence);
      }
    });

    return users;
  }

  // 心跳机制 - 定期更新活动时间
  private setupHeartbeat() {
    setInterval(() => {
      this.touchActivity();
    }, 15000); // 每 15 秒心跳
  }
}
```

### 5.3 在线状态 UI 组件

```tsx
// src/components/PresenceBar.tsx
import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { UserPresence } from "../lib/awareness";

interface PresenceBarProps {
  awareness: Awareness;
  currentUserId: string;
}

export function PresenceBar({
  awareness,
  currentUserId,
}: PresenceBarProps) {
  const [users, setUsers] = useState<
    Map<number, UserPresence>
  >(new Map());

  useEffect(() => {
    const updateUsers = () => {
      const states = awareness.getStates();
      const newUsers = new Map<number, UserPresence>();
      states.forEach((state, clientId) => {
        if (state.user) {
          newUsers.set(
            clientId,
            state as UserPresence
          );
        }
      });
      setUsers(newUsers);
    };

    // 初始加载
    updateUsers();

    // 监听变化
    awareness.on("change", updateUsers);

    return () => {
      awareness.off("change", updateUsers);
    };
  }, [awareness]);

  const onlineUsers = Array.from(users.values());

  return (
    <div className="presence-bar flex items-center gap-2 px-4 py-2 bg-gray-50 border-b">
      {/* 头像栈 */}
      <div className="avatar-stack flex -space-x-2">
        {onlineUsers.map((presence) => (
          <div
            key={presence.user.id}
            className="relative group"
            title={presence.user.name}
          >
            <div
              className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold"
              style={{
                backgroundColor: presence.user.color,
              }}
            >
              {presence.user.name.charAt(0).toUpperCase()}
            </div>
            {/* 在线指示器 */}
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                presence.activity.isTyping
                  ? "bg-yellow-400 animate-pulse"
                  : "bg-green-400"
              }`}
            />
            {/* Hover 详情卡片 */}
            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-50">
              <div className="bg-gray-800 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                <p className="font-semibold">
                  {presence.user.name}
                </p>
                <p className="text-gray-300">
                  {presence.activity.isTyping
                    ? "正在输入..."
                    : "在线"}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 在线人数文字 */}
      <span className="text-sm text-gray-500 ml-2">
        {onlineUsers.length} 人在线
      </span>
    </div>
  );
}
```

---

## 第六部分：实时光标同步

### 6.1 技术方案

实时光标同步的核心挑战是：在不产生过多网络流量的前提下，让每个用户看到其他用户的光标实时位置和选区。我们的方案是：

1. **使用 Yjs Awareness** 传输光标位置（非文档内容，无需持久化）
2. **使用绝对位置（character offset）** 而非行/列位置，方便在不同视图中映射
3. **节流传输**：限制光标位置更新频率（每 50-100ms 一次）
4. **渲染层分离**：光标渲染在独立的 overlay 层，不影响编辑器性能

### 6.2 光标同步实现

```typescript
// src/lib/cursor-sync.ts
import type { Awareness } from "y-protocols/awareness";

interface CursorPosition {
  anchor: number;
  head: number;
  rect?: DOMRect;       // 屏幕坐标（用于渲染）
}

interface RemoteCursor {
  clientId: number;
  user: {
    name: string;
    color: string;
  };
  cursor: CursorPosition;
  selection?: {
    from: number;
    to: number;
  };
}

export class CursorSyncManager {
  private awareness: Awareness;
  private cursors: Map<number, RemoteCursor> = new Map();
  private listeners: Set<(cursors: RemoteCursor[]) => void> = new Set();
  private updateThrottle: number = 50; // 50ms 节流
  private lastUpdate: number = 0;
  private editor: any; // Tiptap Editor instance

  constructor(awareness: Awareness, editor: any) {
    this.awareness = awareness;
    this.editor = editor;
    this.setupListeners();
  }

  private setupListeners() {
    // 监听 awareness 变化
    this.awareness.on("change", () => {
      this.syncCursors();
    });

    // 监听本地编辑器选择变化
    this.editor.on("selectionUpdate", () => {
      this.broadcastLocalCursor();
    });

    // 监听滚动以更新光标位置
    this.editor.on("scroll", () => {
      this.updateAllCursorRects();
    });
  }

  // 广播本地光标位置
  private broadcastLocalCursor() {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateThrottle) return;
    this.lastUpdate = now;

    const { from, to } = this.editor.state.selection;
    this.awareness.setLocalStateField("cursor", {
      anchor: from,
      head: to,
      timestamp: now,
    });
  }

  // 同步远程光标
  private syncCursors() {
    const states = this.awareness.getStates();
    const newCursors = new Map<number, RemoteCursor>();

    states.forEach((state, clientId) => {
      // 忽略本地客户端
      if (clientId === this.awareness.clientID) return;
      if (!state.cursor || !state.user) return;

      const cursor: RemoteCursor = {
        clientId,
        user: state.user,
        cursor: {
          ...state.cursor,
          rect: this.getCursorScreenPosition(
            state.cursor.head
          ),
        },
        selection:
          state.cursor.anchor !== state.cursor.head
            ? {
                from: Math.min(
                  state.cursor.anchor,
                  state.cursor.head
                ),
                to: Math.max(
                  state.cursor.anchor,
                  state.cursor.head
                ),
              }
            : undefined,
      };

      newCursors.set(clientId, cursor);
    });

    this.cursors = newCursors;
    this.notifyListeners();
  }

  // 将文档偏移量转换为屏幕坐标
  private getCursorScreenPosition(
    offset: number
  ): DOMRect | undefined {
    try {
      const coords = this.editor.view.coordsAtPos(offset);
      return new DOMRect(
        coords.left,
        coords.top,
        coords.right - coords.left,
        coords.bottom - coords.top
      );
    } catch {
      return undefined;
    }
  }

  // 更新所有光标的屏幕坐标
  private updateAllCursorRects() {
    this.cursors.forEach((cursor, clientId) => {
      cursor.rect = this.getCursorScreenPosition(
        cursor.cursor.head
      );
    });
    this.notifyListeners();
  }

  // 订阅光标变化
  onUpdate(
    listener: (cursors: RemoteCursor[]) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const cursorArray = Array.from(this.cursors.values());
    this.listeners.forEach((fn) => fn(cursorArray));
  }

  destroy() {
    this.listeners.clear();
    this.cursors.clear();
  }
}
```

### 6.3 光标渲染组件

```tsx
// src/components/CursorOverlay.tsx
import { useEffect, useState, useMemo } from "react";

interface CursorData {
  clientId: number;
  user: { name: string; color: string };
  cursor: {
    anchor: number;
    head: number;
    rect?: DOMRect;
  };
  selection?: { from: number; to: number };
}

interface CursorOverlayProps {
  cursors: CursorData[];
  containerRef: React.RefObject<HTMLDivElement>;
}

export function CursorOverlay({
  cursors,
  containerRef,
}: CursorOverlayProps) {
  const containerRect = containerRef.current?.getBoundingClientRect();

  return (
    <div
      className="cursor-overlay absolute inset-0 pointer-events-none z-10"
      aria-hidden="true"
    >
      {cursors.map((cursor) => {
        if (!cursor.rect || !containerRect) return null;

        // 计算相对于容器的位置
        const x =
          cursor.rect.left - containerRect.left;
        const y =
          cursor.rect.top - containerRect.top;

        return (
          <div key={cursor.clientId}>
            {/* 光标竖线 */}
            <div
              className="absolute w-0.5 h-6 -translate-x-1/2 animate-pulse"
              style={{
                left: `${x}px`,
                top: `${y}px`,
                backgroundColor: cursor.user.color,
              }}
            />
            {/* 光标名称标签 */}
            <div
              className="absolute -translate-x-1/2 -translate-y-full px-1.5 py-0.5 rounded text-xs text-white whitespace-nowrap shadow-sm"
              style={{
                left: `${x}px`,
                top: `${y - 4}px`,
                backgroundColor: cursor.user.color,
              }}
            >
              {cursor.user.name}
            </div>

            {/* 选区高亮 */}
            {cursor.selection && (
              <SelectionHighlight
                selection={cursor.selection}
                color={cursor.user.color}
                editorView={containerRef.current}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// 选区高亮渲染
function SelectionHighlight({
  selection,
  color,
  editorView,
}: {
  selection: { from: number; to: number };
  color: string;
  editorView: HTMLElement | null;
}) {
  // 使用 DOM Range API 获取选区的屏幕坐标
  // 实际实现中需要更复杂的坐标计算逻辑
  return (
    <div
      className="absolute opacity-20 rounded-sm"
      style={{
        backgroundColor: color,
        // 具体位置由实际 DOM 计算得出
      }}
    />
  );
}
```

---

## 第七部分：与 Laravel 应用集成

### 7.1 集成架构总览

在实际项目中，PartyKit 不会孤立运行——它需要与后端应用（本文以 Laravel 为例）深度集成，处理认证鉴权、数据持久化、业务逻辑回调等需求。

```
┌──────────────────────────────────────────────────────────────────┐
│                    Laravel + PartyKit 集成架构                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │ 前端 SPA  │───▶│ Laravel API  │    │   PartyKit Server     │  │
│  │ (React/   │    │              │    │   (Cloudflare DO)     │  │
│  │  Vue)     │    │ - 认证登录   │    │                       │  │
│  │           │◀──▶│ - 文档 CRUD  │◀──▶│ - WebSocket 管理      │  │
│  │           │    │ - 权限控制   │    │ - Yjs 同步            │  │
│  │           │    │ - 数据查询   │    │ - Presence 管理       │  │
│  └──────────┘    └──────┬───────┘    └──────────┬────────────┘  │
│                         │                       │               │
│                         │   Webhook 回调         │               │
│                         │◀──────────────────────┘               │
│                         │                                       │
│                  ┌──────▼───────┐                               │
│                  │    MySQL /    │                               │
│                  │   PostgreSQL  │                               │
│                  │  (文档存储)    │                               │
│                  └──────────────┘                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   数据流说明                               │    │
│  │                                                           │    │
│  │  1. 用户登录 → Laravel 签发 JWT Token                    │    │
│  │  2. 前端携带 JWT 连接 PartyKit（附在 URL 参数中）         │    │
│  │  3. PartyKit 验证 JWT（通过 Laravel API 或本地验证）      │    │
│  │  4. Yjs 实时同步文档变更                                  │    │
│  │  5. PartyKit 定期将文档快照推送到 Laravel（Webhook/REST） │    │
│  │  6. Laravel 持久化到数据库，触发业务事件                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 认证集成

#### 7.2.1 Laravel 端 —— 签发专用的 PartyKit Token

```php
// app/Services/PartyKitService.php
<?php

namespace App\Services;

use App\Models\User;
use App\Models\Document;
use Illuminate\Support\Facades\Http;
use Firebase\JWT\JWT;

class PartyKitService
{
    private string $partyKitHost;
    private string $jwtSecret;
    private string $serverSecret;

    public function __construct()
    {
        $this->partyKitHost = config('services.partykit.host');
        $this->jwtSecret = config('services.partykit.jwt_secret');
        $this->serverSecret = config('services.partykit.server_secret');
    }

    /**
     * 为用户生成 PartyKit 连接 token
     */
    public function generateToken(User $user, Document $document): array
    {
        // 验证用户是否有权限访问该文档
        if (!$user->can('view', $document)) {
            throw new \App\Exceptions\UnauthorizedException(
                '无权访问该文档'
            );
        }

        $payload = [
            'iss' => config('app.name'),
            'iat' => now()->timestamp,
            'exp' => now()->addHours(4)->timestamp,
            'sub' => $user->id,
            'room' => $document->uuid,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'avatar' => $user->avatar_url,
                'color' => $this->generateUserColor($user->id),
                'role' => $user->role,
            ],
            'permissions' => [
                'read' => true,
                'write' => $user->can('update', $document),
                'admin' => $user->can('manage', $document),
            ],
        ];

        $token = JWT::encode($payload, $this->jwtSecret, 'HS256');

        return [
            'token' => $token,
            'room' => $document->uuid,
            'host' => $this->partyKitHost,
            'expires_at' => $payload['exp'],
        ];
    }

    /**
     * 为用户生成一致的颜色
     */
    private function generateUserColor(int $userId): string
    {
        $colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
            '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
            '#BB8FCE', '#85C1E9', '#F0B27A', '#82E0AA',
        ];
        return $colors[$userId % count($colors)];
    }

    /**
     * 从 PartyKit 获取房间状态
     */
    public function getRoomStatus(string $roomId): ?array
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->serverSecret}",
        ])->get(
            "{$this->partyKitHost}/parties/collab/{$roomId}/api/status"
        );

        return $response->successful() ? $response->json() : null;
    }

    /**
     * 向房间广播消息
     */
    public function broadcastToRoom(
        string $roomId,
        array $message
    ): bool {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->serverSecret}",
        ])->post(
            "{$this->partyKitHost}/parties/collab/{$roomId}/api/broadcast",
            $message
        );

        return $response->successful();
    }
}
```

#### 7.2.2 Laravel 控制器

```php
// app/Http/Controllers/DocumentCollaborationController.php
<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Services\PartyKitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentCollaborationController extends Controller
{
    public function __construct(
        private PartyKitService $partyKit
    ) {}

    /**
     * 获取文档的协作连接信息
     * GET /api/documents/{document}/collab
     */
    public function getCollabToken(
        Request $request,
        Document $document
    ): JsonResponse {
        $user = $request->user();

        $result = $this->partyKit->generateToken(
            $user,
            $document
        );

        return response()->json([
            'success' => true,
            'data' => $result,
        ]);
    }

    /**
     * 获取文档的当前在线用户
     * GET /api/documents/{document}/online-users
     */
    public function getOnlineUsers(
        Document $document
    ): JsonResponse {
        $status = $this->partyKit->getRoomStatus(
            $document->uuid
        );

        return response()->json([
            'success' => true,
            'data' => $status['users'] ?? [],
            'count' => $status['activeConnections'] ?? 0,
        ]);
    }
}
```

### 7.3 数据持久化

#### 7.3.1 PartyKit 推送到 Laravel

```typescript
// partykit/persistence.ts
import type * as Y from "yjs";

interface PersistEnv {
  LARAVEL_API_URL: string;
  LARAVEL_API_KEY: string;
}

// 节流：最多每 30 秒保存一次
const SAVE_INTERVAL = 30_000;
const pendingSaves = new Map<string, NodeJS.Timeout>();

export async function persistDocument(
  roomId: string,
  doc: Y.Doc,
  env: PersistEnv
): Promise<void> {
  // 节流控制
  if (pendingSaves.has(roomId)) return;

  pendingSaves.set(
    roomId,
    setTimeout(async () => {
      pendingSaves.delete(roomId);

      try {
        // 编码文档状态为二进制
        const state = Y.encodeStateAsUpdate(doc);
        // 转换为 base64 以便 HTTP 传输
        const base64State = btoa(
          String.fromCharCode(...state)
        );

        // 提取纯文本版本用于全文搜索
        const yText = doc.getText("document");
        const plainText = yText.toString();

        // 提取元数据
        const yMeta = doc.getMap("metadata");

        // 推送到 Laravel API
        const response = await fetch(
          `${env.LARAVEL_API_URL}/api/documents/${roomId}/sync`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.LARAVEL_API_KEY}`,
              "X-Persist-Source": "partykit",
            },
            body: JSON.stringify({
              state: base64State,
              plain_text: plainText.substring(0, 10000),
              metadata: {
                title: yMeta.get("title"),
                word_count: plainText.split(/\s+/).length,
              },
              saved_at: new Date().toISOString(),
            }),
          }
        );

        if (!response.ok) {
          console.error(
            `持久化失败: ${response.status} ${response.statusText}`
          );
        }
      } catch (error) {
        console.error("持久化错误:", error);
      }
    }, SAVE_INTERVAL)
  );
}

export async function loadDocument(
  roomId: string,
  env: PersistEnv
): Promise<Uint8Array | null> {
  try {
    const response = await fetch(
      `${env.LARAVEL_API_URL}/api/documents/${roomId}/state`,
      {
        headers: {
          Authorization: `Bearer ${env.LARAVEL_API_KEY}`,
        },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.state) return null;

    // 从 base64 解码
    const binary = atob(data.state);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  } catch (error) {
    console.error("加载文档失败:", error);
    return null;
  }
}
```

#### 7.3.2 Laravel 端 —— 接收同步数据

```php
// app/Http/Controllers/DocumentSyncController.php
<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Models\DocumentSnapshot;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class DocumentSyncController extends Controller
{
    /**
     * 接收 PartyKit 推送的文档状态
     * POST /api/documents/{document}/sync
     */
    public function sync(
        Request $request,
        Document $document
    ): JsonResponse {
        $validated = $request->validate([
            'state' => 'required|string',
            'plain_text' => 'nullable|string|max:50000',
            'metadata' => 'nullable|array',
            'metadata.title' => 'nullable|string|max:255',
            'metadata.word_count' => 'nullable|integer',
            'saved_at' => 'required|date',
        ]);

        // 验证 API Key（服务端对服务端调用）
        if ($request->header('X-Persist-Source') !== 'partykit') {
            abort(403, 'Invalid source');
        }

        // 更新文档的 Yjs 状态
        $document->update([
            'yjs_state' => $validated['state'],
            'plain_text_preview' => 
                substr($validated['plain_text'] ?? '', 0, 500),
            'word_count' => 
                $validated['metadata']['word_count'] ?? 0,
            'last_synced_at' => $validated['saved_at'],
        ]);

        // 如果有标题变更，更新文档标题
        if (!empty($validated['metadata']['title'])) {
            $document->update([
                'title' => $validated['metadata']['title'],
            ]);
        }

        // 异步创建快照（用于版本历史）
        DocumentSnapshot::dispatch($document);

        // 清除相关缓存
        Cache::forget("document:{$document->uuid}:meta");

        return response()->json([
            'success' => true,
            'synced_at' => now()->toISOString(),
        ]);
    }

    /**
     * 获取文档的 Yjs 状态
     * GET /api/documents/{document}/state
     */
    public function getState(
        Document $document
    ): JsonResponse {
        return response()->json([
            'state' => $document->yjs_state,
            'updated_at' => $document->last_synced_at,
        ]);
    }
}
```

### 7.4 Webhook 回调

PartyKit 还可以通过 Webhook 将关键事件通知给 Laravel：

```typescript
// partykit/server.ts (补充 webhook 部分)
export default class CollabServer implements PartyKitServer {
  // ... 前面的代码 ...

  async onConnect(conn: PartyKitConnection, ctx: PartyKitContext) {
    // ... 认证逻辑 ...

    // 通知 Laravel 有新用户加入
    this.sendWebhook("user.joined", {
      room: this.room.id,
      user: { id: user.id, name: user.name },
      timestamp: Date.now(),
    });

    // ... Yjs 同步逻辑 ...
  }

  onClose(conn: PartyKitConnection) {
    // 通知 Laravel 用户离开
    this.sendWebhook("user.left", {
      room: this.room.id,
      connectionId: conn.id,
      timestamp: Date.now(),
    });
  }

  private async sendWebhook(
    event: string,
    data: Record<string, any>
  ) {
    try {
      await fetch(
        `${this.room.env.LARAVEL_API_URL}/api/webhooks/partykit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Event": event,
            "X-Webhook-Signature": this.signPayload(data),
          },
          body: JSON.stringify({
            event,
            data,
            room_id: this.room.id,
            timestamp: new Date().toISOString(),
          }),
        }
      );
    } catch (error) {
      console.error("Webhook 发送失败:", error);
    }
  }

  private signPayload(data: Record<string, any>): string {
    const payload = JSON.stringify(data);
    // 使用 Web Crypto API 进行 HMAC 签名
    // Cloudflare Workers 环境支持此 API
    const encoder = new TextEncoder();
    // 简化示例，实际需使用 subtle.crypto
    return "sha256=...";
  }
}
```

```php
// app/Http/Controllers/WebhookController.php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Events\UserJoinedDocument;
use App\Events\UserLeftDocument;

class WebhookController extends Controller
{
    /**
     * 处理 PartyKit Webhook
     * POST /api/webhooks/partykit
     */
    public function handle(Request $request): JsonResponse
    {
        // 验证签名
        $signature = $request->header('X-Webhook-Signature');
        if (!$this->verifySignature($request, $signature)) {
            abort(403, 'Invalid webhook signature');
        }

        $event = $request->header('X-Webhook-Event');
        $data = $request->all();

        match ($event) {
            'user.joined' => event(
                new UserJoinedDocument(
                    $data['data']['user']['id'],
                    $data['room_id']
                )
            ),
            'user.left' => event(
                new UserLeftDocument(
                    $data['room_id'],
                    $data['data']['connectionId']
                )
            ),
            'document.updated' => $this->handleDocumentUpdated($data),
            default => null,
        };

        return response()->json(['received' => true]);
    }

    private function verifySignature(
        Request $request,
        ?string $signature
    ): bool {
        if (!$signature) return false;
        $expected = hash_hmac(
            'sha256',
            $request->getContent(),
            config('services.partykit.webhook_secret')
        );
        return hash_equals("sha256={$expected}", $signature);
    }
}
```

---

## 第八部分：PartyKit Server 完整编写指南

### 8.1 Server 生命周期

理解 PartyKit Server 的生命周期是正确实现业务逻辑的前提：

```
┌──────────────────────────────────────────────────────────┐
│              PartyKit Server 生命周期                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. 房间创建（首次有客户端连接时）                          │
│     ├── constructor(room) 被调用                          │
│     ├── 从 storage 恢复持久化状态                          │
│     └── 初始化房间状态                                     │
│                                                          │
│  2. 客户端连接                                           │
│     ├── onConnect(conn, ctx) 被调用                       │
│     ├── 认证/鉴权                                         │
│     ├── WebSocket 握手完成                                 │
│     └── 加入连接列表                                       │
│                                                          │
│  3. 消息处理                                             │
│     ├── onMessage(message, conn) 被调用                   │
│     ├── 解析消息                                          │
│     ├── 处理业务逻辑                                      │
│     └── 广播/回复                                         │
│                                                          │
│  4. HTTP 请求处理                                        │
│     ├── onRequest(req) 被调用                             │
│     ├── REST API 处理                                     │
│     └── 返回 Response                                     │
│                                                          │
│  5. 连接关闭                                             │
│     ├── onClose(conn) 被调用                              │
│     ├── 清理资源                                          │
│     └── 通知其他客户端                                     │
│                                                          │
│  6. 房间休眠（所有连接断开后一段时间）                       │
│     ├── 状态已持久化到 storage                             │
│     ├── DO 实例被逐出内存                                  │
│     └── 下次连接时自动恢复                                 │
│                                                          │
│  7. 定时任务（可选）                                       │
│     ├── onStart() 中注册 alarm                            │
│     └── onAlarm() 被调用（如定期清理、同步）                │
└──────────────────────────────────────────────────────────┘
```

### 8.2 完整的 PartyKit Server 实现

```typescript
// partykit/server.ts - 完整版
import type {
  PartyKitServer,
  PartyKitRoom,
  PartyKitConnection,
  PartyKitContext,
} from "partykit/server";
import { onConnect } from "y-partykit";
import { verifyToken } from "./auth";
import {
  persistDocument,
  loadDocument,
} from "./persistence";

interface UserMetadata {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  role: string;
  joinedAt: number;
}

export default class CollabServer implements PartyKitServer {
  // 连接映射：connId -> UserMetadata
  private connections: Map<string, UserMetadata> = new Map();

  constructor(readonly room: PartyKitRoom) {}

  // ──────────────── WebSocket 连接处理 ────────────────

  async onConnect(
    conn: PartyKitConnection,
    ctx: PartyKitContext
  ) {
    // 1. 认证
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      conn.close(4001, "Missing authentication token");
      return;
    }

    const user = await verifyToken(
      token,
      this.room.env.JWT_SECRET
    );

    if (!user) {
      conn.close(4003, "Invalid or expired token");
      return;
    }

    // 2. 记录用户元数据
    const metadata: UserMetadata = {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      color: user.color,
      role: user.role,
      joinedAt: Date.now(),
    };
    this.connections.set(conn.id, metadata);

    // 3. 广播用户加入通知
    this.room.broadcast(
      JSON.stringify({
        type: "presence:join",
        user: metadata,
        totalUsers: this.connections.size,
      }),
      [] // 广播给所有人（包括发送者）
    );

    // 4. 配置 Yjs 同步
    onConnect(conn, this.room, {
      persist: {
        mode: "snapshot",
        load: async (roomId: string) => {
          console.log(`Loading document: ${roomId}`);
          return await loadDocument(roomId, this.room.env);
        },
      },
      callback: {
        handler: async (doc) => {
          await persistDocument(
            this.room.id,
            doc,
            this.room.env
          );
        },
      },
      readOnly: user.role === "viewer",
    });

    // 5. 发送房间状态给新连接
    conn.send(
      JSON.stringify({
        type: "room:state",
        roomId: this.room.id,
        onlineUsers: Array.from(this.connections.values()),
        serverTime: Date.now(),
      })
    );
  }

  // ──────────────── 消息处理 ────────────────

  onMessage(
    message: string | ArrayBuffer,
    sender: PartyKitConnection
  ) {
    // Yjs 的二进制消息由 y-partykit 自动处理
    // 这里只处理自定义的 JSON 消息
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);

      switch (data.type) {
        // 客户端主动请求房间状态
        case "room:sync":
          sender.send(
            JSON.stringify({
              type: "room:state",
              onlineUsers: Array.from(
                this.connections.values()
              ),
            })
          );
          break;

        // 客户端发送编辑操作事件（用于 analytics）
        case "edit:event":
          this.handleEditEvent(data, sender);
          break;

        default:
          break;
      }
    } catch {
      // 非 JSON 消息，忽略
    }
  }

  // ──────────────── HTTP 请求处理 ────────────────

  async onRequest(req: Request) {
    const url = new URL(req.url);

    // 验证服务端 API Key
    const authHeader = req.headers.get("Authorization");
    const isValidServer =
      authHeader ===
      `Bearer ${this.room.env.SERVER_API_KEY}`;

    if (!isValidServer && url.pathname.startsWith("/api/")) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 路由
    switch (url.pathname) {
      case "/api/status":
        return this.handleStatusRequest();

      case "/api/broadcast":
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
          });
        }
        return this.handleBroadcastRequest(req);

      case "/api/kick":
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
          });
        }
        return this.handleKickRequest(req);

      default:
        return new Response("Not Found", { status: 404 });
    }
  }

  private handleStatusRequest(): Response {
    return new Response(
      JSON.stringify({
        roomId: this.room.id,
        activeConnections: this.connections.size,
        users: Array.from(this.connections.entries()).map(
          ([connId, user]) => ({
            connectionId: connId,
            ...user,
          })
        ),
        uptime: Date.now(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  private async handleBroadcastRequest(
    req: Request
  ): Promise<Response> {
    const body = await req.json();
    this.room.broadcast(JSON.stringify(body));

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async handleKickRequest(
    req: Request
  ): Promise<Response> {
    const { userId } = (await req.json()) as {
      userId: string;
    };

    let kicked = false;
    for (const [connId, user] of this.connections) {
      if (user.id === userId) {
        // 断开该用户的连接
        const connections = this.room.getConnections();
        for (const conn of connections) {
          if (conn.id === connId) {
            conn.close(
              4005,
              "You have been removed from this session"
            );
            kicked = true;
            break;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ kicked }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // ──────────────── 连接关闭处理 ────────────────

  onClose(conn: PartyKitConnection) {
    const user = this.connections.get(conn.id);
    this.connections.delete(conn.id);

    if (user) {
      // 广播用户离开
      this.room.broadcast(
        JSON.stringify({
          type: "presence:leave",
          userId: user.id,
          userName: user.name,
          totalUsers: this.connections.size,
        })
      );
    }

    console.log(
      `[Room ${this.room.id}] Connection closed: ${conn.id}. ` +
      `Remaining: ${this.connections.size}`
    );
  }

  // ──────────────── 辅助方法 ────────────────

  private handleEditEvent(
    data: any,
    sender: PartyKitConnection
  ) {
    const user = this.connections.get(sender.id);
    if (!user) return;

    // 记录编辑事件用于 analytics
    // 实际项目中可以推送到 Laravel 后端
    console.log(
      `[Edit] User ${user.name} performed: ${data.action}`
    );
  }
}
```

### 8.3 认证中间件

```typescript
// partykit/auth.ts
export interface VerifiedUser {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  role: string;
  permissions: {
    read: boolean;
    write: boolean;
    admin: boolean;
  };
}

// JWT 验证（Cloudflare Workers 环境）
export async function verifyToken(
  token: string,
  secret: string
): Promise<VerifiedUser | null> {
  try {
    // 简化的 JWT 解码和验证
    // 生产环境建议使用 jose 库
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // 解码 header
    const header = JSON.parse(atob(parts[0]));
    if (header.alg !== "HS256") return null;

    // 解码 payload
    const payload = JSON.parse(atob(parts[1]));

    // 验证过期时间
    if (payload.exp && payload.exp < Date.now() / 1000) {
      console.log("Token expired");
      return null;
    }

    // 验证签名
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signature = base64UrlToBuffer(parts[2]);
    const data = encoder.encode(`${parts[0]}.${parts[1]}`);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      data
    );

    if (!valid) {
      console.log("Invalid signature");
      return null;
    }

    return {
      id: payload.sub,
      name: payload.user.name,
      avatar: payload.user.avatar,
      color: payload.user.color,
      role: payload.user.role,
      permissions: payload.permissions,
    };
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

function base64UrlToBuffer(base64Url: string): ArrayBuffer {
  const base64 = base64Url
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}
```

---

## 第九部分：Pusher / Ably / Laravel Reverb 对比

### 9.1 方案概览

在选择实时协作方案时，市面上有几个主流选择。下面我们将从多个维度进行对比分析。

### 9.2 功能对比表

| 维度 | PartyKit | Pusher Channels | Ably | Laravel Reverb |
|------|----------|-----------------|------|----------------|
| **架构模型** | Serverless (边缘 DO) | 托管 WebSocket 服务 | 托管全球网络 | 自托管 WebSocket |
| **有状态服务端逻辑** | ✅ 完整支持 | ❌ 仅消息传递 | ❌ 仅消息传递 | ❌ 需自建 |
| **CRDT/Yjs 内置支持** | ✅ y-partykit 官方包 | ❌ 需手动实现 | ❌ 需手动实现 | ❌ 需手动实现 |
| **全球边缘部署** | ✅ Cloudflare 全球 | ✅ 全球多区域 | ✅ 全球多区域 | ❌ 自行部署 |
| **运维成本** | 零运维 | 零运维 | 零运维 | 需运维 |
| **编程语言** | TypeScript/JavaScript | 多语言 SDK | 多语言 SDK | PHP (Laravel) |
| **认证集成** | 自行实现 | 简单认证钩子 | Token 认证 | Laravel Auth 原生 |
| **Presence 支持** | ✅ Awareness API | ✅ Presence Channels | ✅ Presence | ✅ Presence Channels |
| **离线支持** | ✅ CRDT 天然支持 | ❌ | ❌ | ❌ |
| **每连接内存** | 极低 (DO 共享) | 未知 | 未知 | 取决于服务器配置 |
| **最大并发连接** | 无限（按 DO 自动扩展） | 取决于套餐 | 取决于套餐 | 取决于服务器 |

### 9.3 价格对比（2026 年参考）

| 方案 | 免费额度 | 付费起步价 | 10 万连接/月估算 |
|------|---------|-----------|----------------|
| **PartyKit** | 10 万请求/天 | $5/月 | ~$20-50/月 |
| **Pusher** | 20 万消息/天, 100 连接 | $49/月 | ~$249-499/月 |
| **Ably** | 600 万消息/月, 200 连接 | $29/月 | ~$199-499/月 |
| **Laravel Reverb** | 无限（自托管） | 仅服务器成本 | ~$50-100/月 (VPS) |

> 注：价格仅供参考，实际费用取决于消息量、并发数、带宽等因素。

### 9.4 各方案优劣分析

**PartyKit 的优势**：

1. **真正的 serverless 有状态后端**：每个房间是一个独立的 DO，天然适合多人编辑场景
2. **Yjs 原生集成**：`y-partykit` 包开箱即用，大幅降低 CRDT 集成成本
3. **成本低**：对于中小规模应用，PartyKit 的免费额度和低价付费方案非常友好
4. **零运维**：无需管理 WebSocket 服务器集群
5. **边缘计算**：全球 300+ 节点，低延迟

**PartyKit 的局限**：

1. **锁定 Cloudflare 生态**：无法在其他云平台运行
2. **社区规模较小**：相比 Pusher/Ably，生态和文档完善度还有差距
3. **调试工具不足**：缺少成熟的调试面板和监控工具
4. **冷启动**：DO 首次激活可能有微小延迟

**Pusher/Ably 的优势**：

1. **成熟稳定**：经过大规模生产验证
2. **丰富的 SDK**：支持几乎所有编程语言和平台
3. **完善的监控**：Dashboard、日志、Analytics 一应俱全
4. **企业级 SLA**：99.99%+ 可用性保证

**Laravel Reverb 的优势**：

1. **与 Laravel 深度集成**：Events、Broadcasting、Echo 无缝衔接
2. **完全控制**：数据不出自己的服务器，安全合规
3. **成本可控**：无消息量计费，只需服务器费用
4. **PHP 生态**：Laravel 开发者零学习成本

### 9.5 选型建议

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 多人文档协作（类 Google Docs） | **PartyKit + Yjs** | CRDT 原生支持，成本低 |
| 简单实时通知/消息 | Pusher 或 Ably | API 简单，SDK 丰富 |
| 已有 Laravel 应用加实时功能 | **Laravel Reverb** | 无缝集成，零额外学习 |
| 企业级合规/数据不出境 | Laravel Reverb（自托管） | 完全数据自主权 |
| 低预算/初创项目 | **PartyKit** | 免费额度大，价格低 |
| 多平台（Web + Mobile + Desktop） | Ably | SDK 最全面 |

---

## 第十部分：性能与成本分析

### 10.1 PartyKit 性能特征

#### 10.1.1 延迟特性

```
┌───────────────────────────────────────────────────────────┐
│               PartyKit 延迟分布（实测参考值）                │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  操作类型              延迟 (p50)    延迟 (p99)           │
│  ─────────────────────────────────────────────────        │
│  WebSocket 建立连接     ~50ms        ~200ms              │
│  Yjs 首次同步          ~100ms       ~500ms              │
│  单次文本编辑同步       ~10ms        ~50ms               │
│  Awareness 广播        ~5ms         ~30ms               │
│  HTTP API 请求         ~30ms        ~150ms              │
│  DO 冷启动恢复         ~200ms       ~800ms              │
│                                                           │
│  注：以上为同一区域（同大洲）测量值                          │
│  跨洲延迟约为同区域的 2-5 倍                               │
└───────────────────────────────────────────────────────────┘
```

#### 10.1.2 吞吐量

PartyKit 的吞吐量受限于单个 Durable Object 的处理能力：

- **单个 DO 的 WebSocket 消息吞吐**：约 1,000-5,000 msg/s（取决于消息大小和处理逻辑）
- **单个 DO 的并发 WebSocket 迭接数**：建议不超过 1,000（超出可能需要分区策略）
- **Storage 写入**：约 1,000 writes/s
- **Storage 读取**：约 10,000 reads/s

#### 10.1.3 Yjs 性能优化

```typescript
// 优化 1：使用增量同步而非全量
// 默认行为，y-partykit 已自动处理

// 优化 2：Awareness 更新节流
provider.awareness.setLocalStateField = throttle(
  provider.awareness.setLocalStateField.bind(
    provider.awareness
  ),
  100 // 100ms 节流
);

// 优化 3：文档分块（适用于超大文档）
// 将一个大文档拆分为多个 Y.Doc
const sectionDocs = new Map<string, Y.Doc>();

function getSectionDoc(sectionId: string): Y.Doc {
  if (!sectionDocs.has(sectionId)) {
    const doc = new Y.Doc();
    // 每个 section 独立的 provider
    const provider = new WebsocketProvider(
      PARTYKIT_HOST,
      `doc-${documentId}-section-${sectionId}`,
      doc
    );
    sectionDocs.set(sectionId, doc);
  }
  return sectionDocs.get(sectionId)!;
}

// 优化 4：GC（垃圾回收）策略
// 只保留最近 N 个版本的编辑历史
const doc = new Y.Doc();
// y-partykit 配置
onConnect(conn, room, {
  gcFilter: (item) => {
    // 保留所有未删除的内容
    return !item.deleted;
  },
});
```

### 10.2 成本分析

#### 10.2.1 PartyKit 计费模型

PartyKit 的计费基于 Cloudflare Workers 的定价模型：

| 计费项 | 免费额度 | 超出单价 |
|--------|---------|---------|
| 请求次数 | 10 万次/天 | $0.30 / 百万次 |
| CPU 时间 | 10ms/请求 | $0.02 / 百万 CPU-ms |
| Durable Objects 请求 | 100 万次/月 | $0.15 / 百万次 |
| DO 存储读取 | 100 万次/月 | $0.20 / 百万次 |
| DO 存储写入 | 100 万次/月 | $1.00 / 百万次 |
| DO 存储容量 | 1 GB | $0.20 / GB-月 |
| 出站带宽 | 无限 | 免费 |

#### 10.2.2 不同规模的成本估算

**场景 1：小型团队工具（10 人，5 个活跃房间）**

```
日均请求: ~5,000 次
月均请求: ~150,000 次
DO 存储: ~100 MB
月估算成本: $0（免费额度内）
```

**场景 2：中型 SaaS 产品（1,000 用户，50 个活跃房间）**

```
日均请求: ~200,000 次
月均请求: ~6,000,000 次
DO 存储: ~5 GB
月估算成本:
  请求费: (6M - 3M 免费) × $0.30/百万 = $0.90
  存储费: (5GB - 1GB) × $0.20/GB = $0.80
  合计: ~$2-5/月
```

**场景 3：大型应用（10 万用户，1,000 个活跃房间）**

```
日均请求: ~10,000,000 次
月均请求: ~300,000,000 次
DO 存储: ~100 GB
月估算成本:
  请求费: 300M × $0.30/百万 = $90
  DO 请求费: ~$15
  存储费: 100GB × $0.20 = $20
  合计: ~$130-200/月
```

#### 10.2.3 与竞品的成本对比

以"1,000 用户，月发送 1 亿条消息"为例：

| 方案 | 月成本估算 |
|------|-----------|
| PartyKit | ~$30-50 |
| Pusher (Startup Plan) | ~$249-499 |
| Ably (Pro Plan) | ~$199-499 |
| Laravel Reverb (4GB VPS) | ~$40-80 + 运维人力成本 |

> 注：PartyKit 的成本优势在小规模时最为明显。当规模巨大时，自建方案（如 Reverb）可能更经济，但需要考虑运维成本。

### 10.3 性能优化最佳实践

```typescript
// 最佳实践 1：连接管理
// 监听 visibilitychange，后台时断开 WebSocket 节省资源
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    // 页面隐藏 30 秒后断开
    disconnectTimeout = setTimeout(() => {
      provider.disconnect();
    }, 30000);
  } else {
    clearTimeout(disconnectTimeout);
    provider.connect();
  }
});

// 最佳实践 2：消息压缩
// 对大型消息使用压缩
import { compress, decompress } from "lz-string";

function sendCompressed(ws: WebSocket, data: any) {
  const json = JSON.stringify(data);
  if (json.length > 1024) {
    // 大于 1KB 的消息进行压缩
    ws.send(compress(json));
  } else {
    ws.send(json);
  }
}

// 最佳实践 3：批量操作
// 将多个小操作合并为一个事务
doc.transact(() => {
  yText.delete(0, 5);
  yText.insert(0, "Hello");
  yMeta.set("title", "Updated Title");
  yMeta.set("updatedAt", Date.now());
});
// 整个事务产生一个 update 事件，减少网络传输

// 最佳实践 4：选择性字段同步
// 不需要实时同步的字段使用单独的 Y.Map
const yTransient = doc.getMap("transient"); // 不持久化
const yPersisted = doc.getMap("persisted"); // 持久化
```

---

## 第十一部分：生产环境部署与注意事项

### 11.1 部署流程

```bash
# 1. 安装 PartyKit CLI
npm install -g partykit

# 2. 初始化项目
npx partykit init collab-editor

# 3. 本地开发
npx partykit dev

# 4. 部署到 Cloudflare
npx partykit deploy

# 输出：
# ✅ Deployed collab-editor to
#    https://collab-editor.your-account.partykit.dev
```

### 11.2 环境变量配置

```bash
# .env (PartyKit)
PARTYKIT_VARS='{"JWT_SECRET":"your-secret-key","LARAVEL_API_URL":"https://api.example.com","LARAVEL_API_KEY":"your-api-key","SERVER_API_KEY":"your-server-key"}'
```

### 11.3 监控与可观测性

```typescript
// partykit/server.ts 中添加监控指标
export default class CollabServer implements PartyKitServer {
  private metrics = {
    totalConnections: 0,
    totalMessages: 0,
    totalErrors: 0,
    startTime: Date.now(),
  };

  onConnect(conn: PartyKitConnection, ctx: PartyKitContext) {
    this.metrics.totalConnections++;
    // ... 正常逻辑
  }

  onMessage(message: string | ArrayBuffer, sender: PartyKitConnection) {
    this.metrics.totalMessages++;
    // ... 正常逻辑
  }

  async onRequest(req: Request) {
    const url = new URL(req.url);

    // 指标端点
    if (url.pathname === "/api/metrics") {
      return new Response(
        JSON.stringify({
          ...this.metrics,
          activeConnections: this.connections.size,
          uptimeMs: Date.now() - this.metrics.startTime,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    // ... 其他路由
  }
}
```

### 11.4 安全注意事项

1. **JWT Token 过期时间**：建议设置较短的过期时间（2-4 小时），并实现无感刷新
2. **WebSocket 连接认证**：在 `onConnect` 阶段完成认证，不通过则立即断开
3. **速率限制**：在 PartyKit 服务端实现基本的速率限制，防止消息洪水
4. **输入校验**：对客户端发送的非 Yjs 消息进行严格校验
5. **Webhook 签名验证**：Laravel 接收 Webhook 时必须验证 HMAC 签名
6. **CORS 配置**：限制允许的来源域名
7. **存储加密**：敏感文档的 Yjs 状态在存储前进行加密

```typescript
// 速率限制实现示例
class RateLimiter {
  private counts: Map<string, number[]> = new Map();

  check(
    key: string,
    maxRequests: number,
    windowMs: number
  ): boolean {
    const now = Date.now();
    const timestamps = this.counts.get(key) || [];
    const validTimestamps = timestamps.filter(
      (t) => now - t < windowMs
    );

    if (validTimestamps.length >= maxRequests) {
      return false; // 速率限制触发
    }

    validTimestamps.push(now);
    this.counts.set(key, validTimestamps);
    return true;
  }
}

// 在 onMessage 中使用
const limiter = new RateLimiter();

onMessage(message: string | ArrayBuffer, sender: PartyKitConnection) {
  if (!limiter.check(sender.id, 100, 1000)) {
    // 每秒最多 100 条消息
    sender.send(JSON.stringify({
      type: "error",
      code: "RATE_LIMIT",
      message: "Too many messages, slow down",
    }));
    return;
  }
  // ... 正常处理
}
```

---

## 第十二部分：完整示例项目回顾

### 12.1 技术栈总结

```
┌──────────────────────────────────────────────────────────┐
│                    完整技术栈一览                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  前端 (Client)                                           │
│  ├── React 18 + TypeScript                               │
│  ├── Tiptap Editor (基于 ProseMirror)                    │
│  ├── Yjs + y-partykit/provider                           │
│  └── Tailwind CSS                                        │
│                                                          │
│  实时后端 (PartyKit)                                      │
│  ├── PartyKit Server (TypeScript)                        │
│  ├── y-partykit (Yjs 同步)                               │
│  ├── Cloudflare Durable Objects                          │
│  └── Cloudflare Workers Runtime                          │
│                                                          │
│  应用后端 (Laravel)                                       │
│  ├── Laravel 11 + PHP 8.3                                │
│  ├── JWT 认证 (firebase/php-jwt)                         │
│  ├── MySQL 8.0 / PostgreSQL 16                           │
│  └── Redis (缓存/队列)                                   │
│                                                          │
│  部署                                                     │
│  ├── 前端: Vercel / Cloudflare Pages                     │
│  ├── PartyKit: Cloudflare Workers                        │
│  ├── Laravel: AWS / DigitalOcean                         │
│  └── CDN: Cloudflare                                     │
└──────────────────────────────────────────────────────────┘
```

### 12.2 关键实现要点回顾

1. **Yjs + PartyKit 的结合**：通过 `y-partykit` 包，用不到 50 行代码就实现了完整的 Yjs WebSocket 同步，包括文档同步、Awareness 传播和持久化。

2. **认证链路**：Laravel 签发 JWT → 前端携带 JWT 连接 PartyKit → PartyKit 验证 JWT → 建立受保护的 WebSocket 连接。

3. **数据持久化策略**：PartyKit 定期将 Yjs 文档快照推送到 Laravel API，Laravel 将其存入数据库。这种"被动持久化"模式避免了实时写入的性能开销。

4. **Presence 与光标**：利用 Yjs Awareness 协议实现在线状态和光标同步，不需要额外的基础设施。

5. **Webhook 回调**：PartyKit 通过 Webhook 将关键事件（用户加入/离开/文档更新）通知给 Laravel，触发业务逻辑。

---

## 第十三部分：常见坑与排障指南

在实际落地 PartyKit + Yjs + Laravel 的协作方案时，开发者经常会遇到以下问题。提前了解这些坑可以节省大量调试时间。

### 13.1 典型问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 新用户打开文档看到空白 | y-partykit 的 `load` 回调返回了 `null` | 检查 Laravel API 是否正确返回 Yjs 二进制状态，确保 Content-Type 为 `application/json` |
| 多人编辑时出现重复内容 | Yjs 的 sync step 未完成就允许用户编辑 | 在 `provider.on("sync")` 回调中 `synced === true` 后再启用编辑器输入 |
| 光标位置偏移 / 选区错位 | 编辑器视口滚动后未更新 DOM 坐标 | 监听编辑器 `scroll` 事件，调用 `coordsAtPos` 重新计算所有远程光标坐标 |
| 断线重连后文档状态不一致 | 客户端未正确合并远端 update | 使用 `Y.encodeStateAsUpdate(doc, remoteVector)` 做差异同步，避免全量覆盖 |
| Presence 中出现"幽灵用户" | 客户端异常退出未触发 `onClose` | 在服务端设置 30 秒心跳超时，超时未收到心跳则清理连接 |
| JWT Token 过期导致连接中断 | Token 有效期太短或无刷新机制 | 实现 Token 提前刷新，在 `provider.on("status")` 检测断连后获取新 Token 自动重连 |
| 大文档首次同步极慢 | 全量 State 太大（>5MB） | 使用 `encodeStateAsUpdate(doc, remoteVector)` 增量同步，并启用 `gcFilter` 定期清理历史 |
| Cloudflare Workers 超时 | 单次请求 CPU 时间超过 30s | 将重计算逻辑拆分为多个 micro-task，或使用 `ctx.waitUntil()` 延长执行时间 |

### 13.2 排障代码示例

```typescript
// 连接状态监控与自动重连（含 Token 刷新）
import { WebsocketProvider } from "y-partykit/provider";

function setupResilientConnection(
  host: string,
  room: string,
  getToken: () => Promise<string>
) {
  let currentToken: string | null = null;
  let provider: WebsocketProvider | null = null;

  async function connect() {
    currentToken = await getToken();

    provider = new WebsocketProvider(host, room, doc, {
      params: { token: currentToken! },
      connect: true,
    });

    // 监听连接状态
    provider.on("status", async (event) => {
      if (event.status === "disconnected") {
        console.warn("连接断开，3 秒后重试...");
        setTimeout(async () => {
          // 刷新 Token 后重连
          currentToken = await getToken();
          provider?.connect();
        }, 3000);
      }

      if (event.status === "connected") {
        console.log("连接成功");
      }
    });

    // 等待文档同步完成再启用编辑
    provider.on("sync", (synced: boolean) => {
      if (synced) {
        console.log("文档同步完成，可以开始编辑");
        enableEditorInput(true);
      }
    });
  }

  connect();
  return () => provider?.destroy();
}
```

```php
<?php
// Laravel 中的 Yjs 状态存储模型迁移
// 确保数据库字段大小足够容纳大型文档

// database/migrations/xxxx_xx_xx_create_documents_table.php
Schema::create('documents', function (Blueprint $table) {
    $table->id();
    $table->uuid('uuid')->unique();
    $table->string('title');
    $table->longText('yjs_state');           // 存储 Yjs 二进制状态（base64）
    $table->text('plain_text_preview')->nullable(); // 纯文本预览（全文搜索用）
    $table->unsignedInteger('word_count')->default(0);
    $table->timestamp('last_synced_at')->nullable();
    $table->timestamps();

    $table->index('last_synced_at');
});
```

---

## 结语

PartyKit 代表了实时 Web 应用开发的一种新范式——将"有状态的实时后端"以 serverless 的方式提供给开发者。与传统的自建 WebSocket 服务器相比，它大幅降低了运维复杂度；与 Pusher/Ably 等托管服务相比，它提供了更大的灵活性和更低的成本。

对于需要构建多人协作功能的 Laravel 项目，PartyKit + Yjs 是一个值得认真考虑的方案。它的核心优势在于：

- **零运维**的有状态实时后端
- **开箱即用**的 CRDT 协作支持
- **极具竞争力**的成本模型
- 与 Laravel **互不干扰但深度集成**的架构模式

当然，PartyKit 并非银弹。如果你的团队已经深度使用 Laravel 生态，Laravel Reverb 可能是更自然的选择；如果你需要企业级的 SLA 保证，Pusher 或 Ably 更为稳妥。技术选型永远是在具体场景下的权衡取舍。

希望这篇文章能为你在实时协作领域的技术选型和实现提供实质性的参考。如果你正在构建类似的功能，欢迎参考文中代码并在实际项目中验证和改进。

---

## 参考资料

1. [PartyKit 官方文档](https://docs.partykit.io/)
2. [Yjs 官方文档](https://docs.yjs.dev/)
3. [Cloudflare Durable Objects 文档](https://developers.cloudflare.com/durable-objects/)
4. [y-partykit 源码](https://github.com/partykit/y-partykit)
5. [CRDT 论文：Conflict-free Replicated Data Types](https://hal.inria.fr/inria-00609399v1/document)
6. [Tiptap 协作编辑器文档](https://tiptap.dev/docs/collaboration/getting-started)
7. [Laravel API 认证最佳实践](https://laravel.com/docs/11.x/sanctum)
8. [WebSocket 协议 RFC 6455](https://tools.ietf.org/html/rfc6455)

---

## 相关阅读

- [SSE vs WebSocket vs HTTP Streaming 实时通信方案工程选型](/categories/架构/2026-06-03-SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型/) — Laravel Reverb WebSocket 实战与三种推送架构深度对比，帮你从延迟、吞吐与资源消耗三个维度做出工程选型
- [Supabase 实战：开源 Firebase 替代——实时数据库 Auth 与 Laravel 集成](/categories/架构/2026-06-03-Supabase-实战-开源Firebase替代-实时数据库Auth与Laravel集成/) — Supabase 作为开源 Firebase 替代方案，提供实时数据库、认证与 Laravel 集成的完整实践
- [WebTransport 实战：HTTP/3 双向通信——对比 WebSocket 低延迟传输协议 Laravel 实时应用集成](/categories/架构/WebTransport-实战-HTTP3-双向通信-对比WebSocket低延迟传输协议-Laravel实时应用集成/) — 下一代传输协议 WebTransport 实战，与 WebSocket 对比延迟与吞吐量，适合对实时性要求极高的场景
