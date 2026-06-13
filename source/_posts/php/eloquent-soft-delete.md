---
title: Eloquent 全局作用域深度实战：Soft Delete、多租户、数据权限——全局作用域的嵌套冲突与解决方案
keywords: [Eloquent, Soft Delete, 全局作用域深度实战, 多租户, 数据权限, 全局作用域的嵌套冲突与解决方案, PHP]
date: 2026-06-09 06:20:00
categories:
  - php
tags:
  - Laravel
  - Eloquent
  - Global Scopes
  - 多租户
  - 软删除
description: 深入 Laravel Eloquent 全局作用域机制，实战 Soft Delete 原理、多租户隔离、数据权限控制，以及多个全局作用域嵌套时的冲突排查与解决方案。
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200
---


## 前言

Laravel 的 Eloquent 全局作用域（Global Scopes）是一个强大但容易被低估的特性。它允许你在所有查询中自动附加条件，最常见的例子就是 `SoftDeletes`——每次查询自动加上 `WHERE deleted_at IS NULL`。

但当你在实际项目中叠加多个全局作用域时，事情会变得复杂：多租户需要 `WHERE tenant_id = ?`，数据权限需要 `WHERE department_id IN (...)`，再加上软删除，三个作用域同时生效时，冲突、遗漏、性能问题接踵而至。

这篇文章从源码层面拆解全局作用域的工作机制，给出多租户和数据权限的实战实现，最后重点解决多作用域嵌套冲突的问题。

## 全局作用域的工作机制

### 注册流程

全局作用域通过模型的 `booted()` 方法或 trait 的 `bootXxx()` 方法注册：

```php
// 方法一：在模型中直接注册
class Order extends Model
{
    protected static function booted(): void
    {
        static::addGlobalScope(new ActiveScope());
    }
}

// 方法二：通过 trait 注册（推荐）
trait HasTenant
{
    protected static function bootHasTenant(): void
    {
        static::addGlobalScope(new TenantScope());
    }
}
```

### 底层执行流程

当 Eloquent 构建查询时，`Illuminate\Database\Eloquent\Builder::applyScopes()` 会遍历所有已注册的全局作用域并调用其 `apply()` 方法：

```php
// Illuminate\Database\Eloquent\Builder
public function applyScopes()
{
    if (! $this->scopes) {
        return $this;
    }

    $builder = clone $this;

    foreach ($this->scopes as $identifier => $scope) {
        $scope->apply($builder, $this->getModel());

        // 每个 scope 修改的是同一个 $builder 实例
        // 这就是冲突的根源
    }

    return $builder;
}
```

关键点：所有作用域按注册顺序依次 `apply` 到同一个 Builder 实例上。如果两个作用域都调用了 `where()`，条件会叠加（AND）；如果都调用了 `select()`，后面的会覆盖前面的。

### 源码中的注册与移除

```php
// Illuminate\Database\Eloquent\Concerns\HasGlobalScopes
public static function addGlobalScope(Scope $scope): Scope
{
    static::$globalScopes[static::class][get_class($scope)] = $scope;
    return $scope;
}

public static function withoutGlobalScope($scope): static
{
    unset(static::$globalScopes[static::class][$scope]);
    return new static;
}
```

注意 `globalScopes` 是静态属性，以 `scope 类名` 作为 key。这意味着同一个作用域类只能注册一次，不会重复添加。

## 实战一：Soft Delete 源码剖析

`SoftDeletes` 是最经典的全局作用域实现，理解它的代码能帮你掌握作用域的完整生命周期。

### trait 结构

