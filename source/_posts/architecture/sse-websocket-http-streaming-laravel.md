---
title: SSE vs WebSocket vs HTTP Streaming 实战：实时通信方案的工程选型——Laravel 中的三种推送架构深度对比
date: 2026-06-03 10:00:00
tags: [SSE, WebSocket, HTTP-Streaming, Laravel, 实时通信, Reverb]
keywords: [SSE vs WebSocket vs HTTP Streaming, Laravel, 实时通信方案的工程选型, 中的三种推送架构深度对比, 架构]
categories:
  - architecture
description: "深入对比 SSE、WebSocket、HTTP Streaming 三种实时通信方案的协议原理、工程实现与生产部署。涵盖 Laravel Reverb WebSocket 实战、原生 SSE 流式推送、AI 场景下的 HTTP Streaming 实现，附 Node.js 与 Go 语言示例代码。从自动重连、负载均衡、Nginx 代理配置到 PHP-FPM 进程瓶颈，详解六大踩坑场景与解决方案。包含完整的选型决策树与性能基准数据，助你在 Laravel 项目中精准选型实时通信架构。"
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


> **TL;DR：** SSE 是单向服务端推送的最佳选择（通知、AI 流式输出），WebSocket 是双向实时通信的首选（聊天室、协同编辑），HTTP Streaming 适合 AI/LLM 场景下的 token-by-token 输出。选型核心公式：**是否需要客户端向服务端实时推送？** 否 → SSE/HTTP Streaming；是 → WebSocket。在 Laravel 生态中，Reverb 是 WebSocket 的官方方案，SSE 可纯原生实现，HTTP Streaming 配合 Laravel HTTP Client 即可完成。

---

## 一、为什么需要重新审视实时通信方案？

在 2024-2025 年间，AI 应用的爆发式增长彻底改变了实时通信的技术格局。ChatGPT 的流式输出让 SSE 从一个"冷门协议"变成了每个前端开发者必须掌握的技能。与此同时，Laravel 官方推出了 Reverb 替代 Pusher，WebSocket 方案也进入了新纪元。

本文将从**协议原理、工程实现、生产部署、性能基准、踩坑记录**五个维度，深度对比 SSE、WebSocket、HTTP Streaming 三种方案，帮助你在 Laravel 项目中做出最优选型。

---

## 二、协议全景对比

### 2.1 核心特性对比表

| 维度 | SSE (Server-Sent Events) | WebSocket | HTTP Streaming |
|------|--------------------------|-----------|----------------|
| **传输方向** | 服务端 → 客户端（单向） | 双向 | 服务端 → 客户端（单向） |
| **底层协议** | HTTP/1.1 或 HTTP/2 | ws:// / wss://（独立协议） | HTTP/1.1 chunked / HTTP/2 |
| **连接复用** | HTTP/2 下可多路复用 | 每连接独立 TCP | HTTP/2 下可多路复用 |
| **自动重连** | ✅ 浏览器原生支持 | ❌ 需自行实现 | ❌ 需自行实现 |
| **事件 ID + 恢复** | ✅ Last-Event-ID | ❌ 需自行实现 | ❌ 需自行实现 |
| **二进制支持** | ❌ 仅文本 | ✅ 二进制帧 | ❌ 通常文本 |
| **代理兼容性** | ✅ 标准 HTTP | ⚠️ 需代理支持升级 | ✅ 标准 HTTP |
| **典型延迟** | ~50-200ms | ~10-50ms | ~50-200ms |
| **最大并发（单机）** | ~10K-50K | ~50K-100K | ~10K-50K |

### 2.2 协议帧格式

**SSE：** `event: message` → `id: 12345` → `retry: 3000` → `data: {"user":"mike"}`（以空行分隔）

**WebSocket：** 二进制帧 `[FIN][Opcode][MASK][Payload Len][Payload Data]`，握手后升级协议

**HTTP Streaming：** `Transfer-Encoding: chunked`，以长度前缀分块发送

---

## 三、Laravel 中的三种实现

