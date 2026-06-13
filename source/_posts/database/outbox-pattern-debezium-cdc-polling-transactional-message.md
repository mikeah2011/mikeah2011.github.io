---

title: Outbox Pattern 深度实战：保证数据库与消息队列的最终一致性——Debezium CDC vs 轮询 vs 事务消息的选型决策
keywords: [Outbox Pattern, Debezium CDC vs, 深度实战, 保证数据库与消息队列的最终一致性, 轮询, 事务消息的选型决策]
date: 2026-06-06 10:00:00
tags:
- Outbox Pattern
- Debezium
- CDC
- 消息队列
- 一致性
- 分布式
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
description: 微服务架构中数据库与消息队列的双写问题如何解决？本文深度实战 Outbox Pattern（发件箱模式），通过将业务数据与事件消息写入同一数据库事务保证原子性，再借助 Debezium CDC 变更数据捕获、轮询发布、事务消息三种转发机制实现最终一致性。涵盖 Outbox 表设计、Debezium Connector 配置、Kafka 消费者幂等去重、与 Saga/TCC 分布式事务方案的对比选型，附完整架构图、生产踩坑记录与监控告警方案，帮助后端工程师在微服务场景下稳健落地可靠事件驱动架构。
---



# Outbox Pattern 深度实战：保证数据库与消息队列的最终一致性——Debezium CDC vs 轮询 vs 事务消息的选型决策

## 一、为什么需要 Outbox Pattern：分布式事务问题背景

### 1.1 微服务架构下的双写困境

在单体应用时代，所有业务逻辑和数据存储都在一个数据库事务中完成，开发者无需担心数据一致性问题。然而，当系统演进到微服务架构后，一个业务操作往往需要同时完成两件事：**写入本地数据库**和**发送消息到消息队列**。这就是所谓的「双写问题」（Dual Write Problem）。

考虑一个典型的电商下单场景：用户提交订单后，订单服务需要在数据库中创建订单记录，同时发送一条 `OrderCreated` 事件到消息队列，通知库存服务扣减库存、通知支付服务创建支付单、通知通知服务发送短信。如果这两步不是原子的，就可能出现以下几种不一致的中间状态：

**场景一：数据库写入成功，消息发送失败。** 订单已创建，但下游服务完全没有收到通知。库存没有扣减，用户看到订单创建成功却无法支付——这是一个非常糟糕的用户体验。

**场景二：消息发送成功，数据库写入失败（回滚）。** 下游服务收到通知开始处理，但订单实际上并不存在。库存被错误扣减，支付服务尝试为一个不存在的订单创建支付单——这会导致数据错乱。

**场景三：消息发送成功但延迟到达。** 在高并发场景下，消息队列可能出现短暂的延迟，下游服务收到消息时数据库的读副本可能还没同步到最新数据，导致查询到过期状态。

这些问题的根源在于：**数据库事务和消息队列是两个独立的系统，它们之间没有分布式事务协调器来保证原子性**。传统的两阶段提交（2PC）虽然理论上能解决这个问题，但在实际生产中，2PC 带来的性能开销、可用性降低和运维复杂度使其几乎不可用。

### 1.2 从 Saga 到 Outbox：演进路径

社区在解决分布式事务问题上经历了几个阶段。最早期的方案是**补偿事务**（Saga Pattern），它将长事务拆分为一系列本地事务，每个本地事务都有对应的补偿操作。Saga 适合跨多个服务的业务流程编排，但在「数据库 + 消息队列」这个特定场景下，Saga 本身也需要可靠的消息投递来驱动补偿流程——这就陷入了鸡生蛋的循环问题。

**Outbox Pattern（发件箱模式）** 的核心洞察是：既然我们无法让数据库和消息队列共享一个事务，那就在数据库事务中同时写入业务数据和待发送的消息，然后通过一个可靠的消息转发机制将消息从数据库中提取并发送到消息队列。这样，消息的持久化和业务数据的持久化在同一个数据库事务中完成，天然具备原子性。

### 1.3 Outbox Pattern 的理论基础

Outbox Pattern 的理论根基是 **Transactional Outbox** 模式，最早由 Chris Richardson 在 *Microservices Patterns* 一书中系统化阐述。其核心原则是：

1. **单一数据源原则**：数据库是唯一的事实来源（Single Source of Truth）
2. **本地事务保证原子性**：业务数据和 Outbox 消息在同一个本地事务中写入
3. **异步转发保证最终一致性**：通过独立的转发机制将 Outbox 消息投递到消息队列
4. **幂等消费保证正确性**：下游消费者必须能够处理重复消息

这种模式巧妙地将分布式一致性问题转化为本地事务问题 + 异步消息转发问题，大大降低了系统复杂度。

---

## 二、Outbox Pattern 核心原理与实现

### 2.1 为什么叫「发件箱」模式

Outbox Pattern 这个名字来源于现实生活中的发件箱概念。想象一下你写了一封电子邮件，它不会立刻发送到对方的收件箱，而是先进入你的「发件箱」等待发送。邮件系统会负责将发件箱中的邮件可靠地投递到目标服务器。如果网络出现问题，邮件系统会自动重试，直到投递成功为止。

这个日常生活中的类比精准地描述了分布式系统中的消息可靠性保证机制。在软件系统中，Outbox 表就充当了「发件箱」的角色——业务操作产生的事件先写入这张表（存入发件箱），然后由专门的转发机制将这些事件可靠地投递到消息队列（邮件投递系统），最终到达下游消费者（收件箱）。

这种解耦设计的最大好处是：**即使消息投递系统暂时不可用，数据也不会丢失**，因为消息已经被安全地持久化在数据库的 Outbox 表中。一旦投递系统恢复，积压的消息会自动被发送出去。

### 2.2 架构总览

Outbox Pattern 的整体架构可以概括为三个阶段：

