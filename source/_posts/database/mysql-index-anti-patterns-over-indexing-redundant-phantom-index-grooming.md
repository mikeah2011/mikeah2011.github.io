---
title: MySQL 索引设计反模式实战：过度索引、冗余索引、幽灵索引——30+ 仓库的索引瘦身与治理方法论
keywords: [MySQL, 索引设计反模式实战, 过度索引, 冗余索引, 幽灵索引, 仓库的索引瘦身与治理方法论, 数据库]
date: 2026-06-10 02:33:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - MySQL
  - Index
  - Performance
  - Anti-Pattern
  - Laravel
description: 深入剖析 MySQL 索引设计的三大反模式——过度索引、冗余索引、幽灵索引，结合 30+ 仓库的真实案例，给出索引瘦身与治理的完整方法论，包含诊断 SQL、自动化检测脚本和 Laravel 迁移实战。
---


## 概述

在维护 KKday 30+ 个 Laravel 仓库的过程中，我见过太多数据库索引问题。有的表堆了 15 个索引，有的索引从创建至今从未被使用过，有的索引明明功能重复却各自为政。这些"索引肿瘤"不仅拖慢写入性能，还让 DDL 变更变得战战兢兢——光是 `ALTER TABLE ADD INDEX` 就能锁表几分钟。

本文总结三类最常见的索引反模式，给出诊断方法和治理策略，帮助你在大型 Laravel 项目中保持索引健康。

## 核心概念

### 索引的本质成本

很多人只关注索引的"加速查询"收益，却忽略了每增加一个索引的隐性成本：

- **写入放大**：每次 INSERT/UPDATE/DELETE 都需要同步更新所有索引。一个有 8 个索引的表，写入时的 B+ 树维护开销是无索引的 8 倍。
- **空间占用**：索引本身占磁盘空间。大表的二级索引可能比数据还大。
- **优化器干扰**：过多的索引让优化器选择困难，可能导致选错索引。
- **DDL 风险**：加减索引需要锁表或使用 Online DDL，大表操作风险极高。

### 三种反模式定义

| 反模式 | 定义 | 典型表现 |
|--------|------|----------|
| **过度索引** | 索引数量远超实际查询需要 | 一张表 10+ 个索引 |
| **冗余索引** | 新索引已完全覆盖已有索引的功能 | `(a, b)` 存在的同时又有 `(a)` |
| **幽灵索引** | 从未被任何查询使用过的索引 | 创建后 0 次扫描记录 |

## 实战：诊断 SQL

### 1. 发现过度索引

```sql
-- 查看所有表的索引数量，找出"索引大户"
SELECT 
    t.TABLE_SCHEMA,
    t.TABLE_NAME,
    t.TABLE_ROWS,
    t.DATA_LENGTH,
    COUNT(i.INDEX_NAME) AS index_count,
    GROUP_CONCAT(i.INDEX_NAME ORDER BY i.SEQ_IN_INDEX SEPARATOR ', ') AS indexes
FROM information_schema.TABLES t
JOIN information_schema.STATISTICS i 
    ON t.TABLE_SCHEMA = i.TABLE_SCHEMA 
    AND t.TABLE_NAME = i.TABLE_NAME
WHERE t.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_ROWS, t.DATA_LENGTH
HAVING index_count >= 6
ORDER BY index_count DESC;
```

### 2. 发现冗余索引

MySQL 提供了一个非常实用的视图 `sys.schema_redundant_indexes`：

```sql
-- 一行搞定：找到所有冗余索引
SELECT 
    table_schema,
    table_name,
    redundant_index_name,
    redundant_index_columns,
    dominant_index_name,
    dominant_index_columns
FROM sys.schema_redundant_indexes
WHERE table_schema NOT IN ('mysql', 'sys', 'performance_schema');
```

