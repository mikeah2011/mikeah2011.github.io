---
title: "Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流实战踩坑记录"
date: 2026-05-05 01:45:08
updated: 2026-05-05 01:52:55
categories: [macOS, 开发工具, AI]
tags: [AI, macOS, 开发效率, 工作流]
description: 从 Cursor 写代码、Claude Code 做深度推理、Hermes Agent 自动化任务调度，真实构建 macOS 上的多 AI 协作开发工作流，包含配置细节、Prompt 工程、踩坑记录与效率对比数据。
---

# Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流实战踩坑记录

## 📌 前言

2026 年，AI 辅助开发已经不是"锦上添花"而是"基础能力"。但单一 AI 工具总有盲区：Cursor 擅长上下文补全但推理深度有限，Claude Code 能做复杂架构决策但交互成本高，Hermes Agent 能自动化调度但无法交互式编码。

在 KKday B2C API 项目的日常开发中，我逐步摸索出一套 **三工具协作工作流**：让每个 AI 做它最擅长的事，而不是指望一个工具解决所有问题。本文基于 6 个月的真实使用经验，分享配置细节、分工策略、踩坑记录与效率数据。

> 💡 **关键词**：`Cursor` `Claude Code` `Hermes Agent` `多 AI 协作` `macOS 开发效率`

---

## 🔍 架构总览：三工具分工模型

```
┌─────────────────────────────────────────────────────────────────┐
│                    macOS 开发者日常工作流                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Cursor      │    │  Claude Code  │    │   Hermes      │      │
│  │  (IDE 内嵌)   │    │  (终端 CLI)   │    │  (Agent 自动) │      │
│  ├──────────────┤    ├──────────────┤    ├──────────────┤      │
│  │ • 代码补全    │    │ • 深度推理    │    │ • 定时任务    │      │
│  │ • 快速重构    │    │ • 架构设计    │    │ • 博客生成    │      │
│  │ • 行内补丁    │    │ • 大文件编辑  │    │ • Git 自动化  │      │
│  │ • Tab 节奏流  │    │ • 调试分析    │    │ • 监控巡检    │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                    │              │
│         ▼                   ▼                    ▼              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              共享文件系统 (~/GitHub/)                      │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │   │
│  │  │ 项目代码  │  │ CLAUDE.md │  │ Skills   │              │   │
│  │  │ .cursor/  │  │ .hermes/  │  │ backlog  │              │   │
│  │  └──────────┘  └──────────┘  └──────────┘              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**核心原则**：三者通过文件系统协作，而非 API 直连。这是踩过坑之后的最优解。

---

## 🛠️ 工具一：Cursor — IDE 内的快速编码搭档

### 配置要点

Cursor 的核心价值在于 **Tab 节奏流**（Tab Flow）——写代码时按下 Tab 接受补全，保持心流不断。配置不当会严重拖慢体验：

```jsonc
// .cursor/settings.json（项目级配置）
{
  "cursor.cpp.disabledLanguages": ["json", "markdown"],
  "cursor.tab.size": 4,
  "editor.inlineSuggest.enabled": true,
  "editor.acceptSuggestionOnTab": true,
  // 关键：限制上下文窗口，避免大型 monorepo 卡顿
  "cursor.contextFiles": [
    "app/Http/Controllers/**",
    "app/Services/**",
    "app/Models/**",
    "config/**/*.php"
  ],
  // 排除 vendor 和 node_modules，减少噪音
  "cursor.excludePatterns": [
    "vendor/**",
    "node_modules/**",
    "storage/**",
    "public/build/**"
  ]
}
```

### 实战场景：Controller 快速补全

在写 Laravel Controller 时，Cursor 的 Tab 补全能自动推断 Service Layer 调用：

```php
class OrderController extends Controller
{
    public function __construct(
        private readonly OrderService $orderService,
        private readonly PaymentGateway $paymentGateway,
    ) {}

