---
title: 2026 年主流 AI Agent 框架深度对比：Hermes Agent vs Claude Code vs Codex vs Cline vs Goose
keywords: [AI Agent, Hermes Agent vs Claude Code vs Codex vs Cline vs Goose, 年主流, 框架深度对比, AI, 工程化]
date: 2026-05-31 14:00:00
categories:
  - ai
  - engineering
tags:
  - AI Agent
  - Hermes Agent
  - Claude Code
  - Codex
  - cline
  - goose
  - 开发者工具
description: 2026 年 AI Agent 框架深度对比评测，涵盖 Hermes Agent、Claude Code、Codex、Cline、Goose、OpenHands、Aider、Continue 八大主流框架，从架构设计、记忆系统、安全模型、多渠道支持、模型兼容性等核心维度进行全面横向对比，附实战代码示例与选型指南，帮助开发者快速找到最适合团队的 AI 编程助手。
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - /images/content/ai-001-content-1.jpg
  - /images/content/ai-001-content-2.jpg
  - /images/diagrams/ai-001-diagram.jpg
---

## 引言

2026 年，AI Agent 已经从概念验证走向了工程实践。开发者不再满足于简单的代码补全，而是需要能够理解整个代码库、执行复杂任务、跨会话记忆的智能助手。

本文将深度评测 2026 年主流的 AI Agent 框架，包括：

- **Hermes Agent** —— Nous Research 出品的自托管 AI Agent
- **Claude Code** —— Anthropic 的终端编码助手
- **OpenAI Codex** —— OpenAI 的本地编码 Agent
- **Cline** —— 开源的 IDE/终端编码 Agent
- **Goose** —— Linux 基金会旗下的通用 AI Agent
- **OpenHands** —— 社区驱动的 AI 开发平台
- **Aider** —— 专注代码编辑的 AI 助手
- **Continue** —— CI/CD 集成的 AI 检查工具

---

![AI Agent 框架全景](/images/content/ai-001-content-1.jpg)

## 评测维度

| 维度 | 权重 | 说明 |
|------|------|------|
| 架构设计 | 20% | 自托管 vs 云原生、扩展性、部署方式 |
| 记忆系统 | 20% | 跨会话记忆、长期学习、上下文管理 |
| 安全模型 | 15% | 凭证隔离、数据隐私、权限控制 |
| 多渠道支持 | 15% | CLI、IDE、Web、消息平台集成 |
| 模型兼容性 | 10% | 支持的 LLM 提供商数量 |
| 社区生态 | 10% | GitHub Stars、插件/技能市场 |
| 易用性 | 10% | 安装复杂度、学习曲线 |

---

## 1. Hermes Agent

**GitHub**: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
**GitHub Stars**: 15k+
**许可证**: MIT

### 核心特点

Hermes Agent 是 Nous Research 推出的自托管 AI Agent 框架，专为希望完全控制模型、记忆和部署的开发者设计。

**架构设计**：
- 完全自托管，无外部服务依赖
- 支持本地、Docker、SSH、Singularity、Modal、Daytona 六种终端后端
- 内置 Cron 调度器，支持定时任务

**记忆系统**：
- 内置学习循环：从经验中创建技能，使用中改进技能
- FTS5 会话搜索，支持跨会话回忆
- Honcho 辩证用户建模
- 自主技能创建和持久化

**安全模型**：
- 凭证完全在本地，不经过第三方服务
- 开源透明，可审计

**多渠道支持**：
- CLI、Telegram、Discord、Slack、WhatsApp、Signal、Email
- 统一网关进程管理

**模型兼容性**：
- 支持 Nous Portal、OpenRouter（200+ 模型）、NovitaAI、NVIDIA NIM、Xiaomi MiMo、z.ai/GLM、Kimi/Moonshot、MiniMax、Hugging Face、OpenAI 等

### 代码示例

```bash
# 安装
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 启动
hermes

# 配置模型
hermes model

# 启动消息网关
hermes gateway start
```

