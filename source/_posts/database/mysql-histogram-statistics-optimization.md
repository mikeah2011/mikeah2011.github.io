---
title: MySQL Histogram 统计实战：直方图驱动的查询优化器——数据分布感知的索引选择与 Laravel 性能调优
keywords: [MySQL Histogram, Laravel, 统计实战, 直方图驱动的查询优化器, 数据分布感知的索引选择与, 性能调优, 数据库]
date: 2026-06-10 04:18:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - MySQL
  - 查询优化
  - 直方图
  - Laravel
  - 性能调优
  - Histogram
description: 深入 MySQL 8.0 直方图统计特性，通过 ANALYZE TABLE ... UPDATE HISTOGRAM 掌握数据分布感知的索引选择策略，结合 Laravel 实战案例展示如何利用直方图优化慢查询。
---


## 概述

在日常数据库调优中，我们习惯性地通过 `EXPLAIN` 查看执行计划，然后加索引、改 SQL。但有一个经常被忽视的问题：**MySQL 优化器选择索引的依据是什么？**

答案是**统计信息**。优化器依赖表的基数（Cardinality）、数据分布等统计信息来估算不同执行路径的成本。当统计信息与实际数据严重偏差时，优化器就会做出错误的索引选择，导致慢查询。

MySQL 8.0 引入了 **Histogram（直方图）统计**，让优化器能更精确地感知列的数据分布，从而做出更优的执行计划。本文将深入直方图的原理与实战，结合 Laravel 项目展示具体应用。

## 核心概念

### 为什么需要直方图？

传统的统计信息只有索引列的基数（Cardinality）——也就是"有多少个不同的值"。这在很多场景下够用，但存在明显盲区：

**场景一：数据分布不均匀**

假设 `orders` 表有一个 `status` 列：

```sql
status = 'pending'    -- 50 万条（90%）
status = 'completed'  -- 4 万条（7%）
status = 'cancelled'  -- 1.5 万条（2.5%）
status = 'refunded'   -- 3000 条（0.5%）
```

优化器只知道 `status` 有 4 个不同值，如果用 `status = 'refunded'` 查询，它可能认为会返回 50万/4 = 12.5 万行，从而选择全表扫描。但实际上只返回 3000 行，走索引更快。

**场景二：没有索引的列**

有些列不适合建索引（低选择性、频繁更新），但查询时确实需要过滤。没有直方图时，优化器对这类列完全"失明"。

**直方图的作用**：记录列值的实际分布情况，让优化器知道"某个值大概有多少行"，从而估算更精确的行数和成本。

### 直方图的两种类型

MySQL 支持两种直方图：

```sql
-- 1. 等宽直方图（EQUI_HEIGHT）
-- 将值域等分为 N 个 bucket，每个 bucket 记录边界值和频次
-- 适合数据分布比较均匀的场景

-- 2. 等频直方图（SINGLETON）
-- 每个不同的值一个 bucket，记录该值出现的次数
-- 适合不同值数量较少的场景（如枚举列）
```

MySQL 默认使用 `SINGLETON` 类型，且默认 bucket 数量为 100。对于高基数列（如用户 ID），会自动退化为 `EQUI_HEIGHT`。

### 关键语法

```sql
-- 创建/更新直方图
ANALYZE TABLE orders UPDATE HISTOGRAM ON status WITH 100 BUCKETS;

-- 查看直方图信息
SELECT * FROM information_schema.COLUMN_STATISTICS
WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'status';

-- 删除直方图
ANALYZE TABLE orders DROP HISTOGRAM ON status;
```

## 实战：从慢查询到直方图优化

### 问题复现

先看一个典型的慢查询场景。在 Laravel 项目中，我们有一个订单查询：

```php
// App\Models\Order
class Order extends Model
{
    protected $table = 'orders';

    // status: pending, paid, shipped, completed, cancelled, refunded
    // payment_method: alipay, wechat, credit_card, bank_transfer
}
```

查询需求：查找某用户的退款订单

```php
$orders = Order::where('user_id', $userId)
    ->where('status', 'refunded')
    ->where('created_at', '>=', $startDate)
    ->paginate(20);
```

这个查询有 `(user_id, created_at)` 的联合索引，但 `status` 列没有索引。我们来看看执行计划：

```sql
EXPLAIN SELECT * FROM orders
WHERE user_id = 12345
AND status = 'refunded'
AND created_at >= '2026-01-01';
```

