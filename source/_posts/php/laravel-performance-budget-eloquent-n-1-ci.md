---
title: "Laravel Performance Budget 实战进阶：Eloquent 查询计数、N+1 自动检测、内存峰值 CI 门禁——从响应时间到资源预算的全链路治理"
keywords: [Laravel Performance Budget, Eloquent, CI, 实战进阶, 查询计数, 自动检测, 内存峰值, 门禁, 从响应时间到资源预算的全链路治理, PHP]
date: 2026-06-10 06:33:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Performance
  - Eloquent
  - CI/CD
  - N+1
  - Memory
description: "将 Performance Budget 从概念落地到 Laravel 项目：查询计数门禁、N+1 自动检测、内存峰值监控、CI 卡点，构建可量化的性能治理体系。"
---


## 引言：性能不是上线后才关心的事

大多数团队的性能治理停留在「用户投诉 → 排查 → 优化」的被动模式。但真正高效的团队把性能当作预算来管理——就像信用卡有额度一样，每个请求的数据库查询数、内存占用、响应时间都有明确的上限，超过就「拒付」。

本文将手把手在 Laravel 项目中落地一套 **Performance Budget** 体系：

- **Eloquent 查询计数**：给每个接口设定查询次数上限
- **N+1 自动检测**：开发阶段就抓出隐藏的 N+1 问题
- **内存峰值 CI 门禁**：PR 合并前自动拦截内存暴涨的代码
- **全链路度量**：从响应时间到资源消耗的可观测性闭环

---

## 一、核心概念：什么是 Performance Budget

Performance Budget 不是一个工具，而是一种治理理念：

```
单次请求的资源预算
├── 数据库查询数 ≤ 10
├── 内存峰值 ≤ 64MB
├── 响应时间 ≤ 200ms (P95)
├── 外部 HTTP 调用 ≤ 3
└── 队列延迟 ≤ 5s
```

关键原则：

1. **预算要具体**：不说「要快」，说「查询不超过 10 次」
2. **预算要自动化**：人工 review 发现不了 N+1，工具可以
3. **预算要卡 CI**：性能退化不应该到生产环境才暴露

---

## 二、Eloquent 查询计数器

### 2.1 原理

Laravel 的 `DB::listen()` 可以拦截所有 SQL 查询。我们利用它来统计单次请求中的查询总数。

```php
<?php

namespace App\Support\Performance;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class QueryCounter
{
    protected int $count = 0;
    protected array $queries = [];
    protected int $limit;
    protected string $context;

    public function __construct(int $limit = 50, string $context = 'request')
    {
        $this->limit = $limit;
        $this->context = $context;
    }

    public function start(): void
    {
        $this->count = 0;
        $this->queries = [];

        DB::listen(function ($query) {
            $this->count++;
            $this->queries[] = [
                'sql' => $query->sql,
                'time' => $query->time, // ms
                'bindings' => $query->bindings,
            ];
        });
    }

    public function getCount(): int
    {
        return $this->count;
    }

    public function getQueries(): array
    {
        return $this->queries;
    }

    public function getSlowest(int $top = 5): array
    {
        $sorted = $this->queries;
        usort($sorted, fn($a, $b) => $b['time'] <=> $a['time']);
        return array_slice($sorted, 0, $top);
    }

    public function isOverBudget(): bool
    {
        return $this->count > $this->limit;
    }

    public function report(): array
    {
        return [
            'context' => $this->context,
            'query_count' => $this->count,
            'limit' => $this->limit,
            'over_budget' => $this->isOverBudget(),
            'total_time_ms' => array_sum(array_column($this->queries, 'time')),
            'slowest' => $this->getSlowest(),
        ];
    }
}
```

### 2.2 Middleware 集成

用中间件自动统计每个请求的查询数：

