---
title: Eloquent Global Scopes 深度实战：Soft Delete、多租户、数据权限——全局作用域的嵌套冲突与解决方案
date: 2026-06-10 02:05:00
categories:
  - PHP
  - Laravel
tags:
  - Laravel
  - Eloquent
  - Global Scopes
  - Soft Deletes
  - Multi-Tenancy
  - 数据权限
  - B2C API
description: 深入拆解 Laravel Eloquent Global Scopes 的实战用法，重点说明 Soft Delete、多租户、数据权限三种场景下的作用域设计，以及 when()、without()、nestedScopeKey、手动重建查询、事件驱动解耦等嵌套冲突解决方案。
---

在 Laravel B2C API 的真实项目里，`Global Scopes` 是最容易被低估、也最容易踩坑的 Eloquent 能力之一。

很多团队一开始会觉得它只是“自动拼条件”：

- Soft Delete 加 `WHERE deleted_at IS NULL`
- 多租户加 `WHERE tenant_id = ?`
- 数据权限加 `WHERE department_id IN (?)`

但随着业务增长，这些作用域会开始互相叠加、互相排斥、互相覆盖，最后变成维护噩梦：

- 某些查询只想绕过 Soft Delete，却把租户过滤也清掉了
- 某些后台任务需要“管理员视角”，结果把部门权限也丢了
- 某些统计接口需要“包含已删除数据”，但又不想破坏主查询逻辑
- 某些批量操作需要临时去掉作用域，却忘了恢复，导致后续查询污染

这篇文章就围绕这个真实痛点展开：

1. Global Scopes 到底解决了什么问题
2. Soft Delete、多租户、数据权限三类作用域怎么设计
3. 嵌套冲突会出现哪些典型形态
4. 怎么用最小改动实现稳定可维护的解决方案

## 概述

Eloquent Global Scopes 的核心价值不是“少写一点 WHERE”，而是**把横切关注点从控制器、Service、Repository 里收拢出来**。

用得好，能获得：

- 业务查询更干净：`User::query()->active()->get()` 不用再重复拼条件
- 权限边界更统一：所有模型默认遵守租户和数据权限规则
- 后台任务更容易做“例外处理”：`withoutGlobalScope()` 可以临时放行
- 遗漏风险更小：新接口不用记得每次都加同样的过滤逻辑

但 Global Scopes 的复杂度来源于：

- 作用域会自动应用到当前进程的所有查询
- 多个作用域可以同时存在
- 开发者可以在查询构建器上逐个移除作用域
- 当 Soft Delete、租户、权限混在一起时，移除一个可能连带影响另一个

换句话说：

**Global Scopes 本身不复杂，复杂的是“作用域之间的契约”。**

很多团队的问题不是“不会用 Global Scopes”，而是没有定义清楚：

- 哪些作用域必须始终生效
- 哪些作用域可以在特殊场景绕过
- 绕过时是否需要保留其他条件
- 谁负责在绕过之后恢复上下文

这就是本文要解决的问题。

## 核心概念

### 1. Global Scopes 的本质

一个 Global Scope 会在 `Eloquent\Builder` 初始化时自动注入查询条件。

它本质上是对模型查询的一层“默认约束”。

常见场景：

- **Soft Delete**：排除已删除记录
- **多租户隔离**：只查当前租户数据
- **数据权限**：按用户角色/部门限制可见范围
- **状态过滤**：默认只查“启用中/发布中”数据
- **地域限制**：按 region 限制可见范围

Global Scopes 的优势是：

- 统一规则
- 减少重复
- 强制默认行为

风险在于：

- 自动生效
- 隐式叠加
- 临时移除容易引发连带问题

### 2. Laravel 常见内置示例：SoftDeletes

Soft Delete 本身就是一个典型 Global Scope。

它的作用是：

- 默认不查 `deleted_at IS NULL` 以外的数据
- 通过 `withTrashed()` 恢复全部数据
- 通过 `onlyTrashed()` 只查已删除数据

可以理解为 Laravel 已经用实际案例说明：

