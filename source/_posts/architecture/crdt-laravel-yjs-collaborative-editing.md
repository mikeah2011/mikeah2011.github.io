---

title: CRDT 实战：无冲突复制数据类型——Laravel + Yjs 的多人协同编辑架构，对比 OT 算法的工程选型
keywords: [CRDT, Laravel, Yjs, OT, 无冲突复制数据类型, 的多人协同编辑架构, 算法的工程选型, 架构]
date: 2026-06-09 17:18:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
- CRDT
- 协同编辑
- Yjs
- Laravel
- WebSocket
- 分布式
- OT
description: 深入解析 CRDT 与 OT 两种协同编辑算法的原理差异，用 Laravel + Yjs 搭建可落地的多人实时协同编辑系统，包含完整前后端代码、踩坑记录与工程选型建议。
---



## 概述

多人实时协同编辑——Google Docs、Figma、Notion 背后的核心技术。当你和同事同时编辑同一段文字，系统如何保证最终结果一致？

两种主流方案：

- **OT（Operational Transformation）**：Google Docs 的选择，中心化服务器协调
- **CRDT（Conflict-free Replicated Data Type）**：Figma、Yjs 的选择，数学保证无冲突

本文用 Laravel + Yjs 搭建一套完整的协同编辑系统，对比两种算法的工程差异，给出可直接跑通的代码。

## 核心概念

### 什么是 OT？

OT 的核心思想：客户端发送操作（insert/delete），服务器对操作进行变换（transform），保证所有客户端最终状态一致。

```
客户端 A: insert("Hello", pos=0)
客户端 B: insert("World", pos=0)

服务器变换后:
  A 的操作不变: insert("Hello", pos=0)
  B 的操作变换: insert("World", pos=5)  // 因为 A 先插入了 5 个字符

最终结果: "HelloWorld"
```

**问题**：需要中心化服务器做变换，算法复杂度随并发数指数增长，断网后无法离线编辑。

### 什么是 CRDT？

CRDT 是一类数据结构，其数学性质保证：无论操作以什么顺序到达，最终状态一定收敛一致。

```
两个副本:
  副本 A: "Hello"
  副本 B: "Hello"

A 本地插入 " World" → "Hello World"
B 本地插入 "!" → "Hello!"

合并后（任意顺序）: "Hello World!"
```

**关键优势**：
- 无需中心化服务器协调
- 天然支持离线编辑
- 合并操作 O(1) 复杂度

### Yjs：生产级 CRDT 实现

Yjs 是目前最成熟的 CRDT 库，支持：

- **Y.Text**：富文本协同
- **Y.Array**：有序列表
- **Y.Map**：键值对
- **Y.XmlFragment**：XML/HTML 结构

核心特性：
- 基于 YATA 算法（Yet Another Transformation Approach）
- 文档体积压缩（增量更新 + 编码优化）
- 丰富的 Provider 生态（WebSocket、WebRTC、IndexedDB）

## 实战：Laravel + Yjs 协同编辑系统

### 架构设计

```
┌─────────────┐     WebSocket      ┌──────────────┐
│   浏览器 A   │◄──────────────────►│              │
│   Yjs Doc   │                    │  Laravel +   │
└─────────────┘                    │  Soketi      │
                                   │  (WebSocket) │
┌─────────────┐     WebSocket      │              │
│   浏览器 B   │◄──────────────────►│              │
│   Yjs Doc   │                    └──────┬───────┘
└─────────────┘                           │
                                          │ HTTP API
                                   ┌──────▼───────┐
                                   │   MySQL /    │
                                   │   Redis      │
                                   └──────────────┘
```

前端用 Yjs 管理文档状态，通过 WebSocket 同步。后端 Laravel 用 Soketi（Pusher 兼容的 WebSocket 服务器）做消息中转，MySQL 持久化文档快照。

### 1. 后端搭建

#### 安装依赖

```bash
composer require beyondcode/laravel-websockets
composer require pusher/pusher-php-server
php artisan vendor:publish --provider="BeyondCode\LaravelWebSockets\WebSocketsServiceProvider" --tag="config"
```

#### 配置 .env

```env
BROADCAST_DRIVER=pusher

PUSHER_APP_ID=local
PUSHER_APP_KEY=local-key
PUSHER_APP_SECRET=local-secret
PUSHER_APP_CLUSTER=mt1

LARAVEL_WEBSOCKETS_PORT=6001
```

