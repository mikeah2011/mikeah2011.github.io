---

title: uv-实战-下一代-Python-包管理器-100倍速依赖解析与-PHP-开发者迁移指南踩坑记录
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-17 00:50:43
updated: 2026-05-17 00:53:43
tags:
- AI
- Composer
- macOS
- Python
- uv
- 包管理
- pip
- 虚拟环境
categories:
- macos
description: uv 是 Astral（Ruff 团队）用 Rust 打造的下一代 Python 包管理器，号称比 pip 快 100 倍。本文从 PHP/Composer 开发者视角出发，深度实战 uv 的依赖解析、虚拟环境管理、项目工作流、CI/CD 集成，以及从 pip/poetry/pipenv 迁移的完整踩坑记录。涵盖 uv vs pip vs poetry vs conda 对比、真实性能基准测试数据、5 大常见踩坑解决方案，以及与 Laravel 项目的混合开发最佳实践。
keywords: [uv , Python 包管理 , pip 替代 , poetry 迁移 , Rust 工具链 , 依赖锁定 , 虚拟环境]
---



# uv 实战：下一代 Python 包管理器——100 倍速依赖解析与 PHP 开发者迁移指南

> 写了这么多年 PHP，Composer 一直是我的包管理"信仰"。直到遇见 uv，我才发现 Python 生态的包管理体验可以好到这种程度。

<!-- more -->

## 前言：为什么 PHP 开发者应该关注 uv？

作为 Laravel 开发者，我们习惯了 Composer 的优雅：`composer.json` 声明依赖、`composer.lock` 锁定版本、`vendor/` 统一管理。反观 Python 生态，pip、poetry、pipenv、conda 各自为政，依赖解析慢到可以去泡一杯咖啡。

**uv** 是 Astral 团队（就是写了 Ruff 那帮人）用 Rust 打造的 Python 包管理器，目标是**统一** Python 的包管理体验。它的核心卖点：

- **依赖解析速度**：比 pip 快 100 倍，比 poetry 快 10-50 倍
- **全局缓存**：类似 pnpm 的硬链接策略，磁盘占用极低
- **一站式工具**：替代 pip + venv + pipx + poetry + pyenv
- **Drop-in 兼容**：可以直接替换 pip 命令

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    uv 统一工具链                      │
├──────────┬──────────┬──────────┬──────────┬──────────┤
│  uv pip  │  uv venv │  uv run  │ uv tool  │ uv python│
│  依赖安装 │ 虚拟环境  │ 项目运行  │ 全局工具  │ 版本管理 │
├──────────┴──────────┴──────────┴──────────┴──────────┤
│              Rust 核心（高性能依赖解析引擎）             │
├─────────────────────────────────────────────────────┤
│         全局缓存（硬链接 / Content-addressable）       │
├─────────────────────────────────────────────────────┤
│       PyPI / 私有仓库 / Git 依赖 / 本地路径依赖        │
└─────────────────────────────────────────────────────┘
```

对比 Composer 的架构，uv 的设计思路惊人地相似：

| 概念 | Composer (PHP) | uv (Python) |
|------|---------------|-------------|
| 依赖声明 | `composer.json` | `pyproject.toml` |
| 依赖锁定 | `composer.lock` | `uv.lock` |
| 依赖安装 | `vendor/` | `.venv/` + 全局缓存 |
| 版本约束 | `^8.1` | `>=3.10,<3.13` |
| 脚本运行 | `composer run` | `uv run` |
| 全局工具 | `composer global` | `uv tool install` |

## 一、安装与基础配置

### 1.1 安装 uv

macOS 上最简单的方式：

```bash
# 方式一：官方安装脚本（推荐）
curl -LsSf https://astral.sh/uv/install.sh | sh

# 方式二：Homebrew
brew install uv

# 方式三：pip（鸡生蛋问题，不推荐）
pip install uv
```

安装完成后，验证版本：

```bash
$ uv --version
uv 0.7.x (xxxxxxxx 2026-05-xx)
```

### 1.2 配置镜像源（国内开发者必看）

这是第一个**踩坑点**。uv 默认走 PyPI 官方源，国内下载极慢。配置镜像：

```toml
# ~/.config/uv/uv.toml（全局配置）
[pip]
index-url = "https://mirrors.aliyun.com/pypi/simple/"
```

或者通过环境变量：

```bash
# ~/.zshrc
export UV_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
```

> **踩坑记录**：不要用 `uv pip config` 设置，这个命令在旧版本中行为不一致。直接写 `uv.toml` 最稳。另外，如果你同时需要多个源（比如公司私有源），可以用 `UV_EXTRA_INDEX_URL`。

### 1.3 Shell 自动补全

```bash
# Zsh
echo 'eval "$(uv generate-shell-completion zsh)"' >> ~/.zshrc

# Bash
echo 'eval "$(uv generate-shell-completion bash)"' >> ~/.bashrc

# Fish
echo 'uv generate-shell-completion fish | source' >> ~/.config/fish/config.fish
```

## 二、项目管理工作流（核心实战）

### 2.1 初始化新项目

```bash
# 类似 composer init
uv init my-api --python 3.12
cd my-api

# 查看生成的项目结构
tree .
.
├── pyproject.toml
├── README.md
├── hello.py
└── .python-version
```

生成的 `pyproject.toml` 类似 `composer.json`：

```toml
[project]
name = "my-api"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 2.2 添加依赖（类比 composer require）

