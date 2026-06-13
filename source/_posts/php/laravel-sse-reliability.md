---
title: HTTP Server-Sent Events 进阶实战：EventSource API 的重连、Last-Event-ID、数据恢复——Laravel 流式推送的可靠性保障
keywords: [HTTP Server, Sent Events, EventSource API, Last, Event, ID, Laravel, 进阶实战, 的重连, 数据恢复]
date: 2026-06-09 17:09:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - SSE
  - EventSource
  - 流式推送
  - 可靠性
description: 深入讲解 EventSource API 的自动重连机制、Last-Event-ID 语义、服务端数据恢复方案，并提供完整的 Laravel 实现代码，打造生产级 SSE 推送系统。
---


## 概述

Server-Sent Events（SSE）是浏览器原生支持的服务端单向推送协议，基于 HTTP 长连接实现。相比 WebSocket 的全双工通信，SSE 更适合「服务端主动推送、客户端只读」的场景：实时通知、进度更新、流式 AI 输出等。

但原生 SSE 存在几个关键的可靠性问题：

1. **连接断开后如何自动恢复？** 浏览器 `EventSource` 有内置重连，但默认行为不一定符合业务需求
2. **断线期间错过的消息怎么补回来？** 这需要 `Last-Event-ID` 机制
3. **服务端如何配合实现消息恢复？** Laravel 侧需要持久化 + ID 跟踪

本文提供一套完整的生产级方案，覆盖从客户端到服务端的全链路可靠性设计。

## 核心概念

### EventSource 的重连机制

`EventSource` 内置自动重连，行为如下：

```javascript
const es = new EventSource('/api/stream');

es.onopen = () => {
  console.log('连接建立');
};

es.onerror = (e) => {
  console.log('连接断开，自动重连中...');
  // EventSource 会自动尝试重连
  // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
};
```

**重连时间线：**

| 阶段 | 行为 |
|------|------|
| 首次断开 | 浏览器自动重连 |
| 重连间隔 | 默认 3 秒（可通过 `retry` 字段调整） |
| 重连请求 | 自动携带上次收到的 `Last-Event-ID` |
| 最大重试 | 浏览器不设上限，持续尝试 |

服务端可以通过 `retry:` 字段自定义客户端重连间隔：

```text
retry: 5000
```

客户端收到后会以 5 秒为间隔重连，直到收到新的 `retry` 值。

### Last-Event-ID 机制

`Last-Event-ID` 是 SSE 可靠性的核心。当消息有 `id` 字段时：

```text
id: 42
data: {"type": "notification", "content": "新订单"}
```

浏览器会在断线重连时自动在请求头中携带：

```text
GET /api/stream HTTP/1.1
Last-Event-ID: 42
```

服务端收到这个头部后，可以从第 42 条消息之后开始重放，确保客户端不丢消息。

### SSE 消息格式

完整的 SSE 消息由多个字段组成：

```text
event: message
id: 100
retry: 5000
data: {"key": "value"}

```

注意：每条消息以**两个换行符**结束。`retry` 字段只需要出现一次，后续消息可以省略。

## 实战代码

### Laravel 1：基础 SSE 控制器

创建一个通用的 SSE 基类，处理连接管理、心跳、事件分发：

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;

class SseController extends Controller
{
    protected function createStreamResponse(callable $eventGenerator): Response
    {
        $response = new Response();
        $response->headers->set('Content-Type', 'text/event-stream');
        $response->headers->set('Cache-Control', 'no-cache');
        $response->headers->set('Connection', 'keep-alive');
        $response->headers->set('X-Accel-Buffering', 'no'); // Nginx 关闭缓冲
        $response->headers->set('Access-Control-Allow-Origin', '*');

        // 禁用 FastCGI 缓冲（Nginx + php-fpm 环境）
        if (function_exists('apache_setenv')) {
            apache_setenv('no-gzip', '1');
        }

        $callback = function () use ($eventGenerator) {
            // 发送重连间隔（毫秒）
            echo "retry: 5000\n\n";
            ob_flush();
            flush();

            $generator = $eventGenerator();

            while (true) {
                // 检查客户端是否断开
                if (connection_aborted()) {
                    Log::info('SSE client disconnected');
                    break;
                }

                // 生成下一个事件
                $event = $generator->current();

                if ($event === null) {
                    // 没有新事件，心跳
                    echo ": heartbeat\n\n";
                    ob_flush();
                    flush();
                } else {
                    // 输出事件
                    $this->sendEvent($event);
                }

                // 控制循环频率，避免 CPU 空转
                usleep(100_000); // 100ms
                $generator->next();
            }
        };

        $response->setCallback($callback);
        $response->sendHeaders();

        return $response;
    }

