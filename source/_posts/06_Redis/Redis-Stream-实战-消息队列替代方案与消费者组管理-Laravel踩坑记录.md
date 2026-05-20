---
title: Redis Stream 实战：消息队列替代方案与消费者组管理 Laravel 踩坑记录
date: 2026-05-16 13:00:44
updated: 2026-05-16 13:03:40
categories:
  - Redis
tags: [Laravel, Redis, 微服务, 消息队列]
description: >
  在 B2C 电商项目中，不是所有异步场景都需要引入 RabbitMQ 或 Kafka。
  Redis Stream 5.0+ 提供了轻量级消息队列能力：消费者组、ACK 机制、Pending 队列、
  ID 自动生成。本文基于 KKday B2C API 真实项目，记录 Redis Stream 替代传统 MQ
  的落地经验、Laravel 集成方案与生产环境踩坑。
---

## 为什么选 Redis Stream？

在 KKday B2C 项目中，我们有大量「轻量级异步任务」场景：

- 订单状态变更通知（写入审计日志、推送 WebSocket）
- 库存扣减事件广播（跨服务同步）
- 用户行为埋点（浏览、收藏、加购）

这些场景有几个共同特点：

1. **吞吐量中等**（每秒几百到几千条），不需要 Kafka 的百万级能力
2. **需要消费确认**，不能像 Redis Pub/Sub 那样 fire-and-forget
3. **已有 Redis 基础设施**，不想再引入 RabbitMQ 增加运维复杂度
4. **需要消费者组**，多个消费者分摊消息，避免重复处理

Redis Stream（5.0+）正好填补了这个空白。

### 架构全景图

```
┌─────────────────────────────────────────────────────────┐
│                    Laravel Application                   │
│                                                         │
│  ┌─────────┐    ┌──────────┐    ┌───────────────────┐   │
│  │ Order   │    │ Stream   │    │ Stream Consumer   │   │
│  │Service  │───▶│ Producer │    │ (Queue Worker)    │   │
│  └─────────┘    └────┬─────┘    └────────┬──────────┘   │
│                      │                    │              │
└──────────────────────┼────────────────────┼──────────────┘
                       │                    │
                       ▼                    ▼
              ┌──────────────────────────────────┐
              │         Redis Server             │
              │                                  │
              │  ┌────────────────────────────┐  │
              │  │  Stream: order_events      │  │
              │  │  ├─ 1686902400000-0         │  │
              │  │  ├─ 1686902400001-1         │  │
              │  │  └─ ...                     │  │
              │  │                             │  │
              │  │  Consumer Group: workers    │  │
              │  │  ├─ consumer-1 (last: 001)  │  │
              │  │  ├─ consumer-2 (last: 002)  │  │
              │  │  └─ Pending List (PEL)      │  │
              │  └────────────────────────────┘  │
              └──────────────────────────────────┘
```

---

## 核心命令速查

### 1. 生产消息：XADD

```bash
# 基本写入（自动生成 ID: 时间戳-序号）
XADD order_events * event order.created order_id 12345 user_id 67890
# 返回: "1686902400000-0"

# 指定最大长度（防止内存无限增长）
XADD order_events MAXLEN ~ 100000 * event order.paid order_id 12345
```

### 2. 消费者组创建：XGROUP CREATE

```bash
# 创建消费者组（0 表示从头消费，$ 表示只消费新消息）
XGROUP CREATE order_events workers 0 MKSTREAM
```

### 3. 消费消息：XREADGROUP

```bash
# 消费者 worker-1 读取 1 条消息，阻塞 5 秒
XREADGROUP GROUP workers worker-1 COUNT 1 BLOCK 5000 STREAMS order_events >
```

`>` 是特殊的 ID，表示「只投递尚未分配给任何消费者的新消息」。

### 4. 确认消息：XACK

```bash
# 处理成功后确认，消息从 PEL（Pending Entry List）移除
XACK order_events workers 1686902400000-0
```

