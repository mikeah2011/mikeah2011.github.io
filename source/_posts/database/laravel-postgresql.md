---
title: Laravel 中 PostgreSQL 高级特性实战指南
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
date: 2026-06-05 10:00:00
tags:
  - Laravel
  - PostgreSQL
  - 数据库
  - PHP
  - Window-Functions
  - CTE
  - JSONB
  - pg-trgm
  - 性能调优
  - 复杂查询
categories:
  - database
description: 深入实战 PostgreSQL 在 Laravel 项目中的六大高级特性：Window Functions 窗口函数分组排名与移动平均、CTE 递归查询处理树形数据与图遍历、JSONB 文档存储与 GIN 索引高效查询、pg_trgm 模糊搜索与中文相似度匹配、物化视图预聚合加速报表查询、数组类型与 GIN 索引标签系统。每个特性均附可运行的 SQL 与 Laravel Eloquent 代码示例，配合 EXPLAIN 执行计划分析与生产踩坑案例，帮助后端开发者将复杂查询从应用层下沉到数据库层，实现性能与可维护性的双重提升。
keywords: [Laravel, PostgreSQL, 高级特性实战指南, 数据库]
---


# Laravel 中 PostgreSQL 高级特性实战指南

## 前言

PostgreSQL 作为功能最强大的开源关系型数据库之一，提供了许多 MySQL 无法比拟的高级特性。而 Laravel 作为 PHP 生态中最流行的框架，对 PostgreSQL 的支持也越来越完善。本文将深入介绍如何在 Laravel 项目中充分利用 PostgreSQL 的高级特性，帮助你构建更强大、更高效的应用。

## 一、环境准备

### 1.1 安装与配置

首先确保 `composer.json` 中安装了 PostgreSQL 驱动：

```bash
# macOS
brew install postgresql@16

# Ubuntu/Debian
sudo apt install postgresql-16 php-pgsql

# 确认 PHP PDO 驱动已加载
php -m | grep pgsql
```

在 `.env` 中配置 PostgreSQL 连接：

```env
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=laravel_app
DB_USERNAME=postgres
DB_PASSWORD=secret
```

### 1.2 Laravel 配置

在 `config/database.php` 中，PostgreSQL 的默认配置如下：

```php
'pgsql' => [
    'driver' => 'pgsql',
    'url' => env('DB_URL'),
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '5432'),
    'database' => env('DB_DATABASE', 'laravel'),
    'username' => env('DB_USERNAME', 'forge'),
    'password' => env('DB_PASSWORD', ''),
    'charset' => env('DB_CHARSET', 'utf8'),
    'prefix' => '',
    'prefix_indexes' => true,
    'search_path' => 'public',
    'sslmode' => 'prefer',
],
```

> **提示：** `search_path` 是 PostgreSQL 特有的概念，类似于 MySQL 的 database，可以实现多租户的数据隔离。

---

## 二、JSONB 类型——比 MySQL JSON 强大一个量级

PostgreSQL 的 `JSONB` 类型是其最实用的高级特性之一。与 MySQL 的 JSON 类型不同，`JSONB` 存储的是二进制格式，支持索引，查询性能极高。

### 2.1 迁移定义

```php
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

Schema::create('products', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->jsonb('attributes')->default('{}');  // JSONB 类型
    $table->jsonb('metadata')->nullable();
    $table->timestamps();

    // 创建 GIN 索引，大幅提升 JSONB 查询性能
    $table->index('attributes', null, 'gin');
});
```

### 2.2 JSONB 查询操作

Laravel 为 PostgreSQL 的 JSONB 提供了丰富的查询方法：

```php
use App\Models\Product;

// JSON 路径查询：获取嵌套字段
Product::where('attributes->color', 'red')->get();

// 检查 JSON 数组是否包含某个值
Product::whereJsonContains('attributes->tags', 'premium')->get();

// JSON 键存在性检查
Product::whereJsonContainsKey('attributes->brand')->get();

// JSON 长度查询
Product::whereJsonLength('attributes->tags', '>', 2)->get();
```

### 2.3 JSONB 高级索引