```php
<?php

namespace App\Http\Middleware;

use App\Support\Performance\QueryCounter;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class CountQueries
{
    protected QueryCounter $counter;

    public function __construct(QueryCounter $counter)
    {
        $this->counter = $counter;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $limit = $this->resolveLimit($request);
        $this->counter = new QueryCounter($limit, $request->path());
        $this->counter->start();

        $response = $next($request);

        // 响应头注入查询数，开发阶段一目了然
        $response->headers->set('X-Query-Count', (string) $this->counter->getCount());
        $response->headers->set('X-Query-Limit', (string) $limit);

        if ($this->counter->isOverBudget()) {
            $report = $this->counter->report();
            Log::warning('Performance budget exceeded', $report);

            // 生产环境：只记日志
            // 开发/测试环境：可以抛异常或追加 header
            if (app()->environment('local', 'testing')) {
                $response->headers->set('X-Performance-Budget', 'EXCEEDED');
                $response->headers->set('X-Slowest-Queries', json_encode(
                    array_map(fn($q) => "{$q['time']}ms: {$q['sql']}", $this->counter->getSlowest(3))
                ));
            }
        }

        return $response;
    }

    protected function resolveLimit(Request $request): int
    {
        // 可以按路由/分组设定不同预算
        $routeLimits = [
            'api/v1/products' => 15,
            'api/v1/orders' => 25,
            'api/v1/dashboard' => 50,
        ];

        $path = $request->path();
        foreach ($routeLimits as $pattern => $limit) {
            if (str_starts_with($path, $pattern)) {
                return $limit;
            }
        }

        return config('performance.query_limit', 50);
    }
}
```

注册到 `app/Http/Kernel.php`：

```php
// API 中间件组
protected $middlewareGroups = [
    'api' => [
        // ... 其他中间件
        \App\Http\Middleware\CountQueries::class,
    ],
];
```

### 2.3 配置文件

```php
<?php
// config/performance.php

return [
    // 全局默认查询数上限
    'query_limit' => env('PERFORMANCE_QUERY_LIMIT', 50),

    // 内存峰值上限 (MB)
    'memory_limit_mb' => env('PERFORMANCE_MEMORY_LIMIT_MB', 128),

    // N+1 检测阈值：同一查询模板出现超过此次数触发警告
    'n_plus_one_threshold' => env('N_PLUS_ONE_THRESHOLD', 10),

    // 是否在响应头注入性能指标
    'inject_headers' => env('PERFORMANCE_INJECT_HEADERS', true),

    // CI 模式：超预算时返回非零退出码
    'ci_strict_mode' => env('PERFORMANCE_CI_STRICT', false),
];
```

---

## 三、N+1 自动检测

### 3.1 识别模式

N+1 问题的本质是：循环中触发了 lazy load。比如：

```php
// ❌ 经典 N+1：1 次查 orders + N 次查 user
$orders = Order::limit(100)->get();
foreach ($orders as $order) {
    echo $order->user->name; // 每次触发一条 SELECT
}
```

查询模式的特征：**相同结构的 SQL，只是绑定参数不同，且在短时间内连续执行**。

### 3.2 N+1 Detector 实现

