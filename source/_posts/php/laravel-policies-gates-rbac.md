
title: Laravel-Policies-Gates-RBAC-权限管理与多租户隔离实战
keywords: [Laravel, Policies, Gates]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 12:15:10
updated: 2026-05-05 12:17:53
categories:
  - php
tags:
- Laravel
- RBAC
- permission
- policies
- gates
- 多租户
- 授权
- Spatie
description: '深入实战 Laravel Policies、Gates 与 RBAC 权限控制方案。涵盖 Policy 对象级授权、路由中间件与 FormRequest 集成、API Resource 字段级权限、Spatie Permission 多租户缓存优化、队列越权防护与 PHPUnit 测试，附踩坑案例，助你构建企业级 Laravel 授权体系。

  '
---


## 背景：权限问题不是“能不能点按钮”这么简单

我在整理一个 Laravel 后台时，最初的权限实现只有两层：`is_admin` 和 `user_id`。功能少的时候还能撑住，一旦进入代理商、供应商、客服、财务并存的阶段，问题马上爆出来：同一个“订单查看”动作，客服能看自己租户下全部订单，供应商只能看自己名下资源，财务可以导出金额字段，而超级管理员又要能跨租户排障。

如果继续把判断写在 Controller 里，最后就会变成一堆：

```php
if (! $user->is_admin && $order->tenant_id !== $user->tenant_id) {
    abort(403);
}

if ($user->role !== 'finance' && $request->boolean('with_amount')) {
    abort(403);
}
```

这种写法最大的问题不是丑，而是**规则散落、无法复用、查询层没有隔离**。真正可维护的做法，必须把“动作授权”和“数据边界”拆开：

```text
┌─────────────────────────────────────────────────────────┐
│ Request                                                 │
│   │                                                     │
│   ▼                                                     │
│ TenantMiddleware 解析 tenant / user context             │
│   │                                                     │
│   ▼                                                     │
│ Controller 只收参数                                      │
│   │                                                     │
│   ▼                                                     │
│ Policy / Gate 判断「这个人能不能做这件事」               │
│   │                                                     │
│   ▼                                                     │
│ Repository / Scope 判断「他能看到哪些数据」              │
│   │                                                     │
│   ▼                                                     │
│ Service 执行业务逻辑 + afterCommit 事件                  │
└─────────────────────────────────────────────────────────┘
```

## 一、RBAC 落地方式：角色给能力，Policy 管对象

我的经验是：**菜单权限、通用动作用 Gate；对象级授权用 Policy；租户边界放查询层**。不要试图让单一机制做完全部事情。

先定义最小可用的角色能力映射：

```php
<?php

return [
    'super-admin' => ['*'],
    'finance' => ['order.view', 'order.export', 'refund.approve'],
    'support' => ['order.view', 'order.update', 'ticket.reply'],
    'supplier' => ['order.view.own_supplier'],
];
```

然后在 `AuthServiceProvider` 中注册 Gate：

```php
<?php

namespace App\Providers;

use App\Models\Order;
use App\Policies\OrderPolicy;
use Illuminate\Foundation\Support\Providers\AuthServiceProvider as ServiceProvider;
use Illuminate\Support\Facades\Gate;

class AuthServiceProvider extends ServiceProvider
{
    protected $policies = [
        Order::class => OrderPolicy::class,
    ];

    public function boot(): void
    {
        $this->registerPolicies();

        Gate::before(function ($user, string $ability) {
            return $user->hasRole('super-admin') ? true : null;
        });

        Gate::define('order.export', fn ($user) => $user->canUse('order.export'));
    }
}
```

这里 `Gate::before()` 很关键，排障时超级管理员不需要重复走每一个细粒度判断。但我不会把它做成“永远放行所有动作”，而是只允许内部员工角色使用，否则审计会很难看。

## 二、Policy 只判断对象动作，不负责拼业务查询

`OrderPolicy` 的核心不是判断角色名，而是组合“角色能力 + 租户边界 + 资源归属”：

```php
<?php

namespace App\Policies;

use App\Models\Order;
use App\Models\User;

class OrderPolicy
{
    public function view(User $user, Order $order): bool
    {
        if ($user->tenant_id !== $order->tenant_id) {
            return false;
        }

        if ($user->canUse('order.view')) {
            return true;
        }

        if ($user->canUse('order.view.own_supplier')) {
            return (int) $user->supplier_id === (int) $order->supplier_id;
        }

        return false;
    }

    public function export(User $user): bool
    {
        return $user->canUse('order.export');
    }
}
```

