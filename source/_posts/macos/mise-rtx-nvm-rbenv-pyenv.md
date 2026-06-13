---

title: mise (rtx) 实战：多语言版本管理替代 nvm/rbenv/pyenv 的统一方案
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
description: 本文系统讲解 mise（原 rtx）在 macOS 下统一管理 Node.js、Python、PHP、Ruby 多语言版本的实战方法，覆盖安装、.mise.toml 配置、替代 nvm/pyenv/rbenv/asdf 的对比、常见踩坑、团队协作与迁移方案。
date: 2026-06-01 10:00:00
categories:
  - macos
keywords: [mise, rtx, nvm, rbenv, pyenv, 多语言版本管理替代, 的统一方案]
tags:
- mise
- rtx
- version-manager
- nvm
- pyenv
- rbenv
- PHP
- Python
- Node.js
- macOS
- asdf
- dev-environment
- CI/CD
---




## 一、为什么写这篇？（痛点/背景）

作为 Laravel 后端开发者，我的日常开发环境里同时跑着多个语言版本：

- **PHP 8.0 / 8.1 / 8.3**：不同 Laravel 项目对 PHP 版本有不同要求
- **Python 3.11 / 3.12**：AI Agent 开发、数据处理脚本
- **Node.js 18 / 20 / 22**：Vue 3 前端构建、Vite、uni-app
- **Ruby**：Jekyll 博客构建（Hexo 用 Node，但偶尔也需要 Ruby）

以前我的 Mac 上装了四套版本管理工具：

| 工具 | 管理语言 | Shell 集成 | 痛点 |
|------|---------|-----------|------|
| `nvm` | Node.js | `.nvmrc` + `nvm use` | 启动慢（~300ms），每个 terminal tab 都要加载 |
| `pyenv` | Python | `.python-version` + `pyenv shell` | 需要编译，偶尔和 Homebrew 冲突 |
| `rbenv` | Ruby | `.ruby-version` | 和 rvm 混用会出问题 |
| `brew-php-switcher` | PHP | 手动切换 | 无法项目级自动切换 |

**核心痛点：**

1. **四套工具，四种配置文件**：`.nvmrc`、`.python-version`、`.ruby-version`、PHP 要手动切换
2. **Shell 启动变慢**：nvm 的 bash 初始化脚本就要 300ms+
3. **版本不一致**：团队成员用不同工具管理，经常出现 "我这里跑得好好的" 问题
4. **全局 vs 项目级混乱**：有时候忘了 `nvm use`，跑到全局 Node 16 上构建报错

**mise（原 rtx）** 的出现就是为了解决这个问题 — **一个工具管理所有语言版本**。

---

## 二、核心概念/原理

### 2.1 mise 是什么？

`mise`（原名 `rtx`，是 `asdf` 的 Rust 重写）是一个 **polyglot 版本管理器**，用一个工具管理所有编程语言版本。

核心设计理念：
- **统一配置文件**：一个 `.mise.toml`（或兼容 `.tool-versions`）管理所有语言版本
- **即装即用**：无需编译，直接下载预编译二进制
- **自动切换**：进入项目目录自动切换版本（类似 `autoenv`）
- **Shell 零开销**：Rust 实现，Shell 激活仅需 ~10ms

### 2.2 与 asdf 的关系

| 维度 | asdf | mise |
|------|------|------|
| 语言 | Rust + Shell 插件 | Rust（原生） |
| 插件系统 | asdf plugins（GitHub 仓库） | 兼容 asdf plugins + 原生 ubi/fox |
| 速度 | 较慢（Shell 脚本） | 快（Rust 二进制） |
| 配置文件 | `.tool-versions` | `.mise.toml`（兼容 `.tool-versions`） |
| 社区 | 成熟 | 快速增长，兼容 asdf 生态 |

mise 完全兼容 asdf 的插件生态，但速度更快、配置更灵活。

### 2.3 版本解析优先级

mise 的版本解析有明确的优先级链：

```
1. MISE_<TOOL>_VERSION 环境变量（最高优先级）
2. .mise.toml（项目目录）
3. .tool-versions（asdf 兼容）
4. ~/.config/mise/config.toml（全局配置）
5. 系统已安装版本（最低优先级）
```

这意味着你可以在项目级别精确控制版本，同时通过环境变量覆盖来处理特殊情况。

### 2.4 插件来源（三种模式）

