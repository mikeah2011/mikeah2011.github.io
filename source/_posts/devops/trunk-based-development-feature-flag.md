---

title: Trunk-Based Development 深度实战：Feature Flag 替代长生命周期分支的工程化落地
keywords: [Trunk, Based Development, Feature Flag, 深度实战, 替代长生命周期分支的工程化落地]
date: 2026-06-02 12:00:00
tags:
- Trunk-Based Development
- Feature Flags
- CI/CD
- Git
- 工程化
categories:
- devops
description: 深入解析 Trunk-Based Development（TBD）方法论，对比 GitFlow 的痛点，实战 Laravel Feature Flag 架构设计与实现。涵盖 Flag 可见性控制、灰度发布、A/B 测试、CI/CD 流程适配，以及从长生命周期分支到主干开发的团队迁移策略。适合中大型团队从 GitFlow 平滑过渡到 TBD，消除合并冲突、加速发布节奏的工程化落地指南。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---



# Trunk-Based Development 深度实战：Feature Flag 替代长生命周期分支的工程化落地

## 前言

你是否经历过这样的场景？

```
main 分支已经落后 feature/payment-v2 分支 3000+ 个 commit
合并时产生了 200+ 个冲突
CI 在合并后突然全部变红
团队花了一周时间解决合并冲突而不是开发新功能
```

这就是长生命周期分支（Long-lived Branch）带来的经典噩梦。**Trunk-Based Development（TBD）** 是解决这个问题的核心方法论——所有开发者直接向主干（trunk/main）提交代码，用 **Feature Flag** 控制功能的可见性，从而彻底消除大规模合并冲突。

本文将从理论到实践，完整覆盖 TBD 的工程化落地：方法论对比、Feature Flag 架构设计、Laravel 实现、CI/CD 流程设计、团队迁移策略。

---

## 一、GitFlow 的问题：为什么我们需要改变

### 1.1 GitFlow 工作流回顾

```
main ──────────────────────────────────────────→
  │                                    ↑
  └─→ develop ─┬─→ feature/A ─→ merge ─┘
               ├─→ feature/B ─→ merge
               ├─→ feature/C ─→ merge
               └─→ release/v1.2 ─→ QA ─→ merge → main
```

GitFlow 在 2010 年 Vincent Driessen 提出时是合理的——当时的 CI/CD 工具不成熟，发布周期以周甚至月计算。但在现代工程实践中，它暴露了严重的问题。

### 1.2 长生命周期分支的五大代价

**代价一：合并地狱**

```
feature/payment-v2 分支存活时间：8 周
期间 main 分支新增 commit：347 个
合并冲突文件数：89 个
解决冲突耗时：3 天
引入的回归 Bug：7 个
```

**代价二：集成延迟**

```
feature/A 开发 2 周 → 才合入 develop
feature/B 开发 3 周 → 才合入 develop
feature/A 和 B 同时修改了 UserService → 冲突
```

问题在开发阶段被隐藏，直到合并时才暴露。越晚发现的 Bug，修复成本越高。

**代价三：代码审查质量下降**

```
feature/payment-v2 PR:
  - 47 个文件变更
  - 2,891 行新增
  - 847 行删除
  - 审查者：看了一小时后 approve（因为实在看不完了）
```

大型 PR 的审查质量必然下降——审查者疲劳后倾向于直接 approve。

**代价四：环境管理复杂**

```
feature/A 需要测试环境 → 分配 env-feature-A
feature/B 需要测试环境 → 分配 env-feature-B
feature/C 需要测试环境 → 分配 env-feature-C
...
环境资源不够 → 排队等待 → 开发效率下降
```

**代价五：发布风险不可控**

当 develop 合并了 A、B、C 三个功能准备发布时，如果 C 有 Bug：

```
选项 1：修复 C → 延迟发布（A 和 B 被 C 连累）
选项 2：回滚 C 的合并 → 复杂且有风险
选项 3：发布带 Bug 的版本 → 用户体验受损
```

---

## 二、Trunk-Based Development 核心理念

### 2.1 TBD 的基本原则

```
main ──●──●──●──●──●──●──●──●──●──●──→ (所有人直接提交)
       ↑  ↑  ↑  ↑  ↑  ↑  ↑  ↑  ↑  ↑
       A  B  A  C  B  A  D  C  B  A   (不同开发者)
```

