---
title: 'AI Agent 多代理通信协议实战：Google A2A + MCP 互补架构——跨组织 Agent 互操作的开放标准与 Laravel 集成'
date: 2026-06-07 08:00:00
tags: [AI Agent, A2A, MCP, Laravel, 多代理, 通信协议]
categories: [AI]
cover: /images/covers/ai-agent-a2a-mcp-cover.jpg
description: '深入解析 Google A2A 与 Anthropic MCP 两大 AI Agent 多代理通信协议的架构设计、核心差异与互补协作模式。通过 Laravel 实战演示如何构建 A2A 兼容 Agent 服务器，实现跨组织 Agent 互操作。涵盖 Agent Card 发现机制、Task 生命周期管理、MCP Client 封装、A2A 认证中间件、跨组织合同审查协作案例及安全最佳实践，适合 PHP/Laravel 开发者快速上手构建生产级多代理系统。'
---

## 一、引言：2026 年多代理通信为何至关重要

2026 年，AI Agent 已经从实验室概念演变为生产级基础设施。企业不再满足于部署单个智能助手，而是构建由数十甚至数百个专业化 Agent 组成的协作网络——财务 Agent 自动对账、法律 Agent 审查合同、供应链 Agent 优化物流、客服 Agent 处理用户请求。这些 Agent 可能运行在不同的云平台上，由不同的团队甚至不同的组织开发和维护。

**核心矛盾随之浮现**：当每个 Agent 都是一座信息孤岛，它们之间的协作效率远低于预期。一个简单的跨部门审批流程，可能需要人工在三个系统之间复制粘贴数据。一个供应链优化任务，涉及供应商、物流商和零售商各自的 Agent，却缺乏标准化的通信方式。

这就是多代理通信协议要解决的问题。2025 年至 2026 年间，两个关键协议应运而生并迅速成熟：

- **MCP（Model Context Protocol）**——由 Anthropic 提出，解决 Agent 如何连接外部工具和数据源
- **A2A（Agent-to-Agent Protocol）**——由 Google 主导，解决 Agent 之间如何相互发现、协商和协作

两者并非竞争关系，而是**互补架构**。本文将深入剖析这两个协议的设计理念、技术细节，并通过 Laravel 实战演示如何构建一个 A2A 兼容的 Agent 服务器，最终实现跨组织 Agent 协作的完整案例。

---

## 二、MCP 深度解析：模型上下文协议

### 2.1 MCP 是什么

MCP（Model Context Protocol）是 Anthropic 于 2024 年底发布的开放协议，旨在为 LLM 应用提供标准化的方式来连接外部数据源和工具。它的核心理念可以用一句话概括：**将"模型如何获取上下文"这个问题标准化**。

在 MCP 出现之前，每个 AI 应用都需要为每个外部服务编写定制化的集成代码。连接数据库要写一套，访问文件系统要写一套，调用 API 又要写一套。MCP 定义了一套通用的接口规范，使得任何符合 MCP 的工具服务器（MCP Server）都可以被任何符合 MCP 的客户端（MCP Client）使用。

### 2.2 架构设计

MCP 采用经典的**客户端-服务器架构**：

```
┌─────────────────┐         ┌─────────────────┐
│   MCP Client    │ ◄─────► │   MCP Server    │
│  (AI 应用/Host) │  协议层  │  (工具/数据源)   │
└─────────────────┘         └─────────────────┘
```

- **MCP Host**：发起连接的 AI 应用，如 Claude Desktop、IDE 插件、自定义 Agent
- **MCP Client**：Host 内部管理与 Server 通信的组件，维护 1:1 的有状态会话
- **MCP Server**：暴露工具、资源和预设模板的轻量级程序

MCP Server 可以向 Client 暴露三种核心能力：

1. **Tools（工具）**：可被模型调用的函数，如查询数据库、发送邮件、调用第三方 API
2. **Resources（资源）**：可被读取的数据，如文件内容、数据库记录、API 响应
3. **Prompts（预设模板）**：预定义的提示词模板，可带参数化输入

### 2.3 传输层：三种方式

MCP 支持三种传输机制，适应不同的部署场景：

**stdio（标准输入/输出）**：最简单的方式，Client 直接启动 Server 进程，通过 stdin/stdout 交换 JSON-RPC 消息。适用于本地集成，如 Claude Desktop 启动本地 Python 脚本作为 MCP Server。

