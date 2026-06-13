---
title: OpenHuman vs Hermes vs OpenClaw：三大开源 AI Agent 框架深度对比
date: 2026-06-02 12:00:00
tags: [AI Agent, OpenHuman, Hermes, OpenClaw, 框架对比, 开源, 选型]
keywords: [OpenHuman vs Hermes vs OpenClaw, AI Agent, 三大开源, 框架深度对比, 架构]
description: "本文围绕 OpenHuman、Hermes、OpenClaw 三大开源 AI Agent 框架做系统深度对比，从架构设计哲学、安装配置、核心能力（模型支持、工具系统、记忆机制、多平台集成）、性能基准到适用场景全面展开，结合代码示例与踩坑经验，帮助开发者与架构师判断：长期自治智能体、可插件化 Agent 运行时、个人 AI 助手平台三条路线分别适合什么业务需求。"
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---


# OpenHuman vs Hermes vs OpenClaw：三大开源 AI Agent 框架深度对比

过去一年，AI Agent 已经不再只是“大模型 + 几个工具函数”的轻量包装，而开始分化成三种截然不同的路线：

- 一类把重点放在**长期记忆、自治执行与外部集成**，希望走向“可持续运行的超级智能体”；
- 一类强调**运行时抽象、技能沉淀、插件化与多入口统一**，试图成为 Agent 的通用操作系统；
- 还有一类更看重**个人助手体验、多平台消息接入与长期在线**，把 Agent 做成真实可用的数字分身。

如果把这三条路线分别找一个足够有代表性的开源项目，那么 **OpenHuman、Hermes、OpenClaw** 基本就是绕不开的名字。

很多开发者第一次接触这三个项目时，都会有一种“它们看起来都像 AI Agent 框架，但又完全不是一回事”的感觉。这个判断其实是对的。三者都具备模型接入、工具调用、状态管理、平台集成等共性能力，但它们回答的问题并不一样：

- **OpenHuman** 更像“面向长期自治与外部世界协同的超级智能体框架”；
- **Hermes** 更像“可自我成长、可插件化、可跨入口复用的 Agent 运行时”；
- **OpenClaw** 更像“面向现实消息渠道与个人工作流的长期在线 AI 助手平台”。

也正因为如此，简单用“谁更强”来评价它们意义不大。真正值得回答的问题应该是：

1. 三者的架构核心分别是什么？
2. 它们在安装、配置、扩展、运维成本上有什么差别？
3. 模型支持、工具系统、记忆能力、多平台集成、社区生态分别走了哪条技术路线？
4. 在真实落地中，谁更适合个人助手、谁更适合研究平台、谁更适合作为团队级 Agent 基座？
5. 如果你已经写过一篇 OpenClaw vs Hermes 的双框架对比，那么在加入 OpenHuman 之后，整个选型坐标系会发生什么变化？

本文会从**架构设计、安装配置、核心能力、性能基准、适用场景、踩坑经验**六条主线展开，并尽量避免泛泛而谈，而是给出带工程语境的判断、代码示例和实战视角。

需要提前说明两点：

- 这不是一篇“官方宣传页翻译”，而是一篇面向工程选型的技术分析；
- 由于开源 Agent 项目迭代非常快，本文会尽量区分“设计目标”“当前可见能力”“工程上可推断的边界”，避免把愿景直接等同于现实能力。

---

## 一、先给结论：三者不是同一赛道上的简单替代品

如果只看 README，很多人会把它们都归类为“AI Agent 框架”。但从系统目标来看，它们更像是三个不同方向的解法：

| 框架 | 更接近什么 | 核心目标 |
|---|---|---|
| OpenHuman | 超级智能体框架 / 自治执行系统 | 构建具备长期记忆、资源调度、广泛集成和持续运行能力的智能体 |
| Hermes | Agent Runtime / Agent OS | 构建可学习、可记忆、可扩展、可跨入口运行的统一 Agent 核心 |
| OpenClaw | 个人 AI 助手平台 | 把 AI 助手放进真实消息渠道和个人设备中长期在线运行 |

一句话概括：

- 想做**长期自治、偏“超级智能”叙事、重记忆树和集成能力**，先看 OpenHuman；
- 想做**可插件化、可技能沉淀、可多入口共用核心的 Agent 平台**，先看 Hermes；
- 想做**真实可用的个人助手、强调消息平台接入和产品体验**，先看 OpenClaw。

如果再压缩成更工程化的判断：

- **OpenHuman 适合“智能体能力纵深优先”的团队**；
- **Hermes 适合“Agent 基础设施和长期演化优先”的团队**；
- **OpenClaw 适合“个人 AI 助手产品化和渠道上线优先”的团队**。

这篇文章后面所有对比，其实都围绕这个总判断展开。

---

## 二、三大框架的产品定位与设计哲学

### 2.1 OpenHuman：从“超级智能体系统”出发

OpenHuman 的叙事核心非常鲜明：它不是只想成为一个聊天机器人壳子，也不是只想做一个脚本编排器，而是希望构建一套**可长期运行、可持续记忆、可外部行动、可管理资源预算**的智能体框架。

从已有文档、文章和功能设计来看，OpenHuman 的几个关键关键词是：

- **Memory Tree**：把记忆从聊天历史升级为结构化、层级化、可生长的记忆树；
- **Token Juice**：把 token 与推理预算看成一种可调度资源，而不是简单上限；
- **Integrations**：把 Gmail、Notion、GitHub、Slack、Obsidian、文件系统、Webhook 等外部世界接入统一智能体运行时；
- **AutoFetch / 持续感知**：让 Agent 不是被动等输入，而是主动拉取环境上下文；
- **多模态与多模型策略**：让模型调用服务于任务，而不是围着单一模型转。

OpenHuman 的哲学可以概括为：

> 不是让模型多回答一点问题，而是让智能体在有限资源下长期、持续、可演化地工作。

这会带来两个直接结果：

1. 它更关注**长期任务连续性**，而不是单轮响应的“看起来很聪明”；
2. 它更重视**记忆组织、预算管理、外部集成**，而不是只强调工具调用数量。

这种路线非常适合那些想把 Agent 用成“长期运行的数字员工”或“个人超级智能系统”的团队。

### 2.2 Hermes：从“自我成长的 Agent Runtime”出发

Hermes 的定位同样很明确：它把自己视为 **self-improving AI agent**。这意味着 Hermes 的重点不只是执行任务，而是让 Agent 在任务中**形成技能、积累记忆、跨会话成长**。

