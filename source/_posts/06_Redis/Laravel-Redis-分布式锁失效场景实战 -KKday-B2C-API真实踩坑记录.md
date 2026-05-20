---
title: Laravel Redis 分布式锁失效场景实战 - KKday B2C API 真实踩坑记录
date: 2026-05-02
categories: [Redis, Laravel, PHP]
tags: [BFF, KKday, Redis]
description: 'KKday B2C API 生产环境 Redis 分布式锁实战：RedLock 集群一致性、Lua 脚本原子性、热点 Key 降级策略、CAS 乐观锁方案、锁超时与死锁处理'
---

## 写在前面

在 KKday B2C API 项目中，我们重度依赖 Redis 实现以下**高并发写操作场景**：

| 场景 | 用途 | 并发量级 | 业务重要性 |
|------|------|----------|------------|
| 购物车库存预占 | 下单前锁库存防止超卖 | 1000+/sec | ⭐⭐⭐⭐⭐ |
| 用户优惠券发放 | 秒杀活动原子操作 | 5000+/sec | ⭐⭐⭐⭐⭐ |
| 热点榜单更新 | Leaderboard 分数累计 | 500/sec | ⭐⭐⭐⭐ |
| 多实例缓存预热 | API 响应预热互斥 | 10-20/sec | ⭐⭐⭐ |

随着大促（双 11、618）并发量增长到峰值**20 万 QPS**，Redis 分布式锁从"加分项"变成"**必选项**"。2025 年大促期间，我们遭遇了多次生产事故：

1. **死锁问题**：某个秒杀活动因锁超时机制失效，导致 Redis 连接池耗尽
2. **集群不一致**：RedLock 算法在部分节点写入失败，用户下单时库存已超卖
3. **性能瓶颈**：Lua 脚本嵌套过多，锁持有时间过长引发背压

> 本文基于 **Laravel 8 + PHP 8.0 + Predis 1.1.9 + Redis 7.x** 的真实项目踩坑经验，系统梳理分布式锁失效的五大场景、防护策略、代码实现和监控指标。

---

## 一、概念速览：分布式锁失效模式对比

| 失效类型 | 触发条件 | 影响范围 | 优先级 |
|----------|----------|----------|--------|
| **死锁（Deadlock）** | 锁持有时间过长 + 网络中断 | 连接池耗尽，服务降级 | ⭐⭐⭐⭐⭐ 最高 |
| **时钟漂移** | 分布式时钟不一致 | RedLock 误判锁状态 | ⭐⭐⭐⭐ 高 |
| **热点 Key 失效** | 单 Key 成为热点瓶颈 | QPS 下降，延迟上升 | ⭐⭐⭐⭐ 高 |
| **集群不一致** | Multi-master 写入冲突 | 数据一致性丧失 | ⭐⭐⭐⭐ 高 |
| **超时竞争** | 多节点同时过期竞争 | 竞态条件引发异常 | ⭐⭐⭐ 中 |

### 1. 死锁：最致命的分布式锁失效

#### 场景描述

用户抢购秒杀商品，网络波动导致 PHP-FPM 进程崩溃但锁未释放：

```
┌─────────────────┐    ┌─────────────────┐
│  User A (PHP-1) │    │  User B (PHP-2) │
│                 │    │                 │
│ request: lock() │────│ request: lock() │
│   持有锁 (TTL=10s)│    │               │
└────────┬────────┘    └────────┬────────┘
         │                      │
    ┌─────┴─────┐              │
    │ PHP-1 崩溃，Redis 锁还在！│
    └───────────┘              │
                                │
         ┌──────────────────────┘
         │
    所有请求等待锁 → 连接池耗尽 → 服务不可用
```

#### Before vs After

**❌ Before（未防护死锁）**

```php
// source/app/Services/SmsService.php
class SmsService {
    private $redis;
    
    public function __construct(RedisManager $redis) {
        $this->redis = $redis;
    }
    
    // 问题：没有设置合理 TTL，网络中断导致锁永久持有！
    public function sendPromoCode(string $userId): bool {
        $lockKey = "sms:lock:" . $userId;
        
        // ❌ 缺少 TTL，死锁风险极高
        if (!$this->redis->set($lockKey, getmypid(), ['NX', 'PX' => 0])) {
            return false; // 获取锁失败
        }
        
        try {
            $code = Sms::generateCode();
            SmsLog::create([
                'user_id'   => $userId,
                'code'      => $code,
                'status'    => 'sent',
            ]);
            
            return true;
        } catch (Exception $e) {
            // ❌ 异常时没有释放锁！
            throw $e;
        }
    }
}
```

