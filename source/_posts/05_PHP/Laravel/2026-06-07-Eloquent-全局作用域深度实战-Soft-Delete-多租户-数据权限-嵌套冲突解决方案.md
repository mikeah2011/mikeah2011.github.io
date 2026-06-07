---
title: 'Eloquent 全局作用域深度实战：Soft Delete、多租户、数据权限——全局作用域的嵌套冲突与解决方案'
description: '深入剖析 Laravel Eloquent 全局作用域原理与实战：从 SoftDeletes 源码到多租户隔离、数据权限控制，直面多个全局作用域嵌套冲突的核心问题，提供优先级管理、条件化作用域、Local Scope 组合等五大解决方案，附完整代码示例与调试技巧。'
date: 2026-06-07 20:06:28
tags: [Laravel, Eloquent, Global Scope, Soft Delete, 多租户, 数据权限]
categories: [PHP, Laravel]
cover: /images/covers/eloquent-global-scope-cover.jpg
---

在 Laravel 项目中，Eloquent ORM 的全局作用域（Global Scope）是一个极其强大但也容易引发混乱的特性。你可能在项目初期愉快地使用 `SoftDeletes` trait 来实现软删除，随后又加入了租户隔离的全局作用域，接着再叠加一层数据权限控制——然后你发现查询结果开始变得诡异：某个作用域悄悄覆盖了另一个，数据莫名丢失，调试半天也找不到原因。

这篇文章将从 Eloquent 全局作用域的底层原理出发，深入源码分析 `SoftDeletingScope` 的实现机制，然后逐步构建多租户隔离、数据权限控制等真实场景中的全局作用域，最后直面最棘手的问题——多个全局作用域的嵌套冲突，并给出一套经过实战检验的解决方案。无论你是刚开始接触 Laravel 的新手开发者，还是有丰富经验的全栈工程师，这篇文章都将为你提供深入且实用的指导。

---

## 一、Eloquent 全局作用域的原理

### 1.1 什么是全局作用域

全局作用域（Global Scope）是 Laravel 框架中一个非常精妙的设计模式。它的核心目的是让你能够在模型的所有查询上自动添加约束条件，而无需在每次查询时手动编写重复的过滤逻辑。当你定义了一个全局作用域并注册到模型后，无论是调用 `all()`、`find()`、`where()` 还是任何返回 Builder 的方法，都会自动带上这个作用域的约束。

从设计模式的角度来看，全局作用域本质上是一种装饰器模式的应用。它在不修改查询逻辑的前提下，为所有查询添加了统一的过滤条件。这种设计避免了代码重复，也降低了遗漏过滤条件导致数据泄露的风险。

### 1.2 Global Scope 接口与 apply 方法

让我们先看看 Laravel 源码中全局作用域的接口定义：

```php
// Illuminate\Database\Eloquent\GlobalScope
namespace Illuminate\Database\Eloquent;

use Closure;
use Illuminate\Database\Eloquent\Builder;

abstract class GlobalScope
{
    /**
     * 将作用域应用到给定的查询 Builder。
     *
     * @param  \Illuminate\Database\Eloquent\Builder  $builder
     * @return void
     */
    abstract public function apply(Builder $builder);

    /**
     * 此作用域是否应该被移除。
     *
     * @return bool
     */
    public function remove(Builder $builder)
    {
        return false;
    }

    /**
     * 获取此作用域的唯一标识符。
     *
     * @return string
     */
    public function getMacroName()
    {
        return static::class;
    }
}
```

每个全局作用域都必须实现 `apply` 方法，它接收一个 `Builder` 实例，在其中添加查询约束。核心思想非常简单：你拿到 Builder，往上面加 `where`、`whereNull` 或其他约束，返回即可。

需要注意的是 `remove` 方法，它的默认返回值是 `false`，表示该作用域不可被移除。而 `SoftDeletingScope` 重写了这个方法返回 `true`，这使得它可以通过 `withoutGlobalScope()` 来移除。这是全局作用域设计中一个非常重要的细节。

`getMacroName` 方法返回作用域的唯一标识符，默认使用类的完整命名空间作为标识符。对于匿名作用域，你传入的字符串键名就是标识符。理解标识符的工作方式对于后续的冲突解决至关重要。

### 1.3 作用域的注册与执行流程

在模型中通过 `booted` 静态方法注册全局作用域：

```php
// App\Models\Post
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\GlobalScope;

class Post extends Model
{
    protected static function booted(): void
    {
        // 方式一：注册自定义全局作用域类
        static::addGlobalScope(new TenantScope);

        // 方式二：注册匿名作用域
        static::addGlobalScope('active', function (Builder $builder) {
            $builder->where('is_active', true);
        });
    }
}
```

当你调用 `Post::all()` 时，Eloquent 的执行流程如下：

1. `Model::newQuery()` 创建一个新的查询 Builder 实例
2. 框架自动调用 `applyScopes()` 方法
3. 遍历模型上所有已注册的全局作用域
4. 对每个作用域调用其 `apply(Builder $builder)` 方法，或者直接执行注册的闭包
5. 返回带有所有全局约束条件的 Builder

关键源码位于 `Illuminate\Database\Eloquent\Builder` 的 `applyScopes` 方法中：

