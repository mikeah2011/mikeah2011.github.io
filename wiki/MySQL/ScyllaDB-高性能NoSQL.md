# ScyllaDB 高性能 NoSQL

## 定义

ScyllaDB 是 Apache Cassandra 的 C++ 重写版本，使用 Seastar 异步框架实现共享无关（Shared-Nothing）架构，在相同硬件上可提供 10 倍于 Cassandra 的吞吐量，同时保持完全的 CQL 兼容性。适用于每秒数十万次写入、存储数十 TB 数据的分布式场景。

## 核心原理

### Seastar 框架

ScyllaDB 的性能优势来自底层的 Seastar 异步框架：

1. **共享无关架构**：每个 CPU 核心独立运行自己的事件循环，不共享内存
2. **无锁设计**：核心间通过消息传递而非共享内存通信
3. **用户态调度**：避免内核态切换开销
4. **轮询 I/O**：使用 DPDK 和 SPDK 进行网络和存储的用户态轮询

```
传统 Cassandra (JVM):          ScyllaDB (Seastar):
┌───────────────────┐     ┌──────────┐ ┌──────────┐ ┌──────────┐
│  Shared Heap      │     │  Core 1  │ │  Core 2  │ │  Core 3  │
│  GC → GC → GC     │     │ Memory+  │ │ Memory+  │ │ Memory+  │
│  Core1 Core2 Core3 │     │ EventLoop│ │ EventLoop│ │ EventLoop│
└───────────────────┘     └──────────┘ └──────────┘ └──────────┘
                                    Message Passing
```

### 性能对比

| 特性 | ScyllaDB | Cassandra | Redis Cluster | DynamoDB |
|------|----------|-----------|---------------|----------|
| 语言 | C++ | Java | C | 闭源 |
| 最大吞吐量 | 100 万+ OPS | 5-10 万 OPS | 50 万+ OPS | 按需扩展 |
| P99 延迟 | < 1ms | 10-50ms | < 1ms | 5-10ms |
| 数据容量 | PB 级 | PB 级 | GB 级（内存） | PB 级 |
| 多数据中心 | ✅ | ✅ | 有限 | ✅ |
| 事务支持 | 轻量事务（LWT） | 轻量事务 | 有限 | ✅ |

### CQL 数据建模

```sql
CREATE KEYSPACE ecommerce WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'dc1': 3
};

CREATE TABLE ecommerce.user_events (
    user_id     UUID,
    event_time  TIMESTAMP,
    event_type  TEXT,
    page_url    TEXT,
    metadata    MAP<TEXT, TEXT>,
    PRIMARY KEY ((user_id), event_time, event_type)
) WITH CLUSTERING ORDER BY (event_time DESC);
```

**数据建模原则**：
- 以查询模式驱动建模（Query-Driven Design）
- Partition Key 决定数据分布，Clustering Key 决定分区内排序
- 避免 ALLOW FILTERING（全表扫描）

## Laravel 集成

ScyllaDB 支持 CQL 协议，PHP 通过 `php-driver`（DataStax）扩展集成：

```php
// 使用 cassandra-php/php-driver
$cluster = \Cassandra::cluster()
    ->withContactPoints('scylla-node1,scylla-node2')
    ->withPort(9042)
    ->build();
$session = $cluster->connect('ecommerce');

// 插入事件
$statement = $session->prepare(
    "INSERT INTO user_events (user_id, event_time, event_type, page_url) VALUES (?, ?, ?, ?)"
);
$session->execute($statement, [
    'arguments' => [
        new \Cassandra\Uuid(),
        new \Cassandra\Timestamp(),
        'page_view',
        '/products/123'
    ]
]);
```

### ScyllaDB Alternator（DynamoDB 兼容层）

ScyllaDB 提供 DynamoDB 兼容 API，可使用 AWS SDK 直接操作：

```php
$s3 = new Aws\DynamoDb\DynamoDbClient([
    'endpoint' => 'http://scylla-node:8000',
    'region' => 'us-east-1',
    'version' => 'latest',
]);
```

## Compaction 策略

| 策略 | 适用场景 |
|------|---------|
| Size-Tiered | 写多读少，通用场景 |
| Leveled | 读多写少，需要稳定的读延迟 |
| Time-Window | 时序数据，按时间窗口压缩 |

## 实战案例

来自博客文章：
- [ScyllaDB 实战：C++ 重写的高性能 NoSQL——Laravel 分布式缓存与高吞吐写入选型对比](/categories/数据库/ScyllaDB-实战-C++重写的高性能NoSQL-Laravel分布式缓存与高吞吐写入选型对比/)

## 相关概念

- [Redis Cluster 高可用](../Redis/Redis-Cluster高可用.md) - 内存级缓存方案
- [分布式缓存一致性](../架构设计/分布式缓存一致性.md) - 缓存与数据库一致性
- [分库分表](分库分表.md) - MySQL 水平扩展方案
- [TiDB NewSQL](TiDB-NewSQL.md) - MySQL 兼容的分布式 SQL

## 常见问题

**Q: ScyllaDB vs Redis Cluster 如何选型？**
A: Redis 适合 GB 级热数据、低延迟缓存。ScyllaDB 适合 PB 级数据、高吞吐持久化存储。两者可配合使用：Redis 做热缓存，ScyllaDB 做持久存储。

**Q: ScyllaDB 的轻量事务（LWT）性能如何？**
A: LWT 基于 Paxos 协议，延迟约为普通写入的 3-5 倍。非必要不使用 LWT，优先通过数据建模避免事务需求。

**Q: 如何处理 ScyllaDB 的数据倾斜？**
A: 选择高基数的 Partition Key 使数据均匀分布。使用 `nodetool tablestats` 监控各节点数据量，必要时引入 Salt Key 打散热点。
