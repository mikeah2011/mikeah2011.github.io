---

title: Web Push API (VAPID) 实战：浏览器原生推送通知——Laravel 后端 Service Worker 注册、订阅管理与消息分发
keywords: [Web Push API, VAPID, Laravel, Service Worker, 浏览器原生推送通知, 后端, 注册, 订阅管理与消息分发]
date: 2026-06-05 14:40:00
tags:
- web-push
- vapid
- service-worker
- Laravel
- 推送通知
- PWA
categories:
- frontend
description: 手把手教你用 Web Push API + VAPID 协议实现浏览器原生推送通知：涵盖 Service Worker 注册与 PushManager 订阅管理、Laravel 后端端到端加密消息队列分发、电商订单状态/降价提醒/促销广播完整实战，对比 Firebase Cloud Messaging，附浏览器兼容性、HTTPS 部署与常见踩坑排查指南。
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---



在移动互联网时代，推送通知是用户触达的核心手段。打开手机，各类应用的推送消息铺天盖地：外卖到了、快递签收、限时折扣、好友动态……这些即时触达能力极大提升了用户活跃度和转化率。然而在 Web 端，长期以来缺乏统一的原生推送方案，开发者不得不依赖邮件、短信或第三方 SDK 来触达用户，体验和效果都不尽如人意。

Web Push API 结合 VAPID（Voluntary Application Server Identification）标准的出现，彻底改变了这一局面。无需依赖任何第三方 SDK，浏览器即可原生支持推送通知，即使用户关闭了标签页甚至浏览器，消息依然能够送达。这意味着 Web 应用终于拥有了与原生 App 相媲美的推送能力。

本文将从零开始，手把手带你实现一个完整的 Web Push 通知系统：前端 Service Worker 注册与 PushManager 订阅管理，后端 Laravel 集成消息加密与队列分发，以及电商场景下的实际应用案例。无论你是前端工程师还是全栈开发者，读完本文都能在自己的项目中快速落地浏览器推送功能。

## 一、Web Push API 标准概述

Web Push API 是 W3C 标准的一部分，由三个核心组件协同工作。首先是 **Notification API**，它负责在用户的设备桌面上展示通知 UI，包括标题、正文、图标和操作按钮。其次是 **Push API**，它允许 Service Worker 在后台接收来自推送服务器的消息，即使网页没有在浏览器中打开。最后是 **VAPID 协议**，它是应用服务器的身份验证机制，确保只有持有合法密钥的服务器才能向特定订阅者发送推送消息。

整个推送通知的工作流程可以分为四个阶段：

**第一阶段：订阅**。用户在浏览器中点击"开启推送通知"按钮，浏览器弹出权限请求对话框。用户同意授权后，浏览器通过 PushManager 创建一个 PushSubscription 对象，其中包含推送到哪个端点（endpoint）、以及用于加密的公钥（p256dh）和认证密钥（auth）。前端将这些信息发送给后端服务器保存。

**第二阶段：触发事件**。后端发生了需要通知用户的事件，比如订单状态变更、商品降价、促销活动开始等。

**第三阶段：推送消息**。后端服务器使用 VAPID 私钥签名请求，并使用用户的 PushSubscription 中的公钥加密消息载荷，然后通过 Web Push Protocol 将加密后的消息发送到推送服务端点（如 Google FCM、Mozilla Push Service 等）。

**第四阶段：接收通知**。推送服务通过操作系统级别的推送通道将消息传递到用户的设备。浏览器中的 Service Worker 捕获 push 事件，解密载荷，然后调用 Notification API 在用户桌面上显示通知。

与传统的长轮询、Server-Sent Events 或 WebSocket 方案相比，Web Push 有一个决定性的优势：**即使用户关闭了浏览器标签页甚至浏览器本身，推送消息依然能够送达**。这是因为推送消息走的是操作系统级别的推送通道，与原生 App 的推送机制本质上是相同的。此外，Web Push 完全免费、无第三方依赖、数据端到端加密，这使得它成为 Web 应用推送方案的首选。

## 二、VAPID 密钥生成与配置

VAPID 是 Web Push 的核心身份验证协议，全称是 Voluntary Application Server Identification。它使用一对 ECDSA（椭圆曲线数字签名算法）密钥来标识应用服务器的身份。公钥分发给前端用于创建订阅，私钥保存在后端用于签名推送请求。这种机制的好处是不依赖任何第三方服务商的 API Key——你完全掌控推送身份。

### 2.1 生成 VAPID 密钥对

最简单的方式是使用 Node.js 的 `web-push` CLI 工具：

```bash
npm install -g web-push
web-push generate-vapid-keys
```

执行后会输出一对密钥：

```
=======================================
Public Key:
BNxQnK9YaGPuDcHCRbOqZfR7n3GKwGhGCKRMwbOKdOcPfOHfkhFftCF5H1sKprMKL9H4-QPZBfp5GFY5KCkvKe0

Private Key:
TjOkOKPBtSfkrfSmBJWGmHGFGRUqMWnPJGBzGizbc9s
```

也可以用 PHP 的 `web-push-php` 库在代码中动态生成，或者使用在线工具 `vapidkeys.com`。但无论哪种方式，生成后都需要妥善保存私钥。

### 2.2 在 Laravel 项目中配置

将密钥添加到 `.env` 文件中：

```env
VAPID_PUBLIC_KEY=BNxQnK9YaGPuDcHCRbOqZfR7n3GKwGhGCKRMwbOKdOcPfOHfkhFftCF5H1sKprMKL9H4-QPZBfp5GFY5KCkvKe0
VAPID_PRIVATE_KEY=TjOkOKPBtSfkrfSmBJWGmHGFGRUqMWnPJGBzGizbc9s
VAPID_SUBJECT=mailto:push@yourdomain.com
```

在 `config/services.php` 中注册配置：

```php
'vapid' => [
    'public_key'  => env('VAPID_PUBLIC_KEY'),
    'private_key' => env('VAPID_PRIVATE_KEY'),
    'subject'     => env('VAPID_SUBJECT'),
],
```

VAPID 的 subject 字段是一个 `mailto:` 邮箱地址或 HTTPS URL，用于推送服务在遇到问题时联系应用服务器的运营者。建议填写一个真实的管理员邮箱。

