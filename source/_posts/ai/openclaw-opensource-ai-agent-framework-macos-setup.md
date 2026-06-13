---

title: OpenClaw 实战：开源 AI Agent 框架入门与 macOS 环境搭建
keywords: [OpenClaw, AI Agent, macOS, 开源, 框架入门与, 环境搭建]
date: 2026-06-02 03:00:00
tags:
- OpenClaw
- AI Agent
- macOS
- 开源框架
- Agent
description: OpenClaw 开源 AI Agent 框架的完整入门指南与 macOS 环境搭建实战。从个人 AI 助手基础设施的定位出发，详解 OpenClaw 的核心架构（Gateway 控制平面、消息渠道接入、技能与工具治理、多 Agent 协作、持久记忆与本地优先设计）。手把手演示 macOS 环境下的安装配置、首个 Agent 创建、技能系统配置、MEMORY.md 持久化记忆管理，对比 LangChain/AutoGen/Dify 等常见方案的架构差异，附真实场景踩坑记录与选型决策框架，帮助开发者判断 OpenClaw 是否适合自己的技术栈。
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



在 2026 年继续讨论 AI Agent，很多开发者的注意力仍然集中在“大模型本身”，但真正决定产品可用性的，往往不是模型参数量，而是 **Agent 运行时、工具系统、上下文组织、跨设备接入能力与长期状态管理**。如果你已经尝试过 LangChain、AutoGen、CrewAI、Dify 或者某些云托管编排平台，你很快会发现：很多框架更像“工作流/编排引擎”，而不是一个真正面向个人使用、可持续运行、可跨终端交互的本地化 AI Assistant 基础设施。

OpenClaw 正是在这个背景下值得关注的开源项目。它并不只是再造一个“调用 LLM + 函数调用”的壳，而是把重点放在 **个人 AI 助手的常驻运行、消息渠道接入、Gateway 控制平面、技能与工具治理、多 Agent、持久记忆与本地优先** 上。换句话说，OpenClaw 的目标不是做一个“给开发者拼工作流的 SDK”，而是提供一个你可以真正长期运行在自己设备上的 AI Agent 系统。

本文会从工程视角系统介绍 OpenClaw：它解决什么问题、核心架构是什么、为什么它的设计区别于常见 Agent 框架，以及如何在 macOS 上完成环境搭建、创建 Agent、配置技能、管理 MEMORY.md，并结合真实场景讲清楚它适合什么项目、不适合什么项目。文章还会把它与 LangChain、AutoGen、Dify 等常见方案进行对比，帮助你判断 OpenClaw 是否适合你的技术栈。

> 本文内容基于 OpenClaw 官方 README 与公开文档整理，结合 macOS 实际部署经验撰写。文中命令、配置片段和架构说明尽量贴近真实工作流，而不是停留在概念层。

---

# 一、OpenClaw 是什么：从“Agent 框架”到“个人 AI 助手基础设施”

OpenClaw 官方对自己的定位非常明确：**Personal AI Assistant you run on your own devices**。这个表述比“Agent Framework”更重要，因为它解释了它的所有架构选择。

很多传统 Agent 框架的起点是：

1. 接一个或多个 LLM；
2. 把工具包装成 function/tool；
3. 通过 prompt + loop 决定什么时候调用工具；
4. 返回结果。

这种设计当然有用，但通常只适合以下几类场景：

- 单次任务执行；
- Web 后端中的短时请求；
- Demo 级 Agent 工作流；
- 需要快速验证推理链或工具调用能力的实验项目。

而 OpenClaw 面向的是另一类需求：

- 你希望 Agent 长时间运行，而不是脚本执行完就退出；
- 你希望它能接入 Telegram、Slack、Discord、iMessage、WhatsApp 等聊天渠道；
- 你希望它在自己的设备或服务器上工作，而不是完全依赖托管平台；
- 你希望它维护会话、技能、记忆、配置和多 Agent 之间的边界；
- 你希望它既能在浏览器面板中使用，也能通过 CLI、消息渠道甚至移动端触达。

从这个角度看，OpenClaw 更像是：

- **Agent Runtime + Gateway + Channel Layer + Tool Governance + Workspace System** 的组合体；
- 一个围绕“个人 AI 助手”而不是“流水线式 LLM 调用”的操作系统式框架；
- 一个强调本地优先、可审计、可扩展、可持久化的 Agent 平台。

## 1.1 OpenClaw 的核心设计理念

结合官方文档，可以把 OpenClaw 的设计理念总结为五个关键词。

### 1）本地优先（Local-first）

OpenClaw 的状态目录、工作区、会话、技能、配置都优先保存在本地。它允许你把数据掌握在自己手里，而不是把所有上下文历史都推给第三方 SaaS。

这在以下场景尤其重要：

- 包含私有代码库；
- 含敏感消息渠道内容；
- 需要长时间累积“个人工作习惯”；
- 需要结合本地脚本、shell、浏览器或文件系统操作。

### 2）Gateway 是控制平面，而不是产品本身

OpenClaw 文档反复强调：**Gateway 只是控制平面，真正的产品是助手本身**。

这句话意味着：

- Gateway 负责连接模型、工具、渠道、配置与会话；
- Agent 本身才是和用户互动的实体；
- 渠道层是第一等公民，而不是额外插件；
- 整个系统围绕“让一个助手常驻、可用、可控”而设计。

### 3）技能（Skills）是“指令资产”，而不仅仅是 Prompt

