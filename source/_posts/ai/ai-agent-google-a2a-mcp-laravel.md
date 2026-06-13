---
title: AI Agent 多代理通信协议实战：Google A2A + MCP 互补架构——跨组织 Agent 互操作的开放标准与 Laravel 集成
date: 2026-06-07 12:00:00
tags: [AI Agent, A2A, MCP, Laravel, 多代理, 协议]
keywords: [AI Agent, Google A2A, MCP, Agent, Laravel, 多代理通信协议实战, 互补架构, 跨组织, 互操作的开放标准与, AI]
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 深入解析 Google A2A 与 MCP 两大 AI Agent 通信协议的互补架构，涵盖跨组织 Agent 互操作标准、Laravel 集成实战、安全认证与生产部署，助你构建多代理协作系统。
---


# AI Agent 多代理通信协议实战：Google A2A + MCP 互补架构——跨组织 Agent 互操作的开放标准与 Laravel 集成

## 一、为什么需要多代理通信？单 Agent 的局限性

在 2024—2026 年的 AI Agent 浪潮中，我们见证了无数"万能助手"的诞生：从能写代码、画图、搜索网页的通用型 Agent，到能操作数据库、调用 API、管理文件的工具型 Agent。但随着应用复杂度的攀升，一个严峻的现实摆在所有架构师面前——**单个 Agent 已经无法满足企业级场景的需求**。

### 1.1 单 Agent 的三重瓶颈

**第一重：能力边界。** 一个 Agent 即使再强大，它能直接调用的工具和访问的资源也是有限的。一个"客服 Agent"可能需要查询订单系统、调用物流接口、读取知识库、发送邮件通知，这些能力如果全部集成在一个 Agent 内部，不仅开发维护成本极高，而且每新增一个工具都需要修改核心 Agent 的代码。

**第二重：上下文窗口。** LLM 的上下文窗口虽然在不断扩大（从 4K 到 128K 甚至 1M tokens），但"能塞进去"不等于"能有效利用"。当一个 Agent 需要同时处理用户对话、系统状态、工具返回结果、历史记录时，上下文的臃肿会直接导致推理质量下降。

**第三重：组织边界。** 这是最容易被忽略、却最致命的瓶颈。企业内部的 HR 系统、财务系统、客户管理系统往往由不同团队甚至不同公司维护。一个"报销审批 Agent"需要与"财务系统 Agent"通信，而后者可能部署在完全不同的基础设施上，使用不同的 LLM，遵循不同的安全策略。单 Agent 架构根本无法跨组织协作。

### 1.2 多代理协作的范式转移

正因如此，业界正在经历一场从"单打独斗"到"团队协作"的范式转移。多代理系统（Multi-Agent System）的核心思想是：**每个 Agent 专注于自己擅长的领域，通过标准化的通信协议互相协作**。

这就像互联网的诞生——计算机之间不是通过一根根专用电缆相连，而是通过 TCP/IP 这样通用的协议实现了全球互联。Agent 之间同样需要一套开放的、标准化的通信协议，才能真正实现跨平台、跨组织的互操作。

在这样的背景下，两个关键协议应运而生：**MCP（Model Context Protocol）** 和 **Google A2A（Agent-to-Agent）**。它们各自解决多代理通信中的不同层面问题，而且并非互相替代，而是**深度互补**。

---

## 二、MCP（Model Context Protocol）简介

MCP（Model Context Protocol）由 Anthropic 于 2024 年底推出，迅速成为 AI Agent 生态中最广泛采用的工具调用协议。它的定位非常清晰：**解决 Agent 与外部工具/数据源之间的标准化连接问题**。

### 2.1 MCP 的核心理念

MCP 的设计哲学可以用一句话概括：**将"Agent 如何使用工具"这件事标准化**。在此之前，每个 Agent 框架都有自己的工具定义格式——LangChain 用 `Tool` 对象，AutoGen 用函数签名，OpenAI 用 Function Calling Schema。这意味着同一个工具（比如"查询天气"）需要为不同的 Agent 框架编写不同的适配器。

MCP 统一了这个层面。工具提供方只需要实现一个 MCP Server，任何支持 MCP 的 Agent（即 MCP Client）都可以直接调用，无需额外适配。

### 2.2 MCP 的三大原语

MCP 定义了三种核心能力，称为"三大原语"（Three Primitives）：

**① Tools（工具调用）**

Tool 是最直观的能力暴露方式。一个 MCP Server 可以暴露任意数量的 Tools，每个 Tool 有明确的名称、描述和 JSON Schema 参数定义。Agent 通过推理决定调用哪个 Tool、传入什么参数。

```json
{
  "name": "query_order",
  "description": "根据订单号查询订单详情",
  "inputSchema": {
    "type": "object",
    "properties": {
      "order_id": {
        "type": "string",
        "description": "订单号，格式如 ORD-20240101-001"
      }
    },
    "required": ["order_id"]
  }
}
```

**② Resources（资源访问）**

Resource 用于暴露数据和上下文信息。与 Tool 不同，Resource 通常是只读的，Agent 可以"读取"它们来丰富自己的上下文。比如一个知识库 MCP Server 可以暴露 `docs://api/authentication` 这样的资源 URI，Agent 按需读取相关文档。

Resource 使用 URI 模式标识，支持动态模板：

```json
{
  "uri": "docs://api/{section}",
  "name": "API 文档",
  "description": "读取指定章节的 API 文档",
  "mimeType": "text/markdown"
}
```

**③ Prompts（提示模板）**

Prompt 是 MCP 中最独特、也最容易被忽视的原语。它允许 MCP Server 向 Agent 提供预定义的提示模板，指导 Agent 如何更好地使用该 Server 提供的能力。比如一个"代码审查" MCP Server 可以提供一个 Prompt 模板，告诉 Agent 应该关注哪些代码质量问题、如何格式化输出等。

```json
{
  "name": "code_review",
  "description": "生成代码审查报告的提示模板",
  "arguments": [
    {
      "name": "language",
      "description": "编程语言",
      "required": true
    }
  ]
}
```

### 2.3 MCP 的通信机制

MCP 基于 JSON-RPC 2.0 协议进行通信，支持两种传输方式：

- **stdio（标准输入/输出）**：适用于本地进程间通信，MCP Server 作为子进程运行。
- **HTTP + SSE（Server-Sent Events）**：适用于远程通信，MCP Client 通过 HTTP 发送请求，Server 通过 SSE 推送响应和通知。

这种设计让 MCP 既能用于本地桌面应用（如 IDE 插件），也能用于云端服务。

---

## 三、Google A2A（Agent-to-Agent）协议简介

如果说 MCP 解决的是"Agent 如何使用工具"的问题，那么 Google A2A 解决的就是更高层次的问题：**Agent 如何发现彼此、如何委派任务、如何协作完成复杂工作流**。

A2A 协议由 Google 于 2025 年 4 月正式发布，得到了 50 多家技术公司的支持，包括 Salesforce、SAP、ServiceNow、LangChain 等。它的目标是成为 Agent 之间通信的"HTTP"——一个开放的、厂商中立的、可互操作的标准。

