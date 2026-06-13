---

title: Claude Agent SDK 实战：Anthropic 官方 Agent 开发框架——MCP 原生集成、子代理编排与 Laravel 后端接入
keywords: [Claude Agent SDK, Anthropic, Agent, MCP, Laravel, 官方, 开发框架, 原生集成, 子代理编排与, 后端接入]
date: 2026-06-07 12:00:00
tags:
- Claude
- agent-sdk
- MCP
- Laravel
- AI Agent
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: Claude Agent SDK 是 Anthropic 官方推出的轻量级 Agent 开发框架，原生集成 MCP 协议，支持子代理 Handoff 编排、Guardrail 安全护栏与多 MCP Server 组合。本文详解四大核心原语、三种传输方式、并行串行编排模式，并提供 Laravel 后端完整桥接方案与客户支持系统实战案例。
---



## 一、引言：为什么 Anthropic 要推出 Claude Agent SDK？

2025 年以来，AI Agent 领域进入白热化阶段。从 LangChain 到 CrewAI，从 AutoGen 到 OpenAI Agents SDK，各种框架百花齐放。然而在实际工程落地中，开发者面临一个共同的痛点：**将 LLM 调用转化为可靠、可编排、可观测的生产级 Agent，依然充满摩擦**。

传统的 Agent 开发流程通常需要开发者手动管理工具调用的循环、处理多轮对话的状态流转、以及自行实现错误重试和超时机制。这些基础设施层面的重复工作消耗了大量开发精力，却与业务价值无直接关联。

Anthropic 在发布 Claude 3.5/4 系列模型的同时，正式开源了 **Claude Agent SDK**（Python 包名 `claude-agent-sdk`），定位非常清晰——**不是一个"万能框架"，而是一个以 Claude 模型为核心、原生集成 MCP 协议、轻量且可组合的 Agent 开发工具包**。

这个定位背后有一个重要的产品哲学：Anthropic 认为 Agent 框架不应该是另一个庞大的抽象层，而应该是一组精心设计的原语（primitives），让开发者能够用最少的代码构建出生产级的 Agent 系统。这与 Anthropic 一贯的"简单、可靠、安全"的产品理念一脉相承。

### 与同类框架的定位差异

在选择 Agent 框架时，开发者需要从多个维度进行考量。以下是主流框架的核心对比：

| 维度 | Claude Agent SDK | OpenAI Agents SDK | LangChain / LangGraph | Hermes Agent |
|------|-----------------|-------------------|----------------------|--------------|
| 模型绑定 | Claude 原生优化 | GPT 原生优化 | 模型无关 | 模型无关（多 Provider） |
| MCP 支持 | 一等公民（内置） | 需自行桥接 | 社区插件 | 插件式 |
| 子代理编排 | 原生 Handoff | 原生 Handoff | Graph 节点 | Skill/Cron 编排 |
| 复杂度 | 轻量、聚焦 | 轻量、聚焦 | 重量级、全能 | 中等、面向终端用户 |
| Guardrail | 内置输入/输出校验 | 内置 | 需自行实现 | Profile 级隔离 |
| 学习曲线 | 低 | 低 | 中高 | 中 |

Claude Agent SDK 的核心哲学是：**Agent = Instructions + Tools + Handoffs**，通过组合这三个原语，构建从简单到复杂的任意 Agent 系统。这种极简主义的设计使得新开发者可以在几分钟内上手，同时保留了足够的灵活性来构建复杂的多 Agent 系统。

---

## 二、架构总览：核心概念与设计哲学

### 2.1 四大核心原语

Claude Agent SDK 的架构围绕四个核心概念构建，每个概念都经过精心设计，职责边界清晰：

**Agent（代理）**：SDK 的基本执行单元。每个 Agent 拥有自己的 system prompt（instructions）、绑定的工具集和可选的 handoff 目标。Agent 的设计强调"单一职责"——一个 Agent 专注于一个特定的任务领域，通过 handoff 机制实现跨领域的协作。

**Tool（工具）**：Agent 可以调用的外部能力。SDK 支持三种来源——Python 函数（通过 `@tool` 装饰器定义）、MCP Server 暴露的工具（自动发现和注册）、以及内置工具（如 WebSearch、CodeExecution）。工具的定义遵循 JSON Schema 规范，确保类型安全和参数校验。

**Handoff（交接）**：Agent 之间的委派机制。当一个 Agent 判断当前任务应由另一个 Agent 处理时，执行 handoff，将控制权和对话上下文完整地转移给目标 Agent。Handoff 可以是无条件的（直接转接），也可以是带条件的（根据上下文判断是否转接）。

**Guardrail（护栏）**：输入/输出校验层。在 Agent 执行前后对数据进行校验，确保安全性和合规性。Guardrail 支持同步和异步两种模式，可以链式组合多个校验规则。

### 2.2 SDK 安装与基础用法

安装过程非常简洁，支持 pip 和 uv 两种方式：

```bash
pip install claude-agent-sdk
# 或使用 uv（推荐，速度更快）
uv pip install claude-agent-sdk
```

环境变量配置：

```bash
export ANTHROPIC_API_KEY="sk-ant-xxxxx"
```

最简示例——仅需三行代码即可创建一个可运行的 Agent：

```python
from claude_agent_sdk import Agent, Runner

agent = Agent(
    name="Assistant",
    instructions="你是一个有帮助的助手。",
    model="claude-sonnet-4-20250514",
)

result = Runner.run_sync(agent, "你好，请介绍一下你自己。")
print(result.final_output)
```

`Runner` 是 SDK 的执行引擎，它在底层完成了大量繁重的工作：

1. 将 Agent 的 instructions 和 tools 定义注入 system prompt
2. 管理与 Claude API 的完整对话循环（agentic loop）
3. 检测 `tool_use` 信号并自动执行对应的工具函数
4. 检测 handoff 信号并切换到目标 Agent
5. 处理错误重试和超时逻辑
6. 返回结构化的执行结果

### 2.3 执行流程详解

理解 agentic loop 是掌握 Claude Agent SDK 的关键。整个执行流程如下：