在许多框架里，prompt 只是代码中的长字符串。而 OpenClaw 将技能抽象为目录化、带 frontmatter 的 `SKILL.md`，可以加载、覆盖、限权、按 Agent 控制可见性，并且支持安装、更新与工作区级管理。

这让 Prompt Engineering 从“代码中不可维护的字符串”提升为“可以治理的工程资产”。

### 4）工具治理比“工具越多越好”更重要

OpenClaw 把工具配置、tool profile、allow/deny、sandbox、MCP/plugin 工具隔离做得非常细。它不是单纯告诉模型“这些工具你都能用”，而是强调：

- 哪些 Agent 能看到哪些工具；
- 哪些工具属于 coding profile；
- 哪些工具需要更严格的安全约束；
- 在 sandbox 中是否允许插件/MCP 工具；
- 如何控制文件写入、命令执行、浏览器等高风险能力。

### 5）Agent 是长期运行的工作单元，而不是单次函数调用

OpenClaw 的 Agent 不是 `invoke(prompt)` 这样的一次性对象。它有自己的：

- workspace；
- sessions；
- auth profiles；
- skills；
- model policy；
- tools policy；
- bootstrap files；
- memory/上下文文件。

这使它更适合构建持续协作型 AI，而不是“做完一次任务就结束”的推理链。

---

# 二、核心架构与组件解析：OpenClaw 到底由哪些部分组成

如果用工程图来理解 OpenClaw，可以把它拆成以下几层：

1. **Gateway 层**：服务守护、端口监听、控制 UI、健康检查、渠道接入；
2. **Agent Runtime 层**：内置 agent loop、session 管理、模型选择、上下文压缩、工具适配；
3. **Workspace 与 Bootstrap 层**：AGENTS.md、IDENTITY.md、MEMORY.md 等上下文文件；
4. **Tools / Skills / Plugins 层**：动作能力、指令能力与扩展能力；
5. **Channels 层**：Telegram、Slack、Discord、Signal、iMessage 等消息入口；
6. **Providers / Models 层**：OpenAI、Anthropic、Google 等模型供应商与鉴权；
7. **State / Sessions / Memory 层**：会话历史、记忆索引、状态目录、Agent 独立数据。

## 2.1 Gateway：整个系统的常驻控制平面

OpenClaw 的推荐运行方式是把 Gateway 以 daemon 形式跑起来。官方 onboarding 会在 macOS 上安装 LaunchAgent，让 Gateway 常驻运行。

典型命令如下：

```bash
openclaw onboard --install-daemon
openclaw gateway status
```

Gateway 主要做几件事：

- 管理配置与状态目录；
- 暴露控制 UI / dashboard；
- 接收 CLI 或外部渠道请求；
- 将请求路由到对应 Agent；
- 控制消息会话、配对（pairing）、权限和健康探测；
- 管理工具、插件、节点与运行时状态。

在 OpenClaw 的语义里，Gateway 有点像“AI 助手操作系统的 system service”。

## 2.2 Agent Runtime：OpenClaw 的核心推理执行器

根据官方 `agent-runtime-architecture` 文档，OpenClaw 将内置 agent runtime 直接维护在代码库中，核心目录大致包括：

- `src/agents/embedded-agent-runner/`：Agent 尝试循环、Provider stream 适配、上下文压缩、模型选择；
- `src/agents/sessions/`：会话持久化、扩展加载、资源发现、技能与 prompt 装配；
- `packages/agent-core/`：更底层的消息、上下文、工具与会话契约；
- `src/agents/agent-tools*.ts`：OpenClaw 自带工具定义、schema 和 hook 适配。

这说明 OpenClaw 的 runtime 不是简单把工具列表丢给 LLM，而是围绕以下流程进行治理：

1. 收到用户输入；
2. 解析当前 Agent、Session、Workspace 与模型策略；
3. 装载 bootstrap 文件和技能内容；
4. 根据工具策略暴露有限工具集；
5. 执行推理与工具调用循环；
6. 必要时进行上下文压缩（compaction）；
7. 将会话和状态持久化。

## 2.3 Workspace：Agent 的“工作目录 + 人格目录 + 运行上下文”

OpenClaw 默认 workspace 在：

```bash
~/.openclaw/workspace
```

但多 Agent 模式下，每个 Agent 都可以有独立 workspace。这个目录并不仅仅用来存放普通文件，它还是 Agent 的上下文根。

