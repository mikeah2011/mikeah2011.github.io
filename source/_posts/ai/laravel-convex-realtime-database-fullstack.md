---

title: Laravel + Convex 实战：实时数据库驱动的全栈应用——对比 Supabase/Firebase 的响应式数据层
keywords: [Laravel, Convex, Supabase, Firebase, 实时数据库驱动的全栈应用, 的响应式数据层]
date: 2026-06-09 06:44:00
categories:
- ai
tags:
- Laravel
- Convex
- 数据库
- Supabase
- Firebase
- 全栈
- 响应式
description: Convex 作为新兴的实时后端即服务，提供了声明式数据查询和自动实时同步能力。本文从 Laravel 后端视角出发，深入对比 Convex、Supabase、Firebase 三种响应式数据层的架构差异，给出完整的 Laravel + Convex 集成方案和生产级代码示例。
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=630&fit=crop
---



## 概述

实时数据同步是现代 Web 应用的标配。传统做法是轮询或 WebSocket 手动管理，但 2024-2026 年涌现了一批「声明式实时后端」——Convex、Supabase Realtime、Firebase Realtime Database / Firestore——它们的核心卖点是：**你写查询，框架自动同步**。

本文不讲概念空话。直接从 Laravel 后端开发者的视角出发，对比这三个方案的架构差异，并给出 **Laravel + Convex 的完整集成代码**。

### 为什么关注 Convex？

Convex 在 2025-2026 年快速崛起，有几个独特优势：

- **声明式查询函数**：用 TypeScript 写查询，Convex 自动追踪数据依赖，变化时精准推送增量更新
- **事务性函数**：Mutation 函数原子执行，天然支持乐观更新
- **零配置实时**：客户端订阅查询后，服务端有变化就推，不需要写任何 WebSocket 代码
- **与前端框架深度集成**：React/Vue/Svelte 都有官方 hook

对比 Supabase（Postgres + Realtime）和 Firebase（NoSQL + 手动监听），Convex 的开发体验确实更顺滑。但每个方案都有适用场景。

## 核心概念对比

### 架构模型

| 维度 | Convex | Supabase | Firebase |
|------|--------|----------|----------|
| 数据库 | 自有文档数据库（类似 DynamoDB） | PostgreSQL | Firestore (文档) / RTDB (JSON) |
| 查询语言 | TypeScript 函数 | SQL / PostgREST | SDK 方法链 |
| 实时机制 | 声明式自动订阅 | 基于 Postgres CDC + WebSocket | 手动 addSnapshotListener |
| 后端逻辑 | Convex Functions (TS) | Edge Functions / RPC | Cloud Functions |
| 认证集成 | Auth helpers（支持 JWT） | Supabase Auth / 第三方 JWT | Firebase Auth |
| 定价模型 | 按函数调用 + 存储 | 按 DB 大小 + 带宽 | 按读写次数 + 存储 |

### 实时同步机制的关键差异

**Convex** 的实时是最「省心」的：

```typescript
// 前端：声明式订阅，Convex 自动管理生命周期
const messages = useQuery(api.messages.list, { channelId });

// 后端查询函数：返回当前数据，Convex 追踪依赖
export const list = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
  },
});
```

Convex 在服务端分析查询函数的 `ctx.db` 调用，自动构建依赖图。当相关文档变化时，只推送受影响的查询结果——**不需要你写任何 diff 逻辑**。

**Supabase** 的实时基于 Postgres CDC（Change Data Capture）：

```javascript
// 前端：手动选择要监听的表和过滤条件
const channel = supabase
  .channel('messages')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'messages',
    filter: `channel_id=eq.${channelId}`
  }, (payload) => {
    console.log('Change received!', payload);
  })
  .subscribe();
```

Supabase 的实时本质上是 Postgres 的 WAL（Write-Ahead Log）变更通知。优点是能监听任意表，缺点是需要手动管理订阅/取消订阅，且过滤能力有限。

