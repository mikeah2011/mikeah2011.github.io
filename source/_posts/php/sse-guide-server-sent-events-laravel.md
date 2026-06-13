---

title: SSE-实战-Server-Sent-Events-在-Laravel-中的应用-实时推送轻量方案与踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-16 18:02:58
updated: 2026-05-16 18:15:17
categories:
  - php
tags: [Laravel, SSE, Server-Sent-Events, WebSocket, 实时推送, B2C]
keywords: [Laravel, SSE, Server-Sent-Events, WebSocket, 实时推送, Server, Sent]
description: >-
---
# SSE 实战：Server-Sent Events 在 Laravel 中的应用——实时推送轻量方案与踩坑记录

## 为什么选 SSE 而不是 WebSocket？

在 KKday B2C API 项目中，产品提出一个需求：用户下单后，订单详情页需要**实时显示状态变化**（支付成功 → 出票中 → 出票完成）。团队里有人提议用 WebSocket（Laravel Reverb / Pusher），但实际评估后我们选了 SSE。原因很简单：

| 维度 | WebSocket | SSE (Server-Sent Events) |
|------|-----------|--------------------------|
| 通信方向 | 双向 | **单向**（Server → Client） |
| 协议 | `ws://` / `wss://` | 普通 HTTP |
| 连接管理 | 有状态，需额外基础设施 | 无状态，标准 HTTP 请求 |
| 自动重连 | 需手动实现 | **浏览器原生支持** |
| 代理/Nginx 兼容 | 需特殊配置 | 标准 HTTP，兼容性好 |
| 适用场景 | 聊天、协同编辑、游戏 | 通知、进度条、状态推送 |

订单状态推送是典型的**单向推送**场景：客户端只需监听，不需要反向发消息。SSE 的架构更简单、运维成本更低、浏览器兼容性更好（除了 IE，现代浏览器全部支持）。

```
┌─────────────────────────────────────────────────────────────┐
│                    SSE 架构总览                              │
│                                                             │
│  ┌──────────┐    GET /api/orders/{id}/stream    ┌─────────┐ │
│  │  Browser  │ ────────────────────────────────→ │  Nginx  │ │
│  │ EventSource│                                  │ (proxy) │ │
│  │           │ ←─ text/event-stream ──────────── │         │ │
│  └──────────┘     (长连接, 持续推送)              └────┬────┘ │
│                                                       │      │
│                                                       ▼      │
│                                                ┌───────────┐ │
│                                                │  Laravel   │ │
│                                                │  Streamed  │ │
│                                                │  Response  │ │
│                                                └─────┬─────┘ │
│                                                      │       │
│                           ┌──────────────────────────┤       │
│                           ▼                          ▼       │
│                    ┌────────────┐           ┌──────────────┐ │
│                    │   Redis    │           │  MySQL /     │ │
│                    │  Pub/Sub   │           │  Queue Event │ │
│                    └────────────┘           └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 一、Laravel 后端实现：StreamedResponse

### 1.1 基础 SSE 端点

Laravel 的 `StreamedResponse` 可以实现流式输出，配合 `response()->stream()` 就能构建 SSE 端点：

```php
<?php

namespace App\Http\Controllers\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\StreamedResponse;
use Illuminate\Support\Facades\Redis;

class OrderStreamController extends Controller
{
    /**
     * SSE 端点：实时推送订单状态变化
     * GET /api/v2/orders/{id}/stream
     */
    public function stream(int $orderId): StreamedResponse
    {
        return response()->stream(function () use ($orderId) {
            // 1. 先推送当前状态
            $order = \App\Models\Order::find($orderId);
            if (!$order) {
                $this->sendEvent('error', ['message' => 'Order not found']);
                return;
            }

            $this->sendEvent('order.status', [
                'order_id' => $orderId,
                'status'   => $order->status,
                'updated'  => $order->updated_at->toIso8601String(),
            ]);

            // 2. 订阅 Redis 频道，监听后续变化
            $channel = "order:status:{$orderId}";
            $redis = Redis::connection('subscribe');

            $redis->subscribe([$channel], function ($message) use ($orderId) {
                $data = json_decode($message, true);
                $this->sendEvent('order.status', $data);

                // 终态状态关闭连接
                if (in_array($data['status'] ?? '', ['completed', 'cancelled', 'refunded'])) {
                    $this->sendEvent('close', ['reason' => 'terminal_state']);
                    // Redis::subscribe 会阻塞，这里无法直接 break
                    // 需要通过 pubsub punsubscribe 来断开
                }
            });
        }, 200, [
            'Content-Type'  => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'Connection'    => 'keep-alive',
            'X-Accel-Buffering' => 'no',  // ⚠️ 关键：禁用 Nginx 缓冲
        ]);
    }

    /**
     * 格式化 SSE 事件
     */
    private function sendEvent(string $event, array $data): void
    {
        echo "event: {$event}\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n";
        echo "\n";

        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }
}
```

### 1.2 心跳保活机制

SSE 长连接最怕的是**中间代理超时断开**。Nginx 默认 `proxy_read_timeout` 是 60 秒，如果 60 秒内没有数据推送，连接就会被切断。

解决方案：发送心跳注释行（以 `:` 开头的行会被浏览器忽略，不触发 `onmessage`）：

```php
<?php

namespace App\Services\SSE;

use Illuminate\Support\Facades\Redis;

class SSEConnectionManager
{
    private int $heartbeatInterval;
    private int $timeout;
    private bool $running = true;

    public function __construct(
        int $heartbeatInterval = 15, // 秒
        int $timeout = 300           // 最大连接时长
    ) {
        $this->heartbeatInterval = $heartbeatInterval;
        $this->timeout = $timeout;
    }