```php
// 迁移中创建表达式索引
Schema::table('products', function (Blueprint $table) {
    // GIN 索引：支持 @>, ?, ?|, ?& 操作符
    $table->raw('CREATE INDEX idx_products_attrs ON products USING GIN (attributes)');

    // 针对特定路径的索引
    $table->raw(
        "CREATE INDEX idx_products_color ON products USING BTREE ((attributes->>'color'))"
    );
});
```

```php
// 使用 GIN 索引的包含查询（性能极佳）
Product::where('attributes', '@>', ['color' => 'red', 'size' => 'L'])->get();

// 使用原生 DB 查询进行复杂的 JSONB 操作
$products = DB::table('products')
    ->selectRaw("name, attributes->>'color' as color")
    ->whereRaw("attributes @> ?", [json_encode(['brand' => 'Apple'])])
    ->get();
```

---

## 三、数组类型——PostgreSQL 独有利器

PostgreSQL 支持原生数组类型，这在 MySQL 中需要使用 JSON 或关联表才能实现。

### 3.1 定义数组列

```php
Schema::create('articles', function (Blueprint $table) {
    $table->id();
    $table->string('title');
    $table->text('content');
    $table->jsonb('tags');           // 方式一：使用 JSONB 存储数组
    $table->timestamps();
});
```

对于原生 PostgreSQL 数组，需要直接使用 `DB::statement`：

```php
Schema::create('articles', function (Blueprint $table) {
    $table->id();
    $table->string('title');
    $table->timestamps();
});

// 使用原生 SQL 创建数组列
DB::statement("ALTER TABLE articles ADD COLUMN tags TEXT[] DEFAULT '{}'");
DB::statement("CREATE INDEX idx_articles_tags ON articles USING GIN (tags)");
```

### 3.2 数组查询

```php
// 包含查询：tags 数组中包含 'php'
$articles = DB::table('articles')
    ->whereRaw("'php' = ANY(tags)")
    ->get();

// 重叠查询：tags 数组与给定数组有交集
$articles = DB::table('articles')
    ->whereRaw("tags && ARRAY['php', 'laravel']::TEXT[]")
    ->get();

// 包含所有元素
$articles = DB::table('articles')
    ->whereRaw("tags @> ARRAY['php', 'postgresql']::TEXT[]")
    ->get();

// 数组长度
$articles = DB::table('articles')
    ->whereRaw("array_length(tags, 1) > 2")
    ->get();
```

---

## 四、全文搜索——替代 Elasticsearch 的轻量方案

PostgreSQL 内置了强大的全文搜索引擎，对于中小规模项目完全可以替代 Elasticsearch。

### 4.1 配置全文搜索

```php
// 迁移中添加 tsvector 列
Schema::table('articles', function (Blueprint $table) {
    $table->addColumn('tsvector', 'search_vector')->nullable();
});

// 创建 GIN 索引
DB::statement(
    'CREATE INDEX idx_articles_search ON articles USING GIN (search_vector)'
);

// 创建触发器自动更新搜索向量
DB::statement("
    CREATE OR REPLACE FUNCTION articles_search_trigger() RETURNS trigger AS $$
    BEGIN
        NEW.search_vector :=
            setweight(to_tsvector('chinese', COALESCE(NEW.title, '')), 'A') ||
            setweight(to_tsvector('chinese', COALESCE(NEW.content, '')), 'B');
        RETURN NEW;
    END
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER tsvector_update BEFORE INSERT OR UPDATE ON articles
    FOR EACH ROW EXECUTE FUNCTION articles_search_trigger();
");
```

> **中文全文搜索：** 需要安装 `zhparser` 扩展。安装后使用 `to_tsvector('chinese', content)` 替代默认的英文分词器。或者使用 `pg_jieba` 分词扩展获得更好的中文分词效果。

### 4.2 执行全文搜索