Hermes 的设计哲学有几个非常明显的特征：

- **统一 Agent Core**：CLI、Gateway、Cron、IDE/ACP 等入口复用同一个 AIAgent 核心；
- **Skill 是一等公民**：技能不是一段提示词，而是可以沉淀、复用、迭代的能力对象；
- **插件化运行时**：模型提供者、记忆后端、上下文压缩、工具集、终端后端都可以替换或扩展；
- **状态连续性**：使用 SQLite + FTS5 等方式管理会话、检索历史、构建用户模型；
- **自我改进闭环**：从经验中提炼技能、从对话中形成用户画像、从执行中优化行为策略。

如果用一句更偏系统架构的话来形容：

> Hermes 想做的不是“一个带 UI 的 Agent”，而是“一个 Agent 操作系统”。

因此，Hermes 最吸引人的地方并不是“它能接多少平台”，而是**它的运行时边界定义得很清楚**：

- 入口在哪里进来；
- 核心 loop 如何运行；
- 工具如何注册和调度；
- 记忆如何存储与检索；
- 技能如何沉淀和复用；
- 插件如何扩展系统能力。

对于开发者、平台团队、研究者来说，这种设计比单纯的“产品完成度”更重要。

### 2.3 OpenClaw：从“长期在线的个人助手”出发

OpenClaw 和前两者最大的差异，是它明显更接近一个**现实可用的个人 AI 助手平台**。

它的关键设计重心不在“如何把 Agent 做成研究平台”，而在“如何让一个 AI 助手真正进入现实通信网络并长期在线”。这背后有几个非常鲜明的侧重点：

- **多消息平台接入**：Telegram、WhatsApp、Slack、Discord、Matrix、Signal、QQ、WeChat 等；
- **Gateway 中心化路由**：把渠道接入、会话配对、消息路由、守护进程运维集中起来；
- **控制面与 onboarding**：Dashboard、Doctor、Pairing、安全检查等都更产品化；
- **安全默认值**：allowlist、DM pairing、暴露 runbook 等现实世界可运维能力；
- **个人设备与渠道中的“常驻存在感”**：把助手放进你日常工作的消息流，而不是让你迁移到新的 UI。

所以 OpenClaw 的哲学更像：

> AI 助手必须首先存在于真实世界的消息与设备网络中，然后再谈更高级的 Agent 能力。

这条路线在“个人助手、团队沟通机器人、渠道运营助手”里会非常有优势。

### 2.4 三者设计哲学的本质差异

这三者的根本差异，不在“是否支持工具调用”，而在于**系统第一性目标**不同：

| 维度 | OpenHuman | Hermes | OpenClaw |
|---|---|---|---|
| 第一目标 | 长期自治与超级智能体 | 自我成长的 Agent Runtime | 真实世界中的个人 AI 助手 |
| 优先级 | 记忆、预算、集成、持续执行 | Agent Core、技能、记忆、插件 | 渠道接入、控制面、安全、产品体验 |
| 用户画像 | 重自治任务的开发者/研究者 | 平台工程师/开发者/研究者 | 个人用户、独立开发者、消息驱动团队 |
| 工程风格 | 智能体能力中心 | 运行时中心 | 产品系统中心 |

理解这一点之后，后续所有能力对比就更容易理解了：同样是“记忆”，OpenHuman、Hermes、OpenClaw 的实现重点根本不同；同样是“平台集成”，三者也在不同层面发力。

---

## 三、总体架构对比：三种系统重心，三种边界划分

这一部分是全文最关键的内容之一。因为真正影响后续可扩展性的，不是单个功能点，而是架构边界画得是否合理。

### 3.1 OpenHuman 架构：围绕记忆、预算与集成的自治执行系统

OpenHuman 的系统可以抽象为五层：

1. **模型与推理层**：对接 OpenAI、Anthropic、Gemini、本地模型或兼容端点；
2. **推理调度层**：通过 Token Juice、模型路由、上下文裁剪决定怎么“花智能预算”；
3. **记忆层**：通过 Memory Tree 组织长期记忆、事实、偏好、任务状态和摘要；
4. **集成层**：通过大量 Integrations 连接 Gmail、Notion、GitHub、Slack、Obsidian、数据库、文件系统、Webhook；
5. **执行与反馈层**：负责任务计划、动作执行、状态回写、失败恢复、定期拉取上下文。

可以把 OpenHuman 简化理解为下面这个结构：

```text
用户目标 / 外部事件 / 定时触发
            │
            ▼
      OpenHuman Agent Core
            │
   ┌────────┼───────────────┬───────────────┐
   ▼        ▼               ▼               ▼
Memory Tree Token Juice   Integrations     Action Loop
   │        │               │               │
   │        ├── 模型选择     ├── Gmail       ├── 规划
   │        ├── 上下文裁剪   ├── Notion      ├── 执行
   │        ├── 成本控制     ├── GitHub      ├── 反思
   │        └── 深度分配     ├── Slack       └── 回写记忆
   │                        └── Obsidian
   ▼
长期记忆 / 用户画像 / 项目知识 / 摘要节点
```

这个架构最有特色的地方有三点：

- **Memory Tree 不只是存储，而是上下文编排入口**；
- **Token Juice 不只是预算统计，而是认知资源调度器**；
- **Integrations 是智能体行动的外部接口，而不是“顺手接几个插件”**。

因此 OpenHuman 更像一个面向长期自治的 Agent 执行系统。

### 3.2 Hermes 架构：以统一 Agent Loop 为中心的运行时

Hermes 的架构边界比 OpenHuman 更“运行时化”。它会把问题拆成：

- 入口如何进入系统；
- 统一 Agent Core 如何执行业务；
- 工具如何被发现与调度；
- 状态如何被持久化；
- 记忆与技能如何沉淀；
- 插件如何扩展能力；
- 模型提供者如何声明、切换、降级。

简化结构如下：

```text
CLI / Gateway / Cron / ACP / IDE / API
                 │
                 ▼
            AIAgent Core
                 │
   ┌─────────────┼─────────────────┬────────────────┐
   ▼             ▼                 ▼                ▼
Prompt System  Tool Runtime     Memory & Skills   Session Store
                 │                 │                │
                 ├── Terminal      ├── 用户画像     ├── SQLite
                 ├── Browser       ├── 长期记忆     ├── FTS5
                 ├── File          ├── Skills       ├── lineage
                 ├── MCP           └── Plugins      └── search
                 └── Delegate
                         │
                         ▼
                Provider Profiles / Context Compression
```