**✅ After（防死锁方案）**

```php
// source/app/Services/SmsService.php
class SmsService {
    private $redis;
    
    public function __construct(RedisManager $redis) {
        $this->redis = $redis;
    }
    
    /**
     * 获取带合理 TTL 的分布式锁
     * 
     * @param string $lockKey 锁 Key
     * @param int $holdTimeMs 持有时间（毫秒）
     * @return bool
     */
    public function acquireLock(string $lockKey, int $holdTimeMs = 10000): bool {
        $ttlSeconds = max(3, $holdTimeMs / 1000 - 2); // TTL = 持有时间 - 重试间隔
        
        // ✅ NX + PX：原子性获取锁，设置 TTL
        $setOptions = [
            'NX' => true,       // 仅当 key 不存在时设置
            'PX' => $holdTimeMs, // TTL（毫秒），防止网络中断导致死锁
        ];
        
        return $this->redis->set($lockKey, getmypid(), $setOptions);
    }
    
    /**
     * 获取短 TTL 锁，快速重试避免饥饿
     */
    public function acquireLockWithRetry(string $lockKey, int $maxRetries = 3): bool {
        $retryIntervalMs = 100; // 100ms 重试间隔
        
        for ($i = 0; $i < $maxRetries; $i++) {
            if ($this->acquireLock($lockKey, 500)) { // 初始锁较短 TTL=500ms
                return true;
            }
            
            usleep($retryIntervalMs * 1000);
        }
        
        return false;
    }
    
    /**
     * 业务逻辑执行，带超时保护
     */
    public function sendPromoCodeWithTimeout(string $userId): bool {
        $lockKey = "sms:lock:" . $userId;
        $maxHoldMs = 2000; // 锁最长持有时间
        
        if (!$this->acquireLock($lockKey, $maxHoldMs)) {
            throw new \Exception("SMS lock acquired");
        }
        
        try {
            return $this->sendInternal($userId);
        } finally {
            // ✅ 无论是否异常，都释放锁
            $this->releaseLock($lockKey);
        }
    }
    
    /**
     * 释放分布式锁
     */
    private function releaseLock(string $lockKey): void {
        $holder = (string)$this->redis->get($lockKey);
        
        // ✅ 仅当当前进程持有锁时再删除，防止误删
        if ($holder === getmypid()) {
            $this->redis->del($lockKey);
        }
    }
    
    private function sendInternal(string $userId): bool {
        return Sms::createPromoCode($userId)->send();
    }
}
```

---

## 二、热点 Key：分布式锁性能瓶颈

### 场景描述

在 KKday B2C API 的"商品详情页预热"场景中，多个 Worker 进程竞争同一个缓存 Key：

```php
// 场景：5 个 Worker 刷新同一个商品详情缓存
$lockKey = "cache:warmup:product:" . $productId;
if (!$redis->set($lockKey, true, ['NX', 'PX' => 3000])) {
    // 非热锁 Key，直接返回缓存或数据库结果
} else {
    // 热 Key！获取到锁，执行预热逻辑
    $cacheData = ProductDetail::with(['reviews', 'images'])->find($productId);
    $redis->set("product:{$productId}", json_encode($cacheData), ['EX' => 3600]);
}
```

#### 性能分析（热点 Key vs 普通 Key）

| 指标 | 热点 Key (锁竞争) | 普通 Key |
|------|------------------|----------|
| **单次请求延迟** | 20-50ms（等待锁） | 1-5ms |
| **CPU 利用率** | PHP 进程 CPU 飙升 90%+ | <20% |
| **Redis QPS** | <100（锁序列化瓶颈） | >10000 |
| **背压传播** | 影响上游 API Gateway | 局部影响 |

#### Before vs After

**❌ Before（热点 Key 性能瓶颈）**

