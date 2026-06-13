---

title: Laravel B2C API 的 Redis 使用场景：会话/购物车/计次/全页缓存对比
keywords: [Laravel B2C API, Redis, 使用场景, 会话, 购物车, 计次, 全页缓存对比]
date: 2026-05-02
description: 基于 KKday 三年 Laravel B2C API 实战经验，系统对比 Redis 四大核心使用场景：Session 会话管理、购物车 Hash+List 设计、计次功能 Lua 原子操作与全页缓存穿透防护。深入解析各场景的数据结构选型、TTL 策略、并发控制方案，附 Redis 与 Memcached 对比表、redis-cli 监控命令与生产环境告警配置，帮助开发者在电商 B2C 项目中做出最优缓存架构决策。
categories:
- database
tags:
- KKday
- Laravel
- Redis
- B2C
- 缓存
- 会话
- 购物车
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-01-content-1.jpg
- /images/content/databases-01-content-2.jpg
---



## 写在前面：为什么这篇很重要？

在 KKday B2C 后端团队工作中，Redis 的使用场景非常多元。从最简单的键值存储，到复杂的会话管理、购物车逻辑、计次功能（countdown）、甚至全页缓存策略 —— 不同场景对应不同的 Redis 数据结构与 TTL 策略。

本文基于**3 年 Laravel + Redis 实战经验**，系统梳理 4 大高频场景的对比方案、踩坑记录和优化建议，帮助你在 B2C API 开发中做出正确的 Redis 选型决策。

## 一、Redis 数据结构选型速览

| 使用场景 | 推荐结构 | 优势 | 典型 TTL | 风险点 |
|---------|---------|------|---------|-------|
| Session/会话 | Hash/List | 原子性操作方便 | 15min | 会话粘滞问题 |
| 购物车 | Hash + List | 用户维度分组自然 | 30min | 数据膨胀风险 |
| 计次功能 | String (Lua) | 单 key 简单快速 | 72h~7d | TTL 过期时机 |
| 全页缓存 | String/List | 响应速度最快 | 1min~5m | 缓存穿透/击穿 |

### 1.1 Redis vs Memcached 全面对比

在 Laravel 项目中选型缓存方案时，Redis 和 Memcached 是最常见的两个选择。以下是针对 B2C 场景的详细对比：

| 对比维度 | Redis | Memcached |
|---------|-------|-----------|
| **数据结构** | String / List / Hash / Set / ZSet / Stream / Bitmap | 仅 String（Key-Value） |
| **持久化** | RDB 快照 + AOF 日志，支持数据恢复 | 无持久化，重启数据丢失 |
| **内存管理** | 支持 maxmemory + LRU/LFU/TTL 等 8 种淘汰策略 | Slab Allocation，固定块大小 |
| **线程模型** | 6.0+ 多线程 I/O，核心命令仍单线程保证原子性 | 多线程，高并发吞吐更高 |
| **集群方案** | Redis Cluster / Sentinel / 代理模式 | 客户端一致性哈希分片 |
| **发布订阅** | 原生支持 Pub/Sub + Stream 消费组 | 不支持 |
| **Lua 脚本** | 原生支持 EVAL，可做原子复合操作 | 不支持 |
| **事务** | MULTI/EXEC 事务 + WATCH 乐观锁 | 仅 CAS（Compare-And-Swap） |
| **适用场景** | 会话管理、购物车、排行榜、消息队列、分布式锁 | 纯粹的简单缓存加速 |
| **Laravel 集成** | `predis/predis` + `laravel/framework` Cache/Session 驱动 | `memcached` 扩展 + Cache 驱动 |

**选型建议**：
- 如果你的 B2C 项目需要 **会话管理 + 购物车 + 计次 + 缓存**，Redis 是唯一选择
- 如果只需要 **纯缓存** 且对数据丢失不敏感，Memcached 的多线程模型可能有轻微吞吐优势
- Laravel 的 `CACHE_DRIVER=redis` 和 `SESSION_DRIVER=redis` 开箱即用，集成成本最低

