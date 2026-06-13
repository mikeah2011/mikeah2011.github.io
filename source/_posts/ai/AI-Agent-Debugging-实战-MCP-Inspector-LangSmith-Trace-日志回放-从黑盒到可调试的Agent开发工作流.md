---
title: 'AI Agent Debugging 实战：MCP Inspector/LangSmith Trace/日志回放——从黑盒到可调试的 Agent 开发工作流'
date: 2026-06-05 08:00:00
tags: [ai-agent, debugging, mcp-inspector, langsmith, trace]
categories: [ai]
cover: /images/covers/ai-agent-debugging-cover.jpg
description: 'AI Agent 调试实战指南：深入讲解 MCP Inspector 工具层实时诊断、LangSmith Trace 全链路可视化追踪、结构化日志回放三大调试方法。涵盖 MCP Inspector 的 Request/Response JSON 完整示例、LangSmith 与 OpenAI/LangChain 集成代码、生产环境日志回放脚本、常见踩坑排查及方案对比，帮助开发者从黑盒调试转向可观测、可追踪、可复现的工程化 Agent 开发工作流。'
---

## 前言：当 print() 不再够用

你一定经历过这样的场景：用户反馈"AI Agent 给了一个莫名其妙的回答"，你翻遍日志只找到一堆零散的文本输出，无法确定是 LLM 推理出了问题、工具返回了错误数据、还是中间某个环节的参数传递出了差错。传统的断点调试和 print() 在 Agent 开发面前几乎完全失效——因为 Agent 的执行路径是非确定性的，同样的输入可能走出完全不同的推理链路。

本文将从实战角度出发，介绍三套互补的调试工具与方法论：**MCP Inspector** 做工具层实时诊断、**LangSmith Trace** 做全链路可视化追踪、**结构化日志与回放** 做生产环境可复现调试。三者结合，形成从开发到生产的完整可观测性闭环。

---

## 一、MCP Inspector：工具调用层的"X 光机"

MCP（Model Context Protocol）是 LLM 与外部工具交互的标准化协议。MCP Inspector 是 Anthropic 官方提供的调试工具，它能让你在不启动完整 Agent 的情况下，独立验证 MCP Server 的工具定义和调用行为。

### 1.1 快速上手

```bash
# 需要 Node.js 18+，一行命令启动
npx @anthropic-ai/mcp-inspector@latest

# 或指定连接到已运行的 MCP Server（SSE 模式）
npx @anthropic-ai/mcp-inspector@latest --sse http://localhost:8080/sse
```

启动后访问 `http://localhost:5173`，界面分为三个面板：**Server 面板**配置连接方式（支持 stdio / SSE / Streamable HTTP），**Tools 面板**列出所有已注册工具及其 JSON Schema，**History 面板**记录每次调用的完整 Request/Response。

### 1.2 实战场景：Schema 歧义导致参数错误

这是 Agent 开发中最常见的隐蔽 Bug。看这个工具定义：

```json
{
  "name": "query_orders",
  "description": "查询订单列表",
  "inputSchema": {
    "type": "object",
    "properties": {
      "status": { "type": "string", "description": "订单状态" },
      "date_range": { "type": "string", "description": "时间范围" },
      "page": { "type": "integer", "default": 1 }
    },
    "required": ["status"]
  }
}
```

`date_range` 的描述过于模糊——LLM 可能传 `"2026-01-01~2026-06-01"`、`"last_week"`、`"this month"` 等各种格式。在 MCP Inspector 中手动测试不同格式，你能快速发现哪些格式工具能正确处理、哪些会导致空结果或异常。这种在开发阶段的"探测性测试"能避免大量线上问题。

**改进后的 Schema**：

```json
{
  "date_range": {
    "type": "object",
    "properties": {
      "start": { "type": "string", "format": "date", "description": "开始日期，格式 YYYY-MM-DD" },
      "end": { "type": "string", "format": "date", "description": "结束日期，格式 YYYY-MM-DD" }
    },
    "required": ["start", "end"]
  }
}
```

