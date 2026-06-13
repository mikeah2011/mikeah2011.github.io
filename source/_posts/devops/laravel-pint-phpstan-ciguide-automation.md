---
title: Laravel-Pint-PHPStan-CI集成实战-代码质量门禁自动化与渐进式治理踩坑记录
date: 2026-05-05 07:20:44
updated: 2026-05-05 07:23:51
categories:
  - devops
  - cicd
tags: [CI/CD, Laravel, 代码质量, Pint, PHPStan, 代码规范, GitHub Actions]
keywords: [Laravel, Pint, PHPStan, CI, 集成实战, 代码质量门禁自动化与渐进式治理踩坑记录, DevOps]
description: Laravel 项目 Pint + PHPStan + GitHub Actions CI 代码质量门禁自动化实战指南，涵盖流水线设计、baseline 管理、渐进式 level 提升策略、增量检查优化、Pint 与 PHP-CS-Fixer 对比、PHPStan 各级别详解及 30+ 仓库团队协作踩坑记录。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - /images/content/devops-002-content-1.jpg
  - /images/content/devops-002-content-2.jpg



---

# Laravel Pint + PHPStan CI 集成实战：代码质量门禁自动化与渐进式治理踩坑记录

## 前言：为什么需要代码质量门禁？

在 KKday B2C Backend Team，我们有 30+ 个 Laravel 仓库。本地跑 Pint 和 PHPStan 只是第一步——真正的痛点是：**开发者不跑怎么办？** 或者更准确地说，开发者本地跑了一遍 PHPStan level 6，发现 2000+ 个 error，直接关掉了。

代码质量门禁的核心逻辑很简单：

```
PR 提交 → CI 自动检查 → 不通过则合并按钮灰掉
```

但真正落地时，你会遇到一系列实际问题：

- PHPStan level 从 0 到 8，怎么选？level 选高了存量代码跑不过，选低了形同虚设
- 30+ 仓库的 baseline 文件谁来维护？每次合并都冲突怎么办？
- CI 跑一次 PHPStan 要 8 分钟，开发者等不起
- Pint 自动修复和 PHPStan 检查的顺序怎么安排？先修格式还是先查类型？

这篇文章记录我们如何在 30+ 仓库中从零构建 Pint + PHPStan CI 门禁的完整过程。

<!-- more -->

---

## 一、架构总览：两道门禁的分工

![代码质量门禁架构](/images/content/devops-002-content-1.jpg)

我们的 CI 质量门禁分两层，职责明确：

```
┌──────────────────────────────────────────────────────┐
│                   GitHub PR 触发                       │
│                        │                              │
│                        ▼                              │
│  ┌─────────────────────────────────────┐              │
│  │  第一道门禁：Laravel Pint            │              │
│  │  ─ 格式检查（--test 模式）           │              │
│  │  ─ 发现格式问题 → 直接 fail          │              │
│  │  ─ 耗时：~15s                        │              │
│  └──────────────────┬──────────────────┘              │
│                     │ 通过                            │
│                     ▼                                 │
│  ┌─────────────────────────────────────┐              │
│  │  第二道门禁：PHPStan                  │              │
│  │  ─ 静态类型分析                       │              │
│  │  ─ level 5 + baseline                │              │
│  │  ─ 耗时：~2-4min（增量模式 ~30s）    │              │
│  └──────────────────┬──────────────────┘              │
│                     │ 通过                            │
│                     ▼                                 │
│  ┌─────────────────────────────────────┐              │
│  │  第三步：PHPUnit 测试                 │              │
│  │  ─ 单元测试 + Feature 测试            │              │
│  │  ─ 耗时：~3-5min                     │              │
│  └─────────────────────────────────────┘              │
└──────────────────────────────────────────────────────┘
```

**为什么 Pint 放在第一道？** 两个原因：
1. Pint 跑得快（15 秒），能快速打回格式不合格的 PR
2. Pint 格式化可能改变代码结构（比如换行），如果先跑 PHPStan 再跑 Pint，行号会对不上

### 工具选型对比：Pint vs PHP-CS-Fixer