> **安全提醒**：VAPID 私钥必须严格保密，绝不能暴露在前端代码、Git 仓库或任何公开渠道中。建议通过环境变量、密钥管理服务（如 AWS Secrets Manager、HashiCorp Vault）或 Laravel 的加密配置来管理。如果私钥泄露，攻击者就可以冒充你的应用服务器向你的用户发送虚假推送通知。

## 三、前端：Service Worker 注册与 PushManager 订阅

### 3.1 创建 Service Worker 文件

Service Worker 是一个运行在浏览器后台的独立 JavaScript 线程，它独立于网页主线程，即使页面关闭也能继续工作。在项目根目录下创建 `sw.js` 文件：

```javascript
// sw.js - Service Worker 文件

// 监听 push 事件：接收推送消息并显示通知
self.addEventListener('push', function(event) {
    if (!event.data) {
        console.log('Push event but no data');
        return;
    }

    // 解析推送载荷（JSON 格式）
    const payload = event.data.json();
    console.log('Push received:', payload);

    // 构建通知选项
    const options = {
        body: payload.body || '您有一条新通知',
        icon: payload.icon || '/images/icons/notification-icon-192.png',
        badge: payload.badge || '/images/icons/badge-72.png',
        image: payload.image || undefined,
        vibrate: [100, 50, 100], // 振动模式（移动端）
        data: {
            url: payload.url || '/',
            orderId: payload.orderId || null,
            timestamp: Date.now()
        },
        actions: payload.actions || [
            { action: 'view', title: '查看详情', icon: '/images/icons/view.png' },
            { action: 'dismiss', title: '忽略', icon: '/images/icons/dismiss.png' }
        ],
        tag: payload.tag || 'default',
        renotify: payload.renotify || false,
        requireInteraction: payload.requireInteraction || false,
        silent: false
    };

    // 显示通知。event.waitUntil 确保 Service Worker 在通知显示前不会被终止
    event.waitUntil(
        self.registration.showNotification(payload.title || '新通知', options)
    );
});

// 监听通知点击事件：用户点击通知后的跳转逻辑
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    // 如果用户点击了"忽略"按钮
    if (event.action === 'dismiss') {
        return;
    }

    const targetUrl = event.notification.data.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function(clientList) {
                // 优先复用已打开的窗口并导航到目标页面
                for (const client of clientList) {
                    if (client.url.includes(self.registration.scope) && 'focus' in client) {
                        client.navigate(targetUrl);
                        return client.focus();
                    }
                }
                // 如果没有已打开的窗口，则打开新窗口
                return clients.openWindow(targetUrl);
            })
    );
});

// 监听通知关闭事件：可用于统计分析
self.addEventListener('notificationclose', function(event) {
    console.log('Notification closed:', event.notification.tag);
    // 可以上报关闭事件到后端做统计分析，了解用户对通知的交互行为
});
```

### 3.2 离线缓存支持

在同一个 Service Worker 中加入缓存策略，让应用在离线时也能正常工作：

```javascript
const CACHE_NAME = 'push-app-v1';
const STATIC_ASSETS = [
    '/',
    '/css/app.css',
    '/js/app.js',
    '/images/icons/notification-icon-192.png',
    '/offline.html'
];

// 安装阶段：预缓存关键静态资源
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting()) // 立即激活，不等待旧 SW 退出
    );
});

// 激活阶段：清理旧版本缓存
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim()) // 立即控制所有页面
    );
});

// 请求拦截：网络优先，缓存降级策略
self.addEventListener('fetch', function(event) {
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 网络请求成功，更新缓存
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // 网络失败，从缓存中读取
                return caches.match(event.request)
                    .then(cachedResponse => {
                        return cachedResponse || caches.match('/offline.html');
                    });
            })
    );
});
```

### 3.3 PushSubscription JSON 格式详解

当用户同意授权后，`PushManager.subscribe()` 方法会返回一个 `PushSubscription` 对象。将其序列化为 JSON 后格式如下：

```json
{
    "endpoint": "https://fcm.googleapis.com/fcm/send/cX8r7aB2dE4...",
    "expirationTime": null,
    "keys": {
        "p256dh": "BNxQnK9YaGPuDcHCRbOqZfR7n3GKwGhGCKRMwbOKdOcPfOHfkhFftCF5H1sKprMKL9H4-QPZBfp5GFY5KCkvKe0",
        "auth": "TjOkOKPBtSfkrfSmBJWGmHG"
    }
}
```

各字段的含义至关重要，开发者需要充分理解：

| 字段 | 类型 | 说明 |
|------|------|------|
| `endpoint` | string | 推送服务的端点 URL。后端将推送消息 POST 到此地址。不同浏览器使用不同的推送服务，所以 endpoint 的域名也不同 |
| `expirationTime` | number/null | 订阅的过期时间戳（毫秒），`null` 表示没有明确的过期时间。实际中推送服务可能会随时让订阅过期 |
| `keys.p256dh` | string | Base64 URL 编码的 P-256 椭圆曲线公钥。后端使用此公钥加密推送消息的载荷内容 |
| `keys.auth` | string | Base64 URL 编码的认证密钥，长度至少 16 字节。与 p256dh 公钥配合用于密钥派生 |

这三个 keys 字段是**端到端加密**的关键所在。后端使用它们将推送内容加密后再传输，确保推送服务提供商（如 Google FCM）无法读取消息的明文内容，有效保护了用户隐私和数据安全。

### 3.4 前端订阅管理器

创建一个功能完整的 `PushNotificationManager` 类，封装所有与推送订阅相关的操作：

