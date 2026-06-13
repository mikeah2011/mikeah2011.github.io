---

title: 库存预占与释放机制设计：Laravel 分布式库存的状态机实战
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-06-09 23:10:00
updated: 2026-06-09 23:10:00
categories:
  - architecture
keywords: [Laravel, 库存预占与释放机制设计, 分布式库存的状态机实战]
tags:
- Laravel
- 库存
- 状态机
- 分布式
- Redis
- 电商
- 预占
- 乐观锁
description: 电商库存预占与释放机制的完整 Laravel 实战。覆盖下单预占、支付扣减、超时释放、退款回补四阶段状态机设计，基于 Redis + MySQL 双写架构，实现分布式场景下的库存一致性。含状态机定义、Laravel Job 超时释放、乐观锁防超卖、Lua 脚本原子扣减、退款回补幂等设计等完整代码示例，附四个真实踩坑案例。
---



## 前言：超卖事故复盘

凌晨两点被告警叫醒——某热门景点门票超卖了 47 张。

排查发现：三个用户几乎同时下单，每个请求都读到库存为 1，都通过了 `if ($stock > 0)` 检查，然后各自扣减。最终库存变成 -2。

这是我在 KKday 做 B2C 电商后端时经历的真实事故。从那之后，我花了三个月重构了整个库存系统，设计了一套基于状态机的「预占-扣减-释放-回补」机制。

这篇文章就是这套方案的完整记录。

---

## 核心问题：为什么不能直接扣库存？

传统做法：用户下单 → 直接减库存 → 支付失败 → 再加回来。

问题：

1. **超卖**：并发读取时多个请求同时通过库存检查
2. **丢单**：扣了库存但订单创建失败，库存凭空消失
3. **回补丢失**：支付失败后加库存的操作如果失败，库存永远少一块
4. **无法审计**：直接 `UPDATE stock = stock - 1`，出了问题无法追溯

我们需要一个中间态——「预占」。

---

## 状态机设计

### 库存四态模型

```
┌─────────┐    下单成功     ┌─────────┐    支付完成     ┌─────────┐
│  可用库存  │ ──────────→ │  预占库存  │ ──────────→ │  已扣库存  │
│ Available │              │ Reserved  │              │ Deducted  │
└─────────┘              └─────────┘              └─────────┘
      ↑                        │                        │
      │                   超时/取消                   退款
      │                        │                        │
      │                        ▼                        │
      │                  ┌─────────┐                    │
      └──────────────────│  释放库存  │ ←────────────────┘
                         │ Released  │
                         └─────────┘
```

四种状态转换：

| 转换 | 触发条件 | 库存变化 |
|------|----------|----------|
| 可用 → 预占 | 用户下单 | available -= N, reserved += N |
| 预占 → 已扣 | 支付成功 | reserved -= N, deducted += N |
| 预占 → 释放 | 超时/取消 | reserved -= N, available += N |
| 已扣 → 释放 | 退款 | deducted -= N, available += N |

### 数据表设计

```sql
CREATE TABLE `inventory_skus` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `sku_id` BIGINT UNSIGNED NOT NULL COMMENT '商品SKU ID',
    `available` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '可用库存',
    `reserved` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '预占库存',
    `deducted` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已扣库存',
    `version` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    `created_at` TIMESTAMP NULL,
    `updated_at` TIMESTAMP NULL,
    UNIQUE KEY `uk_sku_id` (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SKU库存表';

CREATE TABLE `inventory_logs` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `sku_id` BIGINT UNSIGNED NOT NULL,
    `order_id` BIGINT UNSIGNED NOT NULL COMMENT '关联订单',
    `quantity` INT UNSIGNED NOT NULL COMMENT '变动数量',
    `type` ENUM('reserve','deduct','release','refund') NOT NULL COMMENT '变动类型',
    `before_available` INT UNSIGNED NOT NULL,
    `before_reserved` INT UNSIGNED NOT NULL,
    `before_deducted` INT UNSIGNED NOT NULL,
    `after_available` INT UNSIGNED NOT NULL,
    `after_reserved` INT UNSIGNED NOT NULL,
    `after_deducted` INT UNSIGNED NOT NULL,
    `operator` VARCHAR(64) DEFAULT 'system' COMMENT '操作人',
    `remark` VARCHAR(255) DEFAULT NULL,
    `created_at` TIMESTAMP NULL,
    INDEX `idx_sku_order` (`sku_id`, `order_id`),
    INDEX `idx_order_type` (`order_id`, `type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='库存变动日志';
