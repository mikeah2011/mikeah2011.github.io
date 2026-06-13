---

title: PostgreSQL 高级特性实战：Window Functions + CTE + JSONB + pg_trgm——Laravel 中的复杂查询重写与性能调优
keywords: [PostgreSQL, Window Functions, CTE, JSONB, pg, trgm, Laravel, 高级特性实战, 中的复杂查询重写与性能调优]
date: 2026-06-05 09:00:00
tags:
- PostgreSQL
- Laravel
- Window-Functions
- CTE
- JSONB
- pg_trgm
- 性能调优
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
description: 深入讲解 PostgreSQL 四大高级特性——Window Functions 窗口函数、CTE 公共表表达式、JSONB 二进制 JSON 与 pg_trgm 模糊搜索，结合 Laravel 实战代码演示复杂查询重写、索引策略选择与性能调优技巧，涵盖递归 CTE、GIN 与表达式索引对比及常见陷阱，助你从容应对海量数据挑战。
---



## 前言：为什么 Laravel 开发者需要掌握 PostgreSQL 高级特性

在日常的 Laravel B2C API 开发中，我们每天都在和数据库打交道。从商品列表查询到订单报表生成，从用户行为分析到模糊搜索推荐，这些功能的背后都离不开高效的数据库查询。然而，很多开发者在面对复杂查询需求时，习惯性地选择"先查出原始数据，再用 PHP 的 Collection 进行处理"——排序用 `sortBy`，分组用 `groupBy`，聚合用 `sum` 和 `count`。这种做法在数据量较小的时候确实方便快捷，代码也容易理解，但当业务规模增长到百万甚至千万级数据时，问题就会集中爆发。

我曾经在一个电商项目中遇到过这样一个场景：运营需要生成一份"各品类销量排行榜，包含本月销量、上月销量、环比增长率"的报表。最初的实现方式是通过三次 SQL 查询分别获取本月数据、上月数据和品类信息，然后在 PHP 层面用三重循环进行匹配和计算。当订单表达到五百万条记录时，这个接口的响应时间超过了八秒，偶尔甚至直接超时。后来通过将计算逻辑下沉到数据库层，利用 Window Functions 一条 SQL 就完成了同样的功能，响应时间降到了两百毫秒以内。

PostgreSQL 作为功能最强大的开源关系型数据库，提供了许多 MySQL 不具备或者支持较弱的高级特性。特别是 Window Functions（窗口函数）、CTE（公共表表达式）、JSONB（二进制 JSON）和 pg_trgm（三元组模糊匹配）这四大特性，能够从根本上改变我们编写复杂查询的方式。它们不仅能大幅提升查询性能，还能让代码更加简洁可读，减少出错的概率。

本文将围绕这四个核心特性，结合真实的 Laravel 项目代码，逐一讲解其原理、用法和性能调优策略。无论你是刚开始接触 PostgreSQL 的 Laravel 开发者，还是已经在使用但想要深入了解的最佳实践，相信都能从中获益。

---

## 一、Window Functions：窗口函数的完整实战

窗口函数是 SQL 标准中最强大但也最容易被忽视的特性之一。与普通的聚合函数不同，窗口函数不会将多行合并为一行，而是在保留每一行的基础上，对其"窗口范围"内的数据进行计算。这就像在一列数据旁边开了一个"计算窗口"，既能看到当前行的详情，又能看到它在整体中的位置和上下文关系。

### 1.1 基本语法

窗口函数的标准语法为：`函数名() OVER (PARTITION BY 分区列 ORDER BY 排序列 ROWS/RANGE 范围)`。其中 `PARTITION BY` 定义分组窗口，`ORDER BY` 定义窗口内的排序，而 `ROWS/RANGE` 子句则可以进一步限定窗口的物理范围。在 Laravel 中使用时，我们需要借助 `DB::raw()` 来编写窗口函数表达式。

### 1.2 ROW_NUMBER：每个分类下销量前 N 的商品

这是最常见的窗口函数使用场景。假设我们有一个电商平台，需要展示每个商品分类下销量排名前三位的商品。传统的做法是使用相关子查询配合 `COUNT` 函数，但这种写法在数据量大时性能很差，因为它需要对每一行都执行一次子查询。使用 `ROW_NUMBER` 可以一次性完成：

```php
use Illuminate\Support\Facades\DB;

$topProducts = DB::select("
    SELECT id, name, category_id, sold_count, row_num
    FROM (
        SELECT id, name, category_id, sold_count,
            ROW_NUMBER() OVER (
                PARTITION BY category_id
                ORDER BY sold_count DESC
            ) as row_num
        FROM products
        WHERE status = 1
    ) ranked
    WHERE row_num <= 3
    ORDER BY category_id, row_num
");
```

这段 SQL 的执行逻辑非常清晰：内层子查询通过 `ROW_NUMBER` 为每个分类内的商品按销量降序编号，外层查询只需要过滤出编号不超过三的记录即可。相比传统的自连接方案，这种方式只需要一次全表扫描，性能提升是非常显著的。

值得注意的是，如果你希望销量相同的商品获得相同的排名（比如并列第一），可以使用 `RANK()` 或 `DENSE_RANK()`。`RANK` 会跳过并列后的序号（1, 1, 3），而 `DENSE_RANK` 不会跳过（1, 1, 2）。在排行榜场景中，通常 `DENSE_RANK` 更符合业务预期。

### 1.3 LAG 和 LEAD：计算环比增长率

在生成销售报表时，计算环比增长率几乎是标配需求。`LAG` 函数可以获取当前行之前第 N 行的值，`LEAD` 则获取之后第 N 行的值。默认取前一行或后一行，也可以指定偏移量。