Hermes 的最大特点是：**很多部件都可以替换，但核心 loop 保持统一。**

这使它具备几个优势：

- 更适合做平台层扩展；
- 更适合多入口统一能力治理；
- 更适合把“技能、插件、模型配置、终端后端”纳入同一运行时；
- 更适合在团队内逐步演化，而不是一次性写死产品形态。

### 3.3 OpenClaw 架构：以 Gateway 为中心的个人助手系统

OpenClaw 的系统中心不是 Agent Core 本身，而是 **Gateway + 渠道接入 + 控制平面**。

其结构更接近：

```text
Telegram / WhatsApp / Slack / Discord / QQ / WeChat / iMessage ...
                              │
                              ▼
                      OpenClaw Gateway
                              │
          ┌───────────────────┼──────────────────────┐
          ▼                   ▼                      ▼
     Pairing/Auth        Dashboard/Doctor       Message Routing
          │                   │                      │
          └───────────────────┴──────────────┬───────┘
                                             ▼
                                     Agent Execution Layer
                                             │
                               Model Providers / Tools / Skills
```

OpenClaw 更像一个“围绕现实世界消息接入的 Agent 产品骨架”。

优点非常清晰：

- 进入真实使用场景快；
- 多渠道覆盖广；
- 控制面和运维能力较成熟；
- 安全考虑比较贴近长期在线服务。

但它的代价也明显：

- 某些能力抽象未必像 Hermes 那样纯粹；
- 在“记忆和技能”这类 Agent 核心层面，未必像 OpenHuman 或 Hermes 那样把它做到架构中心；
- 如果你的目标是做一个强平台化 Agent 内核，OpenClaw 的重心可能偏产品外壳而非 Agent runtime 本体。

### 3.4 架构层面的优劣势判断

如果站在系统设计角度给出评价：

- **OpenHuman 的架构强在“智能体行为纵深”**；
- **Hermes 的架构强在“运行时抽象清晰”**；
- **OpenClaw 的架构强在“产品化接入与现实部署”**。

因此你会发现，它们不是单纯在同一个表格里打分高低，而是**在不同坐标轴上拉满**。

---

## 四、安装与配置：谁更快上手，谁更适合长期维护

从工程实践角度，安装体验往往决定一个项目能否被团队真正采用。Agent 框架很容易陷入“概念很强，安装半天跑不起来”的尴尬。

### 4.1 OpenHuman 安装配置思路

OpenHuman 的安装通常涉及几个层面：

1. Node.js / Python / Rust / 桌面运行时（如果涉及客户端）等基础依赖；
2. 模型供应商 API Key 或本地模型服务；
3. 外部 Integrations 的 OAuth 或 API 凭证；
4. Memory Tree、Token Juice 等运行参数初始化；
5. 本地工作目录、数据目录、日志配置。

一个典型的最小安装思路可能长这样：

```bash
# 1. 克隆项目
git clone https://github.com/<org>/openhuman.git
cd openhuman

# 2. 安装依赖
uv venv
source .venv/bin/activate
uv sync

# 3. 配置环境变量
cp .env.example .env
# 编辑 OPENAI_API_KEY / ANTHROPIC_API_KEY / GITHUB_TOKEN 等

# 4. 初始化本地数据
python -m openhuman init

# 5. 启动
python -m openhuman run
```

如果是桌面版或 Tauri/CEF 构建路线，则会多出前端与桌面容器构建链。

OpenHuman 的难点不在“装不上”，而在于：

- 一旦你启用大量 Integrations，配置复杂度会上升很快；
- 如果你想真正发挥 Memory Tree 或 AutoFetch 的价值，需要理解它的记忆组织和任务策略，而不仅仅是填几个 API Key；
- 多模型路线、外部服务授权、知识库同步机制比普通聊天应用更复杂。

**结论**：OpenHuman 的安装适合愿意花时间做系统级配置的用户，不适合只想“十分钟跑一个聊天机器人”的人。

### 4.2 Hermes 安装配置思路

Hermes 的安装通常相对更“工程化”一些，因为它的文档天然围绕 CLI、Gateway、Cron、Profile、Plugin 等构件展开。

一个简化的典型流程如下：

```bash
# 安装 Hermes Agent
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

# 或使用 Python/uv 管理环境
uv venv
source .venv/bin/activate
uv pip install hermes-agent

# 初始化配置
hermes init

# 配置 provider profile
mkdir -p ~/.hermes/providers
cat > ~/.hermes/providers/openai.yaml <<'YAML'
version: 1
providers:
  openai_primary:
    driver: openai
    connection:
      base_url: https://api.openai.com/v1
      api_key_env: OPENAI_API_KEY
    defaults:
      model: gpt-4.1
      temperature: 0.2
YAML

# 运行 CLI Agent
hermes chat
```

Hermes 的安装体验通常比较稳定，但它的学习成本主要来自：

- ProviderProfile、插件、技能、cron、gateway 这些模块较多；
- 如果你只想“马上看到效果”，会觉得概念层次稍多；
- 一旦做深度扩展，理解它的运行时结构反而是优势。

**结论**：Hermes 的安装不是最轻量，但“结构清晰、后续可维护性强”是它的优势。

### 4.3 OpenClaw 安装配置思路

OpenClaw 的安装重点不只是依赖安装，而是**把 Gateway、渠道接入、配对授权、守护进程运行、安全暴露**整套链路配置起来。

典型流程会更像：

```bash
# 克隆仓库
git clone https://github.com/<org>/openclaw.git
cd openclaw

# 安装依赖
pnpm install

# 启动 gateway
pnpm gateway:start

# 打开 dashboard 完成 onboarding
# 配置 Telegram / Slack / Discord / WhatsApp 等渠道
# 配置 allowlist、pairing、daemon
```

OpenClaw 的上手体验有一个很大的优点：

- 一旦你按官方路径配好，**非常容易看到“AI 助手真的出现在消息渠道里”** 的成就感；
- 对个人用户或独立开发者来说，这种可见反馈非常强。

但它也有典型难点：

- 每个消息平台都有各自的授权、Webhook、回调限制；
- 本地暴露到公网的安全策略要认真处理；
- 部分平台的风控、连接稳定性、消息重复投递、速率限制都要踩一遍。

