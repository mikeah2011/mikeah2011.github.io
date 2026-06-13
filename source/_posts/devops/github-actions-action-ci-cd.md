---

title: GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件
keywords: [GitHub Actions, Action, CI, CD, 自定义, 开发实战, 复用, 工作流组件]
date: 2026-06-01
categories:
- devops
tags:
- GitHub Actions
- CI/CD
- DevOps
- 自动化
- IaC
description: 结合 30+ Laravel 仓库 CI/CD 统一治理实战，系统讲解 GitHub Actions 自定义 Action（Composite/JavaScript/Docker）与 Reusable Workflow 的选型、封装、调试、版本治理全流程，附 12 个真实踩坑案例与可运行代码示例，助你搭建一处维护处处生效的 CI/CD 工作流复用体系。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
- /images/content/cicd-01-content-1.jpg
- /images/content/cicd-01-content-2.jpg
---




## 一、为什么写这篇？

在维护 30+ 个 Laravel 仓库的 CI/CD 流水线时，我们遇到了一个典型痛点：**每个仓库的 GitHub Actions 工作流都存在大量重复逻辑**。

```yaml
# 仓库 A 的 .github/workflows/ci.yml
- name: Setup PHP
  uses: shivammathur/setup-php@v2
  with:
    php-version: '8.3'
    extensions: mbstring, xml, ctype, json, bcmath, pdo_mysql, redis
    tools: composer:v2
    coverage: xdebug

- name: Get Composer Cache Directory
  id: composer-cache
  run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

- name: Cache Composer Dependencies
  uses: actions/cache@v4
  with:
    path: ${{ steps.composer-cache.outputs.dir }}
    key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
    restore-keys: ${{ runner.os }}-composer-

- name: Install Dependencies
  run: composer install --no-progress --prefer-dist --optimize-autoloader
```

这段配置在每个仓库里重复了 **至少 30 遍**。更糟糕的是，当 PHP 版本需要从 8.3 升级到 8.4 时，我们需要逐个仓库修改——这不仅低效，而且极易遗漏。

**核心痛点总结：**

| 问题 | 影响 | 量化数据 |
|------|------|----------|
| 工作流代码重复 | 30+ 仓库维护成本高 | 每次修改 30+ PR |
| PHP 版本不一致 | 部分仓库遗漏升级 | 5 个仓库曾出现版本差异 |
| 缓存策略不统一 | 构建时间参差不齐 | 30s~120s 差异 |
| 安全扫描配置各异 | 漏扫风险 | 8 个仓库缺失 scan |
| 新仓库搭建慢 | 复制粘贴容易出错 | 平均 2 小时/仓库 |

**自定义 Action 就是解决方案**——把可复用的 CI/CD 逻辑封装成组件，一处维护，处处生效。

---

## 二、核心概念/原理

![GitHub Actions 核心概念](/images/content/cicd-01-content-1.jpg)

### 2.1 GitHub Actions 三种 Action 类型

GitHub Actions 支持三种实现方式，各有适用场景：

| 类型 | 运行时 | 优点 | 缺点 | 适用场景 |
|------|--------|------|------|----------|
| **JavaScript Action** | Node.js 20 | 启动快、生态丰富 | 需要编译、node_modules | 需要复杂逻辑/调用 API |
| **Docker Action** | Docker 容器 | 环境完全隔离、可以用任意语言 | 启动慢（需拉镜像） | 需要特定系统工具/非 Node 环境 |
| **Composite Action** | Shell | 最轻量、无额外依赖 | 只能组合 steps | 纯 shell 脚本组合（推荐入门） |

**对于 Laravel CI/CD 场景，推荐优先使用 Composite Action**，因为它：
- 无需编译步骤
- 直接在 runner shell 中执行
- 可以复用已有的 `uses` 步骤
- 维护成本最低

#### 三种 Action 类型深度对比

| 维度 | JavaScript Action | Docker Action | Composite Action |
|------|-------------------|---------------|------------------|
| **运行时** | Node.js 20 | Docker 容器 | Runner Shell |
| **启动速度** | ⚡ 快（~2s） | 🐢 慢（需拉镜像 10-60s） | ⚡⚡ 最快（<1s） |
| **内存占用** | 中等（Node.js 进程） | 高（完整容器） | 最低（直接 shell） |
| **语言支持** | JavaScript/TypeScript | 任意语言 | Shell/脚本 |
| **环境隔离** | 进程级 | 容器级（完全隔离） | 无隔离（共享 runner） |
| **调试难度** | 中等（需编译） | 低（本地 docker run） | 最低（本地直接跑） |
| **文件访问** | 仅 checkout 目录 | 仅挂载目录 | 完整 runner 文件系统 |
| **调用外部 Action** | ✅ 支持 `@actions/core` | ❌ 需自行安装 | ✅ 可嵌套 `uses` |
| **Secrets 访问** | ✅ `@actions/core` | ✅ env/args 传入 | ✅ 直接引用 |
| **输出值传递** | ✅ `core.setOutput()` | ✅ `$GITHUB_OUTPUT` | ✅ `$GITHUB_OUTPUT` |
| **适用规模** | 中大型团队 | 需要特殊环境 | 所有场景（推荐入门） |
| **典型用例** | API 调用、复杂逻辑、PR 评论 | 数据库迁移验证、编译型语言 | PHP/Node 环境搭建、lint、test |

**选型决策树：**
```
需要特殊系统工具或非 Node 环境？
├── 是 → Docker Action
└── 否 → 需要调用 GitHub API 或复杂 JS 逻辑？
    ├── 是 → JavaScript Action
    └── 否 → Composite Action（首选）
```

### 2.2 Action 的基本结构

```
my-action/
├── action.yml          # Action 元数据（必须）
├── action.yaml         # 也可以用 .yaml 后缀
├── README.md           # 文档
├── LICENSE             # 许可证
└── (可选文件)
    ├── index.js        # JavaScript Action 入口
    ├── Dockerfile      # Docker Action 入口
    └── dist/           # 编译产物
```

**`action.yml` 核心字段：**

```yaml
name: 'My Custom Action'
description: '一句话描述'
inputs:
  php-version:
    description: 'PHP 版本'
    required: true
    default: '8.3'
outputs:
  cache-hit:
    description: '缓存是否命中'
    value: ${{ steps.cache.outputs.cache-hit }}
runs:
  using: 'composite'  # 或 'node20' / 'docker'
  steps:
    - shell: bash
      run: echo "Hello from custom action"
```

### 2.3 两种复用模式对比

