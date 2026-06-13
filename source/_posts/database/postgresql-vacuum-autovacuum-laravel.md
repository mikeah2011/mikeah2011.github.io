---

title: PostgreSQL Vacuum 调优实战：autovacuum 参数、表膨胀治理、索引碎片整理——高写入 Laravel 应用的数据库维护指南
keywords: [PostgreSQL Vacuum, autovacuum, Laravel, 调优实战, 参数, 表膨胀治理, 索引碎片整理, 高写入, 应用的数据库维护指南]
date: 2026-06-06 12:00:00
tags:
- PostgreSQL
- Vacuum
- 性能优化
- 数据库
- Laravel
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
description: 深入解析PostgreSQL Vacuum调优实战，涵盖autovacuum参数精细配置、表膨胀（Table Bloat）诊断与治理、索引碎片整理方案对比（VACUUM FULL vs pg_repack vs REINDEX CONCURRENTLY）。结合高写入Laravel电商应用的真实场景，提供从MVCC原理理解到生产环境监控告警的完整性能优化路径，附赠可直接落地的SQL脚本与最佳实践速查清单。
---



## 前言

在 PostgreSQL 的运维体系中，Vacuum 是最容易被忽视、也最容易在生产环境引发严重事故的核心机制。很多团队从 MySQL 迁移到 PostgreSQL 之后，沿用了"建好索引、调好慢查询就完事"的惯性思维，直到某天值班的同学收到告警：磁盘使用率从 40% 飙升到 85%，一条原本 5ms 就能返回的简单查询突然退化到 2 秒以上，极端情况下甚至触发 `ERROR: could not extend file: No space left on device` 的致命错误。

这些问题的根源几乎都可以追溯到同一个概念——**表膨胀（Table Bloat）**。PostgreSQL 采用 MVCC（多版本并发控制）机制来保证高并发环境下的读写隔离，这个设计带来了极好的并发性能，但代价是每次 UPDATE 或 DELETE 操作都不会立即释放物理空间，而是在表中留下大量被称为"死元组"（Dead Tuples）的数据残留。这些死元组必须依赖 VACUUM 进程来回收，如果回收速度跟不上产生速度，表就会像气球一样不断膨胀。

本文将从 MVCC 的底层原理出发，结合一个真实运行的高写入 Laravel 电商应用，系统性地讲解 Vacuum 调优策略、表膨胀诊断方法、空间回收方案选择以及索引碎片整理的完整实战路径。无论你是刚接触 PostgreSQL 的开发者，还是负责数据库运维的 DBA，都能从中获得可直接落地的配置和脚本。

---

## 一、Vacuum 基础：MVCC 机制下的死元组与空间回收原理

### 1.1 PostgreSQL 的 MVCC 如何工作

与 MySQL InnoDB 的 undo log 回滚段机制不同，PostgreSQL 实现了一种"原地多版本"的 MVCC 方案。当一行数据被 UPDATE 时，PostgreSQL 不会修改原有的行数据，而是执行以下操作：

1. 在表的堆页面（Heap Page）中找到旧行，将其 `xmax` 字段设置为当前事务的 ID，标记该行对后续事务不可见。
2. 在同一个堆页面（或新的页面，如果没有足够空间）中插入一个全新的行版本，其 `xmin` 字段设置为当前事务 ID。

换句话说，**每一次 UPDATE 在物理层面等价于一次 DELETE 加一次 INSERT**。DELETE 操作也类似——它不会物理移除行数据，只是通过设置 `xmax` 来标记该行"已死亡"。

```sql
-- 查看某行的事务可见性信息
SELECT ctid, xmin, xmax, *
FROM orders
WHERE id = 12345;

-- ctid: (42, 7) 表示该行位于第 42 个页面的第 7 个偏移位置
-- xmin: 创建该行版本的事务 ID
-- xmax: 删除或更新该行版本的事务 ID（0 表示当前行仍然存活）
```

这意味着在一张高写入的表中，死元组会以惊人的速度积累。以一个典型的 Laravel 电商应用为例，假设 `orders` 表每秒有 200 次状态更新操作（pending → processing → shipped → completed 之类的流转），那么一天下来将产生大约 1728 万个死元组。如果这些死元组不能被及时清理，表的物理文件大小将不断增长，严重时可能超出磁盘可用空间。

### 1.2 堆页面的内部结构

要深入理解 VACUUM 的工作方式，需要了解 PostgreSQL 堆页面的存储结构。每个堆页面默认大小为 8KB，其内部包含：

- **Page Header**：页面元数据（24 字节），包括页面 LSN、空闲空间指针等。
- **Line Pointer Array**：行指针数组，每个指针 4 字节，指向页面中各行数据的实际位置。
- **Tuple Data**：实际的行数据区域，从页面底部向头部增长。
- **Free Space**：页面中的空闲空间，位于行指针数组和行数据之间。

当一行被删除（或更新产生新版本）后，旧行占用的空间成为"可复用空间"，但页面本身并不会缩小。标准 VACUUM 只是将这些可复用空间标记出来，供后续的 INSERT 或 UPDATE 使用。只有 VACUUM FULL 才会真正重写整个页面、释放空页面并归还空间给操作系统。

```sql
-- 使用 pageinspect 扩展查看页面内部结构（仅用于学习和诊断）
CREATE EXTENSION IF NOT EXISTS pageinspect;

-- 查看 orders 表第 1 个页面的头部信息
SELECT * FROM page_header(get_raw_page('orders', 0));

-- 查看第 1 个页面中各行的行指针
SELECT lp, lp_off, lp_flags, lp_len
FROM heap_page_item_attrs(get_raw_page('orders', 0), 'orders'::regclass)
LIMIT 20;
```

### 1.3 VACUUM 的两种模式

PostgreSQL 提供两种 VACUUM 操作方式：