**结论**：OpenClaw 上手“可见性”最好，但多渠道接入导致的运维复杂度也最高。

### 4.4 安装配置对比总结

| 维度 | OpenHuman | Hermes | OpenClaw |
|---|---|---|---|
| 首次上手难度 | 中高 | 中 | 中高 |
| 跑通最小 Demo | 中 | 较快 | 较快 |
| 深度配置复杂度 | 高 | 中高 | 高 |
| 多平台授权复杂度 | 中高 | 中 | 很高 |
| 长期可维护性 | 高，但依赖架构理解 | 很高 | 取决于渠道数量 |

如果你看重“跑通一条最小链路”：

- Hermes 最均衡；
- OpenClaw 最容易快速看到“产品效果”；
- OpenHuman 最值得在理解后深入，但不是最轻量起步路线。

---

## 五、核心能力对比之一：模型支持与推理策略

模型支持绝不是“能填多少 API Key”的问题，而是以下这些工程能力的组合：

- 支持哪些供应商和模型；
- 是否支持 OpenAI Compatible 路线；
- 是否支持本地模型；
- 是否支持工具调用、视觉、流式输出、JSON 模式；
- 是否能做任务级路由、降级和成本治理；
- 是否能根据任务自动切模型，而不是写死单模型。

### 5.1 OpenHuman：模型服务于“预算与任务深度”

OpenHuman 的模型支持逻辑通常不是简单地“提供者列表”，而是和 **Token Juice + 模型路由**强绑定。

也就是说，在 OpenHuman 里，模型不仅是后端资源，更是执行策略的一部分。典型能力包括：

- 快速模型处理常规总结和归类；
- 强推理模型处理复杂规划和高价值任务；
- 视觉模型处理图片、界面或多模态上下文；
- 根据预算和任务优先级决定是否进入深思模式。

一个伪代码示例如下：

```python
from openhuman.runtime import TaskRouter

router = TaskRouter()

model = router.select_model(
    task_type="research_and_write",
    urgency="medium",
    budget="balanced",
    requires_vision=False,
    reasoning_depth="high"
)

result = model.run("分析三个 AI Agent 框架并生成提纲")
```

OpenHuman 的优势在于：

- 强调模型调用和任务价值挂钩；
- 比较容易和成本治理、上下文管理联动；
- 更适合长期自治任务，而不是只做即时问答。

### 5.2 Hermes：声明式 Provider 管理最成熟

Hermes 在模型管理上的特色是 **ProviderProfile**。这不是简单的环境变量文件，而是一个声明式的模型提供者抽象。

例如：

```yaml
version: 1
providers:
  openai_primary:
    driver: openai
    priority: 100
    connection:
      base_url: https://api.openai.com/v1
      api_key_env: OPENAI_API_KEY
    defaults:
      model: gpt-4.1
      temperature: 0.2
    model_aliases:
      fast: gpt-4.1-mini
      strong: o3
    failover:
      strategy: ordered
      candidates:
        - anthropic_fallback
```

它的好处是：

- 模型提供者配置有统一语义；
- 可以声明优先级、降级链、hooks、能力标记；
- 团队协作时比“写死在代码里”更可维护；
- 为多环境、多项目、多 provider 路由打下基础。

如果你的团队真正把 Agent 当作长期系统来运营，那么 Hermes 这一层抽象会非常值钱。

### 5.3 OpenClaw：模型能力服务于“长期在线助手体验”

OpenClaw 的模型支持并不是弱，而是更偏产品使用导向：

- 聊天类模型处理日常交互；
- 可能结合工具调用完成消息平台中的任务；
- 路由策略更多是为了平衡响应速度、体验和成本。

如果从产品视角看，这是合理的：个人助手最怕的不是少几个高级配置，而是**响应慢、上下文不稳、渠道体验差**。

因此 OpenClaw 的模型支持路线更强调：

- 稳定；
- 快速；
- 能和渠道交互体验一致；
- 对接成本可控。

### 5.4 模型支持维度横评

| 维度 | OpenHuman | Hermes | OpenClaw |
|---|---|---|---|
| 多供应商接入 | 强 | 强 | 中强 |
| 本地模型兼容 | 中强 | 强 | 中 |
| 声明式配置 | 中 | 很强 | 中 |
| 路由/降级能力 | 强 | 很强 | 中强 |
| 成本治理 | 很强 | 强 | 中 |
| 面向复杂任务的模型编排 | 很强 | 强 | 中 |

**结论**：

- 想做“模型是可编排资源”的系统，OpenHuman 和 Hermes 更强；
- 想做“助手稳定在线、体验自然”的系统，OpenClaw 已经够用；
- 在声明式治理上，Hermes 是三者里最成熟的。

---

## 六、核心能力对比之二：工具扩展体系

Agent 是否能长期进化，工具系统是关键分水岭。没有好的工具运行时，所谓“智能体”只会停留在文本层。

### 6.1 OpenHuman：工具是“智能体行动的外部世界接口”

OpenHuman 的工具扩展往往和 Integrations 绑定得更紧。它不只是提供文件读写、HTTP 请求之类常规工具，而是把大量业务系统视作智能体外部能力边界。

例如：

- 读取 Gmail 邮件摘要；
- 在 Notion 写入项目笔记；
- 读取 GitHub issue 并生成行动项；
- 同步 Obsidian Markdown 笔记；
- 触发 Slack 通知或工作流。

示意代码：

```python
from openhuman.integrations import Gmail, Notion, GitHub

mail = Gmail()
notion = Notion()
github = GitHub()

unread = mail.fetch_unread(limit=10)
summary = summarize(unread)
notion.append_page("今日邮件摘要", summary)
issues = github.list_issues("team/repo")
```

OpenHuman 的工具哲学不是“给模型一把瑞士军刀”，而是：

> 让智能体对真实世界拥有长期、持续、可回写的操作能力。

它最大的优势在于业务系统连接力。

### 6.2 Hermes：工具系统最像“运行时能力注册中心”

Hermes 的工具系统有一个明显优势：**统一工具运行时抽象非常强**。

常见能力包括：

- terminal；
- browser；
- file；
- MCP；
- delegate / subagent；
- 自定义工具注册。

一个典型示例可能像这样：

```python
from hermes.tools import tool

@tool
async def query_release_notes(product: str) -> str:
    """查询产品发布说明"""
    ...
```

然后由模型侧自动发现 schema、统一注册和调用。这种设计的价值在于：

