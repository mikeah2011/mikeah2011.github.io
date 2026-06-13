---
title: Laravel-Scopes-实战-查询作用域封装与复杂筛选条件复用踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-16 12:56:29
updated: 2026-05-16 12:58:01
categories:
  - php
tags: [Laravel, Eloquent, 查询优化, PHP, 数据库]
keywords: [Laravel, Scopes, 查询作用域封装与复杂筛选条件复用踩坑记录, PHP]
description: 在 B2C API 中，商品列表、订单查询、后台筛选几乎每个接口都在重复写 where/orderBy/with。Laravel Scopes（本地作用域 + 全局作用域）可以把查询逻辑封装进 Model，让 Controller 和 Service 变薄。本文从 30+ 仓库的真实踩坑出发，拆解 Local Scope、Global Scope、Dynamic Scope 的实战用法与陷阱。



---

# Laravel Scopes 实战：查询作用域封装与复杂筛选条件复用踩坑记录

在 B2C API 项目里，你一定见过这种代码——Controller 里 30 行 `if ($request->has('status'))` 拼查询条件，Service 层 `with()` 和 `orderBy()` 散落各处，同一个"上架商品"逻辑在 5 个接口重复写了 5 遍。改一处漏三处，是线上 bug 的温床。

Laravel 的 **Scopes（查询作用域）** 就是为解决这个问题而生的。但用不好，它也会制造全局污染、N+1、甚至 SQL 性能退化。本文从 30+ Laravel 仓库的真实踩坑出发，拆解 Local Scope、Global Scope、Dynamic Scope 的实战用法。

## 一、架构总览：Scopes 在查询层的位置

```
┌─────────────────────────────────────────────────────┐
│                   Controller / API                   │
│   $products = Product::active()                     │
│       ->inCategory($categoryId)                     │
│       ->priceRange($min, $max)                      │
│       ->sortBy($sort)                               │
│       ->paginate(20);                               │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│              Eloquent Model (Product)                │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Global Scope│  │ Local Scopes │  │  Dynamic   │  │
│  │(deleted_at) │  │ (active/     │  │  Scopes    │  │
│  │             │  │  inCategory) │  │ (sortBy)   │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                │                │         │
│         ▼                ▼                ▼         │
│  ┌──────────────────────────────────────────────┐   │
│  │            Query Builder                     │   │
│  │  WHERE deleted_at IS NULL                    │   │
│  │  AND is_active = 1                           │   │
│  │  AND category_id = ?                         │   │
│  │  AND price BETWEEN ? AND ?                   │   │
│  │  ORDER BY sold_count DESC                    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 二、Local Scope：最常用的查询复用

### 2.1 基本用法：scope + 方法名前缀

在 Model 中定义 `scope` 前缀的方法，Laravel 会自动识别为本地作用域：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    /**
     * 只查上架商品
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true)
                     ->where('approved_at', '<=', now());
    }

    /**
     * 按分类筛选
     */
    public function scopeInCategory(Builder $query, int $categoryId): Builder
    {
        return $query->where('category_id', $categoryId);
    }

    /**
     * 价格区间筛选
     */
    public function scopePriceRange(Builder $query, ?float $min, ?float $max): Builder
    {
        if ($min !== null) {
            $query->where('price', '>=', $min);
        }
        if ($max !== null) {
            $query->where('price', '<=', $max);
        }
        return $query;
    }

    /**
     * 排序（白名单校验，防 SQL 注入）
     */
    public function scopeSortBy(Builder $query, string $field = 'created_at', string $direction = 'desc'): Builder
    {
        $allowed = ['created_at', 'price', 'sold_count', 'rating'];
        if (!in_array($field, $allowed)) {
            $field = 'created_at';
        }
        return $query->orderBy($field, $direction);
    }
}
```

调用端代码变得极简：

```php
// Controller 里
$products = Product::active()
    ->inCategory($request->input('category_id'))
    ->priceRange($request->input('min_price'), $request->input('max_price'))
    ->sortBy($request->input('sort'), $request->input('direction', 'desc'))
    ->with(['category', 'mainImage'])
    ->paginate(20);
```

### 2.2 踩坑 #1：Scope 忘记 return $query

这是新手最常犯的错。如果 scope 方法没有 `return $query`，链式调用会断裂：

```php
// ❌ 错误写法 — 没有 return，后续链式调用失效
public function scopeActive(Builder $query): void
{
    $query->where('is_active', true);
    // 忘了 return $query;
}

// ✅ 正确写法
public function scopeActive(Builder $query): Builder
{
    return $query->where('is_active', true);
}
```

**教训**：在 CI 里加 PHPStan 规则检测 scope 方法的返回值类型。我们在 30+ 仓库推行后，这类 bug 降为零。

### 2.3 踩坑 #2：Scope 里调用了 count() 或 get()

Scope 只负责**拼条件**，不能触发查询执行：

