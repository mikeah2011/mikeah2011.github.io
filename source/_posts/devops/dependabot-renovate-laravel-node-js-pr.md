---
title: Dependabot vs Renovate 实战：依赖自动更新策略——Laravel/Node.js 项目的自动 PR 与安全补丁工作流
date: 2026-06-04 09:00:00
tags: [Dependabot, Renovate, CI/CD, Laravel, 依赖管理, 安全]
keywords: [Dependabot vs Renovate, Laravel, Node.js, PR, 依赖自动更新策略, 项目的自动, 与安全补丁工作流, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: "深入对比 Dependabot 与 Renovate 两大依赖自动更新工具在 Laravel/Node.js 项目中的实战应用。涵盖安全漏洞时效分析、自动 PR 配置、分组策略、语义化版本控制、monorepo 支持、与 GitHub Actions CI/CD 集成、安全补丁优先级工作流等完整方案，帮助开发团队建立零人工干预的依赖管理自动化体系。"
---


## 前言

在现代软件开发中，依赖管理早已不是"装完就忘"的一次性操作。一个典型的 Laravel 项目可能直接依赖 50+ 个 Composer 包和 30+ 个 npm 包，而传递依赖（transitive dependencies）更是轻松突破 500 个。每个依赖都可能成为安全漏洞的入口，每次手动更新都是一次"俄罗斯轮盘"。

本文将深入对比 GitHub 原生的 **Dependabot** 和 Mend（前 WhiteSource）开源的 **Renovate** 两大依赖自动更新工具，以 Laravel + Node.js 项目为核心场景，覆盖从基础配置到高级策略的完整实战指南。

---

## 第一章：为什么依赖自动更新如此重要

### 1.1 安全漏洞：时间就是防线

根据 Synopsys《2025 开源安全与风险分析报告》，84% 的代码库包含至少一个已知开源漏洞。更令人担忧的是，CVE 公开后到漏洞被实际利用的中位时间已经缩短到 **不到 48 小时**。

以 Laravel 项目的典型依赖为例：

- **guzzlehttp/guzzle**：历史上多次出现 SSRF 和敏感信息泄露漏洞（CVE-2022-29248、CVE-2022-31042、CVE-2022-31043）
- **phpseclib/phpseclib**：加密库的安全问题直接影响整个应用的安全根基
- **laravel/framework**：框架本身的漏洞更是需要第一时间修补
- **Node.js 生态的 npm 包**：供应链攻击频率逐年上升，event-stream、ua-parser-js 等事件震惊业界

手动跟踪这些漏洞几乎不可能。GitHub Advisory Database 每周新增数十条 PHP/JS 相关的 advisory，人工跟踪意味着你需要：

1. 每天检查 GitHub Security Advisories
2. 逐一判断是否影响你的项目
3. 手动更新依赖并跑测试
4. 等待 Code Review
5. 合并部署

这个流程的平均耗时是 **3-7 个工作日**——而攻击者可能只需要几小时。

### 1.2 技术债：温水煮青蛙

安全漏洞是"急性病"，技术债则是"慢性病"。当你长期不更新依赖：

- **版本差距越拉越大**：Laravel 10 到 11 的升级，如果中间的 patch 和 minor 版本都没跟上，迁移成本会成倍增加
- **Breaking Change 堆积**：一次性跳过多个 major 版本升级，兼容性问题呈指数增长
- **团队士气低落**：没有人喜欢处理积压了半年的依赖更新 PR

### 1.3 自动化更新的核心价值

| 价值维度 | 手动更新 | 自动化更新 |
|---------|---------|-----------|
| 安全响应时间 | 3-7 天 | 数小时内 |
| 更新频率 | 按需（实际是积压） | 每日/每周 |
| 人工投入 | 高（每次需手动操作） | 低（仅需 Review） |
| 测试覆盖 | 容易遗漏 | 自动化 CI 全量测试 |
| 版本跨度风险 | 高（易出现大跨度升级） | 低（小步快跑） |

---

## 第二章：Dependabot 配置实战

### 2.1 Dependabot 简介

Dependabot 是 GitHub 于 2019 年收购并深度集成的依赖更新服务。它的核心优势在于**零部署成本**——任何 GitHub 仓库只需一个配置文件即可启用。2021 年 GitHub 将 Dependabot Alerts、Security Updates 和 Version Updates 全面免费开放给所有公共仓库和私有仓库。

### 2.2 基础配置：dependabot.yml

在仓库根目录创建 `.github/dependabot.yml`：

```yaml
# .github/dependabot.yml
version: 2
updates:
  # === PHP Composer（Laravel）依赖 ===
  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Shanghai"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
      - "composer"
    reviewers:
      - "mikeah2011"
    commit-message:
      prefix: "composer"
      include: "scope"

  # === npm 依赖 ===
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Shanghai"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
      - "npm"
    reviewers:
      - "mikeah2011"
    commit-message:
      prefix: "npm"
      include: "scope"

  # === GitHub Actions ===
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "ci"
```

### 2.3 Laravel 项目进阶配置

针对 Laravel 项目的特殊需求，Dependabot 需要更精细的配置：

```yaml
version: 2
updates:
  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Shanghai"
    open-pull-requests-limit: 15

    # 忽略特定包的 major 版本升级（Laravel 框架本身谨慎升级）
    ignore:
      - dependency-name: "laravel/framework"
        update-types: ["version-update:semver-major"]
      - dependency-name: "laravel/cashier"
        update-types: ["version-update:semver-major"]

    # 允许特定包的开发依赖也更新
    allow:
      - dependency-type: "direct"
      - dependency-type: "indirect"

    # 分组更新：将 Laravel 官方包分为一组
    groups:
      laravel-core:
        patterns:
          - "laravel/*"
        update-types:
          - "minor"
          - "patch"
      spatie-packages:
        patterns:
          - "spatie/*"
      testing-tools:
        patterns:
          - "phpunit/*"
          - "pestphp/*"
          - "laravel/dusk"

    labels:
      - "dependencies"
      - "composer"
      - "auto-update"

    reviewers:
      - "mikeah2011"

    commit-message:
      prefix: "deps"
      include: "scope"
```

**关键配置解读**：

- `ignore` 规则：对 `laravel/framework` 忽略 major 更新，因为 Laravel 的 major 升级（如 10→11）涉及大量 breaking changes，需要人工评估
- `groups` 规则：将 Laravel 官方包（如 laravel/framework、laravel/sanctum、laravel/horizon）打包为一个 PR，避免产生十几个零散 PR
- `open-pull-requests-limit: 15`：Laravel 项目依赖较多，适当提高上限

### 2.4 Node.js 前端资源配置

Laravel 项目通常还有一个前端构建层（Vite/Webpack），需要单独管理 npm 依赖：

```yaml
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "tuesday"
      time: "10:00"
      timezone: "Asia/Shanghai"
    open-pull-requests-limit: 15

    ignore:
      - dependency-name: "vue"
        update-types: ["version-update:semver-major"]
      - dependency-name: "react"
        update-types: ["version-update:semver-major"]

    groups:
      laravel-frontend:
        patterns:
          - "laravel-vite-plugin"
          - "@inertiajs/*"
      vue-ecosystem:
        patterns:
          - "vue"
          - "@vue/*"
          - "vue-router"
          - "pinia"
      build-tools:
        patterns:
          - "vite"
          - "@vitejs/*"
          - "tailwindcss"
          - "postcss"
          - "autoprefixer"
      testing-frontend:
        patterns:
          - "vitest"
          - "@testing-library/*"

    versioning-strategy: increase
```

### 2.5 Dependabot 的优势与局限

**优势**：
- GitHub 原生集成，零部署成本
- 安全更新（Dependabot Security Updates）免费且自动触发
- 与 GitHub Security Advisories 深度联动
- 支持 `auto-merge` 通过 GitHub Actions 实现

**局限**：
- 配置选项相对有限，`ignore` 规则表达能力弱
- 不支持自定义版本匹配策略
- 不支持 Rebase 策略自定义（总是 force-push）
- Monorepo 支持较弱（仅支持多 directory，不支持 workspace 感知）
- 无法自托管

---

## 第三章：Renovate 配置实战

### 3.1 Renovate 简介

Renovate 是 Mend（前 WhiteSource）开源的依赖更新工具，相比 Dependabot 它提供了**远超预期的灵活性**。Renovate 支持 80+ 种包管理器，拥有极其丰富的配置选项，可以精确控制更新的每一个细节。

Renovate 的核心特点：
- 配置文件驱动（`renovate.json`）
- 支持 Presets（可复用配置模板）
- 支持自托管 Renovate Bot
- 强大的 Monorepo 支持
- 精细的自动合并策略
- 自定义版本匹配规则

### 3.2 基础配置：renovate.json

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    ":dependencyDashboard"
  ],
  "timezone": "Asia/Shanghai",
  "schedule": ["every monday before 9:00am"],
  "labels": ["dependencies", "auto-update"],
  "reviewers": ["mikeah2011"],
  "commitMessagePrefix": "deps:",
  "prHourlyLimit": 5,
  "prConcurrentLimit": 10,
  "branchConcurrentLimit": 10,
  "packageRules": [
    {
      "description": "Laravel 核心包分组",
      "matchPackagePatterns": ["^laravel/"],
      "groupName": "Laravel Core Packages",
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true,
      "automergeType": "pr",
      "automergeStrategy": "squash"
    },
    {
      "description": "Spatie 包分组",
      "matchPackagePatterns": ["^spatie/"],
      "groupName": "Spatie Packages",
      "automerge": true
    },
    {
      "description": "安全更新自动合并（patch 级别）",
      "matchUpdateTypes": ["patch"],
      "automerge": true,
      "automergeType": "pr",
      "automergeStrategy": "squash"
    },
    {
      "description": "忽略 Laravel 框架的 major 版本升级",
      "matchPackageNames": ["laravel/framework"],
      "matchUpdateTypes": ["major"],
      "enabled": false
    },
    {
      "description": "开发依赖自动合并",
      "matchDepTypes": ["require-dev"],
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true
    }
  ],
  "composer": {
    "postUpdateOptions": ["composerInstall"]
  }
}
```

### 3.3 Renovate 高级功能详解

#### 3.3.1 自动合并策略（Automerge）

自动合并是 Renovate 最强大的功能之一。在依赖更新的日常运营中，大多数 minor 和 patch 更新是安全的，自动合并可以大幅减少人工干预：

```json
{
  "packageRules": [
    {
      "description": "CI 通过且是 patch 更新的 Composer 包，自动合并",
      "matchManagers": ["composer"],
      "matchUpdateTypes": ["patch"],
      "automerge": true,
      "automergeType": "pr",
      "automergeStrategy": "squash",
      "platformAutomerge": true
    },
    {
      "description": "CI 通过且是 minor 更新的 npm 包，自动合并",
      "matchManagers": ["npm"],
      "matchUpdateTypes": ["minor"],
      "automerge": true,
      "automergeType": "branch"
    },
    {
      "description": "major 版本更新不自动合并，需要人工审核",
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["dependencies", "major-update", "needs-review"]
    }
  ]
}
```

`platformAutomerge` 的工作原理：当 PR 的所有 CI 检查通过后，Renovate 不需要自己等待，而是利用 GitHub 的原生 Auto-Merge 功能，由 GitHub 平台负责在 checks pass 后自动合并。这比 Renovate 自己轮询 checks 状态要高效得多。

#### 3.3.2 分组更新（Grouping）

分组更新将多个相关包的更新合并到一个 PR 中，减少 PR 数量，便于 Review：

```json
{
  "packageRules": [
    {
      "description": "Laravel 生态依赖组",
      "matchPackageNames": [
        "laravel/framework",
        "laravel/sanctum",
        "laravel/horizon",
        "laravel/pulse",
        "laravel/telescope",
        "laravel/cashier"
      ],
      "groupName": "laravel-ecosystem",
      "matchUpdateTypes": ["minor", "patch"]
    },
    {
      "description": "Spatie 权限和媒体包",
      "matchPackageNames": [
        "spatie/laravel-permission",
        "spatie/laravel-medialibrary",
        "spatie/laravel-backup",
        "spatie/laravel-activitylog"
      ],
      "groupName": "spatie-laravel-packages"
    },
    {
      "description": "Vue/Inertia 前端生态",
      "matchPackageNames": [
        "vue",
        "@inertiajs/vue3",
        "pinia",
        "vue-router"
      ],
      "groupName": "frontend-vue-ecosystem"
    },
    {
      "description": "测试工具组",
      "matchPackageNames": [
        "phpunit/phpunit",
        "pestphp/pest",
        "laravel/dusk",
        "mockery/mockery"
      ],
      "groupName": "testing-tools"
    },
    {
      "description": "构建工具组",
      "matchPackageNames": [
        "vite",
        "@vitejs/plugin-vue",
        "tailwindcss",
        "postcss",
        "autoprefixer",
        "sass"
      ],
      "groupName": "build-tools"
    }
  ]
}
```

#### 3.3.3 锁文件维护

Renovate 有一个独特的功能——**Lock File Maintenance**，它会定期重新生成 lock 文件（`composer.lock`、`package-lock.json`），确保所有间接依赖也更新到最新兼容版本：

```json
{
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 3am on the first day of the month"],
    "commitMessagePrefix": "chore:",
    "automerge": true,
    "automergeType": "pr",
    "automergeStrategy": "squash"
  }
}
```

这个功能在 Dependabot 中**完全不存在**。对于 Laravel 项目来说，`composer.lock` 的定期维护非常重要，它能确保间接依赖的安全补丁也能及时更新。

#### 3.3.4 Vulnerability Fixes（安全漏洞修复）

Renovate 可以集成 Mend Vulnerability Database，实现安全漏洞的自动修复：

```json
{
  "vulnerabilityAlerts": {
    "enabled": true,
    "labels": ["security", "urgent"],
    "automerge": true,
    "automergeType": "pr",
    "automergeStrategy": "squash"
  }
}
```

当安全漏洞被检测到时，Renovate 会：
1. 立即创建 PR（不受 `schedule` 限制）
2. 自动添加安全标签
3. 如果配置了 automerge，自动合并

#### 3.3.5 自定义版本匹配

Renovate 支持极其精细的版本匹配策略：

```json
{
  "packageRules": [
    {
      "description": "只允许 Laravel 框架的 patch 更新",
      "matchPackageNames": ["laravel/framework"],
      "matchUpdateTypes": ["patch"],
      "automerge": false,
      "schedule": ["at any time"]
    },
    {
      "description": "PHPUnit major 版本单独管理",
      "matchPackageNames": ["phpunit/phpunit"],
      "matchUpdateTypes": ["major"],
      "schedule": ["every 3 months on the first day of the month"],
      "automerge": false
    }
  ]
}
```

### 3.4 Renovate 的优势与局限

**优势**：
- 配置极其灵活，支持 200+ 配置选项
- 强大的 Preset 系统，可复用社区配置
- Lock File Maintenance 功能独有
- Monorepo 支持优秀（支持 pnpm workspaces、Lerna、Nx 等）
- 支持自托管 Renovate Bot
- 可以自定义 Rebase 策略
- Dependency Dashboard（集中查看所有更新状态）
- 支持 Conventional Commits

**局限**：
- 初始配置学习曲线较陡
- 自托管需要维护 Renovate Bot 实例
- Mend Vulnerability Database 不如 GitHub Advisory Database 全面
- 配置文件过于灵活容易出错（需要 `renovate-config-validator` 校验）

---

## 第四章：Dependabot vs Renovate 详细对比

### 4.1 核心能力对比表

| 特性维度 | Dependabot | Renovate |
|---------|-----------|----------|
| **配置文件** | `.github/dependabot.yml` | `renovate.json` / `.renovaterc` |
| **配置灵活性** | ⭐⭐ 有限 | ⭐⭐⭐⭐⭐ 极其丰富 |
| **分组更新** | ✅ 支持（较新功能） | ✅ 支持（更强大） |
| **自动合并** | ⚠️ 需配合 GitHub Actions | ✅ 原生支持多种策略 |
| **Lock File Maintenance** | ❌ 不支持 | ✅ 支持 |
| **Rebase 策略** | ❌ 总是 force-push | ✅ 可自定义（auto/rebase/ff 等） |
| **Monorepo 支持** | ⚠️ 基础（多 directory） | ✅ 优秀（workspace 感知） |
| **安全更新** | ✅ GitHub Advisory Database | ✅ Mend Vulnerability Database |
| **自托管** | ❌ 仅 GitHub | ✅ 支持 GitLab、Bitbucket 等 |
| **Dependency Dashboard** | ❌ 无 | ✅ 集中管理界面 |
| **Preset 复用** | ❌ 无 | ✅ 社区和自定义 Preset |
| **部署成本** | 零（GitHub 内置） | 需安装 GitHub App 或自托管 |
| **学习曲线** | 低 | 中高 |
| **PR 数量控制** | `open-pull-requests-limit` | `prConcurrentLimit` + `prHourlyLimit` |
| **调度灵活性** | 每天/每周/每月 | 支持 cron 表达式 + 预设模板 |
| **平台支持** | GitHub | GitHub、GitLab、Bitbucket、Azure DevOps |
| **成本** | 免费（GitHub 功能） | 开源免费 / Mend 托管付费 |

### 4.2 Laravel 项目特定对比

| 场景 | Dependabot | Renovate |
|-----|-----------|----------|
| Composer 包更新 | ✅ 支持 | ✅ 支持 |
| `composer.lock` 维护 | ❌ 不更新 lock 文件 | ✅ Lock File Maintenance |
| Laravel 官方包分组 | ✅ `groups` 规则 | ✅ `groupName` 规则 |
| 跳过框架 major 升级 | ✅ `ignore` 规则 | ✅ `enabled: false` + 规则 |
| 安全漏洞自动修复 PR | ✅ GitHub 原生 | ✅ Mend Vulnerability Alerts |
| Pest/PHPUnit 更新策略 | 基础分组 | 详细的按包名/类型匹配 |

### 4.3 Node.js 项目特定对比

| 场景 | Dependabot | Renovate |
|-----|-----------|----------|
| npm/pnpm/yarn 支持 | ✅ 主流包管理器 | ✅ 全部支持 |
| `package-lock.json` 维护 | ❌ | ✅ Lock File Maintenance |
| Vite/Webpack 插件分组 | ✅ 模式匹配 | ✅ 精确包名匹配 |
| @types/* 更新 | 基础支持 | ✅ 可与源包关联 |
| Monorepo workspace | ⚠️ 需要多 directory 配置 | ✅ 原生 pnpm workspaces 支持 |

### 4.4 自动合并能力对比

自动合并是日常运营中最重要的功能。两者实现方式截然不同：

**Dependabot 的自动合并**：依赖 GitHub Actions 工作流

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot Auto-Merge
on: pull_request

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Dependabot Metadata
        id: metadata
        uses: dependabot/fetch-metadata@v2
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

      - name: Auto-merge Patch Updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{github.event.pull_request.html_url}}
          GH_TOKEN: ${{secrets.GITHUB_TOKEN}}

      - name: Auto-merge Minor for Dev Dependencies
        if: >-
          steps.metadata.outputs.update-type == 'version-update:semver-minor' &&
          steps.metadata.outputs.dependency-type == 'direct:development'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{github.event.pull_request.html_url}}
          GH_TOKEN: ${{secrets.GITHUB_TOKEN}}
```

