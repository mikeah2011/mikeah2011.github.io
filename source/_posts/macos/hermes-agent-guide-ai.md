---

feature: true
keywords: [Hermes Agent, AI, 多平台, 助手配置与使用, 从零搭建个人, 工作流踩坑记录]
cover: https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/ai-assistant.jpg
images:
  - https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/ai-assistant.jpg
title: Hermes Agent 实战：多平台 AI 助手配置与使用——从零搭建个人 AI 工作流踩坑记录
date: 2026-05-23 10:00:00
categories:
- macos
- tools
tags:
- AI
- DevOps
- macOS
- AI Agent
- Hermes Agent
- LLM
description: 从零搭建 Hermes Agent 多平台 AI 助手的完整实战记录——涵盖 macOS/Linux/WSL 三平台安装配置、多 Provider 接入（OpenAI/Anthropic/Ollama/Xiaomi MiMo）、智能模型路由策略与成本优化、CLI 交互与单次命令模式、Skill 系统项目级与全局级集成、GitHub Actions CI/CD 自动代码审查、数据敏感度分级安全方案、日志审计与隐私保护，以及在 30+ Laravel 仓库中积累的真实踩坑经验与性能对比实测数据。
---



## 前言：为什么需要一个统一的 AI 助手平台？

作为 Laravel B2C 后端开发者，我日常使用的 AI 工具不下 5 个：Cursor 写代码、ChatGPT 查文档、Claude 做 Code Review、GitHub Copilot 补全代码、本地 Ollama 处理敏感数据。问题随之而来：

- **上下文碎片化**：每个工具的记忆独立，切换时要重复交代背景
- **成本不可控**：GPT-4o 一次对话几毛钱，一天下来成本惊人
- **隐私边界模糊**：公司代码该不该发给云端？哪些场景用本地模型？
- **工作流断裂**：AI 生成的内容要手动复制粘贴到各个工具

Hermes Agent 的定位是**统一的 AI 助手中间层**——它不替代底层模型，而是提供一致的接口、工具调用能力、Skill 系统和定时任务调度，让你在不同平台、不同模型之间无缝切换。

这篇文章记录了我在 macOS、Linux 服务器、WSL 三个平台上配置 Hermes Agent 的完整过程，以及在 30+ 个 Laravel 仓库中实际使用的踩坑经验。

---

## 一、架构概览：Hermes Agent 的核心组件

```
┌─────────────────────────────────────────────────┐
│                  Hermes Agent                    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ CLI 交互 │  │ Cron 调度│  │  Skill 系统  │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
│  ┌────▼──────────────▼───────────────▼────────┐  │
│  │           Tool Execution Layer              │  │
│  │  terminal │ read_file │ search │ patch ...  │  │
│  └────────────────┬───────────────────────────┘  │
│                   │                              │
│  ┌────────────────▼───────────────────────────┐  │
│  │          Model Router / Provider            │  │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────────┐ │  │
│  │  │ OpenAI  │ │ Anthropic│ │  Ollama     │ │  │
│  │  │ GPT-4o  │ │ Claude   │ │  Qwen/Llama │ │  │
│  │  └─────────┘ └──────────┘ └─────────────┘ │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

核心设计理念：

1. **Provider 无关**：同一套 Skill 和工作流，换模型只需改一行配置
2. **工具丰富**：内置 terminal、file 操作、search、patch 等工具，Agent 能直接操作文件系统
3. **Skill 注入**：通过 `SKILL.md` 文件按需注入领域知识，避免每次对话重复交代上下文
4. **定时调度**：支持 cron 表达式，Agent 可以定时执行任务

---

## 二、macOS 安装与配置（主力开发机）

### 2.1 安装

```bash
# 通过 pip 安装（推荐 Python 3.11+）
pip install hermes-agent

# 或通过 pipx 隔离安装（推荐，避免依赖冲突）
pipx install hermes-agent

