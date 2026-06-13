---

title: OpenClaw 模型策略实战：多模型路由与成本优化
keywords: [OpenClaw, 模型策略实战, 多模型路由与成本优化]
date: 2026-06-02 10:00:00
tags:
- OpenClaw
- AI Agent
- 模型路由
- 成本优化
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 本文围绕 OpenClaw 多模型路由与成本优化展开，系统讲解 AI Agent 在生产环境中的任务分层、模型策略、预算控制、Token 治理、回退降级与可观测性设计，并结合配置示例、路由伪代码和工程实践，帮助你构建兼顾质量、时延与成本的可运营模型调度架构。
---



在大模型进入工程化落地阶段之后，团队很快会发现一个现实问题：**模型能力并不等于系统能力，单一模型方案也很难等于可持续的业务方案**。很多项目在 PoC 阶段看起来进展顺利：研发拿到一个能力强、效果亮眼的模型，把它接入 Agent 或工作流引擎，然后让所有请求都走同一条链路。早期用户量不大、任务类型相对单一时，这种方式往往能快速上线。但当业务逐渐扩大，问题就会一批一批暴露出来：成本不可控、时延波动明显、不同任务对模型能力的需求差异巨大、长上下文请求把预算迅速吃空，而高峰期的一次模型抖动还可能直接拖垮整条链路。

如果说“把模型接进去”只是 AI 系统的第一步，那么“把模型用对、用稳、用省”才是真正决定生产可用性的关键。也正因为如此，多模型路由（Multi-Model Routing）正在成为越来越多 AI 应用和 Agent 系统的核心能力。它并不是简单地“准备多个模型备用”，而是一套围绕**任务识别、模型分层、成本治理、质量保障与故障兜底**建立起来的调度体系。对于 OpenClaw 这类强调编排、执行与扩展性的 Agent 系统而言，多模型策略更不是锦上添花，而是系统走向生产级的必经之路。

本文将结合 OpenClaw 的使用场景，系统拆解一套面向实战的模型策略方法论：我们会从为什么需要多模型路由讲起，进一步讨论如何按任务类型选择模型、如何建立成本监控与预算控制、如何压缩 Token 消耗、如何设计回退与降级机制，以及在生产环境里如何将这些策略落到真正可运行的调度流程中。文章中会穿插配置示例、伪代码和工程实践建议，目标不是停留在概念层，而是帮助你构建一套可以上线、可以观测、可以持续迭代的 OpenClaw 模型调度架构。

## 一、为什么 OpenClaw 需要多模型路由

很多团队第一次做 Agent 系统时，直觉上会选择“最强模型统一处理一切”。这背后的逻辑很简单：既然这个模型在推理、代码、总结、规划上都表现不错，那让它一把梭应该最省事。然而在真实业务里，这种做法通常会遭遇三个问题。

首先是**成本结构失衡**。并非所有请求都需要最强模型来处理。一个简单的文本分类、标签提取、JSON 结构化输出，甚至是短上下文问答，让旗舰模型来做往往属于明显的能力过剩。结果就是高单价模型被大量低价值任务占用，整体账单飞速上涨。

其次是**时延与吞吐不匹配**。强模型通常意味着更高的推理成本和更长的响应时间，而很多 Agent 环节本身只是工作流中的一个中间节点。例如工具选择、参数修正、结果重写、上下文压缩等步骤，本质上更适合用轻量模型完成。如果所有节点都绑定同一个大型模型，整个工作流的尾延迟会被大幅拉长。

最后是**风险集中**。当系统只有一个主模型时，供应商限流、区域故障、质量抖动、价格调整都会直接影响业务可用性。单模型架构表面上简单，实际上把所有不确定性都堆积在了一个点上。

多模型路由要解决的，正是这些问题。它的核心思想可以概括为一句话：**让不同复杂度、不同价值密度、不同时效要求的任务，匹配不同成本和能力曲线的模型**。换句话说，我们不是追求“某个模型最强”，而是追求“在当前任务与当前约束下，整体系统最优”。

在 OpenClaw 中，这种思路尤其重要，因为 Agent 的天然特性决定了系统内存在大量异构任务：

- 用户意图理解与任务拆解
- 工具调用前的参数构造
- 搜索结果总结与重写
- 长上下文记忆压缩
- 代码生成、修复与解释
- 低风险自动回复
- 高价值决策建议
- 多轮交互中的中间反思与验证

这些任务在准确率、格式约束、逻辑复杂度、上下文长度、响应时间和预算容忍度上差异极大。如果仍然坚持一个模型覆盖全部环节，本质上是用“平均主义”消耗系统效率。

因此，从架构视角看，OpenClaw 的模型策略应该升级为一个独立的控制平面，而不是散落在代码中的几行 if/else。它至少要回答以下问题：

