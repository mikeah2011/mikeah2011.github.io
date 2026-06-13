---

title: AI Agent Workflow DSL 实战：用 YAML/JSON 定义 Agent 工作流——LangGraph/LangChain/LlamaIndex
keywords: [AI Agent Workflow DSL, YAML, JSON, Agent, LangGraph, LangChain, LlamaIndex, 定义, 工作流]
date: 2026-06-07 10:00:00
tags:
- AI Agent
- DSL
- LangGraph
- LangChain
- LlamaIndex
- 工作流
description: AI Agent工作流DSL深度实战：对比LangGraph状态图、LangChain LCEL链式编排、LlamaIndex Workflow三种主流框架的声明式编排能力，通过YAML/JSON抽象层实现跨框架统一定义，涵盖条件分支、并行执行、人机交互节点设计，附Laravel后端集成方案与生产环境最佳实践。
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



在 2025—2026 年的 AI Agent 浪潮中，开发者面临的最大挑战已经不是"模型不够强"，而是"如何编排多步骤、多角色的复杂工作流"。本文将深入对比 LangGraph、LangChain LCEL 和 LlamaIndex Workflow 三种主流框架的声明式编排能力，并展示如何通过 YAML/JSON DSL 抽象层实现跨框架统一定义，最终给出与 Laravel 后端集成的完整方案。

<!-- more -->

---

## 一、为什么需要声明式 Agent 工作流？

### 1.1 硬编码之痛

在早期的 LLM 应用开发中，大多数团队采用"Python 脚本硬编码"的方式组织 Agent 逻辑：

```python
# ❌ 典型的硬编码工作流
def run_agent(query: str):
    plan = llm_call(f"请为以下查询制定执行计划：{query}")
    if "需要搜索" in plan:
        results = web_search(query)
        answer = llm_call(f"根据搜索结果回答：{results}")
    else:
        answer = llm_call(f"直接回答：{query}")
    if "不确定" in answer:
        answer = llm_call(f"请更详细地回答：{query}")
    return answer
```

这段代码至少存在以下问题：

- **不可观测**：无法在外部工具中可视化执行路径
- **不可复现**：状态散落在局部变量中，崩溃即丢失
- **不可协作**：业务人员无法理解或修改流程
- **不可测试**：单元测试需要 mock 整个 LLM 调用链
- **不可复用**：流程逻辑与具体业务强耦合

### 1.2 声明式的优势

声明式 DSL 的核心理念是**将"做什么"与"怎么做"分离**：

```yaml
# ✅ 声明式 DSL 定义同一逻辑
nodes:
  - id: plan
    type: llm
    prompt: "为以下查询制定执行计划：{{input}}"
  - id: search
    type: tool
    tool: web_search
    condition: "{{plan.output}} contains '需要搜索'"
  - id: answer
    type: llm
    prompt: |
      {% if search %}
      根据搜索结果回答：{{search.output}}
      {% else %}
      直接回答：{{input}}
      {% endif %}
edges:
  - from: __start__
    to: plan
  - from: plan
    to: [search, answer]
    condition: plan.output
  - from: search
    to: answer
```

声明式带来的好处：可视化、版本控制、热更新、跨团队协作、自动文档生成。

---

## 二、核心概念：DSL 设计模式

在深入具体框架之前，先梳理三种主流的 Agent 工作流 DSL 设计模式。

### 2.1 状态机（State Machine）

状态机是最经典的编排模型，每个节点代表一个状态，边代表状态转移条件。核心概念：

- **State（状态）**：全局可变数据容器
- **Node（节点）**：读取状态 → 执行逻辑 → 更新状态
- **Edge（边）**：条件判断后决定下一个节点
- **Termination（终止）**：特殊状态标记流程结束

```
┌──────────┐  条件A   ┌──────────┐
│  START   │─────────→│  Node A  │
└──────────┘          └────┬─────┘
                           │ 条件B
                    ┌──────▼──────┐
                    │   Node B    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │     END     │
                    └─────────────┘
```

**适用场景**：决策流程、客服对话、审批链路。LangGraph 的 StateGraph 就是这一模式的典型实现。

### 2.2 DAG（有向无环图）

DAG 将任务视为节点，依赖关系视为边，天然支持并行执行：

```
┌─────────┐
│ Extract │
└────┬────┘
     ├────────────┐
┌────▼────┐  ┌────▼────┐
│ Process │  │ Enrich  │
│  Data A │  │  Data   │
└────┬────┘  └────┬────┘
     └──────┬─────┘
        ┌───▼───┐
        │ Merge │
        └───────┘
```

**适用场景**：数据处理管道、RAG 增强检索、多模态融合。LangChain LCEL 的 Runnable 链式编排属于此类。

### 2.3 事件驱动（Event-Driven）

事件驱动模型中，节点通过发布/订阅事件进行通信，解耦程度最高：

```
┌─────────┐  emit(QueryEvent)   ┌──────────────┐
│  Entry  │────────────────────→│   Searcher   │
└─────────┘                     └──────┬───────┘
                                       │ emit(ResultsEvent)
                                ┌──────▼───────┐
                                │  Summarizer  │
                                └──────────────┘
```

**适用场景**：复杂多 Agent 协作、异步任务、人机交互混合流程。LlamaIndex Workflow 采用这一模式。

---

## 三、LangGraph 实战：状态机的终极形态

LangGraph 是 LangChain 团队推出的图编排框架，专为有状态、可中断、可持久化的 Agent 工作流设计。

