---

title: Laravel + PostgreSQL Advisory Lock 实战：补偿扫描单实例化、会话级互斥与 PgBouncer 踩坑记录
keywords: [Laravel, PostgreSQL Advisory Lock, PgBouncer, 补偿扫描单实例化, 会话级互斥与, 踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 15:51:30
updated: 2026-06-06 10:00:00
categories:
- php
- database
tags:
- Laravel
- PostgreSQL
- PgBouncer
- Advisory Lock
- 分布式
description: Laravel + PostgreSQL Advisory Lock 实战：补偿扫描单实例化、会话级互斥与 PgBouncer 踩坑记录。解决多 Pod 重复扫单、连接池模式不兼容、异常退出锁释放问题。
---


我们有一类任务很典型：每分钟扫描一次"待补偿订单"，把超时未支付、库存待回收、第三方回调缺失的单子重新推到队列。业务上它不是高吞吐消费，更像**一个必须全局单实例执行的扫描器**。最早我用过 `withoutOverlapping()`、Redis 锁，最后都在多 Pod + Horizon + PgBouncer 的组合下踩过坑：要么锁漂移，要么进程异常后锁残留认知混乱，要么不同入口各扫各的，结果同一批订单被重复补偿。

后来我把这类任务改成 **PostgreSQL Advisory Lock**。原因很现实：数据本来就在 PostgreSQL，互斥点也只和数据库里的那批订单有关，用数据库自带锁把"谁有资格扫"收口，排障反而更直接。

## 一、最终落地的结构

```text
K8s CronJob / schedule:work / 手工补跑
                |
                v
      Laravel Compensation Command
                |
      pg_try_advisory_lock(42100, 7)
           |           |
         成功         失败
           |           |
           v           v
   扫描 compensation_jobs   直接退出并打点
           |
           v
   dispatch(new RepairOrderJob(...))
           |
           v
   finally 中执行 pg_advisory_unlock
```

这里我故意把锁放在"扫描入口"，而不是每条订单上锁。因为我的目标不是解决明细竞争，而是防止**两个扫描器同时把同一批待处理记录重复发出去**。

## 二、Laravel 里怎么封装这把锁

我没有直接把 SQL 散在命令里，而是做成一个很薄的服务，统一走专用连接：

```php
<?php

namespace App\Infrastructure\Lock;

use Illuminate\Support\Facades\DB;

final class PgAdvisoryLock
{
    public function acquire(int $classId, int $objectId, string $connection = 'pgsql_lock'): bool
    {
        $row = DB::connection($connection)->selectOne(
            'select pg_try_advisory_lock(?, ?) as locked',
            [$classId, $objectId]
        );

        return (bool) ($row->locked ?? false);
    }

    public function release(int $classId, int $objectId, string $connection = 'pgsql_lock'): void
    {
        DB::connection($connection)->selectOne(
            'select pg_advisory_unlock(?, ?)',
            [$classId, $objectId]
        );
    }

    /**
     * 阻塞式获取锁，会一直等到锁可用
     */
    public function acquireBlocking(int $classId, int $objectId, string $connection = 'pgsql_lock'): bool
    {
        $row = DB::connection($connection)->selectOne(
            'select pg_advisory_lock(?, ?) as locked',
            [$classId, $objectId]
        );

        return (bool) ($row->locked ?? true);
    }

    /**
     * 检查锁是否被持有（不抢锁）
     */
    public function isHeld(int $classId, int $objectId, string $connection = 'pgsql_lock'): bool
    {
        $row = DB::connection($connection)->selectOne(
            'select pg_locks.locked from pg_locks
             where locktype = ? and classid = ? and objid = ?',
            ['advisory', $classId, $objectId]
        );

        return (bool) ($row->locked ?? false);
    }
}
```

命令入口只做三件事：抢锁、扫描、在 `finally` 里释放锁。

```php
<?php

namespace App\Console\Commands;

use App\Infrastructure\Lock\PgAdvisoryLock;
use App\Jobs\RepairOrderJob;
use App\Models\CompensationJob;
use Illuminate\Console\Command;

final class ScanCompensationJobsCommand extends Command
{
    protected $signature = 'orders:scan-compensation';

    public function handle(PgAdvisoryLock $lock): int
    {
        $classId = 42100;
        $objectId = 7;

        if (! $lock->acquire($classId, $objectId)) {
            $this->info('scanner skipped: lock not acquired');
            return self::SUCCESS;
        }

        try {
            CompensationJob::query()
                ->where('status', 'pending')
                ->where('next_run_at', '<=', now())
                ->orderBy('id')
                ->limit(200)
                ->get()
                ->each(fn (CompensationJob $job) => RepairOrderJob::dispatch($job->id));

            return self::SUCCESS;
        } finally {
            $lock->release($classId, $objectId);
        }
    }
}
```

`pgsql_lock` 这条连接我会单独配置，不和业务查询混用：

```php
'pgsql_lock' => [
    'driver' => 'pgsql',
    'host' => env('DB_HOST'),
    'port' => env('DB_PORT', 5432),
    'database' => env('DB_DATABASE'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    'charset' => 'utf8',
    'prefix' => '',
    'options' => extension_loaded('pdo_pgsql') ? [
        PDO::ATTR_EMULATE_PREPARES => false,
    ] : [],
],
```

## 三、更高级的封装：Trait 和中间件模式

在实际项目里，不是每个命令都需要手写加锁/释放逻辑。我们可以把锁逻辑封装成一个 Laravel Trait，让任何 Command 都能一行接入：

```php
<?php

namespace App\Traits;

use App\Infrastructure\Lock\PgAdvisoryLock;
use Closure;

trait WithAdvisoryLock
{
    protected function withAdvisoryLock(
        int $classId,
        int $objectId,
        Closure $callback,
        ?PgAdvisoryLock $lock = null
    ): mixed {
        $lock = $lock ?? app(PgAdvisoryLock::class);

        if (! $lock->acquire($classId, $objectId)) {
            $this->warn("Lock [{$classId}, {$objectId}] not acquired, skipping.");
            return null;
        }

        try {
            return $callback();
        } finally {
            $lock->release($classId, $objectId);
        }
    }
}
```

使用时非常简洁：

```php
class ScanCompensationJobsCommand extends Command
{
    use WithAdvisoryLock;

    protected $signature = 'orders:scan-compensation';

    public function handle(): int
    {
        $this->withAdvisoryLock(42100, 7, function () {
            CompensationJob::where('status', 'pending')
                ->where('next_run_at', '<=', now())
                ->limit(200)
                ->each(fn ($job) => RepairOrderJob::dispatch($job->id));

            return self::SUCCESS;
        });

        return self::SUCCESS;
    }
}
```

这种封装的好处是：锁的获取和释放被框架强制约束在 `finally` 里，团队里不太容易写漏。

## 四、PgBouncer 连接池模式详解：为什么锁会失效

PgBouncer 是 PostgreSQL 最常用的连接池工具，它有三种工作模式，对 Advisory Lock 的行为有本质区别：

### Transaction 模式

每个事务拿到一条物理连接，事务结束就归还。这是 PgBouncer 最常用的模式，**但它会杀死 Advisory Lock**。

```text
-- Transaction 模式下的时序
Client A: BEGIN → 拿到物理连接 #1 → pg_advisory_lock(42100, 7) → OK
Client A: 执行业务 SQL → COMMIT
Client A: pg_advisory_unlock(42100, 7) → 可能拿到的是连接 #3，锁已经没了
```

核心问题是：`pg_try_advisory_lock` 是**会话级锁**，连接池在事务结束后可能把你的连接换成另一个。此时你以为锁还在，其实早已释放。

### Session 模式

一个客户端独占一条物理连接，直到客户端断开。这是 Advisory Lock 的安全模式：

```text
-- Session 模式下的时序
Client A: 连接 → 拿到物理连接 #1 → pg_advisory_lock(42100, 7) → OK
Client A: 执行所有 SQL（扫描、分发、解锁） → 断开
Client A: 物理连接 #1 归还池，锁自动释放
```

但 Session 模式的代价是连接池退化为"长连接"，并发能力受限。

### Statement 模式

每条 SQL 拿一条物理连接。完全不兼容 Advisory Lock，因为一条 SQL 结束连接就归还了，下一条 SQL 在不同会话上执行。

### 三种模式对比

| 模式 | Advisory Lock | 连接复用率 | 适用场景 |
|------|--------------|-----------|---------|
| Transaction | ❌ 不兼容 | 高 | 高并发 Web 请求 |
| Session | ✅ 安全 | 低 | 后台任务、长事务 |
| Statement | ❌ 完全不兼容 | 最高 | 简单只读查询 |

我的做法：锁连接单独配置为 **直连 PostgreSQL**（不走 PgBouncer），或者走 PgBouncer 的 **Session 模式**。在 `config/database.php` 里，`pgsql_lock` 连接配置里加一个环境变量控制：

```php
'pgsql_lock' => [
    'driver' => 'pgsql',
    'host' => env('DB_LOCK_HOST', env('DB_HOST')),  // 锁专用直连
    'port' => env('DB_LOCK_PORT', '5432'),
    // ...
],
```

在生产环境里，`DB_LOCK_HOST` 指向 PostgreSQL 的直连地址（绕过 PgBouncer），而 `DB_HOST` 走 PgBouncer。这样 Web 请求的高并发连接复用不受影响，后台任务的锁也不受影响。

## 五、为什么这次不用 Redis 锁

不是 Redis 不行，而是这类"数据库内扫描任务"更适合贴着数据源做互斥：

1. 锁和数据在同一系统里，排查时不用跨两套基础设施。
2. PostgreSQL 会在**会话断开时自动释放 session lock**，不用自己补 TTL 续约。
3. 这类任务追求的是"同一时刻只有一个扫描器"，不是毫秒级高并发抢占。

我自己的经验是：**如果锁的保护对象就在 PostgreSQL 里，而且任务入口很少，Advisory Lock 比额外引入一层 Redis 心智负担更低。**

## 六、线上真正踩过的坑

### 1. Advisory Lock vs 行级锁：它们解决的问题完全不同

很多开发者第一次接触 Advisory Lock 时会困惑：PostgreSQL 不是已经有 `SELECT ... FOR UPDATE` 行级锁了吗？为什么还需要 Advisory Lock？答案是：**它们解决的不是同一个问题**。

行级锁（`SELECT ... FOR UPDATE`）是数据行级别的互斥，保护的是"对某一行的并发修改"。比如两个用户同时修改同一个订单的状态，行级锁能保证一个先改完另一个才能改。但行级锁有一个前提：你必须先 `SELECT` 到那行数据，锁才生效。如果你的任务是"扫描所有待处理订单"，你还没扫之前，别人已经扫走了——行级锁保护不了。

Advisory Lock 是**会话级别的互斥**，它不保护任何特定数据行，而是保护"一个逻辑操作只能有一个执行者"。比如"同一时刻只有一个扫描器在跑"，这种需求用行级锁根本做不到，因为行级锁的粒度太细了。

简单总结：
- **行级锁**：保护"对某行数据的并发修改"——悲观锁
- **Advisory Lock**：保护"一个逻辑操作的单实例执行"——进程级互斥

如果你的任务是"扣减库存"，用行级锁。如果你的任务是"每天凌晨跑一次报表"，用 Advisory Lock。

### 2. PgBouncer 开了 transaction pooling，锁看起来成功却马上失效


这是最坑的一次。`pg_try_advisory_lock` 是**会话级锁**，如果连接池是 transaction pooling，请求结束连接就被归还，下一条 SQL 可能已经不是同一个 session，锁等于白加。后来我的做法很明确：**锁连接必须走 session pooling 或直连 PostgreSQL**。

### 2. 抢锁后又切连接，释放锁失败

有同事把扫描 SQL 也写在默认连接里，而解锁走的是锁连接，最后 release 打到了不同 session。解决办法只有一个：**加锁和解锁必须绑定同一条连接名**，不要在中途 `purge` 或重连。

### 3. 以为拿到扫描锁就不会重复发 Job

错。扫描器单实例，只能保证"同一批记录不会被两台机器同时扫"；**不能保证下游 Job 天然幂等**。我们后面仍然给 `repair_order_jobs` 做了唯一键和状态流转校验，否则补偿任务重试时还是会重复处理。

### 4. 连接池耗尽导致锁超时

当 PgBouncer 的 `pool_size` 不够大时，锁连接可能排队等待。如果扫描命令在 5 秒内拿不到连接，命令就会超时退出，但锁其实还没获取。这时要配合 PgBouncer 的 `query_wait_timeout` 和 Laravel 的 `DB_TIMEOUT` 一起调：

```php
// 在 config/database.php 中
'pgsql_lock' => [
    'options' => [
        PDO::ATTR_TIMEOUT => 5,  // 等待连接超时（秒）
    ],
],
```

### 5. 长事务持有锁导致后续请求堆积

如果持有 Advisory Lock 的进程卡在慢查询里，锁不会自动释放（PostgreSQL 不做锁超时），导致后续所有请求都拿不到锁。生产中必须加监控告警：

```sql
-- 查看 Advisory Lock 持有时长
SELECT
    a.pid,
    a.application_name,
    a.query,
    now() - a.state_change AS hold_duration,
    l.classid,
    l.objid
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory'
  AND a.state = 'active'
  AND a.query_start < now() - INTERVAL '30 seconds';
```

超过 30 秒还在持有锁的进程，应该触发告警。如果进程已经僵死但连接没断（例如 PHP-FPM worker 卡住），需要主动 `pg_terminate_backend(pid)`。

### 6. 连接复用导致锁"幽灵持有"

Laravel 的 `DB::purge()` 或 `DB::reconnect()` 可能导致连接对象与底层 PDO 连接不一致。如果你在抢锁后调用了 `purge()`，虽然 PHP 对象还在，但底层连接已经被放回池里，`release` 可能释放的是别人的锁。**规则：抢锁和解锁之间，绝对不要调用 purge/reconnect。**

## 七、session lock 和 transaction lock，我为什么选前者

PostgreSQL 其实还有 `pg_try_advisory_xact_lock`，它会在事务结束时自动释放。很多人第一眼会觉得这个更安全，但在"扫描 + 分发任务"的场景里，我还是更常用 session lock，原因有两个：

1. 扫描逻辑不一定包在一个长事务里，我不希望为了持锁把整个扫描阶段都绑成事务。
2. Laravel 里一旦混入事件、队列分发、只读查询，事务边界很容易被改得和预期不一样。

我的选择标准很简单：

- **事务内极短临界区**：优先 `pg_try_advisory_xact_lock`
- **命令级单实例互斥**：优先 `pg_try_advisory_lock`

别反过来用。曾经有人把 session lock 用在细粒度库存扣减里，结果 worker 异常时整批请求排队；也有人把 xact lock 用在扫描命令里，事务一提交锁就提前释放，后半段分发逻辑直接失去保护。

## 八、Advisory Lock vs Redis Lock vs withoutOverlapping() 对比

| 特性 | PostgreSQL Advisory Lock | Redis 分布式锁 | Laravel withoutOverlapping() |
|------|------------------------|---------------|---------------------------|
| 依赖组件 | 仅 PostgreSQL | 需要 Redis 集群 | 仅 Laravel（文件锁） |
| 锁生命周期 | 绑定数据库连接 | TTL + 自动续约 | 文件锁 |
| 异常释放 | 连接断开即释放 | 需手动续期，否则 TTL 到期释放 | 进程退出释放 |
| 可观测性 | pg_locks 视图直接查 | 需要 Redis CLI 查看 | 需要查看文件系统 |
| 跨语言支持 | ✅ PostgreSQL 原生支持 | ✅ Redis 原生支持 | ❌ 仅限 PHP |
| 高并发抢占 | 适合（低频） | 适合（高频） | 不适合（文件锁性能差） |
| 配合 PgBouncer | 需 Session 模式或直连 | 无影响 | 无影响 |
| 排障复杂度 | 低（SQL 直接查） | 中（需要 Redis 监控） | 高（需要查文件系统） |
| 适用场景 | 数据库内扫描任务 | 跨服务通用互斥 | 简单单进程定时任务 |

## 九、最佳实践与常见错误

Advisory Lock 用起来简单，但要稳定地用在生产环境，有几个必须建立的规范：

### 1. 锁 ID 的选择与命名规范

Advisory Lock 的 ID 是一个 `bigint`（8 字节），你需要自己决定用什么数字。没有命名机制，全靠约定。如果团队里有多个使用 Advisory Lock 的场景，很容易撞 ID。

我的命名规范是：**前 4 位是业务域编号，后 4 位是场景编号**。比如：

```text
42100  →  补偿扫描（42 = 业务域，100 = 补偿扫描场景）
42200  →  数据归档
42300  →  报表聚合
42400  →  库存同步
50001  →  另一个业务域的第一个场景
```

我会把这些 ID 维护在代码里的常量类中，避免硬编码散落各处：

```php
<?php

namespace App\Enums;

enum AdvisoryLockId: int
{
    case COMPENSATION_SCAN = 42100;
    case ORDER_ARCHIVE    = 42200;
    case DAILY_REPORT     = 42300;
    case INVENTORY_SYNC   = 42400;
}
```

使用时：

```php
$lock->acquire(AdvisoryLockId::COMPENSATION_SCAN->value, 7);
```

这样做的好处是：一眼就能看出这个 ID 对应什么场景，不会和其他同事的锁撞上。

### 2. Advisory Lock 与数据库连接绑定的完整生命周期

理解 Advisory Lock 的生命周期非常重要。它是**绑定在数据库连接上的**，不是绑定在 PHP 进程上的：

```text
PHP 进程 A 拿到 PDO 连接 #1
  → 执行 pg_try_advisory_lock(42100, 7) → 成功
  → 执行扫描 SQL
  → Laravel 框架触发 DB::purge()（比如在命令结束后）
  → PDO 连接 #1 被关闭/放回池
  → Advisory Lock 自动释放（因为 session 断了）
```

这意味着：**只要连接断了，锁就释放了。** 这是 Advisory Lock 相比 Redis 锁最大的优势之一——不需要写续期逻辑，不需要担心进程异常退出后锁残留。但这也意味着：如果你的连接是通过 PgBouncer 管理的，且 PgBouncer 在事务结束后归还连接，锁会在你不知情的情况下被释放。

### 3. 常见错误：在 `try` 中加锁但在 `catch` 中释放

这是一个很隐蔽的 bug：

```php
// ❌ 错误写法
try {
    $lock->acquire($classId, $objectId);
    // 扫描逻辑...
} catch (\Exception $e) {
    $lock->release($classId, $objectId);  // 只在异常时释放
    throw $e;
}
// 正常路径没有释放锁！
```

正确写法必须用 `finally`：

```php
// ✅ 正确写法
if (! $lock->acquire($classId, $objectId)) {
    return self::SUCCESS;
}
try {
    // 扫描逻辑...
} finally {
    $lock->release($classId, $objectId);  // 无论成功失败都释放
}
```

或者用前面介绍的 `withAdvisoryLock()` Trait，它在内部已经处理了这个问题。

### 4. 多锁 ID 场景：保护不同的逻辑入口

有时候你需要用 Advisory Lock 保护多个不同的操作，但它们各自需要独立的锁。比如"扫描"和"清理"是两个不同的操作，可以同时跑，但每个操作自己需要单实例：

```php
// 扫描命令
$lock->acquire(AdvisoryLockId::COMPENSATION_SCAN->value, 7);
// 清理命令
$lock->acquire(AdvisoryLockId::ORDER_ARCHIVE->value, 7);
```

它们使用不同的 ID，所以不会互相阻塞。但如果你用同一个 ID 的不同 objectId（比如一个用 7，一个用 8），它们仍然是独立的锁——PostgreSQL 会把 `(classid, objid)` 作为锁的唯一标识。

## 十、更多真实场景


每天凌晨跑一次数据归档，把 90 天前的订单迁移到历史表。多 Pod 同时跑会重复迁移：

```php
class ArchiveOldOrdersCommand extends Command
{
    use WithAdvisoryLock;

    protected $signature = 'orders:archive';

    public function handle(): int
    {
        return $this->withAdvisoryLock(42200, 1, function () {
            $archived = DB::transaction(function () {
                $orders = Order::where('created_at', '<', now()->subDays(90))
                    ->where('archived', false)
                    ->limit(1000)
                    ->lockForUpdate()
                    ->get();

                foreach ($orders as $order) {
                    HistoricalOrder::create($order->toArray());
                    $order->update(['archived' => true]);
                }

                return $orders->count();
            });

            $this->info("Archived {$archived} orders");
            return self::SUCCESS;
        });
    }
}
```

### 场景二：报表聚合计算

每天早上生成一次运营报表。如果两个进程同时跑，数据会翻倍：

```php
class GenerateDailyReportCommand extends Command
{
    use WithAdvisoryLock;

    protected $signature = 'report:daily {date?}';

    public function handle(string $date = null): int
    {
        $date = $date ?? now()->subDay()->toDateString();

        return $this->withAdvisoryLock(42300, crc32($date), function () use ($date) {
            // 复杂的聚合 SQL
            $data = DB::select('
                SELECT
                    DATE(created_at) as report_date,
                    COUNT(*) as total_orders,
                    SUM(amount) as total_revenue,
                    AVG(amount) as avg_order_value
                FROM orders
                WHERE DATE(created_at) = ?
                GROUP BY DATE(created_at)
            ', [$date]);

            DailyReport::updateOrCreate(
                ['report_date' => $date],
                ['data' => $data]
            );

            return self::SUCCESS;
        });
    }
}
```

### 场景三：分布式定时器防重

多个实例同时运行 cron 但需要只有一个执行核心逻辑：

```php
class SyncInventoryCommand extends Command
{
    use WithAdvisoryLock;

    protected $signature = 'inventory:sync';

    public function handle(): int
    {
        return $this->withAdvisoryLock(42400, 1, function () {
            // 同步库存数据到 Elasticsearch
            $products = Product::where('updated_at', '>', now()->subMinutes(5))->get();

            foreach ($products as $product) {
                $this->syncToElasticsearch($product);
            }

            $this->info("Synced {$products->count()} products");
            return self::SUCCESS;
        });
    }
}
```

## 十一、怎么监控这把锁有没有真的生效

生产里我会加两类观测：一类看"抢锁失败次数"，另一类直接看 PostgreSQL 当前锁状态。前者告诉我是不是有多个入口在竞争，后者用来排查"为什么明明没人跑，锁还在"。

### 数据库侧监控

```sql
-- 查看当前所有 Advisory Lock 持有情况
SELECT
    a.pid,
    a.application_name,
    a.state,
    a.query,
    l.classid,
    l.objid,
    a.backend_start,
    now() - a.state_change AS lock_hold_duration
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory'
  AND l.classid = 42100
  AND l.objid = 7;
```

如果线上报警说扫描任务连续 10 分钟没跑，我第一步不是重启，而是先查这条 SQL：

- 有记录：说明锁还被某个 session 持有，去看对应连接是不是卡在慢查询。
- 没记录：说明锁并不在，问题多半是调度根本没进来，或者命令执行前就异常退出。

### 查看所有持有时长超过阈值的锁

```sql
-- 找出持有超过 5 分钟的 Advisory Lock
SELECT
    a.pid,
    a.application_name,
    a.state,
    a.query,
    l.classid,
    l.objid,
    now() - a.query_start AS query_duration
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory'
  AND a.query_start < now() - INTERVAL '5 minutes'
ORDER BY a.query_start;
```

### 应用侧打点

```php
if (! $lock->acquire($classId, $objectId)) {
    metrics()->counter('compensation_scanner_lock_miss_total')->inc();
    logger()->info('compensation scanner skipped because lock is held');
    return self::SUCCESS;
}
```

这类指标看起来简单，但很有用。正常情况下它应该偶发出现；如果突然陡增，通常表示 Kubernetes CronJob、`schedule:work`、手工补跑三个入口同时在抢同一把锁，说明系统边界已经开始变脏。

### Prometheus + Grafana 告警规则

```yaml
# prometheus-rules.yaml
groups:
  - name: advisory_lock_alerts
    rules:
      - alert: AdvisoryLockHeldTooLong
        expr: pg_stat_activity_query_duration{query_type="advisory_lock"} > 300
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Advisory Lock held for over 5 minutes"
          description: "PID {{ $labels.pid }} has been holding an advisory lock for {{ $value }}s"

      - alert: AdvisoryLockContentionHigh
        expr: rate(compensation_scanner_lock_miss_total[5m]) > 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High Advisory Lock contention detected"
          description: "Lock miss rate is {{ $value }}/s, check if multiple pods are competing"
```

## 十二、Advisory Lock 在 Horizon 队列中的实战

如果你用 Laravel Horizon 管理队列，可能会遇到另一个典型问题：多个 worker 进程同时启动时，都想执行同一个"入口命令"。比如你有一个自定义的队列消费者，需要从数据库拉取任务然后 dispatch 到 Horizon，多个 worker 同时跑就会重复拉取。

在这种场景下，Advisory Lock 可以作为"入口互斥"的轻量方案：

```php
class ConsumeFromDatabaseCommand extends Command
{
    use WithAdvisoryLock;

    protected $signature = 'queue:consume-db';
    protected $description = 'Consume jobs from database and dispatch to Horizon';

    public function handle(): int
    {
        return $this->withAdvisoryLock(42500, 1, function () {
            $jobs = DB::table('pending_jobs')
                ->where('status', 'pending')
                ->orderBy('id')
                ->limit(50)
                ->get();

            foreach ($jobs as $job) {
                DB::table('pending_jobs')
                    ->where('id', $job->id)
                    ->update(['status' => 'dispatched']);

                dispatch(new ProcessJob($job->payload));
            }

            $this->info("Dispatched " . $jobs->count() . " jobs to Horizon");
            return self::SUCCESS;
        });
    }
}
```

配合 `schedule:work` 运行时，只需要一个 worker 拿到锁，其他 worker 自动跳过。这比配置 Horizon 的 `--max-jobs=1` 或 `--max-time=3600` 更精确。

### Horizon 多实例的锁 ID 策略

当多个 Horizon 队列（如 `default`、`high`、`low`）都使用同一个数据库作为任务源时，你需要为每个队列分配独立的锁 ID，避免它们互相阻塞：

```php
$lockId = match ($this->queue) {
    'default' => 42500,
    'high'    => 42501,
    'low'     => 42502,
};

$this->withAdvisoryLock($lockId, 1, function () {
    // 按队列分别拉取任务...
});
```

## 十三、压测和回归我怎么做

这类文章如果只讲概念，其实没什么价值。我的回归方式非常土，但很好用：同时起两个终端，各跑一次同样命令，看是否只有一个实例真正进入扫描。

```bash
php artisan orders:scan-compensation
php artisan orders:scan-compensation
```

如果想更接近线上，我会在本地或测试环境里起两个 Pod，同时观察日志：

- 一个实例打印 `lock acquired`
- 另一个实例打印 `scanner skipped`
- `compensation_jobs` 的待处理记录只被分发一轮

然后再专门测异常路径：在拿到锁后手动 `kill -9` 进程，确认 PostgreSQL session 断开后锁会被释放。这个测试让我吃过一次定心丸——团队之前一直以为"异常退出会留下死锁"，结果对 Advisory Lock 来说，只要连接真断了，数据库会替你回收。真正该担心的反而是 **连接没断但业务线程挂死**，这时就得靠超时和监控去发现。

## 十四、常见问题 FAQ

### Q: Advisory Lock 有超时机制吗？

PostgreSQL 的 Advisory Lock 本身没有超时。`pg_try_advisory_lock` 会立即返回（获取成功或失败），而 `pg_advisory_lock`（不带 try）会无限等待直到获取成功。如果你需要超时，需要在应用层实现：

```php
$startTime = microtime(true);
$timeout = 5; // 秒

while (! $lock->acquire($classId, $objectId)) {
    if (microtime(true) - $startTime > $timeout) {
        throw new \RuntimeException("Lock acquisition timed out after {$timeout}s");
    }
    usleep(100_000); // 100ms
}
```

### Q: 能不能在事务里使用 Advisory Lock？

可以，但要注意：`pg_try_advisory_lock` 是会话级锁，即使在事务里调用，锁也不会在事务结束时释放。你需要手动调用 `pg_advisory_unlock`。如果想要事务结束自动释放的行为，使用 `pg_try_advisory_xact_lock`。

### Q: 同一个进程能同时持有多个 Advisory Lock 吗？

可以。Advisory Lock 的粒度是 `(classid, objid)` 这对组合，不同的组合是不同的锁。一个 PostgreSQL 会话可以同时持有多个不同 ID 的 Advisory Lock，它们互不影响。

### Q: Advisory Lock 和 `SELECT ... FOR UPDATE SKIP LOCKED` 有什么区别？

`SKIP LOCKED` 是**行级锁**，用于从队列表中取任务时跳过已被其他进程锁定的行。Advisory Lock 是**会话级锁**，用于保护"一个逻辑操作的单实例执行"。两者解决不同问题，可以组合使用。

## 十五、我最后的结论

Advisory Lock 最适合的，不是所有分布式互斥，而是**那些本来就围着 PostgreSQL 运转、又明确需要单实例入口的后台任务**。它最大的优点是简单、可观测、和数据靠得近；最大的风险则是 session 语义很强，一旦碰上 PgBouncer transaction pooling、Laravel 连接复用、错误的解锁连接，问题会非常隐蔽。

这套改完以后，我们的补偿扫描在 3 个 Pod 同时触发时只会有 1 个实例真正工作，重复推送量从高峰期每小时数百条降到接近 0。对 Laravel 这类大量后台任务都围着数据库转的系统来说，能少一层外部锁服务，有时候就是最实用的稳定性优化。

---

## 相关阅读

- [PostgreSQL Advisory Lock 实战进阶：会话级互斥、分布式任务调度、与 PgBouncer 连接池的兼容性踩坑](/01_MySQL/PostgreSQL-Advisory-Lock-实战进阶-会话级互斥-分布式任务调度-PgBouncer兼容性踩坑) — 更深入的 Advisory Lock 进阶用法与 PgBouncer 四种绕行方案
- [Distributed Lock 深度对比：Redis Redlock vs Zookeeper vs etcd — PHP 分布式互斥选型](/00_架构/Distributed-Lock-深度对比-Redis-Redlock-vs-Zookeeper-vs-etcd-PHP分布式互斥选型) — 不同分布式锁方案的详细对比与选型指南
- [MySQL 乐观锁 vs 悲观锁 vs Laravel 并发控制实战](/01_MySQL/2026-06-06-mysql-optimistic-vs-pessimistic-lock-laravel-concurrency) — Laravel 中锁的完整对比与使用边界