```php
// Illuminate\Database\Eloquent\Builder
public function applyScopes()
{
    if (! $this->scopes) {
        return $this;
    }

    $builder = clone $this;

    foreach ($this->scopes as $identifier => $scope) {
        $builder->applyScope($scope, $identifier);
    }

    return $builder;
}

public function applyScope($scope, $scopeIdentifier)
{
    // 如果作用域是一个类实例
    if (is_object($scope)) {
        // 检查该作用域是否应该被移除
        if (isset($this->removedScopes[$scopeIdentifier])) {
            return;
        }
        $scope->apply($this, $this->getModel());
    } else {
        // 如果是闭包，直接执行
        $scope($this, $this->getModel());
    }
}
```

这段代码揭示了一个关键细节：`removedScopes` 数组用于跟踪被显式移除的作用域，这正是 `without()` 方法的底层机制。当一个作用域被标记为已移除后，即使它仍然存在于 `$scopes` 数组中，`applyScope` 方法也会跳过它的执行。这种设计允许我们在不修改 `$scopes` 数组结构的前提下，精确控制哪些作用域被应用。

另外值得注意的是，`applyScopes` 方法会先对 Builder 进行克隆操作（`clone $this`），这意味着全局作用域的应用不会影响原始的 Builder 实例。这是一个重要的不可变性保障，确保了链式调用中的安全行为。

### 1.4 作用域的移除机制

移除全局作用域是解决冲突的基础手段。以下是 Builder 中移除作用域的源码实现：

```php
// Illuminate\Database\Eloquent\Builder
public function withoutGlobalScopes($scopes = null)
{
    if (is_array($scopes)) {
        foreach ($scopes as $scope) {
            $this->removeScope($scope);
        }
    } elseif (is_null($scopes)) {
        $this->removedScopes = $this->scopes;
    } else {
        $this->removeScope($scopes);
    }

    return $this;
}

public function removeScope($scope)
{
    $scopeClass = $this->getGlobalScope($scope);

    unset($this->scopes[$scopeClass]);

    $this->removedScopes[] = $scopeClass;

    return $this;
}
```

这段代码告诉我们：移除作用域本质上是将其从 `$scopes` 数组中删除，并记录到 `$removedScopes` 中，以防止后续的 `applyScopes` 再次应用它。`withoutGlobalScopes` 方法支持三种调用方式：传入数组批量移除、传入 `null` 移除所有作用域、传入单个作用域标识符移除指定作用域。

理解这个移除机制非常重要，因为后续我们在处理多作用域冲突时，会频繁使用这些方法来精确控制每个查询的行为。

---

## 二、Soft Delete 的实现机制深度剖析

### 2.1 SoftDeletes Trait 源码分析

`SoftDeletes` 是 Laravel 中最经典的全局作用域实现，理解它的工作原理是掌握全局作用域的关键。Laravel 团队在设计这个特性时，不仅考虑了软删除本身的功能实现，还通过全局作用域机制确保了全局一致的行为。

```php
// Illuminate\Database\Eloquent\SoftDeletes
namespace Illuminate\Database\Eloquent;

trait SoftDeletes
{
    // 是否启用软删除功能
    protected $softDelete = true;

    /**
     * 获取已配置的全局作用域。
     */
    public static function bootSoftDeletes(): void
    {
        static::addGlobalScope(new SoftDeletingScope);
    }

    /**
     * 执行软删除操作。
     */
    public function forceDelete()
    {
        // ... 逻辑省略
    }

    /**
     * 恢复已软删除的模型。
     */
    public function restore()
    {
        // ... 逻辑省略
    }

    /**
     * 确定模型是否已被软删除。
     */
    public function trashed(): bool
    {
        return ! is_null($this->deleted_at);
    }

    /**
     * 创建一个新的查询 Builder，自动移除软删除作用域。
     */
    public function newModelQuery()
    {
        return $this->newQuery()->withoutGlobalScope(SoftDeletingScope::class);
    }
}
```

注意 `newModelQuery` 方法——它在创建新的查询 Builder 时自动移除了 `SoftDeletingScope`。这是为了在 `restore()` 等操作中能够查询到已删除的记录。如果没有这个设计，当你尝试恢复一个已删除的模型时，模型的查询方法会因为全局作用域的存在而找不到那条记录，导致恢复操作失败。

这个设计模式非常值得借鉴——当你需要在模型的某些内部操作中绕过全局作用域时，`newModelQuery` 是一个经过验证的可靠方式。

### 2.2 SoftDeletingScope 源码详解

这是全局作用域的核心实现，也是 Laravel 框架中全局作用域最佳实践的典范：

```php
// Illuminate\Database\Eloquent\SoftDeletingScope
namespace Illuminate\Database\Eloquent;

class SoftDeletingScope implements GlobalScope
{
    /**
     * 所有可移除的扩展方法名称列表。
     */
    protected $extensions = [
        'Restore',
        'ForceDelete',
        'Trashed',
        'OnlyTrashed',
        'WithoutTrashed',
    ];

    /**
     * 将作用域应用到给定的查询 Builder。
     */
    public function apply(Builder $builder, Model $model)
    {
        $builder->whereNull($model->getQualifiedDeletedAtColumn());
    }

    /**
     * 移除此作用域并添加所有扩展方法到 Builder 上。
     */
    public function remove(Builder $builder, Model $model)
    {
        $this->removeSoftDeletes($builder, $model);
        $this->addRestore($builder);
        $this->addForceDelete($builder);
        $this->addTrashed($builder);
        $this->addOnlyTrashed($builder);
        $this->addWithoutTrashed($builder);
    }

    protected function removeSoftDeletes(Builder $builder, Model $model)
    {
        $builder->withoutGlobalScope($this);
    }

    // ... 其他扩展方法的添加逻辑
}
```