1. 当前请求属于什么任务类型？
2. 对该任务而言，质量、速度、成本哪个更优先？
3. 当前上下文长度是否已经逼近某类模型的成本阈值？
4. 如果主模型失败，备用模型如何无缝接管？
5. 如果预算不足，系统是否有可接受的降级路径？
6. 如何用观测数据反向修正路由规则？

只有这些问题被系统性回答，多模型路由才算真正落地。

## 二、多模型路由的总体设计思路

### 1. 从“模型调用”升级到“模型调度”

许多项目把模型选择写死在某个配置项里，例如：

```yaml
llm:
  provider: openai
  model: gpt-4.1
```

这种配置适合单体 Demo，但不适合生产系统。因为它表达的是“默认调用哪个模型”，而不是“系统如何根据任务与约束做决策”。当你需要在摘要任务上使用便宜模型、在复杂规划上使用高能力模型、在结构化抽取上使用高稳定性模型时，这种静态配置就不够了。

更合理的方式，是把模型层设计成一个调度模块：上层只描述任务目标与策略约束，下层由路由器选择模型。示意如下：

```yaml
model_router:
  default_strategy: balanced
  strategies:
    balanced:
      primary: qwen-plus
      fallback: qwen-turbo
    premium:
      primary: gpt-4.1
      fallback: claude-sonnet
    economy:
      primary: qwen-turbo
      fallback: deepseek-chat
```

此时业务层表达的就不再是“直接用哪个模型”，而是“当前任务走哪种策略”。这为后续按预算、按时延、按环境动态调整留下了空间。

### 2. 路由维度不应只有任务类型

很多人谈多模型路由时，只想到“根据任务类型选择模型”。这当然重要，但远远不够。真正的生产级路由至少应包含以下维度：

- **任务类型**：分类、摘要、代码生成、规划、翻译、RAG 问答、函数调用等
- **上下文规模**：输入 Token 数、历史轮次、附件长度
- **质量等级**：是否是高价值用户、是否是关键流程、是否需要高准确率
- **时延要求**：实时响应还是离线批处理
- **预算状态**：团队日预算、租户预算、用户套餐预算、任务级预算
- **模型健康度**：可用性、超时率、错误率、平均响应时间
- **输出约束**：是否需要严格 JSON、是否有 function calling、是否要求稳定格式

多模型路由不是单一规则，而是多个约束叠加后的决策结果。

### 3. 把“能力”抽象为可比较的策略标签

如果系统里直接写大量“某某模型适合什么”的硬编码判断，后期维护会非常痛苦。更好的做法，是为模型定义统一的能力标签。例如：

```yaml
models:
  gpt-4.1:
    tier: premium
    strengths: [reasoning, coding, planning, json]
    max_context: 128000
    cost_in: 0.01
    cost_out: 0.03
    latency: medium
  qwen-turbo:
    tier: economy
    strengths: [classification, rewrite, extraction, json]
    max_context: 32000
    cost_in: 0.0008
    cost_out: 0.002
    latency: low
  deepseek-chat:
    tier: balanced
    strengths: [general, summarization, coding]
    max_context: 64000
    cost_in: 0.001
    cost_out: 0.002
    latency: low
```

路由器面对任务时，只需要匹配这些标签，而不是耦合具体厂商名称。这会带来两个好处：

- 替换模型时，只改配置，不改业务逻辑
- 可以做 A/B 测试与供应商切换，而不需要重写任务定义

### 4. 先做规则路由，再做数据驱动优化

多模型路由的演进，一般要经历两个阶段。

第一阶段是**规则驱动**。根据经验先定义一些直观规则，例如“摘要任务优先轻量模型”“代码修复优先高能力模型”“当输入大于 20k token 时优先长上下文模型”“预算剩余低于 20% 时自动降级”。这一阶段的目标是快速建立可控性。

第二阶段才是**数据驱动**。在你积累了足够的调用日志、成本数据、成功率数据后，可以进一步分析：

- 哪些任务其实不需要高价模型？
- 哪些模型在某类输出格式上失败率更低？
- 哪些租户愿意为质量付费，哪些更在意速度？
- 在不同时间段，模型供应商的时延表现是否有明显差异？

很多团队一上来就想做“智能模型选择器”，最后既没有规则也没有数据。正确顺序应当是：**先能跑，后变聪明；先可解释，后做自适应。**

## 三、按任务类型选择模型：从能力匹配到任务分层

任务类型是最直观、最核心的路由维度。问题在于，很多系统对任务类型的定义过于粗糙，往往只有“聊天”“代码”“总结”这种宽泛分类，无法支撑细粒度调度。要想让模型策略真正发挥价值，建议把 OpenClaw 中的任务进一步拆成以下几层。

### 1. 轻任务：优先低成本、高吞吐模型

轻任务的特点是：

- 输入短
- 推理链路简单
- 输出模式稳定
- 结果错误的业务损失较低
- 可通过规则或后处理弥补部分不足

典型场景包括：