**核心原则：**

1. **所有开发者向主干提交**：只有一个长期存在的分支（main/trunk）
2. **短生命周期分支**：如需分支，存活时间不超过 1-2 天
3. **Feature Flag 控制可见性**：未完成的功能通过 Flag 隐藏
4. **持续集成**：每次提交都触发完整的 CI 流程
5. **随时可发布**：main 分支永远处于可发布状态

### 2.2 TBD vs GitFlow 详细对比

| 维度 | GitFlow | Trunk-Based |
|------|---------|-------------|
| 分支策略 | 长生命周期多分支 | 主干 + 短命分支 |
| 合并频率 | 功能完成后合并 | 每天多次提交 |
| 合并冲突 | 大且频繁 | 小且罕见 |
| 功能隔离 | 通过分支隔离 | 通过 Feature Flag 隔离 |
| 发布节奏 | 按版本发布 | 随时可发布 |
| CI 集成 | 合并后才验证 | 每次提交都验证 |
| 代码审查 | 大 PR，审查困难 | 小 PR，审查高效 |
| 回滚难度 | 回滚整个版本 | 关闭 Feature Flag 即可 |
| 适用场景 | 发布周期长、团队小 | 持续交付、团队协作 |

### 2.3 TBD 的短生命周期分支策略

TBD 不是完全禁止分支——而是要求分支的生命周期尽可能短：

```
main ──●──●──●──●──●──●──●──→
         ↑        ↑
         │        └─ merge (1天后)
         │
         └─ create short-lived branch
            (feature/small-change)
            持续从 main rebase
```

**黄金法则：分支存活时间 ≤ 1 天**

如果一个功能需要 3 天开发，应该将其拆分为：
- Day 1: 提交基础框架（Feature Flag = off）
- Day 2: 提交核心逻辑（Feature Flag = off）
- Day 3: 提交完整功能 + 打开 Feature Flag

---

## 三、Feature Flag 架构设计

### 3.1 Feature Flag 的分类

```
┌─────────────────────────────────────────────────┐
│              Feature Flag 分类                   │
├──────────────┬──────────────┬───────────────────┤
│  Release Flag │  Experiment  │   Ops Flag        │
│  (发布控制)    │  (A/B 测试)  │   (运维控制)       │
├──────────────┼──────────────┼───────────────────┤
│ 控制功能可见性  │ 控制流量分配  │ 控制系统行为        │
│ 开发完成后删除  │ 实验结束后删除│ 长期存在           │
│ 二元开关       │ 百分比/分组   │ 动态配置           │
└──────────────┴──────────────┴───────────────────┘
```

**Release Flag（发布控制 Flag）**：最常用，用于隐藏开发中的功能

```php
@if(feature('new_payment_flow'))
    <x-payment-v2.checkout />
@else
    <x-payment-v1.checkout />
@endif
```

**Experiment Flag（实验 Flag）**：用于 A/B 测试

```php
$variant = feature_variant('checkout_button_color');
// 'control' → 蓝色按钮
// 'variant_a' → 绿色按钮
// 'variant_b' → 红色按钮
```

**Ops Flag（运维 Flag）**：用于运行时控制

```php
if (feature('maintenance_mode')) {
    return response()->view('maintenance');
}
```

### 3.2 Feature Flag 的评估上下文

一个成熟的 Feature Flag 系统需要支持基于上下文的评估：

```php
// 全局开关
feature('new_search')  // true / false

// 基于用户
feature('new_search', user: $user)  // 特定用户是否启用

// 基于环境
feature('new_search')  // staging=true, production=false

// 基于百分比灰度
feature('new_search')  // 10% 的用户启用

// 基于规则组合
feature('new_search')  // VIP 用户 + staging 环境 → 启用
```

### 3.3 Flag 生命周期管理

Feature Flag 最大的风险是**腐烂**——永远不被清理的 Flag 带来技术债务。

```
创建 → 开发中（off） → 灰度测试（10%） → 全量发布（100%） → 清理代码 → 删除 Flag
                                                                    ↑
                                                          关键步骤：必须有明确的清理计划
```

