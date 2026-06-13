---

title: SQLite WAL 模式深度实战：并发读写、检查点调优、读副本——边缘应用与嵌入式场景的工程化高可用方案
keywords: [SQLite WAL, 模式深度实战, 并发读写, 检查点调优, 读副本, 边缘应用与嵌入式场景的工程化高可用方案, 数据库]
date: 2026-06-10 07:53:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
- SQLite
- WAL
- 并发
- 数据库
- PHP
- Laravel
- 高可用
- 边缘计算
description: 深入解析 SQLite WAL 模式原理，覆盖并发读写机制、检查点策略调优、读副本配置，以及在 PHP/Laravel 项目中的工程化落地实践。
---



## 前言

SQLite 在很多人的印象里是「本地小工具用的数据库」，但在现代架构中，它的角色已经远不止于此。从边缘计算节点到嵌入式 IoT 设备，从本地优先应用到读密集型缓存层，SQLite 正在被越来越多的工程团队重新审视。

但默认的 SQLite 有一个严重问题：**写操作会阻塞所有读操作**。这在并发场景下几乎是致命的。

WAL（Write-Ahead Logging）模式彻底改变了这个局面。本文将从原理到实战，覆盖 WAL 模式的并发读写机制、检查点调优策略，以及如何在 PHP/Laravel 项目中正确使用它。

## 一、为什么需要 WAL 模式

### 1.1 默认日志模式的瓶颈

SQLite 默认使用 **Rollback Journal** 模式。它的写入流程是：

```
1. 读取原始数据到 rollback journal
2. 直接修改数据库文件
3. 出错时从 journal 回滚
```

问题在于：**步骤 2 会获取 EXCLUSIVE 锁**，此时所有读操作都被阻塞。对于读多写少的应用，这意味着一次写入可能导致数十个读请求排队等待。

### 1.2 WAL 模式的改进

WAL 模式将写入流程改为：

```
1. 将变更写入 WAL 文件（.db-wal）
2. 读操作从原始数据库文件 + WAL 文件的组合快照中读取
3. 定期将 WAL 中的变更合并回主数据库文件（checkpoint）
```

核心优势：

- **读写可以并发**：读操作不需要等待写操作完成
- **写入更快**：顺序写 WAL 文件比随机写数据库文件更高效
- **崩溃恢复更可靠**：WAL 文件是追加写入，恢复只需截断

### 1.3 性能对比

我用一个简单的基准测试来对比两种模式：

```php
<?php
// benchmark.php

function benchmark(string $mode, int $writeCount = 1000, int $readCount = 5000): void
{
    $dbFile = '/tmp/sqlite_bench_' . $mode . '.db';
    @unlink($dbFile);
    @unlink($dbFile . '-wal');
    @unlink($dbFile . '-shm');

    $pdo = new PDO("sqlite:{$dbFile}");
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    if ($mode === 'wal') {
        $pdo->exec('PRAGMA journal_mode=WAL');
    } else {
        $pdo->exec('PRAGMA journal_mode=DELETE');
    }

    $pdo->exec('CREATE TABLE bench (id INTEGER PRIMARY KEY, data TEXT, created_at INTEGER)');
    $pdo->exec('CREATE INDEX idx_created ON bench(created_at)');

    // 写入测试
    $start = microtime(true);
    $pdo->exec('BEGIN');
    for ($i = 0; $i < $writeCount; $i++) {
        $stmt = $pdo->prepare('INSERT INTO bench (data, created_at) VALUES (?, ?)');
        $stmt->execute([str_repeat('x', 200), time()]);
    }
    $pdo->exec('COMMIT');
    $writeTime = microtime(true) - $start;

    // 读取测试
    $start = microtime(true);
    for ($i = 0; $i < $readCount; $i++) {
        $stmt = $pdo->query('SELECT * FROM bench ORDER BY id DESC LIMIT 10');
        $stmt->fetchAll();
    }
    $readTime = microtime(true) - $start;

    echo strtoupper($mode) . " 模式:\n";
    echo "  写入 {$writeCount} 条: " . number_format($writeTime, 3) . "s\n";
    echo "  读取 {$readCount} 次: " . number_format($readTime, 3) . "s\n";
    echo "  总耗时: " . number_format($writeTime + $readTime, 3) . "s\n\n";

    $pdo = null;
}

benchmark('delete');
benchmark('wal');
```

