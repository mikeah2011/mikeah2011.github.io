---

title: SonarQube + CodeClimate 实战：代码质量量化治理——Laravel 30+ 仓库的技术债务仪表盘与 CI 门禁
keywords: [SonarQube, CodeClimate, Laravel, CI, 代码质量量化治理, 仓库的技术债务仪表盘与, 门禁, DevOps]
date: 2026-06-10 05:09:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
- SonarQube
- CodeClimate
- 代码质量
- 技术债
- CI/CD
- Laravel
- PHPStan
- 静态分析
description: 从零搭建 SonarQube + CodeClimate 双引擎代码质量治理体系，覆盖 Laravel 30+ 仓库的静态分析、重复代码检测、技术债务量化、CI 门禁卡控。含 Docker Compose 部署、Quality Gate 配置、GitHub Actions 集成、自定义规则、仪表盘设计与团队落地实践。
---



# SonarQube + CodeClimate 实战：代码质量量化治理

当仓库数量超过 30 个，代码质量的管理就不再是"靠 Code Review 眼睛扫"能解决的了。你需要一套自动化的量化体系：每个 PR 合入前自动检测代码异味、重复率、测试覆盖率、复杂度，不达标的直接卡住——这就是代码质量门禁（Quality Gate）。

本文将从零搭建 SonarQube + CodeClimate 双引擎方案，覆盖部署、配置、CI 集成、仪表盘设计和团队落地全流程。

## 为什么需要两个工具？

SonarQube 和 CodeClimate 并不是二选一，它们的侧重点不同：

| 维度 | SonarQube | CodeClimate |
|------|-----------|-------------|
| 强项 | 规则丰富、可自定义、支持私有部署 | 代码气味检测、可维护性评分、GitHub 原生集成 |
| 弱项 | UI 相对传统、配置复杂 | 规则不如 SonarQube 精细、SaaS 依赖 |
| 适合场景 | 技术债务量化、CI 门禁卡控 | PR 级别的快速反馈、代码可维护性评估 |
| 部署方式 | 自托管 (Docker) | SaaS 或 Self-Hosted |

**我们的策略：** SonarQube 做主力的质量门禁和仪表盘，CodeClimate 做 PR 级别的快速反馈（GitHub Check 原生集成体验好）。

## 一、SonarQube 部署（Docker Compose）

### 1.1 基础部署

```yaml
# docker-compose.sonarqube.yml
version: '3.8'

services:
  sonarqube:
    image: sonarqube:10-community
    container_name: sonarqube
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "9000:9000"
    environment:
      SONAR_JDBC_URL: jdbc:postgresql://db:5432/sonar
      SONAR_JDBC_USERNAME: sonar
      SONAR_JDBC_PASSWORD: ${SONAR_DB_PASSWORD}
      # 性能调优
      SONAR_ES_BOOTSTRAP_CHECKS_DISABLE: 'true'
      SONAR_WEB_JAVAADDITIONALOPTS: '-Xmx1g'
      SONAR_CE_JAVAADDITIONALOPTS: '-Xmx2g'
    volumes:
      - sonarqube_data:/opt/sonarqube/data
      - sonarqube_extensions:/opt/sonarqube/extensions
      - sonarqube_logs:/opt/sonarqube/logs
    ulimits:
      nofile:
        soft: 131072
        hard: 131072
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    container_name: sonarqube-db
    environment:
      POSTGRES_USER: sonar
      POSTGRES_PASSWORD: ${SONAR_DB_PASSWORD}
      POSTGRES_DB: sonar
    volumes:
      - postgresql_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sonar"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  sonarqube_data:
  sonarqube_extensions:
  sonarqube_logs:
  postgresql_data:
```

```bash
# 启动
SONAR_DB_PASSWORD=your_secure_password docker compose -f docker-compose.sonarqube.yml up -d

# 首次登录：http://localhost:9000  (admin / admin，会要求改密码)
```

### 1.2 内核参数调整（Linux 生产环境）