官方文档提到 bootstrap 文件包括：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`

你可以理解为：

- `IDENTITY.md` 定义 Agent 的身份、语气与角色；
- `USER.md` 记录用户偏好；
- `TOOLS.md` 规定工具使用边界；
- `HEARTBEAT.md` 更适合自动化或周期任务；
- `AGENTS.md`/`BOOTSTRAP.md` 则承担总入口提示职责；
- `MEMORY.md` 则常被用作长期记忆或规则归档文件。

这种基于 Markdown 文件的上下文管理方式，比把所有 prompt 塞进数据库更适合开发者维护，也更利于 Git 版本管理。

## 2.4 Skills、Tools、Plugins 的分工

OpenClaw 官方把三者区分得很清楚：

- **Tools**：Agent 可以调用的动作函数；
- **Skills**：告诉 Agent 何时、如何使用工具的指令包；
- **Plugins**：扩展 OpenClaw 运行时能力，可提供工具、渠道、模型、hooks 等。

这三者对应的是三种完全不同的工程对象：

| 组件 | 本质 | 典型形式 | 作用 |
|---|---|---|---|
| Tool | 可执行能力 | `exec`、`read`、`web_search` | 让 Agent 采取行动 |
| Skill | 指令资产 | `SKILL.md` | 教 Agent 怎么行动 |
| Plugin | 可安装扩展 | npm/git/local package | 给系统增加新能力 |

这种分层很重要，因为很多团队在做 Agent 系统时会把“动作能力”和“提示模板”混在一起，导致权限治理和可维护性迅速恶化。

## 2.5 Session 与多 Agent

OpenClaw 的 Session 不是简单聊天历史，而是运行态的重要部分。不同 Session 可能拥有：

- 不同的 model override；
- 不同的上下文长度与压缩状态；
- 不同的 memory 片段引用；
- 不同的工具调用历史；
- 不同的用户/渠道来源。

此外，OpenClaw 支持多 Agent 配置。一个典型使用方式是：

- `writer` Agent：只用于写作、草稿和摘要；
- `coder` Agent：具备文件系统和 shell 能力；
- `ops` Agent：可以看日志、看部署状态，但不允许改代码；
- `assistant` Agent：作为消息渠道的默认私人助理。

从架构层面上看，这比“一个万能 Agent 配所有工具”更符合现实安全需求。

---

# 三、macOS 环境安装与依赖配置

接下来进入实战部分。OpenClaw 官方推荐运行时为 **Node 24（推荐）或 Node 22.19+**。在 macOS 上，建议优先使用 Homebrew + 官方安装脚本或 npm 方式安装。

## 3.1 安装前的系统准备

先确认你当前具备以下条件：

- macOS 13+/14+/15+ 均可，建议使用较新版本；
- 已安装 Homebrew；
- 已安装 Node.js 24 或 Node 22.19+；
- 有至少一个可用的大模型 Provider API Key；
- 终端环境最好是 zsh；
- 如果你打算接入 Telegram/Slack 等渠道，需要额外的 bot token 或 app 凭证。

推荐先检查 Node 版本：

```bash
node --version
```

如果没有安装 Node，可以在 macOS 上这样做：

```bash
brew install node@24
```

如果你希望明确把 Node 24 放入 PATH：

```bash
echo 'export PATH="/opt/homebrew/opt/node@24/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node --version
```

## 3.2 OpenClaw 的安装方式

根据官方“Getting Started”文档，macOS / Linux 最快的方式是：

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

不过对于开发者来说，我更推荐同时了解 npm 安装方式，因为它更容易控制版本：

```bash
npm install -g openclaw@latest
```

如果你用 pnpm 或 bun，也可以选择：

```bash
pnpm add -g openclaw@latest
# 或
bun add -g openclaw@latest
```

安装成功后，先确认 CLI 可用：

```bash
openclaw --help
```

## 3.3 推荐的首次初始化：onboard

官方明确推荐首次安装后执行：

```bash
openclaw onboard --install-daemon
```

这个命令会做几件很关键的事情：

1. 选择模型供应商与鉴权方式；
2. 设置默认模型；
3. 选择 workspace 目录；
4. 配置 Gateway 端口与认证方式；
5. 安装 macOS LaunchAgent；
6. 执行健康检查；
7. 可选安装推荐技能与渠道。

如果你想强制用中文进行 onboarding，可以设置 locale：

```bash
OPENCLAW_LOCALE=zh-CN openclaw onboard --install-daemon
```

根据官方文档，CLI onboarding 的固定文案支持 `en`、`zh-CN`、`zh-TW`。

## 3.4 macOS 上的推荐目录结构

OpenClaw 默认状态目录一般在：

```bash
~/.openclaw
```

初始化后常见结构可以理解为：

```text
~/.openclaw/
├── openclaw.json
├── workspace/
│   ├── AGENTS.md
│   ├── IDENTITY.md
│   ├── USER.md
│   ├── HEARTBEAT.md
│   ├── skills/
│   └── memory/
├── agents/
│   └── <agent-id>/
│       ├── agent/
│       └── sessions/
├── credentials/
└── skills/
```

其中：

- `openclaw.json`：全局配置主文件；
- `workspace/`：默认 Agent 工作区；
- `agents/`：多 Agent 独立状态；
- `credentials/`：Provider 或渠道的凭据状态；
- `skills/`：本机共享技能目录。

## 3.5 验证 Gateway 是否运行正常

安装完成后，先不要急着聊天，先验证服务状态。

```bash
openclaw gateway status
```

如果一切正常，你应当看到 Gateway 处于 running 状态，并监听默认端口 `18789`。调试时也可以切到前台运行模式：

```bash
openclaw gateway stop
openclaw gateway --port 18789 --verbose
```

这样做适合排查：

- 端口冲突；
- 配置加载失败；
- 模型认证问题；
- 渠道初始化失败；
- 插件或技能异常。

## 3.6 打开 Dashboard / Control UI

Gateway 正常后，可以打开 Dashboard：

```bash
openclaw dashboard
```

官方文档说明，Control UI 是最快的“第一条消息”验证方式，因为这一步还不需要你先配置 Telegram 或其他渠道。

## 3.7 macOS 安装过程中的常见依赖问题

### 问题 1：Node 版本过低

如果你的系统 Node 还是 18 或更低，OpenClaw 很可能直接报错或行为异常。解决方式就是升级到 Node 22.19+，最佳为 Node 24。

### 问题 2：PATH 中存在多个 Node

在 macOS 上尤其常见：你可能同时装了系统 Node、nvm Node、Homebrew Node。排查方式：

```bash
which node
node --version
which openclaw
```

如果 `openclaw` 用的是一个版本，而 `node` 指向另一个版本，CLI 可能表现诡异。

### 问题 3：LaunchAgent 没有正确加载

执行以下命令查看状态：

```bash
openclaw gateway status
openclaw status
```

如果 daemon 状态异常，可以尝试重新 onboard，或者先停止再重新安装服务。

### 问题 4：端口 18789 被占用

OpenClaw 默认 Gateway 端口是 18789，若本机已有其他服务占用，需修改配置或前台启动时换端口。

示例：

```bash
openclaw gateway --port 18888 --verbose
```

---

# 四、Agent 创建与配置实战

理解 OpenClaw 的关键，不只是把它装起来，而是知道如何创建一个“边界清晰、能力明确”的 Agent。

## 4.1 添加一个新的 Agent

官方文档给出的方式是：

```bash
openclaw agents add writer
```

如果不指定 workspace，通常会进入引导流程。创建后，这个 Agent 将拥有自己的：

- workspace；
- sessions；
- auth profiles；
- 默认配置覆盖项。

这非常适合在 macOS 本机上做“角色隔离”。例如：

- `writer`：写作专用；
- `dev`：代码与终端专用；
- `research`：联网搜索与资料整理专用；
- `private-assistant`：只接入 Telegram 私聊。

## 4.2 `openclaw.json` 中的 Agent 配置思路

下面是一个更实用的配置示例：

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.openclaw/workspace",
      "model": {
        "primary": "openai/gpt-5.4",
        "fallbacks": [
          "anthropic/claude-sonnet-4-6"
        ]
      },
      "skills": ["github", "weather"],
      "thinkingDefault": "low",
      "verboseDefault": "off"
    },
    "list": [
      {
        "id": "writer",
        "workspace": "~/.openclaw/workspaces/writer",
        "skills": ["outline-writer", "blog-polish"]
      },
      {
        "id": "dev",
        "workspace": "~/.openclaw/workspaces/dev",
        "skills": ["repo-review", "shell-safe"]
      }
    ]
  }
}
```

