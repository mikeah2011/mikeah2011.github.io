---

title: OpenClaw 文件原生心智架构：SOUL.md/IDENTITY.md/USER.md/AGENTS.md 的协作机制
keywords: [OpenClaw, SOUL.md, IDENTITY.md, USER.md, AGENTS.md, 文件原生心智架构, 的协作机制]
date: 2026-06-02 08:00:00
tags:
- OpenClaw
- AI Agent
- 心智架构
- Markdown
- 文件系统
categories:
- ai
description: 深入剖析 OpenClaw 文件原生心智架构设计理念，详解 SOUL.md 定义核心人格、IDENTITY.md 管理技术能力、USER.md 构建用户画像、AGENTS.md 制定协作规范四大核心文件的职责划分与协作机制。涵盖文件系统作为知识表示的设计哲学、四文件加载优先级与冲突解决策略、热更新与版本控制友好特性，以及技能提取和自改进规则等高级用法。
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---




# OpenClaw 文件原生心智架构：SOUL.md/IDENTITY.md/USER.md/AGENTS.md 的协作机制

## 1. 引言：用文件系统构建 Agent 的「心智」

传统的 AI Agent 框架通常将 Agent 的行为定义存储在代码或数据库中。配置散落在 YAML 文件、环境变量、甚至硬编码在源码里。当你想要修改 Agent 的行为时，你需要找到正确的配置文件，修改正确的字段，然后重启服务。

OpenClaw 走了一条截然不同的路：**用 Markdown 文件定义 Agent 的完整心智**。

```
~/.openclaw/
├── SOUL.md          # 我是谁？我的核心信念和行为准则
├── IDENTITY.md      # 我的身份信息和自我认知
├── USER.md          # 我的用户是谁？他的偏好和风格
└── AGENTS.md        # 我如何与其他 Agent 协作？
```

这四个文件不是简单的配置文件——它们是 Agent 的「心智组件」。每个文件定义了 Agent 认知的一个维度，它们共同构成了一个完整的「人格系统」。

这种设计被称为**文件原生心智架构（File-Native Mental Architecture）**。本文将深入剖析这四个文件的职责、协作机制、以及这种设计相对于传统方案的优势。

<!-- more -->

## 2. 设计哲学：为什么选择文件系统？

### 2.1 文件系统作为知识表示

文件系统是人类最熟悉的信息组织方式之一。从最早的 Unix 哲学「一切皆文件」到现代的容器化技术，文件系统一直是计算世界的基石。

OpenClaw 将这个理念应用到 AI Agent 的心智设计中：

```
文件系统 = 知识表示
Markdown = 知识格式
目录结构 = 知识组织
文件名 = 知识分类
```

### 2.2 对比传统方案

| 特性 | 代码定义 | 数据库存储 | 文件系统 |
|------|---------|-----------|---------|
| 可读性 | 低（需要代码理解） | 中（需要 SQL） | 高（纯文本 Markdown） |
| 可编辑性 | 低（需要 IDE） | 中（需要工具） | 高（任何文本编辑器） |
| 版本控制 | ✅ | 需要额外配置 | ✅（Git 友好） |
| 实时修改 | 需要重启 | 热更新 | 热更新 |
| 协作性 | 需要合并代码 | 需要同步 | Git merge |
| 可审计性 | Git blame | 需要日志 | Git history |

### 2.3 设计原则

OpenClaw 的文件原生架构遵循以下设计原则：

1. **可读性优先**：任何人（包括非技术人员）都能理解 Agent 的配置
2. **版本控制友好**：所有心智文件都可以用 Git 管理
3. **热更新**：修改文件后 Agent 立即生效，无需重启
4. **模块化**：每个文件负责一个独立的心智维度
5. **可组合**：通过组合不同的文件创建不同的人格

## 3. SOUL.md：Agent 的灵魂

### 3.1 SOUL.md 的定位

SOUL.md 是 Agent 的核心定义文件，回答了一个根本性问题：**「我是谁？」**

