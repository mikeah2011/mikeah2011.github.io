---

title: Redis Cluster 原理探讨
keywords: [Redis Cluster, 原理探讨]
tags:
- Redis
- Redis Cluster
- 高可用
- 集群
- 分布式
- 性能优化
categories:
- database
date: 2020-07-25 20:55:57
cover: https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/image-20221004222258747.png
images:
  - https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/image-20221004222258747.png
description: Redis Cluster 高可用集群原理与实战部署指南。深入解析 16384 哈希槽分配机制、Gossip 协议节点通信、自动故障检测与转移流程。涵盖集群搭建（redis-cli --cluster create）、手动/自动故障转移、在线扩缩容（reshard/rebalance）、Laravel 应用集成配置，以及 Cluster vs Sentinel 选型对比。附生产环境踩坑经验与性能调优建议，适合需要高可用 Redis 架构的后端开发者。
---




>   Redis Cluster

![image-20221004222258747](https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/image-20221004222258747.png)

## 一、Redis Cluster 概述

Redis Cluster 是 Redis 官方提供的分布式解决方案，它通过**去中心化**的架构实现了数据的自动分片和高可用。与 Redis Sentinel 解决主从复制的高可用不同，Cluster 在此基础上进一步解决了**数据量瓶颈**和**写入性能瓶颈**的问题。

Redis Cluster 的核心特性：

- **数据自动分片**：将所有数据划分为 16384 个哈希槽（Hash Slot），分布在多个节点上
- **高可用性**：每个主节点可以有一个或多个从节点，主节点故障时自动进行故障转移
- **去中心化**：所有节点之间通过 Gossip 协议通信，无需中心代理
- **在线扩缩容**：支持在不停机的情况下增加或移除节点

---

## 二、16384 哈希槽分配原理

### 2.1 为什么是 16384？

Redis Cluster 采用 **CRC16(key) mod 16384** 的算法将每个键映射到 0 ~ 16383 之间的某个槽位。选择 16384（即 2^14）而非 65536（2^16）的原因：

1. **心跳包大小限制**：Redis Cluster 节点间通过 Gossip 协议通信，每个节点通过心跳包（PING/PONG）发送自己的槽位信息。使用 16384 个槽位时，槽位位图仅需 2KB（16384 / 8 = 2048 bytes），如果使用 65536 则需要 8KB，会显著增加网络开销。
2. **实际场景不需要太多槽位**：Redis Cluster 官方建议集群节点数不超过 1000 个，16384 个槽位对于这个规模的集群已经足够，平均每个节点约 16 个槽位。
3. **减少元数据开销**：较少的槽数意味着更小的配置传播数据量，Gossip 协议的带宽消耗更低。

### 2.2 哈希槽计算方式

```
HASH_SLOT = CRC16(key) mod 16384
```

其中 CRC16 采用的是 CRC16-CCITT 标准算法。对于包含 hash tag 的 key，只有 hash tag 部分参与计算：

```
# 例：key 为 {user}.name 和 {user}.age 会分配到同一个槽位
# 因为只有 "user" 部分参与 CRC16 计算
HASH_SLOT = CRC16("user") mod 16384
```

Hash Tag 的使用可以确保相关的 key 被分配到同一个节点，从而支持跨 key 操作（如事务、Lua 脚本等）。

### 2.3 三个主节点的槽位分配示例

在典型的 3 主 3 从集群中，槽位默认均匀分配：

| 节点 | 角色 | 槽位范围 | 槽位数量 |
| ---- | ---- | -------- | -------- |
| Node A | Master | 0 ~ 5460 | 5461 |
| Node B | Master | 5461 ~ 10922 | 5462 |
| Node C | Master | 10923 ~ 16383 | 5461 |
| Node D | Slave (A) | — | 复制 Node A |
| Node E | Slave (B) | — | 复制 Node B |
| Node F | Slave (C) | — | 复制 Node C |

---

## 三、Gossip 协议通信机制详解

### 3.1 Gossip 协议概述

Redis Cluster 采用 **Gossip 协议**进行节点间通信，这是一种去中心化的最终一致性协议。每个节点定期向其他节点发送信息，信息在集群中像"流言"一样逐步传播，最终所有节点都能获得完整信息。

### 3.2 通信端口

每个 Redis Cluster 节点需要开放两个端口：

- **数据端口**（如 6379）：用于处理客户端请求
- **集群总线端口**（数据端口 + 10000，如 16379）：用于节点间 Gossip 通信

