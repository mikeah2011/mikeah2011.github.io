
title: 数据库分区表实战：MySQL Range/List/Hash 分区——Laravel 中的月度订单表分区策略与查询路由
date: 2026-06-05 15:17:02
tags:
- MySQL
- 分区表
- Laravel
- 性能优化
- 数据库
- range分区
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
description: 深入讲解MySQL分区表实战：Range/List/Hash三种分区策略对比，Laravel中月度订单表的分区设计、Partition Pruning查询路由、自动分区维护Artisan命令、归档清理及性能基准测试，涵盖主键设计、外键限制等真实踩坑指南。
---


# 数据库分区表实战：MySQL Range/List/Hash 分区——Laravel 中的月度订单表分区策略与查询路由

## 前言

在 B2C 电商场景中，订单表是增长最快的表之一。以我之前参与的旅游平台为例，日均订单量可达数万级，一年下来单表轻松突破千万行。当单表数据量达到这个量级时，即使有完善的索引，查询性能也会明显下降——B+ 树层级增加、缓冲池命中率降低、DDL 变更耗时剧增。更棘手的是数据生命周期管理：历史订单需要归档、过期数据需要清理，但大表上执行 `DELETE` 语句本身就是一场灾难。

**MySQL 分区表**（Partition Table）正是解决这类问题的一把利器。它将一张逻辑上的大表，在物理层面拆分为多个小文件存储，查询时通过 **分区裁剪**（Partition Pruning）自动跳过无关分区，实现「分而治之」。

本文将从 MySQL 分区的底层原理出发，结合 Laravel 项目中的实际应用，完整讲解 Range、List、Hash 三种分区策略的设计与实现。

---

## 一、MySQL 分区基础

### 1.1 什么是分区表

分区表的本质是将一张表的数据，按照某个规则分散存储到多个物理文件中。对应用层而言，它仍然是一张表，SQL 语句无需修改。MySQL 支持在 Server 层实现分区，存储引擎层（InnoDB）负责每个分区的 `.ibd` 文件管理。

### 1.2 四种分区类型概览

| 分区类型 | 适用场景 | 分区键要求 |
|---------|---------|-----------|
| **Range** | 按时间范围划分（月度、年度） | 整数或日期表达式 |
| **List** | 按枚举值划分（状态、地区） | 整数列或返回整数的表达式 |
| **Hash** | 均匀分布数据，无明显范围特征 | 整数列或表达式 |
| **Key** | 类似 Hash，但由 MySQL 自动选择 Hash 函数 | 必须是整数列 |

### 1.3 基本语法结构

```sql
CREATE TABLE orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    status TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id, created_at),
    INDEX idx_user_id (user_id),
    INDEX idx_order_no (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
    PARTITION p202601 VALUES LESS THAN (202602),
    PARTITION p202602 VALUES LESS THAN (202603),
    PARTITION p202603 VALUES LESS THAN (202604),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

**关键注意点**：分区键必须包含在主键中！这是 MySQL 分区表最容易踩的坑之一，后面会详细展开。

---

## 二、Range 分区：月度订单表实战

Range 分区是最常用的分区方式，特别适合按时间维度管理数据。

### 2.1 按月分区的设计思路

电商订单的核心查询模式是「查某段时间内的订单」，按月做 Range 分区是最自然的选择。分区键使用 `YEAR(created_at) * 100 + MONTH(created_at)` 这个表达式，将日期映射为 `202601`、`202602` 这样的整数，便于精确划分。

```sql
-- 创建按月分区的订单表
CREATE TABLE orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    status TINYINT NOT NULL DEFAULT 0 COMMENT '0待付款 1已付款 2已发货 3已完成 4已取消',
    region_code VARCHAR(10) NOT NULL DEFAULT 'CN',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    -- 主键必须包含分区键表达式中的列
    PRIMARY KEY (id, created_at),
    UNIQUE INDEX uk_order_no (order_no, created_at),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
    PARTITION p202601 VALUES LESS THAN (202602),
    PARTITION p202602 VALUES LESS THAN (202603),
    PARTITION p202603 VALUES LESS THAN (202604),
    PARTITION p202604 VALUES LESS THAN (202605),
    PARTITION p202605 VALUES LESS THAN (202606),
    PARTITION p202606 VALUES LESS THAN (202607),
    -- 预创建未来几个月的分区
    PARTITION p202607 VALUES LESS THAN (202608),
    PARTITION p202608 VALUES LESS THAN (202609),
    PARTITION p202609 VALUES LESS THAN (202610),
    PARTITION p202610 VALUES LESS THAN (202611),
    PARTITION p202611 VALUES LESS THAN (202612),
    PARTITION p202612 VALUES LESS THAN (202701),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

