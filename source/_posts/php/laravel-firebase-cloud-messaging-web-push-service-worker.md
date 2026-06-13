---
title: Laravel-Firebase-Cloud-Messaging-Web-Push-Service-Worker-推送通知实战
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 01:31:05
updated: 2026-05-05 01:37:02
categories:
  - php
tags: [KKday, Laravel, 前端]
keywords: [Laravel, Firebase, Cloud, Messaging, Web, Push, Service, Worker, 推送通知实战, PHP]
description: 在 KKday B2C 旅行平台落地 FCM Web Push 的完整方案：从 Firebase 项目配置、Service Worker 注册、Laravel 后端 topic 订阅与消息发送，到静默推送失效、Token 轮换、多端去重等真实踩坑记录。



---

> 一句话总结：**Web Push 不是「注册 Service Worker + 调 sendNotification」就完事**——FCM Token 生命周期管理、Topic 订阅一致性、静默推送限制、多端去重每一步都有坑。本文是我在 KKday B2C 旅行平台落地 FCM Web Push 的完整复盘。

## 1. 为什么选择 Firebase Cloud Messaging？

在 KKday B2C 场景中，推送通知的需求非常明确：

- **订单状态变更**：用户下单成功、出票确认、行程变更提醒
- **营销推送**：限时优惠、目的地降价通知
- **Web 端实时通知**：用户在浏览器中收到 Booking Update

我们评估了三种方案：

```
┌──────────────────────────────────────────────────────────────────┐
│                    推送方案选型对比                                │
├──────────────────┬───────────┬───────────┬───────────────────────┤
│                  │ Web Push  │ FCM       │ 自建 WebSocket        │
│                  │ (原生API) │ (Web Push)│ (Laravel Reverb)      │
├──────────────────┼───────────┼───────────┼───────────────────────┤
│ 浏览器关闭后推送  │ ✅ 支持   │ ✅ 支持   │ ❌ 断线即失            │
│ 多端统一管理      │ ❌ 各端独立│ ✅ Topic  │ ❌ 需自行实现          │
│ 后端集成复杂度    │ 中        │ 低(官方SDK)│ 高(需维护连接)        │
│ 免费额度          │ 无限制    │ 无限制    │ 取决于基础设施          │
│ Token 管理        │ 自行维护  │ FCM 托管  │ 无需 Token            │
└──────────────────┴───────────┴───────────┴───────────────────────┘
```

最终选择 **FCM** 的核心原因：浏览器关闭后仍能推送（依赖浏览器 Push Service）、Topic 机制天然支持按业务分组、与现有 Laravel 后端集成成本最低。

## 2. 架构全景

```
┌──────────────┐    HTTPS     ┌──────────────────┐
│   前端 SPA    │ ──────────► │  Laravel BFF API  │
│  (Vue/React) │             │  /api/push/       │
│              │  subscribe  │  subscribe         │
│              │  topic      │  send              │
└──────┬───────┘             └────────┬───────────┘
       │                              │
       │ 1.注册 SW                    │ 4.Admin SDK
       │ 2.获取 Token                 │   sendToTopic()
       │ 3.POST Token                 │
       ▼                              ▼
┌──────────────┐             ┌──────────────────┐
│ Service Worker│             │  Firebase Admin   │
│ (firebase-    │  ◄─push──── │  SDK (Server)     │
│  messaging.js)│             │                   │
└──────┬───────┘             └────────┬───────────┘
       │                              │
       │ 5.显示 Notification           │
       ▼                              ▼
┌──────────────┐             ┌──────────────────┐
│  浏览器通知    │             │  FCM Backend      │
│  (系统级)     │             │  (Google 基础设施)  │
└──────────────┘             └──────────────────┘
```

## 3. Firebase 项目配置

### 3.1 创建 Firebase 项目并启用 Cloud Messaging

```bash
# 安装 Firebase CLI
npm install -g firebase-tools

# 登录并初始化
firebase login
firebase init
```

