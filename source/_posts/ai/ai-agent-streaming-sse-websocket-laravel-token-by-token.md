---

title: AI Agent Streaming 实战：SSE/WebSocket 实时流式响应——Laravel 后端的 Token-by-Token 推送与前端渲染
keywords: [AI Agent Streaming, SSE, WebSocket, Laravel, Token, 实时流式响应, 后端的, 推送与前端渲染]
date: 2026-06-03 09:00:00
tags:
- AI Agent
- Streaming
- SSE
- WebSocket
- Laravel
- LLM
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 深入实战 AI Agent 流式响应系统：对比 SSE 与 WebSocket 方案选型，完整实现 Laravel 后端的 Token-by-Token 推送，涵盖 OpenAI 流式 API 调用、Tool Calling 链式执行、React/Vue 前端实时渲染、Nginx 缓冲踩坑、Swoole 协程高性能方案，以及 9 个生产环境常见问题与解决方案。
---




> **TL;DR：** AI Agent 的流式响应是现代 LLM 应用的核心体验——用户不想等待 30 秒看到完整回复，而是希望像 ChatGPT 那样逐字"打字"般看到内容实时生成。本文将从 **SSE vs WebSocket 选型** 出发，完整实现 **Laravel 后端** 的两种流式推送方案，涵盖 **OpenAI API 流式调用**、**Token-by-Token 推送机制**、**React/Vue 前端实时渲染**、**错误处理与重连**、**性能优化** 及 **生产环境踩坑总结**，助你构建一个企业级的 AI Agent 流式响应系统。

<!-- more -->

## 一、为什么 AI Agent 需要流式响应？

### 1.1 从"等待"到"流式"的用户体验革命

想象一个场景：用户向 AI Agent 提问"请详细解释微服务架构的设计原则"，LLM 需要生成大约 2000 个 Token 的回答。如果采用传统的同步请求模式，用户需要等待 15-30 秒才能看到完整回复——这段"黑屏等待"的时间足以让 40% 的用户关闭页面。

流式响应（Streaming Response）改变了这一切。当 LLM 生成第一个 Token 时，用户立即看到内容开始出现，随后以每秒 30-60 个 Token 的速度逐字呈现。这种"打字机效果"极大地提升了用户感知的响应速度——即使总耗时相同，用户的**感知等待时间**从 20 秒降到了接近 0。

### 1.2 流式响应的技术本质

从技术角度看，流式响应的本质是**将一个长时间运行的 HTTP 请求拆分为多个小的数据块（chunk）**，服务端不需要等待完整结果就绪，而是在生成过程中逐步将数据推送给客户端。这与传统的"请求-等待-响应"模式有着根本性的区别。

```
传统模式：
Client ──请求──▶ Server (处理20s) ──完整响应──▶ Client

流式模式：
Client ──请求──▶ Server
Server ──chunk1──▶ Client (第1秒)
Server ──chunk2──▶ Client (第2秒)
Server ──chunk3──▶ Client (第3秒)
...
Server ──[DONE]──▶ Client (第20秒)
```

### 1.3 AI Agent 场景下流式响应的特殊挑战

AI Agent 的流式响应与普通的实时通知推送有本质区别：

1. **长时间运行**：一次 LLM 调用可能持续 5-60 秒，远超普通 HTTP 请求的超时阈值
2. **Token 级粒度**：每个 chunk 可能只是一个 Token（3-5 个字符），数据量极小但频率高
3. **链式调用**：Agent 可能调用多个 Tool，需要在中间状态也进行流式推送
4. **错误恢复**：LLM API 调用可能超时或限流，需要在流式过程中优雅降级
5. **并发压力**：每个流式连接都会占用服务端资源，高并发场景下资源消耗巨大

## 二、SSE vs WebSocket：AI Agent 场景的选型决策

### 2.1 两种协议的核心区别

**Server-Sent Events (SSE)** 是基于 HTTP 的单向服务端推送协议。客户端通过普通的 HTTP GET 请求建立连接，服务端以 `text/event-stream` Content-Type 持续发送事件。

**WebSocket** 是独立的全双工通信协议，通过 HTTP Upgrade 握手后升级为 `ws://` 或 `wss://` 连接，客户端和服务端均可随时发送数据。

### 2.2 关键维度对比

| 维度 | SSE | WebSocket |
|------|-----|-----------|
| **通信方向** | 服务端 → 客户端（单向） | 双向 |
| **协议基础** | HTTP/1.1 或 HTTP/2 | 独立协议（基于 TCP） |
| **数据格式** | 纯文本（UTF-8） | 文本或二进制 |
| **自动重连** | 浏览器原生支持 | 需手动实现 |
| **负载均衡** | 与普通 HTTP 相同 | 需要会话亲和性（sticky session） |
| **Nginx/代理** | 无需特殊配置 | 需配置 Upgrade 头 |
| **连接开销** | 低（复用 HTTP 连接） | 较高（独立 TCP 连接） |
| **Laravel 生态** | 原生支持（Laravel HTTP Response） | 需要 Reverb / Pusher / Soketi |
| **浏览器兼容性** | IE 不支持，其余主流浏览器均支持 | 所有现代浏览器均支持 |
| **HTTP/2 多路复用** | 支持（同一连接上多个 SSE 流） | 不适用 |

### 2.3 AI Agent 场景的选型建议

**推荐 SSE 的场景（占 90% 的 AI Agent 应用）：**

- 纯粹的 AI 对话流式输出（单向服务端推送）
- 不需要客户端实时发送消息（用户输入可以通过普通 HTTP POST）
- 希望简化架构、降低运维成本
- 需要利用 HTTP/2 的多路复用能力
- 需要兼容 CDN 和反向代理

**推荐 WebSocket 的场景：**

- 需要双向实时通信（如协同编辑 + AI 辅助）
- 需要客户端实时发送中断信号（如"停止生成"按钮需要极低延迟）
- 已有 Laravel Reverb/Pusher 基础设施
- 需要广播给多个客户端（如多人协作场景中的 AI 操作同步）

**核心决策公式：**

> **是否需要客户端在流式过程中向服务端实时推送数据？**
>
> - 否 → SSE（简单、可靠、运维友好）
> - 是 → WebSocket（双向能力）

在本文中，我们将**两种方案都完整实现**，你可以根据实际需求选择。

## 三、Laravel 后端 SSE 流式推送实现

### 3.1 架构概览

```
┌──────────┐     HTTP POST     ┌──────────────┐    SSE Stream    ┌──────────┐
│  浏览器   │ ──── 发送消息 ────▶│  Laravel API │ ──── 流式响应 ──▶│   浏览器  │
│          │                   │              │                  │          │
│  React/  │                   │  Controller  │    EventSource   │  React/  │
│  Vue     │◀──────────────────│  ↕ Service   │◀─────────────────│  Vue     │
└──────────┘                   │  ↕ OpenAI API│                  └──────────┘
                               └──────────────┘
```

工作流程：
1. 客户端发送 POST 请求（包含用户消息）到 Laravel API
2. Laravel 后端调用 OpenAI API 的流式接口
3. 后端逐 Token 接收 OpenAI 的响应
4. 后端通过 SSE 将每个 Token 实时推送给客户端
5. 客户端逐 Token 渲染到页面上