- 工具对 Agent Core 来说是标准化接口；
- 易于与权限、日志、trace、失败处理联动；
- 可以比较自然地把工具系统扩展成平台能力；
- 子代理协作、MCP 接入这些高级能力更容易统一纳管。

如果你是平台工程师，会非常喜欢 Hermes 这种风格。

### 6.3 OpenClaw：工具服务于消息渠道中的实际任务闭环

OpenClaw 的工具体系虽然没有 Hermes 那么“runtime-first”，但它的价值不在理论抽象，而在**渠道中的任务闭环能力**。

例如在 Discord、Slack、WhatsApp 中，一个工具可能要承担：

- 读取上下文消息；
- 识别群聊角色或频道；
- 回复线程；
- 触发提醒；
- 执行简单自动化任务；
- 跨渠道转发信息。

这种工具使用方式与其说是“通用工具系统”，不如说更接近“渠道场景适配器”。

它的优势是非常实用，缺点是如果你想把它抽象成通用 Agent Runtime，可能不如 Hermes 那么舒服。

### 6.4 工具扩展体系对比表

| 维度 | OpenHuman | Hermes | OpenClaw |
|---|---|---|---|
| 工具抽象统一性 | 中强 | 很强 | 中 |
| 业务系统集成深度 | 很强 | 强 | 中强 |
| 多工具编排能力 | 强 | 很强 | 中 |
| 子代理/委派能力 | 中强 | 强 | 中 |
| 面向现实沟通渠道 | 中 | 中 | 很强 |

**结论**：

- 做“业务系统智能体”，OpenHuman 工具生态很吸引人；
- 做“Agent 平台内核”，Hermes 工具运行时最强；
- 做“消息驱动个人助手”，OpenClaw 的工具更贴地气。

---

## 七、核心能力对比之三：记忆系统

记忆系统是三者分化最明显的地方，也是最值得深挖的部分。

### 7.1 OpenHuman：Memory Tree 是核心世界观

OpenHuman 的记忆不是“聊天历史拼接”，而是 **Memory Tree**。这意味着记忆具备如下特征：

- 有层级结构；
- 有路径语义；
- 可做摘要与下钻；
- 支持长期事实、用户偏好、任务状态分层存储；
- 适合与本地知识图谱协作。

示意结构：

```text
root
├── user_profile
│   ├── preferences
│   └── habits
├── projects
│   ├── blog_system
│   └── ai_agent_research
├── knowledge
└── episodic_logs
```

这种设计的优势是：

- 长期任务稳定；
- 更容易做跨会话回忆；
- 更适合人类干预和审阅；
- 更适合和上下文预算联动。

但它也有代价：

- 设计和维护成本高；
- 如果树设计不好，很容易从“结构化记忆”退化成“另一种复杂数据仓库”；
- 对使用者的方法论要求更高。

### 7.2 Hermes：长期记忆 + 历史检索 + 用户模型

Hermes 的记忆体系没有 OpenHuman 那么强烈地押注某一种“树结构”，但它在工程上更均衡。

典型能力包括：

- 会话历史持久化；
- SQLite + FTS5 检索；
- 用户模型构建；
- 跨会话知识检索；
- 技能和经验沉淀；
- 插件化记忆后端。

它的优势是：

- 工程实现稳定；
- 检索和状态管理统一；
- 更适合做“运行时层的长期记忆”，而不是过早绑定某一种高级抽象；
- 与技能系统结合非常自然。

简而言之：

- OpenHuman 更像“记忆即世界模型”；
- Hermes 更像“记忆即可检索可生长的运行时状态”。

### 7.3 OpenClaw：记忆更偏助手连续性，而不是高级认知结构

OpenClaw 当然也有记忆能力，尤其在长期在线助手场景中，没有会话连续性是做不成事的。但它的记忆设计重心并不在“构建通用 Agent 认知系统”，而在：

- 维持用户与助手的连续上下文；
- 维护个人偏好和日常记忆；
- 支撑渠道中的长期陪伴和任务回接；
- 结合 MEMORY.md 等更直观的日常记忆方式。

这对于个人助手来说已经非常重要，但如果你希望记忆本身成为“高级智能机制”，OpenHuman 和 Hermes 走得更深。

### 7.4 记忆系统横评

| 维度 | OpenHuman | Hermes | OpenClaw |
|---|---|---|---|
| 长期记忆深度 | 很强 | 强 | 中强 |
| 结构化记忆表达 | 很强 | 中强 | 中 |
| 会话检索能力 | 强 | 很强 | 中强 |
| 用户模型 | 强 | 强 | 中强 |
| 人工可控性 | 强 | 强 | 中 |
| 面向个人助手连续性 | 强 | 强 | 很强 |

**结论**：

- 要研究“高级记忆系统”，OpenHuman 最有特色；
- 要做工程上稳定、可检索、可扩展的记忆运行时，Hermes 最均衡；
- 要做连续陪伴型个人助手，OpenClaw 已经足够实用。

---

## 八、核心能力对比之四：多平台集成能力

### 8.1 OpenHuman：面向业务系统与知识工具的深集成

OpenHuman 的集成能力最显著的特征是“**工作系统型集成**”。它强调把智能体嵌入知识管理、通信、任务管理和生产力工具链中。

典型方向包括：

- Gmail；
- Notion；
- GitHub；
- Slack；
- Obsidian；
- 本地文件系统；
- Webhook / HTTP / 数据源接入。

这意味着它非常适合：

- 做个人工作流中枢；
- 做知识运营与自动总结系统；
- 做跨系统协同智能体。

### 8.2 Hermes：多入口、多插件、多后端统一纳管

Hermes 的“多平台集成”不一定是“我预置了最多渠道”，而是它可以通过：

- gateway；
- cron；
- ACP/IDE；
- MCP；
- 插件系统；
- 自定义 terminal backend；

把不同入口和能力纳入统一运行时。

因此 Hermes 的平台集成更像“**平台能力整合**”，而不是“预置最多 SaaS 连接器”。

这种路线在组织内部平台化很有优势，因为你可以按自己业务去扩，而不是等官方集成。

### 8.3 OpenClaw：消息平台接入是最大护城河

OpenClaw 在多平台集成上的最大亮点，是它把注意力放在了真正高频的**消息渠道生态**：

- Telegram；
- WhatsApp；
- Slack；
- Discord；
- Matrix；
- Signal；
- iMessage；
- QQ；
- WeChat；
- Google Chat 等。

