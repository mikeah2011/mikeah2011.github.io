---

title: AI Context Engineering 实战：系统化管理 AI 上下文——.cursorrules/CLAUDE.md/AGENTS.md 的工程化配置与团队共享
keywords: [AI Context Engineering, AI, cursorrules, CLAUDE.md, AGENTS.md, 系统化管理, 上下文, 的工程化配置与团队共享]
date: 2026-06-07 11:00:00
tags:
- AI
- Context Engineering
- Cursor
- Claude
- GitHub Copilot
- 工程化
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: Context Engineering 上下文工程实战：系统讲解 .cursorrules、CLAUDE.md、AGENTS.md、.windsurfrules 规则文件的工程化配置与三层架构策略，涵盖团队共享、自动化生成、CI 校验及六个常见踩坑方案，适合 Cursor、Claude Code、Copilot 全栈开发团队。
---



## 引言：一个令所有 AI 开发者抓狂的场景

你打开 Cursor，准备让 AI 帮你重构一个 Service 类。你输入：

> "帮我把 UserService 的注册逻辑拆分成独立的 Action。"

AI 给出的结果用了 `array` 而不是 Laravel 的 `collect()`，没有写测试，方法命名用了 `camelCase` 但你团队约定的是 `snake_case`，而且它甚至不知道你项目里已经有一个 `app/Actions/` 目录。

于是你不得不补充说明：

> "我们用 Laravel 11，遵循 Pint 规范，Action 放在 app/Actions/ 下，用 Pest 测试，依赖注入通过构造函数，DTO 用 spatie/laravel-data……"

这些话你已经打了 **几百遍**。每个新对话都要重复，每个 AI 工具都要重新配置，每个新同事入职时都要从零解释。

更糟糕的是，这种低效不仅浪费时间，还会导致 AI 生成的代码质量不稳定——因为上下文的完整性完全取决于你当次对话输入了多少信息。你忘记了提一行关键约束，AI 就会生成违反该约束的代码；你简化了描述，AI 就会做出错误的架构假设。

这不是 AI 模型能力的问题，而是 **上下文管理** 的问题。

这就是 **Context Engineering（上下文工程）** 要解决的核心问题。

---

## 一、从 Prompt Engineering 到 Context Engineering

### 1.1 Prompt Engineering 的局限

过去两年，我们一直在谈 Prompt Engineering——如何写出更好的提示词来获得更优质的 AI 输出。社区里涌现了各种"魔法提示词"、"万能提示模板"，甚至出现了专门研究提示词工程的书籍和课程。

但随着 AI 编程助手从"一次性问答"演进到"持续协作伙伴"，Prompt Engineering 的局限性越来越明显：

- **临时性**：每次对话都要重新构建上下文，对话结束后上下文消失。你花十分钟精心组织的提示词，在下一次对话中需要重新来过
- **不可复用**：团队中每个人写出来的提示词质量参差不齐。高级工程师写得好的提示词，初级工程师根本不知道怎么复用
- **无版本控制**：提示词散落在聊天记录中，无法追溯和迭代。你不知道上个月用的那个"特别好用"的提示词到底写了什么
- **上下文窗口有限**：即使模型支持 128K Token，填入过多背景信息也会稀释核心指令的注意力。模型的"记忆力"并非无限，它更擅长处理结构化的、精炼的信息
- **缺乏团队一致性**：每个人的理解不同，写出来的提示词侧重点不同，最终 AI 给出的代码风格也不一致

### 1.2 Context Engineering 的定义

**Context Engineering** 不是"写更好的提示词"，而是 **系统化地构建、管理和优化 AI 可见的上下文信息**。

这个概念最早由 Andrej Karpathy（前 Tesla AI 总监、OpenAI 创始成员）在 2025 年提出。他在推文中写道：

> "最热门的新提示词工程趋势是上下文工程——将解决子问题所需的恰到好处的信息组装起来，放在上下文中，而不是试图用一句话完成所有事。"

它的核心理念是：**与其在每次对话中临时构建上下文，不如将上下文固化为可维护、可版本控制、可团队共享的工程制品。**

打个比方：Prompt Engineering 就像厨师每次做饭时临时决定要买什么菜；而 Context Engineering 则是提前建好了一个标准化的厨房——调料摆放有序、食材按菜谱分类、常用配方贴在墙上。厨师走进厨房就能高效工作，不需要每次从零开始。

简单来说：

| 维度 | Prompt Engineering | Context Engineering |
|------|-------------------|---------------------|
| 粒度 | 单次对话 | 项目级、团队级、组织级 |
| 持久性 | 临时 | 文件化、版本控制 |
| 复用性 | 个人 | 团队共享 |
| 维护方式 | 手动 | 工程化（自动化生成、CI 校验） |
| 关注点 | "怎么问" | "让 AI 看到什么" |