```toml
# 1. 短名称 — 使用 mise 官方 registry（类似 npm 包名）
[tools]
node = "20"
python = "3.12"
php = "8.3"

# 2. asdf 插件 — 兼容 asdf 的完整插件生态
[tools]
java = "temurin-21"

# 3. ubi — 直接从 GitHub Releases 安装二进制
[tools]
"ubi:BurntSushi/ripgrep" = "latest"

# 4. fox — 快速安装预编译二进制
[tools]
"go:github.com/golangci/golangci-lint" = "1.57"
```

---

## 三、实战代码

### 3.1 安装 mise

```bash
# Homebrew（推荐 macOS）
brew install mise

# 或者 curl 安装
curl https://mise.run | sh

# 验证安装
mise --version
# mise 2025.x.x
```

### 3.2 Shell 集成

```bash
# ~/.zshrc（Oh My Zsh 用户）
eval "$(mise activate zsh)"

# ~/.bashrc
eval "$(mise activate bash)"

# Fish
mise activate fish | source

# 重要：放在 PATH 设置之后、nvm/pyenv 之前
```

**性能对比（Shell 启动时间）：**

```bash
# 使用 nvm + pyenv + rbenv
$ time (source ~/.zshrc)
0.89s

# 切换到 mise（移除 nvm/pyenv/rbenv）
$ time (source ~/.zshrc)
0.12s

# 提速 7x+
```

### 3.3 安装和管理语言版本

```bash
# 查看可用版本
mise ls-remote node
mise ls-remote python
mise ls-remote php

# 安装指定版本
mise install node@20
mise install node@22
mise install python@3.12
mise install php@8.3
mise install ruby@3.3

# 安装最新稳定版
mise install node@lts
mise install python@latest

# 查看已安装版本
mise ls

# 设置全局默认版本
mise use --global node@22
mise use --global python@3.12
mise use --global php@8.3

# 设置项目级版本（写入 .mise.toml）
cd ~/GitHub/mikeah2011.github.io
mise use node@20    # Hexo 博客用 Node 20

cd ~/GitHub/laravel-b2c-api
mise use php@8.3    # B2C 项目用 PHP 8.3
```

### 3.4 项目级配置实战

在 Laravel B2C API 项目中：

```toml
# ~/GitHub/laravel-b2c-api/.mise.toml
[tools]
php = "8.3"
node = "20"
python = "3.12"

# 可选：项目级环境变量
[env]
APP_ENV = "local"
DB_HOST = "127.0.0.1"
REDIS_HOST = "127.0.0.1"
```

在 Hexo 博客项目中：

```toml
# ~/GitHub/mikeah2011.github.io/.mise.toml
[tools]
node = "20.11"

[env]
NODE_ENV = "development"
```

**自动切换效果：**

```bash
~/GitHub $ cd laravel-b2c-api
mise: php@8.3.6        installed
mise: node@20.11.1     installed
mise: python@3.12.2    installed

~/GitHub/laravel-b2c-api $ php -v
PHP 8.3.6 (cli) ...

~/GitHub/laravel-b2c-api $ cd ../mikeah2011.github.io
mise: node@20.11.1     activated

~/GitHub/mikeah2011.github.io $ node -v
v20.11.1
```

### 3.5 替代 nvm 的完整工作流

以前用 nvm 的典型工作流：

```bash
# ❌ 旧方式
echo "20" > .nvmrc
nvm install    # 每次切项目都要手动跑
nvm use        # 容易忘记
```

现在用 mise：

```bash
# ✅ 新方式
mise use node@20    # 自动写入 .mise.toml
cd .                # 自动激活，零手动操作
```

### 3.6 和 Composer/pip/npm 配合

mise 支持在安装语言版本后自动运行钩子：

```toml
# .mise.toml
[tools]
php = "8.3"
node = "20"

# 安装 PHP 后自动运行 composer install
[hooks]
post_install = "composer install --no-interaction"

# 进入目录后提示
[min_version]
mise = "2024.1.0"
```

也可以配合 mise tasks 做更多事：

```toml
# .mise.toml
[tasks.dev]
run = "php artisan serve"
description = "Start Laravel dev server"

[tasks.test]
run = "php artisan test --parallel"
description = "Run tests in parallel"

[tasks.build]
run = ["npm run build", "php artisan optimize"]
description = "Build frontend and optimize"
```

运行方式：

```bash
mise run dev
mise run test
mise run build

# 或简写
mise r dev
```