SonarQube 的 Elasticsearch 需要调大 `vm.max_map_count`：

```bash
# 临时生效
sudo sysctl -w vm.max_map_count=524288

# 永久生效
echo "vm.max_map_count=524288" | sudo tee -a /etc/sysctl.conf
```

macOS Docker Desktop 默认够用，无需额外调整。

## 二、创建项目与 Quality Gate

### 2.1 通过 API 创建项目

```bash
# 创建项目
curl -u admin:your_new_password -X POST "http://localhost:9000/api/projects/create" \
  -d "name=kkday-b2c-api" \
  -d "project=kkday-b2c-api" \
  -d "mainBranch=main"

# 生成 Token（用于 CI）
curl -u admin:your_new_password -X POST "http://localhost:9000/api/user_tokens/generate" \
  -d "name=ci-token" \
  -d "type=PROJECT_ANALYSIS_TOKEN" \
  -d "projectKey=kkday-b2c-api"
```

### 2.2 自定义 Quality Gate

默认的 "Sonar way" 太宽松，我们定义一个更严格的门禁：

```bash
# 创建自定义 Quality Gate
curl -u admin:your_new_password -X POST "http://localhost:9000/api/qualitygates/create" \
  -d "name=Laravel-Strict"

# 添加条件
GATE="Laravel-Strict"

# 新代码覆盖率 >= 80%
curl -u admin:your_new_password -X POST "http://localhost:9000/api/qualitygates/add_condition" \
  -d "gateName=$GATE" -d "metric=new_coverage" -d "op=LT" -d "error=80"

# 新代码重复率 <= 3%
curl -u admin:your_new_password -X POST "http://localhost:9000/api/qualitygates/add_condition" \
  -d "gateName=$GATE" -d "metric=new_duplicated_lines_density" -d "op=GT" -d "error=3"

# 新代码可维护性评级 A
curl -u admin:your_new_password -X POST "http://localhost:9000/api/qualitygates/add_condition" \
  -d "gateName=$GATE" -d "metric=new_reliability_rating" -d "op=GT" -d "error=1"

# 新代码可靠性评级 A
curl -u admin:your_new_password -X POST "http://localhost:9000/api/qualitygates/add_condition" \
  -d "gateName=$GATE" -d "metric=new_security_rating" -d "op=GT" -d "error=1"

# 新代码安全评级 A
curl -u admin:your_new_password -X POST "http://localhost:9000/api/qualitygates/add_condition" \
  -d "gateName=$GATE" -d "metric=new_maintainability_rating" -d "op=GT" -d "error=1"

# 设为默认
curl -u admin:your_new_password -X POST "http://localhost:9000/api/qualitygates/set_as_default" \
  -d "name=$GATE"
```

### 2.3 Quality Gate 条件说明

| 条件 | 阈值 | 含义 |
|------|------|------|
| `new_coverage` < 80 | Error | 新代码测试覆盖率不低于 80% |
| `new_duplicated_lines_density` > 3 | Error | 新代码重复率不超过 3% |
| `new_reliability_rating` > A | Error | 无 Bug（A 级） |
| `new_security_rating` > A | Error | 无安全漏洞（A 级） |
| `new_maintainability_rating` > A | Error | 无代码异味（A 级） |

**关键点：** 只针对 `new_` 前缀的指标——只管增量代码，不追溯历史债务。这样团队不会被存量问题吓退。

## 三、Laravel 项目集成 SonarQube

### 3.1 项目配置文件

在 Laravel 项目根目录创建 `sonar-project.properties`：