- **标准 VACUUM**：遍历表的所有页面，将死元组占用的空间标记为"可复用"，同时更新 FSM（Free Space Map）和可见性映射（Visibility Map）。不阻塞读写操作，不释放空间给操作系统，适合日常维护使用。
- **VACUUM FULL**：创建一个全新的表文件，将所有存活的行复制过去，然后替换原文件。这会释放空间给操作系统，但需要对表加排他锁（ACCESS EXCLUSIVE LOCK），在执行期间表完全不可读不可写。

```sql
-- 标准 VACUUM：不锁表，空间留给表自身复用
VACUUM orders;

-- 带 VERBOSE 输出的 VACUUM：查看详细的回收过程
VACUUM VERBOSE orders;

-- VACUUM FULL：锁表重写，空间归还给操作系统
VACUUM FULL orders;

-- VACUUM FREEZE：专门用于冻结旧事务 ID，防止回卷
VACUUM FREEZE orders;

-- 分析统计信息（不回收空间，仅更新查询计划器使用的统计信息）
ANALYZE orders;

-- 同时执行 VACUUM 和 ANALYZE
VACUUM ANALYZE orders;
```

### 1.4 可见性映射与索引扫描优化

PostgreSQL 8.4 引入了一个重要的优化机制——可见性映射（Visibility Map，VM）。VM 记录了每个堆页面中是否所有行都对所有活跃事务可见。当一个页面被标记为"全部可见"后，索引扫描可以跳过对这些页面的回表可见性检查，显著提高只读查询的性能。

这就是为什么 VACUUM 不仅是为了回收空间，还直接关系到查询性能——VACUUM 会更新可见性映射，使得更多页面被标记为"全部可见"，从而加速索引扫描。

```sql
-- 查看可见性映射的覆盖情况
SELECT
    c.relname,
    pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
    pg_size_pretty(pg_relation_size(c.reltoastrelid)) AS toast_size
FROM pg_class c
WHERE c.relname = 'orders';
```

### 1.5 为什么 autovacuum 至关重要

PostgreSQL 从 8.3 版本开始引入了 autovacuum 守护进程，它在后台持续监控数据库中各表的变更情况，当某个表的死元组数量超过阈值时自动触发 VACUUM 操作。autovacuum 的存在解决了手动维护的三大痛点：

第一，**事务 ID 回卷风险**。PostgreSQL 使用 32 位无符号整数作为事务 ID，理论上在约 21 亿次事务后会发生回卷。如果不通过 VACUUM FREEZE 来冻结旧的事务 ID，数据库在检测到回卷风险时会强制停机，防止数据损坏。这是 PostgreSQL 运维中最危险的故障之一。

第二，**死元组空间浪费**。没有 autovacuum，死元组将永远占据表的物理空间，导致查询需要扫描更多页面，索引效率也会因为页面密度降低而下降。

第三，**查询计划器统计信息过时**。autovacuum 会定期触发 ANALYZE 来更新表的统计信息。如果统计信息过时，查询计划器可能会选择错误的执行计划，例如在应该使用索引扫描时选择了全表扫描。

---

## 二、autovacuum 参数调优

默认的 autovacuum 配置是为了兼容各种硬件环境而设置的保守值，非常适合低写入、小规模的数据库。但在高写入的 Laravel 应用场景下，这些默认值往往会导致 autovacuum 触发不及时或执行太慢，必须进行针对性的参数调优。

### 2.1 核心参数详解

#### autovacuum_vacuum_threshold

这个参数定义了触发 VACUUM 的最小死元组数量，也就是说，即使死元组比例达到了 scale_factor 的要求，如果绝对数量没超过这个阈值，VACUUM 也不会触发。默认值为 50。对于写入频繁的大表，这个值通常不是瓶颈，但对于行数很少的表可以适当提高，避免对小表频繁执行无意义的 VACUUM。

```sql
-- 查看当前的全局配置
SHOW autovacuum_vacuum_threshold;    -- 默认值: 50
SHOW autovacuum_vacuum_scale_factor; -- 默认值: 0.2
```

#### autovacuum_vacuum_scale_factor

这个参数定义了触发 VACUUM 的死元组占总行数的比例阈值。默认值为 0.2，即 20%。实际的触发条件为：`死元组数量 > autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor × 表的总行数`。

这个默认值在高写入场景下问题非常大。对于一张 1000 万行的 orders 表，按照默认的 0.2 比例，需要积累到 **200 万条死元组**才会触发 VACUUM。这意味着在 VACUUM 启动之前，表已经膨胀了将近 20%，而且这 200 万条死元组的清理也需要相当长的时间，在此期间表还在继续膨胀。

#### autovacuum_naptime

autovacuum 守护进程在一轮工作完成后，会休息一段时间再开始下一轮检查。`autovacuum_naptime` 就是这个休息间隔。默认值为 1 分钟。在高写入场景下可以适当缩短到 30 秒甚至 20 秒，但不建议低于 10 秒，因为过短的间隔会让 autovacuum worker 频繁地扫描 `pg_stat_user_tables`，增加系统开销。

#### autovacuum_vacuum_cost_limit 与 vacuum_cost_delay

这两个参数共同控制 VACUUM 的 I/O 节流机制。autovacuum 每读取或写入一个页面都会累积"成本"，当累计成本超过 `autovacuum_vacuum_cost_limit`（默认继承 `vacuum_cost_limit` 的 200）时，worker 会暂停 `autovacuum_vacuum_cost_delay`（默认继承 `vacuum_cost_delay` 的 20ms）。

这个设计的初衷是避免 VACUUM 占用过多磁盘 I/O 影响前台业务。但在 SSD 存储和高 I/O 能力的现代服务器上，默认的节流参数会导致 VACUUM 执行过于缓慢，反而让死元组越积越多。

#### autovacuum_work_limit（PostgreSQL 12+）

从 PostgreSQL 12 开始，每个 autovacuum worker 可以使用额外的并行工作线程来加速清理。这个参数控制每个 worker 可以启动的辅助线程数。

### 2.2 高写入场景的全局推荐配置