> ⚠️ 防火墙配置时务必同时开放两个端口，否则集群无法正常工作。

### 3.3 Gossip 消息类型

| 消息类型 | 说明 | 触发条件 |
| -------- | ---- | -------- |
| MEET | 通知目标节点加入集群 | 新节点加入 |
| PING | 心跳检测，携带自身及已知节点信息 | 每秒随机选择节点发送 |
| PONG | 对 PING/MEET 的响应，携带自身信息 | 收到 PING/MEET 后 |
| FAIL | 通知集群某节点已失效 | 半数以上 Master 标记某节点为 PFAIL |

### 3.4 心跳通信流程

每个节点每秒会从已知节点列表中随机选择几个节点发送 PING 消息：

```
Node A  ---PING--->  Node C
         携带：
         - Node A 自身状态信息
         - Node A 已知的部分节点信息（槽位、IP、端口、角色等）
         - 集群的 currentEpoch

Node C  ---PONG--->  Node A
         响应：
         - Node C 自身状态信息
         - Node C 已知的其他节点信息
```

通过不断的心跳交换，集群中的每个节点最终都会获得完整的集群拓扑信息。

### 3.5 节点间的请求重定向

当客户端向某个节点发送命令，而该 key 不属于当前节点管理的槽位时：

- **MOVED 重定向**：节点返回 `MOVED <slot> <ip>:<port>`，客户端应永久更新槽位映射。常见场景：客户端首次访问某个槽位，或者集群发生故障转移后槽位归属发生变化
- **ASK 重定向**：在槽位迁移过程中，节点返回 `ASK <slot> <ip>:<port>`，客户端仅在本次请求中临时重定向，不会更新本地槽位映射表
- **智能客户端缓存**：大多数 Redis Cluster 客户端（如 Jedis、Predis、Lettuce）会维护一张「槽位 → 节点」的本地映射表，首次访问时通过 `CLUSTER SLOTS` 命令获取完整映射，后续请求直接路由到正确的节点，只有在收到 MOVED 时才刷新映射

### 3.6 MOVED vs ASK 重定向的执行流程

```
# MOVED 重定向流程
Client -> Node A: GET user:1001
Node A -> Client: MOVED 5798 192.168.109.200:8002
Client -> Node B: GET user:1001    # 永久更新映射，后续直接访问 Node B
Node B -> Client: "John"

# ASK 重定向流程（槽位 5798 正在从 Node A 迁移到 Node B）
Client -> Node A: GET user:1001
Node A -> Client: ASK 5798 192.168.109.200:8002
Client -> Node B: ASKING            # 发送 ASKING 命令标记本次会话
Client -> Node B: GET user:1001     # 仅本次请求重定向，不更新映射
Node B -> Client: "John"
```

### 3.7 集群间 Slot 迁移的原子性保证

Redis Cluster 的槽位迁移通过以下步骤保证原子性和一致性：

```
迁移流程（从 Node A 迁移 Slot S 到 Node B）：
1. Node A 标记 Slot S 为 MIGRATING（迁移中状态）
2. Node B 标记 Slot S 为 IMPORTING（导入中状态）
3. 对于 Slot S 中的每个 key：
   a. Node A 使用 MIGRATE 命令将 key 原子性地转移到 Node B
   b. MIGRATE 是原子操作：源节点删除 key，目标节点同时写入
   c. 在传输过程中，该 key 被短暂锁定
4. 所有 key 迁移完成后，更新 Slot S 的归属为 Node B
5. 集群广播新的槽位映射信息
```

---

## 四、故障检测与故障转移

### 4.1 故障检测：PFAIL → FAIL 的完整流程

Redis Cluster 的故障检测分为两个阶段：

**阶段一：主观下线（PFAIL - Possibly Fail）**

```
1. Node A 向 Node B 发送 PING
2. 在 cluster-node-timeout（默认 15000ms）时间内未收到 PONG
3. Node A 将 Node B 标记为 PFAIL（主观下线）
4. 此时 Node B 仅在 Node A 看来是下线状态，其他节点可能正常通信
```

**阶段二：客观下线（FAIL）**

```
1. 当集群中超过半数（N/2 + 1）的 Master 节点都将 Node B 标记为 PFAIL
2. Node A 会将 Node B 的状态从 PFAIL 升级为 FAIL（客观下线）
3. Node A 向集群广播 FAIL 消息
4. 所有节点收到 FAIL 消息后都将 Node B 标记为 FAIL
```