Controller 反而可以很薄：

```php
public function show(Order $order): JsonResponse
{
    $this->authorize('view', $order);

    return response()->json(OrderResource::make($order));
}

public function export(Request $request, OrderExportService $service): JsonResponse
{
    $this->authorize('export', Order::class);

    $jobId = $service->dispatch(auth()->user(), $request->all());

    return response()->json(['job_id' => $jobId]);
}
```

注意 `export` 这类不依赖具体模型实例的动作，我更倾向用 `Order::class` 走 Policy 或直接用 Gate，而不是伪造一个空模型进去。

## 三、多租户隔离别只做在 Policy，列表查询更容易漏

很多团队以为 `show/update/delete` 走了 Policy 就安全了，结果最危险的是列表页。因为列表通常先查出 50 条数据，再逐条 `can()`，这时数据已经越权泄露给应用层了。

我更推荐在查询入口统一加租户作用域：

```php
<?php

namespace App\Models\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $user = auth()->user();

        if (! $user || $user->hasRole('super-admin')) {
            return;
        }

        $builder->where($model->getTable() . '.tenant_id', $user->tenant_id);
    }
}
```

订单模型注册：

```php
protected static function booted(): void
{
    static::addGlobalScope(new TenantScope());
}
```

这套做法解决了后台列表越权问题，但也带来一个真实坑：**队列、CLI、排程没有登录态**。所以我后来又补了一层显式上下文对象，在 Job 里传入 `tenantId`，而不是依赖 `auth()`。

## 四、批量授权要避免 N+1

另一个常见坑是列表页每一行都调用一次 `can('view', $order)`。50 条数据问题不大，500 条订单加上关联关系后就会炸。

我的处理方式是先把可见范围前推到 SQL，再把对象级差异放到少量字段判断：

```php
$query = Order::query()
    ->when($user->hasRole('supplier'), function ($query) use ($user) {
        $query->where('supplier_id', $user->supplier_id);
    })
    ->with(['customer:id,name', 'supplier:id,name'])
    ->latest();

$orders = $query->paginate(50);
```

也就是说，Policy 仍然保底，但真正的性能优化要落在查询构建阶段。否则权限没出错，接口 RT 先变成 900ms。

## 五、我踩过的 4 个坑

### 1. `Gate::before()` 写太大，审计失真

一开始我让 `super-admin` 跳过所有判断，结果连被禁用的导出功能也能访问。后来改成只给内部排障角色，并且关键动作照样记审计日志。

### 2. 只做按钮隐藏，不做接口鉴权

前端把“退款审批”按钮藏起来不等于安全。真正出过事故的是旧版 App 还保留接口地址，后端没走 Policy，直接被调用成功。

### 3. 全局 Scope 影响后台统计

财务日报需要跨租户汇总，如果忘了 `withoutGlobalScope(TenantScope::class)`，报表会天然少数。这个坑很隐蔽，因为代码不报错，只是数字不对。

### 4. 队列串租

导出任务里如果只传 `order_id` 不传 `tenant_id`，Worker 拿到模型时可能已经绕过原始租户上下文。我的修复方式是 Job payload 固定带上 `tenant_id`，查询时双条件约束，必要时直接落审计。

## 六、把租户上下文带进 Job，避免异步任务越权

如果导出、同步、补偿这些动作进入队列，我不会把 `auth()->id()` 当成唯一上下文，而是显式传递租户信息：

```php
<?php

namespace App\Jobs;

use App\Models\Order;
use App\Services\OrderExportService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ExportOrdersJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public function __construct(
        public readonly int $tenantId,
        public readonly int $operatorId,
        public readonly array $filters,
    ) {
    }

    public function handle(OrderExportService $service): void
    {
        $orders = Order::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $this->tenantId)
            ->when(isset($this->filters['status']), function ($query) {
                $query->where('status', $this->filters['status']);
            })
            ->get();

        $service->export($this->tenantId, $this->operatorId, $orders);
    }
}
```

这里我故意用了 `withoutGlobalScopes()`，因为 Worker 环境里你不能假设登录态仍然存在。既然主动移除了 Scope，就必须马上补回 `tenant_id` 条件，否则就是给越权开后门。

## 七、权限表设计别追求“万能”，先把审计链补齐