### 5. 查看待处理消息：XPENDING

```bash
# 查看消费者组的 Pending 概览
XPENDING order_events workers

# 查看详细 Pending 列表（0 到 + 表示全部范围）
XPENDING order_events workers - + 10
```

---

## Laravel 集成：自定义 Stream 驱动

Laravel 内置的 Queue 驱动不包含 Redis Stream，我们需要自己封装。

### StreamProducer：写入消息

```php
<?php

namespace App\Stream;

use Illuminate\Support\Facades\Redis;

class StreamProducer
{
    /**
     * 写入一条消息到 Redis Stream
     *
     * @param string $stream  Stream 名称
     * @param array  $payload 消息体
     * @param int    $maxLen  最大长度（approximate）
     * @return string 消息 ID
     */
    public function publish(string $stream, array $payload, int $maxLen = 100000): string
    {
        $id = Redis::command('XADD', [
            $stream,
            'MAXLEN', '~', $maxLen,
            '*',
            'data', json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]);

        return $id;
    }

    /**
     * 批量写入（Pipeline 优化）
     */
    public function publishBatch(string $stream, array $messages, int $maxLen = 100000): array
    {
        $ids = [];
        Redis::pipeline(function ($pipe) use ($stream, $messages, $maxLen, &$ids) {
            foreach ($messages as $payload) {
                $ids[] = $pipe->command('XADD', [
                    $stream,
                    'MAXLEN', '~', $maxLen,
                    '*',
                    'data', json_encode($payload, JSON_UNESCAPED_UNICODE),
                ]);
            }
        });

        return $ids;
    }
}
```

### StreamConsumer：消费消息

```php
<?php

namespace App\Stream;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class StreamConsumer
{
    private string $consumerName;
    private string $group;
    private string $stream;
    private int $blockMs;
    private int $count;

    public function __construct(
        string $stream,
        string $group,
        ?string $consumerName = null,
        int $blockMs = 5000,
        int $count = 10,
    ) {
        $this->stream = $stream;
        $this->group = $group;
        $this->consumerName = $consumerName ?? 'consumer-' . Str::random(8);
        $this->blockMs = $blockMs;
        $this->count = $count;
    }

    /**
     * 确保消费者组存在
     */
    public function ensureGroup(): void
    {
        try {
            Redis::command('XGROUP', [
                'CREATE', $this->stream, $this->group, '0', 'MKSTREAM',
            ]);
        } catch (\Exception $e) {
            // BUSYGROUP = 已存在，忽略
            if (str_contains($e->getMessage(), 'BUSYGROUP')) {
                return;
            }
            throw $e;
        }
    }

    /**
     * 消费一批消息
     *
     * @return array{[id: string, data: array]} 消息列表
     */
    public function consume(): array
    {
        $results = Redis::command('XREADGROUP', [
            'GROUP', $this->group, $this->consumerName,
            'COUNT', $this->count,
            'BLOCK', $this->blockMs,
            'STREAMS', $this->stream,
            '>',  // 只读取新消息
        ]);

        if (empty($results)) {
            return [];
        }

        $messages = [];
        foreach ($results[$this->stream] ?? [] as [$id, $fields]) {
            $messages[] = [
                'id' => $id,
                'data' => json_decode($fields['data'] ?? '{}', true),
            ];
        }

        return $messages;
    }

    /**
     * 确认消息
     */
    public function ack(string $id): bool
    {
        return (bool) Redis::command('XACK', [
            $this->stream, $this->group, $id,
        ]);
    }

    /**
     * 批量确认
     */
    public function ackBatch(array $ids): int
    {
        return (int) Redis::command('XACK', array_merge(
            [$this->stream, $this->group],
            $ids,
        ));
    }

    /**
     * 获取 Pending 消息（用于死信处理/重试）
     */
    public function getPendingMessages(int $count = 100): array
    {
        return Redis::command('XPENDING', [
            $this->stream, $this->group,
            '-', '+', $count,
        ]);
    }

    /**
     * 认领超时消息（其他消费者挂了，接管它的未确认消息）
     */
    public function claimIdleMessages(int $minIdleMs = 60000, int $count = 10): array
    {
        $claimed = Redis::command('XCLAIM', [
            $this->stream, $this->group, $this->consumerName,
            $minIdleMs,
            ...$this->getStaleIds($minIdleMs, $count),
        ]);

        return $claimed;
    }

    private function getStaleIds(int $minIdleMs, int $count): array
    {
        $pending = Redis::command('XPENDING', [
            $this->stream, $this->group,
            'IDLE', $minIdleMs,
            '-', '+', $count,
        ]);

        return array_column($pending, 0); // 返回消息 ID 列表
    }
}
```