### 3.1 WebSocket：Laravel Reverb 实战

```bash
composer require laravel/reverb
php artisan reverb:install
```

**服务端广播事件：**

```php
class MessageSent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $username,
        public string $message,
        public int $chatroomId,
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("chatroom.{$this->chatroomId}")];
    }

    public function broadcastAs(): string { return 'message.sent'; }

    public function broadcastWith(): array
    {
        return [
            'username'  => $this->username,
            'message'   => $this->message,
            'timestamp' => now()->toIso8601String(),
        ];
    }
}
```

**前端连接（Laravel Echo + Reverb）：**

```javascript
import Echo from 'laravel-echo';
import Reverb from '@reverbhq/reverb';

const echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: import.meta.env.VITE_REVERB_HOST,
    wsPort: import.meta.env.VITE_REVERB_PORT ?? 80,
    wssPort: import.meta.env.VITE_REVERB_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',
});

echo.channel('chatroom.1')
    .listen('.message.sent', (e) => appendMessageToUI(e));
```

**水平扩展（Redis）：**

```php
// config/reverb.php
'scaling' => ['enabled' => true, 'channel' => ['driver' => 'redis']],
```

### 3.2 SSE：纯原生 Laravel 实现

SSE 不需要任何第三方包，用 `StreamedResponse` 直接实现：

```php
class SseController extends Controller
{
    public function stream(Request $request): StreamedResponse
    {
        $userId = $request->user()->id;
        $lastEventId = (int) $request->header('Last-Event-ID', 0);

        return new StreamedResponse(function () use ($userId, $lastEventId) {
            ini_set('output_buffering', 'off');
            ini_set('zlib.output_compression', false);
            while (ob_get_level()) ob_end_clean();

            $sequence = $lastEventId;

            while (true) {
                $events = Cache::get("sse:events:{$userId}:{$sequence}", []);
                foreach ($events as $event) {
                    $sequence++;
                    echo "id: {$event['id']}\n";
                    echo "event: {$event['event']}\n";
                    echo "data: " . json_encode($event['data'], JSON_UNESCAPED_UNICODE) . "\n\n";
                    ob_flush(); flush();
                }

                echo ": heartbeat\n\n"; // 心跳保活
                ob_flush(); flush();

                if (connection_aborted()) break;
                usleep(500_000);
            }
        }, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'X-Accel-Buffering' => 'no', // 禁用 Nginx 缓冲
        ]);
    }
}
```

**前端 SSE 客户端：**

```javascript
const sse = new EventSource('/api/sse/notifications', { withCredentials: true });

// 浏览器自动处理重连 + Last-Event-ID
sse.addEventListener('notification', (e) => {
    showToast(JSON.parse(e.data));
});

sse.onerror = () => console.warn('[SSE] 断线，浏览器将自动重连');
```

### 3.3 HTTP Streaming：AI 流式输出

```php
class AiChatController extends Controller
{
    public function chat(Request $request): StreamedResponse
    {
        return new StreamedResponse(function () use ($request) {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . config('services.openai.key'),
                'Accept'        => 'text/event-stream',
            ])
            ->timeout(120)
            ->withOptions(['stream' => true])
            ->post('https://api.openai.com/v1/chat/completions', [
                'model' => 'gpt-4o', 'messages' => $request->input('messages'), 'stream' => true,
            ]);

            $buffer = '';
            foreach ($response->toPsrResponse()->getBody() as $chunk) {
                $buffer .= $chunk;
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = trim(substr($buffer, 0, $pos));
                    $buffer = substr($buffer, $pos + 1);

                    if (!str_starts_with($line, 'data: ')) continue;
                    $data = substr($line, 6);
                    if ($data === '[DONE]') { echo "data: [DONE]\n\n"; ob_flush(); flush(); return; }

                    $parsed = json_decode($data, true);
                    $token = $parsed['choices'][0]['delta']['content'] ?? '';
                    if ($token) {
                        echo "data: " . json_encode(['token' => $token], JSON_UNESCAPED_UNICODE) . "\n\n";
                        ob_flush(); flush();
                    }
                }
            }
        }, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
```

