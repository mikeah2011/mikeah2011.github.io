---
title: "GitHub Actions Reusable Workflows 实战：跨仓库复用 CI/CD 组件、版本化发布与参数化模板"
keywords: [GitHub Actions Reusable Workflows, CI, CD, 跨仓库复用, 组件, 版本化发布与参数化模板, DevOps]
date: 2026-06-10 08:58:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
  - GitHub Actions
  - Reusable Workflows
  - CI/CD
  - DevOps
  - 工程化
description: "深入讲解 GitHub Actions Reusable Workflows 的实战用法：从基础调用到跨仓库复用、版本化发布、参数化模板设计，以及团队级流水线工程化治理的最佳实践。"
---


## 为什么需要 Reusable Workflows

在团队协作中，CI/CD 流水线的维护往往面临一个尴尬局面：每个仓库都有一份 `.github/workflows/ci.yml`，内容大同小异。一旦需要修改构建流程（比如升级 Node 版本、添加安全扫描），就得逐个仓库修改。10 个仓库还好，50 个仓库就是灾难。

GitHub Actions 在 2021 年底推出了 **Reusable Workflows（可复用工作流）**，允许你将工作流定义为可调用的组件，其他仓库通过 `uses` 引用即可。这解决了三个核心问题：

1. **重复代码**：同一套构建/部署逻辑写 N 遍
2. **一致性**：各仓库的 CI 行为不统一，排查问题困难
3. **维护成本**：改一处要改 N 处，容易遗漏

## 基础概念

### Reusable Workflow vs Composite Action

很多人会混淆这两个概念。简单区分：

| 特性 | Reusable Workflow | Composite Action |
|------|------------------|-----------------|
| 本质 | 完整的工作流文件 | 单个 Action 步骤的组合 |
| 调用方式 | `jobs.xxx.uses` | `steps.uses` |
| 能否包含 jobs | 能 | 不能 |
| 能否触发其他工作流 | 能 | 不能 |
| secrets 继承 | 支持 | 不支持 |

**选择原则**：需要编排多个 job（如 build → test → deploy）用 Reusable Workflow；只是组合几个步骤（如 checkout + build + upload）用 Composite Action。

### 调用语法

```yaml
jobs:
  call-reusable:
    uses: owner/repo/.github/workflows/workflow.yml@ref
    with:
      input-name: value
    secrets:
      secret-name: ${{ secrets.MY_SECRET }}
```

`@ref` 可以是分支名、tag 或 SHA。生产环境建议用 tag（如 `@v1`），开发环境可以用分支名。

## 实战：构建一个可复用的 PHP CI 模板

### 场景设定

团队有 20+ 个 Laravel 项目，每个项目的 CI 流程基本一致：

1. Checkout 代码
2. 安装 PHP 和 Composer 依赖
3. 运行 PHPUnit 测试
4. 运行 PHPStan 静态分析
5. 运行 CS Fixer 代码风格检查
6. 生成测试覆盖率报告

### 步骤一：创建 Reusable Workflow 文件

在**组织的核心仓库**（比如 `your-org/workflows`）中创建 `.github/workflows/php-ci.yml`：

```yaml
# .github/workflows/php-ci.yml
name: PHP CI (Reusable)

on:
  workflow_call:
    inputs:
      php-version:
        description: 'PHP version'
        required: false
        default: '8.3'
        type: string
      composer-flags:
        description: 'Composer install flags'
        required: false
        default: '--no-interaction --prefer-dist'
        type: string
      run-phpstan:
        description: 'Run PHPStan static analysis'
        required: false
        default: true
        type: boolean
      run-cs-fixer:
        description: 'Run CS Fixer'
        required: false
        default: true
        type: boolean
      phpstan-level:
        description: 'PHPStan analysis level'
        required: false
        default: '6'
        type: string
      coverage:
        description: 'Generate coverage report'
        required: false
        default: false
        type: boolean
    secrets:
      composer-auth:
        description: 'Composer auth.json content for private packages'
        required: false

jobs:
  php-ci:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ inputs.php-version }}
          extensions: mbstring, xml, ctype, json, bcmath, pdo, mysql, redis
          coverage: ${{ inputs.coverage && 'xdebug' || 'none' }}

      - name: Get Composer Cache Directory
        id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

      - name: Cache Composer Dependencies
        uses: actions/cache@v4
        with:
          path: ${{ steps.composer-cache.outputs.dir }}
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Configure Composer Auth
        if: secrets.composer-auth != ''
        run: |
          echo '${{ secrets.composer-auth }}' > auth.json
          composer config --global github-oauth.github.com ${{ secrets.GITHUB_TOKEN }}

      - name: Install Dependencies
        run: composer install ${{ inputs.composer-flags }}

      - name: Run Tests
        run: |
          if [ "${{ inputs.coverage }}" = "true" ]; then
            vendor/bin/phpunit --coverage-clover=coverage.xml
          else
            vendor/bin/phpunit
          fi

      - name: Run PHPStan
        if: inputs.run-phpstan
        run: vendor/bin/phpstan analyse --level=${{ inputs.phpstan-level }} --no-progress

      - name: Run CS Fixer
        if: inputs.run-cs-fixer
        run: vendor/bin/php-cs-fixer fix --dry-run --diff --format=github-actions
        continue-on-error: true

      - name: Upload Coverage
        if: inputs.coverage
        uses: codecov/codecov-action@v4
        with:
          files: coverage.xml
          fail_ci_if_error: false
```