```json
// stdio 模式下的初始化消息
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "tools": {}
    },
    "clientInfo": {
      "name": "MyAgent",
      "version": "1.0"
    }
  }
}
```

**SSE（Server-Sent Events）**：基于 HTTP 的单向流，Client 通过 SSE 接收 Server 推送，通过 HTTP POST 发送请求。适用于 Web 应用和远程集成。

**Streamable HTTP（2025-03-26 新增）**：最新的传输方式，基于普通 HTTP 请求/响应，可选升级为 SSE 流。支持无状态服务器模式，更适合大规模部署和云原生场景。

### 2.4 工具注册示例

一个典型的 MCP Server 工具注册如下：

```json
{
  "name": "query_database",
  "description": "查询指定数据库中的数据",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sql": {
        "type": "string",
        "description": "SQL 查询语句"
      },
      "database": {
        "type": "string",
        "description": "数据库名称"
      }
    },
    "required": ["sql", "database"]
  }
}
```

客户端在 `initialize` 阶段获取 Server 的能力描述，之后通过 `tools/list` 获取完整工具列表，通过 `tools/call` 调用具体工具。

---

## 三、Google A2A 协议深度解析

### 3.1 A2A 是什么

如果说 MCP 解决的是"Agent 如何使用工具"，那么 A2A 解决的是一个更高层次的问题：**Agent 如何与 Agent 协作**。

Google 于 2025 年 4 月联合 50 多家技术合作伙伴（包括 Salesforce、SAP、LangChain、Cohere 等）发布了 A2A 协议。A2A 的核心目标是让不同组织、不同框架构建的 Agent 能够相互发现、通信和协作，而无需预先了解彼此的内部实现。

### 3.2 Agent Card：Agent 的"名片"

A2A 的核心概念之一是 **Agent Card**——一个 JSON 格式的元数据文件，描述了 Agent 的身份、能力和通信端点。Agent Card 通常托管在 `/.well-known/agent.json` 路径下，类似于 Web 的 `robots.txt` 惯例。

```json
{
  "name": "ContractReviewAgent",
  "description": "专业合同审查 Agent，支持中英文合同分析",
  "url": "https://agent.legalcorp.com/a2a",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "authentication": {
    "schemes": ["Bearer"]
  },
  "defaultInputModes": ["text", "file"],
  "defaultOutputModes": ["text", "file"],
  "skills": [
    {
      "id": "contract-review",
      "name": "合同审查",
      "description": "审查合同条款，识别风险点，提供修改建议",
      "tags": ["legal", "contract", "risk-analysis"],
      "examples": [
        "请审查这份供应商合同的风险条款",
        "比较这两份合同的差异"
      ]
    }
  ]
}
```

Agent Card 的关键信息包括：
- **身份信息**：名称、描述、版本
- **能力声明**：是否支持流式传输、推送通知、状态历史
- **认证方式**：Bearer Token、OAuth2 等
- **技能列表**：Agent 擅长的任务类型，带标签和示例

### 3.3 Task 生命周期

A2A 中的核心交互单元是 **Task（任务）**。每个任务都有明确的生命周期：

```
submitted → working → input-required → completed
                ↓                      ↓
            failed                  canceled
```

任务的典型交互流程：

```json
// 1. 客户端发起任务
{
  "jsonrpc": "2.0",
  "id": "task-001",
  "method": "tasks/send",
  "params": {
    "id": "task-001",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "请审查这份供应商合同，重点关注付款条款和违约责任"
        },
        {
          "type": "file",
          "file": {
            "name": "contract.pdf",
            "mimeType": "application/pdf",
            "bytes": "<base64编码>"
          }
        }
      ]
    }
  }
}

// 2. 服务端返回结果
{
  "jsonrpc": "2.0",
  "id": "task-001",
  "result": {
    "id": "task-001",
    "status": {
      "state": "completed",
      "message": {
        "role": "agent",
        "parts": [
          {
            "type": "text",
            "text": "合同审查完成。发现3个高风险条款..."
          }
        ]
      }
    },
    "artifacts": [
      {
        "name": "审查报告",
        "parts": [
          {
            "type": "file",
            "file": {
              "name": "review-report.pdf",
              "mimeType": "application/pdf",
              "bytes": "<base64编码>"
            }
          }
        ]
      }
    ]
  }
}
```

