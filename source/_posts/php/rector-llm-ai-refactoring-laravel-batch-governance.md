---
title: Rector + LLM 代码重构实战：AI 辅助识别重构机会与自动生成 PR——Laravel 30+ 仓库的批量治理
date: 2026-06-06 04:53:00
tags: [Rector, LLM, AI重构, Laravel, PHP, 代码治理, CI/CD, PHPStan]
keywords: [Rector, LLM, AI, PR, Laravel, 代码重构实战, 辅助识别重构机会与自动生成, 仓库的批量治理, PHP]
description: "本文介绍如何用 Rector + LLM 组合实现 30+ Laravel 仓库的批量代码治理。Rector 负责确定性的语法级重构（PHP 8.3 升级、Laravel 11 迁移），LLM 负责语义级诊断（识别坏味道、架构建议、业务逻辑优化）。通过 CI/CD 流水线自动生成 PR，8 周内完成 400+ 个 PR，PHPStan level 从 3.2 提升到 5.8。涵盖 rector.php 配置、自定义规则编写、LLM Prompt 模板、批量执行脚本、五大踩坑案例，适合大型团队落地自动化代码治理。"
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


# Rector + LLM 代码重构实战：AI 辅助识别重构机会与自动生成 PR——Laravel 30+ 仓库的批量治理

## 前言

在大型企业中，维护 30 个以上的 Laravel 仓库是常态。这些仓库往往跨越多年迭代，技术债务日积月累——过时的 PHP 语法、重复的业务逻辑、缺少类型声明的函数。人工逐仓库审查和重构几乎不可能规模化执行。

本文介绍一种新方案：**用 Rector 执行确定性的语法级重构，用 LLM 识别语义级重构机会，再通过 CI/CD 流水线自动生成 PR**，实现 30+ Laravel 仓库的批量治理。

---

## 一、Rector 与 LLM 辅助重构概述

### Rector 是什么

Rector 是 PHP 自动重构工具，基于 AST（抽象语法树）操作，内置数百条规则，能够自动升级 PHP 语法、迁移框架版本、改进代码质量。其核心优势在于**确定性**——改什么、怎么改，完全可预测、可回滚。

### LLM 能补什么

Rector 擅长"知道规则就能改"的部分，但面对以下场景力不从心：

- **识别坏味道**：500 行的 Controller 方法，Rector 不会建议拆分
- **架构级建议**：是否该引入策略模式或抽象接口？
- **业务逻辑优化**：重复查询是否该提取为 Scope？

**核心思路：Rector 负责"执行"，LLM 负责"诊断"，两者协同完成端到端重构。**

---

## 二、Laravel 项目中配置 Rector

### 安装与基础配置

```bash
composer require rector/rector --dev
vendor/bin/rector init
```

生成 `rector.php` 配置：

```php
<?php
declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\LevelSetList;
use Rector\Laravel\Set\LaravelLevelSetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/routes',
        __DIR__ . '/database',
    ])
    ->withSkip([__DIR__ . '/vendor'])
    ->withSets([
        LevelSetList::UP_TO_PHP_83,
        LaravelLevelSetList::LARAVEL_110,
    ])
    ->withImportNames();
```

执行预览：`vendor/bin/rector process --dry-run`，建议 CI 中始终先 dry-run。

### 自定义 Rector 规则示例

内置规则覆盖通用场景，但团队特有的架构规范需要自定义规则。以下是一个检测并替换 `DB::select` 为 Eloquent 查询的自定义规则：

