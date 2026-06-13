---

title: Redis Cluster 集群部署与故障转移：高可用架构实战踩坑记录
keywords: [Redis Cluster, 集群部署与故障转移, 高可用架构实战踩坑记录]
date: 2026-05-05 07:10:43
updated: 2026-05-05 07:13:41
categories:
- database
tags:
- Laravel
- Redis
- 微服务
- Redis Cluster
- 高可用
- 故障转移
description: Redis Cluster 集群部署与高可用架构实战指南。基于 KKday B2C API 生产环境经验，详解 Redis Cluster 集群部署完整流程与六节点三主三从架构设计、16384 哈希槽分片原理与数据路由机制、Docker Compose 快速搭建集群开发环境、Laravel 框架中 Predis 与 phpredis 扩展的集群模式配置及 Hash Tag 路由技巧。深入讲解故障转移测试方法与自动 Failover 触发机制，涵盖手动故障转移、主节点宕机模拟与客户端重试策略实现。全面对比 Redis Sentinel 哨兵模式、Redis Cluster 集群模式与 Redis Proxy 代理三种高可用方案选型。提供 Prometheus 加 Grafana 生产监控告警完整配置方案，收录真实踩坑案例与多种故障恢复场景，助力开发者高效完成 Redis 集群部署与高可用架构落地。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-001-content-1.jpg
- /images/content/databases-001-content-2.jpg
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

![Redis Cluster 集群架构](/images/content/databases-001-content-1.jpg)

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

![Redis 集群部署配置](/images/content/databases-001-content-2.jpg)

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

## 八、Docker Compose 快速搭建 6 节点集群

开发和测试环境可以快速用 Docker Compose 搭建完整的 6 节点 Redis Cluster：

```yaml
# docker-compose.yml — Redis Cluster 6 节点（3 Master + 3 Replica）
version: "3.8"

services:
  redis-node-1:
    image: redis:7.2-alpine
    container_name: redis-node-1
    command: >
      redis-server
      --port 7001
      --cluster-enabled yes
      --cluster-config-file nodes.conf
      --cluster-node-timeout 10000
      --appendonly yes
      --requirepass YourStrongPassword123!
      --masterauth YourStrongPassword123!
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    ports:
      - "7001:7001"
      - "17001:17001"
    volumes:
      - redis-data-1:/data
    networks:
      redis-cluster:
        ipv4_address: 172.20.0.11

  redis-node-2:
    image: redis:7.2-alpine
    container_name: redis-node-2
    command: >
      redis-server
      --port 7002
      --cluster-enabled yes
      --cluster-config-file nodes.conf
      --cluster-node-timeout 10000
      --appendonly yes
      --requirepass YourStrongPassword123!
      --masterauth YourStrongPassword123!
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    ports:
      - "7002:7002"
      - "17002:17002"
    volumes:
      - redis-data-2:/data
    networks:
      redis-cluster:
        ipv4_address: 172.20.0.12

  redis-node-3:
    image: redis:7.2-alpine
    container_name: redis-node-3
    command: >
      redis-server
      --port 7003
      --cluster-enabled yes
      --cluster-config-file nodes.conf
      --cluster-node-timeout 10000
      --appendonly yes
      --requirepass YourStrongPassword123!
      --masterauth YourStrongPassword123!
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    ports:
      - "7003:7003"
      - "17003:17003"
    volumes:
      - redis-data-3:/data
    networks:
      redis-cluster:
        ipv4_address: 172.20.0.13

  redis-node-4:
    image: redis:7.2-alpine
    container_name: redis-node-4
    command: >
      redis-server
      --port 7004
      --cluster-enabled yes
      --cluster-config-file nodes.conf
      --cluster-node-timeout 10000
      --appendonly yes
      --requirepass YourStrongPassword123!
      --masterauth YourStrongPassword123!
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    ports:
      - "7004:7004"
      - "17004:17004"
    volumes:
      - redis-data-4:/data
    networks:
      redis-cluster:
        ipv4_address: 172.20.0.14

  redis-node-5:
    image: redis:7.2-alpine
    container_name: redis-node-5
    command: >
      redis-server
      --port 7005
      --cluster-enabled yes
      --cluster-config-file nodes.conf
      --cluster-node-timeout 10000
      --appendonly yes
      --requirepass YourStrongPassword123!
      --masterauth YourStrongPassword123!
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    ports:
      - "7005:7005"
      - "17005:17005"
    volumes:
      - redis-data-5:/data
    networks:
      redis-cluster:
        ipv4_address: 172.20.0.15

  redis-node-6:
    image: redis:7.2-alpine
    container_name: redis-node-6
    command: >
      redis-server
      --port 7006
      --cluster-enabled yes
      --cluster-config-file nodes.conf
      --cluster-node-timeout 10000
      --appendonly yes
      --requirepass YourStrongPassword123!
      --masterauth YourStrongPassword123!
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    ports:
      - "7006:7006"
      - "17006:17006"
    volumes:
      - redis-data-6:/data
    networks:
      redis-cluster:
        ipv4_address: 172.20.0.16

  # 自动初始化集群
  redis-cluster-init:
    image: redis:7.2-alpine
    container_name: redis-cluster-init
    depends_on:
      - redis-node-1
      - redis-node-2
      - redis-node-3
      - redis-node-4
      - redis-node-5
      - redis-node-6
    command: >
      sh -c "sleep 5 && redis-cli -a YourStrongPassword123!
      --cluster create
      172.20.0.11:7001 172.20.0.12:7002 172.20.0.13:7003
      172.20.0.14:7004 172.20.0.15:7005 172.20.0.16:7006
      --cluster-replicas 1 --cluster-yes"
    networks:
      redis-cluster:
        ipv4_address: 172.20.0.20

volumes:
  redis-data-1:
  redis-data-2:
  redis-data-3:
  redis-data-4:
  redis-data-5:
  redis-data-6:

networks:
  redis-cluster:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/24
```