在 Firebase Console → Project Settings → Cloud Messaging 中获取 **VAPID Key**（Web Push 证书密钥对），这是前端注册 Service Worker 时必需的。

### 3.2 生成 Service Account Key

```bash
# Firebase Console → Project Settings → Service Accounts
# 点击 "Generate new private key" 下载 JSON 文件
# 存放到 Laravel 项目 config 目录（切勿提交到 Git！）
cp ~/Downloads/your-project-firebase-adminsdk.json \
   config/credentials/firebase-service-account.json
```

## 4. Laravel 后端实现

### 4.1 安装依赖

```bash
composer require kreait/firebase-php:^7.0
```

### 4.2 Firebase Service Provider

```php
<?php
// app/Providers/FirebaseServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Kreait\Firebase\Factory;
use Kreait\Firebase\Messaging;

class FirebaseServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Messaging::class, function () {
            $credentialsPath = config('firebase.credentials_path');

            if (!file_exists($credentialsPath)) {
                throw new \RuntimeException(
                    "Firebase service account not found: {$credentialsPath}"
                );
            }

            return (new Factory)
                ->withServiceAccount($credentialsPath)
                ->withProjectId(config('firebase.project_id'))
                ->createMessaging();
        });
    }
}
```

配置文件：

```php
<?php
// config/firebase.php

return [
    'credentials_path' => env(
        'FIREBASE_CREDENTIALS_PATH',
        storage_path('app/firebase-service-account.json')
    ),
    'project_id' => env('FIREBASE_PROJECT_ID', ''),
];
```

### 4.3 Token 注册与 Topic 订阅

```php
<?php
// app/Http/Controllers/Api/PushController.php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Kreait\Firebase\Messaging;
use Illuminate\Support\Facades\Cache;

class PushController extends Controller
{
    public function subscribe(Request $request, Messaging $messaging)
    {
        $validated = $request->validate([
            'token' => 'required|string',
            'topic' => 'required|string|in:order_update,marketing,system',
            'device_type' => 'required|string|in:web,android,ios',
            'user_agent' => 'nullable|string',
        ]);

        // 踩坑点 #1: 订阅前先验证 Token 有效性
        // FCM 静默失效的 Token 不会报错，但消息永远送不到
        try {
            // 用 dryRun 验证 Token 格式是否有效（不会真正发送）
            $messaging->send(
                new \Kreait\Firebase\Messaging\CloudMessage::withTarget(
                    'token', $validated['token']
                )->withData(['test' => 'ping']),
                $validated['token'],
                false, // validateOnly = false
                true   // dryRun = true
            );
        } catch (\Kreait\Firebase\Exception\Messaging\NotFound $e) {
            return response()->json([
                'error' => 'Invalid or unregistered FCM token'
            ], 422);
        }

        // 踩坑点 #2: Topic 名称只能包含 [a-zA-Z0-9-_.~%]
        // 不能包含中文、空格、特殊字符
        $topic = "kkday_{$validated['topic']}";

        $messaging->subscribeToTopic($topic, $validated['token']);

        // 记录 Token 与用户映射（用于后续去重）
        $userId = $request->user()?->id;
        if ($userId) {
            $this->recordTokenMapping($userId, $validated['token'], $validated);
        }

        return response()->json([
            'success' => true,
            'topic' => $topic,
            'message' => "Subscribed to {$topic} successfully"
        ]);
    }

    private function recordTokenMapping(int $userId, string $token, array $meta): void
    {
        $key = "fcm_tokens:user:{$userId}";
        $tokens = Cache::get($key, []);

        $tokens[$token] = [
            'device_type' => $meta['device_type'],
            'user_agent' => $meta['user_agent'] ?? null,
            'subscribed_at' => now()->toISOString(),
        ];

        // 30 天过期，定期清理
        Cache::put($key, $tokens, now()->addDays(30));
    }
}
```

### 4.4 推送消息发送服务

