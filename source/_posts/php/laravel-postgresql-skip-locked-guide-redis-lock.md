---

title: Laravel + PostgreSQL SKIP LOCKED 实战：不用 Redis 也能做任务出队、重试回收与死锁规避
keywords: [Laravel, PostgreSQL SKIP LOCKED, Redis, 不用, 也能做任务出队, 重试回收与死锁规避, PHP, 数据库]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 10:35:34
updated: 2026-05-03 10:39:12
categories:
  - php
  - database
tags:
- Laravel
- PostgreSQL
- 架构设计
- 消息队列
- 数据库
description: 结合支付补单与库存对账任务，记录如何在 Laravel 中基于 PostgreSQL 的 FOR UPDATE SKIP LOCKED 实现数据库队列，重点覆盖出队并发、超时回收、批处理索引与死锁规避。
---


很多团队一提到异步任务，第一反应就是 Redis、RabbitMQ 或 Kafka。但我在一个 Laravel 后台里做过一类很“尴尬”的任务：支付补单、库存对账、第三方回查，量级不算大，却要求**强一致、可审计、失败可回放**。这类任务如果再引入一套外部 MQ，维护成本不低；直接塞进 `jobs` 表又容易被并发 worker 抢成一团。后来真正稳定跑起来，靠的不是“轮询 + status 字段”，而是 PostgreSQL 的 `FOR UPDATE SKIP LOCKED`。

它的价值很直接：**多个 worker 同时从同一张表取任务时，谁先锁到谁处理，其他 worker 跳过已锁记录继续拿下一批**。这样不会互相阻塞，也不会把同一条任务发给多个进程。

## 一、我最终落地的架构

```text
               ┌──────────────────────┐
HTTP / Cron ──▶│ domain service       │
               │ enqueue job row      │
               └──────────┬───────────┘
                          │
                          ▼
               ┌──────────────────────┐
               │ postgres job_queue   │
               │ pending/running/...  │
               └───────┬───────┬──────┘
                       │       │
        SKIP LOCKED ───┘       └─── timeout reaper
                       ▼
              ┌──────────────────────┐
              │ laravel workers      │
              │ claim -> handle      │
              │ ack / retry / fail   │
              └──────────────────────┘
```

我没有把它当成“通用大队列”，而是只承接需要事务一致性的任务：

- 下单后 5 分钟补查支付状态
- 对账系统批量回查渠道单
- 补发库存修正事件
- 失败任务人工回放

这些任务的共同点是：**生产者和业务数据天然在同一个数据库事务里**。这时把任务也落在 PostgreSQL，反而最省心。

## 二、表结构不是重点，索引才是

先给出我线上用过的一版精简表：

```sql
create table job_queue (
    id bigserial primary key,
    topic varchar(64) not null,
    payload jsonb not null,
    status varchar(16) not null default 'pending',
    available_at timestamp not null default now(),
    reserved_at timestamp null,
    attempts integer not null default 0,
    max_attempts integer not null default 6,
    worker_id varchar(64) null,
    last_error text null,
    created_at timestamp not null default now(),
    updated_at timestamp not null default now()
);

create index idx_job_queue_fetch
    on job_queue (status, available_at, id)
    where status = 'pending';

create index idx_job_queue_running
    on job_queue (status, reserved_at)
    where status = 'running';
```

这里我踩过一个很真实的坑：最开始只建了 `status` 索引，结果 worker 一多，`available_at <= now()` 的范围过滤开始走回表，批量 claim 从 8ms 飙到 120ms。后来改成**部分索引 + 顺序字段对齐 claim SQL**，CPU 才降下来。

## 三、在 Laravel 里正确 claim 任务

核心不是 `select`，而是**在一个事务里先锁再改状态**。我最终用的是两段式 CTE：

```php
<?php

namespace App\Repositories;

use Illuminate\Support\Facades\DB;

class PgJobQueueRepository
{
    public function claim(string $workerId, int $limit = 10): array
    {
        return DB::transaction(function () use ($workerId, $limit) {
            $sql = <<<'SQL'
with picked as (
    select id
    from job_queue
    where status = 'pending'
      and available_at <= now()
    order by available_at, id
    for update skip locked
    limit :limit
)
update job_queue jq
set status = 'running',
    reserved_at = now(),
    worker_id = :worker_id,
    attempts = attempts + 1,
    updated_at = now()
from picked
where jq.id = picked.id
returning jq.id, jq.topic, jq.payload, jq.attempts, jq.max_attempts;
SQL;

            return DB::select($sql, [
                'limit' => $limit,
                'worker_id' => $workerId,
            ]);
        }, 3);
    }
}
```