Task 还支持 `input-required` 状态，允许服务端 Agent 反向向客户端 Agent 请求额外信息，形成真正的双向对话。

### 3.4 发现机制

A2A 定义了标准化的 Agent 发现流程：

1. **DNS-Based Discovery**：通过 DNS TXT 记录查找 Agent Card URL
2. **Well-Known URI**：直接访问 `https://{domain}/.well-known/agent.json`
3. **Registry-Based**：通过企业 Agent 注册中心查询

这使得客户端 Agent 可以动态发现网络中可用的服务端 Agent，无需预先硬编码连接信息。

---

## 四、A2A vs MCP：互补而非竞争

理解这两个协议的关键在于认识到它们处于**不同的抽象层级**：

| 维度 | MCP | A2A |
|------|-----|-----|
| 通信对象 | Agent ↔ 工具/数据源 | Agent ↔ Agent |
| 抽象层级 | 单一功能调用 | 完整任务协作 |
| 交互模式 | 请求-响应 | 多轮对话、状态机 |
| 发现机制 | 静态配置 | 动态发现（Agent Card） |
| 组织边界 | 通常内部 | 跨组织设计 |
| 典型场景 | 读数据库、调 API | 委派任务、协商方案 |

一个形象的比喻：**MCP 是 Agent 的"手"，A2A 是 Agent 的"嘴"**。MCP 让 Agent 能操作外部世界，A2A 让 Agent 能与其他 Agent 交流协作。

在实际系统中，两者经常协同工作：
- Agent A 通过 A2A 接收来自 Agent B 的任务请求
- Agent A 内部使用 MCP 调用数据库、搜索引擎等工具完成任务
- Agent A 通过 A2A 将结果返回给 Agent B

---

## 五、A2A + MCP 互补架构模式

### 5.1 分层架构

```
┌─────────────────────────────────────────────────┐
│              应用层（业务逻辑）                     │
├─────────────────────────────────────────────────┤
│         A2A 层（Agent 间通信）                     │
│   Agent Card | Task 生命周期 | 发现机制             │
├─────────────────────────────────────────────────┤
│         MCP 层（工具集成）                         │
│   工具注册 | 资源访问 | 上下文管理                   │
├─────────────────────────────────────────────────┤
│         传输层（HTTP/SSE/stdio）                   │
└─────────────────────────────────────────────────┘
```

### 5.2 跨组织协作架构

考虑一个真实的跨组织场景：企业 A 的采购 Agent 需要与供应商 B 的报价 Agent 协作。

```
企业 A 内部                           企业 B 内部
┌──────────┐    A2A 协议              ┌──────────┐
│ 采购Agent │ ◄─────────────────────► │ 报价Agent │
│          │                          │          │
│  MCP工具: │                          │  MCP工具: │
│  - ERP系统│                          │  - 库存DB │
│  - 预算DB │                          │  - 价格表 │
│  - 合规检查│                          │  - 物流API│
└──────────┘                          └──────────┘
```

采购 Agent 通过 A2A 向报价 Agent 发送询价请求，报价 Agent 内部通过 MCP 调用库存数据库和价格表生成报价，再通过 A2A 返回结果。双方的 MCP 工具对彼此完全透明——这是 A2A 协议"抽象掉内部实现"的核心价值。

### 5.3 编排模式

在多 Agent 编排场景中，A2A 支持多种协作模式：

- **链式调用**：Agent A → Agent B → Agent C，逐级传递和处理
- **扇出/扇入**：一个 Agent 同时向多个 Agent 分发子任务，汇总结果
- **动态路由**：根据任务类型和 Agent 能力，动态选择最优 Agent
- **协商模式**：多个 Agent 就方案进行多轮讨论和投票

---

## 六、Laravel 集成：构建 A2A 兼容 Agent 服务器

### 6.1 项目初始化

让我们用 Laravel 构建一个完整的 A2A Agent 服务器。这个服务器将暴露一个合同审查 Agent，支持 A2A 协议的标准交互。

```bash
composer create-project laravel/laravel a2a-agent-server
cd a2a-agent-server
composer require guzzlehttp/guzzle laravel/octane
```

### 6.2 Agent Card 路由

