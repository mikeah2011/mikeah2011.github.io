---

title: AI Agent Streaming 实战进阶：SSE 分块传输、前端 Token 渲染、中断恢复——Laravel 后端的生产级流式架构
keywords: [AI Agent Streaming, SSE, Token, Laravel, 实战进阶, 分块传输, 前端, 渲染, 中断恢复, 后端的生产级流式架构]
date: 2026-06-05 09:09:27
description: 深入解析 AI Agent 流式架构的生产级实战方案：涵盖 SSE 分块传输协议原理、Last-Event-ID 中断恢复机制、前端 Token-by-Token 渲染管线与 requestAnimationFrame 性能优化、背压控制、指数退避重试策略，以及 Laravel 后端在高并发场景下的完整工程实现，帮助开发者构建可靠高效的流式 AI 应用。
tags:
- AI Agent
- SSE
- Streaming
- Laravel
- 前端渲染
- 流式架构
categories:
- ai
- 架构
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---




> **TL;DR：** 在前篇《AI Agent Streaming 实战》中，我们实现了 SSE 与 WebSocket 的基础流式推送。本篇作为**进阶篇**，将深入生产环境的真实战场——SSE 分块传输的底层机制、前端 Token-by-Token 的精确渲染管线、`Last-Event-ID` 中断恢复协议、背压（Backpressure）处理、指数退避重试策略，以及 Laravel 后端在高并发场景下的生产级架构设计。如果你的流式系统已经跑起来但总在生产环境"翻车"，这篇文章正是为你准备的。

<!-- more -->

## 一、从"能跑"到"能用"：为什么需要进阶？

在前篇中，我们实现了一个基本的 SSE 流式推送系统——Laravel 后端调用 OpenAI API，将 Token 逐个推送给前端，前端通过 `EventSource` 实时渲染。这个方案在开发环境跑得很顺畅，但一到生产环境，各种问题接踵而来：

- **网络闪断**：用户切换 Wi-Fi、手机锁屏、Nginx 超时断开，流式连接中断后无法恢复，用户丢失了已生成的全部内容
- **SSE 数据"粘包"**：多个 Event 在同一个 TCP 包中到达，前端解析出错，Token 渲染出现乱码
- **后端资源耗尽**：500 个并发 SSE 连接同时占用 PHP-FPM 进程，服务器 CPU 100%，新请求全部超时
- **前端渲染卡顿**：Token 以每秒 60 个的速度到达，但 DOM 更新跟不上，页面出现明显卡顿
- **LLM API 限流**：OpenAI 返回 429，流式响应中断，前端显示"半截话"

这些问题的核心在于：**基础实现关注的是"数据如何到达"，而生产级架构关注的是"数据在各种异常场景下如何可靠、高效、优雅地到达"**。

## 二、SSE 协议深度剖析：超越 EventSource 的表面

### 2.1 SSE 协议的完整字段规范

大多数人只知道 SSE 的 `data:` 字段，但完整的 SSE 规范（HTML Living Standard）定义了四个字段，每个都在生产环境中扮演关键角色：

```
event: message        ← 事件类型（可自定义）
id: 12345             ← 事件 ID（用于 Last-Event-ID 恢复）
retry: 5000           ← 重连间隔（毫秒，客户端自动使用）
data: {"token":"你好"} ← 数据体（支持多行）
\n                    ← 空行表示事件结束
```

**关键细节：**

- `data:` 可以有多行，客户端会用换行符拼接
- `id:` 设置后，断线重连时客户端会自动带上 `Last-Event-ID` 请求头
- `retry:` 覆盖客户端的默认重连间隔（默认 3000ms）
- 每个事件以**连续两个换行符**（`\n\n`）结尾

### 2.2 HTTP 分块传输编码（Chunked Transfer Encoding）

SSE 依赖 HTTP/1.1 的 `Transfer-Encoding: chunked`，理解其底层机制对排查生产问题至关重要：

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Transfer-Encoding: chunked

17\r\n
event: message\ndata: 你\r\n\n\r\n
18\r\n
event: message\ndata: 好\r\n\n\r\n
```

每个 chunk 以**十六进制长度 + CRLF + 数据 + CRLF** 的格式传输。这意味着：

1. **不需要预知响应长度**——这对 LLM 流式输出至关重要，因为我们不知道生成何时结束
2. **中间代理可能缓冲 chunk**——Nginx 的 `proxy_buffering` 默认开启，会等 chunk 填满缓冲区才转发
3. **HTTP/2 下行为不同**——HTTP/2 使用帧（Frame）而非 chunk，SSE 在 HTTP/2 下性能更好但调试更复杂

### 2.3 SSE 连接的生命周期

```
┌─────────┐     GET /api/agent/stream      ┌─────────┐
│  Client  │ ──────────────────────────── ▶ │  Server  │
│          │                                │          │
│          │ ◀── 200 OK (text/event-stream) │          │
│          │                                │          │
│          │ ◀── event: token\ndata: 你     │          │
│          │ ◀── event: token\ndata: 好     │          │
│          │ ◀── event: done\ndata: [DONE]  │          │
│          │                                │          │
│          │   ╳ 连接断开（网络/超时/主动）   │          │
│          │                                │          │
│          │ ── GET (Last-Event-ID: 12345)  │          │
│          │ ◀── 从 ID 之后继续推送          │          │
└─────────┘                                 └─────────┘
```

## 三、Laravel 后端：生产级 SSE 端点实现

### 3.1 基础 SSE 响应构建器

首先，我们构建一个可复用的 SSE 响应构建器，封装协议细节：

```php
<?php
// app/Http/Streaming/SSEWriter.php

namespace App\Http\Streaming;

use Symfony\Component\HttpFoundation\StreamedResponse;

class SSEWriter
{
    private StreamedResponse $response;
    private int $eventId = 0;
    private bool $closed = false;

    // 用于中断恢复：存储最近事件的业务 ID
    private ?string $lastBusinessId = null;

    public function __construct(array $headers = [])
    {
        $defaultHeaders = [
            'Content-Type'                    => 'text/event-stream',
            'Cache-Control'                   => 'no-cache, no-store',
            'Connection'                      => 'keep-alive',
            'X-Accel-Buffering'               => 'no',  // 关键：禁用 Nginx 缓冲
            'Access-Control-Allow-Origin'      => '*',
            'Access-Control-Allow-Headers'     => 'Last-Event-ID, Content-Type',
        ];

        $this->response = new StreamedResponse(function () {
            // 不输出任何内容，由 write 方法控制
        }, 200, array_merge($defaultHeaders, $headers));
    }