```

注意三个库存字段加起来就是「物理库存总量」：`available + reserved + deducted = total`。

---

## Laravel 实现

### 1. InventorySku Model

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventorySku extends Model
{
    protected $table = 'inventory_skus';
    protected $fillable = ['sku_id', 'available', 'reserved', 'deducted', 'version'];

    /**
     * 乐观锁扣减
     */
    public function reserve(int $quantity): bool
    {
        $affected = static::query()
            ->where('sku_id', $this->sku_id)
            ->where('available', '>=', $quantity)
            ->where('version', $this->version)
            ->update([
                'available' => \DB::raw("available - {$quantity}"),
                'reserved' => \DB::raw("reserved + {$quantity}"),
                'version' => \DB::raw('version + 1'),
                'updated_at' => now(),
            ]);

        if ($affected > 0) {
            $this->refresh();
            return true;
        }

        return false;
    }

    /**
     * 支付扣减：预占 → 已扣
     */
    public function deduct(int $quantity): bool
    {
        $affected = static::query()
            ->where('sku_id', $this->sku_id)
            ->where('reserved', '>=', $quantity)
            ->where('version', $this->version)
            ->update([
                'reserved' => \DB::raw("reserved - {$quantity}"),
                'deducted' => \DB::raw("deducted + {$quantity}"),
                'version' => \DB::raw('version + 1'),
                'updated_at' => now(),
            ]);

        return $affected > 0;
    }

    /**
     * 释放预占库存（超时/取消）
     */
    public function release(int $quantity): bool
    {
        $affected = static::query()
            ->where('sku_id', $this->sku_id)
            ->where('reserved', '>=', $quantity)
            ->where('version', $this->version)
            ->update([
                'reserved' => \DB::raw("reserved - {$quantity}"),
                'available' => \DB::raw("available + {$quantity}"),
                'version' => \DB::raw('version + 1'),
                'updated_at' => now(),
            ]);

        return $affected > 0;
    }

    /**
     * 退款回补：已扣 → 可用
     */
    public function refund(int $quantity): bool
    {
        $affected = static::query()
            ->where('sku_id', $this->sku_id)
            ->where('deducted', '>=', $quantity)
            ->where('version', $this->version)
            ->update([
                'deducted' => \DB::raw("deducted - {$quantity}"),
                'available' => \DB::raw("available + {$quantity}"),
                'version' => \DB::raw('version + 1'),
                'updated_at' => now(),
            ]);

        return $affected > 0;
    }

    /**
     * 物理库存总量
     */
    public function getTotalAttribute(): int
    {
        return $this->available + $this->reserved + $this->deducted;
    }
}
```

关键点：用 `WHERE version = ?` 实现乐观锁。如果 version 不匹配，说明被其他请求改过，直接返回失败。

### 2. InventoryService 核心服务