我见过最容易失控的设计，是把角色、权限、菜单、数据范围、字段级可见性全塞进一张 JSON 表里。初期写起来快，半年后没人敢改。中大型 Laravel 项目里，我更偏向下面这种朴素结构：

```text
roles
├── id
├── code
└── name

permissions
├── id
├── code          # order.view / order.export
└── description

role_permission
├── role_id
└── permission_id

model_has_roles
├── user_id
├── role_id
└── tenant_id     # 同一用户在不同租户可有不同角色
```

如果一个用户会跨多个 tenant 切换，`tenant_id` 一定要进入关联表，而不是只挂在 `users` 主表。否则你会在“同账号进入 A 公司是财务、进入 B 公司只是客服”这种场景里撞墙。

另外，关键授权动作我会补一条审计日志：

```php
AuditLog::create([
    'tenant_id' => $user->tenant_id,
    'user_id' => $user->id,
    'action' => 'order.export',
    'target_type' => Order::class,
    'target_id' => null,
    'meta' => [
        'filters' => $request->all(),
        'ip' => $request->ip(),
    ],
]);
```

这样真正出问题时，至少能追出“谁在什么租户下，用什么条件导出了哪些数据”。权限系统如果没有审计，很多时候只是心理安慰。

## 八、Spatie Permission 集成：从自建角色表到生产级 RBAC

自建角色表在项目初期足够灵活，但当权限数量超过 50 个、角色需要动态配置时，手动维护 `role_permission` 关联表会变成负担。这时我会引入 `spatie/laravel-permission`：

```bash
composer require spatie/laravel-permission
php artisan vendor:publish --provider="Spatie\Permission\PermissionServiceProvider"
php artisan migrate
```

核心模型改造：

```php
<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    use HasRoles;

    // Spatie 默认使用 Guard 名称做隔离，多租户场景需要指定
    protected $guard_name = 'web';

    /**
     * 重写获取角色方法，加入租户过滤
     */
    public function getRoleNames(): Collection
    {
        return $this->roles()
            ->wherePivot('tenant_id', $this->tenant_id)
            ->pluck('name');
    }
}
```

Spatie 的 `team_id` 参数从 v5 开始原生支持多租户，但我的经验是：**直接用 `team_id` 字段不如用 `tenant_id` + 自定义中间件来得可控**。原因是 `team_id` 默认绑定到 `team` 模型，而我们的租户可能是组织、代理商、部门等多种形态。

配置 `config/permission.php`：

```php
'teams' => true,  // 启用团队模式

'models' => [
    'permission' => Spatie\Permission\Models\Permission::class,
    'role' => Spatie\Permission\Models\Role::class,
],
```

在 AuthServiceProvider 中桥接 Spatie 与 Laravel Gate：

```php
public function boot(): void
{
    $this->registerPolicies();

    // Gate::before 仍然保留超级管理员旁路
    Gate::before(function ($user, string $ability) {
        if ($user->hasRole('super-admin')) {
            return true;
        }
        return null; // 继续走后续判断
    });

    // 将 Spatie 权限映射为 Gate 能力
    Gate::define('order.export', function ($user) {
        return $user->hasPermissionTo('order.export');
    });

    Gate::define('order.view', function ($user) {
        return $user->hasPermissionTo('order.view');
    });
}
```

权限缓存是 Spatie 的隐藏优势。手动建表方案每次请求都要查 3 张表（user → role → permission），而 Spatie 内置的缓存层会把权限列表序列化到 Redis/文件，首次查询后后续请求零数据库开销：

```php
// 清除权限缓存（角色/权限变更后必须调用）
app()[\Spatie\Permission\PermissionRegistrar::class]->forgetCachedPermissions();
```

### Spatie 与自建方案的选择标准

| 维度 | 自建角色表 | Spatie Permission |
|---|---|---|
| 权限数量 | < 30 个，够用 | > 50 个，建议引入 |
| 运维界面 | 需自行开发 CRUD | 配合 filament-shield 或 backpack 即可 |
| 缓存策略 | 需自行实现 | 内置缓存，配置即生效 |
| 多租户 | 完全可控 | 需启用 `teams` 并理解其默认行为 |
| 升级风险 | 无依赖 | 关注大版本迁移（v5 → v6 有 breaking change） |

## 九、PHPUnit 授权测试：Policy 和 Gate 的回归保障