### 3.2 Laravel SSE 控制器实现

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AiChatSseController extends Controller
{
    /**
     * SSE 流式 AI 对话接口
     */
    public function stream(Request $request): StreamedResponse
    {
        $request->validate([
            'message'   => 'required|string|max:4000',
            'chat_id'   => 'nullable|uuid',
            'model'     => 'nullable|string',
            'context'   => 'nullable|array',
        ]);

        $message  = $request->input('message');
        $chatId   = $request->input('chat_id', uniqid('chat_', true));
        $model    = $request->input('model', 'gpt-4o');
        $context  = $request->input('context', []);

        return new StreamedResponse(function () use ($message, $chatId, $model, $context) {
            // 关闭 PHP 输出缓冲
            $this->closeOutputBuffers(0, true);

            try {
                // 构造 OpenAI API 请求消息
                $messages = $this->buildMessages($message, $context);

                // 调用 OpenAI 流式 API
                $response = Http::withHeaders([
                    'Authorization' => 'Bearer ' . config('services.openai.api_key'),
                    'Content-Type'  => 'application/json',
                    'Accept'        => 'text/event-stream',
                ])
                ->timeout(120) // LLM 调用可能耗时较长
                ->connectTimeout(10)
                ->post('https://api.openai.com/v1/chat/completions', [
                    'model'    => $model,
                    'messages' => $messages,
                    'stream'   => true, // 关键：启用流式模式
                    'max_tokens' => 4096,
                ]);

                if ($response->failed()) {
                    $this->sendSseEvent('error', [
                        'message' => 'OpenAI API 调用失败',
                        'code'    => $response->status(),
                    ]);
                    $this->sendSseEvent('done', []);
                    return;
                }

                // 处理流式响应
                $buffer = '';
                $fullContent = '';

                $response->body(function ($chunk) use (&$buffer, &$fullContent, $chatId) {
                    $buffer .= $chunk;

                    // 按行分割处理
                    while (($lineEnd = strpos($buffer, "\n")) !== false) {
                        $line = substr($buffer, 0, $lineEnd);
                        $buffer = substr($buffer, $lineEnd + 1);
                        $line = trim($line);

                        // 跳过空行
                        if (empty($line)) {
                            continue;
                        }

                        // 处理 SSE 数据行
                        if (str_starts_with($line, 'data: ')) {
                            $data = substr($line, 6);

                            // 流结束标记
                            if ($data === '[DONE]') {
                                $this->sendSseEvent('message_complete', [
                                    'chat_id' => $chatId,
                                    'content' => $fullContent,
                                ]);
                                $this->sendSseEvent('done', []);
                                return;
                            }

                            $parsed = json_decode($data, true);
                            if (json_last_error() !== JSON_ERROR_NONE) {
                                continue;
                            }

                            // 提取 Token
                            $delta = $parsed['choices'][0]['delta'] ?? [];
                            $token = $delta['content'] ?? '';

                            if (!empty($token)) {
                                $fullContent .= $token;
                                $this->sendSseEvent('token', [
                                    'chat_id' => $chatId,
                                    'token'   => $token,
                                    'index'   => strlen($fullContent),
                                ]);
                            }

                            // 检查是否有 finish_reason
                            $finishReason = $parsed['choices'][0]['finish_reason'] ?? null;
                            if ($finishReason === 'stop') {
                                $this->sendSseEvent('message_complete', [
                                    'chat_id'       => $chatId,
                                    'content'       => $fullContent,
                                    'finish_reason' => $finishReason,
                                ]);
                            }
                        }
                    }
                });

            } catch (\Illuminate\Http\Client\ConnectionException $e) {
                Log::error('SSE OpenAI 连接失败', ['error' => $e->getMessage()]);
                $this->sendSseEvent('error', [
                    'message' => 'AI 服务连接超时，请稍后重试',
                    'code'    => 'CONNECTION_TIMEOUT',
                ]);
                $this->sendSseEvent('done', []);
            } catch (\Throwable $e) {
                Log::error('SSE 流式处理异常', [
                    'error' => $e->getMessage(),
                    'trace' => $e->getTraceAsString(),
                ]);
                $this->sendSseEvent('error', [
                    'message' => '服务器内部错误',
                    'code'    => 'INTERNAL_ERROR',
                ]);
                $this->sendSseEvent('done', []);
            }
        }, 200, [
            'Content-Type'                  => 'text/event-stream',
            'Cache-Control'                 => 'no-cache',
            'Connection'                    => 'keep-alive',
            'X-Accel-Buffering'             => 'no', // 关键：禁用 Nginx 缓冲
            'Access-Control-Allow-Origin'    => '*',
            'Access-Control-Allow-Headers'   => 'Content-Type, Authorization',
        ]);
    }

    /**
     * 发送 SSE 事件
     */
    private function sendSseEvent(string $event, array $data): void
    {
        echo "event: {$event}\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n";
        echo "\n";

        // 确保立即发送
        if (ob_get_level() > 0) {
            ob_end_flush();
        }
        flush();
    }

    /**
     * 构造 OpenAI 消息数组
     */
    private function buildMessages(string $userMessage, array $context): array
    {
        $messages = [
            [
                'role'    => 'system',
                'content' => '你是一个专业的 AI 助手，请用中文详细回答用户的问题。',
            ],
        ];

        // 添加历史上下文
        foreach ($context as $item) {
            $messages[] = [
                'role'    => $item['role'],
                'content' => $item['content'],
            ];
        }

        $messages[] = [
            'role'    => 'user',
            'content' => $userMessage,
        ];

        return $messages;
    }

    /**
     * 关闭输出缓冲区
     */
    private function closeOutputBuffers(int $targetLevel, bool $flush): void
    {
        $status = ob_get_status(true);
        $level  = ob_get_level();

        while ($level-- > $targetLevel && isset($status[$level])) {
            if ($flush) {
                ob_end_flush();
            } else {
                ob_end_clean();
            }
        }
    }
}
```

### 3.3 带 Tool Calling 的 Agent 流式实现

真实的 AI Agent 不仅仅是聊天，还需要调用外部工具。下面是支持 Tool Calling 的流式实现：

```php
<?php

namespace App\Services\AiAgent;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class StreamingAgentService
{
    private array  $tools;
    private string $model;
    private array  $conversationHistory = [];

    public function __construct(array $tools = [], string $model = 'gpt-4o')
    {
        $this->tools = $tools;
        $this->model = $model;
    }

    /**
     * 执行 Agent 流式对话（支持 Tool Calling）
     */
    public function executeStream(string $userMessage, callable $onToken, callable $onToolCall, callable $onDone): void
    {
        $this->conversationHistory[] = [
            'role'    => 'user',
            'content' => $userMessage,
        ];

        $maxIterations = 10; // 防止无限循环
        $iteration = 0;

        while ($iteration++ < $maxIterations) {
            $response = $this->callOpenAiStream();
            $assistantMessage = ['role' => 'assistant', 'content' => '', 'tool_calls' => []];
            $currentToolCall  = null;
            $buffer = '';

            $response->body(function ($chunk) use (
                &$buffer, &$assistantMessage, &$currentToolCall,
                $onToken, $onToolCall
            ) {
                $buffer .= $chunk;

                while (($lineEnd = strpos($buffer, "\n")) !== false) {
                    $line = substr($buffer, 0, $lineEnd);
                    $buffer = substr($buffer, $lineEnd + 1);
                    $line = trim($line);

                    if (empty($line) || !str_starts_with($line, 'data: ')) {
                        continue;
                    }

                    $data = substr($line, 6);
                    if ($data === '[DONE]') {
                        return;
                    }

                    $parsed = json_decode($data, true);
                    if (!$parsed) continue;

                    $delta = $parsed['choices'][0]['delta'] ?? [];

                    // 处理文本 Token
                    if (!empty($delta['content'])) {
                        $assistantMessage['content'] .= $delta['content'];
                        $onToken($delta['content']);
                    }

                    // 处理 Tool Call 流式增量
                    if (isset($delta['tool_calls'])) {
                        foreach ($delta['tool_calls'] as $toolDelta) {
                            $index = $toolDelta['index'] ?? 0;

                            if (!isset($assistantMessage['tool_calls'][$index])) {
                                $assistantMessage['tool_calls'][$index] = [
                                    'id'    => $toolDelta['id'] ?? '',
                                    'type'  => 'function',
                                    'function' => [
                                        'name'      => '',
                                        'arguments' => '',
                                    ],
                                ];
                            }

                            if (!empty($toolDelta['function']['name'])) {
                                $assistantMessage['tool_calls'][$index]['function']['name'] .= $toolDelta['function']['name'];
                            }
                            if (!empty($toolDelta['function']['arguments'])) {
                                $assistantMessage['tool_calls'][$index]['function']['arguments'] .= $toolDelta['function']['arguments'];
                            }
                        }
                    }
                }
            });

            $this->conversationHistory[] = $assistantMessage;

            // 检查是否有 Tool Call 需要执行
            if (!empty($assistantMessage['tool_calls'])) {
                foreach ($assistantMessage['tool_calls'] as $toolCall) {
                    $functionName = $toolCall['function']['name'];
                    $arguments    = json_decode($toolCall['function']['arguments'], true) ?? [];

                    // 通知前端正在调用工具
                    $onToolCall([
                        'id'        => $toolCall['id'],
                        'name'      => $functionName,
                        'arguments' => $arguments,
                        'status'    => 'calling',
                    ]);

                    // 执行工具
                    $result = $this->executeTool($functionName, $arguments);

                    $onToolCall([
                        'id'     => $toolCall['id'],
                        'name'   => $functionName,
                        'result' => $result,
                        'status' => 'completed',
                    ]);

                    // 将工具结果加入对话历史
                    $this->conversationHistory[] = [
                        'role'       => 'tool',
                        'tool_call_id' => $toolCall['id'],
                        'content'    => is_string($result) ? $result : json_encode($result),
                    ];
                }

                // 继续下一轮 LLM 调用
                continue;
            }

            // 没有 Tool Call，对话结束
            break;
        }

        $onDone($assistantMessage['content'] ?? '');
    }