```php
<?php

namespace App\Services;

use App\Models\InventorySku;
use App\Models\InventoryLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class InventoryService
{
    /**
     * 预占库存（下单时调用）
     */
    public function reserve(int $skuId, int $orderId, int $quantity): bool
    {
        return DB::transaction(function () use ($skuId, $orderId, $quantity) {
            $sku = InventorySku::where('sku_id', $skuId)->lockForUpdate()->first();

            if (!$sku || $sku->available < $quantity) {
                return false;
            }

            $before = [
                'available' => $sku->available,
                'reserved' => $sku->reserved,
                'deducted' => $sku->deducted,
            ];

            $result = $sku->reserve($quantity);

            if ($result) {
                $this->log($skuId, $orderId, $quantity, 'reserve', $before, $sku);
            }

            return $result;
        });
    }

    /**
     * 支付成功扣减
     */
    public function deduct(int $skuId, int $orderId, int $quantity): bool
    {
        return DB::transaction(function () use ($skuId, $orderId, $quantity) {
            $sku = InventorySku::where('sku_id', $skuId)->lockForUpdate()->first();

            if (!$sku || $sku->reserved < $quantity) {
                return false;
            }

            $before = [
                'available' => $sku->available,
                'reserved' => $sku->reserved,
                'deducted' => $sku->deducted,
            ];

            $result = $sku->deduct($quantity);

            if ($result) {
                $this->log($skuId, $orderId, $quantity, 'deduct', $before, $sku);
            }

            return $result;
        });
    }

    /**
     * 释放预占库存
     */
    public function release(int $skuId, int $orderId, int $quantity, string $reason = 'timeout'): bool
    {
        return DB::transaction(function () use ($skuId, $orderId, $quantity, $reason) {
            $sku = InventorySku::where('sku_id', $skuId)->lockForUpdate()->first();

            if (!$sku || $sku->reserved < $quantity) {
                return false;
            }

            $before = [
                'available' => $sku->available,
                'reserved' => $sku->reserved,
                'deducted' => $sku->deducted,
            ];

            $result = $sku->release($quantity);

            if ($result) {
                $this->log($skuId, $orderId, $quantity, 'release', $before, $sku, $reason);
            }

            return $result;
        });
    }

    /**
     * 退款回补
     */
    public function refund(int $skuId, int $orderId, int $quantity): bool
    {
        // 幂等检查：已经退款回补过的不再处理
        $exists = InventoryLog::where('order_id', $orderId)
            ->where('sku_id', $skuId)
            ->where('type', 'refund')
            ->exists();

        if ($exists) {
            return true;
        }

        return DB::transaction(function () use ($skuId, $orderId, $quantity) {
            $sku = InventorySku::where('sku_id', $skuId)->lockForUpdate()->first();

            if (!$sku || $sku->deducted < $quantity) {
                return false;
            }

            $before = [
                'available' => $sku->available,
                'reserved' => $sku->reserved,
                'deducted' => $sku->deducted,
            ];

            $result = $sku->refund($quantity);

            if ($result) {
                $this->log($skuId, $orderId, $quantity, 'refund', $before, $sku, 'refund');
            }

            return $result;
        });
    }

    private function log(
        int $skuId,
        int $orderId,
        int $quantity,
        string $type,
        array $before,
        InventorySku $sku,
        string $remark = null
    ): void {
        InventoryLog::create([
            'sku_id' => $skuId,
            'order_id' => $orderId,
            'quantity' => $quantity,
            'type' => $type,
            'before_available' => $before['available'],
            'before_reserved' => $before['reserved'],
            'before_deducted' => $before['deducted'],
            'after_available' => $sku->available,
            'after_reserved' => $sku->reserved,
            'after_deducted' => $sku->deducted,
            'remark' => $remark,
        ]);
    }
}
```

### 3. 超时释放 Job

```php
<?php

namespace App\Jobs;

use App\Services\InventoryService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ReleaseInventoryJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 30;

    public function __construct(
        public int $skuId,
        public int $orderId,
        public int $quantity,
    ) {}

    public function handle(InventoryService $service): void
    {
        // 再检查一下订单状态，可能已经支付了
        $order = \App\Models\Order::find($this->orderId);

        if (!$order || $order->status !== 'pending') {
            // 订单已支付或已取消，不需要释放
            return;
        }

        // 标记订单超时取消
        $order->update(['status' => 'expired']);

        // 释放库存
        $service->release(
            $this->skuId,
            $this->orderId,
            $this->quantity,
            'timeout'
        );
    }
}
```

### 4. 下单时延迟释放

