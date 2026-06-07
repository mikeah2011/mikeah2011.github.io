---
title: OpenClaw 模型策略实战：多模型路由与成本优化
date: 2026-06-02 00:00:00
description: 本文系统拆解 OpenClaw 在生产环境中的模型路由与成本优化方法，覆盖多模型分层、预算控制、Fallback、Token 治理与 AI Agent 策略闭环，帮助你在保证质量、稳定性与延迟的同时，构建真正可落地、可扩展、可持续降本的多模型架构。
tags: [OpenClaw, AI Agent, 模型路由, 成本优化]
categories: [架构]
cover: /images/covers/openclaw-model-strategy-cover.jpg
---

# OpenClaw 模型策略实战：多模型路由与成本优化

在 Agent 应用逐步从 Demo 走向生产之后，团队最先遇到的问题通常不是“模型能不能回答”，而是“如何在保证效果的前提下，把延迟、成本、稳定性一起控制住”。单一模型方案在 PoC 阶段看起来最省事：接一个强模型，所有请求直接打过去，功能往往很快可用。但系统规模一旦扩大，问题会迅速显现：复杂推理任务和简单分类任务混用同一高价模型，导致整体成本失控；高峰期请求竞争同一模型池，尾延迟变长；某个模型供应商发生波动时，整条链路直接受影响；不同任务对上下文长度、工具调用、结构化输出、稳定性和响应风格的要求并不一致，却被迫接受同一种能力与同一种计价方式。

OpenClaw 这类面向 Agent 场景的框架，真正的价值并不只是“能调用模型”，而是把模型当作一种可以编排、度量、治理的资源。换句话说，模型层不再是黑盒接口，而是一个具备路由、降级、预算、观测、反馈闭环的策略系统。本文聚焦一个生产可落地的话题：如何在 OpenClaw 中设计多模型路由，并通过策略治理实现成本优化。文章会从需求动机、架构设计、按任务类型路由实现、成本监控、预算控制、fallback 策略、Token 优化技巧，以及生产环境的经验数据几个方面展开，并给出可直接改造到项目中的代码示例。

> 说明：本文中的 OpenClaw 代码示例采用 Python 风格伪实战代码，重点展示策略层设计。不同版本 SDK 的具体 API 可能略有差异，但架构思路、数据结构与治理方法具有较强普适性。

---

## 一、为什么必须做多模型路由，而不是“一个大模型打天下”

### 1.1 任务异构性决定了模型不可能单一最优

在真实 Agent 系统里，请求类型往往高度异构，至少会同时存在以下几类：

1. **轻量理解类任务**：意图识别、标签分类、路由判断、风险初筛。  
2. **结构化抽取类任务**：从邮件、日志、文档里抽字段，输出 JSON。  
3. **普通生成类任务**：客服回复、摘要、改写、报告草稿。  
4. **高复杂推理类任务**：多步分析、代码理解、规划、工具链决策。  
5. **长上下文任务**：跨多个文档做综合问答、审计、知识整合。  
6. **高可靠性执行任务**：需要严格 schema、工具调用成功率、低幻觉。  

这些任务对模型的核心要求完全不同。意图识别最重视的是低成本和低延迟；结构化抽取更看重输出稳定性；复杂推理看重 reasoning 能力；长上下文任务看重 context window；代码生成看重语法正确率和工具调用配合能力。如果所有请求都交给一个旗舰模型，最终得到的是“平均能力不错，但整体效率极低”的架构。

### 1.2 成本曲线呈现非线性放大

很多团队在早期低估了 Token 成本，原因是他们按“单次调用价格”思考，而不是按“系统级复合成本”思考。Agent 系统中的总成本通常由以下几部分构成：

- 用户请求触发的主模型调用成本
- 计划器、工具选择器、反思器带来的额外模型调用
- 检索增强时的 query rewrite、rerank、摘要成本
- 失败重试与 fallback 成本
- 长上下文拼接导致的输入 Token 暴涨
- 结构化校验失败后的二次修复调用

总成本可以近似表达为：

```text
TotalCost = Σ(RequestVolume × AvgTurns × AvgModelCallsPerTurn × AvgTokensPerCall × UnitPrice)
```

当系统日请求量从 1,000 提升到 100,000 时，哪怕单次只多花 0.01 元，月度也可能多出数万元。更关键的是，复杂 Agent 往往不是“一问一答”，而是一个请求背后触发 3~12 次模型调用。如果没有分层路由，成本会呈指数级外溢。

### 1.3 延迟、SLA 与稳定性同样需要路由治理

模型选择从来不是只有“贵”和“便宜”两个维度。生产环境里还要考虑：

- P50/P95 延迟
- 高峰时的吞吐能力
- 结构化输出成功率
- 超时率、429 频率、5xx 错误率
- 多供应商可替换性
- 地域合规与数据隔离要求

如果业务要求首字节时间在 2 秒内，而你把所有分类请求都发给复杂推理模型，哪怕答案质量更高，也不符合 SLA。反之，如果财务审计场景必须低幻觉高一致性，那么便宜小模型即使吞吐高，也不应该承担核心结论生成。

### 1.4 路由系统的目标不是“最便宜”，而是“单位业务结果最优”

真正好的模型策略，不是机械地把请求都导向最低价模型，而是在给定目标下实现最优平衡：

- 在准确率不下降超过阈值的前提下降低成本
- 在成本预算不变的前提下提高吞吐
- 在 SLA 不下降的前提下提升鲁棒性
- 在复杂任务场景中仅将高价能力用于必要环节

因此，OpenClaw 的模型策略层应该看成一个“决策中枢”：它根据任务类型、风险级别、预算状态、系统负载、历史表现，动态决定该用哪个模型、是否需要升级、是否允许降级、失败后如何切换、是否需要压缩上下文，以及本次请求是否还在预算水位内。

---

## 二、OpenClaw 模型策略架构：把模型调用变成可治理的策略平面

### 2.1 架构分层

一个可落地的 OpenClaw 模型策略体系，建议拆成五层：

1. **Provider Adapter 层**  
   屏蔽不同模型供应商 API 差异，统一调用接口、错误码、token usage 和计费字段。

