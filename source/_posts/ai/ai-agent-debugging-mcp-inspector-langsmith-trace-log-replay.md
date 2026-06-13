---

title: AI Agent Debugging 实战：MCP Inspector/LangSmith Trace/日志回放——从黑盒到可调试的 Agent 开发工作流
keywords: [AI Agent Debugging, MCP Inspector, LangSmith Trace, Agent, 日志回放, 从黑盒到可调试的, 开发工作流]
date: 2026-06-05 09:00:00
description: AI Agent 开发中，不确定性输出、多轮工具调用依赖链和黑盒推理过程让传统调试手段彻底失效。本文通过 MCP Inspector 实时检查工具调用参数与返回值，LangSmith Trace 全链路可视化追踪 Agent 推理决策树，以及结构化日志与日志回放机制实现生产问题的可复现调试，帮助你从黑盒猜谜走向可观测的 Agent 开发工作流，系统性提升调试效率。
tags:
- AI Agent
- Debugging
- MCP Inspector
- LangSmith
- 日志回放
- 可观测性
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



## 为什么 Agent 难调试？——黑盒困境

如果你曾经开发过传统的 Web 应用，你一定对那套成熟的调试工具链感到自信：断点调试、日志聚合、APM 监控、分布式链路追踪。代码执行路径是确定性的——同一个请求，同样的输入，总是走同样的分支，你可以精确地复现任何 Bug。

然而，当你开始开发 AI Agent 时，这套经验几乎完全失效。Agent 的调试难度远超传统应用，原因在于以下几个核心挑战。

**不确定性是常态，不是异常。** LLM 的输出本质上是概率性的。即使你把 temperature 设置为 0，不同的模型版本、不同的 API 后端、甚至不同的请求时间，对同一个 prompt 都可能返回略有差异的结果。你无法像对待单元测试那样断言"输入 X 必定输出 Y"。这意味着很多 Bug 是间歇性的，只在特定条件下触发，而你甚至无法稳定复现。

**多轮工具调用形成复杂的依赖链。** 一个典型的 Agent 可能在单次任务中调用三到十个甚至更多的工具。每次工具调用都涉及 JSON 序列化和反序列化、外部 API 交互、错误处理和结果解析。链路上任何一环出错，最终表现可能是 Agent 给出了一个"答非所问"的回答，而你完全不知道问题出在哪一步。更糟糕的是，LLM 有时候会"将错就错"——收到一个错误的工具返回结果后，它不会报错，而是基于这个错误结果继续推理，最终给出一个看似合理但完全错误的答案。

**上下文窗口的隐式依赖极难追踪。** Agent 的行为高度依赖于对话历史。第五轮的回答可能因为第二轮的工具返回结果中某个字段拼写错误而完全偏离预期。这种跨轮次的因果关系，通过简单的日志根本无法发现。你需要看到完整的上下文传递链，才能理解 Agent 为什么做出了某个特定的决策。

**LLM 的推理过程是一个黑盒。** 我们无法直接观察 LLM 的"思考过程"。它为什么选择调用工具 A 而不是工具 B？它为什么在应该调用工具的时候选择了直接回答用户？它为什么忽略了一个明明很关键的工具返回字段？这些决策对开发者来说完全是不透明的。我们能观察到的只有输入和输出，中间的推理过程被封装在一个巨大的神经网络内部。

**反馈延迟和链路断裂。** 在传统应用中，一个 Bug 通常会在用户操作后立即表现为错误页面或异常日志。但 Agent 的 Bug 通常表现为"回答质量下降"——这是一个模糊的、延迟的、难以量化的问题。用户可能在使用了 Agent 十次之后才意识到"它最近好像不太对"，而此时你已经很难回溯到具体是哪次对话出了问题。

面对这些挑战，单纯依赖 `print` 调试或者传统的日志系统是远远不够的。我们需要一套系统化的、分层的调试工具链。本文将介绍三个核心工具和方法论：**MCP Inspector**（聚焦工具调用层的实时调试）、**LangSmith Trace**（全链路可视化追踪）、**结构化日志与日志回放**（可复现的生产调试工作流），帮助你从"黑盒猜谜"走向"可观测的 Agent 开发工作流"。

