---

title: Redis 缓存击穿防护：互斥锁与逻辑过期策略
keywords: [Redis, 缓存击穿防护, 互斥锁与逻辑过期策略]
tags:
- Redis
- 缓存击穿
- 高并发
- 性能优化
categories:
- database
date: 2019-03-20 15:05:07
description: Redis缓存击穿是指某个热点Key在高并发访问时突然过期，导致大量请求瞬间穿透到数据库，造成数据库压力骤增甚至宕机。本文深入剖析缓存击穿的产生原理与触发流程，详细讲解互斥锁（Mutex Lock）、逻辑过期（Logical Expiration）、永不过期+异步更新三大解决方案，并提供Laravel框架下的完整实战代码。同时对比缓存穿透与缓存雪崩的区别，分享生产环境监控告警方案与踩坑经验，帮助开发者在高并发场景下构建稳健的缓存架构。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-1-content-1.jpg
- /images/content/databases-1-content-2.jpg
---



## 一、什么是缓存击穿？

缓存击穿（Cache Breakdown）是高并发系统中常见的缓存问题之一。它指的是**某个热点 Key** 在缓存中设置了过期时间，当该 Key 恰好失效的瞬间，大量并发请求同时涌入，发现缓存中已无数据，于是全部打到后端数据库上，导致数据库压力剧增，甚至可能引发宕机。

> 与缓存雪崩（大规模 Key 同时失效）不同，缓存击穿的焦点在于**单个热点 Key** 的失效。与缓存穿透（查询根本不存在的数据）不同，缓存击穿中的数据在数据库中是真实存在的。

![Redis缓存击穿示意图](/images/content/databases-1-content-1.jpg)

---

## 二、缓存击穿的原理与流程

### 2.1 正常请求流程

```
用户请求 → 查询 Redis 缓存 → 命中 → 直接返回数据
                                  ↓ 未命中
                          查询数据库 → 写入缓存 → 返回数据
```

### 2.2 缓存击穿发生流程

```
时间线：
  T0: 热点 Key "user:profile:1001" 设置 TTL = 3600s
  ...
  T3600: Key 过期被删除

  T3600+1ms: 同时涌入 10,000 个请求
      ├── 请求1: 查 Redis → 未命中 → 查数据库
      ├── 请求2: 查 Redis → 未命中 → 查数据库
      ├── ...
      └── 请求10000: 查 Redis → 未命中 → 查数据库

  结果：10,000 次数据库查询全部并发执行，数据库 CPU 飙升
```

### 2.3 为什么缓存击穿很危险？

1. **数据库连接池耗尽**：大量并发请求同时访问数据库，连接池被瞬间打满。
2. **响应延迟剧增**：数据库处理能力有限，请求排队导致超时。
3. **级联故障**：数据库压力过大可能拖垮整个微服务链路。
4. **缓存失效雪上加霜**：如果大量热点 Key 同时过期，击穿问题会叠加成雪崩。

![数据库压力分析](/images/content/databases-1-content-2.jpg)

---

## 三、缓存穿透 vs 缓存击穿 vs 缓存雪崩

这三个概念经常被混淆，下面用一张对比表格明确它们的区别：

| 对比维度 | 缓存穿透 | 缓存击穿 | 缓存雪崩 |
|---------|----------|----------|----------|
| **定义** | 查询的数据在缓存和数据库中都不存在 | 热点 Key 过期瞬间大量请求穿透 | 大量 Key 同时过期或 Redis 宕机 |
| **触发条件** | 恶意请求或业务 Bug，查询不存在的 Key | 某个热点 Key 的 TTL 到期 | 大批 Key 设置了相同的 TTL，或缓存服务崩溃 |
| **请求特征** | 每次请求都是不同的不存在 Key | 大量请求集中在同一个 Key | 大量请求分布在多个 Key |
| **影响范围** | 数据库被不存在的查询淹没 | 数据库被某个热点数据的查询淹没 | 数据库被大面积查询淹没 |
| **典型解决方案** | 布隆过滤器、缓存空值 | 互斥锁、逻辑过期 | TTL 加随机值、多级缓存、集群高可用 |
| **严重程度** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 四、解决方案一：互斥锁（Mutex Lock）

### 4.1 核心思想