2. **Model Registry 层**  
   维护模型元数据，包括能力标签、价格、上下文长度、平均延迟、结构化输出支持、工具调用支持、健康状态等。

3. **Routing Policy 层**  
   根据任务、用户等级、预算、SLA、上下文规模、失败历史等信息做模型选择。

4. **Execution Guardrail 层**  
   负责超时、重试、fallback、输出校验、schema repair、熔断与限流。

5. **Observability & Finance 层**  
   采集 token 用量、调用成本、成功率、模型命中率、P95 延迟、预算水位，并驱动后续策略调整。

### 2.2 逻辑架构图描述

可以把整个系统理解为如下链路：

```text
[Client Request]
      |
      v
[Task Analyzer / Intent Classifier]
      |
      v
[Routing Policy Engine] -----> [Budget Controller]
      |                              |
      |                              v
      |                        [Quota / Watermark]
      v
[Model Registry] <-------- [Observability Metrics]
      |
      v
[Provider Adapter(s)] ----> [Primary Model]
      |
      +--------------------> [Fallback Model]
      |
      v
[Guardrails: timeout / retry / schema validate / degrade]
      |
      v
[Response + Usage + Cost Event]
      |
      v
[Metrics / Billing / Feedback Loop]
```

如果进一步细化成生产部署视角，可以画成：

```text
                +-----------------------------+
                |       OpenClaw Gateway      |
                | auth / rate limit / trace   |
                +-------------+---------------+
                              |
                              v
                +-----------------------------+
                |     Strategy Orchestrator   |
                | task classify / route / QoS |
                +------+------+------+--------+
                       |      |      |
          +------------+      |      +--------------+
          |                   |                     |
          v                   v                     v
+----------------+   +----------------+   +----------------+
| Small Model    |   | Mid Model      |   | Large Model    |
| classify/extract|  | general gen    |   | reasoning/code |
+----------------+   +----------------+   +----------------+
          |                   |                     |
          +---------+---------+----------+----------+
                    |                    |
                    v                    v
             +-------------+      +-------------+
             | Cost Meter  |      | SLO Monitor |
             +------+------+      +------+------+ 
                    |                    |
                    +---------+----------+
                              |
                              v
                    +-------------------+
                    | Policy Feedback   |
                    | auto tune / alert |
                    +-------------------+
```

这个架构的关键点在于：**路由并不是一次性的 if/else，而是一个有反馈闭环的策略系统**。模型选择结果会被观测层反哺，从而不断修正路由权重与预算阈值。

### 2.3 Model Registry 设计

Registry 是路由引擎的基础。没有可靠元数据，所谓“智能路由”最后只能退化为硬编码。一个实用的模型配置结构至少需要以下字段：

```python
from dataclasses import dataclass, field
from typing import Optional, set

@dataclass
class ModelProfile:
    name: str
    provider: str
    max_context_tokens: int
    input_price_per_million: float
    output_price_per_million: float
    avg_latency_ms: int
    supports_json_schema: bool
    supports_tool_calling: bool
    supports_streaming: bool
    capability_tags: set[str] = field(default_factory=set)
    health_score: float = 1.0
    enabled: bool = True
    region: Optional[str] = None
```

其中 capability_tags 建议采用标签化建模，例如：

- `classification`
- `extraction`
- `chat`
- `reasoning`
- `code`
- `long_context`
- `low_latency`
- `cheap`
- `high_reliability`
- `json_strict`

这样路由引擎就不需要直接绑定某个模型名，而是按能力集合筛选候选集，再结合实时指标打分。

### 2.4 路由不是静态映射，而是“候选集 + 打分 + 约束”

常见初级做法是：

- 分类任务 -> 小模型 A
- 普通问答 -> 中模型 B
- 复杂推理 -> 大模型 C

这种做法最大的问题，是一旦 A 宕机、B 升价、C 限流，策略就完全僵化。更合理的设计是三步：

1. **基于任务类型筛选候选模型集合**  
2. **根据价格、延迟、健康度、历史成功率进行打分排序**  
3. **应用预算、上下文长度、用户等级等硬约束后做最终选择**

伪代码如下：

```python
def select_model(task, registry, budget_state, runtime_state):
    candidates = registry.filter(
        capability=task.required_capability,
        min_context=task.estimated_context_tokens,
        requires_tool=task.requires_tool_call,
        requires_json=task.requires_json_schema,
    )

    feasible = []
    for model in candidates:
        if not model.enabled:
            continue
        if budget_state.is_model_blocked(model.name):
            continue
        if runtime_state.is_circuit_open(model.name):
            continue
        score = score_model(model, task, budget_state, runtime_state)
        feasible.append((model, score))

    feasible.sort(key=lambda x: x[1], reverse=True)
    return feasible[0][0] if feasible else None
```

这种设计的优势是：业务规则与模型名单解耦，后续新增模型时只要补充 metadata 和价格信息，就能自动进入路由体系。

---

## 三、按任务类型路由实现：从规则路由到可演化策略

这一部分重点讨论 OpenClaw 中最常见的任务路由方式：按任务类型分配模型，并给出可执行思路的代码实现。

### 3.1 任务分类维度怎么定

路由首先依赖任务识别。如果分类过细，策略复杂度爆炸；如果分类过粗，路由无法体现价值。实战中建议先划分为以下一级类型：

- `intent_classification`：意图判断、标签分类
- `structured_extraction`：字段抽取、信息结构化
- `general_chat`：一般生成与对话
- `knowledge_qa`：带检索的知识问答
- `complex_reasoning`：复杂分析、多步骤推理
- `code_generation`：代码生成、代码审阅
- `workflow_planning`：Agent 规划、工具决策

随后再叠加几个横切维度：

- 风险等级：`low/medium/high`
- 是否需要严格 JSON
- 是否需要工具调用
- 预估上下文长度
- 用户等级或租户等级
- 是否命中预算告警

### 3.2 一个简化但实用的 Router 设计

下面给出一个较完整的示例。代码目标不是绑定某个特定 SDK，而是展示路由思想。