```javascript
// js/push-manager.js

class PushNotificationManager {
    constructor(options = {}) {
        this.vapidPublicKey = options.vapidPublicKey;
        this.subscribeUrl = options.subscribeUrl || '/api/push/subscribe';
        this.unsubscribeUrl = options.unsubscribeUrl || '/api/push/unsubscribe';
        this.swPath = options.swPath || '/sw.js';
        this.registration = null;
        this.subscription = null;
    }

    // 检查浏览器是否支持 Web Push
    isSupported() {
        return 'serviceWorker' in navigator &&
               'PushManager' in window &&
               'Notification' in window;
    }

    // 获取当前通知权限状态
    getPermissionStatus() {
        if (!this.isSupported()) return 'unsupported';
        return Notification.permission; // 'granted' | 'denied' | 'default'
    }

    // 初始化：注册 Service Worker 并检查已有订阅
    async init() {
        if (!this.isSupported()) {
            console.warn('此浏览器不支持 Web Push 通知');
            return false;
        }

        try {
            this.registration = await navigator.serviceWorker.register(this.swPath, {
                scope: '/'
            });
            console.log('Service Worker 注册成功:', this.registration.scope);

            // 检查是否已有活跃的订阅
            this.subscription = await this.registration.pushManager.getSubscription();

            if (this.subscription) {
                console.log('已有推送订阅:', this.subscription.endpoint);
                await this.verifySubscription();
            }

            return true;
        } catch (error) {
            console.error('初始化失败:', error);
            return false;
        }
    }

    // 请求权限并创建订阅
    async subscribe() {
        if (!this.registration) {
            throw new Error('请先调用 init() 初始化');
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error('用户拒绝了通知权限');
        }

        // 如果已有旧订阅，先取消
        if (this.subscription) {
            await this.unsubscribe();
        }

        // 创建新的推送订阅
        const applicationServerKey = this.urlBase64ToUint8Array(this.vapidPublicKey);

        this.subscription = await this.registration.pushManager.subscribe({
            userVisibleOnly: true,  // Chrome 强制要求为 true
            applicationServerKey: applicationServerKey
        });

        // 将订阅信息发送到后端保存
        await this.sendSubscriptionToServer(this.subscription);

        console.log('推送订阅成功');
        return this.subscription;
    }

    // 取消订阅
    async unsubscribe() {
        if (!this.subscription) return;

        try {
            // 通知后端删除订阅记录
            await fetch(this.unsubscribeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: this.subscription.endpoint
                })
            });

            // 在浏览器端取消订阅
            await this.subscription.unsubscribe();
            this.subscription = null;
            console.log('已取消推送订阅');
        } catch (error) {
            console.error('取消订阅失败:', error);
            throw error;
        }
    }

    // 发送订阅信息到后端
    async sendSubscriptionToServer(subscription) {
        const subscriptionJson = subscription.toJSON();

        const response = await fetch(this.subscribeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content
            },
            body: JSON.stringify({
                endpoint: subscriptionJson.endpoint,
                keys: {
                    p256dh: subscriptionJson.keys.p256dh,
                    auth: subscriptionJson.keys.auth
                }
            })
        });

        if (!response.ok) {
            throw new Error('订阅信息保存失败');
        }

        return response.json();
    }

    // 验证后端是否仍持有此订阅
    async verifySubscription() {
        if (!this.subscription) return false;

        try {
            const response = await fetch('/api/push/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: this.subscription.endpoint })
            });
            const data = await response.json();
            return data.valid;
        } catch {
            return false;
        }
    }

    // 将 Base64 URL 编码的 VAPID 公钥转换为 Uint8Array
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
}
```

### 3.5 页面集成示例

在 HTML 页面中使用这个管理器：

```html
<!DOCTYPE html>
<html>
<head>
    <meta name="csrf-token" content="{{ csrf_token() }}">
</head>
<body>
    <button id="btn-subscribe">开启推送通知</button>
    <button id="btn-unsubscribe" style="display:none;">关闭推送通知</button>
    <div id="status"></div>

    <script src="/js/push-manager.js"></script>
    <script>
        const pushManager = new PushNotificationManager({
            vapidPublicKey: '{{ config("services.vapid.public_key") }}',
            subscribeUrl: '/api/push/subscribe',
            unsubscribeUrl: '/api/push/unsubscribe'
        });

        const btnSubscribe = document.getElementById('btn-subscribe');
        const btnUnsubscribe = document.getElementById('btn-unsubscribe');
        const statusEl = document.getElementById('status');

        async function initPush() {
            const initialized = await pushManager.init();

            if (!initialized) {
                statusEl.textContent = '您的浏览器不支持推送通知';
                btnSubscribe.disabled = true;
                return;
            }

            updateUI(pushManager.subscription);
        }

        function updateUI(subscription) {
            if (subscription) {
                btnSubscribe.style.display = 'none';
                btnUnsubscribe.style.display = 'inline-block';
                statusEl.textContent = '推送通知已开启 ✓';
            } else {
                btnSubscribe.style.display = 'inline-block';
                btnUnsubscribe.style.display = 'none';
                statusEl.textContent = '推送通知未开启';
            }
        }

        btnSubscribe.addEventListener('click', async () => {
            try {
                btnSubscribe.disabled = true;
                btnSubscribe.textContent = '订阅中...';
                await pushManager.subscribe();
                updateUI(pushManager.subscription);
            } catch (err) {
                statusEl.textContent = '订阅失败: ' + err.message;
                btnSubscribe.disabled = false;
                btnSubscribe.textContent = '开启推送通知';
            }
        });

        btnUnsubscribe.addEventListener('click', async () => {
            try {
                await pushManager.unsubscribe();
                updateUI(null);
            } catch (err) {
                statusEl.textContent = '取消失败: ' + err.message;
            }
        });

        initPush();
    </script>
</body>
</html>
```

## 四、Laravel 后端集成

### 4.1 安装依赖包

推荐使用 `laravel-notification-channels/web-push` 这个社区维护的包。它在底层的 `web-push-php` 库基础上提供了 Laravel 生态的完整集成，包括 Notification Channel、Artisan 命令、数据库迁移和配置文件。

```bash
composer require laravel-notification-channels/web-push
```

发布配置文件和数据库迁移：

```bash
php artisan vendor:publish --provider="NotificationChannels\WebPush\WebPushServiceProvider"
php artisan migrate
```

执行完成后，会创建 `push_subscriptions` 数据表和 `config/webpush.php` 配置文件。在配置文件中设置 VAPID 密钥：

```php
// config/webpush.php
return [
    'vapid' => [
        'subject' => env('VAPID_SUBJECT'),
        'public_key' => env('VAPID_PUBLIC_KEY'),
        'private_key' => env('VAPID_PRIVATE_KEY'),
    ],
];
```

### 4.2 数据库设计

迁移文件会自动创建 `push_subscriptions` 表。以下是表结构说明：

```php
<?php
// database/migrations/xxxx_create_push_subscriptions_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('push_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('endpoint')->unique();
            $table->string('public_key')->nullable();
            $table->string('auth_token')->nullable();
            $table->string('content_encoding')->default('aesgcm');
            $table->nullableTimestamps('expiration_time');
            $table->timestamps();

            // 复合索引：按用户和端点快速查询
            $table->index(['user_id', 'endpoint']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_subscriptions');
    }
};
```

