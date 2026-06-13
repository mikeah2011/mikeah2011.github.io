
title: AI Agent 规划能力实战：ReAct/Tree-of-Thought/Graph-of-Thought 推理模式
keywords: [AI, Agent]
date: 2026-06-02 12:00:00
tags:
- AI Agent
- React
- Tree-of-Thought
- Graph-of-Thought
- 推理
- 规划
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
description: 系统拆解 AI Agent 推理与规划能力实战，深入对比 ReAct、Tree-of-Thought、Graph-of-Thought 等模式的适用场景、实现思路与工程取舍，帮你构建更稳定、更聪明的智能体。
---


在很多团队刚开始做 AI Agent 时，最先关注的往往是“能不能调用工具”“能不能接 API”“能不能自动执行任务”。但项目一旦进入真实业务，很快就会发现：**真正决定 Agent 上限的，不只是有没有工具，而是它有没有规划能力**。

同样是一组工具，有的 Agent 只会机械地“收到问题 → 调一个工具 → 回答用户”，一旦遇到多步任务、信息不完整、路径需要试错的问题，就开始乱走、重复调用、甚至在错误分支里越陷越深；而另一些 Agent 则能够先拆问题、再选择路径、必要时回溯、最后聚合证据形成结论。二者的差距，本质上就是**推理与规划模式设计的差距**。

过去两年，围绕大模型推理能力的工程化落地，业内逐渐形成了几条非常重要的路线：从最早帮助模型“把想法写出来”的 Chain-of-Thought（CoT），到让模型在“思考—行动—观察”之间交替的 ReAct，再到强调多分支探索的 Tree-of-Thought（ToT）、支持节点重组与证据聚合的 Graph-of-Thought（GoT），以及在工程上非常实用的 Plan-and-Execute 两阶段模式。这些方法并不是彼此替代的关系，而更像是一套逐步增强的“规划能力工具箱”。

本文不讨论多 Agent 协作编排，也不重点讲 Prompt 工程通用技巧，而是**聚焦 AI Agent 本身的推理模式**：它们分别解决什么问题、底层思想是什么、在代码层怎么实现、性能成本如何平衡、上线时怎么选型，以及在什么情况下应该从单路径推理升级到分支搜索、再进一步升级到图式聚合。

如果你正在做以下事情，这篇文章会比较有帮助：

- 想给现有 Agent 增加更稳定的任务规划能力；
- 正在评估 ReAct、ToT、GoT、Plan-and-Execute 的差异；
- 使用 LangChain 或 LlamaIndex，希望看到可落地的代码骨架；
- 需要向团队解释：为什么简单问答 Agent 与可执行 Agent 的实现思路不一样；
- 需要在准确率、延迟、Token 成本之间做工程取舍。

---

## 一、AI Agent 规划能力概述与演进

### 1.1 什么叫“规划能力”

在 AI Agent 语境里，规划能力并不只是“先列个 TODO 清单”。更完整地说，它包含以下几个层面：

1. **目标理解**：识别用户真实目标，而不是只复述表面指令；
2. **任务拆解**：把复杂目标分解为可执行的若干中间步骤；
3. **路径选择**：在多个候选策略之间选择最优或较优路径；
4. **状态更新**：根据外部工具返回结果动态修正当前判断；
5. **错误恢复**：发现路径错误时能够回退、重试、换路；
6. **结果聚合**：将多来源证据、多分支探索结果整合成最终答案；
7. **资源约束控制**：在 token、时间、调用次数、预算等限制下做决策。

从工程视角看，一个“有规划能力”的 Agent，不等于它推理链更长，而是它**更擅长在不确定环境里做受约束决策**。

### 1.2 为什么大模型原生能力还不够

很多人第一次接触 Agent 时会有一个误区：既然模型本身已经很强，为什么不能直接“把任务说明白”，让它自己一步做到位？

问题在于，大模型虽然具备很强的模式补全和语言推理能力，但在真实任务里仍有几个明显短板：

- **单次输出容易贪图局部最优**：模型会倾向于尽快生成一个看起来合理的答案，而不是系统性探索；
- **缺少显式搜索机制**：没有天然的分支扩展、评分、回溯与剪枝能力；
- **长期状态不稳定**：多轮任务一长，前后约束可能漂移；
- **外部环境变化不可预知**：工具返回的数据、接口错误、查询结果不足，都需要动态应对；
- **成本敏感**：无限制“深思熟虑”会迅速带来 token 和延迟膨胀。

因此，工程上通常不会把“推理能力”完全交给模型自由发挥，而是会在模型外侧增加一个**受控的规划框架**。这正是 ReAct、ToT、GoT、Plan-and-Execute 等模式存在的意义。

### 1.3 推理模式的演进脉络

可以把这些方法理解为四次能力升级：

#### 第一阶段：显式中间推理
代表方法：**Chain-of-Thought（CoT）**。

目标是让模型不要直接给结论，而是先展开中间思考步骤。它解决的是“答案跳跃”“复杂问题一步算错”的问题。

#### 第二阶段：推理与行动闭环
代表方法：**ReAct**。

模型不仅要想，还要调用工具，再根据 Observation 继续判断。它解决的是“只靠脑补不够，需要真实世界反馈”的问题。

#### 第三阶段：多路径搜索
代表方法：**Tree-of-Thought（ToT）**。

模型不再只沿着一条推理链走到底，而是探索多个分支，并在过程中打分、回溯、剪枝。它解决的是“单路径容易走偏”的问题。

#### 第四阶段：图式重组与证据聚合
代表方法：**Graph-of-Thought（GoT）**。

不同想法节点之间不再局限于树形父子关系，而是允许交叉引用、合并、再推导。它更适合多源证据融合、复杂约束求解、跨阶段知识重组。

此外，**Plan-and-Execute** 虽然不一定强调“搜索”，但在工程上非常重要，因为它把“规划”和“执行”拆成两个清晰阶段，使系统更可控、更容易审计，也更适合长任务流水线。

### 1.4 为什么本文把 ReAct、ToT、GoT、Plan-and-Execute 放在一起讲

因为在真实系统中，它们通常不是互斥关系，而是会组合使用：

- 一个 Plan-and-Execute 的执行器内部，可以是 ReAct；
- ToT 的每个节点扩展过程，可以借助 CoT 生成候选；
- GoT 可以把多个 ReAct 轨迹或多个 ToT 分支汇总成图；
- 生产系统还可以基于任务复杂度动态选择模式。

所以，理解它们最好的方式，不是背定义，而是回答四个问题：

1. **它的状态单位是什么？** 是一步想法、一步行动，还是一个节点、一个计划？
2. **它如何扩展候选路径？** 单路前进、树形分叉，还是图结构重组？
3. **它如何评估与修正？** 靠 Observation、打分器、回溯器还是聚合器？
4. **它的成本结构是什么？** token 消耗、工具调用次数、延迟、复杂度分别如何？

后文会围绕这四个问题展开。

---

## 二、Chain-of-Thought（CoT）基础与变体

### 2.1 CoT 是什么

Chain-of-Thought，通常译作“思维链”或“链式思考”，核心思想很简单：**不要让模型直接输出答案，而是鼓励它先写出中间推理步骤，再得出结论。**

