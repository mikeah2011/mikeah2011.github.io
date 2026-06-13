---

title: Redis 高并发场景实战：缓存策略与性能优化
keywords: [Redis, 高并发场景实战, 缓存策略与性能优化, 数据库]
tags:
- Redis
- 高并发
- 分布式
- 缓存优化
categories:
  - database
date: 2021-03-20 15:05:07
description: 本文深入探讨Redis高并发架构设计，涵盖单线程模型与I/O多路复用原理、缓存穿透/击穿/雪崩解决方案、基于SETNX与Redlock的分布式锁实现、Pipeline与Lua脚本优化技巧，以及Redis集群方案选型对比，助你全面掌握Redis高并发场景下的最佳实践。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-001-content-1.png
- /images/diagrams/databases-001-diagram.png
---



> 背景

Redis是不会存在并发问题的，因为他是单进程的，再多的命令都是一个接一个地执行的。



> 场景

1. GET & SET 

2. 利用Jedis等客户端对Redis进行并发访问

3. 远程访问Redis的时候，因为网络等原因造成高并发访问、延迟返回

   

我们使用的时候，可能会出现并发问题，比如获得和设定这一对。

Redis的为什么 有高并发问题？Redis的的出身决定。

Redis是一种单线程机制的nosql数据库，基于key-value，数据可持久化落盘。

由于单线程所以Redis本身并没有锁的概念，多个客户端连接并不存在竞争关系，

但是利用Jedis等客户端对Redis进行并发访问时会出现问题。



> 原因

发生【连接超时】、【数据转换错误】、【阻塞】、【客户端关闭连接】等问题，

这些问题均是由于【客户端连接混乱】造成。



单线程的天性决定，高并发对同一个键的操作会排队处理，

![Redis 高并发请求排队示意图](/images/content/databases-001-content-1.png)

如果并发量很大，可能造成后来的请求超时。

在远程访问Redis的时候，因为网络等原因造成高并发访问延迟返回的问题。



## Redis单线程模型详解

Redis采用单线程模型处理命令请求，但这并不意味着Redis的性能会受到限制。Redis之所以能够支撑高并发，核心在于其高效的**事件驱动架构**和**I/O多路复用机制**。

### I/O多路复用

Redis底层依赖操作系统的I/O多路复用技术来同时监听多个客户端连接。I/O多路复用的核心思想是：**单个线程通过监听多个文件描述符（socket）的I/O事件，在事件就绪时才进行读写操作**，从而避免了为每个连接创建独立线程的开销。

不同操作系统提供的实现不同：

- **Linux**：使用 `epoll`，通过事件通知机制避免轮询，复杂度为 O(1)
- **macOS/BSD**：使用 `kqueue`，功能类似 epoll
- **通用回退**：`select` / `poll`，性能较差，仅作为兼容方案

#### epoll 工作机制详解

epoll 是 Linux 下最高效的 I/O 多路复用实现，其核心 API 包括：

| API | 功能 | 说明 |
|-----|------|------|
| `epoll_create()` | 创建 epoll 实例 | 在内核中创建事件表 |
| `epoll_ctl()` | 注册/修改/删除事件 | 管理监听的文件描述符 |
| `epoll_wait()` | 等待事件就绪 | 阻塞直到有事件发生 |

**epoll 的两种触发模式**：

- **水平触发（LT, Level Triggered）**：默认模式。只要文件描述符处于就绪状态，每次 `epoll_wait()` 都会返回该事件。编程简单但可能产生重复通知。
- **边缘触发（ET, Edge Triggered）**：仅在文件描述符状态变化时通知一次。性能更高，但必须一次性读取完所有数据（循环读取直到 `EAGAIN`），编程复杂度较高。

Redis 在 Linux 下默认使用 **ET 模式**配合非阻塞 I/O，以获得最佳性能。

#### kqueue 与 select/poll 的对比