```
用户输入 → Runner 启动初始 Agent
    → Claude 生成响应
    → 响应中包含 tool_use?
        → 是：执行工具 → 将工具结果注入上下文 → 回到 Claude 生成响应
        → 否：继续检查
    → 响应中包含 handoff 信号?
        → 是：切换到目标 Agent → 回到 Claude 生成响应
        → 否：继续检查
    → 响应为纯文本?
        → 是：返回 final_output，循环结束
```

这个循环的关键优势在于它完全自动化的——开发者不需要手动管理 tool call 的结果回注、不需要自行判断何时结束循环、也不需要处理 Agent 切换时的上下文传递。SDK 的 Runner 会处理这一切，让你专注于定义 Agent 的行为逻辑。

---

## 三、MCP 原生集成：一等公民级的工具生态

### 3.1 什么是 MCP？

MCP（Model Context Protocol）是 Anthropic 主导的开放协议，旨在标准化 LLM 与外部工具/数据源的交互方式。在 MCP 出现之前，每个 Agent 框架都有自己的工具定义格式，导致大量重复工作和生态碎片化。MCP 的目标是提供一个统一的协议层，让工具开发者只需要实现一次 MCP Server，就能被所有支持 MCP 的客户端消费。

一个 MCP Server 可以暴露三种资源：
- **Tools（工具）**：可执行的操作，如查询数据库、发送邮件、调用 API
- **Resources（资源）**：只读的数据源，如文档、配置文件、数据库 schema
- **Prompts（提示模板）**：预定义的提示词模板，可带参数

Claude Agent SDK 对 MCP 的支持是**原生且深度集成**的，这是它区别于其他 Agent 框架的核心优势之一。其他框架通常需要开发者自行实现 MCP 客户端逻辑，而 Claude Agent SDK 将其内置为一等公民，支持自动发现、工具过滤、资源注入等高级特性。

### 3.2 三种 MCP 传输方式

SDK 支持 MCP 规范定义的全部三种传输方式，覆盖了从本地开发到生产部署的全部场景：

#### Stdio 传输（本地进程）

适用于本地工具服务器，通过标准输入/输出与 MCP Server 进程通信。这种方式延迟最低、安全性最好（无需暴露网络端口），适合文件系统操作、本地数据库查询等场景：

```python
from claude_agent_sdk import Agent, Runner
from claude_agent_sdk.mcp import StdioMCPServer

# 连接本地 MCP Server（如官方的 filesystem server）
filesystem_server = StdioMCPServer(
    name="filesystem",
    command="npx",
    args=["-y", "@modelcontextprotocol/server-filesystem", "/Users/michael/Documents"],
)

agent = Agent(
    name="FileAssistant",
    instructions="你可以帮助用户管理文件系统。使用提供的工具来读写文件。",
    mcp_servers=[filesystem_server],
)

result = Runner.run_sync(agent, "列出 /Users/michael/Documents 下的所有 Markdown 文件")
print(result.final_output)
```

#### SSE 传输（HTTP 长连接）

适用于远程 MCP Server，通过 Server-Sent Events 保持双向通信。SSE 是 HTTP 协议的扩展，允许服务器向客户端推送事件，非常适合需要实时通信的场景：

```python
from claude_agent_sdk.mcp import SSEMCPServer

# 连接远程 MCP Server
remote_server = SSEMCPServer(
    name="company-database",
    url="https://mcp.internal.company.com/sse",
    headers={"Authorization": "Bearer ${MCP_TOKEN}"},
)

agent = Agent(
    name="DBAssistant",
    instructions="你是一个数据库查询助手。使用提供的工具查询公司数据库。",
    mcp_servers=[remote_server],
)
```

#### Streamable HTTP 传输（新一代推荐方式）

MCP 规范最新推荐的传输方式，支持无状态请求和流式响应，更适合 serverless 和微服务架构。与 SSE 相比，Streamable HTTP 不需要维护长连接，对负载均衡和自动扩缩容更友好：

```python
from claude_agent_sdk.mcp import StreamableHTTPMCPServer

api_server = StreamableHTTPMCPServer(
    name="product-api",
    url="https://api.example.com/mcp",
    headers={"X-API-Key": "sk-xxx"},
)
```

### 3.3 工具自动发现与注册

当 Agent 绑定 MCP Server 后，SDK 会在初始化时自动执行 `tools/list` 调用，发现所有可用工具并注册到 Agent 的工具集中。这个过程对开发者完全透明，无需手动注册。

在实际项目中，一个 MCP Server 可能暴露数十个工具，但并非所有工具都适合暴露给模型。SDK 提供了灵活的工具过滤机制：

```python
agent = Agent(
    name="SelectiveAgent",
    instructions="你是一个文件助手。",
    mcp_servers=[filesystem_server],
    mcp_tool_filter={
        "filesystem": ["read_file", "list_directory"]  # 只暴露这两个工具
    },
)
```

这种过滤机制在安全敏感的场景中尤为重要——你可以精确控制 Agent 能够使用的工具范围，避免模型意外调用高危操作。

### 3.4 多 MCP Server 组合

一个 Agent 可以同时连接多个 MCP Server，实现跨系统的工具调用：

```python
agent = Agent(
    name="MultiToolAgent",
    instructions="你是一个全能助手，可以操作文件系统、查询数据库、发送 Slack 消息。",
    mcp_servers=[
        StdioMCPServer(name="fs", command="npx", args=["-y", "@modelcontextprotocol/server-filesystem", "/data"]),
        StdioMCPServer(name="db", command="python", args=["mcp_db_server.py"]),
        SSEMCPServer(name="slack", url="https://mcp-slack.example.com/sse"),
    ],
)
```

SDK 会自动管理所有 MCP Server 的连接生命周期，并统一工具命名空间，避免冲突。

---

## 四、子代理编排：Handoff 模式与并行 Agent

### 4.1 Handoff 基础

Handoff 是 Claude Agent SDK 的核心编排原语，它解决了一个常见问题：**单个 Agent 的 instructions 和工具集过于庞大时，模型的决策质量会下降**。通过 handoff，我们可以将复杂任务分解给多个专业化的 Agent，每个 Agent 只关注自己擅长的领域。

