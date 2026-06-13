---
title: pg_stat_statements + MySQL Performance Schema 实战：数据库慢查询的生产级监控——从 EXPLAIN 到等待事件的根因分析
date: 2026-06-05 12:00:00
tags: [MySQL, PostgreSQL, Performance Schema, pg_stat_statements, 慢查询, 性能监控]
keywords: [pg, stat, statements, MySQL Performance Schema, EXPLAIN, 数据库慢查询的生产级监控, 到等待事件的根因分析, 数据库]
description: 生产环境慢查询监控实战指南，深入对比 PostgreSQL pg_stat_statements 与 MySQL Performance Schema 两大工具的架构原理、统计维度与开销差异。覆盖 Top SQL 统计、等待事件根因分析、Laravel DB::listen() 集成、Prometheus+Grafana 可视化告警、EXPLAIN 实战解读，以及 5 个真实踩坑案例与选型决策矩阵，帮助后端与 DBA 团队建立从发现到修复的闭环监控体系。
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---


# pg_stat_statements + MySQL Performance Schema 实战：数据库慢查询的生产级监控——从 EXPLAIN 到等待事件的根因分析

## 一、为什么需要生产级慢查询监控

在开发环境里，一条慢 SQL 的排查路径通常是这样的：拿到 SQL → 跑 `EXPLAIN` → 看执行计划 → 发现缺索引 → 加索引 → 验证通过 → 提交代码 → 完事。这套流程在开发阶段完全没有问题，一个人对着一条已知的 SQL 做分析，简单直接。

但到了生产环境，事情变得完全不一样。你面对的不是一条已知的 SQL，而是成百上千条不同的 SQL 在并发执行。你不知道哪条 SQL 有问题，你不知道问题什么时候出现，你甚至不知道问题是否真的存在。很多生产性能问题的表象是"用户反馈页面卡"，而不是"某条 SQL 慢"。你需要一套系统化的监控方案来主动发现问题，而不是被动地等用户投诉。

具体来说，开发环境的 EXPLAIN 在生产场景下有以下致命不足：

**第一，你拿不到"那条 SQL"。** 线上慢查询是概率性出现的，它受到并发量、缓存命中率、锁等待状态、IO 调度延迟、数据库连接池饱和度等多种因素的综合影响。一条 SQL 在开发环境跑 10ms，到了生产环境在特定并发下可能跑到 2 秒。你没法随时复现它，你需要的是**持续采集和统计**的能力。

**第二，EXPLAIN 只是静态执行计划。** `EXPLAIN` 告诉你优化器"打算怎么做"——它会选择哪个索引、估算扫描多少行、是否用临时表和文件排序。但 `EXPLAIN` 不告诉你实际执行了多久、实际读了多少个数据块、实际等了多久的锁。PostgreSQL 的 `EXPLAIN ANALYZE` 能看到实际执行时间，但它是单次采样，不具备统计意义。

**第三，单条 SQL 的"慢"和"影响面"是两回事。** 一条平均耗时 200ms 的 SQL，每天被调用 10 万次，累计耗时 20000 秒。另一条报表 SQL，偶尔跑 5 秒，每天只调用 3 次，累计耗时 15 秒。如果你只看单次执行时间，你会先优化那条 5 秒的报表 SQL，但这显然是错误的优先级。你需要的是**统计视角**——按累计耗时排序，找到真正影响系统的瓶颈。

**第四，SQL 慢的原因不只是缺索引。** 生产环境中慢查询的根因可能是：表锁等待（DDL 操作或显式 LOCK TABLE）、行锁等待（高并发下的热点行更新）、IO 瓶颈（数据量超出 shared_buffers/innodb_buffer_pool）、临时表溢出（GROUP BY 的结果集过大无法在内存中完成）、排序溢出（ORDER BY + LIMIT 的场景）等等。单纯看执行计划无法区分这些原因，你需要**等待事件分析**。

生产级慢查询监控的核心需求可以概括为四个维度：

- **统计聚合**：哪些 SQL 被调用最多？哪些 SQL 累计耗时最长？趋势是在变好还是在变差？
- **等待事件**：SQL 慢是因为 CPU 计算、磁盘 IO、还是锁等待？根因在哪里？
- **上下文关联**：这条慢 SQL 来自哪个业务模块？哪个 HTTP 接口？哪个用户触发的？
- **长期可观测**：能够按天/周/月对比，发现性能退化趋势，在问题扩大前预警。

PostgreSQL 的 `pg_stat_statements` 和 MySQL 的 `Performance Schema` 分别是两个数据库阵营在统计维度和等待事件维度的官方解决方案。本文将深入两者的实战配置、排查流程、Laravel 集成方案和生产踩坑经验。

---

## 二、pg_stat_statements 深度实战（PostgreSQL 侧）

### 2.1 安装与启用

`pg_stat_statements` 是 PostgreSQL 官方维护的 contrib 扩展，虽然随源码一起分发，但需要手动配置才能启用。整个过程分三步：

```ini
# postgresql.conf 配置（修改后需要重启 PostgreSQL）

# 1. 在共享库预加载列表中添加 pg_stat_statements
shared_preload_libraries = 'pg_stat_statements'

# 2. 跟踪的 SQL 语句最大数量（预分配内存，建议 5000~10000）
pg_stat_statements.max = 10000

# 3. 跟踪级别：top = 只跟踪顶层 SQL，all = 包括函数内部的 SQL
pg_stat_statements.track = top

# 4. 是否跟踪非 DML 语句（CREATE INDEX, VACUUM, ALTER TABLE 等）
pg_stat_statements.track_utility = on

# 5. 是否跟踪 IO 时间（强烈建议开启）
pg_stat_statements.track_io_timing = on

# 6. 全局 IO 计时开关（pg_stat_statements 的 IO 时间依赖此参数）
track_io_timing = on
```