以下是针对高写入 Laravel 电商应用推荐的 `postgresql.conf` 配置：

```ini
# ============ autovacuum 全局调优 ============

# 启用 autovacuum（生产环境绝对不能关闭！）
autovacuum = on

# 缩短检查间隔：从默认 1min 降到 30s
autovacuum_naptime = 30s

# 降低死元组比例阈值：从默认 20% 降到 5%
# 让 autovacuum 在表膨胀到 5% 时就开始工作
autovacuum_vacuum_scale_factor = 0.05

# 设置最小死元组数量阈值
autovacuum_vacuum_threshold = 100

# 提高 I/O 成本上限：从默认 200 提高到 1000
# 让 VACUUM 工作得更快，减少死元组积累时间
vacuum_cost_limit = 1000
vacuum_cost_page_hit = 1
vacuum_cost_page_miss = 10
vacuum_cost_page_dirty = 20

# 减少 VACUUM 的暂停时间
vacuum_cost_delay = 5ms           # 从默认 20ms 降到 5ms

# 提高 VACUUM 使用的工作内存
maintenance_work_mem = 1GB        # 从默认 64MB 大幅提高

# 增加并行 autovacuum worker 数量
autovacuum_max_workers = 4        # 默认值 3，适当增加

# ANALYZE 相关参数
autovacuum_analyze_scale_factor = 0.02
autovacuum_analyze_threshold = 100
```

### 2.3 表级别精细配置

全局配置是基准值，但不同表的写入频率和数据特征差异很大。PostgreSQL 支持在表级别覆盖 autovacuum 的各项参数，这是调优中最关键的手段之一。

```sql
-- 高写入的 orders 表：频繁 UPDATE（状态流转），需要更激进的 VACUUM
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor = 0.01,     -- 1% 死元组即触发
    autovacuum_vacuum_threshold = 500,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_analyze_threshold = 200,
    autovacuum_vacuum_cost_limit = 2000         -- 更高的 I/O 预算
);

-- 中等写入的 payments 表：主 INSERT，偶尔 UPDATE
ALTER TABLE payments SET (
    autovacuum_vacuum_scale_factor = 0.02,     -- 2%
    autovacuum_vacuum_threshold = 1000,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_analyze_threshold = 500,
    autovacuum_vacuum_cost_limit = 1500
);

-- 极高写入的 audit_logs 表：纯 INSERT，量最大
ALTER TABLE audit_logs SET (
    autovacuum_vacuum_scale_factor = 0.005,    -- 0.5%
    autovacuum_vacuum_threshold = 2000,
    autovacuum_analyze_scale_factor = 0.002,
    autovacuum_analyze_threshold = 1000,
    autovacuum_vacuum_cost_limit = 3000
);

-- 低写入的 categories 表：很少更新，放宽条件减少不必要的 VACUUM 开销
ALTER TABLE categories SET (
    autovacuum_vacuum_scale_factor = 0.5,      -- 50%
    autovacuum_vacuum_threshold = 50
);
```

可以通过查询系统表来确认表级别的参数是否已经生效：

```sql
SELECT
    relname,
    reloptions
FROM pg_class
WHERE relname IN ('orders', 'payments', 'audit_logs', 'categories');
```

### 2.4 PostgreSQL 13+ 的并行 VACUUM

从 PostgreSQL 13 开始，VACUUM 支持对索引进行并行处理，可以显著缩短大表的 VACUUM 时间：

```sql
-- 手动执行并行 VACUUM（使用 4 个并行 worker）
VACUUM (PARALLEL 4, VERBOSE) orders;

-- 查看并行 VACUUM 的执行进度
SELECT * FROM pg_stat_progress_vacuum;
```

需要注意的是，`autovacuum_vacuum_cost_limit` 在并行模式下会在各 worker 之间均分，所以使用并行 VACUUM 时需要相应提高 cost limit。

---

## 三、表膨胀（Table Bloat）的诊断

在着手调优之前，你需要清楚地知道哪些表膨胀了、膨胀了多少、以及膨胀的原因是什么。以下是两种层次递进的诊断方法。

### 3.1 第一层：使用 pg_stat_user_tables 快速筛查

`pg_stat_user_tables` 是 PostgreSQL 内置的统计视图，不需要安装额外扩展，适合日常巡检：

```sql
SELECT
    schemaname,
    relname AS table_name,
    n_live_tup,                                 -- 活跃行数
    n_dead_tup,                                 -- 死元组数
    ROUND(
        n_dead_tup::numeric /
        NULLIF(n_live_tup + n_dead_tup, 0) * 100,
        2
    ) AS dead_ratio_pct,                        -- 死元组占比（百分比）
    last_autovacuum,                            -- 上次自动 VACUUM 时间
    last_autoanalyze,                           -- 上次自动 ANALYZE 时间
    autovacuum_count,                           -- 自动 VACUUM 执行次数
    n_tup_upd,                                  -- UPDATE 操作计数
    n_tup_del                                   -- DELETE 操作计数
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC
LIMIT 20;
```

这个查询能快速告诉你哪些表有大量死元组、死元组在总行数中的比例、以及 autovacuum 最近的执行情况。如果发现某张表的 `last_autovacuum` 为 NULL 或者非常久远，同时 `n_dead_tup` 持续增长，那大概率就是膨胀的"重灾区"。

但需要注意，`n_dead_tup` 是一个由统计收集器维护的近似值，它可能不完全准确。在以下情况下它可能出现偏差：手动 VACUUM 之后计数器不会立即更新、大量并发写入时统计收集器存在延迟等。因此对于关键表，需要使用更精确的诊断工具。

### 3.2 第二层：使用 pgstattuple 扩展精确诊断

`pgstattuple` 扩展可以对表进行物理层面的精确扫描，给出每个页面的占用情况、死元组的确切数量和大小，是诊断表膨胀的"金标准"工具：

