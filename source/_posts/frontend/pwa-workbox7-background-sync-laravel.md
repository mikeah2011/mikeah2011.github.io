---
title: "Progressive Web App 2026 实战：Workbox 7、Background Sync、Periodic Sync——Laravel 应用的离线优先 PWA 改造指南"
keywords: [Progressive Web App, Workbox, Background Sync, Periodic Sync, Laravel, PWA, 应用的离线优先, 改造指南, 前端]
date: 2026-06-09 22:11:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
  - PWA
  - Workbox
  - Service Worker
  - Laravel
  - Background Sync
  - Periodic Sync
  - 离线优先
description: "手把手将 Laravel 应用改造为离线优先 PWA，涵盖 Workbox 7 配置、Background Sync 表单提交、Periodic Sync 后台更新，附完整可运行代码。"
---


## 为什么 2026 年还要聊 PWA？

2025 年底 Chrome 131 全面启用了 `Storage Partitioning`，Safari 18 也跟进了 Push API。PWA 的生态在 2026 年终于补齐了最后几块拼图：iOS 推送、后台同步、周期更新全部可用。对于 Laravel 应用来说，这意味着——你可以用纯 Web 技术做到接近原生 App 的体验，而不需要维护 Flutter/RN 的双端代码。

本文的目标很明确：**把一个已有的 Laravel 应用改造成离线优先（Offline-First）PWA**。不是 Hello World demo，是生产级别的改造方案。

## 核心概念速览

### Service Worker 生命周期

```
安装(Install) → 激活(Activate) → 控制(Control)
     ↓                ↓               ↓
  预缓存资源      清理旧缓存       拦截请求
```

Service Worker 是一个独立于主线程的 JS 脚本，运行在浏览器后台。它不直接操作 DOM，而是通过拦截网络请求来实现缓存策略。

### Workbox 7 的定位

Workbox 是 Google 维护的 Service Worker 工具库。7.x 版本（2025 年发布）的核心改进：

- **模块化更彻底**：按需引入，bundle 更小
- **TypeScript 原生支持**：不再需要 `@types/workbox-*`
- **Vite 插件**：`workbox-vite-plugin` 替代了旧的 `workbox-webpack-plugin`
- **Periodic Sync 内置支持**：不需要手动注册 `periodicsync` 事件

### 缓存策略一览

| 策略 | 适用场景 | 离线可用 |
|------|----------|----------|
| CacheFirst | 静态资源（JS/CSS/图片） | ✅ |
| NetworkFirst | API 数据（需要新鲜度） | ✅（降级） |
| StaleWhileRevalidate | 频繁变化但不关键的资源 | ✅ |
| NetworkOnly | 需要实时性的请求（支付、登录） | ❌ |
| CacheOnly | 纯离线内容 | ✅ |

## 第一步：Laravel 侧准备

### 1. 注册 Service Worker 路由

```php
// routes/web.php
Route::get('/sw.js', function () {
    $content = File::get(public_path('sw.js'));
    return response($content)
        ->header('Content-Type', 'application/javascript')
        ->header('Service-Worker-Allowed', '/');
})->name('service-worker');
```

> 注意：Service Worker 必须从根路径 `/` 提供，scope 决定了它能控制哪些页面。

### 2. 添加 Web App Manifest

```php
// routes/web.php
Route::get('/manifest.json', function () {
    return response()->json([
        'name' => config('app.name'),
        'short_name' => substr(config('app.name'), 0, 12),
        'description' => '离线优先 PWA 应用',
        'start_url' => '/',
        'display' => 'standalone',
        'background_color' => '#ffffff',
        'theme_color' => '#4a90d9',
        'orientation' => 'portrait-primary',
        'icons' => [
            ['src' => '/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png'],
            ['src' => '/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png'],
            ['src' => '/icons/icon-maskable-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
        ],
        'screenshots' => [
            ['src' => '/screenshots/desktop.png', 'sizes' => '1280x720', 'form_factor' => 'wide'],
            ['src' => '/screenshots/mobile.png', 'sizes' => '390x844', 'form_factor' => 'narrow'],
        ],
    ])->header('Content-Type', 'application/manifest+json');
});
```

### 3. Blade 布局注入