```php
trait SoftDeletes
{
    // boot 时注册全局作用域
    protected static function bootSoftDeletes(): void
    {
        static::addGlobalScope(new SoftDeletingScope);
    }

    // 作用域对象
    // class SoftDeletingScope implements Scope
    // {
    //     public function apply(Builder $builder, Model $model): void
    //     {
    //         $builder->whereNull($model->getQualifiedDeletedAtColumn());
    //     }
    // }

    // 软删除：设置 deleted_at
    public function runSoftDelete(): void
    {
        $query = $this->newModelQuery()->where($this->getKeyName(), $this->getKey());
        $this->{$this->getDeletedAtColumn()} = $now = $this->freshTimestamp();
        $query->update([$this->getDeletedAtColumn() => $this->fromDateTime($now)]);
    }

    // 恢复
    public function restore(): bool
    {
        $this->{$this->getDeletedAtColumn()} = null;
        $this->save();

        $this->fireModelEvent('restored', false);
        return true;
    }

    // 查找已删除的记录
    public static function withTrashed(): static
    {
        return static::withoutGlobalScope(SoftDeletingScope::class);
    }

    // 只查已删除的
    public static function onlyTrashed(): static
    {
        return static::withoutGlobalScope(SoftDeletingScope::class)
            ->whereNotNull((new static)->getQualifiedDeletedAtColumn());
    }
}
```

### 常见坑：withTrashed 后作用域不恢复

```php
// ❌ 错误：withTrashed 返回新 Builder，原模型的全局作用域不受影响
$users = User::withTrashed()->where('status', 'active')->get();
// 这里查出的是所有 status=active 的用户（含已删除）

// ✅ 正确：局部使用 withTrashed
User::withoutGlobalScope(SoftDeletingScope::class)
    ->onlyTrashed()
    ->where('status', 'active')
    ->get();

// 更简洁
User::onlyTrashed()->where('status', 'active')->get();
```

## 实战二：多租户全局作用域

### 基础实现

```php
<?php

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        if ($tenantId = app('currentTenant')) {
            $builder->where($model->getTable() . '.tenant_id', $tenantId);
        }
    }
}
```

```php
<?php

namespace App\Models\Concerns;

use App\Scopes\TenantScope;

trait HasTenant
{
    protected static function bootHasTenant(): void
    {
        static::addGlobalScope(new TenantScope());

        // 自动设置 tenant_id
        static::creating(function ($model) {
            if (! $model->tenant_id && $tenantId = app('currentTenant')) {
                $model->tenant_id = $tenantId;
            }
        });
    }
}
```

### 进阶：多字段租户隔离

实际项目中，租户隔离往往不只是一个 `tenant_id`，可能还有 `app_id`、`channel_id` 等多维度：

```php
class MultiTenantScope implements Scope
{
    protected array $tenantFields = ['tenant_id'];

    public function __construct(array $fields = ['tenant_id'])
    {
        $this->tenantFields = $fields;
    }

    public function apply(Builder $builder, Model $model): void
    {
        $table = $model->getTable();

        foreach ($this->tenantFields as $field) {
            if ($model->isFillable($field)) {
                $value = app("current_{$field}");
                if ($value !== null) {
                    $builder->where("{$table}.{$field}", $value);
                }
            }
        }
    }
}
```

### 跳过租户过滤的场景

```php
// 管理后台：需要查看所有租户的数据
Order::withoutGlobalScope(TenantScope::class)->get();

// 指定某个租户（用于数据迁移、报表等）
Order::withoutGlobalScope(TenantScope::class)
    ->where('tenant_id', 5)
    ->get();
```

## 实战三：数据权限控制

### 基于部门的数据权限