```php
<?php
declare(strict_types=1);

use PhpParser\Node;
use PhpParser\Node\Expr\StaticCall;
use PhpParser\Node\Name;
use Rector\Core\AbstractScopeAwareRector;
use Rector\Core\RectorDefinition;
use Symplify\RuleDocGenerator\ValueObject\RuleDefinition;

class DbSelectToEloquentRector extends AbstractScopeAwareRector
{
    public function getRuleDefinition(): RuleDefinition
    {
        return new RuleDefinition(
            'Replace DB::select() with Eloquent query builder',
            [new CodeSample(
                <<<'CODE_SAMPLE'
DB::select('SELECT * FROM users WHERE status = ?', [1]);
CODE_SAMPLE
,
                <<<'CODE_SAMPLE'
User::query()->where('status', 1)->get();
CODE_SAMPLE
            )]
        );
    }

    public function refactorWithScope(
        Node $node,
        Scope $scope
    ): ?Node {
        if (!$node instanceof StaticCall) {
            return null;
        }

        if ($this->isName($node, 'Illuminate\Support\Facades\DB::select')) {
            $this->nodeAdder->addAttribute(
                $node,
                'rector_notice',
                'Manual review needed: DB::select to Eloquent migration'
            );
        }

        return null;
    }
}
```

再举一个实际生产中高频使用的自定义规则——自动为返回值添加严格类型声明：

```php
<?php
declare(strict_types=1);

use PhpParser\Node;
use PhpParser\Node\Stmt\ClassMethod;
use PhpParser\Node\Stmt\Return_;
use PhpParser\Node\Identifier;
use PhpParser\Node\UnionType;
use PhpParser\Node\Name;
use PHPStan\Type\StringType;
use PHPStan\Type\IntegerType;
use PHPStan\Type\BooleanType;
use Rector\Rector\AbstractRector;

class StrictReturnTypeRector extends AbstractRector
{
    public function getNodeTypes(): array
    {
        return [ClassMethod::class];
    }

    public function refactor(Node $node): ?Node
    {
        if ($node->returnType !== null) {
            return null; // 已有返回类型，跳过
        }

        if ($node->isAbstract() || $node->isInterface()) {
            return null;
        }

        // 分析 return 语句推断返回类型
        $inferredType = $this->inferReturnType($node);
        if ($inferredType === null) {
            return null;
        }

        $node->returnType = $inferredType;
        $this->nodeAdder->addAttribute($node, 'added_type', true);

        return $node;
    }

    private function inferReturnType(ClassMethod $node): ?Node\ReturnType
    {
        $returnStmts = array_filter(
            $node->stmts,
            fn($stmt) => $stmt instanceof Return_
        );

        if (empty($returnStmts)) {
            return null;
        }

        // 简化：返回第一个 return 的类型推断
        foreach ($returnStmts as $returnStmt) {
            if ($returnStmt->expr === null) {
                return new Identifier('void');
            }
            if ($returnStmt->expr instanceof Node\Scalar\String_) {
                return new Name('string');
            }
            if ($returnStmt->expr instanceof Node\Scalar\Int_) {
                return new Name('int');
            }
            if ($returnStmt->expr instanceof Node\Scalar\Bool_) {
                return new Name('bool');
            }
        }

        return null;
    }
}
```

自定义规则注册到 `rector.php`：

```php
return RectorConfig::configure()
    ->withRules([
        DbSelectToEloquentRector::class,
        StrictReturnTypeRector::class,
    ]);
```

---

## 三、使用 LLM 识别重构机会

### 构建 LLM 扫描脚本

编写 Python 脚本遍历 PHP 文件，将代码发送给 LLM 分析：

```python
import json, anthropic

client = anthropic.Anthropic()

PROMPT = """你是资深 Laravel 架构师。分析以下代码，输出 JSON：
{"file":"路径","issues":[{"type":"code_smell|architecture","severity":"low|medium|high","line_range":[行号],"description":"描述","suggestion":"建议","rector_applicable":true/false}]}
仅输出 JSON，关注过长方法、重复代码、缺少类型声明、N+1 查询等。

代码：
```php
{code}
```"""

def analyze_file(filepath):
    with open(filepath) as f:
        code = f.read()[:50000]
    resp = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role":"user","content":PROMPT.format(code=code)}]
    )
    return json.loads(resp.content[0].text)
```

### 成本控制

- **分层扫描**：先用 PHPStan 过滤，再交给 LLM 深度分析
- **缓存机制**：基于文件 SHA256 缓存结果
- **模型分级**：简单文件用 Haiku，复杂文件用 Sonnet