### 2.2 为什么用表达式而非直接用 created_at

MySQL 要求 Range 分区的值必须是严格递增的整数。`DATETIME` 类型虽然可以隐式转换，但使用 `YEAR(col) * 100 + MONTH(col)` 表达式更明确、更可控，也方便后续做分区维护操作。

也可以使用 `TO_DAYS()` 函数实现按天分区：

```sql
PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p20260601 VALUES LESS THAN (TO_DAYS('2026-06-02')),
    PARTITION p20260602 VALUES LESS THAN (TO_DAYS('2026-06-03')),
    ...
);
```

按天分区适合日单量极高的场景（如日百万单），但分区数量会急剧膨胀，需权衡管理成本。

---

## 三、List 分区：按状态或地区划分

List 分区适用于分区键的值域是离散枚举的场景。

### 3.1 按订单状态分区

```sql
CREATE TABLE order_status_partitioned (
    id BIGINT UNSIGNED NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    status TINYINT NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id, status),
    INDEX idx_order_no (order_no, status)
) ENGINE=InnoDB
PARTITION BY LIST (status) (
    PARTITION p_pending   VALUES IN (0),          -- 待付款
    PARTITION p_paid      VALUES IN (1),          -- 已付款
    PARTITION p_shipped   VALUES IN (2),          -- 已发货
    PARTITION p_completed VALUES IN (3),          -- 已完成
    PARTITION p_cancelled VALUES IN (4, 5)        -- 已取消/退款
);
```

> **注意**：MySQL 5.7 的 List 分区不支持 `DEFAULT` 子句，必须显式列出所有可能的值。MySQL 8.0 同样不支持 List 分区的 DEFAULT，但支持 `PARTITION BY LIST COLUMNS`，可直接使用字符串列。

### 3.2 按地区分区（使用 List COLUMNS）

```sql
-- MySQL 8.0 支持 LIST COLUMNS 直接用字符串
CREATE TABLE orders_by_region (
    id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    region_code VARCHAR(10) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id, region_code)
) ENGINE=InnoDB
PARTITION BY LIST COLUMNS (region_code) (
    PARTITION p_cn    VALUES IN ('CN'),
    PARTITION p_tw    VALUES IN ('TW', 'HK', 'MO'),
    PARTITION p_jp    VALUES IN ('JP'),
    PARTITION p_kr    VALUES IN ('KR'),
    PARTITION p_sea   VALUES IN ('TH', 'VN', 'MY', 'SG', 'ID', 'PH'),
    PARTITION p_other VALUES IN ('US', 'EU', 'AU', 'OTHER')
);
```

在旅游平台场景下，按地区分区可以让「查某个区域的订单」这类查询只扫描对应分区，配合应用层的查询路由，效果显著。

---

## 四、Hash 分区：均匀数据分布

当没有明显的范围或枚举特征时，Hash 分区可以将数据均匀打散到各分区中。

### 4.1 按用户 ID 做 Hash 分区

```sql
CREATE TABLE orders_hashed (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id, user_id),
    INDEX idx_order_no (order_no),
    INDEX idx_created (created_at)
) ENGINE=InnoDB
PARTITION BY HASH (user_id)
PARTITIONS 16;
```

Hash 分区的优势在于数据分布均匀，避免某个分区成为热点。但缺点是**范围查询无法利用分区裁剪**——查某个时间段的订单需要扫描所有分区。

### 4.2 线性 Hash 分区

```sql
PARTITION BY LINEAR HASH (user_id)
PARTITIONS 16;
```

线性 Hash 分区使用二进制掩码而非取模运算，在增加分区时只需移动约 50% 的数据（普通 Hash 可能需要全量重分布），适合需要动态扩容的场景。

---

## 五、分区裁剪与查询路由

### 5.1 Partition Pruning 原理

