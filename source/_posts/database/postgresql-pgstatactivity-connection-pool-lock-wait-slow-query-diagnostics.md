---
title: "PostgreSQL pg_stat_activity 深度实战：连接池监控、锁等待链分析与慢查询实时追踪——生产环境的数据库诊断工具箱"
keywords: [PostgreSQL pg, stat, activity, 深度实战, 连接池监控, 锁等待链分析与慢查询实时追踪, 生产环境的数据库诊断工具箱, 数据库]
date: 2026-06-10 08:45:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - PostgreSQL
  - pg_stat_activity
  - 性能监控
  - 锁分析
  - 连接池
  - 慢查询
  - Laravel
description: "深入剖析 pg_stat_activity 视图的每一个字段，结合 Laravel 生态实现连接池监控、锁等待链递归追踪、慢查询实时告警三大生产级场景，附完整可运行代码。"
---


## 为什么 pg_stat_activity 是 DBA 的第一把手术刀

在生产环境中，数据库出问题时你最先查的系统视图是什么？不是 `pg_stat_user_tables`，不是 `pg_stat_bgwriter`，而是 `pg_stat_activity`——它是 PostgreSQL 对外暴露的「实时心电图」，能告诉你：

- 当前有多少连接在跑，谁连的，在执行什么
- 哪些查询卡在等锁，等了多久，被谁阻塞
- 哪些查询跑了超过 10 秒还在原地踏步

这篇文章不是字段罗列手册，而是直接从三个生产级场景切入，用真实可运行的 SQL 和 PHP/Laravel 代码把 `pg_stat_activity` 用到极致。

---

## 一、pg_stat_activity 核心字段速查

先建一张表，把关键字段的含义和常见用法讲清楚：

| 字段 | 类型 | 含义 | 常见用途 |
|------|------|------|---------|
| `pid` | int4 | 后端进程 PID | `pg_terminate_backend(pid)` 杀连接 |
| `datname` | text | 数据库名 | 按库分组统计连接数 |
| `usename` | text | 用户名 | 识别应用账号 vs DBA 账号 |
| `application_name` | text | 应用标识（由客户端设置） | 区分不同微服务 |
| `client_addr` | inet | 客户端 IP | 定位来源机器 |
| `client_port` | int4 | 客户端端口 | 精确到单个连接 |
| `backend_start` | timestamptz | 后端进程启动时间 | 计算连接存活时长 |
| `xact_start` | timestamptz | 当前事务开始时间 | 检测长事务 |
| `query_start` | timestamptz | 当前查询开始时间 | 检测慢查询 |
| `wait_event_type` | text | 等待事件类型 | Lock / LWLock / BufferPin |
| `wait_event` | text | 等待事件名称 | 具体锁类型 |
| `state` | text | 连接状态 | active / idle / idle in transaction |
| `backend_type` | text | 后端类型 | client backend / autovacuum / walwriter |
| `query` | text | 当前/最近的 SQL | 直接看在跑什么 |

**关键状态说明：**

- `active`：正在执行查询
- `idle`：空闲等待
- `idle in transaction`：开了事务但没执行查询——**这是生产定时炸弹**
- `idle in transaction (aborted)`：事务已出错但没提交/回滚——**更危险**

---

## 二、场景一：连接池监控与异常检测

### 2.1 基础连接统计

```sql
-- 按数据库 + 用户 + 状态 分组统计连接数
SELECT
    datname,
    usename,
    state,
    COUNT(*) AS conn_count,
    MIN(backend_start) AS oldest_connection,
    MAX(NOW() - backend_start) AS max_age
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY datname, usename, state
ORDER BY conn_count DESC;
```

### 2.2 检测空闲事务（生产定时炸弹）

空闲事务会持有快照，阻止 VACUUM 回收死元组，导致表膨胀。超过 5 分钟的空闲事务必须告警：