修改配置后重启 PostgreSQL，然后在目标数据库中创建扩展：

```sql
-- 每个需要监控的数据库都要单独创建
CREATE EXTENSION pg_stat_statements;

-- 验证安装
SELECT * FROM pg_stat_statements LIMIT 1;
```

**踩坑提醒**：`shared_preload_libraries` 修改后**必须重启 PostgreSQL**，不能用 `pg_ctl reload` 或 `SELECT pg_reload_conf()`。很多 DBA 第一次配置时用 reload 发现不生效，反复检查配置文件格式，排查半小时才发现需要重启。另外 `pg_stat_statements.max = 10000` 大约需要预分配 15~25MB 的 shared memory，如果你的服务器 `shared_buffers` 已经设得很大，需要确保两者之和不超过操作系统共享内存限制（Linux 下看 `shmmax` 和 `shmall` 参数）。

### 2.2 核心字段解析

启用后，通过 `pg_stat_statements` 视图可以查询所有被跟踪的 SQL 统计数据：

```sql
SELECT
    queryid,                                -- SQL 指纹的哈希值
    query,                                  -- 归一化后的 SQL 文本
    calls,                                  -- 调用次数
    total_exec_time / 1000 AS total_sec,    -- 累计执行时间（秒）
    mean_exec_time / 1000 AS mean_ms,       -- 平均执行时间（毫秒）
    max_exec_time / 1000 AS max_ms,         -- 最大单次执行时间（毫秒）
    min_exec_time / 1000 AS min_ms,         -- 最小单次执行时间（毫秒）
    stddev_exec_time / 1000 AS stddev_ms,   -- 执行时间标准差（毫秒）
    rows,                                   -- 返回/影响的总行数
    shared_blks_hit,                        -- 共享缓存命中次数
    shared_blks_read,                       -- 从磁盘读取的块数
    shared_blks_written,                    -- 写入磁盘的块数
    local_blks_hit,                         -- 本地缓存命中
    local_blks_read,                        -- 本地缓存磁盘读取
    temp_blks_read,                         -- 临时文件读取块数
    temp_blks_written,                      -- 临时文件写入块数
    blk_read_time,                          -- 磁盘读取总耗时（毫秒）
    blk_write_time,                         -- 磁盘写入总耗时（毫秒）
    wal_records,                            -- WAL 记录数
    wal_bytes,                              -- WAL 字节数
    plans,                                  -- 执行计划缓存次数
    total_plan_time,                        -- 计划生成总耗时
    -- 缓存命中率
    CASE
        WHEN shared_blks_hit + shared_blks_read = 0 THEN 0
        ELSE round(100.0 * shared_blks_hit / (shared_blks_hit + shared_blks_read), 2)
    END AS cache_hit_ratio
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

**关键指标的排查逻辑**：

| 指标组合 | 含义 | 排查方向 |
|----------|------|----------|
| `calls` 极高，`mean_time` 不高 | 高频低耗 SQL | 可能是热点查询，考虑应用层缓存或批量合并 |
| `calls` 不高，`mean_time` 极高 | 低频高耗 SQL | EXPLAIN ANALYZE 详细分析，关注执行计划 |
| `calls` 和 `mean_time` 都高 | 高频高耗 SQL | 最高优先级优化 |
| `shared_blks_read` >> `shared_blks_hit` | 缓存命中率低 | 增大 shared_buffers，或检查是否走了全表扫描 |
| `temp_blks_written` > 0 | 使用了临时文件 | GROUP BY / ORDER BY / Hash Join 溢出到磁盘 |
| `blk_read_time` 高 | 磁盘 IO 瓶颈 | 检查存储性能，考虑索引覆盖减少 IO |
| `stddev_exec_time` 很大 | 执行时间波动大 | 可能受锁等待或并发影响，需要结合等待事件分析 |

### 2.3 Top N 慢查询排查流程

实战中推荐的排查流程是：**先按累计耗时找 Top N，再逐条深入分析**。

```sql
-- Step 1: 找到累计耗时 Top 20 的 SQL（过滤掉调用次数太少的噪音）
SELECT
    queryid,
    calls,
    round(total_exec_time / 1000, 2) AS total_sec,
    round(mean_exec_time, 2) AS mean_ms,
    round(max_exec_time, 2) AS max_ms,
    round(stddev_exec_time, 2) AS stddev_ms,
    rows,
    CASE WHEN rows > 0 THEN round(total_exec_time / rows, 3) ELSE 0 END AS time_per_row_ms,
    CASE
        WHEN shared_blks_hit + shared_blks_read = 0 THEN 0
        ELSE round(100.0 * shared_blks_hit / (shared_blks_hit + shared_blks_read), 2)
    END AS cache_hit_pct,
    temp_blks_written,
    query
