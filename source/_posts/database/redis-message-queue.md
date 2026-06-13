---

title: Redis常见的问题及方案
keywords: [Redis, 常见的问题及方案]
tags:
- Redis
- 消息队列
- 发布订阅
categories:
- database
date: 2022-08-20 16:05:07
description: 为了便于大家查找问题，了解全貌，本文整理了Redis常见面试问题及解决方案，涵盖数据结构、持久化、集群、消息队列、分布式锁等核心知识点。同时对比Redis List、Pub/Sub与Stream三种消息队列方案，附Laravel队列驱动配置与死信队列实践，帮助你全面掌握Redis消息队列的应用与最佳实践。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-001-content-1.jpg
- /images/content/databases-001-content-2.jpg
---


为了便于大家查找问题，了解全貌，整理个目录，我们可以快速全局了解关于Redis 缓存，面试官一般喜欢问哪些问题？

![图片](https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/redis_all.png)



接下来，我们逐条来看看每个问题及解决方案



**Redis 有哪些特性？**

- 性能高， 读的速度是100000次/s，写的速度是80000次/s
- 数据持久化，支持RDB 、AOF
- 支持事务。通过`MULTI`和`EXEC`指令包起来。
- 多种数据结构类型
- 主从复制
- 其他特性：发布/订阅、通知、key过期等



**Redis 为什么这么快？**

- 完全基于内存，没有磁盘IO上的开销，异步持久化除外
- 单线程，避免多个线程切换的性能损耗
- 非阻塞的IO多路复用机制
- 底层的数据存储结构优化，使用原生的数据结构提升性能。



**Redis 底层的基础数据结构有哪些？**

![Redis数据结构](/images/content/databases-001-content-1.jpg)

- 字符串。没有采用C语言的传统字符串，而是自己实现的一个简单动态字符串SDS的抽象类型，并保存了长度信息。
- 链表（linkedlist）。双向无环链表结构，每个链表的节点由一个listNode结构来表示，每个节点都有前置和后置节点的指针
- 字典（hashtable）。保存键值对的抽象数据结构，底层使用hash表，每个字典带有两个hash表，供平时使用和rehash时使用。
- 跳跃表（skiplist）。跳跃表是有序集合的底层实现之一。redis跳跃表由zskiplist和zskiplistNode组成，zskiplist用于保存跳跃表 信息(表头、表尾节点、⻓度等)，zskiplistNode用于表示表跳跃节点，每个跳跃表的层高都是1- 32的随机数，在同一个跳跃表中，多个节点可以包含相同的分值，但是每个节点的成员对象必须是唯一的，节点按照分值大小排序，如果分值相同，则按照成员对象的大小排序。
- 整数集合（intset）。用于保存整数值的集合抽象数据结构，不会出现重复元素，底层实现为数组。
- 压缩列表（ziplist）。为节约内存而开发的顺序性数据结构，可以包含多个节点，每个节点可以保存一个字节数组或者整数值。



**Redis 支持哪些数据类型？**

五种常用数据类型：`String`、`Hash`、`Set`、`List`、`SortedSet`。

三种特殊的数据类型：`Bitmap`、`HyperLogLog`、`Geospatial`，

​		其中Bitmap 、HyperLogLog的底层都是 String 数据类型，

​		Geospatial 底层是 Sorted Set 数据类型。

- 字符串对象string：int整数、embstr编码的简单动态字符串、raw简单动态字符串
- 列表对象list：ziplist、linkedlist
- 哈希对象hash：ziplist、hashtable
- 集合对象set：intset、hashtable
- 有序集合对象zset：ziplist、skiplist



**Redis 常用的 5 种数据结构和应用场景？**

- String：缓存、计数器、分布式锁等
- List：链表、队列、微博关注人时间轴列表等
- Hash：用户信息、Hash 表等
- Set：去重、赞、踩、共同好友等
- Zset：访问量排行榜、点击量排行榜等



**为什么采用单线程？**

CPU不会成为Redis的制约瓶颈，Redis主要受内存、网络限制。例如，在一个普通的 Linux 系统上，使用pipelining 可以每秒传递 100 万个请求，所以如果您的应用程序主要使用 O(N) 或 O(log(N)) 命令，则几乎不会使用太多 CPU，属于IO密集型系统。



**Redis 6.0 之后又改用多线程呢?**

Redis的多线程主要是处理数据的读写、协议解析。执行命令还是采用单线程顺序执行。

主要是因为redis的性能瓶颈在于网络IO而非CPU，使用多线程进行一些周边预处理，提升了IO的读写效率，从而提高了整体的吞吐量。antirez 在 RedisConf 2019 分享时提到，Redis 6 引入的多线程 IO 对性能提升至少一倍以上。



**过期键Key 的删除策略有哪些？**