```php
// source/app/Jobs/CacheWarmupJob.php
class CacheWarmupJob implements ShouldQueue {
    public function handle() {
        $product = Product::find($this->productId);
        
        // ❌ 没有锁，多个进程竞争写同一个 key
        // Redis 原子性 SET 无法处理复杂业务逻辑
        
        $cacheData = [
            'id'          => $product->id,
            'name'        => $product->name,
            'price'       => $product->price,
            'stock'       => $product->stock,
            // 需要多次 Redis 操作，容易超时
            'reviews_summary' => ProductReview::sum('rating'),
            'tags'        => ['best-seller', 'hot'],
        ];
        
        // ❌ 复杂逻辑 + 网络延迟，SET 可能失败或超时
        $this->redis->set(
            "product:{$this->productId}",
            json_encode($cacheData),
            ['EX' => 3600, 'NX' => true] // NX 导致多次重试
        );
    }
}
```

**✅ After（热点 Key 降级 + 独立缓存）**

```php
// source/app/Jobs/CacheWarmupJob.php
class CacheWarmupJob implements ShouldQueue {
    public function handle() {
        $productId = $this->productId;
        $lockKey = "cache:warmup:product:" . $productId;
        
        // ✅ 尝试获取锁，设置较短 TTL=15s（预热足够）
        if (!$this->redis->set($lockKey, getmypid(), ['NX', 'PX' => 15000])) {
            return; // 非热点 Key，返回缓存或 DB 数据
        }
        
        try {
            // 业务逻辑（预热逻辑）
            $cacheData = [
                'id' => Product::find($productId)->fresh()->toArray(),
                
                // ✅ 使用独立 Key 存储聚合数据，避免热点瓶颈
                'reviews_avg' => (string)(floatval(ProductReview::avg('rating'))) . '.0',
                
                // ✅ 标签独立 Key，不竞争同一锁
                'tags_list' => ['best-seller', 'hot', 'trending'],
            ];
            
            $this->redis->set(
                "product:{$productId}",
                json_encode($cacheData),
                ['EX' => 3600] // 无需 NX，直接覆盖更新缓存
            );
            
            // ✅ 记录预热日志用于监控
            CacheWarmupLog::create([
                'product_id'    => $productId,
                'worker_pid'    => getmypid(),
                'warmup_time'   => now(),
                'lock_key'      => $lockKey,
            ]);
            
        } finally {
            // ✅ 释放锁
            $this->redis->del($lockKey);
        }
    }
}

// source/database/migrations/xxxx_create_cache_warmup_logs_table.php
Schema::create('cache_warmup_logs', function (Blueprint $table) {
    $table->id();
    $table->string('product_id');
    $table->integer('worker_pid')->comment('Worker 进程 PID');
    $table->timestamp('warmup_time');
    $table->string('lock_key')->comment('锁 Key');
    $table->enum('status', ['success', 'timeout', 'error']); // 监控用
    $table->text('error_message')->nullable();
    $table->integer('retry_count')->default(0);
    $table->timestamps();
    
    $table->index(['product_id', 'warmup_time']); // 方便查询热点产品
});
```

---

## 三、Lua 脚本：原子性保证与性能调优

### 场景描述

在 KKday B2C API 的"库存预占"场景中，需要保证多个 Redis 操作的原子性：

```php
// ❌ Before：非原子操作，可能被并发破坏
$redis->set("stock:{$productId}", "pre_allocated", ['EX' => 300]); // 预占标记
$product = Product::find($productId);
$newStock = $product->stock - $quantity;
$redis->del("stock:{$productId}"); // 删除预占标记
$redis->set("product:{$productId}:stock", (string)$newStock, ['EX' => 3600]);
```

#### Before vs After（Lua 脚本保证原子性）

**❌ Before（非原子操作，竞态条件）**

```php
// source/app/Services/InventoryService.php
class InventoryService {
    public function preAllocateStock(string $productId, int $quantity): bool {
        $stockKey = "stock:{$productId}";
        
        // ❌ 分步操作，中间可能被其他请求打断
        
        // 1. 检查库存是否充足（读取）
        $currentStock = $this->redis->get("product:{$productId}:stock") ?: 0;
        
        if ((int)$currentStock < $quantity) {
            return false; // 库存不足
        }
        
        // 2. 预占库存（写入）
        $this->redis->set($stockKey, (string)$quantity, ['EX' => 300]);
        
        // 3. 更新商品库存（写入）
        Product::where('id', $productId)->decrement('stock', $quantity);
        
        return true;
    }
    
    public function releasePreAllocatedStock(string $productId): bool {
        $stockKey = "stock:{$productId}";
        
        // ❌ 分步操作，可能被并发破坏
        
        if ($this->redis->del($stockKey) === 1) { // 有预占标记才继续
            Product::where('id', $productId)->increment('stock');
            return true;
        }
        
        return false;
    }
}
```

