---

title: OpenClaw vs Hermes Agent：开源 AI Agent 框架选型对比
keywords: [OpenClaw vs Hermes Agent, AI Agent, 开源, 框架选型对比]
date: 2026-06-02 10:00:00
description: 本文围绕 OpenClaw 与 Hermes Agent 两个开源 AI Agent 框架做系统选型对比，从架构设计、工具调用、长期记忆、多模型支持、插件扩展、性能与运维复杂度等维度展开分析，并结合代码示例、落地场景和踩坑案例，帮助开发者、架构师与团队判断个人 AI 助手平台和可持续演化的 Agent 运行时分别适合什么业务路线。
tags:
- OpenClaw
- Hermes Agent
- AI Agent
- 架构设计
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---



# OpenClaw vs Hermes Agent：开源 AI Agent 框架选型对比

过去一年，开源 AI Agent 赛道开始从“能不能跑起来”转向“能不能长期用、能不能扩展、能不能运营”。如果说早期很多项目还停留在“一个带工具调用的聊天壳子”，那么到了 2026 年，真正值得团队投入时间评估的 Agent 框架，已经开始呈现出明显分化：有的更像个人数字助理操作系统，有的更像可部署、可演化、可编排的智能体运行时。

在这一轮分化里，**OpenClaw** 和 **Hermes Agent** 是两个很有代表性的开源项目。它们都试图回答同一个问题：如何把大模型从“会说话”升级为“能持续做事”的 Agent。但两者的回答方式并不一样。

- **OpenClaw** 更强调“个人 AI 助手”的产品完成度，主打多渠道接入、持续在线、个人设备与消息平台整合、控制面与使用体验。
- **Hermes Agent** 更强调“自我成长的 Agent 基础设施”，主打学习闭环、技能沉淀、跨会话记忆、插件化扩展、多模型切换、子代理并行与调度能力。

如果你正在做如下决策，这篇文章会比较有帮助：

1. 想给个人或小团队部署一个长期在线的 AI 助手；
2. 想搭建一个可扩展的 Agent 平台，而不是一次性 Demo；
3. 在“产品化体验优先”与“Agent 能力演进优先”之间犹豫；
4. 需要在工具系统、记忆系统、多模型支持、插件生态、性能扩展性等维度做技术选型。

本文会围绕以下几个维度展开对比：

- 两个框架的定位与设计理念
- 总体架构与模块边界
- 核心能力对比：工具调用、记忆系统、多模型支持、插件生态
- 性能与扩展性分析
- 社区活跃度与生态成熟度
- 适用场景与落地选型建议

需要说明的是，本文基于项目公开 README、官方文档、架构说明与 GitHub 仓库元数据进行分析。对于一些仍在快速演进中的功能，我会尽量按照“公开声明能力”“当前文档可见实现”和“工程上可推断方向”三个层次来区分，而不是把营销式描述直接等同于工程现实。

---

## 一、先说结论：这是两条不同的 Agent 进化路线

很多文章做框架对比时喜欢直接给一个“谁更强”的结论，但 OpenClaw 与 Hermes Agent 的关系，其实更像是**两条路线不同、目标用户不同、工程重心不同**的产品。

一句话总结：

- **OpenClaw 更像“个人 AI 助手平台”**，强调把 Agent 接入到你已有的沟通渠道、设备与控制面里，让它像一个真实存在的助手一样长期服务于你。
- **Hermes Agent 更像“可自我积累的 Agent 运行时”**，强调 Agent 在任务中学习、沉淀技能、积累长期记忆、跨平台运行，并能通过插件与子代理机制不断扩展。

如果必须做一个非常简短的判断：

- 你更关心**渠道接入、个人助手体验、上线快、产品面完整**，优先看 OpenClaw；
- 你更关心**长期记忆、技能演化、研究与工程扩展、Agent 平台化**，优先看 Hermes Agent。

但真正的选型，不能只看定位。接下来我们从设计哲学开始拆。

---

## 二、定位与设计理念对比

### 2.1 OpenClaw：从“能接入现实世界”的个人助手出发

OpenClaw 在官方 README 中给自己的定义非常明确：**Your own personal AI assistant**。它不是简单地把大模型包一层 CLI 或 Web 界面，而是希望成为一个**运行在个人设备与消息平台之上的长期在线 AI 助手**。

从文档与 README 可以看出，OpenClaw 的核心关注点有几个：

1. **助手必须存在于真实沟通渠道中**  
   它支持大量消息平台与通信渠道，包括 WhatsApp、Telegram、Slack、Discord、Google Chat、Signal、iMessage、Matrix、QQ、WeChat 等。也就是说，OpenClaw 不是把用户拉到新的 UI 里，而是尽量进入用户已经使用的渠道。

2. **Gateway 是控制平面，不是产品本体**  
   官方文档明确提到：Gateway 只是控制面，真正的产品是助手本身。这说明 OpenClaw 的架构思路不是做一个“工具箱”，而是做一个以助手为中心的交互系统。

3. **强调设备常驻、护航式运行与安全默认值**  
   OpenClaw 推荐通过 daemon 方式运行 Gateway，并重点强调 DM pairing、allowlist、安全暴露 runbook 等内容。这意味着它不是面向一次性实验，而是面向长期在线与现实通信面暴露场景。

4. **优先解决 first-run UX 与稳定性**  
   在 Vision 文档中，OpenClaw 当前优先级明确包含：安全默认值、Bug 修复、稳定性、首次安装体验。这是一种很“产品工程”的优先级，而不是研究原型式优先级。

因此，OpenClaw 的设计理念可以概括为：

> 把 AI Agent 打造成一个真正接入现实通信与个人工作流的“常驻数字助手”，并以渠道整合、可运维性和个人使用体验为第一优先级。

这意味着它天然更适合“单用户、强个人化、强消息渠道接入”的路线。

### 2.2 Hermes Agent：从“会成长的智能体运行时”出发