```python
from dataclasses import dataclass
from enum import Enum
from typing import Optional

class TaskType(str, Enum):
    INTENT = "intent_classification"
    EXTRACTION = "structured_extraction"
    CHAT = "general_chat"
    QA = "knowledge_qa"
    REASONING = "complex_reasoning"
    CODE = "code_generation"
    PLAN = "workflow_planning"

@dataclass
class TaskContext:
    task_type: TaskType
    estimated_input_tokens: int
    requires_json_schema: bool = False
    requires_tool_calling: bool = False
    risk_level: str = "low"
    tenant_tier: str = "standard"
    latency_slo_ms: int = 4000
    max_cost_usd: Optional[float] = None

class RoutingPolicy:
    def __init__(self, registry, budget_controller, runtime_state):
        self.registry = registry
        self.budget_controller = budget_controller
        self.runtime_state = runtime_state

    def route(self, ctx: TaskContext):
        required_tags = self._resolve_required_tags(ctx)
        candidates = self.registry.find_by_tags(required_tags)
        candidates = [m for m in candidates if self._hard_constraints_pass(m, ctx)]
        scored = [(m, self._score(m, ctx)) for m in candidates]
        scored.sort(key=lambda x: x[1], reverse=True)
        if not scored:
            raise RuntimeError(f"No model available for task={ctx.task_type}")
        return scored[0][0]

    def _resolve_required_tags(self, ctx: TaskContext) -> set[str]:
        mapping = {
            TaskType.INTENT: {"classification", "low_latency", "cheap"},
            TaskType.EXTRACTION: {"extraction", "json_strict"},
            TaskType.CHAT: {"chat"},
            TaskType.QA: {"chat", "long_context"},
            TaskType.REASONING: {"reasoning"},
            TaskType.CODE: {"code", "reasoning"},
            TaskType.PLAN: {"reasoning", "tool_orchestration"},
        }
        tags = set(mapping[ctx.task_type])
        if ctx.requires_json_schema:
            tags.add("json_strict")
        if ctx.requires_tool_calling:
            tags.add("tool_orchestration")
        if ctx.estimated_input_tokens > 32000:
            tags.add("long_context")
        return tags

    def _hard_constraints_pass(self, model, ctx: TaskContext) -> bool:
        if not model.enabled:
            return False
        if model.max_context_tokens < ctx.estimated_input_tokens:
            return False
        if ctx.requires_json_schema and not model.supports_json_schema:
            return False
        if ctx.requires_tool_calling and not model.supports_tool_calling:
            return False
        if self.runtime_state.is_circuit_open(model.name):
            return False
        if self.budget_controller.is_blocked(model.name, ctx.tenant_tier):
            return False
        return True

    def _score(self, model, ctx: TaskContext) -> float:
        latency_score = max(0, 1 - model.avg_latency_ms / max(ctx.latency_slo_ms, 1))
        health_score = model.health_score
        cost_score = self.budget_controller.cost_fitness(model, ctx)
        reliability = self.runtime_state.success_rate(model.name)

        weight = {
            TaskType.INTENT: (0.20, 0.25, 0.40, 0.15),
            TaskType.EXTRACTION: (0.15, 0.30, 0.20, 0.35),
            TaskType.CHAT: (0.25, 0.25, 0.25, 0.25),
            TaskType.QA: (0.25, 0.20, 0.20, 0.35),
            TaskType.REASONING: (0.35, 0.20, 0.10, 0.35),
            TaskType.CODE: (0.35, 0.20, 0.10, 0.35),
            TaskType.PLAN: (0.30, 0.20, 0.15, 0.35),
        }[ctx.task_type]

        w_quality, w_health, w_cost, w_reliability = weight
        quality_proxy = self.registry.quality_score(model.name, ctx.task_type)
        return (
            quality_proxy * w_quality
            + health_score * w_health
            + cost_score * w_cost
            + reliability * w_reliability
            + latency_score * 0.10
        )
```

这个设计中有几个关键点：

- 不是简单按 task_type 直接返回模型，而是先映射到能力标签。
- 预算控制器和运行时状态共同参与硬约束。
- 最终选型通过多因子打分完成，不同任务类型的权重不同。
- `quality_score` 可以来自离线评测或线上反馈。

### 3.3 Task Analyzer：请求进入系统时如何判断任务类型

任务分类本身也可以使用多层策略，而不一定每次都用模型判断。比较推荐的顺序是：

1. **规则优先**：根据 API endpoint、工具链入口、调用方标识做确定性映射。  
2. **轻模型分类**：对自然语言自由输入做意图识别。  
3. **人工兜底标签**：允许调用方显式指定任务类型。  

例如：

```python
class TaskAnalyzer:
    def analyze(self, request) -> TaskContext:
        if request.endpoint == "/api/extract/invoice":
            return TaskContext(
                task_type=TaskType.EXTRACTION,
                estimated_input_tokens=request.estimated_tokens,
                requires_json_schema=True,
                risk_level="medium"
            )

        if request.endpoint == "/api/agent/plan":
            return TaskContext(
                task_type=TaskType.PLAN,
                estimated_input_tokens=request.estimated_tokens,
                requires_tool_calling=True,
                risk_level="high"
            )

        label = lightweight_classifier(request.user_prompt)
        return TaskContext(
            task_type=TaskType(label),
            estimated_input_tokens=request.estimated_tokens,
            requires_json_schema=request.response_format == "json",
            requires_tool_calling=request.enable_tools,
            risk_level=request.risk_level or "low"
        )
```

这个 Analyzer 的理念很重要：**能规则判断的不要额外调用模型**。否则你本来是为了省钱而做路由，结果每次请求先花一笔分类成本，反而得不偿失。

### 3.4 OpenClaw 调用链整合示例

下面给一个更接近实际项目的“路由 + 调用 + 记录 usage”流程：

```python
class OpenClawModelService:
    def __init__(self, router, provider_factory, guardrail, usage_sink):
        self.router = router
        self.provider_factory = provider_factory
        self.guardrail = guardrail
        self.usage_sink = usage_sink

    def generate(self, request):
        task_ctx = TaskAnalyzer().analyze(request)
        model = self.router.route(task_ctx)
        provider = self.provider_factory.create(model.provider)

        response = self.guardrail.execute_with_fallback(
            primary_model=model,
            task_ctx=task_ctx,
            invoke=lambda selected_model: provider.chat(
                model=selected_model.name,
                messages=request.messages,
                temperature=request.temperature,
                response_format=request.response_format,
                tools=request.tools,
            )
        )

        self.usage_sink.record({
            "request_id": request.request_id,
            "tenant_id": request.tenant_id,
            "task_type": task_ctx.task_type.value,
            "model": response.model,
            "provider": model.provider,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "latency_ms": response.latency_ms,
            "cost_usd": response.usage.cost_usd,
            "fallback_used": response.meta.get("fallback_used", False),
            "success": True,
        })
        return response
```

