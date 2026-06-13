---
title: "GitLab CI/CD 实战：从 GitHub Actions 迁移——Pipeline DAG、Auto DevOps、安全扫描与 Laravel 项目的完整 CI/CD 方案"
keywords: [GitLab CI, CD, GitHub Actions, Pipeline DAG, Auto DevOps, Laravel, CI, 迁移, 安全扫描与, 项目的完整]
date: 2026-06-10 05:37:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
  - GitLab
  - CI/CD
  - GitHub Actions
  - Laravel
  - DevOps
  - 安全扫描
  - Auto DevOps
description: "从 GitHub Actions 迁移到 GitLab CI/CD 的完整实战指南，涵盖 Pipeline DAG 依赖编排、Auto DevOps 配置、安全扫描集成，以及 Laravel 项目的端到端 CI/CD 方案。"
---


## 为什么从 GitHub Actions 迁移到 GitLab CI/CD？

GitHub Actions 是个好工具，但当团队规模增长、项目变多、安全合规要求变高时，GitLab CI/CD 的优势就显现出来了：

- **一体化平台**：代码托管、CI/CD、容器注册表、安全扫描、制品管理全在一个地方
- **Pipeline DAG**：原生 `needs` 关键字实现有向无环图依赖，比 GitHub Actions 的 `needs` 更直观
- **Auto DevOps**：零配置即可跑通构建→测试→部署的全流程
- **内置安全扫描**：SAST、DAST、依赖扫描、容器扫描开箱即用
- **Runner 灵活性**：共享 Runner、项目 Runner、Group Runner，标签系统精细控制

本文以一个 Laravel 项目为例，完整演示从 GitHub Actions 迁移到 GitLab CI/CD 的全过程。

## 一、概念映射：GitHub Actions vs GitLab CI/CD

迁移的第一步是理解两边的概念对应关系：

| GitHub Actions | GitLab CI/CD | 说明 |
|---|---|---|
| Workflow | Pipeline | 一次完整的 CI/CD 流水线 |
| Job | Job | 一个执行单元 |
| Step | Script / before_script | Job 内的执行步骤 |
| `on: push` | `rules` / `only` | 触发条件 |
| `needs` | `needs` | Job 间依赖 |
| Secrets | CI/CD Variables | 敏感变量管理 |
| Self-hosted Runner | GitLab Runner | 自托管执行器 |
| Actions Marketplace | CI/CD Components / Templates | 可复用组件 |
| Artifacts | Artifacts | 构建产物 |
| Cache | Cache | 依赖缓存 |
| Environment | Environment | 部署环境 |

关键差异：

1. GitLab CI/CD 使用 `.gitlab-ci.yml` 单一文件，而非 `.github/workflows/` 下的多个文件
2. GitLab 的 `rules` 比 GitHub Actions 的 `if` 更强大，支持 `changes`、`exists` 等条件
3. GitLab 原生支持 `include` 引入外部模板，复用性更强

## 二、Laravel 项目的 GitHub Actions 原配置

先看看原来的 GitHub Actions 配置：

```yaml
# .github/workflows/ci.yml
name: Laravel CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: secret
          MYSQL_DATABASE: testing
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, mysql
          coverage: xdebug

      - name: Cache Composer
        uses: actions/cache@v4
        with:
          path: vendor
          key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}

      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Prepare Environment
        run: |
          cp .env.ci .env
          php artisan key:generate

      - name: Run Tests
        run: php artisan test --parallel --coverage-clover=coverage.xml

      - name: Upload Coverage
        uses: codecov/codecov-action@v4
        with:
          file: coverage.xml

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Production
        run: |
          ssh ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} \
            "cd /var/www/app && git pull && composer install --no-dev && php artisan migrate --force && php artisan config:cache && php artisan route:cache"
```

## 三、迁移到 GitLab CI/CD

### 3.1 基础配置

创建 `.gitlab-ci.yml`：

```yaml
# .gitlab-ci.yml
 stages:
   - lint
   - test
   - security
   - build
   - deploy

 variables:
   # PHP 镜像
   PHP_IMAGE: php:8.2-cli
   # Composer 缓存目录
   COMPOSER_CACHE_DIR: "$CI_PROJECT_DIR/.composer-cache"
   # MySQL 配置
   MYSQL_ROOT_PASSWORD: secret
   MYSQL_DATABASE: testing
   MYSQL_HOST: mysql
   # Laravel 配置
   APP_ENV: testing
   APP_KEY: ""
   DB_CONNECTION: mysql
   DB_HOST: mysql
   DB_PORT: 3306
   DB_DATABASE: testing
   DB_USERNAME: root
   DB_PASSWORD: secret

 # 全局默认配置
 default:
   image: $PHP_IMAGE
   before_script:
     - apt-get update -qq && apt-get install -y -qq git unzip libzip-dev libpng-dev libonig-dev libxml2-dev
     - docker-php-ext-install pdo_mysql bcmath zip mbstring xml
     - curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
     - composer --version
   cache:
     key: "${CI_COMMIT_REF_SLUG}"
     paths:
       - vendor/
       - .composer-cache/
```