### 4.2 自动故障转移

当 Master 被标记为 FAIL 后，其从节点会自动执行故障转移：

```
1. FAIL Master 的 Slave 检测到 Master 已下线
2. Slave 向所有 Master 发起投票请求（Raft 选举协议）
3. 收到多数 Master 的投票同意后，Slave 升级为新 Master
4. 新 Master 向集群广播 PONG，通知所有节点更新配置
5. 旧 Master 的槽位被新 Master 接管
6. 旧 Master 恢复后自动成为新 Master 的 Slave
```

### 4.3 手动故障转移

在计划内维护（如升级、迁移）时，可以使用 `CLUSTER FAILOVER` 命令发起手动故障转移：

```shell
# 连接到 Slave 节点，执行手动故障转移
[root@redis]$ redis-cli -h 192.168.109.200 -p 8002

# 等待 Master 完成当前写入后安全切换
> CLUSTER FAILOVER

# 强制切换（不等待 Master 确认，适用于 Master 已不可用但未标记 FAIL 的情况）
> CLUSTER FAILOVER FORCE

# 接管切换（无需与 Master 协商，适用于 Master 已彻底宕机）
> CLUSTER FAILOVER TAKEOVER
```

手动故障转移与自动故障转移的区别：

| 特性 | 自动故障转移 | 手动故障转移 |
| ---- | ------------ | ------------ |
| 触发条件 | Master 被标记为 FAIL | 人工执行 CLUSTER FAILOVER |
| 数据一致性 | 可能丢失少量数据 | FORCE/TAKEOVER 模式下可能丢失 |
| 停机时间 | 取决于超时和选举时间 | 几乎零停机（正常模式） |
| 适用场景 | 机器故障、网络中断 | 计划维护、主从迁移 |

---

## 五、集群搭建实战

### 5.1 节点配置

| 序号 | 配置项               | 选项                           | 释义                                 |
| ---- | -------------------- | ------------------------------ | ------------------------------------ |
| 1    | cluster-enabled      | yes                            | 启动集群模式                         |
| 2    | port                 | 8001                           | 端口                                 |
| 3    | dir                  | /usr/local/redis-cluster/8001/ | 指定数据目录，绝对目录               |
| 4    | cluster-config-file  | nodes-8001.conf                | 集群节点信息，hash crc16             |
| 5    | cluster-node-timeout | 15000                          | 集群节点超时时间（毫秒）             |
| 6    | bind                 | #127.0.0.1                     | 测试需要注释掉，生产需指定配置       |
| 7    | protected-mode       | no                             | 关闭保护模式                         |
| 8    | requirepass          | 111111                         | redis访问密码                        |
| 9    | masterauth           | 111111                         | 集群节点间的访问密码，与上述保持一致 |
| 10   | daemonize            | yes                            | 后台启动                             |
| 11   | appendonly           | yes                            | 开启 AOF 持久化                      |

### 5.2 使用 redis-cli --cluster create 创建集群

```shell
# 1. 创建节点目录
[root@redis]$ mkdir -p rediscluster/node800{1,2,3,4,5,6}

# 2. 复制配置文件到每个节点
[root@redis]$ for port in 8001 8002 8003 8004 8005 8006; do
    cp redis-5.0.2/redis.conf rediscluster/node${port}/redis.conf
    sed -i "s/8001/${port}/g" rediscluster/node${port}/redis.conf
done

# 3. 批量启动所有节点
[root@redis]$ for port in 8001 8002 8003 8004 8005 8006; do
    redis-server rediscluster/node${port}/redis.conf
done

# 4. 校验启动情况
[root@redis]$ ps -ef | grep redis

# 5. 查看集群命令帮助
[root@redis]$ redis-cli --cluster help

# 6. 创建集群（--cluster-replicas 1 表示每个主节点有 1 个从节点）
#    前 3 个为主节点，后 3 个自动分配为从节点
[root@redis]$ redis-cli -a 111111 --cluster create \
    --cluster-replicas 1 \
    192.168.109.200:8001 \
    192.168.109.200:8002 \
    192.168.109.200:8003 \
    192.168.109.200:8004 \
    192.168.109.200:8005 \
    192.168.109.200:8006

# 执行后 Redis 会显示分配方案并询问是否接受：
# >>> Performing hash slots allocation on 6 nodes...
# Master[0] -> Slots 0 - 5460
# Master[1] -> Slots 5461 - 10922
# Master[2] -> Slots 10923 - 16383
# Adding replica 192.168.109.200:8005 to 192.168.109.200:8001
# Adding replica 192.168.109.200:8006 to 192.168.109.200:8002
# Adding replica 192.168.109.200:8004 to 192.168.109.200:8003
# >>> Trying to optimize slaves allocation for anti-affinity
# Can I set the above configuration? (type 'yes' to accept): yes

# 7. 连接集群（-c 表示集群模式，智能客户端）
[root@redis]$ redis-cli -a 111111 -c -h 192.168.109.200 -p 8001

# 8. 验证集群信息
> cluster info
> cluster nodes
> cluster slots
> cluster myid
```