#### 配置 config/broadcasting.php

```php
'connections' => [
    'pusher' => [
        'driver' => 'pusher',
        'key' => env('PUSHER_APP_KEY'),
        'secret' => env('PUSHER_APP_SECRET'),
        'app_id' => env('PUSHER_APP_ID'),
        'options' => [
            'host' => '127.0.0.1',
            'port' => env('LARAVEL_WEBSOCKETS_PORT', 6001),
            'scheme' => 'http',
            'useTLS' => false,
        ],
    ],
],
```

#### 文档模型和迁移

```bash
php artisan make:model Document -m
php artisan make:model DocumentSnapshot -m
```

```php
// database/migrations/xxxx_create_documents_table.php
Schema::create('documents', function (Blueprint $table) {
    $table->id();
    $table->string('title');
    $table->string('uid')->unique(); // 文档唯一标识
    $table->text('content')->nullable();
    $table->json('yjs_state')->nullable(); // Yjs 编码后的状态
    $table->foreignId('created_by')->constrained('users');
    $table->timestamps();
});
```

```php
// database/migrations/xxxx_create_document_snapshots_table.php
Schema::create('document_snapshots', function (Blueprint $table) {
    $table->id();
    $table->foreignId('document_id')->constrained()->cascadeOnDelete();
    $table->binary('state'); // Yjs 编码状态（二进制）
    $table->integer('version')->default(0);
    $table->timestamps();
});
```

#### Document 模型

```php
// app/Models/Document.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Document extends Model
{
    protected $fillable = ['title', 'uid', 'content', 'yjs_state', 'created_by'];

    protected $casts = [
        'yjs_state' => 'array',
    ];

    public function snapshots(): HasMany
    {
        return $this->hasMany(DocumentSnapshot::class)->latest('version');
    }

    public function latestSnapshot()
    {
        return $this->snapshots()->first();
    }
}
```

```php
// app/Models/DocumentSnapshot.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DocumentSnapshot extends Model
{
    protected $fillable = ['document_id', 'state', 'version'];

    protected $casts = [
        'state' => 'binary',
    ];
}
```

#### WebSocket 频道授权

```php
// routes/channels.php
use App\Models\Document;

Broadcast::channel('document.{uid}', function ($user, $uid) {
    $document = Document::where('uid', $uid)->first();

    if (!$document) {
        return null;
    }

    // 可以在这里做权限检查
    return [
        'id' => $user->id,
        'name' => $user->name,
    ];
});
```

#### Yjs 同步 API

```php
// app/Http/Controllers/DocumentController.php
namespace App\Http\Controllers;

use App\Models\Document;
use App\Models\DocumentSnapshot;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class DocumentController extends Controller
{
    public function index()
    {
        return Document::with('latestSnapshot')
            ->latest()
            ->paginate(20);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
        ]);

        return Document::create([
            ...$validated,
            'uid' => Str::uuid(),
            'created_by' => $request->user()->id,
        ]);
    }

    public function show(Document $document)
    {
        $document->load('latestSnapshot');
        return $document;
    }

    /**
     * 保存 Yjs 状态快照
     * 前端定期调用，将 Yjs 编码后的状态持久化
     */
    public function saveSnapshot(Request $request, Document $document)
    {
        $validated = $request->validate([
            'state' => 'required|string', // base64 编码的 Yjs 状态
            'version' => 'required|integer',
        ]);

        $state = base64_decode($validated['state']);

        // 保存快照
        DocumentSnapshot::create([
            'document_id' => $document->id,
            'state' => $state,
            'version' => $validated['version'],
        ]);

        // 更新文档内容（从 Yjs 状态提取纯文本）
        $document->update([
            'yjs_state' => ['version' => $validated['version']],
        ]);

        return response()->json(['ok' => true]);
    }

    /**
     * 获取最新 Yjs 状态
     * 新用户加入时调用，用于初始化本地文档
     */
    public function loadSnapshot(Document $document)
    {
        $snapshot = $document->latestSnapshot();

        if (!$snapshot) {
            return response()->json(['state' => null, 'version' => 0]);
        }

        return response()->json([
            'state' => base64_encode($snapshot->state),
            'version' => $snapshot->version,
        ]);
    }
}
```

```php
// routes/api.php
use App\Http\Controllers\DocumentController;

Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('documents', DocumentController::class);
    Route::post('documents/{document}/snapshot', [DocumentController::class, 'saveSnapshot']);
    Route::get('documents/{document}/snapshot', [DocumentController::class, 'loadSnapshot']);
});
```