例如用户问：

> 某电商平台上月订单 12000 单，本月增长 15%，其中退款率从 4% 降到 3.5%，请估算本月净完成订单数。

直接问答案时，模型可能一步算错；而要求“逐步思考”时，它往往会先算本月订单总数，再算退款订单数，最后得出净完成数。

CoT 的本质并不是“让模型更聪明”，而是让复杂任务变成**更容易被语言模型逐步补全的序列**。

### 2.2 CoT 解决了什么问题

CoT 对以下场景尤其有效：

- 多步算术与符号推理；
- 需要显式列出前提与结论关系的问题；
- 长回答中容易遗漏约束的任务；
- 需要对决策过程进行可审计展示的业务场景。

但它也有明显边界：

- 它主要强化的是**单路径展开**；
- 它默认模型可以靠内部知识完成推理；
- 如果中间某一步错了，后续往往在错误链上继续展开；
- 它不天然具备“探索多个候选路径”的能力。

所以，CoT 更像是后续所有规划模式的“基础语言接口”，而不是完整的 Agent 规划方案。

### 2.3 CoT 的典型变体

#### 2.3.1 Zero-shot CoT

最简单的方式，就是在提示词里追加一句：

> 请一步一步思考。

这类方式实现成本低，但稳定性一般，受模型和任务类型影响很大。

#### 2.3.2 Few-shot CoT

给模型几个“问题—推理过程—答案”的范例，再让它模仿。相比 zero-shot，few-shot CoT 更稳定，也更能约束输出格式。

#### 2.3.3 Self-Consistency

不是只生成一条思维链，而是采样多条，再对最终答案做投票或聚合。它的核心思想其实已经有了 ToT 的影子：**不要迷信单条推理链**。

#### 2.3.4 Program-of-Thought / Tool-augmented CoT

把部分推理外包给代码或工具，例如数学计算交给 Python、检索交给搜索引擎。它开始从“纯文本思考”走向“思考 + 外部验证”。这一步就是通向 ReAct 的桥梁。

### 2.4 CoT 在 Agent 中的正确定位

在 Agent 系统里，CoT 不应被视为终点，而应被视为：

- **候选步骤生成器**；
- **子任务解释器**；
- **规划草案生成器**；
- **执行后总结器**。

换句话说，CoT 是语言化推理的基础层，但当任务涉及工具、环境、搜索、回溯时，仅靠 CoT 通常不够。

### 2.5 一个最小 CoT 示例（LangChain）

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.2)

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个擅长结构化推理的助手。先给出简洁的步骤，再输出结论。"),
    ("human", "问题：{question}\n请使用 Chain-of-Thought 风格逐步分析，但最终答案要单独列出。")
])

chain = prompt | llm
result = chain.invoke({
    "question": "一个项目本周完成 32 个需求，比上周多 25%，上周完成多少个需求？"
})

print(result.content)
```

这个例子很简单，但它体现了一个重要事实：**CoT 是“让模型显式展开思考”，而不是“让系统具备环境交互能力”**。一旦问题需要查真实数据或多路径试探，就要进入下一层模式。

---

## 三、ReAct 模式详解：Reasoning + Acting 交替执行

### 3.1 ReAct 的核心思想

ReAct = **Reasoning + Acting**。与 CoT 最大的区别在于：模型不只是“想”，还会在过程中调用工具，并根据工具返回结果继续思考。

它的基本循环通常如下：

1. Thought：我现在需要做什么；
2. Action：调用哪个工具；
3. Observation：工具返回了什么；
4. Thought：根据观察结果，下一步怎么办；
5. 如此循环，直到 Final Answer。

这个模式特别适合以下任务：

- 检索资料后再总结；
- 先查数据库、再补查外部 API、最后生成结论；
- 多步骤故障排查；
- 需要根据中间结果动态改变路径的任务。

### 3.2 ReAct 为什么有效

ReAct 的关键价值不在于“可调用工具”这件事本身，而在于它建立了一个**闭环决策过程**：

- 推理告诉系统“下一步最值得做什么”；
- 行动让系统接触真实世界；
- 观察为后续推理提供更新后的状态。

在很多业务中，用户问题并不是知识问答，而是一个“需要探索的环境”。例如：

> 帮我定位为什么昨天夜里订单同步失败，并给出最可能的原因。

这时模型不可能只靠参数记忆回答，它必须：

- 查日志；
- 查任务调度状态；
- 查数据库积压；
- 查第三方接口错误码；
- 综合判断主因。

这类任务，ReAct 往往是最先能跑通的模式。

### 3.3 ReAct 的状态机视角

从系统设计角度，ReAct 可以抽象为一个循环状态机：

```text
User Input
   ↓
Reason Step
   ↓
Decide: Final Answer ?
   ├─ yes → return
   └─ no  → Tool Action
                ↓
           Observation
                ↓
          Append to scratchpad
                ↓
             Next Reason Step
```

关键状态包括：

- `input`：用户目标；
- `scratchpad`：历史 Thought / Action / Observation；
- `available_tools`：可用工具列表及参数 schema；
- `step_count`：当前步数；
- `termination_condition`：是否可终止；
- `safety_guard`：最大步数、最大工具调用数、异常重试策略。

### 3.4 ReAct 的提示词结构

经典 ReAct Prompt 一般会包含：

- 角色定义；
- 可用工具说明；
- 输出格式约束；
- 循环格式，例如 Thought / Action / Action Input / Observation；
- 何时给出 Final Answer 的规则。

例如：

```text
你是一个可以使用工具的智能助手。

你可以使用以下工具：
1. search_docs(query)
2. get_order(order_id)
3. check_log(service, time_range)

请严格遵循以下格式：
Thought: 分析当前需要做什么
Action: 工具名
Action Input: JSON 参数
Observation: 工具返回结果
...
Thought: 我已经有足够信息
Final Answer: 给出最终答案
```

实践中，很多现代框架会把 ReAct 格式隐藏在函数调用或图状态中，但底层逻辑并没有变。

### 3.5 ReAct 的优点与局限

#### 优点

1. **直观**：非常符合“先想后做”的人类问题解决方式；
2. **可解释**：每一步都能看到做了什么、为什么做；
3. **对工具友好**：适合检索、API、数据库、代码执行器等外部工具；
4. **实现门槛低**：是大部分 Agent 框架最先支持的模式。

#### 局限

1. **局部贪心**：每一步基于当前状态做局部最优决策，缺少全局规划；
2. **容易绕路**：工具多、信息杂时，可能重复查同类信息；
3. **成本不稳定**：遇到模糊任务时可能步数膨胀；
4. **缺少分支探索**：通常只沿一条链往前走，错误路径上的恢复能力有限。

所以，ReAct 很适合中等复杂度、路径可随观察动态调整的任务，但不一定适合需要系统性搜索的大型规划问题。

### 3.6 LangChain 中的 ReAct 示例

下面给出一个偏实战的例子：用户提出“找出某篇文章的主题，并给出 3 条摘要结论”。Agent 先检索文档，再读取内容，最后总结。

```python
from typing import List
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent, AgentExecutor
from langchain_core.prompts import PromptTemplate