---

## MCP Inspector：工具调用的实时检查器

MCP（Model Context Protocol）是 Anthropic 推出的开放协议，定义了 LLM 与外部工具之间的通信标准。MCP Inspector 是官方提供的调试工具，可以实时检查 MCP Server 的工具定义、参数 Schema 和调用结果。它相当于工具层的"Postman"——但在 Agent 场景下比 Postman 更有针对性，因为它理解 MCP 协议的完整语义。

### 安装与启动

```bash
# 安装 MCP Inspector（需要 Node.js 18+）
npx @anthropic-ai/mcp-inspector

# 或者全局安装
npm install -g @anthropic-ai/mcp-inspector
mcp-inspector
```

启动后默认访问 `http://localhost:5173`，你会看到一个 Web 界面，包含三个核心面板：Server 连接面板用于配置 MCP Server 的连接方式，支持 stdio、SSE 和 Streamable HTTP 三种模式；Tools 面板列出所有已注册工具及其参数 Schema；Request/Response 面板实时展示每次工具调用的原始 JSON 数据。

### 核心调试场景

**场景一：验证工具 Schema 定义是否正确。** Agent 工具调用失败最常见的原因之一是参数格式不匹配。LLM 根据工具的 JSON Schema 来构造调用参数，如果 Schema 定义有歧义或错误，LLM 就会生成不符合预期的参数。MCP Inspector 可以直接展示工具期望的完整 JSON Schema，你可以在 Inspector 中手动填写参数并执行调用，验证工具是否正常工作。

```json
{
  "name": "search_database",
  "description": "搜索产品数据库",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "搜索关键词" },
      "limit": { "type": "integer", "default": 10, "minimum": 1, "maximum": 100 }
    },
    "required": ["query"]
  }
}
```

比如上面这个 Schema 定义看起来没有问题，但实际运行中你可能会发现 LLM 经常把 `limit` 传成字符串 `"10"` 而不是整数 `10`。在 Inspector 中手动测试可以提前发现这类问题。

**场景二：排查 SSE 连接和通信问题。** 当 MCP Server 通过 SSE 方式运行时，连接问题是常见故障来源。Inspector 的 Network 面板会显示完整的握手过程和每条 SSE 消息的收发情况。你可以看到 `initialize` 握手是否成功、`tools/list` 是否返回了预期的工具列表、每条消息的延迟是多少。这些信息在调试网络相关的工具调用超时问题时极为关键。

```python
# 一个典型的 MCP Server 启动脚本
from mcp.server import Server
from mcp.server.sse import SseServerTransport

app = Server("my-tools")
transport = SseServerTransport("/messages")

@app.tool()
async def search_database(query: str, limit: int = 10) -> str:
    """搜索产品数据库"""
    results = await db.search(query, limit=limit)
    return json.dumps(results, ensure_ascii=False)
```

**场景三：对比 LLM 发送的参数与工具实际收到的参数。** 这是 MCP Inspector 最有价值的调试场景。当 Agent 调用工具失败时，你需要确定问题出在哪一侧：是 LLM 构造了错误的参数（LLM 侧问题），还是工具接收到正确参数后处理逻辑有 Bug（工具侧问题）？在 Inspector 的 History 面板中，每次调用都有完整的请求记录。你可以将这个记录与 Agent 在 LangSmith 中的 Trace 对照，精确定位问题归属。

---

## LangSmith Trace：全链路可视化追踪

LangSmith 是 LangChain 团队推出的可观测性平台，提供了 Agent 执行的全链路追踪能力。如果说 MCP Inspector 聚焦于工具调用这一层，那么 LangSmith 则覆盖了从用户输入到最终回答的完整链路。它的核心概念是 **Trace**（一次完整的 Agent 执行链路）和 **Span**（链路中的单个操作步骤）。

### Trace 的层级结构

一个典型的 Agent Trace 呈现为树状结构，每个节点都是一个 Span。理解这个结构是高效调试的前提：

