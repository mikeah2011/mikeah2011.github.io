---

title: pyenv + poetry 实战：Python 版本与依赖管理——macOS 开发者从 pip 到现代工具链的迁移指南踩坑记录
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-17 06:30:19
updated: 2026-05-17 06:33:58
categories:
  - macos
keywords: [pyenv, poetry, Python, macOS, pip, 版本与依赖管理, 开发者从, 到现代工具链的迁移指南踩坑记录]
tags:
- Composer
- macOS
description: macOS 上 Python 多版本管理与依赖隔离的完整实战指南。从 Laravel/PHP 开发者视角出发，详解 pyenv 安装配置、版本解析机制、poetry 依赖分组与 Lock File 最佳实践，覆盖 AI 脚本、CI/CD 集成、Apple Silicon 编译等 10 大踩坑场景，并对比 uv 新一代包管理器的选型建议。
---



# pyenv + poetry 实战：Python 版本与依赖管理——macOS 开发者迁移指南

## 为什么 PHP 开发者需要关心 Python 工具链？

在 KKday 的 B2C 后端团队中，我们的主力栈是 Laravel/PHP。但实际开发中，Python 出场的频率远超预期：

- **AI 辅助脚本**：用 Python 调 OpenAI/Claude API 做批量代码审查、文档生成
- **数据处理管道**：ETL 脚本、日志分析、报表生成
- **DevOps 工具**：Ansible playbook、自定义 CI 脚本
- **机器学习原型**：推荐系统 POC、数据特征工程

问题来了——macOS 自带的 Python 版本（通常是 2.7 或 3.9）远不够用，而 `brew install python` 会污染系统环境。更糟糕的是，不同项目依赖不同的 Python 版本和包，`pip install --user` 会互相踩踏。

这篇文章记录了我们团队从"brew install python + pip"迁移到"pyenv + poetry"的完整过程，包括所有踩坑和最终方案。

---

## 架构总览

```
┌─────────────────────────────────────────────────┐
│                   macOS Host                     │
│                                                  │
│  ┌──────────┐   管理 Python 版本                  │
│  │  pyenv   │──── ~/.pyenv/versions/             │
│  │          │   ├── 3.11.9/                      │
│  │          │   ├── 3.12.4/                      │
│  │          │   └── 3.13.0/                      │
│  └────┬─────┘                                    │
│       │ shims                                    │
│       ▼                                          │
│  ┌──────────┐   管理项目依赖                      │
│  │  poetry  │──── pyproject.toml + poetry.lock   │
│  │          │   ├── project-a/.venv/              │
│  │          │   ├── project-b/.venv/              │
│  │          │   └── project-c/.venv/              │
│  └──────────┘                                    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │            Project Structure              │    │
│  │  my-project/                              │    │
│  │  ├── pyproject.toml   ← 依赖声明          │    │
│  │  ├── poetry.lock      ← 锁定版本          │    │
│  │  ├── .venv/           ← 虚拟环境（自动生成）│    │
│  │  ├── src/                                  │    │
│  │  └── scripts/                              │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

**核心理念**：pyenv 管"用哪个 Python"，poetry 管"装哪些包"，两者职责分明，互不干扰。

---

## Part 1: pyenv —— Python 版本管理

### 安装与配置

```bash
# macOS 推荐用 Homebrew 安装
brew install pyenv

# 将以下内容添加到 ~/.zshrc（Oh My Zsh 用户）
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"

# 生效
source ~/.zshrc
```

> **踩坑 #1**：不要用 `brew install pyenv` 后还手动设 PATH，Homebrew 会自动 symlink 到 `/opt/homebrew/bin/pyenv`。但 pyenv 的 shims 机制需要 `eval "$(pyenv init -)"`，这一步**不能省**。省略的后果是 `python` 命令仍然指向系统版本。

### 安装 Python 版本

```bash
# 查看可安装版本
pyenv install --list | grep -E "^\s+3\.(11|12|13)\."

# 安装常用版本
pyenv install 3.11.9
pyenv install 3.12.4
pyenv install 3.13.0