**Renovate 的自动合并**：原生配置，无需额外工作流

```json
{
  "packageRules": [
    {
      "matchUpdateTypes": ["patch"],
      "automerge": true,
      "automergeType": "pr",
      "automergeStrategy": "squash",
      "platformAutomerge": true
    }
  ]
}
```

---

## 第五章：安全补丁加急工作流

### 5.1 为什么需要"加急"机制

常规的依赖更新按周/天调度，但安全漏洞不能等。我们需要一个独立的、立即触发的安全补丁工作流。

### 5.2 Dependabot 安全补丁工作流

Dependabot 的安全更新是内置功能。当 GitHub Advisory Database 中出现影响你项目的 CVE 时，Dependabot 会自动创建 PR。你可以配合 GitHub Actions 实现加急自动合并：

```yaml
# .github/workflows/security-auto-merge.yml
name: Security Auto-Merge
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write
  security-events: write

jobs:
  security-patch-merge:
    runs-on: ubuntu-latest
    # 仅当 Dependabot 触发且是安全更新时执行
    if: github.actor == 'dependabot[bot]'
    steps:
      - name: Fetch Dependabot Metadata
        id: metadata
        uses: dependabot/fetch-metadata@v2
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

      # 安全更新：不论 patch/minor/major，一律自动合并
      - name: Auto-Merge Security Patches
        if: steps.metadata.outputs.alerts-fetched == 'true'
        run: |
          echo "🔒 Security update detected, auto-merging..."
          gh pr merge --auto --squash "$PR_URL"
          gh pr edit "$PR_URL" --add-label "security,urgent"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # 非安全更新的常规处理
      - name: Auto-Merge Patch Updates
        if: >-
          steps.metadata.outputs.alerts-fetched != 'true' &&
          steps.metadata.outputs.update-type == 'version-update:semver-patch'
        run: |
          echo "📦 Patch update, auto-merging..."
          gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # 通知 Slack（可选）
      - name: Notify Slack for Security Updates
        if: steps.metadata.outputs.alerts-fetched == 'true'
        uses: slackapi/slack-github-action@v2
        with:
          webhook: ${{ secrets.SLACK_SECURITY_WEBHOOK }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "🔒 Security update auto-merged: ${{ github.event.pull_request.title }}\n${{ github.event.pull_request.html_url }}"
            }
```

