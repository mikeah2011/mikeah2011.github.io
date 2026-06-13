---

title: 三大框架安全模型对比：工具隔离、记忆分区、隐私边界、数据主权
date: 2026-06-02 10:00:00
tags:
- AI Agent
- Hermes
- OpenClaw
- OpenHuman
- 安全模型
- 隐私
- 数据主权
categories:
  - architecture
keywords: [三大框架安全模型对比, 工具隔离, 记忆分区, 隐私边界, 数据主权]
description: 从工具隔离、记忆分区、隐私边界、数据主权四个维度深入对比 Hermes Agent、OpenClaw、OpenHuman 三大 AI Agent 框架的安全模型设计，涵盖 PluginContext 权限控制、Workspace 沙箱、OS Keychain 密钥管理、Prompt Injection 防护等实战安全机制，提供个人开发者到企业级的选型建议。
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---



# 三大框架安全模型对比：工具隔离、记忆分区、隐私边界、数据主权

## 引言

当 AI Agent 从「聊天机器人」进化为「自主行动者」，安全问题就不再是可选项，而是必选项。一个能够读写文件、调用 API、执行代码、访问数据库的 Agent，本质上就是一个拥有特权的系统进程。如果安全模型设计不当，后果可能比一个普通的安全漏洞更严重——因为 Agent 拥有「理解意图」的能力，攻击者可以通过精心构造的 Prompt 让 Agent 执行恶意操作。

2025-2026 年间，多个 AI Agent 框架的安全事件引起了业界关注：Prompt Injection 导致 Agent 泄露 API 密钥、工具调用链被劫持执行未授权操作、记忆系统被注入虚假信息影响后续决策。这些事件推动了 Agent 安全模型的快速发展。

本文将从**工具隔离**、**记忆分区**、**隐私边界**、**数据主权**四个维度，深入对比 Hermes Agent、OpenClaw 和 OpenHuman 的安全模型设计。

## 二、安全模型的四个维度

### 2.1 工具隔离（Tool Isolation）

工具隔离是指 Agent 调用外部工具时的安全防护机制。核心问题包括：
- Agent 能否只调用被授权的工具？
- 工具的执行环境是否与 Agent 的主环境隔离？
- 工具调用的结果是否经过安全审查？
- 恶意 Prompt 能否通过工具调用链执行未授权操作？

### 2.2 记忆分区（Memory Partitioning）

记忆分区是指 Agent 的记忆存储的隔离机制。核心问题包括：
- 不同会话的记忆是否隔离？
- 不同项目的记忆是否分区？
- 记忆的写入是否需要验证？
- 记忆的读取是否受权限控制？

### 2.3 隐私边界（Privacy Boundary）

隐私边界是指 Agent 处理敏感信息时的保护机制。核心问题包括：
- Agent 的对话内容是否会泄露给第三方？
- Agent 的记忆是否会跨会话泄露隐私？
- 多用户场景下如何保证隐私隔离？
- Agent 的日志是否包含敏感信息？

### 2.4 数据主权（Data Sovereignty）

数据主权是指用户对其数据的控制权。核心问题包括：
- 数据存储在哪里？本地还是云端？
- 数据是否经过加密？密钥由谁管理？
- 用户能否完全删除自己的数据？
- 数据是否会被用于模型训练？

## 三、Hermes Agent 的安全模型

### 3.1 工具隔离：PluginContext 权限控制

Hermes 的工具隔离基于 **PluginContext** 机制。每个 Plugin 和 Skill 在注册时声明自己需要的权限，框架在运行时进行权限检查。

```yaml
# Hermes 的权限声明
plugins:
  - name: file-manager
    permissions:
      - file:read:/Users/michael/projects/**
      - file:write:/Users/michael/projects/**
      - terminal:execute:git
    denied:
      - terminal:execute:rm
      - terminal:execute:sudo
```

**关键安全机制：**

1. **权限最小化原则**：Plugin 只能访问声明的权限范围。未声明的权限默认拒绝。