这对很多团队来说是致命吸引力：

- 用户无需学习新系统；
- 助手直接出现在已有沟通场景；
- 团队内试点和反馈速度非常快；
- 很适合轻量部署与快速验证。

### 8.4 多平台集成对比总结

| 维度 | OpenHuman | Hermes | OpenClaw |
|---|---|---|---|
| SaaS/生产力工具集成 | 很强 | 强 | 中 |
| 多入口统一能力 | 中强 | 很强 | 中强 |
| 消息平台广度 | 中 | 中强 | 很强 |
| IDE/开发环境融合 | 中 | 强 | 中 |
| 对个人工作流友好度 | 强 | 强 | 很强 |

如果你的问题是“我要把 Agent 接到真实工作系统中”，OpenHuman 非常亮眼；
如果你的问题是“我要一个统一运行时容纳多入口”，Hermes 更像正确答案；
如果你的问题是“我要让 AI 直接进入消息渠道”，OpenClaw 基本领先一档。

---

## 九、核心能力对比之五：社区生态与项目成熟度

开源项目的生命力，不只看 star 数，还要看以下几件事：

- 文档是否持续更新；
- 架构是否有清晰主线；
- 社区讨论是否围绕真实问题；
- issue 和 PR 是否体现出可维护性；
- 项目是否有长期路线，而不是短期热点。

### 9.1 OpenHuman 的生态特征

OpenHuman 的生态更像“**围绕超级智能体路线展开的系列能力演进**”。你会看到它的文章和功能点常常聚焦在：

- Memory Tree；
- TokenJuice；
- Integrations；
- AutoFetch；
- 安全和本地数据主权；
- 桌面应用与多模态体验。

优点是路线清晰，缺点是如果你不是这一路线的目标用户，可能会觉得它“很强，但不一定正好解决我眼前的问题”。

### 9.2 Hermes 的生态特征

Hermes 的生态更像“**运行时生态**”。它吸引的用户通常更偏：

- 开发者；
- 平台工程师；
- 研究型用户；
- 希望做长期 Agent 基座的人。

它的优势在于抽象稳定、能力边界清晰，生态延展潜力大。对于真正会写插件、改 profile、做平台内集成的人来说，Hermes 的价值会随着使用时间增加而变大。

### 9.3 OpenClaw 的生态特征

OpenClaw 的生态更偏“**产品驱动型生态**”。用户会围绕这些主题聚集：

- 某个平台怎么接入；
- 配对和授权怎么做；
- 渠道稳定性如何；
- 怎样把助手放进真实团队沟通流程；
- Dashboard、Doctor、Gateway 的运维经验。

它的优点是离真实使用场景很近，缺点是如果你想拿它当纯 Agent Runtime 研究对象，就会感觉视角不完全匹配。

### 9.4 社区生态横评

| 维度 | OpenHuman | Hermes | OpenClaw |
|---|---|---|---|
| 架构主线清晰度 | 强 | 很强 | 强 |
| 文档工程化程度 | 中强 | 很强 | 强 |
| 产品场景明确性 | 强 | 中强 | 很强 |
| 平台化扩展潜力 | 强 | 很强 | 中 |
| 个人用户吸引力 | 强 | 中 | 很强 |

---

## 十、性能基准：响应速度、资源占用、扩展开销怎么比较

严格意义上的性能基准，应该在同一硬件、同一模型、同一任务集、同一网络条件下做实验。但因为这三个框架目标不同，我们更适合给出**工程上的性能对比框架**，而不是伪造精确跑分。

下面是一套更有参考价值的对比维度。

### 10.1 基准维度设计

建议把性能拆成五项：

1. **冷启动时间**：从启动到可接收第一个任务；
2. **单轮响应链路延迟**：模型调用前后的框架开销；
3. **长期会话性能退化**：随着历史增长，是否明显变慢；
4. **高并发任务调度能力**：多任务、多入口、多工具同时执行时的表现；
5. **外部集成开销**：集成数增多后，配置与执行成本如何变化。

### 10.2 OpenHuman 的性能画像

OpenHuman 的性能瓶颈通常不在“框架本身很重”，而在于它做的事情本来就更复杂：

- Memory Tree 检索与摘要编排；
- Token Juice 决策；
- 多集成系统调用；
- 长期任务状态维护。

因此在轻量单轮对话中，它未必是最轻快的；但在复杂多步任务中，**它的额外开销往往换来更高任务完成度**。

典型表现：

- 简单问答：略重；
- 长链路任务：优势明显；
- 历史越长，设计得好反而越稳定，因为不是靠生拼全量历史。

### 10.3 Hermes 的性能画像

Hermes 的性能通常会给人一种“工程上比较稳”的感觉。

原因是：

- 核心 loop 统一；
- SQLite + FTS5 检索开销可控；
- 插件和工具有较清晰边界；
- Profile、工具、状态等模块职责明确。

因此 Hermes 在大多数常见任务下都比较均衡：

- 启动开销中等；
- 会话增长后性能可控；
- 适合中长期运行；
- 当工具和插件很多时，仍有较好的治理性。

### 10.4 OpenClaw 的性能画像

OpenClaw 的性能体验很大程度上受**消息渠道链路**影响：

- 平台 webhook 延迟；
- 消息轮询/推送机制；
- 网关守护进程稳定性；
- 不同平台的速率限制和重试策略。

如果只看框架内部，OpenClaw 不一定重；但在真实部署时，瓶颈经常出现在：

- 渠道 API；
- 网络抖动；
- 认证与配对机制；
- 公网暴露和回调链路。

所以对用户来说，它的“性能”更多体现为**聊天体验是不是像一个真正的在线助手**，而不只是毫秒级 benchmark。

### 10.5 一个更有意义的性能对比表

| 性能维度 | OpenHuman | Hermes | OpenClaw |
|---|---|---|---|
| 冷启动 | 中 | 中 | 中 |
| 单轮轻任务延迟 | 中 | 中上 | 中上 |
| 长会话稳定性 | 很强 | 强 | 中强 |
| 多工具多状态任务 | 很强 | 强 | 中 |
| 多渠道在线体验 | 中 | 中 | 很强 |
| 配置增加后的复杂度 | 高 | 中高 | 高 |

### 10.6 实战基准建议

如果你要在团队里做真正 benchmark，我建议用下面这组任务集：

#### 任务 A：轻量问答
- 问一个已有知识问题；
- 测首字节时间和总耗时。