```php
$monthlyStats = DB::select("
    SELECT
        month,
        monthly_total,
        prev_month_total,
        CASE
            WHEN prev_month_total IS NULL OR prev_month_total = 0 THEN NULL
            ELSE ROUND((monthly_total - prev_month_total) / prev_month_total * 100, 2)
        END as growth_rate
    FROM (
        SELECT
            DATE_TRUNC('month', created_at)::date as month,
            SUM(total_amount) as monthly_total,
            LAG(SUM(total_amount)) OVER (
                ORDER BY DATE_TRUNC('month', created_at)
            ) as prev_month_total
        FROM orders
        WHERE status = 'completed'
            AND created_at >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at)
    ) monthly_data
    ORDER BY month DESC
");
```

在上面的代码中，内层查询先按月聚合订单总金额，然后通过 `LAG` 函数获取上一个月的总金额。外层查询再计算增长率，同时处理除零错误。如果用 PHP 语言来实现同样的逻辑，至少需要一次额外的数据库查询，再加上循环遍历和条件判断，代码量会增加三到四倍，而且容易出错。

### 1.4 SUM 窗口函数：累计求和与移动平均

窗口函数不仅支持 `ROW_NUMBER`、`LAG` 等排名和偏移函数，还支持 `SUM`、`AVG`、`COUNT` 等聚合函数作为窗口函数使用。这在计算累计值和移动平均时非常有用。

```php
$runningTotals = DB::select("
    SELECT
        created_at::date as date,
        daily_amount,
        SUM(daily_amount) OVER (
            ORDER BY created_at::date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) as cumulative_amount,
        AVG(daily_amount) OVER (
            ORDER BY created_at::date
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ) as moving_avg_7d
    FROM (
        SELECT
            DATE_TRUNC('day', created_at) as created_at,
            SUM(total_amount) as daily_amount
        FROM orders
        WHERE status = 'completed'
            AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', created_at)
    ) daily_stats
    ORDER BY date
");
```

这段代码同时计算了两个指标：一是从第一天到当前行的累计金额（用于仪表盘展示），二是最近七天的移动平均值（用于趋势分析和异常检测）。`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` 定义了从第一行到当前行的窗口范围，`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` 则定义了最近七行的窗口范围。

### 1.5 RANK 与 DENSE_RANK：并列排名处理

在排行榜场景中，经常需要处理并列排名的情况。`ROW_NUMBER` 总是生成唯一编号，即使值相同也会给出不同序号。而 `RANK` 和 `DENSE_RANK` 则允许并列：`RANK` 在并列后会跳过序号（如 1, 1, 3），`DENSE_RANK` 不跳过（如 1, 1, 2）。在电商排行榜中，`DENSE_RANK` 通常更符合业务预期。

```php
// 每个品类下按销量排名，相同销量并列，不跳过名次
$rankedProducts = DB::select("
    SELECT id, name, category_id, sold_count, dense_rank_num
    FROM (
        SELECT id, name, category_id, sold_count,
            DENSE_RANK() OVER (
                PARTITION BY category_id
                ORDER BY sold_count DESC
            ) as dense_rank_num
        FROM products
        WHERE status = 1
    ) ranked
    WHERE dense_rank_num <= 5
    ORDER BY category_id, dense_rank_num
");
```

与 `ROW_NUMBER` 的关键区别在于：如果某个品类下前三名的销量分别为 100、100、80、70，`ROW_NUMBER` 会返回四条记录（1, 2, 3, 4），而 `DENSE_RANK` 只返回前三名的两条记录（两个并列第一和一个第三）。理解这个差异对于正确的业务逻辑至关重要。

### 1.6 NTILE：数据分桶与百分位分析

`NTILE` 函数将结果集按指定数量等分为桶，常用于用户分层、数据分位分析等场景。比如将用户按消费金额分为高、中、低三档：

```php
$userTiers = DB::select("
    SELECT
        user_id, total_spent, spending_bucket,
        CASE spending_bucket
            WHEN 1 THEN '高消费用户'
            WHEN 2 THEN '中消费用户'
            WHEN 3 THEN '低消费用户'
        END as tier_label
    FROM (
        SELECT
            user_id,
            SUM(total_amount) as total_spent,
            NTILE(3) OVER (ORDER BY SUM(total_amount) DESC) as spending_bucket
        FROM orders
        WHERE status = 'completed'
            AND created_at >= NOW() - INTERVAL '6 months'
        GROUP BY user_id
    ) bucketed
    ORDER BY spending_bucket, total_spent DESC
");
```

`NTILE(3)` 会将所有用户按消费金额降序排列后均匀分为三组。如果总用户数不能被 3 整除，前面的桶会多分到一个元素。在实际业务中，可以配合 `CASE` 语句为每个桶赋予业务含义（如会员等级、营销标签等），实现基于数据分布的自动分层。

### 1.7 LAG 与 LEAD 进阶：订单间隔分析

除了计算环比增长率，`LAG` 和 `LEAD` 还有一个经典应用——分析用户的订单间隔。这对于复购分析和流失预警非常重要：

```php
$orderIntervals = DB::select("
    SELECT
        user_id,
        order_id,
        order_date,
        prev_order_date,
        days_since_last_order,
        CASE
            WHEN prev_order_date IS NULL THEN '首次购买'
            WHEN days_since_last_order <= 7 THEN '高频复购'
            WHEN days_since_last_order <= 30 THEN '正常复购'
            WHEN days_since_last_order <= 90 THEN '低频复购'
            ELSE '疑似流失'
        END as purchase_pattern
    FROM (
        SELECT
            user_id,
            id as order_id,
            created_at::date as order_date,
            LAG(created_at::date) OVER (
                PARTITION BY user_id
                ORDER BY created_at
            ) as prev_order_date,
            created_at::date - LAG(created_at::date) OVER (
                PARTITION BY user_id
                ORDER BY created_at
            ) as days_since_last_order
        FROM orders
        WHERE status = 'completed'
    ) order_gaps
    ORDER BY user_id, order_date
");
```

