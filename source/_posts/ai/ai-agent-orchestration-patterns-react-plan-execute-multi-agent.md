---
title: "AI Agent 编排模式实战：ReAct/Plan-and-Execute/Multi-Agent 协作架构设计"
keywords: [AI Agent, ReAct, Plan, Execute, Multi, Agent, 编排模式实战, 协作架构设计, AI, 架构]
date: 2026-05-31 23:00:00
categories:
  - ai
  - architecture
tags:
  - AI Agent
  - React
  - Plan-and-Execute
  - Multi-Agent
  - LangChain
  - CrewAI
  - Laravel
  - 编排模式
description: "深度解析 2026 年 AI Agent 三大核心编排模式——ReAct、Plan-and-Execute、Multi-Agent 协作，结合 Python/LangChain/CrewAI 代码示例与 Laravel 后端集成实战，帮助开发者选择最适合业务场景的 Agent 架构。"
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - /images/content/ai-001-content-1.jpg
  - /images/content/ai-001-content-2.jpg
  - /images/diagrams/ai-001-diagram.jpg
---

## 引言

2026 年，AI Agent 已经从"能对话的聊天机器人"进化为"能自主完成复杂任务的智能体"。但一个关键问题浮出水面：**当任务变复杂时，如何编排 Agent 的思考和行动？**

想象一个真实场景：用户要求 AI 助手"帮我查一下 KKday 东京迪士尼门票的库存，如果有的话创建一个订单，然后发一封确认邮件"。这不是一个简单的问答——它需要：

1. **推理**：理解用户意图，拆解任务
2. **行动**：调用搜索 API、订单 API、邮件 API
3. **观察**：检查每一步的执行结果
4. **决策**：根据库存情况决定是否继续

这就是 **Agent 编排模式** 要解决的问题。本文将深度解析 2026 年主流的三大编排模式，并提供可运行的代码示例。

---

## 一、为什么需要编排模式？

### 1.1 单次 LLM 调用的局限性

最简单的 Agent 就是一次 LLM 调用加一些工具。但这种方式有三个致命问题：

| 问题 | 表现 | 影响 |
|------|------|------|
| 上下文窗口限制 | 工具返回结果太长，塞不进 prompt | 信息丢失 |
| 无状态推理 | 每一步都是独立的，不记得前几步的结果 | 决策错误 |
| 串行瓶颈 | 必须一步一步来，不能并行处理子任务 | 效率低下 |

### 1.2 编排模式的核心思想

编排模式的本质是：**将一个复杂任务分解为多个可管理的步骤，用状态机或图结构控制执行流程**。

```
┌─────────────────────────────────────────────────┐
│              Agent 编排模式总览                    │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌────────┐ │
│  │  ReAct   │    │Plan-and-     │    │Multi-  │ │
│  │  循环推理 │    │Execute       │    │Agent   │ │
│  │  +行动   │    │先规划后执行   │    │协作    │ │
│  └──────────┘    └──────────────┘    └────────┘ │
│       ↑                ↑                 ↑      │
│   简单任务         中等复杂度        高复杂度    │
│   单工具调用       多步骤任务       多角色协作    │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## 二、ReAct 模式：推理与行动的交替循环

![AI Agent 编排模式：ReAct 推理与行动循环](/images/content/ai-001-content-1.jpg)

### 2.1 核心原理

ReAct（**Re**asoning + **Act**ing）是最基础也最直觉的编排模式。它的核心思想是：**让 LLM 在每一步都先"想一想"（Reasoning），再"做一做"（Acting），然后观察结果，决定下一步**。

```
┌─────────────────────────────────────────────┐
│              ReAct 循环                      │
│                                              │
│  用户输入 ──→ [Thought] ──→ [Action] ──→     │
│                    ↑              │          │
│                    │              ↓          │
│                    └──── [Observation]       │
│                              │              │
│                              ↓              │
│                         最终回答             │
└─────────────────────────────────────────────┘
```

每一步包含三个要素：
- **Thought**：LLM 的推理过程（"我需要先查询库存..."）
- **Action**：调用工具（`search_inventory(product_id="TDL-001")`）
- **Observation**：工具返回的结果（`{"stock": 50, "price": 7500}`）

### 2.2 代码实现（LangChain）

```python
from langchain.agents import AgentExecutor, create_react_agent
from langchain_openai import ChatOpenAI
from langchain.tools import Tool
from langchain.prompts import PromptTemplate

# 1. 定义工具
def search_inventory(product_id: str) -> str:
    """查询产品库存"""
    # 模拟 API 调用
    inventory = {
        "TDL-001": {"name": "东京迪士尼门票", "stock": 50, "price": 7500},
        "USJ-001": {"name": "环球影城门票", "stock": 0, "price": 8200},
    }
    result = inventory.get(product_id, {"error": "产品不存在"})
    return str(result)

def create_order(product_id: str, quantity: int = 1) -> str:
    """创建订单"""
    return f'{{"order_id": "ORD-20260531-001", "product_id": "{product_id}", "quantity": {quantity}, "status": "created"}}'

def send_email(to: str, subject: str, body: str) -> str:
    """发送邮件通知"""
    return f'{{"status": "sent", "to": "{to}", "subject": "{subject}"}}'

tools = [
    Tool(name="SearchInventory", func=search_inventory, description="查询产品库存，参数：product_id"),
    Tool(name="CreateOrder", func=create_order, description="创建订单，参数：product_id, quantity"),
    Tool(name="SendEmail", func=send_email, description="发送邮件，参数：to, subject, body"),
]