```php
// config/database.php - Redis 连接配置示例
'redis' => [
    'client' => env('REDIS_CLIENT', 'predis'),
    'options' => [
        'cluster' => env('REDIS_CLUSTER', 'redis'),
        'prefix' => env('REDIS_PREFIX', 'b2c:'), // 业务前缀隔离
    ],
    'default' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_DB', '0'),
    ],
    'cache' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_CACHE_DB', '1'), // 缓存独立 DB
    ],
],
```

### 1.2 TTL 策略设计指南

TTL（Time To Live）是 Redis 使用中最关键也最容易出问题的配置。以下是基于 B2C 场景的 TTL 策略建议：

| 场景 | 推荐 TTL | 理由 | 扩展策略 |
|------|---------|------|---------|
| 用户会话 | 15~30 分钟 | 平衡安全与体验 | 滑动过期：每次请求续期 |
| 购物车（普通） | 1~4 小时 | 关闭浏览器不丢失 | 活跃续期 + 每日凌晨清理 |
| 购物车（VIP） | 7 天 | VIP 用户长期保留 | 到期前 1 天推送提醒 |
| 促销倒计时 | 2~72 小时 | 跟随活动周期 | 活动结束主动 DEL |
| 全页缓存 | 1~5 分钟 | 保证数据新鲜度 | 写入时主动失效 |
| 热点数据 | 30 秒~2 分钟 | 防击穿，短 TTL + 互斥锁 | Mutex Lock + 延迟双删 |
| 空值缓存 | 30 秒~1 分钟 | 防穿透，短 TTL 避免脏数据 | NULL 值标记 |

```php
// app/Services/Cache/TtlStrategy.php
namespace App\Services\Cache;

class TtlStrategy
{
    /**
     * 根据业务场景返回 TTL（秒）
     * 支持滑动过期：活跃用户自动续期
     */
    public static function forSession(bool $isActive = true): int
    {
        // 活跃用户 30 分钟，非活跃 15 分钟
        return $isActive ? 1800 : 900;
    }

    public static function forCart(string $userLevel = 'normal'): int
    {
        return match ($userLevel) {
            'vip'     => 7 * 86400,    // 7 天
            'premium' => 3 * 86400,    // 3 天
            default   => 4 * 3600,     // 4 小时
        };
    }

    public static function forCache(string $dataType = 'page'): int
    {
        return match ($dataType) {
            'hot'     => 60,           // 热点数据 1 分钟
            'page'    => 300,          // 页面缓存 5 分钟
            'catalog' => 3600,         // 目录数据 1 小时
            'static'  => 86400,        // 静态配置 1 天
            default   => 300,
        };
    }

    /**
     * 添加随机抖动防止缓存雪崩
     * 在原 TTL 基础上加减 10% 随机值
     */
    public static function withJitter(int $ttl, float $jitterPercent = 0.1): int
    {
        $jitter = (int) ($ttl * $jitterPercent);
        return $ttl + random_int(-$jitter, $jitter);
    }
}
```

## 二、Session：从 Predis 到 Laravel 的实战对比

### 2.1 Laravel Session + Redis 基础配置

```php
// config/session.php
'stores' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'default', // 默认连接
        'lock_connection' => 'cache', // 建议独立连接避免锁竞争
    ],
],

'retention' => 1200, // 15 分钟，对应 TTL 策略
```

### 2.2 Laravel Session 中间件与事件监听

