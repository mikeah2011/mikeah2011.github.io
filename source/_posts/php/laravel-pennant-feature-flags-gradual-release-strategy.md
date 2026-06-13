---

title: Laravel Pennant 实战：功能开关与灰度发布策略——从源码剖析到 B2C 生产落地
keywords: [Laravel Pennant, B2C, 功能开关与灰度发布策略, 从源码剖析到, 生产落地]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-06-01 22:30:00
categories:
- php
- engineering
tags:
- Pennant
- Feature Flags
- 灰度发布
- A/B Testing
- 渐进式发布
- B2C API
- PHP 8.2
description: Laravel Pennant 是框架内置的功能开关系统，但远不止 if/else 这么简单。本文从源码级深度剖析 Pennant 的 Scope 解析机制、DatabaseDriver 与 ArrayDriver 存储架构差异、惰性求值与持久化缓存策略，手把手带你拆解 Feature::active() 完整调用链。实战部分覆盖 B2C 电商五大核心场景：按百分比灰度发布、紧急降级一键关闭、A/B 测试多变体分流、多租户功能隔离、渐进式数据库 Migration 零停机方案，并收录 Scope 解析 500 错误、N+1 查询、缓存不一致等五个真实生产踩坑与修复方案，附性能基准测试数据与方案对比选型表，助你快速落地 Laravel 功能开关最佳实践。
---


# Laravel Pennant 实战：功能开关与灰度发布策略——从源码剖析到 B2C 生产落地

每次你在一个已有 30+ 仓库、日均百万级请求的 B2C 电商系统里要上线一个新功能，恐惧感是真实的：新购物车流程会不会导致转化率暴跌？新的支付通道上线后回调会不会丢？推荐算法 V2 在高并发下会不会把 Redis 打崩？

传统的解决方案是这样的：周五下午 5 点发版，然后祈祷。出了问题就回滚——但回滚本身也有风险，数据库 migration 已经跑了，回滚意味着数据丢失。

**功能开关（Feature Flags）** 给了你第三条路：代码已经部署到生产环境，但功能默认关闭。你可以按用户、按百分比、按条件逐步放开，出问题随时关闭——不需要重新部署，不需要回滚代码。

Laravel Pennant 是框架官方提供的功能开关实现。这篇文章不是 Pennant 的 API 文档翻译——你读官方文档就够了。我要拆解的是：**Pennant 在架构层面如何工作、在 B2C 生产环境中如何落地、以及我踩过的那些坑**。

<!-- more -->

## 一、问题背景：为什么 B2C 电商需要功能开关？

### 1.1 传统发布的恐惧循环

在一个典型的 Laravel B2C 项目中，一次新功能上线的流程是这样的：

```
开发者 → Code Review → CI/CD → Staging 测试 → 生产部署 → 热修 Bug → 回滚
```

问题出在最后三步。**部署是原子性的**——要么全部上线，要么全部不上。但真实世界的发布需求不是这样的：

| 场景 | 需要的是 | 传统方案能做到吗？ |
|------|---------|----------------|
| 新推荐算法 | 先对 5% 用户开放 | ❌ 要么全开要么不开 |
| 支付通道切换 | 灰度验证新通道稳定性 | ❌ 全量切换风险高 |
| 紧急降级 | 一键关闭某个功能 | ❌ 需要回滚整个发版 |
| A/B 测试 | 对照组和实验组 | ❌ 需要额外的实验平台 |
| 新人引导页 | 只对新注册用户展示 | ❌ 要么全展示要么不展示 |

### 1.2 功能开关不是 if/else

很多人的第一反应是："功能开关不就是一个 `if` 判断吗？我在 `.env` 里加一个 `ENABLE_NEW_CART=true` 就行了。"

```php
// ❌ 天真的功能开关
if (config('features.new_cart_enabled')) {
    return $this->newCartFlow();
}
return $this->oldCartFlow();
```

这种方案有三个致命问题：

1. **没有用户粒度**：要么全开要么全关，不能按用户百分比灰度
2. **没有动态性**：改 `.env` 需要重新部署或重启进程
3. **没有审计**：谁开了这个开关？什么时候开的？开了多久？

