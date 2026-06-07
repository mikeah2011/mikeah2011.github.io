---
title: Redis缓存
tags: [Redis, Memcached, 缓存, PHP, Laravel]
categories:
  - Databases
  - Redis
date: 2021-03-20 15:05:07
description: '全面对比Redis与Memcached：数据结构（String/List/Hash/Set/ZSet/Stream/Bitmap）、RDB/AOF持久化、单线程vs多线程模型、Redis Cluster集群、内存管理机制等核心差异详解。涵盖Redis 7.x/8.0新特性（Functions、Sharded Pub/Sub、向量搜索、Hash Field TTL），附PHP/Laravel实战代码、性能基准测试、缓存穿透/击穿/雪崩防护策略与选型决策指南，帮助开发者在缓存方案选型中做出最优决策。'
cover: /images/covers/databases-1-cover.jpg
images:
  - /images/content/databases-1-content-1.jpg
  - /images/content/databases-1-content-2.jpg


---

Redis 和 Memcached 是目前最主流的两款内存缓存方案，但它们的定位和能力边界差异很大。本文从架构原理、数据结构、持久化、线程模型、内存管理、集群方案等维度做一次全面对比，并涵盖 Redis 7.x/8.0 新特性（Functions、Sharded Pub/Sub、向量搜索、Hash Field TTL），附 PHP/Laravel 中的实战代码和选型决策指南。

<!-- more -->

## 核心差异一览

| 维度 | Redis | Memcache |
| --- | --- | --- |
| 数据结构 | String、List、Hash、Set、ZSet、Stream、Bitmap、HyperLogLog | 仅 key-value（String） |
| 多线程 | 单线程模型（6.0+ 引入多线程 I/O，命令执行仍单线程） | 多线程 |
| 持久化 | RDB 快照 + AOF 日志 | 不支持 |
| 数据淘汰 | LRU / LFU / TTL / 随机等多种策略 | LRU |
| 集群 | Redis Cluster（去中心化）、Sentinel、主从复制 | 客户端一致性哈希分片 |
| 内存管理 | jemalloc，支持内存碎片整理 | slab 分配器，预分配固定大小 chunk |
| 原子操作 | Lua 脚本、Functions（7.0+）、Pipeline、MULTI/EXEC 事务 | CAS（Compare-And-Swap） |
| 发布订阅 | 支持 Pub/Sub、Sharded Pub/Sub（7.0+） | 不支持 |
| 适用数据大小 | 小于 512MB（单 key） | 默认 1MB（可调至 128MB） |

## 持久化深度对比

Redis 提供了两种持久化方式，可以单独或混合使用：

- **RDB 持久化**：在指定时间间隔生成数据集的时间点快照（point-in-time snapshot），适合备份和灾恢复原，但会丢失最后一次快照后的数据。
- **AOF 持久化**：记录服务器执行的所有写操作命令，Redis 还会在后台对 AOF 文件进行重写（rewrite），使得 AOF 文件体积不会超出实际需要。同时使用 RDB + AOF 时，重启会优先使用 AOF 还原数据。
- **关闭持久化**：如果只把 Redis 当纯缓存，可关闭持久化功能，数据只在运行时存在。

Memcache 完全不支持持久化，进程重启后所有数据丢失，这是它只能定位为"缓存"而非"数据存储"的根本原因。

## 内存效率对比

- Memcache 使用 **slab 分配器**，预先将内存划分为不同大小的 chunk，容易产生内存碎片和浪费（大 key 存不进小 chunk 时会占用更大级别）。
- Redis 使用 **jemalloc**（默认），支持多种数据结构的编码优化。特别是使用 Hash 结构做 key-value 存储时，ziplist / listpack 等压缩编码让内存利用率高于 Memcache。
- 经验数据：存储 100KB 以上的大对象时 Memcache 性能更优；100KB 以内 Redis 通常更好。

## 线程模型

Memcache 天生多线程，能充分利用多核 CPU 的并行处理能力，在高并发读写场景下吞吐量表现优秀。

Redis 6.0 之前是纯粹的单线程模型（命令执行单线程，I/O 复用），6.0+ 引入了多线程 I/O 来处理网络读写，但命令执行仍然是单线程。单线程保证了原子性，避免了锁竞争，但也意味着单实例 CPU 利用率受限。