### 5.3 Renovate 安全补丁工作流

Renovate 同样支持安全漏洞的加急处理：

```json
{
  "packageRules": [
    {
      "description": "安全漏洞修复：立即触发，自动合并",
      "matchUpdateTypes": ["security"],
      "schedule": ["at any time"],
      "automerge": true,
      "automergeType": "pr",
      "automergeStrategy": "squash",
      "platformAutomerge": true,
      "labels": ["security", "urgent", "auto-merge"],
      "priority": 1
    }
  ],
  "vulnerabilityAlerts": {
    "enabled": true,
    "labels": ["security"],
    "automerge": true,
    "automergeType": "pr"
  }
}
```

### 5.4 安全补丁 CI 验证工作流

无论使用哪种工具，安全补丁在自动合并前必须通过 CI 验证：

```yaml
# .github/workflows/security-patch-ci.yml
name: Security Patch CI
on:
  pull_request:
    branches: [main]
    paths:
      - 'composer.json'
      - 'composer.lock'
      - 'package.json'
      - 'package-lock.json'

jobs:
  # PHP 测试
  php-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ['8.2', '8.3', '8.4']
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          extensions: dom, curl, mbstring, zip, pdo, sqlite, pdo_sqlite, gd, redis
          coverage: none

      - name: Install Composer Dependencies
        run: composer install --no-interaction --prefer-dist

      - name: Run PHP Tests
        run: php artisan test --parallel

      - name: Run Static Analysis
        run: vendor/bin/phpstan analyse --memory-limit=2G

  # Node.js 测试
  node-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: ['20', '22']
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'

      - name: Install npm Dependencies
        run: npm ci

      - name: Run Frontend Tests
        run: npm run test

      - name: Build Frontend Assets
        run: npm run build

  # 安全扫描
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Composer Audit
        run: composer audit

      - name: npm Audit
        run: npm audit --audit-level=high

      - name: Run Snyk Security Scan
        uses: snyk/actions@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

---

## 第六章：GitHub Actions 集成实战

### 6.1 完整的 Dependabot + GitHub Actions 自动化流水线

```yaml
# .github/workflows/dependabot-automation.yml
name: Dependabot Automation
on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  checks: write

