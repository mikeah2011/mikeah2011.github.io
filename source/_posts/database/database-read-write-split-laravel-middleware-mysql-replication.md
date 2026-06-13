---

title: 数据库读写分离实战：Laravel 中间件 + MySQL 主从复制配置
date: 2026-06-01 12:00:00
categories:
  - database
keywords: [Laravel, MySQL, 数据库读写分离实战, 中间件, 主从复制配置]
tags:
- MySQL
- Laravel
- 读写分离
- 主从复制
- 性能优化
description: 基于 KKday B2C API 项目的真实生产经验，记录从 MySQL 主从复制搭建到 Laravel 中间件自动路由读写的完整落地过程，覆盖 binlog 格式选型、主从延迟治理、Laravel 多数据库连接配置、Sticky Connection、事务内强制主库等核心踩坑点。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/database-001-content-1.jpg
- /images/content/database-001-content-2.jpg
---



## 一、为什么写这篇？

在 B2C 电商场景中，随着流量增长，数据库逐渐成为瓶颈。以 KKday 的 Laravel B2C API 为例：

- **读写比 8:2**：商品查询、订单列表、搜索结果等读操作远多于写操作
- **单库 QPS 瓶颈**：高峰期主库 CPU 持续 70%+，慢查询数量飙升
- **报表拖慢 OLTP**：运营跑的统计 SQL 动辄几秒，直接影响线上接口响应

解决思路很明确——**读写分离**：主库（Master）处理写操作，从库（Slave/Replica）分担读操作。

但实际落地时踩过的坑远比想象的多：

1. **主从延迟**导致刚写入的数据读不到
2. **Laravel 配置不当**导致事务内读到了从库旧数据
3. **binlog 格式选错**导致从库数据不一致
4. **连接池复用**导致读请求被路由到主库，性能没提升

本文记录完整的从 0 到 1 落地过程，每个配置项都附带踩坑说明。

---

## 二、核心概念与架构

![数据库读写分离架构](/images/content/database-001-content-1.jpg)

### 2.1 读写分离架构全景

```
                        ┌──────────────┐
                        │   Laravel    │
                        │   Application│
                        └──────┬───────┘
                               │
                    ┌──────────┴──────────┐
                    │  Database Middleware │
                    │  (自动路由读写)       │
                    └──────┬──────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐  ┌─────┴─────┐
        │  Master   │ │Slave 1│  │  Slave 2  │
        │  (写)     │ │ (读)  │  │   (读)    │
        └─────┬─────┘ └───┬───┘  └─────┬─────┘
              │            │            │
              │    ┌───────┴────────────┘
              │    │  binlog 复制
              └────┘
```

### 2.2 MySQL 主从复制原理（精简版）

```
Master                          Slave
  │                               │
  │  1. 写入数据                    │
  │  2. 写入 binlog                │
  │                               │
  │  3. dump thread ──binlog──▶  I/O thread
  │                               │
  │                               │  4. 写入 relay log
  │                               │
  │                               │  5. SQL thread 读取 relay log
  │                               │  6. 重放 SQL 到从库
  │                               │
  ▼                               ▼
  COMMIT                        DATA SYNCED
```

**关键概念：**
- **binlog**：主库的二进制日志，记录所有数据变更
- **relay log**：从库的中继日志，存储从主库拉取的 binlog
- **SQL thread**：从库的 SQL 线程，负责重放 relay log 中的事件
- **主从延迟**：从库重放 relay log 的时间差

---

## 三、实战代码

### 3.1 MySQL 主从复制配置

#### 3.1.1 Master 配置 (`my.cnf`)

```ini
[mysqld]
# === 唯一标识 ===
server-id = 1

# === binlog 配置 ===
log-bin = /var/lib/mysql/mysql-bin
binlog_format = ROW                # 必须用 ROW！STATEMENT 有函数一致性问题
binlog_row_image = FULL            # 完整行镜像，便于从库精确重放
expire_logs_days = 7               # binlog 保留 7 天
max_binlog_size = 500M             # 单个 binlog 最大 500MB

# === GTID 模式（推荐） ===
gtid_mode = ON
enforce_gtid_consistency = ON

# === 需要复制的数据库 ===
# binlog-do-db = kkday_b2c         # 可选：只复制指定库
# binlog-ignore-db = mysql          # 可选：忽略系统库
```