```python
from claude_agent_sdk import Agent, Runner, handoff

# 定义专业 Agent
billing_agent = Agent(
    name="BillingAgent",
    instructions="你是账单专家。处理所有与账单、付款、退款相关的问题。你可以查询账单记录、计算费用、处理退款申请。",
    model="claude-sonnet-4-20250514",
)

tech_agent = Agent(
    name="TechSupportAgent",
    instructions="你是技术支持专家。处理所有与产品技术问题相关的咨询。你可以查询知识库、诊断常见问题、提供解决方案。",
    model="claude-sonnet-4-20250514",
)

# 主 Agent 通过 handoff 委派任务
triage_agent = Agent(
    name="TriageAgent",
    instructions="""你是客服分流助手。根据用户问题的类型，将对话转接给合适的专家：
    - 账单相关（付款、退款、发票）→ 转给 BillingAgent
    - 技术问题（使用方法、报错、兼容性）→ 转给 TechSupportAgent
    - 简单问候或一般咨询 → 自行回答""",
    handoffs=[billing_agent, tech_agent],
)

result = Runner.run_sync(triage_agent, "我上个月的账单多扣了 50 元，能帮我查一下吗？")
print(result.final_output)
```

在上述例子中，当 `TriageAgent` 判断用户问题是账单相关的，它会自动执行 handoff 将控制权转交给 `BillingAgent`。整个过程对用户透明——他们只需要和一个"客服"对话，背后的专业分工由系统自动完成。

### 4.2 带条件的 Handoff

在实际业务场景中，handoff 通常需要根据上下文进行条件判断。SDK 支持定义自定义的 handoff 条件函数：

```python
from claude_agent_sdk import Agent, Handoff

def should_escalate_to_human(context):
    """当用户表达强烈不满时，升级到人工客服"""
    frustration_keywords = ["投诉", "不满意", "退款", "经理", "消协", "12315"]
    messages = context.messages
    last_user_msg = [m for m in messages if m.role == "user"][-1].content
    return any(kw in last_user_msg for kw in frustration_keywords)

human_agent = Agent(
    name="HumanEscalation",
    instructions="你是一个高级客服主管。用专业且有同理心的方式处理升级问题。优先解决客户诉求，必要时可以提供补偿方案。",
)

triage_agent = Agent(
    name="TriageAgent",
    instructions="你是客服助手。",
    handoffs=[
        billing_agent,
        tech_agent,
        Handoff(
            target=human_agent,
            condition=should_escalate_to_human,
            description="当用户不满意、要求投诉或要求升级时转接人工客服主管",
        ),
    ],
)
```

条件函数接收完整的对话上下文，可以实现复杂的判断逻辑。这对于构建真实的客服系统至关重要——你需要根据用户的情绪、问题的严重程度、以及对话的历史来决定是否升级处理。

### 4.3 并行 Agent 执行

对于可以并行处理的子任务，SDK 提供了并发执行能力，显著减少总响应时间：

```python
import asyncio
from claude_agent_sdk import Agent, Runner

research_agent = Agent(
    name="Researcher",
    instructions="你是一个信息研究员，擅长搜集和整理市场数据、行业报告、竞品信息。",
    model="claude-sonnet-4-20250514",
)

analysis_agent = Agent(
    name="Analyst",
    instructions="你是一个数据分析师，擅长从数据中发现规律、识别风险、提出建议。",
    model="claude-sonnet-4-20250514",
)

async def parallel_research(topic: str):
    """并行执行研究和分析任务，然后汇总结果"""
    # 并行执行两个独立任务
    research_result, analysis_result = await asyncio.gather(
        Runner.run(research_agent, f"搜集关于 {topic} 的最新市场数据和关键玩家信息"),
        Runner.run(analysis_agent, f"分析 {topic} 的行业趋势、增长驱动因素和潜在风险"),
    )
    
    # 汇总结果
    synthesis_agent = Agent(
        name="Synthesizer",
        instructions="你是一个报告撰写专家。将多源信息整合成结构化、可执行的商业报告。",
    )
    
    combined_input = f"""
    【研究数据】
    {research_result.final_output}
    
    【分析结论】
    {analysis_result.final_output}
    
    请将以上内容整合为一份包含执行摘要、关键发现、风险提示和行动建议的结构化报告。
    """
    
    final = await Runner.run(synthesis_agent, combined_input)
    return final.final_output

# 运行
report = asyncio.run(parallel_research("2026年中国AI芯片市场"))
print(report)
```

这种"分治-汇总"模式在实际业务中非常常见，例如：市场调研报告、竞品分析、多维度数据聚合等场景。

### 4.4 Agent Pipeline（串行流水线）

对于需要按顺序执行的多步任务，可以构建 Agent Pipeline，每个 Agent 的输出作为下一个 Agent 的输入：

```python
from claude_agent_sdk import Agent, PipelineRunner

# 定义流水线中的每个 Agent，各自负责一个处理阶段
extractor = Agent(
    name="Extractor",
    instructions="从输入文本中提取关键实体（人名、组织、日期、金额）和核心事实。以 JSON 格式输出。",
)

verifier = Agent(
    name="Verifier",
    instructions="验证提取的信息是否准确、完整。标注每个事实的置信度（高/中/低），指出可能的错误或遗漏。",
)

formatter = Agent(
    name="Formatter",
    instructions="将验证后的信息格式化为结构化的 Markdown 报告，包含摘要、详细信息和置信度标注。",
)

# 构建流水线：Extractor → Verifier → Formatter
pipeline = PipelineRunner([extractor, verifier, formatter])

result = pipeline.run_sync("Apple 今日发布 Q2 财报，营收 948 亿美元，同比增长 5%，净利润 236 亿美元...")
print(result.final_output)
```

Pipeline 模式适合数据处理、内容生成等需要多步加工的场景。每个 Agent 职责单一，便于独立测试和优化。

---

## 五、Laravel 后端接入：从 PHP 到 Python Agent 的桥接方案

在实际项目中，很多团队的技术栈是 PHP/Laravel。虽然 Claude Agent SDK 是 Python 包，但我们可以通过多种方式将其集成到 Laravel 后端中。本节将介绍三种经过验证的集成方案，从简单到复杂逐步展开。