```sql
-- 空闲事务超过 5 分钟的连接
SELECT
    pid,
    usename,
    datname,
    application_name,
    client_addr,
    NOW() - xact_start AS idle_duration,
    NOW() - state_change AS state_duration,
    LEFT(query, 200) AS last_query,
    pg_terminate_backend(pid) -- 可选：直接杀掉
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND NOW() - xact_start > INTERVAL '5 minutes'
ORDER BY xact_start;
```

### 2.3 检测超长运行查询

```sql
-- 运行超过 60 秒的活跃查询
SELECT
    pid,
    usename,
    datname,
    application_name,
    NOW() - query_start AS query_duration,
    NOW() - xact_start AS xact_duration,
    wait_event_type,
    wait_event,
    LEFT(query, 500) AS query_text
FROM pg_stat_activity
WHERE state = 'active'
  AND backend_type = 'client backend'
  AND NOW() - query_start > INTERVAL '60 seconds'
ORDER BY query_start;
```

### 2.4 连接数上限告警

```sql
-- 当前连接数 vs 最大连接数
SELECT
    (SELECT COUNT(*) FROM pg_stat_activity WHERE backend_type = 'client backend') AS current_connections,
    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
    (SELECT setting::int FROM pg_settings WHERE name = 'superuser_reserved_connections') AS reserved,
    ROUND(
        (SELECT COUNT(*)::numeric FROM pg_stat_activity WHERE backend_type = 'client backend') /
        (SELECT setting::numeric FROM pg_settings WHERE name = 'max_connections') * 100,
        1
    ) AS usage_pct;
```

---

## 三、场景二：锁等待链递归追踪

这是 `pg_stat_activity` 最硬核的用法。当查询 A 被查询 B 阻塞，查询 B 又被查询 C 阻塞时，你需要递归地把整条等待链画出来。

### 3.1 锁等待关系基础查询

PostgreSQL 13+ 的 `pg_stat_activity` 原生提供了 `wait_event_type = 'Lock'`，但要拿到「谁阻塞了谁」，需要结合 `pg_locks`：

```sql
-- 基础锁等待：被阻塞的查询 和 阻塞它的查询
SELECT
    blocked.pid AS blocked_pid,
    blocked.usename AS blocked_user,
    blocked.datname AS blocked_db,
    LEFT(blocked.query, 200) AS blocked_query,
    NOW() - blocked.query_start AS blocked_duration,
    blocking.pid AS blocking_pid,
    blocking.usename AS blocking_user,
    LEFT(blocking.query, 200) AS blocking_query,
    NOW() - blocking.query_start AS blocking_duration,
    blocked_locks.locktype,
    blocked_locks.relation::regclass AS locked_table
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid AND NOT blocked_locks.granted
JOIN pg_locks blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
    AND blocked_locks.relation = blocking_locks.relation
    AND blocked_locks.page = blocking_locks.page
    AND blocked_locks.tuple = blocking_locks.tuple
    AND blocked_locks.transactionid = blocking_locks.transactionid
    AND blocking_locks.granted
JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
WHERE blocked.pid != blocking.pid
  AND blocked.wait_event_type = 'Lock'
ORDER BY blocked.query_start;
```

### 3.2 递归锁等待链（生产核心）

当锁链深度超过 1 层，基础查询就不够用了。用 CTE 递归：