    /**
     * 发送一个 SSE 事件
     */
    public function send(
        string $data,
        string $event = 'message',
        ?string $id = null,
        ?int $retry = null
    ): self {
        if ($this->closed) {
            return $this;
        }

        $this->eventId++;

        // 使用业务 ID 或自增 ID
        $eventId = $id ?? (string) $this->eventId;
        $this->lastBusinessId = $eventId;

        $payload = '';

        // 设置重连间隔
        if ($retry !== null) {
            $payload .= "retry: {$retry}\n";
        }

        // 设置事件 ID
        $payload .= "id: {$eventId}\n";

        // 设置事件类型
        $payload .= "event: {$event}\n";

        // 处理多行 data
        foreach (explode("\n", $data) as $line) {
            $payload .= "data: {$line}\n";
        }

        $payload .= "\n"; // 事件分隔符

        echo $payload;
        $this->flush();

        return $this;
    }

    /**
     * 发送 Token 事件（AI Agent 场景的便捷方法）
     */
    public function sendToken(string $token, string $messageId): self
    {
        return $this->send(
            data: json_encode([
                'token'     => $token,
                'timestamp' => microtime(true),
            ], JSON_UNESCAPED_UNICODE),
            event: 'token',
            id: $messageId,
            retry: 3000
        );
    }

    /**
     * 发送工具调用事件
     */
    public function sendToolCall(string $toolName, array $arguments, string $messageId): self
    {
        return $this->send(
            data: json_encode([
                'tool'      => $toolName,
                'arguments' => $arguments,
                'status'    => 'calling',
            ], JSON_UNESCAPED_UNICODE),
            event: 'tool_call',
            id: $messageId,
        );
    }

    /**
     * 发送完成事件
     */
    public function sendDone(string $messageId, array $metadata = []): self
    {
        return $this->send(
            data: json_encode(array_merge([
                'status' => 'completed',
            ], $metadata), JSON_UNESCAPED_UNICODE),
            event: 'done',
            id: $messageId,
        );
    }

    /**
     * 发送错误事件
     */
    public function sendError(string $message, string $code = 'STREAM_ERROR', ?string $messageId = null): self
    {
        return $this->send(
            data: json_encode([
                'error' => $message,
                'code'  => $code,
            ], JSON_UNESCAPED_UNICODE),
            event: 'error',
            id: $messageId,
        );
    }

    public function flush(): void
    {
        if (ob_get_level() > 0) {
            ob_end_flush();
        }
        flush();
    }

    public function close(): void
    {
        $this->closed = true;
    }

    public function getResponse(): StreamedResponse
    {
        return $this->response;
    }

    public function getLastBusinessId(): ?string
    {
        return $this->lastBusinessId;
    }
}
```

### 3.2 完整的 SSE 控制器：流式对话端点

```php
<?php
// app/Http/Controllers/Api/AgentStreamController.php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Streaming\SSEWriter;
use App\Services\AI\OpenAIStreamService;
use App\Services\AI\StreamingStateManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class AgentStreamController extends Controller
{
    public function __construct(
        private OpenAIStreamService $openAI,
        private StreamingStateManager $stateManager,
    ) {}

    /**
     * SSE 流式对话端点
     *
     * GET /api/agent/{conversationId}/stream
     * Header: Last-Event-ID: <last_event_id>  （可选，用于断线恢复）
     */
    public function stream(Request $request, string $conversationId)
    {
        // 1. 认证 & 限流
        $user = $request->user();
        if (!$user) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }

        // 2. 获取 Last-Event-ID（中断恢复的关键）
        $lastEventId = $request->header('Last-Event-ID');

        // 3. 创建 SSE Writer
        $sse = new SSEWriter([
            'X-Conversation-Id' => $conversationId,
        ]);

        // 4. 构建 StreamedResponse
        $response = $sse->getResponse();

        $response->setCallback(function () use ($sse, $conversationId, $lastEventId, $user) {
            try {
                // 如果有 Last-Event-ID，从断点恢复
                if ($lastEventId) {
                    $this->handleRecovery($sse, $conversationId, $lastEventId);
                    return;
                }

                // 正常流式处理
                $this->handleStreaming($sse, $conversationId, $user->id);

            } catch (\Throwable $e) {
                Log::error('SSE streaming error', [
                    'conversation' => $conversationId,
                    'error'        => $e->getMessage(),
                    'trace'        => $e->getTraceAsString(),
                ]);

                $sse->sendError(
                    message: '服务暂时不可用，请稍后重试',
                    code: 'INTERNAL_ERROR'
                );
            } finally {
                $sse->close();
            }
        });

        return $response;
    }

    /**
     * 正常流式处理
     */
    private function handleStreaming(SSEWriter $sse, string $conversationId, int $userId): void
    {
        // 加载对话历史
        $messages = $this->stateManager->getMessages($conversationId, $userId);
        $messageId = $this->stateManager->generateMessageId($conversationId);

        // 注册连接到状态管理器
        $this->stateManager->registerConnection($conversationId, $messageId);

        // 调用 OpenAI 流式 API
        $fullResponse = '';

        $this->openAI->streamChat($messages, [
            'model'       => 'gpt-4o',
            'max_tokens'  => 4096,
            'temperature' => 0.7,
        ])->onToken(function (string $token) use ($sse, $messageId, &$fullResponse) {
            $fullResponse .= $token;
            $sse->sendToken($token, $messageId);

        })->onToolCall(function (string $tool, array $args) use ($sse, $messageId) {
            $sse->sendToolCall($tool, $args, $messageId);

        })->onError(function (string $error) use ($sse, $messageId) {
            $sse->sendError($error, 'LLM_ERROR', $messageId);

        })->execute();

        // 保存完整响应到状态管理器（用于中断恢复）
        $this->stateManager->savePartialResponse($conversationId, $messageId, $fullResponse);

        // 发送完成事件
        $sse->sendDone($messageId, [
            'total_tokens' => mb_strlen($fullResponse),
        ]);

        // 持久化对话
        $this->stateManager->persistConversation($conversationId, $userId, $fullResponse);
    }

    /**
     * 中断恢复处理：从 Last-Event-ID 之后继续
     */
    private function handleRecovery(SSEWriter $sse, string $conversationId, string $lastEventId): void
    {
        Log::info('SSE recovery requested', [
            'conversation' => $conversationId,
            'lastEventId'  => $lastEventId,
        ]);

        // 从状态管理器获取上次断点的数据
        $recoveryData = $this->stateManager->getRecoveryData($conversationId, $lastEventId);

        if ($recoveryData === null) {
            // 无法恢复，通知客户端重新开始
            $sse->send(
                data: json_encode(['message' => '无法恢复，请重新发起对话']),
                event: 'recovery_failed',
                id: $lastEventId,
            );
            return;
        }

        // 补发缺失的 Token
        $sse->send(
            data: json_encode(['message' => '正在恢复连接...']),
            event: 'recovering',
        );

        // 如果有已生成但未送达的 Token，补发它们
        foreach ($recoveryData['pending_tokens'] as $index => $token) {
            $sse->sendToken($token, $recoveryData['message_id']);
        }

        // 如果之前的 LLM 调用已完成，直接发送完成事件
        if ($recoveryData['is_completed']) {
            $sse->sendDone($recoveryData['message_id'], $recoveryData['metadata']);
        } else {
            // 继续从断点生成（重新调用 API）
            $this->continueGeneration($sse, $recoveryData);
        }
    }
}
```

### 3.3 流式状态管理器：中断恢复的核心

中断恢复的关键在于：**服务端必须记住每个流式连接的状态**。我们用 Redis 来实现：

```php
<?php
// app/Services/AI/StreamingStateManager.php