```php
<?php

namespace App\Support\Performance;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class NPlusOneDetector
{
    protected array $queryTemplates = [];
    protected int $threshold;
    protected bool $strict;

    public function __construct(int $threshold = 10, bool $strict = false)
    {
        $this->threshold = $threshold;
        $this->strict = $strict;
    }

    public function start(): void
    {
        DB::listen(function ($query) {
            // 将 SQL 中的具体参数替换为占位符，提取查询模板
            $template = $this->extractTemplate($query->sql);
            $time = microtime(true);

            $this->queryTemplates[$template][] = [
                'time' => $time,
                'sql' => $query->sql,
                'bindings' => $query->bindings,
                'duration_ms' => $query->time,
            ];
        });
    }

    protected function extractTemplate(string $sql): string
    {
        // 将 IN (?, ?, ?) 统一为 IN (?)
        $sql = preg_replace('/IN \([^)]+\)/i', 'IN (?)', $sql);
        // 将具体值替换为 ?
        $sql = preg_replace('/=\s*\d+/', '= ?', $sql);
        $sql = preg_replace("/=\s*'[^']*'/", '= ?', $sql);
        // 去除多余空格
        $sql = preg_replace('/\s+/', ' ', trim($sql));
        return $sql;
    }

    public function detect(): array
    {
        $violations = [];

        foreach ($this->queryTemplates as $template => $executions) {
            $count = count($executions);
            if ($count >= $this->threshold) {
                $totalTime = array_sum(array_column($executions, 'duration_ms'));
                $violations[] = [
                    'template' => $template,
                    'count' => $count,
                    'threshold' => $this->threshold,
                    'total_time_ms' => round($totalTime, 2),
                    'sample_sql' => $executions[0]['sql'],
                    'suggestion' => $this->suggestFix($template),
                ];
            }
        }

        // 按执行次数降序
        usort($violations, fn($a, $b) => $b['count'] <=> $a['count']);

        return $violations;
    }

    protected function suggestFix(string $template): string
    {
        if (str_contains($template, 'where "user_id" = ?')) {
            return '使用 with([\'user\']) 预加载关联';
        }
        if (str_contains($template, 'where "order_id" = ?')) {
            return '使用 with([\'order\']) 或 with([\'items\']) 预加载';
        }
        if (str_contains($template, 'where "category_id" = ?')) {
            return '使用 with([\'category\']) 预加载关联';
        }
        return '检查是否需要 eager loading: ->with([\'relation\'])';
    }

    public function hasViolations(): bool
    {
        return !empty($this->detect());
    }

    public function report(): array
    {
        $violations = $this->detect();
        return [
            'total_query_templates' => count($this->queryTemplates),
            'total_queries' => array_sum(array_map('count', $this->queryTemplates)),
            'violations' => $violations,
            'violation_count' => count($violations),
        ];
    }
}
```

### 3.3 在测试中使用 N+1 Detector

最有效的 N+1 检测时机是**测试阶段**：

```php
<?php

namespace Tests\Feature;

use App\Support\Performance\NPlusOneDetector;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrderApiTest extends TestCase
{
    use RefreshDatabase;

    protected NPlusOneDetector $detector;

    protected function setUp(): void
    {
        parent::setUp();
        $this->detector = new NPlusOneDetector(threshold: 5, strict: true);
        $this->detector->start();
    }

    public function test_order_list_has_no_n_plus_one(): void
    {
        // 准备数据
        $user = User::factory()->create();
        Order::factory()->count(50)->create(['user_id' => $user->id]);

        // 执行请求
        $response = $this->actingAs($user)
            ->getJson('/api/v1/orders');

        $response->assertOk();

        // 检查 N+1
        $report = $this->detector->report();
        $this->assertEquals(
            0,
            $report['violation_count'],
            "检测到 N+1 问题:\n" . json_encode($report['violations'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        );
    }

    public function test_order_list_query_count_within_budget(): void
    {
        $user = User::factory()->create();
        Order::factory()->count(50)->create(['user_id' => $user->id]);

        $before = DB::getQueryLog();
        $response = $this->actingAs($user)->getJson('/api/v1/orders');
        $after = DB::getQueryLog();

        $queryCount = count($after) - count($before);
        $this->assertLessThanOrEqual(10, $queryCount, "查询数 {$queryCount} 超出预算 (10)");
    }
}
```

### 3.4 Laravel Telescope 集成

如果项目已经使用 Telescope，可以直接在 `AppServiceProvider` 中注册检测：

```php
<?php

namespace App\Providers;

use App\Support\Performance\NPlusOneDetector;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(NPlusOneDetector::class, function () {
            return new NPlusOneDetector(
                threshold: config('performance.n_plus_one_threshold', 10),
                strict: app()->environment('testing')
            );
        });
    }

    public function boot(): void
    {
        if (app()->environment('local', 'testing')) {
            /** @var NPlusOneDetector $detector */
            $detector = app(NPlusOneDetector::class);
            $detector->start();

            app()->terminating(function () use ($detector) {
                $report = $detector->report();
                if ($report['violation_count'] > 0) {
                    Log::warning('N+1 queries detected', $report);
                }
            });
        }
    }
}
```

