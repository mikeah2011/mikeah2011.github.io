---
title: Redis缓存雪崩
tags: [redis, 缓存, 高并发, laravel]
categories:
  - database
date: 2019-03-20 15:05:07
description: 'Redis缓存雪崩是指大量缓存key在同一时间集中过期，或Redis节点宕机，导致海量请求瞬间穿透到数据库，造成数据库压力骤增甚至宕机的严重故障。本文深入分析缓存雪崩的成因、危害场景（如Redis重启、大促活动），并提供基于Laravel的完整解决方案，包括随机TTL、多级缓存、熔断降级、Lua脚本、Redis集群高可用配置等实战代码示例，帮助开发者构建高并发场景下的缓存防护体系。'
cover: /images/covers/databases-1-cover.jpg
images:
  - /images/content/databases-1-content-1.jpg
  - /images/content/databases-1-content-2.jpg

---

当某一个时刻出现大规模的缓存失效的情况，那么就会导致大量的请求直接打在数据库上面，导致数据库压力巨大，如果在高并发的情况下，可能瞬间就会导致数据库宕机。这时候如果运维马上又重启数据库，马上又会有新的流量把数据库打死。这就是缓存雪崩。

![Redis缓存雪崩示意图](/images/covers/databases-1-cover.jpg)



**分析：**

造成缓存雪崩的关键在于在同一时间大规模的key失效。为什么会出现这个问题呢，有几种可能，第一种可能是Redis宕机，第二种可能是采用了相同的过期时间。搞清楚原因之后，那么有什么解决方案呢？

![服务器高流量压力](/images/content/databases-1-content-1.jpg)

## 缓存雪崩的详细成因分析

缓存雪崩（Cache Avalanche）本质上是缓存层大面积失效后，请求直接穿透到数据库层，导致数据库过载的现象。以下是几种典型的成因：

### 1. 大量Key同时过期

这是最常见的缓存雪崩场景。在业务开发中，很多开发者习惯性地给缓存设置相同的过期时间（比如统一设置为3600秒）。当这些缓存数据在某一个时间点同时过期时，大量请求瞬间打到数据库，造成数据库连接池耗尽、CPU飙升。

**典型场景：** 电商网站的商品列表缓存，如果1000个商品都在每天凌晨0点写入缓存且TTL为24小时，那么第二天凌晨0点这1000个缓存会同时失效。

### 2. Redis服务宕机

当Redis实例因为内存溢出（OOM）、硬件故障、网络分区等原因宕机时，所有缓存请求都会失败，应用被迫直接查询数据库。在高并发场景下，数据库通常无法承受这种突然的流量暴增。

### 3. 大促活动或热点事件

在"双十一"、"618"等大促活动开始前，大量商品缓存可能被统一预热并设置相同的过期时间。活动开始后，如果缓存集中失效，海量并发请求将直接冲击数据库。

### 4. Redis重启

Redis重启后，内存中的所有数据都会丢失。如果应用没有做任何兜底策略，重启后的Redis会导致大量缓存未命中，请求全部穿透到数据库。

---

## 解决方案

### 方案一：随机过期时间

1、在原有的失效时间上加上一个随机值，比如1-5分钟随机。这样就避免了因为采用相同的过期时间导致的缓存雪崩。

**PHP/Laravel 实现：**

```php
<?php

namespace App\Services\Cache;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Cache;

class AvalancheSafeCache
{
    /**
     * 设置缓存，自动添加随机过期时间以防止缓存雪崩
     *
     * @param string $key 缓存键
     * @param mixed $value 缓存值
     * @param int $baseTTL 基础过期时间（秒）
     * @param int $randomRange 随机范围（秒），默认300秒（5分钟）
     * @return bool
     */
    public function setWithRandomTTL(
        string $key,
        $value,
        int $baseTTL = 3600,
        int $randomRange = 300
    ): bool {
        $randomOffset = random_int(1, $randomRange);
        $actualTTL = $baseTTL + $randomOffset;

        return Cache::store('redis')->put($key, $value, $actualTTL);
    }

    /**
     * 批量设置缓存，每个key使用不同的随机TTL
     *
     * @param array $items ['key' => ['value' => mixed, 'ttl' => int]]
     * @param int $randomRange 随机偏移范围
     */
    public function batchSetWithRandomTTL(array $items, int $randomRange = 300): void
    {
        foreach ($items as $key => $item) {
            $randomOffset = random_int(1, $randomRange);
            $ttl = ($item['ttl'] ?? 3600) + $randomOffset;
            Cache::store('redis')->put($key, $item['value'], $ttl);
        }
    }
}
```