### 1.3 为什么现在必须重视 Context Engineering

2025-2026 年，AI 编程助手已经从"锦上添花的补全工具"变成了"能独立完成复杂任务的 Coding Agent"。Cursor 的 Composer 可以跨文件编排，Claude Code 可以自主执行终端命令，GitHub Copilot Workspace 可以从 Issue 直接生成 PR，Hermes Agent 甚至可以管理完整的开发工作流。

这意味着 **AI 的输出质量越来越依赖于它能"看到"什么上下文**。而上下文的管理，正是 Context Engineering 的核心职责。

具体来说，Context Engineering 解决了三个关键问题：

1. **一致性问题**：确保团队中每个人使用 AI 工具时，都能获得符合团队规范的输出。不再出现"前端同事的 AI 生成了 React class 组件，后端同事的 AI 用了 Vue 3 Composition API"的混乱局面。

2. **效率问题**：将重复的上下文构建从"每次对话手动输入"变为"规则文件自动注入"。一个写得好的规则文件，可以让你在新对话中直接进入工作状态，而不是花五分钟"喂"AI 背景信息。

3. **质量问题**：通过精心设计的规则文件，引导 AI 在架构设计、安全实践、测试策略等方面做出更符合团队标准的决策。规则文件就是给 AI 的"操作手册"，让它的输出质量不再随缘。

---

## 二、主流 AI 编程工具的上下文文件体系

2026 年的主流 AI 编程工具几乎都采用了"项目根目录规则文件"的方案，但文件名、语法和能力各不相同。理解这些差异对于跨工具协作和团队共享至关重要。

每个工具的设计哲学也有细微差别：Cursor 更注重"文件级精细控制"，Claude Code 强调"多层级智能合并"，GitHub Copilot 侧重"与 GitHub 生态深度集成"，Windsurf 则追求"轻量简洁"。

### 2.1 工具对比总览

| 特性 | Cursor | Claude Code | GitHub Copilot | Windsurf |
|------|--------|------------|----------------|----------|
| 规则文件 | `.cursorrules` | `CLAUDE.md` | `AGENTS.md` | `.windsurfrules` |
| 文件格式 | Markdown | Markdown | Markdown | Markdown |
| 多级配置 | ✅ 全局 + 项目 | ✅ 全局 + 项目 + 目录级 | ✅ 仓库级 + 组织级 | ✅ 全局 + 项目 |
| 目录级规则 | ✅ `.cursor/rules/*.mdc` | ✅ 子目录 `CLAUDE.md` | ❌ | ❌ |
| 自动引用 | ✅ 根据文件自动匹配 | ✅ 根据工作目录自动加载 | ✅ 随仓库自动生效 | ✅ 自动加载 |
| Git 友好 | ✅ | ✅ | ✅ 原生 Git 集成 | ✅ |
| Token 预算 | ~500 行建议 | 自动摘要超长内容 | 无明确限制 | ~400 行建议 |

### 2.2 `.cursorrules` — Cursor

Cursor 的 `.cursorrules` 是最早流行起来的项目级 AI 规则文件。它在每次对话开始时作为系统提示的一部分注入。它的优势在于 **与编辑器深度集成**——你打开某个文件时，Cursor 会自动识别文件类型，并加载对应的规则。

值得注意的是，Cursor 对规则文件的格式支持比较宽松——你可以用 Markdown、纯文本、甚至 JSON 格式，但 Markdown 是社区公认的最佳实践。建议使用 Markdown 的标题层级来组织规则，这样 AI 能更好地理解规则之间的层次关系：

```markdown
# .cursorrules

## 项目概述
这是一个 Laravel 11 B2C 电商平台的后端 API。

## 代码规范
- 遵循 PSR-12 和 Laravel Pint 默认配置
- 使用 strict types: `declare(strict_types=1);`
- 每个文件不超过 300 行

## 架构约束
- 使用 Repository Pattern，不允许直接在 Controller 中操作 Eloquent
- API 响应统一使用 `ApiResource` 类
- 队列任务放在 `app/Jobs/`，事件放在 `app/Events/`

## 测试策略
- 使用 Pest PHP，不使用 PHPUnit
- 每个 Feature Test 覆盖一个 API 端点
- 使用 Factory 和 Seed 构建测试数据
```

**进阶用法**：Cursor 还支持 `.cursor/rules/` 目录下的 `.mdc` 规则文件，可以针对特定目录或文件类型定义细粒度规则：