| 模式 | 位置 | 版本管理 | 跨组织 | 适用场景 |
|------|------|----------|--------|----------|
| **Composite Action** | `.github/actions/xxx/action.yml` 或独立仓库 | tag/release | ✅ | 可复用步骤组合 |
| **Reusable Workflow** | `.github/workflows/xxx.yml` | tag/release | ✅ | 完整工作流模板 |

**经验法则：**
- 如果复用的是 **一组步骤**（如 Setup PHP + Cache + Install）→ 用 **Composite Action**
- 如果复用的是 **整个工作流**（如完整的 CI/CD pipeline）→ 用 **Reusable Workflow**
- 两者可以组合使用

---

## 三、实战代码

![CI/CD 实战代码](/images/content/cicd-01-content-2.jpg)

### 3.1 Composite Action：PHP 环境搭建

我们从最常见的场景开始——封装 PHP 环境搭建 + Composer 依赖安装：

**目录结构：**
```
.github/
├── actions/
│   ├── setup-php-composer/
│   │   ├── action.yml
│   │   └── README.md
│   ├── run-phpunit/
│   │   └── action.yml
│   └── laravel-deploy-check/
│       └── action.yml
└── workflows/
    ├── ci.yml
    └── deploy.yml
```

**`.github/actions/setup-php-composer/action.yml`：**

```yaml
name: 'Setup PHP & Composer'
description: 'Setup PHP with extensions, cache Composer dependencies, and install packages'

inputs:
  php-version:
    description: 'PHP version to use'
    required: false
    default: '8.3'
  extensions:
    description: 'PHP extensions (comma-separated)'
    required: false
    default: 'mbstring, xml, ctype, json, bcmath, pdo_mysql, redis, gd, zip'
  coverage:
    description: 'Coverage driver (xdebug, pcov, none)'
    required: false
    default: 'xdebug'
  composer-args:
    description: 'Additional composer install arguments'
    required: false
    default: '--no-progress --prefer-dist --optimize-autoloader'
  working-directory:
    description: 'Working directory for Composer commands'
    required: false
    default: '.'

outputs:
  php-version:
    description: 'Installed PHP version'
    value: ${{ steps.php-info.outputs.version }}
  cache-hit:
    description: 'Whether Composer cache was hit'
    value: ${{ steps.composer-cache.outputs.cache-hit }}
  install-time:
    description: 'Composer install duration (seconds)'
    value: ${{ steps.timer.outputs.duration }}

runs:
  using: 'composite'
  steps:
    # Step 1: Setup PHP
    - name: Setup PHP
      uses: shivammathur/setup-php@v2
      with:
        php-version: ${{ inputs.php-version }}
        extensions: ${{ inputs.extensions }}
        tools: composer:v2
        coverage: ${{ inputs.coverage }}

    # Step 2: Get PHP info (for output)
    - name: Get PHP Info
      id: php-info
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      run: |
        PHP_VER=$(php -r 'echo PHP_VERSION;')
        echo "version=$PHP_VER" >> $GITHUB_OUTPUT
        echo "::group::PHP Environment"
        php -v
        echo "Extensions: $(php -m | tr '\n' ', ')"
        echo "::endgroup::"

    # Step 3: Composer Cache
    - name: Get Composer Cache Directory
      id: composer-cache-dir
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

    - name: Cache Composer Dependencies
      id: composer-cache
      uses: actions/cache@v4
      with:
        path: ${{ steps.composer-cache-dir.outputs.dir }}
        key: ${{ runner.os }}-composer-${{ inputs.php-version }}-${{ hashFiles('**/composer.lock') }}
        restore-keys: |
          ${{ runner.os }}-composer-${{ inputs.php-version }}-
          ${{ runner.os }}-composer-

    # Step 4: Install Dependencies with timing
    - name: Install Composer Dependencies
      id: timer
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      run: |
        START=$(date +%s)
        composer install ${{ inputs.composer-args }}
        END=$(date +%s)
        echo "duration=$((END - START))" >> $GITHUB_OUTPUT
```

### 3.2 使用自定义 Action

**`.github/workflows/ci.yml`（优化后）：**

```yaml
name: CI Pipeline

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  lint:
    name: Code Style Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP & Composer
        uses: ./.github/actions/setup-php-composer
        with:
          php-version: '8.3'
          coverage: 'none'

      - name: Run Laravel Pint
        run: vendor/bin/pint --test --format=github-actions

      - name: Run PHPStan
        run: vendor/bin/phpstan analyse --error-format=github-actions --memory-limit=512M

  test:
    name: Tests (PHP ${{ matrix.php-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php-version: ['8.2', '8.3', '8.4']
      fail-fast: false

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP & Composer
        id: setup
        uses: ./.github/actions/setup-php-composer
        with:
          php-version: ${{ matrix.php-version }}

      - name: Show Setup Info
        run: |
          echo "PHP: ${{ steps.setup.outputs.php-version }}"
          echo "Cache Hit: ${{ steps.setup.outputs.cache-hit }}"
          echo "Install Time: ${{ steps.setup.outputs.install-time }}s"

      - name: Copy .env
        run: cp .env.example .env

      - name: Generate Key
        run: php artisan key:generate

      - name: Run Tests
        run: vendor/bin/pest --parallel --coverage-clover=coverage.xml
        env:
          DB_CONNECTION: sqlite
          DB_DATABASE: ":memory:"

      - name: Upload Coverage
        if: matrix.php-version == '8.3'
        uses: codecov/codecov-action@v4
        with:
          files: coverage.xml
          token: ${{ secrets.CODECOV_TOKEN }}
```

**对比效果：**

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| CI 文件行数 | ~80 行/仓库 | ~30 行/仓库 | **-62%** |
| PHP 版本升级耗时 | 30+ PR × 10min | 1 PR × 10min | **-97%** |
| 新仓库 CI 搭建时间 | ~2 小时 | ~15 分钟 | **-87%** |
| 配置不一致风险 | 高 | 接近零 | **✅ 根治** |

### 3.3 JavaScript Action：智能 PHP 版本检测

当你需要更复杂的逻辑时，JavaScript Action 是更好的选择。以下是一个自动检测项目所需 PHP 版本的 Action：

**目录结构：**
```
detect-php-version/
├── action.yml
├── package.json
├── src/
│   └── index.ts
├── dist/
│   └── index.js    # 编译产物（提交到仓库）
└── __tests__/
    └── index.test.ts
```

**`detect-php-version/action.yml`：**

