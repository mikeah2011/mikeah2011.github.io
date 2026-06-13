---
title: 'Conventional Commits + Semantic Release 实战：自动版本号、CHANGELOG 生成与npm/Composer 包发布——Laravel 项目的发布自动化流水线'
date: 2026-06-05 10:00:00
tags: [Conventional Commits, Semantic Release, 自动化, CI/CD, Laravel]
keywords: [Conventional Commits, Semantic Release, CHANGELOG, npm, Composer, Laravel, 自动版本号, 生成与, 包发布, 项目的发布自动化流水线]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: '深入实战 Conventional Commits 与 Semantic Release，为 Laravel 项目搭建自动化发布流水线：自动推算版本号、生成 CHANGELOG、同步发布 npm 与 Composer 包到 Packagist，含 GitHub Actions 完整配置。'
---


# Conventional Commits + Semantic Release 实战：自动版本号、CHANGELOG 生成与 npm/Composer 包发布——Laravel 项目的发布自动化流水线

在当今快速迭代的软件开发环境中，版本管理和发布流程的自动化程度直接影响着团队的交付效率和代码质量。想象一下这样的场景：你所在的团队维护着一个 Laravel 后端服务和配套的前端组件库，每次发布新版本时，你需要手动修改 `composer.json` 和 `package.json` 中的版本号，手动撰写 CHANGELOG，手动创建 Git Tag，然后分别执行 `composer publish` 和 `npm publish`。这个过程不仅耗时耗力，而且极其容易出错——漏掉一个 breaking change 的记录、版本号忘记更新、CHANGELOG 格式不统一等问题层出不穷。

本文将从零开始，手把手带你搭建一套基于 **Conventional Commits** 规范与 **Semantic Release** 工具链的完整自动化发布流水线。我们将以一个真实的 Laravel Composer 包项目为例，覆盖从提交规范的建立、版本号的自动推算、CHANGELOG 的自动生成，到 npm 包和 Composer 包的自动发布的全流程。读完本文后，你将拥有一套可以立即投入生产使用的发布自动化方案。

<!-- more -->

---

## 一、为什么你的项目迫切需要自动化发布？

在我参与过的众多 Laravel 项目中，手动管理发布流程带来的问题反复出现，总结起来主要有以下几个方面：

**版本号管理混乱**：不同的开发者对语义化版本号的理解各不相同。有人觉得加了一个新功能应该递增主版本号，有人则认为只是改了个小接口不需要升版本。版本号的随意性导致上线后回退版本时找不到对应的历史记录，严重时甚至影响到线上环境的稳定运行。

**变更日志形同虚设**：几乎每个项目的 `CHANGELOG.md` 都经历过这样的生命周期——项目初期维护了几条，然后随着功能快速迭代逐渐被遗忘，最终变成一个无人问津的废弃文件。等到需要排查问题时才发现，历史变更记录一片空白，完全无法追溯某个功能是在哪个版本引入的。

**发布过程繁琐且易错**：每次发布都需要执行一系列步骤——确认测试通过、修改版本号、更新变更日志、提交代码、打标签、推送到远程、发布到包管理器。任何一个步骤的遗漏都可能导致发布失败或产生不一致的状态。

**跨平台发布协调困难**：对于同时维护 Composer 包和 npm 包的 Laravel 项目，需要分别在两个平台上发布，确保版本号一致，这进一步增加了手动操作的复杂度和出错概率。

引入 Conventional Commits 规范配合 Semantic Release 工具链，可以从根本上解决上述所有问题。核心思想很简单：**让提交信息本身携带语义信息，工具链根据这些语义信息自动完成所有发布相关的操作**。这样一来，开发者只需要专注于编写高质量的代码和规范的提交信息，其余一切交给自动化流水线处理。

---

## 二、Conventional Commits 规范深度解析

### 2.1 规范的核心思想