- 文本分类与标签打标
- FAQ 匹配前的意图归类
- 标题生成、润色改写
- 搜索结果摘要
- 表单字段抽取
- 简单 JSON 结构化输出
- 历史消息压缩与记忆摘要

这类任务适合优先使用低成本模型。例如：

```yaml
task_routes:
  intent_classification:
    preferred_capabilities: [classification, json]
    strategy: economy
    max_input_tokens: 4000
  memory_summarization:
    preferred_capabilities: [summarization]
    strategy: economy
    max_input_tokens: 8000
  search_snippet_rewrite:
    preferred_capabilities: [rewrite]
    strategy: economy
```

这里的关键不是“便宜就行”，而是要确保轻任务与模型能力的边界相匹配。比如你让低价模型去做严格结构化抽取，就需要加上输出校验和重试，否则省下的模型钱可能会在后处理和人工修复上成倍还回去。

### 2. 中等复杂任务：平衡质量与成本

中等复杂任务通常是系统里的主力流量，它们比轻任务更依赖理解能力，但又不一定需要顶级推理模型。典型包括：

- 多轮问答中的普通咨询
- 基于检索结果的回答生成
- 长文总结
- 文档对比
- API 文档解释
- 中等复杂度代码解释与修复

这一层任务适合使用“balanced”级别模型，即在成本和效果之间做折中。配置示例：

```yaml
task_routes:
  rag_answer:
    preferred_capabilities: [general, summarization, grounding]
    strategy: balanced
    fallback_strategy: economy
  document_summary:
    preferred_capabilities: [summarization, long_context]
    strategy: balanced
  code_explain:
    preferred_capabilities: [coding, reasoning]
    strategy: balanced
```

这一层的难点在于识别“什么时候应该升级到高能力模型”。比如文档问答表面上只是 RAG，但如果用户问题涉及跨段落推理、规范冲突判断、方案对比与取舍，它就已经不再是普通摘要任务，而更接近复杂 reasoning。此时路由器需要结合提示词标签、上下文长度和业务优先级做进一步判定。

### 3. 重任务：高价值、高风险、高复杂度请求

重任务往往是业务体验的决定性时刻，也是最值得花钱的地方。特点包括：

- 逻辑链条长
- 需要多步规划或复杂推理
- 输出错误代价高
- 结果可能直接影响决策、执行或客户交付

典型场景：

- Agent 自主任务规划与步骤拆解
- 复杂代码生成、架构设计、疑难 bug 定位
- 高价值客户咨询与专家问答
- 合同、制度、规范类复杂条款解析
- 多工具协同前的计划生成
- 关键审批或自动执行前的风险评估

这类任务适合 premium 路由：

```yaml
task_routes:
  agent_planning:
    preferred_capabilities: [planning, reasoning, tool_use]
    strategy: premium
    fallback_strategy: balanced
  critical_code_generation:
    preferred_capabilities: [coding, reasoning]
    strategy: premium
  policy_analysis:
    preferred_capabilities: [reasoning, long_context, grounding]
    strategy: premium
```

注意，这里不是说所有复杂任务都必须使用最贵模型，而是说要把预算优先留给真正影响业务结果的环节。很多系统失败的原因恰恰相反：在低价值环节过度消耗预算，反而让真正关键的任务在预算吃紧时被迫降级。

### 4. 将任务识别嵌入 OpenClaw 工作流

在 OpenClaw 中，任务类型最好不要依赖开发者手工传入，而应通过工作流节点元数据、提示模板和上下文分析自动识别。例如：

```json
{
  "node": "answer_with_retrieval",
  "task_type": "rag_answer",
  "quality": "standard",
  "latency_sla_ms": 5000,
  "budget_scope": "tenant",
  "requires_json": false,
  "context_tokens_estimate": 12000
}
```

路由器接收到这些信息后，才能做统一判断。一个简单的 Python 版路由器示意如下：

```python
from dataclasses import dataclass

@dataclass
class TaskRequest:
    task_type: str
    quality: str
    latency_sla_ms: int
    budget_scope: str
    requires_json: bool
    context_tokens_estimate: int


def select_strategy(req: TaskRequest) -> str:
    if req.task_type in {"intent_classification", "memory_summarization"}:
        return "economy"

    if req.task_type in {"rag_answer", "document_summary", "code_explain"}:
        if req.context_tokens_estimate > 24000:
            return "balanced_long_context"
        return "balanced"

    if req.task_type in {"agent_planning", "critical_code_generation", "policy_analysis"}:
        if req.quality == "high":
            return "premium"
        return "balanced"

    return "balanced"
```

这个示例并不复杂，但已经体现出一个关键原则：**先把任务语义显式化，才能谈路由优化。**

## 四、成本监控与预算控制：没有度量，就没有优化

多模型路由最常见的误区，是只讨论“如何选模型”，却没有建立完整的成本观测体系。结果系统上线之后，大家只知道账单在涨，却不知道是哪些任务、哪些租户、哪些工作流、哪些上下文长度造成的增长。