`apply` 方法只做了一件事：添加 `WHERE deleted_at IS NULL` 约束。这意味着所有查询默认只返回未删除的记录，从而实现了数据的逻辑隔离。

更有趣的是 `remove` 方法。当你调用 `withoutGlobalScope(SoftDeletingScope::class)` 时，框架不仅移除了这个全局作用域，还会通过 `remove` 方法在 Builder 上注册一系列宏方法。这就是 `withTrashed()`、`onlyTrashed()`、`restore()` 等方法的来源——它们并不是 `Builder` 类本身的方法，而是在移除全局作用域时动态注册的。

### 2.3 withoutTrashed / onlyTrashed / withTrashed 的区别

这三个方法是理解软删除查询行为的关键，它们之间的差异虽然看似细微，但在实际应用中却会导致完全不同的查询结果：

```php
// 1. withoutTrashed() - 显式排除已删除记录（默认行为）
Post::withoutTrashed()->get();
// 生成 SQL: SELECT * FROM posts WHERE deleted_at IS NULL

// 2. onlyTrashed() - 只查询已删除记录
Post::onlyTrashed()->get();
// 生成 SQL: SELECT * FROM posts WHERE deleted_at IS NOT NULL

// 3. withTrashed() - 包含已删除记录（移除全局作用域约束）
Post::withTrashed()->get();
// 生成 SQL: SELECT * FROM posts
// （没有任何 deleted_at 相关的过滤条件）
```

让我们看看 `withoutTrashed` 方法的内部实现：

```php
// Illuminate\Database\Eloquent\SoftScope
protected function addWithoutTrashed(Builder $builder)
{
    $builder->macro('withoutTrashed', function (Builder $builder) {
        return $builder->withoutGlobalScope(SoftDeletingScope::class);
    });
}
```

`withoutTrashed` 的实现本质上是移除 `SoftDeletingScope`，因此它返回的结果与默认查询完全一致。它的存在更多是为了代码的语义清晰性——当你写 `Post::withoutTrashed()->get()` 时，阅读代码的人一眼就能明白查询意图。

而 `onlyTrashed` 的实现则不同，它不仅是移除全局作用域，还额外添加了 `WHERE deleted_at IS NOT NULL` 的条件，从而只返回被软删除的记录。

**核心区别总结：**

| 方法 | 作用 | 生成的 SQL |
|------|------|-----------|
| 默认查询 | 过滤已删除记录 | `WHERE deleted_at IS NULL` |
| `withTrashed()` | 移除全局作用域，包含所有记录 | 无 `deleted_at` 条件 |
| `withoutTrashed()` | 显式排除已删除记录（与默认一致） | `WHERE deleted_at IS NULL` |
| `onlyTrashed()` | 只查询已删除记录 | `WHERE deleted_at IS NOT NULL` |

---

## 三、多租户场景下的全局作用域

### 3.1 场景描述

在 SaaS 应用中，多租户数据隔离是最基本也是最重要的需求。假设我们有一个多租户的 SaaS 平台，多个企业共用同一套系统，但每个企业的数据必须严格隔离。如果一个企业不小心看到了另一个企业的订单或客户数据，那将是一场灾难。

传统的做法是在每个查询中手动添加 `tenant_id` 的过滤条件，但这不仅容易遗漏，而且在大型项目中维护成本极高。全局作用域提供了优雅的解决方案——通过自动过滤租户数据，确保开发者永远不需要记住手动添加租户过滤条件。

### 3.2 租户作用域的完整实现

首先定义一个租户上下文服务，用于在请求生命周期内维护当前租户信息：

```php
// App\Services\TenantContext
namespace App\Services;

class TenantContext
{
    protected static ?int $tenantId = null;

    /**
     * 设置当前租户标识。
     */
    public static function setTenantId(int $tenantId): void
    {
        static::$tenantId = $tenantId;
    }

    /**
     * 获取当前租户标识。
     */
    public static function getTenantId(): ?int
    {
        return static::$tenantId;
    }

    /**
     * 清除当前租户上下文。
     * 通常在请求结束后或测试清理时调用。
     */
    public static function forget(): void
    {
        static::$tenantId = null;
    }

    /**
     * 判断是否已设置租户上下文。
     */
    public static function hasTenant(): bool
    {
        return static::$tenantId !== null;
    }
}
```

然后创建租户全局作用域：

```php
// App\Scopes\TenantScope
namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\GlobalScope;
use App\Services\TenantContext;

class TenantScope extends GlobalScope
{
    public function apply(Builder $builder, Model $model)
    {
        $tenantId = TenantContext::getTenantId();

        if (is_null($tenantId)) {
            // 未设置租户上下文时抛出异常，防止无过滤查询
            throw new \RuntimeException('未设置当前租户上下文，无法执行查询。');
        }

        // 使用 qualifyColumn 确保在 JOIN 查询时列名不会产生歧义
        $builder->where($model->qualifyColumn('tenant_id'), $tenantId);
    }
}
```