## 集群与高可用

| 方案 | Redis | Memcache |
| --- | --- | --- |
| 高可用 | Sentinel 自动故障转移 | 无内置方案，依赖客户端 |
| 水平扩展 | Redis Cluster（16384 槽位） | 客户端一致性哈希 |
| 数据分片 | Cluster 自动分片 | 业务端手动分片 |

> 想深入了解 Redis Cluster 的槽位分配、节点管理和 Laravel 集成，可以参考 [Redis Cluster 原理探讨](/categories/Databases/redis-cluster/)。

## Redis 7.x / 8.0 新特性

Redis 在 7.0 和 8.0 版本引入了多项重要特性，进一步拉大了与 Memcached 的功能差距：

### Redis 7.0 新特性

| 特性 | 说明 | 应用场景 |
| --- | --- | --- |
| **Functions** | 取代 EVAL/EVALSHA 的服务端脚本方案，函数持久化到集群所有节点 | 复杂业务逻辑下沉到 Redis，减少网络往返 |
| **Sharded Pub/Sub** | 发布订阅从全局广播改为按 slot 分片 | 大规模集群下的消息通知，避免广播风暴 |
| **Multi-part AOF** | AOF 文件拆分为 base + incr 多个部分 | 避免重写期间的 IO 峰值，提升持久化稳定性 |
| **ACL v2** | 更细粒度的权限控制，支持按 key pattern 和 channel 授权 | 多租户场景下的安全隔离 |
| **Client-side Caching (Tracking)** | 服务端主动通知客户端哪些 key 被修改 | 减少无效轮询，提升客户端缓存命中率 |

```php
// Redis 7.0 Functions 示例 - 使用 predis 注册和调用函数
// 先通过 redis-cli 注册函数：
// redis-cli -x TFUNCTION LOAD REPLACE "#!lua name=mylib
//   redis.register_function('my_getter', function(keys, args)
//     return redis.call('GET', keys[1])
//   end)"

// PHP 端调用
$result = $client->fcall('my_getter', 1, 'user:1001:name');

// Sharded Pub/Sub - 分片发布订阅
$pubSubShard = $client->pubsubLoop(['shardchannels', 'order_events']);
foreach ($pubSubShard as $message) {
    if ($message->kind === 'message') {
        // 处理分片消息
        processOrderEvent(json_decode($message->payload, true));
    }
}
```

### Redis 8.0 新特性（2025 年发布）

| 特性 | 说明 | 应用场景 |
| --- | --- | --- |
| **Hash Field Expiration** | Hash 结构支持按字段级别设置 TTL | 用户会话中不同字段有不同过期策略 |
| **Vector Set** | 原生向量集合，支持相似度搜索 | AI/ML 场景的语义搜索、推荐系统 |
| **JSON Path 增强** | JSON 支持完整的 JSONPath 查询语法 | 复杂嵌套文档的精确查询 |
| **多线程 IO 优化** | 单实例吞吐提升 30%+ | 高并发场景下的性能提升 |
| **Performance improvements** | 命令执行效率持续优化 | 整体延迟降低 |

```php
// Redis 8.0 Hash Field TTL 示例
$client->hset('user:1001:session', 'token', 'abc123');
$client->hset('user:1001:session', 'last_active', time());
// 对 token 字段单独设置 30 分钟过期
$client->hexpire('user:1001:session', 1800, 'token');
// 查询字段剩余 TTL
$ttl = $client->httl('user:1001:session', 'token');

// Redis 8.0 Vector Set 示例
$client->vadd('products:embeddings', 'VEC', [0.1, 0.5, 0.3, ...], 'product:1001');
$client->vadd('products:embeddings', 'VEC', [0.2, 0.4, 0.3, ...], 'product:1002');
// 相似度搜索
$similar = $client->vsearch('products:embeddings', 'VEC', [0.15, 0.48, 0.32, ...], 'LIMIT', 5);
```

> 更多 Redis 8.0 特性详解，参考 [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/categories/Databases/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/)。

## PHP / Laravel 实战代码

### Redis 基本用法