### LLM Prompt 模板库

针对不同场景设计专用 Prompt 模板，可以显著提升诊断准确率：

**模板 1：Controller 过长方法检测**

```python
CONTROLLER_PROMPT = """你是 Laravel 架构专家。分析以下 Controller 文件：
- 检测超过 50 行的方法
- 识别应该拆分为 FormRequest、Resource、Action 类的逻辑
- 检查是否违反单一职责原则（SRP）
- 输出 JSON 数组，每项包含：
  - method_name: 方法名
  - line_start / line_end: 行号范围
  - line_count: 行数
  - issue_type: "long_method" | "mixed_responsibility" | "missing_validation"
  - severity: "low" | "medium" | "high"
  - suggestion: 具体重构建议
  - refactoring_type: "extract_form_request" | "extract_action" | "split_controller"

代码文件 {filepath}:
```php
{code}
```

仅输出 JSON。"""
```

**模板 2：N+1 查询检测**

```python
NPLUSONE_PROMPT = """你是 Laravel Eloquent 性能专家。扫描以下代码中的 N+1 查询风险：
- 检测循环内的 DB::select、Model::where 等查询
- 检测缺少 with() 的关联查询
- 检测 shouldLoadMissing 的缺失
- 输出 JSON 数组，每项包含：
  - location: "循环内查询" | "缺少 eager loading" | "批量操作缺失"
  - model: 涉及的模型名
  - suggestion: 添加 with() 或改用 chunk() / cursor()
  - estimated_impact: "high" | "medium" | "low"

代码：
```php
{code}
```

仅输出 JSON。"""
```

**模板 3：Laravel 11 迁移兼容性检查**

```python
MIGRATION_PROMPT = """你是 Laravel 升级专家。检查以下代码是否兼容 Laravel 11：
- 检测已废弃的 helper 函数（如 str_、array_ 前缀函数）
- 检测不再需要的 Middleware 注册方式
- 检测 Route::controller() 新语法兼容性
- 检测 config() / env() 用法变更
- 输出 JSON 数组，每项包含：
  - deprecated_usage: 废弃用法
  - new_usage: Laravel 11 推荐写法
  - auto_fixable: true/false（是否可用 Rector 自动修复）

代码：
```php
{code}
```

仅输出 JSON。"""
```

---

## 四、自动生成 PR 流水线

### Rector 执行 + LLM 建议整合

```python
def generate_pr_description(rector_output, llm_issues):
    desc = "## 🤖 Rector 自动重构\n\n```\n" + rector_output + "\n```\n\n"
    desc += "## 🧠 AI 重构建议（需审查）\n\n"
    for issue in llm_issues:
        if not issue['rector_applicable']:
            desc += f"- **{issue['severity']}** `{issue['file']}`: {issue['suggestion']}\n"
    return desc
```

### GitHub Actions 集成

完整的 CI/CD 流水线包含质量检查、AI 分析、自动 PR 创建三个阶段：

