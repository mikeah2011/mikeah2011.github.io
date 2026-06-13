---
title: Laravel Pennant + Feature Flags 深度实战：灰度放量回滚兜底的完整闭环——从 1% 到 100% 的渐进式发布工程化
keywords: [Laravel Pennant, Feature Flags, 深度实战, 灰度放量回滚兜底的完整闭环, 的渐进式发布工程化, PHP]
date: 2026-06-09 15:30:00
categories:
  - php
tags:
  - Laravel
  - Pennant
  - Feature Flags
  - 灰度发布
  - 渐进式发布
  - A/B Testing
description: 深入 Laravel Pennant Feature Flags 机制，从底层原理到生产级灰度放量、回滚兜底、A/B 实验的完整工程化闭环，附可运行代码。
cover: https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200
images:
  - https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200
---


## 为什么需要 Feature Flags

上线新功能最怕的是什么？不是 bug，而是**没有退路**。

传统的发布模式是「全量或不发」——代码部署完，所有用户同时看到新功能。一旦出问题，要么紧急回滚代码，要么热修复，两条路都很痛苦。

Feature Flags（功能开关）的核心思想很简单：**把「代码部署」和「功能上线」解耦**。代码已经在线上了，但用户能不能看到，由一个开关控制。这个开关可以按百分比放量、按用户分组、按条件触发，出了问题秒级关闭，不需要动代码。

Laravel Pennant 是官方提供的 Feature Flags 组件，Laravel 10+ 内置支持。它不只是一个简单的 `if/else`，而是一套完整的灰度发布基础设施。

## Pennant 核心概念

### 两种驱动模式

Pennant 支持两种 Feature 驱动方式：

**简单闭包驱动** —— 适合简单的开关场景：

```php
use Laravel\Pennant\Feature;

Feature::define('new-checkout-flow', fn () => true);
```

**类驱动** —— 适合复杂业务逻辑，推荐生产使用：

```php
namespace App\Features;

use Illuminate\Support\Lottery;
use Laravel\Pennant\Feature;

class NewCheckoutFlow
{
    public function resolve(mixed $scope): mixed
    {
        // 按用户 ID 做灰度
        if ($scope instanceof \App\Models\User) {
            return $scope->created_at->gt(now()->subDays(30))
                ? Feature::active('new-checkout-flow-beta')
                : false;
        }

        return false;
    }
}
```

注册方式：

```php
Feature::define('new-checkout-flow', \App\Features\NewCheckoutFlow::class);
```

### Scope（作用域）

Pennant 的 scope 决定「对谁生效」。默认 scope 是当前登录用户，但你可以自定义：

```php
// 全局生效，不区分用户
Feature::define('global-maintenance-mode', fn () => true);

// 按租户生效（多租户场景）
Feature::define('tenant-ai-assistant', function ($tenant) {
    return $tenant->plan === 'enterprise';
});

// 使用时指定 scope
Feature::for($tenant)->active('tenant-ai-assistant');
```

### 存储驱动

| 驱动 | 适用场景 | 持久化 |
|------|---------|--------|
| `database` | 生产环境，需要持久化和审计 | ✅ |
| `array` | 测试，临时开关 | ❌ |

```php
// config/pennant.php
'default' => env('PENNANT_DRIVER', 'database'),
```

## 生产级灰度放量实战

这是本文的核心。我们来实现一个完整的灰度放量流程：**内部测试 → 1% 放量 → 10% 放量 → 50% 全量 → 100% 上线**。

### Step 1: 创建 Feature Flag 管理表

先扩展默认的 Pennant migration，增加灰度控制字段：

```php
// database/migrations/2026_06_09_000001_create_feature_flags_table.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Pennant 自带的表（存储每个 scope 的 feature 状态）
        Schema::create('features', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->morphs('scope');
            $table->text('value')->nullable();
            $table->timestamps();

            $table->unique(['name', 'scope_type', 'scope_id']);
        });

        // 自定义的灰度策略表
        Schema::create('feature_rollouts', function (Blueprint $table) {
            $table->id();
            $table->string('feature_name')->unique();
            $table->enum('stage', ['disabled', 'internal', 'canary', 'partial', 'majority', 'full']);
            $table->unsignedInteger('percentage')->default(0);
            $table->json('whitelist')->nullable();        // 白名单用户 ID
            $table->json('blacklist')->nullable();        // 黑名单用户 ID
            $table->json('conditions')->nullable();       // 额外条件
            $table->boolean('kill_switch')->default(false); // 紧急关闭开关
            $table->timestamp('last_stage_change_at')->nullable();
            $table->timestamps();
        });
    }
};
```