# 设置全局默认版本
pyenv global 3.12.4

# 为特定项目设置版本（在项目目录下执行）
cd ~/projects/ai-scripts
pyenv local 3.13.0   # 会生成 .python-version 文件

# 验证
python --version   # Python 3.13.0（在 ai-scripts 目录下）
pyenv versions     # 列出所有已安装版本
```

> **踩坑 #2**：`pyenv install` 在 macOS 上编译 Python 时需要 Xcode Command Line Tools 和一些依赖库。如果报 `zlib not found` 或 `openssl not found`：
> ```bash
> # 安装编译依赖
> brew install openssl readline sqlite3 xz zlib tcl-tk
>
> # 设置编译参数（添加到 ~/.zshrc）
> export LDFLAGS="-L/opt/homebrew/opt/zlib/lib -L/opt/homebrew/opt/openssl@3/lib"
> export CPPFLAGS="-I/opt/homebrew/opt/zlib/include -I/opt/homebrew/opt/openssl@3/include"
> export PKG_CONFIG_PATH="/opt/homebrew/opt/zlib/lib/pkgconfig:/opt/homebrew/opt/openssl@3/lib/pkgconfig"
> ```

### pyenv 版本解析机制

```
python 命令
    │
    ▼
~/.pyenv/shims/python  ← shim 脚本
    │
    ▼ 按优先级查找 .python-version
    ├── 1. PYENV_VERSION 环境变量
    ├── 2. 当前目录 .python-version 文件
    ├── 3. 父目录逐级查找 .python-version
    ├── 4. $HOME/.python-version
    └── 5. pyenv global 设定的版本
    │
    ▼
~/.pyenv/versions/3.12.4/bin/python  ← 实际可执行文件
```

### 常用 pyenv 命令速查

```bash
# 版本管理
pyenv install --list          # 列出所有可安装版本
pyenv install 3.12.4          # 安装指定版本
pyenv uninstall 3.11.9        # 卸载指定版本
pyenv versions                # 列出已安装版本（* 表示当前）

# 版本切换
pyenv global 3.12.4           # 设置全局默认版本
pyenv local 3.13.0            # 设置当前目录版本（生成 .python-version）
pyenv shell 3.11.9            # 设置当前 shell 会话版本

# 诊断
pyenv which python            # 显示当前 python 实际路径
pyenv prefix 3.12.4           # 显示版本安装路径
pyenv doctor                  # 诊断安装问题
```

---

## Part 2: poetry —— 依赖管理

### 安装

```bash
# 推荐用官方安装器（不建议 pip install poetry，会有循环依赖问题）
curl -sSL https://install.python-poetry.org | python3 -

# 验证
poetry --version
# Poetry (version 1.8.x)
```

> **踩坑 #3**：**绝对不要用 `pip install poetry`**！这是官方文档明确警告的。pip 安装的 poetry 会和项目虚拟环境产生依赖冲突，导致各种诡异的 "dependency resolution" 错误。用官方安装器，poetry 会被安装到独立的隔离环境中。

### 创建新项目

```bash
# 方式 1：创建全新项目
poetry new my-script --name my_script
# 生成：
# my-script/
# ├── pyproject.toml
# ├── README.md
# ├── my_script/
# │   └── __init__.py
# └── tests/
#     └── __init__.py

# 方式 2：在已有项目中初始化
cd existing-project
poetry init   # 交互式创建 pyproject.toml
```

### pyproject.toml 详解

```toml
[tool.poetry]
name = "ai-code-reviewer"
version = "0.1.0"
description = "AI-powered code review script for Laravel projects"
authors = ["Michael <michael@kkday.com>"]
readme = "README.md"

[tool.poetry.dependencies]
python = "^3.11"
openai = "^1.30"
anthropic = "^0.25"
rich = "^13.7"           # 终端美化输出
pydantic = "^2.7"        # 数据模型验证
click = "^8.1"           # CLI 框架

[tool.poetry.group.dev.dependencies]
pytest = "^8.1"
pytest-cov = "^5.0"
ruff = "^0.4"            # 快速 linter
mypy = "^1.9"            # 类型检查