**Firebase** 的实时是最「底层」的：

```javascript
// Firestore：手动管理监听器
const q = query(
  collection(db, 'messages'),
  where('channelId', '==', channelId),
  orderBy('createdAt', 'asc')
);

const unsubscribe = onSnapshot(q, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === 'added') {
      renderMessage(change.doc.data());
    }
    if (change.type === 'modified') {
      updateMessage(change.doc.id, change.doc.data());
    }
  });
});
```

Firestore 的 `onSnapshot` 会返回增量变更（`docChanges()`），但你需要自己处理逻辑。

## 实战：Laravel + Convex 集成

### 架构设计

Laravel 作为后端 API 层，Convex 作为实时数据层，前端通过 Convex 直接订阅数据，通过 Laravel 处理业务逻辑。

```
┌─────────────┐     REST API     ┌─────────────┐
│   Laravel   │ ──────────────── │   前端应用   │
│   Backend   │                  │   (Vue/React)│
└──────┬──────┘                  └──────┬──────┘
       │                                │
       │ Server API                     │ Realtime Subscription
       │                                │
       ▼                                ▼
┌──────────────────────────────────────────────────┐
│                  Convex Backend                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Queries  │  │ Mutations│  │ Actions  │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│                    ▼                              │
│  ┌──────────────────────────────────┐            │
│  │     Convex Database (文档型)     │            │
│  └──────────────────────────────────┘            │
└──────────────────────────────────────────────────┘
```

### 第一步：Convex Schema 和函数定义

定义数据模型和操作函数：

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // 产品表
  products: defineTable({
    name: v.string(),
    description: v.string(),
    price: v.number(),
    stock: v.number(),
    category: v.string(),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_price", ["price"]),

  // 订单表
  orders: defineTable({
    userId: v.string(),
    items: v.array(
      v.object({
        productId: v.id("products"),
        name: v.string(),
        price: v.number(),
        quantity: v.number(),
      })
    ),
    totalAmount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("shipped"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"]),

  // 实时通知
  notifications: defineTable({
    userId: v.string(),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user_unread", ["userId", "read"]),
});
```

查询函数：

```typescript
// convex/products.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// 查询产品列表（支持分类过滤和分页）
export const list = query({
  args: {
    category: v.optional(v.string()),
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    let q = ctx.db.query("products");

    if (args.category) {
      q = q.withIndex("by_category", (q) =>
        q.eq("category", args.category!)
      );
    }

    const results = await q
      .order("desc")
      .take(limit);

    return results;
  },
});

// 查询单个产品
export const get = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.productId);
  },
});

// 创建产品（Mutation，自动触发依赖此查询的客户端更新）
export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    price: v.number(),
    stock: v.number(),
    category: v.string(),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("products", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// 更新库存（事务性操作）
export const updateStock = mutation({
  args: {
    productId: v.id("products"),
    quantityChange: v.number(),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Product not found");

    const newStock = product.stock + args.quantityChange;
    if (newStock < 0) throw new Error("Insufficient stock");

    await ctx.db.patch(args.productId, {
      stock: newStock,
      updatedAt: Date.now(),
    });

    return { success: true, newStock };
  },
});
```

```typescript
// convex/orders.ts
import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";

// 用户订单列表
export const listByUser = query({
  args: {
    userId: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("paid"),
        v.literal("shipped"),
        v.literal("completed"),
        v.literal("cancelled")
      )
    ),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", args.userId));

    if (args.status) {
      q = q.filter((q) => q.eq(q.field("status"), args.status));
    }

    return await q.order("desc").collect();
  },
});