### Artisan 命令：Stream Worker

```php
<?php

namespace App\Console\Commands;

use App\Stream\StreamConsumer;
use Illuminate\Console\Command;

class StreamWorker extends Command
{
    protected $signature = 'stream:work
        {--stream=order_events : Stream 名称}
        {--group=workers : 消费者组}
        {--sleep=1 : 无消息时休眠秒数}
        {--max-retries=3 : 最大重试次数}';

    protected $description = '消费 Redis Stream 消息';

    public function handle(): int
    {
        $stream = $this->option('stream');
        $group = $this->option('group');

        $consumer = new StreamConsumer($stream, $group);
        $consumer->ensureGroup();

        $this->info("Listening on stream [{$stream}] group [{$group}]...");

        while (true) {
            try {
                $messages = $consumer->consume();

                if (empty($messages)) {
                    sleep((int) $this->option('sleep'));
                    continue;
                }

                foreach ($messages as $message) {
                    $this->processMessage($consumer, $message);
                }
            } catch (\Throwable $e) {
                $this->error("Consumer error: {$e->getMessage()}");
                report($e);
                sleep(5);
            }
        }
    }

    private function processMessage(StreamConsumer $consumer, array $message): void
    {
        $id = $message['id'];
        $data = $message['data'];
        $event = $data['event'] ?? 'unknown';

        try {
            // 分发到对应的 Handler
            match ($event) {
                'order.created' => $this->handleOrderCreated($data),
                'order.paid'    => $this->handleOrderPaid($data),
                'inventory.low' => $this->handleInventoryLow($data),
                default         => $this->warn("Unknown event: {$event}"),
            };

            // 处理成功 → ACK
            $consumer->ack($id);
        } catch (\Throwable $e) {
            $this->error("Failed to process {$id}: {$e->getMessage()}");

            // 不 ACK → 消息留在 PEL，等待重试或死信处理
            // 注意：不要在此处 catch-and-forget
            report($e);
        }
    }

    private function handleOrderCreated(array $data): void
    {
        // 写审计日志、推送通知等
        \Log::info('Order created', $data);
    }

    private function handleOrderPaid(array $data): void
    {
        // 触发发货流程
        \Log::info('Order paid', $data);
    }

    private function handleInventoryLow(array $data): void
    {
        // 发送库存预警
        \Log::warning('Inventory low', $data);
    }
}
```

---

## 踩坑记录：生产环境的 5 个血泪教训

### 踩坑 1：PEL 无限增长导致内存爆掉

**现象**：线上运行两周后，Redis 内存持续增长，排查发现 `order_events` 的 PEL（Pending Entry List）积压了 50 万条。

**根因**：消费者处理消息时抛异常，消息未 ACK，一直在 PEL 中。如果不主动清理，PEL 只会增长不会减少。

**解决方案**：增加定时任务，对超过一定时间的 Pending 消息进行兜底处理：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;

class StreamDeadLetter extends Command
{
    protected $signature = 'stream:dead-letter
        {--stream=order_events}
        {--group=workers}
        {--min-idle=300000 : 超过 5 分钟未 ACK 的消息}';

