---
title: PostgreSQL 连接池治理实战：PgBouncer Transaction 模式 vs Session 模式——Laravel Eloquent 的 prepared statement 兼容性踩坑
keywords: [PostgreSQL, PgBouncer Transaction, vs Session, Laravel Eloquent, prepared statement, 连接池治理实战, 兼容性踩坑, 数据库]
date: 2026-06-09 22:26:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
  - PostgreSQL
  - PgBouncer
  - Laravel
  - 连接池
  - 性能优化
  - prepared statement
description: 深入对比 PgBouncer 的 Transaction 模式和 Session 模式，详解 Laravel Eloquent 在 Transaction 模式下 prepared statement 失效的原因与解决方案，含完整 Docker Compose 配置和 Laravel 集成代码。
---


## 概述

当 PostgreSQL 面对高并发连接时，每个连接消耗约 5-10MB 内存，1000 个并发连接就是 5-10GB。连接池成为必选项，而 PgBouncer 是 PostgreSQL 生态中最轻量、最成熟的连接池方案。

但 PgBouncer 的三种池化模式——Session、Transaction、Statement——各有取舍，尤其在 Laravel Eloquent 使用 prepared statement 的场景下，Transaction 模式会直接导致 `prepared statement "pdo_stmt_XXX" does not exist` 错误。本文从原理到实战，完整记录踩坑过程和解决方案。

## 核心概念：三种池化模式

### Session 模式

客户端获取连接后，整个会话期间独占该连接，直到断开才归还池中。

```
Client A ──→ [连接1] ──→ PostgreSQL Backend 1
Client B ──→ [连接2] ──→ PostgreSQL Backend 2
Client C ──→ [等待...]   （池满，排队）
```

**特点：**
- 行为与直连 PostgreSQL 完全一致
- prepared statement、SET 语句、临时表全部正常
- 连接复用率最低，高并发下池会满
- 适合长连接场景（WebSocket、gRPC）

### Transaction 模式

客户端在事务开始时借出连接，事务提交/回滚后立即归还。

```
Client A ──BEGIN──→ [连接1] ──→ Backend 1
Client A ──COMMIT──→ [连接1 归还]
Client A ──BEGIN──→ [连接3] ──→ Backend 2  （可能拿到不同后端！）
```

**特点：**
- 连接复用率最高，少量后端连接服务大量客户端
- prepared statement 不安全（事务间可能换后端连接）
- SET 语句失效（归还后被重置）
- 临时表不可用
- 适合短事务、HTTP 请求场景

### Statement 模式

每条 SQL 执行完立即归还连接，最激进但限制最多。

- 不支持多语句事务
- 实际使用极少，不推荐

## 为什么 Laravel 在 Transaction 模式下会报错？

### PDO 的 prepared statement 机制

Laravel 的 Eloquent 底层使用 PDO，PDO 默认开启 `EMULATE_PREPARES = false`，即使用 PostgreSQL 原生的 prepared statement：

```php
// Laravel 底层实际执行的流程：
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = :id");
// PostgreSQL 端创建名为 pdo_stmt_00000001 的 prepared statement
$stmt->execute([':id' => 123]);
```

### Transaction 模式下的致命问题

```
事务1: PREPARE pdo_stmt_00000001 → 后端连接 A
事务1: COMMIT → 连接 A 归还池

事务2: BEGIN → 借出连接 B（不同的后端！）
事务2: EXECUTE pdo_stmt_00000001 → ❌ 报错！
// 因为 prepared statement 存在于连接 A，连接 B 上不存在
```

这就是 `prepared statement "pdo_stmt_XXX" does not exist` 的根因。

## 实战：Docker Compose 搭建 PgBouncer 环境

### 完整配置

