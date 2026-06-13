---

title: Cloudflare Workers 实战：边缘计算中的 Laravel——Workers/Pages/D1/KV 的全栈 Serverless 方案
keywords: [Cloudflare Workers, Laravel, Workers, Pages, D1, KV, Serverless, 边缘计算中的, 的全栈]
date: 2026-06-02 12:00:00
tags:
- Cloudflare Workers
- Serverless
- Laravel
- 边缘计算
- D1
- KV
description: 本文深入探讨如何利用 Cloudflare Workers 实现 Laravel 应用的边缘计算与 Serverless 全栈部署方案。涵盖 Workers 边缘函数、Pages 前端托管、D1 边缘 SQLite 数据库、KV 全球键值存储等核心组件与 Laravel 的集成实践，包括实战配置、踩坑记录与性能优化，帮助开发者将传统 PHP 应用迁移至全球 300+ 边缘节点，实现 TTFB 50ms 以内的极致访问体验。
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---



## 前言

在传统架构中，PHP 应用运行在中心化的服务器上，用户请求需要跨越半个地球才能到达数据中心。当你的用户分布在全球各地时，一个东京用户访问部署在美东的 Laravel 应用，光是网络延迟就需要 100-200ms，再加上应用处理时间，首字节时间（TTFB）轻松超过 500ms。

Cloudflare Workers 提供了一个激进的解决方案：**将你的代码部署到全球 300+ 个边缘节点上**，让用户请求在最近的节点被处理，将 TTFB 降低到 50ms 以内。

但 Cloudflare Workers 的运行时是 V8 Isolates，而不是传统的容器或虚拟机。这意味着 PHP 无法直接运行在 Workers 上。那么，Laravel 应用如何与 Cloudflare Workers 生态结合？

本文将从 Cloudflare Workers 生态全景出发，探索 Workers、Pages、D1、KV、R2、Queues、Durable Objects 各组件与 Laravel 集成的完整方案，并提供真实案例和踩坑记录。

---

## 一、Cloudflare Workers 生态全景

### 1.1 核心组件

```
Cloudflare Workers 生态
├── Workers         -- 边缘计算（V8 Isolates）
├── Pages           -- 前端托管（SSR/SSG）
├── D1              -- 边缘 SQLite 数据库
├── KV              -- 键值存储（全球分布）
├── R2              -- 对象存储（S3 兼容）
├── Queues          -- 消息队列
├── Durable Objects -- 有状态边缘计算
├── Hyperdrive      -- 数据库连接池代理
├── AI              -- 推理 API
└── Vectorize       -- 向量数据库
```

### 1.2 Workers vs AWS Lambda vs 传统 VPS

| 特性 | Cloudflare Workers | AWS Lambda | 传统 VPS |
|------|-------------------|------------|----------|
| 运行时 | V8 Isolates | 容器 | 虚拟机 |
| 冷启动 | < 1ms | 100-500ms | 无（常驻） |
| 全球分布 | 300+ 节点 | 需要配置 | 手动部署 |
| 最大内存 | 128MB | 10GB | 自定义 |
| 最大 CPU 时间 | 30s（付费）/ 10ms（免费） | 15 分钟 | 无限制 |
| 语言支持 | JS/TS/Wasm | 多语言 | 所有 |
| 价格模型 | 按请求计费 | 按请求+时长 | 按月 |
| 适用场景 | API Gateway、边缘逻辑 | 通用计算 | 全栈应用 |

### 1.3 V8 Isolates 的架构优势

传统的 Serverless（如 AWS Lambda）使用容器来隔离不同用户的代码。每次请求到来时，需要启动一个容器，加载运行时，执行代码。这个过程的冷启动延迟通常在 100-500ms。

Cloudflare Workers 使用 V8 Isolates 代替容器：

```
传统 Serverless (Lambda):
┌─────────────────────────────────────┐
│  Container                          │
│  ┌───────────────────────────────┐  │
│  │  OS Kernel                    │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │  Runtime (Node.js/PHP)  │  │  │
│  │  │  ┌───────────────────┐  │  │  │
│  │  │  │  User Code        │  │  │  │
│  │  │  └───────────────────┘  │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
冷启动: 100-500ms

Cloudflare Workers (V8 Isolates):
┌─────────────────────────────────────┐
│  V8 Engine (共享)                    │
│  ┌──────┐ ┌──────┐ ┌──────┐        │
│  │Iso 1 │ │Iso 2 │ │Iso 3 │ ...    │
│  │(用户A)│ │(用户B)│ │(用户C)│        │
│  └──────┘ └──────┘ └──────┘        │
└─────────────────────────────────────┘
冷启动: < 1ms
```

