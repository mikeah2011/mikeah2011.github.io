---

title: 电商库存系统设计-防超卖分布式锁与库存预扣减-Laravel-B2C-API实战踩坑记录
keywords: [Laravel, B2C, API, 电商库存系统设计, 防超卖分布式锁与库存预扣减, 实战踩坑记录]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-05 07:50:29
updated: 2026-05-05 07:52:21
categories:
- architecture
tags:
- KKday
- Laravel
- Redis
- 微服务
description: 电商库存系统是 B2C 业务的核心难点之一。本文基于 KKday B2C API 的真实项目经验，深入剖析防超卖的三种方案（悲观锁、乐观锁、Redis 原子扣减）、分布式锁的正确使用姿势、以及库存预扣减的完整流程设计，附带踩坑记录与架构图。
---


# 电商库存系统设计：防超卖、分布式锁与库存预扣减

> 电商库存是 B2C 系统中最容易出问题的模块之一。一个秒杀活动、一次 Redis 抖动，就可能导致超卖事故。本文基于 KKday B2C API 的真实踩坑经验，从数据库层、缓存层、应用层三个维度，拆解库存系统的设计方案。

## 为什么库存系统这么难？

库存的核心矛盾是：**高性能读取 vs 强一致性写入**。

- 用户浏览商品时，需要**快速读取**库存数量（QPS 可达数万）
- 用户下单时，需要**原子扣减**库存（不能超卖，不能少卖）
- 退款时，需要**安全回滚**库存（不能多回）

这三个操作在分布式环境下，任何一个环节出错都会导致资金损失。

---

## 架构总览

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Client    │────▶│  API Layer  │────▶│  Service     │
│  (App/Web)  │     │ (Laravel)   │     │  Layer       │
└─────────────┘     └─────────────┘     └──────┬───────┘
                                               │
                    ┌──────────────────────────┼──────────────────────┐
                    ▼                          ▼                      ▼
            ┌──────────────┐          ┌──────────────┐      ┌──────────────┐
            │  Redis       │          │  MySQL       │      │  Queue       │
            │  库存缓存     │          │  库存主表     │      │  异步落库     │
            │  Lua原子扣减  │          │  乐观锁兜底   │      │  最终一致性   │
            └──────────────┘          └──────────────┘      └──────────────┘
```

核心思路：**Redis 做第一道防线（高性能原子扣减），MySQL 做最终兜底（强一致性），Queue 做异步落库（削峰填谷）**。

---

## 方案一：MySQL 悲观锁（SELECT FOR UPDATE）

最直觉的方案，也是最容易写错的方案。

```php
// ❌ 错误示范：直接扣减，存在竞态条件
public function deductStock(int $productId, int $quantity): bool
{
    $product = Product::find($productId);
    if ($product->stock >= $quantity) {
        $product->stock -= $quantity;
        $product->save();
        return true;
    }
    return false;
}
```

上面的代码在并发场景下必然超卖。两个请求同时读到 `stock = 1`，都通过检查，都扣减，结果变成 `-1`。

```php
// ✅ 悲观锁方案
public function deductStockWithPessimisticLock(int $productId, int $quantity): bool
{
    return DB::transaction(function () use ($productId, $quantity) {
        // SELECT ... FOR UPDATE 锁住行
        $product = Product::where('id', $productId)
            ->lockForUpdate()
            ->first();

        if (!$product || $product->stock < $quantity) {
            throw new InsufficientStockException(
                "库存不足: 需要 {$quantity}, 剩余 {$product->stock}"
            );
        }

        $product->decrement('stock', $quantity);

        // 记录库存流水
        StockLog::create([
            'product_id' => $productId,
            'type'       => 'deduct',
            'quantity'   => $quantity,
            'before'     => $product->stock + $quantity,
            'after'      => $product->stock,
            'order_id'   => null, // 后续关联
        ]);

        return true;
    });
}
```

**踩坑记录 #1：锁的粒度**

```php
// ❌ 锁表而不是锁行 —— 性能灾难
Product::query()->lockForUpdate()->get();

