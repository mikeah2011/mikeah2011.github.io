---

title: PostgreSQL Advisory Lock 实战进阶：会话级互斥、分布式任务调度、与 PgBouncer 连接池的兼容性踩坑
keywords: [PostgreSQL Advisory Lock, PgBouncer, 实战进阶, 会话级互斥, 分布式任务调度, 连接池的兼容性踩坑]
date: 2026-06-06 09:30:00
tags:
- PostgreSQL
- Advisory Lock
- 分布式
- PgBouncer
- Laravel
categories:
- database
description: PostgreSQL Advisory Lock 是一种数据库原生的互斥机制，无需引入 Redis 或 ZooKeeper 即可实现分布式任务调度中的单实例执行保障。本文深入对比会话级锁与事务级锁的选择边界，详解 Laravel 中 AdvisoryLockCommand 基类封装与多实例 cron 防重复执行的完整实现，重点剖析 PgBouncer transaction 模式下 Advisory Lock 失效的根因，并给出直连绕行、事务级锁降级、应用层 Redis 锁等四种生产级解决方案，附带监控告警配置与三个真实踩坑案例。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---



在微服务和多实例部署成为常态的今天，"同一时刻只允许一个实例执行某项任务"是后端开发中最常见的互斥需求。很多团队的第一反应是引入 Redis 分布式锁，但在实践中会发现：锁的过期时间设短了，业务还没跑完锁就释放了，导致并发冲突；设长了，进程异常退出后锁长期不释放，任务被卡住好几分钟。更别提还要额外维护 Redis 集群的高可用，增加了运维和排障的复杂度。

PostgreSQL 提供了 Advisory Lock 这一原生机制，不需要额外引入 Redis 或 ZooKeeper，就能在数据库层面完成协调。它最大的优势在于：锁的生命周期与数据库连接绑定，连接断开锁自动释放，不存在死锁残留；锁的状态可以通过 `pg_locks` 视图直接观测，排障时比查 Redis TTL 直观得多。但要把它用对、用稳，尤其是和连接池、长连接、多语言客户端配合时，坑远比文档里写的多。

本文是一篇进阶实战笔记，不重复介绍基础语法，而是聚焦三个生产中高频踩坑的方向：

1. **会话级锁 vs 事务级锁**的选择边界与常见误用
2. **分布式定时任务调度**中 Advisory Lock 的正确姿势与代码实现
3. **PgBouncer transaction 模式**下 Advisory Lock 失效的根因与四种绕行方案

文末还会给出 Laravel/PHP 的完整代码示例，并与 Redis 分布式锁做详细对比。

<!-- more -->

---

## 一、Advisory Lock 核心机制回顾

在深入之前，先把几个关键概念确认清楚。如果你已经熟悉基础用法，可以快速扫一眼直接跳到第二节。

### 1.1 两种加锁粒度：会话级与事务级

PostgreSQL Advisory Lock 分为**会话级**和**事务级**两种，区别在于锁的持有时间和释放条件：

| 函数 | 锁级别 | 释放时机 | 特点 |
|------|--------|----------|------|
| `pg_advisory_lock(key)` | 会话级 | 会话断开或显式 `pg_advisory_unlock` | 阻塞等待，拿不到就一直等 |
| `pg_try_advisory_lock(key)` | 会话级 | 同上 | 非阻塞，拿不到立即返回 `false` |
| `pg_advisory_xact_lock(key)` | 事务级 | 当前事务结束（commit/rollback） | 阻塞等待，适合短互斥 |
| `pg_try_advisory_xact_lock(key)` | 事务级 | 同上 | 非阻塞版本 |

**关键区分**：会话级锁绑定的是数据库连接（session），事务级锁绑定的是当前事务。一个连接在其生命周期内可以开启多个事务，所以会话级锁的生命周期远长于事务级锁。这看起来只是一个小差异，但在生产中，选错锁级别是最常见的 Advisory Lock 事故来源。

### 1.2 Key 的设计空间

Advisory Lock 的 key 可以是一个 `bigint`，也可以是两个 `int` 组合：

```sql
-- 单 key，范围：-9223372036854775808 ~ 9223372036854775807
SELECT pg_advisory_lock(12345);

-- 双 key，每个 int 范围：-2147483648 ~ 2147483647
SELECT pg_advisory_lock(1, 23456);
```

在实际工程中，双 key 模式更实用。可以把第一个 int 当作"业务域编号"，第二个 int 当作"具体任务编号"，这样不同业务的锁 key 不会冲突，也方便在监控中按域分组查看：

```sql
-- 业务域 10 = 订单补偿扫描，任务 1001
SELECT pg_advisory_lock(10, 1001);

-- 业务域 20 = 报表生成，任务 2001
SELECT pg_advisory_lock(20, 2001);
```