DOCS = {
    "react": "ReAct combines reasoning and acting. It interleaves tool usage with thought updates.",
    "tot": "Tree-of-Thought expands multiple candidate reasoning paths and uses evaluation to prune.",
}

@tool
def search_docs(query: str) -> str:
    """根据查询词搜索文档标题"""
    results: List[str] = [k for k in DOCS if query.lower() in k.lower()]
    return ", ".join(results) if results else "未找到匹配文档"

@tool
def read_doc(name: str) -> str:
    """读取指定文档内容"""
    return DOCS.get(name, "文档不存在")

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
tools = [search_docs, read_doc]

prompt = PromptTemplate.from_template("""
Answer the following questions as best you can. You have access to the following tools:

{tools}

Use the following format:
Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Question: {input}
Thought:{agent_scratchpad}
""")

agent = create_react_agent(llm=llm, tools=tools, prompt=prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True, max_iterations=6)

result = executor.invoke({"input": "请找出与 ReAct 相关的文档，并总结 3 个关键点"})
print(result["output"])
```

这个例子说明了 ReAct 的几个工程要点：

- 通过工具暴露外部环境；
- 通过 `max_iterations` 防止无限循环；
- 通过 `verbose=True` 便于观察执行轨迹；
- 通过 prompt 约束循环格式。

### 3.7 LlamaIndex 中的 ReAct Agent 示例

```python
from llama_index.core.tools import FunctionTool
from llama_index.llms.openai import OpenAI
from llama_index.core.agent import ReActAgent

ARTICLES = {
    "agent": "AI Agent needs memory, planning, tool use and reflection.",
    "planning": "Planning lets an agent decompose tasks and revise strategy dynamically."
}

def search_article(keyword: str) -> str:
    matches = [k for k in ARTICLES if keyword.lower() in k.lower()]
    return ", ".join(matches) if matches else "无结果"


def get_article(name: str) -> str:
    return ARTICLES.get(name, "无此文章")

search_tool = FunctionTool.from_defaults(fn=search_article)
read_tool = FunctionTool.from_defaults(fn=get_article)

llm = OpenAI(model="gpt-4o-mini")
agent = ReActAgent.from_tools(
    tools=[search_tool, read_tool],
    llm=llm,
    verbose=True,
    max_iterations=6,
)

response = agent.chat("请搜索 planning 相关文章，并说明它与 AI Agent 的关系。")
print(str(response))
```

LlamaIndex 的 `ReActAgent` 更强调“工具—状态—响应”的封装，适合与索引、检索、知识库整合。

---

## 四、Tree-of-Thought（ToT）：分支探索与回溯剪枝

### 4.1 为什么需要 ToT

ReAct 虽然能动态调用工具，但通常还是**单路径前进**：在每一步只选一个当前看起来最合理的动作。问题是，复杂任务里“看起来最合理”的下一步，未必通向最优答案。

例如以下问题：

- 设计一个满足多约束的系统方案；
- 从多个候选策略中找出收益最高且风险最低的一种；
- 复杂逻辑谜题、博弈、排期、路径规划；
- 需要尝试多个思路后再决定答案的开放式任务。

这些任务常见的问题是：**单条思维链很容易过早承诺一个方向**。ToT 的出现，就是为了给模型引入显式的分支搜索能力。

### 4.2 ToT 的核心机制

Tree-of-Thought 可以理解为“把思考过程从链变成树”。

基本流程通常是：

1. 基于当前状态生成多个候选想法；
2. 对每个候选进行自评估或外部评估；
3. 保留较优分支，淘汰较差分支；
4. 对保留下来的分支继续扩展；
5. 若某个分支无效，则回溯到上层重新选择；
6. 最终从若干候选解中选出最优答案。

这本质上很像启发式搜索，只不过“状态扩展器”和“评分器”部分由 LLM 承担。

### 4.3 ToT 与 CoT、ReAct 的差异

| 模式 | 结构 | 是否工具交互 | 是否多分支 | 是否显式回溯 |
|---|---|---|---|---|
| CoT | 链 | 否/弱 | 否 | 否 |
| ReAct | 链式循环 | 强 | 一般否 | 弱 |
| ToT | 树 | 可有可无 | 是 | 是 |

ToT 并不是“替代 ReAct”，而是把“下一个想法怎么选”从一次性决策升级为**候选生成 + 评估 + 搜索**。

### 4.4 ToT 的关键组件

#### 4.4.1 Thought Generator

给定当前状态，生成 `k` 个候选下一步想法。例如：

- 方案 A：先做需求归类；
- 方案 B：先做成本估算；
- 方案 C：先做风险识别。

#### 4.4.2 State Evaluator

对每个候选状态进行评分，可以是：

- LLM 自评；
- 规则评分；
- 模型 + 规则混合评分；
- 外部模拟器/验证器评分。

#### 4.4.3 Search Policy

决定保留多少个分支，以及搜索策略：

- BFS：广度优先；
- DFS：深度优先；
- Beam Search：保留 Top-K；
- Best-first Search：优先扩展高分节点。

#### 4.4.4 Pruning & Backtracking

低分分支被剪掉，发现死路时回溯。这正是 ToT 能超过单链推理的核心原因。

### 4.5 一个简化的 ToT 伪代码

```python
root = initial_state(question)
frontier = [root]

for depth in range(max_depth):
    candidates = []
    for node in frontier:
        thoughts = generate_thoughts(node, k=3)
        for thought in thoughts:
            child = expand(node, thought)
            child.score = evaluate(child)
            candidates.append(child)

    frontier = select_top_k(candidates, k=beam_width)

best = choose_best(frontier)
return best.answer
```

真正上线时，还需要加上：

- 重复状态检测；
- 成本预算控制；
- 早停条件；
- 无效分支回滚；
- 节点缓存。

### 4.6 ToT 的典型应用场景

ToT 更适合这些问题：

1. **方案设计**：多个可选架构需要比较；
2. **复杂决策**：需要在收益、风险、复杂度之间平衡；
3. **逻辑题/规划题**：需要试错和回溯；
4. **生成式搜索**：要先生成多个方案，再筛选最优。

如果任务只是“查一个 API 再总结”，ToT 往往过重；但如果任务是“设计一套 6 个月内可上线的 Agent 平台架构并给出阶段路线图”，ToT 就很有价值。

### 4.7 LangChain 风格的 ToT 示例

LangChain 并没有一个像 ReAct 那样固定的官方 ToT 高阶封装，但可以借助 Runnable 或 LangGraph 自己实现。下面给出一个简化版示例：

```python
from dataclasses import dataclass, field
from typing import List
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)

@dataclass
class ThoughtNode:
    content: str
    depth: int
    score: float = 0.0
    history: List[str] = field(default_factory=list)

expand_prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个策略规划助手。请基于当前状态生成多个不同的下一步思路。"),
    ("human", "任务：{task}\n当前历史：{history}\n请生成 3 个候选下一步思路，每条一行。")
])

score_prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个严格的评估器，请从可行性、信息增益、风险控制三个维度打分。"),
    ("human", "任务：{task}\n候选思路：{candidate}\n请输出 0-10 的总分，只输出数字。")
])


