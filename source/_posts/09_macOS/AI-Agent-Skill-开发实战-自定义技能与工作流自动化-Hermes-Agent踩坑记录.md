---
title: AI Agent Skill 开发实战：自定义技能与工作流自动化——Hermes Agent 踩坑记录
date: 2026-05-17 03:41:03
updated: 2026-05-17 03:44:15
categories:
  - macOS
  - AI 工具链
tags: [AI, macOS, 架构]description: 深入 Hermes Agent Skill 系统的实战开发经验——从 SKILL.md 格式规范、Progressive Disclosure 机制、条件激活、环境变量管理，到真实 Skill 编写与 Cron 自动化工作流集成，完整踩坑记录。
---

# AI Agent Skill 开发实战：自定义技能与工作流自动化——Hermes Agent 踩坑记录

## 前言

在用 Hermes Agent 做日常开发辅助的过程中，我逐渐意识到一个问题：**每次让 AI 做重复性任务时，都要花大量 Token 重新描述上下文和规则**。比如写博客、调试代码、创建 PR——这些任务的流程是固定的，但每次都得从头交代。

Hermes Agent 的 Skill 系统解决了这个问题。它本质上是一种**结构化的知识注入机制**：把任务流程、规则、参考信息打包成一个 `SKILL.md` 文件，Agent 按需加载，不用每次都重复说明。

这篇文章记录了我在实际使用中对 Skill 系统的深度理解，包括架构设计、开发流程、条件激活机制，以及踩过的坑。

---

## 一、Skill vs Tool：什么时候该用哪个？

这是开发前的第一个决策点。很多人混淆这两个概念，导致选错方案。

**Skill（技能）** 适合：
- 能用**指令 + Shell 命令 + 现有工具组合**实现的能力
- 包装外部 CLI 或 API（Agent 通过 `terminal` 或 `web_extract` 调用）
- 不需要自定义 Python 集成或 API Key 管理
- 例子：arXiv 搜索、Git 工作流、Docker 管理、PDF 处理

**Tool（工具）** 适合：
- 需要**端到端 API Key 集成、认证流程或多组件配置**
- 需要**每次精确执行**的自定义处理逻辑
- 涉及二进制数据、流式传输或实时事件
- 例子：浏览器自动化、TTS、视觉分析

```
┌─────────────────────────────────────────────────────┐
│                  Hermes Agent 架构                   │
│                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │  Skills  │    │  Tools   │    │  Toolsets    │   │
│  │ (知识注入)│    │ (代码执行)│    │ (能力集合)   │   │
│  └────┬─────┘    └────┬─────┘    └──────┬───────┘   │
│       │               │                │            │
│       ▼               ▼                ▼            │
│  ┌──────────────────────────────────────────────┐   │
│  │          AIAgent.run_conversation()          │   │
│  │  ┌────────────────────────────────────────┐  │   │
│  │  │  System Prompt ← Skills 注入上下文     │  │   │
│  │  │  User Message  ← 用户指令              │  │   │
│  │  │  Tool Calls    ← Tools 执行操作        │  │   │
│  │  └────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**踩坑记录**：我一开始想把"博客写作助手"做成 Tool（Python 脚本），结果发现写博客这件事本质是**指令驱动**的——需要 AI 理解选题池、去重逻辑、文章结构。这些东西用 Skill（纯 Markdown 指令）比写 Python 代码灵活得多，而且修改规则不需要重启 Agent。

---

## 二、SKILL.md 格式详解

每个 Skill 的核心是一个 `SKILL.md` 文件。它由两部分组成：**YAML Frontmatter**（元数据）和 **Markdown Body**（指令正文）。

### 2.1 Frontmatter 规范

```yaml
---
name: my-blog-writer                    # 必填：小写 + 连字符，≤64 字符
description: "Use when writing blog posts. Automates backlog selection, dedup, and publishing."
                                       # 必填：≤1024 字符
version: 1.0.0
author: Michael
license: MIT
platforms: [macos]                      # 可选：限制平台
metadata:
  hermes:
    tags: [blog, writing, automation, hexo]
    related_skills: [writing-plans, systematic-debugging]
    requires_toolsets: [terminal]       # 可选：依赖的 toolset
    requires_tools: [write_file, search_files]  # 可选：依赖的 tool
    config:                             # 可选：config.yaml 配置项
      - key: blog.repo_path
        description: "Hexo 博客仓库路径"
        default: "~/GitHub/mikeah2011.github.io"
        prompt: "博客仓库路径"