这种设计的好处是：在 `pg_locks` 视图中，你可以通过 `classid`（第一个 key）快速筛选出某类业务的所有锁，而不用去记忆各种不同的锁 ID。

### 1.3 Advisory Lock 不受 MVCC 影响

这一点经常被忽略：**Advisory Lock 的生命周期与 MVCC 快照无关**。即使你在 `REPEATABLE READ` 或 `SERIALIZABLE` 隔离级别的事务里，`pg_advisory_lock` 也不是事务快照的一部分——事务级锁跟随事务结束而释放，会话级锁跟随连接而释放。你不能通过事务隔离级别来"延长"或"缩短"锁的有效期。

### 1.4 Advisory Lock 是排他锁，不是共享锁

每个 Advisory Lock 都是排他的。如果两个事务（或两个会话）同时请求同一个 key，后来者必须等待前者释放。这一点和行锁的 `FOR SHARE` / `FOR UPDATE` 不同——Advisory Lock 没有共享模式，所有锁都是互斥的。如果你需要"读写分离"式的锁，需要自己用不同的 key 来模拟。

---

## 二、会话级锁 vs 事务级锁：选错是灾难

### 2.1 事务级锁的三个陷阱

很多人第一反应是用 `pg_advisory_xact_lock`，觉得"事务结束自动释放"更安全、更符合直觉。但在以下三个场景中，事务级锁会带来严重问题。

**陷阱一：Laravel DB::transaction 闭包结束后锁已释放**

```php
DB::transaction(function () use ($lockKey) {
    // 加锁
    DB::select("SELECT pg_advisory_xact_lock(?)", [$lockKey]);
    
    // 执行业务逻辑...
    $this->processOrders();
    
    // Laravel 在闭包结束后自动 commit，此时事务结束，锁已经释放
});

// ← 注意：此处锁已释放！
// 如果有并发实例此时才开始执行，两个实例可能同时在处理
$this->postProcess(); // 没有锁保护！
```

这是最常见的误用。开发者以为整个方法都被锁保护了，但实际上锁在 `DB::transaction` 闭包结束时就已经释放了。如果后续的 `postProcess` 方法依赖独占访问，就会出现并发冲突。

**陷阱二：事务回滚导致锁提前释放**

```php
DB::transaction(function () use ($lockKey) {
    DB::select("SELECT pg_advisory_xact_lock(?)", [$lockKey]);
    
    try {
        $this->riskyOperation();
    } catch (\Exception $e) {
        // 即使你只是想 rollback 这个子操作
        // 但回滚会导致整个事务结束，锁也跟着没了
        DB::rollBack(); // ← 锁释放！
        throw $e;
    }
});
```

一旦事务被 rollback，事务级锁立刻释放。如果你的错误处理逻辑中还有其他操作需要锁的保护，就必须切换到会话级锁。

**陷阱三：数据库连接复用时的"幽灵锁"**

在 Laravel 的长驻进程（如 queue:work）中，数据库连接会在多个任务之间复用。如果某个任务获取了事务级锁但因异常导致事务回滚，锁虽然释放了，但数据库连接本身还在。开发者有时候会混淆"锁已释放"和"连接已断开"，在后续逻辑中做出错误判断。

### 2.2 会话级锁的正确用法

对于"确保整个任务执行期间只有我一个"的需求，会话级锁是正确选择。它的好处是锁的边界完全由你控制，不受事务提交或回滚的影响：

```php
// 拿到锁
$acquired = DB::selectOne(
    "SELECT pg_try_advisory_lock(10, 1001) as locked"
)->locked;

if (!$acquired) {
    Log::info('另一个实例正在执行，跳过');
    return;
}

try {
    // 整个任务执行期间锁一直持有，无论中间开几个事务
    $this->processOrders();
    $this->sendNotifications();
    $this->updateReports();
} finally {
    // 显式释放，不等连接断开
    DB::statement("SELECT pg_advisory_unlock(10, 1001)");
}
```

**会话级锁的一大优势**：如果 `finally` 块因为进程被 kill 而没执行，锁怎么办？答案是：**连接断开时 PostgreSQL 会自动回收**。这正是 Advisory Lock 相比 Redis 分布式锁的核心优势——不存在死锁残留。你不需要设置 TTL，不需要看门狗续期，只要连接真断了，数据库会替你收拾。

**但要注意**：如果进程没死，只是某个线程挂死了，连接还在，锁就一直在。这种情况下你需要监控来发现异常（见第五节）。

### 2.3 如何选择：一张决策表

