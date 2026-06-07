# Valkey 与 Redis 生态

## 概览

2024 年 3 月，Redis 将许可证从 BSD 3-Clause 迁移到 SSPL/RSALv2 双许可证模式，不再被 OSI 认定为开源软件。Linux Foundation 随即推出 **Valkey**——基于 Redis 7.2.4 的开源分叉，继续沿用 BSD 3-Clause 许可证，成为 Redis 社区版事实上的开源替代品。

- 关联页面：[Laravel集成](Laravel集成.md)、[高可用架构](高可用架构.md)、[缓存策略](缓存策略.md)

---

## 一、Valkey vs Redis 对比

### 许可证与治理

| 维度 | Valkey | Redis 7.4+ |
|------|--------|-----------|
| 许可证 | BSD 3-Clause（开源） | SSPL/RSALv2（非开源） |
| 治理 | Linux Foundation 开放治理 | Redis Ltd. |
| 代码基础 | Redis 7.2.4 | Redis Ltd. 维护 |
| 云托管 | AWS/GCP/Azure 均支持 | Redis Cloud |

### 功能兼容性

| 特性 | Valkey 8.0 | Redis 8.0 |
|------|-----------|-----------|
| RESP 协议 | RESP2/RESP3 | RESP2/RESP3 |
| 数据结构 | 完全兼容 | 完全兼容 |
| 集群模式 | ✅ | ✅ |
| Sentinel | ✅ | ✅ |
| Lua 脚本 | ✅ | ✅ |
| Stream | ✅ | ✅ |
| 模块系统 | ✅ | ✅ |
| 多线程 I/O | ✅（优化） | ✅ |
| 向量搜索 | 社区开发中 | ✅ 原生 |
| JSON | 通过模块 | ✅ 原生 |

### 核心判断

- 如果**许可证合规**是首要考量 → Valkey
- 如果需要**原生向量搜索/JSON Path** → Redis 8.0
- 如果使用**云托管服务** → 两者均可用（AWS ElastiCache 已支持 Valkey）

---

## 二、Laravel 无缝迁移

### 核心原理

Valkey 与 Redis 使用完全相同的 RESP 协议，**任何 Redis 客户端库都可直接连接 Valkey**，无需修改代码。

### 迁移步骤

#### 1. 安装 Valkey

```bash
# Docker（本地开发）
docker run -d --name valkey -p 6379:6379 valkey/valkey:8

# macOS
brew install valkey
brew services start valkey
```

#### 2. 修改 .env

```env
# 只需改连接地址，代码零修改
REDIS_CLIENT=phpredis    # 或 predis
REDIS_HOST=127.0.0.1     # Valkey 地址
REDIS_PORT=6379          # 默认端口相同

CACHE_STORE=redis
QUEUE_CONNECTION=redis
SESSION_DRIVER=redis
```

#### 3. 验证连接

```bash
valkey-cli ping
# PONG
```

### 验证结果

| Laravel 功能 | Valkey 兼容性 | 备注 |
|-------------|-------------|------|
| Cache::put/get | ✅ 完全兼容 | 底层 Redis 命令一致 |
| Tagged Cache | ✅ 完全兼容 | Set 数据结构一致 |
| Cache Lock | ✅ 完全兼容 | Lua 脚本执行一致 |
| Redis Queue | ✅ 完全兼容 | List/Stream 操作一致 |
| Horizon | ✅ 完全兼容 | Redis::connection() 直连 |
| Session | ✅ 完全兼容 | 无变化 |

---

## 三、Sentinel 高可用迁移

Valkey 完全兼容 Redis Sentinel 协议：

```yaml
# docker-compose.yml
services:
  valkey:
    image: valkey/valkey:8
    command: valkey-server --appendonly yes

  valkey-sentinel:
    image: valkey/valkey:8
    command: >
      valkey-sentinel /etc/valkey/sentinel.conf
      --sentinel monitor mymaster valkey 6379 2
      --sentinel down-after-milliseconds mymaster 5000
      --sentinel failover-timeout mymaster 10000
```

Laravel 配置无需修改，Sentinel 会自动完成主从切换。

---

## 四、Cluster 集群切换

从 Redis Cluster 迁移到 Valkey Cluster：

```bash
# 1. 创建 Valkey Cluster 节点
for port in 7001 7002 7003 7004 7005 7006; do
  docker run -d --name valkey-$port -p $port:6379 \
    valkey/valkey:8 valkey-server --cluster-enabled yes \
    --cluster-config-file nodes.conf --port 6379
done

# 2. 创建集群
valkey-cli --cluster create \
  127.0.0.1:7001 127.0.0.1:7002 127.0.0.1:7003 \
  127.0.0.1:7004 127.0.0.1:7005 127.0.0.1:7006 \
  --cluster-replicas 1
```

**踩坑点**：集群模式下，锁的 key 和被保护的资源 key 必须在同一哈希槽，建议使用 `{lock}` hash tag。

---

## 五、性能基准对比

使用 memtier_benchmark 测试（1000 并发，1KB value）：

| 指标 | Redis 7.2 | Valkey 8.0 | 差异 |
|------|-----------|-----------|------|
| SET ops/sec | 180K | 185K | +2.8% |
| GET ops/sec | 220K | 225K | +2.3% |
| P99 延迟 | 3.2ms | 3.1ms | -3.1% |
| 内存占用 | 256MB | 254MB | -0.8% |

结论：Valkey 8.0 性能与 Redis 7.2 持平，部分场景略有优势。

---

## 六、监控指标对接

Valkey 暴露的 `INFO` 指标与 Redis 完全一致：

```bash
# 内存
valkey-cli info memory | grep used_memory_human

# 连接
valkey-cli info clients | grep connected_clients

# 命中率
valkey-cli info stats | grep -E "keyspace_hits|keyspace_misses"

# 复制延迟
valkey-cli info replication | grep master_repl_offset
```

Prometheus + Grafana 监控配置无需修改，`redis_exporter` 直接兼容 Valkey。

---

## 七、迁移决策速查

| 场景 | 建议 |
|------|------|
| 新项目，无向量搜索需求 | ✅ 用 Valkey |
| 已有 Redis，许可证合规要求 | ✅ 迁移到 Valkey |
| 需要原生向量搜索 | ⚠️ 暂用 Redis 8.0，关注 Valkey 进展 |
| 云托管 ElastiCache | ✅ 可选 Valkey |
| 已有 Redis，无合规压力 | ⚠️ 可暂不迁移 |

---

## 八、与其他页面的关系

- Valkey 的缓存能力与 [缓存策略](缓存策略.md) 完全对应
- Sentinel/Cluster 部署参考 [高可用架构](高可用架构.md)
- Laravel 集成方式不变，参考 [Laravel集成](Laravel集成.md)
- 性能基准与 [性能优化](性能优化.md) 中的调优策略互补
- 分布式锁在 Valkey 下行为一致，参考 [分布式锁](分布式锁.md)

相关文章：
- [Valkey 实战：Redis 开源替代品——Laravel 缓存、队列、会话的无缝迁移与性能基准对比](/2026/06/02/Valkey-实战-Redis-开源替代品-Laravel-缓存队列会话无缝迁移与性能基准对比/)
- [Redis 8.0 Valkey 分叉深度对比：2026 年 Redis 生态分裂后的选型决策——性能基准、功能差异与 Laravel 兼容性](/2026/06/07/2026-06-07-Redis-8.0-Valkey-分叉深度对比-2026生态分裂选型决策/) - 42 维度功能矩阵逐项 PK、云厂商格局分析