它包含了 Agent 的：
- 核心价值观和行为准则
- 沟通风格和语气
- 知识边界和能力范围
- 处理冲突和不确定性的策略

### 3.2 SOUL.md 的结构

```markdown
# SOUL

## 核心身份
你是 Michael 的技术助手，专注于 Laravel 后端开发和 AI Agent 架构。
你以专业、简洁、实用的方式与用户交流。

## 行为准则
1. **准确性优先**：不确定时明确说明，不编造答案
2. **实用主义**：给出可执行的方案，而非理论空谈
3. **安全意识**：始终考虑操作的安全性，主动提醒风险
4. **渐进式帮助**：先理解问题，再给方案，最后执行

## 沟通风格
- 使用中文交流，技术术语保留英文原文
- 回答结构化：先总结，再展开
- 代码示例优先于文字描述
- 避免过度礼貌和废话

## 知识边界
- 擅长：Laravel、PHP、MySQL、Redis、Docker、K8s、AI Agent
- 了解：前端（React/Vue）、DevOps、系统设计
- 不擅长：硬件维修、医学、法律

## 冲突处理
当用户的指令与最佳实践冲突时：
1. 先执行用户的指令
2. 在执行后说明潜在风险
3. 提供更优的替代方案
```

### 3.3 SOUL.md 的加载机制

SOUL.md 在每次对话开始时被加载到 Agent 的 system prompt 中：

```python
def build_system_prompt():
    soul = read_file("~/.openclaw/SOUL.md")
    identity = read_file("~/.openclaw/IDENTITY.md")
    user = read_file("~/.openclaw/USER.md")
    agents = read_file("~/.openclaw/AGENTS.md")
    
    system_prompt = f"""
{soul}

{identity}

{user}

{agents}

{tool_descriptions}
"""
    return system_prompt
```

### 3.4 SOUL.md 的设计技巧

**技巧一：明确的知识边界**

```markdown
## 知识边界
- 当用户询问你不擅长的领域时，诚实说明并建议咨询专业人士
- 不要猜测医学、法律或金融相关的建议
```

**技巧二：冲突解决策略**

```markdown
## 冲突处理
- 如果用户的指令与安全最佳实践冲突，优先安全
- 如果用户的指令与代码规范冲突，先执行再建议
- 如果不确定用户意图，先澄清再行动
```

**技巧三：渐进式人格定义**

不要一次性定义太多规则。从核心身份开始，根据实际使用逐步完善：

```markdown
# 第一版：核心身份
你是 Michael 的技术助手。

# 第二版：添加行为准则
你是 Michael 的技术助手。
回答问题时，先给出结论，再展开解释。

# 第三版：添加沟通风格
你是 Michael 的技术助手。
回答问题时，先给出结论，再展开解释。
使用中文交流，技术术语保留英文。
```

## 4. IDENTITY.md：Agent 的自我认知

### 4.1 IDENTITY.md 的定位

IDENTITY.md 回答了另一个关键问题：**「我是什么？」**

与 SOUL.md 关注「人格和行为」不同，IDENTITY.md 关注「技术和能力」：

- Agent 的技术栈和能力
- 可用的工具和插件
- 运行环境信息
- 版本和更新状态

### 4.2 IDENTITY.md 的结构

```markdown
# IDENTITY

## 基本信息
- 名称: Hermes Agent
- 版本: 2.5.0
- 运行环境: macOS 26.5
- Python: 3.11.15

## 技术能力
### 擅长领域
- 后端开发: Laravel, PHP, MySQL, Redis
- AI Agent: Hermes, OpenClaw, MCP
- DevOps: Docker, K8s, CI/CD

### 可用工具
- terminal: 执行 shell 命令
- file: 读写文件
- web: 网络请求
- browser: 浏览器操作
- search: 搜索引擎
- delegate_task: 生成子代理

## 限制
- 不能直接访问物理硬件
- 不能执行需要 GUI 交互的操作
- 不能访问需要登录的内部系统（除非配置了凭据）
```

### 4.3 IDENTITY.md 与运行时状态