---

## 二、Laravel 与 Cloudflare Workers 的集成方案

### 2.1 方案一：API Gateway + 边缘缓存（推荐）

这是最实用的方案：将 Cloudflare Workers 作为 API Gateway 和边缘缓存层，Laravel 应用仍然运行在传统的 VPS/容器中。

```
用户请求
    │
    ▼
┌───────────────────────────────────────┐
│  Cloudflare 边缘节点 (Workers)         │
│  ┌─────────────────────────────────┐  │
│  │  1. 静态资源 → R2/KV 直接返回    │  │
│  │  2. API 缓存 → KV 命中直接返回   │  │
│  │  3. API 缓存未命中 → 回源 Laravel │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
    │ (缓存未命中)
    ▼
┌───────────────────────────────────────┐
│  Laravel 应用 (VPS/Container)          │
│  - 处理业务逻辑                        │
│  - 返回 JSON 响应                      │
└───────────────────────────────────────┘
```

Worker 代码：

```javascript
// worker.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 1. 静态资源直接从 R2 返回
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/')) {
      const object = await env.R2_BUCKET.get(url.pathname.slice(1));
      if (object) {
        return new Response(object.body, {
          headers: {
            'Content-Type': getContentType(url.pathname),
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    }

    // 2. API 请求的边缘缓存
    if (url.pathname.startsWith('/api/')) {
      const cacheKey = `api:${url.pathname}:${url.search}`;
      const cached = await env.KV.get(cacheKey, { type: 'json' });
      
      if (cached) {
        return new Response(JSON.stringify(cached), {
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'HIT',
            'Cache-Control': 'public, max-age=60',
          },
        });
      }

      // 回源 Laravel
      const originUrl = `https://origin.your-app.com${url.pathname}${url.search}`;
      const response = await fetch(originUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' ? request.body : undefined,
      });

      // 缓存 GET 请求的响应
      if (request.method === 'GET' && response.ok) {
        const data = await response.json();
        await env.KV.put(cacheKey, JSON.stringify(data), {
          expirationTtl: 60, // 60 秒
        });
        
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'MISS',
            'Cache-Control': 'public, max-age=60',
          },
        });
      }

      return response;
    }

    // 3. 其他请求直接转发
    const originUrl = `https://origin.your-app.com${url.pathname}${url.search}`;
    return fetch(originUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' ? request.body : undefined,
    });
  },
};

function getContentType(path) {
  const ext = path.split('.').pop();
  const types = {
    'js': 'application/javascript',
    'css': 'text/css',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'svg': 'image/svg+xml',
    'woff2': 'font/woff2',
  };
  return types[ext] || 'application/octet-stream';
}
```

### 2.2 方案二：Cloudflare Pages 部署前端

如果你的 Laravel 应用采用前后端分离架构，前端可以直接部署到 Cloudflare Pages：

```javascript
// nuxt.config.ts 或 next.config.js
export default defineNuxtConfig({
  // SSR 模式
  nitro: {
    preset: 'cloudflare-pages',
  },
  
  // API 代理到 Laravel 后端
  routeRules: {
    '/api/**': {
      proxy: 'https://api.your-app.com/**',
    },
  },
});
```

```bash
# 部署到 Cloudflare Pages
npx wrangler pages deploy dist --project-name=my-laravel-app
```

### 2.3 方案三：Worker 直接运行 PHP（理论可行，生产不推荐）

Cloudflare 支持 WebAssembly，理论上可以将 PHP 编译为 Wasm 在 Workers 上运行。但目前这只是一个实验性方案：

```javascript
// 理论上的 PHP-Wasm Worker
import phpWasm from './php.wasm';