# 2. 定义 ReAct Prompt
react_prompt = PromptTemplate.from_template("""
你是一个电商 AI 助手。请根据用户请求，使用以下工具完成任务。

可用工具：
{tools}

工具名称列表：{tool_names}

请严格按照以下格式回答：

Question: 用户的输入
Thought: 我需要思考下一步该做什么
Action: 工具名称
Action Input: 工具参数
Observation: 工具返回结果
... (可以重复 Thought/Action/Action Input/Observation)
Thought: 我现在知道最终答案了
Final Answer: 给用户的最终回复

开始！

Question: {input}
Thought: {agent_scratchpad}
""")

# 3. 创建 Agent
llm = ChatOpenAI(model="gpt-4o", temperature=0)
agent = create_react_agent(llm, tools, react_prompt)

# 4. 创建执行器（带最大迭代次数限制）
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True,           # 打印推理过程
    max_iterations=10,      # 防止无限循环
    handle_parsing_errors=True,  # 自动处理解析错误
)

# 5. 执行
result = executor.invoke({
    "input": "帮我查一下东京迪士尼门票的库存，如果有的话创建一个订单"
})
print(result["output"])
```

### 2.3 执行过程示例

```
> 用户输入: 帮我查一下东京迪士尼门票的库存，如果有的话创建一个订单

Thought: 用户想查东京迪士尼门票库存，我需要先调用 SearchInventory 工具
Action: SearchInventory
Action Input: TDL-001
Observation: {'name': '东京迪士尼门票', 'stock': 50, 'price': 7500}

Thought: 库存充足（50张），用户要求创建订单，我来调用 CreateOrder
Action: CreateOrder
Action Input: TDL-001, 1
Observation: {'order_id': 'ORD-20260531-001', 'product_id': 'TDL-001', 'quantity': 1, 'status': 'created'}

Thought: 订单创建成功，我现在可以给用户最终答案了
Final Answer: 东京迪士尼门票库存充足（50张，单价 7,500 日元），已为您创建订单 ORD-20260531-001。
```

### 2.4 ReAct 的优缺点

| 维度 | 优势 | 劣势 |
|------|------|------|
| 实现复杂度 | ⭐ 最简单，几行代码搞定 | — |
| 透明度 | 每步推理过程清晰可见 | — |
| 适用场景 | 简单的工具调用链 | — |
| 错误恢复 | — | 遇到错误容易"迷路"，不知道该回退到哪一步 |
| 长任务 | — | 步骤多了容易"忘记"最初的目标 |
| 并行能力 | — | 完全串行，无法并行调用多个工具 |

---

## 三、Plan-and-Execute 模式：先规划后执行

### 3.1 核心原理

当任务变复杂（超过 5-6 个步骤），ReAct 的"走一步看一步"策略容易失控。Plan-and-Execute 的核心思想是：**先让 LLM 制定一个完整的执行计划，然后按计划逐步执行**。

```
┌──────────────────────────────────────────────────────────┐
│              Plan-and-Execute 架构                        │
│                                                           │
│  用户输入 ──→ [Planner] ──→ 执行计划                      │
│                   │        ┌─ Step 1: 查询库存            │
│                   │        ├─ Step 2: 检查价格            │
│                   │        ├─ Step 3: 创建订单            │
│                   │        └─ Step 4: 发送确认邮件        │
│                   │                                       │
│                   ↓                                       │
│              [Executor] ──→ 逐步执行                      │
│                   │                                       │
│                   ↓                                       │
│              [Re-planner] ──→ 根据执行结果调整计划         │
│                   │                                       │
│                   ↓                                       │
│              最终结果                                      │
└──────────────────────────────────────────────────────────┘
```

关键区别在于：
- **Planner**：负责制定计划（不需要调用工具，只需要推理）
- **Executor**：负责执行每一步（可以是 ReAct Agent）
- **Re-planner**：负责根据执行结果调整后续计划

### 3.2 代码实现（LangGraph）

```python
from langgraph.prebuilt import create_react_agent
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from typing import TypedDict, List, Annotated
import operator

# 1. 定义状态
class PlanState(TypedDict):
    """Plan-and-Execute 状态"""
    input: str                              # 用户输入
    plan: List[str]                         # 执行计划
    completed_steps: Annotated[List[str], operator.add]  # 已完成的步骤
    current_step: str                       # 当前执行步骤
    result: str                             # 最终结果

# 2. Planner 节点
def planner(state: PlanState) -> dict:
    """制定执行计划"""
    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    
    plan_prompt = f"""
你是一个任务规划专家。请为以下用户请求制定一个清晰的执行计划。

用户请求：{state['input']}

要求：
1. 将任务拆分为 2-8 个可执行的步骤
2. 每个步骤应该是独立的、可验证的
3. 步骤之间有明确的依赖关系
4. 如果某个步骤失败，应该有备选方案

请以 JSON 数组格式返回步骤列表，例如：
["步骤1: 查询产品库存", "步骤2: 创建订单", "步骤3: 发送确认邮件"]
"""
    response = llm.invoke([HumanMessage(content=plan_prompt)])
    
    # 解析计划（简化处理，实际项目中应使用 structured output）
    import json
    plan = json.loads(response.content)
    
    return {"plan": plan}