```php
<?php
// app/Services/PushNotificationService.php

namespace App\Services;

use Kreait\Firebase\Messaging;
use Kreait\Firebase\Messaging\CloudMessage;
use Kreait\Firebase\Messaging\Notification;
use Illuminate\Support\Facades\Log;

class PushNotificationService
{
    public function __construct(
        private readonly Messaging $messaging
    ) {}

    /**
     * 向指定 Topic 推送消息
     * 踩坑点 #3: Notification payload 和 Data payload 的行为差异
     * - Notification: 浏览器自动显示通知横幅，SW 收不到 onMessage
     * - Data: SW 收到 onMessage 事件，可以自定义展示逻辑
     */
    public function sendToTopic(
        string $topic,
        string $title,
        string $body,
        array  $data = [],
        array  $options = []
    ): array {
        $topic = "kkday_{$topic}";

        // 推荐：使用 Data payload + Service Worker 自定义展示
        // 这样可以控制通知的 click_action、icon、tag 等
        $message = CloudMessage::withTarget('topic', $topic)
            ->withData(array_merge([
                'title' => $title,
                'body'  => $body,
                'icon'  => $options['icon'] ?? '/images/logo-192.png',
                'click_action' => $options['url'] ?? '/',
                'tag'   => $options['tag'] ?? 'default',
                'timestamp' => now()->toIso8601String(),
            ], $data));

        try {
            $report = $messaging = $this->messaging->send($message);

            Log::info('FCM push sent', [
                'topic' => $topic,
                'title' => $title,
                'message_id' => $report,
            ]);

            return ['success' => true, 'message_id' => $report];
        } catch (\Throwable $e) {
            Log::error('FCM push failed', [
                'topic' => $topic,
                'error' => $e->getMessage(),
            ]);

            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * 向多个 Topic 推送（OR 条件：任一 Topic 订阅者都收到）
     * 踩坑点 #4: FCM 条件表达式最多 5 个 topic，超出会报错
     */
    public function sendToTopics(
        array  $topics,
        string $title,
        string $body,
        array  $data = []
    ): array {
        if (count($topics) > 5) {
            throw new \InvalidArgumentException(
                'FCM condition expression supports at most 5 topics'
            );
        }

        // 构建条件表达式: "'topic1' in topics || 'topic2' in topics"
        $conditions = collect($topics)
            ->map(fn($t) => "'kkday_{$t}' in topics")
            ->implode(' || ');

        $message = CloudMessage::new()
            ->withTarget('condition', $conditions)
            ->withData(array_merge([
                'title' => $title,
                'body'  => $body,
            ], $data));

        try {
            $report = $this->messaging->send($message);
            return ['success' => true, 'message_id' => $report];
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * 向单个设备 Token 推送（用于精确推送：仅推送给特定用户）
     */
    public function sendToToken(
        string $token,
        string $title,
        string $body,
        array  $data = []
    ): array {
        $message = CloudMessage::withTarget('token', $token)
            ->withData(array_merge([
                'title' => $title,
                'body'  => $body,
            ], $data));

        try {
            $report = $this->messaging->send($message);
            return ['success' => true, 'message_id' => $report];
        } catch (\Kreait\Firebase\Exception\Messaging\NotFound $e) {
            // Token 已失效，需要清理
            Log::warning('FCM token expired, needs cleanup', ['token' => $token]);
            $this->handleExpiredToken($token);
            return ['success' => false, 'error' => 'token_expired'];
        } catch (\Throwable $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    private function handleExpiredToken(string $token): void
    {
        // 从所有缓存映射中移除该 Token
        $pattern = 'fcm_tokens:user:*';
        // 实际生产中建议用 Redis SCAN 而非 KEYS
        // 这里简化处理
        Log::info('Expired FCM token removed from cache', [
            'token' => substr($token, 0, 20) . '...'
        ]);
    }
}
```

### 4.5 订单状态变更触发推送