required_environment_variables: []      # 可选：环境变量
---
```

**关键约束**（源码 `tools/skill_manager_tool.py::_validate_frontmatter` 强制校验）：
- 文件必须以 `---` 开头（不能有前导空行）
- 必须有 `name` 和 `description` 字段
- `description` ≤ 1024 字符
- `---` 闭合后必须有非空正文

### 2.2 Body 结构推荐

```markdown
# 技能标题

## Overview
一句话说明这个技能做什么。

## When to Use
触发条件——Agent 什么时候应该加载这个技能？

## Quick Reference
常用命令/操作的速查表。

## Procedure
Agent 需要遵循的分步指令。这是核心部分。

## Pitfalls
已知的失败模式和处理方式。

## Verification
如何确认操作成功。
```

**踩坑记录**：`name` 字段只能用小写字母和连字符。我一开始用了 `BlogWriter` 驼峰命名，验证直接报错。另外 `description` 的 1024 字符限制比想象中容易超——如果你写得太详细，会被截断。建议 description 写触发条件 + 一行行为描述就够了。

---

## 三、Progressive Disclosure：三级加载机制

这是 Skill 系统最精妙的设计——**渐进式加载**，避免一次性注入所有 Skill 内容浪费 Token。

```
Level 0: skills_list()
  → 返回 [{name, description, category}, ...]
  → 约 3k tokens（所有 Skill 的索引）

Level 1: skill_view(name='my-skill')
  → 返回完整 SKILL.md 内容 + 元数据
  → Token 数取决于 Skill 大小

Level 2: skill_view(name='my-skill', path='references/api-spec.md')
  → 返回 Skill 目录下的特定参考文件
  → 按需加载子资源
```

```
┌─────────────────────────────────────────────────────┐
│              Progressive Disclosure 流程             │
│                                                     │
│  用户请求 ──→ Agent 调用 skills_list()              │
│                  │                                  │
│                  ▼                                  │
│          扫描所有 Skill 索引（~3k tokens）           │
│                  │                                  │
│                  ▼                                  │
│          匹配最合适的 Skill                          │
│                  │                                  │
│                  ▼                                  │
│          skill_view(name) 加载完整内容               │
│                  │                                  │
│                  ▼                                  │
│          按需加载 references/ 子文件                  │
│                  │                                  │
│                  ▼                                  │
│          执行任务，输出结果                           │
└─────────────────────────────────────────────────────┘
```

**实战意义**：假设你安装了 50 个 Skill，每个 500 字。如果全部注入 System Prompt 就是 25000 tokens——每轮对话都消耗。Progressive Disclosure 让 Agent 先看索引（3k tokens），找到匹配的再加载具体内容，**Token 消耗降低 80% 以上**。

---

## 四、条件激活：让 Skill 按上下文自动出现/隐藏

Skill 可以声明依赖条件，控制在什么上下文中出现：

```yaml
metadata:
  hermes:
    requires_toolsets: [web]              # 没有 web toolset → 隐藏
    requires_tools: [web_search]          # 没有 web_search 工具 → 隐藏
    fallback_for_toolsets: [browser]      # 有 browser toolset → 隐藏
    fallback_for_tools: [browser_navigate] # 有 browser_navigate → 隐藏
```

**真实场景**：

| 场景 | 配置 | 效果 |
|------|------|------|
| 网页抓取 Skill | `requires_toolsets: [web]` | 没有 web 工具时不显示，避免空操作 |
| DuckDuckGo 搜索 Skill | `fallback_for_tools: [web_search]` | 有正式搜索工具时隐藏，作为降级方案 |
| macOS 专属 Skill | `platforms: [macos]` | Linux/Windows 上自动隐藏 |

**踩坑记录**：`fallback_for_*` 和 `requires_*` 是互斥的设计思路。`requires_*` 是"我需要 X 才能工作"，`fallback_for_*` 是"如果 X 已经有了，就不用我了"。别把两个混在一起用，否则可能出现 Skill 永远不显示的 bug。

---

## 五、环境变量与配置管理

Skill 可以声明两种配置：

### 5.1 环境变量（敏感信息）

```yaml
required_environment_variables:
  - name: GITHUB_TOKEN
    prompt: "GitHub Personal Access Token"
    help: "Generate at https://github.com/settings/tokens"
    required_for: "API access"
