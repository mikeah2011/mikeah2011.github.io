---
title: AI Agent 可观测性实战：LangSmith/LangFuse 追踪、调试、评估
date: 2026-06-02 12:00:00
tags: [AI Agent, 可观测性, LangSmith, LangFuse, 追踪, 评估]
keywords: [AI Agent, LangSmith, LangFuse, 可观测性实战, 追踪, 调试, 评估, AI]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: "这篇 AI Agent 可观测性实战指南系统讲透 LangSmith 与 LangFuse 的追踪、监控、调试与评估方法，帮你快速建立从链路分析到质量回归的生产级观测闭环。"
---


在做 AI Agent 项目时，很多团队前期最关注的是三件事：模型够不够强、提示词写得好不好、工具调用能不能跑通。但项目一旦进入测试、灰度、上线阶段，真正决定系统是否可控、可调、可迭代的，往往不是“能不能回答”，而是“为什么这样回答”“哪里慢了”“为什么这次调用失败”“这一版是不是比上一版更好”。

这就是 AI Agent 可观测性（Observability）要解决的问题。

传统 Web 系统讲可观测性，通常会提到日志、指标、链路追踪三件套。到了 AI Agent 场景，这三件套仍然重要，但复杂度被放大了一个量级：一次用户请求可能触发多轮推理、多次工具调用、多个检索步骤、若干子 Agent 协作、不同模型回退，以及结构化输出校验。你看到的只是最后一句自然语言回复，但系统内部实际经历的是一条很长、很不稳定、且带有概率性的执行链。

因此，AI Agent 的可观测性不是“多打一些日志”这么简单，而是需要围绕 **Trace、Prompt、Tool、Token、Cost、Latency、Evaluation、Feedback** 建立一整套闭环。本文会结合 LangSmith 与 LangFuse 两个当前最常见的 AI 应用观测平台，系统讲清楚：

1. 为什么 AI Agent 必须做可观测性；
2. LangSmith 的 Tracing / Datasets / Evaluation 如何落地；
3. LangFuse 的自托管方案、Trace / Generation / Span 模型如何使用；
4. LangSmith 与 LangFuse 在功能、成本、开源、自托管上的差异；
5. 如何把 Trace 真正用于调试，而不是“看着热闹”；
6. 如何搭建自动评估与人工标注结合的质量体系；
7. 如何监控延迟、Token、成本，并进一步接入 Prometheus / Grafana；
8. 生产环境里有哪些最佳实践，以及常见踩坑。

如果你已经在用 LangChain、LangGraph、OpenAI SDK、Anthropic SDK、RAG、MCP、工具调用框架，本文内容都可以直接迁移。即使你不使用上述框架，只要你的系统里存在“用户输入 → LLM 推理 → 工具/检索/代码执行 → 输出”的链路，可观测性的原则依然完全成立。

---

## 一、为什么 AI Agent 需要可观测性

### 1.1 AI Agent 的复杂度远高于普通聊天机器人

一个简单的聊天接口，往往只有一次模型调用：

```text
用户输入 -> Prompt 组装 -> LLM -> 输出
```

而一个稍微像样的 Agent，链路往往会变成：

```text
用户输入
  -> 意图识别
  -> 会话状态加载
  -> 检索知识库
  -> 规划下一步行动
  -> 调用外部工具
  -> 读取工具结果
  -> 再次推理
  -> 可能触发第二个工具
  -> 结构化结果校验
  -> 最终自然语言生成
```

如果你再引入多 Agent 协作、长记忆、工作流图、异步任务、人工审批节点，那么一条请求背后可能包含几十个 span，甚至上百个事件。任何一步出问题，最后用户看到的都只是“结果不对”“回答很慢”“看起来胡说八道”。

没有观测平台时，开发者通常只能靠以下手段定位问题：

- 看应用日志；
- 在代码里 print prompt；
- 人工复现某个输入；
- 对比数据库记录；
- 猜测到底是模型问题、工具问题还是检索问题。

这种方式在 demo 阶段还能凑合，一旦进入生产环境，几乎不可维护。因为 AI Agent 的错误并不总是 deterministic：同样输入、同样提示词、不同时间点都可能得到不同结果。如果没有完整 trace，你甚至无法精确回放一次失败请求。

### 1.2 AI Agent 的问题并不只是“报错”，更常见的是“看起来能跑，但结果不理想”

传统服务的故障经常是明确失败，比如：

- HTTP 500；
- 数据库超时；
- 某个依赖服务不可用；
- 代码抛异常。

而 AI Agent 更麻烦的一类问题是“软故障”：

- 没报错，但答案偏题；
- 工具调用成功了，但参数错误；
- 检索召回了文档，但引用了错误段落；
- 多轮 Agent 推理存在循环，导致延迟飙升；
- 最终答案语气自然，但关键事实错了；
- 成本没有爆炸，但 token 消耗不断爬升；
- 某次版本更新后，正确率悄悄下降。

这类问题如果只看错误日志，通常什么也看不出来。你必须有一条从“输入 → 中间步骤 → 输出 → 评估结果”的完整记录，才能知道到底坏在哪一层。

### 1.3 AI Agent 的可观测性目标：不仅要看到，还要能分析、回放、评估、优化

我更倾向于把 AI Agent 的可观测性分成四层：

#### 第一层：看见发生了什么

这是最基础的一层，重点是 Trace。

你需要知道：

- 用户输入是什么；
- 系统 prompt 和拼接后的 messages 长什么样；
- 调用了哪个模型、哪个版本；
- 调了几次模型；
- 调用了哪些工具；
- 每次工具的输入输出是什么；
- 每一步耗时多少；
- token 用量如何；
- 最后返回了什么。

#### 第二层：知道为什么会这样

仅仅看到链路还不够，你还要能解释：

- 为什么调用了这个工具而不是那个工具；
- 为什么中间发生了重试；
- 为什么这次 prompt 长度特别大；
- 为什么检索结果质量差；
- 为什么延迟在 planner 节点突然升高；
- 为什么同一个请求成本比平均值高一倍。

这就需要 Trace 能够表达嵌套结构、元数据、标签、环境信息、版本信息。

#### 第三层：判断结果好不好

观测不只是“调试失败请求”，还要做质量治理。

你需要能回答：

- 当前版本比上个版本回答更准吗？
- Prompt 改版后事实性有没有提升？
- 新模型虽然更贵，但是否值得？
- 某类任务的工具选择准确率是否改善？
- 哪些 bad case 最值得优先修？

这对应 Datasets、Evaluations、人工标注与回归测试。

#### 第四层：持续优化并形成工程闭环

最终目标不是“拥有一个漂亮的 trace 页面”，而是让观测数据真正驱动开发迭代：

- bad case 回流为数据集；
- 数据集驱动自动评估；
- 自动评估约束上线质量门槛；
- 线上指标反馈成本与性能风险；
- 标注结果反哺 prompt、workflow、tool schema。

这也是为什么现在越来越多团队把 LangSmith / LangFuse 不再当作“调试工具”，而是当作 AI 应用工程基础设施的一部分。

---

## 二、AI Agent 可观测性的核心对象：你到底要观测什么

在讲具体平台前，我们先统一一个概念：AI Agent 的观测对象和传统 APM 不完全一样。

### 2.1 Prompt 与上下文

Prompt 是 AI Agent 的“代码之外的代码”。很多时候行为变化并不是来自 Python/TypeScript 逻辑，而是来自：

- system prompt 改了；
- few-shot 示例变了；
- 检索上下文拼接顺序变了；
- memory 注入内容变了；
- 工具描述文字变了。