### 3.2 Pipeline DAG：用 `needs` 编排依赖

GitLab 的 Pipeline DAG 是通过 `needs` 关键字实现的。与 GitHub Actions 不同，GitLab 的 DAG 允许 Job 跳过不需要的阶段，直接执行依赖链上的 Job。

```yaml
# Lint 阶段
phpstan:
  stage: lint
  script:
    - composer install --no-progress --prefer-dist
    - vendor/bin/phpstan analyse --memory-limit=512M
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "develop"'

pint:
  stage: lint
  script:
    - composer install --no-progress --prefer-dist
    - vendor/bin/pint --test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "develop"'

# 测试阶段
phpunit:
  stage: test
  needs: [phpstan, pint]  # DAG 依赖：等 lint 通过才跑测试
  services:
    - name: mysql:8.0
      alias: mysql
  script:
    - composer install --no-progress --prefer-dist
    - cp .env.ci .env
    - php artisan key:generate
    - php artisan test --parallel --coverage-text
  coverage: '/Statements\s*:\s*(\d+\.?\d*)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
    when: always
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "develop"'

# 构建阶段
build-assets:
  stage: build
  image: node:20-alpine
  needs: []  # 无依赖，与测试并行执行
  script:
    - npm ci --cache .npm
    - npm run build
  artifacts:
    paths:
      - public/build/
    expire_in: 1 hour
  cache:
    key: "${CI_COMMIT_REF_SLUG}-npm"
    paths:
      - .npm/
      - node_modules/
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "develop"'
```

DAG 的核心价值：`needs: []` 表示无依赖，可以立即执行；`needs: [phpstan, pint]` 表示要等这两个 Job 完成。这样 Pipeline 不再是严格的阶段串行，而是按依赖关系并行执行。

### 3.3 Auto DevOps 配置

GitLab 的 Auto DevOps 可以零配置跑通 CI/CD，但对于 Laravel 项目，我们通常需要自定义。以下是在 Auto DevOps 基础上的定制方案：

```yaml
# 启用 Auto DevOps 的自定义配置
include:
  - template: Auto-DevOps.gitlab-ci.yml

# 覆盖 Auto DevOps 的默认行为
auto-build:
  stage: build
  script:
    - |
      # 使用多阶段构建的 Dockerfile
      docker build \
        --build-arg PHP_VERSION=8.2 \
        --build-arg COMPOSER_AUTH="$COMPOSER_AUTH" \
        -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA" \
        -t "$CI_REGISTRY_IMAGE:latest" .
    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
    - docker push "$CI_REGISTRY_IMAGE:latest"
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      exists:
        - Dockerfile
```

如果项目没有 Dockerfile，Auto DevOps 会自动检测语言并使用对应的 buildpack。Laravel 项目推荐显式提供 Dockerfile。

#### Auto DevOps 的核心能力

1. **自动构建**：检测 `Dockerfile` 或使用 Cloud Native Buildpack
2. **自动测试**：检测测试框架并运行
3. **代码质量**：集成 Code Climate
4. **部署策略**：支持 Canary、Blue-Green、Rolling 更新
5. **监控**：集成 Prometheus

#### 启用 Auto DevOps

在 GitLab 项目设置中：**Settings → CI/CD → Auto DevOps → Enable**

或者在 `.gitlab-ci.yml` 中：

```yaml
include:
  - template: Auto-DevOps.gitlab-ci.yml

variables:
  AUTO_DEVOPS_TARGET: "laravel"
  AUTO_DEVOPS_DEPLOY_STRATEGY: "rolling"
```

### 3.4 安全扫描集成

GitLab 的安全扫描是其最大优势之一。以下是集成方案：