Hermes Agent 的自我定义同样非常鲜明：**The self-improving AI agent**，也是“the agent that grows with you”。它的 README 开门见山强调几个关键词：

- built-in learning loop
- creates skills from experience
- improves them during use
- persists knowledge
- searches past conversations
- builds a deepening model of who you are across sessions

这说明 Hermes Agent 的核心叙事不是“我能接多少平台”，而是“我是否能随着使用而变得更强”。

从架构文档和 README 中，可以提炼出 Hermes 的设计理念：

1. **Agent 不是一次会话，而是跨会话持续存在的认知体**  
   Hermes 非常重视跨会话记忆、会话检索、用户建模与长期状态。这和许多只做 session-level 的 Agent 框架很不一样。

2. **技能是第一等公民，而不是提示词附件**  
   Hermes 强调 skills 的创建、调用、自我改进以及 agentskills.io 标准兼容。这意味着它希望把任务经验沉淀为可复用的程序化能力，而不只是聊天记录。

3. **Agent 运行时应当平台无关、入口多样**  
   从 CLI、消息网关、cron、ACP/IDE 集成，到多种 terminal backend，Hermes 的思路是构建一个统一 Agent Core，再向外辐射不同入口。

4. **把工具、插件、记忆、上下文压缩都纳入统一运行时**  
   从工具注册中心、memory provider、context engine、prompt caching 到 session storage，它更像一个 Agent OS 或 Agent runtime，而不是单纯的聊天应用。

5. **长期目标包含研究友好性与训练数据闭环**  
   Hermes 文档中直接提到 trajectory generation、trajectory compression 等能力，说明它不仅服务使用者，也服务 Agent 能力训练与后续模型研发。

因此，Hermes Agent 的设计理念可以概括为：

> 不把 Agent 视为一个临时会话机器人，而把它视为一个可记忆、可学习、可扩展、可调度、可迁移的长期运行智能体系统。

### 2.3 两者设计哲学的本质差异

两者最大的差别，不在“有没有工具调用”，也不在“支持几个模型”，而在于**系统的第一性目标**不同。

| 维度 | OpenClaw | Hermes Agent |
|---|---|---|
| 核心目标 | 构建可长期在线的个人 AI 助手 | 构建可持续成长的 Agent 运行时 |
| 关注重点 | 渠道接入、控制面、设备集成、安全默认值 | 技能沉淀、长期记忆、运行时抽象、扩展性 |
| 用户画像 | 个人用户、重渠道沟通、重助手体验 | 开发者、研究者、平台构建者、重长期演化 |
| 典型使用方式 | 作为个人消息助手和控制中枢 | 作为 CLI/Gateway/Cron/IDE 的统一 Agent 核心 |
| 工程风格 | 产品导向、体验导向 | 运行时导向、系统导向 |

从技术选型角度看，这种差异会直接影响后面的所有判断：架构复杂度、插件方式、记忆机制、性能扩展路径，都会沿着不同哲学演化。

---

## 三、总体架构对比：一个偏“助手系统”，一个偏“Agent 运行时”

### 3.1 OpenClaw 架构：以 Gateway 为中心的个人助手系统

OpenClaw 官方文档中有明确的 Gateway、Dashboard、Channel、Onboarding、Pairing、安全配置等结构。虽然它也有 Agent 能力、工具能力和模型接入能力，但从整体上看，它的架构更像一个**围绕个人助手产品展开的控制与接入系统**。

可以将 OpenClaw 的整体架构抽象为以下几层：

1. **入口层**：各类消息渠道、控制面、Dashboard、CLI
2. **控制与路由层**：Gateway 服务、消息派发、配对授权、会话路由
3. **Agent 执行层**：模型调用、推理参数、工具能力、技能/插件接入
4. **运行环境层**：本地设备、后台服务、模型供应商、外部渠道 API
5. **安全治理层**：allowlist、DM pairing、doctor 检查、暴露策略

它的核心优势在于：

- 渠道接入能力强；
- 面向长期运行的运维能力比较完整；
- onboarding 与 dashboard 降低了初始使用成本；
- 安全默认值和对“现实世界暴露面”的关注比较到位。

但与此同时，这种结构也意味着：

- 系统设计天然会围绕“个人助手产品闭环”来演化；
- 某些能力虽然可扩展，但首要目标不是“通用 Agent runtime”；
- 在“技能学习闭环”“深层 Agent 记忆抽象”等方面，它可能不会像 Hermes 那样把这些能力做到架构中心。

### 3.2 Hermes Agent 架构：以 AIAgent Core 为中心的分层运行时

Hermes 的架构文档给出的信息更系统化，模块边界也更清晰。根据官方文档，它的核心模块包括：

- `run_agent.py`：AIAgent 核心对话循环
- `model_tools.py`：工具发现、schema 收集、调用分发
- `hermes_state.py`：SQLite + FTS5 的状态与会话存储
- `agent/`：prompt builder、context compressor、memory manager 等
- `tools/`：工具注册、终端、浏览器、MCP、文件系统等
- `gateway/`：多平台消息网关
- `cron/`：任务调度系统
- `plugins/`：memory/context engine 等插件
- `skills/`：技能系统

它的架构是典型的**以 Agent Loop 为中心、向外扩展多入口和多能力模块**的方式。

Hermes 的优势在于：

1. **Core 抽象更统一**  
   CLI、gateway、cron、ACP 都复用一个核心 AIAgent 执行逻辑，入口差异被隔离在边缘层。

2. **工具与状态系统是平台级能力，不是附属能力**  
   工具注册中心、后台进程管理、文件工具、浏览器工具、MCP、子代理，都处在统一运行时里。

3. **可替换部件更多**  
   记忆提供者、上下文引擎、插件、工具集、terminal backend 都是可插拔的，这让它更适合做平台型扩展。

4. **面向长周期使用的状态治理更强**  
   SQLite + FTS5、session lineage、context compression、prompt caching 等设计，说明 Hermes 在考虑“多轮、多入口、跨时间”的成本控制与状态连续性。