```properties
# sonar-project.properties
sonar.projectKey=kkday-b2c-api
sonar.projectName=kkday-b2c-api
sonar.projectVersion=1.0

# 源码目录
sonar.sources=app,config,database/factories,database/seeders,routes
sonar.tests=tests
sonar.exclusions=**/vendor/**,**/node_modules/**,**/storage/**,**/bootstrap/cache/**

# PHP 覆盖率报告（PHPUnit 生成）
sonar.php.coverage.reportPaths=coverage.xml

# PHP 代码嗅探报告（可选，需要 phpstan 生成）
sonar.php.phpstan.reportPaths=phpstan-report.json

# 编码
sonar.sourceEncoding=UTF-8

# PHP 语言版本
sonar.php.version=8.4

# 分支分析（社区版不支持分支，只支持 main）
sonar.branch.name=main
```

### 3.2 生成覆盖率报告

```bash
# composer.json 添加依赖
composer require --dev phpunit/phpunit phpstan/phpstan

# 运行测试并生成覆盖率
php -d pcov.enabled=1 vendor/bin/phpunit --coverage-clover=coverage.xml

# 或者用 Xdebug（性能稍差）
XDEBUG_MODE=coverage vendor/bin/phpunit --coverage-clover=coverage.xml
```

> **pcov vs Xdebug：** pcov 是专门为覆盖率设计的扩展，性能是 Xdebug 的 5-10 倍。CI 环境强烈推荐 pcov。

### 3.3 GitHub Actions 集成

```yaml
# .github/workflows/sonarqube.yml
name: SonarQube Analysis

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  sonarqube:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整历史来计算 new code

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          extensions: pcov
          coverage: pcov

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist

      - name: Run tests with coverage
        run: php -d pcov.enabled=1 vendor/bin/phpunit --coverage-clover=coverage.xml

      - name: SonarQube Scan
        uses: SonarSource/sonarqube-scan-action@v2
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}

      - name: Quality Gate check
        uses: SonarSource/sonarqube-quality-gate-action@v1
        timeout-minutes: 5
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

**Quality Gate Action** 会在 PR 上创建一个 Check，不通过时直接标红，阻断合并。

## 四、CodeClimate 集成

### 4.1 启用 CodeClimate

1. 登录 [codeclimate.com](https://codeclimate.com)（GitHub OAuth）
2. Add Repository → 选择你的仓库
3. 获取 `CC_TEST_REPORTER_ID`

### 4.2 GitHub Actions 集成

```yaml
# .github/workflows/codeclimate.yml
name: CodeClimate

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  codeclimate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          extensions: pcov
          coverage: pcov

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist

      - name: Setup CodeClimate test reporter
        run: |
          curl -L https://codeclimate.com/downloads/test-reporter/test-reporter-latest-linux-amd64 > ./cc-test-reporter
          chmod +x ./cc-test-reporter
          ./cc-test-reporter before-build

      - name: Run tests with coverage
        run: php -d pcov.enabled=1 vendor/bin/phpunit --coverage-clover=clover.xml

      - name: Upload coverage
        run: ./cc-test-reporter after-build --coverage-input-type clover
        env:
          CC_TEST_REPORTER_ID: ${{ secrets.CC_TEST_REPORTER_ID }}
```

### 4.3 CodeClimate 配置文件

在项目根目录创建 `.codeclimate.yml`：

```yaml
# .codeclimate.yml
version: "2"

plugins:
  phpcodesniffer:
    enabled: true
    config:
      standard: PSR12
  phpmd:
    enabled: true
    config:
      rulesets:
        - cleancode
        - codesize
        - design
        - naming
        - unusedcode
  sonar-php:
    enabled: true
  duplication:
    enabled: true
    config:
      languages:
        php:
          mass_threshold: 50

exclude_patterns:
  - "vendor/"
  - "node_modules/"
  - "storage/"
  - "bootstrap/cache/"
  - "database/migrations/"
  - "tests/"
  - "*.blade.php"

checks:
  argument-count:
    config:
      threshold: 5
  complex-logic:
    config:
      threshold: 4
  file-lines:
    config:
      threshold: 500
  method-complexity:
    config:
      threshold: 8
  method-count:
    config:
      threshold: 20
  method-lines:
    config:
      threshold: 50
  nested-control-flow:
    config:
      threshold: 4
  return-statements:
    config: 4
  similar-code:
    config:
      threshold:
        php: 60
  identical-code:
    config:
      threshold:
        php: 40