有3种过期删除策略。

惰性删除、定期删除、定时删除

- 惰性删除。使用key时才进行检查，如果已经过期，则删除。缺点：过期的key如果没有被访问到，一直无法删除，一直占用内存，造成空间浪费。
- 定期删除。每隔一段时间做一次检查，删除过期的key，每次只是随机取一些key去检查。
- 定时删除。为每个key设置过期时间，同时创建一个定时器。一旦到期，立即执行删除。缺点：如果过期键比较多时，占用CPU较多，对服务的性能有很大影响。



**如果Redis的内存空间不足，淘汰机制？**

- volatile-lru：从已设置过期时间的key中，移出最近最少使用的key进行淘汰
- allkeys-lru：当内存不足以容纳新写入数据时，在键空间中，移除最近最少使用的key（这个是最常用的）
- volatile-ttl：从已设置过期时间的key中，移出将要过期的key
- volatile-random：从已设置过期时间的key中，随机选择key淘汰
- allkeys-random：从key中随机选择key进行淘汰
- no-eviction：禁止淘汰数据。当内存达到阈值的时候，新写入操作报错
- volatile-lfu：从已设置过期时间的数据集(server.db[i].expires)中挑选最不经常使用的数据淘汰(LFU(Least Frequently Used)算法，也就是最频繁被访问的数据将来最有可能被访问到)
- allkeys-lfu：当内存不足以容纳新写入数据时，在键空间中，移除最不经常使用的key。



**Redis 突然挂了怎么解决？**

1、从系统可用性角度思考，Redis Cluster引入主备机制，当主节点挂了后，自动切换到备用节点，继续提供服务。

2、Client端引入本地缓存，通过开关切换，避免Redis突然挂掉，高并发流量把数据库打挂。



**Redis 持久化有哪些方式？**

![Redis持久化](/images/content/databases-001-content-2.jpg)

1、快照RDB。将某个时间点上的数据库状态保存到`RDB文件`中，RDB文件是一个压缩的二进制文件，保存在磁盘上。当Redis崩溃时，可用于恢复数据。通过`SAVE`或`BGSAVE`来生成RDB文件。

- SAVE：会阻塞redis进程，直到RDB文件创建完毕，在进程阻塞期间，redis不能处理任何命令请求。
- BGSAVE：会fork出一个子进程，然后由子进程去负责生成RDB文件，父进程还可以继续处理命令请求，不会阻塞进程。

2、只追加文件AOF。

​	以日志的形式记录每个写操作（非读操作）。当不同节点同步数据时，读取日志文件的内容将写指令从前到后执行一次，即可完成数据恢复。



**Redis 常用场景**

- 1、缓存，有句话说的好，「性能不够，缓存来凑」
- 2、分布式锁，利用Redis 的 setnx
- 3、分布式session
- 4、计数器，通过incr命令
- 5、排行榜，Redis 的 有序集合
- 6、其他



**Redis 缓存要注意的七大经典问题？**

列举了亿级系统，高访问量情况下Redis缓存可能会遇到哪些问题？以及对应的解决方案。

- 1、缓存集中失效
- 2、缓存穿透
- 3、缓存雪崩
- 4、缓存热点
- 5、缓存大Key
- 6、缓存数据的一致性
- 7、数据并发竞争预热



**Redis 集群方案有哪几种？**

- 主从复制模式
- Sentinel（哨兵）模式
- Redis Cluster模式



**Redis 主从数据同步（主从复制）的过程？**

- 1、slave启动后，向master发送sync命令
- 2、master收到sync之后，执行bgsave保存快照，生成RDB全量文件
- 3、master把slave的写命令记录到缓存
- 4、bgsave执行完毕之后，发送RDB文件到slave，slave执行
- 5、master发送缓冲区的写命令给slave，slave接收命令并执行，完成复制初始化。
- 6、此后，master每次执行一个写命令都会同步发送给slave，保持master与slave之间数据的一致性



**主从复制的优缺点？**

1、优点：

- master能自动将数据同步到slave，可以进行读写分离，分担master的读压力
- master、slave之间的同步是以非阻塞的方式进行的，同步期间，客户端仍然可以提交查询或更新请求

缺点：

- 不具备自动容错与恢复功能，master 节点宕机后，需要手动指定新的 master
- master宕机，如果宕机前数据没有同步完，则切换IP后会存在数据不一致的问题
- 难以支持在线扩容，Redis的容量受限于单机配置



**Sentinel（哨兵）模式的优缺点？**

哨兵模式基于主从复制模式，增加了**哨兵来监控**与**自动处理故障**。

1、优点：

- 哨兵模式基于主从复制模式，所以主从复制模式有的优点，哨兵模式也有
- master 挂掉可以自动进行切换，系统可用性更高

