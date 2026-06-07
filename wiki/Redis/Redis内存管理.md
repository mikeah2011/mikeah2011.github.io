# Redis 内存管理

## 定义

Redis 内存管理是控制 Redis 实例内存使用、过期数据回收、内存淘汰策略与大 Key 治理的完整机制。Redis 作为内存数据库，内存管理直接影响系统稳定性与性能。

## 核心原理

### 1. 内存分配与统计

Redis 使用 `jemalloc`（默认）或 `libc` 作为内存分配器。通过以下命令查看内存使用：

```bash
redis-cli info memory
# used_memory: 已分配的内存总量
# used_memory_rss: 操作系统视角的内存占用（含碎片）
# mem_fragmentation_ratio: 碎片率 = rss / used_memory
```

**碎片率参考**：
- `< 1`：使用了 swap，性能严重下降
- `1.0 ~ 1.5`：正常范围
- `> 1.5`：碎片率高，考虑重启或开启 `activedefrag`

### 2. 过期数据回收策略

Redis 使用**惰性删除 + 定期删除**两种策略回收过期 Key：

#### 惰性删除（Lazy Expiration）
```
客户端访问 Key → 检查是否过期 → 过期则删除并返回 nil
```
- **优点**：CPU 友好，只在访问时检查
- **缺点**：未访问的过期 Key 会一直占用内存

#### 定期删除（Periodic Deletion）
```
每秒执行 10 次（默认）→ 随机抽取 20 个 Key → 删除其中过期的
→ 如果过期比例 > 25% → 重复执行
```
- **优点**：定期清理，减少内存浪费
- **缺点**：随机采样，可能漏掉部分过期 Key

### 3. 内存淘汰策略（Eviction Policy）

当 Redis 使用内存达到 `maxmemory` 上限时，触发淘汰策略：

| 策略 | 范围 | 算法 | 说明 |
|------|------|------|------|
| `noeviction` | - | - | **默认**。拒绝写入，返回错误 |
| `volatile-lru` | 设置了 expire 的 Key | LRU | 淘汰最近最少使用的过期 Key |
| `allkeys-lru` | 所有 Key | LRU | 淘汰最近最少使用的 Key |
| `volatile-lfu` | 设置了 expire 的 Key | LFU | 淘汰最不经常使用的过期 Key（Redis 4.0+） |
| `allkeys-lfu` | 所有 Key | LFU | 淘汰最不经常使用的 Key（Redis 4.0+） |
| `volatile-random` | 设置了 expire 的 Key | 随机 | 随机淘汰过期 Key |
| `allkeys-random` | 所有 Key | 随机 | 随机淘汰 Key |
| `volatile-ttl` | 设置了 expire 的 Key | TTL | 淘汰最快过期的 Key |

**选型建议**：

| 场景 | 推荐策略 |
|------|---------|
| 缓存场景（可丢失） | `allkeys-lru` 或 `allkeys-lfu` |
| 缓存 + 持久数据混合 | `volatile-lru`（只淘汰有 TTL 的） |
| 访问频率差异大 | `allkeys-lfu`（热点数据保护） |
| 不允许丢失 | `noeviction` + 监控告警 |

**LRU vs LFU**：
- **LRU**（Least Recently Used）：最近最少使用。缺点：偶尔访问的冷数据可能被保留
- **LFU**（Least Frequently Used）：最不经常使用（Redis 4.0+）。更精确地区分热点与冷数据

### 4. 大 Key 问题

#### 什么是大 Key？
- **String 类型**：单个 Key 的 value 超过 10KB
- **集合类型**：Hash/Set/ZSet/List 中元素数量以万为单位

#### 大 Key 的危害
| 问题 | 说明 |
|------|------|
| 客户端超时 | 读写大 Key 耗时长，阻塞其他请求 |
| 带宽/CPU 占用 | IO 操作放大 |
| 数据倾斜 | Cluster 模式下节点负载不均 |
| 删除阻塞 | DEL 大 Key 可能阻塞主线程（Redis 4.0 前） |

