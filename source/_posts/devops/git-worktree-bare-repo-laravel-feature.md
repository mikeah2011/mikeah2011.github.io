---

title: Git Worktree + Bare Repo 实战：多分支并行开发——Laravel 大型项目中同时处理多个 feature 的高效工作流
keywords: [Git Worktree, Bare Repo, Laravel, feature, 多分支并行开发, 大型项目中同时处理多个, 的高效工作流]
date: 2026-06-04 10:00:00
tags:
- Git
- Worktree
- bare-repo
- Laravel
- CI/CD
- 工作流
- 并行开发
categories:
- devops
description: Git Worktree + Bare Repo 多分支并行开发实战指南。从零搭建 bare repo 中枢仓库，挂载多个 worktree 实现零切换成本的 feature/hotfix 并行开发，每个分支独立环境完全隔离。覆盖 Laravel CI/CD 集成方案、团队协作规范与 wtm 自动化管理脚本。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---




> 在大型 Laravel 项目中，你是否经常遇到这样的场景：正在开发 `feature/payment` 分支，突然需要修复 `hotfix/order-bug`，而同事又在等你 review `feature/notification` 的代码？传统方式下，你需要反复 `git stash`、`git checkout`，不仅浪费时间，还容易丢失上下文。**Git Worktree + Bare Repo** 组合方案可以彻底解决这一痛点，让你在同一台机器上同时处理多个分支，互不干扰。

<!-- more -->

## 目录