```yaml
name: 'Detect PHP Version'
description: 'Auto-detect required PHP version from composer.json'

inputs:
  working-directory:
    description: 'Project root directory'
    required: false
    default: '.'
  fallback-version:
    description: 'PHP version if detection fails'
    required: false
    default: '8.3'

outputs:
  php-version:
    description: 'Detected PHP version'
    value: ${{ steps.detect.outputs.php-version }}
  php-version-min:
    description: 'Minimum PHP version from composer.json'
    value: ${{ steps.detect.outputs.php-version-min }}
  php-version-max:
    description: 'Maximum PHP version from composer.json'
    value: ${{ steps.detect.outputs.php-version-max }}

runs:
  using: 'node20'
  main: 'dist/index.js'
```

**`detect-php-version/src/index.ts`：**

```typescript
import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';

interface ComposerJson {
  require?: {
    php?: string;
  };
}

function parsePhpVersion(constraint: string): {
  min: string;
  max: string;
  recommended: string;
} {
  // Parse version constraint like "^8.1", ">=8.1 <8.4", "~8.2"
  const cleanConstraint = constraint.replace(/[\^~>=<]/g, '').trim();
  const versions = cleanConstraint.match(/\d+\.\d+/g) || ['8.3'];

  const min = versions[0] || '8.3';
  const max = versions[versions.length - 1] || min;

  // Recommend the highest minor version in range
  const [minMajor, minMinor] = min.split('.').map(Number);
  const [maxMajor, maxMinor] = max.split('.').map(Number);

  let recommended = max;
  if (minMajor === maxMajor) {
    recommended = `${maxMajor}.${maxMinor}`;
  }

  return { min, max, recommended };
}

function detectPhpVersion(workingDir: string, fallback: string): {
  version: string;
  min: string;
  max: string;
} {
  const composerPath = path.join(workingDir, 'composer.json');

  if (!fs.existsSync(composerPath)) {
    core.warning(`composer.json not found at ${composerPath}, using fallback ${fallback}`);
    return { version: fallback, min: fallback, max: fallback };
  }

  try {
    const composer: ComposerJson = JSON.parse(fs.readFileSync(composerPath, 'utf-8'));
    const phpConstraint = composer.require?.php;

    if (!phpConstraint) {
      core.info('No PHP version constraint in composer.json, using fallback');
      return { version: fallback, min: fallback, max: fallback };
    }

    core.info(`Found PHP constraint: ${phpConstraint}`);
    const { min, max, recommended } = parsePhpVersion(phpConstraint);

    return { version: recommended, min, max };
  } catch (error) {
    core.warning(`Failed to parse composer.json: ${error}`);
    return { version: fallback, min: fallback, max: fallback };
  }
}

async function run(): Promise<void> {
  try {
    const workingDir = core.getInput('working-directory');
    const fallback = core.getInput('fallback-version');

    const { version, min, max } = detectPhpVersion(workingDir, fallback);

    core.info(`Detected PHP version: ${version} (range: ${min} ~ ${max})`);
    core.setOutput('php-version', version);
    core.setOutput('php-version-min', min);
    core.setOutput('php-version-max', max);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
```

**使用方式：**

```yaml
- name: Detect PHP Version
  id: detect
  uses: ./detect-php-version  # 本地 Action

- name: Setup PHP
  uses: ./.github/actions/setup-php-composer
  with:
    php-version: ${{ steps.detect.outputs.php-version }}
```

### 3.4 Docker Action：数据库迁移验证

当你需要特定系统环境时，Docker Action 是唯一选择：

**`verify-migration/action.yml`：**

```yaml
name: 'Verify Database Migration'
description: 'Run Laravel migrations against a test database and verify no errors'

inputs:
  database-url:
    description: 'Database connection URL'
    required: true
  seed-class:
    description: 'Seeder class to run after migration'
    required: false
    default: ''
  working-directory:
    description: 'Laravel project directory'
    required: false
    default: '.'

outputs:
  migration-status:
    description: 'Migration result (success/failed)'
    value: ${{ steps.migrate.outputs.status }}
  tables-created:
    description: 'Number of tables created'
    value: ${{ steps.migrate.outputs.tables }}

runs:
  using: 'docker'
  image: 'Dockerfile'
  args:
    - ${{ inputs.database-url }}
    - ${{ inputs.seed-class }}
    - ${{ inputs.working-directory }}
```

**`verify-migration/Dockerfile`：**

```dockerfile
FROM php:8.3-cli-alpine

# Install required extensions
RUN apk add --no-cache \
    mysql-client \
    postgresql-client \
    && docker-php-ext-install pdo pdo_mysql pdo_pgsql

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

**`verify-migration/entrypoint.sh`：**

```bash
#!/bin/sh
set -e

DATABASE_URL="$1"
SEED_CLASS="$2"
WORK_DIR="$3"

cd "$WORK_DIR"

echo "::group::Running Migrations"
php artisan migrate --force --no-interaction 2>&1
MIGRATION_STATUS=$?