2、缺点：

- Redis的容量受限于单机配置
- 需要额外的资源来启动sentinel进程



**Redis Cluster 模式的优缺点？**

实现了Redis的分布式存储，即每台节点存储不同的内容，来解决在线扩容的问题。

1、优点：

- 无中心架构，数据按照slot分布在多个节点
- 集群中的每个节点都是平等的，每个节点都保存各自的数据和整个集群的状态。每个节点都和其他所有节点连接，而且这些连接保持活跃，这样就保证了我们只需要连接集群中的任意一个节点，就可以获取到其他节点的数据。
- 可线性扩展到1000多个节点，节点可动态添加或删除
- 能够实现自动故障转移，节点之间通过`gossip协议`交换状态信息，用投票机制完成slave到master的角色转换

缺点：

- 数据通过异步复制，不保证数据的强一致性
- slave充当 “冷备”，不对外提供读、写服务，只作为故障转移使用。
- 批量操作限制，目前只支持具有相同slot值的key执行批量操作，对mset、mget、sunion等操作支持不友好
- key事务操作支持有限，只支持多key在同一节点的事务操作，多key分布在不同节点时无法使用事务功能
- 不支持多数据库空间，一台redis可以支持16个db，集群模式下只能使用一个，即`db 0`。Redis Cluster模式不建议使用pipeline和multi-keys操作，减少max redirect产生的场景。



**Redis 如何做扩容？**

为了避免数据迁移失效，通常使用`一致性哈希`实现动态扩容缩容，有效减少需要迁移的Key数量。

但是Cluster 模式，采用固定Slot槽位方式（16384个），对每个key计算CRC16值，然后对16384取模，然后根据slot值找到目标机器，扩容时，我们只需要迁移一部分的slot到新节点即可。



**Redis 的集群原理?**

一个redis集群由多个节点node组成，而多个node之间通过`cluster meet`命令来进行连接，组成一个集群。

数据存储通过分片的形式，整个集群分成了`16384`个slot，每个节点负责一部分槽位。整个槽位的信息会同步到所有节点中。

key与slot的映射关系：

- 健值对 key，进行 `CRC16` 计算，计算出一个 16 bit 的值
- 将 16 bit 的值对 16384 取模，得到 0 ～ 16383 的数表示 key 对应的哈希槽



**Redis 如何做到高可用？**

哨兵机制。

​	具有自动故障转移、集群监控、消息通知等功能。

​	哨兵可以同时监视所有的主、从服务器，当某个master下线时，自动提升对应的slave为master，然后由新master对外提供服务。



**什么是 Redis 事务？**

Redis事务是一组命令的集合，将多个命令打包，然后把这些命令按顺序添加到队列中，并且按顺序执行这些命令。

Redis事务中没有像Mysql关系型数据库事务隔离级别的概念，不能保证原子性操作，也没有像Mysql那样执行事务失败会进行回滚操作



**Redis 事务执行流程？**

通过`MULTI`、`EXEC`、`WATCH`等命令来实现事务机制，事务执行过程将一系列多个命令按照顺序一次性执行，在执行期间，事务不会被中断，也不会去执行客户端的其他请求，直到所有命令执行完毕。

具体过程：

- 服务端收到客户端请求，事务以`MULTI`开始
- 如果正处于事务状态时，则会把后续命令放入队列同时返回给客户端`QUEUED`，反之则直接执行这 个命令
- 当收到客户端的`EXEC`命令时，才会将队列里的命令取出、顺序执行，执行完将当前状态从事务状态改为非事务状态
- 如果收到 `DISCARD` 命令，放弃执行队列中的命令，可以理解为Mysql的回滚操作，并且将当前的状态从事务状态改为非事务状态

> WATCH 监视某个key，该命令只能在MULTI命令之前执行。如果监视的key被其他客户端修改，EXEC将会放弃执行队列中的所有命令。UNWATCH 取消监视之前通过WATCH 命令监视的key。通过执行EXEC 、DISCARD 两个命令之前监视的key也会被取消监视。



**Redis 与 Guava 、Caffeine 有什么区别？**

缓存分为本地缓存和分布式缓存。

1、Caffeine、Guava，属于本地缓存，特点：

- 直接访问内存，速度快，受内存限制，无法进行大数据存储。
- 无网络通讯开销，性能更高。
- 只支持本地应用进程访问，同步更新所有节点的本地缓存数据成本较高。
- 应用进程重启，数据会丢失。

所以，本地缓存适合存储一些不易改变或者低频改变的高热点数据。

2、Redis属于分布式缓存，特点：