这段 SQL 利用 `PARTITION BY user_id` 为每个用户独立计算订单间隔，然后通过 `CASE` 语句对复购模式进行分类。如果用 PHP 来实现同样的逻辑，需要先按用户分组、再排序、再遍历计算间隔，代码量至少增加五倍，而且在用户量大时内存消耗也会显著增加。

---

## 二、CTE（Common Table Expressions）：公共表表达式的灵活运用

CTE 使用 `WITH` 子句定义一个命名的临时结果集，可以在后续的主查询中像普通表一样引用。它最大的价值在于将复杂的多步查询拆分为多个逻辑清晰的模块，大幅提升 SQL 的可读性和可维护性。在 Laravel 中使用 CTE 时，通常通过 `DB::select()` 直接编写原生 SQL。

### 2.1 非递归 CTE：化繁为简的查询拆分

在实际业务中，我们经常需要将多个中间步骤组合在一起生成最终结果。比如运营需要一份用户消费分析报告，包含：每位用户的最近一笔订单信息、历史总消费金额、消费频次和对应的会员等级。如果用嵌套子查询来实现，SQL 会变得非常难读，也难以调试和修改。

```php
$result = DB::select("
    WITH latest_order AS (
        SELECT DISTINCT ON (user_id)
            user_id, id as order_id, total_amount, created_at
        FROM orders
        WHERE status = 'completed'
        ORDER BY user_id, created_at DESC
    ),
    user_spending AS (
        SELECT
            user_id,
            COUNT(*) as total_orders,
            SUM(total_amount) as total_spent,
            AVG(total_amount) as avg_order_value,
            MIN(created_at) as first_order_at,
            MAX(created_at) as last_order_at
        FROM orders
        WHERE status = 'completed'
        GROUP BY user_id
    )
    SELECT
        u.id, u.name, u.email,
        lo.order_id as latest_order_id,
        lo.total_amount as latest_order_amount,
        lo.created_at as latest_order_time,
        us.total_orders,
        us.total_spent,
        us.avg_order_value,
        CASE
            WHEN us.total_spent >= 50000 THEN '钻石会员'
            WHEN us.total_spent >= 20000 THEN '金牌会员'
            WHEN us.total_spent >= 5000 THEN '银牌会员'
            ELSE '普通会员'
        END as member_tier
    FROM users u
    LEFT JOIN latest_order lo ON u.id = lo.user_id
    LEFT JOIN user_spending us ON u.id = us.user_id
    WHERE us.total_spent IS NOT NULL
    ORDER BY us.total_spent DESC
    LIMIT 100
");
```

这段 SQL 通过两个 CTE 分别定义了"用户最近订单"和"用户消费统计"两个中间结果集，主查询只需要将它们与用户表进行关联即可。每个 CTE 的职责单一明确，后续如果业务需求变化（比如新增一个"退货率"指标），只需要新增一个 CTE 即可，不需要改动其他部分。

### 2.2 递归 CTE：分类树的深度遍历

在电商系统中，商品分类通常是多级树形结构。比如"电子产品"下有"手机"和"电脑"，"手机"下又有"智能手机"和"功能手机"。当需要查询某个分类及其所有子孙分类时，递归 CTE 是最优雅的解决方案。

```php
$categoryId = 5;

$categories = DB::select("
    WITH RECURSIVE category_tree AS (
        -- 锚点成员：起始分类
        SELECT id, name, parent_id, 0 as depth,
            name::text as full_path
        FROM categories
        WHERE id = ?

        UNION ALL

        -- 递归成员：查找子分类
        SELECT c.id, c.name, c.parent_id, ct.depth + 1,
            ct.full_path || ' > ' || c.name
        FROM categories c
        INNER JOIN category_tree ct ON c.parent_id = ct.id
        WHERE c.depth < 10  -- 安全限制，防止无限递归
    )
    SELECT * FROM category_tree
    ORDER BY full_path
", [$categoryId]);
```

递归 CTE 的执行过程分为两步：第一步执行"锚点成员"，获取起始分类；第二步反复执行"递归成员"，每次基于上一轮的结果查找子分类，直到没有更多匹配的行或者达到安全限制为止。返回的结果中包含了每个分类的层级深度和完整路径，前端可以直接用来渲染面包屑导航或者树形选择器。

需要注意的是，在生产环境中一定要加上递归深度限制（如上面的 `WHERE c.depth < 10`），防止因为数据异常（比如出现循环引用）导致无限递归。

### 2.3 递归 CTE 进阶：组织架构树查询

递归 CTE 的另一个常见应用场景是组织架构树。比如查询某个部门及其所有下属部门的员工总数：

```php
$departmentId = 1;

$orgStats = DB::select("
    WITH RECURSIVE dept_tree AS (
        -- 锚点：起始部门
        SELECT id, name, parent_id, 0 as depth
        FROM departments
        WHERE id = ?

        UNION ALL

        -- 递归：查找所有子部门
        SELECT d.id, d.name, d.parent_id, dt.depth + 1
        FROM departments d
        INNER JOIN dept_tree dt ON d.parent_id = dt.id
        WHERE dt.depth < 20
    )
    SELECT
        dt.id,
        dt.name,
        dt.depth,
        COUNT(e.id) as employee_count,
        COALESCE(SUM(e.salary), 0) as total_salary
    FROM dept_tree dt
    LEFT JOIN employees e ON e.department_id = dt.id
    GROUP BY dt.id, dt.name, dt.depth
    ORDER BY dt.depth, dt.name
", [$departmentId]);
```