**Global Scopes 适合做“默认行为”，同时提供“例外入口”。**

### 3. 多租户与数据权限的差异

在 B2C 后端项目里，多租户和数据权限经常被混在一起，但它们解决的问题不同。

**多租户（Multi-Tenancy）**

目标是：

- 不同租户数据严格隔离
- 请求上下文绑定 tenant_id
- 跨租户查询只在后台特定任务中允许

典型约束：

- `tenant_id` 几乎在所有业务表里都生效
- 查询必须默认带上 tenant 过滤
- 只有系统级任务或超级管理员才能绕过

**数据权限（Data Permissions）**

目标是：

- 同一租户内，不同角色/部门/用户能看到的数据范围不同
- 例如：普通员工只能看自己部门的数据
- 例如：区域经理能看自己大区的数据
- 例如：总部能看所有数据

两者的冲突经常来自：

- “去掉租户作用域”时，是否也把数据权限一起去掉
- “管理员视角”是否应该同时忽略租户和权限
- “统计查询”是否需要保留租户，但绕过部门权限

这些问题如果没有提前定义好，就一定会在中期爆发。

### 4. 作用域嵌套冲突的典型形态

在真实项目里，常见的嵌套冲突有以下几种：

**形态 A：移除作用域时范围过大**

开发者只想跳过 Soft Delete，结果用了 `withoutGlobalScopes()`，把租户和权限一并清掉。

**形态 B：绕过一个作用域后忘记恢复**

临时关闭权限作用域做统计查询，结果同一个请求后续查询继续受影响。

**形态 C：统计接口需要“部分保留”**

例如：

- 保留租户
- 保留 Soft Delete 历史
- 但去掉部门权限

这时就会发现，现有工具要么保留全部，要么清掉太多。

**形态 D：多处 Service 重复手工重建查询**

为了避免 Global Scope 副作用，有些开发者干脆在多个地方手动 `without()` 再手动补条件，很快就会变得不可维护。

**形态 E：事件触发与队列任务上下文不一致**

用户权限在 Web 请求里是明确的，但任务队列里当前用户不一定存在，于是数据权限作用域实现失败或被绕过。

这些形态的本质都一样：

> 没有在架构层定义清楚作用域的层级和例外规则。

## 实战代码（PHP/Laravel 为主）

下面用 Laravel 8 / Laravel 10+ 风格展示实战方案。

### 1. 基础模型：为作用域预留扩展点

先给模型设计一个“作用域上下文”习惯，不要把所有逻辑都硬写在 `apply()` 里。

```php
<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Order extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'tenant_id',
        'department_id',
        'customer_id',
        'status',
        'total_amount',
    ];

    protected static function booted(): void
    {
        // 这里可以按需注册事件
    }

    // 查询上下文默认从 Request 或 Resolver 读取
    protected function scopeContext(): array
    {
        return [
            'tenant_id' => tenant_id(),
            'department_id' => current_user_department_id(),
        ];
    }
}
```

为什么要单独抽 `scopeContext()`？

因为它让作用域的来源更清晰，后续容易：

- 做测试替身
- 在命令行任务里临时覆盖上下文
- 记录审计日志

### 2. Soft Delete + 多租户：避免误清租户条件

先做一个常见错误示例。

**错误做法：**

```php
// 只想绕过 Soft Delete，却把租户过滤也清掉了
<Order>::withoutGlobalScopes()->where('status', 'paid')->get();
```

这会产生越权风险。

**更安全的做法：指定要移除的作用域类型，保留租户约束**

```php
<?php

declare(strict_types=1);

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;
use Illuminate\Database\Eloquent\SoftDeletingScope;

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $context = $model->scopeContext();

        if ($context['tenant_id'] === null) {
            // 非租户上下文任务，不应直接放行；这里只是示例
            return;
        }

        $builder->where('tenant_id', $context['tenant_id']);
    }

    public function extend(Builder $builder): void
    {
        // 给模型加一个 fluent 方法：withoutTenant()
        $builder->macro('withoutTenant', function (Builder $builder) {
            return $builder->withoutGlobalScope(TenantScope::class);
        });
    }
}
```