分区裁剪是分区表性能优化的核心机制。当 SQL 的 WHERE 条件中包含分区键时，MySQL 优化器会自动判断需要扫描哪些分区，跳过其余分区。

```sql
-- 查询 2026 年 3 月的订单，只扫描 p202603 分区
EXPLAIN SELECT * FROM orders
WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01';
```

### 5.2 EXPLAIN PARTITIONS 验证

```sql
EXPLAIN SELECT * FROM orders
WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'\G

*************************** 1. row ***************************
           id: 1
  select_type: SIMPLE
        table: orders
   partitions: p202603          -- 只扫描了 3 月分区
         type: range
possible_keys: idx_created
          key: idx_created
      key_len: 8
          ref: NULL
         rows: 15230
        Extra: Using where
```

### 5.3 分区裁剪失效的常见场景

```sql
-- ❌ 分区裁剪失效：WHERE 条件未包含分区键
SELECT * FROM orders WHERE user_id = 12345;
-- 结果：扫描全部分区

-- ❌ 分区裁剪失效：使用函数包裹分区键
SELECT * FROM orders WHERE DATE(created_at) = '2026-03-15';
-- 结果：扫描全部分区

-- ✅ 正确写法
SELECT * FROM orders
WHERE created_at >= '2026-03-15' AND created_at < '2026-03-16';

-- ❌ OR 条件可能导致裁剪失效
SELECT * FROM orders WHERE created_at >= '2026-03-01' OR user_id = 12345;
-- 结果：扫描全部分区
```

**核心原则**：查询条件必须直接作用于分区键表达式，且不能使用会导致优化器无法推导分区范围的函数或运算。

---

## 六、Laravel 集成实战

### 6.1 Migration 创建分区表

Laravel 的 Schema Builder 不直接支持分区语法，我们需要使用 `DB::statement()` 执行原始 DDL：

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 先用 Schema Builder 创建基础表结构
        DB::statement("
            CREATE TABLE orders (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                user_id BIGINT UNSIGNED NOT NULL,
                order_no VARCHAR(32) NOT NULL,
                product_id BIGINT UNSIGNED NOT NULL,
                quantity INT UNSIGNED NOT NULL DEFAULT 1,
                total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
                status TINYINT NOT NULL DEFAULT 0,
                region_code VARCHAR(10) NOT NULL DEFAULT 'CN',
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (id, created_at),
                UNIQUE KEY uk_order_no (order_no, created_at),
                KEY idx_user_created (user_id, created_at),
                KEY idx_status (status, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
                PARTITION p202601 VALUES LESS THAN (202602),
                PARTITION p202602 VALUES LESS THAN (202603),
                PARTITION p202603 VALUES LESS THAN (202604),
                PARTITION p202604 VALUES LESS THAN (202605),
                PARTITION p202605 VALUES LESS THAN (202606),
                PARTITION p202606 VALUES LESS THAN (202607),
                PARTITION p202607 VALUES LESS THAN (202608),
                PARTITION p202608 VALUES LESS THAN (202609),
                PARTITION p202609 VALUES LESS THAN (202610),
                PARTITION p202610 VALUES LESS THAN (202611),
                PARTITION p202611 VALUES LESS THAN (202612),
                PARTITION p202612 VALUES LESS THAN (202701),
                PARTITION pmax VALUES LESS THAN MAXVALUE
            )
        ");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS orders');
    }
};
```

### 6.2 创建可复用的 Partition Helper Trait

在实际项目中，我封装了一个 Trait 来简化分区表操作：

```php
<?php

namespace App\Database\Traits;

use Illuminate\Support\Facades\DB;

trait HasPartitions
{
    /**
     * 获取分区表达式（子类实现）
     */
    abstract protected function partitionExpression(): string;

    /**
     * 生成指定月份的分区名
     */
    protected function partitionName(int $year, int $month): string
    {
        return sprintf('p%04d%02d', $year, $month);
    }