首先，实现 Agent Card 的标准端点：

```php
// routes/web.php
use App\Http\Controllers\A2A\AgentCardController;
use App\Http\Controllers\A2A\TaskController;

Route::get('/.well-known/agent.json', [AgentCardController::class, 'show']);
Route::post('/a2a', [TaskController::class, 'handle']);
```

```php
// app/Http/Controllers/A2A/AgentCardController.php
<?php

namespace App\Http\Controllers\A2A;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class AgentCardController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json([
            'name' => 'ContractReviewAgent',
            'description' => '专业合同审查Agent，支持中英文合同风险分析、条款比对和合规检查',
            'url' => config('app.url') . '/a2a',
            'version' => '1.0.0',
            'capabilities' => [
                'streaming' => false,
                'pushNotifications' => false,
                'stateTransitionHistory' => true,
            ],
            'authentication' => [
                'schemes' => ['Bearer'],
            ],
            'defaultInputModes' => ['text', 'file'],
            'defaultOutputModes' => ['text', 'file'],
            'skills' => [
                [
                    'id' => 'contract-review',
                    'name' => '合同审查',
                    'description' => '审查合同条款，识别潜在风险',
                    'tags' => ['legal', 'contract', 'risk-analysis'],
                    'examples' => [
                        '请审查这份供应商合同',
                        '检查合同中的付款条款是否合理',
                    ],
                ],
                [
                    'id' => 'contract-compare',
                    'name' => '合同比对',
                    'description' => '比较两份合同的差异',
                    'tags' => ['legal', 'compare', 'diff'],
                    'examples' => [
                        '对比这两份合同的条款差异',
                    ],
                ],
            ],
        ]);
    }
}
```

### 6.3 Task 处理核心

```php
// app/Http/Controllers/A2A/TaskController.php
<?php

namespace App\Http\Controllers\A2A;

use App\Http\Controllers\Controller;
use App\Services\A2A\TaskManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Ramsey\Uuid\Uuid;

class TaskController extends Controller
{
    public function __construct(
        private TaskManager $taskManager
    ) {}

    public function handle(Request $request): JsonResponse
    {
        $body = $request->validate([
            'jsonrpc' => 'required|string',
            'method' => 'required|string',
            'id' => 'required|string',
            'params' => 'required|array',
            'params.id' => 'nullable|string',
            'params.message' => 'required|array',
            'params.message.role' => 'required|string',
            'params.message.parts' => 'required|array',
        ]);

        $method = $body['method'];
        $params = $body['params'];

        return match ($method) {
            'tasks/send' => $this->handleTaskSend($body['id'], $params),
            'tasks/get' => $this->handleTaskGet($body['id'], $params),
            'tasks/cancel' => $this->handleTaskCancel($body['id'], $params),
            default => response()->json([
                'jsonrpc' => '2.0',
                'id' => $body['id'],
                'error' => [
                    'code' => -32601,
                    'message' => "Method not found: {$method}",
                ],
            ], 404),
        };
    }

    private function handleTaskSend(string $jsonrpcId, array $params): JsonResponse
    {
        $taskId = $params['id'] ?? Uuid::uuid4()->toString();
        $message = $params['message'];

        // 创建任务并处理
        $task = $this->taskManager->createTask($taskId, $message);

        // 异步处理任务（生产环境应使用队列）
        $result = $this->taskManager->processTask($task);

        return response()->json([
            'jsonrpc' => '2.0',
            'id' => $jsonrpcId,
            'result' => $result,
        ]);
    }

    private function handleTaskGet(string $jsonrpcId, array $params): JsonResponse
    {
        $task = $this->taskManager->getTask($params['id']);

        if (!$task) {
            return response()->json([
                'jsonrpc' => '2.0',
                'id' => $jsonrpcId,
                'error' => [
                    'code' => -32001,
                    'message' => 'Task not found',
                ],
            ], 404);
        }

        return response()->json([
            'jsonrpc' => '2.0',
            'id' => $jsonrpcId,
            'result' => $task->toA2AResponse(),
        ]);
    }

    private function handleTaskCancel(string $jsonrpcId, array $params): JsonResponse
    {
        $task = $this->taskManager->cancelTask($params['id']);

        return response()->json([
            'jsonrpc' => '2.0',
            'id' => $jsonrpcId,
            'result' => $task->toA2AResponse(),
        ]);
    }
}
```