```sql
-- 安装扩展（每个数据库只需执行一次）
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- 对 orders 表进行精确的物理扫描
SELECT
    table_len,                              -- 表的物理大小（字节）
    tuple_count,                            -- 存活元组数量
    tuple_len,                              -- 存活元组占用的字节数
    tuple_percent,                          -- 存活元组的占比
    dead_tuple_count,                       -- 死元组数量
    dead_tuple_len,                         -- 死元组占用的字节数
    ROUND(dead_tuple_len::numeric /
        table_len * 100, 2) AS dead_space_pct,
    free_space,                             -- 可复用的空闲空间
    ROUND(free_space::numeric /
        table_len * 100, 2) AS free_space_pct
FROM pgstattuple('orders');
```

这个查询的输出包含三个关键指标：`dead_space_pct`（死空间占比）、`free_space_pct`（空闲空间占比）、以及 `tuple_percent`（有效数据占比）。如果一张表的有效数据只占 40%，而死空间和空闲空间加起来占了 60%，那这张表就严重膨胀了。

> **重要提示**：`pgstattuple` 执行的是全表扫描操作，对于几十 GB 的大表可能需要数分钟甚至更长时间。建议在业务低峰期执行，避免影响在线服务。

### 3.3 使用 pg_bloat_check 或手动估算膨胀率

对于不方便安装扩展的环境，可以使用以下基于系统统计的估算方法：

```sql
WITH bloat_estimation AS (
    SELECT
        current_database() AS database_name,
        schemaname,
        tablename,
        -- 估计的行数
        reltuples::bigint AS est_rows,
        -- 数据页数
        relpages::bigint AS total_pages,
        -- 基于页面数和行数估算的理想页面数
        CEIL(reltuples / ((current_setting('block_size')::numeric - 24) /
            (CASE WHEN reltuples > 0
                THEN pg_relation_size(schemaname || '.' || tablename)::numeric / reltuples
                ELSE 0 END
            + 23))) AS est_pages_needed,
        pg_size_pretty(pg_relation_size(schemaname || '.' || tablename)) AS table_size,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS total_size
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = relnamespace
    JOIN pg_tables ON tablename = relname AND schemaname = nspname
    WHERE nspname = 'public'
      AND relkind = 'r'
      AND reltuples > 10000
)
SELECT
    tablename,
    table_size,
    est_rows,
    total_pages,
    est_pages_needed,
    ROUND(
        (total_pages - est_pages_needed)::numeric /
        NULLIF(total_pages, 0) * 100, 2
    ) AS estimated_bloat_pct
FROM bloat_estimation
ORDER BY estimated_bloat_pct DESC NULLS LAST
LIMIT 20;
```

---

## 四、手动 VACUUM FULL vs pg_repack 在线整理方案

当表膨胀已经严重影响查询性能或磁盘空间时，你需要选择合适的方案来回收空间。这是在"在线可用性"和"空间回收效果"之间做权衡。

### 4.1 VACUUM FULL 的代价与适用场景

```sql
-- VACUUM FULL 会对表加排他锁，生产环境慎用
VACUUM FULL VERBOSE orders;
```

VACUUM FULL 的执行过程是：创建一个新的表文件，将所有存活的行按物理顺序复制到新文件中，然后更新系统目录指向新文件，最后删除旧文件。整个过程需要持有 ACCESS EXCLUSIVE LOCK，意味着在执行期间：

- 该表的所有查询（SELECT）都会被阻塞
- 该表的所有写入（INSERT、UPDATE、DELETE）都会被阻塞
- 所有引用该表的外键操作也会被阻塞
- 由于需要同时维护旧文件和新文件，执行期间的磁盘空间需求约为原表的 2 倍

对于一张 50GB 的订单表，VACUUM FULL 可能需要锁表 20-40 分钟，在此期间所有涉及该表的 API 请求都会超时。这在电商大促等高并发场景下是完全不可接受的。

### 4.2 pg_repack：生产环境的首选方案

`pg_repack` 是 PostgreSQL 生态中最成熟、最广泛使用的在线空间回收工具。它的核心工作原理是：

1. 在后台创建一张与原表结构完全相同的新表。
2. 在原表上创建触发器，捕获所有增量变更（INSERT、UPDATE、DELETE）并同步到新表。
3. 将原表的数据按照主键顺序批量复制到新表。
4. 对新表进行索引重建。
5. 在极短暂的排他锁窗口内，通过重命名和系统目录更新来原子性地交换新旧表。

整个过程中，步骤 1-4 都是在不阻塞读写的情况下完成的。只有步骤 5 需要短暂的排他锁（通常在毫秒级别），对外部应用来说几乎是无感知的。

```bash
# 安装 pg_repack
# Ubuntu/Debian
sudo apt install postgresql-16-repack

# CentOS/RHEL
sudo yum install pg_repack_16

# macOS (Homebrew)
brew install pg_repack

# 在数据库中安装扩展（需要超级用户权限）
CREATE EXTENSION pg_repack;

# 对 orders 表进行在线空间整理
pg_repack -d mydb -t orders --no-superuser-check

# 同时整理多张表
pg_repack -d mydb -t orders -t payments -t audit_logs

# 仅重建索引，不重写表数据
pg_repack -d mydb -t orders --only-indexes

# 仅重建指定索引
pg_repack -d mydb -i idx_orders_created_at

# 指定新的表空间
pg_repack -d mydb -t orders --tablespace=new_fast_ssd

# 使用指定数量的并行 worker 加速
pg_repack -d mydb -t orders --jobs=4
```

**使用 pg_repack 的注意事项**：

- 需要安装对应的 PostgreSQL 版本的 pg_repack 扩展
- 执行期间会创建触发器，对原表的写入会略有额外开销
- 需要足够的临时磁盘空间（约 1.5 倍表大小）
- 对于超大表（数百 GB），执行时间可能长达数小时，建议在低峰期启动
- 如果执行中断，pg_repack 会在原表上留下触发器和日志表，需要手动清理

### 4.3 两种方案的对比与选择

