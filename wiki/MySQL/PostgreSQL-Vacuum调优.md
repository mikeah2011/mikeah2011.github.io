# PostgreSQL Vacuum 调优实战

## 定义

PostgreSQL 使用 **MVCC（多版本控制）** 实现事务隔离，每次 UPDATE/DELETE 不会立即物理删除旧数据，而是标记为"死元组"（dead tuple）。**VACUUM** 负责回收这些死元组占用的空间，是 PostgreSQL 运维中最重要的维护操作。

## 为什么需要 VACUUM

### MVCC 的代价

```
UPDATE orders SET status = 'paid' WHERE id = 1001;

-- 实际操作：
-- 1. 标记旧行为死元组（不物理删除）
-- 2. 插入新行（新版本）
-- 3. 旧行空间不会自动回收
```

### 不做 VACUUM 的后果

| 问题 | 说明 |
|------|------|
| **表膨胀** | 死元组占用大量磁盘空间，表文件不断增长 |
| **索引膨胀** | 索引中包含死元组的指针，索引变大变慢 |
| **查询变慢** | 需要扫描更多页面，IO 增加 |
| **事务 ID 回卷** | 最严重的后果——数据库可能强制关机 |

## Autovacuum

### 工作原理

PostgreSQL 默认开启 autovacuum，自动执行 VACUUM 和 ANALYZE：

```sql
-- 检查 autovacuum 是否开启
SHOW autovacuum;  -- on
```

### 触发条件

```sql
-- 当死元组数量超过阈值时触发
VACUUM 阈值 = autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * 表行数

-- 默认配置
autovacuum_vacuum_threshold = 50        -- 最少 50 个死元组
autovacuum_vacuum_scale_factor = 0.2    -- 死元组超过 20% 时触发

-- 示例：100 万行的表
-- 触发阈值 = 50 + 0.2 * 1000000 = 200050 个死元组
-- 即死元组超过 20% 时才触发 autovacuum
```

### 关键参数调优

```sql
-- postgresql.conf

-- 1. 降低触发阈值（更频繁地 vacuum）
autovacuum_vacuum_threshold = 50
autovacuum_vacuum_scale_factor = 0.05    -- 从 0.2 降到 0.05（5%）

-- 2. 大表专用配置
-- 对特定表设置更激进的 vacuum 策略
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor = 0.01,  -- 1% 就触发
    autovacuum_vacuum_cost_delay = 5,        -- 减少 vacuum 延迟
    autovacuum_vacuum_cost_limit = 1000      -- 增加 vacuum 速率
);

-- 3. 并行 vacuum（PostgreSQL 13+）
autovacuum_max_workers = 4                -- 并行 vacuum 工作进程数
autovacuum_naptime = 30s                  -- 每 30 秒检查一次

-- 4. vacuum 成本控制
autovacuum_vacuum_cost_delay = 2ms        -- 每次 IO 操作后的延迟
autovacuum_vacuum_cost_limit = 200        -- 累积成本达到阈值后暂停
```

## 表膨胀检测

### 使用 pgstattuple 扩展

```sql
CREATE EXTENSION pgstattuple;

-- 检查表膨胀率
SELECT
    table_len,
    dead_tuple_len,
    ROUND(dead_tuple_len::numeric / table_len * 100, 2) AS dead_pct,
    free_space,
    ROUND(free_space::numeric / table_len * 100, 2) AS free_pct
FROM pgstattuple('orders');

-- 检查索引膨胀
SELECT
    version,
    tree_level,
    index_size,
    free_space
FROM pgstatindex('idx_orders_user_id');
```

### 使用系统视图

```sql
-- 查看表的死元组统计
SELECT
    schemaname,
    relname AS table_name,
    n_live_tup,
    n_dead_tup,
    ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct,
    last_autovacuum,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

## 手动 VACUUM

```sql
-- 标准 vacuum（不锁表，回收空间供复用但不归还 OS）
VACUUM orders;

-- vacuum full（锁表，重建表文件，空间归还 OS）
VACUUM FULL orders;  -- ⚠️ 会锁表，生产慎用