### 1.3 MCP Inspector 工具调用完整示例

在 Inspector 的 Tools 面板中选择工具并填写参数后点击"Call Tool"，你会看到完整的 JSON-RPC 请求和响应。以下是一次典型的 `query_orders` 工具调用：

**Request（MCP Inspector 发送）：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "query_orders",
    "arguments": {
      "status": "pending",
      "date_range": {
        "start": "2026-05-01",
        "end": "2026-06-01"
      },
      "page": 1
    }
  }
}
```

**Response（MCP Server 返回成功）：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "[{\"order_id\": \"ORD-20260501-001\", \"customer\": \"张三\", \"status\": \"pending\", \"total\": 299.00, \"created_at\": \"2026-05-15T10:30:00Z\"}, {\"order_id\": \"ORD-20260518-042\", \"customer\": \"李四\", \"status\": \"pending\", \"total\": 1580.00, \"created_at\": \"2026-05-18T14:22:00Z\"}]"
      }
    ],
    "isError": false
  }
}
```

**Response（参数格式错误时）：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Error: Input validation failed for tool 'query_orders': date_range.start: Invalid date format, expected YYYY-MM-DD"
      }
    ],
    "isError": true
  }
}
```

**Response（工具内部异常时）：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"error\": true, \"message\": \"查询失败: Connection refused\", \"error_type\": \"ConnectionRefusedError\"}"
      }
    ],
    "isError": false
  }
}
```

注意第三个示例：工具返回了友好的错误 JSON 且 `isError` 为 `false`，这意味着从 MCP 协议层看调用是"成功"的——这恰恰是 Agent 开发中容易隐藏问题的地方。如果 Server 端没有正确返回 `isError: true`，Agent 可能会把错误信息当作正常数据来解读，导致后续推理出错。在 MCP Inspector 的 History 面板中逐条检查 `isError` 标记，是发现这类问题的最直接方法。

### 1.4 SSE 连接问题诊断

当 MCP Server 以 SSE 模式部署时，Inspector 的 Network 面板是排查连接问题的利器。你可以看到：`initialize` 握手是否成功、每条 SSE 消息的延迟、连接是否在特定操作后断开。这对于调试"Agent 在某个工具调用后突然无响应"的问题尤其有用——通常是因为 Server 端的某个处理函数抛出了未捕获的异常导致 SSE 流中断。

```python
# Python MCP Server 示例——注意异常处理
from mcp.server import Server
from mcp.server.sse import SseServerTransport
import traceback

app = Server("order-service")
transport = SseServerTransport("/messages")

@app.tool()
async def query_orders(status: str, date_range: dict = None) -> str:
    """查询订单列表"""
    try:
        query = {"status": status}
        if date_range:
            query["created_at"] = {
                "$gte": date_range["start"],
                "$lte": date_range["end"]
            }
        orders = await db.orders.find(query).to_list(100)
        return json.dumps(orders, ensure_ascii=False, default=str)
    except Exception as e:
        # 返回友好的错误 JSON，而不是让异常冒泡导致 SSE 流断开
        return json.dumps({
            "error": True,
            "message": f"查询失败: {str(e)}",
            "error_type": type(e).__name__
        })
```

### 1.5 踩坑案例：MCP Inspector 连接失败的常见原因排查

在实际使用中，MCP Inspector 连接 MCP Server 失败是最常被问到的问题。以下是按出现频率排序的排查清单：

**问题 1：`ECONNREFUSED` —— Server 未启动或端口不匹配**

```
Error: connect ECONNREFUSED 127.0.0.1:8080
```

排查步骤：确认 Server 进程是否在运行（`ps aux | grep mcp`），确认端口号是否与 Inspector 中配置的一致。如果使用 `stdio` 模式，确保 Inspector 中填写的 command 和 args 与本地启动命令完全一致。一个常见的错误是在 Inspector 中用 `npx` 启动但本地用的是 `python -m`。

