---

title: Database Branching 实战：Neon/PlanetScale 分支工作流——Laravel 开发中的数据库 Schema Preview
keywords: [Database Branching, Neon, PlanetScale, Laravel, Schema Preview, 分支工作流, 开发中的数据库]
date: 2026-06-04 09:00:00
tags:
- database branching
- Neon
- PlanetScale
- Laravel
- schema review
categories:
- database
description: Database Branching 数据库分支技术深度实战指南——对比 Neon（Serverless PostgreSQL）与 PlanetScale（Vitess MySQL）两大平台的分支工作流，涵盖 Copy-on-Write 原理、Laravel 集成代码、GitHub Actions CI/CD 自动化、Schema Diff 预览与 PR Review 流程。同时提供 Neon vs PlanetScale vs 传统数据库分支方案的多维度对比表格，包含功能、价格、易用性、迁移难度等选型决策依据，以及实际迁移踩坑案例与最佳实践。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
slug: database-branching-neon-planetscale-laravel
---



## 前言：数据库分支——被忽略的开发基础设施

在现代软件开发中，Git 分支工作流已经是团队协作的事实标准。每一位开发者在自己的 feature 分支上编写代码，通过 Pull Request 进行代码审查，最终合并到 main 分支。代码的版本管理、分支隔离、审查合并都有了成熟的工具链。

然而，**数据库 Schema 的变更管理却长期停留在"石器时代"**。传统做法是通过 Laravel Migration 文件来管理表结构变更：开发者在本地运行 `php artisan migrate`，把迁移文件提交到 Git，合并后在生产环境再次运行迁移。这种模式在小团队中尚可运作，但在多分支并行开发时，以下问题频频出现：

- **迁移冲突**：两个 feature 分支同时修改同一张表的同一列，合并后迁移顺序混乱
- **预览困难**：PR Review 时看不到 Schema 的实际变更效果，只能人脑解析迁移文件
- **测试隔离不足**：CI/CD 流水线中的多个 PR 共享同一个测试数据库，互相干扰
- **回滚代价高**：生产环境的 Schema 变更一旦出错，数据回滚可能需要停机维护

**Database Branching（数据库分支）** 正是为了解决这些痛点而诞生的。它将 Git 分支的理念引入数据库层：每一个代码分支都可以拥有对应的独立数据库分支，包含完整的 Schema 和可选的测试数据，且创建速度极快（毫秒级）、成本极低（Copy-on-Write）。

本文将深入对比两大主流数据库分支平台——**Neon（Serverless PostgreSQL）** 和 **PlanetScale（基于 Vitess 的 MySQL）**，并手把手演示如何在 Laravel 项目中集成数据库分支工作流，实现 PR 中的 Schema Preview、自动化审查和安全部署。

---

## 一、什么是 Database Branching？

### 1.1 核心概念

Database Branching 的核心思想非常简单：**像 Git 管理代码一样管理数据库**。

当你创建一个 Git 分支时，你可以同时创建一个对应的数据库分支。这个数据库分支：

- 从父分支（通常是 main/production）**瞬间复制**（Copy-on-Write）
- 拥有独立的 Schema，可以在其上自由运行迁移
- 不影响父分支或其他分支的数据
- 删除分支时，对应的数据库分支也一并清理

```
main 分支 ─── production DB (users, orders, products...)
  │
  ├── feature/payment ─── DB branch (新增 payments 表)
  │
  ├── feature/audit ─── DB branch (users 表新增 audit_log 列)
  │
  └── feature/reporting ─── DB branch (新增 views 统计表)
```

### 1.2 Copy-on-Write 的魔法

传统数据库复制需要完整的数据拷贝，时间与数据量成正比。而 Neon 和 PlanetScale 都采用了 **Copy-on-Write（写时复制）** 机制：

- 创建分支时，新分支与父分支共享底层存储页（page/block）
- 只有当某个页被修改时，才会产生独立副本
- 因此创建一个 100GB 数据库的分支几乎是瞬间完成，额外存储成本也极低

这就是数据库分支能够成为日常工作流一部分的技术基础。

### 1.3 与传统迁移工作流的对比

| 维度 | 传统 Migration | Database Branching |
|------|---------------|-------------------|
| 分支创建速度 | N/A（需手动管理） | 毫秒级（Copy-on-Write） |
| PR 中的 Schema 预览 | 需人脑解析迁移文件 | 自动生成 Schema Diff |
| 测试隔离 | 共享数据库，互相干扰 | 每个分支独立数据库 |
| 迁移冲突检测 | 合并后才发现 | PR 阶段自动检测 |
| 数据回滚 | 需手动编写 rollback | 删除分支即可回滚 |
| CI/CD 集成 | 需手动创建临时数据库 | 自动创建分支数据库 |
| 成本 | 低 | 极低（Copy-on-Write） |
| 学习曲线 | 低 | 中（需了解平台 API） |

---

## 二、Neon：Serverless PostgreSQL 的分支能力

### 2.1 Neon 简介