**Flag 生命周期管理规则：**

1. 每个 Flag 必须有 **Owner** 和 **过期日期**
2. 超过 30 天未清理的 Flag 触发告警
3. CI 中自动检测未使用的 Flag
4. 发布后的下个 Sprint 必须清理已全量的 Flag

---

## 四、Laravel Feature Flag 实现

### 4.1 方案一：自建轻量级实现

对于中小项目，可以自建一个轻量级 Feature Flag 系统：

```php
<?php

namespace App\Services\FeatureFlag;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class FeatureFlagService
{
    /**
     * 评估 Feature Flag
     */
    public function evaluate(
        string $flagName,
        ?object $user = null,
        ?string $environment = null,
    ): bool|string {
        $flag = $this->getFlag($flagName);

        if (!$flag) {
            return false; // 未知 Flag 默认关闭
        }

        // 1. 检查全局开关
        if (!$flag->enabled) {
            return false;
        }

        // 2. 检查环境限制
        $env = $environment ?? app()->environment();
        if (!in_array($env, $flag->environments)) {
            return false;
        }

        // 3. 检查用户白名单
        if ($user && $this->isInAllowlist($flagName, $user)) {
            return true;
        }

        // 4. 检查规则
        if ($rules = $flag->rules) {
            $result = $this->evaluateRules($rules, $user);
            if ($result !== null) {
                return $result;
            }
        }

        // 5. 灰度百分比
        return $this->evaluatePercentage($flagName, $flag->percentage, $user);
    }

    protected function getFlag(string $name): ?object
    {
        return Cache::remember("feature_flag:{$name}", 300, function () use ($name) {
            return DB::table('feature_flags')
                ->where('name', $name)
                ->first();
        });
    }

    protected function isInAllowlist(string $flagName, object $user): bool
    {
        return DB::table('feature_flag_allowlists')
            ->where('flag_name', $flagName)
            ->where('user_id', $user->id)
            ->exists();
    }

    protected function evaluatePercentage(
        string $flagName,
        int $percentage,
        ?object $user
    ): bool {
        // 使用一致性哈希，确保同一用户总是得到相同结果
        $seed = $user
            ? crc32($flagName . ':' . $user->id)
            : crc32($flagName . ':' . session()->getId());

        return ($seed % 100) < $percentage;
    }

    protected function evaluateRules(array $rules, ?object $user): ?bool
    {
        foreach ($rules as $rule) {
            if ($this->matchesRule($rule, $user)) {
                return $rule['result'];
            }
        }
        return null;
    }

    protected function matchesRule(array $rule, ?object $user): bool
    {
        return match ($rule['type']) {
            'user_role' => $user && in_array($user->role, $rule['values']),
            'user_id' => $user && in_array($user->id, $rule['values']),
            'country' => $user && in_array($user->country ?? '', $rule['values']),
            default => false,
        };
    }
}
```

数据库迁移：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('feature_flags', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->boolean('enabled')->default(false);
            $table->json('environments')->default(['local', 'testing']);
            $table->unsignedTinyInteger('percentage')->default(0);
            $table->json('rules')->nullable();
            $table->string('owner');
            $table->timestamp('expires_at')->nullable();
            $table->text('description')->nullable();
            $table->timestamps();
        });

        Schema::create('feature_flag_allowlists', function (Blueprint $table) {
            $table->id();
            $table->string('flag_name')->index();
            $table->unsignedBigInteger('user_id');
            $table->timestamps();

            $table->unique(['flag_name', 'user_id']);
        });
    }
};
```

Facade 和 Helper：

```php
<?php

namespace App\Services\FeatureFlag;

use Illuminate\Support\Facades\Facade;

class FeatureFlagFacade extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return FeatureFlagService::class;
    }
}
```

```php
<?php

// app/Helpers/FeatureFlag.php

if (!function_exists('feature')) {
    /**
     * 评估 Feature Flag
     */
    function feature(
        string $flagName,
        ?object $user = null,
        mixed $default = false,
    ): bool {
        return app(FeatureFlagService::class)
            ->evaluate($flagName, $user) ?? $default;
    }
}
```

使用示例：

```php
// 在 Controller 中
public function checkout(CheckoutRequest $request)
{
    if (feature('new_payment_flow', user: $request->user())) {
        return $this->newCheckout($request);
    }

    return $this->legacyCheckout($request);
}