```

## 五、PHPStan 深度静态分析

SonarQube 的 PHP 分析相对基础。配合 PHPStan 做更深度的类型检查：

### 5.1 配置 PHPStan

```yaml
# phpstan.neon
includes:
  - vendor/larastan/larastan/extension.neon

parameters:
  paths:
    - app
  level: 6  # 0-9，建议从 6 开始
  ignoreErrors:
    - '#Call to an undefined method Illuminate\\Database\\Eloquent\\Builder::#'
    - '#Call to an undefined method Illuminate\\Database\\Query\\Builder::#'
  checkMissingIterableValueType: true
  checkGenericClassInNonGenericObjectType: true
  reportUnmatchedIgnoredErrors: false

  # Laravel 特定
  databaseMigrationsPath:
    - database/migrations
```

```bash
# 安装
composer require --dev nunomaduro/larastan

# 运行
vendor/bin/phpstan analyse --error-format=json > phpstan-report.json
```

### 5.2 CI 集成 PHPStan

```yaml
# 添加到 sonarqube.yml
- name: Run PHPStan
  run: vendor/bin/phpstan analyse --error-format=json > phpstan-report.json || true
```

SonarQube 会读取 `phpstan-report.json`，将高级静态分析结果纳入质量评估。

## 六、批量管理 30+ 仓库

### 6.1 Shell 脚本批量创建项目

```bash
#!/bin/bash
# scripts/batch-create-sonar-projects.sh

SONAR_URL="http://localhost:9000"
SONAR_USER="admin"
SONAR_PASS="your_password"
QUALITY_GATE="Laravel-Strict"

REPOS=(
  "kkday-b2c-api"
  "kkday-admin-api"
  "kkday-payment-service"
  "kkday-notification-service"
  # ... 添加你的所有仓库
)

for repo in "${REPOS[@]}"; do
  echo "Creating project: $repo"

  # 创建项目
  curl -s -u "$SONAR_USER:$SONAR_PASS" \
    -X POST "$SONAR_URL/api/projects/create" \
    -d "name=$repo" \
    -d "project=$repo" \
    -d "mainBranch=main"

  # 设置 Quality Gate
  curl -s -u "$SONAR_USER:$SONAR_PASS" \
    -X POST "$SONAR_URL/api/qualitygates/project_association" \
    -d "projectKey=$repo" \
    -d "gateName=$QUALITY_GATE"

  echo " ✓ $repo created with $QUALITY_GATE"
done
```

### 6.2 共享配置模板

创建一个 Git 仓库存放共享配置，各项目通过 Git Submodule 引入：

```bash
# 项目中引入
git submodule add git@github.com:your-org/ci-templates.git .ci

