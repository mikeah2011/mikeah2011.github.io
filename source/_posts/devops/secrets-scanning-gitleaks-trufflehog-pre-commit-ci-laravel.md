---

title: Secrets Scanning 实战：gitleaks/trufflehog + pre-commit + CI——Laravel 项目中 API
keywords: [Secrets Scanning, gitleaks, trufflehog, pre, commit, CI, Laravel, API, 项目中, DevOps]
date: 2026-06-09 18:49:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
- secrets-scanning
- Git
- trufflehog
- pre-commit
- CI/CD
- Laravel
- 安全
description: 从 gitleaks 到 trufflehog，从 pre-commit 到 CI pipeline，完整覆盖 Laravel 项目中 API Key、Token、数据库密码等敏感信息泄漏的预防与应急响应方案。
---



## 引言

上周五上线前，同事提交了一个 commit，里面赫然包含了 `.env.local` 文件——数据库密码、AWS Access Key、第三方 API Token 全部暴露在 git 历史中。虽然在 CI 流程中被卡住，但这段历史已经 push 到远程仓库，意味着所有有仓库权限的人都能看到。

这不是个例。根据 GitGuardian 的 2025 年报告，每 10 个公开 GitHub 仓库中就有 1 个包含至少一个暴露的密钥。对于 Laravel 项目来说，`.env` 文件、config 文件、migration 文件都是高风险区域。

本文将完整覆盖：

1. **gitleaks** 和 **trufflehog** 的选型对比与实战配置
2. **pre-commit** 钩子作为本地防线
3. **CI pipeline** 作为最后一道屏障
4. **Laravel 项目**特有的泄漏场景与防护
5. **应急响应**：密钥泄漏后的处理 SOP

<!-- more -->

## 核心概念：为什么要 Secrets Scanning？

### 泄漏的典型场景

```
# 场景 1：.env 文件误提交
git add .
git commit -m "feat: add payment integration"
# .env.local、.env.staging 都被提交了

# 场景 2：硬编码在代码中
$stripe = new \Stripe\StripeClient('sk_live_abc123...');

# 场景 3：migration 文件中的敏感数据
DB::statement('ALTER USER ... IDENTIFIED BY "RealPassword123"');

# 场景 4：日志文件包含 token
Log::info('API response', ['token' => $accessToken]);

# 场景 5：CI/CD 配置文件
# .gitlab-ci.yml 中直接写了 DEPLOY_KEY
```

### 两层防线模型

```
┌─────────────────────────────────────────────┐
│                 开发者本地                    │
│  ┌─────────────────────────────────────┐    │
│  │         pre-commit hook             │    │
│  │    gitleaks detect --staged         │    │
│  └─────────────────────────────────────┘    │
└──────────────────┬──────────────────────────┘
                   │ git push
┌──────────────────▼──────────────────────────┐
│                 CI Pipeline                  │
│  ┌─────────────────────────────────────┐    │
│  │       secrets scanning step         │    │
│  │    gitleaks detect --source .       │    │
│  │    或 trufflehog filesystem .       │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

pre-commit 是**快速反馈**（几秒内拦截），CI 是**兜底保障**（防止绕过本地钩子）。

## gitleaks：Go 生态的 Secrets Scanner

### 安装

```bash
# macOS
brew install gitleaks

# Linux
wget https://github.com/gitleaks/gitleaks/releases/download/v8.18.2/gitleaks_8.18.2_linux_x64.tar.gz
tar -xzf gitleaks_8.18.2_linux_x64.tar.gz
sudo mv gitleaks /usr/local/bin/

# 验证
gitleaks version
# v8.18.2
```

### 基本使用

```bash
# 扫描整个仓库历史
gitleaks detect

# 只扫描 staged 文件（pre-commit 场景）
gitleaks detect --staged

# 指定配置文件
gitleaks detect -c .gitleaks.toml

# 输出 JSON 格式
gitleaks detect -f json -r gitleaks-report.json

# 生成 baseline（忽略已知泄漏）
gitleaks detect -f sarif -r gitleaks-baseline.sarif
```

### Laravel 专用配置

创建 `.gitleaks.toml`：

```toml
# .gitleaks.toml - Laravel 项目专用配置

title = "Laravel Secrets Scanning Config"

