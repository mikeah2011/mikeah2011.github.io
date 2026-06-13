---
title: Vercel AI SDK 实战：TypeScript 的 LLM 统一抽象——Streaming/Tool Calls/Structured Output 与 Laravel 后端的混合架构
keywords: [Vercel AI SDK, TypeScript, LLM, Streaming, Tool Calls, Structured Output, Laravel, 统一抽象, 后端的混合架构, AI]
date: 2026-06-10 06:15:00
categories:
  - ai
  - frontend
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
tags:
  - Vercel AI SDK
  - TypeScript
  - Laravel
  - Streaming
  - Tool Calls
  - Structured Output
  - LLM
  - BFF
description: 深入实战 Vercel AI SDK 在 TypeScript 前端的统一 LLM 抽象能力，覆盖 Streaming、Tool Calls、Structured Output 三大核心能力，并结合 Laravel 后端设计一套可落地的混合架构方案，适合需要在生产环境同时治理前端交互与后端权限/计费/数据安全的团队。
---

最近两年 LLM 应用越来越像“前端驱动体验、后端控制边界”的典型架构：前端负责流式渲染、工具调用可视化、交互态管理；后端负责 Provider 管理、权限校验、审计计费、敏感数据访问和二次处理。很多团队在早期会各自对接 OpenAI、Anthropic、Google 等不同 API，结果很快就会遇到接口差异、流式协议不统一、工具调用结构混乱、结构化输出校验分散等问题。

这正是 **Vercel AI SDK** 的价值所在。

在 TypeScript 生态里，Vercel AI SDK 提供了一个相当统一的抽象层，能够同时处理：

- Streaming 文本输出
- Tool Calls 工具调用
- Structured Output 结构化输出
- 多 Provider 切换
- 前端 `useChat` / `useCompletion` 交互态

但现实中，纯前端直连 LLM 在生产项目里往往不够安全，也不够可控。更常见的做法是 **TypeScript 前端 + Laravel 后端混合架构**：

- 前端通过 BFF 或 Next.js API Route 调用统一入口
- Laravel 负责权限、计费、限流、日志、工具执行、数据访问
- Provider Key、Prompt 策略、敏感数据统一收敛在后端

这篇文章就围绕这个混合架构，系统讲一下 Vercel AI SDK 在实际项目里的落地方式。

## 为什么不是前端直接对接 LLM Provider

很多 PoC 阶段会前端直连 OpenAI/Anthropic，这在原型验证时没问题，但进入生产后通常会出现几类问题：

### 1. Key 暴露风险

前端直连通常需要把 API Key 放在前端环境变量或 BFF 里。一旦配置不当，就可能造成密钥泄露。即便通过 BFF 隐藏密钥，前端也很难统一管理多 Provider 的切换、限流和计费。

### 2. 工具调用不该全在前端执行

Tool Calls 是 LLM 应用的核心能力之一，但很多工具天然需要后端权限：

- 查询订单
- 修改用户信息
- 调用内部微服务
- 访问数据库
- 执行支付或退款

如果工具执行全放在前端，不仅安全边界模糊，而且很难做审计、重试、幂等和失败恢复。

### 3. Streaming 协议需要统一收口

不同模型 Provider 的 Streaming 行为存在差异。Vercel AI SDK 虽然做了抽象，但仍然建议在后端统一收口，因为后端可以：

- 做统一日志
- 做 Provider 降级
- 做 retry/backoff
- 做 response normalization
- 做 usage 统计

### 4. 结构化输出需要后端兜底

Structured Output 是很实用的能力，比如让模型直接输出 JSON，但前端不适合做“可信数据源”。更合理的做法是：

- 前端渲染结构化结果
- 后端校验并落库
- 后端再决定是否信任该结果

这才能形成稳定闭环。

## Vercel AI SDK 的核心能力

如果用一句话概括，Vercel AI SDK 就是 **TypeScript 里的 LLM 统一抽象层**。它的价值不仅在于调用更方便，而在于让前端代码不必绑定特定 Provider。

### Streaming

Streaming 是现代 LLM 应用的标配。用户更希望看到“逐字生成”，而不是等很久才看到一整段回答。

Vercel AI SDK 提供了统一的流式处理抽象，前端可以非常自然地接入：