```html
<!-- resources/views/layouts/app.blade.php 的 <head> 中 -->
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#4a90d9">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">

<script>
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            console.log('SW registered:', reg.scope);
        } catch (err) {
            console.error('SW registration failed:', err);
        }
    });
}
</script>
```

## 第二步：Workbox 7 配置

### 项目结构

```
resources/
  pwa/
    sw.ts          # Service Worker 主文件
    cache-config.ts # 缓存策略配置
    sync.ts        # Background Sync 逻辑
    periodic.ts    # Periodic Sync 逻辑
vite.config.ts     # Vite 构建配置
```

### 安装依赖

```bash
npm install workbox-precaching workbox-routing workbox-strategies \
            workbox-background-sync workbox-expiration \
            workbox-cacheable-response vite-plugin-pwa -D
```

### Vite 配置

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.ts'],
            refresh: true,
        }),
        VitePWA({
            srcDir: 'resources/pwa',
            filename: 'sw.ts',
            strategies: 'injectManifest',
            injectRegister: null, // 我们手动注册
            manifest: false,      // Laravel 路由提供
            injectManifest: {
                injectionPoint: 'self.__WB_MANIFEST',
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            },
            devOptions: {
                enabled: false, // 开发环境不启用 SW
            },
        }),
    ],
});
```

### Service Worker 主文件

```typescript
// resources/pwa/sw.ts
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { Queue } from 'workbox-background-sync';

declare const self: ServiceWorkerGlobalScope;

// ========== 预缓存 ==========
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ========== 运行时缓存策略 ==========

// 1. API 请求 → NetworkFirst（离线时返回缓存）
registerRoute(
    ({ url }) => url.pathname.startsWith('/api/'),
    new NetworkFirst({
        cacheName: 'api-cache',
        plugins: [
            new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 30 }), // 30 分钟
            new CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
        networkTimeoutSeconds: 5, // 5 秒超时后降级到缓存
    })
);

// 2. 静态资源 → CacheFirst
registerRoute(
    ({ request }) => ['style', 'script', 'worker'].includes(request.destination),
    new CacheFirst({
        cacheName: 'static-assets',
        plugins: [
            new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }), // 30 天
            new CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
    })
);

// 3. 图片 → CacheFirst + 数量限制
registerRoute(
    ({ request }) => request.destination === 'image',
    new CacheFirst({
        cacheName: 'image-cache',
        plugins: [
            new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 }), // 90 天
            new CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
    })
);