**使用Lua脚本实现原子化的随机TTL设置：**

```php
<?php

namespace App\Services\Cache;

use Illuminate\Support\Facades\Redis;

class LuaCacheService
{
    /**
     * 使用Lua脚本原子性地设置缓存和随机过期时间
     * 适用于Redis集群环境，保证操作的原子性
     */
    public function setWithLuaRandomTTL(
        string $key,
        string $value,
        int $baseTTL = 3600,
        int $randomRange = 300
    ): bool {
        $luaScript = <<<LUA
            local key = KEYS[1]
            local value = ARGV[1]
            local base_ttl = tonumber(ARGV[2])
            local random_range = tonumber(ARGV[3])
            local random_offset = math.random(1, random_range)
            local actual_ttl = base_ttl + random_offset

            redis.call('SET', key, value)
            redis.call('EXPIRE', key, actual_ttl)

            return actual_ttl
        LUA;

        $result = Redis::eval(
            $luaScript,
            1,
            $key,
            $value,
            $baseTTL,
            $randomRange
        );

        return $result > 0;
    }

    /**
     * 批量删除并重新设置缓存，用于缓存预热场景
     * 使用Lua脚本保证原子性，避免部分写入
     */
    public function bulkResetWithRandomTTL(array $cacheData): int
    {
        $luaScript = <<<LUA
            local count = 0
            for i = 1, #KEYS do
                local base_ttl = tonumber(ARGV[i * 2 - 1])
                local value = ARGV[i * 2]
                local random_offset = math.random(1, 300)
                local actual_ttl = base_ttl + random_offset

                redis.call('SET', KEYS[i], value)
                redis.call('EXPIRE', KEYS[i], actual_ttl)
                count = count + 1
            end
            return count
        LUA;

        $keys = array_keys($cacheData);
        $args = [];
        foreach ($cacheData as $item) {
            $args[] = $item['ttl'] ?? 3600;
            $args[] = $item['value'];
        }

        return Redis::eval($luaScript, count($keys), ...array_merge($keys, $args));
    }
}
```

### 方案二：熔断降级机制（Circuit Breaker）

如果真的发生了缓存雪崩，有没有什么兜底的措施？当然有——使用熔断机制。当流量到达一定的阈值时，就直接返回"系统拥挤"之类的提示，防止过多的请求打在数据库上。至少能保证一部分用户是可以正常使用，其他用户多刷新几次也能得到结果。

**基于Laravel的熔断器实现：**