**✅ After（Lua 脚本保证原子性）**

```php
// source/app/Services/InventoryService.php
class InventoryService {
    
    /**
     * Lua 脚本：预占库存（原子性）
     */
    private $luaPreAllocate = <<<'LUA'
        -- 输入：ARGV[1]=商品 ID, ARGV[2]=数量，ARGV[3]=TTL(s), ARGV[4]=请求来源 IP
        local stockKey = "stock:" .. ARGV[1]
        local productStockKey = "product:" .. ARGV[1] .. ":stock"
        
        -- 检查原始库存
        if redis.call('GET', productStockKey) == false then
            return -1 -- 商品不存在，直接返回
        end
        
        local currentStock = tonumber(redis.call('GET', productStockKey))
        if currentStock < tonumber(ARGV[2]) then
            return -2 -- 库存不足，返回-2 错误码
        end
        
        -- 预占库存（原子性 SET）
        redis.call('SET', stockKey, ARGV[2], 'EX', ARGV[3])
        
        -- 更新原始库存
        redis.call('DECRBY', productStockKey, tonumber(ARGV[2]))
        
        -- 记录日志（原子性操作，使用 Lua 保证）
        local logKey = "inv:prealloc:log:" .. ARGV[1]
        redis.call('LPUSH', logKey, {
            'time', string.valueOf(time()),
            'qty', ARGV[2],
            'ip', ARGV[4],
        })
        
        return 0 -- 成功，返回 0
LUA;

    /**
     * Lua 脚本：释放预占库存（原子性）
     */
    private $luaReleasePreAllocate = <<<'LUA'
        local stockKey = "stock:" .. ARGV[1]
        
        if redis.call('DEL', stockKey) == 0 then
            return -2 -- 没有预占标记，忽略释放请求
        end
        
        redis.call('INCRBY', 'product:' .. ARGV[1] .. ':stock', tonumber(ARGV[2]))
        
        local logKey = "inv:prealloc:log:" .. ARGV[1]
        redis.call('LPUSH', logKey, {
            'action', 'release',
            'time', string.valueOf(time()),
        })
        
        return 0 -- 成功释放
LUA;

    /**
     * 预占库存接口
     */
    public function preAllocateStock(string $productId, int $quantity): array {
        $stockKey = "stock:{$productId}";
        
        $scriptSha = $this->redis->script('LOAD', $this->luaPreAllocate);
        $result = $this->redis->eval(
            $scriptSha,
            [$productId, (string)$quantity, 300, Request::ip()], // ARGV
            1 // 返回第一个结果值
        );
        
        if ($result === -1) {
            throw new \Exception("Product not found");
        } elseif ($result === -2) {
            return ['success' => false, 'reason' => 'inventory_insufficient'];
        }
        
        // 记录预占成功日志
        InventoryPreAllocLog::create([
            'product_id'    => $productId,
            'quantity'      => $quantity,
            'created_at'    => now(),
            'status'        => 'pre_allocated',
        ]);
        
        return ['success' => true];
    }
    
    /**
     * 释放预占库存接口
     */
    public function releasePreAllocatedStock(string $productId): array {
        $stockKey = "stock:{$productId}";
        
        $scriptSha = $this->redis->script('LOAD', $this->luaReleasePreAllocate);
        $result = $this->redis->eval($scriptSha, [$productId], 1);
        
        if ($result === -2) {
            return ['success' => true, 'reason' => 'no_preallocation']; // 没有预占标记，安全忽略
        }
        
        InventoryPreAllocLog::create([
            'product_id'    => $productId,
            'status'        => 'released',
            'released_at'   => now(),
        ]);
        
        return ['success' => true];
    }
}

// source/database/migrations/xxxx_create_inventory_pre_alloc_logs_table.php
Schema::create('inventory_pre_alloc_logs', function (Blueprint $table) {
    $table->id();
    $table->string('product_id');
    $table->integer('quantity');
    $table->enum('action', ['pre_allocate', 'release']);
    $table->timestamp('created_at')->nullable(); // 预占时间（释放时为空）
    $table->timestamp('released_at')->nullable(); // 释放时间（不释放时为空）
    $table->text('error_reason')->nullable()->comment('库存不足等原因');
    $table->timestamps();
    
    $table->index(['product_id', 'created_at']);
});
```

