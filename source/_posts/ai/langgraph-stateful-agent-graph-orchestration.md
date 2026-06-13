---
title: LangGraph 实战：有状态的 AI Agent 图编排——条件路由、循环与人机协作节点
date: 2026-06-02 00:00:00
tags: [LangGraph, AI Agent, 图编排, 有状态, 人机协作]
keywords: [LangGraph, AI Agent, 有状态的, 图编排, 条件路由, 循环与人机协作节点, AI]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: "LangGraph是LangChain生态中专为有状态AI Agent设计的图编排框架。本文通过构建完整的多步研究Agent实战案例，深入讲解StateGraph核心概念、条件路由与循环机制、interrupt_before人机协作节点、MemorySaver状态持久化、LLM动态分支路由、自我反思循环与渐进退出策略，含vs AutoGen/CrewAI对比和图可视化，适合需要构建复杂Agent工作流的开发者。"
---


# LangGraph 实战：有状态的 AI Agent 图编排——条件路由、循环与人机协作节点

## 前言

在构建 AI Agent 的过程中，我们很快就会遇到一个核心瓶颈：**链式调用（Chain）的局限性**。

当你尝试用简单的 LLMChain 或 SequentialChain 构建一个需要多步推理、有条件分支、甚至需要人工介入的 Agent 时，代码会迅速变成一团乱麻。你开始用 `if-else` 嵌套处理条件逻辑，用 `while` 循环实现重试，用全局变量维护状态——最终你发现自己在用命令式编程的方式去模拟一个本质上是图（Graph）结构的工作流。

**LangGraph** 正是为了解决这个问题而生的。它是 LangChain 生态中专门用于构建有状态、多步骤 AI Agent 的编排框架，将工作流建模为一个**有向图（Directed Graph）**，其中节点是计算单元，边是流转逻辑，状态在节点之间持久传递。

本文将从实际生产场景出发，深入讲解 LangGraph 的核心概念，并通过一个完整的多步研究 Agent 实战案例，展示条件路由、循环、人机协作节点和状态持久化等高级特性。

---

## 一、为什么需要图编排？从链式调用到状态图的演进

### 1.1 链式调用的局限

传统的 LangChain Chain 模式是线性的：

```
Input → Prompt → LLM → Output Parser → Result
```

这种模式在处理简单任务时非常高效，但面对以下场景时就力不从心：

**场景一：条件分支**
```
用户输入 → 分类器 → [技术问题] → 技术专家 Agent
                      → [商务问题] → 商务专家 Agent  
                      → [投诉] → 客服 Agent
```

**场景二：自我反思循环**
```
用户输入 → 研究 Agent → 输出初稿 → 评审 Agent → [不通过] → 修改 → 评审 → [通过] → 最终输出
```

**场景三：多工具协调**
```
用户提问 → 搜索工具 → 分析结果 → [信息不足] → 继续搜索 → [信息充足] → 生成报告
```

用 Chain 实现这些场景，你需要大量的自定义逻辑来处理条件、循环和状态管理，代码可读性和可维护性都会急剧下降。

### 1.2 图编排的优势

将工作流建模为图结构后：

- **节点（Node）**：每个节点是一个独立的计算单元（LLM 调用、工具执行、数据处理等）
- **边（Edge）**：定义节点之间的流转逻辑，支持条件分支
- **状态（State）**：在节点之间传递的共享数据结构，是 Agent 的"记忆"
- **循环（Cycle）**：图天然支持循环结构，非常适合重试、反思等场景

与 Chain 对比：

| 特性 | Chain | LangGraph |
|------|-------|-----------|
| 流程类型 | 线性 | 任意图结构 |
| 条件分支 | 需自定义代码 | 原生支持 |
| 循环 | 不支持 | 原生支持 |
| 状态管理 | 隐式（通过 Memory） | 显式（Typed State） |
| 人机协作 | 需要 hack | 原生 interrupt 节点 |
| 可视化 | 不支持 | 图结构可视化 |
| 持久化 | 需额外实现 | 内置 Checkpoint |

### 1.3 LangGraph 在 Agent 框架中的定位

```
┌─────────────────────────────────────────────┐
│           AI Agent 技术栈                    │
│                                             │
│  ┌───────────────┐  ┌────────────────────┐  │
│  │  应用层框架     │  │  LangGraph          │  │
│  │  AutoGen       │  │  Agent 编排          │  │
│  │  CrewAI        │  │  有状态图            │  │
│  │  MetaGPT       │  │  条件路由            │  │
│  │  AgentScope    │  │  人机协作            │  │
│  └───────┬───────┘  └────────┬───────────┘  │
│          │                   │              │
│  ┌───────┴───────────────────┴───────────┐  │
│  │         LangChain Core                  │  │
│  │  LLM 调用 / Tool / Prompt / Memory      │  │
│  └───────────────────┬───────────────────┘  │
│                      │                      │
│  ┌───────────────────┴───────────────────┐  │
│  │    LangSmith / LangFuse (可观测性)      │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

LangGraph 定位在"Agent 编排层"，专注于解决**有状态、多步骤、有条件**的 Agent 工作流问题。

---

## 二、LangGraph 核心概念

### 2.1 StateGraph 与 State

State 是 LangGraph 的核心——它是图中所有节点共享的数据结构：

```python
from typing import TypedDict, Annotated, Literal
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
import operator