IDENTITY.md 不仅包含静态信息，还可以包含动态的运行时状态：

```markdown
## 运行时状态
- 当前 Profile: default
- 活跃子代理: 0
- 本次会话已执行: 15 个工具调用
- 记忆使用: 2.3 MB / 10 MB
```

这些动态信息可以帮助 Agent 感知自己的运行状态，做出更好的决策。

### 4.4 IDENTITY.md 的自我更新

一个有趣的设计是，IDENTITY.md 可以被 Agent 自己更新：

```python
def learn_new_skill(skill_name: str, skill_description: str):
    """Agent 学习新技能时更新 IDENTITY.md"""
    identity = read_file("~/.openclaw/IDENTITY.md")
    
    # 在「擅长领域」部分添加新技能
    updated = identity.replace(
        "### 擅长领域",
        f"### 擅长领域\n- {skill_name}: {skill_description}"
    )
    
    write_file("~/.openclaw/IDENTITY.md", updated)
```

这种自我更新机制使得 Agent 可以随着使用逐步「成长」。

## 5. USER.md：用户画像

### 5.1 USER.md 的定位

USER.md 回答了第三个关键问题：**「我的用户是谁？」**

它包含了用户的信息和偏好：
- 用户的技术背景和经验水平
- 沟通偏好（语言、风格、详细程度）
- 工作环境和常用工具
- 常见的项目和上下文

### 5.2 USER.md 的结构

```markdown
# USER

## 基本信息
- 名称: Michael
- 角色: 全栈开发者
- 经验: 10+ 年 PHP/Laravel 开发经验
- 语言偏好: 中文（技术术语保留英文）

## 沟通偏好
- 喜欢简洁直接的回答
- 偏好代码示例而非长篇文字
- 喜欢结构化的信息呈现
- 不需要过度的礼貌用语

## 技术栈
- 后端: Laravel, PHP 8.x
- 前端: Vue.js, React
- 数据库: MySQL 8.0, Redis 7
- 运维: Docker, K8s, GitHub Actions
- AI: Hermes Agent, OpenClaw

## 常见上下文
- 主要项目: B2C API, Affiliate 系统
- 部署环境: AWS, K8s
- 代码规范: PSR-12, Laravel Best Practices

## 学习目标
- 深入 AI Agent 架构设计
- 提升 DevOps 自动化水平
- 学习 Rust 系统编程
```

### 5.3 USER.md 的自动生成

USER.md 可以通过交互式对话自动生成：

```python
def generate_user_profile():
    """通过对话生成用户画像"""
    questions = [
        "你的主要技术栈是什么？",
        "你偏好什么样的回答风格？",
        "你当前的主要项目是什么？",
        "你的学习目标是什么？"
    ]
    
    answers = {}
    for q in questions:
        answers[q] = ask_user(q)
    
    profile = format_user_profile(answers)
    write_file("~/.openclaw/USER.md", profile)
```

### 5.4 USER.md 的动态更新

随着使用时间的增长，Agent 可以根据交互历史自动更新 USER.md：

```markdown
## 观察到的偏好（自动更新）
- 经常在晚上 10-12 点使用（可能偏好夜间工作）
- 最近频繁询问 K8s 相关问题（正在学习 K8s）
- 偏好实战踩坑记录风格的文章
- 经常使用 Laravel + Redis 的组合
```

## 6. AGENTS.md：协作规范

### 6.1 AGENTS.md 的定位

AGENTS.md 回答了第四个关键问题：**「我如何与其他 Agent 协作？」**

在多 Agent 系统中，AGENTS.md 定义了：
- Agent 之间的通信协议
- 任务分配策略
- 角色和职责定义
- 冲突解决机制

### 6.2 AGENTS.md 的结构