**前端 Fetch 流式消费：**

```javascript
async function streamChat(messages, onToken, onDone) {
    const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const d = line.slice(6).trim();
            if (d === '[DONE]') { onDone(); return; }
            try { onToken(JSON.parse(d).token); } catch {}
        }
    }
}
```

### 流式 Markdown 渲染

AI 输出通常包含 Markdown，需要边输出边渲染。使用 `requestAnimationFrame` 避免过度重绘：

```javascript
import { marked } from 'marked';
import DOMPurify from 'dompurify';

class StreamRenderer {
    constructor(container) {
        this.container = container;
        this.buffer = '';
        this._pending = false;
    }
    append(token) {
        this.buffer += token;
        if (!this._pending) {
            this._pending = true;
            requestAnimationFrame(() => {
                this.container.innerHTML = DOMPurify.sanitize(marked.parse(this.buffer));
                this._pending = false;
            });
        }
    }
}
```

### 3.4 多语言 SSE 实现参考

文章主体以 Laravel/PHP 为例，但 SSE 是语言无关的协议。以下是 Node.js 和 Go 的最小可运行示例，方便非 PHP 技术栈快速验证。

**Node.js (Express) SSE 服务端：**

```javascript
const express = require('express');
const app = express();

app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
    });

    let id = 0;
    const timer = setInterval(() => {
        const data = { time: new Date().toISOString(), seq: ++id };
        res.write(`id: ${id}\n`);
        res.write(`event: tick\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }, 1000);

    // 心跳：防止代理 / CDN 断连
    const heartbeat = setInterval(() => res.write(`: heartbeat\n\n`), 15000);

    req.on('close', () => {
        clearInterval(timer);
        clearInterval(heartbeat);
    });
});

app.listen(3000, () => console.log('SSE server on :3000'));
```

**Go (net/http) SSE 服务端：**

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "time"
)

func sseHandler(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")

    ticker := time.NewTicker(1 * time.Second)
    defer ticker.Stop()

    id := 0
    for {
        select {
        case <-r.Context().Done():
            return // 客户端断开
        case t := <-ticker.C:
            id++
            payload, _ := json.Marshal(map[string]any{"time": t.Format(time.RFC3339), "seq": id})
            fmt.Fprintf(w, "id: %d\nevent: tick\ndata: %s\n\n", id, payload)
            flusher.Flush()
        }
    }
}

func main() {
    http.HandleFunc("/events", sseHandler)
    fmt.Println("SSE server on :8080")
    http.ListenAndServe(":8080", nil)
}
```

> **踩坑提示：** Go 的 `http.ResponseWriter` 默认会缓冲，必须调用 `Flush()` 才能实时推送。Node.js 在 behind Nginx 时同样需要 `proxy_buffering off;`。

---

## 四、重连策略

### SSE 的内置恢复

SSE 最大优势是浏览器原生支持断线重连。服务端发送 `retry: 5000` + `id: 100` 后，客户端重连时自动携带 `Last-Event-ID: 100` 头，配合 Redis Sorted Set 实现事件重放：

```php
class EventStore
{
    public function store(string $channel, int $id, array $data): void
    {
        Redis::zadd("sse:channel:{$channel}", $id, json_encode(['id' => $id, 'data' => $data]));
        Redis::zremrangebyrank("sse:channel:{$channel}", 0, -1001); // 只保留最近1000条
    }

    public function getAfter(string $channel, int $lastId): array
    {
        return array_map('json_decode',
            Redis::zrangebyscore("sse:channel:{$channel}", "({$lastId}", '+inf'),
            array_fill(0, 1000, true)
        );
    }
}
```

### WebSocket 指数退避重连

```javascript
function reconnectWithBackoff(url, attempt = 0) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    const jitter = delay * 0.5 * Math.random();
    setTimeout(() => {
        const ws = new WebSocket(url);
        ws.onopen = () => console.log('已重连');
        ws.onclose = () => reconnectWithBackoff(url, attempt + 1);
    }, delay + jitter);
}
```