**冗余判定规则**：
- 索引 A 是 `(a, b, c)`，索引 B 是 `(a, b)` → B 被 A 完全覆盖，B 是冗余的
- 索引 A 是 `(a)`，索引 B 是 `(a)` 但索引类型不同 → 也是冗余的

手动检测的 SQL：

```sql
-- 手动查找前缀冗余
SELECT 
    s1.TABLE_SCHEMA,
    s1.TABLE_NAME,
    s1.INDEX_NAME AS longer_index,
    s2.INDEX_NAME AS shorter_index,
    s1.COLUMN_NAME AS col1,
    s2.COLUMN_NAME AS col2
FROM information_schema.STATISTICS s1
JOIN information_schema.STATISTICS s2 
    ON s1.TABLE_SCHEMA = s2.TABLE_SCHEMA 
    AND s1.TABLE_NAME = s2.TABLE_NAME 
    AND s1.INDEX_NAME != s2.INDEX_NAME
    AND s1.COLUMN_NAME = s2.COLUMN_NAME
    AND s1.SEQ_IN_INDEX = s2.SEQ_IN_INDEX
WHERE s1.TABLE_SCHEMA NOT IN ('mysql', 'sys')
  AND s1.SEQ_IN_INDEX = 1
GROUP BY s1.TABLE_SCHEMA, s1.TABLE_NAME, s1.INDEX_NAME, s2.INDEX_NAME
HAVING COUNT(*) >= 2;
```

### 3. 发现幽灵索引

```sql
-- 查找从未被使用的索引
SELECT 
    object_schema,
    object_name,
    index_name
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE index_name IS NOT NULL
  AND count_star = 0
  AND object_schema NOT IN ('mysql', 'sys', 'performance_schema')
ORDER BY object_schema, object_name;
```

**注意**：需要确保 `performance_schema` 已启用，且数据库运行了足够长的时间（至少一个完整的业务周期，建议 7 天以上）才能得出可靠结论。

更精细的版本——排除主键和唯一索引（这些即使未被直接扫描也不能随意删除）：

```sql
SELECT 
    i.TABLE_SCHEMA,
    i.TABLE_NAME,
    i.INDEX_NAME,
    i.INDEX_TYPE,
    GROUP_CONCAT(i.COLUMN_NAME ORDER BY i.SEQ_IN_INDEX) AS columns,
    COALESCE(w.count_star, 0) AS usage_count
FROM information_schema.STATISTICS i
LEFT JOIN performance_schema.table_io_waits_summary_by_index_usage w
    ON i.TABLE_SCHEMA = w.object_schema
    AND i.TABLE_NAME = w.object_name
    AND i.INDEX_NAME = w.index_name
WHERE i.TABLE_SCHEMA NOT IN ('mysql', 'sys', 'performance_schema')
  AND i.INDEX_NAME != 'PRIMARY'
  AND i.NON_UNIQUE = 1  -- 只看非唯一索引
GROUP BY i.TABLE_SCHEMA, i.TABLE_NAME, i.INDEX_NAME, i.INDEX_TYPE, w.count_star
HAVING usage_count = 0
ORDER BY i.TABLE_SCHEMA, i.TABLE_NAME;
```

## 实战：自动化检测脚本

### PHP 脚本：一键生成索引健康报告

这个脚本适合在 CI/CD 流程中运行，或者定期 cron 执行：