# 定义状态类型
class ResearchState(TypedDict):
    # 消息历史 - 使用 operator.add 来追加而不是覆盖
    messages: Annotated[list[BaseMessage], operator.add]
    # 当前研究主题
    topic: str
    # 搜索结果
    search_results: Annotated[list[str], operator.add]
    # 生成的报告
    report: str
    # 评审结果
    review_feedback: str
    # 迭代次数
    iteration: int
    # 当前阶段
    stage: str
```

**关键设计模式：**

- `Annotated[list, operator.add]` 表示该字段使用**归约操作**——新值会追加到已有列表中，而不是覆盖
- 这是 LangGraph 处理"多节点向同一字段写入"的核心机制
- 常见的归约操作：`operator.add`（列表追加）、`operator.or_`（字典合并）

### 2.2 Node（节点）

节点是图中的计算单元，接收当前 State 并返回部分 State 更新：

```python
# 节点是一个普通函数，接收 state，返回 state 的部分更新
def research_node(state: ResearchState) -> dict:
    """搜索研究节点"""
    topic = state["topic"]
    
    # 调用搜索工具
    results = search_tool.invoke(topic)
    
    # 返回状态的部分更新
    return {
        "search_results": [results],  # 会追加到已有的 search_results
        "iteration": state.get("iteration", 0) + 1,
        "stage": "researched",
    }
```

**节点设计原则：**
- 节点应该是**纯函数**（给定相同输入返回相同输出），便于测试和调试
- 通过返回 dict 来更新状态，不需要返回完整 State
- 可以是 LLM 调用、工具调用、数据处理，甚至是人工审核

### 2.3 Edge（边）与 Conditional Edge（条件边）

**普通边：** 简单的节点连接

```python
# 直接连接
graph.add_edge("node_a", "node_b")

# 结束
graph.add_edge("node_a", END)
```

**条件边：** 根据当前状态决定下一个节点

```python
def should_continue_research(state: ResearchState) -> Literal["research", "write", "end"]:
    """决定是否继续研究"""
    if state["iteration"] >= 5:
        return "write"  # 最多研究5轮
    if len(state["search_results"]) >= 10:
        return "write"  # 搜集够了
    if state.get("review_feedback") and "通过" in state["review_feedback"]:
        return "end"  # 评审通过
    return "research"  # 继续研究

# 添加条件边
graph.add_conditional_edges(
    "evaluator",           # 源节点
    should_continue_research,  # 路由函数
    {
        "research": "researcher",  # 路由映射
        "write": "writer",
        "end": END,
    }
)
```

### 2.4 整体图构建

```python
# 创建 StateGraph
graph = StateGraph(ResearchState)

# 添加节点
graph.add_node("researcher", research_node)
graph.add_node("writer", writer_node)
graph.add_node("evaluator", evaluator_node)

# 设置入口点
graph.set_entry_point("researcher")

# 添加边
graph.add_edge("researcher", "evaluator")
graph.add_conditional_edges(
    "evaluator",
    should_continue_research,
    {
        "research": "researcher",
        "write": "writer",
        "end": END,
    }
)
graph.add_edge("writer", END)

# 编译图
app = graph.compile()
```

---

## 三、实战：构建多步研究 Agent

让我们构建一个完整的多步研究 Agent，它能够：
1. 根据主题搜索相关资料
2. 对搜索结果进行分析和总结
3. 生成研究报告
4. 自动评审报告质量
5. 根据评审反馈修改（循环）
6. 人工最终审核（人机协作节点）

### 3.1 项目结构

```
research-agent/
├── graph.py          # 图定义
├── nodes.py          # 节点实现
├── state.py          # 状态定义
├── tools.py          # 工具定义
├── config.py         # 配置
└── main.py           # 入口
```

### 3.2 状态定义

```python
# state.py
from typing import TypedDict, Annotated, Literal, Optional
from langchain_core.messages import BaseMessage
import operator

class ResearchState(TypedDict):
    """研究 Agent 的完整状态"""
    # 输入
    topic: str
    requirements: str
    
    # 消息历史
    messages: Annotated[list[BaseMessage], operator.add]
    
    # 研究过程
    search_queries: Annotated[list[str], operator.add]
    search_results: Annotated[list[dict], operator.add]
    key_findings: Annotated[list[str], operator.add]
    
    # 写作过程
    outline: str
    draft: str
    final_report: str
    
    # 评审过程
    review_score: int  # 1-10
    review_feedback: str
    needs_revision: bool
    
    # 控制流
    iteration: int
    max_iterations: int
    stage: str  # research, analyze, write, review, revise, human_review, done
    
    # 人机协作
    human_feedback: str
    human_approved: bool
```

### 3.3 工具定义

```python
# tools.py
from langchain_core.tools import tool
from langchain_community.tools import TavilySearchResults

# 搜索工具
search_tool = TavilySearchResults(max_results=5)