### 3.3 架构图描述：两种系统重心

下面给出一个简化的架构图描述，便于理解两者的系统重心差异。

#### OpenClaw 架构图描述

```text
用户/设备/消息渠道
   │
   ├── Telegram / WhatsApp / Slack / Discord / iMessage / QQ / WeChat ...
   │
   ▼
OpenClaw Gateway（消息接入、授权配对、路由、守护进程）
   │
   ├── Dashboard / Control UI
   ├── Onboarding / Doctor / Gateway Ops
   ├── 安全策略（DM pairing / allowlist / exposure runbook）
   │
   ▼
Agent 执行层（模型调用 / 工具 / 技能 / 插件）
   │
   ▼
外部模型供应商 + 本地/远程运行环境
```

这个结构的重点是：**多渠道接入 + Gateway 控制平面 + 长期在线助手产品形态**。

#### Hermes Agent 架构图描述

```text
CLI / Messaging Gateway / Cron / ACP(IDE) / API入口
          │
          ▼
      AIAgent Core
          │
   ┌──────┼───────────────┬─────────────┐
   ▼      ▼               ▼             ▼
Prompt  Tool Runtime   Memory System  Session Storage
System  (Registry)     / Skills       (SQLite + FTS5)
   │      │               │             │
   │      ├── Terminal    ├── Long-term │
   │      ├── Browser     ├── User Model│
   │      ├── File        ├── Skills    │
   │      ├── MCP         └── Plugins   │
   │      └── Delegate
   ▼
Providers / Model Runtime / Context Compression / Prompt Caching
```

这个结构的重点是：**统一 Agent Loop + 工具运行时 + 记忆与技能系统 + 多入口共用核心**。

### 3.4 架构层面的优劣势判断

从架构完整度上说，二者都不是“玩具项目”，但擅长方向不同：

- **OpenClaw 更像一个已经把“产品外壳、渠道接入、安全运维”想清楚的助手系统。**
- **Hermes 更像一个已经把“Agent 核心、记忆、工具、插件、调度、存储”抽象得更完整的运行时。**

对于选型者而言，要问的不是“谁模块更多”，而是：

- 我需要的是**一个好用的个人 AI 助手产品骨架**，还是
- 一个**能支撑长期扩展和能力进化的 Agent 核心平台**。

---

## 四、核心功能对比（一）：工具调用系统

Agent 框架有没有价值，工具调用系统通常是分水岭。没有工具调用，Agent 只是会写字；工具调用做不好，Agent 只是会“假装做事”。

### 4.1 OpenClaw 的工具能力：偏向“产品可用性”和现实接入

从 OpenClaw 文档和能力介绍看，它的工具能力主要围绕以下几个方向：

- 通过 Gateway 与外部消息/渠道系统联动；
- 支持模型、插件、skills、浏览/执行等能力；
- 强调 assistant 能在现实渠道中响应与执行；
- 逐步增强 computer-use 和 agent harness 能力。

OpenClaw 的能力面看起来很广，但它的工具设计重点更偏向**服务个人助手场景**。换句话说，工具系统是为了让助手“能接触现实世界并完成任务”，而不是优先为了构建一套高度抽象的、平台级工具运行时。

这带来的好处是：

1. 对终端用户来说更直接；
2. 与渠道系统结合更自然；
3. 对“发消息、接消息、在线助手、设备控制”类场景很友好；
4. 配合 Dashboard/Onboarding 后，使用门槛更低。

但工程上也有一个隐含代价：

- 工具系统很容易围绕产品需求演进，而不是围绕通用抽象演进；
- 当你要把它拿来做更通用的平台层能力时，可能需要额外适配。

### 4.2 Hermes Agent 的工具能力：偏向“统一注册中心 + 多后端执行”

Hermes 在工具系统上的设计明显更“运行时化”。从架构文档可以看到：

- 有中央工具注册中心；
- 工具在 import 时自注册；
- 运行时统一收集 schema、做 availability check、执行 dispatch 和错误包装；
- Terminal 工具有 6 种 backend；
- Browser、Web、File、Vision、MCP、Delegate 等都在统一工具体系内。

这意味着 Hermes 的工具系统有几个明显特征：

1. **工具是标准化能力单元**  
   工具不是临时 if-else，而是有注册、发现、可用性校验、schema 暴露与统一调度的正式运行时能力。

2. **后端与接口解耦**  
   例如 terminal 工具可以映射到 local、Docker、SSH、Modal、Daytona、Singularity 等不同 backend。对 Agent 来说，面对的是统一能力；对系统来说，可以切换执行环境。

3. **支持复杂任务编排**  
   除了基础工具，Hermes 还有 delegate 工具与后台进程管理，这使它可以把长任务、并行任务、脚本化任务组织起来，而不是停留在单次函数调用。

4. **与插件/MCP 形成统一扩展面**  
   工具系统不是封闭的，它和插件机制、MCP 集成一起构成了 Hermes 的外部能力扩展界面。

### 4.3 工具调用能力对比表

| 对比项 | OpenClaw | Hermes Agent |
|---|---|---|
| 工具系统定位 | 服务于个人助手场景与渠道接入 | 作为 Agent runtime 的核心子系统 |
| 调用抽象 | 更偏产品能力集成 | 更偏注册中心 + schema + dispatch |
| 执行环境 | 支持现实渠道、设备、插件与模型联动 | 支持多终端 backend、多浏览器 backend、MCP、子代理 |
| 编排能力 | 可完成现实任务，但更强调助手产品闭环 | 更强的后台进程、并行、脚本化、子代理能力 |
| 平台化程度 | 中等偏强 | 很强 |
| 上手体验 | 终端用户友好 | 开发者/平台工程师友好 |

### 4.4 如何理解这类差异

如果你的问题是：

> “我想让 Agent 赶紧接入 Telegram、Slack、WhatsApp，像一个真实助手那样服务于我。”