```php
// 使用 predis/predis 包
use Predis\Client;

$client = new Client([
    'scheme' => 'tcp',
    'host'   => '127.0.0.1',
    'port'   => 6379,
]);

// String
$client->set('user:1001:name', '张三');
$client->expire('user:1001:name', 3600); // TTL 1小时
$name = $client->get('user:1001:name');

// Hash - 适合存储对象
$client->hset('user:1001', 'name', '张三');
$client->hset('user:1001', 'email', 'zhangsan@example.com');
$user = $client->hgetall('user:1001');

// List - 适合消息队列
$client->lpush('queue:tasks', json_encode(['id' => 1, 'action' => 'send_email']));
$task = $client->rpop('queue:tasks');

// ZSet - 适合排行榜
$client->zadd('leaderboard', 95, 'user:1001');
$client->zadd('leaderboard', 88, 'user:1002');
$top3 = $client->zrevrange('leaderboard', 0, 2, ['WITHSCORES' => true]);

// Pipeline 批量操作 - 减少网络往返
$pipe = $client->pipeline();
for ($i = 0; $i < 1000; $i++) {
    $pipe->set("key:{$i}", "value:{$i}");
}
$pipe->execute();
```

### Memcache 基本用法

```php
$memcache = new \Memcache();
$memcache->connect('127.0.0.1', 11211);

// 存储
$memcache->set('session:abc123', json_encode(['user_id' => 1001]), 0, 3600);

// 读取
$session = json_decode($memcache->get('session:abc123'), true);

// 删除
$memcache->delete('session:abc123');

// 增量操作
$memcache->set('counter:page_views', 0);
$memcache->increment('counter:page_views', 1);

// 批量获取
$values = $memcache->get(['key1', 'key2', 'key3']);
```

### Laravel 中使用 Redis

```php
// config/database.php - Redis 配置
'redis' => [
    'client' => env('REDIS_CLIENT', 'predis'),
    'default' => [
        'host'     => env('REDIS_HOST', '127.0.0.1'),
        'port'     => env('REDIS_PORT', 6379),
        'password' => env('REDIS_PASSWORD'),
        'database' => 0,
    ],
],

// 基础缓存操作
Cache::put('user:1001', $userData, now()->addHours(2));
$user = Cache::get('user:1001');
Cache::forget('user:1001');

// remember 模式 - 缓存不存在时自动计算
$products = Cache::remember('products:hot', 3600, function () {
    return Product::where('is_hot', true)->get();
});

// Redis 特有数据结构
Redis::zadd('ranking:sales', $salesCount, $productId);
Redis::hset('user_profile:' . $id, 'avatar', $url);
Redis::lpush('notifications:' . $userId, json_encode($notification));

// 分布式锁
$lock = Cache::lock('order_process:' . $orderId, 10);
if ($lock->get()) {
    try {
        // 处理订单...
    } finally {
        $lock->release();
    }
}
```

## 性能基准参考

以下数据基于社区基准测试，实际性能因硬件、数据大小和并发量而异：

| 场景 | Redis（单线程） | Memcache（多线程） |
| --- | --- | --- |
| 小 key 读取（1KB） | ~110,000 ops/s | ~100,000 ops/s |
| 小 key 写入（1KB） | ~80,000 ops/s | ~90,000 ops/s |
| 大 key 读取（100KB+） | ~30,000 ops/s | ~50,000 ops/s |
| 批量读取（Pipeline/mget） | 高（Pipeline 下极高） | 非常高 |
| 复杂数据结构操作 | 非常高（原生支持） | 需应用层序列化，开销大 |

> **关键结论**：100KB 以上的大对象读写 Memcache 更优；小 key 场景下 Redis 差距不大甚至更快（Pipeline 模式下优势明显）。

## 选型决策指南

### 选择 Redis 的场景

1. **需要丰富的数据结构**：排行榜（ZSet）、消息队列（List）、计数器（INCR）、布隆过滤器等
2. **需要持久化**：重启后缓存数据不能丢
3. **需要高可用**：Sentinel / Redis Cluster 自动故障转移
4. **需要发布订阅**：消息通知、实时事件推送
5. **需要 Lua 脚本 / 事务**：复杂的原子操作
6. **Laravel 生态优先**：框架原生 Redis 支持，Horizon 队列、Session、Cache 都绑定 Redis

### 选择 Memcache 的场景