```yaml
# docker-compose.yml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    container_name: pg-pool-demo
    environment:
      POSTGRES_DB: demo_app
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: app_pass_2026
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_user -d demo_app"]
      interval: 5s
      timeout: 3s
      retries: 5

  pgbouncer:
    image: bitnami/pgbouncer:1.23.1
    container_name: pgbouncer-demo
    environment:
      # PostgreSQL 后端配置
      POSTGRESQL_HOST: postgres
      POSTGRESQL_PORT: 5432
      POSTGRESQL_USERNAME: app_user
      POSTGRESQL_PASSWORD: app_pass_2026
      POSTGRESQL_DATABASE: demo_app

      # PgBouncer 核心配置
      PGBOUNCER_POOL_MODE: transaction          # 关键：transaction 模式
      PGBOUNCER_DEFAULT_POOL_SIZE: 20           # 每个用户/数据库对的最大连接数
      PGBOUNCER_MAX_CLIENT_CONN: 1000           # 最大客户端连接数
      PGBOUNCER_MIN_POOL_SIZE: 5                # 最小保留连接数
      PGBOUNCER_RESERVE_POOL_SIZE: 3            # 突发流量备用连接

      # 超时配置
      PGBOUNCER_SERVER_IDLE_TIMEOUT: 300        # 空闲后端连接超时(秒)
      PGBOUNCER_CLIENT_IDLE_TIMEOUT: 600        # 空闲客户端连接超时(秒)
      PGBOUNCER_QUERY_TIMEOUT: 30               # 单条查询超时(秒)

      # 连接生命周期
      PGBOUNCER_SERVER_LIFETIME: 3600           # 后端连接最大存活时间
      PGBOUNCER_SERVER_CONNECT_TIMEOUT: 5       # 连接后端超时

      # 日志
      PGBOUNCER_LOG_CONNECTIONS: 1
      PGBOUNCER_LOG_DISCONNECTIONS: 1
      PGBOUNCER_LOG_POOLER_ERRORS: 1
      PGBOUNCER_STATS_PERIOD: 60

    ports:
      - "6432:6432"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

### 启动并验证

```bash
# 启动
docker compose up -d

# 直连 PostgreSQL 验证
psql "host=localhost port=5432 dbname=demo_app user=app_user password=app_pass_2026"

# 通过 PgBouncer 连接
psql "host=localhost port=6432 dbname=demo_app user=app_user password=app_pass_2026"

# 查看 PgBouncer 池状态
psql -h localhost -p 6432 -U pgbouncer pgbouncer -c "SHOW POOLS;"
psql -h localhost -p 6432 -U pgbouncer pgbouncer -c "SHOW STATS;"
psql -h localhost -p 6432 -U pgbouncer pgbouncer -c "SHOW CONFIG;" | grep pool_mode
```

## Laravel 集成：踩坑与解决

### 场景一：直接使用 Transaction 模式（会报错）

```php
// .env
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=6432          # 走 PgBouncer
DB_DATABASE=demo_app
DB_USERNAME=app_user
DB_PASSWORD=app_pass_2026
```

```php
// 以下代码会报错：
// PDOException: prepared statement "pdo_stmt_xxx" does not exist