# 3. Executor 节点
def executor(state: PlanState) -> dict:
    """执行当前步骤"""
    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    
    current_step = state["plan"][0]  # 取第一个未完成的步骤
    
    exec_prompt = f"""
你是一个任务执行专家。请执行以下步骤：

当前步骤：{current_step}
已完成步骤：{state['completed_steps']}
原始用户请求：{state['input']}

请模拟执行这个步骤，并返回执行结果。
"""
    response = llm.invoke([HumanMessage(content=exec_prompt)])
    
    # 从计划中移除已完成的步骤
    remaining_plan = state["plan"][1:] if len(state["plan"]) > 1 else []
    
    return {
        "completed_steps": [f"{current_step}: {response.content}"],
        "current_step": current_step,
        "plan": remaining_plan,
    }

# 4. Re-planner 节点
def replanner(state: PlanState) -> dict:
    """根据执行结果调整计划"""
    if not state["plan"]:  # 所有步骤已完成
        llm = ChatOpenAI(model="gpt-4o", temperature=0)
        
        summary_prompt = f"""
请根据以下执行记录，生成最终结果：

用户请求：{state['input']}
执行记录：
{chr(10).join(state['completed_steps'])}

请生成简洁的最终回复。
"""
        response = llm.invoke([HumanMessage(content=summary_prompt)])
        return {"result": response.content}
    
    return {}  # 继续执行

# 5. 条件路由
def should_continue(state: PlanState) -> str:
    """决定是否继续执行"""
    if state.get("result"):
        return "end"
    if state.get("plan"):
        return "executor"
    return "replanner"

# 6. 构建图
workflow = StateGraph(PlanState)

# 添加节点
workflow.add_node("planner", planner)
workflow.add_node("executor", executor)
workflow.add_node("replanner", replanner)

# 添加边
workflow.set_entry_point("planner")
workflow.add_edge("planner", "executor")
workflow.add_edge("executor", "replanner")
workflow.add_conditional_edges("replanner", should_continue, {
    "executor": "executor",
    "end": END,
})

# 编译图
app = workflow.compile()

# 7. 执行
result = app.invoke({
    "input": "帮我查一下东京迪士尼门票的库存，如果有的话创建一个订单，然后发一封确认邮件",
    "completed_steps": [],
    "plan": [],
    "current_step": "",
    "result": "",
})

print(result["result"])
```

### 3.3 Plan-and-Execute 的变体

#### 3.3.1 带反馈的 Plan-and-Execute

在电商场景中，计划可能需要根据实时数据调整。例如：

```python
def executor_with_feedback(state: PlanState) -> dict:
    """带反馈的执行器"""
    current_step = state["plan"][0]
    
    # 执行步骤
    result = execute_step(current_step, state["completed_steps"])
    
    # 检查是否需要调整计划
    if result.get("needs_replan"):
        # 调用 Re-planner 重新规划
        new_plan = replan(state, result["reason"])
        return {
            "completed_steps": [f"{current_step}: 执行失败，原因：{result['reason']}"],
            "plan": new_plan,  # 使用新计划
        }
    
    return {
        "completed_steps": [f"{current_step}: {result['output']}"],
        "plan": state["plan"][1:],
    }
```

#### 3.3.2 并行步骤执行

当计划中有多个独立步骤时，可以并行执行：

```python
import asyncio

async def parallel_executor(state: PlanState) -> dict:
    """并行执行独立步骤"""
    # 分析哪些步骤可以并行
    independent_steps = analyze_dependencies(state["plan"])
    
    # 并行执行
    tasks = [execute_step_async(step) for step in independent_steps]
    results = await asyncio.gather(*tasks)
    
    return {
        "completed_steps": [
            f"{step}: {result}" 
            for step, result in zip(independent_steps, results)
        ],
        "plan": [s for s in state["plan"] if s not in independent_steps],
    }
```

### 3.4 Plan-and-Execute 的优缺点

| 维度 | 优势 | 劣势 |
|------|------|------|
| 任务规划 | 全局视角，避免"走一步看一步" | 计划可能过时（执行过程中环境变化） |
| 可预测性 | 用户可以预先看到执行计划 | 计划调整需要额外的 LLM 调用 |
| 错误恢复 | Re-planner 可以动态调整计划 | 调整逻辑复杂 |
| 并行能力 | 可以识别并行步骤 | 需要额外的依赖分析 |
| 适用场景 | 中等复杂度（5-15 步）的任务 | 简单任务用 ReAct 更高效 |

---

## 四、Multi-Agent 协作模式：多角色团队协作

![Multi-Agent 多智能体协作架构](/images/content/ai-001-content-2.jpg)

### 4.1 核心原理

当任务涉及多个专业领域时（如代码审查需要"安全专家"+"性能专家"+"代码规范专家"），单一 Agent 很难兼顾。Multi-Agent 的核心思想是：**让多个专业 Agent 各司其职，通过消息传递协作完成任务**。

```
┌──────────────────────────────────────────────────────────────┐
│              Multi-Agent 协作架构                              │
│                                                               │
│  用户输入 ──→ [Orchestrator Agent]                            │
│                    │                                          │
│         ┌─────────┼─────────┐                                │
│         ↓         ↓         ↓                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │ 搜索Agent │ │ 订单Agent │ │ 通知Agent │                    │
│  │ (搜索专家) │ │ (订单专家) │ │ (通知专家) │                    │
│  └──────────┘ └──────────┘ └──────────┘                     │
│         │         │         │                                │
│         └─────────┼─────────┘                                │
│                   ↓                                          │
│         [Orchestrator Agent]                                 │
│                   │                                          │
│                   ↓                                          │
│              最终结果                                         │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 代码实现（CrewAI）