jobs:
  # 第一步：识别 Dependabot PR 并获取元数据
  dependabot-metadata:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    outputs:
      update-type: ${{ steps.metadata.outputs.update-type }}
      dependency-type: ${{ steps.metadata.outputs.dependency-type }}
      package-names: ${{ steps.metadata.outputs.package-names }}
      is-security: ${{ steps.metadata.outputs.alerts-fetched }}
    steps:
      - name: Fetch Metadata
        id: metadata
        uses: dependabot/fetch-metadata@v2
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

  # 第二步：运行完整 CI 测试
  ci-tests:
    needs: dependabot-metadata
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, sqlite, pdo_sqlite
          coverage: none

      - name: Install Dependencies
        run: composer install --no-interaction --prefer-dist

      - name: Run Tests
        run: php artisan test

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install npm Dependencies
        run: npm ci

      - name: Build Assets
        run: npm run build

  # 第三步：基于结果决定是否自动合并
  auto-merge:
    needs: [dependabot-metadata, ci-tests]
    runs-on: ubuntu-latest
    if: always()
    steps:
      # 安全更新：立即合并
      - name: Merge Security Updates
        if: needs.dependabot-metadata.outputs.is-security == 'true'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # Patch 更新：自动合并
      - name: Merge Patch Updates
        if: >-
          needs.dependabot-metadata.outputs.update-type == 'version-update:semver-patch' &&
          needs.ci-tests.result == 'success'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # Dev 依赖 minor 更新：自动合并
      - name: Merge Dev Minor Updates
        if: >-
          needs.dependabot-metadata.outputs.update-type == 'version-update:semver-minor' &&
          needs.dependabot-metadata.outputs.dependency-type == 'direct:development' &&
          needs.ci-tests.result == 'success'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # 其他情况：添加需要 Review 标签
      - name: Label for Manual Review
        if: needs.ci-tests.result == 'success' && !contains(github.event.pull_request.labels.*.name, 'auto-merge')
        run: gh pr edit "$PR_URL" --add-label "needs-review"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 6.2 Renovate 验证 GitHub Actions 工作流