```
.cursor/
  rules/
    controllers.mdc    # 仅对 app/Http/Controllers/ 下的文件生效
    models.mdc         # 仅对 app/Models/ 下的文件生效
    tests.mdc          # 仅对 tests/ 下的文件生效
```

### 2.3 `CLAUDE.md` — Claude Code

Anthropic 的 Claude Code 采用 `CLAUDE.md` 作为项目规则文件。它的独特之处在于 **支持多层级**，这让它在大型项目和团队协作场景中具有天然优势。多层级设计的核心理念是：项目级规则定义"大家都要遵守的约定"，目录级规则定义"这个模块的特殊要求"，全局级规则定义"我个人的工作偏好"。三层合并后，AI 就能获得恰到好处的上下文。

```
~/.claude/CLAUDE.md          # 全局级（所有项目通用）
项目根目录/CLAUDE.md          # 项目级
项目根目录/src/CLAUDE.md      # 目录级（仅对 src/ 下的操作生效）
```

Claude Code 在加载时会自动合并所有层级的规则。如果规则文件过长，它会自动进行摘要压缩，这一点比 Cursor 更智能：

```markdown
# CLAUDE.md

## 核心约定
- PHP 8.3+，Laravel 11
- 测试用 Pest，不用 PHPUnit
- 依赖注入通过构造函数，不使用 app() 全局辅助函数

## 安全规则（不可违反）
- 禁止在代码中硬编码密钥、Token 或密码
- 禁止执行 `rm -rf /` 或任何危险的文件操作
- 数据库操作必须使用参数化查询，禁止拼接 SQL

## 工作流
- 修改代码后运行 `./vendor/bin/pint --test` 检查风格
- 运行 `./vendor/bin/pest` 确保测试通过
- Commit message 遵循 Conventional Commits
```

### 2.4 `AGENTS.md` — GitHub Copilot

GitHub Copilot 的 `AGENTS.md` 是后来者，但依托 GitHub 的生态优势迅速普及。它的核心特点是与 **GitHub Issues 和 Pull Requests** 深度集成。这意味着当你在 GitHub 上创建一个 Issue 让 Copilot 去实现时，它会自动读取 `AGENTS.md` 中的规则来生成代码，确保生成的 PR 符合团队规范。

`AGENTS.md` 的另一个独特功能是支持 **组织级别的策略文件**。在 GitHub Enterprise 中，组织管理员可以在组织层面定义一套 `AGENTS.md`，然后所有仓库都会自动继承。这对于需要统一规范的大型组织来说非常有价值。

```markdown
# AGENTS.md

## 项目信息
- 仓库：my-company/laravel-api
- 框架：Laravel 11 + PHP 8.3
- 数据库：PostgreSQL 16

## Copilot 行为规范
- 生成的代码必须通过 PHPStan Level 8 静态分析
- 不要自动创建 Migration，只生成 Migration 的骨架代码
- PR 描述使用中文，代码注释使用英文
```

`AGENTS.md` 的一个显著优势是：当 Copilot 从 Issue 生成代码时，它会自动读取仓库根目录的 `AGENTS.md`，确保生成的代码符合团队规范。

### 2.5 `.windsurfrules` — Windsurf

Windsurf（原 Codeium）的规则文件格式与 `.cursorrules` 类似，但支持的功能相对较少。它更适合个人开发者的小型项目。Windsurf 的设计理念是"不增加认知负担"——规则文件越简单越好，AI 会尽力去理解和遵循。

如果你的团队同时使用 Cursor 和 Windsurf，可以将 `.cursorrules` 的核心内容复制到 `.windsurfrules` 中（两者语法兼容），但需要注意 Windsurf 不支持 Cursor 的 `.cursor/rules/` 目录级规则功能。

```markdown
# .windsurfrules

- 使用 TypeScript strict mode
- 组件使用 React 函数式组件 + Hooks
- 样式使用 Tailwind CSS，不使用 CSS-in-JS
- 测试使用 Vitest + React Testing Library
```

---

## 三、工程化配置：三层架构策略

在实际的团队开发中，AI 规则文件需要 **分层管理**，而不是一股脑写在一个文件里。我推荐三层架构：

### 3.1 个人级（Global）

个人级规则关注的是 **个人偏好和工具链配置**，不提交到 Git：

```
~/.cursor/rules/              # Cursor 全局规则
~/.claude/CLAUDE.md           # Claude Code 全局规则
```

示例（`~/.claude/CLAUDE.md`）：