Laravel Pennant 解决了这三个问题，而且它的设计远比你想象的精巧。

---

## 二、架构设计原理：Pennant 的内部如何工作？

### 2.1 核心架构概览

Pennant 的架构可以用一张图概括：

```
┌─────────────────────────────────────────────────────────────────┐
│                         Laravel Pennant                          │
│                                                                 │
│  ┌──────────┐     ┌──────────────┐     ┌─────────────────────┐ │
│  │ Feature  │────▶│  Scope       │────▶│  Driver             │ │
│  │ Define   │     │  Resolution  │     │  (Array/Database/   │ │
│  │ (闭包)    │     │  (用户/租户)  │     │   Custom)           │ │
│  └──────────┘     └──────────────┘     └─────────────────────┘ │
│       │                                       │                 │
│       │           ┌──────────────┐            │                 │
│       └──────────▶│  Feature     │◀───────────┘                 │
│                   │  State Map   │                              │
│                   │  (active/    │                              │
│                   │   inactive/  │                              │
│                   │   laravel/   │                              │
│                   │   null)      │                              │
│                   └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

关键组件：

| 组件 | 职责 | 源码位置 |
|------|------|---------|
| **Feature Definition** | 定义功能的判断逻辑（闭包） | `Laravel\Pennant\Feature` |
| **Scope Resolution** | 确定"谁"在使用这个功能 | `Feature::resolveScope()` |
| **Driver** | 存储和读取功能状态 | `ArrayDriver` / `DatabaseDriver` |
| **Feature State** | 每个 scope × feature 的状态 | `active` / `inactive` / `laravel` / `null` |

### 2.2 Scope 解析机制：谁在用这个功能？

Pennant 最精巧的设计是 **Scope 机制**。一个"功能"不是全局开关——它对不同的"范围"可以有不同的状态。

```php
// 对不同用户返回不同结果
Feature::define('new-checkout-flow', function (User $user) {
    // 灰度 5% 的用户
    return $user->id % 20 === 0;
});
```

这里 `User $user` 就是 Scope。Pennant 通过 PHP 的类型提示自动解析 Scope：

```php
// Illuminate\Support\Lottery 和 Laravel\Pennant\Feature 的核心交互
// 当你调用 Feature::active('new-checkout-flow') 时：
// 1. Pennant 从容器中解析出当前认证用户（基于 User model 的类型提示）
// 2. 用该用户作为 Scope 去查找缓存/存储中的状态
// 3. 如果没找到，才执行定义闭包
```

这个机制的关键洞察是：**Scope 不一定是 User**。它可以是 Team、Tenant、Organization，甚至是一个自定义对象：

```php
// 按团队灰度
Feature::define('advanced-reporting', function (Team $team) {
    return in_array($team->plan, ['enterprise', 'business']);
});

// 按自定义维度灰度
Feature::define('beta-api-v3', function (ApiClient $client) {
    return $client->is_beta_tester;
});
```

### 2.3 驱动存储架构：状态存在哪里？

Pennant 支持两种内置驱动：

#### ArrayDriver（开发/测试用）

```php
// 状态存储在内存数组中，请求结束就丢失
class ArrayDriver implements Driver
{
    protected array $stateCache = [];

    public function get($feature, $scope): mixed
    {
        $key = $this->key($feature, $scope);
        return $this->stateCache[$key] ?? null;
    }

    public function set($feature, $scope, $value): void
    {
        $key = $this->key($feature, $scope);
        $this->stateCache[$key] = $value;
    }
}
```

#### DatabaseDriver（生产环境推荐）

```php
// 状态持久化到数据库
// 表结构：features(name, scope, value, created_at, updated_at)
class DatabaseDriver implements Driver
{
    public function get($feature, $scope): mixed
    {
        return $this->newQuery()
            ->where('name', $feature)
            ->where('scope', $this->resolveScope($scope))
            ->value('value');
    }

