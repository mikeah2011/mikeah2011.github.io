---
title: Eventual Consistency 实战：最终一致性在电商场景中的工程化——反压、冲突解决与用户感知延迟
date: 2026-06-04 09:00:00
tags: [eventual-consistency, ecommerce, distributed-systems, cap, crdt, saga, laravel, event-driven]
categories:
  - architecture
cover: /images/covers/eventual-consistency-ecommerce-cover.jpg
description: "深入解析最终一致性在电商场景中的工程化实践：涵盖 CAP/PACELC 理论、库存扣减乐观锁与 Redis 预扣减方案、订单状态机与幂等设计、支付回调防重与乱序处理、CRDT 冲突自动解决、反压策略与 Saga 补偿模式。大量 Laravel 可运行代码示例，助你构建高可用分布式电商系统。"
---

# Eventual Consistency 实战：最终一致性在电商场景中的工程化——反压、冲突解决与用户感知延迟

在单体架构时代，一致性是一个"不存在的问题"——所有数据都在同一个数据库里，一个事务搞定一切。然而当电商系统从日均百万订单膨胀到亿级并发，我们被迫将库存服务、订单服务、支付服务拆成独立的微服务，每个服务拥有自己的数据库。这时一个残酷的现实摆在面前：**你无法同时拥有强一致性、高可用性和分区容忍性**。

最终一致性不是妥协，而是工程化的选择。本文将从理论基础出发，深入电商场景中库存扣减、订单状态流转和支付回调的一致性挑战，通过 CRDT、向量时钟、反压策略、Saga 模式等工具箱，给出一套完整的工程化解决方案，并附带大量 Laravel 实战代码。

---

## 一、理论基础：从 CAP 到 PACELC

### 1.1 CAP 定理回顾

2000 年，Eric Brewer 提出了著名的 CAP 定理：在一个分布式系统中，以下三者最多只能同时满足两个：

- **C（Consistency，一致性）**：所有节点在同一时间看到相同的数据
- **A（Availability，可用性）**：每个请求都能在合理时间内收到响应
- **P（Partition Tolerance，分区容忍性）**：网络分区发生时系统仍能继续运行

在分布式系统中，网络分区是不可避免的现实，因此 P 是必选项。真正的选择在于：**当分区发生时，你选择 C 还是 A？**

- **CP 系统**（如 ZooKeeper、etcd）：牺牲可用性，保证一致性
- **AP 系统**（如 Cassandra、DynamoDB）：牺牲强一致性，保证可用性

电商系统天然倾向于 AP——大促期间宁可短暂超卖也不能让系统宕机。

### 1.2 BASE 理论

BASE 是对 CAP 中 AP 方案的理论总结：

- **BA（Basically Available，基本可用）**：系统在出现故障时仍能提供基本服务
- **S（Soft State，软状态）**：系统中的数据状态允许存在中间态
- **E（Eventually Consistent，最终一致性）**：在没有新写入的前提下，数据最终会达到一致

电商库存扣减就是典型的软状态场景：下单时库存显示"充足"，但扣减后可能短暂出现"库存未同步"的中间态。

### 1.3 PACELC 扩展

CAP 定理只考虑了分区发生时的取舍，但忽略了更常见的"无分区"场景。2012 年 Daniel Abadi 提出了 PACELC 扩展：

```
if (Partition) {
    选择: Availability or Consistency?
} else {
    选择: Latency or Consistency?
}
```

**PACELC 的四个分类：**

| 分类 | 分区时 | 无分区时 | 典型系统 |
|------|--------|----------|----------|
| PA/EL | 选可用性 | 选低延迟 | Cassandra、DynamoDB |
| PA/EC | 选可用性 | 选一致性 | Cosmos DB |
| PC/EL | 选一致性 | 选低延迟 | MongoDB（默认配置）|
| PC/EC | 选一致性 | 选一致性 | ZooKeeper、HBase |

对电商系统而言，大多数业务选择 **PA/EL**——分区时保可用，无分区时保低延迟。但库存扣减、支付确认等关键路径，往往需要在 PA/EL 的基础上叠加补偿机制来逼近 EC 的效果。

```php
<?php
/**
 * PACELC 决策器：根据操作类型决定一致性级别
 */
class PacelcDecisionMaker
{
    /**
     * 操作对应的一致性策略
     *
     * @var array<string, array{partition: string, normal: string}>
     */
    private array $strategies = [
        // 库存扣减：分区时保持可用（允许超卖），无分区时用强一致性
        'inventory.deduct' => ['partition' => 'AP', 'normal' => 'EC'],
        // 订单创建：分区时保持可用，无分区时用低延迟
        'order.create' => ['partition' => 'AP', 'normal' => 'EL'],
        // 支付确认：无论分区与否都要强一致性
        'payment.confirm' => ['partition' => 'CP', 'normal' => 'EC'],
        // 商品浏览：始终选可用性和低延迟
        'product.browse' => ['partition' => 'AP', 'normal' => 'EL'],
        // 购物车：分区时可用，无分区时低延迟
        'cart.update' => ['partition' => 'AP', 'normal' => 'EL'],
    ];

    public function decide(string $operation, bool $partitionDetected): array
    {
        $strategy = $this->strategies[$operation] ?? ['partition' => 'AP', 'normal' => 'EL'];

        return [
            'consistency_level' => $partitionDetected
                ? $strategy['partition']
                : $strategy['normal'],
            'operation' => $operation,
            'requires_compensation' => in_array($operation, [
                'inventory.deduct',
                'payment.confirm',
            ]),
        ];
    }
}
```

---

## 二、电商场景中的三大一致性挑战

### 2.1 库存扣减：超卖与少卖的博弈

库存扣减是电商系统中最具挑战性的一致性问题。极端场景下，一个商品可能有数万用户同时抢购，而库存只有几百件。

**乐观锁方案（数据库层面）：**

```php
<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\DB;

class InventoryService
{
    /**
     * 乐观锁库存扣减
     *
     * @throws InsufficientStockException
     */
    public function deduct(int $skuId, int $quantity, string $orderId): bool
    {
        return DB::transaction(function () use ($skuId, $quantity, $orderId) {
            // 读取当前库存和版本号
            $inventory = DB::table('inventory')
                ->where('sku_id', $skuId)
                ->lockForUpdate()
                ->first();

            if (!$inventory || $inventory->available < $quantity) {
                throw new InsufficientStockException(
                    "SKU {$skuId} 库存不足，可用: {$inventory->available}, 需要: {$quantity}"
                );
            }

            // CAS 操作：仅当版本号匹配时才更新
            $affected = DB::table('inventory')
                ->where('sku_id', $skuId)
                ->where('version', $inventory->version)
                ->update([
                    'available' => $inventory->available - $quantity,
                    'frozen' => $inventory->frozen + $quantity,
                    'version' => $inventory->version + 1,
                    'updated_at' => now(),
                ]);

            if ($affected === 0) {
                // 版本冲突，说明有并发修改
                throw new ConcurrentModificationException(
                    "SKU {$skuId} 库存被并发修改，请重试"
                );
            }

            // 记录库存流水
            DB::table('inventory_log')->insert([
                'sku_id' => $skuId,
                'order_id' => $orderId,
                'change_type' => 'frozen',
                'quantity' => -$quantity,
                'version_before' => $inventory->version,
                'version_after' => $inventory->version + 1,
                'created_at' => now(),
            ]);

            return true;
        });
    }

    /**
     * 带重试的库存扣减
     */
    public function deductWithRetry(int $skuId, int $quantity, string $orderId, int $maxRetries = 3): bool
    {
        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                return $this->deduct($skuId, $quantity, $orderId);
            } catch (ConcurrentModificationException $e) {
                if ($attempt === $maxRetries) {
                    throw $e;
                }
                // 指数退避
                usleep((int) (1000 * pow(2, $attempt)));
            }
        }

        return false;
    }
}
```

**Redis 预扣减 + 异步落库方案（高并发场景）：**

```php
<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\DB;

class RedisInventoryService
{
    private const INVENTORY_KEY = 'sku:inventory:%d';
    private const FROZEN_KEY = 'sku:frozen:%d';
    private const DEDUCT_SCRIPT = <<<'LUA'
        local inventory_key = KEYS[1]
        local frozen_key = KEYS[2]
        local quantity = tonumber(ARGV[1])
        local order_id = ARGV[2]

        -- 检查库存
        local current = tonumber(redis.call('GET', inventory_key) or '0')
        if current < quantity then
            return -1  -- 库存不足
        end

        -- 检查是否重复下单
        local duplicate_key = 'sku:order:' .. order_id
        if redis.call('EXISTS', duplicate_key) == 1 then
            return -2  -- 重复订单
        end

        -- 原子扣减
        redis.call('DECRBY', inventory_key, quantity)
        redis.call('INCRBY', frozen_key, quantity)
        redis.call('SET', duplicate_key, 1, 'EX', 3600)

        return 1
    LUA;

    /**
     * Redis 原子预扣减
     */
    public function preDeduct(int $skuId, int $quantity, string $orderId): int
    {
        $result = Redis::eval(
            self::DEDUCT_SCRIPT,
            2,
            sprintf(self::INVENTORY_KEY, $skuId),
            sprintf(self::FROZEN_KEY, $skuId),
            $quantity,
            $orderId
        );

        return (int) $result;
    }

    /**
     * 异步同步到数据库（通过消息队列）
     */
    public function syncToDatabase(int $skuId, int $quantity, string $orderId): void
    {
        DB::table('inventory_deduct_events')->insert([
            'sku_id' => $skuId,
            'order_id' => $orderId,
            'quantity' => $quantity,
            'status' => 'pending',
            'created_at' => now(),
        ]);

        // 发送到消息队列，由消费者异步更新数据库
        \App\Jobs\SyncInventoryToDbJob::dispatch($skuId, $quantity, $orderId);
    }
}
```

### 2.2 订单状态流转：状态机与最终一致

订单从创建到完成，会经历多个状态变更。在分布式环境中，每个状态变更可能由不同的服务驱动，这就要求状态流转具备幂等性和补偿能力。

```php
<?php

namespace App\Services\Order;

use App\Enums\OrderStatus;
use Illuminate\Support\Facades\DB;

class OrderStateMachine
{
    /**
     * 合法的状态转换映射
     */
    private const TRANSITIONS = [
        OrderStatus::Created->value => [OrderStatus::Paid->value, OrderStatus::Cancelled->value],
        OrderStatus::Paid->value => [OrderStatus::Shipping->value, OrderStatus::Refunding->value],
        OrderStatus::Shipping->value => [OrderStatus::Delivered->value, OrderStatus::Refunding->value],
        OrderStatus::Delivered->value => [OrderStatus::Completed->value, OrderStatus::Refunding->value],
        OrderStatus::Refunding->value => [OrderStatus::Refunded->value],
    ];

    /**
     * 状态流转（带幂等性保证）
     */
    public function transition(
        string $orderId,
        OrderStatus $targetStatus,
        string $eventSource,
        ?string $eventId = null
    ): bool {
        return DB::transaction(function () use ($orderId, $targetStatus, $eventSource, $eventId) {
            // 幂等性检查：如果该事件已经处理过，直接返回
            if ($eventId && $this->isEventProcessed($eventId)) {
                return true;
            }

            $order = DB::table('orders')
                ->where('id', $orderId)
                ->lockForUpdate()
                ->first();

            if (!$order) {
                throw new \RuntimeException("订单 {$orderId} 不存在");
            }

            $currentStatus = $order->status;
            $allowedTransitions = self::TRANSITIONS[$currentStatus] ?? [];

            if (!in_array($targetStatus->value, $allowedTransitions)) {
                throw new InvalidTransitionException(
                    "非法状态转换: {$currentStatus} -> {$targetStatus->value}"
                );
            }

            DB::table('orders')
                ->where('id', $orderId)
                ->update([
                    'status' => $targetStatus->value,
                    'updated_at' => now(),
                ]);

            // 记录状态流转日志
            DB::table('order_status_log')->insert([
                'order_id' => $orderId,
                'from_status' => $currentStatus,
                'to_status' => $targetStatus->value,
                'event_source' => $eventSource,
                'event_id' => $eventId,
                'created_at' => now(),
            ]);

            // 标记事件已处理（用于幂等）
            if ($eventId) {
                DB::table('processed_events')->insert([
                    'event_id' => $eventId,
                    'processed_at' => now(),
                ]);
            }

            return true;
        });
    }

    private function isEventProcessed(string $eventId): bool
    {
        return DB::table('processed_events')
            ->where('event_id', $eventId)
            ->exists();
    }
}
```