[Conventional Commits](https://www.conventionalcommits.org/) 是由 Angular 团队首先提出并推广的一种提交信息编写约定。它的核心理念是：**提交信息本身就是一种结构化的数据，通过约定固定的格式，可以让机器解析和利用这些信息**。

规范定义的基本格式如下：

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

让我们逐个字段进行详细说明：

**type 字段**是必填的，它描述了本次提交的性质。规范预定义了一组标准类型，每种类型对应着不同的语义含义。工具链正是根据 type 来判断应该递增哪个版本号。正确选择 type 至关重要，它直接影响版本号的推算结果。

**scope 字段**是可选的，用于描述本次变更影响的范围。在 Laravel 项目中，scope 通常对应着应用的某个模块或组件，例如 `auth`、`api`、`model`、`migration` 等。合理使用 scope 可以让 CHANGELOG 更加清晰，方便读者快速定位感兴趣的内容。

**description 字段**是必填的简短描述，应该用简洁的语言概括本次变更的内容。规范建议使用祈使语气（如"添加功能"而非"添加了功能"），首字母小写，末尾不加句号。

**body 字段**是可选的详细说明，用于补充 description 中无法容纳的信息。如果本次变更涉及的技术细节较多、影响范围较广，建议在 body 中进行详细说明。

**footer 字段**是可选的元信息，常用于引用关联的 Issue 编号或标注破坏性变更。footer 的格式遵循 Git trailer 约定，即 `key: value` 或 `key #value` 的形式。

### 2.2 标准 Commit 类型及其语义

以下是 Conventional Commits 规范中定义的标准类型，以及它们在 Laravel 项目中的典型应用场景：

**`feat` —— 新功能**：这是最常见的类型之一，表示为项目添加了一个新的功能特性。在 Laravel 项目中，这可能是一个新的 API 接口、一个新的命令行命令、一个新的 Eloquent 模型方法等。`feat` 类型的提交会触发 **次版本号（Minor）** 的递增。

示例：
```
feat(auth): 添加 OAuth2 社交登录支持

集成 Google 和 GitHub 的 OAuth2 登录，
用户可以通过社交账号快速注册和登录系统。

Closes #127
```

**`fix` —— Bug 修复**：表示修复了代码中的一个错误。这可能是修复了一个导致崩溃的空指针异常、修复了一个计算逻辑错误、修复了一个接口返回值不正确的问题等。`fix` 类型的提交会触发 **修订版本号（Patch）** 的递增。

示例：
```
fix(migration): 修复 PostgreSQL 下迁移文件执行失败的问题

在 PostgreSQL 环境下，某些迁移文件中的 JSON 列定义
会导致类型不匹配的错误，需要显式指定 JSONB 类型。

Fixes #203
```

**`docs` —— 文档变更**：仅修改文档内容，不涉及代码逻辑的变更。比如更新 README 中的使用说明、补充 API 文档、修改代码注释等。文档变更不会触发版本号递增。

**`style` —— 代码风格调整**：不影响代码逻辑的格式化修改，包括代码缩进、空格、引号风格、尾逗号等。这类变更同样不会触发版本号递增。

**`refactor` —— 代码重构**：既不添加新功能也不修复 Bug 的代码改动。重构的目的是改善代码结构、提高可读性或可维护性。比如将一段重复的逻辑提取为公共方法、将一个臃肿的服务类拆分为多个职责单一的类等。

**`perf` —— 性能优化**：专门用于改善代码性能的提交。在 Laravel 项目中，这可能包括优化数据库查询减少 N+1 问题、引入缓存机制提升响应速度、优化队列任务处理效率等。

**`test` —— 测试相关**：添加或修改测试用例。包括单元测试、功能测试、集成测试等。注意如果在修复 Bug 的同时也添加了回归测试，建议将主要变更和测试分别提交，或者将测试放在 `fix` 提交的 body 中说明。

**`build` —— 构建系统变更**：影响构建系统或外部依赖的修改。在 Laravel 项目中，这可能包括更新 `composer.json` 中的依赖版本、修改 Webpack/Vite 的构建配置、调整 Docker 镜像的构建流程等。

**`ci` —— CI 配置变更**：修改持续集成和持续部署的配置文件。比如更新 GitHub Actions 的工作流配置、添加新的 CI 测试阶段、修改部署脚本等。

**`chore` —— 日常维护**：不属于上述任何类型的日常维护工作。比如清理无用的配置文件、更新项目元数据、修改 `.gitignore` 等。

**`revert` —— 回滚提交**：回退之前的一次提交。revert 类型的提交应该在 body 中注明被回退的提交哈希。

### 2.3 Breaking Change 的标注方式

破坏性变更（Breaking Change）是指那些会导致现有功能不兼容的修改。在语义化版本管理中，破坏性变更会触发 **主版本号（Major）** 的递增，这是最重要的版本号变化，因为它意味着使用者需要对代码进行适配才能正常升级。

Conventional Commits 规范提供了两种标注破坏性变更的方式：

**方式一：在 footer 中添加 `BREAKING CHANGE` 标记**

```
feat(api): 重构用户认证接口响应格式

将认证接口的响应结构从扁平格式改为嵌套格式，
提升 API 响应的可读性和扩展性。

BREAKING CHANGE: 认证接口 /api/auth/login 的响应格式
从 { token, user_id, name } 改为
{ data: { token, user: { id, name } } }
```

**方式二：在 type 后添加感叹号标记**

```
feat(api)!: 重构用户认证接口响应格式
```

两种方式在语义上是等价的，工具链都能正确识别。建议在团队中统一使用一种方式，我个人更推荐使用 footer 方式，因为它允许在 footer 中附带详细的迁移说明，方便使用者了解如何适配。

### 2.4 为 Laravel 项目定制 Commit 规范

虽然 Conventional Commits 规范的 type 是固定的，但 scope 可以根据项目需求自由定制。在 Laravel 项目中，建议建立一套统一的 scope 约定：

- `model` —— Eloquent 模型相关的变更
- `controller` —— 控制器逻辑变更
- `middleware` —— 中间件相关变更
- `migration` —— 数据库迁移文件变更
- `blade` —— Blade 模板变更
- `api` —— API 接口相关变更
- `queue` —— 队列任务相关变更
- `config` —— 配置文件变更
- `service` —— 服务层逻辑变更
- `event` —— 事件和监听器变更
- `command` —— Artisan 命令变更

使用统一的 scope 约定有两个好处：一是帮助团队成员快速理解变更影响的范围，二是在生成 CHANGELOG 时可以按 scope 分组展示，提高可读性。

### 2.5 工具链强制执行规范

光靠口头约定是不够的，我们需要借助工具来强制执行 Conventional Commits 规范。常用的工具链组合包括 commitlint、husky 和 commitizen。

**commitlint** 负责校验提交信息是否符合规范格式。安装和配置如下：

```bash
npm install --save-dev @commitlint/cli @commitlint/config-conventional
```

创建 `commitlint.config.js` 配置文件：

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'docs', 'style', 'refactor',
      'perf', 'test', 'build', 'ci', 'chore', 'revert'
    ]],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
  },
};
```

**husky** 利用 Git Hooks 机制，在开发者执行 `git commit` 时自动触发 commitlint 校验。如果提交信息不符合规范，提交操作会被拒绝。这种即时反馈机制可以有效地从源头保证提交质量。

```bash
npm install --save-dev husky
npx husky init
echo 'npx --no -- commitlint --edit $1' > .husky/commit-msg
```

**commitizen** 提供了一个交互式的命令行工具，通过问答引导的方式帮助开发者编写规范的提交信息，非常适合刚接触 Conventional Commits 的团队成员使用。

```bash
npm install --save-dev commitizen cz-conventional-changelog
```

在 `package.json` 中注册 commitizen 适配器：

```json
{
  "scripts": {
    "commit": "cz"
  },
  "config": {
    "commitizen": {
      "path": "cz-conventional-changelog"
    }
  }
}
```

之后团队成员使用 `npm run commit` 代替 `git commit`，就会进入交互式界面，按照提示逐步选择提交类型、填写影响范围和描述信息。

---

## 三、语义化版本号的推算规则

语义化版本（Semantic Versioning，简称 SemVer）定义了版本号的格式为 `MAJOR.MINOR.PATCH`，每一位的递增都代表着特定类型的变更。Semantic Release 将 Conventional Commits 的类型映射到版本号的递增规则上：

当一个提交的类型是 `fix` 时，PATCH 位递增（例如从 `1.2.3` 变为 `1.2.4`），表示这是一次向下兼容的问题修正。当类型是 `feat` 时，MINOR 位递增（例如从 `1.2.3` 变为 `1.3.0`），表示添加了向下兼容的新功能。当提交中包含 `BREAKING CHANGE` 标记时，不论类型是什么，MAJOR 位都会递增（例如从 `1.2.3` 变为 `2.0.0`），表示存在不兼容的 API 变更。

需要特别注意的一个细节是：当主版本号为 `0` 时（即 `0.x.x` 阶段），版本号的推算规则会有所不同。在 `0.x` 阶段，`feat` 类型的提交只会触发 PATCH 递增而不是 MINOR 递增，这反映了项目尚处于初始开发阶段、API 不稳定的现实状态。只有当团队认为 API 已经稳定并发布 `1.0.0` 版本后，标准的递增规则才会正式生效。

除了上述三种类型外，`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore` 等类型的提交不会触发版本号递增。但这并不意味着这些提交会被忽略——它们仍然会被记录在 CHANGELOG 中（只是不显示在版本号变化的记录里），方便团队了解项目的完整变更历史。

---

## 四、Semantic Release 的工作原理与配置

### 4.1 工作原理概述

[semantic-release](https://github.com/semantic-release/semantic-release) 是一个完全自动化的版本管理和包发布工具。它的工作流程分为几个阶段，每个阶段由对应的插件负责执行：

**分析阶段（Analyze commits）**：读取自上次发布以来的所有提交记录，使用 commit-analyzer 插件解析每个提交的类型和是否包含破坏性变更，然后根据语义化版本规则计算出下一个版本号。

**生成阶段（Generate notes）**：使用 release-notes-generator 插件将提交信息转换为结构化的发布说明。通常会按照提交类型分组展示，让读者一目了然地了解本次版本包含哪些新功能、修复了哪些问题。

**准备阶段（Prepare）**：执行发布前的准备工作，包括更新 CHANGELOG 文件、修改 package.json 中的版本号、构建项目等。这个阶段可能涉及多个插件的协作。

**发布阶段（Publish）**：将包发布到 npm registry、创建 GitHub Release、推送 Git Tag 等。这是整个流程的最后一步，也是对外可见的一步。

**完成阶段（Success）**：发布成功后的收尾工作，比如发送通知、更新部署状态等。

### 4.2 安装与基础配置

安装 Semantic Release 及其核心插件：

```bash
npm install --save-dev semantic-release \
  @semantic-release/commit-analyzer \
  @semantic-release/release-notes-generator \
  @semantic-release/changelog \
  @semantic-release/npm \
  @semantic-release/github \
  @semantic-release/git
