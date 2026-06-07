# Redis 知识图谱

> 面向 Hexo 博客文章整理的 Redis Wiki。本文作为总索引，串联缓存、分布式锁、数据结构、消息队列、性能优化、高可用架构与 Laravel 集成。

## 知识地图

- [缓存策略](缓存策略.md)
  - 缓存穿透、缓存击穿、缓存雪崩
  - Cache Aside、TTL、热点 Key、空值缓存、布隆过滤器
- [缓存写入模式](缓存写入模式.md)
  - Cache-Aside、Write-Through、Write-Back、Write-Around
  - 缓存一致性保障：延迟双删、消息队列、CDC
- [分布式锁](分布式锁.md)
  - SET NX EX、唯一值、Lua 解锁、RedLock、锁续期、死锁与超时
- [数据结构](数据结构.md)
  - String、Hash、List、Set、ZSet、Bitmap、HyperLogLog、Geo
- [消息队列](消息队列.md)
  - List 阻塞队列、Pub/Sub、Redis Stream、消费者组、Pending List
- [性能优化](性能优化.md)
  - Pipeline、Lua、批量命令、网络 RTT、高并发、热点 Key
- [Redis 事务与脚本](Redis事务与脚本.md)
  - MULTI/EXEC、WATCH 乐观锁、Lua 脚本原子执行、Pipeline 管道
  - 三种机制选型：原子性 vs 性能 vs 复杂度
- [高可用架构](高可用架构.md)
  - 主从、Sentinel、Cluster、Hash Slot、故障转移、扩容
- [Redis 持久化](Redis持久化.md)
  - RDB 快照、AOF 追加日志、混合持久化（Redis 4.0+）
  - fsync 策略、AOF 重写、数据恢复优先级
- [Redis 内存管理](Redis内存管理.md)
  - 过期回收：惰性删除 + 定期删除
  - 内存淘汰策略：LRU/LFU/TTL/noeviction
  - 大 Key 治理、内存碎片、maxmemory 配置
- [Laravel集成](Laravel集成.md)
  - Predis、Laravel Cache/Session、锁封装、Redis 场景落地
- [Redis 8.0 新特性](Redis8.0新特性.md)
  - 向量搜索（FP16/INT8 量化、混合搜索、多向量索引）
  - JSON Path 增强（聚合函数、递归搜索、过滤表达式）
  - I/O 多线程、内存优化、持久化改进
  - RAG 语义缓存、实时推荐等 AI 场景
- [Cache Stampede 防护](Cache-Stampede防护.md)
  - 三重纵深防御：分布式锁 + XFetch 概率性提前过期 + SWR 后台异步刷新
  - 三重防御选型：复杂度/延迟/新鲜度权衡
  - 生产级 Laravel 实现与 Lua 原子化脚本
- [Valkey 与生态](Valkey与生态.md)
  - Redis 开源替代品（BSD 3-Clause 许可证）
  - Laravel 缓存/队列/会话无缝迁移
  - Sentinel/Cluster 高可用迁移
  - 性能基准对比与监控对接
- [分布式限流算法](分布式限流算法.md)
  - 滑动窗口/令牌桶/漏桶/Redis Cell
  - 多维限流（全局→用户→接口）
  - Lua 原子脚本与 Laravel 中间件集成

## 主题关系图

### 1. 缓存是主线
Redis 在博客中的核心角色首先是缓存：用于商品详情、会话、购物车、计次与 API 响应预热。缓存能力与高并发、锁、集群能力紧密相连。

- 相关页：[缓存策略](缓存策略.md)、[性能优化](性能优化.md)、[高可用架构](高可用架构.md)
- 相关文章：
  - [Redis 实战：缓存失效场景深度解析 - KKday B2C API 真实踩坑记录](/2026/06/01/redis-guide-cache/)
  - [Redis 缓存穿透/击穿/雪崩防护与分布式锁实战 - KKday B2C API 真实踩坑记录](/2026/06/01/redis-cache-penetrationbreakdownavalanchedistributedlockguide/)
  - [Redis 实战：缓存穿透/击穿/雪崩防护 - KKday B2C API 真实踩坑记录](/2026/06/01/redis-guidecache-penetrationbreakdownavalanche/)
  - [Laravel B2C API 的 Redis 使用场景：会话/购物车/计次/全页缓存对比](/2026/06/01/redis-use-cases-cachevs/)
  - [Predis-Laravel-缓存实战-失效分布式锁性能调优](/2026/06/01/predis-laravel-cacheguide-distributedlock/)
  - [Redis缓存穿透](/2026/06/01/cache-penetration/)
  - [Redis缓存击穿](/2026/06/01/cache-breakdown/)
  - [Redis缓存雪崩](/2026/06/01/cache-avalanche/)
  - [穿透&雪崩&击穿](/2026/06/01/vs-penetrationavalanche/)
  - [Redis缓存](/2026/06/01/vs-redismemcache/)