### 3.1 安装与环境准备

```bash
pip install langgraph langchain-openai langchain-core
export OPENAI_API_KEY="sk-xxx"
```

### 3.2 StateGraph 核心概念

LangGraph 的核心是 `StateGraph`——一个以 TypedDict 为状态容器的有向图：

```python
from typing import TypedDict, Annotated, Literal
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# 1. 定义状态 Schema
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]  # 自动追加消息
    query: str
    plan: str
    search_results: str
    answer: str
    iteration: int

# 2. 定义节点函数（每个节点接收 state，返回部分更新）
llm = ChatOpenAI(model="gpt-4o", temperature=0)

def planner_node(state: AgentState) -> dict:
    """规划节点：分析查询并制定执行计划"""
    response = llm.invoke([
        SystemMessage(content="你是一个任务规划专家。分析用户查询，决定是否需要搜索。回复格式：[SEARCH] 或 [DIRECT] + 简要计划"),
        HumanMessage(content=state["query"])
    ])
    return {
        "plan": response.content,
        "iteration": state.get("iteration", 0) + 1
    }

def search_node(state: AgentState) -> dict:
    """搜索节点：执行网络搜索（模拟）"""
    # 实际项目中替换为真实搜索 API
    search_results = f"关于 '{state['query']}' 的搜索结果：最新信息表明这是一个重要的AI技术趋势。"
    return {"search_results": search_results}

def answer_node(state: AgentState) -> dict:
    """回答节点：生成最终答案"""
    context = state.get("search_results", "")
    prompt = f"用户问题：{state['query']}\n"
    if context:
        prompt += f"参考信息：{context}\n"
    prompt += "请给出详细、准确的回答。"
    
    response = llm.invoke([HumanMessage(content=prompt)])
    return {"answer": response.content}

def reviewer_node(state: AgentState) -> dict:
    """审核节点：检查答案质量"""
    response = llm.invoke([
        SystemMessage(content="评估以下答案的质量。回复 PASS 或 REVISE + 改进建议"),
        HumanMessage(content=f"问题：{state['query']}\n答案：{state['answer']}")
    ])
    return {"plan": response.content}

# 3. 定义条件路由函数
def should_search(state: AgentState) -> Literal["search", "answer"]:
    """根据规划结果决定是否需要搜索"""
    if "[SEARCH]" in state["plan"]:
        return "search"
    return "answer"

def should_revise(state: AgentState) -> Literal["planner", "__end__"]:
    """根据审核结果决定是否需要重做"""
    if "REVISE" in state["plan"] and state["iteration"] < 3:
        return "planner"
    return "__end__"

# 4. 构建图
graph = StateGraph(AgentState)

# 添加节点
graph.add_node("planner", planner_node)
graph.add_node("search", search_node)
graph.add_node("answer", answer_node)
graph.add_node("reviewer", reviewer_node)

# 添加边（包括条件路由）
graph.add_edge(START, "planner")
graph.add_conditional_edges("planner", should_search, {
    "search": "search",
    "answer": "answer"
})
graph.add_edge("search", "answer")
graph.add_edge("answer", "reviewer")
graph.add_conditional_edges("reviewer", should_revise, {
    "planner": "planner",
    "__end__": END
})

# 5. 编译图
app = graph.compile()

# 6. 执行
result = app.invoke({
    "query": "2026年最值得关注的AI Agent框架有哪些？",
    "messages": [],
    "plan": "",
    "search_results": "",
    "answer": "",
    "iteration": 0
})
print(result["answer"])
```

### 3.3 Checkpoint 持久化

LangGraph 的杀手级特性是内置 checkpoint 支持，允许工作流在任意节点暂停和恢复：

```python
from langgraph.checkpoint.memory import MemorySaver
import sqlite3

# 方式1：内存 checkpoint（开发/测试用）
checkpointer = MemorySaver()

# 方式2：SQLite checkpoint（生产环境轻量级）
from langgraph.checkpoint.sqlite import SqliteSaver
conn = sqlite3.connect("checkpoints.db", check_same_factory=sqlite3.Connection)
checkpointer = SqliteSaver(conn)

# 编译时注入 checkpointer
app = graph.compile(checkpointer=checkpointer)

# 执行时指定 thread_id（会话标识）
config = {"configurable": {"thread_id": "user-session-001"}}
result = app.invoke({"query": "你好", "messages": [], ...}, config=config)

# 稍后可以从断点恢复执行
state = app.get_state(config)
print(state.values)  # 查看当前状态
print(state.next)    # 查看下一步要执行的节点
```

### 3.4 人工介入（Human-in-the-Loop）

```python
from langgraph.types import interrupt, Command

def human_review_node(state: AgentState) -> dict:
    """人工审核节点：暂停执行等待人类确认"""
    human_feedback = interrupt({
        "question": "请审核以下回答是否准确：",
        "answer": state["answer"]
    })
    # 当恢复执行时，human_feedback 包含人类输入
    if human_feedback.get("approved"):
        return {"answer": state["answer"]}
    else:
        return {"answer": human_feedback.get("revised_answer", state["answer"])}

# 在图中插入人工审核节点
graph.add_node("human_review", human_review_node)
graph.add_edge("answer", "human_review")
graph.add_edge("human_review", "reviewer")
```

---

## 四、LangChain LCEL 实战：链式管道编排

LCEL（LangChain Expression Language）是 LangChain 的声明式链式编排语言，使用 `|` 管道运算符组合 Runnable 组件。

### 4.1 基础链式编排

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableLambda

# 1. 最简单的 LCEL 链
prompt = ChatPromptTemplate.from_template(
    "你是一个技术专家。请用中文简洁地回答：{question}"
)
llm = ChatOpenAI(model="gpt-4o", temperature=0)
parser = StrOutputParser()

chain = prompt | llm | parser
result = chain.invoke({"question": "什么是 RAG？"})
print(result)
```

### 4.2 Branch 与 Fallback

```python
from langchain_core.runnables import RunnableBranch, RunnableParallel

# 分支路由：根据输入长度选择不同处理方式
def classify_complexity(input_dict):
    query = input_dict["question"]
    if len(query) > 200:
        return "complex"
    return "simple"

branch = RunnableBranch(
    # (条件函数, 处理链) 的元组列表
    (
        lambda x: classify_complexity(x) == "complex",
        ChatPromptTemplate.from_template(
            "你是一个高级分析师。请对以下复杂问题进行深度分析，分步骤回答：\n{question}"
        ) | llm | parser
    ),
    # 默认分支（最后一个参数，无条件）
    ChatPromptTemplate.from_template(
        "简洁回答：{question}"
    ) | llm | parser
)

result = branch.invoke({"question": "请详细分析2026年AI Agent市场的技术栈演变趋势"})
print(result)
```

```python
# Fallback 机制：主模型失败时切换备用模型
primary_llm = ChatOpenAI(model="gpt-4o", temperature=0)
backup_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

chain_with_fallback = (prompt | primary_llm | parser).with_fallbacks(
    [prompt | backup_llm | parser],
    exceptions_to_handle=(Exception,)
)
```

### 4.3 并行执行

```python
# 并行执行多个处理链，合并结果
parallel = RunnableParallel(
    summary=ChatPromptTemplate.from_template("总结以下文本：{text}") | llm | parser,
    keywords=ChatPromptTemplate.from_template("提取以下文本的关键词：{text}") | llm | parser,
    sentiment=ChatPromptTemplate.from_template("分析以下文本的情感倾向：{text}") | llm | parser,
)

result = parallel.invoke({"text": "LangGraph 在生产环境中的表现令人惊喜..."})
print(result)  # {"summary": "...", "keywords": "...", "sentiment": "..."}
```

### 4.4 LCEL vs LangGraph 对比

| 特性 | LCEL | LangGraph |
|------|------|-----------|
| 编排模型 | DAG（管道） | 状态机（图） |
| 状态管理 | 无内置状态 | TypedDict 全局状态 |
| 条件路由 | `RunnableBranch` | `add_conditional_edges` |
| 并行执行 | `RunnableParallel` | 多节点并行 |
| 循环 | 不支持 | 原生支持 |
| 持久化 | 无内置 | Checkpoint 内置 |
| 人工介入 | 无内置 | `interrupt()` 原生支持 |
| 适用场景 | 简单管道、RAG | 复杂 Agent、多轮对话 |

**结论**：LCEL 适合线性或轻度分支的管道，LangGraph 适合需要状态、循环、持久化的复杂 Agent。

---

## 五、LlamaIndex Workflow 实战：事件驱动编排

LlamaIndex 0.10+ 引入了全新的 Workflow 抽象，采用事件驱动模式，特别适合复杂的多步骤 Agent 编排。

### 5.1 安装

```bash
pip install llama-index-core llama-index-llms-openai
```

### 5.2 基础 Workflow

```python
from llama_index.core.workflow import (
    Workflow, step, StartEvent, StopEvent, Context,
    Event
)
from llama_index.llms.openai import OpenAI

# 自定义事件类型
class QueryAnalysisEvent(Event):
    query: str
    needs_search: bool
    plan: str

class SearchResultEvent(Event):
    results: str

class DraftAnswerEvent(Event):
    draft: str

class ReviewEvent(Event):
    approved: bool
    feedback: str

# 定义 Workflow
class RAGAgentWorkflow(Workflow):
    """基于事件驱动的 RAG Agent 工作流"""
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.llm = OpenAI(model="gpt-4o", temperature=0)
    
    @step
    async def analyze_query(
        self, ctx: Context, ev: StartEvent
    ) -> QueryAnalysisEvent:
        """步骤1：分析查询，决定是否需要搜索"""
        query = ev.input
        response = await self.llm.acomplete(
            f"分析以下查询，判断是否需要外部搜索。"
            f"回复格式：NEED_SEARCH 或 DIRECT\n查询：{query}"
        )
        needs_search = "NEED_SEARCH" in str(response)
        
        # 在 Context 中存储中间状态
        await ctx.set("query", query)
        await ctx.set("iteration", 0)
        
        return QueryAnalysisEvent(
            query=query,
            needs_search=needs_search,
            plan=str(response)
        )
    
    @step
    async def search(
        self, ctx: Context, ev: QueryAnalysisEvent
    ) -> SearchResultEvent | DraftAnswerEvent:
        """步骤2a：执行搜索（条件执行）"""
        if not ev.needs_search:
            # 跳过搜索，直接生成答案
            return DraftAnswerEvent(draft="")
        
        # 模拟搜索
        results = f"搜索 '{ev.query}' 的结果：AI Agent 技术正在快速发展..."
        await ctx.set("search_results", results)
        return SearchResultEvent(results=results)
    
    @step
    async def draft_answer(
        self, ctx: Context, 
        ev: SearchResultEvent | DraftAnswerEvent
    ) -> DraftAnswerEvent:
        """步骤3：生成答案草稿"""
        query = await ctx.get("query")
        search_results = ""
        
        if isinstance(ev, SearchResultEvent):
            search_results = ev.results
        
        prompt = f"问题：{query}\n"
        if search_results:
            prompt += f"参考资料：{search_results}\n"
        prompt += "请给出详细回答。"
        
        response = await self.llm.acomplete(prompt)
        return DraftAnswerEvent(draft=str(response))
    
    @step
    async def review(
        self, ctx: Context, ev: DraftAnswerEvent
    ) -> StopEvent:
        """步骤4：审核答案"""
        query = await ctx.get("query")
        response = await self.llm.acomplete(
            f"审核以下答案的质量，回复 APPROVE 或 REVISE\n"
            f"问题：{query}\n答案：{ev.draft}"
        )
        
        approved = "APPROVE" in str(response)
        return StopEvent(result={
            "answer": ev.draft,
            "approved": approved,
            "review": str(response)
        })