所以观测系统必须记录 **最终实际发送给模型的上下文**，而不是只记录“模板名”。否则你根本没法复盘模型当时看到的真实输入。

### 2.2 模型调用

至少要记录：

- provider：OpenAI / Anthropic / Gemini / 本地模型；
- model：gpt-4.1、claude-sonnet、o3-mini 等；
- temperature、max_tokens、top_p 等采样参数；
- 输入 token、输出 token、总 token；
- 费用估算；
- 请求耗时；
- 请求失败类型与重试次数。

### 2.3 工具调用

Agent 的价值很大一部分来自工具能力，但工具也是故障高发区。要记录：

- 工具名称；
- 工具参数；
- 工具返回值；
- 工具耗时；
- 工具是否异常；
- 工具结果是否被模型正确使用；
- 某些高风险工具是否命中风控/审批。

### 2.4 检索与知识库

RAG 场景下，经常出现“模型看起来答错，其实是检索没找对”的情况。因此要记录：

- query 重写前后内容；
- top-k 召回文档；
- 相似度分数；
- rerank 前后顺序；
- 最终注入模型的上下文；
- 引用来源。

### 2.5 工作流节点与状态迁移

如果你使用 LangGraph、Temporal、Dify Workflow、Flowise、AutoGen、CrewAI 等工作流/Agent 编排系统，就要记录节点级状态：

- 当前节点；
- 边的跳转条件；
- 节点输入输出；
- checkpoint；
- retry；
- 人工中断与恢复。

### 2.6 质量评估与人工反馈

可观测性最终一定会和评估结合。你不仅要知道系统做了什么，还要知道结果是否值得接受：

- 正确性；
- 相关性；
- 完整性；
- 工具选择合理性；
- 是否幻觉；
- 是否符合安全要求；
- 用户 thumbs up/down；
- 人工标注标签。

当这些对象被系统化记录后，你才能真正建立面向 Agent 的工程治理体系。

---

## 三、LangSmith 实战：Tracing / Datasets / Evaluation 三大核心功能

LangSmith 是 LangChain 生态里最成熟的观测与评估平台之一。虽然它与 LangChain / LangGraph 集成最丝滑，但它并不只能服务于 LangChain 项目。即使你直接使用 OpenAI SDK、Anthropic SDK、自定义 Agent 框架，也可以通过 SDK 或 OpenTelemetry 风格的方式把 trace 发到 LangSmith。

如果让我概括 LangSmith 的价值，我会用一句话：

> 它不是单纯记录一次 LLM 调用，而是帮助你把“线上请求、调试过程、数据集、评估、回归验证”全部串起来。

### 3.1 LangSmith 的三个核心能力为什么重要

#### 3.1.1 Tracing：解决“我不知道这次请求内部发生了什么”

Tracing 是 LangSmith 最直观的能力。你可以看到一条 run 的完整调用树，包括：

- root run；
- chain / agent run；
- tool run；
- retriever run；
- llm run；
- prompt 内容；
- token 统计；
- 错误信息；
- metadata / tags。

对于 Agent 场景而言，这相当于把原本散落在日志里的上下文重新组织成“可展开、可跳转、可过滤”的链路视图。

#### 3.1.2 Datasets：解决“bad case 找到了，但没有形成长期资产”

很多团队都会遇到一个问题：线上发现了很多失败案例，但它们最终只是留在 issue、文档或群聊里，没有结构化沉淀。过两周后，团队又在同一个坑里跌倒。

LangSmith 的 dataset 机制，本质上就是把这些 case 变成长期可复用的样本集。它不仅可以存输入、参考答案、元信息，还可以与评估流程绑定，让“发现问题”自然转化为“加入回归集”。

#### 3.1.3 Evaluation：解决“我改了 prompt/模型/工作流，到底更好了还是更差了”

AI 应用很难仅靠人工感受判断版本优劣。你必须用可重复的评估方式去比较不同版本。LangSmith 的 evaluation 支持：

- 规则评估；
- 程序化评估；
- LLM-as-Judge；
- 人工标注；
- 对比实验；
- 数据集批量跑分。

这一步非常关键，因为没有评估，观测只能帮你定位问题；有了评估，观测才能驱动优化。

---

### 3.2 LangSmith Tracing 实战：从零接入一个 Agent

下面用 Python 作为示例。实际项目里你可能用 LangChain、LangGraph 或原生 SDK，核心思路类似。

#### 3.2.1 基础环境变量

```bash
export LANGSMITH_TRACING=true
export LANGSMITH_API_KEY=lsv2_xxx
export LANGSMITH_PROJECT=agent-observability-demo
```

如果你是 LangChain / LangGraph 用户，很多时候只要配置这几个环境变量，链路就会自动进入 LangSmith。

#### 3.2.2 一个最小可运行示例

```python
import os
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

@tool
def get_weather(city: str) -> str:
    """获取城市天气信息"""
    fake_db = {
        "北京": "晴，28°C，适合出行",
        "上海": "多云，31°C，湿度较高",
        "深圳": "阵雨，29°C，请带伞",
    }
    return fake_db.get(city, f"未找到 {city} 的天气信息")

llm = ChatOpenAI(model="gpt-4.1-mini", temperature=0)
agent = create_react_agent(llm, tools=[get_weather])

result = agent.invoke(
    {"messages": [("user", "帮我查一下深圳天气，并给一个出行建议")]},
    config={
        "tags": ["prod-like", "weather-agent"],
        "metadata": {
            "tenant_id": "demo-team",
            "env": "dev",
            "release": "2026.06.02"
        }
    }
)

print(result)
```

这个示例接入后，在 LangSmith 中通常可以看到：

- Agent 根节点；
- LLM 决策节点；
- `get_weather` 工具调用节点；
- 工具输出；
- 最终回答；
- 耗时和 token。

#### 3.2.3 Tracing 中最值得看的字段

很多人第一次用 LangSmith 时，只是打开 trace 页面看一眼“哦，原来调用了工具”。实际上真正有价值的是以下信息：

1. **Inputs / Outputs**：核对真实 prompt 与工具参数；
2. **Run tree**：确认工作流执行顺序是否符合预期；
3. **Metadata**：关联租户、版本、环境、实验组；
4. **Tags**：快速过滤特定业务线、模型版本、AB 测试组；
5. **Timing**：找出慢节点；
6. **Token usage**：定位成本异常请求；
7. **Errors / Retries**：分析失败重试是否合理。

建议在所有线上请求里至少带上如下 metadata：

```python
config={
    "metadata": {
        "user_id": user_id,
        "session_id": session_id,
        "tenant_id": tenant_id,
        "env": env,
        "release": release_version,
        "model_route": selected_model,
        "feature_flag": "planner_v2"
    },
    "tags": ["support-agent", env, release_version]
}
```

为什么这些字段重要？因为线上问题几乎都不是孤立的。你经常需要回答：

- 只有某个租户出问题吗？
- 某个 release 后错误率是否上升？
- 某个 feature flag 实验组 token 是否暴涨？
- 某类 session 是否频繁出现工具超时？

没有 metadata，你只能“看单条请求”；有 metadata，你才能“做群体分析”。

---

### 3.3 用 LangSmith 调试 Agent：一个典型案例

假设你的客服 Agent 出现了问题：用户问“帮我查订单 20260602001 的物流状态”，系统有时会错误调用 FAQ 工具，而不是订单查询 API。

在没有 tracing 时，你只能猜：

- tool description 写得不清楚？
- prompt 没强调订单优先？
- 工具 schema 不合理？
- 模型版本变了？