// 在 Blade 模板中
@if(feature('redesigned_dashboard'))
    <x-dashboard.v2 />
@else
    <x-dashboard.v1 />
@endif

// 在 API 响应中
public function index()
{
    $products = Product::all();

    if (feature('product_recommendations')) {
        $products->load('recommendations');
    }

    return ProductResource::collection($products);
}
```

### 4.2 方案二：集成 LaunchDarkly（企业级）

对于大型项目，建议使用专业的 Feature Flag 平台：

```php
<?php

namespace App\Services\FeatureFlag;

use LaunchDarkly\LDClient;
use LaunchDarkly\LDUser;

class LaunchDarklyService
{
    private LDClient $client;

    public function __construct()
    {
        $this->client = new LDClient(env('LAUNCHDARKLY_SDK_KEY'));
    }

    public function evaluate(
        string $flagKey,
        ?object $user = null,
        bool $default = false,
    ): bool {
        $ldUser = $this->buildUser($user);
        return $this->client->variation($flagKey, $ldUser, $default);
    }

    public function evaluateVariant(
        string $flagKey,
        ?object $user = null,
        string $default = 'control',
    ): string {
        $ldUser = $this->buildUser($user);
        return $this->client->variation($flagKey, $ldUser, $default);
    }

    private function buildUser(?object $user): LDUser
    {
        if (!$user) {
            return (new LDUserBuilder('anonymous'))
                ->anonymous(true)
                ->build();
        }

        $builder = (new LDUserBuilder((string) $user->id))
            ->name($user->name)
            ->email($user->email)
            ->custom('role', $user->role)
            ->custom('plan', $user->plan ?? 'free');

        if ($user->created_at) {
            $builder->custom(
                'account_age_days',
                now()->diffInDays($user->created_at)
            );
        }

        return $builder->build();
    }
}
```

### 4.3 方案三：Flipt（自托管开源方案）

Flipt 是一个自托管的 Feature Flag 平台，适合不想依赖第三方服务的团队：

```yaml
# docker-compose.yml 添加 Flipt
services:
  flipt:
    image: flipt/flipt:latest
    ports:
      - "8080:8080"
    volumes:
      - flipt_data:/var/opt/flipt
    environment:
      FLIPT_DB_URL: file:/var/opt/flipt/flipt.db

volumes:
  flipt_data:
```

```php
<?php

namespace App\Services\FeatureFlag;

use Illuminate\Support\Facades\Http;

class FliptService
{
    private string $baseUrl;

    public function __construct()
    {
        $this->baseUrl = config('services.flipt.url', 'http://flipt:8080');
    }

    public function evaluate(
        string $flagKey,
        ?object $user = null,
    ): bool {
        $response = Http::post("{$this->baseUrl}/api/v1/evaluate", [
            'namespace_key' => 'default',
            'flag_key' => $flagKey,
            'entity_key' => $user ? (string) $user->id : 'anonymous',
            'context' => [
                'role' => $user?->role ?? 'guest',
                'environment' => app()->environment(),
            ],
        ]);

        return $response->json('enabled', false);
    }
}
```

### 4.4 方案对比

| 方案 | 成本 | 托管 | 功能 | 适用场景 |
|------|------|------|------|---------|
| 自建 | 低 | 自己 | 基础 | 小团队、简单需求 |
| LaunchDarkly | 高 | 第三方 | 全面 | 企业级、大流量 |
| Flipt | 低 | 自托管 | 中等 | 隐私敏感、预算有限 |
| Unleash | 低/中 | 都支持 | 中等 | 中大型团队 |

---

## 五、CI/CD 流程设计

### 5.1 TBD 的 CI/CD 原则

```
1. 每次 push 都运行完整 CI
2. CI 必须在 10 分钟内完成（否则开发者会跳过）
3. 主干必须始终绿色（不允许合并失败的 PR）
4. 使用 merge queue 防止主干被破坏
```

### 5.2 GitHub Actions 配置

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# 确保同一 PR 的旧 CI 被取消
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: composer
      - run: composer install --no-progress
      - run: vendor/bin/pint --test  # 代码风格
      - run: vendor/bin/phpstan analyse  # 静态分析

  test:
    runs-on: ubuntu-latest
    needs: lint
    strategy:
      matrix:
        php: ['8.2', '8.3']
        database: ['mysql', 'sqlite']
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
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP ${{ matrix.php }}
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
      - run: composer install --no-progress
      - name: Run Tests
        env:
          DB_CONNECTION: ${{ matrix.database }}
          DB_HOST: 127.0.0.1
          DB_PORT: 3306
          DB_DATABASE: testing
          DB_USERNAME: root
          DB_PASSWORD: password
        run: vendor/bin/phpunit --parallel --coverage-clover coverage.xml

  # Feature Flag 一致性检查
  feature-flag-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check Feature Flag consistency
        run: |
          # 检查是否有未使用的 Flag
          python scripts/check_feature_flags.py
          # 检查是否有过期的 Flag
          python scripts/check_expired_flags.py

  # 部署到 staging（只在 main 分支触发）
  deploy-staging:
    if: github.ref == 'refs/heads/main'
    needs: [test, feature-flag-check]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Staging
        run: |
          # 部署代码，不改变 Flag 状态
          ./deploy.sh staging
```