export default {
  async fetch(request) {
    const php = await phpWasm();
    const result = php.run(`
      <?php
      echo json_encode(['message' => 'Hello from PHP on Workers!']);
    `);
    
    return new Response(result, {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
```

**不推荐的原因**：

1. PHP Wasm 的启动时间远超 V8 Isolates
2. 无法使用 PHP 扩展（如 phpredis、pdo_mysql）
3. 文件系统操作受限
4. Composer 生态无法完整运行
5. 性能远不如原生 PHP-FPM

---

## 三、D1 数据库：边缘 SQLite

### 3.1 D1 概述

D1 是 Cloudflare 的边缘关系型数据库，基于 SQLite 构建。它将数据分布到全球边缘节点，为 Workers 提供低延迟的数据库访问。

| 特性 | D1 | PlanetScale | Supabase | Neon |
|------|-----|-------------|----------|------|
| 类型 | 边缘 SQLite | MySQL | PostgreSQL | PostgreSQL |
| 最大数据库大小 | 10GB（付费） | 50GB | 8GB | 10GB |
| 全球分布 | ✅ 自动 | 单区域 | 单区域 | 多区域 |
| 免费额度 | 5M 读/天, 100K 写/天 | 1B 读/月 | 500MB | 512MB |
| ORM 支持 | Drizzle | Prisma/Drizzle | Prisma | Prisma |

### 3.2 Laravel 与 D1 的集成

由于 D1 使用 SQLite 协议，Laravel 可以通过 `DatabaseServiceProvider` 连接 D1（通过 HTTP API）：

```php
<?php
// app/Services/D1Service.php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class D1Service
{
    private string $baseUrl;
    private string $apiToken;
    private string $databaseId;

    public function __construct()
    {
        $this->baseUrl = "https://api.cloudflare.com/client/v4/accounts/{env('CLOUDFLARE_ACCOUNT_ID')}/d1/database";
        $this->apiToken = env('CLOUDFLARE_API_TOKEN');
        $this->databaseId = env('CLOUDFLARE_D1_DATABASE_ID');
    }

    /**
     * 执行 D1 查询
     */
    public function query(string $sql, array $params = []): array
    {
        $response = Http::withToken($this->apiToken)
            ->post("{$this->baseUrl}/{$this->databaseId}/query", [
                'sql' => $sql,
                'params' => $params,
            ]);

        if (!$response->successful()) {
            throw new \RuntimeException("D1 query failed: " . $response->body());
        }

        return $response->json('result.0.results', []);
    }

    /**
     * 批量执行
     */
    public function batch(array $statements): array
    {
        $response = Http::withToken($this->apiToken)
            ->post("{$this->baseUrl}/{$this->databaseId}/batch", [
                'sql' => $statements,
            ]);

        return $response->json('result', []);
    }
}
```

### 3.3 D1 适用场景

D1 最适合作为边缘数据层，与 Laravel 后端的主数据库（MySQL/PostgreSQL）配合使用：

```
┌─────────────────────────────────────┐
│  D1 (边缘)                          │
│  - Feature Flags                    │
│  - 配置数据                         │
│  - 路由表                           │
│  - A/B 测试配置                     │
│  - IP 黑名单/白名单                 │
└─────────────────────────────────────┘
          │ (同步)
          ▼
┌─────────────────────────────────────┐
│  MySQL/PostgreSQL (主数据库)         │
│  - 用户数据                         │
│  - 订单数据                         │
│  - 业务核心数据                     │
└─────────────────────────────────────┘
```

---

## 四、KV 存储：全球分布的键值存储

### 4.1 KV 概述

KV 是 Cloudflare 的全球分布键值存储，适合存储需要全球低延迟读取的数据。

| 特性 | KV | Redis | Memcached |
|------|-----|-------|-----------|
| 分布式 | ✅ 全球 300+ | 需要集群 | 需要集群 |
| 持久化 | ✅ | 可选 | ❌ |
| 最大 Value | 25MB | 512MB | 1MB |
| 一致性 | 最终一致（60s） | 强一致 | 强一致 |
| 延迟 | < 10ms | < 1ms | < 1ms |
| 价格 | $0.50/M 读 | 按实例 | 按实例 |

### 4.2 使用 KV 存储 Session

```javascript
// worker.js - Session 管理
export default {
  async fetch(request, env) {
    // 从 Cookie 获取 Session ID
    const cookies = parseCookies(request.headers.get('Cookie'));
    const sessionId = cookies['laravel_session'] || crypto.randomUUID();

    // 从 KV 读取 Session
    const sessionData = await env.SESSION_KV.get(`session:${sessionId}`, {
      type: 'json',
    });

    // 添加 Session 数据到请求头
    const headers = new Headers(request.headers);
    if (sessionData) {
      headers.set('X-Session-Data', JSON.stringify(sessionData));
    }

    // 转发到 Laravel
    const response = await fetch(request, { headers });

    // 保存 Session 到 KV
    const newSessionData = response.headers.get('X-Session-Data');
    if (newSessionData) {
      await env.SESSION_KV.put(`session:${sessionId}`, newSessionData, {
        expirationTtl: 7200, // 2 小时
      });
    }

    // 设置 Cookie
    const newResponse = new Response(response.body, response);
    newResponse.headers.append(
      'Set-Cookie',
      `laravel_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax`
    );

    return newResponse;
  },
};
```

### 4.3 使用 KV 存储 Feature Flags

```javascript
// worker.js - Feature Flags
async function getFeatureFlag(env, flagName, userId) {
  // 先从 KV 读取（全球分布，低延迟）
  const flagConfig = await env.FEATURE_FLAGS.get(flagName, { type: 'json' });
  
  if (!flagConfig) return false;
  
  // 简单的百分比 rollout
  if (flagConfig.rollout_percentage !== undefined) {
    const hash = await hashString(userId + flagName);
    return (hash % 100) < flagConfig.rollout_percentage;
  }
  
  // 用户白名单
  if (flagConfig.whitelist?.includes(userId)) return true;
  
  return flagConfig.enabled || false;
}

// 在 Worker 中使用
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const userId = request.headers.get('X-User-Id');
    
    // 检查 feature flag
    const useNewApi = await getFeatureFlag(env, 'new-api-v2', userId);
    
    if (useNewApi && url.pathname.startsWith('/api/v1/')) {
      // 重写到新 API
      url.pathname = url.pathname.replace('/api/v1/', '/api/v2/');
      return fetch(url.toString(), request);
    }
    
    return fetch(request);
  },
};
```

### 4.4 KV 与 Laravel Cache 集成

```php
<?php
// app/Services/CloudflareKVCache.php

namespace App\Services;

use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Facades\Http;

class CloudflareKVCache implements Repository
{
    private string $baseUrl;
    private string $apiToken;
    private string $namespaceId;

    public function __construct()
    {
        $this->baseUrl = "https://api.cloudflare.com/client/v4/accounts/{env('CLOUDFLARE_ACCOUNT_ID')}/storage/kv/namespaces";
        $this->apiToken = env('CLOUDFLARE_API_TOKEN');
        $this->namespaceId = env('CLOUDFLARE_KV_NAMESPACE_ID');
    }

    public function get($key)
    {
        $response = Http::withToken($this->apiToken)
            ->get("{$this->baseUrl}/{$this->namespaceId}/values/{$key}");

        if ($response->status() === 404) {
            return null;
        }

        $value = $response->body();
        return json_decode($value, true) ?? $value;
    }

    public function put($key, $value, $ttl = null): bool
    {
        $response = Http::withToken($this->apiToken)
            ->put("{$this->baseUrl}/{$this->namespaceId}/values/{$key}", [
                'body' => is_array($value) ? json_encode($value) : $value,
                'expiration_ttl' => $ttl,
            ]);

        return $response->successful();
    }

    public function forget($key): bool
    {
        $response = Http::withToken($this->apiToken)
            ->delete("{$this->baseUrl}/{$this->namespaceId}/values/{$key}");

        return $response->successful();
    }

    // ... 其他 Cache 接口方法
}
```

---

## 五、R2 对象存储

### 5.1 R2 vs S3

| 特性 | Cloudflare R2 | AWS S3 | MinIO |
|------|--------------|--------|-------|
| 出口流量费 | **免费** | $0.09/GB | 免费（自托管） |
| 存储费 | $0.015/GB/月 | $0.023/GB/月 | 硬件成本 |
| S3 兼容 | ✅ | 原生 | ✅ |
| 全球分布 | 自动 | 需要配置 | 手动 |
| 最大对象大小 | 5TB | 5TB | 5TB |

### 5.2 Laravel 配置 R2 作为存储

R2 完全兼容 S3 API，Laravel 可以直接使用 `s3` 存储驱动：

```php
<?php
// config/filesystems.php
'disks' => [
    'r2' => [
        'driver' => 's3',
        'key' => env('R2_ACCESS_KEY_ID'),
        'secret' => env('R2_SECRET_ACCESS_KEY'),
        'region' => 'auto',
        'bucket' => env('R2_BUCKET'),
        'url' => env('R2_URL'),
        'endpoint' => env('R2_ENDPOINT'), // https://<account-id>.r2.cloudflarestorage.com
        'use_path_style_endpoint' => true,
        'throw' => false,
    ],
],
```

```env
# .env
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET=my-laravel-bucket
R2_URL=https://pub-xxx.r2.dev
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

### 5.3 通过 Worker 提供 R2 文件（带缓存）

```javascript
// worker.js - R2 文件服务
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1); // 去掉前导 /

    // 尝试从 R2 获取文件
    const object = await env.R2_BUCKET.get(key);
    
    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', object.etag);
    
    // 支持 Range 请求（视频/音频流式播放）
    if (request.headers.has('Range')) {
      const range = parseRange(request.headers.get('Range'), object.size);
      const partial = await object.range(range);
      headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
      headers.set('Content-Length', partial.length);
      return new Response(partial.body, { status: 206, headers });
    }

    return new Response(object.body, { headers });
  },
};
```

---

## 六、Queues：边缘消息队列

### 6.1 Queues 概述

Cloudflare Queues 是一个分布式消息队列，可以在 Workers 之间传递消息。它类似于 AWS SQS 或 RabbitMQ，但运行在 Cloudflare 的全球网络上。

### 6.2 Laravel Job 桥接到 Cloudflare Queues

```javascript
// producer-worker.js - 接收 Laravel 推送的消息
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const job = await request.json();
    
    // 将 Job 推送到 Cloudflare Queue
    await env.JOB_QUEUE.send(job);

    return new Response(JSON.stringify({ queued: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Queue Consumer
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processJob(message.body, env);
        message.ack();
      } catch (error) {
        message.retry();
      }
    }
  },
};

async function processJob(job, env) {
  switch (job.type) {
    case 'send_email':
      await sendEmail(job.data, env);
      break;
    case 'process_image':
      await processImage(job.data, env);
      break;
    case 'webhook':
      await callWebhook(job.data);
      break;
    default:
      console.warn(`Unknown job type: ${job.type}`);
  }
}
```

### 6.3 Laravel 端推送 Job 到 Cloudflare Queues

```php
<?php
// app/Jobs/CloudflareQueueJob.php

namespace App\Jobs;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class CloudflareQueueJob
{
    public function __construct(
        private readonly string $type,
        private readonly array $data,
        private readonly int $delaySeconds = 0
    ) {}

    public function dispatch(): void
    {
        $response = Http::withToken(config('services.cloudflare.api_token'))
            ->post(config('services.cloudflare.worker_url') . '/enqueue', [
                'type' => $this->type,
                'data' => $this->data,
                'delay' => $this->delaySeconds,
                'dispatched_at' => now()->toIso8601String(),
            ]);

        if (!$response->successful()) {
            Log::error('Failed to dispatch to Cloudflare Queue', [
                'type' => $this->type,
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
        }
    }
}

// 使用
(new CloudflareQueueJob('send_email', [
    'to' => 'user@example.com',
    'subject' => 'Welcome!',
    'template' => 'welcome',
]))->dispatch();
```

---

## 七、Durable Objects：有状态边缘计算

### 7.1 Durable Objects 概述

Durable Objects 是 Cloudflare 的有状态边缘计算原语。每个 Durable Object 是一个全局唯一的实体，拥有自己的持久化存储和计算环境。

适用场景：

1. **实时协作**：文档编辑、白板
2. **聊天室**：WebSocket 连接管理
3. **游戏服务器**：游戏房间状态
4. **限流器**：分布式速率限制
5. **序列生成器**：全局自增 ID

### 7.2 实现分布式限流器

```javascript
// rate-limiter.js
export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    const { clientId, limit, windowSeconds } = await request.json();
    
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    // 从存储中获取请求记录
    let requests = (await this.storage.get('requests')) || [];
    
    // 清除过期记录
    requests = requests.filter(timestamp => timestamp > windowStart);
    
    // 检查是否超过限制
    if (requests.length >= limit) {
      const retryAfter = Math.ceil((requests[0] + windowSeconds * 1000 - now) / 1000);
      return new Response(JSON.stringify({
        allowed: false,
        remaining: 0,
        retry_after: retryAfter,
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // 记录本次请求
    requests.push(now);
    await this.storage.put('requests', requests);
    
    return new Response(JSON.stringify({
      allowed: true,
      remaining: limit - requests.length,
      reset_at: new Date(requests[0] + windowSeconds * 1000).toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientId = request.headers.get('CF-Connecting-IP');
    
    // 获取或创建限流器实例
    const id = env.RATE_LIMITER.idFromName(`rate:${clientId}`);
    const limiter = env.RATE_LIMITER.get(id);
    
    // 检查速率限制
    const response = await limiter.fetch(request.url, {
      method: 'POST',
      body: JSON.stringify({
        clientId,
        limit: 100,        // 100 次
        windowSeconds: 60,  // 每 60 秒
      }),
    });
    
    const result = await response.json();
    
    if (!result.allowed) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
          'Retry-After': result.retry_after.toString(),
          'X-RateLimit-Remaining': '0',
        },
      });
    }
    
    // 继续处理请求
    const laravelResponse = await fetch(`https://origin.your-app.com${url.pathname}`, request);
    
    // 添加限流头
    const newResponse = new Response(laravelResponse.body, laravelResponse);
    newResponse.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    
    return newResponse;
  },
};
```

---

## 八、真实案例：全栈边缘架构

### 8.1 架构设计

```
用户请求
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare 边缘 (300+ 节点)                                 │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Worker   │  │ D1       │  │ KV       │  │ R2       │   │
│  │ (路由/   │  │ (配置/   │  │ (缓存/   │  │ (静态    │   │
│  │  限流/   │  │  Feature │  │  Session) │  │  资源)   │   │
│  │  缓存)   │  │  Flags)  │  │          │  │          │   │
│  └────┬─────┘  └──────────┘  └──────────┘  └──────────┘   │
│       │                                                     │
└───────┼─────────────────────────────────────────────────────┘
        │ (缓存未命中)
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Origin Server (美东)                                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Nginx → PHP-FPM → Laravel                           │   │
│  │  - 业务逻辑                                          │   │
│  │  - MySQL (主数据库)                                   │   │
│  │  - Redis (队列/缓存)                                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 完整 Worker 代码