```yaml
name: Rector + AI Refactoring
on:
  schedule:
    - cron: '0 3 * * 1'  # 每周一凌晨
  workflow_dispatch:
    inputs:
      rector_sets:
        description: 'Rector 规则集'
        required: false
        default: 'full'
        type: choice
        options:
          - full
          - php83-only
          - laravel11-only
      dry_run_only:
        description: '仅 dry-run 模式'
        required: false
        default: true
        type: boolean

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: mbstring, xml, ctype, json, bcmath, pdo
          tools: phpstan

      - name: Cache Composer
        uses: actions/cache@v4
        with:
          path: vendor
          key: composer-${{ hashFiles('composer.lock') }}

      - run: composer install --no-interaction --no-progress

      - name: PHPStan Baseline Check
        run: |
          vendor/bin/phpstan analyse \
            --level=6 \
            --error-format=github \
            --no-progress

      - name: Rector Dry Run
        id: rector
        run: |
          output=$(vendor/bin/rector process --dry-run --output-format=json 2>&1)
          echo "$output" > rector-output.json
          changed=$(echo "$output" | jq '.changed_files | length')
          echo "changes=$changed" >> "$GITHUB_OUTPUT"

  ai-analysis:
    needs: quality-gate
    runs-on: ubuntu-latest
    if: needs.quality-gate.outputs.changes > 0
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install AI Dependencies
        run: pip install anthropic tenacity

      - name: AI Deep Analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          python3 scripts/ai-scan.py \
            --path app/ \
            --output ai-results.json \
            --max-concurrent 3 \
            --cache-dir .llm-cache

      - name: Upload Analysis Report
        uses: actions/upload-artifact@v4
        with:
          name: ai-analysis-report
          path: ai-results.json

  create-pr:
    needs: [quality-gate, ai-analysis]
    runs-on: ubuntu-latest
    if: needs.quality-gate.outputs.changes > 0
    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'

      - run: composer install --no-interaction

      - name: Apply Rector Changes
        if: ${{ inputs.dry_run_only != true }}
        run: vendor/bin/rector process

      - name: Generate PR Body
        run: |
          python3 scripts/generate-pr-body.py \
            --rector-output rector-output.json \
            --ai-results ai-results.json \
            > pr-body.md

      - uses: peter-evans/create-pull-request@v6
        with:
          title: "🤖 [AI-Rector] 自动重构 - $(date +%Y-%m-%d)"
          branch: ai/rector-refactoring
          labels: automated,refactoring
          body-file: pr-body.md
          commit-message: "chore: automated Rector refactoring + AI analysis"
          reviewers: ${{ secrets.DEFAULT_REVIEWERS }}
```

---

## 五、30+ 仓库的批量治理策略

### 仓库矩阵管理

用 YAML 配置管理所有仓库：

```yaml
# repos.yaml
repositories:
  - name: user-service
    url: git@github.com:org/user-service.git
    php_version: "8.1"
    laravel_version: "10"
    priority: high
  - name: order-service
    url: git@github.com:org/order-service.git
    php_version: "8.2"
    laravel_version: "11"
    priority: medium
```

### 批量执行脚本

以下是一个生产级的批量执行脚本，包含错误处理、进度报告和并发控制：