// 4. 页面导航 → NetworkFirst（关键：离线时能打开应用）
registerRoute(
    ({ request }) => request.mode === 'navigate',
    new NetworkFirst({
        cacheName: 'page-cache',
        plugins: [
            new ExpirationPlugin({ maxEntries: 50 }),
            new CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
        networkTimeoutSeconds: 3,
    })
);

// ========== 离线回退页 ==========
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open('offline-fallback').then((cache) => cache.add(OFFLINE_URL))
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    return await fetch(event.request);
                } catch {
                    const cache = await caches.open('offline-fallback');
                    return (await cache.match(OFFLINE_URL)) ?? Response.error();
                }
            })()
        );
    }
});
```

### 离线回退页面

```php
// routes/web.php
Route::get('/offline.html', function () {
    return view('offline');
})->name('offline');
```

```html
<!-- resources/views/offline.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>离线模式</title>
    <style>
        body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
               align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
        .container { text-align: center; padding: 2rem; }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { color: #333; margin-bottom: 0.5rem; }
        p { color: #666; line-height: 1.6; }
        button { margin-top: 1.5rem; padding: 0.75rem 2rem; background: #4a90d9; color: #fff;
                 border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
        button:hover { background: #357abd; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">📡</div>
        <h1>暂时无法连接</h1>
        <p>你当前处于离线状态，该页面尚未缓存。<br>请检查网络后重试。</p>
        <button onclick="location.reload()">重新加载</button>
    </div>
</body>
</html>
```

## 第三步：Background Sync——离线表单提交

这是 PWA 最实用的特性之一。用户在地铁里填完表单，点提交，不会报错——数据会暂存在本地，等网络恢复后自动发送。

### 注册 Sync Queue

```typescript
// resources/pwa/sync.ts
import { Queue } from 'workbox-background-sync';

// 表单提交队列
export const formSubmitQueue = new Queue('form-submissions', {
    maxRetentionTime: 24 * 60, // 最长保留 24 小时（分钟）
    onSync: async ({ queue }) => {
        let entry;
        while ((entry = await queue.shiftRequest())) {
            try {
                const response = await fetch(entry.request);
                if (!response.ok) {
                    // 如果服务器返回错误，重新入队
                    await queue.unshiftRequest(entry);
                    // 通知用户
                    const clients = await self.clients.matchAll();
                    clients.forEach((client) => {
                        client.postMessage({
                            type: 'SYNC_FAILED',
                            url: entry.request.url,
                            status: response.status,
                        });
                    });
                    return;
                }
                // 成功，通知前端
                const clients = await self.clients.matchAll();
                clients.forEach((client) => {
                    client.postMessage({
                        type: 'SYNC_SUCCESS',
                        url: entry.request.url,
                    });
                });
            } catch (error) {
                // 网络仍然不可用，重新入队
                await queue.unshiftRequest(entry);
                throw error; // 触发重试
            }
        }
    },
});
```

### 在 SW 主文件中注册路由拦截

```typescript
// 在 sw.ts 中追加
import { formSubmitQueue } from './sync';

// 拦截 POST 请求，失败时自动加入队列
registerRoute(
    ({ url, request }) =>
        request.method === 'POST' &&
        (url.pathname.startsWith('/api/') || url.pathname.startsWith('/forms/')),
    async ({ event }) => {
        try {
            return await fetch(event.request);
        } catch (error) {
            // 网络失败，加入后台同步队列
            await formSubmitQueue.pushRequest({ request: event.request });
            // 返回一个"已排队"的响应给前端
            return new Response(
                JSON.stringify({
                    queued: true,
                    message: '请求已加入队列，将在网络恢复后自动提交',
                }),
                {
                    status: 202,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }
    },
    'POST'
);
```

### 前端表单适配

```typescript
// resources/js/utils/offline-form.ts
export async function submitForm(url: string, data: Record<string, unknown>) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '',
        },
        body: JSON.stringify(data),
    });

    const result = await response.json();

    if (result.queued) {
        // 表单已加入离线队列
        showToast('已保存，将在联网后自动提交', 'info');
        // 监听同步结果
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data.type === 'SYNC_SUCCESS') {
                showToast('离线数据已同步完成！', 'success');
            } else if (event.data.type === 'SYNC_FAILED') {
                showToast('同步失败，请手动重试', 'error');
            }
        });
        return { success: true, queued: true };
    }

    return { success: response.ok, queued: false, data: result };
}

function showToast(message: string, type: string) {
    // 用你项目中的 toast 组件
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
```

### Laravel 侧：处理重复提交

后台同步可能会重复发送请求，Laravel 侧需要幂等处理：

```php
// app/Http/Middleware/IdempotencyMiddleware.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Cache;

class IdempotencyMiddleware
{
    public function handle($request, Closure $next)
    {
        $key = $request->header('Idempotency-Key');

        if ($key && Cache::has("idempotent:{$key}")) {
            return Cache::get("idempotent:{$key}");
        }

        $response = $next($request);

        if ($key && $response->isSuccessful()) {
            Cache::put("idempotent:{$key}", $response, 86400); // 24 小时
        }

        return $response;
    }
}
```

前端在提交时自动携带幂等键：

```typescript
const idempotencyKey = crypto.randomUUID();
await fetch(url, {
    method: 'POST',
    headers: {
        'Idempotency-Key': idempotencyKey,
        // ...其他 headers
    },
    body: JSON.stringify(data),
});
```

## 第四步：Periodic Sync——后台定期更新

Periodic Sync 让应用在后台定期拉取最新数据，用户打开时已经是最新状态。

### 权限请求

```typescript
// resources/js/utils/periodic-sync.ts
export async function registerPeriodicSync() {
    if (!('periodicSync' in navigator)) {
        console.warn('Periodic Background Sync 不支持');
        return;
    }

    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });

    if (status.state === 'granted') {
        const reg = await navigator.serviceWorker.ready;
        try {
            // 每小时同步一次文章列表
            await reg.periodicSync.register('sync-articles', {
                minInterval: 60 * 60 * 1000, // 1 小时
            });
            // 每 12 小时同步一次用户数据
            await reg.periodicSync.register('sync-user-data', {
                minInterval: 12 * 60 * 60 * 1000, // 12 小时
            });
            console.log('Periodic Sync 注册成功');
        } catch (err) {
            console.error('Periodic Sync 注册失败:', err);
        }
    }
}
```

### SW 中处理 Periodic Sync

```typescript
// resources/pwa/periodic.ts
export async function handlePeriodicArticles() {
    const cache = await caches.open('api-cache');
    try {
        const response = await fetch('/api/articles?per_page=20&page=1');
        if (response.ok) {
            await cache.put('/api/articles?per_page=20&page=1', response.clone());
            // 通知前端有新内容
            const clients = await self.clients.matchAll();
            clients.forEach((client) => {
                client.postMessage({ type: 'CONTENT_UPDATED', key: 'articles' });
            });
        }
    } catch (err) {
        console.error('Periodic sync articles failed:', err);
    }
}

