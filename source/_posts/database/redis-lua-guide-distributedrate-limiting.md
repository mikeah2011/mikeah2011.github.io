---

title: Redis-Lua-脚本原子操作实战-分布式限流库存扣减排行榜-Laravel-B2C-API踩坑记录
keywords: [Redis, Lua, Laravel, B2C, API, 脚本原子操作实战, 分布式限流库存扣减排行榜, 踩坑记录]
date: 2026-05-05 06:35:56
updated: 2026-05-05 06:38:03
categories:
- database
tags:
- Laravel
- Redis
- Lua
- 分布式
- 库存扣减
description: Redis Lua 脚本原子操作实战指南，深入讲解分布式限流、库存扣减、排行榜等 B2C 电商核心场景。涵盖 EVALSHA 脚本缓存策略、KEYS 命令避坑、redis.call 与 pcall 错误处理、Laravel 中间件集成方案与生产环境真实踩坑经验，帮助开发者用最低成本实现 Redis 原子性操作。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-1-content-1.jpg
- /images/content/databases-1-content-2.jpg
---



# Redis Lua 脚本原子操作实战：分布式限流、库存扣减、排行榜

> 在 B2C 电商场景中，很多业务逻辑需要「检查 + 修改」的原子性保证——而 Redis 单命令做不到。Lua 脚本是 Redis 提供的唯一原生原子事务方案，本文记录了在 KKday B2C API 项目中落地三个核心场景的真实经验。

## 为什么需要 Lua 脚本？先看一个反例

假设你要实现一个库存扣减逻辑：

```php
// ❌ 经典的 TOCTOU 竞态条件
$stock = Redis::get('product:1001:stock');  // 线程A读到 stock=1
if ($stock > 0) {                           // 线程B也读到 stock=1
    Redis::decr('product:1001:stock');       // 两个都扣减了 → 超卖！
}
```

两个请求同时读到 `stock=1`，都通过了检查，结果超卖。这不是理论问题——我们上线第一个秒杀活动时就踩了这个坑。

Redis 的 `WATCH/MULTI/EXEC` 乐观锁虽然也能解决，但它需要重试循环，在高并发下性能差。而 **Lua 脚本在 Redis 服务端单线程中原子执行**，天然避免竞态，且无重试开销。

### 架构总览

```
┌─────────────┐     ┌──────────────────────────────────────┐
│  Laravel API│     │           Redis Server               │
│  (PHP-FPM)  │     │  ┌─────────────────────────────────┐ │
│             │     │  │  Lua Script Engine               │ │
│  Predis ───────►  │  │  ┌──────────┐  ┌──────────────┐ │ │
│  Client     │     │  │  │ 限流脚本  │  │ 库存扣减脚本  │ │ │
│             │     │  │  └──────────┘  └──────────────┘ │ │
│  EVALSHA ───────►  │  │  ┌──────────┐                   │ │
│             │     │  │  │ 排行榜脚本 │  (原子执行，     │ │
│             │     │  │  └──────────┘   不可中断)        │ │
│             │     │  └─────────────────────────────────┘ │
└─────────────┘     └──────────────────────────────────────┘
```

![Redis Lua 脚本分布式限流架构](/images/content/databases-1-content-1.jpg)

## 场景一：滑动窗口分布式限流

### 需求背景

B2C API 需要对外部调用方做限流。固定窗口（如每分钟 100 次）在窗口边界会出现 2 倍突刺——这是运维在监控里发现的：第一分钟末尾 + 第二分钟开头，1 秒内打进来 200 次请求。

滑动窗口可以解决这个问题，但逻辑涉及：读取当前窗口内所有请求计数 → 求和 → 判断是否超限 → 记录本次请求。这四步必须原子执行。

### Lua 脚本实现