@tool
def analyze_findings(findings: list[str]) -> str:
    """分析研究发现，提取关键洞察"""
    # 使用 LLM 分析（简化示例）
    from langchain_openai import ChatOpenAI
    llm = ChatOpenAI(model="gpt-4o")
    
    prompt = f"""分析以下研究发现，提取关键洞察和模式：
    
    {chr(10).join(f'- {f}' for f in findings)}
    
    请返回：
    1. 三个最重要的发现
    2. 发现之间的关联
    3. 需要进一步研究的方向"""
    
    return llm.invoke(prompt).content

@tool  
def generate_outline(topic: str, findings: list[str]) -> str:
    """根据研究发现生成报告大纲"""
    from langchain_openai import ChatOpenAI
    llm = ChatOpenAI(model="gpt-4o")
    
    prompt = f"""根据以下主题和研究发现，生成一份详细的研究报告大纲：
    
    主题：{topic}
    
    研究发现：
    {chr(10).join(f'- {f}' for f in findings)}
    
    请返回一个结构化的大纲。"""
    
    return llm.invoke(prompt).content
```

### 3.4 节点实现

```python
# nodes.py
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from state import ResearchState
from tools import search_tool

llm = ChatOpenAI(model="gpt-4o", temperature=0.7)
planner_llm = ChatOpenAI(model="gpt-4o", temperature=0.3)  # 低温度用于规划

def planner_node(state: ResearchState) -> dict:
    """规划搜索策略"""
    topic = state["topic"]
    existing_queries = state.get("search_queries", [])
    
    prompt = f"""你是一个研究规划专家。
    
    研究主题：{topic}
    要求：{state.get('requirements', '深入全面')}
    已有搜索：{existing_queries}
    
    请生成 2-3 个新的搜索查询，覆盖尚未涉及的方面。
    每个查询应该专注于一个具体的子主题。
    
    返回格式：每行一个查询。"""
    
    response = planner_llm.invoke([HumanMessage(content=prompt)])
    queries = [q.strip() for q in response.content.strip().split('\n') if q.strip()]
    
    return {
        "search_queries": queries,
        "stage": "planning",
        "iteration": state.get("iteration", 0) + 1,
    }

def researcher_node(state: ResearchState) -> dict:
    """执行搜索"""
    queries = state.get("search_queries", [])
    if not queries:
        return {"search_results": [], "stage": "researching"}
    
    # 使用最新的查询进行搜索
    latest_queries = queries[-3:]  # 最多搜3个
    all_results = []
    
    for query in latest_queries:
        try:
            results = search_tool.invoke(query)
            for r in results:
                all_results.append({
                    "query": query,
                    "title": r.get("title", ""),
                    "content": r.get("content", ""),
                    "url": r.get("url", ""),
                })
        except Exception as e:
            print(f"Search failed for '{query}': {e}")
    
    return {
        "search_results": all_results,
        "stage": "researching",
    }

def analyzer_node(state: ResearchState) -> dict:
    """分析搜索结果，提取关键发现"""
    results = state.get("search_results", [])
    if not results:
        return {"key_findings": ["未找到相关信息"], "stage": "analyzing"}
    
    # 合并搜索结果文本
    combined = "\n\n".join([
        f"来源: {r['title']}\n{r['content'][:500]}"
        for r in results[-10:]  # 最多分析最近10条
    ])
    
    prompt = f"""分析以下搜索结果，提取关于"{state['topic']}"的关键发现：

{combined}

请提取 5-8 个关键发现，每个用一句话概括。"""
    
    response = llm.invoke([HumanMessage(content=prompt)])
    findings = [f.strip() for f in response.content.strip().split('\n') if f.strip() and len(f.strip()) > 10]
    
    return {
        "key_findings": findings,
        "stage": "analyzing",
    }

def writer_node(state: ResearchState) -> dict:
    """撰写研究报告"""
    topic = state["topic"]
    findings = state.get("key_findings", [])
    feedback = state.get("review_feedback", "")
    draft = state.get("draft", "")
    
    # 如果有修改反馈，基于反馈修改
    if feedback and draft:
        prompt = f"""你是一个专业的研究报告撰写者。

原始报告：
{draft}

评审反馈：
{feedback}

请根据反馈修改报告，保持专业性和全面性。输出完整的修改后报告。"""
    else:
        prompt = f"""你是一个专业的研究报告撰写者。

研究主题：{topic}

关键发现：
{chr(10).join(f'{i+1}. {f}' for i, f in enumerate(findings))}

请撰写一份结构完整、内容深入的研究报告。要求：
1. 有清晰的引言、主体和结论
2. 每个关键发现都有详细分析
3. 包含实际案例和数据支持
4. 字数 2000-3000 字"""
    
    response = llm.invoke([HumanMessage(content=prompt)])
    
    return {
        "draft": response.content,
        "stage": "writing",
    }