# 运行 Workflow
import asyncio

async def main():
    workflow = RAGAgentWorkflow(timeout=60, verbose=True)
    result = workflow.run(input="2026年最值得学习的AI Agent框架有哪些？")
    # workflow.run 返回一个协程，需要 await
    # 但在同步上下文中可以直接使用
    print(result)

# asyncio.run(main())
```

### 5.3 Context 共享状态管理

LlamaIndex Workflow 的 `Context` 提供了类型安全的共享状态管理：

```python
@step
async def advanced_analyzer(self, ctx: Context, ev: StartEvent) -> SomeEvent:
    # Context 支持多种数据类型
    await ctx.set("user_id", "user-123")
    await ctx.set("conversation_history", [])
    await ctx.set("config", {"max_iterations": 5, "temperature": 0.7})
    
    # 读取时支持默认值
    max_iter = await ctx.get("config", default={}).get("max_iterations", 3)
    
    # 支持收集多个事件
    # ctx.collect_events(ev, [EventType1, EventType2]) 
    # 当所有指定类型的事件都到达后才继续
```

### 5.4 与 Streaming 集成

```python
@step
async def streaming_answer(self, ctx: Context, ev: DraftAnswerEvent) -> StopEvent:
    """支持流式输出"""
    query = await ctx.get("query")
    
    # 流式生成
    response = ""
    async for chunk in await self.llm.astream_complete(f"回答：{query}"):
        response += str(chunk)
        # 可以通过 ctx.write_event_to_stream() 实时推送
        ctx.write_event_to_stream(Event(message=str(chunk)))
    
    return StopEvent(result=response)
```

---

## 六、三者横向对比

### 6.1 核心对比表

| 维度 | LangGraph | LangChain LCEL | LlamaIndex Workflow |
|------|-----------|----------------|---------------------|
| **编排模型** | 状态机（有向图） | DAG（管道链） | 事件驱动（发布/订阅） |
| **DSL 表达力** | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| **状态管理** | TypedDict 全局状态 | 无内置（需手动传递） | Context 类型安全状态 |
| **条件路由** | `add_conditional_edges` | `RunnableBranch` | 步骤内 `if/else` + 事件类型 |
| **循环支持** | ✅ 原生 | ❌ 不支持 | ✅ 通过事件回环 |
| **并行执行** | ✅ Fan-out/Fan-in | ✅ `RunnableParallel` | ✅ 多步骤并发 |
| **持久化** | ✅ Checkpoint 内置 | ❌ 需自行实现 | ❌ 需自行实现 |
| **人工介入** | ✅ `interrupt()` 原生 | ❌ 不支持 | ⚠️ 需手动实现 |
| **流式输出** | ✅ `stream()` | ✅ `stream()` | ✅ `astream` |
| **可观测性** | LangSmith 深度集成 | LangSmith 集成 | LlamaTrace 集成 |
| **学习曲线** | ★★★★☆（陡峭） | ★★☆☆☆（平缓） | ★★★☆☆（中等） |
| **文档质量** | ★★★★☆ | ★★★★★ | ★★★☆☆ |
| **生产就绪度** | ★★★★★ | ★★★★☆ | ★★★★☆ |
| **社区活跃度** | ★★★★★ | ★★★★★ | ★★★★☆ |
| **GitHub Stars** | ~15k | ~100k+ | ~40k+ |
| **适合场景** | 复杂 Agent、多轮对话 | 简单管道、RAG | RAG 优先、知识密集型 |

### 6.2 选型建议

- **选 LangGraph**：如果你的 Agent 需要复杂的状态管理、循环决策、人工审核、持久化恢复——这是当前最成熟的选择
- **选 LCEL**：如果你只是需要简单的 prompt → LLM → parser 管道，或者已经在 LangChain 生态中
- **选 LlamaIndex Workflow**：如果你的核心场景是 RAG/知识检索，且偏好事件驱动的解耦架构

---

## 七、YAML/JSON 通用 DSL 层设计

在实际项目中，我们可能需要同时支持多个框架，或者让非开发者（如产品经理）能够定义工作流。这时就需要一个统一的 DSL 抽象层。

### 7.1 DSL Schema 设计

```yaml
# workflow.yaml - 统一 DSL 格式
metadata:
  name: "customer-support-agent"
  version: "1.0.0"
  description: "客服 Agent 工作流"
  target_runtime: langgraph  # langgraph | langchain | llamaindex

config:
  llm:
    provider: openai
    model: gpt-4o
    temperature: 0
  max_iterations: 5
  timeout: 120