要把成本真正管起来，至少需要建立三层监控：调用层、业务层、预算层。

### 1. 调用层：记录每一次模型请求的细粒度指标

每次调用模型时，建议至少记录以下字段：

- request_id
- trace_id / workflow_id
- tenant_id / user_id
- task_type
- model_name
- provider
- prompt_tokens
- completion_tokens
- total_tokens
- estimated_cost
- latency_ms
- success / error_type
- fallback_count
- cache_hit / miss
- timestamp

示例日志结构：

```json
{
  "trace_id": "wf_20260602_001",
  "tenant_id": "acme",
  "task_type": "rag_answer",
  "model": "deepseek-chat",
  "provider": "openrouter",
  "prompt_tokens": 5821,
  "completion_tokens": 732,
  "total_tokens": 6553,
  "estimated_cost": 0.0112,
  "latency_ms": 2860,
  "success": true,
  "fallback_count": 0,
  "cache": "miss",
  "timestamp": "2026-06-02T10:15:23Z"
}
```

这一步的意义在于，后续所有预算策略、优化动作与异常排查，都要依赖这些一手数据。

### 2. 业务层：按任务、租户、流程聚合成本

如果调用层只回答“这一次花了多少钱”，那么业务层回答的是“钱花在哪了”。

建议至少构建以下聚合视角：

- 按任务类型的成本占比
- 按工作流节点的成本占比
- 按租户的日/周/月成本曲线
- 按模型的调用次数、成功率、平均时延
- 按输入 Token 区间的单次平均成本
- 按缓存命中率区分的成本节省情况

举例来说，如果你发现 `memory_summarization` 占了整体调用量的 25%，但贡献价值很低，那就说明这里存在明显的优化空间；如果 `agent_planning` 调用量只占 5%，却消耗了 30% 的预算，也许就需要针对提示词和上下文裁剪做专项优化。

### 3. 预算层：把成本治理前置到决策阶段

很多团队的预算控制停留在“月底看账单”。这不是控制，这是事后复盘。真正有效的预算控制，一定发生在请求路由之前。

常见预算维度包括：

- **全局预算**：整个系统每天/每月的成本上限
- **租户预算**：单个客户的套餐额度或合同预算
- **用户预算**：个人账号、团队空间、部门配额
- **任务预算**：某类任务单次允许的最大成本
- **会话预算**：一次复杂 Agent 执行允许消耗的总预算

可以把预算状态注入路由器，让预算影响模型决策。例如：

```python
@dataclass
class BudgetState:
    global_remaining_ratio: float
    tenant_remaining_ratio: float
    session_remaining_usd: float


def apply_budget_guard(strategy: str, budget: BudgetState) -> str:
    if budget.global_remaining_ratio < 0.1:
        return "economy"

    if budget.tenant_remaining_ratio < 0.15 and strategy == "premium":
        return "balanced"

    if budget.session_remaining_usd < 0.02 and strategy in {"premium", "balanced"}:
        return "economy"

    return strategy
```

注意，预算控制不等于一刀切降级。理想做法是：

- 先保护关键任务预算
- 再压缩非关键任务成本
- 最后才是整体降级

这意味着预算体系需要和任务优先级绑定，而不是对所有请求统一限流。

### 4. 设定预算告警与自动动作

预算监控如果只有图表，没有动作，也很难真正落地。建议配套以下自动化机制：

- 日预算达到 60%、80%、95% 触发告警
- 某租户成本异常飙升时自动通知运营/研发
- 某类任务单位成本连续上涨时触发优化工单
- premium 模型调用比例超过阈值时自动切换策略
- 超出预算后禁用非关键任务的高阶能力

示例配置：

```yaml
budget_control:
  daily_limit_usd: 300
  alerts:
    - threshold: 0.6
      action: notify
    - threshold: 0.8
      action: degrade_non_critical
    - threshold: 0.95
      action: premium_freeze
  tenant_rules:
    default_monthly_limit_usd: 500
    overage_action: balanced_only
```

## 五、Token 使用优化策略：真正吞掉预算的往往不是模型单价，而是上下文浪费

在模型成本构成中，很多团队最先关注的是“哪个模型更便宜”，却忽略了另一个更常见、更可控的变量：**Token 使用效率**。现实中，大量预算浪费并不是因为你选错了供应商，而是因为系统持续把不必要的上下文送进模型。

对 OpenClaw 这样的 Agent 系统来说，Token 优化几乎等于系统优化，因为它直接影响三件事：

- 单次请求成本
- 响应速度
- 上下文窗口可承载的信息密度

下面分几个方面展开。

### 1. 控制系统提示词的长度与重复度

很多项目的 system prompt 写得像产品说明书，动辄几千 Token，而且在每一次调用中都完整重复。这样做可能让人心理上觉得“更稳”，但从成本角度看代价极高。

优化方法包括：