def reviewer_node(state: ResearchState) -> dict:
    """评审报告质量"""
    draft = state.get("draft", "")
    topic = state["topic"]
    
    prompt = f"""你是一个严格的研究报告评审专家。

请评审以下关于"{topic}"的研究报告：

{draft}

评审标准：
1. 内容完整性（是否有遗漏的重要方面）
2. 逻辑连贯性（论证是否合理）
3. 深度（分析是否足够深入）
4. 实用性（是否包含可操作的建议）

请给出：
- 评分（1-10）
- 具体的改进建议（3-5 条）
- 是否需要修改（是/否）

格式：
评分：X/10
需要修改：是/否
建议：
1. ...
2. ..."""
    
    response = planner_llm.invoke([HumanMessage(content=prompt)])
    content = response.content
    
    # 解析评分和反馈
    import re
    score_match = re.search(r'评分[：:]\s*(\d+)', content)
    score = int(score_match.group(1)) if score_match else 5
    
    needs_revision = score < 8  # 8分以下需要修改
    feedback = content
    
    return {
        "review_score": score,
        "review_feedback": feedback,
        "needs_revision": needs_revision,
        "stage": "reviewing",
    }

def human_review_node(state: ResearchState) -> dict:
    """人工审核节点 - 这里只是一个占位，实际的 interrupt 在图配置中"""
    return {
        "stage": "human_review",
    }

def finalize_node(state: ResearchState) -> dict:
    """最终定稿"""
    draft = state.get("draft", "")
    human_feedback = state.get("human_feedback", "")
    
    if human_feedback:
        # 根据人工反馈做最终修改
        prompt = f"""基于人工审核反馈，对报告做最终修改：

原报告：
{draft}

人工反馈：
{human_feedback}

请输出最终版本。"""
        
        response = llm.invoke([HumanMessage(content=prompt)])
        final = response.content
    else:
        final = draft
    
    return {
        "final_report": final,
        "stage": "done",
    }
```

### 3.5 条件路由实现

```python
# 条件路由函数
from typing import Literal

def route_after_planning(state: ResearchState) -> Literal["researcher", "analyzer"]:
    """规划后：检查是否需要更多搜索"""
    iteration = state.get("iteration", 0)
    max_iter = state.get("max_iterations", 3)
    
    if iteration > max_iter:
        return "analyzer"  # 搜索够了，开始分析
    if len(state.get("search_results", [])) > 15:
        return "analyzer"  # 结果足够
    return "researcher"  # 继续搜索

def route_after_review(state: ResearchState) -> Literal["writer", "human_review"]:
    """评审后：决定是否需要修改"""
    if state.get("needs_revision", False):
        # 检查迭代次数，避免无限循环
        if state.get("iteration", 0) < state.get("max_iterations", 3) + 2:
            return "writer"  # 修改
    return "human_review"  # 通过评审，进入人工审核

def route_after_human(state: ResearchState) -> Literal["writer", "finalize"]:
    """人工审核后：决定是否需要修改"""
    if state.get("human_approved", False):
        return "finalize"
    return "writer"
```

### 3.6 图构建与编译

```python
# graph.py
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from state import ResearchState
from nodes import (
    planner_node, researcher_node, analyzer_node,
    writer_node, reviewer_node, human_review_node, finalize_node
)
from nodes import route_after_planning, route_after_review, route_after_human

def create_research_graph() -> StateGraph:
    """创建研究 Agent 的状态图"""
    
    # 创建图
    graph = StateGraph(ResearchState)
    
    # 添加节点
    graph.add_node("planner", planner_node)
    graph.add_node("researcher", researcher_node)
    graph.add_node("analyzer", analyzer_node)
    graph.add_node("writer", writer_node)
    graph.add_node("reviewer", reviewer_node)
    graph.add_node("human_review", human_review_node)
    graph.add_node("finalize", finalize_node)
    
    # 设置入口
    graph.set_entry_point("planner")
    
    # 添加边
    # planner → researcher 或 analyzer（条件路由）
    graph.add_conditional_edges(
        "planner",
        route_after_planning,
        {
            "researcher": "researcher",
            "analyzer": "analyzer",
        }
    )
    
    # researcher → planner（形成循环：搜索 → 规划 → 搜索）
    graph.add_edge("researcher", "planner")
    
    # analyzer → writer
    graph.add_edge("analyzer", "writer")
    
    # writer → reviewer
    graph.add_edge("writer", "reviewer")
    
    # reviewer → writer（修改循环）或 human_review（通过）
    graph.add_conditional_edges(
        "reviewer",
        route_after_review,
        {
            "writer": "writer",       # 循环修改
            "human_review": "human_review",  # 进入人工审核
        }
    )
    
    # human_review → writer（人工要求修改）或 finalize（人工通过）
    graph.add_conditional_edges(
        "human_review",
        route_after_human,
        {
            "writer": "writer",
            "finalize": "finalize",
        }
    )
    
    # finalize → END
    graph.add_edge("finalize", END)
    
    return graph


def compile_graph(with_checkpointer: bool = True):
    """编译图，可选启用检查点"""
    graph = create_research_graph()
    
    if with_checkpointer:
        checkpointer = MemorySaver()
        app = graph.compile(
            checkpointer=checkpointer,
            interrupt_before=["human_review"],  # 在人工审核前中断
        )
    else:
        app = graph.compile()
    
    return app
```

### 3.7 图可视化

```python
# 可视化图结构（需要安装 pygraphviz）
def visualize_graph():
    app = compile_graph(with_checkpointer=False)
    
    # 生成 Mermaid 格式
    print(app.get_graph().draw_mermaid())
    
    # 或者生成 PNG（需要 graphviz）
    # png_data = app.get_graph().draw_png()
    # with open("research_agent_graph.png", "wb") as f:
    #     f.write(png_data)