def expand(task: str, node: ThoughtNode) -> List[ThoughtNode]:
    text = (expand_prompt | llm).invoke({
        "task": task,
        "history": " | ".join(node.history + [node.content])
    }).content
    lines = [x.strip("-• \n") for x in text.splitlines() if x.strip()]
    return [ThoughtNode(content=line, depth=node.depth + 1, history=node.history + [node.content]) for line in lines[:3]]


def score(task: str, node: ThoughtNode) -> float:
    text = (score_prompt | llm).invoke({"task": task, "candidate": node.content}).content.strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def tree_of_thought(task: str, max_depth: int = 3, beam_width: int = 2):
    frontier = [ThoughtNode(content="开始分析任务", depth=0, history=[])]

    for _ in range(max_depth):
        candidates = []
        for node in frontier:
            children = expand(task, node)
            for child in children:
                child.score = score(task, child)
                candidates.append(child)
        frontier = sorted(candidates, key=lambda n: n.score, reverse=True)[:beam_width]

    return frontier

best_nodes = tree_of_thought("为一家中型 SaaS 公司设计 AI Agent 平台路线图")
for n in best_nodes:
    print(n.score, n.content, n.history)
```

这个版本足够表达 ToT 的工程核心：**先扩，再评，再选**。

### 4.8 LlamaIndex 思路下的 ToT 实现

LlamaIndex 没有统一命名的 ToT Agent，但它适合把“节点状态 + 评估器 + 工作流”做成组合式流程。你可以借助 Workflow 或 QueryPipeline 构造一个多分支评估器：

```python
from dataclasses import dataclass, field
from typing import List
from llama_index.llms.openai import OpenAI

llm = OpenAI(model="gpt-4o-mini")

@dataclass
class Node:
    text: str
    score: float = 0.0
    parent_path: List[str] = field(default_factory=list)


def generate_candidates(task: str, context: str) -> List[str]:
    prompt = f"""
任务：{task}
当前上下文：{context}
请生成 3 个不同的下一步策略候选，每条一句话。
"""
    resp = llm.complete(prompt).text
    return [x.strip("-• \n") for x in resp.splitlines() if x.strip()][:3]


def evaluate_candidate(task: str, candidate: str) -> float:
    prompt = f"""
请为以下候选策略打分（0-10），只输出数字。
任务：{task}
候选：{candidate}
"""
    resp = llm.complete(prompt).text.strip()
    try:
        return float(resp)
    except Exception:
        return 0.0
```

后续逻辑与前一个例子类似。重点并不是框架 API，而是你要把**状态节点、扩展器、评估器、选择器**分离出来。

### 4.9 ToT 的工程代价

ToT 的收益来自更充分的搜索，但成本也非常直接：

- 分支数越多，token 成本越高；
- 评估器调用越频繁，延迟越高；
- 若每个分支都调用工具，外部成本会指数放大；
- 调参难度明显高于 ReAct。

因此 ToT 最适合：**高价值、低频、允许较高推理预算**的任务，而不适合每秒数百请求的低延迟 API 场景。

---

## 五、Graph-of-Thought（GoT）：图结构推理与节点聚合

### 5.1 为什么树还不够

Tree-of-Thought 解决了“单链不够”的问题，但树结构仍有一个限制：每个节点通常只属于某一条父子链路。现实中的复杂推理往往不是严格树形，而是：

- 某个中间结论可以被多个分支复用；
- 来自不同路径的证据可以合并成新的判断；
- 一个节点可能依赖多个前置节点，而不是单一父节点；
- 推理过程中可能需要“重组”之前的部分结果。

这就需要比树更灵活的结构：**图**。

### 5.2 GoT 的核心思想

Graph-of-Thought 的核心不是简单地“分更多支”，而是把思考过程表示为一个图：

- **节点（Node）**：一个子问题、一个中间结论、一段证据、一个候选假设；
- **边（Edge）**：节点之间的依赖关系、支持关系、冲突关系、组合关系；
- **图操作（Graph Operations）**：扩展、合并、重写、聚合、排序、过滤。

相较于 ToT，GoT 更强调：

1. **非线性组合**；
2. **跨分支信息复用**；
3. **多源证据聚合**；
4. **复杂结构搜索与重写**。

### 5.3 GoT 适合什么问题

GoT 很适合以下任务：

- 法务/风控/投研等多证据归因；
- 多文档问答与跨段推理；
- 复杂架构设计，需要综合多个子维度结论；
- 研究型任务，需要把不同假设与证据组织成论证图；
- 代码分析，需要把调用链、异常链、配置链合并起来判断问题。

例如定位线上事故时，可以把以下内容变成图节点：

- 节点 A：网关错误率上升；
- 节点 B：数据库连接池耗尽；
- 节点 C：凌晨发布新版本；
- 节点 D：缓存命中率下降；
- 节点 E：第三方支付接口超时。

然后通过“支持/冲突/因果/依赖”边构建关系图，再由聚合器生成更稳健的根因判断。

### 5.4 GoT 与知识图谱的区别

很多人看到“图结构推理”会想到知识图谱。二者有关联，但并不一样：

- 知识图谱偏向**静态事实组织**；
- GoT 偏向**动态推理过程组织**；
- 知识图谱里的边多是事实关系；
- GoT 里的边可以表示“由谁推导而来”“哪些结论相互支持”“哪些节点可合并”。

所以，GoT 更像是**推理过程的计算图**。

### 5.5 GoT 的关键能力模块

#### 5.5.1 Node Generation

从问题、文档、工具观察结果中抽取节点。

例如：

- 从日志中抽出异常事实；
- 从检索结果中抽出关键论点；
- 从多个候选方案中抽出核心约束。

#### 5.5.2 Edge Construction

建立节点之间的关系。常见边类型包括：

- supports：支持；
- contradicts：冲突；
- depends_on：依赖；
- derived_from：推导自；
- merges_into：合并到。

#### 5.5.3 Node Aggregation

把多个相关节点合并为一个更高层抽象，例如：

- 多个错误日志合并成“数据库资源不足”；
- 多条用户反馈合并成“支付链路体验恶化”；
- 多个候选设计点合并成“推荐采用分阶段落地策略”。

#### 5.5.4 Graph Rewriting

随着新证据进入，对图进行修正：

- 删除过时节点；
- 调整边权重；
- 合并重复节点；
- 重新排序关键路径。

### 5.6 一个简化 GoT 数据结构示例

```python
from dataclasses import dataclass, field
from typing import Dict, List

@dataclass
class ThoughtGraph:
    nodes: Dict[str, str] = field(default_factory=dict)
    edges: List[dict] = field(default_factory=list)

    def add_node(self, node_id: str, content: str):
        self.nodes[node_id] = content

    def add_edge(self, source: str, target: str, relation: str):
        self.edges.append({
            "source": source,
            "target": target,
            "relation": relation
        })
```

这当然只是起点。真正的工程实现中，节点一般还会带：

- score / confidence；
- provenance（证据来源）；
- timestamp；
- status（候选、已验证、已淘汰）；
- embedding / semantic signature（用于去重与聚类）。

### 5.7 LangChain/LangGraph 风格的 GoT 示例

GoT 更适合用状态图或自定义图执行器来实现。下面是一个简化思路：

```python
from dataclasses import dataclass, field
from typing import List, Dict
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.2)