一个用户可以在多个设备、多个浏览器上订阅推送，所以用户和订阅之间是一对多的关系。`endpoint` 设置了唯一约束，防止重复订阅。`content_encoding` 字段记录加密编码方式，目前主要有 `aesgcm` 和 `aes128gcm` 两种，后者是更新的标准。

### 4.3 订阅管理 API 控制器

创建一个完整的订阅管理控制器，提供订阅、取消、验证和列表等接口：

```php
<?php
// app/Http/Controllers/PushSubscriptionController.php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use NotificationChannels\WebPush\PushSubscription as WebPushSubscription;

class PushSubscriptionController extends Controller
{
    /**
     * 保存推送订阅信息
     * 前端在用户授权后将 PushSubscription JSON 发送到此接口
     */
    public function subscribe(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'endpoint'    => 'required|url',
            'keys.p256dh' => 'required|string',
            'keys.auth'   => 'required|string',
        ]);

        $user = $request->user();

        // 使用 updateOrCreate 避免重复订阅
        $subscription = WebPushSubscription::updateOrCreate(
            ['endpoint' => $validated['endpoint']],
            [
                'user_id'          => $user?->id,
                'public_key'       => $validated['keys']['p256dh'],
                'auth_token'       => $validated['keys']['auth'],
                'content_encoding' => 'aesgcm',
            ]
        );

        return response()->json([
            'success'      => true,
            'message'      => '订阅成功',
            'subscription' => $subscription,
        ]);
    }

    /**
     * 取消推送订阅
     */
    public function unsubscribe(Request $request): JsonResponse
    {
        $request->validate(['endpoint' => 'required|url']);

        $deleted = WebPushSubscription::where('endpoint', $request->input('endpoint'))->delete();

        return response()->json([
            'success' => (bool) $deleted,
            'message' => $deleted ? '已取消订阅' : '订阅不存在',
        ]);
    }

    /**
     * 验证订阅是否仍然有效
     */
    public function verify(Request $request): JsonResponse
    {
        $request->validate(['endpoint' => 'required|url']);

        $exists = WebPushSubscription::where('endpoint', $request->input('endpoint'))
            ->where(function ($query) {
                $query->whereNull('expiration_time')
                    ->orWhere('expiration_time', '>', now());
            })
            ->exists();

        return response()->json(['valid' => $exists]);
    }

    /**
     * 获取当前用户的所有订阅设备列表
     */
    public function index(Request $request): JsonResponse
    {
        $subscriptions = WebPushSubscription::where('user_id', $request->user()->id)
            ->get()
            ->map(fn($sub) => [
                'id'         => $sub->id,
                'endpoint'   => $sub->endpoint,
                'created_at' => $sub->created_at->toIso8601String(),
                'browser'    => $this->detectBrowser($sub->endpoint),
            ]);

        return response()->json(['subscriptions' => $subscriptions]);
    }

    /**
     * 删除指定的订阅记录
     */
    public function destroy(int $id, Request $request): JsonResponse
    {
        $deleted = WebPushSubscription::where('id', $id)
            ->where('user_id', $request->user()->id)
            ->delete();

        return response()->json(['success' => (bool) $deleted]);
    }

    /**
     * 根据 endpoint 域名推断浏览器类型
     */
    private function detectBrowser(string $endpoint): string
    {
        if (str_contains($endpoint, 'fcm.googleapis.com')) return 'Chrome';
        if (str_contains($endpoint, 'mozilla.org')) return 'Firefox';
        if (str_contains($endpoint, 'wns.windows.com')) return 'Edge';
        if (str_contains($endpoint, 'web.push.apple')) return 'Safari';
        return 'Unknown';
    }
}
```

### 4.4 路由注册

```php
<?php
// routes/api.php

use App\Http\Controllers\PushSubscriptionController;

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/push/subscribe', [PushSubscriptionController::class, 'subscribe']);
    Route::post('/push/unsubscribe', [PushSubscriptionController::class, 'unsubscribe']);
    Route::post('/push/verify', [PushSubscriptionController::class, 'verify']);
    Route::get('/push/subscriptions', [PushSubscriptionController::class, 'index']);
    Route::delete('/push/subscriptions/{id}', [PushSubscriptionController::class, 'destroy']);
});
```

### 4.5 创建推送通知类

利用 Laravel 的 Notification 系统，创建一个通用的推送通知类：

```php
<?php
// app/Notifications/PushNotification.php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;
use NotificationChannels\WebPush\WebPushChannel;
use NotificationChannels\WebPush\WebPushMessage;

class PushNotification extends Notification
{
    use Queueable;

    public function __construct(
        private string $title,
        private string $body,
        private string $url = '/',
        private ?string $icon = null,
        private ?string $image = null,
        private array $actions = [],
        private string $tag = 'default',
        private bool $requireInteraction = false,
    ) {}

    /**
     * 指定通知渠道为 WebPush
     */
    public function via($notifiable): array
    {
        return [WebPushChannel::class];
    }

    /**
     * 构建 WebPush 消息内容
     */
    public function toWebPush($notifiable, $notification): WebPushMessage
    {
        $message = (new WebPushMessage())
            ->title($this->title)
            ->body($this->body)
            ->icon($this->icon ?? '/images/icons/notification-icon-192.png')
            ->badge('/images/icons/badge-72.png')
            ->dir('ltr')
            ->image($this->image)
            ->tag($this->tag)
            ->renotify(true)
            ->requireInteraction($this->requireInteraction)
            ->data(['url' => $this->url]);

        // 添加操作按钮
        foreach ($this->actions as $action) {
            $message->action($action['action'], $action['title']);
        }

        return $message;
    }
}
```

### 4.6 事件驱动的推送分发

在实际业务中，推送通常是由事件驱动的。以订单状态变更为例：

```php
<?php
// app/Events/OrderStatusUpdated.php

namespace App\Events;

use App\Models\Order;
use Illuminate\Foundation\Events\Dispatchable;

class OrderStatusUpdated
{
    use Dispatchable;

    public function __construct(
        public Order $order,
        public string $oldStatus,
        public string $newStatus
    ) {}
}
```