这段代码的核心价值在于把业务层与模型选择彻底解耦。上层业务只表达请求意图，至于最终用哪个模型、是否发生 fallback、成本是多少，都由策略层统一决定并上报。

### 3.5 一个典型的路由表

在体系初期，推荐保留一份显式路由基线表，便于运营与排查：

| 任务类型 | 默认模型层级 | 升级条件 | 降级条件 |
|---|---|---|---|
| intent_classification | 小模型 | 分类置信度低、风险高 | 预算告警 |
| structured_extraction | 中模型 | 多字段抽取失败、严格 schema | 高峰期退回小模型 + repair |
| general_chat | 中模型 | 用户为高级租户、上下文复杂 | 预算紧张时降到小模型 |
| knowledge_qa | 中长上下文模型 | 需要多文档综合推理 | 文档较短时降为中模型 |
| complex_reasoning | 大模型 | 默认 | 预算触发后仅保留关键请求 |
| code_generation | 大模型 | 默认 | 低风险场景降到中模型 |
| workflow_planning | 大模型 | 默认 | 系统限流时切回模板化流程 |

这张表不是最终策略，而是治理基线。实际运行中还要叠加预算、健康度和 SLA 指标动态调整。

---

## 四、成本监控与预算控制：把“省钱”变成可执行机制

### 4.1 成本治理的三个层次

成本优化不能只靠事后看账单，至少要做到三个层次：

1. **事前约束**：请求进入前判断预算是否允许。  
2. **事中控制**：调用过程中根据 token 增长、重试次数、fallback 行为动态止损。  
3. **事后分析**：按租户、任务、模型、链路阶段复盘成本结构。  

如果只做事后分析，团队每个月都能知道“花多了”，但没有任何手段避免下个月继续花多。

### 4.2 成本计算公式与示例

假设某模型计价如下：

- 输入：$0.50 / 1M tokens
- 输出：$1.50 / 1M tokens

一次调用输入 8,000 tokens、输出 1,200 tokens，则单次成本为：

```text
input_cost  = 8000 / 1,000,000 * 0.50 = $0.0040
output_cost = 1200 / 1,000,000 * 1.50 = $0.0018
total_cost  = $0.0058
```

若一天 50,000 次请求，平均每次触发 2.4 次模型调用，则日成本约为：

```text
50000 * 2.4 * 0.0058 = $696
```

月成本约：

```text
$696 * 30 = $20,880
```

如果其中 35% 的请求其实只需要小模型，而小模型单次成本仅为 $0.0016，那么优化空间为：

```text
节省单次 = 0.0058 - 0.0016 = $0.0042
可替换调用量 = 50000 * 2.4 * 35% = 42,000
单日节省 = 42,000 * 0.0042 = $176.4
单月节省 ≈ $5,292
```

这就是为什么模型路由往往是 Agent 系统里最直接、最立竿见影的降本手段。

### 4.3 在 OpenClaw 中实现统一成本计量

统一计量的前提是，无论调用哪个 provider，usage 字段都要标准化：

```python
from dataclasses import dataclass

@dataclass
class UsageRecord:
    request_id: str
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int = 0
    latency_ms: int = 0

def calculate_cost(usage: UsageRecord, profile: ModelProfile) -> float:
    billable_input = max(0, usage.input_tokens - usage.cached_input_tokens)
    input_cost = billable_input / 1_000_000 * profile.input_price_per_million
    output_cost = usage.output_tokens / 1_000_000 * profile.output_price_per_million
    return round(input_cost + output_cost, 8)
```

如果某些供应商支持 prompt cache、prefix cache 或者 KV cache 折扣，那么 `cached_input_tokens` 必须单独记录，否则账单和内部测算会对不上。

### 4.4 Budget Controller 设计

预算控制一般分成四个粒度：

- **全局预算**：总平台日/月预算
- **租户预算**：按客户或业务线配额
- **任务预算**：高成本任务单独设限
- **单请求预算**：防止一次请求异常爆 token

示例实现：

```python
class BudgetController:
    def __init__(self, finance_repo, thresholds):
        self.finance_repo = finance_repo
        self.thresholds = thresholds

    def is_blocked(self, model_name: str, tenant_tier: str) -> bool:
        spend_today = self.finance_repo.get_today_spend(model_name=model_name)
        daily_cap = self.thresholds.model_daily_cap.get(model_name)
        if daily_cap and spend_today >= daily_cap:
            return True

        if tenant_tier == "free" and model_name in self.thresholds.premium_models:
            return True
        return False

    def cost_fitness(self, model, ctx) -> float:
        estimated_cost = self.estimate_request_cost(model, ctx)
        if ctx.max_cost_usd and estimated_cost > ctx.max_cost_usd:
            return 0.0
        ratio = estimated_cost / max(self.thresholds.target_cost_by_task[ctx.task_type], 1e-6)
        return max(0.0, 1.0 - min(ratio, 1.0))

    def estimate_request_cost(self, model, ctx) -> float:
        expected_output = {
            "intent_classification": 80,
            "structured_extraction": 300,
            "general_chat": 600,
            "knowledge_qa": 900,
            "complex_reasoning": 1500,
            "code_generation": 1800,
            "workflow_planning": 1200,
        }[ctx.task_type.value]
        return (
            ctx.estimated_input_tokens / 1_000_000 * model.input_price_per_million
            + expected_output / 1_000_000 * model.output_price_per_million
        )
```

这段代码体现了一个关键实践：**路由阶段使用预估成本，结算阶段使用真实成本**。只有这样，预算才有“事前拦截”能力。

### 4.5 水位控制与动态限流

生产环境中建议设置多级预算水位：