```php
<?php

namespace App\Services\Cache;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class CacheCircuitBreaker
{
    // 状态常量
    const STATE_CLOSED   = 'closed';    // 正常状态
    const STATE_OPEN     = 'open';      // 熔断状态
    const STATE_HALF_OPEN = 'half_open'; // 半开状态

    private string $key;
    private int $failureThreshold;
    private int $recoveryTimeout;
    private int $halfOpenMaxAttempts;

    /**
     * @param string $name 熔断器名称
     * @param int $failureThreshold 失败次数阈值，超过则触发熔断
     * @param int $recoveryTimeout 熔断恢复时间（秒）
     * @param int $halfOpenMaxAttempts 半开状态下允许的试探次数
     */
    public function __construct(
        string $name = 'default',
        int $failureThreshold = 10,
        int $recoveryTimeout = 60,
        int $halfOpenMaxAttempts = 3
    ) {
        $this->key = "circuit_breaker:{$name}";
        $this->failureThreshold = $failureThreshold;
        $this->recoveryTimeout = $recoveryTimeout;
        $this->halfOpenMaxAttempts = $halfOpenMaxAttempts;
    }

    /**
     * 判断当前是否允许请求通过
     */
    public function isAllowed(): bool
    {
        $state = $this->getState();

        switch ($state) {
            case self::STATE_CLOSED:
                return true;

            case self::STATE_OPEN:
                // 检查是否已超过恢复时间
                $openSince = Cache::get("{$this->key}:open_since", 0);
                if (time() - $openSince >= $this->recoveryTimeout) {
                    $this->setState(self::STATE_HALF_OPEN);
                    return true; // 允许一次试探请求
                }
                return false;

            case self::STATE_HALF_OPEN:
                return true;

            default:
                return true;
        }
    }

    /**
     * 记录请求成功
     */
    public function recordSuccess(): void
    {
        if ($this->getState() === self::STATE_HALF_OPEN) {
            // 半开状态下成功，恢复正常
            $this->reset();
            Log::info('熔断器恢复正常: ' . $this->key);
        }
        // 清除失败计数
        Cache::forget("{$this->key}:failures");
    }

    /**
     * 记录请求失败
     */
    public function recordFailure(): void
    {
        $failures = Cache::get("{$this->key}:failures", 0) + 1;
        Cache::put("{$this->key}:failures", $failures, 300);

        $state = $this->getState();

        if ($state === self::STATE_HALF_OPEN) {
            // 半开状态下失败，重新熔断
            $this->trip();
            Log::warning('熔断器半开状态试探失败，重新熔断: ' . $this->key);
        } elseif ($state === self::STATE_CLOSED && $failures >= $this->failureThreshold) {
            // 闭合状态下失败次数超过阈值，触发熔断
            $this->trip();
            Log::warning("熔断器触发: {$this->key}, 失败次数: {$failures}");
        }
    }

    /**
     * 触发熔断
     */
    private function trip(): void
    {
        $this->setState(self::STATE_OPEN);
        Cache::put("{$this->key}:open_since", time(), 300);
    }

    /**
     * 重置熔断器
     */
    public function reset(): void
    {
        $this->setState(self::STATE_CLOSED);
        Cache::forget("{$this->key}:failures");
        Cache::forget("{$this->key}:open_since");
    }

    private function getState(): string
    {
        return Cache::get("{$this->key}:state", self::STATE_CLOSED);
    }

    private function setState(string $state): void
    {
        Cache::put("{$this->key}:state", $state, 300);
    }
}
```

**在Laravel中的实际使用示例：**

```php
<?php

namespace App\Services;

use App\Services\Cache\CacheCircuitBreaker;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ProductService
{
    private CacheCircuitBreaker $circuitBreaker;

    public function __construct()
    {
        $this->circuitBreaker = new CacheCircuitBreaker(
            name: 'product_cache',
            failureThreshold: 10,
            recoveryTimeout: 60
        );
    }

    /**
     * 带熔断保护的缓存读取
     */
    public function getProduct(int $id): ?array
    {
        $cacheKey = "product:{$id}";

        // 第一层：尝试从缓存获取
        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            return $cached;
        }

        // 第二层：检查熔断器状态
        if (!$this->circuitBreaker->isAllowed()) {
            Log::warning("缓存熔断中，返回降级数据: {$cacheKey}");
            return $this->getDegradedData($id);
        }

        // 第三层：尝试查询数据库
        try {
            $product = DB::table('products')
                ->where('id', $id)
                ->first();

            if ($product) {
                $data = (array) $product;
                // 使用随机TTL写入缓存
                $randomTTL = 3600 + random_int(1, 300);
                Cache::put($cacheKey, $data, $randomTTL);
                $this->circuitBreaker->recordSuccess();
                return $data;
            }

            return null;
        } catch (\Exception $e) {
            $this->circuitBreaker->recordFailure();
            Log::error("数据库查询失败: " . $e->getMessage());
            return $this->getDegradedData($id);
        }
    }

    /**
     * 降级数据：返回静态缓存或默认数据
     */
    private function getDegradedData(int $id): ?array
    {
        // 从本地文件缓存或静态缓存中获取降级数据
        return Cache::store('file')->get("degraded_product:{$id}", [
            'id' => $id,
            'name' => '商品信息暂时不可用',
            'status' => 'degraded',
        ]);
    }
}
```