### 5.3 Merge Queue 配置

GitHub 的 Merge Queue 功能是 TBD 的理想伴侣：

```yaml
# .github/workflows/merge-queue.yml
name: Merge Queue

on:
  merge_group:
    types: [checks_requested]

jobs:
  test-in-merge-queue:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Full Test Suite
        run: |
          composer install
          vendor/bin/phpunit
          vendor/bin/phpstan analyse
```

在 GitHub 的 Branch Protection Rules 中：

```
✅ Require merge queue before merging
✅ Maximum pull requests in queue: 5
✅ Minimum pull requests to merge: 1
✅ Merge method: Squash
```

### 5.4 短生命周期分支的工作流

```bash
# 开发者日常工作流
git checkout main
git pull origin main

# 创建短生命周期分支
git checkout -b feature/new-search-api

# 开发（小步提交）
git add .
git commit -m "feat(search): add basic search service (flag: off)"
git push origin feature/new-search-api

# 创建 PR（小 PR，300 行以内）
gh pr create --title "feat(search): add search service behind flag" \
  --body "Feature: new-search-api (flag: new_search, default: off)"

# CI 通过后立即合并
gh pr merge --squash

# 回到 main
git checkout main
git pull origin main
git branch -d feature/new-search-api
```

---

## 六、Laravel 中 Feature Flag 的高级模式

### 6.1 中间件模式

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class FeatureFlagMiddleware
{
    public function handle(Request $request, Closure $next, string $flag, string $redirect = '/')
    {
        if (!feature($flag, user: $request->user())) {
            if ($request->expectsJson()) {
                return response()->json(['error' => 'Feature not available'], 404);
            }

            return redirect($redirect);
        }

        return $next($request);
    }
}
```

```php
// routes/web.php
Route::middleware(['feature:new_checkout'])->group(function () {
    Route::get('/checkout/v2', [NewCheckoutController::class, 'index']);
    Route::post('/checkout/v2/process', [NewCheckoutController::class, 'process']);
});
```

### 6.2 策略模式（推荐）

对于复杂的 Flag 切换，策略模式比 if/else 更优雅：

```php
<?php

namespace App\Services\Payment;

interface PaymentStrategy
{
    public function process(Order $order): PaymentResult;
}

class LegacyPaymentStrategy implements PaymentStrategy
{
    public function process(Order $order): PaymentResult
    {
        // 原有支付逻辑
    }
}

class NewPaymentStrategy implements PaymentStrategy
{
    public function process(Order $order): PaymentResult
    {
        // 新支付逻辑
    }
}