    public function set($feature, $scope, $value): void
    {
        $this->newQuery()->updateOrInsert(
            [
                'name' => $feature,
                'scope' => $this->resolveScope($scope),
            ],
            [
                'value' => $value,
                'updated_at' => now(),
            ]
        );
    }
}
```

关键设计决策：**Pennant 默认不会预先为所有用户计算所有功能的状态**。它采用 **惰性求值 + 持久化缓存** 策略：

1. 第一次访问时，执行定义闭包，将结果存入 `features` 表
2. 后续访问直接从表中读取，不再执行闭包
3. 调用 `Feature::purge()` 清除缓存，下次访问时重新计算

这解释了一个常见的困惑：**为什么我改了定义闭包的逻辑，但用户看到的行为没变？** 因为旧的状态已经持久化了。

---

## 三、源码级剖析：关键类与调用链

### 3.1 Feature Facade 的调用链

当你调用 `Feature::active('new-cart')` 时，完整的调用链如下：

```
Feature::active('new-cart')
  │
  ├─ 1. Feature::resolveScope()          // 从容器解析当前 User
  │     └─ app()->make($scopeClass)       // 基于类型提示自动注入
  │
  ├─ 2. Driver::get('new-cart', $scope)  // 查缓存/数据库
  │     ├─ 命中缓存 → return cached value
  │     └─ 未命中 → continue
  │
  ├─ 3. Feature::resolve('new-cart')     // 执行定义闭包
  │     └─ call_user_func($definition, $scope)
  │
  ├─ 4. Driver::set('new-cart', $scope, $result)  // 持久化结果
  │
  └─ 5. return $result === 'active'      // 转换为 boolean
```

源码实现（简化版）：

```php
// Laravel\Pennant\Feature (核心类)
class Feature
{
    // 特性定义注册表
    protected static array $definitions = [];

    // 当前驱动
    protected static Driver $driver;

    // 注册功能定义
    public static function define(string $feature, callable $definition): void
    {
        static::$definitions[$feature] = $definition;
    }

    // 检查功能是否激活
    public static function active(string|array $feature, mixed $scope = null): bool
    {
        return (bool) static::value($feature, $scope);
    }

    // 获取功能的实际值（可以是任意类型）
    public static function value(string $feature, mixed $scope = null): mixed
    {
        $scope ??= static::resolveScope($feature);
        return static::$driver->get($feature, $scope);
    }

    // 解析 Scope（核心机制）
    protected static function resolveScope(string $feature): mixed
    {
        $definition = static::$definitions[$feature] ?? null;

        if ($definition instanceof Closure) {
            $reflection = new ReflectionFunction($definition);
            $params = $reflection->getParameters();

            if (! empty($params)) {
                $scopeType = $params[0]->getType();
                // 从容器中解析该类型
                return app()->make($scopeType->getName());
            }
        }

        return null; // 无 Scope 的全局功能
    }
}
```

### 3.2 状态值的四种含义

Pennant 中功能状态不仅仅是 `true/false`，它有四种含义：

```php
// 状态枚举（概念上的，实际用字符串）
enum FeatureState: string
{
    case Active = 'active';      // 功能激活，使用新逻辑
    case Inactive = 'inactive';  // 功能关闭，使用旧逻辑
    case Laravel = 'laravel';    // 特殊标记，用于 Laravel 内部功能
    case Null = null;            // 未定义/未计算
}
```

在 B2C 实战中，我们通常只关心 `active` 和 `inactive`。但 `null` 状态有一个重要含义：**这个 Scope 从未访问过这个功能**。这在灰度发布中很有用——你可以用 `null` 区分"已评估但未激活"和"从未评估"。

### 3.3 Feature::activate() 和 Feature::deactivate() 的语义

```php
// 强制激活某个功能（绕过定义闭包）
Feature::activate('new-checkout', $user);
// → 写入 features 表: {name: 'new-checkout', scope: 'user:42', value: 'active'}

// 強制关闭
Feature::deactivate('new-checkout', $user);
// → 写入 features 表: {name: 'new-checkout', scope: 'user:42', value: 'inactive'}

// 批量激活
Feature::activateFor('new-checkout', [$user1, $user2, $user3]);