FROM pg_stat_statements
WHERE calls > 10                     -- 过滤只出现 1-2 次的 SQL
ORDER BY total_exec_time DESC
LIMIT 20;
```

```sql
-- Step 2: 拿到 queryid 后，用 EXPLAIN ANALYZE 获取实际执行计划
-- 注意：pg_stat_statements 中的 query 是参数归一化的（$1, $2...），
-- 你需要从应用代码或日志中还原实际参数值再执行 EXPLAIN

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE user_id = 12345 AND status = 'pending';
```

```sql
-- Step 3: 关注 EXPLAIN ANALYZE 输出中的关键信息
-- - actual time：每个节点的实际执行时间
-- - rows：实际扫描行数 vs 预估行数（差异大说明统计信息过时）
-- - Buffers: shared hit / read：缓存命中情况
-- - Sort Method: external merge / quicksort：排序是否溢出到磁盘
-- - Hash buckets / batches：Hash Join 是否需要多批次
```

### 2.4 与 EXPLAIN ANALYZE 联动的安全实践

`EXPLAIN ANALYZE` 会**真正执行 SQL**。对于 SELECT 查询，这通常没问题，但对于写操作（INSERT/UPDATE/DELETE）必须特别小心：

```sql
-- 安全做法 1：用 EXPLAIN（不含 ANALYZE）只看计划，不实际执行
EXPLAIN (BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE user_id = 12345;

-- 安全做法 2：对写操作用事务回滚包裹
BEGIN;
EXPLAIN ANALYZE UPDATE orders SET status = 'completed' WHERE id = 999;
ROLLBACK;  -- 回滚，不会真正修改数据

-- 安全做法 3：对大表查询用 LIMIT 限制扫描范围
BEGIN;
EXPLAIN ANALYZE SELECT * FROM orders WHERE created_at > '2026-01-01' LIMIT 100;
ROLLBACK;
```

### 2.5 pg_stat_statements.reset() 与定期快照

`pg_stat_statements` 的数据是累计值，从实例启动或上次 reset 开始累积。重启 PostgreSQL 或手动 reset 后会清零：

```sql
-- 手动清零（全局操作，影响所有数据库的统计）
SELECT pg_stat_statements_reset();
```

生产环境推荐的做法是**定期采集快照到历史表**，通过差值分析发现趋势变化：

```sql
-- 创建历史表
CREATE TABLE pg_stat_statements_history (
    snapshot_time   TIMESTAMPTZ DEFAULT now(),
    queryid         BIGINT,
    calls           BIGINT,
    total_exec_time DOUBLE PRECISION,
    mean_exec_time  DOUBLE PRECISION,
    max_exec_time   DOUBLE PRECISION,
    rows            BIGINT,
    shared_blks_hit BIGINT,
    shared_blks_read BIGINT,
    temp_blks_written BIGINT,
    query           TEXT
);

-- 用 pg_cron 每小时执行一次快照采集
SELECT cron.schedule(
    'capture-pgss',
    '0 * * * *',  -- 每小时整点
    $$INSERT INTO pg_stat_statements_history
        (queryid, calls, total_exec_time, mean_exec_time,
         max_exec_time, rows, shared_blks_hit, shared_blks_read,
         temp_blks_written, query)
      SELECT queryid, calls, total_exec_time, mean_exec_time,
             max_exec_time, rows, shared_blks_hit, shared_blks_read,
             temp_blks_written, query
      FROM pg_stat_statements$$
);

-- 采集完后 reset，下次采集的就是增量数据
-- 注意：reset 的时机很关键，必须在快照采集之后
SELECT cron.schedule(
    'reset-pgss',
    '5 * * * *',  -- 每小时 5 分钟（确保采集已完成）
    'SELECT pg_stat_statements_reset()'
);
```

通过比较相邻快照的差值，可以精确分析"这一个小时"内哪些 SQL 的调用次数增加了、哪些 SQL 的平均耗时退化了。这种增量分析在容量规划和性能趋势监控中非常有价值。

---

## 三、MySQL Performance Schema 深度实战

### 3.1 开启配置

MySQL 5.7 及以上版本默认编译了 Performance Schema，但默认只开启了部分 instruments。要在生产环境发挥最大作用，需要在 `my.cnf` 中进行适当配置：

```ini
[mysqld]
# 开启 Performance Schema（MySQL 5.7+ 默认 ON，显式配置更明确）
performance_schema = ON

# SQL 文本和 digest 的最大长度
# 超过此长度的 SQL 会被截断，可能导致不同 SQL 被错误合并
performance_schema_max_sql_text_length = 2048
performance_schema_max_digest_length = 4096

# 短期历史记录大小（每个线程保留最近 N 条语句）
performance_schema_events_statements_history_size = 100

# 长期历史记录大小（全局最近 N 条语句）
performance_schema_events_statements_history_long_size = 10000

# 等待事件历史记录大小
performance_schema_events_waits_history_size = 100
performance_schema_events_waits_history_long_size = 10000

# 内存分配控制
performance_schema_max_table_instances = 500
performance_schema_accounts_size = 200
performance_schema_hosts_size = 200
performance_schema_users_size = 200
```

**重要提醒**：`performance_schema`、`performance_schema_max_digest_length` 等参数修改后需要**重启 MySQL**，无法在线修改。而下面介绍的 `setup_instruments` 和 `setup_consumers` 可以在线动态调整，不需要重启。建议首次配置时把内存相关的参数一次性配好。

### 3.2 events_statements_summary_by_digest 核心表

这是 MySQL 侧相当于 `pg_stat_statements` 的核心统计表。它按 SQL 指纹（digest）聚合所有执行记录：

```sql
-- 查看累计耗时 Top 20 的 SQL 指纹
SELECT
    DIGEST_TEXT,
    COUNT_STAR                 AS calls,
    ROUND(SUM_TIMER_WAIT / 1e12, 2)   AS total_sec,
    ROUND(AVG_TIMER_WAIT / 1e9, 2)    AS avg_ms,
    ROUND(MAX_TIMER_WAIT / 1e9, 2)    AS max_ms,
    ROUND(STDDEV_TIMER_WAIT / 1e9, 2) AS stddev_ms,
    SUM_ROWS_EXAMINED          AS total_rows_examined,
    SUM_ROWS_SENT              AS total_rows_sent,
    SUM_ROWS_AFFECTED          AS total_rows_affected,
    SUM_NO_INDEX_USED          AS no_index_count,
    SUM_NO_GOOD_INDEX_USED     AS no_good_index_count,
    ROUND(SUM_CREATED_TMP_TABLES / COUNT_STAR, 2)    AS avg_tmp_tables,
    ROUND(SUM_CREATED_TMP_DISK_TABLES / COUNT_STAR, 2) AS avg_tmp_disk_tables,
    ROUND(SUM_SORT_ROWS / COUNT_STAR, 2)              AS avg_sort_rows,
    ROUND(SUM_SORT_MERGE_PASSES / COUNT_STAR, 2)      AS avg_sort_merge_passes,
    FIRST_SEEN,
    LAST_SEEN
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = 'your_database'
  AND COUNT_STAR > 10
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

**关键字段解读**：

- `DIGEST_TEXT`：SQL 指纹，参数被 `?` 占位。这是数据库侧识别"同一类 SQL"的唯一标识。
- `SUM_NO_INDEX_USED`：SQL 执行时完全没有使用索引的次数。这个值 > 0 的 SQL 必须重点关注。
- `SUM_NO_GOOD_INDEX_USED`：使用了索引但优化器认为不是最优索引的次数。通常是索引选择性不够高。
- `SUM_ROWS_EXAMINED` vs `SUM_ROWS_SENT`：扫描行数 vs 返回行数。比值过大（比如扫描 100 万行返回 10 行）说明索引效率极低，需要覆盖索引或改写查询。
- `SUM_CREATED_TMP_DISK_TABLES`：使用磁盘临时表的次数。GROUP BY 的结果集过大无法在内存完成时会写磁盘，严重影响性能。
- `SUM_SORT_MERGE_PASSES`：排序合并传递次数。> 0 说明排序缓冲区不足，数据溢出到磁盘后做了多路归并。

### 3.3 从 digest 到原始 SQL 的还原

Performance Schema 中的 `DIGEST_TEXT` 是参数归一化后的 SQL（参数被替换为 `?`），你不能直接复制执行。需要从历史记录中还原实际参数值：

```sql
-- 方法 1：从 events_statements_history 中取最近的原始 SQL
SELECT
    THREAD_ID,
    SQL_TEXT,
    TIMER_WAIT / 1e9 AS exec_ms,
    ROWS_EXAMINED,
    ROWS_SENT,
    CREATED_TMP_TABLES,
    CREATED_TMP_DISK_TABLES,
    SORT_ROWS,
    LOCK_TIME / 1e9 AS lock_ms,
    CURRENT_SCHEMA
FROM performance_schema.events_statements_history
WHERE DIGEST = '你从上面查到的digest值'
ORDER BY TIMER_WAIT DESC
LIMIT 5;
```

```sql
-- 方法 2：开启慢查询日志做长期记录
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;                      -- 超过 1 秒记录
SET GLOBAL log_queries_not_using_indexes = ON;       -- 记录未使用索引的查询
SET GLOBAL min_examined_row_limit = 1000;            -- 扫描超过 1000 行的才记录
SET GLOBAL log_slow_extra = ON;                      -- 记录额外信息（MySQL 8.0+）
```

```sql
-- 方法 3：通过 processlist 或 innodb_trx 实时抓取正在执行的慢 SQL
SELECT
    p.ID,
    p.USER,
    p.HOST,
    p.DB,
    p.COMMAND,
    p.TIME AS running_seconds,
    p.STATE,
    p.INFO AS current_sql,
    t.trx_state,
    t.trx_started,
    t.trx_rows_locked,
    t.trx_rows_modified
FROM information_schema.processlist p
LEFT JOIN information_schema.innodb_trx t ON p.ID = t.trx_mysql_thread_id
WHERE p.COMMAND != 'Sleep'
  AND p.TIME > 5
ORDER BY p.TIME DESC;
```

### 3.4 等待事件分析

等待事件分析是 Performance Schema 相比 `pg_stat_statements` 的最大优势。它能告诉你 SQL 慢的**根因**：是 CPU 计算慢、磁盘 IO 慢、还是在等锁。

```sql
-- 查看全局等待事件 Top 20（按总耗时排序）
SELECT
    EVENT_NAME,
    COUNT_STAR,
    ROUND(SUM_TIMER_WAIT / 1e12, 2) AS total_sec,
    ROUND(AVG_TIMER_WAIT / 1e9, 2) AS avg_ms,
    ROUND(MAX_TIMER_WAIT / 1e9, 2) AS max_ms
FROM performance_schema.events_waits_summary_global_by_event_name
WHERE COUNT_STAR > 0
  AND EVENT_NAME NOT LIKE 'idle'
  AND EVENT_NAME NOT LIKE 'thread/%'
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

**IO 等待分析**——找出哪些数据文件的 IO 等待最严重：

```sql
SELECT
    FILE_NAME,
    EVENT_NAME,
    COUNT_STAR,
    ROUND(SUM_TIMER_WAIT / 1e12, 2) AS total_sec,
    SUM_NUMBER_OF_BYTES_READ AS bytes_read,
    SUM_NUMBER_OF_BYTES_WRITE AS bytes_write
FROM performance_schema.file_summary_by_instance
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 15;
```

**表级 IO 等待分析**——找出哪些表的 IO 开销最大：

```sql
SELECT
    OBJECT_SCHEMA,
    OBJECT_NAME,
    COUNT_READ,
    COUNT_WRITE,
    COUNT_FETCH,
    ROUND(SUM_TIMER_READ / 1e12, 2) AS read_sec,
    ROUND(SUM_TIMER_WRITE / 1e12, 2) AS write_sec,
    SUM_NUMBER_OF_BYTES_READ AS bytes_read
FROM performance_schema.table_io_waits_summary_by_table
WHERE OBJECT_SCHEMA = 'your_database'
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 15;
```

**锁等待分析**——找出谁在等谁的锁：

```sql
-- MySQL 8.0.1+ 使用 data_locks / data_lock_waits（替代旧的 innodb_locks / innodb_lock_waits）
SELECT
    r.trx_id              AS waiting_trx_id,
    r.trx_mysql_thread_id AS waiting_thread_id,
    r.trx_query           AS waiting_query,
    r.trx_started         AS waiting_trx_started,
    b.trx_id              AS blocking_trx_id,
    b.trx_mysql_thread_id AS blocking_thread_id,
    b.trx_query           AS blocking_query,
    b.trx_started         AS blocking_trx_started
FROM performance_schema.data_lock_waits w
JOIN information_schema.innodb_trx r
    ON w.REQUESTING_ENGINE_TRANSACTION_ID = r.trx_id
JOIN information_schema.innodb_trx b
    ON w.BLOCKING_ENGINE_TRANSACTION_ID = b.trx_id;

-- 查看当前所有行锁的详细信息
SELECT
    ENGINE_TRANSACTION_ID,
    OBJECT_SCHEMA,
    OBJECT_NAME,
    INDEX_NAME,
    LOCK_TYPE,
    LOCK_MODE,
    LOCK_STATUS,
    LOCK_DATA
FROM performance_schema.data_locks
WHERE OBJECT_SCHEMA = 'your_database'
ORDER BY ENGINE_TRANSACTION_ID;
```

### 3.5 setup_consumers 与 setup_instruments 配置

Performance Schema 采用**两层控制**架构：`setup_instruments`（采集什么数据）和 `setup_consumers`（存储到哪个表）。

```sql
-- 查看当前所有 consumers 的启用状态
SELECT * FROM performance_schema.setup_consumers;

-- 开启关键 consumers
UPDATE performance_schema.setup_consumers SET ENABLED = 'YES'
WHERE NAME IN (
    'events_statements_current',
    'events_statements_history',
    'events_statements_history_long',
    'events_waits_current',
    'events_waits_history',
    'events_waits_history_long',
    'global_instrumentation',
    'thread_instrumentation',
    'statements_digest'
);

-- 查看 statement 相关的 instruments
SELECT NAME, ENABLED, TIMED
FROM performance_schema.setup_instruments
WHERE NAME LIKE 'statement/%';

-- 开启需要的等待事件 instruments
UPDATE performance_schema.setup_instruments
SET ENABLED = 'YES', TIMED = 'YES'
WHERE NAME LIKE 'wait/io/file/innodb/%';

UPDATE performance_schema.setup_instruments
SET ENABLED = 'YES', TIMED = 'YES'
WHERE NAME LIKE 'wait/lock/table/%';

UPDATE performance_schema.setup_instruments
SET ENABLED = 'YES', TIMED = 'YES'
WHERE NAME LIKE 'wait/synch/mutex/innodb/%';

-- 关闭不需要的 instruments 减少开销
-- 例如关闭一些内部互斥锁的监控（除非你正在排查特定的锁竞争问题）
UPDATE performance_schema.setup_instruments
SET ENABLED = 'NO', TIMED = 'NO'
WHERE NAME LIKE 'wait/synch/mutex/sql/%'
  AND NAME NOT LIKE '%LOCK%';
```

**注意**：通过 `UPDATE` 修改的 instruments 配置在 MySQL 重启后会丢失。要永久生效，需要在 MySQL 8.0+ 中配合 `my.cnf` 的 `performance-schema-instrument` 参数：

```ini
[mysqld]
performance-schema-instrument = 'wait/io/file/innodb/%=ON'
performance-schema-instrument = 'wait/lock/table/%=ON'
performance-schema-instrument = 'wait/synch/mutex/innodb/%=ON'
performance-schema-instrument = 'wait/synch/mutex/sql/%=OFF'
```

---

## 四、设计哲学对比：pg_stat_statements vs Performance Schema

| 维度 | pg_stat_statements | Performance Schema |
|------|-------------------|--------------------|
| **设计定位** | 轻量级 SQL 统计扩展，专注一件事 | 全方位性能观测框架，覆盖 SQL / IO / 锁 / 内存 |
| **安装方式** | 需要手动 `CREATE EXTENSION` | MySQL 5.7+ 内置，开箱即用 |
| **统计粒度** | 按 SQL 指纹聚合 | 按 digest + 文件 + 表 + 锁 + 内存多维度交叉 |
| **等待事件** | 不支持（需配合 pg_wait_sampling 等第三方扩展） | 原生支持 IO / 锁 / 内存 / 网络等待事件 |
| **性能开销** | 极低（通常 < 2%），几乎可以忽略 | 可高可低，全量开启可达 15%，精简配置 1~3% |
| **配置复杂度** | 低（改 postgresql.conf + 1 条 SQL） | 高（instruments + consumers 双层控制，参数众多） |
| **数据持久性** | 纯内存，重启丢失（需要自己做快照归档） | 纯内存，重启丢失（MySQL 8.0 有可选持久化） |
| **百分位统计** | 不支持（需要自行计算） | MySQL 8.0 原生支持 P95/P99（quantile 字段） |
| **社区生态** | pgBadger, pgwatch2, pg_stat_monitor | PMM (Percona), MySQL Enterprise Monitor, VividCortex |

**总结一句话**：`pg_stat_statements` 是一把精致的瑞士军刀，开箱即用，开销极低；`Performance Schema` 是一个功能完备的工具箱，功能强大但需要花时间学习配置。PostgreSQL 要达到 Performance Schema 的深度，需要组合 `pg_stat_statements` + `pg_wait_sampling` + `pg_stat_activity` + `pg_stat_io` + `pg_stat_bgwriter` 等多个扩展。

---

## 五、Laravel 项目集成

在实际的 Web 项目中，数据库层面的监控数据需要和应用层关联，才能快速定位到"是哪个业务接口触发了这条慢 SQL"。

### 5.1 Laravel DB::listen() + 慢查询日志

Laravel 提供了 `DB::listen()` 回调，可以在应用层拦截每一条执行的 SQL：

```php
<?php
// app/Providers/AppServiceProvider.php

namespace App\Providers;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 记录慢查询到独立日志通道
        DB::listen(function ($query) {
            $timeMs = $query->time;

            if ($timeMs > 500) { // 超过 500ms 的查询
                Log::channel('slow-query')->warning('Slow query detected', [
                    'sql'        => $query->sql,
                    'bindings'   => $query->bindings,
                    'time_ms'    => $timeMs,
                    'connection' => $query->connectionName,
                    'route'      => request()->route()?->getName(),
                    'url'        => request()->fullUrl(),
                    'method'     => request()->method(),
                    'user_id'    => auth()->id(),
                    'ip'         => request()->ip(),
                    'user_agent' => request()->userAgent(),
                ]);
            }
        });

        // 也可以记录所有 SQL 到 Debugbar（仅开发环境）
        if (app()->environment('local')) {
            DB::listen(function ($query) {
                logger()->debug('SQL', [
                    'sql'     => $query->sql,
                    'bindings'=> $query->bindings,
                    'time_ms' => $query->time,
                ]);
            });
        }
    }
}
```

配置独立的日志通道，避免慢查询日志和应用日志混在一起：

```php
<?php
// config/logging.php
return [
    'channels' => [
        // ... 其他通道

        'slow-query' => [
            'driver' => 'daily',
            'path'   => storage_path('logs/slow-query.log'),
            'days'   => 30,        // 保留 30 天
            'level'  => 'warning',
            'permission' => 0644,
        ],
    ],
];
```

**注意开销**：`DB::listen()` 会对每一条 SQL 触发回调，在高并发场景下（比如每秒数千条 SQL）回调本身也会成为性能瓶颈。生产环境建议只在超过阈值时才写日志，不要记录所有 SQL。

### 5.2 记录查询上下文

光知道 SQL 不够，你还需要知道这条 SQL 是在哪个业务场景下触发的。可以在请求生命周期的早期设置上下文标记：

```php
<?php
// app/Http/Middleware/QueryContext.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class QueryContext
{
    public function handle(Request $request, Closure $next)
    {
        // 在请求开始时设置 MySQL 会话变量，标记请求来源
        $routeName = $request->route()?->getName() ?? $request->path();
        $requestId = $request->header('X-Request-Id', uniqid('req_', true));

        DB::statement("SET @app_route = ?", [$routeName]);
        DB::statement("SET @app_request_id = ?", [$requestId]);

        return $next($request);
    }
}
```

注册到 `app/Http/Kernel.php` 的全局中间件中。这样在 MySQL 的 `events_statements_history` 中，你可以通过 `@app_route` 会话变量关联到具体的业务路由。在排查线上问题时，先从 Performance Schema 找到慢 SQL 指纹，再从慢查询日志中搜索相同的 SQL 拿到 `@app_route`，就能定位到具体业务。

### 5.3 与 Grafana/Prometheus 集成可视化

搭建数据库监控可视化面板，推荐以下架构：

```
MySQL/PostgreSQL → Exporter → Prometheus → Grafana
```

```yaml
# docker-compose.yml（监控栈）
version: '3.8'
services:
  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    environment:
      DATA_SOURCE_NAME: "postgresql://monitor:password@pg-host:5432/mydb?sslmode=disable"
    ports:
      - "9187:9187"
    restart: unless-stopped

  mysql-exporter:
    image: prom/mysqld-exporter:latest
    environment:
      DATA_SOURCE_NAME: "exporter:password@(mysql-host:3306)/"
    ports:
      - "9104:9104"
    restart: unless-stopped

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    volumes:
      - grafana_data:/var/lib/grafana
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
```

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'mysql'
    static_configs:
      - targets: ['mysql-exporter:9104']

  - job_name: 'postgresql'
    static_configs:
      - targets: ['postgres-exporter:9187']
```