```

输出的 Mermaid 图：

```mermaid
graph TD
    __start__ --> planner
    planner --> |需要更多搜索| researcher
    planner --> |搜索充足| analyzer
    researcher --> planner
    analyzer --> writer
    writer --> reviewer
    reviewer --> |需要修改| writer
    reviewer --> |通过| human_review
    human_review --> |需要修改| writer
    human_review --> |通过| finalize
    finalize --> __end__
```

---

## 四、条件路由实现详解

### 4.1 基于 LLM 输出的动态分支

有时候路由决策本身需要 LLM 来做：

```python
def classify_and_route(state: ResearchState) -> str:
    """用 LLM 对用户意图进行分类，然后路由"""
    from langchain_openai import ChatOpenAI
    
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    
    messages = state.get("messages", [])
    last_message = messages[-1].content if messages else ""
    
    classification_prompt = f"""将以下用户输入分类为以下类别之一：
    - technical（技术问题）
    - business（商务问题）
    - complaint（投诉）
    - general（一般咨询）
    
    用户输入：{last_message}
    
    只返回类别名称。"""
    
    result = llm.invoke(classification_prompt).content.strip().lower()
    
    # 根据分类路由
    return result  # 返回的字符串必须匹配 conditional_edges 中的映射键
```

### 4.2 多条件组合路由

```python
def complex_routing(state: ResearchState) -> str:
    """复杂的多条件路由逻辑"""
    score = state.get("review_score", 0)
    iteration = state.get("iteration", 0)
    max_iter = state.get("max_iterations", 3)
    has_human_feedback = bool(state.get("human_feedback"))
    
    # 优先级 1：达到最大迭代次数，强制完成
    if iteration >= max_iter + 3:
        return "finalize"
    
    # 优先级 2：高分且无人工反馈，进入人工审核
    if score >= 8 and not has_human_feedback:
        return "human_review"
    
    # 优先级 3：低分需要修改
    if score < 7:
        return "writer"
    
    # 优先级 4：中等分数，继续研究补充
    if score < 8 and iteration < max_iter:
        return "researcher"
    
    return "finalize"
```

### 4.3 路由函数的最佳实践

```python
# ✅ 好的做法：路由函数只返回路由键，不修改状态
def good_router(state: ResearchState) -> str:
    if state["iteration"] > 3:
        return "end"
    return "continue"

# ❌ 坏的做法：路由函数修改状态
def bad_router(state: ResearchState) -> str:
    state["iteration"] = state.get("iteration", 0) + 1  # 不要在路由中修改状态！
    if state["iteration"] > 3:
        return "end"
    return "continue"
```

---

## 五、循环与重试机制

### 5.1 自我反思循环

自我反思是高级 Agent 的核心能力——让 Agent 审视自己的输出并改进：

```python
def self_reflect_node(state: ResearchState) -> dict:
    """自我反思节点"""
    draft = state.get("draft", "")
    
    prompt = f"""你是一个自我反思的 AI。请审视以下输出，找出问题：

{draft}

反思清单：
1. 事实是否准确？有无编造？
2. 逻辑是否连贯？有无矛盾？
3. 是否回答了用户的核心问题？
4. 是否有遗漏的重要信息？

请列出所有问题，并给出改进建议。"""
    
    llm = ChatOpenAI(model="gpt-4o")
    reflection = llm.invoke([HumanMessage(content=prompt)])
    
    return {
        "review_feedback": reflection.content,
        "needs_revision": True,  # 反思后通常需要修改
        "stage": "reflecting",
    }

# 在图中形成反思循环
graph.add_edge("writer", "self_reflect")
graph.add_conditional_edges(
    "self_reflect",
    lambda state: "writer" if state.get("needs_revision") else "reviewer",
    {"writer": "writer", "reviewer": "reviewer"}
)
```

### 5.2 max_iterations 控制

防止无限循环是图编排的关键安全措施：

```python
def safe_router(state: ResearchState) -> str:
    """带安全阀的路由"""
    iteration = state.get("iteration", 0)
    max_iterations = state.get("max_iterations", 5)
    
    # 硬限制：超过最大迭代次数直接结束
    if iteration >= max_iterations:
        return "finalize"
    
    # 正常路由逻辑
    if state.get("needs_revision", False):
        return "revise"
    return "finalize"

# 另一种方式：在图编译时设置 recursion_limit
app = graph.compile()
result = app.invoke(
    initial_state,
    config={"recursion_limit": 20},  # 全局递归深度限制
    # recursion_limit 是图遍历的最大步数，不是循环次数
)
```

### 5.3 渐进式退出策略

```python
def progressive_exit(state: ResearchState) -> str:
    """渐进式退出：质量不够但次数到了，给出妥协方案"""
    score = state.get("review_score", 0)
    iteration = state.get("iteration", 0)
    
    if iteration >= 5:
        if score >= 6:
            return "human_review"  # 质量还行，让人工决定
        else:
            # 质量不行但次数到了，生成一份"初步报告"加免责声明
            return "finalize_with_caveat"
    
    if score >= 8:
        return "human_review"
    
    return "revise"