```php
<?php
// scripts/index-health-check.php
// 用法: php scripts/index-health-check.php [database_host] [database_name]

$host = $argv[1] ?? '127.0.0.1';
$db   = $argv[2] ?? 'kkday_b2c';
$port = 3306;

try {
    $pdo = new PDO(
        "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4",
        'root', '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    die("连接失败: {$e->getMessage()}\n");
}

$report = [
    'over_indexed'    => [],  // 索引数 >= 6
    'redundant'       => [],  // 冗余索引
    'unused'          => [],  // 幽灵索引
    'total_indexes'   => 0,
    'total_tables'    => 0,
];

// 1. 过度索引检测
$stmt = $pdo->query("
    SELECT TABLE_NAME, COUNT(DISTINCT INDEX_NAME) AS idx_count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = '{$db}'
    GROUP BY TABLE_NAME
    HAVING idx_count >= 6
    ORDER BY idx_count DESC
");
$report['over_indexed'] = $stmt->fetchAll(PDO::FETCH_ASSOC);

// 2. 冗余索引检测（简化版：查找前缀冗余）
$stmt = $pdo->query("
    SELECT 
        s1.TABLE_NAME,
        s1.INDEX_NAME AS redundant_index,
        s2.INDEX_NAME AS covers_index,
        GROUP_CONCAT(s1.COLUMN_NAME ORDER BY s1.SEQ_IN_INDEX) AS redundant_cols,
        (SELECT GROUP_CONCAT(s2x.COLUMN_NAME ORDER BY s2x.SEQ_IN_INDEX)
         FROM information_schema.STATISTICS s2x
         WHERE s2x.TABLE_SCHEMA = s1.TABLE_SCHEMA
           AND s2x.TABLE_NAME = s1.TABLE_NAME
           AND s2x.INDEX_NAME = s2.INDEX_NAME) AS covers_cols
    FROM information_schema.STATISTICS s1
    JOIN information_schema.STATISTICS s2 
        ON s1.TABLE_SCHEMA = s2.TABLE_SCHEMA 
        AND s1.TABLE_NAME = s2.TABLE_NAME 
        AND s1.INDEX_NAME != s2.INDEX_NAME
    WHERE s1.TABLE_SCHEMA = '{$db}'
      AND s1.NON_UNIQUE = 1
      AND s2.NON_UNIQUE = 1
    GROUP BY s1.TABLE_NAME, s1.INDEX_NAME, s2.INDEX_NAME
    HAVING redundant_index != covers_index
       AND MIN(s1.COLUMN_NAME) = MIN(s2.COLUMN_NAME)
");
// 简化输出
$report['redundant'] = $stmt->fetchAll(PDO::FETCH_ASSOC);

// 3. 幽灵索引检测
$stmt = $pdo->query("
    SELECT 
        i.TABLE_NAME,
        i.INDEX_NAME,
        GROUP_CONCAT(i.COLUMN_NAME ORDER BY i.SEQ_IN_INDEX) AS columns,
        COALESCE(w.count_star, 0) AS reads
    FROM information_schema.STATISTICS i
    LEFT JOIN performance_schema.table_io_waits_summary_by_index_usage w
        ON i.TABLE_SCHEMA = w.object_schema
        AND i.TABLE_NAME = w.object_name
        AND i.INDEX_NAME = w.index_name
    WHERE i.TABLE_SCHEMA = '{$db}'
      AND i.INDEX_NAME != 'PRIMARY'
      AND i.NON_UNIQUE = 1
    GROUP BY i.TABLE_NAME, i.INDEX_NAME, w.count_star
    HAVING reads = 0
");
$report['unused'] = $stmt->fetchAll(PDO::FETCH_ASSOC);

// 统计
$stmt = $pdo->query("
    SELECT COUNT(DISTINCT TABLE_NAME) AS t, COUNT(*) AS i
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = '{$db}'
");
$stats = $stmt->fetch(PDO::FETCH_ASSOC);
$report['total_tables'] = $stats['t'];
$report['total_indexes'] = $stats['i'];

// 输出报告
echo "=== 索引健康报告: {$db} ===\n\n";
echo "总表数: {$report['total_tables']} | 总索引数: {$report['total_indexes']}\n\n";

echo "--- 过度索引 (≥6个索引) ---\n";
if (empty($report['over_indexed'])) {
    echo "  ✅ 无\n";
} else {
    foreach ($report['over_indexed'] as $row) {
        echo "  ⚠️  {$row['TABLE_NAME']}: {$row['idx_count']} 个索引\n";
    }
}

echo "\n--- 冗余索引 ---\n";
if (empty($report['redundant'])) {
    echo "  ✅ 无\n";
} else {
    foreach ($report['redundant'] as $row) {
        echo "  ⚠️  {$row['TABLE_NAME']}.{$row['redundant_index']} ← 被 {$row['covers_index']} 覆盖\n";
    }
}

echo "\n--- 幽灵索引 (从未使用) ---\n";
if (empty($report['unused'])) {
    echo "  ✅ 无\n";
} else {
    foreach ($report['unused'] as $row) {
        echo "  👻 {$row['TABLE_NAME']}.{$row['INDEX_NAME']} ({$row['columns']})\n";
    }
}

$healthScore = 100;
$healthScore -= count($report['over_indexed']) * 5;
$healthScore -= count($report['redundant']) * 10;
$healthScore -= count($report['unused']) * 3;
$healthScore = max(0, $healthScore);

echo "\n=== 健康评分: {$healthScore}/100 ===\n";

if ($healthScore < 60) {
    echo "🚨 建议立即清理索引\n";
    exit(2);
} elseif ($healthScore < 80) {
    echo "⚠️  建议近期优化\n";
    exit(1);
} else {
    echo "✅ 索引状况良好\n";
    exit(0);
}
```