2. **子代理工具屏蔽**：Hermes 的子代理（subagent）架构中，leaf 角色的子代理被屏蔽了 `delegate_task`、`clarify`、`memory`、`send_message`、`execute_code` 等高危工具。这防止了子代理的逃逸行为。

3. **审批策略**：某些高危操作（如文件删除、网络请求）需要用户显式审批。框架提供了可配置的审批策略：

```yaml
# Hermes 的审批策略
approval:
  always:
    - terminal:execute:rm
    - terminal:execute:sudo
    - web:fetch:*
  never:
    - file:read:**
    - terminal:execute:ls
  ask_once:
    - terminal:execute:git
```

4. **沙箱执行**：对于不受信任的 Plugin，Hermes 支持在沙箱环境中执行，限制其系统调用范围。

### 3.2 记忆分区：会话级隔离

Hermes 的记忆系统采用**会话级隔离**设计：

- 每个会话有独立的记忆空间，会话之间不共享记忆
- 记忆的写入需要通过框架的记忆 API，不接受直接写入
- 记忆的读取受会话权限控制，跨会话读取需要显式授权

```python
# Hermes 的记忆访问控制
class MemoryManager:
    def write(self, session_id, key, value):
        if not self.check_permission(session_id, "memory:write"):
            raise PermissionError(f"Session {session_id} lacks memory:write permission")
        self.store.write(session_id, key, value)
    
    def read(self, session_id, key):
        if not self.check_permission(session_id, "memory:read"):
            raise PermissionError(f"Session {session_id} lacks memory:read permission")
        return self.store.read(session_id, key)
```

### 3.3 隐私边界：本地优先 + 可选云端

Hermes 的隐私边界设计遵循**本地优先**原则：

- 所有配置和记忆默认存储在用户本地设备
- 云端功能（如 Skills Hub）是可选的，需要显式启用
- 上传到云端的内容经过用户确认

**Prompt Injection 防护：**

Hermes 内置了 Prompt Injection 检测机制，特别是在 MCP（Model Context Protocol）集成中：

```python
# Hermes 的 Prompt Injection 检测
class MCPIntegration:
    def process_tool_result(self, result):
        if self.detect_prompt_injection(result):
            self.log_security_event("prompt_injection_detected", result)
            return self.sanitize_result(result)
        return result
    
    def detect_prompt_injection(self, text):
        patterns = [
            r"ignore previous instructions",
            r"system:\s*you are now",
            r"<\|im_start\|>",
            r"forget everything",
        ]
        return any(re.search(p, text, re.IGNORECASE) for p in patterns)
```

### 3.4 数据主权：用户完全控制

Hermes 的数据主权设计确保用户对数据的完全控制：

- 所有数据存储在 `~/.hermes/` 目录下
- 用户可以随时删除整个目录，完全清除所有数据
- Lock file 记录了所有扩展的来源和版本，支持审计
- 框架不收集任何用户遥测数据

### 3.5 安全模型评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 工具隔离 | ★★★★☆ | PluginContext 权限控制 + 子代理屏蔽 |
| 记忆分区 | ★★★☆☆ | 会话级隔离，但缺乏更细粒度的控制 |
| 隐私边界 | ★★★★☆ | 本地优先 + Prompt Injection 检测 |
| 数据主权 | ★★★★★ | 完全本地存储，用户完全控制 |

## 四、OpenClaw 的安全模型

### 4.1 工具隔离：文件权限 + 执行限制

OpenClaw 的工具隔离设计与其文件原生哲学一致——**依赖操作系统的文件权限机制**。

```bash
# OpenClaw 的文件权限控制
.openclaw/
├── IDENTITY.md          # 权限：600（仅所有者可读写）
├── MEMORY.md            # 权限：600
├── MODEL_STRATEGY.md    # 权限：644（所有者可读写，其他人可读）
├── daily-notes/         # 权限：700（仅所有者可访问）
└── skills/              # 权限：755（所有人可执行）
```