### 2. 前端搭建

#### 安装依赖

```bash
npm install yjs y-websocket y-indexeddb y-prosemirror
npm install @tiptap/core @tiptap/starter-kit @tiptap/extension-collaboration @tiptap/extension-collaboration-cursor
npm install lib0
```

#### Yjs Provider 封装

```javascript
// resources/js/collaboration/yjs-provider.js
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

export class CollaborationProvider {
  constructor(options) {
    this.docUid = options.docUid;
    this.wsUrl = options.wsUrl || 'ws://127.0.0.1:6001';
    this.token = options.token; // Laravel Echo auth token
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onSync = options.onSync || (() => {});
    this.awareness = options.awareness || {};

    // 创建 Yjs 文档
    this.ydoc = new Y.Doc();

    // IndexedDB 本地持久化（离线支持）
    this.indexeddbProvider = new IndexeddbPersistence(
      `document-${this.docUid}`,
      this.ydoc
    );

    this.indexeddbProvider.on('synced', () => {
      console.log('[Yjs] IndexedDB synced');
    });

    // WebSocket 远程同步
    this.wsProvider = new WebsocketProvider(
      this.wsUrl,
      `document-${this.docUid}`,
      this.ydoc,
      {
        params: {
          auth: this.token,
        },
      }
    );

    // 连接状态
    this.wsProvider.on('status', (event) => {
      this.onStatusChange(event.status);
    });

    // 同步完成
    this.wsProvider.on('sync', (synced) => {
      if (synced) {
        this.onSync();
      }
    });

    // Awareness（显示其他用户光标）
    this.wsProvider.awareness.setLocalStateField('user', {
      name: this.awareness.name || 'Anonymous',
      color: this.awareness.color || this._randomColor(),
    });
  }

  get ydoc() {
    return this._ydoc;
  }

  set ydoc(doc) {
    this._ydoc = doc;
  }

  getSharedType(name, typeConstructor = Y.Text) {
    return this.ydoc.getText(name);
  }

  destroy() {
    this.wsProvider?.destroy();
    this.indexeddbProvider?.destroy();
    this.ydoc?.destroy();
  }

  _randomColor() {
    const colors = [
      '#F44336', '#E91E63', '#9C27B0', '#673AB7',
      '#3F51B5', '#2196F3', '#00BCD4', '#4CAF50',
      '#FF9800', '#795548',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
```

#### TipTap 编辑器集成