| 特性 | epoll (Linux) | kqueue (BSD/macOS) | select/poll |
|------|---------------|-------------------|-------------|
| 时间复杂度 | O(1) 事件通知 | O(1) 事件通知 | O(n) 轮询 |
| 最大连接数 | 理论无上限 | 理论无上限 | 通常 1024 (FD_SETSIZE) |
| 内存开销 | 内核红黑树+就绪链表 | 内核事件队列 | 用户态位图/数组 |
| 触发模式 | LT / ET | EV_CLEAR (类似ET) | 仅 LT |
| 适用场景 | 大规模连接 | macOS 生产环境 | 兼容性回退 |

### 事件驱动架构

Redis的事件循环（Event Loop）包含两类事件：

1. **文件事件（File Event）**：客户端的连接、读写请求
2. **时间事件（Time Event）**：定时任务，如过期键清理、RDB持久化

```
while (!server.quit) {
    aeProcessEvents();  // 处理所有就绪的文件事件和时间事件
}
```

### 单线程为何快？

| 因素 | 说明 |
|------|------|
| 无锁开销 | 单线程无需加锁、解锁，避免了锁竞争带来的性能损耗 |
| 内存操作 | 数据存储在内存中，读写速度极快 |
| 高效数据结构 | SDS、跳跃表、哈希表等底层结构优化 |
| I/O多路复用 | 单线程监听大量连接，减少上下文切换 |

### Redis vs Memcached 并发处理对比

| 特性 | Redis | Memcached |
|------|-------|-----------|
| 线程模型 | 单线程处理命令（6.0+ 多线程 I/O） | 多线程处理请求 |
| 数据结构 | String、Hash、List、Set、ZSet 等丰富类型 | 仅 Key-Value（String） |
| 持久化 | 支持 RDB + AOF | 不支持，纯内存缓存 |
| 内存管理 | 多种淘汰策略（LRU/LFU/TTL/随机等） | 仅 LRU |
| 原子操作 | 支持 Lua 脚本、MULTI/EXEC 事务 | CAS（Compare-And-Swap） |
| 分布式支持 | 原生 Cluster 分片 + 哨兵 | 客户端一致性哈希 |
| 最大 Value 大小 | 512 MB | 1 MB（默认） |
| 并发安全 | 单线程天然串行，无需加锁 | 多线程需内部锁机制 |
| 适用场景 | 复杂数据结构、分布式锁、消息队列 | 纯粹的简单缓存加速 |

> **选型建议**：如果只需要简单的缓存加速且数据结构单一，Memcached 的多线程模型可能在某些场景下吞吐更高。但 Redis 的丰富数据结构、持久化能力和 Lua 脚本支持使其在复杂业务场景中更具优势。



## Redis高并发场景

在实际生产中，Redis面临以下三大经典高并发问题：

### 缓存穿透（Cache Penetration）

**定义**：查询一个数据库中不存在的数据，缓存中自然也没有，每次请求都穿透缓存直达数据库。

**解决方案**：
- **布隆过滤器**：在缓存前加一层布隆过滤器，快速判断key是否可能存在
- **缓存空值**：将查询结果为空的key也写入缓存，设置较短的过期时间

**PHP 代码示例（缓存空值方案）**：

```php
<?php
/**
 * 防止缓存穿透：查询不存在的数据时缓存空值
 */
function getUserInfo(Client $redis, PDO $db, int $userId): ?array
{
    $cacheKey = "user:{$userId}";

    // 1. 先查缓存
    $cached = $redis->get($cacheKey);
    if ($cached !== null) {
        // 空值标记，直接返回 null
        if ($cached === '__NULL__') {
            return null;
        }
        return json_decode($cached, true);
    }

    // 2. 缓存未命中，查数据库
    $stmt = $db->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($user) {
        // 正常数据，缓存 30 分钟
        $redis->setex($cacheKey, 1800, json_encode($user));
        return $user;
    } else {
        // 数据不存在，缓存空值 60 秒（防止穿透）
        $redis->setex($cacheKey, 60, '__NULL__');
        return null;
    }
}
```

**PHP 代码示例（布隆过滤器方案）**：