[tool.poetry.group.scripts.dependencies]
pandas = "^2.2"          # 仅数据处理脚本使用
numpy = "^1.26"

[tool.poetry.scripts]
review = "my_script.cli:main"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

### 依赖分组（Dependency Groups）

这是 poetry 相比 pip 的核心优势之一。在 B2C 项目中，我们通常需要区分：

```bash
# 默认安装（仅主依赖 + dev 组）
poetry install

# 不安装 dev 组（用于生产部署）
poetry install --without dev

# 安装额外的可选组
poetry install --with scripts

# 仅安装主依赖（最精简）
poetry install --only main
```

```
依赖分组架构图：

┌─────────────────────────────────────────┐
│            pyproject.toml               │
│                                         │
│  ┌─────────────────────────────┐        │
│  │   main (核心依赖)            │        │
│  │   openai, anthropic, rich   │        │
│  └─────────────────────────────┘        │
│                                         │
│  ┌─────────────────────────────┐        │
│  │   dev (开发依赖)             │        │
│  │   pytest, ruff, mypy        │        │
│  └─────────────────────────────┘        │
│                                         │
│  ┌─────────────────────────────┐        │
│  │   scripts (可选组)           │        │
│  │   pandas, numpy             │        │
│  └─────────────────────────────┘        │
└─────────────────────────────────────────┘

poetry install          → main + dev + scripts
poetry install --without dev  → main + scripts
poetry install --only main    → main only
```

### Lock File 的重要性

```bash
# poetry.lock 自动生成，锁定所有依赖的精确版本
# 包括传递依赖（transitive dependencies）

# 安装依赖（优先使用 lock file）
poetry install           # ✅ 推荐：从 lock file 安装

# 更新依赖（修改 pyproject.toml 后）
poetry lock              # 仅更新 lock file，不安装
poetry update            # 更新 lock file + 安装
poetry update openai     # 仅更新指定包

# 查看依赖树
poetry show --tree
```

> **踩坑 #4**：**必须把 `poetry.lock` 提交到 Git！** 这和 `composer.lock` 是一个道理。不提交 lock file 会导致每个开发者/CI 环境安装不同版本的传递依赖，产生"在我机器上能跑"的问题。`.gitignore` 里**不要**加 `poetry.lock`。

---

## Part 3: 实战场景

### 场景 1：AI 代码审查脚本

这是一个真实场景——我们用 Python 脚本批量审查 Laravel 仓库的 PR：

```python
# scripts/review_pr.py
import anthropic
from pathlib import Path
from rich.console import Console
from rich.markdown import Markdown

console = Console()

def review_php_file(file_path: Path) -> str:
    """用 Claude API 审查单个 PHP 文件"""
    client = anthropic.Anthropic()
    
    code = file_path.read_text()
    
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": f"""Review this PHP code for:
1. Security vulnerabilities (SQL injection, XSS)
2. Performance issues (N+1 queries, missing indexes)
3. Code style violations (PSR-12)

```php
{code}
```

Provide concise, actionable feedback."""
        }]
    )
    
    return message.content[0].text

def main():
    repo_path = Path("~/GitHub/laravel-project").expanduser()
    php_files = list(repo_path.rglob("*.php"))
    
    console.print(f"[bold green]Found {len(php_files)} PHP files[/]")
    
    for php_file in php_files[:5]:  # 限制数量，控制成本
        console.print(f"\n[bold blue]Reviewing: {php_file.name}[/]")
        result = review_php_file(php_file)
        console.print(Markdown(result))

if __name__ == "__main__":
    main()
```

运行方式：

```bash
cd ~/projects/ai-code-reviewer
poetry run python scripts/review_pr.py
# 或者如果配置了 pyproject.toml 中的 scripts：
poetry run review
```

### 场景 2：与 Laravel CI 集成

在 GitHub Actions 中同时运行 PHP 测试和 Python 脚本：