# 验证安装
hermes --version
```

> **踩坑 #1**：macOS 自带的 Python 3.9 版本过低，Hermes Agent 依赖 Python 3.10+ 的 `match` 语法和 `TypeAlias`。建议用 `pyenv` 安装 3.11+：
>
> ```bash
> pyenv install 3.11.8
> pyenv global 3.11.8
> ```

### 2.2 Provider 配置

Hermes Agent 支持多 Provider 并存，通过环境变量或配置文件设置：

```bash
# ~/.hermes/config.yaml
providers:
  # 主力模型：Claude（代码质量最好）
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    model: claude-sonnet-4-20250514
    max_tokens: 8192

  # 备选模型：GPT-4o（多模态能力强）
  openai:
    api_key: ${OPENAI_API_KEY}
    model: gpt-4o
    max_tokens: 4096

  # 本地模型：Ollama（处理敏感数据）
  ollama:
    base_url: http://localhost:11434
    model: qwen2.5:14b

  # 小米 MiMo 模型（性价比高）
  xiaomi:
    api_key: ${XIAOMI_API_KEY}
    base_url: https://api.xiaomi.com/v1
    model: mimo-v2.5-pro

# 默认 Provider
default_provider: anthropic

# 工作目录
workspace: ~/GitHub
```

> **踩坑 #2**：环境变量优先级问题。如果同时在 `.zshrc` 和 `config.yaml` 中设置了 API Key，环境变量会覆盖配置文件。建议统一用一种方式管理，我推荐 `.env` 文件配合 `direnv`：
>
> ```bash
> # ~/GitHub/.envrc
> export ANTHROPIC_API_KEY="sk-ant-xxx"
> export OPENAI_API_KEY="sk-xxx"
> export XIAOMI_API_KEY="xxx"
> ```

### 2.3 首次启动与验证

```bash
# 交互式 CLI 模式
hermes

# 指定 Provider 启动
hermes --provider anthropic

# 指定工作目录
hermes --workdir ~/GitHub/mikeah2011.github.io

# 单次命令模式（适合脚本调用）
hermes -c "帮我检查当前目录下所有 PHP 文件的语法错误"
```

启动后的典型交互：

```
$ hermes
Hermes Agent v2.x (Provider: anthropic, Model: claude-sonnet-4-20250514)
Workspace: /Users/michael/GitHub

> 帮我分析一下 Laravel 项目的路由结构

🔧 Searching for route files...
📁 Found: routes/web.php, routes/api.php, routes/admin.php
📄 Reading routes/api.php...
...
```

---

## 三、Linux 服务器配置（CI/CD 与自动化场景）

### 3.1 为什么要在服务器上跑 Hermes Agent？

典型场景：

1. **CI/CD 中的 AI 代码审查**：PR 提交后自动触发 Hermes Agent 做 Code Review
2. **定时巡检**：每天凌晨检查服务器状态、数据库慢查询、日志异常
3. **自动文档更新**：API 变更后自动生成/更新 OpenAPI 文档

### 3.2 安装与配置

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y python3.11 python3.11-venv
python3.11 -m venv ~/.hermes-venv
source ~/.hermes-venv/bin/venv
pip install hermes-agent

# 配置 systemd 服务（用于长期运行的 Agent 实例）
sudo tee /etc/systemd/system/hermes-agent.service << 'EOF'
[Unit]
Description=Hermes Agent Service
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/app
Environment=ANTHROPIC_API_KEY=sk-ant-xxx
ExecStart=/home/deploy/.hermes-venv/bin/hermes serve --port 8900
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable hermes-agent
sudo systemctl start hermes-agent
```

> **踩坑 #3**：Linux 服务器上 `hermes` 命令默认使用系统 locale，如果服务器是 `C.UTF-8` 以外的 locale，中文输出会乱码。解决办法：
>
> ```bash
> # 在 systemd service 中添加
> Environment=LANG=en_US.UTF-8
> Environment=LC_ALL=en_US.UTF-8
> ```

### 3.3 GitHub Actions 集成