## 实战：Laravel 迁移中的索引治理

### 迁移模板：安全删除索引

```php
<?php
// database/migrations/2026_06_10_000000_groom_indexes_on_orders_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 删除冗余索引前，先记录当前状态（用于回滚参考）
        $indexes = DB::select("SHOW INDEX FROM orders WHERE Key_name != 'PRIMARY'");
        logger()->info('当前 orders 索引状态', [
            'count' => count($indexes),
            'names' => array_column($indexes, 'Key_name'),
        ]);

        // 删除幽灵索引（经性能监控确认 30 天零使用）
        $ghostIndexes = [
            'idx_orders_status_created',    // 被 idx_orders_status_cover 覆盖
            'idx_orders_user_email',        // 从未被查询使用
        ];

        Schema::table('orders', function (Blueprint $table) use ($ghostIndexes) {
            foreach ($ghostIndexes as $indexName) {
                $table->dropIndex($indexName);
            }
        });

        // 删除冗余索引：idx_orders_user_id 是 idx_orders_user_id_status 的前缀
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('idx_orders_user_id');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->index('user_id', 'idx_orders_user_id');
            $table->index(['status', 'created_at'], 'idx_orders_status_created');
            $table->index('user_email', 'idx_orders_user_email');
        });
    }
};
```

### 使用 `DB::getDoctrineSchemaManager()` 安全操作

```php
// 在 Seeder 或 Artisan Command 中动态检查索引
use Illuminate\Support\Facades\DB;

$manager = DB::getDoctrineSchemaManager();
$table = $manager->listTableDetails('orders');

// 获取当前所有索引
$indexes = $table->getIndexes();
foreach ($indexes as $index) {
    echo sprintf(
        "%-35s columns=%s unique=%s primary=%s\n",
        $index->getName(),
        implode(',', array_map(fn($col) => $col->getColumnName(), $index->getColumns())),
        $index->isUnique() ? 'YES' : 'NO',
        $index->isPrimary() ? 'YES' : 'NO'
    );
}
```

## 踩坑记录

### 坑 1：删除索引导致线上慢查询飙升

某次清理 `orders` 表的索引，删了 `idx_orders_status` 后，一个报表查询的耗时从 200ms 飙升到 15s。

**原因**：删除前只看了 `sys.schema_unused_indexes`，但那个视图只反映"直接扫描"次数，而这个查询走的是 index_merge 优化，实际依赖了这个索引。

**教训**：删除任何索引前，必须用 `EXPLAIN` 跑一遍所有关联查询。可以在删除脚本中加上：

