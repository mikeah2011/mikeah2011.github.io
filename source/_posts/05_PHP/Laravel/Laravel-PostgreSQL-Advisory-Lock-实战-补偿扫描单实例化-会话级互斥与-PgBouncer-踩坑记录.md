---
title: Laravel + PostgreSQL Advisory Lock 实战：补偿扫描单实例化、会话级互斥与 PgBouncer 踩坑记录
date: 2026-05-04 15:51:30
updated: 2026-05-04 15:55:22
categories:
  - 05_PHP
  - Laravel
tags: [Laravel, MySQL, PostgreSQL]description: 结合 Laravel 补偿任务的生产经验，记录如何用 PostgreSQL Advisory Lock 做单实例互斥，解决多 Pod 重复扫单、会话锁释放、连接池模式不兼容与异常退出后的恢复问题。
---

我们有一类任务很典型：每分钟扫描一次“待补偿订单”，把超时未支付、库存待回收、第三方回调缺失的单子重新推到队列。业务上它不是高吞吐消费，更像**一个必须全局单实例执行的扫描器**。最早我用过 `withoutOverlapping()`、Redis 锁，最后都在多 Pod + Horizon + PgBouncer 的组合下踩过坑：要么锁漂移，要么进程异常后锁残留认知混乱，要么不同入口各扫各的，结果同一批订单被重复补偿。

后来我把这类任务改成 **PostgreSQL Advisory Lock**。原因很现实：数据本来就在 PostgreSQL，互斥点也只和数据库里的那批订单有关，用数据库自带锁把“谁有资格扫”收口，排障反而更直接。

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

这里我故意把锁放在“扫描入口”，而不是每条订单上锁。因为我的目标不是解决明细竞争，而是防止**两个扫描器同时把同一批待处理记录重复发出去**。

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

## 三、为什么这次不用 Redis 锁

不是 Redis 不行，而是这类“数据库内扫描任务”更适合贴着数据源做互斥：

1. 锁和数据在同一系统里，排查时不用跨两套基础设施。
2. PostgreSQL 会在**会话断开时自动释放 session lock**，不用自己补 TTL 续约。
3. 这类任务追求的是“同一时刻只有一个扫描器”，不是毫秒级高并发抢占。

我自己的经验是：**如果锁的保护对象就在 PostgreSQL 里，而且任务入口很少，Advisory Lock 比额外引入一层 Redis 心智负担更低。**

## 四、线上真正踩过的坑

### 1. PgBouncer 开了 transaction pooling，锁看起来成功却马上失效

这是最坑的一次。`pg_try_advisory_lock` 是**会话级锁**，如果连接池是 transaction pooling，请求结束连接就被归还，下一条 SQL 可能已经不是同一个 session，锁等于白加。后来我的做法很明确：**锁连接必须走 session pooling 或直连 PostgreSQL**。

### 2. 抢锁后又切连接，释放锁失败

有同事把扫描 SQL 也写在默认连接里，而解锁走的是锁连接，最后 release 打到了不同 session。解决办法只有一个：**加锁和解锁必须绑定同一条连接名**，不要在中途 `purge` 或重连。

### 3. 以为拿到扫描锁就不会重复发 Job

错。扫描器单实例，只能保证“同一批记录不会被两台机器同时扫”；**不能保证下游 Job 天然幂等**。我们后面仍然给 `repair_order_jobs` 做了唯一键和状态流转校验，否则补偿任务重试时还是会重复处理。

## 五、我最后定下来的使用边界

我现在只在三类场景用 Advisory Lock：

- 全局单实例扫描任务
- 批处理入口互斥
- 低频但必须串行的后台维护动作

如果是高吞吐队列出队、明细级并发争抢，我更倾向 `SKIP LOCKED`；如果是跨语言、跨存储统一互斥，再考虑 Redis 或专门协调组件。**Advisory Lock 的价值，不是“万能锁”，而是用最少组件把数据库内任务的互斥边界收紧。**

## 六、怎么监控这把锁有没有真的生效