    /**
     * 带心跳的 SSE 流
     */
    public function stream(callable $dataCallback, callable $filter = null): void
    {
        $startTime = time();
        $lastHeartbeat = time();

        // 使用 Redis pubsub 非阻塞轮询
        $pubsub = Redis::connection('subscribe')
            ->pubSubLoop();

        while ($this->running) {
            // 超时检查
            if (time() - $startTime >= $this->timeout) {
                $this->sendComment('timeout, reconnecting');
                $this->sendEvent('timeout', ['max_age' => $this->timeout]);
                break;
            }

            // 心跳检查
            if (time() - $lastHeartbeat >= $this->heartbeatInterval) {
                $this->sendComment('heartbeat ' . now()->toIso8601String());
                $lastHeartbeat = time();
            }

            // 非阻塞读取 Redis 消息
            $message = $pubsub->current();
            if ($message) {
                $dataCallback($message);
                $pubsub->next();
            } else {
                // 没有消息，短暂休眠避免 CPU 空转
                usleep(100_000); // 100ms
                $pubsub->next();
            }
        }

        $pubsub->unsubscribe();
    }

    /**
     * 发送 SSE 注释（心跳）
     * 以 `:` 开头的行是注释，浏览器不会触发 onmessage
     */
    private function sendComment(string $text): void
    {
        echo ": {$text}\n\n";
        $this->flush();
    }

    /**
     * 发送 SSE 事件
     */
    public function sendEvent(string $event, array $data, ?string $id = null): void
    {
        if ($id) {
            echo "id: {$id}\n";
        }
        echo "event: {$event}\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n";
        echo "\n";
        $this->flush();
    }

    private function flush(): void
    {
        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }

    public function stop(): void
    {
        $this->running = false;
    }
}
```

### 1.3 Last-Event-ID 断线重连

SSE 协议原生支持 `Last-Event-ID`：浏览器断线后会自动带上这个 header 重连。服务端利用它推送漏掉的消息：

```php
public function stream(Request $request, int $orderId): StreamedResponse
{
    $lastEventId = $request->header('Last-Event-ID');
    $lastEventIdInt = (int) ($lastEventId ?: 0);

    return response()->stream(function () use ($orderId, $lastEventIdInt) {
        $sseManager = new SSEConnectionManager();

        // 如果有 Last-Event-ID，先补发漏掉的事件
        if ($lastEventIdInt > 0) {
            $missedEvents = \App\Models\OrderStatusLog::query()
                ->where('order_id', $orderId)
                ->where('id', '>', $lastEventIdInt)
                ->orderBy('id')
                ->get();

            foreach ($missedEvents as $log) {
                $sseManager->sendEvent('order.status', [
                    'order_id' => $orderId,
                    'status'   => $log->new_status,
                    'updated'  => $log->created_at->toIso8601String(),
                ], (string) $log->id);
            }
        }

        // 订阅后续实时事件
        $channel = "order:status:{$orderId}";
        Redis::subscribe([$channel], function ($message) use ($orderId, $sseManager) {
            $data = json_decode($message, true);
            $sseManager->sendEvent('order.status', $data, $data['event_id'] ?? null);
        });
    }, 200, [
        'Content-Type'         => 'text/event-stream',
        'Cache-Control'        => 'no-cache',
        'X-Accel-Buffering'    => 'no',
    ]);
}
```

事件发布端（订单状态变更时）：

```php
<?php

namespace App\Services\Order;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class OrderStatusPublisher
{
    public function publish(int $orderId, string $status, array $extra = []): void
    {
        $eventId = (string) Str::orderedUuid();

        $payload = array_merge([
            'order_id'  => $orderId,
            'status'    => $status,
            'event_id'  => $eventId,
            'updated'   => now()->toIso8601String(),
        ], $extra);

        Redis::publish("order:status:{$orderId}", json_encode($payload));

        // 同时写入数据库用于断线重连回放
        \App\Models\OrderStatusLog::create([
            'order_id'   => $orderId,
            'new_status' => $status,
            'event_id'   => $eventId,
            'payload'    => $payload,
        ]);
    }
}
```

## 二、前端集成：EventSource API

### 2.1 基础用法

```javascript
// utils/sse.js
export class SSEClient {
  constructor(url, options = {}) {
    this.url = url;
    this.maxRetries = options.maxRetries ?? 10;
    this.retryCount = 0;
    this.handlers = new Map();
  }

  connect() {
    // EventSource 自动带 Cookie，无需额外处理鉴权
    this.eventSource = new EventSource(this.url, {
      withCredentials: true, // 跨域时带上 Cookie
    });

    this.eventSource.onopen = () => {
      console.log('[SSE] Connected');
      this.retryCount = 0;
    };

    // 监听自定义事件
    for (const [event, handler] of this.handlers) {
      this.eventSource.addEventListener(event, handler);
    }

    // 兜底：未命名事件
    this.eventSource.onmessage = (e) => {
      console.log('[SSE] Default message:', e.data);
    };

    this.eventSource.onerror = (e) => {
      console.warn('[SSE] Error, state:', this.eventSource.readyState);

      if (this.eventSource.readyState === EventSource.CLOSED) {
        // 服务端主动关闭，不重连
        console.log('[SSE] Connection closed by server');
        return;
      }

      // EventSource 会自动重连，但我们要监控重试次数
      this.retryCount++;
      if (this.retryCount >= this.maxRetries) {
        console.error('[SSE] Max retries reached, closing');
        this.eventSource.close();
        this.handlers.get('max_retries')?.();
      }
    };
  }

  on(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }

  close() {
    this.eventSource?.close();
  }
}
```

### 2.2 Vue 3 集成示例

```vue
<!-- OrderStatusStream.vue -->
<template>
  <div class="order-status">
    <span :class="statusClass">{{ statusLabel }}</span>
    <span v-if="isConnecting" class="text-gray-400 text-sm">连接中...</span>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { SSEClient } from '@/utils/sse'

const props = defineProps({ orderId: Number })
const status = ref('loading')
const isConnecting = ref(true)

const statusLabel = computed(() => ({
  pending: '待支付',
  paid: '已支付',
  processing: '出票中',
  completed: '出票完成',
  cancelled: '已取消',
}[status.value] || status.value))

let sseClient = null

