---

title: Hermes Skills Hub 分发架构：seed-then-fork 模型、quarantine 审计、lock file 溯源
keywords: [Hermes Skills Hub, seed, then, fork, quarantine, lock file, 分发架构, 模型, 审计, 溯源]
date: 2026-06-02 00:00:00
description: 深度解析 Hermes Skills Hub 分发架构的三大核心机制：seed-then-fork 种子分叉模型实现上游更新与用户修改的优雅平衡、quarantine 隔离审计机制将安全防护从事后补救前移到事前预防、lock file 溯源体系提供完整的技能来源追踪。详解三方合并策略、签名验证、Markdown Skill 文件结构，附完整代码示例，助你理解 AI Agent 技能管理的基础设施设计。
tags:
- Hermes
- Skills
- 架构
- AI Agent
- 分发系统
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---




# Hermes Skills Hub 分发架构：seed-then-fork 模型、quarantine 审计、lock file 溯源

## 前言

在 AI Agent 生态中，技能（Skill）的分发一直是一个被低估但极其关键的基础设施问题。不同于传统软件包管理器（npm、pip、cargo）处理的是静态代码依赖，AI Agent 的技能分发需要面对的是动态上下文、安全性审计、版本溯源等多维度挑战。

Hermes Agent 作为 Nous Research 推出的开源 AI Agent 框架，其 Skills Hub 采用了一套颇具前瞻性的分发架构。本文将深入剖析三个核心设计：**seed-then-fork 分发模型**、**quarantine 审计机制**、以及 **lock file 溯源体系**。

---

## 第一章：Skills Hub 的整体架构定位

### 1.1 技能的本质是什么？

在 Hermes 的世界观中，一个 Skill 本质上是一个 **Markdown 文件**，其中包含了：

- **系统提示词片段**（System Prompt Fragment）：指导 Agent 的行为模式
- **工具调用约束**（Tool Usage Constraints）：定义哪些工具在该技能上下文中可用
- **上下文注入规则**（Context Injection Rules）：决定在什么条件下激活该技能
- **知识片段**（Knowledge Fragments）：领域特定的参考信息

```markdown
# my-skill.md
---
name: laravel-expert
triggers:
  - "Laravel"
  - "artisan"
  - "Eloquent"
tools:
  - terminal
  - file
---

You are a Laravel expert. When working with Laravel projects:
1. Always check artisan commands before manual file editing
2. Use Eloquent ORM patterns instead of raw SQL
3. Follow PSR-12 coding standards
...
```

### 1.2 三层目录结构

Hermes 的技能系统采用三层目录结构，每一层有明确的语义：

```
~/.hermes/
├── skills/                    # 用户空间（user space）
│   ├── my-custom-skill.md
│   └── overrides/
│       └── laravel-expert.md  # 用户对内置技能的覆盖
├── profiles/
│   └── default/
│       └── skills/            # Profile 级技能
└── hermes-agent/
    └── skills/                # 内置空间（bundled space）
        ├── hermes-agent.md
        ├── code-review.md
        └── ...
```

这三层的优先级为：**用户空间 > Profile 空间 > 内置空间**。这个优先级设计直接影响了后续的 seed-then-fork 模型。

### 1.3 为什么需要专门的分发架构？

传统包管理器的假设是：包是不可变的，用户安装后要么使用原版，要么 fork 后自己维护。但 Agent 技能的特点完全不同：

1. **技能是可编辑的上下文**：用户经常需要根据自己的使用习惯修改技能内容
2. **更新不能覆盖用户修改**：这是最大的矛盾点
3. **安全性要求更高**：恶意技能可以直接控制 Agent 的行为
4. **溯源需求更强**：需要知道一个技能来自哪里、经过了什么修改

---

## 第二章：Seed-Then-Fork 分发模型

### 2.1 模型概述

Seed-then-fork 是 Hermes Skills Hub 的核心分发策略。这个模型的名字来自一个农业隐喻：**先播种（seed），再分叉（fork）**。

工作流程如下：