```
Trace: "用户问天气"
├── Chain: AgentExecutor
│   ├── LLM: 决定调用哪个工具
│   │   ├── 输入: system_prompt + user_message
│   │   ├── Token 用量: prompt=1250, completion=45
│   │   └── 输出: tool_call: get_weather(city="北京")
│   ├── Tool: get_weather
│   │   ├── 输入: {"city": "北京"}
│   │   ├── 耗时: 230ms
│   │   └── 输出: {"temp": 28, "condition": "晴", "humidity": 45}
│   ├── LLM: 基于工具结果生成最终回答
│   │   ├── 输入: system_prompt + user_message + tool_result
│   │   ├── Token 用量: prompt=1380, completion=62
│   │   └── 输出: "北京今天天气晴朗，气温28°C。"
│   └── 最终输出: "北京今天天气晴朗，气温28°C。"
```

从这个树状结构中，你可以清晰地看到 Agent 的完整推理链：先由第一个 LLM Span 决定调用哪个工具，然后工具 Span 执行实际操作，最后第二个 LLM Span 将工具结果转化为自然语言回答。

### 关键 Span 字段解读

每个 Span 都包含多个对调试至关重要的字段。`inputs` 和 `outputs` 记录了该步骤的完整输入输出数据；`latency` 记录执行耗时，帮助你发现性能瓶颈；`token_usage` 记录 prompt 和 completion 的 token 数量，帮你控制成本和避免上下文溢出；`metadata` 允许你附加自定义标签如 `run_id`、`correlation_id`、模型名称等；`error` 字段在出错时包含完整的错误堆栈；`tags` 则是可搜索的标签，方便你在大量 Trace 中快速筛选。

### 在 Python Agent 代码中集成 LangSmith

```python
import os
from langsmith import traceable
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

# 设置 LangSmith 环境变量
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "your-api-key"
os.environ["LANGCHAIN_PROJECT"] = "my-agent-debug"

# 使用 @traceable 装饰器追踪自定义函数
@traceable(
    name="fetch_user_context",
    run_type="tool",
    tags=["retrieval", "context"]
)
async def fetch_user_context(user_id: str) -> dict:
    """获取用户上下文信息，自动在 LangSmith 中创建 Span"""
    user = await db.users.find_one({"user_id": user_id})
    return {
        "name": user["name"],
        "preferences": user.get("preferences", {}),
        "history_summary": await summarize_history(user_id)
    }

# Agent 本身会被 LangChain 自动追踪
llm = ChatOpenAI(model="gpt-4o", temperature=0)
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个智能助手，使用工具回答用户问题。"),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}")
])
agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# 执行并自动追踪，correlation_id 关联到日志系统
result = await executor.ainvoke(
    {"input": "帮我查一下最近的订单状态"},
    config={"metadata": {"correlation_id": "req-abc-123"}}
)
```

### 从异常回答溯源的调试 Workflow

当你收到"Agent 给了错误回答"的反馈时，标准的 LangSmith 调试流程如下。首先，在 LangSmith Dashboard 中通过 `correlation_id` 或时间范围找到对应的 Trace。然后展开 Trace 树，逐个 Span 检查：第一个 LLM Span 是否正确理解了用户意图并选择了正确的工具；Tool Span 的调用参数是否正确、返回结果是否符合预期；第二个 LLM Span 是否正确使用了工具返回的结果来生成回答。找到问题 Span 后，仔细检查其 inputs 和 outputs，通常就能定位根因。如果是 Prompt 问题，LangSmith 支持直接在界面上编辑 Prompt 并重新运行，快速验证修复效果。

LangSmith 还支持在线评估功能。你可以为每条 Trace 添加标注（正确、错误、部分正确），逐步建立评测数据集，持续跟踪 Agent 的质量变化趋势。当质量出现下降时，你可以通过对比新旧 Trace 快速定位引入问题的变更。

---

## 结构化日志与日志回放：可复现的调试工作流

MCP Inspector 解决了"看"的问题，LangSmith 解决了"追踪"的问题，但在生产环境中还有一个核心需求：**复现**。当用户报告一个问题时，你能否在开发环境中让 Agent 重新走一遍完全相同的路径？这就需要结构化日志和日志回放机制。

### 结构化日志设计

首先要从传统的文本日志升级为结构化日志。结构化日志意味着每条日志都是一个 JSON 对象，包含标准化的字段，可以被机器解析和查询：