- 50%：只告警，不动作
- 70%：禁用部分高价模型用于低价值请求
- 85%：复杂任务必须带显式优先级或高级租户标识
- 95%：仅保留核心链路，大部分请求降级到中小模型

伪代码：

```python
def apply_budget_watermark(spend_ratio, task_ctx):
    if spend_ratio < 0.5:
        return "normal"
    if spend_ratio < 0.7:
        return "alert"
    if spend_ratio < 0.85:
        if task_ctx.task_type in {TaskType.CHAT, TaskType.INTENT}:
            return "force_economy_model"
        return "normal"
    if spend_ratio < 0.95:
        if task_ctx.task_type in {TaskType.REASONING, TaskType.CODE, TaskType.PLAN}:
            return "require_priority_tag"
        return "force_economy_model"
    return "core_only"
```

这种策略的价值在于，不需要等财务复盘后人工干预，系统本身就能按预算水位自动收缩成本。

### 4.6 推荐监控指标

成本治理至少要看下面这些指标：

- `cost_usd_total{day,month}`
- `cost_usd_by_model`
- `cost_usd_by_task_type`
- `cost_usd_by_tenant`
- `avg_cost_per_request`
- `avg_tokens_in / avg_tokens_out`
- `fallback_cost_overhead`
- `retry_cost_overhead`
- `cached_token_ratio`
- `budget_burn_rate`
- `quality_per_dollar`

其中 `quality_per_dollar` 很关键。它不是标准账单字段，但却是策略优化的方向盘。一个模型便宜，不代表它“值”；一个模型贵，也不代表它“不划算”。最终要看单位成本换来的业务质量。

---

## 五、模型降级与 Fallback 策略：高可用不只是重试

### 5.1 为什么 fallback 不等于“失败后换一个模型再来一次”

很多系统的 fallback 实现很粗糙：主模型调用失败 -> 切到备用模型重试。这种方式只能解决部分供应商故障，对成本与质量的治理帮助有限。真正成熟的 fallback 应该包含多个层次：

1. **同类模型切换**：同能力、同档位模型之间切换，尽量不影响结果质量。  
2. **跨档位降级**：从大模型降到中模型，同时收缩任务目标或输出格式。  
3. **策略降级**：从 fully autonomous agent 降级到模板驱动或半自动流程。  
4. **功能降级**：只返回摘要、只做分类、不做复杂推理。  

### 5.2 设计 fallback 树，而不是单一备份模型

例如对 `workflow_planning` 任务，可以设计如下 fallback 树：

```text
Primary: LargeReasoningModel-A
   ├── on timeout/429 -> LargeReasoningModel-B
   ├── on provider 5xx -> MidReasoningModel-C + shorter prompt
   ├── on budget_high -> MidReasoningModel-C + template plan
   └── on repeated failure -> RuleBasedPlanner + human_review_flag
```

对于 `structured_extraction`：

```text
Primary: MidJsonModel-A
   ├── on invalid json -> same model repair pass
   ├── on timeout -> SmallExtractModel-B
   ├── on schema_fail twice -> regex/parser fallback
   └── on critical fields missing -> queue for async review
```

这说明 fallback 不是“模型名单”，而是“错误类型 + 业务容忍度 + 成本状态”共同决定的策略树。

### 5.3 Guardrail 执行器示例

```python
class GuardrailExecutor:
    def __init__(self, registry, runtime_state):
        self.registry = registry
        self.runtime_state = runtime_state

    def execute_with_fallback(self, primary_model, task_ctx, invoke):
        tried = []
        plan = self._build_fallback_plan(primary_model, task_ctx)
        last_error = None

        for candidate in plan:
            try:
                response = invoke(candidate)
                self._validate_response(response, task_ctx)
                response.meta["fallback_used"] = (candidate.name != primary_model.name)
                return response
            except Exception as e:
                tried.append(candidate.name)
                self.runtime_state.record_failure(candidate.name, str(e))
                last_error = e
                continue

        raise RuntimeError(
            f"All models failed for task={task_ctx.task_type}, tried={tried}, last_error={last_error}"
        )

    def _build_fallback_plan(self, primary_model, task_ctx):
        siblings = self.registry.same_capability_models(primary_model, task_ctx.task_type)
        cheaper = self.registry.cheaper_alternatives(primary_model, task_ctx.task_type)
        return [primary_model, *siblings, *cheaper]

    def _validate_response(self, response, task_ctx):
        if task_ctx.requires_json_schema:
            validate_json_schema(response.content)
        if task_ctx.task_type.value == "structured_extraction":
            ensure_required_fields(response.content)
```

真实生产中，还应根据错误类型区分：

- `429/RateLimit`：优先切到同档位异供应商
- `Timeout`：优先切低延迟模型，或缩短 prompt
- `InvalidJSON`：优先同模型 repair，而不是直接换模型
- `BudgetExceeded`：直接走经济型模型或功能降级
- `ContextTooLong`：走长上下文模型，或先做压缩摘要

### 5.4 Fallback 成本必须被单独统计

很多团队只看主调用成本，却忽略 fallback 造成的额外费用。事实上，fallback 是隐藏账单的重要来源。推荐单独统计：

```text
fallback_cost_overhead = (all_retry_and_fallback_cost - primary_success_path_cost)
```

如果某任务的 fallback 成本占比长期高于 15%，通常意味着以下问题之一：

- 路由模型选择不准确，首选模型不适合该任务
- 输出 schema 要求与模型能力不匹配
- 超时时间设置不合理
- prompt 过长导致时延与失败率升高
- 供应商健康状态未及时反映到路由层

### 5.5 降级设计要对业务可见

一个常被忽视的问题是，降级不应该完全黑盒。对业务方至少要有以下可见性：

- 本次是否发生模型降级
- 是否因为预算原因使用经济模式
- 输出置信度是否下降
- 是否建议异步复算或人工复核

尤其在高风险场景，系统宁愿明确说“当前为降级结果，请谨慎使用”，也不要伪装成与高质量路径同等可信的输出。

---

## 六、Token 用量优化：最容易落地、收益最高的工程手段

### 6.1 Token 优化为什么经常比换模型更有效