**问题 2：SSE 连接建立后立即断开**

```
SSE connection opened → closed (within 1s)
```

排查步骤：这通常是 Server 端在 `initialize` 阶段抛出了异常。检查 Server 的日志输出，最常见的原因是：
- 缺少必要的环境变量（如数据库连接字符串）
- 依赖包版本不兼容（特别是 `mcp` Python 包版本与 Inspector 版本的协议兼容性）
- Server 代码中 `@app.tool()` 装饰器的函数签名与 Schema 定义不匹配

**问题 3：`initialize` 成功但 Tools 列表为空**

排查步骤：检查 Server 是否正确注册了工具。在 Python MCP SDK 中，确保 `@app.tool()` 装饰器在 `app.run()` 之前执行（即装饰器不在条件分支中）。在 TypeScript SDK 中，确保 `server.setRequestHandler(ListToolsRequestSchema, ...)` 的返回值不为空数组。

**问题 4：工具调用超时**

```
Tool call timeout after 30000ms
```

排查步骤：Inspector 默认有 30 秒超时。如果工具涉及数据库查询或外部 API 调用，可能确实需要更长时间。解决方法：在 Inspector 的 Settings 中调大 timeout，或优化 Server 端的查询性能。如果超时后 SSE 连接断开且无法重新连接，说明 Server 端进入了不可恢复的状态——需要重启 Server 并在代码中增加超时处理和连接恢复逻辑。

---

## 二、LangSmith Trace：从入口到出口的全链路透视

MCP Inspector 只能看到工具层的输入输出，而 LangSmith 覆盖了从用户输入到最终回答的完整执行链路。它的核心概念是 **Trace**（一次完整执行）和 **Span**（链路中的单个步骤），形成一棵可展开的执行树。

### 2.1 基础集成

```python
import os
from langsmith import traceable, Client
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool

# 启用 LangSmith 追踪——只需设置环境变量
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "ls__your-api-key"
os.environ["LANGCHAIN_PROJECT"] = "customer-service-agent"

# 自定义业务函数也自动追踪
@traceable(name="lookup_customer", run_type="tool", tags=["crm"])
async def lookup_customer(customer_id: str) -> dict:
    """从 CRM 系统查询客户信息"""
    customer = await crm_client.get(customer_id)
    return {
        "name": customer["name"],
        "tier": customer["vip_level"],
        "recent_tickets": await get_recent_tickets(customer_id, limit=3)
    }

@tool
async def resolve_ticket(ticket_id: str, resolution: str) -> str:
    """处理客户工单"""
    result = await ticket_service.resolve(ticket_id, resolution)
    return f"工单 {ticket_id} 已处理: {result['status']}"

# Agent 构建
llm = ChatOpenAI(model="gpt-4o", temperature=0)
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是客服助手，使用工具解决客户问题。回答要简洁专业。"),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}")
])

agent = create_tool_calling_agent(llm, [resolve_ticket], prompt)
executor = AgentExecutor(agent=agent, tools=[resolve_ticket], max_iterations=5)

# 执行时注入 correlation_id——这是串联前后端日志的关键
result = await executor.ainvoke(
    {"input": "帮我处理工单 TK-20260601-042，客户反馈收到的商品有质量问题"},
    config={
        "metadata": {
            "correlation_id": "req-7f3a9b2c",
            "session_id": "sess-user-12345",
            "source": "webchat"
        }
    }
)
```

### 2.2 Trace 树的阅读方法

一次典型的 Agent 执行在 LangSmith 中呈现如下：

```
Trace: req-7f3a9b2c (2.3s)
└── AgentExecutor (2.3s)
    ├── LLM: gpt-4o → 决定调用 resolve_ticket (0.8s)
    │   ├── prompt_tokens: 1,520
    │   ├── completion_tokens: 38
    │   └── tool_calls: resolve_ticket(ticket_id="TK-20260601-042", resolution="...")
    ├── Tool: resolve_ticket → 成功 (0.4s)
    │   └── output: {"status": "已解决", "assignee": "张明"}
    └── LLM: gpt-4o → 生成最终回答 (0.6s)
        ├── prompt_tokens: 1,890
        ├── completion_tokens: 156
        └── output: "工单 TK-20260601-042 已成功处理..."
```