#### 任务 B：带 3 个工具调用的任务
- 读取文件；
- 查询网页；
- 输出结构化结果。

#### 任务 C：跨会话回忆
- 先写入用户偏好；
- 隔一天再要求 Agent 基于该偏好给建议。

#### 任务 D：外部系统协同
- 读取 GitHub issue；
- 汇总到 Notion；
- 通知到 Slack/Telegram。

#### 任务 E：多入口一致性
- CLI 发起；
- 消息平台发起；
- 定时任务触发；
- 比较行为一致性和状态延续。

这套基准比“回答同一个 prompt 花了几秒”更能体现真实价值。

---

## 十一、实战场景推荐：到底该怎么选

### 11.1 场景一：个人超级智能工作台

需求特征：

- 需要长期记住项目状态；
- 需要处理邮件、笔记、任务、知识库；
- 需要主动拉取上下文；
- 对“认知深度”和“记忆质量”要求高。

**推荐：OpenHuman。**

原因：

- Memory Tree 非常契合这种长期知识组织场景；
- Integrations 丰富；
- Token Juice 有助于平衡成本与深度；
- 适合作为“个人智能工作中枢”。

### 11.2 场景二：团队 Agent 平台基座

需求特征：

- 需要多个入口统一接入；
- 需要插件化扩展；
- 需要稳定的状态与检索；
- 需要在不同团队任务间复用能力；
- 希望后续支持技能沉淀和模型治理。

**推荐：Hermes。**

原因：

- 运行时抽象最完整；
- ProviderProfile、插件、技能、cron、gateway 等组件边界清晰；
- 非常适合平台工程化落地；
- 长期维护成本可控。

### 11.3 场景三：个人助手 / 多消息平台在线助手

需求特征：

- 需要接入 Telegram、Discord、Slack、WhatsApp 等；
- 需要在现实消息流中与用户协作；
- 需要简化使用门槛；
- 需要 Dashboard、配对、授权、安全能力。

**推荐：OpenClaw。**

原因：

- 多渠道接入能力最强；
- 产品完成度高；
- 最容易让用户真实用起来；
- 对“把 AI 放进真实沟通网络”这件事最成熟。

### 11.4 场景四：研究型自治 Agent 实验

需求特征：

- 关注长期任务；
- 关注记忆抽象；
- 希望做更高阶认知结构实验；
- 需要把模型预算、状态、知识组织一起纳入研究。

**推荐：OpenHuman，备选 Hermes。**

如果偏“认知结构实验”，OpenHuman 更有意思；
如果偏“运行时机制实验”，Hermes 更合适。

### 11.5 场景五：给现有团队做一个“先能用起来”的 AI 助手

需求特征：

- 成员都在 Slack/Discord/Telegram 里工作；
- 希望助手先能回答、提醒、抓取信息、做简单自动化；
- 不想先搭很复杂的 Agent 平台。

**推荐：OpenClaw。**

因为先嵌入真实使用场景，比先设计最完美架构更容易成功。

---

## 十二、代码示例：同一任务在三种架构下怎么理解

我们用一个统一任务来理解三者差异：

> “每天早上 9 点汇总 GitHub issue、新邮件和昨晚 Slack 讨论，生成项目摘要并发给我。”

### 12.1 OpenHuman 风格：以任务状态和记忆驱动

```python
from openhuman.agent import Agent

agent = Agent(
    memory_tree=True,
    token_juice="balanced",
    integrations=["github", "gmail", "slack", "notion"]
)

agent.run_task({
    "goal": "生成每日项目摘要",
    "sources": ["github:team/repo", "gmail:unread", "slack:#project"],
    "writeback": "notion:Daily Summary",
    "schedule": "0 9 * * *"
})
```

重点在于：

- 它会把历史摘要写回记忆树；
- 会在预算允许下决定是否深入分析；
- 会逐步积累项目知识。

### 12.2 Hermes 风格：以运行时模块编排为中心

```python
from hermes import HermesAgent

agent = HermesAgent(profile="work-summary")

agent.schedule(
    cron="0 9 * * *",
    task="collect_and_summarize_updates",
    tools=["github_issues", "gmail_reader", "slack_history", "notion_writer"]
)
```

重点在于：

- 这个任务是统一 runtime 中的一个标准工作项；
- 工具、provider、memory、cron 都按统一机制治理；
- 后续很容易扩展为插件或技能。

### 12.3 OpenClaw 风格：以真实消息渠道交付为中心

```yaml
assistant:
  name: project-buddy
  channels:
    - slack
    - telegram
  routines:
    morning_summary:
      schedule: "0 9 * * *"
      actions:
        - fetch_github_issues
        - fetch_email_summary
        - fetch_slack_thread_digest
        - send_message: telegram:me
```

重点在于：

- 最终结果直接送达你的现实沟通渠道；
- 对用户来说，它像一个在线助手而不是一个后台系统。

这个例子非常能体现三者差异：

- OpenHuman 在乎“记忆和认知深度”；
- Hermes 在乎“任务如何被 runtime 优雅治理”；
- OpenClaw 在乎“助手如何真实触达用户”。

---

## 十三、真实踩坑经验：这三类框架最容易踩哪些坑

这一节不说空话，直接讲在实际使用中最常见、最容易被忽视的问题。

### 13.1 OpenHuman 的坑：不是功能少，而是体系太强导致方法论要求高

#### 坑一：Memory Tree 设计不当，记忆很快失控

很多人一上来就把所有会话、所有资料都往记忆树里塞，结果很快出现：

- 节点定义混乱；
- 路径语义不清；
- 长期事实与临时状态混在一起；
- 回忆时噪声极高。

**经验：**
- 先定义根节点规范；
- 把 `user_profile / projects / knowledge / episodic_logs` 分开；
- 为临时记忆设置失效或摘要转存策略。

#### 坑二：Integrations 一多，授权与同步问题陡增

OpenHuman 最大的价值之一是集成多，但这也意味着：

- OAuth token 过期；
- API quota 不一致；
- 各系统对象模型不同；
- 同步失败后的重试与去重很烦。

**经验：**
- 先接 1~2 个关键系统，别一上来全接；
- 给每个 integration 加最小可观测日志；
- 写清楚失败补偿策略。

#### 坑三：Token Juice 理解不到位时，容易“该省的不省，该花的不花”

如果你只是粗暴设置一个预算数字，而不区分任务价值、推理深度、上下文质量，最后成本并不会真的降下来。