在 Grafana 中推荐以下 Dashboard 作为起点：

- MySQL：Dashboard ID **7362**（MySQL Overview）和 **11323**（MySQL Performance Schema）
- PostgreSQL：Dashboard ID **9628**（PostgreSQL Database）和 **14114**（PostgreSQL pg_stat_statements）

在这些基础 Dashboard 上，可以自定义告警面板。例如在 Grafana Alert 中设置：当某条 SQL 指纹的平均执行时间在过去 5 分钟内超过 1 秒时触发告警推送到钉钉/飞书。

---

## 六、生产环境最佳实践

### 6.1 开销控制

**PostgreSQL 侧**的 `pg_stat_statements` 开销通常很低，但有两个注意点：

```sql
-- 1. max 值不要设过大，10000 条约消耗 15~25MB shared memory
-- 生产环境通常够用，不需要设 100000
pg_stat_statements.max = 10000

-- 2. 不需要跟踪非 DML 语句时关闭 utility tracking
pg_stat_statements.track_utility = off
```

**MySQL 侧**的 Performance Schema 开销取决于开启的 instruments 范围：

```sql
-- 最小化配置模板：只开启 statement 统计 + 关键等待事件
-- Step 1: 关闭所有 instruments
UPDATE performance_schema.setup_instruments SET ENABLED = 'NO', TIMED = 'NO';

-- Step 2: 只开启需要的
UPDATE performance_schema.setup_instruments
SET ENABLED = 'YES', TIMED = 'YES'
WHERE NAME LIKE 'statement/%';

UPDATE performance_schema.setup_instruments
SET ENABLED = 'YES', TIMED = 'YES'
WHERE NAME LIKE 'wait/io/file/innodb/%';

UPDATE performance_schema.setup_instruments
SET ENABLED = 'YES', TIMED = 'YES'
WHERE NAME LIKE 'wait/lock/table/%';

-- Step 3: 关闭 IO 计时（如果不需要精确的 IO 时间分析）
-- 这样可以保留事件计数但减少 CPU 开销
UPDATE performance_schema.setup_instruments
SET TIMED = 'NO'
WHERE NAME LIKE 'wait/io/file/%';
```