```markdown
# 个人全局规则

## 编辑器偏好
- 缩进使用 4 空格（PHP）、2 空格（TypeScript/JSON）
- 文件末尾保留一个空行
- 行宽限制 120 字符

## 个人工作流
- 每次修改后自动运行 linter
- Commit message 使用英文
- 代码注释使用中英混合（中文解释意图，英文标注类型）
```

### 3.2 团队级（Repository Root）

团队级规则是 **团队共识的编码规范和架构约束**，必须提交到 Git，所有成员共享：

```
项目根目录/.cursorrules       # Cursor
项目根目录/CLAUDE.md          # Claude Code
项目根目录/AGENTS.md          # GitHub Copilot
项目根目录/.windsurfrules     # Windsurf
```

### 3.3 模块级（Subdirectory）

模块级规则针对特定目录的特殊约束，适用于大型 Monorepo：

```
项目根目录/src/api/CLAUDE.md          # API 模块特殊规则
项目根目录/src/admin/CLAUDE.md        # 后台模块特殊规则
项目根目录/tests/CLAUDE.md            # 测试目录特殊规则
```

### 3.4 优先级规则

当多层规则冲突时，优先级从高到低为：

1. **模块级** > 团队级 > 个人级
2. **显式指令** > 规则文件（用户在对话中直接给出的指令优先级最高）
3. **更具体的规则** > 更泛化的规则

---

## 四、实战：Laravel 项目的完整规则配置

以下是一个生产级 Laravel 11 B2C API 项目的完整规则配置，以 `.cursorrules` 为例，其他工具的规则文件可以基于此调整：

### 4.1 项目级规则文件

```markdown
# .cursorrules

## 项目概述
Laravel 11 B2C 电商平台后端 API，服务数百万用户。
PHP 8.3 | Laravel 11 | PostgreSQL 16 | Redis 7 | Docker

## 代码规范
- PSR-12 + Laravel Pint 默认配置
- 每个文件开头: `declare(strict_types=1);`
- 单文件不超过 300 行，单方法不超过 40 行
- 使用 constructor promotion 简化属性声明
- 命名: 类名 PascalCase, 方法 camelCase, 数据库字段 snake_case

## 架构约束（严格遵守）
- 分层: Controller → Service → Repository → Model
- Controller 只负责 HTTP 输入输出，不含业务逻辑
- 业务逻辑封装在 app/Services/ 中
- 数据库操作封装在 app/Repositories/ 中
- 共用逻辑抽取为 app/Actions/（单任务类）
- DTO 使用 spatie/laravel-data
- API Resource 使用 app/Http/Resources/
- 队列任务放在 app/Jobs/，继承 base Job 类

## Eloquent 规范
- Model 不得包含业务逻辑，仅定义关系、Scope、Accessor
- 禁止在 Controller 中直接调用 Model::create()
- 使用 Factory 填充测试数据
- Migration 必须包含 up 和 down

## 测试策略
- 使用 Pest PHP，不使用 PHPUnit 语法
- Feature Test 覆盖每个 API 端点
- Unit Test 覆盖每个 Service/Action
- 使用 RefreshDatabase trait
- 断言使用 expect() API: expect($user->name)->toBe('John')
- 测试命名: it('可以注册新用户') 或 test('可以注册新用户')

## 安全规则（不可违反）
- 禁止硬编码任何密钥、Token、密码
- 用户输入必须验证（FormRequest 或 Validator）
- SQL 查询必须使用参数化，禁止字符串拼接
- Mass assignment 必须定义 $fillable 或 $guarded
- 敏感操作必须记录审计日志

## 禁止事项
- 不使用 dd() / dump() / var_dump() 进行调试
- 不使用 app() 全局辅助函数获取依赖
- 不在 Model 中直接使用 DB::raw()
- 不引入未经审批的 Composer 包（如需引入，先在 PR 中说明理由）
```

### 4.2 目录级规则示例（`.cursor/rules/controllers.mdc`）

```markdown
---
globs: ["app/Http/Controllers/**/*.php"]
---

# Controller 规则

- Controller 方法不超过 15 行
- 使用 API Resource 包装响应
- 注入 Service 而非 Repository
- 每个 Controller 负责一个资源
- 使用 FormRequest 进行验证
- 响应格式: `return new UserResource($user);`
```

### 4.3 目录级规则示例（`.cursor/rules/tests.mdc`）

```markdown
---
globs: ["tests/**/*.php"]
---

# 测试规则

- 每个测试方法只测一个行为
- 使用 Given-When-Then 结构（可省略注释，但代码结构要体现）
- 使用 Laravel 的 actingAs() 模拟认证
- Factory 中不使用随机数据，使用固定 seed
- 测试数据库与开发数据库隔离
```

---

## 五、Git 版本控制与团队共享的最佳实践

