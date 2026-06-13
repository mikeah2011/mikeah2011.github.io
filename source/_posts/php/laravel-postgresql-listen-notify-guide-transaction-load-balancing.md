---
title: Laravel + PostgreSQL LISTEN/NOTIFY 实战：事务提交后事件广播、连接池与负载均衡踩坑记录
date: 2026-05-03 11:10:43
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
updated: 2026-05-03 11:11:39
categories:
  - php
tags: [Laravel, PostgreSQL, PgBouncer, LISTEN/NOTIFY, 消息通知]
keywords: [Laravel, PostgreSQL LISTEN, NOTIFY, 事务提交后事件广播, 连接池与负载均衡踩坑记录, PHP]
description: 基于 Laravel 后台审批与订单状态同步场景，记录一套用 PostgreSQL LISTEN/NOTIFY 做事务提交后事件广播的落地方案。文章涵盖触发器设计、最小 payload 规范、常驻监听进程实现、PgBouncer 兼容分流、重连与丢消息边界处理，并对比 Redis Pub/Sub 与 Kafka 等方案适用范围，帮助团队在单库场景下用数据库内建能力替代重量级消息中间件。



---

很多团队一提到“事件广播”，第一反应就是 Redis、Kafka 或 WebSocket Broker。但在我最近一次后台审批系统改造里，真正卡住我们的不是“有没有 MQ”，而是**数据库事务提交之前发出的副作用**。审批单状态在事务里改成 `approved`，代码马上发 WebSocket、删缓存、写审计；结果事务回滚时，前端已经收到“已通过”，运营还来问为什么页面和数据库不一致。

这次我最后没有再堆 Laravel Event，而是把“提交后再广播”这件事下沉到 **PostgreSQL LISTEN/NOTIFY**：**只有事务真的 commit，通知才会发出去**。它不是 Kafka 替代品，但在“单库内状态变化 -> 通知多个 Laravel 进程做轻量副作用”这个场景里，足够轻、延迟低，而且比应用层手写 `afterCommit` 更难漏。

## 一、适合它的边界先说清楚

我只在这三种情况用 LISTEN/NOTIFY：

1. 事件源就在 PostgreSQL。
2. 通知是轻量的，允许消费者自己补数据。
3. 可以接受“通知层不做持久化消息堆积”。

如果你需要重放、堆积、顺序分区、跨机房稳定消费，还是上 Kafka/RabbitMQ。**LISTEN/NOTIFY 更像数据库内建的提交后信号，而不是正规消息队列。**

## 二、落地后的结构

```text
Admin / API
    │
    ▼
Laravel Service
    │  DB::transaction()
    ▼
PostgreSQL
  ├── update approval_requests set status='approved'
  └── AFTER UPDATE Trigger
          │
          └── pg_notify('approval_events', payload)
                    │  只有 commit 后才真正投递
                    ▼
artisan pg:listen
  ├── 失效审批缓存
  ├── 广播到 Reverb / WebSocket
  └── 投递低优先级 Job 做后续处理
```

我这里的关键设计是：**通知里只放主键、类型、版本，不放大对象快照**。因为 NOTIFY payload 有大小限制，消费者也需要自行兜底查库。

## 三、触发器别直接塞整行 JSON

最开始我偷懒，直接 `row_to_json(NEW)` 丢进 payload。很快就踩到两个坑：一是字段一多马上逼近 8KB 上限；二是前端不需要整行数据，监听端却被迫跟着表结构一起演进。后来改成只发最小事件：

```sql
CREATE OR REPLACE FUNCTION notify_approval_status_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payload json;
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        payload := json_build_object(
            'event', 'approval.status_changed',
            'approval_id', NEW.id,
            'tenant_id', NEW.tenant_id,
            'status', NEW.status,
            'version', NEW.version,
            'occurred_at', extract(epoch from now())
        );

        PERFORM pg_notify('approval_events', payload::text);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_approval_status_changed ON approval_requests;

CREATE TRIGGER trg_notify_approval_status_changed
AFTER UPDATE ON approval_requests
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION notify_approval_status_changed();
```