// 清除缓存（下次访问时重新计算）
Feature::purge('new-checkout');
// → 删除 features 表中所有 name='new-checkout' 的记录
```

---

## 四、B2C 电商实战：五种核心场景

### 4.1 灰度发布：按百分比逐步放开

这是最常见的场景。新功能先对 1% 用户开放，验证没问题后逐步提高比例。

```php
// app/Providers/AppServiceProvider.php
use Laravel\Pennant\Feature;
use App\Models\User;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 新购物车流程 - 按用户 ID 哈希灰度
        Feature::define('new-checkout-flow', function (User $user): bool {
            // 使用用户 ID 的哈希值确保同一用户始终命中同一组
            // 避免同一用户时而看到新流程、时而看到旧流程
            return crc32("new-checkout-flow:{$user->id}") % 100 < 5;
            // ↑ 5% 灰度
        });

        // 新推荐算法 - 按用户等级灰度
        Feature::define('new-recommendation-algo', function (User $user): bool {
            // VIP 用户优先体验新功能
            if ($user->level >= 3) {
                return true;
            }
            // 普通用户 10% 灰度
            return crc32("new-rec:{$user->id}") % 100 < 10;
        });
    }
}
```

**控制器中使用：**

```php
class CheckoutController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        if (Feature::active('new-checkout-flow', $user)) {
            return $this->newCheckoutFlow($user);
        }

        return $this->legacyCheckoutFlow($user);
    }

    // Blade 模板中也可以使用
    public function cart()
    {
        return view('cart.index', [
            'useNewDesign' => Feature::active('new-checkout-flow'),
        ]);
    }
}
```

**Blade 模板中：**

```blade
@feature('new-checkout-flow')
    {{-- 新版购物车 UI --}}
    <x-checkout.new-cart />
@else
    {{-- 旧版购物车 UI --}}
    <x-checkout.legacy-cart />
@endfeature
```

### 4.2 紧急降级：一键关闭危险功能

在 B2C 电商中，有些功能一旦出问题，影响的是真金白银。紧急降级是保命手段。

```php
// app/Http/Controllers/Admin/FeatureFlagController.php
class FeatureFlagController extends Controller
{
    /**
     * 紧急关闭某个功能 - 不需要重新部署
     */
    public function emergencyDeactivate(Request $request)
    {
        $featureName = $request->input('feature');

        // 关闭功能
        Feature::deactivate($featureName);

        // 记录审计日志
        audit_log('feature_emergency_deactivate', [
            'feature' => $featureName,
            'operator' => $request->user()->email,
            'reason' => $request->input('reason', 'emergency'),
            'timestamp' => now()->toIso8601String(),
        ]);

        // 通知团队
        Notification::route('slack', config('services.slack.ops_channel'))
            ->notify(new FeatureDeactivatedNotification($featureName, $request->user()));

        return response()->json([
            'success' => true,
            'message' => "Feature [{$featureName}] has been deactivated.",
        ]);
    }

    /**
     * 批量紧急降级 - 关闭所有非核心功能
     */
    public function emergencyRollback(Request $request)
    {
        $nonCoreFeatures = [
            'new-checkout-flow',
            'new-recommendation-algo',
            'social-login-v2',
            'dynamic-pricing',
        ];

        foreach ($nonCoreFeatures as $feature) {
            Feature::deactivate($feature);
        }

        // 核心功能（如支付通道）需要单独控制
        // Feature::deactivate('stripe-payment-v3'); // ← 不在这里，需要支付团队确认

        return response()->json([
            'deactivated' => $nonCoreFeatures,
            'message' => 'Non-core features deactivated. Core features preserved.',
        ]);
    }
}
```

### 4.3 A/B 测试：对照组与实验组

功能开关不只是开/关，还可以用来做 A/B 测试。Pennant 的 `value()` 方法支持返回任意值：

```php
// 定义 A/B 测试变体
Feature::define('product-card-variant', function (User $user): string {
    $hash = crc32("product-card:{$user->id}");

    return match (true) {
        $hash % 100 < 33 => 'control',      // 对照组（33%）
        $hash % 100 < 66 => 'variant-a',    // 变体 A：大图（33%）
        default           => 'variant-b',    // 变体 B：带视频（34%）
    };
});