    private function callOpenAiStream()
    {
        $payload = [
            'model'    => $this->model,
            'messages' => $this->conversationHistory,
            'stream'   => true,
        ];

        if (!empty($this->tools)) {
            $payload['tools'] = $this->tools;
        }

        return Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
            'Content-Type'  => 'application/json',
        ])
        ->timeout(120)
        ->post('https://api.openai.com/v1/chat/completions', $payload);
    }

    private function executeTool(string $name, array $arguments): mixed
    {
        // 根据工具名称路由到具体实现
        return match ($name) {
            'search_web'     => $this->searchWeb($arguments),
            'query_database' => $this->queryDatabase($arguments),
            'send_email'     => $this->sendEmail($arguments),
            default          => throw new \RuntimeException("未知工具: {$name}"),
        };
    }

    private function searchWeb(array $args): string { /* ... */ return '搜索结果'; }
    private function queryDatabase(array $args): string { /* ... */ return '查询结果'; }
    private function sendEmail(array $args): string { /* ... */ return '邮件已发送'; }
}
```

### 3.4 路由配置

```php
// routes/api.php
use App\Http\Controllers\Api\AiChatSseController;

Route::middleware('auth:sanctum')->group(function () {
    // SSE 流式对话
    Route::post('/chat/stream', [AiChatSseController::class, 'stream'])
        ->middleware('throttle:30,1'); // 限流：每分钟最多 30 次

    // Agent 流式对话（支持 Tool Calling）
    Route::post('/agent/stream', [AiAgentSseController::class, 'stream'])
        ->middleware('throttle:10,1'); // Agent 调用更消耗资源，限流更严格
});
```

### 3.5 Nginx 配置（关键）

SSE 在 Nginx 反向代理后面最容易出问题——**Nginx 默认会缓冲响应**，导致客户端无法实时收到数据。必须显式禁用缓冲：

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    location /api/chat/stream {
        proxy_pass http://127.0.0.1:8000;

        # 关键：禁用代理缓冲
        proxy_buffering off;
        proxy_cache off;

        # 关键：禁用 Nginx 的 gzip（gzip 会缓冲数据）
        gzip off;

        # 保持连接活跃
        proxy_http_version 1.1;
        proxy_set_header Connection '';

        # 设置较长的超时时间（AI 响应可能很慢）
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # 传递客户端信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 四、Laravel 后端 WebSocket 实时推送实现

### 4.1 架构选型：Laravel Reverb

Laravel 11 推出了官方的 WebSocket 服务器 **Reverb**，它是 Pusher 协议的高性能 PHP 实现。对于已有 Laravel 生态的项目，Reverb 是最自然的 WebSocket 方案。

```
┌──────────┐  WebSocket  ┌─────────────┐  Pusher Protocol  ┌──────────┐
│  浏览器   │ ◀──────────▶│ Laravel     │◀──────────────────│ Laravel  │
│  Echo     │             │ Reverb      │                   │ Queue    │
│  Client   │             │ (WS Server) │                   │ Worker   │
└──────────┘             └─────────────┘                   └────┬─────┘
                                                                │
                                                          ┌─────▼─────┐
                                                          │ OpenAI    │
                                                          │ API       │
                                                          └───────────┘
```

### 4.2 安装和配置 Reverb

```bash
# 安装 Laravel Reverb
composer require laravel/reverb

# 发布配置文件
php artisan reverb:install

# 配置 .env
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=your-app-id
REVERB_APP_KEY=your-app-key
REVERB_APP_SECRET=your-app-secret
REVERB_HOST=0.0.0.0
REVERB_PORT=8080
REVERB_SCHEME=https
```

### 4.3 广播事件定义

```php
<?php

namespace App\Events\AiAgent;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * AI Token 生成事件 - 逐个 Token 推送
 */
class AiTokenGenerated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $chatId,
        public string $token,
        public int    $index,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("chat.{$this->chatId}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'ai.token';
    }

    public function broadcastWith(): array
    {
        return [
            'token' => $this->token,
            'index' => $this->index,
        ];
    }
}

/**
 * AI Tool Call 事件
 */
class AiToolCallStarted implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $chatId,
        public string $toolName,
        public array  $arguments,
        public string $toolCallId,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("chat.{$this->chatId}")];
    }

    public function broadcastAs(): string
    {
        return 'ai.tool_call';
    }

    public function broadcastWith(): array
    {
        return [
            'tool_name'   => $this->toolName,
            'arguments'   => $this->arguments,
            'tool_call_id' => $this->toolCallId,
        ];
    }
}

/**
 * AI 消息完成事件
 */
class AiMessageCompleted implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $chatId,
        public string $fullContent,
        public ?string $finishReason = 'stop',
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("chat.{$this->chatId}")];
    }

    public function broadcastAs(): string
    {
        return 'ai.message_complete';
    }

    public function broadcastWith(): array
    {
        return [
            'content'       => $this->fullContent,
            'finish_reason' => $this->finishReason,
        ];
    }
}

/**
 * AI 流式错误事件
 */
class AiStreamError implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $chatId,
        public string $errorMessage,
        public string $errorCode,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("chat.{$this->chatId}")];
    }

    public function broadcastAs(): string
    {
        return 'ai.error';
    }

    public function broadcastWith(): array
    {
        return [
            'message' => $this->errorMessage,
            'code'    => $this->errorCode,
        ];
    }
}
```

### 4.4 Queue Job 实现流式推送

由于 WebSocket 推送需要通过 Queue 异步执行（避免阻塞 HTTP 请求），我们创建一个专门的 Job：

```php
<?php

namespace App\Jobs\AiAgent;

use App\Events\AiAgent\AiMessageCompleted;
use App\Events\AiAgent\AiStreamError;
use App\Events\AiAgent\AiTokenGenerated;
use App\Events\AiAgent\AiToolCallStarted;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ProcessAiStreamJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 180; // 3 分钟超时

    public function __construct(
        public string $chatId,
        public string $message,
        public array  $context = [],
        public string $model = 'gpt-4o',
        public array  $tools = [],
    ) {
        $this->onQueue('ai-stream'); // 使用专用队列
    }

    public function handle(): void
    {
        try {
            $messages = $this->buildMessages();
            $fullContent = '';
            $tokenIndex  = 0;

            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . config('services.openai.api_key'),
                'Content-Type'  => 'application/json',
            ])
            ->timeout(120)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model'    => $this->model,
                'messages' => $messages,
                'stream'   => true,
                'tools'    => !empty($this->tools) ? $this->tools : null,
            ]);

            if ($response->failed()) {
                AiStreamError::dispatch(
                    $this->chatId,
                    'OpenAI API 错误: HTTP ' . $response->status(),
                    'API_ERROR'
                );
                return;
            }

            $buffer = '';

            $response->body(function ($chunk) use (&$buffer, &$fullContent, &$tokenIndex) {
                $buffer .= $chunk;

                while (($lineEnd = strpos($buffer, "\n")) !== false) {
                    $line = substr($buffer, 0, $lineEnd);
                    $buffer = substr($buffer, $lineEnd + 1);
                    $line = trim($line);

                    if (empty($line) || !str_starts_with($line, 'data: ')) {
                        continue;
                    }

                    $data = substr($line, 6);
                    if ($data === '[DONE]') {
                        AiMessageCompleted::dispatch(
                            $this->chatId,
                            $fullContent,
                            'stop'
                        );
                        return;
                    }

                    $parsed = json_decode($data, true);
                    if (!$parsed) continue;

                    $delta = $parsed['choices'][0]['delta'] ?? [];

                    if (!empty($delta['content'])) {
                        $token = $delta['content'];
                        $fullContent .= $token;
                        $tokenIndex++;

                        AiTokenGenerated::dispatch(
                            $this->chatId,
                            $token,
                            $tokenIndex
                        );
                    }
                }
            });

        } catch (\Throwable $e) {
            Log::error('AI 流式处理 Job 失败', [
                'chat_id' => $this->chatId,
                'error'   => $e->getMessage(),
            ]);

            AiStreamError::dispatch(
                $this->chatId,
                'AI 处理失败: ' . $e->getMessage(),
                'JOB_ERROR'
            );

            throw $e; // 让 Laravel 重试
        }
    }

    private function buildMessages(): array
    {
        $messages = [
            ['role' => 'system', 'content' => '你是一个专业的 AI 助手。'],
        ];

        foreach ($this->context as $item) {
            $messages[] = $item;
        }

        $messages[] = [
            'role'    => 'user',
            'content' => $this->message,
        ];

        return $messages;
    }
}
```

### 4.5 WebSocket 控制器

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\AiAgent\ProcessAiStreamJob;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiChatWebSocketController extends Controller
{
    public function send(Request $request): JsonResponse
    {
        $request->validate([
            'message' => 'required|string|max:4000',
            'chat_id' => 'required|string',
        ]);

        $chatId = $request->input('chat_id');
        $message = $request->input('message');

        // 分发到队列异步处理
        ProcessAiStreamJob::dispatch(
            chatId: $chatId,
            message: $message,
            context: $request->input('context', []),
        );

        return response()->json([
            'status'  => 'accepted',
            'chat_id' => $chatId,
        ], 202);
    }
}
```