```python
import logging
import json
import uuid
from datetime import datetime, timezone
from contextvars import ContextVar

# 使用 ContextVar 在异步环境中传递 correlation_id
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")

class StructuredLogger:
    """Agent 专用的结构化日志记录器"""

    def __init__(self, name: str):
        self.logger = logging.getLogger(name)
        self._setup_handler()

    def _setup_handler(self):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        self.logger.addHandler(handler)
        self.logger.setLevel(logging.INFO)

    def _log(self, level: str, event: str, **kwargs):
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "logger": self.logger.name,
            "event": event,
            "correlation_id": correlation_id_var.get(""),
            **kwargs
        }
        self.logger.log(
            getattr(logging, level),
            json.dumps(record, ensure_ascii=False, default=str)
        )

    def info(self, event: str, **kwargs):
        self._log("INFO", event, **kwargs)

    def error(self, event: str, **kwargs):
        self._log("ERROR", event, **kwargs)

    def tool_call(self, tool_name: str, arguments: dict, result: any,
                  latency_ms: float, success: bool):
        """专门记录工具调用的结构化日志，包含完整的调用上下文"""
        self._log("INFO", "tool_call",
            tool_name=tool_name,
            arguments=arguments,
            result=result if success else None,
            error=result if not success else None,
            latency_ms=latency_ms,
            success=success
        )

    def llm_call(self, model: str, messages: list, response: str,
                 tokens_used: dict, latency_ms: float):
        """专门记录 LLM 调用的结构化日志"""
        self._log("INFO", "llm_call",
            model=model,
            message_count=len(messages),
            response_preview=response[:500],
            tokens_used=tokens_used,
            latency_ms=latency_ms
        )
```

### Correlation ID 贯穿全链路

correlation_id 是调试的生命线。它将一次用户请求在所有系统组件中的日志串联起来。在 Python Agent 侧使用 ContextVar 管理，在 Laravel 后端侧通过中间件注入：

```python
# Agent 侧：请求入口注入 correlation_id
async def handle_agent_request(user_input: str, session_id: str) -> str:
    """处理 Agent 请求，注入 correlation_id 到整个执行链路"""
    cid = f"{session_id}-{uuid.uuid4().hex[:8]}"
    correlation_id_var.set(cid)

    logger = StructuredLogger("agent")
    logger.info("agent_request_start", user_input=user_input, session_id=session_id)

    try:
        result = await agent_executor.ainvoke(
            {"input": user_input},
            config={
                "metadata": {
                    "correlation_id": cid,
                    "session_id": session_id
                }
            }
        )
        logger.info("agent_request_end", output=result["output"])
        return result["output"]
    except Exception as e:
        logger.error("agent_request_failed",
            error_type=type(e).__name__,
            error_msg=str(e)
        )
        raise
```

```php
// Laravel 后端中间件：确保 correlation_id 从前端到后端贯穿
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Ramsey\Uuid\Uuid;

class AgentCorrelationId
{
    public function handle(Request $request, Closure $next)
    {
        $correlationId = $request->header('X-Correlation-Id')
            ?: Uuid::uuid4()->toString();

        // 注入到请求上下文，后续日志记录都使用这个 ID
        $request->merge(['_correlation_id' => $correlationId]);
        // 传播到下游服务调用
        config(['agent.correlation_id' => $correlationId]);

        $response = $next($request);
        $response->headers->set('X-Correlation-Id', $correlationId);

        return $response;
    }
}
```

### 日志回放机制实现

当生产环境出问题时，我们需要能够从日志中提取问题请求的完整上下文，并在开发环境中"重放"这个请求。关键是将真实的工具返回结果缓存下来，回放时用缓存替代真实调用，从而消除外部依赖的不确定性：

