---

title: Laravel 多表事务一致性实战：订单创建跨 5 张表的事务边界、死锁预防与 afterCommit 事件时序踩坑记录
keywords: [Laravel, afterCommit, 多表事务一致性实战, 订单创建跨, 张表的事务边界, 死锁预防与, 事件时序踩坑记录, PHP]
date: 2026-06-09 19:52:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Laravel
- MySQL
- 事务
- 死锁
- afterCommit
- Eloquent
- 一致性
description: 在 B2C 电商场景下，一个订单创建往往涉及 orders、order_items、order_payments、inventory_logs、user_points 等多张表的写入。本文从生产环境真实踩坑出发，深入剖析 Laravel DB::transaction 的事务边界设计、死锁预防策略、afterCommit 事件时序陷阱，以及 30+ 仓库积累的工程化最佳实践。
---



## 概述

在 B2C 电商系统中，一次看似简单的「下单」操作背后，至少涉及 5 张表的联动写入：

| 表名 | 职责 | 写入时机 |
|------|------|----------|
| `orders` | 订单主表 | 事务内 |
| `order_items` | 订单商品明细 | 事务内 |
| `order_payments` | 支付记录 | 事务内 |
| `inventory_logs` | 库存变更日志 | 事务内 |
| `user_points` | 用户积分扣减/累积 | 事务内 |

任何一个环节失败，要么全部回滚，要么留下脏数据。而 Laravel 的 `DB::transaction()` 虽然封装了 MySQL 事务，但在实际工程中，**事务边界选错、死锁频发、afterCommit 事件时序错乱**这三个问题，几乎是每个 Laravel 开发者都会踩的坑。

本文基于 KKday B2C API（Laravel 8，30+ 仓库）的真实生产经验，系统梳理多表事务一致性的工程化方案。

## 核心概念：事务边界的三种模式

### 模式一：大事务（Big Transaction）

把所有写入塞进一个事务：

```php
DB::transaction(function () use ($request) {
    // 1. 创建订单
    $order = Order::create([...]);
    
    // 2. 创建订单明细
    foreach ($request->items as $item) {
        OrderItem::create([...]);
    }
    
    // 3. 创建支付记录
    OrderPayment::create([...]);
    
    // 4. 扣减库存
    foreach ($request->items as $item) {
        Inventory::where('sku', $item['sku'])->decrement('quantity', $item['qty']);
        InventoryLog::create([...]);
    }
    
    // 5. 扣减积分
    UserPoint::where('user_id', $userId)->decrement('points', $redeemedPoints);
    UserPointLog::create([...]);
});
```

**问题**：事务持有时间长，锁范围大，高并发下死锁概率指数级上升。

### 模式二：小事务（Small Transaction）

每个操作独立事务，失败了手动补偿：

```php
$order = DB::transaction(fn () => Order::create([...]));
$orderItems = DB::transaction(fn () => OrderItem::insert([...]));
// 如果这里失败了，前面两步已经提交，无法回滚
$payment = DB::transaction(fn () => OrderPayment::create([...]));
```

**问题**：没有原子性，部分失败需要手动回滚，补偿逻辑复杂且容易遗漏。

### 模式三：分层事务（推荐）

核心写入放一个事务，非核心操作用 afterCommit 异步处理：

```php
DB::transaction(function () use ($request, $userId) {
    // 核心层：订单 + 明细 + 支付记录（必须原子）
    $order = Order::create([...]);
    OrderItem::insert($itemsData);
    OrderPayment::create([...]);
    
    // 库存扣减（在同一事务内，保证一致性）
    $this->deductInventory($request->items);
    
    // 积分操作（同一事务内）
    $this->redeemPoints($userId, $redeemedPoints);
});

// 事务提交后：触发副作用
$order->notify(new OrderCreated($order));
event(new OrderPlaced($order));
```

**关键原则**：事务内只做数据写入，事务外做通知、缓存刷新、搜索索引更新等副作用。

## 实战代码：订单创建的完整实现

### 数据库 Schema