**经验数据参考**：全量开启所有 instruments，Performance Schema 的 CPU 开销约 5%~15%。只开 statement 统计 + 关键等待事件，开销降至 1%~3%。完全关闭 Performance Schema 可以节省约 5% 的 CPU，但会失去所有可观测性。

### 6.2 定期清理与归档

```sql
-- PostgreSQL: 保留历史快照，定期清理超过 30 天的数据
DELETE FROM pg_stat_statements_history
WHERE snapshot_time < now() - interval '30 days';

-- 定期 VACUUM 历史表
VACUUM ANALYZE pg_stat_statements_history;

-- MySQL: events_statements_summary_by_digest 是累计数据
-- 定期归档后清空（MySQL 8.0.24+ 支持 TRUNCATE）
-- 归档步骤
INSERT INTO digest_stats_archive
SELECT NOW(), DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT,
       AVG_TIMER_WAIT, SUM_ROWS_EXAMINED, SUM_NO_INDEX_USED
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = 'your_database';

-- 清空（会重新开始统计）
TRUNCATE TABLE performance_schema.events_statements_summary_by_digest;

-- 也可以不清空，通过 LAST_SEEN 时间字段区分新旧数据
-- 但要注意 COUNT_STAR 和 SUM_* 是累计值，需要做差值计算
```