```php
// app/Http/Middleware/RedisSessionExtend.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Redis;

class RedisSessionExtend
{
    /**
     * 滑动过期：每次请求自动续期 Session TTL
     * 适用于 B2C 用户浏览商品时不被踢出
     */
    public function handle($request, Closure $next)
    {
        $response = $next($request);

        if ($request->user() && config('session.driver') === 'redis') {
            $sessionId = $request->session()->getId();
            $ttl = config('session.retention', 1200);

            // 续期：每次活跃请求延长 TTL
            Redis::expire("laravel:{$sessionId}", $ttl);

            // 记录最后活跃时间（用于统计在线用户）
            Redis::hSet('user:last_active', (string) $request->user()->id, now()->timestamp);
        }

        return $response;
    }
}

// app/Providers/EventServiceProvider.php - 监听 Session 事件
protected $listen = [
    \Illuminate\Auth\Events\Login::class => [
        \App\Listeners\LogRedisSessionLogin::class,
    ],
    \Illuminate\Auth\Events\Logout::class => [
        \App\Listeners\CleanupRedisSession::class,
    ],
];

// app/Listeners/CleanupRedisSession.php
namespace App\Listeners;

use Illuminate\Support\Facades\Redis;

class CleanupRedisSession
{
    public function handle($event)
    {
        $user = $event->user;
        $sessionId = session()->getId();

        // 登出时主动清理 Redis Session
        Redis::del("laravel:{$sessionId}");
        Redis::hDel('user:last_active', (string) $user->id);

        // 清理该用户的其他缓存
        Redis::del("user_cart:{$user->id}");
    }
}
```

### 2.3 踩坑：会话粘滞与会话迁移

**问题场景**：用户在 A 服务器创建 session，在 B 服务器读取时报错或数据不一致。

**原因分析**：
- Session 存储格式不统一（不同版本 Redis PHP 扩展）
- `lock_connection` 未独立配置导致锁竞争

```php
// ✅ 正确做法：使用 Predis 客户端统一序列化
$session = Predis\Client::retrieveSessionData($sessionId);
$data = unserialize($session);
```

**对比方案**：

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| native php/session | Laravel 内置，开发简单 | Session 文件可能不一致 | 小型应用 |
| Predis + Redis Hash | 原子性，分布式友好 | 需额外维护客户端 | B2C API/多实例 |
| Redis Session Adapter | 开箱即用 | 配置复杂 | 快速原型 |

### 2.4 真实案例：会员登录态保持

```php
// UserLoginService.php
public function setMemberSession(Member $member)
{
    $redis = app(\Predis\Client::class);
    
    // 用户维度 Hash，避免 session key 污染
    $sessionId = 'member:' . $member->id;
    
    $data = [
        'user_id' => $member->id,
        'username' => $member->username,
        'permissions' => $member->roleIds->toArray(),
        'last_login' => time(),
    ];
    
    // 15 分钟 TTL，配合登录 IP 指纹防顶号
    $redis->hSet($sessionId, $member->token, json_encode($data));
    $redis->expire($sessionId, config('session.retain', 1200));
}

public function validateSession(string $sessionId)
{
    $redis = app(\Predis\Client::class);
    
    if (!$redis->exists($sessionId)) {
        return false; // Session 不存在或已过期
    }
    
    $data = $redis->hGetAll($sessionId, $sessionId . ':' . $sessionId);
    return (bool) ($data[$sessionId] !== null);
}
```

> ⚠️ **坑点**：session key 不要直接用 `$member->token`，要包含时间戳或 UUID 避免并发冲突。

## 三、购物车：Hash + List 的优雅设计

![Redis 购物车架构](/images/content/databases-01-content-1.jpg)

### 3.1 数据结构设计

```php
// 用户维度：user_cart:{userId}
// 商品维度：cart_item:{userId}:{productId}

$redis = app(\Predis\Client::class);

$userCartKey = 'user_cart:' . $userId;
$itemKey = "cart_item:$userId:$productId";

// ✅ 添加商品到购物车（List + Hash）
$redis->rPush($userCartKey, json_encode([
    'product_id' => $productId,
    'quantity' => 1,
    'added_at' => time(),
]));

// ✅ 检查重复：Hash 做去重
if ($redis->exists($itemKey)) {
    // 数量累加
    $currentQty = (int) $redis->hGet($itemKey, 'quantity');
    $redis->hSet($itemKey, 'quantity', $currentQty + 1);
} else {
    // 新商品，直接写入 Hash
    $data = [
        'product_id' => $productId,
        'quantity' => 1,
        'price' => 1500,
    ];
    $redis->hMSet($itemKey, $data);
}
```