```
┌─────────────────┐
│  Skills Hub     │    Phase 1: SEED
│  (Remote Repo)  │    从远端拉取内置技能的最新版本
└────────┬────────┘    写入 bundled space（只读层）
         │
         ▼
┌─────────────────┐
│  Bundled Space  │    Phase 2: FORK
│  (hermes-agent/ │    首次运行时，将内置技能复制到
│   skills/)      │    user space 作为初始版本
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User Space     │    Phase 3: DIVERGE
│  (~/.hermes/    │    用户自由修改，后续更新
│   skills/)      │    采用三方合并策略
└─────────────────┘
```

### 2.2 Seed 阶段的实现细节

Seed 阶段发生在 `hermes-agent` 安装或更新时。核心逻辑位于安装脚本中：

```bash
# 伪代码：seed 阶段
function seed_skills(hub_repo, bundled_dir) {
    # 1. 从 Hub 拉取技能包
    skills_manifest = fetch_manifest(hub_repo)
    
    # 2. 验证签名
    for skill in skills_manifest.skills {
        if (!verify_signature(skill, hub_repo.public_key)) {
            quarantine(skill, reason="signature_mismatch")
            continue
        }
        # 3. 写入 bundled space
        write_to_bundled_dir(skill, bundled_dir)
    }
    
    # 4. 更新 lock file
    update_lock_file(skills_manifest.version, bundled_dir)
}
```

关键设计决策：

1. **bundled space 是只读的**：用户不应直接修改内置目录中的文件，这确保了"上游"始终是干净的参照系
2. **Seed 是幂等的**：多次执行 seed 不会产生副作用，只会在版本不同时更新
3. **签名验证在 seed 阶段**：在技能进入系统之前就进行安全检查

### 2.3 Fork 阶段的触发时机

Fork 不是在 seed 时立即发生的，而是 **懒触发（lazy trigger）** 的。具体来说：

- 当 Agent 首次需要加载某个技能时
- 检查 user space 中是否存在该技能
- 如果不存在，从 bundled space 复制到 user space
- 标记该技能为 `origin: bundled, forked_at: timestamp`

```python
def load_skill(skill_name):
    user_path = f"~/.hermes/skills/{skill_name}.md"
    bundled_path = f"hermes-agent/skills/{skill_name}.md"
    
    # 优先使用用户空间版本
    if os.path.exists(user_path):
        return read_skill(user_path)
    
    # 懒 fork：首次访问时从 bundled 复制
    if os.path.exists(bundled_path):
        content = read_skill(bundled_path)
        write_skill(user_path, content, metadata={
            "origin": "bundled",
            "forked_at": datetime.now(),
            "source_hash": sha256(content)
        })
        return content
    
    raise SkillNotFoundError(skill_name)
```

### 2.4 Diverge 阶段：三方合并策略

当 Hermes 检测到 bundled space 中的技能有更新时，不会直接覆盖用户空间的版本，而是采用 **三方合并（three-way merge）** 策略：

```
        ┌───────────────┐
        │ 公共祖先版本   │  ← fork 时的 bundled 版本
        │ (common base) │
        └───────┬───────┘
               / \
              /   \
             ▼     ▼
    ┌──────────┐ ┌──────────┐
    │ 用户版本  │ │ 新bundled │
    │ (ours)   │ │ (theirs) │
    └────┬─────┘ └────┬─────┘
         │            │
         ▼            ▼
    ┌─────────────────────┐
    │    合并结果          │
    │    (merged)          │
    └─────────────────────┘
```

合并算法的核心逻辑：

```python
def three_way_merge(base, ours, theirs):
    """
    三方合并策略：
    - 如果用户没有修改（ours == base），使用新版本（theirs）
    - 如果用户有修改且新版本没变（theirs == base），保留用户版本
    - 如果双方都修改了，标记为冲突，让用户决策
    """
    base_sections = parse_sections(base)
    ours_sections = parse_sections(ours)
    theirs_sections = parse_sections(theirs)
    
    merged = {}
    conflicts = []
    
    for section in all_sections(base_sections, ours_sections, theirs_sections):
        base_content = base_sections.get(section, "")
        ours_content = ours_sections.get(section, "")
        theirs_content = theirs_sections.get(section, "")
        
        if ours_content == base_content:
            # 用户没改，用新版本
            merged[section] = theirs_content
        elif theirs_content == base_content:
            # 新版本没改，保留用户版本
            merged[section] = ours_content
        elif ours_content == theirs_content:
            # 双方改成了一样（罕见但可能）
            merged[section] = ours_content
        else:
            # 冲突：双方都改了且不同
            conflicts.append(section)
            merged[section] = conflict_marker(ours_content, theirs_content)
    
    return merged, conflicts
```

