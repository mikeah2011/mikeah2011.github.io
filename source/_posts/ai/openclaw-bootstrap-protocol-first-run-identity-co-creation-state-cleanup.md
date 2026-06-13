---

title: OpenClaw Bootstrap 协议：首次运行身份共创与状态清理的设计模式
keywords: [OpenClaw Bootstrap, 协议, 首次运行身份共创与状态清理的设计模式]
date: 2026-06-02 08:00:00
tags:
- OpenClaw
- AI Agent
- bootstrap
- 身份共创
- 设计模式
categories:
- ai
description: 全面解析 OpenClaw Bootstrap 协议的五阶段引导流程：检测、引导、共创、固化、验证。深入剖析身份共创的设计哲学——Agent 与用户协作定义人格而非预设模板，详解渐进式引导机制、模板系统语法与填充逻辑、三层状态清理（软/中/硬）的安全确认与备份回滚策略，对比预设人格与共创方案的优劣，附完整的对话式 Bootstrap 交互示例。
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
---



# OpenClaw Bootstrap 协议：首次运行身份共创与状态清理的设计模式

## 1. 引言：AI Agent 的「冷启动」问题

当你第一次启动一个 AI Agent 时，它面临一个根本性的问题：**它不知道自己是谁**。

传统的软件应用不需要「自我认知」——它们按照预设的逻辑执行，不需要理解自己的角色和目标。但 AI Agent 不同，它的行为很大程度上取决于它的「人格定义」——即 SOUL.md、IDENTITY.md 等心智文件中的内容。

问题在于：这些文件从哪里来？

**方案一：预设模板**。开发者预先写好一套默认的人格定义。这简单直接，但有两个致命缺陷：
- 预设的人格可能不符合用户的实际需求
- 用户没有参与感，不会对 Agent 产生「所有权感」

**方案二：完全空白**。让用户从零开始定义 Agent 的人格。这给了用户最大的自由度，但门槛太高——大多数用户不知道如何写出一个好的 SOUL.md。

**方案三：Bootstrap 协议**。这是 OpenClaw 选择的方案——通过一个精心设计的引导流程，让用户和 Agent 协作共创人格定义。

本文将深入剖析 OpenClaw Bootstrap 协议的设计理念、实现细节、以及相关的状态管理机制。

<!-- more -->

## 2. Bootstrap 协议的设计哲学

### 2.1 身份共创而非身份预设

Bootstrap 协议的核心理念是「身份共创」——Agent 的人格不是开发者预设的，也不是用户独自定义的，而是 Agent 和用户协作共创的。

这类似于人类社会中的「入职流程」：新员工不会拿到一份完全空白的工位，也不会拿到一份完全写好的工作手册。相反，他们通过与同事交流、参与项目、逐步了解公司文化，最终形成自己的工作方式。

### 2.2 渐进式引导而非一次性配置

传统软件的「首次运行向导」通常是线性的：第一步、第二步、第三步……完成。但 AI Agent 的人格定义是一个复杂的过程，不可能在一次向导中完成。

OpenClaw 采用渐进式引导：

```
首次运行: 基础身份定义（10 分钟）
  ↓
第一周: 行为准则调整（通过实际使用）
  ↓
第一个月: 技能和偏好完善（通过反馈循环）
  ↓
持续: 自改进和演进（通过 .learnings/）
```

### 2.3 设计原则

1. **低门槛**：用户不需要任何技术知识就能完成 Bootstrap
2. **高自由度**：Bootstrap 完成后，所有配置都可以自由修改
3. **渐进式**：不要求一次定义所有内容
4. **可逆性**：任何 Bootstrap 步骤都可以重做
5. **自描述**：Bootstrap 流程本身就是 Agent 行为的一部分

## 3. Bootstrap 流程的阶段划分

### 3.1 阶段总览

```
Phase 0: 检测 (Detection)
  → 是否需要 Bootstrap？

Phase 1: 引导 (Guidance)
  → 向用户介绍 Bootstrap 概念

Phase 2: 共创 (Co-creation)
  → Agent 和用户协作定义人格

Phase 3: 固化 (Solidification)
  → 将共创结果写入文件系统

Phase 4: 验证 (Verification)
  → 测试 Bootstrap 结果
```

### 3.2 Phase 0: 检测

Bootstrap 流程的第一步是检测是否需要执行：

