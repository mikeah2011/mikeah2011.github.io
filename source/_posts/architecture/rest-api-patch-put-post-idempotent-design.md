---

title: REST API 终结者模式实战：PATCH vs PUT vs POST 的语义边界——Laravel 中的幂等设计与客户端缓存一致性
keywords: [REST API, PATCH vs PUT vs POST, Laravel, 终结者模式实战, 的语义边界, 中的幂等设计与客户端缓存一致性, 架构]
date: 2026-06-10 08:00:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
- REST
- API设计
- Laravel
- 幂等性
- HTTP语义
- 一致性
description: 深入解析 PATCH、PUT、POST 三种 HTTP 方法的语义边界，结合 Laravel 实战演示幂等设计模式，解决客户端缓存一致性问题，适用于高并发场景。
---



## 概述

在构建 REST API 时，`PATCH`、`PUT`、`POST` 的选择绝非"能用就行"——它们承载着不同的语义契约，直接影响缓存行为、客户端重试策略和并发安全性。

很多团队在实际开发中陷入了这样的困境：

- `POST` 一把梭，所有写操作都用 POST
- `PUT` 和 `PATCH` 混用，甚至不知道两者的区别
- 客户端重复提交导致数据不一致，排查半天发现是幂等性缺失
- 缓存层形同虚设，因为服务端根本没正确设置缓存头

本文将从 HTTP 规范出发，结合 Laravel 实战代码，彻底厘清这三种方法的语义边界，并给出一套完整的幂等设计方案。

<!-- more -->

## 核心概念：三种方法的语义契约

### POST — 非幂等的"创建者"

`POST` 是唯一**不保证幂等性**的写操作。每次调用都应该产生一个**新的资源实例**。

```http
POST /api/v1/orders
Content-Type: application/json

{
  "product_id": 42,
  "quantity": 2,
  "shipping_address": "上海市普陀区xxx"
}
```

**语义要点：**
- 服务端负责生成资源 ID
- 每次请求产生**独立的资源**
- 天然**不可缓存**（Cache-Control: no-cache）
- 客户端重试会创建重复资源（这就是为什么需要防重复提交）

### PUT — "全量替换"的守护者

`PUT` 是**幂等**的——无论调用多少次，结果都一样。它执行的是**全量替换**（Full Replacement）。

```http
PUT /api/v1/users/123
Content-Type: application/json

{
  "name": "Michael",
  "email": "michael@example.com",
  "phone": "138xxxx1234"
}
```

**语义要点：**
- 客户端必须提供**完整的资源表示**
- 如果某个字段缺失，该字段会被**置为 null 或默认值**
- 幂等性意味着：调用 1 次和调用 100 次，资源状态相同
- 缓存友好：GET + PUT 可以构建强一致的缓存策略

### PATCH — "部分更新"的精准手术刀

`PATCH` 是**部分更新**，只修改指定的字段，不影响其他字段。

```http
PATCH /api/v1/users/123
Content-Type: application/json

{
  "email": "new-email@example.com"
}
```

**语义要点：**
- 只修改请求中包含的字段
- 其他字段保持不变
- HTTP 规范**不要求** PATCH 具有幂等性（RFC 5789 允许非幂等 PATCH）
- 但在实践中，**我们强烈建议实现幂等 PATCH**

### 一张表看懂差异

| 维度 | POST | PUT | PATCH |
|------|------|-----|-------|
| 幂等性 | ❌ 不幂等 | ✅ 幂等 | ⚠️ 规范不要求，实践中应幂等 |
| 语义 | 创建新资源 | 全量替换 | 部分更新 |
| 缓存行为 | 不可缓存 | 可缓存 | 可缓存（取决于实现） |
| 客户端重试安全性 | ❌ 会重复创建 | ✅ 安全 | ⚠️ 取决于实现 |
| 请求体 | 任意格式 | 完整资源 | 部分资源（JSON Patch） |

## 实战代码：Laravel 中的规范实现

### 1. 路由定义——语义正确的 API

```php
// routes/api.php

use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\UserController;

Route::apiResource('users', UserController::class)
    ->only(['index', 'store', 'show', 'update', 'destroy']);

Route::apiResource('orders', OrderController::class)
    ->only(['index', 'store', 'show', 'update']);
```