### 5.1 应该提交还是忽略？

这是团队最常问的问题。答案是：**规则文件必须提交到 Git。**

```gitignore
# .gitignore

# ✅ 不要忽略 AI 规则文件
# .cursorrules      ← 不要加这行
# CLAUDE.md         ← 不要加这行
# AGENTS.md         ← 不要加这行

# ✅ 但要忽略个人级的本地覆盖
.cursor/local-rules/
```

### 5.2 统一指令源策略

当团队同时使用多个 AI 工具时，最大的风险是指令冲突。比如 `.cursorrules` 说"用 PHPUnit"，`CLAUDE.md` 说"用 Pest"。

**解决方案：建立一个权威的指令源，其他文件只做引用或补充。**

我的推荐策略是：

1. **`CLAUDE.md` 作为权威源**——因为 Claude Code 支持多层级、自动摘要、目录级规则，功能最全面
2. **`.cursorrules` 只写 Cursor 特有的配置**——比如 `.cursor/rules/*.mdc` 的规则
3. **`AGENTS.md` 只写 GitHub 特有的配置**——比如 PR 模板、Issue 模板的要求
4. **通过脚本从权威源同步通用规则**（见第六节）

### 5.3 团队规则仓库模式

在拥有 10+ 仓库的团队中，每个项目单独维护规则文件会导致大量重复。更好的做法是建立一个 **规则仓库**：

```
ai-rules/                        # 独立的 Git 仓库
├── base/
│   ├── common.md               # 通用规则（语言、风格、安全）
│   ├── laravel.md              # Laravel 框架规则
│   ├── react.md                # React 前端规则
│   └── testing.md              # 测试规则
├── templates/
│   ├── .cursorrules.template   # Cursor 模板
│   ├── CLAUDE.md.template      # Claude Code 模板
│   └── AGENTS.md.template      # Copilot 模板
├── scripts/
│   ├── generate.sh             # 生成脚本
│   ├── validate.sh             # 校验脚本
│   └── sync.sh                 # 同步脚本
└── README.md
```

在项目中的使用方式：

```bash
# 方式一：Git Submodule
git submodule add git@github.com:company/ai-rules.git .ai-rules

# 方式二：符号链接
ln -sf /path/to/ai-rules/templates/.cursorrules .cursorrules

# 方式三：npm/composer script 自动生成
# 在 composer.json 的 post-install-cmd 中触发
```

---

## 六、自动化生成与更新脚本

### 6.1 基于项目结构自动推断规则文件

以下脚本可以根据项目结构自动检测技术栈，并生成相应的 AI 规则文件：

```bash
#!/bin/bash
# generate-ai-rules.sh
# 基于项目结构自动生成 AI 规则文件

set -euo pipefail

PROJECT_DIR="${1:-.}"
cd "$PROJECT_DIR"

echo "🔍 检测项目技术栈..."

# 初始化变量
FRAMEWORK=""
LANGUAGE=""
TEST_TOOL=""
HAS_PEST=false
HAS_PHPUNIT=false
HAS_VITEST=false
HAS_JEST=false

# 检测 PHP/Laravel
if [ -f "artisan" ]; then
    FRAMEWORK="Laravel"
    LANGUAGE="PHP"
    PHP_VERSION=$(php -v 2>/dev/null | head -1 | grep -oP '\d+\.\d+' | head -1 || echo "8.2")
    echo "  ✅ Laravel (PHP $PHP_VERSION)"
fi

# 检测 Node.js
if [ -f "package.json" ]; then
    if grep -q "next" package.json 2>/dev/null; then
        FRAMEWORK="Next.js"
        LANGUAGE="TypeScript"
        echo "  ✅ Next.js"
    elif grep -q "react" package.json 2>/dev/null; then
        FRAMEWORK="React"
        LANGUAGE="TypeScript"
        echo "  ✅ React"
    fi
fi

# 检测测试框架
if [ -f "composer.json" ]; then
    grep -q "pestphp/pest" composer.json 2>/dev/null && HAS_PEST=true
    grep -q "phpunit/phpunit" composer.json 2>/dev/null && HAS_PHPUNIT=true
fi
if [ -f "package.json" ]; then
    grep -q "vitest" package.json 2>/dev/null && HAS_VITEST=true
    grep -q "jest" package.json 2>/dev/null && HAS_JEST=true
fi

# 确定测试工具
if $HAS_PEST; then
    TEST_TOOL="Pest PHP"
elif $HAS_PHPUNIT; then
    TEST_TOOL="PHPUnit"
elif $HAS_VITEST; then
    TEST_TOOL="Vitest"
elif $HAS_JEST; then
    TEST_TOOL="Jest"
fi

echo ""
echo "📝 生成规则文件..."

# 生成 .cursorrules
cat > .cursorrules << RULES
# .cursorrules — 自动生成 $(date +%Y-%m-%d)

## 项目概述
- 框架: ${FRAMEWORK:-Unknown}
- 语言: ${LANGUAGE:-Unknown}
- 测试工具: ${TEST_TOOL:-未检测到}

## 代码规范
- 遵循语言社区标准规范
- 保持代码简洁，单一职责原则

## 架构约束
- 分层清晰: Controller → Service → Repository
- 业务逻辑不在 Controller 中
- 使用依赖注入

## 测试
- 测试工具: ${TEST_TOOL:-请手动配置}
- 核心功能必须有测试覆盖

## 安全
- 禁止硬编码密钥和密码
- 用户输入必须验证
- 使用参数化查询
RULES

echo "  ✅ .cursorrules 已生成"

# 生成 CLAUDE.md（与 .cursorrules 内容一致 + Claude Code 特有配置）
cp .cursorrules CLAUDE.md
cat >> CLAUDE.md << 'EXTRA'

## Claude Code 特有配置
- 使用 TodoWrite 跟踪多步骤任务
- 复杂修改前先列出计划
- 修改完成后自动运行 linter 和测试
EXTRA

echo "  ✅ CLAUDE.md 已生成"

# 生成 AGENTS.md
cp .cursorrules AGENTS.md
cat >> AGENTS.md << 'EXTRA'

## GitHub Copilot 配置
- PR 描述使用中文
- Commit message 遵循 Conventional Commits
- 生成代码前先检查是否有相关的 Issue
EXTRA

echo "  ✅ AGENTS.md 已生成"

echo ""
echo "🎉 规则文件生成完成！请根据项目实际情况调整内容。"
```