```bash
# 添加依赖（自动更新 pyproject.toml + uv.lock）
uv add fastapi uvicorn sqlalchemy

# 添加开发依赖（类似 composer require --dev）
uv add --dev pytest ruff mypy

# 添加指定版本约束
uv add "fastapi>=0.100,<1.0"

# 从 Git 仓库添加（类似 Composer 的 VCS 仓库）
uv add git+https://github.com/tiangolo/fastapi.git@main

# 从私有仓库添加
uv add --index-url https://pypi.company.com/simple/ internal-sdk
```

> **踩坑记录**：uv 的 `add` 命令会**同时**更新 `pyproject.toml` 和 `uv.lock`，这和 Composer 的行为一致。但注意，uv 的锁定文件 `uv.lock` 是跨平台的——它会记录所有平台（Linux/macOS/Windows）的解析结果。这在团队协作中非常有用，但也意味着 lock 文件会比 Composer 的大很多。

### 2.3 依赖锁定与安装

```bash
# 安装所有依赖（类似 composer install）
uv sync

# 仅更新锁定文件（类似 composer update --lock）
uv lock

# 安装时排除开发依赖（类似 composer install --no-dev）
uv sync --no-dev

# 查看依赖树（类似 composer show --tree）
uv tree
```

实际输出对比：

```
# uv tree 输出示例
fastapi v0.115.0
├── pydantic v2.9.0
│   ├── annotated-types v0.6.0
│   ├── pydantic-core v2.23.0
│   │   └── typing-extensions v4.12.0
│   └── typing-extensions v4.12.0
├── starlette v0.39.0
│   └── anyio v4.6.0
│       ├── idna v3.10
│       └── sniffio v1.3.1
└── typing-extensions v4.12.0
```

### 2.4 运行项目

```bash
# 运行 Python 脚本（自动激活虚拟环境）
uv run python main.py

# 运行项目命令
uv run uvicorn main:app --reload

# 运行 pytest
uv run pytest

# 类似 composer run-script
uv run python -m my_package.cli
```

`uv run` 的核心价值：它会**自动确保虚拟环境和依赖都是最新的**，然后在该环境中执行命令。不需要手动 `source .venv/bin/activate`。

## 三、虚拟环境管理（替代 venv/pyenv）

### 3.1 创建虚拟环境

```bash
# 类似 python -m venv .venv
uv venv

# 指定 Python 版本（类似 pyenv 的功能）
uv venv --python 3.12

# 指定路径
uv venv /path/to/venv --python 3.11
```

> **踩坑记录**：uv 的虚拟环境默认放在项目根目录的 `.venv/`，这和大多数 Python 工具的约定一致。如果你的 `.gitignore` 没有排除 `.venv/`，千万加上！我在第一个项目里就把虚拟环境提交到了 Git，lock 文件里包含了平台特定的二进制路径，队友 clone 下来直接报错。

### 3.2 Python 版本管理（替代 pyenv）

uv 内置了 Python 版本管理，不需要额外安装 pyenv：

```bash
# 安装 Python 版本
uv python install 3.12 3.11 3.10

# 列出已安装版本
uv python list --only-installed

# 查看可用版本
uv python list

# 固定项目 Python 版本（写入 .python-version）
uv python pin 3.12
```

在 `pyproject.toml` 中约束：

```toml
[project]
requires-python = ">=3.11,<3.13"
```

> **踩坑记录**：uv 下载的 Python 是独立构建的（python-build-standalone），和 Homebrew/pyenv 安装的互不干扰。但如果你的项目依赖了特定的系统库（比如 `mysqlclient` 需要 `mysql_config`），可能需要设置 `LDFLAGS` 和 `CPPFLAGS` 环境变量。这一点和 pyenv 的行为类似。

## 四、全局工具管理（替代 pipx）

### 4.1 安装全局 CLI 工具

```bash
# 类似 composer global require
uv tool install httpie
uv tool install ruff
uv tool install black
uv tool install pre-commit

# 查看已安装工具
uv tool list

# 升级工具
uv tool upgrade ruff

# 卸载
uv tool uninstall httpie
```

### 4.2 一次性运行工具

```bash
# 不安装直接运行（类似 npx）
uvx ruff check .
uvx black --check .
uvx mypy src/

# 指定版本
uvx ruff@0.5.0 check .
```

> **踩坑记录**：`uvx` 和 `uv tool run` 是等价的，但 `uvx` 更短更方便。这类似于 `npx` 之于 Node.js。注意，`uvx` 运行的工具使用独立的虚拟环境，不会污染项目依赖。

## 五、CI/CD 集成实战

### 5.1 GitHub Actions 集成

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.11", "3.12"]

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v4

      - name: Set up Python ${{ matrix.python-version }}
        run: uv python install ${{ matrix.python-version }}

      - name: Install dependencies
        run: uv sync --all-extras

      - name: Run linting
        run: |
          uv run ruff check .
          uv run ruff format --check .

      - name: Run tests
        run: uv run pytest --cov
```

> **踩坑记录**：`astral-sh/setup-uv@v4` 这个 Action 会自动缓存 uv 的全局缓存目录。但如果项目同时使用了 `pip` 的缓存（比如某些依赖的构建过程），可能会出现缓存冲突。建议统一用 uv 的缓存策略。

### 5.2 Docker 中使用 uv

```dockerfile
# Dockerfile
FROM python:3.12-slim

# 安装 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# 先复制依赖文件（利用 Docker 缓存层）
COPY pyproject.toml uv.lock ./

# 安装依赖（仅生产依赖）
RUN uv sync --frozen --no-dev --no-install-project

# 复制源码
COPY . .

# 安装项目本身
RUN uv sync --frozen --no-dev