那么 OpenClaw 的工具体系很符合直觉。

如果你的问题是：

> “我想把 Agent 的工具系统做成一个长期可维护、可切换执行环境、可并行、可扩展的底层能力层。”

那么 Hermes 的抽象明显更适合。

我的判断是：

- **OpenClaw 的工具系统更像产品工程中的能力集合。**
- **Hermes 的工具系统更像运行时中的能力总线。**

---

## 五、核心功能对比（二）：记忆系统

如果说工具系统决定 Agent “能做什么”，那么记忆系统决定 Agent “会不会越来越像同一个体”。这也是 OpenClaw 与 Hermes 差异最明显的部分之一。

### 5.1 OpenClaw 的记忆设计：插件化、服务于个人助手连续性

在 OpenClaw Vision 文档中，记忆被描述为一个特殊插件槽位：**一次只能启用一个 memory plugin**。这个设计很重要，因为它说明 OpenClaw 对记忆的看法是：

- 记忆是重要能力；
- 但它被实现为可替换插件，而不是系统硬编码的一套唯一方案；
- 记忆系统的责任边界更接近“外接模块”。

这种设计的优点在于：

1. **灵活性高**  
   不同用户可以选不同的记忆方案，不会被强绑在单一存储策略上。

2. **核心保持克制**  
   记忆能力不一定要侵入所有运行时路径，OpenClaw 核心可以保持偏瘦。

3. **更符合插件优先的生态思路**  
   它在 Vision 中明确提到倾向“slimming down core while expanding what plugins can do”。

但这也意味着一个现实问题：

- 如果你想要的是**非常深度整合、跨会话检索、用户画像、记忆自我维护、技能联动的内生型记忆系统**，OpenClaw 的路线可能没那么激进；
- 记忆更像能力选配，而不是平台的认知中枢。

当然，这不一定是缺点。对于大量个人助手场景，适度、可替换、受控的记忆，反而比“什么都记、处处耦合”更稳妥。

### 5.2 Hermes Agent 的记忆设计：把记忆放进 Agent 的主循环里

Hermes 的记忆系统显然更重。它在 README 和架构文档中多次强调：

- persistent memory
- user model across sessions
- search own past conversations
- memory manager / memory provider
- SQLite + FTS5 session search
- agent-curated memory
- periodic nudges

这说明 Hermes 对记忆的定位不是“外挂数据库”，而是**Agent 长期存在性的核心机制**。它的记忆体系大致包含几个层次：

1. **会话级持久化**  
   使用 SQLite + FTS5 保存会话与状态，并支持全文检索。

2. **跨会话搜索与召回**  
   不只是存，还要能搜，能把相关历史拉回当前语境。

3. **用户建模**  
   不是简单保存聊天记录，而是尝试形成“这个用户是什么样的人”的结构化理解。

4. **记忆管理器与提供者插件**  
   既有平台内建记忆逻辑，也保留 provider 级可插拔空间。

5. **与技能学习闭环联动**  
   经验不只进入聊天历史，还可能进入技能或长期知识沉淀。

这套设计的意义在于：Hermes 试图让 Agent 具备某种“延续性人格与能力积累”，而不是每个会话都从零开始。

### 5.3 记忆系统的本质差异

| 维度 | OpenClaw | Hermes Agent |
|---|---|---|
| 记忆定位 | 特殊插件槽位，可替换能力 | Agent 核心长期能力的一部分 |
| 存储与检索 | 更偏插件实现与场景适配 | 明确有 SQLite + FTS5 会话检索 |
| 用户画像 | 有个人助手方向，但文档强调较少 | 明确强调 user model 与跨会话认知 |
| 与技能联动 | 可通过插件/技能扩展 | 深度联动，自学习叙事明确 |
| 系统耦合度 | 相对松耦合 | 相对深耦合 |
| 风险与收益 | 简洁、可控、容易替换 | 更强大，但复杂度更高 |

### 5.4 工程上的取舍

对于企业或开发团队来说，记忆系统不是越强越好，而是要看风险边界：

- 你是否需要长期记住用户偏好？
- 你是否担心隐私与误召回？
- 你是否希望记忆可替换、可禁用、可审计？
- 你是否希望 Agent 能根据长期经验形成可复用能力？

如果你更偏向“稳健、可控、插件化、必要时再接入”，OpenClaw 的思路更容易治理。

如果你更偏向“记忆必须成为 Agent 竞争力核心”，Hermes 的路线更有吸引力。

一句话概括：

- **OpenClaw：记忆是助手的增强件。**
- **Hermes：记忆是智能体身份的一部分。**

---

## 六、核心功能对比（三）：多模型支持能力

多模型支持已经不是锦上添花，而是现实世界里的刚需。原因很简单：

1. 成本差异巨大；
2. 不同模型擅长不同任务；
3. 供应商稳定性与政策存在波动；
4. 企业常常需要自建 endpoint 或内部网关；
5. Agent 场景比聊天场景更需要模型切换和 fallback。

### 6.1 OpenClaw：多模型支持服务于“可用性”和产品接入

OpenClaw 在 README 和 docs 中明确提到支持多家模型供应商，并提供 models 配置、CLI 配置和 model failover 文档。它的设计重点更像是：

- 用户可以选择自己熟悉、信任、已经付费的模型提供方；
- 系统提供一定的轮换与失败切换能力；
- onboarding 阶段即可配置 provider 与 key；
- 最终目标是保障个人助手可持续可用。

这说明 OpenClaw 的多模型支持是务实导向的：

- 首先让用户接得上；
- 其次保证故障时能切换；
- 再考虑不同模型在不同任务中的最优分配。

这种方式对于产品型系统是对的，因为用户真正关心的是“别断、别难配、别折腾”。

### 6.2 Hermes Agent：多模型支持是运行时解析能力的一部分