- 把稳定不变的大段说明迁移为更简洁的规则集合
- 对不同任务使用专门化 prompt，而不是一个万能大提示词
- 删除重复的行为约束，避免多次表达同一规则
- 将示例数量控制在必要范围内

例如，下面是一个偏臃肿的提示词：

```text
你是一个专业、严谨、负责、耐心、可靠的 AI 助手。请你仔细阅读用户输入、理解其深层意图、遵循所有格式要求、保持回答准确完整、避免幻觉、必要时给出免责声明、如果需要请进行分步推理、在输出 JSON 时不要包含额外说明……
```

压缩后可以改成：

```text
你是 OpenClaw 工作流中的结构化执行助手。
要求：
1. 仅基于输入内容作答；
2. 输出必须符合 JSON Schema；
3. 信息不足时返回 need_more_context=true。
```

短 prompt 不一定意味着效果差，关键在于是否保留了真正约束模型行为的核心信息。

### 2. 对历史对话做分层记忆，而不是无脑拼接

多轮对话是 Token 黑洞。很多系统的实现方式是把所有历史消息直接拼接到下一轮请求中，结果会导致成本随着轮次线性甚至指数式增加。

更合理的方式是分层记忆：

- **短期记忆**：保留最近 3~8 轮原始对话
- **长期记忆摘要**：将更早历史压缩为结构化摘要
- **事实记忆**：提取用户偏好、环境信息、关键结论
- **任务记忆**：仅保留当前任务相关的上下文

示例结构：

```json
{
  "recent_messages": ["...最近几轮原文..."],
  "conversation_summary": "用户正在排查 Kubernetes 服务暴露问题，已确认 Service 类型为 LoadBalancer，但云厂商侧未分配公网 IP。",
  "facts": {
    "cluster": "prod-cn-01",
    "namespace": "payment",
    "cloud": "aws"
  }
}
```

这样做的本质，是把“可丢失的表述细节”和“不可丢失的事实约束”分离出来，避免整个系统反复支付相同 Token 的成本。

### 3. 检索增强不是检得越多越好

RAG 系统的常见误区是：为了提高召回率，一次性塞入大量文档片段。结果模型面对十几段甚至几十段相似文本，不仅成本高，而且更难聚焦，答案质量反而下降。

更好的策略是：

- 先用 embedding / reranker 做候选压缩
- 限制最终送入模型的片段数量，例如 3~6 段
- 对长文档做 chunk 摘要，而不是原文硬塞
- 去重相似片段，避免重复信息占上下文
- 对检索结果做 metadata 过滤，如时间、文档类型、可信度

一个实用的配置示例：

```yaml
retrieval:
  top_k_initial: 20
  rerank_top_k: 6
  max_chunks_to_llm: 4
  deduplicate: true
  chunk_summary_enabled: true
  max_context_tokens: 12000
```

### 4. 对输出长度设置上限，避免“能说就多说”

有些模型天然倾向于输出更长文本。如果不加约束，completion tokens 会明显膨胀。对于结构化任务、分类任务和简要总结任务，更应明确输出边界。

例如：

```yaml
response_policies:
  intent_classification:
    max_output_tokens: 120
  memory_summarization:
    max_output_tokens: 300
  rag_answer:
    max_output_tokens: 800
  agent_planning:
    max_output_tokens: 1500
```

这不仅省钱，也能减少无关信息，提升后处理稳定性。

### 5. 做缓存，而不是重复生成

如果某些请求具备明显重复性，例如：

- 相同知识库文档的摘要
- 常见 FAQ 的标准回答
- 相同系统提示词 + 相同输入的结构化抽取
- 代码库固定文件的解释

那么 LLM 缓存可以带来非常直接的成本收益。缓存可以分为：

- **全量响应缓存**：命中后直接返回完整结果
- **检索缓存**：缓存文档召回结果
- **摘要缓存**：缓存长文或历史消息的压缩版本
- **提示模板缓存**：缓存模板编译结果

即使只把高重复率任务做缓存，通常也能显著降低整体账单。

## 六、回退与降级机制：保证系统不会因为一个模型失效而整体瘫痪

生产环境里，模型服务的不确定性远高于很多团队的预期。常见问题包括：

- 接口超时
- 供应商限流
- 瞬时高错误率
- 输出格式不符合约束
- 某区域可用性异常
- 模型更新后质量波动

因此，多模型路由不仅要解决“怎么选更优”，还要解决“主路不通时怎么活下来”。这正是回退与降级机制的价值所在。

### 1. 区分三类失败：调用失败、格式失败、质量失败

并不是所有失败都应该用同样的回退策略处理。至少应区分：

#### 调用失败

例如超时、429、5xx、网络错误。这类问题通常适合快速切到备用模型或备用供应商。

#### 格式失败

例如要求输出 JSON，结果模型返回了自然语言；或者 function call 参数缺失。这类问题未必需要立刻换模型，也可以先进行一次同模型重试，附加更强约束。