// ✅ 只锁需要的那一行
Product::where('id', $productId)->lockForUpdate()->first();
```

**踩坑记录 #2：事务过长导致锁等待超时**

```php
// ❌ 在锁内做耗时操作（发通知、写日志、调外部 API）
DB::transaction(function () use ($productId, $quantity) {
    $product = Product::where('id', $productId)->lockForUpdate()->first();
    $product->decrement('stock', $quantity);
    
    // 下面这些不应该在锁内！
    Mail::to($user)->send(new OrderConfirmMail($order));
    Http::post('https://notify.example.com', [...]);
    ActivityLog::create([...]);
});

// ✅ 锁内只做扣减，其他操作异步处理
DB::transaction(function () use ($productId, $quantity) {
    $product = Product::where('id', $productId)->lockForUpdate()->first();
    $product->decrement('stock', $quantity);
    return $product;
});

// 锁外做耗时操作
DeductStockNotificationJob::dispatch($order);
```

**性能指标**：悲观锁在 QPS > 200 时，MySQL 行锁等待开始明显增长，InnoDB 死锁概率上升。适合低并发场景，**不适合秒杀**。

---

## 方案二：MySQL 乐观锁（CAS）

```php
public function deductStockWithOptimisticLock(int $productId, int $quantity): bool
{
    $maxRetries = 3;

    for ($attempt = 0; $attempt < $maxRetries; $attempt++) {
        $product = Product::find($productId);

        if ($product->stock < $quantity) {
            return false;
        }

        // CAS：只有当 stock 未被修改时才更新
        $affected = Product::where('id', $productId)
            ->where('stock', $product->stock) // version check
            ->update(['stock' => $product->stock - $quantity]);

        if ($affected > 0) {
            return true;
        }

        // 更新失败说明被其他请求修改了，重试
        usleep(rand(1000, 5000)); // 随机退避
    }

    throw new OptimisticLockException('库存扣减失败，超过最大重试次数');
}
```

**踩坑记录 #3：乐观锁的重试风暴**

当并发量高时，大量请求同时读到同一个 `stock` 值，只有一个能成功，其余全部重试。在秒杀场景下，重试次数可能指数级增长。

解决方案：**指数退避 + 最大重试次数 + 随机抖动**。

```php
// 改进：指数退避
$sleepMs = (2 ** $attempt) * 1000 + rand(0, 1000);
usleep($sleepMs);
```

**性能指标**：乐观锁在冲突率 < 5% 时表现优秀，冲突率 > 30% 时性能急剧下降。适合中等并发场景。

---

## 方案三：Redis Lua 原子扣减（推荐方案）

这是我们在 KKday B2C API 中采用的主力方案。

```lua
-- scripts/inventory_deduct.lua
-- KEYS[1]: inventory:{productId}:stock
-- ARGV[1]: 扣减数量
-- ARGV[2]: 订单ID

local stock_key = KEYS[1]
local quantity = tonumber(ARGV[1])
local order_id = ARGV[2]

-- 1. 检查库存
local current = tonumber(redis.call('GET', stock_key) or '0')
if current < quantity then
    return -1  -- 库存不足
end

-- 2. 原子扣减
local new_stock = redis.call('DECRBY', stock_key, quantity)

-- 3. 记录扣减流水（用于对账和回滚）
local log_key = 'inventory:' .. string.match(stock_key, '%d+') .. ':logs'
redis.call('LPUSH', log_key, order_id .. ':' .. quantity .. ':' .. new_stock)

return new_stock  -- 返回剩余库存
```

Laravel 端调用：

```php
class RedisInventoryService
{
    private string $script;

    public function __construct()
    {
        // 预加载 Lua 脚本
        $this->script = file_get_contents(
            base_path('scripts/inventory_deduct.lua')
        );
    }

    /**
     * Redis 原子扣减库存
     *
     * @throws InsufficientStockException
     */
    public function deduct(int $productId, int $quantity, string $orderId): int
    {
        $key = "inventory:{$productId}:stock";
        $redis = Redis::connection('inventory'); // 专用连接

        $result = $redis->eval(
            $this->script,
            1,           // KEYS 数量
            $key,        // KEYS[1]
            $quantity,   // ARGV[1]
            $orderId     // ARGV[2]
        );

        if ($result === -1) {
            throw new InsufficientStockException(
                "Product #{$productId} 库存不足"
            );
        }

        // 异步写入 MySQL 对账
        InventoryDeductJob::dispatch($productId, $quantity, $orderId);

        return (int) $result;
    }