### 2.3 支付回调：第三方通知的不可靠性

支付回调是电商系统中最棘手的一致性问题。支付网关（如支付宝、微信支付）的回调通知有三个特点：**不可靠**（可能丢失）、**无序**（先发的后到）、**重复**（可能多次通知）。

```php
<?php

namespace App\Services\Payment;

use App\Services\Order\OrderStateMachine;
use App\Enums\OrderStatus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class PaymentCallbackHandler
{
    public function __construct(
        private OrderStateMachine $stateMachine,
    ) {}

    /**
     * 处理支付回调（幂等 + 防重 + 乱序处理）
     */
    public function handle(array $callback): void
    {
        $paymentNo = $callback['payment_no'];
        $orderNo = $callback['order_no'];
        $status = $callback['status'];
        $callbackId = $callback['callback_id']; // 支付网关的唯一通知ID

        // 第一道防线：幂等性检查（Redis 快速路径）
        $lockKey = "payment_callback:{$callbackId}";
        $lock = Cache::lock($lockKey, 30);

        if (!$lock->get()) {
            \Log::info("支付回调重复处理: {$callbackId}");
            return;
        }

        try {
            // 第二道防线：数据库幂等性检查
            $processed = DB::table('payment_callbacks')
                ->where('callback_id', $callbackId)
                ->where('status', 'processed')
                ->exists();

            if ($processed) {
                \Log::info("支付回调已处理（数据库确认）: {$callbackId}");
                return;
            }

            DB::transaction(function () use ($paymentNo, $orderNo, $status, $callbackId) {
                // 记录回调（防止丢失）
                DB::table('payment_callbacks')->updateOrInsert(
                    ['callback_id' => $callbackId],
                    [
                        'payment_no' => $paymentNo,
                        'order_no' => $orderNo,
                        'status' => 'processing',
                        'raw_data' => json_encode($callback),
                        'created_at' => now(),
                    ]
                );

                // 检查当前订单状态
                $order = DB::table('orders')->where('id', $orderNo)->first();

                if (!$order) {
                    throw new \RuntimeException("订单 {$orderNo} 不存在");
                }

                // 第三道防线：乱序处理（已支付的订单忽略"支付失败"的延迟通知）
                if ($order->status === OrderStatus::Paid->value && $status !== 'success') {
                    \Log::warning("乱序支付回调: 订单 {$orderNo} 已支付，忽略非成功通知");
                    DB::table('payment_callbacks')
                        ->where('callback_id', $callbackId)
                        ->update(['status' => 'ignored', 'reason' => 'order_already_paid']);
                    return;
                }

                // 执行状态流转
                if ($status === 'success') {
                    $this->stateMachine->transition(
                        $orderNo,
                        OrderStatus::Paid,
                        'payment_gateway',
                        $callbackId
                    );
                }

                // 标记回调处理完成
                DB::table('payment_callbacks')
                    ->where('callback_id', $callbackId)
                    ->update(['status' => 'processed', 'processed_at' => now()]);
            });
        } catch (\Exception $e) {
            DB::table('payment_callbacks')
                ->where('callback_id', $callbackId)
                ->update(['status' => 'failed', 'error' => $e->getMessage()]);
            throw $e;
        } finally {
            $lock->release();
        }
    }

    /**
     * 对账任务：定时拉取支付网关的交易记录，与本地对账
     */
    public function reconcile(string $date): void
    {
        // 从支付网关拉取当天的交易记录
        $remoteTransactions = $this->fetchFromGateway($date);

        // 查询本地支付记录
        $localTransactions = DB::table('payments')
            ->whereDate('created_at', $date)
            ->get()
            ->keyBy('payment_no');

        $mismatches = [];

        foreach ($remoteTransactions as $remote) {
            $local = $localTransactions->get($remote['payment_no']);

            if (!$local) {
                // 本地缺失记录：需要补偿
                $mismatches[] = [
                    'type' => 'missing_local',
                    'payment_no' => $remote['payment_no'],
                    'remote_status' => $remote['status'],
                ];
            } elseif ($local->status !== $remote['status']) {
                // 状态不一致：以支付网关为准
                $mismatches[] = [
                    'type' => 'status_mismatch',
                    'payment_no' => $remote['payment_no'],
                    'local_status' => $local->status,
                    'remote_status' => $remote['status'],
                ];
            }
        }

        // 处理不一致项
        foreach ($mismatches as $mismatch) {
            $this->handleMismatch($mismatch);
        }
    }
}
```

---

## 三、CRDT 与向量时钟实战

### 3.1 向量时钟（Vector Clock）

向量时钟是解决分布式系统中事件因果关系的核心工具。每个节点维护一个逻辑时钟向量，每次本地事件时递增本地计数器，每次发送消息时携带向量时钟，每次接收消息时合并向量时钟。

```php
<?php

namespace App\Distributed;

/**
 * 向量时钟实现
 */
class VectorClock
{
    /** @var array<string, int> 节点 -> 逻辑时间 */
    private array $clock = [];

    public function __construct(array $clock = [])
    {
        $this->clock = $clock;
    }

    /**
     * 本地事件发生时递增
     */
    public function increment(string $nodeId): self
    {
        $newClock = clone $this;
        $newClock->clock[$nodeId] = ($newClock->clock[$nodeId] ?? 0) + 1;
        return $newClock;
    }

    /**
     * 合接收到的向量时钟（取各分量的最大值，然后递增本地）
     */
    public function merge(VectorClock $other): self
    {
        $merged = [];
        $allNodes = array_unique(array_merge(
            array_keys($this->clock),
            array_keys($other->clock)
        ));

        foreach ($allNodes as $node) {
            $merged[$node] = max(
                $this->clock[$node] ?? 0,
                $other->clock[$node] ?? 0
            );
        }

        return new self($merged);
    }

    /**
     * 判断因果关系
     *
     * @return string 'before' | 'after' | 'concurrent'
     */
    public function compareTo(VectorClock $other): string
    {
        $hasLess = false;
        $hasGreater = false;

        $allNodes = array_unique(array_merge(
            array_keys($this->clock),
            array_keys($other->clock)
        ));

        foreach ($allNodes as $node) {
            $a = $this->clock[$node] ?? 0;
            $b = $other->clock[$node] ?? 0;

            if ($a < $b) {
                $hasLess = true;
            }
            if ($a > $b) {
                $hasGreater = true;
            }
        }

        if ($hasLess && !$hasGreater) {
            return 'before';
        }
        if ($hasGreater && !$hasLess) {
            return 'after';
        }
        if (!$hasLess && !$hasGreater) {
            return 'equal';
        }

        return 'concurrent';
    }

    public function toArray(): array
    {
        return $this->clock;
    }

    public function toString(): string
    {
        ksort($this->clock);
        return json_encode($this->clock, JSON_THROW_ON_ERROR);
    }

    public static function fromString(string $str): self
    {
        return new self(json_decode($str, true, 512, JSON_THROW_ON_ERROR));
    }
}
```

**向量时钟在订单版本追踪中的应用：**

```php
<?php

namespace App\Services\Order;

use App\Distributed\VectorClock;

class OrderVersionTracker
{
    /**
     * 创建带向量时钟的订单快照
     */
    public function createSnapshot(string $orderId, string $nodeId): array
    {
        $order = \DB::table('orders')->where('id', $orderId)->first();
        $clock = new VectorClock();
        $clock = $clock->increment($nodeId);

        return [
            'order_id' => $orderId,
            'data' => (array) $order,
            'vector_clock' => $clock->toString(),
            'node_id' => $nodeId,
            'timestamp' => now()->toIso8601String(),
        ];
    }

    /**
     * 检测订单并发修改
     */
    public function detectConflict(string $orderId, string $incomingClock, string $localClock): array
    {
        $incoming = VectorClock::fromString($incomingClock);
        $local = VectorClock::fromString($localClock);

        $relation = $incoming->compareTo($local);

        return [
            'order_id' => $orderId,
            'relation' => $relation,
            'has_conflict' => $relation === 'concurrent',
            'resolution' => match ($relation) {
                'before' => 'accept_local',       // 外来版本较旧，保持本地
                'after' => 'accept_incoming',     // 外来版本较新，接受外来
                'concurrent' => 'manual_resolve', // 并发冲突，需要手动解决或策略化
                'equal' => 'no_change',           // 完全相同
            },
        ];
    }
}
```

### 3.2 G-Counter（只增计数器）

G-Counter 是最简单的 CRDT。每个节点维护自己的计数器，合并时取各节点计数器的最大值。只能增加，不能减少。

```php
<?php

namespace App\CRDT;

/**
 * G-Counter：Grow-only Counter（只增计数器）
 *
 * 适用于：商品浏览量、页面访问次数等只能增加的场景
 */
class GCounter
{
    /** @var array<string, int> node_id -> count */
    private array $counters = [];

    public function __construct(string $nodeId)
    {
        $this->counters[$nodeId] = 0;
        $this->nodeId = $nodeId;
    }

    private string $nodeId;

    /**
     * 本地递增
     */
    public function increment(int $delta = 1): self
    {
        $this->counters[$this->nodeId] += $delta;
        return $this;
    }

    /**
     * 查询当前值（所有节点计数之和）
     */
    public function value(): int
    {
        return array_sum($this->counters);
    }

    /**
     * 合并另一个 G-Counter（取各分量最大值）
     */
    public function merge(GCounter $other): self
    {
        foreach ($other->counters as $node => $count) {
            $this->counters[$node] = max($this->counters[$node] ?? 0, $count);
        }
        return $this;
    }

    /**
     * 序列化
     */
    public function toArray(): array
    {
        return $this->counters;
    }

    public static function fromArray(array $data, string $nodeId): self
    {
        $counter = new self($nodeId);
        $counter->counters = $data;
        return $counter;
    }
}
```

### 3.3 PN-Counter（可增可减计数器）

PN-Counter 在 G-Counter 的基础上增加了递减能力。维护两个 G-Counter：一个记录增量，一个记录减量。当前值 = 增量总和 - 减量总和。

```php
<?php

namespace App\CRDT;

/**
 * PN-Counter：Positive-Negative Counter（可增可减计数器）
 *
 * 适用于：库存计数、购物车商品数量等需要增减的场景
 */
class PNCounter
{
    private GCounter $increments;
    private GCounter $decrements;

    public function __construct(string $nodeId)
    {
        $this->increments = new GCounter($nodeId);
        $this->decrements = new GCounter($nodeId);
    }

    /**
     * 递增
     */
    public function increment(int $delta = 1): self
    {
        $this->increments->increment($delta);
        return $this;
    }

    /**
     * 递减
     */
    public function decrement(int $delta = 1): self
    {
        $this->decrements->increment($delta);
        return $this;
    }

    /**
     * 当前值
     */
    public function value(): int
    {
        return $this->increments->value() - $this->decrements->value();
    }

    /**
     * 合并
     */
    public function merge(PNCounter $other): self
    {
        $this->increments->merge($other->increments);
        $this->decrements->merge($other->decrements);
        return $this;
    }

    public function toArray(): array
    {
        return [
            'increments' => $this->increments->toArray(),
            'decrements' => $this->decrements->toArray(),
        ];
    }

    public static function fromArray(array $data, string $nodeId): self
    {
        $counter = new self($nodeId);
        $counter->increments = GCounter::fromArray($data['increments'], $nodeId);
        $counter->decrements = GCounter::fromArray($data['decrements'], $nodeId);
        return $counter;
    }
}

/**
 * 使用 PN-Counter 管理分布式库存
 */
class DistributedInventory
{
    /** @var array<int, PNCounter> sku_id -> PNCounter */
    private array $counters = [];
    private string $nodeId;

    public function __construct(string $nodeId)
    {
        $this->nodeId = $nodeId;
    }

    /**
     * 初始化 SKU 库存
     */
    public function initSku(int $skuId, int $stock): void
    {
        $counter = new PNCounter($this->nodeId);
        $counter->increment($stock);
        $this->counters[$skuId] = $counter;
    }

    /**
     * 扣减库存
     */
    public function deduct(int $skuId, int $quantity): bool
    {
        $counter = $this->counters[$skuId] ?? null;
        if (!$counter || $counter->value() < $quantity) {
            return false;
        }

        $counter->decrement($quantity);
        return true;
    }

    /**
     * 合并来自其他节点的库存数据
     */
    public function mergeInventory(int $skuId, PNCounter $remoteCounter): void
    {
        if (isset($this->counters[$skuId])) {
            $this->counters[$skuId]->merge($remoteCounter);
        } else {
            $this->counters[$skuId] = $remoteCounter;
        }
    }

    /**
     * 获取当前库存
     */
    public function getStock(int $skuId): int
    {
        return $this->counters[$skuId]?->value() ?? 0;
    }
}
```