### 5.3 跨服务器集群搭建示例

生产环境中通常将节点分布在不同的物理服务器上：

```shell
# 3 台服务器，每台部署 1 主 1 从
# 服务器 1: 192.168.1.101
# 服务器 2: 192.168.1.102
# 服务器 3: 192.168.1.103

# 每台服务器上启动 2 个实例（端口 6379 和 6380）
redis-server /etc/redis/cluster/6379/redis.conf
redis-server /etc/redis/cluster/6380/redis.conf

# 在任意一台服务器上创建集群
redis-cli -a 111111 --cluster create \
    --cluster-replicas 1 \
    192.168.1.101:6379 \
    192.168.1.102:6379 \
    192.168.1.103:6379 \
    192.168.1.101:6380 \
    192.168.1.102:6380 \
    192.168.1.103:6380
```

---

## 六、集群扩缩容实操

### 6.1 添加新节点（扩容）

```shell
# 1. 启动新节点（假设为 192.168.109.200:8007）
redis-server rediscluster/node8007/redis.conf

# 2. 将新节点加入集群（作为 Master）
redis-cli -a 111111 --cluster add-node \
    192.168.109.200:8007 \
    192.168.109.200:8001

# 3. 将新节点加入集群（作为某个 Master 的 Slave）
redis-cli -a 111111 --cluster add-node \
    192.168.109.200:8007 \
    192.168.109.200:8001 \
    --cluster-slave \
    --cluster-master-id <master-node-id>
```

### 6.2 在线迁移槽位（Reshard）

将槽位从已有节点迁移到新节点，实现负载均衡：

```shell
# 交互式 reshard
redis-cli -a 111111 --cluster reshard \
    192.168.109.200:8001

# 交互过程：
# How many slots do you want to move (from 1 to 16384)? 4096
# What is the receiving node ID? <新节点ID>
# Source node #1: all    # 从所有主节点平均迁移
# Source node #2: done

# 非交互式 reshard（适合脚本化操作）
redis-cli -a 111111 --cluster reshard \
    192.168.109.200:8001 \
    --cluster-from <source-node-id-1>,<source-node-id-2>,<source-node-id-3> \
    --cluster-to <target-node-id> \
    --cluster-slots 4096 \
    --cluster-yes
```

### 6.3 自动再平衡（Rebalance）

自动计算所有节点的理想槽位分布并执行迁移：

```shell
# 自动再平衡所有节点的槽位
redis-cli -a 111111 --cluster rebalance \
    192.168.109.200:8001

# 指定权重进行再平衡（权重越大，分配的槽位越多）
redis-cli -a 111111 --cluster rebalance \
    192.168.109.200:8001 \
    --cluster-weight \
    <node-id-1>=2 \
    <node-id-2>=1 \
    <node-id-3>=1 \
    --cluster-use-empty-masters
```

### 6.4 移除节点（缩容）

```shell
# 1. 先将该节点的槽位迁移到其他节点
redis-cli -a 111111 --cluster reshard \
    192.168.109.200:8001 \
    --cluster-from <要移除的节点ID> \
    --cluster-to <目标节点ID> \
    --cluster-slots <槽位数量> \
    --cluster-yes

# 2. 移除节点
redis-cli -a 111111 --cluster del-node \
    192.168.109.200:8001 \
    <要移除的节点ID>

# 注意：如果是 Slave 节点，不需要先迁移槽位，可直接删除
```

### 6.5 检查集群状态

```shell
# 集群健康检查
redis-cli -a 111111 --cluster check \
    192.168.109.200:8001

# 修复集群（修复槽位分配异常等问题）
redis-cli -a 111111 --cluster fix \
    192.168.109.200:8001
```