### 4.6 频道授权

```php
// routes/channels.php
use App\Models\User;

Broadcast::channel('chat.{chatId}', function (User $user, string $chatId) {
    // 验证用户是否有权访问此聊天
    return $user->chats()->where('chat_id', $chatId)->exists();
});
```

## 五、OpenAI/LLM API 流式调用详解

### 5.1 OpenAI 流式 API 的数据格式

OpenAI 的流式 API 使用 SSE 格式返回数据。每个数据块的格式如下：

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1717382400,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1717382400,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1717382400,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

关键字段说明：

- `delta.content`：当前 Token 的内容（增量）
- `finish_reason`：完成原因（`stop` = 正常结束，`length` = 达到 max_tokens，`tool_calls` = 触发工具调用）
- `[DONE]`：流结束标记

### 5.2 多模型适配层

不同 LLM 提供商的流式 API 格式略有差异。建议封装一个统一的适配层：

```php
<?php

namespace App\Services\Llm;

use Illuminate\Support\Facades\Http;

class LlmStreamAdapter
{
    /**
     * 统一的流式调用接口
     */
    public static function stream(
        string $provider,
        array  $params,
        callable $onToken,
        callable $onDone,
        callable $onError,
    ): void {
        $adapter = match ($provider) {
            'openai'    => new OpenAiAdapter(),
            'anthropic' => new AnthropicAdapter(),
            'deepseek'  => new DeepSeekAdapter(),
            'qwen'      => new QwenAdapter(),
            default     => throw new \InvalidArgumentException("不支持的 LLM 提供商: {$provider}"),
        };

        $adapter->stream($params, $onToken, $onDone, $onError);
    }
}

class OpenAiAdapter
{
    public function stream(array $params, callable $onToken, callable $onDone, callable $onError): void
    {
        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . config('services.openai.api_key'),
                'Content-Type'  => 'application/json',
            ])
            ->timeout(120)
            ->post(config('services.openai.base_url', 'https://api.openai.com') . '/v1/chat/completions', [
                'model'      => $params['model'] ?? 'gpt-4o',
                'messages'   => $params['messages'],
                'stream'     => true,
                'max_tokens' => $params['max_tokens'] ?? 4096,
            ]);

            if ($response->failed()) {
                $onError('OpenAI API 错误', $response->status());
                return;
            }

            $buffer = '';
            $response->body(function ($chunk) use (&$buffer, $onToken, $onDone) {
                $buffer .= $chunk;

                while (($lineEnd = strpos($buffer, "\n")) !== false) {
                    $line = substr($buffer, 0, $lineEnd);
                    $buffer = substr($buffer, $lineEnd + 1);
                    $line = trim($line);

                    if (empty($line) || !str_starts_with($line, 'data: ')) continue;

                    $data = substr($line, 6);
                    if ($data === '[DONE]') { $onDone(); return; }

                    $parsed = json_decode($data, true);
                    $token = $parsed['choices'][0]['delta']['content'] ?? '';
                    if (!empty($token)) $onToken($token);
                }
            });
        } catch (\Throwable $e) {
            $onError($e->getMessage(), 500);
        }
    }
}

class AnthropicAdapter
{
    public function stream(array $params, callable $onToken, callable $onDone, callable $onError): void
    {
        try {
            // Anthropic 使用不同的 API 格式
            $response = Http::withHeaders([
                'x-api-key'         => config('services.anthropic.api_key'),
                'anthropic-version' => '2023-06-01',
                'Content-Type'      => 'application/json',
            ])
            ->timeout(120)
            ->post('https://api.anthropic.com/v1/messages', [
                'model'      => $params['model'] ?? 'claude-sonnet-4-20250514',
                'messages'   => $this->convertMessages($params['messages']),
                'max_tokens' => $params['max_tokens'] ?? 4096,
                'stream'     => true,
                'system'     => $params['system'] ?? '',
            ]);

            if ($response->failed()) {
                $onError('Anthropic API 错误', $response->status());
                return;
            }

            $buffer = '';
            $response->body(function ($chunk) use (&$buffer, $onToken, $onDone) {
                $buffer .= $chunk;

                while (($lineEnd = strpos($buffer, "\n")) !== false) {
                    $line = substr($buffer, 0, $lineEnd);
                    $buffer = substr($buffer, $lineEnd + 1);
                    $line = trim($line);

                    if (empty($line) || !str_starts_with($line, 'data: ')) continue;

                    $data = json_decode(substr($line, 6), true);
                    if (!$data) continue;

                    if ($data['type'] === 'content_block_delta') {
                        $token = $data['delta']['text'] ?? '';
                        if (!empty($token)) $onToken($token);
                    }

                    if ($data['type'] === 'message_stop') {
                        $onDone();
                        return;
                    }
                }
            });
        } catch (\Throwable $e) {
            $onError($e->getMessage(), 500);
        }
    }

    private function convertMessages(array $messages): array
    {
        return array_filter(array_map(function ($msg) {
            if ($msg['role'] === 'system') return null;
            return ['role' => $msg['role'], 'content' => $msg['content']];
        }, $messages));
    }
}

class DeepSeekAdapter extends OpenAiAdapter {}
class QwenAdapter extends OpenAiAdapter {}
```

### 5.3 流式调用中的缓冲区处理

处理 LLM 流式响应时，最常见的问题就是**不完整的 JSON 行**。网络传输可能导致一个 SSE 事件被拆分为多个 TCP 包：

```
第一个包: data: {"id":"chatcmpl-xxx","choices":[{"delta":{"con
第二个包: tent":"你","finish_reason":null}}]}
```

因此，**必须使用行缓冲策略**：将接收到的数据追加到缓冲区，只有当遇到完整的换行符 `\n` 时才处理该行。上面的代码示例已经实现了这一策略。

## 六、前端实时渲染实现

### 6.1 React + TypeScript 实现（SSE 方案）

```tsx
// src/hooks/useAiStream.ts
import { useState, useCallback, useRef } from 'react';

interface StreamState {
  content: string;
  isStreaming: boolean;
  error: string | null;
  isToolCalling: boolean;
  toolCalls: ToolCallInfo[];
}

interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'calling' | 'completed';
  result?: unknown;
}

interface UseAiStreamOptions {
  apiUrl: string;
  authToken?: string;
  onToken?: (token: string) => void;
  onComplete?: (fullContent: string) => void;
  onError?: (error: string) => void;
  onToolCall?: (toolCall: ToolCallInfo) => void;
}

export function useAiStream(options: UseAiStreamOptions) {
  const [state, setState] = useState<StreamState>({
    content: '',
    isStreaming: false,
    error: null,
    isToolCalling: false,
    toolCalls: [],
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const contentRef = useRef('');

  const sendMessage = useCallback(async (
    message: string,
    chatId: string,
    context: Array<{ role: string; content: string }> = []
  ) => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    contentRef.current = '';

    setState({
      content: '',
      isStreaming: true,
      error: null,
      isToolCalling: false,
      toolCalls: [],
    });

    try {
      const response = await fetch(options.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.authToken ? { 'Authorization': `Bearer ${options.authToken}` } : {}),
        },
        body: JSON.stringify({ message, chat_id: chatId, context }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // 解析 SSE 格式
          if (trimmed.startsWith('event: ')) {
            const eventType = trimmed.slice(7);
            // 下一行是 data，跳过事件行标记
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const data = JSON.parse(dataStr);
              handleSseEvent(data);
            } catch {
              // 非 JSON data，忽略
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // 用户主动取消
      }
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setState(prev => ({ ...prev, error: errorMessage, isStreaming: false }));
      options.onError?.(errorMessage);
    } finally {
      setState(prev => ({ ...prev, isStreaming: false }));
    }
  }, [options]);

  const handleSseEvent = useCallback((data: Record<string, unknown>) => {
    // 根据事件类型处理
    if (data.token !== undefined) {
      const token = data.token as string;
      contentRef.current += token;
      setState(prev => ({ ...prev, content: contentRef.current }));
      options.onToken?.(token);
    }
  }, [options]);

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  return {
    ...state,
    sendMessage,
    stopStream,
  };
}
```