#### 发现大 Key
```bash
# 方法 1：redis-cli bigkeys 遍历分析
redis-cli --bigkeys

# 方法 2：redis-rdb-tools 分析 RDB 快照
rdb -c memory dump.rdb --bytes 10240 -f redis_memory.csv

# 方法 3：MEMORY USAGE 命令（单个 Key）
MEMORY USAGE key_name
```

#### 处理大 Key
| 方法 | 适用版本 | 说明 |
|------|---------|------|
| `UNLINK` 命令 | Redis 4.0+ | 异步删除，不阻塞主线程 |
| `SCAN` + 批量删除 | 任意版本 | 增量迭代，避免一次性删除 |
| 压缩 value | String 类型 | 使用序列化/压缩算法减小体积 |
| 分片拆分 | 集合类型 | 将大 Hash/Set 拆分为多个小 Key |
| 渐进式删除 | Hash 类型 | `HSCAN` + `HDEL` 逐批删除 |

### 5. 内存不足处理

当 Redis 报内存不足时的处理步骤：

```
1. 检查 maxmemory 配置 → 是否需要增加
2. 检查内存淘汰策略 → 是否需要改为更激进的策略
3. 排查大 Key → 使用 bigkeys 或 rdb-tools
4. 检查碎片率 → 开启 activedefrag 或重启
5. 考虑集群化 → 横向扩容分摊内存压力
```

### 6. 内存优化技巧

| 技巧 | 说明 |
|------|------|
| 使用 Hash 替代多个 String | Redis 对小 Hash 使用 ziplist 编码，内存效率更高 |
| 设置合理的 maxmemory | 留出 20-30% 给系统和 fork |
| 缩短 Key 名称 | 使用缩写但保持可读性 |
| 使用整数集合 | Set 元素为整数时使用 intset 编码 |
| 开启 maxmemory-policy | 缓存场景必须配置淘汰策略 |

## 相关概念

- [缓存策略](缓存策略.md) - 缓存穿透/击穿/雪崩与内存管理
- [Redis 持久化](Redis持久化.md) - RDB/AOF 与内存的关系
- [性能优化](性能优化.md) - Pipeline、Lua 脚本优化
- [高可用架构](高可用架构.md) - Cluster 分片与内存分布

## 常见问题

### Q: maxmemory 应该设置为多少？
A: 建议设置为物理内存的 70-80%。Redis 需要额外内存用于：fork 子进程（RDB/AOF）、客户端缓冲区、复制缓冲区等。例如 8GB 内存的机器，maxmemory 设置 5-6GB。

### Q: 如何选择 LRU 和 LFU？
A: 如果数据访问模式有明显热点（如商品详情），用 `allkeys-lfu`。如果访问模式较均匀，用 `allkeys-lru`。LFU 是 Redis 4.0+ 的改进版本，更精确但需要更多内存记录访问频率。

### Q: 大 Key 删除为什么会阻塞？
A: Redis 4.0 之前，`DEL` 命令是同步的，删除包含百万元素的 Hash/Set 时会阻塞主线程数秒。Redis 4.0+ 引入 `UNLINK` 命令，异步删除不会阻塞。

### Q: 如何监控内存使用？
A: 使用 `INFO memory` 命令，关注 `used_memory`、`used_memory_rss`、`mem_fragmentation_ratio`、`evicted_keys` 等指标。配合 Prometheus + Grafana 监控内存趋势。

## 相关文章

来源博客文章：
- [Redis全部](/2026/06/01/redis-interview/) - Redis 面试题全集，含内存管理详细对比
- [Redis缓存穿透/击穿/雪崩防护](/2026/06/01/redis-guidecache-penetrationbreakdownavalanche/) - 缓存失效与内存管理
- [Redis 高并发](/2026/06/01/high-concurrency/) - 高并发场景下的内存治理