> ⚠️ **踩坑 #1：binlog_format 选型**
>
> 我们最初用了 `STATEMENT` 格式（因为 binlog 文件更小），结果发现 `NOW()`、`UUID()`、`RAND()` 等函数在主从库执行结果不同，导致数据不一致。**必须用 `ROW` 格式**，它记录的是行变更而非 SQL 语句，确保精确复制。

#### 3.1.2 Slave 配置 (`my.cnf`)

```ini
[mysqld]
# === 唯一标识（每个从库不同） ===
server-id = 2                      # Slave 1
# server-id = 3                    # Slave 2

# === relay log 配置 ===
relay-log = /var/lib/mysql/relay-bin
relay_log_purge = ON
relay_log_recovery = ON

# === GTID 模式 ===
gtid_mode = ON
enforce_gtid_consistency = ON

# === 只读模式（防止误写） ===
read_only = ON
super_read_only = ON               # MySQL 5.7+，连 SUPER 权限也限制写入

# === 并行复制（降低延迟） ===
slave_parallel_type = LOGICAL_CLOCK
slave_parallel_workers = 4         # 根据 CPU 核心数调整
slave_preserve_commit_order = ON   # 保证提交顺序
```

> ⚠️ **踩坑 #2：从库并行复制配置**
>
> 不配置 `slave_parallel_workers` 时，从库是**单线程重放**，主从延迟会随写入量线性增长。我们上线后高峰期延迟一度到 30+ 秒。开启并行复制后降到 1 秒以内。`LOGICAL_CLOCK` 模式比 `DATABASE` 模式更高效，因为它是按事务的提交时钟并行，不受库名限制。

#### 3.1.3 创建复制用户并启动同步

```sql
-- 在 Master 上执行
CREATE USER 'repl_user'@'%' IDENTIFIED BY 'StrongPassword123!';
GRANT REPLICATION SLAVE ON *.* TO 'repl_user'@'%';
FLUSH PRIVILEGES;

-- 在 Slave 上执行（GTID 自动定位）
CHANGE MASTER TO
  MASTER_HOST = '10.0.1.10',
  MASTER_USER = 'repl_user',
  MASTER_PASSWORD = 'StrongPassword123!',
  MASTER_AUTO_POSITION = 1;        -- GTID 模式自动定位

START SLAVE;

-- 验证状态
SHOW SLAVE STATUS\G
```

**必须确认的两个关键字段：**
```
Slave_IO_Running: Yes
Slave_SQL_Running: Yes
```

> ⚠️ **踩坑 #3：GTID 模式 vs 传统 binlog position**
>
> 传统模式用 `MASTER_LOG_FILE` + `MASTER_LOG_POS` 手动指定 binlog 位置，新增从库或故障恢复时很容易配错。**GTID 模式自动跟踪事务位置**，切换主从时不用手动计算 position，强烈推荐。

### 3.2 Laravel 读写分离配置

#### 3.2.1 数据库配置 (`config/database.php`)

```php
'mysql' => [
    'driver' => 'mysql',

    // 主库（写）
    'write' => [
        'host' => env('DB_WRITE_HOST', '10.0.1.10'),
    ],

    // 从库（读）
    'read' => [
        'host' => [
            env('DB_READ_HOST_1', '10.0.1.11'),
            env('DB_READ_HOST_2', '10.0.1.12'),
        ],
        'port' => env('DB_READ_PORT', '3306'),
    ],

    // 公共配置
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'kkday_b2c'),
    'username' => env('DB_USERNAME', 'app_user'),
    'password' => env('DB_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'prefix' => '',
    'prefix_indexes' => true,
    'strict' => true,
    'engine' => null,

    // ⚠️ 关键配置
    'sticky' => true,                // 粘性连接
    'options' => [
        PDO::ATTR_PERSISTENT => false, // 不用持久连接
    ],
],
```