```

创建 `.releaserc.json` 配置文件：

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      {
        "changelogFile": "CHANGELOG.md"
      }
    ],
    [
      "@semantic-release/npm",
      {
        "npmPublish": true
      }
    ],
    "@semantic-release/github",
    [
      "@semantic-release/git",
      {
        "assets": [
          "CHANGELOG.md",
          "package.json",
          "package-lock.json"
        ],
        "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
      }
    ]
  ]
}
```

配置中的每个插件都承担着明确的职责。`commit-analyzer` 负责分析提交信息并计算版本号。`release-notes-generator` 生成发布说明文本。`changelog` 将发布说明追加到 CHANGELOG.md 文件。`npm` 修改 package.json 中的版本号并发布到 npm。`github` 在 GitHub 上创建带有发布说明的 Release。`git` 将变更文件提交回仓库并创建 Git Tag。

特别注意 `@semantic-release/git` 插件的 `message` 配置中包含了 `[skip ci]` 标记。这是为了避免 Semantic Release 推送的版本更新提交再次触发 CI 工作流，从而形成无限循环。这是一个非常重要的细节，遗漏它会导致工作流反复触发直到失败。

---

## 五、CHANGELOG 自动生成的进阶技巧

### 5.1 自定义中文 CHANGELOG 格式