```javascript
// wrangler.toml
// name = "laravel-edge-gateway"
// main = "src/index.js"
// compatibility_date = "2024-01-01"
//
// [[r2_buckets]]
// binding = "R2_BUCKET"
// bucket_name = "laravel-assets"
//
// [[kv_namespaces]]
// binding = "CACHE_KV"
// id = "your-kv-namespace-id"
//
// [[kv_namespaces]]
// binding = "SESSION_KV"
// id = "your-session-kv-namespace-id"
//
// [[d1_databases]]
// binding = "CONFIG_DB"
// database_id = "your-d1-database-id"
//
// [vars]
// ORIGIN_URL = "https://origin.your-app.com"

// src/index.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const startTime = Date.now();

    try {
      // 1. 健康检查
      if (url.pathname === '/health') {
        return new Response('OK', { status: 200 });
      }

      // 2. 静态资源（R2）
      if (this.isStaticAsset(url.pathname)) {
        return this.handleStaticAsset(request, env);
      }

      // 3. 限流检查
      const rateLimitResult = await this.checkRateLimit(request, env);
      if (!rateLimitResult.allowed) {
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() },
        });
      }

      // 4. 边缘缓存检查（KV）
      if (request.method === 'GET') {
        const cached = await this.getEdgeCache(url, env);
        if (cached) {
          return this.addHeaders(cached, {
            'X-Cache': 'HIT',
            'X-Edge-Node': request.cf?.colo || 'unknown',
            'X-Response-Time': `${Date.now() - startTime}ms`,
          });
        }
      }

      // 5. Feature Flag 检查
      const featureFlags = await this.getFeatureFlags(env);

      // 6. 回源 Laravel
      const originRequest = new Request(
        `${env.ORIGIN_URL}${url.pathname}${url.search}`,
        {
          method: request.method,
          headers: this.forwardHeaders(request),
          body: request.method !== 'GET' && request.method !== 'HEAD'
            ? request.body
            : undefined,
        }
      );

      const response = await fetch(originRequest);

      // 7. 缓存 GET 响应到 KV
      if (request.method === 'GET' && response.ok) {
        ctx.waitUntil(this.cacheResponse(url, response.clone(), env));
      }

      // 8. 返回响应
      return this.addHeaders(response, {
        'X-Cache': 'MISS',
        'X-Edge-Node': request.cf?.colo || 'unknown',
        'X-Response-Time': `${Date.now() - startTime}ms`,
        'X-Feature-Flags': JSON.stringify(featureFlags),
      });
    } catch (error) {
      return new Response(`Edge Error: ${error.message}`, { status: 502 });
    }
  },

  isStaticAsset(pathname) {
    return /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/.test(pathname);
  },

  async handleStaticAsset(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    
    const object = await env.R2_BUCKET.get(key);
    if (!object) {
      return fetch(`${env.ORIGIN_URL}${url.pathname}`, request);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': object.etag,
      },
    });
  },

  async checkRateLimit(request, env) {
    // 简单的 KV 限流（生产环境建议使用 Durable Objects）
    const ip = request.headers.get('CF-Connecting-IP');
    const key = `ratelimit:${ip}`;
    const current = await env.CACHE_KV.get(key, { type: 'json' }) || { count: 0, resetAt: 0 };
    
    const now = Date.now();
    if (now > current.resetAt) {
      await env.CACHE_KV.put(key, JSON.stringify({ count: 1, resetAt: now + 60000 }), {
        expirationTtl: 120,
      });
      return { allowed: true };
    }
    
    if (current.count >= 100) {
      return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
    }
    
    current.count++;
    await env.CACHE_KV.put(key, JSON.stringify(current), {
      expirationTtl: 120,
    });
    
    return { allowed: true };
  },

  async getEdgeCache(url, env) {
    const cacheKey = `cache:${url.pathname}:${url.search}`;
    const data = await env.CACHE_KV.get(cacheKey, { type: 'arrayBuffer' });
    
    if (!data) return null;
    
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  },

  async cacheResponse(url, response, env) {
    const cacheKey = `cache:${url.pathname}:${url.search}`;
    const body = await response.arrayBuffer();
    
    await env.CACHE_KV.put(cacheKey, body, {
      expirationTtl: 60,
    });
  },

  async getFeatureFlags(env) {
    // 从 D1 获取 Feature Flags
    try {
      const { results } = await env.CONFIG_DB.prepare(
        'SELECT flag_name, enabled, rollout_percentage FROM feature_flags WHERE enabled = 1'
      ).all();
      return results;
    } catch {
      return [];
    }
  },

  forwardHeaders(request) {
    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP'));
    headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP'));
    headers.set('X-Country', request.cf?.country || 'unknown');
    headers.set('X-City', request.cf?.city || 'unknown');
    return headers;
  },

  addHeaders(response, additionalHeaders) {
    const newResponse = new Response(response.body, response);
    for (const [key, value] of Object.entries(additionalHeaders)) {
      newResponse.headers.set(key, value);
    }
    return newResponse;
  },
};
```

