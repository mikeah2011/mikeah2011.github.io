---
title: AI Agent 客服系统实战：多轮对话、知识库检索、工单流转
description: 后端视角拆解 AI Agent 客服系统：多轮对话状态管理、RAG 知识库检索与混合召回重排、工单状态机流转与 SLA 自动分配，含 Python 代码示例与九大生产踩坑经验。
date: 2026-06-02 00:00:00
tags: [AI Agent, 客服系统, 多轮对话, RAG, 工单系统]
keywords: [AI Agent, 客服系统实战, 多轮对话, 知识库检索, 工单流转, AI]
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---


# AI Agent 客服系统实战：多轮对话、知识库检索、工单流转

很多团队在做 AI Agent 客服系统时，第一反应往往是：接一个大模型，配一个知识库，再加个工单系统，不就齐活了吗？真正落地后才会发现，Demo 跑通和生产可用之间隔着一条很深的沟。用户一句“还是不对”，到底要不要回溯上下文？用户说“帮我查一下昨天那个单子”，系统要怎么把“昨天”“那个单子”解析成明确参数？知识库命中了三篇高度相似但版本不同的 SOP，回答应该引用哪一篇？机器人回答失败后，什么时候转人工，转给谁，SLA 怎么算，人工处理后又怎么反哺机器人？

这篇文章不是介绍“AI 客服是什么”，也不是泛泛而谈 Agent 框架选型，而是从后端工程师真正要落地的视角，系统拆解一个 AI Agent 客服系统的核心能力：多轮对话管理、知识库检索、工单流转，以及这些能力如何在同一套架构里协同工作。文章面向有实际开发经验的后端工程师，我会尽量用工程语言，而不是营销语言来讨论问题。

全文将围绕下面五个部分展开：

1. 客服系统整体架构设计
2. 多轮对话管理：上下文维护、意图识别、槽位填充
3. 知识库检索：向量搜索、RAG pipeline、chunking 策略
4. 工单流转：状态机、SLA、自动分配
5. 真实踩坑记录与解决方案

如果你已经做过传统 IM 客服、工单系统、FAQ 知识库，或者做过 RAG、LLM 应用，那么这篇文章的重点不是"概念扫盲"，而是"怎么把这些东西拼起来，并让它在生产环境里不失控"。

<!-- more -->

---

## 一、为什么 AI Agent 客服不是“LLM + FAQ”这么简单

先说一个结论：**AI Agent 客服系统本质上是一个带有对话编排、知识检索、流程执行、服务降级和闭环反馈能力的业务操作系统**。它当然会使用 LLM，但 LLM 只是其中一个能力组件，而不是系统本身。

一个真实的客服问题通常具有以下特点：

- 用户表达不完整，信息分散在多轮对话中；
- 问题不一定是 FAQ，可能是账户、订单、物流、发票、退款等结构化业务查询；
- 同一个问题既需要查知识库，又需要查业务系统；
- 机器人不一定一次答对，需要澄清、追问、确认；
- 机器人解决不了时，必须转人工，而且上下文不能丢；
- 人工处理完成后，系统要能沉淀知识、优化策略、修正检索。

所以，一个成熟系统里至少有四条主链路：

1. **会话链路**：接消息、识别用户、维护上下文、生成回复；
2. **知识链路**：文档采集、切片、向量化、召回、重排、生成；
3. **业务链路**：调用订单、账户、物流、支付等领域服务；
4. **工单链路**：升级、分配、处理、回访、闭环。

而很多失败项目，本质上是只做了第一层表面能力：给模型塞一点知识，然后希望它自动搞定所有事情。结果就是：

- FAQ 问题答得像模像样；
- 一进入多轮追问场景，马上上下文错乱；
- 一涉及结构化数据，就开始“合理想象”；
- 一需要转人工，工单字段残缺，客服坐席还得重新问一遍；
- 最终用户觉得“机器人很聪明，但不解决问题”。

这也是为什么后端工程师在做 AI 客服时，不能只盯着 prompt 和模型参数，而要像设计一个高并发业务系统一样，关注状态、边界、依赖、幂等、可观测性和回退机制。

---

## 二、整体架构设计：从消息入口到工单闭环

### 2.1 分层视角：不要让大模型直接面对所有复杂性

我更推荐把 AI Agent 客服拆成下面几层：

1. **渠道接入层**：Web、App、公众号、企业微信、WhatsApp、邮件等；
2. **会话编排层**：会话状态机、上下文聚合、意图路由、任务编排；
3. **能力执行层**：LLM 调用、RAG 检索、工具调用、业务 API 调用；
4. **业务流程层**：退款、退货、补发、改地址、开票、投诉、升级工单；
5. **工单与运营层**：坐席工作台、工单系统、SLA 监控、报表、质检、反馈学习。

这个分层的关键思想是：

- **LLM 只负责它擅长的部分**，比如语义理解、文本生成、弱结构提取；
- **确定性逻辑必须回到传统后端系统**，比如权限校验、状态变更、SLA 计时、工单状态流转；
- **复杂业务流程不要只靠 prompt 约束**，而要通过编排层和状态机显式表达。

### 2.2 一个可落地的服务划分

如果团队规模中等，我会建议采用下面这种微服务或模块划分：

- `gateway-service`：统一接收来自各渠道的消息和事件；
- `conversation-service`：负责会话生命周期、上下文存储、多轮状态；
- `agent-orchestrator`：负责任务编排、意图路由、工具调用决策；
- `knowledge-service`：文档入库、切片、embedding、检索、重排；
- `ticket-service`：工单创建、流转、状态机、SLA 计时；
- `assignment-service`：基于技能组、负载、优先级做自动分配；
- `crm/oms/invoice adapters`：对接账户、订单、支付、物流、发票等业务系统；
- `observability-service`：日志、埋点、对话质检、召回分析、成本统计。

其中最容易被低估的是 `conversation-service` 和 `agent-orchestrator`。很多团队把会话上下文直接塞 Redis，然后每轮请求把最近 10 条消息拼到 prompt 里，这个阶段看似简单，但一旦业务复杂起来，问题会集中爆发：

- token 成本越来越高；
- 历史上下文中有大量无效信息；
- 用户切换话题后，旧槽位污染新任务；
- 模型把旧结论当成当前事实；
- 人工接入后与机器人状态不一致。

所以，会话系统不是“消息列表存储”这么简单，而是一套“状态、记忆、任务、事件”的聚合系统。

### 2.3 核心数据模型

落地时建议至少定义以下几个核心实体：

#### 1）Session

表示一个会话实例，常见字段包括：

- `session_id`
- `user_id`
- `channel`
- `status`：active / waiting_user / waiting_system / escalated / closed
- `current_intent`
- `current_task_id`
- `assigned_agent_id`
- `last_message_at`
- `language`
- `metadata`

#### 2）Message

存储原始消息和系统生成消息：

- `message_id`
- `session_id`
- `role`：user / assistant / system / human_agent / tool
- `content`
- `message_type`：text / image / event / card / transfer_notice
- `trace_id`
- `created_at`

#### 3）ConversationState

这是多轮对话的关键，不建议全部寄托于 message history：

- `session_id`
- `intent_name`
- `intent_confidence`
- `slots`：JSON，保存已提取槽位
- `missing_slots`
- `dialog_stage`：clarifying / confirming / executing / done / failed
- `context_summary`
- `last_tool_results`
- `version`

#### 4）KnowledgeDocument / Chunk

知识库至少要分文档层和切片层：

- 文档层保存来源、版本、标签、发布时间、失效时间；
- chunk 层保存 chunk 文本、embedding、heading path、token 长度、语义标签。

#### 5）Ticket

- `ticket_id`
- `source_session_id`
- `category`
- `priority`
- `status`
- `sla_policy_id`
- `assignee_id`
- `skill_group`
- `snapshot_context`
- `created_at`
- `first_response_deadline`
- `resolve_deadline`

你会发现，这套模型本质上把“消息”和“状态”分开了。**消息是事实流，状态是系统对事实的解释**。这一步非常重要，因为后面意图识别、槽位填充、工单创建、人工介入，几乎都依赖这个分层。

### 2.4 典型请求链路

一个比较完整的请求处理链路可以是：

1. 渠道消息进入 `gateway-service`；
2. 进行用户身份映射、风控校验、幂等去重；
3. 写入 `Message`；
4. `conversation-service` 拉取当前 `ConversationState`；
5. `agent-orchestrator` 进行意图识别和任务路由；
6. 若是知识问答，走 `knowledge-service` 做 RAG；
7. 若是业务办理，调用相应领域 API；
8. 若信息不足，进入澄清/槽位填充流程；
9. 若置信度不足或用户不满意，触发转人工或建工单；
10. 最终消息写回，并更新会话状态、埋点、监控指标。

### 2.5 架构上的几个原则

#### 原则一：回复生成和流程执行要解耦

模型说“我已经帮您提交退款申请”，并不等于退款申请真的提交成功。后端必须先执行真实流程，再由模型基于结果生成语言层回复。否则就会出现“嘴上成功，系统没办”的事故。

#### 原则二：所有工具调用都要有可追踪的结构化结果

不要让模型只返回一段自然语言。建议工具调用统一产出：

- `tool_name`
- `input`
- `output`
- `status`
- `latency_ms`
- `error_code`

这样后面才能做诊断、回放、灰度和质量分析。

#### 原则三：上下文不是越多越好，而是越相关越好

后面讲多轮对话会详细展开，但这里先给结论：把全量历史硬塞给 LLM，通常不是最优解。应该把上下文拆成：

- 当前任务上下文；
- 用户长期画像；
- 近期关键事件摘要；
- 当前轮检索证据；
- 结构化业务数据。

#### 原则四：人工接管不是异常分支，而是标准闭环的一部分

很多系统把“转人工”当失败处理，这会导致工单信息残缺、上下文断裂、机器人与坐席协同极差。更合理的方式是：**机器人和人工共用同一套会话上下文与工单主线**。

---

## 三、多轮对话管理：让系统真的“记住并理解”用户

多轮对话是 AI 客服系统从“高级 FAQ”升级为“可办事系统”的分水岭。真正的难点不在于记住多少轮消息，而在于：**如何在多轮交互中持续维护一个正确的任务状态**。

### 3.1 多轮对话到底在管理什么

从工程角度看，多轮对话管理至少要维护四类信息：

1. **语义上下文**：用户之前说过什么；
2. **任务上下文**：当前在解决什么问题；
3. **结构化状态**：已经拿到哪些参数，还缺什么；
4. **执行上下文**：已经调用过哪些工具，得到什么结果。

很多实现失败，是因为它们只维护第一类，也就是纯消息历史，而忽略了后面三类。

例如下面这段对话：