```javascript
// resources/js/collaboration/editor.js
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { CollaborationProvider } from './yjs-provider';

export function createCollaborativeEditor(element, options) {
  const { docUid, token, userName, onStatusChange } = options;

  // 创建协作 Provider
  const provider = new CollaborationProvider({
    docUid,
    wsUrl: `ws://${window.location.hostname}:6001`,
    token,
    onStatusChange,
    awareness: { name: userName },
  });

  // 创建 TipTap 编辑器
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        history: false, // 禁用默认 history，使用 Yjs 的协作 history
      }),
      Collaboration.configure({
        document: provider.ydoc,
        field: 'content', // Yjs 共享类型名称
      }),
      CollaborationCursor.configure({
        provider: provider.wsProvider,
        user: {
          name: userName,
          color: provider.wsProvider.awareness.getLocalState()?.user?.color,
        },
      }),
    ],
  });

  // 定期保存快照到服务器
  let version = 0;
  const saveInterval = setInterval(async () => {
    try {
      const state = Y.encodeStateAsUpdate(provider.ydoc);
      const stateBase64 = btoa(
        String.fromCharCode(...new Uint8Array(state))
      );

      version++;

      await fetch(`/api/documents/${docUid}/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ state: stateBase64, version }),
      });
    } catch (err) {
      console.error('[Yjs] Snapshot save failed:', err);
    }
  }, 30000); // 每 30 秒保存一次

  return {
    editor,
    provider,
    destroy() {
      clearInterval(saveInterval);
      editor.destroy();
      provider.destroy();
    },
  };
}
```

#### Vue 3 组件

```vue
<!-- resources/js/components/CollaborativeEditor.vue -->
<template>
  <div class="collaborative-editor">
    <div class="editor-toolbar">
      <span class="connection-status" :class="connectionStatus">
        {{ statusText }}
      </span>
      <span class="user-count" v-if="onlineUsers > 0">
        {{ onlineUsers }} 人在线
      </span>
    </div>
    <div ref="editorEl" class="editor-content"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { createCollaborativeEditor } from '../collaboration/editor';

const props = defineProps({
  docUid: { type: String, required: true },
  token: { type: String, required: true },
  userName: { type: String, default: 'Anonymous' },
});

const editorEl = ref(null);
const connectionStatus = ref('disconnected');
const onlineUsers = ref(0);

let editorInstance = null;

const statusText = computed(() => {
  const map = {
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '离线',
  };
  return map[connectionStatus.value] || connectionStatus.value;
});

onMounted(() => {
  if (!editorEl.value) return;

  editorInstance = createCollaborativeEditor(editorEl.value, {
    docUid: props.docUid,
    token: props.token,
    userName: props.userName,
    onStatusChange: (status) => {
      connectionStatus.value = status;
    },
  });

  // 监听在线用户数
  editorInstance.provider.wsProvider.awareness.on('change', () => {
    const states = editorInstance.provider.wsProvider.awareness.getStates();
    onlineUsers.value = states.size;
  });
});

onUnmounted(() => {
  editorInstance?.destroy();
});
</script>

<style scoped>
.collaborative-editor {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.editor-toolbar {
  padding: 8px 16px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  gap: 16px;
}

.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.connection-status::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ccc;
}

.connection-status.connected::before { background: #4CAF50; }
.connection-status.connecting::before { background: #FF9800; }
.connection-status.disconnected::before { background: #F44336; }

.editor-content {
  min-height: 400px;
  padding: 16px;
}

.editor-content :deep(.ProseMirror) {
  outline: none;
  min-height: 380px;
}

/* 协作光标样式 */
.editor-content :deep(.collaboration-cursor__caret) {
  border-left: 1px solid;
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
}

.editor-content :deep(.collaboration-cursor__label) {
  border-radius: 3px 3px 3px 0;
  color: #fff;
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  left: -1px;
  line-height: normal;
  padding: 2px 6px;
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
}
</style>
```

### 3. Yjs WebSocket 服务器

除了 Laravel 后端，还需要一个独立的 Yjs WebSocket 服务来处理文档同步。用 Node.js 运行 `y-websocket` 的服务端：

```bash
npm install y-websocket
```

```javascript
// yjs-server.js
const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');

const PORT = 1234;

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  // 从 URL 提取文档名
  const docName = req.url?.slice(1)?.split('?')[0] || 'default';

  console.log(`[Yjs WS] Client connected to document: ${docName}`);

  setupWSConnection(ws, req, {
    docName,
    gc: true, // 启用垃圾回收
  });

  ws.on('close', () => {
    console.log(`[Yjs WS] Client disconnected from: ${docName}`);
  });
});

console.log(`[Yjs WS] Server running on ws://localhost:${PORT}`);
```

启动：

```bash
node yjs-server.js
```

前端 Provider 的 WebSocket URL 需要指向这个服务：

```javascript
// 修改 editor.js 中的 wsUrl
wsUrl: `ws://${window.location.hostname}:1234`
```

### 4. 完整流程

```
1. 用户 A 打开文档
   → 前端创建 Y.Doc + WebsocketProvider
   → 连接 ws://host:1234/document-{uid}
   → y-websocket 服务端分配/创建文档
   → 如果文档已有状态，同步给 A

2. 用户 B 加入同一文档
   → 同样连接 WebSocket
   → 服务端将 B 的更新广播给 A，A 的更新广播给 B
   → 双方 Y.Doc 收敛一致

3. 用户 A 断网
   → IndexedDB 继续保存本地修改
   → 重新联网后，y-websocket 自动同步断网期间的变更

4. 定期快照
   → 前端每 30 秒调用 POST /api/documents/{uid}/snapshot
   → Laravel 将 Yjs 状态存入 MySQL
   → 新用户加入时，先从 API 加载最新快照
```

## 踩坑记录

### 坑 1：Yjs 状态编码体积膨胀

**问题**：直接用 `Y.encodeStateAsUpdate()` 导出的状态包含完整操作历史，文档越大体积越大。

**解决**：定期做状态压缩。用 `Y.encodeStateAsUpdate(ydoc, new Uint8Array())` 只导出增量，配合定期全量快照：

```javascript
// 每 100 次增量更新后，做一次全量快照
let updateCount = 0;
ydoc.on('update', () => {
  updateCount++;
  if (updateCount >= 100) {
    saveFullSnapshot();
    updateCount = 0;
  }
});
```

### 坑 2：多用户光标位置错乱

**问题**：用户刷新页面后，其他人的光标标签位置不正确。

**原因**：TipTap 的 `CollaborationCursor` 依赖 `provider.awareness`，刷新后 awareness 状态丢失，但 DOM 中残留旧的光标元素。

**解决**：在编辑器销毁时清理 awareness：

```javascript
onUnmounted(() => {
  // 显式清除 awareness 状态
  editorInstance?.provider?.wsProvider?.awareness?.setLocalState(null);
  editorInstance?.destroy();
});
```

### 坑 3：WebSocket 断线重连后状态不一致

**问题**：网络波动导致 WebSocket 断开重连后，文档内容与其他人不一致。

**原因**：`y-websocket` 默认的重连策略是指数退避，最长等待 30 秒。重连后如果服务端文档状态已变，需要全量同步。

**解决**：监听同步事件，确保重连后完整同步：

```javascript
provider.wsProvider.on('sync', (synced) => {
  if (synced) {
    console.log('[Yjs] Fully synced after reconnect');
    // 可以在这里触发 UI 提示
  }
});

// 缩短重连间隔
provider.wsProvider.wsUnsuccessfulReconnects = 0;
```

### 坑 4：Laravel 队列与 WebSocket 广播冲突

**问题**：使用 Laravel 队列广播事件时，WebSocket 客户端收不到消息。

**原因**：`beyondcode/laravel-websockets` 的广播需要直接触发，队列中的广播走的是 Pusher API，不会经过本地 WebSocket 服务。

**解决**：对于协同编辑场景，不走 Laravel 广播，直接用 `y-websocket` 的 WebSocket 协议同步。Laravel 只负责持久化和 HTTP API。

### 坑 5：富文本格式丢失

**问题**：加粗、斜体等格式在多人编辑后丢失。

**原因**：TipTap 的 `StarterKit` 中的 `history` 模块与 Yjs 的协作 history 冲突。

**解决**：必须禁用 StarterKit 的 history：

```javascript
StarterKit.configure({
  history: false, // 关键！
}),
```

## OT vs CRDT 工程选型对比

| 维度 | OT | CRDT (Yjs) |
|------|-----|------------|
| **一致性保证** | 依赖服务器变换逻辑 | 数学性质保证收敛 |
| **离线支持** | 难实现，需要复杂合并 | 天然支持，断网后自动合并 |
| **服务器依赖** | 必须有中心化服务器 | 可以 P2P（WebRTC） |
| **实现复杂度** | O(n²) 变换矩阵 | O(n) 向量时钟 |
| **带宽消耗** | 发送操作（小） | 发送状态更新（可压缩） |
| **典型用户** | Google Docs, Etherpad | Figma, Notion, Yjs |
| **Laravel 集成** | 需自建变换服务器 | 只需持久化，同步交给 y-websocket |

### 选型建议

**选 OT 当：**
- 已有中心化架构，不希望引入新组件
- 协同场景简单（纯文本，无富文本）
- 团队有 OT 算法经验

**选 CRDT 当：**
- 需要离线支持
- 需要 P2P 能力
- 富文本协同（格式、嵌入、表格）
- 不想自己写变换逻辑

**实际建议**：2026 年，新项目优先选 CRDT + Yjs。生态成熟，社区活跃，Figma 和 Notion 已经验证了生产可用性。OT 除非有历史包袱，否则没有理由选它。

## 总结

CRDT 是协同编辑的未来方向。Yjs 提供了生产级的实现，配合 Laravel 做持久化和业务逻辑，可以快速搭建多人协同系统。

核心架构：
- **前端**：Yjs + TipTap + y-websocket + y-indexeddb
- **后端**：Laravel（HTTP API + 快照持久化）
- **同步层**：y-websocket 服务端（Node.js）

关键要点：
1. `StarterKit` 必须禁用 `history`
2. 定期做全量快照压缩，防止状态膨胀
3. Awareness 状态需要在组件销毁时清理
4. 协同编辑的同步走 y-websocket，不要走 Laravel 广播
5. IndexedDB 提供离线能力，WebSocket 提供实时同步

完整代码已附在文中各处，可以直接复制运行。遇到问题欢迎留言讨论。