```python
def needs_bootstrap() -> bool:
    """检测是否需要执行 Bootstrap"""
    config_dir = os.path.expanduser("~/.openclaw")
    
    # 检查关键文件是否存在
    required_files = ["SOUL.md", "IDENTITY.md", "USER.md"]
    for f in required_files:
        if not os.path.exists(os.path.join(config_dir, f)):
            return True
    
    # 检查文件是否是模板（未被用户修改）
    soul_content = read_file(os.path.join(config_dir, "SOUL.md"))
    if is_template(soul_content):
        return True
    
    # 检查 Bootstrap 是否被标记为完成
    bootstrap_state = read_bootstrap_state()
    if not bootstrap_state.get("completed", False):
        return True
    
    return False
```

### 3.3 Phase 1: 引导

如果检测到需要 Bootstrap，Agent 会启动引导流程：

```markdown
# 欢迎使用 OpenClaw！👋

我是你的 AI 助手，但我还不太了解自己。让我们一起定义「我是谁」吧！

这个过程大约需要 10 分钟。我们会一起完成以下内容：

1. **我的名字和角色** — 你想叫我什么？我主要帮你做什么？
2. **你的信息** — 你的技术背景和工作方式
3. **我们的沟通方式** — 你喜欢什么样的回答风格？

准备好了吗？让我们开始吧！
```

### 3.4 Phase 2: 共创

共创阶段是 Bootstrap 的核心。Agent 通过对话引导用户定义人格的各个维度：

#### 3.4.1 第一轮：核心身份

```
Agent: 首先，你想给我起个什么名字？或者你希望我用默认名称「OpenClaw」？

User: 就叫小助手吧。

Agent: 好的！接下来，你主要会用我做什么？
1. 编写和审查代码
2. 写文章和文档
3. 管理服务器和运维
4. 搜索和分析信息
5. 其他（请描述）

User: 主要是 1 和 2，偶尔 3。

Agent: 明白了！那我来总结一下我的核心身份：

> 我是「小助手」，主要帮助 Michael 编写代码、审查代码、写文章和文档，
> 偶尔协助服务器管理。

你觉得这样描述准确吗？需要调整吗？
```

#### 3.4.2 第二轮：沟通风格

```
Agent: 接下来，我们聊聊沟通方式。你喜欢我用什么样的风格和你交流？

1. 简洁直接 — 直奔主题，不废话
2. 详细解释 — 先讲原理，再给方案
3. 代码优先 — 先给代码，再解释
4. 混合模式 — 根据情况自动选择

User: 3，代码优先。

Agent: 好的！那我再确认几个细节：

- 语言偏好？中文、英文、还是混合？
User: 中文，技术术语保留英文原名。

- 回答长度？简短、中等、还是详细？
User: 中等，关键点要展开。

Agent: 明白了！我的沟通风格总结：

> 代码优先，中文交流（技术术语保留英文），回答中等长度，关键点展开说明。
```

#### 3.4.3 第三轮：技术栈

```
Agent: 最后，让我了解一下你的技术栈，这样我能更好地帮助你：

你主要使用哪些编程语言和框架？
User: Laravel, PHP, Vue.js, MySQL, Redis, Docker

你目前的工作环境？
User: macOS, AWS, K8s

你最近在学习什么？
User: AI Agent 架构, Rust

Agent: 收到！我已经对你的技术背景有了清晰的了解。
```

### 3.5 Phase 3: 固化

共创完成后，Agent 将所有信息固化到文件系统：

```python
def solidify_bootstrap(answers: dict):
    """将 Bootstrap 结果写入文件系统"""
    
    # 生成 SOUL.md
    soul_content = generate_soul_md(answers)
    write_file("~/.openclaw/SOUL.md", soul_content)
    
    # 生成 IDENTITY.md
    identity_content = generate_identity_md(answers)
    write_file("~/.openclaw/IDENTITY.md", identity_content)
    
    # 生成 USER.md
    user_content = generate_user_md(answers)
    write_file("~/.openclaw/USER.md", user_content)
    
    # 生成 AGENTS.md（使用默认模板）
    agents_content = generate_agents_md(answers)
    write_file("~/.openclaw/AGENTS.md", agents_content)
    
    # 创建 .learnings/ 目录
    os.makedirs("~/.openclaw/.learnings", exist_ok=True)
    
    # 标记 Bootstrap 完成
    write_bootstrap_state({"completed": True, "timestamp": datetime.now()})
```