// 创建订单（原子操作：扣减库存 + 创建订单）
export const create = mutation({
  args: {
    userId: v.string(),
    items: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // 逐个检查库存并扣减
    const orderItems = [];
    let totalAmount = 0;

    for (const item of args.items) {
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error(`Product ${item.productId} not found`);
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      // 扣减库存
      await ctx.db.patch(item.productId, {
        stock: product.stock - item.quantity,
        updatedAt: Date.now(),
      });

      orderItems.push({
        productId: item.productId,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
      });

      totalAmount += product.price * item.quantity;
    }

    // 创建订单
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      userId: args.userId,
      items: orderItems,
      totalAmount,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // 创建通知
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "order_created",
      title: "订单已创建",
      message: `订单 ${orderId} 已创建，金额 ¥${totalAmount.toFixed(2)}`,
      read: false,
      createdAt: now,
    });

    return orderId;
  },
});

// 更新订单状态
export const updateStatus = mutation({
  args: {
    orderId: v.id("orders"),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("shipped"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");

    await ctx.db.patch(args.orderId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    // 如果取消订单，恢复库存
    if (args.status === "cancelled") {
      for (const item of order.items) {
        const product = await ctx.db.get(item.productId);
        if (product) {
          await ctx.db.patch(item.productId, {
            stock: product.stock + item.quantity,
            updatedAt: Date.now(),
          });
        }
      }
    }

    return { success: true };
  },
});
```

### 第二步：Laravel 后端集成

Laravel 通过 Convex Server SDK 调用 Convex 函数，处理需要服务端验证的业务逻辑：

```php
<?php

namespace App\Services;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;

class ConvexService
{
    private Client $client;
    private string $deploymentUrl;

    public function __construct()
    {
        $this->deploymentUrl = config('convex.deployment_url');
        $this->client = new Client([
            'base_uri' => $this->deploymentUrl,
            'headers' => [
                'Authorization' => 'Bearer ' . config('convex.auth_key'),
                'Content-Type' => 'application/json',
            ],
        ]);
    }

    /**
     * 调用 Convex Query 函数
     */
    public function query(string $functionPath, array $args = []): mixed
    {
        $response = $this->client->post('/api/query', [
            'json' => [
                'path' => $functionPath,
                'args' => $args,
            ],
        ]);

        $data = json_decode($response->getBody(), true);

        if (isset($data['errorMessage'])) {
            throw new \RuntimeException("Convex query error: {$data['errorMessage']}");
        }

        return $data['value'] ?? null;
    }

    /**
     * 调用 Convex Mutation 函数
     */
    public function mutation(string $functionPath, array $args = []): mixed
    {
        $response = $this->client->post('/api/mutation', [
            'json' => [
                'path' => $functionPath,
                'args' => $args,
            ],
        ]);

        $data = json_decode($response->getBody(), true);

        if (isset($data['errorMessage'])) {
            throw new \RuntimeException("Convex mutation error: {$data['errorMessage']}");
        }

        return $data['value'] ?? null;
    }

    /**
     * 生成 Convex 认证 Token（JWT）
     */
    public function generateAuthToken(string $userId, array $claims = []): string
    {
        $payload = array_merge([
            'sub' => $userId,
            'iat' => time(),
            'exp' => time() + 3600, // 1小时过期
        ], $claims);

        return $this->generateJWT($payload);
    }

    private function generateJWT(array $payload): string
    {
        $header = $this->base64UrlEncode(json_encode([
            'alg' => 'HS256',
            'typ' => 'JWT',
        ]));

        $body = $this->base64UrlEncode(json_encode($payload));

        $signature = $this->base64UrlEncode(
            hash_hmac('sha256', "$header.$body", config('convex.auth_secret'), true)
        );

        return "$header.$body.$signature";
    }

    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
```

Controller 层：

```php
<?php

namespace App\Http\Controllers;

use App\Services\ConvexService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function __construct(
        private ConvexService $convex
    ) {}

    /**
     * GET /api/products
     * 通过 Convex 查询产品列表
     */
    public function index(Request $request): JsonResponse
    {
        $category = $request->input('category');
        $limit = $request->input('limit', 20);

        $products = $this->convex->query('products:list', [
            'category' => $category,
            'limit' => $limit,
        ]);

        return response()->json(['data' => $products]);
    }

    /**
     * GET /api/products/{id}
     */
    public function show(string $id): JsonResponse
    {
        $product = $this->convex->query('products:get', [
            'productId' => $id,
        ]);

        if (!$product) {
            return response()->json(['error' => 'Product not found'], 404);
        }

        return response()->json(['data' => $product]);
    }

    /**
     * POST /api/products
     * 需要服务端验证后调用 Convex 创建
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'required|string',
            'price' => 'required|numeric|min:0',
            'stock' => 'required|integer|min:0',
            'category' => 'required|string',
            'imageUrl' => 'nullable|url',
        ]);

        $productId = $this->convex->mutation('products:create', $validated);

        return response()->json(['data' => ['id' => $productId]], 201);
    }
}
```

```php
<?php

namespace App\Http\Controllers;

use App\Services\ConvexService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function __construct(
        private ConvexService $convex
    ) {}

    /**
     * POST /api/orders
     * 创建订单：Laravel 负责验证和鉴权，Convex 负责事务和实时同步
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.productId' => 'required|string',
            'items.*.quantity' => 'required|integer|min:1',
        ]);

        $userId = $request->user()->id;

        // 通过 Convex 创建订单（原子操作：扣减库存 + 创建订单 + 创建通知）
        $orderId = $this->convex->mutation('orders:create', [
            'userId' => $userId,
            'items' => $validated['items'],
        ]);

        return response()->json([
            'data' => ['id' => $orderId],
            'message' => '订单创建成功，实时同步已触发',
        ], 201);
    }

    /**
     * PATCH /api/orders/{id}/status
     * 更新订单状态（管理员操作）
     */
    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'status' => 'required|in:pending,paid,shipped,completed,cancelled',
        ]);

        $this->convex->mutation('orders:updateStatus', [
            'orderId' => $id,
            'status' => $validated['status'],
        ]);

        return response()->json(['message' => '状态更新成功']);
    }

    /**
     * GET /api/orders
     * 查询当前用户订单
     */
    public function index(Request $request): JsonResponse
    {
        $userId = $request->user()->id;
        $status = $request->input('status');

        $orders = $this->convex->query('orders:listByUser', [
            'userId' => $userId,
            'status' => $status,
        ]);

        return response()->json(['data' => $orders]);
    }
}
```

### 第三步：前端实时订阅

Vue 3 + Convex 的前端集成：

```typescript
// frontend/src/main.ts
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createApp } from "vue";
import App from "./App.vue";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