```php
<?php

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;
use App\Enums\DataPermissionType;

class DataPermissionScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $user = auth()->user();
        if (! $user || $user->is_admin) {
            return; // 管理员不过滤
        }

        $table = $model->getTable();

        switch ($user->data_permission_type) {
            case DataPermissionType::ALL:
                // 全部数据，不加条件
                break;

            case DataPermissionType::DEPARTMENT:
                // 本部门数据
                $builder->where("{$table}.department_id", $user->department_id);
                break;

            case DataPermissionType::DEPARTMENT_AND_CHILDREN:
                // 本部门及下级部门
                $departmentIds = $this->getDepartmentAndChildren($user->department_id);
                $builder->whereIn("{$table}.department_id", $departmentIds);
                break;

            case DataPermissionType::SELF:
                // 仅本人数据
                $builder->where("{$table}.created_by", $user->id);
                break;
        }
    }

    protected function getDepartmentAndChildren(int $parentId): array
    {
        return cache()->remember(
            "departments_tree_{$parentId}",
            3600,
            fn () => Department::where('parent_id', $parentId)
                ->pluck('id')
                ->push($parentId)
                ->toArray()
        );
    }
}
```

## 核心问题：多作用域嵌套冲突

当一个模型同时使用 `SoftDeletes`、`HasTenant`、数据权限三个 trait 时，三个全局作用域都会生效。问题来了：

### 冲突一：条件被意外跳过

```php
class Order extends Model
{
    use SoftDeletes, HasTenant, HasDataPermission;
}

// 执行查询
Order::all();
// 实际 SQL: SELECT * FROM orders WHERE deleted_at IS NULL AND tenant_id = 1 AND department_id IN (1,2,3)
// 看起来没问题
```

但当你调用 `withoutGlobalScope` 时：

```php
// 期望：只跳过软删除，保留租户和数据权限
Order::withTrashed()->get();

// 实际：withTrashed 内部调用了 withoutGlobalScope(SoftDeletingScope::class)
// 返回一个新的 Builder，但这个 Builder 仍然有其他全局作用域
// 这是正确的行为，但如果你自定义的作用域也用了类似模式...
```

### 冲突二：select 覆盖

```php
class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        // ❌ 错误：这会覆盖模型自己设置的 select
        $builder->select('*')->where('tenant_id', app('currentTenant'));
    }
}

class DataPermissionScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        // ❌ 同样错误
        $builder->select('*')->whereIn('department_id', $ids);
    }
}

// 最终 select 只保留最后一个 scope 的 select('*')
// 如果模型有 selectSpecificColumns() 之类的，也会被覆盖
```

**解决方案：作用域中永远不要调用 `select()`，只用 `where` 条件。**

### 冲突三：子查询中的作用域泄漏

```php
// 场景：统计每个部门的订单数
Order::select('department_id', DB::raw('COUNT(*) as total'))
    ->groupBy('department_id')
    ->get();

// 这里租户作用域会生效，但数据权限作用域也会加上 department_id 条件
// 导致结果只包含当前用户有权查看的部门，而不是所有部门
```

这在后台管理报表中是常见需求——管理员需要查看全局数据，但作用域把数据过滤了。

### 解决方案一：withGlobalScope 的作用域注册表模式

```php
<?php

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class ConditionalScope implements Scope
{
    protected string $scopeClass;
    protected ?string $condition;

    public function __construct(string $scopeClass, ?string $condition = null)
    {
        $this->scopeClass = $scopeClass;
        $this->condition = $condition;
    }

    public function apply(Builder $builder, Model $model): void
    {
        // 检查条件，决定是否应用
        if ($this->shouldApply()) {
            app($this->scopeClass)->apply($builder, $model);
        }
    }

    protected function shouldApply(): bool
    {
        if ($this->condition === null) {
            return true;
        }

        return match ($this->condition) {
            'tenant' => app('currentTenant') !== null,
            'data_permission' => !optional(auth()->user())->is_admin,
            default => true,
        };
    }
}
```

### 解决方案二：作用域优先级排序

```php
<?php

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

interface PrioritizedScope extends Scope
{
    public function priority(): int;
}
```

```php
class TenantScope implements PrioritizedScope
{
    public function priority(): int
    {
        return 10; // 最高优先级，必须先执行
    }

    public function apply(Builder $builder, Model $model): void
    {
        $builder->where($model->getTable() . '.tenant_id', app('currentTenant'));
    }
}

class DataPermissionScope implements PrioritizedScope
{
    public function priority(): int
    {
        return 20; // 在租户之后
    }

    public function apply(Builder $builder, Model $model): void
    {
        // 数据权限逻辑
    }
}
```