接着在模型上注册：

```php
protected static function booted(): void
{
    static::addGlobalScope(new TenantScope());
}
```

这样查询时就可以“只移除租户”，不会误伤 Soft Delete。

```php
// 保留 Soft Delete 过滤，仅移除租户过滤
<Order>::withoutTenant()->where('status', 'paid')->get();
```

相比 `withoutGlobalScopes()`，这种写法更可控。

### 3. 数据权限作用域：避免“管理员绕过”失控

数据权限作用域是更容易出问题的地方。

常见问题：

- `withoutGlobalScope(DataPermissionScope::class)` 直接清掉权限
- 后续查询继续处于“无权限”状态
- 不同接口对“管理员是否跳过权限”定义不一致

**设计建议：**

- 不要把“是否跳过权限”写死在作用域里
- 用显式上下文变量控制，例如 `data_permission_bypass`
- 审计日志记录绕过动作

```php
<?php

declare(strict_types=1);

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class DataPermissionScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $context = $model->scopeContext();

        // 如果管理员临时进入“绕过模式”，不再强制过滤
        if (data_permission_bypass_enabled()) {
            return;
        }

        $departmentIds = resolve_visible_department_ids($context['department_id']);

        if (empty($departmentIds)) {
            // 无可见部门，直接返回空集，避免误放行
            $builder->whereRaw('1 = 0');
            return;
        }

        $builder->whereIn('department_id', $departmentIds);
    }

    public function extend(Builder $builder): void
    {
        $builder->macro('withoutDataPermission', function (Builder $builder) {
            return $builder->withoutGlobalScope(DataPermissionScope::class);
        });
    }
}
```

注意：

- 临时绕过权限不等于“无权限”
- 最好通过上下文容器控制，而不是让每个开发者自由 `without`

### 4. 真正推荐的解法：嵌套作用域键（nestedScopeKey）

Laravel 内置了按类型移除作用域的能力，但很多开发者只用到了 `withoutGlobalScope()`。

更推荐使用：

```php
// 只移除 Soft DeletingScope，保留租户和权限
$builder->withoutGlobalScope(SoftDeletingScope::class);
```

但如果业务场景更复杂，比如：

- 保留租户
- 去掉 Soft Delete
- 去掉部门权限

可以自己封装“作用域分组键”，让移除逻辑更清晰。

```php
<?php

declare(strict_types=1);

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;

final class ScopeKeys
{
    const SOFT_DELETE = 'soft_delete';
    const TENANT = 'tenant';
    const DATA_PERMISSION = 'data_permission';
    const STATUS_DEFAULT = 'status_default';

    public static function without(Builder $builder, string ...$keys): Builder
    {
        $map = [
            self::SOFT_DELETE => \Illuminate\Database\Eloquent\SoftDeletingScope::class,
            self::TENANT => TenantScope::class,
            self::DATA_PERMISSION => DataPermissionScope::class,
            self::STATUS_DEFAULT => DefaultStatusScope::class,
        ];

        foreach ($keys as $key) {
            if (!isset($map[$key])) {
                throw new \InvalidArgumentException("Unknown scope key: {$key}");
            }

            $builder->withoutGlobalScope($map[$key]);
        }

        return $builder;
    }
}
```

使用时会非常明确：

```php
// 后台统计：保留租户，去掉 Soft Delete，去掉部门权限
$orders = ScopeKeys::without(
    Order::query(),
    ScopeKeys::SOFT_DELETE,
    ScopeKeys::DATA_PERMISSION,
)->where('status', 'paid')
 ->get();
```

为什么这比“裸用 `withoutGlobalScope`”更好？

因为它把例外规则变成了**显式契约**。

团队新人看代码时，不需要猜“这行到底清掉了几个作用域”。

### 5. 用 when() 实现“条件式作用域”

很多时候不是要彻底移除作用域，而是“某条件下才应用”。