```sql
-- 递归追踪完整锁等待链
WITH RECURSIVE lock_chain AS (
    -- 锚点：直接被阻塞且阻塞者没有被阻塞
    SELECT
        blocked.pid AS blocked_pid,
        blocking.pid AS blocking_pid,
        1 AS depth,
        ARRAY[blocked.pid, blocking.pid] AS chain,
        blocked.query AS blocked_query,
        blocking.query AS blocking_query,
        NOW() - blocked.query_start AS wait_duration
    FROM pg_stat_activity blocked
    JOIN pg_locks bl ON blocked.pid = bl.pid AND NOT bl.granted
    JOIN pg_locks gl ON bl.locktype = gl.locktype
        AND bl.relation = gl.relation
        AND bl.transactionid = gl.transactionid
        AND gl.granted
    JOIN pg_stat_activity blocking ON gl.pid = blocking.pid
    WHERE blocked.pid != blocking.pid
      AND blocked.wait_event_type = 'Lock'

    UNION ALL

    -- 递归：被阻塞者又被其他人阻塞
    SELECT
        lc.blocked_pid,
        blocking.pid AS blocking_pid,
        lc.depth + 1,
        lc.chain || blocking.pid,
        lc.blocked_query,
        blocking.query,
        lc.wait_duration
    FROM lock_chain lc
    JOIN pg_locks bl ON lc.blocking_pid = bl.pid AND NOT bl.granted
    JOIN pg_locks gl ON bl.locktype = gl.locktype
        AND bl.relation = gl.relation
        AND bl.transactionid = gl.transactionid
        AND gl.granted
    JOIN pg_stat_activity blocking ON gl.pid = blocking.pid
    WHERE blocking.pid != ALL(lc.chain)  -- 防止循环
      AND lc.depth < 10
)
SELECT
    depth,
    chain,
    blocked_pid,
    blocking_pid,
    wait_duration,
    LEFT(blocked_query, 150) AS blocked_query,
    LEFT(blocking_query, 150) AS blocking_query
FROM lock_chain
WHERE blocking_pid NOT IN (SELECT blocked_pid FROM lock_chain)
ORDER BY depth DESC, wait_duration DESC;
```

### 3.3 一键杀掉锁链源头

找到锁链最顶端的阻塞者，直接杀掉：

```sql
-- 杀掉所有锁链的根源（阻塞了别人但自己没被阻塞的进程）
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid IN (
    SELECT blocking_pid FROM (
        -- 复用上面的锁等待查询，找到最顶层的 blocking_pid
        SELECT DISTINCT blocking.pid AS blocking_pid
        FROM pg_stat_activity blocked
        JOIN pg_locks bl ON blocked.pid = bl.pid AND NOT bl.granted
        JOIN pg_locks gl ON bl.locktype = gl.locktype
            AND bl.relation = gl.relation
            AND bl.transactionid = gl.transactionid
            AND gl.granted
        JOIN pg_stat_activity blocking ON gl.pid = blocking.pid
        WHERE blocked.pid != blocking.pid
          AND blocking.pid NOT IN (
              SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock'
          )
    ) roots
);
```

---

## 四、场景三：慢查询实时追踪与告警

### 4.1 慢查询监控视图

创建一个便于持续监控的视图：

```sql
CREATE OR REPLACE VIEW v_slow_queries AS
SELECT
    pid,
    usename,
    datname,
    application_name,
    client_addr,
    state,
    wait_event_type,
    wait_event,
    NOW() - query_start AS query_duration,
    NOW() - xact_start AS xact_duration,
    LEFT(query, 1000) AS query_text,
    CASE
        WHEN NOW() - query_start > INTERVAL '5 minutes' THEN 'CRITICAL'
        WHEN NOW() - query_start > INTERVAL '1 minute' THEN 'WARNING'
        WHEN NOW() - query_start > INTERVAL '30 seconds' THEN 'INFO'
    END AS severity
FROM pg_stat_activity
WHERE state = 'active'
  AND backend_type = 'client backend'
  AND NOW() - query_start > INTERVAL '30 seconds'
ORDER BY query_start;
```

### 4.2 自动终止超时查询（PostgreSQL 配置）

PostgreSQL 14+ 原生支持 `idle_in_transaction_session_timeout`：

```sql
-- 全局设置
ALTER SYSTEM SET idle_in_transaction_session_timeout = '5min';
-- 或针对特定用户
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '5min';

-- 需要 reload
SELECT pg_reload_conf();
```

对于活跃查询超时，可以使用 `statement_timeout`：

```sql
-- 单条查询最长 30 秒
SET statement_timeout = '30s';

-- 或者在连接字符串里设置
-- postgresql://host/db?options=-c statement_timeout=30s
```

---

## 五、Laravel 生态集成

### 5.1 Artisan 命令：数据库健康检查