```ts
import { useChat } from '@ai-sdk/react';

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <strong>{m.role}：</strong>
          {m.content}
        </div>
      ))}

      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

这段代码的价值不在于“看起来简单”，而在于它把消息列表、输入态、流式更新、提交流程都收敛到一个 hook 里。团队不用自己维护 SSE、增量拼接、消息状态机。

### Tool Calls

Tool Calls 让 LLM 从“只会聊天”变成“能做事”。典型场景包括：

- 查询实时数据
- 调用业务接口
- 生成 SQL/命令前先执行确认动作
- 在对话过程中自动选择不同工具

Vercel AI SDK 对 Tool Calls 有比较完整的支持，前端可以展示“模型决定调用工具”的过程，而后端可以统一负责工具执行。

### Structured Output

Structured Output 解决的问题是：**模型输出不稳定**。

很多时候我们不希望模型自由发挥一大段文本，而是希望它直接返回符合 schema 的 JSON。常见场景：

- 从用户输入提取结构化字段
- 生成固定格式的报告
- 生成可直接落库的数据对象
- 做分类、评分、打标签

Vercel AI SDK 配合 Zod 可以在 TypeScript 侧定义 schema，前端能获得类型提示，后端也能做统一校验。

## 推荐的混合架构设计

如果你们团队已经在用 Laravel，而且前端是 Next.js、Nuxt、或普通 TypeScript SPA，我比较推荐下面这套混合架构。

### 整体链路

```text
User
  ↓
TypeScript Frontend (useChat / useCompletion)
  ↓
Next.js Route / BFF
  ↓
Laravel API (/api/ai/chat, /api/ai/tools, ...)
  ↓
Vercel AI SDK Server Side / Laravel AI Service
  ↓
LLM Provider（OpenAI / Anthropic / DeepSeek / Gemini / ...）
```

这样做的好处是：

- **前端只负责 UI 和交互态**
- **BFF 负责前端协议适配**
- **Laravel 负责业务边界、权限、计费、审计、工具执行**
- **Provider 切换和 Key 管理收敛到后端**
- **Streaming 可以在后端统一生成，再透传给前端**

这个架构非常像经典的 **BFF 模式**，只是这里 BFF 的职责不是聚合 REST 接口，而是统一 LLM 交互协议。

### 为什么 Laravel 适合做后端中枢

Laravel 在这类项目里的优势不是“能不能调用 LLM”，而是它很擅长做：

- 路由与中间件
- 鉴权与权限
- 队列与任务调度
- 日志与审计
- 事件与观察者
- HTTP Client 与重试
- 结构化响应与错误处理
- Policy / Gate
- Job / Event / Observer

这些能力恰好是 LLM 应用在生产环境里最需要的。

## 第一个实战：纯文本 Streaming

先来看最基础的场景：前端发起对话，后端流式返回结果。

### 前端

```ts
'use client';

import { useChat } from '@ai-sdk/react';

export default function Assistant() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/ai/chat',
  });

  return (
    <main style={{ maxWidth: 680, margin: '40px auto' }}>
      <section>
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 16 }}>
            <div><b>{m.role === 'user' ? '我' : 'AI'}</b></div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
      </section>

      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="输入问题..."
          style={{ width: '100%', padding: 12 }}
        />
        <button disabled={isLoading} type="submit">
          {isLoading ? '生成中...' : '发送'}
        </button>
      </form>
    </main>
  );
}
```

### BFF / Next.js Route

```ts
// app/api/ai/chat/route.ts

import { streamText } from 'ai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: 'openai/gpt-4o',
    system: '你是业务助手，请用简洁中文回答。',
    messages,
  });

  return result.toDataStreamResponse();
}
```

### Laravel 兜底接口

如果团队希望统一收口到 Laravel，也可以让前端直接请求 Laravel：

```php
<?php

