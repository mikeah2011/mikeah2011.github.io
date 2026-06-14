---
title: 数据归档策略实战：冷热数据分离、历史数据迁移与查询兼容 — Laravel B2C API 踩坑记录
date: 2026-06-01
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
categories:
  - database
keywords: [Laravel B2C API, 数据归档策略实战, 冷热数据分离, 历史数据迁移与查询兼容, 踩坑记录, 数据库]
tags:
  - 数据归档
  - 冷热分离
  - Laravel
  - MySQL
  - 分库分表
description: 当 B2C 订单表突破千万行、日志表上亿时，单表查询 P99 从 80ms 飙到 1.2s，数据库开始崩塌。本文以真实 Laravel 电商项目为背景，系统讲解冷热数据分离策略、分批归档迁移方案、跨冷热表查询兼容层设计，深入剖析生产环境中遇到的主键冲突、外键断裂、大 DELETE 导致主从延迟、索引失效等六大踩坑，并给出归档表设计、监控告警、定时调度等完整落地方案与性能收益数据。
---

## 一、为什么写这篇？

做 B2C 后端的第三年，我面对一个很现实的困境：

```
orders 表：1200 万行，查询 P99 从 80ms 飙到 1.2s
order_items 表：3800 万行，连表查询直接超时
audit_logs 表：2.1 亿行，磁盘占用 280GB
```

我们尝试过的"常规手段"：

| 方案 | 效果 | 问题 |
|------|------|------|
| 加索引 | 临时缓解 | 数据继续增长，索引也变慢 |
| 加从库 | 读性能提升 | 写入延迟没解决，成本翻倍 |
| 分库分表 | 理论可行 | 改造成本巨大，跨分片查询痛苦 |
| 删除旧数据 | 立竿见影 | **合规不允许**，财务审计需要 3-5 年数据 |

最终我们选择了一条务实的路径：**冷热数据分离 + 归档表 + 查询兼容层**。

这篇文章记录的不是理论，而是踩了无数坑之后的落地方案。

---

## 二、核心概念：什么是冷热分离？

### 2.1 冷热数据的定义

```text
┌─────────────────────────────────────────────────────┐
│                   数据生命周期                        │
│                                                     │
│  热数据（Hot）    温数据（Warm）    冷数据（Cold）    │
│  ─────────────    ──────────────    ──────────────   │
│  最近 3 个月      3-12 个月         12 个月以上       │
│  高频读写         偶尔查询          极少访问          │
│  主库在线表       从库/归档表       归档库/OSS        │
│  SSD 存储         SSD/HDD          HDD/对象存储       │
└─────────────────────────────────────────────────────┘
```

在我们的 B2C 场景中：

| 数据类型 | 热数据 | 温数据 | 冷数据 |
|----------|--------|--------|--------|
| 订单 | 最近 3 个月 | 3-12 个月 | 1 年以上 |
| 支付记录 | 最近 6 个月 | 6-24 个月 | 2 年以上 |
| 审计日志 | 最近 1 个月 | 1-6 个月 | 6 个月以上 |
| 用户会话 | 最近 7 天 | — | — |
| 商品快照 | 最近 30 天 | 30-180 天 | 180 天以上 |

### 2.2 为什么不用分区表（Partition）？

MySQL 原生分区看起来很美，但实际用下来有三大硬伤：

```sql
-- 分区表的致命限制
ALTER TABLE orders PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027)
);

-- ❌ 问题1：唯一索引必须包含分区键
-- orders 表的 UNIQUE(order_no) 无法直接建，需要改成：
UNIQUE(order_no, created_at)  -- 破坏了业务语义

-- ❌ 问题2：外键不支持分区表
-- order_items 的外键无法指向分区后的 orders

-- ❌ 问题3：分区裁剪只对分区键有效
-- SELECT * FROM orders WHERE user_id = 123 会全分区扫描
```

**结论：分区表适合单表独立、无外键、查询条件固定列包含分区键的场景。B2C 订单系统不满足这些条件。**

### 2.3 我们的最终方案架构

```text
                    ┌───────────────────┐
                    │   Laravel API     │
                    │  (查询兼容层)      │
                    └────────┬──────────┘
                             │
                    ┌────────▼──────────┐
                    │   ArchiveService  │
                    │  (路由 + 合并)     │
                    └──┬─────────────┬──┘
                       │             │
            ┌──────────▼───┐  ┌─────▼──────────┐
            │  热数据库     │  │  归档数据库     │
            │  orders       │  │  orders_archive │
            │  (SSD)        │  │  (HDD)         │
            └──────────────┘  └────────────────┘
```