    /**
     * 库存回滚（退款/取消订单时）
     */
    public function rollback(int $productId, int $quantity, string $orderId): int
    {
        $key = "inventory:{$productId}:stock";
        $redis = Redis::connection('inventory');

        $newStock = $redis->incrBy($key, $quantity);

        // 记录回滚流水
        $logKey = "inventory:{$productId}:logs";
        $redis->lPush($logKey, "{$orderId}:rollback:{$quantity}:{$newStock}");

        InventoryRollbackJob::dispatch($productId, $quantity, $orderId);

        return (int) $newStock;
    }

    /**
     * 初始化/同步库存（从 MySQL 同步到 Redis）
     */
    public function sync(int $productId): void
    {
        $product = Product::find($productId);
        $key = "inventory:{$productId}:stock";
        Redis::connection('inventory')->set($key, $product->stock);
    }
}
```

---

## 库存预扣减完整流程

在真实 B2C 场景中，库存扣减不是一步完成的，而是分三步：

```
用户点击下单 → ① 预扣减（锁定库存）
            → ② 支付中（保持锁定）
            → ③ 支付成功 → 确认扣减
            → ③ 支付失败/超时 → 释放回滚
```

```
┌─────────┐   创建订单   ┌──────────┐  支付回调  ┌──────────┐
│  用户    │────────────▶│ 预扣减    │─────────▶│ 确认扣减  │
│  下单    │             │ (Redis)  │          │ (MySQL)  │
└─────────┘             └──────────┘          └──────────┘
                              │                     │
                        30min超时               支付失败
                              │                     │
                              ▼                     ▼
                        ┌──────────┐          ┌──────────┐
                        │ 释放回滚  │          │ 释放回滚  │
                        │ (Redis)  │          │ (Redis)  │
                        └──────────┘          └──────────┘
```

### 预扣减服务实现

```php
class PreDeductService
{
    private RedisInventoryService $inventory;

    public function __construct(RedisInventoryService $inventory)
    {
        $this->inventory = $inventory;
    }

    /**
     * 创建订单时预扣减
     */
    public function preDeduct(OrderRequest $request): Order
    {
        return DB::transaction(function () use ($request) {
            // 1. Redis 预扣减
            $this->inventory->deduct(
                $request->productId,
                $request->quantity,
                $request->orderUniqueId
            );

            // 2. 创建订单（状态：待支付）
            $order = Order::create([
                'product_id' => $request->productId,
                'quantity'   => $request->quantity,
                'status'     => OrderStatus::PENDING_PAYMENT,
                'expires_at' => now()->addMinutes(30), // 30分钟超时
            ]);

            // 3. 延迟队列：30分钟后检查是否支付
            ReleaseStockJob::dispatch($order->id)
                ->delay(now()->addMinutes(30));

            return $order;
        });
    }

    /**
     * 支付成功回调 → 确认扣减（落库到 MySQL）
     */
    public function confirmDeduct(int $orderId): void
    {
        $order = Order::where('id', $orderId)
            ->where('status', OrderStatus::PENDING_PAYMENT)
            ->firstOrFail();

        // MySQL 乐观锁扣减（最终一致性）
        $affected = Product::where('id', $order->product_id)
            ->where('stock', '>=', $order->quantity)
            ->update([
                'stock' => DB::raw("stock - {$order->quantity}")
            ]);

        if (!$affected) {
            // 极端情况：Redis 和 MySQL 不一致，触发告警
            $this->alertStockInconsistency($order);
        }

        $order->update(['status' => OrderStatus::PAID]);
    }