权限逻辑如果没有测试覆盖，重构时就是在走钢丝。我通常会为每个 Policy 建一个测试类，覆盖「允许 / 拒绝 / 边界」三种场景：

```php
<?php

namespace Tests\Feature\Policies;

use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrderPolicyTest extends TestCase
{
    use RefreshDatabase;

    public function test_finance_can_view_order_in_same_tenant(): void
    {
        $user = User::factory()->create(['tenant_id' => 1]);
        $user->assignRole('finance');

        $order = Order::factory()->create(['tenant_id' => 1]);

        $this->assertTrue($user->can('view', $order));
    }

    public function test_user_cannot_view_order_in_different_tenant(): void
    {
        $user = User::factory()->create(['tenant_id' => 1]);
        $user->assignRole('finance');

        $order = Order::factory()->create(['tenant_id' => 2]);

        $this->assertFalse($user->can('view', $order));
    }

    public function test_supplier_can_only_view_own_supplier_orders(): void
    {
        $user = User::factory()->create([
            'tenant_id' => 1,
            'supplier_id' => 100,
        ]);
        $user->assignRole('supplier');

        $ownOrder = Order::factory()->create([
            'tenant_id' => 1,
            'supplier_id' => 100,
        ]);

        $otherOrder = Order::factory()->create([
            'tenant_id' => 1,
            'supplier_id' => 200,
        ]);

        $this->assertTrue($user->can('view', $ownOrder));
        $this->assertFalse($user->can('view', $otherOrder));
    }

    public function test_super_admin_can_bypass_all_policies(): void
    {
        $admin = User::factory()->create(['tenant_id' => 1]);
        $admin->assignRole('super-admin');

        $order = Order::factory()->create(['tenant_id' => 999]);

        $this->assertTrue($admin->can('view', $order));
    }

    public function test_user_without_role_cannot_export(): void
    {
        $user = User::factory()->create(['tenant_id' => 1]);

        $this->assertFalse($user->can('export', Order::class));
    }
}
```

Gate 级别的测试可以更轻量，直接用 `Gate::allows` 断言：

```php
<?php

namespace Tests\Feature\Gates;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Tests\TestCase;

class OrderExportGateTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_with_permission_can_export(): void
    {
        $user = User::factory()->create();
        $user->givePermissionTo('order.export');

        $this->assertTrue(Gate::forUser($user)->allows('order.export'));
    }

    public function test_user_without_permission_cannot_export(): void
    {
        $user = User::factory()->create();

        $this->assertFalse(Gate::forUser($user)->allows('order.export'));
    }

    public function test_gate_before_super_admin_bypasses(): void
    {
        $admin = User::factory()->create();
        $admin->assignRole('super-admin');

        // 即使没有单独授权 order.export，super-admin 也应通过
        $this->assertTrue(Gate::forUser($admin)->allows('order.export'));
    }
}
```

### 测试策略总结

| 测试类型 | 覆盖目标 | 建议数量 |
|---|---|---|
| Policy 单元测试 | 每个 Policy 方法的允许/拒绝 | 每个 Policy 5-8 个用例 |
| Gate 集成测试 | Gate::allows / denies 断言 | 每个 Gate 2-3 个用例 |
| HTTP 集成测试 | 403 响应码与 JSON 结构 | 关键接口全覆盖 |
| 多租户边界测试 | 跨租户越权场景 | 每种资源 2 个用例 |

> **实战建议**：在 CI 中把权限测试单独分组（`@group authorization`），每次改动权限配置后跑一遍，比手动点页面验证靠谱得多。

## 十、常见反模式与修复方案

### 反模式 1：Controller 里散落 if-else 判断

```php
// ❌ 错误做法：权限逻辑写死在 Controller
public function update(Request $request, Order $order)
{
    if (! auth()->user()->is_admin && $order->tenant_id !== auth()->user()->tenant_id) {
        abort(403);
    }
    if (auth()->user()->role === 'supplier' && $order->status !== 'pending') {
        abort(403);
    }
    // 业务逻辑...
}

// ✅ 正确做法：统一走 Policy
public function update(UpdateOrderRequest $request, Order $order)
{
    $this->authorize('update', $order);  // Policy 中集中处理
    // 业务逻辑...
}
```

### 反模式 2：用 `@can` 隐藏按钮代替接口鉴权

前端 `@can('refund.approve')` 只是 UI 层隐藏，接口必须独立鉴权：