| 对比维度 | VACUUM FULL | pg_repack |
|---------|-------------|-----------|
| 是否锁表 | 排他锁，完全阻塞读写 | 在线无锁，仅最后切换瞬间极短锁 |
| 空间回收效果 | 完全回收归还操作系统 | 完全回收归还操作系统 |
| 额外磁盘需求 | 约 2 倍原表大小 | 约 1.5 倍原表大小 |
| 执行速度 | 较快（单进程顺序写） | 略慢（触发器同步增量） |
| 索引处理 | 不自动重建索引 | 可以同时重建索引 |
| 失败恢复 | 事务内自动回滚 | 需要手动清理残留对象 |
| 适用场景 | 紧急修复、可接受短暂停机 | 生产环境常规维护 |

我的建议是：**在生产环境中，99% 的场景都应该选择 pg_repack**。只有当你确信可以接受服务短暂中断（例如维护窗口），且 pg_repack 由于某些原因无法使用时，才考虑 VACUUM FULL。

---

## 五、索引碎片整理：REINDEX vs pg_repack 索引重建

表膨胀只是问题的一个维度，索引碎片同样是影响查询性能的重要因素。PostgreSQL 的 B-tree 索引在频繁的 INSERT、UPDATE、DELETE 操作后，会产生多种内部碎片：

- **内部页面分裂**：当页面满了需要分裂时，会产生半空的页面。
- **死元组残留**：索引中指向已死堆元组的条目不会被立即清理。
- **页面密度不均**：频繁更新导致页面中的条目分布不均匀。

### 5.1 诊断索引膨胀

```sql
-- 使用 pgstatindex 查看 B-tree 索引的详细内部状态
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- 查看 orders_pkey 索引的物理状态
SELECT
    version,                    -- 索引版本
    tree_level,                 -- B-tree 层级
    index_size,                 -- 索引物理大小
    root_block_no,              -- 根节点页面号
    internal_pages,             -- 内部节点页面数
    leaf_pages,                 -- 叶子节点页面数
    empty_pages,                -- 空页面数
    deleted_pages,              -- 已删除但未回收的页面数
    ROUND(avg_leaf_density, 2) AS avg_leaf_density_pct,  -- 叶子节点平均填充率
    ROUND(free_space::numeric / index_size * 100, 2) AS fragmentation_pct
FROM pgstatindex('orders_pkey');
```

其中最关键的指标是 `avg_leaf_density_pct`（叶子节点平均密度）。一个健康的 B-tree 索引叶子节点密度通常在 60%-80% 之间。如果低于 50%，说明索引有严重的内部碎片，需要整理。

另一个重要指标是 `empty_pages` 和 `deleted_pages`。大量空页面意味着索引曾经经历过大规模的删除操作，这些空页面如果不能被及时复用，就是纯粹的空间浪费。

```sql
-- 批量检查所有索引的大小和使用情况
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    idx_scan AS times_used,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;
```

### 5.2 REINDEX 命令

```sql
-- 重建单个索引（PostgreSQL 12+ 支持 CONCURRENTLY 选项）
REINDEX INDEX CONCURRENTLY idx_orders_created_at;

-- 重建某张表的所有索引
REINDEX TABLE CONCURRENTLY orders;

-- 重建整个数据库的所有索引（慎用，大型数据库耗时很长）
REINDEX DATABASE CONCURRENTLY mydb;
```

`REINDEX CONCURRENTLY` 的工作原理是：先创建一个同结构的新索引，通过监听原表的变更来保持新索引同步，当新索引构建完成后在系统目录中原子性替换原索引。它不阻塞读写操作，但有以下注意事项：

- 不能在事务块中执行
- 执行期间会同时存在新旧两个索引，需要双倍索引空间
- 如果执行中途失败，可能留下 `INVALID` 状态的索引，需要手动 DROP 后重建
- 新索引的物理顺序可能与原索引不同，对后续的范围查询性能有影响

```sql
-- 检查是否有因 REINDEX CONCURRENTLY 失败留下的无效索引
SELECT
    indexrelid::regclass AS index_name,
    indrelid::regclass AS table_name,
    indisvalid,
    indisready
FROM pg_index
WHERE NOT indisvalid;
```

### 5.3 使用 pg_repack 整理索引

pg_repack 不仅可以重写表，还可以仅重建索引而不触碰表数据：

```bash
# 仅重建 orders 表上的所有索引
pg_repack -d mydb -t orders --only-indexes

# 重建指定的单个索引
pg_repack -d mydb -i idx_orders_created_at
```

相比 REINDEX CONCURRENTLY，pg_repack 重建索引的优势在于：不会产生 INVALID 状态的索引、对系统资源的消耗更可控、可以一次批量处理多张表的索引。在大多数生产场景下，我更推荐使用 pg_repack 来做索引整理。

### 5.4 索引维护策略

对于高写入的表，建议建立以下索引维护机制：

```sql
-- 查找从未被使用过的索引（可以安全删除以减少写放大）
SELECT
    indexrelid::regclass AS index_name,
    relname AS table_name,
    idx_scan AS usage_count,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
JOIN pg_class ON pg_class.oid = indexrelid
WHERE idx_scan = 0
  AND schemaname = 'public'
  AND indexrelid::regclass::text NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;

-- 查找重复或高度重叠的索引
SELECT
    a.indexrelid::regclass AS index_a,
    b.indexrelid::regclass AS index_b,
    pg_size_pretty(pg_relation_size(a.indexrelid)) AS size_a,
    pg_size_pretty(pg_relation_size(b.indexrelid)) AS size_b
FROM pg_index a
JOIN pg_index b ON a.indrelid = b.indrelid
    AND a.indexrelid != b.indexrelid
    AND a.indkey::text LIKE b.indkey::text || '%'
WHERE a.indrelid::regclass::text NOT LIKE 'pg_%'
ORDER BY pg_relation_size(a.indexrelid) DESC;
```

---

## 六、高写入 Laravel 场景的 Vacuum 策略

