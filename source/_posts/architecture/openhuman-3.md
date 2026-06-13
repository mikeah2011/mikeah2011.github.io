---
title: OpenHuman 模型路由实战：智能选择推理/快速/视觉模型的策略
description: 本文系统拆解 OpenHuman 模型路由在 AI Agent 场景中的真实落地方法，围绕推理模型、快速模型、视觉模型的智能选择、多模型策略、成本优化、延迟控制与 Fallback 机制展开，附带路由规则、代码示例、评估指标与生产排障经验，帮助你把多模型协同真正做成稳定、可观测、可扩展的工程能力。
date: 2026-06-02 02:30:00
tags: [OpenHuman, AI Agent, 模型路由, 多模型策略, 成本优化]
keywords: [OpenHuman, 模型路由实战, 智能选择推理, 快速, 视觉模型的策略, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


在很多团队刚接触 AI Agent 或多模型系统时，最容易出现的一种误区，是把“模型选择”理解为一次性的技术选型：先拍板一个主模型，然后希望它既能做复杂推理、又能高频低延迟响应，还能处理图片、控制成本、稳定上线。这个想法在 Demo 阶段看起来没问题，但一旦进入真实业务，很快就会暴露出矛盾：复杂任务需要更强推理模型，简单问答更适合低成本快速模型，视觉类请求又要求多模态能力。如果所有请求都打到同一个模型，系统不是贵，就是慢，或者两者兼而有之。

这正是模型路由（Model Routing）存在的核心价值：**针对任务特征、上下文状态、预算约束与服务等级目标，动态决定“本次请求应该交给哪个模型处理”**。在 OpenHuman 这样的 Agent 框架中，模型路由不是一个边角优化项，而是支撑稳定性、成本、延迟、质量四个维度平衡的核心机制。

本文不讨论“哪个模型最好”这种静态问题，而是聚焦一个更工程化的问题：**如何在 OpenHuman 中设计一套真正可落地的模型路由策略，让系统能在推理模型、快速模型、视觉模型之间做出智能选择**。文章会覆盖架构设计、任务分类、路由规则、Fallback、预算控制、A/B 评估、监控体系，并给出可直接迁移到项目中的配置与代码示例。

## 一、为什么模型路由是 AI Agent 落地的必选项

### 1. 单模型策略在生产环境中的三类失败

很多团队在 PoC 阶段用一个“最强模型”跑通了功能，于是自然会继续沿用到生产。但只要流量增长、任务多样化、用户预期提高，就会遇到以下三类问题。

第一类是**成本失控**。例如，用户只是问一句“把下面这段话润色成更口语化的中文”，这种任务其实不需要高阶深度推理；如果仍然调用昂贵的推理模型，单位请求成本会远高于业务价值。

第二类是**延迟过高**。在客服、Copilot、站内助手等场景中，大量请求是短文本改写、摘要、标签分类、模板生成，用户对响应速度的敏感度远高于“绝对最优答案”。如果这些请求都排队等待大模型深度思考，交互体验会迅速下降。

第三类是**能力错配**。当用户上传截图、拍照、表格照片、报错弹窗时，纯文本模型即便推理再强也看不见图像内容；而视觉模型在纯文本任务上又未必具备最佳性价比。此时不是模型能力强弱的问题，而是**模态不匹配**。

换句话说，生产环境不是在问“最强模型是谁”，而是在问“当前这个请求最适合谁”。

### 2. 任务差异天然要求多模型协同

一个真实的 OpenHuman 应用，通常同时包含如下任务：

- FAQ / RAG 问答
- 长文总结与结构化提炼
- 工单分类与优先级判断
- 代码解释、重构建议、报错定位
- 复杂规划、多步决策、工具调用前推理
- OCR 后的图文理解
- 页面截图、UI 问题分析
- 低延迟意图识别与对话分流

这些任务对模型的要求并不相同：

- **复杂规划与严谨分析** 更依赖推理模型
- **意图识别、改写、摘要、普通问答** 更适合快速模型
- **图片、截图、表格照片、视觉检查** 必须使用视觉模型

因此，模型路由的本质不是炫技，而是把不同模型的优势映射到不同任务类型上，形成一套“能力分层 + 成本分级 + 延迟分桶”的执行体系。

### 3. OpenHuman 场景下的路由价值

在 OpenHuman 的 Agent 编排体系里，一个请求往往不是单轮 LLM 调用，而是包含如下阶段：

1. 输入接入与上下文整理
2. 意图识别
3. 工具选择或计划生成
4. 检索增强（RAG）
5. 主回答生成
6. 输出格式化与安全检查

如果每个阶段都用同一个模型，架构虽然简单，但明显浪费。更合理的方式是：

- 用快速模型做第一轮分类与轻量提取
- 遇到复杂任务时升级到推理模型
- 检测到图片输入时转视觉模型
- 在输出整理阶段回落到更便宜模型

这种分层调用方式，能让 OpenHuman 在保证核心质量的同时显著降低总体成本。

## 二、模型路由的核心设计目标

设计模型路由前，先明确目标。否则系统会陷入“规则越写越多，但没人知道为什么这样写”的状态。

一个可用的模型路由体系，至少应满足以下五个目标：

### 1. 正确匹配任务能力

路由第一原则不是省钱，而是**别把任务交给不合适的模型**。例如：

- 含图片输入的请求，必须优先进入视觉能力链路
- 高风险、高复杂度分析任务，不能被误分到廉价快速模型
- 需要长链条推理的规划问题，必须允许升级到 reasoning 类模型

### 2. 控制整体成本

好的路由系统并不是让所有请求都跑最强模型，而是让“高成本模型只处理真正值得它处理的请求”。

### 3. 满足延迟目标

不同业务有不同 SLA。例如：

- 首页助手首包响应目标：1.5 秒内
- 内部分析 Copilot：可接受 8~15 秒
- 批处理离线总结：甚至允许分钟级

模型路由必须把延迟作为一等公民，而不是事后再调优。

### 4. 具备容错与可回退能力

生产环境中 provider 限流、模型超时、上下游抖动都是常态。没有 fallback 的路由，不是工程系统，只是实验脚本。

### 5. 可观测、可评估、可迭代

如果你无法回答“为什么这个请求被路由到某模型”“该策略到底省了多少钱”“升级后的质量是否真的提升”，那就说明路由仍然不可运营。

## 三、OpenHuman 中可落地的 Router / Dispatcher / Selector 模式

在工程实现上，我建议把模型路由拆成三层：**Router、Selector、Dispatcher**。这比把所有逻辑塞进一个 if/else 函数更利于维护。

### 1. Router：理解任务，决定路由方向

Router 的职责是根据输入信息做**任务级判断**。它并不一定直接绑定某个具体模型，而是先回答：

- 这是文本任务还是视觉任务？
- 是轻量任务还是高复杂度任务？
- 对延迟是否敏感？
- 是否有预算限制？
- 是否需要工具调用前的规划推理？

Router 更像策略层。

一个简化的输入特征可以包括：

```json
{
  "has_image": true,
  "input_tokens": 1840,
  "conversation_turns": 7,
  "task_type": "bug_analysis",
  "latency_sla_ms": 6000,
  "budget_tier": "standard",
  "requires_structured_output": true,
  "risk_level": "medium"
}
```

Router 的输出可以是一个抽象决策：

```json
{
  "route": "vision_reasoning",
  "reason": [
    "image_attached",
    "bug_analysis_task",
    "structured_output_required"
  ],
  "quality_tier": "high"
}
```

### 2. Selector：把抽象路由映射为具体模型

Selector 的职责是把 Router 输出的抽象能力需求，映射到具体 provider/model。例如：

- `fast_text` → `openai:gpt-4.1-mini`
- `deep_reasoning` → `anthropic:claude-opus-4.1`
- `vision_standard` → `openai:gpt-4.1`
- `local_fallback` → `ollama:qwen3:8b`

Selector 需要考虑的不只是“能力”，还包括：

- provider 当前可用性
- 成本优先级
- 某模型是否被限流
- 当前租户/环境的配置差异
- 是否允许使用本地模型兜底

### 3. Dispatcher：负责真实调用与执行策略

Dispatcher 负责：

- 组装 provider 请求参数
- 附加超时、重试、熔断设置
- 记录 trace 与 metrics
- 在失败时触发 fallback
- 将响应标准化给上层使用

因此，Router 决定方向，Selector 决定车型，Dispatcher 负责真正发车。

### 4. 三层分离带来的收益

这种拆分有几个明显好处：

1. **规则更可维护**：任务判断与模型映射分离，不会互相污染。
2. **多 provider 更容易扩展**：新增 Anthropic 或 Ollama 时，不需要重写任务分类逻辑。
3. **更利于测试**：Router、Selector、Dispatcher 可以分别做单测和回放验证。
4. **更容易做灰度**：可以只替换 Selector 中某个具体模型，而不影响上层策略。

## 四、任务分类：模型路由的第一步不是选模型，而是识别任务

很多系统路由效果差，不是模型太弱，而是任务分类太粗。常见错误是只按“用户问题长度”来判断复杂度，这非常不可靠。

更稳妥的方式是建立多维任务特征。

### 1. 基础分类维度

建议至少包含以下维度：

#### 任务模态

- text
- image
- text+image
- document+image

#### 任务意图

- faq
- summarize
- rewrite
- classify
- extract
- planning
- coding
- troubleshooting
- visual_inspection

#### 复杂度等级

- low：简单改写、标签分类、简短问答
- medium：多段摘要、普通分析、结构化抽取
- high：复杂规划、多约束推理、根因分析、代码架构诊断

#### 风险等级

- low：营销文案、普通信息问答
- medium：业务配置建议、流程解释
- high：金融、医疗、合规、自动执行类建议

#### 输出要求

- 自由文本
- JSON 结构化输出
- 工具参数生成
- 长文报告

### 2. 路由分类不要只靠规则，也不要全靠模型

纯规则系统的问题是容易僵化；纯 LLM 分类的问题是额外成本高且不稳定。实践中更推荐混合策略：

- **第一层规则**：基于附件、长度、关键词、渠道、业务上下文做快速粗分类
- **第二层轻量模型**：对复杂/模糊案例做意图补充判断
- **第三层运行时反馈**：若回答质量不足，再升级模型重试

这种“规则预筛 + 轻模型判断 + 失败升级”的结构，往往比一步到位调用大模型更稳。

### 3. 一个典型任务分类器设计

下面给出一个 Python 风格的示例，实现一个简单但可扩展的任务分类器：

```python
from dataclasses import dataclass
from typing import Literal

TaskType = Literal[
    "faq", "rewrite", "summarize", "planning",
    "coding", "troubleshooting", "visual_inspection"
]

Complexity = Literal["low", "medium", "high"]

@dataclass
class RequestFeatures:
    has_image: bool
    input_chars: int
    conversation_turns: int
    user_tier: str
    requested_output: str
    text: str

@dataclass
class RouteIntent:
    task_type: TaskType
    complexity: Complexity
    needs_vision: bool
    latency_sensitive: bool


def classify_request(f: RequestFeatures) -> RouteIntent:
    text = f.text.lower()

    if f.has_image:
        if "报错" in f.text or "截图" in f.text or "界面" in f.text:
            return RouteIntent("visual_inspection", "medium", True, False)
        return RouteIntent("visual_inspection", "low", True, False)

    if any(k in text for k in ["总结", "摘要", "提炼"]):
        complexity = "medium" if f.input_chars > 3000 else "low"
        return RouteIntent("summarize", complexity, False, True)

    if any(k in text for k in ["规划", "方案", "权衡", "架构", "设计"]):
        return RouteIntent("planning", "high", False, False)

    if any(k in text for k in ["报错", "异常", "bug", "stack trace"]):
        return RouteIntent("troubleshooting", "high", False, False)

    if any(k in text for k in ["润色", "改写", "压缩", "翻译"]):
        return RouteIntent("rewrite", "low", False, True)

    return RouteIntent("faq", "low", False, True)
```

这个分类器不复杂，但已经体现一个关键思想：**先判断任务，再判断模型**。

## 五、推理模型、快速模型、视觉模型应该如何分工

### 1. 推理模型：用于高复杂度、高不确定性任务

推理模型适合处理以下任务：

- 多约束架构设计
- 复杂代码缺陷定位
- 根因分析与排障
- 多步计划生成
- 工具调用前的策略推理
- 需要自检与一致性约束的回答

它的优势通常在于：

- 更强的链式推理能力
- 对模糊任务更稳的规划能力
- 在复杂问题上更低的“看似合理但错误”概率

但代价也明显：

- 更高延迟
- 更高 Token 成本
- 有时输出更长，进一步增加后续费用

所以推理模型不应该成为默认入口，而应该成为**升级路径**。

#### 适合推理模型的请求例子

- “请比较单租户和多租户的权限模型，给出迁移方案与风险清单。”
- “根据这段日志和系统架构描述，推测最可能的故障根因并给出排查优先级。”
- “为一个多 provider 的 Agent 平台设计模型路由与限流架构。”

### 2. 快速模型：承担大部分高频标准请求

快速模型适合：

- FAQ 问答
- 轻量摘要
- 文案改写
- RAG 最终组织答案
- 标签分类
- JSON 抽取
- 简单代码解释
- 首轮意图判断

它的优势是：

- 响应快
- 成本低
- 并发承载能力强
- 很适合做“流量基础盘”

实际生产中，**70%~90% 的请求都应该尽量被快速模型吸收**，只有在确实需要时才升级到更贵模型。

#### 适合快速模型的请求例子

- “把这段公告改得更口语一点。”
- “根据知识库内容回答员工假期规则。”
- “提取下面文本中的订单号、客户名、金额，输出 JSON。”

### 3. 视觉模型：不是“看图版大模型”，而是独立路由通道

很多团队会把视觉模型当成文本模型的附加选项，实际上更好的做法是把它当成独立路由通道。

视觉模型适合：

- 页面截图分析
- UI 缺陷反馈处理
- 报错弹窗理解
- 流程图/表格照片解析
- OCR 后语义校验
- 图片中的结构化信息提取

视觉任务的难点不只是识别图像，还包括：

- 图片质量不稳定
- OCR 结果可能丢字或错字
- 图文混合理解复杂
- 上传图片会显著增加调用成本与延迟

因此视觉模型应遵循两个原则：

1. **只有检测到真实视觉需求时才启用**
2. **能先做图像预处理/OCR 的场景，不要直接把所有图片都丢给最强视觉模型**

### 4. 一个实用的模型能力分层

可以把模型能力抽象成如下层级：

| 能力层 | 典型用途 | 默认优先级 |
|---|---|---|
| fast_text | FAQ、改写、摘要、抽取 | 最高 |
| reasoning_text | 复杂推理、规划、排障 | 条件升级 |
| vision_text | 看图理解、截图分析 | 按需触发 |
| local_fallback | 非关键请求兜底 | 最后兜底 |

这样做的好处是：业务策略不直接依赖某个厂商模型名，而是依赖“能力标签”。后续替换具体模型时，只需改映射，不必改策略。

## 六、模型路由策略：如何真正做到“智能选择”

### 1. 规则路由：适合第一阶段上线

如果你的系统刚落地，不要一开始就追求机器学习式路由。先把高收益的显式规则建立起来。

例如：

```python
def choose_capability(intent: RouteIntent) -> str:
    if intent.needs_vision:
        return "vision_text"

    if intent.task_type in ["planning", "troubleshooting", "coding"] and intent.complexity == "high":
        return "reasoning_text"

    if intent.latency_sensitive and intent.complexity in ["low", "medium"]:
        return "fast_text"

    if intent.complexity == "high":
        return "reasoning_text"

    return "fast_text"
```

这个策略看起来朴素，但对多数业务已经足够有效。

### 2. 分层路由：先快后深

在很多业务里，最有效的不是一开始就用强模型，而是采用**先快后深**的两段式流程：

1. 用快速模型给出首轮回答或分类
2. 如果置信度不足、格式不合格、用户继续追问，再升级到推理模型

这种模式非常适合：

- 客服问答
- 工单分流
- 文档助手
- 内部知识库问答

举个例子：

- 第一轮：快速模型根据 RAG 文档回答问题
- 若检索召回分数低、答案包含“不确定”、或命中敏感主题
- 第二轮：升级到推理模型重新整合证据并给出更谨慎回答

### 3. 基于预算的动态路由

真正成熟的路由系统，不能只看任务，还要看预算。

例如，一个企业产品可能有三档用户：

- Free：优先快速模型，严格限制高成本升级
- Pro：允许中等比例使用推理模型
- Enterprise：关键任务可优先高质量模型

可以设计如下预算门控：

```python
@dataclass
class BudgetPolicy:
    monthly_reasoning_quota: int
    allow_vision: bool
    max_input_tokens: int


def enforce_budget(route: str, budget: BudgetPolicy, usage: dict) -> str:
    if route == "reasoning_text" and usage["reasoning_calls"] >= budget.monthly_reasoning_quota:
        return "fast_text"

    if route == "vision_text" and not budget.allow_vision:
        return "fast_text"

    return route
```

这种设计能把“技术策略”变成“产品能力分层”的一部分。

### 4. 基于置信度的升级路由

另一个实用思路是让快速模型先做，失败时自动升级。常见升级触发条件包括：

- 输出 JSON 解析失败
- 回答包含明显不确定措辞
- 检索文档覆盖度低
- 工具调用参数不完整
- 用户追问“你确定吗”“请更详细分析”
- 任务被标记为高风险领域

示例：

```python
def should_escalate(resp_text: str, retrieval_score: float, json_valid: bool) -> bool:
    uncertainty_signals = ["可能", "大概", "不确定", "建议进一步确认"]
    if not json_valid:
        return True
    if retrieval_score < 0.65:
        return True
    if any(s in resp_text for s in uncertainty_signals):
        return True
    return False
```

这里的关键不是追求完美置信度估计，而是定义一组**足够实用的失败信号**。

## 七、成本优化与 Token 预算管理：别只看单次价格，要看全链路成本

模型路由如果只比较“每百万 Token 单价”，很容易做出错误决策。因为真实成本来自全链路。

### 1. 全链路成本包含哪些部分

一次 Agent 请求的成本通常包括：

- 输入 Token
- 输出 Token
- 系统提示词长度
- 工具调用前后的补充上下文
- RAG 检索片段拼接
- 图片输入成本
- 重试与 fallback 的额外调用

很多系统的成本失控，不是因为主模型太贵，而是因为上下文膨胀严重。

### 2. 建立 Token 预算而不是事后统计

更好的做法是在请求进入时就建立预算，例如：

```json
{
  "total_budget_tokens": 24000,
  "classification_budget": 800,
  "retrieval_context_budget": 6000,
  "main_generation_budget": 12000,
  "fallback_reserve": 5200
}
```

这样每个阶段都知道自己最多能花多少，而不是等超了才发现。

### 3. 实战中的几个有效控费手段

#### 缩短系统提示词

大量团队在系统 prompt 中堆了几十条规则，导致每个请求都重复付费。更好的方式是：

- 把稳定规则写进代码逻辑而不是 prompt
- 将大段指令拆成按场景注入
- 对低风险任务使用更短模板

#### 控制 RAG 上下文拼接长度

不是召回越多越好。很多情况下：

- Top 3 的高质量片段优于 Top 10 的噪声拼接
- 对快速模型应使用更短上下文
- 只有推理模型才值得喂更长证据链

#### 输出长度分层

不同任务设定不同 `max_output_tokens`：

- 分类任务：200
- 改写任务：600
- FAQ：800
- 深度分析：3000+

#### 把便宜模型放在“守门”位置

例如：

- 用快速模型做第一轮任务分类
- 用快速模型做安全检查或格式修复
- 用本地小模型做低价值离线批处理

### 4. 预算管理不是一条规则，而是一个反馈回路

成熟系统会记录：

- 每类任务平均 Token 消耗
- 每种路由的成本中位数/P95
- 升级率与重试率
- 哪些 prompt 模板最耗 Token

只有这些指标形成闭环，预算优化才不会停留在口号层面。

## 八、延迟与质量的权衡：什么时候该快，什么时候该稳

模型路由最容易引发争论的地方，就是“到底优先快，还是优先准”。答案不是二选一，而是按场景分层。

### 1. 以用户体验为中心定义延迟目标

建议按场景设定目标：

| 场景 | 目标 | 推荐策略 |
|---|---|---|
| 首屏对话助手 | 首包快 | 默认快速模型，复杂再升级 |
| 内部知识问答 | 中等延迟 | 快速模型 + 检索增强 |
| 架构分析/排障 | 质量优先 | 直接推理模型 |
| 图片问题诊断 | 能力优先 | 视觉模型 + 必要时推理增强 |
| 离线批处理 | 成本优先 | 本地或低价模型 |

### 2. 让“延迟敏感”成为路由特征之一

不要把延迟目标写死在代码里。更好的方式是让请求自身携带 SLA：

```python
@dataclass
class RuntimeConstraints:
    latency_sla_ms: int
    quality_tier: str
    budget_tier: str


def route_by_constraints(intent: RouteIntent, c: RuntimeConstraints) -> str:
    if intent.needs_vision:
        return "vision_text"

    if c.latency_sla_ms <= 2000 and intent.complexity != "high":
        return "fast_text"

    if c.quality_tier == "premium" or intent.complexity == "high":
        return "reasoning_text"

    return "fast_text"
```

### 3. 一个典型权衡案例

假设用户上传一张控制台报错截图并问：“为什么发布失败？”

这里有两个选择：

- 直接用视觉模型读图并回答，速度快，但分析可能较浅
- 先视觉提取，再交推理模型做根因分析，速度慢，但质量更高

如何取舍？

- 如果这是在线客服入口，优先第一种，并提供“需要更深入分析吗”的二次升级按钮
- 如果这是内部 DevOps 平台，优先第二种，因为一次准确排障比几秒延迟更重要

这说明延迟与质量不是固定矛盾，而是业务场景下的动态平衡。

## 九、Fallback 与降级机制：没有兜底的路由系统不适合生产

无论你接的是 OpenAI、Anthropic，还是自建 Ollama，只要进入生产，失败就一定会发生。路由系统必须把失败视为常态。

### 1. 常见失败类型

- provider API 超时
- 429 限流
- 模型临时不可用
- 视觉上传失败
- 输出格式不合法
- 单次调用成本超预算
- 长上下文触发截断

### 2. Fallback 的层级设计

建议至少定义三层回退：

#### 第一层：同能力模型替换

例如：

- `openai:gpt-4.1-mini` → `anthropic:claude-sonnet-4`
- `openai:gpt-4.1` 视觉 → 同 provider 另一个视觉模型

这类 fallback 对业务影响最小。

#### 第二层：能力降级但保证可用

例如：

- 推理模型失败 → 快速模型 + 明确提示“以下为快速分析结果”
- 视觉模型失败 → OCR 文本提取 + 文本模型回答

#### 第三层：本地兜底

在非关键任务中，可回退到本地 Ollama 模型，如：

- 离线总结
- 基础分类
- 非严格质量要求的内部工具

### 3. 设计 fallback 时的两个原则

#### 保持用户可感知的一致性

如果从推理模型降级到快速模型，最好在系统内部保留原因，并在必要时给前端或日志埋点，而不是让“质量突然下降”变成不可解释的问题。

#### 避免无限重试

fallback 是切换路径，不是重复撞墙。必须设置：

- 最大重试次数
- provider 熔断窗口
- 同类错误短时间跳过该 provider

### 4. 一个简化的 fallback 流程示例

```python
FALLBACK_CHAIN = {
    "reasoning_text": [
        "anthropic:claude-opus-4.1",
        "openai:gpt-4.1",
        "openai:gpt-4.1-mini",
        "ollama:qwen3:8b"
    ],
    "vision_text": [
        "openai:gpt-4.1",
        "anthropic:claude-sonnet-4",
        "ocr+openai:gpt-4.1-mini"
    ],
    "fast_text": [
        "openai:gpt-4.1-mini",
        "anthropic:claude-sonnet-4",
        "ollama:qwen3:8b"
    ]
}
```

这种链式回退比“写死一个备用模型”更灵活，也更适合真实生产。

## 十、A/B 测试与模型评估：没有评估，路由优化就是凭感觉

很多团队做模型路由时，最常见的问题是：觉得某个模型“看起来更好”，于是上线替换。但在生产里，主观印象远远不够。

### 1. 模型路由评估要看哪些指标

至少要覆盖四类指标：

#### 质量指标

- 正确率 / 命中率
- 结构化输出有效率
- 用户追问率
- 人工复审通过率
- 任务完成率

#### 成本指标

- 单请求平均成本
- 不同任务类别的成本分布
- 升级率 / fallback 率
- 输入输出 Token 中位数与 P95

#### 延迟指标

- 首 token 时间（TTFT）
- 总响应时间
- P50 / P95 / P99
- 不同 provider 的稳定性

#### 稳定性指标

- 错误率
- 超时率
- 限流率
- JSON 格式失败率

### 2. A/B 测试不只比模型，也要比路由规则

你可以比较：

- 规则 A：高复杂度任务直接上推理模型
- 规则 B：先快速模型，再按失败信号升级

也可以比较：

- Selector 方案 A：优先 OpenAI
- Selector 方案 B：优先 Anthropic

甚至可以比较：

- 是否对视觉任务先做 OCR 压缩
- 是否限制 RAG context 在 4k tokens 内

### 3. 离线评估 + 在线评估的组合

#### 离线评估

建立一批典型任务集：

- 复杂排障样本
- FAQ 样本
- 截图分析样本
- 结构化抽取样本

对不同模型和路由策略回放，比较质量、成本、延迟。

#### 在线评估

在生产流量中做小流量灰度，观察：

- 用户满意度
- 追问率
- 客服转人工率
- 请求成本变化

两者结合，才能避免“离线表现很好，线上却不稳定”的问题。

### 4. 建议建立路由决策日志

每次请求至少记录：

```json
{
  "request_id": "req_123",
  "task_type": "troubleshooting",
  "complexity": "high",
  "selected_capability": "reasoning_text",
  "selected_model": "anthropic:claude-opus-4.1",
  "fallback_count": 1,
  "latency_ms": 8420,
  "input_tokens": 6210,
  "output_tokens": 1450,
  "cost_usd": 0.084,
  "quality_signal": {
    "json_valid": true,
    "user_followup": false
  }
}
```

这类日志是后续优化的基础资产。

## 十一、OpenAI / Anthropic / Ollama 多 Provider 的实战配置示例

在 OpenHuman 中做多 provider 路由，核心思想是：**先抽象能力层，再为能力层绑定 provider 列表与回退顺序**。

下面给出一个示意性配置，格式可根据你的实际项目调整。

```yaml
routing:
  capabilities:
    fast_text:
      models:
        - provider: openai
          model: gpt-4.1-mini
          timeout_ms: 8000
          max_input_tokens: 16000
          weight: 0.6
        - provider: anthropic
          model: claude-sonnet-4
          timeout_ms: 9000
          max_input_tokens: 20000
          weight: 0.3
        - provider: ollama
          model: qwen3:8b
          endpoint: http://localhost:11434
          timeout_ms: 15000
          weight: 0.1

    reasoning_text:
      models:
        - provider: anthropic
          model: claude-opus-4.1
          timeout_ms: 30000
          max_input_tokens: 64000
          weight: 0.5
        - provider: openai
          model: gpt-4.1
          timeout_ms: 30000
          max_input_tokens: 128000
          weight: 0.4
        - provider: ollama
          model: qwen3:32b
          endpoint: http://localhost:11434
          timeout_ms: 45000
          weight: 0.1

    vision_text:
      models:
        - provider: openai
          model: gpt-4.1
          timeout_ms: 30000
          supports_image: true
          weight: 0.7
        - provider: anthropic
          model: claude-sonnet-4
          timeout_ms: 30000
          supports_image: true
          weight: 0.3

  fallback_policy:
    max_attempts: 3
    breaker_window_sec: 60
    retryable_errors: [timeout, rate_limit, overload]

  budget_policy:
    default:
      monthly_reasoning_quota: 2000
      allow_vision: true
      max_total_tokens: 24000
    free:
      monthly_reasoning_quota: 50
      allow_vision: false
      max_total_tokens: 8000
    enterprise:
      monthly_reasoning_quota: 999999
      allow_vision: true
      max_total_tokens: 64000
```

这个配置里有几个实践重点：

1. **能力与模型解耦**：业务依赖 `fast_text`，而不是绑死某个供应商。
2. **保留 weight**：可用于 A/B、加权轮询或灰度切流。
3. **显式 timeout / token 限制**：防止不同模型行为不一致。
4. **预算分层**：直接支撑产品套餐策略。

### 代码侧的 Selector 示例

```python
from typing import Dict, List


def select_model(capability: str, registry: Dict, health_state: Dict):
    candidates: List[dict] = registry["routing"]["capabilities"][capability]["models"]

    healthy = [m for m in candidates if health_state.get(f"{m['provider']}:{m['model']}", True)]
    if not healthy:
        raise RuntimeError(f"no healthy model for capability={capability}")

    # 简化示例：优先 weight 高且健康的候选
    healthy.sort(key=lambda x: x.get("weight", 0), reverse=True)
    return healthy[0]
```

### Dispatcher 示例

```python
class DispatchError(Exception):
    pass


def dispatch_with_fallback(capability, payload, registry, health_state, invoke_fn):
    candidates = sorted(
        registry["routing"]["capabilities"][capability]["models"],
        key=lambda x: x.get("weight", 0),
        reverse=True,
    )

    errors = []
    for candidate in candidates:
        key = f"{candidate['provider']}:{candidate['model']}"
        if not health_state.get(key, True):
            continue
        try:
            return invoke_fn(candidate, payload)
        except Exception as e:
            errors.append({"model": key, "error": str(e)})
            health_state[key] = False

    raise DispatchError({
        "capability": capability,
        "errors": errors,
    })
```

实际项目里你还会补充：熔断恢复、限流、并发控制、trace 透传、幂等 ID 等能力，但这个框架已经体现出多 provider 路由的核心思路。

## 十二、监控与可观测性：路由系统是否优秀，不靠感觉，靠数据面板

模型路由一旦进入生产，观测能力甚至比“用了什么模型”更重要。

### 1. 必须采集的核心指标

建议至少按以下维度建指标：

#### 路由层指标

- 各任务类型的请求量
- 各 capability 的命中率
- 升级率（fast → reasoning）
- fallback 率
- provider 选择分布

#### 成本层指标

- 每 provider 成本
- 每任务类型平均成本
- 推理模型调用占比
- 图片请求成本占比

#### 质量层指标

- JSON 成功率
- 用户追问率
- 人工纠正率
- 任务完成率

#### 性能与稳定性指标

- TTFT、总延迟、P95、P99
- 超时率
- 限流率
- provider 错误率
- 单模型熔断次数

### 2. 路由日志里至少要记录的字段

建议每次请求落如下信息：

- request_id / session_id / tenant_id
- task_type / complexity / risk_level
- has_image / input_tokens / output_tokens
- selected_capability
- selected_provider / selected_model
- fallback_path
- latency_ms / ttft_ms
- estimated_cost / actual_cost
- response_status
- quality_signals

这样后续才能回答很多关键问题，例如：

- 为什么本月成本突然上涨？
- 是哪些任务把大量流量打到了推理模型？
- 某个 provider 的超时是否引发了 fallback 风暴？
- 视觉请求到底有没有产生足够业务价值？

### 3. 建议接入 Trace 视图

如果 OpenHuman 的调用链包含：分类 → 检索 → 主模型回答 → 格式化 → 安全检查，那么最好把这些步骤放进同一个 trace 中。这样你可以直观看到：

- 哪一步最耗时
- 哪一步最耗 token
- 路由升级发生在哪个节点
- fallback 是被什么错误触发的

对于复杂 Agent 系统来说，trace 不是锦上添花，而是定位性能问题和错误归因的基础工具。

## 十三、一个真实风格的场景拆解：把模型路由落到业务里

为了让路由策略不只停留在抽象概念，我们来看一个实际风格的 OpenHuman 场景：企业内部研发助手。

这个助手需要处理四类请求：

1. 员工查询研发流程与发布规范
2. 工程师上传报错日志或截图求助
3. 架构师让系统比较方案并输出设计建议
4. 运营同学批量整理会议纪要

### 场景 A：流程问答

用户问：“发版审批流程需要哪些角色参与？”

策略：

- 文本任务
- FAQ
- 低复杂度
- 延迟敏感

路由结果：`fast_text`

原因：

- 有知识库支持
- 不需要深度推理
- 用户更关心快速可用答案

### 场景 B：截图排障

用户上传 CI 截图并问：“为什么这个流水线失败？”

策略：

- 有图片
- 任务是 troubleshooting
- 需要看图 + 错误定位

路由结果：`vision_text`，必要时升级 `reasoning_text`

执行流程可以是：

1. 视觉模型提取截图中的报错关键信息
2. 若识别出是依赖冲突或权限问题，直接生成建议
3. 若错误信息复杂，交推理模型做根因分析

### 场景 C：架构设计建议

用户问：“我们要把单体服务拆成多租户 SaaS，请给出迁移路线、风险与数据隔离建议。”

策略：

- 文本任务
- planning
- 高复杂度
- 质量优先

路由结果：直接 `reasoning_text`

原因：

- 这是高价值决策场景
- 回答错误成本远高于 API 成本
- 需要多维权衡和结构化输出

### 场景 D：批量会议纪要整理

任务：每天自动总结 100 份会议转录。

策略：

- 文本任务
- summarize
- 中复杂度
- 离线批处理
- 成本敏感

路由结果：优先 `fast_text`，必要时本地 `ollama`

原因：

- 不要求实时交互
- 可通过模板化 prompt 保持质量
- 适合压缩成本

这个例子说明，所谓“智能路由”不是神秘算法，而是把业务语义、运行约束和模型能力清晰对齐。

## 十四、落地建议：从 0 到 1 构建 OpenHuman 模型路由，不要一开始就过度设计

如果你现在正准备在 OpenHuman 项目里实现模型路由，我建议按以下顺序推进。

### 第一步：先定义能力层，而不是先争论具体模型

先统一这些抽象标签：

- fast_text
- reasoning_text
- vision_text
- local_fallback

这样未来替换供应商时成本最低。

### 第二步：只做少量高收益规则

初期只需要覆盖：

- 有图走视觉
- 规划/排障/复杂代码走推理
- FAQ/改写/抽取走快速
- 超预算或 provider 故障时降级

不要一开始就写几十条细碎规则。

### 第三步：先把日志打全

如果没有可观测性，后面根本不知道路由是否正确。上线第一天就要记录：

- 为什么这样路由
- 花了多少 tokens
- 耗时多少
- 是否发生升级或 fallback

### 第四步：从最耗钱的 20% 流量开始优化

通常真正拉高成本的，不是所有请求，而是少数长上下文、高重试、高复杂度任务。优先优化这些路径，收益最大。

### 第五步：用评估数据驱动策略迭代

例如你可能会发现：

- 某些“复杂问答”其实快速模型就够了
- 某个视觉模型成本高但收益不明显
- 某个 provider 在高峰期超时严重，应该降低权重

这些都应通过数据而不是主观印象来调整。

## 十五、结语：模型路由不是“选模型”，而是在构建 AI 系统的调度能力

很多人一谈 AI 应用架构，注意力都放在“用哪个模型”。但从工程视角看，真正决定系统上限的往往不是某个单模型有多强，而是**你有没有把不同模型放在最合适的位置上**。

OpenHuman 里的模型路由，本质上是一种调度能力：

- 它决定复杂任务是否能得到足够推理深度
- 它决定高频请求是否能以更低成本稳定承载
- 它决定视觉请求是否进入正确通道
- 它决定系统在 provider 抖动、预算受限、延迟受压时是否仍能工作

如果把 AI Agent 看成一个真实的软件系统，那么 Router、Selector、Dispatcher 就像应用层的流量调度器；推理模型、快速模型、视觉模型则像不同类型的算力池。真正成熟的架构，不是把所有流量都打到“最强节点”，而是让每一类请求都落到最合适的节点上。

所以，**模型路由不是锦上添花的优化，而是 OpenHuman 走向生产级落地的基础设施**。当你开始用任务分类、预算控制、延迟分层、Fallback、A/B 评估和监控闭环来管理模型选择时，你搭建的就不再只是一个会调用 LLM 的功能，而是一套可运营、可优化、可扩展的 AI 系统。

对于下一阶段的实践，我建议你从最简单的三层能力分流开始：

- 默认快速模型承接基础流量
- 复杂问题升级到推理模型
- 图像输入进入视觉通道

## 相关阅读

- [OpenHuman TokenJuice 实战：智能 Token 压缩与成本优化（降低 80%）](/categories/00_架构/OpenHuman-TokenJuice-实战-智能Token压缩与成本优化/)
- [OpenHuman AutoFetch 实战：每 20 分钟自动拉取上下文的智能机制](/categories/00_架构/OpenHuman-AutoFetch-实战-每20分钟自动拉取上下文的智能机制/)
- [OpenHuman Memory Tree 实战：本地知识图谱与记忆构建](/categories/00_架构/OpenHuman-Memory-Tree-实战-本地知识图谱与记忆构建/)

然后逐步补上预算、回退、评估和观测。你会发现，模型路由做得越好，OpenHuman 的体验、成本、稳定性和可演进性就越强。这，才是多模型时代真正值得投入的架构能力。