当缓存失效时，不立即让所有请求都去查数据库，而是通过**分布式锁**保证同一时刻只有一个线程去查询数据库并重建缓存，其他线程等待或重试。

### 4.2 流程说明

```
请求1 → Redis未命中 → 获取锁成功 → 查DB → 写缓存 → 释放锁 → 返回
请求2 → Redis未命中 → 获取锁失败 → 等待/重试 → 缓存已写入 → 直接返回
请求3 → Redis未命中 → 获取锁失败 → 等待/重试 → 缓存已写入 → 直接返回
```

### 4.3 PHP 原生实现

```php
<?php
/**
 * 使用 Redis 互斥锁防止缓存击穿
 *
 * @param string $key     缓存 Key
 * @param int    $ttl     缓存过期时间（秒）
 * @param int    $lockTtl 锁过期时间（秒）
 * @return mixed
 */
function getCacheWithMutex(Redis $redis, string $key, int $ttl = 3600, int $lockTtl = 10)
{
    // 1. 先查缓存
    $value = $redis->get($key);
    if ($value !== false) {
        return json_decode($value, true);
    }

    // 2. 缓存未命中，尝试获取分布式锁
    $lockKey = "lock:{$key}";
    $lockValue = uniqid('mutex_', true); // 唯一标识，防止误删

    // SET NX EX：不存在才设置，并设置过期时间
    $acquired = $redis->set($lockKey, $lockValue, ['NX', 'EX' => $lockTtl]);

    if ($acquired) {
        try {
            // 3. 获取锁成功，再次检查缓存（双重检查）
            $value = $redis->get($key);
            if ($value !== false) {
                return json_decode($value, true);
            }

            // 4. 查询数据库
            $dbValue = queryFromDatabase($key);

            // 5. 写入缓存
            $redis->setex($key, $ttl, json_encode($dbValue));

            return $dbValue;
        } finally {
            // 6. 释放锁（Lua 脚本保证原子性）
            $script = "
                if redis.call('get', KEYS[1]) == ARGV[1] then
                    return redis.call('del', KEYS[1])
                else
                    return 0
                end
            ";
            $redis->eval($script, [$lockKey, $lockValue], 1);
        }
    } else {
        // 7. 获取锁失败，等待后重试
        usleep(100000); // 等待 100ms
        return getCacheWithMutex($redis, $key, $ttl, $lockTtl);
    }
}

/**
 * 模拟数据库查询
 */
function queryFromDatabase(string $key)
{
    // 实际场景中这里会查询 MySQL 等数据库
    return ['id' => 1, 'name' => '示例数据', 'key' => $key];
}

// 使用示例
$redis = new Redis();
$redis->connect('127.0.0.1', 6379);

$result = getCacheWithMutex($redis, 'hot:user:1001', 3600);
print_r($result);
```

### 4.4 互斥锁方案的优缺点

| 优点 | 缺点 |
|------|------|
| 强一致性，保证数据准确 | 等待锁的线程会阻塞，降低吞吐量 |
| 实现相对简单 | 如果锁超时但查询未完成，可能导致重复查询 |
| 适合对数据准确性要求高的场景 | 需要合理设置锁的过期时间 |

---

## 五、解决方案二：逻辑过期（Logical Expiration）

### 5.1 核心思想

不在 Redis 中设置 TTL（物理过期），而是在 Value 中存入一个逻辑过期时间字段。当发现数据逻辑过期时，**当前请求仍然返回旧数据**，同时异步触发缓存更新。这样所有请求都不会被阻塞。

### 5.2 流程说明

```
请求 → Redis命中 → 检查逻辑过期时间
                       ├── 未过期 → 直接返回
                       └── 已过期 → 尝试获取锁
                                      ├── 获取成功 → 异步更新缓存 → 返回旧数据
                                      └── 获取失败 → 直接返回旧数据
```

### 5.3 PHP 实现