```php
<?php

namespace App\Http\Controllers;

use App\Jobs\ReleaseInventoryJob;
use App\Services\InventoryService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;

class OrderController extends Controller
{
    public function store(Request $request, InventoryService $inventory)
    {
        $skuId = $request->input('sku_id');
        $quantity = $request->input('quantity', 1);
        $userId = auth()->id();

        // 1. 预占库存
        $reserved = $inventory->reserve($skuId, 0, $quantity);

        if (!$reserved) {
            return response()->json(['message' => '库存不足'], 400);
        }

        // 2. 创建订单
        $order = \App\Models\Order::create([
            'user_id' => $userId,
            'sku_id' => $skuId,
            'quantity' => $quantity,
            'status' => 'pending',
            'amount' => $this->calculateAmount($skuId, $quantity),
        ]);

        // 3. 更新库存日志的 order_id
        \App\Models\InventoryLog::where('sku_id', $skuId)
            ->where('order_id', 0)
            ->where('type', 'reserve')
            ->latest()
            ->update(['order_id' => $order->id]);

        // 4. 延迟 15 分钟释放（支付超时）
        ReleaseInventoryJob::dispatch($skuId, $order->id, $quantity)
            ->delay(now()->addMinutes(15));

        return response()->json([
            'order_id' => $order->id,
            'message' => '下单成功，请在15分钟内完成支付',
        ]);
    }
}
```

### 5. Redis Lua 原子扣减（高并发场景）

当并发量很高时，MySQL 行锁会成为瓶颈。可以用 Redis 做前置过滤，Lua 脚本保证原子性：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Redis;

class RedisInventoryService
{
    /**
     * Redis Lua 原子预占
     *
     * KEYS[1] = inventory:available:{skuId}
     * KEYS[2] = inventory:reserved:{skuId}
     * ARGV[1] = quantity
     */
    private string $reserveLua = <<<'LUA'
        local available = tonumber(redis.call('GET', KEYS[1]) or '0')
        local quantity = tonumber(ARGV[1])

        if available < quantity then
            return 0
        end

        redis.call('DECRBY', KEYS[1], quantity)
        redis.call('INCRBY', KEYS[2], quantity)
        return 1
    LUA;

    /**
     * Redis Lua 原子释放
     */
    private string $releaseLua = <<<'LUA'
        local reserved = tonumber(redis.call('GET', KEYS[1]) or '0')
        local quantity = tonumber(ARGV[1])

        if reserved < quantity then
            return 0
        end

        redis.call('DECRBY', KEYS[1], quantity)
        redis.call('INCRBY', KEYS[2], quantity)
        return 1
    LUA;

    public function reserve(int $skuId, int $quantity): bool
    {
        $result = Redis::eval(
            $this->reserveLua,
            2,
            "inventory:available:{$skuId}",
            "inventory:reserved:{$skuId}",
            $quantity
        );

        return (int) $result === 1;
    }

    public function release(int $skuId, int $quantity): bool
    {
        $result = Redis::eval(
            $this->releaseLua,
            2,
            "inventory:reserved:{$skuId}",
            "inventory:available:{$skuId}",
            $quantity
        );

        return (int) $result === 1;
    }

    /**
     * 从 MySQL 同步库存到 Redis（启动时/定时任务）
     */
    public function syncFromDb(int $skuId): void
    {
        $sku = \App\Models\InventorySku::where('sku_id', $skuId)->first();

        if ($sku) {
            Redis::set("inventory:available:{$skuId}", $sku->available);
            Redis::set("inventory:reserved:{$skuId}", $sku->reserved);
            Redis::set("inventory:deducted:{$skuId}", $sku->deducted);
        }
    }
}
```

**完整的双重保障流程**：

```php
// 下单时：Redis 预检 + MySQL 落库
public function reserveWithRedis(int $skuId, int $orderId, int $quantity): bool
{
    // 1. Redis 快速预检
    if (!$this->redisInventory->reserve($skuId, $quantity)) {
        return false;
    }

    try {
        // 2. MySQL 持久化
        $result = $this->inventoryService->reserve($skuId, $orderId, $quantity);

        if (!$result) {
            // MySQL 扣减失败，回滚 Redis
            $this->redisInventory->release($skuId, $quantity);
            return false;
        }

        return true;
    } catch (\Throwable $e) {
        // 异常回滚
        $this->redisInventory->release($skuId, $quantity);
        throw $e;
    }
}
```

---

## 退款回补的幂等设计

退款回补必须幂等——同一个订单的退款回调可能触发多次（支付网关重试、手动重试等）。

```php
/**
 * 退款回调处理
 */