---

## 七、Redis Cluster vs Sentinel 对比

| 对比维度 | Redis Cluster | Redis Sentinel |
| -------- | ------------- | -------------- |
| **架构模式** | 去中心化，多主多从 | 中心化监控，一主多从 |
| **数据分片** | 支持，16384 个哈希槽自动分片 | 不支持，单节点存储全量数据 |
| **写入能力** | 多节点并行写入，水平扩展 | 只有 Master 可写，单点瓶颈 |
| **数据容量** | 受集群总内存限制（可横向扩展） | 受单节点内存限制 |
| **高可用** | 自动故障转移 + 数据分片冗余 | 自动故障转移，仅主从切换 |
| **客户端** | 需支持 Cluster 协议（smart client） | 与普通 Redis 客户端相同 |
| **多 key 操作** | 需使用 Hash Tag 保证同节点 | 完全支持 |
| **事务支持** | 仅支持同槽位的 key | 完全支持 |
| **Lua 脚本** | 仅支持操作同槽位的 key | 完全支持 |
| **适用数据量** | 大于单机内存（GB ~ TB 级别） | 小于单机内存 |
| **运维复杂度** | 较高（扩缩容、槽位迁移） | 较低 |
| **最少节点数** | 6 个（3 主 3 从） | 3 个（1 主 2 从 + Sentinel） |
| **适用场景** | 海量数据、高并发写入 | 数据量不大、读多写少 |

**选型建议：**

- **数据量 < 10GB，读多写少** → Sentinel 即可满足需求
- **数据量 > 10GB，或写入 QPS 较高** → 建议使用 Cluster
- **需要多数据中心** → Cluster + 额外的跨机房同步方案
- **已有 Sentinel 架构，性能足够** → 不建议盲目迁移到 Cluster

---

## 八、Laravel 中配置 Redis Cluster

### 8.1 安装 Predis 扩展

```json
// composer.json
"require": {
    "php": "^7.1.3",
    "predis/predis": "^1.1"
    // 如果安装 Horizon，Redis 密码必须设置且相同
    // config/horizon.php 中 'use' => 'horizon'
}
```

```shell
composer require predis/predis
```

### 8.2 配置环境变量

```ini
# .env
CACHE_DRIVER=redis
REDIS_CLIENT=predis
REDIS_CLUSTER=redis

# 节点 A
REDIS_HOST_A=192.168.109.200
REDIS_PORT_A=8001
REDIS_PASSWORD_A=111111
REDIS_DB_A=0

# 节点 B
REDIS_HOST_B=192.168.109.200
REDIS_PORT_B=8002
REDIS_PASSWORD_B=111111
REDIS_DB_B=0

# 节点 C
REDIS_HOST_C=192.168.109.200
REDIS_PORT_C=8003
REDIS_PASSWORD_C=111111
REDIS_DB_C=0

# 节点 D
REDIS_HOST_D=192.168.109.200
REDIS_PORT_D=8004
REDIS_PASSWORD_D=111111
REDIS_DB_D=0

# 节点 E
REDIS_HOST_E=192.168.109.200
REDIS_PORT_E=8005
REDIS_PASSWORD_E=111111
REDIS_DB_E=0

# 节点 F
REDIS_HOST_F=192.168.109.200
REDIS_PORT_F=8006
REDIS_PASSWORD_F=111111
REDIS_DB_F=0
```

### 8.3 配置 config/database.php

