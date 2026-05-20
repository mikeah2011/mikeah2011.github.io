---
title: Laravel + PostgreSQL SKIP LOCKED 实战：不用 Redis 也能做任务出队、重试回收与死锁规避
date: 2026-05-03 10:35:34
updated: 2026-05-03 10:39:12
categories:
  - 05_PHP
  - Laravel
tags:
  - Laravel
  - PostgreSQL
  - SKIP LOCKED
  - Queue
  - Concurrency
  - Architecture
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

## 五、几个真正会翻车的坑

### 坑 1：单批 claim 太大
一开始我贪心，单个 worker 一次拿 200 条，想着减少数据库往返。结果慢任务把一大批记录长期占住，其他 worker 虽然有 `SKIP LOCKED`，但能拿到的活越来越碎，尾延迟很差。后来改成 10~20 条一批，整体吞吐反而更稳。

### 坑 2：业务事务和消费事务绑在一起
处理任务时如果你把“查任务、调第三方、写结果”包在一个大事务里，锁会持有到第三方返回为止，`SKIP LOCKED` 也救不了你。正确做法是 **claim 事务极短，业务处理不持有队列锁**。

### 坑 3：没有幂等键
`SKIP LOCKED` 解决的是“重复 claim”，不是“业务绝不重复执行”。只要 worker 在调用第三方成功后、更新 `done` 前崩掉，任务仍可能重试。所以我给支付补单表加了 `channel_order_no + action` 的唯一约束，消费者按幂等写入。

### 坑 4：把它拿去替代真正的 MQ
如果你的场景是高吞吐日志、广播消息、跨机房解耦，这套方案并不合适。它更像是**和业务事务强绑定的可靠作业队列**，不是 Kafka 替身。

## 六、什么时候我会选它

如果你满足下面三条，我会优先考虑 PostgreSQL 队列而不是额外引入 Redis/MQ：

- 任务量中等，峰值不是几十万 TPS
- 任务和业务数据需要同事务落库
- 你更在意审计、回放、补偿，而不是超高吞吐

它不是银弹，但在 Laravel 这种“单体逐步服务化”的阶段非常实用。至少在我这次支付补单项目里，它把一类原本依赖 Redis 轮询、还总出重复消费的任务，收敛成了**数据库内闭环、可观察、可回放**的一套机制。真正的关键不在 `SKIP LOCKED` 四个字，而在于你有没有把 **claim 原子性、超时回收、幂等写入、索引设计** 一起做完整。