---

## 九、性能基准对比

### 9.1 测试环境

| 项目 | 配置 |
|------|------|
| Origin 服务器 | AWS EC2 t3.medium（美东弗吉尼亚） |
| 测试工具 | k6 + Cloudflare Observatory |
| 测试地区 | 美东、欧洲（伦敦）、亚太（东京） |

### 9.2 TTFB 对比

| 地区 | 直连 Origin | Workers 边缘缓存 | 改善幅度 |
|------|-----------|-----------------|---------|
| 美东 | 45ms | 12ms | -73% |
| 欧洲（伦敦） | 180ms | 15ms | -92% |
| 亚太（东京） | 320ms | 18ms | -94% |
| 南美（圣保罗） | 250ms | 20ms | -92% |

### 9.3 成本对比（月 1000 万请求）

| 方案 | 月费用 |
|------|--------|
| AWS Lambda + API Gateway | ~$150 |
| Cloudflare Workers (Paid) | $5 + $0.30/M = $8 |
| 传统 VPS (t3.medium) | ~$30 |

---

## 十、踩坑记录

### 坑 #1: 128MB 内存限制

**现象**：处理大型 JSON 响应时，Worker 内存溢出。

**解决方案**：使用流式处理，不要将整个响应体加载到内存：

```javascript
// ❌ 错误：加载整个响应体
const data = await response.json();
const modified = transform(data);
return new Response(JSON.stringify(modified));

// ✅ 正确：流式处理
const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
const reader = response.body.getReader();

// 流式处理
(async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(transform(value));
  }
  writer.close();
})();

return new Response(readable);
```