在选择代码格式化工具时，Laravel 生态主要有两个选择。以下是我们评估后的对比：

| 对比维度 | Laravel Pint | PHP-CS-Fixer |
|---------|-------------|-------------|
| **定位** | Laravel 专属、开箱即用 | 通用 PHP 格式化框架 |
| **配置复杂度** | 零配置或极简 `pint.json` | 需要 `.php-cs-fixer.php`，规则组合复杂 |
| **Laravel 规则** | 内置 `laravel` preset，贴合社区习惯 | 需手动配置 50+ 规则模拟 |
| **执行速度** | ~15s（30+ 仓库实测） | ~30-45s（同等规模） |
| **CI 集成** | 原生 `--test --format=github` | 需要 `--format=json` + 自定义解析 |
| **可扩展性** | 底层基于 PHP-CS-Fixer，可继承 | 插件生态丰富、规则最全面 |
| **社区维护** | Laravel 官方维护，更新紧跟 Laravel 版本 | 社区驱动，历史更悠久 |
| **适合场景** | 纯 Laravel 项目首选 | 混合框架、需高度自定义规则 |

**结论**：如果你的项目是纯 Laravel，**强烈推荐 Pint**——配置简单、速度快、与 Laravel 生态无缝集成。如果需要跨框架统一规范或高度自定义规则，PHP-CS-Fixer 是更灵活的选择。

### CI 平台对比：GitHub Actions vs GitLab CI vs Jenkins

| 对比维度 | GitHub Actions | GitLab CI | Jenkins |
|---------|---------------|-----------|---------|
| **配置方式** | YAML（`.github/workflows/`） | YAML（`.gitlab-ci.yml`） | Groovy（Jenkinsfile） |
| **PHP 环境搭建** | `shivammathur/setup-php@v2` 一行搞定 | 需自建或使用 Docker image | 需预装或 agent 配置 |
| **缓存机制** | `actions/cache@v4` 原生支持 | 内置 `cache:` 关键字 | 插件支持，配置复杂 |
| **PR 集成** | 原生 annotation，直接在代码行标红 | MR 页面 inline 注释 | 需额外插件 |
| **并行 Job** | 原生 `needs` 依赖链 | `stage` + `needs` | `parallel` + upstream |
| **Runner 成本** | 免费 2000 min/月（公开仓库无限） | 免费 400 min/月 | 自托管，运维成本高 |
| **生态** | Marketplace 10万+ Actions | CI/CD Templates | 插件 1800+ |

---

## 二、Laravel Pint CI 配置

### 2.1 pint.json 配置（项目根目录）

```json
{
    "preset": "laravel",
    "rules": {
        "declare_strict_types": false,
        "ordered_imports": {
            "sort_algorithm": "alpha"
        },
        "no_unused_imports": true,
        "single_quote": true,
        "trailing_comma_in_multiline": true,
        "concat_space": {
            "spacing": "one"
        }
    },
    "exclude": [
        "storage",
        "bootstrap/cache",
        "vendor"
    ]
}
```

**踩坑 #1：`declare_str_types` 的陷阱**

一开始我们开了 `declare_str_types`，结果 Pint 会给每个文件自动加上 `declare(strict_types=1)`。听起来很好，但 Laravel 项目的很多文件（特别是 Service Provider、配置文件）不是严格类型设计的，加了这行直接导致运行时报错。**建议在 CI 阶段关闭这个规则。**

### 2.2 Pint CI 工作流

```yaml
# .github/workflows/code-quality.yml
name: Code Quality Gate

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  pint:
    name: "🎨 Pint - Code Style"
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.1"
          tools: composer:v2
          coverage: none

      - name: Install dependencies
        run: composer install --no-progress --no-interaction --prefer-dist

      - name: Run Pint (check only)
        run: vendor/bin/pint --test --format=github
```

**关键参数说明：**

- `--test`：只检查不修复，CI 里绝不能用自动修复模式（否则会偷偷改代码并 pass）
- `--format=github`：输出 GitHub Actions 兼容的 annotation 格式，PR 的 Files Changed 页面会直接标红出错行