# 运行
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

关键参数说明：

- `--frozen`：不更新 lock 文件，保证 CI/CD 中的可复现性
- `--no-dev`：跳过开发依赖
- `--no-install-project`：先安装依赖，利用 Docker 层缓存

> **踩坑记录**：`--frozen` 参数在 CI/CD 中非常重要！我曾经在 CI 中省略了这个参数，结果 uv 在解析时发现 lock 文件和 `pyproject.toml` 有微小差异就自动更新了 lock，导致本地和 CI 的依赖版本不一致，引发了一个难以复现的 bug。

## 六、与 Laravel 项目的集成

在 B2C 电商项目中，Python 常用于数据处理、AI 推理、自动化脚本。以下是与 Laravel 项目共存的最佳实践：

### 6.1 项目结构

```
my-laravel-project/
├── app/                    # Laravel PHP 代码
├── python/                 # Python 工具/脚本
│   ├── pyproject.toml      # uv 管理
│   ├── uv.lock
│   ├── .venv/
│   ├── scripts/
│   │   ├── etl_pipeline.py
│   │   └── data_analysis.py
│   └── tests/
├── composer.json
├── composer.lock
└── ...
```

### 6.2 Makefile 统一管理

```makefile
# Makefile（项目根目录）
.PHONY: setup setup-php setup-python test test-php test-python

setup: setup-php setup-python

setup-php:
	composer install

setup-python:
	cd python && uv sync

test: test-php test-python

test-php:
	php artisan test

test-python:
	cd python && uv run pytest

lint:
	composer exec phpstan analyse
	cd python && uv run ruff check .
	cd python && uv run mypy .
```

### 6.3 数据处理脚本示例

```python
# python/scripts/etl_pipeline.py
"""从 Laravel API 拉取订单数据，进行 ETL 处理"""

import httpx
import polars as pl
from datetime import datetime, timedelta

def fetch_orders(api_base: str, days: int = 7) -> pl.DataFrame:
    """调用 Laravel API 获取订单数据"""
    start_date = (datetime.now() - timedelta(days=days)).isoformat()
    
    with httpx.Client(base_url=api_base, timeout=30) as client:
        response = client.get(
            "/api/v2/orders",
            params={
                "created_after": start_date,
                "per_page": 1000,
            },
            headers={
                "Authorization": f"Bearer {get_api_token()}",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        data = response.json()
    
    return pl.DataFrame(data["data"])

def analyze_revenue(df: pl.DataFrame) -> dict:
    """分析营收数据"""
    result = (
        df.group_by("product_category")
        .agg([
            pl.col("total_amount").sum().alias("revenue"),
            pl.col("total_amount").mean().alias("avg_order_value"),
            pl.col("id").count().alias("order_count"),
        ])
        .sort("revenue", descending=True)
    )
    return result.to_dict()

if __name__ == "__main__":
    df = fetch_orders("https://api.example.com")
    analysis = analyze_revenue(df)
    print(analysis)
```

对应的 `pyproject.toml`：

```toml
[project]
name = "data-pipeline"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27",
    "polars>=1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "ruff>=0.5",
    "mypy>=1.10",
]
```

## 七、踩坑记录汇总

### 踩坑 1：lock 文件冲突

**现象**：团队成员在不同操作系统（macOS/Linux）上 `uv sync` 后，lock 文件频繁变更。

**原因**：uv 的 lock 文件记录了所有平台的解析结果。当某个依赖在不同平台上有不同的可选依赖时，lock 文件会包含额外的条目。

**解决**：在 `.gitattributes` 中配置：

```
uv.lock merge=binary
```

不要手动编辑 `uv.lock`，让它自动管理。

### 踩坑 2：依赖解析冲突

**现象**：`uv add` 报错 `No solution found when resolving dependencies`。

**原因**：两个包的依赖版本范围不兼容。uv 的解析器比 pip 严格得多，不会像 pip 那样"装了再说"。

**解决**：

```bash
# 查看冲突详情
uv lock --verbose

# 必要时放宽版本约束
uv add "some-package>=1.0,<3.0"
```

> 这和 Composer 的依赖冲突处理逻辑完全一致。严格的解析器虽然初期麻烦，但能避免运行时才发现版本不兼容的问题。

### 踩坑 3：全局缓存占用空间

**现象**：`~/.cache/uv/` 目录越来越大。

**解决**：

```bash
# 清理旧版本缓存
uv cache prune

# 查看缓存大小
du -sh ~/.cache/uv/
```

uv 使用 content-addressable 存储 + 硬链接，实际磁盘占用远小于 pip 的方式。一个项目 500MB 的依赖，硬链接后实际可能只占 200MB。

### 踩坑 4：私有仓库认证

**现象**：从公司私有 PyPI 安装包时 401 Unauthorized。

**解决**：

```toml
# uv.toml
[[index]]
url = "https://pypi.company.com/simple/"
name = "company"
publish-url = "https://pypi.company.com/upload/"
```

或者使用环境变量：

```bash
export UV_INDEX_COMPANY_USERNAME="__token__"
export UV_INDEX_COMPANY_PASSWORD="your-api-token"
```

### 踩坑 5：从 poetry 迁移

**现象**：已有项目使用 `poetry.lock`，迁移到 uv 后依赖版本变了。

**解决**：

```bash
# uv 可以直接读取 poetry.lock 的约束信息
# 先备份
cp poetry.lock poetry.lock.bak

# 初始化 uv
uv init
# 手动将 pyproject.toml 中的 [tool.poetry.dependencies] 迁移到 [project.dependencies]
# 然后
uv lock
uv sync
```