```bash
# 启动集群
docker compose up -d

# 等待初始化完成后验证
docker exec redis-node-1 redis-cli -a YourStrongPassword123! -p 7001 cluster info
# cluster_state:ok
# cluster_slots_assigned:16384
# cluster_slots_ok:16384
# cluster_known_nodes:6
```

> **踩坑 #7**：Docker 环境中 `cluster-announce-ip` 和 `cluster-announce-port` 很重要。如果容器 IP 与宿主机映射不同，客户端会连接失败。生产环境建议在 `redis.conf` 中显式配置 `cluster-announce-ip`。

---

## 九、集群 Rebalancing 与 Slot 迁移

### 9.1 添加新节点并 Rebalance

```bash
# 1. 启动新节点（假设 10.0.1.16:7007）
redis-server /data/redis-cluster/7007/redis.conf

# 2. 将新节点加入集群
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 \
  cluster meet 10.0.1.16 7007

# 3. 自动 Rebalance（均衡分配 slot）
redis-cli -a YourStrongPassword123! --cluster rebalance \
  10.0.1.10:7001 --cluster-use-empty-masters

# 4. 为新 Master 添加 Replica
redis-cli -a YourStrongPassword123! -c -h 10.0.1.16 -p 7007 \
  cluster replicate <new-master-node-id>
```

### 9.2 手动 Slot 迁移脚本

```bash
#!/bin/bash
# slot-migrate.sh — 将 slot 从源节点迁移到目标节点
# 用法: ./slot-migrate.sh <slot> <source-ip:port> <target-ip:port>
SLOT=$1
SOURCE=$2
TARGET=$3
AUTH="YourStrongPassword123!"

# 获取目标节点 ID
TARGET_ID=$(redis-cli -a "$AUTH" -c -h ${TARGET%:*} -p ${TARGET#*:} cluster myid)

# 设置 slot 导入状态
redis-cli -a "$AUTH" -c -h ${TARGET%:*} -p ${TARGET#*:} \
  cluster setslot $SLOT importing <source-node-id>

# 设置 slot 导出状态
redis-cli -a "$AUTH" -c -h ${SOURCE%:*} -p ${SOURCE#*:} \
  cluster setslot $SLOT migrating $TARGET_ID

# 迁移 slot 中的所有 key（逐个迁移）
while true; do
  KEY=$(redis-cli -a "$AUTH" -c -h ${SOURCE%:*} -p ${SOURCE#*:} \
    cluster countkeysinslot $SLOT)
  if [ "$KEY" -eq 0 ]; then
    break
  fi
  # 获取 slot 中一个 key
  KEYS=$(redis-cli -a "$AUTH" -c -h ${SOURCE%:*} -p ${SOURCE#*:} \
    cluster getkeysinslot $SLOT 1)
  for k in $KEYS; do
    redis-cli -a "$AUTH" -c -h ${SOURCE%:*} -p ${SOURCE#*:} \
      --cluster import ${TARGET%:*}:${TARGET#*:} \
      --cluster-from <source-node-id> \
      --cluster-replace
  done
done

# 通知所有节点 slot 归属变更
for node in $(redis-cli -a "$AUTH" -c -h ${SOURCE%:*} -p ${SOURCE#*:} cluster nodes | awk '{print $2}'); do
  redis-cli -a "$AUTH" -c -h ${node%:*} -p ${node#*:} \
    cluster setslot $SLOT node $TARGET_ID
done

echo "Slot $SLOT migrated from $SOURCE to $TARGET"
```

### 9.3 删除节点