> 用户：我想开电子发票。
>
> 机器人：好的，请问您需要哪一笔订单的发票？
>
> 用户：昨天买会员那单。
>
> 机器人：请提供开票抬头。
>
> 用户：还是上次那个公司名。

这时候系统要完成的不是简单接话，而是把如下状态维护起来：

- intent = `invoice.create`
- order_time = `昨天`
- order_hint = `买会员`
- invoice_type = `电子发票`
- title = `沿用历史抬头`
- missing_slots = `tax_number`? `email`? `title_id`?

如果系统只有消息历史，没有显式的结构化状态，那么每一轮都要靠模型重新“读懂上下文”，一旦模型在某轮偏移，后面就会连续出错。

### 3.2 上下文维护：短期记忆、长期记忆、任务记忆分层

一个比较实用的设计是三层记忆：

#### 1）短期记忆：最近若干轮对话

作用：保留语气、指代、近距离引用。

常见实现：

- 最近 6~20 条消息原文；
- 按 token 上限动态裁剪；
- 保留 system/tool/human_agent 关键事件。

短期记忆适合处理“这个”“那个”“还是不对”“上一单”等弱指代。

#### 2）任务记忆：当前任务状态快照

这是最重要的一层。保存当前意图、槽位、缺失信息、执行阶段、最近一次工具结果等。模型即使不看全量历史，只看这份状态，也应该能知道当前进行到哪一步。

示例：

```json
{
  "intent": "refund.query_status",
  "stage": "clarifying_order",
  "slots": {
    "order_id": null,
    "order_time": "2026-06-01",
    "product_name": "年度会员"
  },
  "missing_slots": ["order_id"],
  "last_tool_result": null,
  "user_sentiment": "neutral"
}
```

#### 3）长期记忆：用户稳定信息和偏好

比如：

- 常用手机号、邮箱；
- 默认语言；
- 常见业务类型；
- 历史发票抬头；
- 黑白名单标签；
- VIP 等级。

注意：长期记忆一定要谨慎写入，不要把模型猜出来的信息直接固化。建议只写入可验证或用户确认过的信息。

#### 三种记忆方案对比

| 维度 | 纯消息历史 | 结构化状态 + 消息历史 | 三层记忆（短期 + 任务 + 长期） |
| --- | --- | --- | --- |
| 实现复杂度 | 最低，直接存 Redis List | 中等，需维护状态机 | 较高，需多层存储和同步机制 |
| 多轮准确性 | 差，靠模型自行理解上下文 | 好，槽位和阶段显式管理 | 最好，分层聚合减少噪音 |
| token 成本 | 高，历史越长成本越高 | 中，只传状态摘要 + 最近消息 | 低，按需组装最小上下文 |
| 话题切换处理 | 差，旧话题污染新话题 | 中，需手动清理槽位 | 好，任务隔离 + suspended 状态 |
| 人工接管体验 | 差，只传原始聊天记录 | 好，传结构化 snapshot_context | 最好，含长期画像和历史决策 |
| 适用场景 | 简单 FAQ 机器人 | 大多数生产客服系统 | 大型多业务线客服平台 |

**选型建议**：如果你的客服系统只是回答高频问题，纯消息历史加 LLM 就够用；一旦涉及业务办理、多轮槽位填充、人工接管，就必须上结构化状态；如果你的系统要服务多条业务线、支持 VIP 差异化策略、需要长期用户画像，三层记忆是值得投入的架构。

### 3.3 上下文压缩：什么时候该总结，什么时候不该总结

对话一长，就要做压缩，不然 token 成本和噪音都会快速上升。但压缩策略非常容易出问题。

我比较推荐的做法是：

- **保留最近几轮原文**，因为短距离依赖很强；
- **对更早历史做结构化摘要**，提取任务、结论、未决事项；
- **重要系统事件永不丢**，比如人工介入、工单创建、退款失败原因；
- **摘要要分事实与推断**，避免模型把推断当既定事实。

错误示例：

> 历史总结：用户已确认退款。

但真实情况可能只是：

> 用户说“那你先帮我看一下能不能退”。

这不是确认退款申请，而只是表达意愿。压缩过程中如果过度抽象，后面执行就会误操作。

因此，摘要建议采用如下结构：

```json
{
  "confirmed_facts": [
    "用户咨询订单退款进度",
    "订单时间为 2026-06-01",
    "商品为年度会员"
  ],
  "unconfirmed_inferences": [
    "疑似指向订单 A12345，但用户未明确确认"
  ],
  "pending_actions": [
    "需要用户确认订单号或从候选订单中选择"
  ]
}
```

下面这段代码展示一个可落地的上下文压缩实现，保留最近 N 轮原文，对更早历史做结构化摘要：

```python
async def compress_context(
    messages: list[dict],
    current_state: "ConversationState",
    llm_client,
    keep_recent: int = 6,
) -> dict:
    """对话上下文压缩：保留最近 N 轮原文，对更早历史做结构化摘要"""
    if len(messages) <= keep_recent:
        return {"recent_messages": messages, "history_summary": None}

    recent = messages[-keep_recent:]
    older = messages[:-keep_recent]

    # 构建压缩 prompt，要求区分事实与推断
    history_text = "\n".join(
        f"[{m['role']}] {m['content']}" for m in older
    )
    summary_prompt = f"""请对以下客服对话历史做结构化摘要，严格区分已确认事实和未确认推断。

对话历史：
{history_text}

当前任务状态：intent={current_state.intent}, slots={current_state.slots}

请输出 JSON 格式：
{{
  "confirmed_facts": ["已确认的事实列表"],
  "unconfirmed_inferences": ["需要进一步确认的推断"],
  "pending_actions": ["待处理事项"],
  "key_decisions": ["已做出的关键决策"]
}}"""

    summary = await llm_client.generate(summary_prompt)
    return {
        "recent_messages": recent,
        "history_summary": summary,
    }
```

这段代码的关键设计：（1）始终保留最近几轮原文，因为短距离依赖对指代消解和语气理解很重要；（2）对更早历史用 LLM 做结构化摘要而非全文拼接，大幅降低 token 成本；（3）摘要要求区分 `confirmed_facts` 和 `unconfirmed_inferences`，避免模型把推断当既定事实导致后续执行出错。

### 3.4 意图识别：不要幻想一次分类永远正确

AI 客服里的意图识别，不是一个静态分类任务，而是一个随着对话推进不断修正的过程。

#### 常见做法

1. **一级路由**：先区分知识问答、业务查询、业务办理、投诉建议、闲聊；
2. **二级意图**：如退款申请、物流查询、发票开具、账户异常；
3. **动态修正**：后续轮次根据新信息更新意图。

例如：

> 用户：我的订单有问题。

这句话初始只能识别到一个宽泛意图：`order.issue`。

后面继续：

> 用户：商品已经退回了，钱怎么还没到账？

这时应将意图修正为：`refund.query_status`。

如果你在第一轮就强行打死到一个细分类，并让整个流程绑定它，后面往往会错得越来越远。

### 3.5 意图识别的工程策略

#### 策略一：分层分类，不要一次性做超细粒度标签

一次识别上百个意图标签，离线准确率也许不低，但线上稳定性往往很差。更稳妥的是：

- 第一步识别领域：订单 / 退款 / 发票 / 账户 / 物流；
- 第二步识别动作：查询 / 修改 / 申请 / 取消；
- 第三步结合槽位和上下文，推导最终流程。

#### 策略二：低置信度时优先澄清，而不是猜

工程上要给意图打置信度门槛。

- 高置信度：直接进入流程；
- 中置信度：简短确认；
- 低置信度：给出可选项或追问。

比如：

> 您是想查询退款进度，还是想发起退款申请？

这句话虽然多了一轮，但比走错流程成本低得多。

#### 策略三：引入规则和业务信号纠偏

纯 LLM 意图识别并不总靠谱。实践里建议融合：

- 关键词规则；
- 页面来源（用户从订单详情页点进来）；
- 上下文事件（刚刚点击“申请售后”）；
- 用户身份（企业客户更可能问发票与合同）；
- 历史近期行为。

很多情况下，页面来源信息的价值比用户文本还高。

### 3.6 槽位填充：多轮对话的核心执行机制

槽位填充可以理解为：为了完成某个任务，系统需要逐步收集和确认必要参数。

以“开具发票”为例，可能需要以下槽位：

- 订单号
- 发票类型
- 抬头类型（个人/企业）
- 抬头名称
- 税号
- 接收邮箱

#### 关键点一：槽位不是一轮一问，而是 opportunistic filling

用户可能一句话里提供多个参数：

> 给我把昨天那个会员订单开成企业电子发票，抬头是上海某某科技，税号 9131xxxx，发到财务邮箱。

系统应该一次提取多个槽位，而不是机械地逐项追问。

#### 关键点二：槽位要有来源和置信度

不要只记录值，还要记录它从哪里来：

```json
{
  "invoice_title": {
    "value": "上海某某科技有限公司",
    "source": "user_message",
    "confidence": 0.98,
    "confirmed": true
  }
}
```

如果值来自历史记忆或模型推断，而不是用户明确输入，就不要默认 `confirmed=true`。

#### 关键点三：区分必填槽位和可选槽位

很多系统体验差，是因为把所有字段都问一遍。实际上应该区分：

- 执行流程必须字段；
- 可从系统自动补全的字段；
- 可选增强字段。

例如订单号，如果用户已从订单详情页进入，就可以直接带出；邮箱若用户账户里已有默认邮箱，也可以先确认而不是重填。

### 3.7 槽位冲突与回滚

真实用户会改口，会打断，会插入新信息，因此槽位填充不能是单向过程。

例如：

> 用户：帮我查订单 123 的物流。
>
> 机器人：好的，订单 123 已发货……
>
> 用户：等等，不是 123，是 128。

这时系统要支持：

- 更新槽位 `order_id=128`；
- 清理基于旧槽位得到的工具结果；
- 重新进入执行阶段；
- 避免把旧订单结果混在新回答里。

工程上可以把每次工具调用与槽位版本绑定：

- `slot_version=7` 时查了订单 123；
- 用户更新槽位后变成 `slot_version=8`；
- 所有 `slot_version=7` 的结果自动失效。

这个机制非常实用，可以大幅减少“旧结果污染当前轮”的问题。

### 3.8 多意图与话题切换

用户不会按照你设计的 happy path 说话。

比如正在查退款进度时，用户突然问：

> 对了，发票什么时候能开？

这是典型的话题切换。处理方式有三种：

1. **主任务挂起，切到子任务**；
2. **提醒当前先完成主任务，再回答新问题**；
3. **识别为附属知识问答，直接快速答复后返回主线**。

关键是不要让两个任务的槽位混在一起。实践中可以为一个 session 挂多个 task，但只允许一个 active task，其余为 suspended。这样既能保留上下文，又不至于状态失控。

### 3.9 对话管理中的可观测性指标