**经验：**
- 对任务分类：总结型、执行型、规划型、研究型；
- 让不同任务使用不同思考深度；
- 把摘要质量纳入预算设计，而不是只盯 token 数。

### 13.2 Hermes 的坑：抽象很优雅，但需要理解系统边界

#### 坑一：把 Hermes 当成“更复杂的聊天工具”

如果你不理解 skills、plugins、provider profile、gateway、cron 这些概念，就会觉得 Hermes “为什么这么多层”。

**经验：**
- 把它当 runtime 看，不要当聊天壳看；
- 先从 CLI + provider profile 跑通，再加 plugin 和 cron；
- 先理解它的模块，再做深扩展。

#### 坑二：ProviderProfile 配太灵活，团队里容易配出多套风格

声明式配置是好事，但也容易导致团队里每个人都写一套自己的 profile，最后不可维护。

**经验：**
- 设立基础 profile 模板；
- 统一命名、优先级、alias 规范；
- 把生产环境 profile 纳入版本控制。

#### 坑三：插件太多时，trace 与权限治理很关键

Hermes 很适合扩展，但一旦工具、插件、MCP 服务多起来，不做权限和日志治理就会很乱。

**经验：**
- 给工具调用打 trace id；
- 把危险工具按 profile 分层启用；
- 统一日志格式，便于回放与审计。

### 13.3 OpenClaw 的坑：渠道接入是优势，也是主要风险源

#### 坑一：不同平台的 webhook/回调机制完全不一样

你以为“接一个消息平台”和“再接一个平台”只是复制配置，其实不是。不同平台在以下方面差异极大：

- 事件模型；
- 回调验证；
- 速率限制；
- 富媒体支持；
- 会话上下文粒度；
- 风控策略。

**经验：**
- 一个平台一个平台吃透；
- 先在最稳定的平台形成 SOP；
- 不要第一天就追求全渠道覆盖。

#### 坑二：公网暴露与本地守护进程安全问题

长期在线助手如果接入现实消息渠道，安全问题立刻从“理论风险”变成“生产风险”。

**经验：**
- 默认最小暴露；
- 使用 allowlist、pairing；
- 单独管理 webhook secret 和访问日志；
- 对高权限动作加人工确认。

#### 坑三：消息重复、线程错位、上下文断裂

这类问题不是框架独有，而是消息平台集成天生会遇到。

**经验：**
- 做消息去重；
- 记录 message id 与 thread id 映射；
- 对异步回调做幂等控制。

---

## 十四、如果只能选一个，我会怎么给建议

这是很多读者最关心的问题。我的建议不是给唯一答案，而是按决策顺序来。

### 14.1 先问你的目标到底是什么

如果你的目标是：

#### A. 我要一个“越来越懂我、越来越会做事”的长期智能系统
选 **OpenHuman**。

#### B. 我要一个“结构清晰、可扩展、可维护”的 Agent 运行时基座
选 **Hermes**。

#### C. 我要一个“真正能在 Slack/Telegram/Discord/WhatsApp 里工作”的在线助手
选 **OpenClaw**。

### 14.2 再问你的团队能力结构是什么

- 团队里如果有较强平台工程能力，**Hermes** 会越用越香；
- 团队里如果更擅长业务流程自动化和知识工作流，**OpenHuman** 更容易打出效果；
- 团队里如果产品与运营导向强，希望最快让用户“用起来”，**OpenClaw** 成功率最高。

### 14.3 最后问你的未来路线

- 想走**超级智能体 / 长期自治**，OpenHuman 更对路；
- 想走**Agent 平台 / 统一运行时 / 开发者生态**，Hermes 更对路；
- 想走**个人 AI 助手产品**，OpenClaw 更对路。

---

## 十五、最终总结：三者的最佳使用姿势

如果要用一句最终判断来总结：

- **OpenHuman 代表了“智能体能力纵深”的路线**。它最适合那些相信 Agent 的未来不只是聊天，而是长期记忆、预算调度、主动感知和外部世界协同的人。
- **Hermes 代表了“Agent 运行时基础设施”的路线**。它最适合那些希望把 Agent 做成真正可扩展、可治理、可跨入口复用的平台的人。
- **OpenClaw 代表了“现实世界个人助手产品化”的路线**。它最适合那些希望让 AI 立即进入消息网络、设备环境和日常工作流的人。

从技术选型角度，我的实际建议是：

### 适合优先选 OpenHuman 的情况
- 你做的是长期知识工作流；
- 你关心高级记忆与认知资源调度；
- 你需要大量业务系统集成；
- 你愿意花时间打磨方法论。

### 适合优先选 Hermes 的情况
- 你想做团队级 Agent 平台；
- 你需要统一运行时；
- 你重视插件、技能、provider 治理；
- 你想让系统随着使用逐步成长。

### 适合优先选 OpenClaw 的情况
- 你要做个人助手或团队沟通助手；
- 你最重视消息渠道接入；
- 你希望最快进入真实使用场景；
- 你愿意接受多平台运维复杂度。

最后再给一个非常务实的落地建议：

> 如果你是独立开发者，想先做出“有人真的会用”的东西，优先试 OpenClaw；
> 如果你是平台团队，想做可以长期承载各种 Agent 的基座，优先试 Hermes；
> 如果你想做更有野心的长期自治智能体系统，优先试 OpenHuman。

AI Agent 的下一阶段，不会是“所有框架都长得一样”，而会是**不同哲学在不同场景里各自胜出**。从这个角度看，OpenHuman、Hermes、OpenClaw 三者并不是彼此消灭关系，而是共同勾勒出了开源 Agent 框架未来三条最值得下注的路线。

如果你正在做架构选型，真正应该问自己的从来不是“哪个最火”，而是：

**你的 Agent，到底要成为一个更聪明的系统、一个更稳的运行时，还是一个真正进入现实世界的助手？**

## 相关阅读

- [OpenClaw vs Hermes Agent：开源 AI Agent 框架选型对比](/categories/架构/OpenClaw-vs-Hermes-Agent-开源-AI-Agent-框架选型对比/)
- [Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测](/categories/架构/Hermes-MCP-集成架构-动态工具发现-stdio-SSE-HTTP传输-prompt-injection检测/)
- [OpenHuman 实战：开源 AI 超级智能框架入门与 macOS 安装](/categories/架构/OpenHuman-实战-开源-AI-超级智能框架入门与-macOS-安装/)