```php
<?php
// app/Listeners/OrderStatusChangedListener.php

namespace App\Listeners;

use App\Events\OrderStatusChanged;
use App\Services\PushNotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;

class OrderStatusChangedListener implements ShouldQueue
{
    public function __construct(
        private PushNotificationService $pushService
    ) {}

    public function handle(OrderStatusChanged $event): void
    {
        $order = $event->order;
        $statusMap = [
            'confirmed' => [
                'title' => '订单已确认',
                'body'  => "您的订单 {$order->order_no} 已确认，请查看行程详情",
                'tag'   => "order_{$order->id}_confirmed",
                'url'   => "/orders/{$order->id}",
            ],
            'ticket_issued' => [
                'title' => '出票成功',
                'body'  => "您的订单 {$order->order_no} 已出票",
                'tag'   => "order_{$order->id}_ticket",
                'url'   => "/orders/{$order->id}/ticket",
            ],
            'cancelled' => [
                'title' => '订单已取消',
                'body'  => "您的订单 {$order->order_no} 已取消",
                'tag'   => "order_{$order->id}_cancelled",
                'url'   => "/orders/{$order->id}",
            ],
        ];

        $statusKey = $order->status->value;
        if (!isset($statusMap[$statusKey])) {
            return;
        }

        $payload = $statusMap[$statusKey];

        // 踩坑点 #5: 同一 tag 的通知会被浏览器合并
        // 订单状态用 order_{id}_{status} 做 tag，避免不同订单互相覆盖
        $this->pushService->sendToTopic(
            topic: 'order_update',
            title: $payload['title'],
            body:  $payload['body'],
            data:  [
                'order_id' => (string) $order->id,
                'type'     => 'order_status',
            ],
            options: [
                'tag' => $payload['tag'],
                'url' => $payload['url'],
            ]
        );
    }
}
```

## 5. 前端 Service Worker 实现

### 5.1 firebase-messaging-sw.js

```javascript
// public/firebase-messaging-sw.js
// 必须放在网站根目录，路径必须是 /firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "YOUR_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
});

const messaging = firebase.messaging();

// 踩坑点 #6: onBackgroundMessage 只对 Data payload 生效
// 如果用 Notification payload，浏览器会自己处理，SW 收不到此事件
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Background message received:', payload);

    const notificationTitle = payload.data.title || 'KKday 通知';
    const notificationOptions = {
        body: payload.data.body || '',
        icon: payload.data.icon || '/images/logo-192.png',
        tag: payload.data.tag || 'default',
        data: {
            url: payload.data.click_action || '/',
            orderId: payload.data.order_id,
            type: payload.data.type,
        },
        // 踩坑点 #7: requireInteraction 让通知常驻，不会自动消失
        // 适合需要用户明确操作的通知（如订单确认）
        // 不要滥用，否则用户会关闭通知权限
        requireInteraction: payload.data.type === 'order_status',
        actions: payload.data.type === 'order_status' ? [
            { action: 'view_order', title: '查看订单' },
            { action: 'dismiss', title: '忽略' },
        ] : [],
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// 通知点击处理
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const action = event.action;
    const data = event.notification.data;

    if (action === 'dismiss') {
        return;
    }

    // 踩坑点 #8: clients.openWindow 必须在 notificationclick 事件内调用
    // 不能异步调用，否则浏览器会阻止弹出窗口
    const urlToOpen = action === 'view_order'
        ? `/orders/${data.orderId}`
        : (data.url || '/');

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((windowClients) => {
                // 如果已有打开的标签页，focus 它并 navigate
                for (const client of windowClients) {
                    if (client.url.includes(self.location.origin)) {
                        return client.focus().then(c => c.navigate(urlToOpen));
                    }
                }
                // 否则新开标签页
                return clients.openWindow(urlToOpen);
            })
    );
});
```

### 5.2 前端初始化与 Token 获取