### 2. 原子性问题会通向分布式锁与 Lua
凡是“先读后写”“检查再修改”的流程，都可能在高并发下失效。博客中通过分布式锁与 Lua 脚本两条路径解决：

- 分布式锁适合互斥、库存预占、缓存重建
- Lua 适合把多步逻辑压缩成 Redis 服务端原子执行

- 相关页：[分布式锁](分布式锁.md)、[性能优化](性能优化.md)
- 相关文章：
  - [Laravel Redis 分布式锁失效场景实战 - KKday B2C API 真实踩坑记录](/2026/06/01/laravel-redis-distributedlockguide/)
  - [Redis-Lua-脚本原子操作实战-分布式限流库存扣减排行榜-Laravel-B2C-API踩坑记录](/2026/06/01/redis-lua-guide-distributedrate-limiting/)
  - [Redis 缓存穿透/击穿/雪崩防护与分布式锁实战 - KKday B2C API 真实踩坑记录](/2026/06/01/redis-cache-penetrationbreakdownavalanchedistributedlockguide/)

### 3. 特殊数据结构扩展了 Redis 的边界
Redis 不只是缓存，还能处理 UV 统计、签到、地理位置、排行榜、队列与实时状态。

- 相关页：[数据结构](数据结构.md)、[消息队列](消息队列.md)
- 相关文章：
  - [Redis全部](/2026/06/01/redis-interview/)
  - [Redis常见的问题及方案](/2026/06/01/redis-message-queue/)
  - [Redis-HyperLogLog-实战-UV统计与基数估算-Laravel-B2C-API踩坑记录](/2026/06/01/redis-hyperloglog-guide-uv/)
  - [Redis Bitmap 实战：用户签到/在线状态/特征标记 — Laravel B2C API 踩坑记录](/2026/06/01/redis-bitmap-guide/)
  - [Redis-Geo-实战-地理位置服务与附近的人店功能-Laravel-B2C-API踩坑记录](/2026/06/01/redis-geo-guide/)
  - [Redis Stream 实战：消息队列替代方案与消费者组管理 Laravel 踩坑记录](/2026/06/01/redis-stream-guide-laravel/)

### 4. 性能优化与架构演进相互影响
单机 Redis 能解决很多问题，但随着请求数、数据量与业务重要性提升，文章逐步走到 Pipeline、连接池、热点治理，再到 Sentinel/Cluster。

- 相关页：[性能优化](性能优化.md)、[高可用架构](高可用架构.md)、[Laravel集成](Laravel集成.md)
- 相关文章：
  - [Redis Pipeline 实战：批量命令优化与网络延迟治理（Laravel B2C API 踩坑记录）](/2026/06/01/redis-pipeline-guide-commandsoptimization/)
  - [Redis高并发](/2026/06/01/high-concurrency/)
  - [Redis Cluster 集群部署与故障转移：高可用架构实战踩坑记录](/2026/06/01/redis-cluster-deployment-high-availabilityarchitecture/)
  - [Redis Cluster 原理探讨](/2026/06/01/redis-cluster/)

### 5. 分布式限流是高并发的防线
限流与缓存、锁共同构成 Redis 高并发三件套。滑动窗口计数器是最常用的分布式限流算法，令牌桶适合允许突发的 API 网关场景，Redis Cell 提供原生令牌桶模块。

- 相关页：[分布式限流算法](分布式限流算法.md)、[性能优化](性能优化.md)、[分布式锁](分布式锁.md)
- 相关文章：
  - [分布式限流算法深度对比：滑动窗口/令牌桶/漏桶/Redis Cell 的适用场景与 Laravel 实现](/2026/06/01/2026-06-03-分布式限流算法深度对比-滑动窗口令牌桶漏桶Redis-Cell与Laravel实现/)
  - [Redis-Lua-脚本原子操作实战-分布式限流库存扣减排行榜-Laravel-B2C-API踩坑记录](/2026/06/01/redis-lua-guide-distributedrate-limiting/)

## 关键概念导航