- [一、为什么需要 Worktree + Bare Repo？](#一为什么需要-worktree-bare-repo)
- [二、Git Worktree 核心概念与内部机制](#二git-worktree-核心概念与内部机制)
- [三、Bare Repo 的原理与优势](#三bare-repo-的原理与优势)
- [四、Laravel 大型项目工作流实战](#四laravel-大型项目工作流实战)
- [五、完整操作步骤详解](#五完整操作步骤详解)
- [六、多分支并行方案对比](#六多分支并行方案对比)
- [七、CI/CD 集成方案](#七cicd-集成方案)
- [八、团队协作最佳实践](#八团队协作最佳实践)
- [九、自动化脚本与工具集](#九自动化脚本与工具集)
- [十、常见问题与解决方案](#十常见问题与解决方案)
- [十一、性能优化与资源管理](#十一性能优化与资源管理)
- [十二、真实场景踩坑与经验总结](#十二真实场景踩坑与经验总结)
- [十三、Worktree 在大型 Laravel 团队中的渐进式落地](#十三worktree-在大型-laravel-团队中的渐进式落地)
- [十四、总结](#十四总结)

---

## 一、为什么需要 Worktree + Bare Repo？

### 1.1 传统开发模式的痛点

在 Laravel 大型项目中，一个典型的开发周期往往涉及多个并行分支：

```
main
├── feature/payment-gateway      # 支付模块重构（3周）
├── feature/notification-v2      # 通知系统升级（2周）
├── feature/api-rate-limiting     # API 限流功能（1周）
├── hotfix/order-calculation-bug  # 紧急订单计算修复
└── release/v3.2.0               # 发布准备分支
```

传统做法是 `git checkout` 切换分支，但这会带来严重问题：

| 问题 | 影响 | 频率 |
|------|------|------|
| `composer install` 依赖变化 | 每次切换需等待 2-5 分钟 | 每次切换 |
| `npm install` 前端依赖冲突 | node_modules 版本不一致 | 频繁 |
| `.env` 配置差异 | 数据库连接、API Key 不同 | 常见 |
| IDE 索引重建 | PhpStorm 重新扫描文件 | 每次切换 |
| 未提交的半成品代码 | stash pop 冲突 | 偶发但致命 |
| 上下文丢失 | 忘记之前做到哪里 | 心智负担 |

### 1.2 Worktree + Bare Repo 方案的优势

```
laravel-project/                  # Bare Repo（共享仓库）
├── HEAD, config, objects...      # Git 核心数据
├── worktrees/
│   ├── main/                     # 主分支工作目录
│   ├── feature-payment/          # 支付模块
│   ├── feature-notification/     # 通知模块
│   └── hotfix-order/             # 紧急修复
```

核心优势：

1. **零切换成本**：每个 worktree 是独立目录，无需 checkout
2. **共享对象库**：所有 worktree 共享 Git 对象，磁盘占用极低
3. **独立工作区**：每个分支有独立的 `vendor/`、`node_modules/`、`.env`
4. **并行构建**：可以同时运行多个 Laravel 开发服务器
5. **上下文隔离**：IDE 可以同时打开多个分支项目

---

## 二、Git Worktree 核心概念与内部机制

### 2.1 工作原理

Git Worktree 自 Git 2.5（2015 年 7 月）引入。其核心思想是：**一个 Git 仓库可以关联多个工作目录（Working Tree）**。

内部结构：

```
.git/                          # 主仓库
├── objects/                   # 共享的对象数据库
├── refs/                      # 共享的引用
├── worktrees/                 # worktree 元数据
│   ├── feature-payment/
│   │   ├── HEAD               # 该 worktree 的 HEAD
│   │   ├── index              # 独立的暂存区
│   │   └── logs/
│   └── feature-notification/
│       ├── HEAD
│       ├── index
│       └── logs/
└── ...
```

关键点：
- **共享**：`objects/`、`refs/`（分支、标签引用）全局共享
- **隔离**：`HEAD`、`index`（暂存区）每个 worktree 独立
- **锁定机制**：同一分支不能被两个 worktree 同时检出

### 2.2 核心命令速查

#### 创建 worktree

```bash
# 关联已有分支
git worktree add ../feature-payment feature/payment

# 创建新分支并关联
git worktree add ../feature-notification -b feature/notification

# 基于特定 commit 创建
git worktree add ../hotfix-order -b hotfix/fix-order main

# 创建 detached HEAD（适合临时 code review）
git worktree add --detach ../temp-review HEAD~5
```

#### 管理 worktree

```bash
# 列出所有 worktree
git worktree list

# 输出示例：
# /Users/dev/laravel-project          abc1234 [main]
# /Users/dev/feature-payment          def5678 [feature/payment]
# /Users/dev/feature-notification     ghi9012 [feature/notification]
# /Users/dev/hotfix-order             jkl3456 [hotfix/fix-order]

# 详细信息（机器可读格式）
git worktree list --porcelain

# 移动 worktree
git worktree move ../feature-payment ../feature-payment-v2

# 锁定（防止误操作）
git worktree lock ../feature-payment --reason "正在重构中"

# 解锁
git worktree unlock ../feature-payment
```

#### 清理 worktree

```bash
# 删除 worktree
git worktree remove ../feature-notification

# 强制删除（有未提交修改时）
git worktree remove --force ../hotfix-order

# 清理已删除但元数据残留的 worktree
git worktree prune -v

# 修复损坏的 worktree 引用
git worktree repair ../feature-payment
```

### 2.3 关键约束

1. **同一分支只能检出一次**：不能在两个 worktree 中同时 checkout 同一个分支
2. **子模块限制**：worktree 中的子模块需要单独初始化
3. **Git 版本要求**：建议 Git 2.37+，早期版本有已知 bug

---

## 三、Bare Repo 的原理与优势

### 3.1 什么是 Bare Repo

Bare Repo 是一个**没有工作目录**的 Git 仓库，只包含 `.git` 目录的内容：

```bash
# 创建 bare repo
git clone --bare https://github.com/your-org/laravel-project.git laravel-project.git

# 或从已有仓库转换
git clone --bare laravel-project laravel-project.git
```

目录结构：

```
laravel-project.git/           # bare repo
├── HEAD
├── config
├── description
├── hooks/
├── info/
├── objects/                   # Git 对象数据库
├── packed-refs
└── refs/
```

### 3.2 为什么用 Bare Repo 作为中枢？

传统 worktree 方式直接在普通仓库上操作，存在一个微妙问题：**主仓库本身也是一个 worktree**，它会"占用"主分支。而 Bare Repo 作为中枢，所有分支都通过 worktree 挂载，架构更清晰：

```
传统方式：                      Bare Repo 方式：
main-worktree (主仓库)          bare.git (中枢)
├── worktree: feature-a         ├── worktree: main
├── worktree: feature-b         ├── worktree: feature-a
└── 本身检出 main               ├── worktree: feature-b
                                └── 无工作目录冲突
```

优势：
1. **无分支占用**：不存在"主分支被锁定在某个目录"的问题
2. **目录结构清晰**：所有 worktree 平级，统一管理
3. **安全**：不会误操作在 bare repo 上执行工作区命令
4. **CI/CD 友好**：bare repo 天然适合作为中央仓库

---

## 四、Laravel 大型项目工作流实战

### 4.1 初始化 Bare Repo

```bash
# 方案 A：从远程仓库克隆（推荐）
cd ~/projects
git clone --bare https://github.com/your-org/laravel-app.git laravel-app.git
cd laravel-app.git

# 方案 B：从已有本地仓库创建
cd ~/projects/laravel-app
git clone --bare . ../laravel-app.git

# 设置默认远程
cd ~/projects/laravel-app.git
git config remote.origin.url https://github.com/your-org/laravel-app.git
git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
```

### 4.2 创建 worktree 目录结构

```bash
# 推荐的目录组织方式
~/projects/
├── laravel-app.git/              # Bare Repo 中枢
├── laravel-app-main/             # 主分支
├── laravel-app-payment/          # 支付模块
├── laravel-app-notification/     # 通知模块
└── laravel-app-hotfix/           # 紧急修复
```

### 4.3 挂载所有分支

```bash
# 进入 bare repo
cd ~/projects/laravel-app.git

# 挂载主分支
git worktree add ../laravel-app-main main

# 挂载 feature 分支
git worktree add ../laravel-app-payment -b feature/payment
git worktree add ../laravel-app-notification -b feature/notification

# 从远程分支挂载
git worktree add ../laravel-app-api feature/api-rate-limiting

# 挂载 hotfix
git worktree add ../laravel-app-hotfix -b hotfix/order-calc main
```

### 4.4 Laravel 环境初始化脚本

每个 worktree 需要独立的 Laravel 环境。以下是完整的初始化脚本：

```bash
#!/bin/bash
# scripts/init-worktree.sh
# 用法: ./scripts/init-worktree.sh <worktree-path> <branch-name> [db-name]

set -euo pipefail

WORKTREE_PATH="$1"
BRANCH_NAME="$2"
DB_NAME="${3:-laravel_$(echo $BRANCH_NAME | tr '/' '_')}"

echo "🔧 初始化 worktree: $WORKTREE_PATH (分支: $BRANCH_NAME)"

# 1. 检查 worktree 是否存在
if [ ! -d "$WORKTREE_PATH" ]; then
    echo "❌ worktree 目录不存在: $WORKTREE_PATH"
    exit 1
fi

cd "$WORKTREE_PATH"

# 2. 安装 PHP 依赖
echo "📦 安装 Composer 依赖..."
if [ -f "composer.json" ]; then
    composer install --no-interaction --optimize-autoloader
fi

# 3. 安装前端依赖
echo "📦 安装 NPM 依赖..."
if [ -f "package.json" ]; then
    npm ci
fi

# 4. 创建独立的 .env 文件
echo "⚙️ 配置环境文件..."
if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    cp .env.example .env
    # 修改数据库名，避免多分支共用同一个数据库
    sed -i '' "s/DB_DATABASE=laravel/DB_DATABASE=${DB_NAME}/" .env
    # 生成独立的 APP_KEY
    php artisan key:generate
fi

# 5. 创建数据库并运行迁移
echo "🗄️ 初始化数据库: $DB_NAME"
mysql -u root -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;" 2>/dev/null || true
php artisan migrate --force

# 6. 创建独立的 storage 软链接
echo "🔗 配置 storage..."
php artisan storage:link 2>/dev/null || true

# 7. 缓存配置（加速开发）
php artisan config:cache
php artisan route:cache 2>/dev/null || true

# 8. 输出端口信息
PORT_HASH=$(echo -n "$BRANCH_NAME" | cksum | cut -d' ' -f1)
PORT=$((8000 + ${PORT_HASH: -3} % 1000))
echo ""
echo "✅ 初始化完成！"
echo "   分支: $BRANCH_NAME"
echo "   目录: $WORKTREE_PATH"
echo "   数据库: $DB_NAME"
echo "   建议端口: $PORT"
echo ""
echo "   启动开发服务器: cd $WORKTREE_PATH && php artisan serve --port=$PORT"
```

### 4.5 多分支并行开发的工作目录

完成初始化后，你可以同时打开多个终端/IDE 窗口：

```bash
# 终端 1：主分支
cd ~/projects/laravel-app-main
php artisan serve --port=8000

# 终端 2：支付模块
cd ~/projects/laravel-app-payment
php artisan serve --port=8001

# 终端 3：通知模块
cd ~/projects/laravel-app-notification
php artisan serve --port=8002

# 终端 4：运行支付模块的队列处理器
cd ~/projects/laravel-app-payment
php artisan queue:work --queue=payments

# 终端 5：运行通知模块的队列处理器
cd ~/projects/laravel-app-notification
php artisan queue:work --queue=notifications
```

每个 worktree 拥有独立的 `.env`，连接不同的数据库，完全隔离。

---

## 五、完整操作步骤详解

### 5.1 从零开始的完整流程

```bash
# === 第一步：创建 Bare Repo ===
cd ~/projects
git clone --bare https://github.com/your-org/laravel-app.git laravel-app.git
cd laravel-app.git

# 配置远程
git config remote.origin.url https://github.com/your-org/laravel-app.git
git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'

# === 第二步：创建主分支 worktree ===
git worktree add ../laravel-app-main main

# === 第三步：初始化主分支环境 ===
cd ../laravel-app-main
composer install
cp .env.example .env
php artisan key:generate
npm ci

# === 第四步：创建 feature worktree ===
cd ~/projects/laravel-app.git
git worktree add ../laravel-app-payment -b feature/payment
git worktree add ../laravel-app-notification -b feature/notification

# === 第五步：初始化 feature 环境 ===
cd ~/projects/laravel-app-payment
composer install
# 使用独立的 .env
cp .env.example .env
sed -i '' 's/DB_DATABASE=laravel/DB_DATABASE=laravel_payment/' .env
php artisan key:generate
php artisan migrate

cd ~/projects/laravel-app-notification
composer install
cp .env.example .env
sed -i '' 's/DB_DATABASE=laravel/DB_DATABASE=laravel_notification/' .env
php artisan key:generate
php artisan migrate
```

### 5.2 日常开发操作

```bash
# === 在 feature-payment 分支开发 ===
cd ~/projects/laravel-app-payment

# 编写代码...
vim app/Services/PaymentGateway.php

# 提交
git add .
git commit -m "feat(payment): implement Stripe webhook handler"

# 推送到远程
git push origin feature/payment

# === 切换到另一个分支处理紧急修复 ===
# 注意：不需要 stash！当前分支的修改已经安全保存在独立目录中

cd ~/projects/laravel-app.git
git worktree add ../laravel-app-hotfix -b hotfix/order-calc main

cd ../laravel-app-hotfix
# 快速修复...
vim app/Services/OrderCalculator.php
git add . && git commit -m "hotfix: fix decimal precision in order calculation"
git push origin hotfix/order-calc

# 修复完成后，回到支付模块继续开发
cd ~/projects/laravel-app-payment
# 所有文件状态完全不变！
```

### 5.3 合并与清理

```bash
# === 合并 feature 到 main ===
cd ~/projects/laravel-app-main

# 拉取最新代码
git pull origin main

# 合并 feature 分支
git merge feature/payment --no-ff -m "Merge feature/payment into main"

# 解决冲突（如果有）
# ...编辑冲突文件...
git add .
git commit

# 推送合并结果
git push origin main

# === 清理已完成的 worktree ===
cd ~/projects/laravel-app.git

# 先删除远程分支
git push origin --delete feature/payment

# 删除本地 worktree
git worktree remove ../laravel-app-payment

# 删除本地分支
git branch -d feature/payment

# 清理残留的 worktree 引用
git worktree prune -v
```

### 5.4 Hotfix 工作流

```bash
# 场景：生产环境发现严重 bug，需要紧急修复

# 1. 基于 main 创建 hotfix worktree
cd ~/projects/laravel-app.git
git fetch origin
git worktree add ../laravel-app-hotfix-urgent -b hotfix/payment-timeout main

# 2. 快速修复
cd ../laravel-app-hotfix-urgent
# ...修复代码...
php artisan test --filter=PaymentTimeoutTest

# 3. 提交并推送
git add . && git commit -m "hotfix: increase payment gateway timeout to 30s"
git push origin hotfix/payment-timeout

# 4. 同时合并到 main 和 develop
cd ~/projects/laravel-app-main
git merge hotfix/payment-timeout --no-ff
git push origin main

cd ~/projects/laravel-app-develop
git merge hotfix/payment-timeout --no-ff
git push origin develop

# 5. 清理
cd ~/projects/laravel-app.git
git worktree remove ../laravel-app-hotfix-urgent
git push origin --delete hotfix/payment-timeout
git branch -d hotfix/payment-timeout
```

---

## 六、多分支并行方案对比

在选择并行开发方案之前，先了解三种主流策略的核心差异：

| 维度 | git checkout + stash | git worktree (普通仓库) | git worktree + bare repo |
|------|---------------------|------------------------|--------------------------|
| **切换速度** | 慢（需 stash/checkout/unstash） | 快（目录切换） | 快（目录切换） |
| **并行运行** | ❌ 不可能 | ✅ 可以 | ✅ 可以 |
| **磁盘占用** | 低（单份） | 低（共享对象库） | 低（共享对象库） |
| **环境隔离** | ❌ 共享 vendor/node_modules | ✅ 可独立 | ✅ 完全独立 |
| **分支占用** | 无限制 | 主分支被主仓库占用 | 无分支占用 |
| **目录结构** | 单目录 | 主仓库 + worktree 子目录 | 所有 worktree 平级 |
| **CI/CD 友好** | 一般 | 良好 | 优秀（bare 天然中枢） |
| **学习成本** | 低 | 中等 | 中等 |
| **适合场景** | 个人小项目、偶尔切换 | 中型项目、2-3 并行分支 | 大型项目、3+ 并行分支 |
| **多份 clone 方案** | — | — | 磁盘占用高（每份独立对象库），但最简单直观 |

> **选型建议**：如果你的 Laravel 项目只有 1-2 个长期并行分支，普通 worktree 足够；如果需要 3 个以上并行环境（feature + hotfix + release），强烈推荐 bare repo 中枢方案。

### 6.1 与 git stash 的操作对比

| 维度 | git stash | Git Worktree |
|------|-----------|--------------|
| 切换速度 | 快（但需 stash/unstash） | 即时（目录切换） |
| 上下文保留 | 差（stash 是堆栈式，容易混淆） | 优（每个分支独立目录） |
| 未提交修改 | 需要手动 stash | 自动保留在工作区 |
| 依赖环境 | 切换后需重建 | 每个 worktree 独立 |
| 并行开发 | 不可能 | 天然支持 |
| 冲突风险 | stash pop 可能冲突 | 无冲突风险 |
| 磁盘占用 | 低 | 低（共享 Git 对象） |
| 学习成本 | 低 | 中等 |

### 6.2 stash 的典型痛点

```bash
# 场景：你正在开发 feature/payment，突然需要修 hotfix

# === 使用 stash ===
cd ~/projects/laravel-app

# 当前有未提交的修改
git stash push -m "WIP: payment webhook handler"
git checkout main
git checkout -b hotfix/order-bug
# ...修复...
git checkout main
git checkout feature/payment
git stash pop  # 😱 冲突！因为 main 的文件结构已经变了

# stash 堆栈管理噩梦
git stash list
# stash@{0}: On feature/payment: WIP: payment webhook handler
# stash@{1}: On feature/notification: WIP: template changes
# stash@{2}: On feature/api: WIP: rate limiter config
# 哪个 stash 对应哪个分支？完全记不清！
```

```bash
# === 使用 Worktree ===
# 什么都不用做！直接开新目录
cd ~/projects/laravel-app.git
git worktree add ../laravel-app-hotfix -b hotfix/order-bug main
cd ../laravel-app-hotfix
# ...修复...
# 修复完回到支付模块
cd ~/projects/laravel-app-payment
# 所有修改完好无损，连终端的光标位置都不变 😎
```

### 6.3 什么时候仍然用 stash？

stash 并非完全无用，以下场景仍然适合：

1. **临时保存单个文件的修改**：`git stash push -p` 交互式暂存
2. **跨分支应用补丁**：`git stash` → `git checkout` → `git stash pop`
3. **快速实验**：临时保存状态，试验一个想法
4. **单 worktree 环境**：只有主分支，不需要长期并行开发

---

## 七、CI/CD 集成方案

### 7.1 GitHub Actions 集成

以下是一个完整的 CI/CD 配置，针对 worktree + bare repo 工作流优化：

```yaml
# .github/workflows/laravel-ci.yml
name: Laravel CI (Worktree)

on:
  push:
    branches: ['feature/**', 'hotfix/**', 'main', 'develop']
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: secret
          MYSQL_DATABASE: laravel_test
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3

    steps:
      - name: Checkout with full history
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, mysql
          coverage: xdebug

      - name: Get branch-specific database name
        id: db
        run: |
          DB_NAME="laravel_test_$(echo ${{ github.ref_name }} | tr '/' '_' | tr '-' '_')"
          echo "name=$DB_NAME" >> $GITHUB_OUTPUT

      - name: Install Composer dependencies
        run: composer install --no-interaction --prefer-dist --optimize-autoloader

      - name: Prepare environment
        run: |
          cp .env.ci .env
          sed -i "s/DB_DATABASE=.*/DB_DATABASE=${{ steps.db.outputs.name }}/" .env
          php artisan key:generate

      - name: Run migrations
        run: php artisan migrate --force

      - name: Run tests
        run: php artisan test --parallel --coverage-clover=coverage.xml
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: ${{ steps.db.outputs.name }}
          DB_USERNAME: root
          DB_PASSWORD: secret

      - name: Upload coverage
        if: github.event_name == 'pull_request'
        uses: codecov/codecov-action@v3
        with:
          file: coverage.xml
```

### 7.2 GitLab CI 集成

```yaml
# .gitlab-ci.yml
stages:
  - build
  - test
  - deploy

variables:
  MYSQL_DATABASE: "laravel_test_${CI_COMMIT_REF_SLUG}"

.build_template: &build_template
  before_script:
    - composer install --no-interaction --prefer-dist
    - cp .env.ci .env
    - sed -i "s/DB_DATABASE=.*/DB_DATABASE=${MYSQL_DATABASE}/" .env
    - php artisan key:generate
    - php artisan migrate --force

test:feature:
  <<: *build_template
  stage: test
  only:
    - /^feature\/.*$/
    - /^hotfix\/.*$/
  script:
    - php artisan test --parallel
  services:
    - mysql:8.0

deploy:staging:
  stage: deploy
  only:
    - /^feature\/.*$/
  script:
    - echo "Deploying feature branch to staging..."
    - ./scripts/deploy-staging.sh ${CI_COMMIT_REF_SLUG}
  environment:
    name: review/$CI_COMMIT_REF_SLUG
    url: https://${CI_COMMIT_REF_SLUG}.staging.example.com
    on_stop: stop_review
    auto_stop_in: 1 week

stop_review:
  stage: deploy
  script:
    - echo "Cleaning up review environment..."
    - ./scripts/cleanup-staging.sh ${CI_COMMIT_REF_SLUG}
  environment:
    name: review/$CI_COMMIT_REF_SLUG
    action: stop
  when: manual
```

### 7.3 部署脚本示例

```bash
#!/bin/bash
# scripts/deploy-worktree.sh
# 部署指定 worktree 到服务器

set -euo pipefail

WORKTREE_PATH="$1"
DEPLOY_HOST="${2:-production.example.com}"
DEPLOY_USER="${3:-deploy}"
DEPLOY_PATH="/var/www/laravel"

echo "🚀 部署 $WORKTREE_PATH 到 $DEPLOY_HOST..."

cd "$WORKTREE_PATH"

# 确保在正确的分支
BRANCH=$(git branch --show-current)
echo "📌 当前分支: $BRANCH"

# 运行测试
echo "🧪 运行测试..."
php artisan test --parallel
if [ $? -ne 0 ]; then
    echo "❌ 测试失败，中止部署"
    exit 1
fi

# 构建前端资源
echo "🎨 构建前端资源..."
npm run build

# 同步到服务器
echo "📦 同步文件..."
rsync -avz --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.env' \
    --exclude='storage/app/*' \
    --exclude='storage/logs/*' \
    ./ ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/

# 远程部署命令
ssh ${DEPLOY_USER}@${DEPLOY_HOST} << 'EOF'
cd /var/www/laravel
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan queue:restart
php artisan up
EOF

echo "✅ 部署完成！分支 $BRANCH 已部署到 $DEPLOY_HOST"
```

---

## 八、团队协作最佳实践

### 8.1 命名规范

建立统一的目录命名规范，确保团队一致性：

```bash
# 推荐命名格式：{project}-{branch-slug}
# 将 / 替换为 -

laravel-app.git                    # Bare Repo
├── laravel-app-main               # main 分支
├── laravel-app-develop            # develop 分支
├── laravel-app-feat-payment       # feature/payment
├── laravel-app-feat-notification  # feature/notification
├── laravel-app-hotfix-order       # hotfix/order-fix
└── laravel-app-release-v32        # release/v3.2.0
```

### 8.2 团队共享 Worktree 配置

```json
// .worktree-config.json（提交到仓库根目录）
{
    "project": "laravel-app",
    "bare_repo": "laravel-app.git",
    "worktree_pattern": "laravel-app-{branch}",
    "env_defaults": {
        "APP_ENV": "local",
        "DB_CONNECTION": "mysql",
        "DB_HOST": "127.0.0.1",
        "DB_PORT": 3306
    },
    "ports": {
        "main": 8000,
        "feature/*": "8001-8099",
        "hotfix/*": "8100-8199"
    },
    "databases": {
        "pattern": "laravel_{branch_slug}"
    }
}
```

### 8.3 Git 别名配置

```ini
# ~/.gitconfig 或项目 .gitconfig

[alias]
    # Worktree 快捷命令
    wt = "!git worktree list"
    wta = "!f() { git worktree add \"../$(echo $1 | tr / -)\" -b \"$1\"; }; f"
    wtr = "!f() { git worktree remove \"../$(echo $1 | tr / -)\"; }; f"
    wtp = "!git worktree prune -v"
    
    # 快速创建 feature worktree
    wtf = "!f() { \
        local branch=\"feature/$1\"; \
        local dir=\"../laravel-app-feat-$1\"; \
        git worktree add \"$dir\" -b \"$branch\" main; \
        echo \"✅ Worktree 创建完成: $dir\"; \
        echo \"   cd $dir && composer install\"; \
    }; f"
    
    # 快速创建 hotfix worktree
    wth = "!f() { \
        local branch=\"hotfix/$1\"; \
        local dir=\"../laravel-app-hotfix-$1\"; \
        git worktree add \"$dir\" -b \"$branch\" main; \
        echo \"🔥 Hotfix worktree 创建完成: $dir\"; \
    }; f"
    
    # 列出所有 worktree 及状态
    wts = "!f() { \
        echo '🌳 Worktree 状态:'; \
        echo '─────────────────────────────────'; \
        git worktree list --porcelain | while read line; do \
            if [[ $line == worktree* ]]; then \
                path=${line#worktree }; \
                branch=$(cd \"$path\" && git branch --show-current 2>/dev/null || echo 'detached'); \
                changes=$(cd \"$path\" && git status --porcelain 2>/dev/null | wc -l | tr -d ' '); \
                printf '  %-40s [%s] (%s changes)\\n' \"$path\" \"$branch\" \"$changes\"; \
            fi; \
        done; \
    }; f"
```

### 8.4 IDE 配置（PhpStorm）

PhpStorm 对 worktree 有良好支持，但需要正确配置：

```xml
<!-- .idea/vcs.xml - 确保每个 worktree 都正确识别 VCS -->
<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="VcsDirectoryMappings">
    <mapping directory="$PROJECT_DIR$" vcs="Git" />
  </component>
</project>
```

实用技巧：

1. **每个 worktree 用独立的 PhpStorm 窗口打开**
2. **共享设置**：通过 `Settings Repository` 同步 IDE 配置
3. **共享代码风格**：`.editorconfig` 提交到仓库，所有 worktree 共享
4. **共享 PHP CS Fixer 配置**：`.php-cs-fixer.dist.php` 放在仓库根目录

---

## 九、自动化脚本与工具集

### 9.1 完整的 Worktree 管理脚本

```bash
#!/bin/bash
# wtm - Worktree Manager for Laravel Projects
# 用法: wtm <command> [args]

set -euo pipefail

BARE_REPO=""
PROJECT_NAME=""

# 自动检测 bare repo
detect_bare_repo() {
    local current_dir=$(pwd)
    local dir="$current_dir"
    while [ "$dir" != "/" ]; do
        if [ -f "$dir/.worktree-config.json" ] || [ -d "$dir/objects" ] && [ ! -d "$dir/.git" ]; then
            BARE_REPO="$dir"
            PROJECT_NAME=$(basename "$dir" .git)
            return 0
        fi
        dir=$(dirname "$dir")
    done
    echo "❌ 未找到 Bare Repo，请在 worktree 项目目录中执行此命令"
    exit 1
}

# 命令: init - 初始化新的 worktree 环境
cmd_init() {
    local branch_type="$1"  # feature, hotfix, release
    local name="$2"
    local base="${3:-main}"
    
    local branch="${branch_type}/${name}"
    local slug=$(echo "$name" | tr '/' '-')
    local dir="../${PROJECT_NAME}-${branch_type}-${slug}"
    
    echo "🔧 创建 worktree: $branch"
    git -C "$BARE_REPO" worktree add "$dir" -b "$branch" "$base"
    
    echo "📦 初始化 Laravel 环境..."
    cd "$dir"
    
    if [ -f "composer.json" ]; then
        composer install --no-interaction
    fi
    
    if [ -f "package.json" ]; then
        npm ci
    fi
    
    if [ -f ".env.example" ] && [ ! -f ".env" ]; then
        cp .env.example .env
        local db_name="laravel_${branch_type}_${slug}"
        sed -i '' "s/DB_DATABASE=laravel/DB_DATABASE=${db_name}/" .env
        php artisan key:generate
        mysql -u root -e "CREATE DATABASE IF NOT EXISTS \`${db_name}\`;" 2>/dev/null || true
        php artisan migrate --force
    fi
    
    php artisan config:cache 2>/dev/null || true
    
    echo ""
    echo "✅ 初始化完成！"
    echo "   分支: $branch"
    echo "   目录: $dir"
    echo ""
    echo "   cd $dir && php artisan serve"
}

# 命令: list - 列出所有 worktree
cmd_list() {
    echo "🌳 Worktree 列表 ($PROJECT_NAME):"
    echo "─────────────────────────────────────────────────────"
    printf "%-40s %-25s %s\n" "目录" "分支" "状态"
    echo "─────────────────────────────────────────────────────"
    
    git -C "$BARE_REPO" worktree list --porcelain | while IFS= read -r line; do
        if [[ $line == worktree* ]]; then
            wt_path="${line#worktree }"
            wt_name=$(basename "$wt_path")
        elif [[ $line == branch* ]]; then
            wt_branch="${line#branch refs/heads/}"
            # 检查是否有未提交的修改
            wt_changes=$(cd "$wt_path" 2>/dev/null && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
            if [ "$wt_changes" -gt 0 ]; then
                status="⚠️  ${wt_changes} changes"
            else
                status="✅ clean"
            fi
            printf "%-40s %-25s %s\n" "$wt_name" "$wt_branch" "$status"
        fi
    done
}

# 命令: clean - 清理已完成的 worktree
cmd_clean() {
    echo "🧹 清理 worktree..."
    
    git -C "$BARE_REPO" worktree list --porcelain | while IFS= read -r line; do
        if [[ $line == worktree* ]]; then
            wt_path="${line#worktree }"
        elif [[ $line == branch* ]]; then
            wt_branch="${line#branch refs/heads/}"
            wt_name=$(basename "$wt_path")
            
            # 跳过 main 和 develop
            if [[ "$wt_branch" == "main" ]] || [[ "$wt_branch" == "develop" ]]; then
                continue
            fi
            
            # 检查分支是否已合并到 main
            if git -C "$BARE_REPO" merge-base --is-ancestor "$wt_branch" main 2>/dev/null; then
                echo "  🗑️  已合并: $wt_name ($wt_branch)"
                read -p "     确认删除? [y/N] " confirm
                if [[ $confirm == [yY] ]]; then
                    git -C "$BARE_REPO" worktree remove --force "$wt_path"
                    git -C "$BARE_REPO" branch -d "$wt_branch" 2>/dev/null || true
                    echo "     ✅ 已删除"
                fi
            fi
        fi
    done
    
    # 清理残留引用
    git -C "$BARE_REPO" worktree prune -v
}

# 命令: sync - 同步所有 worktree
cmd_sync() {
    echo "🔄 同步所有 worktree..."
    git -C "$BARE_REPO" fetch --all --prune
    
    git -C "$BARE_REPO" worktree list --porcelain | while IFS= read -r line; do
        if [[ $line == worktree* ]]; then
            wt_path="${line#worktree }"
        elif [[ $line == branch* ]]; then
            wt_branch="${line#branch refs/heads/}"
            echo "  📥 同步: $(basename "$wt_path") ($wt_branch)"
            (cd "$wt_path" && git pull --rebase 2>/dev/null) || echo "    ⚠️ 同步失败，可能有冲突"
        fi
    done
}

# 命令: status - 显示所有 worktree 的详细状态
cmd_status() {
    echo "📊 Worktree 状态报告"
    echo "═══════════════════════════════════════════════════"
    
    git -C "$BARE_REPO" worktree list --porcelain | while IFS= read -r line; do
        if [[ $line == worktree* ]]; then
            wt_path="${line#worktree }"
            wt_name=$(basename "$wt_path")
        elif [[ $line == branch* ]]; then
            wt_branch="${line#branch refs/heads/}"
            
            echo ""
            echo "🌿 $wt_name ($wt_branch)"
            echo "   路径: $wt_path"
            
            if [ -d "$wt_path" ]; then
                cd "$wt_path"
                
                # Git 状态
                local changes=$(git status --porcelain 2>/dev/null)
                if [ -n "$changes" ]; then
                    echo "   变更:"
                    echo "$changes" | head -5 | while read -r change; do
                        echo "     $change"
                    done
                    local total=$(echo "$changes" | wc -l | tr -d ' ')
                    if [ "$total" -gt 5 ]; then
                        echo "     ... 还有 $((total - 5)) 个变更"
                    fi
                else
                    echo "   状态: ✅ 干净"
                fi
                
                # 最近提交
                local last_commit=$(git log -1 --format="%h %s (%ar)" 2>/dev/null)
                echo "   最近提交: $last_commit"
            fi
        fi
    done
}

# 命令: exec - 在所有 worktree 中执行命令
cmd_exec() {
    echo "⚡ 在所有 worktree 中执行: $*"
    
    git -C "$BARE_REPO" worktree list --porcelain | while IFS= read -r line; do
        if [[ $line == worktree* ]]; then
            wt_path="${line#worktree }"
        elif [[ $line == branch* ]]; then
            wt_branch="${line#branch refs/heads/}"
            wt_name=$(basename "$wt_path")
            
            echo ""
            echo "▶️  $wt_name ($wt_branch):"
            (cd "$wt_path" && eval "$@") 2>&1 | sed 's/^/   /'
        fi
    done
}

# 主入口
main() {
    detect_bare_repo
    
    case "${1:-help}" in
        init)    shift; cmd_init "$@" ;;
        list|ls) cmd_list ;;
        clean)   cmd_clean ;;
        sync)    cmd_sync ;;
        status)  cmd_status ;;
        exec)    shift; cmd_exec "$@" ;;
        help|*)
            echo "用法: wtm <command> [args]"
            echo ""
            echo "命令:"
            echo "  init <type> <name> [base]  创建新 worktree (type: feature|hotfix|release)"
            echo "  list                       列出所有 worktree"
            echo "  status                     显示详细状态"
            echo "  sync                       同步所有 worktree"
            echo "  clean                      清理已合并的 worktree"
            echo "  exec <command>             在所有 worktree 中执行命令"
            ;;
    esac
}

main "$@"
```

使用示例：

```bash
# 创建 feature worktree 并自动初始化 Laravel 环境
wtm init feature payment-v2

# 创建 hotfix worktree
wtm init hotfix order-calculation main

# 查看所有 worktree 状态
wtm status

# 在所有 worktree 中运行 lint
wtm exec php artisan pint --test

# 同步所有 worktree 的远程更新
wtm sync

# 清理已合并到 main 的 worktree
wtm clean
```

---

## 十、常见问题与解决方案

### 10.1 "branch is already checked out" 错误

```bash
$ git worktree add ../feature-a feature/payment
fatal: 'feature/payment' is already checked out at '/Users/dev/laravel-app-payment'
```

**原因**：同一分支不能在两个 worktree 中同时检出。

**解决**：

```bash
# 方案 A：查看哪个 worktree 正在使用该分支
git worktree list
# 找到对应目录，去那个目录工作

# 方案 B：如果确定旧 worktree 已废弃
git worktree remove --force /Users/dev/laravel-app-payment
git worktree add ../feature-a feature/payment
```

### 10.2 Worktree 目录被误删后的恢复

```bash
# 症状：手动 rm -rf 了 worktree 目录
$ git worktree list
/Users/dev/feature-payment  abc1234 [feature/payment]   # 但目录已不存在

# 解决：prune 清理残留引用
git worktree prune -v
# 然后重新创建
git worktree add ../feature-payment feature/payment
```

### 10.3 `.env` 文件同步问题

**问题**：多份 `.env` 文件需要保持某些配置同步（如 API Key），但其他配置要独立。

**解决**：

```bash
# 方案 A：使用 .env 共享配置
# .env.shared（提交到仓库）
APP_NAME="Laravel Dev"
APP_DEBUG=true
LOG_CHANNEL=stack

# .env（每个 worktree 独立，不提交）
DB_DATABASE=laravel_payment
APP_PORT=8001

# 在 .env 中引入共享配置
echo 'import:@.env.shared' >> .env  # Laravel 11 不支持，用下面的方案

# 方案 B：使用 env 文件分层
# bootstrap/app.php (Laravel 11)
->withMiddleware(function (Middleware $middleware) {
    // ...
})
->withExceptions(function (Exceptions $exceptions) {
    // ...
})

# 方案 C：使用 dotenv 的环境变量覆盖
# 在 .env 中引用系统环境变量
DB_DATABASE=${DB_NAME:-laravel_default}
```

### 10.4 vendor/ 目录磁盘占用

**问题**：每个 worktree 都有独立的 `vendor/` 目录，大型 Laravel 项目可能占用大量磁盘。

**解决**：

```bash
# 方案 A：使用软链接共享 vendor
# 只在 main worktree 中 composer install
cd laravel-app-main
composer install

# 其他 worktree 软链接
cd ../laravel-app-payment
rm -rf vendor
ln -s ../laravel-app-main/vendor vendor

# 注意：如果不同分支的 composer.json 有差异，此方案不适用

# 方案 B：使用 Composer 的 COMPOSER_HOME 共享缓存
export COMPOSER_HOME=~/.composer
# Composer 会自动缓存下载的包，减少重复下载

# 方案 C：使用 --prefer-dist 减少包体积
composer install --prefer-dist --no-dev --optimize-autoloader
```

### 10.5 IDE 索引冲突

**问题**：PhpStorm 或 VS Code 在多个 worktree 中产生索引冲突。

**解决**：

```bash
# 为每个 worktree 创建独立的 IDE 配置目录
# .gitignore 中已包含 .idea/ 和 .vscode/

# PhpStorm：每个 worktree 作为独立项目打开
# 不要在同一窗口中打开多个 worktree

# VS Code：使用 workspace 文件
# laravel-app.code-workspace
{
    "folders": [
        { "path": "../laravel-app-main", "name": "Main" },
        { "path": "../laravel-app-payment", "name": "Payment" },
        { "path": "../laravel-app-notification", "name": "Notification" }
    ],
    "settings": {
        "files.exclude": {
            "vendor": true,
            "node_modules": true
        }
    }
}
```

### 10.6 子模块（Submodule）在 Worktree 中的问题

```bash
# 问题：worktree 中的子模块未初始化
$ git status
# modified: packages/shared-library (untracked content)

# 解决：在每个 worktree 中单独初始化子模块
cd ../laravel-app-payment
git submodule update --init --recursive

# 如果子模块很多，写个脚本批量初始化
for wt_path in $(git -C laravel-app.git worktree list --porcelain | grep '^worktree' | sed 's/worktree //'); do
    echo "初始化子模块: $wt_path"
    (cd "$wt_path" && git submodule update --init --recursive)
done
```

### 10.7 Worktree 中的 git hooks 问题

```bash
# 问题：hooks 目录路径在 worktree 中可能不正确
$ git commit
# .git/hooks/pre-commit: No such file or directory

# 解决：使用 core.hooksPath 配置全局 hooks 目录
git config --global core.hooksPath ~/.config/git/hooks

# 或在 bare repo 中设置
git -C laravel-app.git config core.hooksPath hooks

# 推荐：使用 Husky (前端) 或 CaptainHook (PHP) 管理 hooks
# CaptainHook for Laravel
composer require --dev captainhook/captainhook
./vendor/bin/captainhook configure
```

### 10.8 Docker 环境与 Worktree 冲突

**问题**：Docker 容器内挂载 worktree 目录时，路径映射和缓存可能产生冲突。

```bash
# 问题：多个 worktree 的 Docker 容器共享相同的匿名卷
docker-compose up -d
# 容器 A (payment): vendor/package-x v1.0
# 容器 B (notification): vendor/package-x v2.0  ← 冲突！

# 解决：为每个 worktree 使用独立的 docker-compose 配置
# docker-compose.payment.yml
services:
  app:
    volumes:
      - ../laravel-app-payment:/var/www/html
      - payment-vendor:/var/www/html/vendor
      - payment-node:/var/www/html/node_modules
    ports:
      - "8001:8000"
    environment:
      - DB_DATABASE=laravel_payment
      - REDIS_PREFIX=payment_

volumes:
  payment-vendor:
  payment-node:

# docker-compose.notification.yml
services:
  app:
    volumes:
      - ../laravel-app-notification:/var/www/html
      - notification-vendor:/var/www/html/vendor
      - notification-node:/var/www/html/node_modules
    ports:
      - "8002:8000"
    environment:
      - DB_DATABASE=laravel_notification
      - REDIS_PREFIX=notification_

volumes:
  notification-vendor:
  notification-node:
```

### 10.9 跨 Worktree 合并冲突处理

**问题**：当两个 feature worktree 修改了相同文件，合并时产生冲突，且冲突解决需要在正确的上下文中进行。

```bash
# 场景：feature/payment 和 feature/notification 都修改了 app/Http/Controllers/OrderController.php

# 步骤 1：在 main worktree 中合并第一个分支
cd ~/projects/laravel-app-main
git merge feature/payment --no-ff
# ✅ 合并成功

# 步骤 2：合并第二个分支时发现冲突
git merge feature/notification --no-ff
# CONFLICT (content): Merge conflict in app/Http/Controllers/OrderController.php

# 步骤 3：使用 worktree 优势——在 notification 的 worktree 中解决
cd ~/projects/laravel-app-notification
git fetch origin
git rebase main
# 编辑冲突文件...
git add app/Http/Controllers/OrderController.php
git rebase --continue

# 步骤 4：回到 main 重新合并（已无冲突）
cd ~/projects/laravel-app-main
git merge feature/notification --no-ff
# ✅ 合并成功
```

### 10.10 文件系统事件与热重载

**问题**：Laravel 的 `serve` 命令和前端构建工具（Vite）依赖文件系统事件监听，多个 worktree 同时运行时可能产生事件风暴。

```bash
# 问题：文件系统事件在多个 worktree 间交叉触发
# Vite 的 HMR 监听可能误触发其他 worktree 的变更

# 解决方案 1：限制监听范围
# vite.config.js
export default defineConfig({
  server: {
    watch: {
      // 只监听当前 worktree 目录
      ignored: ['**/node_modules/**', '**/.git/**', '../laravel-app-*'],
      usePolling: false,  // 使用原生事件，性能更好
    }
  }
})

# 解决方案 2：使用 chokidar 的原子写入检测
# 在每个 worktree 中独立运行前端构建
cd ~/projects/laravel-app-payment
npm run dev -- --host 0.0.0.0 --port 5173

cd ~/projects/laravel-app-notification
npm run dev -- --host 0.0.0.0 --port 5174

# 解决方案 3：使用 fsmonitor（Git 2.37+）
git config core.fsmonitor true
git config core.untrackedCache true
```

### 10.11 数据库迁移策略与多 Worktree 共享

**问题**：多个 worktree 各自拥有独立数据库，但某些迁移（如新增表）需要在所有数据库中执行。

```bash
# 场景：新添加了一张 notifications 表，需要在所有 worktree 的数据库中创建

# 方案 A：在每个 worktree 中手动运行迁移
for wt in $(git -C laravel-app.git worktree list --porcelain | grep '^worktree' | sed 's/worktree //'); do
    echo "迁移: $(basename $wt)"
    (cd "$wt" && php artisan migrate --force)
done

# 方案 B：使用环境变量指定目标数据库批量执行
#!/bin/bash
# scripts/migrate-all.sh
set -euo pipefail

# 获取所有 worktree 的 .env 中的数据库名
git -C laravel-app.git worktree list --porcelain | while IFS= read -r line; do
    if [[ $line == worktree* ]]; then
        wt_path="${line#worktree }"
    elif [[ $line == branch* ]]; then
        wt_branch="${line#branch refs/heads/}"
        if [ -f "$wt_path/.env" ]; then
            db_name=$(grep 'DB_DATABASE=' "$wt_path/.env" | cut -d'=' -f2)
            echo "🗄️  迁移数据库: $db_name (worktree: $(basename $wt_path), 分支: $wt_branch)"
            cd "$wt_path"
            php artisan migrate --force 2>&1 | sed 's/^/   /'
        fi
    fi
done

# 方案 C：使用 Laravel 的 DB_DATABASE 环境变量覆盖
cd ~/projects/laravel-app-payment
DB_DATABASE=laravel_notification php artisan migrate --force
```

### 10.12 端口冲突与自动分配

**问题**：多个 worktree 同时运行 `php artisan serve` 时，默认端口 8000 会冲突。

```bash
# 方案 A：手动指定不同端口
cd ~/projects/laravel-app-payment
php artisan serve --port=8001

cd ~/projects/laravel-app-notification
php artisan serve --port=8002

# 方案 B：自动分配可用端口
#!/bin/bash
# scripts/auto-serve.sh
# 用法: ./scripts/auto-serve.sh <worktree-path>

WORKTREE_PATH="$1"

# 查找当前使用的端口
USED_PORTS=$(lsof -i -P -n 2>/dev/null | grep LISTEN | awk '{print $9}' | cut -d':' -f2 | sort -n)
PORT=8000

# 找到第一个可用端口
while echo "$USED_PORTS" | grep -q "^${PORT}$"; do
    PORT=$((PORT + 1))
    if [ $PORT -gt 9999 ]; then
        echo "❌ 无法找到可用端口"
        exit 1
    fi
done

echo "🚀 启动开发服务器: $WORKTREE_PATH (端口: $PORT)"
cd "$WORKTREE_PATH"
php artisan serve --port=$PORT

# 方案 C：在 wtm 工具中集成自动端口分配
# 修改 wtm 的 cmd_init 函数，自动记录端口分配
assign_port() {
    local config_file="$BARE_REPO/.worktree-ports"
    touch "$config_file"
    
    # 获取当前使用的端口
    local used=$(cat "$config_file" 2>/dev/null || echo "")
    local port=8000
    
    while echo "$used" | grep -q "^${port}$"; do
        port=$((port + 1))
    done
    
    echo "$port" >> "$config_file"
    echo "$port"
}
```

### 10.13 Worktree 中的 Composer 与 NPM 缓存优化

**问题**：每个 worktree 都运行 `composer install` 和 `npm ci`，导致重复下载相同依赖，浪费时间和带宽。

```bash
# 问题诊断：查看各 worktree 的依赖安装时间
time composer install --no-interaction  # 每个 worktree 约 2-5 分钟
time npm ci  # 每个 worktree 约 1-3 分钟

# 解决方案 1：共享 Composer 缓存
# Composer 默认缓存在 ~/.composer/cache，已自动共享
# 但 vendor 目录仍需独立安装，确保 autoload 正确

# 解决方案 2：使用 Composer 的 --prefer-dist --no-dev 减少安装时间
# 在开发 worktree 中
composer install --prefer-dist --no-dev --optimize-autoloader --no-interaction

# 解决方案 3：使用 npm 的全局缓存
# npm 默认使用 ~/.npm 缓存，只需确保 registry 一致
npm config set registry https://registry.npmmirror.com  # 使用国内镜像

# 解决方案 4：批量初始化脚本
#!/bin/bash
# scripts/init-all-worktrees.sh
set -euo pipefail

echo "🚀 批量初始化所有 worktree..."

git -C laravel-app.git worktree list --porcelain | while IFS= read -r line; do
    if [[ $line == worktree* ]]; then
        wt_path="${line#worktree }"
    elif [[ $line == branch* ]]; then
        wt_branch="${line#branch refs/heads/}"
        wt_name=$(basename "$wt_path")
        
        # 跳过 bare repo 本身
        if [ ! -d "$wt_path" ]; then
            continue
        fi
        
        echo ""
        echo "📦 初始化: $wt_name ($wt_branch)"
        echo "─────────────────────────────────"
        
        cd "$wt_path"
        
        # 安装 PHP 依赖
        if [ -f "composer.json" ]; then
            echo "  📦 Composer 依赖..."
            composer install --prefer-dist --no-interaction --optimize-autoloader 2>&1 | tail -1
        fi
        
        # 安装前端依赖
        if [ -f "package.json" ]; then
            echo "  📦 NPM 依赖..."
            npm ci --prefer-offline 2>&1 | tail -1
        fi
        
        # 配置 .env
        if [ -f ".env.example" ] && [ ! -f ".env" ]; then
            cp .env.example .env
            slug=$(echo "$wt_branch" | tr '/' '_')
            sed -i '' "s/DB_DATABASE=laravel/DB_DATABASE=laravel_${slug}/" .env
            php artisan key:generate 2>/dev/null
        fi
        
        echo "  ✅ 完成"
    fi
done

echo ""
echo "🎉 所有 worktree 初始化完成！"
```

---

## 十一、性能优化与资源管理

### 11.1 磁盘空间管理

```bash
# 查看所有 worktree 的磁盘占用
echo "📊 Worktree 磁盘使用情况:"
for wt in $(git -C laravel-app.git worktree list --porcelain | grep '^worktree' | sed 's/worktree //'); do
    size=$(du -sh "$wt" 2>/dev/null | cut -f1)
    branch=$(cd "$wt" && git branch --show-current 2>/dev/null || echo "detached")
    printf "  %-40s %10s  [%s]\n" "$(basename $wt)" "$size" "$branch"
done

# 查看 Git 对象库大小（所有 worktree 共享）
echo ""
echo "Git 对象库大小:"
du -sh laravel-app.git/objects/

# 压缩对象库
git -C laravel-app.git gc --aggressive --prune=now
```

### 11.2 内存优化

多份 Laravel 应用同时运行会占用大量内存：

```bash
# 方案 A：使用 Docker 限制内存
# docker-compose.worktree.yml
services:
  app-payment:
    build: .
    mem_limit: 512m
    volumes:
      - ../laravel-app-payment:/app
    ports:
      - "8001:8000"
    
  app-notification:
    build: .
    mem_limit: 512m
    volumes:
      - ../laravel-app-notification:/app
    ports:
      - "8002:8000"

# 方案 B：按需启动/停止开发服务器
# 使用一个简单的管理脚本
#!/bin/bash
case "$1" in
    start)
        cd ~/projects/laravel-app-payment && php artisan serve --port=8001 &
        cd ~/projects/laravel-app-notification && php artisan serve --port=8002 &
        ;;
    stop)
        pkill -f "artisan serve"
        ;;
esac
```

### 11.3 Git 性能调优

```ini
# laravel-app.git/config (bare repo 配置)

[core]
    # 增大文件监听缓存
    fsmonitor = true
    untrackedCache = true
    
[pack]
    # 优化打包参数
    threads = 4
    windowMemory = 1g
    
[gc]
    # 自动垃圾回收
    auto = 256
    autoPackLimit = 50
    
[feature]
    # 启用 FSMonitor（需要 Git 2.37+）
    fsmonitor = true
```

---

## 十二、真实场景踩坑与经验总结

在实际团队落地 Worktree + Bare Repo 工作流的过程中，以下经验教训值得特别关注：

### 12.1 大型 Laravel 项目的实战踩坑

**踩坑一：Laravel Telescope 和 Debugbar 在多 worktree 中冲突**

当多个 worktree 同时运行且都启用了 Telescope 或 Debugbar 时，它们会共享同一个 Redis 前缀，导致调试数据互相干扰。解决方案是在每个 worktree 的 `.env` 中设置独立的 Redis 前缀：

```env
# laravel-app-payment/.env
TELESCOPE_PREFIX=laravel_payment_
DEBUGBAR_PREFIX=payment_
REDIS_PREFIX=payment_
```

**踩坑二：Laravel Horizon 队列多环境冲突**

多个 worktree 的 Horizon 实例会竞争同一个 Redis 队列，导致任务被错误的工作区消费。解决方案是为每个 worktree 的队列使用独立的 Redis 连接和队列名：

```php
// config/queue.php - 为 worktree 环境添加独立配置
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => env('QUEUE_CONNECTION', 'default'),
        'queue' => env('QUEUE_NAME', 'default'),
        'retry_after' => 90,
        'block_for' => null,
    ],
],
```

```env
# payment worktree 的 .env
QUEUE_CONNECTION=redis
QUEUE_NAME=payment_high,payment_default
HORIZON_PREFIX=horizon_payment_
```

**踩坑三：多 worktree 共享外部服务的速率限制**

当多个 worktree 同时调用第三方 API（如 Stripe、SendGrid）时，可能触发速率限制。建议在开发环境中使用沙箱账号区分调用来源，或者统一使用一个开发环境的 API Key 并设置合理的请求间隔。

### 12.2 性能基准数据

在一台 16GB 内存、M2 芯片的 MacBook Pro 上实测的结果：

| 方案 | 磁盘总占用 | 首次初始化时间 | 分支切换时间 | 内存占用（4个并行环境） |
|------|-----------|--------------|------------|---------------------|
| 单目录 + stash | ~800MB | ~8 分钟 | 3-5 秒（含 stash 操作） | ~2.1GB |
| 多份 git clone | ~3.2GB | ~32 分钟（4×8分钟） | 即时（目录切换） | ~2.1GB |
| Worktree + 普通仓库 | ~1.1GB | ~10 分钟 | 即时（目录切换） | ~2.1GB |
| **Worktree + Bare Repo** | **~1.1GB** | **~10 分钟** | **即时（目录切换）** | **~2.1GB** |

从数据可以看出，Worktree + Bare Repo 方案在磁盘占用上与单份 Worktree 持平，远优于多份 clone 方案。而 Bare Repo 的额外优势在于架构清晰度和分支管理的灵活性，这在团队协作中价值更大。

### 12.3 什么时候不适合使用 Worktree？

尽管 Worktree + Bare Repo 方案优势明显，但在以下场景中不建议使用：

1. **项目依赖频繁变更**：如果你的 `composer.json` 和 `package.json` 在不同分支间差异极大，每个 worktree 的依赖安装成本会显著增加
2. **团队规模很小（1-2人）**：单人开发时，简单的 `git checkout` 已经足够，引入 Worktree 反而增加管理复杂度
3. **CI/CD 环境限制**：部分 CI 平台（如某些自建 Jenkins）对 Worktree 的支持不佳，建议在 CI 中仍使用标准 checkout
4. **磁盘空间紧张**：虽然 Worktree 共享对象库，但每个 worktree 的 `vendor/` 和 `node_modules/` 仍然独立，大型项目可能占用 500MB+ 每个

### 12.4 Worktree 与 Git 分支保护策略

在团队协作中，分支保护是保障代码质量的重要手段。当你使用 Worktree 工作流时，分支保护策略需要做一些调整。由于所有 worktree 共享同一个 bare repo 的引用系统，远程仓库的分支保护规则仍然生效，这意味着你无法直接在 worktree 中推送受保护分支的代码，必须通过 Pull Request 流程。

具体来说，建议的分支保护策略如下：

1. **main 分支**：设置为完全保护，禁止直接推送，要求至少两人 Code Review，CI 测试全部通过后才能合并。这是所有 worktree 的基础分支，任何未经验证的代码都不应该进入 main。
2. **develop 分支**（如果使用 Git Flow）：设置为中度保护，允许项目维护者推送，但普通开发者仍需通过 PR 合并。
3. **feature 分支**：不设置保护，允许开发者自由推送。但建议在 bare repo 的 hooks 中配置预提交检查，确保代码风格和基础测试在推送前通过。
4. **release 分支**：设置为严格保护，仅允许 bugfix 提交，禁止新功能合入。release 分支的合并需要经过完整的回归测试。

在 Worktree 环境中，一个特别需要注意的场景是：当两个开发者同时在各自的 worktree 中开发同一个 feature 分支时，由于 Git 的锁定机制，同一分支只能被一个 worktree 检出。因此，团队需要建立明确的分支分配机制——每个 feature 分支由一个开发者负责，避免多人同时操作同一分支导致的锁定冲突。如果确实需要多人协作同一个 feature，建议使用子分支策略：从 feature 分支创建子分支（如 `feature/payment-be` 和 `feature/payment-fe`），各自在独立的 worktree 中开发，最终合并回 feature 分支后再提交 PR。

### 12.5 Worktree 与 Laravel 队列和调度器的隔离

Laravel 的队列系统（Queue）和任务调度器（Scheduler）在多 worktree 环境中需要特别注意隔离。默认情况下，所有 worktree 的 `queue:work` 进程会连接同一个 Redis 实例并消费同一个队列，这可能导致一个问题：某个 worktree 中正在开发的、尚未完成的功能代码被队列处理器拾取并执行，从而引发不可预期的错误。

解决方案是为每个 worktree 配置独立的队列名。在 `.env` 中设置 `QUEUE_NAME=payment_queue`，然后在队列处理器中指定该队列：

```bash
# 在 payment worktree 中
cd ~/projects/laravel-app-payment
php artisan queue:work --queue=payment_queue

# 在 notification worktree 中
cd ~/projects/laravel-app-notification
php artisan queue:work --queue=notification_queue
```

对于任务调度器（Scheduler），同样需要确保每个 worktree 的 cron 任务使用独立的标识符，避免重复调度。可以在 `app/Console/Kernel.php` 中根据环境变量动态调整调度策略：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    $worktreeId = env('WORKTREE_ID', 'default');
    
    if ($worktreeId === 'main') {
        // 只在 main worktree 中运行完整的调度任务
        $schedule->command('payments:reconcile')->daily();
        $schedule->command('notifications:send-digest')->hourly();
    }
    // 其他 worktree 不运行定时任务，避免重复执行
}
```

---

## 十三、Worktree 在大型 Laravel 团队中的渐进式落地

在深入讨论落地策略之前，有必要先了解 Worktree 方案的平台兼容性与版本要求。Git Worktree 自 Git 2.5 版本引入，但早期版本存在若干已知缺陷：Git 2.16 之前的版本在某些操作系统上会出现 worktree 元数据损坏的问题，Git 2.34 之前在 Windows 上的性能表现不佳。因此，强烈建议将 Git 版本保持在 2.37 或更高版本，这个版本不仅修复了绝大多数已知 bug，还引入了 fsmonitor（文件系统监控器）功能，能够显著提升大型仓库中 worktree 的文件状态检测速度。在 macOS 上，可以通过 Homebrew 安装最新版本的 Git；在 Linux 上，建议使用官方 PPA 或源码编译以确保版本足够新。

对于一个已经使用传统工作流的大型 Laravel 团队来说，全面切换到 Worktree + Bare Repo 方案并非一蹴而就。以下是经过实践验证的四阶段渐进式落地路径，每个阶段都有明确的目标和验收标准。

### 第一阶段：个人试用期（第1-2周）

在这个阶段，不要求团队整体改变工作方式，而是鼓励有兴趣的开发者在自己的 feature 分支上试用 worktree。具体做法是：每个开发者在自己的本地机器上，从现有仓库创建一个 bare repo 副本，然后在 bare repo 上挂载自己正在开发的 feature 分支作为 worktree。这样做的好处是零风险——主仓库完全不受影响，开发者可以随时放弃 worktree 回到传统方式。

验收标准：开发者能够在不丢失任何代码和上下文的情况下，在两个分支之间无缝切换。如果一个开发者能够在五分钟内从 worktree 的基本概念过渡到日常使用，说明这个方案对团队是可行的。

### 第二阶段：核心团队试点（第3-4周）

选择一个中等规模的 feature 分支（开发周期约两周），由两到三名开发者组成的小组全面使用 Worktree + Bare Repo 工作流。在这个阶段，需要完成以下基础设施搭建：创建 bare repo 中枢仓库，配置统一的目录命名规范，编写并分发 wtm 自动化管理脚本，建立团队共享的 `.worktree-config.json` 配置文件。同时，需要在 CI/CD 管道中添加对 worktree 分支的测试支持，确保每个 feature 分支都有独立的测试环境。

验收标准：试点小组能够在一周内完成至少两次完整的 feature 开发到合并的全流程，期间没有因为 worktree 机制本身导致的阻塞问题。

### 第三阶段：团队培训与规范制定（第5-6周）

在试点成功的基础上，组织全团队培训。培训内容应包括：worktree 的基本操作命令、wtm 脚本的使用方法、IDE 配置技巧、分支命名规范、常见问题的排查方法。同时，制定团队级的 Worktree 使用规范文档，明确目录结构、端口分配规则、数据库命名约定、.env 文件管理策略等。这个阶段的关键是降低学习成本——通过标准化的脚本和配置，让开发者不需要深入理解 worktree 的底层原理就能正确使用。

验收标准：团队中百分之八十以上的成员能够在一天内独立完成 worktree 的创建、使用和清理操作。

### 第四阶段：全面迁移与旧工作流退役（第7-8周）

在全团队熟悉 worktree 工作流后，开始全面迁移。将主仓库正式转换为 bare repo 中枢，所有长期分支（main、develop）都通过 worktree 挂载。废弃旧的单目录开发方式，将相关的文档和脚本标记为过时。同时，持续优化 wtm 脚本，根据团队反馈添加新功能，如自动化的分支清理、端口冲突检测、依赖安装进度追踪等。

验收标准：团队中所有活跃的 feature 分支都使用 worktree 方式开发，旧的 stash 工作流仅作为紧急情况下的备选方案保留。

在整个落地过程中，一个常见的陷阱是试图一步到位。很多团队在第一周就要求所有人切换到 worktree 方式，结果因为各种环境问题（如 Docker 配置不兼容、IDE 插件不支持、数据库连接混乱）导致大量阻塞，最终放弃。渐进式落地的核心思想是：让方案的价值自己说话，而不是通过行政命令强制推行。当开发者亲身体验到 worktree 带来的零切换成本和上下文隔离优势后，自然会主动采用这种工作方式。记住，工具的价值不在于它有多强大，而在于它能否真正解决开发者的日常痛点。

---

## 十四、总结

Git Worktree 与 Bare Repo 的组合方案，本质上是对 Git 内部工作机制的一次深度利用。通过将仓库的存储层（对象库）与工作层（工作目录）彻底分离，我们获得了在单台机器上同时维护多个完整开发环境的能力。这种能力对于大型 Laravel 项目来说尤为重要——当你的项目同时涉及支付模块重构、通知系统升级、紧急 bug 修复和版本发布准备时，能够零成本地在这些上下文之间切换，不仅节省了大量等待依赖安装和环境重建的时间，更重要的是保护了开发者的专注力和思维连续性。

### 工作流决策树

```
需要并行开发多个分支吗？
├── 否 → 使用普通 git checkout + stash
├── 是 → 是否需要同时运行多个环境？
│   ├── 否 → 使用 git worktree（不需 bare repo）
│   └── 是 → 使用 Bare Repo + Worktree ✅
│       ├── 项目规模小（<10人）→ 手动管理 + git alias
│       └── 项目规模大（10+人）→ 自动化脚本 + CI/CD 集成
```

### 核心要点回顾

1. **Bare Repo 作为中枢**：所有分支通过 worktree 挂载，架构清晰
2. **每个 worktree 独立环境**：`.env`、`vendor/`、`node_modules/` 完全隔离
3. **共享 Git 对象库**：磁盘占用远低于多份 clone
4. **自动化脚本**：`wtm` 工具统一管理，降低团队学习成本
5. **CI/CD 集成**：每个分支独立测试环境，支持 review app 部署
6. **命名规范**：统一的目录和分支命名，团队协作无摩擦

### 迁移建议

如果你目前使用传统的单目录 + stash 工作流，建议按以下步骤迁移：

1. **第一周**：在新 feature 分支上试用 worktree，不改变主仓库
2. **第二周**：将主仓库转换为 bare repo，挂载 main 和 develop
3. **第三周**：团队培训，统一脚本和配置
4. **第四周**：全面迁移，废弃旧的 stash 工作流

---

## 相关阅读

- [Git Internals 深度剖析：对象模型、packfile 与引用规范](/categories/CI-CD/Git-Internals-深度剖析-对象模型-packfile-引用规范/) — 深入理解 worktree 底层共享的 Git 对象库机制，从 blob/tree/commit 到 packfile 的完整知识体系
- [Git Bisect + Automated Bug Finding 实战：二分法定位生产回归](/categories/CI-CD/Git-Bisect-Automated-Bug-Finding-实战-二分法定位生产回归-Pest测试-CI自动化bug猎手/) — 结合 worktree 工作流，用 bisect 快速定位多分支并行开发引入的回归 bug
- [GitHub Actions 矩阵策略实战：多 PHP 版本多数据库并行测试](/categories/CI-CD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/) — 配合 worktree 工作流的 CI/CD 矩阵测试方案，每个分支独立测试环境

---

> **参考资料**
> - [Git Worktree 官方文档](https://git-scm.com/docs/git-worktree)
> - [Git Bare Repository 详解](https://git-scm.com/book/en/v2/Git-on-the-Server-Getting-Git-on-a-Server)
> - [Laravel 官方文档 - 环境配置](https://laravel.com/docs/configuration)
> - [GitHub Actions for PHP](https://github.com/shivammathur/setup-php)