| 场景 | 推荐锁级别 | 原因 |
|------|-----------|------|
| 定时任务执行期间互斥 | 会话级 | 任务可能跨多个事务，需要全程锁保护 |
| 单个事务内的行级互斥 | 事务级 | 事务结束即释放，不需要手动管理 |
| 队列消费的幂等保护 | 事务级 | 消费逻辑通常在一个事务里完成 |
| 跨多个步骤的批处理 | 会话级 | 步骤之间可能有不同事务 |
| 数据迁移脚本 | 会话级 | 迁移脚本可能运行数小时 |

---

## 三、分布式定时任务调度：多服务器防重复执行

这是 Advisory Lock 最经典的生产场景，也是它最能发挥价值的地方。

### 3.1 场景描述

假设你有 3 台应用服务器，每台都注册了相同的 cron 任务：

```
*/5 * * * * php artisan orders:compensate
```

如果没有互斥机制，3 台服务器会同时执行补偿扫描，造成重复扣款、重复通知、数据不一致等问题。你可能考虑过在数据库里加状态字段做"乐观锁"，但那会导致复杂的竞态条件和死锁问题。Advisory Lock 是最干净的方案。

### 3.2 Laravel 实现：通用的 AdvisoryLockCommand 基类

把锁的获取和释放逻辑封装到基类中，所有需要互斥的命令只需要继承它：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

abstract class AdvisoryLockCommand extends Command
{
    /**
     * 子类实现：返回 [domain, lockId]
     * 不同业务域用不同的 domain，避免 key 冲突
     */
    abstract protected function lockKey(): array;

    /**
     * 子类实现：具体的业务逻辑
     * @return int 退出码
     */
    abstract protected function handleWithLock(): int;

    public function handle(): int
    {
        [$domain, $lockId] = $this->lockKey();

        // pg_try_advisory_lock 是非阻塞的
        // 拿不到就立刻返回 false，不会阻塞当前进程
        $acquired = DB::selectOne(
            "SELECT pg_try_advisory_lock(?, ?) as locked",
            [$domain, $lockId]
        )->locked;

        if (!$acquired) {
            Log::info("Advisory Lock 未获取，跳过执行", [
                'command' => $this->getName(),
                'domain'  => $domain,
                'lock_id' => $lockId,
                'host'    => gethostname(),
            ]);
            // 输出到控制台，方便 cron 日志排查
            $this->line("Lock not acquired, skipping.");
            return self::SUCCESS;
        }

        Log::info("Advisory Lock 已获取，开始执行", [
            'command' => $this->getName(),
            'domain'  => $domain,
            'lock_id' => $lockId,
            'host'    => gethostname(),
            'pid'     => getmypid(),
        ]);

        $startTime = microtime(true);

        try {
            $exitCode = $this->handleWithLock();

            $duration = round(microtime(true) - $startTime, 2);
            Log::info("AdvisoryLockCommand 执行完成", [
                'command'  => $this->getName(),
                'duration' => "{$duration}s",
                'host'     => gethostname(),
            ]);

            return $exitCode;
        } catch (\Throwable $e) {
            Log::error("AdvisoryLockCommand 执行异常", [
                'command' => $this->getName(),
                'error'   => $e->getMessage(),
                'host'    => gethostname(),
            ]);
            throw $e;
        } finally {
            // 显式释放，不等连接断开
            DB::statement(
                "SELECT pg_advisory_unlock(?, ?)",
                [$domain, $lockId]
            );
            Log::info("Advisory Lock 已释放", [
                'command' => $this->getName(),
                'domain'  => $domain,
                'lock_id' => $lockId,
            ]);
        }
    }
}
```

这个基类做了几件关键的事：

1. 使用 `pg_try_advisory_lock`（非阻塞），拿不到锁就立即退出，不会在 cron 中堆积
2. 记录了完整的执行日志，包括主机名、进程 ID、执行时长，方便分布式排障
3. `finally` 块确保无论正常结束还是异常退出，锁都会被释放
4. 子类只需要关心返回锁 key 和业务逻辑

### 3.3 具体业务命令实现

继承基类后，业务命令变得非常简洁：

```php
<?php

namespace App\Console\Commands;

use App\Constants\AdvisoryLockDomain;
use App\Constants\AdvisoryLockId;
use Illuminate\Support\Facades\DB;

class CompensateOrdersCommand extends AdvisoryLockCommand
{
    protected $signature = 'orders:compensate';
    protected $description = '补偿扫描待处理订单（多实例互斥）';

    protected function lockKey(): array
    {
        return [
            AdvisoryLockDomain::ORDER_COMPENSATE,
            AdvisoryLockId::ORDER_COMPENSATE_MAIN,
        ];
    }