如果只需要统计整棵树的汇总数据（不需要每个部门的明细），可以去掉 `GROUP BY`，直接对整个结果集进行聚合。这种写法在生成组织架构报表时非常高效，一次查询就能完成多层级的数据汇总。

### 2.4 写入型 CTE：查询同时执行操作

PostgreSQL 的 CTE 还支持 `INSERT`、`UPDATE`、`DELETE` 等写入操作，可以在一次数据库往返中完成"查询加写入"的复合操作。比如批量更新商品状态并记录变更日志：

```php
DB::statement("
    WITH updated_products AS (
        UPDATE products
        SET status = 0, updated_at = NOW()
        WHERE stock = 0 AND status = 1
        RETURNING id, name
    )
    INSERT INTO audit_logs (action, entity_type, entity_id, entity_name, created_at)
    SELECT '下架', 'product', id, name, NOW()
    FROM updated_products
");
```

这种写法利用了 CTE 的 `RETURNING` 子句，将更新操作影响的行直接传递给 `INSERT` 操作，整个过程在一个事务中完成，既保证了一致性，又减少了数据库的往返次数。

---

## 三、JSONB：半结构化数据存储与查询

在 B2C 电商平台中，不同品类的商品属性差异巨大——手机有屏幕尺寸、处理器型号、内存容量，衣服有材质、尺码、颜色，食品有保质期、产地、配料表。如果为每个属性都建一个独立的数据库字段，表结构会变得极其臃肿且难以维护。JSONB 类型完美解决了这一问题，它允许将可变的、结构不固定的属性数据以 JSON 格式存储在单个字段中，同时支持高效的索引和查询。

### 3.1 表设计与数据模型

在 Laravel Migration 中定义 JSONB 字段非常直观：

```php
Schema::create('products', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('sku')->unique();
    $table->decimal('price', 10, 2);
    $table->jsonb('attributes')->nullable()->comment('商品属性');
    $table->jsonb('seo_meta')->nullable()->comment('SEO 元数据');
    $table->jsonb('custom_fields')->nullable()->comment('自定义字段');
    $table->boolean('status')->default(true);
    $table->timestamps();
});
```

在创建模型时，Laravel 会自动将 JSONB 字段反序列化为 PHP 数组，方便直接操作：

```php
$product = Product::find(1);
$brand = $product->attributes['brand'] ?? '未知';
$tags = $product->attributes['tags'] ?? [];
```

### 3.2 查询 JSONB 字段

PostgreSQL 提供了丰富的 JSONB 查询操作符。在 Laravel 中可以通过 `whereRaw` 来使用它们：

```php
// 查询品牌为 Apple 的商品
$appleProducts = DB::table('products')
    ->whereRaw("attributes->>'brand' = ?", ['Apple'])
    ->where('status', true)
    ->get();

// 查询内存大于等于 256GB 的商品
$largeStorage = DB::table('products')
    ->whereRaw("(attributes->>'storage_gb')::int >= ?", [256])
    ->get();

// 查询 tags 数组中包含"热销"标签的商品（使用 ? 操作符）
$hotProducts = DB::table('products')
    ->whereRaw("attributes->'tags' ? '热销'")
    ->get();

// 查询 attributes 中包含指定键值对的部分匹配（使用 @> 操作符）
$matched = DB::table('products')
    ->whereRaw("attributes @> ?", [json_encode(['color' => '黑色', 'brand' => 'Samsung'])])
    ->get();

// 查询 JSON 对象中是否存在某个键
$withWarranty = DB::table('products')
    ->whereRaw("attributes ? 'warranty_months'")
    ->get();
```

其中，`->>` 操作符返回文本类型，`->` 返回 JSONB 类型。在做比较运算时通常用 `->>`，在使用 `?`、`@>` 等 JSONB 特有操作符时用 `->`。这一点需要特别注意，用错操作符可能会导致索引失效或者查询结果不符合预期。

### 3.3 更新 JSONB 字段

JSONB 的更新操作比查询更加灵活，可以实现精确的字段修改而不需要读取整个 JSON 对象再写回：

```php
// 合并更新：将新的键值对合并到现有 JSON 中
DB::table('products')
    ->where('id', $productId)
    ->update([
        'attributes' => DB::raw("attributes || ?", [json_encode(['stock' => 100, 'hot' => true])])
    ]);

// 嵌套更新：修改嵌套路径中的值
DB::table('products')
    ->where('id', $productId)
    ->update([
        'attributes' => DB::raw("jsonb_set(attributes, '{specs,weight}', '\"200g\"', true)")
    ]);

// 删除某个键
DB::table('products')
    ->where('id', $productId)
    ->update([
        'attributes' => DB::raw("attributes - 'deprecated_field'")
    ]);

// 从数组中移除某个元素
DB::table('products')
    ->where('id', $productId)
    ->update([
        'attributes' => DB::raw("attributes #> '{tags}' - '旧标签'")
    ]);
```

`jsonb_set` 函数的最后一个布尔参数（`true`）表示如果路径不存在则创建，设为 `false` 则路径不存在时不进行任何修改。

### 3.4 JSONB 索引策略

JSONB 的查询性能完全依赖于正确的索引。PostgreSQL 提供了两种主要的 JSONB 索引方式：

```php
// 方式一：GIN 索引——支持 ?, @>, jsonb_path_exists 等多种操作符
// 适合需要多种不同路径查询的场景
DB::statement('CREATE INDEX idx_products_attrs_gin ON products USING GIN (attributes)');

// 方式二：表达式索引——针对特定路径建立 B-Tree 索引
// 适合高频查询的固定路径，查询性能比 GIN 更优
DB::statement("CREATE INDEX idx_products_brand ON products ((attributes->>'brand'))");
DB::statement("CREATE INDEX idx_products_color ON products ((attributes->>'color'))");
```