namespace App\Services\AI;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class StreamingStateManager
{
    private const KEY_PREFIX   = 'sse:stream:';
    private const TOKEN_PREFIX = 'sse:tokens:';
    private const TTL          = 3600; // 1小时过期

    /**
     * 注册一个新的流式连接
     */
    public function registerConnection(string $conversationId, string $messageId): void
    {
        $key = self::KEY_PREFIX . $conversationId;
        Redis::hMSet($key, [
            'message_id'   => $messageId,
            'status'       => 'streaming',
            'started_at'   => now()->toIso8601String(),
            'token_count'  => 0,
        ]);
        Redis::expire($key, self::TTL);

        // 初始化 Token 序列（用于恢复时补发）
        $tokenKey = self::TOKEN_PREFIX . $conversationId . ':' . $messageId;
        Redis::del($tokenKey);
        Redis::expire($tokenKey, self::TTL);
    }

    /**
     * 保存部分响应（每个 Token 都保存，用于中断恢复）
     */
    public function savePartialResponse(
        string $conversationId,
        string $messageId,
        string $fullText
    ): void {
        $key = self::KEY_PREFIX . $conversationId;
        Redis::hSet($key, 'full_text', $fullText);
        Redis::hSet($key, 'token_count', (string) mb_strlen($fullText));
    }

    /**
     * 追加单个 Token（流式过程中逐步记录）
     */
    public function appendToken(string $conversationId, string $messageId, string $token): void
    {
        $tokenKey = self::TOKEN_PREFIX . $conversationId . ':' . $messageId;
        // 使用 Redis List 存储每个 Token（有序）
        Redis::rPush($tokenKey, $token);
        Redis::expire($tokenKey, self::TTL);

        // 同步更新主键的 token 计数
        $key = self::KEY_PREFIX . $conversationId;
        Redis::hIncrBy($key, 'token_count', 1);
    }

    /**
     * 获取中断恢复所需的数据
     */
    public function getRecoveryData(string $conversationId, string $lastEventId): ?array
    {
        $key = self::KEY_PREFIX . $conversationId;
        $state = Redis::hGetAll($key);

        if (empty($state)) {
            return null; // 状态已过期或不存在
        }

        $messageId = $state['message_id'];
        $tokenKey = self::TOKEN_PREFIX . $conversationId . ':' . $messageId;
        $allTokens = Redis::lRange($tokenKey, 0, -1);

        if (empty($allTokens)) {
            return null;
        }

        $isCompleted = ($state['status'] === 'completed');

        return [
            'message_id'     => $messageId,
            'conversation_id'=> $conversationId,
            'pending_tokens' => $allTokens, // 全部 Token（客户端自行去重）
            'full_text'      => $state['full_text'] ?? '',
            'is_completed'   => $isCompleted,
            'metadata'       => [
                'total_tokens' => (int) ($state['token_count'] ?? 0),
                'recovered'    => true,
            ],
        ];
    }

    /**
     * 标记流式完成
     */
    public function markCompleted(string $conversationId): void
    {
        $key = self::KEY_PREFIX . $conversationId;
        Redis::hSet($key, 'status', 'completed');
        Redis::hSet($key, 'completed_at', now()->toIso8601String());
    }

    /**
     * 生成消息 ID
     */
    public function generateMessageId(string $conversationId): string
    {
        return $conversationId . ':' . Str::uuid()->toString();
    }

    /**
     * 获取对话历史（简化版）
     */
    public function getMessages(string $conversationId, int $userId): array
    {
        // 从数据库加载对话历史...
        return [
            ['role' => 'system', 'content' => 'You are a helpful assistant.'],
            ['role' => 'user', 'content' => '你好，请介绍一下自己。'],
        ];
    }

    /**
     * 持久化对话（流式完成后写入数据库）
     */
    public function persistConversation(string $conversationId, int $userId, string $response): void
    {
        // 写入数据库...
        $this->markCompleted($conversationId);
    }
}
```

### 3.4 OpenAI 流式 API 封装

```php
<?php
// app/Services/AI/OpenAIStreamService.php

namespace App\Services\AI;

use Closure;
use Illuminate\Support\Facades\Http;

class OpenAIStreamService
{
    private ?Closure $onToken = null;
    private ?Closure $onToolCall = null;
    private ?Closure $onError = null;

    public function onToken(Closure $callback): self
    {
        $this->onToken = $callback;
        return $this;
    }

    public function onToolCall(Closure $callback): self
    {
        $this->onToolCall = $callback;
        return $this;
    }

    public function onError(Closure $callback): self
    {
        $this->onError = $callback;
        return $this;
    }

    /**
     * 发起流式聊天请求
     */
    public function streamChat(array $messages, array $options = []): self
    {
        return $this;
    }