以一个典型的 Laravel 电商应用为例，数据库中有以下几张高写入的表，它们的写入模式各有不同，因此需要分别制定 Vacuum 策略：

- **orders**（订单表）：高频 UPDATE，因为订单状态会频繁流转（pending → processing → shipped → delivered → completed），还有退款等场景。
- **payments**（支付记录表）：高频 INSERT，偶尔 UPDATE（退款或部分退款），单条记录较大（包含支付渠道的原始响应）。
- **audit_logs**（审计日志表）：纯 INSERT，从不 UPDATE 和 DELETE，数据量增长最快，单条记录也比较大（包含请求体和响应体的 JSON）。

### 6.1 各表的定制化 Vacuum 参数

```sql
-- orders 表：高频 UPDATE 驱动
-- 核心目标：尽快回收 UPDATE 产生的死元组，避免膨胀
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor = 0.01,      -- 1% 即触发
    autovacuum_vacuum_threshold = 500,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_analyze_threshold = 200,
    autovacuum_vacuum_cost_limit = 2000          -- 高 I/O 预算
);

-- payments 表：INSERT 为主，偶尔 UPDATE
-- 核心目标：定期清理少量死元组，保持统计信息准确
ALTER TABLE payments SET (
    autovacuum_vacuum_scale_factor = 0.02,      -- 2%
    autovacuum_vacuum_threshold = 1000,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_analyze_threshold = 500,
    autovacuum_vacuum_cost_limit = 1500
);

-- audit_logs 表：纯 INSERT，死元组少但表增长快
-- 核心目标：主要维护统计信息准确性
ALTER TABLE audit_logs SET (
    autovacuum_vacuum_scale_factor = 0.005,     -- 0.5%
    autovacuum_vacuum_threshold = 2000,
    autovacuum_analyze_scale_factor = 0.002,
    autovacuum_analyze_threshold = 1000,
    autovacuum_vacuum_cost_limit = 3000,
    toast.autovacuum_enabled = true              -- 确保 TOAST 表也被清理
);
```

### 6.2 Laravel 应用层面的配合措施

**使用批量操作降低事务影响**

```php
// 不推荐：单次 DELETE 删除大量记录
// 会长时间持有行锁，产生大量 WAL 日志，而且死元组集中爆发
Order::where('status', 'cancelled')
    ->where('created_at', '<', now()->subYears(2))
    ->delete();

// 推荐：分批删除，每批限制数量，给 autovacuum 留出喘息空间
Order::where('status', 'cancelled')
    ->where('created_at', '<', now()->subYears(2))
    ->chunkById(500, function ($orders) {
        $orders->each->delete();
        usleep(50000); // 每批间隔 50ms，降低 I/O 压力
    });
```

**对 audit_logs 使用声明式分区表**

对于 audit_logs 这类时序数据，最有效的防膨胀手段是分区。直接 DROP 整个分区比 DELETE 数百万条记录高效得多，完全不产生死元组：

```php
// 在 Laravel Migration 中创建按月分区的审计日志表
Schema::create('audit_logs', function (Blueprint $table) {
    $table->id();
    $table->string('event_type', 50)->index();
    $table->string('auditable_type', 100);
    $table->unsignedBigInteger('auditable_id');
    $table->string('user_id', 36)->nullable()->index();
    $table->jsonb('old_values')->nullable();
    $table->jsonb('new_values')->nullable();
    $table->jsonb('metadata')->nullable();
    $table->ipAddress('ip_address')->nullable();
    $table->text('user_agent')->nullable();
    $table->timestamp('created_at');
});

// 使用原生 SQL 创建分区
DB::statement("
    ALTER TABLE audit_logs PARTITION BY RANGE (created_at)
");

// 创建月度分区
for ($month = 1; $month <= 12; $month++) {
    $startDate = Carbon::create(2026, $month, 1);
    $endDate = $startDate->copy()->addMonth();
    $partitionName = 'audit_logs_' . $startDate->format('Y_m');

    DB::statement("
        CREATE TABLE {$partitionName}
        PARTITION OF audit_logs
        FOR VALUES FROM ('{$startDate->toDateString()}')
        TO ('{$endDate->toDateString()}')
    ");
}
```

### 6.3 配套的 Laravel 定时任务

```php
// app/Console/Commands/DatabaseVacuumCheck.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;

class DatabaseVacuumCheck extends Command
{
    protected $signature = 'db:vacuum-check';
    protected $description = 'Check table bloat and autovacuum status';

    public function handle(): int
    {
        // 检查各表的膨胀状态
        $bloatReport = DB::select("
            SELECT
                relname,
                n_live_tup,
                n_dead_tup,
                ROUND(n_dead_tup::numeric /
                    NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct,
                last_autovacuum,
                pg_size_pretty(pg_total_relation_size(relid)) AS total_size
            FROM pg_stat_user_tables
            WHERE schemaname = 'public'
              AND n_dead_tup > 1000
            ORDER BY n_dead_tup DESC
        ");

        foreach ($bloatReport as $table) {
            $this->info("{$table->relname}: {$table->dead_pct}% dead, " .
                        "size={$table->total_size}, " .
                        "last_vacuum={$table->last_autovacuum}");

            if ($table->dead_pct > 20) {
                Log::warning("表膨胀告警", [
                    'table' => $table->relname,
                    'dead_pct' => $table->dead_pct,
                    'total_size' => $table->total_size,
                    'last_autovacuum' => $table->last_autovacuum,
                ]);
            }
        }

        // 检查长事务
        $longTx = DB::select("
            SELECT pid, usename, state,
                   now() - xact_start AS duration,
                   LEFT(query, 100) AS query
            FROM pg_stat_activity
            WHERE xact_start IS NOT NULL
              AND now() - xact_start > interval '30 minutes'
            ORDER BY xact_start
        ");

        foreach ($longTx as $tx) {
            Log::warning("长事务告警", [
                'pid' => $tx->pid,
                'user' => $tx->usename,
                'duration' => $tx->duration,
                'query' => $tx->query,
            ]);
        }

        return self::SUCCESS;
    }
}
```