```php
// Blade 模板
@can('refund.approve', $order)
    <button>审批退款</button>
@endcan

// Controller 中必须同步鉴权 —— 不能假设前端已经过滤
public function approve(RefundRequest $request, Order $order)
{
    $this->authorize('refund.approve', $order);  // 不可省略
    // ...
}
```

### 反模式 3：Policy 中做复杂查询

```php
// ❌ 错误：Policy 里拼查询条件
public function viewAny(User $user): bool
{
    return Order::where('tenant_id', $user->tenant_id)->exists();  // 副作用
}

// ✅ 正确：Policy 只做布尔判断，查询交给 Scope
public function viewAny(User $user): bool
{
    return $user->canUse('order.view');  // 纯布尔
}
```

### 反模式 4：忘记 `withoutGlobalScope` 导致统计报表数据缺失

```php
// ❌ 财务日报被 TenantScope 过滤，数据天然少了其他租户
$total = Order::whereDate('created_at', today())->sum('amount');

// ✅ 跨租户统计需要显式移除 Scope
$total = Order::withoutGlobalScope(TenantScope::class)
    ->whereDate('created_at', today())
    ->sum('amount');
```

## 十一、方案选型对比：Policies vs Gates vs Spatie Permission vs Bouncer

| 维度 | Laravel Policies | Laravel Gates | Spatie Permission | Bouncer |
|---|---|---|---|---|
| 粒度 | 模型实例级 | 通用能力级 | 角色 + 权限表 | 角色 + 能力 |
| 数据库依赖 | 无（纯 PHP 类） | 无（闭包/回调） | 需要 migrations | 需要 migrations |
| 多租户支持 | 需自行实现 | 需自行实现 | team_id 原生支持 | 需自行实现 |
| 缓存 | 无 | 无 | 内置权限缓存 | 内置缓存 |
| 适用场景 | CRUD 对象级授权 | 菜单/按钮级判断 | 中大型 RBAC 全表管理 | 轻量角色能力映射 |
| 学习曲线 | 低 | 低 | 中 | 中 |
| 审计友好 | 可自行埋点 | 可自行埋点 | 需扩展 | 需扩展 |

> **选型建议**：小项目用 Policies + Gates 足够；需要可视化管理角色权限时引入 Spatie Permission；Bouncer 适合偏好能力（ability）模型的团队。本文方案是 Policies + Gates + 自建角色表的组合，兼顾灵活性与可控性。

## 十二、路由中间件授权与 FormRequest 集成

除了在 Controller 方法里手动调用 `$this->authorize()`，Laravel 还提供了两种更自动化的授权写法，适合标准化 CRUD 场景。

### 路由中间件 `can:`

在 `routes/api.php` 中直接挂载 Policy 能力，Controller 里就不用重复写了：

```php
Route::middleware(['auth:sanctum'])->group(function () {
    // 单模型实例授权
    Route::get('/orders/{order}', [OrderController::class, 'show'])
        ->middleware('can:view,order');

    // 类级别授权（不需要模型实例）
    Route::post('/orders/export', [OrderController::class, 'export'])
        ->middleware('can:export,App\Models\Order');

    // 多能力 OR 逻辑
    Route::put('/orders/{order}', [OrderController::class, 'update'])
        ->middleware('can:update,order');
});
```

这里的 `order` 是路由参数名，Laravel 会自动解析模型实例并注入到 Policy。但有一个真实坑：**如果路由参数名和 Policy 方法的参数名不一致，会直接跳过授权判断而不报错**。我曾经因为把路由参数叫 `{order}` 但 Policy 方法第二个参数叫 `$post`，导致整个 Policy 形同虚设。

```php
// ❌ 参数名不匹配，Laravel 找不到模型实例，静默跳过
public function view(User $user, Order $target): bool  // 应该叫 $order

// ✅ 参数名一致
public function view(User $user, Order $order): bool
```

### `authorizeResource` 便捷方法

在 Controller 构造方法里统一声明，Laravel 会根据方法名自动映射 Policy 能力：

```php
class OrderController extends Controller
{
    public function __construct()
    {
        $this->authorizeResource(Order::class, 'order');
    }

    // 自动映射：index→viewAny, show→view, create→create, store→create,
    //           edit→update, update→update, destroy→delete
}
```