接入 LangSmith 后，通常可以按下面步骤分析：

#### 第一步：筛选失败样本

通过 tags 或 metadata 找出相关请求，例如：

- 业务线：order-support
- release：2026.06.02
- model_route：gpt-4.1-mini

再在 trace 中查看用户输入相似的失败 case。

#### 第二步：展开 LLM 决策节点

重点检查：

- system prompt 是否明确“涉及订单号优先调用订单工具”；
- 工具列表描述里 FAQ 工具是否过于宽泛；
- tool schema 对订单号字段是否清晰；
- 模型是否把“物流状态”误理解成常见问题。

#### 第三步：检查工具参数

即使模型选对了工具，也要看参数是否正确。比如模型可能把订单号截断、附加空格，或者提取错了字段名。

#### 第四步：找出模式性问题

如果失败集中在“订单 + 物流 + 售后”复合意图上，就说明问题不是随机波动，而是 prompt / tool schema 的系统性缺陷。

#### 第五步：把 bad case 加入 dataset

这是最关键的一步。不要只修 prompt 然后结束，而要把这些失败样本沉淀到 LangSmith dataset，成为后续回归测试的一部分。否则下次再改工具描述，问题可能重新出现。

---

### 3.4 LangSmith Datasets：把线上坏案例变成回归资产

Dataset 是 LangSmith 里特别容易被低估的功能。很多人把它理解为“样例集合”，但从工程视角看，它真正的价值是：

> 让所有线上问题、产品验收标准、历史回归案例，有一个统一、结构化、可评估的承载形式。

#### 3.4.1 适合进入 dataset 的样本类型

我一般建议至少维护四类数据集：

1. **核心金标集**：由产品/领域专家确认的高价值题目；
2. **线上 bad case 集**：真实用户失败案例沉淀；
3. **边界条件集**：歧义输入、脏数据、超长输入、格式异常；
4. **安全合规集**：越权请求、敏感词、违规任务、Prompt Injection。

#### 3.4.2 一个示例数据结构

```json
{
  "inputs": {
    "question": "帮我查订单 20260602001 的物流状态"
  },
  "outputs": {
    "expected_behavior": "必须调用 order_tracking 工具，并基于工具结果回答"
  },
  "metadata": {
    "category": "tool_selection",
    "priority": "high",
    "source": "production_bad_case",
    "tenant": "ecommerce"
  }
}
```

注意，这里的 outputs 不一定非得是唯一标准答案。对于 Agent 场景，更常见的是定义“期望行为”：

- 是否应该调用某个工具；
- 是否必须引用检索结果；
- 是否要拒绝某类请求；
- 是否输出结构化 JSON；
- 是否应该遵守安全策略。

也就是说，AI Agent 的评估标准通常比“文本完全一致”更偏行为导向。

#### 3.4.3 dataset 的维护原则

实践中建议遵循三条：

- **少而精优先**：不要一上来堆几千条低质量样本；
- **每个样本有明确用途**：是测工具选择、检索质量还是安全？
- **持续演进**：每次线上出现值得记录的问题，都纳入对应数据集。

这样 dataset 才会真正变成“回归资产”，而不是冷冰冰的数据仓库。

---

### 3.5 LangSmith Evaluation：自动评估与回归验证

对于 Agent 系统，最常见的误区是只做人工体验，不做自动评估。这样的问题在于：

- 评估成本高；
- 不可重复；
- 难以对比版本；
- 容易受主观印象影响。

LangSmith 的 evaluation 能把“感觉更好”变成“证据更强”。

#### 3.5.1 评估的三种常见方式

##### 方式一：规则型评估器

适用于明确、可程序化判断的场景，比如：

- 是否输出合法 JSON；
- 是否命中了正确工具；
- 是否包含必需字段；
- 是否引用了指定来源；
- 是否低于最大延迟阈值。

示例：

```python
def tool_selection_evaluator(run, example):
    used_tools = []
    for child in run.child_runs:
        if child.run_type == "tool":
            used_tools.append(child.name)
    expected_tool = example.outputs.get("expected_tool")
    return {
        "key": "tool_selection_correct",
        "score": 1 if expected_tool in used_tools else 0,
        "comment": f"used_tools={used_tools}, expected={expected_tool}"
    }
```

##### 方式二：LLM-as-Judge

适用于文本质量难以用规则判断的场景，例如：

- 回答是否准确；
- 是否覆盖用户问题核心点；
- 是否存在幻觉；
- 是否符合客服语气；
- 是否比较了多个候选答案优劣。

常见做法是让一个“评审模型”读取：

- 用户输入；
- 参考答案或规则；
- Agent 输出；
- 中间上下文（可选）；

然后给出分数与理由。

##### 方式三：人工标注

自动评估再强，也不可能覆盖全部业务细节。对高风险、高价值任务，必须保留人工标注流程，例如：

- 医疗建议；
- 金融投顾；
- 法律解释；
- 企业内部知识问答中的事实准确性；
- 高价值客户工单自动回复。

LangSmith 的价值在于，它可以把自动评估和人工标注放在同一条数据流里，而不是分裂成两个孤立系统。

#### 3.5.2 一个 LLM-as-Judge 的思路

下面给出一个简化示例，用于评估回答是否基于工具结果且没有编造：

```python
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

judge = ChatOpenAI(model="gpt-4.1-mini", temperature=0)

class JudgeResult(BaseModel):
    score: int
    reasoning: str

prompt = """
你是一个严格的 AI Agent 评估器。
请根据以下标准评分：
1. 回答是否忠实于工具返回结果；
2. 是否出现工具中没有提供的编造信息；
3. 是否完整回应用户问题。

用户问题：{question}
工具结果：{tool_result}
Agent 回答：{answer}

请输出 JSON：{{"score": 0-5, "reasoning": "..."}}
"""
```

这里的关键不是代码本身，而是方法论：

- Judge prompt 要尽量明确评分维度；
- 最好输出结构化结果，避免后处理困难；
- 高风险任务不能只靠单一 judge；
- 可以叠加多个 evaluator，分别看准确性、完整性、合规性。

#### 3.5.3 evaluation 真正的用法：版本对比

评估最有价值的场景，不是给单次输出打分，而是比较两个版本谁更好，比如：

- Prompt v7 vs Prompt v8；
- gpt-4.1-mini vs claude-sonnet；
- planner_v1 vs planner_v2；
- 检索 top-k=5 vs top-k=10；
- 带 memory vs 不带 memory。

你真正想知道的是：

- 总体分数谁更高；
- 某一类问题谁更强；
- 成本增加是否值得；
- 是否出现新的失败模式。

这也是 LangSmith 在工程价值上最强的一点：Tracing 告诉你问题发生在哪里，Evaluation 告诉你改动是否真的有效。

---

## 四、LangFuse 实战：自托管方案与 Trace / Generation / Span 概念

如果说 LangSmith 更偏“LangChain 生态一体化体验 + 评估闭环”，那么 LangFuse 在很多团队里的吸引力主要来自两点：

1. 更强调开源与自托管；
2. 数据模型更接近“可泛化的 AI 应用观测层”。

对于重视数据主权、私有部署、成本可控、可定制化的团队，LangFuse 往往是非常有竞争力的选择。

### 4.1 为什么很多团队选择 LangFuse

常见原因包括：

- 公司合规要求，不能把完整 prompt / 用户数据发到第三方 SaaS；
- 希望自己保留 trace 数据与存储周期控制权；
- 需要深度定制埋点、事件模型、看板；
- 想把 AI trace 与内部监控系统更紧密打通；
- 需要开源可审计能力。