### 6.3 告警阈值设置

以下是经过生产验证的告警阈值参考，可以根据业务特征调整：

| 指标 | Warning 阈值 | Critical 阈值 | 说明 |
|------|-------------|---------------|------|
| 单条 SQL 平均耗时 | > 1s | > 5s | 直接影响用户响应时间 |
| 单条 SQL P99 耗时 | > 3s | > 10s | 识别长尾延迟问题 |
| 缓存命中率 | < 95% | < 80% | 低于 80% 说明 buffer 不足 |
| 未使用索引的 SQL | > 5% | > 20% | 按调用次数占比计算 |
| 锁等待平均时间 | > 100ms | > 1s | 影响并发能力 |
| 临时磁盘表占比 | > 10% | > 30% | 排序和分组操作溢出 |
| 同一 SQL 的 QPS | > 500 | > 2000 | 可能是缓存穿透或循环调用 |

告警通知建议分级：Warning 级别发到钉钉/飞书群，Critical 级别同时短信通知值班 DBA。

---

## 七、踩坑记录

### 踩坑 1：pg_stat_statements.queryid 跨版本不稳定

在 PostgreSQL 大版本升级后（如 14 → 15），同一条 SQL 的 `queryid` 会发生变化。原因是 queryid 的哈希算法在大版本之间可能调整。如果你的监控系统依赖 `queryid` 做趋势对比，升级后历史数据将无法关联。