    protected function handleWithLock(): int
    {
        // 查询需要补偿的订单
        $orders = DB::table('orders')
            ->where('status', 'pending_compensate')
            ->where('created_at', '<', now()->subMinutes(30))
            ->orderBy('created_at')
            ->limit(100)
            ->lockForUpdate()  // 行锁防并发更新
            ->get();

        $compensated = 0;

        foreach ($orders as $order) {
            try {
                // 模拟补偿业务逻辑
                DB::table('orders')
                    ->where('id', $order->id)
                    ->update([
                        'status'         => 'compensated',
                        'compensated_at' => now(),
                        'compensated_by' => gethostname(),
                    ]);

                // 发送通知
                $this->notifyCompensation($order);
                $compensated++;
            } catch (\Throwable $e) {
                // 单笔失败不影响整批
                report($e);
                $this->warn("订单 {$order->id} 补偿失败: {$e->getMessage()}");
            }
        }

        $this->info("已补偿 {$compensated} 笔订单");
        return self::SUCCESS;
    }

    private function notifyCompensation($order): void
    {
        // 发消息、写日志、推 webhook 等
    }
}
```

### 3.4 锁 key 管理规范

在复杂应用中，可能同时需要多个不同的 Advisory Lock。为了避免 key 冲突和管理混乱，建议用常量类统一管理：

```php
<?php

namespace App\Constants;

final class AdvisoryLockDomain
{
    /** 订单相关 */
    const ORDER = 10;
    
    /** 报表相关 */
    const REPORT = 20;
    
    /** 数据同步 */
    const SYNC = 30;
    
    /** 缓存管理 */
    const CACHE = 40;
    
    /** Leader Election */
    const LEADER = 99;
}

final class AdvisoryLockId
{
    // ---- 订单域 (domain=10) ----
    const ORDER_COMPENSATE      = 1001;
    const ORDER_RETRY           = 1002;
    const ORDER_CLEANUP         = 1003;
    
    // ---- 报表域 (domain=20) ----
    const REPORT_DAILY          = 2001;
    const REPORT_WEEKLY         = 2002;
    const REPORT_MONTHLY        = 2003;
    
    // ---- 同步域 (domain=30) ----
    const SYNC_ELASTICSEARCH    = 3001;
    const SYNC_REDIS_CACHE      = 3002;
}
```

### 3.5 带超时的阻塞加锁

有时候你不是"拿不到就跳过"，而是"愿意等一会儿再放弃"。`pg_advisory_lock` 默认无限等待，配合 `lock_timeout` 可以实现超时控制：

```php
try {
    DB::statement("SET lock_timeout = '30s'");
    DB::statement("SELECT pg_advisory_lock(?, ?)", [10, 1001]);
    
    // 拿到锁了，执行任务
    $this->processOrders();
} catch (\Illuminate\Database\QueryException $e) {
    // lock_timeout 到期会抛出 SQLSTATE 55P03 错误
    if (str_contains($e->getMessage(), '55P03')) {
        Log::warning('等待 Advisory Lock 超时，其他实例可能正在执行');
        return;
    }
    throw $e;
} finally {
    DB::statement("SELECT pg_advisory_unlock(?, ?)", [10, 1001]);
    // 恢复默认值
    DB::statement("SET lock_timeout = DEFAULT");
}
```

这种模式适合"乐观等待"的场景——大多数时候不会有竞争，但偶尔可能两个实例同时触发，等待 30 秒后其中一个自动退出。

---

## 四、PgBouncer transaction 模式：Advisory Lock 的噩梦

这是 Advisory Lock 使用中最隐蔽、最具破坏性的坑。很多团队在引入 PgBouncer 后才发现互斥"失效"了，而且很难定位到根因。

### 4.1 问题根因：会话语义被打破

PgBouncer 有三种连接池模式：

- **session 模式**：连接在整个客户端会话期间被独占，会话结束才归还。对 Advisory Lock 无影响，但连接池效率最低。
- **transaction 模式**：事务结束后连接立即归还给池，下一个事务可能分配到完全不同的物理连接。这是最常用的模式，但也是 Advisory Lock 的克星。
- **statement 模式**：每条 SQL 语句结束后就归还连接。几乎没人用，对事务都有破坏。

在 transaction 模式下，问题的时序如下：

```
应用实例 A:
  1. 从 PgBouncer 拿到物理连接 #17（PostgreSQL backend PID = 12345）
  2. SELECT pg_advisory_lock(10, 1001)
     → 锁绑定到 backend PID 12345
  3. 事务结束，PgBouncer 将物理连接 #17 归还给连接池
  4. 锁仍然被 PID 12345 持有！（因为这是会话级锁，不随事务结束释放）