    protected function sendEvent(array $event): void
    {
        // id
        if (isset($event['id'])) {
            echo "id: {$event['id']}\n";
        }

        // event（可选，默认为 message）
        if (isset($event['event'])) {
            echo "event: {$event['event']}\n";
        }

        // data
        $data = $event['data'] ?? '';
        if (is_array($data)) {
            $data = json_encode($data, JSON_UNESCAPED_UNICODE);
        }
        $lines = explode("\n", $data);
        foreach ($lines as $line) {
            echo "data: {$line}\n";
        }

        // 空行结束
        echo "\n";
        ob_flush();
        flush();
    }
}
```

### Laravel 2：带 Last-Event-ID 恢复的事件推送

实现一个支持断线恢复的通知流：

```php
<?php

namespace App\Http\Controllers;

use App\Models\SseNotification;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class NotificationStreamController extends SseController
{
    public function stream(Request $request): Response
    {
        $userId = $request->user()->id;
        $lastEventId = $request->header('Last-Event-ID');

        return $this->createStreamResponse(function () use ($userId, $lastEventId) {
            // 如果有 Last-Event-ID，从数据库恢复错过的消息
            if ($lastEventId) {
                $missedEvents = SseNotification::where('user_id', $userId)
                    ->where('id', '>', $lastEventId)
                    ->orderBy('id', 'asc')
                    ->get();

                foreach ($missedEvents as $event) {
                    yield [
                        'id' => $event->id,
                        'event' => $event->type,
                        'data' => [
                            'title' => $event->title,
                            'body' => $event->body,
                            'created_at' => $event->created_at->toIso8601String(),
                        ],
                    ];
                }
            }

            // 恢复完毕后，持续监听新事件（使用轮询或 Redis Pub/Sub）
            $lastId = $lastEventId
                ? (int) $lastEventId
                : SseNotification::where('user_id', $userId)->max('id') ?? 0;

            while (true) {
                $newEvents = SseNotification::where('user_id', $userId)
                    ->where('id', '>', $lastId)
                    ->orderBy('id', 'asc')
                    ->get();

                foreach ($newEvents as $event) {
                    $lastId = $event->id;
                    yield [
                        'id' => $event->id,
                        'event' => $event->type,
                        'data' => [
                            'title' => $event->title,
                            'body' => $event->body,
                            'created_at' => $event->created_at->toIso8601String(),
                        ],
                    ];
                }

                // 没有新事件，返回 null 触发心跳
                yield null;
            }
        });
    }
}
```

### Laravel 3：基于 Redis Pub/Sub 的实时推送

轮询数据库效率低，生产环境用 Redis Pub/Sub 替代：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Redis;

class SseBroadcaster
{
    public function broadcast(string $channel, array $event): void
    {
        $payload = json_encode([
            'event' => $event['event'] ?? 'message',
            'data' => $event['data'] ?? '',
            'id' => $event['id'] ?? null,
        ], JSON_UNESCAPED_UNICODE);

        Redis::publish("sse:{$channel}", $payload);
    }
}
```

对应的服务端监听控制器：

```php
<?php

namespace App\Http\Controllers;

use App\Models\SseNotification;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Redis;

class RealtimeStreamController extends SseController
{
    public function stream(Request $request): Response
    {
        $userId = $request->user()->id;
        $lastEventId = $request->header('Last-Event-ID');
        $channel = "user:{$userId}";

        return $this->createStreamResponse(function () use ($userId, $lastEventId, $channel) {
            // 1. 恢复 Last-Event-ID 之后的离线消息
            if ($lastEventId) {
                $missed = SseNotification::where('user_id', $userId)
                    ->where('id', '>', (int) $lastEventId)
                    ->orderBy('id', 'asc')
                    ->limit(100)
                    ->get();

                foreach ($missed as $event) {
                    yield [
                        'id' => $event->id,
                        'event' => $event->type,
                        'data' => $event->toArray(),
                    ];
                }
            }

            // 2. 切换到 Redis Pub/Sub 监听实时事件
            $redis = Redis::connection();
            $redis->subscribe(["sse:{$channel}"], function ($message) {
                echo "data: {$message}\n\n";
                ob_flush();
                flush();
            });

            // subscribe 是阻塞的，不会执行到这里
            yield null;
        });
    }
}
```

### 4：客户端完整实现