1. **纯 KV 缓存，数据结构简单**：Session 存储、页面片段缓存
2. **多线程高并发读写**：充分利用多核 CPU
3. **大数据量缓存**（100KB+）：slab 分配器对大 value 更友好
4. **不需要持久化**：缓存丢了不影响业务（可从 DB 重建）
5. **已有成熟 Memcache 集群**：运维成本低

### 混合使用方案

在实际项目中，Redis 和 Memcache 可以组合使用：

- **Redis**：负责需要数据结构支持的场景（排行榜、消息队列、分布式锁、地理位置）
- **Memcache**：负责纯 KV 的高频缓存（Session 存储、页面缓存、验证码）

这种混合方案在大型互联网公司中很常见，各取所长。

### 选型决策树

以下流程图可以帮助你快速判断该选哪个方案：

```
需要缓存方案
    │
    ├── 数据需要持久化（重启不丢）？ ──→ Redis
    │
    ├── 需要丰富数据结构？
    │   （ZSet 排行榜 / List 队列 / Hash 对象 / Bitmap / HyperLogLog）
    │       └── 是 ──→ Redis
    │
    ├── 需要发布订阅 / Stream 消息？ ──→ Redis
    │
    ├── 需要分布式锁 / Lua 原子脚本？ ──→ Redis
    │
    ├── 需要高可用自动故障转移？ ──→ Redis (Sentinel / Cluster)
    │
    ├── 纯 KV 且 value > 100KB？ ──→ Memcache
    │
    ├── 纯 KV 且需要极致多线程吞吐？ ──→ Memcache
    │
    └── 以上都无所谓 / 快速上线？ ──→ Redis（生态更完善，Laravel 原生支持）
```

> **经验法则**：如果只能选一个，选 Redis。它的功能是 Memcache 的超集，生态和社区活跃度也更高。只有在纯 KV + 大 value + 多核高吞吐的明确场景下，Memcache 才有优势。

## 真实踩坑与经验教训

### 1. Redis 单线程的 CPU 瓶颈

Redis 单线程意味着一个慢命令（如 `KEYS *`、大 key 的 `HGETALL`）会阻塞所有请求。

**解决方案**：使用 `SCAN` 代替 `KEYS`；大 Hash 拆分为多个小 Hash；开启 `lazyfree-lazy-eviction` 异步删除大 key。

### 2. Memcache 的内存碎片问题

Memcache 的 slab 分配器在存储大小差异很大的数据时，会造成严重的内存浪费（比如 slab A 64B 用完但 slab B 128B 闲置）。

**解决方案**：启动时加 `-f 1.05` 调小增长因子；或者评估数据大小后调整 slab 大小。

### 3. 缓存穿透 / 击穿 / 雪崩

无论使用 Redis 还是 Memcache，这三个经典缓存问题都必须面对：

- **穿透**：查询不存在的 key，每次都打到 DB。方案：布隆过滤器预判 key 是否存在；缓存空值并设短 TTL。
- **击穿**：热点 key 过期瞬间大量请求涌入。方案：互斥锁（`Cache::lock`）保证只有一个请求回源；逻辑过期（缓存不设 TTL，由后台定时刷新）。
- **雪崩**：大量 key 同时过期。方案：在基础 TTL 上加随机偏移（`TTL = base + rand(0, 300)`）；多级缓存（L1 本地 + L2 Redis）。

> 更详细的防护策略和 Laravel 代码实现，参考 [Redis 缓存穿透/击穿/雪崩防护与分布式锁实战](/categories/Databases/redis-cache-penetrationbreakdownavalanchedistributedlockguide/)。

### 5. 缓存与数据库一致性

在写入场景中，缓存与数据库的数据一致性是最容易踩坑的地方：

| 策略 | 流程 | 一致性 | 适用场景 |
| --- | --- | --- | --- |
| Cache Aside | 先写 DB，再删缓存 | 最终一致（有短暂窗口期） | 大多数场景的首选 |
| Write Through | 写缓存时同步写 DB | 强一致 | 写入频率低的场景 |
| Write Behind | 写缓存，异步写 DB | 最终一致 | 写入频率高、可容忍短暂不一致 |