| 概念 | 说明 | 关联页面 |
|---|---|---|
| 缓存穿透 | 查询不存在数据导致 DB 被绕过缓存直接打爆 | [缓存策略](缓存策略.md) |
| 缓存击穿 | 热点 Key 过期引发瞬时回源 | [缓存策略](缓存策略.md)、[分布式锁](分布式锁.md) |
| 缓存雪崩 | 大量 Key 同时失效或 Redis 不可用 | [缓存策略](缓存策略.md)、[高可用架构](高可用架构.md) |
| Cache-Aside | 旁路缓存，先更新 DB 再删缓存 | [缓存写入模式](缓存写入模式.md) |
| Write-Back | 回写缓存，异步批量写入 DB | [缓存写入模式](缓存写入模式.md) |
| 分布式锁 | 跨实例互斥控制 | [分布式锁](分布式锁.md)、[Laravel集成](Laravel集成.md) |
| Lua 脚本 | 多步逻辑原子执行 | [性能优化](性能优化.md)、[分布式锁](分布式锁.md) |
| MULTI/EXEC | Redis 事务，顺序执行不回滚 | [Redis 事务与脚本](Redis事务与脚本.md) |
| Pipeline | 降低 RTT 的批量命令模式 | [性能优化](性能优化.md) |
| RDB | 快照持久化，二进制文件 | [Redis 持久化](Redis持久化.md) |
| AOF | 追加日志持久化，实时性好 | [Redis 持久化](Redis持久化.md) |
| 混合持久化 | RDB + AOF，Redis 4.0+ | [Redis 持久化](Redis持久化.md) |
| LRU/LFU | 内存淘汰算法 | [Redis 内存管理](Redis内存管理.md) |
| 大 Key | 单 Key value 过大或集合元素过多 | [Redis 内存管理](Redis内存管理.md) |
| Stream | 带消费者组与 ACK 的轻量 MQ | [消息队列](消息队列.md) |
| HyperLogLog | 基数估算与 UV 统计 | [数据结构](数据结构.md) |
| Bitmap | 布尔状态压缩存储 | [数据结构](数据结构.md) |
| GEO | 附近的人/店与范围搜索 | [数据结构](数据结构.md) |
| Cluster | 分片与故障转移 | [高可用架构](高可用架构.md) |
| Predis / Laravel | PHP 应用侧集成方式 | [Laravel集成](Laravel集成.md) |
| 向量搜索 | FP16/INT8 量化 + HNSW + 混合搜索 | [Redis 8.0 新特性](Redis8.0新特性.md) |
| JSON Path | 聚合函数、递归搜索、过滤表达式 | [Redis 8.0 新特性](Redis8.0新特性.md) |
| Valkey | Redis 开源替代品，BSD 许可证 | [Valkey 与生态](Valkey与生态.md) |
| RAG | 检索增强生成，向量搜索 + LLM | [Redis 8.0 新特性](Redis8.0新特性.md) |
| 分布式限流 | 滑动窗口/令牌桶/漏桶，全局流量控制 | [分布式限流算法](分布式限流算法.md) |
| Cache Stampede | 热点 Key 过期引发的惊群效应 | [Cache Stampede 防护](Cache-Stampede防护.md)、[缓存策略](缓存策略.md) |
| XFetch | 概率性提前过期算法，分散重建压力 | [Cache Stampede 防护](Cache-Stampede防护.md) |
| SWR | Stale-While-Revalidate，后台异步刷新 | [Cache Stampede 防护](Cache-Stampede防护.md) |
| Write-Back | 批量回写缓存，WAL 保障数据一致性 | [缓存写入模式](缓存写入模式.md) |

## 阅读建议

1. 先读 [缓存策略](缓存策略.md) 理解 Redis 在业务中的第一价值。
2. 再读 [缓存写入模式](缓存写入模式.md) 理解 Cache-Aside/Write-Through/Write-Back 的选型。
3. 掌握 [Redis 事务与脚本](Redis事务与脚本.md) 的原子性机制：MULTI/EXEC、Lua、Pipeline。
4. 读 [分布式锁](分布式锁.md) 与 [性能优化](性能优化.md)，建立并发与原子性视角。
5. 按场景阅读 [数据结构](数据结构.md) 与 [消息队列](消息队列.md)。
6. 高并发热点 Key 防护必读 [Cache Stampede 防护](Cache-Stampede防护.md)，掌握三重纵深防御体系。
7. 理解 [Redis 持久化](Redis持久化.md) 保障数据不丢失：RDB/AOF/混合持久化。
8. 学习 [Redis 内存管理](Redis内存管理.md)：淘汰策略、大 Key 治理、maxmemory 配置。
9. 最后看 [高可用架构](高可用架构.md) 与 [Laravel集成](Laravel集成.md)，形成工程化闭环。
10. 进阶阅读 [Redis 8.0 新特性](Redis8.0新特性.md) 了解向量搜索与 AI 场景。
11. 评估开源替代方案可参考 [Valkey 与生态](Valkey与生态.md)。
12. 高并发场景必读 [分布式限流算法](分布式限流算法.md)。

## 跨领域关联
- → [MySQL 知识图谱](../MySQL/index.md)：缓存与数据库一致性
- → [PHP-Laravel 知识图谱](../PHP-Laravel/index.md)：Laravel Cache/Queue/Session
- → [前端知识图谱](../前端/index.md)：前端状态管理、WebSocket 实时推送
- → [架构设计知识图谱](../架构设计/index.md)：AI Gateway、Feature Store、推荐系统
- → [消息队列知识图谱](../消息队列/index.md)：Redis Stream 轻量队列、MQ 选型对比