```yaml
# .github/workflows/ai-review.yml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Hermes Agent
        run: pip install hermes-agent

      - name: Run AI Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          hermes -c "审查当前 PR 的代码变更，关注安全漏洞、性能问题和代码风格。输出格式为 Markdown。" \
            --workdir ${{ github.workspace }} \
            --output review-comment.md

      - name: Post Review Comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const review = fs.readFileSync('review-comment.md', 'utf8');
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: review
            });
```

> **踩坑 #4**：GitHub Actions 中 Hermes Agent 的 `terminal` 工具会受限于 runner 的权限。如果 Skill 中有 `git push` 操作，需要配置 `GITHUB_TOKEN` 的写权限，且不能在 `pull_request` 事件中使用（安全限制）。

---

## 四、WSL 配置（Windows 开发者方案）

### 4.1 WSL2 环境准备

```powershell
# PowerShell（管理员）
wsl --install -d Ubuntu-24.04
wsl --set-default-version 2
```

```bash
# WSL 内部
sudo apt update && sudo apt install -y python3.11 python3.11-venv
pip install hermes-agent hermes-agent[windows]
```

### 4.2 跨文件系统注意事项

```bash
# ❌ 不要在 Windows 文件系统上操作（性能极差）
hermes --workdir /mnt/c/Users/michael/Projects

# ✅ 使用 WSL 原生文件系统
hermes --workdir ~/Projects

# 如果项目在 Windows 侧，先复制到 WSL
cp -r /mnt/c/Users/michael/GitHub/my-project ~/Projects/
```

> **踩坑 #5**：WSL2 的 `/mnt/c` 文件系统 I/O 性能只有原生 ext4 的 1/10。Hermes Agent 频繁读写文件时，在 `/mnt/c` 上操作会导致明显卡顿。**始终在 WSL 原生文件系统中工作**。

---

## 五、模型路由策略：什么时候用哪个模型？

这是实际使用中最关键的决策。经过 30+ 仓库的实践，我总结出以下策略：

```
┌─────────────────────────────────────────────────────┐
│                模型路由决策树                          │
├─────────────────────────────────────────────────────┤
│                                                      │
│  涉及敏感数据？（API Key、密码、内部代码）              │
│  ├── 是 → Ollama 本地模型（qwen2.5:14b / llama3）    │
│  └── 否 ↓                                            │
│                                                      │
│  需要高精度代码生成？                                  │
│  ├── 是 → Claude Sonnet（代码质量最佳）               │
│  └── 否 ↓                                            │
│                                                      │
│  需要多模态？（图片理解、截图分析）                      │
│  ├── 是 → GPT-4o（视觉能力最强）                      │
│  └── 否 ↓                                            │
│                                                      │
│  简单任务？（格式化、翻译、摘要）                        │
│  ├── 是 → MiMo-v2.5-pro（性价比最高）                │
│  └── 否 → Claude Sonnet（默认）                      │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 实际配置示例

```yaml
# ~/.hermes/config.yaml
routing:
  rules:
    # 涉及 .env 文件时强制使用本地模型
    - match:
        file_patterns: [".env*", "*.key", "*.pem", "credentials*"]
      provider: ollama

    # 代码审查用 Claude
    - match:
        task_types: ["code_review", "refactor", "debug"]
      provider: anthropic

    # 文档生成用性价比模型
    - match:
        task_types: ["documentation", "translation", "summary"]
      provider: xiaomi

    # 图片分析用 GPT-4o
    - match:
        has_images: true
      provider: openai