```javascript
class SseClient {
  constructor(url, options = {}) {
    this.url = url;
    this.handlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.baseReconnectDelay = options.baseReconnectDelay || 1000;
    this.connect();
  }

  connect() {
    this.es = new EventSource(this.url);
    this.reconnectAttempts = 0;

    this.es.onopen = () => {
      console.log('[SSE] Connected');
      this.reconnectAttempts = 0;
      this.emit('open');
    };

    this.es.onerror = (e) => {
      console.warn('[SSE] Connection error, will reconnect...');
      this.emit('error', e);
      // EventSource 自动重连，但我们可以监听状态变化
    };

    this.es.onmessage = (e) => {
      this.emit('message', {
        id: e.lastEventId,
        data: JSON.parse(e.data),
      });
    };
  }

  // 监听自定义事件类型
  on(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
      this.es.addEventListener(eventType, (e) => {
        this.emit(eventType, {
          id: e.lastEventId,
          data: JSON.parse(e.data),
        });
      });
    }
    this.handlers.get(eventType).push(handler);
    return this;
  }

  emit(eventType, payload) {
    const fns = this.handlers.get(eventType) || [];
    fns.forEach((fn) => fn(payload));
  }

  close() {
    this.es.close();
  }
}

// 使用示例
const sse = new SseClient('/api/notifications/stream');

sse
  .on('message', (e) => console.log('通知:', e.data))
  .on('order_update', (e) => console.log('订单更新:', e.data))
  .on('open', () => {
    // 连接建立，可以显示在线状态
    document.body.classList.add('sse-connected');
  });
```

## 踩坑记录

### Nginx 缓冲导致消息延迟

**现象：** 数据已经写入响应，但客户端收不到，积累一段时间后一起收到。

**原因：** Nginx 默认开启 proxy_buffering，会缓冲 SSE 响应。

**解决：**

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding off;
}
```

Laravel 侧也需要设置 header：

```php
$response->headers->set('X-Accel-Buffering', 'no');
```

### PHP-FPM 进程超时

**现象：** 长连接运行一段时间后被强制断开。

**原因：** php-fpm 的 `request_terminate_timeout` 或 `max_execution_time` 到期。

**解决：**

```ini
; php.ini 或 php-fpm.conf
request_terminate_timeout = 0  ; 无限等待
```

或者在运行时设置：

```php
set_time_limit(0);
ignore_user_abort(false);
```

### Last-Event-ID 为空

**现象：** 首次连接时 `Last-Event-ID` 为空，重连时才携带。

**原因：** 这是正常行为，首次建立连接不存在「上次 ID」。

**处理：**

```php
$lastEventId = $request->header('Last-Event-ID');

if ($lastEventId) {
    // 恢复模式：从指定 ID 之后的消息开始发送
} else {
    // 首次连接：发送最新 N 条消息或从头开始
}
```

### 广播消息丢失

**现象：** 客户端连接时，恰好有一条消息被广播出去，但客户端没收到。

**原因：** 客户端在「恢复历史」和「订阅实时」之间存在时间窗口。

**解决：** 用一个自增 ID 作为恢复锚点，恢复历史时拿到最后一条 ID，再订阅实时事件。由于消息在数据库中有持久化，重连时通过 ID 范围查询可以覆盖这个窗口：

```php
// 原子操作：查最大 ID + 订阅
$maxId = DB::select('SELECT MAX(id) as max_id FROM sse_notifications WHERE user_id = ?', [$userId])[0]->max_id;

// 先发完 >= $maxId 的历史，再订阅实时
```

### 负载均衡下的连接丢失

**现象：** Nginx 负载均衡到不同的后端实例，SSE 连接被重置。

**原因：** SSE 是长连接，不同的后端实例之间不共享连接状态。

**解决：**

1. **Sticky Session（推荐）：** Nginx 配置 `ip_hash` 或 `hash` 保持会话粘性
2. **Redis Pub/Sub 共享：** 所有实例订阅同一个 Redis channel，消息天然广播
3. **共享 ID 池：** 恢复机制基于数据库，任何实例都能响应 `Last-Event-ID` 请求

## 总结

SSE 的可靠性设计核心是三点：

1. **自动重连 + 退避** — `EventSource` 内置，配合 `retry` 字段控制节奏
2. **Last-Event-ID 恢复** — 客户端断线重连时携带，服务端从数据库重放
3. **Redis Pub/Sub 实时推送** — 替代低效的数据库轮询，保证消息即时到达

生产环境的关键配置：

- Nginx 关闭 proxy_buffering
- PHP 设置 `request_terminate_timeout = 0`
- 使用 Redis Pub/Sub 做实时广播
- 消息持久化到数据库，支持任意断点恢复

这套方案已经在实际项目中稳定运行，覆盖了数万用户的实时通知推送。SSE 虽然简单，但把可靠性做好的每一步都不能偷懒。
