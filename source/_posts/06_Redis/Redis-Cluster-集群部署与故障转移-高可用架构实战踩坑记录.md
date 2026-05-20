---
title: Redis Cluster 集群部署与故障转移：高可用架构实战踩坑记录
date: 2026-05-05 07:10:43
updated: 2026-05-05 07:13:41
categories:
  - Redis
  - 高可用
tags: [Laravel, Redis, 微服务]
description: 在 KKday B2C API 生产环境中部署和运维 Redis Cluster 的实战经验，涵盖集群架构设计、Laravel Predis 集成、故障转移测试、监控告警与真实踩坑记录。
---

# Redis Cluster 集群部署与故障转移：高可用架构实战踩坑记录

## 前言：为什么单实例 Redis 已经不够用了？

在 KKday B2C API 项目早期，我们用单实例 Redis + Sentinel 哨兵模式撑过了前两年的业务增长。但随着日活突破 50 万、Redis 从缓存扩展到分布式锁、Session、排行榜、限流计数器等多种角色后，单实例架构的瓶颈暴露无遗：

- **内存天花板**：单实例内存上限 64GB，数据量逼近阈值
- **写入瓶颈**：所有写操作集中在单节点，QPS 高峰期 CPU 打满
- **Sentinel 切换延迟**：主从切换需要 10-30 秒，期间请求超时
- **扩容困难**：无法水平扩展，只能垂直升级硬件

这篇文章记录了我们从 Sentinel 模式迁移到 Redis Cluster 的完整过程，包括架构设计、部署配置、Laravel 集成、故障转移测试和生产环境踩过的每一个坑。

---

## 一、架构设计：Cluster vs Sentinel 选型

### 架构对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sentinel 模式（旧架构）                        │
│                                                                 │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐               │
│   │Sentinel1│      │Sentinel2│      │Sentinel3│               │
│   └────┬────┘      └────┬────┘      └────┬────┘               │
│        │                │                │                     │
│        └────────────────┼────────────────┘                     │
│                         │ 监控                                   │
│        ┌────────────────┼────────────────┐                     │
│        │                │                │                     │
│   ┌────▼────┐      ┌────▼────┐      ┌────▼────┐               │
│   │ Master  │──────│ Slave 1 │──────│ Slave 2 │               │
│   │ (全量)  │  复制 │         │  复制 │         │               │
│   └─────────┘      └─────────┘      └─────────┘               │
│   所有数据在一个主节点，垂直扩展受限                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Cluster 模式（新架构）                         │
│                                                                 │
│   ┌──────────────────────────────────────────┐                 │
│   │              Hash Slot 分片                │                 │
│   │   [0-5460]    [5461-10922]   [10923-16383]│                 │
│   └────────┬──────────────┬──────────────┬────┘                 │
│            │              │              │                      │
│       ┌────▼────┐   ┌────▼────┐   ┌────▼────┐                 │
│       │Master 1 │   │Master 2 │   │Master 3 │                 │
│       │ :7001   │   │ :7002   │   │ :7003   │                 │
│       └────┬────┘   └────┬────┘   └────┬────┘                 │
│            │              │              │                      │
│       ┌────▼────┐   ┌────▼────┐   ┌────▼────┐                 │
│       │Slave 1a │   │Slave 2a │   │Slave 3a │                 │
│       │ :7004   │   │ :7005   │   │ :7006   │                 │
│       └─────────┘   └─────────┘   └─────────┘                 │
│   水平扩展：每组分片独立读写，自动故障转移                         │
└─────────────────────────────────────────────────────────────────┘
```

### 选型决策

| 维度 | Sentinel | Cluster |
|------|----------|---------|
| 数据分片 | ❌ 不支持 | ✅ 16384 个 slot 自动分片 |
| 水平扩展 | ❌ 只能垂直升级 | ✅ 在线增删节点 |
| 写入吞吐 | 单节点瓶颈 | 分片后线性提升 |
| 故障转移 | 10-30 秒 | 通常 < 3 秒 |
| 多 key 操作 | ✅ 无限制 | ⚠️ 必须在同一 slot（用 `{tag}`） |
| 事务/Lua | ✅ 无限制 | ⚠️ 所有 key 必须在同一 slot |
| 运维复杂度 | 低 | 中高 |

**我们的决策**：当 Redis 同时承担缓存、Session、分布式锁、队列等多种角色，且写入 QPS > 5 万时，Cluster 是唯一选择。

---

## 二、集群部署：6 节点 3 主 3 从

### 2.1 环境准备

```bash
# 每台服务器安装 Redis 7.x（以 Ubuntu 为例）
sudo apt update && sudo apt install redis-server -y
redis-server --version
# Redis server v=7.2.4 sha=00000000:0 malloc=jemalloc-5.3.0 bits=64