### 6.4 TaskManager 服务

```php
// app/Services/A2A/TaskManager.php
<?php

namespace App\Services\A2A;

use App\Models\A2ATask;
use App\Services\MCP\MCPClient;
use Illuminate\Support\Facades\Cache;
use Ramsey\Uuid\Uuid;

class TaskManager
{
    public function __construct(
        private MCPClient $mcpClient,
        private ContractReviewService $reviewService
    ) {}

    public function createTask(string $taskId, array $message): A2ATask
    {
        $task = A2ATask::create([
            'id' => $taskId,
            'status' => 'submitted',
            'input_message' => $message,
            'created_at' => now(),
        ]);

        return $task;
    }

    public function processTask(A2ATask $task): array
    {
        $task->update(['status' => 'working']);

        try {
            $parts = $task->input_message['parts'] ?? [];
            $textPart = collect($parts)->firstWhere('type', 'text');
            $filePart = collect($parts)->firstWhere('type', 'file');

            // 通过 MCP 调用内部工具处理任务
            $context = [];

            if ($filePart) {
                // 使用 MCP 文件解析工具
                $parsed = $this->mcpClient->callTool('parse_document', [
                    'file_bytes' => $filePart['file']['bytes'] ?? '',
                    'mime_type' => $filePart['file']['mimeType'] ?? 'application/pdf',
                ]);
                $context['document'] = $parsed;
            }

            // 使用 LLM 进行合同分析
            $analysis = $this->reviewService->analyze(
                prompt: $textPart['text'] ?? '',
                context: $context
            );

            $task->update([
                'status' => 'completed',
                'output' => $analysis,
            ]);

            return [
                'id' => $task->id,
                'status' => [
                    'state' => 'completed',
                    'timestamp' => now()->toIso8601String(),
                ],
                'artifacts' => [
                    [
                        'name' => '审查结果',
                        'parts' => [
                            [
                                'type' => 'text',
                                'text' => $analysis['summary'],
                            ],
                        ],
                    ],
                ],
            ];
        } catch (\Throwable $e) {
            $task->update([
                'status' => 'failed',
                'error' => $e->getMessage(),
            ]);

            return [
                'id' => $task->id,
                'status' => [
                    'state' => 'failed',
                    'message' => [
                        'role' => 'agent',
                        'parts' => [
                            ['type' => 'text', 'text' => '任务处理失败：' . $e->getMessage()],
                        ],
                    ],
                ],
            ];
        }
    }

    public function getTask(string $taskId): ?A2ATask
    {
        return A2ATask::find($taskId);
    }

    public function cancelTask(string $taskId): A2ATask
    {
        $task = A2ATask::findOrFail($taskId);
        $task->update(['status' => 'canceled']);
        return $task;
    }
}
```

### 6.5 MCP Client 封装

```php
// app/Services/MCP/MCPClient.php
<?php

namespace App\Services\MCP;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MCPClient
{
    private string $serverUrl;
    private ?string $sessionId = null;

    public function __construct()
    {
        $this->serverUrl = config('services.mcp.server_url', 'http://localhost:3001');
    }

    public function callTool(string $toolName, array $arguments = []): mixed
    {
        $response = Http::timeout(30)->post($this->serverUrl . '/mcp', [
            'jsonrpc' => '2.0',
            'id' => uniqid('mcp_'),
            'method' => 'tools/call',
            'params' => [
                'name' => $toolName,
                'arguments' => $arguments,
            ],
        ]);

        if ($response->failed()) {
            Log::error("MCP tool call failed: {$toolName}", [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
            throw new \RuntimeException("MCP tool call failed: {$toolName}");
        }

        $data = $response->json();

        if (isset($data['error'])) {
            throw new \RuntimeException("MCP error: {$data['error']['message']}");
        }

        return $data['result'] ?? null;
    }

    public function listTools(): array
    {
        $response = Http::timeout(10)->post($this->serverUrl . '/mcp', [
            'jsonrpc' => '2.0',
            'id' => uniqid('mcp_'),
            'method' => 'tools/list',
            'params' => [],
        ]);

        return $response->json('result.tools', []);
    }
}
```

### 6.6 A2A 客户端（用于发起跨组织调用）