Hermes 在这方面明显更系统。官方 README 直接写明支持大量 provider，并支持通过 `hermes model` 切换，且“不需要改代码”。架构文档还明确提到：

- shared runtime resolver
- maps `(provider, model)` to `(api_mode, api_key, base_url)`
- 处理 18+ providers、OAuth、credential pool、alias resolution
- 支持不同 API mode：chat_completions / codex_responses / anthropic_messages

这意味着 Hermes 的多模型支持不是“配置文件里有几项”，而是**模型运行时抽象层的一部分**。其关键价值在于：

1. **模型切换对上层 Agent 更透明**  
   Agent loop 不需要随着 provider 变化而被迫重写。

2. **适合复杂环境部署**  
   你可以接 OpenAI、OpenRouter、自建 endpoint、NVIDIA NIM、Portal 等，适合多云/多供应商环境。

3. **对研究和实验友好**  
   更适合频繁对比模型、切换不同推理后端、做 provider A/B 实验。

4. **对多入口一致性更友好**  
   CLI、gateway、cron、ACP 都走同一套 runtime provider 解析逻辑。

### 6.3 多模型支持对比表

| 对比项 | OpenClaw | Hermes Agent |
|---|---|---|
| 多模型目标 | 让助手稳定可用、好配置、可 failover | 作为统一运行时层能力，支持自由切换 |
| 配置体验 | onboarding 友好，偏终端产品体验 | CLI/runtime 统一，偏开发平台体验 |
| provider 抽象 | 有供应商与 failover 设计 | 更完整的 provider runtime resolver |
| API 兼容层 | 面向常见模型提供方 | 明确支持多 API mode 与别名解析 |
| 适合对象 | 个人用户与助手部署者 | 平台开发者、研究者、复杂生产环境 |

### 6.4 真正应该比较的不是“支持数量”，而是“切换成本”

今天很多项目都号称支持上百模型，但从工程角度，真正关键的是：

- 切换是否需要改业务代码？
- 不同入口是否共用同一套解析逻辑？
- 有没有 fallback、alias、凭据池机制？
- 是否支持自定义 endpoint 与内部代理？

从公开文档判断，**Hermes 在模型运行时抽象上更成熟**；而 **OpenClaw 在用户配置体验和助手可用性导向上更顺手**。

---

## 七、核心功能对比（四）：插件生态与扩展模型

开源 Agent 框架能不能长期活，核心不只看内置能力，还要看它能不能形成扩展生态。插件系统如果做不好，项目越大越容易臃肿；做得好，核心反而可以越来越稳定。

### 7.1 OpenClaw：明显的“核心收缩，插件扩张”路线

OpenClaw 的 Vision 文档里有一段非常关键的话：

> Core stays lean; optional capability should usually ship as plugins.

并且它将插件分成两大类：

- **Code plugins**：深度运行时扩展
- **Bundle-style plugins**：稳定外部表面，如 skills、MCP servers、相关配置

它还明确表示，优先选择 bundle-style plugins，因为接口更稳定、安全边界更好。这一思路非常值得注意，因为它意味着 OpenClaw 在插件设计上有明显的工程约束意识：

1. 不希望核心无限膨胀；
2. 不希望所有扩展都以内嵌代码方式侵入主进程；
3. 倾向通过更稳定、边界更清晰的插件形态扩展生态；
4. 插件推广与发现更多依靠 ClawHub 这样的生态侧平台完成。

这种设计的优点是：

- 核心维护成本可控；
- 插件生态更易治理；
- 安全边界相对清晰；
- 有利于第三方生态市场化与目录化。

缺点是：

- 某些深层能力扩展可能没那么自由；
- 插件系统可能更强调“受控扩展”，而不是“你想怎么 hook 都行”；
- 对想做底层魔改的开发者来说，可能会感到边界偏硬。

### 7.2 Hermes Agent：插件、技能、MCP、工具构成多层扩展面

Hermes 的扩展体系更复杂，也更“平台味”。根据架构文档：

- 插件发现源包括用户目录、项目目录和 pip entry points；
- 插件可注册工具、hooks、CLI commands；
- memory provider 与 context engine 是专门的插件类型；
- skills 系统是长期 procedural memory 的重要组成；
- MCP 也被整合进统一运行时。

这意味着 Hermes 的扩展面至少有四层：

1. **普通插件层**：注册工具、命令、hook
2. **专用插件层**：memory provider、context engine
3. **技能层**：可被 Agent 使用、沉淀与改进的能力单元
4. **外部协议层**：MCP、ACP 等协议级扩展

这种设计非常适合搭建平台，但也意味着复杂度更高：

- 开发者需要理解多个扩展层次；
- 插件、技能、工具、MCP 之间的边界要设计清楚；
- 如果治理不好，生态会出现能力重叠与维护碎片化。

### 7.3 插件生态对比表

| 维度 | OpenClaw | Hermes Agent |
|---|---|---|
| 核心策略 | 核心瘦身，插件扩张 | 核心运行时稳定，多层扩展面并存 |
| 插件类型 | code plugin + bundle-style plugin | 通用插件 + memory/context 插件 + skills + MCP |
| 生态定位 | 偏产品生态与官方/第三方能力市场 | 偏运行时扩展与开发者生态 |
| 安全边界 | 强调 bundle-style 的稳定边界 | 强调可扩展性，灵活度更高 |
| 学习成本 | 中等 | 较高 |
| 平台潜力 | 强 | 很强 |

### 7.4 我的判断：OpenClaw 更像“插件商城思维”，Hermes 更像“运行时扩展思维”

- **OpenClaw** 倾向把插件做成围绕产品主线的能力扩展，讲究边界、稳定和生态目录；
- **Hermes** 倾向把插件视为运行时的延伸，与技能、MCP、上下文引擎共同组成可生长系统。

如果你要做的是：

- 一个面向用户的可控产品平台，OpenClaw 的插件哲学会更稳；
- 一个面向开发者与研究团队的 Agent 平台，Hermes 的多层扩展面更强大。