生成的文件示例：

```markdown
# SOUL.md（自动生成）

## 核心身份
你是 Michael 的 AI 助手「小助手」。
你主要帮助 Michael 编写代码、审查代码、写文章和文档，偶尔协助服务器管理。

## 行为准则
1. 代码优先：先给代码，再解释
2. 准确性：不确定时明确说明，不编造
3. 实用性：给可执行的方案，不空谈
4. 安全性：危险操作前确认

## 沟通风格
- 使用中文交流，技术术语保留英文
- 回答中等长度，关键点展开
- 代码示例优先于文字描述
- 结构化呈现：先总结，再展开
```

### 3.6 Phase 4: 验证

Bootstrap 完成后，Agent 会进行验证测试：

```
Agent: Bootstrap 完成！让我们做一个快速测试：

请给我一个小任务，让我展示一下我的能力。

比如：
- "帮我写一个 Laravel API 接口"
- "审查一下这段代码"
- "帮我写一篇技术文章的开头"

你想测试哪个？
```

## 4. Bootstrap 模板系统

### 4.1 模板的组织结构

```
~/.openclaw/templates/
├── default/
│   ├── SOUL.md.template
│   ├── IDENTITY.md.template
│   ├── USER.md.template
│   └── AGENTS.md.template
├── developer/
│   ├── SOUL.md.template
│   └── ...
├── writer/
│   ├── SOUL.md.template
│   └── ...
└── ops/
    ├── SOUL.md.template
    └── ...
```

### 4.2 模板语法

模板使用简单的占位符语法：

```markdown
# SOUL.md.template

## 核心身份
你是 {{user_name}} 的 AI 助手「{{agent_name}}」。
你主要帮助 {{user_name}} {{primary_tasks}}。

## 行为准则
{{#each principles}}
{{@index}}. {{this}}
{{/each}}

## 沟通风格
- 使用 {{language}} 交流
- 回答风格: {{communication_style}}
- 详细程度: {{detail_level}}
```

### 4.3 模板填充

```python
def fill_template(template_path: str, variables: dict) -> str:
    """使用变量填充模板"""
    template = read_file(template_path)
    
    # 简单占位符替换
    for key, value in variables.items():
        template = template.replace(f"{{{{{key}}}}}", str(value))
    
    # 处理条件块
    template = process_conditionals(template, variables)
    
    # 处理循环块
    template = process_loops(template, variables)
    
    return template
```

## 5. 状态清理设计

### 5.1 为什么需要状态清理？

在以下场景中，需要清理 Agent 的状态：

1. **重新开始**：用户想要完全重置 Agent 的人格
2. **Profile 切换**：切换到一个全新的 Profile
3. **错误恢复**：Bootstrap 过程出错，需要重来
4. **隐私需求**：清除所有存储的信息

### 5.2 状态清理的层次

OpenClaw 支持多个层次的状态清理：

```python
class StateCleanup:
    """Agent 状态清理"""
    
    def soft_cleanup(self):
        """软清理：清除运行时状态，保留文件"""
        # 清除对话历史
        self.clear_conversation_history()
        
        # 清除临时记忆
        self.clear_temporary_memories()
        
        # 保留: SOUL.md, IDENTITY.md, USER.md, AGENTS.md, .learnings/
    
    def medium_cleanup(self):
        """中等清理：清除记忆，保留配置"""
        self.soft_cleanup()
        
        # 清除记忆文件
        self.clear_memories()
        
        # 清除 .learnings/
        self.clear_learnings()
        
        # 保留: SOUL.md, IDENTITY.md, USER.md, AGENTS.md
    
    def hard_cleanup(self):
        """硬清理：完全重置"""
        self.medium_cleanup()
        
        # 清除所有配置文件
        self.clear_config_files()
        
        # 清除 skills/
        self.clear_skills()
        
        # 清除 plugins/
        self.clear_plugins()
        
        # 清除 cron/
        self.clear_cron_tasks()
        
        # 重置 Bootstrap 状态
        self.reset_bootstrap_state()
```

### 5.3 安全的状态清理

状态清理需要特别注意安全性：