然后在模型 boot 时按优先级注册：

```php
trait HasOrderedScopes
{
    protected static function bootHasOrderedScopes(): void
    {
        // 不直接在 boot 中 addGlobalScope
        // 而是收集后排序
    }

    // 在 Builder 的 applyScopes 中注入排序逻辑
}
```

这个方案需要重写 `applyScopes`，侵入性较强，但能彻底控制执行顺序。

### 解决方案三：条件式作用域（推荐）

最实用的方案——让作用域自己判断是否应该生效：

```php
<?php

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        // 只在明确有租户上下文时才生效
        if (! app()->bound('currentTenant')) {
            return;
        }

        $tenantId = app('currentTenant');
        if ($tenantId === null) {
            return;
        }

        $builder->where($model->getTable() . '.tenant_id', $tenantId);
    }
}
```

```php
class DataPermissionScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $user = auth()->user();
        if (! $user || $user->is_admin) {
            return;
        }

        // 只在非管理后台路由中生效
        if (request()->is('admin/*') && request()->routeIs('admin.reports.*')) {
            return;
        }

        // 应用权限条件
        $this->applyPermissionFilter($builder, $model, $user);
    }

    protected function applyPermissionFilter(Builder $builder, Model $model, $user): void
    {
        $table = $model->getTable();

        if ($model->isFillable('department_id')) {
            $builder->whereIn("{$table}.department_id", $user->accessibleDepartmentIds());
        }

        if ($model->isFillable('created_by')) {
            $builder->orWhere("{$table}.created_by", $user->id);
        }
    }
}
```

### 解决方案四：使用 withoutGlobalScopes 批量移除

```php
// 场景：后台报表，需要无过滤的原始数据
Order::withoutGlobalScopes()->get();

// 场景：只保留租户过滤，移除其他
Order::withoutGlobalScopes([DataPermissionScope::class])->get();

// 场景：联表查询时，主表保留作用域，关联表跳过
Order::with(['items' => fn ($q) => $q->withoutGlobalScope(TenantScope::class)])
    ->get();
```

## 高级场景：多租户 + 软删除 + 关联查询

### 关联查询中的作用域传播

```php
// Order 模型
class Order extends Model
{
    use SoftDeletes, HasTenant;

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }
}

// OrderItem 也有 HasTenant
class OrderItem extends Model
{
    use SoftDeletes, HasTenant;
}

// 查询
Order::with('items')->get();
```

这里有个隐含问题：`items` 关联查询会自动带上 `OrderItem` 的全局作用域（租户 + 软删除），但关联条件 `WHERE order_id IN (...)` 是 Laravel 自动加的。三个 WHERE 条件叠加，SQL 是正确的。

但如果 `OrderItem` 没有 `HasTenant` trait，关联查询就不会过滤租户——这是安全隐患。

**解决方案：在关联中显式添加条件**

```php
public function items(): HasMany
{
    return $this->hasMany(OrderItem::class)
        ->where('tenant_id', app('currentTenant'));
}
```

但这会在租户作用域之外再加一个条件，导致重复。更好的方案是确保所有需要租户隔离的模型都统一使用 trait。

### 关联查询中临时移除作用域

```php
// 场景：需要查所有租户下的订单项（跨租户报表）
Order::where('id', 1)
    ->items()
    ->withoutGlobalScope(TenantScope::class)
    ->get();

// 或者在 with 中
Order::with(['items' => fn ($q) => $q->withoutGlobalScope(TenantScope::class)])
    ->where('id', 1)
    ->get();
```

## 性能考量

### 索引设计

多个全局作用域的 WHERE 条件会叠加，确保数据库有对应的复合索引：