默认情况下，Semantic Release 生成的 CHANGELOG 使用英文标题。对于中文技术团队，我们可以自定义各类提交在 CHANGELOG 中的展示标题：

```json
{
  "plugins": [
    "@semantic-release/commit-analyzer",
    [
      "@semantic-release/release-notes-generator",
      {
        "preset": "conventionalcommits",
        "presetConfig": {
          "types": [
            { "type": "feat", "section": "✨ 新功能" },
            { "type": "fix", "section": "🐛 Bug 修复" },
            { "type": "perf", "section": "⚡ 性能优化" },
            { "type": "refactor", "section": "♻️ 代码重构" },
            { "type": "docs", "section": "📝 文档变更" },
            { "type": "test", "section": "✅ 测试" },
            { "type": "build", "section": "📦 构建系统" },
            { "type": "ci", "section": "🔧 CI/CD 配置" },
            { "type": "chore", "section": "🔨 日常维护" }
          ]
        }
      }
    ]
  ]
}
```

使用此配置后，生成的 CHANGELOG 将具有清晰的中文分类，配合 emoji 图标更加直观易读。

### 5.2 为已有项目生成历史 CHANGELOG

如果你的项目已经在使用 Conventional Commits 但还没有 CHANGELOG 文件，可以使用 `conventional-changelog-cli` 工具一次性生成完整的变更日志：