**性能对比数据**：在我实际参与的一个项目中，商品表有五十万条记录。对 `attributes->>'brand'` 字段进行等值查询，无索引时耗时约一千二百毫秒，添加 GIN 索引后降至约十五毫秒，使用表达式索引后进一步降至约两毫秒。因此对于高频查询的固定字段，强烈建议使用表达式索引。

### 3.5 GIN 与 GiST 索引深度对比

在选择 JSONB 索引时，理解 GIN 和 GiST 两种索引的差异至关重要。下表总结了两者的核心区别：

| 特性 | GIN 索引 | GiST 索引 |
|------|----------|-----------|
| 查询速度 | 快（精确匹配优化） | 较慢 |
| 索引体积 | 大（约为表体积的 10%-30%） | 小（约为表体积的 2%-5%） |
| 构建速度 | 慢 | 快 |
| 支持的操作符 | `@>`, `?`, `?&`, `?\|`, `jsonb_path_exists` | `@>`, `@?`, `jsonb_path_exists` |
| 更新开销 | 高（频繁更新时索引膨胀明显） | 低 |
| 适用场景 | 读多写少、需要精确匹配 | 写多读少、磁盘空间紧张 |

在 Laravel Migration 中创建 GiST 索引：

```php
// GiST 索引——体积更小，适合写入频繁的场景
DB::statement('CREATE INDEX idx_products_attrs_gist ON products USING GiST (attributes)');
```

**索引选择决策树**：如果查询主要使用 `@>` 和 `?` 操作符且数据以读为主，选择 GIN；如果 JSONB 字段更新频繁且磁盘空间有限，选择 GiST；如果只查询固定的几个路径，使用表达式索引是最佳选择。三种索引可以同时存在于同一列上，PostgreSQL 会根据查询条件自动选择最优索引。

### 3.6 JSONB 数组聚合与展开

在实际业务中，JSONB 数组的展开和聚合操作非常常见。比如统计商品属性中所有标签的出现频率：

```php
// 展开 JSONB 数组并统计标签频率
$tagStats = DB::select("
    SELECT tag_value, COUNT(*) as tag_count
    FROM products,
         jsonb_array_elements_text(attributes->'tags') as tag_value
    WHERE status = true
    GROUP BY tag_value
    ORDER BY tag_count DESC
    LIMIT 20
");

// 将多个 JSONB 属性聚合为一个汇总对象
$productSummary = DB::select("
    SELECT
        category_id,
        jsonb_build_object(
            'total_products', COUNT(*),
            'avg_price', ROUND(AVG(price)::numeric, 2),
            'brands', jsonb_agg(DISTINCT attributes->>'brand'),
            'price_range', jsonb_build_object(
                'min', MIN(price),
                'max', MAX(price)
            )
        ) as summary
    FROM products
    WHERE status = true
    GROUP BY category_id
");
```

`jsonb_array_elements_text` 函数将 JSONB 数组展开为多行文本，配合聚合函数可以实现灵活的数据统计。`jsonb_build_object` 和 `jsonb_agg` 则用于将关系数据聚合为 JSONB 格式，特别适合需要返回结构化 JSON 响应的 API 场景。

---

## 四、pg_trgm：基于三元组的模糊文本搜索

在电商场景中，用户经常输入不完整或者有拼写错误的关键词来搜索商品。传统的 `LIKE '%keyword%'` 查询有两个致命缺陷：一是无法使用标准的 B-Tree 索引，必须进行全表扫描；二是只能做精确的子串匹配，无法容忍拼写偏差。PostgreSQL 的 `pg_trgm` 扩展完美解决了这两个问题。

### 4.1 启用扩展与创建索引

在 Laravel Migration 中启用 `pg_trgm` 扩展并创建三元组索引：

```php
public function up()
{
    // 启用 pg_trgm 扩展（需要 superuser 或数据库级别的默认权限）
    DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');

    Schema::table('products', function (Blueprint $table) {
        // 创建 GIN 索引，使用 gin_trgm_ops 操作符类
        DB::statement('CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops)');
    });
}
```

`pg_trgm` 的工作原理是将字符串拆分为连续的三个字符组合（三元组），然后通过比较三元组的重叠程度来衡量两个字符串的相似度。比如"iPhone"会被拆分为 `{" ip","iph","hon","one","ne "}`，而"iPhon"会被拆分为 `{" ip","iph","hon","on "}`，两者的三元组有大量重叠，因此相似度很高。

### 4.2 相似度搜索与模糊匹配