-- vacuum analyze（同时更新统计信息）
VACUUM ANALYZE orders;

-- 并行 vacuum（PostgreSQL 13+）
VACUUM (PARALLEL 4) orders;
```

### VACUUM vs VACUUM FULL

| 维度 | VACUUM | VACUUM FULL |
|------|--------|-------------|
| 锁表 | 不锁表 | 排他锁 |
| 空间回收 | 供复用，不归还 OS | 归还 OS |
| 并发影响 | 小 | 大（阻塞所有操作） |
| 适用场景 | 日常维护 | 严重膨胀时一次性清理 |

## 事务 ID 回卷防护

### 问题

PostgreSQL 使用 32 位事务 ID（约 21 亿），当 ID 用尽后会"回卷"到 0，导致旧数据被误判为"未来"数据而不可见。

### 防护措施

```sql
-- 检查事务 ID 年龄
SELECT
    relname,
    age(relfrozenxid) AS xid_age,
    current_setting('autovacuum_freeze_max_age')::int AS freeze_max_age
FROM pg_class
WHERE relkind = 'r'
ORDER BY xid_age DESC;

-- 当 xid_age 接近 autovacuum_freeze_max_age（默认 2 亿）时
-- PostgreSQL 会强制执行 aggressive vacuum
```

### 配置

```sql
-- postgresql.conf
autovacuum_freeze_max_age = 200000000      -- 2 亿
vacuum_freeze_min_age = 50000000            -- 5000 万
vacuum_freeze_table_age = 150000000         -- 1.5 亿
```

## Laravel 中的 Vacuum 策略

```php
// 1. 定时任务：每天凌晨 vacuum 高频写入表
// app/Console/Commands/VacuumTables.php
class VacuumTables extends Command
{
    protected $signature = 'db:vacuum {--table=}';
    protected $description = 'Vacuum PostgreSQL tables';

    public function handle()
    {
        $tables = $this->option('table')
            ? [$this->option('table')]
            : ['orders', 'order_items', 'access_logs', 'events'];

        foreach ($tables as $table) {
            DB::statement("VACUUM ANALYZE {$table}");
            $this->info("Vacuumed: {$table}");
        }
    }
}

// app/Console/Kernel.php
$schedule->command('db:vacuum')->dailyAt('03:00');

// 2. 监控脚本：检测表膨胀
class CheckBloat extends Command
{
    public function handle()
    {
        $bloated = DB::select("
            SELECT relname, n_dead_tup,
                   ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct
            FROM pg_stat_user_tables
            WHERE n_dead_tup > 10000
            ORDER BY n_dead_tup DESC
        ");

        foreach ($bloated as $table) {
            if ($table->dead_pct > 20) {
                Log::warning("Table {$table->relname} is {$table->dead_pct}% dead tuples");
            }
        }
    }
}
```

## 实战文章（来自博客）

- [PostgreSQL Vacuum 调优实战：autovacuum 参数、表膨胀治理、索引碎片整理——高写入 Laravel 应用的数据库维护指南](/categories/MySQL/PostgreSQL-Vacuum-调优实战/)

## 相关概念

- [PostgreSQL 事务隔离级别](PostgreSQL事务隔离级别.md) - MVCC 与隔离级别
- [MVCC](MVCC.md) - 多版本控制原理
- [存储引擎](存储引擎.md) - InnoDB vs MyISAM
- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - 核心差异

## 常见问题

**Q: autovacuum 跟不上怎么办？**
A: 降低 `autovacuum_vacuum_scale_factor`、增加 `autovacuum_max_workers`、对大表设置独立的 vacuum 参数。

**Q: VACUUM FULL 什么时候用？**
A: 表膨胀严重（>50%）且无法通过普通 VACUUM 回收空间时。建议在维护窗口执行，或使用 `pg_repack` 工具在线重建。

**Q: 如何监控 autovacuum 是否正常？**
A: 查看 `pg_stat_user_tables.last_autovacuum` 字段，结合 `n_dead_tup` 判断是否及时清理。