---

## 八、性能与扩展性：不只是快不快，而是能否持续长大

讨论 Agent 框架的性能，不能只看一次响应延迟。真正重要的是三类性能：

1. **推理路径性能**：单轮调用是否高效；
2. **系统性能**：长会话、工具调用、并发任务时能否稳定；
3. **架构扩展性能**：项目增长后，系统是否还容易扩展与维护。

### 8.1 OpenClaw 的性能侧重点：在线助手的稳定运行与接入效率

OpenClaw 的公开材料中，性能与稳定性常常与以下内容绑定：

- Gateway 持续运行；
- 多渠道消息接入；
- Dashboard/Control UI 可访问；
- 安全暴露与 DM 路由；
- first-run UX；
- 后台 daemon 模式。

这说明 OpenClaw 的性能优化重点，更像是**一个长期在线消息助手系统的系统工程问题**：

- 消息接入是否稳定；
- 网关是否能持续工作；
- 多渠道响应是否可靠；
- 配置出错是否能被 `doctor` 及时修复；
- 在长期运行中是否容易运维。

这种性能思路和纯推理平台不同。它更关心“服务有没有一直在”“入口有没有断”“用户能不能持续对话”。

因此，OpenClaw 的扩展性优势主要体现在：

- 面向更多渠道的横向扩张；
- 面向更多个人助手场景的能力扩张；
- 通过插件和渠道生态增长系统外沿。

但如果从 Agent runtime 的角度看，OpenClaw 的扩展能力更偏产品式增长，而不是底层运行时抽象式增长。

### 8.2 Hermes 的性能侧重点：上下文治理、运行时抽象与多环境扩展

Hermes 文档中明确提到一些和性能直接相关的结构：

- context compression
- prompt caching
- SQLite + FTS5
- subagents for parallel workstreams
- scripts via RPC
- multiple terminal backends
- trajectory compression

这说明 Hermes 对性能的理解不仅是“调用更快”，而是：

1. **长上下文如何压缩与缓存**  
   对 Agent 而言，真正的性能瓶颈往往不是工具，而是上下文越来越大。Hermes 把 context compressor 与 prompt caching 做成架构级模块，这非常关键。

2. **状态持久化如何低成本查询**  
   SQLite + FTS5 对单机或轻量部署来说，是一种性价比很高的选择：简单、可靠、支持全文检索，不需要一上来就引入重数据库。

3. **复杂任务如何并行与脚本化**  
   子代理与脚本接口，让一些多步骤任务可以从“一轮轮对话控制”转成“并行执行 + 汇总返回”，这直接降低了上下文成本。

4. **运行环境如何解耦**  
   通过多 terminal backend，Hermes 能把执行环境从本地扩展到容器、远端、serverless 等位置，这是一种典型的平台扩展性设计。

### 8.3 性能与扩展性对比表

| 维度 | OpenClaw | Hermes Agent |
|---|---|---|
| 性能重点 | Gateway 稳定、消息接入、长期在线 | 上下文压缩、缓存、并行执行、运行时抽象 |
| 长会话治理 | 依赖产品侧策略与能力演进 | 明确有 context compression 与 session lineage |
| 并行/子任务 | 更偏助手工作流执行 | 有 delegate/subagent 与脚本化能力 |
| 存储策略 | 偏助手系统状态与配置 | SQLite + FTS5 + lineage，更像统一状态层 |
| 执行环境扩展 | 偏用户设备与网关部署 | local/docker/ssh/modal/daytona/singularity |
| 扩展路径 | 产品生态与渠道生态扩张 | 运行时、插件、技能、后端全维扩张 |

### 8.4 一个关键判断：Hermes 更像“能越长越大”的底层，OpenClaw 更像“能越用越顺”的产品

这是我认为两者在性能与扩展性上的最本质差异：

- **OpenClaw 擅长让一个个人助手系统稳定在线、接入现实渠道、越用越像产品。**
- **Hermes 擅长让一个 Agent 系统在能力、状态、后端和执行模式上不断外延，越长越像平台。**

所以如果你的系统未来可能要：

- 接更多执行环境；
- 引入子代理并行；
- 做长期会话检索；
- 接多个研究实验模型；
- 让插件系统深度参与 Agent loop；

Hermes 的扩展天花板更高。

但如果你的目标更像：

- 给自己或团队部署一个现实可用的常驻 AI 助手；
- 通过消息渠道稳定服务；
- 优先解决配网、接入、控制面、运维和安全；

那么 OpenClaw 的系统结构会更省心。

---

## 九、社区活跃度与生态信号

技术选型不能只看代码设计，还要看“项目是不是活的”。一个再漂亮的架构，如果没有持续维护、文档更新、社区活跃和生态增长，长期风险会非常高。

### 9.1 GitHub 仓库公开数据对比

基于公开 GitHub 仓库元数据，可以看到以下信息：

| 项目 | OpenClaw | Hermes Agent |
|---|---:|---:|
| GitHub 仓库 | `openclaw/openclaw` | `NousResearch/hermes-agent` |
| Stars | 376052 | 175844 |
| Forks | 78542 | 29966 |
| Open Issues | 7024 | 16213 |
| Watchers/Subscribers | 1817 | 684 |
| 默认分支 | main | main |
| 最近推送时间 | 2026-06-01 | 2026-06-01 |
| 仓库创建时间 | 2025-11-24 | 2025-07-22 |

> 注：这些数字反映的是抓取时点的公开仓库元数据。Star 并不等于工程质量，但能反映项目传播力与社区关注度；issue 数量则需要结合维护方式理解，不宜简单视为负面。

从这些数据可以看出几个有意思的现象：

1. **两者都非常活跃**  
   最近推送时间都很新，说明都处在快速迭代周期。

2. **OpenClaw 的外部关注度更高**  
   stars、forks、subscribers 都更高，说明其“个人 AI 助手”叙事更容易传播，也更容易吸引终端用户和泛开发者关注。