CrewAI 是 2026 年最流行的 Multi-Agent 框架之一，它的核心抽象是 **Crew（团队）→ Agent（角色）→ Task（任务）**。

```python
from crewai import Agent, Task, Crew, Process
from crewai.tools import BaseTool
from langchain_openai import ChatOpenAI

# 1. 定义工具
class SearchInventoryTool(BaseTool):
    name: str = "search_inventory"
    description: str = "查询产品库存和价格信息"
    
    def _run(self, product_id: str) -> str:
        inventory = {
            "TDL-001": {"name": "东京迪士尼门票", "stock": 50, "price": 7500},
            "USJ-001": {"name": "环球影城门票", "stock": 0, "price": 8200},
        }
        return str(inventory.get(product_id, {"error": "产品不存在"}))

class CreateOrderTool(BaseTool):
    name: str = "create_order"
    description: str = "创建订单"
    
    def _run(self, product_id: str, quantity: int = 1) -> str:
        return f'{{"order_id": "ORD-20260531-001", "product_id": "{product_id}", "quantity": {quantity}}}'

class SendEmailTool(BaseTool):
    name: str = "send_email"
    description: str = "发送邮件通知"
    
    def _run(self, to: str, subject: str, body: str) -> str:
        return f'{{"status": "sent", "to": "{to}"}}'

# 2. 定义 Agent（角色）
llm = ChatOpenAI(model="gpt-4o", temperature=0)

search_agent = Agent(
    role="产品搜索专家",
    goal="快速准确地查询产品信息，包括库存、价格、可用日期",
    backstory="""
    你是一个经验丰富的旅游产品搜索专家。
    你熟悉各种旅游产品的库存系统，能够快速定位产品信息。
    如果产品缺货，你会主动推荐替代方案。
    """,
    tools=[SearchInventoryTool()],
    llm=llm,
    verbose=True,
)

order_agent = Agent(
    role="订单处理专家",
    goal="高效准确地处理订单，确保订单信息完整无误",
    backstory="""
    你是一个严谨的订单处理专家。
    你会仔细核对产品信息、数量、价格，确保订单准确无误。
    如果库存不足，你会建议用户等待或选择替代产品。
    """,
    tools=[CreateOrderTool()],
    llm=llm,
    verbose=True,
)

notification_agent = Agent(
    role="通知服务专家",
    goal="及时准确地发送各类通知，确保用户收到重要信息",
    backstory="""
    你是一个高效的通信服务专家。
    你会根据通知类型选择合适的渠道（邮件、短信、推送）。
    你注重通知的可读性和关键信息的突出显示。
    """,
    tools=[SendEmailTool()],
    llm=llm,
    verbose=True,
)

# 3. 定义 Task（任务）
search_task = Task(
    description="查询东京迪士尼门票（TDL-001）的库存和价格信息",
    expected_output="产品库存数量、单价、是否可用的详细信息",
    agent=search_agent,
)

order_task = Task(
    description="如果库存充足，创建一张门票的订单",
    expected_output="订单号、订单状态、订单详情",
    agent=order_agent,
    context=[search_task],  # 依赖搜索任务的结果
)

notification_task = Task(
    description="发送订单确认邮件给用户（user@example.com）",
    expected_output="邮件发送状态和确认信息",
    agent=notification_agent,
    context=[order_task],  # 依赖订单任务的结果
)

# 4. 组建 Crew（团队）
crew = Crew(
    agents=[search_agent, order_agent, notification_agent],
    tasks=[search_task, order_task, notification_task],
    process=Process.sequential,  # 顺序执行（也可以用 Process.hierarchical）
    verbose=True,
)

# 5. 执行
result = crew.kickoff()
print(result)
```

### 4.3 Multi-Agent 协作模式的变体

#### 4.3.1 层级式协作（Hierarchical）

```
┌─────────────────────────────────────────┐
│           Manager Agent                 │
│     (负责任务分配和结果汇总)             │
│                                         │
│    ┌──────────┬──────────┐             │
│    ↓          ↓          ↓             │
│ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │Worker│ │Worker│ │Worker│            │
│ │  A   │ │  B   │ │  C   │            │
│ └──────┘ └──────┘ └──────┘            │
└─────────────────────────────────────────┘
```

```python
from crewai import Crew, Process

# 使用层级式流程
crew = Crew(
    agents=[search_agent, order_agent, notification_agent],
    tasks=[search_task, order_task, notification_task],
    process=Process.hierarchical,  # 层级式
    manager_llm=ChatOpenAI(model="gpt-4o"),
    verbose=True,
)
```

#### 4.3.2 辩论式协作（Debate）

适用于需要多角度分析的场景（如技术选型、风险评估）：

```python
# 定义"正方"和"反方" Agent
pro_agent = Agent(
    role="技术选型正方",
    goal="论证使用该技术方案的优势",
    backstory="你是一个乐观的技术架构师，善于发现新技术的价值...",
    llm=llm,
)

con_agent = Agent(
    role="技术选型反方",
    goal="指出该技术方案的潜在风险和问题",
    backstory="你是一个谨慎的技术架构师，善于发现隐藏的风险...",
    llm=llm,
)

judge_agent = Agent(
    role="技术委员会主席",
    goal="综合正反双方观点，做出最终决策",
    backstory="你是一个经验丰富的技术领袖，善于权衡利弊...",
    llm=llm,
)
```

#### 4.3.3 流水线式协作（Pipeline）