```
┌─────────────────────────────────────────────────────────────────┐
│                     应用服务（Producer）                          │
│                                                                 │
│  ┌──────────────┐    ┌─────────────────────────────────────┐    │
│  │  业务操作     │    │  数据库事务（单一事务）                │    │
│  │  创建订单     │───▶│  1. INSERT INTO orders ...           │    │
│  │              │    │  2. INSERT INTO outbox_events ...    │    │
│  └──────────────┘    └─────────────────────────────────────┘    │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  消息转发机制         │
                    │  (CDC / 轮询 / 事务消息)│
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   消息队列            │
                    │   (Kafka / RabbitMQ) │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ 库存服务      │ │ 支付服务      │ │ 通知服务      │
     │ (Consumer)   │ │ (Consumer)   │ │ (Consumer)   │
     └──────────────┘ └──────────────┘ └──────────────┘
```

### 2.3 Outbox 表设计

Outbox 表是整个模式的核心。一张精心设计的 Outbox 表需要包含以下关键字段：

```sql
CREATE TABLE outbox_events (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    aggregate_type  VARCHAR(255)    NOT NULL COMMENT '聚合根类型，如 Order、User',
    aggregate_id    VARCHAR(255)    NOT NULL COMMENT '聚合根 ID',
    event_type      VARCHAR(255)    NOT NULL COMMENT '事件类型，如 OrderCreated、OrderPaid',
    payload         JSON            NOT NULL COMMENT '事件载荷，包含完整的事件数据',
    metadata        JSON            DEFAULT NULL COMMENT '元数据，如 trace_id、correlation_id',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at    TIMESTAMP       NULL DEFAULT NULL COMMENT '发布时间，NULL 表示未发布',
    retry_count     INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '重试次数',
    status          TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=待发布, 1=已发布, 2=失败',
    INDEX idx_status_created (status, created_at),
    INDEX idx_aggregate (aggregate_type, aggregate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Outbox 事件表';
```

**设计要点解析：**

- `aggregate_type` 和 `aggregate_id` 用于将事件关联到具体的业务实体，便于调试和溯源
- `payload` 使用 JSON 类型存储完整的事件数据，避免消费者需要回查数据库
- `published_at` 字段帮助识别哪些消息还没发出，也便于监控延迟
- `status` 字段支持三种状态，便于轮询方案中过滤已发布的消息
- `retry_count` 用于死信队列判断——超过阈值的消息转入死信处理

---

## 三、方案一：轮询发布（Polling Publisher）

### 3.1 原理与适用场景

轮询发布是最简单的 Outbox 实现方案，也是很多团队在项目初期的首选。其核心思路非常直观：**定时任务周期性地查询 Outbox 表中未发布的消息，发送到消息队列后标记为已发布**。这种方式不需要任何额外的中间件组件，只需要一个定时调度器（如 Linux Cron、Laravel Scheduler、Kubernetes CronJob）即可工作。

轮询方案的工作流程如下：调度器按照预设的时间间隔触发任务 → 查询 Outbox 表中 status=0（待发布）的记录 → 将消息序列化后发送到消息队列 → 更新消息的 status 为 1（已发布）→ 等待下一次调度周期。

这种方案的优势在于实现简单，不依赖任何额外的中间件基础设施。对于中小型项目或团队技术栈相对简单的场景，轮询发布是一个务实且可靠的选择。你可以用不到 100 行代码就实现一个基本可靠的轮询发布器。

但轮询方案的缺点也很明显，在选型时需要认真评估：
- **延迟取决于轮询间隔**：间隔太短会增加数据库压力，间隔太长会增加消息延迟。典型的权衡是在 1 秒和 5 秒之间取舍
- **数据库压力**：频繁的 SELECT 查询在高吞吐场景下会对数据库造成显著负担，尤其是当 Outbox 表记录数增长到百万级时，查询性能会显著下降
- **水平扩展困难**：多个轮询实例之间需要协调，避免重复消费同一批消息。这通常需要引入分布式锁或基于数据库行锁的并发控制
- **消息积压处理**：当消息队列短暂不可用时，轮询实例会持续重试发送同一批消息，需要仔细设计重试策略和死信处理机制

### 3.2 Laravel 完整实现

首先创建 Migration：

```php
<?php
// database/migrations/2026_06_06_000001_create_outbox_events_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outbox_events', function (Blueprint $table) {
            $table->id();
            $table->string('aggregate_type', 255);
            $table->string('aggregate_id', 255);
            $table->string('event_type', 255);
            $table->json('payload');
            $table->json('metadata')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('published_at')->nullable();
            $table->unsignedInteger('retry_count')->default(0);
            $table->unsignedTinyInteger('status')->default(0);

            $table->index(['status', 'created_at'], 'idx_outbox_status_created');
            $table->index(['aggregate_type', 'aggregate_id'], 'idx_outbox_aggregate');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('outbox_events');
    }
};
```

然后创建 Model：

```php
<?php
// app/Models/OutboxEvent.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;

class OutboxEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'aggregate_type',
        'aggregate_id',
        'event_type',
        'payload',
        'metadata',
        'status',
        'retry_count',
        'published_at',
    ];

    protected $casts = [
        'payload'   => 'array',
        'metadata'  => 'array',
        'created_at' => 'datetime',
        'published_at' => 'datetime',
    ];

    // 状态常量
    const STATUS_PENDING   = 0;
    const STATUS_PUBLISHED = 1;
    const STATUS_FAILED    = 2;

    /**
     * 查询待发布的事件（带悲观锁，防止并发重复投递）
     */
    public function scopePending(Builder $query, int $limit = 100): Builder
    {
        return $query->where('status', self::STATUS_PENDING)
                     ->where('retry_count', '<', 5)
                     ->orderBy('created_at')
                     ->limit($limit)
                     ->lockForUpdate();
    }

    /**
     * 标记为已发布
     */
    public function markPublished(): void
    {
        $this->update([
            'status'       => self::STATUS_PUBLISHED,
            'published_at' => now(),
        ]);
    }

    /**
     * 标记为失败并增加重试次数
     */
    public function markFailed(): void
    {
        $this->increment('retry_count');
        if ($this->retry_count >= 5) {
            $this->update(['status' => self::STATUS_FAILED]);
        }
    }
}
```