多轮对话如果没有指标，优化基本靠玄学。建议至少监控：

- 平均每次问题解决轮数；
- 澄清问题触发率；
- 槽位一次提取完整率；
- 意图识别修正率；
- 用户重复表述率；
- 转人工率；
- 转人工后人工重新询问率；
- 任务中断率。

其中“人工重新询问率”特别关键。如果机器人转给人工后，人工还得把用户信息重新问一遍，说明前面的会话状态没有有效沉淀。

### 3.10 一个更贴近生产的状态更新伪代码

上面讲了很多原则，下面给一个后端更容易落地的伪代码示例，展示“消息入站 -> 状态更新 -> 决策 -> 执行 -> 回复”的最小闭环：

```python
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ConversationState:
    intent: str | None = None
    stage: str = "understanding"
    slots: dict[str, Any] = field(default_factory=dict)
    missing_slots: list[str] = field(default_factory=list)
    slot_version: int = 0
    last_tool_result: dict[str, Any] | None = None


REQUIRED_SLOTS = {
    "invoice.create": ["order_id", "invoice_type", "title_name", "email"],
    "refund.query_status": ["order_id"],
}


def merge_slots(state: ConversationState, extracted: dict[str, Any]) -> ConversationState:
    changed = False
    for key, value in extracted.items():
        if value is None:
            continue
        if state.slots.get(key) != value:
            state.slots[key] = value
            changed = True
    if changed:
        state.slot_version += 1
        state.last_tool_result = None
    return state


def refresh_missing_slots(state: ConversationState) -> ConversationState:
    required = REQUIRED_SLOTS.get(state.intent or "", [])
    state.missing_slots = [k for k in required if not state.slots.get(k)]
    state.stage = "clarifying" if state.missing_slots else "executing"
    return state


def should_escalate(intent_confidence: float, turns: int, user_angry: bool) -> bool:
    return intent_confidence < 0.45 or turns >= 6 or user_angry
```

这个示例的价值不在于语法，而在于它表达了几个生产上必须坚持的原则：

- 槽位一旦变化，就提升 `slot_version`，并让旧工具结果失效；
- `missing_slots` 不是 prompt 里的隐含概念，而是可持久化状态；
- 升级人工要有明确规则，而不是等模型“感觉不行”再说；
- `stage` 要能驱动后续流程，而不是只做展示字段。

### 3.11 多轮对话里最容易忽略的失败场景对照表

下面这张表适合直接拿去做评审或测试用例设计：

| 场景 | 错误实现 | 正确处理方式 | 线上后果 |
| --- | --- | --- | --- |
| 用户改口 | 沿用旧 `order_id` 继续查 | 提升 `slot_version`，使旧结果失效后重查 | 回答串单，严重时引发投诉 |
| 用户一句话给多个参数 | 仍按单字段逐轮追问 | 一次提取多个槽位并只追问缺失项 | 对话轮次暴涨，用户觉得“很笨” |
| 用户插入新话题 | 把新话题槽位写进当前任务 | 挂起主任务，创建子任务或做快速问答 | 状态污染，后续流程错乱 |
| 低置信度意图 | 强行进入业务办理 | 先澄清或给可选项 | 办错业务，修复成本高 |
| 人工接管 | 只传原始聊天记录 | 传 `snapshot_context` + 工具结果 + 升级原因 | 坐席重复提问，首响变慢 |

---

## 四、知识库检索：RAG 不只是“向量搜一下”

很多团队在 AI 客服中引入知识库时，最常见的误区是：把文档切片、做 embedding、向量检索，然后把 topK 拼给模型，就觉得 RAG 完成了。实际上，**客服场景的知识检索难点不在于“能不能召回”，而在于“召回什么、何时召回、如何让答案可信且可控”**。

### 4.1 客服知识的几种类型

在设计知识库前，先区分知识类型：

1. **静态规则知识**：退货政策、会员权益、发票规则；
2. **操作流程知识**：如何修改地址、如何申请售后；
3. **版本化产品知识**：不同版本功能差异；
4. **时效性公告知识**：系统维护、活动规则、临时政策；
5. **结构化业务知识**：订单状态定义、物流节点含义；
6. **案例型知识**：某类异常问题的处理经验。

不同类型的知识，对切片、召回和排序的要求不一样。比如：

- 静态规则更强调准确引用和版本有效性；
- 操作流程更强调步骤完整性；
- 时效性公告更强调时间过滤；
- 案例型知识更适合语义相似召回。

所以，知识库不能只有一个统一索引就完事，至少在元数据和召回策略上要分层。

### 4.2 一个实用的 RAG Pipeline

在客服场景中，一个可用的 RAG pipeline 通常包含以下步骤：

1. 文档采集与清洗；
2. 文档切片（chunking）；
3. embedding 建立向量索引；
4. 查询理解与改写；
5. 多路召回；
6. 重排；
7. 证据组织；
8. 回答生成；
9. 引用与置信控制；
10. 结果评估与反馈回流。

其中真正影响效果的，往往不是模型本身，而是前六步。

### 4.3 文档治理：脏知识比没知识更危险

如果知识库源头混乱，RAG 的上限会很低。客服知识库最常见的问题包括：

- 同一规则有多个版本；
- PDF/Word 导出后格式错乱；
- 标题和正文层级丢失；
- FAQ 与 SOP 表述冲突；
- 旧公告未失效；
- 一线客服自己整理的文档混入大量口语化经验。

这些问题会导致向量检索召回出“看起来很像，但其实已经过期或不适用”的内容。

所以，知识治理必须做：

- **文档唯一标识与版本号**；
- **生效时间/失效时间**；
- **文档类型标签**；
- **产品/地区/渠道适用范围**；
- **是否权威来源**；
- **是否允许直接对客引用**。

如果没有这些 metadata，后面的重排和过滤基本无从下手。

### 4.4 Chunking 策略：切得不对，后面全错

RAG 实践里最容易被低估的环节就是 chunking。切片不是简单按固定长度截断，而是要兼顾语义完整性、召回粒度和生成可用性。

#### 常见切片策略

##### 1）固定长度切片

例如每 500 token 一段，重叠 50 token。

优点：实现简单，吞吐稳定。

缺点：

- 容易切断完整步骤；
- 标题、表格、注释可能和正文分离；
- 对 FAQ 和 SOP 不友好。

##### 2）按标题层级切片

根据 Markdown/HTML/文档结构，把二级或三级标题作为切片边界。

优点：语义自然，便于保留主题。

缺点：

- 某些章节过长；
- 文档结构不规范时效果差。

##### 3）按问答对或步骤块切片

适用于 FAQ、SOP、操作手册。

例如把“问题+答案”或“步骤 1~4”作为一个 chunk。

优点：对客服场景很友好。

缺点：需要更强的文档解析。

##### 4）混合切片

我在实际项目中更推荐混合策略：

- 先按结构切分；
- 再对过长块做二次分片；
- 为每个 chunk 补充 heading path、前后文摘要、文档 metadata；
- 对表格、列表、流程图做专门转换。

#### 切片策略对比表

下面这张表从多个维度对比常见切片策略，方便你根据实际文档类型做选型：

| 策略 | 原理 | 优点 | 缺点 | 切片成本 | 召回准确度 | 适用文档类型 |
| --- | --- | --- | --- | --- | --- | --- |
| 固定长度切片 | 按 token 数截断，带固定重叠窗口 | 实现简单，吞吐稳定，易于批量处理 | 容易切断语义单元，标题和正文可能分离 | 低 | 中 | 通用长文档、无明确结构的文本 |
| 递归字符切片 | 按分隔符层级递归拆分（段落→句子→字符） | 优先保留自然语义边界，粒度更合理 | 分隔符选择依赖文档格式，嵌套结构处理复杂 | 中 | 中高 | Markdown、HTML、结构化文档 |
| 语义切片 | 用 embedding 计算相邻句子相似度，在语义断裂处切分 | 语义完整性最好，chunk 内聚度高 | 计算开销大，需要预生成 embedding，切片速度慢 | 高 | 高 | 长篇政策文档、案例知识、非结构化文本 |
| 结构化切片 | 按标题层级、FAQ 对、步骤块切分 | 保留文档结构，对客服 FAQ/SOP 友好 | 依赖文档格式规范，格式不统一时退化明显 | 中低 | 高 | FAQ、SOP、操作手册、知识库文档 |
| 混合切片 | 先按结构切分，再对过长块做二次递归/语义分片 | 兼顾结构完整性和粒度控制 | 实现复杂度较高，需要多轮处理 | 中高 | 最高 | 生产环境推荐，适合多类型文档混合的客服知识库 |

**选型建议**：如果你的客服知识库以 FAQ 和 SOP 为主，优先用结构化切片；如果文档格式混乱、长短不一，用递归字符切片做兜底；如果预算充足且对召回精度要求高，语义切片值得投入。生产中我最推荐混合切片——先按结构切，再按长度兜底，最后为每个 chunk 补充 heading path 和 metadata。

### 4.5 Chunk 应该保存哪些额外信息

不要只存 chunk 文本和 embedding。建议还要保存：

- `doc_id`
- `chunk_id`
- `title`
- `heading_path`
- `source_url`
- `doc_version`
- `effective_from` / `effective_to`
- `product_scope`
- `channel_scope`
- `region_scope`
- `chunk_type`：faq / sop / policy / announcement / table
- `keywords`
- `token_count`

这些字段会直接影响后面的过滤和排序质量。

### 4.6 查询理解：用户问法和知识写法往往不是一回事

用户会说：

> 我退的钱怎么还没下来？

知识库里写的是：

> 退款到账时效说明

如果只是拿原始 query 去做向量检索，很多情况下能召回，但不稳定。一个更好的做法是加入查询理解层，把用户问题规范化为适合检索的表达，同时保留原始表达用于最终生成。

查询理解可以做几件事：

- 改写 query，提取标准术语；
- 识别产品、渠道、地区、时效约束；
- 判断是否需要业务系统查数，而不只是查知识；
- 拆分复合问题。

例如：

> 我昨天申请的退款怎么还没到账，是不是失败了？

可以拆成：

- 业务查询子任务：查退款单状态；
- 知识解释子任务：解释“处理中 / 已退款 / 原路退回到账时效”。

这个例子很典型，说明客服不是纯 RAG 问答。很多问题必须“查数据 + 查知识”结合处理。

### 4.7 多路召回：不要只押宝单一向量检索

实际效果更好的方案通常是多路召回融合：

1. **向量召回**：处理语义相似；
2. **关键词/BM25 召回**：处理精确术语、型号、错误码；
3. **metadata 过滤召回**：按产品线、地区、时间范围过滤；
4. **规则直达**：高频 FAQ 直接命中标准答案；
5. **最近更新文档加权**：应对政策变动。

原因很简单：