### 2.5 Seed-Then-Fork 的优势

与传统的"直接覆盖"或"完全隔离"相比，seed-then-fork 模型有以下优势：

| 方面 | 直接覆盖 | 完全隔离 | Seed-Then-Fork |
|------|---------|---------|----------------|
| 用户修改保留 | ❌ 丢失 | ✅ 完全保留 | ✅ 智能合并 |
| 获取上游更新 | ✅ 自动 | ❌ 需手动 | ✅ 自动合并 |
| 冲突处理 | 无（直接覆盖） | 无（不合并） | ✅ 三方合并 |
| 首次使用体验 | ✅ 开箱即用 | ❌ 需配置 | ✅ 开箱即用 |
| 维护成本 | 低 | 高 | 中等 |

---

## 第三章：Quarantine 审计机制

### 3.1 为什么需要隔离审计？

在 AI Agent 系统中，技能文件的安全性远比传统代码包更为关键。一个恶意的 npm 包最多影响你的应用，但一个恶意的 Agent 技能可以直接控制你的 Agent 的行为，包括：

- 执行任意 shell 命令
- 读写敏感文件
- 泄露 API 密钥
- 操纵 Agent 的决策过程

Hermes 的 quarantine（隔离区）机制就是为了解决这个问题而设计的。

### 3.2 Quarantine 的生命周期

一个技能从发现到正式使用，需要经过以下隔离审计流程：

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 发现      │───▶│ 隔离区    │───▶│ 审计      │───▶│ 放行/拒绝 │
│ (discovered) │ (quarantine) │ (audited)   │ (released/rejected) │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │                │
                     │                ▼
                     │          ┌──────────┐
                     └─────────▶│ 人工审查  │
                                │ (manual)  │
                                └──────────┘
```

### 3.3 隔离区的存储结构

隔离区位于 `~/.hermes/quarantine/` 目录下，每个被隔离的技能有独立的目录：

```
~/.hermes/quarantine/
└── skill-name-abc123/
    ├── original.md           # 原始技能文件
    ├── audit-report.json     # 自动审计报告
    ├── metadata.json         # 来源信息
    └── status.txt            # 当前状态：pending/approved/rejected
```

### 3.4 自动审计规则

Hermes 的自动审计引擎会检查以下维度：

#### 3.4.1 Prompt Injection 扫描

```python
PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"you\s+are\s+now\s+",
    r"system\s*:\s*",           # 试图注入系统提示
    r"<\|im_start\|>",         # 模型特殊标记
    r"forget\s+(everything|all)",
    r"new\s+instructions?:",
    r"override\s+safety",
    r"disregard\s+(the\s+)?rules",
]

def scan_prompt_injection(content):
    """扫描技能内容中的 prompt injection 模式"""
    findings = []
    for pattern in PROMPT_INJECTION_PATTERNS:
        matches = re.findall(pattern, content, re.IGNORECASE)
        if matches:
            findings.append({
                "type": "prompt_injection",
                "pattern": pattern,
                "matches": len(matches),
                "severity": "high"
            })
    return findings
```

#### 3.4.2 工具滥用检测

```python
def scan_tool_abuse(skill_content):
    """检测技能是否试图滥用工具权限"""
    findings = []
    
    # 检查是否试图绕过工具限制
    dangerous_patterns = [
        (r"rm\s+-rf\s+/", "尝试删除根目录"),
        (r"curl.*\|\s*sh", "远程代码执行"),
        (r"eval\(", "动态代码执行"),
        (r"chmod\s+777", "过度权限授予"),
        (r"\.env", "访问环境变量文件"),
        (r"password|secret|token", "可能泄露敏感信息"),
    ]
    
    for pattern, description in dangerous_patterns:
        if re.search(pattern, skill_content, re.IGNORECASE):
            findings.append({
                "type": "tool_abuse",
                "description": description,
                "severity": "critical"
            })
    
    return findings
