---
title: Laravel Query Builder Debug 实战：toRawSql/dd 的高级用法——复杂查询的 SQL 溯源、绑定参数可视化与性能分析
keywords: [Laravel Query Builder Debug, toRawSql, dd, SQL, 的高级用法, 复杂查询的, 溯源, 绑定参数可视化与性能分析, PHP]
date: 2026-06-10 01:09:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Query Builder
  - Debug
  - SQL
  - 性能分析
description: 深入 Laravel Query Builder 的调试技巧，涵盖 toRawSql、dd、DB::listen 等工具的高级用法，解决复杂查询的 SQL 溯源、绑定参数可视化与性能分析问题。
---


# Laravel Query Builder Debug 实战：toRawSql/dd 的高级用法

## 概述

在 Laravel 开发中，我们经常遇到这样的场景：

- Eloquent 查询返回了意外结果，想知道实际执行的 SQL 是什么
- 复杂的 `where` 嵌套、子查询、JOIN 语句，想确认生成的 SQL 是否符合预期
- 慢查询排查，需要看到完整的绑定参数替换后的 SQL
- 多条件动态查询，想验证条件是否正确拼接

Laravel 提供了多种调试 Query Builder 的方式，但很多开发者只停留在 `->toSql()` 这一层。本文将深入讲解 `toRawSql()`、`dd()`、`DB::listen()` 等工具的高级用法，并结合实际案例展示如何在复杂查询场景中高效溯源 SQL。

## 核心概念

### toSql() vs toRawSql() vs dd()

这三个方法是 Query Builder 调试的核心三件套，但它们的行为差异很大：

| 方法 | 输出 | 绑定参数 | 是否终止执行 |
|------|------|----------|-------------|
| `toSql()` | 带 `?` 占位符的 SQL | 单独在 `getBindings()` 中 | 否 |
| `toRawSql()` | 完整替换绑定参数的 SQL | 已内联到 SQL 中 | 否 |
| `dd()` | 完整替换绑定参数的 SQL | 已内联到 SQL 中 | 是（dump & die） |

**关键区别：** `toSql()` 返回的 SQL 字符串中绑定参数是 `?` 占位符，你需要手动调用 `getBindings()` 才能看到实际值。而 `toRawSql()` 直接返回参数替换后的完整 SQL，调试时更直观。

```php
// toSql() —— 需要手动拼接绑定参数
$sql = User::where('status', 'active')
    ->where('created_at', '>', '2026-01-01')
    ->toSql();
// SELECT * FROM users WHERE status = ? AND created_at > ?
$bindings = User::where('status', 'active')
    ->where('created_at', '>', '2026-01-01')
    ->getBindings();
// ["active", "2026-01-01"]

// toRawSql() —— 一步到位
$rawSql = User::where('status', 'active')
    ->where('created_at', '>', '2026-01-01')
    ->toRawSql();
// SELECT * FROM users WHERE status = 'active' AND created_at > '2026-01-01'
```

### 为什么 toRawSql() 更适合调试？

1. **可读性**：直接看到完整 SQL，不需要脑内替换 `?`
2. **可复制**：拿到的 SQL 可以直接粘贴到 MySQL 客户端执行
3. **防遗漏**：绑定参数多的时候，`toSql()` + `getBindings()` 容易对不上号

## 实战代码

### 场景一：复杂嵌套 WHERE 的 SQL 溯源

实际业务中，查询条件往往是动态拼接的，嵌套层级很深：

```php
$query = Order::query()
    ->where('shop_id', $shopId)
    ->where(function ($q) use ($keyword, $status) {
        $q->where('order_no', 'like', "%{$keyword}%")
          ->orWhere('customer_name', 'like', "%{$keyword}%");
    })
    ->where(function ($q) use ($status) {
        if ($status === 'pending') {
            $q->where('payment_status', 'unpaid')
              ->where('created_at', '>', now()->subDays(7));
        } elseif ($status === 'completed') {
            $q->where('payment_status', 'paid')
              ->where('shipped_at', '!=', null);
        }
    })
    ->orderBy('created_at', 'desc');

// 调试：直接看生成的 SQL
dd($query->toRawSql());
```

输出结果类似：

```sql
SELECT * FROM orders WHERE shop_id = 123 AND (order_no LIKE '%test%' OR customer_name LIKE '%test%') AND (payment_status = 'unpaid' AND created_at > '2026-06-03 01:09:00') ORDER BY created_at DESC
```

这样你就能一眼看出嵌套条件是否正确闭合，`OR` 和 `AND` 的优先级是否符合预期。

### 场景二：JOIN + 子查询的绑定参数可视化

多表关联查询是绑定参数出错的重灾区：