const app = createApp(App);
app.use(ConvexProvider, { client: convex });
app.mount("#app");
```

```vue
<!-- frontend/src/views/ProductList.vue -->
<template>
  <div class="product-list">
    <h1>产品列表（实时更新）</h1>

    <div class="filters">
      <button
        v-for="cat in categories"
        :key="cat"
        :class="{ active: selectedCategory === cat }"
        @click="selectedCategory = cat"
      >
        {{ cat }}
      </button>
    </div>

    <div class="products">
      <div v-for="product in products" :key="product._id" class="product-card">
        <h3>{{ product.name }}</h3>
        <p>{{ product.description }}</p>
        <div class="price">¥{{ product.price.toFixed(2) }}</div>
        <div class="stock" :class="{ low: product.stock < 5 }">
          库存: {{ product.stock }}
        </div>
        <button @click="addToCart(product)" :disabled="product.stock === 0">
          {{ product.stock === 0 ? '缺货' : '加入购物车' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const selectedCategory = ref<string | undefined>(undefined);
const categories = ["电子产品", "服饰", "食品", "家居"];

// 实时订阅：selectedCategory 变化时自动重新订阅
const products = useQuery(api.products.list, {
  category: selectedCategory.value,
});

function addToCart(product: any) {
  // ... 购物车逻辑
}
</script>
```

```vue
<!-- frontend/src/views/OrderDashboard.vue -->
<template>
  <div class="order-dashboard">
    <h1>我的订单（实时状态更新）</h1>

    <div v-if="orders === undefined" class="loading">加载中...</div>

    <div v-else-if="orders.length === 0" class="empty">暂无订单</div>

    <div v-else class="orders">
      <div v-for="order in orders" :key="order._id" class="order-card">
        <div class="order-header">
          <span class="order-id">{{ order._id }}</span>
          <span class="status" :class="order.status">{{ statusText(order.status) }}</span>
        </div>
        <div class="order-items">
          <div v-for="item in order.items" :key="item.productId" class="order-item">
            {{ item.name }} × {{ item.quantity }}
            <span class="item-price">¥{{ (item.price * item.quantity).toFixed(2) }}</span>
          </div>
        </div>
        <div class="order-total">
          合计: ¥{{ order.totalAmount.toFixed(2) }}
        </div>
        <div class="order-time">
          {{ new Date(order.createdAt).toLocaleString() }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// 假设 userId 从 auth context 获取
const userId = useAuthUserId();

// 实时订阅用户订单——订单状态变化时自动更新
const orders = useQuery(api.orders.listByUser, {
  userId: userId.value,
});

function statusText(status: string): string {
  const map: Record<string, string> = {
    pending: "待支付",
    paid: "已支付",
    shipped: "已发货",
    completed: "已完成",
    cancelled: "已取消",
  };
  return map[status] || status;
}
</script>
```

### 第四步：通知实时推送

```typescript
// convex/notifications.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// 查询未读通知
export const unreadCount = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", args.userId).eq("read", false)
      )
      .collect();

    return notifications.length;
  },
});