public function handleRefundCallback(int $orderId): void
{
    $order = Order::findOrFail($orderId);

    // 幂等：已退款不再处理
    if ($order->status === 'refunded') {
        return;
    }

    // 事务保证原子性
    DB::transaction(function () use ($order) {
        // 1. 标记订单退款
        $order->update(['status' => 'refunded']);

        // 2. 回补库存（内部也有幂等检查）
        $this->inventoryService->refund(
            $order->sku_id,
            $order->id,
            $order->quantity
        );
    });
}
```

三层幂等保障：

1. **订单状态检查**：`status === 'refunded'` 直接返回
2. **库存日志检查**：`InventoryLog` 中已有 `refund` 记录则跳过
3. **乐观锁**：version 不匹配时更新失败

---

## 定时对账：发现隐藏的库存不一致

再完善的系统也会有意外。定时对账是最后的安全网：

```php
<?php

namespace App\Console\Commands;

use App\Models\InventorySku;
use App\Models\InventoryLog;
use Illuminate\Console\Command;

class InventoryReconcile extends Command
{
    protected $signature = 'inventory:reconcile {--fix : 自动修复不一致}';
    protected $description = '库存对账：检查 available + reserved + deducted 是否等于总量';

    public function handle(): int
    {
        $skus = InventorySku::all();
        $issues = [];

        foreach ($skus as $sku) {
            // 从日志反推预期库存
            $logs = InventoryLog::where('sku_id', $sku->sku_id)->get();

            $expectedAvailable = 0;
            $expectedReserved = 0;
            $expectedDeducted = 0;

            foreach ($logs as $log) {
                match ($log->type) {
                    'reserve' => $expectedAvailable -= $log->quantity,
                    'deduct' => $expectedReserved -= $log->quantity,
                    'release' => $expectedReserved -= $log->quantity,
                    'refund' => $expectedDeducted -= $log->quantity,
                };
            }

            // 检查是否一致
            if ($sku->available !== $expectedAvailable
                || $sku->reserved !== $expectedReserved
                || $sku->deducted !== $expectedDeducted
            ) {
                $issues[] = [
                    'sku_id' => $sku->sku_id,
                    'current' => "{$sku->available}/{$sku->reserved}/{$sku->deducted}",
                    'expected' => "{$expectedAvailable}/{$expectedReserved}/{$expectedDeducted}",
                ];

                if ($this->option('fix')) {
                    $sku->update([
                        'available' => $expectedAvailable,
                        'reserved' => $expectedReserved,
                        'deducted' => $expectedDeducted,
                    ]);
                    $this->warn("Fixed SKU {$sku->sku_id}");
                }
            }
        }

        if (empty($issues)) {
            $this->info('All SKUs are consistent.');
            return 0;
        }

        $this->table(
            ['SKU ID', 'Current (A/R/D)', 'Expected (A/R/D)'],
            $issues
        );

        return 1;
    }
}
```

---

## 踩坑记录

### 坑 1：`lockForUpdate` 在非主键上不生效

```php
// ❌ 错误：sku_id 上的锁可能不生效
$sku = InventorySku::where('sku_id', $skuId)->lockForUpdate()->first();

// ✅ 正确：确保有唯一索引
// 表定义中必须有 UNIQUE KEY `uk_sku_id` (`sku_id`)
```

`lockForUpdate` 依赖索引。如果没有索引或索引选择性差，MySQL 会退化为表锁。

### 坑 2：乐观锁高并发下大量重试

乐观锁在低并发下很好用，但高并发时会出现大量 version 冲突导致重试。

解决方案：**分段锁 + 队列串行化**。

```php
// 用 Redis 分布式锁串行化同一个 SKU 的操作
$lock = Cache::lock("inventory:sku:{$skuId}", 5);