```php
$orders = Order::query()
    ->select('orders.*', 'users.name as customer_name', 'products.title as product_title')
    ->join('users', 'users.id', '=', 'orders.user_id')
    ->join('order_items', 'order_items.order_id', '=', 'orders.id')
    ->join('products', 'products.id', '=', 'order_items.product_id')
    ->where('orders.shop_id', $shopId)
    ->where('orders.status', 'paid')
    ->where('products.category_id', $categoryId)
    ->where('orders.created_at', '>=', $startDate)
    ->where('orders.created_at', '<=', $endDate)
    ->groupBy('orders.id')
    ->havingRaw('COUNT(order_items.id) > ?', [3])
    ->orderBy('orders.total_amount', 'desc');

dd($orders->toRawSql());
```

输出：

```sql
SELECT orders.*, users.name as customer_name, products.title as product_title FROM orders INNER JOIN users ON users.id = orders.user_id INNER JOIN order_items ON order_items.order_id = orders.id INNER JOIN products ON products.id = order_items.product_id WHERE orders.shop_id = 456 AND orders.status = 'paid' AND products.category_id = 789 AND orders.created_at >= '2026-06-01 00:00:00' AND orders.created_at <= '2026-06-10 23:59:59' GROUP BY orders.id HAVING COUNT(order_items.id) > 3 ORDER BY orders.total_amount DESC
```

注意 `havingRaw` 中的绑定参数 `3` 也被正确替换了。这在排查 `HAVING` 条件不生效的问题时非常有用。

### 场景三：动态条件查询的条件验证

业务中常见的「筛选器」模式——根据用户输入动态添加条件：

```php
public function buildQuery(array $filters): Builder
{
    $query = Product::query()
        ->with(['category', 'shop'])
        ->where('is_active', true);

    if (!empty($filters['keyword'])) {
        $query->where(function ($q) use ($filters) {
            $q->where('title', 'like', "%{$filters['keyword']}%")
              ->orWhere('description', 'like', "%{$filters['keyword']}%");
        });
    }

    if (!empty($filters['category_id'])) {
        $query->where('category_id', $filters['category_id']);
    }

    if (!empty($filters['min_price'])) {
        $query->where('price', '>=', $filters['min_price']);
    }

    if (!empty($filters['max_price'])) {
        $query->where('price', '<=', $filters['max_price']);
    }

    if (!empty($filters['in_stock'])) {
        $query->where('stock', '>', 0);
    }

    // 排序
    $sortField = $filters['sort'] ?? 'created_at';
    $sortDir = $filters['dir'] ?? 'desc';
    $query->orderBy($sortField, $sortDir);

    return $query;
}

// 调试时，在任意位置插入
$query = $this->buildQuery($filters);
logger()->debug('Product Query SQL', ['sql' => $query->toRawSql()]);
```

这种方式可以在开发环境或日志中直接看到完整的 SQL，而不需要打断点。

### 场景四：DB::listen 全局 SQL 监控

`toRawSql()` 只能调试单个查询。如果你想监控整个请求生命周期中执行的所有 SQL，用 `DB::listen()`：

```php
// 在 AppServiceProvider 的 boot() 中注册
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

public function boot()
{
    DB::listen(function ($query) {
        Log::debug('SQL Executed', [
            'sql' => $query->sql,
            'bindings' => $query->bindings,
            'time' => $query->time . 'ms',
            'connection' => $query->connectionName,
        ]);
    });
}
```

日志输出：

```
[2026-06-10 01:09:00] local.DEBUG: SQL Executed {"sql":"select * from `users` where `id` = ? and `status` = ?","bindings":[42,"active"],"time":"1.23ms","connection":"mysql"}
```

**生产环境注意**：`DB::listen()` 会产生大量日志，建议用环境变量控制开关：

```php
if (config('app.debug_sql')) {
    DB::listen(function ($query) {
        Log::debug('SQL', [
            'sql' => $query->sql,
            'bindings' => $query->bindings,
            'time' => $query->time,
        ]);
    });
}
```

### 场景五：Laravel Telescope 的 SQL 调试

如果你的项目安装了 Laravel Telescope，它会自动记录所有 SQL 查询，包括：

- 完整的 SQL 语句（绑定参数已替换）
- 执行时间
- 调用栈（哪个文件、哪一行触发的查询）
- 慢查询标记

```bash
composer require laravel/telescope --dev
php artisan telescope:install
php artisan migrate
```

访问 `/telescope/queries` 即可看到所有 SQL 记录，支持按时间、慢查询、调用方过滤。

### 场景六：toRawSql() 在单元测试中的应用

在测试中验证生成的 SQL 是否符合预期：