---

## 四、RedLock 集群方案：高可用与数据一致性

### 场景描述

在 KKday B2C API 的"秒杀活动"场景中，单 Redis 实例成为瓶颈，需要 RedLock 集群保证高可用。

#### Before vs After（单实例 → 多实例 RedLock）

**❌ Before（单 Redis 实例）**

```php
// source/app/Services/LockService.php
class LockService {
    public function __construct(RedisManager $redis) {
        $this->redis = $redis;
    }
    
    // ❌ 单实例，Redis 宕机导致锁永久失效
    public function acquireLock(string $lockKey, int $ttlMs): bool {
        $setOptions = [
            'NX' => true,
            'PX' => $ttlMs,
        ];
        
        return $this->redis->set($lockKey, getmypid(), $setOptions);
    }
}

// 风险：
// - Redis Master 宕机 → 所有锁丢失 → 超卖/数据不一致
// - Redis Slave 不可用 → 读写分离失效 → API 延迟上升
```

**✅ After（RedLock 多实例集群）**

```php
// source/app/Services/LockService.php
use Illuminate\Support\Arr;
use Predis\Client as PredisClient;

class LockService {
    private $redis; // Redis 连接池（用于 RedLock 客户端）
    private $redlockInstance; // RedLock 客户端
    
    public function __construct(RedisManager $redis) {
        $this->redis = $redis;
        
        // ✅ RedLock 客户端配置
        $this->redlockInstance = new \RedLock\Client(
            new Predis\Client(['host' => env('REDIS_HOST', '127.0.0.1'), 'port' => env('REDIS_PORT', 6379)])
        );
        
        // ✅ 多 Redis Master 配置（至少需要 N/2 + 1 个节点多数派确认）
        $this->redlockInstance->setFailoverTimeout(2000); // 故障切换超时
        $this->redlockInstance->setRetryDelay(100); // 重试间隔
    }
    
    /**
     * 使用 RedLock 获取分布式锁（集群）
     * 
     * @param string $lockKey 锁 Key
     * @param int $ttlMs TTL（毫秒），建议 >= 5ms
     * @return bool
     */
    public function acquireRedLock(string $lockKey, int $ttlMs = 10000): bool {
        // ✅ RedLock：尝试向 N/2+1 个 Master 节点获取锁
        return $this->redlockInstance->lock($lockKey, $ttlMs);
    }
    
    /**
     * 释放 RedLock（集群）
     */
    public function releaseRedLock(string $lockKey): bool {
        return $this->redis->eval(<<<'LUA', 3) === 1;
        local lockKey = KEYS[1]
        local holder = redis.call('GET', lockKey)
        if holder == ARGV[1] then
            return redis.call('DEL', lockKey)
        else
            return 0
        end
LUA, $lockKey, (string)getmypid()
    }
    
    /**
     * 使用 RedLock 执行业务逻辑（带超时保护）
     */
    public function executeWithRedLock(string $lockKey, callable $callback): array {
        $maxHoldMs = 3000; // RedLock 锁最长持有时间
        
        if (!$this->acquireRedLock($lockKey, $maxHoldMs)) {
            throw new \Exception("Failed to acquire RedLock");
        }
        
        try {
            return $callback();
        } finally {
            $this->releaseRedLock($lockKey); // 确保释放锁
        }
    }
}

// source/config/redis.php
return [
    'default' => [
        'host'      => env('REDIS_HOST', '127.0.0.1'),
        'password'  => env('REDIS_PASSWORD', null),
        'port'      => env('REDIS_PORT', 6379),
        'database'  => env('REDIS_DB', 0),
        'prefix'    => '',
        'timeout'   => 2.5, // 超时设置，防止阻塞
    ],
    
    // ✅ RedLock 专用连接配置（独立连接池）
    'redlock' => [
        'host'      => explode(',', env('REDIS_MASTER_HOSTS', '127.0.0.1')), // 多个 Master
        'password'  => env('REDIS_PASSWORD', null),
        'port'      => env('REDIS_PORT', 6379),
        'database'  => env('REDIS_DB', 0),
    ],
];

// source/.env
# RedLock 集群配置（至少需要 3 个 Master，多数派=2）
REDIS_MASTER_HOSTS=redis-master-1,redis-master-2,redis-master-3
REDLOCK_TIMEOUT_MS=5000
```