```php
use Illuminate\Support\Facades\DB;

class ArticleSearchService
{
    /**
     * 全文搜索文章
     */
    public function search(string $query, int $limit = 20)
    {
        $tsQuery = "plainto_tsquery('chinese', ?)";

        return DB::table('articles')
            ->select([
                'id',
                'title',
                'content',
                DB::raw("ts_rank(search_vector, {$tsQuery}) as rank"),
                DB::raw("ts_headline('chinese', content, {$tsQuery}, 
                    'StartSel=<mark>, StopSel=</mark>, MaxWords=60, MinWords=20') as headline"),
            ])
            ->whereRaw("search_vector @@ {$tsQuery}", [$query, $query])
            ->orderByDesc('rank')
            ->limit($limit)
            ->get();
    }

    /**
     * 带权重的搜索
     */
    public function searchWithWeights(string $query)
    {
        return DB::table('articles')
            ->whereRaw(
                "search_vector @@ plainto_tsquery('chinese', ?)",
                [$query]
            )
            ->selectRaw("
                *,
                ts_rank_cd(search_vector, plainto_tsquery('chinese', ?), 32) as rank
            ", [$query])
            ->orderByDesc('rank')
            ->paginate(15);
    }
}
```

### 4.3 在 Model 中封装

```php
// app/Models/Article.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class Article extends Model
{
    /**
     * 全文搜索作用域
     */
    public function scopeSearchFullText(Builder $query, string $search): Builder
    {
        return $query
            ->whereRaw(
                "search_vector @@ plainto_tsquery('chinese', ?)",
                [$search]
            )
            ->selectRaw(
                "*, ts_rank(search_vector, plainto_tsquery('chinese', ?)) as relevance",
                [$search]
            )
            ->orderByDesc('relevance');
    }

    /**
     * 相似度搜索（模糊匹配）
     */
    public function scopeSimilarTo(Builder $query, string $text): Builder
    {
        return $query->whereRaw(
            "similarity(title, ?) > 0.3",
            [$text]
        )->orderByRaw("similarity(title, ?) DESC", [$text]);
    }
}
```

---

## 五、CTE 与递归查询——处理树形数据

PostgreSQL 对 Common Table Expressions (CTE) 的支持非常完善，特别适合处理分类、评论回复等树形结构数据。

### 5.1 普通 CTE 查询

```php
// 使用 CTE 进行复杂的数据聚合
$results = DB::query()
    ->withRecursiveExpression('category_stats', "
        SELECT 
            c.id,
            c.name,
            c.parent_id,
            (SELECT COUNT(*) FROM products WHERE category_id = c.id) as product_count
        FROM categories c
    ")
    ->from('category_stats')
    ->where('product_count', '>', 10)
    ->get();
```

### 5.2 递归查询树形结构

假设有一个无限层级的分类表：

```php
Schema::create('categories', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->unsignedBigInteger('parent_id')->nullable();
    $table->foreign('parent_id')->references('id')->on('categories');
    $table->timestamps();
});
```

查询某个分类及其所有子分类：

```php
class Category extends Model
{
    /**
     * 获取分类树（含所有子孙）
     */
    public static function getDescendants(int $categoryId): \Illuminate\Support\Collection
    {
        return DB::query()
            ->withRecursiveExpression('descendants', "
                SELECT id, name, parent_id, 0 as depth, ARRAY[id] as path
                FROM categories
                WHERE id = ?
                UNION ALL
                SELECT c.id, c.name, c.parent_id, d.depth + 1, d.path || c.id
                FROM categories c
                INNER JOIN descendants d ON c.parent_id = d.id
            ", [$categoryId])
            ->from('descendants')
            ->orderBy('path')
            ->get();
    }

    /**
     * 获取从根到当前节点的完整路径（面包屑导航）
     */
    public static function getAncestors(int $categoryId): \Illuminate\Support\Collection
    {
        return DB::query()
            ->withRecursiveExpression('ancestors', "
                SELECT id, name, parent_id
                FROM categories
                WHERE id = ?
                UNION ALL
                SELECT c.id, c.name, c.parent_id
                FROM categories c
                INNER JOIN ancestors a ON c.id = a.parent_id
            ", [$categoryId])
            ->from('ancestors')
            ->get();
    }
}
```

### 5.3 递归查询在 Laravel 中的封装