```yaml
# 安全扫描阶段
include:
  - template: Security/SAST.gitlab-ci.yml
  - template: Security/Dependency-Scanning.gitlab-ci.yml
  - template: Security/Secret-Detection.gitlab-ci.yml
  - template: Security/Container-Scanning.gitlab-ci.yml

# SAST 静态应用安全测试
phpcs-security-audit:
  stage: security
  needs: [phpstan]
  image: php:8.2-cli
  script:
    - composer global require phpcsstandards/phpcs-security-audit
    - vendor/bin/phpcs-security-audit --standard=Security --extensions=php app/
  artifacts:
    reports:
      sast: gl-sast-report.json
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'

# 依赖扫描 - composer audit
dependency-scan:
  stage: security
  needs: []
  script:
    - composer install --no-progress --prefer-dist
    - composer audit --format=json > dependency-report.json || true
    - |
      # 检查已知漏洞
      VULN_COUNT=$(cat dependency-report.json | grep -c '"advisory"' || echo "0")
      if [ "$VULN_COUNT" -gt "0" ]; then
        echo "发现 $VULN_COUNT 个依赖漏洞"
        cat dependency-report.json
        exit 1
      fi
  artifacts:
    reports:
      dependency_scanning: dependency-report.json
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'

# Secret Detection - 防止密钥泄露
secret-detection:
  stage: security
  needs: []
  image: ruby:3.2
  script:
    - gem install gitlab-secret_detection
    - gitlab-secret_detection --output gl-secret-detection-report.json
  artifacts:
    reports:
      secret_detection: gl-secret-detection-report.json
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'

# 容器扫描
container-scanning:
  stage: security
  needs: [build-docker]
  image: aquasec/trivy:latest
  script:
    - trivy image --format json --output trivy-report.json "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
    - trivy image --exit-code 1 --severity HIGH,CRITICAL "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
  artifacts:
    reports:
      container_scanning: trivy-report.json
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      exists:
        - Dockerfile
```

#### 安全扫描报告

GitLab 会在 MR 页面直接展示安全扫描结果：

- **SAST**：代码中的安全漏洞
- **Dependency Scanning**：依赖包的已知漏洞
- **Secret Detection**：硬编码的密钥、Token
- **Container Scanning**：容器镜像的漏洞

这些报告会自动合并到 MR 的安全面板中，reviewer 可以直接看到。

### 3.5 部署阶段

```yaml
# 部署到生产环境
deploy-production:
  stage: deploy
  needs: [phpunit, build-assets, container-scanning]
  image: alpine:latest
  environment:
    name: production
    url: https://app.example.com
    on_stop: stop-production
  before_script:
    - apk add --no-cache openssh-client
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | tr -d '\r' | ssh-add -
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - echo "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
  script:
    - |
      ssh $DEPLOY_USER@$DEPLOY_HOST << 'EOF'
        cd /var/www/app
        git fetch origin main
        git reset --hard origin/main
        composer install --no-dev --optimize-autoloader
        php artisan migrate --force
        php artisan config:cache
        php artisan route:cache
        php artisan view:cache
        php artisan queue:restart
        echo "部署完成: $(date)"
      EOF
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: manual  # 手动触发部署
      allow_failure: false

# 停止生产环境
stop-production:
  stage: deploy
  needs: []
  environment:
    name: production
    action: stop
  script:
    - echo "停止生产环境"
  when: manual
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
```

### 3.6 完整 Pipeline DAG 可视化

```
┌─────────┐
│ phpstan │──────┐
└─────────┘      │
                 ▼
┌─────────┐   ┌──────────┐   ┌─────────────────┐
│  pint   │──▶│ phpunit  │──▶│ deploy-production│
└─────────┘   └──────────┘   └─────────────────┘
                                 ▲         ▲
┌──────────────┐                 │         │
│ build-assets │ (无依赖，并行)  │         │
└──────────────┘                 │         │
                                 │         │
┌──────────────┐   ┌──────────┐ │         │
│dependency-scan│  │build-docker│─────────┘
└──────────────┘   └──────────┘
                          │
                 ┌────────────────┐
                 │container-scanning│
                 └────────────────┘
```

## 四、迁移过程中的踩坑记录

### 4.1 `needs` 关键字的 DAG 行为

**问题**：设置了 `needs` 后，Pipeline 不再按阶段顺序执行，导致某些 Job 在依赖未满足时就启动。

**原因**：GitLab 的 `needs` 实现的是 DAG，不是简单的阶段依赖。如果 Job A `needs` Job B，但 Job B 还没开始，Job A 会等待。但如果 Job A `needs: []`，它会立即执行。

**解决**：

```yaml
# 错误：以为 needs: [] 会等上一个阶段
deploy:
  stage: deploy
  needs: []  # 这会立即执行，不管 test 阶段

# 正确：明确声明依赖
deploy:
  stage: deploy
  needs: [phpunit, build-assets]
```

### 4.2 Services 的 Hostname 问题

**问题**：MySQL 连接失败，提示 `Connection refused`。