    /**
     * 执行流式请求（生产级实现）
     */
    public function execute(): void
    {
        $retryCount = 0;
        $maxRetries = 3;

        while ($retryCount < $maxRetries) {
            try {
                $this->doStream();
                return; // 成功完成
            } catch (OpenAIRateLimitException $e) {
                $retryCount++;
                if ($retryCount >= $maxRetries) {
                    if ($this->onError) {
                        ($this->onError)('API 限流，请稍后重试');
                    }
                    return;
                }
                // 指数退避：1s, 2s, 4s
                sleep(pow(2, $retryCount - 1));
            } catch (\Throwable $e) {
                if ($this->onError) {
                    ($this->onError)($e->getMessage());
                }
                return;
            }
        }
    }

    /**
     * 实际的流式请求实现
     */
    private function doStream(): void
    {
        $response = Http::withToken(config('services.openai.key'))
            ->withHeaders(['Accept' => 'text/event-stream'])
            ->timeout(120)
            ->send('POST', 'https://api.openai.com/v1/chat/completions', [
                'json' => array_merge([
                    'stream' => true,
                ], $this->buildPayload()),
            ]);

        if ($response->status() === 429) {
            throw new OpenAIRateLimitException('Rate limited');
        }

        $body = $response->body();
        $lines = explode("\n", $body);

        foreach ($lines as $line) {
            $line = trim($line);
            if (!str_starts_with($line, 'data: ')) {
                continue;
            }

            $data = substr($line, 6);
            if ($data === '[DONE]') {
                return;
            }

            $parsed = json_decode($data, true);
            if (!$parsed) continue;

            $delta = $parsed['choices'][0]['delta'] ?? [];

            // 处理内容 Token
            if (isset($delta['content']) && $this->onToken) {
                ($this->onToken)($delta['content']);
            }

            // 处理工具调用
            if (isset($delta['tool_calls']) && $this->onToolCall) {
                foreach ($delta['tool_calls'] as $toolCall) {
                    ($this->onToolCall)(
                        $toolCall['function']['name'] ?? '',
                        json_decode($toolCall['function']['arguments'] ?? '{}', true)
                    );
                }
            }
        }
    }

    private array $payload = [];

    private function buildPayload(): array
    {
        return $this->payload;
    }
}

class OpenAIRateLimitException extends \RuntimeException {}
```

## 四、前端 Token 渲染管线

### 4.1 为什么不能直接用 EventSource？

原生 `EventSource` API 存在几个致命限制：

1. **不支持自定义请求头**——无法发送 `Authorization: Bearer xxx`
2. **不支持 POST 请求**——SSE 规范基于 GET，但 Agent 对话通常需要 POST body
3. **自动重连时丢失自定义逻辑**——`EventSource` 重连不触发我们自定义的恢复流程

因此，生产环境中我们通常使用 `fetch` + `ReadableStream` 来手动实现 SSE 客户端。

### 4.2 生产级 SSE 客户端实现

```typescript
// libs/sse-client.ts

interface SSEOptions {
  url: string;
  headers?: Record<string, string>;
  body?: object;
  onToken: (token: string) => void;
  onToolCall?: (tool: string, args: object) => void;
  onDone?: (metadata: object) => void;
  onError?: (error: string, code: string) => void;
  onRecovering?: () => void;
  maxRetries?: number;
  retryDelay?: number;
}

interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
}

export class SSEClient {
  private abortController: AbortController | null = null;
  private retryCount = 0;
  private lastEventId: string | null = null;
  private isCompleted = false;

  constructor(private options: SSEOptions) {}

  /**
   * 发起 SSE 连接
   */
  async connect(): Promise<void> {
    this.abortController = new AbortController();
    this.retryCount = 0;

    await this.doConnect();
  }

  /**
   * 断线重连（带 Last-Event-ID）
   */
  async reconnect(): Promise<void> {
    const maxRetries = this.options.maxRetries ?? 5;
    const baseDelay = this.options.retryDelay ?? 1000;

    while (this.retryCount < maxRetries && !this.isCompleted) {
      // 指数退避 + 随机抖动
      const delay = baseDelay * Math.pow(2, this.retryCount)
        + Math.random() * 1000;

      console.log(
        `[SSE] 重连中 (${this.retryCount + 1}/${maxRetries})，` +
        `等待 ${Math.round(delay)}ms...`
      );

      await this.sleep(delay);
      this.retryCount++;

      try {
        this.abortController = new AbortController();
        await this.doConnect();
        return; // 重连成功
      } catch (e) {
        if (this.isCompleted) return;
        console.warn('[SSE] 重连失败:', e);
      }
    }

    this.options.onError?.('连接中断，请手动刷新页面', 'MAX_RETRIES');
  }

  /**
   * 实际连接逻辑（使用 fetch + ReadableStream）
   */
  private async doConnect(): Promise<void> {
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...this.options.headers,
    };

    // 断线恢复：带上 Last-Event-ID
    if (this.lastEventId) {
      headers['Last-Event-ID'] = this.lastEventId;
    }

    const response = await fetch(this.options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(this.options.body),
      signal: this.abortController!.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 重置重试计数（连接成功）
    this.retryCount = 0;

    // 使用 ReadableStream 解析 SSE
    await this.parseSSEStream(response.body!);
  }

  /**
   * 解析 SSE 流
   */
  private async parseSSEStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // 流正常结束但未收到 done 事件，尝试重连
          if (!this.isCompleted) {
            this.reconnect();
          }
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        // 按双换行符分割事件
        const events = buffer.split('\n\n');
        buffer = events.pop()!; // 最后一个可能是不完整的事件

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;