onMounted(() => {
  sseClient = new SSEClient(`/api/v2/orders/${props.orderId}/stream`)

  sseClient
    .on('order.status', (e) => {
      const data = JSON.parse(e.data)
      status.value = data.status
      isConnecting.value = false
    })
    .on('close', (e) => {
      const data = JSON.parse(e.data)
      console.log('[SSE] Closed:', data.reason)
      sseClient.close()
    })
    .connect()
})

onUnmounted(() => {
  sseClient?.close()
})
</script>
```

## 三、踩坑记录（生产真实问题）

### 坑 1：Nginx 反向代理缓冲了整个响应

**现象**：本地开发正常，部署到 Nginx 后 SSE 事件被攒成一大块才推给浏览器。

**原因**：Nginx 的 `proxy_buffering` 默认开启，它会等后端响应完整后再转发给客户端。SSE 的特性就是"边生成边推送"，缓冲等于废了它。

**解决**：

```nginx
location /api/v2/orders/ {
    # ① 禁用代理缓冲
    proxy_buffering off;

    # ② 禁用 gzip（SSE 数据量小，gzip 反而增加延迟）
    gzip off;

    # ③ 设置合理的超时时间
    proxy_read_timeout 300s;  # SSE 连接最长保持 5 分钟
    proxy_send_timeout 300s;

    proxy_pass http://upstream_laravel;
}
```

或者在 Laravel 端返回 header `X-Accel-Buffering: no`（上面代码已有）。

### 坑 2：PHP-FPM 的 `max_execution_time` 杀死长连接

**现象**：SSE 连接在 60 秒后被断开，日志显示 `Maximum execution time exceeded`。

**原因**：PHP-FPM 默认 `max_execution_time = 60`。SSE 是一个持续运行的 PHP 进程，60 秒后会被杀掉。

**解决**：

```php
// 在 SSE 控制器方法开头
set_time_limit(0);  // 取消执行时间限制

// 或者设置一个合理的值
set_time_limit(300); // 5 分钟
```

同时在 `php.ini` 中：

```ini
; 生产环境 SSE 相关配置
max_execution_time = 0          ; CLI 模式默认不限
request_terminate_timeout = 300 ; FPM worker 最长运行时间
```

### 坑 3：PHP-FPM 进程被占满

**现象**：SSE 连接数一多，API 开始 502。

**原因**：每个 SSE 连接占用一个 PHP-FPM worker 进程。如果你的 FPM 配置是 `pm.max_children = 50`，50 个 SSE 连接就能把 worker 池耗光。

**架构图：问题与解决方案**

```
❌ 问题架构：SSE 直接占用 FPM Worker
┌──────────────────────────────────────────────┐
│                PHP-FPM Pool                   │
│  ┌──────┐ ┌──────┐ ┌──────┐      ┌──────┐   │
│  │Worker│ │Worker│ │Worker│ ...  │Worker│   │
│  │ SSE  │ │ SSE  │ │ SSE  │      │ API  │   │
│  │连接1 │ │连接2 │ │连接3 │      │ 响应 │   │
│  └──────┘ └──────┘ └──────┘      └──────┘   │
│  ↑ 50个 worker，30个被 SSE 长连接占满         │
│  → 剩下 20 个处理 API 请求，502 风险极高      │
└──────────────────────────────────────────────┘

✅ 解决方案：独立 SSE Worker Pool
┌─────────────────────────┐  ┌────────────────────┐
│   API FPM Pool           │  │   SSE FPM Pool      │
│   pm.max_children = 50   │  │   pm.max_children = 20│
│  ┌──────┐┌──────┐┌─────┐│  │  ┌──────┐┌──────┐   │
│  │ API  ││ API  ││ API ││  │  │ SSE  ││ SSE  │   │
│  └──────┘└──────┘└─────┘│  │  └──────┘└──────┘   │
│   处理普通 API 请求       │  │   专门处理 SSE 连接   │
└─────────────────────────┘  └────────────────────┘
         Nginx: location 路由分流
```

Nginx 配置分流：

```nginx
# SSE 专用 upstream
upstream php_sse {
    server 127.0.0.1:9001;  # SSE 专用 FPM pool
}

# 普通 API upstream
upstream php_api {
    server 127.0.0.1:9000;  # 默认 FPM pool
}

server {
    # SSE 端点走专用 pool
    location ~ ^/api/.*/stream$ {
        proxy_pass http://php_sse;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # 其他 API 走默认 pool
    location /api/ {
        proxy_pass http://php_api;
    }
}
```

PHP-FPM 池配置（`www-sse.conf`）：

```ini
[www-sse]
user = www-data
group = www-data
listen = 127.0.0.1:9001
pm = dynamic
pm.max_children = 20
pm.start_servers = 5
pm.min_spare_servers = 3
pm.max_spare_servers = 10
; SSE 关键配置
request_terminate_timeout = 300
```

### 坑 4：HTTPS 环境下 EventSource 跨域失败

**现象**：`EventSource` 连接报错 `SecurityError: Failed to construct 'EventSource'`。

**原因**：HTTPS 页面不能连接 HTTP 的 SSE 端点（Mixed Content 被浏览器拦截）。

**解决**：确保 SSE URL 和页面同协议。如果跨域，需要设置 CORS：

```php
// Laravel 中间件 SSECorsMiddleware
class SSECorsMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        if ($request->is('api/*/stream')) {
            $response = $next($request);
            $response->headers->set('Access-Control-Allow-Origin', 'https://www.kkday.com');
            $response->headers->set('Access-Control-Allow-Credentials', 'true');
            return $response;
        }
        return $next($request);
    }
}
```

### 坑 5：Redis Subscribe 与 Laravel Queue 冲突

**现象**：SSE 连接期间，同进程的 Laravel 事件处理异常。

**原因**：`Redis::subscribe()` 会阻塞当前进程，连接期间这个 PHP 进程无法处理其他逻辑。

**解决**：SSE 控制器中不要用 `Redis::subscribe()`，改用 `Predis` 的非阻塞 `pubSubLoop`：

```php
use Predis\Client;

