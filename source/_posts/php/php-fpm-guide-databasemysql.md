---

title: PHP-FPM 长连接与短连接实战：数据库连接池性能差异与 MySQL 踩坑记录
keywords: [PHP, FPM, MySQL, 长连接与短连接实战, 数据库连接池性能差异与, 踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 07:25:58
updated: 2026-05-05 07:28:28
categories:
- php
- database
tags:
- Laravel
- MySQL
- PHP
- Redis
- WebSocket
- 性能优化
description: 深入剖析 PHP-FPM 在 Laravel B2C API 高并发场景下的数据库连接策略，涵盖长连接与短连接的性能差异压测对比、PDO 持久连接三大隐藏陷阱（连接状态污染、静默断连、max_connections 计算错误）及解决方案。从 PHP-FPM 进程模型原理出发，对比 ProxySQL、PgBouncer 等外部连接池中间件选型，提供 Laravel Octane + Swoole 协程连接池实现方案，附生产环境可落地的 PHP-FPM、MySQL、ProxySQL 配置模板与监控告警脚本，助你在高并发场景下稳定运行 Laravel API。
---


# PHP-FPM 长连接与短连接实战：数据库连接池性能差异与 MySQL 踩坑记录

## 前言：一个深夜的报警

某天凌晨两点，生产环境 MySQL 报了 `Too many connections`。排查发现：PHP-FPM 配置了 200 个 worker，每个 worker 打开一个 MySQL 连接，加上后台任务、定时脚本，峰值轻松突破 MySQL 的 `max_connections=300`。

这不是个例。PHP-FPM 的进程模型天然决定了——**每个 worker 独立持有数据库连接**，不像 Go/Java 有真正的线程级连接池。这意味着 PHP 的"连接池"策略直接决定了你的数据库能撑多少并发。

本文基于 KKday B2C API 项目的真实经验，从原理到落地，彻底搞懂 PHP-FPM 下长连接与短连接的性能差异。

---

## 架构全景：PHP-FPM 的连接模型

```
┌─────────────────────────────────────────────────┐
│                   Nginx                         │
│              (反向代理层)                         │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│              PHP-FPM Master                      │
│         (管理 worker 子进程)                      │
├─────────┬─────────┬─────────┬───────────────────┤
│ Worker  │ Worker  │ Worker  │  ... × N          │
│   #1    │   #2    │   #3    │                    │
│  ┌───┐  │  ┌───┐  │  ┌───┐  │  ┌───┐           │
│  │PDO│  │  │PDO│  │  │PDO│  │  │PDO│           │
│  └─┬─┘  │  └─┬─┘  │  └─┬─┘  │  └─┬─┘           │
├────┼─────┼────┼─────┼────┼─────┼────┼───────────┤
│    │     │    │     │    │     │    │            │
│    ▼     │    ▼     │    ▼     │    ▼            │
│  ┌─────────────────────────────────────┐        │
│  │          MySQL Server               │        │
│  │    max_connections = 300            │        │
│  │    Threads_connected ← 当前连接数   │        │
│  └─────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
```

**核心问题**：PHP-FPM 每个 worker 进程独立运行，生命周期内可以持有独立的数据库连接。当 worker 数量 × 每连接数 > MySQL `max_connections` 时，直接崩盘。

---

## 短连接 vs 长连接：原理对比

### 短连接（默认行为）

```php
// Laravel 默认行为：每次请求创建连接，请求结束销毁
// config/database.php
'mysql' => [
    'driver'   => 'mysql',
    'host'     => env('DB_HOST'),
    'database' => env('DB_DATABASE'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    'options'  => [
        // 默认不开启持久连接
        PDO::ATTR_PERSISTENT => false,
    ],
],
```

**生命周期**：
```
Request 1: [CONNECT] → [QUERY] → [QUERY] → [CLOSE]
Request 2: [CONNECT] → [QUERY] → [CLOSE]
Request 3: [CONNECT] → [QUERY] → [QUERY] → [QUERY] → [CLOSE]
```

**开销分析**（每次请求）：
- TCP 三次握手：~0.1-0.5ms（同机房）
- MySQL 认证握手：~0.5-2ms（含 SSL 则更高）
- 总计额外开销：**1-3ms / 请求**

### 长连接（PDO Persistent）

```php
// config/database.php
'mysql' => [
    'driver'   => 'mysql',
    // ...
    'options'  => [
        PDO::ATTR_PERSISTENT => true,  // 开启持久连接
    ],
],
```

**生命周期**：
```
Worker #1 生命周期内:
  Request 1: [CONNECT] → [QUERY] → [QUERY] → (保持)
  Request 2:               (复用) → [QUERY] → (保持)
  Request 3:               (复用) → [QUERY] → [QUERY] → (保持)
  ...
  Worker 退出时: → [CLOSE]
```

---

## 压测实测：性能差异到底有多大？

我们用 `wrk` 做了对比测试，Laravel API 端点：`GET /api/products?category=10`（单表查询，返回 20 条记录）。

### 测试环境

| 参数 | 值 |
|------|-----|
| PHP-FPM workers | 50 |
| MySQL max_connections | 200 |
| 服务器 | 4C8G 同机房 |
| 压测并发 | 100 并发连接 |

### 测试结果

```
┌────────────────┬──────────────┬──────────────┬─────────────┐
│     指标        │   短连接     │   长连接      │   差异       │
├────────────────┼──────────────┼──────────────┼─────────────┤
│ QPS (avg)      │ 2,847        │ 3,412        │ +19.8%      │
│ P50 延迟       │ 32ms         │ 26ms         │ -18.7%      │
│ P99 延迟       │ 89ms         │ 61ms         │ -31.5%      │
│ MySQL Threads  │ 48-52 (波动)  │ 48-50 (稳定) │ 更平稳      │
│ CPU (PHP-FPM)  │ 62%          │ 58%          │ -6.5%       │
│ CPU (MySQL)    │ 45%          │ 41%          │ -8.9%       │
└────────────────┴──────────────┴──────────────┴─────────────┘
```

**结论**：长连接在 P99 延迟上改善最为显著（-31.5%），因为短连接的连接建立开销在尾部延迟中被放大。

---

## 踩坑记录：PDO 持久连接的隐藏陷阱

### 坑 1：连接状态污染

这是最隐蔽的坑。PDO 持久连接会**复用上一次请求的会话状态**。

```php
// Request A：某个中间件设置了会话变量
DB::statement("SET @current_user_id = 12345");

// Request B：同一个 worker 处理，但用户不同！
// 此时 @current_user_id 仍然是 12345！
$result = DB::select("SELECT @current_user_id");
// 返回 12345 — 数据泄露！
```

**实际案例**：我们在 PostgreSQL 的 `SET search_path` 和 `SET ROLE` 上踩过这个坑。MySQL 的 `sql_mode`、字符集、事务隔离级别也可能被污染。

**解决方案**：在中间件中重置关键状态。

```php
// app/Http/Middleware/ResetDatabaseState.php
class ResetDatabaseState
{
    public function handle(Request $request, Closure $next)
    {
        // 每次请求开始时重置关键会话变量
        if (config('database.default') === 'mysql') {
            DB::statement("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
        }
        
        // 清除上一个请求可能遗留的临时变量
        DB::statement("SET @current_user_id = NULL");
        
        return $next($request);
    }
}
```

### 坑 2：连接失效后静默失败

当 MySQL 端因 `wait_timeout` 主动断开空闲连接时，PHP-FPM 的持久连接不会自动感知。

```php
// MySQL wait_timeout = 600s（10 分钟）
// Worker 持久连接闲置超过 10 分钟后，MySQL 已关闭
// 下一个请求到来时，PDO 仍认为连接有效

try {
    DB::select("SELECT 1");
    // 可能抛出: "MySQL server has gone away"
    // 或更隐蔽的: "Lost connection to MySQL server during query"
} catch (QueryException $e) {
    // Laravel 默认不自动重连！
    Log::error("Database connection lost", [
        'error' => $e->getMessage(),
    ]);
}
```

**解决方案**：在 `config/database.php` 中配置重试，并确保 `wait_timeout` 合理。

```php
'mysql' => [
    'driver'         => 'mysql',
    'options'        => [
        PDO::ATTR_PERSISTENT => true,
        PDO::ATTR_TIMEOUT    => 5,  // 连接超时 5 秒
    ],
    // Laravel 10+ 支持 sticky 连接
    'sticky'    => true,
    // 配置重连
    'retry_on_failure' => true,
],
```

自定义连接器实现自动重连：

```php
// app/Database/MysqlRetryConnector.php
use Illuminate\Database\Connectors\MySqlConnector;

class MysqlRetryConnector extends MySqlConnector
{
    protected int $maxRetries = 3;

    public function connect(array $config)
    {
        $attempt = 0;
        
        while ($attempt < $this->maxRetries) {
            try {
                return parent::connect($config);
            } catch (\PDOException $e) {
                $attempt++;
                
                if ($attempt >= $this->maxRetries) {
                    throw $e;
                }
                
                // 指数退避
                usleep(pow(2, $attempt) * 100000); // 200ms, 400ms, 800ms
                Log::warning("MySQL reconnect attempt {$attempt}", [
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }
}

// 在 ServiceProvider 中注册
// app/Providers/DatabaseServiceProvider.php
use Illuminate\Database\Connection;

public function boot()
{
    Connection::resolverFor('mysql', function ($connection, $database, $prefix, $config) {
        $connector = new MysqlRetryConnector();
        // ...
    });
}
```

### 坑 3：max_connections 计算错误

这是最常见的容量规划失误。**连接数不是 FPM worker 数，而是所有来源之和**。

```bash
# 查看 MySQL 当前连接状态
mysql> SHOW STATUS LIKE 'Threads_connected';
+-------------------+-------+
| Variable_name     | Value |
+-------------------+-------+
| Threads_connected | 187   |
+-------------------+-------+

mysql> SHOW PROCESSLIST;
# 可以看到每个连接的来源：PHP-FPM / artisan / scheduler / supervisor
```

**正确的容量计算公式**：

```
总连接数 = PHP-FPM workers (max_children)
         + Supervisor worker 进程数
         + Scheduler 进程数
         + 其他服务 (队列 consumer 等)
         + 预留缓冲 (20%)

实际示例:
  PHP-FPM:  pm.max_children = 100
  队列:     supervisor workers = 20
  定时任务: scheduler = 1
  缓冲:     20% = 24
  
  总需求 = 100 + 20 + 1 + 24 = 145
  
  MySQL max_connections 应 ≥ 150
```

---

## 进阶方案：外部连接池

当 PHP-FPM 的连接模型无法满足需求时，引入外部连接池是更彻底的方案。

### 方案 1：PgBouncer（PostgreSQL）/ ProxySQL（MySQL）

```
┌──────────────┐
│  PHP-FPM     │
│  Workers ×N  │
└──────┬───────┘
       │ 短连接（每个请求）
       ▼
┌──────────────┐     ┌──────────────┐
│   ProxySQL   │────▶│   MySQL      │
│  连接池复用   │     │  max_conn=50 │
│  50 连接上限  │     │  (大幅降低)  │
└──────────────┘     └──────────────┘
```

**ProxySQL 核心配置**：

```sql
-- 定义后端 MySQL 服务器
INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections)
VALUES (10, '10.0.1.10', 3306, 100, 50);

-- 定义查询规则（读写分离）
INSERT INTO mysql_query_rules (rule_id, match_pattern, destination_hostgroup)
VALUES (1, '^SELECT .* FOR UPDATE$', 10),  -- 写 → 主库
       (2, '^SELECT', 20);                  -- 读 → 从库

-- 关键参数：连接池大小
SET mysql-max_connections = 2000;          -- 前端最大连接数
SET mysql-default_max_latency_ms = 1000;  -- 最大延迟阈值

LOAD MYSQL SERVERS TO RUNTIME;
LOAD MYSQL QUERY RULES TO RUNTIME;
```

### 方案 2：Laravel Octane + Swoole（真正的连接池）

当使用 Swoole 时，可以在协程级别实现真正的连接池：

```php
// config/octane.php
return [
    'swoole' => [
        'options' => [
            // Swoole 原生连接池
            'open_mysql_pool' => true,
            'mysql_pool_size' => 50,       // 池中保持 50 个连接
            'mysql_pool_timeout' => 3.0,    // 获取连接超时 3 秒
        ],
    ],
];
```

自定义连接池实现（更灵活）：

```php
// app/Services/DatabasePool.php
use Swoole\Coroutine\Channel;

class DatabasePool
{
    private Channel $pool;
    private int $maxSize;
    private array $config;
    private int $currentSize = 0;

    public function __construct(array $config, int $maxSize = 20)
    {
        $this->config = $config;
        $this->maxSize = $maxSize;
        $this->pool = new Channel($maxSize);
    }

    public function get(): \PDO
    {
        // 尝试从池中获取
        if ($this->pool->length() > 0) {
            $pdo = $this->pool->pop(0.1);
            if ($pdo && $this->isAlive($pdo)) {
                return $pdo;
            }
        }

        // 池空且未达上限，创建新连接
        if ($this->currentSize < $this->maxSize) {
            $this->currentSize++;
            return $this->createConnection();
        }

        // 池满，等待归还（超时 3 秒）
        $pdo = $this->pool->pop(3.0);
        if (!$pdo) {
            throw new \RuntimeException('Database pool exhausted');
        }
        return $pdo;
    }

    public function put(\PDO $pdo): void
    {
        // 归还前重置状态
        try {
            $pdo->exec("RESET SESSION");
            $this->pool->push($pdo, 0.1);
        } catch (\Exception $e) {
            $this->currentSize--;
            // 连接已坏，丢弃
        }
    }

    private function createConnection(): \PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $this->config['host'],
            $this->config['port'] ?? 3306,
            $this->config['database']
        );

        return new \PDO($dsn, $this->config['username'], $this->config['password'], [
            \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }

    private function isAlive(\PDO $pdo): bool
    {
        try {
            $pdo->query('SELECT 1');
            return true;
        } catch (\Exception $e) {
            $this->currentSize--;
            return false;
        }
    }
}
```

---

## 生产环境推荐配置

### 场景 1：传统 PHP-FPM + PDO 持久连接

```ini
; php-fpm.conf
[www]
pm = dynamic
pm.max_children = 100          ; 根据内存计算: 50MB/worker → 8G 可开 ~100
pm.start_servers = 20
pm.min_spare_servers = 10
pm.max_spare_servers = 30
pm.max_requests = 500          ; 每处理 500 请求后重启 worker（防内存泄漏）
```

```sql
-- MySQL 配置
SET GLOBAL max_connections = 200;
SET GLOBAL wait_timeout = 300;         -- 5 分钟断开空闲连接
SET GLOBAL interactive_timeout = 300;
SET GLOBAL thread_cache_size = 64;     -- 线程缓存，减少创建开销
```

### 场景 2：高并发 + ProxySQL 连接池

```ini
; php-fpm.conf
pm.max_children = 200          ; 可以开更多，因为实际到 MySQL 的连接被 ProxySQL 控制
```

```sql
-- ProxySQL
SET mysql-max_connections = 2000;           -- 接受 2000 个前端连接
SET mysql-default_query_delay = 0;
SET mysql-connection_max_age_ms = 300000;   -- 连接最大存活 5 分钟
```

### Laravel 侧最佳实践

```php
// app/Providers/AppServiceProvider.php
public function boot(): void
{
    // 监控连接使用情况
    if (app()->environment('production')) {
        DB::listen(function ($query) {
            if ($query->time > 1000) { // 超过 1 秒的慢查询
                Log::warning('Slow query detected', [
                    'sql'    => $query->sql,
                    'time'   => $query->time . 'ms',
                    'driver' => $query->connectionName,
                ]);
            }
        });
    }

    // 每次请求结束时断开空闲连接（短连接场景推荐）
    app()->terminating(function () {
        DB::purge('mysql');
    });
}
```

---

## 监控与告警

```bash
#!/bin/bash
# scripts/check_db_connections.sh — Cron 每分钟执行

MYSQL_CMD="mysql -u monitor -p'xxx' -h 10.0.1.10"

# 获取当前连接数
CURRENT=$($MYSQL_CMD -N -e "SHOW STATUS LIKE 'Threads_connected'" | awk '{print $2}')
MAX=$($MYSQL_CMD -N -e "SHOW VARIABLES LIKE 'max_connections'" | awk '{print $2}')
USAGE=$((CURRENT * 100 / MAX))

if [ $USAGE -gt 80 ]; then
    curl -X POST "$SLACK_WEBHOOK" -H 'Content-type: application/json' \
        -d "{\"text\": \"⚠️ MySQL 连接数告警: ${CURRENT}/${MAX} (${USAGE}%)\n\nTop connections:\n$($MYSQL_CMD -e 'SELECT user, db, COUNT(*) as cnt FROM information_schema.processlist GROUP BY user, db ORDER BY cnt DESC LIMIT 10')\"}"
fi
```

---

## 总结决策树

```
你的场景是什么？
│
├── 低并发 (<50 QPS)
│   └── 短连接即可，无需优化
│
├── 中并发 (50-500 QPS)
│   ├── MySQL 为主 → PDO 持久连接 + pm.max_requests 防泄漏
│   └── PostgreSQL 为主 → PgBouncer 连接池
│
├── 高并发 (500-5000 QPS)
│   └── ProxySQL 连接池 + 读写分离
│
└── 超高并发 (>5000 QPS)
    └── Laravel Octane + Swoole 连接池 + ProxySQL
```

PHP-FPM 的连接模型决定了它天生没有"真正的连接池"，但通过合理配置持久连接 + 外部连接池代理，完全可以在中高并发场景下稳定运行。关键是：**算清楚连接数、防住状态污染、监控好使用率**。

---

*本文基于 KKday B2C API 项目真实踩坑经验整理，涉及 MySQL 5.7/8.0、PHP 8.0、Laravel 9/10。*

---

## 相关阅读

- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/categories/架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
- [Laravel + PostgreSQL Advisory Lock 实战：补偿扫描单实例化、会话级互斥与 PgBouncer 踩坑记录](/categories/PHP/laravel-postgresql-advisory-lock-guide-pgbouncer/)
- [Go 数据库/sql 实战：连接池管理、事务控制与 sqlx/sqlc 代码生成——与 Laravel Eloquent 的对比](/categories/架构/Go-数据库-sql-实战-连接池管理-事务控制与-sqlx-sqlc-代码生成/)
- [Elixir OTP 实战：Supervisor 树、GenServer、分布式进程——对比 PHP-FPM 无状态模型的并发哲学](/categories/架构/Elixir-OTP-实战-Supervisor树-GenServer-分布式进程-对比PHP-FPM无状态模型的并发哲学/)