    public function handle(): int
    {
        $stream = $this->option('stream');
        $group = $this->option('group');
        $minIdle = (int) $this->option('min-idle');

        // 自动 Claim 超时消息
        $claimed = Redis::command('XAUTOCLAIM', [
            $stream, $group, 'dead-letter-consumer',
            $minIdle, '0-0', 'COUNT', 100,
        });

        [$nextId, $messages] = $claimed;

        if (empty($messages)) {
            $this->info('No stale messages found.');
            return 0;
        }

        $this->info("Claimed " . count($messages) . " stale messages.");

        foreach ($messages as [$id, $fields]) {
            $data = json_decode($fields['data'] ?? '{}', true);

            // 写入死信表
            \DB::table('stream_dead_letters')->insert([
                'stream' => $stream,
                'message_id' => $id,
                'payload' => json_encode($data),
                'claimed_at' => now(),
            ]);

            // ACK 掉，从 PEL 移除
            Redis::command('XACK', [$stream, $group, $id]);
        }

        return 0;
    }
}
```

### 踩坑 2：MAXLEN 设置不当导致 OOM

**现象**：压测时没有设置 MAXLEN，Stream 长度飙到 500 万条，Redis 内存从 2GB 涨到 8GB。

**根因**：XADD 默认不限制 Stream 长度，消息会无限累积。

**解决方案**：

```php
// 写入时强制限制
Redis::command('XADD', [
    'order_events',
    'MAXLEN', '~', 100000,  // ~ 表示近似裁剪，性能更好
    '*',
    'data', json_encode($payload),
]);

// 定期手动裁剪（适合已有 Stream 的补救）
Redis::command('XTRIM', ['order_events', 'MAXLEN', '~', 100000]);
```

> **关键**：`~`（approximate）比精确裁剪性能好 10 倍以上。Redis 底层用 Radix Tree 存储 Stream，近似裁剪可以整节点删除，避免逐条释放。

### 踩坑 3：消费者崩溃后消息被「吞掉」

**现象**：消费者进程 OOM 被 Kill，未 ACK 的消息既不在 PEL 中，也不会被重新投递。

**根因**：消费者使用 `>` 读取新消息后，如果在 ACK 之前崩溃，消息会留在 PEL。但如果消费者没有调用 XREADGROUP 就崩溃了，消息根本没被分配。问题在于我们用了 `XREAD`（非消费者组模式）而不是 `XREADGROUP`。

**解决方案**：始终使用消费者组模式（XREADGROUP），不要用 XREAD：

```php
// ❌ 错误：XREAD 没有消费者组，无法 ACK，无法重试
$results = Redis::command('XREAD', [
    'COUNT', 10, 'BLOCK', 5000,
    'STREAMS', 'order_events', '$',
]);

// ✅ 正确：XREADGROUP + ACK
$results = Redis::command('XREADGROUP', [
    'GROUP', 'workers', 'worker-1',
    'COUNT', 10, 'BLOCK', 5000,
    'STREAMS', 'order_events', '>',
]);
```

### 踩坑 4：多实例部署时 ID 冲突

**现象**：部署 3 个消费者实例，发现偶尔有消息丢失或重复处理。

**根因**：Redis Stream 的 ID 格式是 `{timestamp}-{sequence}`，同一毫秒内的多条消息通过 sequence 递增区分。在高并发写入时，如果系统时钟有微小偏差（NTP 同步导致），可能导致 ID 顺序异常。

**解决方案**：

```php
// 不要自己生成 ID，始终用 * 让 Redis 自动生成
// ❌ 错误
$id = time() . '-0';
Redis::command('XADD', ['order_events', $id, 'data', '...']);