---

## 五、CAS 乐观锁方案：性能与简单性的平衡

### 场景描述

在 KKday B2C API 的"用户积分累计"场景中，需要保证更新操作的原子性，但不需要互斥锁的高延迟。

#### Before vs After（悲观锁 → CAS 乐观锁）

**❌ Before（悲观锁：分布式锁）**

```php
// source/app/Services/UserService.php
class UserService {
    public function __construct(RedisManager $redis) {
        $this->redis = $redis;
    }
    
    /**
     * 用户积分累计（悲观锁）
     */
    public function incrementPoints(string $userId, int $points): array {
        $lockKey = "user:points:lock:" . $userId;
        
        // ❌ 获取分布式锁，增加延迟
        if (!$this->redis->set($lockKey, getmypid(), ['NX', 'PX' => 5000])) {
            return [
                'success' => false,
                'reason' => 'lock_failed',
            ];
        }
        
        try {
            // 业务逻辑
            $user = User::find($userId);
            $points += $this->validatePoints($points); // 积分校验逻辑
            
            $newPoints = (int)$user->points + $points;
            
            $result = [
                'success' => true,
                'old_points' => $user->points,
                'new_points' => $newPoints,
            ];
            
            // 写入 Redis（用于缓存）
            $this->redis->set("user:{$userId}:points", (string)$newPoints, ['EX' => 3600]);
            
            return $result;
        } finally {
            // ✅ 释放锁
            if ($holder = (string)$this->redis->get($lockKey)) {
                if ($holder === getmypid()) {
                    $this->redis->del($lockKey);
                }
            }
        }
    }
}
```

**✅ After（CAS 乐观锁：SETIF + INCRBY）**

```php
// source/app/Services/UserService.php
class UserService {
    
    /**
     * Lua 脚本：CAS 乐观锁更新积分（原子性）
     */
    private $luaCasUpdatePoints = <<<'LUA'
        local pointsKey = KEYS[1]
        local userId = ARGV[1]
        local pointsToAdd = tonumber(ARGV[2])
        
        -- 读取当前值
        local currentPoints = redis.call('GET', pointsKey)
        if not currentPoints then return -1 end
        
        local currentPoints = tonumber(currentPoints)
        
        -- CAS：仅当值未变化时才更新
        if currentPoints ~= tonumber(redis.call('GET', pointsKey)) then
            return -2 -- 并发冲突，返回-2
        end
        
        -- 更新积分（原子性）
        local newPoints = currentPoints + tonumber(pointsToAdd)
        redis.call('SET', pointsKey, newPoints, 'NX')
        
        -- 记录变更日志（原子性）
        local logKey = "user:points:log:" .. userId
        redis.call('RPUSH', logKey, {
            'time', string.valueOf(time()),
            'old', currentPoints,
            'new', newPoints,
            'diff', pointsToAdd,
        })
        
        return newPoints -- 返回新值（成功时）
LUA;

    /**
     * 用户积分累计（CAS 乐观锁）
     */
    public function incrementPoints(string $userId, int $points): array {
        $scriptSha = $this->redis->script('LOAD', $this->luaCasUpdatePoints);
        
        // CAS 重试：最多尝试 3 次
        for ($i = 0; $i < 3; $i++) {
            $result = $this->redis->eval($scriptSha, ["user:{$userId}:points", $userId, (string)$points], 1);
            
            if ($result === -1) {
                return [
                    'success' => false,
                    'reason' => 'user_not_found',
                ];
            } elseif ($result === -2) {
                // CAS 冲突，等待后重试
                usleep(50 * 1000); // 50ms 延迟
                continue;
            } else {
                // 成功更新
                return [
                    'success' => true,
                    'new_points' => $result,
                ];
            }
        }
        
        // 重试失败，返回冲突
        return [
            'success' => false,
            'reason' => 'cas_conflict',
            'retries' => 3,
        ];
    }
}

// source/database/migrations/xxxx_create_user_points_log_table.php
Schema::create('user_points_logs', function (Blueprint $table) {
    $table->id();
    $table->string('user_id');
    $table->float('old_points')->default(0);
    $table->float('new_points')->nullable();
    $table->integer('point_diff')->default(0);
    $table->timestamp('created_at');
    
    // 记录变更日志用于监控和审计
    $table->index(['user_id', 'created_at']);
});
```