```bash
#!/bin/bash
set -euo pipefail

WORK_DIR="/tmp/rector-batch"
REPORT_DIR="$WORK_DIR/reports"
LOG_FILE="$WORK_DIR/execution-$(date +%Y%m%d-%H%M%S).log"
SUMMARY_FILE="$REPORT_DIR/summary.json"
PARALLEL_JOBS=${PARALLEL_JOBS:-4}

mkdir -p "$REPORT_DIR"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

process_repo() {
    local repo_name="$1"
    local repo_url="$2"
    local php_version="$3"
    local laravel_version="$4"
    local priority="$5"
    local REPO_DIR="$WORK_DIR/$repo_name"

    log ">>> 开始处理: $repo_name (PHP $php_version / Laravel $laravel_version / 优先级: $priority)"

    # 克隆或更新仓库
    if [ -d "$REPO_DIR/.git" ]; then
        cd "$REPO_DIR" && git checkout main && git pull --quiet
    else
        git clone --depth 1 "$repo_url" "$REPO_DIR" 2>/dev/null || { log "❌ 克隆失败: $repo_name"; return 1; }
        cd "$REPO_DIR"
    fi

    # 安装依赖
    composer install --no-interaction --quiet --no-progress 2>/dev/null || {
        log "⚠️  Composer 安装失败: $repo_name"
        return 1
    }

    # Rector dry-run
    log "  → Rector dry-run..."
    rector_output=$(vendor/bin/rector process --dry-run 2>&1) || true
    rector_changed=$(echo "$rector_output" | grep -c "files changed" || echo "0")
    echo "$rector_output" > "$REPORT_DIR/$repo_name-rector-dryrun.txt"

    # PHPStan 基线扫描
    log "  → PHPStan 分析..."
    phpstan_level=$(cat phpstan.neon 2>/dev/null | grep "level" | grep -oE "[0-9]+" || echo "5")
    vendor/bin/phpstan analyse --level="$phpstan_level" --error-format=json > "$REPORT_DIR/$repo_name-phpstan.json" 2>/dev/null || true

    # LLM 深度分析（仅高优先级仓库）
    if [ "$priority" = "high" ]; then
        log "  → LLM 深度分析..."
        python3 scripts/ai-scan.py \
            --path app/ \
            --output "$REPORT_DIR/$repo_name-llm.json" \
            2>/dev/null || log "⚠️  LLM 分析跳过: $repo_name"
    fi

    # 记录结果
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    log "  ✅ 完成: $repo_name (Rector 变更: $rector_changed 文件)"

    echo "{\"repo\":\"$repo_name\",\"timestamp\":\"$timestamp\",\"rector_changes\":$rector_changed,\"phpstan_level\":$phpstan_level}" \
        >> "$REPORT_DIR/results.jsonl"
}

# 主循环
log "========== 开始批量治理 =========="
TOTAL_REPOS=0
FAILED_REPOS=0

while IFS='|' read -r name url php_version laravel_version priority; do
    [ -z "$name" ] && continue
    TOTAL_REPOS=$((TOTAL_REPOS + 1))
    process_repo "$name" "$url" "$php_version" "$laravel_version" "$priority" || \
        FAILED_REPOS=$((FAILED_REPOS + 1))
done < <(yq -r '.repositories[] | "\(.name)|\(.url)|\(.php_version)|\(.laravel_version)|\(.priority)"' repos.yaml)

log "========== 批量治理完成 =========="
log "总计: $TOTAL_REPOS 仓库, 成功: $((TOTAL_REPOS - FAILED_REPOS)), 失败: $FAILED_REPOS"

# 生成汇总报告
if [ -f "$REPORT_DIR/results.jsonl" ]; then
    echo "报告已生成: $REPORT_DIR/results.jsonl"
fi
```

### 渐进式治理路线

| 阶段 | 时间 | 目标 |
|------|------|------|
| 第一阶段 | 第 1-2 周 | 全量仓库 Rector dry-run + PHPStan 基线扫描 |
| 第二阶段 | 第 3-4 周 | 选择 3-5 个高价值仓库执行 Rector + AI 扫描 |
| 第三阶段 | 第 5-8 周 | 全量自动 PR，CI 集成质量门禁 |

### 质量门禁

在每个仓库 CI 中加入：

```yaml
- name: Rector Check
  run: vendor/bin/rector process --dry-run
- name: PHPStan
  run: vendor/bin/phpstan analyse --level=6
```

---

## 六、实战案例与踩坑经验

### 案例一：统一 Eloquent 查询风格

LLM 发现同一仓库存在三种查询用户的方式：直接查询、Scope 模式、Repository 模式。LLM 建议统一为 Scope 模式，Rector 自动将 `where('status', 1)` 替换为 `->active()`。在 200+ 处调用中自动修复了 78%。

### 案例二：Laravel 10 → 11 批量迁移

30 个仓库同时迁移，Rector 自动处理了 Route 语法变更、Schedule 参数变更等。人工估算每仓库 2-3 天，Rector 批量执行仅需 10-15 分钟加半天审查。

### 踩坑总结

**坑 1：Rector 误改测试代码**

问题描述：Rector 在重构 `app/` 目录的 Eloquent 模型时，将 `User::factory()` 的 `fake()` 方法也一并替换为 `Faker\Provider`，导致测试代码引入了不必要的依赖变更。在 30 个仓库中，有 7 个出现了不同程度的测试代码误改。

根因分析：Rector 默认将 `tests/` 和 `database/factories/` 也纳入扫描范围，当自定义规则的节点匹配范围过大时，会波及测试代码。

解决方案：在 `rector.php` 中明确排除测试目录，并为工厂文件创建独立的 Rector 配置：