```bash
# 先将该节点的 slot 迁移到其他节点
redis-cli -a YourStrongPassword123! --cluster reshard 10.0.1.10:7001 \
  --cluster-from <node-id-to-remove> \
  --cluster-to <target-node-id> \
  --cluster-slots <number-of-slots> \
  --cluster-yes

# 从集群中移除节点
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 \
  cluster forget <node-id-to-remove>
```

---

## 十、高可用方案全面对比

| 维度 | Redis Sentinel | Redis Cluster | Redis Proxy（如 Twemproxy/Codis） |
|------|---------------|---------------|----------------------------------|
| **数据分片** | ❌ 不支持 | ✅ 16384 slot 自动分片 | ✅ 一致性 Hash 分片 |
| **水平扩展** | ❌ 只能垂直升级 | ✅ 在线增删节点 | ✅ 但需重启 Proxy |
| **写入吞吐** | 单节点瓶颈 | 分片后线性提升 | 受 Proxy 层瓶颈限制 |
| **故障转移** | 10-30 秒（Sentinel 投票） | 通常 < 3 秒（gossip 协议） | 依赖后端 Sentinel/Cluster |
| **多 key 操作** | ✅ 无限制 | ⚠️ 必须同一 slot（用 `{tag}`） | ⚠️ 取决于 Proxy 实现 |
| **事务/Lua** | ✅ 无限制 | ⚠️ 所有 key 必须同一 slot | ❌ 大部分 Proxy 不支持 |
| **客户端兼容** | ✅ 普通 Redis 客户端 | ⚠️ 需要 Cluster 模式客户端 | ✅ 普通 Redis 客户端 |
| **运维复杂度** | 低 | 中高 | 中（需维护 Proxy 集群） |
| **适用场景** | 小规模、读多写少 | 大规模、高并发读写 | 兼容旧客户端、快速分片 |
| **生产案例** | < 20GB 数据 | 20GB~500GB+ | 需要平滑过渡的存量系统 |

> **选型建议**：如果你的系统还在成长期且数据量 < 20GB，Sentinel 足够；如果需要水平扩展且能接受 Cluster 客户端改造，直接上 Cluster；如果团队对 Cluster 不熟悉但急需分片，Proxy 方案可以作为过渡。我们的最终选择是 Redis Cluster，因为 Laravel 生态已经有成熟的 Predis/phpredis Cluster 支持。

---

## 十一、生产监控：redis-exporter + Prometheus + Grafana

### 11.1 完整 docker-compose 监控栈

```yaml
# docker-compose.monitoring.yml
version: "3.8"

services:
  # Redis Exporter — 采集所有集群节点指标
  redis-exporter:
    image: oliver006/redis_exporter:v1.58.0
    container_name: redis-exporter
    environment:
      # 多节点监控：逗号分隔
      REDIS_ADDR: "redis://10.0.1.10:7001,redis://10.0.1.11:7002,redis://10.0.1.12:7003,redis://10.0.1.13:7004,redis://10.0.1.14:7005,redis://10.0.1.15:7006"
      REDIS_PASSWORD: "YourStrongPassword123!"
      REDIS_EXPORTER_CHECK_KEY_PATTERN: "___key*"
      REDIS_EXPORTER_INCL_SYSTEM_METRICS: "true"
    ports:
      - "9121:9121"
    restart: unless-stopped
    networks:
      - monitoring

  # Prometheus — 时序数据存储
  prometheus:
    image: prom/prometheus:v2.49.0
    container_name: prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"
    restart: unless-stopped
    networks:
      - monitoring

  # Grafana — 可视化面板
  grafana:
    image: grafana/grafana:10.3.1
    container_name: grafana
    environment:
      GF_SECURITY_ADMIN_PASSWORD: "admin123"
      GF_INSTALL_PLUGINS: "redis-datasource"
    volumes:
      - grafana-data:/var/lib/grafana
    ports:
      - "3000:3000"
    restart: unless-stopped
    networks:
      - monitoring

volumes:
  prometheus-data:
  grafana-data:

networks:
  monitoring:
    driver: bridge
```

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "redis_alert_rules.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

scrape_configs:
  - job_name: "redis-cluster"
    static_configs:
      - targets: ["redis-exporter:9121"]
        labels:
          cluster: "kkday-b2c"
```

```yaml
# redis_alert_rules.yml — 告警规则
groups:
  - name: redis_cluster_alerts
    rules:
      - alert: RedisClusterStateAbnormal
        expr: redis_cluster_state != 1
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Redis Cluster 状态异常 ({{ $labels.instance }})"
          description: "cluster_state 不为 ok，当前值: {{ $value }}"

      - alert: RedisClusterSlotsMissing
        expr: redis_cluster_slots_ok < 16384
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Redis Cluster slot 不完整"
          description: "正常 slot 数: {{ $value }}，应为 16384"

      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis 内存使用超过 85% ({{ $labels.instance }})"

      - alert: RedisDown
        expr: up{job="redis-cluster"} == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Redis 节点宕机 ({{ $labels.instance }})"

      - alert: RedisHighLatency
        expr: redis_commands_duration_seconds_total / redis_commands_processed_total > 0.01
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis 命令延迟过高 ({{ $labels.instance }})"
          description: "平均延迟 > 10ms"