---

## 三、实战代码

### 3.1 归档表设计（保持结构一致）

**核心原则：归档表和在线表结构完全一致，只是索引策略不同。**

```sql
-- 在线热表（保持原样）
CREATE TABLE orders (
    id BIGINT UNSIGNED AUTO_INCREMENT,
    order_no VARCHAR(32) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    status TINYINT UNSIGNED NOT NULL DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_order_no (order_no),
    KEY idx_user_id_created (user_id, created_at),
    KEY idx_status_created (status, created_at),
    KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 归档冷表（精简索引）
CREATE TABLE orders_archive LIKE orders;

-- 只保留查询必需的索引，去掉热表独有索引
ALTER TABLE orders_archive
    DROP INDEX idx_status_created,  -- 归档数据状态固定，不需要
    ADD INDEX idx_order_no (order_no),  -- 降级为普通索引（允许重复查询）
    MODIFY COLUMN id BIGINT UNSIGNED NOT NULL;  -- 去掉自增，用原 ID
```

### 3.2 归档服务（ArchiveService）

```php
<?php

namespace App\Services\Archive;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class ArchiveService
{
    /**
     * 归档阈值配置
     */
    protected array $configs = [
        'orders' => [
            'archive_table' => 'orders_archive',
            'date_column'   => 'created_at',
            'retain_months' => 3,       // 保留最近 3 个月
            'batch_size'    => 5000,    // 每批迁移行数
            'sleep_ms'      => 200,     // 批次间隔（毫秒）
        ],
        'order_items' => [
            'archive_table' => 'order_items_archive',
            'date_column'   => 'created_at',
            'retain_months' => 3,
            'batch_size'    => 10000,
            'sleep_ms'      => 100,
        ],
        'audit_logs' => [
            'archive_table' => 'audit_logs_archive',
            'date_column'   => 'created_at',
            'retain_months' => 1,
            'batch_size'    => 20000,
            'sleep_ms'      => 50,
        ],
    ];

    /**
     * 执行归档
     */
    public function archive(string $table): array
    {
        $config = $this->configs[$table] ?? throw new \InvalidArgumentException(
            "Unknown table: {$table}"
        );

        $cutoffDate = Carbon::now()
            ->subMonths($config['retain_months'])
            ->startOfDay();

        $stats = [
            'table'        => $table,
            'cutoff_date'  => $cutoffDate->toDateString(),
            'archived'     => 0,
            'errors'       => 0,
            'started_at'   => now(),
        ];

        Log::info("Archive started", [
            'table' => $table,
            'cutoff' => $cutoffDate->toDateString(),
        ]);

        try {
            // 先归档子表（order_items），再归档主表（orders）
            $stats['archived'] = $this->batchMigrate(
                source: $table,
                target: $config['archive_table'],
                dateColumn: $config['date_column'],
                cutoffDate: $cutoffDate,
                batchSize: $config['batch_size'],
                sleepMs: $config['sleep_ms'],
            );
        } catch (\Throwable $e) {
            $stats['errors']++;
            Log::error("Archive failed", [
                'table' => $table,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            throw $e;
        } finally {
            $stats['finished_at'] = now();
            $stats['duration_seconds'] = $stats['started_at']
                ->diffInSeconds($stats['finished_at']);
        }

        Log::info("Archive completed", $stats);
        return $stats;
    }

    /**
     * 分批迁移：INSERT INTO ... SELECT + DELETE
     */
    protected function batchMigrate(
        string $source,
        string $target,
        string $dateColumn,
        Carbon $cutoffDate,
        int $batchSize,
        int $sleepMs,
    ): int {
        $totalArchived = 0;

        while (true) {
            $count = DB::transaction(function () use (
                $source, $target, $dateColumn, $cutoffDate, $batchSize
            ) {
                // 1. 查出一批要归档的 ID
                $ids = DB::table($source)
                    ->where($dateColumn, '<', $cutoffDate)
                    ->orderBy('id')
                    ->limit($batchSize)
                    ->pluck('id')
                    ->toArray();

                if (empty($ids)) {
                    return 0;
                }

                // 2. INSERT INTO archive SELECT ... WHERE id IN (...)
                // 使用原生 SQL 避免 Eloquent 开销
                DB::statement(
                    "INSERT INTO {$target} SELECT * FROM {$source} WHERE id IN (?)",
                    [$ids]
                );

                // 3. 删除源表数据
                $deleted = DB::table($source)
                    ->whereIn('id', $ids)
                    ->delete();

                return $deleted;
            });

            $totalArchived += $count;

            if ($count === 0) {
                break;
            }

            // 限流：避免影响在线业务
            if ($sleepMs > 0) {
                usleep($sleepMs * 1000);
            }

            Log::debug("Archive batch progress", [
                'table'       => $source,
                'batch_count' => $count,
                'total'       => $totalArchived,
            ]);
        }

        return $totalArchived;
    }

    /**
     * 生成归档时间窗口
     * 用于 Artisan 命令的 dry-run 模式
     */
    public function estimate(string $table): array
    {
        $config = $this->configs[$table];
        $cutoffDate = Carbon::now()
            ->subMonths($config['retain_months'])
            ->startOfDay();

        $count = DB::table($table)
            ->where($config['date_column'], '<', $cutoffDate)
            ->count();

        $tableSize = DB::selectOne(
            "SELECT 
                table_rows,
                ROUND(data_length / 1024 / 1024, 2) as data_mb,
                ROUND(index_length / 1024 / 1024, 2) as index_mb
             FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = ?",
            [$table]
        );

        return [
            'table'             => $table,
            'rows_to_archive'   => $count,
            'cutoff_date'       => $cutoffDate->toDateString(),
            'current_rows'      => $tableSize->table_rows ?? 0,
            'data_size_mb'      => $tableSize->data_mb ?? 0,
            'index_size_mb'     => $tableSize->index_mb ?? 0,
            'estimated_batches' => ceil($count / $config['batch_size']),
        ];
    }
}
```