- 向量检索对语义友好，但对精确字符串不总稳；
- BM25 对关键词很好，但对同义表达弱；
- metadata 过滤可以显著减少脏召回；
- 高频标准问题没必要每次都走完整 RAG。

我的经验是：**客服场景中"混合检索 + 重排"的收益，通常比单纯升级 embedding 模型更明显**。

#### 客服场景 Embedding 模型选型参考

虽然混合检索比单押模型更重要，但 embedding 模型的选择仍然会影响召回质量。下面这张表对比了客服场景中常见的几种 embedding 模型：

| 模型 | 维度 | 中文支持 | 推理速度（ms/query） | 部署方式 | 特点 | 客服场景适配 |
| --- | --- | --- | --- | --- | --- | --- |
| text-embedding-ada-002（OpenAI） | 1536 | 良好 | ~50（API 调用） | 云端 API | 英文表现优秀，中文可用但非最优，成本按 token 计费 | 适合英文为主、预算充足、不想自建部署的团队 |
| bge-large-zh-v1.5（智源 BAAI） | 1024 | 优秀 | ~30（GPU 推理） | 自部署 | 中文语义理解强，开源免费，社区活跃，支持 MTEB 排行榜前列 | 中文客服首选，性价比高，推荐自部署 |
| bge-m3（智源 BAAI） | 1024 | 优秀 | ~35（GPU 推理） | 自部署 | 支持多语言，支持稠密+稀疏+多粒度检索，一个模型兼顾多路召回 | 多语言客服或需要同时做稠密和稀疏检索的场景 |
| text2vec-large-chinese（shibing624） | 1024 | 优秀 | ~25（GPU 推理） | 自部署 | 轻量级中文模型，推理快，显存占用低 | 资源有限、对延迟敏感的场景 |
| m3e-base（moka-ai） | 768 | 良好 | ~20（GPU 推理） | 自部署 | 国产中文模型，体积小，部署简单，适合快速验证 | 快速原型验证，对精度要求不极端的内部系统 |

**选型建议**：中文客服场景优先考虑 bge 系列——bge-large-zh 做纯语义检索，bge-m3 做混合检索（同时输出稠密和稀疏向量）。如果不想自建，OpenAI ada-002 也可以用，但要注意中文表现不如专为中文优化的模型。部署时建议用 ONNX 或 TensorRT 做推理加速，线上 P99 延迟控制在 50ms 以内。

下面这段代码展示如何在知识入库时批量生成 embedding 并存入向量数据库：

```python
import asyncio
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("BAAI/bge-large-zh-v1.5")

async def embed_and_store(chunks: list[dict], vector_store) -> list[str]:
    """批量生成 embedding 并写入向量数据库"""
    texts = [c["text"] for c in chunks]

    # 批量编码，比逐条调用快 5-10 倍
    embeddings = model.encode(texts, batch_size=64, show_progress_bar=True)

    ids = []
    for chunk, emb in zip(chunks, embeddings):
        doc_id = await vector_store.upsert(
            embedding=emb.tolist(),
            metadata={
                "doc_id": chunk["doc_id"],
                "chunk_id": chunk["chunk_id"],
                "heading_path": chunk["heading_path"],
                "doc_version": chunk["doc_version"],
                "effective_from": chunk["effective_from"],
                "effective_to": chunk["effective_to"],
                "chunk_type": chunk["chunk_type"],
            },
        )
        ids.append(doc_id)
    return ids
```

这个示例的关键点：embedding 用批量编码提升吞吐；metadata 在写入时就带上，方便后续过滤和版本管理；不要等检索时再补 metadata，那样容易遗漏。


### 4.8 重排：把“像”变成“适合回答”

topK 召回出来的 chunk，未必都适合最终回答。比如同样是“退款”，一篇讲退款时效，一篇讲退款申请条件，一篇讲促销商品不支持退款。都相关，但不一定回答用户当前问题。

所以要做重排。重排时建议考虑：

- query 与 chunk 语义相关度；
- 文档权威等级；
- 时间有效性；
- 与当前意图/槽位的一致性；
- 是否包含直接答案；
- 是否来自用户当前产品/地区。

一个很实用的策略是把重排分成两步：

1. 机器学习或 reranker 模型算语义分；
2. 业务规则做加权修正。

例如：

- 过期文档直接降权到 0；
- 与当前产品线不匹配直接过滤；
- 官方政策类文档优先于社区经验贴。

### 4.9 证据组织：给模型喂什么，比喂多少更重要

把 topK chunk 全量拼给模型，常常会带来几个问题：

- 证据重复；
- 证据冲突；
- token 浪费；
- 模型被噪音带偏。

更好的做法是先做证据整理：

- 去重合并相似 chunk；
- 同一文档的相邻 chunk 按需拼接；
- 标注每段证据的来源与版本；
- 对冲突证据做优先级选择；
- 限制总 token。

可以给生成模型喂这种结构：

```text
[证据1]
来源：退款政策 V3，生效时间 2026-05-20
摘要：普通商品退款原路退回后，银行到账通常需要 1-5 个工作日。

[证据2]
来源：支付渠道说明
摘要：信用卡退款到账时间可能受发卡行处理影响，最长可延迟至 7 个工作日。
```

这种组织方式，通常比直接贴原始 chunk 更稳定。

### 4.10 生成阶段：回答要“受约束”，不是自由发挥

客服回答最忌讳“语言上很流畅，但事实不准确”。因此生成阶段建议增加约束：

- 仅基于给定证据回答；
- 若证据不足，明确说明并转澄清/转人工；
- 对规则性内容优先引用标准表达；
- 对时效、金额、资格条件等敏感字段要求严格引用。

一个常见实践是区分两类回复模板：

1. **说明型回复**：用于 FAQ、规则解释；
2. **执行型回复**：用于业务办理结果通知。

执行型回复一定要基于真实工具结果，不要让模型自行补细节。

### 4.11 RAG 的失败模式

客服场景里，RAG 常见失败模式包括：

#### 1）召回正确但答案错误

原因通常是生成模型整合证据时发生了幻觉，或把多个 chunk 的条件混在一起。

#### 2）召回了过期文档

这通常是缺少版本/时效过滤。

#### 3）召回相关但不针对当前问题

例如问退款到账，却召回退款申请条件。

#### 4）检索不到，因为用户用口语表达

说明查询理解和同义扩展不够。

#### 5）知识和业务状态冲突

例如知识说“退款通常 1-5 个工作日到账”，但用户这笔退款实际状态还是“审核中”。如果机器人只给时效说明，用户会觉得答非所问。

所以再次强调：**客服中的 RAG 必须和业务查数联动，而不是单独存在**。

### 4.12 RAG 效果评估指标

上线后建议监控：

- 检索命中率；
- top1/top3 召回准确率；
- 引用证据覆盖率；
- 无证据回答率；
- 过期文档命中率；
- 用户追问率；
- 知识问答转人工率；
- 高风险问题误答率。

最好建立人工评测集，覆盖：

- 高流量 FAQ；
- 版本敏感问题；
- 多条件约束问题；
- 模糊口语表达；
- 查数 + 查知识混合问题。

### 4.13 检索编排的参考代码

如果你希望把 RAG 做得更可控，建议把“召回、过滤、重排、证据裁剪”拆开，而不是一次函数调用黑盒到底。下面给一个简化示例：

```python
def retrieve_knowledge(query, metadata, vector_store, bm25_index, reranker):
    dense_hits = vector_store.search(
        query=query,
        top_k=12,
        filters={
            "product_scope": metadata.get("product_scope"),
            "region_scope": metadata.get("region_scope"),
        },
    )

    sparse_hits = bm25_index.search(query=query, top_k=8)

    merged = deduplicate_by_chunk_id([*dense_hits, *sparse_hits])
    filtered = [
        hit for hit in merged
        if hit["effective"] and hit["authority_level"] >= 2
    ]

    ranked = reranker.rank(query=query, documents=filtered)[:5]
    evidence = trim_to_budget(ranked, max_tokens=1200)
    return evidence
```

这段代码背后体现的是四个关键点：

1. 先做多路召回，再去重；
2. 元数据过滤要尽可能前置；
3. 重排前就把过期和低权威内容剔除；
4. 最终送给模型的不是 topK 原样结果，而是经过 token 预算裁剪后的证据集。

### 4.14 常见知识检索方案对比

很多团队在评审时会纠结“到底只做向量检索，还是做混合检索”。下面这张表给一个非常实用的判断框架：

| 方案 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- |
| 纯向量检索 | 对口语化表达和同义句友好 | 对错误码、型号、政策编号不稳定 | FAQ、案例型知识较多 |
| 纯 BM25/关键词检索 | 精确术语命中强、实现简单 | 对自然语言改写和省略表达差 | 错误码、产品型号、短查询 |
| 混合检索 | 兼顾语义和精确匹配，整体鲁棒性高 | 编排复杂度更高，需要重排 | 大多数客服知识库生产场景 |
| 规则直达 + 检索兜底 | 高频问题延迟低、答案一致 | 规则池维护成本上升 | 高频标准 FAQ、强合规答案 |

如果只能给一个建议，那就是：**客服场景优先考虑“规则直达 + 混合检索 + 重排”的组合，而不是单押某一种召回方式。**

---

## 五、工单流转：把“没解决”的问题有序交给人

很多 AI 客服项目最大的误判，是认为“转人工率越低越好”。实际上，真正重要的是：**该机器人解决的高效解决，不该机器人解决的快速、完整、可控地交给人工**。

工单系统不是机器人失败后的垃圾桶，而是整个服务闭环的关键组成部分。

### 5.1 什么情况下应该触发工单或转人工

一般有几类触发条件：

1. **机器人低置信度**：多轮澄清后仍无法确认意图；
2. **缺乏权限**：涉及退款审批、投诉升级、风控申诉等；
3. **高风险场景**：支付异常、账户封禁、法律投诉；
4. **用户显式要求人工**；
5. **知识缺失或工具失败**；
6. **负面情绪持续升级**；
7. **SLA 或业务规则要求必须人工介入**。

这里要避免两个极端：

- 太激进：机器人稍微不确定就转人工，成本高；
- 太保守：用户已经明显不满意，还让机器人反复追问，体验差。

比较好的做法是设计一个综合升级分数，输入包括：

- 意图置信度；
- 槽位完整度；
- 检索证据充分度；
- 工具执行结果；
- 用户情绪；
- 已交互轮数；
- 是否命中高风险标签。

下面这段代码将上述因素量化为一个可配置的升级分数，方便工程落地：