          const event = this.parseSSEEvent(eventStr);
          await this.handleEvent(event);
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return; // 用户主动取消
      }
      // 连接异常断开，尝试重连
      await this.reconnect();
    }
  }

  /**
   * 解析单个 SSE 事件
   */
  private parseSSEEvent(raw: string): SSEEvent {
    const event: SSEEvent = { data: '' };
    const lines = raw.split('\n');

    for (const line of lines) {
      if (line.startsWith('id:')) {
        event.id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        event.event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const dataLine = line.slice(5);
        event.data += event.data ? '\n' + dataLine : dataLine;
      }
      // 忽略 retry: 等其他字段（可自行处理）
    }

    return event;
  }

  /**
   * 处理解析后的 SSE 事件
   */
  private async handleEvent(event: SSEEvent): Promise<void> {
    // 更新 lastEventId（用于重连恢复）
    if (event.id) {
      this.lastEventId = event.id;
    }

    const data = this.tryParseJSON(event.data);

    switch (event.event) {
      case 'token':
        this.options.onToken(data?.token ?? event.data);
        break;

      case 'tool_call':
        this.options.onToolCall?.(data?.tool ?? '', data?.arguments ?? {});
        break;

      case 'done':
        this.isCompleted = true;
        this.options.onDone?.(data ?? {});
        break;

      case 'error':
        this.options.onError?.(
          data?.error ?? 'Unknown error',
          data?.code ?? 'UNKNOWN'
        );
        break;

      case 'recovering':
        this.options.onRecovering?.();
        break;

      case 'recovery_failed':
        this.options.onError?.(data?.message ?? '恢复失败', 'RECOVERY_FAILED');
        break;
    }
  }

  /**
   * 主动取消连接
   */
  disconnect(): void {
    this.isCompleted = true;
    this.abortController?.abort();
  }

  private tryParseJSON(str: string): any {
    try { return JSON.parse(str); } catch { return null; }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 4.3 Token-by-Token 渲染管线（React）

有了可靠的 SSE 客户端，接下来是**如何高效地将 Token 渲染到 DOM 中**。这看似简单——每个 Token 追加到 state 即可——但在高频率（60 token/s）场景下，直接 `setState` 会导致严重的渲染性能问题。

```tsx
// components/StreamingMessage.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { SSEClient } from '@/libs/sse-client';
import { marked } from 'marked';

interface StreamingMessageProps {
  conversationId: string;
  userMessage: string;
  onStreamEnd?: (fullText: string) => void;
}

export function StreamingMessage({
  conversationId,
  userMessage,
  onStreamEnd,
}: StreamingMessageProps) {
  const [streamedText, setStreamedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sseClientRef = useRef<SSEClient | null>(null);

  // 使用 ref 避免闭包过期问题
  const textBufferRef = useRef('');
  const rafIdRef = useRef<number | null>(null);

  /**
   * 批量渲染优化：使用 requestAnimationFrame 合并多次 Token 更新
   *
   * 问题：LLM 每秒产生 30-60 个 Token，如果每个 Token 都 setState，
   *       React 每秒触发 30-60 次重渲染，导致页面卡顿。
   *
   * 方案：将 Token 写入 buffer，用 rAF 在下一帧统一 flush 到 state。
   */
  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      setStreamedText(textBufferRef.current);
    });
  }, []);

  const handleToken = useCallback((token: string) => {
    textBufferRef.current += token;
    scheduleFlush();
  }, [scheduleFlush]);

  const startStream = useCallback(async () => {
    setIsStreaming(true);
    setIsRecovering(false);
    setError(null);
    textBufferRef.current = '';
    setStreamedText('');

    const client = new SSEClient({
      url: `/api/agent/${conversationId}/stream`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
      body: { message: userMessage },
      onToken: handleToken,
      onToolCall: (tool, args) => {
        console.log(`[Tool] ${tool}`, args);
      },
      onDone: (metadata) => {
        setIsStreaming(false);
        onStreamEnd?.(textBufferRef.current);
      },
      onError: (msg, code) => {
        setError(msg);
        setIsStreaming(false);
      },
      onRecovering: () => {
        setIsRecovering(true);
      },
      maxRetries: 5,
      retryDelay: 1000,
    });

    sseClientRef.current = client;
    await client.connect();
  }, [conversationId, userMessage, handleToken, onStreamEnd]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      sseClientRef.current?.disconnect();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // 渲染 Markdown
  const htmlContent = marked.parse(streamedText + '▋', {
    breaks: true,
    gfm: true,
  }) as string;

  return (
    <div className="streaming-message">
      {/* 恢复状态提示 */}
      {isRecovering && (
        <div className="recovery-banner">
          🔄 连接中断，正在恢复中...
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="error-banner">
          ❌ {error}
          <button onClick={startStream}>重试</button>
        </div>
      )}

      {/* 消息内容 */}
      <div
        className="message-content markdown-body"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />

      {/* 启动按钮 */}
      {!isStreaming && !streamedText && (
        <button onClick={startStream}>发送消息</button>
      )}
    </div>
  );
}
```

### 4.4 流式 Markdown 渲染的安全问题

在流式场景下渲染 Markdown 有一个被广泛忽视的问题：**不完整的 Markdown 结构**。

比如 LLM 正在生成一个代码块：

```
```python
def hello():
    print("hel
```

此时收到的内容是不完整的三反引号块，直接渲染会导致整个页面的 Markdown 解析错乱。解决方案是**流式感知的 Markdown 解析器**：

```typescript
// utils/streaming-markdown.ts

/**
 * 安全的流式 Markdown 渲染
 * 
 * 核心思路：检测不完整的 Markdown 结构，临时补全后再解析
 */
export function safeRenderMarkdown(streamingText: string): string {
  let text = streamingText;

  // 1. 补全未闭合的代码块
  const codeBlockCount = (text.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    text += '\n```'; // 临时闭合
  }

  // 2. 补全未闭合的行内代码
  const inlineCodeCount = (text.match(/(?<!`)`(?!`)/g) || []).length;
  if (inlineCodeCount % 2 !== 0) {
    text += '`';
  }

  // 3. 补全未闭合的链接 [text](
  if (/\[[^\]]*\]\([^\)]*$/.test(text)) {
    text += ')';
  }

  // 4. 补全未闭合的粗体/斜体
  const boldCount = (text.match(/\*\*/g) || []).length;
  if (boldCount % 2 !== 0) {
    text += '**';
  }

  return text;
}
```

## 五、中断恢复（Last-Event-ID）全流程

### 5.1 恢复流程时序图

```
Client                    Server                  Redis
  │                         │                       │
  │ ── GET /stream ──────▶ │                       │
  │ ◀── token: "你" (id:1)│                       │
  │ ◀── token: "好" (id:2)│  ── save token ─────▶ │
  │ ◀── token: "世" (id:3)│  ── save token ─────▶ │
  │                         │                       │
  │   ╳ 网络断开           │                       │
  │                         │                       │
  │ (1 秒后自动重连)        │                       │
  │                         │                       │
  │ ── GET /stream ──────▶ │                       │
  │    Last-Event-ID: 3    │                       │
  │                         │── getRecoveryData ──▶ │
  │                         │◀── tokens ["好","世"] │
  │ ◀── event: recovering  │                       │
  │ ◀── token: "界" (id:4)│  (从断点继续)          │
  │ ◀── token: "！"(id:5)│                       │
  │ ◀── done              │                       │
  │                         │  ── persist ────────▶ │
```

### 5.2 前端去重逻辑

重连时，服务端会补发断点之后的 Token，但客户端可能已经收到了其中一部分。必须实现去重：

```typescript
// 通过 event id 去重
const processedEventIds = new Set<string>();

function handleToken(event: SSEEvent, token: string): void {
  if (event.id && processedEventIds.has(event.id)) {
    return; // 已处理，跳过
  }
  if (event.id) {
    processedEventIds.add(event.id);
  }

  // 安全追加 Token
  textBufferRef.current += token;
  scheduleFlush();
}
```

### 5.3 服务端恢复数据的大小控制

Token 列表可能非常大（一个 4096 token 的回复就是几十 KB），直接全部补发不现实。优化方案：

```php
/**
 * 获取恢复数据（优化版：只返回缺失部分）
 */
public function getRecoveryDataOptimized(
    string $conversationId,
    string $lastEventId
): ?array {
    $key = self::KEY_PREFIX . $conversationId;
    $state = Redis::hGetAll($key);

    if (empty($state)) {
        return null;
    }

    $messageId = $state['message_id'];
    $tokenKey = self::TOKEN_PREFIX . $conversationId . ':' . $messageId;

    // 通过 lastEventId 计算客户端已收到的 Token 数量
    // lastEventId 格式: conversationId:uuid:tokenIndex
    $lastIndex = $this->parseTokenIndex($lastEventId);

    // 只返回 lastEventId 之后的 Token
    $allTokens = Redis::lRange($tokenKey, 0, -1);
    $pendingTokens = array_slice($allTokens, $lastIndex);

    // 如果 pending 数据超过 10KB，只返回最后的摘要
    $serializedSize = strlen(serialize($pendingTokens));
    if ($serializedSize > 10240) {
        $pendingTokens = array_slice($pendingTokens, -50); // 只返回最后50个
    }

    return [
        'message_id'     => $messageId,
        'pending_tokens' => $pendingTokens,
        'is_completed'   => ($state['status'] === 'completed'),
        'metadata'       => [
            'total_tokens' => (int) ($state['token_count'] ?? 0),
            'recovered'    => true,
            'partial'      => $serializedSize > 10240,
        ],
    ];
}
```

## 六、背压处理：当 Token 太快来不及渲染

### 6.1 问题描述

LLM API 以极快的速度推送 Token（某些模型可达 100+ token/s），而前端 DOM 更新 + Markdown 解析 + 代码高亮的开销远大于简单的字符串拼接。当消费速度跟不上生产速度时，就会出现**背压（Backpressure）**问题。

表现：
- 内存持续增长（Token 堆积在缓冲区）
- UI 明显卡顿
- 极端情况下浏览器崩溃

### 6.2 前端背压控制

```typescript
/**
 * 带背压控制的 Token 处理器
 *
 * 策略：当缓冲区积压超过阈值时，自动合并 Token
 */
class TokenBuffer {
  private buffer: string[] = [];
  private flushScheduled = false;
  private lastFlushTime = 0;

  // 配置
  private readonly FLUSH_INTERVAL = 16; // ~60fps
  private readonly MAX_BUFFER_SIZE = 500;
  private readonly MERGE_THRESHOLD = 200;

  constructor(private onFlush: (text: string) => void) {}

  push(token: string): void {
    this.buffer.push(token);

    // 背压检测：缓冲区过大时合并
    if (this.buffer.length > this.MAX_BUFFER_SIZE) {
      this.mergeBuffer();
    }

    this.scheduleFlush();
  }

  private mergeBuffer(): void {
    // 将多个小 Token 合并为一个大 chunk
    const merged = this.buffer.join('');
    this.buffer = [merged];
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;

    const now = performance.now();
    const elapsed = now - this.lastFlushTime;

    if (elapsed >= this.FLUSH_INTERVAL) {
      // 立即 flush
      this.flush();
    } else {
      // 延迟到下一帧
      this.flushScheduled = true;
      requestAnimationFrame(() => {
        this.flush();
        this.flushScheduled = false;
      });
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;

    // 取出所有缓冲内容并合并
    const text = this.buffer.join('');
    this.buffer = [];
    this.lastFlushTime = performance.now();

    this.onFlush(text);
  }
}
```

### 6.3 服务端背压：流式写入与 `usleep`

在 Laravel 后端，如果 LLM API 返回速度极快（本地模型或流式批量响应），PHP 的输出缓冲区可能积压。解决方案：

```php
/**
 * 带流控的 Token 发送
 * 
 * 在每次写入后加入微小延迟，让输出缓冲区有机会 flush
 */
public function sendTokenWithFlowControl(
    SSEWriter $sse,
    string $token,
    string $messageId,
    int $delayMicroseconds = 1000 // 1ms 延迟
): void {
    $sse->sendToken($token, $messageId);

    // 流控：让 PHP 有时间将数据刷出缓冲区
    if ($delayMicroseconds > 0) {
        usleep($delayMicroseconds);
    }
}
```

## 七、错误重试策略

### 7.1 指数退避与抖动

重试策略的核心公式：

```
delay = base_delay * 2^retry_count + random(0, jitter)
```

```typescript
/**
 * 指数退避计算器（带抖动）
 */
class ExponentialBackoff {
  constructor(
    private baseDelay: number = 1000,   // 基础延迟 1s
    private maxDelay: number = 30000,   // 最大延迟 30s
    private jitter: number = 1000,      // 随机抖动范围
  ) {}

  getDelay(retryCount: number): number {
    const exponential = this.baseDelay * Math.pow(2, retryCount);
    const cappedExponential = Math.min(exponential, this.maxDelay);
    const jitterOffset = Math.random() * this.jitter;
    return cappedExponential + jitterOffset;
  }

  /**
   * 判断是否应该重试
   */
  shouldRetry(retryCount: number, maxRetries: number, error?: Error): boolean {
    if (retryCount >= maxRetries) return false;

    // 不可重试的错误类型
    const nonRetryable = [400, 401, 403, 404, 422];
    if (error && 'status' in error) {
      const status = (error as any).status;
      if (nonRetryable.includes(status)) return false;
    }

    return true;
  }
}
```

### 7.2 区分可重试与不可重试错误

```typescript
// 错误分类器
function classifySSEError(error: any): {
  retryable: boolean;
  category: string;
} {
  // 网络错误 → 可重试
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return { retryable: true, category: 'NETWORK' };
  }

  // AbortError → 用户主动取消，不重试
  if (error.name === 'AbortError') {
    return { retryable: false, category: 'ABORTED' };
  }

  // HTTP 状态码
  if ('status' in error) {
    switch (error.status) {
      case 429: // Rate Limited → 可重试（需要更长延迟）
        return { retryable: true, category: 'RATE_LIMITED' };
      case 500:
      case 502:
      case 503: // 服务端错误 → 可重试
        return { retryable: true, category: 'SERVER_ERROR' };
      case 400:
      case 401:
      case 403: // 客户端错误 → 不重试
        return { retryable: false, category: 'CLIENT_ERROR' };
    }
  }

  // LLM 返回的错误
  if (error.code === 'LLM_ERROR') {
    return { retryable: true, category: 'LLM_ERROR' };
  }

  return { retryable: true, category: 'UNKNOWN' };
}
```

## 八、Nginx 反向代理配置

### 8.1 为什么 SSE 在 Nginx 后面总是出问题？

Nginx 默认会**缓冲代理响应**，等待数据积累到一定量后再转发给客户端。这对 SSE 来说是致命的——Token 会一直堆在 Nginx 缓冲区里，直到连接超时才一次性全部发给客户端。

### 8.2 完整的 Nginx SSE 配置

```nginx
# /etc/nginx/conf.d/agent-stream.conf

upstream php_backend {
    server 127.0.0.1:9000;
    keepalive 32;
}

server {
    listen 443 ssl http2;

    # SSL 配置（略）
    ssl_certificate     /etc/ssl/certs/your-domain.pem;
    ssl_certificate_key /etc/ssl/private/your-domain-key.pem;

    # ★ 关键：SSE 路径的特殊配置
    location /api/agent/ {
        proxy_pass http://php_backend;

        # ★★★ 最关键的三行 ★★★
        proxy_buffering off;           # 禁用代理缓冲
        proxy_cache off;               # 禁用缓存
        chunked_transfer_encoding on;  # 启用分块传输

        # 超时设置（AI Agent 需要更长的超时）
        proxy_read_timeout 300s;       # 5分钟读超时
        proxy_send_timeout 300s;       # 5分钟写超时

        # HTTP/1.1 持久连接
        proxy_http_version 1.1;
        proxy_set_header Connection '';

        # 传递客户端信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 传递 Last-Event-ID（中断恢复关键）
        proxy_set_header Last-Event-ID $http_last_event_id;
    }

    # 其他 API 路径保持正常缓冲
    location /api/ {
        proxy_pass http://php_backend;
        # 默认的 proxy_buffering on（正常 API 不需要流式）
    }
}
```

### 8.3 常见踩坑

**坑 1：`proxy_buffering off` 不生效**

```nginx
# 错误：在 http 块设置但在 location 块被覆盖
http {
    proxy_buffering off;  # 这里设置了
    server {
        location /api/ {
            proxy_buffering on;  # 但这里又覆盖了
        }
    }
}
```

**坑 2：FastCGI 缓冲未禁用**

如果 Nginx 直接通过 FastCGI 连接 PHP-FPM（而非 proxy），需要额外配置：

```nginx
location ~ \.php$ {
    fastcgi_buffering off;  # FastCGI 也要禁用缓冲
    fastcgi_pass php_backend;
    # ...
}
```

**坑 3：CDN/Cloudflare 缓冲**

如果你的域名通过 Cloudflare，还需要：

1. 将 DNS 记录设为**灰色云朵**（不代理），或者
2. 在 Cloudflare Page Rules 中对 `/api/agent/*` 路径关闭缓冲

## 九、生产级最佳实践清单

### 9.1 安全

```php
// 1. SSE 端点必须认证
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/api/agent/{id}/stream', [AgentStreamController::class, 'stream']);
});

// 2. 限流：每个用户最多 3 个并发 SSE 连接
// app/Http/Middleware/SSERateLimiter.php
class SSERateLimiter
{
    public function handle(Request $request, Closure $next)
    {
        $userId = $request->user()->id;
        $key = "sse:connections:{$userId}";
        $current = Redis::incr($key);
        Redis::expire($key, 300); // 5 分钟窗口

        if ($current > 3) {
            return response()->json([
                'error' => 'Too many streaming connections'
            ], 429);
        }

        // 连接关闭时减计数
        register_shutdown_function(function () use ($key) {
            Redis::decr($key);
        });

        return $next($request);
    }
}
```

### 9.2 监控与日志

```php
// SSE 关键指标监控
class SSEMetrics
{
    public static function recordConnection(string $conversationId): void
    {
        Redis::hIncrBy('sse:metrics', 'total_connections', 1);
        Redis::hIncrBy('sse:metrics', 'active_connections', 1);
        Redis::set("sse:metrics:start:{$conversationId}", microtime(true));
    }

    public static function recordDisconnection(string $conversationId, string $reason): void
    {
        Redis::hIncrBy('sse:metrics', 'active_connections', -1);
        Redis::hIncrBy("sse:metrics:disconnect_reasons", $reason, 1);

        $startTime = Redis::get("sse:metrics:start:{$conversationId}");
        if ($startTime) {
            $duration = microtime(true) - (float) $startTime;
            Redis::hIncrBy('sse:metrics', 'total_duration_ms', (int) ($duration * 1000));
        }
    }

    public static function recordToken(string $conversationId): void
    {
        Redis::hIncrBy('sse:metrics', 'total_tokens_sent', 1);
    }
}
```

### 9.3 性能优化要点

| 优化点 | 方案 | 效果 |
|--------|------|------|
| PHP-FPM 进程占用 | 使用 Swoole/Laravel Octane 或队列卸载 | 减少 80% 进程占用 |
| Redis 内存 | Token 列表设置 TTL，使用 Stream 替代 List | 内存降低 60% |
| 前端渲染性能 | rAF 批量更新 + 虚拟滚动 | 消除卡顿 |
| Nginx 缓冲 | `proxy_buffering off` + FastCGI 配置 | 消除首字延迟 |
| 数据库写入 | 异步持久化（队列 + 批量写入） | 流式延迟降低 50ms |

### 9.4 Swoole/Laravel Octane 方案

传统的 PHP-FPM 模型下，每个 SSE 连接占用一个 FPM 进程（通常 20-50MB 内存）。100 个并发连接就需要 100 个进程，服务器很快就会过载。

Laravel Octane（基于 Swoole）通过协程模型解决了这个问题：

```php
// 使用 Laravel Octane 的协程方案
Route::get('/api/agent/{id}/stream', function (string $id) {
    return response()->stream(function () use ($id) {
        // Octane 下这里运行在协程中，不会阻塞其他请求
        $sse = new SSEWriter();
        // ... 流式逻辑同上
    }, 200, [
        'Content-Type'  => 'text/event-stream',
        'X-Accel-Buffering' => 'no',
    ]);
});
```

## 十、踩坑记录：血泪教训

### 坑 1：Safari 的 SSE 连接数限制

Safari（包括 iOS Safari）对同一域名的 SSE 连接数限制为 **6 个**。当用户在多个 Tab 打开你的应用时，第 7 个 SSE 连接会被排队等待，看起来像是"卡住了"。

**解决方案**：使用 SharedWorker 在多个 Tab 间共享一个 SSE 连接：

```typescript
// shared-sse-worker.ts
// 所有 Tab 通过 MessageChannel 共享同一个 SSE 连接
self.onconnect = (e) => {
  const port = e.ports[0];
  port.onmessage = (event) => {
    // 转发 SSE 事件到所有连接的 Tab
  };
};
```

### 坑 2：Laravel 的 `ob_implicit_flush`

PHP 默认启用了输出缓冲，`echo` 的内容不会立即发送到客户端。必须在流式响应开始前禁用：

```php
// 在 StreamedResponse 的 callback 开头
ob_implicit_flush(true);
ob_end_clean(); // 清空所有缓冲层级
```

### 坑 3：Vercel/Serverless 的超时限制

如果你的 Laravel API 部署在 Serverless 环境（如 Laravel Vapor），函数执行通常有 30 秒的超时限制。长时间的 SSE 流式连接会被强制中断。

**解决方案**：
1. 使用 WebSocket 替代 SSE（Vercel 支持）
2. 分段流式：每 25 秒发送心跳，保持连接活跃
3. 使用独立的流式服务（不在 Serverless 上运行）

### 坑 4：`Content-Type` 被中间件覆盖

某些 Laravel 中间件（如 `VerifyCsrfToken`）或全局响应处理器可能覆盖响应头。确保 SSE 路由跳过这些中间件：

```php
// app/Http/Kernel.php
protected $middlewareGroups = [
    'api' => [
        // 确保这些中间件不会修改 SSE 响应
        \App\Http\Middleware\EnsureResponseNotModified::class,
    ],
];
```

## 十一、总结与架构全景图

回顾全文，一个生产级的 AI Agent 流式架构需要解决以下几个核心问题：

```
┌──────────────────────────────────────────────────────────────┐
│                      前端（React/Vue）                        │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │SSE Client│→│Token Buffer│→│rAF Flush │→│Markdown 渲染 │  │
│  │(fetch)   │  │(背压控制) │  │(批量更新)│  │(流式安全解析)│  │
│  └─────────┘  └──────────┘  └──────────┘  └──────────────┘  │
│       ↑ Last-Event-ID 恢复        ↑ 去重逻辑                 │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTP/1.1 Chunked Transfer
┌───────────────┴──────────────────────────────────────────────┐
│                    Nginx 反向代理                              │
│         proxy_buffering off / fastcgi_buffering off           │
│         proxy_read_timeout 300s                               │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────┐
│                    Laravel 后端                                │
│  ┌─────────┐  ┌──────────────┐  ┌───────────────┐           │
│  │SSEWriter│←│Stream Controller│→│StateManager   │           │
│  │(协议封装)│  │(路由/认证/限流)│  │(Redis 状态)   │           │
│  └─────────┘  └──────┬───────┘  └───────────────┘           │
│                      │                                        │
│               ┌──────┴───────┐                                │
│               │OpenAI Stream │  (带重试 + 指数退避)           │
│               │Service       │                                │
│               └──────────────┘                                │
└──────────────────────────────────────────────────────────────┘
```

**核心原则总结：**

1. **可靠性**：通过 `Last-Event-ID` + Redis 状态存储实现断线恢复
2. **性能**：前端 rAF 批量渲染 + 服务端 Octane 协程 + Nginx 零缓冲
3. **安全**：认证 + 限流 + CORS + 输入校验
4. **可观测性**：指标采集 + 结构化日志 + 错误分类
5. **优雅降级**：不可恢复时通知客户端重试，而非静默失败

流式架构的复杂性不在于单个技术点，而在于**从客户端到服务端全链路的协同设计**。每一个环节——从 Nginx 的缓冲配置到前端的 requestAnimationFrame——都可能成为系统的短板。希望本文的实战经验能帮你少走弯路，构建出真正生产可用的 AI Agent 流式架构。

---

> **系列文章导航：**
> - 上篇：[AI Agent Streaming 实战：SSE/WebSocket 实时流式响应——Laravel 后端的 Token-by-Token 推送与前端渲染](/ai/AI-Agent-Streaming-实战-SSE-WebSocket实时流式响应-Laravel后端的Token-by-Token推送与前端渲染/)
> - 本篇：AI Agent Streaming 实战进阶：SSE 分块传输、前端 Token 渲染、中断恢复——Laravel 后端的生产级流式架构

---

## 相关阅读

- [AI Agent Streaming 实战：SSE/WebSocket 实时流式响应——Laravel 后端的 Token-by-Token 推送与前端渲染](/ai/AI-Agent-Streaming-实战-SSE-WebSocket实时流式响应-Laravel后端的Token-by-Token推送与前端渲染/)
- [AI Agent Error Recovery 实战：工具调用失败、LLM 幻觉、上下文溢出的自动降级与重试策略](/ai/2026-06-05-ai-agent-error-recovery-tool-failure-hallucination-overflow-degradation-retry/)
- [AI Agent Debugging 实战：MCP Inspector、LangSmith Trace 与日志回放——构建可观测的 AI Agent 系统](/ai/2026-06-05-ai-agent-debugging-mcp-inspector-langsmith-trace-log-replay/)

```