如果你使用自托管 Renovate，需要一个专用的 CI 工作流来验证 Renovate 的配置和 PR：

```yaml
# .github/workflows/renovate-ci.yml
name: Renovate CI
on:
  pull_request:
    branches: [main]
    paths:
      - 'composer.json'
      - 'composer.lock'
      - 'package.json'
      - 'package-lock.json'

concurrency:
  group: renovate-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # 校验 Composer 依赖
      - name: Validate Composer
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - run: composer validate --strict
      - run: composer install --no-interaction --prefer-dist
      - run: composer audit

      # 校验 npm 依赖
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm audit --audit-level=high

  test:
    needs: validate
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ['8.2', '8.3']
        node: ['20', '22']
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP ${{ matrix.php }}
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}

      - name: Setup Node.js ${{ matrix.node }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'

      - run: composer install --no-interaction --prefer-dist
      - run: npm ci
      - run: npm run build
      - run: php artisan test
```

---

## 第七章：真实 Laravel 项目踩坑记录

### 7.1 踩坑一：Composer 内存限制导致 Dependabot 更新失败

**问题**：大型 Laravel 项目的 `composer update` 在 Dependabot 的 Runner 上 OOM。

**症状**：Dependabot PR 创建后，更新日志显示 `RuntimeException: proc_open(): fork failed - Cannot allocate memory`。