应用实例 B（稍后发起请求）:
  5. PgBouncer 将物理连接 #17 分配给实例 B
  6. SELECT pg_try_advisory_lock(10, 1001)
     → 返回 false！因为 PID 12345 还持有这个锁
  7. 实例 B 认为"有别人在执行，我跳过"
     → 但实际上实例 A 已经认为自己"完成了"

更糟的场景：
  实例 A 想 unlock 时，PgBouncer 可能给它分配了另一个物理连接（比如 #23），
  那个连接的 backend PID = 67890，它根本没有锁！
  SELECT pg_advisory_unlock(10, 1001) → 返回 false（没锁可解）
  锁被永远留在了 PID 12345 上，直到那个连接真正断开
```

**本质矛盾**：Advisory Lock 的会话语义要求连接生命周期 = 锁生命周期，但 PgBouncer transaction 模式打破了这个等式，使得"逻辑连接"和"物理连接"不再一一对应。

### 4.2 解决方案一：PgBouncer 使用 session 模式

最直接的方案是让 PgBouncer 对需要 Advisory Lock 的应用使用 session 模式。可以在 PgBouncer 配置中针对特定数据库设置：

```ini
; pgbouncer.ini
[databases]
; 默认 transaction 模式
mydb = host=pg-primary port=5432 dbname=mydb

; session 模式的专用数据库别名
mydb_session = host=pg-primary port=5432 dbname=mydb

[mydb]
pool_mode = transaction
default_pool_size = 50

[mydb_session]
pool_mode = session
default_pool_size = 10
```

应用连接 `mydb_session` 时使用 session 模式，连其他数据库时使用 transaction 模式。

**优点**：方案简单，不需要改应用代码。
**缺点**：session 模式的连接池效率较低，等于回到了直连数据库的状态。如果只有少数命令需要 Advisory Lock，为它们单独维护一个 session 模式的连接池是比较浪费的。

### 4.3 解决方案二：专用连接绕过 PgBouncer（推荐）

在 Laravel 中，可以为 Advisory Lock 创建一个不经过 PgBouncer 的直连数据库连接：

```php
// config/database.php
'connections' => [
    // 业务查询走 PgBouncer（transaction 模式）
    'pgsql' => [
        'driver'   => 'pgsql',
        'host'     => 'pgbouncer-host',
        'port'     => 6432,  // PgBouncer 端口
        'database' => 'mydb',
        'username' => 'app',
        'password' => env('DB_PASSWORD'),
        'options'  => [
            // 关键：使用原生 prepared statements
            \PDO::ATTR_EMULATE_PREPARES => false,
        ],
    ],
    
    // Advisory Lock 专用直连（绕过 PgBouncer）
    'pgsql_direct' => [
        'driver'   => 'pgsql',
        'host'     => 'pg-primary',   // 直连主库
        'port'     => 5432,            // PostgreSQL 原生端口
        'database' => 'mydb',
        'username' => 'app',
        'password' => env('DB_PASSWORD'),
    ],
],
```

然后在 AdvisoryLockCommand 基类中使用直连：

```php
// 使用专用连接加锁
$acquired = DB::connection('pgsql_direct')->selectOne(
    "SELECT pg_try_advisory_lock(?, ?) as locked",
    [10, 1001]
)->locked;

if (!$acquired) {
    Log::info('未获取锁，跳过');
    return;
}

try {
    // 业务查询走 PgBouncer
    DB::connection('pgsql')->table('orders')...
    
    // 或者继续用直连也行，看你的连接数规划
} finally {
    // 释放锁也走直连
    DB::connection('pgsql_direct')->statement(
        "SELECT pg_advisory_unlock(?, ?)",
        [10, 1001]
    );
}
```

**关键注意点**：

1. **直连连接数要单独规划**。直连不经过池化，每个持有锁的任务会长期占用一个连接。建议直连连接数 = 需要同时持有锁的任务数，通常很小（5-10 个），不会对数据库造成压力。
2. **直连连接也需要正确关闭**。Laravel 的连接管理在请求结束时会归还连接到连接池，但直连没有池化，需要确保连接最终被关闭。在 CLI 命令中，进程退出时连接自然关闭，锁自动释放。
3. **防火墙和网络策略**要允许应用服务器直连主库，不能只允许通过 PgBouncer 访问。

### 4.4 解决方案三：使用事务级锁 + 延长事务

如果实在不想维护两个数据库连接，可以把任务的核心逻辑放在一个事务里，使用事务级锁来规避会话级锁的问题：

```php
DB::connection('pgsql')->transaction(function () {
    // 事务级锁，事务结束自动释放，不受 PgBouncer 连接切换影响
    $acquired = DB::selectOne(
        "SELECT pg_try_advisory_xact_lock(?, ?) as locked",
        [10, 1001]
    )->locked;

    if (!$acquired) {
        Log::info('未获取锁，跳过');
        return;
    }

    // 所有业务逻辑必须在这个事务内完成
    $this->processOrders();
    $this->sendNotifications();
});
```

**局限性**：整个业务逻辑必须在一个事务里完成。对于短任务（几秒钟）来说没问题，但对于长任务（几分钟甚至几小时），会导致：

- 事务膨胀，长时间持有行锁和表锁
- `idle_in_transaction_session_timeout` 可能触发强制回滚
- 事务级 Advisory Lock 在回滚时会释放，如果某个步骤失败需要重试，锁已经不在了
- 长事务会阻止 VACUUM 回收死行，导致表膨胀

### 4.5 解决方案四：应用层分布式锁

最后一个方案是完全绕开 PostgreSQL 的锁机制，改用应用层的分布式锁（通常是 Redis）：

```php
use Illuminate\Support\Facades\Cache;