User::where('status', 'active')->paginate(20);  // ❌ 第一次请求可能成功
User::where('status', 'active')->paginate(20);  // ❌ 第二次请求大概率失败
```

### 解决方案一：关闭 prepared statement（推荐）

```php
// config/database.php
'pgsql' => [
    'driver' => 'pgsql',
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '6432'),
    'database' => env('DB_DATABASE', 'demo_app'),
    'username' => env('DB_USERNAME', 'app_user'),
    'password' => env('DB_PASSWORD', ''),
    'charset' => 'utf8',
    'prefix' => '',
    'prefix_indexes' => true,
    'search_path' => 'public',
    'sslmode' => 'prefer',
    'options' => [
        // 关键：禁用 prepared statement
        PDO::ATTR_EMULATE_PREPARES => true,
        // 或者完全禁用持久化 prepared statement
        PDO::ATTR_PERSISTENT => false,
    ],
],
```

**原理：** `ATTR_EMULATE_PREPARES = true` 让 PDO 在 PHP 端模拟 prepared statement，直接发送完整 SQL 到 PostgreSQL，不再依赖服务端的 PREPARE/EXECUTE 机制。

**性能影响：** 模拟模式下，每条查询都是完整的 SQL 文本传输，无法利用 PostgreSQL 的 prepared statement 缓存执行计划。对于简单查询差异可忽略，复杂查询（多表 JOIN、子查询）的执行计划缓存收益会损失。

### 解决方案二：使用 pgbouncer 1.21+ 的 `max_prepared_statements`

PgBouncer 1.21 引入了对 prepared statement 的原生支持：

```yaml
# docker-compose.yml 中 pgbouncer 环境变量
PGBOUNCER_MAX_PREPARED_STATEMENTS: 100   # 启用 prepared statement 缓存
```

或者在 `pgbouncer.ini` 中配置：

```ini
[databases]
demo_app = host=postgres port=5432 dbname=demo_app

[pgbouncer]
pool_mode = transaction
max_prepared_statements = 100
```

**原理：** PgBouncer 自己维护 prepared statement 映射表，当客户端发送 `PREPARE` 时，PgBouncer 拦截并在本地记录；当事务结束连接归还后，下次同一客户端的 `EXECUTE` 会在新的后端连接上重新 prepare 再 execute。

**限制：**
- 需要 PgBouncer ≥ 1.21
- `max_prepared_statements` 消耗 PgBouncer 自身内存，每个 prepared statement 约 1KB
- 高并发下映射表可能成为瓶颈

### 解决方案三：切回 Session 模式（最简单但性能受限）

```yaml
PGBOUNCER_POOL_MODE: session
```

或在 Laravel 中创建两个数据库连接：

```php
// config/database.php
'connections' => [
    // 主连接：事务型操作走 PgBouncer Transaction 模式
    'pgsql_pool' => [
        'driver' => 'pgsql',
        'host' => env('DB_POOL_HOST', '127.0.0.1'),
        'port' => env('DB_POOL_PORT', '6432'),
        'database' => env('DB_DATABASE'),
        'username' => env('DB_USERNAME'),
        'password' => env('DB_PASSWORD'),
        'options' => [
            PDO::ATTR_EMULATE_PREPARES => true,  // Transaction 模式必须
        ],
    ],

    // 长事务操作：直连 PostgreSQL
    'pgsql_direct' => [
        'driver' => 'pgsql',
        'host' => env('DB_DIRECT_HOST', '127.0.0.1'),
        'port' => env('DB_DIRECT_PORT', '5432'),
        'database' => env('DB_DATABASE'),
        'username' => env('DB_USERNAME'),
        'password' => env('DB_PASSWORD'),
        // 直连可以正常使用 prepared statement
    ],
],
```

```php
// 使用示例
// 一般查询走连接池
$users = DB::connection('pgsql_pool')
    ->table('users')
    ->where('status', 'active')
    ->get();

// 需要 prepared statement 的复杂查询走直连
$result = DB::connection('pgsql_direct')
    ->select('
        WITH ranked_orders AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
            FROM orders
        )
        SELECT * FROM ranked_orders WHERE rn <= 5
    ');