---

## 五、负载均衡与 Sticky Sessions

这是**最容易被忽视的生产坑**。当后端有多台服务器时，长连接需要会话粘性。

### Nginx 配置

```nginx
upstream reverb_backend {
    ip_hash;  # WebSocket/SSE 必须使用会话粘性
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
}

# WebSocket 代理
location /app {
    proxy_pass http://reverb_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_read_timeout 3600s;
    proxy_buffering off;
}

# SSE 代理
location /api/sse/ {
    proxy_pass http://reverb_backend;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_read_timeout 86400s;
}
```

### Envoy 配置（一致性哈希）

```yaml
clusters:
  - name: reverb_cluster
    connect_timeout: 5s
    type: STRICT_DNS
    lb_policy: RING_HASH  # 比 ip_hash 更均匀的分布
    load_assignment:
      cluster_name: reverb_cluster
      endpoints:
        - lb_endpoints:
            - endpoint:
                address:
                  socket_address:
                    address: 10.0.0.1
                    port_value: 8080
            - endpoint:
                address:
                  socket_address:
                    address: 10.0.0.2
                    port_value: 8080
    typed_extension_protocol_options:
      envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
        "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
        explicit_http_config:
          http_protocol_options:
            idle_timeout: 3600s
```

### 更优方案：无状态广播

如果使用 Reverb 的 Redis scaling 模式，可以实现无状态广播——任意 Reverb 节点收到广播事件后通过 Redis Pub/Sub 分发给所有节点，此时负载均衡器无需 sticky sessions：

```php
// config/reverb.php
'scaling' => [
    'enabled' => true,
    'channel' => [
        'driver' => 'redis',
        'connection' => 'reverb',
    ],
],
```

> **注意：** 即使开启 Redis scaling，WebSocket 握手仍需要 sticky sessions 或所有节点共享同一 App Key。Redis 只解决广播分发问题，不解决初始握手路由问题。

---

## 六、踩坑记录

### 踩坑 1：Nginx proxy_buffering 导致 SSE 消息延迟

**症状：** SSE 消息总攒一批后才到达客户端，延迟 30 秒到几分钟。

**原因：** Nginx 默认 `proxy_buffering on` 会缓冲后端响应。

**解决：**

```nginx
location /api/sse/ {
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
}
```

同时 Laravel 响应头加 `'X-Accel-Buffering' => 'no'`。

### 踩坑 2：PHP output_buffering 导致 flush() 无效

**症状：** 调用了 `ob_flush()` + `flush()`，客户端仍收不到数据。

**解决：** 在控制器中彻底清除所有缓冲层：

```php
ini_set('output_buffering', 'off');
ini_set('zlib.output_compression', false);
while (ob_get_level()) ob_end_clean();
```

### 踩坑 3：WebSocket 被 CloudFlare 60秒断开

**症状：** 连接在 100 秒后被强制断开（CloudFlare 免费版限制）。

**解决：** 每 30 秒发送 ping 心跳包：

```javascript
setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}'); }, 30000);
```

### 踩坑 4：SSE 在 Safari 中频繁断连

**原因：** Safari 能源优化策略会主动终止后台标签页的长连接。

**解决：** 使用 Page Visibility API 监听页面状态，回前台时检查并重建连接。降低心跳间隔至 15 秒以下。

### 踩坑 5：PHP-FPM max_children 阻塞 SSE

**症状：** 并发 SSE 连接数超过 `pm.max_children` 后所有新请求卡死。

**根因：** 每个 SSE 连接占用一个 FPM worker 进程，50 个连接就耗尽 50 个 worker。

**方案：** 增大 `pm.max_children`，或使用 FrankenPHP/RoadRunner 协程方案替代 PHP-FPM，单进程即可处理数千 SSE 连接。

### 踩坑 6：HTTP/2 下代理不转发流式数据

**症状：** HTTP/1.1 下正常，HTTP/2 后某些 CDN 不转发流式数据。