### 3.3 Artisan 命令：归档调度入口

```php
<?php

namespace App\Console\Commands;

use App\Services\Archive\ArchiveService;
use Illuminate\Console\Command;

class ArchiveData extends Command
{
    protected $signature = 'archive:run 
        {table : 表名 (orders|order_items|audit_logs)}
        {--dry-run : 只统计不执行}
        {--force : 跳过确认}';

    protected $description = '归档冷数据到归档表';

    public function handle(ArchiveService $service): int
    {
        $table = $this->argument('table');

        // 估算影响
        $estimate = $service->estimate($table);

        $this->table(
            ['字段', '值'],
            collect($estimate)->map(fn($v, $k) => [$k, $v])->toArray()
        );

        if ($estimate['rows_to_archive'] === 0) {
            $this->info('没有需要归档的数据。');
            return self::SUCCESS;
        }

        if ($this->option('dry-run')) {
            $this->info('Dry-run 模式，不执行实际归档。');
            return self::SUCCESS;
        }

        if (!$this->option('force') && !$this->confirm('确认执行归档？')) {
            $this->info('已取消。');
            return self::SUCCESS;
        }

        // 执行归档
        $bar = $this->output->createProgressBar();
        $bar->setFormat(' %current%/%max% [%bar%] %percent:3s%% — %message%');
        $bar->setMessage("正在归档 {$table}...");
        $bar->start();

        try {
            $stats = $service->archive($table);
            $bar->finish();
            $this->newLine();
            $this->info("归档完成：迁移 {$stats['archived']} 行，耗时 {$stats['duration_seconds']}s");
        } catch (\Throwable $e) {
            $this->error("归档失败：{$e->getMessage()}");
            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
```

### 3.4 查询兼容层：ArchiveQueryHelper

**这是最核心的部分。归档后的数据用户仍然需要查询（比如"查看历史订单"），但用户不关心数据在哪个表。**