nodes:
  - id: classifier
    type: llm
    prompt: |
      分类客户问题类型。回复：BILLING | TECHNICAL | GENERAL
      问题：{{input.query}}
    output_key: category

  - id: billing_handler
    type: llm
    prompt: |
      你是账单专家。客户问题：{{input.query}}
      分类结果：{{classifier.output}}
    condition: "{{classifier.output}} == 'BILLING'"

  - id: tech_handler
    type: tool
    tool: knowledge_base_search
    args:
      query: "{{input.query}}"
      collection: "tech_docs"
    condition: "{{classifier.output}} == 'TECHNICAL'"

  - id: tech_answer
    type: llm
    prompt: |
      根据技术文档回答客户问题。
      问题：{{input.query}}
      文档：{{tech_handler.output}}

  - id: general_handler
    type: llm
    prompt: "友好地回答：{{input.query}}"
    condition: "{{classifier.output}} == 'GENERAL'"

  - id: reviewer
    type: llm
    prompt: |
      审核回答质量。
      问题：{{input.query}}
      回答：{{current_answer}}
    output_key: review_result

edges:
  - from: __start__
    to: classifier
  - from: classifier
    to: [billing_handler, tech_handler, general_handler]
    routing: conditional
  - from: billing_handler
    to: reviewer
  - from: tech_handler
    to: tech_answer
  - from: tech_answer
    to: reviewer
  - from: general_handler
    to: reviewer
  - from: reviewer
    to: __end__

hooks:
  on_error:
    action: retry
    max_retries: 2
  on_timeout:
    action: fallback
    fallback_node: general_handler
```

### 7.2 DSL 解析器实现

```python
"""
dsl_engine.py - YAML DSL 解析与多框架驱动引擎
"""
import yaml
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod


class RuntimeType(Enum):
    LANGGRAPH = "langgraph"
    LANGCHAIN = "langchain"
    LLAMAINDEX = "llamaindex"


@dataclass
class NodeConfig:
    id: str
    type: str  # llm, tool, code, human
    prompt: Optional[str] = None
    tool: Optional[str] = None
    args: Dict[str, Any] = field(default_factory=dict)
    condition: Optional[str] = None
    output_key: Optional[str] = None


@dataclass
class EdgeConfig:
    from_node: str
    to_nodes: List[str]
    routing: str = "direct"  # direct, conditional


@dataclass
class WorkflowDSL:
    name: str
    version: str
    target_runtime: RuntimeType
    config: Dict[str, Any]
    nodes: List[NodeConfig]
    edges: List[EdgeConfig]
    hooks: Dict[str, Any]


class DSLParser:
    """解析 YAML DSL 为结构化工作流配置"""
    
    @staticmethod
    def parse(yaml_content: str) -> WorkflowDSL:
        data = yaml.safe_load(yaml_content)
        
        nodes = []
        for n in data.get("nodes", []):
            nodes.append(NodeConfig(
                id=n["id"],
                type=n["type"],
                prompt=n.get("prompt"),
                tool=n.get("tool"),
                args=n.get("args", {}),
                condition=n.get("condition"),
                output_key=n.get("output_key"),
            ))
        
        edges = []
        for e in data.get("edges", []):
            to = e["to"]
            if not isinstance(to, list):
                to = [to]
            edges.append(EdgeConfig(
                from_node=e["from"],
                to_nodes=to,
                routing=e.get("routing", "direct"),
            ))
        
        metadata = data.get("metadata", {})
        return WorkflowDSL(
            name=metadata.get("name", "unnamed"),
            version=metadata.get("version", "0.0.1"),
            target_runtime=RuntimeType(
                metadata.get("target_runtime", "langgraph")
            ),
            config=data.get("config", {}),
            nodes=nodes,
            edges=edges,
            hooks=data.get("hooks", {}),
        )


class BaseCompiler(ABC):
    """DSL 编译器基类"""
    
    @abstractmethod
    def compile(self, dsl: WorkflowDSL) -> Any:
        """将 DSL 编译为可执行的工作流"""
        pass


class LangGraphCompiler(BaseCompiler):
    """将 DSL 编译为 LangGraph StateGraph"""
    
    def compile(self, dsl: WorkflowDSL):
        from langgraph.graph import StateGraph, START, END
        
        class State(dict):
            pass
        
        graph = StateGraph(State)
        
        # 为每个节点生成执行函数
        for node in dsl.nodes:
            node_config = node  # 捕获闭包
            def make_node(nc: NodeConfig):
                def node_fn(state: dict) -> dict:
                    # 模板渲染（简化版，生产环境用 Jinja2）
                    prompt = nc.prompt or ""
                    for key, value in state.items():
                        if isinstance(value, str):
                            prompt = prompt.replace(f"{{{{{key}}}}}", value)
                    
                    if nc.type == "llm":
                        # 调用 LLM
                        from langchain_openai import ChatOpenAI
                        from langchain_core.messages import HumanMessage
                        llm = ChatOpenAI(
                            model=dsl.config.get("llm", {}).get("model", "gpt-4o-mini")
                        )
                        response = llm.invoke([HumanMessage(content=prompt)])
                        output_key = nc.output_key or f"{nc.id}_output"
                        return {output_key: response.content}
                    
                    return {}
                return node_fn
            
            graph.add_node(node.id, make_node(node_config))
        
        # 构建边
        for edge in dsl.edges:
            from_node = edge.from_node
            to_nodes = edge.to_nodes
            
            if from_node == "__start__":
                graph.add_edge(START, to_nodes[0])
            elif to_nodes[0] == "__end__":
                graph.add_edge(from_node, END)
            else:
                graph.add_edge(from_node, to_nodes[0])
        
        return graph.compile()