典型结果（M2 MacBook Air）：

```
DELETE 模式:
  写入 1000 条: 0.089s
  读取 5000 次: 1.234s
  总耗时: 1.323s

WAL 模式:
  写入 1000 条: 0.062s
  读取 5000 次: 0.876s
  总耗时: 0.938s
```

WAL 模式在读取密集场景下快了约 **29%**，写入也快了约 **30%**。

## 二、WAL 模式核心原理

### 2.1 WAL 文件结构

WAL 文件由一系列 **WAL Frame** 组成：

```
[WAL Header][Frame 1][Frame 2][Frame 3]...[Frame N]
```

每个 Frame 包含：
- **Page Number**：对应的数据库页编号
- **Data**：该页的新内容
- **Checksum**：校验和

数据库文件 + WAL 文件中的所有 Frame = 当前完整的数据库状态。

### 2.2 读操作如何不被阻塞

SQLite 使用 **WAL Index**（存储在 `-shm` 文件中）来追踪 WAL 文件的状态。读操作的流程：

```
1. 获取 SHARED 锁（多个读操作可以同时持有）
2. 查看 WAL Index，确定需要读取哪些 Frame
3. 优先从 WAL 中读取最新的页，其余从数据库文件读取
4. 释放锁
```

关键点：**读操作只需要 SHARED 锁，不需要等待写操作释放 EXCLUSIVE 锁**。

### 2.3 写操作的锁机制

写操作的流程：

```
1. 获取 WRITE 锁（同一时间只有一个写操作）
2. 将变更追加写入 WAL 文件
3. 释放 WRITE 锁
```

写操作只在追加 WAL Frame 的短暂时间内持有锁，不会阻塞读操作。

### 2.4 检查点（Checkpoint）

检查点是将 WAL 文件中的变更合并回主数据库文件的过程：

```
1. 获取 WAL 的所有内容
2. 将这些页写回主数据库文件
3. 截断 WAL 文件（或标记为可重用）
```

检查点的类型：

| 类型 | 行为 |
|------|------|
| PASSIVE | 尽可能多地合并，不等待读者 |
| FULL | 等待所有读者完成后才继续 |
| RESTART | 类似 FULL，但完成后重置 WAL |
| TRUNCATE | 类似 RESTART，但截断 WAL 文件到 0 字节 |

## 三、检查点调优策略

### 3.1 自动检查点的默认行为

SQLite 默认在 WAL 文件达到 **1000 页**（约 4MB，取决于页大小）时自动触发 PASSIVE 检查点。这个默认值对大多数应用来说不够精细。

### 3.2 手动控制检查点

通过 `wal_autocheckpoint` PRAGMA 可以调整阈值：

```php
<?php
// 调整自动检查点阈值（单位：页）
// 0 表示禁用自动检查点
$pdo->exec('PRAGMA wal_autocheckpoint=0');

// 手动触发检查点
$pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
```

### 3.3 不同场景的调优策略

**场景一：写入密集型（日志收集器）**

```php
<?php
// 禁用自动检查点，避免频繁 I/O
$pdo->exec('PRAGMA wal_autocheckpoint=0');

// 在低峰时段手动触发
// 或者通过 cron 定时执行
function checkpointIfNeeded(PDO $pdo, string $dbPath): void
{
    $walSize = filesize($dbPath . '-wal');
    // WAL 文件超过 50MB 时触发
    if ($walSize > 50 * 1024 * 1024) {
        $pdo->exec('PRAGMA wal_checkpoint(PASSIVE)');
    }
}
```