### 适用场景

- 需要完全控制 AI 基础设施的团队
- 对数据隐私有严格要求的企业
- 希望深度定制 Agent 行为的开发者

---

## 2. Claude Code

**GitHub**: [anthropics/claude-code](https://github.com/anthropics/claude-code)
**提供商**: Anthropic
**许可证**: 商业（需订阅）

### 核心特点

Claude Code 是 Anthropic 推出的 AI 编码助手，深度集成 Claude 模型，提供终端、IDE、桌面应用、Web 等多种使用方式。

**架构设计**：
- 云端处理，本地 CLI/IDE 集成
- 支持 VS Code、JetBrains、桌面应用、Web
- 内置 Routines 定时任务

**记忆系统**：
- CLAUDE.md 文件存储项目特定指令
- 自动记忆功能
- 跨会话上下文保持

**安全模型**：
- Anthropic 的 Constitutional AI 方法
- 数据使用政策透明
- 支持第三方提供商集成

**多渠道支持**：
- 终端 CLI、VS Code、JetBrains、桌面应用、Web
- GitHub Actions、GitLab CI/CD 集成
- Slack、Telegram、Discord 集成

**模型兼容性**：
- 主要使用 Claude 系列模型
- 支持第三方提供商（通过配置）

### 代码示例

```bash
# 安装
curl -fsSL https://claude.ai/install.sh | bash

# 启动
cd your-project
claude

# 在 VS Code 中使用
# 安装扩展：Claude Code
```

### 适用场景

- 已在使用 Claude 模型的团队
- 需要深度 IDE 集成的开发者
- 希望开箱即用的用户

---

## 3. OpenAI Codex

**GitHub**: [openai/codex](https://github.com/openai/codex)
**提供商**: OpenAI
**许可证**: Apache 2.0

### 核心特点

Codex 是 OpenAI 推出的编码 Agent，支持本地 CLI、IDE 和桌面应用，可与 ChatGPT 订阅集成。

**架构设计**：
- 本地 CLI 运行
- 支持 VS Code、Cursor、Windsurf 等 IDE
- 桌面应用体验

**记忆系统**：
- 基于会话的上下文
- 项目级配置

**安全模型**：
- 本地运行，代码不离开设备
- 支持 ChatGPT 订阅或 API Key

**多渠道支持**：
- 终端 CLI
- IDE 集成（VS Code、Cursor、Windsurf）
- 桌面应用

**模型兼容性**：
- 主要使用 OpenAI 模型
- 支持 ChatGPT Plus/Pro/Business/Edu/Enterprise 订阅

### 代码示例

```bash
# 安装
curl -fsSL https://chatgpt.com/codex/install.sh | sh

# 启动
codex

# 使用 ChatGPT 订阅
codex  # 选择 "Sign in with ChatGPT"
```

### 适用场景

- 已有 ChatGPT 订阅的用户
- 偏好 OpenAI 模型的开发者
- 需要快速上手的场景

---

## 4. Cline

**GitHub**: [cline/cline](https://github.com/cline/cline)
**GitHub Stars**: 30k+
**许可证**: Apache 2.0

### 核心特点

Cline 是一个开源的编码 Agent，支持 IDE、CLI 和 Kanban 看板，提供多 Agent 协作能力。

**架构设计**：
- 开源，支持自托管
- CLI、VS Code 扩展、JetBrains 插件
- Kanban 看板支持多 Agent 并行
- SDK 可编程扩展

**记忆系统**：
- .clinerules 文件定义项目规则
- Skills 系统支持按需加载规则
- 团队状态跨会话持久化

**安全模型**：
- 本地运行
- 人类在环审批机制
- 自动批准可配置

**多渠道支持**：
- CLI、VS Code、JetBrains
- Kanban 看板
- Slack、Telegram、Discord、Google Chat、WhatsApp、Linear

**模型兼容性**：
- Anthropic、OpenAI、Google、OpenRouter（200+ 模型）
- AWS Bedrock、Azure、GCP Vertex
- Ollama/LM Studio 本地模型

### 代码示例

```bash
# 安装 CLI
npm i -g cline

# 安装 Kanban
npm i -g kanban

# 启动
cline

# 多 Agent 团队
cline --team-name auth-sprint "Plan and implement user authentication with tests"

# 定时任务
cline schedule create "PR summary" \
  --cron "0 9 * * MON-FRI" \
  --prompt "List all open PRs and their review status" \
  --workspace /path/to/repo
```

### 适用场景

- 需要多 Agent 协作的团队
- 希望 IDE 深度集成的开发者
- 需要 Kanban 看板管理的项目

---

## 5. Goose

**GitHub**: [block/goose](https://github.com/block/goose) → [aaif-goose/goose](https://github.com/aaif-goose/goose)
**GitHub Stars**: 15k+
**许可证**: Apache 2.0

### 核心特点

Goose 是 Linux 基金会旗下 Agentic AI Foundation (AAIF) 的通用 AI Agent，使用 Rust 构建，支持桌面应用、CLI 和 API。

**架构设计**：
- Rust 构建，高性能跨平台
- 桌面应用（macOS、Linux、Windows）
- CLI 和 API
- MCP 协议支持 70+ 扩展

**记忆系统**：
- 基于会话的上下文
- MCP 扩展可增强记忆能力

**安全模型**：
- 本地运行
- 开源透明

**多渠道支持**：
- 桌面应用、CLI、API
- 支持 15+ 提供商

**模型兼容性**：
- Anthropic、OpenAI、Google、Ollama、OpenRouter、Azure、Bedrock 等
- 支持 Claude、ChatGPT、Gemini 订阅

### 代码示例

```bash
# 安装 CLI
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash

# 启动
goose
```

### 适用场景

- 偏好 Rust 生态的开发者
- 需要跨平台桌面应用的用户
- 希望使用 MCP 扩展的场景

---

## 6. OpenHands

**GitHub**: [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)
**GitHub Stars**: 40k+
**许可证**: MIT（核心）/ 商业（企业版）

### 核心特点

OpenHands 是社区驱动的 AI 开发平台，提供 SDK、CLI、本地 GUI 和云服务。

**架构设计**：
- SDK 可组合 Python 库
- CLI、本地 GUI、云服务
- 支持 Kubernetes 自托管

**记忆系统**：
- 基于会话的上下文
- Theory-of-Mind 模块

**安全模型**：
- 开源透明
- 企业版支持 VPC 自托管

**多渠道支持**：
- CLI、本地 GUI、云服务
- Slack、Jira、Linear 集成

**模型兼容性**：
- Claude、GPT 及其他 LLM
- Minimax 模型（免费试用）

### 代码示例

```bash
# 使用 CLI
pip install openhands-cli
openhands

# 使用 Docker
docker run -it --pull always \
  -e SANDBOX_RUNTIME_CONTAINER_IMAGE=docker.all-hands.dev/all-hands-ai/runtime:0.29-nikolaik \
  -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  --name openhands-app \
  docker.all-hands.dev/all-hands-ai/openhands:0.29
```

### 适用场景

- 需要 Python SDK 集成的团队
- 希望使用云服务的用户
- 需要企业级支持的组织

---

## 7. Aider

**官网**: [aider.chat](https://aider.chat)
**许可证**: Apache 2.0

### 核心特点

Aider 是专注代码编辑的 AI 助手，支持 100+ 编程语言，可连接多种 LLM。

**架构设计**：
- 终端 CLI
- 专注代码编辑

**记忆系统**：
- 基于会话的上下文

**安全模型**：
- 本地运行

**多渠道支持**：
- 终端 CLI

**模型兼容性**：
- Claude 3.7 Sonnet、DeepSeek R1 & Chat V3、OpenAI o1/o3-mini/GPT-4o
- 支持本地模型

### 适用场景

- 专注代码编辑的场景
- 需要支持多种语言的开发者
- 偏好轻量级工具的用户

---

## 8. Continue

**GitHub**: [continuedev/continue](https://github.com/continuedev/continue)
**许可证**: Apache 2.0

### 核心特点

Continue 是 CI/CD 集成的 AI 检查工具，可在 Pull Request 中运行 AI 检查。

**架构设计**：
- 源码控制的 AI 检查
- GitHub 状态检查集成
- CLI 和 VS Code 扩展

**记忆系统**：
- .continue/checks/ 目录存储检查规则

**安全模型**：
- 本地运行
- 源码控制透明

**多渠道支持**：
- CLI、VS Code
- GitHub Actions

**模型兼容性**：
- 支持多种 LLM

### 代码示例

```bash
# 安装 CLI
curl -fsSL https://raw.githubusercontent.com/continuedev/continue/main/extensions/cli/scripts/install.sh | bash

# 创建检查规则
cat > .continue/checks/security-review.md << 'EOF'
---
name: Security Review
description: Review PR for basic security vulnerabilities
---
Review this PR and check that:
  - No secrets or API keys are hardcoded
  - All new API endpoints have input validation
  - Error responses use the standard error format
EOF

# 运行检查
cn
```

### 适用场景

- 需要 CI/CD 集成的团队
- 希望自动化代码审查的项目
- 重视代码质量的组织

---

## 完整对比表

| 框架 | 架构 | 记忆系统 | 安全模型 | 多渠道 | 模型兼容性 | 社区 | 易用性 | 综合评分 |
|------|------|----------|----------|--------|------------|------|--------|----------|
| **Hermes Agent** | 自托管 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 88/100 |
| **Claude Code** | 云+本地 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 85/100 |
| **Codex** | 本地 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 78/100 |
| **Cline** | 本地 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 86/100 |
| **Goose** | 本地 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 80/100 |
| **OpenHands** | 本地/云 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 82/100 |
| **Aider** | 本地 | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 72/100 |
| **Continue** | 本地 | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | 74/100 |

---

## 如何选择？

### 选择 Hermes Agent 如果你...

- 需要完全控制 AI 基础设施
- 对数据隐私有严格要求
- 希望深度定制 Agent 行为
- 需要多渠道消息集成（Telegram、Discord、微信等）

### 选择 Claude Code 如果你...

- 已在使用 Claude 模型
- 需要深度 IDE 集成
- 希望开箱即用
- 需要 Routines 定时任务

### 选择 Codex 如果你...

- 已有 ChatGPT 订阅
- 偏好 OpenAI 模型
- 需要快速上手

### 选择 Cline 如果你...

- 需要多 Agent 协作
- 希望 IDE 深度集成
- 需要 Kanban 看板管理
- 希望使用 SDK 扩展

### 选择 Goose 如果你...

- 偏好 Rust 生态
- 需要跨平台桌面应用
- 希望使用 MCP 扩展

### 选择 OpenHands 如果你...

- 需要 Python SDK 集成
- 希望使用云服务
- 需要企业级支持

### 选择 Aider 如果你...

- 专注代码编辑
- 需要支持多种语言
- 偏好轻量级工具

### 选择 Continue 如果你...

- 需要 CI/CD 集成
- 希望自动化代码审查
- 重视代码质量

---

## 2026 年 AI Agent 发展趋势

### 1. 从代码补全到自主执行

2026 年的 AI Agent 不再只是补全代码，而是能够理解整个项目、执行复杂任务、自动修复错误。

### 2. 多 Agent 协作成为标配

Cline 的 Kanban 看板、OpenHands 的多 Agent 团队，都体现了这一趋势。

### 3. 记忆系统深度进化

Hermes Agent 的学习循环、Claude Code 的 CLAUDE.md，都在探索如何让 Agent 真正"记住"用户。

### 4. MCP 协议成为标准

Model Context Protocol (MCP) 正在成为 AI Agent 扩展的标准协议，Goose、Cline 等都已支持。

### 5. 自托管 vs 云服务的选择

企业级用户更倾向自托管（Hermes Agent），个人开发者更偏好云服务（Claude Code、Codex）。

---

## 总结

2026 年的 AI Agent 生态已经相当成熟，每个框架都有其独特的优势：

- **Hermes Agent** 是最灵活的自托管方案
- **Claude Code** 是最易用的商业方案
- **Cline** 是最强大的开源方案
- **Codex** 是最快速的入门方案

选择哪个框架，取决于你的具体需求：数据隐私、模型偏好、集成需求、团队规模。

**我的建议**：先从 Claude Code 或 Codex 开始体验，如果需要更多控制，再考虑 Hermes Agent 或 Cline。

---

## 实战踩坑与快速上手指南

### 通用坑点速查

| 框架 | 常见坑点 | 解决方案 |
|------|----------|----------|
| Hermes Agent | Gateway 启动后无法收到 Telegram 消息 | 检查 `HERMES_TELEGRAM_TOKEN` 环境变量是否在 `.env` 中正确设置，确认 Bot 已通过 `/setprivacy` 关闭隐私模式 |
| Claude Code | CLAUDE.md 指令被忽略 | 确认文件位于项目根目录，且指令格式为自然语言（非 YAML）；复杂规则拆分为多条短指令 |
| Codex | `codex` 命令找不到 | 需要 Node.js 18+，安装后重启终端；macOS 上可能需要 `npx codex` |
| Cline | Kanban 多 Agent 并行时任务互相覆盖 | 为每个 Agent 使用独立的 `--workspace` 参数，避免共享同一工作目录 |
| Goose | MCP 扩展安装后不生效 | 确认 `goose.yaml` 中扩展路径正确，重启 CLI 后检查 `goose extensions list` |
| OpenHands | Docker 容器启动后端口 3000 被占用 | 修改 `-p 3001:3000` 映射，或停止占用该端口的进程 |
| Aider | 生成的 diff 包含意外删除 | 使用 `--auto-commits` 关闭自动提交，手动 review 后再 commit |
| Continue | GitHub Actions 中检查规则不执行 | 确认 `.continue/checks/` 目录已提交到仓库，且 Action 权限包含 `checks: write` |

### 最小可运行示例：5 分钟评估一个 AI Agent

以下脚本帮助你快速评估任意框架是否适合你的项目：

```bash
#!/bin/bash
# ai-agent-eval.sh — 快速评估 AI Agent 框架
# 用法: bash ai-agent-eval.sh <框架名>

FRAMEWORK=${1:-"hermes"}
PROJECT_DIR=$(pwd)

echo "=== AI Agent 快速评估 ==="
echo "框架: $FRAMEWORK"
echo "项目目录: $PROJECT_DIR"
echo ""

# 1. 检查安装状态
case $FRAMEWORK in
  hermes)
    command -v hermes >/dev/null 2>&1 && echo "✅ Hermes Agent 已安装" || echo "❌ 未安装: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
    ;;
  claude)
    command -v claude >/dev/null 2>&1 && echo "✅ Claude Code 已安装" || echo "❌ 未安装: curl -fsSL https://claude.ai/install.sh | bash"
    ;;
  codex)
    command -v codex >/dev/null 2>&1 && echo "✅ Codex 已安装" || echo "❌ 未安装: npm install -g @openai/codex"
    ;;
  cline)
    command -v cline >/dev/null 2>&1 && echo "✅ Cline 已安装" || echo "❌ 未安装: npm i -g cline"
    ;;
  *)
    echo "⚠️  未知框架: $FRAMEWORK (支持: hermes/claude/codex/cline)"
    ;;
esac

# 2. 项目复杂度评估
FILE_COUNT=$(find "$PROJECT_DIR" -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.go' -o -name '*.rs' | wc -l | tr -d ' ')
TOTAL_LINES=$(find "$PROJECT_DIR" -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.go' -o -name '*.rs' -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')

echo ""
echo "=== 项目信息 ==="
echo "源文件数: $FILE_COUNT"
echo "总行数: ${TOTAL_LINES:-0}"
echo ""

# 3. 推荐
if [ "${TOTAL_LINES:-0}" -lt 5000 ]; then
  echo "📌 推荐: Claude Code 或 Codex（轻量项目开箱即用）"
elif [ "${TOTAL_LINES:-0}" -lt 50000 ]; then
  echo "📌 推荐: Cline 或 Hermes Agent（中型项目需要记忆和多 Agent）"
else
  echo "📌 推荐: Hermes Agent（大型项目需要完全控制和自托管）"
fi
```

```bash
# 运行评估
chmod +x ai-agent-eval.sh
bash ai-agent-eval.sh hermes
```

### 各框架 API 集成代码示例

```python
"""ai_agent_integration.py — 多框架统一调用示例"""
import subprocess, json, os

class AIAgentRunner:
    """统一调用不同 AI Agent CLI 的封装"""

    @staticmethod
    def run_hermes(prompt: str, model: str = "default") -> str:
        """调用 Hermes Agent"""
        env = os.environ.copy()
        env["HERMES_MODEL"] = model
        result = subprocess.run(
            ["hermes", "run", prompt],
            capture_output=True, text=True, env=env, timeout=120
        )
        return result.stdout

    @staticmethod
    def run_claude(prompt: str) -> str:
        """调用 Claude Code"""
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True, text=True, timeout=120
        )
        return result.stdout

    @staticmethod
    def run_codex(prompt: str) -> str:
        """调用 OpenAI Codex"""
        result = subprocess.run(
            ["codex", "--quiet", prompt],
            capture_output=True, text=True, timeout=120
        )
        return result.stdout

    @staticmethod
    def benchmark(prompt: str, frameworks: list[str] = None) -> dict:
        """对多个框架运行同一 prompt 并对比结果"""
        frameworks = frameworks or ["hermes", "claude", "codex"]
        results = {}
        for fw in frameworks:
            try:
                method = getattr(AIAgentRunner, f"run_{fw}")
                output = method(prompt)
                results[fw] = {"success": True, "output": output[:500]}
            except Exception as e:
                results[fw] = {"success": False, "error": str(e)}
        return results


if __name__ == "__main__":
    prompt = "Write a Python function to validate an email address"
    runner = AIAgentRunner()
    comparison = runner.benchmark(prompt, ["hermes", "claude", "codex"])
    print(json.dumps(comparison, indent=2, ensure_ascii=False))
```

---

## 相关资源

- [Hermes Agent 官方文档](https://hermes-agent.nousresearch.com/docs/)
- [Claude Code 官方文档](https://code.claude.com/docs/en/overview)
- [Codex 官方文档](https://developers.openai.com/codex)
- [Cline 官方文档](https://docs.cline.bot/)
- [Goose 官方文档](https://goose-docs.ai/)
- [OpenHands 官方文档](https://docs.openhands.dev/)
- [Aider 官网](https://aider.chat)
- [Continue 官方文档](https://docs.continue.dev/)

---

**下一篇文章**：我将深入评测 Hermes Agent 的实际使用体验，展示如何搭建完全自托管的 AI 助手系统。关注我不错过。

---

## 相关阅读

- [AI Agent 记忆系统设计：短期记忆、长期记忆、RAG 与向量数据库实战](/2026/06/01/ai-agent-memory-system-design-short-long-term-rag-vector-db/) — 深入解析 Agent 记忆架构的工程实现
- [AI Agent 编排模式：ReAct、Plan-and-Execute、Multi-Agent 协作](/2026/05/31/ai-agent-orchestration-patterns-react-plan-execute-multi-agent/) — 掌握主流 Agent 编排范式与协作策略
- [MCP 协议深度解析：Model Context Protocol 如何统一 AI Agent 工具标准](/2026/06/01/mcp-model-context-protocol-ai-agent-tool-standardization/) — 了解 MCP 如何改变 Agent 扩展生态