```php
<?php
/**
 * 使用逻辑过期防止缓存击穿
 */

class CacheWithLogicalExpiration
{
    private Redis $redis;
    private int $lockTtl;

    public function __construct(Redis $redis, int $lockTtl = 10)
    {
        $this->redis = $redis;
        $this->lockTtl = $lockTtl;
    }

    /**
     * 写入缓存（不设物理 TTL，使用逻辑过期）
     */
    public function setWithLogicalExpiration(string $key, array $data, int $expireSeconds): void
    {
        $cacheData = [
            'data'          => $data,
            'logical_expire' => time() + $expireSeconds,
        ];
        // 永不物理过期（或设置一个很长的 TTL 作为兜底）
        $this->redis->set($key, json_encode($cacheData));
    }

    /**
     * 读取缓存（逻辑过期判断）
     */
    public function getWithLogicalExpiration(string $key, callable $dbQuery): array
    {
        $json = $this->redis->get($key);

        if ($json === false) {
            // 缓存完全不存在（首次访问），查 DB 并写入
            $data = $dbQuery();
            $this->setWithLogicalExpiration($key, $data, 3600);
            return $data;
        }

        $cacheData = json_decode($json, true);
        $now = time();

        // 判断逻辑过期
        if ($cacheData['logical_expire'] > $now) {
            // 未过期，直接返回
            return $cacheData['data'];
        }

        // 已过期，尝试获取锁进行异步更新
        $lockKey = "lock:logical:{$key}";
        $lockValue = uniqid('le_', true);
        $acquired = $this->redis->set($lockKey, $lockValue, ['NX', 'EX' => $this->lockTtl]);

        if ($acquired) {
            // 获取锁成功，异步更新缓存
            // 实际生产中可用消息队列或后台进程异步处理
            $this->asyncUpdateCache($key, $dbQuery, $lockKey, $lockValue);
        }

        // 无论是否获取锁，都先返回旧数据
        return $cacheData['data'];
    }

    /**
     * 异步更新缓存（示例中用同步模拟，生产环境建议用队列）
     */
    private function asyncUpdateCache(string $key, callable $dbQuery, string $lockKey, string $lockValue): void
    {
        // 生产环境建议投递到消息队列异步处理
        // 这里为了演示直接同步执行
        try {
            $data = $dbQuery();
            $this->setWithLogicalExpiration($key, $data, 3600);
        } finally {
            // 释放锁
            $script = "
                if redis.call('get', KEYS[1]) == ARGV[1] then
                    return redis.call('del', KEYS[1])
                else
                    return 0
                end
            ";
            $this->redis->eval($script, [$lockKey, $lockValue], 1);
        }
    }
}

// 使用示例
$redis = new Redis();
$redis->connect('127.0.0.1', 6379);

$cache = new CacheWithLogicalExpiration($redis);

$result = $cache->getWithLogicalExpiration('hot:product:5001', function () {
    // 模拟数据库查询
    return ['id' => 5001, 'name' => '热门商品', 'price' => 99.9];
});

print_r($result);
```

### 5.4 逻辑过期方案的优缺点

| 优点 | 缺点 |
|------|------|
| 零等待，所有请求立即返回 | 在缓存更新完成前，会短暂返回旧数据 |
| 不会阻塞任何线程 | 需要在 Value 中额外存储过期时间字段 |
| 适合对实时性要求不那么严格的场景 | 数据一致性较弱 |

---

## 六、解决方案三：永不过期 + 异步更新

### 6.1 核心思想

对热点 Key **不设置过期时间**，而是通过后台定时任务或事件驱动机制，在数据变更时主动更新缓存。这样从根本上避免了 Key 过期导致的击穿问题。

### 6.2 PHP 实现

```php
<?php
/**
 * 热点 Key 永不过期 + 异步更新策略
 */
class HotKeyCacheManager
{
    private Redis $redis;

    public function __construct(Redis $redis)
    {
        $this->redis = $redis;
    }

    /**
     * 获取热点 Key 的缓存（永不主动过期）
     */
    public function get(string $key, callable $dbQuery)
    {
        $value = $this->redis->get($key);

        if ($value !== false) {
            return json_decode($value, true);
        }

        // 首次访问，查 DB 并写入（不设 TTL）
        $data = $dbQuery();
        $this->redis->set($key, json_encode($data));
        return $data;
    }

    /**
     * 数据变更时主动更新缓存
     * 在数据库写操作的回调中调用此方法
     */
    public function refresh(string $key, callable $dbQuery): void
    {
        $data = $dbQuery();
        $this->redis->set($key, json_encode($data));
    }
}

// 使用示例：在 Model 的 afterUpdate 回调中
$redis = new Redis();
$redis->connect('127.0.0.1', 6379);

$cacheManager = new HotKeyCacheManager($redis);

// 读取
$data = $cacheManager->get('hot:config:global', function () {
    return fetchGlobalConfigFromDB();
});

// 数据变更时刷新（比如在 Laravel Observer 或 Model Event 中）
// $cacheManager->refresh('hot:config:global', function () {
//     return fetchGlobalConfigFromDB();
// });
```