适用于数据处理场景（如 ETL、内容生成）：

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 数据采集 │───→│ 数据清洗 │───→│ 数据分析 │───→│ 报告生成 │
│  Agent   │    │  Agent   │    │  Agent   │    │  Agent   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### 4.4 Multi-Agent 的优缺点

| 维度 | 优势 | 劣势 |
|------|------|------|
| 专业分工 | 每个 Agent 专注一个领域，质量更高 | Agent 间通信开销大 |
| 可扩展性 | 新增角色只需添加 Agent | 角色间可能产生冲突 |
| 透明度 | 每个 Agent 的推理过程独立可见 | 整体流程难以调试 |
| 适用场景 | 多领域交叉的复杂任务 | 简单任务用单 Agent 更高效 |
| 成本 | — | 多个 Agent 同时调用 LLM，成本倍增 |

---

## 五、三种模式对比与选型指南

![AI Agent 编排模式架构总览](/images/diagrams/ai-001-diagram.jpg)

### 5.1 核心对比

| 维度 | ReAct | Plan-and-Execute | Multi-Agent |
|------|-------|------------------|-------------|
| **核心思想** | 推理-行动交替 | 先规划后执行 | 多角色协作 |
| **适用复杂度** | 简单（1-5 步） | 中等（5-15 步） | 高（多领域交叉） |
| **实现难度** | ⭐ 低 | ⭐⭐ 中 | ⭐⭐⭐ 高 |
| **LLM 调用次数** | O(n) 步骤数 | O(n+2) 计划+执行+总结 | O(n×m) 步骤×Agent 数 |
| **错误恢复** | 差（容易迷路） | 好（Re-planner） | 好（独立 Agent） |
| **并行能力** | 无 | 有（独立步骤） | 有（独立 Agent） |
| **可解释性** | ⭐⭐⭐ 高 | ⭐⭐⭐ 高 | ⭐⭐ 中 |
| **适用场景** | 工具调用、问答增强 | 流程自动化、多步骤任务 | 代码审查、内容生成、客服 |

### 5.2 选型决策树

```
你的任务需要调用工具吗？
├── 否 → 直接用 LLM，不需要 Agent
└── 是 → 任务步骤超过 5 步吗？
    ├── 否 → 用 ReAct
    └── 是 → 任务涉及多个专业领域吗？
        ├── 否 → 用 Plan-and-Execute
        └── 是 → 用 Multi-Agent
```

### 5.3 真实场景选型示例

| 场景 | 推荐模式 | 原因 |
|------|----------|------|
| 查询天气并回复用户 | ReAct | 1-2 步，简单工具调用 |
| 帮用户订机票+酒店+租车 | Plan-and-Execute | 3+ 步，有依赖关系 |
| 代码审查（安全+性能+规范） | Multi-Agent | 多专业领域 |
| 自动化测试生成 | Multi-Agent | 需求分析+测试设计+代码生成 |
| 数据分析报告 | Plan-and-Execute | 采集→清洗→分析→报告 |
| 客服工单处理 | Multi-Agent | 理解+分类+路由+回复 |

---

## 六、与 Laravel 后端集成实战

### 6.1 架构设计

在 Laravel B2C API 项目中，AI Agent 通常作为"智能中间层"存在：