**场景二：读写混合型（Web 应用）**

```php
<?php
// 设置较小的自动检查点阈值，保持 WAL 文件紧凑
$pdo->exec('PRAGMA wal_autocheckpoint=500');

// 在请求结束时尝试检查点（不阻塞）
register_shutdown_function(function () use ($pdo) {
    $pdo->exec('PRAGMA wal_checkpoint(PASSIVE)');
});
```

**场景三：边缘设备（IoT）**

```php
<?php
// 磁盘空间有限，使用 TRUNCATE 模式
$pdo->exec('PRAGMA wal_autocheckpoint=200');

// 每次写入后检查磁盘空间
function checkDiskAndCheckpoint(PDO $pdo, string $dir): void
{
    $free = disk_free_space($dir);
    $total = disk_total_space($dir);
    $usage = 1 - ($free / $total);

    if ($usage > 0.8) {
        $pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
}
```

### 3.4 检查点对性能的影响

检查点操作会短暂地获取 EXCLUSIVE 锁（在 PASSIVE 模式下，如果遇到活跃读者会跳过）。在高并发场景下，不当的检查点策略可能导致写入延迟。

最佳实践：

1. **读写分离应用**：使用 PASSIVE 模式，允许检查点跳过活跃读者
2. **批处理任务**：在任务开始前手动 TRUNCATE，确保干净的 WAL
3. **实时应用**：禁用自动检查点，在应用层控制时机

## 四、读副本配置

### 4.1 WAL 模式的只读副本

SQLite 支持通过 WAL 模式实现**只读副本**。原理是：

1. 主实例负责所有写入
2. 只读实例从 WAL 文件中读取数据
3. 多个只读实例可以并发读取

```php
<?php
// 主实例（可读写）
$mainDb = new PDO('sqlite:/data/app.db');
$mainDb->exec('PRAGMA journal_mode=WAL');
$mainDb->exec('PRAGMA busy_timeout=5000');

// 只读副本
// 关键：使用 immutable=1 告诉 SQLite 不要尝试修改文件
$readOnlyDb = new PDO('sqlite:/data/app.db?mode=ro&immutable=1');
$readOnlyDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
```

### 4.2 使用 URI 文件名实现读写分离

```php
<?php
class SqliteConnectionPool
{
    private PDO $writer;
    private array $readers = [];
    private string $dbPath;

    public function __construct(string $dbPath)
    {
        $this->dbPath = $dbPath;

        // 主写入连接
        $this->writer = new PDO("sqlite:{$dbPath}");
        $this->writer->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->writer->exec('PRAGMA journal_mode=WAL');
        $this->writer->exec('PRAGMA busy_timeout=5000');
        $this->writer->exec('PRAGMA synchronous=NORMAL');
    }

    public function writer(): PDO
    {
        return $this->writer;
    }

    public function reader(): PDO
    {
        // 懒加载读连接池
        $key = spl_object_id(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 1)[0]['object'] ?? new stdClass());

        if (!isset($this->readers[$key])) {
            $reader = new PDO("sqlite:file:{$this->dbPath}?mode=ro&immutable=1", '', '', [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            ]);
            $this->readers[$key] = $reader;
        }

        return $this->readers[$key];
    }
}

// 使用
$pool = new SqliteConnectionPool('/data/app.db');

// 写操作
$stmt = $pool->writer()->prepare('INSERT INTO logs (message) VALUES (?)');
$stmt->execute(['User logged in']);

// 读操作（只读副本）
$stmt = $pool->reader()->query('SELECT * FROM logs ORDER BY id DESC LIMIT 20');
$logs = $stmt->fetchAll();
```

### 4.3 文件系统级别的副本

在某些场景下（如主从部署），你可能需要将 WAL 文件复制到其他节点：