### 6.2 优化的 SSE 事件解析（支持 event 类型）

上面的简化版本没有正确处理 SSE 的 `event:` 行。下面是更健壮的实现：

```tsx
// src/utils/sseParser.ts

interface SseEvent {
  event: string;
  data: string;
}

export function createSseParser() {
  let buffer = '';
  let currentEvent = '';
  let currentData = '';

  function processChunk(chunk: string): SseEvent[] {
    buffer += chunk;
    const events: SseEvent[] = [];
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '') {
        // 空行 = 事件结束
        if (currentData) {
          events.push({
            event: currentEvent || 'message',
            data: currentData.endsWith('\n') ? currentData.slice(0, -1) : currentData,
          });
          currentEvent = '';
          currentData = '';
        }
        continue;
      }

      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        currentData = currentData ? currentData + '\n' + data : data;
      } else if (trimmed.startsWith('id:')) {
        // 忽略 id 字段
      } else if (trimmed.startsWith('retry:')) {
        // 忽略 retry 字段
      }
    }

    return events;
  }

  return { processChunk };
}
```

### 6.3 React 流式渲染组件

```tsx
// src/components/AiChat/AiStreamMessage.tsx
import React, { useEffect, useRef, useState } from 'react';
import { useAiStream } from '@/hooks/useAiStream';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export function AiChatBox() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef(crypto.randomUUID());

  const { content, isStreaming, error, sendMessage, stopStream } = useAiStream({
    apiUrl: '/api/chat/stream',
    authToken: localStorage.getItem('auth_token') || undefined,
    onComplete: (fullContent) => {
      setMessages(prev =>
        prev.map(m => m.isStreaming ? { ...m, content: fullContent, isStreaming: false } : m)
      );
    },
    onError: (err) => {
      console.error('Stream error:', err);
    },
  });

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [content, messages]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    };

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');

    // 构造上下文
    const context = [...messages, userMessage].map(m => ({
      role: m.role,
      content: m.content,
    }));

    await sendMessage(input.trim(), chatIdRef.current, context);
  };

  return (
    <div className="flex flex-col h-[600px] border rounded-lg">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg p-3 ${
              msg.role === 'user'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-900'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        return match ? (
                          <SyntaxHighlighter style={oneDark} language={match[1]}>
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>{children}</code>
                        );
                      },
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                  {msg.isStreaming && <span className="animate-pulse">▊</span>}
                </div>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        {error && (
          <div className="text-center text-red-500 text-sm">
            ⚠️ {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t p-4 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="输入消息..."
          disabled={isStreaming}
          className="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isStreaming ? (
          <button
            onClick={stopStream}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            停止
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
```

### 6.4 Vue 3 + Composition API 实现

```vue
<!-- src/components/AiChatBox.vue -->
<template>
  <div class="ai-chat-box">
    <div class="messages" ref="messagesContainer">
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['message', msg.role]"
      >
        <div v-if="msg.role === 'assistant'" class="content markdown-body">
          <MarkdownRenderer :content="msg.content" />
          <span v-if="msg.isStreaming" class="cursor-blink">▊</span>
        </div>
        <div v-else class="content">
          {{ msg.content }}
        </div>
      </div>
    </div>

    <div class="input-area">
      <textarea
        v-model="input"
        @keydown.enter.exact.prevent="send"
        placeholder="输入消息..."
        :disabled="isStreaming"
        rows="1"
      />
      <button v-if="isStreaming" @click="stop" class="stop-btn">
        停止生成
      </button>
      <button v-else @click="send" :disabled="!input.trim()" class="send-btn">
        发送
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

const messages = ref<Message[]>([]);
const input = ref('');
const isStreaming = ref(false);
const messagesContainer = ref<HTMLElement>();
const chatId = ref(crypto.randomUUID());

let abortController: AbortController | null = null;

// 自动滚动
watch(
  () => messages.value.map(m => m.content),
  () => {
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
      }
    });
  },
  { deep: true }
);

async function send() {
  if (!input.value.trim() || isStreaming.value) return;

  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: input.value.trim(),
  };

  const assistantMsg: Message = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    isStreaming: true,
  };

  messages.value.push(userMsg, assistantMsg);
  const messageText = input.value.trim();
  input.value = '';
  isStreaming.value = true;

  abortController = new AbortController();
  let fullContent = '';

  try {
    const context = messages.value
      .filter(m => !m.isStreaming)
      .map(m => ({ role: m.role, content: m.content }));

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: messageText,
        chat_id: chatId.value,
        context,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const dataStr = trimmed.slice(6);
        try {
          const data = JSON.parse(dataStr);
          if (data.token) {
            fullContent += data.token;
            const lastMsg = messages.value[messages.value.length - 1];
            if (lastMsg) lastMsg.content = fullContent;
          }
        } catch {}
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return;
    console.error('Stream error:', err);
  } finally {
    isStreaming.value = false;
    const lastMsg = messages.value[messages.value.length - 1];
    if (lastMsg) lastMsg.isStreaming = false;
  }
}

function stop() {
  abortController?.abort();
  isStreaming.value = false;
}
</script>

<style scoped>
.cursor-blink {
  animation: blink 1s step-end infinite;
}
@keyframes blink {
  50% { opacity: 0; }
}
</style>
```

### 6.5 WebSocket 前端实现（Laravel Echo）

```tsx
// src/hooks/useAiWebSocket.ts
import { useEffect, useCallback, useRef, useState } from 'react';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

interface UseAiWebSocketOptions {
  chatId: string;
  authToken: string;
  onToken: (token: string, index: number) => void;
  onComplete: (fullContent: string) => void;
  onError: (error: string) => void;
  onToolCall?: (data: unknown) => void;
}

export function useAiWebSocket(options: UseAiWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const echoRef = useRef<Echo | null>(null);
  const contentRef = useRef('');

  useEffect(() => {
    const echo = new Echo({
      broadcaster: 'reverb',
      key: import.meta.env.VITE_REVERB_APP_KEY,
      wsHost: import.meta.env.VITE_REVERB_HOST,
      wsPort: import.meta.env.VITE_REVERB_PORT,
      wssPort: import.meta.env.VITE_REVERB_PORT,
      forceTLS: import.meta.env.VITE_REVERB_SCHEME === 'https',
      enabledTransports: ['ws', 'wss'],
      auth: {
        headers: {
          Authorization: `Bearer ${options.authToken}`,
        },
      },
    });

    echoRef.current = echo;
    contentRef.current = '';

    const channel = echo.private(`chat.${options.chatId}`);

    channel
      .listen('.ai.token', (data: { token: string; index: number }) => {
        contentRef.current += data.token;
        options.onToken(data.token, data.index);
      })
      .listen('.ai.message_complete', (data: { content: string }) => {
        options.onComplete(data.content);
      })
      .listen('.ai.error', (data: { message: string }) => {
        options.onError(data.message);
      })
      .listen('.ai.tool_call', (data: unknown) => {
        options.onToolCall?.(data);
      });

    channel.subscribed(() => setIsConnected(true));
    channel.error(() => setIsConnected(false));

    return () => {
      echo.leave(`chat.${options.chatId}`);
      echo.disconnect();
    };
  }, [options.chatId, options.authToken]);

  const sendMessage = useCallback(async (message: string, context: unknown[] = []) => {
    contentRef.current = '';

    const response = await fetch('/api/agent/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.authToken}`,
      },
      body: JSON.stringify({
        message,
        chat_id: options.chatId,
        context,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    return response.json();
  }, [options.chatId, options.authToken]);

  return { isConnected, sendMessage, content: contentRef.current };
}
```

## 七、错误处理与重连机制

### 7.1 SSE 自动重连

SSE 的 `EventSource` 原生支持自动重连，但我们使用 `fetch` 实现更灵活的控制。以下是完整的重连策略：

```tsx
// src/hooks/useResilientSse.ts