export async function handlePeriodicUserData() {
    const cache = await caches.open('user-data-cache');
    try {
        const response = await fetch('/api/user/profile');
        if (response.ok) {
            await cache.put('/api/user/profile', response);
        }
    } catch (err) {
        console.error('Periodic sync user data failed:', err);
    }
}
```

在 SW 主文件中注册：

```typescript
// 在 sw.ts 中追加
import { handlePeriodicArticles, handlePeriodicUserData } from './periodic';

self.addEventListener('periodicsync', (event) => {
    switch (event.tag) {
        case 'sync-articles':
            event.waitUntil(handlePeriodicArticles());
            break;
        case 'sync-user-data':
            event.waitUntil(handlePeriodicUserData());
            break;
    }
});
```

## 第五步：推送通知（可选但推荐）

2026 年 iOS Safari 已完整支持 Web Push。Laravel 应用可以通过 `minishlink/web-push` 包发送推送。

### 安装

```bash
composer require minishlink/web-push
```

### 生成 VAPID 密钥

```bash
php artisan web-push:vapid
```

输出类似：
```
VAPID_PUBLIC_KEY=BNxv...
VAPID_PRIVATE_KEY=abc123...
```

### 前端订阅

```typescript
export async function subscribePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
    });

    // 发送到 Laravel 后端
    await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
    });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
```

### Laravel 推送服务

```php
// app/Services/PushNotificationService.php
namespace App\Services;

use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;
use App\Models\PushSubscription;

class PushNotificationService
{
    private WebPush $webPush;

    public function __construct()
    {
        $this->webPush = new WebPush([
            'VAPID' => [
                'subject' => config('app.url'),
                'publicKey' => config('services.vapid.public_key'),
                'privateKey' => config('services.vapid.private_key'),
            ],
        ]);
    }

    public function sendToUser(int $userId, string $title, string $body, ?string $url = null): void
    {
        $subscriptions = PushSubscription::where('user_id', $userId)->get();

        foreach ($subscriptions as $sub) {
            $subscription = Subscription::create([
                'endpoint' => $sub->endpoint,
                'publicKey' => $sub->public_key,
                'authToken' => $sub->auth_token,
                'contentEncoding' => $sub->content_encoding,
            ]);

            $payload = json_encode([
                'title' => $title,
                'body' => $body,
                'url' => $url ?? '/',
                'icon' => '/icons/icon-192.png',
            ]);

            $this->webPush->sendOneNotification($subscription, $payload);
        }

        $this->webPush->flush();
    }
}
```

## 踩坑记录

### 1. 缓存导致的"幽灵更新"

**问题**：用户反馈改了密码但还是用旧密码能登录。

**原因**：Service Worker 缓存了登录页的 HTML，包含旧的 CSRF token。

**解决**：对 HTML 页面用 `NetworkFirst`，设置较短的 `networkTimeoutSeconds`：

```typescript
registerRoute(
    ({ request }) => request.mode === 'navigate',
    new NetworkFirst({
        cacheName: 'page-cache',
        networkTimeoutSeconds: 3, // 3 秒内拿不到就用缓存
    })
);
```

### 2. iOS Safari 的缓存限制

**问题**：Safari 在隐身模式下不支持 Cache API。

**解决**：所有缓存操作都要 try-catch：

```typescript
async function safeCachePut(request: Request, response: Response) {
    try {
        const cache = await caches.open('api-cache');
        await cache.put(request, response);
    } catch (err) {
        console.warn('Cache put failed (可能是隐身模式):', err);
    }
}
```

### 3. Background Sync 的 Safari 兼容

**问题**：Safari 18 支持 Push API 但不支持 Background Sync。

**解决**：降级方案——在 `beforeunload` 时把未提交数据存入 IndexedDB，下次打开时检查并重发：

```typescript
// resources/js/utils/fallback-sync.ts
const DB_NAME = 'offline-queue';
const STORE_NAME = 'pending-requests';