**原因**：GitHub Actions 的 services 默认可以通过 `localhost` 访问，但 GitLab CI/CD 的 services 需要通过 `alias` 或服务名访问。

**解决**：

```yaml
phpunit:
  services:
    - name: mysql:8.0
      alias: mysql  # 必须设置 alias
  variables:
    DB_HOST: mysql  # 使用 alias 作为 host
```

### 4.3 Cache 的作用域

**问题**：MR 的 Pipeline 无法命中 main 分支的 cache。

**原因**：GitLab 的 cache 默认按分支隔离。MR 的 `CI_COMMIT_REF_SLUG` 是 `refs/merge-requests/xxx`，与 main 不同。

**解决**：

```yaml
cache:
  key:
    files:
      - composer.lock  # 基于文件内容的 cache key，跨分支共享
  paths:
    - vendor/
```

### 4.4 Artifacts 的大小限制

**问题**：测试覆盖率报告上传失败。

**原因**：GitLab 默认 artifacts 大小限制为 100MB。

**解决**：在 Admin Area 调整限制，或精简 artifacts 内容：

```yaml
artifacts:
  paths:
    - coverage.xml
  expire_in: 30 days
  # 不要上传整个 vendor 目录
```

### 4.5 环境变量的优先级

**问题**：`.gitlab-ci.yml` 中的 `variables` 被 CI/CD Variables 覆盖。

**原因**：GitLab CI/CD Variables 的优先级高于 `.gitlab-ci.yml` 中的 `variables`。优先级从高到低：

1. 手动触发 Pipeline 时的变量
2. CI/CD Variables（Settings → CI/CD → Variables）
3. `.gitlab-ci.yml` 中的 `variables`
4. Runner 配置的变量

**解决**：在 CI/CD Variables 中设置敏感值，在 `.gitlab-ci.yml` 中设置默认值。

### 4.6 `rules` vs `only/except`

**问题**：迁移后某些 Job 不触发。

**原因**：`only/except` 是旧语法，`rules` 是新语法，两者不能混用。

**解决**：统一使用 `rules`：

```yaml
# 旧语法（不推荐）
deploy:
  only:
    - main
  except:
    - tags

# 新语法（推荐）
deploy:
  rules:
    - if: '$CI_COMMIT_BRANCH == "main" && $CI_COMMIT_TAG == null'
```

## 五、高级配置

### 5.1 Multi-Project Pipeline

GitLab 支持跨项目的 Pipeline 触发：

```yaml
trigger-downstream:
  stage: deploy
  trigger:
    project: group/downstream-app
    branch: main
    strategy: depend  # 等待下游 Pipeline 完成
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
```

### 5.2 Parent-Child Pipeline

将大 Pipeline 拆分为子 Pipeline：

```yaml
# .gitlab-ci.yml
include:
  - local: 'ci/test.yml'
  - local: 'ci/deploy.yml'
  - local: 'ci/security.yml'

stages:
  - test
  - security
  - deploy

# 子 Pipeline 触发
test-pipeline:
  stage: test
  trigger:
    include:
      - local: 'ci/test-child.yml'
    strategy: depend
```

### 5.3 动态生成 Pipeline

使用 `dotenv` artifacts 动态决定后续 Job：

```yaml
generate-jobs:
  stage: .pre
  script:
    - |
      # 根据变更的文件决定要跑哪些 Job
      CHANGED_FILES=$(git diff --name-only HEAD~1)
      if echo "$CHANGED_FILES" | grep -q "app/Models/"; then
        echo "RUN_MIGRATION=true" >> build.env
      fi
  artifacts:
    reports:
      dotenv: build.env

migrate:
  stage: deploy
  needs: [generate-jobs]
  rules:
    - if: '$RUN_MIGRATION == "true"'
  script:
    - php artisan migrate --force
```

## 六、CI/CD Variables 配置清单

迁移时需要配置的 Variables（Settings → CI/CD → Variables）：

| 变量名 | 类型 | 说明 |
|---|---|---|
| `SSH_PRIVATE_KEY` | File | SSH 私钥，用于部署 |
| `SSH_KNOWN_HOSTS` | Variable | SSH known hosts |
| `DEPLOY_USER` | Variable | 部署服务器用户名 |
| `DEPLOY_HOST` | Variable | 部署服务器地址 |
| `COMPOSER_AUTH` | Variable | Composer 认证 JSON |
| `CI_REGISTRY_USER` | Variable | 容器注册表用户名（自动） |
| `CI_REGISTRY_PASSWORD` | Variable | 容器注册表密码（自动） |
| `DB_PASSWORD` | Variable | 数据库密码 |