### 6.3 定时更新策略

```php
<?php
/**
 * 定时任务：定期刷新热点 Key
 * 建议通过 Laravel Scheduler 或 Crontab 调度
 */

$hotKeys = [
    'hot:config:global'   => 'SELECT * FROM configs WHERE scope = "global"',
    'hot:product:top10'   => 'SELECT * FROM products ORDER BY sales DESC LIMIT 10',
    'hot:banner:home'     => 'SELECT * FROM banners WHERE position = "home" AND active = 1',
];

$redis = new Redis();
$redis->connect('127.0.0.1', 6379);

foreach ($hotKeys as $key => $sql) {
    // 查询数据库
    $pdo = new PDO('mysql:host=127.0.0.1;dbname=myapp', 'root', 'password');
    $stmt = $pdo->query($sql);
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 更新缓存（不设 TTL）
    $redis->set($key, json_encode($data));

    echo "Refreshed: {$key} at " . date('Y-m-d H:i:s') . PHP_EOL;
}
```

---

## 七、Laravel 实战：防止缓存击穿

### 7.1 封装缓存服务

```php
<?php
// app/Services/CacheBreakdownProtection.php

namespace App\Services;

use Illuminate\Support\Facades\Redis;
use Closure;

class CacheBreakdownProtection
{
    /**
     * 互斥锁模式获取缓存
     *
     * @param  string  $key       缓存 Key
     * @param  int     $ttl       缓存过期时间（秒）
     * @param  Closure $dbQuery   数据库查询闭包
     * @param  int     $lockTtl   锁超时时间（秒）
     * @return mixed
     */
    public static function getWithMutex(
        string $key,
        int $ttl,
        Closure $dbQuery,
        int $lockTtl = 10
    ) {
        // 1. 尝试从缓存读取
        $cacheValue = Redis::get($key);
        if ($cacheValue !== null) {
            return json_decode($cacheValue, true);
        }

        // 2. 获取分布式锁
        $lockKey = "mutex:lock:{$key}";
        $lockValue = str_replace('.', '', microtime(true) . mt_rand());

        $acquired = Redis::set($lockKey, $lockValue, 'NX', 'EX', $lockTtl);

        if ($acquired) {
            try {
                // 双重检查
                $cacheValue = Redis::get($key);
                if ($cacheValue !== null) {
                    return json_decode($cacheValue, true);
                }

                // 3. 查询数据库
                $data = $dbQuery();

                // 4. 写入缓存
                Redis::setex($key, $ttl, json_encode($data));

                return $data;
            } finally {
                // 5. Lua 原子释放锁
                $script = <<<LUA
                    if redis.call("get", KEYS[1]) == ARGV[1] then
                        return redis.call("del", KEYS[1])
                    else
                        return 0
                    end
                LUA;
                Redis::eval($script, 1, $lockKey, $lockValue);
            }
        }

        // 6. 获取锁失败，短暂等待后重试
        usleep(200000); // 200ms
        return static::getWithMutex($key, $ttl, $dbQuery, $lockTtl);
    }

    /**
     * 逻辑过期模式获取缓存
     *
     * @param  string  $key
     * @param  int     $expireSeconds  逻辑过期时间
     * @param  Closure $dbQuery
     * @return mixed
     */
    public static function getWithLogicalExpiration(
        string $key,
        int $expireSeconds,
        Closure $dbQuery
    ) {
        $json = Redis::get($key);

        if ($json === null) {
            $data = $dbQuery();
            $cacheData = [
                'data'            => $data,
                'logical_expire'  => time() + $expireSeconds,
            ];
            Redis::set($key, json_encode($cacheData));
            return $data;
        }

        $cacheData = json_decode($json, true);

        if ($cacheData['logical_expire'] > time()) {
            return $cacheData['data']; // 未过期
        }

        // 逻辑过期，尝试异步刷新
        $lockKey = "logical:lock:{$key}";
        $lockValue = str_replace('.', '', microtime(true) . mt_rand());
        $acquired = Redis::set($lockKey, $lockValue, 'NX', 'EX', 10);

        if ($acquired) {
            // 投递到队列异步更新（推荐）
            dispatch(function () use ($key, $dbQuery, $lockKey, $lockValue) {
                try {
                    $data = $dbQuery();
                    $cacheData = [
                        'data'           => $data,
                        'logical_expire' => time() + 3600,
                    ];
                    Redis::set($key, json_encode($cacheData));
                } finally {
                    $script = <<<LUA
                        if redis.call("get", KEYS[1]) == ARGV[1] then
                            return redis.call("del", KEYS[1])
                        else
                            return 0
                        end
                    LUA;
                    Redis::eval($script, 1, $lockKey, $lockValue);
                }
            });
        }

        // 返回旧数据
        return $cacheData['data'];
    }
}
```