```python
@dataclass
class EscalationSignals:
    intent_confidence: float   # 意图置信度（0~1）
    slot_completeness: float   # 槽位完整度（0~1）
    evidence_sufficiency: float  # 检索证据充分度（0~1）
    tool_success: bool         # 工具是否执行成功
    user_sentiment: str        # positive / neutral / negative / angry
    turn_count: int            # 已交互轮数
    is_high_risk: bool         # 是否命中高风险标签（投诉、法律、支付异常）

SENTIMENT_PENALTY = {"positive": 0, "neutral": 0, "negative": 0.15, "angry": 0.35}

def calculate_escalation_score(sig: EscalationSignals) -> float:
    """综合升级分数：0~1，越高越应该转人工"""
    score = 0.0
    # 意图不明确 → 加分
    score += (1.0 - sig.intent_confidence) * 0.25
    # 槽位不完整 → 加分
    score += (1.0 - sig.slot_completeness) * 0.15
    # 证据不足 → 加分
    score += (1.0 - sig.evidence_sufficiency) * 0.15
    # 工具执行失败 → 加分
    if not sig.tool_success:
        score += 0.15
    # 负面情绪 → 加分
    score += SENTIMENT_PENALTY.get(sig.user_sentiment, 0)
    # 轮次过多 → 加分
    if sig.turn_count >= 4:
        score += min((sig.turn_count - 3) * 0.05, 0.2)
    # 高风险标签 → 直接拉满
    if sig.is_high_risk:
        score = max(score, 0.9)
    return min(score, 1.0)


# 使用示例
sig = EscalationSignals(
    intent_confidence=0.4,
    slot_completeness=0.3,
    evidence_sufficiency=0.5,
    tool_success=False,
    user_sentiment="angry",
    turn_count=5,
    is_high_risk=False,
)
score = calculate_escalation_score(sig)
print(f"升级分数: {score:.2f}")  # 输出约 0.85，应触发转人工
```

这个实现的好处是每个信号的权重可配置、可灰度调整，而不是靠模型"感觉不行了"。高风险标签会直接拉满分数，确保投诉、法律类问题不会被机器人反复尝试。

### 5.2 工单状态机：不要只用一个 status 字段糊弄

工单流转必须用显式状态机管理。常见状态可以包括：

- `new`：新建待分配
- `queued`：已进入队列
- `assigned`：已分配坐席
- `in_progress`：处理中
- `waiting_user`：等待用户补充信息
- `waiting_external`：等待外部系统/供应商
- `resolved`：已解决待确认
- `closed`：已关闭
- `reopened`：重新打开
- `cancelled`：取消

如果业务复杂，还可以加子状态，比如退款审批中、法务处理中、风控复核中。

这里非常重要的一点是：**状态流转要受控**。不是谁都能从任意状态跳到任意状态。应通过状态机规则明确：

- 哪些角色可以触发什么迁移；
- 哪些迁移需要字段校验；
- 哪些迁移会触发通知、SLA 暂停/恢复、回写会话。

下面用一个简单的 Python 示例展示工单状态机的核心逻辑：

```python
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime

class TicketStatus(Enum):
    NEW = "new"
    QUEUED = "queued"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    WAITING_USER = "waiting_user"
    WAITING_EXTERNAL = "waiting_external"
    RESOLVED = "resolved"
    CLOSED = "closed"
    REOPENED = "reopened"

# 合法状态迁移表：key 是当前状态，value 是可迁移到的状态集合
VALID_TRANSITIONS: dict[TicketStatus, set[TicketStatus]] = {
    TicketStatus.NEW:            {TicketStatus.QUEUED, TicketStatus.ASSIGNED},
    TicketStatus.QUEUED:         {TicketStatus.ASSIGNED, TicketStatus.CANCELLED if hasattr(TicketStatus, "CANCELLED") else TicketStatus.CLOSED},
    TicketStatus.ASSIGNED:       {TicketStatus.IN_PROGRESS, TicketStatus.QUEUED},
    TicketStatus.IN_PROGRESS:    {TicketStatus.WAITING_USER, TicketStatus.WAITING_EXTERNAL, TicketStatus.RESOLVED},
    TicketStatus.WAITING_USER:   {TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.CLOSED},
    TicketStatus.WAITING_EXTERNAL:{TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED},
    TicketStatus.RESOLVED:       {TicketStatus.CLOSED, TicketStatus.REOPENED},
    TicketStatus.REOPENED:       {TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS},
    TicketStatus.CLOSED:         set(),  # 终态，不可再流转
}

@dataclass
class Ticket:
    ticket_id: str
    status: TicketStatus = TicketStatus.NEW
    assignee_id: str | None = None
    history: list[dict] = field(default_factory=list)

    def transition(self, new_status: TicketStatus, operator: str, reason: str = "") -> bool:
        """受控状态迁移，校验合法性和必填字段"""
        allowed = VALID_TRANSITIONS.get(self.status, set())
        if new_status not in allowed:
            raise ValueError(
                f"非法迁移：{self.status.value} -> {new_status.value}，"
                f"允许的迁移：{[s.value for s in allowed]}"
            )

        # 分配坐席时必须有 assignee_id
        if new_status == TicketStatus.ASSIGNED and not self.assignee_id:
            raise ValueError("分配工单时必须指定坐席")

        old_status = self.status
        self.status = new_status
        self.history.append({
            "from": old_status.value,
            "to": new_status.value,
            "operator": operator,
            "reason": reason,
            "timestamp": datetime.utcnow().isoformat(),
        })
        return True
```

这个示例体现了三个关键设计：（1）合法迁移用白名单枚举，不是任意跳转；（2）关键状态变更要有必填校验（比如分配必须有坐席）；（3）每次流转都记历史，方便后续审计和 SLA 计算。实际项目中还可以加入异步事件通知、SLA 计时器触发和会话状态回写。


### 5.3 会话与工单的关系

一个常见设计错误是把会话和工单完全割裂。这样会导致：

- 用户在聊天里说的信息没有进入工单；
- 坐席处理工单结果没有回写聊天；
- 用户关闭聊天后工单还在飞；
- 多个工单上下文混乱。

更合理的建模通常是：

- 一个 session 可关联多个 ticket；
- 一个 ticket 有创建时的会话快照；
- ticket 的关键状态变更会回写 session 事件流；
- 人工坐席和机器人共用消息时间线，但角色不同。

这样用户视角是一条连续服务链，而不是被切成两个系统。

### 5.4 工单创建时必须带什么上下文

如果转人工时只把“用户原话”扔给坐席，基本等于前面的机器人白干。创建工单时至少应带：

- 用户基础信息；
- 当前意图和置信度；
- 已收集槽位；
- 关键历史消息摘要；
- 已执行工具及结果；
- 检索命中的知识证据；
- 失败原因或升级原因；
- 用户情绪标签；
- 推荐处理建议。

可以把这份内容做成 `snapshot_context`，固化在工单创建时刻，避免后面 session 继续变化导致上下文漂移。

### 5.5 SLA：不是简单计时，而是服务承诺的编码

工单系统中，SLA 是最容易被说得简单、做得复杂的部分。至少要考虑两个关键时限：

- **首次响应 SLA**：多久内必须有人接单或首次回复；
- **解决 SLA**：多久内必须关闭或给出阶段性处理结果。

在真实业务中，SLA 还受以下因素影响：

- 用户等级；
- 工单优先级；
- 业务类型；
- 工作时间日历；
- 节假日；
- 是否等待用户；
- 是否等待外部供应商。

例如：

- VIP 用户投诉：30 分钟首次响应，4 小时解决；
- 普通发票问题：4 小时首次响应，2 个工作日解决；
- 等待用户补充材料时，解决 SLA 暂停；
- 外部物流反馈超时后，自动升级主管。

所以，SLA 引擎一般至少需要：

- SLA policy 配置；
- 业务日历；
- 暂停/恢复规则；
- 超时预警；
- 升级规则；
- 报表统计。

下面这段代码展示一个可落地的 SLA 引擎核心实现，支持按用户等级×业务类型匹配策略、工作日历计算截止时间、以及暂停/恢复计时：

```python
from datetime import datetime, timedelta
from dataclasses import dataclass

@dataclass
class SLAPolicy:
    first_response_minutes: int
    resolve_hours: int
    pause_on_waiting_user: bool = True
    pause_on_waiting_external: bool = True

# SLA 策略配置：按 用户等级 × 业务类型 匹配
SLA_POLICIES = {
    ("vip", "complaint"): SLAPolicy(first_response_minutes=30, resolve_hours=4),
    ("vip", "refund"):    SLAPolicy(first_response_minutes=30, resolve_hours=8),
    ("normal", "invoice"): SLAPolicy(first_response_minutes=240, resolve_hours=48),
    ("normal", "faq"):    SLAPolicy(first_response_minutes=60, resolve_hours=24),
}


class SLAEngine:
    def __init__(self, business_calendar):
        self.calendar = business_calendar  # 工作日历，处理节假日和非工作时间

    def calculate_deadlines(self, ticket) -> dict:
        """根据用户等级和工单类型计算 SLA 截止时间"""
        policy = SLA_POLICIES.get(
            (ticket.user_tier, ticket.category),
            SLAPolicy(first_response_minutes=120, resolve_hours=24),  # 默认策略
        )
        first_deadline = self.calendar.add_business_minutes(
            ticket.created_at, policy.first_response_minutes
        )
        resolve_deadline = self.calendar.add_business_hours(
            ticket.created_at, policy.resolve_hours
        )
        return {
            "first_response_deadline": first_deadline,
            "resolve_deadline": resolve_deadline,
        }

    def check_violation(self, ticket, now: datetime) -> str | None:
        """检查 SLA 是否违规，返回违规类型或 None"""
        if now > ticket.resolve_deadline:
            return "resolve_violated"
        if ticket.first_responded_at is None and now > ticket.first_response_deadline:
            return "first_response_violated"
        return None

    def effective_elapsed(self, ticket, now: datetime) -> timedelta:
        """计算有效处理时间，排除 waiting_user / waiting_external 暂停时段"""
        total = now - ticket.created_at
        pause_duration = timedelta()
        for pause in ticket.pause_history:
            pause_duration += (pause["end"] - pause["start"])
        return total - pause_duration
```

这段代码体现了三个生产要点：（1）SLA 策略用字典配置而非硬编码，方便运营随时调整；（2）截止时间基于工作日历计算，自动跳过节假日和非工作时段；（3）`effective_elapsed` 排除暂停时段，确保"等待用户补充材料"期间不计入处理时间，这是 SLA 统计准确性的关键。

### 5.6 自动分配：不是随机轮询，而是约束优化问题

客服工单自动分配常见考虑因素有：

- 技能组匹配；
- 当前负载；
- 在线状态；
- 历史处理质量；
- 工单优先级；
- 用户语言；
- 渠道类型；
- 是否需要特定权限。

最简单的轮询分配在小团队还凑合，一旦业务复杂就会出问题：

- 会退款的人被发票单淹没；
- 夜班只有英语坐席在线，但系统把中文投诉单也分过去；
- 某个高绩效坐席因为处理快，反而被不断倾斜更多疑难单，最后 burn out。