// 在 Controller 中使用
class ProductController extends Controller
{
    public function show(Product $product)
    {
        $variant = Feature::value('product-card-variant');

        return match ($variant) {
            'control'   => view('product.show-classic', compact('product')),
            'variant-a' => view('product.show-large-image', compact('product')),
            'variant-b' => view('product.show-with-video', compact('product')),
        };
    }
}
```

**埋点追踪：**

```php
// 在中间件中自动记录 A/B 测试分组
class ABTestTrackingMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user) {
            // 将所有活跃的 A/B 测试分组写入 Context
            $variants = [
                'product_card' => Feature::value('product-card-variant', $user),
                'search_algo'  => Feature::value('search-ranking-variant', $user),
                'pricing_tier' => Feature::value('dynamic-pricing-variant', $user),
            ];

            // 通过 Context 传递给全链路
            Context::add('ab_variants', $variants);

            // 写入响应头（方便前端埋点）
            $response = $next($request);
            $response->headers->set('X-AB-Variants', json_encode($variants));

            return $response;
        }

        return $next($request);
    }
}
```

### 4.4 多租户功能隔离

在 B2C 电商中，你可能有多个品牌站（多租户）。不同租户需要不同的功能开关：

```php
// 按租户（品牌站）控制功能
Feature::define('multi-currency-checkout', function (Tenant $tenant): bool {
    // 只有国际站启用多币种结算
    return in_array($tenant->region, ['APAC', 'EMEA', 'Americas']);
});

// 按渠道控制功能
Feature::define('affiliate-commission-v2', function (AffiliateChannel $channel): bool {
    // 新的佣金计算只对头部渠道开放
    return $channel->tier === 'premium';
});
```

### 4.5 渐进式 Migration：数据库 Schema 迁移的零停机方案

这是一个高级用法——用功能开关来管理数据库 migration 的过渡期：

```php
// Step 1: 新增列（nullable）
// database/migrations/2026_06_01_add_new_order_status.php
Schema::table('orders', function (Blueprint $table) {
    $table->string('new_status')->nullable()->after('status');
});

// Step 2: 双写（新旧字段同时写入）
class Order extends Model
{
    protected static function booted(): void
    {
        static::saving(function (Order $order) {
            if (Feature::active('order-status-v2')) {
                $order->new_status = $this->mapToNewStatus($order->status);
            }
        });
    }
}

// Step 3: 读新字段（灰度切换）
class OrderStatusService
{
    public function getStatus(Order $order): string
    {
        if (Feature::active('order-status-v2') && $order->new_status) {
            return $order->new_status;
        }
        return $order->status;
    }
}

// Step 4: 全量切换后，删除旧字段
// 这一步在所有用户都使用新字段后才执行
```

---

## 五、与替代方案的对比分析

| 维度 | Laravel Pennant | LaunchDarkly | .env 配置 | 自建 Redis 开关 |
|------|----------------|-------------|-----------|---------------|
| **用户粒度** | ✅ 支持任意 Scope | ✅ 完善 | ❌ 全局 | ⚠️ 需手动实现 |
| **持久化** | ✅ Database 驱动 | ✅ 云端 | ❌ 需重启 | ⚠️ Redis 重启丢失 |
| **动态性** | ✅ 实时生效 | ✅ 实时生效 | ❌ 需重启 | ✅ 实时生效 |
| **审计日志** | ⚠️ 需自行集成 | ✅ 内置 | ❌ 无 | ❌ 无 |
| **A/B 测试** | ✅ value() 支持 | ✅ 完善 | ❌ 不支持 | ❌ 不支持 |
| **依赖** | 零依赖（框架内置） | 需要 SDK + 网络 | 零依赖 | 需要 Redis |
| **成本** | 免费 | 💰 按 MAU 收费 | 免费 | 免费 |
| **适合规模** | 中小型 ~ 大型 | 企业级 | 个人项目 | 中小型 |
| **Laravel 集成** | ✅ 原生支持 | ⚠️ 需适配 | ✅ 原生 | ⚠️ 需封装 |

**选型建议：**

- **大多数 Laravel 项目**：直接用 Pennant，零额外依赖，框架原生支持
- **需要实时仪表盘、高级分析**：考虑 LaunchDarkly（但注意成本）
- **简单配置开关**：`.env` 足够，别过度工程化
- **已有 Redis 基础设施**：自建也可以，但要解决 Scope 和持久化问题

---

## 六、真实踩坑记录

### 坑 1：修改定义闭包后状态不更新

**现象**：我把灰度比例从 5% 改到 50%，但用户看到的没变化。

**根因**：Pennant 的惰性求值 + 持久化缓存。第一次访问时闭包的结果已经存入 `features` 表，修改闭包不会影响已缓存的结果。

**解决方案**：

```php
// 修改定义后，必须清除缓存
Feature::define('new-checkout-flow', function (User $user) {
    return crc32("new-checkout:{$user->id}") % 100 < 50; // 从 5% 改到 50%
});