$predis = new Client([
    'scheme' => 'tcp',
    'host'   => config('database.redis.default.host'),
    'port'   => config('database.redis.default.port'),
]);

$pubsub = $predis->pubSubLoop();
$pubsub->subscribe("order:status:{$orderId}");

foreach ($pubsub as $message) {
    if ($message->kind === 'message') {
        $data = json_decode($message->payload, true);
        $this->sendEvent('order.status', $data);
    }

    // 心跳检查
    if (microtime(true) - $lastHeartbeat > 15) {
        echo ": heartbeat\n\n";
        flush();
        $lastHeartbeat = microtime(true);
    }
}
```

## 四、SSE vs WebSocket vs Long Polling 选型决策树

### 4.1 三种方案全面对比

| 维度 | Long Polling | SSE (Server-Sent Events) | WebSocket |
|------|-------------|-------------------------|-----------|
| 通信方向 | 客户端 → 服务端（轮询） | **单向**（Server → Client） | **双向** |
| 协议 | 普通 HTTP | 普通 HTTP | `ws://` / `wss://` |
| 连接模型 | 短连接，反复建立/断开 | **长连接**，一次握手持续推送 | **长连接**，持久双工通道 |
| 服务端推送 | 模拟（响应后立即重连） | 原生支持，事件流持续推送 | 原生支持 |
| 自动重连 | 需手动实现（JS 定时器） | **浏览器原生支持** | 需手动实现 |
| 断线补发 | 需自建消息队列 | **Last-Event-ID 协议级支持** | 需自行实现 |
| 心跳保活 | 每次请求自带 | 需实现（`:` 注释行） | 需实现（Ping/Pong） |
| Nginx/代理兼容 | ✅ 标准 HTTP | ✅ 标准 HTTP（需禁用缓冲） | ⚠️ 需特殊配置（Upgrade） |
| 浏览器兼容性 | 所有浏览器 | 所有现代浏览器（IE 除外） | 所有现代浏览器 |
| 服务端资源消耗 | **高**（频繁建立连接） | **低**（单连接持续推送） | **中**（需维护有状态连接） |
| 适用场景 | 低频轮询、简单通知 | **通知、进度条、状态推送、日志流** | 聊天、协同编辑、游戏、双向交互 |
| 实现复杂度 | 低 | 中 | 高 |
| 延迟 | 受轮询间隔影响（秒级） | **实时**（毫秒级推送） | **实时**（毫秒级） |

> **选型口诀**：单向推送选 SSE，双向交互选 WebSocket，简单场景用 Long Polling。SSE 在 B2C 电商场景（订单状态、库存变更、任务进度）中性价比最高——无需 WebSocket 的复杂基础设施，却能获得接近实时的推送体验。

### 4.2 决策流程图

```
你的场景需要客户端 → 服务器的通信吗？
├── 是 → WebSocket（聊天、协同编辑、游戏）
└── 否 → 推送频率有多高？
    ├── 每秒多次 → WebSocket（避免 HTTP 开销）
    ├── 每秒 1 次 ~ 每分钟数次 → SSE ✅
    └── 每分钟 < 1 次 → 短轮询也行，SSE 也行
        └── 需要断线自动补发？ → SSE ✅（Last-Event-ID）
```

## 五、实际效果数据

在 KKday B2C API 项目中部署 SSE 后的指标：

| 指标 | 优化前（Polling） | 优化后（SSE） |
|------|-------------------|---------------|
| API 请求量（订单状态查询） | 1200 req/min | **接近 0**（仅 SSE 连接） |
| 用户感知延迟 | 5~10 秒（轮询间隔） | **< 1 秒** |
| 服务器带宽 | 高（每次轮询返回完整 JSON） | 低（仅推送变更数据） |
| 代码复杂度 | 简单 | 中等 |

## 六、完整路由与中间件配置

```php
// routes/api.php
Route::prefix('v2/orders/{orderId}')->group(function () {
    Route::get('/stream', [OrderStreamController::class, 'stream'])
        ->middleware(['auth:sanctum', 'throttle:10,1']); // 每分钟最多 10 次连接
});

// app/Http/Kernel.php - SSE 专用中间件组
'sse' => [
    \App\Http\Middleware\SSECorsMiddleware::class,
    \App\Http\Middleware\SSEKeepAlive::class,  // 注入心跳
],
```

## 总结

SSE 是"单向推送"场景的最佳选择——比 WebSocket 简单，比 Polling 高效。在 Laravel B2C API 中，它特别适合：

- ✅ 订单状态实时推送
- ✅ 后台任务进度条
- ✅ 库存变更通知
- ✅ 管理后台实时数据面板

核心注意事项：

1. **Nginx 必须禁用缓冲**（`proxy_buffering off` 或 `X-Accel-Buffering: no`）
2. **PHP 必须取消执行时间限制**（`set_time_limit(0)`）
3. **独立 FPM Pool** 避免 SSE 长连接耗尽 API worker
4. **实现心跳保活**防止代理超时断开
5. **Last-Event-ID + 事件日志表**保证断线不丢消息

如果你的场景是双向通信（聊天、协同编辑），请用 WebSocket（Laravel Reverb / Pusher）。如果是单向推送，SSE 就够了。

## 相关阅读

- [SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案的工程选型](/categories/架构/2026-06-03-SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型/)
- [Long Polling vs SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案对比](/categories/架构/Long-Polling-vs-SSE-vs-WebSocket-vs-HTTP-Streaming-实战-实时通信方案对比/)
- [Laravel Echo 2.x 实战：Reverb + Presence Channel 在 B2C 电商中的在线客服与协同编辑](/categories/前端/Laravel-Echo-2x-Reverb-Presence-Channel-B2C在线客服与协同编辑/)
---
tle: SSE-实战-Server-Sent-Events-在-Laravel-中的应用-实时推送轻量方案与踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-16 18:02:58
updated: 2026-05-16 18:15:17
categories:
  - php