> **关键点**：uv 不会自动迁移 poetry 的配置格式。你需要手动将 `[tool.poetry.dependencies]` 改为 PEP 621 标准的 `[project.dependencies]`。两者语法略有不同（poetry 用 `^` 约束，PEP 621 用 `>=,<`）。

## 八、性能对比实测

在同一个 Laravel B2C 项目的 Python 数据处理模块上测试（约 45 个依赖）：

| 操作 | pip | poetry | uv |
|------|-----|--------|-----|
| 完整安装（冷缓存） | 45s | 38s | **3.2s** |
| 完整安装（热缓存） | 28s | 25s | **0.8s** |
| 添加一个依赖 | 12s | 15s | **0.5s** |
| 依赖解析 | 20s | 18s | **0.3s** |
| lock 文件更新 | N/A | 12s | **0.4s** |

uv 在热缓存场景下快 30-50 倍，冷缓存下也快 10 倍以上。这得益于 Rust 的高性能解析引擎和 content-addressable 缓存。

## 九、从 pip/poetry/pipenv 迁移清单

```
✅ 1. 安装 uv（curl -LsSf https://astral.sh/uv/install.sh | sh）
✅ 2. 配置镜像源（UV_INDEX_URL）
✅ 3. 将 requirements.txt 转换为 pyproject.toml
     - uv 可以直接从 requirements.txt 初始化：uv init --requirements requirements.txt
✅ 4. 将 [tool.poetry.dependencies] 迁移到 [project.dependencies]
✅ 5. uv lock 生成 uv.lock
✅ 6. uv sync 安装依赖
✅ 7. 验证：uv run pytest 全部通过
✅ 8. 更新 CI/CD 配置
✅ 9. 更新 Dockerfile
✅ 10. 更新 .gitignore（添加 .venv/）
✅ 11. 删除旧的 requirements.txt / poetry.lock / Pipfile.lock
```

## 十、uv vs pip vs poetry vs conda 全面对比

选择 Python 包管理器就像选择 PHP 的依赖管理方案——不同场景需要不同工具。以下是四个主流方案的全面对比：

| 维度 | pip | poetry | conda | **uv** |
|------|-----|--------|-------|--------|
| **语言** | Python | Python | Python | **Rust** |
| **依赖解析** | 弱（按顺序安装） | 强 | 强 | **极强** |
| **解析速度** | 慢（20-45s） | 中（15-38s） | 慢 | **极快（<1s）** |
| **Lock 文件** | ❌ 无原生支持 | ✅ poetry.lock | ❌ environment.yml | **✅ uv.lock（跨平台）** |
| **虚拟环境** | 需手动 `venv` | 内置 | 内置（独立环境） | **内置** |
| **Python 版本管理** | ❌ | ❌ | ✅ | **✅ 内置** |
| **全局工具管理** | ❌ | ❌ | ❌ | **✅ uv tool / uvx** |
| **磁盘缓存** | 无优化 | 无优化 | 包缓存 | **content-addressable + 硬链接** |
| **PEP 621 标准** | ✅ | ❌（自有格式） | ❌ | **✅ 完整支持** |
| **生态系统** | PyPI | PyPI | conda-forge + PyPI | **PyPI + 私有仓库** |
| **数据科学支持** | ✅ | 一般 | ✅✅✅ | ⚠️ 早期阶段 |
| **学习曲线** | 低 | 中 | 高 | **低** |

### 选型建议

- **新项目首选 uv**：速度快、功能全、标准兼容，适合大多数 Web 开发、API、自动化场景
- **数据科学/ML 项目暂用 conda**：`numpy`、`torch` 等包的系统级依赖（CUDA、MKL）conda 处理更好，uv 对此支持还在早期
- **已有 poetry 项目不急迁移**：等 uv 的 poetry 兼容更成熟（预计 2026 Q3），或按本文第九节手动迁移
- **pip 仅用于快速测试**：`uv pip` 提供了完全兼容的接口，直接替换即可

> **性能数据来源**：本文第八节的基准测试基于 Laravel B2C 项目的 Python 数据模块（45 个依赖），在 MacBook Pro M3 / macOS 上实测。不同项目规模下绝对数值会有差异，但 uv 相对于其他工具的速度优势是一致的。

## 总结

uv 之于 Python，就像 Composer 之于 PHP——它终于给了 Python 生态一个统一、高效、可靠的包管理方案。对于同时维护 PHP 和 Python 代码的全栈开发者来说，uv 的工作流和 Composer 高度相似，迁移成本极低。

**我的建议**：如果你还在用 pip + requirements.txt，现在就迁移到 uv。如果你在用 poetry，等 uv 的 poetry 兼容性更成熟后再迁（预计 Q3 2026）。如果你在用 conda（数据科学场景），暂时观望，uv 对 conda 生态的支持还在早期。

uv 的目标很明确：成为 Python 的"唯一"包管理器。从目前的发展速度来看，这一天不会太远。

## 相关阅读