```
┌─────────────────────────────────────────────────────────┐
│                    前端 (Vue/uni-app)                    │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTP API
┌─────────────────────────▼───────────────────────────────┐
│                  Laravel BFF Layer                       │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              AI Agent Service                     │  │
│  │                                                   │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────┐  │  │
│  │  │ ReAct    │  │Plan-and-     │  │Multi-     │  │  │
│  │  │ Engine   │  │Execute Engine│  │Agent Engine│  │  │
│  │  └──────────┘  └──────────────┘  └───────────┘  │  │
│  │                                                   │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │           Tool Registry                   │   │  │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐       │   │  │
│  │  │  │搜索API │ │订单API │ │支付API │ ...   │   │  │
│  │  │  └────────┘ └────────┘ └────────┘       │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Search   │  │ Order    │  │ Payment  │ ...         │
│  │ Service  │  │ Service  │  │ Service  │             │
│  └──────────┘  └──────────┘  └──────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Laravel 集成代码

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class AgentOrchestrator
{
    private string $llmEndpoint;
    private string $apiKey;
    private array $tools = [];

    public function __construct()
    {
        $this->llmEndpoint = config('ai.llm_endpoint', 'https://api.openai.com/v1');
        $this->apiKey = config('ai.api_key');
    }

    /**
     * 注册工具
     */
    public function registerTool(string $name, callable $handler, string $description): void
    {
        $this->tools[$name] = [
            'handler' => $handler,
            'description' => $description,
        ];
    }

    /**
     * ReAct 模式执行
     */
    public function react(string $userInput, int $maxIterations = 10): string
    {
        $scratchpad = '';
        
        for ($i = 0; $i < $maxIterations; $i++) {
            // 1. 调用 LLM 推理
            $response = $this->callLLM($this->buildReactPrompt($userInput, $scratchpad));
            
            // 2. 解析响应
            $parsed = $this->parseReActResponse($response);
            
            // 3. 检查是否是最终答案
            if ($parsed['type'] === 'final_answer') {
                return $parsed['content'];
            }
            
            // 4. 执行工具
            if ($parsed['type'] === 'action') {
                $toolResult = $this->executeTool($parsed['tool'], $parsed['input']);
                $scratchpad .= "\nThought: {$parsed['thought']}\n";
                $scratchpad .= "Action: {$parsed['tool']}\n";
                $scratchpad .= "Action Input: {$parsed['input']}\n";
                $scratchpad .= "Observation: {$toolResult}\n";
            }
        }
        
        throw new \RuntimeException("Agent 超过最大迭代次数 ({$maxIterations})");
    }

    /**
     * Plan-and-Execute 模式执行
     */
    public function planAndExecute(string $userInput): string
    {
        // 1. 制定计划
        $plan = $this->createPlan($userInput);
        
        // 2. 逐步执行
        $completedSteps = [];
        $remainingPlan = $plan;
        
        while (!empty($remainingPlan)) {
            $currentStep = array_shift($remainingPlan);
            
            // 执行当前步骤
            $stepResult = $this->executeStep($currentStep, $completedSteps);
            $completedSteps[] = [
                'step' => $currentStep,
                'result' => $stepResult,
            ];
            
            // 检查是否需要重新规划
            if ($this->needsReplan($stepResult)) {
                $remainingPlan = $this->replan($userInput, $completedSteps, $remainingPlan);
            }
        }
        
        // 3. 生成最终结果
        return $this->generateSummary($userInput, $completedSteps);
    }

    /**
     * 调用 LLM API
     */
    private function callLLM(string $prompt): string
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiKey}",
            'Content-Type' => 'application/json',
        ])->post("{$this->llmEndpoint}/chat/completions", [
            'model' => 'gpt-4o',
            'messages' => [
                ['role' => 'system', 'content' => '你是一个智能助手，善于使用工具完成任务。'],
                ['role' => 'user', 'content' => $prompt],
            ],
            'temperature' => 0,
        ]);

        return $response->json('choices.0.message.content', '');
    }

    /**
     * 执行工具
     */
    private function executeTool(string $toolName, mixed $input): string
    {
        if (!isset($this->tools[$toolName])) {
            return "错误：工具 {$toolName} 不存在";
        }

        try {
            $handler = $this->tools[$toolName]['handler'];
            return json_encode($handler($input), JSON_UNESCAPED_UNICODE);
        } catch (\Exception $e) {
            return "错误：{$e->getMessage()}";
        }
    }

    private function buildReactPrompt(string $userInput, string $scratchpad): string
    {
        $toolDescriptions = collect($this->tools)
            ->map(fn($tool, $name) => "- {$name}: {$tool['description']}")
            ->join("\n");

        return <<<PROMPT
用户请求：{$userInput}

可用工具：
{$toolDescriptions}

之前的推理过程：
{$scratchpad}

请按照 ReAct 格式继续推理。如果已经有足够信息回答用户，请给出 Final Answer。
PROMPT;
    }

    private function parseReActResponse(string $response): array
    {
        if (preg_match('/Final Answer:\s*(.*)/s', $response, $matches)) {
            return ['type' => 'final_answer', 'content' => trim($matches[1])];
        }

        if (preg_match('/Thought:\s*(.*?)\n/s', $response, $thought) &&
            preg_match('/Action:\s*(.*?)\n/s', $response, $action) &&
            preg_match('/Action Input:\s*(.*)/s', $response, $input)) {
            return [
                'type' => 'action',
                'thought' => trim($thought[1]),
                'tool' => trim($action[1]),
                'input' => trim($input[1]),
            ];
        }

        return ['type' => 'error', 'content' => '无法解析 LLM 响应'];
    }
}
```

### 6.3 在 Controller 中使用

```php
<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Services\AI\AgentOrchestrator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AIAssistantController extends Controller
{
    public function __construct(
        private AgentOrchestrator $agent
    ) {
        // 注册业务工具
        $this->agent->registerTool(
            'search_product',
            fn($input) => app(ProductSearchService::class)->search($input),
            '搜索旅游产品，参数：关键词或产品ID'
        );

        $this->agent->registerTool(
            'check_inventory',
            fn($productId) => app(InventoryService::class)->check($productId),
            '查询产品库存，参数：产品ID'
        );

        $this->agent->registerTool(
            'create_order',
            fn($input) => app(OrderService::class)->create(json_decode($input, true)),
            '创建订单，参数：JSON格式的订单信息'
        );

        $this->agent->registerTool(
            'send_notification',
            fn($input) => app(NotificationService::class)->send(json_decode($input, true)),
            '发送通知，参数：JSON格式的通知信息'
        );
    }

    /**
     * ReAct 模式 - 简单任务
     */
    public function chat(Request $request): JsonResponse
    {
        $request->validate(['message' => 'required|string|max:1000']);

        $result = $this->agent->react($request->input('message'));

        return response()->json([
            'success' => true,
            'data' => ['response' => $result],
        ]);
    }

    /**
     * Plan-and-Execute 模式 - 复杂任务
     */
    public function executeComplexTask(Request $request): JsonResponse
    {
        $request->validate(['task' => 'required|string|max:2000']);

        $result = $this->agent->planAndExecute($request->input('task'));

        return response()->json([
            'success' => true,
            'data' => ['result' => $result],
        ]);
    }
}
```

### 6.4 限流与成本控制

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Cache;

class AgentRateLimiter
{
    /**
     * 基于用户角色的限流
     */
    public static function check(int $userId, string $mode): bool
    {
        $limits = [
            'react' => ['per_minute' => 10, 'per_hour' => 100],
            'plan_execute' => ['per_minute' => 5, 'per_hour' => 50],
            'multi_agent' => ['per_minute' => 3, 'per_hour' => 30],
        ];

        $limit = $limits[$mode] ?? $limits['react'];

        // 每分钟限流
        $minuteKey = "agent:{$mode}:{$userId}:minute";
        if (RateLimiter::tooManyAttempts($minuteKey, $limit['per_minute'])) {
            return false;
        }
        RateLimiter::hit($minuteKey, 60);

        // 每小时限流
        $hourKey = "agent:{$mode}:{$userId}:hour";
        if (RateLimiter::tooManyAttempts($hourKey, $limit['per_hour'])) {
            return false;
        }
        RateLimiter::hit($hourKey, 3600);

        return true;
    }