# sonar-project.properties 引用
cat > sonar-project.properties << 'EOF'
sonar.projectKey=${CI_PROJECT_NAME}
sonar.sources=app,config,database/factories,database/seeders,routes
sonar.tests=tests
sonar.exclusions=**/vendor/**
sonar.php.coverage.reportPaths=coverage.xml
sonar.sourceEncoding=UTF-8
EOF
```

## 七、质量仪表盘设计

### 7.1 SonarQube 仪表盘

SonarQube 内置的 Portfolio（企业版）或 Quality Profiles 就够用。社区版可以通过 API 自建 Grafana 仪表盘：

```python
#!/usr/bin/env python3
# scripts/sonar-dashboard.py
"""从 SonarQube API 拉取指标，生成 JSON 供 Grafana 消费"""

import requests
import json
from datetime import datetime

SONAR_URL = "http://localhost:9000"
TOKEN = "your_ci_token"

def get_project_metrics(project_key):
    resp = requests.get(f"{SONAR_URL}/api/measures/component", params={
        "component": project_key,
        "metricKeys": "coverage,duplicated_lines_density,ncloc,bugs,vulnerabilities,code_smells,sqale_rating,reliability_rating,security_rating"
    }, auth=(TOKEN, ""))
    data = resp.json()
    metrics = {}
    for m in data.get("component", {}).get("measures", []):
        metrics[m["metric"]] = m.get("value", "N/A")
    return metrics

def get_quality_gate_status(project_key):
    resp = requests.get(f"{SONAR_URL}/api/qualitygates/project_status", params={
        "projectKey": project_key
    }, auth=(TOKEN, ""))
    return resp.json().get("projectStatus", {})

# 批量拉取
projects = ["kkday-b2c-api", "kkday-admin-api", "kkday-payment-service"]
results = []

for proj in projects:
    metrics = get_project_metrics(proj)
    qg = get_quality_gate_status(proj)
    results.append({
        "project": proj,
        "quality_gate": qg.get("status", "UNKNOWN"),
        "coverage": metrics.get("coverage", "N/A"),
        "duplicated_lines_density": metrics.get("duplicated_lines_density", "N/A"),
        "bugs": metrics.get("bugs", "0"),
        "vulnerabilities": metrics.get("vulnerabilities", "0"),
        "code_smells": metrics.get("code_smells", "0"),
        "lines_of_code": metrics.get("ncloc", "0"),
        "timestamp": datetime.utcnow().isoformat()
    })

print(json.dumps(results, indent=2))
```

### 7.2 Grafana 可视化

用 Grafana 的 JSON API 数据源连接上述脚本输出，关键面板：

1. **质量门禁状态总览**：所有项目的 PASS/FAIL 状态
2. **覆盖率趋势**：每个项目近 30 天的覆盖率变化
3. **技术债务分布**：Bug / Vulnerability / Code Smell 数量堆叠图
4. **代码重复率排行**：找出重复最严重的项目
5. **代码行数 vs 质量**：气泡图，X 轴代码量，Y 轴覆盖率，气泡大小是 Bug 数

## 八、CI 门禁实战流程

### 8.1 完整的 PR 流程

```
开发者 push PR
       │
       ▼
┌─────────────────────┐
│  GitHub Actions      │
│  ┌───────────────┐  │
│  │ PHPUnit 测试   │  │
│  │ (覆盖率报告)   │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ PHPStan 分析   │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ SonarQube 扫描 │  │
│  │ + Quality Gate │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ CodeClimate    │  │
│  │ 可维护性评分   │  │
│  └───────┬───────┘  │
└──────────┼──────────┘
           ▼
    ┌──────────────┐
    │  PR Check 结果 │
    │  ✅ PASS      │
    │  ❌ FAIL      │
    └──────┬───────┘
           ▼
    ┌──────────────┐
    │  Branch保护规则│
    │  "必须通过    │
    │   Quality Gate"│
    └──────────────┘
```

### 8.2 GitHub Branch Protection 配置

```bash
# 使用 GitHub CLI
gh api repos/your-org/kkday-b2c-api/branches/main/protection \
  -X PUT \
  -f '{
    "required_status_checks": {
      "strict": true,
      "contexts": ["SonarQube Quality Gate", "CodeClimate"]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "required_approving_review_count": 1
    }
  }'
```

### 8.3 允许紧急绕过

```bash
# 紧急情况：管理员可以跳过 Quality Gate
# 在 PR 描述中添加 [skip-quality-gate]，然后通过 GitHub Actions 条件跳过
```

```yaml
# 在 workflow 中
- name: Quality Gate check
  if: "!contains(github.event.pull_request.body, '[skip-quality-gate]')"
  uses: SonarSource/sonarqube-quality-gate-action@v1
```

> ⚠️ 绕过操作必须记录日志，定期审计绕过次数。

## 九、踩坑记录

### 坑 1：SonarQube 社区版不支持多分支分析

社区版只能分析 `main` 分支。如果要分析每个 PR 的分支差异：

**方案 A（推荐）：** 使用 `sonar.pullrequest.key` 和 `sonar.pullrequest.branch` 参数：

```yaml
- name: SonarQube Scan
  uses: SonarSource/sonarqube-scan-action@v2
  env:
    SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
    SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
  with:
    args: >
      -Dsonar.pullrequest.key=${{ github.event.pull_request.number }}
      -Dsonar.pullrequest.branch=${{ github.head_ref }}
      -Dsonar.pullrequest.base=${{ github.base_ref }}
```

**方案 B：** 升级到 Developer Edition（付费）。

### 坑 2：覆盖率报告为 0

```bash
# 检查覆盖率文件是否生成
ls -la coverage.xml

# 确认 pcov 已启用
php -m | grep pcov

# 确认 SonarQube 配置路径正确
cat sonar-project.properties | grep coverage
```

常见原因：
- 忘记加 `--coverage-clover=coverage.xml`
- pcov 未安装或未启用
- 文件路径不对（SonarQube 工作目录和 CI 工作目录不一致）

### 坑 3：PHPStan 和 Larastan 版本冲突

```bash
# 锁定兼容版本
composer require --dev phpstan/phpstan:^1.10 nunomaduro/larastan:^2.0

# 如果 Laravel 版本较旧
composer require --dev nunomaduro/larastan:^1.0
```

### 坑 4：CodeClimate 分析超时

大仓库分析可能超时，调整配置：

```yaml
# .codeclimate.yml 顶部
version: "2"
exclude_patterns:
  - "vendor/"
  - "node_modules/"
  - "database/migrations/"  # migration 文件通常不需要分析
  - "*.blade.php"           # 模板文件排除
```

### 坑 5：SonarQube Docker 内存不足

```yaml
# docker-compose.yml 调整
environment:
  SONAR_WEB_JAVAADDITIONALOPTS: '-Xmx2g'
  SONAR_CE_JAVAADDITIONALOPTS: '-Xmx4g'
  SONAR_SEARCH_JAVAADDITIONALOPTS: '-Xmx1g'
```

生产环境建议最少 4GB 内存给 SonarQube 容器。

## 十、落地策略

### 阶段一：先上车（1-2 周）

1. 部署 SonarQube，只监控不卡控
2. 所有仓库接入扫描，收集基线数据
3. 团队看到当前状态：覆盖率 30%，重复率 12%，127 个 Bug

### 阶段二：渐进收紧（2-4 周）

1. 设置 Quality Gate，但阈值放宽（覆盖率 50%，重复率 5%）
2. PR 上显示结果但不阻断合并
3. 每周回顾质量趋势

### 阶段三：严格门禁（4-8 周）

1. 收紧阈值到目标值（覆盖率 80%，重复率 3%）
2. 开启阻断合并
3. 建立技术债务看板，每周清理 Top 5

### 阶段四：持续优化

1. 自定义 PHPStan 规则（团队编码规范）
2. 定期审计绕过记录
3. 质量指标纳入绩效看板（不是为了考核，是为了透明）

## 总结

| 组件 | 职责 | 部署 |
|------|------|------|
| SonarQube | 主力质量门禁、技术债务量化 | Docker 自托管 |
| CodeClimate | PR 级快速反馈、可维护性评分 | SaaS |
| PHPStan/Larastan | 深度类型检查 | CI 集成 |
| Grafana | 可视化仪表盘 | Docker 自托管 |
| GitHub Actions | CI 编排、门禁执行 | GitHub 原生 |

核心原则：

1. **只管增量**：Quality Gate 只检查新代码，不追溯历史债务
2. **渐进收紧**：先收集数据，再逐步提高标准
3. **自动化一切**：人工 Code Review 负责逻辑和设计，机器负责规则和指标
4. **透明可见**：所有指标公开，技术债务人人可见

代码质量不是一次性工程，是持续投入。SonarQube + CodeClimate 给你的是度量能力——你无法改善你不度量的东西。