> ⚠️ **踩坑 #4：`sticky` 的作用**
>
> `sticky = true` 意味着：**在当前请求的生命周期内，一旦对 Master 执行了写操作，后续的读也会走 Master**。这是为了解决"写后读不一致"的问题——你刚插入一条记录，如果紧接着的查询路由到了还没同步的 Slave，就会读到旧数据。
>
> 但这不是万能药。**跨请求的延迟问题** sticky 解决不了。

#### 3.2.2 Laravel 的自动路由机制

Laravel 底层通过 `Illuminate\Database\Connection` 的 `select()` 和 `statement()` 方法自动路由：

```php
// 源码路径：vendor/laravel/framework/src/Illuminate/Database/Connection.php

public function select($query, $bindings = [], $useReadPdo = true)
{
    return $this->run($query, $bindings, function ($query, $bindings) use ($useReadPdo) {
        // useReadPdo = true → 走 read connection（Slave）
        if ($this->pretending()) {
            return $this->pretend($query, $bindings);
        }
        $statement = $this->prepared($this->getPdoForSelect($useReadPdo)->prepare($query));
        // ...
    });
}

protected function getPdoForSelect($useReadPdo = true)
{
    // 关键逻辑：如果 useReadPdo=true 且有 read 配置
    // → 返回 readPdo（Slave）
    // 否则返回 writePdo（Master）
    return $useReadPdo ? $this->getReadPdo() : $this->getPdo();
}
```

**路由规则总结：**

| 操作类型 | 路由目标 | 原因 |
|---------|---------|------|
| `select()` | Slave | 普通查询 |
| `insert()` / `update()` / `delete()` | Master | 写操作 |
| 事务内的所有操作 | Master | 保证一致性 |
| `sticky=true` + 先写后读 | Master | 防止写后读不一致 |
| `DB::unprepared()` | Master | 原始 SQL |

#### 3.2.3 显式指定数据库连接

有时需要强制走主库或从库：

```php
// 方式 1：使用 select 方法的第四个参数强制走主库
DB::connection('mysql')->select(
    'SELECT * FROM orders WHERE user_id = ?',
    [$userId],
    $useReadPdo = false  // 强制走主库
);

// 方式 2：使用 read/write connection 显式切换
DB::connection('mysql')->getPdo();         // 写连接（Master）
DB::connection('mysql')->getReadPdo();     // 读连接（Slave）

// 方式 3：用 selectUsing 方法（Laravel 10+）
DB::selectUsing(
    'SELECT * FROM products WHERE status = ?',
    ['active'],
    'read'  // 或 'write'
);
```

#### 3.2.4 事务内的读写分离陷阱

```php
DB::transaction(function () {
    // 这里自动走 Master
    $order = Order::create([
        'user_id' => $userId,
        'total' => 99.99,
    ]);

    // ⚠️ 这里也走 Master（因为 sticky=true + 在事务内）
    $product = Product::where('id', $productId)->first(); // Master

    // 如果 Slave 延迟很大，事务结束后立即查询可能读到旧数据
});

// ⚠️ 事务结束后，如果 sticky 还在生效，继续读 Master
$order = Order::find($orderId); // 可能走 Master（取决于 sticky 状态）
```

### 3.3 进阶：自定义数据库中间件

当 Laravel 自带的读写分离不够用时，可以自定义中间件来精细控制：

#### 3.3.1 写后读强制主库中间件

```php
<?php
// app/Http/Middleware/ForceReadMaster.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\DB;

class ForceReadMaster
{
    /**
     * 对需要强一致性的接口，强制读走主库
     * 场景：刚下单后查询订单详情
     */
    public function handle($request, Closure $next)
    {
        // 如果请求带有 X-Read-Master 头部（由负载均衡器或 API 网关设置）
        if ($request->header('X-Read-Master') === 'true') {
            DB::connection('mysql')->setReadPdo(null); // 清除 read 连接，强制走 write
        }

        return $next($request);
    }
}
```

#### 3.3.2 基于业务逻辑的动态路由