```php
// ❌ 致命错误 — scope 里执行了查询
public function scopeHasStock(Builder $query): Builder
{
    $ids = Inventory::where('quantity', '>', 0)->pluck('product_id');
    return $query->whereIn('id', $ids);
}

// ✅ 正确做法 — 用子查询
public function scopeHasStock(Builder $query): Builder
{
    return $query->whereIn('id', function ($sub) {
        $sub->select('product_id')
            ->from('inventories')
            ->where('quantity', '>', 0);
    });
}
```

## 三、Global Scope：自动附加的查询条件

### 3.1 典型场景：软删除、多租户、数据权限

Laravel 自带的 `SoftDeletes` 就是 Global Scope 的经典应用。我们来看自定义实现：

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
        // 多租户：自动过滤当前商户的数据
        if ($tenantId = app('current_tenant_id')) {
            $builder->where($model->getTable() . '.tenant_id', $tenantId);
        }
    }
}
```

在 Model 中注册：

```php
class Order extends Model
{
    protected static function booted(): void
    {
        static::addGlobalScope(new TenantScope());
    }
}
```

### 3.2 踩坑 #3：Global Scope 导致 Admin 接口查不到数据

这是多租户项目里最经典的坑。Admin 后台需要查所有租户的数据，但 Global Scope 会自动过滤：

```php
// ❌ Admin 被 Global Scope 挡住了
$allOrders = Order::all(); // 只返回当前租户的订单

// ✅ 方法一：withoutGlobalScope 移除单个
$allOrders = Order::withoutGlobalScope(TenantScope::class)->get();

// ✅ 方法二：withoutGlobalScopes 移除全部
$allOrders = Order::withoutGlobalScopes()->get();

// ✅ 方法三：用 trait 标记 Admin Model 不注册 Global Scope
trait BelongsToTenant
{
    protected static function booted(): void
    {
        if (!static::class === AdminOrder::class) {
            static::addGlobalScope(new TenantScope());
        }
    }
}
```

**我们的最佳实践**：用 `withoutGlobalScope` 而不是条件判断。在 Admin 相关的 Repository 或 Service 里显式移除，比在 Scope 里判断角色更清晰。

### 3.3 踩坑 #4：Global Scope 影响关联查询性能

```php
// Global Scope 加了 where('tenant_id', $id)
// 导致 eager load 也带上了这个条件
$orders = Order::with('items.product')->get();

// 实际 SQL：
// SELECT * FROM order_items WHERE order_id IN (...)
//   AND tenant_id = 1  ← order_items 表没有 tenant_id 字段！
```

**解决方案**：在 Scope 里检查表名：

```php
public function apply(Builder $builder, Model $model): void
{
    if ($tenantId = app('current_tenant_id')) {
        // 只给有 tenant_id 字段的表加条件
        if (in_array('tenant_id', $model->getFillable()) 
            || $model->getConnection()->getSchemaBuilder()
                ->hasColumn($model->getTable(), 'tenant_id')) {
            $builder->where($model->getTable() . '.tenant_id', $tenantId);
        }
    }
}
```

## 四、Dynamic Scope：运行时传参的灵活作用域

### 4.1 带参数的 Local Scope 本身就是 Dynamic Scope

前面的 `scopeInCategory($categoryId)` 就是典型例子。这里讲一个更高级的用法——**条件式 Scope**：

```php
/**
 * 条件式 Scope：根据参数决定是否附加条件
 */
public function scopeFilter(Builder $query, array $filters): Builder
{
    return $query->when($filters['status'] ?? null, function ($q, $status) {
        $q->where('status', $status);
    })
    ->when($filters['keyword'] ?? null, function ($q, $keyword) {
        $q->where(function ($sub) use ($keyword) {
            $sub->where('name', 'like', "%{$keyword}%")
                ->orWhere('sku', 'like', "%{$keyword}%");
        });
    })
    ->when($filters['date_from'] ?? null, function ($q, $from) {
        $q->where('created_at', '>=', $from);
    })
    ->when($filters['date_to'] ?? null, function ($q, $to) {
        $q->where('created_at', '<=', $to);
    });
}
```

调用端：

```php
$products = Product::active()
    ->filter($request->only(['status', 'keyword', 'date_from', 'date_to']))
    ->paginate(20);
```

### 4.2 踩坑 #5：when() 的闭包参数顺序

```php
// ❌ 常见错误 — $value 参数位置写反
->when($request->input('status'), function ($query, $status) {
    // 这里是对的，但很多人写成 function ($status, $query)
    $query->where('status', $status);
})

// when() 的签名：when($value, $callback, $default = null)
// callback 的参数是：($query, $value)
```

## 五、Scope 组合与继承

### 5.1 用 Trait 组合可复用的 Scope

当多个 Model 共享相同的查询逻辑时，用 Trait 提取：

```php
<?php

namespace App\Models\Scopes;

use Illuminate\Database\Eloquent\Builder;

trait HasActiveScope
{
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true)
                     ->whereNull('deactivated_at');
    }

    public function scopeInactive(Builder $query): Builder
    {
        return $query->where('is_active', false)
                     ->orWhereNotNull('deactivated_at');
    }
}