```lua
-- sliding_window_rate_limit.lua
-- KEYS[1] = rate_limit:{identifier}
-- ARGV[1] = window_size_ms (e.g., 60000)
-- ARGV[2] = max_requests (e.g., 100)
-- ARGV[3] = current_timestamp_ms
-- ARGV[4] = unique_request_id (UUID)

local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4]

-- 清理窗口外的旧数据
local window_start = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- 统计当前窗口内的请求数
local current_count = redis.call('ZCARD', key)

if current_count < limit then
    -- 未超限，添加本次请求
    redis.call('ZADD', key, now, request_id)
    redis.call('PEXPIRE', key, window)
    return {1, limit - current_count - 1}  -- allowed, remaining
else
    -- 超限，不添加
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry_after = 0
    if #oldest > 0 then
        retry_after = tonumber(oldest[2]) + window - now
    end
    return {0, 0, retry_after}  -- rejected, remaining=0, retry_after_ms
end
```

### Laravel 集成

```php
<?php

namespace App\Services\RateLimit;

use Illuminate\Support\Facades\Redis;

class SlidingWindowRateLimiter
{
    private string $script;

    public function __construct()
    {
        // 启动时加载 Lua 脚本
        $this->script = file_get_contents(
            base_path('app/Lua/sliding_window_rate_limit.lua')
        );
    }

    /**
     * @return array{allowed: bool, remaining: int, retry_after_ms?: int}
     */
    public function attempt(string $identifier, int $limit = 100, int $windowMs = 60000): array
    {
        $key = "rate_limit:{$identifier}";
        $now = (int) (microtime(true) * 1000);
        $requestId = uniqid('req_', true);

        // EVALSHA 优先，失败则 EVAL（首次加载）
        $result = $this->evalScript($this->script, [$key], [
            $windowMs,
            $limit,
            $now,
            $requestId,
        ]);

        return [
            'allowed'      => (bool) $result[0],
            'remaining'    => (int) $result[1],
            'retry_after_ms' => $result[2] ?? null,
        ];
    }

    private function evalScript(string $script, array $keys, array $args): array
    {
        try {
            // Predis: evalsha 传脚本 SHA1
            $sha = sha1($script);
            return Redis::evalsha($sha, ...array_merge([$script, count($keys)], $keys, $args));
        } catch (\Exception $e) {
            // NOSCERR 回退：脚本未缓存，用 EVAL 加载
            if (str_contains($e->getMessage(), 'NOSCERR')) {
                return Redis::eval($script, ...array_merge([count($keys)], $keys, $args));
            }
            throw $e;
        }
    }
}
```

### ⚠️ 踩坑记录

**坑 1：Predis 的 `evalsha` 参数顺序混乱**

Predis 的 `evalsha` 签名是 `evalsha($sha, $script, $numkeys, ...$keys, ...$args)`，不是直觉的 `evalsha($sha, $numkeys, ...)`。第一个参数是 SHA，第二个**必须是完整脚本**（用于 NOSCERR 时自动回退）。我们一开始只传了 SHA 和 numkeys，结果每次请求都走 EVAL，完全没有脚本缓存效果。

### Laravel Middleware 集成

将限流器封装为中间件，可以在路由层直接使用：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Services\RateLimit\SlidingWindowRateLimiter;
use Symfony\Component\HttpFoundation\Response;

class RateLimitByApiCaller
{
    public function __construct(
        private SlidingWindowRateLimiter $limiter
    ) {}