这个写法有两个好处：

1. `SKIP LOCKED` 让多个 worker 并发 claim 时互不等待。
2. `UPDATE ... RETURNING` 保证“拿到任务”和“标记 running”是原子动作。

如果你先 `select` 出来，再循环 `update status`，高并发下一定会出现重复消费。

## 四、Worker 处理和重试回收

Laravel Command 我会写得很克制：每次只拉一小批，处理完立刻 ack，避免长事务。

```php
<?php

namespace App\Console\Commands;

use App\Repositories\PgJobQueueRepository;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class ConsumePgQueue extends Command
{
    protected $signature = 'queue:consume-pg {--limit=20}';

    public function handle(PgJobQueueRepository $repo): int
    {
        $workerId = gethostname() . '-' . getmypid();
        $jobs = $repo->claim($workerId, (int) $this->option('limit'));

        foreach ($jobs as $job) {
            try {
                app(\App\Services\JobRouter::class)->handle($job->topic, json_decode($job->payload, true));

                DB::table('job_queue')
                    ->where('id', $job->id)
                    ->where('worker_id', $workerId)
                    ->update([
                        'status' => 'done',
                        'updated_at' => now(),
                    ]);
            } catch (Throwable $e) {
                $nextStatus = $job->attempts >= $job->max_attempts ? 'failed' : 'pending';

                DB::table('job_queue')
                    ->where('id', $job->id)
                    ->update([
                        'status' => $nextStatus,
                        'available_at' => now()->addSeconds(min(300, $job->attempts * 15)),
                        'last_error' => mb_substr($e->getMessage(), 0, 1000),
                        'worker_id' => null,
                        'reserved_at' => null,
                        'updated_at' => now(),
                    ]);
            }
        }

        return self::SUCCESS;
    }
}
```

另外必须有一个“回收器”，专门把超时未完成的 `running` 任务捞回去：

```sql
update job_queue
set status = 'pending',
    worker_id = null,
    reserved_at = null,
    available_at = now() + interval '30 seconds',
    updated_at = now()
where status = 'running'
  and reserved_at < now() - interval '10 minutes';
```

这个回收器救过我一次线上事故：某台机器在处理补单时进程被 OOM 杀掉，没有 ack，也没有 fail，任务永远挂在 `running`。如果没有 reaper，只能人工改库。

## 五、完整的 Job 类封装

实际项目中，每个任务的业务逻辑通常由独立的类封装。下面是一个完整的支付补单 Job 实现，包含超时控制、失败重试和死信写入：

```php
<?php

namespace App\Jobs;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Throwable;

class PaymentReconciliationJob
{
    public int $timeout = 120;   // 单任务最长执行 120 秒
    public int $maxAttempts = 6;

    public function __construct(
        public readonly int $jobId,
        public readonly string $channelOrderNo,
        public readonly string $action,
    ) {}

    public function handle(): void
    {
        Log::info('开始处理支付补单', [
            'job_id' => $this->jobId,
            'channel_order_no' => $this->channelOrderNo,
        ]);

        // 1. 查询渠道支付状态
        $channelStatus = $this->queryChannelPaymentStatus($this->channelOrderNo);

        // 2. 幂等写入结果（利用 channel_order_no + action 唯一约束）
        DB::transaction(function () use ($channelStatus) {
            DB::table('payment_reconciliation')->upsert([
                [
                    'channel_order_no' => $this->channelOrderNo,
                    'action' => $this->action,
                    'channel_status' => $channelStatus,
                    'reconciled_at' => now(),
                ],
            ], ['channel_order_no', 'action'], ['channel_status', 'reconciled_at']);

            // 3. 如果渠道已支付但本地未更新，触发补单
            if ($channelStatus === 'paid') {
                DB::table('orders')
                    ->where('channel_order_no', $this->channelOrderNo)
                    ->where('status', 'pending')
                    ->update(['status' => 'paid', 'paid_at' => now()]);
            }
        });

        Log::info('支付补单处理完成', [
            'job_id' => $this->jobId,
            'channel_status' => $channelStatus,
        ]);
    }

    public function failed(Throwable $e): void
    {
        Log::error('支付补单最终失败', [
            'job_id' => $this->jobId,
            'channel_order_no' => $this->channelOrderNo,
            'error' => $e->getMessage(),
        ]);

        // 写入死信表供人工回放
        DB::table('job_queue_dead_letter')->insert([
            'original_job_id' => $this->jobId,
            'topic' => 'payment.reconciliation',
            'payload' => json_encode([
                'channel_order_no' => $this->channelOrderNo,
                'action' => $this->action,
            ]),
            'last_error' => mb_substr($e->getMessage(), 0, 2000),
            'failed_at' => now(),
        ]);
    }

    private function queryChannelPaymentStatus(string $channelOrderNo): string
    {
        $response = Http::timeout(10)->get(
            "https://api.payment.example/status/{$channelOrderNo}"
        );

        if (!$response->successful()) {
            throw new \RuntimeException('渠道查询失败: HTTP ' . $response->status());
        }

        return $response->json('status');
    }
}
```