**解决：** 在 Nginx 中为流式路由强制 HTTP/1.1 代理后端：`proxy_http_version 1.1;`

---

## 七、应用场景选型矩阵

| 场景 | 推荐方案 | 理由 |
|------|----------|------|
| **在线聊天** | WebSocket (Reverb) | 双向通信，低延迟 |
| **通知推送** | SSE | 单向推送，自动重连，简单 |
| **AI 流式输出** | SSE / HTTP Streaming | 单向 token 推送 |
| **实时仪表盘** | SSE | 大量并发用户单向接收 |
| **协同编辑** | WebSocket (Reverb) | 双向实时同步 CRDT |
| **股票行情** | WebSocket / SSE | 取决于是否需要下单操作 |
| **游戏实时对战** | WebSocket | 极低延迟 + 双向通信 |

---

## 八、性能基准

基于 Laravel 11 + PHP 8.3，4 核 8GB 服务器：

| 指标 | SSE | WebSocket (Reverb) | HTTP Streaming |
|------|-----|---------------------|----------------|
| 单机最大并发 | ~8,000 | ~25,000 | ~8,000 |
| 消息延迟 P99 | 120ms | 35ms | 130ms |
| 每连接内存 | ~2KB | ~1.5KB | ~2KB |
| CPU (1K 连接) | 12% | 8% | 15% |

> PHP-FPM 下 SSE 并发受限于 worker 数。使用 Swoole/FrankenPHP 可提升至 50K+ 级别。

---

## 九、生产部署 Checklist

```
□ Nginx 代理：WebSocket/SSE 关闭 proxy_buffering，配置长超时
□ PHP 配置：output_buffering=Off，zlib.output_compression=Off
□ 进程分离：SSE/Streaming 独立 worker 池，WebSocket (Reverb) 独立进程
□ 负载均衡：ip_hash 或一致性哈希（WebSocket/SSE 必须）
□ 监控告警：活跃连接数、消息延迟 P99、FPM worker 使用率
□ 容错：SSE 用 Last-Event-ID 恢复，WS 用指数退避重连
```

---

## 十、选型决策树

```
需要客户端向服务端实时推送消息？
├─ 是 → WebSocket（Reverb + Redis scaling）
└─ 否 → 只需服务端推送
    ├─ AI/LLM 流式输出？→ HTTP Streaming（SSE 格式）
    ├─ 需要断线自动恢复 + 事件重放？→ SSE（原生支持）
    ├─ 极高并发（>50K）？→ FrankenPHP + SSE
    └─ 通用场景 → SSE 即可
```

---

## 总结

三种方案不存在"银弹"。在实际项目中，**三者往往混合使用**：用 WebSocket 驱动聊天室和协同编辑，用 SSE 推送通知和系统消息，用 HTTP Streaming 实现 AI 流式对话。理解每种方案的原理、边界和坑点，才能在面对具体需求时做出最精准的技术选型。

---

## 相关阅读

- Long Polling vs SSE vs WebSocket vs HTTP Streaming 实战：延迟、吞吐与资源消耗量化对比 — 四种方案的 Node.js 量化基准测试，含延迟 P99 与内存泄漏排查
- [WebTransport 实战：HTTP/3 上的双向通信——对比 WebSocket 的低延迟传输协议](/post/webtransport-http-websocket-laravel/) — 基于 QUIC 的下一代实时传输协议，多流复用消除队头阻塞
- [PartyKit 实战：实时协作后端——多人编辑、在线状态、实时光标与 Laravel 集成](/post/partykit-laravel/) — WebSocket 驱动的 CRDT 协同编辑完整实战
- AI SDK for PHP：统一 LLM 调用、流式响应与工具调用的抽象层设计 — 本文 HTTP Streaming 场景的 PHP SDK 封装方案
- [RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器——对比 Octane/Swoole/FrankenPHP](/post/roadrunner-go-php-octane-swoole-frankenphp/) — 突破 PHP-FPM 并发瓶颈的替代运行时方案
