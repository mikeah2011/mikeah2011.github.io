---
title: 技术债务管理-量化追踪与偿还遗留代码-Laravel-B2C-API实战踩坑记录
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
date: 2026-05-05 07:00:50
updated: 2026-05-05 07:04:13
categories:
  - engineering
  - process
tags: [KKday, Laravel, 代码质量, 工程管理]
keywords: [Laravel, B2C, API, 技术债务管理, 量化追踪与偿还遗留代码, 实战踩坑记录, 工程化]
description: 技术债务管理实战指南——在30+ Laravel仓库中如何量化债务指标、建立周度记分卡追踪系统、用Impact/Effort公式精准排优先级，并通过童子军规则、绞杀者模式与Sprint预算制持续偿还。含PHPStan质量门禁、DEBT注释规范、GitHub Actions自动化守护完整方案与5个真实踩坑记录。



---

# 技术债务管理：量化、追踪、偿还遗留代码的实战方法论

> 「我们先这样上线，后面再重构。」——这句话我在 30+ 个 Laravel 仓库里听过不下百次。但「后面」从未来临，直到系统崩溃的那天。

在 KKday B2C Backend 团队维护 30+ 个 Laravel 仓库的过程中，我逐渐意识到：**技术债务不是代码问题，而是工程管理问题**。它需要像产品 Backlog 一样被量化、排优先级、持续偿还。

## 1. 什么是技术债务？不是所有烂代码都是债务

很多人把「技术债务」等同于「烂代码」，这是最大的误解。技术债务的核心定义是：**为了短期交付速度而做出的、未来需要额外成本来修正的技术决策**。