# 使用示例
def run_dsl_workflow(yaml_path: str, input_data: dict):
    """加载 YAML DSL 并执行工作流"""
    with open(yaml_path, "r", encoding="utf-8") as f:
        yaml_content = f.read()
    
    dsl = DSLParser.parse(yaml_content)
    print(f"加载工作流: {dsl.name} v{dsl.version}")
    print(f"目标运行时: {dsl.target_runtime.value}")
    print(f"节点数量: {len(dsl.nodes)}")
    
    if dsl.target_runtime == RuntimeType.LANGGRAPH:
        compiler = LangGraphCompiler()
        app = compiler.compile(dsl)
        result = app.invoke(input_data)
        return result
    
    raise ValueError(f"不支持的运行时: {dsl.target_runtime}")


if __name__ == "__main__":
    # 示例运行
    dsl = DSLParser.parse(open("workflow.yaml").read())
    print(f"Parsed: {dsl.name}, {len(dsl.nodes)} nodes, {len(dsl.edges)} edges")
```

### 7.3 JSON Schema 校验

为了确保 DSL 的正确性，建议添加 JSON Schema 校验：

```python
import jsonschema

WORKFLOW_SCHEMA = {
    "type": "object",
    "required": ["metadata", "nodes", "edges"],
    "properties": {
        "metadata": {
            "type": "object",
            "required": ["name", "version"],
            "properties": {
                "name": {"type": "string"},
                "version": {"type": "string", "pattern": r"^\d+\.\d+\.\d+$"},
                "target_runtime": {
                    "type": "string",
                    "enum": ["langgraph", "langchain", "llamaindex"]
                }
            }
        },
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "type"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string", "enum": ["llm", "tool", "code", "human"]},
                    "prompt": {"type": "string"},
                    "tool": {"type": "string"},
                    "condition": {"type": "string"},
                    "output_key": {"type": "string"}
                }
            }
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["from", "to"],
                "properties": {
                    "from": {"type": "string"},
                    "to": {
                        "oneOf": [
                            {"type": "string"},
                            {"type": "array", "items": {"type": "string"}}
                        ]
                    },
                    "routing": {"type": "string", "enum": ["direct", "conditional"]}
                }
            }
        }
    }
}

def validate_dsl(yaml_data: dict) -> list:
    """校验 DSL 配置是否符合 Schema"""
    validator = jsonschema.Draft7Validator(WORKFLOW_SCHEMA)
    errors = list(validator.iter_errors(yaml_data))
    return [f"{' → '.join(str(p) for p in e.absolute_path)}: {e.message}" for e in errors]
```

---

## 八、与 Laravel 集成方案

在实际项目中，后端通常使用 PHP/Laravel，而 AI Agent 工作流运行在 Python 环境中。以下是两种主流集成方案。

### 8.1 方案一：FastAPI HTTP API

```python
# agent_api.py - FastAPI 服务
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import uuid

app = FastAPI(title="AI Agent Workflow API")

class WorkflowRequest(BaseModel):
    workflow_id: str  # 对应 DSL 文件名
    input_data: dict
    callback_url: Optional[str] = None  # Laravel 回调地址

class WorkflowResponse(BaseModel):
    task_id: str
    status: str  # pending, running, completed, failed
    result: Optional[dict] = None

# 任务存储（生产环境用 Redis/数据库）
tasks: dict[str, WorkflowResponse] = {}

@app.post("/api/workflows/run", response_model=WorkflowResponse)
async def run_workflow(req: WorkflowRequest, bg: BackgroundTasks):
    task_id = str(uuid.uuid4())
    tasks[task_id] = WorkflowResponse(task_id=task_id, status="pending")
    
    async def execute():
        tasks[task_id].status = "running"
        try:
            yaml_path = f"workflows/{req.workflow_id}.yaml"
            result = run_dsl_workflow(yaml_path, req.input_data)
            tasks[task_id].status = "completed"
            tasks[task_id].result = result
            
            # 如果提供了回调地址，通知 Laravel
            if req.callback_url:
                import httpx
                async with httpx.AsyncClient() as client:
                    await client.post(req.callback_url, json={
                        "task_id": task_id,
                        "status": "completed",
                        "result": result
                    })
        except Exception as e:
            tasks[task_id].status = "failed"
            tasks[task_id].result = {"error": str(e)}
    
    bg.add_task(execute)
    return tasks[task_id]

@app.get("/api/workflows/{task_id}/status")
async def get_status(task_id: str):
    if task_id not in tasks:
        return {"error": "Task not found"}, 404
    return tasks[task_id]