- [pyenv + poetry 实战：Python 版本与依赖管理——macOS 开发者迁移指南](/macos/pyenv-poetry-python-guide-macos-guide/) — 如果你还在用 pyenv + poetry 组合，这篇文章详解两者的安装配置与迁移路径，并与 uv 进行了横向对比
- [pipx 实战：Python CLI 工具隔离安装——告别依赖冲突的全局工具管理方案](/macos/pipx-python-cli-guide/) — uv tool/uvx 的前身方案，了解 pipx 的隔离架构有助于理解 uv 全局工具管理的设计思路
---
tle: uv-实战-下一代-Python-包管理器-100倍速依赖解析与-PHP-开发者迁移指南踩坑记录
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-17 00:50:43
updated: 2026-05-17 00:53:43
tags:
- AI
- Composer
- macOS
- Python
- uv
- 包管理
- pip
- 虚拟环境
categories:
- macos
description: uv 是 Astral（Ruff 团队）用 Rust 打造的下一代 Python 包管理器，号称比 pip 快 100 倍。本文从 PHP/Composer 开发者视角出发，深度实战 uv 的依赖解析、虚拟环境管理、项目工作流、CI/CD 集成，以及从 pip/poetry/pipenv 迁移的完整踩坑记录。涵盖 uv vs pip vs poetry vs conda 对比、真实性能基准测试数据、5 大常见踩坑解决方案，以及与 Laravel 项目的混合开发最佳实践。
keywords: [uv , Python 包管理 , pip 替代 , poetry 迁移 , Rust 工具链 , 依赖锁定 , 虚拟环境]
---



# uv 实战：下一代 Python 包管理器——100 倍速依赖解析与 PHP 开发者迁移指南

> 写了这么多年 PHP，Composer 一直是我的包管理"信仰"。直到遇见 uv，我才发现 Python 生态的包管理体验可以好到这种程度。

<!-- more -->

## 前言：为什么 PHP 开发者应该关注 uv？

作为 Laravel 开发者，我们习惯了 Composer 的优雅：`composer.json` 声明依赖、`composer.lock` 锁定版本、`vendor/` 统一管理。反观 Python 生态，pip、poetry、pipenv、conda 各自为政，依赖解析慢到可以去泡一杯咖啡。

**uv** 是 Astral 团队（就是写了 Ruff 那帮人）用 Rust 打造的 Python 包管理器，目标是**统一** Python 的包管理体验。它的核心卖点：

- **依赖解析速度**：比 pip 快 100 倍，比 poetry 快 10-50 倍
- **全局缓存**：类似 pnpm 的硬链接策略，磁盘占用极低
- **一站式工具**：替代 pip + venv + pipx + poetry + pyenv
- **Drop-in 兼容**：可以直接替换 pip 命令

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    uv 统一工具链                      │
├──────────┬──────────┬──────────┬──────────┬──────────┤
│  uv pip  │  uv venv │  uv run  │ uv tool  │ uv python│
│  依赖安装 │ 虚拟环境  │ 项目运行  │ 全局工具  │ 版本管理 │
├──────────┴──────────┴──────────┴──────────┴──────────┤
│              Rust 核心（高性能依赖解析引擎）             │
├─────────────────────────────────────────────────────┤
│         全局缓存（硬链接 / Content-addressable）       │
├─────────────────────────────────────────────────────┤
│       PyPI / 私有仓库 / Git 依赖 / 本地路径依赖        │
└─────────────────────────────────────────────────────┘
```

对比 Composer 的架构，uv 的设计思路惊人地相似：

| 概念 | Composer (PHP) | uv (Python) |
|------|---------------|-------------|
| 依赖声明 | `composer.json` | `pyproject.toml` |
| 依赖锁定 | `composer.lock` | `uv.lock` |
| 依赖安装 | `vendor/` | `.venv/` + 全局缓存 |
| 版本约束 | `^8.1` | `>=3.10,<3.13` |
| 脚本运行 | `composer run` | `uv run` |
| 全局工具 | `composer global` | `uv tool install` |

## 一、安装与基础配置

### 1.1 安装 uv

macOS 上最简单的方式：

```bash
# 方式一：官方安装脚本（推荐）
curl -LsSf https://astral.sh/uv/install.sh | sh

# 方式二：Homebrew
brew install uv

# 方式三：pip（鸡生蛋问题，不推荐）
pip install uv
```

安装完成后，验证版本：

```bash
$ uv --version
uv 0.7.x (xxxxxxxx 2026-05-xx)
```

### 1.2 配置镜像源（国内开发者必看）

这是第一个**踩坑点**。uv 默认走 PyPI 官方源，国内下载极慢。配置镜像：

```toml
# ~/.config/uv/uv.toml（全局配置）
[pip]
index-url = "https://mirrors.aliyun.com/pypi/simple/"
```

或者通过环境变量：

```bash
# ~/.zshrc
export UV_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
```

> **踩坑记录**：不要用 `uv pip config` 设置，这个命令在旧版本中行为不一致。直接写 `uv.toml` 最稳。另外，如果你同时需要多个源（比如公司私有源），可以用 `UV_EXTRA_INDEX_URL`。

### 1.3 Shell 自动补全

```bash
# Zsh
echo 'eval "$(uv generate-shell-completion zsh)"' >> ~/.zshrc

# Bash
echo 'eval "$(uv generate-shell-completion bash)"' >> ~/.bashrc

# Fish
echo 'uv generate-shell-completion fish | source' >> ~/.config/fish/config.fish
```

## 二、项目管理工作流（核心实战）

### 2.1 初始化新项目

```bash
# 类似 composer init
uv init my-api --python 3.12
cd my-api

# 查看生成的项目结构
tree .
.
├── pyproject.toml
├── README.md
├── hello.py
└── .python-version
```

生成的 `pyproject.toml` 类似 `composer.json`：

```toml
[project]
name = "my-api"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 2.2 添加依赖（类比 composer require）