```

## 生产环境配置建议

### PgBouncer 调参公式

```
max_client_conn = 预期并发请求数 × 1.5（留余量）
default_pool_size = PostgreSQL max_connections × 0.6 / 应用实例数
min_pool_size = default_pool_size × 0.25
reserve_pool_size = default_pool_size × 0.15
```

例如：PostgreSQL `max_connections = 200`，4 个 Laravel 实例：

```
default_pool_size = 200 × 0.6 / 4 = 30
min_pool_size = 30 × 0.25 ≈ 8
reserve_pool_size = 30 × 0.15 ≈ 5
max_client_conn = 30 × 4 × 1.5 = 180
```

### Laravel 健康检查中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PgBouncerHealthCheck
{
    public function handle(Request $request, Closure $next)
    {
        try {
            // 简单查询验证连接池可用性
            DB::connection('pgsql_pool')->select('SELECT 1');
        } catch (\Exception $e) {
            Log::error('PgBouncer 连接池异常', [
                'error' => $e->getMessage(),
                'request_id' => $request->header('X-Request-ID'),
            ]);

            // 降级：切换到直连
            config(['database.default' => 'pgsql_direct']);
        }

        return $next($request);
    }
}
```

### 监控脚本

```php
<?php
// app/Console/Commands/PgBouncerMonitor.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PgBouncerMonitor extends Command
{
    protected $signature = 'pgbouncer:monitor {--detailed : 显示详细统计}';
    protected $description = '监控 PgBouncer 连接池状态';

    public function handle()
    {
        $pools = DB::connection('pgsql_pool')
            ->select("SHOW POOLS");

        $headers = ['Database', 'User', 'ClActive', 'ClWaiting', 'SvActive', 'SvIdle', 'MaxWait'];
        $rows = [];

        foreach ($pools as $pool) {
            $rows[] = [
                $pool->database,
                $pool->user,
                $pool->cl_active,
                $pool->cl_waiting,
                $pool->sv_active,
                $pool->sv_idle,
                $pool->maxwait,
            ];
        }

        $this->table($headers, $rows);

        if ($this->option('detailed')) {
            $this->newLine();
            $this->info('=== 连接统计 ===');

            $stats = DB::connection('pgsql_pool')
                ->select("SHOW STATS");

            foreach ($stats as $stat) {
                if ($stat->database === 'demo_app') {
                    $this->info("总查询数: {$stat->total_query_count}");
                    $this->info("平均查询时间: {$stat->avg_query_time} μs");
                    $this->info("总接收字节: {$stat->total_received}");
                    $this->info("总发送字节: {$stat->total_sent}");
                }
            }
        }

        // 告警：等待连接数过多
        foreach ($pools as $pool) {
            if ($pool->cl_waiting > 5) {
                $this->warn("⚠️  警告: {$pool->database} 有 {$pool->cl_waiting} 个客户端等待连接!");
            }
        }

        return 0;
    }
}
```

```bash
# 运行监控
php artisan pgbouncer:monitor
php artisan pgbouncer:monitor --detailed
```

## 踩坑记录

### 坑1：Laravel Queue Worker 的长连接问题

Laravel Queue Worker 是长驻进程，在 Transaction 模式下，Worker 进程与 PgBouncer 的连接不会释放。虽然 PgBouncer 会在事务结束后归还后端连接，但 Worker 进程本身可能持有客户端连接不放。

```php
// 解决方案：在 Queue Worker 中定期重连
// app/Jobs/HeavyJob.php
class HeavyJob implements ShouldQueue
{
    public $tries = 3;

    public function handle()
    {
        // 每个 Job 开始时重置连接
        DB::reconnect('pgsql_pool');

        try {
            $this->process();
        } finally {
            // Job 结束断开连接，释放给 PgBouncer
            DB::disconnect('pgsql_pool');
        }
    }
}
```

或在 `config/queue.php` 中配置：

```php
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'queue' => 'default',
        'retry_after' => 90,
        'block_for' => null,
        'after_commit' => false,
        // 每处理 N 个 Job 后重启 Worker，避免连接泄漏
    ],
],
```

```bash
# 生产环境推荐：限制每个 Worker 处理的 Job 数量后自动退出
php artisan queue:work --max-jobs=500 --max-time=3600
```

### 坑2：LISTEN/NOTIFY 无法使用

PgBouncer Transaction 模式不支持 `LISTEN` 和 `NOTIFY`，因为它们是会话级别的命令。