export function savePendingRequest(url: string, body: string, headers: Record<string, string>) {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => {
        const tx = request.result.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).add({ url, body, headers, timestamp: Date.now() });
    };
}

export async function flushPendingRequests() {
    return new Promise<void>((resolve) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onsuccess = () => {
            const tx = request.result.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const getAll = store.getAll();
            getAll.onsuccess = async () => {
                for (const item of getAll.result) {
                    try {
                        await fetch(item.url, {
                            method: 'POST',
                            headers: item.headers,
                            body: item.body,
                        });
                        store.delete(item.id);
                    } catch {
                        // 仍然离线，保留
                    }
                }
                resolve();
            };
        };
    });
}

// 页面加载时自动刷新
window.addEventListener('load', () => {
    if (navigator.onLine) {
        flushPendingRequests();
    }
});
```

### 4. Workbox 7 的 precache 注入点

**问题**：Vite 构建后 `self.__WB_MANIFEST` 未被替换。

**原因**：`injectManifest` 模式要求 SW 源文件中必须有精确的 `self.__WB_MANIFEST` 字符串，不能被 TypeScript 编译修改。

**解决**：在 `tsconfig.json` 中排除 SW 文件，单独用 esbuild 处理：

```json
{
    "exclude": ["resources/pwa/**"]
}
```

VitePWA 插件会自行处理 TS 编译和 manifest 注入。

### 5. 缓存膨胀

**问题**：图片缓存占用 500MB+ 存储。

**解决**：设置合理的 `maxEntries` 和 `maxAgeSeconds`，并用 `ExpirationPlugin`：

```typescript
new ExpirationPlugin({
    maxEntries: 200,           // 最多 200 张
    maxAgeSeconds: 30 * 24 * 60 * 60, // 30 天过期
    purgeOnQuotaError: true,   // 存储满时自动清理
})
```

## 生产部署检查清单

```bash
# 1. 构建
npm run build

# 2. 验证 SW 文件存在
ls public/build/sw.js

# 3. 本地测试（需要 HTTPS 或 localhost）
php artisan serve

# 4. Lighthouse 审计
npx lighthouse https://your-app.com --view

# 5. 检查关键指标
# - PWA 审计全部通过
# - First Contentful Paint < 1.8s
# - Time to Interactive < 3.8s
# - 缓存命中率 > 80%（第二次访问）
```

Laravel Nginx 配置补充：

```nginx
# Service Worker 不缓存
location = /sw.js {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Service-Worker-Allowed "/";
    try_files $uri /index.php?$query_string;
}

# Manifest
location = /manifest.json {
    add_header Cache-Control "no-cache";
    try_files $uri /index.php?$query_string;
}
```

## 总结

PWA 改造的核心收益：

1. **离线可用**：地铁、飞机、弱网环境不再白屏
2. **秒开体验**：静态资源缓存后，二次访问 < 500ms
3. **推送通知**：不用上架 App Store 也能触达用户
4. **节省带宽**：缓存命中后不再重复下载，用户和服务器都省

改造成本：一个中等复杂度的 Laravel 应用，2-3 天可以完成基础 PWA 改造（manifest + SW + 缓存策略），加上 Background Sync 和 Periodic Sync 再加 1-2 天。

Workbox 7 封装了大部分 Service Worker 的复杂性，你只需要声明缓存策略，不用手写 fetch 事件处理。配合 Laravel 的路由系统，整体方案侵入性很低。

**建议从 NetworkFirst + 静态资源 CacheFirst 开始，逐步添加 Background Sync 和 Periodic Sync。** 不要一上来就搞最复杂的方案，先让用户能离线打开应用，再慢慢优化。