```php
<?php
// app/Services/DatabaseRouter.php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class DatabaseRouter
{
    /**
     * 根据业务类型自动选择数据库连接
     * - 订单相关：走主库（强一致性）
     * - 商品浏览：走从库（允许延迟）
     * - 报表统计：走专用从库（不影响线上）
     */
    public static function routeFor(string $businessType): string
    {
        return match ($businessType) {
            'order', 'payment', 'inventory' => 'mysql',           // 主库
            'product', 'category', 'review' => 'mysql_read',      // 从库
            'report', 'analytics' => 'mysql_analytics',           // 报表专用从库
            default => 'mysql_read',
        };
    }
}

// 使用方式
$order = DB::connection(DatabaseRouter::routeFor('order'))
    ->table('orders')
    ->where('id', $orderId)
    ->first();

$products = DB::connection(DatabaseRouter::routeFor('product'))
    ->table('products')
    ->where('category_id', $categoryId)
    ->paginate(20);
```

#### 3.3.3 报表专用从库配置

```php
// config/database.php 中新增

'mysql_analytics' => [
    'driver' => 'mysql',
    'host' => env('DB_ANALYTICS_HOST', '10.0.1.20'),  // 报表专用从库
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'kkday_b2c'),
    'username' => env('DB_ANALYTICS_USER', 'readonly_user'),
    'password' => env('DB_ANALYTICS_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'strict' => false,               // 报表场景可以关掉严格模式
    'options' => [
        PDO::ATTR_PERSISTENT => true,  // 报表连接可以持久化
        PDO::ATTR_TIMEOUT => 300,      // 报表查询超时设长一点
    ],
],
```

> ⚠️ **踩坑 #5：报表从库拖垮主库**
>
> 我们曾经没有专用报表从库，运营跑的全表扫描报表和线上查询共享同一个从库，导致从库 CPU 飙到 95%，线上接口响应时间翻倍。**一定要为报表/分析场景配置独立从库**，并且设置不同的连接用户和权限。

### 3.4 主从延迟监控与治理

#### 3.4.1 监控主从延迟

```sql
-- 在 Slave 上执行
SHOW SLAVE STATUS\G

-- 关注字段：
-- Seconds_Behind_Master: 0  （理想值为 0，越小越好）
-- Slave_SQL_Running_State: Slave has read all relay log
```

在 Laravel 中封装延迟监控：

```php
<?php
// app/Services/ReplicationMonitor.php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class ReplicationMonitor
{
    /**
     * 获取主从延迟秒数
     */
    public static function getReplicationLag(): ?int
    {
        try {
            $result = DB::connection('mysql_read')
                ->select('SHOW SLAVE STATUS');

            if (empty($result)) {
                return null;
            }

            return $result[0]->Seconds_Behind_Master;
        } catch (\Exception $e) {
            report($e);
            return null;
        }
    }

    /**
     * 延迟超过阈值时自动告警
     */
    public static function checkAndAlert(int $threshold = 5): void
    {
        $lag = self::getReplicationLag();

        if ($lag !== null && $lag > $threshold) {
            // 发送 Slack 告警
            \App\Notifications\ReplicationLagAlert::dispatch($lag);
        }
    }
}
```

#### 3.4.2 延迟感知路由

```php
<?php
// app/Services/SmartDatabaseRouter.php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class SmartDatabaseRouter
{
    /**
     * 智能路由：主从延迟超过阈值时，读操作自动回退到主库
     */
    public static function getReadConnection(): string
    {
        $lag = Cache::remember('replication_lag', 5, function () {
            return ReplicationMonitor::getReplicationLag();
        });

        // 延迟超过 3 秒，强制走主库
        if ($lag !== null && $lag > 3) {
            return 'mysql';
        }

        return 'mysql_read';
    }
}
```

#### 3.4.3 Prometheus + Grafana 监控

```yaml
# prometheus.yml — 添加 MySQL 从库监控
scrape_configs:
  - job_name: 'mysql-slave'
    static_configs:
      - targets: ['10.0.1.11:9104', '10.0.1.12:9104']
    metrics_path: /metrics
```

关键监控指标：

| 指标名 | 含义 | 告警阈值 |
|--------|------|---------|
| `mysql_slave_status_seconds_behind_master` | 主从延迟秒数 | > 5s |
| `mysql_slave_status_slave_io_running` | IO 线程是否运行 | = 0 |
| `mysql_slave_status_slave_sql_running` | SQL 线程是否运行 | = 0 |
| `mysql_global_status_threads_connected` | 当前连接数 | > 80% max |