**解决方案**：

```yaml
# 在 composer.json 中添加配置
{
    "config": {
        "preferred-install": "dist",
        "sort-packages": true,
        "process-timeout": 600,
        "memory-limit": "2G"
    }
}
```

同时在 `.github/dependabot.yml` 中为 Composer 更新指定特定的 reviewer，确保团队中有人关注此类失败。

### 7.2 踩坑二：Laravel Mix/Vite 构建失败导致 Renovate PR 合并阻塞

**问题**：Renovate 更新了 `@vitejs/plugin-vue` 的 minor 版本，但该版本与项目使用的 Vue 版本不兼容，导致构建失败。

**解决方案**：

```json
{
  "packageRules": [
    {
      "description": "将 Vue 和 Vite 插件绑定在一起更新",
      "matchPackageNames": [
        "vue",
        "@vitejs/plugin-vue",
        "vue-router",
        "pinia"
      ],
      "groupName": "vue-ecosystem",
      "matchUpdateTypes": ["minor", "patch"]
    }
  ]
}
```

**教训**：生态系统内的包必须分组更新，否则很容易出现版本不兼容。

### 7.3 踩坑三：Dependabot PR 冲突解决困难

**问题**：多个 Dependabot PR 同时修改 `composer.lock`，合并第一个后，其余 PR 全部产生冲突。

**症状**：`composer.lock` 文件中 500+ 行冲突标记。

**解决方案**：

1. 提高 `open-pull-requests-limit` 但设置更频繁的调度
2. 使用 Renovate 的 Lock File Maintenance 功能定期清理
3. 配置分支保护规则要求 CI 通过，避免错误合并

```yaml
# dependabot.yml 优化
version: 2
updates:
  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "daily"    # 改为每天，每次更新更少的包
    open-pull-requests-limit: 5   # 降低同时打开的 PR 数量
    groups:
      all-composer:
        patterns:
          - "*"
        update-types:
          - "minor"
          - "patch"
```

### 7.4 踩坑四：npm peer dependency 冲突

**问题**：Renovate 更新了 `tailwindcss` 到 v4，但项目使用的 `@tailwindcss/forms` 尚不支持 v4。

**解决方案**：

```json
{
  "packageRules": [
    {
      "description": "忽略 Tailwind CSS v4 直到整个生态兼容",
      "matchPackageNames": ["tailwindcss"],
      "matchUpdateTypes": ["major"],
      "enabled": false
    },
    {
      "description": "忽略 Tailwind 插件的 major 版本",
      "matchPackagePatterns": ["^@tailwindcss/"],
      "matchUpdateTypes": ["major"],
      "enabled": false
    }
  ]
}
```

### 7.5 踩坑五：Renovate 误判版本号