```php
use Tests\TestCase;

class OrderQueryTest extends TestCase
{
    public function test_pending_orders_query_filters_correctly()
    {
        $query = Order::query()
            ->where('status', 'pending')
            ->where('created_at', '>', now()->subDays(7))
            ->where('shop_id', 1);

        $sql = $query->toRawSql();

        $this->assertStringContainsString("status = 'pending'", $sql);
        $this->assertStringContainsString("shop_id = 1", $sql);
        $this->assertStringNotContainsString('deleted_at', $sql); // 确认软删除已生效
    }

    public function test_complex_search_has_correct_or_logic()
    {
        $query = Product::query()
            ->where('is_active', true)
            ->where(function ($q) {
                $q->where('title', 'like', '%test%')
                  ->orWhere('sku', 'like', '%test%');
            });

        $sql = $query->toRawSql();

        // 验证 OR 条件被正确包裹在括号中
        $this->assertStringContainsString(
            "(title like '%test%' or sku like '%test%')",
            strtolower(str_replace('  ', ' ', $sql))
        );
    }
}
```

## 踩坑记录

### 踩坑一：toRawSql() 在 Soft Delete 模型上的陷阱

```php
// 如果模型使用了 SoftDeletes
$rawSql = User::withTrashed()->where('id', 1)->toRawSql();
// SELECT * FROM users WHERE id = 1  ✅ 正确，没有 deleted_at 条件

$rawSql = User::where('id', 1)->toRawSql();
// SELECT * FROM users WHERE id = 1 AND deleted_at IS NULL
// 注意：toRawSql() 会包含全局作用域的条件
```

**教训**：`toRawSql()` 输出的是 Query Builder 当前状态的 SQL，包含全局作用域。如果你想看「原始」SQL，记得用 `withTrashed()` 或 `withoutGlobalScopes()`。

### 踩坑二：绑定参数中的特殊字符

```php
$name = "O'Brien";
$sql = User::where('name', $name)->toRawSql();
// SELECT * FROM users WHERE name = 'O''Brien'
```

`toRawSql()` 会正确转义单引号，但如果你直接把这个 SQL 复制到某些客户端中执行，可能需要再处理一次转义。**不要用 toRawSql() 的输出直接执行 SQL**，它只用于调试。

### 踩坑三：toRawSql() 与 chunk/lazy 的组合

```php
// ❌ 这样不会生效，chunk 会立即执行查询
User::where('status', 'active')->chunk(100, function ($users) {
    // 处理逻辑
});

// ✅ 要调试 chunk 的 SQL，需要在 chunk 之前获取
$query = User::where('status', 'active');
logger()->debug('Chunk SQL', ['sql' => $query->toRawSql()]);
$query->chunk(100, function ($users) {
    // 处理逻辑
});
```

### 踩坑四：dd() 与 dump() 的行为差异

```php
// dd() 会终止执行，后续代码不会运行
dd($query->toRawSql());
$this->doSomethingElse(); // 永远不会执行

// dump() 只输出不终止
dump($query->toRawSql());
$this->doSomethingElse(); // 会正常执行
```

在调试多个查询时，用 `dump()` 代替 `dd()` 可以一次性看到所有查询的 SQL。

### 踩坑五：toRawSql() 无法捕获子查询的绑定参数

```php
$subQuery = OrderItem::select('product_id')
    ->where('quantity', '>', 5)
    ->groupBy('product_id')
    ->havingRaw('SUM(price) > ?', [1000]);

$products = Product::whereIn('id', $subQuery)->toRawSql();

// 输出中子查询的绑定参数是正确的
// SELECT * FROM products WHERE id IN (SELECT product_id FROM order_items WHERE quantity > 5 GROUP BY product_id HAVING SUM(price) > 1000)
```

这个场景下 `toRawSql()` 能正确处理子查询的绑定参数。但如果子查询更复杂（嵌套多层），建议分步调试每一层。

## 总结

| 调试需求 | 推荐方法 |
|----------|----------|
| 快速看一条 SQL | `->toRawSql()` |
| 调试并终止 | `->dd()` 或 `dd($query->toRawSql())` |
| 监控所有 SQL | `DB::listen()` |
| 生产环境慢查询 | Laravel Telescope / MySQL Slow Query Log |
| 测试中验证 SQL | `$this->assertStringContainsString(...)` |
| 复杂嵌套查询 | 分步 `dump()` 每一层的 SQL |

**最佳实践**：

1. **开发环境**：优先用 `toRawSql()` + `dump()`，比 `toSql()` + `getBindings()` 更直观
2. **测试环境**：用 `DB::listen()` 记录所有 SQL，配合日志分析
3. **生产环境**：用 Telescope 或 MySQL 慢查询日志，不要在代码中硬编码调试语句
4. **代码审查**：在 PR 中检查是否有遗留的 `dd()` / `dump()` 调用

掌握这些调试技巧，能大幅缩短排查 SQL 问题的时间。下次遇到「为什么查询结果不对」的时候，第一反应应该是 `toRawSql()` 看看实际执行的 SQL 是什么。