当然，LangFuse 不是“LangSmith 的平替”这么简单。它有自己清晰的数据抽象：**Trace、Observation、Generation、Span、Event、Score**。理解这些概念之后，你才能用好它。

---

### 4.2 LangFuse 的核心概念：Trace / Generation / Span

#### 4.2.1 Trace：一条完整用户请求的顶层容器

可以把 trace 理解为一次用户交互的总容器。它通常代表：

- 一次对话请求；
- 一个 Agent 任务执行；
- 一个多步工作流实例；
- 一次后端异步 AI 作业。

在 trace 维度上，通常会记录：

- trace id；
- user id / session id；
- 输入与输出；
- 标签与 metadata；
- 总耗时；
- 总 token；
- 成本；
- 关联分数与反馈。

#### 4.2.2 Generation：一次模型生成调用

Generation 通常表示一次 LLM 调用，是 LangFuse 中最关键的 observation 类型之一。它关注：

- model；
- prompt / messages；
- completion；
- token usage；
- latency；
- provider；
- model parameters；
- cost。

如果你的系统一次请求里调用了 3 次模型，那么一般会对应 3 个 generation。

#### 4.2.3 Span：一个更泛化的操作步骤

Span 更像传统 tracing 中的 span，表示一个任意步骤，例如：

- 检索；
- rerank；
- 工具调用；
- 规则引擎判断；
- SQL 查询；
- 第三方 API 调用；
- 内部任务编排节点。

换句话说，Generation 是“面向模型调用的特殊 span”，而 Span 则更适合表达一切非 LLM 步骤。

#### 4.2.4 Score：评估与反馈结果

LangFuse 里还可以给 trace 或 observation 绑定 score，用于记录：

- 用户点赞/点踩；
- 自动评估得分；
- 人工标注结果；
- 安全审核结论；
- 业务 KPI 映射分数。

这让 LangFuse 不只是“看链路”，还能承载质量指标。

---

### 4.3 LangFuse 自托管实战：Docker Compose 方案

对于很多博客读者来说，最关心的问题通常是：LangFuse 能不能自托管，部署复杂吗？

答案是：能，而且是它的主要优势之一。

下面给出一个简化版 `docker-compose.yml` 思路，生产环境请根据官方文档做持久化、安全、备份、TLS、资源隔离增强。

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_DB: langfuse
      POSTGRES_USER: langfuse
      POSTGRES_PASSWORD: langfuse_password
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  clickhouse:
    image: clickhouse/clickhouse-server:24
    restart: always
    volumes:
      - ./data/clickhouse:/var/lib/clickhouse
    ports:
      - "8123:8123"
      - "9000:9000"

  redis:
    image: redis:7
    restart: always
    ports:
      - "6379:6379"

  langfuse-web:
    image: langfuse/langfuse:latest
    restart: always
    depends_on:
      - postgres
      - clickhouse
      - redis
    environment:
      DATABASE_URL: postgresql://langfuse:langfuse_password@postgres:5432/langfuse
      CLICKHOUSE_URL: http://clickhouse:8123
      REDIS_HOST: redis
      NEXTAUTH_SECRET: replace-me
      SALT: replace-me-too
      TELEMETRY_ENABLED: "false"
    ports:
      - "3000:3000"
```

这个 compose 只是帮助你理解 LangFuse 大致依赖关系：

- PostgreSQL：事务型元数据；
- ClickHouse：分析型事件与查询；
- Redis：缓存/队列相关；
- LangFuse Web：控制台与 API。

在正式生产里，还要额外考虑：

- 反向代理与 TLS；
- 数据备份；
- SSO / RBAC；
- 多环境隔离；
- 日志清洗与脱敏；
- 存储保留策略；
- ClickHouse 资源规划。

### 4.4 LangFuse SDK 埋点示例

下面给一个 Python 风格的思路示例：

```python
from langfuse import Langfuse
import time

langfuse = Langfuse(
    secret_key="sk-lf-xxx",
    public_key="pk-lf-xxx",
    host="https://langfuse.example.com"
)

trace = langfuse.trace(
    name="customer-support-agent",
    user_id="user_123",
    session_id="session_456",
    input={"question": "帮我查一下订单 20260602001 的物流状态"},
    metadata={
        "env": "prod",
        "release": "2026.06.02",
        "tenant": "ecommerce"
    }
)

retrieval_span = trace.span(
    name="retrieve-order-context",
    input={"query": "订单 20260602001 物流状态"}
)
# ... 执行检索
retrieval_span.end(output={"docs": ["订单状态说明", "物流接口说明"]})

llm_generation = trace.generation(
    name="planner",
    model="gpt-4.1-mini",
    input=[{"role": "user", "content": "帮我查一下订单 20260602001 的物流状态"}]
)
# ... 执行模型调用
llm_generation.end(
    output="我将先调用订单物流工具查询该订单状态。",
    usage_details={"input": 312, "output": 31, "total": 343}
)

tool_span = trace.span(
    name="order_tracking_tool",
    input={"order_id": "20260602001"}
)
# ... 调用 API
tool_span.end(output={"status": "运输中", "eta": "明日送达"})