```
+----+-------------+--------+------+-------------------+-------------------+---------+-------+------+-------------+
| id | select_type | table  | type | possible_keys     | key               | key_len | ref   | rows | Extra       |
+----+-------------+--------+------+-------------------+-------------------+---------+-------+------+-------------+
|  1 | SIMPLE      | orders | ref  | idx_user_created  | idx_user_created  | 8       | const |  150 | Using where |
+----+-------------+--------+------+-------------------+-------------------+---------+-------+------+-------------+
```

优化器预估扫描 150 行，但实际上 `status = 'refunded'` 只占 0.5%，对于一个用户来说可能只有 1-2 条退款记录。优化器高估了行数。

虽然这个例子看起来差别不大，但在复杂查询中，行数估算偏差会被放大——错误的行数估算会导致错误的 JOIN 顺序、错误的临时表策略、错误的排序方式。

### 创建直方图

针对 `status` 和 `payment_method` 这类低基数列，创建直方图：

```sql
-- 在业务低峰期执行
ANALYZE TABLE orders UPDATE HISTOGRAM ON status, payment_method WITH 50 BUCKETS;
```

查看直方图内容：

```sql
SELECT
    COLUMN_NAME,
    JSON_PRETTY(HISTOGRAM) as histogram
FROM information_schema.COLUMN_STATISTICS
WHERE TABLE_NAME = 'orders' AND SCHEMA_NAME = 'your_database';
```

直方图会存储类似这样的信息（简化版）：

```json
{
  "buckets": [
    ["alipay", 0.45],
    ["wechat", 0.35],
    ["credit_card", 0.15],
    ["bank_transfer", 0.05]
  ],
  "last-updated": "2026-06-10 04:00:00.000000",
  "sampling-rate": 1.0,
  "histogram-type": "singleton",
  "number-of-buckets-specified": 50,
  "data-type": "string",
  "null-values": 0.0,
  "collation-id": 255
}
```

现在优化器知道 `status = 'refunded'` 大约占 0.5%，行数估算会更精确。

### 验证效果

再次执行 `EXPLAIN`，可能发现行数估算更准确了。但更重要的是看实际执行时间：

```sql
-- 直方图前
-- 0.45 sec

-- 直方图后（某些场景优化器可能选择更优的执行路径）
-- 0.12 sec
```

直方图的效果不是"加了就一定变快"，而是让优化器更聪明。在某些场景下，优化器可能会选择完全不同的执行计划。

## Laravel 集成方案

### 1. Migration 中维护直方图

在 Laravel 的 migration 中，可以在数据迁移后更新直方图：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 先完成数据迁移...

        // 更新直方图统计
        DB::statement(
            'ANALYZE TABLE orders UPDATE HISTOGRAM ON status, payment_method WITH 50 BUCKETS'
        );

        // 记录更新日志
        $this->command->info('Histogram statistics updated for orders table');
    }

    public function down(): void
    {
        DB::statement(
            'ANALYZE TABLE orders DROP HISTOGRAM ON status'
        );
        DB::statement(
            'ANALYZE TABLE orders DROP HISTOGRAM ON payment_method'
        );
    }
};
```

### 2. Artisan 命令批量更新

创建一个 Artisan 命令，定期更新核心表的直方图：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class UpdateHistogramStatistics extends Command
{
    protected $signature = 'db:update-histograms
                            {--table= : 指定表名，不指定则更新所有配置的表}
                            {--buckets=50 : bucket 数量}';

    protected $description = '更新 MySQL 直方图统计信息';

    // 需要维护直方图的表和列
    protected array $histogramConfig = [
        'orders'      => ['status', 'payment_method', 'channel'],
        'products'    => ['category_id', 'status', 'brand_id'],
        'users'       => ['source', 'level', 'city_id'],
        'payments'    => ['status', 'method'],
    ];

    public function handle(): int
    {
        $table = $this->option('table');
        $buckets = (int) $this->option('buckets');

        $tables = $table ? [$table => $this->histogramConfig[$table] ?? []] : $this->histogramConfig;

        foreach ($tables as $tableName => $columns) {
            if (empty($columns)) {
                $this->warn("No histogram config for table: {$tableName}");
                continue;
            }

            $this->info("Updating histograms for {$tableName}...");

            $columnList = implode(', ', $columns);
            $sql = "ANALYZE TABLE {$tableName} UPDATE HISTOGRAM ON {$columnList} WITH {$buckets} BUCKETS";

            try {
                DB::statement($sql);
                $this->info("  ✓ Updated: {$columnList}");
            } catch (\Exception $e) {
                $this->error("  ✗ Failed: {$e->getMessage()}");
            }
        }

        $this->info('Done.');
        return self::SUCCESS;
    }
}
```

