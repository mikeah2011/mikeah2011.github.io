---

title: GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布
keywords: [GitHub Actions, PHP, 矩阵策略实战, 版本, 多数据库的并行测试与条件发布]
date: 2026-06-02 12:00:00
tags:
- GitHub Actions
- CI/CD
- 矩阵策略
- PHP
- 自动化
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 全面讲解GitHub Actions矩阵策略在Laravel项目中的实战应用，从基础语法到高级技巧。涵盖多PHP版本并行测试、Service Containers多数据库配置、条件化发布工作流、动态矩阵生成和Reusable Workflows复用。包含完整的Laravel CI/CD工作流配置，详解fail-fast策略、max-parallel并发控制、分层缓存优化和矩阵精简技巧，帮助团队用声明式配置实现12种测试组合的自动化并行执行。
---





# GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布

## 前言

在现代 PHP 项目开发中，尤其是维护开源库或大型 Laravel 应用时，我们面临着一个现实挑战：代码需要在多个 PHP 版本（8.1、8.2、8.3、8.4）和多种数据库（MySQL 5.7/8.0、PostgreSQL 14/15/16、SQLite）上稳定运行。手动在每种组合上测试显然不现实——假设你有 4 个 PHP 版本和 3 种数据库，那就是 12 种组合，手动跑一遍至少需要半天时间。

GitHub Actions 的矩阵策略（Matrix Strategy）正是为解决这个问题而设计的。它允许你在单个工作流定义中声明多组参数，GitHub 会自动展开为多个并行 Job，每个 Job 使用不同的参数组合运行。这意味着 12 种测试组合可以在几分钟内同时完成。

本文将从基础语法到高级实战，全面讲解如何在 Laravel 项目中使用 GitHub Actions 矩阵策略，实现多 PHP 版本、多数据库的并行测试，并通过条件发布将通过测试的产物自动部署。

---

## 一、矩阵策略基础语法

### 1.1 最简示例

矩阵策略的核心是在 `jobs.<job_id>.strategy.matrix` 下定义一组键值对：

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ['8.1', '8.2', '8.3', '8.4']
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
      - run: php -v
```

这个配置会自动生成 4 个并行 Job，分别使用 PHP 8.1、8.2、8.3、8.4 运行。`${{ matrix.php }}` 是矩阵变量的引用语法。

### 1.2 多维矩阵

当需要同时组合多个维度时，矩阵会进行笛卡尔积展开：

```yaml
strategy:
  matrix:
    php: ['8.2', '8.3']
    database: ['mysql', 'pgsql', 'sqlite']
```

这会产生 2 × 3 = 6 个 Job：
- PHP 8.2 + MySQL
- PHP 8.2 + PostgreSQL
- PHP 8.2 + SQLite
- PHP 8.3 + MySQL
- PHP 8.3 + PostgreSQL
- PHP 8.3 + SQLite

### 1.3 include 与 exclude

有时候某些组合不需要测试，或者需要为特定组合添加额外配置：

```yaml
strategy:
  matrix:
    php: ['8.1', '8.2', '8.3', '8.4']
    database: ['mysql', 'pgsql']
    exclude:
      - php: '8.1'
        database: 'pgsql'  # PHP 8.1 不测 PostgreSQL
    include:
      - php: '8.4'
        database: 'sqlite'
        prefer-lowest: true  # 为这个组合添加额外参数
```

`exclude` 会在笛卡尔积中移除指定组合，`include` 则可以添加不在笛卡尔积中的新组合，或者为已有组合追加变量。

### 1.4 矩阵变量的类型

矩阵变量可以是字符串、数字或布尔值：

```yaml
strategy:
  matrix:
    php: ['8.3']
    database: ['mysql']
    prefer-lowest: [false, true]
    node-version: [18, 20]