```

### 成本对比实测

在同一个 Laravel B2C 项目上，完成相同的代码审查任务（审查 5 个文件的变更）：

| Provider | 模型 | Token 消耗 | 质量评分 | 耗时 | 成本 |
|----------|------|-----------|---------|------|------|
| Anthropic | Claude Sonnet | 8,200 | 9.5/10 | 12s | ¥0.45 |
| OpenAI | GPT-4o | 9,800 | 8.5/10 | 15s | ¥0.52 |
| Xiaomi | MiMo-v2.5-pro | 7,500 | 7.0/10 | 8s | ¥0.05 |
| Ollama | qwen2.5:14b | 6,800 | 6.5/10 | 45s | ¥0.00 |

> **踩坑 #6**：本地模型（Ollama）的 `tool_use` 支持不稳定。qwen2.5:14b 在调用 `terminal` 工具时偶尔会产生格式错误的 JSON，导致工具调用失败。建议在 Skill 中添加错误重试逻辑，或在关键任务中使用云端模型。

---

## 六、Skill 系统集成：让 Agent 理解你的项目

Skill 是 Hermes Agent 最核心的能力之一（详细开发指南见前一篇文章）。这里重点讲**多项目场景下的 Skill 管理**。

### 6.1 项目级 Skill

```bash
# 每个项目目录下创建 .hermes/skills/ 目录
mkdir -p ~/GitHub/my-laravel-app/.hermes/skills

# 创建项目专属 Skill
cat > ~/GitHub/my-laravel-app/.hermes/skills/laravel-project.md << 'EOF'
# Laravel B2C API 项目规范

## 项目结构
- app/Http/Controllers/ — 薄 Controller，只做请求分发
- app/Services/ — 业务逻辑层
- app/Repositories/ — 数据访问层
- app/Models/ — Eloquent 模型
- routes/api.php — API 路由（版本前缀 /api/v2/）

## 代码规范
- PHP 8.2+，严格类型声明
- 使用 Enum 替代魔术字符串
- Service Layer 必须有对应的 PHPUnit 测试
- API 响应统一使用 ApiResponse::success() / ApiResponse::error()

## 禁止事项
- 禁止在 Controller 中直接操作 Eloquent
- 禁止使用 DB::raw()，除非有性能文档说明
- 禁止硬编码配置值，必须使用 config() 或 .env
EOF
```

### 6.2 全局 Skill

```bash
# 通用 Skill 放在全局目录
mkdir -p ~/.hermes/skills

cat > ~/.hermes/skills/php-laravel.md << 'EOF'
# PHP & Laravel 通用规范

## PHP 版本
当前项目统一使用 PHP 8.2

## 常用命令
- 语法检查：php -l {file}
- 代码风格：./vendor/bin/pint {file}
- 静态分析：./vendor/bin/phpstan analyse
- 测试：./vendor/bin/pest
EOF
```

> **踩坑 #7**：Skill 文件的加载优先级是**项目级 > 全局级**。如果项目级和全局级有同名 Skill（如都叫 `laravel.md`），项目级会覆盖全局级。建议全局 Skill 用通用名称（如 `php-laravel.md`），项目级用具体名称（如 `laravel-b2c-api.md`）。

---

## 七、真实使用场景：30+ 仓库的日常

### 场景 1：快速理解新项目

```bash
cd ~/GitHub/new-project
hermes -c "分析这个项目的架构：目录结构、使用的技术栈、数据库结构、API 设计模式。输出一份简要的技术概览。"
```

Hermes Agent 会自动：
1. 扫描 `composer.json` / `package.json` 了解依赖
2. 读取目录结构
3. 分析路由文件、模型文件、配置文件
4. 输出结构化的技术概览

### 场景 2：批量重构

```bash
hermes -c "将所有 Controller 中的 DB::table() 调用替换为 Eloquent Model 查询。
保留原有的查询逻辑，只改写调用方式。
修改前先运行测试确认当前状态，修改后再运行测试确认无回归。"
```

### 场景 3：自动生成测试

```bash
hermes -c "为 app/Services/OrderService.php 生成完整的 Pest 测试。
要求覆盖：正常流程、边界条件、异常场景。
使用 Mockery mock 外部依赖。"
```

> **踩坑 #8**：Hermes Agent 生成的测试代码有时会假设不存在的方法签名。建议先让它读取相关的 Service 和 Model 文件，再生成测试。可以在 Skill 中预先定义"生成测试前必须先读取源文件"的规则。

---

## 八、安全与隐私最佳实践

### 8.1 数据分级

```
┌────────────────────────────────────────────┐
│            数据敏感度分级                    │
├─────────────┬──────────────────────────────┤
│ 级别        │ 示例              → 模型选择  │
├─────────────┼──────────────────────────────┤
│ 🔴 高敏感   │ .env、API Key     → Ollama   │
│ 🟡 中敏感   │ 内部业务代码      → Claude   │
│ 🟢 低敏感   │ 开源项目、文档    → 任意      │
└─────────────┴──────────────────────────────┘
```

### 8.2 环境隔离

```bash
# 为不同项目设置不同的 Provider 策略
# ~/GitHub/internal-project/.hermes/config.yaml
providers:
  default: ollama  # 内部项目默认用本地模型