注册到 `Kernel.php`，安排每周执行：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每周日凌晨 3 点更新直方图（低峰期）
    $schedule->command('db:update-histograms')
             ->weeklyOn(0, '03:00')
             ->withoutOverlapping()
             ->runInBackground();
}
```

### 3. 查询构建器中利用直方图

虽然直方图是自动生效的（优化器自动使用），但我们可以在代码层面做一些配合：

```php
<?php

namespace App\Services\Order;

use App\Models\Order;
use Illuminate\Support\Facades\DB;

class OrderQueryOptimizer
{
    /**
     * 带直方图感知的订单查询
     * 对于 status 这类低基数列，直方图能帮助优化器做出更好的选择
     */
    public function getRefundedOrders(int $userId, string $startDate): array
    {
        // 直接查询，让优化器利用直方图统计自动选择最优执行路径
        return Order::query()
            ->where('user_id', $userId)
            ->where('status', Order::STATUS_REFUNDED)
            ->where('created_at', '>=', $startDate)
            ->orderByDesc('created_at')
            ->paginate(20)
            ->toArray();
    }

    /**
     * 分析查询执行计划
     * 用于调试：对比有无直方图时的执行计划差异
     */
    public function analyzeQuery(int $userId, string $status): array
    {
        $sql = sprintf(
            "EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = %d AND status = '%s'",
            $userId,
            $status
        );

        return DB::select($sql);
    }