在模型中注册：

```php
// App\Models\Order
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use App\Scopes\TenantScope;

class Order extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        static::addGlobalScope(new TenantScope);
    }
}
```

在中间件中设置租户上下文：

```php
// App\Http\Middleware\SetTenantContext
namespace App\Http\Middleware;

use Closure;
use App\Services\TenantContext;
use Illuminate\Http\Request;

class SetTenantContext
{
    public function handle(Request $request, Closure $next)
    {
        $tenantId = $request->user()?->tenant_id;

        if ($tenantId) {
            TenantContext::setTenantId($tenantId);
        }

        $response = $next($request);

        // 请求结束后清理租户上下文
        TenantContext::forget();

        return $response;
    }
}
```

之后所有模型查询都会自动过滤当前租户的数据：

```php
// 所有查询自动带上租户过滤
$orders = Order::all();
// SQL: SELECT * FROM orders WHERE deleted_at IS NULL AND tenant_id = 42

$order = Order::find(1);
// SQL: SELECT * FROM orders WHERE id = 1 AND deleted_at IS NULL AND tenant_id = 42

$recentOrders = Order::where('created_at', '>=', now()->subDays(7))->get();
// SQL: SELECT * FROM orders WHERE created_at >= '2026-05-31' AND deleted_at IS NULL AND tenant_id = 42
```

### 3.3 多租户作用域的注意事项

在实际项目中使用租户全局作用域时，有几个关键问题需要注意：

**跨租户数据迁移**：当你需要进行跨租户的数据迁移或批量操作时，需要临时移除租户作用域。建议为此提供专门的服务方法：

```php
class TenantAwareModel
{
    /**
     * 创建一个不受租户隔离限制的查询 Builder。
     * 仅用于管理后台的数据迁移和批量操作。
     */
    public static function queryForMigration(): \Illuminate\Database\Eloquent\Builder
    {
        return static::withoutGlobalScope(TenantScope::class);
    }
}
```

**关联查询中的作用域传递**：全局作用域会自动应用到关联查询中，这意味着当你通过 `Order::find(1)->items` 查询关联数据时，`items` 表也需要有 `tenant_id` 字段并注册了租户作用域，否则关联查询可能失败。

---

## 四、数据权限控制（基于用户角色过滤数据）

### 4.1 场景描述

在很多企业级应用中，不同角色的用户看到的数据范围截然不同。例如在一个项目管理系统中：普通员工只能看到自己参与的项目，部门经理可以看到本部门所有项目的数据，而系统管理员则拥有查看所有项目数据的权限。

这种细粒度的数据权限控制，如果在每个查询中手动实现，代码量和维护成本将不可想象。全局作用域恰好能优雅地解决这个问题。

### 4.2 数据权限作用域的完整实现

```php
// App\Scopes\RoleScope
namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\GlobalScope;
use Illuminate\Support\Facades\Auth;

class RoleScope extends GlobalScope
{
    public function apply(Builder $builder, Model $model)
    {
        $user = Auth::user();

        if (! $user) {
            // 未登录用户，返回空结果
            $builder->whereRaw('1 = 0');
            return;
        }

        if ($user->isAdmin()) {
            // 系统管理员：不添加任何额外过滤条件
            return;
        }

        if ($user->isManager()) {
            // 部门经理：可以看到本部门所有数据
            $builder->where('department_id', $user->department_id);
            return;
        }

        // 普通员工：只能查看自己创建或参与的数据
        $builder->where(function (Builder $query) use ($user) {
            $query->where('created_by', $user->id)
                ->orWhere('assigned_to', $user->id);
        });
    }
}
```

在模型中同时注册多个全局作用域：

```php
class Article extends Model
{
    protected static function booted(): void
    {
        static::addGlobalScope(new TenantScope);    // 租户隔离
        static::addGlobalScope(new RoleScope);      // 角色权限
        static::addGlobalScope('active', function (Builder $builder) {
            $builder->where('is_active', true);     // 只看活跃文章
        });
    }
}
```

### 4.3 查询时的效果演示

```php
// 假设当前用户是部门经理，属于部门 3，租户 ID 为 42
$articles = Article::all();
// SQL: SELECT * FROM articles
//      WHERE deleted_at IS NULL
//      AND tenant_id = 42
//      AND department_id = 3
//      AND is_active = true

// 如果当前用户是系统管理员
// SQL: SELECT * FROM articles
//      WHERE deleted_at IS NULL
//      AND tenant_id = 42
//      AND is_active = true
//      （没有 department_id 的限制，可以看到所有部门的文章）
```

---

## 五、全局作用域的嵌套冲突问题

这是本文最核心也最实用的部分。当多个全局作用域叠加使用时，它们之间会产生各种微妙的冲突，而这些冲突往往是导致查询结果异常的罪魁祸首。

### 5.1 冲突场景一：条件化作用域被默认覆盖

这是最常见的问题。考虑一个使用了 `SoftDeletes` 和自定义状态过滤作用域的模型：

```php
class Post extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        // 注册一个自定义作用域，默认只显示已发布文章
        static::addGlobalScope('published', function (Builder $builder) {
            $builder->where('status', 'published');
        });
    }
}
```

当你需要查询所有状态（包括草稿）但排除已删除记录时，你可能会这样写：