[Neon](https://neon.tech) 是一个 Serverless PostgreSQL 平台，将 PostgreSQL 的存储层与计算层分离。它的核心特性包括：

- **Serverless 架构**：计算节点可以自动休眠和唤醒，按使用量计费
- **即时分支**：基于 Copy-on-Write 的数据库分支，毫秒级创建
- **Schema Diff**：内置 Schema 对比工具，可直接在控制台查看两个分支间的差异
- **GitHub 集成**：支持在 PR 中自动创建数据库分支并预览 Schema 变更
- **免费套餐慷慨**：适合个人开发者和小团队试用

### 2.2 Neon 分支工作流实战

#### 安装 Neon CLI

```bash
# macOS
brew install neonctl

# npm（跨平台）
npm install -g neonctl

# 登录
neonctl auth
```

#### 创建项目和分支

```bash
# 创建项目
neonctl project create --name my-laravel-app

# 查看主分支
neonctl branches list --project-id <project-id>

# 从 main 分支创建 feature 分支
neonctl branches create --name feature/payment \
  --parent main \
  --project-id <project-id>

# 获取分支连接字符串
neonctl connection-string feature/payment --project-id <project-id>
```

输出类似：

```
postgresql://user:pass@ep-cool-meadow-123.us-east-2.aws.neon.tech/myapp?sslmode=require
```

#### Schema Diff 示例

```bash
# 对比 feature 分支与 main 分支的 Schema 差异
neonctl branches compare feature/payment --base main --project-id <project-id>
```

Neon 会输出类似：

```sql
-- 在 feature/payment 分支上的变更：
CREATE TABLE "payments" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" BIGINT NOT NULL REFERENCES "users"("id"),
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) DEFAULT 'USD',
    "status" VARCHAR(20) DEFAULT 'pending',
    "stripe_id" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");
CREATE INDEX "payments_stripe_id_idx" ON "payments"("stripe_id");
```

### 2.3 Neon GitHub 集成

Neon 提供了官方 GitHub App，可以在 PR 中自动创建数据库分支：

1. 在 GitHub Marketplace 安装 [Neon GitHub App](https://github.com/apps/neon)
2. 将仓库与 Neon 项目关联
3. 配置 `neon.yaml` 文件（放在仓库根目录）：

```yaml
# neon.yaml
project_id: "your-project-id"
# 自动为 PR 创建数据库分支
branches:
  - parent: main
    pattern: "feature/*"
```

当开发者创建以 `feature/` 开头的 PR 时，Neon 会自动：
- 创建一个数据库分支
- 在 PR 评论中注入连接字符串
- 合并 PR 后自动清理分支

---

## 三、PlanetScale：基于 Vitess 的 MySQL 分支工作流

### 3.1 PlanetScale 简介

[PlanetScale](https://planetscale.com) 是基于 [Vitess](https://vitess.io) 构建的 MySQL 兼容数据库平台。它的核心特性包括：

- **Vitess 驱动**：兼容 MySQL 协议，支持水平分片
- **分支工作流**：原生支持数据库分支，与 GitHub 深度集成
- **Deploy Requests**：类似 PR 的数据库部署审查机制
- **Online DDL**：无锁 Schema 变更，不影响生产流量
- **Schema Diff**：在 Deploy Request 中自动展示 Schema 变更
- **安全网**：部署前自动检查潜在问题（如缺少索引的外键）

### 3.2 PlanetScale 分支工作流

#### 安装 pscale CLI

```bash
# macOS
brew install planetscale/tap/pscale

# 登录
pscale auth login

# 创建组织和数据库
pscale org create my-org
pscale db create my-laravel-app --org my-org
```

#### 分支操作

```bash
# 列出分支
pscale branch list my-laravel-app

# 从 main 创建分支
pscale branch create my-laravel-app feature/payment

# 在分支上运行迁移
pscale shell my-laravel-app feature/payment

# 创建 Deploy Request（类似 Pull Request）
pscale deploy-request create my-laravel-app feature/payment

# 查看 Deploy Request 的 Schema Diff
pscale deploy-request diff my-laravel-app 1
```

#### Deploy Request 示例

PlanetScale 的 Deploy Request 是其核心差异化功能。当你创建一个 Deploy Request 时，平台会：

1. **自动计算 Schema Diff**：展示新增的表、修改的列、删除的索引
2. **Linter 检查**：自动检测潜在问题
3. **部署策略**：支持自动或手动部署
4. **回滚能力**：部署后可以快速回滚

```
Deploy Request #42: Add payments table
─────────────────────────────────────
Status: open
From: feature/payment → main

Schema Changes:
+ CREATE TABLE `payments` (
+   `id` bigint unsigned NOT NULL AUTO_INCREMENT,
+   `user_id` bigint unsigned NOT NULL,
+   `amount` decimal(10,2) NOT NULL,
+   `currency` varchar(3) DEFAULT 'USD',
+   `status` varchar(20) DEFAULT 'pending',
+   `stripe_id` varchar(255) DEFAULT NULL,
+   `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
+   `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
+   PRIMARY KEY (`id`),
+   KEY `payments_user_id_idx` (`user_id`),
+   KEY `payments_stripe_id_idx` (`stripe_id`)
+ ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

Linter Results: ✅ No issues found
```

### 3.3 PlanetScale 的安全网（Safety Checks）

PlanetScale 的 Linter 会自动检查以下问题：

- **无主键的表**：Vitess 要求所有表必须有主键
- **外键约束**：Vitess 不支持外键，需要改为应用层约束
- **大表 DDL**：超过阈值的表变更会提示风险
- **字符集问题**：检测不一致的字符集配置
- **重复索引**：检测冗余的索引定义

---

## 四、Laravel 集成：连接分支数据库

### 4.1 数据库配置

在 Laravel 中集成数据库分支，核心思路是**根据 Git 分支名称动态切换数据库连接**。

#### .env 配置

```env
# 主数据库（main 分支）
DB_CONNECTION=neon
DB_HOST=ep-cool-meadow-123.us-east-2.aws.neon.tech
DB_PORT=5432
DB_DATABASE=myapp
DB_USERNAME=myuser
DB_PASSWORD=mypassword

# PlanetScale 配置
DB_CONNECTION=planetscale
DB_HOST=aws.connect.psdb.cloud
DB_PORT=3306
DB_DATABASE=myapp
DB_USERNAME=pscale_user
DB_PASSWORD=pscale_pass
```

#### config/database.php 配置

```php
<?php

return [
    'connections' => [
        // Neon PostgreSQL 分支配置
        'neon' => [
            'driver' => 'pgsql',
            'host' => env('DB_HOST', 'localhost'),
            'port' => env('DB_PORT', '5432'),
            'database' => env('DB_DATABASE', 'myapp'),
            'username' => env('DB_USERNAME', ''),
            'password' => env('DB_PASSWORD', ''),
            'charset' => 'utf8',
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => 'public',
            'sslmode' => 'require',
            'options' => [
                PDO::ATTR_SSL_CA => env('DB_SSL_CA'),
            ],
        ],

        // PlanetScale MySQL 分支配置
        'planetscale' => [
            'driver' => 'mysql',
            'host' => env('DB_HOST', 'localhost'),
            'port' => env('DB_PORT', '3306'),
            'database' => env('DB_DATABASE', 'myapp'),
            'username' => env('DB_USERNAME', ''),
            'password' => env('DB_PASSWORD', ''),
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix' => '',
            'prefix_indexes' => true,
            'options' => [
                PDO::MYSQL_ATTR_SSL_CA => env('DB_SSL_CA'),
            ],
        ],

        // CI 环境使用的分支数据库
        'ci_branch' => [
            'driver' => env('DB_DRIVER', 'mysql'),
            'host' => env('CI_DB_HOST', 'localhost'),
            'port' => env('CI_DB_PORT', '3306'),
            'database' => env('CI_DB_DATABASE', 'test'),
            'username' => env('CI_DB_USERNAME', 'root'),
            'password' => env('CI_DB_PASSWORD', ''),
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix' => '',
            'prefix_indexes' => true,
        ],
    ],
];
```

### 4.2 动态分支切换服务

创建一个服务来根据当前 Git 分支自动切换数据库连接：

```php
<?php

namespace App\Services\Database;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;

class BranchDatabaseResolver
{
    /**
     * 获取当前 Git 分支名称
     */
    public function getCurrentBranch(): string
    {
        $branch = env('DB_BRANCH_NAME');

        if ($branch) {
            return $branch;
        }

        try {
            $branch = trim(shell_exec('git rev-parse --abbrev-ref HEAD 2>/dev/null'));
            if ($branch && $branch !== 'HEAD') {
                return $branch;
            }
        } catch (\Throwable $e) {
            Log::warning('Failed to detect Git branch', [
                'error' => $e->getMessage(),
            ]);
        }

        return 'main';
    }

    /**
     * 将 Git 分支名转换为数据库分支名
     */
    public function resolveDatabaseBranch(string $gitBranch): string
    {
        // main 分支直接使用主数据库
        if (in_array($gitBranch, ['main', 'master', 'production'])) {
            return 'main';
        }

        // feature/xxx -> feature/xxx
        // sanitize branch name for database
        return preg_replace('/[^a-zA-Z0-9\-_\/]/', '_', $gitBranch);
    }

    /**
     * 为当前分支配置数据库连接
     */
    public function configureForCurrentBranch(): void
    {
        $gitBranch = $this->getCurrentBranch();
        $dbBranch = $this->resolveDatabaseBranch($gitBranch);

        // Neon 模式
        if (env('DB_PLATFORM') === 'neon') {
            $this->configureNeon($dbBranch);
            return;
        }

        // PlanetScale 模式
        if (env('DB_PLATFORM') === 'planetscale') {
            $this->configurePlanetScale($dbBranch);
            return;
        }

        Log::info('Using default database connection', [
            'branch' => $gitBranch,
        ]);
    }

    /**
     * 配置 Neon 分支连接
     */
    protected function configureNeon(string $branch): void
    {
        $host = sprintf(
            '%s-%s.cloud.neon.tech',
            env('NEON_PROJECT_ID', 'ep-cool-meadow'),
            $branch === 'main' ? 'main' : str_replace('/', '-', $branch)
        );

        Config::set('database.connections.neon.host', $host);
        DB::purge('neon');

        Log::info('Neon database branch configured', [
            'branch' => $branch,
            'host' => $host,
        ]);
    }

    /**
     * 配置 PlanetScale 分支连接
     */
    protected function configurePlanetScale(string $branch): void
    {
        // PlanetScale 的分支连接通过不同的 host 实现
        // 格式: <db>-<branch>.aws.connect.psdb.cloud
        $host = sprintf(
            '%s-%s.aws.connect.psdb.cloud',
            env('DB_DATABASE', 'myapp'),
            str_replace('/', '-', $branch)
        );

        Config::set('database.connections.planetscale.host', $host);
        DB::purge('planetscale');

        Log::info('PlanetScale database branch configured', [
            'branch' => $branch,
            'host' => $host,
        ]);
    }
}
```

### 4.3 注册服务提供者

```php
<?php

namespace App\Providers;

use App\Services\Database\BranchDatabaseResolver;
use Illuminate\Support\ServiceProvider;

class DatabaseBranchServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(BranchDatabaseResolver::class);
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole() || $this->app->runningUnitTests()) {
            return;
        }

        $resolver = $this->app->make(BranchDatabaseResolver::class);
        $resolver->configureForCurrentBranch();
    }
}
```

在 `config/app.php` 中注册：

```php
'providers' => [
    // ...
    App\Providers\DatabaseBranchServiceProvider::class,
],
```

---

## 五、GitHub Actions CI/CD 集成

### 5.1 Neon + Laravel CI 配置

```yaml
# .github/workflows/neon-branch-ci.yml
name: Neon Branch CI

on:
  pull_request:
    branches: [main]
    paths:
      - 'database/migrations/**'
      - 'database/seeders/**'
      - 'app/Models/**'

env:
  NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
  NEON_API_KEY: ${{ secrets.NEON_API_KEY }}

jobs:
  create-branch-and-test:
    runs-on: ubuntu-latest
    outputs:
      branch_name: ${{ steps.create-branch.outputs.branch_name }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, pgsql
          coverage: xdebug

      - name: Install dependencies
        run: composer install --no-progress --prefer-dist

      - name: Create Neon branch
        id: create-branch
        run: |
          # 安装 Neon CLI
          npm install -g neonctl

          BRANCH_NAME="ci/pr-${{ github.event.pull_request.number }}"
          echo "branch_name=$BRANCH_NAME" >> $GITHUB_OUTPUT

          # 创建分支（如果已存在则先删除）
          neonctl branches delete "$BRANCH_NAME" \
            --project-id "$NEON_PROJECT_ID" \
            --force 2>/dev/null || true

          neonctl branches create \
            --name "$BRANCH_NAME" \
            --parent main \
            --project-id "$NEON_PROJECT_ID"

          # 获取连接字符串
          CONNECTION_STRING=$(neonctl connection-string "$BRANCH_NAME" \
            --project-id "$NEON_PROJECT_ID")

          echo "DATABASE_URL=$CONNECTION_STRING" >> $GITHUB_ENV

      - name: Run migrations
        run: php artisan migrate --force
        env:
          DB_CONNECTION: pgsql
          DATABASE_URL: ${{ env.DATABASE_URL }}

      - name: Seed test data
        run: php artisan db:seed --force
        env:
          DB_CONNECTION: pgsql
          DATABASE_URL: ${{ env.DATABASE_URL }}

      - name: Run tests
        run: php artisan test --parallel
        env:
          DB_CONNECTION: pgsql
          DATABASE_URL: ${{ env.DATABASE_URL }}

      - name: Cleanup Neon branch
        if: always()
        run: |
          neonctl branches delete "${{ steps.create-branch.outputs.branch_name }}" \
            --project-id "$NEON_PROJECT_ID" \
            --force || true
```

### 5.2 PlanetScale + Laravel CI 配置

```yaml
# .github/workflows/planetscale-branch-ci.yml
name: PlanetScale Branch CI

on:
  pull_request:
    branches: [main]
    paths:
      - 'database/migrations/**'
      - 'database/seeders/**'
      - 'app/Models/**'

jobs:
  test-with-branch:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, mbstring, zip, pdo, mysql

      - name: Install pscale CLI
        run: |
          curl -fsSL https://github.com/planetscale/cli/releases/latest/download/pscale_linux_amd64.tar.gz | tar xz
          sudo mv pscale /usr/local/bin/pscale

      - name: Authenticate
        run: pscale auth login --token ${{ secrets.PSCALE_TOKEN }}

      - name: Create branch
        id: create-branch
        run: |
          BRANCH_NAME="ci-pr-${{ github.event.pull_request.number }}"
          echo "branch_name=$BRANCH_NAME" >> $GITHUB_OUTPUT

          pscale branch create my-laravel-app "$BRANCH_NAME" \
            --from main || pscale branch create my-laravel-app "$BRANCH_NAME"

          # 等待分支就绪
          for i in $(seq 1 30); do
            STATUS=$(pscale branch show my-laravel-app "$BRANCH_NAME" --format json | jq -r '.ready')
            if [ "$STATUS" = "true" ]; then
              break
            fi
            sleep 2
          done

          # 创建密码并获取连接信息
          CREDS=$(pscale password create my-laravel-app "$BRANCH_NAME" ci-pass --format json)
          HOST=$(echo $CREDS | jq -r '.access_host_url')
          USERNAME=$(echo $CREDS | jq -r '.username')
          PASSWORD=$(echo $CREDS | jq -r '.password')

          echo "DB_HOST=$HOST" >> $GITHUB_ENV
          echo "DB_USERNAME=$USERNAME" >> $GITHUB_ENV
          echo "DB_PASSWORD=$PASSWORD" >> $GITHUB_ENV

      - name: Install dependencies
        run: composer install --no-progress --prefer-dist

      - name: Run migrations
        run: php artisan migrate --force
        env:
          DB_CONNECTION: planetscale
          DB_DATABASE: my-laravel-app

      - name: Run tests
        run: php artisan test --parallel
        env:
          DB_CONNECTION: planetscale
          DB_DATABASE: my-laravel-app

      - name: Create Deploy Request
        if: success()
        run: |
          pscale deploy-request create my-laravel-app \
            "${{ steps.create-branch.outputs.branch_name }}" \
            --into main \
            --body "Auto-created from PR #${{ github.event.pull_request.number }}"

      - name: Cleanup branch
        if: always()
        run: |
          pscale branch delete my-laravel-app \
            "${{ steps.create-branch.outputs.branch_name }}" \
            --force || true
```

### 5.3 Schema Diff 在 PR 中的展示

创建一个 GitHub Action 步骤，在 PR 评论中自动展示 Schema Diff：

```yaml
      - name: Post Schema Diff to PR
        if: success()
        uses: actions/github-script@v7
        with:
          script: |
            const { execSync } = require('child_process');

            // 获取 Schema Diff
            let diff = '';
            try {
              diff = execSync(
                `pscale deploy-request diff my-laravel-app 1 --format json`,
                { encoding: 'utf-8' }
              );
            } catch (e) {
              diff = 'Unable to generate schema diff.';
            }

            const body = `## 📊 Database Schema Preview

            <details>
            <summary>Click to view Schema Changes</summary>

            \`\`\`sql
            ${diff}
            \`\`\`

            </details>

            > Auto-generated by PlanetScale Branch CI`;

            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: body
            });
```

---

## 六、Laravel Migration 工作流与分支的结合

### 6.1 推荐的迁移工作流

在数据库分支工作流中，Laravel Migration 的角色发生了变化：

**传统流程**：Migration 是唯一的 Schema 变更来源

**分支流程**：Migration 是 Schema 变更的声明式描述，数据库分支提供隔离的执行环境

推荐的完整工作流：

```bash
# 1. 创建 Git 分支和数据库分支
git checkout -b feature/payments
neonctl branches create --name feature/payments --parent main

# 2. 编写迁移
php artisan make:migration create_payments_table

# 3. 在分支数据库上运行迁移
DB_BRANCH_NAME=feature/payments php artisan migrate

# 4. 开发应用代码...

# 5. 提交并推送
git add .
git commit -m "feat: add payments table and model"
git push origin feature/payments

# 6. 创建 PR -> CI 自动运行 -> Schema Diff 自动展示

# 7. 合并 PR -> CI 在生产数据库运行迁移 -> 删除数据库分支
```

### 6.2 分支感知的迁移命令

创建一个自定义 Artisan 命令，简化分支迁移操作：

```php
<?php

namespace App\Console\Commands;

use App\Services\Database\BranchDatabaseResolver;
use Illuminate\Console\Command;

class BranchMigrateCommand extends Command
{
    protected $signature = 'branch:migrate
        {--branch= : Database branch name (auto-detected from Git if not specified)}
        {--fresh : Drop all tables and re-run migrations}
        {--seed : Seed the database after migrating}';

    protected $description = 'Run migrations on a database branch';

    public function handle(BranchDatabaseResolver $resolver): int
    {
        $branch = $this->option('branch') ?? $resolver->getCurrentBranch();
        $dbBranch = $resolver->resolveDatabaseBranch($branch);

        $this->info("Running migrations on branch: {$dbBranch}");

        // 配置分支连接
        $resolver->configureForCurrentBranch();

        $migrateCommand = $this->option('fresh') ? 'migrate:fresh' : 'migrate';

        $this->call($migrateCommand, ['--force' => true]);

        if ($this->option('seed')) {
            $this->call('db:seed', ['--force' => true]);
        }

        $this->info("Migrations completed on branch: {$dbBranch}");

        return self::SUCCESS;
    }
}
```

使用方式：

```bash
# 自动使用当前 Git 分支
php artisan branch:migrate

# 指定分支
php artisan branch:migrate --branch=feature/payments

# 重建并填充数据
php artisan branch:migrate --fresh --seed
```

### 6.3 Schema Snapshot 与对比

编写一个命令，用于在 PR 阶段生成和对比 Schema 快照：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;

class SchemaSnapshotCommand extends Command
{
    protected $signature = 'schema:snapshot
        {--output=database/schema-snapshots}
        {--compare= : Path to a previous snapshot to compare with}';

    protected $description = 'Generate or compare database schema snapshots';

    public function handle(): int
    {
        $outputDir = $this->option('output');
        File::ensureDirectoryExists($outputDir);

        $snapshot = $this->generateSnapshot();
        $filename = date('Y-m-d_His') . '.json';
        $filepath = "{$outputDir}/{$filename}";

        File::put($filepath, json_encode($snapshot, JSON_PRETTY_PRINT));

        $this->info("Schema snapshot saved to: {$filepath}");

        if ($comparePath = $this->option('compare')) {
            $this->compareSnapshots($comparePath, $filepath);
        }

        return self::SUCCESS;
    }

    protected function generateSnapshot(): array
    {
        $tables = DB::select(
            "SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' ORDER BY table_name"
        );

        $snapshot = [];
        foreach ($tables as $table) {
            $columns = DB::select(
                "SELECT column_name, data_type, is_nullable,
                        column_default, character_maximum_length
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                 AND table_name = ?
                 ORDER BY ordinal_position",
                [$table->table_name]
            );

            $indexes = DB::select(
                "SELECT indexname, indexdef
                 FROM pg_indexes
                 WHERE schemaname = 'public'
                 AND tablename = ?",
                [$table->table_name]
            );

            $snapshot[$table->table_name] = [
                'columns' => $columns,
                'indexes' => $indexes,
            ];
        }

        return $snapshot;
    }

    protected function compareSnapshots(string $oldPath, string $newPath): void
    {
        $old = json_decode(File::get($oldPath), true);
        $new = json_decode(File::get($newPath), true);

        $added = array_diff_key($new, $old);
        $removed = array_diff_key($old, $new);
        $common = array_intersect_key($old, $new);

        if (!empty($added)) {
            $this->warn("New tables: " . implode(', ', array_keys($added)));
        }
        if (!empty($removed)) {
            $this->error("Removed tables: " . implode(', ', array_keys($removed)));
        }

        foreach ($common as $table => $data) {
            $oldCols = array_column($old[$table]['columns'], 'column_name');
            $newCols = array_column($new[$table]['columns'], 'column_name');

            $addedCols = array_diff($newCols, $oldCols);
            $removedCols = array_diff($oldCols, $newCols);

            if (!empty($addedCols) || !empty($removedCols)) {
                $this->warn("Table '{$table}' changes:");
                foreach ($addedCols as $col) {
                    $this->line("  + {$col}");
                }
                foreach ($removedCols as $col) {
                    $this->line("  - {$col}");
                }
            }
        }
    }
}
```

---

## 七、Neon vs PlanetScale vs 传统数据库分支方案全面对比

### 7.1 三方案多维度对比表

在选型之前，需要将 Neon、PlanetScale 与传统的数据库迁移方案（Flyway/Liquibase + 手动分支管理）放在同一框架下进行多维度对比：

| 对比维度 | Neon (PostgreSQL) | PlanetScale (MySQL) | 传统方案 (Flyway/Liquibase) |
|---------|-------------------|---------------------|---------------------------|
| **分支创建速度** | 毫秒级（Copy-on-Write） | 秒级（Copy-on-Write） | N/A（需手动创建数据库副本） |
| **Schema Diff** | CLI + 控制台 + GitHub App | CLI + 控制台 + Deploy Request | 需第三方工具（如 SchemaSpy） |
| **PR 集成** | GitHub App 自动注入连接串 | Deploy Request + GitHub 集成 | 需手动搭建 CI 流程 |
| **外键支持** | ✅ 完整支持 | ❌ Vitess 不支持 | ✅ 取决于数据库引擎 |
| **水平分片** | ❌ 不支持 | ✅ Vitess 原生支持 | 需自行实现 |
| **Online DDL** | PostgreSQL 原生（部分锁表） | Vitess Online DDL（无锁） | 取决于数据库引擎和工具 |
| **自动休眠** | ✅ 支持（节省成本） | ❌ 不支持 | N/A |
| **免费套餐** | 0.5GB 存储, 191.9h 计算/月 | 5GB 存储, 1亿行读/月 | 完全免费（自建） |
| **付费起步价** | $19/月 | $29/月 | 仅服务器成本 |
| **学习曲线** | 低-中（PostgreSQL + Neon API） | 低-中（MySQL + pscale CLI） | 低（SQL + 配置文件） |
| **迁移难度（从 MySQL 迁入）** | 高（需 MySQL→PG 转换） | 低（原生 MySQL 兼容） | 无迁移成本 |
| **迁移难度（从 PG 迁入）** | 低（原生 PostgreSQL） | 高（需 PG→MySQL 转换） | 无迁移成本 |
| **Vendor Lock-in 风险** | 中（Neon 特有 API） | 中-高（Vitess 不兼容外键） | 低（标准 SQL） |
| **团队规模适配** | 1-50 人 | 5-500 人 | 任意 |
| **多环境管理** | 分支即环境，自动管理 | 分支即环境，Deploy Request | 需手动管理 dev/staging/prod |
| **回滚能力** | 删除分支 + Migration rollback | Deploy Request 回滚 | Migration rollback |
| **数据隔离性** | 完全隔离（独立连接串） | 完全隔离（独立连接串） | 需自行实现 |

### 7.2 成本估算示例

以一个典型 Laravel SaaS 项目为例（10人团队，日均 50 万请求，数据库 20GB）：

| 成本项 | Neon Pro | PlanetScale Scaler | 自建 RDS + 传统方案 |
|-------|---------|-------------------|------------------|
| 月基础费用 | ~$75（计算+存储） | ~$39（Scaler 套餐） | ~$200（RDS db.r5.large） |
| CI 分支额外成本 | ≈$0（CoW 几乎免费） | ≈$0（含在存储配额） | ~$100（临时 RDS 实例） |
| 人力维护成本 | 低（托管服务） | 低（托管服务） | 中-高（DBA 日常运维） |
| **月总估算** | **~$75** | **~$39** | **~$300+** |

> 💡 数据库分支的最大隐性收益不在服务器成本，而在**开发效率提升**：PR 审查时能直观看到 Schema Diff、CI 自动验证迁移、测试环境完全隔离——这些在传统方案中需要大量人工和额外基础设施才能实现。

## 八、成本对比与选型建议

### 8.1 定价对比

| 维度 | Neon (PostgreSQL) | PlanetScale (MySQL) |
|------|-------------------|---------------------|
| 免费套餐 | 0.5 GB 存储, 191.9h 计算/月 | 5 GB 存储, 1 亿行读/月 |
| 分支存储 | Copy-on-Write, 免费 | Copy-on-Write, 包含在存储配额 |
| 计费模式 | 计算时间 + 存储 | 行读写 + 存储 |
| 分支数量限制 | 免费: 10, Pro: 500 | 免费: 3, Scaler: 1000 |
| 付费起步价 | $19/月 | $29/月 |
| 最适合 | PostgreSQL 用户, Serverless 场景 | MySQL 用户, Vitess 生态 |

### 8.2 功能对比

| 功能 | Neon | PlanetScale |
|------|------|-------------|
| 数据库类型 | PostgreSQL 16+ | MySQL 8.0 (Vitess) |
| 分支创建速度 | 毫秒级 | 秒级 |
| Schema Diff | CLI + 控制台 + GitHub App | CLI + 控制台 + GitHub App |
| Deploy Request | 无（使用 Git PR） | 原生 Deploy Request |
| Online DDL | PostgreSQL 原生 | Vitess Online DDL |
| 外键支持 | 完整支持 | 不支持（Vitess 限制） |
| 水平分片 | 不支持 | Vitess 原生支持 |
| 自动休眠 | 支持 | 不支持 |
| 地理复制 | 支持 | 支持 |

### 8.3 选型建议

**选择 Neon 的场景**：
- 团队已经在使用 PostgreSQL
- 需要外键约束
- Serverless/自动休眠是硬需求
- 预算敏感，免费套餐即可满足开发需求
- 需要 PostgreSQL 特有功能（JSONB、全文搜索、PostGIS）

**选择 PlanetScale 的场景**：
- 团队使用 MySQL 生态
- 需要 Vitess 的水平分片能力
- 重视 Deploy Request 的部署审查机制
- Laravel 默认就是 MySQL，迁移成本最低
- 未来有大规模分片需求

**两者都不选的场景**：
- 团队规模小，传统 Migration 足够
- 已有成熟的数据库变更管理流程（如 Flyway、Liquibase）
- 使用的是不支持分支的数据库（如 MongoDB、Redis）
- 对 vendor lock-in 有严重顾虑

---

## 九、实际迁移踩坑案例

### 9.1 踩坑一：PlanetScale 不支持外键导致 Laravel Migration 失败

**问题描述**：Laravel 默认的 `->constrained()` 会生成 `FOREIGN KEY` 约束，但 PlanetScale（Vitess）不支持外键。在 PlanetScale 分支上运行 `php artisan migrate` 会直接报错：

```
SQLSTATE[HY000]: General error: 1215 Cannot add foreign key constraint
```

**解决方案**：创建一个 Migration 基类，自动跳过外键约束：

```php
<?php

namespace App\Database\Migrations;

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Config;

abstract class MigrationWithoutForeignKeys extends Migration
{
    public function getConnection(): ?string
    {
        // PlanetScale 环境下禁用外键检查
        if (env('DB_PLATFORM') === 'planetscale') {
            Config::set('database.connections.planetscale.foreign_key_constraints', false);
        }
        return parent::getConnection();
    }
}

// 在迁移中使用
return new class extends MigrationWithoutForeignKeys
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->index(); // 不用 ->constrained()
            // ...
        });
    }
};
```

或者全局禁用外键约束（在 `AppServiceProvider` 中）：

```php
// AppServiceProvider.php
use Illuminate\Database\Connection;

public function boot(): void
{
    Connection::resolverFor('mysql', function ($connection, $database, $prefix, $config) {
        $config['foreign_key_constraints'] = env('DB_PLATFORM') !== 'planetscale';
        return new \Illuminate\Database\MySqlConnection($connection, $database, $prefix, $config);
    });
}
```

### 9.2 踩坑二：Neon 分支连接字符串中的域名格式错误

**问题描述**：Neon 的分支连接字符串中，分支名中的 `/` 会被 URL 编码，导致 Laravel 的 `DB_HOST` 解析失败。

```
# 错误示例
postgresql://user:***@ep-cool-meadow-123.feature%2Fpayment.neon.tech/myapp
# Laravel 报错: could not connect to server
```

**解决方案**：

```php
// BranchDatabaseResolver.php 中的 configureNeon 方法修正
protected function configureNeon(string $branch): void
{
    // 关键：将 / 替换为 -，避免 URL 编码问题
    $safeBranchName = str_replace('/', '-', $branch);
    
    $host = sprintf(
        '%s-%s.cloud.neon.tech',
        env('NEON_PROJECT_ID', 'ep-cool-meadow'),
        $branch === 'main' ? 'main' : $safeBranchName
    );

    Config::set('database.connections.neon.host', $host);
    DB::purge('neon');
}
```

### 9.3 踩坑三：CI 并发创建分支时的命名冲突

**问题描述**：多个 PR 同时触发 CI 流水线，如果分支名不够唯一（如都用 `ci-test`），会导致创建分支失败。

**解决方案**：使用 PR 编号 + Commit SHA 前缀作为分支名：

```yaml
- name: Generate unique branch name
  id: branch-name
  run: |
    SHORT_SHA=$(echo "${{ github.event.pull_request.head.sha }}" | head -c 7)
    BRANCH_NAME="ci/pr-${{ github.event.pull_request.number }}-${SHORT_SHA}"
    echo "branch_name=$BRANCH_NAME" >> $GITHUB_OUTPUT
```

### 9.4 踩坑四：PlanetScale 分支就绪检测超时

**问题描述**：PlanetScale 创建分支后不是立即可用的，需要等待同步完成。CI 中如果立即连接会报 `connection refused`。

**解决方案**：实现带指数退避的就绪检测：

```bash
#!/bin/bash
# wait-for-branch.sh
DB_NAME=$1
BRANCH_NAME=$2
MAX_ATTEMPTS=30
ATTEMPT=0
SLEEP_SEC=2

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    STATUS=$(pscale branch show "$DB_NAME" "$BRANCH_NAME" --format json 2>/dev/null | jq -r '.ready // "unknown"')
    
    if [ "$STATUS" = "true" ]; then
        echo "✅ Branch $BRANCH_NAME is ready"
        exit 0
    fi
    
    ATTEMPT=$((ATTEMPT + 1))
    echo "⏳ Waiting for branch to be ready... (attempt $ATTEMPT/$MAX_ATTEMPTS)"
    sleep $SLEEP_SEC
    SLEEP_SEC=$((SLEEP_SEC > 10 ? 10 : SLEEP_SEC + 1))  # 指数退避，上限10秒
done

echo "❌ Branch $BRANCH_NAME not ready after $MAX_ATTEMPTS attempts"
exit 1
```

### 9.5 踩坑五：分支数据库的数据继承导致测试污染

**问题描述**：数据库分支从父分支（通常是 main）Copy-on-Write 复制，会继承生产数据。如果测试代码依赖特定数据量（如 `User::count() > 0`），可能因数据量不一致导致测试结果不确定。

**解决方案**：在 CI 中先清空再重建：

```yaml
- name: Reset branch database
  run: |
    php artisan migrate:fresh --force
    php artisan db:seed --class=TestSeeder --force
  env:
    DB_CONNECTION: planetscale
    DB_DATABASE: my-laravel-app
```

同时确保 Seeder 产出确定性数据：

```php
<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class TestSeeder extends Seeder
{
    public function run(): void
    {
        // 固定数据，确保测试一致性
        \App\Models\User::factory()->count(100)->create();
        \App\Models\Product::factory()->count(50)->create();
        \App\Models\Order::factory()->count(200)->create();
    }
}
```

## 十、最佳实践与踩坑总结

### 10.1 分支命名规范

建议采用与 Git 分支一致的命名规范：

```bash
# 功能分支
feature/add-payments-table
feature/user-profile-columns
feature/audit-logging

# 修复分支
hotfix/fix-order-amount-precision

# CI 临时分支
ci/pr-123
ci/pr-456
```

### 10.2 分支生命周期管理

数据库分支不应该无限积累。建议设置自动清理策略：

```bash
# 定期清理超过 7 天的 CI 分支
# cron: 0 2 * * *

#!/bin/bash
# cleanup-branches.sh

# Neon 分支清理
BRANCHES=$(neonctl branches list --project-id $NEON_PROJECT_ID --output json)
echo $BRANCHES | jq -r '.[] | select(.name | startswith("ci/")) |
  select(.created_at < (now - 604800)) | .name' | while read branch; do
    neonctl branches delete "$branch" --project-id $NEON_PROJECT_ID --force
    echo "Deleted branch: $branch"
done

# PlanetScale 分支清理
pscale branch list my-laravel-app --format json | \
  jq -r '.[] | select(.name | startswith("ci-pr-")) |
  select(.created_at < (now - 604800)) | .name' | while read branch; do
    pscale branch delete my-laravel-app "$branch" --force
    echo "Deleted branch: $branch"
done
```

### 10.3 数据种子策略

数据库分支创建时是从父分支 Copy-on-Write 复制的，所以**生产数据的结构和部分数据**会自动继承。但测试场景通常需要特定的种子数据：

```php
<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;

class EnvironmentAwareSeeder extends Seeder
{
    public function run(): void
    {
        // 生产环境不运行 Seeder
        if (App::environment('production')) {
            return;
        }

        // 本地/CI 环境运行完整 Seeder
        $this->call([
            UserSeeder::class,
            RoleSeeder::class,
            ProductSeeder::class,
            OrderSeeder::class,
        ]);

        // 如果是数据库分支，额外添加测试数据
        if (env('DB_BRANCH_NAME')) {
            $this->call([
                PaymentTestDataSeeder::class,
            ]);
        }
    }
}
```

### 10.4 迁移文件的最佳实践

在数据库分支工作流中，迁移文件需要遵循更严格的规范：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ✅ 使用 ifNotExists 防止分支间冲突
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 10, 2);
            $table->string('currency', 3)->default('USD');
            $table->string('status', 20)->default('pending');
            $table->string('stripe_id')->nullable()->unique();
            $table->timestamps();

            // ✅ 显式命名索引，便于跨分支对比
            $table->index('user_id', 'payments_user_id_idx');
            $table->index('status', 'payments_status_idx');
        });
    }

    public function down(): void
    {
        // ✅ 使用 ifExists 防止回滚失败
        Schema::dropIfExists('payments');
    }
};
```

### 10.5 与传统迁移工作流的混合策略

数据库分支并不意味着要完全抛弃传统的迁移工作流。推荐的混合策略是：

1. **开发阶段**：使用数据库分支提供隔离的开发和测试环境
2. **PR 审查阶段**：使用 Schema Diff 展示变更详情
3. **合并阶段**：通过 Migration 在生产环境应用变更
4. **回滚阶段**：Migration 的 rollback 方法 + 数据库分支的快照恢复

这种策略既保留了分支的隔离性和快速迭代优势，又保持了 Migration 的版本控制和可重复性。

---

## 十一、总结

Database Branching 是数据库开发范式的一次重要演进。它将 Git 分支的理念引入数据库层，解决了传统迁移工作流中的隔离不足、审查困难、冲突频发等痛点。

**Neon** 和 **PlanetScale** 代表了这一领域的两个方向：前者基于 PostgreSQL 的 Serverless 架构，后者基于 Vitess 的 MySQL 分布式方案。两者都提供了完善的分支管理、Schema Diff 和 CI/CD 集成能力。

对于 Laravel 开发者来说，集成数据库分支工作流的核心步骤包括：

1. 选择 Neon 或 PlanetScale 作为数据库平台
2. 配置 Laravel 的数据库连接以支持分支切换
3. 集成 GitHub Actions，实现 PR 自动创建分支数据库
4. 在 CI 中运行迁移和测试，确保 Schema 变更的安全性
5. 利用 Schema Diff 功能，在 PR 中直观展示数据库变更
6. 建立分支清理机制，避免分支积累导致成本上升

数据库分支不是银弹，它适用于**多分支并行开发、重视 Schema 审查、需要测试隔离**的团队场景。对于小团队或单人项目，传统的 Migration 工作流依然高效可靠。

最终，选择哪种方案取决于你的数据库偏好（PostgreSQL vs MySQL）、团队规模和安全需求。无论选择哪种，将数据库变更纳入代码审查流程，始终是提升软件质量的正确方向。

---

## 相关阅读

- [SQLite 现代化实战：libSQL / Turso 边缘数据库与 Laravel 集成]({% post_path 00_架构/2026-06-03-SQLite-现代化实战-libSQL-Turso-边缘数据库-Laravel集成 %})——另一种现代数据库平台选型思路，从 PostgreSQL/MySQL 走向边缘 SQLite
- [Multi-Tenancy Security 实战：共享数据库行级安全策略]({% post_path 05_PHP/Laravel/Multi-Tenancy-Security-实战-共享数据库行级安全策略 %})——数据库级别的租户隔离方案，与数据库分支的隔离思路互补
- [GitHub Actions 矩阵策略实战：多 PHP 版本多数据库并行测试与条件发布]({% post_path 07_CICD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布 %})——CI/CD 多数据库并行测试的工程化实践