### Step 2: 灰度策略模型

```php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

class FeatureRollout extends Model
{
    protected $guarded = [];

    protected $casts = [
        'whitelist' => 'array',
        'blacklist' => 'array',
        'conditions' => 'array',
        'kill_switch' => 'boolean',
        'last_stage_change_at' => 'datetime',
    ];

    // 灰度阶段与百分比的映射
    public static array $stagePercentages = [
        'disabled' => 0,
        'internal'  => 0,   // 只走白名单
        'canary'    => 1,
        'partial'   => 10,
        'majority'  => 50,
        'full'      => 100,
    ];

    /**
     * 判断某个 scope 是否命中灰度
     */
    public function isActiveFor(mixed $scope): bool
    {
        // 紧急关闭
        if ($this->kill_switch) {
            return false;
        }

        // 完全上线
        if ($this->stage === 'full') {
            return true;
        }

        // 完全关闭
        if ($this->stage === 'disabled') {
            return false;
        }

        $userId = $this->extractUserId($scope);
        if (!$userId) {
            return false;
        }

        // 黑名单优先
        if (in_array($userId, $this->blacklist ?? [])) {
            return false;
        }

        // 白名单放行（internal 阶段靠这个）
        if (in_array($userId, $this->whitelist ?? [])) {
            return true;
        }

        // internal 阶段只看白名单
        if ($this->stage === 'internal') {
            return false;
        }

        // 按百分比判定（基于用户 ID 的一致性哈希）
        $hash = crc32($this->feature_name . ':' . $userId);
        $bucket = abs($hash) % 100;

        return $bucket < $this->percentage;
    }

    /**
     * 推进到下一阶段
     */
    public function advanceStage(): self
    {
        $stages = array_keys(static::$stagePercentages);
        $currentIndex = array_search($this->stage, $stages);

        if ($currentIndex < count($stages) - 1) {
            $nextStage = $stages[$currentIndex + 1];
            $this->update([
                'stage' => $nextStage,
                'percentage' => static::$stagePercentages[$nextStage],
                'last_stage_change_at' => now(),
            ]);
        }

        return $this;
    }

    /**
     * 回滚到上一阶段
     */
    public function rollbackStage(): self
    {
        $stages = array_keys(static::$stagePercentages);
        $currentIndex = array_search($this->stage, $stages);

        if ($currentIndex > 0) {
            $prevStage = $stages[$currentIndex - 1];
            $this->update([
                'stage' => $prevStage,
                'percentage' => static::$stagePercentages[$prevStage],
                'last_stage_change_at' => now(),
            ]);
        }

        return $this;
    }

    /**
     * 紧急关闭（一键熔断）
     */
    public function emergencyDisable(): void
    {
        $this->update([
            'kill_switch' => true,
            'last_stage_change_at' => now(),
        ]);

        // 清除缓存
        Cache::forget("feature_rollout:{$this->feature_name}");
    }

    private function extractUserId(mixed $scope): ?int
    {
        if ($scope instanceof \App\Models\User) {
            return $scope->id;
        }
        if (is_numeric($scope)) {
            return (int) $scope;
        }
        return null;
    }
}
```

### Step 3: Pennant Feature 定义（对接灰度策略）

```php
namespace App\Features;

use App\Models\FeatureRollout;
use Illuminate\Support\Facades\Cache;
use Laravel\Pennant\Feature;

class NewCheckoutFlow
{
    /**
     * resolve 由 Pennant 自动调用，传入 scope（默认是当前用户）
     */
    public function resolve(mixed $scope): bool
    {
        return $this->getRollout('new-checkout-flow')->isActiveFor($scope);
    }

    private function getRollout(string $featureName): FeatureRollout
    {
        return Cache::remember(
            "feature_rollout:{$featureName}",
            60, // 缓存 1 分钟，避免每请求都查库
            fn () => FeatureRollout::firstOrCreate(
                ['feature_name' => $featureName],
                ['stage' => 'disabled', 'percentage' => 0]
            )
        );
    }
}
```