### 3.7 与 brew-php-switcher 的对比

以前管理 PHP 版本用 `brew-php-switcher`：

```bash
# ❌ 旧方式
brew install php@8.0 php@8.1 php@8.3
sphp 8.3    # 全局切换，影响所有项目
```

现在用 mise：

```bash
# ✅ 新方式
mise install php@8.0
mise install php@8.1
mise install php@8.3

# 项目级自动切换，无需手动
cd ~/GitHub/legacy-api      # 自动用 PHP 8.0
cd ~/GitHub/laravel-b2c-api # 自动用 PHP 8.3
```

### 3.8 Python 管理（替代 pyenv）

```bash
# 安装 Python（直接下载预编译，不需要编译等待）
mise install python@3.11
mise install python@3.12

# 全局默认
mise use --global python@3.12

# 项目级
cd ~/GitHub/ai-agent-tool
mise use python@3.11    # 某些 AI 库需要 3.11
```

**对比 pyenv：**

| 维度 | pyenv | mise |
|------|-------|------|
| 安装速度 | 慢（需要编译） | 快（预编译二进制） |
| 依赖 | 需要 openssl/readline 等 | 自包含 |
| Shell 集成 | `pyenv init` ~200ms | `mise activate` ~10ms |
| 虚拟环境 | pyenv-virtualenv 插件 | 内置 `mise install python@3.12 --venv` |

### 3.9 多环境配置

mise 支持 `mise.toml` 的环境分层：

```toml
# .mise.toml — 基础配置
[tools]
php = "8.3"
node = "20"

[env]
APP_ENV = "local"

# .mise.production.toml — 生产环境覆盖（不提交到 git）
[env]
APP_ENV = "production"
```

也可以使用条件配置：

```toml
# .mise.toml
[tools]
php = "8.3"

[env]
# 根据环境变量设置
_.path = ["./vendor/bin", "./node_modules/.bin"]

# mise 会自动将 vendor/bin 和 node_modules/.bin 加入 PATH
```

---

## 四、踩坑记录

### 坑 1：nvm 和 mise 并存冲突

**现象：** 安装 mise 后没有移除 nvm，导致 `node` 命令混乱。

**根因：** nvm 的 `~/.nvm/alias/default` 设置了全局 Node 版本，和 mise 的版本互相覆盖，取决于 PATH 顺序。

**解决：**

```bash
# 1. 移除 ~/.zshrc 中的 nvm 相关配置
# 删除以下行：
# export NVM_DIR="$HOME/.nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 2. 移除 ~/.zshrc 中的 pyenv 配置
# eval "$(pyenv init -)"

# 3. 只保留 mise
eval "$(mise activate zsh)"

# 4. 重新加载
source ~/.zshrc
```

### 坑 2：PHP 安装报错 — 缺少扩展

**现象：** `mise install php@8.3` 时提示缺少 `libxml2`、`openssl` 等依赖。

**根因：** mise 的 PHP 插件默认使用 `php-build`，需要系统预装编译依赖。

**解决：**

```bash
# macOS 先装好依赖
brew install libxml2 libpng openssl@3 sqlite3 oniguruma

# 然后安装
mise install php@8.3

# 或者使用预编译版本（更快）
MISE_PHP_INSTALL=precompiled mise install php@8.3
```

### 坑 3：.tool-versions 和 .mise.toml 冲突

**现象：** 项目里同时有 `.tool-versions`（asdf）和 `.mise.toml`，版本不一致导致混乱。

**根因：** mise 优先读 `.mise.toml`，但 `.tool-versions` 可能是其他同事用 asdf 时创建的。

**解决：**

```bash
# 统一到 .mise.toml
mise use --pin node@20    # 写入 .mise.toml

# 然后删除 .tool-versions（或者在 .gitignore 中忽略）
rm .tool-versions
git commit -m "chore: migrate from .tool-versions to .mise.toml"
```

### 坑 4：Shims 冲突

**现象：** 安装 mise 后，`which node` 还是指向 Homebrew 的 `/opt/homebrew/bin/node`。

**根因：** mise 默认使用 shims 模式，但 Homebrew 安装的 node 优先级更高。

**解决：**