### 7.2 在 Controller 中使用

```php
<?php
// app/Http/Controllers/ProductController.php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Services\CacheBreakdownProtection;

class ProductController extends Controller
{
    public function show(int $id)
    {
        $product = CacheBreakdownProtection::getWithMutex(
            key: "product:{$id}",
            ttl: 3600,
            dbQuery: fn () => Product::findOrFail($id)->toArray(),
        );

        return response()->json($product);
    }

    public function hotList()
    {
        $products = CacheBreakdownProtection::getWithLogicalExpiration(
            key: 'products:hot_list',
            expireSeconds: 1800,
            dbQuery: fn () => Product::orderBy('sales', 'desc')
                ->limit(20)
                ->get()
                ->toArray(),
        );

        return response()->json($products);
    }
}
```

### 7.3 使用 Laravel Cache 门面的简化方案

```php
<?php

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

// 利用 Laravel 的 Cache::lock() 实现互斥锁
$product = Cache::lock("lock:product:{$id}", 10)->block(5, function () use ($id) {
    return Cache::remember("product:{$id}", 3600, function () use ($id) {
        return Product::findOrFail($id)->toArray();
    });
});
```

---

## 八、三种方案对比

| 维度 | 互斥锁 | 逻辑过期 | 永不过期+异步更新 |
|------|--------|---------|------------------|
| **数据一致性** | ✅ 强一致 | ⚠️ 短暂不一致 | ⚠️ 取决于更新频率 |
| **响应延迟** | ⚠️ 需等待锁 | ✅ 零等待 | ✅ 零等待 |
| **实现复杂度** | 中等 | 较高 | 简单 |
| **适用场景** | 数据准确性要求高 | 容忍短暂旧数据 | 数据变更频率低 |
| **是否需要额外存储** | 否 | 需存储逻辑过期时间 | 否 |
| **推荐指数** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

**实践建议**：大多数场景推荐使用**互斥锁方案**，它在数据一致性和实现复杂度之间取得了较好的平衡。对于读多写少且允许短暂数据不一致的场景，推荐**逻辑过期方案**。

---

## 九、监控告警方案

生产环境中，及时发现缓存击穿问题至关重要。

### 9.1 关键监控指标

```php
<?php
/**
 * 缓存击穿监控中间件（简化示例）
 */
class CacheMonitor
{
    private Redis $redis;

    public function __construct(Redis $redis)
    {
        $this->redis = $redis;
    }

    /**
     * 记录缓存未命中并触发告警
     */
    public function recordMiss(string $key): void
    {
        $missKey = "monitor:cache_miss:{$key}";
        $count = $this->redis->incr($missKey);
        $this->redis->expire($missKey, 60); // 60 秒窗口

        // 60 秒内同一 Key 未命中超过 100 次，触发告警
        if ($count === 100) {
            $this->alert("缓存击穿预警：Key [{$key}] 60秒内未命中 {$count} 次！");
        }
    }

    /**
     * 记录数据库查询耗时
     */
    public function recordDbQuery(string $key, float $durationMs): void
    {
        if ($durationMs > 500) { // 超过 500ms 告警
            $this->alert("数据库慢查询：Key [{$key}] 查询耗时 {$durationMs}ms");
        }
    }

    private function alert(string $message): void
    {
        // 接入钉钉、企业微信、PagerDuty 等告警渠道
        error_log("[CACHE_ALERT] {$message} " . date('Y-m-d H:i:s'));
    }
}
```