---

## 四、内存峰值监控

### 4.1 内存追踪器

```php
<?php

namespace App\Support\Performance;

use Illuminate\Support\Facades\Log;

class MemoryTracker
{
    protected int $startMemory;
    protected int $peakMemory;
    protected int $limitBytes;
    protected array $checkpoints = [];

    public function __construct(int $limitMB = 128)
    {
        $this->limitBytes = $limitMB * 1024 * 1024;
    }

    public function start(): void
    {
        $this->startMemory = memory_get_usage(true);
        $this->peakMemory = $this->startMemory;
        $this->checkpoint('init');
    }

    public function checkpoint(string $label): void
    {
        $current = memory_get_usage(true);
        $this->peakMemory = max($this->peakMemory, memory_get_peak_usage(true));

        $this->checkpoints[] = [
            'label' => $label,
            'current_mb' => round($current / 1024 / 1024, 2),
            'peak_mb' => round($this->peakMemory / 1024 / 1024, 2),
            'delta_mb' => round(($current - $this->startMemory) / 1024 / 1024, 2),
        ];
    }

    public function isOverBudget(): bool
    {
        return memory_get_peak_usage(true) > $this->limitBytes;
    }

    public function report(): array
    {
        $peak = memory_get_peak_usage(true);
        return [
            'start_mb' => round($this->startMemory / 1024 / 1024, 2),
            'peak_mb' => round($peak / 1024 / 1024, 2),
            'limit_mb' => round($this->limitBytes / 1024 / 1024, 2),
            'over_budget' => $this->isOverBudget(),
            'checkpoints' => $this->checkpoints,
        ];
    }

    public function getPeakMB(): float
    {
        return round(memory_get_peak_usage(true) / 1024 / 1024, 2);
    }
}
```

### 4.2 集成到 Middleware

扩展之前的 `CountQueries` 中间件，加入内存监控：

```php
<?php

namespace App\Http\Middleware;

use App\Support\Performance\MemoryTracker;
use App\Support\Performance\NPlusOneDetector;
use App\Support\Performance\QueryCounter;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class PerformanceBudget
{
    public function handle(Request $request, Closure $next): Response
    {
        // 启动所有追踪器
        $queryCounter = new QueryCounter(
            limit: config('performance.query_limit', 50),
            context: $request->path()
        );
        $queryCounter->start();

        $memoryTracker = new MemoryTracker(
            limitMB: config('performance.memory_limit_mb', 128)
        );
        $memoryTracker->start();

        $nPlusOneDetector = null;
        if (app()->environment('local', 'testing')) {
            $nPlusOneDetector = new NPlusOneDetector(
                threshold: config('performance.n_plus_one_threshold', 10)
            );
            $nPlusOneDetector->start();
        }

        // 执行请求
        $response = $next($request);

        // 收集报告
        $memoryTracker->checkpoint('response_ready');

        $budget = [
            'queries' => $queryCounter->report(),
            'memory' => $memoryTracker->report(),
        ];

        if ($nPlusOneDetector) {
            $budget['n_plus_one'] = $nPlusOneDetector->report();
        }

        // 注入响应头
        if (config('performance.inject_headers')) {
            $response->headers->set('X-Query-Count', (string) $queryCounter->getCount());
            $response->headers->set('X-Memory-Peak-MB', (string) $memoryTracker->getPeakMB());
        }

        // 超预算处理
        $overBudget = $queryCounter->isOverBudget() || $memoryTracker->isOverBudget();

        if ($overBudget || ($nPlusOneDetector && $nPlusOneDetector->hasViolations())) {
            Log::warning('Performance budget violation', $budget);

            if (app()->environment('testing') && config('performance.ci_strict_mode')) {
                // 测试环境 + CI 严格模式：直接失败
                throw new \RuntimeException(
                    'Performance budget exceeded: ' . json_encode($budget, JSON_PRETTY_PRINT)
                );
            }
        }

        return $response;
    }
}
```