这里我故意把 `version` 一起发出去。因为监听进程有时会比 API 慢半拍，如果前端已经拿到更高版本状态，旧通知再广播一次，就会出现 UI 回跳。消费者可以据此做幂等或版本比较。

## 四、Laravel 监听进程必须用“专用连接”

应用里最容易写错的地方，是拿业务连接顺手 `LISTEN approval_events`。这样在 FPM、Queue Worker 或 Horizon 里都不稳定，因为请求结束、连接回收、连接池切换时监听状态会丢。我的做法是单独跑一个常驻命令，并强制它走**不经过事务池化的专用 PostgreSQL 连接**。

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use PDO;
use Throwable;

class ListenPostgresNotifications extends Command
{
    protected $signature = 'pg:listen {channel=approval_events}';

    protected $description = 'Listen PostgreSQL notifications and trigger side effects';

    public function handle(): int
    {
        $channel = $this->argument('channel');

        while (true) {
            try {
                $pdo = DB::connection('pgsql_listener')->getPdo();
                $pdo->exec("LISTEN {$channel}");

                while (true) {
                    $notify = $pdo->pgsqlGetNotify(PDO::FETCH_ASSOC, 10000);

                    if ($notify === false) {
                        $pdo->query('SELECT 1');
                        continue;
                    }

                    $payload = json_decode($notify['message'], true, flags: JSON_THROW_ON_ERROR);

                    Cache::tags([
                        'tenant:' . $payload['tenant_id'],
                        'approval:' . $payload['approval_id'],
                    ])->flush();

                    event(new \App\Events\ApprovalStatusChanged(
                        approvalId: (int) $payload['approval_id'],
                        status: (string) $payload['status'],
                        version: (int) $payload['version'],
                    ));

                    Log::info('pg notification handled', $payload);
                }
            } catch (Throwable $e) {
                Log::warning('pg listener reconnecting', ['error' => $e->getMessage()]);
                sleep(2);
            }
        }
    }
}
```

这个命令做三件事：收通知、删细粒度缓存、转成 Laravel 应用内事件。真正耗时的发短信、写第三方审计，我不会直接在这里做，而是继续丢队列，避免监听循环被阻塞。

## 五、数据库配置也要分流

我线上专门拆了一条连接给监听器，避开 PgBouncer 的 transaction pooling：

```php
'pgsql_listener' => [
    'driver' => 'pgsql',
    'host' => env('PG_LISTENER_HOST', '127.0.0.1'),
    'port' => env('PG_LISTENER_PORT', 5432),
    'database' => env('DB_DATABASE'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    'charset' => 'utf8',
    'prefix' => '',
    'schema' => 'public',
    'sslmode' => 'prefer',
],
```

如果你把 LISTEN 连接也接到 PgBouncer 的事务池模式，表面上能连，实际上下一次借到的可能已经不是同一条后端连接，监听通道直接失效。这是我这次最隐蔽、最花时间排查的坑。

## 六、我最后定下来的消费原则

为了让这套方案在生产上更稳，我最后只让通知承担“唤醒”职责，不承担“事实来源”：

- payload 只带最小字段；
- 关键业务判断仍以查库结果为准；
- 监听失败可以重连，但不能指望它补历史；
- 真正需要补偿的动作，一律落 Job 或 Outbox。

这套约束看起来保守，实际上正是它让 LISTEN/NOTIFY 好用：它负责低延迟，持久化一致性仍交给表数据本身。

## 七、这次踩过的 4 个坑

### 1. 事务里 NOTIFY 不会立刻送达

这不是 Bug，而是 PostgreSQL 的正确行为。只有事务提交，监听者才收得到。也正因为如此，它非常适合解决“回滚后副作用已发出”的问题。

### 2. payload 超过限制直接炸

NOTIFY 的 payload 上限不是给你传整个实体的。我的经验是只放：事件名、主键、租户、版本、时间戳。详情靠消费者二次查询。

### 3. PgBouncer transaction pooling 会让监听假活着

日志看起来没报错，进程也在跑，但就是收不到通知。最后抓 `SHOW POOLS` 才发现监听连接被池化切走。监听器必须绕过事务池，或至少用 session pooling。

### 4. 监听进程不能做重活

我一开始在监听循环里直接调第三方 webhook，结果对方抖动时整个监听卡住，后面的通知只能排队。后来改成"监听进程只转发，重活交给队列"，延迟才稳定下来。

## 八、方案对比：LISTEN/NOTIFY vs Redis Pub/Sub vs Kafka

很多团队在选型时会纠结，到底用数据库内建能力还是上独立中间件。下面是我根据实际场景整理的对比：

| 维度 | PostgreSQL LISTEN/NOTIFY | Redis Pub/Sub | Kafka |
|------|--------------------------|---------------|-------|
| **消息持久化** | ❌ 不持久化，丢失即丢失 | ❌ 不持久化（Streams 除外） | ✅ 持久化，可重放 |
| **事务一致性** | ✅ 只有 commit 后才投递 | ❌ 应用层发送，事务回滚仍可能已发 | ❌ 需 Outbox 模式保证 |
| **运维复杂度** | 极低，数据库自带 | 低，需额外 Redis 实例 | 高，需独立集群 |
| **消息堆积** | ❌ 不支持 | ❌ 不支持（Streams 支持） | ✅ 按 offset 任意回溯 |
| **延迟** | 极低（<1ms 本地） | 低（<1ms 本地） | 较高（ms~百ms 级） |
| **适用规模** | 单库、轻量通知、500 连接内 | 中等，多服务共享状态 | 大规模、跨系统事件流 |
| **顺序保证** | 单行级别（同一事务内） | 单 channel 内 | 分区内严格有序 |
| **Laravel 集成** | PDO 原生支持，需常驻进程 | predis/phpredis，Laravel 原生支持 | 需队列驱动（如 kafka-connect） |

**我的选型原则**：

- 如果事件源就在 PostgreSQL，且只需要"通知多进程刷新缓存/推送 UI"→ **LISTEN/NOTIFY 够用**
- 如果需要多服务共享事件、消息回溯 → **Redis Streams 或 Kafka**
- 如果需要跨系统、审计可追溯、严格顺序 → **Kafka + Outbox**

## 九、Supervisor 守护监听进程

生产环境不能只靠 `php artisan pg:listen` 手动跑。用 Supervisor 守护是标准做法：

```ini
; /etc/supervisor/conf.d/pg-listener.conf
[program:pg-listener]
command=php /var/www/artisan pg:listen approval_events
directory=/var/www
autostart=true
autorestart=true
startsecs=5
stopwaitsecs=10
user=www-data
numprocs=1
redirect_stderr=true
stdout_logfile=/var/log/supervisor/pg-listener.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
stopasgroup=true
killasgroup=true
```

关键配置说明：

- `startsecs=5`：启动后 5 秒内不退出才算成功，避免启动失败反复重启
- `autorestart=true`：进程崩溃自动拉起
- `stopwaitsecs=10`：给监听循环足够时间完成当前通知处理再退出
- `numprocs=1`：监听进程只需一个，多个反而会重复消费

## 十、健康检查与监控

监听进程"看起来在跑"但实际已经收不到通知，是生产最常见的隐蔽故障。我加了一层简单的心跳检查：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class PgListenHealthCheck extends Command
{
    protected $signature = 'pg:listen:health {channel=approval_events}';
    protected $description = 'Check if pg listener is alive by inserting a heartbeat row';

    public function handle(): int
    {
        $channel = $this->argument('channel');
        $cacheKey = "pg_listener_heartbeat:{$channel}";

        // 监听进程每次收到通知会更新这个 key
        // 如果超过 60 秒没更新，说明监听可能卡住
        $lastHeartbeat = Cache::get($cacheKey);

        if (!$lastHeartbeat) {
            $this->warn("No heartbeat recorded yet for channel: {$channel}");
            return self::SUCCESS;
        }

        $secondsSince = now()->diffInSeconds($lastHeartbeat);

        if ($secondsSince > 60) {
            $this->error("Listener stale! Last heartbeat {$secondsSince}s ago");
            // 这里可以接告警：发钉钉、Slack、PagerDuty
            return self::FAILURE;
        }

        $this->info("Listener healthy. Last heartbeat {$secondsSince}s ago");
        return self::SUCCESS;
    }
}
```

对应地，在监听命令里加一行心跳更新：

```php
// 在 ListenPostgresNotifications 的 while 循环里，每次处理完通知后加：
Cache::put("pg_listener_heartbeat:{$channel}", now(), 120);
```

## 十一、多 channel 订阅模式

实际项目中，一个监听进程往往要订阅多个 channel（如 `approval_events`、`order_events`、`inventory_events`）。修改监听命令支持多 channel：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use PDO;
use Throwable;

class ListenPostgresMultiChannel extends Command
{
    protected $signature = 'pg:listen:multi {channels*}';
    protected $description = 'Listen on multiple PostgreSQL notification channels';

    public function handle(): int
    {
        $channels = $this->argument('channels');

        while (true) {
            try {
                $pdo = DB::connection('pgsql_listener')->getPdo();

                foreach ($channels as $channel) {
                    $pdo->exec("LISTEN " . PDO::quote($channel, PDO::PARAM_STR));
                    $this->info("Subscribed to: {$channel}");
                }

                while (true) {
                    $notify = $pdo->pgsqlGetNotify(PDO::FETCH_ASSOC, 5000);

                    if ($notify === false) {
                        $pdo->query('SELECT 1');
                        continue;
                    }

                    $channel = $notify['channel'];
                    $payload = json_decode($notify['message'], true, flags: JSON_THROW_ON_ERROR);

                    // 根据 channel 分发到不同的处理器
                    match ($channel) {
                        'approval_events' => $this->handleApprovalEvent($payload),
                        'order_events'    => $this->handleOrderEvent($payload),
                        default            => Log::warning("Unknown channel: {$channel}", $payload),
                    };

                    // 更新心跳
                    \Illuminate\Support\Facades\Cache::put(
                        "pg_listener_heartbeat:{$channel}", now(), 120
                    );
                }
            } catch (Throwable $e) {
                Log::warning('pg listener reconnecting', [
                    'error'   => $e->getMessage(),
                    'channel' => $channels,
                ]);
                sleep(2);
            }
        }
    }

    private function handleApprovalEvent(array $payload): void
    {
        event(new \App\Events\ApprovalStatusChanged(
            approvalId: (int) $payload['approval_id'],
            status: (string) $payload['status'],
            version: (int) $payload['version'],
        ));
    }

    private function handleOrderEvent(array $payload): void
    {
        \App\Jobs\SyncOrderStatus::dispatch(
            orderId: (int) $payload['order_id'],
            status: (string) $payload['status'],
        );
    }
}
```

对应 Supervisor 配置只需一条命令：

```ini
command=php /var/www/artisan pg:listen:multi approval_events order_events inventory_events
```

## 十二、什么时候我会放弃它

如果需求从“数据库状态变化后，通知几个应用实例刷新缓存/推送页面”升级成“必须可靠投递、失败重放、审计可追溯”，我会直接切 Outbox + MQ。**LISTEN/NOTIFY 的优势是简单，不是万能。**

但在这次 Laravel 后台审批场景里，它刚好命中痛点：不再担心事务回滚后的假广播，也不需要为了一个轻量提交后通知再引进一套更重的基础设施。对已经把 PostgreSQL 当主数据库的团队来说，这是一把非常值钱、但经常被忽略的小刀。

## 相关阅读

- [Laravel + PostgreSQL SKIP LOCKED 实战：不用 Redis 也能做任务出队](/categories/PHP/laravel-postgresql-skip-locked-guide-redis-lock/)
- [Laravel + PostgreSQL CDC 实战：Debezium 驱动订单变更同步](/categories/PHP/laravel-postgresql-cdc-guide-debezium/)
- [Laravel Pennant 特性开关实战：多租户分桶、灰度放量与回滚兜底](/categories/PHP/laravel-pennant-guide-canary/)