```php
// ❌ 这段代码在 Transaction 模式下会失败
DB::listen(function ($query) {
    // Laravel 的 query log 本身没问题
    // 但如果你用 PostgreSQL 的 NOTIFY 做实时通知，必须直连
});

// ✅ 解决方案：NOTIFY 相关操作走直连
DB::connection('pgsql_direct')->statement('LISTEN order_updates');
```

### 坑3：`pg_advisory_lock` 不可用

应用级锁依赖会话状态，Transaction 模式下锁会在事务结束时释放：

```php
// ❌ Transaction 模式下 advisory lock 在事务结束就释放了
DB::transaction(function () {
    DB::select("SELECT pg_advisory_lock(12345)");
    // 业务逻辑...
}); // COMMIT 后锁立即释放，不是你期望的"用完手动释放"

// ✅ 如果需要 advisory lock，走直连
$lock = DB::connection('pgsql_direct')
    ->select("SELECT pg_try_advisory_lock(12345) as locked");
```

### 坑4：prepared statement 缓存导致内存溢出

使用 `max_prepared_statements` 方案时，如果应用大量使用不同的 SQL（比如动态 WHERE 条件），prepared statement 映射表会持续增长。

```php
// ❌ 动态条件生成大量不同的 prepared statement
$query = User::query();
foreach ($filters as $field => $value) {
    $query->where($field, $value);  // 每种组合生成不同的 SQL
}

// ✅ 限制动态条件数量，或使用 emulated prepares
// 在 config/database.php 中已经设置了 EMULATE_PREPARES=true 就不会有这个问题
```

## 性能对比测试

```php
<?php
// benchmark.php - 简单的连接池性能对比

use Illuminate\Support\Facades\DB;

function benchmarkConnectionPool(string $connection, int $iterations): array
{
    $start = microtime(true);

    for ($i = 0; $i < $iterations; $i++) {
        DB::connection($connection)
            ->table('users')
            ->where('id', rand(1, 1000))
            ->first();
    }

    $elapsed = microtime(true) - $start;

    return [
        'connection' => $connection,
        'iterations' => $iterations,
        'total_time' => round($elapsed, 3) . 's',
        'qps' => round($iterations / $elapsed),
        'avg_latency' => round($elapsed / $iterations * 1000, 2) . 'ms',
    ];
}

// 预期结果（本地 Docker，1000 次查询）：
// 直连 PostgreSQL:     ~2.1s, QPS ~476, Avg 2.1ms
// PgBouncer Session:   ~2.3s, QPS ~435, Avg 2.3ms
// PgBouncer Transaction (emulated): ~1.8s, QPS ~556, Avg 1.8ms
// Transaction 模式因为连接复用率高，反而可能更快
```

## 总结

| 维度 | Session 模式 | Transaction 模式 |
|------|-------------|-----------------|
| 连接复用率 | 低 | 高 |
| prepared statement | ✅ 原生支持 | ❌ 需关闭或用 max_prepared_statements |
| SET/LISTEN | ✅ | ❌ |
| advisory lock | ✅ | ❌ |
| 临时表 | ✅ | ❌ |
| 适用场景 | 长连接、复杂查询 | HTTP 短请求、高并发 |
| Laravel 配置 | 默认即可 | 需要 `EMULATE_PREPARES=true` |

**选型建议：**

1. **HTTP API 服务**：Transaction 模式 + `EMULATE_PREPARES=true`，连接复用率最高
2. **后台任务/Queue Worker**：Session 模式或直连，避免连接泄漏
3. **需要 LISTEN/NOTIFY、advisory lock 的场景**：直连 PostgreSQL
4. **混合架构**：两个连接池——Transaction 模式处理常规请求，Session 模式处理特殊操作

PgBouncer 不是万能药，但用对了场景，它是 PostgreSQL 高并发架构中最轻量的连接池方案。关键是理解 Transaction 模式的限制，在 Laravel 侧做好适配。