### 5.1 方案一：Python Agent 微服务（推荐方案）

这是生产环境最推荐的方案——将 Python Agent 服务化，Laravel 通过 HTTP 调用。这种架构的优势在于：Python 和 PHP 各自独立部署、独立扩缩容；Agent 服务的更新不影响 Laravel 主应用；可以使用 Kubernetes 等容器编排工具统一管理。

#### Python Agent 服务端（FastAPI）

```python
# agent_server.py
import uuid
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from claude_agent_sdk import Agent, Runner
from claude_agent_sdk.mcp import StdioMCPServer

app = FastAPI(title="Claude Agent Service", version="1.0.0")

# 初始化 MCP Servers
db_server = StdioMCPServer(
    name="database",
    command="python",
    args=["mcp_servers/order_service.py"],
)

knowledge_server = StdioMCPServer(
    name="knowledge-base",
    command="npx",
    args=["-y", "@modelcontextprotocol/server-filesystem", "./knowledge_base"],
)

# 定义 Agent（全局单例，复用 MCP 连接）
customer_agent = Agent(
    name="CustomerSupport",
    instructions="""你是一个客户服务 Agent。
    你可以查询订单状态、处理退换货申请、回答产品问题。
    始终保持友好和专业的语气。""",
    mcp_servers=[db_server, knowledge_server],
    model="claude-sonnet-4-20250514",
)

class AgentRequest(BaseModel):
    message: str
    session_id: str | None = None
    metadata: dict | None = None

class AgentResponse(BaseModel):
    reply: str
    tools_used: list[str]
    handoff_target: str | None = None
    session_id: str

@app.post("/api/agent/chat", response_model=AgentResponse)
async def chat(request: AgentRequest):
    """处理用户消息并返回 Agent 响应"""
    try:
        session_id = request.session_id or str(uuid.uuid4())
        result = await Runner.run(
            customer_agent,
            request.message,
            session_id=session_id,
        )
        return AgentResponse(
            reply=result.final_output,
            tools_used=[tc.tool_name for tc in result.tool_calls],
            handoff_target=result.handoff_target,
            session_id=session_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/tools")
async def list_tools():
    """列出 Agent 可用的所有工具，供前端展示"""
    tools = await customer_agent.list_tools()
    return {"tools": [t.model_dump() for t in tools]}

@app.get("/health")
async def health_check():
    """健康检查端点，用于负载均衡器探活"""
    return {"status": "healthy", "agent": customer_agent.name}
```

启动服务：

```bash
# 开发环境
uvicorn agent_server:app --host 0.0.0.0 --port 8000 --reload

# 生产环境（多 worker）
uvicorn agent_server:app --host 0.0.0.0 --port 8000 --workers 4 --loop uvloop
```

#### Laravel 调用层封装

在 Laravel 侧，我们创建一个服务类来封装与 Python Agent 的通信逻辑：

```php
<?php
// app/Services/ClaudeAgentService.php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;

class ClaudeAgentService
{
    private string $baseUrl;
    private string $apiKey;
    private int $timeout;

    public function __construct()
    {
        $this->baseUrl = rtrim(config('services.claude_agent.url', 'http://localhost:8000'), '/');
        $this->apiKey = config('services.claude_agent.api_key', '');
        $this->timeout = (int) config('services.claude_agent.timeout', 60);
    }

    /**
     * 发送消息给 Claude Agent 并获取回复
     */
    public function chat(string $message, ?string $sessionId = null, array $metadata = []): array
    {
        $sessionId = $sessionId ?? Str::uuid()->toString();

        $response = Http::timeout($this->timeout)
            ->retry(2, 1000) // 失败自动重试 2 次，间隔 1 秒
            ->withHeaders([
                'X-Session-ID' => $sessionId,
                'Authorization' => 'Bearer ' . $this->apiKey,
            ])
            ->post("{$this->baseUrl}/api/agent/chat", [
                'message' => $message,
                'session_id' => $sessionId,
                'metadata' => $metadata,
            ]);

        if ($response->failed()) {
            Log::error('Claude Agent service error', [
                'status' => $response->status(),
                'body' => $response->body(),
                'session_id' => $sessionId,
            ]);
            throw new RuntimeException(
                "Agent 服务异常（HTTP {$response->status()}）",
                $response->status()
            );
        }

        $data = $response->json();

        // 记录会话历史
        $this->appendToSession($sessionId, [
            'user' => $message,
            'agent' => $data['reply'],
            'tools_used' => $data['tools_used'] ?? [],
            'timestamp' => now()->toISOString(),
        ]);

        return $data;
    }

    /**
     * 获取 Agent 可用工具列表（带缓存）
     */
    public function getAvailableTools(): array
    {
        return Cache::remember('claude_agent_tools', 300, function () {
            $response = Http::timeout(10)->get("{$this->baseUrl}/api/agent/tools");
            return $response->successful() ? $response->json('tools', []) : [];
        });
    }

    /**
     * 获取会话历史
     */
    public function getSessionHistory(string $sessionId): array
    {
        return Cache::get("agent_session:{$sessionId}", []);
    }

    /**
     * 清除会话历史
     */
    public function clearSession(string $sessionId): void
    {
        Cache::forget("agent_session:{$sessionId}");
    }

    /**
     * 追加消息到会话历史
     */
    private function appendToSession(string $sessionId, array $entry): void
    {
        $key = "agent_session:{$sessionId}";
        $history = Cache::get($key, []);
        $history[] = $entry;

        // 保留最近 50 条对话记录，避免内存溢出
        if (count($history) > 50) {
            $history = array_slice($history, -50);
        }

        Cache::put($key, $history, now()->addHours(24));
    }
}
```

#### Laravel Controller 实现

```php
<?php
// app/Http/Controllers/AgentController.php

namespace App\Http\Controllers;

use App\Services\ClaudeAgentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgentController extends Controller
{
    public function __construct(
        private readonly ClaudeAgentService $agentService
    ) {}

    /**
     * 处理用户聊天消息
     */
    public function chat(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'message' => 'required|string|max:4096',
            'session_id' => 'nullable|string|uuid',
        ]);

        $result = $this->agentService->chat(
            message: $validated['message'],
            sessionId: $validated['session_id'] ?? null,
            metadata: [
                'user_id' => $request->user()?->id,
                'ip' => $request->ip(),
            ],
        );

        return response()->json([
            'success' => true,
            'data' => $result,
        ]);
    }

    /**
     * 获取可用工具列表
     */
    public function tools(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $this->agentService->getAvailableTools(),
        ]);
    }
}
```