```

注意：当值为纯数字时，GitHub Actions 会将其作为数字处理。如果需要字符串比较（如在 `if` 条件中），建议始终使用引号包裹。

---

## 二、Laravel 项目多 PHP 版本测试实战

### 2.1 基础工作流配置

以下是一个完整的 Laravel 项目测试工作流：

```yaml
# .github/workflows/tests.yml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  tests:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        php: ['8.1', '8.2', '8.3', '8.4']
        stability: [prefer-stable]

    name: PHP ${{ matrix.php }} - ${{ matrix.stability }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          extensions: dom, curl, libxml, mbstring, zip, pcntl, pdo, sqlite, pdo_sqlite, bcmath, soap, intl, gd, exif, iconv, fileinfo
          coverage: xdebug

      - name: Get Composer cache directory
        id: composer-cache
        run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

      - name: Cache Composer dependencies
        uses: actions/cache@v4
        with:
          path: ${{ steps.composer-cache.outputs.dir }}
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
          restore-keys: ${{ runner.os }}-composer-

      - name: Install dependencies
        run: |
          composer update --${{ matrix.stability }} --prefer-dist --no-interaction --no-progress

      - name: Execute tests
        run: php artisan test
```

### 2.2 shivammathur/setup-php 详解

`shivammathur/setup-php` 是 PHP 项目在 GitHub Actions 中的标配 Action，它支持：

- **PHP 版本切换**：从 5.6 到 8.4 全覆盖
- **扩展安装**：通过 `extensions` 参数声明式安装
- **工具安装**：通过 `tools` 参数安装 Composer、PHPStan、Pest 等
- **Coverage 驱动**：支持 xdebug、pcov、none

```yaml
- name: Setup PHP
  uses: shivammathur/setup-php@v2
  with:
    php-version: ${{ matrix.php }}
    extensions: dom, curl, mbstring, zip, pdo, mysql, pgsql, sqlite3
    tools: composer:v2, pestphp/pest
    coverage: pcov
```

### 2.3 Composer 依赖缓存策略

Composer 依赖安装是 CI 中最耗时的步骤之一。合理的缓存策略可以将安装时间从 2 分钟缩短到 15 秒：

```yaml
- name: Get Composer cache directory
  id: composer-cache
  run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

- name: Cache Composer dependencies
  uses: actions/cache@v4
  with:
    path: ${{ steps.composer-cache.outputs.dir }}
    key: php-${{ matrix.php }}-composer-${{ hashFiles('**/composer.lock') }}
    restore-keys: |
      php-${{ matrix.php }}-composer-
```

关键点：缓存 key 中包含 `matrix.php`，确保不同 PHP 版本使用独立的缓存。如果 8.2 和 8.3 共享缓存，可能导致依赖冲突。

---

## 三、多数据库并行测试实战

### 3.1 Service Containers 配置

GitHub Actions 支持在 Job 中启动 Service Containers，这使得我们可以在矩阵中轻松切换数据库：

```yaml
jobs:
  tests:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        php: ['8.2', '8.3', '8.4']
        database: ['mysql', 'pgsql', 'sqlite']

    name: PHP ${{ matrix.php }} - ${{ matrix.database }}

    services:
      mysql:
        image: ${{ matrix.database == 'mysql' && 'mysql:8.0' || 'mysql:8.0' }}
        env:
          MYSQL_ROOT_PASSWORD: password
          MYSQL_DATABASE: testing
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3
        if: matrix.database == 'mysql'

      postgres:
        image: ${{ matrix.database == 'pgsql' && 'postgres:16' || 'postgres:16' }}
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: password
          POSTGRES_DB: testing
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3
        if: matrix.database == 'pgsql'
```

但这里有一个问题：GitHub Actions 的 `services` 块不支持 `if` 条件。我们需要用一种更巧妙的方式来处理。

### 3.2 条件化 Service Containers 的正确姿势

由于 `services` 不支持 `if`，我们需要同时声明所有服务，但在运行时只连接需要的那个：

```yaml
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
      --health-retries=3

  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: testing
    ports:
      - 5432:5432
    options: >-
      --health-cmd="pg_isready"
      --health-interval=10s
      --health-timeout=5s
      --health-retries=3
```

然后通过环境变量控制 Laravel 连接哪个数据库：

```yaml
- name: Set up database config
  run: |
    if [ "${{ matrix.database }}" == "mysql" ]; then
      echo "DB_CONNECTION=mysql" >> $GITHUB_ENV
      echo "DB_HOST=127.0.0.1" >> $GITHUB_ENV
      echo "DB_PORT=3306" >> $GITHUB_ENV
      echo "DB_DATABASE=testing" >> $GITHUB_ENV
      echo "DB_USERNAME=root" >> $GITHUB_ENV
      echo "DB_PASSWORD=password" >> $GITHUB_ENV
    elif [ "${{ matrix.database }}" == "pgsql" ]; then
      echo "DB_CONNECTION=pgsql" >> $GITHUB_ENV
      echo "DB_HOST=127.0.0.1" >> $GITHUB_ENV
      echo "DB_PORT=5432" >> $GITHUB_ENV
      echo "DB_DATABASE=testing" >> $GITHUB_ENV
      echo "DB_USERNAME=postgres" >> $GITHUB_ENV
      echo "DB_PASSWORD=password" >> $GITHUB_ENV
    else
      echo "DB_CONNECTION=sqlite" >> $GITHUB_ENV
      echo "DB_DATABASE=:memory:" >> $GITHUB_ENV
    fi
```

### 3.3 多数据库版本矩阵

如果我们需要测试同一数据库的不同版本，可以将数据库版本也纳入矩阵：

```yaml
strategy:
  matrix:
    php: ['8.2', '8.3', '8.4']
    database: ['mysql', 'pgsql', 'sqlite']
    db-version: ['default']
    include:
      - php: '8.3'
        database: 'mysql'
        db-version: '5.7'
      - php: '8.3'
        database: 'mysql'
        db-version: '8.0'
      - php: '8.3'
        database: 'mysql'
        db-version: '8.4'
      - php: '8.3'
        database: 'pgsql'
        db-version: '14'
      - php: '8.3'
        database: 'pgsql'
        db-version: '15'
      - php: '8.3'
        database: 'pgsql'
        db-version: '16'
```

然后在 Service Container 中动态指定镜像版本：

```yaml
services:
  mysql:
    image: mysql:${{ matrix.db-version != 'default' && matrix.db-version || '8.0' }}
```

### 3.4 SQLite 内存数据库的特殊处理

SQLite 作为内存数据库，不需要 Service Container，但需要特殊配置：

```yaml
- name: Configure SQLite
  if: matrix.database == 'sqlite'
  run: |
    touch database/testing.sqlite
    echo "DB_CONNECTION=sqlite" >> $GITHUB_ENV
    echo "DB_DATABASE=${{ github.workspace }}/database/testing.sqlite" >> $GITHUB_ENV
    # 或者使用内存数据库
    echo "DB_DATABASE=:memory:" >> $GITHUB_ENV
```

---

## 四、条件执行与 Job 依赖

### 4.1 基础条件执行

矩阵中的 Job 可以通过 `if` 条件控制是否执行：

```yaml
tests:
  if: github.event_name == 'push' || github.event.pull_request.draft == false
```

这意味着：如果是 push 事件，总是运行；如果是 PR，只有非 draft 状态才运行。

### 4.2 跨矩阵维度的条件

有时候我们需要根据矩阵变量的值来决定是否执行某个步骤：

```yaml
steps:
  - name: Run MySQL-specific tests
    if: matrix.database == 'mysql'
    run: php artisan test --group=mysql

  - name: Run PostgreSQL-specific tests
    if: matrix.database == 'pgsql'
    run: php artisan test --group=pgsql
```

### 4.3 条件发布工作流

一个常见的模式是：先跑完所有测试，只有全部通过才执行发布：

```yaml
name: CI/CD Pipeline

on:
  push:
    tags:
      - 'v*'

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: true  # 任何一个失败就取消其他
      matrix:
        php: ['8.2', '8.3', '8.4']
        database: ['mysql', 'pgsql', 'sqlite']
    # ... 测试步骤

  build:
    needs: test  # 依赖 test Job 全部成功
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build assets
        run: |
          npm ci
          npm run build
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-assets
          path: public/build/

  deploy:
    needs: build  # 依赖 build Job
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    environment: production
    steps:
      - name: Deploy to production
        run: |
          echo "Deploying version ${{ github.ref_name }}"
          # 实际部署逻辑
```

### 4.4 成功/失败条件

`needs` 关键字支持更精细的条件控制：

```yaml
deploy-staging:
  needs: test
  if: always() && needs.test.result == 'success'
  runs-on: ubuntu-latest
  steps:
    - run: echo "All tests passed, deploying to staging"

notify-failure:
  needs: test
  if: always() && needs.test.result == 'failure'
  runs-on: ubuntu-latest
  steps:
    - run: echo "Tests failed, sending notification"
```

---

## 五、完整实战案例：Laravel 项目 CI/CD

### 5.1 项目背景

假设我们维护一个 Laravel 包，需要支持：
- PHP 8.1、8.2、8.3、8.4
- MySQL 8.0、PostgreSQL 16、SQLite
- Lint（Pint）、静态分析（PHPStan）、测试（Pest）
- 只有在 main 分支且所有测试通过后才自动打 tag

### 5.2 完整工作流配置

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  lint:
    name: Code Style
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer:v2
      - run: composer install --prefer-dist --no-progress
      - run: vendor/bin/pint --test

  static-analysis:
    name: PHPStan
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer:v2
      - run: composer install --prefer-dist --no-progress
      - run: vendor/bin/phpstan analyse --memory-limit=512M

  test:
    name: PHP ${{ matrix.php }} / ${{ matrix.database }}
    runs-on: ubuntu-latest
    needs: lint
    strategy:
      fail-fast: false
      matrix:
        php: ['8.1', '8.2', '8.3', '8.4']
        database: ['sqlite']
        include:
          - php: '8.3'
            database: 'mysql'
          - php: '8.3'
            database: 'pgsql'
          - php: '8.4'
            database: 'mysql'
          - php: '8.4'
            database: 'pgsql'

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
          --health-retries=3

      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: password
          POSTGRES_DB: testing
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=3

    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          extensions: dom, curl, mbstring, zip, pdo, pdo_mysql, pdo_pgsql, pdo_sqlite
          coverage: pcov

      - name: Cache Composer
        uses: actions/cache@v4
        with:
          path: vendor
          key: php-${{ matrix.php }}-composer-${{ hashFiles('composer.lock') }}

      - name: Install dependencies
        run: composer install --prefer-dist --no-progress

      - name: Prepare environment
        run: |
          cp .env.example .env
          php artisan key:generate

      - name: Configure database
        run: |
          if [ "${{ matrix.database }}" == "mysql" ]; then
            sed -i 's/DB_CONNECTION=.*/DB_CONNECTION=mysql/' .env
            sed -i 's/DB_HOST=.*/DB_HOST=127.0.0.1/' .env
            sed -i 's/DB_PORT=.*/DB_PORT=3306/' .env
            sed -i 's/DB_DATABASE=.*/DB_DATABASE=testing/' .env
            sed -i 's/DB_USERNAME=.*/DB_USERNAME=root/' .env
            sed -i 's/DB_PASSWORD=.*/DB_PASSWORD=password/' .env
          elif [ "${{ matrix.database }}" == "pgsql" ]; then
            sed -i 's/DB_CONNECTION=.*/DB_CONNECTION=pgsql/' .env
            sed -i 's/DB_HOST=.*/DB_HOST=127.0.0.1/' .env
            sed -i 's/DB_PORT=.*/DB_PORT=5432/' .env
            sed -i 's/DB_DATABASE=.*/DB_DATABASE=testing/' .env
            sed -i 's/DB_USERNAME=.*/DB_USERNAME=postgres/' .env
            sed -i 's/DB_PASSWORD=.*/DB_PASSWORD=password/' .env
          else
            sed -i 's/DB_CONNECTION=.*/DB_CONNECTION=sqlite/' .env
            sed -i '/DB_HOST/d' .env
            sed -i '/DB_PORT/d' .env
            sed -i '/DB_USERNAME/d' .env
            sed -i '/DB_PASSWORD/d' .env
            touch database/database.sqlite
            echo "DB_DATABASE=${{ github.workspace }}/database/database.sqlite" >> .env
          fi

      - name: Run migrations
        run: php artisan migrate --force

      - name: Run tests
        run: vendor/bin/pest --parallel --coverage-clover=coverage.xml

      - name: Upload coverage
        if: matrix.php == '8.3' && matrix.database == 'sqlite'
        uses: codecov/codecov-action@v4
        with:
          files: coverage.xml
          token: ${{ secrets.CODECOV_TOKEN }}
```

### 5.3 配置解析

这个工作流的关键设计决策：

1. **Lint 先行**：Code Style 检查最快，失败就不用跑后面的了
2. **PHPStan 依赖 Lint**：只有代码风格通过才做静态分析
3. **矩阵策略精简**：全量组合太贵，所以只在 PHP 8.3/8.4 上测多数据库，其他版本用 SQLite
4. **fail-fast: false**：即使一个组合失败，其他组合继续跑，收集尽可能多的信息
5. **Coverage 只跑一次**：避免重复上传

---

## 六、性能优化策略

### 6.1 fail-fast 策略

```yaml
strategy:
  fail-fast: true  # 默认值，一个失败就取消其他
```

vs

```yaml
strategy:
  fail-fast: false  # 所有组合都跑完，不管是否有失败
```

在开发阶段建议 `fail-fast: false`，收集所有失败信息。在发布流程中可以考虑 `fail-fast: true`，快速失败节省资源。

### 6.2 max-parallel 控制并发

当矩阵组合太多时，可能遇到 GitHub Actions 的并发限制（免费账户 20 个并发 Job）：

```yaml
strategy:
  max-parallel: 5  # 最多同时运行 5 个 Job
  matrix:
    php: ['8.1', '8.2', '8.3', '8.4']
    database: ['mysql', 'pgsql', 'sqlite']
```

这样 12 个组合会分 3 批运行，避免超出并发限制。

### 6.3 精简矩阵组合

不是所有组合都需要测试。一个务实的策略：

```yaml
matrix:
  php: ['8.1', '8.2', '8.3', '8.4']
  database: ['sqlite']  # 所有 PHP 版本都测 SQLite（最快）
  include:
    - php: '8.3'
      database: 'mysql'    # 最常用的组合测 MySQL
    - php: '8.3'
      database: 'pgsql'    # 最常用的组合测 PostgreSQL
    - php: '8.4'
      database: 'mysql'    # 最新 PHP 也要测 MySQL
```

这样从 12 个组合减少到 7 个，节省约 40% 的 CI 时间。

### 6.4 分层缓存

```yaml
- name: Cache Composer dependencies
  uses: actions/cache@v4
  with:
    path: |
      vendor
      ~/.composer/cache
    key: deps-php-${{ matrix.php }}-${{ hashFiles('composer.lock') }}
    restore-keys: |
      deps-php-${{ matrix.php }}-

- name: Cache npm dependencies
  if: matrix.php == '8.3' && matrix.database == 'sqlite'
  uses: actions/cache@v4
  with:
    path: node_modules
    key: deps-npm-${{ hashFiles('package-lock.json') }}
```

### 6.5 条件化昂贵步骤

```yaml
- name: Run static analysis
  if: matrix.php == '8.3' && matrix.database == 'sqlite'
  run: vendor/bin/phpstan analyse

- name: Run coverage
  if: matrix.php == '8.3' && matrix.database == 'sqlite'
  run: vendor/bin/pest --coverage
```

只在一个组合上跑静态分析和覆盖率，其他组合只跑测试。

---

## 七、高级技巧

### 7.1 动态矩阵

有时候矩阵值需要从上一个 Job 的输出中获取：

```yaml
jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      php-versions: ${{ steps.set-matrix.outputs.php-versions }}
    steps:
      - id: set-matrix
        run: |
          # 从 composer.json 读取支持的 PHP 版本
          VERSIONS=$(jq -r '.require.php' composer.json | grep -oP '\d+\.\d+' | sort -u | jq -R . | jq -s .)
          echo "php-versions=$VERSIONS" >> $GITHUB_OUTPUT

  test:
    needs: prepare
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ${{ fromJson(needs.prepare.outputs.php-versions) }}
```

### 7.2 矩阵中的环境变量

```yaml
strategy:
  matrix:
    include:
      - php: '8.3'
        database: 'mysql'
        env:
          DB_CONNECTION: mysql
          DB_PORT: 3306
      - php: '8.3'
        database: 'pgsql'
        env:
          DB_CONNECTION: pgsql
          DB_PORT: 5432
```

### 7.3 矩阵与 Reusable Workflows

对于组织内的多个项目，可以将矩阵测试抽成 Reusable Workflow：

```yaml
# .github/workflows/reusable-test.yml
name: Reusable Test Workflow
on:
  workflow_call:
    inputs:
      php-versions:
        type: string
        default: '["8.2", "8.3", "8.4"]'
      databases:
        type: string
        default: '["sqlite"]'

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ${{ fromJson(inputs.php-versions) }}
        database: ${{ fromJson(inputs.databases) }}
    steps:
      - uses: actions/checkout@v4
      # ... 测试步骤
```

调用方：

```yaml
jobs:
  test:
    uses: ./.github/workflows/reusable-test.yml
    with:
      php-versions: '["8.1", "8.2", "8.3", "8.4"]'
      databases: '["sqlite", "mysql", "pgsql"]'
```

### 7.4 矩阵中的 Artifact 收集

当某个矩阵组合产生需要的产物时：

```yaml
- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: test-results-php${{ matrix.php }}-${{ matrix.database }}
    path: |
      tests/Reports/
      coverage.xml
    retention-days: 7
```

---

## 八、常见问题与排查

### 8.1 Service Container 启动失败

**症状**：Job 卡在 health check 阶段

**排查**：
```yaml
services:
  mysql:
    image: mysql:8.0
    options: >-
      --health-cmd="mysqladmin ping -h 127.0.0.1"
      --health-interval=15s
      --health-timeout=10s
      --health-retries=5
      --health-start-period=30s  # 给数据库更多启动时间
```

### 8.2 矩阵变量在 if 条件中比较失败

**问题**：数字类型的矩阵变量在 `if` 中比较行为异常

**解决**：始终用字符串：
```yaml
matrix:
  php: ['8.2', '8.3']  # 用引号包裹
steps:
  - if: matrix.php == '8.3'  # 字符串比较
```

### 8.3 Composer 依赖在不同 PHP 版本间冲突

**问题**：缓存的 vendor 目录跨 PHP 版本使用

**解决**：缓存 key 包含 PHP 版本：
```yaml
key: php-${{ matrix.php }}-composer-${{ hashFiles('composer.lock') }}
```

### 8.4 并发限制导致 Job 排队

**症状**：大量矩阵 Job 等待运行

**解决**：
1. 使用 `max-parallel` 限制并发
2. 精简矩阵组合
3. 考虑升级 GitHub Actions 计划

### 8.5 数据库连接被拒绝

**症状**：`SQLSTATE[HY000] [2002] Connection refused`

**排查**：
1. 确认 Service Container 的 health check 通过
2. 确认端口映射正确（`3306:3306`）
3. 确认环境变量中数据库配置正确
4. 对于 MySQL 8.0+，确认认证插件兼容性

---

## 九、与竞品对比

### GitHub Actions vs GitLab CI

| 特性 | GitHub Actions | GitLab CI |
|------|---------------|-----------|
| 矩阵语法 | `strategy.matrix` | `parallel:matrix` |
| Service Containers | `services` 关键字 | `services` 关键字 |
| 缓存 | `actions/cache` | `cache` 关键字 |
| 并发控制 | `max-parallel` | `resource_group` |
| 动态矩阵 | 通过 Job 输出 | 通过 `trigger` |

### GitHub Actions vs CircleCI

| 特性 | GitHub Actions | CircleCI |
|------|---------------|----------|
| 矩阵展开 | 自动笛卡尔积 | 需要手动 `matrix` 参数 |
| 并行度 | 基于 Job | 基于 `parallelism` |
| Orbs/Actions | Marketplace 丰富 | Orbs 生态 |

---

## 十、最佳实践总结

1. **精简矩阵**：不要盲目测试所有组合，选择最具代表性的
2. **fail-fast 策略**：开发阶段 `false`，发布阶段 `true`
3. **分层缓存**：PHP 版本作为缓存 key 的一部分
4. **条件化昂贵步骤**：静态分析、覆盖率只跑一次
5. **Service Container health check**：给足启动时间，设置合理的重试次数
6. **Artifact 收集**：失败时也收集测试报告，方便排查
7. **Reusable Workflows**：组织内多个项目复用测试配置
8. **监控 CI 时间**：定期检查 Job 运行时间，发现性能退化

---

## 总结

GitHub Actions 的矩阵策略是一个强大而灵活的工具，它让我们能够以声明式的方式定义多维度的测试组合，自动并行执行，大幅提升了 CI/CD 效率。在 Laravel 项目中，合理使用矩阵策略可以确保代码在多个 PHP 版本和数据库上的兼容性，同时通过条件执行和依赖管理实现智能化的发布流程。

关键要点：
- 矩阵是笛卡尔积，但可以通过 `exclude` 和 `include` 精细控制
- Service Containers 让数据库测试变得简单，但要注意 health check
- 缓存策略直接影响 CI 性能，key 中必须包含维度变量
- 条件发布通过 `needs` 和 `if` 实现，确保只有全部测试通过才部署

从今天开始，让你的 Laravel 项目告别手动测试，拥抱自动化的多版本、多数据库并行测试吧。

## 相关阅读

- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/07_CICD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
- [Ansible 实战：Laravel 应用自动化部署与配置管理](/categories/07_CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
- [Terraform 实战：Laravel 应用基础设施即代码 IaC](/categories/07_CICD/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/)