这个配置体现了三个实践原则：

1. **默认配置尽量保守**；
2. **按 Agent 做能力裁剪**；
3. **不要把所有技能塞给所有 Agent**。

## 4.3 创建一个“代码助手”Agent

假设你想让 macOS 上的 OpenClaw 帮你分析本地仓库、改文档、跑命令，但不想让它操作消息渠道，那么可以这样设计：

```json
{
  "agents": {
    "list": [
      {
        "id": "code-assistant",
        "workspace": "~/Projects/agent-workspace/code-assistant",
        "skills": ["repo-review", "commit-helper", "bug-triage"]
      }
    ]
  },
  "tools": {
    "profile": "coding",
    "deny": ["message"]
  }
}
```

这里使用了官方文档中的 `tools.profile: "coding"`，它通常会包含：

- 文件系统工具；
- 运行时工具；
- Web 工具；
- session 工具；
- memory 工具；
- 部分自动化与图像类能力。

同时显式 deny `message`，避免这个 Agent 被错误地用于消息发送。

## 4.4 启动 Agent 并发送第一条测试消息

OpenClaw 支持 CLI 直接调用 Agent：

```bash
openclaw agent --message "请给我列一个今天的开发工作清单" --thinking high
```

这很适合在 macOS 终端里快速测试：

- 模型是否可用；
- 工具是否正确暴露；
- 技能是否已生效；
- 会话是否可持续。

## 4.5 多 Agent 的一个实际模式

一个适合个人开发者的 OpenClaw 架构可能是这样的：

### Agent A：Daily Assistant
- 入口：Telegram / iMessage
- 能力：搜索、日程、提醒、轻量总结
- 风险控制：不允许文件写入和 shell

### Agent B：Coding Assistant
- 入口：CLI / Dashboard
- 能力：读写文件、exec、Git 分析、文档生成
- 风险控制：不连接消息渠道

### Agent C：Ops Assistant
- 入口：Slack 私有频道
- 能力：日志分析、状态检查、发布清单
- 风险控制：只读优先，禁止 `write` 与高风险命令

OpenClaw 的多 Agent 设计让这种模式天然成立，而不是靠你在 prompt 里硬性约束“你现在扮演 A，下一轮扮演 B”。

---

# 五、工具集成与技能系统：OpenClaw 最有工程味的部分

如果说 Gateway 体现了 OpenClaw 的产品视角，那么 Tools + Skills 则体现了它的工程治理能力。

## 5.1 Tools：让 Agent 真正具备执行能力

OpenClaw 文档中列出了多类内置工具组，比较关键的有：

- `group:runtime`：`exec`、`process`、`code_execution`
- `group:fs`：`read`、`write`、`edit`、`apply_patch`
- `group:sessions`：session 管理工具
- `group:memory`：`memory_search`、`memory_get`
- `group:web`：`web_search`、`web_fetch`
- `group:ui`：`browser`、`canvas`
- `group:messaging`：`message`
- `group:plugins`：插件/MCP 暴露的工具

这意味着 OpenClaw 的工具生态并不局限于“联网搜一下”，而是具备比较完整的本地协作能力。

## 5.2 工具 Profile 是非常重要的安全开关

官方支持以下典型 profile：

- `minimal`
- `coding`
- `messaging`
- `full`

一个推荐的 macOS 开发环境配置如下：

```json
{
  "tools": {
    "profile": "coding",
    "deny": ["browser", "canvas"]
  }
}
```

原因很简单：

- 你可能需要文件和 shell；
- 但不一定需要浏览器自动化；
- UI 类工具往往更容易引入不可预测行为；
- 默认保守，按需开放，是 Agent 安全治理的基本原则。