**踩坑 #2：`--test` 和 `--dirty` 的区别**

`--test` 检查所有文件，`--dirty` 只检查 git 暂存区有变更的文件。CI 里必须用 `--test`，因为 PR 可能包含 merge commit 带入的其他文件变更。`--dirty` 只适合本地 pre-commit hook。

---

## 三、PHPStan CI 配置

### 3.1 phpstan.neon 配置

```neon
# phpstan.neon
includes:
    - phpstan-baseline.neon

parameters:
    level: 5
    paths:
        - app
        - config
        - database
        - routes
        - tests
    excludePaths:
        - vendor
        - storage
        - bootstrap/cache
    ignoreErrors:
        # Laravel magic method 常见误报
        - '#Call to an undefined method Illuminate\\Database\\Eloquent\\Builder::[a-zA-Z]+#'
        - '#Call to an undefined method Illuminate\\Database\\Query\\Builder::[a-zA-Z]+#'
    reportUnmatchedIgnoredErrors: false
    checkMissingIterableValueType: false
    checkGenericClassInNonGenericObjectType: false
```

**level 选择策略（30+ 仓库的经验）：**

| Level | 覆盖范围 | 典型检查项 | 适合阶段 |
|-------|---------|-----------|---------|
| 0 | 语法检查 | 基础语法错误 | 存量代码破冰 |
| 1 | 基础检查 | 未知类、未知函数、错误参数数量 | 存量代码破冰 |
| 2 | 方法检查 | 调用不存在的方法、访问不存在的属性 | 存量代码破冰 |
| 3 | 返回值检查 | 方法返回值类型推断 | 初步治理 |
| 4 | 参数类型检查 | 参数类型不匹配 | 初步治理 |
| **5** | **严格类型检查** | **赋值类型、属性类型、`mixed` 传递** | **CI 门禁默认** |
| 6 | 更严格参数检查 | 参数传递严格匹配 | 逐步提升 |
| 7 | 返回值严格 | 不允许 `mixed` 作为返回值 | 逐步提升 |
| 8 | 最严格 | 不允许 `mixed` 类型、完全类型安全 | 新项目 |

**我们选择 level 5 作为起步的原因：** level 5 能覆盖大部分真实 bug（类型不匹配、null 安全、返回值缺失），同时对存量代码的容忍度足够高。level 6+ 会产生大量 `mixed` 类型相关的 error，需要逐步清理。

### 3.2 Baseline 管理：存量代码的救赎

Baseline 是 PHPStan 的杀手级功能——它允许你把当前所有 error 快照下来，之后只报**新增**的 error。

```bash
# 首次生成 baseline
vendor/bin/phpstan analyse --generate-baseline

# 这会生成 phpstan-baseline.neon 文件
```

生成的 baseline 文件长这样：

```neon
# phpstan-baseline.neon
parameters:
    ignoreErrors:
        -
            identifier: method.notFound
            message: "#^Call to an undefined method App\\\\Models\\\\Order\\:\\:getTotalAttribute\\(\\)#"
            count: 1
            path: app/Models/Order.php
        -
            identifier: parameter.notPassed
            message: "#^Method App\\\\Services\\\\PaymentService\\:\\:charge\\(\\) expects float, int given\\.$#"
            count: 3
            path: app/Services/PaymentService.php
        # ... 可能有几百条
```

**踩坑 #3：baseline 文件的合并冲突**

在 30+ 仓库的团队协作中，baseline 文件是**冲突重灾区**。两个人同时修了代码、各自重新生成 baseline，合并时必然冲突。

**我们的解决方案：**

```yaml
# 在 CI 中加入 baseline 自动检查
- name: Verify baseline is up-to-date
  run: |
    vendor/bin/phpstan analyse --generate-baseline phpstan-baseline-new.neon
    if ! diff -q phpstan-baseline.neon phpstan-baseline-new.neon > /dev/null 2>&1; then
      echo "::error::PHPStan baseline is outdated. Run: vendor/bin/phpstan analyse --generate-baseline"
      exit 1
    fi
```