### 6.2 规则文件校验脚本

在 CI 中加入规则文件校验，确保团队成员不会意外删除或破坏规则文件：

```bash
#!/bin/bash
# validate-ai-rules.sh
# CI 中校验 AI 规则文件的存在性和基本格式

set -euo pipefail

ERRORS=0

check_file() {
    local file="$1"
    local min_lines="${2:-5}"

    if [ ! -f "$file" ]; then
        echo "❌ 缺少 $file"
        ERRORS=$((ERRORS + 1))
        return
    fi

    local lines
    lines=$(wc -l < "$file")
    if [ "$lines" -lt "$min_lines" ]; then
        echo "❌ $file 内容过少（${lines} 行，最少 ${min_lines} 行）"
        ERRORS=$((ERRORS + 1))
        return
    fi

    echo "✅ $file（${lines} 行）"
}

echo "🔍 校验 AI 规则文件..."

# 至少需要一个规则文件
if [ -f ".cursorrules" ]; then
    check_file ".cursorrules" 10
elif [ -f "CLAUDE.md" ]; then
    check_file "CLAUDE.md" 10
elif [ -f "AGENTS.md" ]; then
    check_file "AGENTS.md" 10
else
    echo "❌ 项目中没有任何 AI 规则文件（.cursorrules / CLAUDE.md / AGENTS.md）"
    ERRORS=$((ERRORS + 1))
fi

# 检查规则文件不含敏感信息
for file in .cursorrules CLAUDE.md AGENTS.md; do
    if [ -f "$file" ]; then
        if grep -iE "(api_key|secret_key|password|token)\s*[:=]\s*['\"][^'\"]{8,}" "$file" 2>/dev/null; then
            echo "❌ $file 可能包含硬编码的密钥或密码！"
            ERRORS=$((ERRORS + 1))
        fi
    fi
done

if [ "$ERRORS" -gt 0 ]; then
    echo ""
    echo "💥 发现 $ERRORS 个问题，请修复后再提交。"
    exit 1
fi

echo ""
echo "🎉 规则文件校验通过！"
```

### 6.3 多仓库同步脚本

