# Agent 流式响应

## 定义

Agent 流式响应是指 AI Agent 将 LLM 生成的 Token 逐个推送给客户端的技术，而非等待完整响应后一次性返回。流式响应显著降低用户感知延迟（Time to First Token, TTFT），提升交互体验。

## 核心原理

### SSE vs WebSocket

| 特性 | SSE (Server-Sent Events) | WebSocket |
|------|-------------------------|-----------|
| 方向 | 服务端 → 客户端（单向） | 双向 |
| 协议 | HTTP/1.1 或 HTTP/2 | ws:// |
| 重连 | 内置 Last-Event-ID | 需手动实现 |
| 适用场景 | LLM Token 流 | 双向交互、工具调用 |
| 浏览器支持 | EventSource API | WebSocket API |

### SSE 分块传输流程

```
LLM 生成 Token
    ↓
服务端 SSE 推送（data: {"token": "你"}\n\n）
    ↓
客户端 EventSource 接收
    ↓
逐 Token 渲染（requestAnimationFrame）
    ↓
工具调用中断 → 执行工具 → 结果回传 → 继续生成
```

### 断线恢复机制

使用 `Last-Event-ID` 实现断线续传：

```javascript
// 客户端
const eventSource = new EventSource('/api/chat/stream', {
  headers: { 'Last-Event-ID': lastReceivedId }
});

eventSource.onmessage = (event) => {
  lastReceivedId = event.lastEventId;
  renderToken(event.data);
};

// 服务端（Laravel）
return response()->eventStream(function () use ($chatId, $lastEventId) {
    // 从 lastEventId 位置继续生成
    $stream = $this->llm->resumeStream($chatId, $lastEventId);
    foreach ($stream as $chunk) {
        yield new ServerSentEvent($chunk->token, [
            'id' => $chunk->sequenceId
        ]);
    }
});
```

### 背压控制（Backpressure）

当客户端处理速度跟不上服务端推送速度时：

1. **客户端缓冲区**：限制渲染队列长度
2. **服务端限流**：根据 ACK 确认调整推送速度
3. **指数退避**：断线重连时使用指数退避避免雪崩

### 流式工具调用

当 LLM 决定调用工具时，流式响应需要特殊处理：

```
Token 流: "我来查一下" → [tool_call: search_orders] → ...
                                    ↓
                            执行工具（中断 Token 流）
                                    ↓
                            工具结果回传
                                    ↓
                            继续生成 Token 流
```

## 实战案例

来自博客文章：
- [AI Agent Streaming 进阶：SSE 分块传输与断线恢复](/2026/06/05/2026-06-05-ai-agent-streaming-sse-token-rendering-recovery-laravel/) - Laravel 后端 SSE 实战
- [AI Agent Streaming 实战：SSE/WebSocket 实时流式响应](/2026/06/05/AI-Agent-Streaming-实战/) - Token-by-Token 推送与前端渲染

## 相关概念

- [Function Calling 与工具使用](Function-Calling与工具使用.md) - 流式工具调用
- [Agent 错误恢复与韧性](Agent错误恢复与韧性.md) - 断线重连策略
- [Agent 多租户架构](Agent多租户架构.md) - 流式响应的用量计量

## 常见问题

### Q: SSE 和 WebSocket 该选哪个？
LLM 响应是典型的「服务端推送给客户端」场景，SSE 更简单高效。只有需要双向实时通信（如聊天室、协作编辑）时才用 WebSocket。

### Q: 如何处理流式响应中的工具调用？
服务端在检测到工具调用 Token 时，先推送一个 `tool_call` 事件，暂停 Token 流，执行工具后将结果作为新消息继续流式生成。