```javascript
// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

export async function requestNotificationPermission() {
    // 踩坑点 #9: Notification.requestPermission() 在 Safari 中行为不同
    // Safari 16+ 支持 Web Push，但需要用户手势触发
    // 不要在页面加载时自动弹出，应该在用户点击"开启通知"按钮时触发
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
        console.warn('Notification permission denied');
        return null;
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const token = await getToken(messaging, { vapidKey });

    if (token) {
        console.log('FCM Token:', token);
        // 将 Token 注册到后端
        await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
            },
            body: JSON.stringify({
                token,
                topic: 'order_update',
                device_type: 'web',
                user_agent: navigator.userAgent,
            }),
        });
    }

    return token;
}

// 前台消息处理（浏览器打开时）
export function onForegroundMessage(callback) {
    onMessage(messaging, (payload) => {
        console.log('Foreground message:', payload);
        // 踩坑点 #10: 前台收到消息时，浏览器不会自动显示通知
        // 需要手动调用 new Notification() 或用 UI 组件展示
        if (payload.data) {
            new Notification(payload.data.title, {
                body: payload.data.body,
                icon: payload.data.icon,
                tag: payload.data.tag,
            });
        }
        callback(payload);
    });
}
```

## 6. 踩坑记录汇总

### 坑 #1：Token 静默失效，消息送不到

**现象**：用户订阅成功，但始终收不到推送。FCM 返回 `success: true`，没有报错。

**根因**：FCM Token 在以下情况下会静默失效：
- 用户清除浏览器数据
- 用户关闭通知权限后重新打开（会生成新 Token）
- Token 超过 2 个月未使用

**解决方案**：

```php
// 定期清理失效 Token（Laravel Scheduled Task）
// app/Console/Commands/CleanupExpiredFcmTokens.php

class CleanupExpiredFcmTokens extends Command
{
    protected $signature = 'fcm:cleanup-tokens';

    public function handle(): void
    {
        // 用 dry-run 发送探测消息，过滤掉失效 Token
        // 注意：FCM sendAll/sendEach 对无效 Token 返回具体错误码
        // INVALID_ARGUMENT, UNREGISTERED, SENDER_MISMATCH 都需要清理
    }
}
```

### 坑 #2：Notification Payload vs Data Payload

**这是最常踩的坑！**

| 特性 | Notification Payload | Data Payload |
|------|---------------------|--------------|
| 浏览器自动显示通知 | ✅ 是 | ❌ 否（需 SW 自己处理） |
| SW `onBackgroundMessage` | ❌ 不触发 | ✅ 触发 |
| `onMessage` 前台回调 | ✅ 触发 | ✅ 触发 |
| 通知自定义样式 | 有限 | 完全控制 |

**结论**：始终使用 **Data Payload**，在 Service Worker 中自行 `showNotification()`。

### 坑 #3：Safari / iOS 限制

- Safari 16.4+ 才支持 Web Push（需要 macOS Ventura+ 或 iOS 16.4+）
- iOS Safari 不支持 `actions` 参数（通知按钮不显示）
- 不支持 `requireInteraction`（通知会自动消失）
- 必须在 PWA 模式下（添加到主屏幕）才能推送

```javascript
// 检测 Safari 支持情况
function isPushSupported() {
    if (!('serviceWorker' in navigator)) return false;
    if (!('PushManager' in window)) return false;
    if (!('Notification' in window)) return false;

    // iOS Safari 检测
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS && !navigator.standalone) {
        console.warn('iOS: 需要添加到主屏幕才能接收推送');
        return false;
    }

    return true;
}
```

### 坑 #4：开发环境 localhost 的 Service Worker 缓存

**现象**：修改了 `firebase-messaging-sw.js` 但不生效。

**根因**：Service Worker 有强缓存策略，浏览器不会自动更新。

**解决**：

```javascript
// 开发时在 SW 文件顶部加版本号
const SW_VERSION = 'v20260505'; // 每次修改后更新

// 在 DevTools → Application → Service Workers 中点击 "Unregister"
// 或在 sw 文件中加入 skipWaiting()
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});
```

## 7. 生产环境监控

```php
// 推送成功率监控（Prometheus 指标）
// app/Metrics/FcmMetrics.php

class FcmMetrics
{
    public static function recordPushResult(string $topic, bool $success): void
    {
        app('prometheus')->getOrRegisterCounter(
            'fcm_push_total',
            'FCM push message count',
            ['topic', 'status']
        )->inc([
            'topic' => $topic,
            'status' => $success ? 'success' : 'failure',
        ]);
    }
}
```