// 查询通知列表
export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

// 标记已读
export const markRead = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { read: true });
    return { success: true };
  },
});
```

前端通知组件：

```vue
<!-- frontend/src/components/NotificationBell.vue -->
<template>
  <div class="notification-bell" @click="togglePanel">
    <span class="bell-icon">🔔</span>
    <span v-if="unreadCount > 0" class="badge">{{ unreadCount }}</span>

    <div v-if="showPanel" class="notification-panel">
      <div v-if="notifications?.length === 0" class="empty">暂无通知</div>
      <div
        v-for="n in notifications"
        :key="n._id"
        class="notification-item"
        :class="{ unread: !n.read }"
        @click="markAsRead(n)"
      >
        <div class="title">{{ n.title }}</div>
        <div class="message">{{ n.message }}</div>
        <div class="time">{{ timeAgo(n.createdAt) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

const showPanel = ref(false);
const userId = useAuthUserId();

// 实时未读数——有新通知时自动更新
const unreadCount = useQuery(api.notifications.unreadCount, {
  userId: userId.value,
});

// 实时通知列表
const notifications = useQuery(api.notifications.list, {
  userId: userId.value,
});

const markRead = useMutation(api.notifications.markRead);

function togglePanel() {
  showPanel.value = !showPanel.value;
}

async function markAsRead(notification: any) {
  await markRead({ notificationId: notification._id });
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}
</script>
```

## 踩坑记录

### 1. Convex 数据库 vs Laravel Eloquent

Convex 有自己的文档数据库，**不能直接用 Eloquent ORM**。这是很多 Laravel 开发者的第一反应——「我已经有 Postgres 了，为什么要用 Convex 的数据库？」

实际上 Convex 也支持连接外部 Postgres（通过 Postgres Sync），但核心体验还是围绕它自己的数据库。如果你的团队已经深度使用 Postgres + Eloquent，建议考虑 **Supabase** 而不是 Convex。

### 2. JWT 认证的 Token 刷新

Convex 的认证通过 JWT 实现，但 token 过期后需要刷新。Laravel 负责签发 token，前端负责存储和刷新：

```php
// Laravel: 登录后生成 Convex token
public function login(Request $request)
{
    $user = Auth::user();

    // 生成 Convex JWT（有效期1小时）
    $convexToken = $this->convex->generateAuthToken($user->id, [
        'name' => $user->name,
        'email' => $user->email,
    ]);

    return response()->json([
        'token' => $user->createToken('auth-token')->plainTextToken,
        'convex_token' => $convexToken,
        'user' => $user,
    ]);
}
```

```typescript
// 前端：Convex 认证 token 管理
// convex/auth.config.ts
import { ConvexReactClient } from "convex/react";

export function getConvexClient() {
  return new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
}

// 在登录后设置认证信息
convex.setAuth(async () => {
  const token = localStorage.getItem("convex_token");
  if (!token) return null;

  // 检查 token 是否过期
  const payload = JSON.parse(atob(token.split(".")[1]));
  if (payload.exp * 1000 < Date.now()) {
    // Token 过期，请求 Laravel 刷新
    const res = await fetch("/api/auth/refresh-convex-token", {
      headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
    });
    const data = await res.json();
    localStorage.setItem("convex_token", data.convex_token);
    return data.convex_token;
  }

  return token;
});
```

### 3. 实时查询的性能陷阱

Convex 的实时订阅会为每个客户端维护一个查询状态。如果查询函数太复杂或者返回数据量太大，会导致：

- 客户端内存占用过高
- 服务端计算压力大
- 网络带宽浪费

**最佳实践**：

```typescript
// ❌ 不要这样：返回全量数据让客户端过滤
export const badList = query({
  handler: async (ctx) => {
    return await ctx.db.query("products").collect(); // 可能返回几万条
  },
});

// ✅ 要这样：在服务端过滤，只返回必要数据
export const goodList = query({
  args: {
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100); // 强制上限

    let q = ctx.db.query("products");
    if (args.category) {
      q = q.withIndex("by_category", (q) => q.eq("category", args.category!));
    }

    return await q.take(limit); // 只取需要的数据
  },
});
```

### 4. 离线支持和乐观更新

Convex 支持离线操作。Mutation 在离线时会暂存，恢复连接后自动同步。配合乐观更新，用户体验非常好：

```typescript
// 前端乐观更新
const updateStock = useMutation(api.products.updateStock);

async function handleStockUpdate(productId: string, change: number) {
  // 乐观更新：立即在本地修改 UI
  // Convex 会自动处理离线暂存和重连同步
  await updateStock({
    productId,
    quantityChange: change,
  });
  // 不需要手动刷新——Convex 实时订阅会自动更新
}
```

### 5. Supabase vs Convex：选哪个？

| 场景 | 推荐 |
|------|------|
| 已有 Postgres 数据库，想加实时能力 | Supabase |
| 从零开始，追求最快开发速度 | Convex |
| 需要复杂 SQL 查询和全文搜索 | Supabase |
| 需要精细的实时查询控制 | Convex |
| 团队熟悉 SQL，不想学新查询语言 | Supabase |
| 移动端离线优先应用 | Convex |
| 需要边缘函数 + 数据库一体化 | Supabase |

## 总结

三个方案各有定位：

- **Convex**：声明式实时，开发体验最好，适合快速迭代的新项目。代价是被绑定在 Convex 生态里。
- **Supabase**：Postgres 的实时扩展，适合已有 SQL 基础设施的团队。灵活但需要更多手动管理。
- **Firebase**：最成熟但最底层，Google 生态绑定深，适合已深度使用 Google Cloud 的团队。

从 Laravel 后端的角度看，**Convex + Laravel 的组合**是一个有趣的架构选择——Laravel 处理业务逻辑和鉴权，Convex 处理实时数据同步。两者分工明确，各司其职。

关键原则：**不要为了实时而实时**。只有当用户确实需要「看到别人的操作结果」时，才引入实时能力。大部分 CRUD 场景，传统的 REST API 就够了。

---

*本文代码基于 Convex 2026.06 SDK 和 Laravel 11.x。Convex API 可能随版本更新变化，请参考官方文档。*