---

## 五、CI 门禁集成

### 5.1 PHPUnit 基类

创建一个专用的性能测试基类，所有接口测试继承它：

```php
<?php

namespace Tests\Feature;

use App\Support\Performance\MemoryTracker;
use App\Support\Performance\NPlusOneDetector;
use App\Support\Performance\QueryCounter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase as BaseTestCase;

class PerformanceTestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected QueryCounter $queryCounter;
    protected MemoryTracker $memoryTracker;
    protected NPlusOneDetector $nPlusOneDetector;

    // 子类可覆盖的预算配置
    protected int $queryBudget = 50;
    protected int $memoryBudgetMB = 128;
    protected int $nPlusOneThreshold = 10;

    protected function setUp(): void
    {
        parent::setUp();

        $this->queryCounter = new QueryCounter($this->queryBudget, static::class . '::' . $this->getName());
        $this->queryCounter->start();

        $this->memoryTracker = new MemoryTracker($this->memoryBudgetMB);
        $this->memoryTracker->start();

        $this->nPlusOneDetector = new NPlusOneDetector($this->nPlusOneThreshold, true);
        $this->nPlusOneDetector->start();
    }

    protected function tearDown(): void
    {
        $this->assertPerformanceBudget();
        parent::tearDown();
    }

    protected function assertPerformanceBudget(): void
    {
        // 查询数检查
        $this->assertFalse(
            $this->queryCounter->isOverBudget(),
            "查询数 {$this->queryCounter->getCount()} 超出预算 ({$this->queryBudget})" .
            "\n最慢查询:\n" . $this->formatSlowQueries()
        );

        // 内存检查
        $this->assertFalse(
            $this->memoryTracker->isOverBudget(),
            "内存峰值 {$this->memoryTracker->getPeakMB()}MB 超出预算 ({$this->memoryBudgetMB}MB)"
        );

        // N+1 检查
        $nPlusOneReport = $this->nPlusOneDetector->report();
        $this->assertEquals(
            0,
            $nPlusOneReport['violation_count'],
            "检测到 N+1 问题:\n" . json_encode($nPlusOneReport['violations'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        );
    }

    protected function formatSlowQueries(): string
    {
        $slowest = $this->queryCounter->getSlowest(3);
        $lines = [];
        foreach ($slowest as $q) {
            $lines[] = "  [{$q['time']}ms] {$q['sql']}";
        }
        return implode("\n", $lines);
    }
}
```

### 5.2 具体测试用例

```php
<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\User;

class OrderApiPerformanceTest extends PerformanceTestCase
{
    // 为这个接口设定更严格的预算
    protected int $queryBudget = 15;
    protected int $memoryBudgetMB = 64;

    public function test_list_orders_within_budget(): void
    {
        $user = User::factory()->create();
        Order::factory()->count(100)->create(['user_id' => $user->id]);

        $response = $this->actingAs($user)
            ->getJson('/api/v1/orders');

        $response->assertOk();
        // tearDown 中会自动检查预算
    }

    public function test_show_order_within_budget(): void
    {
        $user = User::factory()->create();
        $order = Order::factory()->create(['user_id' => $user->id]);

        $response = $this->actingAs($user)
            ->getJson("/api/v1/orders/{$order->id}");

        $response->assertOk();
    }

    public function test_dashboard_within_budget(): void
    {
        $user = User::factory()->create();
        Order::factory()->count(200)->create(['user_id' => $user->id]);

        // Dashboard 通常查询较多，预算放宽
        $this->queryBudget = 30;

        $response = $this->actingAs($user)
            ->getJson('/api/v1/dashboard');

        $response->assertOk();
    }
}
```

### 5.3 GitHub Actions 配置