配合 Grafana Dashboard 监控：
- 推送成功率（目标 > 99%）
- 失效 Token 比例（告警阈值 > 10%）
- Topic 订阅人数趋势

## 8. 总结

在 KKday B2C 旅行平台落地 FCM Web Push 的关键经验：

1. **始终用 Data Payload**——Notification Payload 会让 SW 的 `onBackgroundMessage` 不触发
2. **Token 生命周期管理是核心**——静默失效是推送不到的最大元凶
3. **Safari/iOS 限制很大**——需要 PWA 模式、用户手势触发、不支持 actions
4. **Topic 命名规范化**——加业务前缀（如 `kkday_order_update`），避免多项目冲突
5. **Tag 设计要用心**——`order_{id}_{status}` 让同订单状态变更合并显示，不同订单独立
6. **开发环境先清 SW 缓存**——否则会怀疑人生

Web Push 是一个「看起来简单、细节很多」的功能。希望这篇踩坑记录能帮你少走弯路。

## 9. 推送通知服务横向对比

在选型阶段，除了 FCM，我们还评估了 OneSignal 和 Pusher Beams。以下是三者的关键差异：

| 维度 | Firebase Cloud Messaging (FCM) | OneSignal | Pusher Beams |
|------|-------------------------------|-----------|--------------|
| **免费额度** | 完全免费，无消息数限制 | 免费版 10K 订阅者，有水印 | 免费 2K 订阅者/月，100K 消息/月 |
| **后端集成** | 官方 Admin SDK（kreait/firebase-php） | REST API / 官方 PHP SDK | REST API / PHP SDK |
| **前端 SDK** | firebase/messaging（官方） | OneSignal SDK（独立） | Pusher JS SDK |
| **Topic/Segment** | Topic 订阅（服务端管理） | Segments + Tags（控制台可视化） | Interest 订阅（API 管理） |
| **多平台** | Web + Android + iOS + Flutter | Web + Android + iOS + Email + SMS | Web + Android + iOS |
| **离线推送** | ✅ 浏览器关闭仍可推送 | ✅ 支持 | ✅ 支持 |
| **数据分析** | Firebase Analytics（基础） | 丰富的报表 + A/B 测试 | 基础送达率统计 |
| **自定义程度** | Data Payload 完全自定义 | 高（支持自定义模板） | 中等 |
| **Safari 支持** | 需要 PWA 模式 | 原生支持（Safari 推送 API） | 需要 PWA 模式 |
| **运维成本** | 低（Google 托管） | 低（SaaS） | 低（SaaS） |

**选型建议**：
- **已有 Firebase 生态**（Auth、Analytics、Firestore）→ 选 FCM，集成成本最低
- **需要营销能力**（A/B 测试、用户分群、多渠道）→ 选 OneSignal
- **已有 Pusher 生态**（实时聊天、Presence Channels）→ 选 Pusher Beams，统一技术栈

## 10. Service Worker 注册最佳实践

以下是一个带错误处理和重试机制的 Service Worker 注册实现：

```javascript
// src/utils/registerServiceWorker.js

/**
 * 注册 FCM Service Worker，带重试和版本管理
 * 踩坑点：SW 注册是异步的，且可能因网络/CSP策略失败
 */
export async function registerFCMServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('[SW] 当前浏览器不支持 Service Worker');
        return null;
    }

    try {
        // 检查是否已注册
        const existingRegistration = await navigator.serviceWorker.getRegistration('/');
        if (existingRegistration) {
            console.log('[SW] 已存在注册，更新中...');
            existingRegistration.update();
            return existingRegistration;
        }

        // 注册新的 Service Worker
        const registration = await navigator.serviceWorker.register(
            '/firebase-messaging-sw.js',
            { scope: '/' }
        );

        console.log('[SW] 注册成功:', registration.scope);

        // 监听 SW 状态变化
        registration.installing?.addEventListener('statechange', (event) => {
            console.log('[SW] 状态变更:', event.target.state);
        });

        // 等待 SW 激活
        await navigator.serviceWorker.ready;
        console.log('[SW] Service Worker 已激活');

        return registration;
    } catch (error) {
        console.error('[SW] 注册失败:', error);
        if (error.message.includes('404')) {
            console.error('[SW] 请确认 firebase-messaging-sw.js 放在 public/ 根目录');
        }
        return null;
    }
}
```