### 3.4 LWW-Register（Last-Writer-Wins 寄存器）

LWW-Register 使用时间戳来决定在发生冲突时接受哪个版本。当两个节点同时修改同一个值时，时间戳较大的版本胜出。

```php
<?php

namespace App\CRDT;

/**
 * LWW-Register：Last-Writer-Wins Register
 *
 * 适用于：用户地址、商品描述等以最后写入为准的场景
 */
class LWWRegister
{
    private mixed $value;
    private int $timestamp;
    private string $nodeId;

    public function __construct(string $nodeId)
    {
        $this->nodeId = $nodeId;
        $this->value = null;
        $this->timestamp = 0;
    }

    /**
     * 设置值
     */
    public function set(mixed $value, int $timestamp = null): self
    {
        $timestamp = $timestamp ?? (int) (microtime(true) * 1000);

        // 只有更新的时间戳才覆盖
        if ($timestamp > $this->timestamp) {
            $this->value = $value;
            $this->timestamp = $timestamp;
        } elseif ($timestamp === $this->timestamp) {
            // 时间戳相同，用 node_id 决定胜负（确定性）
            $incomingNodeId = $this->nodeId;
            if (strcmp($incomingNodeId, $this->nodeId) > 0) {
                $this->value = $value;
                $this->timestamp = $timestamp;
            }
        }

        return $this;
    }

    /**
     * 读取值
     */
    public function get(): mixed
    {
        return $this->value;
    }

    /**
     * 合并另一个 LWW-Register
     */
    public function merge(LWWRegister $other): self
    {
        if ($other->timestamp > $this->timestamp) {
            $this->value = $other->value;
            $this->timestamp = $other->timestamp;
        } elseif ($other->timestamp === $this->timestamp) {
            if (strcmp($other->nodeId, $this->nodeId) > 0) {
                $this->value = $other->value;
                $this->timestamp = $other->timestamp;
            }
        }

        return $this;
    }

    public function toArray(): array
    {
        return [
            'value' => $this->value,
            'timestamp' => $this->timestamp,
            'node_id' => $this->nodeId,
        ];
    }
}
```

### 3.5 ORSWOT（Observed-Remove Set Without Tombstones）

ORSWOT 是一种高级 CRDT，支持添加和删除元素。它使用向量时钟来跟踪每个添加操作的"观测"状态，只有当某个添加被所有节点都观测到后，对应的删除才会真正生效。

```php
<?php

namespace App\CRDT;

/**
 * ORSWOT：Observed-Remove Set Without Tombstones
 *
 * 适用于：购物车商品列表、用户标签、促销活动商品池等
 */
class ORSWOT
{
    /** @var array<string, array{value: mixed, clock: VectorClock}> */
    private array $elements = [];

    /** @var array<string, VectorClock> */
    private array $tombstones = [];

    private VectorClock $clock;
    private string $nodeId;

    public function __construct(string $nodeId)
    {
        $this->nodeId = $nodeId;
        $this->clock = new VectorClock([$nodeId => 0]);
    }

    /**
     * 添加元素
     */
    public function add(mixed $element): self
    {
        $key = $this->key($element);
        $this->clock = $this->clock->increment($this->nodeId);

        $this->elements[$key] = [
            'value' => $element,
            'clock' => $this->clock,
        ];

        // 移除对应的墓碑（如果存在）
        unset($this->tombstones[$key]);

        return $this;
    }

    /**
     * 删除元素
     */
    public function remove(mixed $element): bool
    {
        $key = $this->key($element);

        if (!isset($this->elements[$key])) {
            return false;
        }

        $this->clock = $this->clock->increment($this->nodeId);
        $this->tombstones[$key] = $this->elements[$key]['clock'];
        unset($this->elements[$key]);

        return true;
    }

    /**
     * 合并另一个 ORSWOT
     */
    public function merge(ORSWOT $other): self
    {
        // 合并时钟
        $this->clock = $this->clock->merge($other->clock);

        // 合并元素：如果对方的元素更新且不在我的墓碑中，则添加
        foreach ($other->elements as $key => $entry) {
            $inMyElements = isset($this->elements[$key]);
            $inMyTombstones = isset($this->tombstones[$key]);

            if (!$inMyElements && !$inMyTombstones) {
                // 我不知道这个元素，直接添加
                $this->elements[$key] = $entry;
            } elseif ($inMyElements) {
                // 双方都有，比较向量时钟
                $relation = $entry['clock']->compareTo($this->elements[$key]['clock']);
                if ($relation === 'after') {
                    $this->elements[$key] = $entry;
                }
            }
            // 如果在墓碑中，说明已被删除，不添加
        }

        // 合并墓碑
        foreach ($other->tombstones as $key => $tombstone) {
            if (!isset($this->tombstones[$key])) {
                $this->tombstones[$key] = $tombstone;
            } else {
                $this->tombstones[$key] = $this->tombstones[$key]->merge($tombstone);
            }

            // 如果墓碑覆盖了本地元素，删除该元素
            if (isset($this->elements[$key])) {
                $relation = $tombstone->compareTo($this->elements[$key]['clock']);
                if ($relation === 'after' || $relation === 'equal') {
                    unset($this->elements[$key]);
                }
            }
        }

        return $this;
    }

    /**
     * 获取当前所有元素
     */
    public function members(): array
    {
        return array_map(fn($entry) => $entry['value'], $this->elements);
    }

    public function count(): int
    {
        return count($this->elements);
    }

    public function contains(mixed $element): bool
    {
        return isset($this->elements[$this->key($element)]);
    }

    private function key(mixed $element): string
    {
        return is_string($element) ? $element : md5(serialize($element));
    }
}

/**
 * 使用 ORSWOT 实现分布式购物车
 */
class DistributedCart
{
    private ORSWOT $items;

    public function __construct(string $nodeId)
    {
        $this->items = new ORSWOT($nodeId);
    }

    public function addItem(int $skuId, int $quantity, string $name, float $price): void
    {
        $this->items->add([
            'sku_id' => $skuId,
            'quantity' => $quantity,
            'name' => $name,
            'price' => $price,
        ]);
    }

    public function removeItem(int $skuId): void
    {
        // 查找并移除
        foreach ($this->items->members() as $item) {
            if ($item['sku_id'] === $skuId) {
                $this->items->remove($item);
                break;
            }
        }
    }

    public function getItems(): array
    {
        return $this->items->members();
    }

    public function merge(DistributedCart $other): self
    {
        $this->items->merge($other->items);
        return $this;
    }
}
```

---

## 四、反压策略（Backpressure）

### 4.1 为什么需要反压

在大促场景下，系统面临的流量可能在瞬间暴增 10-100 倍。如果下游服务的处理速度跟不上上游的请求速度，就会导致请求积压、内存溢出、响应超时。反压的本质是：**让上游感知下游的处理能力，主动降低发送速率**。

### 4.2 Token Bucket（令牌桶）

令牌桶是最经典的限流算法，允许一定程度的突发流量。

```php
<?php

namespace App\Backpressure;

use Illuminate\Support\Facades\Redis;

/**
 * 令牌桶限流器
 */
class TokenBucket
{
    private string $key;
    private int $capacity;       // 桶容量
    private int $refillRate;     // 每秒补充的令牌数
    private int $refillInterval; // 补充间隔（毫秒）

    public function __construct(
        string $bucketName,
        int $capacity = 100,
        int $refillRate = 10,
        int $refillInterval = 1000
    ) {
        $this->key = "token_bucket:{$bucketName}";
        $this->capacity = $capacity;
        $this->refillRate = $refillRate;
        $this->refillInterval = $refillInterval;
    }

    private const SCRIPT = <<<'LUA'
        local key = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local refill_rate = tonumber(ARGV[2])
        local refill_interval = tonumber(ARGV[3])
        local now = tonumber(ARGV[4])
        local requested = tonumber(ARGV[5])

        local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
        local tokens = tonumber(bucket[1]) or capacity
        local last_refill = tonumber(bucket[2]) or now

        -- 计算应补充的令牌数
        local elapsed = now - last_refill
        local refill = math.floor(elapsed / refill_interval) * refill_rate
        tokens = math.min(capacity, tokens + refill)

        -- 尝试消费令牌
        if tokens >= requested then
            tokens = tokens - requested
            redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
            redis.call('EXPIRE', key, 3600)
            return 1  -- 允许
        else
            redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
            redis.call('EXPIRE', key, 3600)
            return 0  -- 拒绝
        end
    LUA;

    /**
     * 尝试获取令牌
     */
    public function tryAcquire(int $tokens = 1): bool
    {
        $now = (int) (microtime(true) * 1000);

        $result = Redis::eval(
            self::SCRIPT,
            1,
            $this->key,
            $this->capacity,
            $this->refillRate,
            $this->refillInterval,
            $now,
            $tokens
        );

        return (int) $result === 1;
    }

    /**
     * 等待获取令牌（带超时）
     */
    public function acquire(int $tokens = 1, int $timeoutMs = 5000): bool
    {
        $start = (int) (microtime(true) * 1000);
        $retryInterval = 50; // 50ms 重试间隔

        while ((microtime(true) * 1000 - $start) < $timeoutMs) {
            if ($this->tryAcquire($tokens)) {
                return true;
            }
            usleep($retryInterval * 1000);
        }

        return false;
    }
}

/**
 * 多级反压控制器
 */
class BackpressureController
{
    /** @var array<int, TokenBucket> */
    private array $buckets = [];

    /** @var array<string, callable> */
    private array $handlers = [];

    public function __construct()
    {
        // 不同优先级使用不同的桶
        $this->buckets['critical'] = new TokenBucket('critical', 50, 20);   // 支付等关键操作
        $this->buckets['normal'] = new TokenBucket('normal', 200, 50);      // 普通业务操作
        $this->buckets['low'] = new TokenBucket('low', 100, 10);            // 日志、统计等
    }

    /**
     * 带反压的任务提交
     */
    public function submit(string $priority, callable $task, array $args = []): ?array
    {
        $bucket = $this->buckets[$priority] ?? $this->buckets['normal'];

        if (!$bucket->tryAcquire()) {
            return [
                'accepted' => false,
                'reason' => 'rate_limited',
                'retry_after_ms' => 100,
            ];
        }

        try {
            $result = $task(...$args);
            return [
                'accepted' => true,
                'result' => $result,
            ];
        } catch (\Exception $e) {
            return [
                'accepted' => true,
                'error' => $e->getMessage(),
            ];
        }
    }
}
```

### 4.3 Sliding Window（滑动窗口）

滑动窗口限流比固定窗口更平滑，能精确控制任意时间窗口内的请求数量。

```php
<?php

namespace App\Backpressure;

use Illuminate\Support\Facades\Redis;

/**
 * 滑动窗口限流器
 */
class SlidingWindow
{
    private string $key;
    private int $maxRequests;
    private int $windowSizeMs;

    public function __construct(string $name, int $maxRequests, int $windowSizeSeconds = 60)
    {
        $this->key = "sliding_window:{$name}";
        $this->maxRequests = $maxRequests;
        $this->windowSizeMs = $windowSizeSeconds * 1000;
    }

    private const SCRIPT = <<<'LUA'
        local key = KEYS[1]
        local window_size = tonumber(ARGV[1])
        local max_requests = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        local window_start = now - window_size

        -- 清除窗口外的旧记录
        redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

        -- 统计当前窗口内的请求数
        local count = redis.call('ZCARD', key)

        if count < max_requests then
            -- 允许请求，记录时间戳
            redis.call('ZADD', key, now, now .. ':' .. math.random(100000))
            redis.call('PEXPIRE', key, window_size)
            return 1
        else
            -- 拒绝请求
            return 0
        end
    LUA;

    public function tryAcquire(): bool
    {
        $now = (int) (microtime(true) * 1000);

        $result = Redis::eval(
            self::SCRIPT,
            1,
            $this->key,
            $this->windowSizeMs,
            $this->maxRequests,
            $now
        );

        return (int) $result === 1;
    }

    /**
     * 获取当前窗口的使用率
     */
    public function usage(): float
    {
        $now = (int) (microtime(true) * 1000);
        $windowStart = $now - $this->windowSizeMs;

        Redis::zremrangebyscore($this->key, '-inf', $windowStart);
        $count = Redis::zcard($this->key);

        return $count / $this->maxRequests;
    }
}
```