**解决**：不要依赖 `queryid` 做跨版本的长期关联。改为使用归一化后的 SQL 文本（去除注释、标准化空格和关键字大小写后）作为关联 key。可以写一个简单的 SQL 标准化函数：

```sql
CREATE OR REPLACE FUNCTION normalize_sql(raw_sql TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN regexp_replace(
        regexp_replace(
            lower(raw_sql),
            '\s+', ' ', 'g'       -- 合并多余空白
        ),
        '--[^\n]*', '', 'g'       -- 去除行注释
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### 踩坑 2：Performance Schema 的 digest_length 截断导致 SQL 合并

默认的 `performance_schema_max_digest_length = 1024`，当 SQL 指纹超过这个长度时会被截断。问题在于，截断后不同 SQL 可能共享相同的截断前缀，导致它们被错误地合并为同一条 digest。排查时你可能发现某条 digest 的 `COUNT_STAR` 异常高，但 `DIGEST_TEXT` 看起来是一条很普通的 SQL。

```sql
-- 检查是否存在被截断的 SQL
SELECT DIGEST_TEXT, COUNT_STAR
FROM performance_schema.events_statements_summary_by_digest
WHERE DIGEST_TEXT LIKE '%...%'   -- 截断后末尾会出现省略号
ORDER BY COUNT_STAR DESC;

-- 解决：增大 digest_length（需要重启 MySQL）
-- my.cnf
-- performance_schema_max_digest_length = 4096
```

实际案例：我们曾遇到一个多表 JOIN 的复杂报表 SQL，SQL 指纹长度超过 2048 字节，被截断后与另一条相似的报表 SQL 共享同一个 digest，导致该 digest 的 `COUNT_STAR` 虚高到每天 50 万次，一度引起恐慌。

### 踩坑 3：EXPLAIN ANALYZE 在生产库的致命副作用

某次线上排查慢查询，工程师直接在生产库的 psql 客户端执行了：

```sql
EXPLAIN ANALYZE DELETE FROM sessions WHERE expired_at < now() - interval '7 days';
```

虽然是 `EXPLAIN` 语句的形式，但 `ANALYZE` 参数会**实际执行**该 DELETE 语句。该语句删除了 30 万条过期会话记录，导致大量用户被强制登出。事后复盘，工程师知道 `EXPLAIN ANALYZE` 会实际执行，但以为它对写操作会自动回滚——实际上不会。

**解决**：建立并强制执行以下规范：

```sql
-- 生产环境的 EXPLAIN 模板（必须用事务包裹）
BEGIN;
EXPLAIN (ANALYZE, BUFFERS)
DELETE FROM sessions WHERE expired_at < now() - interval '7 days';
ROLLBACK;  -- 不会真正执行 DELETE
```

同时在 CI 流水线中加入 lint 检查，禁止在代码审查和自动化脚本中出现不带 `BEGIN/ROLLBACK` 的 `EXPLAIN ANALYZE` 写操作。

### 踩坑 4：pg_stat_statements 导致 shared memory 分配失败

某次调优时将 `pg_stat_statements.max` 从 5000 调大到 100000，重启 PostgreSQL 后启动失败，日志报错：

```
FATAL: could not map shared memory segment "/PostgreSQL.1234567": Cannot allocate memory
```

排查发现 `pg_stat_statements.max = 100000` 需要预分配约 200MB+ 的 shared memory，加上 `shared_buffers = 8GB` 和 `wal_buffers` 等其他组件，总 shared memory 超过了操作系统限制。

**解决**：在 Linux 上检查并调大共享内存限制：

```bash
# 查看当前限制
cat /proc/sys/kernel/shmmax  # 单个共享内存段最大值（字节）
cat /proc/sys/kernel/shmall  # 共享内存总页数