```php
// 想要：查询所有状态的文章（包括草稿），但排除已删除的
$posts = Post::withoutGlobalScope('published')->get();
// 实际 SQL: SELECT * FROM posts WHERE deleted_at IS NULL
// ✓ 正确！移除了 published 作用域，SoftDeletes 仍然生效
```

看起来没问题？但问题在于以下场景：

```php
// 想要：查询所有文章（包括已删除的），但只看 published 状态
$posts = Post::withTrashed()->where('status', 'published')->get();
// 实际 SQL: SELECT * FROM posts WHERE status = 'published'
// ❌ 错误！SoftDeletes 被移除了，published 作用域还在
// 结果包含了已删除的 published 文章，这不是期望的行为
```

这个冲突的根源在于：`withTrashed()` 移除了整个 `SoftDeletingScope`，但它没有提供"只添加 deleted_at 过滤条件而不移除其他作用域"的机制。开发者期望的是"移除 deleted_at IS NULL 的过滤，但保留其他所有约束"，但实际行为是"移除整个全局作用域"。

### 5.2 冲突场景二：作用域标识符不匹配

考虑一个更隐蔽的问题——当闭包作用域和类作用域混合使用时，标识符的管理变得格外混乱：

```php
class Product extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        static::addGlobalScope(new TenantScope);
        static::addGlobalScope('active', function (Builder $builder) {
            $builder->where('is_active', true);
        });
    }
}

class ProductService
{
    public function getInactiveProducts(): Collection
    {
        // 想要：移除 active 作用域，但仍保持租户隔离
        return Product::withoutGlobalScope('active')->get();
    }
}
```

这段代码在大多数情况下能正常工作，但问题在于：如果你的团队成员在其他地方重新注册了同名但不同行为的作用域，或者闭包的注册名称被意外修改，`withoutGlobalScope` 就会静默失败。这种故障非常难以排查，因为查询不会报错，只是返回的结果不对。

更安全的做法是使用类作用域并用类名作为标识符：

```php
class ActiveScope extends GlobalScope
{
    public function apply(Builder $builder, Model $model)
    {
        $builder->where('is_active', true);
    }
}

// 在模型中注册
static::addGlobalScope(new ActiveScope);

// 移除时使用类名，编译器可以检查
Product::withoutGlobalScope(ActiveScope::class)->get();
```

### 5.3 冲突场景三：作用域链的意外断裂

在自定义 Builder 宏方法中，作用域的管理需要格外小心：

```php
// 自定义 Builder 方法中移除了全局作用域
Builder::macro('withStatus', function ($status) {
    return $this->withoutGlobalScope('active')
        ->where('status', $status);
});

// 使用时
$posts = Post::withStatus('draft')->get();
// SQL: SELECT * FROM posts WHERE deleted_at IS NULL AND status = 'draft'
// ✓ OK，active 被移除了，SoftDeletes 还在

// 但如果链式调用中还有其他作用域移除
$posts = Post::withStatus('draft')
    ->withoutGlobalScope(TenantScope::class)
    ->get();
// SQL: SELECT * FROM posts WHERE status = 'draft'
// ❌ 两个作用域都被移除了，数据隔离完全被破坏！
```

这种问题在团队协作的大型项目中尤其常见。一个开发者在某个 Service 方法中移除了租户作用域来执行跨租户的统计查询，但这个方法后来被其他开发者在普通的列表页面中调用，结果导致了数据泄露。

### 5.4 冲突场景四：子查询中的作用域泄漏

全局作用域会自动应用到子查询中，这在某些场景下是期望的行为，但在其他场景下可能导致性能问题或逻辑错误：

```php
class Comment extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        static::addGlobalScope(new TenantScope);
        static::addGlobalScope(new ActiveScope);
    }
}

// 当在 Post 模型中使用关联查询时
$post->comments();  // 自动带有 TenantScope 和 ActiveScope 约束
```

如果你在一个已经设置了租户上下文的请求中查询关联数据，这个行为是正确的。但如果你在命令行任务中需要跨租户查询评论数据，就需要手动移除这些作用域，否则会漏掉大量数据。

---

## 六、解决方案：全局作用域的嵌套冲突处理

### 6.1 方案一：使用 newModelQuery 方法隔离内部查询

这是 Laravel 官方推荐的方式，`SoftDeletes` trait 就是这样实现的。它的核心思想是为模型的内部操作提供一个不受全局作用域影响的查询入口：

```php
class Order extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        static::addGlobalScope(new TenantScope);
        static::addGlobalScope(new RoleScope);
    }

    /**
     * 创建一个不受权限作用域限制的查询 Builder。
     * 用于管理后台的数据查询和跨租户操作。
     */
    public static function queryAsAdmin(): \Illuminate\Database\Eloquent\Builder
    {
        return static::withoutGlobalScope(RoleScope::class);
    }

    /**
     * 创建一个完全不受全局作用域限制的查询 Builder。
     * 仅用于数据迁移和维护操作。
     */
    public static function queryUnrestricted(): \Illuminate\Database\Eloquent\Builder
    {
        return static::withoutGlobalScopes();
    }
}
```

这种方式的优点是语义清晰、使用安全。调用者通过方法名就能明确知道查询是否绕过了全局作用域。

### 6.2 方案二：定义作用域的优先级

Eloquent 本身不提供显式的优先级机制，但我们可以设计一套自己的优先级系统：