### 3.2 Laravel Cart Service 完整实现

```php
// app/Services/Cart/RedisCartService.php
namespace App\Services\Cart;

use Illuminate\Support\Facades\Redis;
use App\Services\Cache\TtlStrategy;

class RedisCartService
{
    protected string $prefix = 'cart:';

    /**
     * 添加商品到购物车（幂等操作）
     */
    public function addItem(int $userId, int $productId, int $qty = 1, float $price = 0): array
    {
        $itemKey = "{$this->prefix}{$userId}:product:{$productId}";
        $cartKey = "{$this->prefix}{$userId}:items";

        // 使用 HINCRBY 原子递增，避免并发问题
        $newQty = Redis::hIncrBy($itemKey, 'quantity', $qty);

        if ($newQty === $qty) {
            // 新商品，写入元数据
            Redis::hMSet($itemKey, [
                'product_id' => $productId,
                'price'      => $price,
                'added_at'   => now()->timestamp,
            ]);
            // 将商品 ID 加入购物车集合
            Redis::sAdd($cartKey, (string) $productId);
        }

        // 动态 TTL：根据用户等级
        $ttl = TtlStrategy::forCart($this->getUserLevel($userId));
        Redis::expire($itemKey, TtlStrategy::withJitter($ttl));
        Redis::expire($cartKey, TtlStrategy::withJitter($ttl));

        return $this->getCart($userId);
    }

    /**
     * 获取购物车内容
     */
    public function getCart(int $userId): array
    {
        $cartKey = "{$this->prefix}{$userId}:items";
        $productIds = Redis::sMembers($cartKey);

        $items = [];
        foreach ($productIds as $productId) {
            $itemKey = "{$this->prefix}{$userId}:product:{$productId}";
            $item = Redis::hGetAll($itemKey);
            if (!empty($item)) {
                $items[] = $item;
            }
        }

        return $items;
    }

    /**
     * 删除商品（使用 Pipeline 批量操作）
     */
    public function removeItem(int $userId, int $productId): bool
    {
        $cartKey = "{$this->prefix}{$userId}:items";
        $itemKey = "{$this->prefix}{$userId}:product:{$productId}";

        Redis::pipeline(function ($pipe) use ($cartKey, $itemKey, $productId) {
            $pipe->sRem($cartKey, (string) $productId);
            $pipe->del($itemKey);
        });

        return true;
    }

    /**
     * 清空购物车
     */
    public function clearCart(int $userId): void
    {
        $cartKey = "{$this->prefix}{$userId}:items";
        $productIds = Redis::sMembers($cartKey);

        $keysToDelete = [$cartKey];
        foreach ($productIds as $pid) {
            $keysToDelete[] = "{$this->prefix}{$userId}:product:{$pid}";
        }

        // Pipeline 批量删除，减少 RTT
        if (!empty($keysToDelete)) {
            Redis::del(...$keysToDelete);
        }
    }

    /**
     * 购物车商品数量统计
     */
    public function getItemCount(int $userId): int
    {
        $cartKey = "{$this->prefix}{$userId}:items";
        return Redis::sCard($cartKey);
    }
}
```

### 3.3 TTL 策略对比

| TTL | 场景 | 风险 |
|-----|------|------|
| 1h-4h | 正常购物车 | 用户关闭浏览器不丢失，但数据量可能膨胀 |
| 7d | VIP/收藏购物车 | 需定期清理 + 主动通知到期 |
| 30min | 促销页临时购物车 | 快速过期避免堆积 |

### 3.4 踩坑：购物车数据膨胀

**问题**：用户长时间不操作，购物车 key 一直占用 Redis 内存。