```php
// config/database.php
'redis' => [

    'client' => env('REDIS_CLIENT', 'predis'),

    'options' => [
        'cluster' => env('REDIS_CLUSTER', 'redis'),
        // 超时与重试配置
        'parameters' => [
            'password' => env('REDIS_PASSWORD_A', '111111'),
        ],
        'timeout' => 3.0,
        'read_timeout' => 3.0,
        'retry_interval' => 200,
    ],

    'clusters' => [
        'default' => [
            [
                'host'     => env('REDIS_HOST_A', '192.168.109.200'),
                'password' => env('REDIS_PASSWORD_A', '111111'),
                'port'     => env('REDIS_PORT_A', 8001),
                'database' => env('REDIS_DB_A', 0),
            ],
            [
                'host'     => env('REDIS_HOST_B', '192.168.109.200'),
                'password' => env('REDIS_PASSWORD_B', '111111'),
                'port'     => env('REDIS_PORT_B', 8002),
                'database' => env('REDIS_DB_B', 0),
            ],
            [
                'host'     => env('REDIS_HOST_C', '192.168.109.200'),
                'password' => env('REDIS_PASSWORD_C', '111111'),
                'port'     => env('REDIS_PORT_C', 8003),
                'database' => env('REDIS_DB_C', 0),
            ],
            [
                'host'     => env('REDIS_HOST_D', '192.168.109.200'),
                'password' => env('REDIS_PASSWORD_D', '111111'),
                'port'     => env('REDIS_PORT_D', 8004),
                'database' => env('REDIS_DB_D', 0),
            ],
            [
                'host'     => env('REDIS_HOST_E', '192.168.109.200'),
                'password' => env('REDIS_PASSWORD_E', '111111'),
                'port'     => env('REDIS_PORT_E', 8005),
                'database' => env('REDIS_DB_E', 0),
            ],
            [
                'host'     => env('REDIS_HOST_F', '192.168.109.200'),
                'password' => env('REDIS_PASSWORD_F', '111111'),
                'port'     => env('REDIS_PORT_F', 8006),
                'database' => env('REDIS_DB_F', 0),
            ],
        ],
    ],
],
```

### 8.4 配置 config/cache.php

```php
// config/cache.php
'redis' => [
    'driver'     => 'redis',
    'connection' => 'default',
],
```

### 8.5 使用示例

```php
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;

// 缓存操作（自动路由到正确的槽位节点）
Cache::put('key', 'value', 600);
$value = Cache::get('key');

// 使用 Hash Tag 保证相关 key 在同一节点（支持事务和 Lua 脚本）
Redis::set('{user:1}.name', 'John');
Redis::set('{user:1}.email', 'john@example.com');

// Pipeline 批量操作（Cluster 模式下会自动按节点分组执行）
$pipeline = Redis::pipeline();
for ($i = 0; $i < 1000; $i++) {
    $pipeline->set("key:{$i}", "value:{$i}");
}
$pipeline->execute();
```

---

## 九、Redis Cluster 注意事项

- **批量操作限制**：mset、mget 不支持跨节点操作，需要使用 Hash Tag 保证 key 在同一节点
- **事务限制**：MULTI/EXEC 事务中涉及的 key 必须在同一个槽位
- **Lua 脚本限制**：脚本中操作的所有 key 必须在同一个节点
- **最小粒度是 key**：不支持跨节点的原子操作
- **最少 6 个节点**：3 主 3 从才能组成完整的高可用集群
- **连接只需连 1 个节点**：客户端会自动处理重定向
- **槽位未完全覆盖时集群不可用**：所有 16384 个槽位必须被分配，集群才会进入可用状态
- **节点超时时间**：cluster-node-timeout 不宜设太短，避免网络抖动导致误判下线

### 生产环境踩坑经验

1. **脑裂问题**：网络分区时可能出现双主写入，建议设置 `min-replicas-to-write` 和 `min-replicas-max-lag`
2. **大 Key 问题**：集群迁移大 Key 时会阻塞，建议提前拆分
3. **热点 Key 问题**：某些热点 Key 可能导致单节点压力过大，需要通过本地缓存或 Key 拆分缓解
4. **节点重启后数据不一致**：确保配置了 `cluster-require-full-coverage no`，在部分节点不可用时仍可对外服务
5. **跨机房部署延迟**：Gossip 协议在高延迟环境下通信效率下降，建议同机房部署主节点

---

## 十、应用场景

| 场景 | 数据结构 | 说明 |
| ---- | -------- | ---- |
| 计数器 / 分布式 ID | string (incr) | 原子自增，天然分布式唯一 |
| 海量数据统计 | bitmap | 位运算高效统计用户行为 |
| 会话缓存 | string / hash | key-value 存储，设置 TTL |
| 分布式队列 | list (lpush/rpush, brpop/blpop) | 阻塞队列实现可靠消息 |
| 分布式锁 | string (setnx) | 配合 Lua 脚本实现安全释放 |
| 热键存储 | list (ltrim) | 用户路由、二级缓存 |
| 社交类 | set | 好友推荐、共同关注 |
| 排行榜 | sorted_set | 天然支持排序和范围查询 |
| 延迟队列 | sorted_set (zadd + zrangebyscore) | 定时任务调度 |
| 地理位置 | geo | 附近的人、距离计算 |
| 布隆过滤器 | RedisBloom 模块 | 高效判断元素是否存在 |