class PaymentStrategyResolver
{
    public function resolve(?User $user = null): PaymentStrategy
    {
        if (feature('new_payment_flow', user: $user)) {
            return app(NewPaymentStrategy::class);
        }

        return app(LegacyPaymentStrategy::class);
    }
}
```

### 6.3 API 响应中的 Flag 控制

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class ProductController extends Controller
{
    public function index(): JsonResponse
    {
        $products = Product::query()
            ->when(feature('product_ai_sorting'), function ($query) {
                $query->orderByAiRelevance(); // 新的 AI 排序
            }, function ($query) {
                $query->orderBy('created_at', 'desc'); // 原有排序
            })
            ->when(feature('product_recommendations'), function ($query) {
                $query->with('recommendations');
            })
            ->paginate();

        $response = ProductResource::collection($products);

        // 在响应头中标记使用了哪些 Flag（便于调试）
        return $response->response()
            ->header('X-Feature-Flags', json_encode([
                'product_ai_sorting' => feature('product_ai_sorting'),
                'product_recommendations' => feature('product_recommendations'),
            ]));
    }
}
```

### 6.4 测试中的 Flag 控制

```php
<?php

namespace Tests\Feature;

use App\Services\FeatureFlag\FeatureFlagService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NewCheckoutTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function it_shows_new_checkout_when_flag_enabled(): void
    {
        // 在测试中强制开启 Flag
        $this->mock(FeatureFlagService::class, function ($mock) {
            $mock->shouldReceive('evaluate')
                ->with('new_payment_flow', \Mockery::any())
                ->andReturn(true);
        });

        $response = $this->actingAs($this->user)->get('/checkout');

        $response->assertSee('New Checkout');
        $response->assertDontSee('Legacy Checkout');
    }

    /** @test */
    public function it_shows_legacy_checkout_when_flag_disabled(): void
    {
        $this->mock(FeatureFlagService::class, function ($mock) {
            $mock->shouldReceive('evaluate')
                ->with('new_payment_flow', \Mockery::any())
                ->andReturn(false);
        });

        $response = $this->actingAs($this->user)->get('/checkout');

        $response->assertSee('Legacy Checkout');
        $response->assertDontSee('New Checkout');
    }

    /** @test */
    public function it_tests_both_paths_in_ci(): void
    {
        // 确保两种路径都能正常工作
        foreach ([true, false] as $flagValue) {
            $this->mock(FeatureFlagService::class, function ($mock) use ($flagValue) {
                $mock->shouldReceive('evaluate')
                    ->andReturn($flagValue);
            });

            $response = $this->actingAs($this->user)->get('/checkout');
            $response->assertOk();
        }
    }
}
```

---

## 七、从 GitFlow 迁移到 TBD

### 7.1 迁移策略

**阶段一：准备（第 1-2 周）**

```
1. 团队培训 TBD 理念
2. 搭建 Feature Flag 基础设施
3. 建立 CI/CD 基础（如果还没有）
4. 制定编码规范（小 PR、频繁提交）
```

**阶段二：试点（第 3-4 周）**

```
1. 选择 1-2 个低风险功能用 TBD 方式开发
2. 建立 Code Review 流程（快速审查、小 PR）
3. 修复 CI 中的 flaky tests
4. 建立 merge queue
```

**阶段三：全量（第 5-8 周）**

```
1. 所有新功能使用 TBD 方式
2. 将长期分支的功能逐步迁移到主干
3. 删除 develop 分支
4. 建立 Flag 清理流程
```

**阶段四：优化（持续）**

```
1. 监控 CI 时间，保持在 10 分钟以内
2. 定期清理过期 Flag
3. 回顾和优化工作流
```

### 7.2 长期分支的迁移方案

对于已经存在很长时间的分支，不可能一次性合并。推荐的迁移方案：

```bash
# 1. 创建新分支，基于最新的 main
git checkout main
git checkout -b feature/migrate-payment-v2

# 2. 将长期分支的改动逐个 cherry-pick 或重写
# 每个改动都加上 Feature Flag
git cherry-pick abc123  # 第一个改动
git cherry-pick def456  # 第二个改动

# 3. 每个小改动单独提 PR 合入 main
gh pr create --title "refactor(payment): extract payment interface (flag: off)"

# 4. 重复直到所有改动都合入 main

# 5. 删除长期分支
git branch -D feature/payment-v2
```

### 7.3 团队心态转变

**开发者需要接受的新理念：**

```
旧思维："功能完成才能合并"
新思维："代码随时可以合并，功能通过 Flag 控制可见性"

旧思维："分支是我的工作空间"
新思维："主干是大家的共享空间，我只做小改动"

旧思维："合并冲突很正常"
新思维："大冲突说明提交频率不够"

旧思维："CI 失败可以后面修"
新思维："主干必须始终绿色"
```