interface ResilientSseOptions {
  maxRetries: number;
  baseDelay: number;       // 基础重试延迟（ms）
  maxDelay: number;        // 最大重试延迟（ms）
  backoffMultiplier: number; // 退避乘数
}

const DEFAULT_OPTIONS: ResilientSseOptions = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

export function useResilientSse() {
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  function calculateDelay(options: ResilientSseOptions): number {
    // 指数退避 + 随机抖动
    const delay = Math.min(
      options.baseDelay * Math.pow(options.backoffMultiplier, retryCountRef.current),
      options.maxDelay
    );
    // 添加 ±25% 的随机抖动，防止惊群效应
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

  async function connectWithRetry(
    url: string,
    body: unknown,
    handlers: {
      onToken: (token: string) => void;
      onDone: () => void;
      onError: (error: string, willRetry: boolean) => void;
    },
    options = DEFAULT_OPTIONS,
  ) {
    const abortController = new AbortController();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      // 429 Too Many Requests - 特殊处理
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        if (retryCountRef.current < options.maxRetries) {
          retryCountRef.current++;
          handlers.onError(`请求过于频繁，${retryAfter}秒后重试...`, true);
          retryTimeoutRef.current = setTimeout(() => {
            connectWithRetry(url, body, handlers, options);
          }, retryAfter * 1000);
          return;
        }
      }

      // 5xx 服务器错误 - 可重试
      if (response.status >= 500) {
        throw new Error(`Server Error: ${response.status}`);
      }

      // 4xx 客户端错误 - 不重试
      if (response.status >= 400) {
        const errorText = await response.text();
        handlers.onError(`请求错误: ${response.status} ${errorText}`, false);
        return;
      }

      // 成功连接，重置重试计数
      retryCountRef.current = 0;

      // 处理流式响应
      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') {
            handlers.onDone();
            return;
          }

          try {
            const data = JSON.parse(dataStr);
            if (data.token) handlers.onToken(data.token);
            if (data.message && data.code === 'CONNECTION_TIMEOUT') {
              throw new Error(data.message);
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes('超时')) throw e;
          }
        }
      }

      handlers.onDone();

    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;

      const errorMessage = error instanceof Error ? error.message : '未知错误';

      if (retryCountRef.current < options.maxRetries) {
        retryCountRef.current++;
        const delay = calculateDelay(options);
        handlers.onError(`连接中断，${Math.ceil(delay / 1000)}秒后重试 (${retryCountRef.current}/${options.maxRetries})...`, true);
        retryTimeoutRef.current = setTimeout(() => {
          connectWithRetry(url, body, handlers, options);
        }, delay);
      } else {
        handlers.onError(`重试次数已用完：${errorMessage}`, false);
      }
    }
  }

  // 清理函数
  const cleanup = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    retryCountRef.current = 0;
  }, []);

  return { connectWithRetry, cleanup };
}
```

### 7.2 后端错误处理最佳实践

```php
<?php

namespace App\Services\AiAgent;

use Illuminate\Support\Facades\Log;

class StreamErrorHandler
{
    /**
     * 区分可重试和不可重试的错误
     */
    public static function isRetryable(\Throwable $e): bool
    {
        // 可重试的错误
        $retryableCodes = [
            429,  // Rate Limited
            500,  // Internal Server Error
            502,  // Bad Gateway
            503,  // Service Unavailable
            504,  // Gateway Timeout
        ];

        if ($e instanceof \Illuminate\Http\Client\RequestException) {
            return in_array($e->response->status(), $retryableCodes);
        }

        if ($e instanceof \Illuminate\Http\Client\ConnectionException) {
            return true; // 连接超时，可重试
        }

        return false;
    }

    /**
     * 计算重试延迟（指数退避）
     */
    public static function getRetryDelay(int $attempt): int
    {
        return min(pow(2, $attempt) * 1000, 30000); // 最大 30 秒
    }

    /**
     * 统一的流式错误处理
     */
    public static function handleStreamError(
        \Throwable $e,
        string $chatId,
        callable $sendEvent,
    ): void {
        $errorCode = 'UNKNOWN_ERROR';
        $errorMessage = 'AI 处理过程中发生未知错误';
        $retryable = false;

        if ($e instanceof \Illuminate\Http\Client\RequestException) {
            $status = $e->response->status();
            $errorCode = "API_ERROR_{$status}";

            $errorMessage = match (true) {
                $status === 429  => 'AI 服务请求过于频繁，请稍后重试',
                $status === 401  => 'AI 服务认证失败',
                $status === 400  => '请求参数错误',
                $status >= 500   => 'AI 服务暂时不可用，请稍后重试',
                default          => "AI 服务错误 (HTTP {$status})",
            };

            $retryable = in_array($status, [429, 500, 502, 503, 504]);
        } elseif ($e instanceof \Illuminate\Http\Client\ConnectionException) {
            $errorCode = 'CONNECTION_TIMEOUT';
            $errorMessage = 'AI 服务连接超时，请稍后重试';
            $retryable = true;
        }

        Log::error('AI 流式处理错误', [
            'chat_id'   => $chatId,
            'error'     => $e->getMessage(),
            'code'      => $errorCode,
            'retryable' => $retryable,
        ]);

        $sendEvent('error', [
            'message'   => $errorMessage,
            'code'      => $errorCode,
            'retryable' => $retryable,
        ]);
    }
}
```

### 7.3 WebSocket 断线重连

```tsx
// src/hooks/useResilientWebSocket.ts
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

interface ReconnectOptions {
  maxRetries: number;
  baseDelay: number;
}

export function createResilientEcho(config: unknown, options: ReconnectOptions = { maxRetries: 10, baseDelay: 1000 }) {
  let retryCount = 0;

  const echo = new Echo({
    ...config as object,
    // Pusher 内置重连配置
    wsHost: (config as Record<string, string>).wsHost,
    enabledTransports: ['ws', 'wss'],

    // 自定义错误处理
    errorHandler: (error: unknown) => {
      console.error('WebSocket error:', error);
    },
  });

  // 监听连接状态变化
  echo.connector.pusher.connection.bind('state_change', (states: { current: string; previous: string }) => {
    console.log(`WebSocket 状态变更: ${states.previous} → ${states.current}`);

    if (states.current === 'connected') {
      retryCount = 0;
      console.log('WebSocket 已重新连接');
    }

    if (states.current === 'disconnected' || states.current === 'failed') {
      retryCount++;
      if (retryCount > options.maxRetries) {
        console.error('WebSocket 重连次数超限，请刷新页面');
        // 可以在此触发全局通知
      }
    }
  });

  return echo;
}
```

## 八、性能优化

### 8.1 后端性能优化

#### 8.1.1 PHP-FPM 进程管理

SSE 连接会长时间占用 PHP-FPM 进程。对于高并发场景，这是最大的瓶颈。

```ini
; php-fpm.conf 优化
[www]
pm = dynamic
pm.max_children = 100         ; 根据内存调整
pm.start_servers = 20
pm.min_spare_servers = 10
pm.max_spare_servers = 30

; 为 SSE 请求设置较长的超时
request_terminate_timeout = 300  ; 5 分钟

; 每个 SSE 连接大约消耗 10-20MB 内存
; 100 个并发 SSE 连接 ≈ 1-2GB 内存
```

#### 8.1.2 使用 Laravel Octane（推荐）

Octane 可以将 PHP 应用持久化在内存中，避免每次请求的框架启动开销，显著提升 SSE 性能：

```bash
# 安装 Octane
composer require laravel/octane
php artisan octane:install --server=swoole