3. **Hermes 的 issue 数更高**  
   这不一定意味着质量差，也可能说明：
   - 功能面更复杂；
   - 使用场景更广；
   - 社区反馈更活跃；
   - 平台型项目天然有更多边界问题要处理。

### 9.2 文档信号：谁更偏产品、谁更偏开发平台

从文档结构也能看出明显差异。

**OpenClaw 文档特征：**

- Getting Started、Install、Channels、Gateway、CLI、Help 分层清楚；
- 大量篇幅用于 onboarding、dashboard、channel pairing、安全暴露；
- 文档像产品说明书与部署手册。

**Hermes 文档特征：**

- Architecture、Agent Loop、Prompt Assembly、Provider Runtime、Session Storage 等开发者内容非常系统；
- Feature 文档覆盖工具、memory、MCP、cron、skills、context files 等；
- 文档像开发者平台手册与运行时说明。

这也印证了前面的判断：

- OpenClaw 更像“面向用户的助手产品 + 工程系统”；
- Hermes 更像“面向开发者的 Agent 基础设施 + 产品接口”。

### 9.3 社区生态成熟度如何看

判断一个开源项目的社区成熟度，我通常看五个信号：

1. **是否有清晰的 onboarding 路径**
2. **是否有可读的架构文档**
3. **是否有明确的扩展模型**
4. **是否有生态目录或集成标准**
5. **是否有多入口、多场景的真实落地痕迹**

这五项上，两者都不弱，但强项不同：

| 信号 | OpenClaw | Hermes Agent |
|---|---|---|
| onboarding 友好度 | 很强 | 强 |
| 架构文档深度 | 中上 | 很强 |
| 扩展模型清晰度 | 强 | 很强 |
| 生态目录/标准 | ClawHub 方向明显 | skills + MCP + 插件标准化明显 |
| 多场景落地能力 | 渠道/设备接入极强 | CLI/Gateway/Cron/IDE 协同极强 |

### 9.4 社区活跃度的风险提示

这里也要提醒一点：

- **高 star 不等于低风险**；
- **高 issue 不等于项目差**；
- **文档多不等于边界稳定**；
- **快速迭代意味着 API、插件接口、配置方式都可能变化。**

尤其是 AI Agent 框架仍处于高速迭代期，很多设计还没有像 Web 框架那样沉淀十年。所以，选型时不能只看“今天功能多不多”，还要看：

- 我的系统是否能承受升级带来的变化；
- 我是否能跟进插件 API 或配置迁移；
- 我更需要“早期能力红利”还是“长期接口稳定性”。

---

## 十、典型场景分析：不同问题，答案完全不同

到了这里，很多人还是会问一句：“所以到底该选哪个？”

真正专业的回答一定是：**看你的问题是什么。**

下面我按典型场景来给出建议。

### 10.1 场景一：给自己部署一个长期在线的个人 AI 助手

需求特征：

- 希望在 Telegram、WhatsApp、Slack、Discord 等渠道直接聊天；
- 希望有 dashboard 或控制面；
- 希望配置尽量简单，能快速跑起来；
- 希望系统像一个真实助手一样常驻在线；
- 对安全暴露、DM pairing、allowlist 比较敏感。

**建议优先：OpenClaw**

原因很直接：

1. 产品定位和你的目标高度一致；
2. 渠道支持更突出；
3. Gateway 与 daemon 运行方式更成熟；
4. Onboarding、doctor、dashboard 这类产品化能力更适合个人部署；
5. 安全默认值与外部暴露策略更贴近真实通信场景。

如果你最在意的是“像一个真正的个人助手一样工作”，OpenClaw 的完成度会更对味。

### 10.2 场景二：做一个可扩展的企业内部 Agent 平台原型

需求特征：

- 不只是聊天，还要工具、记忆、插件、调度；
- 未来可能接内部模型网关、向量检索、私有 MCP 服务；
- 希望多个入口共用同一 Agent 核心；
- 希望后面能接 cron、IDE、脚本任务甚至子代理。

**建议优先：Hermes Agent**

原因是：

1. AIAgent Core 抽象更统一；
2. 工具系统、session storage、memory system、context engine 都更“平台化”；
3. provider runtime 和多 backend 让它更适合作为企业内部 Agent runtime；
4. 插件层次清晰，适合按模块逐步内化定制。

如果你的目标不是“装一个助手”，而是“搭一个平台”，Hermes 更合适。

### 10.3 场景三：做研究型 Agent、关注长期记忆和技能演化

需求特征：

- 关心 Agent 是否能从经验中沉淀能力；
- 希望跨会话检索和用户建模；
- 需要 trajectory、skills、context compression 之类的研究友好能力；
- 可能要做模型对比、工具轨迹采样或训练数据回流。

**建议明显偏向：Hermes Agent**

这是 Hermes 的主场。它从叙事到架构都在强调：

- learning loop
- skills self-improve
- search past conversations
- user model
- trajectories
- compression and caching

OpenClaw 当然也可以用于这类方向，但它的系统第一优先级不是这个。

### 10.4 场景四：希望最短时间做出可见的 AI 助手产品 Demo

需求特征：

- 要向非技术团队、老板或客户展示；
- 要有渠道、有 UI、有在线感；
- 要让人觉得“这不是命令行玩具”；
- 短期内不追求极致平台化。

**建议优先：OpenClaw**

因为它更容易呈现“一个完整助手产品”的观感。Demo 不是论文答辩，很多时候“能接消息、能控制、能在线”比底层抽象更容易让业务方理解价值。

### 10.5 场景五：需要在 CLI、消息、定时任务、IDE 中共用一个 Agent 内核

需求特征：

- 同一个 Agent 要服务多个入口；
- 需要在 Cron 中自动执行任务；
- 希望在 IDE 里也能接入同一 Agent；
- 希望会话、工具、模型配置在不同入口之间复用。

**建议优先：Hermes Agent**