```yaml
# .github/workflows/performance-budget.yml
name: Performance Budget

on:
  pull_request:
    branches: [main, develop]

jobs:
  performance-check:
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
          --health-retries=3

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, mysql
          coverage: none

      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Prepare Environment
        run: |
          cp .env.testing .env
          php artisan key:generate
          # 启用严格性能模式
          echo "PERFORMANCE_CI_STRICT=true" >> .env
          echo "PERFORMANCE_QUERY_LIMIT=50" >> .env
          echo "PERFORMANCE_MEMORY_LIMIT_MB=128" >> .env

      - name: Run Migrations
        run: php artisan migrate --force

      - name: Run Performance Tests
        run: php artisan test --filter="PerformanceTest" --no-coverage

      - name: Run Full Test Suite with Budget
        run: |
          PERFORMANCE_CI_STRICT=true php artisan test --no-coverage
```

### 5.4 本地 pre-push hook

```bash
#!/bin/bash
# .git/hooks/pre-push

echo "🔍 Running performance budget checks..."
PERFORMANCE_CI_STRICT=true php artisan test --filter="PerformanceTest" --no-coverage

if [ $? -ne 0 ]; then
    echo "❌ Performance budget check failed. Push rejected."
    exit 1
fi

echo "✅ Performance budget check passed."
```

---

## 六、进阶：按路由分级预算

不同接口的复杂度不同，预算也应该不同。创建一个路由级预算配置：

```php
<?php
// config/performance.php (补充)

return [
    // ... 前面的配置

    'route_budgets' => [
        // 简单 CRUD：严格预算
        'api/v1/users' => ['queries' => 10, 'memory_mb' => 32],
        'api/v1/categories' => ['queries' => 8, 'memory_mb' => 16],

        // 中等复杂度
        'api/v1/orders' => ['queries' => 20, 'memory_mb' => 64],
        'api/v1/products' => ['queries' => 15, 'memory_mb' => 48],

        // 复杂接口：放宽预算
        'api/v1/dashboard' => ['queries' => 50, 'memory_mb' => 128],
        'api/v1/reports' => ['queries' => 80, 'memory_mb' => 256],

        // 批量操作
        'api/v1/batch' => ['queries' => 100, 'memory_mb' => 512],
    ],
];
```

中间件中动态解析：

```php
protected function resolveBudget(Request $request): array
{
    $budgets = config('performance.route_budgets', []);
    $path = $request->path();

    foreach ($budgets as $pattern => $budget) {
        if (str_starts_with($path, $pattern)) {
            return $budget;
        }
    }

    return [
        'queries' => config('performance.query_limit', 50),
        'memory_mb' => config('performance.memory_limit_mb', 128),
    ];
}
```

---

## 七、生产环境的轻量方案

生产环境不能加太多追踪开销。以下是一个采样方案：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class PerformanceSampling
{
    public function handle(Request $request, Closure $next): Response
    {
        // 只采样 1% 的请求
        if (random_int(1, 100) > 1) {
            return $next($request);
        }

        $startMemory = memory_get_usage(true);
        $startQueries = count(\DB::getQueryLog());
        $startTime = microtime(true);

        $response = $next($request);

        $duration = (microtime(true) - $startTime) * 1000;
        $queryCount = count(\DB::getQueryLog()) - $startQueries;
        $memoryPeak = memory_get_peak_usage(true) - $startMemory;

        Log::info('Performance sample', [
            'path' => $request->path(),
            'method' => $request->method(),
            'duration_ms' => round($duration, 2),
            'query_count' => $queryCount,
            'memory_delta_mb' => round($memoryPeak / 1024 / 1024, 2),
            'status' => $response->getStatusCode(),
        ]);

        return $response;
    }
}
```

---

## 八、Dashboard 可视化

用一个简单的 Artisan 命令输出性能报告：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PerformanceReport extends Command
{
    protected $signature = 'performance:report {--days=7}';
    protected $description = 'Generate performance budget report from logs';

    public function handle(): void
    {
        $days = $this->option('days');

        // 从日志中提取性能数据
        // 实际项目中建议用 APM 工具（如 New Relic、Datadog）
        $this->info("📊 Performance Budget Report (last {$days} days)");
        $this->line(str_repeat('─', 60));

        // 这里简化处理，实际项目中从日志/APM 查询
        $this->table(
            ['Metric', 'Value', 'Budget', 'Status'],
            [
                ['Avg Query Count', '12', '50', '✅'],
                ['P95 Query Count', '38', '50', '✅'],
                ['P99 Query Count', '67', '50', '❌ Over'],
                ['Avg Memory (MB)', '45', '128', '✅'],
                ['P95 Memory (MB)', '98', '128', '✅'],
                ['N+1 Incidents', '3', '0', '❌'],
            ]
        );
    }
}
```