### 方案三：多级缓存架构

多级缓存是防止缓存雪崩的有效手段。通过在本地缓存（如APCu/OPcache）和远程缓存（Redis）之间建立多层防线，即使Redis宕机，本地缓存仍然可以拦截大部分请求。

```php
<?php

namespace App\Services\Cache;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

class MultiLevelCache
{
    private string $prefix;
    private int $localTTL;
    private int $remoteTTL;

    /**
     * @param string $prefix 缓存键前缀
     * @param int $localTTL 本地缓存过期时间（秒）
     * @param int $remoteTTL Redis缓存过期时间（秒）
     */
    public function __construct(
        string $prefix = 'mlc',
        int $localTTL = 300,
        int $remoteTTL = 3600
    ) {
        $this->prefix = $prefix;
        $this->localTTL = $localTTL;
        $this->remoteTTL = $remoteTTL;
    }

    /**
     * 多级缓存读取：L1(本地文件) -> L2(Redis) -> L3(数据库)
     */
    public function get(string $key, callable $fallback): mixed
    {
        $fullKey = "{$this->prefix}:{$key}";

        // L1: 本地文件缓存（APCu或文件驱动）
        $l1Result = Cache::store('file')->get($fullKey);
        if ($l1Result !== null) {
            return $l1Result;
        }

        // L2: Redis缓存
        try {
            $l2Result = Redis::get($fullKey);
            if ($l2Result !== null) {
                $data = json_decode($l2Result, true);
                // 回填L1缓存
                Cache::store('file')->put($fullKey, $data, $this->localTTL);
                return $data;
            }
        } catch (\Exception $e) {
            // Redis不可用时，降级到数据库
            \Log::warning("Redis不可用，降级查询: {$key}");
        }

        // L3: 数据库回源
        $data = $fallback();

        if ($data !== null) {
            $this->set($key, $data);
        }

        return $data;
    }

    /**
     * 写入多级缓存
     */
    public function set(string $key, mixed $value): void
    {
        $fullKey = "{$this->prefix}:{$key}";
        $randomTTL = $this->remoteTTL + random_int(1, 300);

        // 写入L1
        Cache::store('file')->put($fullKey, $value, $this->localTTL);

        // 写入L2
        try {
            Redis::setex($fullKey, $randomTTL, json_encode($value));
        } catch (\Exception $e) {
            \Log::warning("Redis写入失败: {$key}");
        }
    }

    /**
     * 清除多级缓存
     */
    public function forget(string $key): void
    {
        $fullKey = "{$this->prefix}:{$key}";
        Cache::store('file')->forget($fullKey);
        try {
            Redis::del($fullKey);
        } catch (\Exception $e) {
            \Log::warning("Redis删除失败: {$key}");
        }
    }
}
```

### 方案四：Redis集群高可用配置

为了防止Redis宕机导致缓存雪崩的问题，可以搭建Redis集群，提高Redis的容灾性。

**Laravel `config/database.php` 中的Redis集群配置：**