模型路由是“选更合适的模型”，Token 优化则是“让同一个模型少吃无效上下文”。在很多 Agent 系统中，真正的浪费并不是因为模型单价太贵，而是因为：

- 把完整聊天历史无脑全量拼接
- 检索结果一次塞入十几段长文档
- prompt 写得冗长重复
- 把工具返回的大块原始 JSON 直接喂回模型
- 每一轮都重复注入同样的系统提示

这类问题带来的 token 浪费常常是 20%~60%，而且对所有模型都生效。也就是说，Token 优化是最稳妥的系统性降本手段。

### 6.2 控制输入 Token 的七个实用技巧

#### 技巧一：分层上下文装配

不要把所有信息一次性交给模型，而是按优先级分层：

1. 核心系统提示
2. 当前用户问题
3. 必要的短期对话记忆
4. 检索到的 top-k 证据
5. 可选背景信息

在 budget 紧张或上下文接近上限时，优先裁剪第 4、5 层，而不是动系统规则。

#### 技巧二：长历史摘要化，而不是原样拼接

```python
def compress_history(messages, max_tokens=1200):
    if estimate_tokens(messages) <= max_tokens:
        return messages

    recent = messages[-6:]
    earlier = messages[:-6]
    summary = summarize_messages(earlier)
    return [
        {"role": "system", "content": f"历史对话摘要：{summary}"},
        *recent
    ]
```

这类摘要策略通常能把多轮会话的上下文从数千 token 压缩到几百 token，同时保留主要事实。

#### 技巧三：检索结果去重与片段级裁剪

RAG 系统里常见问题是：召回 8 段文档，其中 4 段高度重复，剩下 2 段与问题无关。建议在进入模型前做：

- 语义去重
- 相邻 chunk 合并
- 只保留命中 query 的句段
- 表格与代码块单独处理

#### 技巧四：工具结果结构化压缩

不要把数据库查询结果原始 JSON 直接喂给模型。例如原始结果 300 行记录，只需要：

- 汇总统计
- 关键异常项 top-n
- 与用户问题相关字段

#### 技巧五：系统提示模块化

许多团队把风格要求、业务规则、输出格式、错误处理、few-shot 示例全部拼成一个超长 system prompt。更合理的方式是按任务动态装配：

```python
def build_system_prompt(task_type, need_json=False, need_citation=False):
    base = "你是 OpenClaw 的智能执行助手，回答必须准确、简洁、可追踪。"
    task_rules = {
        "intent_classification": "输出最合适的意图标签，不要解释。",
        "structured_extraction": "仅输出结构化字段，缺失字段填 null。",
        "general_chat": "给出清晰、分层、可执行的回答。",
        "knowledge_qa": "优先依据提供证据回答，不足时明确说明。",
        "complex_reasoning": "先形成内部分析，再输出结论与依据。",
    }[task_type]
    extra = []
    if need_json:
        extra.append("输出必须符合给定 JSON Schema。")
    if need_citation:
        extra.append("引用结论时标注证据编号。")
    return "\n".join([base, task_rules, *extra])
```

#### 技巧六：把分类、过滤前置到小模型

例如一个客服 Agent 先判断“是否需要复杂推理”，如果 70% 的请求只是 FAQ 或简单查询，就不应直接走大模型。小模型先做预分流，本身也是 token 优化的一部分。

#### 技巧七：缓存稳定前缀

很多请求共享相同 system prompt、知识片段、流程规范。如果供应商支持 prompt caching，可以显著降低稳定前缀的计费开销。即便供应商不支持，也可以在应用层做 prompt segment cache，减少重复拼装与重复摘要。

### 6.3 输出 Token 也要管控

很多团队只盯输入 token，忽视输出 token 失控。尤其在代码生成、分析报告、长摘要场景，输出 token 往往更贵。建议：

- 设置 `max_output_tokens`
- 明确要求“先结论后细节”
- 对列表、表格、JSON 输出限定字段数
- 对复杂分析采用“分页生成”或“先纲要后展开”

示例：

```python
def output_control(task_type):
    return {
        "intent_classification": 32,
        "structured_extraction": 400,
        "general_chat": 700,
        "knowledge_qa": 900,
        "complex_reasoning": 1200,
        "code_generation": 1600,
        "workflow_planning": 900,
    }[task_type]
```

### 6.4 一个简单的 Token Budgeter

```python
class TokenBudgeter:
    def __init__(self, registry):
        self.registry = registry

    def fit(self, model_name, system_prompt, messages, retrieval_chunks, reserve_output=800):
        model = self.registry.get(model_name)
        budget = model.max_context_tokens - reserve_output

        final_chunks = []
        used = estimate_tokens(system_prompt) + estimate_tokens(messages)
        for chunk in retrieval_chunks:
            chunk_tokens = estimate_tokens(chunk)
            if used + chunk_tokens > budget:
                break
            final_chunks.append(chunk)
            used += chunk_tokens

        return {
            "system_prompt": system_prompt,
            "messages": messages,
            "retrieval_chunks": final_chunks,
            "estimated_total": used + reserve_output
        }
```

生产环境中，这个 Budgeter 应该与 Router 联动：如果上下文压缩后仍然放不下，就自动切到长上下文模型；如果长上下文模型太贵，则先做摘要再回答。

---

## 七、生产环境实战经验与数据：从策略设计走向稳定收益

这一部分给出一组接近真实项目治理逻辑的数据案例，用来说明多模型路由到底能带来什么收益，以及哪些坑最容易踩。

### 7.1 场景背景

假设我们运营的是一个企业内部 Agent 平台，主要支持以下能力：

- 工单分类与分派
- 知识库问答
- 报销/合同/工单字段抽取
- 自动生成周报与总结
- 开发支持场景中的代码解释与脚本生成

日均请求量约 82,000，峰值 QPS 在工作日上午达到 36。最初系统采用“一个旗舰模型跑所有任务”的方式，虽然效果稳定，但两个月后暴露出三个问题：

1. 月成本远超预算，尤其是知识问答和代码解释链路。  
2. 高峰期 P95 延迟接近 8 秒，用户感知明显下降。  
3. 某供应商限流时，主链路整体波动。  

于是引入 OpenClaw 策略层，实施按任务路由与成本治理。

### 7.2 改造前后的模型分工