Grafana PromQL 示例：

```promql
# 主从延迟趋势
mysql_slave_status_seconds_behind_master{instance=~"$slave"}

# 从库 QPS
rate(mysql_global_status_queries{instance=~"$slave"}[5m])

# 从库连接数使用率
mysql_global_status_threads_connected{instance=~"$slave"}
  / mysql_global_variables_max_connections{instance=~"$slave"} * 100
```

---

## 四、踩坑记录

### 踩坑 #6：Redis Session 的读写分离问题

```php
// config/database.php — Redis 配置
'redis' => [
    'client' => 'predis',
    'session' => [
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD', null),
        'port' => env('REDIS_PORT', 6379),
        'database' => 0,
        // ⚠️ 不要给 Session 的 Redis 配置读写分离
        // 否则负载均衡到不同 PHP-FPM 实例时会读到旧 Session
    ],
],
```

> Redis Session **不能配读写分离**。Session 写入主节点后，从节点有毫秒级同步延迟。当请求被 Nginx 负载均衡到不同的 PHP-FPM 实例时，读到未同步的旧 Session 会导致登录态丢失。

### 踩坑 #7：Migration 不能在从库执行

```php
// Migration 文件中的 raw SQL
Schema::table('orders', function (Blueprint $table) {
    $table->string('remark', 500)->nullable();
});

// ⚠️ 如果 Migration 在从库执行，会直接报错
// read_only = ON 的从库不允许 DDL 操作
```

Laravel 的 Migration 默认走 `mysql` 连接（主库），所以不会出问题。但如果你手动指定了连接名，一定要确认走的是主库。

### 踩坑 #8：Laravel Queue Worker 的连接复用

```php
// ⚠️ Queue Worker 是常驻进程，数据库连接会复用
// 如果 Worker 启动时建立了到 Slave 的连接，后续可能一直用这个连接
// 解决方案：配置 reconnect 逻辑

// config/queue.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'queue' => 'default',
    'retry_after' => 90,
    'block_for' => null,
],
```

> Worker 进程的数据库连接在空闲超时后会被 MySQL 断开。Laravel 默认会自动重连，但重连时的读写路由可能不符合预期。建议在 Job 中显式指定连接：

```php
class ProcessOrder implements ShouldQueue
{
    public function handle(): void
    {
        // Job 里显式走主库
        $order = DB::connection('mysql')
            ->table('orders')
            ->where('id', $this->orderId)
            ->lockForUpdate()  // 行锁必须走主库
            ->first();

        // 处理逻辑...
    }
}
```

### 踩坑 #9：PDO 持久连接的坑

```php
'options' => [
    // ⚠️ 持久连接 + 读写分离 = 灾难
    // 持久连接不会被销毁，会一直复用
    // 可能导致读请求一直走 Master 的持久连接
    PDO::ATTR_PERSISTENT => false,  // 必须关闭！
],
```

> 持久连接（`ATTR_PERSISTENT = true`）会绕过 Laravel 的连接管理，导致读写分离逻辑失效。**一定要关闭持久连接**，让 Laravel 每次请求都创建新的连接。

### 踩坑 #10：从库配置错误导致数据丢失

```
# 从库的 read_only = ON 只是防误写，不能防 DDL
# 如果有人用 SUPER 权限在从库执行了 DROP TABLE，数据就没了

# 解决方案：
# 1. 从库用户不用 SUPER 权限
# 2. 开启 super_read_only = ON（MySQL 5.7+）
# 3. 定期验证主从数据一致性
```

用 `pt-table-checksum` 验证主从一致性：

```bash
# Percona Toolkit 工具
pt-table-checksum \
  --host=10.0.1.10 \
  --user=root \
  --password=your_password \
  --databases=kkday_b2c \
  --replicate=percona.checksums \
  --no-check-binlog-format
```

---

## 五、对比与选型建议

![监控与性能分析](/images/content/database-001-content-2.jpg)

### 5.1 读写分离方案对比