    /**
     * 超时/取消 → 释放库存
     */
    public function releaseStock(int $orderId): void
    {
        $order = Order::find($orderId);

        if (!$order || $order->status !== OrderStatus::PENDING_PAYMENT) {
            return; // 已支付或已释放，跳过
        }

        $this->inventory->rollback(
            $order->product_id,
            $order->quantity,
            $order->id
        );

        $order->update(['status' => OrderStatus::CANCELLED]);
    }
}
```

---

## 踩坑记录汇总

### 踩坑 #4：Redis 和 MySQL 数据不一致

**场景**：Redis 扣减成功，但异步 Job 写 MySQL 时失败（数据库挂了、队列积压等）。

**解决方案**：定时对账任务。

```php
class InventoryReconciliationJob implements ShouldQueue
{
    public function handle(): void
    {
        Product::chunk(100, function ($products) {
            foreach ($products as $product) {
                $redisStock = (int) Redis::get(
                    "inventory:{$product->id}:stock"
                );

                if ($redisStock !== $product->stock) {
                    Log::warning('库存不一致', [
                        'product_id'  => $product->id,
                        'mysql_stock' => $product->stock,
                        'redis_stock' => $redisStock,
                    ]);

                    // 以 MySQL 为准同步到 Redis
                    Redis::set(
                        "inventory:{$product->id}:stock",
                        $product->stock
                    );

                    // 触发告警
                    AlertService::stockInconsistency($product);
                }
            }
        });
    }
}
```

### 踩坑 #5：Redis 宕机时的降级策略

```php
class InventoryServiceWithFallback
{
    public function deduct(int $productId, int $quantity, string $orderId): int
    {
        try {
            // 优先 Redis
            return $this->redisService->deduct($productId, $quantity, $orderId);
        } catch (ConnectionException $e) {
            // Redis 不可用时降级到 MySQL 悲观锁
            Log::warning('Redis 不可用，降级到 MySQL 悲观锁', [
                'product_id' => $productId,
            ]);
            return $this->mysqlService->deductStockWithPessimisticLock(
                $productId, $quantity
            );
        }
    }
}
```

### 踩坑 #6：缓存雪崩导致库存读取异常

```php
// ❌ 所有商品库存同时过期 → 缓存雪崩
Redis::setex("inventory:{$id}:stock", 3600, $stock);

// ✅ 随机过期时间，打散过期高峰
$ttl = 3600 + rand(0, 600); // 3600-4200秒
Redis::setex("inventory:{$id}:stock", $ttl, $stock);
```

---

## 性能对比

| 方案 | QPS 上限 | 一致性 | 复杂度 | 适用场景 |
|------|----------|--------|--------|----------|
| MySQL 悲观锁 | ~200 | 强一致 | 低 | 低并发后台管理 |
| MySQL 乐观锁 | ~1000 | 强一致 | 中 | 中等并发普通下单 |
| Redis Lua 原子扣减 | ~50,000+ | 最终一致 | 高 | 高并发秒杀/抢购 |
| Redis + MySQL 混合 | ~30,000+ | 最终一致 | 最高 | 生产环境推荐 |

---

## 总结

库存系统设计的核心原则：

1. **读写分离**：Redis 负责高并发读写，MySQL 负责持久化和对账
2. **原子操作**：用 Lua 脚本保证 Redis 端的原子性，避免竞态条件
3. **预扣减 + 超时释放**：避免用户下单不支付导致库存被长期锁定
4. **降级兜底**：Redis 不可用时降级到 MySQL，保证系统不完全不可用
5. **定时对账**：Redis 和 MySQL 之间的数据不一致必须有检测和修复机制

> 库存系统没有银弹，只有权衡。选择哪个方案取决于你的并发量、一致性要求和运维能力。

---

## 相关阅读

- [Eventual Consistency 实战：最终一致性在电商场景中的工程化——反压、冲突解决与用户感知延迟](/categories/架构/Eventual-Consistency-实战-最终一致性在电商场景中的工程化-反压冲突解决与用户感知延迟/)
- [Saga 编排模式深度实战：Choreography vs Orchestration vs Temporal——Laravel 分布式事务的三种实现路线对比](/categories/架构/saga-orchestration-pattern-laravel-distributed-transaction/)
- [分布式缓存一致性实战：Cache-Aside/Write-Through/Write-Behind 在 Laravel 中的工程化落地](/categories/架构/分布式缓存一致性实战-Cache-Aside-Write-Through-Write-Behind在Laravel中的工程化落地/)
- [Kafka + Debezium CDC 实战：数据库变更事件流——与 Laravel Event Sourcing 的互补架构设计](/categories/架构/Kafka-Debezium-CDC-实战-数据库变更事件流-Laravel互补架构/)