```

#### 3.4.3 权限边界检查

```python
def scan_permission_boundary(skill_content):
    """检查技能是否试图突破权限边界"""
    findings = []
    
    # 解析技能的 frontmatter
    metadata = parse_frontmatter(skill_content)
    
    # 检查工具声明是否合理
    declared_tools = metadata.get("tools", [])
    for tool in declared_tools:
        if tool in PRIVILEGED_TOOLS and not metadata.get("requires_approval"):
            findings.append({
                "type": "privilege_escalation",
                "tool": tool,
                "severity": "medium",
                "recommendation": "添加 requires_approval: true"
            })
    
    return findings
```

### 3.5 审计报告格式

```json
{
    "skill_name": "laravel-expert",
    "version": "1.2.0",
    "audit_timestamp": "2026-06-02T10:30:00Z",
    "overall_risk": "low",
    "findings": [
        {
            "type": "prompt_injection",
            "severity": "high",
            "location": "line 45",
            "description": "Detected potential instruction override pattern",
            "auto_resolved": false
        }
    ],
    "passed_checks": [
        "signature_verification",
        "tool_boundary_check",
        "content_length_check"
    ],
    "recommendation": "approve_with_conditions",
    "conditions": [
        "Remove line 45 before activation"
    ]
}
```

### 3.6 人工审查流程

当自动审计发现严重问题时，会触发人工审查流程：

1. **通知用户**：在终端输出警告信息
2. **展示审计报告**：列出所有发现的问题
3. **提供选项**：
   - `approve`：强制放行（用户承担风险）
   - `reject`：拒绝该技能
   - `modify`：在隔离区中编辑后重新审计

---

## 第四章：Lock File 溯源机制

### 4.1 Lock File 的设计哲学

Hermes 的 lock file 借鉴了 npm 的 `package-lock.json` 和 Go 的 `go.sum` 的设计理念，但针对 Agent 技能的特点做了重要扩展。

核心设计原则：

1. **确定性构建**：同一份 lock file 应该产生完全相同的技能环境
2. **完整溯源**：能追踪每个技能的完整来源链
3. **防篡改**：lock file 本身也有完整性校验
4. **人类可读**：虽然是机器生成的，但人也能看懂

### 4.2 Lock File 的结构

```yaml
# ~/.hermes/skills.lock
lock_version: "1.0"
generated_at: "2026-06-02T10:30:00Z"
hermes_version: "0.4.0"

skills:
  hermes-agent:
    version: "1.0.0"
    source: "bundled"
    integrity: "sha256:a1b2c3d4e5f6..."
    path: "skills/hermes-agent.md"
    dependencies: []
    
  laravel-expert:
    version: "2.1.0"
    source: "hub://skills-hub.nousresearch.com"
    integrity: "sha256:f6e5d4c3b2a1..."
    path: "skills/laravel-expert.md"
    forked_from: "bundled:laravel-expert@1.0.0"
    user_modified: true
    user_modifications_hash: "sha256:112233445566..."
    last_merged_at: "2026-06-01T15:00:00Z"
    dependencies:
      - "php-fundamentals"
      
  custom-deploy:
    version: "0.1.0"
    source: "local"
    integrity: "sha256:aabbccddeeff..."
    path: "skills/custom-deploy.md"
    created_at: "2026-05-15T09:00:00Z"
    dependencies: []
```

### 4.3 溯源链条追踪

Lock file 中的 `forked_from` 字段建立了一条完整的溯源链：

```
custom-deploy (local, user-created)
    └── 无上游依赖

laravel-expert (hub, user-modified)
    └── forked_from: bundled:laravel-expert@1.0.0
        └── source: hub://skills-hub.nousresearch.com
            └── commit: abc123def456
                └── author: hermes-team@nousresearch.com