### 3.1 A2A 的核心概念

**① Agent Card（代理名片）**

Agent Card 是 A2A 协议的基石。它是一个 JSON 文档，描述了一个 Agent 的身份、能力和交互方式，类似于 API 世界中的 OpenAPI Specification。

每个 Agent 通过 `/.well-known/agent.json` 端点公开自己的 Agent Card。任何想要与之交互的 Agent 都可以先获取这个 Card，了解对方能做什么、怎么调用。

```json
{
  "name": "订单处理 Agent",
  "description": "处理电商订单的查询、修改和取消",
  "url": "https://agent.example.com/a2a",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "order_query",
      "name": "订单查询",
      "description": "根据条件查询订单信息",
      "examples": ["帮我查一下最近的订单", "订单 ORD-001 的状态是什么"]
    },
    {
      "id": "order_cancel",
      "name": "订单取消",
      "description": "取消指定订单"
    }
  ],
  "authentication": {
    "schemes": ["Bearer"]
  }
}
```

**② Task（任务）**

Task 是 A2A 中的核心交互单元。当一个 Agent（Client）需要另一个 Agent（Remote）帮忙完成某件事时，它创建一个 Task。Task 有完整的生命周期：从创建到完成（或失败），支持同步请求/响应模式，也支持长时间运行的异步模式。

**③ Message（消息）**

Task 内部通过 Message 进行通信。每个 Message 包含一个或多个 Part（部分），Part 可以是文本、文件、结构化数据等。这种多模态设计让 A2A 能够处理各种复杂的交互场景。

### 3.2 A2A 与 MCP 的关键区别

| 维度 | MCP | A2A |
|------|-----|-----|
| 通信对象 | Agent ↔ Tool/Resource | Agent ↔ Agent |
| 交互粒度 | 单次函数调用 | 完整任务生命周期 |
| 状态管理 | 无状态（大部分情况） | 有状态（Task 状态机） |
| 发现机制 | 配置文件静态注册 | Agent Card 动态发现 |
| 通信模式 | 请求/响应 | 请求/响应 + SSE + 推送通知 |
| 身份认知 | Agent 调用工具，工具是"被动"的 | Agent 之间平等协作，双方都有"智能" |

---

## 四、A2A 与 MCP 的互补关系

这是本文最核心的观点之一：**A2A 和 MCP 不是竞争关系，而是天然的互补**。

### 4.1 分层架构

可以将 A2A 和 MCP 理解为不同层次的协议：

```
┌─────────────────────────────────────────────┐
│           应用层：业务逻辑                     │
├─────────────────────────────────────────────┤
│     A2A 层：Agent 之间的任务协作              │
│     （Agent Card 发现、Task 生命周期管理）      │
├─────────────────────────────────────────────┤
│     MCP 层：Agent 与工具/数据的连接           │
│     （Tool 调用、Resource 访问、Prompt 模板）   │
├─────────────────────────────────────────────┤
│     传输层：HTTP/SSE/stdio                   │
└─────────────────────────────────────────────┘
```

**MCP 解决的是"纵向"问题**——Agent 如何连接到底层的工具和数据源。
**A2A 解决的是"横向"问题**——Agent 如何与其他 Agent 通信协作。

### 4.2 一个完整的协作场景

想象一个"差旅报销"场景：

1. **用户** 向 **差旅助手 Agent** 提交报销请求："我上周去北京出差，请帮我报销机票和酒店。"
2. **差旅助手 Agent** 通过 **A2A 协议** 将任务委派给 **财务审批 Agent**。
3. **财务审批 Agent** 在处理过程中，通过 **MCP 协议** 调用 **票据识别 Tool**（OCR）来解析发票图片。
4. **财务审批 Agent** 又通过 **MCP 协议** 访问 **公司政策 Resource** 来检查报销标准。
5. 审批完成后，**财务审批 Agent** 通过 **A2A 协议** 将结果返回给 **差旅助手 Agent**。
6. **差旅助手 Agent** 通知用户："报销已批准，金额 ¥3,200，预计 3 个工作日内到账。"

在这个场景中，A2A 负责 Agent 之间的"对话"，MCP 负责 Agent 与工具/数据的"操作"。两者缺一不可。

---

## 五、A2A 协议详解

### 5.1 Agent Card JSON Schema

Agent Card 遵循 JSON Schema 规范，完整的结构如下：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["name", "url", "version"],
  "properties": {
    "name": {
      "type": "string",
      "description": "Agent 的人类可读名称"
    },
    "description": {
      "type": "string",
      "description": "Agent 功能的详细描述"
    },
    "url": {
      "type": "string",
      "format": "uri",
      "description": "A2A 服务端点 URL"
    },
    "version": {
      "type": "string",
      "description": "语义化版本号"
    },
    "documentationUrl": {
      "type": "string",
      "format": "uri"
    },
    "provider": {
      "type": "object",
      "properties": {
        "organization": { "type": "string" },
        "url": { "type": "string", "format": "uri" }
      }
    },
    "capabilities": {
      "type": "object",
      "properties": {
        "streaming": {
          "type": "boolean",
          "description": "是否支持 SSE 流式响应"
        },
        "pushNotifications": {
          "type": "boolean",
          "description": "是否支持推送通知回调"
        },
        "stateTransitionHistory": {
          "type": "boolean",
          "description": "是否暴露状态转换历史"
        }
      }
    },
    "authentication": {
      "type": "object",
      "properties": {
        "schemes": {
          "type": "array",
          "items": { "type": "string" },
          "description": "支持的认证方案，如 Bearer、API Key 等"
        },
        "credentials": { "type": "string" }
      }
    },
    "defaultInputModes": {
      "type": "array",
      "items": { "type": "string" }
    },
    "defaultOutputModes": {
      "type": "array",
      "items": { "type": "string" }
    },
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "tags": {
            "type": "array",
            "items": { "type": "string" }
          },
          "examples": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    }
  }
}
```

Agent Card 的设计有几个精妙之处：

- **可发现性**：通过 `/.well-known/agent.json` 标准路径，任何 Agent 都可以自动发现并解析。
- **自描述性**：`skills` 数组中的 `examples` 字段让 Agent 能够理解何时应该调用对方，这比传统的 API 文档更贴近 AI 的理解方式。
- **能力协商**：`capabilities` 字段让双方在交互前就知道对方支持哪些高级特性。

### 5.2 Task 状态机

A2A 的 Task 具有明确的状态机，这是它与 MCP 最大的差异之一：

```
                    ┌──────────┐
                    │ submitted│
                    └────┬─────┘
                         │
                    ┌────▼─────┐
             ┌──────│ working  │──────┐
             │      └────┬─────┘      │
             │           │            │
        ┌────▼────┐ ┌────▼─────┐ ┌────▼────┐
        │ input-  │ │completed │ │ failed  │
        │required │ └──────────┘ └─────────┘
        └────┬────┘
             │
        ┌────▼─────┐
        │ working  │ (继续处理)
        └──────────┘