@dataclass
class GraphState:
    question: str
    nodes: Dict[str, str] = field(default_factory=dict)
    edges: List[dict] = field(default_factory=list)
    summaries: List[str] = field(default_factory=list)


def extract_nodes(state: GraphState) -> GraphState:
    prompt = f"""
针对问题：{state.question}
请给出 4 个关键推理节点，每行一个，格式为：节点名: 内容
"""
    text = llm.invoke(prompt).content
    for line in text.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            state.nodes[k.strip()] = v.strip()
    return state


def build_edges(state: GraphState) -> GraphState:
    joined = "\n".join([f"{k}: {v}" for k, v in state.nodes.items()])
    prompt = f"""
给定以下节点：
{joined}
请建立节点关系，每行格式：源 -> 目标 -> 关系
关系只能是 supports / depends_on / contradicts / merges_into
"""
    text = llm.invoke(prompt).content
    for line in text.splitlines():
        parts = [x.strip() for x in line.split("->")]
        if len(parts) == 3:
            state.edges.append({"source": parts[0], "target": parts[1], "relation": parts[2]})
    return state


def aggregate(state: GraphState) -> GraphState:
    joined_nodes = "\n".join([f"{k}: {v}" for k, v in state.nodes.items()])
    joined_edges = "\n".join([f"{e['source']} -> {e['target']} -> {e['relation']}" for e in state.edges])
    prompt = f"""
问题：{state.question}
节点：
{joined_nodes}
关系：
{joined_edges}
请基于图结构聚合为一段结论，并指出最关键的 2 个支撑节点。
"""
    state.summaries.append(llm.invoke(prompt).content)
    return state
```

这个示例并未展示完整的图搜索，但能反映 GoT 的核心区别：**系统保存的不是单条链，而是一组可组合节点及其关系**。

### 5.8 LlamaIndex 中实现 GoT 的思路

LlamaIndex 非常适合做“文档节点 → 检索结果 → 关系组织 → 汇总生成”。如果你已经在用它做 RAG，可以自然延伸到 GoT：

- 用索引取回多个候选片段；
- 抽取每个片段的关键命题作为节点；
- 基于节点相似度、因果词、支持词构建边；
- 用聚合器输出最终结论。

一个轻量示例：

```python
from llama_index.llms.openai import OpenAI

llm = OpenAI(model="gpt-4o-mini")

def aggregate_graph(question: str, node_texts: list[str], edges: list[dict]) -> str:
    nodes_block = "\n".join(f"- {n}" for n in node_texts)
    edges_block = "\n".join(
        f"- {e['source']} -> {e['target']} ({e['relation']})" for e in edges
    )
    prompt = f"""
问题：{question}
节点列表：
{nodes_block}
关系列表：
{edges_block}
请给出：
1. 核心结论
2. 关键证据链
3. 仍需补充验证的点
"""
    return llm.complete(prompt).text
```

### 5.9 GoT 的价值与难点

#### 价值

- 对复杂证据整合更强；
- 能复用节点，减少重复推理；
- 更适合大型分析任务与研究类任务；
- 便于后续可视化与审计。

#### 难点

- 实现复杂度高于 ToT；
- 节点抽取与边构建质量直接决定效果；
- 图规模一大，管理和评估都很难；
- 框架层支持尚不如 ReAct 成熟，需要更多自定义工程。

如果说 ReAct 是“让 Agent 会做事”，ToT 是“让 Agent 会搜索”，那么 GoT 则是“让 Agent 会组织复杂推理结构”。

---

## 六、Plan-and-Execute：先规划后执行的两阶段模式

### 6.1 Plan-and-Execute 的定位

Plan-and-Execute 不是严格意义上与 ReAct、ToT、GoT 同层竞争的“推理图结构”，而是一种非常实用的**执行架构模式**。

它把一个复杂任务拆成两个阶段：

1. **Plan**：先产出一份相对完整的执行计划；
2. **Execute**：按步骤执行，每一步可以再调用工具，必要时局部重规划。

与纯 ReAct 相比，它的最大特点是：**先做全局框架，再做局部动作**。

### 6.2 为什么工程上很喜欢 Plan-and-Execute

因为很多业务任务并不是一步一步“走到哪算哪”，而是天然需要先有一个总路线：

- 撰写竞品分析报告；
- 生成项目落地方案；
- 自动化执行跨多个系统的运维任务；
- 长流程客服工单处理；
- 研究任务拆解。

如果直接用 ReAct，系统可能陷入：

- 没有先后顺序；
- 频繁切换上下文；
- 步骤遗漏；
- 重复查资料。

而 Plan-and-Execute 的 planner 先输出一个“骨架”，可显著提升稳定性与可审计性。

### 6.3 一个典型执行流程

```text
User Goal
   ↓
Planner → 生成步骤列表 / 里程碑 / 依赖关系
   ↓
Executor → 执行第 1 步
   ↓
Check → 是否完成 / 是否需要重规划
   ↓
Executor → 执行第 2 步 ...
   ↓
Final Synthesis
```

在很多系统中，Executor 内部其实还是 ReAct Agent。也就是说：

- **全局上**：Plan-and-Execute；
- **局部上**：ReAct；
- **更复杂的局部决策**：甚至可以再嵌 ToT。

### 6.4 Plan-and-Execute 适合什么任务

- 步骤数较多的任务；
- 步骤之间依赖关系明确；
- 需要给用户展示计划进度；
- 任务可以拆成一系列独立或半独立子任务；
- 希望在执行前做人类审批或策略审核。

### 6.5 LangChain 中的两阶段实现示例

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

planner_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.2)
executor_llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

plan_prompt = ChatPromptTemplate.from_messages([
    ("system", "你是资深任务规划器，请将目标拆分为清晰、可执行、可验证的步骤。"),
    ("human", "任务目标：{goal}\n请输出 5-8 个步骤，每步一句话。")
])

execute_prompt = ChatPromptTemplate.from_messages([
    ("system", "你是任务执行器，请基于当前步骤与上下文完成执行。"),
    ("human", "总目标：{goal}\n当前步骤：{step}\n已完成上下文：{context}\n请给出该步骤的执行结果。")
])


def plan(goal: str) -> list[str]:
    text = (plan_prompt | planner_llm).invoke({"goal": goal}).content
    return [x.strip("0123456789.- )") for x in text.splitlines() if x.strip()]


def execute(goal: str, steps: list[str]) -> list[str]:
    completed = []
    for step in steps:
        result = (execute_prompt | executor_llm).invoke({
            "goal": goal,
            "step": step,
            "context": "\n".join(completed)
        }).content
        completed.append(f"步骤：{step}\n结果：{result}")
    return completed
```

### 6.6 LlamaIndex 中的实现思路

LlamaIndex 更适合把 planner 和 executor 作为两个 workflow stage：

- `planner_step` 生成任务列表；
- `executor_step` 对每个任务调工具或查询索引；
- `synthesizer_step` 汇总结果；
- `replan_step` 在失败或信息不足时重新规划。

### 6.7 Plan-and-Execute 的优势与不足

#### 优势