---

## 七、监控与告警

### 7.1 膨胀率监控 Dashboard

使用以下 SQL 查询构建 Grafana Dashboard 的数据源：

```sql
-- Grafana Dashboard 核心查询
SELECT
    relname AS table_name,
    n_live_tup,
    n_dead_tup,
    ROUND(n_dead_tup::numeric /
        NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS bloat_pct,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_total_relation_size(relid) AS total_bytes,
    EXTRACT(EPOCH FROM (now() - last_autovacuum)) AS seconds_since_vacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_live_tup > 1000
ORDER BY n_dead_tup DESC;
```

### 7.2 autovacuum 运行状态实时追踪

```sql
-- 查看当前正在执行的 autovacuum 任务及其进度
SELECT
    p.pid,
    p.datname,
    p.relid::regclass AS table_name,
    v.phase,
    v.heap_blks_total,
    v.heap_blks_scanned,
    v.heap_blks_vacuumed,
    ROUND(v.heap_blks_scanned::numeric /
        NULLIF(v.heap_blks_total, 0) * 100, 2) AS scan_pct,
    v.index_vacuum_count,
    v.max_dead_tuples,
    v.num_dead_tuples,
    now() - p.query_start AS running_duration
FROM pg_stat_progress_vacuum v
JOIN pg_stat_activity p ON p.pid = v.pid;

-- 查看 autovacuum 最近的执行历史
SELECT
    relname,
    last_autovacuum,
    autovacuum_count,
    n_dead_tup,
    pg_size_pretty(pg_total_relation_size(relid)) AS table_size,
    CASE
        WHEN last_autovacuum IS NULL THEN '从未自动 VACUUM'
        ELSE EXTRACT(EPOCH FROM (now() - last_autovacuum))::text || ' 秒前'
    END AS time_since_last_vacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY last_autovacuum ASC NULLS FIRST;
```

### 7.3 推荐的告警阈值

| 监控指标 | 警告阈值 | 严重阈值 | 推荐告警方式 |
|---------|---------|---------|------------|
| 表死元组比例 | > 15% | > 30% | 飞书/钉钉/Slack |
| 表死元组绝对数 | > 500 万 | > 2000 万 | 飞书 + 邮件 |
| 最近一次 autovacuum | > 24 小时 | > 72 小时 | 邮件 + 电话 |
| 单张表物理大小增长 | 一周 > 50% | 一周 > 100% | 飞书/钉钉 |
| autovacuum 单次运行时长 | > 30 分钟 | > 2 小时 | 飞书/钉钉 |
| 事务 ID 回卷进度 | > 50% | > 80% | 邮件 + 电话 + 应急响应 |

### 7.4 启用 autovacuum 详细日志

```ini
# postgresql.conf
log_autovacuum_min_duration = 1000    -- 记录执行超过 1 秒的 autovacuum
autovacuum_log_level = log            -- 日志级别
log_line_prefix = '%m [%p] %q%u@%d ' -- 日志前缀包含时间戳和进程号
```

---

## 八、生产环境真实踩坑案例与最佳实践

### 案例一：长事务阻塞 autovacuum 导致 6 倍膨胀

**现象**：`orders` 表在一周内从 5GB 膨胀到 32GB，监控显示 autovacuum 持续在运行但死元组数量几乎不减少。

**根因**：一位数据分析师在 DataGrip 中执行了 `BEGIN` 后忘记提交，保持了一个 IDLE IN TRANSACTION 状态的事务超过 48 小时。由于 PostgreSQL 的 MVCC 可见性规则，autovacuum 无法回收该事务开始之后产生的任何死元组——因为这些死元组对该长事务而言可能仍然"可见"。

```sql
-- 诊断长事务
SELECT
    pid,
    usename,
    application_name,
    state,
    now() - xact_start AS xact_duration,
    now() - query_start AS query_duration,
    LEFT(query, 200) AS query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start ASC;

-- 紧急终止超长空闲事务
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - xact_start > INTERVAL '1 hour';
```

**预防措施**：

```ini
# 设置空闲事务超时（PostgreSQL 14+），5 分钟自动终止
idle_in_transaction_session_timeout = '300000'

# 设置语句执行超时
statement_timeout = '300000'
```

### 案例二：autovacuum_max_workers 不足导致清理滞后

**现象**：凌晨批量任务结束后，大量表积累了数百万死元组，但监控发现同一时间只有 3 个 autovacuum worker 在工作，其余表在排队等待。

**根因**：默认的 `autovacuum_max_workers = 3` 对于只有几张表的小数据库够用，但在一个包含 20+ 用户表的电商数据库中明显不足。

**解决方案**：

```ini
# 增加 worker 数量（修改后需要 reload 配置即可，不需要重启）
autovacuum_max_workers = 6

# 注意：每增加一个 worker，总的 I/O 成本上限也会被分摊
# 所以需要同步提高 vacuum_cost_limit
vacuum_cost_limit = 2400    # 约 400 per worker × 6
```

### 案例三：TOAST 表的隐性膨胀

**现象**：`audit_logs` 表经过多次 pg_repack 整理后，物理大小仍然在增长。监控显示主表的死元组比例很低。

**根因**：audit_logs 的 payload 字段存储了大量 JSON 数据（平均 5KB/条），这些数据被存储在 TOAST 表中。主表的 VACUUM 虽然清理了主表的死元组，但由于 TOAST 表的 VACUUM 参数没有独立设置，它的清理频率远远不够。