#### 质量失败

例如回答明显跑题、代码不能运行、总结遗漏关键结论。这类问题最难自动判断，但可以通过规则校验、单元测试、schema 校验、关键词约束等方式构造“近似质量门禁”。

只有先区分失败类型，回退策略才不会粗暴。

### 2. 设计分级回退路径

推荐的回退链路一般是：

1. 主模型调用
2. 同模型快速重试
3. 备用模型接管
4. 降级提示或半自动模式
5. 人工兜底 / 异步处理

示例配置：

```yaml
fallback_policy:
  rag_answer:
    primary: deepseek-chat
    retry_on: [timeout, rate_limit, invalid_json]
    retry_times: 1
    fallback_models:
      - qwen-plus
      - qwen-turbo
    final_action: return_brief_answer

  agent_planning:
    primary: gpt-4.1
    retry_on: [timeout, server_error]
    retry_times: 1
    fallback_models:
      - claude-sonnet
      - deepseek-chat
    final_action: switch_to_human_review
```

这类配置的重点不是写得多复杂，而是让每个任务都有明确兜底路径。

### 3. 降级不是失败，而是服务连续性的体现

很多产品团队把降级理解为“体验变差”，所以抗拒设计降级路径。但在生产环境中，合理降级本质上是在保护主流程可用性。例如：

- 把长答案降级成简答版本
- 关闭非关键解释性文本，只返回核心结果
- 暂停高级规划能力，保留基础问答能力
- 把同步生成改为异步处理
- 对高成本任务要求用户确认后再执行

这些都属于可接受的工程妥协。用户通常比你想象中更能接受“系统当前提供简化版结果”，而不能接受“整个服务直接不可用”。

### 4. 健康检查驱动动态路由

不要等用户请求失败了才发现模型不可用。更成熟的做法是持续做模型健康探测，并把健康度指标反馈给路由器。例如：

- 最近 5 分钟错误率
- 最近 5 分钟 p95 时延
- 限流比例
- JSON 合法率
- 平均重试次数

一旦某个模型健康分低于阈值，就自动降低其流量权重甚至暂时摘除。示例：

```python
def health_score(error_rate, p95_latency, invalid_json_rate):
    score = 100
    score -= error_rate * 50
    score -= min(p95_latency / 1000, 10) * 3
    score -= invalid_json_rate * 30
    return max(score, 0)


def is_available(score: float) -> bool:
    return score >= 60
```

### 5. 保留“最低能力模式”

对于关键系统，我建议始终保留一个“最低能力模式（minimum viable intelligence mode）”。意思是，即使高级模型全部不可用，系统仍能基于规则、小模型或固定模板维持最基础的功能。比如：

- FAQ 命中后直接返回模板答案
- 分类任务退化为规则引擎
- 文档总结退化为提取式摘要
- 工具型任务只做参数校验，不做复杂规划

这个模式未必优雅，但能在故障期争取恢复时间。

## 七、实际生产环境的模型调度案例

为了避免讨论停留在抽象层，下面结合几个生产环境常见场景，展示如何设计 OpenClaw 的模型调度策略。

### 案例一：企业知识库问答系统

#### 业务特点

- 流量大，绝大多数是普通问答
- 少量问题涉及复杂制度、跨文档对比
- 租户对成本较敏感
- 输出必须尽量引用依据，减少幻觉

#### 路由思路

1. 先对问题做意图分类，判断是 FAQ、普通检索问答还是复杂分析问答
2. FAQ 直出或走 economy 模型
3. 普通 RAG 问答走 balanced 模型
4. 复杂分析类问题，如“对比两份制度差异并指出风险”，升级到 premium
5. 当租户预算不足时，普通问答降级为 economy，复杂分析改为“分步返回 + 异步补全”

#### 示例配置

```yaml
openclaw_router:
  task_routes:
    faq_match:
      strategy: economy
      model: qwen-turbo

    rag_answer:
      strategy: balanced
      model: deepseek-chat
      fallback_models: [qwen-plus, qwen-turbo]
      constraints:
        require_citation: true
        max_context_tokens: 10000

    policy_compare:
      strategy: premium
      model: gpt-4.1
      fallback_models: [claude-sonnet, deepseek-chat]
      constraints:
        require_citation: true
        max_context_tokens: 24000
```

#### 收益分析

这种分层后，系统通常能把大多数普通请求压到中低成本模型，而只把真正复杂的问题送给高能力模型。对企业知识库这类场景而言，往往能在维持体验的前提下显著降低总账单。

### 案例二：代码 Agent 与自动修复流水线

#### 业务特点

- 请求价值高，但调用频次相对低
- 一部分任务是简单解释与格式修复
- 另一部分任务是复杂代码生成、测试修复与多文件修改
- 输出质量可通过 lint、测试、编译结果进行验证

#### 路由思路