# 创建集群目录（每台服务器 2 个实例：1 主 + 1 从）
mkdir -p /data/redis-cluster/{7001,7002}
```

### 2.2 集群配置模板

```conf
# /data/redis-cluster/7001/redis.conf
port 7001
bind 0.0.0.0
daemonize yes
pidfile /data/redis-cluster/7001/redis.pid
logfile /data/redis-cluster/7001/redis.log
dir /data/redis-cluster/7001

# === 集群核心配置 ===
cluster-enabled yes
cluster-config-file nodes-7001.conf
cluster-node-timeout 15000

# === 持久化策略 ===
appendonly yes
appendfsync everysec
save 900 1
save 300 10
save 60 10000

# === 内存管理 ===
maxmemory 16gb
maxmemory-policy allkeys-lru

# === 安全配置 ===
requirepass YourStrongPassword123!
masterauth YourStrongPassword123!

# === 性能调优 ===
tcp-backlog 511
tcp-keepalive 300
hll-sparse-max-bytes 3000
```

> **踩坑 #1**：`requirepass` 和 `masterauth` 必须同时设置且密码一致。我们第一次部署时只设了 `requirepass`，导致主从复制认证失败，Slave 一直连不上 Master，日志里只有 `MASTER aborted replication` 的模糊错误。

### 2.3 创建集群

```bash
# 启动所有节点
for port in 7001 7002 7003 7004 7005 7006; do
  redis-server /data/redis-cluster/${port}/redis.conf
done

# 创建集群（3 主 3 从，自动分配主从关系）
redis-cli -a YourStrongPassword123! --cluster create \
  10.0.1.10:7001 10.0.1.11:7002 10.0.1.12:7003 \
  10.0.1.13:7004 10.0.1.14:7005 10.0.1.15:7006 \
  --cluster-replicas 1 \
  --cluster-yes

# 验证集群状态
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 cluster info
# cluster_state:ok
# cluster_slots_assigned:16384
# cluster_slots_ok:16384
# cluster_known_nodes:6

# 查看节点角色分配
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 cluster nodes
# a1b2c3d4... 10.0.1.10:7001@17001 master - 0 1714876200000 1 connected 0-5460
# e5f6g7h8... 10.0.1.11:7002@17002 master - 0 1714876200000 2 connected 5461-10922
# i9j0k1l2... 10.0.1.12:7003@17003 master - 0 1714876200000 3 connected 10923-16383
# m3n4o5p6... 10.0.1.13:7004@17004 slave a1b2c3d4... 0 1714876200000 1 connected
# q7r8s9t0... 10.0.1.14:7005@17005 slave e5f6g7h8... 0 1714876200000 2 connected
# u1v2w3x4... 10.0.1.15:7006@17006 slave i9j0k1l2... 0 1714876200000 3 connected
```

> **踩坑 #2**：`cluster-node-timeout` 默认 15 秒太长了。在网络抖动频繁的云环境中，我们将其调到 10 秒（`cluster-node-timeout 10000`），平衡了误判率和故障恢复速度。设太短（如 5 秒）会导致网络抖动时频繁触发 failover。

---

## 三、Laravel 集成：Predis 集群配置

### 3.1 config/database.php 配置

```php
// config/database.php
'redis' => [

    'client' => env('REDIS_CLIENT', 'predis'),

    'options' => [
        'cluster' => env('REDIS_CLUSTER', 'redis'),
        'parameters' => [
            'password' => env('REDIS_PASSWORD', ''),
            'scheme'   => env('REDIS_SCHEME', 'tcp'),
        ],
        'ssl' => [
            'verify_peer' => false,
        ],
    ],

    'clusters' => [
        'default' => [
            [
                'host'     => env('REDIS_HOST_1', '10.0.1.10'),
                'password' => env('REDIS_PASSWORD', ''),
                'port'     => env('REDIS_PORT_1', 7001),
                'database' => 0,
            ],
            [
                'host'     => env('REDIS_HOST_2', '10.0.1.11'),
                'password' => env('REDIS_PASSWORD', ''),
                'port'     => env('REDIS_PORT_2', 7002),
                'database' => 0,
            ],
            [
                'host'     => env('REDIS_HOST_3', '10.0.1.12'),
                'password' => env('REDIS_PASSWORD', ''),
                'port'     => env('REDIS_PORT_3', 7003),
                'database' => 0,
            ],
        ],
    ],
],
```

### 3.2 Hash Tag 强制路由

Redis Cluster 的多 key 操作要求所有 key 在同一个 slot。使用 `{tag}` 语法可以强制路由：

```php
// ❌ 错误：两个 key 可能在不同 slot，MGET 会报 CROSSSLOT 错误
Redis::mget(['user:1001:profile', 'user:1001:cart']);