```php
// App\Contracts\ScopedWithPriority
namespace App\Contracts;

interface ScopedWithPriority
{
    /**
     * 返回作用域优先级（数字越小优先级越高，越不容易被移除）。
     *
     * 优先级划分建议：
     * 1-20: 安全层（租户隔离、数据加密），绝不允许移除
     * 21-50: 基础层（软删除、基础过滤），仅特殊场景可移除
     * 51-80: 业务层（状态过滤、排序），灵活控制
     * 81-100: 展示层（分页、列表优化），完全灵活
     */
    public function getPriority(): int;
}

// 在管理器中使用优先级
class ScopeManager
{
    /**
     * 根据优先级安全地移除作用域。
     * 低优先级的作用域无法被移除高优先级的作用域。
     */
    public static function safeRemove(
        Builder $builder,
        string $scopeClass,
        int $minPriorityToOverride = 51
    ): Builder {
        $scope = $builder->getGlobalScope($scopeClass);

        if ($scope instanceof ScopedWithPriority &&
            $scope->getPriority() < $minPriorityToOverride) {
            throw new \RuntimeException(
                "无法移除高优先级作用域 {$scopeClass}（优先级：" .
                $scope->getPriority() . "）"
            );
        }

        return $builder->withoutGlobalScope($scopeClass);
    }
}
```

### 6.3 方案三：条件化全局作用域

通过条件判断来动态决定是否应用某个作用域，这是解决运行时冲突的利器：

```php
class ConditionalScope extends GlobalScope
{
    protected $condition;

    public function __construct(callable $condition)
    {
        $this->condition = $condition;
    }

    public function apply(Builder $builder, Model $model)
    {
        if (call_user_func($this->condition, $model)) {
            $builder->where('is_active', true);
        }
    }
}

// 在模型中使用条件作用域
class Order extends Model
{
    protected static function booted(): void
    {
        // 根据运行环境决定是否应用租户隔离
        static::addGlobalScope(new ConditionalScope(function () {
            return ! app()->runningInConsole();
        }));

        // 根据用户角色决定是否应用权限过滤
        static::addGlobalScope(new ConditionalScope(function () {
            return Auth::check() && ! Auth::user()->isAdmin();
        }));
    }
}
```

更实用的做法是通过配置文件来控制作用域的行为：

```php
class ConfigurableTenantScope extends GlobalScope
{
    public function apply(Builder $builder, Model $model)
    {
        // 检查配置是否启用了租户隔离
        if (! config('app.tenant_isolation_enabled', true)) {
            return;
        }

        $tenantId = TenantContext::getTenantId();
        if ($tenantId) {
            $builder->where('tenant_id', $tenantId);
        }
    }
}
```

### 6.4 方案四：手动全局作用域管理器

创建一个集中管理所有全局作用域的服务，提供统一的启用、禁用和配置接口：

```php
// App\Services\ScopeManager
namespace App\Services;

use Illuminate\Database\Eloquent\Builder;

class ScopeManager
{
    protected array $disabledScopes = [];

    /**
     * 禁用指定的作用域。
     */
    public function disable(string $scopeClass): self
    {
        $this->disabledScopes[$scopeClass] = true;
        return $this;
    }

    /**
     * 恢复指定的作用域。
     */
    public function enable(string $scopeClass): self
    {
        unset($this->disabledScopes[$scopeClass]);
        return $this;
    }

    /**
     * 将配置应用到 Builder 上。
     */
    public function applyTo(Builder $builder): Builder
    {
        foreach ($this->disabledScopes as $scopeClass => $_) {
            $builder->withoutGlobalScope($scopeClass);
        }
        return $builder;
    }

    /**
     * 临时移除所有作用域并执行回调，回调结束后恢复原状。
     */
    public function withoutAll(callable $callback): mixed
    {
        $original = $this->disabledScopes;

        // 通过请求级别的标记来实现
        app()->bind('scope.manager.disabled', true);
        $result = $callback();
        app()->forget('scope.manager.disabled');

        $this->disabledScopes = $original;
        return $result;
    }
}
```

在 Service Provider 中注册并预配置：

```php
// App\Providers\AppServiceProvider
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Services\ScopeManager;
use App\Scopes\RoleScope;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(ScopeManager::class, function ($app) {
            $manager = new ScopeManager();

            // 根据用户角色预配置
            if (auth()->check() && auth()->user()->isAdmin()) {
                $manager->disable(RoleScope::class);
            }

            return $manager;
        });
    }
}
```

使用方式：

```php
// 在控制器或服务中使用
$manager = app(ScopeManager::class);
$orders = $manager->disable(TenantScope::class)
    ->applyTo(Order::query())
    ->get();

// 或者在需要完全绕过作用域的场景
$allOrders = $manager->withoutAll(function () {
    return Order::all();
});
```

### 6.5 方案五：使用 Local Scope 进行精确控制

Local Scope（本地作用域）和 Global Scope 的组合使用是解决冲突的最灵活方案。Local Scope 的优势在于它是显式的、可选的，不会产生隐式的副作用：