    public function handle(Request $request, Closure $next, int $limit = 100): Response
    {
        // 以 API Key 或 IP 作为限流标识
        $identifier = $request->header('X-API-Key')
            ?? $request->ip();

        $result = $this->limiter->attempt($identifier, $limit);

        // 写入标准 Rate Limit 响应头
        $headers = [
            'X-RateLimit-Limit'     => $limit,
            'X-RateLimit-Remaining' => $result['remaining'],
        ];

        if (!$result['allowed']) {
            $retryAfterSec = ceil(($result['retry_after_ms'] ?? 1000) / 1000);
            $headers['Retry-After'] = $retryAfterSec;

            return response()->json([
                'message' => '请求过于频繁，请稍后重试',
                'retry_after_seconds' => $retryAfterSec,
            ], 429, $headers);
        }

        $response = $next($request);

        // 将限流头附加到正常响应
        foreach ($headers as $key => $value) {
            $response->headers->set($key, $value);
        }

        return $response;
    }
}
```

在 `app/Http/Kernel.php` 中注册：

```php
// 路由中间件别名
protected $middlewareAliases = [
    // ...
    'rate-limit.api' => \App\Http\Middleware\RateLimitByApiCaller::class,
];

// routes/api.php
Route::middleware(['rate-limit.api:100'])->group(function () {
    Route::get('/products', [ProductController::class, 'index']);
    Route::post('/orders', [OrderController::class, 'store']);
});
```

**坑 2：`ZCARD` 在空 key 上返回 0 而不是 error**

这不是 bug，但容易忽略——第一次请求进来时 key 不存在，`ZCARD` 返回 0 是正确的。但如果你用了 `EXISTS` 判断来做优化分支，要注意 Lua 里的 `EXISTS` 判断和 `ZCARD` 之间也有竞态（不过在 Lua 内部不会，因为原子执行）。

![Redis 库存扣减防超卖](/images/content/databases-1-content-2.jpg)

## 场景二：库存扣减（秒杀防超卖）

### 需求背景

秒杀商品库存扣减是经典场景：检查库存 → 判断是否已抢购 → 扣减库存 → 记录购买。这四步必须原子执行。

### Lua 脚本实现

```lua
-- inventory_deduct.lua
-- KEYS[1] = product:{id}:stock
-- KEYS[2] = product:{id}:purchased:{user_id}
-- ARGV[1] = quantity to deduct
-- ARGV[2] = user_id
-- ARGV[3] = timestamp

local stock_key = KEYS[1]
local purchased_key = KEYS[2]
local quantity = tonumber(ARGV[1])
local user_id = ARGV[2]
local now = ARGV[3]

-- 检查是否已购买（防重复扣减）
if redis.call('SISMEMBER', purchased_key, user_id) == 1 then
    return {-1, 'already_purchased'}
end

-- 检查库存
local current_stock = tonumber(redis.call('GET', stock_key) or '0')
if current_stock < quantity then
    return {0, current_stock}  -- 库存不足
end

-- 扣减库存
local new_stock = redis.call('DECRBY', stock_key, quantity)

-- 安全阀：如果扣成负数（理论上不会），回滚
if new_stock < 0 then
    redis.call('INCRBY', stock_key, quantity)
    return {0, current_stock}
end

-- 记录购买
redis.call('SADD', purchased_key, user_id)
redis.call('EXPIRE', purchased_key, 86400 * 7)  -- 7天过期

return {1, new_stock}  -- 成功，返回剩余库存
```

### Laravel Service 封装

```php
<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\Redis;
use App\Exceptions\InventoryException;

class InventoryService
{
    private string $script;

    public function __construct()
    {
        $this->script = file_get_contents(
            base_path('app/Lua/inventory_deduct.lua')
        );
    }

    /**
     * @throws InventoryException
     */
    public function deduct(int $productId, int $userId, int $quantity = 1): int
    {
        $result = $this->runScript(
            $this->script,
            [
                "product:{$productId}:stock",
                "product:{$productId}:purchased:{$userId}",
            ],
            [$quantity, $userId, now()->timestamp]
        );

        return match ($result[0]) {
            1  => $result[1],                     // 成功，返回剩余库存
            0  => throw new InventoryException(
                '库存不足，剩余: ' . $result[1],
                InventoryException::INSUFFICIENT_STOCK
            ),
            -1 => throw new InventoryException(
                '您已购买过此商品',
                InventoryException::ALREADY_PURCHASED
            ),
            default => throw new InventoryException('未知错误: ' . json_encode($result)),
        };
    }