```php
<?php
/**
 * 使用 Redis Bitmap 模拟布隆过滤器
 * 生产环境建议使用 RedisBloom 模块的 BF.ADD / BF.EXISTS 命令
 */
class BloomFilter
{
    private Client $redis;
    private string $key;
    private int $hashCount;

    public function __construct(Client $redis, string $key, int $hashCount = 5)
    {
        $this->redis = $redis;
        $this->key = $key;
        $this->hashCount = $hashCount;
    }

    public function add(string $item): void
    {
        for ($i = 0; $i < $this->hashCount; $i++) {
            $offset = crc32($item . $i) % (1 << 32);
            $this->redis->setbit($this->key, $offset, 1);
        }
    }

    public function mightExist(string $item): bool
    {
        for ($i = 0; $i < $this->hashCount; $i++) {
            $offset = crc32($item . $i) % (1 << 32);
            if (!$this->redis->getbit($this->key, $offset)) {
                return false;  // 一定不存在
            }
        }
        return true;  // 可能存在
    }
}
```

### 缓存击穿（Cache Breakdown）

**定义**：某个热点key在过期的瞬间，大量并发请求同时涌入数据库。

**解决方案**：
- **互斥锁**：使用 `SETNX` 加锁，保证只有一个线程回源数据库并写入缓存
- **逻辑过期**：不设置TTL，在value中存储逻辑过期时间，发现过期后异步更新

**PHP 代码示例（互斥锁防击穿）**：

```php
<?php
/**
 * 防止缓存击穿：使用互斥锁保证只有一个请求回源数据库
 */
function getHotDataWithLock(Client $redis, PDO $db, string $key, int $id): array
{
    // 1. 先查缓存
    $data = $redis->get($key);
    if ($data !== null) {
        return json_decode($data, true);
    }

    // 2. 缓存未命中，尝试获取互斥锁
    $lockKey = "lock:{$key}";
    $lockValue = uniqid('', true);

    if ($redis->set($lockKey, $lockValue, 'NX', 'EX', 10)) {
        try {
            // 双重检查：可能其他请求已经写入缓存
            $data = $redis->get($key);
            if ($data !== null) {
                return json_decode($data, true);
            }

            // 3. 查数据库并写入缓存
            $stmt = $db->prepare("SELECT * FROM products WHERE id = ?");
            $stmt->execute([$id]);
            $result = $stmt->fetch(PDO::FETCH_ASSOC);

            $redis->setex($key, 3600, json_encode($result));
            return $result;
        } finally {
            // 释放锁（Lua脚本保证原子性）
            $lua = <<<LUA
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
            LUA;
            $redis->eval($lua, 1, $lockKey, $lockValue);
        }
    }

    // 4. 获取锁失败，休眠后重试
    usleep(100000); // 100ms
    return getHotDataWithLock($redis, $db, $key, $id);
}
```

**PHP 代码示例（逻辑过期方案）**：

```php
<?php
/**
 * 逻辑过期方案：缓存永不过期，通过 value 中的过期时间判断是否需要异步更新
 */
function getWithLogicalExpiry(Client $redis, callable $loadFromDb, string $key, int $id): array
{
    $cached = $redis->get($key);
    if ($cached === null) {
        // 首次加载
        $data = $loadFromDb($id);
        $wrapped = json_encode([
            'data'        => $data,
            'expire_at'   => time() + 3600,  // 逻辑过期时间
        ]);
        $redis->set($key, $wrapped);
        return $data;
    }

    $payload = json_decode($cached, true);

    if ($payload['expire_at'] > time()) {
        // 未过期，直接返回
        return $payload['data'];
    }

    // 已过期，尝试获取锁后异步更新
    $lockKey = "lock:{$key}";
    if ($redis->set($lockKey, '1', 'NX', 'EX', 10)) {
        // 异步更新（实际项目中可投递到消息队列）
        go(function () use ($redis, $loadFromDb, $key, $id, $lockKey) {
            $data = $loadFromDb($id);
            $wrapped = json_encode([
                'data'      => $data,
                'expire_at' => time() + 3600,
            ]);
            $redis->set($key, $wrapped);
            $redis->del($lockKey);
        });
    }

    // 返回旧数据（保证可用性）
    return $payload['data'];
}
```

