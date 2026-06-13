---
title: OpenHuman AutoFetch 实战：每 20 分钟自动拉取上下文的智能机制
description: 本文深度拆解 OpenHuman AutoFetch 如何以每 20 分钟自动拉取上下文的方式，为 AI Agent 持续同步 Slack、GitHub、Jira 等外部信息源。你将看到 AutoFetch 配置、增量抓取、上下文管理、Memory Tree 集成、限流优化与故障排查实战，帮助你把长期运行的智能体真正做成稳定、低噪声、可扩展的生产级系统。
date: 2026-06-02 02:30:00
tags: [OpenHuman, AI Agent, AutoFetch, 上下文管理, 自动化]
keywords: [OpenHuman AutoFetch, 分钟自动拉取上下文的智能机制, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


在构建一个真正可持续运行的 AI Agent 系统时，大家很快都会遇到同一个核心问题：**模型本身很聪明，但它对外部世界的感知是不连续的**。用户刚刚在 Slack 里同步了一个需求，十分钟前 GitHub 上有人提交了一个破坏接口兼容性的 PR，Jira 又在半小时前把某个阻塞任务从 In Progress 改成了 Blocked。如果 Agent 没有办法在合适的节奏里自动刷新这些上下文，它的决策就会迅速退化成“基于过期信息的高质量推理”。

OpenHuman 的 AutoFetch 机制，本质上就是为了解决这个问题：让 Agent 不必每次都被动等待用户显式喂上下文，而是按照既定策略，**每 20 分钟自动从多个外部系统拉取与当前任务相关的信息，并将其压缩、过滤、结构化后送入可持续使用的上下文层**。它不是一个简单的定时任务，也不是“多打几次 API”那么朴素；真正的价值在于它如何在“信息新鲜度、资源成本、上下文容量、噪声控制、记忆沉淀”之间做平衡。

本文会围绕 OpenHuman AutoFetch 的实际工作方式展开，重点讨论以下内容：

1. AutoFetch 的设计动机与工程背景；
2. 定时拉取与推送模型的差异，以及 OpenHuman 为什么偏向前者；
3. 如何配置 fetch interval、数据源、过滤规则与优先级；
4. AutoFetch 与 Memory Tree 的集成方式；
5. Slack、GitHub、Jira 三类典型数据源的实战案例；
6. 性能优化、资源控制与限流设计；
7. 常见故障排查路径；
8. 适合长期运行 Agent 的最佳实践。

---

## 一、为什么 AI Agent 需要 AutoFetch

### 1.1 “静态上下文”无法支撑持续运行的 Agent

很多人第一次实现 Agent 时，会默认采用如下流程：

- 用户发来任务；
- 系统把任务描述、工具说明、少量历史消息拼到 prompt；
- 模型生成计划并执行；
- 本轮完成后结束。

这个流程在“一次性问答”里没问题，但在企业协作、项目交付、自动运维、知识助手等长期场景中会迅速失效。原因很简单：**环境在变，但上下文没变**。

典型问题包括：

- 任务状态在 Jira 中更新，但 Agent 仍使用旧状态继续推进；
- GitHub 新出现 review comment，Agent 却继续根据旧 PR 描述生成总结；
- Slack 线程里已经明确“今晚先不发版”，Agent 却根据白天的计划继续触发部署建议；
- 外部知识源新增了告警或 blocking issue，但模型记忆中仍保留旧假设。

如果系统只依赖“用户主动提供上下文”，则 Agent 永远落后于现实。AutoFetch 的设计出发点，就是把这种“同步上下文”的责任从用户迁移到系统自身。

### 1.2 被动工具调用与主动上下文采样的差别

很多框架会说：“Agent 不是已经可以调用 Slack API、GitHub API、Jira API 了吗？”表面看这是对的，但这里存在两个层面的差别。

**被动工具调用**的特点是：

- 只有当模型意识到需要某条信息时，才会发起调用；
- 是否调用、何时调用、调用哪个接口，依赖当前推理链条；
- 如果模型不知道某件事已经变化，它就不会主动去查。

**主动上下文采样**也就是 AutoFetch 的特点是：

- 在固定周期内扫描高价值数据源；
- 先做增量获取，再做去重和摘要压缩；
- 将“变化事实”提前准备成结构化上下文；
- 在真正推理前，把这些变化作为环境更新输入给 Agent。

换句话说，工具调用解决的是“查得到”，AutoFetch 解决的是“来得及知道”。

### 1.3 为什么是“每 20 分钟”而不是更短或更长

“20 分钟”并不是魔法数字，但它在很多组织协作场景里是一个很实用的折中点。背后通常有三个工程考量。

#### 第一，新鲜度足够高

对大多数协作系统而言，5 秒级实时同步并非必要。PR comment、任务状态、群组讨论等信息，通常在 10 到 30 分钟级别内同步给 Agent，就已经足以支撑大部分自动决策与提醒。

#### 第二，成本可控

如果对 Slack、GitHub、Jira 每分钟都做全量扫描：

- API 成本会迅速升高；
- 更容易触发平台限流；
- 会制造大量重复上下文压缩开销；
- Memory Tree 中也会积累更多中间噪声。

#### 第三，适合批处理压缩

20 分钟窗口天然适合做一次“微批处理”：

- 收集这一窗口内的事件；
- 合并同一实体的多次变化；
- 识别哪些变化真正影响当前任务；
- 对变化做摘要后再写入记忆结构。

因此，AutoFetch 不是追求“绝对实时”，而是追求“足够及时且长期稳定”。

---

## 二、AutoFetch 的设计动机与背景

### 2.1 上下文窗口不是无限的

即便模型上下文窗口越来越大，也不意味着你可以把所有外部系统的原始数据都塞进去。长期运行 Agent 面临的不是“能不能放下”，而是“值不值得放进去”。

一个现实系统同时连接以下数据源并不罕见：

- Slack 多个频道与线程；
- GitHub 多个仓库、Issue、PR、Review；
- Jira 多个项目、看板、Sprint；
- Confluence、Notion、Google Docs 文档更新；
- 监控系统告警；
- 邮件、日程、CI/CD 状态。

如果不做筛选，20 分钟内的信息量就可能远超 prompt 可承载范围。因此 AutoFetch 的核心不是“抓到更多”，而是“**抓到最相关、最增量、最有决策价值的变化**”。

### 2.2 Agent 需要的是“环境变化”，不是“原始事件洪流”

OpenHuman 在这类问题上的重要思想是：Agent 真正需要的，不是事件日志本身，而是事件所代表的**环境状态变化**。

举个例子，原始事件可能是：

- 09:01，PR #128 新建；
- 09:06，reviewer A 评论“接口命名需统一”；
- 09:08，reviewer B 请求修改；
- 09:13，作者推送新 commit；
- 09:17，CI 失败；
- 09:19，作者回复“修复中”。

如果全部原样写入 prompt，模型负担极重。更高价值的摘要可能是：

> PR #128 在最近 20 分钟内进入活跃修订状态：存在接口命名规范问题，review 仍未通过，最新 commit 后 CI 失败，当前作者正在修复。

这就是 AutoFetch 背后的关键背景：**从事件流中提取环境状态，而不是把日志搬进上下文**。

### 2.3 AutoFetch 与传统 ETL/同步任务的不同

一些团队会把 AutoFetch 理解为“定时同步脚本”，这只对了一半。

传统 ETL 更关心：

- 数据是否完整入仓；
- 字段是否标准化；
- 是否支持 BI/报表分析；
- 吞吐和数据一致性。

AutoFetch 更关心：

- 哪些变化和当前 Agent 任务有关；
- 哪些上下文值得进入短期推理层；
- 哪些内容应该沉淀为长期记忆；
- 如何控制 token 与调用成本；
- 如何避免噪声、幻觉放大和错误决策。

因此它不是纯数据工程组件，而是**面向 Agent 决策链的上下文编排机制**。

---

## 三、核心架构原理：定时拉取 vs 推送模型

### 3.1 两种主流机制

在外部系统变化接入 Agent 时，通常有两种思路：

1. **定时拉取（Polling / Scheduled Fetch）**
2. **推送模型（Webhook / Event Push）**

很多人第一直觉会认为推送模型更先进，因为它更实时、更事件驱动。但在多系统、长周期、面向上下文压缩的场景里，事情没有那么简单。

### 3.2 定时拉取模型的优势

AutoFetch 偏向定时拉取，原因主要有以下几点。

#### 1）统一节奏，方便做跨源合并

Slack、GitHub、Jira 的事件语义和速率差异很大。如果完全依赖推送：

- Slack 可能几秒一条；
- GitHub review 事件可能集中爆发；
- Jira 状态变化相对稀疏；
- 某些系统 webhook 会重试、乱序、重复投递。

定时拉取把这些异构源重新压进同一个时间窗口，例如最近 20 分钟，从而更容易做统一的增量对齐和摘要。

#### 2）更容易控制资源消耗

推送模型的高实时性意味着你要随时准备处理事件洪峰；而定时拉取更像可预测的批任务：

- 请求量可预算；
- 数据处理时间可估算；
- 摘要与写记忆动作可批量优化；
- 更容易做配额和并发控制。

#### 3）对外部系统侵入更低

很多企业环境下，配置 webhook 并不总是容易：

- 需要公网回调地址；
- 需要签名校验与安全审计；
- 需要运维网络连通性；
- 某些 SaaS 权限体系不允许任意配置 webhook。

定时拉取只需要 API 凭证和读取权限，更适合作为“默认可落地方案”。

#### 4）天然支持补偿与重放

如果某次任务失败，定时拉取可以通过 `last_success_at` 或 cursor 重新补抓过去窗口的数据。Webhook 失败时则更依赖外部系统是否支持重投与事件回放。

### 3.3 推送模型的优势与适用边界

当然，推送并不是没有价值。对于以下场景，推送非常适合：

- 高频告警系统，需要秒级响应；
- 某些关键审批事件，需要立即触发 Agent 动作；
- 代码仓库合并成功后马上触发后续流水线建议。

但即便在这些场景中，最稳妥的方式往往也不是纯推送，而是：

- 用 webhook 做**触发信号**；
- 用 AutoFetch 做**事实拉取与上下文重构**。

也就是说，推送负责“提醒你有变化”，拉取负责“把变化以统一结构读回来”。

### 3.4 OpenHuman 中的推荐架构

一个相对稳健的架构会分成四层：

```text
[External Sources]
 Slack / GitHub / Jira / Docs / Alerts
           |
           v
[Fetcher Layer]
 定时按 cursor 拉取增量事件
           |
           v
[Context Processing Layer]
 去重 -> 过滤 -> 聚合 -> 摘要 -> 相关性评分
           |
           v
[Context Storage Layer]
 短期上下文缓存 + Memory Tree 长期沉淀
           |
           v
[Agent Runtime]
 任务规划 / 回复生成 / 自动执行
```

其中 AutoFetch 主要覆盖前两层与第三层前半段，但最终价值体现在它如何服务 Agent Runtime。

---

## 四、AutoFetch 的内部工作流

### 4.1 一个完整周期包含哪些步骤

一个 20 分钟的 AutoFetch 周期，通常会经历以下过程：

1. 读取调度配置；
2. 根据每个数据源的 cursor 或上次成功时间构造查询条件；
3. 获取增量事件；
4. 对事件做标准化转换；
5. 执行过滤规则；
6. 聚合同一实体的多条事件；
7. 计算与当前任务或活跃主题的相关性；
8. 生成结构化摘要；
9. 将结果写入短期上下文缓存；
10. 将稳定事实或长期价值内容写入 Memory Tree；
11. 更新 cursor、统计指标与错误日志。

### 4.2 增量抓取的关键：cursor 与时间窗口

最常见的实现方式是维护每个 source 的状态，例如：

```yaml
state:
  slack:
    last_success_at: 2026-06-02T01:40:00Z
    cursor: "1717292400.000200"
  github:
    last_success_at: 2026-06-02T01:40:00Z
    etag:
      repo_a_pull_128: 'W/"abc123"'
  jira:
    last_success_at: 2026-06-02T01:40:00Z
    last_issue_updated: 2026-06-02T01:39:51Z
```

这里通常会同时保留两个维度：

- **时间窗口**：用于兜底；
- **平台特定 cursor**：用于高精度增量。

只用时间窗口有时会漏边界数据；只用 cursor 又可能在某些 API 上难以统一管理。最佳实践是两者结合。

### 4.3 标准化事件模型

不同来源的原始字段完全不同，因此 AutoFetch 往往会先映射成统一事件模型：

```json
{
  "source": "github",
  "entity_type": "pull_request",
  "entity_id": "repo-a#128",
  "event_type": "review_requested_changes",
  "occurred_at": "2026-06-02T01:52:31Z",
  "actor": "alice",
  "title": "Refactor payment callback parser",
  "summary": "Reviewer requested changes due to inconsistent API naming",
  "labels": ["backend", "payment"],
  "url": "https://github.com/org/repo-a/pull/128",
  "raw_priority": 0.82
}
```

统一事件模型的价值在于：

- 后续过滤规则可以复用；
- 聚合器不需要知道每个平台的原始差异；
- Memory Tree 写入逻辑更稳定；
- 相关性评分可统一实现。

### 4.4 聚合比抓取更重要

真正提升上下文质量的往往不是抓取动作，而是聚合逻辑。比如同一 Jira issue 在 20 分钟内被修改三次，你通常不想让 Agent 看到三条分散事件，而是看到一条“状态演进摘要”。

聚合的常见维度包括：

- 同一实体：例如同一个 PR、Issue、Thread；
- 同一主题：例如“发版阻塞”“权限问题”“支付回调故障”；
- 同一责任人：便于形成个人待办视图；
- 同一优先级：便于高优先内容优先进入上下文。

示例聚合伪代码：

```python
from collections import defaultdict

def aggregate_events(events):
    groups = defaultdict(list)
    for event in events:
        key = (event["source"], event["entity_type"], event["entity_id"])
        groups[key].append(event)

    aggregated = []
    for key, items in groups.items():
        items.sort(key=lambda x: x["occurred_at"])
        aggregated.append({
            "key": key,
            "latest_at": items[-1]["occurred_at"],
            "event_count": len(items),
            "title": items[-1].get("title"),
            "timeline": [i["summary"] for i in items],
            "priority": max(i.get("raw_priority", 0) for i in items),
        })
    return aggregated
```

---

## 五、配置方法：fetch interval、数据源配置、过滤规则

### 5.1 基础配置结构示例

下面给出一个偏实战风格的配置示例。不同实现的字段名可能不同，但核心思路相近。

```yaml
autofetch:
  enabled: true
  fetch_interval: 20m
  max_parallel_sources: 3
  context_budget_tokens: 6000
  summarize_model: gpt-4.1-mini
  retry:
    max_attempts: 3
    backoff: exponential
    base_seconds: 5

  sources:
    - name: slack_eng
      type: slack
      enabled: true
      priority: 0.9
      auth_env: SLACK_BOT_TOKEN
      channels:
        - eng-core
        - prod-alerts
        - release-war-room
      thread_depth: 20
      include_reactions: false
      fetch_mode: incremental

    - name: github_main
      type: github
      enabled: true
      priority: 0.95
      auth_env: GITHUB_TOKEN
      repos:
        - org/api-server
        - org/web-console
      include:
        - pull_requests
        - issues
        - review_comments
        - workflow_runs
      fetch_mode: incremental

    - name: jira_delivery
      type: jira
      enabled: true
      priority: 0.85
      auth_env: JIRA_TOKEN
      base_url: https://company.atlassian.net
      projects:
        - PAY
        - OPS
      jql: 'updated >= -30m ORDER BY updated DESC'

  filters:
    min_priority: 0.55
    exclude_bots: true
    exclude_keywords:
      - daily standup
      - lunch
      - 自动通知
    include_labels:
      - p0
      - p1
      - release-blocker
      - production

  memory_tree:
    enabled: true
    write_policy:
      transient_to_short_term: true
      stable_fact_to_long_term: true
      confidence_threshold: 0.7
```

### 5.2 fetch interval 的设计原则

`fetch_interval` 是最核心的参数之一，但并不是越小越好。

你需要综合考虑：

- 业务变化频率；
- 数据源 API 限制；
- 任务容忍延迟；
- 摘要模型成本；
- Memory Tree 写入负载。

实践中可以采用分层策略：

- 高价值高变更源：10~20 分钟，如 Slack war-room、生产告警、关键仓库 PR；
- 中频协作源：20~30 分钟，如 Jira 看板、普通项目频道；
- 低频知识源：1~6 小时，如文档、周报、规范库。

如果系统支持，每个 source 可以独立 interval，而不是全局统一。

### 5.3 数据源配置的关键点

#### Slack

Slack 抓取不是简单地“把频道消息拉下来”。真正要考虑的是：

- 抓哪些频道，而不是整个 workspace；
- 是否抓线程回复；
- 是否抓 bot 消息；
- 是否抓 pinned message 或 topic；
- 是否做用户映射和 mention 解析；
- 是否跳过纯表情回复。

实战建议：对 Slack 必须强约束范围，否则噪声极大。

#### GitHub

GitHub 的上下文价值高，但事件粒度很碎。推荐优先抓：

- 打开中的 PR；
- 最近更新的 issue；
- review comments 与 review decision；
- workflow run 结果；
- release 与 tag 变更。

不建议一开始就全抓 commit 级别细节，否则摘要开销过大。

#### Jira

Jira 的核心价值通常不在评论全文，而在：

- issue 状态流转；
- assignee 变化；
- 优先级变化；
- sprint 归属变化；
- 阻塞标记与标签；
- 评论中是否出现关键信号，如 blocked、rollback、dependency。

### 5.4 过滤规则决定上下文质量上限

过滤规则是 AutoFetch 的灵魂。没有过滤，AutoFetch 只是自动制造噪声。

常见规则包括：

#### 1）基于来源过滤

例如只抓：

- 指定 Slack 频道；
- 指定 GitHub repo；
- 指定 Jira project。

#### 2）基于实体状态过滤

例如：

- 只保留 open PR；
- 只保留最近 7 天活跃 issue；
- 只保留 status in (Blocked, In Progress, Ready for QA) 的 Jira。

#### 3）基于关键词过滤

例如跳过：

- “thanks”
- “LGTM”
- “收到”
- “已阅”
- 每日报告模板文本。

#### 4）基于角色过滤

例如：

- 优先保留 tech lead、PM、on-call engineer 的消息；
- 降低 bot、CI 通知、自动提醒的权重。

#### 5）基于主题相关性过滤

如果 Agent 当前聚焦“支付回调重构”，则与 payment、callback、gateway、settlement 相关的事件应获得更高分。

示例过滤配置：

```yaml
filters:
  slack:
    exclude_users:
      - reminder-bot
      - standup-bot
    include_threads_if_keywords:
      - release
      - rollback
      - incident
      - payment
  github:
    ignore_review_comments_matching:
      - '^nit:'
      - '^typo:'
    include_pr_labels:
      - p0
      - critical
      - architecture
  jira:
    include_status:
      - Blocked
      - In Progress
      - Ready for QA
    exclude_issue_types:
      - Sub-task
```

---

## 六、与 Memory Tree 的集成：从“刷新上下文”到“沉淀记忆”

### 6.1 为什么 AutoFetch 不应该只写 prompt 缓存

如果 AutoFetch 只把数据塞进当前 prompt，它只能解决“这一轮推理更完整”的问题，却解决不了“长期运行系统如何积累认知”的问题。

OpenHuman 的一个关键设计，是把自动拉取来的上下文分层处理：

- **短期上下文层**：服务当前和近期的任务推理；
- **长期记忆层（Memory Tree）**：沉淀稳定事实、反复出现的模式、用户偏好、项目结构与约束。

### 6.2 Memory Tree 适合保存什么

不是所有 AutoFetch 得到的信息都应该进入长期记忆。适合进入 Memory Tree 的通常是：

- 稳定实体关系：某仓库的负责人是谁，某 Jira 项目对应哪个团队；
- 持续性偏好：某项目只允许夜间窗口发版；
- 重复出现的技术事实：某服务依赖旧版回调协议；
- 高频决策模式：PR 被打回往往因为接口命名不一致；
- 结构化状态摘要：某 Epic 当前主要阻塞点来自测试环境容量不足。

不适合长期保存的则包括：

- 单条闲聊；
- 短暂状态抖动；
- 未确认的猜测；
- 纯重复通知。

### 6.3 从事件到记忆节点的映射思路

一个实用的 Memory Tree 集成策略，是把 AutoFetch 聚合后的结果按以下路径写入：

```text
Workspace
├── Teams
│   └── Payment Platform
├── Projects
│   └── Callback Refactor
│       ├── Active Risks
│       ├── Release Constraints
│       └── Key PRs
├── Repositories
│   └── org/api-server
└── Process Patterns
    └── Review Rejection Reasons
```

写入逻辑可以分为三类：

1. **事实型节点**：如“PR #128 属于 Callback Refactor”；
2. **摘要型节点**：如“最近一周 review 常因 API 命名问题被打回”；
3. **关系型节点**：如“Jira PAY-204 与 GitHub PR #128 强关联”。

### 6.4 记忆写入策略示例

```python
def should_write_to_memory(item):
    if item["confidence"] < 0.7:
        return False
    if item["kind"] in {"small_talk", "ephemeral_notification"}:
        return False
    if item["stability_score"] > 0.75:
        return True
    if item["repeated_mentions"] >= 3:
        return True
    return False
```

一个成熟系统通常会把 AutoFetch 结果先分级：

- L1：只进当前上下文缓存；
- L2：进入短期记忆，保留 24~72 小时；
- L3：进入 Memory Tree 长期节点。

### 6.5 记忆回灌的闭环

AutoFetch 与 Memory Tree 的最佳配合不是单向写入，而是闭环：

1. AutoFetch 抓到增量事件；
2. 系统根据 Memory Tree 的已有结构做相关性判断；
3. 高相关内容进入短期上下文；
4. 稳定新事实写入 Memory Tree；
5. 下一个周期再用更新后的 Memory Tree 指导过滤与优先级。

这样一来，Agent 会越来越像一个“知道该关注什么”的系统，而不是每次都从零理解外部事件。

---

## 七、实战场景一：Slack 上下文自动拉取

### 7.1 场景描述

假设你有一个负责研发协作的 Agent，需要持续跟进以下频道：

- `#eng-core`：架构与开发讨论；
- `#release-war-room`：版本发布与回滚协调；
- `#prod-alerts`：线上事故与告警同步。

你不希望 Agent 每次都全量读取这些频道，而是每 20 分钟仅提取对“当前交付状态”有价值的变化。

### 7.2 Slack 拉取策略建议

#### 抓“线程”比抓“频道流水”更重要

很多高价值协作发生在线程内，而不是主频道流水。因此你可以采用策略：

- 主频道只抓最近 20 分钟新增顶层消息；
- 对命中关键词的顶层消息，再深入抓线程；
- 对长线程只保留增量回复；
- 对重复确认类回复做折叠。

示例策略：

```yaml
slack:
  channels:
    - eng-core
    - release-war-room
    - prod-alerts
  fetch_interval: 20m
  fetch_threads_for_matching_messages: true
  thread_match_keywords:
    - release
    - rollback
    - p0
    - payment
    - incident
  ignore_reaction_only_updates: true
  collapse_ack_messages:
    - 收到
    - ack
    - on it
    - 已处理
```

### 7.3 Slack 事件聚合示例

原始消息可能是：

- `#release-war-room`：今晚 21:00 发版；
- 线程回复：支付回调兼容层还没验证；
- 线程回复：QA 说 staging 环境通过；
- 线程回复：prod 配置还没审批；
- 线程回复：先不要发，等审批。

聚合后适合给 Agent 的上下文可能是：

> 发布讨论出现新的阻塞信息：支付回调兼容层在 staging 已验证通过，但生产配置审批尚未完成，当前结论是暂缓 21:00 发版。

### 7.4 Slack 在 Agent 决策中的作用

Slack 数据非常适合影响以下行为：

- 更新任务优先级；
- 纠正过时计划；
- 形成工作日报摘要；
- 触发“需要人工确认”的提醒；
- 为 GitHub/Jira 状态变化提供语义解释。

比如 GitHub 上 PR 已 ready，但 Slack war-room 明确说“冻结变更”，则 Agent 不应该继续建议合并。

---

## 八、实战场景二：GitHub 上下文自动拉取

### 8.1 为什么 GitHub 适合 AutoFetch

GitHub 是典型的“高结构化高价值”数据源。与 Slack 相比，它噪声更少，且对 Agent 的技术决策影响更直接。

最有用的抓取对象包括：

- 活跃 PR；
- review decision；
- 关键 review comment；
- CI workflow run；
- issue 状态和标签变化。

### 8.2 GitHub 配置示例

```yaml
github:
  repos:
    - org/api-server
    - org/mobile-gateway
  fetch_interval: 20m
  pull_requests:
    state: open
    sort_by: updated
    include_reviews: true
    include_review_comments: true
    include_commits: false
  workflows:
    include:
      - build
      - integration-test
      - deploy-check
  filters:
    include_labels:
      - p0
      - p1
      - release-blocker
      - refactor
    exclude_comment_patterns:
      - '^nit:'
      - '^style:'
```

### 8.3 PR 状态演进摘要

GitHub 的关键不是记录所有评论，而是识别 PR 的“推进/阻塞状态”。

例如最近 20 分钟发生了：

- PR #128 新增两个 review comment；
- review decision 从 comment 变成 changes requested；
- 作者推送修复 commit；
- CI integration-test fail。

那 AutoFetch 应该提炼成：

> PR #128 仍处于阻塞状态：review 已正式要求修改，作者已提交修复，但集成测试仍失败，尚不具备合并条件。

这类摘要非常适合：

- 用于日报/周报自动生成；
- 用于判断项目风险；
- 与 Jira issue 建立进展对照；
- 进入 Memory Tree 的“关键 PR 状态节点”。

### 8.4 GitHub 与代码代理协作

如果 Agent 同时具备代码分析能力，AutoFetch 从 GitHub 拿到的上下文还能驱动更主动的行为：

- 发现 PR 因命名规范被打回后，自动在本地仓库扫描类似命名问题；
- 发现 CI fail 后，拉取失败 workflow 日志做原因总结；
- 发现 issue 与 PR 强关联后，生成“修复是否完整覆盖需求”的检查清单。

但要注意：AutoFetch 阶段不宜直接做重型代码分析。更好的方式是先把“值得进一步分析的信号”筛出来，再由执行层按需深入。

---

## 九、实战场景三：Jira 上下文自动拉取

### 9.1 Jira 的价值在于流程状态，而不是文本热闹程度

Jira 和 Slack 最大的不同，是它天然承载流程。对很多交付型 Agent 来说，Jira 往往是判断工作是否推进、是否阻塞、是否偏离计划的核心依据。

### 9.2 重点关注哪些字段

建议 AutoFetch 优先抓取以下变化：

- 状态（To Do / In Progress / Blocked / Done）；
- assignee；
- priority；
- sprint；
- labels；
- issue links；
- 评论中的阻塞/风险信号。

JQL 示例：

```text
project in (PAY, OPS)
AND updated >= -30m
AND status not in (Done, Closed)
ORDER BY updated DESC
```

### 9.3 Jira 聚合摘要示例

最近 20 分钟内：

- PAY-204 从 In Progress 变为 Blocked；
- assignee 从 Bob 变为 Alice；
- 评论新增：“依赖支付网关白名单，未开通前无法联调”；
- 打上 label：release-blocker。

则 Agent 更需要看到：

> Jira PAY-204 已升级为发版阻塞项：当前因支付网关白名单未开通而无法联调，责任人已切换至 Alice，并被标记为 release-blocker。

### 9.4 Jira 与 GitHub/Slack 的联动价值

单看 Jira，信息可能仍不完整；但当它与其他数据源联动时，上下文会更完整：

- Jira 标成 Blocked；
- GitHub PR 仍在修改中；
- Slack war-room 讨论决定延迟上线。

这时 Agent 可以形成更可靠的综合判断：

> 当前发布链路存在真实阻塞，且并非单点问题，而是 Jira 流程、代码修复和发布协调三方同时未闭合。

这类跨源汇总，正是 AutoFetch 的高价值所在。

---

## 十、性能优化与资源控制

### 10.1 AutoFetch 最大的成本不一定在 API，而在摘要

很多团队先担心 API 请求量，其实长期运行后常见的更大成本来自：

- 事件标准化与聚合计算；
- LLM 摘要与相关性评分；
- Memory Tree 写入与索引更新；
- 跨源合并后的重排序。

因此优化要从整条链路看，而不是只盯着抓取请求数。

### 10.2 增量优先，避免重复摘要

最有效的优化之一，是对“已经处理过的实体状态”做缓存。

例如同一个 PR 如果在 20 分钟内没有新 review、没有新 commit、没有 CI 变化，就没必要重新摘要。可以维护一个实体哈希：

```python
import hashlib
import json


def fingerprint(entity_state):
    payload = json.dumps(entity_state, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
```

当哈希不变时：

- 跳过摘要；
- 不写 Memory Tree；
- 只更新最后检查时间。

### 10.3 分层预算控制

建议把资源预算拆成三层：

1. **抓取预算**：每周期最多请求多少 API；
2. **处理预算**：每周期最多处理多少事件；
3. **上下文预算**：最终最多进入多少 token。

示例：

```yaml
budget:
  api_requests_per_cycle: 200
  max_events_per_cycle: 500
  max_entities_after_aggregation: 80
  max_summary_tokens_per_entity: 180
  total_context_tokens: 6000
```

这样即使某个周期出现事件洪峰，系统也会优先保留高价值内容，而不是把整轮拖垮。

### 10.4 优先级驱动的丢弃策略

当事件过多时，必须允许系统“有损压缩”。常见策略：

- 先按 source priority 排序；
- 再按 entity priority 排序；
- 再按 recency 和 risk score 排序；
- 低分事件只保留标题，不保留详情；
- 更低分事件直接只记计数，不进入 prompt。

例如：

- production incident > release blocker > active PR review > 普通聊天；
- changes requested > comment added > emoji reaction。

### 10.5 限流与退避

对于 Slack、GitHub、Jira 这类第三方 API，必须把限流作为常态而非异常处理。建议：

- 每个 source 单独限流；
- 429 响应使用指数退避；
- 记录剩余配额和 reset 时间；
- 超预算时优先拉关键实体而不是全量列表。

伪代码：

```python
import time

def with_backoff(fetch_fn, max_attempts=5, base=2):
    for attempt in range(max_attempts):
        result = fetch_fn()
        if result.ok:
            return result
        if result.status == 429:
            sleep_seconds = base ** attempt
            time.sleep(sleep_seconds)
            continue
        if result.retryable:
            time.sleep(base ** attempt)
            continue
        break
    raise RuntimeError("fetch failed after retries")
```

---

## 十一、故障排查：为什么 AutoFetch 没有按预期工作

### 11.1 常见故障类型

AutoFetch 失败通常集中在以下几类：

1. 没抓到数据；
2. 抓到了但被过滤掉；
3. 进入了短期上下文但没写 Memory Tree；
4. 摘要结果失真；
5. 周期执行不稳定；
6. API 限流导致间歇性漏抓；
7. cursor 错乱导致重复或漏数据。

### 11.2 排查顺序建议

建议按下面顺序排查，而不是一上来就怀疑模型：

#### 第一步：看调度是否真的执行

检查：

- scheduler 是否按 20 分钟触发；
- 上一次成功执行时间；
- 是否存在超时或锁冲突；
- 是否有多个 worker 重复跑同一任务。

#### 第二步：看 source API 是否有返回

检查：

- 认证 token 是否过期；
- 请求范围是否正确；
- 时间窗口是否设置错误；
- cursor 是否越界。

#### 第三步：看过滤器是否过严

一个很常见的问题是：数据抓到了，但被过滤器全部抛弃。尤其在初期配置时，关键词、标签、状态条件容易写得太死。

#### 第四步：看聚合是否吞掉关键信息

聚合逻辑如果过于激进，可能会把多个重要变化压缩成一句模糊描述，导致关键信号丢失。

#### 第五步：看 Memory Tree 写入门槛

如果 `confidence_threshold` 或 `stability_score` 过高，很多有价值但尚未完全稳定的信息不会进入长期记忆。

### 11.3 推荐观测指标

一个可运维的 AutoFetch 系统至少要有如下指标：

- `fetch_cycle_duration_ms`
- `events_fetched_total`
- `events_filtered_total`
- `entities_aggregated_total`
- `context_tokens_generated`
- `memory_writes_total`
- `source_api_error_total`
- `rate_limit_hits_total`
- `cursor_rewind_total`

### 11.4 日志要记录什么

建议每轮 AutoFetch 输出结构化日志：

```json
{
  "cycle_id": "autofetch-2026-06-02T02:20:00Z",
  "source": "github_main",
  "fetched": 42,
  "filtered": 18,
  "aggregated": 9,
  "written_to_context": 6,
  "written_to_memory": 2,
  "duration_ms": 1832,
  "rate_limit_remaining": 4211,
  "status": "ok"
}
```

有了这些日志，问题定位会比“为什么 Agent 没看到消息”高效得多。

---

## 十二、最佳实践：把 AutoFetch 跑稳，而不是跑炫

### 12.1 从少量高价值源开始

不要一开始就接 10 个系统。建议第一阶段只接：

- 1~3 个关键 Slack 频道；
- 1~2 个核心 GitHub 仓库；
- 1 个关键 Jira 项目。

先验证：

- 抓取是否稳定；
- 摘要是否真实有帮助；
- Agent 是否因为这些上下文做出更好决策；
- 资源成本是否可接受。

### 12.2 先做强过滤，再逐步放开

初始阶段宁可漏掉一些边缘信息，也不要把噪声全放进来。因为一旦上下文里充满低价值事件，用户会很快失去对系统输出的信任。

### 12.3 区分“事实”和“判断”

AutoFetch 写入 Memory Tree 时，必须尽量区分：

- **事实**：PR #128 CI 失败；
- **判断**：该 PR 暂不适合合并；
- **推测**：失败可能与新命名规则有关。

事实可以高置信保留；判断需要附带依据；推测则应谨慎，必要时只放短期上下文。

### 12.4 给每条上下文保留来源与时间

任何进入上下文或记忆的摘要，都应保留：

- 数据源；
- 实体链接；
- 抓取时间；
- 事件时间；
- 置信度。

这样 Agent 在后续引用时，才能判断信息是否过期，以及是否需要再次验证。

### 12.5 摘要不要脱离可追溯原文

AutoFetch 的摘要应始终可回溯到原始事件。否则当模型根据摘要做出错误推理时，你很难知道问题出在抓取、聚合、摘要还是记忆写入。

### 12.6 定期做“记忆清理”

Memory Tree 不是只增不减。对以下内容应设置过期或降权机制：

- 已关闭 issue 的短期风险描述；
- 已失效发布窗口信息；
- 过时 owner 映射；
- 被后续事实推翻的判断。

### 12.7 为重要系统保留人工复核入口

AutoFetch 再智能，也不适合在关键发布、合规审批、生产事故处置等场景里完全替代人工判断。最佳实践是：

- Agent 自动整理上下文；
- 自动给出建议；
- 人类在关键节点确认。

这会让系统既高效，又不至于因为单次摘要偏差产生高风险动作。

---

## 十三、一个完整的落地样例

下面给出一个更完整的 OpenHuman AutoFetch 配置样例，展示每 20 分钟自动从 Slack、GitHub、Jira 拉取上下文，并与 Memory Tree 集成的思路。

```yaml
autofetch:
  enabled: true
  fetch_interval: 20m
  timezone: Asia/Shanghai
  lock_ttl: 18m
  context_budget_tokens: 6000
  max_parallel_sources: 3

  sources:
    slack:
      enabled: true
      token_env: SLACK_BOT_TOKEN
      channels:
        - eng-core
        - release-war-room
        - prod-alerts
      incremental: true
      thread_fetch:
        enabled: true
        only_if_keywords:
          - release
          - rollback
          - incident
          - payment
      filters:
        exclude_users: [reminder-bot, standup-bot]
        collapse_short_acks: true

    github:
      enabled: true
      token_env: GITHUB_TOKEN
      repos:
        - org/api-server
        - org/web-console
      include:
        pull_requests: true
        review_comments: true
        workflow_runs: true
        issues: true
      filters:
        include_labels: [p0, p1, release-blocker, architecture]
        exclude_comment_patterns:
          - '^nit:'
          - '^style:'

    jira:
      enabled: true
      token_env: JIRA_TOKEN
      base_url: https://company.atlassian.net
      projects: [PAY, OPS]
      jql: 'project in (PAY, OPS) AND updated >= -30m AND status not in (Done, Closed) ORDER BY updated DESC'
      filters:
        include_status: [Blocked, In Progress, Ready for QA]
        include_issue_types: [Bug, Task, Story]

  processing:
    deduplicate: true
    aggregate_by_entity: true
    relevance_scoring: true
    summarize:
      enabled: true
      max_tokens_per_entity: 180
      include_source_links: true

  memory_tree:
    enabled: true
    confidence_threshold: 0.7
    write:
      stable_facts: true
      repeated_patterns: true
      transient_chat: false

  observability:
    log_level: info
    metrics: true
    trace_cycles: true
```

这套配置的核心思路不是“抓得最多”，而是：

- 锁定关键数据源；
- 以 20 分钟为节拍做增量扫描；
- 通过过滤器抑制噪声；
- 通过聚合与摘要把事件转换成任务上下文；
- 再通过 Memory Tree 让系统形成长期认知。

---

## 十四、结语：AutoFetch 的真正价值，是让 Agent 持续活在现实里

如果把 Agent 看成一个会推理、会调用工具、会执行任务的智能体，那么 AutoFetch 就像它的“环境感知系统”。没有这层机制，Agent 往往只能在一轮对话中表现得聪明；一旦进入长周期协作，它就会因为上下文老化而逐渐失真。

OpenHuman AutoFetch 的价值，不只是“每 20 分钟自动拉点数据”，而是建立了一套更适合长期运行 AI Agent 的工程方法：

- 用定时拉取管理异构数据源的节奏；
- 用过滤与聚合控制噪声；
- 用摘要把事件转成可决策上下文；
- 用 Memory Tree 沉淀稳定事实与长期模式；
- 用预算、限流和观测保证系统能持续稳定运行。

当这套机制跑顺以后，Agent 的行为会发生明显变化：它不再只是“等你告诉它发生了什么”，而是能主动感知环境的更新，持续修正自己的理解，及时吸收协作现场的新事实，并把这些变化转化为更可靠的建议、执行与记忆。

这就是 AutoFetch 的实战意义：**让 Agent 不只是聪明，而且始终跟得上现实。**

## 相关阅读

- [OpenHuman Memory Tree 实战：本地知识图谱与记忆构建](/categories/00_架构/OpenHuman-Memory-Tree-实战-本地知识图谱与记忆构建/)
- [OpenHuman TokenJuice 实战：智能 Token 压缩与成本优化（降低 80%）](/categories/00_架构/OpenHuman-TokenJuice-实战-智能Token压缩与成本优化/)
- [OpenHuman 模型路由实战：智能选择推理/快速/视觉模型的策略](/categories/00_架构/OpenHuman-模型路由实战-智能选择推理-快速-视觉模型的策略/)