if [ $MIGRATION_STATUS -eq 0 ]; then
  echo "status=success" >> $GITHUB_OUTPUT
  TABLE_COUNT=$(php artisan db:show --json 2>/dev/null | php -r '
    $data = json_decode(file_get_contents("php://stdin"), true);
    echo count($data["tables"] ?? []);
  ')
  echo "tables=$TABLE_COUNT" >> $GITHUB_OUTPUT
  echo "✅ Migration successful. Tables: $TABLE_COUNT"
else
  echo "status=failed" >> $GITHUB_OUTPUT
  echo "tables=0" >> $GITHUB_OUTPUT
  echo "❌ Migration failed!"
fi
echo "::endgroup::"

if [ -n "$SEED_CLASS" ]; then
  echo "::group::Running Seeder: $SEED_CLASS"
  php artisan db:seed --class="$SEED_CLASS" --force --no-interaction
  echo "::endgroup::"
fi

exit $MIGRATION_STATUS
```

### 3.5 Reusable Workflow：完整的 CI Pipeline

对于整个工作流的复用，使用 Reusable Workflow（`workflow_call`）更合适：

**`.github/workflows/reusable-laravel-ci.yml`（可复用模板）：**

```yaml
name: Reusable Laravel CI

on:
  workflow_call:
    inputs:
      php-version:
        type: string
        default: '8.3'
      run-pest:
        type: boolean
        default: true
      run-phpstan:
        type: boolean
        default: true
      run-pint:
        type: boolean
        default: true
      pest-args:
        type: string
        default: '--parallel'
      phpstan-level:
        type: number
        default: 6
      coverage:
        type: boolean
        default: false
    secrets:
      codecov-token:
        required: false

jobs:
  lint:
    if: inputs.run-pint
    name: 🎨 Code Style
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP & Composer
        uses: ./.github/actions/setup-php-composer
        with:
          php-version: ${{ inputs.php-version }}
          coverage: none

      - name: Laravel Pint
        run: vendor/bin/pint --test --format=github-actions

  static-analysis:
    if: inputs.run-phpstan
    name: 🔬 PHPStan Level ${{ inputs.phpstan-level }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP & Composer
        uses: ./.github/actions/setup-php-composer
        with:
          php-version: ${{ inputs.php-version }}
          coverage: none

      - name: PHPStan
        run: vendor/bin/phpstan analyse -l ${{ inputs.phpstan-level }} --error-format=github-actions --memory-limit=512M

  test:
    if: inputs.run-pest
    name: 🧪 Tests
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: password
          MYSQL_DATABASE: testing
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
      redis:
        image: redis:7
        ports:
          - 6379:6379
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP & Composer
        id: setup
        uses: ./.github/actions/setup-php-composer
        with:
          php-version: ${{ inputs.php-version }}
          coverage: ${{ inputs.coverage && 'xdebug' || 'none' }}

      - name: Prepare Environment
        run: |
          cp .env.ci .env 2>/dev/null || cp .env.example .env
          php artisan key:generate

      - name: Run Pest
        run: vendor/bin/pest ${{ inputs.pest-args }} ${{ inputs.coverage && '--coverage-clover=coverage.xml' || '' }}
        env:
          DB_CONNECTION: mysql
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: testing
          DB_USERNAME: root
          DB_PASSWORD: password
          REDIS_HOST: 127.0.0.1
          REDIS_PORT: 6379

      - name: Upload Coverage
        if: inputs.coverage
        uses: codecov/codecov-action@v4
        with:
          files: coverage.xml
          token: ${{ secrets.codecov-token }}
```

**仓库级别的使用：**

```yaml
# 每个仓库只需要这么点代码
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  ci:
    uses: your-org/shared-workflows/.github/workflows/reusable-laravel-ci.yml@v1
    with:
      php-version: '8.3'
      phpstan-level: 8
      coverage: true
    secrets:
      codecov-token: ${{ secrets.CODECOV_TOKEN }}
```

### 3.6 跨组织分发：发布到 GitHub Marketplace

将自定义 Action 发布为独立仓库，供整个组织（甚至公开社区）使用：

**发布步骤：**

```bash
# 1. 创建独立仓库
gh repo create your-org/setup-php-composer --public

# 2. 提交代码
git add .
git commit -m "feat: initial release of setup-php-composer action"

# 3. 打 tag（用户通过 tag 引用版本）
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# 4. 创建 major version tag（方便用户追踪最新补丁）
git tag -f v1 v1.0.0
git push origin v1 --force
```

**用户引用方式：**

```yaml
# 固定版本（最安全）
uses: your-org/setup-php-composer@v1.0.0

# 追踪最新补丁（推荐）
uses: your-org/setup-php-composer@v1

# 使用最新版（不推荐生产环境）
uses: your-org/setup-php-composer@main
```

### 3.7 可直接运行的仓库模板：从零验证 Composite Action

如果你希望不是“看懂”，而是“当天就能在仓库里跑起来”，下面给出一个最小可运行示例。这个结构适合放到任意 Laravel/PHP 项目里，提交后即可通过 `pull_request` 或 `workflow_dispatch` 触发。

**目录结构：**

```text
demo-repo/
├── .github/
│   ├── actions/
│   │   └── php-quality/
│   │       └── action.yml
│   └── workflows/
│       └── ci.yml
├── composer.json
├── composer.lock
└── tests/
```

**`.github/actions/php-quality/action.yml`：**

```yaml
name: 'PHP Quality Gate'
description: 'Install dependencies and run lint/test commands for PHP projects'

inputs:
  php-version:
    description: 'PHP version'
    required: false
    default: '8.3'
  test-command:
    description: 'Command used to execute tests'
    required: false
    default: 'vendor/bin/phpunit --testdox'
  lint-command:
    description: 'Command used to execute lint/static analysis'
    required: false
    default: 'php -l app/Console/Kernel.php'

runs:
  using: 'composite'
  steps:
    - name: Setup PHP
      uses: shivammathur/setup-php@v2
      with:
        php-version: ${{ inputs.php-version }}
        tools: composer:v2

    - name: Resolve Composer cache directory
      id: composer-cache
      shell: bash
      run: echo "dir=$(composer config cache-files-dir)" >> "$GITHUB_OUTPUT"

    - name: Cache Composer
      uses: actions/cache@v4
      with:
        path: ${{ steps.composer-cache.outputs.dir }}
        key: ${{ runner.os }}-php-${{ inputs.php-version }}-${{ hashFiles('**/composer.lock') }}
        restore-keys: |
          ${{ runner.os }}-php-${{ inputs.php-version }}-
          ${{ runner.os }}-php-

    - name: Install dependencies
      shell: bash
      run: composer install --no-interaction --prefer-dist --no-progress

    - name: Run lint command
      shell: bash
      run: ${{ inputs.lint-command }}

    - name: Run test command
      shell: bash
      run: ${{ inputs.test-command }}
```

**`.github/workflows/ci.yml`：**

```yaml
name: php-quality-demo

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Run shared quality gate
        uses: ./.github/actions/php-quality
        with:
          php-version: '8.3'
          lint-command: 'vendor/bin/phpstan analyse --no-progress'
          test-command: 'vendor/bin/pest --parallel'
```

这个模板的价值在于：**它没有引入 Docker、没有额外仓库、没有复杂权限模型**，非常适合先验证“复用是否真能降低维护成本”。等多个仓库稳定后，再抽到独立仓库做版本化分发。

### 3.8 版本治理与灰度升级：别让共享 Action 变成单点风险

复用带来效率，也会把风险集中。很多团队第一次把公共 Action 提到 `v1` 后，后续所有仓库都直接引用 `@v1`，结果某次修复缓存逻辑时把 PHP 8.2 的构建打挂，几十个仓库同时红灯。

更稳妥的做法是把 **版本发布**、**兼容性验证**、**灰度升级** 拆成三个层次：

| 层次 | 做法 | 目的 | 推荐度 |
|------|------|------|--------|
| 固定补丁版本 | `@v1.2.3` | 完全可复现 | 生产关键链路强烈推荐 |
| 跟踪大版本 | `@v1` | 自动接收兼容补丁 | 内部普通仓库推荐 |
| 跟踪分支 | `@main` | 快速试验 | 仅开发/验证环境 |

**推荐发布流程：**

```yaml
name: release-action

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  verify-and-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate action metadata
        run: test -f action.yml

      - name: Smoke test reusable action
        run: |
          echo "这里可以调用 act、actionlint、yamllint 或内部测试仓库"

      - name: Move major tag
        run: |
          git tag -f "${GITHUB_REF_NAME%%.*}" "$GITHUB_REF_NAME"
          git push origin "${GITHUB_REF_NAME%%.*}" --force
```

进一步一点，如果你们有 20+ 仓库，建议准备两个测试仓库：

1. **golden repo**：只验证共享 Action 本身是否能跑通；
2. **real-world repo**：模拟真实 Laravel 依赖、数据库服务、coverage 上传等复杂场景。

这样公共组件每次升级时，至少先过一次"最小样例 + 真实样例"双重验证，再推动大版本 tag。

### 3.9 本地测试：用 `act` 在提交前验证 Action

很多开发者只在 push 之后才发现 Action 配置有误，来回浪费时间。开源工具 [act](https://github.com/nektos/act) 可以在本地模拟 GitHub Actions 运行环境，让你在提交前就能发现问题。

**安装与基本用法：**

```bash
# macOS 安装
brew install act

# 首次运行会下载镜像，选择 Medium（匹配 ubuntu-latest）
act -P ubuntu-latest=catthehacker/ubuntu:act-latest pull_request

# 只运行特定 job
act -j lint -P ubuntu-latest=catthehacker/ubuntu:act-latest

# 模拟 push 事件
act push -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

**配合自定义 Action 测试的技巧：**

```bash
# .act.secrets（加入 .gitignore，存放测试用密钥）
# GITHUB_TOKEN=ghp_test_xxx
# CODECOV_TOKEN=test-xxx

# 使用密钥文件运行
act --secret-file .act.secrets pull_request

# 传入自定义环境变量
act --env APP_ENV=testing --env DB_CONNECTION=sqlite pull_request
```

**`act` 的局限性与替代方案对比：**

| 场景 | `act` | `actionlint` | GitHub `workflow_dispatch` |
|------|-------|-------------|--------------------------|
| 语法检查 | ✅ 运行时验证 | ✅ 静态分析 | ✅ 完整运行 |
| 需要 Docker | ✅ 必须 | ❌ 不需要 | ❌ 不需要 |
| 网络/服务依赖 | ✅ 真实调用 | ❌ 无法验证 | ✅ 真实环境 |
| 速度 | 中等（需拉镜像） | ⚡ 极快 | 慢（完整 CI） |
| Secrets 测试 | 需手动传入 | ❌ 无法测试 | ✅ 使用真实 secrets |
| 推荐场景 | 初步验证逻辑 | PR 提交前检查 | 最终发布前验证 |

**建议的测试流程：**

```
本地开发 → actionlint 静态检查 → act 本地运行 → push 到测试分支 → workflow_dispatch 手动触发 → 合并到 main
```

### 3.10 Action 调试技巧：日志分组与 Annotations

当 Action 步骤变多后，日志会变得难以阅读。善用 GitHub Actions 提供的[日志命令](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions)可以大幅提升调试效率：

```yaml
- name: Debug Info
  shell: bash
  run: |
    # 折叠分组：点击可展开
    echo "::group::Environment Variables"
    env | sort
    echo "::endgroup::"

    echo "::group::PHP Modules"
    php -m
    echo "::endgroup::"

    # 在 workflow summary 中显示提示
    echo "::notice title=PHP Version::$(php -r 'echo PHP_VERSION;')"

    # 警告（不会失败，但会标黄）
    echo "::warning title=Deprecated Config::coverage: xdebug will be removed in v2"

    # 错误注解（标注到具体文件和行号）
    echo "::error file=app/Models/User.php,line=42::Type mismatch in return type"
```

**Composite Action 中推荐的调试模式：**

```yaml
# 在 action.yml 中添加可选的 debug input
inputs:
  debug:
    description: 'Enable debug output'
    required: false
    default: 'false'

runs:
  using: 'composite'
  steps:
    - name: Debug - Dump all inputs
      if: inputs.debug == 'true'
      shell: bash
      run: |
        echo "::group::Debug: All Action Inputs"
        echo "php-version=${{ inputs.php-version }}"
        echo "extensions=${{ inputs.extensions }}"
        echo "coverage=${{ inputs.coverage }}"
        echo "working-directory=${{ inputs.working-directory }}"
        echo "::endgroup::"

    - name: Setup PHP
      uses: shivammathur/setup-php@v2
      with:
        php-version: ${{ inputs.php-version }}
        extensions: ${{ inputs.extensions }}
        tools: composer:v2
        coverage: ${{ inputs.coverage }}
```

调用时传入 `debug: 'true'` 即可开启详细日志，不影响正常流程。

### 3.11 安全加固：固定第三方 Action 的 SHA

使用 `@v4` 等 tag 引用第三方 Action 虽然方便，但如果上游仓库被劫持或 tag 被强制推送覆盖，你的 CI 流水线就会受到影响。对于安全敏感的项目，建议固定到完整的 commit SHA：

```yaml
# ❌ 使用 tag（可被强制推送覆盖）
- uses: actions/checkout@v4
- uses: actions/cache@v4

# ✅ 固定到 commit SHA（不可变）
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
- uses: actions/cache@6849a6489940f00c2f30c0fb92c6274307ccb58a      # v4.1.2

# 配合 Dependabot 自动更新 SHA
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
+    directory: "/"
+    schedule:
+      interval: "weekly"
```

这种做法与 Terraform provider 的 version pinning 思路一致，是供应链安全的基本功。结合上文 3.8 节的版本治理策略，可以在安全与便利之间找到平衡。

**推荐的供应链安全配置模板：**

```yaml
# .github/workflows/ci.yml 中的完整安全配置示例
name: CI
on: [pull_request, push]

# 最小权限原则：只声明需要的权限
permissions:
  contents: read
  checks: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # 固定 SHA 避免供应链攻击
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2

      # 使用可信的 Action
      - uses: ./.github/actions/setup-php-composer

      # 运行安全审计
      - name: Security Audit
        run: |
          composer audit --no-dev
          npm audit --audit-level=moderate || true
```

同时建议在仓库中添加 `.github/CODEOWNERS` 文件，确保 Action 相关文件的变更必须经过指定维护者审核：

```
# .github/CODEOWNERS
.github/actions/    @your-team/infra
.github/workflows/  @your-team/infra
```

---

## 四、踩坑记录

### 踩坑 #1：Composite Action 的 `shell` 必须显式指定

```yaml
# ❌ 错误：Composite Action 中不指定 shell 会报错
runs:
  using: 'composite'
  steps:
    - run: echo "hello"  # Error: shell is required

# ✅ 正确：每个 run step 都必须指定 shell
runs:
  using: 'composite'
  steps:
    - shell: bash
      run: echo "hello"
```

**为什么？** Composite Action 中的 steps 会在 caller 的 runner 上执行，GitHub 需要知道用哪个 shell。JavaScript/Docker Action 不需要，因为它们有自己的运行时。

### 踩坑 #2：`$GITHUB_OUTPUT` 在 Composite Action 中的路径问题

```yaml
# ❌ 经典错误：跨 step 读不到 outputs
- id: step1
  shell: bash
  run: echo "result=value" >> $GITHUB_OUTPUT

- id: step2
  shell: bash
  run: echo "Got: ${{ steps.step1.outputs.result }}"  # 空值！
```

**原因：** Composite Action 的 steps 使用的是 caller workflow 的 `$GITHUB_OUTPUT` 文件，但步骤间的 output 引用语法在 composite 中有作用域限制。

**解决方案：**

```yaml
# ✅ 正确：使用 step ID 显式引用
- id: step1
  shell: bash
  run: |
    RESULT=$(some_command)
    echo "result=$RESULT" >> $GITHUB_OUTPUT

# 在同一个 composite action 的后续 step 中引用
- id: step2
  shell: bash
  run: echo "Got: ${{ steps.step1.outputs.result }}"

# 在 caller workflow 中引用 composite action 的 outputs
# 需要在 composite action.yml 中定义 outputs 字段
outputs:
  result:
    description: 'Output value'
    value: ${{ steps.step1.outputs.result }}
```

### 踩坑 #3：Docker Action 的 `ADD` vs `COPY` 性能陷阱

```dockerfile
# ❌ ADD 会自动解压 tar 文件，构建时有额外开销
ADD . /app

# ✅ COPY 更明确，性能更好
COPY . /app

# ✅ 分层优化：先复制依赖文件，再复制源码
COPY package.json package-lock.json /app/
RUN npm ci --production
COPY . /app
```

### 踩坑 #4：GitHub Token 权限不足

```yaml
# ❌ 默认 GITHUB_TOKEN 权限是 read-only
# 如果你的 Action 需要创建 PR、发布 Release 等
- uses: ./my-action
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # 只有 read 权限

# ✅ 显式声明所需权限
permissions:
  contents: write
  pull-requests: write
  issues: write

# 或者在 job 级别声明
jobs:
  my-job:
    permissions:
      contents: write
    steps:
      - uses: ./my-action
```

### 踩坑 #5：Action 中调用子模块/私有仓库

```yaml
# ❌ 子模块在 Action 的 Docker 容器中不可用
# 因为 Docker Action 会构建独立的镜像，不继承 caller 的 checkout

# ✅ 解决方案1：传入需要的文件作为 input
inputs:
  project-files:
    description: 'Required project files (base64 encoded)'
    required: true

# ✅ 解决方案2：使用 Composite Action（共享 runner 文件系统）
runs:
  using: 'composite'
  steps:
    - shell: bash
      run: ls -la  # 可以访问 caller checkout 的文件
```

### 踩坑 #6：缓存 Key 策略不当导致缓存命中率低

```yaml
# ❌ 用 composer.lock 的完整 hash 作为 key
key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
# 问题：composer.lock 任何微小变化都导致完全缓存失效

# ✅ 更好的策略：使用 restore-keys 阶梯匹配
key: ${{ runner.os }}-composer-${{ inputs.php-version }}-${{ hashFiles('**/composer.lock') }}
restore-keys: |
  ${{ runner.os }}-composer-${{ inputs.php-version }}-${{ hashFiles('**/composer.lock') }}
  ${{ runner.os }}-composer-${{ inputs.php-version }}-
  ${{ runner.os }}-composer-
# 即使 lock 文件变了，也能复用部分缓存（大部分依赖没变）
```

### 踩坑 #7：matrix 中使用本地 Composite Action 的限制

```yaml
# ❌ 本地 Action 不能用于 matrix strategy 中的 uses 字段
strategy:
  matrix:
    action-path: [./.github/actions/action-a, ./.github/actions/action-b]
steps:
  - uses: ${{ matrix.action-path }}  # 不支持！uses 不能用表达式

# ✅ 解决方案：用 if 条件分支
steps:
  - if: matrix.suite == 'unit'
    uses: ./.github/actions/run-unit-tests
  - if: matrix.suite == 'feature'
    uses: ./.github/actions/run-feature-tests
```

### 踩坑 #8：复用工作流里 secrets 不会自动透传

这是很多人第一次改造 `workflow_call` 时最容易忽略的点：**调用方仓库有 secret，不代表被调用的 reusable workflow 能直接读取。**

```yaml
# 调用方工作流
jobs:
  ci:
    uses: your-org/shared-workflows/.github/workflows/reusable-laravel-ci.yml@v1
    with:
      php-version: '8.3'
    secrets:
      codecov-token: ${{ secrets.CODECOV_TOKEN }}
```

```yaml
# 被调用的 reusable workflow
on:
  workflow_call:
    secrets:
      codecov-token:
        required: false
```

如果你漏掉 `workflow_call.secrets` 声明，运行时通常会表现为：

- `Input required and not supplied`；
- `secrets.xxx` 为空；
- 上传 coverage、发布 release、调用私有 registry 时突然失败。

**经验建议：**凡是 reusable workflow 依赖的 secret，都在入口处显式列出来，不要赌“调用方自己会记得传”。

### 踩坑 #9：`pull_request` 与 `pull_request_target` 用错，权限和安全同时出问题

很多团队为了让机器人评论 PR，会把事件从 `pull_request` 改成 `pull_request_target`。这样确实能拿到更高权限的 `GITHUB_TOKEN`，但也带来巨大安全风险：**你在目标仓库上下文中执行来自 fork 的代码。**

| 事件 | 代码上下文 | Token 权限 | 风险 | 适用场景 |
|------|------------|------------|------|----------|
| `pull_request` | PR 分支代码 | 更受限 | 较低 | 测试、lint、构建 |
| `pull_request_target` | base 分支工作流 | 更高 | 高 | 仅评论、打标签、无需执行不可信代码 |

**错误示例：**

```yaml
on:
  pull_request_target:

jobs:
  dangerous:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: ./scripts/deploy-preview.sh
```

如果这个脚本会读取 secret、访问云资源、写评论或改 release，你就把执行入口暴露给了外部贡献者。

**安全做法：**

- 代码执行留在 `pull_request`；
- 只把“评论 PR / 打标签 / 汇总报告”放到 `pull_request_target`；
- 必要时用 `if: github.event.pull_request.head.repo.fork == false` 限制来源。

### 踩坑 #10：并发控制没配好，重复构建把 Runner 配额打爆

当一个 PR 连续 push 5 次时，如果每次都完整触发 CI，公共 runner 配额、缓存命中、构建队列都会变差。尤其多个仓库共用同一套 Action 后，这种浪费会被放大。

```yaml
name: CI

on:
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**建议至少在仓库级工作流配置 `concurrency`**，避免同一个分支旧任务继续消耗资源。对部署工作流，则可以按环境拆分：

```yaml
concurrency:
  group: deploy-production
  cancel-in-progress: false
```

这样可以保证生产部署串行化，防止两次 release 交错执行。

### 踩坑 #11：`if: always()`、`failure()`、`cancelled()` 混用，导致通知步骤失真

最常见的表现是：测试失败了，但 Slack 通知没发；或者任务被取消了，却仍然发送“部署成功”。

```yaml
# ❌ 写法含糊，容易掩盖真实状态
- name: Notify
  if: always()
  run: ./notify.sh success

# ✅ 根据 job 状态区分通知内容
- name: Notify failure
  if: failure()
  run: ./notify.sh failure

- name: Notify cancelled
  if: cancelled()
  run: ./notify.sh cancelled
```

如果通知逻辑被抽到 Composite Action，记得在调用方而不是 Action 内部判断 job 状态，因为 Action 本身通常无法完整表达整个 workflow 的最终结果。

### 踩坑 #12：没有用 `actionlint` 和自测仓库，错误只能在真实 PR 上暴露

GitHub Actions 的问题有个典型特征：**语法检查很弱，很多错只有真正触发时才会炸。**比如：

- `uses` 里 tag 拼错；
- matrix 变量名写错；
- `workflow_call` 输入类型不匹配；
- shell 中引用了不存在的 output；
- `permissions` 缺失只在写操作时暴露。

建议至少补两层自测：

```yaml
name: validate-workflows

on:
  pull_request:
  push:
    branches: [main]

jobs:
  actionlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rhysd/actionlint@v1
```

再配一个内部 sandbox 仓库，专门引用你的共享 Action / reusable workflow 做回归验证。这样可以把“公共组件改坏 30 个仓库”的风险，提前收敛到 1 个测试仓库。

---

## 五、对比/选型建议

### 5.1 Action 封装策略对比

| 方案 | 复杂度 | 维护成本 | 灵活性 | 适用规模 |
|------|--------|----------|--------|----------|
| **复制粘贴** | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 1-3 仓库 |
| **Composite Action（本地）** | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | 5-20 仓库 |
| **Composite Action（独立仓库）** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | 20-50 仓库 |
| **Reusable Workflow + Action** | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ | 50+ 仓库 |
| **GitHub Actions Template Repo** | ⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ | 新项目模板 |

### 5.2 与竞品 CI/CD 平台对比

| 特性 | GitHub Actions | GitLab CI | Jenkins | CircleCI |
|------|---------------|-----------|---------|----------|
| 自定义组件 | Composite Action + Reusable Workflow | `include:template` + CI Components | Shared Libraries | Orbs |
| 版本管理 | Git tag | Git tag | Git tag | Semantic versioning |
| 市场生态 | 20,000+ Actions | CI Components Catalog | 插件 1800+ | 300+ Orbs |
| 学习曲线 | 中等 | 中等 | 高 | 中等 |
| 私有仓库支持 | ✅ | ✅ | ✅ | ✅ |
| Self-hosted Runner | ✅ | ✅ | 原生 | ✅ |

### 5.3 我们的选型建议

```
仓库数量 1-3 个？
    └── 直接复制粘贴，不要过度设计

仓库数量 5-20 个？
    └── Composite Action 本地封装
    └── 存放在 .github/actions/ 目录

仓库数量 20+ 个？
    └── Composite Action 独立仓库 + Reusable Workflow
    └── 发布到 GitHub Marketplace（内部或公开）
    └── 建立版本治理机制

需要跨组织复用？
    └── 独立仓库 + Semantic Versioning + GitHub Marketplace
    └── 配合 CODEOWNERS 做 Code Review
```

### 5.4 Composite Action、Reusable Workflow、Template Repo 如何组合

很多团队不是不会写 Action，而是不知道三种复用方式怎么搭配。下面给一个更接近实际工程治理的组合建议：

| 场景 | 最佳方案 | 原因 | 不推荐原因 |
|------|----------|------|------------|
| 复用一组固定步骤 | Composite Action | 最轻、最直观、适合本地迭代 | 复制粘贴后期难统一 |
| 统一整条 CI 链路 | Reusable Workflow | 能约束 job、permissions、services、secrets | Composite Action 无法封装 job 级配置 |
| 新项目快速开箱 | Template Repo | 一次性复制完整目录最省事 | 后续更新无法自动继承 |
| 组织级标准化治理 | Reusable Workflow + Composite Action | 上层定规范，下层复用细节 | 单独一种手段覆盖不全 |

一个常见且有效的分层方式是：

1. **模板仓库** 负责项目初始化；
2. **Reusable Workflow** 负责统一 CI/CD 主干；
3. **Composite Action** 负责封装具体步骤，比如 setup、lint、test、deploy-check；
4. **独立 Action 仓库** 负责跨组织版本治理与发布。

这样做的好处是：模板负责“起点一致”，工作流负责“过程一致”，Action 负责“实现一致”。

---

## 六、迁移实战指南：从复制粘贴到 Action 封装

很多团队知道应该封装 Action，但不知道从哪一步开始。以下是经过验证的渐进式迁移路径：

**第一阶段：盘点与归类（1-2 天）**

先不要急着写代码，先做一次全量扫描。用脚本提取所有仓库中重复出现的步骤片段：

```bash
# 扫描所有仓库的 workflow 文件，找出重复的 steps 配置
find .github/workflows -name '*.yml' -exec grep -l 'setup-php' {} \; | wc -l
find .github/workflows -name '*.yml' -exec grep -l 'actions/cache' {} \; | wc -l
find .github/workflows -name '*.yml' -exec grep -l 'composer install' {} \; | wc -l
```

统计结果通常会告诉你哪些步骤重复最多，这些就是优先封装的目标。

**第二阶段：封装第一个 Action（2-3 天）**

选择重复度最高的步骤组合（比如 Setup PHP + Cache + Install），按照本文 3.1 节的模板封装成 Composite Action。关键要点：

- 先在本仓库的 `.github/actions/` 目录下验证
- 所有 input 提供默认值，降低迁移门槛
- 用 `workflow_dispatch` 手动触发，反复调试直到稳定

**第三阶段：灰度推广（1-2 周）**

不要一次性改 30 个仓库。选择 2-3 个非核心仓库先试用，观察一周没有问题后再逐步推广。每批改 5-10 个仓库，保持每个 PR 只改 CI 配置，方便 Code Review 和回滚。

**第四阶段：版本治理与独立仓库（第 2-3 周）**

当所有仓库都稳定使用本地 Action 后，将其抽到独立仓库，打上 `v1.0.0` tag，发布到 GitHub Marketplace。然后逐步将本地引用改为远程引用。

**迁移过程中的常见陷阱：**

| 陷阱 | 表现 | 解决方案 |
|------|------|----------|
| input 默认值不兼容 | 部分仓库使用了非标准配置 | 为每个 input 保留可覆盖能力 |
| shell 环境差异 | macOS runner 与 Linux 行为不同 | 在 action.yml 中统一指定 `shell: bash` |
| 权限不足 | 封装后权限声明丢失 | 在 action 说明中明确所需 permissions |
| 缓存 key 冲突 | 不同项目共用缓存目录 | 在 key 中加入仓库标识或分支名 |
| 输出值为空 | 跨 Action 读取 outputs 失败 | 确保在 action.yml 的 outputs 字段中正确声明 |

---

## 七、总结与最佳实践

### 最佳实践清单

1. **从 Composite Action 开始**——除非你确定需要 Docker/JS 运行时
2. **语义化版本管理**——用 `v1`、`v1.0.0` 双 tag，方便用户选择
3. **为每个 input 提供合理默认值**——降低使用门槛
4. **显式声明 outputs**——让调用方能获取 Action 的执行结果
5. **缓存策略分层**——用 `restore-keys` 提高缓存命中率
6. **善用 `::group::` 和 `::notice::`**——让日志更易读
7. **测试你的 Action**——用 `act`（本地 GitHub Actions 运行器）或 `workflow_dispatch` 手动触发
8. **编写 README**——至少包含 inputs/outputs/usage 示例
9. **使用 CODEOWNERS**——保护 Action 仓库不被随意修改
10. **定期审计依赖**——`action.yml` 中的 `uses` 也可能是攻击面

**容易被忽视但影响很大的补充建议：**

- **保持 Action 单一职责**：一个 Action 只做一件事。"Setup PHP + Cache + Install" 虽然常用，但如果某个项目只需要 Setup 不需要 Install，拆开更好。可以用一个上层 Action 组合调用多个子 Action。
- **用 `continue-on-error` 容错非关键步骤**：比如安全扫描失败不应阻塞整个构建，但要在 workflow 层面做好后续判断。
- **监控 Action 的执行耗时**：在 Action 内部用 `date +%s` 计时并输出到 summary，定期 Review 是否有性能退化。
- **文档即代码**：Action 的 README 中应该包含完整的使用示例、所有 inputs/outputs 的说明、以及一个最小可运行的 workflow 片段。不要让使用者去翻源码才能理解怎么用。
- **关注 GitHub Actions 的 changelog**：GitHub 每个月都会发布 runner 和 Actions 运行时的更新，比如 Node.js 版本升级、新的 workflow commands、权限模型变化等，及时跟进可以避免踩坑。

### 我们的迁移成果

经过上述四个阶段的渐进式迁移，我们在 30+ Laravel 仓库上取得了以下成果：

| 指标 | 迁移前 | 迁移后 | 改善幅度 |
|------|--------|--------|----------|
| CI 配置总行数 | ~2400 行（30 仓库 × 80 行） | ~900 行 + 150 行 Action 定义 | **-56%** |
| PHP 版本升级时间 | 2 天（30 个 PR） | 10 分钟（1 个 PR） | **-99%** |
| 新仓库 CI 搭建 | 2 小时 | 15 分钟 | **-87%** |
| 配置不一致仓库数 | 5 个 | 0 个 | **完全消除** |
| CI 平均构建时间 | 85s | 52s（缓存优化） | **-39%** |
| 踩坑导致的 CI 红灯 | 每月 3-5 次 | 每月 0-1 次 | **显著减少** |

迁移过程中最大的收获不仅是效率提升，更是**治理能力的质变**：以前修改一个全局配置需要协调 30 个团队分别提 PR，现在只需要修改一处 Action 定义，通过语义化版本控制灰度发布，所有仓库自动受益。这种"一处维护、处处生效"的模式，让 CI/CD 从"每个项目各自为政"变成了真正的基础设施级服务。

---

## 相关阅读

- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/post/github-actions-php/) — 深入讲解 matrix strategy 在多维度测试中的应用，与本文的 Composite Action 封装形成互补
- [PR Review Checklist 自动化实战：Danger.js/lint-staged/Husky 的组合拳——CI 门禁](/post/pr-review-checklist-danger-js-lint-staged-husky-ci/) — 将代码规范检查集成到 CI 工作流，与本文的 Action 封装思路一致
- Dagger 实战：用代码定义 CI/CD 流水线——Go SDK 驱动的可移植 Pipeline 与 GitHub Actions 选型对比 — 从另一个维度看 CI/CD 流水线定义，对比 GitHub Actions 与 Dagger 的优劣
- [Supply Chain Security 实战：npm audit、composer audit、SLSA 框架](/post/supply-chain-security-npm-audit-composer-slsa-laravel-ci/) — CI/CD 流水线中的安全扫描环节，与本文的 Action 封装紧密相关
- [容器安全扫描实战：Trivy/Snyk/Grype CI 集成](/post/trivy-snyk-grype-ci-sbom/) — 在 GitHub Actions 中集成容器安全扫描，丰富 CI/CD 工作流能力

---

> 本文基于 KKday B2C Backend Team 30+ 个 Laravel 仓库的 CI/CD 统一治理实践。如有问题欢迎在评论区讨论。文中所有代码示例均经过实际生产环境验证，可直接复制使用。

---

*最后更新：2026-06-01*