namespace App\Http\Controllers\Ai;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AiChatController extends Controller
{
    public function chat(Request $request)
    {
        $request->validate([
            'messages' => 'required|array',
            'messages.*.role' => 'required|in:user,assistant,system',
            'messages.*.content' => 'required|string',
        ]);

        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
            'Content-Type' => 'application/json',
        ])->send('POST', 'https://api.openai.com/v1/chat/completions', [
            'body' => [
                'model' => 'gpt-4o',
                'stream' => true,
                'messages' => $request->input('messages'),
            ],
        ]);

        return response()->stream(function () use ($response) {
            $body = $response->getDecoderStream();

            while (!$body->eof()) {
                $line = $body->read(1024);

                if ($line) {
                    echo $line;
                    @ob_flush();
                    flush();
                }
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
```

这个方案是最原始的 Laravel 直连 Provider 流式代理。它能跑，但不够优雅。如果项目里准备长期使用 LLM，建议把这部分收敛成 `AiService`，不要散在 Controller 里。

## 第二个实战：Tool Calls

Tool Calls 才是 LLM 应用真正开始“有用”的地方。

假设我们要做一个客服助手，模型可以：

1. 查询订单状态
2. 查看用户信息
3. 创建售后工单

这些工具显然不适合放在前端执行。合理方案是：

- 前端展示工具调用过程
- 后端接收模型 tool_call 指令并执行
- 后端把工具结果返回给模型继续生成

### Laravel 里的工具定义

```php
<?php

declare(strict_types=1);

namespace App\Services\Ai\Tools;

use App\Models\Order;
use App\Models\User;
use App\Services\TicketService;

class AiToolRegistry
{
    public function __construct(
        private readonly TicketService $ticketService,
    ) {}

    public function getDefinitions(): array
    {
        return [
            [
                'type' => 'function',
                'function' => [
                    'name' => 'get_order_status',
                    'description' => '根据订单号查询订单状态',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'order_no' => [
                                'type' => 'string',
                                'description' => '订单号',
                            ],
                        ],
                        'required' => ['order_no'],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'create_support_ticket',
                    'description' => '创建售后工单',
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'user_id' => ['type' => 'integer'],
                            'order_no' => ['type' => 'string'],
                            'reason' => ['type' => 'string'],
                        ],
                        'required' => ['user_id', 'order_no', 'reason'],
                    ],
                ],
            ],
        ];
    }

    public function execute(string $name, array $arguments): mixed
    {
        return match ($name) {
            'get_order_status' => $this->getOrderStatus($arguments['order_no']),
            'create_support_ticket' => $this->ticketService->create([
                'user_id' => $arguments['user_id'],
                'order_no' => $arguments['order_no'],
                'reason' => $arguments['reason'],
            ]),
            default => null,
        };
    }

    private function getOrderStatus(string $orderNo): array
    {
        $order = Order::where('order_no', $orderNo)->first();

        if (!$order) {
            return ['error' => '订单不存在'];
        }

        return [
            'order_no' => $order->order_no,
            'status' => $order->status,
            'paid_at' => $order->paid_at?->toDateTimeString(),
        ];
    }
}
```

这里的重点不是“怎么调 OpenAI”，而是 **工具定义、权限控制、执行逻辑都收敛在 Laravel Service 里**。

### 后端工具执行循环

LLM Tool Calls 的典型流程不是一次请求就能结束的，往往需要一个循环：

```text
User asks
  → LLM returns tool_call
  → Laravel executes tool
  → Laravel sends tool result back
  → LLM continues response
```

因此后端通常需要做一个 `ToolCallOrchestrator`。即便前端展示的是 streaming，后端也可以先完成一轮工具交互，再统一输出结果，或者直接做 streaming tool loop。

## 第三个实战：Structured Output

Structured Output 的价值在于“模型输出可预期”。

比如你希望模型不是返回一大段自由文本，而是直接返回：

```json
{
  "intent": "refund_request",
  "order_no": "ORD202606100001",
  "reason": "商品未收到",
  "confidence": 0.92
}
```

### Zod Schema 示例

前端可以用 Zod 定义 schema：

```ts
import { z } from 'zod';