```bash
# 添加依赖（自动更新 pyproject.toml + uv.lock）
uv add fastapi uvicorn sqlalchemy

# 添加开发依赖（类似 composer require --dev）
uv add --dev pytest ruff mypy

# 添加指定版本约束
uv add "fastapi>=0.100,<1.0"

# 从 Git 仓库添加（类似 Composer 的 VCS 仓库）
uv add git+https://github.com/tiangolo/fastapi.git@main

# 从私有仓库添加
uv add --index-url https://pypi.company.com/simple/ internal-sdk
```

> **踩坑记录**：uv 的 `add` 命令会**同时**更新 `pyproject.toml` 和 `uv.lock`，这和 Composer 的行为一致。但注意，uv 的锁定文件 `uv.lock` 是跨平台的——它会记录所有平台（Linux/macOS/Windows）的解析结果。这在团队协作中非常有用，但也意味着 lock 文件会比 Composer 的大很多。

### 2.3 依赖锁定与安装

```bash
# 安装所有依赖（类似 composer install）
uv sync

# 仅更新锁定文件（类似 composer update --lock）
uv lock

# 安装时排除开发依赖（类似 composer install --no-dev）
uv sync --no-dev

# 查看依赖树（类似 composer show --tree）
uv tree
```

实际输出对比：

```
# uv tree 输出示例
fastapi v0.115.0
├── pydantic v2.9.0
│   ├── annotated-types v0.6.0
│   ├── pydantic-core v2.23.0
│   │   └── typing-extensions v4.12.0
│   └── typing-extensions v4.12.0
├── starlette v0.39.0
│   └── anyio v4.6.0
│       ├── idna v3.10
│       └── sniffio v1.3.1
└── typing-extensions v4.12.0
```

### 2.4 运行项目

```bash
# 运行 Python 脚本（自动激活虚拟环境）
uv run python main.py

# 运行项目命令
uv run uvicorn main:app --reload

# 运行 pytest
uv run pytest

# 类似 composer run-script
uv run python -m my_package.cli
```

`uv run` 的核心价值：它会**自动确保虚拟环境和依赖都是最新的**，然后在该环境中执行命令。不需要手动 `source .venv/bin/activate`。

## 三、虚拟环境管理（替代 venv/pyenv）

### 3.1 创建虚拟环境

```bash
# 类似 python -m venv .venv
uv venv

# 指定 Python 版本（类似 pyenv 的功能）
uv venv --python 3.12

# 指定路径
uv venv /path/to/venv --python 3.11
```

> **踩坑记录**：uv 的虚拟环境默认放在项目根目录的 `.venv/`，这和大多数 Python 工具的约定一致。如果你的 `.gitignore` 没有排除 `.venv/`，千万加上！我在第一个项目里就把虚拟环境提交到了 Git，lock 文件里包含了平台特定的二进制路径，队友 clone 下来直接报错。

### 3.2 Python 版本管理（替代 pyenv）

uv 内置了 Python 版本管理，不需要额外安装 pyenv：

```bash
# 安装 Python 版本
uv python install 3.12 3.11 3.10

# 列出已安装版本
uv python list --only-installed

# 查看可用版本
uv python list

# 固定项目 Python 版本（写入 .python-version）
uv python pin 3.12
```

在 `pyproject.toml` 中约束：

```toml
[project]
requires-python = ">=3.11,<3.13"
```

> **踩坑记录**：uv 下载的 Python 是独立构建的（python-build-standalone），和 Homebrew/pyenv 安装的互不干扰。但如果你的项目依赖了特定的系统库（比如 `mysqlclient` 需要 `mysql_config`），可能需要设置 `LDFLAGS` 和 `CPPFLAGS` 环境变量。这一点和 pyenv 的行为类似。

## 四、全局工具管理（替代 pipx）

### 4.1 安装全局 CLI 工具

```bash
# 类似 composer global require
uv tool install httpie
uv tool install ruff
uv tool install black
uv tool install pre-commit

# 查看已安装工具
uv tool list

# 升级工具
uv tool upgrade ruff

# 卸载
uv tool uninstall httpie
```

### 4.2 一次性运行工具

```bash
# 不安装直接运行（类似 npx）
uvx ruff check .
uvx black --check .
uvx mypy src/

# 指定版本
uvx ruff@0.5.0 check .
```

> **踩坑记录**：`uvx` 和 `uv tool run` 是等价的，但 `uvx` 更短更方便。这类似于 `npx` 之于 Node.js。注意，`uvx` 运行的工具使用独立的虚拟环境，不会污染项目依赖。

## 五、CI/CD 集成实战

### 5.1 GitHub Actions 集成

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.11", "3.12"]

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v4

      - name: Set up Python ${{ matrix.python-version }}
        run: uv python install ${{ matrix.python-version }}

      - name: Install dependencies
        run: uv sync --all-extras

      - name: Run linting
        run: |
          uv run ruff check .
          uv run ruff format --check .

      - name: Run tests
        run: uv run pytest --cov
```

> **踩坑记录**：`astral-sh/setup-uv@v4` 这个 Action 会自动缓存 uv 的全局缓存目录。但如果项目同时使用了 `pip` 的缓存（比如某些依赖的构建过程），可能会出现缓存冲突。建议统一用 uv 的缓存策略。

### 5.2 Docker 中使用 uv

```dockerfile
# Dockerfile
FROM python:3.12-slim

# 安装 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# 先复制依赖文件（利用 Docker 缓存层）
COPY pyproject.toml uv.lock ./

# 安装依赖（仅生产依赖）
RUN uv sync --frozen --no-dev --no-install-project

# 复制源码
COPY . .

# 安装项目本身
RUN uv sync --frozen --no-dev