```

存储在 `~/.hermes/.env`，**永远不会暴露给模型**。加载 Skill 时如果缺失，CLI 会安全提示输入。

### 5.2 Config 设置（非敏感信息）

```yaml
metadata:
  hermes:
    config:
      - key: blog.repo_path
        description: "Hexo 博客仓库路径"
        default: "~/GitHub/mikeah2011.github.io"
```

存储在 `~/.hermes/config.yaml` 的 `skills.config.*` 命名空间下。加载时自动注入到 Skill 消息中：

```
[Skill config (from ~/.hermes/config.yaml):
  blog.repo_path = /Users/michael/GitHub/mikeah2011.github.io
]
```

**踩坑记录**：环境变量声明后，会**自动传递到 terminal 和 execute_code 沙箱**（包括 Docker、Modal 等远程后端）。这意味着你的 Skill 脚本可以直接用 `os.environ["GITHUB_TOKEN"]`，不需要用户额外配置。这个设计非常贴心，但文档里不太显眼。

---

## 六、实战：从零开发一个博客写作 Skill

下面是我实际使用的博客写作 Skill 的核心逻辑（简化版）：

```markdown
---
name: hexo-blog-writer
description: "Use when writing Hexo blog posts. Handles backlog selection, dedup, article generation, and publishing."
version: 1.0.0
author: Michael
metadata:
  hermes:
    tags: [blog, hexo, writing, automation]
    config:
      - key: blog.repo_path
        description: "Hexo blog repo path"
        default: "~/GitHub/mikeah2011.github.io"
---

# Hexo Blog Writer

## When to Use
- User asks to write a blog post
- Scheduled cron job triggers blog writing
- User mentions "写博客" or "blog post"

## Procedure

### Step 1: Get Current Time
Run `date '+%Y-%m-%d %H:%M:%S'` for creation timestamp.

### Step 2: Read Backlog
Read `.writing-backlog.md` in the repo root.
Find all `- [ ]` unchecked topics.

### Step 3: Dedup Check
Scan `source/_posts/` for existing articles.
- No duplicate topics
- Title similarity must be < 60%

### Step 4: Generate Article
Requirements:
- 1500-2500 words
- Must include: real code examples, architecture diagrams, pitfall records
- Technical depth: mid-to-senior developer perspective
- Title format: `{keyword}-{direction}`

### Step 5: Save & Update
1. Save to `source/_posts/{category}/`
2. Update `.writing-backlog.md`: `- [ ]` → `- [x]` with path + date
3. Output notification in template format

## Pitfalls
- Always check for duplicate filenames AND titles
- The `updated` timestamp must be captured AFTER saving
- Front matter `date` = creation time, NOT current time at save
```

**目录结构**：

```
~/.hermes/skills/
└── writing/
    └── hexo-blog-writer/
        ├── SKILL.md              # 主指令文件
        └── references/           # 参考资料（可选）
            ├── article-template.md
            └── notification-template.md
```

---

## 七、Skill 与 Cron 自动化集成

Skill 最强大的用法之一是**与 Cron 调度系统结合**，实现无人值守的自动化工作流。

```yaml
# ~/.hermes/config.yaml
cron:
  jobs:
    - name: daily-blog-post
      schedule: "0 3 * * 0"        # 每周日凌晨 3 点
      message: "使用 hexo-blog-writer skill 写一篇博客文章"
      destination: telegram          # 结果发送到 Telegram
```

工作流程：

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Cron    │────→│  Agent   │────→│  Skill   │────→│  Result  │
│ Scheduler│     │  启动    │     │  加载    │     │  输出    │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                       │                                  │
                       ▼                                  ▼
                 加载 System Prompt              发送到配置的
                 + Skill 指令                    Destination
```

**踩坑记录**：Cron 任务中 Agent 是**无人值守**的，不能提问、不能等待确认。所以 Skill 的指令必须是**完全确定性的**——每一步都有明确的判断条件和兜底策略。比如"如果没有未完成选题，输出 [SILENT] 并停止"，而不是"询问用户要写什么"。