- 全局结构更清晰；
- 执行更稳定，遗漏更少；
- 易于记录进度与审计；
- 可插入审批与人工干预。

#### 不足

- 初始计划不一定正确；
- 环境变化大时，计划可能快速过时；
- 对短任务来说有额外开销；
- 若 planner 质量差，后续执行会被误导。

因此，Plan-and-Execute 不是万金油，但在长任务和业务流程型任务中，非常值得优先考虑。

---

## 七、四种模式的代码实现：LangChain / LlamaIndex 示例

这一节做一个横向归纳，把四种模式放在同一张工程地图里理解。

### 7.1 ReAct：工具闭环最直接

**适合**：检索、查询、故障排查、工具调用链。  
**实现重点**：工具 schema、循环控制、最大步数、输出解析。

LangChain 常见方案：

- `create_react_agent`
- `AgentExecutor`
- LangGraph 自定义状态图

LlamaIndex 常见方案：

- `ReActAgent.from_tools`
- 工具 + 索引 + 记忆组合

### 7.2 ToT：需要自己组织搜索器

**适合**：复杂决策、方案搜索、开放式策略生成。  
**实现重点**：

- 候选生成器；
- 节点评估器；
- Beam Search / BFS / DFS；
- 剪枝条件；
- 成本控制。

LangChain 里更偏“自己搭”；LlamaIndex 也多是自定义 workflow。

### 7.3 GoT：适合状态图和图数据库思维

**适合**：多证据推理、跨文档结论融合、复杂归因分析。  
**实现重点**：

- 节点抽取；
- 边构建；
- 图聚合；
- 节点去重；
- 图可视化和可解释性。

你甚至可以把 GoT 与 Neo4j、NetworkX、图数据库、向量索引组合起来做混合推理。

### 7.4 Plan-and-Execute：更像工作流骨架

**适合**：长任务、可拆分任务、流水线式任务。  
**实现重点**：

- planner 质量；
- step schema；
- executor 幂等；
- replan 机制；
- 审计日志。

### 7.5 一个统一抽象接口设计示例

如果你希望在系统中灵活切换模式，可以定义统一接口：

```python
from abc import ABC, abstractmethod
from typing import Any, Dict

class ReasoningStrategy(ABC):
    @abstractmethod
    def run(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        pass

class ReActStrategy(ReasoningStrategy):
    def run(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        return {"mode": "react", "result": "..."}

class TreeOfThoughtStrategy(ReasoningStrategy):
    def run(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        return {"mode": "tot", "result": "..."}

class GraphOfThoughtStrategy(ReasoningStrategy):
    def run(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        return {"mode": "got", "result": "..."}

class PlanExecuteStrategy(ReasoningStrategy):
    def run(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        return {"mode": "plan_execute", "result": "..."}
```

然后配一个策略选择器：

```python
def choose_strategy(task_type: str, complexity: str) -> ReasoningStrategy:
    if task_type == "tool_use" and complexity == "low":
        return ReActStrategy()
    if task_type == "planning" and complexity == "medium":
        return PlanExecuteStrategy()
    if task_type == "search" and complexity == "high":
        return TreeOfThoughtStrategy()
    return GraphOfThoughtStrategy()
```

真实系统里，这个 selector 可以再结合：

- 预估步数；
- 用户 SLA；
- 成本预算；
- 历史成功率；
- 工具类型；
- 是否需要可解释轨迹。

---

## 八、性能对比：准确率 / Token 消耗 / 延迟 / 适用场景

不同模式的价值，不只在理论能力，还在工程成本结构。下面给出一个偏实践的比较框架。

### 8.1 总体比较表

| 模式 | 准确率潜力 | Token 消耗 | 延迟 | 实现复杂度 | 最适合场景 |
|---|---:|---:|---:|---:|---|
| CoT | 中 | 低-中 | 低 | 低 | 中等复杂度的文本推理 |
| ReAct | 中-高 | 中 | 中 | 中 | 多步工具调用、动态探索 |
| ToT | 高 | 高 | 高 | 高 | 复杂搜索、方案比较、回溯问题 |
| GoT | 高 | 高 | 高 | 很高 | 多证据聚合、复杂归因、研究分析 |
| Plan-and-Execute | 中-高 | 中 | 中 | 中 | 长任务、流程型任务、全局规划 |

### 8.2 准确率维度

#### CoT

相较于直接答案，CoT 往往能显著提升复杂推理正确率，但前提是任务仍属于单链可解。

#### ReAct

准确率往往高于纯 CoT，因为它能访问真实信息，减少纯脑补造成的错误。

#### ToT

在需要搜索与回溯的问题上，准确率通常优于 ReAct，尤其是在“初始路径很容易错”的任务上。

#### GoT

在多证据融合类任务里，GoT 的上限很高，因为它更适合组织复杂关系。不过如果节点抽取质量差，也可能因为噪声放大而失败。

#### Plan-and-Execute

准确率的关键不在“局部推理更强”，而在“全局步骤更少遗漏”。对于长链任务，它经常比纯 ReAct 更稳定。

### 8.3 Token 消耗维度

大致规律很简单：

- CoT：一条链；
- ReAct：一条链 + 工具观察上下文；
- ToT：多条链；
- GoT：多节点 + 多轮聚合；
- Plan-and-Execute：多一个 planner 阶段。

所以成本从低到高大致为：

```text
CoT < ReAct ≈ Plan-and-Execute < ToT ≤ GoT
```

但这里有个重要例外：

如果 ReAct 因为任务复杂而反复试错、调用很多工具，它的成本也可能超过一个收敛良好的 Plan-and-Execute。

### 8.4 延迟维度

延迟受两个因素影响：

1. LLM 调用轮数；
2. 外部工具耗时。

- CoT 通常最快；
- ReAct 的延迟受工具性能影响很大；
- ToT/GoT 因为多分支、多轮评估，延迟通常最高；
- Plan-and-Execute 会多出一个规划阶段，但执行更有序。

如果你的 API SLA 要求 2 秒内返回，ToT 和 GoT 基本很难作为默认策略，只能做离线或异步任务。

### 8.5 适用场景的经验法则

#### 优先用 CoT

当任务满足以下条件：

- 不需要真实外部信息；
- 步骤不多；
- 只需要清晰解释过程。

#### 优先用 ReAct

当任务满足以下条件：

- 需要工具调用；
- 需要根据中间结果更新策略；
- 步数在 3-8 步内较常见。

#### 优先用 ToT

当任务满足以下条件：

- 候选路径多；
- 错误路径代价高；
- 需要回溯；
- 愿意为更高成功率支付更多成本。

#### 优先用 GoT

当任务满足以下条件：

- 结论依赖多源证据聚合；
- 子结论之间关系复杂；
- 需要结构化论证图；
- 结果要高度可解释、可追溯。

#### 优先用 Plan-and-Execute

当任务满足以下条件：

- 是长任务；
- 适合拆成若干相对明确阶段；
- 需要进度展示、审计、审批、重试。

---

## 九、实战案例：用 ReAct 解决多步工具调用任务

下面用一个比较贴近企业场景的案例，说明 ReAct 的价值。

### 9.1 任务描述

假设你在做一个企业内部运维助手，用户提出问题：