// ✅ 正确：使用 {user:1001} 前缀，确保同一用户的所有 key 落在同一 slot
Redis::mget(['{user:1001}:profile', '{user:1001}:cart']);

// ✅ 分布式锁也必须用 hash tag
$lockKey = '{order:' . $orderId . '}:lock';
$lock = Redis::set($lockKey, $requestId, 'NX', 'EX', 30);
```

> **踩坑 #3**：我们在迁移初期没有统一 hash tag 规范，导致 `Redis::eval()` 执行 Lua 脚本时频繁报 `CROSSSLOT` 错误。解决方案是制定全局 key 命名规范：`{业务}:{ID}:{子资源}`，所有需要原子操作的 key 共享同一个 `{业务}:{ID}` 前缀。

### 3.3 Predis 集群模式陷阱

```php
// config/database.php — 使用 predis 的 cluster 连接方式
'client' => 'predis',

// 但更推荐使用 phpredis 扩展（C 扩展，性能更好）
'client' => 'phpredis',
```

> **踩坑 #4**：Predis 是纯 PHP 实现，在高并发场景下性能不如 phpredis（C 扩展）。我们从 Predis 切换到 phpredis 后，Redis 操作的 P99 延迟从 12ms 降到 3ms。切换时注意 phpredis 的集群配置语法不同，需要在 `config/database.php` 中使用 `'redis' => 'phpredis'` 并通过 `RedisCluster` 类连接。

---

## 四、故障转移测试：模拟真实故障

### 4.1 手动故障转移

```bash
# 在 Slave 节点上执行手动故障转移（安全模式，等待数据同步完成）
redis-cli -a YourStrongPassword123! -h 10.0.1.13 -p 7004 cluster failover

# 验证角色切换
redis-cli -a YourStrongPassword123! -h 10.0.1.13 -p 7004 role
# 1) "master"
# 2) (integer) 5460
# 3) 1) 1) "10.0.1.10"
#       2) "7001"
#       3) "42"
```

### 4.2 模拟主节点宕机

```bash
# 直接 kill Master 1 的进程
redis-cli -a YourStrongPassword123! -h 10.0.1.10 -p 7001 debug sleep 30

# 观察集群状态变化（在另一个终端）
watch -n 1 'redis-cli -a YourStrongPassword123! -h 10.0.1.11 -p 7002 cluster nodes | grep -E "master|fail"'

# 预期结果：约 10-15 秒后，Slave 7004 提升为新 Master
# m3n4o5p6... 10.0.1.13:7004@17004 master - 0 ... connected 0-5460
# a1b2c3d4... 10.0.1.10:7001@17001 master,fail - ... disconnected
```

### 4.3 客户端感知测试

```php
// 测试脚本：持续写入，观察故障转移期间的错误
for ($i = 0; $i < 1000; $i++) {
    try {
        Redis::set("test:key:{$i}", $i);
        echo ".";
    } catch (\Exception $e) {
        echo "X"; // 故障转移期间会打几个 X
        usleep(100000); // 100ms 后重试
    }
    usleep(10000); // 10ms 间隔
}
```

> **踩坑 #5**：Predis 在遇到 `MOVED` 或 `ASK` 重定向时会自动重试，但在故障转移瞬间（约 1-3 秒窗口），可能抛出 `ConnectionException`。我们的解决方案是在 Laravel 中配置重试中间件：

```php
// app/Http/Middleware/RedisRetryMiddleware.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Log;
use Predis\Connection\ConnectionException;