### 2. POST 实现——创建资源并返回正确的状态码

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    /**
     * POST /api/v1/orders
     * 创建订单——每次调用都会产生新的资源
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'product_id' => 'required|exists:products,id',
            'quantity' => 'required|integer|min:1',
            'shipping_address' => 'required|string|max:500',
        ]);

        // 防重复提交：检查客户端是否携带幂等键
        $idempotencyKey = $request->header('Idempotency-Key');

        if ($idempotencyKey) {
            $existing = Cache::get("idempotent:{$idempotencyKey}");
            if ($existing) {
                return response()->json([
                    'status' => 'success',
                    'data' => $existing,
                    'idempotent_replay' => true,
                ], 200);
            }
        }

        $order = Order::create([
            'order_no' => $this->generateOrderNo(),
            'user_id' => auth()->id(),
            'product_id' => $validated['product_id'],
            'quantity' => $validated['quantity'],
            'shipping_address' => $validated['shipping_address'],
            'status' => 'pending',
        ]);

        // 缓存幂等键（24小时过期）
        if ($idempotencyKey) {
            Cache::put(
                "idempotent:{$idempotencyKey}",
                $order,
                now()->addHours(24)
            );
        }

        return response()->json([
            'status' => 'success',
            'data' => $order,
        ], 201); // 201 Created
    }

    private function generateOrderNo(): string
    {
        return 'ORD' . date('YmdHis') . str_pad(mt_rand(0, 9999), 4, '0', STR_PAD_LEFT);
    }
}
```

**关键点：**
- 使用 `Idempotency-Key` header 实现客户端控制的幂等性
- 返回 `201 Created` 而不是 `200 OK`
- 缓存幂等键用于防止重复创建

### 3. PUT 实现——全量替换

```php
/**
 * PUT /api/v1/users/{id}
 * 全量替换用户——未提供的字段会被清除
 */
public function update(Request $request, int $id): JsonResponse
{
    $user = User::findOrFail($id);

    $validated = $request->validate([
        'name' => 'required|string|max:255',
        'email' => 'required|email|max:255|unique:users,email,' . $id,
        'phone' => 'nullable|string|max:20',
        'avatar' => 'nullable|string|max:500',
    ]);

    // PUT 的语义：全量替换，不是合并
    // 所有字段都必须提供，未提供的字段会被置为 null
    $user->fill([
        'name' => $validated['name'],
        'email' => $validated['email'],
        'phone' => $validated['phone'] ?? null,
        'avatar' => $validated['avatar'] ?? null,
    ]);

    $user->save();

    // 清除该用户的缓存
    Cache::forget("user:{$id}");
    Cache::forget("user:{$id}:profile");

    return response()->json([
        'status' => 'success',
        'data' => $user->fresh(),
    ]);
}
```

**注意：** PUT 的全量替换语义要求前端必须发送完整对象。如果前端只想更新一个字段，应该用 PATCH。

### 4. PATCH 实现——部分更新 + 幂等设计

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class UserController extends Controller
{
    /**
     * PATCH /api/v1/users/{id}
     * 部分更新——只修改请求中包含的字段
     *
     * 实现幂等性：每个 PATCH 请求携带幂等键，
     * 服务端检查是否已执行过相同的 PATCH。
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $user = User::findOrFail($id);

        // 验证：PATCH 只需要验证实际提交的字段
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => 'sometimes|email|max:255|unique:users,email,' . $id,
            'phone' => 'sometimes|nullable|string|max:20',
            'avatar' => 'sometimes|nullable|string|max:500',
        ]);

        // 幂等性检查：基于幂等键
        $idempotencyKey = $request->header('Idempotency-Key');
        if ($idempotencyKey) {
            $cacheKey = "patch:idempotent:{$idempotencyKey}";
            $previousResult = Cache::get($cacheKey);

            if ($previousResult) {
                return response()->json([
                    'status' => 'success',
                    'data' => $previousResult,
                    'idempotent_replay' => true,
                ], 200);
            }
        }

        // 记录更新前的状态（用于版本控制和审计）
        $previousAttributes = $user->getAttributes();

        // 部分更新：只修改验证通过的字段
        $user->fill($validated);
        $user->save();

        // 计算实际变更的字段
        $changes = array_diff_assoc(
            $user->getAttributes(),
            $previousAttributes
        );

        // 缓存幂等键（1小时过期）
        if ($idempotencyKey) {
            $resultData = [
                'user' => $user->fresh(),
                'changes' => $changes,
            ];

            Cache::put(
                "patch:idempotent:{$idempotencyKey}",
                $resultData,
                now()->addHours(1)
            );
        }

        // 清除相关缓存
        Cache::forget("user:{$id}");
        Cache::forget("user:{$id}:profile");

        return response()->json([
            'status' => 'success',
            'data' => $user->fresh(),
            'changes' => $changes,
        ]);
    }
}
```