```php
<?php
// app/Console/Commands/DbHealthCheck.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class DbHealthCheck extends Command
{
    protected $signature = 'db:health';
    protected $description = 'PostgreSQL 数据库健康检查：连接、锁、慢查询';

    public function handle(): int
    {
        $this->checkConnections();
        $this->checkIdleTransactions();
        $this->checkLockWaits();
        $this->checkSlowQueries();

        return self::SUCCESS;
    }

    private function checkConnections(): void
    {
        $stats = DB::select("
            SELECT
                state,
                COUNT(*) AS cnt
            FROM pg_stat_activity
            WHERE backend_type = 'client backend'
            GROUP BY state
            ORDER BY cnt DESC
        ");

        $maxConn = DB::select("SELECT setting::int AS val FROM pg_settings WHERE name = 'max_connections'")[0]->val;
        $current = collect($stats)->sum('cnt');
        $pct = round($current / $maxConn * 100, 1);

        $this->info("=== 连接状态 ===");
        $this->info("当前: {$current} / {$maxConn} ({$pct}%)");

        if ($pct > 80) {
            $this->warn("⚠️ 连接使用率超过 80%！");
        }

        $this->table(['状态', '数量'], array_map(fn($s) => [$s->state ?? 'null', $s->cnt], $stats));
    }

    private function checkIdleTransactions(): void
    {
        $idle = DB::select("
            SELECT
                pid,
                usename,
                application_name,
                client_addr,
                NOW() - xact_start AS idle_duration,
                LEFT(query, 100) AS last_query
            FROM pg_stat_activity
            WHERE state IN ('idle in transaction', 'idle in transaction (aborted)')
            ORDER BY xact_start
        ");

        $this->info("\n=== 空闲事务 ===");
        if (empty($idle)) {
            $this->info("✅ 无空闲事务");
            return;
        }

        $this->warn("⚠️ 发现 " . count($idle) . " 个空闲事务");

        $terminate = $this->confirm('是否终止超过 5 分钟的空闲事务？', false);

        foreach ($idle as $conn) {
            $age = $conn->idle_duration;
            $icon = str_contains($age, 'hour') || str_contains($age, 'day') ? '🔴' : '🟡';
            $this->line("{$icon} PID:{$conn->pid} User:{$conn->usename} App:{$conn->application_name} Age:{$age}");

            if ($terminate && $this->isOlderThan($age, 5)) {
                DB::statement("SELECT pg_terminate_backend(?)", [$conn->pid]);
                $this->error("  ↳ 已终止 PID:{$conn->pid}");
            }
        }
    }

    private function checkLockWaits(): void
    {
        $waits = DB::select("
            SELECT
                blocked.pid AS blocked_pid,
                LEFT(blocked.query, 100) AS blocked_query,
                blocking.pid AS blocking_pid,
                LEFT(blocking.query, 100) AS blocking_query,
                NOW() - blocked.query_start AS wait_duration,
                blocked_locks.locktype,
                blocked_locks.relation::regclass AS locked_table
            FROM pg_stat_activity blocked
            JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid AND NOT blocked_locks.granted
            JOIN pg_locks blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
                AND blocked_locks.relation = blocking_locks.relation
                AND blocked_locks.transactionid = blocking_locks.transactionid
                AND blocking_locks.granted
            JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
            WHERE blocked.pid != blocking.pid
              AND blocked.wait_event_type = 'Lock'
            ORDER BY blocked.query_start
        ");

        $this->info("\n=== 锁等待 ===");
        if (empty($waits)) {
            $this->info("✅ 无锁等待");
            return;
        }

        $this->error("🔴 发现 " . count($waits) . " 个锁等待！");
        foreach ($waits as $w) {
            $this->warn("被阻塞 PID:{$w->blocked_pid} ← 阻塞者 PID:{$w->blocking_pid}");
            $this->line("  表: {$w->locked_table} 类型: {$w->locktype} 等待: {$w->wait_duration}");
            $this->line("  被阻塞 SQL: {$w->blocked_query}");
            $this->line("  阻塞者 SQL: {$w->blocking_query}");
        }
    }

    private function checkSlowQueries(): void
    {
        $slow = DB::select("
            SELECT
                pid,
                usename,
                application_name,
                wait_event_type,
                NOW() - query_start AS query_duration,
                LEFT(query, 200) AS query_text
            FROM pg_stat_activity
            WHERE state = 'active'
              AND backend_type = 'client backend'
              AND NOW() - query_start > INTERVAL '30 seconds'
            ORDER BY query_start
        ");

        $this->info("\n=== 慢查询 (>30s) ===");
        if (empty($slow)) {
            $this->info("✅ 无慢查询");
            return;
        }

        $this->warn("⚠️ 发现 " . count($slow) . " 条慢查询");
        foreach ($slow as $q) {
            $this->line("PID:{$q->pid} Duration:{$q->query_duration} Wait:{$q->wait_event_type}");
            $this->line("  {$q->query_text}");
        }
    }

    private function isOlderThan(string $interval, int $minutes): bool
    {
        // 简单解析 PostgreSQL interval 字符串
        if (str_contains($interval, 'hour') || str_contains($interval, 'day')) {
            return true;
        }
        if (preg_match('/(\d+):(\d+):(\d+)/', $interval, $m)) {
            return ($m[1] * 3600 + $m[2] * 60 + $m[3]) > $minutes * 60;
        }
        return false;
    }
}
```