## 5.3 自定义 Skill：用 `SKILL.md` 固化流程

OpenClaw 的 Skill 是最值得学习的设计之一。创建一个自定义技能的步骤非常清晰。

先创建目录：

```bash
mkdir -p ~/.openclaw/workspace/skills/blog-outline
```

然后创建 `SKILL.md`：

```markdown
---
name: blog-outline
description: 为技术博客自动生成结构清晰的大纲与小节说明。
---

# Blog Outline

当用户要求撰写技术博客时：

1. 先判断读者对象是初学者、工程师还是架构师；
2. 先给出文章提纲，再进入正文；
3. 若主题包含框架使用，请补充“环境搭建”“实战配置”“踩坑记录”三个章节；
4. 如果用户没有说明篇幅，默认输出适合 3000~5000 字文章的大纲；
5. 除非用户要求，不要一开始就生成完整正文。
```

创建后，验证它是否已加载：

```bash
openclaw skills list
```

然后就可以测试：

```bash
openclaw agent --message "帮我写一篇关于 MCP 的技术博客提纲"
```

## 5.4 Skill 的本质：把可复用流程从 Prompt 中抽出来

很多团队做 Agent 时有一个常见问题：

- prompt 越来越长；
- 不同任务的约束互相污染；
- 修改一个任务规则会影响所有场景；
- 无法对“指令资产”做版本控制和权限边界。

而 Skill 的好处在于：

- 可按目录组织；
- 可被 workspace 覆盖；
- 可按 Agent allowlist 控制可见性；
- 可带 gating 条件；
- 可被插件打包；
- 可被安装、更新、验证。

## 5.5 Skill 的加载优先级

根据官方文档，OpenClaw Skills 的优先级大致是：

1. `<workspace>/skills`
2. `<workspace>/.agents/skills`
3. `~/.agents/skills`
4. `~/.openclaw/skills`
5. bundled skills
6. `skills.load.extraDirs` 与 plugin skills

这意味着你可以用本地 workspace 中的 skill 去覆盖系统或插件自带 skill，而不需要改源码。

## 5.6 给 Skill 增加 gating 条件

如果某个技能依赖命令或环境变量，可以在 frontmatter 中加约束：

```markdown
---
name: git-release-helper
description: 生成发布前检查清单并调用 git 命令做预检。
metadata: { "openclaw": { "requires": { "bins": ["git"] }, "primaryEnv": "GITHUB_TOKEN" } }
---

# Git Release Helper

在执行发布检查时：
- 先确认工作区 clean；
- 再检查当前分支；
- 然后汇总最近提交；
- 最后生成 release note 草稿。
```

这类 gating 很适合 macOS 本地环境，因为你可能只在某些机器上有特定命令或密钥。

---

# 六、记忆管理：如何理解 OpenClaw 中的 MEMORY.md

Agent 一旦进入长期使用，记忆管理就会变成核心问题。很多框架提到 Memory，但多数只是：

- 把对话历史塞回 prompt；
- 做向量检索；
- 在数据库里存摘要。

OpenClaw 的思路更“工程化文档化”：它鼓励你把长期上下文的一部分显式管理在工作区文件中。虽然官方文档中提到 `memory_search`、`memory_get` 等工具，以及 workspace/memory 目录与 bootstrap 注入机制，但在实践中，`MEMORY.md` 这种文件对个人 Agent 特别有价值。

## 6.1 为什么需要 `MEMORY.md`

一个长期运行的个人 Agent，需要记住的不只是“上一轮说了什么”，而是：

- 用户偏好的写作风格；
- 经常使用的项目路径；
- 常见环境变量命名约定；
- 团队工作规范；
- 提交信息模板；
- 会议纪要组织方式；
- 哪些任务必须先给计划再执行；
- 哪些渠道消息只能总结不能自动发送。

这些内容不适合反复在 prompt 中重写，但非常适合进入 `MEMORY.md`。

## 6.2 一个适合 OpenClaw 的 `MEMORY.md` 模板

下面给出一个实战型模板：

```markdown
# MEMORY

## 用户长期偏好
- 回复优先使用中文，必要时保留英文技术术语。
- 写技术文章时先给提纲，再展开正文。
- 对代码修改必须说明影响范围与回滚方式。

## 项目约定
- 默认工作区：~/Projects
- 博客仓库：~/GitHub/mikeah2011.github.io
- Python 项目优先使用 uv 管理环境
- Node 项目优先使用 pnpm

## Git 规范
- 提交信息使用 Conventional Commits
- 提交前先执行测试或至少做静态检查
- 不要自动 push，除非用户明确要求

## 输出规范
- 方案类问题先给结论，再给步骤
- 遇到风险操作必须先说明风险点
- 大文件修改优先分步 patch，不要一次性全量重写

## 场景记忆
- 写 Hexo 博客时，frontmatter 字段必须保持规范
- 文章配图路径通常放在 /images/covers/
- 若生成教程类文章，需要包含“常见问题”章节
```

这个模板有几个优点：

1. 可读；
2. 可人工编辑；
3. 易于版本控制；
4. 与 workspace/skills 协同自然；
5. 适合个人长期维护。

## 6.3 `MEMORY.md` 与 `USER.md`、`IDENTITY.md` 的区别

很多人会把这些文件混用，建议在 OpenClaw 里做如下分工：

- `IDENTITY.md`：Agent 是谁、扮演什么角色；
- `USER.md`：用户画像、偏好和关系上下文；
- `MEMORY.md`：长期有效的规则、项目约定和经验沉淀；
- `AGENTS.md` / `BOOTSTRAP.md`：总的运行约束与入口规则。