---

## 八、内置 Skill 案例分析

Hermes Agent 内置了多个高质量 Skill，值得学习其设计模式：

### 8.1 systematic-debugging（系统化调试）

```yaml
name: systematic-debugging
description: "4-phase root cause debugging: understand bugs before fixing."
```

核心设计：**强制流程**。4 个阶段（Root Cause Investigation → Hypothesis → Fix → Verify），每个阶段必须完成才能进入下一个。用"铁律"约束 Agent 行为：

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

**启发**：好的 Skill 不只是"建议"，而是**强制约束**。Agent 天生倾向于"快速修复"，Skill 的作用就是拉住它。

### 8.2 writing-plans（编写计划）

这个 Skill 让 Agent 在执行复杂任务前先输出 Markdown 格式的实施计划，而不是直接动手。保存在 `.hermes/plans/` 目录下。

**启发**：对于多步骤任务，Skill 可以强制 Agent 先规划后执行，避免"做了一半发现方向错了"。

### 8.3 test-driven-development（TDD）

强制 Agent 先写测试、再写实现。红-绿-重构的标准 TDD 流程。

**启发**：Skill 可以编码**方法论**，而不只是操作步骤。

---

## 九、开发踩坑总结

### 坑 1：Skill 文件编码问题

`SKILL.md` 必须是 **UTF-8 编码**。我有一次从 Confluence 复制内容带了 BOM 头，导致 YAML 解析失败，报错信息很模糊（只说"invalid frontmatter"）。

### 坑 2：Body 不能为空

Frontmatter 的 `---` 闭合后，**必须有非空正文**。如果你只写了 frontmatter 没写 body，验证会失败。即使只需要元数据，也得写个标题。

### 坑 3：name 命名冲突

如果两个 Skill 同名（比如都在不同目录下有 `my-skill`），后加载的会覆盖先加载的。确保 name 全局唯一。

### 坑 4：Token 预算

单个 Skill 内容不宜超过 **5000 tokens**（约 2000 中文字）。太大的 Skill 会：
1. 挤占对话上下文空间
2. 增加每次 API 调用成本
3. 降低 Agent 对其他上下文的注意力

如果 Skill 内容太多，拆成主文件 + `references/` 子文件，用 Level 2 按需加载。

### 坑 5：Slash Command 注入方式

Skill 作为 Slash Command 时，内容是以 **user message**（而非 system prompt）注入的。这是为了保留 prompt caching。但这也意味着 Skill 内容的优先级低于 system prompt——如果有冲突，system prompt 的规则优先。

### 坑 6：平台限制要显式声明

如果你的 Skill 只在 macOS 上有意义（比如操作 iMessage、Apple Reminders），**必须**设置 `platforms: [macos]`。否则 Linux 用户会看到一个用不了的 Skill，体验很差。

---

## 十、最佳实践清单

```
✅ Skill 命名：小写 + 连字符，全局唯一
✅ Description：触发条件 + 一行行为描述，≤1024 字符
✅ Body 结构：Overview → When to Use → Procedure → Pitfalls → Verification
✅ 敏感信息：用 required_environment_variables，不要硬编码
✅ 非敏感配置：用 metadata.hermes.config，存 config.yaml
✅ Token 控制：单 Skill ≤ 5000 tokens，多的拆 references/
✅ 条件激活：合理使用 requires_*/fallback_for_*
✅ 平台限制：非跨平台 Skill 必须声明 platforms
✅ Cron 兼容：无人值守场景，指令必须确定性，包含兜底策略
✅ 版本管理：更新 Skill 时递增 version 字段
```

---

## 总结

Hermes Agent 的 Skill 系统本质上是一个**结构化的知识注入框架**。它的核心价值不是让 Agent "更聪明"，而是让 Agent "更一致"——通过标准化的指令格式，确保每次执行相同任务时遵循相同的流程。

对于日常开发中重复性高、流程固定的任务（写博客、创建 PR、调试 bug、生成文档），把流程抽成 Skill 是投入产出比最高的优化。配合 Cron 调度系统，可以实现真正的**无人值守自动化工作流**。

如果你正在用 Hermes Agent（或其他支持类似机制的 AI Agent），强烈建议从你最常做的重复任务开始，写第一个 Skill。