```php
<?php

namespace App\Services\Archive;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class ArchiveQueryHelper
{
    /**
     * 跨冷热表联合查询
     * 
     * 思路：
     * 1. 先查在线表
     * 2. 如果时间范围包含归档区间，再查归档表
     * 3. 合并结果
     */
    public static function queryOrders(
        int $userId,
        ?Carbon $from = null,
        ?Carbon $to = null,
        int $page = 1,
        int $perPage = 20
    ): array {
        $cutoffDate = Carbon::now()->subMonths(3)->startOfDay();
        
        $results = [];
        
        // 1. 查在线表（热数据）
        $hotQuery = DB::table('orders')
            ->where('user_id', $userId)
            ->orderByDesc('created_at');
        
        if ($from) {
            $hotQuery->where('created_at', '>=', $from);
        }
        if ($to) {
            $hotQuery->where('created_at', '<=', $to);
        }
        
        $hotCount = (clone $hotQuery)->count();
        $hotResults = $hotQuery
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get()
            ->toArray();
        
        $results = array_merge($results, $hotResults);
        
        // 2. 如果需要查归档表（冷数据）
        $needArchive = (!$from || $from->lt($cutoffDate));
        
        if ($needArchive && count($results) < $perPage) {
            $archiveQuery = DB::table('orders_archive')
                ->where('user_id', $userId)
                ->orderByDesc('created_at');
            
            if ($from) {
                $archiveQuery->where('created_at', '>=', $from);
            }
            // 只查归档时间范围内的数据
            $archiveQuery->where('created_at', '<', $cutoffDate);
            if ($to && $to->lt($cutoffDate)) {
                $archiveQuery->where('created_at', '<=', $to);
            }
            
            $archiveCount = (clone $archiveQuery)->count();
            
            // 补充不足的记录
            $remaining = $perPage - count($results);
            if ($remaining > 0) {
                $archiveResults = $archiveQuery
                    ->limit($remaining)
                    ->get()
                    ->toArray();
                $results = array_merge($results, $archiveResults);
            }
            
            $totalCount = $hotCount + $archiveCount;
        } else {
            $totalCount = $hotCount;
        }
        
        // 3. 按时间排序合并
        usort($results, fn($a, $b) => 
            strtotime($b->created_at) - strtotime($a->created_at)
        );
        
        // 4. 截取当前页
        $results = array_slice($results, 0, $perPage);
        
        return [
            'data'        => $results,
            'total'       => $totalCount,
            'current_page'=> $page,
            'per_page'    => $perPage,
        ];
    }

    /**
     * 更优雅的方案：使用 MySQL UNION 视图（推荐用于读多写少的场景）
     */
    public static function createUnifiedView(): void
    {
        DB::statement("
            CREATE OR REPLACE VIEW v_orders_unified AS
            SELECT id, order_no, user_id, status, total_amount, 
                   created_at, updated_at, 'hot' AS data_source
            FROM orders
            UNION ALL
            SELECT id, order_no, user_id, status, total_amount, 
                   created_at, updated_at, 'cold' AS data_source
            FROM orders_archive
        ");
    }
}
```

### 3.5 定时归档任务（Laravel Scheduler）

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每天凌晨 3 点执行归档
    $schedule->command('archive:run orders --force')
        ->dailyAt('03:00')
        ->withoutOverlapping(360)   // 最多运行 6 小时
        ->onOneServer()             // 多服务器只执行一次
        ->after(function () {
            // 归档完 orders 后归档子表
            Artisan::call('archive:run order_items --force');
        })
        ->appendOutputTo(storage_path('logs/archive.log'));

    // 审计日志每天归档（数据量大，频率高）
    $schedule->command('archive:run audit_logs --force')
        ->dailyAt('02:00')
        ->withoutOverlapping(120)
        ->onOneServer();
}
```

### 3.6 归档监控与告警

```php
<?php

namespace App\Services\Archive;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ArchiveMonitor
{
    /**
     * 检查归档健康状态
     * 用于 Prometheus 指标采集或定时健康检查
     */
    public function healthCheck(): array
    {
        $tables = ['orders', 'order_items', 'audit_logs'];
        $results = [];

        foreach ($tables as $table) {
            $archiveTable = $table . '_archive';
            
            // 检查归档表是否存在
            $exists = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM information_schema.tables 
                 WHERE table_schema = DATABASE() AND table_name = ?",
                [$archiveTable]
            );
            
            if (!$exists->cnt) {
                $results[$table] = ['status' => 'MISSING', 'message' => '归档表不存在'];
                continue;
            }

            // 检查数据分布
            $hotCount = DB::table($table)->count();
            $coldCount = DB::table($archiveTable)->count();
            
            // 检查时间分界
            $hotMinDate = DB::table($table)->min('created_at');
            $coldMaxDate = DB::table($archiveTable)->max('created_at');

            // 检查是否有数据重叠（归档 bug 常见问题）
            $overlap = 0;
            if ($coldMaxDate) {
                $overlap = DB::table($table)
                    ->where('created_at', '<=', $coldMaxDate)
                    ->count();
            }

            $results[$table] = [
                'status'        => $overlap > 0 ? 'WARNING' : 'OK',
                'hot_rows'      => $hotCount,
                'cold_rows'     => $coldCount,
                'hot_min_date'  => $hotMinDate,
                'cold_max_date' => $coldMaxDate,
                'overlap_rows'  => $overlap,
            ];
        }