### 缓存雪崩（Cache Avalanche）

**定义**：大量缓存key在同一时间过期，或Redis服务宕机，导致请求全部涌向数据库。

**解决方案**：
- **随机过期时间**：在基础TTL上加随机偏移量，避免集中失效
- **多级缓存**：本地缓存（如Caffeine）+ Redis缓存，形成防护层
- **熔断降级**：当数据库压力过大时触发熔断，返回兜底数据

**PHP 代码示例（随机过期时间防雪崩）**：

```php
<?php
/**
 * 防止缓存雪崩：在基础TTL上添加随机偏移量，避免集中失效
 */
function cacheWithRandomTTL(Client $redis, string $key, callable $loader, int $baseTTL = 3600): mixed
{
    $cached = $redis->get($key);
    if ($cached !== null) {
        return json_decode($cached, true);
    }

    // 加锁防止并发回源
    $lockKey = "lock:{$key}";
    if ($redis->set($lockKey, '1', 'NX', 'EX', 5)) {
        $data = $loader();
        // 基础 TTL + 随机偏移（0~600秒），打散过期时间点
        $randomTTL = $baseTTL + random_int(0, 600);
        $redis->setex($key, $randomTTL, json_encode($data));
        $redis->del($lockKey);
        return $data;
    }

    usleep(50000); // 50ms 后重试
    return cacheWithRandomTTL($redis, $key, $loader, $baseTTL);
}
```

**PHP 代码示例（多级缓存方案）**：

```php
<?php
/**
 * 多级缓存：本地缓存（L1） + Redis缓存（L2），防止雪崩
 */
class MultiLevelCache
{
    private array $localCache = [];  // L1 本地缓存
    private Client $redis;           // L2 Redis 缓存

    public function __construct(Client $redis)
    {
        $this->redis = $redis;
    }

    public function get(string $key, callable $loader, int $localTTL = 60, int $redisTTL = 3600): mixed
    {
        // L1: 查本地缓存
        if (isset($this->localCache[$key]) && $this->localCache[$key]['expire'] > time()) {
            return $this->localCache[$key]['data'];
        }

        // L2: 查 Redis 缓存
        $cached = $this->redis->get($key);
        if ($cached !== null) {
            $data = json_decode($cached, true);
            $this->localCache[$key] = [
                'data'   => $data,
                'expire' => time() + $localTTL,
            ];
            return $data;
        }

        // L3: 回源数据库
        $data = $loader();

        // 写入 L2 + L1
        $this->redis->setex($key, $redisTTL + random_int(0, 300), json_encode($data));
        $this->localCache[$key] = [
            'data'   => $data,
            'expire' => time() + $localTTL,
        ];

        return $data;
    }
}

// 使用示例
$cache = new MultiLevelCache($redis);
$user = $cache->get("user:1001", function () use ($db, $userId) {
    return $db->query("SELECT * FROM users WHERE id = {$userId}")->fetch();
});
```



## 分布式锁实现

在分布式环境中，多个应用实例需要对共享资源进行互斥访问，Redis分布式锁是常用的解决方案。

### 方案对比

| 方案 | 实现方式 | 优点 | 缺点 |
|------|----------|------|------|
| SETNX | `SET key value NX EX` | 简单高效，单节点即可使用 | 主从切换时可能丢失锁 |
| Redlock | 多节点SETNX + 过半确认 | 高可用，抗节点故障 | 实现复杂，存在时钟争议 |
| Redisson | 封装好的Java SDK | 看门狗自动续期，使用便捷 | 依赖Java生态 |

### PHP/Laravel 代码示例（基于 Predis）