**为什么 PATCH 也要实现幂等性？**

虽然 RFC 5789 不要求 PATCH 幂等，但在实际场景中：
- 移动端网络不稳定，用户点击"保存"后可能收到超时
- 客户端自动重试时，不幂等的 PATCH 会导致数据被重复修改
- 微服务架构中，服务间调用可能触发重试

### 5. 缓存一致性中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ApiCacheHeaders
{
    /**
     * 根据 HTTP 方法自动设置缓存头
     *
     * GET  → Cache-Control: public, max-age=60
     * PUT  → Cache-Control: no-cache（客户端必须重新验证）
     * PATCH → Cache-Control: no-cache（部分更新，缓存可能失效）
     * POST → 不设置缓存头（不可缓存）
     */
    public function handle(Request $request, Closure $next): Response
    {
        /** @var Response $response */
        $response = $next($request);

        if ($request->isMethod('GET')) {
            // GET 请求：允许客户端缓存 60 秒
            $response->headers->set(
                'Cache-Control',
                'public, max-age=60, stale-while-revalidate=30'
            );

            // 添加 ETag 支持
            $etag = md5($response->getContent());
            $response->headers->set('ETag', '"' . $etag . '"');
            $response->headers->set('Last-Modified', gmdate('D, d M Y H:i:s') . ' GMT');
        } elseif ($request->isMethod('PUT') || $request->isMethod('PATCH')) {
            // 写操作：告诉客户端缓存已失效
            $response->headers->set('Cache-Control', 'no-cache, no-store, must-revalidate');
            $response->headers->set('Pragma', 'no-cache');
            $response->headers->set('Expires', '0');
        }
        // POST 默认不设置缓存头（HTTP 规范要求）

        return $response;
    }
}
```

### 6. 条件请求——ETag + If-Match

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ConditionalRequests
{
    /**
     * 处理条件请求（If-Match, If-None-Match）
     *
     * 防止并发更新导致的数据覆盖问题
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // GET 请求：检查 If-None-Match
        if ($request->isMethod('GET') && $request->hasHeader('If-None-Match')) {
            $currentEtag = $response->headers->get('ETag');
            $clientEtag = $request->header('If-None-Match');

            if ($currentEtag === $clientEtag) {
                return response()->json(null, 304); // Not Modified
            }
        }

        // PUT/PATCH 请求：检查 If-Match（乐观锁）
        if (($request->isMethod('PUT') || $request->isMethod('PATCH'))
            && $request->hasHeader('If-Match')) {

            $resource = $this->getResourceFromRequest($request);
            $resourceEtag = '"' . md5(json_encode($resource->toArray())) . '"';
            $clientEtag = $request->header('If-Match');

            if ($resourceEtag !== $clientEtag) {
                return response()->json([
                    'error' => 'Conflict',
                    'message' => 'Resource has been modified by another request. Please refresh and try again.',
                    'code' => 'RESOURCE_CONFLICT',
                ], 409); // Conflict
            }
        }

        return $response;
    }

    private function getResourceFromRequest(Request $request)
    {
        // 从路由参数中获取资源
        $id = $request->route('user') ?? $request->route('order');
        $modelClass = $request->is('*/users/*') ? \App\Models\User::class : \App\Models\Order::class;

        return $modelClass::findOrFail($id);
    }
}
```

## 踩坑记录

### 坑 1：前端把 PATCH 写成了 PUT

**场景：** 用户修改个人资料，前端用 `PUT` 只发送了 `name` 字段。

**后果：** `email`、`phone`、`avatar` 全部被置为 null，用户数据被破坏。

**解决方案：** 代码审查时强制检查：只更新部分字段必须用 PATCH，用 PUT 必须发送完整对象。

```php
// 在 Controller 中添加保护
public function update(Request $request, int $id): JsonResponse
{
    // 如果是 PUT 但缺少必填字段，抛出异常
    if ($request->isMethod('PUT')) {
        $requiredFields = ['name', 'email', 'phone'];
        foreach ($requiredFields as $field) {
            if (!$request->has($field)) {
                throw new \InvalidArgumentException(
                    "PUT request requires all fields. Missing: {$field}. Use PATCH for partial updates."
                );
            }
        }
    }
}
```

### 坑 2：PATCH 的幂等键没加过期时间

**场景：** 移动端缓存了幂等键，用户隔天再次操作，服务端返回"已执行过"。

**解决方案：** 幂等键必须设置合理的过期时间（建议 1-24 小时），根据业务场景决定。