- 集群模式，支持大数据量存储
- 数据集中存储，保证数据的一致性
- 数据跨网络传输，性能低于本地缓存。但同一个机房，两台服务器之间请求跑一个来回也就需要500微秒，比起其优势，这点损耗完全可以忽略，这也是分布式缓存受欢迎的原因。
- 支持副本机制，有效的保证了高可用性。



**如何实现一个分布式锁？**

- 1、数据库表，性能比较差
- 2、使用Lua脚本 (包含 SETNX + EXPIRE 两条指令)
- 3、SET的扩展命令（SET key value [EX][PX] [NX|XX]）
- 4、Redlock 框架
- 5、Zookeeper Curator框架提供了现成的分布式锁



## Redis 消息队列方案对比：List vs Pub/Sub vs Stream

| 特性 | List | Pub/Sub | Stream |
|------|------|---------|--------|
| 持久化 | ✅ 支持（列表存储在内存中，可配合AOF/RDB） | ❌ 不支持，消息不存储 | ✅ 支持，消息持久存储 |
| 消费者组 | ❌ 不支持 | ❌ 不支持 | ✅ 原生支持 |
| ACK 确认机制 | ❌ 需自行实现 | ❌ 不支持 | ✅ 支持（XACK） |
| 消息回溯/重放 | ❌ 消费后移除 | ❌ 不支持 | ✅ 支持按ID回溯 |
| 消息堆积 | ⚠️ 可以但会越来越大 | ❌ 不支持 | ✅ 支持，可设置MAXLEN |
| 适用场景 | 简单任务队列 | 实时通知、广播 | 可靠消息队列、事件溯源 |

> **推荐**：生产环境优先使用 Stream，兼具持久化、消费者组和 ACK 机制，是替代 List 和 Pub/Sub 做消息队列的最佳选择。



## Laravel Queue 驱动配置（Redis）

在 `.env` 文件中配置：

```env
QUEUE_CONNECTION=redis
```

在 `config/queue.php` 中配置 Redis 队列连接：

```php
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'default',
        'queue' => env('REDIS_QUEUE', 'default'),
        'retry_after' => 90,          // 任务执行超时时间（秒）
        'block_for' => null,           // 阻塞等待新任务的秒数
        'after_commit' => false,       // 是否在数据库事务提交后再分发任务
    ],
],
```

启动队列消费者：

```bash
php artisan queue:work redis --tries=3 --backoff=5
```



## 死信队列（Dead Letter Queue）模式

当消息多次重试仍然失败时，将其转入死信队列，避免阻塞正常消费流程。

```php
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Log;

class RetryWithDeadLetter
{
    public function handle(string $stream, string $group, string $consumer): void
    {
        $messages = Redis::xReadGroup($group, $consumer, ['mystream' => '>'], 1, 1000);

        foreach ($messages['mystream'] ?? [] as $id => $fields) {
            $retryCount = (int) ($fields['retry_count'] ?? 0);

            try {
                // 业务处理
                $this->process($fields);
                Redis::xack($stream, $group, $id);
            } catch (\Throwable $e) {
                if ($retryCount >= 3) {
                    // 超过最大重试次数，移入死信队列
                    Redis::xadd('mystream:dead_letter', '*', ...$fields, 'original_id', $id, 'error', $e->getMessage());
                    Redis::xack($stream, $group, $id);
                    Log::error("消息 {$id} 移入死信队列", ['error' => $e->getMessage()]);
                } else {
                    // 更新重试计数，等待重新消费
                    Redis::xadd("mystream:retry", '*', ...$fields, 'retry_count', $retryCount + 1);
                    Redis::xack($stream, $group, $id);
                }
            }
        }
    }
}
```



## 错误处理与重试模式

```php
// 使用指数退避重试策略
$maxRetries = 5;
$baseDelay  = 2; // 秒

for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
    try {
        $result = $redis->xReadGroup($group, $consumer, ['mystream' => '>'], 10);
        // 处理消息...
        break;
    } catch (\RedisException $e) {
        $delay = $baseDelay * pow(2, $attempt - 1); // 指数退避
        Log::warning("Redis 操作失败，第 {$attempt} 次重试，等待 {$delay}s", [
            'error' => $e->getMessage(),
        ]);
        sleep($delay);

        if ($attempt === $maxRetries) {
            Log::error('Redis 操作最终失败，已耗尽重试次数', ['error' => $e->getMessage()]);
            throw $e;
        }
    }
}
```



## 相关阅读

- [Redis HyperLogLog 实战：UV 统计与基数估算](/categories/Databases/redis-hyperloglog-guide-uv/)
- [Redis Stream 实战：消息队列替代方案](/categories/Databases/redis-stream-guide-laravel/)
- [Redis Lua 脚本原子操作实战](/categories/Databases/redis-lua-guide-distributedrate-limiting/)
- [Redis 缓存击穿](/categories/Databases/cache-breakdown/)