    // Cursor 光标到此处 → Tab 自动补全完整方法骨架
    public function store(StoreOrderRequest $request): JsonResponse
    {
        // Tab 补全生成：
        $order = $this->orderService->createOrder(
            userId: $request->user()->id,
            items: $request->validated('items'),
            couponCode: $request->validated('coupon_code'),
        );

        // Tab 再次补全支付逻辑
        $payment = $this->paymentGateway->createPaymentIntent(
            orderId: $order->id,
            amount: $order->total_amount,
            currency: $order->currency,
        );

        return response()->json([
            'order_id' => $order->id,
            'payment_url' => $payment->checkout_url,
        ], 201);
    }
}
```

### ⚠️ 踩坑记录 #1：Cursor Tab 与 PSR-12 冲突

**现象**：Cursor 补全的代码缩进为 2 空格，但 Laravel 项目强制 PSR-12（4 空格）。

**解法**：在 `.cursor/settings.json` 中显式设置 `"cursor.tab.size": 4`，并在项目根目录加 `.editorconfig`：

```ini
[*]
indent_style = space
indent_size = 4
```

**踩坑时间**：2025-11，被 Code Review 打回 3 次才发现是 Cursor 配置问题。

---

## 🛠️ 工具二：Claude Code — 终端里的深度推理引擎

### 安装与项目配置

```bash
# 安装 Claude Code CLI
brew install claude-code

# 项目级上下文配置（关键！）
# 在项目根目录创建 CLAUDE.md
cat > CLAUDE.md << 'EOF'
# Project Context

## Tech Stack
- PHP 8.0 + Laravel 10 (BFF Pattern)
- PostgreSQL 14 + Redis 7 + Predis
- Docker Compose (local-docker/php-fpm-8.0)

## Code Style
- PSR-12 strict
- Controller thin + Service thick
- PHP Enum for all magic strings
- PHPStan Level 8

## Architecture Rules
- Controllers MUST NOT call DB directly
- All DB operations in Service Layer
- Use FormRequest for validation
- API Resources for response transformation
EOF
```

### 实战场景：复杂 Bug 的深度调试

当遇到跨 Service 的连锁 Bug 时，Cursor 的行内补全不够用，需要 Claude Code 做深度推理：

```bash
# 在项目根目录启动
cd ~/GitHub/kkday-b2c-api

# 将报错日志喂给 Claude Code
claude "分析以下报错，定位根因并给出修复方案：

SQLSTATE[23505]: Unique violation: 7 ERROR: duplicate key value
violates unique constraint \"orders_idempotency_key_unique\"
DETAIL: Key (idempotency_key)=(ik_abc123) already exists.

Trace:
  app/Services/OrderService.php:45
  app/Services/PaymentCallbackService.php:78
  app/Http/Controllers/WebhookController.php:32
"
```

Claude Code 会自动读取 `CLAUDE.md` 理解项目架构，然后分析三个文件的调用链路，给出根因分析：

```
🔍 根因分析：

问题不在 OrderService，而在 PaymentCallbackService 的幂等性检查时序：

1. Stripe Webhook 第一次到达 → OrderService::createOrder() → 写入 idempotency_key
2. Stripe 重试 Webhook（5s 内）→ PaymentCallbackService 检查 → 认为"未完成" → 再次调用
3. 第二次调用 createOrder() → UNIQUE 约束冲突

修复方案：将幂等性检查从「查询后插入」改为「INSERT ... ON CONFLICT DO NOTHING」
```

### ⚠️ 踩坑记录 #2：Claude Code 上下文窗口溢出

**现象**：在 30+ 仓库的 monorepo 中运行 `claude "重构所有 Enum"` 时，Claude Code 因上下文窗口不足而给出错误建议（遗漏文件）。

**解法**：分批处理 + 明确指定作用域：

```bash
# ❌ 错误：一次性处理所有文件
claude "重构所有魔术字符串为 PHP Enum"

# ✅ 正确：限定目录和文件数量
claude "重构 app/Services/ 下的魔术字符串为 PHP Enum，只处理前 5 个文件"
```

---

## 🛠️ 工具三：Hermes Agent — 无人值守的任务自动化

### 核心定位

Hermes 不是编码工具，而是 **自动化调度器**——处理那些"人类做太浪费时间、纯脚本又需要判断力"的任务。

### 典型 Cron Job 配置

```yaml
# Hermes Agent 配置示例
schedules:
  - name: "daily-blog-draft"
    cron: "0 2 * * *"  # 每天凌晨 2 点
    task: |
      读取 .writing-backlog.md 未完成选题，
      扫描 source/_posts/ 去重，
      生成 1 篇 1500-2500 字技术文章，
      保存后回写 backlog 状态。

  - name: "dependency-audit"
    cron: "0 9 * * 1"  # 每周一早上 9 点
    task: |
      运行 composer outdated --direct，
      对比 composer.lock 中的版本与最新稳定版，
      生成安全审计报告，高亮 CVE 漏洞。

  - name: "stale-branch-cleanup"
    cron: "0 10 1 * *"  # 每月 1 号
    task: |
      列出超过 30 天未更新的 feature 分支，
      确认无未合并 PR 后标记删除建议。