```yaml
# .github/workflows/review-and-test.yml
name: CI Pipeline

on: [push, pull_request]

jobs:
  php-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
      - run: composer install --no-progress
      - run: php artisan test

  python-review:
    runs-on: ubuntu-latest
    needs: php-tests  # PHP 测试通过后才跑 AI 审查
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install Poetry
        run: pipx install poetry  # CI 里用 pipx 安装 poetry
      - name: Install dependencies
        run: poetry install --without dev
      - name: Run AI review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: poetry run review --pr ${{ github.event.pull_request.number }}
```

### 场景 3：数据处理管道

```python
# scripts/analyze_logs.py
import pandas as pd
from pathlib import Path
from datetime import datetime

def analyze_slow_queries(log_file: Path) -> pd.DataFrame:
    """分析 Laravel 慢查询日志"""
    df = pd.read_csv(log_file)
    
    # 筛选慢查询（>100ms）
    slow = df[df['duration_ms'] > 100]
    
    # 按查询模式分组统计
    summary = (
        slow.groupby('query_pattern')
        .agg(
            count=('duration_ms', 'size'),
            avg_duration=('duration_ms', 'mean'),
            max_duration=('duration_ms', 'max'),
            total_duration=('duration_ms', 'sum'),
        )
        .sort_values('total_duration', ascending=False)
    )
    
    return summary

if __name__ == "__main__":
    result = analyze_slow_queries(Path("storage/logs/slow_queries.csv"))
    print(result.to_markdown())
```

```bash
# 运行（自动使用 scripts 组的 pandas 依赖）
poetry install --with scripts
poetry run python scripts/analyze_logs.py
```

---

## Part 4: pyenv + poetry 的版本解析优先级

这是最容易让人困惑的地方，画一张完整的解析链：

```
你在终端输入: python
    │
    ▼
ZSH 执行 pyenv-init 注册的 shim
    │
    ▼
~/.pyenv/shims/python
    │
    ▼ 查找 Python 版本
    │
    ├── 1. PYENV_VERSION 环境变量？ → 使用该版本
    │
    ├── 2. 当前目录有 .python-version？
    │       └── 使用文件中指定的版本
    │
    ├── 3. 向上递归查找 .python-version
    │       └── 使用最近祖先目录中的版本
    │
    ├── 4. $HOME/.python-version？
    │       └── 使用该版本
    │
    └── 5. pyenv global 设定的版本
            └── 使用全局版本
    
    │
    ▼ 执行实际的 Python 二进制
~/.pyenv/versions/3.12.4/bin/python
```

**poetry 的虚拟环境又在哪？**

```bash
# 查看 poetry 使用的虚拟环境路径
poetry env info --path
# 输出类似：/Users/michael/Library/Caches/pypoetry/virtualenvs/ai-reviewer-xxxxx-py3.12

# 推荐配置：在项目目录下创建 .venv（更直观）
poetry config virtualenvs.in-project true

# 配置后，虚拟环境就在项目的 .venv/ 目录
poetry env info --path
# 输出：/Users/michael/projects/ai-reviewer/.venv
```

> **踩坑 #5**：`poetry config virtualenvs.in-project true` 建议**全局设置**。不设置时，poetry 将 venv 放在 `~/Library/Caches/pypoetry/virtualenvs/` 下，路径很长且不好找。放在项目目录下 `.venv/` 更直观，IDE 也能自动识别。

---

## Part 5: 踩坑记录汇总

### 踩坑 #6: Homebrew Python 和 pyenv Python 冲突

**现象**：`brew upgrade` 后 `python3` 指向了新版本，pyenv 的 shim 失效。

**原因**：Homebrew 更新 Python 时会修改 `/opt/homebrew/bin/python3` 的 symlink，但 pyenv 的 shim 优先级更高。问题出在 `~/.zshrc` 中 `eval "$(pyenv init -)"` 的位置——它必须在 Homebrew 的 PATH 设置**之后**。

**修复**：

```bash
# ~/.zshrc 中的正确顺序：
export PATH="/opt/homebrew/bin:$PATH"    # Homebrew 先
eval "$(pyenv init -)"                    # pyenv 后（覆盖 Homebrew 的 python）
```

### 踩坑 #7: Poetry lock 解析极慢