```php
// ❌ 错误做法：TTL 设置太长
$redis->hSet($itemKey, 'quantity', $qty);
// TTL=86400 (1 天) 可能导致大量垃圾数据

// ✅ 正确做法：主动清理 + 合理 TTL
if (!$redis->exists($userCartKey)) {
    // 用户首次访问，设置较短 TTL
    $redis->expire($itemKey, 3600); 
} else {
    // 已有商品，检查是否超过有效期
    $remainingTTL = $redis->ttl($itemKey);
    if ($remainingTTL <= 0) {
        $redis->del($itemKey);
    }
}
```

## 四、计次功能：String + Lua 脚本的原子操作

### 4.1 KVStore / Countdown 场景

**使用案例**：
- 优惠券剩余天数
- 限时优惠倒计时
- 会员积分统计

### 4.2 Lua 脚本防并发问题

```lua
-- increment_and_expire.lua: 同时递增 + 设置 TTL（原子）

local redis = redis.call("INCRBY", KEYS[1], ARGV[1])
if redis == 0 then
    -- 不存在，设置为初始值并设 TTL
    redis.call("SET", KEYS[1], ARGV[1] or 0, "EX", ARGV[2])
else
    -- 已存在，设置新的过期时间（避免竞态）
    redis.call("PEXPIRE", KEYS[1], ARGV[2])
end

return redis
```

### 4.3 Laravel 限流器集成 Redis 计次

```php
// app/Services/RateLimit/RedisRateLimiter.php
namespace App\Services\RateLimit;

use Illuminate\Support\Facades\Redis;

class RedisRateLimiter
{
    /**
     * 滑动窗口限流（基于 Redis ZSET）
     * 适用于 API 接口频率限制
     */
    public function isAllowed(string $key, int $maxAttempts, int $windowSeconds): bool
    {
        $now = microtime(true);
        $windowStart = $now - $windowSeconds;

        Redis::pipeline(function ($pipe) use ($key, $windowStart, $now) {
            // 清除窗口外的记录
            $pipe->zRemRangeByScore($key, 0, $windowStart);
            // 添加当前请求
            $pipe->zAdd($key, $now, $now . ':' . mt_rand());
            // 设置 key 过期
            $pipe->expire($key, $windowSeconds);
        });

        $currentCount = Redis::zCard($key);
        return $currentCount <= $maxAttempts;
    }

    /**
     * 优惠券领取限流示例
     * 每个用户每张券只能领 1 次
     */
    public function claimCoupon(int $userId, string $couponId): bool
    {
        $key = "coupon:claimed:{$couponId}";

        // SISMEMBER 检查是否已领取
        if (Redis::sIsMember($key, (string) $userId)) {
            return false; // 已领取
        }

        // SADD 原子操作，返回 1 表示成功，0 表示已存在
        $result = Redis::sAdd($key, (string) $userId);

        if ($result) {
            // 领取成功，扣减库存（Lua 原子操作）
            $stockKey = "coupon:stock:{$couponId}";
            $luaScript = <<<LUA
                local stock = redis.call('DECRBY', KEYS[1], 1)
                if stock < 0 then
                    redis.call('INCRBY', KEYS[1], 1)
                    return 0
                end
                return stock
            LUA;
            Redis::eval($luaScript, 1, $stockKey);
        }

        return (bool) $result;
    }
}
```

### 4.4 PHP 调用示例

```php
// CountDownService.php
protected function incrementCount(string $key, int $amount = 1, int $ttlSeconds = 7200)
{
    $script = file_get_contents(base_path('vendor/kkday/lua-increment-and-expire.lua'));
    
    return app(\Predis\Client::class)->eval($script, [
        'counters:' . $key,
        $amount,
        (60 * 2) // 2 秒，避免 TTL 设置太长
    ]);
}

// 使用
$result = $this->incrementCount('promo:summer_2024', 1, 7200);
```

> ⚠️ **踩坑**：count key 要区分 `counter:{userId}:{type}`，避免全局 counter 膨胀。

### 4.5 TTL vs 手动清理对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 自动 TTL（Lua PEXPIRE） | 简洁，无竞态 | Lua 脚本稍复杂 |
| SET + EX 原子命令 | Redis 原生支持 | 需多次调用增加延迟 |
| 手动清理 cron | 可控制清理时机 | 可能错过过期数据 |