**实际经验**：大多数项目用 Cache Aside 即可。对一致性要求极高的场景，推荐结合 Canal 监听 Binlog 异步刷新缓存，避免缓存与 DB 双写的竞态问题。

### 6. Laravel 队列驱动选型：Redis vs Database vs SQS

Redis 作为 Laravel 队列驱动非常流行，但要注意：

- `php artisan queue:work` 的 worker 进程与 Redis 是长连接，网络抖动会导致连接断开。
- 使用 `retry_after` 配置防止任务丢失。
- 大量队列任务时 Redis 内存占用会持续增长，需要设置 `maxmemory` + 淘汰策略。
- 如果队列量极大且不需要延迟任务，考虑用 SQS 或 RabbitMQ 代替。

```php
// config/queue.php
'redis' => [
    'driver'      => 'redis',
    'connection'  => 'default',
    'queue'       => env('REDIS_QUEUE', 'default'),
    'retry_after' => 90,       // 90 秒未完成则重新入队
    'block_for'   => null,
],
```

### 7. 热点 Key 生产案例

某电商大促期间，商品详情缓存 Key（`product:{id}`）在秒杀瞬间被数万请求同时访问，单个 Redis 节点 CPU 飙到 100%。

**解决方案**：
1. **本地缓存**：在 PHP 进程内用 APCu / Symfony Cache 的 ArrayAdapter 做 L1 缓存，拦截 90%+ 的请求。
2. **Key 分片**：将热点 key 复制为 `product:{id}:1` ~ `product:{id}:8`，随机读取，分散压力。
3. **限流降级**：对热点接口加令牌桶限流，超出阈值直接返回兜底数据。

```php
// 本地缓存 + Redis 二级缓存示例
use Illuminate\Support\Facades\Cache;
use Symfony\Component\Cache\Adapter\ApcuAdapter;
use Symfony\Component\Cache\Psr16Cache;

$localCache = new Psr16Cache(new ApcuAdapter());

function getProduct(int $id): array
{
    $localKey = "product:{$id}";

    // L1: 本地缓存（进程级，10 秒）
    if ($data = $localCache->get($localKey)) {
        return $data;
    }

    // L2: Redis 缓存（5 分钟）
    $data = Cache::remember($localKey, 300, function () use ($id) {
        return Product::findOrFail($id)->toArray();
    });

    $localCache->set($localKey, $data, 10);
    return $data;
}
```


### 8. 序列化开销

在 PHP 中存储复杂对象到缓存时，`json_encode` / `serialize` 的序列化和反序列化开销不容忽视。大数据量场景建议用 `igbinary` 替代 PHP 原生序列化。

## 总结

![Redis vs Memcache 技术架构对比](/images/content/databases-1-content-1.jpg)

![Redis与Memcache性能对比](/images/content/databases-1-content-2.jpg)

> **一句话总结**：如果只需要简单的 KV 缓存且追求多线程性能，Memcache 是成熟选择；如果需要丰富的数据结构、持久化、高可用和灵活的原子操作，Redis 是更全面的方案。现代项目中 Redis 的使用率已经远超 Memcache。选型时参考上方的决策树，能帮你 30 秒内做出判断。

## 相关阅读

- [Redis Cluster 原理探讨](/categories/Databases/redis-cluster/) — Redis Cluster 搭建、槽位分配与 Laravel 集成实战
- [Predis-Laravel-缓存实战-失效分布式锁性能调优](/categories/Databases/predis-laravel-cacheguide-distributedlock/) — Laravel 中使用 Predis 进行缓存操作与分布式锁实践
- [Redis 缓存穿透/击穿/雪崩防护与分布式锁实战](/categories/Databases/redis-cache-penetrationbreakdownavalanchedistributedlockguide/) — 缓存三大问题的防护策略与分布式锁实现
- [Redis 实战：缓存失效场景深度解析 - KKday B2C API 真实踩坑记录](/categories/Databases/redis-guide-cache/) — 生产环境中 Redis 缓存失效的真实踩坑记录与解决方案
- [Redis 常见的问题及方案：消息队列与面试要点](/categories/Databases/redis-message-queue/) — Redis 消息队列方案对比与常见面试问题整理
- [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/categories/Databases/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/) — Redis 8.0 特性深度解析与 Laravel 集成实战