```bash
#!/bin/bash
# sync-wal.sh - 将 WAL 文件同步到只读节点

DB_PATH="/data/app.db"
REMOTE_HOST="reader-01"
REMOTE_PATH="/data/"

# 使用 rsync 增量同步 WAL 文件
# 只有 WAL 文件变化部分会被传输
rsync -avz --partial \
    "${DB_PATH}-wal" \
    "${DB_PATH}-shm" \
    "${DB_PATH}" \
    "${REMOTE_HOST}:${REMOTE_PATH}"

# 在远程节点触发检查点
ssh "${REMOTE_HOST}" "sqlite3 ${REMOTE_PATH}/app.db 'PRAGMA wal_checkpoint(TRUNCATE);'"
```

⚠️ **重要限制**：这种方式要求所有节点的 SQLite 版本和页大小一致，且同步期间不能有写入。

## 五、Laravel 集成实践

### 5.1 配置 Laravel 使用 SQLite WAL

```php
// config/database.php

'connections' => [
    'sqlite' => [
        'driver' => 'sqlite',
        'url' => env('DB_URL'),
        'database' => env('DB_DATABASE', database_path('database.sqlite')),
        'prefix' => '',
        'foreign_key_constraints' => env('DB_FOREIGN_KEYS', true),
        'options' => [
            // WAL 模式通过 event callback 设置
        ],
    ],

    'sqlite_wal' => [
        'driver' => 'sqlite',
        'database' => env('SQLITE_WAL_DATABASE', database_path('app_wal.sqlite')),
        'prefix' => '',
        'foreign_key_constraints' => true,
    ],
],
```

### 5.2 通过 ServiceProvider 设置 WAL

```php
<?php
// app/Providers/SqliteServiceProvider.php

namespace App\Providers;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;

class SqliteServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 每次连接建立时设置 WAL 模式
        DB::connection('sqlite_wal')->getPdo()->exec('PRAGMA journal_mode=WAL');
        DB::connection('sqlite_wal')->getPdo()->exec('PRAGMA busy_timeout=5000');
        DB::connection('sqlite_wal')->getPdo()->exec('PRAGMA synchronous=NORMAL');
        DB::connection('sqlite_wal')->getPdo()->exec('PRAGMA wal_autocheckpoint=500');
    }
}
```

更优雅的方式是使用 `Connection` 的事件：

```php
<?php
// app/Providers/SqliteServiceProvider.php

namespace App\Providers;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;

class SqliteServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 监听连接建立事件
        $this->app['events']->listen(function ($event) {
            if (!property_exists($event, 'connection')) {
                return;
            }

            $connection = $event->connection;
            if ($connection->getDriverName() !== 'sqlite') {
                return;
            }

            $pdo = $connection->getPdo();
            $pdo->exec('PRAGMA journal_mode=WAL');
            $pdo->exec('PRAGMA busy_timeout=5000');
            $pdo->exec('PRAGMA synchronous=NORMAL');
            $pdo->exec('PRAGMA cache_size=-64000'); // 64MB 缓存
        });
    }
}
```

### 5.3 读写分离中间件

```php
<?php
// app/Http/Middleware/SqliteReadWriteSplit.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SqliteReadWriteSplit
{
    public function handle(Request $request, Closure $next)
    {
        // GET 请求使用只读连接
        if ($request->isMethod('GET')) {
            DB::setDefaultConnection('sqlite_ro');
        } else {
            DB::setDefaultConnection('sqlite_wal');
        }

        return $next($request);
    }
}
```

### 5.4 定期检查点命令