```php
// app/Concerns/HasRecursiveCte.php
namespace App\Concerns;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

trait HasRecursiveCte
{
    public function scopeWithDescendants(Builder $query, int $id, int $maxDepth = 10): Builder
    {
        $table = $this->getTable();

        return $query->fromSub(
            DB::query()->withRecursiveExpression('tree', "
                SELECT *, 0 as depth FROM {$table} WHERE id = {$id}
                UNION ALL
                SELECT t.*, tree.depth + 1 
                FROM {$table} t 
                JOIN tree ON t.parent_id = tree.id 
                WHERE tree.depth < {$maxDepth}
            ")->from('tree'),
            $this->getTable()
        );
    }
}
```

---

## 六、物化视图——报表查询的加速神器

物化视图 (Materialized View) 是 PostgreSQL 的独有特性，它将查询结果持久化存储，非常适合报表和统计场景。

### 6.1 创建物化视图

```php
// database/migrations/xxxx_create_product_stats_view.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("
            CREATE MATERIALIZED VIEW product_stats AS
            SELECT 
                c.id as category_id,
                c.name as category_name,
                COUNT(p.id) as product_count,
                AVG(p.price) as avg_price,
                MAX(p.price) as max_price,
                MIN(p.price) as min_price,
                SUM(p.stock) as total_stock,
                COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_count
            FROM categories c
            LEFT JOIN products p ON p.category_id = c.id
            GROUP BY c.id, c.name
            WITH DATA;

            CREATE UNIQUE INDEX idx_product_stats_id ON product_stats (category_id);
        ");
    }

    public function down(): void
    {
        DB::statement('DROP MATERIALIZED VIEW IF EXISTS product_stats');
    }
};
```

### 6.2 使用与刷新物化视图

```php
// app/Services/ProductStatsService.php
namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Collection;

class ProductStatsService
{
    /**
     * 查询物化视图（毫秒级响应）
     */
    public function getStats(): Collection
    {
        return DB::table('product_stats')
            ->orderByDesc('product_count')
            ->get();
    }

    /**
     * 刷新物化视图（无并发刷新会阻塞读取）
     */
    public function refresh(): void
    {
        DB::statement('REFRESH MATERIALIZED VIEW CONCURRENTLY product_stats');
    }

    /**
     * 带增量更新的定时刷新（通过 Scheduler 调度）
     */
    public function scheduleRefresh(): void
    {
        // 记录上次刷新时间
        $lastRefresh = cache('product_stats_last_refresh');

        if (!$lastRefresh || now()->diffInMinutes($lastRefresh) >= 30) {
            $this->refresh();
            cache(['product_stats_last_refresh' => now()], now()->addHours(2));
        }
    }
}
```

在 `app/Console/Kernel.php` 中配置定时刷新：

```php
protected function schedule(Schedule $schedule): void
{
    $schedule->call(function () {
        app(ProductStatsService::class)->refresh();
    })->everyThirtyMinutes()->name('refresh-product-stats');
}
```

---

## 七、Lateral Join——每组取 Top N 的优雅方案

Lateral Join 是 PostgreSQL 的高级 JOIN 特性，完美解决了"每组取最新 N 条记录"的经典问题。

### 7.1 原始 SQL 思路

```sql
-- 每个用户的最新3条订单
SELECT u.*, o.*
FROM users u
CROSS JOIN LATERAL (
    SELECT * FROM orders 
    WHERE user_id = u.id 
    ORDER BY created_at DESC 
    LIMIT 3
) o;
```

### 7.2 Laravel 中使用 Lateral Join

```php
use Illuminate\Support\Facades\DB;

class OrderService
{
    /**
     * 获取每个用户的最新N条订单
     */
    public function getLatestOrdersPerUser(int $limit = 3)
    {
        $subQuery = DB::table('orders as o')
            ->select('o.*')
            ->whereColumn('o.user_id', 'users.id')
            ->orderByDesc('o.created_at')
            ->limit($limit);

        return DB::table('users')
            ->joinLateral($subQuery, 'latest_orders')
            ->select('users.name', 'latest_orders.*')
            ->get();
    }

    /**
     * 获取每个分类中价格最低的商品
     */
    public function getCheapestPerCategory()
    {
        $subQuery = DB::table('products as p')
            ->select('p.*')
            ->whereColumn('p.category_id', 'categories.id')
            ->orderBy('p.price')
            ->limit(1);

        return DB::table('categories')
            ->joinLateral($subQuery, 'cheapest')
            ->select('categories.name as category', 'cheapest.name', 'cheapest.price')
            ->get();
    }
}
```