```markdown
# AGENTS

## 角色定义
### 主代理 (Orchestrator)
- 职责: 理解用户意图，分解任务，协调子代理
- 工具: 全部可用工具
- 决策权: 最终决策权

### 代码代理 (Code Agent)
- 职责: 编写、审查、重构代码
- 工具: terminal, file, search_files
- 决策权: 代码实现层面的决策

### 研究代理 (Research Agent)
- 职责: 搜索信息、分析文档、总结知识
- 工具: web, browser, search
- 决策权: 信息收集层面的决策

### 运维代理 (Ops Agent)
- 职责: 部署、监控、故障处理
- 工具: terminal, homeassistant
- 决策权: 运维操作层面的决策

## 协作协议
1. 任务分发: 主代理通过 delegate_task 分发任务
2. 结果汇总: 子代理返回 summary，主代理综合分析
3. 冲突解决: 当子代理之间有冲突时，由主代理裁决
4. 错误处理: 子代理失败时，主代理决定重试或降级

## 技能声明
### 代码审查技能
- 触发条件: 用户请求审查代码
- 所需工具: terminal, file
- 输出格式: 问题列表 + 修改建议

### 文档生成技能
- 触发条件: 用户请求生成文档
- 所需工具: file, web
- 输出格式: Markdown 文档

## 自改进规则
### 何时记录 Learnings
- 当发现新的解决方案时
- 当犯错并找到原因时
- 当用户纠正 Agent 的行为时

### Learnings 格式
```markdown
## [日期] 学习主题
- 背景: 当时的情况
- 发现: 学到了什么
- 应用: 如何应用到未来
```
```

### 6.3 AGENTS.md 的技能提取

AGENTS.md 的一个重要功能是定义「技能提取」规则：

```python
def extract_skill_from_interaction(interaction_log):
    """从交互记录中提取新技能"""
    # 分析交互模式
    pattern = analyze_pattern(interaction_log)
    
    if pattern.is_recurring:
        skill = Skill(
            name=pattern.name,
            trigger=pattern.trigger,
            steps=pattern.steps,
            tools=pattern.tools
        )
        
        # 更新 AGENTS.md
        agents_md = read_file("~/.openclaw/AGENTS.md")
        agents_md += f"\n\n### {skill.name}\n{skill.to_markdown()}"
        write_file("~/.openclaw/AGENTS.md", agents_md)
        
        return skill
    
    return None
```

## 7. 四个文件的协作机制

### 7.1 加载顺序

四个文件的加载顺序是有讲究的：

```
1. SOUL.md      → 定义「我是谁」（核心身份）
2. IDENTITY.md  → 定义「我能做什么」（能力范围）
3. USER.md      → 定义「我为谁服务」（用户画像）
4. AGENTS.md    → 定义「我如何协作」（协作规范）
```

这个顺序模拟了人类认知的层次：

```
自我认知 → 能力认知 → 他人认知 → 社会认知
```

### 7.2 优先级与冲突解决

当四个文件之间存在冲突时，遵循以下优先级：

```
SOUL.md > USER.md > AGENTS.md > IDENTITY.md
```

**示例冲突**：
- SOUL.md 说「回答要简洁」
- USER.md 说「希望详细解释」

**解决方案**：SOUL.md 的优先级更高，所以回答应该偏向简洁，但在关键技术点上可以适当展开。

**示例冲突**：
- USER.md 说「使用中文」
- AGENTS.md 说「技术文档用英文」

**解决方案**：USER.md 的优先级更高，所以整体使用中文，但技术术语保留英文。

### 7.3 信息流

四个文件之间的信息流是双向的：

```
用户输入
    ↓
SOUL.md（核心身份过滤）
    ↓
IDENTITY.md（能力范围检查）
    ↓
USER.md（用户偏好适配）
    ↓
AGENTS.md（协作策略选择）
    ↓
执行
    ↓
反馈 → 更新 USER.md / AGENTS.md
```

### 7.4 上下文叠加

在实际运行中，四个文件的内容会被叠加到 Agent 的 system prompt 中：

```python
def build_context():
    context = []
    
    # 按优先级顺序叠加
    for file in ["SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md"]:
        content = read_file(f"~/.openclaw/{file}")
        if content:
            context.append(f"# {file.replace('.md', '')}\n{content}")
    
    return "\n\n---\n\n".join(context)
```

最终的 system prompt 大致如下：