#### 配置与路由

```php
<?php
// config/services.php（添加 claude_agent 配置块）

return [
    // ...其他配置

    'claude_agent' => [
        'url' => env('CLAUDE_AGENT_URL', 'http://localhost:8000'),
        'api_key' => env('CLAUDE_AGENT_API_KEY', ''),
        'timeout' => env('CLAUDE_AGENT_TIMEOUT', 60),
    ],
];
```

```php
<?php
// routes/api.php

use App\Http\Controllers\AgentController;

Route::middleware('auth:sanctum')->prefix('agent')->group(function () {
    Route::post('/chat', [AgentController::class, 'chat']);
    Route::get('/tools', [AgentController::class, 'tools']);
});
```

### 5.2 方案二：Laravel Queue 异步处理

对于不需要实时响应的场景（如批量处理、报告生成），可以使用 Laravel Queue 解耦请求与 Agent 执行：

```php
<?php
// app/Jobs/ProcessAgentTask.php

namespace App\Jobs;

use App\Services\ClaudeAgentService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessAgentTask implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 180;

    public function __construct(
        public readonly string $taskId,
        public readonly string $message,
        public readonly string $callbackUrl,
        public readonly array $metadata = [],
    ) {}

    public function handle(ClaudeAgentService $agentService): void
    {
        Log::info("Processing agent task", ['task_id' => $this->taskId]);

        $result = $agentService->chat(
            message: $this->message,
            metadata: $this->metadata,
        );

        // 回调通知调用方
        \Http::timeout(10)->post($this->callbackUrl, [
            'task_id' => $this->taskId,
            'status' => 'completed',
            'result' => $result,
        ]);

        Log::info("Agent task completed", ['task_id' => $this->taskId]);
    }
}
```

使用方式：

```php
// 在 Controller 中提交异步任务
ProcessAgentTask::dispatch(
    taskId: Str::uuid()->toString(),
    message: '生成本月的客户满意度分析报告',
    callbackUrl: route('agent.callback'),
    metadata: ['report_type' => 'monthly_csat'],
);
```

### 5.3 方案三：PHP 直接调用 Anthropic API（无 Python 依赖）

对于不想引入 Python 中间层的轻量级场景，可以直接在 PHP 中实现简化的 Agent 循环：

```php
<?php
// app/Services/DirectClaudeAgent.php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class DirectClaudeAgent
{
    private string $apiKey;
    private string $model;
    private int $maxTurns;
    private array $tools = [];

    public function __construct(?string $model = null, int $maxTurns = 10)
    {
        $this->apiKey = config('services.anthropic.api_key');
        $this->model = $model ?? config('services.anthropic.model', 'claude-sonnet-4-20250514');
        $this->maxTurns = $maxTurns;
    }

    /**
     * 注册工具
     */
    public function addTool(
        string $name,
        string $description,
        array $properties,
        callable $handler,
        array $required = []
    ): self {
        $this->tools[$name] = [
            'definition' => [
                'name' => $name,
                'description' => $description,
                'input_schema' => [
                    'type' => 'object',
                    'properties' => $properties,
                    'required' => $required,
                ],
            ],
            'handler' => $handler,
        ];
        return $this;
    }

    /**
     * 运行 Agent 循环
     */
    public function run(string $systemPrompt, string $userMessage): string
    {
        $messages = [['role' => 'user', 'content' => $userMessage]];

        for ($turn = 0; $turn < $this->maxTurns; $turn++) {
            $response = $this->callApi($systemPrompt, $messages);
            $content = $response['content'];

            // 检查是否有 tool_use 请求
            $toolUses = array_values(array_filter(
                $content,
                fn($block) => ($block['type'] ?? '') === 'tool_use'
            ));

            if (empty($toolUses)) {
                // 无工具调用，提取文本结果返回
                $textBlocks = array_values(array_filter(
                    $content,
                    fn($block) => ($block['type'] ?? '') === 'text'
                ));
                return implode('', array_map(fn($b) => $b['text'] ?? '', $textBlocks));
            }

            // 将 assistant 响应加入对话历史
            $messages[] = ['role' => 'assistant', 'content' => $content];

            // 执行所有工具调用并收集结果
            $toolResults = [];
            foreach ($toolUses as $toolUse) {
                $toolName = $toolUse['name'];
                $toolInput = $toolUse['input'] ?? [];

                try {
                    if (!isset($this->tools[$toolName])) {
                        throw new \RuntimeException("工具 {$toolName} 未注册");
                    }
                    $result = ($this->tools[$toolName]['handler'])($toolInput);
                    $toolResults[] = [
                        'type' => 'tool_result',
                        'tool_use_id' => $toolUse['id'],
                        'content' => is_string($result) ? $result : json_encode($result, JSON_UNESCAPED_UNICODE),
                    ];
                } catch (\Throwable $e) {
                    $toolResults[] = [
                        'type' => 'tool_result',
                        'tool_use_id' => $toolUse['id'],
                        'content' => 'Error: ' . $e->getMessage(),
                        'is_error' => true,
                    ];
                }
            }

            $messages[] = ['role' => 'user', 'content' => $toolResults];
        }

        throw new \RuntimeException("Agent 超过最大轮次限制 ({$this->maxTurns})");
    }

    private function callApi(string $systemPrompt, array $messages): array
    {
        $payload = [
            'model' => $this->model,
            'max_tokens' => 4096,
            'system' => $systemPrompt,
            'messages' => $messages,
        ];

        if (!empty($this->tools)) {
            $payload['tools'] = array_map(fn($t) => $t['definition'], $this->tools);
        }

        $response = Http::withHeaders([
            'x-api-key' => $this->apiKey,
            'anthropic-version' => '2023-06-01',
            'content-type' => 'application/json',
        ])->timeout(60)->post('https://api.anthropic.com/v1/messages', $payload);

        if ($response->failed()) {
            throw new \RuntimeException("Anthropic API error ({$response->status()}): " . $response->body());
        }

        return $response->json();
    }
}
```