> 请帮我定位为什么昨天 23:00 到 23:30 期间订单同步失败率升高，并给出最可能的原因和建议处理方式。

系统可用的工具有：

1. `query_metrics(service, start, end)`：查询指标；
2. `search_logs(service, keyword, start, end)`：查日志；
3. `check_deployments(service, start, end)`：查发布记录；
4. `get_incidents(start, end)`：查是否有已登记事故；
5. `query_db_health(cluster)`：查数据库健康状态。

这就是一个标准的 ReAct 任务：

- 目标明确，但路径未知；
- 需要外部数据；
- 每一步的结果会影响下一步。

### 9.2 为什么不适合直接问答

如果直接让模型回答，它很可能给出一个“像样但空泛”的答案：

- 可能是数据库压力大；
- 可能是接口超时；
- 可能是发布导致的问题。

这些都是常见原因，但**不是这个时间段真实发生的原因**。ReAct 的核心价值就在于：**强制系统先查证据，再归因。**

### 9.3 一个简化的工具定义

```python
from langchain.tools import tool

@tool
def query_metrics(service: str, start: str, end: str) -> str:
    """查询服务指标"""
    if service == "order-sync":
        return "23:00-23:30 失败率从 1.8% 升至 12.4%，平均延迟从 220ms 升至 1900ms"
    return "无数据"

@tool
def search_logs(service: str, keyword: str, start: str, end: str) -> str:
    """搜索日志"""
    if service == "order-sync" and keyword == "timeout":
        return "发现大量 payment_gateway timeout after 3s 错误"
    if service == "order-sync" and keyword == "db":
        return "少量数据库连接重试日志，但非主导错误"
    return "无明显异常"

@tool
def check_deployments(service: str, start: str, end: str) -> str:
    """检查发布记录"""
    return "23:12 order-sync 发布 v2.3.7，主要改动为支付状态补偿逻辑"

@tool
def get_incidents(start: str, end: str) -> str:
    """查询事故记录"""
    return "23:05-23:28 支付网关 P2 级别延迟升高事故已登记"

@tool
def query_db_health(cluster: str) -> str:
    """查询数据库状态"""
    return "数据库 CPU 42%，连接池正常，无明显慢查询峰值"
```

### 9.4 ReAct 执行轨迹示意

一个理想的 Agent 轨迹可能是这样：

```text
Thought: 我需要先确认问题范围和严重程度。
Action: query_metrics
Action Input: {"service":"order-sync","start":"2026-06-01 23:00","end":"2026-06-01 23:30"}
Observation: 失败率从 1.8% 升至 12.4%，平均延迟从 220ms 升至 1900ms

Thought: 高失败率伴随高延迟，先看是否有外部依赖超时。
Action: search_logs
Action Input: {"service":"order-sync","keyword":"timeout","start":"2026-06-01 23:00","end":"2026-06-01 23:30"}
Observation: 发现大量 payment_gateway timeout after 3s 错误

Thought: 再确认是否同期有已知事故。
Action: get_incidents
Action Input: {"start":"2026-06-01 23:00","end":"2026-06-01 23:30"}
Observation: 支付网关 P2 级别延迟升高事故已登记

Thought: 还需要排除数据库主因，以及检查是否有发布影响。
Action: query_db_health
Action Input: {"cluster":"order-db-main"}
Observation: 数据库 CPU 42%，连接池正常，无明显慢查询峰值

Action: check_deployments
Action Input: {"service":"order-sync","start":"2026-06-01 23:00","end":"2026-06-01 23:30"}
Observation: 23:12 发布 v2.3.7，主要改动为支付状态补偿逻辑

Thought: 已有足够证据。主因更可能是支付网关延迟事故，发布可能放大了重试压力，但数据库不是主因。
Final Answer: ...
```

### 9.5 使用 LangChain 搭建该 Agent

```python
from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent, AgentExecutor
from langchain_core.prompts import PromptTemplate

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

tools = [query_metrics, search_logs, check_deployments, get_incidents, query_db_health]

prompt = PromptTemplate.from_template("""
你是一个企业运维分析 Agent，负责通过工具定位故障原因。
请遵循以下原则：
1. 先确认指标异常，再查日志和事故，再排除其他候选原因；
2. 不要在证据不足时直接下结论；
3. 最终答案必须包含：现象、最可能原因、排除项、建议动作。

你可以使用以下工具：
{tools}

格式如下：
Question: 用户问题
Thought: 你的分析
Action: 工具名
Action Input: 输入参数
Observation: 工具结果
...（可重复）
Thought: 我已经有足够信息
Final Answer: 最终答案

Question: {input}
Thought:{agent_scratchpad}
""")

agent = create_react_agent(llm=llm, tools=tools, prompt=prompt)
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True,
    max_iterations=8,
    handle_parsing_errors=True,
)

result = executor.invoke({
    "input": "请帮我定位为什么昨天 23:00 到 23:30 期间订单同步失败率升高，并给出最可能的原因和建议处理方式。"
})

print(result["output"])
```

### 9.6 一个高质量 Final Answer 应该长什么样

最终答案理想上应具备如下结构：

```text
现象：2026-06-01 23:00-23:30 期间，order-sync 服务失败率从 1.8% 升至 12.4%，平均延迟从 220ms 升至 1900ms。

最可能原因：支付网关在同期发生已登记延迟事故，order-sync 日志中出现大量 payment_gateway timeout after 3s 错误，说明失败率升高的主因是外部支付依赖超时。

可能的放大因素：23:12 发布的 v2.3.7 涉及支付状态补偿逻辑，可能放大了重试或补偿请求数量，建议进一步核查该版本是否增加了外部调用频次。

已排除项：数据库状态总体正常，CPU 与连接池无明显异常，不支持“数据库为主因”的判断。

建议动作：
1. 回看 v2.3.7 对支付网关调用次数与重试策略的影响；
2. 在支付超时时增加熔断与退避重试；
3. 为 order-sync 增加按依赖类型拆分的失败率指标；
4. 对外部依赖事故建立自动降级策略。
```

这体现了 ReAct 在生产上的一个重要价值：**结论不是拍脑袋，而是带证据链与排除项。**

### 9.7 生产环境中如何把 ReAct 做稳

经验上，至少要补上以下机制：

- `max_iterations`：防止无限循环；
- 工具分类：读工具、写工具、高风险工具分开；
- 工具参数校验：避免错误调用；
- Observation 截断与摘要：防止上下文爆炸；
- 失败重试：工具错误时允许一次有限重试；
- 轨迹日志：保留 Thought/Action/Observation 便于审计；
- 输出模板化：Final Answer 统一为可消费结构。

---

## 十、生产环境中的推理模式选型指南

说到底，推理模式选择不是“学术上谁更先进”，而是“哪个模式在你的任务、预算和 SLA 下最合适”。

### 10.1 先看任务复杂度，而不是先看框架流行度

可按三个层次判断：

#### 低复杂度

- 1-3 步可完成；
- 很少分支；
- 不需要复杂回溯。

建议：**CoT 或轻量 ReAct**。

#### 中复杂度

- 3-10 步；
- 需要多次工具交互；
- 中间结果决定后续路径；
- 需要一定全局结构。