接下来是核心的轮询 Job：

```php
<?php
// app/Jobs/PublishOutboxEventsJob.php

namespace App\Jobs;

use App\Models\OutboxEvent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;

class PublishOutboxEventsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 60;

    public function handle(): void
    {
        // 使用事务 + 悲观锁保证同一时间只有一个进程处理同一批消息
        DB::transaction(function () {
            $events = OutboxEvent::pending(limit: 100)->get();

            if ($events->isEmpty()) {
                Log::debug('Outbox: 没有待发布的事件');
                return;
            }

            Log::info("Outbox: 开始发布 {$events->count()} 条事件");

            foreach ($events as $event) {
                try {
                    // 根据事件类型路由到不同的队列/Topic
                    $this->publishToMessageBroker($event);
                    $event->markPublished();

                    Log::info("Outbox: 事件发布成功", [
                        'event_id'   => $event->id,
                        'event_type' => $event->event_type,
                        'aggregate'  => "{$event->aggregate_type}:{$event->aggregate_id}",
                    ]);
                } catch (\Throwable $e) {
                    $event->markFailed();

                    Log::error("Outbox: 事件发布失败", [
                        'event_id'   => $event->id,
                        'event_type' => $event->event_type,
                        'error'      => $e->getMessage(),
                        'retry'      => $event->retry_count,
                    ]);
                }
            }
        });
    }

    /**
     * 将事件发布到消息队列
     */
    protected function publishToMessageBroker(OutboxEvent $event): void
    {
        // 路由策略：根据 aggregate_type 决定目标队列
        $queueMap = [
            'Order'   => 'events.orders',
            'Payment' => 'events.payments',
            'User'    => 'events.users',
        ];

        $queue = $queueMap[$event->aggregate_type] ?? 'events.default';

        Queue::connection('kafka')->pushRaw(
            json_encode([
                'event_id'       => $event->id,
                'event_type'     => $event->event_type,
                'aggregate_type' => $event->aggregate_type,
                'aggregate_id'   => $event->aggregate_id,
                'payload'        => $event->payload,
                'metadata'       => array_merge($event->metadata ?? [], [
                    'outbox_created_at' => $event->created_at->toIso8601String(),
                    'published_at'      => now()->toIso8601String(),
                ]),
            ]),
            $queue
        );
    }
}
```

最后通过 Laravel Scheduler 驱动轮询：

```php
<?php
// app/Console/Kernel.php

namespace App\Console;

use App\Jobs\PublishOutboxEventsJob;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        // 每 5 秒执行一次轮询（使用 withoutOverlapping 防止重叠执行）
        $schedule->job(new PublishOutboxEventsJob)
                 ->everyFiveSeconds()
                 ->withoutOverlapping(30)
                 ->onOneServer()
                 ->runInBackground();
    }
}
```

---

## 四、方案二：事务消息（Transactional Outbox with Message Broker）

### 4.1 原理分析

事务消息方案是指利用某些消息中间件自身提供的事务消息能力，将「写数据库」和「发消息」两个操作在同一个分布式事务中完成。最典型的代表是 **RocketMQ 的事务消息机制**。

RocketMQ 事务消息的流程如下：

1. Producer 发送**半消息**（Half Message）到 Broker，此时消费者不可见
2. Broker 返回半消息发送成功
3. Producer 执行本地数据库事务
4. 根据事务执行结果，Producer 向 Broker 发送 **Commit**（提交）或 **Rollback**（回滚）
5. 如果 Broker 没有收到 Commit/Rollback（网络超时等），会**回查** Producer 的本地事务状态
6. Commit 后消费者才能消费到这条消息

这种方案看似完美解决了双写问题，但实际使用中有几个关键注意点：

- **回查机制的可靠性**：Producer 必须实现 `TransactionListener.checkLocalTransaction()` 方法来支持回查。如果 Producer 在 Commit 之前宕机，Broker 会定时回查，但回查次数有限，超过后消息会被丢弃
- **仅限 RocketMQ**：目前只有 RocketMQ 原生支持事务消息，Kafka 和 RabbitMQ 不支持这种语义
- **性能开销**：每次消息投递都需要额外的半消息 + 确认步骤，吞吐量比普通消息低约 20%-30%

### 4.2 Laravel + RocketMQ 事务消息示例