```php
<?php
// config/database.php

'redis' => [

    'client' => 'predis',

    'options' => [
        'cluster' => 'redis',
        'prefix' => 'myapp:',
        'parameters' => [
            'password' => env('REDIS_PASSWORD', null),
        ],
    ],

    // Redis Sentinel 哨兵模式（自动故障转移）
    'sentinel' => [
        'tcp://10.0.0.1:26379?timeout=0.1',
        'tcp://10.0.0.2:26379?timeout=0.1',
        'tcp://10.0.0.3:26379?timeout=0.1',
    ],

    // Redis Cluster 集群模式
    'clusters' => [
        'default' => [
            [
                'host' => env('REDIS_HOST_1', '10.0.0.1'),
                'port' => env('REDIS_PORT', 6379),
                'database' => 0,
            ],
            [
                'host' => env('REDIS_HOST_2', '10.0.0.2'),
                'port' => env('REDIS_PORT', 6379),
                'database' => 0,
            ],
            [
                'host' => env('REDIS_HOST_3', '10.0.0.3'),
                'port' => env('REDIS_PORT', 6379),
                'database' => 0,
            ],
            [
                'host' => env('REDIS_HOST_4', '10.0.0.4'),
                'port' => env('REDIS_PORT', 6379),
                'database' => 0,
            ],
            [
                'host' => env('REDIS_HOST_5', '10.0.0.5'),
                'port' => env('REDIS_PORT', 6379),
                'database' => 0,
            ],
            [
                'host' => env('REDIS_HOST_6', '10.0.0.6'),
                'port' => env('REDIS_PORT', 6379),
                'database' => 0,
            ],
        ],
    ],
],
```

### 方案五：限流策略

在缓存雪崩发生时，限流策略可以有效保护数据库，防止请求量过大导致数据库宕机。

```php
<?php

namespace App\Services\Cache;

use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Cache;

class AvalancheRateLimiter
{
    /**
     * 带限流保护的缓存回源
     * 当缓存未命中时，限制同时查询数据库的请求数
     */
    public function getWithRateLimit(
        string $key,
        callable $queryDatabase,
        int $maxConcurrentQueries = 100,
        int $windowSeconds = 60
    ): mixed {
        // 先查缓存
        $cached = Cache::get($key);
        if ($cached !== null) {
            return $cached;
        }

        // 检查限流
        $limiterKey = "avalanche_limit:" . md5($key);
        if (RateLimiter::tooManyAttempts($limiterKey, $maxConcurrentQueries)) {
            // 超过限流阈值，返回降级数据
            return $this->getFallbackData($key);
        }

        // 递增计数
        RateLimiter::hit($limiterKey, $windowSeconds);

        try {
            $data = $queryDatabase();

            if ($data !== null) {
                $randomTTL = 3600 + random_int(1, 300);
                Cache::put($key, $data, $randomTTL);
            }

            return $data;
        } finally {
            RateLimiter::clear($limiterKey);
        }
    }

    /**
     * 返回降级数据
     */
    private function getFallbackData(string $key): mixed
    {
        // 尝试从二级缓存获取
        $degraded = Cache::store('file')->get("degraded:{$key}");
        if ($degraded !== null) {
            return $degraded;
        }
        return null;
    }
}
```

### 方案六：缓存预热

提高数据库的容灾能力，可以使用分库分表，读写分离的策略。同时，在应用启动或大促活动前主动预热缓存。

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use App\Services\Cache\AvalancheSafeCache;

class CacheWarmUp extends Command
{
    protected $signature = 'cache:warm-up {--type=all : 预热类型 (all/hot/products/users)}';
    protected $description = '缓存预热：在应用启动或大促活动前主动加载热点数据到Redis';

    public function handle(): int
    {
        $type = $this->option('type');
        $this->info("开始缓存预热，类型: {$type}");

        $startTime = microtime(true);

        switch ($type) {
            case 'products':
            case 'all':
                $this->warmUpProducts();
                if ($type !== 'all') break;
                // fall through
            case 'users':
            case 'all':
                $this->warmUpUserConfig();
                break;
            case 'hot':
                $this->warmUpHotData();
                break;
        }

        $elapsed = round(microtime(true) - $startTime, 2);
        $this->info("缓存预热完成，耗时: {$elapsed}秒");

        return Command::SUCCESS;
    }

    /**
     * 预热商品缓存
     */
    private function warmUpProducts(): void
    {
        $this->line('正在预热商品数据...');
        $cacheService = new AvalancheSafeCache();

        $products = DB::table('products')
            ->where('status', 'active')
            ->orderBy('sales', 'desc')
            ->limit(10000)
            ->get();

        $bar = $this->output->createProgressBar($products->count());
        $bar->start();

        foreach ($products as $product) {
            $cacheService->setWithRandomTTL(
                "product:{$product->id}",
                (array) $product,
                3600, // 基础TTL 1小时
                300   // 随机范围5分钟
            );
            $bar->advance();
        }

        $bar->finish();
        $this->newLine();
        $this->info("商品缓存预热完成，共 {$products->count()} 条");
    }