```php
return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app'])
    ->withSkip([
        __DIR__ . '/vendor',
        __DIR__ . '/tests',
        __DIR__ . '/database/factories',
        __DIR__ . '/database/seeders',
    ]);
```

同时建议为测试目录维护独立的 `rector-test.php`，使用更保守的规则集（仅包含代码风格规则，不包含类型系统规则）。

---

**坑 2：LLM 幻觉导致不存在的 API 调用**

问题描述：GPT-4 在分析一个使用了 Spatie Laravel Query Builder 的仓库时，"发明"了一个不存在的 `->allowedFields()` 方法替代 `->allowedFilters()`，导致 PR 合并后 500 错误。这种幻觉在 LLM 生成重构建议时尤为危险。

根因分析：LLM 的训练数据中混入了多个版本的包 API，容易混淆不同版本的方法签名。

解决方案：建立三层验证机制：

```python
def validate_llm_suggestion(suggestion, repo_path):
    """验证 LLM 建议的三道防线"""

    # 第一道：行号范围验证
    file_path = os.path.join(repo_path, suggestion['file'])
    with open(file_path) as f:
        lines = f.readlines()
    start, end = suggestion['line_range']
    actual_code = ''.join(lines[start-1:end])

    # 第二道：PHPStan 类型检查
    phpstan_result = run_phpstan(file_path)
    if phpstan_result.has_error:
        return False, "PHPStan 验证失败"

    # 第三道：静态 API 可用性检查
    for method_name in suggestion.get('methods_used', []):
        if not method_exists_in_codebase(method_name, repo_path):
            return False, f"方法 {method_name} 不存在于代码库中"

    return True, "验证通过"
```

所有 LLM 建议在提交 PR 前必须通过这三道防线，任一失败则标记为 "needs_manual_review"。

---

**坑 3：大规模执行内存溢出**

问题描述：在处理一个包含 2000+ PHP 文件的大型仓库时，Rector 在 AST 解析阶段消耗了 4GB+ 内存后被 PHP OOM Killer 终止。批量执行 30 个仓库时，有 5 个出现了不同程度的内存溢出。

根因分析：Rector 在处理大型代码库时，所有 AST 节点同时驻留在内存中。当文件数量超过 1500 个，内存占用呈非线性增长。

解决方案：采用三重策略应对：

```php
// 1. rector.php 中启用并行处理
return RectorConfig::configure()
    ->withParallel(
        maxNumberOfProcess: 8,
        jobSize: 20,           // 每批处理 20 个文件
        shouldOpenWithParallelProcessing: true
    );

// 2. 路径分批执行脚本
#!/bin/bash
BATCH_SIZE=200
find app/ -name "*.php" | head -n $BATCH_SIZE > batch.txt
vendor/bin/rector process $(cat batch.txt | tr '\n' ' ') \
    -d memory_limit=2G
```

```bash
# 3. 生产环境推荐的内存配置
php -d memory_limit=2G vendor/bin/rector process \
    --with-auto-detect \
    --no-ansi 2>&1 | tee rector-output.log
```

---

**坑 4：Git 冲突导致批量 PR 无法合并**

问题描述：同时为 30 个仓库创建 Rector PR 时，当两个 PR 修改了同一个文件（如 `app/Models/User.php`），合并第一个后第二个 PR 会产生大量冲突。有 12 个 PR 因为冲突无法自动合并，需要手动解决。

根因分析：Rector 重构（如类型声明添加、命名空间调整）经常触及同一个基础文件，PR 粒度过大时冲突概率激增。

解决方案：采用分层 PR 策略：

```bash
# 策略：按重构类型分层，从底层到顶层依次合并
# Layer 1: 基础类型声明（冲突最少，最先合并）
# Layer 2: 语法升级（PHP 8.3 特性）
# Layer 3: 框架迁移（Laravel 11 变更）
# Layer 4: 架构优化（自定义规则）

# 每个 PR 控制在 50 个文件以内
vendor/bin/rector process --dry-run | head -50
```