```php
use Illuminate\Support\Facades\DB;

class ProductSearchService
{
    /**
     * 基于 pg_trgm 的商品模糊搜索
     * 返回结果按相似度降序排列
     */
    public function fuzzySearch(string $keyword, int $limit = 20)
    {
        return DB::table('products')
            ->select(
                'id', 'name', 'price', 'image_url',
                DB::raw('similarity(name, ?) as score')
            )
            ->whereRaw('name % ?', [$keyword])
            ->where('status', true)
            ->orderByDesc('score')
            ->limit($limit)
            ->get();
    }

    /**
     * 结合 JSONB 属性过滤的高级搜索
     * 同时支持品牌筛选、价格区间和相似度排序
     */
    public function advancedSearch(string $keyword, array $filters = [])
    {
        $query = DB::table('products')
            ->select(
                'id', 'name', 'price', 'attributes', 'image_url',
                DB::raw('similarity(name, ?) as relevance')
            )
            ->whereRaw('name % ?', [$keyword])
            ->where('status', true);

        // 品牌过滤（JSONB 查询）
        if (!empty($filters['brand'])) {
            $query->whereRaw("attributes->>'brand' = ?", [$filters['brand']]);
        }

        // 价格区间过滤
        if (isset($filters['min_price'])) {
            $query->where('price', '>=', $filters['min_price']);
        }
        if (isset($filters['max_price'])) {
            $query->where('price', '<=', $filters['max_price']);
        }

        // 标签过滤（JSONB 数组查询）
        if (!empty($filters['tag'])) {
            $query->whereRaw("attributes->'tags' ? ?", [$filters['tag']]);
        }

        return $query->orderByDesc('relevance')
            ->paginate($filters['per_page'] ?? 20);
    }

    /**
     * 混合搜索：优先精确匹配，其次模糊匹配
     * 当精确匹配结果不足时自动降级为模糊搜索
     */
    public function hybridSearch(string $keyword, int $limit = 20)
    {
        return DB::select("
            (
                SELECT id, name, price, 1.0 as score, 'exact' as match_type
                FROM products
                WHERE name ILIKE ? AND status = true
                LIMIT ?
            )
            UNION ALL
            (
                SELECT id, name, price, similarity(name, ?) as score, 'fuzzy' as match_type
                FROM products
                WHERE name % ? AND status = true
                    AND name NOT ILIKE ?
                ORDER BY score DESC
                LIMIT ?
            )
        ", ["%{$keyword}%", $limit, $keyword, $keyword, "%{$keyword}%", $limit]);
    }
}
```

混合搜索策略是实际项目中最常用的方案：先返回精确包含关键词的商品，再补充模糊匹配的商品。这样既保证了高相关性结果排在前面，又能在用户输入错误时仍然返回有意义的结果。

### 4.3 pg_trgm 的调优参数

PostgreSQL 提供了几个可调参数来控制 `pg_trgm` 的行为：

```php
// 查看当前的相似度阈值（默认 0.3）
$threshold = DB::select("SHOW pg_trgm.similarity_threshold");

// 降低阈值以返回更多模糊结果（搜索场景更宽松）
DB::statement("SET pg_trgm.similarity_threshold = 0.1");

// 查看某个字符串的三元组分解结果（调试用）
$trigrams = DB::select("SELECT show_trgm('iPhone 15 Pro') as trigrams");
// 结果：{"  i"," ip","iph","one","pho","pro","r 1","15 ","15p","5 p","5pr"}
```

相似度阈值的设置需要在精确率和召回率之间做权衡。阈值设得太高，用户稍有输入偏差就搜不到结果；设得太低，会返回大量不相关的商品。建议根据业务场景通过 A/B 测试来确定最优值。

### 4.4 pg_trgm 与全文搜索的选择

PostgreSQL 内置了 `tsvector` + `tsquery` 的全文搜索功能，与 `pg_trgm` 定位不同。全文搜索基于词典分词，适合长文本（文章、评论）的语义搜索；`pg_trgm` 基于字符三元组，适合短文本（商品名、用户名）的模糊匹配和拼写纠错。在实际项目中，两者可以结合使用：

```php
// pg_trgm：适合商品名、用户名等短文本的模糊搜索
DB::statement("CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops)");

// 全文搜索：适合商品描述、文章内容等长文本的语义搜索
DB::statement("ALTER TABLE products ADD COLUMN search_vector tsvector");
DB::statement("CREATE INDEX idx_products_search ON products USING GIN (search_vector)");

// 在 Laravel 中更新全文搜索向量
DB::statement("
    UPDATE products SET search_vector =
        setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'B')
");
```

---

## PostgreSQL 与 MySQL 特性对比

在决定是否从 MySQL 迁移到 PostgreSQL 之前，了解两者在这些高级特性上的差异非常重要。以下对比基于 MySQL 8.0+ 和 PostgreSQL 15+：

| 特性 | PostgreSQL | MySQL 8.0+ |
|------|-----------|------------|
| **Window Functions** | 完整支持，包括所有标准函数（ROW_NUMBER, RANK, DENSE_RANK, NTILE, LAG, LEAD, NTH_VALUE 等） | 8.0 起支持基本窗口函数，但不支持 NTILE 的某些高级用法 |
| **CTE** | 完整支持递归和非递归 CTE，支持写入型 CTE（INSERT/UPDATE/DELETE） | 8.0 起支持递归 CTE，但不支持写入型 CTE |
| **JSON 类型** | 原生 JSONB 二进制格式，支持 GIN/GiST 索引，查询性能优秀 | JSON 类型为文本格式，索引支持有限，需使用虚拟列 + B-Tree 索引间接实现 |
| **模糊搜索** | pg_trgm 扩展提供基于三元组的相似度搜索和索引支持 | 无原生支持，需借助 FULLTEXT 索引或外部搜索引擎（Elasticsearch） |
| **表达式索引** | 原生支持，可对任意表达式创建索引 | 8.0 起支持函数索引和虚拟列索引 |
| **并发索引创建** | 支持 `CREATE INDEX CONCURRENTLY`，不阻塞写入 | 不支持，创建索引时会锁表（MySQL 8.0 Online DDL 有部分改进） |
| **数组类型** | 原生支持数组类型和丰富的数组操作符 | 不支持，需用 JSON 数组或关联表模拟 |

### 从 MySQL 迁移到 PostgreSQL 的常见陷阱

**陷阱一：字符串比较的差异。** MySQL 默认使用 `utf8mb4_general_ci` 排序规则，字符串比较不区分大小写。PostgreSQL 的默认排序规则区分大小写。迁移后，`WHERE name = 'iPhone'` 将不再匹配 `iphone`。解决方案是在 PostgreSQL 中使用 `ILIKE` 或者创建时指定 `citext` 扩展：