```php
// app/Services/A2A/A2AClient.php
<?php

namespace App\Services\A2A;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class A2AClient
{
    private array $discoveredAgents = [];

    /**
     * 通过域名发现远程 Agent
     */
    public function discoverAgent(string $domain): array
    {
        if (isset($this->discoveredAgents[$domain])) {
            return $this->discoveredAgents[$domain];
        }

        $response = Http::timeout(10)
            ->get("https://{$domain}/.well-known/agent.json");

        if ($response->failed()) {
            throw new \RuntimeException("Agent discovery failed for: {$domain}");
        }

        $this->discoveredAgents[$domain] = $response->json();
        return $this->discoveredAgents[$domain];
    }

    /**
     * 向远程 Agent 发送任务
     */
    public function sendTask(
        string $agentUrl,
        string $message,
        array $files = [],
        ?string $skill = null,
        string $bearerToken = ''
    ): array {
        $parts = [
            ['type' => 'text', 'text' => $message],
        ];

        foreach ($files as $file) {
            $parts[] = [
                'type' => 'file',
                'file' => [
                    'name' => $file['name'],
                    'mimeType' => $file['mime_type'],
                    'bytes' => base64_encode(file_get_contents($file['path'])),
                ],
            ];
        }

        $request = [
            'jsonrpc' => '2.0',
            'id' => uniqid('a2a_'),
            'method' => 'tasks/send',
            'params' => [
                'id' => \Ramsey\Uuid\Uuid::uuid4()->toString(),
                'message' => [
                    'role' => 'user',
                    'parts' => $parts,
                ],
            ],
        ];

        if ($skill) {
            $request['params']['metadata'] = ['skill' => $skill];
        }

        $response = Http::timeout(120)
            ->withToken($bearerToken)
            ->post($agentUrl, $request);

        if ($response->failed()) {
            Log::error('A2A task failed', [
                'url' => $agentUrl,
                'status' => $response->status(),
            ]);
            throw new \RuntimeException("A2A task failed: {$response->status()}");
        }

        return $response->json();
    }
}
```

### 6.7 数据库迁移

```php
// database/migrations/2026_06_07_000000_create_a2_a_tasks_table.php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('a2_a_tasks', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('status')->index(); // submitted, working, completed, failed, canceled
            $table->json('input_message')->nullable();
            $table->json('output')->nullable();
            $table->text('error')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('a2_a_tasks');
    }
};
```

---

## 七、实战案例：跨组织合同审查协作

### 7.1 场景描述

- **企业 A（采购方）**：运行采购 Agent，使用 Laravel + A2A 构建
- **企业 B（供应商）**：运行合同审查 Agent，使用 Python + A2A 构建
- **协作流程**：采购 Agent 将合同发送给审查 Agent，获取风险评估报告

### 7.2 采购 Agent 端（Laravel）

```php
// app/Services/ProcurementAgent.php
<?php

namespace App\Services;

use App\Services\A2A\A2AClient;

class ProcurementAgent
{
    public function __construct(
        private A2AClient $a2aClient
    ) {}

    /**
     * 委托合同审查任务给外部审查 Agent
     */
    public function requestContractReview(string $contractPdfPath): array
    {
        // 1. 发现审查 Agent
        $agentCard = $this->a2aClient->discoverAgent('agent.legalcorp.com');

        // 2. 验证 Agent 支持所需技能
        $hasSkill = collect($agentCard['skills'] ?? [])
            ->contains('id', 'contract-review');

        if (!$hasSkill) {
            throw new \RuntimeException('目标 Agent 不支持合同审查技能');
        }

        // 3. 发送审查任务
        $result = $this->a2aClient->sendTask(
            agentUrl: $agentCard['url'],
            message: '请审查这份供应商合同，重点关注：1)付款条款 2)违约责任 3)知识产权归属',
            files: [
                [
                    'name' => 'supplier-contract.pdf',
                    'mime_type' => 'application/pdf',
                    'path' => $contractPdfPath,
                ],
            ],
            skill: 'contract-review',
            bearerToken: config('services.legalcorp.token')
        );

        // 4. 处理返回结果
        $status = $result['result']['status']['state'] ?? 'unknown';

        if ($status === 'completed') {
            $artifacts = $result['result']['artifacts'] ?? [];
            return [
                'success' => true,
                'summary' => $artifacts[0]['parts'][0]['text'] ?? '',
                'full_result' => $result,
            ];
        }

        return [
            'success' => false,
            'error' => $result['result']['status']['message'] ?? '未知错误',
        ];
    }
}
```