### 9.2 Redis 监控命令

```bash
# 实时监控 Redis 命令
redis-cli monitor

# 查看慢查询日志
redis-cli SLOWLOG GET 10

# 查看 Key 命中率
redis-cli INFO stats | grep -E "keyspace_hits|keyspace_misses"

# 查看连接数
redis-cli INFO clients | grep connected_clients
```

### 9.3 推荐监控工具

- **Prometheus + Grafana**：可视化缓存命中率、QPS、延迟等指标
- **Redis Sentinel / Redis Cluster Dashboard**：Redis 集群状态监控
- **ELK Stack**：日志分析，定位缓存击穿发生的时间和 Key
- **New Relic / Datadog**：APM 工具，端到端链路追踪

---

## 十、生产环境踩坑案例

### 案例一：锁超时导致重复查询

**问题**：某电商大促期间，设置了互斥锁 TTL 为 5 秒，但数据库查询耗时 8 秒。锁在查询完成前过期，第二个线程获取锁后又发起了一次数据库查询。

**教训**：锁的 TTL 必须大于数据库查询的最长时间。建议设置为预期查询时间的 2-3 倍。

```php
// ❌ 错误：锁超时太短
$acquired = Redis::set($lockKey, $lockValue, 'NX', 'EX', 3);

// ✅ 正确：预留足够余量
$acquired = Redis::set($lockKey, $lockValue, 'NX', 'EX', 30);
```

### 案例二：缓存重建风暴

**问题**：Redis 主从切换后，从节点上大量 Key 丢失，瞬间数千个请求同时查询数据库。

**教训**：对于热点 Key，建议使用「提前预热 + 永不过期 + 定时刷新」的组合策略。

```php
// 上线部署时主动预热
$hotKeys = ['product:1', 'product:2', 'config:global'];
foreach ($hotKeys as $key) {
    $data = queryFromDB($key);
    Redis::set($key, json_encode($data)); // 不设 TTL
}
```

### 案例三：逻辑过期时间写入错误

**问题**：逻辑过期时间字段写入时误用了毫秒级时间戳（`microtime(true) * 1000`），导致数据瞬间"过期"。

**教训**：统一使用秒级时间戳，代码审查时重点检查时间相关逻辑。

### 案例四：分布式锁误删

**问题**：线程 A 获取锁后处理超时，锁自动过期；线程 B 获取到锁；线程 A 处理完成后删除了锁，实际删除的是线程 B 的锁。

**教训**：释放锁时必须用 Lua 脚本校验锁的 Value，保证只删除自己加的锁。

```php
// ✅ 原子性释放锁
$script = <<<LUA
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
LUA;
Redis::eval($script, 1, $lockKey, $lockValue);
```

---

## 十一、最佳实践总结

1. **热点 Key 识别**：通过 Redis 的 `MONITOR` 命令或客户端埋点，找出 QPS 最高的 Key。
2. **分层防护**：本地缓存（如 PHP APCu / Laravel Cache File）+ Redis 分布式缓存 + 数据库，多层保护。
3. **TTL 随机化**：即使不是热点 Key，也建议给 TTL 加随机偏移，防止集中过期。
4. **优雅降级**：当数据库也不可用时，返回默认值或缓存的旧数据，而不是直接报错。
5. **压测验证**：上线前通过压测工具（如 JMeter、wrk）模拟高并发场景，验证防护方案是否有效。

```php
// TTL 随机化示例
$baseTtl = 3600;
$randomOffset = rand(0, 300); // 0-5分钟随机偏移
$ttl = $baseTtl + $randomOffset;
Redis::setex($key, $ttl, $value);
```

---

## 相关阅读

- [Redis缓存雪崩](/categories/Databases/Redis/cache-avalanche/) — 大量 Key 同时过期的应对策略与多级缓存架构
- [Redis缓存穿透](/categories/Databases/Redis/cache-penetration/) — 布隆过滤器与缓存空值的防护方案
- [Redis 实战：缓存失效场景深度解析](/categories/Databases/Redis/redis-guide-cache/) — 缓存穿透、击穿、雪崩三大问题的生产级解决方案