```php
// 使用 ILIKE 进行不区分大小写的比较
DB::table('products')->whereRaw('name ILIKE ?', ['iphone'])->get();

// 或者使用 citext 类型（推荐，可直接用 = 操作符）
DB::statement('CREATE EXTENSION IF NOT EXISTS citext');
Schema::table('products', function (Blueprint $table) {
    $table->renameColumn('name', 'name_old');
});
DB::statement('ALTER TABLE products ADD COLUMN name citext');
DB::statement('UPDATE products SET name = name_old');
DB::statement('ALTER TABLE products DROP COLUMN name_old');
```

**陷阱二：自增主键的行为差异。** MySQL 的 `AUTO_INCREMENT` 值持久化在内存中，重启后可能产生间隙。PostgreSQL 的 `SERIAL` / `IDENTITY` 列使用序列对象，值是连续递增的（但事务回滚仍会产生间隙）。在迁移数据时需要注意序列的起始值设置：

```php
// 迁移后重置序列，避免主键冲突
DB::statement("SELECT setval('products_id_seq', (SELECT MAX(id) FROM products))");
```

**陷阱三：GROUP BY 的语义差异。** MySQL 在 `GROUP BY` 时允许 SELECT 中包含未聚合的非分组列（依赖 `ONLY_FULL_GROUP_BY` 模式是否开启），PostgreSQL 则严格要求 SELECT 中的非聚合列必须出现在 GROUP BY 中。迁移时需要逐一检查并修正所有 `GROUP BY` 查询。

**陷阱四：日期函数的差异。** MySQL 使用 `DATE_FORMAT(date, '%Y-%m')` 格式化日期，PostgreSQL 使用 `TO_CHAR(date, 'YYYY-MM')` 或 `DATE_TRUNC('month', date)`。MySQL 的 `DATEDIFF(date1, date2)` 在 PostgreSQL 中对应 `date1 - date2`（返回 interval 类型）或 `EXTRACT(EPOCH FROM (date1 - date2)) / 86400`（返回天数）。

**陷阱五：布尔类型的差异。** MySQL 用 `TINYINT(1)` 模拟布尔值，PostgreSQL 有原生 `BOOLEAN` 类型，值为 `true`/`false`（不是 `1`/`0`）。迁移后需要更新所有直接与布尔列比较的代码。

**陷阱六：LIMIT 语法的差异。** MySQL 使用 `LIMIT offset, count`，PostgreSQL 使用 `LIMIT count OFFSET offset`（顺序相反）。Laravel 的 `skip()` 和 `take()` 方法会自动处理这个差异，但原生 SQL 需要注意。

**陷阱七：转义字符的差异。** PostgreSQL 使用 `$$` 作为字符串定界符（用于存储过程中），反斜杠 `\` 默认是转义字符。如果 JSON 数据中包含反斜杠路径（如 Windows 路径），需要额外处理转义。

---

## 五、性能调优实战

掌握了上面的四个特性之后，如何确保它们在生产环境中高效运行就成了关键问题。性能调优不是盲目地加索引，而是基于查询计划做出科学的决策。

### 5.1 使用 EXPLAIN ANALYZE 分析查询计划

在 Laravel 中分析慢查询的方法如下：

```php
use Illuminate\Support\Facades\DB;

// 获取查询的执行计划
$query = DB::table('products')
    ->whereRaw("attributes->>'brand' = ?", ['Apple'])
    ->whereRaw("name % ?", ['iPhone'])
    ->orderByRaw("similarity(name, 'iPhone') DESC");

$plan = DB::select(
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " . $query->toSql(),
    $query->getBindings()
);

// 输出执行计划
foreach ($plan as $line) {
    logger()->info($line->{'QUERY PLAN'});
}
```

在分析执行计划时，需要重点关注以下几个指标：首先看是否有 `Seq Scan`（全表扫描），如果在大表上出现全表扫描，通常意味着缺少合适的索引。其次看 `actual time`，它包含两个数字，第一个是返回第一行的耗时，第二个是返回所有行的总耗时。如果两个数字差距很大，说明存在数据倾斜或者排序开销。最后看 `Buffers`，它显示了实际读取的共享缓冲区页面数量，可以帮助判断 IO 瓶颈。

### 5.2 索引选择策略

不同的查询特性需要不同的索引类型，选择错误的索引不仅无法提升性能，反而可能因为索引维护开销导致写入变慢。以下是一份索引选择速查表：

对于窗口函数中的 `ORDER BY` 和 `PARTITION BY` 列，应该创建普通的 B-Tree 索引。比如 `ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY sold_count DESC)` 这个窗口函数，最优的索引是 `CREATE INDEX idx_products_category_sold ON products (category_id, sold_count DESC)`。

对于 CTE 查询，CTE 本身不产生独立的索引需求，它本质上只是定义了一个临时结果集。但 CTE 中引用的基础表仍然需要根据查询条件建立适当的索引。

对于 JSONB 字段的等值查询和包含查询，优先使用 GIN 索引；对于高频的固定路径查询，使用表达式索引性能更优。两种索引可以同时存在，PostgreSQL 会根据查询条件自动选择最合适的索引。

对于 pg_trgm 模糊搜索，必须使用 GIN 索引配合 `gin_trgm_ops` 操作符类。如果磁盘空间有限，也可以使用 GiST 索引替代，查询性能略低但索引体积更小。

### 5.3 大表在线建索引

在生产环境中为已有数据的大表添加索引时，普通的 `CREATE INDEX` 语句会对表加排他锁，阻塞所有写入操作。PostgreSQL 提供了 `CREATE INDEX CONCURRENTLY` 语法，可以在不阻塞写入的情况下创建索引：

```php
// 在 Laravel Migration 中使用 CONCURRENTLY 创建索引
public function up()
{
    DB::statement('CREATE INDEX CONCURRENTLY idx_products_name_trgm ON products USING GIN (name gin_trgm_ops)');
}