```php
<?php
// app/Console/Commands/SqliteCheckpoint.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SqliteCheckpoint extends Command
{
    protected $signature = 'sqlite:checkpoint
        {--mode=PASSIVE : Checkpoint mode (PASSIVE, FULL, RESTART, TRUNCATE)}
        {--connection=sqlite_wal : Database connection name}';

    protected $description = 'Run SQLite WAL checkpoint';

    public function handle(): int
    {
        $mode = $this->option('mode');
        $connection = $this->option('connection');

        $validModes = ['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'];
        if (!in_array($mode, $validModes)) {
            $this->error("Invalid mode: {$mode}. Valid: " . implode(', ', $validModes));
            return 1;
        }

        $pdo = DB::connection($connection)->getPdo();

        // 获取 WAL 文件大小（检查点前）
        $walPath = DB::connection($connection)->getDatabaseName() . '-wal';
        $walSizeBefore = file_exists($walPath) ? filesize($walPath) : 0;

        $this->info("Running checkpoint (mode: {$mode})...");
        $this->info("WAL size before: " . $this->formatBytes($walSizeBefore));

        $start = microtime(true);
        $result = $pdo->query("PRAGMA wal_checkpoint({$mode})")->fetch();
        $elapsed = microtime(true) - $start;

        $this->info("Checkpoint completed in " . number_format($elapsed, 3) . "s");
        $this->table(
            ['busy', 'log', 'checkpointed', 'wal'],
            [[$result[0], $result[1], $result[2], $result[3]]]
        );

        $walSizeAfter = file_exists($walPath) ? filesize($walPath) : 0;
        $this->info("WAL size after: " . $this->formatBytes($walSizeAfter));
        $this->info("Freed: " . $this->formatBytes($walSizeBefore - $walSizeAfter));

        return 0;
    }

    private function formatBytes(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . ' ' . $units[$i];
    }
}
```

注册为定时任务：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每 6 小时执行一次检查点
    $schedule->command('sqlite:checkpoint --mode=TRUNCATE')
        ->cron('0 */6 * * *')
        ->withoutOverlapping();
}
```

## 六、踩坑记录

### 6.1 `-shm` 文件缺失导致锁错误

**现象**：

```
SQLSTATE[HY000]: General error: 5 database is locked
```

**原因**：WAL 模式需要 `-shm`（共享内存）文件来协调并发访问。如果文件被删除或损坏，SQLite 无法正常工作。

**解决**：

```bash
# 确保数据库目录有正确的权限
chmod 755 /data/

# 如果 -shm 文件损坏，删除后重建
rm /data/app.db-shm
# 下次打开数据库时会自动重建
```

### 6.2 NFS 上的 WAL 模式

**现象**：在 NFS 挂载的目录上使用 WAL 模式，频繁出现锁竞争或数据损坏。

**原因**：WAL 模式依赖 POSIX 文件锁和 `mmap()`，NFS 的锁实现在某些情况下不可靠。

**解决**：

```php
<?php
// 方案一：使用 DELETE 模式（在 NFS 上更可靠）
$pdo->exec('PRAGMA journal_mode=DELETE');

// 方案二：使用共享内存映射到本地磁盘
$pdo->exec('PRAGMA journal_mode=WAL');
$pdo->exec('PRAGMA wal_index=memory'); // 不创建 -shm 文件
// 注意：这会导致并发写入不安全

// 方案三：使用 tmpfs 存储数据库
$dbPath = '/dev/shm/app.db'; // 内存文件系统
```

### 6.3 `busy_timeout` 设置不当

**现象**：

```
SQLSTATE[HY000]: General error: 5 database is locked
```

**原因**：默认的 `busy_timeout` 是 0，即获取不到锁立即失败。

**解决**：

```php
<?php
// 设置合理的 busy_timeout（单位：毫秒）
$pdo->exec('PRAGMA busy_timeout=5000'); // 等待 5 秒