**现象**：`poetry lock` 执行 10 分钟以上，甚至卡死。

**原因**：依赖冲突或 PyPI 源响应慢。

**解决**：

```bash
# 1. 使用国内镜像源
poetry source add pypi-tuna https://pypi.tuna.tsinghua.edu.cn/simple/ --priority=default

# 2. 清除缓存
poetry cache clear --all pypi

# 3. 添加 -vvv 查看详细日志
poetry lock -vvv

# 4. 如果某条依赖卡住，先注释掉再 lock
```

### 踩坑 #8: `poetry install` 在 CI 中找不到 Python 版本

**现象**：GitHub Actions 中报 `The current project's Python requirement (>=3.11) is not compatible with the Python version on this system`。

**原因**：`setup-python` action 装的版本和 `pyproject.toml` 中 `python = "^3.11"` 不匹配。

**修复**：

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: '3.12'  # 必须满足 pyproject.toml 中的约束
```

### 踩坑 #9: macOS Apple Silicon 的架构问题

**现象**：`pyenv install 3.11.9` 编译的 Python 是 x86_64 架构（通过 Rosetta），运行时性能差。

**原因**：终端 App 可能运行在 Rosetta 模式下，或者 `CFLAGS` 里没指定正确的架构。

**修复**：

```bash
# 确保终端不运行在 Rosetta 模式
# 右键 iTerm2 → 显示简介 → 取消勾选"使用 Rosetta 打开"

# 安装时强制 arm64
CFLAGS="-I/opt/homebrew/include" LDFLAGS="-L/opt/homebrew/lib" \
  pyenv install 3.12.4

# 验证架构
python -c "import platform; print(platform.machine())"
# 应输出 arm64，而不是 x86_64
```

### 踩坑 #10: `poetry run` 找不到命令

**现象**：`poetry run my-script` 报 `Command not found`。

**原因**：`pyproject.toml` 中的 `[tool.poetry.scripts]` 配置有误，或者没有 `poetry install`。

**修复**：

```toml
# 正确配置：
[tool.poetry.scripts]
review = "my_script.cli:main"  # module.path:function_name
```

```bash
# 每次修改 scripts 后必须重新 install
poetry install
poetry run review  # 现在应该可以了
```

---

## Part 6: pyenv + poetry vs uv 选型

在之前的文章中我们介绍了 uv（新一代 Python 包管理器）。这里做一个对比：

```
┌──────────────┬──────────────────┬──────────────────┐
│   维度        │  pyenv + poetry  │  uv              │
├──────────────┼──────────────────┼──────────────────┤
│ 安装速度      │ 慢（pip 后端）    │ 极快（Rust 后端） │
│ Lock File    │ poetry.lock ✅   │ uv.lock ✅       │
│ 版本管理      │ pyenv ✅         │ uv python ✅     │
│ 依赖分组      │ ✅ groups        │ ✅ dependency-groups│
│ 生态成熟度    │ 高（2018 年起）   │ 中（2024 年起）   │
│ 缓存机制      │ 一般             │ 全局缓存去重 ✅   │
│ 与 pip 兼容   │ 完全兼容          │ 大部分兼容        │
│ IDE 支持      │ PyCharm/VSCode ✅│ 逐步跟进中        │
│ 企业采用率    │ 高               │ 快速增长           │
└──────────────┴──────────────────┴──────────────────┘
```

**我们的建议**：

- **新项目**：直接用 uv（速度快 10-100 倍）
- **已有项目**：保持 pyenv + poetry，除非有性能痛点
- **团队协作**：工具统一比工具最优更重要

```bash
# 如果想迁移 poetry 项目到 uv：
cd my-project
uv init --from-pyproject-toml  # 从 pyproject.toml 导入
uv lock                         # 生成 uv.lock
uv sync                         # 安装依赖
```

---

## Part 7: 与 PHP 项目的集成最佳实践

### 目录结构

```
laravel-project/
├── app/                    # PHP 代码
├── tests/                  # PHPUnit 测试
├── vendor/                 # Composer 依赖
├── composer.json
├── composer.lock
│
├── scripts/                # Python 脚本目录
│   ├── pyproject.toml      # Python 依赖声明
│   ├── poetry.lock         # Python 依赖锁定
│   ├── .venv/              # Python 虚拟环境
│   ├── review_pr.py
│   └── analyze_logs.py
│
├── .python-version         # pyenv 版本锁定
├── .gitignore              # 包含 .venv/，不包含 poetry.lock
└── Makefile                # 统一入口
```

### Makefile 统一入口

```makefile
# Makefile
.PHONY: setup test review analyze