    /**
     * Token 使用量追踪
     */
    public static function trackUsage(int $userId, int $inputTokens, int $outputTokens): void
    {
        $today = now()->format('Y-m-d');
        $key = "agent:tokens:{$userId}:{$today}";

        Cache::increment($key . ':input', $inputTokens);
        Cache::increment($key . ':output', $outputTokens);
        Cache::expire($key . ':input', 86400 * 7);  // 保留 7 天
        Cache::expire($key . ':output', 86400 * 7);
    }
}
```

---

## 七、生产环境最佳实践

### 7.1 错误处理与降级

```python
from enum import Enum
from typing import Optional
import logging

class AgentFallbackStrategy(Enum):
    """Agent 降级策略"""
    RETRY = "retry"                # 重试当前步骤
    SKIP = "skip"                  # 跳过当前步骤
    REPLAN = "replan"              # 重新规划
    HUMAN_IN_LOOP = "human"        # 请求人工介入
    FALLBACK_LLM = "fallback_llm"  # 切换到备用 LLM

class RobustAgentExecutor:
    """带错误处理的 Agent 执行器"""
    
    def __init__(self, max_retries: int = 3):
        self.max_retries = max_retries
        self.logger = logging.getLogger(__name__)
    
    def execute_with_fallback(
        self,
        step: str,
        executor: callable,
        fallback_strategy: AgentFallbackStrategy = AgentFallbackStrategy.RETRY
    ) -> Optional[str]:
        """带降级的步骤执行"""
        
        for attempt in range(self.max_retries):
            try:
                result = executor(step)
                return result
            except Exception as e:
                self.logger.warning(
                    f"步骤执行失败 (尝试 {attempt + 1}/{self.max_retries}): {step}",
                    extra={"error": str(e), "strategy": fallback_strategy.value}
                )
                
                if attempt == self.max_retries - 1:
                    return self._apply_fallback(step, fallback_strategy, e)
        
        return None
    
    def _apply_fallback(
        self,
        step: str,
        strategy: AgentFallbackStrategy,
        error: Exception
    ) -> Optional[str]:
        """应用降级策略"""
        
        if strategy == AgentFallbackStrategy.SKIP:
            self.logger.info(f"跳过步骤: {step}")
            return f"[已跳过] {step}"
        
        elif strategy == AgentFallbackStrategy.HUMAN_IN_LOOP:
            self.logger.info(f"请求人工介入: {step}")
            return f"[等待人工处理] {step} - 错误: {error}"
        
        elif strategy == AgentFallbackStrategy.FALLBACK_LLM:
            self.logger.info(f"切换到备用 LLM: {step}")
            # 切换到本地模型（如 Ollama）
            return self._execute_with_local_llm(step)
        
        return None
```

### 7.2 可观测性与追踪

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Log;

class AgentTracer
{
    private array $trace = [];
    private float $startTime;

    public function start(string $mode, string $input): void
    {
        $this->startTime = microtime(true);
        $this->trace = [
            'mode' => $mode,
            'input' => $input,
            'steps' => [],
            'start_time' => now()->toISOString(),
        ];
    }

    public function addStep(string $type, string $content, ?string $toolResult = null): void
    {
        $this->trace['steps'][] = [
            'type' => $type,  // thought, action, observation, error
            'content' => $content,
            'tool_result' => $toolResult,
            'timestamp' => now()->toISOString(),
            'duration_ms' => round((microtime(true) - $this->startTime) * 1000),
        ];
    }

    public function finish(string $output, int $totalTokens = 0): array
    {
        $duration = round((microtime(true) - $this->startTime) * 1000);
        
        $this->trace['output'] = $output;
        $this->trace['total_duration_ms'] = $duration;
        $this->trace['total_tokens'] = $totalTokens;
        $this->trace['step_count'] = count($this->trace['steps']);
        $this->trace['end_time'] = now()->toISOString();

        // 写入日志（生产环境可接入 Sentry/New Relic）
        Log::channel('ai')->info('Agent 执行完成', $this->trace);

        return $this->trace;
    }
}
```

### 7.3 安全考虑