public function handle(): int
{
    $lockKey = 'lock:orders:compensate';
    $lock = Cache::lock($lockKey, 300); // 5 分钟超时

    if (!$lock->get()) {
        Log::info('未获取应用层锁，跳过');
        return self::SUCCESS;
    }

    try {
        $this->processOrders();
    } finally {
        $lock->release();
    }

    return self::SUCCESS;
}
```

这个方案完全不受 PgBouncer 模式的影响，但需要引入 Redis 依赖，并且失去了前面提到的 Advisory Lock 的几个核心优势（自动清理、可观测性、零额外依赖）。

### 4.6 四种方案对比

| 方案 | 复杂度 | 适用场景 | 主要缺点 |
|------|--------|---------|---------|
| PgBouncer session 模式 | 低 | 整体流量不大 | 连接池效率低 |
| 直连绕过 PgBouncer | 中 | 推荐的生产方案 | 需要规划直连连接数 |
| 事务级锁 | 低 | 短事务任务 | 不适合长任务 |
| 应用层锁（Redis） | 中 | 跨数据源互斥 | 额外依赖和运维成本 |

---

## 五、与 Redis 分布式锁的详细对比

在决定是否使用 Advisory Lock 之前，有必要和 Redis 分布式锁做一个全面的对比。

### 5.1 基本原理对比

**Advisory Lock** 基于 PostgreSQL 的锁管理器，锁信息存储在数据库的共享内存中。每个锁绑定一个 backend 连接，连接断开时自动释放。

**Redis 分布式锁** 基于 `SET key value NX PX milliseconds` 命令，通过设置一个带过期时间的 key 来实现。释放锁时需要先验证 value 是否匹配（防止误删别人的锁），通常用 Lua 脚本保证原子性。

### 5.2 异常清理机制

这是两者最大的差异。

**Advisory Lock**：连接断开时锁自动释放。无论是进程崩溃、网络中断还是连接超时，只要 PostgreSQL 检测到连接断开（通过 TCP keepalive 或 `tcp_keepalives_idle`），就会自动回收该连接持有的所有 Advisory Lock。不需要设置 TTL，不会出现"锁泄露"。

**Redis 分布式锁**：依赖 TTL（过期时间）来处理异常情况。但 TTL 的设置是一个两难问题：

- 设短了（比如 10 秒）：正常业务可能 15 秒才执行完，锁提前释放，另一个实例获取锁，两个实例并发执行
- 设长了（比如 10 分钟）：如果持有锁的实例在第 2 秒就崩溃了，锁要等 10 分钟才能释放，任务被卡住

为了缓解这个问题，Redis 分布式锁引入了"看门狗续期"机制（如 Redlock 的 RedLock 算法），但这又增加了系统复杂度和新的故障点。

### 5.3 可观测性

**Advisory Lock**：通过 `pg_locks` 视图可以直接查看当前所有锁的持有情况，包括持有者的进程 ID、用户名、客户端地址、查询状态、持有时长：

```sql
SELECT
    l.classid   AS domain,
    l.objid     AS lock_id,
    l.pid,
    a.usename,
    a.application_name,
    a.client_addr,
    a.state,
    now() - a.query_start AS held_duration,
    a.query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.locktype = 'advisory'