1. **确认机制**：清理前必须确认，硬清理需要二次确认
2. **备份机制**：清理前自动备份当前状态
3. **回滚机制**：支持从备份恢复

```python
def safe_cleanup(level: str, confirm: bool = False):
    """安全的状态清理"""
    
    # 硬清理需要二次确认
    if level == "hard" and not confirm:
        raise CleanupRequiresConfirmation(
            "硬清理将删除所有数据，请设置 confirm=True 确认"
        )
    
    # 创建备份
    backup_path = create_backup()
    print(f"备份已创建: {backup_path}")
    
    try:
        # 执行清理
        cleanup = StateCleanup()
        getattr(cleanup, f"{level}_cleanup")()
        print(f"{level} 清理完成")
    except Exception as e:
        # 清理失败，从备份恢复
        restore_from_backup(backup_path)
        print(f"清理失败，已从备份恢复: {e}")
```

### 5.4 清理确认对话

在交互模式下，清理操作通过对话确认：

```
Agent: 你想要清理什么？

1. 🔄 软清理 — 清除对话历史和临时数据
2. 🧹 中等清理 — 清除记忆和学习记录
3. ⚠️ 硬清理 — 完全重置，回到初始状态
4. ❌ 取消

请选择 [1-4]:

User: 3

Agent: ⚠️ 警告：硬清理将删除所有配置、记忆、技能和学习记录。

这个操作不可逆（虽然会创建备份）。

你确定要继续吗？[yes/no]:

User: yes

Agent: 正在创建备份...
备份已创建: ~/.openclaw/backups/2026-06-02-15-30-00.tar.gz

正在清理...
✅ 清理完成！

所有状态已重置。要重新运行 Bootstrap 吗？[yes/no]:
```

## 6. Bootstrap 与预设人格的对比

### 6.1 预设人格的优势

| 维度 | 预设人格 | Bootstrap 共创 |
|------|---------|---------------|
| 上手速度 | 快（即开即用） | 慢（需要引导） |
| 一致性 | 高（统一标准） | 低（因人而异） |
| 个性化 | 低 | 高 |
| 用户参与感 | 低 | 高 |
| 维护成本 | 低 | 中 |

### 6.2 共创的优势

1. **用户所有权感**：用户参与了 Agent 的「诞生」，会更珍惜和维护
2. **更好的适配**：共创的人格更符合用户的实际需求
3. **自然的学习曲线**：通过对话了解 Agent，比阅读文档更直观
4. **持续演进的基础**：共创建立了用户与 Agent 的对话习惯，为后续的自改进打下基础

### 6.3 混合方案

OpenClaw 采用混合方案：提供预设模板作为起点，通过 Bootstrap 引导用户定制：

```
预设模板（开发者定义）
  ↓ Bootstrap 共创
用户定制（个性化调整）
  ↓ 日常使用
自改进（.learnings/ 积累）
```

## 7. 状态持久化与版本管理

### 7.1 状态文件结构

```
~/.openclaw/
├── .state/
│   ├── bootstrap.json    # Bootstrap 状态
│   ├── version.json      # 版本信息
│   └── history/          # 状态历史
│       ├── 2026-06-01.json
│       └── 2026-06-02.json
├── SOUL.md
├── IDENTITY.md
├── USER.md
├── AGENTS.md
├── .learnings/
├── skills/
├── plugins/
└── cron/
```

### 7.2 Bootstrap 状态

```json
{
  "completed": true,
  "timestamp": "2026-06-01T10:30:00Z",
  "version": "1.0.0",
  "phases_completed": ["detection", "guidance", "co-creation", "solidification", "verification"],
  "template_used": "developer",
  "customizations": {
    "agent_name": "小助手",
    "language": "zh-CN",
    "communication_style": "code-first"
  }
}
```

### 7.3 版本管理

每次修改心智文件时，都会记录版本：

```python
def update_soul_md(new_content: str):
    """更新 SOUL.md 并记录版本"""
    # 读取当前版本
    current = read_file("~/.openclaw/SOUL.md")
    
    # 计算 diff
    diff = compute_diff(current, new_content)
    
    # 记录历史
    history_entry = {
        "timestamp": datetime.now().isoformat(),
        "file": "SOUL.md",
        "diff": diff,
        "reason": "用户手动修改"
    }
    append_to_history(history_entry)
    
    # 写入新内容
    write_file("~/.openclaw/SOUL.md", new_content)
```