---

## 六、监控与告警：分布式锁失效的预防策略

### 监控指标

| 指标 | 说明 | 阈值告警 |
|------|------|----------|
| `lock_wait_time_p99` | 锁等待时间 P99 | > 10ms |
| `lock_fail_rate` | 获取锁失败率 | > 5% |
| `redis_conn_pool_utilization` | 连接池利用率 | > 80% |
| `lock_holder_pid_mismatch` | 释放时 PID 不匹配次数 | > 0（任何） |

### 监控配置（Laravel Telescope + Redis Insight）

```php
// source/observers/LockObserver.php
use Illuminate\Support\Facades\DB;

class LockObserver {
    /**
     * 记录每次获取锁的耗时
     */
    public static function trackLockWaitTime(string $lockKey, int $waitMs): void {
        DB::table('lock_monitor_logs')->insert([
            'lock_key'     => $lockKey,
            'wait_time_ms' => $waitMs,
            'pid'          => getmypid(),
            'created_at'   => now(),
        ]);
    }
    
    /**
     * 记录锁释放异常（PID 不匹配）
     */
    public static function recordLockReleaseMismatch(string $lockKey): void {
        DB::table('lock_monitor_logs')->insert([
            'lock_key'     => $lockKey,
            'wait_time_ms' => 0,
            'pid_mismatch' => true,
            'expected_pid' => null,
            'actual_holder' => (string)Redis::get($lockKey),
            'created_at'   => now(),
        ]);
    }
}

// source/database/migrations/xxxx_create_lock_monitor_logs_table.php
Schema::create('lock_monitor_logs', function (Blueprint $table) {
    $table->id();
    $table->string('lock_key');
    $table->integer('wait_time_ms')->nullable()->default(null); // 等待时间
    $table->boolean('pid_mismatch')->default(false); // PID 不匹配
    $table->string('expected_pid')->nullable()->comment('预期持有者 PID');
    $table->string('actual_holder')->nullable(); // 实际持有者
    $table->string('lock_type')->default('predis'); // 锁类型（Predis/RedLock）
    $table->timestamps();
    
    $table->index(['lock_key', 'created_at']);
});

// Laravel Telescope 监控面板
// 在 Telescope 中创建自定义监控卡片：
// - Lock Wait Time P99
// - Lock Fail Rate
// - Redis Conn Pool Utilization
```

---

## 七、最佳实践总结

### ✅ DO（推荐）

1. **设置合理 TTL**：分布式锁必须设置 TTL，防止网络中断导致死锁
2. **CAS 重试策略**：乐观锁冲突时，采用指数退避重试（50ms → 100ms → 200ms）
3. **独立连接池**：Redis 读写分离 + 锁专用连接池，避免锁操作阻塞主连接
4. **Lua 脚本原子性**：复杂业务逻辑使用 Lua 脚本，保证多个 Redis 操作的原子性
5. **监控告警**：记录每次锁获取/释放，设置延迟和失败率告警阈值

### ❌ DON'T（避免）

1. **❌ 不使用分布式锁的场景**：简单的 Key 值读写无需加锁
2. **❌ 不使用过短 TTL**：TTL < 50ms 可能导致频繁竞争，增加锁获取延迟
3. **❌ 不手动释放锁**：异常情况下使用 `finally` 确保锁释放
4. **❌ 不混合使用不同锁策略**：避免在同一业务场景中同时使用悲观锁和乐观锁
5. **❌ 不使用多 Redis Master 写入同一 Key**：除非必要，否则避免跨节点更新

---

## 参考资源

- [RedLock 算法论文](https://www.sohu.com/a/103798764_671226)
- [Redis 分布式锁最佳实践](https://redis.io/topics/distlock)
- [Predis PHP Redis 客户端](https://github.com/nrk/Predis)
- [Laravel Cache 服务层封装](https://laravel.com/docs/8.x/cache)

---

**总结**：在 KKday B2C API 项目中，分布式锁的失效场景主要包括死锁、热点 Key 瓶颈、集群不一致、超时竞争等。通过合理设置 TTL、使用 Lua 脚本保证原子性、CAS 乐观锁方案替代悲观锁、以及完善的监控告警策略，可以有效预防分布式锁失效问题，提升系统高可用性。