### 4.4 Reactive Streams（响应式流）

在 Laravel 中，我们可以基于 ReactPHP 或自定义实现来构建响应式流反压。

```php
<?php

namespace App\Backpressure;

/**
 * 响应式流处理器（带反压）
 */
class ReactiveStream
{
    /** @var callable[] */
    private array $subscribers = [];

    /** @var array */
    private array $buffer = [];

    private int $bufferSize;
    private int $currentDemand = 0;
    private bool $completed = false;

    public function __construct(int $bufferSize = 1000)
    {
        $this->bufferSize = $bufferSize;
    }

    /**
     * 发布数据
     */
    public function emit(mixed $data): void
    {
        if ($this->completed) {
            return;
        }

        if ($this->currentDemand > 0) {
            // 有需求，直接发送
            $this->currentDemand--;
            foreach ($this->subscribers as $subscriber) {
                $subscriber($data);
            }
        } elseif (count($this->buffer) < $this->bufferSize) {
            // 无需求但缓冲区未满，暂存
            $this->buffer[] = $data;
        } else {
            // 缓冲区满了，丢弃最旧的
            array_shift($this->buffer);
            $this->buffer[] = $data;
            \Log::warning('ReactiveStream: buffer overflow, dropping oldest item');
        }
    }

    /**
     * 订阅（请求 N 个元素）
     */
    public function subscribe(callable $onNext, int $demand = 100): void
    {
        $this->subscribers[] = $onNext;
        $this->currentDemand += $demand;

        // 发送缓冲区中的数据
        while ($this->currentDemand > 0 && !empty($this->buffer)) {
            $data = array_shift($this->buffer);
            $this->currentDemand--;
            foreach ($this->subscribers as $subscriber) {
                $subscriber($data);
            }
        }
    }

    /**
     * 请求更多数据
     */
    public function request(int $count): void
    {
        $this->currentDemand += $count;

        // 消费缓冲区
        while ($this->currentDemand > 0 && !empty($this->buffer)) {
            $data = array_shift($this->buffer);
            $this->currentDemand--;
            foreach ($this->subscribers as $subscriber) {
                $subscriber($data);
            }
        }
    }

    public function complete(): void
    {
        $this->completed = true;
    }

    public function bufferSize(): int
    {
        return count($this->buffer);
    }
}

/**
 * 使用反压的订单事件处理
 */
class OrderEventProcessor
{
    private ReactiveStream $stream;
    private BackpressureController $controller;

    public function __construct()
    {
        $this->stream = new ReactiveStream(5000);
        $this->controller = new BackpressureController();
    }

    /**
     * 处理订单事件流
     */
    public function processOrderEvents(): void
    {
        $this->stream->subscribe(
            function (array $event) {
                $result = $this->controller->submit(
                    $event['priority'] ?? 'normal',
                    [$this, 'handleEvent'],
                    [$event]
                );

                if (!$result['accepted']) {
                    \Log::warning("订单事件被反压: {$event['event_id']}");
                    // 重新入队
                    $this->stream->emit($event);
                }
            },
            demand: 50
        );
    }

    public function handleEvent(array $event): void
    {
        match ($event['type']) {
            'order.created' => $this->onOrderCreated($event),
            'payment.completed' => $this->onPaymentCompleted($event),
            'inventory.deducted' => $this->onInventoryDeducted($event),
            default => null,
        };
    }

    private function onOrderCreated(array $event): void
    {
        // 处理订单创建事件
    }

    private function onPaymentCompleted(array $event): void
    {
        // 处理支付完成事件
    }

    private function onInventoryDeducted(array $event): void
    {
        // 处理库存扣减事件
    }
}
```

---

## 五、Laravel 中的 Saga 模式实现

Saga 模式是管理分布式事务的核心模式。它将一个长事务拆分为一系列本地事务，每个本地事务都有对应的补偿操作。当某一步失败时，逆序执行前面所有步骤的补偿操作。

### 5.1 编排型 Saga（Orchestration Saga）

编排型 Saga 使用一个中央协调器来指挥整个流程。每个步骤都知道自己要做什么以及下一步是什么。

```php
<?php

namespace App\Saga\Orchestration;

/**
 * Saga 步骤接口
 */
interface SagaStep
{
    /**
     * 执行步骤
     */
    public function execute(array $context): array;

    /**
     * 补偿操作
     */
    public function compensate(array $context): void;

    /**
     * 步骤名称
     */
    public function name(): string;
}
```

```php
<?php

namespace App\Saga\Orchestration;

use App\Services\Inventory\RedisInventoryService;
use App\Services\Order\OrderService;
use App\Services\Payment\PaymentService;
use App\Services\Shipping\ShippingService;

/**
 * 库存扣减步骤
 */
class DeductInventoryStep implements SagaStep
{
    public function __construct(private RedisInventoryService $inventoryService) {}

    public function execute(array $context): array
    {
        $result = $this->inventoryService->preDeduct(
            $context['sku_id'],
            $context['quantity'],
            $context['order_id']
        );

        if ($result < 0) {
            throw new \RuntimeException('库存不足');
        }

        return array_merge($context, ['inventory_deducted' => true]);
    }

    public function compensate(array $context): void
    {
        // 回滚库存
        $this->inventoryService->restoreInventory(
            $context['sku_id'],
            $context['quantity'],
            $context['order_id']
        );
    }

    public function name(): string
    {
        return 'deduct_inventory';
    }
}

/**
 * 创建订单步骤
 */
class CreateOrderStep implements SagaStep
{
    public function __construct(private OrderService $orderService) {}

    public function execute(array $context): array
    {
        $order = $this->orderService->create([
            'user_id' => $context['user_id'],
            'sku_id' => $context['sku_id'],
            'quantity' => $context['quantity'],
            'amount' => $context['amount'],
            'address' => $context['address'],
        ]);

        return array_merge($context, [
            'order_id' => $order->id,
            'order_created' => true,
        ]);
    }

    public function compensate(array $context): void
    {
        if (isset($context['order_id'])) {
            $this->orderService->cancel($context['order_id'], 'saga_compensation');
        }
    }

    public function name(): string
    {
        return 'create_order';
    }
}

/**
 * 发起支付步骤
 */
class InitiatePaymentStep implements SagaStep
{
    public function __construct(private PaymentService $paymentService) {}

    public function execute(array $context): array
    {
        $payment = $this->paymentService->create([
            'order_id' => $context['order_id'],
            'amount' => $context['amount'],
            'user_id' => $context['user_id'],
        ]);

        return array_merge($context, [
            'payment_id' => $payment->id,
            'payment_url' => $payment->payment_url,
        ]);
    }

    public function compensate(array $context): void
    {
        if (isset($context['payment_id'])) {
            $this->paymentService->cancel($context['payment_id']);
        }
    }

    public function name(): string
    {
        return 'initiate_payment';
    }
}

/**
 * 确认支付步骤（回调触发）
 */
class ConfirmPaymentStep implements SagaStep
{
    public function __construct(private PaymentService $paymentService) {}

    public function execute(array $context): array
    {
        $this->paymentService->confirm($context['payment_id']);
        return array_merge($context, ['payment_confirmed' => true]);
    }

    public function compensate(array $context): void
    {
        // 发起退款
        if (isset($context['payment_id'])) {
            $this->paymentService->refund($context['payment_id'], $context['amount']);
        }
    }

    public function name(): string
    {
        return 'confirm_payment';
    }
}

/**
 * 创建物流单步骤
 */
class CreateShipmentStep implements SagaStep
{
    public function __construct(private ShippingService $shippingService) {}

    public function execute(array $context): array
    {
        $shipment = $this->shippingService->create([
            'order_id' => $context['order_id'],
            'address' => $context['address'],
        ]);

        return array_merge($context, [
            'shipment_id' => $shipment->id,
            'tracking_no' => $shipment->tracking_no,
        ]);
    }

    public function compensate(array $context): void
    {
        if (isset($context['shipment_id'])) {
            $this->shippingService->cancel($context['shipment_id']);
        }
    }

    public function name(): string
    {
        return 'create_shipment';
    }
}
```

```php
<?php

namespace App\Saga\Orchestration;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Enums\SagaStatus;
use App\Enums\StepStatus;

/**
 * Saga 编排器
 */
class SagaOrchestrator
{
    /** @var SagaStep[] */
    private array $steps = [];
    private string $sagaId;
    private string $sagaType;

    public function __construct(string $sagaType)
    {
        $this->sagaType = $sagaType;
        $this->sagaId = uniqid('saga_');
    }

    /**
     * 添加步骤
     */
    public function addStep(SagaStep $step): self
    {
        $this->steps[] = $step;
        return $this;
    }

    /**
     * 执行 Saga
     */
    public function execute(array $context): SagaResult
    {
        $executedSteps = [];
        $currentContext = $context;

        // 记录 Saga 开始
        $this->persistSagaStart($context);

        foreach ($this->steps as $step) {
            $stepName = $step->name();
            Log::info("Saga [{$this->sagaId}] 执行步骤: {$stepName}");

            try {
                $this->persistStepStart($stepName);
                $currentContext = $step->execute($currentContext);
                $executedSteps[] = $step;
                $this->persistStepComplete($stepName, $currentContext);
            } catch (\Exception $e) {
                Log::error("Saga [{$this->sagaId}] 步骤 {$stepName} 失败: {$e->getMessage()}");
                $this->persistStepFailed($stepName, $e->getMessage());

                // 执行补偿（逆序）
                $this->compensate($executedSteps, $currentContext);

                return new SagaResult(
                    sagaId: $this->sagaId,
                    status: SagaStatus::Failed,
                    context: $currentContext,
                    error: $e->getMessage(),
                    executedSteps: array_map(fn($s) => $s->name(), $executedSteps)
                );
            }
        }

        $this->persistSagaComplete();
        Log::info("Saga [{$this->sagaId}] 完成");

        return new SagaResult(
            sagaId: $this->sagaId,
            status: SagaStatus::Completed,
            context: $currentContext,
            error: null,
            executedSteps: array_map(fn($s) => $s->name(), $executedSteps)
        );
    }

    /**
     * 执行补偿操作
     */
    private function compensate(array $executedSteps, array $context): void
    {
        Log::info("Saga [{$this->sagaId}] 开始补偿，已执行步骤: " .
            implode(', ', array_map(fn($s) => $s->name(), $executedSteps)));

        // 逆序补偿
        foreach (array_reverse($executedSteps) as $step) {
            $stepName = $step->name();
            try {
                Log::info("Saga [{$this->sagaId}] 补偿步骤: {$stepName}");
                $step->compensate($context);
                $this->persistStepCompensated($stepName);
            } catch (\Exception $e) {
                Log::critical("Saga [{$this->sagaId}] 补偿步骤 {$stepName} 失败: {$e->getMessage()}");
                // 补偿失败需要人工介入
                $this->persistCompensationFailed($stepName, $e->getMessage());
            }
        }

        $this->persistSagaCompensated();
    }

    // === 持久化方法 ===

    private function persistSagaStart(array $context): void
    {
        DB::table('saga_instances')->insert([
            'saga_id' => $this->sagaId,
            'saga_type' => $this->sagaType,
            'status' => SagaStatus::Running->value,
            'context' => json_encode($context),
            'started_at' => now(),
        ]);
    }

    private function persistStepStart(string $stepName): void
    {
        DB::table('saga_steps')->insert([
            'saga_id' => $this->sagaId,
            'step_name' => $stepName,
            'status' => StepStatus::Running->value,
            'started_at' => now(),
        ]);
    }

    private function persistStepComplete(string $stepName, array $context): void
    {
        DB::table('saga_steps')
            ->where('saga_id', $this->sagaId)
            ->where('step_name', $stepName)
            ->update([
                'status' => StepStatus::Completed->value,
                'output' => json_encode($context),
                'completed_at' => now(),
            ]);
    }

    private function persistStepFailed(string $stepName, string $error): void
    {
        DB::table('saga_steps')
            ->where('saga_id', $this->sagaId)
            ->where('step_name', $stepName)
            ->update([
                'status' => StepStatus::Failed->value,
                'error' => $error,
                'failed_at' => now(),
            ]);
    }

    private function persistStepCompensated(string $stepName): void
    {
        DB::table('saga_steps')
            ->where('saga_id', $this->sagaId)
            ->where('step_name', $stepName)
            ->update([
                'status' => StepStatus::Compensated->value,
                'compensated_at' => now(),
            ]);
    }

    private function persistCompensationFailed(string $stepName, string $error): void
    {
        DB::table('saga_steps')
            ->where('saga_id', $this->sagaId)
            ->where('step_name', $stepName)
            ->update([
                'status' => StepStatus::CompensationFailed->value,
                'compensation_error' => $error,
            ]);
    }

    private function persistSagaComplete(): void
    {
        DB::table('saga_instances')
            ->where('saga_id', $this->sagaId)
            ->update([
                'status' => SagaStatus::Completed->value,
                'completed_at' => now(),
            ]);
    }

    private function persistSagaCompensated(): void
    {
        DB::table('saga_instances')
            ->where('saga_id', $this->sagaId)
            ->update([
                'status' => SagaStatus::Compensated->value,
                'compensated_at' => now(),
            ]);
    }
}

/**
 * Saga 执行结果
 */
readonly class SagaResult
{
    public function __construct(
        public string $sagaId,
        public SagaStatus $status,
        public array $context,
        public ?string $error,
        public array $executedSteps,
    ) {}
}
```