```php
$query = Order::query();

if (wants_all_deleted_data()) {
    $query->withoutGlobalScope(SoftDeletingScope::class);
}

if (is_system_admin_context()) {
    $query->withoutGlobalScope(DataPermissionScope::class);
}

$orders = $query->where('status', 'paid')->get();
```

这种方式比“默认移除 + 手动补条件”更好，因为：

- 默认状态更安全
- 绕过逻辑集中在入口处
- 便于审计

### 6. 手动重建查询：适用于“极特殊查询”

在报表、BI、财务对账这种接口里，最稳妥的做法往往不是频繁 `without`，而是“显式重建”。

例如：

```php
<?php

declare(strict_types=1);

namespace App\Queries;

use App\Models\Order;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletes;

final class OrderReportingQuery
{
    public function forTenantWithoutScope(string $tenantId): Builder
    {
        // 显式建新查询，不走模型默认作用域
        $query = Order::query()
            ->withoutGlobalScope(SoftDeletingScope::class)
            ->withoutGlobalScope(DataPermissionScope::class)
            ->where('tenant_id', $tenantId);

        return $query;
    }

    public function forDailyRevenue(string $tenantId, string $from, string $to): Builder
    {
        return $this->forTenantWithoutScope($tenantId)
            ->where('status', 'paid')
            ->whereBetween('created_at', [$from, $to]);
    }
}
```

为什么推荐这样写？

因为报表查询经常是“特殊权限 + 特殊条件 + 特殊聚合”混在一起。

如果藏在多个 Controller 或 Service 里，后期排查会非常痛苦。

### 7. 避免作用域污染：链式调用要小心作用域继承

Laravel 查询构建器的很多方法会“拷贝作用域”。

这意味着：

- `toBase()` 可以拿到基础 Builder
- `clone()` 可以复制当前查询
- `withoutGlobalScope()` 只作用于当前 Builder，不会改变原始模型默认行为

所以要特别注意：

```php
// 这样不会“污染”全局
$base = Order::query()->withoutGlobalScope(SoftDeletingScope::class)->toBase();

// 后续再用原模型查询，依然默认带作用域
$others = Order::where('status', 'refunded')->get();
```

但不要在共享 Builder 上做“临时去掉再补条件”，因为这很容易传播到后续逻辑。

### 8. 队列任务和命令行：上下文缺失是最大风险

Web 请求里，当前用户、租户、部门通常比较明确。

但在命令行和队列任务里，这些信息经常缺失。

如果 `DataPermissionScope` 直接读取 `Auth::id()`，可能直接失败。

**推荐做法：**

- 用 Resolver 抽象上下文来源
- Web 请求从 Request / Middleware 写入
- 队列任务从 job payload 显式传入
- 命令行通过参数或环境变量写入

示例：

```php
<?php

declare(strict_types=1);

namespace App\Scopes\Resolvers;

use App\Models\TenantContext;

final class DepartmentResolver
{
    public function resolve(): ?int
    {
        if (app()->runningInConsole()) {
            return data_get(app(TenantContext::class), 'department_id');
        }

        return current_user_department_id();
    }
}
```

这样可以避免：

- 任务里 `Auth::id()` 为空
- 权限作用域误判为“无权限”
- 批量任务误触 `whereRaw('1 = 0')`

## 踩坑记录

在 B2C API 项目里，这类问题我见过不少，总结几个最典型的坑。

### 坑 1：使用 withoutGlobalScopes() 清掉全部作用域

这是最常见的问题。

开发者只想“包含已删除记录”，结果写了：

```php
Order::withoutGlobalScopes()->withTrashed()->get();
```

风险：

- 租户条件没了
- 数据权限没了
- 默认状态过滤没了

正确做法：

```php
Order::withoutGlobalScope(SoftDeletingScope::class)
    ->withoutGlobalScope(DataPermissionScope::class)
    ->with('customer')
    ->get();
```

尽量别图方便“一键清空”。

### 坑 2：临时绕过权限后没有恢复