使用示例：

```php
$agent = new DirectClaudeAgent();

$agent->addTool(
    'query_order',
    '根据订单号查询订单详情',
    ['order_id' => ['type' => 'string', 'description' => '订单号']],
    fn(array $input) => Order::where('order_id', $input['order_id'])->first()?->toArray()
        ?? ['error' => '订单未找到'],
    required: ['order_id']
);

$result = $agent->run(
    "你是客服助手，帮助用户查询订单信息。用中文简洁回答。",
    "帮我查一下订单 ORD-20260601-001 的状态"
);
```

**三种方案的选择建议：**

- **方案一（Python 微服务）**：适合正式生产环境，支持 MCP 生态，可扩展性强
- **方案二（Queue 异步）**：适合非实时场景，如批量处理、报告生成
- **方案三（PHP 直接调用）**：适合轻量级场景或原型验证，无需 Python 依赖

---

## 六、实战案例：构建完整的客户支持 Agent

让我们将前面学到的所有概念整合起来，构建一个生产级的客户支持系统。这个案例展示了从 Agent 设计到 MCP Server 实现的完整流程。

### 6.1 系统架构设计

```
┌─────────────┐     HTTP/SSE      ┌──────────────────┐
│   Laravel    │ ◄──────────────► │  Python Agent    │
│   Backend    │                   │  Service (FastAPI)│
└──────┬───────┘                   └────────┬─────────┘
       │                                     │
       ▼                                     ▼
┌──────────────┐                   ┌──────────────────┐
│  MySQL/Redis │                   │  MCP Servers      │
│  (用户/订单) │                   │  ├── 订单系统     │
└──────────────┘                   │  ├── 知识库       │
                                   │  └── 工单系统     │
                                   └──────────────────┘
```

### 6.2 Python Agent 完整实现

```python
# customer_support_agent.py

import asyncio
import uuid
from claude_agent_sdk import Agent, Runner, tool, InputGuardrail, GuardrailFunctionOutput
from claude_agent_sdk.mcp import StdioMCPServer

# ─── MCP Servers 配置 ───────────────────────────────────────────

order_server = StdioMCPServer(
    name="order-service",
    command="python",
    args=["mcp_servers/order_service.py"],
)

knowledge_server = StdioMCPServer(
    name="knowledge-base",
    command="npx",
    args=["-y", "@modelcontextprotocol/server-filesystem", "./knowledge_base"],
)

ticket_server = StdioMCPServer(
    name="ticket-system",
    command="python",
    args=["mcp_servers/ticket_service.py"],
)

# ─── Guardrails 安全护栏 ────────────────────────────────────────

@tool
async def check_message_safety(message: str) -> GuardrailFunctionOutput:
    """检查用户消息是否包含不当内容或潜在的 Prompt Injection"""
    blocked_keywords = ["黑客", "破解", "注入攻击", "DDoS", "ignore previous"]
    is_safe = not any(kw in message.lower() for kw in blocked_keywords)
    return GuardrailFunctionOutput(
        is_safe=is_safe,
        message="消息包含不当内容，已被安全护栏拦截" if not is_safe else None,
    )

input_guardrail = InputGuardrail(
    name="safety-check",
    guardrail_function=check_message_safety,
)

# ─── 专业化 Agent 定义 ──────────────────────────────────────────

order_agent = Agent(
    name="OrderSpecialist",
    instructions="""你是订单处理专家。你的职责包括：
    1. 查询订单状态和物流跟踪信息
    2. 处理订单修改请求（地址变更、商品更换）
    3. 协助退换货流程，记录退换原因
    
    操作规范：
    - 查询订单前必须确认订单号格式正确
    - 修改订单需要用户二次确认
    - 退换货需要创建工单记录""",
    mcp_servers=[order_server],
    model="claude-sonnet-4-20250514",
)

knowledge_agent = Agent(
    name="KnowledgeSpecialist",
    instructions="""你是产品知识库专家。你的职责包括：
    1. 查询产品规格、功能说明、使用教程
    2. 搜索常见问题解答（FAQ）
    3. 提供产品对比和购买建议
    
    操作规范：
    - 引用知识库内容时标注文档来源
    - 不确定的信息要明确告知用户
    - 涉及价格变动以官网为准""",
    mcp_servers=[knowledge_server],
    model="claude-sonnet-4-20250514",
)

escalation_agent = Agent(
    name="EscalationSpecialist",
    instructions="""你是问题升级处理专家。处理需要人工介入的复杂问题：
    1. 创建工单并根据严重程度分配优先级（P1 紧急 / P2 高 / P3 中 / P4 低）
    2. 详细记录问题描述、客户诉求和已尝试的解决方案
    3. 告知客户预计处理时间和后续跟进方式
    
    操作规范：
    - 安抚客户情绪，表达同理心
    - 给出明确的处理预期（时间、流程）
    - P1/P2 级工单需要标注"需主管审批"""",
    mcp_servers=[ticket_server],
    model="claude-sonnet-4-20250514",
)

# ─── 主入口 Agent（Triage）──────────────────────────────────────

triage_agent = Agent(
    name="CustomerSupport",
    instructions="""你是智能客服助手，负责理解客户需求并分配给合适的专业 Agent：

    分流规则：
    - 订单/物流/退换货相关 → OrderSpecialist
    - 产品信息/使用问题/FAQ → KnowledgeSpecialist  
    - 投诉/升级/复杂问题/强烈不满 → EscalationSpecialist
    - 简单问候/一般咨询 → 直接回答
    
    对话风格：友好、耐心、专业。首次回复时问候用户。""",
    handoffs=[order_agent, knowledge_agent, escalation_agent],
    input_guardrails=[input_guardrail],
    model="claude-sonnet-4-20250514",
)

# ─── FastAPI 服务 ───────────────────────────────────────────────

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Customer Support Agent API")

class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    customer_id: str | None = None

class ChatResponse(BaseModel):
    reply: str
    session_id: str
    agent_chain: list[str]
    tools_used: list[str]

@app.post("/api/support/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    session_id = request.session_id or str(uuid.uuid4())
    
    result = await Runner.run(
        triage_agent,
        request.message,
        session_id=session_id,
        max_turns=15,
    )
    
    agent_chain = [trace.agent_name for trace in result.traces]
    tools_used = list(set(tc.tool_name for tc in result.tool_calls))
    
    return ChatResponse(
        reply=result.final_output,
        session_id=session_id,
        agent_chain=agent_chain,
        tools_used=tools_used,
    )
```