1. 代码解释、注释生成、日志归类等轻任务走 balanced/economy
2. 单文件简单修复先走 balanced
3. 涉及多文件联动、架构调整、测试驱动修复时升级 premium
4. 如果 premium 失败，先降级为“仅生成修复建议，不自动提交修改”
5. 用自动测试结果反向触发重试或模型升级

#### 代码示例

```python
class CodeTaskRouter:
    def route(self, task):
        if task.kind in {"comment_generation", "log_classification", "code_explain"}:
            return "balanced"

        if task.kind == "bug_fix":
            if task.files_changed > 3 or task.has_failing_tests:
                return "premium"
            return "balanced"

        if task.kind == "refactor_plan":
            return "premium"

        return "balanced"

    def should_escalate(self, task, result):
        if result.compile_failed:
            return True
        if result.tests_pass_rate < 0.8:
            return True
        return False
```

#### 关键经验

代码类场景非常适合“验证驱动路由”，也就是不只根据任务前置信息选模型，还根据输出后的客观验证结果决定是否升级。这样能避免一开始就对所有任务使用最贵模型。

### 案例三：客服 Agent 的分层成本治理

#### 业务特点

- 量大，实时性要求高
- 大量重复咨询
- 只有少数会话最终升级为高价值人工辅助场景
- 成本与响应时间都高度敏感

#### 路由思路

1. 第一层用规则 + 向量召回处理高频 FAQ
2. 第二层用 economy 模型处理简单咨询
3. 第三层对投诉、升级工单、退款争议等高风险场景切到 balanced/premium
4. 当日预算接近阈值时，先缩减普通咨询的输出长度和解释性文本
5. 保证高风险工单仍可使用高质量模型

#### 策略配置

```yaml
customer_support:
  tiers:
    faq:
      action: direct_answer
    simple_consult:
      strategy: economy
      max_output_tokens: 220
    dispute_case:
      strategy: balanced
      max_output_tokens: 600
    vip_escalation:
      strategy: premium
      max_output_tokens: 1200
  budget_degrade:
    level1:
      trigger: 0.7
      action: shorten_simple_answers
    level2:
      trigger: 0.85
      action: economy_only_for_non_vip
    level3:
      trigger: 0.95
      action: premium_reserved_for_dispute_and_vip
```

### 案例四：长文档分析与审阅系统

#### 业务特点

- 输入上下文极长
- 用户不一定要求秒级响应，但要求结论可靠
- 成本受输入 Token 强烈影响

#### 路由思路

1. 先对长文档分块摘要，用 economy/balanced 模型完成预处理
2. 再将块摘要汇总成文档级摘要
3. 只有在用户提出复杂分析问题时，才调用 premium 模型基于摘要与关键段落作深度推理
4. 如果问题只是“这份文档讲了什么”，则不必直接对全文使用高价模型

#### 工程价值

这是典型的“先压缩，再推理”思路。很多长文档系统成本高，不是因为用户问题复杂，而是因为它们跳过了预处理阶段，直接把大段原文喂给昂贵模型。

## 八、OpenClaw 中可落地的模型调度实现方案

上面讲了大量原则与案例，下面进一步给出一个相对完整的工程实现思路，帮助你在 OpenClaw 中落地。

### 1. 定义统一的模型注册表

建议把模型信息统一放在配置中心：

```yaml
models:
  qwen-turbo:
    provider: openrouter
    tier: economy
    features: [classification, rewrite, extraction, json]
    max_context: 32000
    input_cost_per_1k: 0.0008
    output_cost_per_1k: 0.002
    healthy: true

  deepseek-chat:
    provider: openrouter
    tier: balanced
    features: [general, summarization, coding]
    max_context: 64000
    input_cost_per_1k: 0.001
    output_cost_per_1k: 0.002
    healthy: true

  gpt-4.1:
    provider: openai
    tier: premium
    features: [reasoning, planning, coding, json, long_context]
    max_context: 128000
    input_cost_per_1k: 0.01
    output_cost_per_1k: 0.03
    healthy: true
```

### 2. 定义任务画像

```yaml
tasks:
  rag_answer:
    preferred_features: [general, summarization]
    preferred_tier: balanced
    max_budget_usd: 0.03
    max_latency_ms: 5000
    fallback_tier: economy

  agent_planning:
    preferred_features: [planning, reasoning, tool_use]
    preferred_tier: premium
    max_budget_usd: 0.12
    max_latency_ms: 12000
    fallback_tier: balanced

  memory_summarization:
    preferred_features: [summarization]
    preferred_tier: economy
    max_budget_usd: 0.005
    max_latency_ms: 3000
    fallback_tier: economy
```

### 3. 实现路由打分器

相比写死 if/else，生产环境更推荐“约束过滤 + 打分排序”。