更稳妥的做法是先做过滤，再做排序：

1. 根据技能、语言、权限、班次过滤候选人；
2. 按负载、优先级适配度、历史质量分排序；
3. 支持抢单或自动派单混合模式；
4. 超时未接单时重新分配或升级。

### 5.7 自动分配中的负载衡量

不要只看“未关闭工单数”。更合理的负载指标可以是加权值：

- `active_ticket_weight`
- `avg_handle_time`
- `high_priority_ticket_count`
- `waiting_external_ratio`
- `concurrency_cap`

例如一个坐席挂着 10 个 `waiting_user` 的单，不一定比另一个正在处理 3 个高优先级投诉的坐席更忙。

下面这段代码展示一个实用的自动分配实现，核心思路是"先过滤硬性条件，再按加权评分排序"：

```python
@dataclass
class AgentProfile:
    agent_id: str
    skill_groups: list[str]   # 技能组：["refund", "invoice", "complaint"]
    languages: list[str]      # 支持语言：["zh", "en"]
    current_load: int         # 当前活跃工单数（加权）
    max_concurrency: int      # 最大并发工单数
    avg_handle_time: float    # 平均处理时长（分钟）
    quality_score: float      # 历史质量分（0~1）
    is_online: bool


def assign_ticket(ticket, agents: list[AgentProfile]) -> AgentProfile | None:
    """工单自动分配：先过滤硬性条件，再按加权评分排序选最优"""
    # 第一步：硬性条件过滤——技能、语言、在线状态、负载上限
    candidates = [
        a for a in agents
        if a.is_online
        and ticket.skill_group in a.skill_groups
        and ticket.language in a.languages
        and a.current_load < a.max_concurrency
    ]
    if not candidates:
        return None  # 无可用坐席，进入排队等待或自动升级

    # 第二步：加权评分排序
    def score(agent: AgentProfile) -> float:
        load_ratio = 1.0 - (agent.current_load / agent.max_concurrency)
        # 高优先级工单更侧重质量分，普通工单更侧重负载均衡
        quality_weight = 0.6 if ticket.priority == "high" else 0.3
        return (
            load_ratio * 0.4
            + agent.quality_score * quality_weight
            + (1.0 / max(agent.avg_handle_time, 1)) * 0.3
        )

    candidates.sort(key=score, reverse=True)
    return candidates[0]
```

这个实现的关键设计：（1）过滤和排序分离，硬性条件不满足的直接排除，不做无效评分；（2）高优先级工单的评分中质量分权重更高（0.6 vs 0.3），确保疑难单交给高绩效坐席；（3）负载用 `load_ratio`（当前/上限）而非绝对数量，避免不同坐席并发上限不同导致的不公平。实际项目中还可以加入抢单模式、超时未接单自动重分配、以及定期审计分配结果避免隐性倾斜。

### 5.8 工单回流：让人工经验反哺 AI

工单系统和 AI 系统打通的真正价值，不在于“兜底”，而在于“学习”。

可以回流的内容包括：

- 哪类问题频繁转人工；
- 哪些知识文档缺失；
- 哪些回答虽然没转人工，但用户继续追问；
- 人工最终采用了什么标准话术；
- 人工补充了哪些业务判断规则；
- 哪些槽位定义不合理。

实践中我很推荐做两类闭环：

1. **知识闭环**：工单高频问题自动进入知识补录池；
2. **策略闭环**：失败会话进入 prompt / 检索 / 状态机优化队列。

这一步能决定系统是否越用越好，还是一直靠人工救火。

---

## 六、真实踩坑记录与解决方案

下面这部分我会重点讲一些在真实项目里非常常见、但在 PPT 和官方 Demo 里很少提到的问题。

### 坑一：把全部历史消息直接塞给模型，结果越聊越偏

#### 现象

项目初期图省事，把最近 30 条历史消息直接拼到 prompt。短会话还行，一旦对话变长，就开始出现：

- 模型抓住很早之前的旧信息不放；
- 用户换话题后，系统还沿用旧槽位；
- token 成本快速上涨；
- 响应时间变慢。

#### 根因

消息历史不是任务状态。历史里有大量噪音、寒暄、已失效信息和被纠正过的信息。

#### 解决方案

- 保留最近少量原始消息；
- 把任务状态显式结构化保存；
- 对旧历史做摘要，而不是全文拼接；
- 为槽位和工具结果加版本号，用户修正后自动失效旧结果。

#### 收获

这样调整后，模型稳定性和成本都明显改善，尤其是“用户纠正信息后系统仍沿用旧结果”的问题下降很多。

### 坑二：意图识别看起来准确率很高，线上却老走错流程

#### 现象

离线评测里意图识别准确率 90% 以上，但线上用户仍频繁抱怨“你理解错了”。

#### 根因

离线数据大多是单轮、标注清晰的样本；线上则是模糊、口语化、上下文依赖强的表达。而且很多问题本质上不是“分类一次就结束”，而是需要动态澄清。

#### 解决方案

- 意图识别改为分层路由；
- 低置信度时强制澄清；
- 引入页面来源、点击事件、历史行为作为辅助特征；
- 对“高代价误判”意图设置更高门槛。

#### 收获

虽然多了一些澄清轮次，但整体错误办理率明显下降，用户主观感受反而更好。

### 坑三：知识库召回率不低，但答案总是“不对味”

#### 现象

检索 top3 里常常能看到正确文档，但最终回答还是答偏，尤其是在规则细节和边界条件上。

#### 根因

- chunk 粒度不合适；
- 召回来的文档相关但不聚焦；
- 模型在整合多段证据时做了错误泛化；
- 证据里混入了过期文档。

#### 解决方案

- 重新设计 chunking，优先按 FAQ 对、步骤块和标题层级切；
- 引入时效过滤和权威文档优先级；
- 重排阶段加入业务条件；
- 生成阶段要求引用证据，不足则明确说不知道。

#### 收获

不是所有问题都“回答更长”，但答非所问和边界条件答错的情况明显减少。

### 坑四：机器人能答，但一转人工上下文全没了

#### 现象

用户已经跟机器人说了半天，转人工后坐席第一句还是：

> 您好，请问您遇到了什么问题？

这是典型的体验灾难。

#### 根因

机器人系统和工单系统是两套孤立系统，转人工时只传了原始消息，没有传结构化状态、槽位、工具结果和升级原因。

#### 解决方案

创建工单时固化 `snapshot_context`，包含：

- 当前意图；
- 已收集参数；
- 工具查询结果；
- 检索证据；
- 用户情绪；
- 升级原因；
- 建议处理动作。

同时让坐席工作台直接展示这份摘要，而不是要求坐席自己翻聊天记录。

#### 收获

人工首响更快，重复询问明显减少，坐席满意度也会提升。

### 坑五：工单 SLA 统计失真，运营报表和一线感知对不上

#### 现象

报表上看 SLA 达标率不错，但运营团队总说“实际很多单都超时了”。

#### 根因

- 没有区分自然日和工作时间；
- `waiting_user` 状态没有暂停 SLA；
- 工单被重新打开后，时钟没重算；
- 多渠道消息合并不正确，导致首次响应时间被误算。

#### 解决方案

- 引入业务日历；
- 明确不同状态是否暂停计时；
- reopened 流程单独定义 SLA 规则；
- 首次响应以“人工有效响应事件”为准，而不是任意系统消息。

#### 收获

SLA 指标终于能和一线感知对齐，后续自动升级、排班优化才有可信数据基础。

### 坑六：自动分配看似公平，实际上不断制造新瓶颈

#### 现象

系统做了轮询分配，但高难问题总是集中落到少数“能干的人”身上，而简单问题又在低技能组内循环。

#### 根因

只做了简单平均，没有考虑技能、复杂度、历史处理时长和优先级。

#### 解决方案

- 先做技能组过滤；
- 用加权负载替代简单未关闭数；
- 对高优先级和复杂工单做专门池化；
- 定期审计分配结果，避免隐性倾斜。

#### 收获

分配结果更符合真实生产负荷，疑难单响应也更稳。

### 坑七：把 prompt 当万能配置，结果问题越来越难定位

#### 现象

每次效果不好，就改 prompt。一段时间后 prompt 越来越长，谁也说不清某条规则为什么有效、为什么失效。

#### 根因

把本应由系统状态、业务规则、模板约束处理的问题，全塞给 prompt。

#### 解决方案

- 让 prompt 只负责语言理解与表达；
- 业务规则放到代码和状态机；
- 知识选择放到检索与重排；
- 关键路径输出结构化 trace。

#### 收获

系统可解释性和可调试性大幅提升，问题定位速度快很多。

### 坑八：工具调用成功了，但回复和真实结果不一致

#### 现象

日志显示订单接口已经返回“退款审核中”，但用户最终看到的回复却是“退款预计 1-5 个工作日到账”。

#### 根因

- 生成阶段没有区分“业务结果”与“知识说明”；
- prompt 中把通用政策写得过强，覆盖了实时查数结果；
- 工具结果未结构化注入，模型只能从自然语言摘要里自行猜测重点。

#### 解决方案

- 工具结果使用结构化字段注入，如 `refund_status=reviewing`；
- 先决定回复类型，再决定话术模板；
- 当实时业务状态与通用知识冲突时，优先输出实时状态，再补充政策解释。

#### 收获

这类问题修正后，用户会明显感觉“机器人终于是在看我的单子，而不是在背 FAQ”。

### 坑九：知识更新后，旧缓存把新规则吃掉了

#### 现象

运营刚更新退款政策，知识库也完成重建，但线上机器人仍持续数小时回答旧规则。

#### 根因

- query 级缓存没有绑定文档版本；
- chunk 缓存和 rerank 缓存失效策略不一致；
- 多节点服务实例上存在本地缓存漂移。

#### 解决方案

- 为知识检索缓存增加 `knowledge_version` 或 `index_snapshot_id`；
- 文档发布时主动失效相关缓存；
- 高风险政策类知识禁用长 TTL 缓存。

#### 收获

这类治理虽然不“炫技”，却直接决定你能否在活动、政策频繁变动时稳定上线。

---

## 七、一个可执行的落地方案：从 0 到 1 怎么做

如果你所在团队还没有 AI 客服系统，或者只有一个非常初级的 FAQ 机器人，我建议按下面节奏推进，而不是一口气做“大而全平台”。

### 阶段一：先打通最小闭环

目标：

- 接一个稳定渠道；
- 建最基本的 session/message/state 模型；
- 支持高频 FAQ 的知识问答；
- 支持人工接管；
- 有基础日志与埋点。

这一步不要急着做复杂 Agent 编排。重点是把会话、知识、人工闭环先接起来。

### 阶段二：引入结构化任务处理

目标：