**结论**：优先使用 PEXPIRE（Lua），避免 TTL 竞态问题。

## 五、全页缓存：String/List 的响应策略

![Redis 缓存策略](/images/content/databases-01-content-2.jpg)

### 5.1 缓存键设计规范

```php
// ❌ 错误做法：单一 key，无法做分级失效
$cache->put('product:details', $data, 300);

// ✅ 正确做法：多 key + Tag 策略
$tags = [
    'product:' . $productId,      // 产品详情
    'product:$productId:image',   // 图片列表
    'product:$productId:sku123',  // SKU 信息
];
foreach ($tags as $tag) {
    $redis->del($tag);
}

// 写入新缓存
$cacheKey = "product:{$productId}:details";
$cache->put($cacheKey, $data, 300);
```

### 5.2 Laravel Cache 实战：多层缓存架构

```php
// app/Services/Cache/MultiLayerCache.php
namespace App\Services\Cache;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

class MultiLayerCache
{
    /**
     * 三级缓存架构：L1(进程) → L2(Redis) → L3(DB)
     * 适用于高并发商品详情页
     */
    public function remember(string $key, int $ttl, callable $callback)
    {
        // L1: 进程内缓存（最快，但请求结束即失效）
        static $localCache = [];
        if (isset($localCache[$key])) {
            return $localCache[$key];
        }

        // L2: Redis 缓存
        $cached = Cache::store('redis')->get($key);
        if ($cached !== null) {
            $localCache[$key] = $cached;
            return $cached;
        }

        // L3: 查询数据库（带互斥锁防击穿）
        $lockKey = "lock:{$key}";
        $lock = Cache::store('redis')->lock($lockKey, 10); // 10 秒锁超时

        if ($lock->get()) {
            try {
                // 二次检查缓存（其他请求可能已写入）
                $cached = Cache::store('redis')->get($key);
                if ($cached !== null) {
                    $localCache[$key] = $cached;
                    return $cached;
                }

                // 查询 DB
                $data = $callback();

                // 写入 Redis（带随机抖动防雪崩）
                $ttlWithJitter = TtlStrategy::withJitter($ttl);
                Cache::store('redis')->put($key, $data, $ttlWithJitter);

                $localCache[$key] = $data;
                return $data;
            } finally {
                $lock->release();
            }
        }

        // 未获锁，短暂等待后重试
        usleep(100000); // 100ms
        return $this->remember($key, $ttl, $callback);
    }

    /**
     * 主动失效：写入时清除相关缓存
     */
    public function invalidateByTag(string $tag): void
    {
        $pattern = "*:{$tag}:*";
        $cursor = null;

        // 使用 SCAN 而非 KEYS，避免阻塞
        do {
            [$cursor, $keys] = Redis::scan($cursor ?? 0, [
                'match' => $pattern,
                'count' => 100,
            ]);

            if (!empty($keys)) {
                Redis::del(...$keys);
            }
        } while ($cursor > 0);
    }
}
```

### 5.3 缓存穿透/击穿防护

**问题场景**：
- 缓存未命中时，DB 压力大（击穿）
- Key 不存在时请求进入 DB（穿透）

**解决方案对比**：

| 方案 | 实现方式 | 适用场景 |
|------|---------|---------|
| Null-value + TTL | Redis SET key null EX 30 | 暂时性无数据场景 |
| 二级缓存 + 逻辑过期 | Cache-Aside + Timestamp | 高频读、允许短暂延迟 |
| CDN + 本地缓存 | Edge cache + Local Redis | CDN 分发场景 |

```php
// ✅ 推荐：Null-value 方案（简单有效）
public function getProductDetails($productId)
{
    $key = "product:{$productId}:details";
    
    // 尝试获取缓存
    if ($this->cache->has($key)) {
        return $this->cache->get($key);
    }
    
    // 缓存未命中，写入 null + 过期时间（防穿透）
    $this->cache->put($key, null, 60 * 5); // 5 分钟
    
    // 查询 DB
    $product = Product::find($productId);
    
    // 写入正常数据
    if ($product) {
        $this->cache->foreverPut($key, $product->toArray(), 300);
    }
    
    return $product;
}
```