### 5.2 协调型 Saga（Choreography Saga）

协调型 Saga 没有中央协调器，每个服务监听事件并自行决定下一步操作。更适合松耦合的微服务架构。

```php
<?php

namespace App\Saga\Choreography;

use Illuminate\Support\Facades\Event;

/**
 * Saga 事件基类
 */
abstract class SagaEvent
{
    public readonly string $sagaId;
    public readonly string $correlationId;
    public readonly \DateTimeImmutable $occurredAt;

    public function __construct(string $sagaId, string $correlationId)
    {
        $this->sagaId = $sagaId;
        $this->correlationId = $correlationId;
        $this->occurredAt = new \DateTimeImmutable();
    }
}

class OrderCreatedEvent extends SagaEvent
{
    public function __construct(
        string $sagaId,
        string $correlationId,
        public readonly string $orderId,
        public readonly int $skuId,
        public readonly int $quantity,
        public readonly float $amount,
    ) {
        parent::__construct($sagaId, $correlationId);
    }
}

class InventoryDeductedEvent extends SagaEvent
{
    public function __construct(
        string $sagaId,
        string $correlationId,
        public readonly string $orderId,
        public readonly int $skuId,
        public readonly int $quantity,
    ) {
        parent::__construct($sagaId, $correlationId);
    }
}

class InventoryDeductionFailedEvent extends SagaEvent
{
    public function __construct(
        string $sagaId,
        string $correlationId,
        public readonly string $orderId,
        public readonly string $reason,
    ) {
        parent::__construct($sagaId, $correlationId);
    }
}

class PaymentCompletedEvent extends SagaEvent
{
    public function __construct(
        string $sagaId,
        string $correlationId,
        public readonly string $orderId,
        public readonly string $paymentId,
    ) {
        parent::__construct($sagaId, $correlationId);
    }
}

class CompensationEvent extends SagaEvent
{
    public function __construct(
        string $sagaId,
        string $correlationId,
        public readonly string $reason,
        public readonly array $completedSteps,
    ) {
        parent::__construct($sagaId, $correlationId);
    }
}
```

```php
<?php

namespace App\Saga\Choreography;

use App\Services\Inventory\RedisInventoryService;
use App\Jobs\SagaEventJob;
use Illuminate\Support\Facades\Log;

class InventorySubscriber
{
    public function __construct(
        private RedisInventoryService $inventoryService
    ) {}

    /**
     * 监听订单创建事件，执行库存扣减
     */
    public function onOrderCreated(OrderCreatedEvent $event): void
    {
        Log::info("库存服务收到订单创建事件: {$event->orderId}");

        try {
            $result = $this->inventoryService->preDeduct(
                $event->skuId,
                $event->quantity,
                $event->orderId
            );

            if ($result < 0) {
                // 库存不足，发布失败事件
                Event::dispatch(new InventoryDeductionFailedEvent(
                    $event->sagaId,
                    $event->correlationId,
                    $event->orderId,
                    '库存不足'
                ));
                return;
            }

            // 库存扣减成功，发布成功事件
            Event::dispatch(new InventoryDeductedEvent(
                $event->sagaId,
                $event->correlationId,
                $event->orderId,
                $event->skuId,
                $event->quantity
            ));
        } catch (\Exception $e) {
            Log::error("库存扣减异常: {$e->getMessage()}");
            Event::dispatch(new InventoryDeductionFailedEvent(
                $event->sagaId,
                $event->correlationId,
                $event->orderId,
                $e->getMessage()
            ));
        }
    }

    /**
     * 监听补偿事件，回滚库存
     */
    public function onCompensation(CompensationEvent $event): void
    {
        if (in_array('inventory_deducted', $event->completedSteps)) {
            Log::info("库存服务执行补偿: saga={$event->sagaId}");
            // 回滚库存逻辑
        }
    }
}

class PaymentSubscriber
{
    public function onInventoryDeducted(InventoryDeductedEvent $event): void
    {
        Log::info("支付服务收到库存扣减成功事件: {$event->orderId}");
        // 创建支付记录、发起支付等
    }
}

class ShippingSubscriber
{
    public function onPaymentCompleted(PaymentCompletedEvent $event): void
    {
        Log::info("物流服务收到支付完成事件: {$event->orderId}");
        // 创建物流单
    }
}
```

```php
<?php

namespace App\Providers;

use App\Saga\Choreography\OrderCreatedEvent;
use App\Saga\Choreography\InventoryDeductedEvent;
use App\Saga\Choreography\PaymentCompletedEvent;
use App\Saga\Choreography\InventorySubscriber;
use App\Saga\Choreography\PaymentSubscriber;
use App\Saga\Choreography\ShippingSubscriber;
use Illuminate\Support\ServiceProvider;

class SagaServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 订单创建 -> 库存扣减
        Event::listen(OrderCreatedEvent::class, [InventorySubscriber::class, 'onOrderCreated']);

        // 库存扣减成功 -> 创建支付
        Event::listen(InventoryDeductedEvent::class, [PaymentSubscriber::class, 'onInventoryDeducted']);

        // 支付完成 -> 创建物流单
        Event::listen(PaymentCompletedEvent::class, [ShippingSubscriber::class, 'onPaymentCompleted']);
    }
}
```

### 5.3 两种 Saga 的对比

| 维度 | 编排型（Orchestration） | 协调型（Choreography） |
|------|------------------------|----------------------|
| 控制流 | 中央协调器统一指挥 | 各服务自行监听事件 |
| 耦合度 | 协调器与所有步骤耦合 | 松耦合，通过事件通信 |
| 可观测性 | 高，集中式状态追踪 | 低，需要分布式追踪 |
| 复杂度 | 随步骤数线性增长 | 随事件数指数增长 |
| 适用场景 | 步骤多、流程复杂的业务 | 步骤少、服务间独立性强 |
| 容错性 | 协调器是单点（需要 HA） | 天然去中心化 |

**电商推荐方案：** 编排型 Saga 用于下单流程（步骤多、需要精确补偿），协调型 Saga 用于售后流程（各服务相对独立）。

---

## 六、冲突解决策略

### 6.1 Last-Write-Wins（LWW）

最简单的冲突解决策略，用时间戳决定胜负。简单粗暴但会丢失数据。

```php
<?php

namespace App\ConflictResolution;

use Illuminate\Support\Facades\Redis;

class LastWriteWinsResolver
{
    /**
     * LWW 解决冲突
     */
    public function resolve(string $key, array $candidates): array
    {
        // 按时间戳降序排列，取最新的
        usort($candidates, fn($a, $b) => $b['timestamp'] <=> $a['timestamp']);

        $winner = $candidates[0];

        return [
            'resolved_value' => $winner['value'],
            'strategy' => 'last_write_wins',
            'winner_node' => $winner['node_id'],
            'winner_timestamp' => $winner['timestamp'],
            'discarded_count' => count($candidates) - 1,
        ];
    }

    /**
     * 用 Redis 实现 LWW（利用时间戳作为 score）
     */
    public function lwwSet(string $key, mixed $value, string $nodeId): void
    {
        $timestamp = microtime(true);
        $entry = json_encode([
            'value' => $value,
            'node_id' => $nodeId,
            'timestamp' => $timestamp,
        ]);

        // ZADD 使用时间戳作为 score
        Redis::zadd($key, $timestamp, $entry);

        // 只保留最新的一个
        Redis::zremrangebyrank($key, 0, -2);
    }

    public function lwwGet(string $key): ?array
    {
        $result = Redis::zrevrange($key, 0, 0);
        return $result ? json_decode($result[0], true) : null;
    }
}
```

### 6.2 Version Vector（版本向量）

版本向量比向量时钟更精确地追踪每个节点的版本。

```php
<?php

namespace App\ConflictResolution;

class VersionVectorResolver
{
    /**
     * 使用版本向量检测并解决冲突
     */
    public function resolve(
        string $key,
        array $localVersion,
        array $remoteVersion,
        mixed $localValue,
        mixed $remoteValue
    ): array {
        $localDominates = true;
        $remoteDominates = true;

        $allNodes = array_unique(array_merge(
            array_keys($localVersion),
            array_keys($remoteVersion)
        ));

        foreach ($allNodes as $node) {
            $lv = $localVersion[$node] ?? 0;
            $rv = $remoteVersion[$node] ?? 0;

            if ($lv < $rv) {
                $localDominates = false;
            }
            if ($rv < $lv) {
                $remoteDominates = false;
            }
        }

        if ($localDominates && !$remoteDominates) {
            return [
                'strategy' => 'version_vector',
                'resolution' => 'keep_local',
                'value' => $localValue,
            ];
        }

        if ($remoteDominates && !$localDominates) {
            return [
                'strategy' => 'version_vector',
                'resolution' => 'accept_remote',
                'value' => $remoteValue,
            ];
        }

        // 并发冲突！
        return [
            'strategy' => 'version_vector',
            'resolution' => 'conflict',
            'local_value' => $localValue,
            'remote_value' => $remoteValue,
            'requires_manual_resolution' => true,
        ];
    }
}
```

### 6.3 Merge 策略（自定义合并）

对于某些数据类型，可以设计自动合并逻辑。

```php
<?php

namespace App\ConflictResolution;

/**
 * 可合并的购物车
 */
class MergeableCart
{
    /**
     * 合并两个购物车（按 SKU 合并数量，取最新价格）
     */
    public function merge(array $local, array $remote): array
    {
        $merged = [];

        $localByKey = collect($local)->keyBy('sku_id');
        $remoteByKey = collect($remote)->keyBy('sku_id');

        $allSkuIds = array_unique(array_merge(
            $localByKey->keys()->toArray(),
            $remoteByKey->keys()->toArray()
        ));

        foreach ($allSkuIds as $skuId) {
            $localItem = $localByKey->get($skuId);
            $remoteItem = $remoteByKey->get($skuId);

            if ($localItem && $remoteItem) {
                // 两边都有：数量相加，取较新的价格
                $merged[] = [
                    'sku_id' => $skuId,
                    'quantity' => $localItem['quantity'] + $remoteItem['quantity'],
                    'price' => max($localItem['updated_at'], $remoteItem['updated_at'])
                        === $localItem['updated_at']
                        ? $localItem['price']
                        : $remoteItem['price'],
                    'name' => $remoteItem['name'] ?? $localItem['name'],
                    'updated_at' => max($localItem['updated_at'], $remoteItem['updated_at']),
                ];
            } elseif ($localItem) {
                $merged[] = $localItem;
            } else {
                $merged[] = $remoteItem;
            }
        }

        return $merged;
    }
}

/**
 * 用户地址合并策略
 */
class MergeableAddress
{
    /**
     * 合并用户地址（使用 LWW + 保留更多标签的地址）
     */
    public function merge(array $local, array $remote): array
    {
        // 如果是同一个地址 ID，取更新的版本
        if ($local['id'] === $remote['id']) {
            return $local['updated_at'] > $remote['updated_at'] ? $local : $remote;
        }

        // 不同地址：合并地址列表，保留最新的默认地址
        $merged = [];

        if ($local['is_default'] && $remote['is_default']) {
            // 两个都是默认地址，取更新的
            if ($local['updated_at'] > $remote['updated_at']) {
                $local['is_default'] = true;
                $remote['is_default'] = false;
            } else {
                $local['is_default'] = false;
                $remote['is_default'] = true;
            }
        }

        $merged[] = $local;
        $merged[] = $remote;

        return $merged;
    }
}
```