```

---

## 六、人机协作节点（Human-in-the-Loop）

### 6.1 interrupt_before 与 interrupt_after

LangGraph 提供了原生的人机协作支持：

```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()

app = graph.compile(
    checkpointer=checkpointer,
    interrupt_before=["human_review"],  # 在 human_review 节点执行前中断
    # 或
    interrupt_after=["reviewer"],        # 在 reviewer 节点执行后中断
)
```

**工作流程：**

```python
# 1. 启动图执行
thread_config = {"configurable": {"thread_id": "research-001"}}

# 第一次运行 - 会在 human_review 前中断
result = app.invoke(
    {"topic": "AI Agent 安全", "max_iterations": 3},
    config=thread_config
)

# 2. 此时图已暂停，可以查看当前状态
current_state = app.get_state(config=thread_config)
print(f"当前阶段: {current_state.values['stage']}")
print(f"报告草稿: {current_state.values['draft']}")

# 3. 获取人类输入
human_feedback = input("请审核报告（输入反馈或 'approved' 通过）：")

# 4. 更新状态（注入人工反馈）
if human_feedback.lower() == "approved":
    app.update_state(
        config=thread_config,
        values={"human_approved": True, "human_feedback": ""},
    )
else:
    app.update_state(
        config=thread_config,
        values={"human_approved": False, "human_feedback": human_feedback},
    )

# 5. 恢复执行
result = app.invoke(None, config=thread_config)  # None 表示从当前状态继续
```

### 6.2 审批节点实现

```python
def create_approval_node(approval_role: str = "manager"):
    """创建一个通用的审批节点工厂"""
    
    def approval_node(state: ResearchState) -> dict:
        # 这个节点本身不做什么——它的价值在于 interrupt_before
        # 当执行流到达这里时，图已经被暂停
        # 人工审核者会通过 update_state 注入决策
        
        approved = state.get("human_approved", False)
        feedback = state.get("human_feedback", "")
        
        if approved:
            return {
                "stage": "approved",
                "messages": [
                    HumanMessage(content=f"[{approval_role}] 审批通过")
                ],
            }
        else:
            return {
                "stage": "revision_requested",
                "review_feedback": feedback,
                "needs_revision": True,
                "messages": [
                    HumanMessage(content=f"[{approval_role}] 要求修改: {feedback}")
                ],
            }
    
    return approval_node

# 使用
graph.add_node("manager_approval", create_approval_node("manager"))
graph.add_node("legal_approval", create_approval_node("法务"))
```

### 6.3 多级审批流程

```python
# 构建多级审批图
graph.add_edge("writer", "manager_approval")  # 经理审批
graph.add_conditional_edges(
    "manager_approval",
    lambda s: "legal_approval" if s.get("human_approved") else "writer",
    {"legal_approval": "legal_approval", "writer": "writer"}
)
graph.add_conditional_edges(
    "legal_approval",
    lambda s: "finalize" if s.get("human_approved") else "writer",
    {"finalize": "finalize", "writer": "writer"}
)

# 编译时在两个审批节点前都设置中断
app = graph.compile(
    checkpointer=checkpointer,
    interrupt_before=["manager_approval", "legal_approval"],
)
```

---

## 七、状态持久化与检查点

### 7.1 MemorySaver（内存检查点）

```python
from langgraph.checkpoint.memory import MemorySaver

# 适合开发和测试
checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)

# 使用 thread_id 来区分不同的执行实例
config = {"configurable": {"thread_id": "conversation-123"}}

# 第一次执行
result1 = app.invoke({"topic": "LangGraph 教程"}, config=config)

# 稍后继续（状态自动恢复）
result2 = app.invoke(None, config=config)
```

### 7.2 SQLite 持久化检查点

```python
from langgraph.checkpoint.sqlite import SqliteSaver

# 适合单机生产环境
checkpointer = SqliteSaver.from_conn_string(":memory:")
# 或持久化到文件
checkpointer = SqliteSaver.from_conn_string("./checkpoints.db")

app = graph.compile(checkpointer=checkpointer)
```

### 7.3 PostgreSQL 持久化（生产推荐）

```python
from langgraph.checkpoint.postgres import PostgresSaver

# 适合分布式生产环境
POSTGRES_URI = "postgresql://user:pass@localhost:5432/langgraph_checkpoints"

with PostgresSaver.from_conn_string(POSTGRES_URI) as checkpointer:
    checkpointer.setup()  # 首次运行，创建表结构
    
    app = graph.compile(checkpointer=checkpointer)
    
    # 支持多个并发的图执行实例
    config = {"configurable": {"thread_id": "research-task-001"}}
    result = app.invoke(initial_state, config=config)
```

### 7.4 断点续跑

```python
# 场景：长时运行的研究任务，中间服务器重启

# 1. 查看所有执行中的任务
# （需要自己实现任务索引，或利用 checkpointer 的 list 方法）

# 2. 恢复特定任务
thread_config = {"configurable": {"thread_id": "long-research-task-001"}}

# 获取上次中断的状态
state = app.get_state(thread_config)
print(f"上次执行到: {state.values.get('stage')}")
print(f"迭代次数: {state.values.get('iteration')}")