trace.update(output={"answer": "订单 20260602001 当前运输中，预计明日送达。"})
trace.score(name="user_feedback_simulated", value=1.0, comment="正确完成任务")
```

这个模型的优势是很灵活。无论你是否使用特定 Agent 框架，都可以手工或半自动地将应用链路表达为 trace + spans + generations。

### 4.5 LangFuse 在调试上的价值

许多人第一次接入 LangFuse 后，主要收获有三个：

1. **终于能把 Prompt、工具调用、RAG 过程放到同一条链路里看**；
2. **可以在私有环境中保存详细输入输出**；
3. **可以把用户反馈与自动评估分数绑定到 trace 上**。

尤其是当你的应用并不是 LangChain/LangGraph 技术栈，而是自研框架、Node.js 服务、Java 后端、异步任务系统时，LangFuse 的中立性会非常实用。

---

## 五、LangSmith vs LangFuse：功能、成本、自托管、开源详细对比

这两个平台经常被拿来比较。实际选型时，我建议不要问“谁更强”，而要问“谁更适合你的组织现状”。

下面从多个维度做一个更工程化的对比。

### 5.1 总体定位差异

| 维度 | LangSmith | LangFuse |
|---|---|---|
| 核心定位 | AI 应用调试、评估、数据集与回归闭环 | AI 应用可观测性平台，强调开源与自托管 |
| 与 LangChain / LangGraph 集成 | 极强 | 有集成，但不是原生一体化中心 |
| 评估体系 | 很强，Datasets/Evals 体验成熟 | 也能做评分与反馈，但评估闭环通常需更多自定义 |
| 自托管 | 相对受限/视产品策略 | 强项 |
| 开源 | 非完全开源产品路径 | 开源属性更强 |
| 适合团队 | 快速构建 AI 工程闭环的团队 | 重视私有部署、可控性、平台化集成的团队 |

### 5.2 功能对比：Tracing

#### LangSmith 的 tracing 优势

- 对 LangChain / LangGraph 的 run tree 展示非常自然；
- Prompt、chain、tool、retriever 结构语义清晰；
- 与评估、dataset 紧密关联；
- 调试体验非常顺手，尤其适合快速定位 Agent 行为问题。

#### LangFuse 的 tracing 优势

- Trace / Generation / Span 模型更通用；
- 对异构系统与自定义埋点更友好；
- 自托管后更适合接入企业内部平台；
- 对长期数据掌控和扩展性更有吸引力。

如果你的主要诉求是“把 LangChain / LangGraph 项目快速观测起来”，LangSmith 通常上手更快；如果你的诉求是“构建组织级 AI 观测底座”，LangFuse 会更吸引人。

### 5.3 功能对比：评估与数据集

这是两者差异最明显的地方之一。

#### LangSmith 更强的部分

- Datasets 概念更成熟；
- Evaluation 工作流更完整；
- 适合做 prompt 回归测试、模型对比实验；
- 更容易形成“线上 bad case -> 数据集 -> 自动评估 -> 版本比较”的闭环。

#### LangFuse 的特点

- 也支持 score、annotation、trace 级质量记录；
- 更偏“观测平台 + 反馈/评分承载层”；
- 如果要做复杂评估流水线，通常需要你自己多做一层平台整合。

简单说：

- **以评估闭环为核心**：LangSmith 往往更省心；
- **以可观测平台化与私有部署为核心**：LangFuse 更有优势。

### 5.4 成本对比

成本不能只看 SaaS 价格，还要看：

- 研发接入成本；
- 维护成本；
- 数据存储成本；
- 评估运行成本；
- 团队学习成本。

#### LangSmith 成本特征

- 接入快，尤其是 LangChain 生态内；
- 平台能力成熟，减少自建工作量；
- 但如果团队有严格数据出境/私有化要求，可能面临额外合规成本或无法采用。

#### LangFuse 成本特征

- 自托管省去了部分 SaaS 限制；
- 但你需要承担部署、升级、监控、备份、资源规划；
- 数据量大时，ClickHouse、对象存储、日志保留都是显性成本；
- 如果团队没有平台运维能力，自托管也未必真的便宜。

### 5.5 自托管与开源对比

这几乎是 LangFuse 最强卖点之一。

- 如果你的组织要求所有 prompt、trace、用户数据必须保留在内网，LangFuse 会更契合；
- 如果你更在意“产品功能尽快上线，工程闭环快速跑通”，LangSmith 更可能让你节省时间。

我实际建议是：

- **创业团队/小团队**：优先考虑能快速形成闭环的方案；
- **中大型企业/强合规场景**：优先考虑数据边界、自托管与平台集成能力。

### 5.6 一个务实的选型建议

你可以用下面的决策方式：

#### 优先选 LangSmith，如果你满足这些条件

- 你在用 LangChain / LangGraph；
- 你特别重视 datasets 与 evals；
- 你希望尽快落地回归评估；
- 团队暂时没有强私有化要求；
- 更关注开发效率而不是平台自建。

#### 优先选 LangFuse，如果你满足这些条件

- 你需要自托管；
- 你希望 trace 数据完全留在自己环境；
- 你是异构技术栈，不想绑定特定框架；
- 你准备把 AI 可观测性纳入更大的内部平台体系；
- 你有能力维护数据库、分析存储和升级流程。

#### 也可以“双轨并行”

现实中还有一种常见做法：

- 开发/实验阶段使用 LangSmith 强化 prompt、workflow、evaluation；
- 生产阶段使用 LangFuse 或内部观测平台做私有部署与长期数据保留；
- 核心 bad case 与回归集保留在统一评估流水线里。

这不是重复建设，而是因为“调试效率最优”和“企业治理最优”有时并不完全是同一个解。

---

## 六、Agent Trace 可视化与调试技巧：不要只看结果，要看路径

很多团队接入 trace 后，最大的问题不是“没有数据”，而是“看了也不知道怎么用”。所以这一节重点讲一些实践里非常有效的调试方法。

### 6.1 先看路径是否合理，再看答案是否正确

当 Agent 答错时，很多人第一反应是盯着最终输出。但对 Agent 来说，更重要的问题往往是：

- 它有没有走对路径？
- 有没有调用本该调用的工具？
- 检索是否拿到了正确上下文？
- 是否在不必要的节点循环？

因此调试顺序建议是：

1. 看执行树；
2. 看每一步输入输出；
3. 再评估最终答案。

因为“路径错了但答案碰巧对”与“路径对了但最终表达欠佳”是两类完全不同的问题，优化策略也不同。

### 6.2 把问题分类到具体层次

调试 Agent 时，可以把问题拆成五层：

#### 第一层：输入层

- 用户输入是否被前置清洗破坏；
- 会话上下文是否拼接错误；
- memory 是否注入了不相关内容。

#### 第二层：决策层

- planner 是否理解任务；
- tool routing 是否正确；
- 是否误判是否需要检索或调用工具。

#### 第三层：执行层

- 工具参数是否正确；
- API 是否超时；
- 检索 top-k 是否合理；
- rerank 是否误伤关键文档。

#### 第四层：生成层

- 最终模型是否忠实引用工具结果；
- 是否产生幻觉补充；
- 是否遗漏用户问题中的某个约束。

#### 第五层：策略层

- 提示词策略是否过于保守/激进；
- 重试机制是否导致成本与延迟膨胀；
- fallback 模型是否显著降低质量。

只要你能把问题定位到这五层中的某一层，后续修复工作就会快很多。

### 6.3 重点关注三类异常 trace

#### 类型一：长尾超慢请求

常见原因：

- 模型重试；
- 工具超时；
- 多轮 planner 循环；
- 检索/重排链路过长；
- 上下文过大导致推理慢。

做法：

- 在 trace 中按 latency 排序；
- 查看最慢 1% 请求；
- 统计最慢节点类型；
- 优先解决最常见的慢点，而不是盯着单个极端案例。

#### 类型二：高成本异常请求

常见原因：

- 上下文注入过多；
- memory 不清理，越聊越长；
- 多轮工具观察结果重复灌回 prompt；
- 模型 fallback 到更贵模型；
- prompt 模板意外包含冗余日志或历史。

做法：

- 按 token 用量排序 trace；
- 采样查看 prompt 真实长度；
- 比较不同 release 或 feature flag 的平均 token；
- 对高成本链路做 prompt diff。

#### 类型三：质量波动请求

常见原因：

- 模型随机性；
- 检索结果不稳定；
- 工具返回数据格式不一致；
- system prompt 修改；
- 上下文污染。

做法：

- 把相似输入聚合；
- 比较成功与失败 trace 的路径差异；
- 重点看 prompt、检索文档、工具返回值是否不同；
- 将失败样本加入 dataset 做稳定回归。

### 6.4 调试 Prompt，不要只看模板，要看“最终拼装结果”

这是一个非常常见的坑。

很多团队说“我们 prompt 没改啊”，但实际上变化可能来自：

- 新增了 memory 注入；
- 检索多拼了几段无关文档；
- tool description 调整了文案；
- 输出格式约束增加了；
- 上下文里多了日志字段。

所以调试 prompt 时，一定要看最终 messages，而不是只看模板源码。Trace 最大的价值之一，就是它能让你看到模型实际收到的完整输入。

### 6.5 调试 Tool Calling，要验证“选择、参数、使用结果”三件事

工具调用不只是“有没有调”。至少要查三层：

1. **Tool Selection**：工具选得对不对；
2. **Tool Arguments**：参数提取得对不对；
3. **Tool Result Utilization**：模型有没有正确使用工具结果。

很多时候，问题并不在工具本身。例如：

- 模型调用了正确工具，但 order_id 少了一位；
- 工具返回“未查询到订单”，模型却编造成“订单已签收”；
- 工具返回多字段，模型忽略关键状态字段。

所以在 trace 中，你要有意识地把这三段连起来看。

---

## 七、评估框架设计：自动评估（LLM-as-Judge）与人工标注结合

如果说 tracing 解决的是“看见系统过程”，那么 evaluation 解决的是“定义什么叫好，什么叫坏”。

一个成熟的 Agent 团队，最终都需要自己的评估框架，而不是把所有判断都交给主观印象。

### 7.1 为什么必须结合自动评估与人工标注

只靠自动评估的问题：

- LLM judge 可能不稳定；
- 某些复杂业务规则难以被 prompt 准确表达；
- judge 本身也会偏置；
- 有时它能判断语言流畅，却未必理解业务正确性。

只靠人工标注的问题：

- 成本高；
- 速度慢；
- 难以覆盖大量样本；
- 难以形成持续集成。

所以实际最稳妥的方法几乎总是：

> 自动评估负责高频、批量、回归；人工标注负责高价值、边界、争议与校准。

### 7.2 一个实用的评估分层框架

我通常建议把评估拆成四层。

#### 第一层：结构正确性

用程序规则判断：

- JSON 是否合法；
- 必填字段是否存在；
- 是否调用了预期工具；
- 输出是否满足 schema；
- 是否命中拒答策略。

这层最稳定，也最适合做 CI 阶段的硬门槛。

#### 第二层：行为正确性

关注 Agent 是否按预期行动：

- 遇到订单查询是否调用订单工具；
- 遇到知识问答是否优先检索；
- 遇到敏感操作是否请求确认；
- 遇到权限不足是否拒绝继续。

这层可以通过规则 + trace 分析 + 少量 LLM judge 结合完成。

#### 第三层：语义质量

关注答案文本层面的质量：

- 是否准确；
- 是否完整；
- 是否相关；
- 是否清晰；
- 是否存在幻觉；
- 是否符合品牌语气。

这层最适合 LLM-as-Judge 和人工抽检结合。

#### 第四层：业务结果

最终你还要关心业务价值：

- 工单解决率是否提升；
- 用户满意度是否提升；
- 人工转接率是否下降；
- 首次响应时间是否缩短；
- 成本是否可接受。

很多团队花大量精力优化 judge score，却忘了看业务指标，这也是常见误区。

### 7.3 LLM-as-Judge 的实践建议

#### 建议一：Judge Prompt 要具体，不要泛泛而谈

差的评估 prompt：

> 请评价这个答案好不好。

好的评估 prompt：

> 请只根据给定工具结果判断回答是否忠实、是否遗漏关键状态、是否编造 ETA，并按 0-5 打分。

维度越清晰，judge 越稳定。

#### 建议二：要求结构化输出

例如统一输出：

```json
{
  "factuality": 4,
  "completeness": 5,
  "tool_faithfulness": 5,
  "hallucination": false,
  "reasoning": "回答完整引用了工具结果，但未解释异常状态原因"
}
```

这样更方便后续聚合统计、过滤和 dashboard 展示。

#### 建议三：保留人工校准集

不要完全相信 judge。应定期抽样，做人工复核，然后比较：

- judge 与人工一致率；
- 哪类样本 judge 误差大；
- 是否需要调整评估 prompt 或更换 judge 模型。

#### 建议四：对于关键场景使用多评估器

例如：

- 一个 evaluator 看准确性；
- 一个 evaluator 看合规性；
- 一个 evaluator 看格式与可执行性。

单分数通常隐藏太多信息，多维度更利于定位改进方向。

### 7.4 人工标注体系怎么做才不乱

很多团队一提人工标注，就会立刻陷入混乱：标签定义不统一、标注人标准不一致、结果难以回流系统。

一个相对稳妥的做法是：

1. 先定义有限且明确的标签；
2. 每个标签给出正反例；
3. 保证同一条样本可被重复复核；
4. 标注结果回流到 trace / dataset；
5. 定期复盘分歧样本，更新标注指南。

例如客服 Agent，可以定义：

- `answer_correct`：正确 / 错误 / 部分正确；
- `tool_selection`：正确 / 错误；
- `hallucination`：有 / 无；
- `tone`：符合 / 不符合；
- `safety`：通过 / 风险。

比起一上来设计几十个复杂标签，这种方式更容易落地。

---

## 八、性能指标监控：延迟 / Token 用量 / 成本追踪

如果你已经开始做生产化 Agent，千万不要把可观测性只理解为“调 bug”。很多时候，真正最先把系统拖垮的不是错误率，而是延迟与成本。

### 8.1 为什么性能指标必须进入 AI Agent 的核心看板

AI 系统与传统服务不同的地方在于：

- 单次请求成本通常更高；
- 延迟波动更大；
- token 消耗和上下文规模强相关；
- 多步链路导致尾延迟问题更突出；
- 模型回退与重试会迅速放大成本。

因此，至少要持续监控以下指标：

- P50 / P95 / P99 延迟；
- 每请求平均 token；
- 输入/输出 token 拆分；
- 每请求平均成本；
- 单租户/单用户成本；
- 各模型路由占比；
- 工具超时率；
- 重试率；
- 错误率。

### 8.2 延迟分析：不要只看总时长，要看阶段拆分

一个 Agent 请求慢，通常不是所有步骤都慢，而是某几个节点拖后腿。因此建议至少拆分：

- Prompt 组装时间；
- 检索时间；
- rerank 时间；
- 各次 LLM 调用时间；
- 工具调用时间；
- 后处理时间；
- 总时长。

比如你发现：

- 总时长 P95 = 12s；
- 其中 planner 模型 4s；
- 检索 800ms；
- 工具 API 5.5s；
- 最终答案生成 1.8s。

那么你就知道优化方向应该先从工具 API 和 planner 调用入手，而不是盲目更换最终回答模型。

### 8.3 Token 用量追踪：很多成本问题本质上是上下文膨胀

线上系统很常见的一个现象是：

- 上线第一周平均 1k token；
- 三个月后平均 4k token；
- 成本翻倍，但团队一时说不清原因。

常见根源包括：

- memory 越堆越长；
- RAG top-k 过大；
- 检索内容 chunk 太长；
- 工具返回原始 JSON 直接灌进 prompt；
- 输出格式约束过于冗长；
- 多轮 intermediate reasoning 全量保留。

因此建议你建立以下监控：

- 平均输入 token；
- 平均输出 token；
- 不同业务线 token 分布；
- top 1% 高 token 请求案例；
- 各 release 的 token 趋势图。

### 8.4 成本追踪：做到“能分账、能归因、能预警”

只知道一天花了多少钱并没有太大意义。更有价值的是把成本归因到：

- 模型；
- 租户；
- 功能模块；
- Agent 类型；
- 版本；
- 特定工具链。

例如你可以在 trace metadata 中记录：

- `tenant_id`
- `feature`
- `release`
- `model_route`
- `workflow_name`

这样你就可以回答：

- 哪个租户成本最高；
- 哪个功能模块 token 激增；
- 某个 release 是否导致均次成本上升；
- 新模型路线是否真的更贵但更值。

### 8.5 一个实用的成本监控公式

很多团队会忽略一个事实：Agent 请求总成本并不只来自模型主调用，还包括：

- 多次规划模型调用；
- 工具调用产生的外部 API 成本；
- rerank 模型成本；
- embedding 成本；
- eval / judge 成本；
- 重试放大的额外成本。

所以建议按以下维度拆账：

```text
Total Cost
= Planning LLM Cost
+ Tool-use LLM Cost
+ Final Generation Cost
+ Embedding Cost
+ Rerank Cost
+ External API Cost
+ Evaluation Cost
+ Retry Overhead
```

一旦你把成本拆开，很多“感觉很贵”的问题会变得可优化：

- 其实不是主模型贵，而是 eval 跑太多；
- 其实不是回答成本高，而是 memory 导致 planner token 暴涨；
- 其实不是 rerank 值不值，而是 top-k 给太大了。

---

## 九、与 Prometheus / Grafana 集成：把 AI 观测纳入统一监控体系

LangSmith 和 LangFuse 都很适合做 AI trace 级分析，但在生产环境里，你通常还需要把关键指标纳入团队已有监控体系，比如 Prometheus + Grafana。

原因很简单：

- SRE 团队已经在用它们；
- 告警、面板、容量规划都在这套体系里；
- AI Agent 不应该成为孤岛系统。

### 9.1 哪些指标适合暴露到 Prometheus

不是所有 trace 明细都适合塞进 Prometheus。Prometheus 更适合高频聚合指标，而不是保存完整 prompt 或大文本。

建议暴露如下指标：

#### Counter 类

- `agent_requests_total`
- `agent_errors_total`
- `agent_tool_calls_total`
- `agent_tool_failures_total`
- `agent_model_calls_total`
- `agent_fallback_total`

#### Histogram 类

- `agent_request_latency_seconds`
- `agent_llm_latency_seconds`
- `agent_tool_latency_seconds`
- `agent_input_tokens`
- `agent_output_tokens`
- `agent_total_cost_usd`

#### Gauge / 业务状态类

- 当前活跃会话数；
- 当前排队任务数；
- 当前模型配额余量；
- 当前熔断状态。

### 9.2 Python 接入 Prometheus 示例

下面给一个简化示例：

```python
from prometheus_client import Counter, Histogram, start_http_server
import time