```sql
-- 订单主表
CREATE TABLE `orders` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `order_no` varchar(32) NOT NULL,
    `user_id` bigint unsigned NOT NULL,
    `total_amount` decimal(10,2) NOT NULL,
    `status` tinyint unsigned NOT NULL DEFAULT 0 COMMENT '0=pending,1=paid,2=cancelled',
    `created_at` timestamp NULL DEFAULT NULL,
    `updated_at` timestamp NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`),
    KEY `idx_user_status` (`user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订单明细
CREATE TABLE `order_items` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `order_id` bigint unsigned NOT NULL,
    `sku` varchar(64) NOT NULL,
    `product_name` varchar(255) NOT NULL,
    `quantity` int unsigned NOT NULL,
    `unit_price` decimal(10,2) NOT NULL,
    `subtotal` decimal(10,2) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 支付记录
CREATE TABLE `order_payments` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `order_id` bigint unsigned NOT NULL,
    `payment_method` varchar(32) NOT NULL,
    `amount` decimal(10,2) NOT NULL,
    `status` tinyint unsigned NOT NULL DEFAULT 0,
    `transaction_id` varchar(128) DEFAULT NULL,
    `created_at` timestamp NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 库存日志
CREATE TABLE `inventory_logs` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `sku` varchar(64) NOT NULL,
    `order_id` bigint unsigned NOT NULL,
    `change_type` enum('deduct','restore','adjust') NOT NULL,
    `quantity` int NOT NULL,
    `before_stock` int unsigned NOT NULL,
    `after_stock` int unsigned NOT NULL,
    `created_at` timestamp NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_sku` (`sku`),
    KEY `idx_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户积分
CREATE TABLE `user_points` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `user_id` bigint unsigned NOT NULL,
    `balance` int unsigned NOT NULL DEFAULT 0,
    `updated_at` timestamp NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Service 层实现

```php
<?php

namespace App\Services\Order;

use App\Exceptions\InsufficientStockException;
use App\Exceptions\InsufficientPointsException;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderPayment;
use App\Models\Inventory;
use App\Models\InventoryLog;
use App\Models\UserPoint;
use App\Models\UserPointLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CreateOrderService
{
    /**
     * 创建订单 —— 多表事务一致性核心实现
     *
     * @throws InsufficientStockException
     * @throws InsufficientPointsException
     */
    public function execute(array $data, int $userId): Order
    {
        // 预计算，减少事务内耗时
        $orderNo = $this->generateOrderNo();
        $items = $this->prepareItems($data['items']);
        $totalAmount = collect($items)->sum('subtotal');
        $redeemedPoints = $data['redeemed_points'] ?? 0;

        // 积分抵扣金额（100积分 = 1元）
        $pointsDiscount = $redeemedPoints / 100;
        $payableAmount = max(0, $totalAmount - $pointsDiscount);

        return DB::transaction(function () use (
            $orderNo, $items, $totalAmount, $payableAmount,
            $redeemedPoints, $userId, $data
        ) {
            // ============================================
            // Step 1: 创建订单主记录
            // ============================================
            $order = Order::create([
                'order_no'     => $orderNo,
                'user_id'      => $userId,
                'total_amount' => $totalAmount,
                'payable_amount' => $payableAmount,
                'status'       => Order::STATUS_PENDING,
            ]);

            // ============================================
            // Step 2: 批量插入订单明细（性能优化：insert 而非循环 create）
            // ============================================
            $itemsData = array_map(function ($item) use ($order) {
                return [
                    'order_id'    => $order->id,
                    'sku'         => $item['sku'],
                    'product_name' => $item['product_name'],
                    'quantity'    => $item['quantity'],
                    'unit_price'  => $item['unit_price'],
                    'subtotal'    => $item['subtotal'],
                    'created_at'  => now(),
                    'updated_at'  => now(),
                ];
            }, $items);

            OrderItem::insert($itemsData);

            // ============================================
            // Step 3: 创建支付记录
            // ============================================
            OrderPayment::create([
                'order_id'       => $order->id,
                'payment_method' => $data['payment_method'],
                'amount'         => $payableAmount,
                'status'         => OrderPayment::STATUS_PENDING,
            ]);

            // ============================================
            // Step 4: 扣减库存（关键：需要记录变更前后的数量）
            // ============================================
            $this->deductInventory($items, $order->id);

            // ============================================
            // Step 5: 扣减积分（如果使用了积分抵扣）
            // ============================================
            if ($redeemedPoints > 0) {
                $this->redeemPoints($userId, $redeemedPoints, $order->id);
            }

            return $order;
        });
    }

    /**
     * 扣减库存 —— 带乐观锁的原子操作
     *
     * 关键点：
     * 1. 使用 decrement + where 条件避免超卖
     * 2. 检查 affected rows 判断是否扣减成功
     * 3. 记录库存变更日志用于审计
     */
    private function deductInventory(array $items, int $orderId): void
    {
        foreach ($items as $item) {
            $beforeStock = Inventory::where('sku', $item['sku'])
                ->lockForUpdate()  // 行级锁，防止并发超卖
                ->value('quantity');

            if ($beforeStock < $item['quantity']) {
                throw new InsufficientStockException(
                    "SKU [{$item['sku']}] 库存不足，当前库存: {$beforeStock}，需要: {$item['quantity']}"
                );
            }

            $affected = Inventory::where('sku', $item['sku'])
                ->where('quantity', '>=', $item['quantity'])
                ->decrement('quantity', $item['quantity']);

            if ($affected === 0) {
                throw new InsufficientStockException(
                    "SKU [{$item['sku']}] 并发扣减失败，请重试"
                );
            }

            $afterStock = $beforeStock - $item['quantity'];

            InventoryLog::create([
                'sku'          => $item['sku'],
                'order_id'     => $orderId,
                'change_type'  => 'deduct',
                'quantity'     => $item['quantity'],
                'before_stock' => $beforeStock,
                'after_stock'  => $afterStock,
            ]);
        }
    }

    /**
     * 扣减积分 —— 带余额检查的原子操作
     */
    private function redeemPoints(int $userId, int $points, int $orderId): void
    {
        $affected = UserPoint::where('user_id', $userId)
            ->where('balance', '>=', $points)
            ->decrement('balance', $points);

        if ($affected === 0) {
            throw new InsufficientPointsException('积分余额不足');
        }

        $balance = UserPoint::where('user_id', $userId)->value('balance');

        UserPointLog::create([
            'user_id'    => $userId,
            'order_id'   => $orderId,
            'change_type' => 'redeem',
            'points'     => -$points,
            'balance'    => $balance,
        ]);
    }

    /**
     * 生成订单号：时间戳 + 随机数，保证唯一性
     */
    private function generateOrderNo(): string
    {
        return date('YmdHis') . str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    /**
     * 预计算订单明细，避免事务内做计算
     */
    private function prepareItems(array $items): array
    {
        return array_map(function ($item) {
            return [
                'sku'          => $item['sku'],
                'product_name' => $item['product_name'],
                'quantity'     => $item['quantity'],
                'unit_price'   => $item['unit_price'],
                'subtotal'     => $item['quantity'] * $item['unit_price'],
            ];
        }, $items);
    }
}
```

## 死锁预防：真实案例与解决方案

### 案例一：交叉更新导致死锁

**场景**：两个并发请求同时下单，涉及相同的 SKU。

```
事务A: UPDATE inventory SET quantity = quantity - 1 WHERE sku = 'SKU-001';
事务A: UPDATE user_points SET balance = balance - 100 WHERE user_id = 1;

事务B: UPDATE user_points SET balance = balance - 50 WHERE user_id = 2;
事务B: UPDATE inventory SET quantity = quantity - 2 WHERE sku = 'SKU-001';
-- 死锁！事务A锁了inventory等user_points，事务B锁了user_points等inventory
```

**解决方案：统一加锁顺序**

```php
// 始终按主键升序获取锁
private function acquireLocksInOrder(array $skus, int $userId): void
{
    // 先锁库存（按 SKU 字典序）
    sort($skus);
    foreach ($skus as $sku) {
        Inventory::where('sku', $sku)->lockForUpdate()->first();
    }
    
    // 再锁用户积分
    UserPoint::where('user_id', $userId)->lockForUpdate()->first();
}
```

### 案例二：大事务长时间持有锁

**问题**：事务内调用了外部 API（如风控检查），导致锁持有时间过长。

```php
DB::transaction(function () use ($data) {
    $order = Order::create([...]);
    
    // ❌ 错误：事务内调外部API，锁持有时间不可控
    $riskResult = Http::timeout(5)->post('https://risk-api.example.com/check', $data);
    
    if ($riskResult->json('risk_level') === 'high') {
        throw new RiskException('风控拦截');
    }
    
    // ... 继续写入
});
```

**解决方案：前置风控检查**

```php
// ✅ 正确：先检查，再开事务
$riskResult = Http::timeout(5)->post('https://risk-api.example.com/check', $data);
if ($riskResult->json('risk_level') === 'high') {
    throw new RiskException('风控拦截');
}

// 风控通过，再开事务执行写入
DB::transaction(function () use ($data) {
    $order = Order::create([...]);
    // ... 纯数据库操作
});
```

### 案例三：索引缺失导致锁升级

**问题**：`WHERE` 条件没有走索引，行锁退化为表锁。

```sql
-- ❌ 没有索引，全表扫描，锁住所有行
UPDATE inventory SET quantity = quantity - 1 WHERE product_name = 'iPhone 16';

-- ✅ 走索引，只锁目标行
UPDATE inventory SET quantity = quantity - 1 WHERE sku = 'SKU-001';
```

**预防措施**：所有 `WHERE` 条件的字段必须有索引，尤其在事务内。

## afterCommit 事件时序踩坑

### 陷阱一：Observer 中发送通知在事务回滚前执行

```php
// OrderObserver.php
class OrderObserver
{
    public function created(Order $order): void
    {
        // ❌ 危险：如果后续代码导致事务回滚，通知已经发出去了
        $order->user->notify(new OrderCreatedNotification($order));
        
        // ❌ 同理：缓存更新也可能写入脏数据
        Cache::forget("user_order_count_{$order->user_id}");
    }
}
```

**解决方案：使用 `afterCommit`**

```php
class OrderObserver
{
    public function created(Order $order): void
    {
        // ✅ 只在事务真正提交后才执行
        if (DB::transactionLevel() > 0) {
            // 在事务中，延迟到 afterCommit
            app()->terminating(function () use ($order) {
                $this->sendNotifications($order);
            });
            return;
        }
        
        // 不在事务中，直接执行
        $this->sendNotifications($order);
    }
    
    private function sendNotifications(Order $order): void
    {
        $order->user->notify(new OrderCreatedNotification($order));
    }
}
```

### 陷阱二：Laravel 8+ 的 afterCommit 配置

从 Laravel 8 开始，Event 和 Observer 都支持 `afterCommit` 配置：

```php
// config/database.php
'events' => [
    'after_commit' => true,  // 全局开启 afterCommit
],
```

或者在单个 Event 类中指定：

```php
class OrderPlaced implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $afterCommit = true;  // ✅ 只在事务提交后才 dispatch

    public function broadcastOn(): array
    {
        return [new PrivateChannel('orders.' . $this->order->user_id)];
    }
}
```

### 陷阱三：嵌套事务中 afterCommit 的时机

Laravel 使用 savepoint 实现嵌套事务，`afterCommit` 只在最外层事务提交时触发：

```php
DB::transaction(function () {
    // 外层事务开始
    
    $order = Order::create([...]);
    
    DB::transaction(function () {
        // 内层事务（savepoint）
        OrderItem::insert([...]);
    }); // 内层 savepoint 释放，但 afterCommit 不会在这里触发
    
    // 更多操作...
    
}); // 最外层事务提交 → afterCommit 触发
```

**注意**：如果在内层事务中抛出异常并被外层捕获，整个外层事务回滚，afterCommit 不触发：

```php
DB::transaction(function () {
    $order = Order::create([...]);
    
    try {
        DB::transaction(function () {
            // 这里抛异常
            throw new \Exception('库存不足');
        });
    } catch (\Exception $e) {
        // 捕获了异常，但外层事务仍然有效
        // 如果后续没有再抛异常，afterCommit 会触发
        // 但数据可能不一致！
    }
});
```

**最佳实践**：不要在事务内捕获子事务的异常并继续执行。要么全部成功，要么全部回滚。

## 高并发场景的工程化方案

### 1. 队列化下单（削峰填谷）

```php
class CreateOrderJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 5;

    public function handle(CreateOrderService $service): void
    {
        $order = $service->execute($this->data, $this->userId);
        
        // 事务已提交，安全发送通知
        event(new OrderPlaced($order));
    }

    public function failed(\Throwable $exception): void
    {
        // 记录失败，通知用户
        Log::error('订单创建失败', [
            'user_id' => $this->userId,
            'data'    => $this->data,
            'error'   => $exception->getMessage(),
        ]);
    }
}
```

### 2. 幂等性保证（防止重复下单）

```php
class CreateOrderService
{
    public function execute(array $data, int $userId): Order
    {
        // 幂等键：前端生成，后端去重
        $idempotencyKey = $data['idempotency_key'] ?? null;
        
        if ($idempotencyKey) {
            $existing = Order::where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                return $existing; // 直接返回已有订单
            }
        }
        