```php
<?php
// app/Services/TransactionalMessageService.php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class TransactionalMessageService
{
    /**
     * 使用 RocketMQ 事务消息发送订单创建事件
     */
    public function createOrderWithTransactionalMessage(array $orderData): void
    {
        $producer = RocketMQ::createTransactionalProducer('order-producer-group');

        $producer->setTransactionListener(new class ($orderData) implements TransactionListener {
            private array $orderData;

            public function __construct(array $orderData)
            {
                $this->orderData = $orderData;
            }

            /**
             * 执行本地事务
             */
            public function executeLocalTransaction(Message $msg): LocalTransactionState
            {
                try {
                    DB::transaction(function () {
                        // 1. 创建订单
                        Order::create($this->orderData);

                        // 2. 其他业务操作（扣减库存日志等）
                        InventoryLog::create([...]);
                    });

                    // 事务成功，提交消息
                    return LocalTransactionState::COMMIT_MESSAGE;
                } catch (\Throwable $e) {
                    Log::error('事务消息: 本地事务执行失败', [
                        'error' => $e->getMessage(),
                    ]);
                    // 事务失败，回滚消息
                    return LocalTransactionState::ROLLBACK_MESSAGE;
                }
            }

            /**
             * 事务状态回查
             * 当 Broker 没有收到 Commit/Rollback 时触发
             */
            public function checkLocalTransaction(Message $msg): LocalTransactionState
            {
                $payload = json_decode($msg->getBody(), true);
                $orderId = $payload['order_id'] ?? null;

                if (!$orderId) {
                    return LocalTransactionState::ROLLBACK_MESSAGE;
                }

                // 查询订单是否存在来判断事务是否提交成功
                $order = Order::find($orderId);

                if ($order) {
                    return LocalTransactionState::COMMIT_MESSAGE;
                }

                // 订单不存在，可能是事务还没完成或者已经回滚
                // 返回 UNKNOW 让 Broker 稍后再次回查
                return LocalTransactionState::UNKNOW;
            }
        });

        // 发送半消息
        $message = new Message('topic-order-events', json_encode([
            'event_type' => 'OrderCreated',
            'order_id'   => $orderData['id'],
            'payload'    => $orderData,
        ])->getBytes());

        $producer->sendMessageInTransaction($message);
    }
}
```

### 4.3 事务消息方案的局限性

虽然事务消息在 RocketMQ 生态中是一个优雅的方案，但在实际选型时需要考虑以下局限：

1. **厂商锁定**：必须使用 RocketMQ 作为消息中间件，无法用于 Kafka、RabbitMQ、Amazon SQS 等
2. **回查超时风险**：如果 Producer 长时间不可用，回查会超时，消息可能丢失
3. **不支持批量发送**：每条消息都需要一次半消息交互，高频场景下性能受限
4. **运维成本**：需要维护 RocketMQ 集群，包括 NameServer、Broker 的高可用部署

---

## 五、方案三：Debezium CDC（Change Data Capture）

### 5.1 CDC 的原理优势

CDC（Change Data Capture，变更数据捕获）方案是目前业界公认的 Outbox Pattern 最佳实践，由多个大型科技公司在生产环境中验证过其可靠性。其核心思路是：**不主动读取和发送 Outbox 消息，而是通过监听数据库的变更日志（如 MySQL binlog、PostgreSQL WAL），实时捕获 Outbox 表的新增记录，并自动将它们转换为消息发送到 Kafka**。

这种「被动捕获」的方式与轮询方案的「主动查询」形成了鲜明对比。CDC 方案不需要在应用代码中编写任何消息发送逻辑，也不需要定时轮询 Outbox 表。数据库自身的 WAL（Write-Ahead Log）机制天然地记录了所有数据变更，CDC 工具只需要「订阅」这个变更日志流，就能实时感知到 Outbox 表中的新增记录。

Debezium 是 Red Hat 开源的 CDC 平台，基于 Kafka Connect 框架构建，目前已成为业界事实上的开源 CDC 标准。它的核心优势包括：

- **零侵入**：应用程序只需要写入 Outbox 表，不需要任何消息发送逻辑。这意味着你可以通过切换消息转发策略来改变整个事件发布机制，而无需修改任何业务代码
- **超低延迟**：基于 binlog 实时流式处理，延迟通常在毫秒级别。当一条记录被写入 Outbox 表时，Debezium 几乎立即就能捕获到这条变更并发布到 Kafka
- **高吞吐**：不增加数据库额外的查询负担（相比轮询方案），因为它是被动监听而非主动查询。在高并发写入场景下，CDC 方案的性能优势尤其明显
- **与应用解耦**：Debezium 作为独立基础设施运行，不影响应用的部署和发布。应用团队和基础设施团队可以独立迭代各自的职责范围
- **Outbox Event Router**：Debezium 内置的 SMT（Single Message Transform）专为 Outbox Pattern 设计，能自动将 Outbox 表的 INSERT 事件路由到对应的消息 Topic，并处理 JSON 展开、事件类型提取等常见需求

### 5.2 Debezium + Outbox Event Router 完整配置

首先，确保 MySQL 开启了 binlog 并设置为 ROW 格式：

```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf
[mysqld]
server-id                  = 1
log_bin                    = mysql-bin
binlog_format              = ROW
binlog_row_image           = FULL
expire_logs_days           = 7
gtid_mode                  = ON
enforce_gtid_consistency   = ON
```

创建 Debezium 专用数据库用户：

```sql
-- 创建专用用户并授予最小权限
CREATE USER 'debezium'@'%' IDENTIFIED BY 'secure_password';

GRANT SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT
  ON *.* TO 'debezium'@'%';

GRANT SELECT ON myapp.outbox_events TO 'debezium'@'%';

FLUSH PRIVILEGES;
```

注册 Debezium MySQL Connector（通过 Kafka Connect REST API）：

```json
{
  "name": "outbox-connector",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "tasks.max": "1",

    "database.hostname": "mysql-primary",
    "database.port": "3306",
    "database.user": "debezium",
    "database.password": "secure_password",
    "database.server.id": "184054",

    "topic.prefix": "myapp",

    "database.include.list": "myapp",
    "table.include.list": "myapp.outbox_events",

    "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
    "schema.history.internal.kafka.topic": "schema-changes.outbox",

    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",

    "transforms.outbox.table.field.event.id": "id",
    "transforms.outbox.table.field.event.key": "aggregate_id",
    "transforms.outbox.table.field.event.type": "event_type",
    "transforms.outbox.table.field.event.payload": "payload",
    "transforms.outbox.table.field.event.aggregate.type": "aggregate_type",
    "transforms.outbox.table.field.event.aggregate.id": "aggregate_id",

    "transforms.outbox.route.by.field": "aggregate_type",
    "transforms.outbox.route.topic.replacement": "events.${routedByValue}",

    "transforms.outbox.table.expand.json.payload": "true",
    "transforms.outbox.table.fields.additional.placement": "event_type:header:eventType",

    "transforms.outbox.debezium.transforms.handling.mode": "avro",

    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://schema-registry:8081",
    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter.schema.registry.url": "http://schema-registry:8081",

    "heartbeat.interval.ms": "10000",
    "snapshot.mode": "schema_only",
    "tombstones.on.delete": "false"
  }
}
```