```bash
# 方式 1：使用 activate 模式（推荐，比 shims 更快）
eval "$(mise activate zsh)"

# 方式 2：手动调整 PATH 顺序
# 在 ~/.zshrc 中，确保 mise activate 在 Homebrew 之前
eval "$(mise activate zsh)"  # 放在最前面
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 坑 5：团队成员没有 mise

**现象：** `.mise.toml` 提交到 Git，但团队成员用的是 asdf 或者没装版本管理工具。

**解决：**

```bash
# 方案 1：同时保留 .tool-versions（兼容 asdf 用户）
mise use --pin node@20    # 写入 .mise.toml
mise generate git-pre-commit  # 可选：自动生成

# 方案 2：在 README 中说明推荐使用 mise
## 开发环境
推荐使用 [mise](https://mise.jdx.dev/) 管理语言版本：
brew install mise
mise install

# 方案 3：使用 mise trust 自动信任项目配置
cd ~/GitHub/laravel-b2c-api
mise trust    # 信任当前项目的 .mise.toml
```

### 坑 6：M 芯片 Mac 上 PHP 编译问题

**现象：** Apple Silicon Mac 上安装旧版 PHP（如 7.4）编译失败。

**根因：** PHP 7.x 不支持 ARM64 架构。

**解决：**

```bash
# 方案 1：使用 Rosetta 2 运行 x86 版本
arch -x86_64 mise install php@7.4

# 方案 2：升级项目到 PHP 8.x（推荐）
# 大部分 Laravel 8+ 项目都能跑在 PHP 8.0+

# 方案 3：使用 Docker 容器运行旧版 PHP
docker run --rm -v $(pwd):/app -w /app php:7.4-cli php script.php
```

---

## 五、对比/选型建议

### 5.1 全面对比矩阵

| 维度 | mise | nvm | pyenv | rbenv | brew-php-switcher | asdf |
|------|------|-----|-------|-------|-------------------|------|
| **管理语言** | 全部 | Node | Python | Ruby | PHP | 全部 |
| **实现语言** | Rust | Bash | Python | Shell | Bash | Shell |
| **Shell 启动** | ~10ms | ~300ms | ~200ms | ~50ms | N/A | ~500ms |
| **版本切换** | 自动 | 手动 | 手动 | 手动 | 手动 | 自动 |
| **配置文件** | `.mise.toml` | `.nvmrc` | `.python-version` | `.ruby-version` | 无 | `.tool-versions` |
| **安装速度** | 快 | 中 | 慢（编译） | 中 | 快 | 慢 |
| **跨平台** | ✅ | ✅ | ✅ | ✅ | ❌ macOS | ✅ |
| **学习成本** | 低 | 低 | 中 | 低 | 低 | 中 |

### 5.2 选型建议

**推荐使用 mise 的场景：**
- ✅ 同时使用 2+ 种编程语言
- ✅ macOS 开发者（尤其是 Apple Silicon）
- ✅ 团队协作，需要项目级版本统一
- ✅ 追求 Shell 启动速度
- ✅ 希望一个工具管所有

**可以继续用现有工具的场景：**
- 只用 Node.js → `nvm` 够用（但推荐 mise）
- 只用 Python → `pyenv` + `virtualenv` 够用
- 已有成熟 CI/CD 配置 → 迁移成本考虑

### 5.3 迁移策略（渐进式）

```bash
# Phase 1：安装 mise，先管 Node
brew install mise
eval "$(mise activate zsh)"
mise use --global node@22

# Phase 2：验证稳定后，移除 nvm
# 从 ~/.zshrc 删除 nvm 配置

# Phase 3：逐步迁移 Python、Ruby、PHP
mise use --global python@3.12
mise use --global php@8.3

# Phase 4：移除 pyenv、rbenv、brew-php-switcher
# 项目级配置切换到 .mise.toml
```

---

## 5.4 迁移映射表：从旧工具迁到 mise

| 旧工具/习惯 | 旧命令 | mise 对应命令 | 迁移说明 |
|------|------|------|------|
| `nvm install 20` | 安装 Node 20 | `mise install node@20` | 不再依赖 `.nvmrc` 手动切换 |
| `nvm use 20` | 切换当前 shell Node 版本 | `mise shell node@20` 或进入含 `.mise.toml` 的目录自动切换 | 临时与项目级都能覆盖 |
| `pyenv install 3.12.3` | 安装 Python | `mise install python@3.12.3` | 大多数场景不必手动编译 |
| `pyenv local 3.12.3` | 项目级 Python | `mise use python@3.12.3` | 自动写入 `.mise.toml` |
| `rbenv local 3.3.0` | 项目级 Ruby | `mise use ruby@3.3.0` | 与 Node/Python/PHP 放在同一配置里 |
| `asdf install` | 按 `.tool-versions` 安装 | `mise install` | mise 可直接读取 `.tool-versions` |
| `asdf local nodejs 20` | 项目级版本声明 | `mise use node@20` | 推荐逐步迁移为 `.mise.toml` |
| `sphp 8.3` | 全局切 PHP | `mise use --global php@8.3` | 更适合团队统一与项目隔离 |

### 5.5 可直接运行的项目初始化示例

下面给出一个从零初始化多语言项目的最小可运行流程，复制后即可验证 mise 是否正常工作：

```bash
# 1) 创建演示目录
mkdir -p ~/tmp/mise-demo && cd ~/tmp/mise-demo

# 2) 写入项目版本声明
mise use node@20 python@3.12

# 3) 安装当前项目需要的语言版本
mise install

# 4) 验证版本是否生效
node -v
python -V
mise current
```

如果输出中能看到 `node 20.x`、`Python 3.12.x`，说明项目级版本管理已经生效。

### 5.6 前端 + 后端 + 脚本仓库统一配置示例

```toml
# .mise.toml
[tools]
node = "20.11"
python = "3.12"
php = "8.3"
pnpm = "9"

[env]
_.path = ["./node_modules/.bin", "./vendor/bin"]
NODE_ENV = "development"
APP_ENV = "local"

[tasks.install]
run = [
  "npm install",
  "composer install --no-interaction",
  "python -m venv .venv"
]
description = "初始化前端、PHP 与 Python 环境"

[tasks.check]
run = [
  "node -v",
  "php -v",
  "python -V"
]
description = "检查当前激活版本"
```

运行：

```bash
mise install
mise run check
```

### 5.7 常见排查命令速查

当你怀疑版本没有按预期切换时，优先运行下面几组命令：

```bash
# 查看当前生效版本与来源
mise current
mise which node
mise which python
mise which php

# 查看某个工具为什么选中了这个版本
mise doctor
mise settings

# 检查 PATH 顺序
command -v node
command -v python
command -v php
```

典型判断方式：

- `command -v node` 指向 Homebrew 路径而不是 mise 管理目录，通常说明 shell 初始化顺序不对。
- `mise current` 没显示项目版本，通常说明当前目录没有 `.mise.toml`，或配置还没被 `mise trust` 信任。
- `mise which php` 找不到结果，通常说明该语言版本还没安装，应先执行 `mise install php@版本号`。

### 5.8 团队协作建议

| 场景 | 推荐做法 | 原因 |
|------|------|------|
| 新项目初始化 | 提交 `.mise.toml` 到仓库 | 团队成员进入目录即可获得一致版本 |
| 历史项目迁移 | 先兼容 `.tool-versions`，再逐步切换到 `.mise.toml` | 降低一次性迁移风险 |
| CI/CD | 使用 `jdx/mise-action@v2` 或先安装 mise 后执行 `mise install` | 本地与 CI 版本声明一致 |
| README 文档 | 增加 `brew install mise && mise install` | 新同事上手更快 |
| 本地任务编排 | 使用 `mise tasks` 统一 `dev/test/build` | 替代散落的 shell 脚本或 Makefile |

### 5.9 mise 与常见工具的最终建议

| 你的现状 | 建议 |
|------|------|
| 只管理 Node，且没有团队协作要求 | 可继续用 `nvm`，但新项目更推荐 mise |
| 同时维护 Node + Python | 直接迁到 mise，收益明显 |
| 还在用 `brew-php-switcher` 管 PHP | 优先迁移，项目级切换体验提升最大 |
| 已大规模使用 asdf | 可先保留 `.tool-versions`，再逐步增加 `.mise.toml` |
| Apple Silicon 上频繁切旧版本 | mise + Docker / Rosetta 混合方案更稳 |

---

## 六、总结与最佳实践

### 最佳实践清单

1. **全局配置放在 `~/.config/mise/config.toml`**
   ```toml
   [tools]
   node = "22"
   python = "3.12"
   php = "8.3"
   ```

2. **项目配置放在 `.mise.toml`**，提交到 Git
   ```toml
   [tools]
   php = "8.3"
   node = "20"
   ```

3. **使用 `mise use` 而不是手动编辑**
   ```bash
   mise use node@20    # 自动写入正确的格式
   ```

4. **Shell 集成用 `activate` 模式**，不用 `shims`
   ```bash
   eval "$(mise activate zsh)"  # 更快
   ```

5. **配合 `.gitignore`**
   ```
   # .gitignore
   .mise/
   !.mise.toml
   ```

6. **CI/CD 中使用 mise**
   ```yaml
   # GitHub Actions
   - uses: jdx/mise-action@v2
     with:
       version: latest
   ```

7. **善用 `mise tasks` 替代 Makefile/scripts**
   ```toml
   [tasks.start]
   run = "php artisan serve"
   
   [tasks.deploy]
   run = "php artisan deploy"
   depends = ["test"]
   ```

### 最终配置示例

```bash
# ~/.zshrc 关键配置
eval "$(mise activate zsh)"

# ~/.config/mise/config.toml
[tools]
node = "22"
python = "3.12"
php = "8.3"
ruby = "3.3"
```

```toml
# Laravel 项目 .mise.toml
[tools]
php = "8.3"
node = "20"

[env]
APP_ENV = "local"
DB_DATABASE = "laravel"
```

```toml
# 前端项目 .mise.toml
[tools]
node = "22"
pnpm = "9"
```

### 一句话总结

**mise = nvm + pyenv + rbenv + brew-php-switcher + Makefile**，用一个 Rust 二进制解决所有语言版本管理问题，Shell 启动从 800ms 降到 12ms。如果你的 Mac 上装了两个以上的版本管理工具，是时候统一到 mise 了。

---

## 七、CI/CD 集成

### GitHub Actions 集成

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # 方式一：使用 mise-action（推荐）
      - uses: jdx/mise-action@v2
        with:
          version: latest
          install: true       # 自动安装 .mise.toml 中声明的工具
          cache: true          # 缓存已安装的工具版本

      # 方式二：手动安装（更精细控制）
      # - name: Install mise
      #   run: curl https://mise.run | sh && mise install
      # - name: Activate mise
      #   run: echo "$HOME/.local/bin" >> $GITHUB_PATH

      - name: Verify versions
        run: |
          mise current
          php -v
          node -v
          python --version

      - name: Install dependencies
        run: mise run install

      - name: Run tests
        run: mise run test
```

### GitLab CI 集成

```yaml
# .gitlab-ci.yml
image: ubuntu:22.04

before_script:
  - apt-get update && apt-get install -y curl git
  - curl https://mise.run | sh
  - export PATH="$HOME/.local/bin:$PATH"
  - mise install
  - eval "$(mise activate bash)"

test:
  script:
    - mise run test
```

### Docker 中使用 mise

```dockerfile
FROM ubuntu:22.04

# 安装 mise
RUN apt-get update && apt-get install -y curl && curl https://mise.run | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app
COPY .mise.toml .

# 安装项目依赖的工具版本
RUN mise install

# 复制源码并运行
COPY . .
CMD ["mise", "run", "start"]
```

### 性能基准：Shell 启动时间对比

```bash
# 测试环境：macOS Sonoma, Apple M2, zsh 5.9

# 方案 A：nvm + pyenv + rbenv（旧配置）
$ hyperfine --warmup 3 'zsh -i -c exit'
Benchmark 1: zsh -i -c exit
  Time (mean ± σ):     890ms ±  12ms    [User: 620ms, System: 280ms]

# 方案 B：mise（新配置）
$ hyperfine --warmup 3 'zsh -i -c exit'
Benchmark 1: zsh -i -c exit
  Time (mean ± σ):     118ms ±   3ms    [User: 85ms, System: 35ms]

# 提速 7.5x，每次打开终端节省 ~770ms
```

```bash
# 版本切换速度对比
# nvm use 20
$ time nvm use 20
nvm use 20  0.35s user 0.12s system 98% cpu 0.478 total

# mise use node@20（已安装时）
$ time mise use node@20
mise use node@20  0.01s user 0.00s system 95% cpu 0.012 total

# 切换速度快 40x
```

---

## 相关阅读

- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/CI/CD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
- [Docker Compose + PHP-FPM 实战：KKday B2C API 微服务部署经验](/categories/DevOps/docker-compose-php-fpmguide-microservicesdeployment/)
- [Helm-Chart-实战-Laravel-应用打包与部署踩坑记录](/categories/DevOps/helm-chart-guide-laravel-deployment/)
- [ArgoCD GitOps 实战：Laravel 应用持续部署与回滚踩坑记录](/categories/DevOps/argocd-gitops-guide-laravel-cd/)