### Step 4: 注册 Feature 和 Service Provider

```php
namespace App\Providers;

use App\Features\NewCheckoutFlow;
use Illuminate\Support\ServiceProvider;
use Laravel\Pennant\Feature;

class FeatureFlagServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 注册所有 feature flag
        Feature::define('new-checkout-flow', NewCheckoutFlow::class);

        // 可以继续注册更多
        Feature::define('ai-search', \App\Features\AiSearch::class);
        Feature::define('new-dashboard', \App\Features\NewDashboard::class);
    }
}
```

### Step 5: 控制器中使用

```php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Laravel\Pennant\Feature;

class CheckoutController extends Controller
{
    public function index(Request $request)
    {
        if (Feature::active('new-checkout-flow')) {
            // 新结算流程
            return view('checkout.v2', $this->getV2Data($request->user()));
        }

        // 老流程兜底
        return view('checkout.v1', $this->getV1Data($request->user()));
    }
}
```

## Blade 模板中的用法

Pennant 提供了 Blade 指令，不用在 Controller 里写 if/else：

```blade
@feature('new-checkout-flow')
    {{-- 新结算流程 --}}
    <x-checkout.v2 :cart="$cart" />
@else
    {{-- 老流程 --}}
    <x-checkout.v1 :cart="$cart" />
@endfeature
```

判断是否禁用：

```blade
@feature('new-checkout-flow')
    {{-- 激活时显示 --}}
@endfeature

{{-- 反向判断 --}}
@unlessfeature('new-checkout-flow')
    <div class="alert">旧版将在 30 天后下线</div>
@endunlessfeature
```

## Artisan 命令行管理

日常运维通过 Artisan 命令操作灰度：

```bash
# 查看所有 feature flag 状态
php artisan feature:list

# 激活某个 feature（默认当前用户）
php artisan feature:activate new-checkout-flow

# 对特定用户激活
php artisan feature:activate new-checkout-flow --scope=App\\Models\\User:123

# 关闭
php artisan feature:deactivate new-checkout-flow
```

## 灰度放量的自动化推进

手动推进灰度太累？写一个 Artisan 命令自动推进：

```php
namespace App\Console\Commands;

use App\Models\FeatureRollout;
use Illuminate\Console\Command;

class FeatureRolloutAdvance extends Command
{
    protected $signature = 'feature:advance {feature : Feature name}
                            {--force : Skip safety checks}';
    protected $description = 'Advance a feature flag to the next rollout stage';

    public function handle(): int
    {
        $rollout = FeatureRollout::where('feature_name', $this->argument('feature'))->firstOrFail();

        $this->info("Current stage: {$rollout->stage} ({$rollout->percentage}%)");

        // 安全检查：距离上次变更是否超过冷却期
        if (!$this->option('force') && $rollout->last_stage_change_at) {
            $cooldownHours = match ($rollout->stage) {
                'canary' => 24,    // 1% 观察 24 小时
                'partial' => 12,   // 10% 观察 12 小时
                'majority' => 6,   // 50% 观察 6 小时
                default => 0,
            };

            if ($rollout->last_stage_change_at->addHours($cooldownHours)->isFuture()) {
                $remaining = $rollout->last_stage_change_at
                    ->addHours($cooldownHours)
                    ->diffForHumans();
                $this->warn("Cooling down. Can advance {$remaining}. Use --force to override.");
                return self::FAILURE;
            }
        }

        // 检查错误率（如果有监控集成）
        if (!$this->checkErrorRate($rollout)) {
            $this->error("Error rate too high! Auto-rollback recommended.");
            return self::FAILURE;
        }

        $rollout->advanceStage();
        $rollout->refresh();

        $this->info("Advanced to: {$rollout->stage} ({$rollout->percentage}%)");

        return self::SUCCESS;
    }

    private function checkErrorRate(FeatureRollout $rollout): bool
    {
        // 接入你的监控系统（Sentry/Prometheus/自建）
        // 这里示例返回 true
        return true;
    }
}
```