```php
<?php
use Predis\Client;

$redis = new Client([
    'scheme' => 'tcp',
    'host'   => '127.0.0.1',
    'port'   => 6379,
]);

/**
 * 尝试获取分布式锁
 */
function acquireLock(Client $redis, string $key, string $value, int $ttl = 10): bool
{
    $result = $redis->set($key, $value, 'NX', 'EX', $ttl);
    return $result !== null;
}

/**
 * 释放分布式锁（Lua脚本保证原子性）
 */
function releaseLock(Client $redis, string $key, string $value): bool
{
    $lua = <<<LUA
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
    LUA;

    $result = $redis->eval($lua, 1, $key, $value);
    return (int)$result === 1;
}

// 使用示例
$lockKey   = 'order:lock:' . $orderId;
$lockValue = uniqid('', true);  // 唯一标识，防止误删

if (acquireLock($redis, $lockKey, $lockValue, 30)) {
    try {
        // 执行业务逻辑
        processOrder($orderId);
    } finally {
        releaseLock($redis, $lockKey, $lockValue);
    }
} else {
    // 获取锁失败，可选择重试或直接返回
    throw new \RuntimeException('系统繁忙，请稍后重试');
}
```

### Redlock 算法详解

当 Redis 部署为主从架构时，单节点的 `SETNX` 存在隐患：主节点在写入锁后、同步到从节点前宕机，从节点晋升为主节点后锁信息丢失，导致另一个客户端获取到相同的锁。

**Redlock 算法步骤**：

1. 获取当前时间（毫秒级）
2. 依次向 N 个独立的 Redis 节点请求加锁，使用相同的 key 和随机 value，设置较短的超时时间
3. 当且仅当**超过半数（N/2 + 1）**节点加锁成功，且总耗时未超过锁的 TTL，才算加锁成功
4. 锁的有效时间 = 初始 TTL - 获取锁的耗时
5. 若加锁失败，则向所有节点发送释放锁的请求

```php
<?php
/**
 * Redlock 简化实现
 */
class Redlock
{
    private array $instances;
    private int $retryCount;
    private int $retryDelay; // 毫秒
    private float $clockDriftFactor = 0.01;

    public function __construct(array $instances, int $retryCount = 3, int $retryDelay = 200)
    {
        $this->instances = $instances;
        $this->retryCount = $retryCount;
        $this->retryDelay = $retryDelay;
    }

    public function lock(string $resource, int $ttl): ?array
    {
        $value = uniqid('', true);

        for ($attempt = 0; $attempt < $this->retryCount; $attempt++) {
            $acquired = 0;
            $startTime = microtime(true);

            foreach ($this->instances as $redis) {
                try {
                    if ($redis->set($resource, $value, 'NX', 'EX', $ttl)) {
                        $acquired++;
                    }
                } catch (\Exception $e) {
                    // 节点不可达，跳过
                    continue;
                }
            }

            $elapsed = microtime(true) - $startTime;
            $drift = ($ttl * $this->clockDriftFactor) + 0.002; // 时钟漂移补偿
            $validity = $ttl - $elapsed - $drift;

            $quorum = intdiv(count($this->instances), 2) + 1;

            if ($acquired >= $quorum && $validity > 0) {
                return [
                    'resource'  => $resource,
                    'value'     => $value,
                    'validity'  => $validity,
                ];
            }

            // 加锁失败，释放所有已获取的锁
            $this->unlock(['resource' => $resource, 'value' => $value]);

            usleep($this->retryDelay * 1000);
        }

        return null; // 最终失败
    }

    public function unlock(array $lock): void
    {
        $lua = <<<LUA
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
        LUA;

        foreach ($this->instances as $redis) {
            try {
                $redis->eval($lua, 1, $lock['resource'], $lock['value']);
            } catch (\Exception $e) {
                // 忽略不可达节点
            }
        }
    }
}
```

### 真实踩坑案例

#### 踩坑一：锁超时导致并发问题

**场景**：业务设置锁 TTL 为 5 秒，但某次数据库慢查询导致业务执行了 8 秒。在第 5 秒时锁已自动释放，另一个请求获取到锁并开始执行，导致两个请求并发操作同一条数据。