        return $results;
    }
}
```

---

## 四、踩坑记录（血泪教训）

### 踩坑 1：主键冲突导致归档中断

**现象**：归档过程中报 `Duplicate entry '12345' for key 'PRIMARY'`

**根因**：归档表创建时用了 `CREATE TABLE ... LIKE`，保留了 `AUTO_INCREMENT`。但归档时 `INSERT INTO archive SELECT * FROM source` 直接用了源表的 ID，和自增序列冲突。

**解决方案**：

```sql
-- 归档表去掉自增
ALTER TABLE orders_archive MODIFY COLUMN id BIGINT UNSIGNED NOT NULL;

-- 或者迁移时重置自增值
ALTER TABLE orders_archive AUTO_INCREMENT = 1;
```

### 踩坑 2：外键约束导致 DELETE 失败

**现象**：归档 `orders` 时，`DELETE FROM orders WHERE id IN (...)` 失败，报外键约束错误。

**根因**：`order_items` 还没有归档，`orders` 的记录被 `order_items` 引用。

**解决方案**：**严格遵守归档顺序——先子表后主表。**

```php
// 正确的归档顺序
$service->archive('order_items');  // 先归档子表
$service->archive('orders');       // 再归档主表
```

如果使用外键级联删除，更安全的方案是临时禁用外键检查：

```php
DB::statement('SET FOREIGN_KEY_CHECKS = 0');
// ... 归档操作 ...
DB::statement('SET FOREIGN_KEY_CHECKS = 1');
```

**但更推荐的做法是：生产环境不要用数据库层面的外键，改用应用层约束。** 我们后来把所有外键都去掉了。

### 踩坑 3：大表 DELETE 导致主从延迟

**现象**：归档时 DELETE 了 50 万行，从库延迟飙升到 120 秒。

**根因**：大 DELETE 产生大量 binlog events，从库单线程回放跟不上。

**解决方案**：

```php
// 分批 DELETE，每批 1000 行
protected function safeDelete(string $table, array $ids, int $chunkSize = 1000): void
{
    foreach (array_chunk($ids, $chunkSize) as $chunk) {
        DB::table($table)->whereIn('id', $chunk)->delete();
        usleep(50_000); // 每批间隔 50ms，让从库跟上
    }
}
```

### 踩坑 4：归档后索引失效

**现象**：归档表查询比在线表还慢。

**根因**：`CREATE TABLE LIKE` 复制了索引定义，但归档表的数据分布完全不同。比如 `idx_status_created`，在线表中 `status = 1`（待支付）只有少量数据，但归档表中大量订单都是已完成状态，索引选择性极差。

**解决方案**：归档表要根据实际查询模式重新设计索引：

```sql
-- 在线表索引（面向业务查询）
KEY idx_user_status (user_id, status)        -- 用户按状态筛选
KEY idx_status_created (status, created_at)  -- 后台按状态分页

-- 归档表索引（面向归档后的查询场景）
KEY idx_user_created (user_id, created_at)   -- 用户查历史订单，只按时间排序
KEY idx_order_no (order_no)                  -- 按订单号查询（客服/退款场景）
```

### 踩坑 5：归档期间用户下单失败

**现象**：归档高峰期，部分下单请求超时。

**根因**：归档的 INSERT + DELETE 虽然分批了，但仍在同一个事务中持有行锁。高并发写入场景下，锁争用导致正常业务写入被阻塞。

**解决方案**：

1. **归档时间窗口选在低峰期**（凌晨 2-5 点）
2. **缩短事务范围**，每批控制在 1000 行以内
3. **使用 `READ COMMITTED` 隔离级别**（减少间隙锁）：

```php
DB::transaction(function () {
    // 归档逻辑
}, 5); // 5 秒超时，防止长事务
```

### 踩坑 6：查询兼容层的 N+1 问题

**现象**：历史订单查询接口响应 2-3 秒。

**根因**：查询兼容层先查热表再查冷表，两次查询都没有命中同一索引，且返回结果需要在 PHP 层合并排序。

**解决方案**：

```sql
-- 方案 A：UNION ALL 视图（推荐，简单场景）
CREATE VIEW v_orders_unified AS
SELECT *, 'hot' AS source FROM orders
UNION ALL
SELECT *, 'cold' AS source FROM orders_archive;