### 坑 #2: CPU 时间限制

**现象**：复杂业务逻辑超过 CPU 时间限制（免费 10ms，付费 30s）。

**解决方案**：将复杂计算移到 Origin 服务器，Worker 只做路由和缓存：

```javascript
// Worker 只负责：
// 1. 静态资源服务
// 2. 缓存检查
// 3. 请求转发
// 4. 响应缓存

// 复杂逻辑（认证、业务规则、数据处理）留给 Laravel
```

### 坑 #3: KV 的最终一致性

**现象**：写入 KV 后立即读取，有时读不到最新值。

**原因**：KV 使用最终一致性模型，全球传播可能需要 60 秒。

**解决方案**：对于需要强一致性的数据，使用 D1 或直接回源：

```javascript
// KV 适合：配置数据、缓存、Feature Flags（允许短暂不一致）
// KV 不适合：库存计数、余额、实时数据

// 强一致性场景使用 D1
const result = await env.CONFIG_DB.prepare(
  'SELECT value FROM config WHERE key = ?'
).bind(key).first();
```

### 坑 #4: Cron Triggers 的限制

**现象**：Cron Triggers 只能触发 Worker，不能触发 PHP 脚本。

**解决方案**：在 Worker 的 Cron Trigger 中调用 Laravel 的 API 端点：