### 6.4 CRDT 冲突解决

利用前文实现的 CRDT 数据类型来自动解决冲突，无需人工介入。

```php
<?php

namespace App\ConflictResolution;

use App\CRDT\PNCounter;
use App\CRDT\LWWRegister;
use App\CRDT\ORSWOT;

/**
 * 基于 CRDT 的冲突解决器
 */
class CrdtResolver
{
    /**
     * 解决库存冲突
     */
    public function resolveInventory(
        int $skuId,
        array $nodeACounters,
        array $nodeBCounters,
        string $nodeAId,
        string $nodeBId
    ): array {
        $counterA = PNCounter::fromArray($nodeACounters, $nodeAId);
        $counterB = PNCounter::fromArray($nodeBCounters, $nodeBId);

        // CRDT 合并：自动解决冲突，结果是确定性的
        $counterA->merge($counterB);

        return [
            'sku_id' => $skuId,
            'resolved_stock' => $counterA->value(),
            'strategy' => 'crdt_pn_counter',
            'auto_resolved' => true,
        ];
    }

    /**
     * 解决商品描述冲突
     */
    public function resolveProductDescription(
        array $descriptions // [{value, timestamp, node_id}, ...]
    ): array {
        $lww = new LWWRegister('default');

        foreach ($descriptions as $desc) {
            $lww->set($desc['value'], $desc['timestamp']);
        }

        return [
            'resolved_value' => $lww->get(),
            'strategy' => 'crdt_lww_register',
            'auto_resolved' => true,
        ];
    }

    /**
     * 解决促销商品列表冲突
     */
    public function resolvePromotionProducts(
        array $localProducts,
        array $remoteProducts,
        string $localNodeId,
        string $remoteNodeId
    ): array {
        $setLocal = new ORSWOT($localNodeId);
        $setRemote = new ORSWOT($remoteNodeId);

        foreach ($localProducts as $p) {
            $setLocal->add($p);
        }
        foreach ($remoteProducts as $p) {
            $setRemote->add($p);
        }

        $setLocal->merge($setRemote);

        return [
            'resolved_products' => $setLocal->members(),
            'strategy' => 'crdt_orswot',
            'auto_resolved' => true,
        ];
    }
}
```

---

## 七、用户感知延迟的 UX 设计

最终一致性带来的延迟是不可避免的，但我们可以设计巧妙的 UX 来让用户"感觉不到"这种延迟。

### 7.1 乐观更新（Optimistic Update）

前端在发送请求后立即更新 UI，不等待服务端确认。

```javascript
/**
 * 乐观更新框架
 */
class OptimisticUpdater {
    constructor(options = {}) {
        this.pendingUpdates = new Map();
        this.retryQueue = [];
        this.maxRetries = options.maxRetries || 3;
        this.rollbackTimeout = options.rollbackTimeout || 5000;
    }

    /**
     * 执行乐观更新
     *
     * @param {string} updateId - 更新标识
     * @param {Function} optimisticAction - 乐观执行的操作（立即生效）
     * @param {Function} serverAction - 服务端请求
     * @param {Function} rollbackAction - 失败时的回滚操作
     * @param {Function} confirmAction - 成功时的确认操作
     */
    async execute({
        updateId,
        optimisticAction,
        serverAction,
        rollbackAction,
        confirmAction
    }) {
        // 1. 立即执行乐观更新
        const snapshot = optimisticAction();

        this.pendingUpdates.set(updateId, {
            snapshot,
            rollbackAction,
            timestamp: Date.now(),
            retryCount: 0,
        });

        // 2. 设置回滚超时
        const rollbackTimer = setTimeout(() => {
            this.handleTimeout(updateId);
        }, this.rollbackTimeout);

        try {
            // 3. 发送服务端请求
            const result = await serverAction();

            // 4. 服务端确认
            clearTimeout(rollbackTimer);
            this.pendingUpdates.delete(updateId);

            if (confirmAction) {
                confirmAction(result);
            }

            return result;
        } catch (error) {
            clearTimeout(rollbackTimer);
            return this.handleFailure(updateId, error, serverAction, confirmAction);
        }
    }

    async handleFailure(updateId, error, serverAction, confirmAction) {
        const pending = this.pendingUpdates.get(updateId);
        if (!pending) return;

        pending.retryCount++;

        if (pending.retryCount < this.maxRetries) {
            // 重试
            console.log(`重试 ${updateId}, 第 ${pending.retryCount} 次`);
            await new Promise(r => setTimeout(r, 1000 * pending.retryCount));

            try {
                const result = await serverAction();
                this.pendingUpdates.delete(updateId);
                if (confirmAction) confirmAction(result);
                return result;
            } catch (retryError) {
                return this.handleFailure(updateId, retryError, serverAction, confirmAction);
            }
        }

        // 重试用尽，执行回滚
        console.error(`更新 ${updateId} 失败，执行回滚`);
        pending.rollbackAction(pending.snapshot);
        this.pendingUpdates.delete(updateId);

        // 通知用户
        this.notifyRollback(updateId);
    }

    handleTimeout(updateId) {
        const pending = this.pendingUpdates.get(updateId);
        if (!pending) return;

        // 超时不立即回滚，而是标记为"同步中"
        this.showSyncingIndicator(updateId);
    }

    notifyRollback(updateId) {
        // 显示回滚通知
        const notification = document.createElement('div');
        notification.className = 'optimistic-rollback-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <span class="icon">⚠️</span>
                <span class="message">操作未能同步，请重试</span>
                <button class="retry-btn" onclick="window.optimisticUpdater.retry('${updateId}')">
                    重试
                </button>
            </div>
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    }

    showSyncingIndicator(updateId) {
        const indicator = document.querySelector(`[data-update-id="${updateId}"]`);
        if (indicator) {
            indicator.classList.add('syncing');
        }
    }
}
```

**购物车乐观更新示例：**

```javascript
/**
 * 购物车乐观更新
 */
class CartOptimisticManager {
    constructor() {
        this.updater = new OptimisticUpdater({ maxRetries: 3, rollbackTimeout: 10000 });
    }

    async addToCart(skuId, quantity) {
        return this.updater.execute({
            updateId: `cart_add_${skuId}`,
            optimisticAction: () => {
                // 立即更新 UI
                const currentCount = this.getCartCount(skuId);
                this.updateCartCount(skuId, currentCount + quantity);
                this.showCartBadge(this.getTotalItems() + quantity);
                this.showAddToCartAnimation(skuId);

                return { previousCount: currentCount };
            },
            serverAction: async () => {
                const response = await fetch('/api/cart/items', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sku_id: skuId, quantity }),
                });
                if (!response.ok) throw new Error('添加失败');
                return response.json();
            },
            rollbackAction: (snapshot) => {
                // 回滚 UI
                this.updateCartCount(skuId, snapshot.previousCount);
                this.showCartBadge(this.getTotalItems());
                this.showErrorToast('添加失败，请重试');
            },
            confirmAction: (result) => {
                // 用服务端返回的权威数据更新
                this.syncCartFromServer(result.cart);
                this.showSuccessToast('已添加到购物车');
            },
        });
    }

    getCartCount(skuId) { return 0; } // stub
    updateCartCount(skuId, count) {}
    showCartBadge(count) {}
    showAddToCartAnimation(skuId) {}
    showErrorToast(msg) {}
    showSuccessToast(msg) {}
    getTotalItems() { return 0; }
    syncCartFromServer(cart) {}
}
```

### 7.2 进度条与状态反馈

在一致性等待期间，通过进度条和状态文案让用户感知系统正在工作。

```html
<!-- 订单提交进度条组件 -->
<div id="order-progress" class="order-progress" style="display: none;">
    <div class="progress-header">
        <h3>正在提交订单...</h3>
        <span class="progress-percentage">0%</span>
    </div>
    <div class="progress-bar-container">
        <div class="progress-bar" id="progress-bar" style="width: 0%;"></div>
    </div>
    <div class="progress-steps">
        <div class="step" id="step-1">
            <span class="step-icon">📦</span>
            <span class="step-text">验证库存</span>
            <span class="step-status">等待中</span>
        </div>
        <div class="step" id="step-2">
            <span class="step-icon">📝</span>
            <span class="step-text">创建订单</span>
            <span class="step-status">等待中</span>
        </div>
        <div class="step" id="step-3">
            <span class="step-icon">💳</span>
            <span class="step-text">发起支付</span>
            <span class="step-status">等待中</span>
        </div>
        <div class="step" id="step-4">
            <span class="step-icon">✅</span>
            <span class="step-text">完成</span>
            <span class="step-status">等待中</span>
        </div>
    </div>
</div>
```

```javascript
/**
 * 订单提交进度追踪
 */
class OrderProgressTracker {
    constructor() {
        this.steps = [
            { id: 'step-1', weight: 20, label: '验证库存' },
            { id: 'step-2', weight: 40, label: '创建订单' },
            { id: 'step-3', weight: 30, label: '发起支付' },
            { id: 'step-4', weight: 10, label: '完成' },
        ];
        this.currentStep = 0;
        this.progress = 0;
    }

    start() {
        document.getElementById('order-progress').style.display = 'block';
        this.animateProgress();
    }

    nextStep() {
        const step = this.steps[this.currentStep];
        if (!step) return;

        // 更新步骤状态
        document.getElementById(step.id).classList.add('active');
        document.getElementById(step.id).querySelector('.step-status').textContent = '进行中';

        // 模拟进度
        const targetProgress = this.steps
            .slice(0, this.currentStep + 1)
            .reduce((sum, s) => sum + s.weight, 0);

        this.animateToProgress(targetProgress);
        this.currentStep++;
    }

    completeStep() {
        const step = this.steps[this.currentStep - 1];
        if (!step) return;

        document.getElementById(step.id).classList.remove('active');
        document.getElementById(step.id).classList.add('completed');
        document.getElementById(step.id).querySelector('.step-status').textContent = '完成';
    }

    fail(message) {
        const step = this.steps[this.currentStep];
        if (step) {
            document.getElementById(step.id).classList.add('failed');
            document.getElementById(step.id).querySelector('.step-status').textContent = '失败';
        }

        document.querySelector('.progress-header h3').textContent = `提交失败：${message}`;
    }

    animateToProgress(target) {
        const bar = document.getElementById('progress-bar');
        const percentage = document.querySelector('.progress-percentage');

        const animate = () => {
            if (this.progress < target) {
                this.progress += 1;
                bar.style.width = `${this.progress}%`;
                percentage.textContent = `${this.progress}%`;
                requestAnimationFrame(animate);
            }
        };
        requestAnimationFrame(animate);
    }
}
```

### 7.3 补偿通知

当后端最终一致性协调完成后，通过 WebSocket 或 SSE 推送结果给前端。

```php
<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * 订单状态变更通知（WebSocket 推送）
 */
class OrderStatusUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly string $userId,
        public readonly string $orderId,
        public readonly string $newStatus,
        public readonly string $message,
        public readonly ?string $actionUrl = null,
        public readonly string $priority = 'normal', // normal | warning | error
    ) {}

    public function broadcastOn(): array
    {
        return [new Channel("user.{$this->userId}")];
    }

    public function broadcastAs(): string
    {
        return 'order.status.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'order_id' => $this->orderId,
            'status' => $this->newStatus,
            'message' => $this->message,
            'action_url' => $this->actionUrl,
            'priority' => $this->priority,
            'timestamp' => now()->toIso8601String(),
        ];
    }
}
```