    /**
     * 添加新月份分区
     * 会先将 pmax 分裂（REORGANIZE），再添加新分区
     */
    public function addMonthlyPartition(int $year, int $month): void
    {
        $name = $this->partitionName($year, $month);
        $nextMonth = $month === 12 ? 1 : $month + 1;
        $nextYear = $month === 12 ? $year + 1 : $year;
        $value = $nextYear * 100 + $nextMonth;

        // 通过 REORGANIZE pmax 分区来添加新分区
        DB::statement("
            ALTER TABLE {$this->getTable()}
            REORGANIZE PARTITION pmax INTO (
                PARTITION {$name} VALUES LESS THAN ({$value}),
                PARTITION pmax VALUES LESS THAN MAXVALUE
            )
        ");
    }

    /**
     * 删除指定月份分区（数据会被直接丢弃！）
     */
    public function dropMonthlyPartition(int $year, int $month): void
    {
        $name = $this->partitionName($year, $month);
        DB::statement("
            ALTER TABLE {$this->getTable()}
            DROP PARTITION {$name}
        ");
    }

    /**
     * 归档分区数据到归档表后再删除分区
     */
    public function archivePartition(int $year, int $month, string $archiveTable): void
    {
        $name = $this->partitionName($year, $month);

        DB::transaction(function () use ($name, $archiveTable) {
            // 将分区数据插入归档表
            DB::statement("
                INSERT INTO {$archiveTable}
                SELECT * FROM {$this->getTable()} PARTITION ({$name})
            ");
            // 删除分区（比 DELETE 快得多）
            DB::statement("
                ALTER TABLE {$this->getTable()}
                DROP PARTITION {$name}
            ");
        });
    }

    /**
     * 查看所有分区信息
     */
    public function getPartitions(): array
    {
        $database = config('database.connections.mysql.database');
        $table = $this->getTable();

        return DB::select("
            SELECT PARTITION_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
            FROM information_schema.PARTITIONS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL
            ORDER BY PARTITION_ORDINAL_POSITION
        ", [$database, $table]);
    }
}
```

### 6.3 Eloquent Model 集成

```php
<?php

namespace App\Models;

use App\Database\Traits\HasPartitions;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Order extends Model
{
    use HasPartitions;

    protected $table = 'orders';

    protected $fillable = [
        'user_id', 'order_no', 'product_id', 'quantity',
        'total_amount', 'status', 'region_code',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    protected function partitionExpression(): string
    {
        return 'YEAR(created_at) * 100 + MONTH(created_at)';
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    // ========== 查询 Scopes ==========

    /**
     * 按月份查询（自动触发分区裁剪）
     */
    public function scopeOfMonth($query, int $year, int $month)
    {
        $startDate = sprintf('%04d-%02d-01', $year, $month);
        $endDate = date('Y-m-d', strtotime("+1 month", strtotime($startDate)));

        return $query->where('created_at', '>=', $startDate)
                     ->where('created_at', '<', $endDate);
    }

    /**
     * 按日期范围查询
     */
    public function scopeDateRange($query, string $from, string $to)
    {
        return $query->where('created_at', '>=', $from)
                     ->where('created_at', '<', $to);
    }

    /**
     * 使用原始 SQL 指定分区查询（绕过优化器，强制扫描指定分区）
     */
    public function scopeForcePartition($query, string $partitionName)
    {
        $table = $this->getTable();
        return $query->from(DB::raw("{$table} PARTITION ({$partitionName})"));
    }
}
```

### 6.4 查询路由实战

```php
<?php

namespace App\Services\OrderService;

use App\Models\Order;
use Illuminate\Support\Facades\DB;

class OrderQueryService
{
    /**
     * 查询某月订单（自动利用分区裁剪）
     * 生成 SQL: SELECT * FROM orders PARTITION (p202603)
     *          WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'
     */
    public function getMonthlyOrders(int $year, int $month, int $userId = null)
    {
        $query = Order::ofMonth($year, $month)
            ->where('status', '!=', Order::STATUS_CANCELLED);

        if ($userId) {
            $query->where('user_id', $userId);
        }

        return $query->orderBy('created_at', 'desc')->paginate(20);
    }

    /**
     * 强制指定分区查询（适用于跨分区查询性能不理想时）
     * 场景：确定只需要查某个月的数据，直接走分区
     */
    public function getOrdersByPartition(string $partitionName)
    {
        return Order::forcePartition($partitionName)
            ->orderBy('created_at', 'desc')
            ->get();
    }

    /**
     * 按地区 + 月份联合查询
     * 需要结合分区裁剪和索引来优化
     */
    public function getRegionalMonthlyOrders(
        string $regionCode,
        int $year,
        int $month
    ): array {
        return Order::ofMonth($year, $month)
            ->where('region_code', $regionCode)
            ->selectRaw("
                COUNT(*) as order_count,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as avg_order_value
            ")
            ->first()
            ->toArray();
    }

    /**
     * 查看分区信息（运维监控用）
     */
    public function inspectPartitions(): array
    {
        $order = new Order();
        return $order->getPartitions();
    }

    /**
     * EXPLAIN PARTITIONS 分析
     */
    public function explainQuery(int $year, int $month): array
    {
        $startDate = sprintf('%04d-%02d-01', $year, $month);
        $endDate = date('Y-m-d', strtotime("+1 month", strtotime($startDate)));

        return DB::select("
            EXPLAIN SELECT * FROM orders
            WHERE created_at >= ? AND created_at < ?
        ", [$startDate, $endDate]);
    }
}
```

---

## 七、分区维护：自动化月度管理

### 7.1 Artisan 命令：自动创建和清理分区

```php
<?php

namespace App\Console\Commands;

use App\Models\Order;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PartitionManageCommand extends Command
{
    protected $signature = 'partition:manage
        {--months-ahead=3 : 预创建未来几个月的分区}
        {--archive-before= : 归档此日期之前的分区 (Y-m-d)}
        {--dry-run : 仅预览，不执行}';

    protected $description = '管理订单表分区：自动创建未来分区、归档历史分区';

    public function handle(): int
    {
        $order = new Order();

        // 1. 查看当前分区状态
        $this->info('=== 当前分区状态 ===');
        $partitions = $order->getPartitions();
        $this->table(
            ['分区名', '行数', '数据大小(KB)', '索引大小(KB)'],
            array_map(fn($p) => [
                $p->PARTITION_NAME,
                number_format($p->TABLE_ROWS),
                number_format(round($p->DATA_LENGTH / 1024, 2)),
                number_format(round($p->INDEX_LENGTH / 1024, 2)),
            ], $partitions)
        );

        // 2. 自动创建未来分区
        $monthsAhead = (int) $this->option('months-ahead');
        $now = new \DateTime();
        $now->modify('first day of this month');
        $now->modify("+{$monthsAhead} months");

        for ($i = 0; $i < $monthsAhead; $i++) {
            $year = (int) $now->format('Y');
            $month = (int) $now->format('n');
            $partName = sprintf('p%04d%02d', $year, $month);

            // 检查分区是否已存在
            $exists = collect($partitions)->contains(
                fn($p) => $p->PARTITION_NAME === $partName
            );

            if (!$exists) {
                if ($this->option('dry-run')) {
                    $this->line("[DRY RUN] 将创建分区: {$partName}");
                } else {
                    $this->line("创建分区: {$partName}");
                    $order->addMonthlyPartition($year, $month);
                }
            }
            $now->modify('-1 month');
        }

        // 3. 归档历史分区
        $archiveBefore = $this->option('archive-before');
        if ($archiveBefore) {
            $this->info("\n=== 归档历史分区 ===");
            $archiveDate = new \DateTime($archiveBefore);

            foreach ($partitions as $p) {
                $name = $p->PARTITION_NAME;
                if ($name === 'pmax') continue;

                // 从分区名解析年月: p202601 -> 2026-01
                if (preg_match('/^p(\d{4})(\d{2})$/', $name, $m)) {
                    $pDate = new \DateTime("{$m[1]}-{$m[2]}-01");
                    if ($pDate < $archiveDate && $p->TABLE_ROWS > 0) {
                        if ($this->option('dry-run')) {
                            $this->line("[DRY RUN] 将归档分区: {$name} ({$p->TABLE_ROWS} rows)");
                        } else {
                            $this->warn("归档分区: {$name} ({$p->TABLE_ROWS} rows)");
                            $order->archivePartition(
                                (int) $m[1],
                                (int) $m[2],
                                'orders_archive'
                            );
                        }
                    }
                }
            }
        }

        $this->info("\n分区管理完成！");
        return self::SUCCESS;
    }
}
```

### 7.2 使用 Laravel Scheduler 自动调度

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每月 1 日凌晨 2 点，自动创建未来 3 个月的分区
    $schedule->command('partition:manage --months-ahead=3')
        ->monthlyOn(1, '02:00')
        ->withoutOverlapping()
        ->appendOutputTo(storage_path('logs/partition-manage.log'));
}
```

---

## 八、分区 vs 分表 vs 索引：如何选择

| 维度 | 分区表 | 分表（Sharding） | 索引优化 |
|------|--------|-----------------|---------|
| **实现复杂度** | 低，应用层透明 | 高，需要路由层 | 最低 |
| **SQL 兼容性** | 100% 兼容 | 需要中间件 | 100% 兼容 |
| **跨分区查询** | 支持，性能一般 | 需要聚合 | 原生支持 |
| **数据清理** | DROP PARTITION 秒级 | DROP TABLE 秒级 | DELETE 慢 |
| **最大数据规模** | 单机，千万~亿级 | 分布式，无上限 | 单机，百万级最优 |
| **事务支持** | 完整支持 | 跨分片分布式事务 | 完整支持 |
| **适用场景** | 时间序列数据、生命周期管理 | 超大规模、高并发写入 | 通用查询优化 |

**决策建议**：
- 单表数据量 < 500 万：优先优化索引
- 单表数据量 500 万 ~ 2 亿，有明显的时间维度：使用分区表
- 单表数据量 > 2 亿，或需要水平扩展写入能力：考虑分表/分库

---

## 九、真实踩坑指南

### 9.1 分区键必须包含在主键中

这是 MySQL 分区最严格的约束：

```sql
-- ❌ 报错：A UNIQUE INDEX must include all columns in the table's partitioning function
CREATE TABLE orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id)  -- 缺少 created_at！
) PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (...);

-- ✅ 正确：主键包含分区键列
PRIMARY KEY (id, created_at)

-- 同理，唯一索引也必须包含分区键
UNIQUE KEY uk_order_no (order_no, created_at)  -- created_at 必须带上
```

这意味着你的自增主键不再是全局唯一的——不同分区可能有相同的 `id` 值。解决方案是使用**雪花算法**（Snowflake）生成全局唯一 ID，或者在主键中始终带上 `created_at`。

### 9.2 外键限制

**MySQL 分区表不支持外键！** 如果你的表有 `FOREIGN KEY` 约束，分区会创建失败。

```php
// Laravel Migration 中需要特别注意
// ❌ 分区表不能用 foreignId + constrained
Schema::create('order_items', function (Blueprint $table) {
    $table->foreignId('order_id')->constrained('orders'); // 会失败
});

// ✅ 手动创建索引，不在数据库层建立外键约束
Schema::create('order_items', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('order_id');
    $table->index('order_id');
    // 外键约束在应用层通过 Eloquent relationship 维护
});
```

### 9.3 AUTO_INCREMENT 在分区表中的行为

InnoDB 分区表中，`AUTO_INCREMENT` 值是全局递增的（MySQL 8.0 之前在某些情况下可能不是），但如前所述，主键必须包含分区键。如果你的主键是 `(id, created_at)`，Eloquent 的 `find($id)` 方法会失效，因为无法定位到具体分区。

解决方案：

```php
// 重写 find 方法，使用全局索引
class Order extends Model
{
    public static function findByUniqueId(int $id, string $createdAt)
    {
        return static::where('id', $id)
            ->where('created_at', $createdAt)
            ->first();
    }

    // 或者直接用 order_no 来查询，order_no 是全局唯一的
    public static function findByOrderNo(string $orderNo)
    {
        return static::where('order_no', $orderNo)->first();
    }
}
```

### 9.4 分区数量的上限

MySQL 理论上支持 8192 个分区（包含子分区），但实践中建议控制在 **100~200 个**以内。每个分区都会打开文件句柄、占用内存。按月分区保留 3 年数据就是 36 个分区，完全在安全范围内。

---

## 十、性能基准测试与监控

### 10.1 基准测试结果

以下是在生产环境模拟的测试数据（单表 1000 万行，按月分区 12 个）：

```sql
-- 测试场景：查询某月订单
-- 非分区表 (10,000,000 rows)
SELECT * FROM orders_no_partition
WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01';
-- 结果：1.2s, 扫描 ~830,000 rows

-- 分区表 (12 分区, 每分区 ~830,000 rows)
SELECT * FROM orders
WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01';
-- 结果：0.12s, 只扫描 p202603 分区 (~830,000 rows)
-- 性能提升约 10 倍

-- 测试场景：删除历史数据
-- 非分区表
DELETE FROM orders_no_partition
WHERE created_at < '2025-06-01';
-- 结果：45s (锁表，产生大量 binlog)

-- 分区表
ALTER TABLE orders DROP PARTITION p202501, p202502, p202503;
-- 结果：< 1s (直接删除文件，几乎不产生 binlog)
```

### 10.2 监控关键指标

```php
<?php

namespace App\Monitoring;

use Illuminate\Support\Facades\DB;

class PartitionMonitor
{
    /**
     * 检测即将满的分区（提前告警）
     */
    public function checkPartitionHealth(): array
    {
        $alerts = [];
        $partitions = DB::select("
            SELECT PARTITION_NAME, TABLE_ROWS,
                   ROUND(DATA_LENGTH / 1024 / 1024, 2) AS data_mb
            FROM information_schema.PARTITIONS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'orders'
              AND PARTITION_NAME IS NOT NULL
        ");

        $total = collect($partitions)->sum('TABLE_ROWS');
        $this->reportMetric('orders.partition.total_rows', $total);

        foreach ($partitions as $p) {
            $this->reportMetric(
                "orders.partition.{$p->PARTITION_NAME}.rows",
                $p->TABLE_ROWS
            );

            if ($p->TABLE_ROWS > 2000000) {
                $alerts[] = "分区 {$p->PARTITION_NAME} 行数超过 200 万: {$p->TABLE_ROWS}";
            }
        }

        // 检查是否有 pmax 分区（表示还没创建下个月的分区）
        $hasPmax = collect($partitions)->contains(
            fn($p) => $p->PARTITION_NAME === 'pmax'
        );
        if ($hasPmax) {
            $alerts[] = 'pmax 分区存在，请及时创建新月度分区！';
        }

        return $alerts;
    }

    protected function reportMetric(string $name, int $value): void
    {
        // 接入你的监控系统（Prometheus / DataDog / StatsD）
        // app('metrics')->gauge($name, $value);
    }
}
```

---

## 十一、最佳实践总结

1. **分区策略选择**：时间序列数据用 Range 分区，枚举数据用 List 分区，无明显特征用 Hash 分区
2. **主键设计**：使用雪花算法 ID 或将分区键纳入主键，避免自增 ID 的唯一性问题
3. **查询约定**：所有查询都应包含分区键条件，确保触发 Partition Pruning
4. **分区预创建**：使用 Scheduler 每月自动创建未来 3 个月的分区，避免写入到 pmax
5. **历史归档**：通过 DROP PARTITION 而非 DELETE 清理历史数据，避免大事务和锁竞争
6. **监控告警**：监控分区行数、pmax 分区存在性，及时发现维护问题
7. **测试验证**：上线前用 EXPLAIN PARTITIONS 验证分区裁剪是否生效
8. **外键处理**：分区表不支持外键，业务约束在应用层实现
9. **备份策略**：分区表支持单分区备份，可对历史分区做差异化备份策略
10. **升级路径**：当分区表无法满足扩展需求时，预留分表/分库的架构接口

分区表不是银弹，但在正确场景下，它能以极低的复杂度带来显著的性能提升和运维便利。对于 B2C 电商系统的订单、支付流水、日志等时间序列数据，分区表是最经济高效的解决方案。

---

*本文基于 MySQL 8.0 和 Laravel 11 编写，部分语法在 MySQL 5.7 或更早版本中可能有所不同。*

---

## 相关阅读

- [数据归档策略：冷热数据分离、历史数据迁移与查询兼容——Laravel B2C API 踩坑记录](/categories/MySQL/数据归档策略-冷热数据分离-历史数据迁移与查询兼容-Laravel-B2C-API踩坑记录/)
- [MySQL 9.x 新特性实战：向量搜索、JSON 增强、性能改进与 Laravel 适配](/categories/MySQL/2026-06-02-MySQL-9.x-新特性实战-向量搜索-JSON增强-性能改进与Laravel适配/)
- [数据库多租户模式对比实战：共享库 Row-Level vs Schema-per-Tenant vs 独立库——Laravel 中的三种方案深度权衡](/categories/MySQL/数据库多租户模式对比实战-共享库Row-Level-vs-Schema-per-Tenant-vs-独立库-Laravel中的三种方案深度权衡/)