### 一个推荐的边界

如果内容回答的是：

- “你是谁” → 放 `IDENTITY.md`
- “我是谁/我喜欢什么” → 放 `USER.md`
- “我们长期怎么协作” → 放 `MEMORY.md`

## 6.4 Memory 工具与文件记忆如何配合

OpenClaw 文档中的 memory 工具更像是“检索面”，而 `MEMORY.md` 是“人工整理后的高价值知识面”。

推荐实践是：

- 高频、稳定、规则型信息 → 写入 `MEMORY.md`
- 大量历史资料、笔记、日志 → 放入 `memory/` 目录或其他文件中，通过搜索/检索访问
- 临时会话上下文 → 交给 session 历史
- 长文档规范 → 拆成 skill 或独立 markdown 文件，再在 `MEMORY.md` 中引用

## 6.5 一个真实工作流示例

例如你把 OpenClaw 用作 macOS 上的博客助手：

- `IDENTITY.md`：定义它是“技术内容编辑 + 校对助手”；
- `USER.md`：定义你偏好中文、重视结构化表达；
- `MEMORY.md`：记录 Hexo frontmatter 规范、常用封面路径、分类标签习惯；
- `skills/blog-outline/SKILL.md`：规定先出提纲、后出正文；
- `skills/seo-polish/SKILL.md`：规定标题、摘要和关键词检查流程。

这样你的 Agent 就不是“每次重新训练”，而是在不断沉淀可复用经验。

---

# 七、OpenClaw 与 LangChain / AutoGen / Dify 等框架对比

OpenClaw 的定位比较特别，所以不能只用“谁支持的模型更多、谁 GitHub Star 更多”来比较。更合理的方式是从 **架构目标** 和 **适用场景** 维度看。

## 7.1 与 LangChain 对比

LangChain 的优势在于：

- 抽象层多；
- 生态广；
- 适合快速拼接 LLM chain、retriever、tool calling；
- 很适合嵌入后端应用。

但它的问题也很明显：

- 工程抽象层复杂，升级成本高；
- 默认并不是“长期运行的个人助手”模型；
- 渠道、守护服务、控制平面并非重点；
- 很多能力需要开发者自己组合搭建。

### 适合谁

- 你要把 AI 功能嵌入现有后端服务；
- 你需要丰富的检索链和生态集成；
- 你团队对 Python/JS SDK 编排更熟。

### OpenClaw 优势点

- 开箱即用的个人助手形态；
- 原生 Gateway + Dashboard + 渠道；
- Skills/Workspace/Session 体系更完整；
- 对“长期运行的 Agent 产品”支持更强。

## 7.2 与 AutoGen 对比

AutoGen 更偏“多智能体协作对话框架”，适合实验：

- 角色分工；
- 代理之间互相协商；
- 会话编排；
- 研究型工作流。

但在生产落地时常见挑战是：

- 工具治理不够细；
- 运行时常驻与渠道接入不是核心；
- 更偏学术/实验式多代理，而不是个人生产力系统。

### OpenClaw 更适合的点

- 你不是只想看“多代理是否能协作”，而是要真正每天用；
- 你要把 Agent 接到手机消息渠道；
- 你要有明确的 workspace、memory、skills 与 daemon 管理。

## 7.3 与 Dify 对比

Dify 更偏产品化平台，优势是：

- UI 完整；
- 适合企业内部快速搭 LLM 应用；
- 工作流、知识库、应用发布体验较强；
- 更适合运营同学或低代码团队。

但 Dify 的中心思想是“平台化应用编排”，而不是“你自己的个人 AI 助手 OS”。

### OpenClaw 更强的方面

- 本地优先；
- CLI 与系统服务友好；
- 渠道与常驻助手模型清晰；
- Workspace 文件驱动更适合开发者；
- 对 shell / 文件系统 / 本地自动化的适配更自然。

## 7.4 一个总结表格

| 对比项 | OpenClaw | LangChain | AutoGen | Dify |
|---|---|---|---|---|
| 核心定位 | 个人 AI 助手基础设施 | LLM 应用编排 SDK | 多智能体协作框架 | LLM 应用平台 |
| 常驻服务能力 | 强 | 弱 | 中 | 强 |
| 本地优先 | 强 | 中 | 中 | 中 |
| 渠道接入 | 强 | 弱 | 弱 | 中 |
| 工具治理 | 强 | 中 | 中 | 中 |
| Skill/Prompt 资产化 | 强 | 中 | 弱 | 中 |
| 开发者可控性 | 强 | 强 | 强 | 中 |
| 上手速度 | 中 | 中 | 中 | 强 |
| 适合长期个人使用 | 非常适合 | 一般 | 一般 | 一般 |

## 7.5 如何选型

如果你想要的是：

- 在自己 Mac 或服务器上长期运行一个 Agent；
- 从 Telegram、Slack、CLI、Dashboard 等多个入口访问它；
- 有清晰的工具权限控制；
- 希望用文件和 Markdown 管理长期上下文；

那么 OpenClaw 很值得优先考虑。

如果你只是要在已有 Web 应用里嵌入 RAG/Chain，LangChain 仍然很常见；如果你在做可视化企业工作流，Dify 更省事；如果你在研究多代理机制，AutoGen 更对口。

---

# 八、真实使用场景与案例

OpenClaw 最有价值的地方，不在“能不能再做一个聊天窗口”，而在它如何支撑真实工作流。