ORDER BY held_duration DESC;
```

一条 SQL 就能看出谁在持有锁、持有了多久、从哪个 IP 连过来的、在执行什么查询。这在排查生产问题时价值极大。

**Redis 分布式锁**：只能用 `PTTL` 命令查看某个锁 key 还剩多少毫秒过期，无法知道是谁持有的、从哪里来的、持有了多久。

### 5.4 性能对比

**Advisory Lock** 的性能取决于数据库连接数和锁的竞争程度。在典型的连接池配置（50-100 个连接）下，Advisory Lock 的加锁/解锁操作是微秒级的，整体吞吐量可以达到每秒 10,000 次以上。但对于超高并发场景（每秒数十万次），数据库连接数会成为瓶颈。

**Redis 分布式锁** 的性能取决于 Redis 的吞吐量和网络延迟。Redis 的单线程模型使得每次加锁操作是串行的，但在正常配置下吞吐量可以轻松达到每秒 100,000 次以上，远超 Advisory Lock。

### 5.5 完整对比表

| 维度 | Advisory Lock | Redis 分布式锁 |
|------|--------------|----------------|
| 额外依赖 | 无（复用现有数据库） | 需要 Redis 集群 |
| 异常清理 | 连接断开自动释放 | 依赖 TTL，可能提前或滞后 |
| 死锁残留 | 不可能（连接断开即清理） | 可能（TTL 未到期） |
| 锁续期 | 不支持原生续期 | 可通过 Lua 脚本续期 |
| 适合场景 | 任务数据在 PostgreSQL | 跨数据源互斥 |
| 可观测性 | `pg_locks` 视图，信息丰富 | `PTTL` 命令，信息有限 |
| 典型吞吐量 | 10K+ TPS | 100K+ TPS |
| 网络依赖 | 与业务数据库同链路 | 需要额外网络路径 |
| 连接池兼容 | 需注意 PgBouncer 模式 | 无影响 |
| 跨语言支持 | 所有 PostgreSQL 客户端 | 所有 Redis 客户端 |

### 5.6 什么时候应该选 Advisory Lock？

- 任务数据本身就在 PostgreSQL 里，锁和数据"距离最近"
- 不想引入额外的中间件增加架构复杂度
- 需要锁的可观测性，方便排查并发问题
- 对自动清理有强需求，不能接受死锁残留
- 并发争抢不太激烈（同一时刻只有个位数的竞争者）

### 5.7 什么时候应该选 Redis？

- 需要锁续期功能（任务执行时间不确定）
- 任务数据不在 PostgreSQL 里（如在 MongoDB、S3、外部 API 中）
- 需要跨语言、跨系统的统一锁方案
- 并发量极高，数据库连接成为瓶颈
- 已经有 Redis 集群，引入成本为零

---

## 六、进阶技巧与生产经验

### 6.1 Leader Election 简单实现

Advisory Lock 还可以用来做简单的 Leader Election（领导选举）。假设有 N 个实例，每个实例尝试不同的 key，谁先拿到谁就是 leader：

```php
public function electLeader(): ?int
{
    for ($i = 1; $i <= 10; $i++) {
        $acquired = DB::connection('pgsql_direct')->selectOne(
            "SELECT pg_try_advisory_lock(?, ?) as locked",
            [AdvisoryLockDomain::LEADER, $i]
        )->locked;

        if ($acquired) {
            Log::info("当选 leader，slot = {$i}", ['host' => gethostname()]);
            return $i;
        }
    }

    Log::info("未当选 leader，所有 slot 已被占用", ['host' => gethostname()]);
    return null;
}
```

leader 负责执行需要全局协调的任务（如分片分配、配置下发、全局聚合），其他实例退化为 follower。当 leader 实例崩溃时，连接断开，锁自动释放，其他实例在下次竞选时可以接管。

### 6.2 监控与告警配置

建议在 Grafana 中配置 Advisory Lock 的监控面板。以下是关键的监控指标：

```sql
-- 每个业务域的锁数量
SELECT
    classid AS domain,
    COUNT(*) AS lock_count
FROM pg_locks
WHERE locktype = 'advisory'
GROUP BY classid;

-- 持锁超过 5 分钟的锁（可能有问题）
SELECT
    l.classid   AS domain,
    l.objid     AS lock_id,
    l.pid,
    a.usename,
    a.client_addr,
    EXTRACT(EPOCH FROM (now() - a.query_start)) AS held_seconds
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.locktype = 'advisory'
  AND now() - a.query_start > INTERVAL '5 minutes'