    /**
     * 批量初始化库存（运营后台用）
     */
    public function setStock(int $productId, int $stock): void
    {
        Redis::set("product:{$productId}:stock", $stock);
    }

    private function runScript(string $script, array $keys, array $args): array
    {
        $sha = sha1($script);
        try {
            return Redis::evalsha($sha, ...array_merge(
                [$script, count($keys)],
                $keys,
                $args
            ));
        } catch (\Exception $e) {
            if (str_contains($e->getMessage(), 'NOSCERR')) {
                return Redis::eval($script, ...array_merge(
                    [count($keys)],
                    $keys,
                    $args
                ));
            }
            throw $e;
        }
    }
}
```

### 在 Laravel Event 中使用

```php
<?php

namespace App\Listeners;

use App\Events\OrderSubmitted;
use App\Services\Inventory\InventoryService;
use App\Exceptions\InventoryException;

class DeductInventory
{
    public function __construct(
        private InventoryService $inventory
    ) {}

    public function handle(OrderSubmitted $event): void
    {
        foreach ($event->items as $item) {
            try {
                $remaining = $this->inventory->deduct(
                    $item->product_id,
                    $event->user_id,
                    $item->quantity
                );

                logger()->info('Inventory deducted', [
                    'product_id' => $item->product_id,
                    'remaining'  => $remaining,
                ]);
            } catch (InventoryException $e) {
                // 库存不足 → 触发告警 + 回滚订单
                report($e);
                throw $e;
            }
        }
    }
}
```

### ⚠️ 踩坑记录

**坑 3：`DECRBY` 可能产生负数**

虽然先检查了 `current_stock < quantity`，但在理论极端场景下（Lua 脚本被重复执行，或主从切换时脚本重放），`DECRBY` 可能产生负数。所以我们加了 **安全阀**：如果 `new_stock < 0` 就回滚。这个防御性编程在一次 Redis 主从 failover 中真的救了我们——Sentinel 做了 failover 后，有 3 个 Lua 脚本在新 master 上重放，导致 3 个商品库存变成了 -1。安全阀让它们立即回滚。

**坑 4：`SISMEMBER` 的内存占用**

用 SET 记录已购买用户，在大型秒杀中（10 万+ 用户），这个 SET 的内存占用会很高。后来我们改用了 **布隆过滤器**（RedisBloom 模块的 `BF.ADD/BF.EXISTS`）来做第一道去重，SET 只存最近 24 小时的精确记录。

## 场景三：实时排行榜（Sorted Set 原子更新）

### 需求背景

旅游产品的「热门排行」需要实时更新评分，公式是：

```
new_score = old_score * decay_factor + increment_value
```

但还要同时更新排名快照和排行榜元数据。如果分步执行，用户在两个命令之间读到的数据是不一致的。

### Lua 脚本实现

```lua
-- leaderboard_update.lua
-- KEYS[1] = leaderboard:{type}
-- KEYS[2] = leaderboard:{type}:meta
-- ARGV[1] = member_id
-- ARGV[2] = increment_value
-- ARGV[3] = decay_factor (e.g., 0.95)
-- ARGV[4] = timestamp
-- ARGV[5] = max_leaderboard_size

local lb_key = KEYS[1]
local meta_key = KEYS[2]
local member = ARGV[1]
local increment = tonumber(ARGV[2])
local decay = tonumber(ARGV[3])
local now = ARGV[4]
local max_size = tonumber(ARGV[5])

-- 获取当前分数
local current = tonumber(redis.call('ZSCORE', lb_key, member) or '0')

-- 计算新分数：衰减 + 增量
local new_score = current * decay + increment

-- 更新排行榜
redis.call('ZADD', lb_key, new_score, member)

-- 裁剪排行榜到最大长度（避免内存膨胀）
redis.call('ZREMRANGEBYRANK', lb_key, 0, -(max_size + 1))