## 8.1 场景一：macOS 上的个人开发助手

### 需求

你希望有一个常驻在本机或家里服务器上的助手，可以：

- 分析代码库；
- 生成 PR 说明；
- 检查日志；
- 帮你整理每日开发任务；
- 从 Telegram 发一条消息就能让它执行诊断。

### 配置思路

```json
{
  "agents": {
    "list": [
      {
        "id": "dev-assistant",
        "workspace": "~/Projects/dev-assistant-workspace",
        "skills": ["repo-review", "bug-triage", "release-check"]
      }
    ]
  },
  "tools": {
    "profile": "coding",
    "deny": ["browser"]
  }
}
```

### 典型交互

```bash
openclaw agent --message "检查这个仓库最近两周最可能导致线上问题的提交" --thinking high
```

这种场景下，OpenClaw 的优势是：

- 能访问本地代码和 shell；
- 会话可持续；
- 规则可以沉淀到 `MEMORY.md` 和 skill；
- 未来还能接到消息渠道上。

## 8.2 场景二：博客内容生产助手

### 需求

你在 macOS 上维护 Hexo 博客，希望 AI 能：

- 根据主题先给提纲；
- 自动生成 frontmatter；
- 统一标签、分类和封面路径；
- 写完后做中文润色与 SEO 检查。

### 配置建议

- `writer` Agent 使用单独 workspace；
- 将博客规范写入 `MEMORY.md`；
- 把提纲生成、润色、SEO 审核拆成不同 skill。

#### 示例 Skill：frontmatter 校验

```markdown
---
name: hexo-frontmatter-check
description: 检查技术博客 frontmatter 是否符合站点规范。
---

# Hexo Frontmatter Check

检查文章是否包含以下字段：
- title
- date
- tags
- categories
- cover

若字段缺失，先生成修正建议，不要直接删除正文。
```

### 真实收益

这种场景不是“让 AI 帮你写一次文章”，而是让它变成一个 **长期理解你博客规则的协作编辑**。

## 8.3 场景三：消息渠道里的私人运营助手

OpenClaw 支持很多渠道。虽然实际接入每个渠道都需要各自 token 或配对流程，但架构上它已经为“跨渠道常驻助手”做好了准备。

例如你可以让它：

- 在 Telegram 私聊里接收任务；
- 在 Slack 某个团队频道只做摘要；
- 在 Discord 中要求 mention 才响应；
- 对未知 DM 发 pairing code，而不是直接执行。

这是 OpenClaw 区别于普通 Agent SDK 的关键：**它天然理解消息入口的安全边界**。

## 8.4 场景四：个人知识管理与长期记忆助手

如果你平时有很多：

- 项目笔记；
- 日报周报；
- 文档草稿；
- 会议纪要；
- 研究资料；

那么 OpenClaw 非常适合做一个“工作区驱动的知识助手”。

最佳实践通常是：

- `memory/` 目录存原始沉淀；
- `MEMORY.md` 存高价值规则与索引；
- `skills/` 目录放固定流程；
- `web_search` + `read` + `write` 组合处理资料更新。

---

# 九、常见问题与踩坑记录

最后这一部分，我结合官方 FAQ/故障排查文档和实际经验，整理一组最容易遇到的问题。

## 9.1 安装完成后 `openclaw` 命令不可用

### 现象

终端提示 `command not found: openclaw`

### 原因

- 全局 npm/bin 不在 PATH；
- 安装到了另一个 Node 版本目录；
- shell 没有重新加载。

### 排查

```bash
which node
node --version
npm root -g
which openclaw
```

### 建议

确保你使用的 Node 与安装 OpenClaw 的 Node 是同一套环境。

## 9.2 Gateway 看起来装好了，但 Dashboard 打不开

### 排查顺序

官方 Troubleshooting 文档给出很好的检查梯度：

```bash
openclaw status
openclaw status --all
openclaw gateway probe
openclaw gateway status
openclaw doctor
openclaw logs --follow
```

### 常见原因

- daemon 没启动；
- 端口冲突；
- 配置文件损坏；
- Gateway 认证或 token 配置不匹配；
- 某个插件/渠道初始化失败拖累启动。

## 9.3 Agent 能聊天，但不会用文件或命令工具

### 典型原因

- `tools.profile` 被设成了 `messaging`；
- 某个 Agent 的工具配置被覆盖；
- sandbox 下插件工具被额外过滤；
- `tools.allow` / `tools.deny` 误配置。

### 建议

先看全局状态与配置：

```bash
openclaw status --all
openclaw doctor
```

如果你是在 macOS 做本地开发助手，通常应该从 `coding` profile 开始，而不是 `messaging`。

## 9.4 Skill 写好了，但就是不生效

### 常见原因

1. `SKILL.md` frontmatter 中 `name` 不规范；
2. 文件放错目录；
3. Agent 没有该 skill 的 allowlist 权限；
4. 同名 skill 被更高优先级目录覆盖；
5. 当前 session 没刷新。

### 排查办法

```bash
openclaw skills list
```

若仍不生效，尝试：

```bash
openclaw gateway restart
```

或新开一个会话。

## 9.5 `MEMORY.md` 写太大，效果反而变差

这是很多人第一次使用长期上下文文件时会踩的坑。

### 问题本质

- 你把所有信息都塞进 `MEMORY.md`；
- 导致 bootstrap 注入过长；
- 模型注意力被稀释；
- 真正高价值规则反而不明显。

### 建议