```python
import json
from dataclasses import dataclass, field
from typing import Any

@dataclass
class ReplayRecord:
    """一条可回放的请求记录，包含所有外部依赖的预录结果"""
    correlation_id: str
    user_input: str
    session_id: str
    tool_responses: dict[str, Any] = field(default_factory=dict)
    timestamp: str = ""

    @classmethod
    def from_logs(cls, log_path: str, correlation_id: str) -> "ReplayRecord":
        """从结构化日志文件中提取指定请求的回放记录"""
        tool_responses = {}
        user_input = ""
        session_id = ""

        with open(log_path) as f:
            for line in f:
                try:
                    record = json.loads(line.strip())
                except json.JSONDecodeError:
                    continue
                if record.get("correlation_id") != correlation_id:
                    continue

                event = record.get("event")
                if event == "agent_request_start":
                    user_input = record["user_input"]
                    session_id = record.get("session_id", "")
                elif event == "tool_call" and record.get("success"):
                    tool_responses[record["tool_name"]] = record["result"]

        return cls(
            correlation_id=correlation_id,
            user_input=user_input,
            session_id=session_id,
            tool_responses=tool_responses
        )

class ReplayToolWrapper:
    """回放模式下的工具包装器，用预录数据替代真实调用"""
    def __init__(self, original_tool, recorded_results: dict):
        self.original_tool = original_tool
        self.recorded_results = recorded_results

    async def __call__(self, **kwargs):
        tool_name = self.original_tool.name
        if tool_name in self.recorded_results:
            result = self.recorded_results[tool_name]
            return result
        # 如果没有预录数据，回退到真实调用
        return await self.original_tool(**kwargs)

async def replay_debug(replay_record: ReplayRecord):
    """用预录数据复现 Agent 执行，确保可复现性"""
    wrapped_tools = [
        ReplayToolWrapper(tool, replay_record.tool_responses)
        for tool in original_tools
    ]
    executor = AgentExecutor(agent=agent, tools=wrapped_tools)
    result = await executor.ainvoke({"input": replay_record.user_input})
    return result
```

回放的核心价值在于：它将 Agent 执行中所有的非确定性因素（LLM 输出除外）都替换成了确定性的缓存数据。这样你可以在开发环境中反复执行同一个请求，专注于调试 LLM 的决策逻辑，而不被外部服务的波动所干扰。更重要的是，回放记录可以作为回归测试的输入——当你修改了 Prompt 或者调整了工具定义后，可以用历史的回放记录验证修改是否引入了新的问题。这种"基于真实生产数据的回归测试"比人工编造的测试用例更有实际价值。

---

## 常见 Agent 故障排查速查表

### 工具调用失败

**症状表现**：Agent 回答"抱歉，我无法完成这个操作"或给出一个明显偏离预期的答案，但没有具体的错误信息。

**系统化排查步骤**：第一步，在 LangSmith Trace 中找到对应的 Tool Span，检查其 `error` 字段是否包含异常信息。第二步，在 MCP Inspector 中手动使用相同的参数调用该工具，验证工具本身是否正常工作。第三步，检查工具返回值是否为有效的 JSON 格式——LLM 无法正确解析包含 HTML 错误页面或堆栈信息的非结构化返回值。

**常见根因与修复**：LLM 传了错误的参数类型（比如把字符串传给了期望整数的字段），需要在工具 Schema 中明确标注类型和格式要求。工具返回了非 JSON 格式的错误信息，需要在工具内部做异常捕获并返回统一的错误 JSON。API Key 过期或权限不足导致调用失败，需要在工具层添加友好的错误提示而非直接抛出原始异常。工具超时未响应，需要检查超时配置并考虑添加重试机制。

### LLM 幻觉：编造工具返回结果

**症状表现**：Agent 引用了一个工具从未返回过的数据，或者给出了一个看似详细但完全虚构的回答。

**排查方法**：在 LangSmith Trace 中逐个对比 Tool Span 的实际输出和后续 LLM Span 的输入。如果 LLM 在回答中提到了工具未返回的信息，那就是典型的幻觉问题。

**修复方案**：在系统 Prompt 中明确约束 LLM 的行为边界：

```python
system_prompt = """你是数据查询助手。严格遵守以下规则：
1. 只能引用工具实际返回的数据，绝对不要编造或推测任何数据
2. 如果工具调用失败或返回为空，如实告知用户"未能获取到相关数据"
3. 引用数据时必须标注数据来源和查询时间
4. 如果工具返回的数据不够完整，明确告诉用户哪些信息缺失，而不是自行补充
5. 不确定的信息用"根据查询结果..."等措辞标注"""
```