# 一键初始化（PHP + Python）
setup:
	composer install
	cd scripts && poetry install

# PHP 测试
test:
	php artisan test

# Python AI 代码审查
review:
	cd scripts && poetry run review --pr $(PR)

# Python 日志分析
analyze:
	cd scripts && poetry run python analyze_logs.py

# 更新 Python 依赖
py-update:
	cd scripts && poetry update

# 检查 Python 代码质量
py-lint:
	cd scripts && poetry run ruff check .
	cd scripts && poetry run mypy .
```

### .gitignore 配置

```gitignore
# Python
scripts/.venv/
__pycache__/
*.pyc
.mypy_cache/
.ruff_cache/

# ⚠️ 不要忽略 poetry.lock！
# poetry.lock  → 必须提交
```

---

## 常用命令速查卡

```bash
# ═══ pyenv ═══
pyenv install --list          # 列出可安装版本
pyenv install 3.12.4          # 安装 Python
pyenv global 3.12.4           # 设置全局版本
pyenv local 3.13.0            # 设置项目版本
pyenv versions                # 查看已安装版本
pyenv which python            # 查看实际 Python 路径

# ═══ poetry ═══
poetry new my-project         # 创建新项目
poetry init                   # 初始化已有项目
poetry install                # 安装依赖（从 lock file）
poetry add requests           # 添加依赖
poetry add --group dev pytest # 添加 dev 依赖
poetry remove requests        # 移除依赖
poetry update                 # 更新所有依赖
poetry update requests        # 更新指定依赖
poetry lock                   # 仅更新 lock file
poetry show                   # 列出已安装包
poetry show --tree            # 依赖树
poetry run python main.py     # 在虚拟环境中运行
poetry shell                  # 进入虚拟环境 shell
poetry env info               # 查看虚拟环境信息
poetry config virtualenvs.in-project true  # venv 放项目内

# ═══ 诊断 ═══
pyenv doctor                  # 诊断 pyenv 问题
poetry check                  # 检查 pyproject.toml 语法
poetry debug info             # 调试信息
```

---

## 总结

pyenv + poetry 的组合对于 macOS 上的 Python 开发已经足够成熟和稳定。作为 PHP 开发者，我们不需要精通 Python 的每个细节，但需要一个可靠的工具链来管理偶尔出现的 Python 需求。

**关键心得**：

1. **pyenv 必装**——系统 Python 不可靠，`brew install python` 会污染环境
2. **poetry 的 lock file 和 Composer 的 lock file 一样重要**——必须提交到 Git
3. **`poetry config virtualenvs.in-project true`** 是第一件要做的事
4. **依赖分组**是 poetry 的杀手级特性——区分 main/dev/scripts
5. **新项目考虑直接上 uv**——速度碾压，生态逐步完善
6. **CI 中用 `pipx install poetry`**——避免 pip 安装的循环依赖问题

工具链的选择没有银弹，关键是**团队统一 + 流程自动化**。pyenv + poetry 能覆盖 90% 的场景，剩下 10% 交给 uv 或直接 Docker。

---

## 相关阅读

- [uv 实战：下一代 Python 包管理器——100 倍速依赖解析与 PHP 开发者迁移指南](/categories/macOS/uv-guide-python-100-php-guide/)
- [pipx 实战：Python CLI 工具隔离安装——告别依赖冲突的全局工具管理方案](/categories/macOS/pipx-python-cli-guide/)
- [brew-php-switcher + Homebrew：macOS 多版本 PHP 管理实战与踩坑记录](/categories/macOS/brew-php-switcher-homebrew-php-guide/)