```php
class Article extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        // 全局作用域：租户隔离（所有查询必须遵守）
        static::addGlobalScope(new TenantScope);
        // 全局作用域：活跃状态（默认只看活跃文章）
        static::addGlobalScope('active', function (Builder $builder) {
            $builder->where('is_active', true);
        });
    }

    // Local Scope：按需使用的灵活查询条件

    /**
     * 只看已发布的文章。
     */
    public function scopeOnlyPublished(Builder $query): Builder
    {
        return $query->where('status', 'published');
    }

    /**
     * 查看所有状态的文章（移除 active 作用域）。
     */
    public function scopeWithAllStatus(Builder $query): Builder
    {
        return $query->withoutGlobalScope('active');
    }

    /**
     * 管理员查看（绕过角色权限作用域）。
     */
    public function scopeAsAdmin(Builder $query): Builder
    {
        return $query->withoutGlobalScope(RoleScope::class);
    }

    /**
     * 查看草稿和已发布的文章。
     */
    public function scopeWithDrafts(Builder $query): Builder
    {
        return $query->withoutGlobalScope('active')
            ->whereIn('status', ['draft', 'published']);
    }

    /**
     * 按时间排序。
     */
    public function scopeLatestFirst(Builder $query): Builder
    {
        return $query->orderBy('created_at', 'desc');
    }
}
```

使用示例：

```php
// 正常查询：租户隔离 + 活跃状态
$articles = Article::all();

// 查看所有状态的文章（但仍受租户隔离）
$articles = Article::withAllStatus()->get();

// 管理员查看所有文章（绕过角色权限，但仍受租户隔离）
$articles = Article::asAdmin()->get();

// 灵活的链式组合
$articles = Article::asAdmin()
    ->withAllStatus()
    ->onlyPublished()
    ->latestFirst()
    ->paginate(20);
```

---

## 七、全局作用域 vs Local Scope：对比与最佳实践

### 7.1 特性对比

| 特性 | Global Scope | Local Scope |
|------|-------------|-------------|
| 作用范围 | 所有查询自动生效 | 显式调用时才生效 |
| 注册方式 | `addGlobalScope()` | `scope` 前缀的方法 |
| 移除方式 | `withoutGlobalScope()` | 不调用即可 |
| 适用场景 | 数据隔离、安全过滤 | 灵活查询条件 |
| 调试难度 | 较高（隐式行为难追踪） | 较低（显式调用易定位） |
| 组合灵活性 | 低（需要手动管理冲突） | 高（自由链式调用） |
| 维护成本 | 中等（需要统一管理） | 低（局部作用域独立） |

### 7.2 什么时候使用 Global Scope

Global Scope 适用于以下场景——在这些场景中，**每个查询都必须遵守相同的约束**，遗漏约束会导致严重后果：

```php
// ✓ 数据租户隔离——每个查询都必须过滤，遗漏将导致数据泄露
class TenantScope extends GlobalScope { ... }

// ✓ 软删除——Laravel 内置机制，每个查询默认排除已删除记录
class SoftDeletingScope extends GlobalScope { ... }

// ✓ 安全过滤——防止泄露敏感数据，必须全局生效
class SensitiveDataScope extends GlobalScope { ... }
```

### 7.3 什么时候使用 Local Scope

Local Scope 适用于以下场景——这些条件是**按需使用的**，不同的页面或业务逻辑可能需要不同的过滤组合：

```php
// ✓ 业务查询条件——不同场景需要不同状态
public function scopeRecent(Builder $query, int $days = 30)
{
    return $query->where('created_at', '>=', now()->subDays($days));
}

// ✓ 状态过滤——管理后台需要查看所有状态
public function scopePublished(Builder $query)
{
    return $query->where('status', 'published');
}

// ✓ 复杂组合查询——不同模块有不同的查询需求
public function scopeForDashboard(Builder $query)
{
    return $query->where('is_featured', true)
        ->where('created_at', '>=', now()->subWeek());
}
```

### 7.4 组合使用的最佳模式

将安全和隔离相关的约束作为全局作用域，将业务查询条件作为本地作用域，形成层次分明的查询体系：

```php
class Order extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        // 全局作用域：安全和隔离（所有查询必须遵守的核心约束）
        static::addGlobalScope(new TenantScope);
        static::addGlobalScope(new SecurityScope);
    }

    // Local Scope：业务查询条件（灵活组合，按需使用）
    public function scopePending(Builder $query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeThisWeek(Builder $query)
    {
        return $query->where('created_at', '>=', now()->startOfWeek());
    }

    public function scopeForUser(Builder $query, User $user)
    {
        if ($user->isAdmin()) {
            return $query;
        }
        return $query->where('created_by', $user->id);
    }

    public function scopeHighValue(Builder $query, float $minAmount = 10000)
    {
        return $query->where('total_amount', '>=', $minAmount);
    }
}

// 使用示例：灵活组合本地作用域
$pendingOrders = Order::pending()
    ->thisWeek()
    ->highValue()
    ->forUser(Auth::user())
    ->get();
```

---

## 八、实战中的高级技巧与调试

### 8.1 在 Service Provider 中批量注册作用域

对于需要租户隔离的模型，可以在服务提供者中集中注册，避免每个模型都重复编写：

```php
// App\Providers\EloquentServiceProvider
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Scopes\{TenantScope, ActiveScope};

class EloquentServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $tenantModels = [
            \App\Models\Order::class,
            \App\Models\Article::class,
            \App\Models\Comment::class,
            \App\Models\Customer::class,
        ];

        foreach ($tenantModels as $model) {
            $model::addGlobalScope(new TenantScope);
        }

        // 需要活跃状态过滤的模型
        $activeModels = [
            \App\Models\Article::class,
            \App\Models\Product::class,
        ];

        foreach ($activeModels as $model) {
            $model::addGlobalScope(new ActiveScope);
        }
    }
}
```