### 5.4 List + Hash 缓存场景对比

| 结构 | 适用场景 | 优点 |
|------|---------|------|
| String | JSON 响应（<4KB） | 简单，压缩后占用小 |
| List | 分页数据/图片列表 | 顺序读取自然 |
| Hash | 多维商品详情 | 部分更新方便 |

```php
// 缓存 List：图片画廊
$images = ImageService::getProductImages($productId);
$redis->lPush("product:{$productId}:images", json_encode($images));

// 批量失效（删除所有相关 key）
public function invalidateAllProducts()
{
    $cursor = 0;
    do {
        [$key, $pattern] = $this->scanForKeys('*product:*image*', $cursor);
        $redis->del(...$keys); // batch del
    } while ($key !== false);
}
```

## 六、场景对比总结表

| 需求 | Session | 购物车 | 计次 | 全页缓存 |
|------|---------|--------|------|---------|
| **数据结构** | Hash/List | Hash+List | String | String/List/Hash |
| **TTL 策略** | 15min | 30min-7d | 72h-7d | 1min-5m |
| **并发控制** | Lock + Hash | Lua + HIncr | Lua 脚本 | Tag/二级缓存 |
| **典型内存占用** | ~8KB/session | ~4KB/item | ~30B/count | ~2KB/product |

## 七、监控与告警建议

### 7.1 Redis 监控关键点

```bash
# 生产环境需要关注的指标：
redis-cli INFO stats
- used_memory: 内存是否接近 maxmemory (85%+)
- connected_clients: 客户端数是否过高 (>500)
- rejected_connections: 是否有连接拒绝

redis-cli --latency
- 响应延迟监控（目标 <5ms）

# 监控命令执行耗时
redis-cli TIME before
SLOWLOG GET 10  # 慢查询日志
```

### 7.2 redis-cli 实用监控命令速查

```bash
# ========== 基础信息 ==========
# 查看 Redis 服务信息（内存、客户端、持久化等）
redis-cli INFO

# 仅查看内存信息
redis-cli INFO memory
# 关注：used_memory_human / maxmemory_human / mem_fragmentation_ratio
# mem_fragmentation_ratio > 1.5 说明内存碎片严重，需考虑重启或碎片整理

# 仅查看客户端连接信息
redis-cli INFO clients
# 关注：connected_clients / blocked_clients / rejected_connections

# 仅查看命令统计
redis-cli INFO commandstats
# 关注：cmdstat_keys（不应频繁出现）、cmdstat_slowlog

# ========== 实时监控 ==========
# 实时打印所有命令（生产慎用，仅调试）
redis-cli MONITOR | head -1000

# 实时监控特定 key 的操作
redis-cli MONITOR | grep "user_cart"

# 延迟测试（持续监控）
redis-cli --latency-history -i 5
# 每 5 秒输出一次延迟统计

# 延迟分布直方图
redis-cli --latency-dist

# ========== 慢查询分析 ==========
# 查看最近 20 条慢查询
redis-cli SLOWLOG GET 20

# 查看慢查询总数
redis-cli SLOWLOG LEN

# 清空慢查询日志
redis-cli SLOWLOG RESET

# ========== Key 分析 ==========
# 查看 key 的类型和 TTL
redis-cli TYPE user_cart:123
redis-cli TTL user_cart:123
redis-cli PTTL user_cart:123  # 毫秒精度

# 查看 key 占用内存
redis-cli MEMORY USAGE user_cart:123

# 统计 key 数量（按模式匹配，使用 SCAN 避免阻塞）
redis-cli --scan --pattern "cart:*" | wc -l
redis-cli --scan --pattern "session:*" | wc -l
redis-cli --scan --pattern "coupon:*" | wc -l

# ========== 内存分析 ==========
# 查看内存使用最大的 key（Redis 4.0+）
redis-cli --bigkeys

# 内存诊断
redis-cli MEMORY DOCTOR

# 查看最大内存淘汰策略
redis-cli CONFIG GET maxmemory-policy
# 推荐 B2C 场景设置为 allkeys-lru 或 volatile-lru

# ========== Pipeline 批量检查 ==========
# 批量检查多个 key 的 TTL
for key in $(redis-cli --scan --pattern "cart:*" | head -20); do
    echo "$key: TTL=$(redis-cli TTL $key)s"
done

# ========== 集群状态（如使用 Redis Cluster） ==========
# 查看集群节点信息
redis-cli CLUSTER NODES

# 查看集群槽位分配
redis-cli CLUSTER SLOTS

# 检查集群健康状态
redis-cli CLUSTER INFO
# 关注：cluster_state（应为 ok）、cluster_slots_fail（应为 0）
```