```bash
#!/bin/bash
# sync-ai-rules.sh
# 从规则仓库同步通用规则到所有项目

RULES_REPO="git@github.com:company/ai-rules.git"
TEMP_DIR=$(mktemp -d)
TARGET_REPOS=(
    "git@github.com:company/backend-api.git"
    "git@github.com:company/admin-panel.git"
    "git@github.com:company/frontend-web.git"
)

echo "📦 拉取规则仓库..."
git clone --depth 1 "$RULES_REPO" "$TEMP_DIR/rules" 2>/dev/null

for repo in "${TARGET_REPOS[@]}"; do
    repo_name=$(basename "$repo" .git)
    repo_dir="$TEMP_DIR/$repo_name"

    echo ""
    echo "🔄 同步 $repo_name..."

    git clone --depth 1 "$repo" "$repo_dir" 2>/dev/null

    # 合并通用规则 + 项目特定规则
    cat "$TEMP_DIR/rules/base/common.md" > "$repo_dir/CLAUDE.md"
    echo "" >> "$repo_dir/CLAUDE.md"

    # 如果项目有自定义规则，追加到末尾
    if [ -f "$repo_dir/CLAUDE.local.md" ]; then
        echo "## 项目特定规则" >> "$repo_dir/CLAUDE.md"
        cat "$repo_dir/CLAUDE.local.md" >> "$repo_dir/CLAUDE.md"
    fi

    # 同步到其他工具
    cp "$repo_dir/CLAUDE.md" "$repo_dir/.cursorrules"
    cp "$repo_dir/CLAUDE.md" "$repo_dir/AGENTS.md"

    cd "$repo_dir"
    git add -A
    git diff --cached --quiet || git commit -m "chore: sync AI rules from central repo"
    git push
    cd - > /dev/null

    echo "  ✅ $repo_name 已同步"
done

rm -rf "$TEMP_DIR"
echo ""
echo "🎉 所有仓库同步完成！"
```

---

## 七、常见踩坑与解决方案

### 踩坑 1：上下文过长导致 AI "选择性失忆"

**现象**：规则文件超过 500 行后，AI 开始忽略靠后的规则。

**原因**：模型对系统提示的注意力分配存在"中间遗忘"效应（Lost in the Middle），过长的规则文件会导致中间部分的规则被忽略。

**解决方案**：

```
控制规则文件长度在 200 行以内
├── 最关键的规则放在文件开头（前 20 行）
├── 次重要的规则放在文件末尾
├── 详细的规范放在 docs/ai-rules/ 目录中，规则文件只引用
└── 利用目录级规则文件（.cursor/rules/*.mdc）分散内容
```

### 踩坑 2：多个工具的规则文件互相冲突

**现象**：Cursor 遵循 `.cursorrules` 用 PHPUnit，Claude Code 遵循 `CLAUDE.md` 用 Pest，两个工具生成的代码风格不一致。

**解决方案**：统一指令源。以一个文件（推荐 `CLAUDE.md`）为权威源，其他文件通过脚本自动生成或只包含工具特有的配置：

```makefile
# Makefile
sync-rules:
	@echo "同步规则文件..."
	@cp CLAUDE.md .cursorrules
	@cp CLAUDE.md AGENTS.md
	@echo "✅ 所有规则文件已同步"

validate-rules:
	@bash scripts/validate-ai-rules.sh
```

### 踩坑 3：规则文件被意外修改或删除

**现象**：团队成员误操作删除了规则文件，或 AI 在代码重构时意外修改了规则文件。

**解决方案**：

```bash
# 方案一：Git pre-commit hook
#!/bin/bash
# .git/hooks/pre-commit

# 检查关键文件是否被意外删除
for file in .cursorrules CLAUDE.md AGENTS.md; do
    if git diff --cached --name-only | grep -q "^${file}$"; then
        echo "⚠️  警告: $file 被修改，请确认这是有意为之。"
        echo "如确认修改，使用 git commit --no-verify 跳过此检查。"
        exit 1
    fi
done
```

```bash
# 方案二：CODEOWNERS 文件
# .github/CODEOWNERS
.cursorrules    @tech-lead-username
CLAUDE.md       @tech-lead-username
AGENTS.md       @tech-lead-username
```

### 踩坑 4：规则文件与 .gitignore 冲突

**现象**：团队的 `.gitignore` 模板中包含了 `.*`（忽略所有隐藏文件），导致 `.cursorrules` 和 `.windsurfrules` 被忽略。

**解决方案**：在 `.gitignore` 中显式排除规则文件：

```gitignore
# 忽略大部分隐藏文件
.*

# 但保留 AI 规则文件
!.cursorrules
!.cursor/
!.windsurfrules
!.github/
```

### 踩坑 5：规则文件过时导致 AI 生成过时代码

**现象**：项目从 Laravel 10 升级到 Laravel 11，但 `CLAUDE.md` 还写着 Laravel 10 的语法，AI 生成的代码使用过时的 API。

**解决方案**：将规则文件的更新纳入升级流程的一部分：

```bash
# upgrade-laravel.sh（升级脚本片段）
echo "升级 Laravel 完成，更新 AI 规则文件..."
sed -i '' 's/Laravel 10/Laravel 11/g' CLAUDE.md .cursorrules AGENTS.md
echo "✅ AI 规则文件已更新"
```