# 忽略测试数据中的假密钥
[allowlist]
  description = "Global allowlist"
  paths = [
    '''tests/''',
    '''database/factories/''',
    '''database/seeders/''',
    '''\.example$''',
    '''composer\.lock$''',
    '''package-lock\.json$''',
  ]

# Laravel 配置文件中的误报规则
[[rules]]
  id = "laravel-env-example"
  description = "Allow .env.example with placeholder values"
  regex = '''(?i)(api_key|secret|password|token|credential).*=.*(''')'''
  path = '''\.env\.example$'''
  tags = ["laravel", "env"]

# 允许 config 文件中的加密占位符
[[rules]]
  id = "laravel-config-cipher"
  description = "Allow Laravel cipher defaults"
  regex = '''(?i)APP_KEY=.*'''
  path = '''\.env\.example$'''
  tags = ["laravel", "env"]

# 自定义规则：检测高熵字符串
[[rules]]
  id = "high-entropy-string"
  description = "Detect high entropy strings that might be secrets"
  regex = '''[A-Za-z0-9+/]{40,}={0,2}'''
  entropy = 4.5
  tags = ["entropy", "general"]

# Laravel 的 APP_KEY 检测
[[rules]]
  id = "laravel-app-key"
  description = "Laravel APP_KEY in code"
  regex = '''APP_KEY[=\s]+[A-Za-z0-9+/]{32,}'''
  path = '''\.php$'''
  tags = ["laravel", "key"]

# Stripe Key 检测（区分测试和生产）
[[rules]]
  id = "stripe-live-key"
  description = "Stripe Live Secret Key"
  regex = '''sk_live_[A-Za-z0-9]{24,}'''
  tags = ["stripe", "payment"]

[[rules]]
  id = "stripe-test-key"
  description = "Stripe Test Secret Key"
  regex = '''sk_test_[A-Za-z0-9]{24,}'''
  tags = ["stripe", "test"]
  # 测试密钥可以加入 allowlist
  # allowlist = '''sk_test_'''
```

### 常见误报处理

```bash
# 查看当前仓库的所有泄漏
gitleaks detect -v

# 输出示例：
# Finding:     DB_PASSWORD=RealPassword123
# RuleID:      generic-api-key
# Entropy:     4.2
# File:        .env.local
# StartLine:   8
```

**处理误报的方法：**

```toml
# 方法 1：路径级忽略
[allowlist]
  paths = [
    '''tests/''',
    '''database/factories/''',
  ]

# 方法 2：正则级忽略
[[rules]]
  id = "custom-rule"
  regex = '''MY_API_KEY=.*'''
  allowlist = '''MY_API_KEY=placeholder_value'''
```

## trufflehog：深度扫描专家

### 安装

```bash
# macOS
brew install trufflehog

# Linux
curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin

# 验证
trufflehog --version
```

### gitleaks vs trufflehog 对比

| 特性 | gitleaks | trufflehog |
|------|----------|------------|
| 扫描深度 | Git history + staged | Git history + GitHub/GitLab API |
| 速度 | 快（基于正则） | 慢（支持验证） |
| 密钥验证 | 无 | 支持（Slack、AWS 等） |
| 去重 | 有 | 有（更智能） |
| 输出格式 | JSON/SARIF/CSV | JSON |
| 误报率 | 中 | 低（验证后更低） |
| 资源消耗 | 低 | 高（需要验证） |

**选择建议：**
- **本地开发/pre-commit**：用 gitleaks（速度快，几秒完成）
- **CI/cron**：用 trufflehog（深度扫描，支持验证）
- **应急响应**：两个都用（互补）

### trufflehog 实战

```bash
# 基本扫描
trufflehog filesystem ./

# 扫描 git 仓库（包含历史）
trufflehog git file://./

# 只扫描最近的 commit（适合 CI）
trufflehog git file://./ --since-commit HEAD~5

# 扫描 GitHub 组织的所有仓库
trufflehog github --org=your-org --token=ghp_xxx

# 输出到文件
trufflehog git file://./ --json > trufflehog-report.json

# 验证发现的密钥（真正调用 API 测试）
trufflehog git file://./ --only-verified
```

### trufflehog 的 Laravel 扫描配置

```bash
#!/bin/bash
# scripts/scan-secrets.sh

set -euo pipefail

REPO_DIR="${1:-.}"
REPORT_DIR=".secrets-reports"
mkdir -p "$REPORT_DIR"

echo "=== Step 1: gitleaks 快速扫描 ==="
gitleaks detect \
  -c .gitleaks.toml \
  -f json \
  -r "$REPORT_DIR/gitleaks-report.json" \
  --source "$REPO_DIR" \
  2>&1 || true

LEAK_COUNT=$(cat "$REPORT_DIR/gitleaks-report.json" | jq '. | length' 2>/dev/null || echo "0")
echo "gitleaks 发现 $LEAK_COUNT 个潜在泄漏"

if [ "$LEAK_COUNT" -gt 0 ]; then
  echo ""
  echo "=== 发现泄漏详情 ==="
  cat "$REPORT_DIR/gitleaks-report.json" | jq '.[] | {ruleID, file, startLine, match}'
fi

echo ""
echo "=== Step 2: trufflehog 深度扫描 ==="
trufflehog git "file://$REPO_DIR" \
  --json \
  > "$REPORT_DIR/trufflehog-report.json" 2>&1 || true

echo ""
echo "=== 扫描完成 ==="
echo "报告目录: $REPORT_DIR/"
```

## pre-commit：本地防线

### 安装 pre-commit

```bash
# 安装 pre-commit
pip install pre-commit
# 或
brew install pre-commit

# 进入项目目录
cd ~/GitHub/your-laravel-project
```

### 配置 pre-commit hook

创建 `.pre-commit-config.yaml`：

```yaml
# .pre-commit-config.yaml - Laravel 项目配置

repos:
  # Secrets Scanning（必须放在最前面，优先级最高）
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.2
    hooks:
      - id: gitleaks
        name: gitleaks - Secrets Scanning
        args:
          - --config=.gitleaks.toml
          - --staged

  # Laravel 专用：防止 .env 文件提交
  - repo: local
    hooks:
      - id: prevent-env-commit
        name: prevent-env-commit
        entry: |
          bash -c 'echo "❌ ERROR: 检测到 .env 文件！请将 .env 加入 .gitignore" && exit 1'
        language: system
        files: '\.env$'
        exclude: '\.env\.example$'

      # 防止包含真实密码的 migration 提交
      - id: prevent-hardcoded-password
        name: prevent-hardcoded-password
        entry: |
          bash -c 'grep -rn "IDENTIFIED BY\|PASSWORD\s*=\s*["'"'"']" --include="*.php" | grep -v "example\|fake\|test" && echo "❌ WARNING: 检测到可能的硬编码密码" || true'
        language: system
        files: '\.php$'

  # PHP 代码质量
  - repo: https://github.com/PHP-CS-Fixer/PHP-CS-Fixer
    rev: v3.65.0
    hooks:
      - id: php-cs-fixer
        name: php-cs-fixer
        args: --config=.php-cs-fixer.php --allow-risky=yes

  # 通用
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
        args: [--markdown-linebreak-ext=md]
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
        args: [--maxkb=1000]
```

### 启用 pre-commit

```bash
# 安装所有 hook
pre-commit install

# 手动运行所有 hook（验证配置）
pre-commit run --all-files

# 只运行 gitleaks
pre-commit run gitleaks --all-files

# 更新 hook 版本
pre-commit autoupdate
```

### 实际效果演示

```bash
# 假设你修改了一个文件，staged 了但不小心也 staged 了 .env
$ git add .
$ git commit -m "feat: add payment"

# gitleaks 会立即拦截：
# [gitleaks] gitleaks - Secrets Scanning
# Finding:     DB_PASSWORD=RealPassword123
# RuleID:      generic-api-key
# Entropy:     4.2
# File:        .env
# StartLine:   8
# ✖ 1 leak detected. Skipping commit.

# 提交被阻止，你需要：
# 1. git reset HEAD .env
# 2. echo ".env" >> .gitignore
# 3. git add .gitignore
# 4. git commit -m "feat: add payment"
```

## CI Pipeline：最后一道屏障

### GitHub Actions 配置

```yaml
# .github/workflows/secrets-scan.yml

name: Secrets Scanning

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    # 每周一凌晨 3 点全量扫描
    - cron: '0 3 * * 1'

jobs:
  gitleaks:
    name: gitleaks - Fast Scan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整历史

      - name: gitleaks scan
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}  # 企业版需要
        with:
          args: detect -c .gitleaks.toml -f sarif -r results.sarif

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif

  trufflehog:
    name: trufflehog - Deep Scan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: trufflehog scan
        uses: trufflesecurity/trufflehog@main
        with:
          extra_args: --only-verified --json
```

### GitLab CI 配置

```yaml
# .gitlab-ci.yml

stages:
  - security
  - test
  - deploy

secrets-scan:
  stage: security
  image: zricethezav/gitleaks:latest
  script:
    - gitleaks detect -c .gitleaks.toml -f json -r gitleaks-report.json
  artifacts:
    reports:
      dependency_scanning: gitleaks-report.json
    when: always
  rules:
    - if: $CI_MERGE_REQUEST_ID
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_PIPELINE_SOURCE == "schedule"
```

### Laravel 特有的 CI 检查

```yaml
# .github/workflows/laravel-secrets-check.yml

name: Laravel Secrets Check

on:
  push:
    branches: [main, develop]

jobs:
  check-env-files:
    name: Check .env Files
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check for committed .env files
        run: |
          # 检查 git 历史中是否曾经提交过 .env 文件
          COMMITTED_ENVS=$(git log --all --diff-filter=A --name-only --pretty=format: -- '*.env' '*.env.*' | grep -v '.example' | sort -u | wc -l)

          if [ "$COMMITTED_ENVS" -gt 0 ]; then
            echo "⚠️ WARNING: 发现以下 .env 文件曾经被提交到 git 历史中："
            git log --all --diff-filter=A --name-only --pretty=format: -- '*.env' '*.env.*' | grep -v '.example' | sort -u
            echo ""
            echo "请考虑使用 git-filter-repo 清除这些文件的历史记录。"
            # 这里不强制失败，只是警告
          fi

  check-secrets-in-code:
    name: Check Secrets in PHP Code
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Scan PHP files for hardcoded secrets
        run: |
          echo "扫描 PHP 文件中的硬编码密钥..."

          # 检测硬编码的 API Key
          FOUND=$(grep -rn "sk_live_\|sk_test_\|pk_live_\|pk_test_" \
            --include="*.php" \
            app/ config/ routes/ | grep -v "config\|example" || true)

          if [ -n "$FOUND" ]; then
            echo "❌ 检测到硬编码的 Stripe Key："
            echo "$FOUND"
            exit 1
          fi

          # 检测 AWS Key
          FOUND=$(grep -rn "AKIA[0-9A-Z]\{16\}" \
            --include="*.php" \
            app/ config/ routes/ || true)

          if [ -n "$FOUND" ]; then
            echo "❌ 检测到硬编码的 AWS Access Key："
            echo "$FOUND"
            exit 1
          fi

          echo "✅ PHP 文件中未检测到硬编码密钥"
```

## Laravel 项目常见泄漏场景

### 场景 1：.env 文件管理

```bash
# .gitignore 中必须包含
.env
.env.local
.env.staging
.env.production
.env.*
!.env.example

# 正确的 .env.example（没有真实值）
APP_NAME=KKday
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:8000

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=kkday
DB_USERNAME=root
DB_PASSWORD=

STRIPE_KEY=pk_test_xxx
STRIPE_SECRET=sk_test_xxx
```

### 场景 2：Config 文件中的加密

```php
// ❌ 错误：直接写入真实密钥
// config/services.php
return [
    'stripe' => [
        'secret' => 'sk_live_abc123def456',  // 危险！
    ],
];

// ✅ 正确：使用 env() 读取
// config/services.php
return [
    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
    ],
];
```

### 场景 3：Migration 中的敏感数据

```php
// ❌ 错误：migration 中硬编码密码
Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('email')->unique();
    $table->string('password');
    $table->rememberToken();
    $table->timestamps();
});

// ❌ 错误： Seeder 中使用真实密码
public function run(): void
{
    User::factory()->create([
        'name' => 'Admin',
        'email' => 'admin@realcompany.com',
        'password' => 'RealPassword123!',  // 危险！
    ]);
}

// ✅ 正确：使用假数据
public function run(): void
{
    User::factory()->create([
        'name' => 'Admin',
        'email' => 'admin@example.com',
        'password' => 'password',  // 测试用的通用密码
    ]);
}
```

### 场景 4：日志中的 Token

```php
// ❌ 错误：日志中包含完整 token
Log::info('API request', [
    'url' => $url,
    'headers' => $headers,  // 可能包含 Authorization header
    'token' => $accessToken,  // 危险！
]);

// ✅ 正确：脱敏后再记录
Log::info('API request', [
    'url' => $url,
    'token_prefix' => substr($accessToken, 0, 8) . '...',
]);
```

### 场景 5：Migration 中的密码

```php
// ❌ 错误：直接在 migration 中设置密码
Schema::table('users', function (Blueprint $table) {
    $table->string('api_token')->default('sk_live_abc123');
});

// ✅ 正确：通过 env 或配置
// database/migrations/xxx_add_api_token.php
Schema::table('users', function (Blueprint $table) {
    $table->string('api_token')->nullable();
});

// 在 Seeder 或命令中设置
User::where('email', 'admin@example.com')->update([
    'api_token' => env('ADMIN_API_TOKEN'),
]);
```

### 场景 6：Deployment 脚本

```bash
# ❌ 错误：部署脚本中硬编码密钥
#!/bin/bash
ssh deploy@server "cd /var/www && DB_PASSWORD=RealPassword123 php artisan migrate"

# ✅ 正确：从环境变量读取
#!/bin/bash
ssh deploy@server "cd /var/www && php artisan migrate --force"
# 密钥通过 CI/CD 的 secret 变量注入
```

## 应急响应：密钥泄漏处理 SOP

### 第一步：立即评估影响

```bash
# 1. 检查泄漏的密钥类型和范围
gitleaks detect -v

# 2. 检查是哪些分支包含泄漏
git branch -a --contains <commit-hash>

# 3. 检查是否有外部人员有访问权限
# （查看 GitHub/GitLab 的 collaborator 列表）
```

### 第二步：轮换密钥

```bash
# 根据泄漏类型，立即轮换

# AWS Key 泄漏
aws iam delete-access-key --access-key-id AKIA... --user-name <user>
aws iam create-access-key --user-name <user>

# Stripe Key 泄漏
# 登录 Stripe Dashboard → Developers → API Keys → Roll Key

# 数据库密码泄漏
mysql -u root -p
ALTER USER 'app_user'@'%' IDENTIFIED BY 'NewRandomPassword123!';

# GitHub Token 泄漏
# Settings → Developer settings → Personal access tokens → Revoke
```

### 第三步：清除 Git 历史

```bash
# 方法 1：git-filter-repo（推荐）
pip install git-filter-repo

# 清除 .env 文件的所有历史
git filter-repo --path .env --invert-paths

# 清除包含特定密钥的 commit
git filter-repo --replace-text expressions.txt

# expressions.txt 内容：
# sk_live_abc123def456==>REMOVED
# RealPassword123==>REMOVED

# 方法 2：BFG Repo-Cleaner（更快）
java -jar bfg.jar --strip-blobs-bigger-than 10M repo.git
java -jar bfg.jar --delete-files .env repo.git

# 方法 3：手动 rebase（只适用于最近的 commit）
git rebase -i <commit-before-leak>
# 将包含泄漏的 commit 标记为 edit
# 修改文件，移除泄漏内容
# git add . && git commit --amend
# git rebase --continue
```

### 第四步：强制推送（危险操作）

```bash
# ⚠️ 警告：这会改变所有 commit hash，需要通知所有协作者
git push origin --force --all
git push origin --force --tags

# 如果有远程保护分支，需要先临时关闭保护
```

### 第五步：通知和审计

```bash
# 1. 通知团队成员
#    - 发送邮件/Slack 说明情况
#    - 要求所有人重新拉取仓库

# 2. 审计访问日志
#    - 检查 GitHub/GitLab 的访问日志
#    - 查看谁在泄漏期间访问过仓库

# 3. 检查是否有滥用
#    - 监控 API 调用日志
#    - 检查是否有异常访问

# 4. 更新文档
#    - 记录泄漏事件
#    - 更新安全策略
```

## 进阶：Secrets Scanning 与 Laravel Telescope

Laravel Telescope 可以帮助发现运行时的敏感信息泄漏：

```php
// app/Providers/TelescopeServiceProvider.php
public function register(): void
{
    Telescope::night();

    // 过滤敏感字段
    Telescope::tag(function (IncomingEntry $entry) {
        $tags = [];

        // 为包含敏感信息的请求添加标签
        if ($entry->type === 'request') {
            $data = $entry->data['request']['data'] ?? [];
            foreach ($data as $key => $value) {
                if (str_contains($key, 'password') || str_contains($key, 'token')) {
                    $tags[] = 'sensitive-data';
                    break;
                }
            }
        }

        return $tags;
    });
}
```

## 完整的 Laravel 项目安全检查清单

```bash
#!/bin/bash
# scripts/security-checklist.sh

echo "=== Laravel 项目安全检查清单 ==="
echo ""

# 1. 检查 .gitignore
echo "1. 检查 .gitignore 配置"
if grep -q "\.env$" .gitignore 2>/dev/null; then
    echo "   ✅ .env 已在 .gitignore 中"
else
    echo "   ❌ .env 不在 .gitignore 中！"
fi

if grep -q "\.env\.\*$" .gitignore 2>/dev/null; then
    echo "   ✅ .env.* 已在 .gitignore 中"
else
    echo "   ⚠️ 建议在 .gitignore 中添加 .env.*"
fi

# 2. 检查是否有 .env 文件被提交
echo ""
echo "2. 检查 git 中的 .env 文件"
if git ls-files | grep -E '\.env$|\.env\.' | grep -v '\.example$' | grep -q .; then
    echo "   ❌ 发现已提交的 .env 文件："
    git ls-files | grep -E '\.env$|\.env\.' | grep -v '\.example$'
else
    echo "   ✅ git 中没有 .env 文件"
fi

# 3. 检查 config 文件
echo ""
echo "3. 检查 config 文件中的硬编码密钥"
if grep -rn "secret.*=.*['\"][a-zA-Z0-9+/]\{20,\}" config/ | grep -v "env(" | grep -q .; then
    echo "   ⚠️ 发现可能的硬编码密钥："
    grep -rn "secret.*=.*['\"][a-zA-Z0-9+/]\{20,\}" config/ | grep -v "env("
else
    echo "   ✅ config 文件中未发现硬编码密钥"
fi

# 4. 运行 gitleaks
echo ""
echo "4. 运行 gitleaks 扫描"
if command -v gitleaks &> /dev/null; then
    gitleaks detect -c .gitleaks.toml -v 2>&1 | tail -5
else
    echo "   ⚠️ gitleaks 未安装"
fi

# 5. 检查 pre-commit
echo ""
echo "5. 检查 pre-commit 配置"
if [ -f .pre-commit-config.yaml ]; then
    if grep -q "gitleaks" .pre-commit-config.yaml; then
        echo "   ✅ pre-commit 已配置 gitleaks"
    else
        echo "   ⚠️ pre-commit 中未配置 gitleaks"
    fi
else
    echo "   ⚠️ 未找到 .pre-commit-config.yaml"
fi

echo ""
echo "=== 检查完成 ==="
```

## 总结

### 核心原则

1. **预防优于修复**：在代码提交前就拦截，而不是泄漏后补救
2. **多层防御**：pre-commit（本地）+ CI（远程）+ 定期全量扫描
3. **自动化优先**：手动检查不可靠，自动化是唯一选择
4. **最小暴露**：密钥只在需要的地方出现，其他地方用 `env()` 引用

### 推荐的 Laravel 项目安全配置

```
pre-commit (gitleaks --staged)    → 本地快速拦截
CI pipeline (gitleaks)            → push 时验证
定期 cron (trufflehog)            → 每周深度扫描
git-filter-repo                  → 应急清除历史
```

### 工具选择

| 场景 | 工具 | 理由 |
|------|------|------|
| 本地开发 | gitleaks | 速度快，秒级反馈 |
| CI/CD | gitleaks + trufflehog | 互补，gitleaks 快速筛选，trufflehog 深度验证 |
| 应急响应 | git-filter-repo | 清除 git 历史 |
| 定期扫描 | trufflehog | 支持 GitHub API，能扫描整个组织 |

### 最后提醒

**密钥泄漏不是「如果」的问题，而是「何时」的问题。** 做好 Secrets Scanning 是现代开发团队的基本功。不要等到出事了才想起配置——现在就花 30 分钟把 gitleaks 和 pre-commit 配好，可能省下几天的应急处理时间。

---

*本文配套代码和配置文件已整理到 GitHub 仓库，可直接复用到你的 Laravel 项目中。*