> **注意：** `joinLateral` 和 `crossJoinLateral` 是 Laravel 9.x+ 引入的方法，仅在 PostgreSQL 连接下可用。

---

## 八、自定义类型与枚举

### 8.1 PostgreSQL 原生枚举类型

```php
// 创建自定义枚举类型
DB::statement("CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled')");

Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->decimal('total', 10, 2);
    $table->addColumn('order_status', 'status')->default('pending');
    $table->timestamps();
});
```

### 8.2 Range 类型

PostgreSQL 支持范围类型，非常适合处理时间段、价格区间等：

```php
// 创建事件表，使用 tsrange 类型
Schema::create('events', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->timestamps();
});

DB::statement("ALTER TABLE events ADD COLUMN duration TSRANGE");

// 插入数据
DB::table('events')->insert([
    'name' => 'Laravel Meetup',
    'duration' => '[2026-06-01 14:00, 2026-06-01 17:00)',
]);

// 查询时间重叠的事件
$events = DB::table('events')
    ->whereRaw("duration && TSRANGE(?, ?)", ['2026-06-01 15:00', '2026-06-01 16:00'])
    ->get();
```

---

## 九、窗口函数——复杂分析查询

PostgreSQL 的窗口函数支持非常完善，在 Laravel 中可以直接使用：

```php
// 为每个用户的订单按金额排名
$orders = DB::table('orders')
    ->select([
        'orders.*',
        DB::raw('ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY total DESC) as rank'),
        DB::raw('SUM(total) OVER (PARTITION BY user_id) as user_total'),
        DB::raw('AVG(total) OVER () as global_avg'),
    ])
    ->get();

// 计算移动平均
$monthlySales = DB::table('orders')
    ->selectRaw("
        DATE_TRUNC('month', created_at) as month,
        SUM(total) as monthly_total,
        AVG(SUM(total)) OVER (ORDER BY DATE_TRUNC('month', created_at) 
            ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) as moving_avg_3m
    ")
    ->groupByRaw("DATE_TRUNC('month', created_at)")
    ->orderBy('month')
    ->get();
```

---

## 十、性能优化技巧

### 10.1 索引策略

```php
// 部分索引（Partial Index）：只为满足条件的行创建索引
DB::statement("
    CREATE INDEX idx_orders_pending ON orders (created_at) 
    WHERE status = 'pending'
");

// 覆盖索引（Covering Index）：使用 INCLUDE 避免回表
DB::statement("
    CREATE INDEX idx_orders_user_covering ON orders (user_id) 
    INCLUDE (total, status, created_at)
");

// 表达式索引
DB::statement("
    CREATE INDEX idx_users_lower_email ON users (LOWER(email))
");
```

### 10.2 EXPLAIN ANALYZE 分析

```php
// 在 Laravel 中执行查询分析
public function analyzeQuery()
{
    $query = DB::table('orders')
        ->where('status', 'pending')
        ->where('created_at', '>', now()->subDays(7));

    $explain = DB::select(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " . $query->toSql(),
        $query->getBindings()
    );

    return $explain;
}
```

### 10.3 连接池配置

对于高并发场景，推荐使用 `pgbouncer` 作为连接池：

```env
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=6432  # pgbouncer 默认端口
```

---

## 十一、PostGIS 空间数据（扩展）

如果你的应用涉及地理位置，PostGIS 扩展是不二之选：

```php
// 启用 PostGIS
DB::statement('CREATE EXTENSION IF NOT EXISTS postgis');

// 创建包含地理字段的表
Schema::create('stores', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->timestamps();
});
DB::statement("ALTER TABLE stores ADD COLUMN location GEOGRAPHY(POINT, 4326)");

// 插入地理位置数据
DB::table('stores')->insert([
    'name' => '北京旗舰店',
    "location" => DB::raw("ST_SetSRID(ST_MakePoint(116.4074, 39.9042), 4326)::geography"),
]);

// 查找附近 5 公里内的门店
$nearbyStores = DB::table('stores')
    ->selectRaw("
        name,
        ST_Distance(
            location, 
            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
        ) as distance_meters
    ", [116.4100, 39.9100])
    ->whereRaw("
        ST_DWithin(
            location, 
            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, 
            5000
        )
    ", [116.4100, 39.9100])
    ->orderBy('distance_meters')
    ->get();
```