```
┌─────────────────────────────────────────────────────┐
│              技术债务的四种类型                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐    ┌──────────────┐               │
│  │  粗心债务     │    │  战略债务     │               │
│  │  (不小心)     │    │  (故意的)     │               │
│  │  - 无测试     │    │  - 先上线再   │               │
│  │  - 硬编码     │    │    优化       │               │
│  │  - 重复代码   │    │  - 快速原型   │               │
│  └──────────────┘    └──────────────┘               │
│                                                     │
│  ┌──────────────┐    ┌──────────────┐               │
│  │  腐化债务     │    │  环境债务     │               │
│  │  (渐变的)     │    │  (外部的)     │               │
│  │  - 过时依赖   │    │  - PHP 版本   │               │
│  │  - 废弃 API   │    │  - 框架 EOL   │               │
│  │  - 死代码     │    │  - 云服务变更  │               │
│  └──────────────┘    └──────────────┘               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**踩坑记录 #1**：我们曾有一个项目用了 Laravel 5.8 的 `Str::` 方法，但全局混用了大量 `str_slug()` 等 5.x 辅助函数。团队认为这是「烂代码」要全部重写，但实际上这只是一种技术债务类型（环境债务），升级到 Laravel 9 时自然解决，投入 3 周重写完全是浪费。

**教训：先分类再行动，不同类型的技术债务策略完全不同。**

## 2. 量化技术债务：用数据说话，别用感觉

### 2.1 核心度量指标

```php
<?php
// app/Console/Commands/TechDebtReport.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class TechDebtReport extends Command
{
    protected $signature = 'techdebt:report {--output=tech-debt-report.json}';
    protected $description = '生成技术债务量化报告';

    public function handle(): int
    {
        $report = [
            'generated_at' => now()->toIso8601String(),
            'metrics' => [],
        ];

        // 1. 代码复杂度（cyclomatic complexity）
        $report['metrics']['complexity'] = $this->analyzeComplexity();

        // 2. 测试覆盖率
        $report['metrics']['coverage'] = $this->getTestCoverage();

        // 3. PHPStan 错误数（按 level 统计）
        $report['metrics']['phpstan'] = $this->runPhpStan();

        // 4. 依赖健康度
        $report['metrics']['dependencies'] = $this->checkDependencies();

        // 5. TODO/FIXME/HACK 标记数
        $report['metrics']['markers'] = $this->countMarkers();

        // 6. 废弃代码检测
        $report['metrics']['dead_code'] = $this->detectDeadCode();

        $output = $this->option('output');
        file_put_contents($output, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        $this->info("报告已生成: {$output}");

        return self::SUCCESS;
    }

    private function analyzeComplexity(): array
    {
        $process = Process::fromShellCommandline(
            'php vendor/bin/phpstan analyse --error-format=json --no-progress 2>/dev/null',
            base_path()
        );
        $process->run();

        $result = json_decode($process->getOutput(), true) ?? [];

        // 识别高复杂度文件（> 20 个方法的 Controller）
        $highComplexity = [];
        $controllers = glob(app_path('Http/Controllers') . '/**/*.php');

        foreach ($controllers as $controller) {
            $content = file_get_contents($controller);
            $methodCount = preg_match_all('/public\s+function\s+\w+/', $content);
            if ($methodCount > 20) {
                $highComplexity[] = [
                    'file' => basename($controller),
                    'methods' => $methodCount,
                    'risk' => $methodCount > 30 ? 'critical' : 'warning',
                ];
            }
        }

        return [
            'high_complexity_files' => $highComplexity,
            'phpstan_errors' => $result['totals']['errors'] ?? 0,
        ];
    }

    private function getTestCoverage(): array
    {
        // 检查是否有测试目录和配置
        $hasTests = is_dir(base_path('tests'));
        $hasPest = file_exists(base_path('pest.php'));
        $hasPHPUnitXml = file_exists(base_path('phpunit.xml')) ||
                         file_exists(base_path('phpunit.jenkins.xml'));

        // 统计测试文件数与源文件数的比例
        $testFiles = $hasTests
            ? count(glob_recursive(base_path('tests') . '/*Test.php'))
            + count(glob_recursive(base_path('tests') . '/*Pest.php'))
            : 0;

        $sourceFiles = count(glob_recursive(app_path() . '/*.php'));

        return [
            'has_tests' => $hasTests,
            'test_framework' => $hasPest ? 'Pest' : 'PHPUnit',
            'test_files' => $testFiles,
            'source_files' => $sourceFiles,
            'ratio' => $sourceFiles > 0
                ? round($testFiles / $sourceFiles * 100, 1) . '%'
                : 'N/A',
        ];
    }

    private function checkDependencies(): array
    {
        $composerJson = json_decode(file_get_contents(base_path('composer.json')), true);
        $outdated = [];

        // 标记已知 EOL 的 Laravel 版本
        $eolVersions = ['5.*', '6.*', '7.*', '8.*'];
        $laravelVersion = $composerJson['require']['laravel/framework'] ?? 'unknown';

        foreach ($eolVersions as $eol) {
            if (fnmatch($eol, $laravelVersion)) {
                $outdated['laravel'] = [
                    'current' => $laravelVersion,
                    'status' => 'EOL',
                    'risk' => 'critical',
                ];
                break;
            }
        }

        // 统计 abandoned packages
        $packages = array_keys($composerJson['require'] ?? []);
        $totalPackages = count($packages);

        return [
            'total_packages' => $totalPackages,
            'laravel_version' => $laravelVersion,
            'outdated' => $outdated,
        ];
    }

    private function countMarkers(): array
    {
        $patterns = ['TODO', 'FIXME', 'HACK', 'XXX', 'TEMP'];
        $results = [];

        foreach ($patterns as $marker) {
            $process = Process::fromShellCommandline(
                "grep -rn '// {$marker}' app/ --include='*.php' 2>/dev/null | wc -l",
                base_path()
            );
            $process->run();
            $count = (int) trim($process->getOutput());
            if ($count > 0) {
                $results[$marker] = $count;
            }
        }

        return $results;
    }

    private function detectDeadCode(): array
    {
        // 简单策略：检查未被路由引用的 Controller 方法
        $routeMethods = [];
        $routes = app('router')->getRoutes();

        foreach ($routes as $route) {
            $action = $route->getActionName();
            if ($action && str_contains($action, '@')) {
                [, $method] = explode('@', $action);
                $routeMethods[] = $method;
            }
        }

        return [
            'route_referenced_methods' => count(array_unique($routeMethods)),
            'note' => 'Use PHPStan dead-code extension for deeper analysis',
        ];
    }
}

function glob_recursive(string $pattern, int $flags = 0): array
{
    $files = glob($pattern, $flags);
    $dirs = glob(dirname($pattern) . '/*', GLOB_ONLYDIR | GLOB_NOSORT);
    foreach ($dirs as $dir) {
        $files = array_merge($files, glob_recursive($dir . '/' . basename($pattern), $flags));
    }
    return $files;
}
```

### 2.2 建立债务记分卡

在实际项目中，我们维护了一个简单的记分卡，每周更新：

```
┌──────────────────────────────────────────────────────────────┐
│  KKday B2C API — 技术债务记分卡 (Week 18)                     │
├───────────────┬────────┬────────┬────────┬──────────────────┤
│  指标          │ 当前值  │ 上周   │ 目标   │ 趋势              │
├───────────────┼────────┼────────┼────────┼──────────────────┤
│ PHPStan L6 错误│  47    │  52    │  0     │ ↓ 5 (improving)  │
│ 测试覆盖率      │  68%   │  65%   │  80%  │ ↑ 3% (improving) │
│ TODO/FIXME     │  23    │  21    │  0     │ ↑ 2 (worsening!) │
│ 高复杂度文件    │  5     │  5     │  0     │ → (stable)       │
│ EOL 依赖       │  0     │  0     │  0     │ → (stable)       │
│ 废弃 API 端点   │  12    │  12    │  0     │ → (stable)       │
└───────────────┴────────┴────────┴────────┴──────────────────┘
```

**踩坑记录 #2**：我们最初用 Google Sheet 手动维护这个记分卡，但两周后就没人更新了。后来改成 `php artisan techdebt:report` 跑 CI 自动生成 JSON，再用 GitHub Actions 推送到 Notion，才真正持续下来。

## 3. 追踪技术债务：把它变成 Backlog 的一部分

### 3.1 在 Issue Tracker 中建立 `tech-debt` Label

```yaml
# .github/ISSUE_TEMPLATE/tech-debt.yml
name: 🔧 技术债务
description: 记录需要偿还的技术债务项
labels: ["tech-debt", "engineering"]
body:
  - type: dropdown
    id: debt-type
    attributes:
      label: 债务类型
      options:
        - 粗心债务（可立即修复）
        - 战略债务（需排期）
        - 腐化债务（需升级/重构）
        - 环境债务（外部依赖）
    validations:
      required: true

  - type: input
    id: impact-score
    attributes:
      label: 影响分 (1-10)
      description: "1=几乎没有影响，10=严重影响开发效率或系统稳定性"
    validations:
      required: true

  - type: input
    id: effort-score
    attributes:
      label: 修复成本 (1-10)
      description: "1=10分钟搞定，10=需要2周以上"
    validations:
      required: true

  - type: textarea
    id: context
    attributes:
      label: 上下文
      description: "为什么会形成这笔债务？当时的技术决策背景是什么？"
    validations:
      required: true
```

### 3.2 债务优先级公式：Impact / Effort

```
优先级分 = (影响分 × 2 + 安全风险加权) / 修复成本

示例：
  SQL 注入风险 → (9 × 2 + 5) / 3 = 7.67 → P0 立即修复
  无测试覆盖的 Controller → (6 × 2 + 0) / 5 = 2.4 → P2 排期
  硬编码配置项 → (3 × 2 + 0) / 1 = 6.0 → P1 下个 Sprint
```

**踩坑记录 #3**：我们曾按「感觉上的严重程度」排优先级，结果花了一周重构一个「感觉很烂」的 Service，上线后发现那个功能月 PV 只有 50。后来引入 Impact Score 时加上了**业务流量权重**，才避免了这种「技术正确但业务愚蠢」的决策。

### 3.3 在代码中标记债务（可搜索的注释规范）

```php
<?php

// DEBT[2024-03-15][P2][Mike]: 这里用 raw SQL 是因为 Eloquent 的 
// withCount 在子查询场景下有 N+1 问题，Laravel 11 修复后应改回 ORM
$products = DB::select("
    SELECT p.*, 
           (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) as review_count
    FROM products p
    WHERE p.status = 'active'
    ORDER BY review_count DESC
    LIMIT 20
");

// DEBT[2024-06-01][P1][Sarah]: 这个 try-catch 太宽泛，应该只捕获 
// PaymentGatewayException，但目前上游没有细分异常类型
try {
    $result = $this->paymentGateway->charge($order);
} catch (\Exception $e) {
    Log::error('Payment failed', ['order_id' => $order->id]);
    // TODO: 区分可重试 vs 不可重试错误
}
```

配合 PHPStan 自定义规则，可以把 DEBT 注释自动同步到 Issue Tracker：

```php
<?php
// phpstan-rules/src/Rules/TrackTechDebtRule.php

namespace App\PHPStan\Rules;

use PhpParser\Node;
use PHPStan\Analyser\Scope;
use PHPStan\Rules\Rule;

/**
 * @implements Rule<Node\Stmt>
 */
class TrackTechDebtRule implements Rule
{
    public function getNodeType(): string
    {
        return Node\Stmt::class;
    }

    public function processNode(Node $node, Scope $scope): array
    {
        if (!$node instanceof Node\Stmt\Nop) {
            return [];
        }

        foreach ($node->getComments() as $comment) {
            if (preg_match('/DEBT\[(\d{4}-\d{2}-\d{2})\]\[([P]\d)\]\[(\w+)\]:\s*(.+)/', 
                $comment->getText(), $matches)) {
                // 记录到结构化日志，后续 CI 可解析
                error_log(json_encode([
                    'type' => 'tech_debt',
                    'date' => $matches[1],
                    'priority' => $matches[2],
                    'author' => $matches[3],
                    'description' => $matches[4],
                    'file' => $scope->getFile(),
                    'line' => $node->getLine(),
                ]));
            }
        }

        return [];
    }
}
```

## 4. 偿还策略：不要做大爆炸重构

### 4.1 男孩童子军规则（Boy Scout Rule）

> 「让代码比你来的时候更好一点。」

这是最简单也最有效的策略。每次修改一个文件时，顺手改善它周围的代码：

```php
<?php
// 修改前（原始代码）
public function getProducts($request)
{
    $category = $request->input('category');
    $page = $request->input('page', 1);
    $limit = $request->input('limit', 20);

    // 原始 SQL，无分页保护
    $products = DB::select("SELECT * FROM products WHERE category = '$category' 
                            LIMIT $limit OFFSET " . (($page - 1) * $limit));

    return response()->json($products);
}

// 修改后（童子军规则：修复 SQL 注入 + 加分页 + 加缓存）
public function getProducts(GetProductsRequest $request): JsonResponse
{
    $validated = $request->validated();

    $products = Cache::remember(
        key: "products:{$validated['category']}:page:{$validated['page'] ?? 1}",
        ttl: now()->addMinutes(5),
        callback: fn () => Product::query()
            ->where('category', $validated['category'])
            ->orderByDesc('created_at')
            ->paginate($validated['per_page'] ?? 20)
    );

    return ProductResource::collection($products)->response();
}
```

### 4.2 绞杀者模式（Strangler Fig Pattern）

对于大型遗留模块，不要一次性重写，而是逐步用新代码包裹旧代码：

```
┌─────────────────────────────────────────────────────┐
│              绞杀者模式：渐进式替换                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Phase 1: 在旧代码旁边写新代码                         │
│  ┌──────────┐   ┌──────────┐                        │
│  │ 旧 Order  │   │ 新 Order  │  ← Feature Flag 控制  │
│  │ Service   │   │ Service   │                       │
│  └────┬─────┘   └────┬─────┘                        │
│       │              │                               │
│       └──────┬───────┘                               │
│              ▼                                       │
│  Phase 2: 流量逐步切换                                │
│  ┌──────────────────────┐                            │
│  │ 10% → 30% → 50% →   │  ← Laravel Pennant        │
│  │ 80% → 100% 新代码     │                            │
│  └──────────────────────┘                            │
│              ▼                                       │
│  Phase 3: 删除旧代码                                  │
│  ┌──────────┐                                       │
│  │ 旧 Order  │  ← git rm                             │
│  │ Service   │                                       │
│  └──────────┘                                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

```php
<?php
// 使用 Laravel Pennant 控制新旧代码切换
use Laravel\Pennant\Feature;

// AppServiceProvider.php
Feature::define('new-order-service', function (User $user) {
    // 按用户 ID 分桶，确保同一用户始终看到同一版本
    return ($user->id % 100) < config('features.new_order_rollout', 0);
});

// OrderController.php
public function store(StoreOrderRequest $request): JsonResponse
{
    if (Feature::active('new-order-service')) {
        $result = app(NewOrderService::class)->create($request->validated());
    } else {
        $result = app(LegacyOrderService::class)->create($request->validated());
    }

    return new OrderResource($result);
}
```

**踩坑记录 #4**：绞杀者模式最关键的坑是**数据库 schema 不一致**。新旧 Service 往往需要不同的表结构，我们的做法是先做「只加不改」的 migration（加新列、加新表），两套代码共享同一个数据库，等新代码 100% 接管后再做 cleanup migration 删旧列。如果反过来先改 schema，旧代码立刻爆炸。

### 4.3 预算制：每个 Sprint 预留 20% 给技术债务

```
Sprint 容量分配：
┌──────────────────────────────────────┐
│  ████████████████░░░░░░  80% 业务需求 │
│  ████░░░░░░░░░░░░░░░░░░  20% 技术债务 │
└──────────────────────────────────────┘

这 20% 的使用优先级：
1. 安全漏洞（SQL 注入、XSS）
2. 影响开发效率的债务（慢 CI、环境不稳定）
3. 高频修改模块的代码质量
4. 文档与测试补充
```

## 5. 团队文化：让技术债务可见、可讨论

### 5.1 Tech Debt Friday

我们团队每两周有一个「Tech Debt Friday」，规则很简单：

```
📋 Tech Debt Friday 规则
━━━━━━━━━━━━━━━━━━━━━
✅ 可以做的：
  - 重构一个小模块
  - 补充缺失的测试
  - 升级一个 minor 依赖
  - 删除死代码
  - 改善 CI 构建速度

❌ 不可以做的：
  - 大规模重写（需要 RFC）
  - 更换技术栈（需要 Architecture Decision Record）
  - 「顺手」加新功能
```

### 5.2 架构决策记录（ADR）

对于战略性的技术债务决策，必须留下 ADR：

```markdown
# ADR-0023: 订单模块使用原始 SQL 替代 Eloquent

## 状态
已接受（2024-03-15）

## 背景
订单查询涉及 5 张表的复杂 JOIN，Eloquent ORM 生成的 SQL 执行计划
无法命中索引，查询耗时 800ms，超过 SLA 的 200ms 要求。

## 决策
在 OrderRepository 中使用 DB::select() 手写 SQL，配合覆盖索引
将查询降至 50ms 以内。

## 后果
- 正面：查询性能提升 16x
- 负面：丧失 Eloquent 的 eager loading、model events 等便利
- 债务：Laravel 升级时需手动验证 SQL 兼容性
- 偿还计划：当 Laravel 的查询优化器支持 hint 时重新评估
```

## 6. 自动化工具链：让债务无处藏身

### 6.1 CI Pipeline 中的质量门禁

```yaml
# .github/workflows/quality-gate.yml
name: Quality Gate

on:
  pull_request:
    branches: [main, develop]

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          coverage: xdebug

      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist

      # 门禁 1：PHPStan 不允许新增错误
      - name: PHPStan Analysis
        run: |
          vendor/bin/phpstan analyse --error-format=github-actions \
            --generate-baseline=phpstan-baseline.neon

          # 对比 baseline，如果新增错误则失败
          NEW_ERRORS=$(vendor/bin/phpstan analyse --error-format=json 2>/dev/null \
            | jq '.totals.errors')
          BASELINE_ERRORS=$(grep -c 'message:' phpstan-baseline.neon || echo 0)

          if [ "$NEW_ERRORS" -gt "$BASELINE_ERRORS" ]; then
            echo "❌ PHPStan errors increased: $BASELINE_ERRORS → $NEW_ERRORS"
            exit 1
          fi

      # 门禁 2：Pint 代码风格检查
      - name: Laravel Pint
        run: vendor/bin/pint --test --format=github-actions

      # 门禁 3：新增代码测试覆盖率不低于 70%
      - name: Test Coverage Gate
        run: |
          vendor/bin/pest --coverage --min=70 --coverage-clover=coverage.xml

      # 门禁 4：检测新增的 DEBT 注释，自动创建 Issue
      - name: Track New Tech Debt
        if: github.event_name == 'pull_request'
        run: |
          NEW_DEBTS=$(git diff origin/main...HEAD -- '*.php' \
            | grep '+.*DEBT\[' | wc -l)

          if [ "$NEW_DEBTS" -gt 0 ]; then
            echo "⚠️ 发现 $NEW_DEBTS 个新增技术债务标记"
            # 自动创建 GitHub Issue
            gh issue create \
              --title "🔧 PR #${{ github.event.pull_request.number }} 引入 $NEW_DEBTS 个技术债务" \
              --label "tech-debt" \
              --body "PR: ${{ github.event.pull_request.html_url }}\n新增 DEBT 标记数: $NEW_DEBTS"
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**踩坑记录 #5**：我们一开始把 PHPStan 设为 `level: 8`（最高），结果第一个 PR 就报了 200+ 错误，团队直接放弃了。正确做法是用 `--generate-baseline` 先「冻结」现有错误，然后设定规则：**不允许新增错误，存量错误逐步消除**。这样既不会阻塞开发，又能确保债务只减不增。

## 7. 踩坑总结：债务管理的反模式

```
❌ 反模式 1：「推倒重写」
   → 你以为 3 个月能写完，实际花了 12 个月
   → 重写期间旧系统还在加新功能，差距越拉越大

❌ 反模式 2：「技术债务清零周」
   → 集中一周处理债务，之后三个月没人管
   → 债务管理应该是日常，不是运动

❌ 反模式 3：「只看代码质量指标」
   → 测试覆盖率 90% 但业务逻辑完全测错了
   → 指标是手段，不是目的

✅ 正确做法：
   → 量化 → 排序 → 小批量持续偿还 → 自动化守护
```

## 总结

技术债务管理的核心不是消灭债务，而是**让它可见、可控、可协商**。

1. **量化**：用 PHPStan、测试覆盖率、DEBT 注释等工具让债务显性化
2. **追踪**：把债务项放进 Backlog，用 Impact/Effort 公式排优先级
3. **偿还**：童子军规则 + 绞杀者模式 + Sprint 预算制，小批量持续偿还
4. **守护**：CI 质量门禁自动拦截新增债务，不让债务只增不减
5. **文化**：Tech Debt Friday + ADR，让技术债务成为团队共识而非个人抱怨

在 30+ 仓库的实践中，我学到最重要的一课是：**技术债务的敌人不是烂代码，而是不可见**。一旦你能让它在 Dashboard 上显示出来，团队自然会开始认真对待它。

## 相关阅读

- [代码审查流程设计：如何建立高效的 CR 文化与工具链](/categories/Engineering/code-review-process/)
- [PHPUnit 11.x 实战：新特性与最佳实践——从 Laravel B2C API 的断言、属性到测试架构演进踩坑记录](/categories/Engineering/phpunit-11-x-guide-best-practices/)
- [Developer Productivity Metrics 实战：SPACE 框架度量开发者效能——DORA 之外的代码质量、协作效率与满意度追踪](/categories/Engineering/Developer-Productivity-Metrics-SPACE框架度量开发者效能-DORA之外的代码质量协作效率与满意度追踪/)