```php
<?php

namespace App\Services\AI;

class AgentSecurityGuard
{
    /**
     * 输入过滤 - 防止 Prompt Injection
     */
    public function sanitizeInput(string $input): string
    {
        // 移除潜在的注入指令
        $patterns = [
            '/ignore\s+(all\s+)?previous\s+instructions/i',
            '/you\s+are\s+now\s+a/i',
            '/system\s*:\s*/i',
            '/<\|im_start\|>/i',
            '/<\|im_end\|>/i',
        ];

        $sanitized = $input;
        foreach ($patterns as $pattern) {
            $sanitized = preg_replace($pattern, '[已过滤]', $sanitized);
        }

        return $sanitized;
    }

    /**
     * 工具调用权限检查
     */
    public function checkToolPermission(int $userId, string $toolName, array $params): bool
    {
        // 读操作 - 允许
        $readOnlyTools = ['search_product', 'check_inventory', 'get_order_status'];
        if (in_array($toolName, $readOnlyTools)) {
            return true;
        }

        // 写操作 - 需要额外验证
        $writeTools = ['create_order', 'cancel_order', 'refund'];
        if (in_array($toolName, $writeTools)) {
            return $this->verifyWritePermission($userId, $params);
        }

        // 通知操作 - 限制频率
        $notifyTools = ['send_email', 'send_sms', 'send_push'];
        if (in_array($toolName, $notifyTools)) {
            return $this->checkNotificationRateLimit($userId);
        }

        return false;
    }

    /**
     * 输出过滤 - 防止敏感信息泄露
     */
    public function sanitizeOutput(string $output): string
    {
        // 遮盖信用卡号
        $output = preg_replace('/\b(\d{4})[- ]?(\d{4})[- ]?(\d{4})[- ]?(\d{4})\b/', '$1-****-****-$4', $output);
        
        // 遮盖邮箱
        $output = preg_replace('/\b[\w.+-]+@[\w-]+\.[\w.]+\b/', '***@***.com', $output);
        
        // 遮盖手机号
        $output = preg_replace('/\b1[3-9]\d{9}\b/', '1**********', $output);

        return $output;
    }
}
```

---

## 八、2026 年编排模式新趋势

### 8.1 动态编排（Dynamic Orchestration）

不再预先选择模式，而是根据任务复杂度自动切换：

```python
class DynamicOrchestrator:
    """动态编排器 - 根据任务复杂度自动选择模式"""
    
    def execute(self, user_input: str) -> str:
        # 1. 评估任务复杂度
        complexity = self.assess_complexity(user_input)
        
        # 2. 选择编排模式
        if complexity <= 2:
            return self.react(user_input)        # 简单任务
        elif complexity <= 5:
            return self.plan_and_execute(user_input)  # 中等任务
        else:
            return self.multi_agent(user_input)   # 复杂任务
    
    def assess_complexity(self, text: str) -> int:
        """评估任务复杂度（1-10）"""
        prompt = f"""
评估以下任务的复杂度（1-10分）：
- 1-2分：单步查询或简单计算
- 3-5分：多步骤但领域单一
- 6-8分：多领域交叉
- 9-10分：需要创造性思维

任务：{text}

只返回数字。
"""
        result = self.llm.invoke(prompt)
        return int(result.strip())
```

### 8.2 记忆增强编排（Memory-Augmented Orchestration）

结合 RAG 和长期记忆，让 Agent 能从历史任务中学习：

```python
class MemoryAugmentedAgent:
    """记忆增强的 Agent"""
    
    def __init__(self):
        self.vector_store = Chroma(collection_name="agent_memory")
    
    def execute(self, task: str) -> str:
        # 1. 检索相似历史任务
        similar_tasks = self.vector_store.similarity_search(task, k=3)
        
        # 2. 构建上下文
        context = "\n".join([
            f"历史任务：{doc.metadata['task']}\n执行方案：{doc.metadata['solution']}"
            for doc in similar_tasks
        ])
        
        # 3. 带记忆的执行
        enhanced_prompt = f"""
参考以下历史经验：
{context}

当前任务：{task}
"""
        return self.react(enhanced_prompt)
    
    def learn(self, task: str, solution: str, success: bool):
        """从执行结果中学习"""
        if success:
            self.vector_store.add_texts(
                texts=[task],
                metadatas=[{"task": task, "solution": solution}]
            )
```

---

## 总结

AI Agent 编排模式是 2026 年 AI 工程化的核心议题。三种模式各有适用场景：

| 模式 | 一句话总结 | 适用场景 |
|------|-----------|----------|
| **ReAct** | 走一步看一步 | 简单工具调用，1-5 步 |
| **Plan-and-Execute** | 先画蓝图再施工 | 中等复杂度，5-15 步 |
| **Multi-Agent** | 团队协作各司其职 | 多领域交叉，高复杂度 |

**选型建议**：

1. **从 ReAct 开始**：如果你是 Agent 开发新手，先用 ReAct 模式跑通整个流程
2. **按需升级**：当任务步骤超过 5 步或频繁出错时，考虑 Plan-and-Execute
3. **谨慎使用 Multi-Agent**：只有当任务真正需要多个专业领域时才用，否则会增加不必要的复杂度和成本
4. **动态编排是未来**：2026 年的趋势是让系统自动选择最合适的编排模式

记住：**没有最好的编排模式，只有最适合你业务场景的编排模式**。

---

> 💡 **参考资源**
> - [LangChain ReAct 文档](https://python.langchain.com/docs/modules/agents/agent_types/react)
> - [LangGraph Plan-and-Execute](https://langchain-ai.github.io/langgraph/tutorials/plan-and-execute/)
> - [CrewAI 官方文档](https://docs.crewai.com/)
> - [AI Agent 编排模式深度对比（cnblogs）](https://www.cnblogs.com/itech/p/19849161)

---

## 相关阅读

- [AI Agent State Machine 实战：用状态机管理 Agent 对话生命周期——空闲/思考/执行/等待/错误五态模型](/categories/AI/2026-06-06-AI-Agent-State-Machine-实战-状态机管理Agent对话生命周期-五态模型/)
- [AI Agent 记忆系统设计：短期/长期记忆、RAG 与向量数据库选型实战](/categories/AI/2026-06-01-ai-agent-memory-system-design-short-long-term-rag-vector-db/)
- [AI Agent 工具调用实战：Function Calling 标准化与错误处理](/categories/AI/2026-06-02-ai-agent-function-calling-standardization-error-handling/)