**问题**：某些 Laravel 包使用非标准版本号（如 `dev-main`、`^1.0@beta`），Renovate 无法正确解析。

**解决方案**：

```json
{
  "packageRules": [
    {
      "description": "处理 Laravel 包的 dev 版本",
      "matchPackageNames": [
        "laravel/framework"
      ],
      "matchCurrentVersion": ">=10.0.0",
      "versioningTemplate": "semver"
    }
  ]
}
```

### 7.6 踩坑六：GitHub Actions 限制导致自动合并失败

**问题**：使用 `gh pr merge --auto` 时，如果仓库开启了 Branch Protection 要求特定 checks，而这些 checks 尚未被触发，GitHub 会拒绝 auto-merge 请求。

**解决方案**：

```yaml
- name: Enable Auto-Merge
  run: |
    # 先尝试启用 auto-merge
    gh pr merge --auto --squash "$PR_URL" || {
      echo "::warning::Auto-merge not available, adding label instead"
      gh pr edit "$PR_URL" --add-label "ready-to-merge"
    }
  env:
    PR_URL: ${{ github.event.pull_request.html_url }}
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 第八章：推荐配置模板

### 8.1 小型 Laravel 项目（推荐 Dependabot）

如果你的项目规模较小（< 30 个直接依赖），团队没有专人维护依赖更新，推荐使用 Dependabot：

```yaml
# .github/dependabot.yml — 小型 Laravel 项目推荐配置
version: 2
updates:
  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Shanghai"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
    groups:
      laravel:
        patterns: ["laravel/*"]
      all-laravel-pkgs:
        patterns: ["*"]
        update-types: ["patch"]
    ignore:
      - dependency-name: "laravel/framework"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "tuesday"
    open-pull-requests-limit: 10
    groups:
      frontend:
        patterns: ["*"]
        update-types: ["patch"]

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### 8.2 中大型 Laravel 项目（推荐 Renovate）

如果你的项目有 50+ 直接依赖，使用 Monorepo 结构，或需要精细化控制更新策略，强烈推荐 Renovate：

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    ":dependencyDashboard",
    ":semanticCommitTypeAll(deps)"
  ],
  "timezone": "Asia/Shanghai",
  "schedule": ["every monday before 9am"],
  "prHourlyLimit": 5,
  "prConcurrentLimit": 10,
  "branchConcurrentLimit": 15,
  "labels": ["dependencies"],
  "reviewers": ["team:backend", "team:frontend"],
  "composer": {
    "postUpdateOptions": ["composerInstall"]
  },
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 3am on the first day of the month"],
    "automerge": true,
    "automergeType": "pr",
    "automergeStrategy": "squash"
  },
  "vulnerabilityAlerts": {
    "enabled": true,
    "labels": ["security", "urgent"],
    "automerge": true
  },
  "packageRules": [
    {
      "description": "安全更新：随时触发，自动合并",
      "matchUpdateTypes": ["security"],
      "schedule": ["at any time"],
      "automerge": true,
      "platformAutomerge": true,
      "priority": 1
    },
    {
      "description": "Laravel 核心：minor/patch 分组自动合并",
      "matchPackagePatterns": ["^laravel/"],
      "groupName": "laravel-core",
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true,
      "automergeType": "pr",
      "automergeStrategy": "squash"
    },
    {
      "description": "Laravel 框架 major 版本：手动管理",
      "matchPackageNames": ["laravel/framework"],
      "matchUpdateTypes": ["major"],
      "enabled": false
    },
    {
      "description": "Spatie 包：分组自动合并",
      "matchPackagePatterns": ["^spatie/"],
      "groupName": "spatie-packages",
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true
    },
    {
      "description": "Vue 生态：统一版本",
      "matchPackageNames": ["vue", "@vitejs/plugin-vue", "vue-router", "pinia"],
      "groupName": "vue-ecosystem",
      "automerge": false
    },
    {
      "description": "开发依赖：自动合并 minor/patch",
      "matchDepTypes": ["require-dev", "devDependencies"],
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true
    },
    {
      "description": "测试工具：分组更新",
      "matchPackageNames": ["phpunit/phpunit", "pestphp/pest", "laravel/dusk", "vitest", "@testing-library/vue"],
      "groupName": "testing-tools"
    },
    {
      "description": "构建工具：分组更新",
      "matchPackageNames": ["vite", "tailwindcss", "postcss", "sass", "autoprefixer"],
      "groupName": "build-tools"
    },
    {
      "description": "GitHub Actions：自动合并",
      "matchManagers": ["github-actions"],
      "automerge": true,
      "automergeType": "pr"
    },
    {
      "description": "非 patch 的生产依赖：需要 Review",
      "matchDepTypes": ["require", "dependencies"],
      "matchUpdateTypes": ["minor"],
      "automerge": false,
      "labels": ["dependencies", "needs-review"]
    }
  ]
}
```

### 8.3 混合使用策略

实际上，Dependabot 和 Renovate 并不互斥。一些团队选择混合使用：

- **Dependabot**：负责 GitHub Security Advisories 的安全更新（利用其与 GitHub 的原生集成优势）
- **Renovate**：负责常规的版本更新和 Lock File Maintenance

混合使用时需要注意：
1. 在 Dependabot 中通过 `ignore` 规则避免与 Renovate 重复
2. 给两个工具创建的 PR 使用不同的标签区分
3. 确保 auto-merge 逻辑不会产生冲突

---

## 第九章：迁移指南

### 9.1 从 Dependabot 迁移到 Renovate

如果你已经使用 Dependabot，想要切换到 Renovate：

1. 安装 Renovate GitHub App（从 GitHub Marketplace）
2. 创建 `renovate.json` 配置文件
3. 等待 Renovate 提交第一个 Dependency Dashboard PR
4. 逐步删除 `.github/dependabot.yml`
5. 处理已有的 Dependabot PR（手动合并或关闭）

迁移过程中的注意事项：
- Renovate 的首次运行会产生一个 Dependency Dashboard issue，展示所有检测到的依赖
- 可以先将 Renovate 的 `prConcurrentLimit` 设为 1，逐步放量
- 使用 `dryRun: "full"` 模式先预览 Renovate 会创建哪些 PR

### 9.2 从 Renovate 迁移到 Dependabot

1. 创建 `.github/dependabot.yml`
2. 删除 `renovate.json`
3. 卸载 Renovate GitHub App
4. 关闭 Renovate 创建的所有 PR

---

## 第十章：总结与建议

### 10.1 选型建议

| 你的情况 | 推荐工具 | 理由 |
|---------|---------|------|
| 小团队、简单项目 | **Dependabot** | 零配置成本，GitHub 原生 |
| 需要安全更新自动修复 | **两者皆可** | 都支持，但 Dependabot 与 GitHub 更紧密 |
| 大型 Monorepo | **Renovate** | workspace 感知，分组灵活 |
| 需要自动合并 | **Renovate** | 原生支持，无需额外 Actions |
| 需要自托管 | **Renovate** | Dependabot 不支持 |
| GitLab/Bitbucket 项目 | **Renovate** | Dependabot 仅支持 GitHub |
| 需要 Lock File Maintenance | **Renovate** | Dependabot 不支持 |
| 追求最低维护成本 | **Dependabot** | GitHub 托管，无需维护 |

### 10.2 最终建议

对于 Laravel + Node.js 全栈项目，我的推荐是：

1. **起步阶段**：使用 Dependabot，快速启用安全更新
2. **成长阶段**：切换到 Renovate，享受更灵活的配置
3. **成熟阶段**：根据团队需要，可以混合使用两者

无论选择哪个工具，核心目标都是一样的：**让依赖更新成为日常，而不是灾难**。自动化更新配合完善的 CI 测试，是保障项目安全和健康的最佳实践。

### 10.3 一句话总结

> **Dependabot 是"开箱即用的电动自行车"，适合短途通勤；Renovate 是"可定制的越野摩托车"，适合长途探险。选哪个，取决于你的路有多远、多复杂。**

---

## 附录：常用命令速查

### Dependabot 相关命令

```bash
# 查看 Dependabot 日志
# 在 GitHub 仓库 → Insights → Dependency graph → Dependabot

