---

title: Redis 缓存穿透、击穿、雪崩：三大问题对比与防护方案
keywords: [Redis, 缓存穿透, 击穿, 雪崩, 三大问题对比与防护方案, 数据库]
tags:
- Redis
- 缓存穿透
- 缓存雪崩
- 缓存击穿
- 布隆过滤器
- PHP
- Laravel
- 高并发
categories:
  - database
date: 2019-03-20 15:05:07
description: 全面对比Redis缓存穿透、缓存雪崩与缓存击穿三大经典缓存问题的触发条件、影响范围与核心差异，深入剖析缓存空值、布隆过滤器、随机化TTL、互斥锁与逻辑过期等主流防护方案优缺点与选型策略，结合PHP/Laravel生产环境代码示例与高并发架构最佳实践，帮助开发者在不同业务场景下做出合理的Redis缓存防护决策
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-1-content-1.jpg
- /images/content/databases-1-content-2.jpg
---




## 概述

在使用 Redis 作为缓存层时，**缓存穿透**、**缓存雪崩**和**缓存击穿**是最常见也最致命的三大问题。如果不加以防护，轻则导致数据库压力飙升、响应变慢，重则直接将数据库打宕机，引发线上事故。本文将逐一深入分析这三大问题的成因、典型场景、解决方案，并给出基于 PHP/Laravel + Redis 的代码示例。

![Redis缓存穿透、雪崩与击穿示意图](/images/content/databases-1-content-1.jpg)

---

## 一、缓存穿透（Cache Penetration）

### 1.1 什么是缓存穿透？

缓存穿透是指**查询一个一定不存在的数据**。由于缓存中没有该 key，请求会直接穿透缓存层打到数据库。如果攻击者利用大量不存在的 key 发起恶意请求（例如构造随机 ID），数据库将承受巨大的查询压力，甚至被打垮。

### 1.2 典型场景

- **恶意攻击**：黑客每秒发送数千次请求，使用不存在的商品 ID、用户 ID 等参数，请求全部穿透到 MySQL。
- **业务 bug**：前端传入了错误的参数（如负数 ID、空字符串），后端未做校验直接查询数据库。
- **数据尚未同步**：新创建的数据还没有写入缓存，但已对外暴露了访问接口。

### 1.3 解决方案

#### 方案一：缓存空值（Cache Null）

最简单的方案——当查询数据库返回为空时，将空结果也写入缓存，并设置一个较短的过期时间。

```php
<?php
use Illuminate\Support\Facades\Redis;

function getUserById(int $id): ?array
{
    $cacheKey = "user:{$id}";
    $cached = Redis::get($cacheKey);

    // 缓存命中（包括空值标记）
    if ($cached !== null) {
        return $cached === '__NULL__' ? null : json_decode($cached, true);
    }

    // 查询数据库
    $user = DB::table('users')->find($id);

    if ($user) {
        // 正常数据缓存 30 分钟
        Redis::setex($cacheKey, 1800, json_encode($user));
        return (array) $user;
    }

    // 缓存空值，过期时间设短一些（60秒），防止占用过多内存
    Redis::setex($cacheKey, 60, '__NULL__');
    return null;
}
```

> **适用场景**：数据量有限、key 空间可枚举的情况。
> **缺点**：如果攻击者使用大量随机 key，会在 Redis 中写入大量空值 key，浪费内存。

#### 方案二：布隆过滤器（Bloom Filter）

布隆过滤器是一种概率型数据结构，用于快速判断一个元素**是否可能存在于集合中**。它可以 100% 确定元素不存在，但有一定概率误判存在（假阳性）。

**原理**：使用多个哈希函数将元素映射到一个位数组中。查询时，若所有对应的位都为 1，则认为"可能存在"；只要有任意一位为 0，则一定不存在。