### 6.3 MCP Server 实现示例（订单服务）

```python
# mcp_servers/order_service.py

import asyncio
import json
from mcp.server import Server
from mcp.server.stdio import run_server
from mcp.types import Tool, TextContent

server = Server("order-service")

# 模拟订单数据库
ORDERS = {
    "ORD-20260601-001": {
        "order_id": "ORD-20260601-001",
        "status": "shipped",
        "status_text": "已发货",
        "items": [{"name": "MacBook Pro 14寸", "qty": 1, "price": 14999}],
        "total": 14999,
        "tracking_number": "SF1234567890",
        "carrier": "顺丰速运",
        "created_at": "2026-06-01T10:30:00Z",
        "estimated_delivery": "2026-06-05",
    },
    "ORD-20260603-002": {
        "order_id": "ORD-20260603-002",
        "status": "processing",
        "status_text": "处理中",
        "items": [{"name": "AirPods Pro 3", "qty": 2, "price": 1899}],
        "total": 3798,
        "tracking_number": None,
        "carrier": None,
        "created_at": "2026-06-03T14:20:00Z",
        "estimated_delivery": "2026-06-08",
    },
}

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="query_order",
            description="根据订单号查询订单详情，包括状态、商品清单、物流信息",
            inputSchema={
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "订单号"}
                },
                "required": ["order_id"],
            },
        ),
        Tool(
            name="cancel_order",
            description="取消订单（仅限 processing 状态的订单）",
            inputSchema={
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "订单号"},
                    "reason": {"type": "string", "description": "取消原因"},
                },
                "required": ["order_id", "reason"],
            },
        ),
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "query_order":
        order = ORDERS.get(arguments["order_id"])
        if order:
            return [TextContent(type="text", text=json.dumps(order, ensure_ascii=False, indent=2))]
        return [TextContent(
            type="text",
            text=json.dumps({"error": "订单未找到", "order_id": arguments["order_id"]}, ensure_ascii=False)
        )]
    
    elif name == "cancel_order":
        order = ORDERS.get(arguments["order_id"])
        if not order:
            return [TextContent(type="text", text=json.dumps({"error": "订单未找到"}, ensure_ascii=False))]
        if order["status"] != "processing":
            return [TextContent(type="text", text=json.dumps({
                "error": f"只能取消处理中的订单，当前状态：{order['status_text']}"
            }, ensure_ascii=False))]
        order["status"] = "cancelled"
        order["status_text"] = "已取消"
        return [TextContent(type="text", text=json.dumps({
            "success": True, "message": f"订单 {order['order_id']} 已成功取消"
        }, ensure_ascii=False))]

async def main():
    await run_server(server)

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 七、横向对比：何时选择哪个框架？

### 7.1 Claude Agent SDK vs OpenAI Agents SDK

两者在设计哲学上非常接近——都强调轻量级、原语组合、子代理编排。核心区别在于生态绑定和工具协议支持。

**选择 Claude Agent SDK 的场景：**
- 工具生态围绕 MCP 构建（已有或计划建设 MCP Server）
- 需要利用 Claude 模型的长上下文和复杂推理能力
- 对输入/输出安全性有严格要求（Guardrail 需求）

**选择 OpenAI Agents SDK 的场景：**
- 需要多模态能力（图像理解、语音处理）
- 团队已有 GPT 生态的技术积累
- 需要使用 OpenAI 的内置工具（WebSearch、CodeInterpreter）

**两者都不适合的场景：**
- 需要复杂的图编排（循环、条件分支、并行合并）→ LangGraph
- 需要模型无关的抽象层 → LiteLLM + 自定义框架

### 7.2 Claude Agent SDK vs Hermes Agent

Hermes Agent 的定位更偏向"终端用户的智能助手"，强调开箱即用的体验，内置了文件操作、终端执行、定时任务等能力。Claude Agent SDK 则是面向开发者的底层框架，提供更大的灵活性和控制力。

**选择 Hermes Agent 的场景：**
- 构建面向终端用户的 AI 助手（如桌面助手、DevOps 助手）
- 需要 Profile 隔离、Skill 插件、Cron 定时任务等高级特性
- 希望支持多模型 Provider 的灵活切换

**选择 Claude Agent SDK 的场景：**
- 构建面向其他系统的后端 Agent 服务
- 需要深度定制 Agent 行为和工具链
- 已有 MCP Server 生态需要集成

### 7.3 决策流程

```
你的需求是什么？
│
├── 构建后端 Agent API 服务
│   ├── 工具生态围绕 MCP → Claude Agent SDK ✓
│   ├── 需要多模态 → OpenAI Agents SDK
│   └── 需要复杂图编排 → LangGraph
│
├── 构建终端用户 AI 助手
│   ├── 需要文件/系统操作 → Hermes Agent ✓
│   └── 纯对话交互 → 直接调用 Claude/GPT API
│
└── 构建自动化工作流
    ├── 定时任务驱动 → Hermes Agent Cron
    └── 事件驱动 → Claude Agent SDK + 消息队列