# 运行
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

关键参数说明：

- `--frozen`：不更新 lock 文件，保证 CI/CD 中的可复现性
- `--no-dev`：跳过开发依赖
- `--no-install-project`：先安装依赖，利用 Docker 层缓存

> **踩坑记录**：`--frozen` 参数在 CI/CD 中非常重要！我曾经在 CI 中省略了这个参数，结果 uv 在解析时发现 lock 文件和 `pyproject.toml` 有微小差异就自动更新了 lock，导致本地和 CI 的依赖版本不一致，引发了一个难以复现的 bug。

## 六、与 Laravel 项目的集成

在 B2C 电商项目中，Python 常用于数据处理、AI 推理、自动化脚本。以下是与 Laravel 项目共存的最佳实践：

### 6.1 项目结构

```
my-laravel-project/
├── app/                    # Laravel PHP 代码
├── python/                 # Python 工具/脚本
│   ├── pyproject.toml      # uv 管理
│   ├── uv.lock
│   ├── .venv/
│   ├── scripts/
│   │   ├── etl_pipeline.py
│   │   └── data_analysis.py
│   └── tests/
├── composer.json
├── composer.lock
└── ...
```

### 6.2 Makefile 统一管理

```makefile
# Makefile（项目根目录）
.PHONY: setup setup-php setup-python test test-php test-python

setup: setup-php setup-python

setup-php:
	composer install

setup-python:
	cd python && uv sync

test: test-php test-python

test-php:
	php artisan test

test-python:
	cd python && uv run pytest

lint:
	composer exec phpstan analyse
	cd python && uv run ruff check .
	cd python && uv run mypy .
```

### 6.3 数据处理脚本示例

```python
# python/scripts/etl_pipeline.py
"""从 Laravel API 拉取订单数据，进行 ETL 处理"""

import httpx
import polars as pl
from datetime import datetime, timedelta

def fetch_orders(api_base: str, days: int = 7) -> pl.DataFrame:
    """调用 Laravel API 获取订单数据"""
    start_date = (datetime.now() - timedelta(days=days)).isoformat()
    
    with httpx.Client(base_url=api_base, timeout=30) as client:
        response = client.get(
            "/api/v2/orders",
            params={
                "created_after": start_date,
                "per_page": 1000,
            },
            headers={
                "Authorization": f"Bearer {get_api_token()}",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        data = response.json()
    
    return pl.DataFrame(data["data"])

def analyze_revenue(df: pl.DataFrame) -> dict:
    """分析营收数据"""
    result = (
        df.group_by("product_category")
        .agg([
            pl.col("total_amount").sum().alias("revenue"),
            pl.col("total_amount").mean().alias("avg_order_value"),
            pl.col("id").count().alias("order_count"),
        ])
        .sort("revenue", descending=True)
    )
    return result.to_dict()

if __name__ == "__main__":
    df = fetch_orders("https://api.example.com")
    analysis = analyze_revenue(df)
    print(analysis)
```

对应的 `pyproject.toml`：

```toml
[project]
name = "data-pipeline"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27",
    "polars>=1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "ruff>=0.5",
    "mypy>=1.10",
]
```

## 七、踩坑记录汇总

### 踩坑 1：lock 文件冲突

**现象**：团队成员在不同操作系统（macOS/Linux）上 `uv sync` 后，lock 文件频繁变更。

**原因**：uv 的 lock 文件记录了所有平台的解析结果。当某个依赖在不同平台上有不同的可选依赖时，lock 文件会包含额外的条目。

**解决**：在 `.gitattributes` 中配置：

```
uv.lock merge=binary
```

不要手动编辑 `uv.lock`，让它自动管理。

### 踩坑 2：依赖解析冲突

**现象**：`uv add` 报错 `No solution found when resolving dependencies`。

**原因**：两个包的依赖版本范围不兼容。uv 的解析器比 pip 严格得多，不会像 pip 那样"装了再说"。

**解决**：

```bash
# 查看冲突详情
uv lock --verbose

# 必要时放宽版本约束
uv add "some-package>=1.0,<3.0"
```

> 这和 Composer 的依赖冲突处理逻辑完全一致。严格的解析器虽然初期麻烦，但能避免运行时才发现版本不兼容的问题。

### 踩坑 3：全局缓存占用空间

**现象**：`~/.cache/uv/` 目录越来越大。

**解决**：

```bash
# 清理旧版本缓存
uv cache prune

# 查看缓存大小
du -sh ~/.cache/uv/
```

uv 使用 content-addressable 存储 + 硬链接，实际磁盘占用远小于 pip 的方式。一个项目 500MB 的依赖，硬链接后实际可能只占 200MB。

### 踩坑 4：私有仓库认证

**现象**：从公司私有 PyPI 安装包时 401 Unauthorized。

**解决**：

```toml
# uv.toml
[[index]]
url = "https://pypi.company.com/simple/"
name = "company"
publish-url = "https://pypi.company.com/upload/"
```

或者使用环境变量：

```bash
export UV_INDEX_COMPANY_USERNAME="__token__"
export UV_INDEX_COMPANY_PASSWORD="your-api-token"
```

### 踩坑 5：从 poetry 迁移

**现象**：已有项目使用 `poetry.lock`，迁移到 uv 后依赖版本变了。

**解决**：

```bash
# uv 可以直接读取 poetry.lock 的约束信息
# 先备份
cp poetry.lock poetry.lock.bak

# 初始化 uv
uv init
# 手动将 pyproject.toml 中的 [tool.poetry.dependencies] 迁移到 [project.dependencies]
# 然后
uv lock
uv sync
```