```

各状态含义：

- **submitted**：任务已提交，等待 Agent 处理。
- **working**：Agent 正在处理任务。
- **input-required**：Agent 需要更多信息才能继续，等待用户提供。
- **completed**：任务成功完成。
- **failed**：任务处理失败。
- **canceled**：任务被取消。

每个状态转换都可能携带 `Artifact`（产物），这是 A2A 中传递结果的主要方式。

### 5.3 Artifact 传输

Artifact 是 A2A 中数据传输的标准格式，支持多种类型：

```json
{
  "artifacts": [
    {
      "name": "analysis_report",
      "parts": [
        {
          "type": "text",
          "text": "## 分析报告\n\n根据您提供的数据..."
        },
        {
          "type": "file",
          "file": {
            "name": "report.pdf",
            "mimeType": "application/pdf",
            "bytes": "base64编码内容..."
          }
        },
        {
          "type": "data",
          "data": {
            "summary": { "total": 150, "passed": 142, "failed": 8 },
            "details": [...]
          }
        }
      ]
    }
  ]
}
```

---

## 六、MCP 协议详解

### 6.1 Server/Client 架构

MCP 采用经典的 Client-Server 架构：

```
┌─────────────┐    JSON-RPC    ┌─────────────┐
│  MCP Client │ ◄────────────► │  MCP Server │
│  (Agent)    │    stdio/HTTP  │  (Tool提供方) │
└─────────────┘                └─────────────┘
```

- **MCP Client**：通常是 AI Agent 或 LLM 应用，负责发起请求。
- **MCP Server**：工具和数据的提供方，负责处理请求并返回结果。

一个 MCP Client 可以连接多个 MCP Server，一个 MCP Server 也可以服务多个 MCP Client。

### 6.2 生命周期

MCP 连接的生命周期包括三个阶段：

1. **初始化（Initialize）**：Client 和 Server 交换能力信息（协议版本、支持的功能等）。
2. **操作（Operation）**：正常的请求/响应交互，包括 Tool 调用、Resource 读取、Prompt 获取等。
3. **关闭（Shutdown）**：优雅地终止连接。

### 6.3 Tool 实现细节

MCP Server 暴露 Tool 时，需要提供完整的 JSON Schema 定义：

```json
{
  "tools": [
    {
      "name": "create_order",
      "description": "创建新的电商订单",
      "inputSchema": {
        "type": "object",
        "properties": {
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "product_id": { "type": "string" },
                "quantity": { "type": "integer", "minimum": 1 }
              },
              "required": ["product_id", "quantity"]
            }
          },
          "shipping_address": {
            "type": "object",
            "properties": {
              "province": { "type": "string" },
              "city": { "type": "string" },
              "detail": { "type": "string" }
            }
          }
        },
        "required": ["items", "shipping_address"]
      }
    }
  ]
}
```

当 Agent 调用 Tool 时，MCP Server 执行对应的操作并返回结构化结果：

```json
{
  "content": [
    {
      "type": "text",
      "text": "订单创建成功，订单号：ORD-20260607-0042，总金额：¥899.00"
    }
  ],
  "isError": false
}
```

---

## 七、实战：用 Laravel 实现 A2A Agent

现在让我们进入实战环节。我们将使用 PHP Laravel 框架实现一个完整的 A2A Agent。

### 7.1 项目初始化

```bash
composer create-project laravel/laravel a2a-agent
cd a2a-agent
composer require guzzlehttp/guzzle
```

### 7.2 Agent Card 路由

首先创建 Agent Card 的暴露端点：

```php
// routes/web.php
use App\Http\Controllers\A2AController;

Route::get('/.well-known/agent.json', [A2AController::class, 'agentCard']);
Route::post('/a2a', [A2AController::class, 'handleTask']);
Route::get('/a2a/stream/{taskId}', [A2AController::class, 'streamTask']);
```

### 7.3 Agent Card 控制器

```php
// app/Http/Controllers/A2AController.php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class A2AController extends Controller
{
    /**
     * 暴露 Agent Card
     */
    public function agentCard(): JsonResponse
    {
        return response()->json([
            'name' => 'Laravel 订单处理 Agent',
            'description' => '处理电商订单的查询、创建、修改和取消',
            'url' => config('app.url') . '/a2a',
            'version' => '1.0.0',
            'provider' => [
                'organization' => 'Example Corp',
                'url' => config('app.url'),
            ],
            'capabilities' => [
                'streaming' => true,
                'pushNotifications' => true,
                'stateTransitionHistory' => true,
            ],
            'authentication' => [
                'schemes' => ['Bearer'],
            ],
            'defaultInputModes' => ['text', 'file'],
            'defaultOutputModes' => ['text', 'file'],
            'skills' => [
                [
                    'id' => 'order_query',
                    'name' => '订单查询',
                    'description' => '根据订单号或条件查询订单详情',
                    'tags' => ['ecommerce', 'order'],
                    'examples' => [
                        '帮我查一下订单 ORD-20260607-001',
                        '查询最近一周的所有订单',
                    ],
                ],
                [
                    'id' => 'order_create',
                    'name' => '订单创建',
                    'description' => '创建新的电商订单',
                    'tags' => ['ecommerce', 'order'],
                    'examples' => [
                        '帮我下一个新订单',
                    ],
                ],
            ],
        ]);
    }
}
```

### 7.4 Task 处理逻辑

```php
    /**
     * 处理 A2A Task 请求
     */
    public function handleTask(Request $request): JsonResponse
    {
        $payload = $request->json()->all();

        // 验证 JSON-RPC 格式
        if (!isset($payload['method'])) {
            return $this->jsonRpcError($payload['id'] ?? null, -32600, 'Invalid Request');
        }

        $method = $payload['method'];
        $params = $payload['params'] ?? [];
        $id = $payload['id'] ?? null;

        return match ($method) {
            'tasks/send' => $this->handleTasksSend($id, $params),
            'tasks/sendSubscribe' => $this->handleTasksSendSubscribe($params),
            'tasks/get' => $this->handleTasksGet($id, $params),
            'tasks/cancel' => $this->handleTasksCancel($id, $params),
            default => $this->jsonRpcError($id, -32601, "Method not found: {$method}"),
        };
    }

    /**
     * 处理 tasks/send 请求（同步模式）
     */
    private function handleTasksSend($id, array $params): JsonResponse
    {
        $taskId = $params['id'] ?? uniqid('task_', true);
        $message = $params['message'] ?? [];

        // 从消息中提取文本内容
        $textContent = '';
        foreach ($message['parts'] ?? [] as $part) {
            if (($part['type'] ?? '') === 'text') {
                $textContent .= $part['text'] ?? '';
            }
        }

        // 根据 skill 分发到不同的处理逻辑
        $skill = $params['metadata']['skill'] ?? 'order_query';
        $result = match ($skill) {
            'order_query' => $this->processOrderQuery($textContent),
            'order_create' => $this->processOrderCreate($textContent),
            default => $this->processGenericQuery($textContent),
        };

        // 存储 Task 状态
        $this->storeTask($taskId, 'completed', $result);

        return response()->json([
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => [
                'id' => $taskId,
                'status' => [
                    'state' => 'completed',
                    'timestamp' => now()->toIso8601String(),
                ],
                'artifacts' => [
                    [
                        'name' => 'response',
                        'parts' => [
                            [
                                'type' => 'text',
                                'text' => $result,
                            ],
                        ],
                    ],
                ],
            ],
        ]);
    }

    /**
     * 处理 tasks/sendSubscribe 请求（SSE 流式模式）
     */
    private function handleTasksSendSubscribe(array $params): StreamedResponse
    {
        $taskId = $params['id'] ?? uniqid('task_', true);
        $message = $params['message'] ?? [];

        $textContent = '';
        foreach ($message['parts'] ?? [] as $part) {
            if (($part['type'] ?? '') === 'text') {
                $textContent .= $part['text'] ?? '';
            }
        }

        return response()->stream(function () use ($taskId, $textContent) {
            // 发送 submitted 状态
            $this->sendSSEEvent($taskId, 'submitted', '任务已提交');

            // 发送 working 状态
            $this->sendSSEEvent($taskId, 'working', '正在处理...');

            // 模拟处理过程
            $result = $this->processOrderQuery($textContent);

            // 发送 completed 状态
            $this->sendSSEEvent($taskId, 'completed', $result, true);
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'Connection' => 'keep-alive',
        ]);
    }

    /**
     * 发送 SSE 事件
     */
    private function sendSSEEvent(
        string $taskId,
        string $state,
        string $message,
        bool $isFinal = false
    ): void {
        $event = [
            'jsonrpc' => '2.0',
            'method' => 'tasks/sendSubscribe',
            'params' => [
                'id' => $taskId,
                'status' => [
                    'state' => $state,
                    'timestamp' => now()->toIso8601String(),
                ],
                'final' => $isFinal,
            ],
        ];

        if ($state === 'completed') {
            $event['params']['artifacts'] = [
                [
                    'name' => 'response',
                    'parts' => [['type' => 'text', 'text' => $message]],
                ],
            ];
        }

        echo "data: " . json_encode($event) . "\n\n";
        if (ob_get_level()) {
            ob_flush();
        }
        flush();
    }