### 5.3 Outbox Event Router 配置详解

`EventRouter` 是 Debezium 专门为 Outbox Pattern 设计的 SMT，理解每个配置项对正确使用至关重要：

**路由策略**：`route.by.field` 指定了路由字段。设置为 `aggregate_type` 后，不同类型的聚合根（Order、Payment、User）会被路由到不同的 Kafka Topic，例如 `events.Order`、`events.Payment`、`events.User`。

**JSON 展开**：`table.expand.json.payload` 设置为 `true` 时，payload 字段中的 JSON 内容会被展开为消息体的顶层字段，而不是嵌套在 payload 字段中。这简化了下游消费者的解析逻辑。

**事件类型头部**：`table.fields.additional.placement` 将 `event_type` 字段放入消息的 Header 中，消费者可以通过 Header 快速过滤消息类型，而不需要解析消息体。

**删除事件处理**：默认情况下，当 Outbox 表中的记录被删除时，Debezium 也会生成一个 tombstone 事件。`tombstones.on.delete` 设置为 `false` 可以禁用这一行为——因为 Outbox 表的清理不应该触发下游消费者的删除逻辑。

### 5.4 Docker Compose 部署参考

```yaml
# docker-compose.debezium.yml
version: '3.8'

services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.6.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    depends_on: [zookeeper]
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1

  schema-registry:
    image: confluentinc/cp-schema-registry:7.6.0
    depends_on: [kafka]
    environment:
      SCHEMA_REGISTRY_HOST_NAME: schema-registry
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: kafka:9092

  connect:
    image: quay.io/debezium/connect:2.6
    depends_on: [kafka, schema-registry]
    ports: ["8083:8083"]
    environment:
      GROUP_ID: outbox-connect-cluster
      CONFIG_STORAGE_TOPIC: connect-configs
      OFFSET_STORAGE_TOPIC: connect-offsets
      STATUS_STORAGE_TOPIC: connect-status
      BOOTSTRAP_SERVERS: kafka:9092
      KEY_CONVERTER: io.confluent.connect.avro.AvroConverter
      VALUE_CONVERTER: io.confluent.connect.avro.AvroConverter
      CONNECT_KEY_CONVERTER_SCHEMA_REGISTRY_URL: http://schema-registry:8081
      CONNECT_VALUE_CONVERTER_SCHEMA_REGISTRY_URL: http://schema-registry:8081
```

---

## 六、三种方案的选型决策对比表

### 6.1 核心维度对比

| 维度 | 轮询发布 | 事务消息 (RocketMQ) | Debezium CDC |
|------|---------|-------------------|-------------|
| **实现复杂度** | ⭐⭐ 低 | ⭐⭐⭐ 中 | ⭐⭐⭐⭐ 高 |
| **消息延迟** | 秒级（取决于轮询间隔） | 毫秒级 | 毫秒级 |
| **数据库负担** | 高（频繁 SELECT） | 低 | 极低（仅写入） |
| **应用侵入性** | 中（需要轮询 Job） | 高（嵌入事务逻辑） | 极低（仅写 Outbox 表） |
| **消息可靠性** | at-least-once | exactly-once（理想情况） | at-least-once |
| **水平扩展** | 困难（需分布式锁） | 容易 | 容易（Kafka Connect 集群） |
| **中间件依赖** | 无 | 必须 RocketMQ | Kafka + Kafka Connect |
| **运维成本** | 低 | 中 | 高（需运维 Connect 集群） |
| **适用吞吐量** | < 1K TPS | < 10K TPS | > 10K TPS |
| **运维监控** | 简单（Laravel Scheduler） | 中等（RocketMQ 控制台） | 复杂（JMX + Grafana） |

### 6.2 决策流程图

```
项目初期 / 中小规模？
├── 是 → 消息队列用的是 RocketMQ？
│        ├── 是 → 事务消息方案 ✅
│        └── 否 → 轮询发布方案 ✅
│                  （实现快速，后期可平滑迁移到 CDC）
│
└── 否 → 高吞吐 / 低延迟要求？
         ├── 是 → 已有 Kafka 基础设施？
         │        ├── 是 → Debezium CDC 方案 ✅
         │        └── 否 → 先引入 Kafka + Debezium ✅
         │                  （长期来看收益最大）
         └── 否 → 轮询发布方案（配合增量优化）✅
```

### 6.3 混合策略：渐进式迁移

在实际项目中，不必一开始就选择最复杂的方案。推荐的渐进式迁移路径是：

1. **阶段一（MVP）**：使用轮询发布方案快速上线，验证业务模型的正确性
2. **阶段二（优化）**：当数据库压力增大时，优化轮询策略——使用增量查询（基于 ID 范围）替代全表扫描，引入分布式锁避免重复投递
3. **阶段三（升级）**：当吞吐量超过 1K TPS 或延迟要求进入毫秒级时，引入 Debezium CDC 方案。由于 Outbox 表设计保持不变，迁移只需要替换消息转发层

---

## 七、Laravel 中的完整 Outbox 实现

### 7.1 HasOutboxEvents Trait

为了让 Outbox 逻辑在各个 Model 中复用，我们设计一个 Trait：