```python
from typing import Dict, List


def score_model(task, model, budget_remaining_ratio: float, health_score: float) -> float:
    score = 0.0

    if model["tier"] == task["preferred_tier"]:
        score += 30

    feature_overlap = len(set(task["preferred_features"]) & set(model["features"]))
    score += feature_overlap * 10

    if health_score >= 80:
        score += 20
    elif health_score >= 60:
        score += 10

    if budget_remaining_ratio < 0.2 and model["tier"] == "premium":
        score -= 25

    if model["input_cost_per_1k"] <= 0.001:
        score += 8

    return score


def choose_model(task: Dict, models: List[Dict], states: Dict) -> Dict:
    candidates = []
    for model in models:
        if not model["healthy"]:
            continue
        s = score_model(task, model, states["budget_remaining_ratio"], states["health_scores"].get(model["name"], 100))
        candidates.append((s, model))
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]
```

这个思路的优势是，你后续可以不断扩充打分维度，而不用重写整个决策逻辑。

### 4. 加入观测闭环

路由器不应是静态模块，而应持续从线上数据中学习。最基础的闭环包括：

- 记录每次路由决策的原因
- 对比不同模型在同类任务上的成本与成功率
- 定期生成“模型性价比报告”
- 自动识别异常上涨的 Token 消耗
- 自动下调健康分恶化模型的权重

例如你可以在日志中记录：

```json
{
  "task_type": "rag_answer",
  "selected_model": "deepseek-chat",
  "decision_reason": [
    "matched preferred tier=balanced",
    "context_tokens within limit",
    "tenant budget remaining > 30%",
    "health score=91"
  ]
}
```

这类“可解释路由”对于后续调优非常关键，否则一旦出现质量或成本问题，你甚至不知道为什么系统选了这个模型。

## 九、实践中的常见误区

最后，再总结几个在模型策略建设中极其常见的误区。

### 1. 误区一：把多模型当成“多备胎”

如果你的多模型设计只是“主模型挂了再换一个”，那本质上只是容灾，不是路由。真正的多模型策略应该在正常情况下就让不同模型承担不同角色。

### 2. 误区二：只按价格选模型

便宜模型不一定便宜。若其失败率更高、重试更多、输出更长、后处理更复杂，综合成本未必低。成本优化必须看端到端成本，而不是只看单价。

### 3. 误区三：忽略上下文治理

很多团队花很多时间比较模型单价，最后却把大量重复上下文塞进每次调用。这种情况下，再怎么换模型也只是治标不治本。

### 4. 误区四：没有质量门禁就盲目降级

降级前必须明确哪些质量底线不能破。例如结构化输出、工具参数合法性、关键事实引用等，否则降级会把隐性问题带入生产。

### 5. 误区五：没有观测数据就谈“智能路由”

没有调用日志、没有失败分类、没有任务分层、没有成本归因，再聪明的路由器也只能靠猜。

## 十、结语：多模型策略的本质，是让 AI 系统具备经营能力

当我们讨论 OpenClaw 的多模型路由与成本优化时，本质上讨论的已经不只是一个技术组件，而是一种更成熟的 AI 工程观：**把模型当成一种需要精细调度的计算资源，而不是一个抽象、无限、总是可用的智能接口。**

在 Demo 阶段，单模型往往足够；但一旦进入生产环境，系统面临的约束会迅速增加：预算有限、SLA 存在、任务异构、质量要求分层、供应商状态波动、用户价值不同。只有把这些现实约束纳入模型调度系统，AI 应用才能真正具备持续运营能力。

回到 OpenClaw 的落地实践，我们可以把这套方法论归纳成几个核心动作：

1. **先给任务分层**，不要让所有请求混成一类；
2. **建立模型注册表与能力标签**，避免路由逻辑和具体厂商强耦合；
3. **让预算进入决策闭环**，而不是月底看账单；
4. **把 Token 优化当成第一优先级工程事项**，持续压缩上下文浪费；
5. **设计明确的回退与降级链路**，确保服务连续性；
6. **建立观测与复盘机制**，用真实数据迭代策略。

如果你正在构建一个真正面向生产的 OpenClaw Agent 系统，我的建议是：不要再问“我们该选哪个最好的模型”，而要开始问“在这个任务、这个预算、这个时刻、这个健康状态下，系统应该如何做出最合适的选择”。

当你开始这样思考时，模型就不再只是能力来源，而会成为你架构中一个可以被治理、被度量、被优化、被经营的核心资源。而这，正是 AI 系统从可用走向可靠、从实验走向规模化的分水岭。

## 相关阅读

- [OpenClaw 记忆系统实战：MEMORY.md 长期记忆与日常记忆管理](/categories/架构/OpenClaw-记忆系统实战-MEMORY-md-长期记忆与日常记忆管理/)
- [OpenClaw 技能开发实战：自定义 Skill 与工作流自动化](/categories/架构/OpenClaw-技能开发实战-自定义-Skill-与工作流自动化/)
- [OpenClaw vs Hermes Agent：开源 AI Agent 框架选型对比](/categories/架构/OpenClaw-vs-Hermes-Agent-开源AI-Agent框架选型对比/)