### 上下文溢出

**症状表现**：Agent 在多轮对话后突然"失忆"，忘记了前面讨论的内容；或者直接返回 API 错误提示上下文长度超限。

**排查方法**：在 LangSmith Trace 中检查最近几个 LLM Span 的 `token_usage` 字段，看 prompt_tokens 是否接近模型的上下文窗口上限。重点检查是否有工具返回了过长的文本（比如完整的网页内容或大量数据库记录）。

**修复方案**：对工具返回结果做长度限制和智能截断，使用摘要模型对长文本做压缩，或者实现滑动窗口机制自动丢弃早期的对话历史。

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

@traceable(name="search_web")
async def search_web(query: str) -> str:
    results = await web_search(query)
    full_text = "\n".join(results)
    # 限制返回长度，防止撑爆上下文窗口
    if len(full_text) > 4000:
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=4000, chunk_overlap=200
        )
        chunks = splitter.split_text(full_text)
        return chunks[0] + "\n\n[结果已截断，共 {} 字符，仅显示前 4000 字符]".format(len(full_text))
    return full_text
```

### 循环推理

**症状表现**：Agent 反复调用同一个工具，陷入无限循环，最终因为达到最大迭代次数而强制终止。

**排查方法**：在 LangSmith Trace 中观察 Trace 树，如果看到多个完全相同的 Tool Span 重复出现，就是循环推理。检查 Agent 是否缺少终止条件。

**修复方案**：

```python
# 设置硬性上限
executor = AgentExecutor(
    agent=agent, tools=tools,
    max_iterations=8,
    max_execution_time=60,
    early_stopping_method="generate",
    handle_parsing_errors=True
)

# 在工具层面添加去重逻辑
class DedupToolWrapper:
    def __init__(self, tool):
        self.tool = tool
        self.recent_calls = []

    async def __call__(self, **kwargs):
        call_signature = json.dumps(kwargs, sort_keys=True)
        recent_signatures = [c for c in self.recent_calls[-3:]]
        if call_signature in recent_signatures:
            return "提示：你已经用完全相同的参数调用过这个工具，请基于已有结果直接回答用户。"
        self.recent_calls.append(call_signature)
        return await self.tool(**kwargs)
```

---

## 构建调试友好的 Agent 架构

### Checkpoint 与状态快照

在 LangGraph 框架中，每个节点执行后都可以自动保存 checkpoint。这意味着你可以随时从任意 checkpoint 恢复执行，而不需要从头开始：

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from typing import TypedDict

class AgentState(TypedDict):
    messages: list
    tool_results: list
    current_step: str
    iteration_count: int

checkpointer = MemorySaver()

graph = StateGraph(AgentState)
graph.add_node("think", think_node)
graph.add_node("act", act_node)
graph.add_node("observe", observe_node)
graph.add_edge("think", "act")
graph.add_edge("act", "observe")
graph.add_conditional_edges("observe", should_continue, {
    "continue": "think",
    "finish": END
})
graph.set_entry_point("think")

compiled = graph.compile(checkpointer=checkpointer)

# 执行后可以通过 thread_id 回溯到任意中间状态
config = {"configurable": {"thread_id": "debug-session-001"}}
result = await compiled.ainvoke(initial_state, config=config)

# 获取完整的历史状态序列，用于调试分析
history = list(compiled.get_state_history(config))
for state in history:
    print(f"Step: {state.values.get('current_step')}, "
          f"Messages: {len(state.values.get('messages', []))}")
```

Checkpoint 的调试价值不仅在于可以回溯，还在于可以修改中间状态后重新执行。比如你发现 Agent 在第三步选择了错误的工具，可以修改 checkpoint 中的工具选择结果，然后从该点继续执行，验证"如果当时选对了工具，最终结果是否正确"。这种"假设分析"能力在调试复杂的多步推理链时极为有用——你可以逐步排除错误分支，精确定位推理偏离的起点。

### 可观测性设计原则

**原则一：每个 Span 都要包含决策上下文。** 不要只记录"调用了工具"，要记录"因为什么调用了这个工具"。在 metadata 中包含触发该步骤的决策依据，这样在事后分析时才能理解 Agent 的推理链路。