```bash
npm install --save-dev conventional-changelog conventional-changelog-cli
npx conventional-changelog -p conventionalcommits -i CHANGELOG.md -s -r 0
```

参数 `-r 0` 表示从第一个提交开始处理，`-s` 表示追加到已有文件而非覆盖。这在将现有项目迁移到自动化发布流程时非常有用。

---

## 六、GitHub Actions 集成实战

### 6.1 基础发布工作流

下面是一个完整的 GitHub Actions 发布工作流配置：

```yaml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  test:
    name: Run Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'
          cache: 'npm'
      - run: npm ci
      - run: npm test

  release:
    name: Release
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'
          cache: 'npm'

      - run: npm ci

      - name: Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npx semantic-release
```

几个关键的配置点需要特别说明：`fetch-depth: 0` 是必须的，因为 Semantic Release 需要完整的 Git 提交历史来分析提交信息，如果只克隆最近一次提交（默认行为），它将无法正确计算版本号。`persist-credentials: false` 用于阻止 Git 使用默认的 GITHUB_TOKEN 凭据，这在需要推送 Tag 到受保护分支时尤为重要。`needs: test` 确保只有测试通过后才会执行发布，避免发布未经测试的代码。

### 6.2 多分支发布策略

在实际项目中，我们往往需要同时维护多个版本分支。Semantic Release 支持灵活的多分支配置：

```json
{
  "branches": [
    "main",
    {
      "name": "next",
      "prerelease": "beta"
    },
    {
      "name": "next-major",
      "prerelease": "alpha"
    }
  ]
}
```

这种配置适用于以下场景：`main` 分支始终发布稳定版本，开发者在 `next` 分支上开发下一个次要版本并发布 beta 预览版供早期用户试用，在 `next-major` 分支上进行大版本重构并发布 alpha 版本。通过预发布版本，团队可以在正式发布前收集用户反馈，降低上线风险。

---

## 七、Laravel Composer 包的自动发布

### 7.1 项目结构准备

一个标准的 Laravel Composer 包项目除了 PHP 代码外，还需要包含 Node.js 工具链相关的配置文件。典型的项目结构如下：

```
laravel-awesome-package/
├── src/                          # PHP 源代码
│   ├── AwesomeServiceProvider.php
│   ├── AwesomeFacade.php
│   └── Awesome.php
├── config/                       # 包配置文件
│   └── awesome.php
├── tests/                        # 测试代码
│   └── AwesomeTest.php
├── composer.json                 # Composer 包定义
├── package.json                  # Node.js 依赖（Semantic Release 等工具）
├── .releaserc.json               # Semantic Release 配置
├── commitlint.config.js          # Commitlint 配置
├── .husky/                       # Git Hooks
│   └── commit-msg
└── .github/
    └── workflows/
        └── release.yml           # GitHub Actions 工作流
```

### 7.2 版本号同步策略

对于 Composer 包，有一个关键问题需要解决：Semantic Release 默认只会更新 `package.json` 中的版本号，但 Composer 包的版本信息存储在 `composer.json` 中。我们需要在发布流程中同步更新 `composer.json` 的版本号。

解决方案是使用 `@semantic-release/exec` 插件，在准备阶段执行 shell 命令来更新 `composer.json`：

```bash
npm install --save-dev @semantic-release/exec
```

在 `.releaserc.json` 中添加 exec 插件配置：

```json
{
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      { "changelogFile": "CHANGELOG.md" }
    ],
    [
      "@semantic-release/npm",
      { "npmPublish": false }
    ],
    [
      "@semantic-release/exec",
      {
        "prepareCmd": "sed -i 's/\"version\": \".*\"/\"version\": \"${nextRelease.version}\"/' composer.json"
      }
    ],
    "@semantic-release/github",
    [
      "@semantic-release/git",
      {
        "assets": ["CHANGELOG.md", "package.json", "composer.json"],
        "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
      }
    ]
  ]
}
```

这里的 `npmPublish: false` 表示不发布到 npm registry（因为这是一个 Composer 包而非 npm 包）。`prepareCmd` 中的 sed 命令会将 `composer.json` 中的版本号替换为 Semantic Release 计算出的新版本号。