```

### 7.5 业务处理逻辑

```php
    /**
     * 订单查询处理
     */
    private function processOrderQuery(string $input): string
    {
        // 提取订单号
        if (preg_match('/ORD-[\w-]+/', $input, $matches)) {
            $orderId = $matches[0];
            // 模拟数据库查询
            return "订单 {$orderId} 的详情：\n" .
                   "- 状态：已发货\n" .
                   "- 物流单号：SF1234567890\n" .
                   "- 预计送达：2026-06-09\n" .
                   "- 商品：Laravel 高级编程 (x1)\n" .
                   "- 金额：¥89.00";
        }

        return "未找到匹配的订单，请提供正确的订单号（格式：ORD-YYYYMMDD-XXXX）";
    }

    /**
     * 订单创建处理
     */
    private function processOrderCreate(string $input): string
    {
        $orderId = 'ORD-' . date('Ymd') . '-' . str_pad(rand(1, 9999), 4, '0', STR_PAD_LEFT);
        return "订单创建成功！\n" .
               "- 订单号：{$orderId}\n" .
               "- 状态：待支付\n" .
               "- 请在 30 分钟内完成支付";
    }

    /**
     * 通用查询处理
     */
    private function processGenericQuery(string $input): string
    {
        return "收到您的请求：{$input}\n" .
               "我是一个订单处理 Agent，可以帮您查询、创建、修改或取消订单。\n" .
               "请告诉我您需要什么帮助？";
    }

    /**
     * 存储 Task 状态
     */
    private function storeTask(string $taskId, string $state, string $result): void
    {
        \Cache::put("a2a_task_{$taskId}", [
            'id' => $taskId,
            'state' => $state,
            'result' => $result,
            'created_at' => now()->toIso8601String(),
        ], now()->addHours(24));
    }

    /**
     * 获取 Task 状态
     */
    private function handleTasksGet($id, array $params): JsonResponse
    {
        $taskId = $params['id'] ?? null;
        $task = \Cache::get("a2a_task_{$taskId}");

        if (!$task) {
            return $this->jsonRpcError($id, -32001, "Task not found: {$taskId}");
        }

        return response()->json([
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => $task,
        ]);
    }

    /**
     * 取消 Task
     */
    private function handleTasksCancel($id, array $params): JsonResponse
    {
        $taskId = $params['id'] ?? null;
        \Cache::put("a2a_task_{$taskId}", [
            'id' => $taskId,
            'state' => 'canceled',
        ], now()->addHours(24));

        return response()->json([
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => ['id' => $taskId, 'state' => 'canceled'],
        ]);
    }

    /**
     * JSON-RPC 错误响应
     */
    private function jsonRpcError($id, int $code, string $message): JsonResponse
    {
        return response()->json([
            'jsonrpc' => '2.0',
            'id' => $id,
            'error' => [
                'code' => $code,
                'message' => $message,
            ],
        ]);
    }