```javascript
// worker.js
export default {
  async scheduled(event, env, ctx) {
    // 调用 Laravel 的 cron 端点
    const response = await fetch(`${env.ORIGIN_URL}/api/cron/daily-report`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CRON_SECRET}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('Cron result:', response.status);
  },
};
```

### 坑 #5: D1 数据库大小限制

**现象**：D1 免费版限制 5GB，付费版限制 10GB。

**解决方案**：D1 只存储边缘需要的热数据，大数据存储在 MySQL/PostgreSQL：

```
D1 (边缘):
├── feature_flags (100 行)
├── ip_blacklist (10000 行)
├── rate_limit_rules (50 行)
└── routing_rules (200 行)

MySQL (Origin):
├── users (100 万行)
├── orders (5000 万行)
└── products (10 万行)
```

---

## 十一、总结

Cloudflare Workers 生态为 Laravel 应用提供了一个强大的边缘计算层。核心价值在于：

1. **全球分布**：300+ 边缘节点，TTFB < 50ms
2. **极低成本**：按请求计费，比 Lambda 便宜 10-20 倍
3. **零冷启动**：V8 Isolates，< 1ms 启动时间
4. **丰富生态**：D1、KV、R2、Queues、Durable Objects 一站式解决方案

对于 Laravel 开发者，推荐的集成路径是：