有些代码会这样写：

```php
app()->forbidden_scope_disabled = true;

$bigQuery = Order::query()->...

app()->forbidden_scope_disabled = false;
```

如果中间有异常或提前返回，权限就一直被关掉了。

更稳的做法：

```php
app()->forbidden_scope_disabled = true;

try {
    $orders = $bigQuery->get();
} finally {
    app()->forbidden_scope_disabled = false;
}
```

但即便如此，也推荐：

- 统计查询尽量单独建查询类
- 不要反复切换“权限开关”

### 坑 3：统计接口把“部门权限”与“租户权限”一起移除

有些统计需求是：

- 保留租户
- 移除部门权限

但实现时直接写了：

```php
Order::withoutGlobalScopes()->where('tenant_id', $tenantId)->get();
```

看起来“手动补了租户”，但其实：

- Soft Delete 规则丢了
- 状态过滤规则丢了
- 后续查询容易继续在异常上下文里执行

建议用分组键移除：

```php
ScopeKeys::without(Order::query(), ScopeKeys::DATA_PERMISSION)
    ->where('tenant_id', $tenantId)
    ->where('status', 'paid')
    ->get();
```

### 坑 4：模型方法里直接 without，导致后遗症

有人喜欢写这种工具方法：

```php
public static function includingDeleted()
{
    return static::withoutGlobalScope(SoftDeletingScope::class);
}
```

这本身没问题，但如果返回值被继续链式调用、传递、缓存，就可能影响后续逻辑。

更安全的写法是“明确作用域边界”：

```php
public static function queryIncludingDeleted(): Builder
{
    return static::query()->withoutGlobalScope(SoftDeletingScope::class);
}

public static function onlyDeleted(): Builder
{
    return static::onlyTrashed();
}
```

名字越清晰，滥用风险越低。

### 坑 5：全局 Scope 里做了太多事

有的开发者把模型过滤、权限判断、日志、指标统计、异常处理全塞进 Scope。

这会让测试变得很痛苦。

建议：

- Scope 只做查询约束
- 权限解析放 Resolver
- 审计放 Observer/Listener
- 指标放专门的 Recorder

### 坑 6：对“是否绕过权限”没有统一口径

不同接口自己决定“管理员是否跳过权限”，最后会出现：

- A 接口跳过
- B 接口不跳过
- C 接口部分跳过

用户会觉得系统行为不稳定，开发也很难维护。

正确做法是定义策略：

- 后台管理是否默认跳过
- 导出是否需要额外审批
- 报表是否按“租户管理员/总部管理员”分层
- API 对外是否绝对不跳过

把这些写成文档和中间件规则，不要散落在代码各处。

## 总结

Eloquent Global Scopes 的实战价值，不是“少写几行 SQL”，而是把模型默认行为统一收敛。

它在以下场景非常好用：

- Soft Delete
- 多租户隔离
- 数据权限
- 默认状态过滤

但它最容易翻车的地方，就是**多个作用域并存时的嵌套冲突**。

实战中最值得坚持的几个原则：

1. **优先用 `withoutGlobalScope(Class)`，不要随意用 `withoutGlobalScopes()`**
2. **把“哪些作用域可以绕过、绕过规则是什么”当成产品策略，而不是临时代码技巧**
3. **统计、对账、后台报表查询单独建类，不要到处临时绕作用域**
4. **用 Resolver 抽象租户和用户上下文，避免 Web/CLI/Queue 三端不一致**
5. **如果作用域组合越来越多，优先做 Scope Keys 分组，而不是到处裸移除**
6. **临时绕过权限要放在 try/finally 里，或者直接设计成独立查询上下文**

一句话总结：

**Global Scopes 管默认行为，`withoutGlobalScope()` 管例外边界，作用域策略决定系统安全。**

对于 Laravel B2C API 这类多租户、多权限、多角色的项目来说，Global Scopes 不是“可选优化项”，而是必须提前设计的架构规则。

把规则定清楚，后面业务再复杂，查询边界也不会乱。