配合 Laravel Scheduler 自动推进：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每天检查可推进的 feature flag
    $schedule->command('feature:advance new-checkout-flow')
        ->daily()
        ->withoutOverlapping();
}
```

## 回滚兜底机制

灰度的核心不是「放量」，而是**能随时回滚**。

### 方式一：紧急关闭开关

```php
// 运维一行命令，秒级关闭
php artisan tinker --execute="
    App\Models\FeatureRollout::where('feature_name', 'new-checkout-flow')
        ->update(['kill_switch' => true]);
"
```

### 方式二：自动回滚（监控集成）

```php
namespace App\Listeners;

use App\Models\FeatureRollout;
use Illuminate\Support\Facades\Log;

class FeatureFlagErrorRateListener
{
    /**
     * 当错误率超过阈值时自动回滚
     */
    public function handle(FeatureErrorRateExceeded $event): void
    {
        $rollout = FeatureRollout::where('feature_name', $event->featureName)->first();

        if (!$rollout || $rollout->stage === 'disabled') {
            return;
        }

        Log::critical("Feature flag auto-rollback triggered", [
            'feature' => $event->featureName,
            'stage' => $rollout->stage,
            'error_rate' => $event->errorRate,
        ]);

        // 先回滚到上一阶段
        $rollout->rollbackStage();

        // 如果错误率极高，直接关闭
        if ($event->errorRate > 0.1) {
            $rollout->emergencyDisable();
        }
    }
}
```

### 方式三：定时任务兜底

```php
// 每 5 分钟检查所有正在灰度的 feature flag 的健康状态
$schedule->call(function () {
    $activeRollouts = FeatureRollout::whereIn('stage', ['canary', 'partial', 'majority'])->get();

    foreach ($activeRollouts as $rollout) {
        $errorRate = app(MonitorService::class)->getErrorRate($rollout->feature_name);

        if ($errorRate > 0.05) {
            Log::warning("Feature flag error rate exceeded", [
                'feature' => $rollout->feature_name,
                'stage' => $rollout->stage,
                'error_rate' => $errorRate,
            ]);

            $rollout->rollbackStage();
        }
    }
})->everyFiveMinutes();
```

## A/B 实验集成

Feature Flags 不只是开关，还能做 A/B 实验：

```php
namespace App\Features;

use Laravel\Pennant\Feature;

class CheckoutButtonColor
{
    public function resolve(mixed $scope): string
    {
        // 返回具体变体，不只是 true/false
        $hash = crc32('checkout-button-color:' . $scope->id);
        $bucket = abs($hash) % 100;

        return match (true) {
            $bucket < 33 => 'control',      // 对照组
            $bucket < 66 => 'variant-a',    // 变体 A：绿色按钮
            default      => 'variant-b',    // 变体 B：蓝色按钮
        };
    }
}
```

使用方式：

```php
$variant = Feature::value('checkout-button-color');

// 记录实验数据
ExperimentLogger::log('checkout-button-color', $user, $variant, [
    'page' => 'checkout',
    'session_id' => session()->getId(),
]);
```

```blade
@php $variant = Feature::value('checkout-button-color'); @endphp

<button class="btn btn-{{ $variant === 'variant-a' ? 'success' : ($variant === 'variant-b' ? 'primary' : 'secondary') }}">
    立即支付
</button>
```

## 踩坑记录

### 坑一：resolve 方法的性能问题

**问题**：Pennant 的 `resolve` 在每次调用 `Feature::active()` 时都会执行。如果一个页面调用了 10 次 `Feature::active('xxx')`，resolve 就执行 10 次。

**解决**：Pennant 默认会缓存 resolve 结果（per-request），但要确保 resolve 本身不做重查询：

```php
// ❌ 错误：每次都查数据库
public function resolve(mixed $scope): bool
{
    return DB::table('experiments')->where('user_id', $scope->id)->exists();
}

// ✅ 正确：用 Cache 缓存
public function resolve(mixed $scope): bool
{
    return Cache::remember("feature:my-feature:{$scope->id}", 300, function () use ($scope) {
        // 这里才查库
        return $this->getRollout()->isActiveFor($scope);
    });
}
```

### 坑二：批量查询的 N+1 问题

**问题**：在列表页对每个 item 都调用 `Feature::active()`，即使有 per-request 缓存，首次加载仍然会 N+1。

**解决**：用 `Feature::for($scope)` 预加载：

```php
// ❌ 慢
$users = User::all();
foreach ($users as $user) {
    $user->canSeeNewUI = Feature::for($user)->active('new-dashboard');
}