- 选 1~2 个高价值任务，如退款进度查询、发票开具；
- 建立意图 + 槽位 + 状态机；
- 打通业务系统查询和办理接口；
- 实现失败回退与转人工。

这一步是系统从“会答”走向“会办”的关键。

### 阶段三：升级 RAG 和检索评估

目标：

- 做文档治理和 metadata 清洗；
- 引入混合检索、重排、版本过滤；
- 建离线评测集和线上质量指标；
- 对知识问答建立证据引用能力。

### 阶段四：完善工单流转与运营能力

目标：

- 建工单状态机；
- 加 SLA、自动分配、升级策略；
- 打通机器人与坐席工作台；
- 建反馈闭环。

### 阶段五：做精细化优化

包括但不限于：

- 用户情绪识别；
- 个性化话术；
- 更细粒度的技能路由；
- 人工总结自动生成；
- 失败会话自动归因；
- 成本治理与缓存策略。

这个节奏的好处是，每一步都能独立产生业务价值，同时避免系统一开始就被复杂度拖垮。

---

## 八、实现建议：给后端工程师的技术清单

最后再从工程实现角度，给一份比较实用的 checklist。

### 8.1 数据与存储

- 会话短状态放 Redis，长历史落 MySQL / PostgreSQL / Elasticsearch；
- 向量索引单独使用向量数据库或支持 ANN 的检索引擎；
- 知识文档保留原文、清洗文本、chunk 文本三层；
- 工单和会话主键统一可追踪；
- 所有关键操作带 `trace_id`。

### 8.2 接口与幂等

- 渠道消息入口必须幂等去重；
- 工具调用要有超时、重试、熔断；
- 工单创建接口要支持幂等键，避免重复建单；
- 状态流转必须做乐观锁或版本校验。

### 8.3 可观测性

至少记录：

- 每轮意图识别结果；
- 槽位提取结果与缺失项；
- 检索 query、topK、重排结果；
- 模型输入 token / 输出 token / 延迟 / 成本；
- 工具调用耗时与错误码；
- 转人工原因；
- 工单流转事件；
- SLA 计时事件。

没有这些数据，后面根本无从优化。

### 8.4 安全与合规

客服系统通常会接触个人敏感信息，所以要注意：

- 对手机号、身份证号、地址等字段脱敏；
- prompt 和日志中避免泄露敏感信息；
- 长期记忆仅存必要字段；
- 重要操作必须走后端权限校验，不能只靠模型“自觉”；
- 对投诉、风控、法律相关问题设置严格人工兜底。

### 8.5 灰度与回滚

- prompt、检索策略、reranker、状态机规则都要可灰度；
- 新知识先小流量生效；
- 高风险业务支持一键退回人工优先模式；
- 模型异常或外部 API 故障时，系统要能降级到 FAQ + 工单模式。

---

## 九、结语：AI 客服的本质不是“更像人”，而是“更可靠地解决问题”

如果你做过一段时间 AI Agent 客服，大概率会有一个感受：用户并不在乎机器人是不是像真人一样会聊天，他们更在乎三件事：

1. 你到底有没有理解我的问题；
2. 你能不能真的帮我解决；
3. 解决不了时，能不能快速、完整地交给正确的人。

因此，一个真正可用的 AI 客服系统，核心并不是“把回复写得多么像人”，而是建立一套**可管理、可验证、可观测、可回退**的系统能力。多轮对话管理决定它能不能持续理解同一个问题；知识库检索决定它能不能稳定引用正确知识；工单流转决定它能不能把未解决的问题顺畅交棒给人工；而踩坑之后的工程治理，决定它能不能在生产环境里活下来。

对后端工程师来说，做这类系统最有价值的视角不是“怎么把模型能力用满”，而是“怎么把不确定性的模型能力，嵌入到一个确定性的业务系统里”。当你开始用状态机思维管理对话，用检索工程思维治理知识，用流程系统思维设计工单闭环时，你会发现 AI 客服才真正从一个 Demo，变成一个能跑在生产上的服务系统。

如果让我用一句话总结这篇文章，那就是：

> **AI Agent 客服不是一个聊天机器人项目，而是一个把语义理解、知识检索、业务执行和人工协同整合起来的后端系统工程。**

希望这篇文章能帮你少踩一些坑，也更快把系统做成真正可用的样子。

## 十、生产实战补充：框架选型对比与混合检索重排完整实现

在实际项目落地过程中，很多团队会在"自研框架"、"开源对话平台"和"低代码 Agent 平台"之间犹豫不决。这一节我会从实战角度对比三种主流路径，并给出一个可直接复用的混合检索 + 重排的完整实现，最后分享一个真实的线上事故案例。

### 10.1 客服系统框架选型对比

| 维度 | Rasa（开源对话框架） | 自研（Python/FastAPI + 状态机） | Dify（低代码 Agent 平台） |
| --- | --- | --- | --- |
| 核心定位 | 事件驱动的对话管理引擎，内置 NLU pipeline | 完全自主控制的后端系统 | 面向非技术/半技术人员的 LLM 应用编排平台 |
| 意图识别 | 内置 DIET 分类器 + regex matcher，支持多标签意图；也可以接入外部 NLU 服务 | 完全自定义，可以混合 LLM + 规则 + 业务信号 | 基于 LLM 的意图理解，无传统 NLU pipeline |
| 多轮对话管理 | Story / Rules + Tracker Store，支持 form（槽位填充）和 loop | 自建状态机 + slot versioning + 三层记忆 | 内置 workflow 编排，支持变量传递，但状态管理粒度较粗 |
| 知识库/RAG | 自带 Retrieval Policy，但生产中多数团队外接自建 RAG pipeline | 完全自主，灵活度最高 | 内置 RAG 模块，支持向量检索 + metadata 过滤 |
| 工单/业务集成 | 需自行开发 action server 对接外部 API | 完全自主 | 支持 HTTP 工具和自定义插件，但深度集成需自行扩展 |
| 部署复杂度 | 中等，需要 Rasa Server + Tracker Store（Redis/PostgreSQL）+ Action Server | 较高，需自行搭建全部基础设施 | 低，Docker 一键部署，或使用云服务 |
| 团队技能要求 | 需熟悉 Rasa 生态（Tracker、Domain、Stories），调试有学习曲线 | 需较强的后端 + AI 工程能力 | 门槛最低，产品经理即可搭建简单流程 |
| 生产可控性 | 中高，开源可审计，但黑盒部分（如 DIET 训练过程）不易深度定制 | 最高，每一步都可监控、可替换、可灰度 | 中低，平台能力受限于官方更新节奏，深度定制受限 |
| 适用场景 | 中等复杂度客服，有 NLU 团队，需要事件驱动架构 | 高复杂度、多业务线、对可控性要求极高的场景 | 快速验证 MVP、内部知识问答、简单客服机器人 |
| 社区与维护 | 活跃开源社区，但近年 Rasa Pro 商业化路线调整，社区信心有波动 | 依赖团队自身维护 | 国内社区活跃，迭代速度快 |

**选型建议**：

- 如果你的团队 **3~5 人、需要 2 周内上线一个能用的 MVP**，Dify 是最快路径，先把知识问答和简单业务跑通，验证业务价值。
- 如果你的客服系统 **需要处理复杂多轮业务、对接多个后端系统、对状态管理精度要求高**，自研虽然前期投入大，但长期可控性和可演进性最好。
- 如果你的团队 **有对话系统经验、业务复杂度中等**，Rasa 是一个不错的中间选择，但要注意它在复杂工具调用和 LLM Agent 编排方面的局限性。

实际项目中，很多成熟系统最终走向的是 **混合架构**：用 Dify 做快速原型和简单场景，核心业务流程用自研状态机，Rasa 的某些理念（如 Tracker Store、Action Server）作为参考设计。

### 10.2 混合检索 + Cross-Encoder 重排的完整实现

下面这段代码是一个可直接用于生产的混合检索 + 重排 pipeline，支持向量检索 + BM25 关键词检索 + Cross-Encoder 重排 + 业务规则加权，完整覆盖从查询到最终证据输出的全流程：