### 步骤二：在业务仓库中调用

在业务仓库的 `.github/workflows/ci.yml` 中：

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  php-ci:
    uses: your-org/workflows/.github/workflows/php-ci.yml@v1
    with:
      php-version: '8.3'
      phpstan-level: '8'
      coverage: true
    secrets:
      composer-auth: ${{ secrets.COMPOSER_AUTH }}
```

就这么简单。6 行配置替代了原来 80+ 行的 CI 文件。

### 步骤三：版本化管理

在 `your-org/workflows` 仓库中用 tag 管理版本：

```bash
# 发布 v1.0.0
git tag -a v1.0.0 -m "Initial release: PHP CI workflow"
git push origin v1.0.0

# 发布 v1.1.0（新增功能，向后兼容）
git tag -a v1.1.0 -m "Add Pest test framework support"
git push origin v1.1.0

# 更新 v1 指向最新的 v1.x.x
git tag -fa v1 -m "Update v1 to v1.1.0"
git push origin v1 --force
```

**版本策略**：

- `@v1` — 主版本标签，始终指向最新的 `v1.x.x`，适合大多数团队
- `@v1.0.0` — 精确版本，适合对稳定性要求极高的场景
- `@main` — 最新代码，仅用于开发测试

## 进阶：跨仓库 Secrets 管理

### 问题

Reusable Workflow 运行在**调用者的仓库**上下文中，但默认无法访问被调用仓库的 secrets。GitHub 提供了三种方式传递 secrets：

### 方式一：显式传递（推荐）

```yaml
jobs:
  deploy:
    uses: your-org/workflows/.github/workflows/deploy.yml@v1
    secrets:
      aws-access-key: ${{ secrets.AWS_ACCESS_KEY_ID }}
      aws-secret-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

每个业务仓库需要配置同名的 secrets。适合 secrets 不多的场景。

### 方式二：继承所有 secrets

```yaml
jobs:
  deploy:
    uses: your-org/workflows/.github/workflows/deploy.yml@v1
    secrets: inherit
```

简单粗暴，但安全性较差。业务仓库的所有 secrets 都会传递给 reusable workflow。

### 方式三：组织级 Secrets

在 GitHub Organization Settings → Secrets and variables → Actions 中配置组织级 secrets，所有仓库自动可用。适合团队共享的 credentials（如 Docker Registry、npm Token）。

## 进阶：矩阵策略与条件执行

### 矩阵测试多版本 PHP

在 Reusable Workflow 中使用矩阵：

```yaml
jobs:
  php-ci:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php-version: ${{ fromJSON(inputs.php-versions) }}
      fail-fast: false
    steps:
      # ... 同上
```

调用时传入版本数组：

```yaml
uses: your-org/workflows/.github/workflows/php-ci.yml@v1
with:
  php-versions: '["8.1", "8.2", "8.3"]'
```

### 条件执行不同部署环境

```yaml
# .github/workflows/deploy.yml (reusable)
on:
  workflow_call:
    inputs:
      environment:
        type: string
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - name: Deploy to ${{ inputs.environment }}
        run: |
          if [ "${{ inputs.environment }}" = "production" ]; then
            echo "Running production deployment with canary..."
            # 金丝雀发布逻辑
          else
            echo "Deploying to ${{ inputs.environment }}..."
            # 普通部署逻辑
          fi
```

业务仓库调用：

```yaml
# 生产环境
jobs:
  deploy-prod:
    uses: your-org/workflows/.github/workflows/deploy.yml@v1
    with:
      environment: production

# 预发布环境
jobs:
  deploy-staging:
    uses: your-org/workflows/.github/workflows/deploy.yml@v1
    with:
      environment: staging
```

## 实战：完整的多阶段部署 Pipeline

将 build、test、deploy 拆分为独立的 Reusable Workflow，然后在业务仓库中组合：

```yaml
# 业务仓库 .github/workflows/pipeline.yml
name: Full Pipeline

on:
  push:
    branches: [main]

jobs:
  # 阶段 1：构建
  build:
    uses: your-org/workflows/.github/workflows/build-php.yml@v1
    with:
      php-version: '8.3'
    secrets: inherit

  # 阶段 2：测试（依赖 build）
  test:
    needs: build
    uses: your-org/workflows/.github/workflows/test-php.yml@v1
    with:
      php-version: '8.3'
      phpstan-level: '8'
      coverage: true
    secrets: inherit

  # 阶段 3：部署到 Staging
  deploy-staging:
    needs: test
    uses: your-org/workflows/.github/workflows/deploy.yml@v1
    with:
      environment: staging
    secrets: inherit

  # 阶段 4：部署到 Production（手动审批）
  deploy-production:
    needs: deploy-staging
    uses: your-org/workflows/.github/workflows/deploy.yml@v1
    with:
      environment: production
    secrets: inherit
```