# 继续执行
if state.next:  # 还有下一步要执行
    result = app.invoke(None, config=thread_config)
else:
    print("任务已完成")
```

---

## 八、与 LangChain/LangSmith 的集成

### 8.1 LangChain 工具集成

```python
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import ToolNode, tools_condition

# 定义工具
@tool
def web_search(query: str) -> str:
    """搜索互联网获取最新信息"""
    # 实际实现使用 Tavily/SerpAPI 等
    return f"搜索结果: {query}"

@tool
def code_interpreter(code: str) -> str:
    """执行 Python 代码并返回结果"""
    # 安全沙箱执行
    import subprocess
    result = subprocess.run(
        ["python3", "-c", code],
        capture_output=True, text=True, timeout=30
    )
    return result.stdout or result.stderr

# 创建带工具的 Agent
tools = [web_search, code_interpreter]
llm = ChatOpenAI(model="gpt-4o").bind_tools(tools)

# 使用预构建的 ToolNode
tool_node = ToolNode(tools)

# 构建图
graph = StateGraph(AgentState)
graph.add_node("agent", lambda state: {"messages": [llm.invoke(state["messages"])]})
graph.add_node("tools", tool_node)

# 条件路由：LLM 决定是否调用工具
graph.add_conditional_edges(
    "agent",
    tools_condition,  # 预构建的路由函数
    {"tools": "tools", "__end__": END}
)
graph.add_edge("tools", "agent")  # 工具结果返回给 Agent
```

### 8.2 LangSmith 追踪集成

```python
import os

# 启用 LangSmith 追踪
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "your-api-key"
os.environ["LANGCHAIN_PROJECT"] = "research-agent"

# 所有 LangGraph 调用都会自动发送到 LangSmith
app = graph.compile(checkpointer=checkpointer)
result = app.invoke(initial_state, config=thread_config)
# 在 LangSmith UI 中可以看到完整的执行轨迹
```

### 8.3 自定义回调集成

```python
from langchain_core.callbacks import BaseCallbackHandler

class ResearchAgentCallback(BaseCallbackHandler):
    def on_chain_start(self, serialized, inputs, **kwargs):
        node_name = kwargs.get("name", "unknown")
        print(f"▶ 节点开始: {node_name}")
    
    def on_chain_end(self, outputs, **kwargs):
        node_name = kwargs.get("name", "unknown")
        print(f"✓ 节点完成: {node_name}")
    
    def on_llm_start(self, serialized, prompts, **kwargs):
        print(f"  🤖 LLM 调用开始...")
    
    def on_tool_start(self, serialized, input_str, **kwargs):
        print(f"  🔧 工具调用: {input_str[:100]}")

# 使用回调
result = app.invoke(
    initial_state,
    config={
        "configurable": {"thread_id": "test-001"},
        "callbacks": [ResearchAgentCallback()],
    }
)
```

---

## 九、真实踩坑记录

### 9.1 状态序列化陷阱

**问题描述：** 状态中包含了不可序列化的对象（如 database connection、file handle），导致检查点保存失败。

```python
# ❌ 错误：状态中包含不可序列化的对象
class BadState(TypedDict):
    db_connection: Any  # 数据库连接无法序列化！
    messages: list

# ✅ 正确：只存储可序列化的数据
class GoodState(TypedDict):
    messages: list[dict]  # 将消息转为 dict
    user_id: str          # 只存 ID，不存对象
    # 连接在节点内按需创建
```

**解决方案：**
```python
# 在节点内部获取连接
def db_query_node(state: GoodState) -> dict:
    # 每次调用时获取连接（利用连接池）
    conn = get_db_connection()
    try:
        result = conn.execute("SELECT ...")
        return {"data": result.fetchall()}
    finally:
        conn.close()
```

### 9.2 并行节点冲突

**问题描述：** 两个并行节点同时更新同一状态字段，导致数据丢失。

```python
# ❌ 危险：两个并写节点同时写 messages
def node_a(state) -> dict:
    return {"messages": [AIMessage(content="A")]}  # 覆盖

def node_b(state) -> dict:
    return {"messages": [AIMessage(content="B")]}  # 覆盖 A 的结果！
```

**解决方案：** 使用 Annotated 归约

```python
# ✅ 使用 operator.add 追加而不是覆盖
class SafeState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]  # 追加
    results: Annotated[list[str], operator.add]            # 追加
```

### 9.3 调试困难：图的执行路径不可见

**问题描述：** 复杂的图在运行时，很难知道执行了哪些节点、走了哪条边。

**解决方案：**

```python
# 方案一：在每个节点添加日志
import logging
logger = logging.getLogger(__name__)

def logged_node(state):
    logger.info(f"Entering node: {__name__}", extra={
        "stage": state.get("stage"),
        "iteration": state.get("iteration"),
    })
    result = actual_logic(state)
    logger.info(f"Exiting node: {__name__}", extra={"result_keys": list(result.keys())})
    return result

# 方案二：使用 LangSmith 追踪
# 方案三：添加执行轨迹到状态
class DebugState(TypedDict):
    execution_trace: Annotated[list[str], operator.add]