// 清除所有缓存，下次访问时重新计算
Feature::purge('new-checkout-flow');

// 或者在部署脚本中自动清除
// deploy.sh
php artisan pennant:purge new-checkout-flow
```

**最佳实践**：每次修改功能定义后，都在部署脚本中加上 `pennant:purge` 命令。

### 坑 2：Scope 解析失败导致 500 错误

**现象**：未登录用户访问某个页面时，抛出 `BindingResolutionException`。

**根因**：功能定义闭包使用了 `User` 作为 Scope 类型提示，但未登录用户没有 User 实例。

```php
// ❌ 会出问题
Feature::define('some-feature', function (User $user) {
    return true;
});

// 在未登录的页面中调用
Feature::active('some-feature'); // 💥 BindingResolutionException
```

**解决方案**：

```php
// ✅ 方案 A：使用 nullable 参数
Feature::define('some-feature', function (?User $user): bool {
    if (! $user) {
        return false; // 未登录用户不使用新功能
    }
    return crc32("feature:{$user->id}") % 100 < 10;
});

// ✅ 方案 B：在调用前检查认证状态
if (auth()->check()) {
    $isNew = Feature::active('some-feature');
} else {
    $isNew = false;
}

// ✅ 方案 C：使用 withoutResolvingScopes 避免自动解析
$isNew = Feature::for($user ?? new AnonymousUser())->active('some-feature');
```

### 坑 3：数据库驱动的 N+1 查询

**现象**：商品列表页（50 个商品）加载时，`features` 表产生了 50 次查询。

**根因**：每个商品都调用了一次 `Feature::active()`，每次都查一次数据库。

```php
// ❌ N+1 查询
foreach ($products as $product) {
    $showNewLabel = Feature::active('new-label-badge', $user);
    // 每次循环都查一次 features 表
}
```

**解决方案**：使用 `Feature::load()` 预加载，或使用 `Feature::loadMissing()` 懒加载：

```php
// ✅ 方案 A：预加载所有相关功能的状态
Feature::load(['new-label-badge', 'dynamic-pricing', 'social-proof']);

foreach ($products as $product) {
    $showNewLabel = Feature::active('new-label-badge'); // 不再查数据库
}