# 手动触发 Dependabot 安全更新
# 在 GitHub 仓库 → Security → Dependabot alerts → 选择漏洞 → Create security update

# 查看 Dependabot PR 的元数据
gh pr view <PR_NUMBER> --json labels,author
```

### Renovate 相关命令

```bash
# 验证 renovate.json 配置
npx --yes renovate-config-validator

# 本地运行 Renovate（dry-run 模式）
npx renovate --dry-run=true --token=<GITHUB_TOKEN> <REPO>

# 查看 Renovate 日志
# 在 GitHub 仓库 → Issues → Dependency Dashboard

# 手动触发 Renovate 运行
# 在 GitHub 仓库 → Actions → Renovate → Run workflow
```

### GitHub Actions 自动合并相关

```bash
# 手动合并 PR
gh pr merge <PR_NUMBER> --squash

# 启用自动合并（需要 Branch Protection 规则）
gh pr merge <PR_NUMBER> --auto --squash

# 查看 PR 的 checks 状态
gh pr checks <PR_NUMBER>
```

---

*本文最后更新于 2026 年 6 月 4 日。依赖管理工具在持续演进中，建议定期关注 [Dependabot 文档](https://docs.github.com/en/code-security/dependabot) 和 [Renovate 文档](https://docs.renovatebot.com/) 获取最新信息。*

## 相关阅读

- [容器安全扫描实战：Trivy/Snyk/Grype CI 集成——镜像漏洞检测、SBOM 生成与修复工作流](/post/trivy-snyk-grype-ci-sbom/)
- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/post/github-actions-php/)
- [Trunk-Based Development 深度实战：Feature Flag 替代长生命周期分支的工程化落地](/post/trunk-based-development-feature-flag/)
- [Progressive Delivery 实战：Feature Flag + 渐进式发布——Unleash + Argo Rollouts 的完整工程化工作流](/post/progressive-delivery-feature-flag-unleash-argo-rollouts/)