---

## 十二、实际项目中的最佳实践

### 12.1 多租户方案（Schema 隔离）

```php
// app/Services/TenantService.php
class TenantService
{
    public function setupTenant(string $tenantId): void
    {
        // 为每个租户创建独立的 Schema
        DB::statement("CREATE SCHEMA IF NOT EXISTS tenant_{$tenantId}");
        
        // 切换搜索路径
        config(['database.connections.pgsql.search_path' => "tenant_{$tenantId},public"]);
        
        // 重新连接
        DB::purge('pgsql');
        DB::reconnect('pgsql');
        
        // 运行迁移
        Artisan::call('migrate', ['--path' => 'database/tenant-migrations']);
    }
}
```

### 12.2 事件通知（LISTEN/NOTIFY）

```php
// 监听数据库事件（适合实时通知场景）
use Swoole\Coroutine;

// 发送通知
DB::statement("NOTIFY order_channel, ?", [json_encode(['order_id' => 123, 'status' => 'shipped'])]);

// 在 Laravel Queue Worker 或自定义命令中监听
class DatabaseNotificationListener
{
    public function handle(): void
    {
        // 使用 pg_listen 扩展或第三方包实现异步监听
        // 推荐：react/promise 或 amphp 异步框架
    }
}
```

---

## 总结

| 特性 | 适用场景 | 性能优势 |
|------|----------|----------|
| JSONB | 灵活 schema、文档存储 | GIN 索引查询快 |
| 全文搜索 | 文章搜索、内容检索 | 替代 ES 轻量方案 |
| 数组类型 | 标签、分类 | 减少关联表 |
| 递归 CTE | 树形结构、评论回复 | 一次查询获取整棵树 |
| 物化视图 | 报表、统计看板 | 预计算结果，查询极快 |
| Lateral Join | 每组 Top N | 优雅替代子查询 |
| 窗口函数 | 排名、移动平均 | 避免多次查询 |
| PostGIS | 地理位置服务 | 专业空间索引 |

PostgreSQL 的高级特性远不止这些，还包括：

- **分区表 (Partitioning)**：适合大数据量的时序数据
- **外部数据包装器 (FDW)**：连接 MySQL、MongoDB 等异构数据源
- **逻辑复制 (Logical Replication)**：实时数据同步
- **行级安全策略 (RLS)**：数据库层面的权限控制

在 Laravel 项目中善用这些 PostgreSQL 特性，可以大幅减少应用层代码复杂度，提升查询性能，让你的系统更加健壮和高效。

---

## 相关阅读

- [PostgreSQL Logical Replication 实战：零停机数据迁移与实时同步——Laravel 多库架构的基石](/categories/MySQL/数据库/PostgreSQL-Logical-Replication-实战-零停机数据迁移与实时数据同步/)——本文提到的 Logical Replication 深度实战
- [Neon Serverless PostgreSQL 实战：分支工作流与 Laravel 开发体验](/categories/MySQL/数据库/Neon-Serverless-PostgreSQL-实战-分支工作流与Laravel-开发体验/)——Serverless PostgreSQL 的开发体验与本文互补
- [MySQL 窗口函数实战：ROW_NUMBER、RANK、DENSE_RANK](/categories/MySQL/数据库/mysql-guide-row-number-rank-dense-rank/)——MySQL 窗口函数与本文 PostgreSQL 窗口函数的横向对比

---

## 参考资料

- [PostgreSQL 官方文档](https://www.postgresql.org/docs/16/)
- [Laravel Database 文档](https://laravel.com/docs/11.x/database)
- [Laravel PostgreSQL JSON 查询](https://laravel.com/docs/11.x/queries#json-where-clauses)
- [PGroonga：多语言全文搜索扩展](https://pgroonga.github.io/)