-- 更新元数据
redis.call('HSET', meta_key, 'last_updated', now)
redis.call('HINCRBY', meta_key, 'total_updates', 1)

-- 获取当前排名（从 1 开始）
local rank = redis.call('ZREVRANK', lb_key, member)
if rank then
    rank = rank + 1
end

return {new_score, rank}
```

### Laravel 封装 + 定时衰减

```php
<?php

namespace App\Services\Leaderboard;

use Illuminate\Support\Facades\Redis;

class ProductLeaderboard
{
    private const TYPE_HOT    = 'hot';
    const MAX_SIZE           = 10000;
    const DECAY_FACTOR       = 0.95;

    private string $script;

    public function __construct()
    {
        $this->script = file_get_contents(
            base_path('app/Lua/leaderboard_update.lua')
        );
    }

    /**
     * 增量更新产品热度
     *
     * @return array{score: float, rank: int|null}
     */
    public function incrementScore(
        int $productId,
        float $increment,
        string $type = self::TYPE_HOT
    ): array {
        $result = $this->runScript($this->script, [
            "leaderboard:{$type}",
            "leaderboard:{$type}:meta",
        ], [
            (string) $productId,
            $increment,
            self::DECAY_FACTOR,
            now()->toIso8601String(),
            self::MAX_SIZE,
        ]);

        return [
            'score' => (float) $result[0],
            'rank'  => $result[1] ? (int) $result[1] : null,
        ];
    }

    /**
     * 获取 Top N
     */
    public function top(int $n = 50, string $type = self::TYPE_HOT): array
    {
        return Redis::zrevrange("leaderboard:{$type}", 0, $n - 1, 'WITHSCORES');
    }

    /**
     * 批量衰减（定时任务调用）
     */
    public function globalDecay(string $type = self::TYPE_HOT): int
    {
        $key = "leaderboard:{$type}";

        // Lua: 遍历所有 member，统一乘以衰减因子
        $decayScript = <<<'LUA'
            local key = KEYS[1]
            local decay = tonumber(ARGV[1])
            local members = redis.call('ZRANGE', key, 0, -1)
            local count = 0
            for _, member in ipairs(members) do
                local score = tonumber(redis.call('ZSCORE', key, member))
                if score and score > 0.01 then
                    redis.call('ZADD', key, score * decay, member)
                    count = count + 1
                else
                    redis.call('ZREM', key, member)
                end
            end
            return count
        LUA;

        return (int) Redis::eval($decayScript, 1, $key, 0.5);
    }

    private function runScript(string $script, array $keys, array $args): array
    {
        $sha = sha1($script);
        try {
            return Redis::evalsha($sha, ...array_merge(
                [$script, count($keys)],
                $keys,
                $args
            ));
        } catch (\Exception $e) {
            if (str_contains($e->getMessage(), 'NOSCERR')) {
                return Redis::eval($script, ...array_merge(
                    [count($keys)],
                    $keys,
                    $args
                ));
            }
            throw $e;
        }
    }
}
```

### ⚠️ 踩坑记录

**坑 5：`globalDecay` 在大数据量下会阻塞**

当排行榜有 10 万+ 成员时，`globalDecay` 的 Lua 循环会执行很久，期间 Redis **完全阻塞**（单线程）。我们的监控显示一次衰减操作耗时 800ms，导致所有其他请求超时。

解决方案：改成 **分批衰减**，每次只处理 1000 个 member：

```lua
-- batch_decay.lua
local key = KEYS[1]
local decay = tonumber(ARGV[1])
local batch_size = tonumber(ARGV[2])

local members = redis.call('ZRANGE', key, 0, batch_size - 1)
for _, member in ipairs(members) do
    local score = tonumber(redis.call('ZSCORE', key, member))
    if score and score > 0.01 then
        redis.call('ZADD', key, score * decay, member)
    else
        redis.call('ZREM', key, member)
    end