// 在 Laravel 中设置
// config/database.php
'sqlite' => [
    'driver' => 'sqlite',
    'database' => database_path('app.sqlite'),
    'options' => [
        // PDO 没有直接的 busy_timeout 选项
        // 需要在连接后通过 PRAGMA 设置
    ],
],
```

### 6.4 WAL 文件无限增长

**现象**：WAL 文件持续增长，占用大量磁盘空间。

**原因**：检查点没有正常执行，可能是：
- 长时间运行的读事务阻止了检查点
- 自动检查点被禁用但没有手动触发
- 应用崩溃导致 WAL 文件未被清理

**解决**：

```php
<?php
// 监控 WAL 文件大小
function monitorWalSize(string $dbPath, int $maxSizeMB = 100): void
{
    $walPath = $dbPath . '-wal';
    if (!file_exists($walPath)) {
        return;
    }

    $size = filesize($walPath);
    if ($size > $maxSizeMB * 1024 * 1024) {
        // 记录告警
        error_log("WAL file too large: " . round($size / 1024 / 1024, 2) . "MB");

        // 尝试检查点
        $pdo = new PDO("sqlite:{$dbPath}");
        $pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
}
```

### 6.5 多进程并发写入

**现象**：多个进程同时写入时，部分写入丢失或出现 `database is locked`。

**原因**：SQLite 的写锁是数据库级别的，同一时间只能有一个写操作。

**解决**：

```php
<?php
// 使用文件锁确保写入串行化
function writeWithLock(PDO $pdo, string $sql, array $params = []): bool
{
    $lockFile = $pdo->query('PRAGMA database_list')->fetch()['file'] . '.lock';
    $lock = fopen($lockFile, 'c');

    if (!flock($lock, LOCK_EX)) {
        throw new \RuntimeException('Could not acquire write lock');
    }

    try {
        $stmt = $pdo->prepare($sql);
        return $stmt->execute($params);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
```

## 七、最佳实践总结

### 7.1 配置清单

```sql
-- 必须设置
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

-- 推荐设置
PRAGMA synchronous=NORMAL;          -- WAL 模式下 NORMAL 足够安全
PRAGMA cache_size=-64000;           -- 64MB 缓存
PRAGMA wal_autocheckpoint=500;      -- 500 页触发检查点
PRAGMA foreign_keys=ON;             -- 启用外键约束

-- 可选设置
PRAGMA temp_store=MEMORY;           -- 临时表存储在内存
PRAGMA mmap_size=268435456;         -- 256MB 内存映射
```

### 7.2 监控指标

```php
<?php
function getSqliteStats(PDO $pdo): array
{
    $result = [];

    // WAL 文件信息
    $walCheckpoint = $pdo->query('PRAGMA wal_checkpoint')->fetch();
    $result['wal_busy'] = $walCheckpoint[0];
    $result['wal_log'] = $walCheckpoint[1];
    $result['wal_checkpointed'] = $walCheckpoint[2];

    // 缓存命中率
    $cacheStats = $pdo->query('PRAGMA cache_stats')->fetch();
    $result['cache_hit'] = $cacheStats[0] ?? null;
    $result['cache_miss'] = $cacheStats[1] ?? null;

    // 数据库大小
    $pageCount = $pdo->query('PRAGMA page_count')->fetchColumn();
    $pageSize = $pdo->query('PRAGMA page_size')->fetchColumn();
    $result['db_size_mb'] = round($pageCount * $pageSize / 1024 / 1024, 2);

    return $result;
}
```

### 7.3 什么时候不该用 WAL

WAL 模式并非万能。以下场景建议使用默认的 DELETE 模式：

1. **NFS/网络文件系统**：锁机制不可靠
2. **只读数据库**：WAL 的优势在于写入，只读场景没有收益
3. **频繁的全表更新**：WAL 文件会快速膨胀
4. **需要绝对的 ACID 保证**：WAL 模式在某些极端崩溃情况下可能丢失最后几个事务

## 八、实战：构建本地优先应用

### 8.1 架构设计

```
┌─────────────────────────────────────┐
│           Web Application           │
├─────────────────────────────────────┤
│  ┌──────────┐    ┌──────────────┐  │
│  │  Writer   │    │   Reader(s)  │  │
│  │  (SQLite) │    │   (SQLite)   │  │
│  └─────┬────┘    └──────┬───────┘  │
│        │                │           │
│        ▼                ▼           │
│  ┌─────────────────────────────┐   │
│  │      SQLite Database         │   │
│  │      (WAL Mode)              │   │
│  └─────────────────────────────┘   │
│              │                      │
│              ▼                      │
│  ┌─────────────────────────────┐   │
│  │   Background Sync Service    │   │
│  │   (Cloudflare D1 / R2)      │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 8.2 完整的 SQLite 管理器

```php
<?php

namespace App\Services;

class SqliteManager
{
    private static array $connections = [];

    public static function getConnection(
        string $name = 'default',
        string $mode = 'readwrite'
    ): \PDO {
        $key = "{$name}:{$mode}";

        if (isset(self::$connections[$key])) {
            return self::$connections[$key];
        }

        $path = config("sqlite.databases.{$name}");

        if ($mode === 'readonly') {
            $dsn = "sqlite:file:{$path}?mode=ro&immutable=1";
        } else {
            $dsn = "sqlite:{$path}";
        }

        $pdo = new \PDO($dsn, '', '', [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);

        if ($mode === 'readwrite') {
            $pdo->exec('PRAGMA journal_mode=WAL');
            $pdo->exec('PRAGMA busy_timeout=5000');
            $pdo->exec('PRAGMA synchronous=NORMAL');
            $pdo->exec('PRAGMA cache_size=-64000');
            $pdo->exec('PRAGMA foreign_keys=ON');
        }

        self::$connections[$key] = $pdo;
        return $pdo;
    }

    public static function checkpoint(string $database = 'default', string $mode = 'PASSIVE'): array
    {
        $pdo = self::getConnection($database);
        $result = $pdo->query("PRAGMA wal_checkpoint({$mode})")->fetch();

        return [
            'busy' => $result[0],
            'log' => $result[1],
            'checkpointed' => $result[2],
        ];
    }

    public static function getStats(string $database = 'default'): array
    {
        $pdo = self::getConnection($database);

        $pageCount = (int) $pdo->query('PRAGMA page_count')->fetchColumn();
        $pageSize = (int) $pdo->query('PRAGMA page_size')->fetchColumn();
        $walMode = $pdo->query('PRAGMA journal_mode')->fetchColumn();

        $walPath = config("sqlite.databases.{$database}") . '-wal';
        $walSize = file_exists($walPath) ? filesize($walPath) : 0;

        return [
            'database_size' => $this->formatBytes($pageCount * $pageSize),
            'wal_size' => $this->formatBytes($walSize),
            'journal_mode' => $walMode,
            'page_count' => $pageCount,
            'page_size' => $pageSize,
        ];
    }

    private function formatBytes(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . ' ' . $units[$i];
    }
}
```

## 总结

SQLite WAL 模式是将 SQLite 从「单机小工具」提升为「可靠的本地数据库引擎」的关键特性。通过正确配置 WAL 模式，你可以获得：

- **读写并发**：读操作不再被写操作阻塞
- **更好的写入性能**：顺序写入比随机写入快
- **崩溃恢复**：WAL 模式比传统日志模式更可靠

关键要点：

1. **始终设置 `busy_timeout`**：默认的 0 会导致锁错误
2. **选择合适的检查点策略**：根据写入频率和数据一致性需求调整
3. **监控 WAL 文件大小**：防止无限增长
4. **避免在 NFS 上使用 WAL**：文件锁机制不可靠
5. **使用 `synchronous=NORMAL`**：在 WAL 模式下足够安全，性能更好

SQLite 可能不是所有场景的最佳选择，但在边缘计算、嵌入式系统、本地优先应用等场景下，配合 WAL 模式，它是一个非常可靠的工程方案。