```javascript
/**
 * 前端实时通知监听
 */
class RealtimeNotificationManager {
    constructor() {
        this.setupWebSocket();
    }

    setupWebSocket() {
        // 使用 Laravel Echo 监听
        Echo.private(`user.${window.userId}`)
            .listen('.order.status.updated', (event) => {
                this.handleOrderUpdate(event);
            });
    }

    handleOrderUpdate(event) {
        // 更新订单状态显示
        this.updateOrderStatusUI(event.order_id, event.status);

        // 显示通知
        this.showNotification({
            title: this.getStatusTitle(event.status),
            message: event.message,
            priority: event.priority,
            actionUrl: event.action_url,
        });

        // 更新进度条（如果正在显示）
        if (event.status === 'paid') {
            orderTracker.nextStep();
            orderTracker.completeStep();
        }
    }

    showNotification({ title, message, priority, actionUrl }) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${priority}`;
        notification.innerHTML = `
            <div class="notification-icon">
                ${priority === 'error' ? '❌' : priority === 'warning' ? '⚠️' : '✅'}
            </div>
            <div class="notification-body">
                <strong>${title}</strong>
                <p>${message}</p>
            </div>
            ${actionUrl ? `<a href="${actionUrl}" class="notification-action">查看</a>` : ''}
            <button class="notification-close" onclick="this.parentElement.remove()">×</button>
        `;

        document.getElementById('notification-container').appendChild(notification);

        // 自动消失
        setTimeout(() => notification.remove(), 8000);
    }

    getStatusTitle(status) {
        const titles = {
            'paid': '支付成功',
            'shipping': '已发货',
            'delivered': '已签收',
            'refunded': '退款成功',
            'cancelled': '已取消',
        };
        return titles[status] || '订单更新';
    }

    updateOrderStatusUI(orderId, status) {
        const statusEl = document.querySelector(`[data-order="${orderId}"] .order-status`);
        if (statusEl) {
            statusEl.textContent = this.getStatusTitle(status);
            statusEl.className = `order-status status-${status}`;
        }
    }
}
```

### 7.4 前端乐观更新 + 后端补偿通知的完整流程

```javascript
/**
 * 完整的电商下单流程前端实现
 */
class EcommerceCheckout {
    constructor() {
        this.progressTracker = new OrderProgressTracker();
        this.optimisticUpdater = new OptimisticUpdater();
        this.notificationManager = new RealtimeNotificationManager();
    }

    async submitOrder(orderData) {
        // 显示进度
        this.progressTracker.start();

        // Step 1: 乐观库存检查（立即显示）
        this.progressTracker.nextStep();
        this.showOptimisticStockCheck(orderData.items);
        this.progressTracker.completeStep();

        // Step 2: 创建订单
        this.progressTracker.nextStep();

        try {
            const result = await this.optimisticUpdater.execute({
                updateId: `order_${Date.now()}`,
                optimisticAction: () => {
                    // 立即显示"订单创建中"
                    this.showOrderCreating(orderData);
                    return { timestamp: Date.now() };
                },
                serverAction: async () => {
                    const response = await fetch('/api/orders', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(orderData),
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.message || '订单创建失败');
                    }

                    return response.json();
                },
                rollbackAction: (snapshot) => {
                    this.progressTracker.fail('订单创建失败');
                    this.showError('订单创建失败，请重试');
                },
                confirmAction: (result) => {
                    this.progressTracker.completeStep();
                    // Step 3: 跳转支付
                    this.progressTracker.nextStep();
                    window.location.href = result.payment_url;
                },
            });
        } catch (error) {
            this.progressTracker.fail(error.message);
            this.showError(error.message);
        }
    }

    showOptimisticStockCheck(items) {
        // 乐观地显示"库存充足"
    }

    showOrderCreating(orderData) {
        // 显示订单创建中状态
    }

    showError(message) {
        // 显示错误信息
    }
}
```

---

## 八、完整电商下单流程实战

将以上所有技术组合起来，实现一个完整的电商下单流程。

### 8.1 数据库 Schema

```sql
-- 订单表
CREATE TABLE orders (
    id VARCHAR(32) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    status ENUM('pending', 'created', 'paid', 'shipping', 'delivered', 'completed', 'cancelled', 'refunding', 'refunded') NOT NULL DEFAULT 'pending',
    total_amount DECIMAL(10,2) NOT NULL,
    shipping_address JSON NOT NULL,
    vector_clock JSON,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_status (user_id, status),
    INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB;

-- 订单项表
CREATE TABLE order_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(32) NOT NULL,
    sku_id BIGINT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    INDEX idx_order (order_id),
    INDEX idx_sku (sku_id)
) ENGINE=InnoDB;

-- 库存表
CREATE TABLE inventory (
    sku_id BIGINT PRIMARY KEY,
    available INT NOT NULL DEFAULT 0,
    frozen INT NOT NULL DEFAULT 0,
    sold INT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 库存流水表
CREATE TABLE inventory_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sku_id BIGINT NOT NULL,
    order_id VARCHAR(32),
    change_type ENUM('deduct', 'restore', 'freeze', 'unfreeze') NOT NULL,
    quantity INT NOT NULL,
    version_before INT NOT NULL,
    version_after INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sku_created (sku_id, created_at),
    INDEX idx_order (order_id)
) ENGINE=InnoDB;

-- Saga 实例表
CREATE TABLE saga_instances (
    saga_id VARCHAR(64) PRIMARY KEY,
    saga_type VARCHAR(64) NOT NULL,
    status ENUM('running', 'completed', 'failed', 'compensated') NOT NULL,
    context JSON NOT NULL,
    error TEXT,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP NULL,
    compensated_at TIMESTAMP NULL,
    INDEX idx_status (status),
    INDEX idx_type_status (saga_type, status)
) ENGINE=InnoDB;

-- Saga 步骤表
CREATE TABLE saga_steps (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    saga_id VARCHAR(64) NOT NULL,
    step_name VARCHAR(64) NOT NULL,
    status ENUM('pending', 'running', 'completed', 'failed', 'compensated', 'compensation_failed') NOT NULL,
    output JSON,
    error TEXT,
    compensation_error TEXT,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    failed_at TIMESTAMP NULL,
    compensated_at TIMESTAMP NULL,
    INDEX idx_saga (saga_id),
    UNIQUE KEY uk_saga_step (saga_id, step_name)
) ENGINE=InnoDB;

-- 支付回调表
CREATE TABLE payment_callbacks (
    callback_id VARCHAR(128) PRIMARY KEY,
    payment_no VARCHAR(64) NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    status ENUM('pending', 'processing', 'processed', 'failed', 'ignored') NOT NULL,
    raw_data JSON,
    error TEXT,
    reason VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    INDEX idx_payment (payment_no),
    INDEX idx_order (order_no)
) ENGINE=InnoDB;