REQUEST_COUNT = Counter(
    "agent_requests_total",
    "Total agent requests",
    ["agent_name", "env", "model_route"]
)

REQUEST_LATENCY = Histogram(
    "agent_request_latency_seconds",
    "End-to-end latency of agent requests",
    ["agent_name", "env"]
)

TOKEN_USAGE = Histogram(
    "agent_total_tokens",
    "Total token usage per request",
    ["agent_name", "env", "model"]
)

REQUEST_COST = Histogram(
    "agent_request_cost_usd",
    "Estimated cost per request",
    ["agent_name", "env", "model"]
)

ERROR_COUNT = Counter(
    "agent_errors_total",
    "Total agent errors",
    ["agent_name", "env", "error_type"]
)

start_http_server(9108)

def observe_agent_run(agent_name, env, model, model_route, tokens, cost, fn):
    REQUEST_COUNT.labels(agent_name, env, model_route).inc()
    start = time.time()
    try:
        result = fn()
        return result
    except Exception as e:
        ERROR_COUNT.labels(agent_name, env, type(e).__name__).inc()
        raise
    finally:
        duration = time.time() - start
        REQUEST_LATENCY.labels(agent_name, env).observe(duration)
        TOKEN_USAGE.labels(agent_name, env, model).observe(tokens)
        REQUEST_COST.labels(agent_name, env, model).observe(cost)