### 踩坑 6：不同项目目录结构差异大，通用规则不适用

**现象**：前端项目的规则和后端项目的规则完全不同，无法使用同一套模板。

**解决方案**：使用按技术栈分类的规则仓库 + 条件生成：

```bash
# generate.sh — 根据项目类型选择模板
if [ -f "artisan" ]; then
    TEMPLATE="laravel.md"
elif [ -f "next.config.js" ] || [ -f "next.config.mjs" ]; then
    TEMPLATE="nextjs.md"
elif [ -f "Cargo.toml" ]; then
    TEMPLATE="rust.md"
fi

cat "templates/$TEMPLATE" > CLAUDE.md
```

---

## 八、Context Engineering 的进阶实践

### 8.1 动态上下文注入

除了静态规则文件，还可以通过 **脚本动态生成上下文**：

```bash
#!/bin/bash
# 动态生成项目状态摘要，追加到规则文件
{
    echo ""
    echo "## 项目当前状态（自动生成 $(date +%Y-%m-%d)）"
    echo "- 未合并的 PR 数量: $(gh pr list --state open --json number | jq length)"
    echo "- 未解决的 Issue 数量: $(gh issue list --state open --json number | jq length)"
    echo "- 最近一次部署: $(gh run list --limit 1 --json createdAt -q '.[0].createdAt')"
    echo "- 主要依赖版本:"
    grep -E '"(laravel|php|react|typescript)"' composer.json package.json 2>/dev/null | head -5
} >> CLAUDE.md
```

### 8.2 规则文件的渐进式优化

Context Engineering 不是一次性工作，而是持续迭代的过程。建议的优化节奏：

1. **每周**：回顾 AI 的输出质量，将反复出现的修正添加到规则文件
2. **每月**：审查规则文件长度，移除过时规则，合并重复规则
3. **每季度**：与团队对齐规则文件，同步到所有仓库
4. **框架升级时**：立即更新规则文件

### 8.3 规则文件的质量指标

可以用以下指标衡量规则文件的质量：

- **遵循率**：AI 输出中有多少比例符合规则文件的规定
- **修正频率**：在使用规则文件后，手动修正 AI 输出的频率是否下降
- **团队一致性**：不同成员使用同一规则文件后，AI 输出的一致程度
- **文件大小**：规则文件行数（目标：< 200 行）

---

## 九、总结与最佳实践清单

### 核心原则

1. **Context Engineering > Prompt Engineering**：将 AI 上下文作为工程制品来管理
2. **分层管理**：个人级、团队级、模块级各司其职
3. **统一指令源**：避免多文件冲突，以一个权威源为基础
4. **版本控制**：规则文件必须提交到 Git，纳入代码审查
5. **持续迭代**：规则文件随项目演进而更新

### 最佳实践清单

| # | 实践 | 优先级 |
|---|------|--------|
| 1 | 为每个项目创建至少一个 AI 规则文件 | 🔴 必须 |
| 2 | 规则文件控制在 200 行以内 | 🔴 必须 |
| 3 | 将规则文件提交到 Git | 🔴 必须 |
| 4 | 用脚本统一多个工具的规则文件 | 🟡 推荐 |
| 5 | 使用目录级规则文件分散配置 | 🟡 推荐 |
| 6 | 在 CI 中校验规则文件存在性和格式 | 🟡 推荐 |
| 7 | 建立团队规则仓库 | 🟢 大团队推荐 |
| 8 | 动态注入项目状态信息 | 🟢 进阶推荐 |
| 9 | 定期审查和更新规则文件 | 🟡 推荐 |
| 10 | 使用 CODEOWNERS 保护规则文件 | 🟢 大团队推荐 |

### 一句话总结

**Context Engineering 的本质是把"你知道但 AI 不知道的东西"变成"AI 每次都能看到的、团队共同维护的工程制品"。** 当你不再需要在每次对话中重复解释项目背景时，AI 编程助手才算真正成为你的"搭档"，而不仅仅是"工具"。

---

## 相关阅读

- [Claude Agent SDK 实战：Anthropic 官方 Agent 开发框架](/categories/架构/2026-06-07-Claude-Agent-SDK-实战-Anthropic官方Agent开发框架-MCP原生集成/)
- [AI Pair Programming 评估实战：Copilot vs Cursor vs Claude Code](/categories/架构/2026-06-05-AI-Pair-Programming-Copilot-Cursor-Claude-Code-评估实战/)
- [AI Agent Context Window 管理实战](/categories/架构/2026-06-06-AI-Agent-Context-Window-管理实战-对话裁剪-摘要压缩-滑动窗口策略/)