class RedisRetryMiddleware
{
    public function handle($request, Closure $next)
    {
        $maxRetries = 3;
        $retryDelay = 200; // ms

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                return $next($request);
            } catch (ConnectionException $e) {
                if ($attempt === $maxRetries) {
                    Log::error("Redis 集群连接失败，已重试 {$maxRetries} 次", [
                        'error' => $e->getMessage(),
                        'attempt' => $attempt,
                    ]);
                    throw $e;
                }
                Log::warning("Redis 集群连接异常，第 {$attempt} 次重试", [
                    'error' => $e->getMessage(),
                ]);
                usleep($retryDelay * 1000);
            }
        }
    }
}
```

---

## 五、监控与告警

### 5.1 关键指标

```bash
# 集群健康检查脚本（加入 Cron）
#!/bin/bash
CLUSTER_INFO=$(redis-cli -a "$REDIS_AUTH" -h 10.0.1.10 -p 7001 cluster info)
STATE=$(echo "$CLUSTER_INFO" | grep cluster_state | cut -d: -f2 | tr -d '\r')
SLOTS_OK=$(echo "$CLUSTER_INFO" | grep cluster_slots_ok | cut -d: -f2 | tr -d '\r')

if [ "$STATE" != "ok" ] || [ "$SLOTS_OK" != "16384" ]; then
    echo "ALERT: Redis Cluster 状态异常! state=$STATE slots_ok=$SLOTS_OK"
    # 发送 Slack/钉钉告警
    curl -X POST "$SLACK_WEBHOOK" -d "{\"text\":\"🔴 Redis Cluster 异常: state=$STATE slots_ok=$SLOTS_OK\"}"
fi
```

### 5.2 Grafana + Prometheus 监控面板

```yaml
# docker-compose.yml — redis-exporter
services:
  redis-exporter:
    image: oliver006/redis_exporter:latest
    environment:
      REDIS_ADDR: "redis://10.0.1.10:7001,redis://10.0.1.11:7002,redis://10.0.1.12:7003"
      REDIS_PASSWORD: "YourStrongPassword123!"
    ports:
      - "9121:9121"
```

核心监控指标：
- `redis_cluster_state` — 集群状态（1=ok, 0=fail）
- `redis_cluster_slots_ok` — 正常 slot 数量（应为 16384）
- `redis_connected_clients` — 连接数
- `redis_used_memory_bytes` — 内存使用量
- `redis_commands_processed_total` — 命令处理总量
- `redis_keyspace_hits_ratio` — 缓存命中率

> **踩坑 #6**：不要只监控单个节点。我们曾经只监控 Master 节点，结果 Slave 节点内存泄漏了三天都没发现。现在每个节点都配置了独立的告警阈值。

---

## 六、运维踩坑汇总

| # | 问题 | 根因 | 解决方案 |
|---|------|------|----------|
| 1 | Slave 无法连接 Master | 只设了 requirepass 没设 masterauth | 两个配置都要设，且密码一致 |
| 2 | 频繁误判节点下线 | cluster-node-timeout 太短 | 调整为 10000ms，云环境经验值 |
| 3 | Lua 脚本报 CROSSSLOT | key 命名没有统一 hash tag | 制定 `{业务}:{ID}:{子资源}` 规范 |
| 4 | Predis 性能瓶颈 | 纯 PHP 实现，CPU 密集 | 切换到 phpredis C 扩展 |
| 5 | 故障转移瞬间请求失败 | 客户端没有重试机制 | 加入 RedisRetryMiddleware |
| 6 | Slave 内存泄漏未发现 | 只监控了 Master 节点 | 所有节点独立监控 + 告警 |

---

## 七、从 Sentinel 迁移的 Checklist

1. **数据迁移**：用 `redis-cli --cluster import` 从旧实例导入数据
2. **双写期**：新旧集群同时写入 1-2 周，验证数据一致性
3. **灰度切读**：先将读流量切到 Cluster，观察 24 小时
4. **全量切换**：读写全部切到 Cluster
5. **旧集群保留**：保留 7 天，确认无回滚需求后下线
6. **监控验证**：对比新旧集群的 QPS、延迟、内存指标

---

## 总结

Redis Cluster 不是银弹，它引入了 hash slot 约束、跨 slot 操作限制、更复杂的运维成本。但当你的 Redis 承担了缓存 + Session + 分布式锁 + 限流 + 排行榜等多种角色，且单实例 QPS 逼近 5 万、内存逼近 64GB 时，Cluster 是唯一能水平扩展的方案。

关键 takeaway：
- **Hash Tag 是 Cluster 的灵魂**，不统一命名规范就是在给自己挖坑
- **故障转移测试必须在上线前做**，不是「应该做」而是「必须做」
- **监控要覆盖所有节点**，不能只看 Master
- **phpredis > Predis**，性能差 3-4 倍不是小事
- **客户端重试机制是标配**，故障转移窗口期必然有请求失败

---

*本文基于 KKday B2C API 项目的真实 Redis Cluster 部署经验，所有配置和踩坑记录均来自生产环境。*