```sql
-- 检查 TOAST 表的膨胀情况
SELECT
    c.relname AS main_table,
    t.relname AS toast_table,
    pg_size_pretty(pg_relation_size(c.oid)) AS main_size,
    pg_size_pretty(pg_relation_size(t.oid)) AS toast_size,
    s.n_dead_tup AS toast_dead_tuples,
    s.last_autovacuum AS toast_last_vacuum
FROM pg_class c
JOIN pg_class t ON t.oid = c.reltoastrelid
LEFT JOIN pg_stat_user_tables s ON s.relid = t.oid
WHERE c.relname IN ('audit_logs', 'orders', 'payments');

-- 确保 TOAST 表也继承激进的 VACUUM 参数
ALTER TABLE audit_logs SET (
    autovacuum_vacuum_scale_factor = 0.01,
    toast.autovacuum_vacuum_scale_factor = 0.01,
    toast.autovacuum_vacuum_threshold = 1000
);
```

### 案例四：事务 ID 回卷预警处理

**现象**：收到告警 `WARNING: database "mydb" must be vacuumed within 177009857 transactions`，距离强制停机还剩约 1.77 亿次事务。

```sql
-- 检查所有数据库的事务 ID 年龄
SELECT
    datname,
    age(datfrozenxid) AS xid_age,
    2^31 - age(datfrozenxid) AS remaining,
    ROUND(age(datfrozenxid)::numeric / 2^31 * 100, 2) AS pct
FROM pg_database
ORDER BY xid_age DESC;

-- 检查哪些表的 relfrozenxid 最老
SELECT
    relname,
    age(relfrozenxid) AS xid_age,
    pg_size_pretty(pg_relation_size(oid)) AS table_size
FROM pg_class
WHERE relkind = 'r'
ORDER BY xid_age DESC
LIMIT 10;

-- 紧急执行 VACUUM FREEZE
VACUUM FREEZE orders;
```

**预防配置**：

```ini
# 更积极地执行 VACUUM FREEZE，防止事务 ID 回卷
autovacuum_freeze_max_age = 200000000     # 2 亿
vacuum_freeze_min_age = 50000000          # 5000 万
vacuum_freeze_table_age = 150000000       # 1.5 亿
```

---

## 最佳实践速查清单

根据多年的生产运维经验，以下是 PostgreSQL Vacuum 管理的要点清单：

1. **绝不关闭 autovacuum**：即使你打算完全手动管理 VACUUM，也请保留 autovacuum 作为安全网。关闭 autovacuum 等同于埋下定时炸弹。
2. **高写入表必须单独配置参数**：全局默认参数适用于小规模低写入系统，但你的 orders、payments 等热点表需要更激进的 VACUUM 策略。
3. **密切关注长事务**：长事务是 autovacuum 效果的最大杀手。设置 `idle_in_transaction_session_timeout` 是最简单有效的预防手段。
4. **建立膨胀监控体系**：至少每周检查一次各表的膨胀率，关键表每天检查。使用 Grafana + Prometheus 持续监控。
5. **优先使用 pg_repack**：在生产环境中，pg_repack 是空间回收的首选工具，它不会阻塞业务。
6. **对时序数据使用分区表**：分区表可以通过 DROP PARTITION 替代 DELETE，从根本上避免死元组积累。
7. **合理配置 maintenance_work_mem**：VACUUM 和 REINDEX 的内部操作需要足够的内存，建议设置为 512MB-2GB。
8. **关注 TOAST 表的 VACUUM 状态**：对于包含大字段的表，TOAST 表可能是隐性的膨胀源。
9. **定期清理未使用的索引**：每个多余的索引都会在每次 INSERT/UPDATE/DELETE 时产生额外的写放大。
10. **在低峰期执行维护任务**：虽然 pg_repack 不锁表，但会增加系统 I/O 负载，建议在业务低谷期执行。

---

## 总结

PostgreSQL 的 Vacuum 机制是 MVCC 架构的核心组成部分，而不是一个可有可无的"优化项"。在高写入的 Laravel 应用中，忽视 Vacuum 管理的后果往往是渐进式的——从查询性能缓慢退化，到磁盘空间告警，再到事务 ID 回卷引发的紧急停机，每一步都在悄然发生，等你察觉时往往已经错过最佳处理时机。

掌握 Vacuum 调优的核心在于理解四个层面的内容：**原理层面**要理解 MVCC 如何产生死元组以及 VACUUM 如何回收空间；**参数层面**要知道全局默认参数的局限性以及如何针对每张表精细配置；**工具层面**要熟悉 pgstattuple 的诊断能力、pg_repack 的在线整理能力以及 REINDEX CONCURRENTLY 的索引重建能力；**监控层面**要建立完整的告警体系，在问题积累到严重程度之前就收到预警。

将数据库的 Vacuum 维护纳入日常运维流程，像对待代码质量和系统安全一样对待数据库的健康度，这才是生产环境长期稳定运行的基石。

---

## 相关阅读

- [pg_stat_statements 实战：MySQL Performance Schema 与 PostgreSQL 慢查询监控对比](/categories/MySQL/2026-06-05-pg-stat-statements-MySQL-Performance-Schema-慢查询监控实战/) — 深入了解如何使用 pg_stat_statements 和 Performance Schema 监控慢查询，是 Vacuum 调优的重要配套手段。
- [PostgreSQL pg-cron 与 pg-partman：数据库内定时任务与自动分区管理](/categories/MySQL/2026-06-06-PostgreSQL-pg-cron-pg-partman-数据库内定时任务与自动分区管理/) — 通过 pg-cron 实现 Vacuum 监控任务的自动化调度，结合 pg-partman 管理时序分区表，从根源减少死元组积累。
- [PostgreSQL Logical Replication 实战：零停机数据迁移与实时数据同步](/categories/MySQL/PostgreSQL-Logical-Replication-实战-零停机数据迁移与实时数据同步/) — 在 Logical Replication 环境中，Vacuum 策略需要额外关注 catalog 表的事务 ID 年龄，本文提供了完整的调优方案。

---

*如果这篇文章对你有帮助，欢迎点赞收藏。后续我将继续分享 PostgreSQL 性能优化系列内容，包括查询计划深度分析、连接池配置与监控、读写分离架构设计等主题。*