**解决方案**：使用**看门狗（Watchdog）自动续期**机制。Redisson 已内置此功能，原理是启动一个后台线程，每隔 TTL/3 时间检查锁是否还被持有，若是则自动续期。

```php
<?php
/**
 * 简化版看门狗续期
 */
function lockWithWatchdog(Client $redis, string $key, string $value, int $ttl = 10): bool
{
    if (!$redis->set($key, $value, 'NX', 'EX', $ttl)) {
        return false;
    }

    // 后台协程每 TTL/3 秒续期一次
    $interval = intdiv($ttl, 3);
    go(function () use ($redis, $key, $value, $interval) {
        while (true) {
            sleep($interval);
            // 检查锁是否仍属于当前持有者
            $lua = <<<LUA
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("expire", KEYS[1], ARGV[2])
            else
                return 0
            end
            LUA;
            $result = $redis->eval($lua, 1, $key, $value, $interval * 3);
            if ((int)$result !== 1) {
                break; // 锁已不属于当前持有者，停止续期
            }
        }
    });

    return true;
}
```

#### 踩坑二：Redlock 时钟漂移问题

**场景**：在跨机房部署中，不同 Redis 节点的系统时钟存在几秒的偏差。客户端在节点 A 上获取锁成功，但由于时钟漂移，节点 A 的实际过期时间比客户端计算的 validity 时间短，导致锁提前失效。

**解决方案**：

- **NTP 同步**：确保所有 Redis 节点通过 NTP 保持时钟同步，偏差控制在毫秒级
- **增大 TTL**：锁的 TTL 应远大于业务执行时间 + 网络延迟 + 时钟漂移
- **使用 Fencing Token**：每次获取锁时返回一个单调递增的 token，写入数据时校验 token 是否仍是最新的

```php
<?php
/**
 * Fencing Token 方案：写入时校验 token
 */
function processWithFencing(Client $redis, PDO $db, string $lockKey, int $orderId): void
{
    $result = $redis->set($lockKey, 'holder', 'NX', 'EX', 30);
    if (!$result) {
        throw new \RuntimeException('获取锁失败');
    }

    // 生成单调递增的 fencing token
    $token = $redis->incr("fencing:token:{$lockKey}");

    // 业务处理...

    // 写入时校验 token（通过数据库乐观锁实现）
    $stmt = $db->prepare("UPDATE orders SET status = 'processed', token = ? WHERE id = ? AND token < ?");
    $stmt->execute([$token, $orderId, $token]);

    if ($stmt->rowCount() === 0) {
        // token 已过期，说明锁已被其他持有者获取并处理
        throw new \RuntimeException('操作已被其他进程处理（Fencing Token 过期）');
    }
}
```

#### 踩坑三：可重入锁遗漏

**场景**：在嵌套调用中，外层方法获取了锁，内层方法再次尝试获取同一把锁导致死锁。

**解决方案**：实现可重入锁，通过 Hash 结构记录持有者和重入次数。

```lua
-- 可重入锁加锁 Lua 脚本
-- KEYS[1]: 锁的 key
-- ARGV[1]: 持有者标识（如 requestId）
-- ARGV[2]: 过期时间
local key = KEYS[1]
local holder = ARGV[1]
local ttl = tonumber(ARGV[2])

if redis.call('exists', key) == 0 then
    redis.call('hset', key, holder, 1)
    redis.call('expire', key, ttl)
    return 1
end

if redis.call('hexists', key, holder) == 1 then
    redis.call('hincrby', key, holder, 1)
    redis.call('expire', key, ttl)
    return 1
end

return 0
```

```lua
-- 可重入锁解锁 Lua 脚本
local key = KEYS[1]
local holder = ARGV[1]

if redis.call('hexists', key, holder) == 0 then
    return 0
end

local count = redis.call('hincrby', key, holder, -1)
if count == 0 then
    redis.call('del', key)
end
return 1
```



## Pipeline与Lua脚本

### Pipeline：减少网络往返