    /**
     * 检查表的直方图状态
     */
    public function getHistogramInfo(string $table): array
    {
        return DB::select(
            "SELECT COLUMN_NAME, HISTOGRAM
             FROM information_schema.COLUMN_STATISTICS
             WHERE TABLE_NAME = ? AND SCHEMA_NAME = DATABASE()",
            [$table]
        );
    }
}
```

## 踩坑记录

### 坑 1：直方图不会自动更新

直方图是**静态快照**，不会随数据变化自动更新。如果数据分布发生显著变化（比如某次大促导致大量订单状态变更），必须手动重新生成。

**解决方案**：

- 在批量数据操作（migration、数据修复）后，主动调用 `ANALYZE TABLE ... UPDATE HISTOGRAM`
- 定期（如每周）更新核心表的直方图
- 监控 `COLUMN_STATISTICS` 的 `last-updated` 字段，超过阈值时告警

```php
// 监控直方图新鲜度
$stale = DB::select("
    SELECT TABLE_NAME, COLUMN_NAME, HISTOGRAM->>'$.\"last-updated\"' as last_updated
    FROM information_schema.COLUMN_STATISTICS
    WHERE SCHEMA_NAME = DATABASE()
    AND HISTOGRAM->>'$.\"last-updated\"' < DATE_SUB(NOW(), INTERVAL 7 DAY)
");

if (!empty($stale)) {
    // 触发告警或自动更新
    Log::warning('Stale histograms detected', ['tables' => $stale]);
}
```

### 坑 2：直方图对高基数列效果有限

对于 `user_id`、`uuid` 这类高基数列（几百万个不同值），直方图的作用有限。MySQL 会自动将其转为 `EQUI_HEIGHT` 类型，但 bucket 数量有限，精度也有限。

**最佳实践**：

- 直方图适合**低基数列**（不同值 < 1000）：status、type、category、enum 等
- 高基数列还是靠**索引**解决问题
- 不要在不适合的列上浪费直方图

### 坑 3：`ANALYZE TABLE` 会短暂锁表

在大表上执行 `ANALYZE TABLE ... UPDATE HISTOGRAM` 会获取**共享读锁**，期间不能写入。虽然通常很快（几秒），但在亿级大表上可能需要更长时间。

**解决方案**：

```php
// 1. 选择低峰期执行
$schedule->command('db:update-histograms')
         ->dailyAt('03:00')  // 凌晨 3 点
         ->when(fn () => app()->isProduction());  // 仅生产环境

// 2. 使用 pt-online-schema-change 的思路
//    先在从库测试执行时间，评估对主库的影响

// 3. 监控执行时间
DB::listen(function ($query) {
    if (str_contains($query->sql, 'HISTOGRAM')) {
        Log::info('Histogram update', [
            'sql' => $query->sql,
            'time' => $query->time . 'ms',
        ]);
    }
});
```

### 坑 4：直方图与索引的交互

直方图和索引是**互补关系**，不是替代关系：

- 有索引的列：优化器用索引统计信息（更精确）
- 无索引的列：优化器用直方图统计信息
- 直方图可能让优化器在某些场景下选择**不走索引**——这是对的，当全表扫描成本更低时

```sql
-- 例：status 列有直方图但无索引
-- 当查询 status = 'pending'（占 90%）时，优化器正确选择全表扫描
-- 当查询 status = 'refunded'（占 0.5%）时，优化器可能建议加索引
```

### 坑 5：JSON 字段的直方图

MySQL 8.0.3+ 支持对 JSON 列创建直方图，但实际意义不大。JSON 字段的值太多样化，直方图很难提供有意义的分布信息。

```sql
-- 不推荐
ANALYZE TABLE products UPDATE HISTOGRAM ON metadata WITH 100 BUCKETS;

-- 推荐：对 JSON 中的特定路径生成虚拟列，再对虚拟列建直方图
ALTER TABLE products ADD COLUMN brand_id INT
    GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.brand_id'))) VIRTUAL;
ANALYZE TABLE products UPDATE HISTOGRAM ON brand_id WITH 50 BUCKETS;
```

## 进阶：直方图驱动的查询重写

利用直方图信息，我们可以做一些更聪明的查询优化：

```php
<?php

namespace App\Services\Query;

use Illuminate\Support\Facades\DB;

class HistogramAwareQuery
{
    /**
     * 根据直方图估算查询返回行数
     * 用于动态选择查询策略
     */
    public function estimateRowCount(string $table, string $column, mixed $value): ?float
    {
        $result = DB::selectOne(
            "SELECT HISTOGRAM FROM information_schema.COLUMN_STATISTICS
             WHERE TABLE_NAME = ? AND COLUMN_NAME = ? AND SCHEMA_NAME = DATABASE()",
            [$table, $column]
        );

        if (!$result) {
            return null; // 没有直方图
        }

        $histogram = json_decode($result->HISTOGRAM, true);

        // 获取表总行数
        $totalRows = DB::selectOne(
            "SELECT TABLE_ROWS FROM information_schema.TABLES
             WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()",
            [$table]
        )->TABLE_ROWS;

        // 在直方图中查找该值的频率
        $buckets = $histogram['buckets'] ?? [];
        foreach ($buckets as $bucket) {
            if ($bucket[0] == $value) {
                return $totalRows * $bucket[1]; // 返回估算行数
            }
        }

        return null;
    }

    /**
     * 动态选择分页策略
     * 小结果集：直接 LIMIT/OFFSET
     * 大结果集：游标分页
     */
    public function smartPaginate(string $table, array $filters, int $perPage = 20): array
    {
        $estimatedRows = 0;
        foreach ($filters as $column => $value) {
            $estimatedRows += $this->estimateRowCount($table, $column, $value) ?? 1000;
        }

        if ($estimatedRows > 10000) {
            // 大结果集：使用游标分页，避免深分页性能问题
            return $this->cursorPaginate($table, $filters, $perPage);
        }

        // 小结果集：标准分页
        return $this->offsetPaginate($table, $filters, $perPage);
    }

    private function cursorPaginate(string $table, array $filters, int $perPage): array
    {
        $query = DB::table($table);
        foreach ($filters as $column => $value) {
            $query->where($column, $value);
        }

        return $query->orderByDesc('id')
            ->cursorPaginate($perPage, ['*'], 'cursor')
            ->toArray();
    }

    private function offsetPaginate(string $table, array $filters, int $perPage): array
    {
        $query = DB::table($table);
        foreach ($filters as $column => $value) {
            $query->where($column, $value);
        }

        return $query->orderByDesc('id')
            ->paginate($perPage)
            ->toArray();
    }
}
```

## 总结

MySQL 直方图是一个被低估的优化利器。它的核心价值在于：

| 特性 | 说明 |
|------|------|
| **零成本生效** | 创建后优化器自动使用，无需改 SQL |
| **无存储开销** | 直方图存在 `information_schema` 中，不占用数据页 |
| **互补索引** | 覆盖索引无法触及的低基数列 |
| **维护简单** | 一条 `ANALYZE TABLE` 语句即可 |

**适用场景**：

- 低基数列（status、type、category 等枚举类字段）
- 不适合建索引但经常用于 WHERE 条件的列
- 数据分布严重不均匀的列

**不适合的场景**：

- 高基数列（用索引更好）
- 数据频繁变化的列（直方图不会自动更新）
- JSON 字段（除非先提取为虚拟列）

在 Laravel 项目中，建议将直方图维护纳入 DevOps 流程：migration 后更新、定时任务定期刷新、监控直方图新鲜度。这样优化器就能始终基于真实数据分布做出最优决策。