# 启动 Octane
php artisan octane:start --workers=50 --task-workers=10 --max-requests=500
```

```php
// 使用 Octane 的流式响应优化
class AiChatSseController extends Controller
{
    public function stream(Request $request)
    {
        return response()->stream(function () use ($request) {
            // Octane 环境下无需手动关闭输出缓冲
            // Octane 会自动处理 SSE 连接的生命周期

            $this->streamAiResponse($request);
        }, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
```

#### 8.1.3 使用 Swoole 协程（高性能方案）

对于需要支持数千并发 SSE 连接的场景，推荐使用 Swoole 的协程 HTTP 客户端：

```php
<?php

namespace App\Services\AiAgent;

use Swoole\Coroutine\Http\Client;
use Swoole\Coroutine;

class SwooleStreamingService
{
    public function streamCompletion(string $message, callable $onToken): void
    {
        Coroutine\run(function () use ($message, $onToken) {
            $client = new Client('api.openai.com', 443, true);
            $client->set(['timeout' => 120]);

            $client->setHeaders([
                'Authorization' => 'Bearer ' . config('services.openai.api_key'),
                'Content-Type'  => 'application/json',
                'Accept'        => 'text/event-stream',
            ]);

            $client->post('/v1/chat/completions', json_encode([
                'model'    => 'gpt-4o',
                'messages' => [
                    ['role' => 'user', 'content' => $message],
                ],
                'stream' => true,
            ]));

            $buffer = '';

            while (true) {
                $data = $client->recv();
                if (!$data) break;

                $buffer .= $data;

                while (($lineEnd = strpos($buffer, "\n")) !== false) {
                    $line = substr($buffer, 0, $lineEnd);
                    $buffer = substr($buffer, $lineEnd + 1);

                    if (str_starts_with(trim($line), 'data: ')) {
                        $jsonData = substr(trim($line), 6);
                        if ($jsonData === '[DONE]') return;

                        $parsed = json_decode($jsonData, true);
                        $token = $parsed['choices'][0]['delta']['content'] ?? '';
                        if ($token) {
                            $onToken($token);
                        }
                    }
                }
            }

            $client->close();
        });
    }
}
```

### 8.2 前端性能优化

#### 8.2.1 Token 批量渲染

逐 Token 更新 React/Vue 状态会导致大量重渲染。使用 **requestAnimationFrame** 批量合并：

```tsx
// src/hooks/useBatchedTokens.ts
import { useRef, useCallback, useEffect } from 'react';

export function useBatchedTokenRenderer(
  onRender: (newContent: string) => void,
  batchSizeMs: number = 16, // 默认一帧 16ms
) {
  const pendingTokensRef = useRef<string[]>([]);
  const rafRef = useRef<number>(0);
  const renderedContentRef = useRef('');

  const flushTokens = useCallback(() => {
    if (pendingTokensRef.current.length === 0) return;

    const batch = pendingTokensRef.current.splice(0);
    renderedContentRef.current += batch.join('');
    onRender(renderedContentRef.current);

    rafRef.current = 0;
  }, [onRender]);

  const addToken = useCallback((token: string) => {
    pendingTokensRef.current.push(token);

    if (rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(flushTokens);
    }
  }, [flushTokens]);

  const reset = useCallback(() => {
    pendingTokensRef.current = [];
    renderedContentRef.current = '';
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { addToken, reset };
}

// 使用方式
function AiMessage() {
  const [content, setContent] = useState('');

  const { addToken, reset } = useBatchedTokenRenderer((newContent) => {
    setContent(newContent);
  });

  useEffect(() => {
    const eventSource = new EventSource('/api/chat/stream');
    // ... 在 onToken 回调中调用 addToken(token)
    return () => reset();
  }, []);

  return <MarkdownRenderer content={content} />;
}
```

#### 8.2.2 Markdown 增量渲染优化

流式输出的内容是不断增长的 Markdown，每次 Token 到达都重新解析整个文档效率很低。使用增量解析：

```tsx
import { useMemo } from 'react';
import { marked } from 'marked';

// 缓存已解析的 Markdown 块
function useIncrementalMarkdown(content: string) {
  return useMemo(() => {
    // 只重新解析最后一个代码块（可能还没闭合）
    // 其余部分使用缓存
    const lines = content.split('\n');
    const lastCodeBlockStart = lines.findLastIndex(l => l.trim().startsWith('```'));

    if (lastCodeBlockStart === -1) {
      // 没有未闭合的代码块，直接解析
      return marked.parse(content);
    }

    // 分割为已完成部分和进行中部分
    const completedPart = lines.slice(0, lastCodeBlockStart).join('\n');
    const pendingPart = lines.slice(lastCodeBlockStart).join('\n');

    return (
      (completedPart ? marked.parse(completedPart) : '') +
      `<pre><code>${escapeHtml(pendingPart)}</code></pre>`
    );
  }, [content]);
}
```

#### 8.2.3 虚拟滚动（长对话优化）

当对话消息数量很多时，使用虚拟滚动只渲染可见区域的消息：

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualizedMessageList({ messages }: { messages: Message[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // 根据消息内容估算高度
      const msg = messages[index];
      return Math.max(80, Math.ceil(msg.content.length / 50) * 24 + 40);
    },
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualItem => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <MessageBubble message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 8.3 系统级优化

#### 8.3.1 连接池与复用

```php
<?php

namespace App\Services\AiAgent;

use Illuminate\Support\Facades\Http;

class OptimizedHttpClient
{
    private static ?\GuzzleHttp\Client $client = null;

    public static function getClient(): \GuzzleHttp\Client
    {
        if (self::$client === null) {
            self::$client = new \GuzzleHttp\Client([
                'base_uri'    => config('services.openai.base_url', 'https://api.openai.com'),
                'timeout'     => 120,
                'connect_timeout' => 10,
                'headers'     => [
                    'Authorization' => 'Bearer ' . config('services.openai.api_key'),
                    'Content-Type'  => 'application/json',
                ],
                // 连接池配置
                'curl' => [
                    CURLOPT_TCP_KEEPALIVE => true,
                    CURLOPT_TCP_KEEPIDLE  => 30,
                    CURLOPT_TCP_KEEPINTVL => 10,
                ],
            ]);
        }

        return self::$client;
    }
}
```

#### 8.3.2 队列优先级

将 AI 流式任务放在专用队列，并配置优先级：

```php
// config/queue.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'queue' => 'default',
    'retry_after' => 300, // AI 任务可能耗时较长
    'block_for' => null,
],

// 队列 Worker 配置
// php artisan queue:work --queue=ai-stream,ai-batch,default --timeout=300
```

## 九、实际踩坑总结

### 踩坑 1：Nginx 缓冲导致 SSE 无响应

**现象**：后端日志显示 Token 正常推送，但前端一直收不到数据，直到所有 Token 推送完毕后一次性收到全部。

**原因**：Nginx 默认开启 `proxy_buffering on`，会缓冲后端响应直到连接关闭。

**解决**：

```nginx
location /api/chat/stream {
    proxy_buffering off;
    proxy_cache off;
    gzip off;  # gzip 也会缓冲

    # 或者使用 X-Accel-Buffering 头
    # 后端响应中添加: X-Accel-Buffering: no
}
```

### 踩坑 2：PHP 输出缓冲层级

**现象**：禁用了 Nginx 缓冲后，SSE 仍然不实时。原因是 PHP 自身有多层输出缓冲。

**原因**：PHP 默认有多个输出缓冲层级（php.ini 中的 `output_buffering`、Laravel 的 `ob_start` 等）。

**解决**：

```php
// 在流式响应开始前，关闭所有输出缓冲层级
while (ob_get_level() > 0) {
    ob_end_flush();
}
flush();
```

### 踩坑 3：PHP-FPM 进程耗尽

**现象**：多个用户同时使用 AI 对话时，整个网站变得无响应，包括普通页面。

**原因**：每个 SSE 连接占用一个 PHP-FPM 进程长达 30-60 秒。默认 50 个 FPM 进程，50 个并发 AI 对话就能耗尽所有进程。

**解决方案**：

1. **SSE 使用独立的 PHP-FPM 池**：
```ini
; /etc/php-fpm.d/sse.conf
[sse]
listen = /run/php-fpm-sse.sock
pm = dynamic
pm.max_children = 100
```

2. **或使用 Laravel Octane + Swoole**：
```bash
php artisan octane:start --workers=200
```

3. **或改用 WebSocket 方案**（WebSocket 连接不占用 PHP-FPM 进程）

### 踩坑 4：OpenAI API 流式中断

**现象**：流式输出进行到一半突然中断，前端收到不完整的响应。

**原因**：OpenAI 的流式连接可能因为多种原因中断：网络波动、服务端重启、上下文过长等。

**解决**：

```php
// 后端：记录已接收的内容，支持续传
class StreamWithRecovery
{
    public function streamWithRetry(callable $onToken, callable $onError): string
    {
        $fullContent = '';
        $maxRetries = 3;

        for ($attempt = 0; $attempt < $maxRetries; $attempt++) {
            try {
                $this->callOpenAi(function ($token) use (&$fullContent, $onToken) {
                    $fullContent .= $token;
                    $onToken($token);
                });
                return $fullContent;
            } catch (\Throwable $e) {
                if ($attempt === $maxRetries - 1) {
                    $onError($e->getMessage(), $fullContent);
                    return $fullContent;
                }
                // 等待后重试
                usleep(pow(2, $attempt) * 1000000);
            }
        }

        return $fullContent;
    }
}
```

### 踩坑 5：并发下对话上下文混乱

**现象**：快速连续发送多条消息时，AI 回复的上下文出现混乱——回复的内容与问题不匹配。

**原因**：后端没有对同一聊天的并发请求做排队处理，多个 SSE 请求同时调用 OpenAI API。

**解决**：

```php
use Illuminate\Support\Facades\Cache;

class ChatMutex
{
    public static function lock(string $chatId, callable $callback): mixed
    {
        $lock = Cache::lock("chat:stream:{$chatId}", 120);

        if ($lock->block(30)) { // 最多等待 30 秒获取锁
            try {
                return $callback();
            } finally {
                $lock->release();
            }
        }

        throw new \RuntimeException('获取聊天锁超时，其他消息正在处理中');
    }
}
```

### 踩坑 6：Chrome 浏览器 SSE 连接数限制

**现象**：Chrome 浏览器下，当用户打开多个标签页使用 AI 功能时，新的 SSE 连接无法建立。

**原因**：Chrome 对同一域名的 HTTP/1.1 连接数限制为 6 个（HTTP/2 为 100 个并发流）。SSE 每个连接占用一个。

**解决**：

1. 升级到 HTTP/2（推荐）：连接限制从 6 提升到 100
2. 使用独立域名做 SSE 推送（如 `sse-api.example.com`）
3. 使用 WebSocket 方案替代

### 踩坑 7：macOS Safari 的 SSE 缓冲

**现象**：Safari 浏览器下，SSE 数据不是逐 Token 到达，而是每积累几百毫秒才一次性刷新。

**原因**：Safari 的 EventSource 实现有内部缓冲，不会立即触发 onmessage。

**解决**：使用 `fetch` + `ReadableStream` 替代原生 `EventSource`：

```typescript
// fetch API 在所有浏览器中都能正确处理流式数据
const response = await fetch(url, { method: 'POST', body });
const reader = response.body!.getReader();
// 逐 chunk 读取，无缓冲问题
```

### 踩坑 8：Docker 容器中的 SSE

**现象**：在 Docker + Docker Compose 环境中，SSE 数据被缓冲。

**原因**：Docker 的网络层会缓冲小数据包。

**解决**：

```yaml
# docker-compose.yml
services:
  app:
    # ...
    environment:
      - PHP_CLI_SERVER_WORKERS=4
    # 对于 PHP 内置服务器
    command: php artisan serve --host=0.0.0.0
```

确保容器中也禁用输出缓冲：

```dockerfile
# Dockerfile
RUN echo "output_buffering=Off" >> /usr/local/etc/php/conf.d/streaming.ini
```

### 踩坑 9：流式输出中的安全问题

**现象**：恶意用户构造特殊输入，导致 LLM 输出不安全内容并实时推送给前端。

**解决**：

```php
class StreamSanitizer
{
    /**
     * 在 Token 推送前进行安全检查
     */
    public function sanitizeToken(string $token, string &$accumulated): string
    {
        $accumulated .= $token;

        // 检查是否包含敏感信息（如信用卡号、手机号等）
        if (preg_match('/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/', $accumulated)) {
            return '[内容已过滤]';
        }

        // 检查是否包含代码注入
        if (str_contains($token, '<script') || str_contains($token, 'javascript:')) {
            return htmlspecialchars($token, ENT_QUOTES, 'UTF-8');
        }

        return $token;
    }

    /**
     * 检查 LLM 输出是否触发内容安全策略
     */
    public function checkContentSafety(string $content): bool
    {
        // 集成内容安全 API（如 OpenAI Moderation）
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
        ])->post('https://api.openai.com/v1/moderations', [
            'input' => $content,
        ]);

        $result = $response->json('results.0');
        return !($result['flagged'] ?? false);
    }
}
```

## 十、完整架构方案对比与选型

### 10.1 最终方案对比

| 维度 | SSE 方案 | WebSocket 方案 |
|------|---------|---------------|
| **架构复杂度** | 低（纯 HTTP） | 中（需要 WS 服务器） |
| **运维成本** | 低 | 中（需要维护 Reverb/Soketi） |
| **并发能力** | 受限于 PHP-FPM 进程数 | 高（WS 连接轻量） |
| **双向通信** | 不支持（需要额外 API） | 原生支持 |
| **负载均衡** | 无需特殊处理 | 需要 sticky session 或 Redis 广播 |
| **CDN 兼容** | 完全兼容 | 不兼容 |
| **适用规模** | 中小规模（< 500 并发） | 大规模（> 500 并发） |
| **前端复杂度** | 低 | 中 |

### 10.2 推荐架构

**小型项目（个人博客/小团队工具）：**
- SSE + 原生 PHP-FPM
- 前端 fetch + ReadableStream
- Nginx 禁用缓冲即可

**中型项目（企业内部工具/数百用户）：**
- SSE + Laravel Octane (Swoole)
- 前端 fetch + 批量渲染优化
- Redis 缓存对话历史

**大型项目（ToC 产品/数千并发）：**
- WebSocket (Laravel Reverb) + Queue Worker
- 前端 Laravel Echo
- 专用 AI 处理微服务（Go/Rust 实现流式转发）
- Redis/Kafka 做消息队列

## 十一、总结

AI Agent 的流式响应是现代 LLM 应用的必备能力。通过本文的实战指南，你应该能够：

1. **选型**：理解 SSE 和 WebSocket 在 AI Agent 场景下的各自优势，做出合理选择
2. **后端实现**：掌握 Laravel 中 SSE 和 WebSocket 两种流式推送方案的完整实现
3. **LLM 集成**：实现 OpenAI/多模型的流式 API 调用和 Token-by-Token 推送
4. **前端渲染**：使用 React/Vue 实现实时流式渲染组件，包含优化技巧
5. **可靠性**：处理错误重连、超时恢复、并发控制等生产级问题
6. **性能**：优化 PHP-FPM 进程管理、使用 Octane/Swoole 提升并发能力
7. **避坑**：了解 9 个常见的生产环境踩坑及解决方案

**记住关键原则：**

- **90% 的 AI Agent 应用选择 SSE 就够了**——简单、可靠、运维友好
- **永远禁用 Nginx 的 proxy_buffering**——这是 SSE 最常见的坑
- **前端使用 fetch 而非 EventSource**——避免浏览器缓冲问题
- **PHP-FPM 进程数是 SSE 的硬瓶颈**——高并发必须用 Octane 或改 WebSocket

---

> **下一篇预告**：我们将深入探讨 AI Agent 的 **Function Calling 架构设计**——如何设计可扩展的工具注册机制、处理多轮 Tool Call 循环、实现工具执行结果的流式反馈，以及在 Laravel 中构建企业级的 Agent 工具链框架。

## 相关阅读

- [AI Agent + Laravel 实战：在 PHP 后端中集成 LLM 能力](/ai/AI-Agent-Laravel-LLM-Integration/) — Laravel 集成 LLM 的基础篇，讲解 API 调用、消息构造与 Service 层设计，是本文流式实现的前置基础。
- [Agentic RAG 实战：让 Agent 自主决定检索策略——Self-RAG、Corrective-RAG、Adaptive-RAG 在 Laravel 中的落地](/ai/Agentic-RAG-实战-让Agent自主决定检索策略-Self-RAG-Corrective-RAG-Adaptive-RAG在Laravel中的落地/) — 当 AI Agent 需要结合知识库检索时，如何用 Agentic RAG 架构增强流式对话的准确性。
- [AI Agent 成本优化对比：Token 压缩、模型路由、本地推理策略](/ai/ai-agent-cost-optimization-token-compression-model-routing-local-inference/) — 流式响应消耗大量 Token，本文介绍如何通过模型路由和 Token 压缩降低 LLM 调用成本。