| 方案 | 复杂度 | 延迟控制 | 灵活性 | 适用场景 |
|------|--------|---------|--------|---------|
| Laravel 自带 (read/write config) | ⭐ 低 | ❌ 无 | ⭐⭐ 中 | 中小型项目，读写比不高 |
| 自定义中间件 + 延迟监控 | ⭐⭐ 中 | ✅ 有 | ⭐⭐⭐ 高 | 中大型 B2C 项目 |
| ProxySQL 代理层 | ⭐⭐⭐ 高 | ✅ 有 | ⭐⭐⭐ 高 | 大规模分布式架构 |
| MySQL Router | ⭐⭐ 中 | ⚠️ 基础 | ⭐⭐ 中 | InnoDB Cluster 场景 |
| ShardingSphere | ⭐⭐⭐⭐ 极高 | ✅ 有 | ⭐⭐⭐⭐ 极高 | 超大规模 + 分库分表 |

### 5.2 我们的选择

```
阶段 1（初期）：Laravel 自带 read/write config
  ↓ 读写比增长到 7:3
阶段 2（中期）：自定义中间件 + 延迟监控 + 报表专用从库
  ↓ QPS 超过单从库能力
阶段 3（后期）：ProxySQL 代理 + 多从库负载均衡
```

### 5.3 binlog 格式对比

| 格式 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| STATEMENT | binlog 体积小 | 函数不一致、复杂 SQL 可能出错 | ❌ 不推荐 |
| ROW | 精确复制、数据一致 | binlog 体积大 | ✅ **强烈推荐** |
| MIXED | 自动切换 | 行为不可预测 | ⚠️ 谨慎使用 |

---

## 六、总结与最佳实践

### 6.1 配置清单

```
✅ Master my.cnf
  ├── server-id = 1
  ├── binlog_format = ROW
  ├── gtid_mode = ON
  └── expire_logs_days = 7

✅ Slave my.cnf
  ├── server-id = 2/3/4...（每台不同）
  ├── read_only = ON
  ├── super_read_only = ON
  ├── slave_parallel_workers = 4
  ├── slave_parallel_type = LOGICAL_CLOCK
  └── slave_preserve_commit_order = ON

✅ Laravel config/database.php
  ├── write → [Master IP]
  ├── read → [Slave 1, Slave 2]
  ├── sticky = true
  └── PDO::ATTR_PERSISTENT = false

✅ 监控
  ├── Seconds_Behind_Master ≤ 5s
  ├── Slave_IO_Running = Yes
  ├── Slave_SQL_Running = Yes
  └── Slack 告警 + Grafana 看板
```

### 6.2 黄金法则

1. **先单库优化，再读写分离**——索引、慢查询、缓存能解决的问题不要上读写分离
2. **ROW 格式 + GTID**——不要用 STATEMENT，不要手动指定 binlog position
3. **sticky = true 是底线**——Laravel 默认的 sticky 能解决大部分写后读一致性问题
4. **事务内强制主库**——任何 `lockForUpdate()` 或写后读场景都在事务内走主库
5. **专用报表从库**——OLTP 和 OLAP 必须隔离，不能共享从库
6. **监控延迟是生命线**——Seconds_Behind_Master > 5s 就要告警
7. **关闭持久连接**——PDO 持久连接会绕过读写分离逻辑
8. **定期校验主从一致性**——用 pt-table-checksum 或自研脚本

### 6.3 何时不应该用读写分离

- **读写比 < 3:1**：收益不大，增加运维复杂度
- **写操作要求强一致**：金融、支付场景的每笔写入都需要立即读到
- **团队没有 DBA**：主从复制的运维需要专人负责
- **还没有用好索引和缓存**：先把这些基础优化做完

---

> **最后的话**：读写分离不是银弹，它本质上是用**架构复杂度换性能**。在决定上之前，先确认索引、缓存、慢查询优化都已经做到位了。如果单库优化后还扛不住，读写分离就是性价比最高的第一步。

## 相关阅读

- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则](/databases/index-optimization-explain/)
- [pg_stat_statements + MySQL Performance Schema 实战：慢查询监控](/01_MySQL/2026-06-05-pg-stat-statements-MySQL-Performance-Schema-慢查询监控实战/)
- [数据归档策略：冷热数据分离与历史数据迁移](/01_MySQL/数据归档策略-冷热数据分离-历史数据迁移与查询兼容-Laravel-B2C-API踩坑记录/)