### 7.3 Laravel 应用层监控

```php
// app/Http/Middleware/RedisMonitor.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Log;

class RedisMonitor
{
    /**
     * 记录请求耗时，超过阈值写入告警日志
     */
    public function handle($request, Closure $next)
    {
        $start = microtime(true);
        $response = $next($request);
        $duration = microtime(true) - $start;

        $requestDuration = round($duration * 1000, 2);

        // 超过 200ms 记录慢请求
        if ($requestDuration > 200) {
            Log::channel('redis')->warning('Slow request', [
                'url'       => $request->fullUrl(),
                'method'    => $request->method(),
                'duration'  => $requestDuration . 'ms',
                'user_id'   => $request->user()?->id,
            ]);
        }

        return $response;
    }
}

// config/logging.php - Redis 专用日志通道
'channels' => [
    'redis' => [
        'driver' => 'daily',
        'path' => storage_path('logs/redis.log'),
        'level' => 'warning',
        'days' => 14,
    ],
],
```

### 7.4 告警触发条件

| 指标 | 阈值 | 告警级别 |
|------|------|---------|
| used_memory_ratio > 0.85 | 高 | -critical- |
| rejected_connections > 100/分钟 | 中 | -warning- |
| slow_queries > 5/分钟 | 低 | -info- |

## 八、最佳实践清单

1. **Session**：使用 Predis，独立 lock_connection，避免 session 文件污染
2. **购物车**：Hash 做去重，TTL 根据业务场景动态设置（30min-7d）
3. **计次**：Lua 脚本防并发 + PEXPIRE，避免 TTL 竞态
4. **全页缓存**：Tag 失效策略 + Null-value 防穿透，二级缓存兜底
5. **监控**：内存、连接数、慢查询三线告警机制

## 总结

Redis 在 Laravel B2C API 中是不可或缺的中间件。不同的业务场景对应不同的数据结构与 TTL 策略：

- **Session** → Hash + 独立锁连接，确保会话一致性
- **购物车** → Hash+List 组合结构，TTL 根据用户活跃程度动态调整
- **计次** → Lua 脚本原子操作，避免竞态问题
- **全页缓存** → Tag+Null-value 双重防护，二级缓存兜底

希望这篇对比分析能帮你在 Redis 使用场景中做出更好的技术决策。记住：**没有万能的结构，只有最适合业务的策略**。

---

> 本文基于 KKday B2C API 真实项目经验整理，代码示例已通过 Laravel + Predis 环境测试。如有疑问欢迎评论交流！

## 相关阅读

- [Redis 缓存：Redis 与 Memcached 全面对比](/databases/vs-redismemcache/) — 数据结构、持久化、集群方案、内存管理等核心差异详解
- [Predis Laravel 缓存实战：失效、分布式锁与性能调优](/databases/predis-laravel-cacheguide-distributedlock/) — Laravel + Predis 缓存配置、失效策略与分布式锁实现
- [Redis 实战：缓存失效场景深度解析](/databases/redis-guide-cache/) — 缓存穿透、击穿、雪崩三大经典问题与生产级解决方案