-- 已处理事件表（幂等性保证）
CREATE TABLE processed_events (
    event_id VARCHAR(128) PRIMARY KEY,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
```

### 8.2 完整下单服务

```php
<?php

namespace App\Services\Ecommerce;

use App\Saga\Orchestration\SagaOrchestrator;
use App\Saga\Orchestration\DeductInventoryStep;
use App\Saga\Orchestration\CreateOrderStep;
use App\Saga\Orchestration\InitiatePaymentStep;
use App\Events\OrderStatusUpdated;
use App\Backpressure\TokenBucket;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

/**
 * 完整的电商下单服务
 */
class CheckoutService
{
    private SagaOrchestrator $sagaOrchestrator;
    private TokenBucket $orderRateLimiter;

    public function __construct(
        private readonly DeductInventoryStep $inventoryStep,
        private readonly CreateOrderStep $orderStep,
        private readonly InitiatePaymentStep $paymentStep,
    ) {
        // 下单限流：每秒最多 500 个订单
        $this->orderRateLimiter = new TokenBucket('checkout', 500, 200);
    }

    /**
     * 提交订单
     *
     * @param array{
     *     user_id: int,
     *     items: array<int, array{sku_id: int, quantity: int}>,
     *     address: array,
     *     coupon_code?: string,
     *     note?: string,
     * } $request
     */
    public function checkout(array $request): CheckoutResult
    {
        $startTime = microtime(true);

        // === 1. 反压检查 ===
        if (!$this->orderRateLimiter->tryAcquire()) {
            return CheckoutResult::rateLimited(
                '当前订单量过大，请稍后重试',
                retryAfterMs: 2000
            );
        }

        // === 2. 防重检查 ===
        $deduplicateKey = "checkout:{$request['user_id']}:" . md5(json_encode($request['items']));
        if (Cache::has($deduplicateKey)) {
            return CheckoutResult::duplicate('请勿重复提交');
        }
        Cache::put($deduplicateKey, true, 30);

        // === 3. 参数验证 ===
        $validation = $this->validateRequest($request);
        if (!$validation['valid']) {
            return CheckoutResult::validationError($validation['errors']);
        }

        // === 4. 计算订单金额 ===
        $pricing = $this->calculatePricing($request);

        // === 5. 执行 Saga ===
        $saga = new SagaOrchestrator('checkout');

        foreach ($request['items'] as $item) {
            $saga->addStep(new DeductInventoryStep(
                app(RedisInventoryService::class)
            ));
        }

        $saga->addStep(new CreateOrderStep(app(OrderService::class)))
             ->addStep(new InitiatePaymentStep(app(PaymentService::class)));

        $context = [
            'user_id' => $request['user_id'],
            'items' => $request['items'],
            'address' => $request['address'],
            'total_amount' => $pricing['total'],
            'coupon_code' => $request['coupon_code'] ?? null,
            'note' => $request['note'] ?? null,
        ];

        $result = $saga->execute($context);

        $elapsed = (microtime(true) - $startTime) * 1000;
        Log::info("下单完成", [
            'saga_id' => $result->sagaId,
            'status' => $result->status->value,
            'elapsed_ms' => $elapsed,
        ]);

        // === 6. 返回结果 ===
        if ($result->status->value === 'completed') {
            // 推送实时通知
            event(new OrderStatusUpdated(
                userId: (string) $request['user_id'],
                orderId: $result->context['order_id'],
                newStatus: 'created',
                message: '订单创建成功，等待支付',
                actionUrl: "/orders/{$result->context['order_id']}/pay",
            ));

            return CheckoutResult::success(
                orderId: $result->context['order_id'],
                paymentUrl: $result->context['payment_url'] ?? null,
                sagaId: $result->sagaId,
            );
        }

        // Saga 失败
        event(new OrderStatusUpdated(
            userId: (string) $request['user_id'],
            orderId: $result->context['order_id'] ?? 'unknown',
            newStatus: 'failed',
            message: '订单创建失败: ' . ($result->error ?? '未知错误'),
            priority: 'error',
        ));

        return CheckoutResult::failure(
            message: $result->error ?? '下单失败，请重试',
            sagaId: $result->sagaId,
        );
    }

    private function validateRequest(array $request): array
    {
        $errors = [];

        if (empty($request['items'])) {
            $errors[] = '购物车为空';
        }

        if (empty($request['address'])) {
            $errors[] = '请填写收货地址';
        }

        foreach ($request['items'] as $item) {
            if ($item['quantity'] <= 0) {
                $errors[] = "商品数量必须大于 0";
            }
            if ($item['quantity'] > 99) {
                $errors[] = "单商品限购 99 件";
            }
        }

        return ['valid' => empty($errors), 'errors' => $errors];
    }

    private function calculatePricing(array $request): array
    {
        // 查询商品价格
        $skuIds = array_column($request['items'], 'sku_id');
        $products = DB::table('products')->whereIn('sku_id', $skuIds)->get()->keyBy('sku_id');

        $subtotal = 0;
        $itemDetails = [];

        foreach ($request['items'] as $item) {
            $product = $products->get($item['sku_id']);
            if (!$product) {
                throw new \RuntimeException("商品 {$item['sku_id']} 不存在");
            }

            $itemTotal = $product->price * $item['quantity'];
            $subtotal += $itemTotal;

            $itemDetails[] = [
                'sku_id' => $item['sku_id'],
                'quantity' => $item['quantity'],
                'unit_price' => $product->price,
                'total_price' => $itemTotal,
            ];
        }

        // 优惠券计算（如果有）
        $discount = 0;
        if (!empty($request['coupon_code'])) {
            $discount = $this->applyCoupon($request['coupon_code'], $subtotal);
        }

        $shipping = $subtotal >= 99 ? 0 : 10; // 满 99 包邮

        return [
            'subtotal' => $subtotal,
            'discount' => $discount,
            'shipping' => $shipping,
            'total' => $subtotal - $discount + $shipping,
            'items' => $itemDetails,
        ];
    }

    private function applyCoupon(string $code, float $subtotal): float
    {
        $coupon = DB::table('coupons')
            ->where('code', $code)
            ->where('expires_at', '>', now())
            ->where('used_count', '<', DB::raw('max_count'))
            ->first();

        if (!$coupon) return 0;

        return match ($coupon->type) {
            'fixed' => min($coupon->value, $subtotal),
            'percent' => round($subtotal * $coupon->value / 100, 2),
            default => 0,
        };
    }
}

/**
 * 下单结果
 */
readonly class CheckoutResult
{
    public function __construct(
        public bool $success,
        public string $message,
        public ?string $orderId = null,
        public ?string $paymentUrl = null,
        public ?string $sagaId = null,
        public ?int $retryAfterMs = null,
        public ?array $errors = null,
    ) {}

    public static function success(string $orderId, ?string $paymentUrl, string $sagaId): self
    {
        return new self(true, '下单成功', $orderId, $paymentUrl, $sagaId);
    }

    public static function failure(string $message, string $sagaId): self
    {
        return new self(false, $message, sagaId: $sagaId);
    }

    public static function rateLimited(string $message, int $retryAfterMs): self
    {
        return new self(false, $message, retryAfterMs: $retryAfterMs);
    }

    public static function duplicate(string $message): self
    {
        return new self(false, $message);
    }

    public static function validationError(array $errors): self
    {
        return new self(false, '参数错误', errors: $errors);
    }
}
```

### 8.3 控制器与路由

```php
<?php

namespace App\Http\Controllers;

use App\Services\Ecommerce\CheckoutService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CheckoutController extends Controller
{
    public function __construct(private CheckoutService $checkoutService) {}

    /**
     * 提交订单
     */
    public function store(Request $request): JsonResponse
    {
        $result = $this->checkoutService->checkout([
            'user_id' => $request->user()->id,
            'items' => $request->input('items'),
            'address' => $request->input('address'),
            'coupon_code' => $request->input('coupon_code'),
            'note' => $request->input('note'),
        ]);

        if ($result->success) {
            return response()->json([
                'success' => true,
                'data' => [
                    'order_id' => $result->orderId,
                    'payment_url' => $result->paymentUrl,
                ],
                'message' => $result->message,
            ], 201);
        }

        $status = $result->retryAfterMs ? 429 : 422;

        return response()->json([
            'success' => false,
            'message' => $result->message,
            'errors' => $result->errors,
            'retry_after_ms' => $result->retryAfterMs,
        ], $status);
    }
}
```

```php
<?php

use App\Http\Controllers\CheckoutController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth', 'throttle:60,1'])->group(function () {
    Route::post('/api/checkout', [CheckoutController::class, 'store']);
});
```

### 8.4 定时对账与补偿任务

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Saga 补偿检查命令
 */
class SagaCompensationCheck extends Command
{
    protected $signature = 'saga:compensate-check {--timeout=300 : 超时时间（秒）}';
    protected $description = '检查并处理超时的 Saga 实例';

    public function handle(): int
    {
        $timeout = (int) $this->option('timeout');
        $timeoutThreshold = now()->subSeconds($timeout);

        // 查找超时的运行中 Saga
        $stuckSagas = DB::table('saga_instances')
            ->where('status', 'running')
            ->where('started_at', '<', $timeoutThreshold)
            ->limit(100)
            ->get();

        $this->info("找到 {$stuckSagas->count()} 个超时的 Saga 实例");

        foreach ($stuckSagas as $saga) {
            $this->warn("处理 Saga: {$saga->saga_id} (类型: {$saga->saga_type})");

            try {
                $this->compensateSaga($saga);
                $this->info("  Saga {$saga->saga_id} 补偿完成");
            } catch (\Exception $e) {
                Log::critical("Saga 补偿失败: {$saga->saga_id}", [
                    'error' => $e->getMessage(),
                ]);
                $this->error("  补偿失败: {$e->getMessage()}");

                // 标记为需要人工介入
                DB::table('saga_instances')
                    ->where('saga_id', $saga->saga_id)
                    ->update([
                        'status' => 'failed',
                        'error' => '补偿失败，需要人工介入: ' . $e->getMessage(),
                    ]);
            }
        }

        return Command::SUCCESS;
    }

    private function compensateSaga(object $saga): void
    {
        $context = json_decode($saga->context, true);

        // 获取已完成的步骤
        $completedSteps = DB::table('saga_steps')
            ->where('saga_id', $saga->saga_id)
            ->where('status', 'completed')
            ->orderByDesc('completed_at')
            ->get();

        foreach ($completedSteps as $step) {
            $this->line("  补偿步骤: {$step->step_name}");

            // 根据步骤类型执行补偿
            match ($step->step_name) {
                'deduct_inventory' => $this->compensateInventory($context),
                'create_order' => $this->compensateOrder($context),
                'initiate_payment' => $this->compensatePayment($context),
                default => Log::warning("未知步骤类型: {$step->step_name}"),
            };
        }
    }

    private function compensateInventory(array $context): void
    {
        foreach ($context['items'] ?? [] as $item) {
            DB::table('inventory')
                ->where('sku_id', $item['sku_id'])
                ->increment('available', $item['quantity']);
        }
    }

    private function compensateOrder(array $context): void
    {
        if (isset($context['order_id'])) {
            DB::table('orders')
                ->where('id', $context['order_id'])
                ->update(['status' => 'cancelled']);
        }
    }

    private function compensatePayment(array $context): void
    {
        // 发起退款请求（如果有支付记录）
        if (isset($context['payment_id'])) {
            Log::info("发起退款: payment={$context['payment_id']}");
        }
    }
}
```

---

## 九、生产环境注意事项

### 9.1 监控指标

在最终一致性架构中，监控是生命线。以下是必须监控的关键指标：

```php
<?php

namespace App\Monitoring;

use Illuminate\Support\Facades\Redis;

/**
 * 最终一致性监控
 */
class ConsistencyMonitor
{
    /**
     * 记录一致性延迟
     */
    public static function recordSyncLatency(string $metric, float $latencyMs): void
    {
        Redis::lPush("metrics:sync_latency:{$metric}", json_encode([
            'latency_ms' => $latencyMs,
            'timestamp' => microtime(true),
        ]));
        Redis::lTrim("metrics:sync_latency:{$metric}", 0, 9999);
    }

    /**
     * 记录不一致事件
     */
    public static function recordInconsistency(string $type, array $details): void
    {
        Redis::incr("metrics:inconsistency:{$type}:" . date('Y-m-d'));
        Redis::expire("metrics:inconsistency:{$type}:" . date('Y-m-d'), 86400 * 7);

        Redis::lPush('metrics:inconsistency:recent', json_encode([
            'type' => $type,
            'details' => $details,
            'timestamp' => now()->toIso8601String(),
        ]));
        Redis::lTrim('metrics:inconsistency:recent', 0, 999);
    }

    /**
     * 记录 Saga 状态
     */
    public static function recordSagaMetrics(string $sagaType, string $status, float $durationMs): void
    {
        Redis::incr("metrics:saga:{$sagaType}:{$status}:" . date('Y-m-d'));
        Redis::lPush("metrics:saga:duration:{$sagaType}", $durationMs);
        Redis::lTrim("metrics:saga:duration:{$sagaType}", 0, 999);
    }

    /**
     * 获取监控摘要
     */
    public static function getSummary(): array
    {
        $today = date('Y-m-d');

        return [
            'inconsistencies' => [
                'inventory' => (int) Redis::get("metrics:inconsistency:inventory:{$today}") ?: 0,
                'order_status' => (int) Redis::get("metrics:inconsistency:order_status:{$today}") ?: 0,
                'payment' => (int) Redis::get("metrics:inconsistency:payment:{$today}") ?: 0,
            ],
            'sagas' => [
                'checkout_success' => (int) Redis::get("metrics:saga:checkout:completed:{$today}") ?: 0,
                'checkout_failed' => (int) Redis::get("metrics:saga:checkout:failed:{$today}") ?: 0,
                'checkout_compensated' => (int) Redis::get("metrics:saga:checkout:compensated:{$today}") ?: 0,
            ],
            'recent_inconsistencies' => json_decode(
                Redis::lRange('metrics:inconsistency:recent', 0, 19),
                true
            ) ?: [],
        ];
    }
}
```

### 9.2 幂等性设计原则

在最终一致性架构中，**所有操作都必须是幂等的**。以下是实现幂等性的几个关键原则：

1. **使用唯一事件 ID**：每个事件都有全局唯一的标识符
2. **已处理事件表**：在处理事件前检查是否已处理
3. **数据库唯一约束**：利用数据库的唯一索引防止重复
4. **Redis 分布式锁**：在处理事件时加锁，防止并发处理
5. **版本号/CAS**：使用乐观锁防止并发覆盖

### 9.3 补偿的最佳实践

- **补偿操作必须是幂等的**：同一条记录补偿多次不会产生副作用
- **补偿日志必须完整记录**：包括补偿原因、补偿前后状态、补偿时间
- **补偿失败需要告警**：补偿失败通常意味着数据不一致，需要人工介入
- **定期对账是最后防线**：即使所有补偿机制都失效，对账也能发现问题

---

## 十、总结

最终一致性不是"不一致"，而是"延迟一致"。在电商系统中，我们通过以下技术栈构建了完整的工程化解决方案：

1. **理论基础**：PACELC 框架指导不同业务场景的一致性选择
2. **库存扣减**：乐观锁 + Redis 预扣减 + 异步落库，兼顾性能与安全
3. **订单状态**：状态机 + 幂等性 + 向量时钟，保证状态流转的正确性
4. **支付回调**：幂等 + 防重 + 乱序处理 + 定时对账，四重保障
5. **CRDT**：G-Counter、PN-Counter、LWW-Register、ORSWOT，自动解决冲突
6. **反压策略**：令牌桶 + 滑动窗口 + 响应式流，保护系统稳定性
7. **Saga 模式**：编排型用于复杂流程，协调型用于松耦合场景
8. **冲突解决**：LWW、版本向量、自定义合并、CRDT，按场景选择
9. **用户体验**：乐观更新 + 进度反馈 + 实时通知，让用户感知不到延迟

**核心原则：在用户不感知的前提下，用工程手段逼近强一致性。**

最终一致性的本质是一个 trade-off：用时间换空间，用补偿换吞吐。但只要你的补偿机制足够可靠、你的监控足够完善、你的 UX 设计足够巧妙，用户会认为你的系统是"强一致"的——而你的系统，在大促流量下依然稳如磐石。

---

> **参考资料**
>
> - Werner Vogels, *Eventually Consistent*, ACM Queue, 2008
> - Daniel Abadi, *The CAP Theorem's Other Side*, IEEE Computer, 2012
> - Carlos Baquero & Nuno Preguiça, *Why CRDTs are the Future of Distributed Data*, 2016
> - Chris Richardson, *Microservices Patterns: Saga Pattern*, Manning, 2018
> - Martin Kleppmann, *Designing Data-Intensive Applications*, O'Reilly, 2017
> - Aphyr (Kyle Kingsbury), *Jepsen Series on Distributed Systems*, jepsen.io

---

## 相关阅读

如果你对本文涉及的分布式系统话题感兴趣，以下文章也值得一读：

1. [Laravel Redis 分布式锁完全指南](/2026/05/01/databases/laravel-redis-distributedlockguide) — 分布式锁是保障一致性的基石，本文详解 Redis 锁的实现、Redlock 算法与常见陷阱
2. [Redis Streams + Laravel 实战：事件驱动架构与消息队列](/2026/05/01/databases/redis-stream-guide-laravel) — 用 Redis Streams 构建事件驱动架构，与本文的异步落库和补偿模式深度互补
3. [数据库分库分表实战：30 个仓库的经验教训](/2026/05/01/databases/sharding-30-repos) — 分库分表场景下的一致性挑战与解决方案，与本文的分布式一致性理论形成闭环