Hermes 文档中这套多入口统一核心的设计非常明确，而且不是“未来规划”，而是已写进架构说明的现实结构。

### 10.6 场景六：对安全边界和对外暴露非常敏感

需求特征：

- Agent 会接触真实联系人或真实消息渠道；
- 未授权用户可能向系统发消息；
- 需要对 pairing、allowlist、暴露策略进行细粒度管控；
- 希望系统对运维人员也足够“显式”。

**建议偏向：OpenClaw**

它在安全文档、默认策略、doctor 检测、DM pairing 等方面的叙事更集中，更像一个真正暴露在现实通信面的产品。

当然，Hermes 也有安全与审批机制，但如果场景核心是“对外通信渠道安全”，OpenClaw 的产品心智更直接。

---

## 十一、选型建议：从五个问题做最终判断

为了让这篇文章更落地，我把选型问题压缩成五个关键判断题。你可以直接拿去做团队内部评审。

### 问题一：你要的是“助手产品”还是“Agent 平台”？

- 如果要的是**助手产品**：选 OpenClaw 的概率更高。
- 如果要的是**Agent 平台**：选 Hermes 的概率更高。

这是最重要的问题。很多团队选错框架，不是因为功能看错，而是因为目标定义错了。

### 问题二：你最关心接入现实渠道，还是最关心 Agent 长期成长？

- 重渠道接入、消息平台、个人助手在线：OpenClaw
- 重长期记忆、技能演进、跨会话认知：Hermes

### 问题三：你要不要把框架当作长期可扩展底座？

- 如果只是做一个可用助手，OpenClaw 很够用；
- 如果要在其上继续长出更多内部能力，Hermes 更适合作为底座。

### 问题四：你的团队能力结构偏产品工程，还是偏平台工程？

- 偏产品工程团队，通常更容易驾驭 OpenClaw；
- 偏平台工程/基础设施/研究团队，通常更容易发挥 Hermes 的价值。

### 问题五：你能接受多高的系统复杂度？

- 想快速见效、少做底层治理：OpenClaw
- 愿意为更强的长期能力承担更高复杂度：Hermes

### 最终建议矩阵

| 你的优先级 | 更推荐 |
|---|---|
| 个人 AI 助手、渠道接入、产品感、上线快 | OpenClaw |
| 长期记忆、技能沉淀、多入口统一、平台底座 | Hermes Agent |
| 安全暴露、DM 配对、消息入口治理 | OpenClaw |
| 研究型 Agent、自学习、轨迹与上下文治理 | Hermes Agent |
| 给非技术用户交付可感知产品 | OpenClaw |
| 给技术团队交付可扩展运行时 | Hermes Agent |

---

## 十二、如果我是架构师，会怎么选？

如果我是一个个人开发者，想给自己搞一个长期在线的 AI 助手，能接 Telegram、Slack、WhatsApp，还能在手机上直接聊，我大概率会先选 **OpenClaw**。因为它更像一个“可以立即进入生活”的系统。它的价值不是抽象上的优雅，而是“真的像助手”。

如果我是一个平台架构师，要给团队做一个可持续迭代的 Agent 平台，未来要接模型网关、私有工具、MCP、定时任务、IDE 集成、子代理并行、长期记忆和任务经验沉淀，我会更倾向 **Hermes Agent**。因为它给我的不是一个成品壳子，而是一套具备继续生长空间的 Agent runtime。

更进一步说：

- **OpenClaw 适合把 AI 带到人已经在的地方；**
- **Hermes 适合把 Agent 变成一个可以长期演进的系统。**

这两句话，基本就是本文最核心的结论。

---

## 十三、总结：不是谁替代谁，而是谁更适合你的路线

OpenClaw 和 Hermes Agent 都代表了 2026 年开源 AI Agent 框架的较高水位，但它们并不是同质化竞争关系。

### 用一句话概括 OpenClaw

**OpenClaw 是一个强调现实沟通渠道接入、长期在线、安全默认值与产品完成度的个人 AI 助手框架。**

它更擅长：

- 个人助手场景
- 多消息平台接入
- Gateway 控制与守护进程式运行
- Onboarding、Dashboard、Doctor 等产品化能力
- 面向现实通信面暴露的安全治理

### 用一句话概括 Hermes Agent

**Hermes Agent 是一个强调长期记忆、技能学习、统一 Agent Core、多模型运行时与平台扩展性的智能体运行时框架。**

它更擅长：

- 多入口共用核心
- 强工具运行时抽象
- 长期记忆与会话检索
- 技能系统与学习闭环
- 插件、MCP、上下文引擎、子代理等高级扩展

### 最后给出一个简洁版结论

如果你是：

- **个人用户 / 产品原型团队 / 强渠道接入需求** → 选 **OpenClaw**
- **平台团队 / 研究团队 / 需要长期演化的 Agent 基础设施** → 选 **Hermes Agent**

在开源 AI Agent 框架进入深水区之后，真正的选型能力不再是“比功能列表”，而是看清楚项目的第一性目标、系统重心和未来增长路径。OpenClaw 与 Hermes Agent 恰好给了我们一个非常典型的对照样本：

- 一个告诉你，Agent 应该像真实助手一样进入现实世界；
- 一个告诉你，Agent 应该像长期存在的系统一样不断积累与成长。

而你的选型，最终取决于你更想解决哪一个问题。

## 相关阅读

- [OpenClaw 记忆系统实战：MEMORY.md 长期记忆与日常记忆管理](/categories/架构/OpenClaw-记忆系统实战-MEMORY-md-长期记忆与日常记忆管理/)
- [OpenClaw 模型策略实战：多模型路由与成本优化](/categories/架构/OpenClaw-模型策略实战-多模型路由与成本优化/)
- [OpenClaw 技能开发实战：自定义 Skill 与工作流自动化](/categories/架构/OpenClaw-技能开发实战-自定义-Skill-与工作流自动化/)