生产里我会加两类观测：一类看“抢锁失败次数”，另一类直接看 PostgreSQL 当前锁状态。前者告诉我是不是有多个入口在竞争，后者用来排查“为什么明明没人跑，锁还在”。

先看数据库侧：

```sql
select
    a.pid,
    a.application_name,
    a.state,
    l.locktype,
    l.classid,
    l.objid,
    a.query,
    a.backend_start
from pg_locks l
join pg_stat_activity a on a.pid = l.pid
where l.locktype = 'advisory'
  and l.classid = 42100
  and l.objid = 7;
```

如果线上报警说扫描任务连续 10 分钟没跑，我第一步不是重启，而是先查这条 SQL：

- 有记录：说明锁还被某个 session 持有，去看对应连接是不是卡在慢查询。
- 没记录：说明锁并不在，问题多半是调度根本没进来，或者命令执行前就异常退出。

应用侧我还会打一个很朴素的指标：

```php
if (! $lock->acquire($classId, $objectId)) {
    metrics()->counter('compensation_scanner_lock_miss_total')->inc();
    logger()->info('compensation scanner skipped because lock is held');
    return self::SUCCESS;
}
```

这类指标看起来简单，但很有用。正常情况下它应该偶发出现；如果突然陡增，通常表示 Kubernetes CronJob、`schedule:work`、手工补跑三个入口同时在抢同一把锁，说明系统边界已经开始变脏。

## 七、session lock 和 transaction lock，我为什么选前者

PostgreSQL 其实还有 `pg_try_advisory_xact_lock`，它会在事务结束时自动释放。很多人第一眼会觉得这个更安全，但在“扫描 + 分发任务”的场景里，我还是更常用 session lock，原因有两个：

1. 扫描逻辑不一定包在一个长事务里，我不希望为了持锁把整个扫描阶段都绑成事务。
2. Laravel 里一旦混入事件、队列分发、只读查询，事务边界很容易被改得和预期不一样。

我的选择标准很简单：

- **事务内极短临界区**：优先 `pg_try_advisory_xact_lock`
- **命令级单实例互斥**：优先 `pg_try_advisory_lock`

别反过来用。曾经有人把 session lock 用在细粒度库存扣减里，结果 worker 异常时整批请求排队；也有人把 xact lock 用在扫描命令里，事务一提交锁就提前释放，后半段分发逻辑直接失去保护。

## 八、压测和回归我怎么做

这类文章如果只讲概念，其实没什么价值。我的回归方式非常土，但很好用：同时起两个终端，各跑一次同样命令，看是否只有一个实例真正进入扫描。

```bash
php artisan orders:scan-compensation
php artisan orders:scan-compensation
```

如果想更接近线上，我会在本地或测试环境里起两个 Pod，同时观察日志：

- 一个实例打印 `lock acquired`
- 另一个实例打印 `scanner skipped`
- `compensation_jobs` 的待处理记录只被分发一轮

然后再专门测异常路径：在拿到锁后手动 `kill -9` 进程，确认 PostgreSQL session 断开后锁会被释放。这个测试让我吃过一次定心丸——团队之前一直以为“异常退出会留下死锁”，结果对 Advisory Lock 来说，只要连接真断了，数据库会替你回收。真正该担心的反而是 **连接没断但业务线程挂死**，这时就得靠超时和监控去发现。

## 九、我最后的结论

Advisory Lock 最适合的，不是所有分布式互斥，而是**那些本来就围着 PostgreSQL 运转、又明确需要单实例入口的后台任务**。它最大的优点是简单、可观测、和数据靠得近；最大的风险则是 session 语义很强，一旦碰上 PgBouncer transaction pooling、Laravel 连接复用、错误的解锁连接，问题会非常隐蔽。

这套改完以后，我们的补偿扫描在 3 个 Pod 同时触发时只会有 1 个实例真正工作，重复推送量从高峰期每小时数百条降到接近 0。对 Laravel 这类大量后台任务都围着数据库转的系统来说，能少一层外部锁服务，有时候就是最实用的稳定性优化。