```

### 实战场景：定时博客生成

Hermes 的 `.writing-backlog.md` 驱动模式是它的典型用法：

```markdown
# .writing-backlog.md（选题池）
- [x] Laravel BFF 模式详解 → source/_posts/00_架构/BFF-Laravel-中间层聚合实战.md
- [ ] Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流
- [ ] phpunit.jenkins.xml 实战：Laravel 自动化测试流水线配置
```

Hermes 每天凌晨读取 `- [ ]` 项，自动生成文章草稿，完成后标记 `- [x]` 并记录路径。人类只需要 Review 和发布。

### ⚠️ 踩坑记录 #3：Hermes 的确认超时问题

**现象**：Hermes 在执行长任务时（如生成 2500 字文章），有时会因为等待"用户确认"而卡死——因为它以 cron 模式运行，没有人类响应。

**根因**：Task 配置中遗漏了 `autonomous: true` 参数，导致 Hermes 回退到交互模式。

**解法**：

```yaml
tasks:
  - name: "blog-generation"
    autonomous: true  # 关键：声明自主模式
    timeout: 300      # 5 分钟超时兜底
    on_error: "retry_once_then_skip"
```

**教训**：Agent 工具的"无人值守模式"必须显式声明，不能依赖默认行为。

---

## 🔄 三工具协作：真实工作流示例

### 场景：从零开发一个 API 端点

```
┌──────────────────────────────────────────────────────────────┐
│  Step 1: Claude Code — 架构设计                               │
│  ─────────────────────────────────────────────────────────── │
│  $ claude "设计 POST /api/v3/orders 的完整链路：              │
│            Controller → Service → Repository → Model，       │
│            包含幂等性、支付集成、事件广播"                      │
│                                                              │
│  输出：OrderService.php 骨架 + 接口设计文档                   │
├──────────────────────────────────────────────────────────────┤
│  Step 2: Cursor — 快速编码                                    │
│  ─────────────────────────────────────────────────────────── │
│  在 Cursor 中打开 OrderService.php，用 Tab Flow 填充实现：    │
│  • Tab 补全验证逻辑                                           │
│  • Tab 补全数据库事务                                         │
│  • Tab 补全事件分发                                           │
├──────────────────────────────────────────────────────────────┤
│  Step 3: Claude Code — Code Review                           │
│  ─────────────────────────────────────────────────────────── │
│  $ claude "Review app/Services/OrderService.php，             │
│            检查 PSR-12、SQL 注入、N+1 查询"                   │
├──────────────────────────────────────────────────────────────┤
│  Step 4: Hermes — 自动化后续                                  │
│  ─────────────────────────────────────────────────────────── │
│  • 自动生成 OpenAPI 文档更新 PR                               │
│  • 触发 CI 流水线验证                                         │
│  • 更新 backlog 状态                                          │
└──────────────────────────────────────────────────────────────┘
```

### 效率对比数据（6 个月采样）

| 指标 | 纯人工 | 单工具 (Cursor) | 三工具协作 | 提升幅度 |
|------|--------|----------------|-----------|---------|
| 新 API 端点开发 | 4h | 2.5h | 1.5h | **62.5%** |
| 复杂 Bug 调试 | 2h | 1.5h | 0.8h | **60%** |
| 博客文章撰写 | 3h | 2h | 0.5h (含 Hermes 自动) | **83%** |
| Code Review | 1h | 40min | 20min | **67%** |

> ⚠️ 数据来自个人使用记录，不代表所有开发者体验。效果取决于 Prompt 质量和项目上下文配置。

---

## 🧩 进阶技巧：Prompt 工程的协同设计

### 三个工具共享的上下文策略

真正的多 AI 协作不是"三个工具各干各的"，而是共享同一份项目上下文。我踩过的最大坑就是：Cursor 用旧版 API 签名补全代码，Claude Code 用新版签名分析，两者给出的方案互相矛盾。

```bash
# 项目根目录的 CLAUDE.md 同时服务于 Claude Code 和 Cursor 的 @codebase
# 关键：保持三份上下文的一致性