## 踩坑记录

### 坑一：`secrets: inherit` 不生效

**现象**：使用 `secrets: inherit` 后，reusable workflow 中仍然拿不到 secrets。

**原因**：reusable workflow 中必须**显式声明**需要哪些 secrets，即使调用方用了 `inherit`。

**解决**：在 reusable workflow 的 `on.workflow_call.secrets` 中声明每个需要的 secret：

```yaml
on:
  workflow_call:
    secrets:
      my-secret:
        required: true
```

### 坑二：不能嵌套调用超过 4 层

**现象**：A 调用 B，B 调用 C，C 调用 D，D 调用 E 时报错。

**原因**：GitHub 限制 Reusable Workflow 的嵌套深度最多 4 层。

**解决**：扁平化设计，避免深层嵌套。如果逻辑复杂，考虑合并中间层。

### 坑三：`workflow_call` 触发的 workflow 不显示在 Actions 页面

**现象**：调用 reusable workflow 后，在被调用仓库的 Actions 页面看不到运行记录。

**原因**：Reusable Workflow 运行在**调用者的仓库上下文**中，不会出现在被调用仓库。

**解决**：这是正常行为。查看运行记录需要去调用者的仓库。

### 坑四：Matrix 策略中的 `include` 不支持动态值

**现象**：想根据输入参数动态调整 matrix 的 `include` 配置，发现不支持。

**原因**：`include` 是静态配置，不能引用 `inputs`。

**解决**：用 `fromJSON()` 将输入转为 JSON 对象：

```yaml
strategy:
  matrix:
    ${{ fromJSON(inputs.matrix-config) }}
```

调用时传入完整的 matrix JSON：

```yaml
with:
  matrix-config: '{"include":[{"php":"8.3","db":"mysql"},{"php":"8.3","db":"pgsql"}]}'
```

### 坑五：缓存 key 跨仓库不共享

**现象**：在 reusable workflow 中配置了 Composer 缓存，但每次都是 cache miss。

**原因**：GitHub Actions 的缓存是**仓库级别**的，不同仓库的缓存不共享。

**解决**：这是设计如此，无法改变。但可以通过合理的 cache key 策略提高命中率。或者考虑用 `actions/cache/restore` + `actions/cache/save` 分离读写，在 reusable workflow 中只读缓存，由业务仓库负责写入。

## 团队级治理建议

### 1. 建立 Workflow 仓库规范

```
your-org/workflows/
├── .github/
│   └── workflows/
│       ├── php-ci.yml          # PHP 项目 CI
│       ├── node-ci.yml         # Node 项目 CI
│       ├── deploy-k8s.yml      # K8s 部署
│       ├── deploy-lambda.yml   # Lambda 部署
│       └── release.yml         # 发布流程
├── actions/
│   ├── setup-php/              # Composite Action
│   └── notify-feishu/          # 飞书通知 Action
├── README.md
└── CHANGELOG.md
```

### 2. 版本发布流程

```bash
# 1. 开发新功能
git checkout -b feature/add-pest-support
# ... 修改
git push origin feature/add-pest-support

# 2. PR Review 后合并到 main

# 3. 发布新版本
git tag -a v1.2.0 -m "feat: Add Pest test framework support"
git push origin v1.2.0

# 4. 更新主版本标签
git tag -fa v1 -m "Update v1 to v1.2.0"
git push origin v1 --force

# 5. 通知团队更新（可选：用 Dependabot 自动 PR）
```

### 3. 文档化 Inputs 和 Secrets

在 reusable workflow 文件头部用注释说明每个参数的用途和默认值。更好的做法是在 README.md 中维护一份参数文档表。

### 4. 监控和告警

```yaml
# 在 reusable workflow 中添加失败通知
- name: Notify on Failure
  if: failure()
  uses: your-org/workflows/actions/notify-feishu@v1
  with:
    webhook: ${{ secrets.FEISHU_WEBHOOK }}
    title: "CI Failed: ${{ github.repository }}"
    content: "Workflow ${{ github.workflow }} failed on ${{ github.ref }}"
```

## 总结

Reusable Workflows 是 GitHub Actions 中被严重低估的特性。对于 5 人以上的团队、10 个以上的仓库，投入 1-2 天搭建 workflow 仓库，后续每个项目节省的 CI 维护时间是指数级的。

**核心要点**：

1. **一个仓库管所有 workflow**：`your-org/workflows` 是团队的 CI/CD 基础设施
2. **Tag 管理版本**：`@v1` 给业务仓库用，`@v1.x.x` 给需要精确控制的场景
3. **显式声明 inputs 和 secrets**：不要偷懒用 `secrets: inherit`
4. **文档先行**：每个 reusable workflow 都要有清晰的参数说明
5. **渐进式迁移**：先从最简单的 CI 流程开始，逐步扩展到部署和发布

当你的团队有 20 个仓库、每个仓库的 CI 文件从 100 行缩减到 10 行时，你会感谢今天做出的这个决定。