```

这个溯源链可以回答以下问题：

1. **这个技能来自哪里？** → Hub 仓库的特定 commit
2. **谁修改过？** → 用户在 fork 后有修改
3. **基于哪个版本？** → bundled v1.0.0
4. **是否被篡改？** → 通过 integrity hash 校验

### 4.4 完整性校验算法

```python
def verify_skill_integrity(skill_path, expected_hash):
    """校验技能文件的完整性"""
    with open(skill_path, 'rb') as f:
        content = f.read()
    
    # 计算 SHA-256 哈希
    actual_hash = hashlib.sha256(content).hexdigest()
    
    if actual_hash != expected_hash:
        raise IntegrityError(
            f"Skill integrity check failed!\n"
            f"Expected: {expected_hash}\n"
            f"Actual:   sha256:{actual_hash}\n"
            f"Path:     {skill_path}\n"
            f"The skill may have been tampered with."
        )
    
    return True
```

### 4.5 Lock File 的更新时机

Lock file 不是静态的，它会在以下时机更新：

1. **Seed 完成后**：新增或更新了 bundled 技能
2. **Fork 发生时**：用户首次使用某个内置技能
3. **合并完成后**：三方合并成功后更新 hash
4. **用户手动修改**：检测到用户空间的技能被修改
5. **审计通过后**：隔离区的技能被放行

### 4.6 Lock File 与 Git 的协同

对于将 `~/.hermes/` 目录纳入版本控制的用户，lock file 提供了极好的 Git 集成：

```bash
# 查看技能变更历史
git log --oneline -- skills.lock

# 对比两个版本的技能差异
git diff HEAD~1 -- skills.lock

# 回滚到某个技能版本
git checkout HEAD~3 -- skills/laravel-expert.md
```

---

## 第五章：三个机制的协同工作

### 5.1 完整的技能生命周期

让我们追踪一个技能从发现到使用的完整旅程：

```
1. 用户运行 hermes update
   │
   ├─ Seed 阶段：从 Hub 拉取最新技能包
   │   ├─ 验证签名
   │   ├─ 写入 bundled space
   │   └─ 更新 lock file (seeded entries)
   │
   ├─ Quarantine 阶段：审计新技能
   │   ├─ Prompt injection 扫描
   │   ├─ 工具滥用检测
   │   ├─ 权限边界检查
   │   └─ 生成审计报告
   │
   ├─ Fork 阶段：首次使用时懒复制
   │   ├─ 从 bundled 复制到 user space
   │   ├─ 记录 fork 元数据
   │   └─ 更新 lock file (forked entry)
   │
   └─ Merge 阶段：后续更新时三方合并
       ├─ 检测冲突
       ├─ 自动合并非冲突部分
       ├─ 提示用户解决冲突
       └─ 更新 lock file (merged hash)
```

### 5.2 故障恢复场景

场景：用户意外修改了一个关键技能文件。

```bash
# 查看技能的溯源信息
hermes skill inspect laravel-expert

# 输出：
# Source: hub://skills-hub.nousresearch.com
# Forked from: bundled:laravel-expert@1.0.0
# User modified: true
# Last integrity check: PASSED (2026-06-01)
# Current hash: sha256:xyz789...
# Expected hash: sha256:f6e5d4...

# 恢复到 bundled 版本
hermes skill reset laravel-expert --to=bundled

# 恢复到上次合并的版本
hermes skill reset laravel-expert --to=last-merged
```

### 5.3 多 Profile 场景

Hermes 的多 Profile 机制允许不同场景使用不同的技能配置：

```
~/.hermes/
├── profiles/
│   ├── default/
│   │   ├── skills/
│   │   └── skills.lock      # default profile 的 lock file
│   └── work/
│       ├── skills/
│       └── skills.lock      # work profile 的 lock file
├── skills/                   # 全局用户空间
│   └── skills.lock          # 全局 lock file
└── quarantine/               # 共享隔离区
```

每个 Profile 有独立的 lock file，但共享同一个隔离区。这意味着一个技能在一个 Profile 中审计通过后，其他 Profile 也可以使用。

---

## 第六章：与传统包管理器的对比

### 6.1 npm 的局限性

npm 的 `package.json` + `package-lock.json` 模型在 Agent 技能分发场景下的问题：

1. **不可变性假设**：npm 假设 `node_modules` 中的内容不应该被手动修改
2. **缺乏安全审计**：npm 的安全检查是后置的（audit 命令），不是内置的
3. **没有溯源链**：只能追溯到 npm registry，无法追踪到 Git commit

### 6.2 Cargo 的借鉴

Rust 的 Cargo 从以下方面启发了 Hermes：

1. **Cargo.lock 的确定性**：同一份 lock file 产生相同结果
2. **Cargo.toml 的声明式**：依赖声明清晰明确
3. **crates.io 的签名验证**：发布者身份验证

### 6.3 Hermes 的创新点

1. **三方合并内置于分发流程**：不是可选的，而是默认行为
2. **隔离审计前置**：在技能进入系统前就进行安全检查
3. **溯源链支持 fork 追踪**：不仅知道来自哪个 registry，还知道基于哪个版本 fork

---

## 第七章：实际应用场景

### 7.1 企业内部技能分发

```
企业 Hub (internal-skills.company.com)
├── security-audit-skill
├── code-review-skill
└── deployment-skill