tags: [Laravel, SSE, Server-Sent-Events, WebSocket, 实时推送, B2C]
keywords: [Laravel, SSE, Server-Sent-Events, WebSocket, 实时推送, Server, Sent]
description: >-
Laravel SSE 实战指南：Server-Sent Events 在 B2C 电商 API 中的完整应用方案。 详解订单状态实时推送、后台任务进度通知、库存变更广播等场景，涵盖 EventSource API 前端集成、 Laravel StreamedResponse 后端实现、Nginx 反向代理缓冲避坑、心跳保活机制与 Last-Event-ID 断线重连策略。 深入对比 SSE vs WebSocket vs Long Polling 的选型差异，附带 PHP-FPM 独立池配置、Redis Pub/Sub 非阻塞轮询等生产级踩坑记录， 助你快速落地 Server-Sent Events 实时推送方案。
---
# SSE 实战：Server-Sent Events 在 Laravel 中的应用——实时推送轻量方案与踩坑记录

## 为什么选 SSE 而不是 WebSocket？

在 KKday B2C API 项目中，产品提出一个需求：用户下单后，订单详情页需要**实时显示状态变化**（支付成功 → 出票中 → 出票完成）。团队里有人提议用 WebSocket（Laravel Reverb / Pusher），但实际评估后我们选了 SSE。原因很简单：

| 维度 | WebSocket | SSE (Server-Sent Events) |
|------|-----------|--------------------------|
| 通信方向 | 双向 | **单向**（Server → Client） |
| 协议 | `ws://` / `wss://` | 普通 HTTP |
| 连接管理 | 有状态，需额外基础设施 | 无状态，标准 HTTP 请求 |
| 自动重连 | 需手动实现 | **浏览器原生支持** |
| 代理/Nginx 兼容 | 需特殊配置 | 标准 HTTP，兼容性好 |
| 适用场景 | 聊天、协同编辑、游戏 | 通知、进度条、状态推送 |

订单状态推送是典型的**单向推送**场景：客户端只需监听，不需要反向发消息。SSE 的架构更简单、运维成本更低、浏览器兼容性更好（除了 IE，现代浏览器全部支持）。

```
┌─────────────────────────────────────────────────────────────┐
│                    SSE 架构总览                              │
│                                                             │
│  ┌──────────┐    GET /api/orders/{id}/stream    ┌─────────┐ │
│  │  Browser  │ ────────────────────────────────→ │  Nginx  │ │
│  │ EventSource│                                  │ (proxy) │ │
│  │           │ ←─ text/event-stream ──────────── │         │ │
│  └──────────┘     (长连接, 持续推送)              └────┬────┘ │
│                                                       │      │
│                                                       ▼      │
│                                                ┌───────────┐ │
│                                                │  Laravel   │ │
│                                                │  Streamed  │ │
│                                                │  Response  │ │
│                                                └─────┬─────┘ │
│                                                      │       │
│                           ┌──────────────────────────┤       │
│                           ▼                          ▼       │
│                    ┌────────────┐           ┌──────────────┐ │
│                    │   Redis    │           │  MySQL /     │ │
│                    │  Pub/Sub   │           │  Queue Event │ │
│                    └────────────┘           └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 一、Laravel 后端实现：StreamedResponse

### 1.1 基础 SSE 端点

Laravel 的 `StreamedResponse` 可以实现流式输出，配合 `response()->stream()` 就能构建 SSE 端点：

```php
<?php

namespace App\Http\Controllers\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\StreamedResponse;
use Illuminate\Support\Facades\Redis;

class OrderStreamController extends Controller
{
    /**
     * SSE 端点：实时推送订单状态变化
     * GET /api/v2/orders/{id}/stream
     */
    public function stream(int $orderId): StreamedResponse
    {
        return response()->stream(function () use ($orderId) {
            // 1. 先推送当前状态
            $order = \App\Models\Order::find($orderId);
            if (!$order) {
                $this->sendEvent('error', ['message' => 'Order not found']);
                return;
            }

            $this->sendEvent('order.status', [
                'order_id' => $orderId,
                'status'   => $order->status,
                'updated'  => $order->updated_at->toIso8601String(),
            ]);

            // 2. 订阅 Redis 频道，监听后续变化
            $channel = "order:status:{$orderId}";
            $redis = Redis::connection('subscribe');

            $redis->subscribe([$channel], function ($message) use ($orderId) {
                $data = json_decode($message, true);
                $this->sendEvent('order.status', $data);

                // 终态状态关闭连接
                if (in_array($data['status'] ?? '', ['completed', 'cancelled', 'refunded'])) {
                    $this->sendEvent('close', ['reason' => 'terminal_state']);
                    // Redis::subscribe 会阻塞，这里无法直接 break
                    // 需要通过 pubsub punsubscribe 来断开
                }
            });
        }, 200, [
            'Content-Type'  => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'Connection'    => 'keep-alive',
            'X-Accel-Buffering' => 'no',  // ⚠️ 关键：禁用 Nginx 缓冲
        ]);
    }

    /**
     * 格式化 SSE 事件
     */
    private function sendEvent(string $event, array $data): void
    {
        echo "event: {$event}\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n";
        echo "\n";

        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }
}
```

### 1.2 心跳保活机制

SSE 长连接最怕的是**中间代理超时断开**。Nginx 默认 `proxy_read_timeout` 是 60 秒，如果 60 秒内没有数据推送，连接就会被切断。

解决方案：发送心跳注释行（以 `:` 开头的行会被浏览器忽略，不触发 `onmessage`）：

```php
<?php

namespace App\Services\SSE;

use Illuminate\Support\Facades\Redis;

class SSEConnectionManager
{
    private int $heartbeatInterval;
    private int $timeout;
    private bool $running = true;

    public function __construct(
        int $heartbeatInterval = 15, // 秒
        int $timeout = 300           // 最大连接时长
    ) {
        $this->heartbeatInterval = $heartbeatInterval;
        $this->timeout = $timeout;
    }