### 7.3 Packagist 自动更新

当新的 Git Tag 被推送到 GitHub 后，如果项目已经在 [Packagist](https://packagist.org/) 上注册并且配置了 webhook，Packagist 会自动拉取新版本。如果没有自动更新，可以在项目设置中检查 webhook 配置，或者手动触发更新。

### 7.4 完整的 Laravel 包发布工作流

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  test:
    name: Test (PHP ${{ matrix.php }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ['8.1', '8.2', '8.3']
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          coverage: xdebug
      - run: composer install --prefer-dist --no-progress
      - run: vendor/bin/phpunit

  release:
    name: Release
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'
          cache: 'npm'

      - run: npm ci

      - name: Release
        env:
          GITHUB_TOKEN: ${{ secrets.RELEASE_PAT }}
        run: npx semantic-release
```

这个工作流确保了只有在所有 PHP 版本的测试都通过后才会执行发布，提高了发布质量的保障。

---

## 八、npm 包的自动发布

对于同时维护前端 npm 包的 Laravel 项目，npm 发布配置相对更简单直接。关键是正确配置 `package.json` 和 npm token。

在 `package.json` 中，将版本号设置为 `"0.0.0-development"` 作为占位符，Semantic Release 会在发布时自动替换。对于 scoped 包（以 `@scope/` 开头），需要在 `publishConfig` 中设置 `"access": "public"` 以确保公开访问。

npm 访问令牌的创建需要注意安全性。推荐使用 Granular Access Token，为每个包单独配置读写权限，而不是使用全局令牌。创建后将令牌添加到 GitHub 仓库的 Secrets 中，命名为 `NPM_TOKEN`。

npm 还提供了 Provenance 功能，可以验证包的构建来源。在 GitHub Actions 中启用后，npm 仓库页面会显示构建来源的验证信息，增强使用者的信任度。启用方法是在工作流的权限配置中添加 `id-token: write`，同时在 `package.json` 的 `publishConfig` 中设置 `"provenance": true`。这项功能对于开源库来说尤为重要，它向使用者证明了发布的包确实来源于可信的 CI 流水线，而非被篡改的本地构建环境。

对于同时维护 Composer 包和 npm 包的项目，建议统一在同一个工作流中完成两个平台的发布。通过合理编排插件的执行顺序，Semantic Release 可以在一个流程中完成版本号计算、CHANGELOG 生成、两个平台的包发布以及 Git Tag 的创建，真正实现一键发布。这种统一管理的方式不仅简化了运维复杂度，也从根本上保证了两个平台版本号的一致性。

---

## 九、实际效果展示

当我们完成了上述所有配置后，日常的开发和发布流程将变得极其简洁。假设一个开发者正在为 Laravel 短信服务包添加模板管理功能，整个流程如下：

开发者从 `main` 分支创建功能分支 `feat/sms-template`，完成代码编写后使用 `npm run commit` 交互式提交。commitizen 引导他选择 `feat` 类型，填写 scope 为 `sms`，描述为"添加短信模板管理功能"。推送分支并创建 Pull Request 后，GitHub Actions 自动运行测试套件和 commitlint 校验。代码审查通过并合并到 `main` 分支后，发布工作流自动启动。

Semantic Release 首先分析提交历史，发现一个新的 `feat` 类型提交，于是将版本号从 `1.2.3` 递增到 `1.3.0`。接着生成包含新功能描述的发布说明，并追加到 CHANGELOG.md 文件中。随后更新 `package.json` 和 `composer.json` 中的版本号，将 npm 包发布到 registry，最后在 GitHub 上创建一个标签为 `v1.3.0` 的 Release，附带完整的变更说明。整个过程从合并代码到发布完成，通常只需要两到三分钟，全程无人工干预。

生成的 GitHub Release 页面会清晰地列出本次版本包含的所有变更，按照"✨ 新功能"、"🐛 Bug 修复"等分类展示，方便使用者快速了解升级内容。CHANGELOG.md 文件也会同步更新，成为项目变更历史的权威记录。通过 GitHub 的通知机制，关注者可以在第一时间收到新版本发布的提醒。

---

## 十、最佳实践与常见问题

在实践 Conventional Commits + Semantic Release 的过程中，以下几点经验值得分享：

**提交信息的质量是基石**：自动化发布的效果完全依赖于提交信息的质量。如果团队成员不遵守规范，工具链就无法正确推算版本号。建议在 CI 流程中加入 commitlint 校验，不通过的 PR 不允许合并。同时在项目仓库中维护一份清晰的 CONTRIBUTING.md 文档，详细说明提交规范的要求和示例，降低新人的学习门槛。

**不要手动修改版本号**：一旦启用 Semantic Release，版本号就应该完全由工具管理。手动修改会导致工具无法正确计算下一个版本号，甚至触发重复发布。

**使用 `[skip ci]` 避免循环触发**：这是新手最容易踩的坑。如果没有在 release commit 中添加 `[skip ci]` 标记，CI 会再次触发 Semantic Release，形成无限循环直到失败。

**注意 Token 权限**：默认的 `GITHUB_TOKEN` 无法推送到受保护的分支，也无法触发其他 workflow。如果遇到权限问题，考虑使用 Personal Access Token 替代。Token 的创建应遵循最小权限原则，只授予必要的权限范围，并设置合理的过期时间。定期轮换 Token 也是保障安全的重要措施。

**先测试再发布**：始终确保 release job 依赖于 test job。发布未经测试的代码是极其危险的行为。建议在工作流中设置 `needs` 依赖关系，只有当所有测试阶段都通过后才执行发布任务。对于关键项目，还可以在发布前增加人工审批环节，通过 GitHub Environments 的 Protection Rules 来实现。

**分阶段推进**：如果团队从未使用过 Conventional Commits，不要急于一步到位。可以先从强制规范提交信息格式开始，引入 commitlint 和 husky 让团队养成习惯。这个阶段可能需要一到两周的磨合期，期间会有一些不习惯的抱怨，但一旦规范成为肌肉记忆，后续的自动化发布就水到渠成了。等团队完全适应后再引入 Semantic Release 实现全自动发布，这样过渡会更加平滑自然。

**Monorepo 场景的特殊考虑**：对于使用 Monorepo 管理多个包的 Laravel 项目，可以考虑使用 `multi-semantic-release` 或 `semantic-release-monorepo` 等社区方案。这些工具可以在同一个仓库中独立管理多个包的版本号和发布流程，当某个子包的代码发生变更时，只会触发该子包的版本递增和发布，不会影响其他子包。

---

## 十一、总结

通过本文的详细介绍，我们了解了如何将 Conventional Commits 规范与 Semantic Release 工具链结合，为 Laravel 项目搭建一套完整的自动化发布流水线。从提交规范的制定到工具链的配置，从 GitHub Actions 工作流的编排到 Composer 包和 npm 包的双平台发布，每一个环节都经过了精心设计和充分验证。这套方案的核心价值在于：提交信息即版本号依据，完全消除了手动版本管理的不确定性；CHANGELOG 每次发布自动更新，永远与代码保持同步；npm 和 Composer 包的发布零人工干预，大幅减少操作失误的可能性；每个版本都有完整的 Git Tag、GitHub Release 和变更日志记录，便于追溯和排查问题。

自动化发布不是一个一蹴而就的过程，它需要团队在规范意识和工具使用上逐步磨合。但从长远来看，前期投入的每一分努力都会在后续的开发迭代中带来成倍的回报。希望本文的实践方案能够帮助你的 Laravel 项目建立起专业级的发布流水线，让团队从繁琐的发布操作中解放出来，专注于更有价值的创造性工作。

---

**参考资源：**

- [Conventional Commits 官方规范](https://www.conventionalcommits.org/)
- [Semantic Release 官方文档](https://semantic-release.gitbook.io/)
- [commitlint 官方文档](https://commitlint.js.org/)
- [conventional-changelog 工具集](https://github.com/conventional-changelog/conventional-changelog)
- [Laravel Package Development 文档](https://laravel.com/docs/packages)
- [npm Publishing Guide](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)

---

## 相关阅读

- [GitHub Actions 矩阵策略实战：多 PHP 版本多数据库并行测试与条件发布](/categories/CI-CD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/)
- [Ansible 实战：Laravel 应用自动化部署与配置管理踩坑记录](/categories/CI-CD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [Dependabot vs Renovate 实战：依赖自动更新策略——Laravel/Node.js 自动 PR 与安全补丁工作流](/categories/CI-CD/Dependabot-vs-Renovate-实战-依赖自动更新策略-Laravel-Node-js自动PR与安全补丁工作流/)