```

---

## 八、最佳实践与常见陷阱

### 8.1 最佳实践

**1. 精心设计 Instructions**

Instructions 是 Agent 最重要的配置。好的 instructions 应该像一份清晰的岗位说明书，包含身份定义、能力边界、行为规范和工具使用规则：

```python
agent = Agent(
    name="SupportAgent",
    instructions="""你是 XX 公司的客户支持 Agent。

## 身份
- 代表公司官方客服，使用中文回答
- 语气友好、专业、有耐心

## 能力边界
- 可以：查询订单、回答产品问题、创建工单
- 不可以：修改价格、承诺赔偿金额、透露内部系统信息

## 行为规范
- 不确定时说"我需要为您进一步查询"而非猜测
- 敏感操作（退款、取消）前必须二次确认
- 每次回复控制在 200 字以内，避免信息过载

## 工具使用规则
- 查询订单前必须先确认订单号
- 创建工单前必须收集完整的问题描述""",
)
```

**2. 合理使用 Guardrail**

Guardrail 是保障安全性的关键机制。建议至少实现输入校验（防注入）和输出校验（防泄露）：

```python
@tool
async def check_prompt_injection(message: str) -> GuardrailFunctionOutput:
    injection_patterns = ["忽略之前的指令", "ignore previous", "system prompt", "你现在是"]
    is_safe = not any(p in message.lower() for p in injection_patterns)
    return GuardrailFunctionOutput(is_safe=is_safe, message="检测到 Prompt Injection" if not is_safe else None)
```

**3. 工具设计原则**

好的工具应该：参数简洁、返回结构化、错误信息明确。避免返回过大的数据量，使用分页和摘要：

```python
@tool
async def search_documents(query: str, page: int = 1, page_size: int = 5):
    """搜索文档，返回分页结果"""
    results = db.search(query, offset=(page - 1) * page_size, limit=page_size)
    return {
        "total": db.count_search(query),
        "page": page,
        "results": [{"title": r.title, "summary": r.summary[:200]} for r in results],
    }
```

### 8.2 常见陷阱

**陷阱 1：Instructions 过于模糊**

```python
# ❌ 错误：模型不知道具体该做什么
instructions = "你是一个助手。"

# ✅ 正确：明确职责和行为规范
instructions = "你是客服助手。帮助用户查询订单和产品信息。用中文回答，每次不超过 200 字。"
```

**陷阱 2：工具返回过多数据**

```python
# ❌ 错误：返回全部数据，可能撑爆 context window
@tool
async def search(query: str):
    return db.search(query)  # 可能返回上千条

# ✅ 正确：分页 + 摘要
@tool
async def search(query: str, page: int = 1, page_size: int = 5):
    results = db.search(query, offset=(page - 1) * page_size, limit=page_size)
    return {"total": db.count(query), "results": [r.summary for r in results]}
```

**陷阱 3：缺少错误处理**

```python
# ❌ 错误：工具异常会中断整个 Agent 循环
@tool
async def fetch_data(url: str):
    return requests.get(url).json()  # 网络异常未处理

# ✅ 正确：优雅降级
@tool
async def fetch_data(url: str):
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        return {"error": f"数据获取失败: {str(e)}", "suggestion": "请稍后重试"}
```

**陷阱 4：异步/同步混用**

```python
# ❌ 错误：在异步上下文中使用同步 Runner 会阻塞事件循环
async def handler():
    result = Runner.run_sync(agent, "hello")

# ✅ 正确：统一使用异步 API
async def handler():
    result = await Runner.run(agent, "hello")
```

**陷阱 5：Laravel 超时配置不当**

Agent 的响应时间可能较长（特别是涉及多轮工具调用时），HTTP 超时需要合理设置：

```php
// ❌ 错误：超时太短
$response = Http::timeout(10)->post($agentUrl, $payload); // Agent 可能需要 30s+

// ✅ 正确：匹配 Agent 执行时间 + buffer
$response = Http::timeout(120)->post($agentUrl, $payload);
// 或使用异步队列方案，彻底避免 HTTP 超时问题
```

---

## 九、总结

Claude Agent SDK 的推出标志着 Anthropic 在 Agent 生态布局上的重要一步。它的核心价值可以归纳为四点：

**第一，MCP 原生集成。** 通过将 MCP 作为一等公民，Claude Agent SDK 实现了工具生态的标准化。开发者只需编写一次 MCP Server，就能被任何支持 MCP 的客户端复用，这大大降低了工具开发和维护的成本。

**第二，简洁的原语设计。** Agent + Tool + Handoff 三个核心原语覆盖了绝大多数 Agent 编排场景。这种"少即是多"的设计哲学降低了学习曲线，同时保留了足够的灵活性来构建复杂的多 Agent 系统。

**第三，生产级特性开箱即用。** Guardrail 安全护栏、会话管理、成本控制、错误重试等生产环境必需的特性都已内置，开发者无需从零实现这些基础设施。

**第四，灵活的集成方式。** 无论是 Python 微服务架构、Laravel HTTP 桥接、还是 PHP 直接调用 API，都能找到合适的接入方案，适应不同团队的技术栈。

对于正在选型 Agent 框架的团队，建议遵循以下决策路径：

- 如果你的工具生态围绕 MCP 构建，且需要构建后端 Agent 服务 → **Claude Agent SDK 是首选**
- 如果已有 PHP/Laravel 后端 → **采用 Python 微服务 + Laravel HTTP 桥接方案**
- 如果需要构建面向终端用户的 AI 助手 → **评估 Hermes Agent 是否满足需求**
- 如果需要复杂的图编排能力 → **考虑 LangGraph，但简单场景 Claude Agent SDK 足够**

Agent 框架的竞争还远未结束，但 Claude Agent SDK 凭借其"轻量、标准、务实"的设计哲学，已经成为 2026 年值得认真考虑的选项。随着 MCP 生态的不断壮大，Claude Agent SDK 的价值将进一步凸显。

---

*本文基于 Claude Agent SDK 最新文档编写，代码示例基于 Python 3.11+。如有疑问或建议，欢迎在评论区交流。*

---

## 相关阅读

- [AI Context Engineering 实战：系统化管理 AI 上下文](/categories/架构/2026-06-07-AI-Context-Engineering-实战-系统化管理AI上下文-cursorrules-CLAUDE.md-AGENTS.md/)
- [AI Agent Orchestration Patterns：四种编排模式选型](/categories/架构/AI-Agent-Orchestration-Patterns-2026-Supervisor-Router-Swarm-DAG-编排模式选型/)
- [MCP Server 开发实战：自定义 MCP 工具服务器](/categories/架构/MCP-Server-开发实战-TypeScript-Python-自定义MCP工具服务器-stdio-SSE-StreamableHTTP/)