```php
<?php
use Illuminate\Support\Facades\Redis;

/**
 * 布隆过滤器 - 添加元素
 * 注意：生产环境建议使用 RedisBloom 模块的 BF.ADD 命令
 * 这里用简易 PHP 实现演示原理
 */
class BloomFilter
{
    private string $key;
    private int $hashCount;
    private int $bitSize;

    public function __construct(string $key, int $hashCount = 5, int $bitSize = 1000000)
    {
        $this->key = $key;
        $this->hashCount = $hashCount;
        $this->bitSize = $bitSize;
    }

    /**
     * 计算第 i 个哈希值
     */
    private function hash(string $value, int $i): int
    {
        return crc32($value . $i) % $this->bitSize;
    }

    /**
     * 向布隆过滤器添加元素
     */
    public function add(string $value): void
    {
        for ($i = 0; $i < $this->hashCount; $i++) {
            $offset = $this->hash($value, $i);
            Redis::command('setbit', [$this->key, $offset, 1]);
        }
    }

    /**
     * 检查元素是否可能存在
     * @return bool true=可能存在, false=一定不存在
     */
    public function mightContain(string $value): bool
    {
        for ($i = 0; $i < $this->hashCount; $i++) {
            $offset = $this->hash($value, $i);
            if (!Redis::command('getbit', [$this->key, $offset])) {
                return false;
            }
        }
        return true;
    }
}

// 使用示例
$bloom = new BloomFilter('bloom:users');

// 初始化时将所有合法的用户 ID 加入布隆过滤器
$allUserIds = DB::table('users')->pluck('id');
foreach ($allUserIds as $userId) {
    $bloom->add((string) $userId);
}

// 查询时先过布隆过滤器
function getUserWithBloom(int $id): ?array
{
    global $bloom;

    // 第一层：布隆过滤器拦截一定不存在的 key
    if (!$bloom->mightContain((string) $id)) {
        return null; // 直接返回，不查数据库
    }

    // 第二层：查缓存
    $cacheKey = "user:{$id}";
    $cached = Redis::get($cacheKey);
    if ($cached !== null) {
        return json_decode($cached, true);
    }

    // 第三层：查数据库
    $user = DB::table('users')->find($id);
    if ($user) {
        Redis::setex($cacheKey, 1800, json_encode($user));
        return (array) $user;
    }

    return null;
}
```

> **生产环境推荐**：使用 Redis 的 RedisBloom 模块，直接用 `BF.ADD` 和 `BF.EXISTS` 命令，性能更高。
> **适用场景**：数据量大、key 空间不可枚举、需要防恶意攻击的场景。

---

## 二、缓存雪崩（Cache Avalanche）

### 2.1 什么是缓存雪崩？

缓存雪崩是指**大量缓存 key 在同一时间集中过期**，或者 **Redis 服务整体宕机**，导致所有请求瞬间涌向数据库，造成数据库压力骤增甚至崩溃。

### 2.2 典型场景

- **集中过期**：系统启动时，大量缓存 key 设置了相同的 TTL（例如都是 3600 秒），一小时后同时失效。
- **Redis 宕机**：单点 Redis 服务器故障，缓存层完全不可用。
- **大促活动**：活动结束瞬间，活动相关的缓存 key 同时过期。

### 2.3 解决方案

#### 方案一：随机化 TTL（推荐）

在设置缓存过期时间时，添加一个随机偏移量，避免大量 key 同时失效。

```php
<?php
use Illuminate\Support\Facades\Redis;

/**
 * 设置缓存，TTL 带随机偏移
 *
 * @param string $key      缓存 key
 * @param mixed  $value    缓存值
 * @param int    $baseTtl  基础过期时间（秒）
 * @param int    $randomTtl 随机偏移范围（秒）
 */
function cacheSetWithRandomTtl(
    string $key,
        mixed $value,
        int $baseTtl = 3600,
        int $randomTtl = 600
): void {
    $ttl = $baseTtl + random_int(0, $randomTtl);
    Redis::setex($key, $ttl, is_string($value) ? $value : json_encode($value));
}

// 使用示例：缓存商品信息
function getProductById(int $id): ?array
{
    $cacheKey = "product:{$id}";
    $cached = Redis::get($cacheKey);

    if ($cached) {
        return json_decode($cached, true);
    }

    $product = DB::table('products')->find($id);

    if ($product) {
        // 基础 TTL 30 分钟 + 随机 0~5 分钟
        cacheSetWithRandomTtl($cacheKey, $product, 1800, 300);
        return (array) $product;
    }

    return null;
}
```

#### 方案二：多级缓存 + 熔断降级