**调试时的阅读顺序**：先看最终输出是否符合预期，如果不符合，从上往下逐个 Span 检查。重点关注：第一个 LLM Span 是否选择了正确的工具和参数；Tool Span 是否返回了预期数据；第二个 LLM Span 是否正确解读了工具返回的结果。

### 2.3 生产环境的分级采样

```python
from langsmith import Client

client = Client()

# 在生产环境中，对 Trace 进行分级采样以控制成本
def should_trace_full(request_metadata: dict) -> bool:
    """决定是否完整记录此请求的 Trace"""
    # 错误请求：100% 记录
    if request_metadata.get("has_error"):
        return True
    # 慢请求（>10s）：100% 记录
    if request_metadata.get("duration_ms", 0) > 10_000:
        return True
    # VIP 用户的请求：100% 记录
    if request_metadata.get("customer_tier") == "vip":
        return True
    # 其他请求：10% 采样
    import random
    return random.random() < 0.1
```

---

## 三、结构化日志与日志回放：让生产问题可复现

LangSmith 帮你"看到"问题，但要在本地环境"复现"问题，还需要结构化日志和回放机制。

### 3.1 结构化日志设计

核心原则：**每条日志必须是可机器解析的 JSON**，并包含 `correlation_id` 作为全链路关联键。

```python
import json
import logging
import uuid
from datetime import datetime, timezone
from contextvars import ContextVar

# 异步安全的 correlation_id 传播
_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="unknown")

class AgentLogger:
    def __init__(self, name: str):
        self.logger = logging.getLogger(name)
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        self.logger.addHandler(handler)
        self.logger.setLevel(logging.INFO)

    def _emit(self, level: str, event: str, **data):
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "event": event,
            "cid": _correlation_id.get(),
            **data
        }
        self.logger.info(json.dumps(record, ensure_ascii=False, default=str))

    def llm_request(self, model: str, prompt_preview: str, tokens: dict, latency_ms: float):
        self._emit("INFO", "llm_request",
            model=model,
            prompt_preview=prompt_preview[:300],
            tokens=tokens,
            latency_ms=latency_ms
        )

    def tool_call(self, name: str, args: dict, result: str, latency_ms: float, success: bool):
        self._emit("INFO", "tool_call",
            tool=name,
            args=args,
            result_preview=str(result)[:500] if success else None,
            error=str(result)[:500] if not success else None,
            latency_ms=latency_ms,
            ok=success
        )

    def agent_decision(self, step: int, action: str, reasoning: str):
        self._emit("INFO", "agent_decision",
            step=step,
            action=action,
            reasoning=reasoning[:200]
        )
```

### 3.2 Laravel 后端的 Correlation ID 注入

在全栈应用中，correlation_id 需要从前端到 Python Agent 再到 Laravel 后端贯穿：

```php
<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CorrelationIdMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        // 从请求头获取或生成新的 correlation_id
        $cid = $request->header('X-Correlation-Id', Str::uuid()->toString());

        // 注入到 Laravel 日志上下文——后续所有 Log::info() 自动携带
        tap($next($request), function ($response) use ($cid) {
            $response->headers->set('X-Correlation-Id', $cid);
        });

        // 通过 Log::share 在整个请求生命周期共享上下文
        \Log::shareContext([
            'correlation_id' => $cid,
            'request_id' => Str::uuid()->toString(),
        ]);

        return $next($request);
    }
}
```