        return DB::transaction(function () use ($data, $userId, $idempotencyKey) {
            $order = Order::create([
                // ...
                'idempotency_key' => $idempotencyKey,
            ]);
            // ...
            return $order;
        });
    }
}
```

### 3. 库存预扣与回补

```php
// 下单时：预扣库存（soft deduction）
Inventory::where('sku', $sku)
    ->where('quantity', '>=', $qty)
    ->update([
        'quantity'    => DB::raw("quantity - {$qty}"),
        'locked_qty'  => DB::raw("locked_qty + {$qty}"),
    ]);

// 支付成功后：确认扣减
Inventory::where('sku', $sku)
    ->update([
        'locked_qty' => DB::raw("locked_qty - {$qty}"),
    ]);

// 超时未支付：回补库存
Inventory::where('sku', $sku)
    ->update([
        'quantity'   => DB::raw("quantity + {$qty}"),
        'locked_qty' => DB::raw("locked_qty - {$qty}"),
    ]);
```

## 踩坑总结

| 坑 | 表现 | 解法 |
|----|------|------|
| 事务内调外部 API | 锁持有时间长，连接池耗尽 | 前置检查，事务内只做 DB 操作 |
| 交叉更新死锁 | 高并发下频繁 Deadlock | 统一加锁顺序（按主键/字段排序） |
| Observer 在事务内发通知 | 事务回滚后通知已发出 | 使用 `$afterCommit = true` |
| 循环 create 而非 insert | 事务时间长，N 次查询 | 批量 insert，一条 SQL |
| WHERE 条件无索引 | 行锁退化表锁 | 事务内所有查询字段加索引 |
| 嵌套事务捕获异常继续 | 数据不一致 | 子事务异常不捕获，让外层回滚 |
| 无幂等设计 | 重复提交产生多笔订单 | 幂等键 + 唯一约束 |

## 总结

多表事务一致性不是简单地把代码包在 `DB::transaction()` 里就完事了。核心要点：

1. **事务边界**：只把必须原子的操作放进事务，非核心副作用用 afterCommit
2. **锁顺序**：所有事务按相同顺序获取锁，避免死锁
3. **锁粒度**：尽量用行锁（索引条件），避免表锁
4. **事务时长**：事务内不做 IO（外部 API、文件操作、消息队列）
5. **afterCommit**：通知、缓存、搜索索引更新一律在事务提交后执行
6. **幂等性**：关键接口必须有幂等键，防重复提交

这些原则看起来简单，但在 30+ 仓库的大型项目中，每一条都是用线上事故换来的经验。希望这篇文章能帮你少走弯路。