ORDER BY held_seconds DESC;
```

**告警规则建议**：

1. 当某个锁的 `held_seconds` 超过预期任务执行时间的 2 倍时，触发 Warning
2. 当某个锁的 `held_seconds` 超过预期任务执行时间的 5 倍时，触发 Critical
3. 当同一业务域出现多个锁时，记录日志（可能是正常情况，也可能是 bug）

### 6.3 踩坑实录：三个真实案例

**案例一：Laravel 队列 worker 的长连接复用**

Laravel 的 `queue:work --daemon` 是长驻进程，数据库连接在多次任务之间复用。某次上线后，团队发现某个定时任务突然"消失"了——不报错、不执行、日志里也没有任何输出。排查发现是上周某次异常导致 `finally` 块没有执行（被 catch 块中的 `exit()` 跳过了），锁一直被持有。因为进程没死，连接没断，锁永远不会释放。

**教训**：在 `finally` 块中不要有复杂的条件判断或异常风险；给锁设置一个合理的监控告警阈值；定期检查 `pg_locks` 中是否有异常长期持有的锁。

**案例二：PgBouncer 切换后静默失效**

某团队把数据库连接从直连切换到 PgBouncer transaction 模式后，Advisory Lock 的互斥"看起来还在工作"——因为并发量低，碰巧不同的请求拿到了不同的物理连接。直到某天流量突增，多个请求被复用到同一个物理连接上，两个实例同时认为自己拿到了锁（实际上是两个不同的物理连接各拿到一个锁），造成了重复扣款。

**教训**：切到 PgBouncer transaction 模式后，必须**专门测试**锁的互斥性。最简单的测试方法：写一个脚本并发 10 个请求同一个锁，验证是否只有一个请求能拿到。

**案例三：Prepared Statement 与 PgBouncer 的冲突**

PostgreSQL 的 `PREPARE`/`EXECUTE` 在 PgBouncer transaction 模式下同样会出问题。Laravel 的 PDO 连接默认开启 `EMULATE_PREPARES`，看起来没事。但某次团队为了开启参数化查询的优势，关闭了 `EMULATE_PREPARES`，结果 prepare 和 execute 被分配到不同的物理连接上，导致频繁出现 "prepared statement does not exist" 错误。而由于 Advisory Lock 的查询也走了同样的连接路径，锁操作偶尔也会莫名其妙地失败。

**教训**：在 PgBouncer transaction 模式下，要么保持 `EMULATE_PREPARES = true`，要么升级到 PgBouncer 1.21+ 并使用 `max_prepared_statements` 功能，要么使用直连。

---

## 七、总结与决策树

经过前面的详细分析，最后给出一个实用的决策树：

```
需要分布式互斥？
│
├── 任务数据在 PostgreSQL 里？
│   │
│   ├── 有 PgBouncer？
│   │   ├── session 模式 → 直接用 Advisory Lock ✓
│   │   ├── transaction 模式
│   │   │   ├── 可以增加直连 → 直连 Advisory Lock ✓ (推荐)
│   │   │   ├── 任务是短事务 → 事务级锁 ✓
│   │   │   └── 都不行 → 应用层锁（Redis）
│   │   └── 不确定模式 → 先查 pgbouncer.ini！
│   │
│   └── 无 PgBouncer → 直接用 Advisory Lock ✓
│
├── 任务数据在外部系统？
│   └── 用 Redis 分布式锁
│
└── 需要锁续期（任务时间不确定）？
    └── 用 Redis Redlock + 看门狗续期
```

**Advisory Lock 最适合的场景**：任务本身围绕 PostgreSQL 运转，需要单实例入口，连接数可控，对额外中间件零容忍。它最大的优点是简单、可观测、和数据靠得近；最大的风险是会话语义很强，一旦碰上 PgBouncer transaction 模式、Laravel 长连接复用、错误的解锁连接，问题会非常隐蔽。

**记住一句话**：Advisory Lock 的价值不是"万能锁"，而是**用最少的组件把数据库内任务的互斥边界收紧**。理解它的边界，才能在合适的场景里用得安心。

---

> **参考资料**
> - [PostgreSQL Documentation: Advisory Locks](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)
> - [PgBouncer Documentation: Pool Configuration](https://www.pgbouncer.org/config.html)
> - [Martin Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
> - [Laravel + PostgreSQL Advisory Lock 实战：补偿扫描单实例化、会话级互斥与 PgBouncer 踩坑记录](/post/laravel-postgresql-advisory-lock-guide-pgbouncer/)

---

## 相关阅读

- [Laravel + PostgreSQL Advisory Lock 实战：补偿扫描单实例化、会话级互斥与 PgBouncer 踩坑记录](/categories/php/Laravel/laravel-postgresql-advisory-lock-guide-pgbouncer/)
- [数据库连接池实战：PgBouncer vs ProxySQL vs Supabase 在高并发 Laravel 中的选型对比](/categories/MySQL/数据库/database-connection-pool-pgbouncer-proxysql-supabase-comparison/)
- [数据库连接池监控实战：PgBouncer/ProxySQL 的连接泄漏检测、队列深度监控与告警阈值设计](/categories/运维/PgBouncer-ProxySQL-数据库连接池监控实战-连接泄漏检测-队列深度监控与告警阈值设计/)
- [分布式锁深度对比：Redis Redlock vs Zookeeper vs etcd——PHP 开发者的分布式互斥选型](/categories/架构/Distributed-Lock-深度对比-Redis-Redlock-vs-Zookeeper-vs-etcd-PHP分布式互斥选型/)