```sql
-- 删除前检查：这个索引是否被 EXPLAIN 使用
EXPLAIN SELECT * FROM orders WHERE status = 'paid' AND created_at > '2026-01-01';
-- 确认 type 列不是 ALL 或 index
```

### 坑 2：Online DDL 在大表上仍然锁写

`ALTER TABLE orders DROP INDEX idx_orders_status` 理论上支持 Online DDL，但在阿里云 RDS 上执行时，写入 TPS 从 5000 降到 200。

**原因**：Online DDL 需要拷贝索引数据，即使不锁表也会占用大量 IO。百万级表的二级索引删除可能需要几分钟。

**解决方案**：使用 `pt-online-schema-change`（Percona Toolkit）：

```bash
pt-online-schema-change \
    --alter "DROP INDEX idx_orders_status" \
    --execute \
    D=kkday_b2c,t=orders \
    h=127.0.0.1,P=3306,u=root
```

对于小表（<100万行），直接 `ALTER TABLE` 配合低峰期执行即可。

### 坑 3：Laravel 的 `hasIndex()` 检查不可靠

```php
// 这个方法在某些 Laravel 版本中行为不一致
Schema::hasIndex('orders', 'idx_orders_status'); // 可能返回 false 即使索引存在
```

**替代方案**：直接查 `information_schema`：

```php
function indexExists(string $table, string $index): bool
{
    return DB::select("SHOW INDEX FROM {$table} WHERE Key_name = ?", [$index]) !== [];
}
```

### 坑 4：复合索引列顺序错误导致索引失效

```php
// 错误：把选择性低的列放前面
$table->index(['status', 'user_id', 'created_at']); // status 只有 3 个值

// 正确：高选择性列在前
$table->index(['user_id', 'status', 'created_at']); // user_id 几乎唯一
```

**验证选择性**：

```sql
-- 查看列的选择性（唯一值占比）
SELECT 
    COUNT(DISTINCT status) / COUNT(*) AS status_selectivity,    -- ~0.0001
    COUNT(DISTINCT user_id) / COUNT(*) AS user_id_selectivity,  -- ~0.9999
    COUNT(DISTINCT created_at) / COUNT(*) AS created_selectivity -- ~0.85
FROM orders;
```

## 治理方法论：索引生命周期管理

### 1. 准入机制

所有新增索引必须经过代码审查，包含：
- 目标查询的 `EXPLAIN` 截图
- 对写入性能的评估（预计影响 <5%）
- 索引列的选择性分析

### 2. 定期巡检

每月运行一次健康检查脚本，关注：
- 索引总数变化趋势
- 新增幽灵索引（上月创建但 0 使用的）
- 冗余索引数量

### 3. 清理流程

```
发现可疑索引 → EXPLAIN 验证 → 低峰期执行 → 监控 24h → 确认安全
```

### 4. 文档化

在项目 `docs/database-indexes.md` 中维护一份索引清单：

```markdown
## orders 表索引

| 索引名 | 列 | 类型 | 创建原因 | 最后使用 |
|--------|----|------|----------|----------|
| PRIMARY | id | 唯一 | 主键 | 实时 |
| idx_orders_user_status | user_id, status | 普通 | 订单列表查询 | 2026-06-09 |
| idx_orders_created | created_at | 普通 | 报表按时间范围 | 2026-06-09 |
```

## 总结

索引治理不是一次性的工作，而是持续的纪律。在 30+ 仓库的规模下，我总结出三条铁律：

1. **索引有成本**：每增加一个索引，都是在写入性能和查询性能之间做权衡。没有免费的午餐。
2. **定期体检**：`sys.schema_redundant_indexes` + `performance_schema` 是你的 X 光片，每月照一次。
3. **删除比创建更危险**：加索引最多慢一点，删错索引可能导致线上事故。永远先验证再执行。

索引不是越多越好，而是刚刚好。你的表有几个索引，取决于你的查询需要几个，而不是你觉得几个安全。