```php
<?php
// Laravel 服务端调用 Agent API 时透传 correlation_id
namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AgentService
{
    public function ask(string $input, string $sessionId): string
    {
        $cid = app('correlation_id') ?? request()->header('X-Correlation-Id');

        Log::info('agent_request_start', [
            'input' => $input,
            'session_id' => $sessionId,
        ]);

        $response = Http::timeout(30)
            ->withHeaders(['X-Correlation-Id' => $cid])
            ->post(config('agent.endpoint'), [
                'input' => $input,
                'session_id' => $sessionId,
            ]);

        Log::info('agent_request_end', [
            'status' => $response->status(),
            'latency_ms' => $response->transferStats->getHandlerStats()['total_time'] * 1000,
        ]);

        return $response->json('output');
    }
}
```

### 3.3 日志回放：用缓存消除不确定性

回放的核心思路是：从生产日志中提取某个请求的完整上下文（包括所有工具返回结果），然后在开发环境中用这些缓存数据替代真实的外部调用，使 Agent 执行变成"半确定性"的——LLM 的输出仍然有随机性，但工具行为完全可复现。

```python
import json
from dataclasses import dataclass, field
from typing import Any

@dataclass
class Replayer:
    """从日志文件中提取并回放 Agent 请求"""
    correlation_id: str
    user_input: str = ""
    tool_cache: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def extract_from_logs(cls, log_file: str, cid: str) -> "Replayer":
        """从结构化日志文件中提取指定请求的所有工具返回结果"""
        replayer = cls(correlation_id=cid)

        with open(log_file) as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if entry.get("cid") != cid:
                    continue

                event = entry.get("event")
                if event == "agent_request_start":
                    replayer.user_input = entry.get("user_input", "")
                elif event == "tool_call" and entry.get("ok"):
                    # 按工具名缓存返回结果（简化版，实际可按调用序号区分）
                    tool_name = entry["tool"]
                    replayer.tool_cache[tool_name] = entry.get("result_preview")

        return replayer

    async def run_replay(self, agent_executor, tools: list) -> dict:
        """用缓存数据替代真实工具调用来复现执行"""
        cached_tools = []
        for tool in tools:
            original_fn = tool.coroutine or tool.func
            cached_fn = self._make_cached_fn(tool.name, original_fn)
            cached_tools.append(tool.copy(update={"coroutine": cached_fn}))

        return await agent_executor.ainvoke({"input": self.user_input})

    def _make_cached_fn(self, tool_name: str, original_fn):
        cache = self.tool_cache
        async def cached(**kwargs):
            if tool_name in cache:
                print(f"[REPLAY] 命中缓存: {tool_name}")
                return cache[tool_name]
            print(f"[REPLAY] 未命中缓存，调用真实接口: {tool_name}")
            return await original_fn(**kwargs)
        return cached


# 使用方式——从日志中提取问题请求并本地复现
async def debug_problematic_request(log_path: str, correlation_id: str):
    replayer = Replayer.extract_from_logs(log_path, correlation_id)
    print(f"提取请求: {replayer.user_input}")
    print(f"缓存的工具结果: {list(replayer.tool_cache.keys())}")

    result = await replayer.run_replay(executor, tools)
    print(f"回放结果: {result['output']}")
    return result
```

回放机制的价值不仅在于复现问题，更在于**回归测试**。当你修改了 Prompt 或工具定义后，可以用历史的回放记录验证是否引入了新的问题——这比手动编写测试用例高效得多。

---

## 四、常见故障的系统化排查

| 故障现象 | 排查工具 | 排查思路 |
|---------|---------|---------|
| Agent 答非所问 | LangSmith Trace | 检查第一个 LLM Span 是否选择了正确的工具 |
| 工具调用报错 | MCP Inspector | 用相同的参数在 Inspector 中手动调用，确认工具是否正常 |
| Agent "编造"数据 | LangSmith Trace | 对比 Tool Span 的实际输出和 LLM 的最终回答，识别幻觉 |
| 多轮后"失忆" | LangSmith + 日志 | 检查 token_usage 是否接近上下文窗口上限 |
| 无限循环调用 | LangSmith Trace | 观察是否有多个相同的 Tool Span 重复出现 |
| 生产偶发问题 | 日志回放 | 提取问题请求的 correlation_id，本地回放复现 |