    /**
     * 带心跳的 SSE 流
     */
    public function stream(callable $dataCallback, callable $filter = null): void
    {
        $startTime = time();
        $lastHeartbeat = time();

        // 使用 Redis pubsub 非阻塞轮询
        $pubsub = Redis::connection('subscribe')
            ->pubSubLoop();

        while ($this->running) {
            // 超时检查
            if (time() - $startTime >= $this->timeout) {
                $this->sendComment('timeout, reconnecting');
                $this->sendEvent('timeout', ['max_age' => $this->timeout]);
                break;
            }

            // 心跳检查
            if (time() - $lastHeartbeat >= $this->heartbeatInterval) {
                $this->sendComment('heartbeat ' . now()->toIso8601String());
                $lastHeartbeat = time();
            }

            // 非阻塞读取 Redis 消息
            $message = $pubsub->current();
            if ($message) {
                $dataCallback($message);
                $pubsub->next();
            } else {
                // 没有消息，短暂休眠避免 CPU 空转
                usleep(100_000); // 100ms
                $pubsub->next();
            }
        }

        $pubsub->unsubscribe();
    }

    /**
     * 发送 SSE 注释（心跳）
     * 以 `:` 开头的行是注释，浏览器不会触发 onmessage
     */
    private function sendComment(string $text): void
    {
        echo ": {$text}\n\n";
        $this->flush();
    }

    /**
     * 发送 SSE 事件
     */
    public function sendEvent(string $event, array $data, ?string $id = null): void
    {
        if ($id) {
            echo "id: {$id}\n";
        }
        echo "event: {$event}\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n";
        echo "\n";
        $this->flush();
    }

    private function flush(): void
    {
        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }

    public function stop(): void
    {
        $this->running = false;
    }
}
```

### 1.3 Last-Event-ID 断线重连

SSE 协议原生支持 `Last-Event-ID`：浏览器断线后会自动带上这个 header 重连。服务端利用它推送漏掉的消息：

```php
public function stream(Request $request, int $orderId): StreamedResponse
{
    $lastEventId = $request->header('Last-Event-ID');
    $lastEventIdInt = (int) ($lastEventId ?: 0);

    return response()->stream(function () use ($orderId, $lastEventIdInt) {
        $sseManager = new SSEConnectionManager();

        // 如果有 Last-Event-ID，先补发漏掉的事件
        if ($lastEventIdInt > 0) {
            $missedEvents = \App\Models\OrderStatusLog::query()
                ->where('order_id', $orderId)
                ->where('id', '>', $lastEventIdInt)
                ->orderBy('id')
                ->get();

            foreach ($missedEvents as $log) {
                $sseManager->sendEvent('order.status', [
                    'order_id' => $orderId,
                    'status'   => $log->new_status,
                    'updated'  => $log->created_at->toIso8601String(),
                ], (string) $log->id);
            }
        }

        // 订阅后续实时事件
        $channel = "order:status:{$orderId}";
        Redis::subscribe([$channel], function ($message) use ($orderId, $sseManager) {
            $data = json_decode($message, true);
            $sseManager->sendEvent('order.status', $data, $data['event_id'] ?? null);
        });
    }, 200, [
        'Content-Type'         => 'text/event-stream',
        'Cache-Control'        => 'no-cache',
        'X-Accel-Buffering'    => 'no',
    ]);
}
```

事件发布端（订单状态变更时）：

```php
<?php

namespace App\Services\Order;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class OrderStatusPublisher
{
    public function publish(int $orderId, string $status, array $extra = []): void
    {
        $eventId = (string) Str::orderedUuid();

        $payload = array_merge([
            'order_id'  => $orderId,
            'status'    => $status,
            'event_id'  => $eventId,
            'updated'   => now()->toIso8601String(),
        ], $extra);

        Redis::publish("order:status:{$orderId}", json_encode($payload));

        // 同时写入数据库用于断线重连回放
        \App\Models\OrderStatusLog::create([
            'order_id'   => $orderId,
            'new_status' => $status,
            'event_id'   => $eventId,
            'payload'    => $payload,
        ]);
    }
}
```

## 二、前端集成：EventSource API

### 2.1 基础用法

```javascript
// utils/sse.js
export class SSEClient {
  constructor(url, options = {}) {
    this.url = url;
    this.maxRetries = options.maxRetries ?? 10;
    this.retryCount = 0;
    this.handlers = new Map();
  }

  connect() {
    // EventSource 自动带 Cookie，无需额外处理鉴权
    this.eventSource = new EventSource(this.url, {
      withCredentials: true, // 跨域时带上 Cookie
    });

    this.eventSource.onopen = () => {
      console.log('[SSE] Connected');
      this.retryCount = 0;
    };

    // 监听自定义事件
    for (const [event, handler] of this.handlers) {
      this.eventSource.addEventListener(event, handler);
    }

    // 兜底：未命名事件
    this.eventSource.onmessage = (e) => {
      console.log('[SSE] Default message:', e.data);
    };

    this.eventSource.onerror = (e) => {
      console.warn('[SSE] Error, state:', this.eventSource.readyState);

      if (this.eventSource.readyState === EventSource.CLOSED) {
        // 服务端主动关闭，不重连
        console.log('[SSE] Connection closed by server');
        return;
      }

      // EventSource 会自动重连，但我们要监控重试次数
      this.retryCount++;
      if (this.retryCount >= this.maxRetries) {
        console.error('[SSE] Max retries reached, closing');
        this.eventSource.close();
        this.handlers.get('max_retries')?.();
      }
    };
  }

  on(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }

  close() {
    this.eventSource?.close();
  }
}
```

### 2.2 Vue 3 集成示例

```vue
<!-- OrderStatusStream.vue -->
<template>
  <div class="order-status">
    <span :class="statusClass">{{ statusLabel }}</span>
    <span v-if="isConnecting" class="text-gray-400 text-sm">连接中...</span>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { SSEClient } from '@/utils/sse'

const props = defineProps({ orderId: Number })
const status = ref('loading')
const isConnecting = ref(true)