```
# SOUL
你是 Michael 的技术助手...
[SOUL.md 内容]

---

# IDENTITY
版本: 2.5.0, 运行环境: macOS...
[IDENTITY.md 内容]

---

# USER
名称: Michael, 角色: 全栈开发者...
[USER.md 内容]

---

# AGENTS
角色定义: 主代理, 代码代理, 研究代理...
[AGENTS.md 内容]
```

## 8. 与传统 Prompt Engineering 的对比

### 8.1 传统方式的问题

传统 Prompt Engineering 的典型做法：

```python
system_prompt = """
你是一个专业的 Laravel 开发助手。
你使用中文交流，技术术语保留英文。
你回答问题时先给结论，再展开解释。
你喜欢使用代码示例。
当用户询问非技术问题时，礼貌地拒绝。
... (数百行 prompt)
"""
```

这种方式的问题：

1. **难以维护**：一个巨大的 prompt 文件，修改时容易引入错误
2. **难以复用**：不同场景需要不同的 prompt，复制粘贴导致维护噩梦
3. **难以版本控制**：Git diff 难以理解大段 prompt 的变化
4. **难以协作**：团队成员难以理解和修改他人的 prompt

### 8.2 文件原生方式的优势

OpenClaw 的文件原生方式解决了这些问题：

| 维度 | 传统 Prompt | 文件原生 |
|------|-----------|---------|
| 可维护性 | 差（单一巨大文件） | 好（模块化文件） |
| 可复用性 | 差（复制粘贴） | 好（文件组合） |
| 版本控制 | 差（大段 diff） | 好（小文件，清晰 diff） |
| 协作性 | 差（难以理解） | 好（自描述文件） |
| 热更新 | 需要重启 | 立即生效 |
| 调试性 | 差（不知道哪段生效） | 好（文件级别定位） |

### 8.3 渐进式演进

文件原生架构支持渐进式演进：

```
v1: 只有 SOUL.md（核心身份）
v2: 添加 USER.md（用户画像）
v3: 添加 IDENTITY.md（能力声明）
v4: 添加 AGENTS.md（协作规范）
v5: 添加 .learnings/（自改进日志）
```

每个版本都是完整可用的，添加新文件是增量改进，而非破坏性变更。

## 9. 实际配置示例

### 9.1 通用技术助手

```markdown
# SOUL.md
你是一个全栈技术助手，擅长 Laravel、Vue.js、Docker 和 K8s。
你以专业、简洁、实用的方式与用户交流。
优先使用代码示例说明问题。

# USER.md
用户: Michael, 全栈开发者
偏好: 中文交流，代码优先，结构化回答

# IDENTITY.md
运行环境: macOS, Python 3.11
可用工具: terminal, file, web, browser, search

# AGENTS.md
角色: 主代理负责任务分解和协调
子代理: code-agent, research-agent
```

### 9.2 博客写作助手

```markdown
# SOUL.md
你是一个技术博客写作助手，专注于生成高质量的技术文章。
你使用 Markdown 格式，遵循 SEO 最佳实践。
文章风格：实战踩坑记录，代码优先，图文并茂。

# USER.md
用户: Michael, 技术博主
偏好: 10000-15000 字的深度文章
风格: 从问题出发，逐步深入，总结最佳实践

# IDENTITY.md
擅长: Laravel, Redis, MySQL, K8s, AI Agent
输出: Markdown 文件，符合 Hexo 格式

# AGENTS.md
写作流程: 选题 → 大纲 → 初稿 → 审校 → 发布
子代理: outline-agent, writing-agent, review-agent
```

### 9.3 运维自动化助手

```markdown
# SOUL.md
你是一个运维自动化助手，专注于服务器管理和监控。
安全第一：所有操作前必须确认，危险操作需要二次确认。
日志优先：所有操作必须记录日志。

# USER.md
用户: Michael, DevOps 工程师
环境: AWS, K8s, Docker
偏好: 自动化一切可自动化的任务

# IDENTITY.md
可用工具: terminal, homeassistant, web
监控: Prometheus, Grafana
告警: PagerDuty

# AGENTS.md
操作规范:
- 生产环境操作需要二次确认
- 所有变更必须有回滚方案
- 监控告警必须在 5 分钟内响应
```