建议：**ReAct 或 Plan-and-Execute**。

#### 高复杂度

- 多种方案需要比较；
- 容易走错路；
- 需要多分支搜索或证据聚合；
- 容忍更高延迟与成本。

建议：**ToT 或 GoT**，必要时与 Plan-and-Execute 组合。

### 10.2 按任务类型选模式

#### 任务一：API 查询 / RAG 问答 / 工具检索

首选：**ReAct**  
原因：需要边查边判断，但通常不值得做复杂搜索。

#### 任务二：报告撰写 / 调研分析 / 长任务拆解

首选：**Plan-and-Execute**  
原因：先规划提纲，再逐段执行，结构稳定。

#### 任务三：复杂决策 / 路径规划 / 多方案评估

首选：**ToT**  
原因：需要探索多个候选，再进行选择与回溯。

#### 任务四：多文档归因 / 风控审核 / 研究论证

首选：**GoT**  
原因：结论依赖多节点、多关系、多轮聚合。

### 10.3 按系统约束选模式

#### 低延迟优先

如果你的接口必须 2-3 秒内返回：

- 默认用 CoT / 轻量 ReAct；
- ToT、GoT 作为异步增强链路；
- 对复杂任务改为“先给草答，后给深度版”。

#### 低成本优先

- 尽量减少多分支搜索；
- planner 可以用便宜模型，executor 用强模型；
- 先做任务分类，复杂任务才升级模式。

#### 高准确率优先

- 对高价值任务使用 ToT / GoT；
- 引入投票、自评估、验证器；
- 强化轨迹记录与失败回退。

#### 高可解释优先

- ReAct、GoT、Plan-and-Execute 都优于黑盒直答；
- 对审计型场景，优先保留中间过程与证据节点。

### 10.4 一个实用的决策树

```text
任务是否需要外部工具？
├── 否 → CoT
└── 是
    ├── 任务是否只有少量步骤、边做边判断即可？
    │   └── 是 → ReAct
    └── 否
        ├── 是否适合先拆成清晰阶段？
        │   └── 是 → Plan-and-Execute
        └── 否
            ├── 是否需要探索多个候选路径并回溯？
            │   └── 是 → ToT
            └── 是否需要跨证据、跨分支聚合关系图？
                └── 是 → GoT
```

### 10.5 一个更现实的建议：从简单模式起步，按失败模式升级

很多团队一上来就想用最复杂的结构，结果系统成本高、调试难、效果未必稳定。更现实的路线通常是：

1. **先用 ReAct 跑通基础闭环**；
2. 观察失败案例：
   - 如果常常遗漏步骤 → 引入 Plan-and-Execute；
   - 如果常常选错路径 → 引入 ToT；
   - 如果常常无法综合多源证据 → 引入 GoT；
3. 对高价值任务做模式升级，对普通任务维持简单模式；
4. 保持统一日志与状态接口，避免架构碎片化。

这其实是一条非常重要的工程原则：**不要为所有请求支付最贵的推理成本，而要为最难的问题准备更强的推理模式。**

---

## 十一、常见误区与落地建议

### 11.1 误区一：把“更长的思考”当成“更强的规划”

长推理不等于好推理。很多系统只是让模型说得更长，却没有真正引入：

- 状态表示；
- 候选扩展；
- 节点评估；
- 回溯与剪枝；
- 结果聚合。

真正的规划能力，来自结构，而不只是字数。

### 11.2 误区二：认为 ReAct 一定比 Plan-and-Execute 差

不一定。对于大量中短任务，ReAct 往往更高效、更直接，没必要强行加 planner。只有当任务长度、依赖关系、审计需求上来时，Plan-and-Execute 的优势才明显。

### 11.3 误区三：ToT/GoT 一定更先进，所以应该默认启用

更强的上限，通常意味着更高的成本与更复杂的调参。默认全量启用，很可能：

- 成本飙升；
- 延迟失控；
- 系统更难维护；
- 最终收益不及预期。

### 11.4 建议一：把“评估器”当成一等公民

无论 ToT 还是 GoT，效果好坏很大程度取决于评估器设计。评估器不一定非得是 LLM，可以是：

- 规则引擎；
- 业务指标函数；
- 单元测试 / 模拟器；
- 检索覆盖率；
- 人工反馈模型。

### 11.5 建议二：把“预算控制”写进推理框架

包括：

- 最大步数；
- 最大分支数；
- 最大工具调用数；
- 最大 token 预算；
- 超时后降级策略。

没有预算控制，再好的推理模式都难以上线。

### 11.6 建议三：记录中间状态，而不只是最终答案

如果只保存最终输出，你几乎无法定位系统失败原因。至少应记录：

- 每步输入输出；
- 工具调用参数；
- Observation；
- 节点评分；
- 选择/剪枝原因；
- 计划版本与重规划次数。

这对优化系统至关重要。

---

## 十二、总结：推理模式不是概念，而是 Agent 上限的工程抓手

如果把 AI Agent 看成一个“会说话的自动化脚本”，那你可能只会关注模型、工具和接口；但如果把它看成一个“在不确定环境中持续做决策的系统”，你就会意识到：**规划与推理模式，才是决定系统稳定性、上限与成本结构的关键层。**

本文讨论了五类核心方法：

- **CoT**：让模型显式展开中间推理，是一切规划模式的语言基础；
- **ReAct**：让模型在推理与行动之间交替，建立工具闭环，是最实用的 Agent 起点；
- **ToT**：引入多分支搜索、评估、回溯与剪枝，适合复杂决策与方案探索；
- **GoT**：用图结构组织多节点、多证据、多关系推理，适合研究型、归因型、聚合型任务；
- **Plan-and-Execute**：把全局规划与局部执行拆开，是长任务与业务流程任务中的高性价比模式。

如果你只能记住一句话，我建议是这句：

> **从 ReAct 跑通闭环，用 Plan-and-Execute 管理长任务，用 ToT 提升搜索质量，用 GoT 处理复杂证据聚合。**

这四种模式并不是教科书上的孤立概念，而是可以组合、渐进升级、按任务切换的工程能力层。真正成熟的 Agent 系统，往往不是押注某一种“最先进模式”，而是建立一套能够根据任务复杂度、预算与风险自动选择推理模式的机制。

当你开始这样设计系统时，AI Agent 才真正从“能回答问题”走向“能可靠地完成任务”。

## 相关阅读

- [AI Agent 编排模式实战：ReAct/Plan-and-Execute/Multi-Agent 协作架构设计](/categories/AI/2026-05-31-ai-agent-orchestration-patterns-react-plan-execute-multi-agent/)
- [AI Agent 工具调用实战：Function Calling 标准化与错误处理](/categories/AI/2026-06-02-ai-agent-function-calling-standardization-error-handling/)
- [Prompt Engineering 实战：Few-shot/CoT/Tool-use 提示词工程最佳实践](/categories/AI/2026-06-01-prompt-engineering-few-shot-cot-tool-use-best-practices/)
- [AI Agent 可观测性实战：LangSmith/LangFuse 追踪、调试、评估](/categories/AI/2026-06-02-ai-agent-observability-langsmith-langfuse-tracing-evaluation/)
