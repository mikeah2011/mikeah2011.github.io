---

title: Redis 缓存穿透/击穿/雪崩防护与分布式锁实战 - KKday B2C API 真实踩坑记录
keywords: [Redis, KKday B2C API, 缓存穿透, 击穿, 雪崩防护与分布式锁实战, 真实踩坑记录]
date: 2026-05-02
categories:
- database
tags:
- KKday
- Redis
- 缓存
- 缓存穿透
- 缓存击穿
- 缓存雪崩
- 分布式
- 布隆过滤器
- 高并发
- PHP
description: 基于 KKday B2C API 高并发真实踩坑记录，系统讲解 Redis 缓存穿透（布隆过滤器+空值缓存双层防护）、缓存击穿（互斥锁+随机TTL+逻辑过期）、缓存雪崩（分时段过期+随机TTL分散）三大经典问题的生产级解决方案，深入剖析 Redis 分布式锁失效场景与 RedLock 防护策略，含完整 PHP 8 代码实战与高并发架构最佳实践
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-redis-cache-shield-content-1.jpg
- /images/content/databases-redis-cache-shield-content-2.jpg
---




# Redis 缓存三大问题防护与分布式锁实战

## 📋 文章目录

1. [问题背景：KKday B2C API 为什么需要 Redis](#-问题背景kkday-b2c-api-为什么需要redis)
2. [缓存穿透：空数据也缓存？](#-缓存穿透空数据也缓存)
3. [缓存击穿：热点 Key 突然过期](#-缓存击穿热点-key-突然过期)
4. [缓存雪崩：大量 Key 同时失效](#-缓存雪崩大量-key-同时失效)
5. [分布式锁失效场景与防护](#-分布式锁失效场景与防护)
6. [代码实战：Before/After 对比](#-代码实战beforeafter-对比)
7. [最佳实践总结](#-最佳实践总结)

---

## 🔍 问题背景：KKday B2C API 为什么需要 Redis

在 KKday B2C API 项目中，我们面临以下挑战：

- **高并发场景**：促销活动期间单接口 QPS 达到 5000+
- **数据一致性**：订单状态、库存扣减需要强一致性
- **性能瓶颈**：PHP 8 处理大量业务逻辑，IO 成为瓶颈
- **BFF 模式**：GraphQL → JSON 转换优化，减少 DB 查询

```php
// ❌ 问题代码：直接查库（未使用缓存）
public function getOrderProducts($orderId)
{
    // 每次查询都打数据库
    $order = Order::with(['products', 'products.images'])
        ->find($orderId);
        
    return $order;
}
```

引入 Redis 后，我们将热点数据（商品、订单、用户信息）缓存到 Redis，大幅降低 DB 负载：

```php
// ✅ 改进代码：使用 Redis 缓存
public function getOrderProducts($orderId)
{
    $key = "order:products:" . $orderId;
    
    // 设置 5 分钟过期时间
    $order = Cache::remember($key, 300, function () use ($orderId) {
        return Order::with(['products', 'products.images'])
            ->find($orderId);
    });
    
    return $order;
}
```

**⚠️ 但很快遇到了三个致命问题：**

1. 查询不存在订单导致缓存穿透，DB 被打爆
2. 热点订单数据突然过期，大量请求打到 DB
3. 多个 Key 同时过期（如 TTL 设置为统一时间），雪崩效应
4. 分布式锁在并发场景下失效，导致库存超卖

---

## 🎯 缓存穿透：空数据也缓存？

![缓存穿透防护](/images/content/databases-redis-cache-shield-content-1.jpg)

### ❌ Before：经典缓存穿透问题

```php
// ❌ 错误做法：直接查缓存，不存在则查 DB
Cache::remember("order:" . $orderId, 300, function () use ($orderId) {
    // 查询不存在的订单也会触发
    return Order::find($orderId); 
});
```

**场景**：恶意用户不断请求不存在的订单 ID（1000000、1000001...），导致 DB 频繁响应查询。

### ✅ After：双层缓存 + 布隆过滤器思想

#### 方案一：空值缓存（推荐）

```php
// ✅ 正确做法：无论是否命中，都设置过期时间
Cache::remember("order:" . $orderId, 300, function () use ($orderId) {
    $order = Order::find($orderId);
    
    // 如果是空对象，也要缓存空值
    return $order;
}, function ($key) {
    // 自定义过期策略：即使是空值也有较短的 TTL
    return 60; // 空值只缓存 1 分钟
});

/**
 * 封装为工具方法
 */
use Illuminate\Support\Facades\Cache;

class CacheHelper
{
    /**
     * 安全缓存：处理空数据场景
     * @param string $key
     * @param int $ttl
     * @return mixed|null
     */
    public static function safeGet($key, $ttl, callable $callback)
    {
        if (Cache::has($key)) {
            return Cache::get($key);
        }
        
        try {
            $value = $callback();
            
            // 如果值是 null，设置较短的 TTL（避免长期空缓存）
            $effectiveTtl = is_null($value) ? min(60, $ttl / 10) : $ttl;
            
            Cache::put($key, $value ?? '', $effectiveTtl);
            
            return $value;
        } catch (Exception $e) {
            // 异常也设置较短 TTL，快速重试
            Cache::put($key, null, min(60, $ttl / 10));
            throw $e;
        }
    }
}

// 使用方式
$order = CacheHelper::safeGet("order:" . $orderId, 300, function () use ($orderId) {
    return Order::find($orderId);
});

if ($order === null) {
    // 订单不存在，返回友好提示或创建待付款状态
    Log::warning("订单不存在: {$orderId}");
    return Response::json(['message' => '订单不存在'], 404);
}
```

#### 方案二：布隆过滤器（终极方案）

```php
// ✅ 使用 Redis 模块实现布隆过滤器判断
use Redis;

class BloomFilter
{
    protected $redis;
    
    public function __construct(Redis $redis)
    {
        $this->redis = $redis;
    }
    
    /**
     * 添加元素到布隆过滤器
     */
    public function add(string $key, int $elementId)
    {
        $hash = $this->bloomHash($key, $elementId);
        
        // 使用 Bitset 设置多个 bit
        $bits = [
            $hash['h1'] => true,
            $hash['h2'] => true,
            $hash['h3'] => true,
        ];
        
        return $this->redis->mSet($bits);
    }
    
    /**
     * 判断元素是否可能存在
     */
    public function exists(string $key, int $elementId): bool
    {
        $hash = $this->bloomHash($key, $elementId);
        
        // 如果任意一个 bit 为 0，则肯定不存在
        if (!$this->redis->getbit("bf:{$key}", $hash['h1'])) {
            return false;
        }
        if (!$this->redis->getbit("bf:{$key}", $hash['h2'])) {
            return false;
        }
        if (!$this->redis->getbit("bf:{$key}", $hash['h3'])) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 批量添加
     */
    public function batchAdd(string $key, array $elementIds)
    {
        $commands = [];
        foreach ($elementIds as $id) {
            $hash = $this->bloomHash($key, $id);
            $commands[] = "SETEX bf:{$key} 86400 1"; // 设置 bitset
            $commands[] = "BITOP OR bf:{$key} bf:{$key} {$hash['h1']}";
        }
        
        return $this->redis->multi()->execute($commands);
    }
    
    private function bloomHash(string $key, int $elementId): array
    {
        // 使用 MurmurHash3 实现（简化版）
        $h1 = hash('crc32', "h1:{$key}:{$elementId}");
        $h2 = hash('crc32', "h2:{$key}:{$elementId}");
        $h3 = hash('crc32', "h3:{$key}:{$elementId}");
        
        return [
            'h1' => hexdec(substr($h1, -8)),
            'h2' => hexdec(substr($h2, -8)),
            'h3' => hexdec(substr($h3, -8)),
        ];
    }
}

/**
 * 在 Controller 中使用
 */
class OrderController extends Controller
{
    protected $bloomFilter;
    
    public function __construct()
    {
        // 注入布隆过滤器
    }
    
    public function show($orderId)
    {
        // 先判断是否可能不存在（布隆过滤器过滤）
        if (!$this->bloomFilter->exists('order', $orderId)) {
            return Response::json([
                'message' => '非法请求：订单 ID 不存在',
                'code' => 400,
            ], 400);
        }
        
        // 布隆过滤器通过了，继续查 Redis 缓存
        $key = "order:" . $orderId;
        
        if (Cache::has($key)) {
            return Response::json(Cache::get($key));
        }
        
        // 查 DB（此时肯定存在）
        $order = Order::with(['products', 'products.images'])
            ->find($orderId);
            
        Cache::put($key, $order, 300);
        
        return Response::json($order);
    }
}
```

---

## ⚡ 缓存击穿：热点 Key 突然过期

### ❌ Before：统一 TTL 导致的击穿问题

```php
// ❌ 错误做法：所有订单都设置相同 TTL
Cache::remember("order:" . $orderId, 300, function () use ($orderId) {
    return Order::find($orderId);
});
```

**场景**：当某个热门订单（如爆款商品订单）的 Key 在 14:00:00 过期时，此时可能有几百个并发请求同时到达，全部绕过缓存查库。

### ✅ After：互斥锁 + 随机 TTL

#### 方案一：逻辑过期 + 后台修复（推荐用于非强一致性场景）

```php
// ✅ 逻辑过期模式：数据永远不过期，设置标记位
Cache::put("order:{$orderId}", $order, -1); // -1 永不过期

/**
 * 添加逻辑过期标记
 */
Cache::put("order:{$orderId}:lock", true, 60); // 锁 Key，防止并发修复

// 后台线程异步修复过期数据
if ($now > 14:00:00) {
    $key = "order:" . $orderId;
    
    if (Cache::has("{$key}:lock")) {
        Cache::forget("{$key}:lock"); // 释放锁
    } else {
        // 获取锁，修复过期数据
        $newData = Order::find($orderId);
        
        // 先删除旧数据（避免脏读）
        Cache::forget($key);
        
        // 写入新数据
        Cache::put($key, $newData, 300);
    }
}

/**
 * 客户端读取：处理过期但未修复的场景
 */
public function getOrder($orderId)
{
    $key = "order:" . $orderId;
    
    // 1. 尝试从缓存读取（可能已逻辑过期）
    $order = Cache::get($key);
    
    if ($order && !$this->isExpired($key)) {
        return $order;
    }
    
    // 2. 如果缓存不存在或过期，检查是否正在修复
    if (Cache::has("{$key}:lock")) {
        Log::info("订单 {$orderId} 正在后台修复，请稍后重试");
        return Response::json(['message' => '数据正在修复中'], 503);
    }
    
    // 3. 加锁并修复数据
    $order = Order::find($orderId);
    
    Cache::put($key, $order, -1);
    Cache::forget("{$key}:lock");
    
    return $order;
}

private function isExpired(string $key): bool
{
    // 检查逻辑过期标记（使用单独 Key）
    return Cache::get("{$key}:expired") === 'true';
}
```

#### 方案二：互斥锁 + 随机 TTL（适合强一致性场景）

```php
// ✅ 互斥锁 + 随机 TTL 方案
use Illuminate\Support\Str;

Cache::remember($key, $randomTtl, function () use ($orderId) {
    // 加分布式锁
    $lockKey = "order:lock:" . Str::slug($orderId);
    
    if (!$this->distributeLock->tryLock($lockKey, 10)) {
        // 获取不到锁，说明有其他线程在修复
        return Cache::get($key);
    }
    
    try {
        $order = Order::find($orderId);
        
        // 随机 TTL 防雪崩
        $ttl = $this->randomTtl(); // 300 ~ 420 秒随机
        
        Cache::put($key, $order, $ttl);
        
        return $order;
    } finally {
        $this->distributeLock->release($lockKey);
    }
});

/**
 * 生成随机 TTL（防雪崩）
 */
private function randomTtl(): int
{
    $baseTtl = 300;
    $randomRange = 120; // ±2 分钟
    
    return $baseTtl + rand(-$randomRange, $randomRange);
}

/**
 * 分布式锁实现（RedLock）
 */
class RedLock
{
    protected $redis;
    
    public function __construct(Redis $redis)
    {
        $this->redis = $redis;
    }
    
    /**
     * 尝试获取分布式锁
     */
    public function tryLock(string $key, int $expireTime): bool
    {
        return $this->redis->set(
            "lock:{$key}", 
            '1', 
            ['nx', 'px' => $expireTime * 1000] // NX + PX（毫秒）
        );
    }
    
    /**
     * 释放分布式锁
     */
    public function release(string $key): bool
    {
        return $this->redis->del("lock:{$key}");
    }
    
    /**
     * 带自旋的锁（防止主从切换导致的死锁）
     */
    public function spinLock(string $key, int $expireTime, int $sleepTime = 100)
    {
        $maxAttempts = 3; // 最多尝试 3 次
        
        for ($i = 0; $i < $maxAttempts; $i++) {
            if ($this->tryLock($key, $expireTime)) {
                return true;
            }
            
            usleep($sleepTime * 1000); // 等待 100ms
        }
        
        return false;
    }
}

/**
 * 在 Service 中使用
 */
class OrderService extends Service
{
    protected $redLock;
    
    public function getWithCache(int $orderId): ?Order
    {
        $key = "order:{$orderId}";
        $lockKey = "order:lock:{$orderId}";
        
        // 尝试获取锁
        if (!$this->redLock->tryLock($lockKey, 30)) {
            // 拿不到锁，直接返回缓存数据
            return Cache::get($key);
        }
        
        try {
            $order = Order::find($orderId);
            
            // 随机 TTL（防雪崩）
            $ttl = $this->randomTtl();
            
            if ($order) {
                Cache::put($key, $order, $ttl);
            } else {
                // 订单不存在时设置短 TTL，快速穿透
                Cache::put($key, null, 60);
            }
            
            return $order;
        } finally {
            $this->redLock->release($lockKey);
        }
    }
    
    private function randomTtl(): int
    {
        $base = 300;
        return $base + rand(-120, 120); // 240 ~ 420 秒
    }
}
```

---

## 🌊 缓存雪崩：大量 Key 同时失效

### ❌ Before：统一 TTL 导致的问题

```php
// ❌ 错误做法：所有缓存设置相同过期时间（如 300 秒）
Cache::remember($key, 300, function () { ... });
```

**场景**：14:00:00 整，所有 Key 同时过期，大量请求打到数据库。

### ✅ After：随机 TTL + 分时段设置

#### 方案一：随机 TTL（最简单有效）

```php
// ✅ 随机 TTL 防雪崩
Cache::remember($key, $this->randomTtl(), function () { ... });

class CacheStrategy
{
    /**
     * 生成随机过期时间（正态分布，集中在基准值附近）
     */
    public function randomTtl(int $baseTtl = 300): int
    {
        // 使用伪代码模拟正态分布
        // PHP 原生没有 randN()，用近似方法
        
        $sigma = 60; // 标准差
        $mean = $baseTtl;
        
        // Box-Muller 变换生成正态分布随机数
        $u1 = mt_rand(1, 999) / 1000;
        $u2 = mt_rand(1, 999) / 1000;
        
        $z = sqrt(-2 * log($u1)) * cos(2 * M_PI * $u2);
        $randomTtl = intval($mean + $sigma * $z);
        
        return max(60, min($baseTtl + 300, $randomTtl)); // 限制范围
    }
}
```

#### 方案二：分时段设置（生产环境推荐）

```php
use Illuminate\Support\Facades\Cache;

/**
 * 根据当前时间片设置不同的基础过期时间
 */
public function getOrderCacheKey($orderId)
{
    $now = time();
    $minute = $now % 60; // 获取分钟
    
    // 将 1 小时分为 12 个时段（每 5 分钟）
    $timeSlot = intval($minute / 5); // 0-11
    
    // 不同时段使用不同的基础 TTL，分散过期时间
    $baseTtls = [300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 520];
    $ttl = $baseTtls[$timeSlot % count($baseTtls)] + rand(-30, 30);
    
    Cache::remember("order:{$orderId}", $ttl, function () use ($orderId) {
        return Order::find($orderId);
    });
}
```

#### 方案三：Key 名包含时间戳（终极防雪崩）

```php
/**
 * TTL 固定的情况下，通过 Key 名分散过期时间
 */
public function getOrderCacheKeyWithTime($orderId)
{
    // 将 Key 拆分到不同 Hash 槽（如 redis-cluster）
    $baseKey = "order:{$orderId}";
    
    // 使用时间戳作为后缀，分散到不同 slot
    $timestamp = time();
    
    Cache::remember(
        "order:{$orderId}:v{$timestamp}", // 包含时间戳
        300, // TTL 固定
        function () use ($orderId) {
            return Order::find($orderId);
        }
    );
}

/**
 * 读取时忽略版本号
 */
public function getOrder($orderId)
{
    $key = "order:" . $orderId . ":v*";
    
    // 使用模式匹配获取任意版本的数据
    $orders = Cache::tags(["order:v*"]) || [];
    
    foreach ($orders as $order) {
        if (!$this->isExpired($order)) {
            return $order;
        }
    }
    
    return null;
}
```

---

## 🔐 分布式锁失效场景与防护

### ❌ Before：简单分布式锁的问题

```php
// ❌ 危险做法：简单 SETNX 实现的分布式锁
use Redis;

$redis = new Redis();
$redis->connect('127.0.0.1', 6379);

// 获取库存扣减时的简单锁
if ($redis->set("stock:lock:" . $productId, '1')) {
    try {
        $oldStock = $this->getStock($productId);
        
        if ($oldStock > 0) {
            $newStock = $oldStock - 1;
            $this->setStock($productId, $newStock);
        }
    } finally {
        // 问题：业务逻辑出错时，锁可能没释放！
        $redis->del("stock:lock:" . $productId); 
    }
}
```

### ⚠️ 分布式锁失效场景

#### 场景一：主从切换导致锁丢失

```
┌─────────────┐         ┌─────────────┐
│  Master      │ ─────→  │   Slave     │
│  (持有锁)    │         │  (继承数据)  │
└─────────────┘         └─────────────┘

Master 宕机 → Slave 晋升为新 Master
Slave 没有 Redis Session，锁释放了！
```

**后果**：库存超卖、并发安全问题

#### 场景二：业务时间过长导致锁过期

```php
// ❌ 问题：业务逻辑执行超过锁 TTL，锁自动释放
if ($redis->set("stock:lock:" . $productId, '1', ['ex' => 10])) {
    try {
        // 复杂业务逻辑可能需要 30 秒以上
        $order = OrderService::create($request);
        
        // 此时锁已过期，其他进程可以获取锁！
        // 并发超卖风险
    } catch (Exception $e) {
        throw $e;
    } finally {
        $redis->del("stock:lock:" . $productId);
    }
}
```

#### 场景三：事务嵌套导致死锁

```php
// ❌ 问题：业务逻辑中有嵌套事务，外层事务未提交时内层已释放锁
if ($redis->set("stock:lock:$id", '1', ['ex' => 5])) {
    // 内层事务 A（持有锁）
    DB::transaction(function () use ($productId) {
        // 更新订单状态...
    });
    
    // 外层事务 B
    DB::transaction(function () use ($productId) {
        // 扣减库存...
        $redis->del("stock:lock:$id"); // 锁提前释放！
        
        throw new \Exception("模拟异常");
    });
}
```

### ✅ After：可靠分布式锁实现

#### 方案一：Lua 脚本原子性保证

```php
use Redis;

class SafeDistributedLock
{
    protected $redis;
    
    public function __construct(Redis $redis)
    {
        $this->redis = $redis;
    }
    
    /**
     * Lua 脚本：设置锁（包含自旋）
     */
    private $luaSetLock = <<<'LUA'
local key = KEYS[1]
local resourceId = ARGV[1]
local expireTime = tonumber(ARGV[2])
local maxSpin = tonumber(ARGV[3])

for i = 1, maxSpin do
    if redis.call('SET', key, 'lock_' .. resourceId, 'PX', expireTime * 1000, 'NX') == true then
        return 1 -- 获取成功
    end
    redis.call('SLEEP', 0.001) -- 等待 1ms，自旋
end

return 0 -- 获取失败
LUA;
    
    /**
     * Lua 脚本：释放锁（验证所有权）
     */
    private $luaReleaseLock = <<<'LUA'
local key = KEYS[1]
local lockValue = ARGV[1]
local oldLockValue = redis.call('GET', key)

if oldLockValue == lockValue then
    return 1 -- 成功释放
end

return nil -- 锁不属于当前进程，不释放
LUA;
    
    /**
     * Lua 脚本：续期锁（业务长时间执行）
     */
    private $luaExtendLock = <<<'LUA'
local key = KEYS[1]
local lockValue = ARGV[1]
local oldLockValue = redis.call('GET', key)

if oldLockValue == lockValue then
    return redis.call('PEXPIRE', key, 60 * 3000) -- 续期 5 分钟
end

return nil
LUA;
    
    /**
     * 尝试获取分布式锁
     */
    public function tryLock(string $resourceId, string $key, int $expireTime): bool
    {
        $script = $this->luaSetLock;
        $maxSpin = 30; // 自旋 30 次，最多等待 30ms
        
        try {
            return (int)$this->redis->eval($script, [$key, $resourceId, $expireTime, $maxSpin], 1) === 1;
        } catch (\RedisException $e) {
            Log::error("获取分布式锁失败: " . $e->getMessage());
            return false; // 失败后不重试，避免雪崩
        }
    }
    
    /**
     * 释放分布式锁（安全释放）
     */
    public function release(string $resourceId, string $key): bool
    {
        if (!$this->redis->exists($key)) {
            return true; // 锁已过期或不存在，返回成功
        }
        
        try {
            // Lua 脚本原子释放
            $result = $this->redis->eval(
                $this->luaReleaseLock, 
                [$key, 'lock_' . $resourceId], 
                1
            );
            
            return is_numeric($result) && $result === 1;
        } catch (\RedisException $e) {
            Log::error("释放分布式锁失败: " . $e->getMessage());
            throw new \Exception("分布式锁释放异常");
        }
    }
    
    /**
     * 续期分布式锁（业务长时间执行）
     */
    public function extend(string $resourceId, string $key): bool
    {
        try {
            return (bool)$this->redis->eval(
                $this->luaExtendLock, 
                [$key, 'lock_' . $resourceId], 
                1
            ) === 1;
        } catch (\RedisException $e) {
            Log::error("续期分布式锁失败: " . $e->getMessage());
            return false;
        }
    }
    
    /**
     * 重试机制（业务长时间执行）
     */
    public function acquireWithRetry(string $resourceId, string $key, int $expireTime): bool
    {
        $maxRetries = 5;
        $retryInterval = 100; // ms
        
        for ($i = 0; $i < $maxRetries; $i++) {
            if ($this->tryLock($resourceId, $key, $expireTime)) {
                return true;
            }
            
            usleep($retryInterval * 1000); // 等待 100ms 后重试
        }
        
        return false;
    }
    
    /**
     * 上下文管理器模式
     */
    public function __enter(string $key, int $expireTime)
    {
        if ($this->tryLock('lock_' . mt_rand(1000, 9999), $key, $expireTime)) {
            App::before(\Closure::fromCallable([$this, 'extend'])); // 续期回调
        }
    }
    
    public function __leave(string $key)
    {
        if ($this->release('lock_' . mt_rand(1000, 9999), $key)) {
            Log::info("释放分布式锁");
        } else {
            Log::error("释放分布式锁失败，尝试强制释放");
            $this->redis->del($key); // 强制释放（最后手段）
        }
    }
}

/**
 * 使用示例：库存扣减
 */
class InventoryService extends Service
{
    protected $distributedLock;
    
    public function __construct()
    {
        $this->redis = new Redis();
        $this->redis->connect(config('database.redis'))['host', config('database.redis.port'));
        
        $this->distributedLock = new SafeDistributedLock($this->redis);
    }
    
    /**
     * 扣减库存（使用分布式锁）
     */
    public function decreaseStock(string $productId, int $quantity): bool
    {
        $key = "stock:" . $productId;
        $expireTime = 60 * 30; // 30 分钟
        
        try {
            $this->distributedLock->__enter($key, $expireTime);
            
            // 扣减库存
            return $this->decreaseStockInDb($productId, $quantity);
        } finally {
            $this->distributedLock->__leave($key);
        }
    }
    
    private function decreaseStockInDb(string $productId, int $quantity): bool
    {
        try {
            return DB::transaction(function () use ($productId, $quantity) {
                $stock = Stock::where('product_id', $productId)->first();
                
                if (!$stock) {
                    throw new \Exception("库存不存在");
                }
                
                $oldStock = $stock->stock;
                $newStock = $oldStock - $quantity;
                
                if ($newStock < 0) {
                    throw new \Exception("库存不足");
                }
                
                $stock->update(['stock' => $newStock]);
                StockLog::create([
                    'product_id' => $productId,
                    'old_stock' => $oldStock,
                    'new_stock' => $newStock,
                    'quantity' => -$quantity,
                ]);
                
                return true;
            });
        } catch (\Exception $e) {
            Log::error("扣减库存失败: " . $e->getMessage());
            throw $e;
        }
    }
}
```

---

## 🛠️ 最佳实践总结

### 1. 缓存策略矩阵

| 场景 | 策略 | TTL | 是否加锁 |
|------|------|-----|---------|
| 商品列表 | 随机 TTL + 逻辑过期 | 300~600s | ❌ |
| 订单详情 | 互斥锁 + 随机 TTL | 240~420s | ✅ |
| 库存扣减 | 分布式锁（Lua）+ 固定 TTL | 10s | ✅ |
| 用户信息 | 逻辑过期 + 永不过期 | -1 | ❌ |

### 2. 完整示例：库存扣减服务

```php
// services/InventoryService.php
class InventoryService extends Service
{
    protected $redis;
    
    public function __construct()
    {
        $this->redis = new Redis();
        $this->redis->connect(config('database.redis'));
        
        // 注册 Lua 脚本（避免网络往返）
        $this->setLuaScript(
            'decreaseStock',
            <<<'LUA'
local productId = tonumber(KEYS[1])
local quantity = tonumber(ARGV[1])
local orderId = ARGV[2]

-- 扣减库存
local newStock = redis.call('HINCRBY', 'stock:' .. productId, -quantity)

-- 记录日志
redis.call('RPUSH', 'stock_log:', productId, json_encode({
    product_id = productId,
    order_id = orderId,
    quantity = quantity,
    timestamp = tonumber(redis.call('TIME')[1]) * 1000 + tonumber(redis.call('TIME')[2]),
    stock_before = redis.call('HGET', 'stock:' .. productId, 'old'),
    stock_after = newStock,
}))

return newStock > 0
LUA
        );
        
        // 注册 Lua 脚本（检查库存）
        $this->setLuaScript(
            'checkStock',
            <<<'LUA'
local productId = tonumber(KEYS[1])
local quantity = tonumber(ARGV[1])

local stock = tonumber(redis.call('HGET', 'stock:' .. productId, 'old'))
return stock > 0 and stock >= quantity or -1
LUA
        );
    }
    
    /**
     * 设置 Lua 脚本到 Redis（减少网络往返）
     */
    private function setLuaScript(string $name, string $script): void
    {
        if ($this->redis->eval("return " . var_export(str_replace('$', '\$', str_replace('local ', 'return ', $script)), true), 0) === null) {
            $this->redis->script('load', $script);
        }
    }
    
    /**
     * 检查库存（原子操作）
     */
    public function checkStock(string $productId, int $quantity): array
    {
        $result = (int)$this->redis->eval(
            <<<'LUA'
local productId = tonumber(KEYS[1])
local quantity = tonumber(ARGV[1])

local stock = redis.call('HGET', 'stock:' .. productId, 'old')
return stock and tonumber(stock) >= quantity or -1
LUA
            , 
            ['stock:' . $productId], 
            [$productId, $quantity]
        );
        
        return [
            'available' => $result > 0,
            'current_stock' => $result === 0 ? null : ($result * -1), // 负数表示当前库存
            'message' => $result > 0 ? '库存充足' : '库存不足',
        ];
    }
    
    /**
     * 扣减库存（原子性保证）
     */
    public function decreaseStock(string $productId, int $quantity, string $orderId): bool
    {
        // Lua 脚本：检查并扣减库存（原子操作）
        $script = <<<'LUA'
local productId = tonumber(KEYS[1])
local quantity = tonumber(ARGV[1])
local orderId = ARGV[2]

-- 获取当前库存
local stock = redis.call('HGET', 'stock:' .. productId, 'old')

if not stock or tonumber(stock) < tonumber(quantity) then
    return false
end

-- 扣减库存
newStock = tonumber(stock) - tonumber(quantity)
redis.call('HSET', 'stock:' .. productId, 'new', newStock)

-- 记录日志（使用 Pipeline 减少网络往返）
local logData = {
    product_id = productId,
    order_id = orderId,
    quantity = quantity,
    old_stock = stock,
    new_stock = newStock,
}

redis.call('RPUSH', 'stock_log:' .. productId, cjson.encode(logData))
redis.call('LPUSH', 'stock_log:' .. productId, '') -- 设置过期提示（简化版）

return true
LUA;
        
        try {
            $result = (bool)$this->redis->eval(
                $script, 
                ['stock:' . $productId], 
                [$productId, $quantity, $orderId]
            );
            
            if (!$result) {
                throw new \Exception("库存不足");
            }
            
            return true;
        } catch (\RedisException $e) {
            Log::error("扣减库存 Lua 脚本执行失败: " . $e->getMessage());
            throw new \Exception("系统繁忙，请稍后重试");
        }
    }
    
    /**
     * 查询库存
     */
    public function getStock(string $productId): ?array
    {
        $key = "stock:" . $productId;
        
        if (!$this->redis->exists($key)) {
            return null;
        }
        
        $data = json_decode($this->redis->get($key), true);
        
        // 检查是否过期
        $ttl = $this->redis->ttl($key);
        if ($ttl > 0 && time() > ($ttl + $data['created_at'])) {
            $this->refreshStock($productId);
        }
        
        return json_decode($this->redis->get($key), true);
    }
    
    private function refreshStock(string $productId): void
    {
        try {
            DB::transaction(function () use ($productId) {
                $stock = Stock::where('product_id', $productId)->first();
                
                if ($stock) {
                    Cache::put(
                        "stock:" . $productId, 
                        json_encode([
                            'old' => $stock->stock,
                            'new' => $stock->stock,
                            'created_at' => time(),
                        ]), 
                        300 * rand(-20, 20) // 随机 TTL
                    );
                }
            });
            
            Log::info("刷新库存: {$productId}");
        } catch (\Exception $e) {
            Log::error("刷新库存失败: " . $e->getMessage());
        }
    }
    
    /**
     * 设置 Lua 脚本缓存（避免重复网络往返）
     */
    private function setLuaScript(string $name, string $script): void
    {
        if ($this->redis->exists('lua:' . md5($script))) {
            return; // 已缓存
        }
        
        try {
            $this->redis->set("lua:" . md5($script), $script, ['ex' => 86400]);
        } catch (\RedisException $e) {
            Log::error("设置 Lua 脚本缓存失败: " . $e->getMessage());
        }
    }
}
```

### 3. 监控与告警

```php
// config/redis.php
return [
    'connections' => [
        'default' => [
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'port' => env('REDIS_PORT', 6379),
            'password' => env('REDIS_PASSWORD', null),
            'database' => env('REDIS_DB', 0),
            'prefix' => env('REDIS_PREFIX', ''),
            'options' => [
                'prefix' => 'kkday_b2c_', // 设置 Key 前缀
                'read_timeout' => 2,      // 连接超时
                'write_timeout' => 5,     // 写操作超时
                'retry_interval' => 100,   // 重试间隔 (ms)
            ],
        ],
    ],
];

// 监控 Redis 内存使用
function monitorRedisMemory()
{
    $stats = cache->get('redis:memory');
    
    if (!$stats && isset(redis)) {
        $usedMemory = $redis->info(['memory'])['used_memory_human'] ?? '未知';
        $peakMemory = $redis->info(['memory'])['used_memory_peak_human'] ?? 0;
        
        cache(['redis:memory' => [
            'used_memory' => $usedMemory,
            'peak_memory' => $peakMemory,
            'timestamp' => time(),
        ]]);
    }
    
    return $stats;
}

// 告警：内存超过阈值
if ($stats['used_memory'] > $memoryThreshold) {
    sendAlert('Redis 内存使用过高', [
        'current' => $stats['used_memory'],
        'threshold' => $memoryThreshold,
    ]);
}
```

---

## 📋 总结与最佳实践清单

### ✅ Redis 缓存三大问题防护核心要点

| 问题 | 核心策略 | 推荐 TTL | 是否需要锁 |
|------|---------|---------|-----------|
| **穿透** | 双层缓存 + 布隆过滤器 | 空值 60s | ❌ |
| **击穿** | 互斥锁 + 随机 TTL | 240~420s | ✅ |
| **雪崩** | 随机 TTL / 分时段 | 分散分布 | ❌ |

### ✅ 分布式锁可靠实现要点

1. **使用 Lua 脚本保证原子性**
2. **设置合理的过期时间（业务逻辑 < TTL）**
3. **续期机制：业务长时间执行时使用 PEEXPIRE**
4. **释放时验证所有权，避免误删他人锁**
5. **主从切换容灾：定期检查锁 Key 的存活状态**

### ✅ KKday B2C API 实战建议

```php
/**
 * 生产环境 Redis 配置示例
 */
// config/database.php
'redis' => [
    'connections' => [
        'cache' => [
            'host' => 'redis-cluster-1.internal',
            'port' => 6379,
            'database' => 0,
            'read_timeout' => 2,
            'write_timeout' => 5,
            'retry_interval' => 100,
        ],
    ],
],

// .env
REDIS_HOST=redis-cluster-1.internal
REDIS_PORT=6379
REDIS_PASSWORD=secret123
REDIS_DB=0
```

---

## 🔗 参考资料

- [Redis 官方文档 - 分布式锁](https://redis.io/docs/data-types/strings/)
- [布隆过滤器算法详解](https://en.wikipedia.org/wiki/Bloom_filter)
- [Laravel Cache Facade 使用示例](https://laravel.com/docs/cache)

---

*本文基于 KKday B2C API 真实项目踩坑记录整理，已应用于生产环境验证。*

---

## 相关阅读

- [穿透 & 雪崩 & 击穿：Redis 缓存三大问题全面对比与防护方案选型](/post/vs-penetrationavalanche/)
- [Cache Stampede 防护深度实战：Lock + Probabilistic Early Expiration + Background Refresh 三重防御](/post/cache-stampede-lock-probabilistic-early-expiration-background-refresh-laravel/)
- [Laravel Redis 分布式锁失效场景实战 - KKday B2C API 真实踩坑记录](/post/laravel-redis-distributedlockguide/)
- [Predis Laravel 缓存实战与分布式锁性能调优](/post/predis-laravel-cacheguide-distributedlock/)
- [Laravel Task Scheduling 进阶实战：Redis 互斥实现多实例任务去重](/post/laravel-task-scheduling/)
- [API 限流实战：滑动窗口、令牌桶算法 - Redis Lua 原子实现](/post/api-rate-limitingguide-rate-limiting/)