```php
<?php
// app/Listeners/SendOrderStatusPushNotification.php

namespace App\Listeners;

use App\Events\OrderStatusUpdated;
use App\Notifications\PushNotification;

class SendOrderStatusPushNotification
{
    public function handle(OrderStatusUpdated $event): void
    {
        $order = $event->order;
        $user = $order->user;

        // 根据订单状态构建不同的通知内容
        $statusMap = [
            'paid'      => ['✅ 支付成功', "您的订单 #{$order->order_no} 已支付成功，等待发货"],
            'shipped'   => ['🚚 已发货', "您的订单 #{$order->order_no} 已发货，快递单号：{$order->tracking_no}"],
            'delivered'  => ['📦 已送达', "您的订单 #{$order->order_no} 已送达，请确认收货"],
            'completed' => ['🎉 已完成', "您的订单 #{$order->order_no} 已完成，感谢您的购买"],
        ];

        [$title, $body] = $statusMap[$event->newStatus]
            ?? ['订单更新', "订单状态已更新为 {$event->newStatus}"];

        // 通过 Laravel Notification 系统发送推送到用户的所有订阅设备
        $user->notify(new PushNotification(
            title: $title,
            body: $body,
            url: "/orders/{$order->id}",
            tag: "order-{$order->id}",
            requireInteraction: true,
            actions: [
                ['action' => 'view', 'title' => '查看详情'],
            ]
        ));
    }
}
```

在 EventServiceProvider 中注册监听器：

```php
protected $listen = [
    \App\Events\OrderStatusUpdated::class => [
        \App\Listeners\SendOrderStatusPushNotification::class,
    ],
];
```

在业务代码中触发事件：

```php
// 订单状态变更时触发
event(new OrderStatusUpdated($order, 'pending', 'paid'));
```

## 五、载荷加密机制

Web Push 的一个重要安全特性是**端到端加密**。推送消息从你的应用服务器发出后，会经过第三方推送服务（如 Google FCM、Apple APNs），如果消息是明文的，这些中间服务商就有可能读取内容。端到端加密确保只有用户的浏览器才能解密消息，中间任何环节都无法窥探。

加密过程遵循 RFC 8291（aesgcm 编码）或 RFC 8188（aes128gcm 编码）标准。具体步骤如下：

1. 后端获取用户订阅时提供的 `p256dh` 公钥和 `auth` 认证密钥
2. 使用 ECDH（椭圆曲线迪菲-赫尔曼）密钥交换协议，在服务端临时密钥对和用户公钥之间派生出共享密钥
3. 使用 HKDF（基于 HMAC 的密钥派生函数）从共享密钥和 auth 密钥派生出加密密钥和随机数
4. 使用 AES-GCM 算法加密消息载荷
5. 将加密后的数据随推送请求发送至推送服务端点
6. 用户浏览器的 Service Worker 接收后，使用本地存储的私钥进行解密

`laravel-notification-channels/web-push` 库已经内置了完整的加密支持，开发者无需手动处理任何加密细节：

```php
// 发送带加密载荷的通知（加密过程完全透明）
$user->notify(new PushNotification(
    title: '限时特惠',
    body: 'iPhone 15 Pro 限时直降 2000 元，仅剩 2 小时！',
    url: '/products/iphone-15-pro',
    image: '/images/promo/iphone15-banner.jpg',
    tag: 'promotion-flash',
    requireInteraction: true,
));
```

如果需要更底层的控制，可以直接使用 `web-push-php` 库：

```php
use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

$auth = [
    'VAPID' => [
        'subject'     => config('services.vapid.subject'),
        'publicKey'    => config('services.vapid.public_key'),
        'privateKey'   => config('services.vapid.private_key'),
    ],
];

$webPush = new WebPush($auth);

$subscription = Subscription::create([
    'endpoint' => 'https://fcm.googleapis.com/fcm/send/...',
    'publicKey' => 'BNxQn...',
    'authToken' => 'TjOkO...',
    'contentEncoding' => 'aesgcm',
]);

$payload = json_encode([
    'title' => '价格变动提醒',
    'body'  => '您关注的 AirPods Pro 降价至 ¥1399',
    'url'   => '/products/airpods-pro',
    'icon'  => '/images/icons/price-drop.png',
]);

$report = $webPush->sendOneNotification($subscription, $payload);

if ($report->isSuccess()) {
    Log::info('推送发送成功');
} else {
    Log::error('推送发送失败', [
        'endpoint' => $subscription->getEndpoint(),
        'reason'   => $report->getReason(),
    ]);

    // HTTP 410 Gone 表示订阅已失效，应清理数据库记录
    if ($report->getResponse()->getStatusCode() === 410) {
        PushSubscription::where('endpoint', $subscription->getEndpoint())->delete();
    }
}
```

## 六、批量推送与队列优化

在电商场景中，一次促销活动可能需要同时推送给数十万用户。如果在主线程中同步发送，不仅会导致请求超时，还可能因为推送服务的速率限制而失败。正确的做法是将推送任务放入队列中异步处理。

```php
<?php
// app/Jobs/SendBatchPushNotification.php

namespace App\Jobs;

use App\Models\PushSubscription;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

class SendBatchPushNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(
        private array $userIds,
        private string $title,
        private string $body,
        private string $url = '/',
        private string $tag = 'broadcast',
    ) {}

    public function handle(): void
    {
        $webPush = new WebPush([
            'VAPID' => [
                'subject'     => config('services.vapid.subject'),
                'publicKey'    => config('services.vapid.public_key'),
                'privateKey'   => config('services.vapid.private_key'),
            ],
        ]);

        $subscriptions = PushSubscription::whereIn('user_id', $this->userIds)
            ->get()
            ->map(fn($sub) => Subscription::create([
                'endpoint'        => $sub->endpoint,
                'publicKey'       => $sub->public_key,
                'authToken'       => $sub->auth_token,
                'contentEncoding' => $sub->content_encoding ?? 'aesgcm',
            ]));

        $payload = json_encode([
            'title' => $this->title,
            'body'  => $this->body,
            'url'   => $this->url,
            'tag'   => $this->tag,
            'icon'  => '/images/icons/promo-icon.png',
        ]);

        foreach ($subscriptions as $subscription) {
            $webPush->sendOneNotification($subscription, $payload);
        }

        // 处理发送结果，清理失效订阅
        foreach ($webPush->flush() as $report) {
            if (!$report->isSuccess()
                && $report->getResponse()
                && $report->getResponse()->getStatusCode() === 410) {
                PushSubscription::where('endpoint', $report->getRequest()->getUri()->__toString())
                    ->delete();
            }
        }
    }
}
```

