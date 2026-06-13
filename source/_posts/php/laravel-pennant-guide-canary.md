---

title: Laravel Pennant 特性开关实战：多租户分桶、灰度放量与回滚兜底踩坑记录
keywords: [Laravel Pennant, 特性开关实战, 多租户分桶, 灰度放量与回滚兜底踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 11:20:06
updated: 2026-05-03 11:21:23
categories:
- php
tags:
- Laravel
- 微服务
- Feature Flags
- Pennant
- canary
- 灰度发布
- 多租户
description: 深入 Laravel Pennant Feature Flag 实战指南，详解多租户场景下的灰度发布与金丝雀发布策略。从 override 表设计、百分比渐进放量到紧急回滚兜底，覆盖 Octane 静态变量串请求、队列消费者对齐等线上踩坑案例。附 Prometheus/Grafana 监控集成、三级回滚方案、特性开关选型对比与上线 Checklist，助你在 Laravel 项目中安全落地 Feature Flag 灰度发布与 A/B 测试能力。
---



我们把结算页重构成 `checkout-v2` 之后，真正难的不是把新页面写出来，而是**怎么只放给 5% 用户、怎么按租户回滚、怎么让队列和 API 看到同一份开关结果**。早期我用过 `.env + if/else`，发布一次要改一次配置；也用过后台表直接查库，结果高峰期每个请求都多打一条 SQL。后来把这件事收口到 **Laravel Pennant**，并补上“稳定分桶 + 手工覆盖 + 日志观测”三件套，灰度才算真正可控。

## 一、线上可用的结构不是“一个布尔值”

```text
Admin Console
    │ 修改租户白名单 / 紧急关闭
    ▼
tenant_feature_overrides
    │
    ├── API Request ──> ResolveRolloutScope Middleware
    │                       │
    │                       ▼
    │                 Laravel Pennant
    │                       │
    │             hash 分桶 + override 兜底
    │                       │
    ▼                       ▼
CheckoutController     Queue Job / Listener
    │                       │
    └────────── 写入统一日志与 response header
```

关键点是：**Pennant 负责算结果，业务库里的 override 负责救火**。只靠代码分桶，线上临时要“给某个租户全开 / 全关”会非常痛苦。

## 二、分桶一定要稳定，别用随机数

我第一次做灰度时，直接写了 `mt_rand(1, 100) <= 5`。结果同一个用户今天命中新页面，下一次请求又回旧页面，客服说“页面在闪”。后面改成稳定 hash：同一个租户、同一个用户，命中结果固定。

```php
<?php

namespace App\Support\Feature;

final readonly class RolloutScope
{
    public function __construct(
        public int $tenantId,
        public int $actorId,
        public bool $isInternal,
    ) {}
}
```

```php
<?php

namespace App\Providers;

use App\Models\TenantFeatureOverride;
use App\Support\Feature\RolloutScope;
use Illuminate\Support\ServiceProvider;
use Laravel\Pennant\Feature;

class FeatureServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Feature::define('checkout-v2', function (RolloutScope $scope): bool {
            if ($scope->isInternal) {
                return true;
            }

            $override = TenantFeatureOverride::query()
                ->where('tenant_id', $scope->tenantId)
                ->where('feature', 'checkout-v2')
                ->value('status');

            if ($override === 'on') {
                return true;
            }

            if ($override === 'off') {
                return false;
            }

            return crc32("checkout-v2:{$scope->tenantId}:{$scope->actorId}") % 100 < 5;
        });
    }
}
```

这里我故意把 override 放在 hash 前面：因为生产事故里最重要的是**先让人能一键止血**，不是追求“配置绝对优雅”。

## 三、Scope 不要偷懒只传 User

多租户后台里，同一个账号可能切不同租户；队列任务里甚至没有登录用户。如果你把 scope 简化成 `User`，接口命中开关，异步任务却命不中，最后就会出现“页面走了 v2，异步补单还在走 v1”的裂脑。

```php
<?php

namespace App\Http\Middleware;

use App\Support\Feature\RolloutScope;
use Closure;
use Illuminate\Http\Request;
use Laravel\Pennant\Feature;
use Symfony\Component\HttpFoundation\Response;

class ResolveRolloutScope
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $tenantId = (int) $request->attributes->get('tenant_id');

        app()->instance(
            RolloutScope::class,
            new RolloutScope(
                tenantId: $tenantId,
                actorId: (int) ($user?->id ?? 0),
                isInternal: str_ends_with((string) ($user?->email ?? ''), '@company.com'),
            )
        );

        /** @var Response $response */
        $response = $next($request);
        $enabled = Feature::for(app(RolloutScope::class))->active('checkout-v2');
        $response->headers->set('X-Feature-Checkout-V2', $enabled ? 'on' : 'off');

        return $response;
    }
}
```

Controller、Job、Listener 全部从容器里拿同一个 `RolloutScope`，这样请求链路和异步链路才能对齐。

## 四、业务代码里只保留一个开关出口

```php
<?php

namespace App\Http\Controllers;

use App\Services\Checkout\CheckoutV1Service;
use App\Services\Checkout\CheckoutV2Service;
use App\Support\Feature\RolloutScope;
use Laravel\Pennant\Feature;

class CheckoutController
{
    public function __construct(
        private CheckoutV1Service $v1,
        private CheckoutV2Service $v2,
    ) {}

    public function show()
    {
        $scope = app(RolloutScope::class);

        $payload = Feature::for($scope)->active('checkout-v2')
            ? $this->v2->buildPayload($scope->tenantId, $scope->actorId)
            : $this->v1->buildPayload($scope->tenantId, $scope->actorId);

        return response()->json($payload);
    }
}
```

我后来强制要求：**一个功能点只允许一个 `Feature::active()` 入口**。否则 View、Service、Listener 各查一次，排障时你根本不知道哪层把逻辑切走了。

## 五、override 表设计不要只存一个 enabled

我现在会单独建一张覆盖表，而不是把开关结果散落在租户配置 JSON 里。原因很简单：灰度回滚往往发生在事故期间，这时候你最需要的是**可查、可审计、可批量修改**。

```sql
create table tenant_feature_overrides (
    id bigint unsigned auto_increment primary key,
    tenant_id bigint unsigned not null,
    feature varchar(100) not null,
    status enum('on', 'off') not null,
    operator_id bigint unsigned not null,
    note varchar(255) null,
    created_at timestamp null,
    updated_at timestamp null,
    unique key uk_tenant_feature (tenant_id, feature)
);
```

这个表我会额外要求两件事：

1. `operator_id` 必填，事后能追是谁改的。
2. `note` 写明原因，比如“支付投诉临时关闭 checkout-v2”。

如果你的后台没有留痕，事故复盘时只会看到“有人改过”，却不知道为什么改、改给了谁。

## 六、日志观测要能回答“为什么这个人命中”

只知道开关开了没开，远远不够。我后来把分桶来源一起打到日志里：是内部账号命中、租户 override 命中，还是 hash 命中。这样客服拿着用户 ID 来问时，研发不用现场猜。

```php
logger()->info('feature.evaluated', [
    'feature' => 'checkout-v2',
    'tenant_id' => $scope->tenantId,
    'actor_id' => $scope->actorId,
    'enabled' => $enabled,
    'source' => $override ? 'override' : ($scope->isInternal ? 'internal' : 'hash'),
    'request_id' => request()->header('X-Request-Id'),
]);
```

如果后面接了 Grafana Loki / ELK，这条日志非常值钱：你可以按 `feature=checkout-v2 AND source=override` 直接把手工兜底的流量全筛出来。

## 七、我在线上踩过的 4 个坑

### 1. 用随机放量，结果用户体验抖动
不是“5% 请求”，而应该是“5% 用户”。稳定 hash 才能保证同一用户在整个灰度周期内结果一致。

### 2. override 查库没有缓存，后台峰值多打一层 SQL
最早 override 每次都查表，结算接口 P95 直接多了十几毫秒。后面把租户级 override 做成短 TTL 缓存，变更时主动失效。

### 3. Octane 下把结果放进静态变量
常驻 Worker 会串请求。某个内部测试账号命中 `true` 后，后续请求被错误复用，这是最阴的 bug。**在 Octane 场景里，别把特性结果存在静态属性里。**

### 4. 只切 API，不切队列消费者
一次回滚时，API 已经关闭 `checkout-v2`，但补偿任务还在消费旧消息并执行 v2 逻辑，最终订单备注和页面展示对不上。后来我把队列入口也统一接入 `RolloutScope`，并在日志里打印 `feature_snapshot`。

## 八、我最后定下来的上线顺序

1. 先让内部账号全开。
2. 再按租户白名单放量。
3. 然后用稳定 hash 从 1%、5%、20% 往上推。
4. 所有响应头和日志都带上 feature 状态。
5. 出现投诉时，优先改 override，而不是立刻发版。

Pennant 真正的价值，不是让代码里多一个布尔判断，而是把**灰度、回滚、排障**变成有纪律的工程动作。我的结论是：如果你的 Laravel 系统已经有多租户、队列、Octane 或者多实例部署，就不要再用配置文件硬切功能了；把 scope、分桶和 override 设计好，特性开关才能在生产环境里真正救命。

## 九、Pennant 完整配置与驱动选型

Pennant 默认把特性状态持久化到数据库，这在大部分场景下够用，但你仍然需要理解它的配置项和可选驱动。

### 9.1 安装与迁移

```bash
composer require laravel/pennant
php artisan pennant:install   # 生成 migration
php artisan migrate
```

迁移文件会创建 `feature_values` 表，存储每个 scope 的特性激活状态。如果你使用 Array 驱动（纯内存），则可以跳过迁移。

### 9.2 config/pennant.php 完整配置

```php
<?php

// config/pennant.php
return [
    // 默认存储驱动：database / array
    'default' => env('PENNANT_DRIVER', 'database'),

    'stores' => [
        'database' => [
            'driver' => 'database',
            'connection' => env('PENNANT_DB_CONNECTION', 'tenant'),  // 多租户场景建议独立连接
            'table'    => 'feature_values',
        ],
        'array' => [
            'driver' => 'array',
        ],
    ],

    // 推荐使用表名前缀避免与业务表冲突
    'prefix' => env('PENNANT_TABLE_PREFIX', 'pennant_'),

    // 是否在 boot 时预加载所有已知特性（大租户量场景建议 false）
    'eager_load' => env('PENNANT_EAGER_LOAD', false),
];
```

> **多租户注意**：`connection` 建议指向租户库而非系统库。如果每个租户有独立库，需要在中间件中动态切换。否则所有租户的开关状态会混在同一张表里。

### 9.3 驱动对比与选型

| 场景 | 推荐驱动 | 理由 |
|---|---|---|
| 常规 Web 应用 | `database` | 持久化，重启不丢失 |
| 单元测试 / CI | `array` | 零依赖，速度快 |
| 高并发 API（10 万+ QPS） | `database` + Redis 缓存层 | 纯 DB 会在峰值打爆连接池 |
| Serverless / Lambda | `database`（Aurora） | 冷启动时无法保持内存态 |

在我们的场景中，API 峰值约 8 000 QPS，override 短 TTL 缓存 + database 驱动组合即可撑住。如果你的系统更极端，可以考虑下面的缓存封装。

```php
<?php

namespace App\Support\Feature;

use Illuminate\Support\Facades\Cache;
use Laravel\Pennant\Feature;

class CachedFeatureResolver
{
    private const TTL = 60; // 秒，override 变更时主动失效

    public static function active(string $feature, mixed $scope): bool
    {
        $cacheKey = "feature:{$feature}:" . md5(serialize($scope));

        return Cache::remember($cacheKey, self::TTL, function () use ($feature, $scope) {
            return Feature::for($scope)->active($feature);
        });
    }

    public static function invalidate(string $feature, mixed $scope): void
    {
        $cacheKey = "feature:{$feature}:" . md5(serialize($scope));
        Cache::forget($cacheKey);
    }
}
```

## 十、多租户分桶的进阶实现

### 10.1 百分比渐进放量

生产环境最常见的需求是"本周放 5%，下周放 20%，再下周放 100%"。硬编码 `5` 会导致每次改数字都要发版。更好的做法是把百分比存进配置或数据库。

```php
<?php

namespace App\Providers;

use App\Models\FeatureRolloutConfig;
use App\Models\TenantFeatureOverride;
use App\Support\Feature\RolloutScope;
use Illuminate\Support\ServiceProvider;
use Laravel\Pennant\Feature;

class FeatureServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Feature::define('checkout-v2', function (RolloutScope $scope): bool {
            // ① 内部账号始终放行
            if ($scope->isInternal) {
                return true;
            }

            // ② 租户级手动 override（止血优先）
            $override = TenantFeatureOverride::query()
                ->where('tenant_id', $scope->tenantId)
                ->where('feature', 'checkout-v2')
                ->value('status');

            if ($override === 'on') {
                return true;
            }
            if ($override === 'off') {
                return false;
            }

            // ③ 从配置表读取当前百分比（运营可后台修改，无需发版）
            $rolloutPercent = FeatureRolloutConfig::query()
                ->where('feature', 'checkout-v2')
                ->value('percent') ?? 0;

            // ④ 稳定 hash 分桶
            return crc32("checkout-v2:{$scope->tenantId}:{$scope->actorId}") % 100 < $rolloutPercent;
        });
    }
}
```

对应的配置表：

```sql
CREATE TABLE feature_rollout_configs (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    feature     VARCHAR(100) NOT NULL UNIQUE,
    percent     TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0-100',
    note        VARCHAR(255) NULL,
    updated_at  TIMESTAMP NULL
);

INSERT INTO feature_rollout_configs (feature, percent, note)
VALUES ('checkout-v2', 5, '2026-05-03 首次灰度 5%');
```

### 10.2 按租户白名单批量放量

有时候你不是按百分比放量，而是"先让这 50 个租户全开"。这时候可以用批量写入 override 表：

```php
<?php

namespace App\Services\Feature;

use App\Models\TenantFeatureOverride;
use Illuminate\Support\Facades\DB;

class RolloutBatchService
{
    /**
     * 批量开启指定租户的特性
     */
    public function enableForTenants(string $feature, array $tenantIds, int $operatorId, string $note): void
    {
        DB::transaction(function () use ($feature, $tenantIds, $operatorId, $note) {
            foreach ($tenantIds as $tenantId) {
                TenantFeatureOverride::updateOrCreate(
                    ['tenant_id' => $tenantId, 'feature' => $feature],
                    [
                        'status'      => 'on',
                        'operator_id' => $operatorId,
                        'note'        => $note,
                    ]
                );
            }

            // 批量失效缓存
            foreach ($tenantIds as $tenantId) {
                cache()->forget("feature:{$feature}:tenant:{$tenantId}");
            }
        });
    }

    /**
     * 批量关闭（紧急回滚）
     */
    public function disableForTenants(string $feature, array $tenantIds, int $operatorId, string $note): void
    {
        DB::transaction(function () use ($feature, $tenantIds, $operatorId, $note) {
            TenantFeatureOverride::query()
                ->where('feature', $feature)
                ->whereIn('tenant_id', $tenantIds)
                ->update([
                    'status'      => 'off',
                    'operator_id' => $operatorId,
                    'note'        => $note,
                    'updated_at'  => now(),
                ]);
        });
    }

    /**
     * 全局紧急关闭（事故止血）
     */
    public function emergencyDisable(string $feature, int $operatorId): void
    {
        TenantFeatureOverride::query()
            ->where('feature', $feature)
            ->where('status', '!=', 'off')
            ->update([
                'status'      => 'off',
                'operator_id' => $operatorId,
                'note'        => '紧急关闭 - ' . now()->toDateTimeString(),
                'updated_at'  => now(),
            ]);

        // 同时把百分比配置表也归零
        \App\Models\FeatureRolloutConfig::query()
            ->where('feature', $feature)
            ->update(['percent' => 0, 'note' => '紧急关闭']);
    }
}
```

### 10.3 渐进式放量的自动策略

对于非紧急特性，可以写一个定时任务自动递增百分比：

```php
<?php

namespace App\Console\Commands;

use App\Models\FeatureRolloutConfig;
use Illuminate\Console\Command;

class FeatureRolloutAdvance extends Command
{
    protected $signature = 'feature:rollout-advance
                            {--feature= : 特性名称}
                            {--step=10 : 每次递增百分比}
                            {--max=100 : 最大百分比}';

    protected $description = '渐进式递增特性放量百分比';

    public function handle(): int
    {
        $feature = $this->option('feature');
        $step    = (int) $this->option('step');
        $max     = (int) $this->option('max');

        $config = FeatureRolloutConfig::firstOrCreate(
            ['feature' => $feature],
            ['percent' => 0, 'note' => '自动创建']
        );

        $newPercent = min($config->percent + $step, $max);
        $config->update([
            'percent' => $newPercent,
            'note'    => "自动放量 {$config->percent}% -> {$newPercent}% @ " . now()->toDateTimeString(),
        ]);

        $this->info("Feature [{$feature}] rollout: {$config->percent}% -> {$newPercent}%");

        return self::SUCCESS;
    }
}
```

配合 Laravel Scheduler 每天递增 10%：

```php
// app/Console/Kernel.php
$schedule->command('feature:rollout-advance --feature=checkout-v2 --step=10 --max=100')
    ->dailyAt('03:00')
    ->when(fn () => config('features.auto_rollout_enabled', false));
```

## 十一、回滚兜底的完整方案

### 11.1 三级回滚策略

在生产环境中，回滚不是简单的"关开关"。你需要一个分层的回滚体系：

```text
Level 1: 租户级回滚
    └── 仅关闭特定租户的特性，其他租户不受影响
    └── 操作：修改 tenant_feature_overrides 表

Level 2: 全量回滚
    └── 关闭所有租户的特性，百分比归零
    └── 操作：emergencyDisable() 一键执行

Level 3: 代码级回滚
    └── 特性代码本身有 bug，需要回滚部署
    └── 操作：Git revert + CI/CD 重新部署
```

### 11.2 在 Controller 层做防御性编码

即使开关出错，业务代码也不能崩溃。推荐用 try-catch 包裹特性分支：

```php
<?php

namespace App\Http\Controllers;

use App\Services\Checkout\CheckoutV1Service;
use App\Services\Checkout\CheckoutV2Service;
use App\Support\Feature\RolloutScope;
use Illuminate\Support\Facades\Log;
use Laravel\Pennant\Feature;

class CheckoutController
{
    public function __construct(
        private CheckoutV1Service $v1,
        private CheckoutV2Service $v2,
    ) {}

    public function show()
    {
        $scope = app(RolloutScope::class);

        try {
            $useV2 = Feature::for($scope)->active('checkout-v2');
        } catch (\Throwable $e) {
            // Pennant 驱动异常时降级到 v1
            Log::warning('feature.eval_failed', [
                'feature' => 'checkout-v2',
                'error'   => $e->getMessage(),
            ]);
            $useV2 = false;
        }

        try {
            $payload = $useV2
                ? $this->v2->buildPayload($scope->tenantId, $scope->actorId)
                : $this->v1->buildPayload($scope->tenantId, $scope->actorId);
        } catch (\Throwable $e) {
            // v2 代码有 bug 时降级到 v1
            if ($useV2) {
                Log::error('feature.v2_fallback_to_v1', [
                    'tenant_id' => $scope->tenantId,
                    'error'     => $e->getMessage(),
                ]);
                $payload = $this->v1->buildPayload($scope->tenantId, $scope->actorId);
            } else {
                throw $e;
            }
        }

        return response()->json($payload);
    }
}
```

### 11.3 队列任务中的特性快照

队列任务的执行时间可能滞后于入队时间。如果任务入队时开关是开的，执行时已经被关闭了，就会出现不一致。解决方案是在入队时快照特性状态：

```php
<?php

namespace App\Jobs;

use App\Support\Feature\RolloutScope;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Laravel\Pennant\Feature;

class ProcessCheckout implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public readonly int $tenantId,
        public readonly int $actorId,
        public readonly bool $featureSnapshot,  // 入队时快照
    ) {}

    public function handle(): void
    {
        if ($this->featureSnapshot) {
            // 执行 v2 逻辑
        } else {
            // 执行 v1 逻辑
        }
    }
}

// 入队时：
$scope = app(RolloutScope::class);
ProcessCheckout::dispatch(
    tenantId: $scope->tenantId,
    actorId: $scope->actorId,
    featureSnapshot: Feature::for($scope)->active('checkout-v2'),
);
```

## 十二、特性开关方案横向对比

在选择特性开关方案时，了解各方案的优劣势很重要。以下是我调研和使用过的几种方案的对比：

| 维度 | Laravel Pennant | LaunchDarkly | Unleash | 自研（DB + if/else） |
|---|---|---|---|---|
| **部署方式** | Composer 包，嵌入 Laravel | SaaS，SDK 接入 | Self-hosted / SaaS | 自行开发 |
| **学习成本** | 低，Laravel 原生风格 | 中，概念多（Flag、Rule、Segment） | 中，需部署服务 | 最低，但功能有限 |
| **多语言支持** | 仅 PHP / Laravel | 全语言 SDK（Go/Java/Node/Python...） | 全语言 SDK | 仅当前语言 |
| **多租户分桶** | 通过 Scope 自定义 | 内置 Segment + Targeting Rule | 内置 Strategy + Variant | 需自行实现 |
| **实时变更** | 下次请求生效（DB 驱动） | SDK Streaming（秒级推送） | SDK Polling（默认 15s） | 取决于实现 |
| **审计日志** | 需自行实现 | 内置完整审计 | 内置审计 | 需自行实现 |
| **费用** | 免费开源 | 按 MAU 收费（$ 起步） | 开源免费 / 企业版收费 | 免费（人力成本） |
| **适用规模** | 中小团队 / 单体 Laravel | 大型团队 / 多语言微服务 | 中大型团队 / 需自托管 | 原型 / MVP 阶段 |
| **灰度放量** | 需自行编码实现 | 控制台拖滑块即可 | 控制台配置 Strategy | 需自行编码 |
| **A/B 测试** | 不支持（纯布尔） | 内置多变量测试 | 内置 Variant | 不支持 |

### 选型建议

- **已有 Laravel 技术栈、团队 < 20 人**：Pennant 足够。它和 Laravel 的 Service Container、Middleware、Queue 天然集成，不需要额外部署组件。
- **多语言微服务架构**：LaunchDarkly 或 Unleash。Pennant 只能管 PHP 侧，Go/Java/Node 服务需要各自的 SDK。
- **数据合规要求高（不能用 SaaS）**：Unleash Self-hosted 或 Pennant。LaunchDarkly 是 SaaS，特征数据存储在境外。
- **预算有限、功能简单**：Pennant 或自研。自研方案在 MVP 阶段最快，但要提前规划好 override 和审计。

## 十三、踩坑案例详解

### 案例 1：Octane 静态变量串请求

这是最隐蔽的 bug。Octane 的 Worker 是常驻进程，静态变量在请求间共享：

```php
<?php

// ❌ 错误：Octane 下会串请求
class FeatureCache
{
    private static array $cache = [];

    public static function isActive(string $feature, mixed $scope): bool
    {
        $key = $feature . ':' . serialize($scope);

        if (!isset(self::$cache[$key])) {
            self::$cache[$key] = Feature::for($scope)->active($feature);
        }

        return self::$cache[$key];
    }
}

// ✅ 正确：使用 Laravel 的 Request 生命周期感知缓存
class FeatureCache
{
    public static function isActive(string $feature, mixed $scope): bool
    {
        // 使用 Container 的 scoped 绑定，每个请求独立
        $cacheKey = "feature_cache:{$feature}:" . md5(serialize($scope));

        return app()->scoped($cacheKey, function () use ($feature, $scope) {
            return Feature::for($scope)->active($feature);
        });
    }
}
```

> **Octane 黄金法则**：任何在请求间可变的状态（静态属性、单例中的可变属性、全局变量）都可能是 bug。特性开关的结果必须在每个请求中重新解析。

### 案例 2：Redis 集群下的缓存失效风暴

当你同时给 500 个租户开特性时，如果每个租户都单独 `Cache::forget()`，会触发 500 次 Redis 命令。在 Redis 集群场景下，这些命令分散到不同节点，可能导致短时间的连接风暴。

```php
<?php

// ❌ 逐条失效
foreach ($tenantIds as $tenantId) {
    Cache::forget("feature:checkout-v2:tenant:{$tenantId}");
}

// ✅ 使用 Pipeline 批量失效（需要 predis 驱动）
use Illuminate\Support\Facades\Redis;

$keys = array_map(
    fn($id) => "feature:checkout-v2:tenant:{$id}",
    $tenantIds
);

Redis::pipeline(function ($pipe) use ($keys) {
    foreach ($keys as $key) {
        $pipe->del($key);
    }
});
```

### 案例 3：Feature::purge() 的误用

Pennant 提供了 `Feature::purge()` 来清除存储中的特性记录。但在生产环境中，直接 purge 会导致所有用户在下次请求时重新计算分桶，可能产生与之前不同的结果：

```php
<?php

// ❌ 危险：purge 后重新分桶，用户可能从"命中"变成"未命中"
Feature::purge('checkout-v2');

// ✅ 安全：只 purge 你需要清理的 scope
Feature::for($scope)->purge('checkout-v2');

// ✅ 更安全：在维护窗口内执行，并提前通知
Artisan::command('feature:safe-purge {feature} {--scope=}', function (string $feature) {
    $this->warn("About to purge feature [{$feature}]. This will cause re-bucketing.");

    if (!$this->confirm('Continue?')) {
        return;
    }

    if ($scope = $this->option('scope')) {
        Feature::for($scope)->purge($feature);
    } else {
        Feature::purge($feature);
    }

    $this->info('Done.');
});
```

### 案例 4：测试环境的特性状态泄漏

单元测试中如果启用了 `database` 驱动，测试间的特性状态会互相污染：

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Laravel\Pennant\Feature;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // 每个测试用 array 驱动，避免数据库污染
        Feature::flushCache();
        config()->set('pennant.default', 'array');
    }
}
```

## 十四、观测体系与告警集成

特性开关不只是代码里的 if/else，它还需要配套的观测体系。

### 14.1 结构化日志规范

```php
<?php