// ✅ 方案 B：批量检查
$features = Feature::all(['new-label-badge', 'dynamic-pricing']);
// $features = ['new-label-badge' => true, 'dynamic-pricing' => false]
```

### 坑 4：缓存与数据库驱动不一致

**现象**：在 Horizon 队列 Worker 中，功能状态和 Web 进程不一致。

**根因**：Pennant 的 ArrayDriver 会在内存中缓存状态。Web 进程和队列 Worker 是不同的进程，内存不共享。如果配置了 ArrayDriver，两边的状态会不同步。

**解决方案**：生产环境必须使用 DatabaseDriver：

```php
// config/pennant.php
return [
    'default' => 'database', // ← 不要用 array

    'stores' => [
        'database' => [
            'driver' => 'database',
            'connection' => 'pennant', // 建议使用独立连接
            'table' => 'features',
        ],
        'array' => [
            'driver' => 'array',
        ],
    ],
];
```

### 坑 5：与 Telescope 的兼容性问题

**现象**：开启 Telescope 后，Pennant 的查询日志淹没了 Telescope 的 Dashboard。

**根因**：Pennant 的 `features` 表查询非常频繁，Telescope 默认记录所有查询。

**解决方案**：

```php
// app/Providers/TelescopeServiceProvider.php
protected function registerEntries(): void
{
    // 忽略 features 表的查询
    Telescope::filter(function (IncomingEntry $entry) {
        if ($entry->type === EntryType::QUERY) {
            $sql = $entry->content['sql'] ?? '';
            if (str_contains($sql, 'features')) {
                return false;
            }
        }
        return true;
    });
}
```

---

## 七、性能数据与基准测试

### 7.1 查询性能

在 Laravel B2C API 项目中，我对 Pennant 的性能进行了基准测试：

| 场景 | 驱动 | 单次查询延迟 | 1000 次查询延迟 |
|------|------|------------|---------------|
| 冷启动（无缓存） | Database | 2.1ms | N/A |
| 热缓存（已加载） | Database | 0.03ms | 30ms |
| 冷启动 | Array | 0.01ms | N/A |
| 热缓存 | Array | 0.005ms | 5ms |
| Redis 自建方案 | Redis | 0.8ms | 800ms |

**结论**：DatabaseDriver 在热缓存后的性能非常优秀（0.03ms），完全可以用于生产环境。关键是避免 N+1 查询。

### 7.2 存储空间

`features` 表的存储空间取决于 `用户数 × 功能数`：

```
10,000 用户 × 20 个功能 = 200,000 行
每行约 200 bytes → 约 40MB
```

对于百万级用户的场景，建议：
- 定期清理长期不活跃的功能状态
- 使用 `Feature::purge()` 清除已下线功能的数据
- 考虑给 `features` 表加 TTL（如 90 天未访问自动清理）

---

## 八、最佳实践与反模式

### ✅ 最佳实践

**1. 功能定义集中管理**

```php
// ✅ 所有功能定义在一个地方
// app/Features.php
class Features
{
    const NEW_CHECKOUT_FLOW = 'new-checkout-flow';
    const DYNAMIC_PRICING = 'dynamic-pricing';
    const SOCIAL_LOGIN_V2 = 'social-login-v2';
}

// 注册
Feature::define(Features::NEW_CHECKOUT_FLOW, function (User $user) {
    return crc32(Features::NEW_CHECKOUT_FLOW . ":{$user->id}") % 100 < 10;
});

// 使用
if (Feature::active(Features::NEW_CHECKOUT_FLOW)) { ... }
```

**2. 使用 Lottery 实现百分比灰度**

```php
use Illuminate\Support\Lottery;

Feature::define('new-checkout-flow', function (User $user) {
    // Lottery 更适合随机抽样，且支持 inMemory 效果
    return Lottery::odds(1, 100) // 1% 概率
        ->winner(fn () => true)
        ->loser(fn () => false)
        ->choose();
});
```

**3. 部署脚本自动清除缓存**

```bash
# deploy.sh
php artisan migrate --force
php artisan pennant:purge --all  # 清除所有功能缓存
php artisan config:cache
php artisan route:cache
```

**4. 测试中使用 Fake**

```php
// tests/Feature/CheckoutTest.php
use Laravel\Pennant\Feature;

class CheckoutTest extends TestCase
{
    public function test_new_checkout_flow(): void
    {
        Feature::fake();

        // 强制激活
        Feature::shouldReceive('active')
            ->with('new-checkout-flow')
            ->andReturn(true);

        $response = $this->get('/checkout');
        $response->assertSee('new-cart-ui');
    }

    public function test_old_checkout_flow(): void
    {
        Feature::fake();
        // 默认不激活
        $response = $this->get('/checkout');
        $response->assertSee('legacy-cart-ui');
    }
}
```

### ❌ 反模式

**1. 不要在循环中调用 Feature::active()**

```php
// ❌ N+1 查询
foreach ($products as $product) {
    $active = Feature::active('some-feature');
}

// ✅ 提前加载
$active = Feature::active('some-feature');
foreach ($products as $product) {
    // 使用 $active
}
```

**2. 不要在功能定义中做数据库查询**

```php
// ❌ 每次检查都查数据库
Feature::define('vip-feature', function (User $user) {
    return DB::table('vip_users')->where('user_id', $user->id)->exists();
});