```python
"""
混合检索 + Cross-Encoder 重排 pipeline
适用于客服知识库场景，支持向量检索 + BM25 关键词检索 + 业务规则加权
"""
import asyncio
from dataclasses import dataclass, field
from typing import Any
import numpy as np
from sentence_transformers import SentenceTransformer, CrossEncoder


@dataclass
class ChunkHit:
    chunk_id: str
    doc_id: str
    text: str
    heading_path: str
    doc_version: str
    effective_from: str
    effective_to: str
    authority_level: int       # 1=用户经验, 2=内部文档, 3=官方政策
    chunk_type: str            # faq / sop / policy / announcement
    product_scope: str | None
    region_scope: str | None
    dense_score: float = 0.0   # 向量检索得分
    sparse_score: float = 0.0  # BM25 得分
    rerank_score: float = 0.0  # Cross-Encoder 重排得分
    final_score: float = 0.0   # 最终综合得分


class HybridRetrievalReranker:
    """混合检索 + Cross-Encoder 重排器"""

    def __init__(
        self,
        vector_store,                          # 向量数据库客户端（如 Milvus/Qdrant）
        bm25_index,                            # BM25 索引（如 Elasticsearch/Bloom）
        embedding_model: SentenceTransformer,  # Embedding 模型
        cross_encoder: CrossEncoder,           # Cross-Encoder 重排模型
        reranker_top_k: int = 10,              # 送入 Cross-Encoder 的候选数
        final_top_k: int = 5,                  # 最终输出证据数
        max_total_tokens: int = 1500,          # 证据总 token 预算
    ):
        self.vector_store = vector_store
        self.bm25_index = bm25_index
        self.embedding_model = embedding_model
        self.cross_encoder = cross_encoder
        self.reranker_top_k = reranker_top_k
        self.final_top_k = final_top_k
        self.max_total_tokens = max_total_tokens

    async def retrieve(
        self,
        query: str,
        metadata: dict[str, Any] | None = None,
    ) -> list[ChunkHit]:
        """
        完整检索流程：
        1. 多路召回（向量 + BM25）
        2. 去重 + metadata 前置过滤
        3. Cross-Encoder 重排
        4. 业务规则加权
        5. token 预算裁剪
        """
        metadata = metadata or {}

        # ========== 第一步：多路召回 ==========
        dense_hits, sparse_hits = await asyncio.gather(
            self._dense_retrieve(query, metadata),
            self._sparse_retrieve(query, metadata),
        )

        # ========== 第二步：去重 + 合并得分 ==========
        merged = self._merge_and_deduplicate(dense_hits, sparse_hits)

        # ========== 第三步：metadata 前置过滤 ==========
        filtered = self._apply_metadata_filters(merged, metadata)

        # ========== 第四步：Cross-Encoder 重排 ==========
        reranked = await self._rerank_with_cross_encoder(query, filtered)

        # ========== 第五步：业务规则加权 ==========
        final = self._apply_business_rules(reranked, metadata)

        # ========== 第六步：token 预算裁剪 ==========
        evidence = self._trim_to_token_budget(final)

        return evidence

    async def _dense_retrieve(
        self, query: str, metadata: dict
    ) -> list[ChunkHit]:
        """向量检索：语义相似度召回"""
        query_embedding = self.embedding_model.encode(
            [query], normalize_embeddings=True
        )[0].tolist()

        # metadata 过滤条件：产品线 + 地区
        filters = {}
        if metadata.get("product_scope"):
            filters["product_scope"] = metadata["product_scope"]
        if metadata.get("region_scope"):
            filters["region_scope"] = metadata["region_scope"]

        results = await self.vector_store.search(
            query_embedding=query_embedding,
            top_k=self.reranker_top_k * 2,  # 多召回一些，供后续过滤
            filters=filters if filters else None,
        )

        return [
            ChunkHit(
                chunk_id=r["chunk_id"],
                doc_id=r["metadata"]["doc_id"],
                text=r["text"],
                heading_path=r["metadata"].get("heading_path", ""),
                doc_version=r["metadata"].get("doc_version", ""),
                effective_from=r["metadata"].get("effective_from", ""),
                effective_to=r["metadata"].get("effective_to", ""),
                authority_level=r["metadata"].get("authority_level", 1),
                chunk_type=r["metadata"].get("chunk_type", "unknown"),
                product_scope=r["metadata"].get("product_scope"),
                region_scope=r["metadata"].get("region_scope"),
                dense_score=r["score"],
            )
            for r in results
        ]

    async def _sparse_retrieve(
        self, query: str, metadata: dict
    ) -> list[ChunkHit]:
        """BM25 关键词检索：精确术语召回"""
        results = await self.bm25_index.search(
            query=query,
            top_k=self.reranker_top_k,
        )
        return [
            ChunkHit(
                chunk_id=r["chunk_id"],
                doc_id=r["doc_id"],
                text=r["text"],
                heading_path=r.get("heading_path", ""),
                doc_version=r.get("doc_version", ""),
                effective_from=r.get("effective_from", ""),
                effective_to=r.get("effective_to", ""),
                authority_level=r.get("authority_level", 1),
                chunk_type=r.get("chunk_type", "unknown"),
                product_scope=r.get("product_scope"),
                region_scope=r.get("region_scope"),
                sparse_score=r["score"],
            )
            for r in results
        ]

    def _merge_and_deduplicate(
        self,
        dense_hits: list[ChunkHit],
        sparse_hits: list[ChunkHit],
    ) -> list[ChunkHit]:
        """按 chunk_id 去重，合并向量和 BM25 得分"""
        by_id: dict[str, ChunkHit] = {}
        for hit in dense_hits + sparse_hits:
            if hit.chunk_id in by_id:
                existing = by_id[hit.chunk_id]
                existing.dense_score = max(existing.dense_score, hit.dense_score)
                existing.sparse_score = max(existing.sparse_score, hit.sparse_score)
            else:
                by_id[hit.chunk_id] = hit
        return list(by_id.values())

    def _apply_metadata_filters(
        self,
        hits: list[ChunkHit],
        metadata: dict,
    ) -> list[ChunkHit]:
        """metadata 前置过滤：过期文档、低权威内容提前剔除"""
        from datetime import datetime

        now = datetime.now().strftime("%Y-%m-%d")
        filtered = []
        for hit in hits:
            # 过期文档直接剔除
            if hit.effective_to and hit.effective_to < now:
                continue
            # 权威等级过低的过滤（可根据业务配置调整阈值）
            if hit.authority_level < 1:
                continue
            filtered.append(hit)
        return filtered

    async def _rerank_with_cross_encoder(
        self,
        query: str,
        hits: list[ChunkHit],
    ) -> list[ChunkHit]:
        """Cross-Encoder 重排：比向量余弦相似度更精细的语义匹配"""
        if not hits:
            return []

        # 构造 query-document 对
        pairs = [(query, hit.text) for hit in hits]
        scores = self.cross_encoder.predict(pairs)

        for hit, score in zip(hits, scores):
            hit.rerank_score = float(score)

        # 按 rerank 得分降序排列，取 top_k
        hits.sort(key=lambda h: h.rerank_score, reverse=True)
        return hits[:self.reranker_top_k]

    def _apply_business_rules(
        self,
        hits: list[ChunkHit],
        metadata: dict,
    ) -> list[ChunkHit]:
        """业务规则加权：在 rerank 基础上做最终调整"""
        for hit in hits:
            bonus = 0.0

            # 官方政策优先（权威等级加权）
            if hit.authority_level == 3:
                bonus += 0.15
            elif hit.authority_level == 2:
                bonus += 0.05

            # FAQ 和 SOP 类型对客服场景更友好
            if hit.chunk_type in ("faq", "sop"):
                bonus += 0.10

            # 产品线完全匹配加分
            if metadata.get("product_scope") and hit.product_scope == metadata["product_scope"]:
                bonus += 0.08

            # 新近文档微加权（应对政策频繁更新）
            if hit.effective_from and hit.effective_from >= "2026-01-01":
                bonus += 0.03

            hit.final_score = hit.rerank_score + bonus

        hits.sort(key=lambda h: h.final_score, reverse=True)
        return hits[:self.final_top_k]

    def _trim_to_token_budget(self, hits: list[ChunkHit]) -> list[ChunkHit]:
        """按 token 预算裁剪，避免送给模型的证据超长"""
        selected = []
        total_tokens = 0
        for hit in hits:
            # 粗略估算：1 个中文字符 ≈ 1.5 token
            estimated_tokens = int(len(hit.text) * 1.5)
            if total_tokens + estimated_tokens > self.max_total_tokens:
                break
            selected.append(hit)
            total_tokens += estimated_tokens
        return selected
```

这个实现体现了几个关键的生产原则：

1. **多路召回各自独立，去重合并后再统一处理**——向量检索擅长语义理解（"退款怎么还没到账"匹配"退款到账时效"），BM25 擅长精确匹配（错误码"ERR_REFUND_003"、订单号"ORD-20260601-0042"），两路互补。
2. **Cross-Encoder 重排比向量余弦相似度更精准**——向量检索只看 query 和 chunk 的独立表示，Cross-Encoder 则同时看 query 和 chunk 的交互信息，对"相关但不回答当前问题"的 chunk 降权效果显著。
3. **业务规则加权是最后一道防线**——机器模型无法感知"官方政策必须优先于用户经验"这类业务约束，这必须通过规则显式编码。
4. **token 预算裁剪保证生成阶段的输入可控**——宁可少给几段证据，也不要让模型在过长的上下文中被噪音带偏。

### 10.3 真实生产事故：一次退款政策更新引发的"大规模误答"事件

这是我们团队在某电商客户客服系统上线后遇到的真实案例，非常有代表性。

#### 背景

该客户的退款政策每年调整 2~3 次，每次调整涉及退款时效、退货条件、运费承担等多个字段。上线时系统已经建立了知识库 + RAG 的基本流程。

#### 事故经过

某周一早上，运营团队更新了退款政策文档（从 V3 升级到 V4），主要变化是"7天无理由退货"条件收紧为"5天"，且运费承担规则从"商家承担"变为"用户承担运费（特殊品类除外）"。

知识库重建在周一 10:00 完成，但线上系统仍然持续回答旧规则直到周二下午 16:00——整整 30 小时内，所有涉及退货时效和运费的咨询，机器人给出的都是过期答案。期间产生了约 470 条错误回复，其中 23 条引发了用户投诉（用户按旧规则操作，结果不符合新政策）。

#### 根因分析

我们事后做了完整的复盘，发现问题出在**四个层面的缓存失效不一致**：

1. **Query 级缓存**：为了让高频问题快速响应，系统对热门 query 的检索结果做了 Redis 缓存，TTL 设为 6 小时。但缓存 key 是 query 文本的 hash，**没有绑定文档版本号**。所以即使知识库重建了，命中相同 query 的请求仍然返回旧缓存。

2. **Reranker 缓存**：Cross-Encoder 重排结果也做了缓存（为了减少 GPU 推理开销），同样没有版本绑定。

3. **Embedding 缓存**：为了加速入库，已经 embedding 过的 chunk 不会重新计算。但文档版本更新后，chunk 文本变了，embedding 缓存却返回了旧版本的向量表示。

4. **多节点本地缓存**：服务部署了 4 个实例，每个实例有本地 LRU 缓存。即使清了 Redis，本地缓存仍在返回旧结果。

#### 解决方案

事后我们做了系统性的修复：

1. **所有缓存 key 强制绑定 `knowledge_version`**：每次知识库重建会生成新的 version ID，所有缓存查询时必须带版本号，版本不匹配直接 miss。

```python
def get_cache_key(query: str, knowledge_version: str) -> str:
    """缓存 key 必须绑定知识库版本"""
    return f"rag:{knowledge_version}:{hash(query)}"
```

2. **高风险政策类文档禁用 query 级缓存**：对 chunk_type 为 `policy` 或 `announcement` 的文档，检索结果不走缓存，直接查向量库。虽然增加了少量延迟，但避免了过期回答的致命问题。

3. **知识发布流程加入"缓存预失效"步骤**：新版本知识库上线前，主动清除所有相关缓存（Redis + 本地缓存广播失效），并设置 15 分钟的"缓存冷却期"，期间所有请求强制穿透。

4. **增加过期文档告警**：在检索 pipeline 中加入实时检测——如果返回的 chunk 的 `effective_to` 早于当前日期，立即触发告警并记录到异常日志，便于快速发现缓存失效不一致的问题。

5. **建立"政策更新回归测试"**：每次知识库版本变更后，自动跑一组预设的政策相关测试用例（至少覆盖时效、金额、资格条件等敏感字段），确认新版本已经生效。

#### 经验教训

这个事故让我们深刻认识到：**知识库的更新不仅仅是"重新 build 一下索引"这么简单，缓存治理才是真正的隐形杀手**。在客服场景中，过期回答比"没有回答"更危险——用户会基于错误信息做出决策（比如按旧规则申请退货但被拒绝），然后产生投诉。建议所有上线 RAG 的客服系统，都把"缓存版本绑定"和"政策更新回归测试"作为上线 checklist 的必选项。

---

## 相关阅读

- [AI Agent 代码助手实战：代码生成、Review、重构、文档生成](/post/ai-agent-review/)
- [AI Agent 数据分析实战：自然语言转SQL、图表生成、报告自动化](/post/ai-agent-sql/)
- [AI Agent 运维助手实战：日志分析、告警处理、故障自愈](/post/ai-agent-3/)
- [AI Agent 自动化测试实战：测试用例生成、执行、结果分析闭环](/post/ai-agent-automated-testing-pipeline/)