### 5.2 Prometheus Exporter 集成

在 `config/prometheus.php` 或自定义 Collector 中暴露指标：

```php
<?php
// app/Metrics/PgActivityCollector.php

namespace App\Metrics;

use Illuminate\Support\Facades\DB;
use Prometheus\CollectorRegistry;

class PgActivityCollector
{
    public function register(CollectorRegistry $registry): void
    {
        $gauge = $registry->registerGauge(
            'postgresql',
            'active_connections',
            'Number of active connections by state',
            ['state', 'database']
        );

        $histogram = $registry->registerHistogram(
            'postgresql',
            'query_duration_seconds',
            'Query duration in seconds',
            ['severity'],
            [0.1, 0.5, 1, 5, 10, 30, 60, 300]
        );
    }

    public function collect(): array
    {
        // 连接数
        $connections = DB::select("
            SELECT datname, state, COUNT(*) AS cnt
            FROM pg_stat_activity
            WHERE backend_type = 'client backend'
            GROUP BY datname, state
        ");

        // 慢查询分布
        $slow = DB::select("
            SELECT
                CASE
                    WHEN NOW() - query_start > INTERVAL '5 minutes' THEN 'critical'
                    WHEN NOW() - query_start > INTERVAL '1 minute' THEN 'warning'
                    ELSE 'normal'
                END AS severity,
                EXTRACT(EPOCH FROM (NOW() - query_start)) AS duration
            FROM pg_stat_activity
            WHERE state = 'active' AND backend_type = 'client backend'
        ");

        return compact('connections', 'slow');
    }
}
```

### 5.3 Laravel 定时任务自动告警

```php
<?php
// app/Console/Kernel.php

protected function schedule(Schedule $schedule): void
{
    // 每分钟检查锁等待
    $schedule->call(function () {
        $waits = DB::select("
            SELECT COUNT(*) AS cnt
            FROM pg_stat_activity
            WHERE wait_event_type = 'Lock'
              AND backend_type = 'client backend'
        ");

        if ($waits[0]->cnt > 0) {
            // 发送告警（钉钉/飞书/Slack）
            $this->alert("🔴 PostgreSQL 锁等待告警: {$waits[0]->cnt} 个查询在等待锁");
        }
    })->everyMinute();

    // 每 5 分钟检查慢查询
    $schedule->call(function () {
        $slow = DB::select("
            SELECT pid, usename, query, NOW() - query_start AS duration
            FROM pg_stat_activity
            WHERE state = 'active'
              AND backend_type = 'client backend'
              AND NOW() - query_start > INTERVAL '2 minutes'
        ");

        foreach ($slow as $q) {
            $this->alert("🐢 慢查询 PID:{$q->pid} Duration:{$q->duration} User:{$q->usename}");
        }
    })->everyFiveMinutes();
}
```