    /**
     * 预热用户配置缓存
     */
    private function warmUpUserConfig(): void
    {
        $this->line('正在预热用户配置...');

        $configs = DB::table('user_configs')
            ->where('updated_at', '>=', now()->subDays(30))
            ->get();

        foreach ($configs as $config) {
            $randomTTL = 7200 + random_int(1, 600);
            Cache::put(
                "user_config:{$config->user_id}",
                (array) $config,
                $randomTTL
            );
        }

        $this->info("用户配置预热完成，共 {$configs->count()} 条");
    }

    /**
     * 预热热点数据
     */
    private function warmUpHotData(): void
    {
        $this->line('正在预热热点数据...');

        // 预热热搜词
        $hotKeywords = DB::table('search_logs')
            ->select('keyword', DB::raw('COUNT(*) as cnt'))
            ->where('created_at', '>=', now()->subHours(24))
            ->groupBy('keyword')
            ->orderByDesc('cnt')
            ->limit(100)
            ->pluck('keyword');

        Cache::put('hot_keywords', $hotKeywords->toArray(), 1800 + random_int(1, 120));

        $this->info('热点数据预热完成');
    }
}
```

**注册定时任务：**

```php
<?php
// app/Console/Kernel.php

protected function schedule(Schedule $schedule): void
{
    // 每天凌晨3点执行缓存预热（避开业务高峰）
    $schedule->command('cache:warm-up --type=all')
        ->dailyAt('03:00')
        ->withoutOverlapping()
        ->appendOutputTo(storage_path('logs/cache-warmup.log'));

    // 大促活动前手动预热
    // php artisan cache:warm-up --type=hot
}
```

---

## 策略对比表

下表对比了各种防缓存雪崩方案的优缺点和适用场景：

| 策略 | 实现复杂度 | 效果 | 适用场景 | 优点 | 缺点 |
|------|-----------|------|---------|------|------|
| **随机TTL** | ⭐ 低 | ⭐⭐⭐ 中 | 缓存集中写入场景 | 实现简单，无额外依赖 | 无法应对Redis宕机 |
| **多级缓存** | ⭐⭐⭐ 高 | ⭐⭐⭐⭐ 高 | 高并发读取场景 | 多层防线，容灾能力强 | 数据一致性难保证，内存占用大 |
| **熔断降级** | ⭐⭐ 中 | ⭐⭐⭐⭐ 高 | 数据库保护场景 | 快速失败，保护数据库 | 用户体验会下降 |
| **缓存预热** | ⭐⭐ 中 | ⭐⭐⭐⭐ 高 | 大促、重启场景 | 主动防御，效果好 | 需要预知热点数据 |
| **限流策略** | ⭐⭐ 中 | ⭐⭐⭐ 中 | 突发流量场景 | 控制数据库压力 | 部分请求会被拒绝 |
| **Redis集群** | ⭐⭐⭐ 高 | ⭐⭐⭐⭐⭐ 极高 | 生产环境必选 | 高可用，自动故障转移 | 运维成本高，硬件成本高 |

---

## 真实场景分析

### 场景一：Redis重启后的缓存雪崩

**发生过程：**

1. Redis因内存溢出（OOM）被系统kill或手动重启
2. 重启后内存为空，所有缓存请求返回`null`
3. 海量并发请求瞬间穿透到MySQL
4. MySQL连接池被打满（默认`max_connections=151`）
5. 后续请求全部超时，应用开始报5xx错误
6. 运维重启MySQL，但新的请求继续涌入，形成恶性循环

**防御方案：**
- 使用Redis持久化（AOF + RDB）加速数据恢复
- 部署Redis Sentinel或Redis Cluster实现自动故障转移
- 应用层增加本地缓存降级
- 启用熔断器，数据库连接数超限后返回降级页面

### 场景二：电商"双十一"零点缓存雪崩

**发生过程：**

1. 活动前一周，运营批量创建活动商品并统一设置缓存TTL为7天
2. 双十一零点，7天前预热的商品缓存集中过期
3. 零点抢购开始，每秒数万请求直接打到数据库
4. 数据库CPU瞬间100%，大量请求超时
5. 用户看到"系统繁忙"，不断刷新加重负载

**防御方案：**
- 使用`CacheWarmUp`命令在活动前1小时重新预热
- 所有缓存使用随机TTL（`baseTTL + random(1, 300)`）
- 开启限流，每秒最多放行N个数据库查询
- 准备降级方案：返回静态页面或CDN缓存内容

### 场景三：代码部署导致的缓存雪崩

**发生过程：**

1. 新版本代码修改了缓存key的命名规则（如加了版本号前缀）
2. 部署后所有旧缓存key失效，新key缓存为空
3. 流量高峰期间大量请求回源数据库

**防御方案：**
- 使用`php artisan cache:warm-up`在部署后立即预热
- 新旧版本缓存key保持兼容，渐进式迁移
- 部署时采用蓝绿部署或金丝雀发布策略

---

## 监控与告警：Prometheus + Grafana

预防缓存雪崩只是第一步，**实时监控**才能在问题发生前发出预警。以下是一套基于Prometheus和Grafana的完整监控方案。

### Redis关键指标采集

**Laravel应用中暴露Prometheus指标（使用`spatie/laravel-prometheus-exporter`）：**

```php
<?php