改造前：

- 所有任务统一使用大模型 L

改造后：

- 小模型 S：意图识别、工单分类、轻量抽取、FAQ 预判
- 中模型 M：一般聊天、标准知识问答、结构化抽取
- 大模型 L：复杂推理、代码生成、规划、多文档综合分析
- 备用模型 B：与 L 能力接近，用于跨供应商 fallback

### 7.3 关键策略调整项

上线时并不是只做“按任务切模型”，而是同时做了以下几件事：

1. 把 Task Analyzer 前置，70% 以上请求不再直接进入大模型。  
2. 对知识问答增加 retrieval chunk 去重与压缩。  
3. 对多轮会话引入历史摘要机制。  
4. 对结构化抽取启用 JSON schema 校验与 repair pass。  
5. 建立按租户和任务的预算水位控制。  
6. 对供应商错误率做熔断，自动切备用模型。  

### 7.4 改造结果数据

下面是一组三周稳定运行后的观测结果：

#### 1）模型命中率分布

- 小模型 S：38%
- 中模型 M：44%
- 大模型 L：14%
- 备用模型 B：4%

说明只有 18% 左右请求真正需要高成本模型能力，而不是原先 100% 全走大模型。

#### 2）单请求平均成本变化

- 改造前：$0.0089 / request
- 改造后：$0.0047 / request
- 降幅：47.2%

#### 3）日均总成本变化

- 改造前：约 $730 / day
- 改造后：约 $386 / day
- 日节省：约 $344
- 月节省：约 $10,320

#### 4）延迟变化

- 改造前 P50：2.9s，P95：7.8s
- 改造后 P50：1.6s，P95：4.1s

因为大量轻任务不再排队等待大模型资源，整体尾延迟显著下降。

#### 5）质量指标变化

- 工单分类准确率：93.6% -> 93.1%
- 知识问答人工满意度：4.42 -> 4.39
- 结构化抽取字段完整率：95.0% -> 96.3%
- 代码解释可用率：91.2% -> 91.5%

可见，只要路由策略设计得当，成本大幅下降并不必然牺牲质量。有些链路甚至因为“模型更匹配任务”而质量上升。

### 7.5 质量-成本平衡的一个计算例子

我们曾对知识问答链路做过 AB 测试：

- 方案 A：全部使用大模型 L
- 方案 B：简单问题先由小模型判断复杂度；若检索证据充分，则中模型 M 回答；只有复杂多文档问题进入大模型 L

测试 10,000 个请求后的结果：

| 指标 | 方案 A | 方案 B |
|---|---:|---:|
| 平均成本/请求 | $0.0102 | $0.0056 |
| P95 延迟 | 6.9s | 4.0s |
| 引用证据准确率 | 89.4% | 88.8% |
| 人工满意度 | 4.46 | 4.40 |

如果以“每 1 美元能支撑的满意请求数”作为简单质量/成本指标：

```text
A: 1 / 0.0102 * 4.46 ≈ 437.25
B: 1 / 0.0056 * 4.40 ≈ 785.71
```

方案 B 在单位成本产出上明显更优，因此是更适合生产的方案。

### 7.6 实战中最常见的五个坑

#### 坑一：把路由策略写死在业务代码里

短期看最省事，长期会导致：

- 新模型上线改动面大
- A/B 测试困难
- 无法做统一预算治理
- fallback 策略散落在各处

正确做法是把策略收敛到统一 Router/Policy Engine。

#### 坑二：没有标准化 usage 与价格口径

如果不同 provider 返回的 usage 字段不一致，而内部又没有统一换算规则，就会出现“监控里成本比账单低很多”或“同样请求对不上钱”的问题。路由优化最终会失去可信度。

#### 坑三：只按任务类型路由，不看上下文长度

同样是知识问答，2,000 token 的 FAQ 与 80,000 token 的多文档审计，不可能用相同策略。上下文长度往往是成本与延迟的第一驱动因素。

#### 坑四：fallback 只统计成功率，不统计成本

如果首选模型常失败，备用模型又很贵，系统表面看“成功率很高”，实际上账单已经爆了。必须把 fallback overhead 独立出来。

#### 坑五：忽略运营层面的“预算告警到策略动作”闭环

很多平台有 Grafana 看板，却没有任何自动化动作。正确姿势是：预算超过阈值后，策略层自动降低高价模型曝光、缩短上下文、提升缓存使用率、限制低优先级任务。

### 7.7 一个推荐的上线顺序

如果你准备在 OpenClaw 里落地模型策略，不建议一次性做得过于复杂。更稳妥的路径是：

**阶段一：观测先行**  
先统一记录 usage、cost、latency、task_type、fallback、error_code。没有数据就没有优化。

**阶段二：静态路由**  
先做基于任务类型的确定性路由，建立基线收益。

**阶段三：预算控制**  
增加预算阈值、水位动作与租户配额。

**阶段四：动态评分与 fallback 树**  
把健康度、成功率、延迟、价格纳入实时打分。

**阶段五：自动调优**  
基于线上评测、反馈分数、成本趋势自动修正路由权重。

这个顺序非常重要。因为在缺乏观测与基线时，上来就做“智能动态路由”，最后很容易变成一个没人敢动、也没人敢信的黑箱系统。

---

## 八、一个更完整的 OpenClaw 策略配置示例

为了便于落地，下面给一个偏配置化的示例。实际生产可以把它放在 YAML 或数据库中，由策略引擎热加载。