```php
<?php
// app/Traits/HasOutboxEvents.php

namespace App\Traits;

use App\Models\OutboxEvent;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

trait HasOutboxEvents
{
    /**
     * 在业务事务中写入 Outbox 事件
     */
    protected function recordOutboxEvent(
        string $eventType,
        array  $payload,
        array  $metadata = []
    ): OutboxEvent {
        return OutboxEvent::create([
            'aggregate_type' => class_basename(static::class),
            'aggregate_id'   => (string) $this->getKey(),
            'event_type'     => $eventType,
            'payload'        => $payload,
            'metadata'       => array_merge($metadata, [
                'trace_id'  => Str::uuid()->toString(),
                'timestamp' => now()->toIso8601String(),
            ]),
        ]);
    }

    /**
     * 包装业务逻辑 + Outbox 事件写入在同一个事务中
     */
    protected function withOutboxTransaction(
        string   $eventType,
        callable $businessLogic,
        array    $extraMetadata = []
    ): mixed {
        return DB::transaction(function () use ($eventType, $businessLogic, $extraMetadata) {
            // 执行业务逻辑
            $result = $businessLogic($this);

            // 在同一个事务中记录 Outbox 事件
            $this->recordOutboxEvent(
                $eventType,
                $this->toOutboxPayload(),
                $extraMetadata
            );

            return $result;
        });
    }

    /**
     * 将模型转换为 Outbox 载荷（子类可覆盖）
     */
    protected function toOutboxPayload(): array
    {
        return $this->toArray();
    }
}
```

### 7.2 Observer 自动记录事件

使用 Laravel Observer 可以让 Outbox 事件的记录完全自动化，开发者无需在每个业务方法中手动调用：

```php
<?php
// app/Observers/OrderObserver.php

namespace App\Observers;

use App\Models\Order;
use App\Models\OutboxEvent;
use Illuminate\Support\Str;

class OrderObserver
{
    /**
     * Order 创建后自动记录 Outbox 事件
     * 注意：这个 Observer 应该在创建订单的事务内被触发
     */
    public function created(Order $order): void
    {
        OutboxEvent::create([
            'aggregate_type' => 'Order',
            'aggregate_id'   => (string) $order->id,
            'event_type'     => 'OrderCreated',
            'payload'        => [
                'order_id'     => $order->id,
                'user_id'      => $order->user_id,
                'total_amount' => $order->total_amount,
                'currency'     => $order->currency,
                'items'        => $order->items->toArray(),
                'created_at'   => $order->created_at->toIso8601String(),
            ],
            'metadata' => [
                'trace_id' => request()->header('X-Trace-Id', Str::uuid()->toString()),
                'source'   => 'order-service',
            ],
        ]);
    }

    public function updated(Order $order): void
    {
        // 只在关键字段变更时记录事件
        if ($order->wasChanged('status')) {
            $eventTypes = [
                'paid'    => 'OrderPaid',
                'shipped' => 'OrderShipped',
                'cancelled' => 'OrderCancelled',
            ];

            $eventType = $eventTypes[$order->status] ?? 'OrderStatusChanged';

            OutboxEvent::create([
                'aggregate_type' => 'Order',
                'aggregate_id'   => (string) $order->id,
                'event_type'     => $eventType,
                'payload'        => [
                    'order_id'     => $order->id,
                    'old_status'   => $order->getOriginal('status'),
                    'new_status'   => $order->status,
                    'changed_at'   => now()->toIso8601String(),
                ],
                'metadata' => [
                    'trace_id' => request()->header('X-Trace-Id', Str::uuid()->toString()),
                ],
            ]);
        }
    }
}
```

### 7.3 Outbox 清理与分区策略

随着时间推移，Outbox 表会持续增长。已发布的事件需要定期清理：

```php
<?php
// app/Jobs/CleanupOutboxEventsJob.php

namespace App\Jobs;

use App\Models\OutboxEvent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

class CleanupOutboxEventsJob implements ShouldQueue
{
    use Dispatchable;

    public function handle(): void
    {
        // 删除 7 天前已发布的事件
        $deleted = OutboxEvent::where('status', OutboxEvent::STATUS_PUBLISHED)
            ->where('published_at', '<', now()->subDays(7))
            ->limit(5000)
            ->delete();

        // 删除 30 天前失败的事件（已转入死信队列）
        $failedDeleted = OutboxEvent::where('status', OutboxEvent::STATUS_FAILED)
            ->where('created_at', '<', now()->subDays(30))
            ->limit(5000)
            ->delete();

        \Log::info("Outbox 清理完成: 已发布删除 {$deleted}, 失败删除 {$failedDeleted}");
    }
}
```

对于高吞吐场景（日均百万级事件），建议对 Outbox 表进行**按时间分区**：

```sql
-- 按月分区，每月一个分区
ALTER TABLE outbox_events PARTITION BY RANGE (UNIX_TIMESTAMP(created_at)) (
    PARTITION p202606 VALUES LESS THAN (UNIX_TIMESTAMP('2026-07-01')),
    PARTITION p202607 VALUES LESS THAN (UNIX_TIMESTAMP('2026-08-01')),
    PARTITION p202608 VALUES LESS THAN (UNIX_TIMESTAMP('2026-09-01')),
    PARTITION p_future  VALUES LESS THAN MAXVALUE
);
```

---

## 八、幂等性保证与 Consumer 端设计

### 8.1 为什么幂等性至关重要

Outbox Pattern 保证的是**至少一次（at-least-once）**投递语义，这意味着消费者可能会收到重复的消息。在网络抖动、消费者重启、Debezium Connector 故障恢复等场景下，重复投递几乎不可避免。

如果消费者不具备幂等性，重复消息可能导致：库存被多次扣减、支付被重复创建、通知被重复发送、积分被重复累加——这些都是严重的业务事故。

### 8.2 Laravel 消费端幂等实现