员工工作站
~/.hermes/
├── skills/
│   ├── security-audit.md      (企业版，未修改)
│   ├── code-review.md         (企业版 + 个人定制)
│   └── my-quick-deploy.md     (个人创建)
└── skills.lock
```

### 7.2 开源社区贡献

```
1. 开发者创建新技能
2. 提交到 Skills Hub（经过 CI 审计）
3. Hub 生成签名和版本号
4. 用户 hermes update 时自动拉取
5. 新技能经过 quarantine 审计
6. 审计通过后进入 bundled space
7. 用户首次使用时 fork 到 user space
```

### 7.3 紧急安全响应

当发现某个已分发的技能存在安全漏洞时：

```
1. Hub 发布安全公告
2. 推送修复版本
3. 用户 hermes update 时检测到安全更新
4. 自动进入 quarantine 加急审计
5. 审计通过后强制更新（即使用户有修改）
6. 三方合并保留用户修改，但安全补丁优先
```

---

## 第八章：未来展望

### 8.1 去中心化分发

当前的 Skills Hub 是中心化的，未来可能支持去中心化分发：

- 基于 IPFS 的技能存储
- 基于区块链的签名验证
- P2P 技能共享网络

### 8.2 AI 辅助审计

利用 LLM 来增强 quarantine 审计：

```python
async def ai_audit_skill(skill_content):
    """使用 LLM 进行深度语义审计"""
    response = await llm.chat(
        messages=[
            {"role": "system", "content": "You are a security auditor..."},
            {"role": "user", "content": f"Audit this skill:\n{skill_content}"}
        ]
    )
    return parse_audit_result(response)
```

### 8.3 技能市场的商业化

Skills Hub 可能演变为一个技能市场：

- 付费技能的许可证管理
- 技能的使用统计和评分
- 企业级技能的 SLA 保障

---

## 总结

Hermes Skills Hub 的分发架构通过三个核心机制解决了 AI Agent 技能管理的根本问题：

1. **Seed-Then-Fork 模型**：在获取上游更新和保留用户修改之间找到了平衡点，通过三方合并策略优雅地处理了这对矛盾
2. **Quarantine 审计机制**：在技能进入系统前就进行深度安全检查，将安全防护从"事后补救"前移到"事前预防"
3. **Lock File 溯源体系**：提供了完整的技能来源追踪能力，确保每一个技能的来龙去脉都清晰可查

这三个机制不是孤立的，而是形成了一个完整的安全分发闭环：**安全地获取（seed）→ 可靠地追踪（lock file）→ 放心地使用（quarantine）**。

在 AI Agent 越来越深入日常工作的今天，这样的基础设施设计为整个生态的健康发展奠定了坚实的基础。

## 相关阅读

- [Hermes 技能同步机制：bundled skills → user space 的增量同步与用户修改保留策略](/post/hermes-bundled-skills-user-space/)
- [Hermes Skill vs Plugin 扩展点对比：什么时候用 Skill，什么时候用 Plugin？](/post/hermes-skill-plugin/)
- [Hermes 子代理架构：leaf vs orchestrator 角色模型、工具屏蔽、审批策略](/post/hermes-leaf-orchestrator/)

---

*本文基于 Hermes Agent v0.4.x 源码分析，相关设计可能随版本迭代而演进。*