这个步骤会在 CI 中检查 baseline 是否和代码同步。如果有人修了代码但没更新 baseline，CI 会报错并提示更新命令。

### 3.3 PHPStan CI 工作流

```yaml
# 接续 code-quality.yml
  phpstan:
    name: "🔍 PHPStan - Static Analysis"
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: pint  # Pint 通过后才跑 PHPStan

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: "8.1"
          tools: composer:v2
          coverage: none

      - name: Get Composer Cache Directory
        id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

      - name: Cache Composer Dependencies
        uses: actions/cache@v4
        with:
          path: ${{ steps.composer-cache.outputs.dir }}
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Install dependencies
        run: composer install --no-progress --no-interaction --prefer-dist

      - name: Cache PHPStan result
        uses: actions/cache@v4
        with:
          path: tmp/phpstan
          key: phpstan-${{ github.sha }}
          restore-keys: phpstan-

      - name: Run PHPStan
        run: vendor/bin/phpstan analyse --memory-limit=2G --error-format=github
```

**踩坑 #4：PHPStan 结果缓存加速**

PHPStan 支持结果缓存（默认在 `tmp/phpstan` 目录）。通过缓存这个目录，未变更的文件不会重新分析。在我们的项目中，缓存命中时分析时间从 **4 分 20 秒降到 35 秒**，提升 87%。

缓存 key 用 `github.sha` 是为了让每次 commit 都能保存新的缓存，而 `restore-keys` 回退到最近一次缓存。

---

## 四、增量检查：让 PHPStan 飞起来

全量检查在 CI 中是必要的，但开发者本地提交时全量跑太慢了。我们用 `--dirty` 模式做 pre-commit hook：

```bash
#!/bin/bash
# .husky/pre-commit

echo "🎨 Running Pint..."
vendor/bin/pint --dirty

echo "🔍 Running PHPStan (incremental)..."
CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR -- '*.php' | tr '\n' ' ')

if [ -n "$CHANGED_FILES" ]; then
    vendor/bin/phpstan analyse \
        --configuration=phpstan.neon \
        --memory-limit=512M \
        --error-format=table \
        $CHANGED_FILES
fi
```

**踩坑 #5：增量检查的 false negative**

增量检查只分析变更文件，如果 A 文件修改了类型签名，但 B 文件依赖 A 的旧签名，增量检查不会报错。这是增量检查的本质缺陷。

**解决方案：** CI 做全量检查保底，本地增量检查只做快速反馈。两层防护互补。

---

## 五、渐进式 Level 提升策略

![渐进式代码质量治理](/images/content/devops-002-content-2.jpg)

从 level 5 到 level 8 不是一步到位的，我们的策略是**阶梯式推进**：

### 5.1 建立 error 消化队列

```bash
# 统计当前 level 5 的 baseline 中各类 error 的分布
vendor/bin/phpstan analyse --error-format=json 2>/dev/null | \
    jq -r '.messages[] | .identifier' | sort | uniq -c | sort -rn
```

输出示例：

```
    127  parameter.notPassed
     89  return.notType
     56  property.notAssigned
     34  method.notFound
     23  assign.propertyType
      8  deadCode.unreachable
```

### 5.2 每两周提升一个子项

不是直接从 level 5 跳到 level 6，而是**逐个清理 error 类型**：

```neon
# phpstan.neon - 逐步收紧
parameters:
    level: 5
    # 第1-2周：清理 parameter.notPassed
    # 第3-4周：清理 return.notType
    # 第5-6周：清理 property.notAssigned
    # ...全部清理完后再提升 level
```

### 5.3 新代码严格、老代码宽松

我们为新建的 Service 类单独配置更严格的检查：

```neon
# phpstan.neon
parameters:
    level: 5

    # 对新代码使用更高 level
    paths:
        - app/Services/OrderService.php
        - app/Services/PaymentService.php

rules:
    - App\PHPStan\StrictReturnTypeRule
```

**踩坑 #6：30+ 仓库的 level 不一致**

