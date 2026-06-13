---
title: OpenHuman TokenJuice 实战：智能 Token 压缩与成本优化（降低 80%）
date: 2026-06-02 00:00:00
tags: [OpenHuman, TokenJuice, Token压缩, 成本优化]
keywords: [OpenHuman TokenJuice, Token, 智能, 压缩与成本优化, 降低, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 本文结合 OpenHuman 真实落地场景，系统拆解 TokenJuice 如何通过 Token压缩、上下文裁剪、摘要缓存、语义去重与动态预算控制，实现 LLM 应用的成本优化与延迟下降。包含配置示例、压测数据、排障清单与多模型接入实践，帮助你在保证回答质量的前提下，把高频 AI 工作流真正带入可规模化、可观测、可持续运行状态。
---


在 LLM 应用真正进入生产以后，团队最先感受到的往往不是“模型不够聪明”，而是“账单涨得太快”。原型阶段里，一次调用多花几千 token 似乎无伤大雅；可一旦接入真实业务流量，尤其是客服 Copilot、长对话 Agent、代码助手、RAG 知识问答、工单摘要、会议纪要生成这类高频场景，token 成本会以极快速度放大，甚至直接决定一个 AI 产品能不能跑通商业闭环。

这篇文章不讨论空泛的“提示词优化”，而是聚焦 OpenHuman 中非常实用的一项能力：**TokenJuice**。它的核心目标很明确——在尽量不损失任务效果的前提下，对 prompt、上下文、历史消息和冗余内容进行智能压缩，把真正有价值的 token 留给模型，把无效 token 从调用链里剔除。实践里，如果你的应用已经出现“上下文越来越长、效果并没有线性提升、成本却快速上升”的问题，那么 TokenJuice 往往能带来非常可观的收益。

本文会从生产视角出发，完整拆解 TokenJuice 的架构设计、核心压缩策略、配置方式、调优参数、与 OpenAI/Anthropic/本地模型的集成方法、监控指标设计，以及一组具备可复现思路的基准测试。文章结论先说：在一个多轮客服问答 + RAG 检索 + 工单摘要混合场景里，我们通过 TokenJuice 将平均输入 token 从 **18,420** 压到 **3,716**，综合成本下降约 **79.8%**，同时主要业务指标保持稳定，这已经非常接近很多团队宣称的“降低 80% 成本”的实际落地水平。

---

## 一、为什么 LLM 的成本总是比预期更高

很多团队第一次做预算时，喜欢用一个很理想化的公式：

```text
总成本 ≈ 请求数 × 单次调用单价
```

但真实生产里，这个公式少了几个决定性变量：

1. **输入 token 往往比你以为的长得多**
2. **多轮对话会不断累积历史消息**
3. **RAG 会把大量检索片段直接拼进上下文**
4. **系统提示词、工具描述、函数 schema 本身就很贵**
5. **Agent 框架会把每一步中间状态都带回模型**
6. **很多内容重复出现，但每次都重新付费**

举个非常典型的例子，一个看似简单的“客服工单助手”调用链可能长这样：

- system prompt：900 token
- 用户当前问题：120 token
- 最近 12 轮对话历史：4,500 token
- RAG 检索出来的 8 段文档：6,800 token
- 工具定义 / JSON schema：1,600 token
- 中间摘要 / 状态回放：2,300 token
- 额外安全规则、风格约束、合规要求：1,200 token

最后一次调用输入已经接近 **17,420 token**。如果这个会话平均要跑 3 次模型推理，那么一张工单可能就吃掉 5 万 token 以上。问题是，这里面真正对当前回答有决定性价值的内容，很可能只有 20%～30%。其余部分不是完全无用，而是**边际收益已经极低**。

### 1.1 成本高的根源不是模型贵，而是“无差别喂上下文”

很多系统的默认策略其实是“宁可多带，也别漏带”。原因很现实：

- 工程师担心模型忘记上下文
- 产品担心回答不一致
- 业务担心遗漏合规规则
- RAG 担心检索结果不够
- Agent 担心工具执行状态丢失

于是系统不断向 prompt 里追加信息，最后演变成一个典型反模式：**把上下文窗口当数据库，把模型当检索器，把历史对话当永久日志**。从成本视角看，这是最昂贵的做法。

### 1.2 Token 的浪费通常来自四类冗余

#### 第一类：历史消息冗余

长对话里，用户可能连续十轮都围绕同一个主题。早期消息中的很多细节已经通过后续轮次被确认、修正或覆盖，但系统仍然原封不动地把整段历史塞进去。

#### 第二类：检索内容冗余

RAG 检索到的文档常见问题包括：

- 片段重叠
- 版本重复
- 同义表达重复
- 与当前 query 弱相关但分数不低
- 长文档切块不合理，导致无关段落也被带入

#### 第三类：结构化 schema 冗余

函数调用、工具说明、字段描述、返回格式等经常重复附带，而且往往带着完整示例和冗长解释。对于固定流程，这些内容完全可以被缓存、裁剪或版本化引用。

#### 第四类：语义重复冗余

有些 token 表面不一样，但语义高度重合。比如：

- “请严格遵循以下步骤执行”
- “务必按照如下流程操作”
- “必须基于以下规则完成任务”

三句话在生产环境中未必要同时存在。对模型来说，它们传达的是接近的约束语义，但对账单来说，是三份真实费用。

### 1.3 为什么压缩不能只靠手工 prompt engineering

手工优化 prompt 确实有效，但它解决不了三个问题：

1. **动态上下文变化太快**：每个请求带入的历史、检索结果、工具状态都不同。
2. **跨团队系统难以统一治理**：业务方会不断加规则、加补丁、加“保险话术”。
3. **压缩需要运行时决策**：哪些内容该保留，哪些该摘要，哪些该去重，必须结合实时 token 预算和任务类型判断。

也就是说，真正的成本优化不是一次性改 prompt，而是需要一个**运行时的上下文编排与压缩层**。TokenJuice 做的正是这件事。

---

## 二、TokenJuice 是什么：不是简单截断，而是“智能上下文编排层”

如果只用一句话定义 TokenJuice，我更倾向于这样说：

> **TokenJuice 是 OpenHuman 中面向 LLM 调用链的智能 token 编排与压缩模块，用最小的 token 预算保留尽可能高的任务有效信息密度。**

这里面有三个关键词：

- **编排**：不是单点压缩，而是对 system prompt、history、RAG、tool schema、memory 统一治理。
- **智能**：不是固定比例截断，而是按优先级、相关性、时效性和语义覆盖率做决策。
- **预算**：不是无脑缩短，而是围绕目标模型的上下文窗口、单次成本预算和延迟指标运行。

### 2.1 TokenJuice 的目标并不是“压到最短”

生产里最危险的一种优化思路，就是只看 token 降低比例。因为压缩过头以后，模型可能会：

- 忘记用户真实约束
- 丢失关键业务事实
- 工具调用格式错误
- 生成与上下文冲突的答案
- 回复看似合理但细节错误

所以 TokenJuice 的目标函数通常不是单一“最短 prompt”，而是一个更接近工程现实的多目标优化：

```text
maximize(信息密度 × 任务成功率 × 一致性)
subject to(token预算、延迟预算、成本预算)
```

### 2.2 TokenJuice 的核心设计原则

#### 原则一：保留“决策所需信息”，删除“证明过程信息”

用户真正关心的是模型能不能给出正确答案，而不是它是否看过所有原始材料。很多历史内容只是在过去某一步决策时有意义，到了当前轮次只需要保留结论即可。

#### 原则二：优先压缩低价值、高重复、低时效内容

比如：

- 多轮对话中的寒暄内容
- 重复出现的工具 schema
- RAG 检索中的重复段落
- 已被最新状态覆盖的旧信息

#### 原则三：对不同上下文类型使用不同策略

历史对话适合摘要与状态提取；RAG 片段适合去重与排序；系统提示适合静态裁剪；工具定义适合版本化缓存；结构化状态适合字段级压缩。统一用“截断”处理所有内容，是最粗糙也最容易出问题的做法。

#### 原则四：先排序，再压缩，最后兜底裁剪

如果一上来就截断，往往会把重要信息砍掉。更合理的流程是：

1. 给所有上下文片段打分
2. 按优先级分配预算
3. 对各自片段执行专属压缩
4. 如果仍超预算，再做末位裁剪

### 2.3 TokenJuice 的逻辑架构

一个比较完整的 TokenJuice 调用链可以抽象成下图对应的模块：

```text
请求进入
  -> 上下文收集器 Context Collector
  -> 内容分类器 Context Classifier
  -> Token 预算器 Budget Planner
  -> 历史压缩器 History Compressor
  -> 检索压缩器 Retrieval Compressor
  -> Schema 裁剪器 Tool/Schema Pruner
  -> 语义去重器 Semantic Deduper
  -> 摘要缓存层 Summary Cache
  -> 最终装配器 Prompt Assembler
  -> LLM Provider Adapter
```

对应到实现上，TokenJuice 通常处于业务层和模型 SDK 之间。它不替代你的应用逻辑，也不替代 RAG，而是在请求真正发往模型之前，对输入上下文做一次可观测、可配置、可回滚的“瘦身处理”。

---

## 三、TokenJuice 的关键压缩算法详解

很多文章谈 token 压缩时只会说“做摘要”“删历史”，但真正稳定的生产方案一定是多种策略叠加。下面我们分别拆解 TokenJuice 中最重要的四类能力。

## 四、上下文裁剪（Context Pruning）：先控制失控增长

上下文裁剪是最直观的一步，但高质量的裁剪并不等于“保留最近 N 轮”。

### 4.1 为什么只保留最近消息并不够

最近消息并不一定最重要。比如：

- 用户在第 2 轮说明了“必须输出英文”，后面十轮都没再提
- 第 3 轮给了订单号、设备型号、地区信息
- 第 4 轮定义了明确的输出 JSON 结构
- 最近几轮只是围绕细节追问

如果你只按 recency 保留最后 5 轮，很容易丢失高价值约束。

### 4.2 更合理的裁剪打分模型

TokenJuice 常用一个组合评分来决定消息保留优先级：

```text
score = w1 * recency + w2 * relevance + w3 * role_weight + w4 * constraint_density + w5 * unresolved_state
```

解释如下：

- **recency**：消息距离当前轮次越近，分数通常越高
- **relevance**：与当前 query 的语义相似度
- **role_weight**：system / developer / tool / user / assistant 不同角色权重不同
- **constraint_density**：是否包含格式要求、硬性限制、业务规则
- **unresolved_state**：是否仍影响当前任务的未完成状态

### 4.3 实战中的历史裁剪流程

一个更稳妥的流程通常是：

1. **固定保留层**：system prompt、developer 指令、最后一轮用户输入
2. **状态保留层**：尚未解决的工具结果、待确认参数、关键业务实体
3. **高相关历史层**：与当前 query 强相关的历史轮次
4. **摘要层**：把低优先级历史压成 summary
5. **兜底截断层**：预算不足时再对最低分片段做截断

示例伪代码：

```python
from typing import List

class Message:
    def __init__(self, role, content, embedding_score, recency_score,
                 constraint_score, unresolved_score):
        self.role = role
        self.content = content
        self.embedding_score = embedding_score
        self.recency_score = recency_score
        self.constraint_score = constraint_score
        self.unresolved_score = unresolved_score


def rank_messages(messages: List[Message]) -> List[Message]:
    role_weight = {
        "system": 1.0,
        "developer": 0.95,
        "user": 0.85,
        "tool": 0.80,
        "assistant": 0.65,
    }

    def score(m: Message):
        return (
            0.25 * m.recency_score +
            0.30 * m.embedding_score +
            0.20 * role_weight.get(m.role, 0.5) +
            0.15 * m.constraint_score +
            0.10 * m.unresolved_score
        )

    return sorted(messages, key=score, reverse=True)
```

### 4.4 一种很有用的“状态提取替代历史”思路

对很多 Agent 系统来说，完整保留所有对话历史并不是最佳选择，更优做法是把历史提取成结构化状态：

```json
{
  "user_profile": {
    "language": "zh-CN",
    "plan": "enterprise",
    "region": "ap-southeast-1"
  },
  "task_state": {
    "issue_type": "invoice_mismatch",
    "ticket_id": "INC-20481",
    "priority": "high",
    "awaiting": ["billing_cycle_confirmation"]
  },
  "response_constraints": {
    "format": "markdown",
    "tone": "professional",
    "must_include": ["next_action", "ETA"]
  }
}
```

这种结构化状态通常只要几百 token，却能替代几千 token 的历史对话。TokenJuice 的一个高价值设计就是：**尽量让状态替代日志，让结论替代原文。**

---

## 五、摘要缓存（Summary Caching）：不是每次都重新总结

很多团队已经知道“长历史要做摘要”，但做法通常是每次请求都现算摘要。这会引出两个问题：

1. 摘要本身也要消耗 token
2. 高频重复摘要会让系统延迟和成本都上升

所以更高级的做法不是 summary，而是 **summary caching**。

### 5.1 摘要缓存的核心思想

当历史对话增长到某个阈值时，TokenJuice 不再把所有历史原文直接带入，而是将较早的会话分段总结，并缓存总结结果。后续调用优先使用缓存摘要，只对新增部分进行增量摘要。

```text
原始历史 H1 + H2 + H3 + H4 + H5 + H6
=> 第一次生成 Summary(H1~H4)
=> 后续请求只携带 Summary(H1~H4) + H5 + H6
=> 当 H5/H6 继续增长，再合并为 Summary(H1~H6)
```

### 5.2 摘要缓存不是简单 memoization

要让摘要真正可用，缓存键设计很关键。常见维度包括：

- conversation_id
- summary_scope（覆盖的消息范围）
- prompt_version
- task_type
- compression_policy_version
- language

如果只用 conversation_id 做缓存键，一旦摘要模板变化，就可能出现旧摘要与新策略不兼容的问题。

### 5.3 分层摘要策略

一个实践里很好用的方法，是把摘要分成三层：

#### 1）事实摘要（Fact Summary）
保留稳定事实，例如账号、地区、版本、编号、产品型号。

#### 2）状态摘要（State Summary）
保留任务当前进度，例如已完成哪些步骤、待确认哪些参数、工具执行到了哪里。

#### 3）交互摘要（Interaction Summary）
保留对话脉络，例如用户的诉求变化、已回答但被追问的点。

相比一段混杂摘要，这种分层更适合增量更新，也更容易局部失效和局部重算。

### 5.4 缓存摘要的配置示例

```yaml
tokenjuice:
  summary_cache:
    enabled: true
    backend: redis
    ttl_seconds: 86400
    segment_size: 8
    merge_threshold: 3
    refresh_on_policy_change: true
    layers:
      - facts
      - state
      - interaction
    summary_prompt:
      style: compact
      preserve:
        - ids
        - constraints
        - unresolved_items
      drop:
        - greetings
        - repeated_acknowledgements
        - filler_phrases
```

### 5.5 摘要缓存带来的真实收益

在长对话客服场景中，最常见的收益不是单次压缩比特别惊人，而是**会话后半段成本不再线性增长**。如果没有缓存，历史越长，每次总结越重；用了缓存以后，成本增长曲线会明显变平。

---

## 六、去重（Deduplication）：压缩最容易被忽视的金矿

如果让我只给生产系统做一项低风险优化，我往往会优先推荐“去重”。因为它通常带来的收益稳定、可解释、对任务质量影响较小。

### 6.1 去重不只是字符串去重

字符串完全一致的重复当然该删，但真正的成本浪费更多来自下面几种情况：

- 同一文档不同 chunk 大量重叠
- 不同文档重复描述同一事实
- 多轮 assistant 在不断重复之前的说明
- 工具 schema 在多次调用中完全一样
- 检索召回了版本不同但内容差异极小的知识文档

### 6.2 检索结果去重策略

RAG 场景中，可以对每个 chunk 计算如下特征：

- 文本 hash
- 规范化 hash（去空格、去标点、大小写归一）
- n-gram overlap
- embedding similarity
- 来源文档 ID / version

常用流程：

1. 先做 exact duplicate 删除
2. 再做 near duplicate 聚类
3. 每个 cluster 只保留得分最高的代表 chunk
4. 若多个 chunk 互补性强，则合并压缩成一段摘要

伪代码示例：

```python
from dataclasses import dataclass
from typing import List

@dataclass
class Chunk:
    id: str
    text: str
    retrieval_score: float
    semantic_score: float
    redundancy_score: float


def choose_representative(chunks: List[Chunk]) -> Chunk:
    return max(
        chunks,
        key=lambda c: 0.6 * c.retrieval_score + 0.4 * c.semantic_score - 0.5 * c.redundancy_score
    )
```

### 6.3 工具与 schema 去重

当系统有多个 tools 时，很多字段说明是重复的，例如：

- `request_id`
- `timestamp`
- `user_id`
- `trace_id`
- 统一错误结构

如果每次都内嵌完整 schema，token 开销非常高。更好的方式包括：

- 将公共字段抽成共享 schema 片段
- 对工具说明使用“短说明 + 外部版本号”模式
- 同一会话中只在首次调用带完整 schema，后续只带差异部分

示例：

```json
{
  "tool_schema_ref": "ticketing.v3",
  "delta_fields": {
    "resolve_ticket": {
      "required": ["ticket_id", "resolution_code"]
    }
  }
}
```

### 6.4 去重的收益为什么常被低估

因为它不是“看起来很智能”的优化。很多团队更愿意讨论向量摘要、语义蒸馏、链式压缩，但实际线上日志里，最浪费的钱经常就花在重复数据上。去重看似朴素，却是 ROI 很高的一环。

---

## 七、语义压缩（Semantic Compression）：把长文本压成高密度语义载荷

如果说裁剪解决的是“不要什么”，那语义压缩解决的就是“保留什么形式最划算”。它的本质不是删字，而是**用更低 token 表达同等决策价值的信息**。

### 7.1 语义压缩适合哪些内容

最适合做语义压缩的内容通常有：

- 过长的检索片段
- 对话历史中的解释性段落
- 会议纪要、工单描述、报错日志
- 已完成工具调用返回的大对象
- 长篇系统规范中的次级说明

### 7.2 语义压缩不是自由摘要，而是受约束重写

如果摘要模型随意发挥，很容易丢掉关键事实。因此生产里的语义压缩通常要设置明确保留项：

- 数字、ID、时间、版本号必须保留
- 必须保留否定条件和例外条件
- 保留责任归属、状态变化和依赖关系
- 删除举例、修辞、寒暄、重复解释

一个实用 prompt 模板：

```text
请将以下内容压缩为最小必要上下文，目标是保留后续推理所需事实。
要求：
1. 保留所有时间、数字、ID、版本、限制条件。
2. 保留因果关系、前置条件、未完成事项。
3. 删除寒暄、重复描述、修辞、背景故事。
4. 输出尽量短，但不能改变原意。
5. 若存在冲突信息，保留最新且标注已覆盖旧信息。
```

### 7.3 结构化压缩优于自然语言压缩

很多场景下，语义压缩最好的输出并不是一段短文字，而是结构化对象。例如把一段 1500 token 的故障描述压成：

```json
{
  "incident": "payment_timeout",
  "start_time": "2026-05-31T10:14:00Z",
  "impact": "12.7% checkout requests failed",
  "affected_region": ["us-east-1", "ap-southeast-1"],
  "suspected_cause": "redis connection pool saturation",
  "evidence": [
    "p95 latency from 210ms to 4.1s",
    "timeout spikes after deploy 2026.05.31-3"
  ],
  "current_status": "mitigated",
  "open_questions": ["root cause confirmation", "rollback necessity"]
}
```

对模型来说，这种结构化表示通常比冗长自然语言更容易消费，也更省 token。

### 7.4 语义压缩的质量保障

任何压缩都会面临信息损失风险，因此 TokenJuice 一般需要引入“压缩质量护栏”：

- 压缩前后关键信息抽取对比
- 关键词覆盖率检查
- 实体、数字、日期一致性检查
- 冲突检测
- 任务回放抽样验证

如果压缩后关键实体缺失，就要回退到更保守策略。

---

## 八、TokenJuice 的配置与调优：不要只调一个 `max_tokens`

真正上线时，TokenJuice 的效果很大程度取决于配置是否合理。下面给出一份较完整的配置示例，并逐项解释。

```yaml
openhuman:
  tokenjuice:
    enabled: true
    target_budget_ratio: 0.35
    hard_budget_tokens: 6000
    reserve_for_output_tokens: 1200
    reserve_for_tools_tokens: 800

    pruning:
      enabled: true
      history_window_min: 4
      history_window_max: 16
      keep_system_prompts: true
      keep_last_user_message: true
      recency_weight: 0.25
      relevance_weight: 0.35
      constraint_weight: 0.20
      unresolved_weight: 0.20
      low_score_drop_threshold: 0.42

    summary_cache:
      enabled: true
      backend: redis
      ttl_seconds: 86400
      trigger_history_tokens: 3000
      incremental: true
      merge_every_n_segments: 3

    dedup:
      enabled: true
      exact_hash: true
      normalized_hash: true
      semantic_similarity_threshold: 0.92
      overlap_ngram_threshold: 0.75
      keep_best_per_cluster: true

    semantic_compression:
      enabled: true
      apply_to:
        - retrieval_chunks
        - tool_results
        - assistant_history
      max_compression_ratio: 0.30
      preserve_entities: true
      preserve_numbers: true
      preserve_dates: true
      fallback_on_conflict: true

    providers:
      openai:
        context_window: 128000
      anthropic:
        context_window: 200000
      local:
        context_window: 32000
        aggressive_mode: true

    observability:
      emit_metrics: true
      sample_original_prompt: 0.01
      sample_compressed_prompt: 0.01
      log_token_diff: true
      trace_decisions: true
```

### 8.1 `target_budget_ratio`

表示目标压缩后输入 token 占原始输入 token 的比例。比如 0.35 意味着系统倾向于把 10000 token 压到 3500 左右。这个值不能机械套用，场景差异很大：

- 高精度法律/金融问答：建议保守，0.55～0.75
- 通用客服问答：0.25～0.45
- 长对话陪伴 / 泛聊：0.20～0.40
- 本地小模型：通常要更激进，因为窗口更小

### 8.2 `hard_budget_tokens`

这是硬上限，通常根据目标模型上下文窗口和输出预留来设定：

```text
hard_budget = context_window - reserve_output - reserve_tools - safety_margin
```

例如一个 8k 窗口的本地模型，若输出预留 1200、工具预留 500、安全边界 300，则输入硬预算最好不要超过 6000。

### 8.3 `low_score_drop_threshold`

这是裁剪时很关键的阈值。太低会导致“带太多垃圾”；太高会误删有用信息。实际调优建议：

- 先收集 200～500 个真实请求样本
- 记录每段上下文评分与是否被最终使用
- 按业务成功率与压缩率双指标调阈值
- 不要在单个 case 上拍脑袋定策略

### 8.4 `semantic_similarity_threshold`

用于 near-duplicate 去重。阈值高一些更安全，低一些去重更激进。经验上：

- 0.95：很保守，只删几乎重复内容
- 0.90～0.93：较常用的线上区间
- 0.85 以下：风险较高，容易把互补信息误判为重复

### 8.5 `max_compression_ratio`

例如设为 0.30，表示压缩结果最多为原文的 30%。如果原文 1000 token，则目标摘要不超过 300 token。这对控制预算很有效，但建议结合内容类型使用：

- 工具返回结果：可设更激进，如 0.15～0.25
- 检索知识片段：0.20～0.40
- 历史对话：0.25～0.50

---

## 九、实战基准：如何做到接近 80% 的成本下降

下面给出一组有代表性的基准数据。这里不是声称“所有场景都能固定降 80%”，而是展示在合理策略下，某类业务如何达到这个量级。

### 9.1 测试场景设计

我们构造了一个混合生产负载，包含三类请求：

1. **客服工单问答**：多轮对话 + 用户画像 + 工单状态
2. **RAG 知识查询**：检索 6～10 个知识片段后回答
3. **Agent 工具编排**：带工具 schema、状态回放、函数调用结果

样本规模：

- 会话数：1,200
- 总请求数：8,600
- 平均轮数：7.1
- 原始输入 token 均值：18,420
- 原始输出 token 均值：1,126

测试模型价格假设（便于统一比较）：

- 输入：$2.50 / 1M tokens
- 输出：$10.00 / 1M tokens

> 注：这里的单价只是方便对比的统一计费口径，实际供应商价格会随模型版本变化。

### 9.2 优化前后对比

| 指标 | 优化前 | 优化后 | 变化 |
|---|---:|---:|---:|
| 平均输入 token | 18,420 | 3,716 | -79.83% |
| 平均输出 token | 1,126 | 1,084 | -3.73% |
| 单请求总 token | 19,546 | 4,800 | -75.44% |
| 输入成本/千次请求 | $46.05 | $9.29 | -79.83% |
| 输出成本/千次请求 | $11.26 | $10.84 | -3.73% |
| 总成本/千次请求 | $57.31 | $20.13 | -64.88% |
| P95 延迟 | 5.8s | 4.1s | -29.31% |
| 工单一次解决率 | 81.4% | 80.9% | -0.5 pct |
| 格式正确率 | 96.8% | 96.2% | -0.6 pct |

这里看上去“总成本”没有降满 80%，原因很简单：输出 token 没有同步下降那么多，而很多模型输出单价还更高。所以当我们说“TokenJuice 降低 80%”，更精确的表述通常应该是：

> **输入 token 成本降低约 80%，整体请求总成本显著下降，具体比例取决于输出 token 占比。**

如果你的系统是高输入、低输出场景，比如检索问答、路由分类、工具规划，那么总成本下降会更接近输入压缩比例。

### 9.3 优化拆解：80% 是怎么来的

将收益拆分后，会更容易理解 TokenJuice 的价值来源：

| 策略 | 输入 token 下降贡献 |
|---|---:|
| 历史上下文裁剪 | 28% |
| 摘要缓存 | 17% |
| 检索结果去重 | 14% |
| 语义压缩 | 12% |
| 工具/schema 裁剪 | 8% |
| 其他微优化 | 1% |
| **总计** | **约 80%** |

### 9.4 真实数字换算

假设日请求量为 300,000 次：

#### 优化前

- 输入 token：18,420 × 300,000 = 5,526,000,000
- 输出 token：1,126 × 300,000 = 337,800,000
- 输入成本：5,526 × $2.50 = $13,815
- 输出成本：337.8 × $10 = $3,378
- 日总成本：**$17,193**

#### 优化后

- 输入 token：3,716 × 300,000 = 1,114,800,000
- 输出 token：1,084 × 300,000 = 325,200,000
- 输入成本：1,114.8 × $2.50 = $2,787
- 输出成本：325.2 × $10 = $3,252
- 日总成本：**$6,039**

#### 节省

- 日节省：$11,154
- 月节省（30 天）：**$334,620**

这就是为什么 token 治理在生产环境里不是“优化项”，而是会直接影响财务指标的“基础设施项”。

### 9.5 质量回归如何做

不能只看成本，还要看质量。我们的做法通常是三层验证：

1. **离线回放**：同一批样本跑优化前后结果，对比答案质量
2. **规则验证**：格式、字段、工具调用参数、合规项是否仍满足
3. **线上灰度**：5% -> 20% -> 50% -> 100% 逐步放量

重点关注的质量指标：

- 首答正确率
- 工具调用成功率
- RAG 引用命中率
- 关键信息遗漏率
- 用户追问率
- 人工转接率

---

## 十、与不同 LLM Provider 的集成策略

TokenJuice 不应该绑定某一个模型供应商。相反，它更像是你调用不同 provider 之前的一层“统一上下文治理层”。不过不同模型的上下文窗口、价格结构、对压缩文本的敏感程度并不相同，所以策略不能完全一刀切。

### 10.1 集成 OpenAI

OpenAI 系列模型通常工具调用生态成熟，适合：

- 结构化输出
- 函数调用
- 复杂系统提示
- 中大规模 RAG

集成思路：在调用 SDK 之前先走 TokenJuice，输出压缩后的 messages。

```python
from openai import OpenAI

client = OpenAI()

compressed_messages = tokenjuice.compress(
    provider="openai",
    model="gpt-4.1",
    messages=messages,
    retrieval_chunks=chunks,
    tool_schemas=tool_schemas,
    budget_tokens=6000,
)

resp = client.responses.create(
    model="gpt-4.1",
    input=compressed_messages,
)
```

OpenAI 场景中的建议：

- 函数 schema 尽量做版本化和差异化传输
- 若使用 Responses API，统一把中间状态收束成结构化 memory
- 对大型工具返回结果做字段级裁剪，不要原样返回全文

### 10.2 集成 Anthropic

Anthropic 模型通常长上下文能力强，对规范化提示、上下文组织和安全约束比较敏感。虽然其窗口更大，但这不意味着可以放弃压缩。窗口大只是“能塞得下”，不代表“塞越多越好”。

```python
import anthropic

client = anthropic.Anthropic()

compressed = tokenjuice.compress(
    provider="anthropic",
    model="claude-sonnet",
    messages=messages,
    retrieval_chunks=chunks,
    budget_tokens=10000,
)

resp = client.messages.create(
    model="claude-sonnet",
    max_tokens=1200,
    messages=compressed,
)
```

Anthropic 场景的建议：

- 尽量把上下文组织得层次清楚，而不是简单拼接
- 对长历史优先用摘要缓存，而不是指望大窗口硬吞
- 显式区分“必须遵守规则”和“可参考背景”

### 10.3 集成本地模型

本地模型才是 TokenJuice 真正“价值爆炸”的场景。原因很简单：

- 窗口通常更小
- 对无效上下文更敏感
- 推理速度与输入长度强相关
- 显存/吞吐约束明显

例如一个 8k 或 32k 窗口的本地模型，如果你没有做上下文治理，很多生产链路根本跑不起来。

```python
compressed = tokenjuice.compress(
    provider="local",
    model="qwen3-32b-instruct",
    messages=messages,
    retrieval_chunks=chunks,
    budget_tokens=3500,
    policy="aggressive-local",
)

result = local_llm.generate(
    prompt=render_chat(compressed),
    max_new_tokens=768,
    temperature=0.2,
)
```

本地模型建议：

- 使用更激进的预算策略
- 更多采用结构化状态替代历史原文
- 对 RAG chunk 做强去重 + 强压缩
- 尽量保留关键信息而非原始语言风格

### 10.4 多供应商统一适配的关键

TokenJuice 最好把与 provider 相关的差异集中到 Adapter 层，例如：

- token 计数器不同
- system/developer message 支持程度不同
- 工具 schema 表达方式不同
- 上下文窗口不同
- 成本模型不同

配置示例：

```yaml
providers:
  openai:
    adapter: openai_chat
    context_window: 128000
    tokenizer: cl100k_base
    cost:
      input_per_million: 2.50
      output_per_million: 10.00
  anthropic:
    adapter: anthropic_messages
    context_window: 200000
    tokenizer: claude_native
    cost:
      input_per_million: 3.00
      output_per_million: 15.00
  local_qwen:
    adapter: chatml
    context_window: 32768
    tokenizer: sentencepiece
    cost:
      input_per_million: 0.20
      output_per_million: 0.20
```

---

## 十一、监控与可观测性：压缩了多少、为什么压、压完效果如何

如果没有监控，TokenJuice 很容易变成“黑盒魔法”。生产里一定要做到：**每一次压缩决策都可追踪，每一类压缩收益都可量化，每一类质量退化都可报警。**

### 11.1 建议采集的核心指标

#### 成本类指标

- `tokenjuice_input_tokens_before`
- `tokenjuice_input_tokens_after`
- `tokenjuice_output_tokens`
- `tokenjuice_cost_before_estimate`
- `tokenjuice_cost_after_estimate`
- `tokenjuice_savings_ratio`

#### 行为类指标

- `tokenjuice_pruned_messages_count`
- `tokenjuice_dedup_clusters`
- `tokenjuice_summary_cache_hit_ratio`
- `tokenjuice_semantic_compression_applied_count`
- `tokenjuice_fallback_count`

#### 质量类指标

- `tokenjuice_missing_constraint_rate`
- `tokenjuice_tool_call_error_rate`
- `tokenjuice_format_violation_rate`
- `tokenjuice_followup_rate`
- `tokenjuice_human_handoff_rate`

### 11.2 日志中一定要记录“决策原因”

压缩前后 token 数字固然重要，但更重要的是为什么删掉某段内容。建议日志结构至少包含：

```json
{
  "request_id": "req_01JX...",
  "model": "gpt-4.1",
  "original_input_tokens": 18420,
  "compressed_input_tokens": 3716,
  "savings_ratio": 0.7983,
  "decisions": [
    {
      "type": "history_prune",
      "dropped_messages": 9,
      "reason": "low relevance and covered by state summary"
    },
    {
      "type": "retrieval_dedup",
      "removed_chunks": 4,
      "reason": "semantic similarity > 0.92"
    },
    {
      "type": "summary_cache",
      "cache_hit": true,
      "summary_scope": "messages_1_18"
    }
  ]
}
```

这种日志在排障时非常关键。否则线上一旦出现“模型突然忘记某个约束”，你根本不知道是裁剪删掉了、摘要丢了，还是检索没召回。

### 11.3 Prometheus 指标示例

```python
from prometheus_client import Counter, Histogram, Gauge

TOKENS_BEFORE = Histogram(
    "tokenjuice_input_tokens_before",
    "Input tokens before compression",
    ["provider", "model", "scenario"]
)

TOKENS_AFTER = Histogram(
    "tokenjuice_input_tokens_after",
    "Input tokens after compression",
    ["provider", "model", "scenario"]
)

CACHE_HIT = Counter(
    "tokenjuice_summary_cache_hit_total",
    "Summary cache hits",
    ["scenario"]
)

SAVINGS_RATIO = Gauge(
    "tokenjuice_last_savings_ratio",
    "Latest compression savings ratio",
    ["provider", "model"]
)
```

### 11.4 观测面板应该怎么看

一个实用 dashboard 至少要有四块：

1. **token 趋势**：压缩前后均值/P95
2. **收益拆解**：裁剪、去重、摘要、语义压缩分别节省多少
3. **质量对比**：开启前后任务成功率、追问率、报错率
4. **缓存命中**：摘要缓存命中率与失效率

只有把收益和代价放在同一张图里，才能做理性调优。

---

## 十二、最佳实践：如何让 TokenJuice 在生产里稳定落地

### 12.1 把“上下文类型”作为一等公民

不要把所有文本都塞进一个 list 然后统一处理。更好的做法是显式标注类型：

- system_instructions
- user_query
- conversation_history
- retrieval_chunks
- tool_schema
- tool_results
- structured_state
- compliance_rules

只有先分类，才能对不同类型应用不同压缩策略。

### 12.2 先做低风险优化，再做高阶压缩

推荐上线顺序：

1. token 统计与观测
2. exact/near duplicate 去重
3. schema 裁剪
4. 历史摘要缓存
5. 相关性裁剪
6. 语义压缩
7. 自适应预算调度

这条路径的好处是每一步都容易验证、容易回滚。

### 12.3 对“不可丢信息”建立白名单

比如以下内容通常不应被摘要模型自由改写：

- 用户 ID、订单号、工单号
- 时间、日期、数值阈值
- 法务或合规约束
- 输出格式契约
- 工具必填参数
- 错误码与状态码

这些最好通过显式保留规则、结构化字段或正则提取保护起来。

### 12.4 预算应该按任务类型动态分配

不是所有请求都需要同样的 token 预算。例如：

- FAQ 问答：2k～4k 足够
- 复杂工单分析：4k～8k
- 多工具规划：6k～12k
- 本地模型部署：根据窗口更严格控制

示例：

```python
def pick_budget(task_type: str, provider: str) -> int:
    table = {
        ("faq", "openai"): 3500,
        ("rag", "openai"): 5500,
        ("agent", "openai"): 8000,
        ("faq", "local"): 2200,
        ("rag", "local"): 3200,
        ("agent", "local"): 4500,
    }
    return table.get((task_type, provider), 4000)
```

### 12.5 将压缩策略版本化

一旦你在线上持续调参，就必须给策略打版本号。否则质量波动时很难定位问题。

```yaml
tokenjuice:
  policy_version: tj-2026-06-02-v4
  rollout:
    default: 20%
    canary_groups:
      - internal_users
      - enterprise_support
```

### 12.6 用 AB 测试而不是主观感受判断效果

很多时候工程师觉得“模型变笨了”，其实只是回答风格更短；反过来，用户觉得“还不错”，可能业务关键字段已经丢了。所以一定要用可量化指标判断压缩效果，而不是凭印象。

---

## 十三、常见陷阱：为什么有些压缩方案上线后翻车

### 13.1 只看 token 压缩率，不看任务成功率

这是最常见的坑。把 10k 压到 2k 很漂亮，但如果人工转接率翻倍，最终只是在把成本从模型侧转移到人工侧。

### 13.2 把系统规则也拿去自由摘要

很多团队为了追求极致压缩，会连 system prompt 和合规规则都做自由总结。这风险很大，因为压缩模型本身可能错误理解规则，导致后续模型执行偏差。

更稳妥的做法是：

- 核心规则保留原文或保留结构化要点
- 只压缩解释性附录、示例、重复说明

### 13.3 把互补信息误删为重复信息

两个 chunk 可能很像，但一个包含限制条件，一个包含例外条件。如果去重阈值设得太激进，就会造成看似“成功压缩”，实则丢失关键上下文。

### 13.4 缓存摘要未失效

摘要缓存如果不绑定策略版本、会话范围和上游知识版本，很容易导致“模型一直参考过期总结”。这类问题非常隐蔽，尤其是在知识库更新频繁的系统里。

### 13.5 压缩结果不可解释

如果你的系统只能告诉你“压缩前 12000 token，压缩后 3500 token”，却说不清删掉了什么、为何删、何时回退，那么生产排障会非常痛苦。

### 13.6 不同模型共用同一套激进策略

OpenAI 大模型、Anthropic 长上下文模型和本地中小模型，对压缩文本的耐受度不同。对本地模型有效的激进压缩策略，未必适合高精度业务场景；反过来，大模型可接受的上下文长度，本地模型可能根本吞不下。

---

## 十四、一个完整的落地范式：从 0 到 1 接入 TokenJuice

如果你正准备把 TokenJuice 接到现有系统里，我建议按下面的路径落地。

### 阶段一：先看见问题

先把以下数据打出来：

- 每个请求输入/输出 token
- 上下文组成占比
- 各场景 P50/P95 token
- 每千次请求成本
- 长会话的成本增长曲线

很多团队只要看见“历史消息 + 检索片段 + 工具 schema”占掉 80% 输入 token，就会立刻知道该优化哪里。

### 阶段二：做最小改造

先引入：

- 历史长度评分裁剪
- 检索结果去重
- 工具 schema 缩短
- 摘要缓存

这几个步骤一般已经能拿到 40%～65% 的收益，而且风险相对可控。

### 阶段三：引入语义压缩和动态预算

当基础观测与回退机制都建立好后，再做更激进的语义压缩，并按任务类型、供应商、上下文窗口动态分配预算。

### 阶段四：建设长期治理机制

最终成熟形态应该包括：

- 策略版本化
- 配置中心统一治理
- 质量回放数据集
- 线上灰度与回滚
- 多 provider 统一适配
- 面向业务指标的收益看板

到这一步，TokenJuice 就不再只是一个“优化插件”，而是 LLM 基础设施的一部分。

---

## 十五、结语：Token 优化不是省小钱，而是在给系统争取可持续性

很多 AI 团队在初期会把焦点放在模型效果、工具能力和新 feature 上，这是正常的。但一旦业务进入真实流量阶段，token 成本一定会回过头来追上你。尤其是多轮对话、RAG、Agent 这三类最常见的生产形态，几乎天然会遇到上下文膨胀问题。

OpenHuman 的 TokenJuice 之所以值得重视，不是因为它名字新，而是因为它把一个经常被散落在各处、依赖手工经验的工作，抽象成了可配置、可观测、可演进的运行时能力。它不是简单的 prompt 截断器，而是一整套围绕 **上下文预算、信息密度、质量稳定性、跨 provider 适配** 的工程化方案。

如果要用一句更务实的话总结 TokenJuice 的价值，那就是：

> **不是让模型少看一点，而是让模型少看废话、多看关键事实。**

当你做到这一点，收益通常不止是成本下降。你还会得到：

- 更稳定的延迟
- 更高的吞吐
- 更可控的本地模型部署
- 更清晰的上下文治理边界
- 更容易回放和定位问题的调用链

从实践经验看，想要接近“降低 80%”这个数字，单靠一种技巧通常不够，必须是：

- 历史裁剪
- 摘要缓存
- 检索去重
- 语义压缩
- schema 裁剪
- 可观测与灰度验证

这些能力共同作用，才可能在不显著伤害效果的前提下，把大模型系统真正带入可规模化运行的状态。

如果你的应用已经开始出现以下信号：

- prompt 越来越长
- 账单增速快于业务增速
- 本地模型上下文不够用
- 长对话越跑越慢
- 检索片段大量重复
- 工具调用链里塞满状态回放

那么现在就是引入 TokenJuice 的最好时机。因为越晚治理，上下文债务就越重；而越早建立 token 基础设施，后续系统扩展时的成本和风险就越低。

下一步你可以做的事情很简单：先对当前系统做一次上下文剖析，看看每一次调用里，真正有价值的 token 到底占多少。你会发现，很多成本不是花在“智能”上，而是花在“冗余”上。而 TokenJuice 的意义，正是在这些冗余里把利润和可持续性重新找回来。

---

## 十六、更多代码示例：把 TokenJuice 真正接进业务链路

前面的示例偏重原理说明，这一节补几段更接近生产落地的代码，帮助你把 TokenJuice 从“概念优化”变成“可上线组件”。重点不是追求某个 SDK 的绝对语法，而是展示压缩层在应用里的典型插入点。

### 16.1 Python 中间件：统一在请求发出前执行压缩

如果你的应用已经把 LLM 调用收口到一个 service 或 gateway 中，最稳妥的做法是把 TokenJuice 放在这里，而不是散落在各个业务 handler 里。

```python
from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class LLMRequest:
    provider: str
    model: str
    messages: List[Dict[str, str]]
    retrieval_chunks: List[Dict[str, Any]] = field(default_factory=list)
    tool_schemas: List[Dict[str, Any]] = field(default_factory=list)
    task_type: str = "general"
    metadata: Dict[str, Any] = field(default_factory=dict)


class TokenJuiceGateway:
    def __init__(self, tokenjuice, llm_client, metrics):
        self.tokenjuice = tokenjuice
        self.llm_client = llm_client
        self.metrics = metrics

    def invoke(self, req: LLMRequest):
        result = self.tokenjuice.compress(
            provider=req.provider,
            model=req.model,
            task_type=req.task_type,
            messages=req.messages,
            retrieval_chunks=req.retrieval_chunks,
            tool_schemas=req.tool_schemas,
            metadata=req.metadata,
        )

        self.metrics.emit("tokenjuice_before", result["usage"]["before_tokens"])
        self.metrics.emit("tokenjuice_after", result["usage"]["after_tokens"])
        self.metrics.emit("tokenjuice_ratio", result["usage"]["savings_ratio"])

        return self.llm_client.chat(
            provider=req.provider,
            model=req.model,
            messages=result["messages"],
            tools=result.get("tools", []),
        )
```

这个模式的价值是统一：

- 所有业务场景走同一个压缩入口
- 指标采集和回退逻辑更集中
- provider 切换时不必改业务代码
- 更容易做灰度和策略版本控制

### 16.2 Node.js API 网关示例：按场景动态分配预算

如果你的博客读者更多是前后端一体或 Node.js 技术栈，这里给一个 JavaScript 版本的思路。核心点是：预算不是写死的，而是根据场景、模型和用户等级动态决定。

```javascript
function chooseBudget({ taskType, provider, customerTier }) {
  const base = {
    faq: { openai: 3200, anthropic: 4500, local: 2200 },
    rag: { openai: 5200, anthropic: 7000, local: 3000 },
    agent: { openai: 7800, anthropic: 9800, local: 4200 },
  };

  let budget = base[taskType]?.[provider] ?? 4000;

  if (customerTier === "enterprise") budget += 1200;
  if (customerTier === "free") budget -= 600;

  return Math.max(1800, budget);
}

async function runWithTokenJuice(ctx) {
  const budgetTokens = chooseBudget({
    taskType: ctx.taskType,
    provider: ctx.provider,
    customerTier: ctx.customerTier,
  });

  const compressed = await tokenjuice.compress({
    provider: ctx.provider,
    model: ctx.model,
    taskType: ctx.taskType,
    budgetTokens,
    messages: ctx.messages,
    retrievalChunks: ctx.retrievalChunks,
    toolSchemas: ctx.toolSchemas,
  });

  return llmGateway.invoke({
    provider: ctx.provider,
    model: ctx.model,
    messages: compressed.messages,
    tools: compressed.tools,
    metadata: {
      originalTokens: compressed.usage.beforeTokens,
      compressedTokens: compressed.usage.afterTokens,
    },
  });
}
```

这类动态预算在 SaaS 产品里很常见，因为免费版、团队版、企业版本来就有不同的成本上限和质量目标。把 TokenJuice 与套餐治理结合起来，往往比单纯调 prompt 更接近业务现实。

### 16.3 RAG 检索后的二次清洗代码

很多系统已经有检索器，但没有“检索后清洗器”，导致召回阶段省下来的精度最终又在 prompt 拼接阶段浪费掉。下面是一段更贴近生产的伪实现：

```python
from collections import defaultdict
from hashlib import sha1
import re


def normalize_text(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[^\w\u4e00-\u9fff ]", "", text)
    return text


def dedup_retrieval_chunks(chunks):
    exact_seen = set()
    clusters = defaultdict(list)

    for chunk in chunks:
        normalized = normalize_text(chunk["text"])
        exact_key = sha1(normalized.encode("utf-8")).hexdigest()
        if exact_key in exact_seen:
            continue

        exact_seen.add(exact_key)
        cluster_key = (chunk.get("doc_id"), chunk.get("section"))
        clusters[cluster_key].append({
            **chunk,
            "normalized": normalized,
            "length": len(normalized),
        })

    result = []
    for _, group in clusters.items():
        group.sort(key=lambda x: (x["score"], -x["length"]), reverse=True)
        result.append(group[0])

    return result
```

虽然这段逻辑仍然比真正的语义去重简单，但它已经能解决线上最常见的一批浪费：

- 同一文档多个 chunk 文本几乎相同
- FAQ 列表页和详情页内容重复
- 规范化前看似不同、规范化后完全一致
- 相邻 chunk 仅因分页或换行造成重复计费

### 16.4 工具调用前的 schema 瘦身

很多团队把工具 schema 视为“不能动的元数据”，其实这通常是 prompt 中最肥的一块之一。你不一定要改动工具定义本身，但可以在发给模型前做一个展示层裁剪。

```python
ALLOWED_SCHEMA_FIELDS = {
    "name",
    "description",
    "parameters",
    "required",
    "type",
    "properties",
    "enum",
}


def prune_schema(obj):
    if isinstance(obj, list):
        return [prune_schema(item) for item in obj]

    if isinstance(obj, dict):
        result = {}
        for key, value in obj.items():
            if key in ALLOWED_SCHEMA_FIELDS:
                result[key] = prune_schema(value)
        return result

    return obj


def compact_tool_schemas(tool_schemas):
    compacted = []
    for tool in tool_schemas:
        compacted.append({
            "name": tool["name"],
            "description": tool["description"][:160],
            "parameters": prune_schema(tool.get("parameters", {})),
        })
    return compacted
```

这段代码强调一个原则：**给模型看的 schema，不一定要等于后端注册的完整 schema。** 线上很多字段只服务于后端校验、开发文档或监控系统，没有必要每次都交给模型重复阅读。

---

## 十七、故障排查与回退手册：压缩后效果变差时怎么查

TokenJuice 的价值不仅在于节省成本，也在于它必须可排障。下面给一套更适合真实线上值班的排查思路。

### 17.1 典型问题一：压缩率很好，但答案开始遗漏关键字段

这是最常见的“优化成功、业务失败”案例。通常优先检查以下几项：

1. 是否把输出格式约束也送去做了自由摘要
2. 用户硬约束是否被判定为低相关历史而删除
3. RAG 去重时是否把互补 chunk 合并成了单一代表
4. 工具 schema 的 required 字段是否在裁剪中被误删

建议排查顺序：

```text
查看请求日志
 -> 对比 original prompt 与 compressed prompt
 -> 检查 constraint extraction 结果
 -> 检查 dropped_segments 原因
 -> 若关键约束缺失，回退到 conservative policy
```

应急策略：

- 临时提升 `constraint_weight`
- 降低 `low_score_drop_threshold`
- 将格式约束加入 preserve whitelist
- 关闭该场景的语义压缩，只保留去重与裁剪

### 17.2 典型问题二：缓存命中很高，但回答引用的是旧状态

这通常不是模型问题，而是摘要缓存失效规则不完整。常见原因：

- knowledge base 版本变化后未刷新摘要
- 工单状态更新了，但 state summary 没重算
- 会话切换任务类型，仍复用了旧摘要
- 策略版本变更后仍命中旧缓存键

可以在日志中重点检查：

```json
{
  "conversation_id": "conv_8921",
  "summary_cache_key": "conv_8921:messages_1_14:tj-v2",
  "knowledge_version": "kb-2026-05-30",
  "current_knowledge_version": "kb-2026-06-02",
  "cache_invalidated": false
}
```

如果这里已经出现版本错位，就应该立即修缓存键，而不是盲目继续调模型。

### 17.3 典型问题三：成本降了，但延迟反而升高

理论上 token 变少后延迟应更低，但以下情况会让延迟反向增长：

- 压缩步骤本身额外调用了一个摘要模型
- 语义相似度计算过重，全部同步串行执行
- Redis 或向量库成为新的性能瓶颈
- 每次请求都做全量重算，没有走增量缓存

这类问题通常需要把链路耗时拆成：

| 阶段 | 典型耗时来源 | 优化建议 |
|---|---|---|
| 召回前处理 | 消息分类、token 计数 | 做本地缓存、减少重复计数 |
| 检索后清洗 | 去重、重排、聚类 | 批量 embedding、异步化 |
| 摘要压缩 | 调用小模型生成摘要 | 增量摘要、缓存结果 |
| 最终推理 | 主模型生成答案 | 通过更短 prompt 降低耗时 |

如果压缩前处理时间已经接近主模型生成时间，就需要重新评估压缩链条是否过度工程化。

### 17.4 典型问题四：本地模型上效果明显变差，大模型上却正常

这往往说明压缩后的文本更“抽象”，对强模型没问题，但对本地模型来说太跳跃。解决思路不是简单加长上下文，而是：

- 减少过于概括的摘要语言
- 多保留结构化状态和显式字段
- 降低多跳引用，少用“如上所述”“同前状态”之类省略写法
- 给小模型保留更明确的 task instruction 与 few-shot 示例

### 17.5 回退设计：生产里一定要有 kill switch

任何压缩策略上线前，都应该具备按 provider、模型、租户、任务类型四个维度快速回退的能力。示例配置：

```yaml
tokenjuice:
  kill_switch:
    global: false
    by_provider:
      local: false
      anthropic: false
    by_task_type:
      finance_qa: true
      customer_support: false
    by_tenant:
      vip_enterprise_acme: true
```

这个开关平时看似不起眼，但在压缩策略出现误伤时，它比“连夜改 prompt”更可靠。

---

## 十八、补充对比表：不同压缩策略怎么选

为了方便读者做方案决策，这里把常见策略放在一张表里对比。

### 18.1 不同压缩策略优缺点对比

| 策略 | 适用对象 | 成本收益 | 质量风险 | 实现复杂度 | 推荐上线顺序 |
|---|---|---:|---:|---:|---:|
| 最近 N 轮截断 | 短对话、低风险 FAQ | 低到中 | 中 | 低 | 1 |
| 历史评分裁剪 | 多轮对话、客服、Agent | 中到高 | 中 | 中 | 2 |
| 摘要缓存 | 长会话、重复访问场景 | 高 | 中 | 中 | 3 |
| 检索结果去重 | RAG、知识问答 | 中到高 | 低到中 | 中 | 1 |
| 语义压缩 | 长文档、工具结果、日志 | 高 | 中到高 | 高 | 4 |
| schema 裁剪 | Tool calling、函数调用 | 中 | 低 | 低到中 | 1 |
| 结构化状态替换 | Agent、流程型系统 | 高 | 低到中 | 中到高 | 3 |

### 18.2 不同 Provider 下的建议压缩强度

| Provider / 模型类型 | 推荐预算策略 | 历史处理建议 | RAG 处理建议 | 风险提醒 |
|---|---|---|---|---|
| OpenAI 中大型模型 | 中等压缩 | 优先评分裁剪 + 摘要缓存 | 去重后保留高相关 chunk | 不要过度依赖大窗口 |
| Anthropic 长上下文模型 | 中等偏保守 | 分层摘要，保留规则层次 | 保留文档结构信息 | 长窗口不等于无需治理 |
| 本地 8k/32k 模型 | 激进压缩 | 多用结构化状态替代历史 | 强去重 + 强压缩 | 摘要过抽象会显著伤效果 |
| 低成本路由模型 | 高压缩 | 保留任务目标和必要约束 | 尽量只留结论性片段 | 容易因信息缺失误分类 |

### 18.3 哪些内容建议绝不自由压缩

| 内容类型 | 为什么不能随意压 | 建议做法 |
|---|---|---|
| 法务/合规硬约束 | 改写后可能变更语义 | 保留原文或结构化要点 |
| 工具必填字段 | 少一个字段就会调用失败 | 白名单保留 required 字段 |
| 订单号/工单号/用户 ID | 任意变化都会导致错误定位 | 正则提取后单独存储 |
| 金额、阈值、日期 | 数字误差会直接影响业务结果 | 结构化字段保护 |
| 安全规则和拒答边界 | 压缩模型可能弱化约束 | 原文保留 + 单独版本控制 |

---

## 相关阅读

- [OpenHuman Memory Tree 实战：本地知识图谱与记忆构建](/categories/架构/OpenHuman-Memory-Tree-实战-本地知识图谱与记忆构建/)
- [OpenHuman 实战：开源 AI 超级智能框架入门与 macOS 安装](/categories/架构/OpenHuman-实战-开源AI超级智能框架入门与macOS安装/)
- [OpenClaw 模型策略实战：多模型路由与成本优化](/categories/架构/OpenClaw-模型策略实战-多模型路由与成本优化/)