```php
<?php

// 使用 Laravel 的 Cache facade（默认使用 file 缓存作为二级缓存）
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

function getProductMultiLevel(int $id): mixed
{
    $redisKey = "product:{$id}";
    $localKey = "local:product:{$id}";

    // L1: 本地文件缓存（ehcache 思路）
    if (Cache::has($localKey)) {
        return Cache::get($localKey);
    }

    // L2: Redis 缓存
    $cached = Redis::get($redisKey);
    if ($cached) {
        $data = json_decode($cached, true);
        Cache::put($localKey, $data, now()->addMinutes(5));
        return $data;
    }

    // L3: 数据库（加限流保护）
    $product = DB::table('products')->find($id);
    if ($product) {
        $data = (array) $product;
        cacheSetWithRandomTtl($redisKey, $data, 1800, 300);
        Cache::put($localKey, $data, now()->addMinutes(5));
        return $data;
    }

    return null;
}
```

#### 方案三：Redis 高可用架构

- 使用 **Redis Sentinel（哨兵）** 实现主从自动故障转移。
- 使用 **Redis Cluster（集群）** 分片存储，避免单点故障。
- 做好 **RDB/AOF 持久化**，Redis 恢复后自动加载数据。

---

## 三、缓存击穿（Cache Breakdown）

### 3.1 什么是缓存击穿？

缓存击穿是指**某个热点 key 在过期的瞬间**，大量并发请求同时访问这个 key，由于缓存未命中，所有请求同时打到数据库，导致数据库瞬时压力飙升。

与缓存雪崩的区别在于：雪崩是**大量 key 同时失效**，而击穿是**单个热点 key 失效**。

### 3.2 典型场景

- **热点商品**：秒杀活动中的商品详情，缓存刚过期就有大量请求涌入。
- **热门文章**：某篇爆款文章的缓存 key 过期，瞬间数千次请求同时查询数据库。
- **排行榜数据**：排行榜缓存刷新间隔到达时，并发请求量暴增。

### 3.3 解决方案

#### 方案一：互斥锁（Mutex Lock）

当缓存未命中时，使用分布式锁保证只有一个请求去查询数据库并回写缓存，其他请求等待重试。

```php
<?php
use Illuminate\Support\Facades\Redis;

/**
 * 使用互斥锁防止缓存击穿
 */
function getProductWithMutex(int $id): ?array
{
    $cacheKey = "product:{$id}";
    $lockKey = "lock:product:{$id}";
    $cached = Redis::get($cacheKey);

    if ($cached) {
        return json_decode($cached, true);
    }

    // 尝试获取分布式锁（NX + EX 原子操作）
    $locked = Redis::command('set', [
        $lockKey, '1', 'NX', 'EX', 10
    ]);

    if ($locked) {
        try {
            // 双重检查：获取锁后再次检查缓存
            $cached = Redis::get($cacheKey);
            if ($cached) {
                return json_decode($cached, true);
            }

            // 查询数据库
            $product = DB::table('products')->find($id);
            if ($product) {
                $data = (array) $product;
                cacheSetWithRandomTtl($cacheKey, $data, 1800, 300);
                return $data;
            }

            return null;
        } finally {
            // 释放锁
            Redis::del($lockKey);
        }
    }

    // 未获取到锁，短暂休眠后重试
    usleep(100000); // 100ms
    return getProductWithMutex($id);
}
```

#### 方案二：逻辑过期（不设物理 TTL）

不给缓存 key 设置过期时间，而是在 value 中记录逻辑过期时间。读取时判断是否过期，如果过期则异步更新。

```php
<?php
use Illuminate\Support\Facades\Redis;

/**
 * 使用逻辑过期防止缓存击穿
 */
function getProductWithLogicalExpire(int $id): ?array
{
    $cacheKey = "product:{$id}";
    $lockKey = "lock:product:{$id}";
    $cached = Redis::get($cacheKey);

    if (!$cached) {
        return null;
    }

    $data = json_decode($cached, true);

    // 检查逻辑过期时间
    if (isset($data['expire_at']) && $data['expire_at'] > time()) {
        // 未过期，直接返回
        unset($data['expire_at']);
        return $data;
    }

    // 已过期，尝试获取锁进行异步更新
    $locked = Redis::command('set', [$lockKey, '1', 'NX', 'EX', 10]);

    if ($locked) {
        // 在实际项目中，这里应该用队列异步处理
        try {
            $product = DB::table('products')->find($id);
            if ($product) {
                $newData = (array) $product;
                $newData['expire_at'] = time() + 1800 + random_int(0, 300);
                // 物理上永不过期（或设置很长的 TTL 作为兜底）
                Redis::setex($cacheKey, 86400, json_encode($newData));
            }
        } finally {
            Redis::del($lockKey);
        }
    }

    // 先返回旧数据，不阻塞用户
    unset($data['expire_at']);
    return $data;
}
```