好处是省代码，坏处是不透明——新人看 `show` 方法时不会意识到有授权逻辑在构造函数里。我的建议是：**内部后台可以用 `authorizeResource`，对外 API 保持显式 `$this->authorize()` 以便代码审查。**

### FormRequest 集成 Policy

如果已经在用 FormRequest 做参数校验，可以把授权逻辑也放进去，让 Controller 彻底归零：

```php
<?php

namespace App\Http\Requests;

use App\Models\Order;
use Illuminate\Foundation\Http\FormRequest;

class UpdateOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var Order $order */
        $order = $this->route('order');

        return $this->user()->can('update', $order);
    }

    public function rules(): array
    {
        return [
            'status' => 'required|in:pending,confirmed,shipped',
            'remark' => 'nullable|string|max:500',
        ];
    }
}
```

Controller 变成纯业务调用：

```php
public function update(UpdateOrderRequest $request, Order $order): JsonResponse
{
    // 到这里授权已通过，直接执行业务
    $order->update($request->validated());

    return response()->json(OrderResource::make($order));
}
```

> **注意**：不要同时在 FormRequest 的 `authorize()` 和 Controller 里都做授权判断，会重复执行 Policy，增加不必要的开销。选一个入口即可。

### 三种授权入口对比

| 方式 | 适用场景 | 优点 | 缺点 |
|---|---|---|---|
| `$this->authorize()` | 需要灵活控制的场景 | 显式、可审查 | 每个方法都要写 |
| `authorizeResource` | 标准 CRUD Controller | 省代码、自动映射 | 不透明、参数名必须匹配 |
| FormRequest `authorize()` | 有参数校验的接口 | 校验+授权合一 | 授权逻辑藏在 Request 里 |

## 十三、API Resource 字段级权限控制

前面讨论的都是「能不能访问」，但实际项目中更常见的是「能看哪些字段」。同一个订单详情接口，财务能看金额和佣金，客服只能看状态和物流。

很多团队的做法是在 Controller 里拼数组，但更好的做法是把字段级权限放进 API Resource：

```php
<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class OrderResource extends JsonResource
{
    public function toArray($request): array
    {
        $data = [
            'id'          => $this->id,
            'order_no'    => $this->order_no,
            'status'      => $this->status,
            'created_at'  => $this->created_at->toIso8601String(),
        ];

        // 金额字段：只有具备 order.view.amount 权限的角色可见
        if ($request->user()?->can('viewAmount', $this->resource)) {
            $data['amount']     = $this->amount;
            $data['commission'] = $this->commission;
            $data['currency']   = $this->currency;
        }

        // 物流字段：客服和供应商可见
        if ($request->user()?->can('viewShipping', $this->resource)) {
            $data['tracking_no']   = $this->tracking_no;
            $data['shipped_at']    = $this->shipped_at?->toIso8601String();
            $data['carrier']       = $this->carrier;
        }

        // 关联数据按需加载
        $data['customer'] = new CustomerResource($this->whenLoaded('customer'));

        return $data;
    }
}
```

对应的 Policy 方法保持简洁：

```php
public function viewAmount(User $user, Order $order): bool
{
    return $user->tenant_id === $order->tenant_id
        && $user->canUse('order.view.amount');
}

public function viewShipping(User $user, Order $order): bool
{
    return $user->tenant_id === $order->tenant_id
        && $user->canUseAny(['order.view', 'order.view.shipping']);
}
```

这样做的好处是：**前端不需要做任何权限判断，拿到的 JSON 结构天然就是脱敏后的**。即使是同一个接口、同一个 URL，不同角色拿到的字段集合完全不同。

> **踩坑提示**：如果用 `$this->when()` 方法（Laravel 内置的条件字段），要注意它返回的是 `MissingValue` 对象而不是 `null`。序列化时 `MissingValue` 字段会被整个省略，而 `null` 字段会保留 key。这两种行为对前端的影响完全不同，要根据接口文档约定来选择。

## 十四、Spatie Permission 高频踩坑补充

### 缓存导致权限更新不立即生效

Spatie 默认会缓存权限列表到缓存驱动（Redis / file），手动修改数据库中的角色权限关联后，如果不清缓存，用户侧感知不到变化：