在业务代码中分批调度：

```php
// 向所有已开启推送的用户发送促销通知
$userIds = User::where('push_enabled', true)->pluck('id')->toArray();

// 每批 1000 个用户，错开 5 秒避免瞬时压力
foreach (array_chunk($userIds, 1000) as $index => $batch) {
    SendBatchPushNotification::dispatch(
        userIds: $batch,
        title: '🎉 618 大促开启',
        body: '全场商品低至 3 折，更有满减优惠等你来抢！',
        url: '/promotions/618',
        tag: 'promo-618'
    )->onQueue('push-notifications')->delay(now()->addSeconds($index * 5));
}
```

## 七、浏览器兼容性分析

在实施 Web Push 方案之前，了解各浏览器的支持情况至关重要：

| 浏览器 | 最低版本 | 推送服务端点 | 备注 |
|--------|---------|-------------|------|
| Chrome | 42+ | Google FCM | 完整支持，包括载荷加密和通知操作按钮 |
| Firefox | 44+ | Mozilla Push Service | 完整支持，最早实现 VAPID 的浏览器之一 |
| Edge | 17+ | Windows Push Notification Services | 基于 Chromium 的新版 Edge 同 Chrome |
| Safari | 16.4+ | Apple Push Notification | macOS Ventura 及以上系统，需 HTTPS |
| Opera | 37+ | 复用 Google FCM | 同 Chrome |
| Samsung Internet | 4+ | 复用 Google FCM | 同 Chrome |

一个特别需要关注的点是 **iOS Safari**。从 iOS 16.4 开始，Apple 正式支持 Web Push API，但有一个重要限制：**仅限通过"添加到主屏幕"方式安装的 PWA 应用**。这意味着你需要将网站配置为 PWA，引导 iOS 用户将网站添加到主屏幕，才能在 iPhone 和 iPad 上使用推送功能。

兼容性检测代码：

```javascript
function checkPushSupport() {
    const support = {
        serviceWorker: 'serviceWorker' in navigator,
        pushManager: 'PushManager' in window,
        notification: 'Notification' in window,
    };

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const iosVersion = parseInt(navigator.userAgent.match(/OS (\d+)_/)?.[1] || '0');
    const isIOSSupported = isIOS && iosVersion >= 16;

    return {
        ...support,
        isIOS,
        isIOSSupported,
        fullSupport: Object.values(support).every(Boolean) && (!isIOS || isIOSSupported),
    };
}
```

## 八、HTTPS 要求与生产部署

Web Push API 有严格的安全上下文要求：

**第一，HTTPS 是强制性的**。Service Worker 和 Push API 仅在安全上下文（Secure Context）下可用。`localhost` 是唯一的例外，仅供本地开发使用。如果你的网站还在使用 HTTP，必须先完成 HTTPS 迁移。

**第二，Service Worker 的 Scope 受限**。Service Worker 的控制范围不能超过其所在路径。如果 SW 文件放在 `/assets/sw.js`，默认只能控制 `/assets/` 路径下的页面。通过设置 `Service-Worker-Allowed` 响应头可以放宽此限制。

**第三，正确的缓存策略**。Service Worker 文件本身不应被浏览器长时间缓存，否则更新后用户无法及时获取最新版本。