if ($lock->get()) {
    try {
        $inventoryService->reserve($skuId, $orderId, $quantity);
    } finally {
        $lock->release();
    }
} else {
    // 获取锁失败，延迟重试
    ReserveInventoryJob::dispatch($skuId, $orderId, $quantity)
        ->delay(now()->addSeconds(2));
}
```

### 坑 3：超时释放 Job 重复执行

Laravel Queue 的 `Release` 机制可能导致 Job 被多个 worker 同时处理。

```php
// ❌ 可能重复执行
ReleaseInventoryJob::dispatch($skuId, $orderId, $quantity);

// ✅ 用 unique Job 防重
class ReleaseInventoryJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function uniqueId(): string
    {
        return "release:{$this->orderId}:{$this->skuId}";
    }
}
```

### 坑 4：Redis 和 MySQL 数据不一致

Redis 预检成功但 MySQL 写入失败时，Redis 的库存会比 MySQL 多扣。

解决方案：

1. **失败即回滚**：MySQL 失败立刻回滚 Redis（上面代码已实现）
2. **定时同步**：每 5 分钟从 MySQL 全量同步到 Redis
3. **对账告警**：发现不一致立即告警

```php
// 定时同步任务
$schedule->call(function () {
    $skus = InventorySku::all();
    foreach ($skus as $sku) {
        Redis::mset([
            "inventory:available:{$sku->sku_id}" => $sku->available,
            "inventory:reserved:{$sku->sku_id}" => $sku->reserved,
            "inventory:deducted:{$sku->sku_id}" => $sku->deducted,
        ]);
    }
})->everyFiveMinutes();
```

---

## 完整的支付回调流程

```php
/**
 * 支付回调入口
 */
public function paymentCallback(Request $request): JsonResponse
{
    $orderId = $request->input('order_id');
    $status = $request->input('status'); // success / failed

    $order = Order::findOrFail($orderId);

    // 幂等检查
    if ($order->status !== 'pending') {
        return response()->json(['message' => 'already processed']);
    }

    DB::transaction(function () use ($order, $status) {
        if ($status === 'success') {
            // 支付成功：预占 → 已扣
            $order->update(['status' => 'paid']);
            app(InventoryService::class)->deduct(
                $order->sku_id,
                $order->id,
                $order->quantity
            );
        } else {
            // 支付失败：预占 → 释放
            $order->update(['status' => 'cancelled']);
            app(InventoryService::class)->release(
                $order->sku_id,
                $order->id,
                $order->quantity,
                'payment_failed'
            );
        }
    });

    // 取消超时释放 Job
    if ($status === 'success') {
        Bus::batch(
            ReleaseInventoryJob::where('orderId', $orderId)->get()
        )->cancel();
    }

    return response()->json(['message' => 'ok']);
}
```

---

## 总结

| 维度 | 方案 | 说明 |
|------|------|------|
| 并发安全 | 乐观锁 + `lockForUpdate` | 双重保障，MySQL 兜底 |
| 高性能 | Redis Lua 原子操作 | 前置过滤，减轻 DB 压力 |
| 超时处理 | Laravel Job 延迟队列 | 15 分钟未支付自动释放 |
| 退款幂等 | 状态检查 + 日志去重 | 三层幂等保障 |
| 数据一致 | 定时对账 + 异常告警 | 最后的安全网 |

核心原则：

1. **所有库存变动都走状态机**，不允许直接 `UPDATE stock = stock - 1`
2. **所有写操作都记日志**，出问题可以追溯和对账
3. **Redis 是加速层，MySQL 是真相源**，Redis 失败不影响核心流程
4. **幂等设计从第一天开始**，不要事后补

这套方案在 KKday 日均万级订单的场景下稳定运行了一年多，超卖事故归零。如果你的场景是秒杀级别的超高并发（QPS > 10000），还需要考虑 Redis Cluster 分片和本地缓存预热，但核心思路是一样的。