---

## 九、踩坑记录

### 坑 1：DB::getQueryLog() 在测试中不准确

`DB::getQueryLog()` 默认是关闭的，需要先调用 `DB::enableQueryLog()`。而且它记录的是**连接级别**的查询，如果用了多连接（read/write），需要分别统计。

```php
// 在 TestCase setUp 中确保开启
DB::enableQueryLog();

// tearDown 中获取后重置
$queries = DB::getQueryLog();
DB::flushQueryLog();
```

### 坑 2：内存追踪在队列任务中失效

`memory_get_peak_usage(true)` 在 CLI 模式下是进程级别的，队列 worker 是长驻进程，峰值会累积。解决方案：

```php
// 在 Job 的 handle 方法开头重置
$beforeMemory = memory_get_usage(true);

// ... 业务逻辑

$afterMemory = memory_get_peak_usage(true);
$jobMemory = $afterMemory - $beforeMemory;
```

### 坑 3：预加载也不能无限加

`with()` 不是万能的。关联太多，SQL JOIN 会变复杂，数据量会膨胀：

```php
// ❌ 过度预加载
Order::with(['user', 'items', 'items.product', 'items.product.category', 'payments', 'shipping'])->get();

// ✅ 按需拆分
$orders = Order::with(['user', 'items.product'])->get(); // 列表页
$order = Order::with(['user', 'items.product', 'payments', 'shipping'])->find($id); // 详情页
```

### 坑 4：CI 中的数据库状态影响测试

测试数据量不同，查询计划可能不同。建议：

- 测试数据量要接近真实场景（不要只插 3 条记录）
- 用 `RefreshDatabase` trait 确保每次测试状态一致
- 对于性能关键的测试，用 factory 批量创建 100+ 条记录

### 坑 5：`cursor()` vs `get()` 的内存差异

```php
// ❌ 内存：加载全部记录到内存
$users = User::all();
foreach ($users as $user) { /* ... */ }

// ✅ 内存：逐条拉取，内存恒定
foreach (User::cursor() as $user) { /* ... */ }

// ✅ 更好：chunk 分批处理
User::chunk(100, function ($users) {
    foreach ($users as $user) { /* ... */ }
});
```

---

## 十、总结

Performance Budget 的核心理念：

| 维度 | 工具 | 卡点 |
|------|------|------|
| 查询数 | QueryCounter | 中间件 + 测试 |
| N+1 | NPlusOneDetector | 测试 + 开发环境日志 |
| 内存 | MemoryTracker | 中间件 + 测试 |
| 响应时间 | APM (New Relic/Datadog) | 监控告警 |
| CI 门禁 | PHPUnit + GitHub Actions | PR 合并前 |

落地优先级建议：

1. **第一步**：在测试中加 `QueryCounter`，先有度量
2. **第二步**：加 N+1 Detector，消灭存量问题
3. **第三步**：CI 门禁卡住新增问题
4. **第四步**：生产采样 + Dashboard，持续观测

性能治理不是一次性工程，而是持续的过程。有了 Budget，团队就有了共同语言：「这个接口超预算了」比「这个接口好像有点慢」有效得多。

---

*参考资料：*
- [Laravel Database: Query Logging](https://laravel.com/docs/queries#query-logging)
- [Laravel Telescope](https://laravel.com/docs/telescope)
- [Web Performance Budget (Google)](https://web.dev/performance-budgets-101/)