> **优点**：用户永远不会被阻塞，体验好。
> **缺点**：在更新完成前，所有用户看到的都是旧数据（短暂的数据不一致）。

---

## 四、三大问题对比总结

| 维度 | 缓存穿透 | 缓存雪崩 | 缓存击穿 |
| :--- | :--- | :--- | :--- |
| **概念** | 查询不存在的数据，请求穿透缓存直达数据库 | 大量 key 同时过期或 Redis 宕机，请求涌向数据库 | 热点 key 过期瞬间，并发请求同时打到数据库 |
| **触发条件** | 查询不存在的 key | 大规模 key 同时失效 / Redis 故障 | 单个热点 key 过期 |
| **影响范围** | 数据库单表查询压力 | 数据库整体负载飙升 | 数据库单条记录查询压力 |
| **解决方案** | 缓存空值、布隆过滤器、接口参数校验 | 随机化 TTL、多级缓存、Redis 高可用架构、熔断降级 | 互斥锁、逻辑过期、永不过期（热点数据） |
| **监控手段** | Redis `MONITOR` 命令、缓存命中率监控、请求日志分析 | Redis 连接数监控、数据库 QPS 监控、Grafana 告警面板 | 热点 key 探测、单 key QPS 监控、Redis `SLOWLOG` |
| **恢复策略** | 修复 bug / 加入布隆过滤器数据、清理无效空值缓存 | 手动触发缓存预热、Redis 主从切换、启用降级接口 | 重新预热热点 key、解除锁等待、切换为逻辑过期策略 |
| **适用场景** | 数据可枚举用缓存空值；不可枚举用布隆过滤器 | 缓存集群 + 随机 TTL；单机用多级缓存 | 热点数据用逻辑过期；一般数据用互斥锁 |

---

## 五、生产环境最佳实践

### 5.1 缓存穿透防护

1. **接口层校验**：在 Controller 层对参数做合法性校验，拦截明显非法的请求（如负数 ID、超长字符串）。
2. **布隆过滤器预加载**：系统启动时将全量合法 key 加入布隆过滤器，数据变更时同步更新。
3. **空值 TTL 不宜过长**：缓存空值建议 30~120 秒，防止内存被大量空值 key 占用。

### 5.2 缓存雪崩防护

1. **TTL 随机化**：所有缓存写入都加上随机偏移量（基础 TTL + random(0, 偏移量)）。
2. **Redis 高可用**：生产环境必须使用 Sentinel 或 Cluster 架构。
3. **多级缓存**：在 Redis 前增加本地缓存（如 Laravel File Cache、APCu），作为兜底方案。
4. **熔断降级**：使用 Hystrix / Resilience4j 等熔断组件，当数据库压力超过阈值时自动降级返回默认值。
5. **缓存预热**：系统上线或 Redis 重启后，通过脚本预先加载热点数据。

### 5.3 缓存击穿防护

1. **识别热点 key**：通过 Redis `SLOWLOG` 和业务日志识别高频访问的 key。
2. **互斥锁实现**：使用 `SET key value NX EX` 原子命令实现分布式锁，避免死锁。
3. **逻辑过期策略**：对核心热点数据使用逻辑过期，永不阻塞读请求。
4. **永不过期 + 异步刷新**：热点数据不设物理 TTL，通过定时任务或消息队列异步刷新。

### 5.4 通用建议

- **熔断机制**：无论采用哪种方案，都必须做好熔断。一旦缓存层出问题，熔断器可以保护数据库不被打死。
- **监控告警**：对 Redis 的命中率、连接数、内存使用率、慢查询进行实时监控和告警。
- **压测验证**：上线前通过压测模拟缓存失效场景，验证防护方案的有效性。
- **代码 Review**：每次使用 Redis 时，都要审视是否存在穿透/雪崩/击穿的风险。