**关键安全机制：**

1. **操作系统级文件权限**：OpenClaw 直接利用 Unix 文件权限系统，不需要额外的权限管理层。

2. **技能文件的白名单机制**：只有在 `skills/` 目录下的文件才会被识别为技能，避免了意外加载恶意文件。

3. **执行限制**：OpenClaw 的技能文件是声明式的（Markdown），不包含可执行代码。这从根本上消除了代码注入的风险。

### 4.2 记忆分区：文件级隔离

OpenClaw 的记忆分区基于文件系统：

- **IDENTITY.md**：Agent 身份，所有会话共享
- **MEMORY.md**：长期记忆，所有会话共享
- **daily-notes/**：日常记忆，按日期隔离
- **群聊上下文**：与主会话 MEMORY.md 隔离

**隐私感知记忆分区：**

OpenClaw 的一个独特设计是**隐私感知的记忆分区**。当 Agent 在群聊场景中工作时，群聊上下文与主会话的记忆是隔离的。这防止了群聊中的敏感信息泄露到主会话中。

```markdown
# OpenClaw 的隐私感知记忆分区

## 主会话记忆（MEMORY.md）
- 用户的个人偏好
- 项目上下文
- 历史决策记录

## 群聊上下文（独立存储）
- 群聊的对话历史
- 群聊特定的知识
- 不与主会话记忆混合
```

### 4.3 隐私边界：纯本地 + 文本透明

OpenClaw 的隐私边界设计最为透明：

- **纯本地存储**：所有文件都在本地 `.openclaw/` 目录下
- **文本可审查**：所有文件都是人类可读的 Markdown，用户可以随时审查
- **无网络依赖**：核心功能不依赖网络服务

**文档漂移的安全风险：**

OpenClaw 的一个安全隐患是**文档漂移**问题。IDENTITY.md、MEMORY.md、MODEL_STRATEGY.md 之间的不一致可能导致 Agent 行为异常。例如，如果 IDENTITY.md 声明「你不应该执行代码」，但 MODEL_STRATEGY.md 允许使用代码执行模型，Agent 可能违反安全策略。

OpenClaw 正在通过自动一致性检查机制解决这个问题：

```python
# OpenClaw 的一致性检查
def check_consistency():
    identity = parse_identity("IDENTITY.md")
    strategy = parse_strategy("MODEL_STRATEGY.md")
    
    conflicts = []
    if identity.forbids_code_execution and strategy.allows_code_model:
        conflicts.append("IDENTITY 禁止代码执行但 MODEL_STRATEGY 允许代码模型")
    
    return conflicts
```

### 4.4 数据主权：完全用户控制

OpenClaw 的数据主权设计是最强的：

- 所有数据都是普通文件，存储在用户本地
- 用户可以用任何文本编辑器查看和修改
- 用户可以随时删除 `.openclaw/` 目录
- 没有任何云端组件，不存在数据泄露风险
- 文件版本控制通过 Git 实现，完全在用户掌控中

### 4.5 安全模型评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 工具隔离 | ★★★☆☆ | 依赖 OS 文件权限，缺乏细粒度控制 |
| 记忆分区 | ★★★★☆ | 文件级隔离 + 隐私感知分区 |
| 隐私边界 | ★★★★★ | 纯本地 + 文本可审查 |
| 数据主权 | ★★★★★ | 完全用户控制，无云端依赖 |

## 五、OpenHuman 的安全模型

### 5.1 工具隔离：Workspace 沙箱

OpenHuman 的工具隔离基于 **Workspace 沙箱** 机制。每个项目（workspace）有独立的沙箱环境，工具只能在沙箱范围内操作。

```
Workspace 沙箱结构：
~/.openhuman/
├── workspaces/
│   ├── project-a/
│   │   ├── sandbox/          # 沙箱根目录
│   │   │   ├── code/         # 代码目录
│   │   │   ├── data/         # 数据目录
│   │   │   └── config/       # 配置目录
│   │   ├── memory-tree.db    # Memory Tree 数据库
│   │   └── sandbox-policy.yaml  # 沙箱策略
│   └── project-b/
│       ├── sandbox/
│       ├── memory-tree.db
│       └── sandbox-policy.yaml
└── global/
    ├── keychain/             # 密钥存储
    └── oauth-tokens/         # OAuth Token
```

**关键安全机制：**

1. **Workspace 隔离**：不同项目的工具和数据完全隔离。Project-A 的工具无法访问 Project-B 的文件。

2. **沙箱策略配置**：每个 workspace 有独立的沙箱策略，定义允许的文件访问范围、网络访问权限、系统调用白名单。

```yaml
# OpenHuman 的沙箱策略
sandbox:
  filesystem:
    read:
      - ./sandbox/**
      - ~/.openhuman/global/**
    write:
      - ./sandbox/**
    deny:
      - ~/.ssh/**
      - ~/.aws/**
  network:
    allow:
      - api.openai.com
      - api.anthropic.com
    deny:
      - **
  system:
    allow:
      - git
      - python3
    deny:
      - sudo
      - rm -rf
```

3. **OAuth Token 代理**：OpenHuman 的 OAuth Token 不直接暴露给工具。工具通过框架的 Token 代理服务访问第三方 API，代理服务负责 Token 的安全管理和权限控制。

### 5.2 记忆分区：Memory Tree 级隔离

OpenHuman 的记忆分区基于 Memory Tree 的设计：

- **每个 Workspace 独立的 Memory Tree**：不同项目的记忆存储在不同的 SQLite 数据库中
- **叶子级别的访问控制**：每个叶子（leaf）有独立的访问标记
- **实体级别的隔离**：敏感实体可以标记为「私有」，不会被跨会话检索

```python
# OpenHuman 的 Memory Tree 访问控制
class MemoryTree:
    def query(self, workspace_id, query, session_id):
        # 检查 workspace 权限
        if not self.check_workspace_access(session_id, workspace_id):
            raise PermissionError("No access to workspace")
        
        # 执行查询，过滤私有实体
        results = self.sqlite_query(workspace_id, query)
        return [r for r in results if not r.is_private or r.owner == session_id]
```

### 5.3 隐私边界：本地加密 + OS Keychain

OpenHuman 的隐私边界设计是三个框架中最完善的：

1. **本地加密**：Memory Tree 的 SQLite 数据库支持 AES-256 加密。加密密钥存储在操作系统的 Keychain（macOS Keychain、Linux Secret Service）中。

```python
# OpenHuman 的本地加密
class EncryptedMemoryTree:
    def __init__(self, workspace_id):
        self.key = keychain.get(f"openhuman-{workspace_id}")
        self.db = sqlite3.connect(f"{workspace_id}/memory-tree.db")
        self.db.execute(f"PRAGMA key = '{self.key}'")  # SQLCipher 加密
```

2. **OS Keychain 集成**：敏感信息（API 密钥、OAuth Token、加密密钥）存储在操作系统的 Keychain 中，而不是文件系统。这利用了操作系统级别的安全保护。

3. **数据不离开本机**：OpenHuman 的核心架构是 Local-First，所有数据处理在本地完成。只有 LLM API 调用需要发送数据到云端，且发送的内容经过框架的安全审查。

4. **自动数据清理**：OpenHuman 支持配置自动清理策略，定期删除过期的记忆和日志。

### 5.4 数据主权：最强保障

OpenHuman 的数据主权设计在三个框架中是最强的：

- **本地 SQLite 存储**：所有数据以 SQLite 数据库形式存储在本地
- **用户持有加密密钥**：加密密钥存储在用户的 OS Keychain 中，框架本身不持有密钥
- **完整的数据导出**：用户可以随时导出整个 Memory Tree 为标准格式
- **安全删除**：删除操作使用安全擦除（多次覆写），确保数据不可恢复
- **无遥测**：框架不收集任何用户数据

### 5.5 安全模型评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 工具隔离 | ★★★★★ | Workspace 沙箱 + 策略配置 + OAuth 代理 |
| 记忆分区 | ★★★★★ | Memory Tree 级隔离 + 叶子级访问控制 |
| 隐私边界 | ★★★★★ | 本地加密 + OS Keychain + Local-First |
| 数据主权 | ★★★★★ | 用户持有密钥 + 安全删除 + 无遥测 |

## 六、四维对比总结

### 6.1 工具隔离对比

| 维度 | Hermes | OpenClaw | OpenHuman |
|------|--------|----------|-----------|
| 隔离机制 | PluginContext 权限 | OS 文件权限 | Workspace 沙箱 |
| 粒度 | 工具级 | 文件级 | Workspace 级 |
| 高危操作审批 | 支持 | 不支持 | 支持 |
| 子代理屏蔽 | 支持（leaf 角色） | 不适用 | 支持 |
| Prompt Injection 检测 | 支持 | 不支持 | 支持 |
| 沙箱执行 | 支持 | 不支持 | 支持 |

### 6.2 记忆分区对比

| 维度 | Hermes | OpenClaw | OpenHuman |
|------|--------|----------|-----------|
| 隔离粒度 | 会话级 | 文件级 | Workspace + 叶子级 |
| 写入控制 | API 权限检查 | 文件权限 | 叶子级访问标记 |
| 读取控制 | 会话权限 | 文件权限 | 实体级过滤 |
| 跨会话隔离 | 强 | 中（IDENTITY.md 共享） | 强 |
| 群聊隔离 | 会话级 | 支持（独立上下文） | Workspace 级 |

### 6.3 隐私边界对比

| 维度 | Hermes | OpenClaw | OpenHuman |
|------|--------|----------|-----------|
| 数据存储 | 本地 | 本地 | 本地加密 |
| 密钥管理 | 配置文件 | 配置文件 | OS Keychain |
| 网络传输 | LLM API 调用 | LLM API 调用 | LLM API 调用 |
| 遥测收集 | 无 | 无 | 无 |
| 数据审查 | 文件可查看 | 文件可查看 | 需要解密 |
| 日志安全 | 本地文件 | 本地文件 | 加密存储 |

### 6.4 数据主权对比

| 维度 | Hermes | OpenClaw | OpenHuman |
|------|--------|----------|-----------|
| 存储位置 | `~/.hermes/` | `.openclaw/` | `~/.openhuman/` |
| 加密方式 | 无（明文配置） | 无（明文文件） | AES-256 + SQLCipher |
| 密钥持有 | N/A | N/A | 用户（OS Keychain） |
| 数据导出 | 配置文件导出 | 文件复制 | Memory Tree 导出 |
| 安全删除 | 文件删除 | 文件删除 | 安全擦除 |
| 审计能力 | Lock file | Git 历史 | 完整审计日志 |

## 七、安全威胁场景分析

### 7.1 场景 1：Prompt Injection 攻击

**攻击方式**：攻击者在外部内容（网页、文件、API 响应）中嵌入恶意指令，诱导 Agent 执行未授权操作。

**Hermes 防御**：
- MCP 集成中内置 Prompt Injection 检测
- 工具调用结果经过安全审查
- 高危操作需要用户审批

**OpenClaw 防御**：
- 技能文件是声明式 Markdown，不包含可执行代码
- 但缺乏自动的 Prompt Injection 检测
- 依赖用户审查文件内容

**OpenHuman 防御**：
- Workspace 沙箱限制了工具的执行范围
- OAuth Token 代理防止 Token 泄露
- 敏感实体的访问控制防止数据泄露

### 7.2 场景 2：记忆投毒攻击

**攻击方式**：攻击者通过某种方式向 Agent 的记忆系统注入虚假信息，影响后续决策。

**Hermes 防御**：
- 记忆写入需要 API 权限检查
- 会话级隔离防止跨会话污染
- 但缺乏记忆内容的真实性验证

**OpenClaw 防御**：
- MEMORY.md 是纯文本，用户可以随时审查
- 但缺乏自动的一致性检查
- 文档漂移可能导致记忆不一致

**OpenHuman 防御**：
- 叶子级的访问控制限制了写入来源
- 实体提取的确定性算法减少了注入空间
- 但 NLP 模型的错误提取仍可能导致问题

### 7.3 场景 3：数据泄露攻击

**攻击方式**：Agent 的敏感数据（API 密钥、用户信息、业务数据）被泄露给未授权方。

**Hermes 防御**：
- 本地存储，不上传云端（除非用户启用 Skills Hub）
- 配置文件中的密钥支持环境变量引用
- 但配置文件本身是明文

**OpenClaw 防御**：
- 纯本地存储，无云端组件
- 文件权限控制访问
- 但文件是明文，需要依赖 OS 的文件系统加密

**OpenHuman 防御**：
- AES-256 加密存储
- OS Keychain 管理密钥
- 数据不离开本机（除 LLM API 调用）
- 最强的数据泄露防护

## 八、选型建议

### 8.1 个人开发者 / 学习用途

**推荐：OpenClaw**

理由：安全需求较低，OpenClaw 的透明性（所有文件可直接查看）更适合学习和调试。文件原生的设计也意味着安全模型最容易理解。

### 8.2 中小团队 / 标准业务

**推荐：Hermes**

理由：PluginContext 权限控制和子代理屏蔽提供了足够的安全保障，同时不会过度增加使用复杂度。Lock file 的审计能力适合团队协作。

### 8.3 企业级 / 数据敏感场景

**推荐：OpenHuman**

理由：Workspace 沙箱 + 本地加密 + OS Keychain 的三层防护提供了最强的安全保障。数据主权设计满足企业合规要求（GDPR、SOC2 等）。

### 8.4 合规敏感行业（金融、医疗）

**推荐：OpenHuman + 自定义安全策略**

理由：OpenHuman 的安全模型基础最强，但合规敏感行业可能需要额外的安全措施（如审计日志的完整性保证、数据保留策略的合规性）。建议在 OpenHuman 的基础上进行安全加固。

## 总结

三个框架的安全模型代表了三种不同的安全哲学：

- **Hermes**：「声明式安全」——通过 PluginContext 权限声明和审批策略实现安全控制，平衡了安全性和易用性
- **OpenClaw**：「透明式安全」——依赖文件系统的原生安全机制，通过人类可审查性实现安全信任
- **OpenHuman**：「纵深防御」——Workspace 沙箱 + 本地加密 + OS Keychain 的多层防护，提供最强的安全保障

安全性和便利性永远是矛盾的。OpenHuman 的安全模型最强，但使用复杂度也最高。OpenClaw 的安全模型最简单，但防护能力也最弱。Hermes 在两者之间取平衡。

选择哪个框架的安全模型，取决于你的安全需求、团队能力和合规要求。理解每个框架的安全设计哲学和权衡取舍，才能构建安全可靠的 AI Agent 应用。

---

*本文基于 Hermes Agent、OpenClaw、OpenHuman 的公开文档和源码分析。安全模型的实际效果受配置、环境、威胁模型等多种因素影响。建议在生产环境中进行专业的安全评估和渗透测试。*

## 相关阅读

- [Hermes vs OpenClaw vs OpenHuman：三种 AI Agent 记忆架构哲学深度对比](/categories/AI%20Agent/hermes-openclaw-openhuman-memory-architecture-philosophy-comparison/)
- [三大框架多平台能力对比：传输层实现、格式适配、群聊行为策略](/categories/架构/三大框架多平台能力对比-传输层实现-格式适配-群聊行为策略/)
- [Hermes 注册表驱动 vs OpenClaw 文件原生 vs OpenHuman Memory Tree 扩展性权衡分析](/categories/架构/Hermes-注册表驱动-vs-OpenClaw-文件原生-vs-OpenHuman-Memory-Tree-扩展性权衡分析/)