1. **起步**：用 Workers 做 API Gateway + 边缘缓存
2. **进阶**：用 R2 替代 S3 存储静态资源（免出口流量费）
3. **深入**：用 D1 存储边缘配置，用 KV 做全球缓存
4. **高级**：用 Durable Objects 实现分布式限流和实时功能

Laravel 仍然运行在传统的 VPS/容器中处理核心业务逻辑，Cloudflare Workers 负责边缘加速、安全防护和全球分发。这种混合架构既保留了 Laravel 生态的完整性和开发效率，又获得了边缘计算的性能优势。

---

## 参考资料

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [D1 文档](https://developers.cloudflare.com/d1/)
- [KV 文档](https://developers.cloudflare.com/kv/)
- [R2 文档](https://developers.cloudflare.com/r2/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)

---

## 相关阅读

- [WebAssembly 后端实战：WasmEdge/Wasmtime 边缘计算与 Serverless](/categories/运维/WebAssembly-后端实战-WasmEdge-Wasmtime-边缘计算与Serverless/) — 同样聚焦边缘计算与 Serverless 运行时，探索 WebAssembly 在后端服务中的应用
- [Google Cloud Run：容器化 Laravel 应用 Serverless 部署——对比 AWS Lambda](/categories/运维/Google-Cloud-Run-容器化Laravel应用Serverless部署-对比AWS-Lambda/) — 对比主流 Serverless 平台的 Laravel 部署方案
- [多区域部署实战：全球化 Laravel 应用——数据库同步、CDN 边缘缓存与跨区域一致性](/categories/运维/多区域部署实战-全球化Laravel应用-数据库同步-CDN边缘缓存与跨区域一致性/) — 全球化部署中 CDN 边缘缓存与跨区域数据一致性策略
- [Azure Container Apps 实战：Laravel 微服务——Azure 部署与自动扩缩容](/categories/运维/Azure-Container-Apps-实战-Laravel-微服务-Azure-部署与自动扩缩容/) — 另一种 Serverless 架构下的 Laravel 微服务部署实践