---

## 五、方案对比：如何选择调试工具

| 维度 | MCP Inspector | LangSmith Trace | 结构化日志 + 回放 |
|------|--------------|----------------|-------------------|
| **定位** | 工具层单点调试 | 全链路可视化追踪 | 生产环境问题复现 |
| **适用阶段** | 开发 & 集成测试 | 测试 & 生产监控 | 生产排障 & 回归测试 |
| **覆盖范围** | 单个 MCP Server 的工具定义和调用 | 从用户输入到最终回答的完整推理链路 | 全栈（前端 → Agent → 后端） |
| **数据粒度** | JSON-RPC 级别（Request/Response） | Span 级别（LLM/Tool/Chain） | 自定义事件级别 |
| **实时性** | ✅ 实时交互 | ✅ 实时 + 历史回看 | ❌ 事后分析 |
| **部署依赖** | 无需部署，本地启动 | 需要 LangSmith SaaS 或自托管 | 需要日志收集基础设施 |
| **成本** | 免费 | 免费额度有限，生产用量付费 | 取决于日志存储方案 |
| **学习曲线** | 低（Web UI，即开即用） | 中（需理解 Trace/Span 概念） | 高（需自行设计日志格式和回放机制） |
| **最佳搭档** | 开发新工具时配合 Inspector 验证 | 配合 Prompt 迭代做 A/B 对比 | 配合 LangSmith 定位问题后本地复现 |
| **局限性** | 无法看到 Agent 的推理过程 | 无法直接修改工具行为做实验 | 需要自行实现缓存和回放逻辑 |

**选择建议**：

- **刚接入新工具 / 排查工具定义问题** → MCP Inspector，它是最快的验证手段
- **优化 Prompt / 调试多步推理 / 监控线上质量** → LangSmith Trace，它提供最完整的推理透视
- **复现线上偶发问题 / 做回归测试** → 结构化日志 + 回放，它是唯一能在本地精确复现生产行为的方案
- **三者配合使用**：用 LangSmith 发现问题 → 用 MCP Inspector 验证工具层 → 用日志回放复现并修复

---

## 六、总结：三层调试体系

```
┌─────────────────────────────────────────────────────┐
│              生产环境监控 (LangSmith + 日志)           │
│  ┌─────────────────────────────────────────────────┐│
│  │         全链路追踪 (LangSmith Trace)              ││
│  │  ┌─────────────────────────────────────────────┐││
│  │  │    工具层调试 (MCP Inspector)                 │││
│  │  └─────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

**MCP Inspector** 解决的是"工具本身是否正确"的问题——它是开发阶段的必备工具，用于验证 Schema 定义、排查连接问题、对比参数差异。**LangSmith Trace** 解决的是"推理链路是否合理"的问题——它让你能够从一个异常回答回溯到完整的决策过程。**结构化日志与回放** 解决的是"生产问题能否复现"的问题——它通过 correlation_id 串联全链路，通过回放机制消除外部依赖的不确定性。

三个层次的调试能力缺一不可。MCP Inspector 帮你在开发阶段把好工具质量关，LangSmith Trace 帮你在测试和生产阶段持续监控 Agent 行为，日志回放帮你从生产问题中提取复现条件并修复验证。将这三者融入你的 Agent 开发工作流，你就不再是面对一个"不可知的黑盒"，而是一个"可观测、可追踪、可复现"的工程化系统。

---

## 相关阅读

- [AI Agent Observability 实战：LangSmith/LangFuse/Helicone 全链路追踪与评估](/categories/AI/2026-06-02-ai-agent-observability-langsmith-langfuse-tracing-evaluation/)
- [MCP Model Context Protocol：AI Agent 工具标准化协议实战](/categories/AI/2026-06-01-mcp-model-context-protocol-ai-agent-tool-standardization/)
- [AI Agent Function Calling 标准化与错误处理实战](/categories/AI/2026-06-02-ai-agent-function-calling-standardization-error-handling/)
