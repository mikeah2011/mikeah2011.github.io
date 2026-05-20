---
title: Laravel-Policies-Gates-RBAC-权限管理与多租户隔离实战
date: 2026-05-05 12:15:10
updated: 2026-05-05 12:17:53
categories:
  - 05_PHP
  - Laravel
tags:
  - Laravel
  - Policies
  - Gates
  - RBAC
  - 多租户
  - 权限管理
description: >
  基于 Laravel 后台与 B2B/B2C 混合业务的真实改造经验，记录如何用 Policies、Gates 与角色权限表落地 RBAC，并在多租户场景下补上 tenant_id 隔离、超级管理员旁路、批量查询性能与队列串租等关键细节。
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

## 结语

Laravel 的 Policies 和 Gates 本身不复杂，真正难的是把它们放进**RBAC、租户隔离、查询性能、审计追踪**这一整套工程化上下文里。我的最终原则只有三条：

1. **授权判断归 Policy / Gate，不写死在 Controller。**
2. **数据边界前推到查询层，别等查出来再逐条判。**
3. **多租户上下文要能脱离 Web 请求存在，尤其是 Job、Command、Cron。**

做到这一步，权限系统才算从“页面能不能点”升级成“数据能不能看、任务能不能跑、事故能不能追”。这也是 Laravel 后台进入中大型项目后，最值得尽早补上的基础设施。
