# Laravel集成

## 概览
这批 Redis 文章多数都带有 Laravel / Predis 背景。重点不是“怎么连上 Redis”，而是：**如何把 Redis 能力稳定地嵌入 Laravel 的缓存、会话、锁、队列、统计与高并发业务流中**。

- 关联页面：[缓存策略](缓存策略.md)、[分布式锁](分布式锁.md)、[消息队列](消息队列.md)、[性能优化](性能优化.md)、[高可用架构](高可用架构.md)

## 一、Predis 与 Laravel 的常见落点
文章中最常见的落地场景：
- Cache
- Session
- 购物车
- 计数器 / countdown
- 分布式锁
- Stream 消费
- Bitmap / HyperLogLog / GEO 场景封装

相关文章：
- [Laravel B2C API 的 Redis 使用场景：会话/购物车/计次/全页缓存对比](/2026/06/01/redis-use-cases-cachevs/)
- [Predis-Laravel-缓存实战-失效分布式锁性能调优](/2026/06/01/predis-laravel-cacheguide-distributedlock/)
- [Redis Stream 实战：消息队列替代方案与消费者组管理 Laravel 踩坑记录](/2026/06/01/redis-stream-guide-laravel/)

## 二、缓存集成
Laravel 中最直接的切入点是 `Cache::remember` 一类接口，但文章反复强调：
- 不要只停留在“能缓存”
- 要考虑 TTL、热点、空值缓存、失效事件
- 对关键缓存要有统一服务封装

实践建议：
- 统一 key 命名规范
- 统一 TTL 策略
- 封装空值缓存与随机过期
- 对热点缓存增加重建锁

对应主题可回看 [缓存策略](缓存策略.md)。

## 三、Session 与用户态数据
`redis-use-cases-cachevs.md` 中把 Redis 用于 Session/会话，强调：
- 多实例场景比文件 Session 更友好
- 可以使用 Hash 组织用户会话字段
- 要避免 session 与其他高频业务 key 混在一起造成争用

实践重点：
- 区分 session 连接与普通 cache 连接
- 配好序列化策略
- 设置合理 retention / TTL

## 四、分布式锁封装
Laravel 文章中的锁实践通常不是散落在业务代码里，而是抽象成统一 Service：
- `acquire(lockKey, owner, ttl)`
- `release(lockKey, owner)`
- 必要时支持 `refresh()`

实践重点：
- owner/value 必须唯一
- 解锁通过 Lua 保证原子 compare-and-del
- 锁连接可独立于缓存连接
- 请求 trace_id 适合作为 owner 值

对应主题详见 [分布式锁](分布式锁.md)。

## 五、Pipeline 与批量操作
Laravel B2C 场景中，商品详情页、SKU 列表、标签、个性化标记读取非常适合 Pipeline。

实践建议：
- 对多 key 读取进行服务层聚合
- 避免 Controller 中散落多个 Redis 调用
- 批次大小要控制，避免一次塞入过多命令

对应主题详见 [性能优化](性能优化.md)。

## 六、Lua 在 Laravel 中的使用
Lua 的落地重点通常包括：
- 通过 Predis 执行 `EVAL` / `EVALSHA`
- 将脚本文件化管理
- 处理脚本缓存失效
- 把复杂原子逻辑集中到服务类

适合封装为：
- 限流服务
- 库存扣减服务
- 排行榜更新服务
- 安全解锁服务

## 七、Redis Stream + Laravel Worker
`redis-stream-guide-laravel.md` 展示了 Stream 在 Laravel 中的典型整合方式：
- Producer 在业务服务中 `XADD`
- Consumer 由 Worker 常驻消费
- 消费完成后 `XACK`
- 异常恢复时扫描 Pending 并认领

实践重点：
- Worker 优雅停机
- 消费幂等
- ACK 时机清晰
- Stream 长度治理与监控

对应主题详见 [消息队列](消息队列.md)。

## 八、特殊结构的 Laravel 封装
这些文章都强调“不要让业务层直接操作底层命令”，而应封装成语义化服务：
- BitmapSignService
- GeoStoreLocatorService
- UvCounterService(HyperLogLog)
- DistributedLockService
- CacheWarmupService

这样可以把 key 规则、TTL、异常处理、监控埋点统一管理。

## 九、Cluster / 高可用环境下的 Laravel 注意事项
- Predis 是否启用 cluster 模式
- Redis 密码与节点配置一致性
- Horizon 与业务连接配置隔离
- MOVED/ASK 重定向是否由客户端正确处理
- 故障转移期间业务是否有重试与降级策略

对应主题详见 [高可用架构](高可用架构.md)。

## 十、Laravel 集成清单

| 能力 | Laravel 侧建议 |
|---|---|
| 缓存 | 统一 Cache Service，封装 TTL/空值/预热 |
| 会话 | 单独连接、明确序列化策略 |
| 锁 | 唯一 owner + Lua 解锁 |
| 批量读取 | Pipeline 服务化 |
| 限流/库存 | Lua 服务化 |
| Stream | Worker + ACK + Pending 恢复 |
| 特殊结构 | 语义化 Service 封装 |
| Cluster | 智能客户端 + 故障降级 |

## 十一、关联文章
- [Redis 实战：缓存失效场景深度解析 - KKday B2C API 真实踩坑记录](/2026/06/01/redis-guide-cache/)
- [Laravel B2C API 的 Redis 使用场景：会话/购物车/计次/全页缓存对比](/2026/06/01/redis-use-cases-cachevs/)
- [Predis-Laravel-缓存实战-失效分布式锁性能调优](/2026/06/01/predis-laravel-cacheguide-distributedlock/)
- [Laravel Redis 分布式锁失效场景实战 - KKday B2C API 真实踩坑记录](/2026/06/01/laravel-redis-distributedlockguide/)
- [Redis Stream 实战：消息队列替代方案与消费者组管理 Laravel 踩坑记录](/2026/06/01/redis-stream-guide-laravel/)
- [Redis Bitmap 实战：用户签到/在线状态/特征标记 — Laravel B2C API 踩坑记录](/2026/06/01/redis-bitmap-guide/)
- [Redis-HyperLogLog-实战-UV统计与基数估算-Laravel-B2C-API踩坑记录](/2026/06/01/redis-hyperloglog-guide-uv/)
- [Redis-Geo-实战-地理位置服务与附近的人店功能-Laravel-B2C-API踩坑记录](/2026/06/01/redis-geo-guide/)
- [Redis Cluster 集群部署与故障转移：高可用架构实战踩坑记录](/2026/06/01/redis-cluster-deployment-high-availabilityarchitecture/)
- [Laravel Redis Queue Horizon 实战](/2026/06/01/laravel-redis-queue-horizon-guide-monitoring/) - Redis Queue + Horizon 监控
- [Laravel Horizon 队列监控与生产环境运维](/2026/06/01/laravel-horizon-monitoringguide/) - Horizon 监控运维
- [Laravel Session 深度实战：Redis Session 驱动](/2026/06/07/laravel-session-deep-dive-driver-csrf-distributed/) - Redis Session 驱动与分布式 Session
- [Laravel Task Scheduling onOneServer() Redis 互斥](/2026/06/07/laravel-task-scheduling-ononeserver-redis-mutex/) - Redis Mutex 实现多实例任务去重
- [API Rate Limiting 实战：滑动窗口/令牌桶](/2026/06/01/api-rate-limiting-rate-limitingguide/) - Redis 支撑的 API 限流