### 7.4 回滚机制

如果用户对修改不满意，可以回滚到任意历史版本：

```python
def rollback_soul_md(target_timestamp: str):
    """回滚 SOUL.md 到指定时间点"""
    # 找到目标版本
    history = read_history()
    target = find_by_timestamp(history, target_timestamp)
    
    if not target:
        raise RollbackError(f"找不到时间戳 {target_timestamp} 的版本")
    
    # 重建目标版本
    content = reconstruct_version(history, target)
    
    # 写入
    write_file("~/.openclaw/SOUL.md", content)
    
    print(f"已回滚到 {target_timestamp} 版本")
```

## 8. 实际 Bootstrap 流程演示

### 8.1 完整流程示例

```
=== OpenClaw Bootstrap v1.0 ===

🔍 检测: 首次运行，需要 Bootstrap。

👋 欢迎使用 OpenClaw！

我是你的 AI 助手，目前还没有自己的「身份」。
让我们一起花 10 分钟，定义「我是谁」。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 第 1 步：基础信息

Q1: 你想叫我什么？（直接回车使用默认名「OpenClaw」）
> 小助手

Q2: 你的名字是？
> Michael

Q3: 你的主要身份是？
  1. 软件开发者
  2. 产品经理
  3. 设计师
  4. 学生
  5. 其他
> 1

Q4: 你主要使用哪些技术？（逗号分隔）
> Laravel, PHP, Vue.js, MySQL, Redis, Docker, K8s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💬 第 2 步：沟通方式

Q5: 你喜欢的回答风格？
  1. 简洁直接
  2. 详细解释
  3. 代码优先
  4. 混合模式
> 3

Q6: 回答语言？
  1. 中文
  2. 英文
  3. 中英混合
> 1

Q7: 技术术语保留英文原名吗？[Y/n]
> Y

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 第 3 步：工作方式

Q8: 你希望我如何处理不确定的问题？
  1. 诚实说不知道
  2. 尝试猜测并说明
  3. 搜索后回答
> 1

Q9: 危险操作（如删除文件）前，你希望我？
  1. 始终确认
  2. 仅生产环境确认
  3. 直接执行
> 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Bootstrap 完成！

我来总结一下我的身份：

┌─────────────────────────────────────┐
│ 我是「小助手」                      │
│ Michael 的 AI 开发助手              │
│                                     │
│ 🎯 擅长: Laravel, PHP, Vue.js,     │
│         MySQL, Redis, Docker, K8s   │
│                                     │
│ 💬 风格: 代码优先，中文交流         │
│         技术术语保留英文            │
│                                     │
│ ⚠️ 安全: 危险操作前始终确认         │
│         不确定时诚实说明            │
└─────────────────────────────────────┘

正在创建配置文件...
✅ SOUL.md 已创建
✅ IDENTITY.md 已创建
✅ USER.md 已创建
✅ AGENTS.md 已创建
✅ .learnings/ 目录已创建

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🧪 快速测试

给我一个小任务试试？

> 帮我写一个 Laravel API 接口的基本结构

[Agent 执行测试任务...]

看起来一切正常！🎉

Bootstrap 完成。你可以随时编辑 ~/.openclaw/ 下的文件来调整我的行为。

现在，有什么我可以帮你的？
```

## 9. 设计模式总结

### 9.1 Bootstrap 模式的核心要素

1. **检测机制**：判断是否需要 Bootstrap
2. **引导流程**：分步引导用户完成配置
3. **共创对话**：Agent 和用户协作定义人格
4. **固化机制**：将对话结果持久化
5. **验证环节**：测试 Bootstrap 结果
6. **状态管理**：跟踪 Bootstrap 进度
7. **清理支持**：允许重置和重来

### 9.2 可复用的 Agent 初始化框架

OpenClaw 的 Bootstrap 协议可以被其他 AI Agent 框架复用：