// app/Prometheus/CacheMetricsCollector.php

namespace App\Prometheus;

use Prometheus\CollectorRegistry;
use Illuminate\Support\Facades\Redis;

class CacheMetricsCollector
{
    /**
     * 采集缓存雪崩相关指标，注册到Prometheus
     */
    public function collect(): void
    {
        $registry = app(CollectorRegistry::class);

        // 1. 缓存命中率
        $hitCounter = $registry->registerCounter(
            'cache',
            'avalanche_hits_total',
            'Total cache hit requests'
        );
        $missCounter = $registry->registerCounter(
            'cache',
            'avalanche_misses_total',
            'Total cache miss requests'
        );

        // 2. 批量过期检测：统计5分钟内即将过期的key数量
        $expiringGauge = $registry->registerGauge(
            'cache',
            'keys_expiring_soon',
            'Number of keys expiring within 5 minutes'
        );

        // 3. Redis连接健康状态
        $redisUpGauge = $registry->registerGauge(
            'redis',
            'up',
            'Redis server availability (1=up, 0=down)'
        );

        // 4. 数据库回源QPS（穿透量）
        $dbFallbackCounter = $registry->registerCounter(
            'cache',
            'db_fallback_total',
            'Total requests falling back to database'
        );

        try {
            $redisUpGauge->set(1);

            // 检测5分钟内即将过期的key数量（使用SCAN避免阻塞）
            $sampledKeys = 1000;
            $expiringCount = 0;
            $iterator = null;

            do {
                [$iterator, $keys] = Redis::scan($iterator, ['count' => 200]);
                if ($keys) {
                    foreach ($keys as $key) {
                        $ttl = Redis::ttl($key);
                        if ($ttl > 0 && $ttl <= 300) {
                            $expiringCount++;
                        }
                    }
                    $sampledKeys -= count($keys);
                }
            } while ($iterator !== 0 && $sampledKeys > 0);

            $expiringGauge->set($expiringCount);

        } catch (\Exception $e) {
            $redisUpGauge->set(0);
        }
    }
}
```

### Prometheus告警规则配置

```yaml
# prometheus/alerts/cache-avalanche.yml
groups:
  - name: cache_avalanche_alerts
    rules:
      # 告警1：缓存命中率骤降（可能预示雪崩）
      - alert: CacheHitRateCritical
        expr: |
          rate(cache_avalanche_hits_total[5m])
          / (rate(cache_avalanche_hits_total[5m]) + rate(cache_avalanche_misses_total[5m]))
          < 0.7
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "缓存命中率低于70%，可能正在发生缓存雪崩"
          description: "当前缓存命中率: {{ $value | humanizePercentage }}"
          runbook_url: "https://wiki.internal/runbook/cache-avalanche"

      # 告警2：大量key即将集中过期
      - alert: MassExpiryDetected
        expr: cache_keys_expiring_soon > 500
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "检测到500+个key将在5分钟内过期"
          description: "即将过期的key数量: {{ $value }}，建议提前续期"

      # 告警3：数据库回源量突增
      - alert: DatabaseFallbackSpike
        expr: rate(cache_db_fallback_total[2m]) > 100
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "数据库回源QPS超过100，雪崩风险极高"
          description: "当前回源速率: {{ $value }}/s"

      # 告警4：Redis实例不可用
      - alert: RedisDown
        expr: redis_up == 0
        for: 10s
        labels:
          severity: critical
        annotations:
          summary: "Redis实例不可用，缓存全部失效"
          description: "Redis实例已宕机，请立即检查"

      # 告警5：Redis内存使用率过高（可能导致OOM宕机）
      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis内存使用率超过90%，有OOM风险"
          description: "当前内存使用: {{ $value | humanizePercentage }}"