---

## 十一、性能调优与最佳实践

### 11.1 连接池配置

在高并发场景下，合理配置连接池至关重要：

```php
// Laravel config/database.php - 连接池优化
'redis' => [
    'client' => env('REDIS_CLIENT', 'predis'),
    'options' => [
        'cluster' => env('REDIS_CLUSTER', 'redis'),
        'parameters' => [
            'password' => env('REDIS_PASSWORD_A', '111111'),
        ],
        'timeout' => 3.0,           // 连接超时（秒）
        'read_timeout' => 3.0,      // 读取超时
        'write_timeout' => 3.0,     // 写入超时
        'retry_interval' => 200,    // 重试间隔（毫秒）
        'persistent' => true,       // 长连接复用
    ],
    // ...
],
```

### 11.2 大 Key 检测与处理

大 Key 是集群运维中的常见隐患，会导致迁移阻塞和慢查询：

```shell
# 扫描大 Key（线上环境使用 --i 参数控制扫描速度）
redis-cli --bigkeys --i 0.1 -c -h 192.168.109.200 -p 8001

# 使用 memory usage 评估单个 key 的内存占用
redis-cli -c -h 192.168.109.200 -p 8001 MEMORY USAGE key_name

# 删除大 Key 的正确姿势（使用 UNLINK 异步删除，避免阻塞）
> UNLINK large_key_name
```

**大 Key 处理策略：**
- **String 类型**：压缩存储、拆分为多个小 key
- **Hash 类型**：按字段拆分到多个 Hash，或使用 Hash 分片
- **List/Set/Sorted Set**：按范围或哈希拆分到多个数据结构

### 11.3 热点 Key 应对

```shell
# Redis 4.0+ 使用 LRU/LFU 淘汰策略
maxmemory-policy allkeys-lfu

# 应用层方案：
# 1. 本地缓存（如 Laravel Cache::store('file') 作为 L1 缓存）
# 2. Key 拆分（user:{id} 拆分为 user:{id}:shard1, user:{id}:shard2...）
# 3. 读写分离（从节点分担读压力）
```

### 11.4 集群监控关键指标

```shell
# 集群整体健康状态
redis-cli -c -h 192.168.109.200 -p 8001 CLUSTER INFO

# 关键指标：
# cluster_state:ok              # 集群状态，应为 ok
# cluster_slots_assigned:16384  # 已分配槽位数，必须为 16384
# cluster_slots_ok:16384        # 正常槽位数
# cluster_known_nodes:6         # 已知节点数
# cluster_size:3                # 主节点数

# 慢查询日志
redis-cli -c -h 192.168.109.200 -p 8001 SLOWLOG GET 10

# 客户端连接数
redis-cli -c -h 192.168.109.200 -p 8001 INFO clients
```

### 11.5 生产环境 Checklist

| 检查项 | 推荐配置 | 说明 |
| ---- | -------- | ---- |
| 持久化 | AOF + RDB 双开 | `appendonly yes` + `save 900 1` |
| 最大内存 | 实例内存的 70% | `maxmemory 8gb` |
| 淘汰策略 | allkeys-lfu | `maxmemory-policy allkeys-lfu` |
| 超时时间 | 15000ms | `cluster-node-timeout 15000` |
| TCP Keepalive | 300s | `tcp-keepalive 300` |
| 日志级别 | notice | `loglevel notice` |
| 最大连接数 | 10000 | `maxclients 10000` |
| 客户端输出缓冲区 | 256MB 64MB 128MB | `client-output-buffer-limit` |
| 慢查询阈值 | 10ms 1000条 | `slowlog-log-slower-than 10000` |
| 跨槽位覆盖 | no | `cluster-require-full-coverage no` |

---

## 相关阅读

- [Redis 实战：缓存穿透/击穿/雪崩防护](/categories/Databases/redis-guidecache-penetrationbreakdownavalanche/) — 全面了解三大缓存问题及其生产级解决方案
- [Redis Cluster 集群部署与故障转移：高可用架构实战踩坑记录](/databases/redis-cluster-deployment-high-availabilityarchitecture/) — 从零搭建集群的完整流程与真实踩坑记录
- [Redis 实战：缓存失效场景深度解析](/databases/redis-guide-cache/) — 缓存穿透、击穿、雪崩三大经典问题与生产级解决方案
- [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/databases/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/) — Redis 8.0 最新特性全面解读