```python
class AgentBootstrap:
    """可复用的 Agent Bootstrap 框架"""
    
    def __init__(self, config_dir: str, templates: dict):
        self.config_dir = config_dir
        self.templates = templates
        self.state_file = os.path.join(config_dir, ".state", "bootstrap.json")
    
    def needs_bootstrap(self) -> bool:
        """检测是否需要 Bootstrap"""
        raise NotImplementedError
    
    def guide(self) -> str:
        """生成引导消息"""
        raise NotImplementedError
    
    def co_create(self, answers: dict) -> dict:
        """处理共创对话的回答"""
        raise NotImplementedError
    
    def solidify(self, profile: dict):
        """将共创结果固化到文件系统"""
        for filename, content in profile.items():
            filepath = os.path.join(self.config_dir, filename)
            write_file(filepath, content)
        
        self.mark_completed()
    
    def verify(self) -> bool:
        """验证 Bootstrap 结果"""
        raise NotImplementedError
    
    def cleanup(self, level: str):
        """清理状态"""
        raise NotImplementedError
    
    def run(self):
        """执行完整的 Bootstrap 流程"""
        if not self.needs_bootstrap():
            return
        
        print(self.guide())
        
        answers = self.collect_answers()
        profile = self.co_create(answers)
        self.solidify(profile)
        
        if self.verify():
            print("Bootstrap 完成！")
        else:
            print("Bootstrap 验证失败，请重试。")
```

### 9.3 反模式

1. **强制 Bootstrap**：不要强制用户完成 Bootstrap，允许跳过使用默认配置
2. **过于冗长**：Bootstrap 应该简洁，10 分钟内完成
3. **不可逆**：所有 Bootstrap 结果都应该可以修改
4. **缺乏备份**：清理前必须创建备份
5. **忽略错误**：Bootstrap 失败时应该优雅降级，而非崩溃

## 10. 未来展望

### 10.1 智能 Bootstrap

未来的 Bootstrap 可以更加智能：

1. **从历史数据推断**：分析用户的 Git 历史、文档风格等，自动推断偏好
2. **从对话学习**：在正式 Bootstrap 前，通过几轮闲聊了解用户
3. **社区模板**：从社区获取经过验证的人格模板
4. **A/B 测试**：测试不同人格定义的效果

### 10.2 多 Agent Bootstrap

在多 Agent 系统中，Bootstrap 需要协调多个 Agent 的身份：

```
主 Agent Bootstrap
  → 定义整体人格
  → 子 Agent Bootstrap
    → 定义各子 Agent 的角色和能力
    → 定义协作协议
```

### 10.3 持续 Bootstrap

Bootstrap 不应该是一次性的，而应该是一个持续的过程：

```
初始 Bootstrap: 核心身份
  ↓
使用一周后: 行为准则调整
  ↓
使用一月后: 技能和偏好完善
  ↓
持续: 自改进和演进
```

## 11. 总结

OpenClaw 的 Bootstrap 协议通过以下核心机制解决了 AI Agent 的「冷启动」问题：

1. **身份共创**：Agent 和用户协作定义人格，而非预设或空白
2. **渐进式引导**：分步引导，降低用户门槛
3. **状态管理**：完整的 Bootstrap 状态跟踪和版本管理
4. **安全清理**：多层次的状态清理，支持备份和回滚
5. **可复用框架**：Bootstrap 协议可以被其他框架复用

这种设计不仅解决了技术问题，还建立了一种用户与 Agent 之间的「对话习惯」——从第一次交互开始，用户就知道如何与 Agent 协作，这为后续的自改进和持续演进打下了坚实的基础。

Bootstrap 协议是 OpenClaw 最具人文关怀的设计之一。它体现了这样一个理念：**AI Agent 不应该是一个冰冷的工具，而应该是一个有温度的助手**。而有温度的助手，需要一个温暖的「诞生」过程。

## 相关阅读

- [OpenClaw 文件原生心智架构：SOUL.md/IDENTITY.md/USER.md/AGENTS.md 的协作机制](/categories/AI%20Agent/openclaw-file-native-mental-architecture-soul-identity-user-agents/)
- [OpenClaw 自改进 Agent 循环：.learnings/ 结构化日志 → AGENTS.md 提升 → 技能提取](/categories/AI%20Agent/openclaw-self-improving-agent-loop-learnings-agents-skill-extraction/)
- [OpenClaw SOUL.md：AI 人格定义与配置实战](/categories/AI%20Agent/openclaw-soul-md-ai-personality-definition-configuration/)

---

*本文基于 OpenClaw 框架的 Bootstrap 协议设计分析撰写。Bootstrap 协议是 OpenClaw 用户体验设计的核心组成部分。*