不同仓库的历史债务不同，强行统一 level 会导致部分仓库无法通过 CI。我们最终的策略是：

- **新建仓库**：level 8，零容忍
- **活跃开发仓库**：level 5，每季度提升
- **维护模式仓库**：level 3，仅做基础检查

在每个仓库的 README 中标注当前 level 和提升计划：

```markdown
## 代码质量
- PHPStan Level: 5
- 下次提升: 2026-Q3 → level 6
- Baseline errors: 127 (目标: 逐月消化)
```

---

## 六、Pint + PHPStan 联合流水线完整配置

将两道门禁合并为一个完整的工作流：

```yaml
# .github/workflows/code-quality.yml
name: Code Quality Gate

on:
  pull_request:
    branches: [main, develop, release/*]
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  pint:
    name: "🎨 Code Style"
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: "8.1"
          tools: composer:v2
          coverage: none
      - run: composer install --no-progress --no-interaction --prefer-dist
      - run: vendor/bin/pint --test --format=github

  phpstan:
    name: "🔍 Static Analysis"
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: pint
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: "8.1"
          tools: composer:v2
          coverage: none
      - id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT
      - uses: actions/cache@v4
        with:
          path: ${{ steps.composer-cache.outputs.dir }}
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-
      - run: composer install --no-progress --no-interaction --prefer-dist
      - uses: actions/cache@v4
        with:
          path: tmp/phpstan
          key: phpstan-${{ github.sha }}
          restore-keys: phpstan-
      - run: vendor/bin/phpstan analyse --memory-limit=2G --error-format=github

  tests:
    name: "🧪 Tests"
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: phpstan
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: "8.1"
          tools: composer:v2
          coverage: none
      - id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT
      - uses: actions/cache@v4
        with:
          path: ${{ steps.composer-cache.outputs.dir }}
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-
      - run: composer install --no-progress --no-interaction --prefer-dist
      - run: vendor/bin/phpunit --configuration=phpunit.jenkins.xml
```

**关键设计决策：**

1. **`concurrency` + `cancel-in-progress: true`**：同一个 PR 多次 push 时，只跑最新的一次，节省 CI 资源
2. **`needs` 依赖链**：Pint → PHPStan → Tests，层层递进，前一步失败后一步不跑
3. **Composer cache**：三个 job 共用相同的缓存策略，避免重复下载

---

## 七、踩坑汇总与解决方案

| # | 踩坑场景 | 根因 | 解决方案 |
|---|---------|------|---------|
| 1 | Pint `declare_strict_types` 导致运行时报错 | 存量代码不兼容严格类型 | CI 阶段关闭该规则 |
| 2 | `--test` vs `--dirty` 选错 | 本地和 CI 场景不同 | CI 用 `--test`，本地 hook 用 `--dirty` |
| 3 | baseline 合并冲突 | 多人同时修改代码 | CI 中自动检查 baseline 同步状态 |
| 4 | PHPStan CI 耗时过长 | 全量分析无缓存 | 启用结果缓存，耗时降低 87% |
| 5 | 增量检查漏报 | 只看变更文件 | 本地增量 + CI 全量双保险 |
| 6 | 30+ 仓库 level 不一致 | 历史债务差异 | 按仓库活跃度分级管理 |

---

## 七-B、真实场景踩坑与最佳实践

### 场景一：Eloquent 模型 Magic Method 导致 PHPStan 误报

Laravel Eloquent 模型大量使用 `__call` 和 `__get` magic method，PHPStan 无法静态分析：

```php
// PHPStan 会报错：Call to undefined method App\Models\User::whereEmail()
User::whereEmail('test@example.com')->first();

// 解决方案：使用 phpstan-laravel 扩展
// composer require --dev nunomaduro/larastan
```

安装 Larastan 后在 `phpstan.neon` 中配置：

```neon
includes:
    - vendor/nunomaduro/larastan/extension.neon

parameters:
    level: 5
```

### 场景二：PHPStan 内存溢出（OOM）

大型 Laravel 项目全量分析常遇到内存不足：