**原则二：日志按功能分层。** 应用层日志记录用户的原始请求和 Agent 的最终回答，这一层关注的是业务结果是否正确；决策层日志记录 LLM 在每一步选择了哪个工具以及选择的理由，这一层关注的是推理逻辑是否合理；执行层日志记录工具调用的参数、返回值和耗时，这一层关注的是工具交互是否正常；基础设施层日志记录底层的 API 调用、数据库查询和网络超时，这一层关注的是系统稳定性。分层后你可以根据问题的性质快速定位到对应层级，而不是在海量日志中盲目搜索。

**原则三：错误日志必须包含足够上下文。** 一条好的错误日志应该能让工程师在不复现问题的情况下理解发生了什么。

```python
# ❌ 不好的做法：只记录了异常信息，缺乏上下文
logger.error(f"Tool call failed: {e}")

# ✅ 好的做法：完整的上下文信息
logger.error("tool_call_failed",
    tool_name=tool.name,
    arguments=kwargs,
    error_type=type(e).__name__,
    error_msg=str(e),
    correlation_id=correlation_id_var.get(""),
    retry_count=retry_count,
    model_decision_context=last_llm_output[:500]
)
```

**原则四：采样与成本控制。** 生产环境中不可能记录所有 Trace 的全部细节，LangSmith 的 trace 也会产生费用。建议采用分级采样策略：错误请求百分之百完整记录，慢请求（超过阈值如十秒）百分之百记录，正常请求按百分之十的比例采样。这样既保证了关键问题不会遗漏，又控制了存储和分析成本。

---

## 总结与最佳实践

AI Agent 的调试不是靠单一工具解决的，而是一套分层的工具链和工作流。

**MCP Inspector** 聚焦工具调用层，解决"LLM 和工具之间的信息传递是否正确"的问题。它最适合在开发阶段进行工具集成调试，验证 Schema 定义、排查连接问题、对比参数差异。

**LangSmith Trace** 聚焦全链路可视化，解决"Agent 整体决策链路是否合理"的问题。它适合开发和生产环境的持续监控，让你能够从一个异常回答回溯到完整的推理过程。

**结构化日志与回放** 聚焦可复现性，解决"生产环境的问题能否在开发环境稳定复现"的问题。它通过 correlation_id 串联全链路日志，通过回放机制消除外部依赖的不确定性。

**核心最佳实践清单**：

1. 从项目第一天就集成 LangSmith tracing，不要等到出了问题再补
2. 每个请求都携带 correlation_id，贯穿前后端全链路
3. 对所有工具返回值做长度限制和格式校验，防止污染上下文窗口
4. 始终设置 `max_iterations` 和 `max_execution_time`，防止无限循环
5. 对 LLM 输出做结构化验证，使用 Pydantic OutputParser 确保格式正确
6. 保留最近一段时间的完整 Trace，便于快速回查历史问题
7. 建立 Agent 评测数据集并定期回归测试，及早发现质量退化
8. 错误日志要包含完整的决策上下文，而不是仅仅记录异常信息

调试能力是 Agent 工程化的核心基础设施。投入在可观测性上的时间和精力，会在后续的维护和迭代中以十倍的效率回报给你。与其在生产事故中手忙脚乱地加日志、改代码，不如在架构设计阶段就把调试友好的原则融入其中。一个可观测的 Agent 系统，不仅让你在出问题时能快速定位根因，更让你在日常开发中对 Agent 的行为有充分的信心和掌控力。

---

## 相关阅读

- [AI Agent Error Recovery 实战：工具调用失败、LLM 幻觉、上下文溢出的自动降级与重试策略](/ai/2026-06-05-ai-agent-error-recovery-tool-failure-hallucination-overflow-degradation-retry/)
- [MCP (Model Context Protocol) 实战：AI Agent 工具标准化与生态集成深度剖析](/ai/2026-06-01-mcp-model-context-protocol-ai-agent-tool-standardization/)
- [AI Agent Observability 进阶：LangSmith vs LangFuse vs Helicone 实战——成本追踪、延迟分析与回归测试闭环](/00_架构/2026-06-05-AI-Agent-Observability-LangSmith-LangFuse-Helicone/)