// ✅ 快：批量预加载
$users = User::all();
Feature::for($users)->active('new-dashboard'); // 预加载所有
foreach ($users as $user) {
    $user->canSeeNewUI = Feature::for($user)->active('new-dashboard'); // 命中缓存
}
```

### 坑三：灰度百分比的一致性

**问题**：用 `rand(1, 100) <= $percentage` 做灰度判定，同一个用户每次刷新页面可能看到不同版本。

**解决**：基于用户 ID + feature name 的一致性哈希：

```php
// ❌ 随机，不一致
return rand(1, 100) <= $this->percentage;

// ✅ 一致性哈希，同一用户始终命中或不命中
$hash = crc32($this->feature_name . ':' . $userId);
$bucket = abs($hash) % 100;
return $bucket < $this->percentage;
```

### 坑四：缓存不一致导致关闭不生效

**问题**：紧急关闭了 kill_switch，但缓存还有 60 秒 TTL，用户继续看到新功能。

**解决**：紧急操作时同步清缓存：

```php
public function emergencyDisable(): void
{
    $this->update(['kill_switch' => true]);

    // 立即清除，不等 TTL
    Cache::forget("feature_rollout:{$this->feature_name}");

    // 如果用了 Redis，还可以用 tag 批量清除
    // Cache::tags(['features'])->flush();
}
```

### 坑五：数据库驱动的性能瓶颈

**问题**：每个请求都查 `features` 表，QPS 高时数据库压力大。

**解决**：Pennant 内置了 per-request 缓存，但如果需要跨请求缓存，可以加一层 Redis：

```php
// config/pennant.php
'stores' => [
    'database' => [
        'driver' => 'database',
        'connection' => null,
        'table' => 'features',
    ],
],
```

对于高频 feature，可以在 resolve 里加 Redis 缓存：

```php
public function resolve(mixed $scope): bool
{
    $cacheKey = "feature:{$this->name}:{$scope->getMorphClass()}:{$scope->getKey()}";

    return Cache::remember($cacheKey, 300, fn () => $this->evaluate($scope));
}
```

## 完整的灰度发布 SOP

把上面的代码串起来，形成一个可执行的标准操作流程：

```
1. 开发阶段
   ├── 创建 Feature 类（App\Features\）
   ├── 注册到 FeatureFlagServiceProvider
   └── 代码中用 Feature::active() 做分支

2. 部署上线
   ├── 代码全量部署（新旧代码并存）
   └── Feature 默认 disabled

3. 灰度放量
   ├── internal → 白名单内测（QA + PM）
   ├── canary → 1% 用户（观察 24h）
   ├── partial → 10% 用户（观察 12h）
   ├── majority → 50% 用户（观察 6h）
   └── full → 100% 上线

4. 监控兜底
   ├── 错误率 > 5% → 自动回滚上一阶段
   ├── 错误率 > 10% → 紧急关闭
   └── 每阶段观察期满才允许推进

5. 清理收尾
   ├── full 稳定运行 7 天后
   ├── 移除 Feature::active() 分支代码
   ├── 删除 Feature 类
   └── 清理数据库记录
```

## 总结

Laravel Pennant + 自建灰度策略表，构成了一套完整的渐进式发布基础设施：

| 能力 | 实现方式 |
|------|---------|
| 灰度放量 | 一致性哈希 + 分阶段百分比 |
| 回滚兜底 | kill_switch + 自动回滚 + 监控集成 |
| A/B 实验 | Feature::value() 返回变体标识 |
| 秒级关闭 | kill_switch + Cache 即时清除 |
| 运维友好 | Artisan 命令 + Scheduler 自动推进 |

核心原则：**部署不等于上线，上线不等于全量，全量不等于不可回退**。

Feature Flags 不是什么高深的技术，但它改变了发布的心理模型——从「赌一把」变成「看一步走一步」。这才是工程化发布的核心。
