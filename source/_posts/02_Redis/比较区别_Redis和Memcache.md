---
title: Redis缓存
tags:
  - redis
categories:
  - Redis
date: 2021-03-20 15:05:07

---



数据结构：memcache仅支持简单的key-value形式，Redis支持的数据更多（string字符串，set集合，list列表，hash散列，zset有序集合）；

多线程：memcache支持多线程，Redis支持单线程

持久化：Redis支持持久化，memcache不支持持久化

分布式：Redis做主从结构，memcache服务器需要通过hash一致化来支撑主从结构

实际运用中可以redis，memcache结合，memcache可作为session存储的方式，session都是KV类型键值对。

1. Redis中，并不是所有的数据都一直存储在内存中的，这是和Memcache相比一个最大的区别。

2. Redis在很多方面具备数据库的特征，或者说就是一个数据库系统，而Memcache只是简单的K/V缓存。

3. 他们的扩展都需要做集群；实现方式：master-slave、Hash。

4. 在100k以上的数据中，Memcache性能要高于Redis。

5. 如果要说内存使用效率，使用简单的key-value存储的话，Memcached的内存利用率更高，而如果Redis采用hash结构来做key-value存储，由于其组合式的压缩，其内存利用率会高于Memcache。当然，这和你的应用场景和数据特性有关。

6. 如果你对数据持久化和数据同步有所要求，那么推荐你选择Redis，因为这两个特性Memcache都不具备。即使你只是希望在升级或者重启系统后缓存数据不会丢失，选择Redis也是明智的。

7. Redis和Memcache在写入性能上面差别不大，读取性能上面尤其是批量读取性能上面Memcache更强
8. Redis 提供了多种不同级别的持久化方式：

RDB 持久化可以在指定的时间间隔内生成数据集的时间点快照（point-in-time snapshot）。

AOF 持久化记录服务器执行的所有写操作命令，并在服务器启动时，通过重新执行这些命令来还原数据集。 AOF 文件中的命令全部以 Redis 协议的格式来保存，新命令会被追加到文件的末尾。 Redis 还可以在后台对 AOF 文件进行重写（rewrite），使得 AOF 文件的体积不会超出保存数据集状态所需的实际大小。

Redis 还可以同时使用 AOF 持久化和 RDB 持久化。 在这种情况下， 当 Redis 重启时， 它会优先使用 AOF 文件来还原数据集， 因为 AOF 文件保存的数据集通常比 RDB 文件所保存的数据集更完整。

你甚至可以关闭持久化功能，让数据只在服务器运行时存在。

> 归纳

|            | Redis                                             | Memcache              |
| ---------- | ------------------------------------------------- | --------------------- |
| 数据结构   | string、set集合、list列表、hash散列、zset有序集合 | key-value             |
| 多线程     | NO                                                | YES                   |
| 持久化     | RDB快照、AOF日志                                  | NO                    |
| 分布式     | 主从结构                                          | hash一致化            |
| 读写       | 读11w/s，写8w/s                                   | 读更优                |
| 特性       | 具备数据库特征，NoSQL                             | K/V缓存               |
| 性能       | 100KB以内的数据，更优                             | 100KB以上的数据，更优 |
| 集群       | Master-slave hash                                 | Master-slave hash     |
| 数据存储   | 并非所有的数据都一直存储在内存中                  | 所有的都存在内存中    |
| 内存使用率 | 如果是hash结构的key-value，组合式的压缩，会高     | 高                    |