```bash
# 症状
vendor/bin/phpstan analyse
# PHP Fatal error: Allowed memory size of 536870912 bytes exhausted

# 解决方案一：增加内存限制
vendor/bin/phpstan analyse --memory-limit=4G

# 解决方案二：排除大型第三方包
# phpstan.neon
parameters:
    excludePaths:
        - vendor/*
        - storage/*
        - app/Http/Resources/Legacy/*  # 排除遗留代码目录
```

### 场景三：Pint 规则冲突导致格式反复变化

团队成员本地 Pint 版本不一致时，可能出现格式反复变化：

```bash
# 症状：同一文件每次 pint 都产生 diff

# 解决方案：锁定 Pint 版本
composer require --dev laravel/pint:^1.16

# 在 CI 中验证版本一致性
- name: Verify Pint version
  run: |
    EXPECTED="1.16.0"
    ACTUAL=$(vendor/bin/pint --version | grep -oP '\d+\.\d+\.\d+')
    if [ "$ACTUAL" != "$EXPECTED" ]; then
      echo "::error::Pint version mismatch: expected $EXPECTED, got $ACTUAL"
      exit 1
    fi
```

### 场景四：Git Hook 与 CI 检查不一致

本地 pre-commit hook 用 `--dirty` 只检查暂存文件，CI 用 `--test` 检查全量。开发者本地通过但 CI 失败：

```bash
# 解决方案：本地也用 --test，但只检查 PR 变更的文件范围
# .husky/pre-commit
CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR -- '*.php')
if [ -n "$CHANGED_FILES" ]; then
    vendor/bin/pint --test $CHANGED_FILES
    vendor/bin/phpstan analyse --memory-limit=1G $CHANGED_FILES
fi
```

---

## 八、效果数据

在 30+ 仓库推行 CI 门禁 3 个月后的数据：

```
┌───────────────────────────┬───────────┬───────────┬──────────┐
│ 指标                      │ 推行前    │ 推行后    │ 变化     │
├───────────────────────────┼───────────┼───────────┼──────────┤
│ PR 因格式问题被打回       │ 35%       │ 2%        │ ↓ 94%    │
│ 类型相关 Bug 逃逸到生产   │ 12次/月   │ 2次/月    │ ↓ 83%    │
│ Code Review 格式讨论耗时  │ 20%       │ 3%        │ ↓ 85%    │
│ PHPStan baseline errors   │ 847       │ 127       │ ↓ 85%    │
│ CI 门禁平均耗时           │ -         │ 3min 20s  │ -        │
└───────────────────────────┴───────────┴───────────┴──────────┘
```

---

## 总结

Pint + PHPStan CI 门禁不是「配置一下就完事」的工程，而是一个**渐进式治理的过程**。关键经验：

1. **先 Pint 后 PHPStan**：格式优先，避免行号漂移
2. **baseline 是过渡工具**：最终目标是消化完所有 baseline error
3. **level 不追求一步到位**：30+ 仓库的节奏是「每个仓库稳步提升」
4. **缓存是性能命脉**：PHPStan 结果缓存和 Composer 依赖缓存缺一不可
5. **本地增量 + CI 全量**：两层防护互补，兼顾速度和准确性

代码质量门禁的终极目标不是「卡 PR」，而是让团队养成「写对代码」的习惯。当 PHPStan level 8 成为新仓库的默认配置时，你就知道这件事做对了。

---

## 相关阅读

- [Laravel Pint + Rector + PHPStan 三剑客联动：代码风格重构类型安全一站式质量治理流水线](/post/laravel-pint-rector-phpstan/) — 在 Pint 基础上引入 Rector 自动重构，构建完整的代码质量自动化流水线
- [PHPStan Level 8 完全指南：从入门到类型安全](/post/phpstan-level-8-guide/) — 深入理解 PHPStan 各级别检查规则，掌握从 level 5 到 level 8 的渐进式迁移策略
- [PHP-CS-Fixer 与 Pint 自动化集成实战](/post/php-cs-fixer-pint-automation/) — 对比 PHP-CS-Fixer 和 Pint 的配置方式，适用于需要跨框架统一代码规范的团队