export const IntentSchema = z.object({
  intent: z.enum([
    'refund_request',
    'order_query',
    'complaint',
    'general_question',
  ]),
  order_no: z.string().nullable(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export type Intent = z.infer<typeof IntentSchema>;
```

### Laravel 端结构化输出

如果后端是统一收口 Provider 的地方，Laravel 也应该做 schema 校验。这里可以用 Laravel 自带 Validator：

```php
<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Validator;
use InvalidArgumentException;

class IntentParser
{
    public function parse(array $payload): array
    {
        $validator = Validator::make($payload, [
            'intent' => 'required|in:refund_request,order_query,complaint,general_question',
            'order_no' => 'nullable|string',
            'reason' => 'required|string|max:500',
            'confidence' => 'required|numeric|min:0|max:1',
        ]);

        if ($validator->fails()) {
            throw new InvalidArgumentException(
                'LLM structured output validation failed: ' . $validator->errors()->toJson()
            );
        }

        return $validator->validated();
    }
}
```

这个思路的核心是：**即便模型输出符合 schema，后端也要做校验**。  
因为在生产环境里，LLM 输出永远是“可能出错”的。

## 前后端职责拆分

很多团队做 LLM 应用之所以混乱，是因为职责不清楚。下面是一个比较实用的拆分建议。

### 前端职责

- 用户输入管理
- Streaming 展示
- Tool Call 可视化
- 状态展示（loading / error / partial）
- 用户确认交互
- 消息历史渲染

### Laravel 后端职责

- Provider 配置与切换
- API Key 管理
- Prompt 管理与版本化
- 权限校验
- 工具执行
- 数据访问
- 结构化输出校验
- 日志、审计、计费
- 限流与失败重试
- 敏感内容过滤

### BFF 职责

- 接口聚合
- 请求标准化
- SSE/Streaming 透传
- 前端协议适配

这个划分并不死板，但至少能让团队知道“这件事该谁做”。

## 推荐的 Laravel 目录结构

如果你们项目里 LLM 能力会持续演进，我建议不要把 AI 代码散落在 Controller、Model、Helper 里。可以收敛到独立模块，例如：

```text
app/
  Services/
    Ai/
      AiService.php
      AiToolRegistry.php
      StructuredOutputValidator.php
      Providers/
        OpenAiProvider.php
        AnthropicProvider.php
      Tools/
        GetOrderStatusTool.php
        CreateSupportTicketTool.php
        SearchKnowledgeBaseTool.php
      Middleware/
        AiRateLimiter.php
        AiAuditLogger.php
```

这样的好处很明显：

- 换 Provider 不影响 Controller
- 增加工具不用到处改代码
- 中间件可以统一处理限流和审计
- 结构化输出逻辑有固定位置

## 常见的生产问题

即使 SDK 层面做得不错，真正在生产里跑 LLM 应用，仍然会遇到很多细节问题。

### 1. Streaming 超时

LLM 响应时间不可控，有时几秒，有时几十秒。如果前面还有网关或代理，超时配置要统一处理。

Laravel 里的做法通常包括：

- StreamedResponse 不设固定超时
- Nginx 层关闭 proxy_buffering
- 上游 Gateway 适当放大 timeout

### 2. Tool Calls 超时或失败

工具调用可能依赖数据库、缓存、第三方服务。如果其中一步慢了，整个 LLM 交互就会变慢。

建议：

- 工具设置独立超时
- 工具失败后返回明确错误信息给模型
- 复杂工具改为异步执行

比如“创建工单”这类操作，可以先异步处理，前端再轮询结果。

### 3. 重复工具调用

LLM 有时会重复调用相同工具，或者陷入循环。生产环境必须做保护：

- 同一会话内限制同一工具调用次数
- 对高开销工具做缓存
- 检测死循环并强制中断

### 4. 结构化输出不稳定

即便使用 Structured Output，也偶尔会出现字段缺失、类型错误、枚举值不一致等问题。  
所以：

- 前端做容错展示
- 后端做严格校验
- 对关键业务数据再做二次确认

### 5. 多 Provider 一致性

不同 Provider 对 Tool Calls、Structured Output、System Prompt 的处理不完全一致。  
所以项目早期就要决定：

- 是否强制统一 Provider 行为
- 是否做 response normalization
- 是否只支持子集能力

## 计费与审计怎么做

LLM 应用上线后，最容易被忽略的不是功能，而是 **计费和审计**。

### Token 统计

建议后端统一统计：

- input tokens
- output tokens
- tool call tokens
- streaming 总耗时
- provider 名称
- model 名称

这些数据对成本治理非常重要。

### 审计日志

生产环境建议记录：

- user_id
- session_id
- request payload 摘要
- model response 摘要
- tool calls
- structured output 是否通过校验
- latency
- error type

这样后续排查问题会轻松很多。

## 一个完整的 Laravel 接口示例

下面给一个相对完整的 Laravel Controller 示例，用于承接前端 AI 请求：

```php
<?php

namespace App\Http\Controllers\Ai;

use App\Services\Ai\AiService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class AiAssistantController extends Controller
{
    public function chat(Request $request, AiService $ai)
    {
        $request->validate([
            'message' => 'required|string|max:4000',
            'conversation_id' => 'nullable|string|max:128',
        ]);

        $conversationId = $request->input('conversation_id') ?: Str::uuid()->toString();

        $response = $ai->chat(systemPrompt: <<<PROMPT
你是一个业务助手。回答问题时尽量简洁、结构化。
如果需要订单信息，请使用工具查询，不要编造订单数据。
PROMPT
, userMessage: $request->input('message'), options: [
            'conversation_id' => $conversationId,
            'tools' => true,
        ]);

        return response()->json([
            'conversation_id' => $conversationId,
            'reply' => $response->text(),
            'tool_calls' => $response->toolCalls(),
            'usage' => $response->usage(),
        ]);
    }
}
```

这类接口可以进一步拆成：

- `/api/ai/chat`：普通对话
- `/api/ai/stream`：流式对话
- `/api/ai/classify`：结构化输出分类
- `/api/ai/tools`：工具调用专用入口

但不管怎么拆，核心原则不变：**前端负责展示，后端负责执行和治理**。

## 什么时候该引入 Agent 模式

如果你发现项目里已经不是“单轮问答”，而是变成了：

- 先理解意图
- 再查询数据
- 再总结答案
- 再校验结果
- 再输出最终回复

那就说明你已经进入 Agent 模式了。

Agent 模式下，Laravel 的价值会更明显，因为这里会出现很多“只有后端才适合做”的事情：

- 决定是否执行工具
- 编排多个工具调用顺序
- 管理会话状态
- 做失败恢复
- 做成本控制
- 做结果审计

这时候 Vercel AI SDK 可以继续在前端承担流式展示、消息状态管理、工具过程可视化，而 Laravel 则承担后端 Agent 编排中枢。

## 给 Laravel 团队的落地建议

如果你们准备在真实项目里落地这套混合架构，我会建议按下面顺序推进。

### 第一阶段：统一入口

先不要一口气把所有 LLM 能力都做出来。先做统一入口：

- 一个 `/api/ai/chat`
- 一个 `AiService`
- 一个统一 Provider 配置
- 一个基础日志埋点

这样后续迭代会轻松很多。

### 第二阶段：加 Streaming

先保证普通回答可用，再加 Streaming。  
Streaming 不是装饰，它直接影响体验。尤其在工具调用较多时，流式反馈能让用户明显感受到“系统正在工作”。

### 第三阶段：加 Tool Calls

先从一两个关键工具开始，例如：

- 查询订单
- 查询知识库
- 查询用户信息

不要一开始就把二十个工具全接进去，否则调试成本很高。

### 第四阶段：加 Structured Output

当某些场景需要稳定结构化结果时，再补 Structured Output。常见场景：

- 意图识别
- 字段抽取
- 分类打标
- 评分与总结

### 第五阶段：加治理能力

最后再补：

- 计费
- 限流
- 审计
- 敏感词过滤
- 失败告警
- 成本报表

这一步看起来不性感，但对上线后长期维护非常关键。

## 总结

**Vercel AI SDK** 在 TypeScript 生态里确实是一个很好用的 LLM 统一抽象层。它能明显降低 Streaming、Tool Calls、Structured Output、多 Provider 对接的开发成本。  
但如果目标是生产级项目，光有前端 SDK 还不够，还需要一个足够稳的后端中枢。

对于 Laravel 团队来说，最自然的方案就是 **TypeScript 前端负责交互态与流式展示，Laravel 后端负责 Provider 管理、权限、工具执行、结构化输出校验、审计与计费**。

这种混合架构的优势在于：

1. 前端开发体验好
2. 后端安全边界清晰
3. Provider 切换成本低
4. 工具执行可控
5. 结构化输出可校验
6. 生产治理更容易落地

简单说，**前端决定“用户看到什么”，后端决定“什么可以被信任”**。  
这也是我眼中 LLM 应用从 Demo 走向生产最值得走的一条路。