def node_with_trace(state) -> dict:
    return {
        # ... 正常返回 ...
        "execution_trace": [f"Node X executed at {datetime.now()}"]
    }
```

### 9.4 死锁与无限循环

**问题描述：** 条件路由逻辑错误导致图在两个节点之间无限循环。

```python
# ❌ 死锁：A → B → A → B → ...
def route_from_a(state) -> str:
    if not state.get("done"):
        return "b"
    return "end"

def route_from_b(state) -> str:
    if not state.get("done"):
        return "a"  # 永远不会设 done = True
    return "end"
```

**解决方案：**

```python
# ✅ 确保每次循环都有进展
def safe_route(state) -> str:
    iteration = state.get("iteration", 0)
    
    # 硬限制
    if iteration >= MAX_ITERATIONS:
        return "end"
    
    # 检查是否有进展
    if state.get("last_score") == state.get("current_score"):
        no_progress_count = state.get("no_progress_count", 0) + 1
        if no_progress_count >= 3:
            return "end"  # 连续3次无进展，退出
    
    return "continue"
```

### 9.5 内存泄漏：检查点积累

**问题描述：** 长期运行的服务中，MemorySaver 的检查点不断积累，最终内存溢出。

```python
# ❌ MemorySaver 永远不清理
checkpointer = MemorySaver()

# ✅ 生产环境使用带过期的持久化检查点
from langgraph.checkpoint.postgres import PostgresSaver

# 或者实现一个带 LRU 限制的 MemorySaver
from collections import OrderedDict

class LRUMemorySaver(MemorySaver):
    def __init__(self, max_threads: int = 1000):
        super().__init__()
        self.max_threads = max_threads
    
    def put(self, config, checkpoint, metadata, new_versions):
        # 超过限制时删除最旧的
        while len(self.storage) >= self.max_threads:
            self.storage.popitem(last=False)
        return super().put(config, checkpoint, metadata, new_versions)
```

---

## 十、性能优化建议

### 10.1 节点级别的优化

```python
# 1. LLM 调用缓存
from langchain_core.globals import set_llm_cache
from langchain_community.cache import SQLiteCache

set_llm_cache(SQLiteCache(database_path=".langchain.db"))

# 2. 并行执行独立节点
from langgraph.graph import StateGraph

# LangGraph 支持并行执行没有依赖关系的节点
# 只要两个节点不直接相连，它们就可以并行执行

# 3. 使用更小的模型做简单任务
from langchain_openai import ChatOpenAI

classifier_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)  # 分类用小模型
writer_llm = ChatOpenAI(model="gpt-4o", temperature=0.7)         # 写作用大模型
```

### 10.2 状态级别的优化

```python
# 1. 避免在状态中存储大数据
class EfficientState(TypedDict):
    # ❌ 存储完整文档
    # documents: list[str]
    
    # ✅ 存储引用
    document_ids: list[str]
    # 在需要时从外部存储加载

# 2. 使用消息摘要而不是完整历史
class SummaryState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]
    summary: str  # 定期将旧消息压缩为摘要
```

---

## 十一、总结

LangGraph 为构建有状态的 AI Agent 提供了一个强大而灵活的图编排框架。核心价值在于：

1. **图结构天然适合 Agent 工作流**：条件路由、循环、分支都是图的原生操作
2. **显式状态管理**：TypedDict 定义的 State 让数据流清晰可追踪
3. **人机协作原生支持**：interrupt 机制让人工审核无缝融入自动化流程
4. **检查点持久化**：支持长时运行任务的断点续跑

### 适用场景

- **多步推理任务**：需要搜索→分析→综合→评审的复杂流程
- **需要循环的场景**：自我反思、重试、迭代改进
- **人机协作流程**：需要人工审批、修正、决策的半自动化任务
- **多 Agent 协调**：多个专业 Agent 的协作编排

### 不适用场景

- **简单的单轮对话**：直接用 LLM API 即可
- **纯线性流水线**：SequentialChain 更简单
- **实时流式响应**：图编排有额外开销

选择 LangGraph，本质上是选择了一种**声明式**的 Agent 构建方式——你描述的是"做什么"（节点）和"怎么流转"（边），而不是"怎么控制"（if-else-while）。当 Agent 的复杂度超过一定阈值时，这种抽象的价值就会显现出来。

---

> **参考资料：**
> - [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/)
> - [LangGraph GitHub 仓库](https://github.com/langchain-ai/langgraph)
> - [LangSmith 文档](https://docs.smith.langchain.com/)
> - [Building Effective Agents - Anthropic](https://www.anthropic.com/research/building-effective-agents)

## 相关阅读

- [AI Agent 可观测性实战：LangSmith/LangFuse 追踪、调试、评估](/post/ai-agent-observability-langsmith-langfuse-tracing-evaluation/)
- [AI Agent 推理模式实战：ReAct/Tree-of-Thought/Graph-of-Thought 规划能力](/post/ai-agent-reasoning-patterns-react-tot-got-planning/)
- [AI Agent 编排模式实战：ReAct/Plan-and-Execute/Multi-Agent 协作架构设计](/post/ai-agent-orchestration-patterns-react-plan-execute-multi-agent/)