Redis客户端与服务器之间的每次通信都涉及一次网络往返（RTT）。当需要执行大量命令时，逐条发送会造成严重的性能浪费。Pipeline允许客户端将多个命令打包发送，服务器依次执行后一次性返回结果。

**传统模式 vs Pipeline**：

```
传统模式：  Client → Command1 → Server → Response1 → Client → Command2 → ...
Pipeline：  Client → [Command1, Command2, ...] → Server → [Response1, Response2, ...] → Client
```

**PHP/Predis Pipeline 示例**：

```php
<?php
$pipe = $redis->pipeline();

for ($i = 0; $i < 10000; $i++) {
    $pipe->set("key:{$i}", "value:{$i}");
}

$results = $pipe->execute();  // 一次性发送所有命令，大幅减少RTT
```

### Lua脚本：原子操作

Redis支持通过Lua脚本执行多条命令的原子操作，脚本在执行过程中不会被其他命令打断。

**限流器示例（滑动窗口限流）**：

```lua
-- KEYS[1]: 限流key
-- ARGV[1]: 窗口大小（秒）
-- ARGV[2]: 最大请求数
-- ARGV[3]: 当前时间戳（毫秒）

local key = KEYS[1]
local window = tonumber(ARGV[1]) * 1000
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- 移除窗口外的请求记录
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- 当前窗口内的请求数
local current = redis.call('ZCARD', key)

if current < limit then
    redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
    redis.call('PEXPIRE', key, window)
    return 1  -- 允许请求
else
    return 0  -- 拒绝请求
end
```

**PHP中调用Lua脚本**：

```php
<?php
$luaScript = file_get_contents('rate_limiter.lua');
$allowed = $redis->eval($luaScript, 1, 'rate:user:' . $userId, 60, 100, (int)(microtime(true) * 1000));
```



## Redis集群方案

当单机Redis无法满足业务需求时，需要考虑集群化部署。以下是三种主要方案的对比：

| 特性 | 主从复制（Master-Slave） | 哨兵模式（Sentinel） | Redis Cluster |
|------|--------------------------|----------------------|---------------|
| 架构 | 一主多从，手动切换 | 哨兵监控，自动故障转移 | 分片集群，数据分布式存储 |
| 数据分片 | 不支持 | 不支持 | 支持（16384个slot） |
| 高可用 | 手动切换主节点 | 自动故障转移 | 自动故障转移 |
| 写能力 | 单主写入 | 单主写入 | 多主写入（分片） |
| 容量上限 | 单机内存 | 单机内存 | 理论上可水平扩展 |
| 客户端复杂度 | 低 | 低 | 高（需支持MOVED/ASK重定向） |
| 适用场景 | 读多写少，数据量小 | 需要自动容灾的中等规模 | 大数据量、高吞吐 |

### 选型建议

1. **数据量小、读多写少**：主从复制即可满足需求
2. **需要高可用保障**：哨兵模式是最成熟的选择
3. **数据量大、写入量高**：Redis Cluster是生产环境首选
4. **跨数据中心**：可结合Redis Cluster + 异步复制实现多活架构



## 解决办法

1. 客户端角度，将连接进行池化，同时对读写Redis操作采用内部锁 synchronized；
2. 服务器角度，利用setnx变向实现锁机制；

![Redis 连接池与 SETNX 锁机制架构图](/images/diagrams/databases-001-diagram.png)



## 相关阅读

- [Redis 缓存穿透/击穿/雪崩防护与分布式锁实战](/categories/Databases/redis-cache-penetrationbreakdownavalanchedistributedlockguide/)
- [Redis Pipeline 实战：批量命令优化与网络延迟治理](/categories/Databases/redis-pipeline-guide-commandsoptimization/)
- [Redis Cluster 集群部署与故障转移：高可用架构实战](/categories/Databases/redis-cluster-deployment-high-availabilityarchitecture/)
- [Laravel Redis 分布式锁失效场景实战](/categories/Databases/laravel-redis-distributedlockguide/)