# 临时调整
echo 17179869184 > /proc/sys/kernel/shmmax  # 16GB

# 永久调整（写入 /etc/sysctl.conf）
# kernel.shmmax = 17179869184
# kernel.shmall = 4194304
```

同时建议 `pg_stat_statements.max` 设为 10000 即可，通常能满足生产需求。

### 踩坑 5：Performance Schema 在高并发下的 mutex 竞争

在一台 128 核、QPS 超过 10 万的 MySQL 实例上，全量开启所有 instruments 后，Performance Schema 自身的 mutex 竞争反而成为了性能瓶颈。`SHOW ENGINE INNODB STATUS` 中可以看到大量 `wait/synch/mutex/innodb/` 类型的等待。

通过 `perf top` 分析发现热点在 `pfs_instr_class_inc_wait_count` 函数上，这是 Performance Schema 的内部统计函数。

**解决**：在高并发实例上，关闭最频繁触发的底层 mutex instruments，只保留业务层面有用的：

```sql
-- 关闭 InnoDB 内部的低层 mutex 监控（这些事件触发频率极高但诊断价值有限）
UPDATE performance_schema.setup_instruments
SET ENABLED = 'NO', TIMED = 'NO'
WHERE NAME LIKE 'wait/synch/mutex/innodb/trx%'
   OR NAME LIKE 'wait/synch/mutex/innodb/log%'
   OR NAME LIKE 'wait/synch/mutex/innodb/buf%'
   OR NAME LIKE 'wait/synch/mutex/innodb/fil%';

-- 只保留表锁和行锁相关（有诊断价值）
UPDATE performance_schema.setup_instruments
SET ENABLED = 'YES', TIMED = 'YES'
WHERE NAME LIKE 'wait/lock/%';
```

优化后 CPU 开销从约 12% 降到 2% 以内。

---

## 八、总结与选型建议

### 选型决策矩阵

| 场景 | 推荐方案 |
|------|----------|
| 只需要 SQL 统计，快速上线 | pg_stat_statements（PG 侧）或 Performance Schema 基础 statement 配置（MySQL 侧） |
| 需要锁等待 / IO 等待深度分析 | MySQL Performance Schema（原生支持更全面，开箱即用） |
| PostgreSQL 需要等同 Performance Schema 的深度 | pg_stat_statements + pg_wait_sampling + pg_stat_activity + pg_stat_io 组合 |
| 混合数据库环境（PG + MySQL） | 两者都启用，Prometheus + Grafana 统一可视化 |
| 对性能开销极度敏感 | pg_stat_statements（开销几乎可忽略） |
| 需要关联应用层上下文 | Laravel DB::listen() + 独立慢查询日志 + Prometheus + Grafana |
| 云数据库（RDS）| 大部分云厂商已内置慢查询分析（如 RDS Performance Insights），优先使用厂商方案 |

### 核心原则

1. **先统计，再分析。** 不要一上来就开启所有 instruments，先用 SQL 统计找到 Top N 慢查询，再有针对性地开启详细 instrumentation 做深度分析。这就像看病先做体检找异常指标，再做专项检查。

2. **关注累计影响，而非单次耗时。** 一条平均 100ms 但每天调用 100 万次的 SQL（累计 100000 秒），比一条偶尔 10s 但每天只调用 3 次的报表 SQL（累计 30 秒）更值得优化。

3. **监控是手段，不是目的。** 所有监控数据最终要落到"这个 SQL 怎么改"或"这个索引怎么加"的具体行动上。不要沉迷于搭建精美的 Grafana 面板而忘了优化 SQL。

4. **生产环境的监控本身也有成本。** 每增加一个 instrument、每多保留一条历史记录、每多触发一次回调，都是 CPU 和存储的消耗。在"观测精度"和"监控开销"之间找到适合你业务规模的平衡点。

5. **监控要形成闭环。** 发现问题 → 定位根因 → 优化 SQL/索引 → 回归验证 → 调整告警阈值。数据库慢查询监控不是一次性配置完就结束的事情，它是一个需要持续迭代的运维体系。

希望本文提供的实战经验、配置模板和踩坑记录能帮助你在生产环境中建立一套真正有效的慢查询监控体系，少走一些弯路。

## 相关阅读

- [读写分离中间件实战：ProxySQL、MaxScale 与 Laravel 透明路由](/01_MySQL/2026-06-05-读写分离中间件实战-ProxySQL-MaxScale-Laravel透明路由连接池主从延迟治理/)
- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则](/databases/index-optimization-explain/)
- [MySQL 8→9 升级指南：Invisible Index、Histogram、Hash Join、Vector Search](/01_MySQL/mysql-8-to-9-upgrade-invisible-index-histogram-hash-join-vector-search/)