```sql
-- 租户 + 软删除的复合索引
CREATE INDEX idx_orders_tenant_deleted ON orders (tenant_id, deleted_at);

-- 租户 + 部门 + 软删除
CREATE INDEX idx_orders_tenant_dept_deleted ON orders (tenant_id, department_id, deleted_at);
```

### 作用域中的 N+1 问题

```php
// ❌ 错误：在作用域中做关联查询
class DataPermissionScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $user = auth()->user();
        // 每次查询都执行一次部门查询
        $departmentIds = Department::where('parent_id', $user->department_id)->pluck('id');
        $builder->whereIn('department_id', $departmentIds);
    }
}

// ✅ 正确：使用缓存
class DataPermissionScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $user = auth()->user();
        $departmentIds = cache()->remember(
            "user_{$user->id}_departments",
            300,
            fn () => $user->accessibleDepartmentIds()
        );
        $builder->whereIn('department_id', $departmentIds);
    }
}
```

## 测试策略

### 单元测试作用域

```php
<?php

namespace Tests\Unit\Scopes;

use App\Scopes\TenantScope;
use App\Models\Order;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_filters_by_tenant(): void
    {
        $this->app->instance('currentTenant', 1);

        Order::factory()->create(['tenant_id' => 1]);
        Order::factory()->create(['tenant_id' => 2]);

        $orders = Order::all();

        $this->assertCount(1, $orders);
        $this->assertEquals(1, $orders->first()->tenant_id);
    }

    public function test_it_can_be_removed(): void
    {
        $this->app->instance('currentTenant', 1);

        Order::factory()->create(['tenant_id' => 1]);
        Order::factory()->create(['tenant_id' => 2]);

        $orders = Order::withoutGlobalScope(TenantScope::class)->get();

        $this->assertCount(2, $orders);
    }

    public function test_it_does_nothing_without_tenant(): void
    {
        // 没有设置 currentTenant
        Order::factory()->create(['tenant_id' => 1]);
        Order::factory()->create(['tenant_id' => 2]);

        $orders = Order::all();

        $this->assertCount(2, $orders);
    }
}
```

### 多作用域叠加测试

```php
public function test_multiple_scopes_apply_correctly(): void
{
    $this->app->instance('currentTenant', 1);
    $this->actingAs(User::factory()->create([
        'is_admin' => false,
        'department_id' => 10,
    ]));

    // 创建测试数据
    Order::factory()->create(['tenant_id' => 1, 'department_id' => 10, 'deleted_at' => null]);
    Order::factory()->create(['tenant_id' => 1, 'department_id' => 20, 'deleted_at' => null]);
    Order::factory()->create(['tenant_id' => 2, 'department_id' => 10, 'deleted_at' => null]);
    Order::factory()->create(['tenant_id' => 1, 'department_id' => 10, 'deleted_at' => now()]);

    $orders = Order::all();

    // 只返回 tenant_id=1 AND department_id=10 AND deleted_at IS NULL
    $this->assertCount(1, $orders);
    $this->assertEquals(10, $orders->first()->department_id);
}
```

## 总结

全局作用域是 Laravel Eloquent 中实现数据隔离的利器，但要注意：

1. **作用域中不要用 `select()`**，只用 `where` 条件，避免覆盖冲突
2. **条件式判断**比无条件应用更安全——检查租户上下文、用户角色等再决定是否加条件
3. **`withoutGlobalScope` 返回新 Builder**，不会影响原模型的注册
4. **关联查询的作用域会自动传播**，确保关联模型也注册了相同的作用域
5. **复合索引**要跟上，多个 `where` 条件叠加时索引设计很关键
6. **测试必须覆盖多作用域叠加场景**，单独测试一个作用域通过不代表组合也正确

实际项目中，建议将全局作用域限制在 2-3 个以内。如果需要更多过滤条件，考虑使用本地作用域（Local Scopes）或 Repository 模式，保持查询逻辑的可控性。