```

### Grafana Dashboard JSON（核心面板）

```json
{
  "dashboard": {
    "title": "缓存雪崩监控大盘",
    "panels": [
      {
        "title": "缓存命中率",
        "type": "stat",
        "targets": [{
          "expr": "rate(cache_avalanche_hits_total[5m]) / (rate(cache_avalanche_hits_total[5m]) + rate(cache_avalanche_misses_total[5m]))",
          "legendFormat": "命中率"
        }],
        "thresholds": {
          "steps": [
            {"color": "red", "value": 0},
            {"color": "yellow", "value": 0.7},
            {"color": "green", "value": 0.9}
          ]
        }
      },
      {
        "title": "数据库回源QPS",
        "type": "graph",
        "targets": [{
          "expr": "rate(cache_db_fallback_total[1m])",
          "legendFormat": "回源QPS"
        }]
      },
      {
        "title": "5分钟内即将过期的Key数量",
        "type": "graph",
        "targets": [{
          "expr": "cache_keys_expiring_soon",
          "legendFormat": "即将过期Key"
        }]
      },
      {
        "title": "Redis可用性",
        "type": "stat",
        "targets": [{
          "expr": "redis_up",
          "legendFormat": "Redis状态"
        }]
      }
    ]
  }
}
```

---

## 总结

缓存雪崩是高并发系统中的常见问题，最佳实践是**多种策略组合使用**：

1. **基础防护：** 所有缓存使用随机TTL，避免集中过期
2. **架构防护：** 部署Redis Cluster + 本地多级缓存
3. **流量防护：** 熔断器 + 限流策略保护数据库
4. **运维防护：** 定时缓存预热 + 部署后缓存预热
5. **兜底防护：** 降级方案返回静态数据或缓存页面

通过以上策略的综合运用，可以有效防止缓存雪崩对系统造成的冲击，保障高并发场景下的服务稳定性。

![分布式集群架构](/images/content/databases-1-content-2.jpg)

---

## 相关阅读

- [Redis高并发](/categories/Databases/high-concurrency/)
- [数据库读写分离实战](/categories/Databases/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication/)
- [MySQL分库分表实战](/categories/Databases/sharding-30-repos/)
- [Redis缓存击穿（Cache Breakdown）](/categories/Databases/databases/cache-breakdown/)
- [Redis缓存穿透（Cache Penetration）](/categories/Databases/databases/cache-penetration/)
- [Redis缓存策略完全指南](/categories/Databases/databases/redis-guide-cache/)
- [缓存穿透 vs 缓存雪崩对比分析](/categories/Databases/databases/vs-penetrationavalanche/)
- [Redis缓存三大问题：穿透、击穿、雪崩](/categories/Databases/databases/redis-guidecache-penetrationbreakdownavalanche/)