## 11. FCM Token 生命周期管理

Token 是 FCM 推送的核心，完整生命周期需要闭环管理：

```php
<?php
// app/Services/FcmTokenManager.php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Kreait\Firebase\Messaging;

class FcmTokenManager
{
    public function __construct(
        private readonly Messaging $messaging
    ) {}

    /**
     * 注册新 Token：验证 + 存储 + 订阅 Topic
     */
    public function registerToken(
        int $userId,
        string $token,
        string $topic,
        array $deviceMeta = []
    ): array {
        // 1. 验证 Token 有效性
        if (!$this->validateToken($token)) {
            return ['success' => false, 'error' => 'invalid_token'];
        }

        // 2. 存储到数据库（持久化，不依赖 Cache）
        DB::table('fcm_tokens')->updateOrInsert(
            ['token' => $token],
            [
                'user_id'      => $userId,
                'device_type'  => $deviceMeta['device_type'] ?? 'web',
                'user_agent'   => $deviceMeta['user_agent'] ?? null,
                'last_used_at' => now(),
                'updated_at'   => now(),
            ]
        );

        // 3. 订阅 Topic
        $this->messaging->subscribeToTopic($topic, $token);

        return ['success' => true, 'topic' => $topic];
    }

    public function validateToken(string $token): bool
    {
        try {
            $this->messaging->validateRegistrationTokens($token);
            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * 批量清理失效 Token（定时任务调用）
     */
    public function cleanupExpiredTokens(int $batchSize = 500): int
    {
        $removed = 0;
        DB::table('fcm_tokens')
            ->orderBy('last_used_at')
            ->limit($batchSize)
            ->each(function ($record) use (&$removed) {
                if (!$this->validateToken($record->token)) {
                    DB::table('fcm_tokens')->where('token', $record->token)->delete();
                    $removed++;
                }
            });

        return $removed;
    }

    /**
     * Token 刷新：前端 getToken() 返回新 Token 时调用
     */
    public function refreshToken(int $userId, string $oldToken, string $newToken): void
    {
        DB::table('fcm_tokens')
            ->where('token', $oldToken)
            ->update(['token' => $newToken, 'updated_at' => now()]);

        // 迁移 Topic 订阅
        $topics = DB::table('fcm_subscriptions')
            ->where('token', $oldToken)->pluck('topic')->toArray();

        foreach ($topics as $topic) {
            $this->messaging->unsubscribeFromTopic($topic, $oldToken);
            $this->messaging->subscribeToTopic($topic, $newToken);
        }
    }
}
```

Token 生命周期状态流转：

```
用户授权通知 → getToken() → 注册到后端 → 订阅 Topic
                    ↓
            Token 失效（清除数据/权限变更/2个月未使用）
                    ↓
            推送失败 → 捕获 NotFound → 清理失效 Token
                    ↓
            前端 getToken() → 新 Token → 重新注册 + 订阅
```

## 相关阅读

- [Laravel Precognition 实战：表单预验证与前后端实时校验](/posts/Laravel-Precognition-实战-表单预验证-前后端实时校验的全新交互范式) — 本文涉及前端与 Laravel 后端的实时交互，与 FCM 推送的前后端协同方案互补
- [SSE vs WebSocket vs HTTP Streaming：实时通信方案工程选型](/posts/2026-06-03-SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型) — Web Push 之外的其他实时通信方案对比，帮助你根据场景选择最合适的技术
- [Server-Driven UI + Laravel BFF：后端驱动前端的架构实践](/posts/server-driven-ui-laravel-bff) — 与本文的 BFF 层推送架构思路一致，适合想深入了解 Laravel 前后端分离架构的读者