关键设计点：

- `$timeout = 120`：防止任务卡死占用 worker 进程。
- `failed()`：将最终失败的任务写入死信表，支持人工排查与回放。
- 幂等写入：利用数据库唯一约束 `(channel_order_no, action)` 确保即使重复执行也不会产生脏数据。

## 六、Worker Supervisor 进程管理

生产环境需要进程管理器保证 worker 持续运行、崩溃自动重启：

```ini
[program:pg-queue-worker]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/artisan queue:consume-pg --limit=15
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
user=www-data
numprocs=4
redirect_stderr=true
stdout_logfile=/var/log/pg-queue-worker.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stopwaitsecs=30
```

关键参数说明：

- `numprocs=4`：4 个 worker 进程配合 `SKIP LOCKED` 实现并行消费。
- `stopwaitsecs=30`：停止时给 worker 30 秒完成当前任务。
- `stopasgroup=true` / `killasgroup=true`：确保停止时杀掉整个进程组，避免孤儿进程。

### 优雅重启

部署新代码时，先发信号让 worker 处理完当前任务再退出：

```bash
supervisorctl stop pg-queue-worker:*
sleep 5   # 等待正在执行的任务完成
supervisorctl start pg-queue-worker:*
```

或者在 worker 循环中检查重启标志，实现更平滑的重启：

```php
// 在 ConsumePgQueue Command 的循环中
while (true) {
    if (file_exists(storage_path('framework/queue-restart'))) {
        $this->info('收到重启信号，优雅退出...');
        break;
    }

    $jobs = $repo->claim($workerId, 15);
    if (empty($jobs)) {
        sleep(2); // 无任务时降低轮询频率
        continue;
    }

    foreach ($jobs as $job) {
        // ... 处理逻辑（同第四节）
    }
}
```

## 七、超时回收器的完整实现

前面只给了 SQL，这里是一个完整的 Laravel Command，支持配置化和 dry-run：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Console\Scheduling\Schedule;

class ReaperStuckJobs extends Command
{
    protected $signature = 'queue:reaper
                            {--timeout=10 : 超时阈值，单位分钟}
                            {--delay=30 : 回收后重新可执行的延迟秒数}
                            {--dry-run : 只检查不执行}';

    protected $description = '回收超时未完成的 running 任务';

    public function handle(): int
    {
        $timeoutMinutes = (int) $this->option('timeout');
        $delaySeconds = (int) $this->option('delay');
        $dryRun = $this->option('dry-run');

        $stuckJobs = DB::table('job_queue')
            ->where('status', 'running')
            ->where('reserved_at', '<', now()->subMinutes($timeoutMinutes))
            ->select(['id', 'topic', 'worker_id', 'attempts', 'reserved_at'])
            ->get();

        if ($stuckJobs->isEmpty()) {
            $this->info('没有发现超时任务');
            return self::SUCCESS;
        }

        $this->table(
            ['ID', 'Topic', 'Worker', 'Attempts', 'Reserved At'],
            $stuckJobs->map(fn ($j) => [$j->id, $j->topic, $j->worker_id, $j->attempts, $j->reserved_at])
        );

        if ($dryRun) {
            $this->warn("Dry-run：发现 {$stuckJobs->count()} 条超时任务，未执行回收");
            return self::SUCCESS;
        }

        $recovered = DB::table('job_queue')
            ->where('status', 'running')
            ->where('reserved_at', '<', now()->subMinutes($timeoutMinutes))
            ->update([
                'status' => 'pending',
                'worker_id' => null,
                'reserved_at' => null,
                'available_at' => now()->addSeconds($delaySeconds),
                'updated_at' => now(),
            ]);

        Log::warning('回收超时任务', [
            'count' => $recovered,
            'timeout_minutes' => $timeoutMinutes,
        ]);

        $this->info("已回收 {$recovered} 条超时任务");
        return self::SUCCESS;
    }
}
```

通过 Laravel 调度器每分钟执行：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    $schedule->command('queue:reaper --timeout=10')
             ->everyMinute()
             ->withoutOverlapping();
}
```