```php
<?php
// app/Services/IdempotentEventConsumer.php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class IdempotentEventConsumer
{
    /**
     * 幂等消费事件
     *
     * @param string   $eventId     唯一事件 ID（来自 Outbox 的主键或 UUID）
     * @param string   $eventType   事件类型
     * @param callable $handler     业务处理逻辑
     */
    public function consume(string $eventId, string $eventType, callable $handler): void
    {
        // 使用数据库唯一键保证幂等
        $already = DB::table('processed_events')
            ->where('event_id', $eventId)
            ->exists();

        if ($already) {
            Log::info("Consumer: 事件已处理，跳过", ['event_id' => $eventId]);
            return;
        }

        DB::transaction(function () use ($eventId, $eventType, $handler) {
            // 1. 先插入已处理记录（唯一键冲突会回滚整个事务）
            DB::table('processed_events')->insert([
                'event_id'   => $eventId,
                'event_type' => $eventType,
                'processed_at' => now(),
            ]);

            // 2. 执行业务逻辑
            $handler();

            Log::info("Consumer: 事件处理成功", [
                'event_id'   => $eventId,
                'event_type' => $eventType,
            ]);
        });
    }
}
```

对应的 Migration：

```php
<?php
// database/migrations/2026_06_06_000002_create_processed_events_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('processed_events', function (Blueprint $table) {
            $table->id();
            $table->string('event_id', 255)->unique('uk_event_id');
            $table->string('event_type', 255)->index('idx_processed_event_type');
            $table->timestamp('processed_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('processed_events');
    }
};
```

### 8.3 消费者端完整实现

```php
<?php
// app/Jobs/ConsumeOrderEventJob.php

namespace App\Jobs;

use App\Services\IdempotentEventConsumer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

class ConsumeOrderEventJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 5;
    public int $backoff = 30;

    public function __construct(
        public string $eventId,
        public string $eventType,
        public array  $payload,
    ) {}

    public function handle(IdempotentEventConsumer $consumer): void
    {
        $consumer->consume(
            eventId:   $this->eventId,
            eventType: $this->eventType,
            handler: function () {
                match ($this->eventType) {
                    'OrderCreated' => $this->handleOrderCreated(),
                    'OrderPaid'    => $this->handleOrderPaid(),
                    'OrderCancelled' => $this->handleOrderCancelled(),
                    default => Log::warning("未知事件类型: {$this->eventType}"),
                };
            }
        );
    }

    protected function handleOrderCreated(): void
    {
        $orderPayload = $this->payload;

        // 扣减库存
        foreach ($orderPayload['items'] ?? [] as $item) {
            InventoryService::decrement($item['product_id'], $item['quantity']);
        }

        Log::info("库存扣减完成", ['order_id' => $orderPayload['order_id']]);
    }

    protected function handleOrderPaid(): void
    {
        // 创建发货单
        ShippingService::createFromOrder($this->payload);
    }

    protected function handleOrderCancelled(): void
    {
        // 恢复库存
        $orderPayload = $this->payload;
        foreach ($orderPayload['items'] ?? [] as $item) {
            InventoryService::increment($item['product_id'], $item['quantity']);
        }
    }
}
```

---

## 九、生产环境踩坑与监控告警

### 9.1 踩坑一：Outbox 表膨胀

**现象**：Outbox 表在短时间内增长到千万级记录，轮询查询变慢，数据库 CPU 飙升。

**根因**：清理 Job 没有配置或执行失败；轮询查询没有走索引。

**解决方案**：

```sql
-- 确保核心查询走索引
-- 这个查询是轮询的核心路径
SELECT * FROM outbox_events
WHERE status = 0 AND retry_count < 5
ORDER BY created_at
LIMIT 100
FOR UPDATE;
-- 对应的复合索引：idx_outbox_status_created (status, created_at)
```

```php
// 配置清理任务，每小时执行一次
$schedule->job(new CleanupOutboxEventsJob)
         ->hourly()
         ->withoutOverlapping();
```

### 9.2 踩坑二：Debezium 断连后 binlog 被清理

**现象**：Debezium Connector 重启后报错 `binlog file mysql-bin.000042 not found`。

**根因**：MySQL 的 `expire_logs_days` 设置过短，Debezium 停机期间 binlog 已被清理。

**解决方案**：

```sql
-- 延长 binlog 保留时间到 7 天
SET GLOBAL expire_logs_days = 7;
-- MySQL 8.0+ 推荐使用
SET GLOBAL binlog_expire_logs_seconds = 604800;

-- 或使用 GTID 模式，配合 Debezium 的增量快照恢复
SET GLOBAL gtid_mode = ON;
SET GLOBAL enforce_gtid_consistency = ON;
```

### 9.3 踩坑三：消息乱序

**现象**：消费者收到 `OrderPaid` 事件时，对应的 `OrderCreated` 事件还没有被处理。

**根因**：不同事件被路由到 Kafka 的不同分区，分区间的消费顺序不保证。

**解决方案**：确保同一聚合根的所有事件使用相同的 Kafka Partition Key。Debezium 默认使用 `aggregate_id` 作为 Key，同一订单的所有事件会路由到同一分区，保证顺序。

### 9.4 监控告警配置

使用 Prometheus + Grafana 监控 Outbox 系统的关键指标：

```yaml
# prometheus/alert_rules.yml
groups:
  - name: outbox_alerts
    rules:
      # Outbox 待发布消息积压告警
      - alert: OutboxBacklogHigh
        expr: |
          mysql_query_result{query="outbox_pending_count"} > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Outbox 待发布消息积压超过 10000 条"

      # Outbox 消息发布延迟告警
      - alert: OutboxPublishDelayHigh
        expr: |
          (time() - mysql_query_result{query="oldest_unpublished_event_timestamp"}) > 60
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Outbox 最早未发布消息已超过 60 秒"

      # Debezium Connector 状态告警
      - alert: DebeziumConnectorFailed
        expr: |
          kafka_connect_connector_status{state="FAILED"} == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Debezium Connector {{ $labels.connector }} 状态为 FAILED"

      # 消费者处理失败率告警
      - alert: ConsumerFailureRateHigh
        expr: |
          rate(consumer_events_failed_total[5m]) / rate(consumer_events_processed_total[5m]) > 0.05
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "消费者失败率超过 5%"
```