```

### 8.2 Laravel 端集成

```php
<?php
// app/Services/AiAgentService.php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class AiAgentService
{
    protected string $agentApiUrl;
    
    public function __construct()
    {
        $this->agentApiUrl = config('services.agent_api.url', 'http://localhost:8000');
    }
    
    /**
     * 异步执行 Agent 工作流
     */
    public function runWorkflow(string $workflowId, array $inputData): array
    {
        $response = Http::timeout(10)->post("{$this->agentApiUrl}/api/workflows/run", [
            'workflow_id' => $workflowId,
            'input_data' => $inputData,
            'callback_url' => route('api.agent.callback'),
        ]);
        
        $data = $response->json();
        
        // 缓存任务状态
        Cache::put("agent_task:{$data['task_id']}", $data, 3600);
        
        return $data;
    }
    
    /**
     * 同步执行 Agent 工作流（轮询等待结果）
     */
    public function runWorkflowSync(string $workflowId, array $inputData, int $timeout = 120): array
    {
        $taskData = $this->runWorkflow($workflowId, $inputData);
        $taskId = $taskData['task_id'];
        
        $start = time();
        while (time() - $start < $timeout) {
            $status = $this->getTaskStatus($taskId);
            
            if ($status['status'] === 'completed') {
                return $status['result'];
            }
            
            if ($status['status'] === 'failed') {
                throw new \RuntimeException(
                    "Agent workflow failed: " . ($status['result']['error'] ?? 'Unknown error')
                );
            }
            
            usleep(500000); // 500ms
        }
        
        throw new \RuntimeException("Agent workflow timeout after {$timeout}s");
    }
    
    /**
     * 查询任务状态
     */
    public function getTaskStatus(string $taskId): array
    {
        $response = Http::get("{$this->agentApiUrl}/api/workflows/{$taskId}/status");
        return $response->json();
    }
}
```

```php
<?php
// routes/api.php
use App\Http\Controllers\AgentCallbackController;

Route::post('/agent/callback', [AgentCallbackController::class, 'handle'])
    ->name('api.agent.callback');
```

```php
<?php
// app/Http/Controllers/AgentCallbackController.php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class AgentCallbackController extends Controller
{
    public function handle(Request $request)
    {
        $taskId = $request->input('task_id');
        $status = $request->input('status');
        $result = $request->input('result');
        
        Log::info("Agent callback received", [
            'task_id' => $taskId,
            'status' => $status,
        ]);
        
        // 更新缓存
        Cache::put("agent_task:{$taskId}", [
            'task_id' => $taskId,
            'status' => $status,
            'result' => $result,
        ], 3600);
        
        // 触发业务逻辑（如发送通知、更新数据库等）
        // event(new AgentWorkflowCompleted($taskId, $result));
        
        return response()->json(['ok' => true]);
    }
}
```

### 8.3 方案二：Python Subprocess 调用

对于简单场景，可以直接通过 Laravel 的 `Process` facade 调用 Python 脚本：

```php
<?php
// app/Services/AiAgentLocalService.php

namespace App\Services;

use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Log;

class AiAgentLocalService
{
    protected string $pythonPath;
    protected string $scriptPath;
    
    public function __construct()
    {
        $this->pythonPath = config('services.agent.python_path', '/usr/bin/python3');
        $this->scriptPath = base_path('python/agent_runner.py');
    }
    
    /**
     * 通过 subprocess 执行 Python Agent 工作流
     */
    public function run(string $workflowId, array $input): array
    {
        $inputJson = json_encode($input, JSON_UNESCAPED_UNICODE);
        
        $result = Process::timeout(120)->run(
            "{$this->pythonPath} {$this->scriptPath} --workflow {$workflowId} --input '" . 
            addslashes($inputJson) . "'"
        );
        
        if ($result->failed()) {
            Log::error("Agent subprocess failed", [
                'stderr' => $result->errorOutput(),
                'exit_code' => $result->exitCode(),
            ]);
            throw new \RuntimeException("Agent execution failed: " . $result->errorOutput());
        }
        
        $output = json_decode($result->output(), true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return ['raw_output' => $result->output()];
        }
        
        return $output;
    }
}
```

```python
# python/agent_runner.py
"""
命令行 Agent 工作流执行器，供 Laravel subprocess 调用
"""
import argparse
import json
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(__file__))

from dsl_engine import DSLParser, LangGraphCompiler


def main():
    parser = argparse.ArgumentParser(description="AI Agent Workflow Runner")
    parser.add_argument("--workflow", required=True, help="Workflow ID")
    parser.add_argument("--input", required=True, help="JSON input data")
    args = parser.parse_args()
    
    try:
        input_data = json.loads(args.input)
        yaml_path = f"workflows/{args.workflow}.yaml"
        
        with open(yaml_path, "r", encoding="utf-8") as f:
            dsl = DSLParser.parse(f.read())
        
        compiler = LangGraphCompiler()
        app = compiler.compile(dsl)
        result = app.invoke(input_data)
        
        print(json.dumps(result, ensure_ascii=False, default=str))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

---

## 九、最佳实践与陷阱

### 9.1 最佳实践

**1. 状态设计原则**

```python
# ✅ 好的状态设计：扁平、类型明确
class GoodState(TypedDict):
    query: str
    category: str
    search_results: list[str]
    answer: str
    iteration: int

# ❌ 坏的状态设计：嵌套、类型模糊
class BadState(TypedDict):
    data: dict  # 里面什么都往塞
    metadata: dict
    results: list  # 列表里混杂不同类型的对象
```

**2. 节点单一职责**

每个节点应该只做一件事，便于测试和复用：

```python
# ✅ 拆分为独立节点
def extract_keywords(state): ...   # 仅提取关键词
def search_by_keywords(state): ... # 仅执行搜索
def synthesize(state): ...         # 仅合成答案

# ❌ 一个节点包揽一切
def do_everything(state):
    keywords = extract(state["query"])
    results = search(keywords)
    answer = synthesize(results)
    return {"answer": answer}
```

**3. 错误处理与重试**