### 8.2 使用明确的标识符管理作用域

为匿名作用域提供清晰的字符串标识符，便于后续的移除操作：

```php
class Order extends Model
{
    protected static function booted(): void
    {
        // 使用明确的字符串标识符
        static::addGlobalScope('tenant', function (Builder $builder) {
            $builder->where('tenant_id', TenantContext::getTenantId());
        });

        static::addGlobalScope('active', function (Builder $builder) {
            $builder->where('is_active', true);
        });

        static::addGlobalScope('sortable', function (Builder $builder) {
            $builder->orderBy('created_at', 'desc');
        });
    }
}

// 移除时使用相同的标识符
$orders = Order::withoutGlobalScope('active')->get();
```

### 8.3 全局作用域调试技巧

当查询结果不符合预期时，可以使用以下方法快速定位问题：

```php
// 方法一：查看 Builder 上注册的所有作用域
$builder = Order::query();
$scopes = $builder->getScopes();
ray($scopes); // 或 dd($scopes);

// 方法二：获取最终生成的 SQL 语句
$query = Order::all();
ray($query->toRawSql());

// 方法三：对比有无全局作用域的查询结果
$withScopes = Order::all();
$withoutScopes = Order::withoutGlobalScopes()->get();
ray('有作用域:', $withScopes->count());
ray('无作用域:', $withoutScopes->count());

// 方法四：查看已移除的作用域列表
$builder = Order::withoutGlobalScope('active');
ray($builder->getRemovedScopes());

// 方法五：监听 SQL 查询日志
DB::listen(function ($query) {
    ray($query->sql, $query->bindings, $query->time);
});
```

### 8.4 在测试中管理全局作用域

测试时需要精确控制全局作用域的行为：

```php
class OrderTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // 每个测试前设置租户上下文
        TenantContext::setTenantId(1);
    }

    protected function tearDown(): void
    {
        // 每个测试后清理租户上下文
        TenantContext::forget();
        parent::tearDown();
    }

    public function test_admin_can_see_all_orders(): void
    {
        // 在测试中临时移除所有权限作用域
        $orders = Order::withoutGlobalScope(RoleScope::class)
            ->withoutGlobalScope(TenantScope::class)
            ->get();

        $this->assertCount(10, $orders);
    }

    public function test_user_can_only_see_own_orders(): void
    {
        // 正常应用所有全局作用域
        $orders = Order::all();

        // 断言只返回当前用户的订单
        $this->assertTrue(
            $orders->every('created_by', Auth::id())
        );
    }
}
```

---

## 九、总结

Eloquent 全局作用域是一个强大的设计工具——用得好，它能让你的代码简洁优雅，数据隔离水到渠成；用得不好，它会让查询行为变得不可预测，调试起来令人抓狂。

回顾全文，我们可以总结出以下核心原则：

**最小化全局作用域**：只在真正需要"所有查询都自动过滤"的场景使用全局作用域，例如租户隔离和软删除。其他场景优先使用 Local Scope，因为本地作用域是显式的、可控的。

**明确标识符**：始终为全局作用域提供清晰的标识符——类作用域使用类名作为标识符，闭包作用域使用有意义的字符串键名。这能大幅降低后续管理的复杂度。

**分层设计**：将全局作用域分为"不可绕过的安全层"（如租户隔离）和"可绕过的业务层"（如角色权限），通过不同的移除策略来管理。

**提供管理入口**：为需要绕过全局作用域的场景提供显式的管理方法（如 `queryAsAdmin()`），而不是让开发者直接调用 `withoutGlobalScope()`，这样代码意图更清晰，也更容易追踪。

**善用 newModelQuery**：参考 `SoftDeletes` 的实现模式，在 `newModelQuery()` 中根据需要管理作用域的移除和恢复，为模型的内部操作提供安全的查询入口。

**调试优先**：遇到查询异常时，先用 `withoutGlobalScopes()` 排除作用域的干扰来定位问题，确认是全局作用域导致的后再逐步排查具体是哪个作用域的行为不符合预期。

全局作用域不是万能的，但在理解了它的原理和陷阱之后，它可以成为构建健壮 Laravel 应用的坚实基础。希望这篇文章能帮助你在实际项目中更自信地使用全局作用域，避免常见的坑，写出更高质量的代码。

---

## 相关阅读

- [Laravel Context 实战：请求级上下文传播、日志关联、队列透传与多租户标识的统一治理](/categories/PHP/Laravel/2026-06-06-Laravel-Context-实战-请求级上下文传播-日志关联-队列透传与多租户标识的统一治理/)
- [Laravel Pennant 2.x 进阶实战：自定义 Driver、Feature 分组与租户级灰度策略](/categories/PHP/Laravel/2026-06-05-laravel-pennant-2x-custom-driver-feature-groups-tenant-grayscale/)
- [Laravel Observer vs Event Listener 选型决策：afterCommit、事务边界与队列化监听](/categories/PHP/Laravel/Laravel-Observer-vs-Event-Listener-选型决策-afterCommit事务边界队列化监听/)