# ~/GitHub/open-source-project/.hermes/config.yaml
providers:
  default: anthropic  # 开源项目可以用云端模型
```

### 8.3 日志审计

```bash
# Hermes Agent 的操作日志保存在 ~/.hermes/logs/
# 每次对话的完整记录包括：输入、工具调用、输出
cat ~/.hermes/logs/2026-05-17.jsonl | jq '.tool_calls[] | select(.name == "terminal") | .command'
```

> **踩坑 #9**：Hermes Agent 的日志默认保留 30 天。如果你处理过敏感数据，建议定期清理日志，或在配置中禁用日志记录：
>
> ```yaml
> logging:
>   enabled: false  # 或设置 retention_days: 1
> ```

---

## 九、常见问题排查

### Q1：Agent 启动报错 "No provider configured"

```bash
# 检查环境变量
echo $ANTHROPIC_API_KEY

# 检查配置文件
cat ~/.hermes/config.yaml

# 最小化测试
ANTHROPIC_API_KEY=sk-ant-xxx hermes -c "hello"
```

### Q2：工具调用失败 "Permission denied"

```bash
# macOS 上需要授予终端完全磁盘访问权限
# 系统设置 → 隐私与安全性 → 完全磁盘访问 → 添加 Terminal/iTerm2

# Linux 上检查文件权限
ls -la ~/.hermes/
chmod 700 ~/.hermes/
chmod 600 ~/.hermes/config.yaml
```

### Q3：本地模型响应极慢

```bash
# 检查 Ollama 状态
ollama ps

# 检查 GPU 是否可用
ollama run qwen2.5:14b --verbose

# 如果没有 GPU，考虑使用更小的模型
ollama pull qwen2.5:7b  # 7B 参数，CPU 也能跑
```

---

## 总结

Hermes Agent 作为统一的 AI 助手中间层，解决了多工具碎片化的问题。核心价值在于：

1. **统一接口**：一套配置、一套 Skill，换模型零成本
2. **工具能力**：不只是对话，能直接操作文件系统、运行命令
3. **安全可控**：通过模型路由策略，敏感数据不出本机
4. **持续进化**：Skill 系统让 Agent 随项目积累越来越懂你的代码

关键的配置要点：

- **macOS 开发**：主力用 Claude，本地模型做敏感数据处理
- **Linux 服务器**：用 systemd 管理长期运行的 Agent 实例
- **WSL**：务必在原生文件系统中操作，避免 `/mnt/c` 性能陷阱
- **成本控制**：简单任务用 MiMo/本地模型，复杂任务用 Claude/GPT-4o
- **安全第一**：敏感文件自动路由到本地模型，日志定期清理

下一篇我会深入讲解 Hermes Agent 的 Skill 开发高级技巧——条件激活、Progressive Disclosure、多 Skill 编排等进阶用法。

---

## 相关阅读

- [AI Agent Skill 开发实战：自定义技能与工作流自动化——Hermes Agent 踩坑记录](/categories/macOS/ai-agent-skill-guide-automation-hermes-agent/)
- [Ollama 实战：本地部署 LLM 与 API 服务 — 隐私优先的 AI 开发工作流踩坑记录](/categories/macOS/ollama-guide-deployment-llm-api-ai/)
- [Hermes Agent vs Claude Code vs Cursor：开发者 AI 助手深度对比](/categories/macOS/2026-06-01-hermes-agent-vs-claude-code-vs-cursor-developer-ai-assistant-comparison/)