---

## 六、踩坑记录

### 踩坑 1：pg_stat_activity 查询本身也是慢查询

当你在锁等待严重时查询 `pg_stat_activity`，你的监控查询可能也会被阻塞。解决方案：

```sql
-- 加上 backend_type 过滤，避免扫描 autovacuum/walwriter 等
-- 而且 pg_stat_activity 是系统视图，不会被 DDL 锁阻塞
SELECT * FROM pg_stat_activity WHERE backend_type = 'client backend';
```

### 踩坑 2：application_name 为空

很多 ORM 和连接池默认不设置 `application_name`，导致你看到的全是空字符串。在 Laravel 中显式设置：

```php
// config/database.php
'pgsql' => [
    'driver' => 'pgsql',
    'options' => [
        PDO::ATTR_STRINGIFY_FETCHES => true,
    ],
    // 在 DSN 中设置 application_name
    'dsn' => 'application_name=laravel-app',
],
```

对于 PgBouncer 环境，确保 `application_name` 不会被连接池覆盖（transaction pooling mode 下会被丢弃）。

### 踩坑 3：query 字段被截断

默认 `track_activity_query_size = 1024`，长 SQL 会被截断。生产环境建议调大：

```sql
ALTER SYSTEM SET track_activity_query_size = 4096;
SELECT pg_reload_conf();
```

### 踩坑 4：idle in transaction (aborted) 的隐蔽性

当一个事务遇到错误后既不 ROLLBACK 也不 COMMIT，连接会一直处于 `idle in transaction (aborted)` 状态。此时任何后续 SQL 都会报错 `current transaction is aborted`，但连接不释放，锁不释放。务必设置 `idle_in_transaction_session_timeout` 兜底。

### 踩坑 5：pg_stat_activity 的时间精度

`query_start` 和 `xact_start` 是 `timestamp with time zone` 类型，跨时区服务器对比时注意时区一致性。用 `NOW()` 计算差值可以避免时区问题，但如果你把时间存到应用层做告警，一定要统一用 UTC。

---

## 七、生产监控架构建议

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ PostgreSQL  │────→│ pg_stat_     │────→│ 监控采集     │
│             │     │ activity     │     │ (PHP/Cron)   │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                        ┌────────────────────────┼────────────────┐
                        ▼                        ▼                ▼
                  ┌──────────┐           ┌──────────┐      ┌──────────┐
                  │ 告警     │           │ Grafana  │      │ 日志     │
                  │ (飞书)   │           │ 仪表盘   │      │ ELK      │
                  └──────────┘           └──────────┘      └──────────┘
```

**推荐采集频率：**

| 指标 | 频率 | 告警阈值 |
|------|------|---------|
| 连接数 | 1 分钟 | >80% max_connections |
| 锁等待数 | 30 秒 | >0 且持续 >2 分钟 |
| 空闲事务数 | 1 分钟 | 任意一个 >5 分钟 |
| 慢查询数 | 1 分钟 | 任意一个 >2 分钟 |

---

## 总结

`pg_stat_activity` 是 PostgreSQL 生产环境最基础也最强大的诊断工具。核心要点：

1. **连接监控**：定期检查连接数、空闲事务、长事务，设置 `idle_in_transaction_session_timeout` 兜底
2. **锁链追踪**：结合 `pg_locks` 做递归查询，找到锁链源头后一键终止
3. **慢查询告警**：用视图 + 定时任务实时追踪，配合 `statement_timeout` 防御性编程
4. **Laravel 集成**：Artisan 命令做健康检查，定时任务做自动告警，Prometheus 做指标暴露

别等数据库出问题了才去查 `pg_stat_activity`——把它接入你的监控体系，让问题在发生时就被发现。