### 坑 3：缓存头没设置导致客户端缓存了写操作的响应

**场景：** 客户端把 PUT 的 200 响应缓存了，下次 GET 时拿到的还是旧数据。

**解决方案：** 使用上面的 `ApiCacheHeaders` 中间件，确保写操作返回 `no-cache`。

### 坑 4：并发 PUT 覆盖

**场景：** 两个管理员同时编辑同一个用户，A 先保存，B 后保存。B 的 PUT 覆盖了 A 的修改。

**解决方案：** 使用 ETag + If-Match 实现乐观锁：

```javascript
// 客户端代码
const response = await fetch(`/api/v1/users/${userId}`);
const etag = response.headers.get('ETag');
const user = await response.json();

// 修改后提交
await fetch(`/api/v1/users/${userId}`, {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,  // 携带 ETag
    },
    body: JSON.stringify(updatedUser),
});
// 如果返回 409 Conflict，提示用户刷新页面
```

## 客户端缓存策略

### 读写分离的缓存模型

```
┌─────────────┐     GET + ETag      ┌─────────────┐
│   Client    │ ─────────────────── │   Server    │
│  (Browser)  │                     │   (Laravel) │
│             │     200 + ETag      │             │
│             │ ←───────────────── │             │
│             │                     │             │
│  Cache:     │     PUT + If-Match  │             │
│  ETag Map   │ ─────────────────── │  验证 ETag  │
│             │                     │             │
│             │     200 / 409       │             │
│             │ ←───────────────── │             │
└─────────────┘                     └─────────────┘
```

### 客户端实现示例（JavaScript）

```javascript
class RestClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.etagCache = new Map(); // 存储 ETag
    }

    async get(path) {
        const url = `${this.baseURL}${path}`;
        const headers = {};

        // 如果有缓存的 ETag，发送 If-None-Match
        if (this.etagCache.has(url)) {
            headers['If-None-Match'] = this.etagCache.get(url);
        }

        const response = await fetch(url, { headers });

        // 304 Not Modified，使用缓存
        if (response.status === 304) {
            return { fromCache: true, data: this.cachedData?.get(url) };
        }

        // 缓存新的 ETag
        const etag = response.headers.get('ETag');
        if (etag) {
            this.etagCache.set(url, etag);
        }

        const data = await response.json();
        this.cachedData = this.cachedData || new Map();
        this.cachedData.set(url, data);

        return { fromCache: false, data };
    }

    async put(path, data) {
        const url = `${this.baseURL}${path}`;
        const headers = { 'Content-Type': 'application/json' };

        // 携带 ETag 进行乐观锁验证
        if (this.etagCache.has(url)) {
            headers['If-Match'] = this.etagCache.get(url);
        }

        const response = await fetch(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify(data),
        });

        if (response.status === 409) {
            throw new Error('CONFLICT: Resource modified by another request');
        }

        // 更新 ETag 缓存
        const newEtag = response.headers.get('ETag');
        if (newEtag) {
            this.etagCache.set(url, newEtag);
        }

        return response.json();
    }

    async patch(path, data) {
        const url = `${this.baseURL}${path}`;

        // 生成幂等键
        const idempotencyKey = this.generateIdempotencyKey(data);

        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(data),
        });

        const result = await response.json();

        if (result.idempotent_replay) {
            console.log('This operation was already performed (idempotent replay)');
        }

        return result;
    }

    generateIdempotencyKey(data) {
        // 基于数据内容生成幂等键
        const content = JSON.stringify(data);
        return btoa(content).substring(0, 32);
    }
}
```

## 总结

| 场景 | 推荐方法 | 理由 |
|------|---------|------|
| 创建新资源 | POST | 唯一不幂等的方法，天然语义匹配 |
| 更新整个资源 | PUT | 幂等，全量替换语义清晰 |
| 更新部分字段 | PATCH | 部分更新，节省带宽，但应实现幂等 |
| 删除资源 | DELETE | 幂等，重复删除不影响最终状态 |

**核心原则：**

1. **PUT ≠ PATCH**：PUT 是全量替换，PATCH 是部分更新，混用会导致数据丢失
2. **幂等性不是可选的**：即使规范不要求 PATCH 幂等，在实践中也应该实现
3. **ETag + If-Match** 是解决并发更新的标准方案
4. **缓存头必须正确设置**：否则客户端会缓存不该缓存的内容
5. **Idempotency-Key** 是客户端控制幂等性的最佳实践

掌握了这些，你的 API 就不再是"能用就行"，而是"规范、安全、可扩展"。