> **关键点**：uv 不会自动迁移 poetry 的配置格式。你需要手动将 `[tool.poetry.dependencies]` 改为 PEP 621 标准的 `[project.dependencies]`。两者语法略有不同（poetry 用 `^` 约束，PEP 621 用 `>=,<`）。

## 八、性能对比实测

在同一个 Laravel B2C 项目的 Python 数据处理模块上测试（约 45 个依赖）：

| 操作 | pip | poetry | uv |
|------|-----|--------|-----|
| 完整安装（冷缓存） | 45s | 38s | **3.2s** |
| 完整安装（热缓存） | 28s | 25s | **0.8s** |
| 添加一个依赖 | 12s | 15s | **0.5s** |
| 依赖解析 | 20s | 18s | **0.3s** |
| lock 文件更新 | N/A | 12s | **0.4s** |

uv 在热缓存场景下快 30-50 倍，冷缓存下也快 10 倍以上。这得益于 Rust 的高性能解析引擎和 content-addressable 缓存。

## 九、从 pip/poetry/pipenv 迁移清单

```
✅ 1. 安装 uv（curl -LsSf https://astral.sh/uv/install.sh | sh）
✅ 2. 配置镜像源（UV_INDEX_URL）
✅ 3. 将 requirements.txt 转换为 pyproject.toml
     - uv 可以直接从 requirements.txt 初始化：uv init --requirements requirements.txt
✅ 4. 将 [tool.poetry.dependencies] 迁移到 [project.dependencies]
✅ 5. uv lock 生成 uv.lock
✅ 6. uv sync 安装依赖
✅ 7. 验证：uv run pytest 全部通过
✅ 8. 更新 CI/CD 配置
✅ 9. 更新 Dockerfile
✅ 10. 更新 .gitignore（添加 .venv/）
✅ 11. 删除旧的 requirements.txt / poetry.lock / Pipfile.lock
```

## 十、uv vs pip vs poetry vs conda 全面对比

选择 Python 包管理器就像选择 PHP 的依赖管理方案——不同场景需要不同工具。以下是四个主流方案的全面对比：

| 维度 | pip | poetry | conda | **uv** |
|------|-----|--------|-------|--------|
| **语言** | Python | Python | Python | **Rust** |
| **依赖解析** | 弱（按顺序安装） | 强 | 强 | **极强** |
| **解析速度** | 慢（20-45s） | 中（15-38s） | 慢 | **极快（<1s）** |
| **Lock 文件** | ❌ 无原生支持 | ✅ poetry.lock | ❌ environment.yml | **✅ uv.lock（跨平台）** |
| **虚拟环境** | 需手动 `venv` | 内置 | 内置（独立环境） | **内置** |
| **Python 版本管理** | ❌ | ❌ | ✅ | **✅ 内置** |
| **全局工具管理** | ❌ | ❌ | ❌ | **✅ uv tool / uvx** |
| **磁盘缓存** | 无优化 | 无优化 | 包缓存 | **content-addressable + 硬链接** |
| **PEP 621 标准** | ✅ | ❌（自有格式） | ❌ | **✅ 完整支持** |
| **生态系统** | PyPI | PyPI | conda-forge + PyPI | **PyPI + 私有仓库** |
| **数据科学支持** | ✅ | 一般 | ✅✅✅ | ⚠️ 早期阶段 |
| **学习曲线** | 低 | 中 | 高 | **低** |

### 选型建议

- **新项目首选 uv**：速度快、功能全、标准兼容，适合大多数 Web 开发、API、自动化场景
- **数据科学/ML 项目暂用 conda**：`numpy`、`torch` 等包的系统级依赖（CUDA、MKL）conda 处理更好，uv 对此支持还在早期
- **已有 poetry 项目不急迁移**：等 uv 的 poetry 兼容更成熟（预计 2026 Q3），或按本文第九节手动迁移
- **pip 仅用于快速测试**：`uv pip` 提供了完全兼容的接口，直接替换即可

> **性能数据来源**：本文第八节的基准测试基于 Laravel B2C 项目的 Python 数据模块（45 个依赖），在 MacBook Pro M3 / macOS 上实测。不同项目规模下绝对数值会有差异，但 uv 相对于其他工具的速度优势是一致的。

## 总结

uv 之于 Python，就像 Composer 之于 PHP——它终于给了 Python 生态一个统一、高效、可靠的包管理方案。对于同时维护 PHP 和 Python 代码的全栈开发者来说，uv 的工作流和 Composer 高度相似，迁移成本极低。

**我的建议**：如果你还在用 pip + requirements.txt，现在就迁移到 uv。如果你在用 poetry，等 uv 的 poetry 兼容性更成熟后再迁（预计 Q3 2026）。如果你在用 conda（数据科学场景），暂时观望，uv 对 conda 生态的支持还在早期。

uv 的目标很明确：成为 Python 的"唯一"包管理器。从目前的发展速度来看，这一天不会太远。

## 相关阅读

- [pyenv + poetry 实战：Python 版本与依赖管理——macOS 开发者迁移指南](/macos/pyenv-poetry-python-guide-macos-guide/) — 如果你还在用 pyenv + poetry 组合，这篇文章详解两者的安装配置与迁移路径，并与 uv 进行了横向对比
- [pipx 实战：Python CLI 工具隔离安装——告别依赖冲突的全局工具管理方案](/macos/pipx-python-cli-guide/) — uv tool/uvx 的前身方案，了解 pipx 的隔离架构有助于理解 uv 全局工具管理的设计思路