namespace App\Support\Feature;

use Illuminate\Support\Facades\Log;

class FeatureLogger
{
    public static function log(
        string $feature,
        RolloutScope $scope,
        bool $enabled,
        string $source,    // 'override' | 'internal' | 'hash' | 'default'
        ?float $durationMs = null,
    ): void {
        Log::info('feature.evaluated', [
            'feature'     => $feature,
            'tenant_id'   => $scope->tenantId,
            'actor_id'    => $scope->actorId,
            'enabled'     => $enabled,
            'source'      => $source,
            'duration_ms' => $durationMs,
            'request_id'  => request()->header('X-Request-Id'),
            'user_agent'  => request()->userAgent(),
        ]);
    }
}
```

### 14.2 Prometheus 指标导出

如果你用 Prometheus 做监控，可以导出特性开关的计数器：

```php
<?php

namespace App\Support\Feature;

use Prometheus\CollectorRegistry;

class FeatureMetrics
{
    public static function record(string $feature, bool $enabled, string $source): void
    {
        $registry = app(CollectorRegistry::class);

        $counter = $registry->getOrRegisterCounter(
            'app',
            'feature_evaluation_total',
            'Feature flag evaluation count',
            ['feature', 'enabled', 'source']
        );

        $counter->inc([
            $feature,
            $enabled ? 'true' : 'false',
            $source,
        ]);
    }
}
```

配合 Grafana 仪表盘，你可以实时看到每个特性的命中率、来源分布和异常波动。当 override 来源的占比突然飙升时，说明有人在手动干预——这正是你需要关注的信号。

## 十五、完整上线 Checklist

在每个特性开关上线前，用这份 Checklist 逐项确认：

```text
□ 1. Feature::define() 中是否包含 override 兜底？
□ 2. Scope 是否同时覆盖 API 和 Queue 场景？
□ 3. 分桶算法是否使用稳定 hash（禁止 mt_rand）？
□ 4. override 表是否有 operator_id 和 note 字段？
□ 5. 响应头是否携带 X-Feature-* 标记？
□ 6. 结构化日志是否记录 source（override/internal/hash）？
□ 7. Octane 场景下是否有静态变量泄漏风险？
□ 8. 测试环境是否使用 array 驱动？
□ 9. 缓存失效策略是否考虑了批量操作？
□ 10. 是否有三级回滚方案（租户级/全量/代码级）？
□ 11. 队列任务是否使用 featureSnapshot 而非运行时查询？
□ 12. 是否配置了 Grafana / Prometheus 监控面板？
```

## 相关阅读

- [Laravel Pennant 2.x 进阶实战：自定义 Driver、Feature 分组与租户级灰度策略——多租户 SaaS 的功能开关治理](/05_PHP/Laravel/2026-06-05-laravel-pennant-2x-custom-driver-feature-groups-tenant-grayscale/)
- [Laravel Pennant 实战：功能开关与灰度发布策略——从源码剖析到 B2C 生产落地](/php/Laravel/2026-06-01-laravel-pennant-feature-flags-gradual-release-strategy/)
- [Feature Flag Driven Development 实战：Unleash/LaunchDarkly/Flagsmith 选型——渐进式发布、A/B 测试与技术债务控制](/categories/CICD/Feature-Flag-Driven-Development-实战-Unleash-LaunchDarkly-Flagsmith-选型-渐进式发布-AB测试与技术债务控制/)
- [Progressive Delivery 实战：Feature Flag + 渐进式发布——Unleash + Argo Rollouts 的完整工程化工作流](/categories/CICD/Progressive-Delivery-实战-Feature-Flag-渐进式发布-Unleash-Argo-Rollouts完整工程化工作流/)
- [金丝雀发布实战：渐进式流量放量——Nginx/Envoy 权重路由与 Laravel 版本共存](/categories/CICD/Canary-Deployment-渐进式流量放量-Nginx-Envoy权重路由与Laravel版本共存/)
- [Laravel Octane + Swoole 高性能 PHP 应用架构实战踩坑记录](/php/Laravel/laravel-octane-swoole-high-performancephparchitecture/)
- [Laravel Redis Queue + Horizon 实战：队列监控、失败重试与性能调优](/php/Laravel/laravel-redis-queue-horizon-guide-monitoring/)
- [Prometheus + Grafana 监控体系实战：Laravel API 的 RED 指标、告警降噪与 SLO 看板落地踩坑记录](/php/Laravel/prometheus-grafana-monitoringguide-laravel-api-red-slo/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/categories/架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
- [分布式缓存一致性实战：Cache-Aside/Write-Through/Write-Behind 在 Laravel 中的工程化落地](/categories/架构/分布式缓存一致性实战-Cache-Aside-Write-Through-Write-Behind在Laravel中的工程化落地/)
- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)