![Redis缓存性能监控](/images/content/databases-1-content-2.jpg)

---

## 六、完整示例：Laravel Service 封装

以下是一个综合了三种防护策略的 Laravel Service 示例：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CacheService
{
    /**
     * 通用的缓存穿透 + 击穿防护查询方法
     *
     * @param string $cacheKey   缓存 key
     * @param string $lockKey    分布式锁 key
     * @param callable $queryFn  数据库查询回调
     * @param int $baseTtl       基础过期时间
     * @param int $randomTtl     随机偏移范围
     * @return mixed
     */
    public function rememberWithProtection(
        string $cacheKey,
        string $lockKey,
        callable $queryFn,
        int $baseTtl = 1800,
        int $randomTtl = 300
    ): mixed {
        // 1. 查缓存
        $cached = Redis::get($cacheKey);
        if ($cached !== null) {
            return $cached === '__NULL__' ? null : json_decode($cached, true);
        }

        // 2. 互斥锁防击穿
        $locked = Redis::command('set', [$lockKey, '1', 'NX', 'EX', 10]);

        if ($locked) {
            try {
                // 双重检查
                $cached = Redis::get($cacheKey);
                if ($cached !== null) {
                    return $cached === '__NULL__' ? null : json_decode($cached, true);
                }

                // 查询数据库
                $data = $queryFn();

                if ($data) {
                    $ttl = $baseTtl + random_int(0, $randomTtl);
                    Redis::setex($cacheKey, $ttl, json_encode($data));
                } else {
                    // 缓存空值防穿透
                    Redis::setex($cacheKey, 60, '__NULL__');
                }

                return $data;
            } catch (\Exception $e) {
                Log::error("Cache query failed: {$cacheKey}", ['error' => $e->getMessage()]);
                return null;
            } finally {
                Redis::del($lockKey);
            }
        }

        // 未获取到锁，短暂等待后重试
        usleep(100000);
        return $this->rememberWithProtection($cacheKey, $lockKey, $queryFn, $baseTtl, $randomTtl);
    }
}

// 使用示例
$cacheService = app(CacheService::class);
$product = $cacheService->rememberWithProtection(
    'product:123',
    'lock:product:123',
    fn() => DB::table('products')->find(123)
);
```

![image-20221001215214488](/images/redis.png)

---

## 相关阅读

- [Redis 实战：缓存失效场景深度解析 — KKday B2C API 真实踩坑记录](/databases/redis-guide-cache/) — 从生产环境真实案例出发，深入解析缓存穿透、击穿、雪崩的实战应对
- [Predis Laravel 缓存实战与分布式锁性能调优](/databases/predis-laravel-cacheguide-distributedlock/) — Predis vs PhpRedis 性能对比，分布式锁 Redlock 方案与连接池优化
- [Redis Cluster 原理探讨](/databases/redis-cluster/) — 本文"高可用架构"章节的延伸阅读，16384 哈希槽与 Gossip 协议详解
- [Cache Stampede 防护深度实战：Lock + Probabilistic Early Expiration + Background Refresh](/02_Redis/Cache-Stampede-防护深度实战-Lock-Probabilistic-Early-Expiration-Background-Refresh-Laravel高并发缓存击穿三重防御/) — 本文"缓存击穿"章节的进阶阅读，三种防御策略的原理对比与 Laravel 实现
- [分布式锁深度对比：Redis Redlock vs Zookeeper vs etcd](/00_架构/Distributed-Lock-深度对比-Redis-Redlock-vs-Zookeeper-vs-etcd-PHP分布式互斥选型/) — 本文"互斥锁方案"的延伸，三种分布式锁实现的性能、一致性与容错对比
- [分布式缓存一致性实战：Cache-Aside / Write-Through / Write-Behind](/00_架构/分布式缓存一致性实战-Cache-Aside-Write-Through-Write-Behind在Laravel中的工程化落地/) — 缓存与数据库双写的三种模式详解，与本文雪崩防护形成互补
- [Laravel Cache Warming 实战：缓存预热策略与自动化](/05_PHP/Laravel/Laravel-Cache-Warming-实战-缓存预热策略与自动化/) — 缓存预热工程化实践，系统冷启动阶段的缓存防护前置手段