Laravel 端暴露 Prometheus 指标：

```php
<?php
// app/Services/OutboxMetricsService.php

namespace App\Services;

use App\Models\OutboxEvent;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class OutboxMetricsService
{
    protected CollectorRegistry $registry;

    public function __construct()
    {
        Redis::setDefaultOptions(['host' => config('database.redis.default.host')]);
        $this->registry = CollectorRegistry::getDefault();
    }

    public function collectMetrics(): void
    {
        // 待发布消息数量
        $pendingCount = OutboxEvent::where('status', 0)->count();
        $gauge = $this->registry->getOrRegisterGauge(
            'outbox', 'pending_count', 'Number of unpublished outbox events'
        );
        $gauge->set($pendingCount);

        // 失败消息数量
        $failedCount = OutboxEvent::where('status', 2)->count();
        $gauge = $this->registry->getOrRegisterGauge(
            'outbox', 'failed_count', 'Number of failed outbox events'
        );
        $gauge->set($failedCount);

        // 最早未发布时间戳
        $oldest = OutboxEvent::where('status', 0)->min('created_at');
        $gauge = $this->registry->getOrRegisterGauge(
            'outbox', 'oldest_unpublished_timestamp', 'Oldest unpublished event timestamp'
        );
        $gauge->set($oldest ? strtotime($oldest) : 0);
    }
}
```

---

## 十、总结与最佳实践

### 10.1 核心要点回顾

Outbox Pattern 是解决微服务架构中数据库与消息队列一致性问题的经典方案，其核心思想是将消息持久化与业务数据持久化绑定在同一个数据库事务中，然后通过可靠的转发机制将消息投递到消息队列。

三种实现方案各有优劣：

- **轮询发布**：实现最简单，适合中小型项目和快速验证阶段。缺点是延迟和数据库压力受限于轮询频率
- **事务消息**：RocketMQ 原生支持，语义清晰，但存在厂商锁定问题。适合 RocketMQ 技术栈的团队
- **Debezium CDC**：业界最佳实践，零侵入、低延迟、高吞吐。但运维复杂度高，适合有 Kafka 运维能力的中大型团队

### 10.2 生产环境 Checklist

在将 Outbox Pattern 部署到生产环境之前，确认以下清单：

**Outbox 表设计**：
- [ ] 主键使用自增 ID 或有序 UUID（保证 Debezium 事件顺序）
- [ ] payload 字段使用 JSON 类型
- [ ] 包含 status、retry_count、published_at 字段
- [ ] 创建 (status, created_at) 复合索引

**事务一致性**：
- [ ] 所有业务写入和 Outbox 写入在同一个 DB::transaction 中
- [ ] Observer 或 Service 中正确包裹事务边界
- [ ] 测试验证：模拟数据库事务回滚时 Outbox 记录也会回滚

**消息转发**：
- [ ] 轮询方案：配置 withoutOverlapping 防止并发
- [ ] CDC 方案：binlog 保留时间 ≥ Debezium 最大停机容忍时间
- [ ] CDC 方案：心跳间隔合理配置（低流量场景必须设置）

**幂等消费**：
- [ ] processed_events 表有 event_id 唯一索引
- [ ] 消费逻辑在 try-catch 中，失败不影响幂等记录写入
- [ ] 测试验证：重复发送同一条消息不会导致副作用

**监控告警**：
- [ ] 监控 Outbox 待发布积压量
- [ ] 监控消息发布延迟（oldest unpublished event age）
- [ ] 监控 Debezium Connector 状态
- [ ] 监控消费者失败率
- [ ] 配置死信队列处理超过重试阈值的消息

**运维保障**：
- [ ] Outbox 表定期清理策略（已发布事件保留 7 天）
- [ ] 高吞吐场景使用按时间分区
- [ ] Debezium Connector 使用 GTID 模式便于断点恢复
- [ ] 准备 Debezium Connector 故障恢复 SOP 文档

### 10.3 未来展望

随着云原生技术的发展，Outbox Pattern 的实现正在向更加标准化和自动化的方向演进。值得持续关注的技术趋势包括：

- **Debezium Server**：无需 Kafka Connect，直接将 CDC 事件推送到 Redis Streams、Google Pub/Sub、Amazon Kinesis 等目标，降低了基础设施门槛
- **Database-native CDC**：如 PlanetScale 的 Change Streams、CockroachDB 的 Changefeed，数据库内置 CDC 能力，进一步简化架构
- **WASM-based SMT**：使用 WASM 编写自定义的消息转换逻辑，替代传统的 Java SMT，降低扩展门槛

Outbox Pattern 已经成为微服务架构中保证数据一致性的基础模式。无论选择哪种实现方案，理解其背后的设计原则——**单一事实来源、本地事务保证原子性、异步转发保证最终一致性、幂等消费保证正确性**——才是应对一切分布式一致性问题的根本。

## 相关阅读

- [Outbox Pattern 实战：保证数据库与消息队列的最终一致性——Laravel + Debezium 的可靠事件发布](/categories/php/outbox-pattern-debezium-laravel-reliable-event-publishing/)
- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/categories/architecture/2026-06-05-Saga-编排模式深度实战-Choreography-Orchestration-Temporal-Laravel分布式事务三种实现路线对比/)
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/categories/architecture/2026-06-03-Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
- [TCC 分布式事务模式实战：Try-Confirm-Cancel 在 Laravel 订单/支付/库存中的落地](/categories/architecture/TCC-分布式事务模式实战-Try-Confirm-Cancel-Laravel-订单支付库存落地/)