注意：敏感变量要勾选 **Masked** 和 **Protected**。

## 七、完整 `.gitlab-ci.yml` 模板

将以上所有配置合并为一个完整的模板：

```yaml
# .gitlab-ci.yml - Laravel CI/CD 完整模板
include:
  - template: Security/SAST.gitlab-ci.yml
  - template: Security/Dependency-Scanning.gitlab-ci.yml
  - template: Security/Secret-Detection.gitlab-ci.yml

stages:
  - lint
  - test
  - security
  - build
  - deploy

variables:
  PHP_IMAGE: php:8.2-cli
  MYSQL_ROOT_PASSWORD: secret
  MYSQL_DATABASE: testing
  MYSQL_HOST: mysql
  APP_ENV: testing
  DB_CONNECTION: mysql
  DB_HOST: mysql
  DB_PORT: 3306
  DB_DATABASE: testing
  DB_USERNAME: root
  DB_PASSWORD: secret

default:
  image: $PHP_IMAGE
  before_script:
    - apt-get update -qq && apt-get install -y -qq git unzip libzip-dev libpng-dev libonig-dev libxml2-dev
    - docker-php-ext-install pdo_mysql bcmath zip mbstring xml
    - curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
  cache:
    key:
      files:
        - composer.lock
    paths:
      - vendor/
      - .composer-cache/

phpstan:
  stage: lint
  script:
    - composer install --no-progress --prefer-dist
    - vendor/bin/phpstan analyse --memory-limit=512M
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "develop"'

pint:
  stage: lint
  script:
    - composer install --no-progress --prefer-dist
    - vendor/bin/pint --test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "develop"'

phpunit:
  stage: test
  needs: [phpstan, pint]
  services:
    - name: mysql:8.0
      alias: mysql
  script:
    - composer install --no-progress --prefer-dist
    - cp .env.ci .env
    - php artisan key:generate
    - php artisan test --parallel --coverage-text
  coverage: '/Statements\s*:\s*(\d+\.?\d*)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "develop"'

build-assets:
  stage: build
  image: node:20-alpine
  needs: []
  script:
    - npm ci --cache .npm
    - npm run build
  artifacts:
    paths:
      - public/build/
    expire_in: 1 hour
  cache:
    key: "${CI_COMMIT_REF_SLUG}-npm"
    paths:
      - .npm/
      - node_modules/
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "develop"'

build-docker:
  stage: build
  image: docker:24-dind
  needs: [phpunit]
  services:
    - docker:24-dind
  script:
    - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"
    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA" -t "$CI_REGISTRY_IMAGE:latest" .
    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
    - docker push "$CI_REGISTRY_IMAGE:latest"
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      exists:
        - Dockerfile

container-scanning:
  stage: security
  needs: [build-docker]
  image: aquasec/trivy:latest
  script:
    - trivy image --exit-code 1 --severity HIGH,CRITICAL "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      exists:
        - Dockerfile

deploy-production:
  stage: deploy
  needs: [phpunit, build-assets, container-scanning]
  image: alpine:latest
  environment:
    name: production
    url: https://app.example.com
  before_script:
    - apk add --no-cache openssh-client
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | tr -d '\r' | ssh-add -
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - echo "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
  script:
    - |
      ssh $DEPLOY_USER@$DEPLOY_HOST << 'DEPLOY'
        cd /var/www/app
        git fetch origin main
        git reset --hard origin/main
        composer install --no-dev --optimize-autoloader
        php artisan migrate --force
        php artisan config:cache
        php artisan route:cache
        php artisan view:cache
        php artisan queue:restart
      DEPLOY
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: manual
      allow_failure: false
```

## 总结

从 GitHub Actions 迁移到 GitLab CI/CD 并不复杂，核心变化在于：

1. **配置格式**：从多个 YAML 文件合并为单一 `.gitlab-ci.yml`
2. **依赖编排**：`needs` 关键字实现更灵活的 DAG
3. **安全扫描**：内置 SAST/DAST/Dependency Scanning，无需第三方 Actions
4. **部署管理**：Environment + Manual Approval 的组合更安全
5. **复用机制**：`include` + Templates 比 Actions Marketplace 更统一

迁移后最大的收益是**一体化**：代码、CI/CD、安全扫描、容器注册表、制品管理全在一个平台，减少了集成成本和安全盲区。

对于 Laravel 项目，推荐的 CI/CD 流程：

```
Lint (PHPStan + Pint) → Test (PHPUnit) → Security Scan → Build (Assets + Docker) → Deploy
```

每个环节都有明确的门禁，Pipeline DAG 确保并行执行最大化效率。