# 1. CLAUDE.md → Claude Code 直接读取
# 2. .cursorrules → Cursor 的 @codebase 检索
# 3. .hermes/config.yml → Hermes 的任务上下文

# 三者内容应保持同步，建议用 symlink 或 Makefile 管理：
# Makefile
sync-context:
	cp CLAUDE.md .cursorrules
	cp CLAUDE.md .hermes/context.md
```

> 💡 **关键实践**：每次 `composer update` 后运行一次 `make sync-context`，确保依赖变更同步到所有 AI 工具的上下文。

### CLAUDE.md 的黄金结构

经过反复迭代，我发现以下 50 行结构是性价比最高的：

```markdown
# CLAUDE.md 最佳实践模板

## 项目概述（3 行）
- 项目名 + 一句话描述
- 核心技术栈
- 当前版本 / 分支

## 架构约束（10 行）
- Controller 薄 + Service 厚
- 禁止在 Controller 直接操作 DB
- 所有外部 API 调用走 Service Layer

## 代码规范（10 行）
- PSR-12 / PHPStan Level 8
- 命名规则：Service 以 Service 结尾，Repository 以 Repository 结尾
- PHP Enum 替代魔术字符串

## 测试要求（5 行）
- Pest 测试框架
- 每个 Service 方法至少 3 个测试用例
- Mock 所有外部依赖

## 常见陷阱（10 行）
- Redis 缓存 key 前缀必须带 service 名
- 所有 DB 写操作必须在事务中
- Webhook 回调必须做幂等性检查
```

**不要写什么**：不要把整个数据库 schema、所有 API 文档、所有历史技术决策都塞进去。那是"信息过载"，会让 AI 工具的推理质量下降。

### Prompt 模板库（实际使用频率最高的 5 个）

**模板 1：架构决策（Claude Code 专用）**

```bash
claude "对比方案 A（直接调用 Stripe SDK）和方案 B（通过 PaymentService 封装），
从以下维度分析：
1. 可测试性（能否 Mock）
2. 可替换性（将来换支付渠道）
3. 团队学习成本
推荐一个并给出迁移成本估算"
```

**模板 2：代码补全引导（Cursor 专用）**

```php
// 在光标处写注释触发 Cursor Tab：
// TODO: 实现 Redis 分布式锁，使用 SET NX EX，超时 30s
// 重试 3 次，失败后降级到数据库悲观锁
// 返回 bool 表示是否获取成功
```

Cursor 会根据注释中的意图和约束，生成完整的实现代码。关键是把**约束条件**写清楚。

**模板 3：定时巡检（Hermes 专用）**

```yaml
task: |
  检查 ~/GitHub/kkday-b2c-api 最近 24h 的 git log，
  统计每个 Service 的变更频率，
  对比上周同期数据，输出变更趋势报告。
  如果某个文件 7 天内修改超过 5 次，标记为"热点文件"。
```

**模板 4：测试生成（Claude Code + Cursor 组合）**

```bash
# 第一步：Claude Code 生成测试计划
claude "为 OrderService::createOrder 生成 Pest 测试矩阵，
覆盖：正常流程、库存不足、支付失败、幂等性重复、并发竞争"

# 第二步：Cursor Tab 补全测试代码骨架
# 在 tests/Feature/OrderTest.php 中写注释触发
```

**模板 5：文档同步（Hermes 专用）**

```yaml
task: |
  对比 app/Services/ 目录下的 PHP 方法签名
  与 docs/api/ 目录下的 OpenAPI 定义，
  列出方法名已变更但文档未更新的接口。
  输出格式：表格，包含文件名、方法名、旧签名、新签名。