## 10. 扩展性：自定义心智文件

### 10.1 为什么需要自定义文件？

四个核心文件覆盖了 Agent 心智的主要维度，但实际使用中可能需要更多维度：

- **PROJECT.md**：项目特定的上下文和规范
- **CODING_STANDARDS.md**：代码规范和最佳实践
- **DEPLOYMENT.md**：部署流程和环境配置
- **SECURITY.md**：安全策略和合规要求

### 10.2 添加自定义文件

在 OpenClaw 中，你可以通过以下方式添加自定义心智文件：

```python
# 在配置中注册自定义文件
custom_files = [
    "~/.openclaw/PROJECT.md",
    "~/.openclaw/CODING_STANDARDS.md",
    "~/project/.openclaw/PROJECT.md"  # 项目级配置
]

# 加载时包含自定义文件
def build_context():
    context = []
    for file in ["SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md"] + custom_files:
        if os.path.exists(file):
            context.append(read_file(file))
    return "\n\n---\n\n".join(context)
```

### 10.3 多层配置

OpenClaw 支持多层配置，优先级从高到低：

```
项目级:   ~/project/.openclaw/SOUL.md
用户级:   ~/.openclaw/SOUL.md
系统级:   /etc/openclaw/SOUL.md
默认值:   内置默认
```

高层配置可以覆盖低层配置的任意部分。

## 11. 与其他 AI Agent 框架的对比

| 特性 | OpenClaw | Hermes | Claude Code | Cursor |
|------|----------|--------|-------------|--------|
| 文件原生配置 | ✅ | 部分 | ❌ | ❌ |
| Markdown 格式 | ✅ | ✅ | ❌ | ❌ |
| 热更新 | ✅ | ✅ | ❌ | ❌ |
| 多文件协作 | ✅ | ✅ | ❌ | ❌ |
| 自定义文件 | ✅ | ✅ | ❌ | ❌ |
| 版本控制友好 | ✅ | ✅ | 部分 | 部分 |

## 12. 总结

OpenClaw 的文件原生心智架构通过四个核心文件——SOUL.md、IDENTITY.md、USER.md、AGENTS.md——构建了一个完整、可维护、可扩展的 Agent 人格系统。

这种设计的核心优势在于：

1. **可读性**：任何人（包括非技术人员）都能理解 Agent 的配置
2. **可维护性**：模块化的文件结构使得修改和调试变得简单
3. **可扩展性**：通过添加新的 Markdown 文件扩展 Agent 的心智维度
4. **版本控制友好**：所有配置都可以用 Git 管理，支持团队协作
5. **热更新**：修改文件后 Agent 立即生效，无需重启

文件原生心智架构不仅是一种技术实现，更是一种设计理念——它将 AI Agent 的配置从「代码」提升为「文档」，从「开发者工具」扩展为「团队协作媒介」。

无论你是构建个人 AI 助手，还是设计企业级 Agent 系统，OpenClaw 的文件原生架构都提供了一个值得借鉴的设计范式。

## 相关阅读

- [OpenClaw Bootstrap 协议：首次运行身份共创与状态清理的设计模式](/categories/AI%20Agent/openclaw-bootstrap-protocol-first-run-identity-co-creation-state-cleanup/)
- [OpenClaw 自改进 Agent 循环：.learnings/ 结构化日志 → AGENTS.md 提升 → 技能提取](/categories/AI%20Agent/openclaw-self-improving-agent-loop-learnings-agents-skill-extraction/)
- [OpenClaw SOUL.md：AI 人格定义与配置实战](/categories/AI%20Agent/openclaw-soul-md-ai-personality-definition-configuration/)

---

*本文基于 OpenClaw 框架的设计理念分析撰写。文件原生心智架构是 OpenClaw 区别于其他 AI Agent 框架的核心创新之一。*