## 八、与 Redis 队列的全面对比

选型时的常见纠结：PostgreSQL 队列还是 Redis 队列？下面从多个维度详细对比：

| 维度 | PostgreSQL SKIP LOCKED 队列 | Redis 队列（Laravel Redis Driver） |
|------|---------------------------|-----------------------------------|
| **持久性** | ✅ 天然持久化，数据写入 WAL 即落盘 | ⚠️ 依赖 AOF/RDB，默认异步持久化可能丢数据 |
| **事务一致性** | ✅ 与业务数据同库同事务，天然强一致 | ❌ 跨系统事务，需额外补偿机制 |
| **可观测性** | ✅ 直接 SQL 查询任务状态、延迟、错误 | ⚠️ 需要额外工具（Horizon）或自行埋点 |
| **吞吐量** | ⚠️ 千级~万级 QPS（受连接数限制） | ✅ 十万级 QPS，内存操作极快 |
| **延迟** | ⚠️ 毫秒级（受磁盘 IO 影响） | ✅ 亚毫秒级 |
| **运维复杂度** | ✅ 无额外组件，复用现有 PostgreSQL | ⚠️ 需额外维护 Redis 实例及集群 |
| **死信处理** | ✅ 原生 SQL 改状态，支持人工回放 | ⚠️ 需额外实现死信队列 |
| **消息回放** | ✅ 按条件 UPDATE 重新入队 | ❌ 消费后即删除，回放困难 |
| **适用场景** | 低中吞吐、强一致、可审计 | 高吞吐、最终一致、实时性优先 |
| **成本** | ✅ 零额外基础设施成本 | ⚠️ 需额外 Redis 实例及内存 |

### 混合架构：各取所长

两种方案并不互斥，常见的混合架构：

```text
业务事务性任务 → PostgreSQL 队列（支付补单、库存对账）
高吞吐异步任务 → Redis 队列（日志收集、推送通知、缓存刷新）
```

这样既保证核心业务的强一致性和可审计性，又不会因为高频任务拖慢数据库。

## 九、几个真正会翻车的坑

### 坑 1：单批 claim 太大
一开始我贪心，单个 worker 一次拿 200 条，想着减少数据库往返。结果慢任务把一大批记录长期占住，其他 worker 虽然有 `SKIP LOCKED`，但能拿到的活越来越碎，尾延迟很差。后来改成 10~20 条一批，整体吞吐反而更稳。

### 坑 2：业务事务和消费事务绑在一起
处理任务时如果你把"查任务、调第三方、写结果"包在一个大事务里，锁会持有到第三方返回为止，`SKIP LOCKED` 也救不了你。正确做法是 **claim 事务极短，业务处理不持有队列锁**。

### 坑 3：没有幂等键
`SKIP LOCKED` 解决的是"重复 claim"，不是"业务绝不重复执行"。只要 worker 在调用第三方成功后、更新 `done` 前崩掉，任务仍可能重试。所以我给支付补单表加了 `channel_order_no + action` 的唯一约束，消费者按幂等写入。

### 坑 4：把它拿去替代真正的 MQ
如果你的场景是高吞吐日志、广播消息、跨机房解耦，这套方案并不合适。它更像是**和业务事务强绑定的可靠作业队列**，不是 Kafka 替身。

## 十、什么时候我会选它

如果你满足下面三条，我会优先考虑 PostgreSQL 队列而不是额外引入 Redis/MQ：

- 任务量中等，峰值不是几十万 TPS
- 任务和业务数据需要同事务落库
- 你更在意审计、回放、补偿，而不是超高吞吐

它不是银弹，但在 Laravel 这种"单体逐步服务化"的阶段非常实用。至少在我这次支付补单项目里，它把一类原本依赖 Redis 轮询、还总出重复消费的任务，收敛成了**数据库内闭环、可观察、可回放**的一套机制。真正的关键不在 `SKIP LOCKED` 四个字，而在于你有没有把 **claim 原子性、超时回收、幂等写入、索引设计** 一起做完整。

## 相关阅读

- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/architecture/kafka-debezium-cdc-实战-数据库变更事件流-laravel互补架构/)
- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/architecture/saga-编排模式深度实战-choreography-vs-orchestration-vs-temporal-laravel分布式事务的三种实现路线对比/)
- [Idempotency Key 深度实战：API 幂等性的三层防护——请求去重、结果缓存与分布式锁的工程化方案](/architecture/idempotency-key-深度实战-api幂等性的三层防护/)