const statusLabel = computed(() => ({
  pending: '待支付',
  paid: '已支付',
  processing: '出票中',
  completed: '出票完成',
  cancelled: '已取消',
}[status.value] || status.value))

let sseClient = null

onMounted(() => {
  sseClient = new SSEClient(`/api/v2/orders/${props.orderId}/stream`)

  sseClient
    .on('order.status', (e) => {
      const data = JSON.parse(e.data)
      status.value = data.status
      isConnecting.value = false
    })
    .on('close', (e) => {
      const data = JSON.parse(e.data)
      console.log('[SSE] Closed:', data.reason)
      sseClient.close()
    })
    .connect()
})

onUnmounted(() => {
  sseClient?.close()
})
</script>
```

## 三、踩坑记录（生产真实问题）

### 坑 1：Nginx 反向代理缓冲了整个响应

**现象**：本地开发正常，部署到 Nginx 后 SSE 事件被攒成一大块才推给浏览器。

**原因**：Nginx 的 `proxy_buffering` 默认开启，它会等后端响应完整后再转发给客户端。SSE 的特性就是"边生成边推送"，缓冲等于废了它。

**解决**：

```nginx
location /api/v2/orders/ {
    # ① 禁用代理缓冲
    proxy_buffering off;

    # ② 禁用 gzip（SSE 数据量小，gzip 反而增加延迟）
    gzip off;

    # ③ 设置合理的超时时间
    proxy_read_timeout 300s;  # SSE 连接最长保持 5 分钟
    proxy_send_timeout 300s;

    proxy_pass http://upstream_laravel;
}
```

或者在 Laravel 端返回 header `X-Accel-Buffering: no`（上面代码已有）。

### 坑 2：PHP-FPM 的 `max_execution_time` 杀死长连接

**现象**：SSE 连接在 60 秒后被断开，日志显示 `Maximum execution time exceeded`。

**原因**：PHP-FPM 默认 `max_execution_time = 60`。SSE 是一个持续运行的 PHP 进程，60 秒后会被杀掉。

**解决**：

```php
// 在 SSE 控制器方法开头
set_time_limit(0);  // 取消执行时间限制

// 或者设置一个合理的值
set_time_limit(300); // 5 分钟
```

同时在 `php.ini` 中：

```ini
; 生产环境 SSE 相关配置
max_execution_time = 0          ; CLI 模式默认不限
request_terminate_timeout = 300 ; FPM worker 最长运行时间
```

### 坑 3：PHP-FPM 进程被占满

**现象**：SSE 连接数一多，API 开始 502。

**原因**：每个 SSE 连接占用一个 PHP-FPM worker 进程。如果你的 FPM 配置是 `pm.max_children = 50`，50 个 SSE 连接就能把 worker 池耗光。

**架构图：问题与解决方案**

```
❌ 问题架构：SSE 直接占用 FPM Worker
┌──────────────────────────────────────────────┐
│                PHP-FPM Pool                   │
│  ┌──────┐ ┌──────┐ ┌──────┐      ┌──────┐   │
│  │Worker│ │Worker│ │Worker│ ...  │Worker│   │
│  │ SSE  │ │ SSE  │ │ SSE  │      │ API  │   │
│  │连接1 │ │连接2 │ │连接3 │      │ 响应 │   │
│  └──────┘ └──────┘ └──────┘      └──────┘   │
│  ↑ 50个 worker，30个被 SSE 长连接占满         │
│  → 剩下 20 个处理 API 请求，502 风险极高      │
└──────────────────────────────────────────────┘

✅ 解决方案：独立 SSE Worker Pool
┌─────────────────────────┐  ┌────────────────────┐
│   API FPM Pool           │  │   SSE FPM Pool      │
│   pm.max_children = 50   │  │   pm.max_children = 20│
│  ┌──────┐┌──────┐┌─────┐│  │  ┌──────┐┌──────┐   │
│  │ API  ││ API  ││ API ││  │  │ SSE  ││ SSE  │   │
│  └──────┘└──────┘└─────┘│  │  └──────┘└──────┘   │
│   处理普通 API 请求       │  │   专门处理 SSE 连接   │
└─────────────────────────┘  └────────────────────┘
         Nginx: location 路由分流
```

Nginx 配置分流：

```nginx
# SSE 专用 upstream
upstream php_sse {
    server 127.0.0.1:9001;  # SSE 专用 FPM pool
}

# 普通 API upstream
upstream php_api {
    server 127.0.0.1:9000;  # 默认 FPM pool
}

server {
    # SSE 端点走专用 pool
    location ~ ^/api/.*/stream$ {
        proxy_pass http://php_sse;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # 其他 API 走默认 pool
    location /api/ {
        proxy_pass http://php_api;
    }
}
```

PHP-FPM 池配置（`www-sse.conf`）：

```ini
[www-sse]
user = www-data
group = www-data
listen = 127.0.0.1:9001
pm = dynamic
pm.max_children = 20
pm.start_servers = 5
pm.min_spare_servers = 3
pm.max_spare_servers = 10
; SSE 关键配置
request_terminate_timeout = 300
```

### 坑 4：HTTPS 环境下 EventSource 跨域失败

**现象**：`EventSource` 连接报错 `SecurityError: Failed to construct 'EventSource'`。

**原因**：HTTPS 页面不能连接 HTTP 的 SSE 端点（Mixed Content 被浏览器拦截）。

**解决**：确保 SSE URL 和页面同协议。如果跨域，需要设置 CORS：

```php
// Laravel 中间件 SSECorsMiddleware
class SSECorsMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        if ($request->is('api/*/stream')) {
            $response = $next($request);
            $response->headers->set('Access-Control-Allow-Origin', 'https://www.kkday.com');
            $response->headers->set('Access-Control-Allow-Credentials', 'true');
            return $response;
        }
        return $next($request);
    }
}
```

### 坑 5：Redis Subscribe 与 Laravel Queue 冲突

**现象**：SSE 连接期间，同进程的 Laravel 事件处理异常。

**原因**：`Redis::subscribe()` 会阻塞当前进程，连接期间这个 PHP 进程无法处理其他逻辑。

**解决**：SSE 控制器中不要用 `Redis::subscribe()`，改用 `Predis` 的非阻塞 `pubSubLoop`：

```php
use Predis\Client;