### 7.3 审查 Agent 端（Python，简要展示）

```python
# 审查 Agent 的 A2A 服务端实现（Python）
# 使用 Google 提供的 A2A SDK

from a2a.server import A2AServer, TaskHandler
from a2a.types import Task, Message, Part

class ContractReviewHandler(TaskHandler):
    async def handle(self, task: Task) -> Task:
        # 提取文本和文件
        text = task.message.get_text()
        files = task.message.get_files()
        
        # 通过 MCP 调用文档解析工具
        doc_content = await self.mcp_client.call_tool(
            "parse_pdf", {"bytes": files[0].bytes}
        )
        
        # 使用 LLM 分析合同
        analysis = await self.llm.analyze(
            f"审查合同：{doc_content}\n\n要求：{text}"
        )
        
        # 返回结果
        task.status.state = "completed"
        task.artifacts = [Artifact(
            name="审查报告",
            parts=[Part(type="text", text=analysis)]
        )]
        return task

server = A2AServer(host="0.0.0.0", port=8080, handler=ContractReviewHandler())
server.run()
```

### 7.4 调用示例

```php
// 在 Laravel 控制器或 Artisan 命令中
$agent = app(ProcurementAgent::class);
$result = $agent->requestContractReview(storage_path('app/contracts/vendor-2026-q2.pdf'));

if ($result['success']) {
    echo "合同审查完成：\n" . $result['summary'];
} else {
    echo "审查失败：" . $result['error'];
}
```

---

## 八、安全考量

### 8.1 认证与授权

A2A 协议内置了对多种认证方案的支持：

- **Bearer Token**：最简单的方式，适合服务间调用
- **OAuth 2.0**：适合需要细粒度权限控制的企业场景
- **API Key**：适合低安全要求的公开 Agent 服务
- **mTLS（双向 TLS）**：最高安全级别，适合金融、医疗等敏感场景

在 Laravel 中实现 A2A 认证中间件：

```php
// app/Http/Middleware/A2AAuthenticate.php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class A2AAuthenticate
{
    public function handle(Request $request, Closure $next)
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code' => -32001,
                    'message' => 'Authentication required',
                ],
            ], 401);
        }

        // 验证 token 对应的组织和权限
        $client = \App\Models\A2AClient::where('token', hash('sha256', $token))->first();

        if (!$client) {
            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code' => -32001,
                    'message' => 'Invalid token',
                ],
            ], 401);
        }

        $request->attributes->set('a2a_client', $client);

        return $next($request);
    }
}
```

### 8.2 信任边界

跨组织 Agent 通信涉及的信任问题需要特别注意：

1. **输入验证**：严格验证所有传入的 JSON-RPC 消息格式和内容
2. **速率限制**：对 A2A 端点实施速率限制，防止滥用
3. **文件扫描**：对传入文件进行恶意软件扫描和格式验证
4. **数据脱敏**：在跨组织传输前，对敏感数据进行脱敏处理
5. **审计日志**：记录所有 A2A 交互的完整审计日志
6. **沙箱执行**：MCP 工具调用在沙箱环境中执行，限制系统访问

### 8.3 数据主权

跨组织数据交换必须考虑数据主权问题：
- 数据是否跨越了地理边界？
- 是否符合 GDPR、CCPA 等隐私法规？
- 是否需要数据处理协议（DPA）？

建议在 Agent Card 中声明数据处理政策，并在任务交换前进行合规检查。

---

## 九、与其他协议的比较

### 9.1 OpenAI 的方案

OpenAI 在 Agent 通信方面采取了不同的策略。其 Assistants API 和 Function Calling 机制主要聚焦于单 Agent 与工具的集成，而非 Agent 间的标准化通信。OpenAI 的 Agents SDK（2025 年发布）提供了多 Agent 编排能力，但更多是框架级别的解决方案，而非开放协议。

**关键差异**：
- A2A 是**协议标准**，任何框架都可以实现；OpenAI 的方案是**框架实现**
- A2A 设计用于**跨组织**互操作；OpenAI 的方案主要面向**同平台**场景
- A2A 基于 JSON-RPC 2.0，**语言无关**；OpenAI SDK 主要面向 Python/Node.js