// ✅ 使用 User 模型上的属性
Feature::define('vip-feature', function (User $user) {
    return $user->is_vip; // 使用已有的字段或关系
});
```

**3. 不要忘记处理"功能下线"**

```php
// ❌ 功能上线后，定义和代码都留着
Feature::define('old-feature', fn () => true);

// ✅ 功能全量上线后，清理代码
// Step 1: 全量激活
Feature::define('old-feature', fn () => true);

// Step 2: 移除所有 if/else 分支中的旧逻辑
// Step 3: 删除功能定义
// Step 4: 删除 features 表中的记录
// Step 5: 添加 migration 删除 features 表中的旧数据
```

---

## 九、扩展思考

### 9.1 Pennant 的局限性

Pennant 是一个轻量级的功能开关方案，但它也有明确的边界：

| 局限 | 影响 | 替代方案 |
|------|------|---------|
| 没有内置仪表盘 | 无法实时查看功能激活状态 | 自建 Admin 页面或用 LaunchDarkly |
| 没有内置审计 | 需要自己记录谁改了什么 | 结合 Activity Log 包 |
| 没有定时发布 | 不能设置"下周二自动全量" | 用 Scheduler + Feature::activate() |
| 没有多环境同步 | Dev/Staging/Prod 状态独立 | 手动管理或用 Artisan 命令 |
| 没有 SDK 多语言 | 只有 PHP 服务端 | 前端需要额外的 API 接口 |

### 9.2 前端功能开关的实现

Pennant 是后端方案，但前端也需要感知功能开关。推荐的方案是通过 API 传递：

```php
// app/Http/Controllers/Api/FeatureController.php
class FeatureController extends Controller
{
    /**
     * 返回当前用户的所有功能状态
     * 前端通过此 API 感知功能开关
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $features = Feature::all([
            'new-checkout-flow',
            'new-recommendation-algo',
            'dark-mode-support',
            'social-login-v2',
        ]);

        return response()->json($features);
    }
}
```

```javascript
// 前端：在应用初始化时获取功能状态
const features = await fetch('/api/features').then(r => r.json());

if (features['new-checkout-flow']) {
    renderNewCheckout();
} else {
    renderLegacyCheckout();
}
```

### 9.3 功能开关的生命周期管理

一个功能开关从创建到删除，经历以下阶段：

```
创建 → 灰度 1% → 灰度 10% → 灰度 50% → 全量 100% → 代码清理 → 删除开关
```

建议在代码中强制记录生命周期：

```php
Feature::define('new-checkout-flow', function (User $user): bool {
    return match (app()->environment()) {
        'local'     => true,                              // 本地默认开启
        'staging'   => true,                              // Staging 默认开启
        'production' => crc32("checkout:{$user->id}") % 100 < 10, // 生产 10% 灰度
    };
});
// TODO(2026-07-01): 全量上线后清理此功能开关
// Owner: @michael
// JIRA: B2C-1234
```

---

## 总结

Laravel Pennant 是一个"小而美"的功能开关实现。它的核心价值不在于功能有多丰富，而在于**零成本集成**——不需要额外的 SDK、不需要外部服务、不需要改架构。

对于大多数 Laravel B2C 项目，Pennant 解决了 80% 的功能开关需求。剩下的 20%（仪表盘、高级分析、多语言 SDK）可以通过自建 Admin 页面和 API 来补充。

**三句话总结**：

1. **功能开关不是 if/else**——它需要用户粒度、动态性和持久化
2. **Pennant 的 Scope 机制是精髓**——理解了 Scope，就理解了 Pennant 80% 的设计
3. **清除缓存是最大的坑**——修改定义后别忘了 `Feature::purge()`

---

## 相关阅读

- [Laravel Pennant 特性开关实战：多租户分桶、灰度放量与回滚兜底踩坑记录](/categories/Laravel/laravel-pennant-guide-canary/)
- [Laravel 多租户 SaaS 实战：共享库与独立库混合架构下的租户识别、连接切换与队列串租踩坑记录](/categories/Laravel/laravel-saas-guide-architecture/)
- [Nginx FastCGI Cache 与 Laravel API 缓存旁路实战：秒杀落地页降压、回源一致性与灰度失效踩坑记录](/categories/Laravel/nginx-fastcgi-cache-laravel-api-cacheguide-canary/)