// 注意：使用 CONCURRENTLY 时不能在事务中执行
// 需要在 Migration 类中设置 $withinTransaction = false
```

---

## 六、常见陷阱与最佳实践

在实际项目中使用这些高级特性时，有一些容易踩到的坑需要特别注意。

**第一个陷阱：窗口函数不能直接用于 WHERE 子句。** 这是初学者最容易犯的错误。窗口函数的执行顺序在 `WHERE` 之后、`SELECT` 之前，所以不能在 `WHERE` 中直接引用窗口函数的结果。必须将其包装在子查询或者 CTE 中，然后在外层查询中进行过滤。

**第二个陷阱：CTE 的物化行为。** 在 PostgreSQL 12 之前的版本中，CTE 始终是"优化围栏"——优化器不会将 CTE 中的条件下推到基础表上。PostgreSQL 12 及之后的版本默认会对 CTE 进行内联优化，但如果 CTE 中包含了 `LIMIT`、`OFFSET`、`DISTINCT` 等可能改变结果集语义的子句，优化器仍然会选择物化 CTE。在数据量较大的场景下，CTE 物化会生成临时表，占用临时内存空间，需要留意。

**第三个陷阱：JSONB 的写放大问题。** 频繁更新 JSONB 字段会导致 TOAST 表膨胀，因为每次更新都是替换整个 JSON 值（即使只修改了一个子字段）。对于高频更新的字段，建议独立建列而非放入 JSONB 中。同时，定期对 JSONB 列进行 `VACUUM` 或使用 `pg_repack` 工具来回收空间。

**第四个陷阱：pg_trgm 索引的体积。** GIN 索引在大表上可能占用表体积百分之十到三十的空间。如果商品表有五百万条记录，GIN 索引可能达到数 GB。在磁盘空间紧张的场景下，需要提前评估索引体积。

**最佳实践总结：**

一、始终优先让数据库完成计算和过滤，避免将大量原始数据拉到 PHP 层处理。数据库引擎的查询优化器和执行引擎是专门为此设计的，通常比应用层代码高效得多。

二、为 JSONB 字段的高频查询路径创建表达式索引，为低频或多样化的查询创建 GIN 索引。两种索引可以共存，根据查询模式灵活选择。

三、使用 `EXPLAIN ANALYZE` 诊断每一个慢查询，不要凭感觉加索引。有时候一个复合索引比多个单列索引更有效。

四、在测试环境用接近生产环境的数据量进行性能测试。在十行数据上表现良好的查询，在一千万行数据上可能会完全不同的表现。

五、为所有文本搜索建立 pg_trgm 索引前，先评估索引的体积和构建时间。对于超大表，使用 `CREATE INDEX CONCURRENTLY` 避免锁表。

六、合理设置数据库参数，比如 `work_mem`（影响窗口函数和排序操作的内存使用）、`shared_buffers`（影响缓存命中率）、`effective_cache_size`（影响优化器的成本估算）。

---

## 总结

PostgreSQL 的 Window Functions、CTE、JSONB 和 pg_trgm 四大高级特性，为 Laravel 开发者提供了强大的数据库层计算能力。通过将复杂的数据处理逻辑下沉到数据库，我们不仅能够获得数量级的性能提升，还能让代码更加简洁和可维护。Window Functions 让我们告别了繁琐的子查询和自连接；CTE 让复杂查询变得模块化和可读；JSONB 让半结构化数据的存储和查询变得优雅高效；pg_trgm 则为模糊搜索提供了开箱即用的解决方案。

在实际项目中，建议从最影响用户体验的慢查询入手，逐步引入这些高级特性。每一步优化都用 `EXPLAIN ANALYZE` 来验证效果，用真实数据来评估收益。善用这些工具，你的 Laravel 应用将能够在 PostgreSQL 的强大加持下从容应对日益增长的业务规模和海量数据的挑战。同时也需要密切关注数据库服务器的负载变化和查询响应时间，确保各项性能优化措施真正发挥预期的积极作用和效果。

---

## 相关阅读

- [数据库连接池实战：PgBouncer、ProxySQL、Supabase 对比与 Laravel 集成](/categories/MySQL/database-connection-pool-pgbouncer-proxysql-supabase-comparison/)——PostgreSQL 生产环境必备的连接池方案，与本文的高级特性互补
- [数据库多租户模式对比实战：共享库 Row-Level vs Schema-per-Tenant vs 独立库——Laravel 中的三种方案深度权衡](/categories/数据库/数据库多租户模式对比实战-共享库Row-Level-vs-Schema-per-Tenant-vs-独立库-Laravel中的三种方案深度权衡/)——PostgreSQL 的 Row-Level Security 多租户方案，结合本文 JSONB 特性可实现灵活的租户数据隔离
- [MySQL 分区表实战：Range、List、Hash——Laravel 月度订单分区策略与查询路由](/categories/MySQL/2026-06-05-MySQL-分区表实战-Range-List-Hash-Laravel月度订单分区策略与查询路由/)——MySQL 分区表方案与本文 PostgreSQL 高级特性的对比参考
- [ClickHouse vs PostgreSQL 分析查询对比与 Laravel 集成](/categories/MySQL/2026-06-02-clickhouse-vs-postgresql-olap-selection-laravel-integration/)——当分析查询场景更复杂时，如何在 ClickHouse 和 PostgreSQL 之间做出选择
- [Laravel + PostgreSQL JSONB 实战指南](/categories/PHP/laravel-postgresql-jsonb-guide-gin-index-index/)——JSONB 的更多 Laravel 实战技巧与 GIN 索引深度解析