---

## 八、实战案例：电商系统从 GitFlow 迁移到 TBD

### 8.1 迁移前状态

```
团队规模：12 名开发者
分支策略：GitFlow
分支数量：47 个活跃分支
最长分支存活时间：14 周
平均合并冲突数：每次 15-20 个文件
CI 通过率：67%（大量 flaky tests）
发布频率：每 2 周一次
发布准备时间：3 天
```

### 8.2 迁移过程

**Week 1-2：基础设施**
- 搭建自建 Feature Flag 系统（基于 Redis）
- 修复所有 flaky tests（23 个）
- CI 时间优化：从 25 分钟降到 8 分钟

**Week 3-4：试点项目**
- 选择 "商品推荐" 功能试点 TBD
- 功能拆分为 5 个小 PR，每个 < 200 行
- 团队反馈：审查效率提升 3 倍

**Week 5-8：全面迁移**
- 8 个长期分支的功能逐步迁移到主干
- 删除 develop 分支
- 建立 merge queue

**Week 9-12：优化**
- 建立 Flag 清理流程
- 建立发布 Dashboard
- 培训新成员

### 8.3 迁移后效果

```
分支数量：47 → 3（main + 临时分支）
最长分支存活时间：14 周 → 1 天
平均合并冲突数：15-20 → 0-1 个文件
CI 通过率：67% → 98%
发布频率：每 2 周 → 每天
发布准备时间：3 天 → 0（随时可发布）
Code Review 平均时间：2 小时 → 15 分钟
回归 Bug 数：每次发布 5-8 个 → 0-1 个
```

---

## 九、最佳实践清单

### 9.1 提交规范

```
✅ 每天至少提交 1 次到主干
✅ 每个 PR 不超过 300 行变更
✅ 分支存活时间不超过 1 天
✅ 使用 squash merge 保持主干历史清晰
✅ 提交信息遵循 Conventional Commits
```

### 9.2 Feature Flag 规范

```
✅ 每个 Flag 有明确的 Owner
✅ 每个 Flag 有过期日期
✅ Release Flag 发布后 2 周内清理
✅ Flag 名称使用 snake_case，语义清晰
✅ CI 中测试 Flag 的 on/off 两种路径
✅ 生产环境监控 Flag 状态
```

### 9.3 CI/CD 规范

```
✅ CI 时间控制在 10 分钟以内
✅ 主干始终保持绿色
✅ 使用 merge queue 防止主干被破坏
✅ 自动化部署到 staging
✅ 生产发布使用渐进式发布（canary）
```

### 9.4 团队协作规范

```
✅ Code Review 在 1 小时内完成
✅ 不要积压 PR，提交后立即请求审查
✅ 重构和功能变更分开提交
✅ 定期回顾和优化工作流
```

---

## 总结

Trunk-Based Development 不仅仅是一种 Git 工作流，它是一种**工程文化**——追求小步快跑、持续集成、随时可发布。Feature Flag 是实现 TBD 的核心技术手段，它将**代码部署**和**功能发布**解耦，让团队既能快速集成代码，又能精细控制功能的可见性。

从 GitFlow 迁移到 TBD 需要时间，但收益是巨大的：更少的冲突、更快的发布、更高的质量、更好的团队协作。关键在于**循序渐进**——从一个试点功能开始，用实际效果说服团队。

---

*参考资源：*
- [Trunk-Based Development 官方网站](https://trunkbaseddevelopment.com/)
- [Feature Flag Best Practices - LaunchDarkly](https://launchdarkly.com/blog/feature-flag-best-practices/)
- [Martin Fowler - Feature Toggle](https://martinfowler.com/articles/feature-toggles.html)
- [Google - Trunk-Based Development](https://trunkbaseddevelopment.com/)

## 相关阅读

- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/07_CICD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/)
- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/07_CICD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/)
- [Ansible 实战：Laravel 应用自动化部署与配置管理——从 SSH 手工操作到声明式基础设施踩坑记录](/07_CICD/Ansible-实战-Laravel-应用自动化部署与配置管理踩坑记录/)