```php
// ❌ 直接操作数据库后忘记清缓存
DB::table('role_has_permissions')->insert([...]);
// 用户下次请求仍然拿到旧权限

// ✅ 方案一：用 Spatie 提供的方法操作，自动清缓存
$role->givePermissionTo('order.export');

// ✅ 方案二：手动操作数据库后主动清缓存
app()[\Spatie\Permission\PermissionRegistrar::class]->forgetCachedPermissions();
```

在部署脚本中跑 Seeder / Migration 后也要记得清缓存，否则线上环境会拿到过期数据。

### `Gate::before` 与 Spatie 的优先级冲突

如果同时使用了 `Gate::before` 做超级管理员旁路和 Spatie 的 `hasPermissionTo`，要注意执行顺序。`Gate::before` 返回 `true` 会直接短路，后续的 Policy 和 Gate 都不会再执行：

```php
Gate::before(function ($user, string $ability) {
    // 如果这里返回 true，所有 Policy 都被跳过，包括你自定义的租户判断
    if ($user->hasRole('super-admin')) {
        return true;
    }
    return null; // 返回 null 继续走后续判断
});
```

我的建议是：**`Gate::before` 只对内部排障账号开放，且限制可用能力范围**。不要让它返回 `true` 给所有能力，否则审计日志和租户隔离形同虚设。

### 同一用户多租户下角色混乱

Spatie 的 `model_has_roles` 表默认没有 `tenant_id` 字段。如果一个用户在租户 A 是管理员、在租户 B 是普通客服，直接调用 `hasRole('admin')` 会返回 `true`，因为它不区分租户。

解决方案有两种：

```php
// 方案一：启用 Spatie 的 teams 模式
// config/permission.php: 'teams' => true
// model_has_roles 表增加 team_id 字段
$user->hasRole('admin', 'tenant-a');

// 方案二：自己在中间件里维护 tenant_id 上下文，自定义 hasRole 方法
public function hasRole(string $role, ?int $tenantId = null): bool
{
    $tenantId = $tenantId ?? $this->tenant_id;
    return $this->roles()
        ->wherePivot('tenant_id', $tenantId)
        ->where('name', $role)
        ->exists();
}
```

方案一更规范但需要理解 Spatie 的 team 概念；方案二更灵活但需要自己维护。

## 结语

Laravel 的 Policies 和 Gates 本身不复杂，真正难的是把它们放进**RBAC、租户隔离、查询性能、审计追踪**这一整套工程化上下文里。我的最终原则只有三条：

1. **授权判断归 Policy / Gate，不写死在 Controller。**
2. **数据边界前推到查询层，别等查出来再逐条判。**
3. **多租户上下文要能脱离 Web 请求存在，尤其是 Job、Command、Cron。**

做到这一步，权限系统才算从"页面能不能点"升级成"数据能不能看、任务能不能跑、事故能不能追"。这也是 Laravel 后台进入中大型项目后，最值得尽早补上的基础设施。

## 相关阅读

- [Laravel 多租户 SaaS 实战：共享库与独立库混合架构下的租户识别、连接切换与队列串租踩坑记录](/php/Laravel/laravel-saas-guide-architecture/)
- [Laravel Scopes 实战：查询作用域封装与复杂筛选条件复用踩坑记录](/php/Laravel/laravel-scopes-guide-query/)
- [OpenFGA 实战：细粒度授权引擎（Zanzibar 模型）——Laravel 中的关系型权限控制与 ReBAC 落地](/00_架构/openfga-zanzibar-rebac-laravel/)
- [Laravel Sanctum / Passport Token 刷新机制实战：多端登录、双 Token 轮换与并发续签踩坑记录](/php/Laravel/laravel-sanctum-passport-token-guide-token-concurrency/)
- [Laravel Jobs & Queues 深度实战：队列驱动选型、失败重试与 Supervisor 进程管理](/php/Laravel/laravel-jobs-queues-deep-dive/)
- [Laravel 中间件实战：请求生命周期、Kernel 注册顺序与自定义鉴权中间件踩坑记录](/php/Laravel/middleware-guide/)
- [Laravel 授权模型深度对比：RBAC vs ABAC vs ReBAC](/05_PHP/Laravel/RBAC-vs-ABAC-vs-ReBAC-权限模型实战-Laravel中的三种授权范式/)
- [数据库多租户模式对比实战：共享库 Row-Level vs Schema-per-Tenant vs 独立库](/01_MySQL/数据库多租户模式对比实战-共享库Row-Level-vs-Schema-per-Tenant-vs-独立库-Laravel中的三种方案深度权衡/)