// ✅ 正确
Redis::command('XADD', ['order_events', '*', 'data', '...']);
```

另外，消费者端要做幂等处理，不要依赖 Stream ID 做业务去重：

```php
private function handleOrderCreated(array $data): void
{
    $orderId = $data['order_id'];

    // 用业务 ID 做幂等检查
    $lockKey = "processed:order.created:{$orderId}";
    if (!Redis::set($lockKey, 1, 'NX', 'EX', 86400)) {
        return; // 已处理过，跳过
    }

    // 执行业务逻辑...
}
```

### 踩坑 5：Redis Cluster 模式下 Stream 的坑

**现象**：在 Redis Cluster 中使用消费者组，偶尔报 `CROSSSLOT` 错误。

**根因**：Redis Cluster 要求同一操作涉及的 key 必须在同一个 slot。`XREADGROUP` 同时消费多个 Stream 时，如果这些 Stream 的 key 不在同一个 slot，就会报错。

**解决方案**：

```php
// 使用 Hash Tag 强制同一 slot
// ❌ 可能分布在不同 slot
$streams = ['order_events', 'payment_events', 'inventory_events'];

// ✅ 使用 {business} 前缀，确保同一 slot
$streams = ['{b2c}:order_events', '{b2c}:payment_events', '{b2c}:inventory_events'];
```

如果确实需要跨 slot 消费，只能拆分为多个独立的 XREADGROUP 调用。

---

## 性能对比：Redis Stream vs RabbitMQ vs Laravel Queue (Redis Driver)

| 维度 | Redis Stream | RabbitMQ | Laravel Queue (Redis) |
|------|-------------|----------|----------------------|
| 吞吐量 | ~100K msg/s | ~50K msg/s | ~30K msg/s |
| 消费者组 | ✅ 原生支持 | ✅ Exchange + Queue | ✅ 通过 Redis List 模拟 |
| 消息确认 | ✅ ACK + PEL | ✅ ACK/NACK | ✅ 通过 DELETE |
| 死信队列 | ⚠️ 需自建 | ✅ 原生 DLX | ⚠️ 需自建 |
| 持久化 | ✅ AOF/RDB | ✅ 磁盘持久化 | ✅ 依赖 Redis |
| 消息回溯 | ✅ 可按 ID 范围查询 | ❌ 消费后删除 | ❌ 消费后删除 |
| 运维成本 | 低（复用 Redis） | 高（独立服务） | 低（复用 Redis） |
| 适用场景 | 轻量级事件流 | 企业级消息中间件 | 简单任务队列 |

**结论**：如果你已经在用 Redis，且场景是「事件流 + 消费者组 + 消息回溯」，Redis Stream 是性价比最高的选择。如果需要复杂的路由规则（Topic/Headers Exchange）、事务消息、优先级队列，还是用 RabbitMQ。

---

## 适用场景判断框架

```
需要消息队列吗？
├── 不需要 → 用 Laravel Events & Listeners（同步）
├── 需要，但简单
│   ├── 只需延迟/定时 → Laravel Queue (Redis Driver)
│   └── 需要消费者组 + ACK → Redis Stream ✅
├── 需要，但复杂
│   ├── 路由规则、优先级、死信 → RabbitMQ
│   └── 海量数据、流处理、回溯 → Kafka
└── 不确定 → 先用 Redis Stream，后期再迁移
```

---

## 总结

Redis Stream 不是要替代 RabbitMQ 或 Kafka，而是在「轻量级事件流」这个细分场景下，提供了一个零额外运维成本的方案。在 KKday B2C 项目中，我们用 Redis Stream 处理了 80% 的异步事件（订单通知、埋点、库存同步），只有 20% 的复杂场景（跨系统对接、金融对账）才引入 RabbitMQ。

关键 takeaway：

1. **永远用消费者组（XREADGROUP）**，不要用裸 XREAD
2. **MAXLEN ~ 必须设置**，防止内存无限增长
3. **PEL 要有兜底清理**，消费者崩溃后的死信处理不可忽略
4. **业务幂等不能省**，Stream ID 不等于业务唯一标识
5. **Cluster 模式用 Hash Tag**，避免 CROSSSLOT 错误