- `MEMORY.md` 只保留稳定高价值信息；
- 大段资料拆到其他 markdown 或 `memory/` 目录；
- 技能型流程拆成 Skill；
- 用索引式表达，不要把所有原文复制进去。

## 9.6 多 Agent 配得太复杂，最后没人记得谁能干什么

### 典型错误

一口气创建 8 个 Agent：writer、coder、researcher、ops、reviewer、assistant、scheduler、browser-bot……

### 后果

- 维护成本高；
- 权限边界容易混乱；
- 用户自己都记不清该找谁。

### 建议

个人使用时先从 2~3 个 Agent 开始：

- 一个日常助理；
- 一个代码助手；
- 一个写作/研究助手。

先把边界跑顺，再扩展。

## 9.7 配置本地/自建兼容模型时各种报错

官方故障排查文档提到一个很现实的问题：某些 OpenAI-compatible 本地后端在直接请求时没问题，但在 OpenClaw Agent 场景中会失败。

### 典型兼容项

- 需要字符串型 content；
- 不支持 tools；
- 对长上下文支持不稳定；
- 对多模态字段解析不一致。

### 建议

如果你使用自建兼容接口，务必逐步验证：

1. 基础 chat/completions 是否可用；
2. tool calling 是否可用；
3. 长上下文是否稳定；
4. Agent Runtime 下是否能持续工作。

不要假设“兼容 OpenAI API”就等于“完整兼容 Agent Runtime 场景”。

## 9.8 为什么我觉得 OpenClaw 比别的框架更复杂？

因为它解决的问题本来就更复杂。

如果你只需要：

- 一次性调用模型；
- 两三个工具；
- 一个 Web 页面；

那 OpenClaw 当然显得“重”。

但如果你的目标是：

- 长期运行；
- 跨终端接入；
- 本地工作区协作；
- 多 Agent 隔离；
- 持久记忆；
- 权限治理；

那它的复杂度其实是“问题复杂度的真实映射”。

---

# 十、总结：OpenClaw 适合怎样的开发者

如果用一句话总结 OpenClaw，我会说：

**它不是又一个“帮你调 LLM API”的库，而是一套面向个人常驻 AI 助手的本地优先运行框架。**

它最吸引人的地方有四点：

1. **架构完整**：不是只做 tool calling，而是把 Gateway、Agent Runtime、Workspace、Skills、Channels、Memory 串成一个系统；
2. **工程治理强**：工具权限、技能优先级、Agent 隔离、状态目录都很清晰；
3. **开发者友好**：Markdown 文件驱动、CLI 友好、适合本地工作流；
4. **适合长期使用**：能真正成长为你的私人 AI 助手，而不是只是一段 demo。

当然，它也不是银弹。OpenClaw 更适合：

- 需要长期运行 Agent 的个人开发者；
- 希望自托管/本地优先的技术团队；
- 需要把 AI 接到消息渠道和本地系统的人；
- 愿意通过配置和文件组织来治理 Agent 行为的人。

如果你要的是一个极轻量的 LLM 工作流 SDK，OpenClaw 可能显得偏重；但如果你要的是一个真正能在 macOS 或服务器上常驻、可跨渠道访问、能沉淀技能与记忆的开源 AI Agent 框架，它非常值得深入研究。

最后给出一条建议：

**在 macOS 上首次使用 OpenClaw，不要一上来追求“全渠道、全工具、全自动化”。先完成最小闭环：安装 CLI → onboard → 跑起 Gateway → 打开 Dashboard → 创建一个边界清晰的 Agent → 写一个 Skill → 落一个 MEMORY.md。**

只要这个闭环跑通，你就已经拥有了一套真正可进化的个人 AI Assistant 基础设施。

---

# 附：macOS 实战命令速查表

## 安装与初始化

```bash
brew install node@24
npm install -g openclaw@latest
OPENCLAW_LOCALE=zh-CN openclaw onboard --install-daemon
```

## 状态检查

```bash
openclaw status
openclaw status --all
openclaw gateway status
openclaw doctor
openclaw logs --follow
```

## Dashboard 与前台调试

```bash
openclaw dashboard
openclaw gateway stop
openclaw gateway --port 18789 --verbose
```

## Agent 与技能

```bash
openclaw agents add writer
openclaw skills list
openclaw agent --message "给我今天的写作计划"
```

## Skill 目录示例

```bash
mkdir -p ~/.openclaw/workspace/skills/blog-outline
```

`~/.openclaw/workspace/skills/blog-outline/SKILL.md`

```markdown
---
name: blog-outline
description: 为技术博客生成结构化提纲。
---

当用户要写技术博客时，优先输出提纲，再展开正文。
```

## `MEMORY.md` 示例

```markdown
# MEMORY

- 默认以中文回复。
- 技术文章先提纲后正文。
- Hexo frontmatter 必须包含 title/date/tags/categories/cover。
- 不要未经确认自动执行高风险写操作。
```

## 相关阅读

- [OpenHuman vs Hermes vs OpenClaw：2026 年开源 AI Agent 框架深度对比](/categories/AI/2026-06-02-openhuman-vs-hermes-vs-openclaw-ai-agent-framework-comparison/)
- [AI Agent 记忆系统对比：Hermes vs OpenClaw vs OpenHuman](/categories/AI/ai-agent-memory-system-hermes-vs-openclaw-vs-openhuman/)
- [2026 开源 AI Agent 三巨头深度评测：Hermes vs OpenClaw vs OpenHuman](/categories/AI/2026-open-source-ai-agent-hermes-vs-openclaw-vs-openhuman-deep-review/)