trait HasSearchScope
{
    public function scopeSearch(Builder $query, ?string $keyword, array $columns = ['name']): Builder
    {
        if (empty($keyword)) {
            return $query;
        }
        return $query->where(function ($q) use ($keyword, $columns) {
            foreach ($columns as $column) {
                $q->orWhere($column, 'like', "%{$keyword}%");
            }
        });
    }
}
```

Model 里一行引入：

```php
class Product extends Model
{
    use HasActiveScope, HasSearchScope;

    protected $searchable = ['name', 'sku', 'description'];
}
```

### 5.2 踩坑 #6：Trait Scope 冲突

两个 Trait 都定义了 `scopeActive`，PHP 会报错。解决方案：用 `as` 别名：

```php
class Product extends Model
{
    use HasActiveScope {
        HasActiveScope::scopeActive as scopeProductActive;
    }
    use HasPromotionScope {
        HasPromotionScope::scopeActive as scopePromotionActive;
    }

    // 自己重写 scopeActive，组合两个逻辑
    public function scopeActive(Builder $query): Builder
    {
        return $query->scopeProductActive()
                     ->scopePromotionActive();
    }
}
```

## 六、实战案例：商品列表 API 的 Scope 设计

综合以上所有知识点，这是一个生产级的商品列表查询设计：

```php
<?php

namespace App\Models;

use App\Models\Scopes\HasActiveScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    use HasActiveScope;

    // ---- 关联 ----

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function variants(): HasMany
    {
        return $this->hasMany(ProductVariant::class);
    }

    // ---- Global Scope ----

    protected static function booted(): void
    {
        static::addGlobalScope('available', function (Builder $builder) {
            $builder->where('is_available', true);
        });
    }

    // ---- Local Scopes ----

    public function scopeInCategory(Builder $query, ?int $categoryId): Builder
    {
        return $query->when($categoryId, fn($q, $id) => $q->where('category_id', $id));
    }

    public function scopePriceBetween(Builder $query, ?float $min, ?float $max): Builder
    {
        return $query->when($min, fn($q, $v) => $q->where('price', '>=', $v))
                     ->when($max, fn($q, $v) => $q->where('price', '<=', $v));
    }

    public function scopeWithVariants(Builder $query): Builder
    {
        return $query->with(['variants' => function ($q) {
            $q->where('is_active', true)
              ->orderBy('sort_order');
        }]);
    }

    public function scopeSorted(Builder $query, string $sort = 'default'): Builder
    {
        return match ($sort) {
            'price_asc'  => $query->orderBy('price'),
            'price_desc' => $query->orderByDesc('price'),
            'sales'      => $query->orderByDesc('sold_count'),
            'newest'     => $query->orderByDesc('created_at'),
            'rating'     => $query->orderByDesc('avg_rating'),
            default      => $query->orderBy('sort_order')->orderByDesc('created_at'),
        };
    }

    public function scopeForList(Builder $query, array $params): Builder
    {
        return $query
            ->active()
            ->inCategory($params['category_id'] ?? null)
            ->priceBetween($params['min_price'] ?? null, $params['max_price'] ?? null)
            ->sorted($params['sort'] ?? 'default')
            ->select(['id', 'name', 'slug', 'price', 'original_price', 
                       'sold_count', 'avg_rating', 'main_image_url']);
    }
}
```

Controller 只需要一行：

```php
public function index(ProductListRequest $request): JsonResponse
{
    $products = Product::forList($request->validated())
        ->paginate($request->input('per_page', 20));

    return ProductResource::collection($products)->response();
}
```

## 七、性能注意事项

| 场景 | 问题 | 解决方案 |
|------|------|----------|
| Global Scope + eager load | 关联表没有租户字段报错 | Scope 里检查表是否有该字段 |
| Scope 里用 `whereIn` 大量 ID | 子查询性能差 | 改用 EXISTS 子查询 |
| 多个 Scope 叠加 | 重复 `where` 条件 | 用 `when()` 条件式添加 |
| Scope 里调用外部 API | 查询超时 | Scope 只做 SQL 拼接，外部数据提前获取 |

## 八、总结

| Scope 类型 | 适用场景 | 典型例子 |
|-----------|---------|---------|
| Local Scope | 复用查询条件 | `scopeActive()`、`scopeInCategory()` |
| Global Scope | 自动附加的全局过滤 | 软删除、多租户、数据权限 |
| Dynamic Scope | 运行时传参 | `scopeFilter($params)`、`scopeSorted($sort)` |

**核心原则**：Scope 只负责拼 SQL 条件，不执行查询、不做业务逻辑、不调外部服务。把这三条刻进团队规范，能避免 80% 的 Scope 相关 bug。

## 相关阅读

- [Laravel + PostgreSQL RLS 实战：多租户数据隔离、策略下推与连接池上下文踩坑记录](/categories/PHP/Laravel/laravel-postgresql-rls-guide/)
- [Laravel 缓存策略全解：Route/Config/View/Query 缓存最佳实践踩坑记录](/categories/PHP/Laravel/laravel-cache-route-config-view-query-cache/)
- [Laravel Casts & Accessors 实战：数据类型转换与计算属性踩坑记录](/categories/PHP/Laravel/laravel-casts-accessors-guide-data-types/)