```

### 11.2 Grafana Dashboard 导入

```bash
# 导入社区 Redis Cluster Dashboard（推荐 Dashboard ID: 11835）
# 在 Grafana UI → Dashboards → Import → 输入 ID 11835

# 或通过 API 导入
curl -X POST http://admin:admin123@localhost:3000/api/dashboards/import \
  -H "Content-Type: application/json" \
  -d '{"dashboard": {"id": 11835}, "overwrite": true, "inputs": [{"name": "DS_PROMETHEUS", "type": "datasource", "pluginId": "prometheus", "value": "Prometheus"}]}'
```

核心监控面板包含：
- **集群概览**：总节点数、在线节点数、slot 分配状态
- **内存趋势**：每个节点的 `used_memory`、`used_memory_rss`、内存碎片率
- **QPS 分布**：每个分片的 `instantaneous_ops_per_sec`
- **命中率**：`keyspace_hits / (keyspace_hits + keyspace_misses)`
- **连接数**：`connected_clients`、`blocked_clients`
- **持久化**：`rdb_last_save_time`、`aof_current_size`
- **慢查询**：`slowlog` 采集

---

## 十二、更多故障场景与恢复

### 12.1 场景：整个分片（Master + Replica）同时宕机

```bash
# 影响：该分片负责的 slot 范围内所有 key 不可用
# 集群状态：cluster_state:fail，部分 slot 标记为 fail

# 恢复步骤：
# 1. 优先恢复原 Master 节点
redis-server /data/redis-cluster/7001/redis.conf

# 2. 如果数据损坏，从 RDB/AOF 备份恢复
cp /backup/redis/7001/dump.rdb /data/redis-cluster/7001/dump.rdb
cp /backup/redis/7001/appendonly.aof /data/redis-cluster/7001/appendonly.aof
redis-server /data/redis-cluster/7001/redis.conf

# 3. 验证集群恢复
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 cluster info
# cluster_state:ok → 恢复成功
```

### 12.2 场景：网络分区（脑裂）

```bash
# 问题：网络分区导致集群分裂为两个「多数派」和「少数派」
# 少数派 Master 会停止接受写入（cluster-require-full-coverage yes）

# 预防配置（redis.conf）：
min-replicas-to-write 1        # 至少 1 个 Replica 在线才允许写入
min-replicas-max-lag 10         # Replica 最大延迟 10 秒
cluster-require-full-coverage no # 部分 slot 不可用时，其他 slot 仍可读写

# 恢复后手动修复：
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 cluster fix
```

### 12.3 场景：节点 OOM 被系统 Kill

```bash
# 确认是否 OOM
dmesg | grep -i "out of memory" | grep redis
# [12345.678] Out of memory: Kill process 12345 (redis-server) score 900

# 恢复步骤：
# 1. 检查 maxmemory 设置是否合理
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 config get maxmemory

# 2. 增加 maxmemory 或优化数据结构
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 config set maxmemory 32gb

# 3. 检查内存碎片率
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 info memory | grep mem_fragmentation_ratio
# mem_fragmentation_ratio:1.8 → 碎片率过高，考虑重启或开启 activedefrag
redis-cli -a YourStrongPassword123! -c -h 10.0.1.10 -p 7001 config set activedefrag yes
```

### 12.4 场景：AOF 文件过大导致磁盘满

```bash
# 紧急处理：在 Slave 上关闭 AOF 后重写
redis-cli -a YourStrongPassword123! -h 10.0.1.13 -p 7004 config set appendonly no
redis-cli -a YourStrongPassword123! -h 10.0.1.13 -p 7004 bgrewriteaof
redis-cli -a YourStrongPassword123! -h 10.0.1.13 -p 7004 config set appendonly yes

# 长期方案：
# 1. 定期 AOF 重写（自动触发）
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
# 2. 磁盘空间告警（< 20% 剩余时触发）
```

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

---

## 相关阅读

- [Redis Lua 脚本原子操作实战：分布式限流、库存扣减、排行榜](/databases/redis-lua-guide-distributedrate-limiting/)
- [Redis 缓存穿透/击穿/雪崩防护与分布式锁实战](/databases/redis-cache-penetrationbreakdownavalanchedistributedlockguide/)
- [Predis Laravel 缓存实战：失效、分布式锁与性能调优](/databases/predis-laravel-cacheguide-distributedlock/)