$predis = new Client([
    'scheme' => 'tcp',
    'host'   => config('database.redis.default.host'),
    'port'   => config('database.redis.default.port'),
]);

$pubsub = $predis->pubSubLoop();
$pubsub->subscribe("order:status:{$orderId}");

foreach ($pubsub as $message) {
    if ($message->kind === 'message') {
        $data = json_decode($message->payload, true);
        $this->sendEvent('order.status', $data);
    }

    // 心跳检查
    if (microtime(true) - $lastHeartbeat > 15) {
        echo ": heartbeat\n\n";
        flush();
        $lastHeartbeat = microtime(true);
    }
}
```

## 四、SSE vs WebSocket vs Long Polling 选型决策树

### 4.1 三种方案全面对比

| 维度 | Long Polling | SSE (Server-Sent Events) | WebSocket |
|------|-------------|-------------------------|-----------|
| 通信方向 | 客户端 → 服务端（轮询） | **单向**（Server → Client） | **双向** |
| 协议 | 普通 HTTP | 普通 HTTP | `ws://` / `wss://` |
| 连接模型 | 短连接，反复建立/断开 | **长连接**，一次握手持续推送 | **长连接**，持久双工通道 |
| 服务端推送 | 模拟（响应后立即重连） | 原生支持，事件流持续推送 | 原生支持 |
| 自动重连 | 需手动实现（JS 定时器） | **浏览器原生支持** | 需手动实现 |
| 断线补发 | 需自建消息队列 | **Last-Event-ID 协议级支持** | 需自行实现 |
| 心跳保活 | 每次请求自带 | 需实现（`:` 注释行） | 需实现（Ping/Pong） |
| Nginx/代理兼容 | ✅ 标准 HTTP | ✅ 标准 HTTP（需禁用缓冲） | ⚠️ 需特殊配置（Upgrade） |
| 浏览器兼容性 | 所有浏览器 | 所有现代浏览器（IE 除外） | 所有现代浏览器 |
| 服务端资源消耗 | **高**（频繁建立连接） | **低**（单连接持续推送） | **中**（需维护有状态连接） |
| 适用场景 | 低频轮询、简单通知 | **通知、进度条、状态推送、日志流** | 聊天、协同编辑、游戏、双向交互 |
| 实现复杂度 | 低 | 中 | 高 |
| 延迟 | 受轮询间隔影响（秒级） | **实时**（毫秒级推送） | **实时**（毫秒级） |

> **选型口诀**：单向推送选 SSE，双向交互选 WebSocket，简单场景用 Long Polling。SSE 在 B2C 电商场景（订单状态、库存变更、任务进度）中性价比最高——无需 WebSocket 的复杂基础设施，却能获得接近实时的推送体验。

### 4.2 决策流程图

```
你的场景需要客户端 → 服务器的通信吗？
├── 是 → WebSocket（聊天、协同编辑、游戏）
└── 否 → 推送频率有多高？
    ├── 每秒多次 → WebSocket（避免 HTTP 开销）
    ├── 每秒 1 次 ~ 每分钟数次 → SSE ✅
    └── 每分钟 < 1 次 → 短轮询也行，SSE 也行
        └── 需要断线自动补发？ → SSE ✅（Last-Event-ID）
```

## 五、实际效果数据

在 KKday B2C API 项目中部署 SSE 后的指标：

| 指标 | 优化前（Polling） | 优化后（SSE） |
|------|-------------------|---------------|
| API 请求量（订单状态查询） | 1200 req/min | **接近 0**（仅 SSE 连接） |
| 用户感知延迟 | 5~10 秒（轮询间隔） | **< 1 秒** |
| 服务器带宽 | 高（每次轮询返回完整 JSON） | 低（仅推送变更数据） |
| 代码复杂度 | 简单 | 中等 |

## 六、完整路由与中间件配置

```php
// routes/api.php
Route::prefix('v2/orders/{orderId}')->group(function () {
    Route::get('/stream', [OrderStreamController::class, 'stream'])
        ->middleware(['auth:sanctum', 'throttle:10,1']); // 每分钟最多 10 次连接
});

// app/Http/Kernel.php - SSE 专用中间件组
'sse' => [
    \App\Http\Middleware\SSECorsMiddleware::class,
    \App\Http\Middleware\SSEKeepAlive::class,  // 注入心跳
],
```

## 总结

SSE 是"单向推送"场景的最佳选择——比 WebSocket 简单，比 Polling 高效。在 Laravel B2C API 中，它特别适合：

- ✅ 订单状态实时推送
- ✅ 后台任务进度条
- ✅ 库存变更通知
- ✅ 管理后台实时数据面板

核心注意事项：

1. **Nginx 必须禁用缓冲**（`proxy_buffering off` 或 `X-Accel-Buffering: no`）
2. **PHP 必须取消执行时间限制**（`set_time_limit(0)`）
3. **独立 FPM Pool** 避免 SSE 长连接耗尽 API worker
4. **实现心跳保活**防止代理超时断开
5. **Last-Event-ID + 事件日志表**保证断线不丢消息

如果你的场景是双向通信（聊天、协同编辑），请用 WebSocket（Laravel Reverb / Pusher）。如果是单向推送，SSE 就够了。

## 相关阅读

- [SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案的工程选型](/categories/架构/2026-06-03-SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型/)
- [Long Polling vs SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案对比](/categories/架构/Long-Polling-vs-SSE-vs-WebSocket-vs-HTTP-Streaming-实战-实时通信方案对比/)
- [Laravel Echo 2.x 实战：Reverb + Presence Channel 在 B2C 电商中的在线客服与协同编辑](/categories/前端/Laravel-Echo-2x-Reverb-Presence-Channel-B2C在线客服与协同编辑/)