```yaml
models:
  - name: small-classifier-v1
    provider: provider_a
    max_context_tokens: 16000
    input_price_per_million: 0.12
    output_price_per_million: 0.40
    avg_latency_ms: 450
    supports_json_schema: true
    supports_tool_calling: false
    supports_streaming: true
    capability_tags: [classification, extraction, low_latency, cheap, json_strict]

  - name: mid-general-v2
    provider: provider_b
    max_context_tokens: 64000
    input_price_per_million: 0.80
    output_price_per_million: 2.40
    avg_latency_ms: 1200
    supports_json_schema: true
    supports_tool_calling: true
    supports_streaming: true
    capability_tags: [chat, extraction, long_context, json_strict, high_reliability]

  - name: large-reasoner-v3
    provider: provider_c
    max_context_tokens: 128000
    input_price_per_million: 3.00
    output_price_per_million: 12.00
    avg_latency_ms: 2600
    supports_json_schema: true
    supports_tool_calling: true
    supports_streaming: true
    capability_tags: [reasoning, code, long_context, tool_orchestration, high_reliability]

routing:
  task_rules:
    intent_classification:
      required_tags: [classification, low_latency]
      target_cost_usd: 0.0004
      max_output_tokens: 64
    structured_extraction:
      required_tags: [extraction, json_strict]
      target_cost_usd: 0.0015
      max_output_tokens: 400
    general_chat:
      required_tags: [chat]
      target_cost_usd: 0.0030
      max_output_tokens: 700
    knowledge_qa:
      required_tags: [chat, long_context]
      target_cost_usd: 0.0042
      max_output_tokens: 900
    complex_reasoning:
      required_tags: [reasoning]
      target_cost_usd: 0.0120
      max_output_tokens: 1400
    code_generation:
      required_tags: [code, reasoning]
      target_cost_usd: 0.0150
      max_output_tokens: 1800

budget:
  global_daily_cap_usd: 500
  watermark_actions:
    - ratio: 0.70
      action: disable_large_for_low_priority
    - ratio: 0.85
      action: require_priority_for_reasoning
    - ratio: 0.95
      action: core_path_only

fallback:
  complex_reasoning:
    - same_tier_alternative
    - cheaper_reasoning_with_short_prompt
    - template_mode
  structured_extraction:
    - same_model_repair
    - smaller_json_model
    - regex_parser
```

这个配置化思路有两个好处：

1. 策略可以热更新，不必每次改代码。  
2. 运营、平台、算法三方可以围绕同一份配置协作。  

---

## 九、总结：多模型路由的本质，是把模型从“接口”升级为“资源系统”

当团队开始建设 Agent 平台时，模型层常常被当作一个简单依赖：有请求就调用，拿到结果就返回。但一旦进入生产规模，这种思路很快就会失效。你会发现真正决定系统能否跑得久、跑得稳、跑得起的，不是某个模型榜单分数，而是背后的策略能力：

- 是否知道什么任务该用什么模型
- 是否能在预算内分配高价能力
- 是否能在失败时优雅降级
- 是否能持续观测成本、质量、延迟与健康度
- 是否能把这些指标重新反馈给路由引擎

OpenClaw 的模型策略实践，本质上是在做一件事：**把模型调用从“写死的 API 调用”升级为“可观测、可路由、可优化、可治理的资源编排”**。

如果用一句话概括本文的核心结论，那就是：

> 在生产环境中，多模型路由不是锦上添花，而是 Agent 系统从可用走向可运营的必要条件。

具体落地时，可以遵循下面这个最小闭环：

1. 先统一采集 usage、cost、latency、error、fallback 数据。  
2. 按任务类型做第一版静态路由。  
3. 加入预算控制和水位动作。  
4. 为关键链路设计分层 fallback。  
5. 持续压缩 token，用上下文预算约束调用。  
6. 用线上质量数据与成本数据共同迭代路由权重。  

当这个闭环建立起来之后，你会发现模型策略的收益不仅体现在账单下降，也体现在系统延迟更稳、故障更可控、业务解释性更强、平台演进速度更快。对于 OpenClaw 这样的 Agent 框架来说，这才是真正接近生产级能力的分水岭。

---

## 十、附录：一个简化的端到端调用流程参考

最后给出一段简化的端到端伪代码，串起本文提到的关键组件：

```python
class OpenClawInferenceFacade:
    def __init__(self, analyzer, router, budgeter, executor, meter):
        self.analyzer = analyzer
        self.router = router
        self.budgeter = budgeter
        self.executor = executor
        self.meter = meter

    def handle(self, request):
        task_ctx = self.analyzer.analyze(request)
        selected_model = self.router.route(task_ctx)

        packed = self.budgeter.fit(
            model_name=selected_model.name,
            system_prompt=build_system_prompt(
                task_type=task_ctx.task_type.value,
                need_json=task_ctx.requires_json_schema,
                need_citation=(task_ctx.task_type.value == "knowledge_qa")
            ),
            messages=request.messages,
            retrieval_chunks=request.retrieval_chunks,
            reserve_output=output_control(task_ctx.task_type.value)
        )

        response = self.executor.execute_with_fallback(
            primary_model=selected_model,
            task_ctx=task_ctx,
            invoke=lambda model: call_model(
                model=model.name,
                system_prompt=packed["system_prompt"],
                messages=packed["messages"],
                retrieval_chunks=packed["retrieval_chunks"],
                max_output_tokens=output_control(task_ctx.task_type.value),
                response_format="json" if task_ctx.requires_json_schema else "text"
            )
        )

        self.meter.record_response(
            request=request,
            task_ctx=task_ctx,
            selected_model=selected_model,
            final_model=response.model,
            usage=response.usage,
            latency_ms=response.latency_ms,
            fallback_used=response.meta.get("fallback_used", False)
        )
        return response
```

在这条链路里，Task Analyzer 负责理解请求，Router 负责选模型，Budgeter 负责控制上下文，Executor 负责 fallback 与 guardrail，Meter 负责成本与指标记录。它们组合起来，才构成一个真正可运营的多模型系统。

如果你的 OpenClaw 项目正从“能跑”走向“要长期稳定运营”，那么建议优先投资的不是更多提示词技巧，而是这一整套模型策略基础设施。因为只有把模型当成资源去治理，AI Agent 才能真正成为生产力系统，而不是昂贵的实验玩具。

## 相关阅读

- [OpenClaw-vs-Hermes-Agent-开源AI-Agent框架选型对比](/categories/架构/OpenClaw-vs-Hermes-Agent-开源AI-Agent框架选型对比/)
- [OpenClaw-安全实战-权限控制-隐私保护-群聊行为边界](/categories/架构/OpenClaw-安全实战-权限控制-隐私保护-群聊行为边界/)
- [OpenClaw-心跳机制实战-HEARTBEAT-主动检查与定时任务](/categories/架构/OpenClaw-心跳机制实战-HEARTBEAT-主动检查与定时任务/)