### 9.2 企业级框架对比

| 框架/协议 | 类型 | 开放标准 | 跨组织 | 成熟度 |
|-----------|------|---------|--------|--------|
| A2A | 协议 | 是 | 是 | 快速增长 |
| MCP | 协议 | 是 | 否（内部） | 已成熟 |
| OpenAI Agents SDK | 框架 | 否 | 否 | 成熟 |
| LangGraph | 框架 | 否 | 否 | 成熟 |
| CrewAI | 框架 | 否 | 否 | 成熟 |
| AutoGen | 框架 | 部分 | 否 | 成熟 |

值得注意的是，这些框架正在积极拥抱 A2A 和 MCP。LangChain 已宣布支持 A2A，AutoGen 也提供了 MCP 集成。未来的趋势是：**协议归协议，框架归框架**——A2A 和 MCP 定义标准，框架在标准之上提供便利的开发体验。

---

## 十、未来展望与最佳实践

### 10.1 趋势预测

**2026 年及以后**，我们可以预期以下发展：

1. **A2A 成为事实标准**：随着 Google、Salesforce、SAP 等巨头的推动，A2A 将成为跨组织 Agent 通信的事实标准
2. **MCP 生态爆发**：MCP Server 的数量将呈指数增长，覆盖几乎所有主流 SaaS 和数据源
3. **协议融合**：A2A 和 MCP 的边界可能进一步模糊，可能出现统一的高层抽象
4. **Agent 市场**：类似 App Store 的 Agent 服务市场将出现，Agent Card 就是上架信息
5. **监管框架**：各国将出台针对 AI Agent 互操作性的监管要求

### 10.2 最实践建议

**协议选型**：
- Agent 需要访问外部工具/数据源？→ 使用 MCP
- Agent 需要与其他 Agent 协作？→ 使用 A2A
- 两者都需要？→ A2A + MCP 分层架构

**实现建议**：
- Agent Card 应保持最新，准确反映 Agent 的真实能力
- 任务实现幂等性，支持重试而不产生副作用
- 使用异步任务队列（Laravel Queue）处理耗时任务
- 实现完善的错误处理和状态回传
- 在 Agent Card 中使用清晰的技能描述和示例

**安全建议**：
- 始终验证请求来源和权限
- 对所有外部输入进行严格校验
- 实施最小权限原则
- 保留完整的审计日志
- 定期轮换认证凭证

**Laravel 特定建议**：
- 利用 Laravel 的中间件机制实现 A2A 认证和限流
- 使用 Eloquent 模型管理 Task 状态
- 通过 Laravel Queue 处理长时间运行的任务
- 使用 Laravel 的配置管理来灵活切换不同的 MCP Server

---

## 总结

A2A 和 MCP 的出现标志着 AI Agent 生态从"单打独斗"走向"团队协作"的关键转折。MCP 标准化了 Agent 与工具的连接方式，A2A 标准化了 Agent 之间的通信方式。两者共同构建了一个开放的、可互操作的多代理生态系统。

通过 Laravel 构建 A2A 兼容的 Agent 服务器，PHP/ Laravel 开发者可以将自己的业务逻辑封装为标准化的 Agent 服务，无缝融入这个全球化的 Agent 协作网络。无论是企业内部的多系统集成，还是跨组织的业务协作，A2A + MCP 的互补架构都提供了清晰、安全、可扩展的解决方案。

未来已来——不是单个 AI 在改变世界，而是无数 AI Agent 协作的网络在重塑整个商业基础设施。现在就是加入这个网络的最佳时机。

## 相关阅读

- [AI Agent 可观测性 2026 全景：LangSmith vs LangFuse vs Braintrust vs Arize——LLM 应用的追踪、评估、标注与生产调试闭环](/categories/AI/ai-agent-observability-2026/)
- [AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化](/categories/AI-Agent/AI-Agent-数据分析实战-自然语言转SQL-图表生成-报告自动化/)
- [AI Agent Human-in-the-Loop 实战：审批节点、人工确认、中断恢复——生产级 Agent 的人机协作模式](/categories/AI/AI-Agent-Human-in-the-Loop-实战-审批节点-人工确认-中断恢复/)