```

这个示例的重点不是具体 API，而是思路：

- trace 平台负责“单请求深度分析”；
- Prometheus 负责“系统级指标聚合与告警”；
- 两者互补，而不是替代关系。

### 9.3 Grafana 看板建议

一个实用的 Agent 可观测性看板，建议至少分四块：

#### 第一块：整体健康度

- QPS / 请求量；
- 错误率；
- P50/P95/P99 延迟；
- 成功率；
- fallback 率。

#### 第二块：模型资源与成本

- 各模型调用占比；
- 平均 token；
- 每分钟 / 每小时成本；
- Top N 高成本租户；
- embedding / rerank / judge 成本拆分。

#### 第三块：工具与检索表现

- 工具调用次数；
- 工具失败率；
- 工具平均耗时；
- 检索平均耗时；
- top-k 命中率或引用率（如果你有埋点）。

#### 第四块：质量与反馈

- 自动评估平均分；
- 用户点赞率；
- 人工抽检通过率；
- 幻觉率；
- 高风险任务拒答率。

### 9.4 告警策略建议

不要只对“服务挂了”告警，AI Agent 更需要对“性能和质量异常”告警：

- P95 延迟持续 10 分钟高于阈值；
- 单请求平均 token 较昨日上涨 30%；
- 某模型错误率突增；
- fallback 率飙升；
- 某工具超时率持续升高；
- 自动评估平均分显著下降；
- 单租户成本异常暴涨。

这类告警能帮助你在“还没大面积出故障”前就发现问题。

---

## 十、生产环境最佳实践与踩坑记录

这一节是全文最实战的部分。下面这些经验，基本都来自真实项目里反复踩坑后的总结。

### 10.1 最佳实践一：Trace 一定要带版本信息

很多人只记录 trace，不记录 release / prompt version / model route。结果就是：

- 你看到一堆失败案例；
- 却无法知道它们是不是由某次版本更新引入。

建议至少带上：

- `release`
- `prompt_version`
- `workflow_version`
- `model_route`
- `feature_flag`

这是后续排查回归问题的基础。

### 10.2 最佳实践二：线上数据必须脱敏与分级存储

可观测性数据往往包含高敏信息：

- 用户提问；
- 内部知识库片段；
- 订单号、手机号、身份证；
- 企业私有文档；
- 工具返回的业务数据。

如果你不做脱敏，很快就会遇到合规问题。

建议：

- 对用户标识做哈希或内部映射；
- 对 prompt 中的敏感字段进行掩码；
- 不把完整密钥、token、cookie 打进 trace；
- 对高敏租户单独设定保留策略；
- 区分开发环境与生产环境可见范围。

### 10.3 最佳实践三：不要采集一切，要采集“足够定位问题”的数据

很多团队一开始会犯两个相反的错误：

- 要么采太少，定位不了；
- 要么采太多，成本爆炸、查询很慢、信息噪音过大。

一个折中原则是：

- 默认采集链路结构、耗时、token、成本、关键输入输出；
- 对超大文本做裁剪或摘要；
- 对 debug 模式开启更详细采样；
- 对高价值失败请求进行全量保留；
- 对普通成功请求采用采样策略。

### 10.4 最佳实践四：把 bad case 回流机制制度化

不是“发现问题时顺手加数据集”，而是建立明确流程：

1. 线上 trace 标记异常；
2. 人工确认是否值得纳入回归；
3. 加入 dataset；
4. 配置相应 evaluator；
5. 纳入每次版本回归测试。

一旦形成制度，系统质量会明显稳定很多。

### 10.5 最佳实践五：把工具调用视作一等公民来监控

很多 Agent 问题并不是 LLM 本身，而是工具层：

- API 不稳定；
- 参数格式变化；
- 返回 schema 漂移；
- 限流；
- 权限不足；
- 业务系统脏数据。

建议每个重要工具都单独监控：

- 调用量；
- 成功率；
- P95 latency；
- 参数校验失败率；
- 上游接口错误率。

不要把所有问题都归因给“大模型不稳定”。

### 10.6 最佳实践六：上线前做“可观测性验收”

很多团队上线前会做功能测试，但不会验证观测是否完整。实际应该把下面这些也当作上线前必查项：

- Trace 是否完整贯穿所有关键节点；
- Token 与 cost 是否能正确统计；
- 异常是否能在 trace 中看到；
- Metadata 是否包含版本、租户、环境；
- Prometheus 指标是否正常暴露；
- Grafana 看板是否覆盖核心指标；
- 告警是否已配置并实测触发。

否则等问题到了线上，再补这些基础设施，成本通常很高。

### 10.7 常见踩坑一：把“调试工具”当“监控平台”

LangSmith / LangFuse 很强，但它们不能完全替代基础监控系统。你仍然需要：

- 应用日志；
- 系统指标；
- APM；
- Prometheus / Grafana；
- 告警系统；
- 数据仓库分析。

最佳实践是分工明确：

- Trace 平台看单请求与 Agent 行为；
- Prometheus 看聚合指标与告警；
- 日志系统看异常原文与基础设施故障；
- 数据分析平台看长期趋势与业务效果。

### 10.8 常见踩坑二：只看成功率，不看质量

很多 Agent 系统“技术成功率”很高：

- 请求没报错；
- 模型也返回了；
- 工具也执行了。

但用户仍然不满意，因为：

- 内容不准；
- 没真正解决问题；
- 绕来绕去浪费时间；
- 明明有工具，却没用好。

所以不要只盯着 200 OK、调用成功率和无异常率。质量指标一定要进入主看板。

### 10.9 常见踩坑三：缺少 trace 与用户反馈的关联

如果 trace 无法关联到用户反馈，你就很难判断：

- 哪种链路最容易被点踩；
- 哪些工具路径导致满意度低；
- 哪类租户最常遇到质量问题；
- 哪个版本虽然更快但用户更不满意。

所以务必在 trace 中保留可关联 feedback 的标识，例如会话 ID、消息 ID、工单 ID。

### 10.10 常见踩坑四：评估集长期不更新

很多团队一开始认真做了 100 条评估样本，之后半年不更新。结果是：

- 评估集无法代表新场景；
- 线上真实问题没有进入回归；
- 分数看似稳定，实则脱离业务现实。

评估集应该像测试用例一样持续演进，而不是一次性建设。

### 10.11 常见踩坑五：忽视“中间推理过程”的可解释边界

在一些场景中，你可能希望记录更多中间 reasoning 来帮助调试；但在另一些场景中，过度记录会带来：

- 敏感信息泄漏风险；
- 成本增加；
- 不必要的合规负担；
- 信息噪音。

所以对于 reasoning / intermediate steps 的采集，需要结合：

- 安全要求；
- 业务场景；
- 是否真的对调试有帮助；
- 是否应仅在 debug 环境保留。

### 10.12 一个推荐的生产落地路线图

如果你现在还没有系统做 AI Agent 可观测性，可以按下面顺序推进：

#### 第一阶段：先把 tracing 打通

目标：

- 每次请求都能看到完整链路；
- 能看到 prompt、tool、latency、token、error；
- 带上 metadata 与 tags。

#### 第二阶段：建立核心指标监控

目标：

- 延迟、token、成本、错误率进入 Grafana；
- 建立基本告警；
- 能按版本/租户/模型维度切片。

#### 第三阶段：沉淀 dataset 与 bad case 回流机制

目标：

- 线上问题可进入数据集；
- 有核心金标集与边界集；
- 每次版本升级前能批量回归。

#### 第四阶段：建立自动评估 + 人工标注双轨体系

目标：

- 结构与行为层自动评估；
- 语义层 LLM judge + 人工校准；
- 关键业务场景有人工复核机制。

#### 第五阶段：把可观测性纳入交付标准

目标：

- 新 Agent / 新工具上线必须有 trace、指标、告警、评估；
- 不再把观测视为“上线后再补”。

---

## 十一、一个完整的落地建议：如何选择你的 AI Agent 可观测性方案

如果你正准备在团队内部推进这件事，我建议优先回答下面五个问题：

### 11.1 你的核心问题是调试、评估，还是平台治理？

- 如果你最痛的是 prompt/agent 调试与回归测试，LangSmith 通常更高效；
- 如果你最痛的是私有部署、数据主权、平台接入，LangFuse 更有优势；
- 如果两者都很重要，可以考虑“开发/实验 + 生产治理”分层建设。

### 11.2 你现在的技术栈是什么？

- LangChain / LangGraph 深度用户：LangSmith 上手优势明显；
- 自研框架、多语言异构服务：LangFuse 的通用性更适合；
- 强平台团队：可以围绕 LangFuse 或 OpenTelemetry 思路扩展内部标准。

### 11.3 你的组织是否允许把 Prompt/Trace 放到外部平台？

这会直接决定可选范围。如果组织不允许，就别在选型上浪费太多时间，优先研究自托管与脱敏方案。

### 11.4 你的团队有没有维护观测平台的能力？

自托管并不是“免费午餐”。数据库、ClickHouse、升级、备份、容量、权限、监控，都是实际成本。

### 11.5 你是否准备好把观测与评估长期化？

真正的收益通常不是接入当天，而是在后续几个月里：

- 你是否愿意维护 dataset；
- 是否会持续更新评估集；
- 是否会用 trace 复盘线上事故；
- 是否会把指标和告警纳入运维流程。

如果答案是肯定的，那么这套系统才会真正发挥价值。

---

## 结语：可观测性不是 AI Agent 的附属品，而是它走向生产的基础设施

AI Agent 和传统软件最大的不同之一，在于它的行为具有概率性、链路更长、问题更多表现为“软错误”。这意味着你很难只靠代码审查、单元测试、普通日志去保证系统稳定可控。

你需要的是一套能够同时回答以下问题的基础设施：

- 这次请求内部到底发生了什么？
- 为什么它答成这样？
- 是哪个工具、哪段 prompt、哪次检索出了问题？
- 新版本比旧版本更好吗？
- 成本和延迟为什么变高了？
- 哪些 bad case 应该进入长期回归集？
- 用户真正不满意的链路长什么样？

在这个意义上，LangSmith 与 LangFuse 代表的是两种非常有价值的建设路径：

- **LangSmith** 更适合围绕 tracing、datasets、evaluation 建立快速闭环，尤其适合 LangChain / LangGraph 生态和强调迭代效率的团队；
- **LangFuse** 更适合围绕开源、自托管、可扩展埋点模型构建企业级 AI 可观测平台，尤其适合重视数据主权与平台治理的组织。

无论最终选哪条路线，有几件事是不会变的：

1. 没有 tracing，就没有真正的 Agent 调试能力；
2. 没有 dataset 与 evaluation，就没有可靠的版本迭代依据；
3. 没有 latency / token / cost 监控，就没有生产可控性；
4. 没有与 Prometheus / Grafana、告警系统、人工反馈的联动，就难以形成完整闭环。

如果你今天只做一件事，我建议先从最小闭环开始：

- 接入 trace；
- 给每条请求加 metadata；
- 记录 token、latency、cost；
- 把坏案例沉淀成 dataset；
- 用自动评估跑一轮回归；
- 再把核心指标接进 Grafana。

一旦这条链跑起来，你会明显感受到：AI Agent 的开发不再像“黑箱调参”，而开始变成一项可以度量、可调试、可迭代、可交付的工程工作。

这，才是 AI Agent 可观测性的真正意义。

## 相关阅读

- [AI Agent 安全实战：Prompt Injection 防护、权限控制、输出过滤](/categories/AI/2026-06-02-ai-agent-security-prompt-injection-permission-control/)
- [AI Agent 工具调用实战：Function Calling 标准化与错误处理](/categories/AI/2026-06-02-ai-agent-function-calling-standardization-error-handling/)
- [AI Agent 规划能力实战：ReAct/Tree-of-Thought/Graph-of-Thought 推理模式](/categories/AI/2026-06-02-ai-agent-reasoning-patterns-react-tot-got-planning/)
- [Dify 实战：低代码 AI 应用平台搭建与工作流编排](/categories/AI/2026-06-02-dify-workflow-guide-low-code-ai-platform/)