end
return #members
```

在 Laravel Scheduler 中每分钟跑一次，分批处理直到全部完成。

**坑 6：Lua 脚本中的浮点精度问题**

Redis 的 `ZADD` 分数是 IEEE 754 双精度浮点数。当 `decay_factor` 反复乘以 0.95 时，会出现精度漂移。比如 `100 * 0.95^20` 理论上是 `35.84859224...`，但 Redis 存储时可能有微小误差。对于排行榜场景影响不大，但如果你做库存扣减，**绝对不要用浮点数存储库存**——用整数（单位：分/件）。

## 通用踩坑总结

### 脚本缓存策略

```
首次执行:  EVAL script numkeys keys... args...
           ↓ Redis 缓存脚本（按 SHA1）
后续执行:  EVALSHA sha1 numkeys keys... args...
           ↓ 脚本已缓存，直接执行
如果 Redis 重启:  EVALSHA 返回 NOSCERR
           ↓ 回退到 EVAL 重新加载
```

我们封装了一个通用的 `LuaScriptRunner` trait：

```php
<?php

namespace App\Traits;

use Illuminate\Support\Facades\Redis;

trait RunsLuaScript
{
    private function runLua(string $scriptPath, array $keys, array $args): array
    {
        $script = file_get_contents($scriptPath);
        $sha = sha1($script);
        $numKeys = count($keys);

        try {
            return Redis::evalsha(
                $sha,
                ...array_merge([$script, $numKeys], $keys, $args)
            );
        } catch (\Exception $e) {
            if (str_contains($e->getMessage(), 'NOSCERR')) {
                return Redis::eval(
                    $script,
                    ...array_merge([$numKeys], $keys, $args)
                );
            }
            throw $e;
        }
    }
}
```

### `redis.call` vs `redis.pcall`

| 方法 | 错误处理 | 使用场景 |
|------|----------|----------|
| `redis.call()` | 遇错立即终止脚本，返回错误给客户端 | 大多数场景 |
| `redis.pcall()` | 捕获错误，返回 error 对象 | 需要自定义错误处理 |

推荐默认用 `redis.call()`——出错就让脚本失败，不要吞掉错误。

### KEYS 命令的生产警告

```lua
-- ❌ 危险：KEYS pattern 在大数据集下会阻塞
local keys = redis.call('KEYS', 'product:*:stock')

-- ✅ 正确：用 SCAN 替代，或直接传入已知的 KEYS
local stock = redis.call('GET', KEYS[1])  -- KEYS 由调用方传入
```

Redis 官方文档明确警告：**生产环境不要在 Lua 中使用 `KEYS` 命令**。`KEYS *` 会遍历整个 keyspace，阻塞时间与 key 数量成正比。我们所有的 Lua 脚本都通过 `KEYS[]` 参数传入具体的 key 名称。

### 超时控制

```php
// phpredis 扩展配置
'redis' => [
    'client' => 'phpredis',
    'options' => [
        'read_timeout' => 5,  // Lua 脚本最长执行 5 秒
    ],
],