以下是 Nginx 的推荐配置：

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/ssl/certs/yourdomain.com.pem;
    ssl_certificate_key /etc/ssl/private/yourdomain.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    root /var/www/your-app/public;
    index index.php;

    # Service Worker：禁止缓存，确保始终获取最新版本
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Service-Worker-Allowed "/";
        try_files $uri =404;
    }

    # PWA Manifest 文件
    location = /manifest.json {
        add_header Cache-Control "max-age=86400";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

队列 Worker 建议使用 Supervisor 管理，确保进程崩溃后自动重启：

```ini
; /etc/supervisor/conf.d/push-worker.conf
[program:push-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/your-app/artisan queue:work redis --queue=push-notifications --tries=3 --timeout=120
autostart=true
autorestart=true
numprocs=4
user=www-data
redirect_stderr=true
stdout_logfile=/var/www/your-app/storage/logs/push-worker.log
```

## 九、与 Firebase Cloud Messaging 的对比

很多开发者会问：已经有了 Firebase Cloud Messaging（FCM），为什么还要学习 Web Push API？两者之间的关系和区别如下：

| 对比维度 | Web Push API + VAPID | Firebase Cloud Messaging |
|---------|---------------------|--------------------------|
| 标准化 | W3C 开放标准，跨浏览器统一 | Google 专有服务 |
| SDK 依赖 | 无需引入任何第三方 SDK | 需引入 firebase-messaging SDK（约 100KB） |
| 隐私控制 | VAPID 密钥自管，不经过任何第三方账号体系 | 需要 Google 项目配置，数据经过 Google |
| 载荷加密 | 端到端加密，推送服务无法读取内容 | 消息在 Google 服务端可读取 |
| 跨平台 | 所有主流浏览器原生支持 | Chrome/Edge 的 Web Push 底层走 FCM 端点 |
| 复杂度 | 直接使用标准 API，仅需 HTTP 请求 | 需配置 Firebase 项目、下载配置文件、初始化 SDK |
| 成本 | 完全免费，无任何限制 | 有免费额度，大量使用需付费 |
| 消息大小 | 约 4KB（加密后） | 下行约 4KB，上游消息无限制 |

**核心结论**：如果你的项目只需要 Web 端推送通知，且注重隐私保护和无外部依赖，Web Push API + VAPID 是最佳选择。如果你的项目已经深度使用 Firebase 生态（包括 Analytics、Crashlytics、Authentication 等），FCM 可以无缝集成。实际上两者并不矛盾——Chrome 的 Web Push 底层就是通过 FCM 端点来传输消息的，VAPID 只是在此之上增加了一层应用级别的身份验证和加密。

## 十、B2C 电商实战场景

### 10.1 订单状态实时推送

电商用户最关心的就是订单物流信息。传统的做法是用户主动刷新页面查看，或者发送短信通知（成本高）。Web Push 可以零成本实现实时推送：

```php
<?php
// app/Services/OrderNotificationService.php

namespace App\Services;

use App\Models\Order;
use App\Notifications\PushNotification;

class OrderNotificationService
{
    public function notifyStatusChange(Order $order, string $newStatus): void
    {
        $notifications = [
            'paid' => new PushNotification(
                title: '✅ 支付成功',
                body: "订单 #{$order->order_no} 已支付 ¥{$order->total_amount}，我们将尽快为您发货",
                url: "/orders/{$order->id}",
                tag: "order-{$order->id}",
                requireInteraction: true,
            ),
            'shipped' => new PushNotification(
                title: '🚚 包裹已发出',
                body: "订单 #{$order->order_no} 已发货，{$order->carrier} 快递单号 {$order->tracking_no}",
                url: "/orders/{$order->id}/tracking",
                tag: "order-{$order->id}",
                image: '/images/icons/shipping-truck.png',
                actions: [
                    ['action' => 'track', 'title' => '查看物流'],
                ],
            ),
            'delivered' => new PushNotification(
                title: '📦 包裹已送达',
                body: "订单 #{$order->order_no} 已送达，请及时确认收货",
                url: "/orders/{$order->id}",
                tag: "order-{$order->id}",
                requireInteraction: true,
                actions: [
                    ['action' => 'confirm', 'title' => '确认收货'],
                    ['action' => 'review', 'title' => '去评价'],
                ],
            ),
        ];

        $notification = $notifications[$newStatus] ?? null;

        if ($notification) {
            $order->user->notify($notification);
        }
    }
}
```

### 10.2 促销活动精准推送

大型促销活动需要向目标用户群发送通知。通过用户标签系统实现精准推送，避免打扰非目标用户：

```php
<?php
// app/Services/PromotionNotificationService.php

namespace App\Services;

use App\Models\User;
use App\Jobs\SendBatchPushNotification;
use App\Models\Promotion;

class PromotionNotificationService
{
    /**
     * 向目标用户群发送促销通知
     */
    public function broadcastPromotion(Promotion $promotion): void
    {
        // 根据活动的目标用户标签筛选接收者
        $targetUsers = User::where('push_enabled', true)
            ->whereHas('tags', fn($q) => $q->whereIn('tag_id', $promotion->target_tag_ids))
            ->pluck('id')
            ->toArray();

        // 每批 1000 个用户，错开发送时间避免瞬时压力
        $chunks = array_chunk($targetUsers, 1000);

        foreach ($chunks as $index => $batch) {
            SendBatchPushNotification::dispatch(
                userIds: $batch,
                title: $promotion->push_title,
                body: $promotion->push_body,
                url: "/promotions/{$promotion->slug}",
                tag: "promo-{$promotion->id}",
            )->onQueue('push-notifications')->delay(now()->addSeconds($index * 5));
        }
    }
}
```

### 10.3 商品降价提醒

用户收藏或关注的商品降价时，自动推送提醒，这是提升转化率的利器：

```php
<?php
// app/Listeners/PriceDropListener.php

namespace App\Listeners;

use App\Events\ProductPriceChanged;
use App\Notifications\PushNotification;

class PriceDropListener
{
    public function handle(ProductPriceChanged $event): void
    {
        $product = $event->product;
        $oldPrice = $event->oldPrice;
        $newPrice = $event->newPrice;

        // 只在降价时推送
        if ($newPrice >= $oldPrice) return;

        $discount = round(($oldPrice - $newPrice) / $oldPrice * 100);

        // 获取关注此商品且开启了推送的用户
        $watchers = $product->watchers()
            ->where('push_enabled', true)
            ->get();

        foreach ($watchers as $user) {
            $user->notify(new PushNotification(
                title: '💰 降价提醒',
                body: "{$product->name} 降价了！原价 ¥{$oldPrice} → 现价 ¥{$newPrice}（立省 {$discount}%）",
                url: "/products/{$product->slug}?ref=price-alert",
                tag: "price-{$product->id}",
                image: $product->thumbnail,
                requireInteraction: true,
                actions: [
                    ['action' => 'buy', 'title' => '立即购买'],
                    ['action' => 'view', 'title' => '查看详情'],
                ],
            ));
        }
    }
}
```

## 十一、订阅管理前端 UI

为用户提供完整的推送设置页面，包括权限状态、通知偏好和已订阅设备管理：

```php
<?php
// resources/views/settings/push-notifications.blade.php
?>
@extends('layouts.app')

@section('content')
<div class="max-w-2xl mx-auto py-8 px-4">
    <h1 class="text-2xl font-bold mb-6">推送通知设置</h1>

    <!-- 权限状态卡片 -->
    <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">通知权限</h2>
        <div id="push-status" class="flex items-center gap-3 mb-4">
            <span id="status-indicator" class="w-3 h-3 rounded-full bg-gray-400"></span>
            <span id="status-text">检测中...</span>
        </div>
        <button id="btn-toggle-push"
                class="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
            开启推送通知
        </button>
    </div>

    <!-- 通知偏好设置 -->
    <div class="bg-white rounded-lg shadow p-6 mb-6" id="preferences-section" style="display:none;">
        <h2 class="text-lg font-semibold mb-4">通知偏好</h2>
        @foreach([
            'order_status' => '订单状态更新',
            'price_alerts' => '降价提醒',
            'promotions'   => '促销活动',
            'new_arrivals'  => '新品上架',
        ] as $key => $label)
        <label class="flex items-center justify-between py-3 border-b last:border-0">
            <span>{{ $label }}</span>
            <input type="checkbox" class="toggle" data-pref="{{ $key }}"
                   {{ auth()->user()->getPushPreference($key) ? 'checked' : '' }}>
        </label>
        @endforeach
    </div>

    <!-- 已订阅设备列表 -->
    <div class="bg-white rounded-lg shadow p-6" id="devices-section" style="display:none;">
        <h2 class="text-lg font-semibold mb-4">已订阅设备</h2>
        <div id="devices-list">加载中...</div>
    </div>
</div>

<script src="/js/push-manager.js"></script>
<script>
    const pushManager = new PushNotificationManager({
        vapidPublicKey: '{{ config("services.vapid.public_key") }}',
    });

    const btnToggle = document.getElementById('btn-toggle-push');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    async function updateStatus() {
        await pushManager.init();
        const permission = pushManager.getPermissionStatus();

        if (permission === 'granted' && pushManager.subscription) {
            statusIndicator.className = 'w-3 h-3 rounded-full bg-green-500';
            statusText.textContent = '推送通知已开启';
            btnToggle.textContent = '关闭推送通知';
            document.getElementById('preferences-section').style.display = '';
            document.getElementById('devices-section').style.display = '';
            loadDevices();
        } else if (permission === 'denied') {
            statusIndicator.className = 'w-3 h-3 rounded-full bg-red-500';
            statusText.textContent = '通知权限已被禁止，请在浏览器设置中手动允许';
            btnToggle.disabled = true;
        } else {
            statusIndicator.className = 'w-3 h-3 rounded-full bg-gray-400';
            statusText.textContent = '推送通知未开启';
            btnToggle.textContent = '开启推送通知';
        }
    }

    btnToggle.addEventListener('click', async () => {
        if (pushManager.subscription) {
            await pushManager.unsubscribe();
        } else {
            await pushManager.subscribe();
        }
        updateStatus();
    });

    async function loadDevices() {
        const response = await fetch('/api/push/subscriptions');
        const data = await response.json();
        const container = document.getElementById('devices-list');

        container.innerHTML = data.subscriptions.map(sub => `
            <div class="flex items-center justify-between py-3 border-b" data-id="${sub.id}">
                <div>
                    <span class="font-medium">${sub.browser}</span>
                    <span class="text-sm text-gray-500 ml-2">
                        订阅于 ${new Date(sub.created_at).toLocaleDateString('zh-CN')}
                    </span>
                </div>
                <button onclick="removeDevice(${sub.id})"
                        class="text-red-500 hover:text-red-700 text-sm">移除</button>
            </div>
        `).join('') || '<p class="text-gray-500">暂无已订阅设备</p>';
    }

    async function removeDevice(id) {
        if (!confirm('确定要移除此设备的推送订阅吗？')) return;
        await fetch(`/api/push/subscriptions/${id}`, { method: 'DELETE' });
        loadDevices();
    }

    // 通知偏好变更
    document.querySelectorAll('.toggle[data-pref]').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            await fetch('/api/push/preferences', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': '{{ csrf_token() }}'
                },
                body: JSON.stringify({
                    key: e.target.dataset.pref,
                    enabled: e.target.checked
                }),
            });
        });
    });

    updateStatus();
</script>
@endsection
```

## 十二、最佳实践与常见问题排查

在生产环境中部署 Web Push 推送系统，以下几点需要特别注意：

**订阅失效的自动清理**。当推送服务返回 HTTP 410 状态码时，表示该订阅已经失效——可能是用户清除了浏览器数据、取消了通知授权，或者设备长时间未上线。必须及时从数据库中删除对应的订阅记录，否则后续的推送请求会持续失败，浪费服务器资源。

**推送频率控制**。不要滥用推送通知功能。过于频繁的推送会导致用户反感，甚至直接关闭通知权限或卸载应用。建议设置每用户每日推送上限，通常 3 到 5 条为宜。不同类型的通知应有不同的频率限制：订单状态推送不受限制（用户期望收到），促销推送每日最多 1 到 2 条。

**个性化和用户偏好**。让用户自己选择接收哪些类型的通知。有些用户只关心订单状态，不想收到促销信息；有些用户对降价提醒很感兴趣。提供细粒度的偏好设置，可以显著提升推送的接受度和转化率。

**时区感知**。发送促销通知时必须考虑用户的时区。凌晨两点推送促销信息不仅不会带来转化，还会导致大量用户关闭通知权限。建议将推送限制在用户的活跃时段内。

**监控与告警**。记录推送的成功率、失败原因、用户订阅变化趋势等关键指标。当推送成功率突然下降时，可能是推送服务出现了问题；当大量订阅集中失效时，可能是证书过期或配置错误。及时的监控告警可以帮助你快速定位和解决问题。

以下是常见问题的排查指南：

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 订阅成功但收不到推送 | Service Worker 未完全激活 | 检查 SW 生命周期状态，确认已进入 activated 阶段 |
| 推送到达但不显示通知 | 用户在操作系统层面关闭了通知 | 引导用户检查系统通知设置，提供操作指引 |
| Chrome 要求 `userVisibleOnly` 为 true | Chrome 强制要求每个 push 事件都必须展示通知 | 保持默认值 true，不要在后台静默处理 |
| Safari 推送不生效 | iOS 需要 16.4+ 且仅限 PWA 应用 | 配置 manifest.json，引导用户"添加到主屏幕" |
| 推送载荷解密失败 | contentEncoding 不匹配 | 确保 p256dh 和 auth 密钥与订阅时一致 |
| 订阅后端口返回 500 | VAPID 私钥格式错误或缺失 | 检查 .env 配置，确认 Base64 编码正确 |

## 总结

Web Push API 结合 VAPID 协议，为 Web 应用带来了真正原生级别的推送通知能力。它无需依赖第三方 SDK、支持端到端加密、遵循 W3C 开放标准，是 B2C 电商平台、内容资讯网站、SaaS 产品的理想推送方案。

结合 Laravel 的 Notification 系统和队列能力，整个推送体系的搭建并不复杂。核心流程可以概括为五个步骤：**生成 VAPID 密钥对** → **前端注册 Service Worker 并通过 PushManager 创建订阅** → **后端存储 PushSubscription 信息** → **通过 Web Push Protocol 发送 VAPID 签名的加密载荷** → **Service Worker 接收 push 事件并调用 Notification API 展示通知**。

随着 Safari 16.4+ 对 Web Push 的支持以及 iOS PWA 生态的逐步完善，Web Push 已经能够覆盖全球超过 90% 的浏览器用户。在用户体验日益重要的今天，为你的 Web 应用添加推送通知功能，不再是可选项，而是必选项。现在就是最佳的落地时机。

## 相关阅读

- [Laravel + Firebase Cloud Messaging Web Push Service Worker 推送通知实战](/categories/PHP/Laravel-Firebase-Cloud-Messaging-Web-Push-Service-Worker-推送通知实战/)
- [uni-app 推送通知实战：极光推送/个推/UniPush 集成与厂商通道适配](/categories/前端/uni-app-推送通知实战：极光推送-个推-UniPush-集成与厂商通道适配/)
- [Long Polling vs SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案量化对比](/categories/架构/Long-Polling-vs-SSE-vs-WebSocket-vs-HTTP-Streaming-实战-实时通信方案对比/)