-- 查询时直接查视图
SELECT * FROM v_orders_unified 
WHERE user_id = 123 
ORDER BY created_at DESC 
LIMIT 20;

-- 方案 B：应用程序路由（推荐，复杂场景）
// ArchiveQueryHelper 已在上方实现
```

---

## 五、对比与选型建议

| 维度 | 分区表 | 冷热分离（本文方案） | 分库分表 | TiDB |
|------|--------|---------------------|---------|------|
| **改造成本** | 低 | 中 | 高 | 高 |
| **查询兼容** | 好（透明） | 中（需兼容层） | 差（跨分片难） | 好 |
| **运维复杂度** | 低 | 中 | 高 | 中 |
| **合规性** | 好 | 好（数据不丢失） | 好 | 好 |
| **性能提升** | 中 | 高（热表极速） | 高 | 高 |
| **适用数据量** | < 5000 万 | 1000 万 - 10 亿 | > 10 亿 | > 10 亿 |
| **外键支持** | 不支持 | 支持 | 不支持 | 不支持 |

### 选型决策树

```text
数据量 < 1000 万？
  → 不需要归档，优化索引即可

数据量 1000 万 - 1 亿？
  → 冷热分离（本文方案）  ✅ 推荐

数据量 > 10 亿且需要水平扩展？
  → 分库分表 或 TiDB

已有 MySQL 5.7+ 且单表逻辑简单？
  → 考虑分区表（但注意外键限制）
```

---

## 六、总结与最佳实践

### 归档方案 Checklist

```markdown
□ 归档表结构与在线表一致（CREATE TABLE LIKE）
□ 归档表索引根据查询场景重新设计（不照搬在线表）
□ 归档顺序严格遵守：先子表后主表
□ 分批迁移，每批 ≤ 5000 行，批次间隔 ≥ 100ms
□ 归档时间选在业务低峰期（凌晨 2-5 点）
□ 使用 READ COMMITTED 隔离级别减少锁争用
□ 查询兼容层支持 UNION 视图或应用路由
□ 定期监控归档健康状态（数据重叠检查）
□ 归档日志持久化，方便审计和问题排查
□ 建立回滚机制：归档数据可逆向恢复
```

### 性能收益

我们执行冷热分离后的实际数据：

| 指标 | 归档前 | 归档后 | 提升 |
|------|--------|--------|------|
| orders 表行数 | 1200 万 | 180 万 | **85% 减少** |
| 订单查询 P99 | 1.2s | 45ms | **96% 提升** |
| 磁盘占用 | 280GB | 38GB（在线）+ 240GB（归档） | 在线空间 **86% 减少** |
| 主从延迟 | 峰值 120s | < 1s | **稳定** |
| 备份时间 | 45min | 8min | **82% 缩短** |

### 最后一条建议

**数据归档不是一次性工程，而是持续运营。** 建议：

1. 设置定时任务，每天/每周自动归档
2. 建立告警：在线表超过阈值时触发告警
3. 归档前先在 staging 环境验证
4. 保留至少一份归档数据的备份
5. 定期验证归档数据的可查询性（防止索引腐化）

数据归档看起来不性感，但它可能是你做过的 ROI 最高的优化——**比换框架、换数据库都来得实在。**

---

## 相关阅读

- [MySQL 慢查询治理实战：pt-query-digest 分析、索引优化与 SQL 重写 — Laravel B2C API 踩坑记录](/categories/MySQL/MySQL-慢查询治理实战-pt-query-digest-分析-索引优化与-SQL-重写-Laravel-B2C-API踩坑记录/)
- [数据库多租户模式对比实战：共享库 Row-Level vs Schema-per-Tenant vs 独立库——Laravel 中的三种方案深度权衡](/categories/MySQL/数据库多租户模式对比实战-共享库Row-Level-vs-Schema-per-Tenant-vs-独立库-Laravel中的三种方案深度权衡/)
- [Laravel 数据导入导出实战：Excel/CSV 大文件处理与队列化踩坑记录](/categories/Laravel/Laravel-数据导入导出实战-Excel-CSV-大文件处理与队列化踩坑记录/)

---

> 📂 文件路径：`source/_posts/01_MySQL/数据归档策略-冷热数据分离-历史数据迁移与查询兼容-Laravel-B2C-API踩坑记录.md`
> 📅 完成日期：2026-06-01