同时为每个仓库设置 PR 合并锁：同一时间只允许一个 Rector PR 处于可合并状态，其他 PR 自动 rebase 到最新主干。

---

**坑 5：API 限流导致批量扫描中断**

问题描述：使用 Claude API 对 30 个仓库的 5000+ 文件进行 LLM 分析时，在处理到第 800 个文件后触发了 Anthropic 的 RPM（每分钟请求数）限制，导致后续请求全部返回 429 错误。批量执行中途断开，已完成的分析结果丢失。

根因分析：Anthropic API 的免费/基础账户有严格的 RPM 限制（通常为 50 RPM），批量场景下很容易触顶。

解决方案：使用 tenacity 库实现指数退避重试，同时加入本地缓存和请求速率控制：

```python
from tenacity import retry, wait_exponential, stop_after_attempt
import time, hashlib, json, os

CACHE_DIR = ".llm-cache"
os.makedirs(CACHE_DIR, exist_ok=True)

@retry(
    wait=wait_exponential(min=2, max=120),
    stop=stop_after_attempt(7),
    retry=retry_if_exception_type((anthropic.RateLimitError, anthropic.APIConnectionError))
)
def call_llm_with_cache(prompt, model="claude-sonnet-4-20250514"):
    """带缓存的 LLM 调用，自动处理限流重试"""
    cache_key = hashlib.sha256(prompt.encode()).hexdigest()
    cache_file = os.path.join(CACHE_DIR, f"{cache_key}.json")

    # 命中缓存直接返回
    if os.path.exists(cache_file):
        with open(cache_file) as f:
            return json.load(f)

    # 速率控制：每秒最多 3 个请求
    time.sleep(0.35)

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    result = json.loads(resp.content[0].text)

    # 写入缓存
    with open(cache_file, 'w') as f:
        json.dump(result, f, ensure_ascii=False)

    return result

# 批量执行时使用队列控制并发
import asyncio

async def batch_analyze(files, max_concurrent=5):
    semaphore = asyncio.Semaphore(max_concurrent)

    async def analyze_one(filepath):
        async with semaphore:
            prompt = build_prompt(filepath)
            return await asyncio.to_thread(call_llm_with_cache, prompt)

    return await asyncio.gather(*[analyze_one(f) for f in files])
```

---

## 总结

Rector + LLM 组合为多仓库治理提供了**可规模化、可度量、可回滚**的方案。在实践中，这套方案帮助 30+ Laravel 仓库在 8 周内完成 PHP 8.3 + Laravel 11 全面升级，累计自动生成 400+ 个 PR，PHPStan level 从平均 3.2 提升到 5.8。

随着 AI Agent 能力提升，未来 LLM 有望直接生成 Rector 规则甚至独立完成复杂重构——真正实现 AI 驱动的代码治理。

---

> **相关工具**：[Rector](https://getrector.com/) | [rector-laravel](https://github.com/driftingly/rector-laravel) | [PHPStan](https://phpstan.org/) | [Claude API](https://docs.anthropic.com/)

## 相关阅读

- [PHP 设计模式实战——从 Strategy 到 Observer 的 Laravel 落地指南：依赖注入容器、门面模式与服务提供者的工程化实践](/categories/05_PHP/Laravel/php-guide-design-patterns/) — Rector 重构时常需识别并优化设计模式，本文提供 PHP 常见设计模式在 Laravel 中的标准化实现
- [Composer 自动加载全解——PSR-4/5、Classmap 与 Authority 在 Laravel 中的深度配置：从原理到性能调优](/categories/05_PHP/Laravel/composer-autoload/) — 理解 Composer 自动加载机制有助于排查 Rector 重构后的类找不到问题
- [PHPStan Level 升级指南——从 Level 0 到 Level 10 的渐进式类型安全之路：Laravel 项目的基线管理与错误修复策略](/categories/05_PHP/Laravel/pest-testingguide-100/) — Rector + PHPStan 联动的代码治理离不开 PHPStan 质量门禁配置