```

这个实现覆盖了 A2A 协议的核心功能：Agent Card 暴露、Task 创建/查询/取消、SSE 流式推送。在生产环境中，你还需要加入认证中间件、数据库持久化、队列异步处理等。

---

## 八、实战：用 Laravel 实现 MCP Server

接下来，我们用 Laravel 实现一个 MCP Server，让外部 Agent 可以通过 MCP 协议调用我们的工具和数据。

### 8.1 MCP Server 控制器

```php
// app/Http/Controllers/MCPController.php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class MCPController extends Controller
{
    /**
     * MCP JSON-RPC 入口
     */
    public function handle(Request $request): JsonResponse|Response
    {
        $payload = $request->json()->all();

        // 支持批量请求
        if (isset($payload[0])) {
            $responses = [];
            foreach ($payload as $single) {
                $responses[] = $this->dispatch($single);
            }
            return response()->json($responses);
        }

        $response = $this->dispatch($payload);

        // 处理 SSE 通知
        if ($request->header('Accept') === 'text/event-stream') {
            return $this->handleSSE($response);
        }

        return response()->json($response);
    }

    private function dispatch(array $payload): array
    {
        $method = $payload['method'] ?? '';
        $params = $payload['params'] ?? [];
        $id = $payload['id'] ?? null;

        return match ($method) {
            'initialize' => $this->handleInitialize($id, $params),
            'tools/list' => $this->handleToolsList($id),
            'tools/call' => $this->handleToolsCall($id, $params),
            'resources/list' => $this->handleResourcesList($id),
            'resources/read' => $this->handleResourcesRead($id, $params),
            'prompts/list' => $this->handlePromptsList($id),
            'prompts/get' => $this->handlePromptsGet($id, $params),
            default => [
                'jsonrpc' => '2.0',
                'id' => $id,
                'error' => ['code' => -32601, 'message' => "Method not found: {$method}"],
            ],
        };
    }
```

### 8.2 工具暴露

```php
    /**
     * 初始化握手
     */
    private function handleInitialize($id, array $params): array
    {
        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => [
                'protocolVersion' => '2025-03-26',
                'capabilities' => [
                    'tools' => ['listChanged' => true],
                    'resources' => ['subscribe' => true, 'listChanged' => true],
                    'prompts' => ['listChanged' => true],
                ],
                'serverInfo' => [
                    'name' => 'Laravel E-Commerce MCP Server',
                    'version' => '1.0.0',
                ],
            ],
        ];
    }

    /**
     * 列出所有可用工具
     */
    private function handleToolsList($id): array
    {
        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => [
                'tools' => [
                    [
                        'name' => 'query_products',
                        'description' => '根据关键词搜索商品',
                        'inputSchema' => [
                            'type' => 'object',
                            'properties' => [
                                'keyword' => [
                                    'type' => 'string',
                                    'description' => '搜索关键词',
                                ],
                                'category' => [
                                    'type' => 'string',
                                    'description' => '商品类别',
                                    'enum' => ['electronics', 'books', 'clothing'],
                                ],
                                'limit' => [
                                    'type' => 'integer',
                                    'description' => '返回数量限制',
                                    'default' => 10,
                                ],
                            ],
                            'required' => ['keyword'],
                        ],
                    ],
                    [
                        'name' => 'get_product_detail',
                        'description' => '获取商品详细信息',
                        'inputSchema' => [
                            'type' => 'object',
                            'properties' => [
                                'product_id' => [
                                    'type' => 'string',
                                    'description' => '商品 ID',
                                ],
                            ],
                            'required' => ['product_id'],
                        ],
                    ],
                    [
                        'name' => 'check_inventory',
                        'description' => '检查商品库存',
                        'inputSchema' => [
                            'type' => 'object',
                            'properties' => [
                                'product_id' => ['type' => 'string'],
                                'warehouse' => [
                                    'type' => 'string',
                                    'description' => '仓库代码',
                                ],
                            ],
                            'required' => ['product_id'],
                        ],
                    ],
                    [
                        'name' => 'calculate_shipping',
                        'description' => '计算运费',
                        'inputSchema' => [
                            'type' => 'object',
                            'properties' => [
                                'items' => [
                                    'type' => 'array',
                                    'items' => [
                                        'type' => 'object',
                                        'properties' => [
                                            'product_id' => ['type' => 'string'],
                                            'quantity' => ['type' => 'integer'],
                                        ],
                                    ],
                                ],
                                'destination' => ['type' => 'string'],
                            ],
                            'required' => ['items', 'destination'],
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * 执行工具调用
     */
    private function handleToolsCall($id, array $params): array
    {
        $toolName = $params['name'] ?? '';
        $arguments = $params['arguments'] ?? [];

        try {
            $result = match ($toolName) {
                'query_products' => $this->queryProducts($arguments),
                'get_product_detail' => $this->getProductDetail($arguments),
                'check_inventory' => $this->checkInventory($arguments),
                'calculate_shipping' => $this->calculateShipping($arguments),
                default => throw new \RuntimeException("Unknown tool: {$toolName}"),
            };

            return [
                'jsonrpc' => '2.0',
                'id' => $id,
                'result' => [
                    'content' => [
                        ['type' => 'text', 'text' => json_encode($result, JSON_UNESCAPED_UNICODE)],
                    ],
                    'isError' => false,
                ],
            ];
        } catch (\Throwable $e) {
            return [
                'jsonrpc' => '2.0',
                'id' => $id,
                'result' => [
                    'content' => [
                        ['type' => 'text', 'text' => "工具执行失败: {$e->getMessage()}"],
                    ],
                    'isError' => true,
                ],
            ];
        }
    }
```

### 8.3 资源与提示模板

```php
    /**
     * 列出可用资源
     */
    private function handleResourcesList($id): array
    {
        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => [
                'resources' => [
                    [
                        'uri' => 'ecommerce://products/catalog',
                        'name' => '商品目录',
                        'description' => '完整的商品分类目录',
                        'mimeType' => 'application/json',
                    ],
                    [
                        'uri' => 'ecommerce://policies/shipping',
                        'name' => '运费政策',
                        'description' => '运费计算规则和免运费政策',
                        'mimeType' => 'text/markdown',
                    ],
                    [
                        'uri' => 'ecommerce://policies/return',
                        'name' => '退换货政策',
                        'description' => '退换货规则和流程',
                        'mimeType' => 'text/markdown',
                    ],
                ],
            ],
        ];
    }

    /**
     * 读取资源内容
     */
    private function handleResourcesRead($id, array $params): array
    {
        $uri = $params['uri'] ?? '';

        $content = match ($uri) {
            'ecommerce://products/catalog' => json_encode([
                'categories' => [
                    ['id' => 'electronics', 'name' => '电子产品', 'count' => 156],
                    ['id' => 'books', 'name' => '图书', 'count' => 2340],
                    ['id' => 'clothing', 'name' => '服装', 'count' => 890],
                ],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
            'ecommerce://policies/shipping' => "# 运费政策\n\n## 国内运费\n- 订单满 ¥99 包邮\n- 未满 ¥99 收取 ¥10 运费\n- 偏远地区额外加收 ¥15\n\n## 国际运费\n- 根据目的地和重量计算",
            'ecommerce://policies/return' => "# 退换货政策\n\n- 7 天无理由退换\n- 生鲜食品不支持退货\n- 退货运费由买家承担",
            default => throw new \RuntimeException("Resource not found: {$uri}"),
        };

        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => [
                'contents' => [
                    [
                        'uri' => $uri,
                        'mimeType' => str_contains($uri, 'policy') ? 'text/markdown' : 'application/json',
                        'text' => $content,
                    ],
                ],
            ],
        ];
    }

    /**
     * 列出提示模板
     */
    private function handlePromptsList($id): array
    {
        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => [
                'prompts' => [
                    [
                        'name' => 'customer_service',
                        'description' => '生成客服对话的提示模板',
                        'arguments' => [
                            [
                                'name' => 'scenario',
                                'description' => '场景类型：complaint/inquiry/return',
                                'required' => true,
                            ],
                        ],
                    ],
                    [
                        'name' => 'product_recommendation',
                        'description' => '生成商品推荐的提示模板',
                        'arguments' => [
                            [
                                'name' => 'user_preferences',
                                'description' => '用户偏好描述',
                                'required' => true,
                            ],
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * 获取提示模板内容
     */
    private function handlePromptsGet($id, array $params): array
    {
        $name = $params['name'] ?? '';
        $arguments = $params['arguments'] ?? [];

        $prompt = match ($name) {
            'customer_service' => [
                'messages' => [
                    [
                        'role' => 'user',
                        'content' => [
                            'type' => 'text',
                            'text' => "你是一个专业的电商客服。场景：{$arguments['scenario']}。\n" .
                                      "请遵循以下原则：\n" .
                                      "1. 始终保持礼貌和耐心\n" .
                                      "2. 优先解决问题而非解释规则\n" .
                                      "3. 如需查询订单或库存，使用可用的工具\n" .
                                      "4. 给出明确的下一步行动建议",
                        ],
                    ],
                ],
            ],
            'product_recommendation' => [
                'messages' => [
                    [
                        'role' => 'user',
                        'content' => [
                            'type' => 'text',
                            'text' => "根据用户偏好推荐商品。用户偏好：{$arguments['user_preferences']}。\n" .
                                      "请先使用 query_products 工具搜索相关商品，然后给出 3-5 个推荐。",
                        ],
                    ],
                ],
            ],
            default => throw new \RuntimeException("Prompt not found: {$name}"),
        };

        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => $prompt,
        ];
    }
```

### 8.4 工具业务实现

```php
    private function queryProducts(array $args): array
    {
        $keyword = $args['keyword'] ?? '';
        $category = $args['category'] ?? null;
        $limit = $args['limit'] ?? 10;

        // 模拟商品搜索（实际应查询数据库）
        $products = [
            ['id' => 'P001', 'name' => 'Laravel 高级编程', 'price' => 89.00, 'category' => 'books'],
            ['id' => 'P002', 'name' => 'MacBook Pro 16"', 'price' => 18999.00, 'category' => 'electronics'],
            ['id' => 'P003', 'name' => 'AI Agent 实战指南', 'price' => 69.00, 'category' => 'books'],
        ];

        $filtered = array_filter($products, function ($p) use ($keyword, $category) {
            $matchKeyword = str_contains(strtolower($p['name']), strtolower($keyword));
            $matchCategory = $category ? $p['category'] === $category : true;
            return $matchKeyword && $matchCategory;
        });

        return array_slice(array_values($filtered), 0, $limit);
    }

    private function getProductDetail(array $args): array
    {
        $productId = $args['product_id'] ?? '';
        return [
            'id' => $productId,
            'name' => 'Laravel 高级编程',
            'description' => '深入讲解 Laravel 框架的高级特性',
            'price' => 89.00,
            'stock' => 42,
            'rating' => 4.8,
            'reviews' => 156,
        ];
    }

    private function checkInventory(array $args): array
    {
        return [
            'product_id' => $args['product_id'] ?? '',
            'warehouse' => $args['warehouse'] ?? 'default',
            'available' => 42,
            'reserved' => 3,
            'incoming' => 100,
            'estimated_restock' => '2026-06-15',
        ];
    }

    private function calculateShipping(array $args): array
    {
        $itemCount = count($args['items'] ?? []);
        $totalWeight = $itemCount * 0.5; // 模拟计算
        $baseFee = $totalWeight > 5 ? 15 : 10;

        return [
            'destination' => $args['destination'] ?? '',
            'weight' => "{$totalWeight}kg",
            'fee' => $baseFee,
            'free_shipping' => $baseFee === 0,
            'estimated_days' => '3-5',
        ];
    }

    private function handleSSE(array $response): Response
    {
        return response()->stream(function () use ($response) {
            echo "data: " . json_encode($response) . "\n\n";
            if (ob_get_level()) ob_flush();
            flush();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
        ]);
    }
```

### 8.5 MCP 路由注册

```php
// routes/web.php
Route::post('/mcp', [MCPController::class, 'handle']);
Route::get('/mcp', [MCPController::class, 'handle']); // SSE 连接
```

---

## 九、组合模式：一个 Laravel 应用同时作为 MCP Server + A2A Agent

真正强大的场景是让同一个 Laravel 应用同时扮演两个角色：对外作为 A2A Agent 接受其他 Agent 的任务委派，同时作为 MCP Server 暴露自己的工具和数据给其他 Agent 使用。

### 9.1 统一服务提供者

```php
// app/Providers/AgentServiceProvider.php
namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AgentServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // A2A Agent 配置
        $this->app->singleton('a2a.agent', function () {
            return [
                'name' => config('services.a2a.name', 'Laravel Agent'),
                'url' => config('app.url') . '/a2a',
                'skills' => config('services.a2a.skills', []),
            ];
        });

        // MCP Server 配置
        $this->app->singleton('mcp.server', function () {
            return [
                'name' => config('services.mcp.name', 'Laravel MCP Server'),
                'tools' => config('services.mcp.tools', []),
                'resources' => config('services.mcp.resources', []),
            ];
        });
    }
}
```

### 9.2 A2A Agent 作为 MCP Client

最精妙的设计是让 A2A Agent 在处理任务时，通过 MCP 协议调用外部工具。这样，一个 Task 可以触发多个 MCP Tool 调用：

```php
// app/Services/A2ATaskProcessor.php
namespace App\Services;

use Illuminate\Support\Facades\Http;

class A2ATaskProcessor
{
    private array $mcpServers;

    public function __construct()
    {
        $this->mcpServers = config('services.mcp.connections', []);
    }

    /**
     * 处理 A2A Task，内部可能调用多个 MCP Server
     */
    public function process(string $taskId, string $input): string
    {
        // 1. 解析用户意图
        $intent = $this->parseIntent($input);

        // 2. 根据意图选择需要调用的 MCP Servers
        $requiredTools = $this->selectTools($intent);

        // 3. 通过 MCP 协议调用工具
        $context = [];
        foreach ($requiredTools as $serverUrl => $tools) {
            foreach ($tools as $tool) {
                $result = $this->callMCPTool($serverUrl, $tool['name'], $tool['arguments']);
                $context[$tool['name']] = $result;
            }
        }

        // 4. 综合结果生成回复
        return $this->generateResponse($input, $context);
    }

    private function callMCPTool(string $serverUrl, string $name, array $arguments): mixed
    {
        $response = Http::withHeaders([
            'Content-Type' => 'application/json',
        ])->post($serverUrl, [
            'jsonrpc' => '2.0',
            'id' => uniqid(),
            'method' => 'tools/call',
            'params' => [
                'name' => $name,
                'arguments' => $arguments,
            ],
        ]);

        $data = $response->json();
        $content = $data['result']['content'] ?? [];

        foreach ($content as $part) {
            if (($part['type'] ?? '') === 'text') {
                return json_decode($part['text'], true) ?? $part['text'];
            }
        }

        return null;
    }

    private function parseIntent(string $input): string
    {
        if (preg_match('/查询|订单|状态/', $input)) return 'order_query';
        if (preg_match('/购买|下单|想要/', $input)) return 'order_create';
        if (preg_match('/推荐|有什么/', $input)) return 'recommend';
        return 'general';
    }

    private function selectTools(string $intent): array
    {
        return match ($intent) {
            'order_query' => [
                $this->mcpServers['ecommerce'] => [
                    ['name' => 'query_products', 'arguments' => ['keyword' => '']],
                ],
            ],
            'recommend' => [
                $this->mcpServers['ecommerce'] => [
                    ['name' => 'query_products', 'arguments' => ['keyword' => '热门']],
                ],
                $this->mcpServers['analytics'] => [
                    ['name' => 'get_trending', 'arguments' => ['period' => '7d']],
                ],
            ],
            default => [],
        };
    }

    private function generateResponse(string $input, array $context): string
    {
        // 在实际项目中，这里会调用 LLM 来生成回复
        $contextJson = json_encode($context, JSON_UNESCAPED_UNICODE);
        return "根据查询结果：\n{$contextJson}\n\n如需进一步操作，请告诉我。";
    }
}
```

### 9.3 架构全景图

```
外部 Agent（Client）
    │
    ▼ A2A 协议
┌─────────────────────────────────────────────────┐
│              Laravel 应用                        │
│                                                  │
│  ┌─────────────┐      ┌──────────────┐          │
│  │ A2A Agent   │ ───► │ Task Processor│          │
│  │ Controller  │      │              │          │
│  └─────────────┘      └──────┬───────┘          │
│                              │                   │
│                              ▼                   │
│  ┌─────────────┐      ┌──────────────┐          │
│  │ MCP Server  │ ◄─── │ MCP Client   │          │
│  │ Controller  │      │ (内部调用)    │          │
│  └──────┬──────┘      └──────────────┘          │
│         │                                       │
│         ▼                                       │
│  ┌──────────────┐                               │
│  │ Tools/        │                               │
│  │ Resources/    │                               │
│  │ Prompts       │                               │
│  └──────────────┘                               │
└─────────────────────────────────────────────────┘
    ▲
    │ MCP 协议
外部 MCP Client（Agent）
```

---

## 十、安全考量

在生产环境中部署 A2A/MCP 服务，安全是不可忽视的核心问题。

### 10.1 认证（Authentication）

**A2A 层：** 使用 Bearer Token 或 OAuth 2.0。每个请求都应携带有效的 JWT：

```php
// app/Http/Middleware/A2AAuthenticate.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class A2AAuthenticate
{
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (!$token || !$this->validateAgentToken($token)) {
            return response()->json([
                'jsonrpc' => '2.0',
                'id' => $request->json('id'),
                'error' => [
                    'code' => -32000,
                    'message' => 'Unauthorized: Invalid or missing agent token',
                ],
            ], 401);
        }

        // 将 Agent 身份信息注入请求
        $request->merge(['agent_identity' => $this->decodeToken($token)]);

        return $next($request);
    }

    private function validateAgentToken(string $token): bool
    {
        // 验证 JWT 签名和有效期
        try {
            $decoded = \JWT::decode($token, config('services.a2a.jwt_secret'));
            return $decoded->exp > time();
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function decodeToken(string $token): array
    {
        return (array) \JWT::decode($token, config('services.a2a.jwt_secret'));
    }
}
```

**MCP 层：** 使用 API Key 或 OAuth 2.0 Client Credentials 流程。

### 10.2 授权（Authorization）

不是所有 Agent 都能调用所有工具。实现基于角色的访问控制：

```php
// app/Policies/ToolPolicy.php
class ToolPolicy
{
    private array $permissions = [
        'guest' => ['query_products', 'get_product_detail'],
        'partner' => ['query_products', 'get_product_detail', 'check_inventory', 'calculate_shipping'],
        'admin' => ['*'],
    ];

    public function callTool(string $agentRole, string $toolName): bool
    {
        $allowed = $this->permissions[$agentRole] ?? [];
        return in_array('*', $allowed) || in_array($toolName, $allowed);
    }
}
```

### 10.3 速率限制

防止恶意 Agent 过度消耗资源：

```php
// app/Http/Kernel.php
protected $routeMiddleware = [
    'a2a.throttle' => \Illuminate\Routing\Middleware\ThrottleRequests::class,
];

// routes/web.php
Route::middleware('a2a.throttle:60,1')->group(function () {
    Route::post('/a2a', [A2AController::class, 'handleTask']);
    Route::post('/mcp', [MCPController::class, 'handle']);
});
```

### 10.4 输入验证

对所有外部输入进行严格验证：

```php
// app/Services/InputValidator.php
class InputValidator
{
    public static function validateToolArguments(string $toolName, array $args): array
    {
        $schema = self::getToolSchema($toolName);
        $validator = \Validator::make($args, self::schemaToRules($schema));

        if ($validator->fails()) {
            throw new \InvalidArgumentException(
                'Invalid tool arguments: ' . $validator->errors()->first()
            );
        }

        // SQL 注入防护
        foreach ($args as $key => $value) {
            if (is_string($value)) {
                $args[$key] = strip_tags($value);
            }
        }

        return $args;
    }

    public static function validateMessageParts(array $parts): array
    {
        foreach ($parts as &$part) {
            if (($part['type'] ?? '') === 'text') {
                // 限制文本长度
                if (mb_strlen($part['text'] ?? '') > 10000) {
                    throw new \InvalidArgumentException('Text part exceeds maximum length');
                }
            }
            if (($part['type'] ?? '') === 'file') {
                // 验证文件类型和大小
                $allowedTypes = ['image/png', 'image/jpeg', 'application/pdf'];
                if (!in_array($part['file']['mimeType'] ?? '', $allowedTypes)) {
                    throw new \InvalidArgumentException('Unsupported file type');
                }
            }
        }

        return $parts;
    }
}
```

---

## 十一、与其他协议的对比

在 Agent 通信领域，除了 A2A 和 MCP，还有其他值得关注的协议和框架。

### 11.1 LangChain Protocol

LangChain 是最流行的 Agent 开发框架之一，其内部也有通信机制。但 LangChain 的方案更偏向**框架内的组件通信**，而非开放的跨组织协议。

| 维度 | A2A + MCP | LangChain Protocol |
|------|-----------|-------------------|
| 设计目标 | 开放标准，跨组织 | 框架内部使用 |
| 语言绑定 | 语言无关（HTTP/JSON） | Python/JS 生态 |
| 发现机制 | Agent Card 自动发现 | 配置文件手动指定 |
| 社区治理 | 行业联盟（50+ 公司） | LangChain 公司主导 |

### 11.2 CrewAI

CrewAI 是一个专注于多代理协作的 Python 框架。它的核心概念是"角色"（Role）、"目标"（Goal）和"工具"（Tool），Agent 之间通过预定义的工作流协作。

与 A2A + MCP 相比，CrewAI 的优势在于**编排层**——它擅长定义"谁先做什么、谁后做什么"这样的工作流。而 A2A + MCP 更专注于**通信层**——解决"Agent 之间如何互相说话"的问题。

实际上，CrewAI 完全可以在 A2A + MCP 之上运行：每个 CrewAI 中的 Agent 可以通过 MCP 连接工具，通过 A2A 与其他 CrewAI 的 Agent 通信。

### 11.3 AutoGen（Microsoft）

微软的 AutoGen 框架引入了"对话式 Agent"的概念——Agent 之间通过模拟对话来协作解决问题。AutoGen 的优势在于**灵活的对话模式**，支持两方对话、群组讨论、嵌套对话等复杂模式。

但 AutoGen 的通信机制是内部实现的，缺乏标准化的协议定义。这意味着用 AutoGen 构建的 Agent 很难与非 AutoGen 的 Agent 互通——这正是 A2A 要解决的问题。

### 11.4 综合对比

| 特性 | A2A + MCP | CrewAI | AutoGen | LangChain |
|------|-----------|--------|---------|-----------|
| 开放标准 | ✅ | ❌ | ❌ | ❌ |
| 跨组织互操作 | ✅ | ❌ | ❌ | ❌ |
| 工具标准化 | ✅ (MCP) | 部分 | 部分 | 部分 |
| 任务生命周期 | ✅ (A2A) | ✅ | 部分 | ❌ |
| 流式通信 | ✅ | ❌ | ❌ | 部分 |
| 生产就绪 | 进行中 | ✅ | ✅ | ✅ |
| 学习曲线 | 中等 | 低 | 中等 | 低 |

---

## 十二、未来展望与生产部署建议

### 12.1 协议演进路线

A2A 和 MCP 都处于快速演进中。根据目前的发展趋势，我们可以预见以下方向：

**A2A 的演进：**
- **Agent 市场**：基于 Agent Card 的自动化发现将催生"Agent 市场"——一个 Agent 可以像搜索 API 一样搜索其他 Agent 的能力，自动选择最优的合作伙伴。
- **多方协作**：当前 A2A 主要支持两方通信，未来将扩展到多方协作场景（如三方谈判、分布式工作流）。
- **标准化治理**：随着更多企业加入，A2A 可能被提交到 W3C 或 IETF 进行标准化治理。

**MCP 的演进：**
- **权限模型增强**：更细粒度的权限控制，支持 Tool 级别的访问控制。
- **流式 Tool 调用**：支持长时间运行的 Tool 通过流式方式返回中间结果。
- **认证标准化**：统一的 OAuth 2.0 集成方案。

### 12.2 生产部署建议

**① 渐进式采用**

不要试图一次性将所有系统都接入 A2A + MCP。建议从以下路径渐进式推进：

1. **第一步**：为内部工具实现 MCP Server，让现有 Agent 能够标准化地调用工具。
2. **第二步**：为关键业务流程实现 A2A Agent，实现跨团队协作。
3. **第三步**：构建 Agent 注册中心，实现自动发现和动态路由。
4. **第四步**：开放外部 Agent 接入，实现跨组织协作。

**② 基础设施准备**

```yaml
# docker-compose.yml 示例
services:
  a2a-agent:
    build: .
    ports:
      - "8080:80"
    environment:
      - A2A_ENABLED=true
      - MCP_ENABLED=true
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - redis
      - postgres

  redis:
    image: redis:7-alpine
    # 用于 Task 状态缓存和速率限制

  postgres:
    image: postgres:16-alpine
    # 用于持久化存储

  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    # TLS 终止 + 负载均衡
```

**③ 监控与可观测性**

在生产环境中，你需要监控以下关键指标：

- **A2A 层**：Task 成功率、平均处理时间、Task 状态分布、Agent 间通信延迟。
- **MCP 层**：Tool 调用成功率、平均响应时间、Resource 访问频率、错误分布。
- **基础设施**：CPU/内存使用率、数据库连接池、Redis 内存使用。

建议使用 OpenTelemetry 进行分布式追踪，将 A2A Task ID 和 MCP Request ID 关联起来，实现端到端的请求链路追踪。

**④ 容错与降级**

```php
// app/Services/ResilientMCPClient.php
class ResilientMCPClient
{
    public function callToolWithRetry(
        string $serverUrl,
        string $toolName,
        array $arguments,
        int $maxRetries = 3
    ): mixed {
        $lastException = null;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                return $this->callTool($serverUrl, $toolName, $arguments);
            } catch (\Throwable $e) {
                $lastException = $e;
                \Log::warning("MCP Tool call failed (attempt {$attempt})", [
                    'server' => $serverUrl,
                    'tool' => $toolName,
                    'error' => $e->getMessage(),
                ]);

                if ($attempt < $maxRetries) {
                    sleep(pow(2, $attempt)); // 指数退避
                }
            }
        }

        // 降级：返回缓存结果或默认值
        return $this->fallback($serverUrl, $toolName, $arguments);
    }

    private function fallback(string $serverUrl, string $toolName, array $arguments): mixed
    {
        $cacheKey = "mcp_fallback_{$toolName}_" . md5(json_encode($arguments));
        return \Cache::get($cacheKey, ['error' => 'Service temporarily unavailable']);
    }
}
```

### 12.3 开发者生态建设

作为 Laravel 开发者，你可以通过以下方式参与到 A2A + MCP 生态中：

1. **为常用 Laravel 包提供 MCP Server**：比如为 Spatie 的 Permission 包创建 MCP Server，让 AI Agent 能够管理用户权限。
2. **构建 Laravel A2A/MCP 开发包**：将本文中的实现封装成 Composer 包，降低社区使用门槛。
3. **参与标准化进程**：在 A2A 和 MCP 的 GitHub 仓库中提交 Issue 和 PR，影响协议的演进方向。

### 12.4 结语

A2A 和 MCP 代表了 AI Agent 生态从"单打独斗"走向"开放协作"的关键一步。MCP 标准化了 Agent 与工具的连接方式，A2A 标准化了 Agent 之间的通信方式——两者共同构建了一个分层的、开放的、可互操作的 Agent 通信基础设施。

对于 Laravel 开发者而言，这是一个巨大的机遇。PHP 生态在企业级应用中有着广泛的部署基础，通过 A2A + MCP 协议，这些已有的业务系统可以无缝地接入 AI Agent 生态，成为"智能协作网络"中的一个个节点。

未来的 AI 应用，不是由一个超级 Agent 统治一切，而是由无数个专业化的 Agent 通过标准化协议协作完成复杂的任务。A2A + MCP，正是这个未来的基石。

---

> **参考资料**
>
> - [Google A2A Protocol Official Repository](https://github.com/google/A2A)
> - [Model Context Protocol Specification](https://modelcontextprotocol.io/)
> - [A2A Protocol Specification](https://google.github.io/A2A/)
> - [Anthropic MCP Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/mcp)
> - [Laravel Documentation](https://laravel.com/docs)

---

## 相关阅读

- [AI Agent 可观测性实战](/categories/AI/ai-agent-observability-2026/)
- [AI Agent Human-in-the-Loop 实战](/categories/AI/AI-Agent-Human-in-the-Loop-实战-审批节点-人工确认-中断恢复/)
- [RAG Reranking 检索质量优化](/categories/AI/2026-06-07-RAG-Reranking-Cross-Encoder-ColBERT-延迟交互-检索质量优化/)