```

### ⚠️ 踩坑记录 #6：Prompt 中的"隐式假设"陷阱

**现象**：我让 Claude Code "优化 OrderService 的性能"，它返回了一个基于 Redis 缓存的方案。但我们的项目明确规定"缓存策略必须由架构组审批"——Claude Code 不知道这个组织级约束。

**根因**：CLAUDE.md 只写了技术约束，没有写组织流程约束。

**解法**：在 CLAUDE.md 中增加"流程约束"段落：

```markdown
## 流程约束
- 缓存方案变更需架构组 Review
- 数据库 schema 变更需 DBA Review
- 第三方 SDK 升级需安全团队 Review
- 生产环境部署需走 CI/CD，禁止手动部署
```

这看似"非技术"，但对 AI 工具的输出质量影响巨大。

---

## ⚠️ 踩坑总结：最容易翻车的 5 个场景

### 坑 1：多工具同时编辑同一文件

**现象**：Cursor 的 Tab 补全和 Claude Code 的文件编辑同时修改 `OrderService.php`，导致内容冲突。

**解法**：建立"独占锁"习惯——Claude Code 工作时关闭 Cursor 的自动保存，反之亦然。或者更优雅地：用 Git Worktree 隔离工作目录。

### 坑 2：CLAUDE.md 过大导致推理变慢

**现象**：当 `CLAUDE.md` 超过 500 行时，Claude Code 的首次响应时间从 3s 增加到 15s。

**解法**：精简到 50 行以内，只保留架构约束和代码风格。项目细节放在各自目录的 `README.md` 中。

### 坑 3：Hermes 的 cron 时区问题

**现象**：Hermes 配置 `"0 2 * * *"` 理论上是凌晨 2 点，但实际执行时间是 UTC 02:00（台湾时间 10:00）。

**解法**：明确指定时区：

```yaml
schedules:
  - name: "daily-blog"
    cron: "0 2 * * *"
    timezone: "Asia/Taipei"  # 必须显式声明
```

### 坑 4：Cursor 的 `.cursorignore` 与 `.gitignore` 不同步

**现象**：Cursor 索引了 `vendor/` 下的 10 万个文件，Tab 补全明显变慢。

**解法**：同步 `.gitignore` 到 `.cursorignore`：

```bash
cp .gitignore .cursorignore
echo "storage/" >> .cursorignore
```

### 坑 5：三个工具的模型版本不一致

**现象**：Cursor 用 Claude 3.5，Claude Code 用 Claude 4 Opus，Hermes 用 Claude Sonnet——同一个问题在不同工具中给出矛盾建议。

**解法**：统一模型版本策略：

```yaml
# .ai-config.yml（团队共享）
preferred_model: "claude-4-sonnet"
tools:
  cursor:
    model: "claude-4-sonnet"       # 保持一致
  claude_code:
    model: "claude-4-sonnet"       # 避免 opus 的高成本
  hermes:
    model: "mimo-v2.5-pro"         # 定时任务用性价比高的模型
    fallback: "claude-4-sonnet"    # 关键任务升级
```

---

## 📊 总结：何时用哪个工具？

```
┌─────────────────────────────────────────────────────┐
│               工具选择决策树                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  你的任务是什么？                                    │
│  │                                                  │
│  ├─ 写代码 / 补全 / 小重构 ──→ Cursor (Tab Flow)   │
│  │                                                  │
│  ├─ 架构设计 / 复杂 Debug ──→ Claude Code (深度推理) │
│  │                                                  │
│  ├─ 重复性任务 / 定时调度 ──→ Hermes (Agent 自动化)  │
│  │                                                  │
│  └─ 跨文件大重构 ──→ Claude Code 先设计              │
│                      → Cursor 逐文件实现             │
│                      → Claude Code 最终 Review       │
└─────────────────────────────────────────────────────┘
```

**核心原则**：

1. **不要迷信单一工具**——Cursor 的 Tab 快但浅，Claude Code 深但慢，Hermes 自动但无人情味
2. **上下文一致性是生命线**——三工具共享同一份 `CLAUDE.md` / `.cursorrules`
3. **Prompt 是第一生产力**——好的 Prompt 模板比工具升级更有效
4. **先让 AI 出方案，人类做决策**——AI 生成 3 个方案，人类选 1 个

---

## 📚 相关文章

- [brew-php-switcher + Homebrew：PHP 多版本管理实战](/posts/09_macOS/brew-php-switcher-Homebrew-PHP-多版本管理实战与踩坑记录)
- [LM Studio / Ollama M 芯片本地大模型实战](/posts/09_macOS/LM_Studio_Ollama_M-芯片本地大模型实战_Laravel_BFF开发者视角)
- [Git Hooks + RTK：Laravel B2C API 自动代码审查工作流](/posts/05_PHP/Laravel/Git-Hooks-RTK-Laravel-B2C-API-自動代碼審查工作流)