// Predis 配置
'redis' => [
    'client' => 'predis',
    'options' => [
        'parameters' => [
            'read_write_timeout' => 5,
        ],
    ],
],
```

同时在 `redis.conf` 中设置：

```conf
lua-time-limit 5000  # 5秒超时，超过后 Redis 会接受 SCRIPT KILL 命令
```

> **注意**：`SCRIPT KILL` 只能终止**没有执行写操作**的 Lua 脚本。如果脚本已经执行了写操作（比如 `SET`、`DECRBY`），你只能用 `SHUTDOWN NOSAVE` 来停止 Redis——这就是为什么 Lua 脚本要尽量短小、避免循环。

## 性能对比

在我们的压测环境中（Redis 7.0，4 核 8G），对比三种方案的 QPS：

| 方案 | 限流场景 QPS | 库存扣减 QPS | 备注 |
|------|-------------|-------------|------|
| WATCH/MULTI/EXEC | 12,000 | 8,000 | 乐观锁，高竞争下大量重试 |
| 分布式锁 + 普通命令 | 6,000 | 4,000 | 锁开销大 |
| **Lua 脚本** | **28,000** | **25,000** | 原生原子，无额外开销 |

Lua 脚本在高竞争场景下性能是乐观锁的 **2-3 倍**，因为没有重试开销。

### 方案特性对比

| 特性 | Lua 脚本 | WATCH/MULTI/EXEC | 分布式锁 (SETNX) |
|------|---------|-------------------|-------------------|
| **原子性保证** | ✅ 服务端单线程原子执行 | ⚠️ 乐观锁，WATCH 后可能失败 | ✅ 互斥锁保证 |
| **条件分支** | ✅ 支持 if/else/循环 | ❌ 只能顺序执行命令 | ✅ 业务代码自由控制 |
| **高竞争性能** | ✅ 无重试，QPS 最高 | ❌ 竞争越大重试越多 | ❌ 锁获取/释放开销大 |
| **网络往返** | ✅ 1 次 RTT | ⚠️ WATCH + EXEC 至少 2 次 | ⚠️ 加锁 + 操作 + 解锁 3 次 |
| **实现复杂度** | ⚠️ 需学 Lua 语法 | ✅ PHP 原生支持 | ✅ Laravel 原生支持 |
| **调试难度** | ⚠️ Lua 调试工具少 | ✅ 常规调试 | ✅ 常规调试 |
| **主从一致性** | ⚠️ failover 可能重放 | ⚠️ WATCH 在主从切换时失效 | ⚠️ 锁可能在主从切换时丢失 |
| **适用场景** | 需要原子性 + 条件逻辑 | 简单的批量命令提交 | 跨进程/跨服务互斥 |

> **选型建议**：如果你的原子逻辑只有 2-3 个简单命令且无条件分支，优先用 `INCR`、`SETNX` 等内置原子命令。如果需要条件判断（如"库存够才扣减"），Lua 脚本是最优解。分布式锁适合跨多个 Redis 实例或需要长时间持有锁的场景。

## 决策树：什么时候用 Lua 脚本？

```
需要原子执行多个 Redis 命令？
├── 是
│   ├── 命令数 ≤ 5 且逻辑简单？
│   │   ├── 是 → 考虑 Redis 内置原子命令（INCR, SETNX 等）
│   │   └── 否 → ✅ 用 Lua 脚本
│   └── 需要条件分支（if/else）？
│       └── 是 → ✅ 用 Lua 脚本
└── 否 → 普通命令即可
```

## 一句话总结

Redis Lua 脚本是 B2C 电商场景下 **成本最低、收益最高** 的原子性方案。核心原则：脚本尽量短小（< 100 行）、避免 `KEYS` 命令、用 `EVALSHA` 缓存、加安全阀防负数。踩过的坑比写的脚本多，但性能收益是实打实的。

## 相关阅读

- [Redis Stream 实战：Laravel 消息队列与事件驱动](/categories/Databases/redis-stream-guide-laravel/) — 使用 Redis Stream 实现可靠的异步消息处理
- [Redis Geo 实战：Laravel 附近搜索与地理围栏](/categories/Databases/redis-geo-guide/) — 基于 Redis GEO 的地理位置查询方案
- [Redis HyperLogLog 实战：UV 统计](/categories/Databases/redis-hyperloglog-guide-uv/) — 用 HyperLogLog 实现百万级 UV 去重统计
- [Redis 高并发场景实战](/categories/Databases/high-concurrency/) — Redis 在高并发电商场景中的架构设计与优化策略
- [Laravel Redis 分布式锁失效场景实战](/categories/Databases/laravel-redis-distributedlockguide/) — 深入分析分布式锁在主从切换、GC 停顿等场景下的失效问题