```python
from langgraph.graph import StateGraph

def robust_node(state):
    try:
        result = risky_llm_call(state["query"])
        return {"result": result, "error": None}
    except Exception as e:
        return {"result": None, "error": str(e)}

def handle_error(state) -> str:
    if state.get("error"):
        if state.get("retry_count", 0) < 3:
            return "retry"
        return "fallback"
    return "continue"

graph.add_node("main", robust_node)
graph.add_node("error_handler", lambda s: {"retry_count": s.get("retry_count", 0) + 1})
graph.add_conditional_edges("main", handle_error, {
    "continue": "next_node",
    "retry": "main",
    "fallback": "fallback_node"
})
```

**4. 可观测性**

```python
# 使用 LangSmith 追踪（所有三个框架都支持）
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "lsv2-xxx"
os.environ["LANGCHAIN_PROJECT"] = "my-agent-project"

# 每次执行自动上报 trace 到 LangSmith dashboard
```

### 9.2 常见陷阱

**陷阱 1：过度工程化**

```yaml
# ❌ 对于简单问答，不需要复杂的 DSL
nodes:
  - id: classify
    type: llm
    prompt: "分类..."
  - id: route_a
    type: llm
    prompt: "处理A..."
  # ... 10 个节点

# ✅ 简单场景直接用 LCEL 链
# prompt | llm | parser
```

**陷阱 2：状态污染**

```python
# ❌ 在节点中直接修改状态（LangGraph 中会导致不可预测行为）
def bad_node(state):
    state["messages"].append(new_msg)  # 直接修改！
    return state

# ✅ 返回部分更新，让框架合并
def good_node(state):
    return {"messages": [new_msg]}  # 返回增量
```

**陷阱 3：无限循环**

```python
# ❌ 没有最大迭代保护
def should_continue(state):
    return "loop"  # 永远循环

# ✅ 总是设置上限
def should_continue(state):
    if state["iteration"] > MAX_ITERATIONS:
        return "end"
    return "loop"
```

**陷阱 4：忽略 Token 成本**

```python
# ❌ 每个节点都传入完整历史
def node_a(state):
    full_history = "\n".join(m.content for m in state["messages"])
    return llm.invoke(f"处理：{full_history}")  # Token 爆炸

# ✅ 只传入必要上下文
def node_a(state):
    last_message = state["messages"][-1].content
    relevant_context = state.get("search_results", "")
    return llm.invoke(f"处理：{last_message}\n参考：{relevant_context}")
```

**陷阱 5：单点故障**

不要让整个工作流依赖单一 LLM 调用。使用 fallback 机制：

```python
primary = ChatOpenAI(model="gpt-4o")
fallback = ChatOpenAI(model="gpt-4o-mini")
local = ChatOllama(model="llama3.1")  # 本地兜底

chain = (prompt | primary | parser).with_fallbacks([
    prompt | fallback | parser,
    prompt | local | parser,
])
```

---

## 十、总结

### 10.1 核心要点

1. **声明式 DSL 是 Agent 工作流的未来**：它将业务逻辑从代码中解耦，带来可观测性、可维护性和协作效率的全面提升

2. **三大框架各有定位**：
   - LangGraph 是状态机之王，适合复杂、有状态、需要人工介入的 Agent
   - LangChain LCEL 是管道专家，适合简单、线性的 RAG 管道
   - LlamaIndex Workflow 是事件驱动先锋，适合知识密集型、多步骤的检索增强场景

3. **统一 DSL 层是可实现的**：通过 YAML/JSON 定义工作流，配合解析器和编译器，可以将同一份 DSL 部署到不同的运行时

4. **与 Laravel 集成并不复杂**：FastAPI + HTTP 回调是最稳健的方案，subprocess 适合轻量场景

### 10.2 技术演进展望

- **2025—2026 趋势**：Agent 框架正在从"工具库"演进为"运行时平台"，LangGraph Platform 和 LlamaIndex Deployments 都在向这个方向发展
- **MCP 协议**：Model Context Protocol 的标准化将进一步推动 Agent 工具生态的互通
- **自适应工作流**：未来的 DSL 可能会支持 LLM 自主修改工作流结构（meta-agent），而非仅执行预定义流程

### 10.3 快速决策指南

```
你需要循环/状态/持久化吗？
├── 是 → 你需要人工介入吗？
│       ├── 是 → LangGraph
│       └── 否 → LangGraph（推荐）或 LlamaIndex Workflow
└── 否 → 你的核心场景是 RAG 吗？
        ├── 是 → LlamaIndex Workflow 或 LCEL
        └── 否 → LCEL（最简单）
```

无论选择哪个框架，**尽早引入声明式 DSL**，你的 Agent 工作流将受益于更好的可维护性、可观测性和团队协作效率。建议从 LangGraph 起步，它在 2026 年已经是事实上的 Agent 编排标准。

---

*本文代码示例基于 LangGraph 0.2+、LangChain 0.3+、LlamaIndex 0.11+，运行前请确保版本兼容。完整代码仓库见 [GitHub](https://github.com/mikeah2011/agent-workflow-dsl-examples)。*

---

## 相关阅读

- [OpenHuman vs Hermes vs OpenClaw：三大开源 AI Agent 框架深度对比](/categories/架构/OpenHuman-vs-Hermes-vs-OpenClaw-三大开源AI-Agent框架深度对比/)
- [Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测](/categories/架构/Hermes-MCP-集成架构-动态工具发现-stdio-SSE-HTTP传输-prompt-injection检测/)
- [AI Agent with Code Interpreter 实战：沙箱化代码执行——Docker/Firecracker 方案](/categories/架构/ai-agent-code-interpreter-sandboxed-execution/)
