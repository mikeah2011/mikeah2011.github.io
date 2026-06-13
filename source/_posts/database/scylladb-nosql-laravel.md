---

title: ScyllaDB 实战：C++ 重写的高性能 NoSQL——Laravel 分布式缓存与高吞吐写入选型对比
keywords: [ScyllaDB, NoSQL, Laravel, 重写的高性能, 分布式缓存与高吞吐写入选型对比]
date: 2026-06-02 12:00:00
tags:
- ScyllaDB
- NoSQL
- Cassandra
- Laravel
- 数据库
description: ScyllaDB 是 Apache Cassandra 的 C++ 重写版本，基于 Seastar 异步框架实现共享无关架构，在相同硬件上可提供 10 倍于 Cassandra 的吞吐量。本文从高吞吐写入真实场景出发，完整记录 ScyllaDB 与 Laravel 的集成实战，涵盖技术选型对比（ScyllaDB vs Cassandra vs TiDB vs MongoDB）、CQL 数据建模、Laravel 数据库驱动配置、物化视图与二级索引策略、Compaction 调优、生产部署踩坑。适合需要处理每秒数十万次写入、存储数十 TB 数据的分布式系统架构师参考。
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---



## 前言

在高并发分布式系统中，选择合适的数据库往往决定了系统的上限。Redis 虽快，但单机内存容量有限；MySQL 虽稳，但写入吞吐量在千万级数据面前捉襟见肘。当我们需要一个能处理**每秒数十万次写入**、**存储数十 TB 数据**、**提供毫秒级读取延迟**的分布式数据库时，ScyllaDB 进入了视野。

ScyllaDB 是 Apache Cassandra 的 C++ 重写版本，使用 Seastar 异步框架实现了共享无关（Shared-Nothing）架构，在相同硬件上可以提供 **10 倍于 Cassandra 的吞吐量**，同时保持完全的 CQL（Cassandra Query Language）兼容性。

本文将记录我在一个真实的高吞吐写入场景中集成 ScyllaDB 的全过程——从技术选型、数据建模、Laravel 集成到生产部署踩坑，为 Laravel 开发者提供一份完整的实战指南。

---

## 一、ScyllaDB 项目背景

### 1.1 为什么需要 ScyllaDB？

Apache Cassandra 是分布式数据库领域的标杆，被 Apple、Netflix、Instagram 等大规模系统广泛采用。但它有一个根本性的问题：**Java 虚拟机（JVM）的性能天花板**。

Cassandra 使用 Java 编写，运行在 JVM 之上。JVM 的垃圾回收（GC）机制会导致不可预测的延迟抖动，在高吞吐场景下尤为明显。一次 Full GC 可能导致数百毫秒的停顿，这对于 P99 延迟敏感的应用是不可接受的。

### 1.2 Seastar 框架

ScyllaDB 使用 C++ 编写，底层采用 Seastar 异步框架。Seastar 的核心设计思想是：

1. **共享无关架构**：每个 CPU 核心独立运行自己的事件循环，不共享内存
2. **无锁设计**：核心间通过消息传递而非共享内存通信
3. **用户态调度**：避免内核态切换开销
4. **轮询 I/O**：使用 DPDK 和 SPDK 进行网络和存储的用户态轮询

```
传统 Cassandra (JVM):
┌─────────────────────────────────┐
│        Shared Heap Memory       │
│  ┌─────┐ ┌─────┐ ┌─────┐       │
│  │ GC  │ │ GC  │ │ GC  │ ...   │
│  └─────┘ └─────┘ └─────┘       │
│  ┌─────┐ ┌─────┐ ┌─────┐       │
│  │Core1│ │Core2│ │Core3│ ...   │
│  └─────┘ └─────┘ └─────┘       │
└─────────────────────────────────┘

ScyllaDB (Seastar):
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Core 1  │ │  Core 2  │ │  Core 3  │
│ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │
│ │Memory│ │ │ │Memory│ │ │ │Memory│ │
│ │ Pool │ │ │ │ Pool │ │ │ │ Pool │ │
│ └──────┘ │ │ └──────┘ │ │ └──────┘ │
│ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │
│ │Event │ │ │ │Event │ │ │ │Event │ │
│ │Loop  │ │ │ │Loop  │ │ │ │Loop  │ │
│ └──────┘ │ │ └──────┘ │ │ └──────┘ │
└──────────┘ └──────────┘ └──────────┘
       ↑            ↑            ↑
       └────────────┼────────────┘
            Message Passing
```

### 1.3 ScyllaDB vs Cassandra vs Redis Cluster vs DynamoDB

| 特性 | ScyllaDB | Cassandra | Redis Cluster | DynamoDB |
|------|----------|-----------|---------------|----------|
| 语言 | C++ | Java | C | 闭源 |
| 最大吞吐量 | 100 万+ OPS | 5-10 万 OPS | 50 万+ OPS | 按需扩展 |
| P99 延迟 | < 1ms | 10-50ms | < 1ms | 5-10ms |
| 数据容量 | PB 级 | PB 级 | GB 级（内存） | PB 级 |
| 水平扩展 | ✅ 线性 | ✅ 线性 | ✅ | ✅ 自动 |
| 多数据中心 | ✅ | ✅ | 有限 | ✅ |
| SQL 兼容 | CQL | CQL | ❌ | ❌ |
| 事务支持 | 轻量事务（LWT） | 轻量事务 | 有限 | ✅ |
| 运维复杂度 | 中 | 高 | 中 | 低（托管） |
| 成本 | 低（开源） | 低（开源） | 中（内存贵） | 高（按量付费） |

---

## 二、核心概念

### 2.1 数据模型

ScyllaDB 使用宽表（Wide Column）模型，与关系型数据库有本质区别：

```sql
-- 创建 Keyspace（类似 MySQL 的 Database）
CREATE KEYSPACE IF NOT EXISTS ecommerce
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'datacenter1': 3
};

-- 创建 Table
CREATE TABLE ecommerce.user_events (
    user_id     UUID,
    event_time  TIMESTAMP,
    event_type  TEXT,
    event_data  TEXT,
    ip_address  INET,
    user_agent  TEXT,
    PRIMARY KEY ((user_id), event_time, event_type)
) WITH CLUSTERING ORDER BY (event_time DESC)
  AND compaction = {
    'class': 'TimeWindowCompactionStrategy',
    'compaction_window_size': 1,
    'compaction_window_unit': 'DAYS'
  };
```

### 2.2 Partition Key 与 Clustering Key

```sql
PRIMARY KEY ((partition_key), clustering_key1, clustering_key2, ...)
```

- **Partition Key**：决定数据存储在哪个节点上。相同 Partition Key 的数据存储在同一节点。
- **Clustering Key**：决定同一 Partition 内数据的排序方式。

```
Table: user_events
PRIMARY KEY ((user_id), event_time, event_type)

Node 1: user_id = 'aaa...'
├── event_time: 2026-06-02 12:00, event_type: 'click'
├── event_time: 2026-06-02 11:30, event_type: 'view'
└── event_time: 2026-06-02 10:00, event_type: 'purchase'

Node 2: user_id = 'bbb...'
├── event_time: 2026-06-02 12:05, event_type: 'click'
└── event_time: 2026-06-02 09:00, event_type: 'view'
```

### 2.3 Compaction 策略

| 策略 | 适用场景 | 特点 |
|------|---------|------|
| SizeTieredCompactionStrategy | 通用写入 | 默认策略，写入性能好 |
| LeveledCompactionStrategy | 读多写少 | 读取性能好，空间效率高 |
| TimeWindowCompactionStrategy | 时序数据 | 按时间窗口合并，适合 TTL 数据 |
| IncrementalCompactionStrategy | ScyllaDB 特有 | 增量合并，内存占用小 |

### 2.4 一致性级别

| 级别 | 含义 | 延迟 | 耐久性 |
|------|------|------|--------|
| ANY | 任意一个节点确认 | 最低 | 最低 |
| ONE | 一个副本确认 | 低 | 低 |
| TWO | 两个副本确认 | 中 | 中 |
| QUORUM | 多数副本确认 | 中 | 高 |
| LOCAL_QUORUM | 本地数据中心多数副本确认 | 中 | 高 |
| ALL | 所有副本确认 | 最高 | 最高 |

**经验法则**：写入用 `LOCAL_QUORUM`，读取用 `LOCAL_QUORUM`，可以保证强一致性（R + W > N）。

---

## 三、Laravel 集成

### 3.1 安装 ScyllaDB

#### Docker Compose 本地开发

```yaml
# docker-compose.yml
services:
  scylla-node-1:
    image: scylladb/scylla:5.4
    container_name: scylla-node-1
    command: >
      --smp 2
      --memory 2G
      --overprovisioned 1
      --api-address 0.0.0.0
      --rpc-address scylla-node-1
      --listen-address scylla-node-1
      --seeds scylla-node-1
      --endpoint-snitch SimpleSnitch
    ports:
      - "9042:9042"
      - "10000:10000"
    volumes:
      - scylla-data-1:/var/lib/scylla
    networks:
      - scylla-net

  scylla-node-2:
    image: scylladb/scylla:5.4
    container_name: scylla-node-2
    command: >
      --smp 2
      --memory 2G
      --overprovisioned 1
      --api-address 0.0.0.0
      --rpc-address scylla-node-2
      --listen-address scylla-node-2
      --seeds scylla-node-1
      --endpoint-snitch SimpleSnitch
    depends_on:
      - scylla-node-1
    volumes:
      - scylla-data-2:/var/lib/scylla
    networks:
      - scylla-net

  scylla-node-3:
    image: scylladb/scylla:5.4
    container_name: scylla-node-3
    command: >
      --smp 2
      --memory 2G
      --overprovisioned 1
      --api-address 0.0.0.0
      --rpc-address scylla-node-3
      --listen-address scylla-node-3
      --seeds scylla-node-1
      --endpoint-snitch SimpleSnitch
    depends_on:
      - scylla-node-1
    volumes:
      - scylla-data-3:/var/lib/scylla
    networks:
      - scylla-net

volumes:
  scylla-data-1:
  scylla-data-2:
  scylla-data-3:

networks:
  scylla-net:
```

```bash
# 启动集群
docker compose up -d

# 等待节点启动（约 30 秒）
sleep 30

# 初始化集群
docker exec scylla-node-1 nodetool status

# 创建 Keyspace 和 Table
docker exec -it scylla-node-1 cqlsh
```

### 3.2 PHP 驱动安装

ScyllaDB 兼容 Cassandra 的 CQL 协议，因此可以使用 DataStax 的 PHP Cassandra 驱动：

```bash
# 安装 PHP 扩展
pecl install cassandra

# 或者使用 scylla-php-driver（性能更好）
# 需要从源码编译
git clone https://github.com/scylladb/scylla-php-driver.git
cd scylla-php-driver
phpize
./configure
make && make install

# 在 php.ini 中添加
echo "extension=cassandra.so" >> /etc/php/8.3/cli/php.ini
```

**踩坑 #1**：`cassandra` PHP 扩展的安装过程比较复杂，需要先安装 C/C++ 驱动库：

```bash
# Ubuntu/Debian
sudo apt-get install libuv1-dev libssl-dev cmake g++

# macOS
brew install libuv openssl cmake

# 从源码安装 C++ 驱动
git clone https://github.com/datastax/cpp-driver.git
cd cpp-driver
mkdir build && cd build
cmake ..
make && sudo make install
sudo ldconfig
```

### 3.3 Laravel Service Provider

创建一个 ScyllaDB 的 Laravel Service Provider：

```php
<?php
// app/Providers/ScyllaDBServiceProvider.php

namespace App\Providers;

use Cassandra;
use Cassandra\Cluster;
use Cassandra\Session;
use Illuminate\Support\ServiceProvider;

class ScyllaDBServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Session::class, function () {
            $cluster = Cluster::builder()
                ->withContactPoints(
                    ...explode(',', env('SCYLLA_CONTACT_POINTS', '127.0.0.1'))
                )
                ->withPort((int) env('SCYLLA_PORT', 9042))
                ->withCredentials(
                    env('SCYLLA_USERNAME', ''),
                    env('SCYLLA_PASSWORD', '')
                )
                ->withLocalDatacenter(env('SCYLLA_LOCAL_DATACENTER', 'datacenter1'))
                ->withConsistency(Cassandra::CONSISTENCY_LOCAL_QUORUM)
                ->withRequestTimeout(10000) // 10 秒超时
                ->withReconnectInterval(5000) // 5 秒重连间隔
                ->withDefaultPageSize(5000)
                ->build();

            return $cluster->connect(env('SCYLLA_KEYSPACE', 'ecommerce'));
        });
    }
}
```

```php
<?php
// app/Repositories/ScyllaEventRepository.php

namespace App\Repositories;

use Cassandra\Session;
use Cassandra\Timestamp;
use Ramsey\Uuid\Uuid;

class ScyllaEventRepository
{
    public function __construct(
        private readonly Session $session
    ) {}

    /**
     * 写入用户事件
     */
    public function insertEvent(array $event): void
    {
        $statement = $this->session->prepare(
            'INSERT INTO user_events (user_id, event_time, event_type, event_data, ip_address, user_agent) 
             VALUES (?, ?, ?, ?, ?, ?)'
        );

        $this->session->execute($statement, [
            'arguments' => [
                Uuid::fromString($event['user_id']),
                new Timestamp((int) (strtotime($event['event_time']) * 1000)),
                $event['event_type'],
                $event['event_data'],
                $event['ip_address'],
                $event['user_agent'],
            ],
        ]);
    }

    /**
     * 批量写入事件（使用 UNLOGGED BATCH 提升性能）
     */
    public function batchInsert(array $events): void
    {
        $batch = new \Cassandra\Batch(\Cassandra::BATCH_UNLOGGED);
        $statement = $this->session->prepare(
            'INSERT INTO user_events (user_id, event_time, event_type, event_data) VALUES (?, ?, ?, ?)'
        );

        foreach ($events as $event) {
            $batch->add($statement, [
                Uuid::fromString($event['user_id']),
                new Timestamp((int) (strtotime($event['event_time']) * 1000)),
                $event['event_type'],
                $event['event_data'],
            ]);
        }

        $this->session->execute($batch);
    }

    /**
     * 查询用户最近的事件
     */
    public function getUserEvents(string $userId, int $limit = 100): array
    {
        $statement = $this->session->prepare(
            'SELECT * FROM user_events WHERE user_id = ? ORDER BY event_time DESC LIMIT ?'
        );

        $result = $this->session->execute($statement, [
            Uuid::fromString($userId),
            $limit,
        ]);

        $events = [];
        foreach ($result as $row) {
            $events[] = [
                'user_id' => $row['user_id']->toString(),
                'event_time' => $row['event_time']->toDateTime()->format('Y-m-d H:i:s'),
                'event_type' => $row['event_type'],
                'event_data' => $row['event_data'],
            ];
        }

        return $events;
    }

    /**
     * 异步写入（最高吞吐量）
     */
    public function asyncInsert(array $event): \Cassandra\Future
    {
        $statement = $this->session->prepare(
            'INSERT INTO user_events (user_id, event_time, event_type, event_data) VALUES (?, ?, ?, ?)'
        );

        return $this->session->executeAsync($statement, [
            Uuid::fromString($event['user_id']),
            new Timestamp((int) (strtotime($event['event_time']) * 1000)),
            $event['event_type'],
            $event['event_data'],
        ]);
    }
}
```

### 3.4 配置文件

```php
<?php
// config/scylladb.php

return [
    'contact_points' => explode(',', env('SCYLLA_CONTACT_POINTS', '127.0.0.1')),
    'port' => env('SCYLLA_PORT', 9042),
    'keyspace' => env('SCYLLA_KEYSPACE', 'ecommerce'),
    'username' => env('SCYLLA_USERNAME', ''),
    'password' => env('SCYLLA_PASSWORD', ''),
    'local_datacenter' => env('SCYLLA_LOCAL_DATACENTER', 'datacenter1'),
    'consistency' => env('SCYLLA_CONSISTENCY', 'local_quorum'),
    'request_timeout' => env('SCYLLA_REQUEST_TIMEOUT', 10000),
    'page_size' => env('SCYLLA_PAGE_SIZE', 5000),
];
```

```env
# .env
SCYLLA_CONTACT_POINTS=127.0.0.1,127.0.0.2,127.0.0.3
SCYLLA_PORT=9042
SCYLLA_KEYSPACE=ecommerce
SCYLLA_USERNAME=scylla
SCYLLA_PASSWORD=secret
SCYLLA_LOCAL_DATACENTER=datacenter1
```

---

## 四、高吞吐写入场景

### 4.1 写入策略对比

| 策略 | 吞吐量 | 可靠性 | 适用场景 |
|------|--------|--------|---------|
| 单条 INSERT | 1-5 万/秒 | 高 | 低频写入 |
| BATCH（UNLOGGED） | 5-20 万/秒 | 中 | 同 Partition 批量写入 |
| BATCH（LOGGED） | 3-10 万/秒 | 高 | 跨 Partition 原子写入 |
| 异步写入 | 20-100 万/秒 | 中 | 日志/事件采集 |
| COPY 命令 | 50-200 万/秒 | 高 | 数据导入/迁移 |

### 4.2 异步写入实现

```php
<?php

class HighThroughputWriter
{
    private array $futures = [];
    private int $maxConcurrent;
    private int $pendingCount = 0;

    public function __construct(
        private readonly \Cassandra\Session $session,
        int $maxConcurrent = 1000
    ) {
        $this->maxConcurrent = $maxConcurrent;
        $this->statement = $session->prepare(
            'INSERT INTO user_events (user_id, event_time, event_type, event_data) VALUES (?, ?, ?, ?)'
        );
    }

    /**
     * 异步写入，自动背压控制
     */
    public function writeAsync(array $event): void
    {
        // 背压控制：等待进行中的请求降到阈值以下
        while ($this->pendingCount >= $this->maxConcurrent) {
            $this->waitForCompletion();
        }

        $future = $this->session->executeAsync($this->statement, [
            \Ramsey\Uuid\Uuid::fromString($event['user_id']),
            new \Cassandra\Timestamp((int) (strtotime($event['event_time']) * 1000)),
            $event['event_type'],
            $event['event_data'],
        ]);

        $this->futures[] = $future;
        $this->pendingCount++;
    }

    /**
     * 等待所有异步请求完成
     */
    public function flush(): array
    {
        $errors = [];
        
        foreach ($this->futures as $index => $future) {
            try {
                $future->get();
            } catch (\Exception $e) {
                $errors[] = [
                    'index' => $index,
                    'error' => $e->getMessage(),
                ];
            }
        }

        $this->futures = [];
        $this->pendingCount = 0;

        return $errors;
    }

    private function waitForCompletion(): void
    {
        // 等待最早的一个请求完成
        if (!empty($this->futures)) {
            $future = array_shift($this->futures);
            try {
                $future->get();
            } catch (\Exception $e) {
                // 记录错误但不中断
                \Log::warning('ScyllaDB async write failed', ['error' => $e->getMessage()]);
            }
            $this->pendingCount--;
        }
    }
}
```

### 4.3 队列驱动的批量写入

```php
<?php
// app/Jobs/ScyllaBatchIngestJob.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

class ScyllaBatchIngestJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(
        public readonly array $events
    ) {
        $this->onQueue('scylla-ingestion');
    }

    public function handle(ScyllaEventRepository $repository): void
    {
        $startTime = microtime(true);
        $count = count($this->events);

        // 分批写入，每批 100 条
        $batches = array_chunk($this->events, 100);
        
        foreach ($batches as $batch) {
            $repository->batchInsert($batch);
        }

        $elapsed = microtime(true) - $startTime;

        Log::info('ScyllaDB batch ingest completed', [
            'count' => $count,
            'batches' => count($batches),
            'elapsed_ms' => round($elapsed * 1000, 2),
            'events_per_second' => round($count / $elapsed),
        ]);
    }
}
```

### 4.4 性能基准测试

```php
<?php

class ScyllaDBBenchmark
{
    /**
     * 基准测试：单条写入 vs 批量写入 vs 异步写入
     */
    public function runBenchmark(int $totalEvents = 100000): array
    {
        $results = [];

        // 测试 1: 单条写入
        $results['single_insert'] = $this->benchmarkSingleInsert(10000);

        // 测试 2: 批量写入（100 条/批）
        $results['batch_insert'] = $this->benchmarkBatchInsert($totalEvents, 100);

        // 测试 3: 批量写入（1000 条/批）
        $results['batch_insert_1000'] = $this->benchmarkBatchInsert($totalEvents, 1000);

        // 测试 4: 异步写入
        $results['async_insert'] = $this->benchmarkAsyncInsert($totalEvents);

        return $results;
    }

    private function benchmarkSingleInsert(int $count): array
    {
        $repo = app(ScyllaEventRepository::class);
        $startTime = microtime(true);

        for ($i = 0; $i < $count; $i++) {
            $repo->insertEvent($this->generateEvent());
        }

        $elapsed = microtime(true) - $startTime;

        return [
            'count' => $count,
            'elapsed_seconds' => round($elapsed, 3),
            'events_per_second' => round($count / $elapsed),
            'avg_latency_ms' => round(($elapsed / $count) * 1000, 3),
        ];
    }

    private function benchmarkBatchInsert(int $total, int $batchSize): array
    {
        $repo = app(ScyllaEventRepository::class);
        $startTime = microtime(true);

        $events = [];
        for ($i = 0; $i < $total; $i++) {
            $events[] = $this->generateEvent();
            if (count($events) >= $batchSize) {
                $repo->batchInsert($events);
                $events = [];
            }
        }
        if (!empty($events)) {
            $repo->batchInsert($events);
        }

        $elapsed = microtime(true) - $startTime;

        return [
            'count' => $total,
            'batch_size' => $batchSize,
            'elapsed_seconds' => round($elapsed, 3),
            'events_per_second' => round($total / $elapsed),
        ];
    }

    private function benchmarkAsyncInsert(int $count): array
    {
        $writer = new HighThroughputWriter(
            app(\Cassandra\Session::class),
            maxConcurrent: 500
        );

        $startTime = microtime(true);

        for ($i = 0; $i < $count; $i++) {
            $writer->writeAsync($this->generateEvent());
        }

        $errors = $writer->flush();
        $elapsed = microtime(true) - $startTime;

        return [
            'count' => $count,
            'elapsed_seconds' => round($elapsed, 3),
            'events_per_second' => round($count / $elapsed),
            'errors' => count($errors),
        ];
    }

    private function generateEvent(): array
    {
        return [
            'user_id' => \Ramsey\Uuid\Uuid::uuid4()->toString(),
            'event_time' => date('Y-m-d H:i:s'),
            'event_type' => ['click', 'view', 'purchase', 'scroll'][rand(0, 3)],
            'event_data' => json_encode(['page' => '/product/' . rand(1, 10000)]),
        ];
    }
}
```

预期性能结果：

| 策略 | 吞吐量（events/sec） | P99 延迟 |
|------|---------------------|----------|
| 单条 INSERT | ~5,000 | ~2ms |
| 批量 INSERT（100条/批） | ~30,000 | ~5ms |
| 批量 INSERT（1000条/批） | ~80,000 | ~15ms |
| 异步 INSERT（并发 500） | ~150,000 | ~3ms |

---

## 五、分布式缓存场景

### 5.1 Cache Aside 模式

```php
<?php

class ScyllaCacheAside
{
    private string $keyspace = 'cache_store';

    public function __construct(
        private readonly \Cassandra\Session $session,
        private readonly \Illuminate\Contracts\Cache\Repository $redisCache
    ) {
        $this->prepareStatements();
    }

    private function prepareStatements(): void
    {
        $this->getStmt = $this->session->prepare(
            "SELECT value, ttl(value) as remaining_ttl FROM {$this->keyspace}.cache_entries WHERE cache_key = ?"
        );

        $this->setStmt = $this->session->prepare(
            "INSERT INTO {$this->keyspace}.cache_entries (cache_key, value, created_at) VALUES (?, ?, toTimestamp(now())) USING TTL ?"
        );

        $this->deleteStmt = $this->session->prepare(
            "DELETE FROM {$this->keyspace}.cache_entries WHERE cache_key = ?"
        );
    }

    /**
     * 读取缓存：Redis → ScyllaDB → 源数据
     */
    public function get(string $key, callable $loader, int $ttl = 3600): mixed
    {
        // 1. 先查 Redis（热缓存，毫秒级）
        $value = $this->redisCache->get($key);
        if ($value !== null) {
            return $value;
        }

        // 2. 再查 ScyllaDB（温缓存，1-5ms）
        $result = $this->session->execute($this->getStmt, [$key]);
        if ($result->count() > 0) {
            $row = $result->first();
            $value = json_decode($row['value'], true);
            
            // 回填 Redis
            $this->redisCache->put($key, $value, min($row['remaining_ttl'], $ttl));
            
            return $value;
        }

        // 3. 最后加载源数据
        $value = $loader();
        
        // 写入两级缓存
        $this->set($key, $value, $ttl);
        
        return $value;
    }

    /**
     * 写入缓存（同时写入 Redis 和 ScyllaDB）
     */
    public function set(string $key, mixed $value, int $ttl = 3600): void
    {
        $jsonValue = json_encode($value);

        // 写入 Redis
        $this->redisCache->put($key, $value, $ttl);

        // 写入 ScyllaDB（TTL 自动过期）
        $this->session->execute($this->setStmt, [$key, $jsonValue, $ttl]);
    }

    /**
     * 删除缓存
     */
    public function delete(string $key): void
    {
        $this->redisCache->forget($key);
        $this->session->execute($this->deleteStmt, [$key]);
    }
}
```

### 5.2 ScyllaDB 缓存表设计

```sql
CREATE KEYSPACE IF NOT EXISTS cache_store
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'datacenter1': 3
};

CREATE TABLE cache_store.cache_entries (
    cache_key   TEXT PRIMARY KEY,
    value       TEXT,
    created_at  TIMESTAMP
) WITH compaction = {
    'class': 'TimeWindowCompactionStrategy',
    'compaction_window_size': 1,
    'compaction_window_unit': 'DAYS'
};
```

### 5.3 二级缓存架构的优势

```
请求流程:
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client  │────▶│  Redis   │────▶│ ScyllaDB │────▶│  Source  │
│          │     │ (热缓存)  │     │ (温缓存)  │     │ (MySQL)  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                 命中率: ~80%       命中率: ~15%      命中率: ~5%
                 延迟: < 1ms        延迟: 1-5ms       延迟: 10-50ms
```

这种架构的优势：

1. **Redis 作为热缓存**：内存存储，微秒级延迟，但容量有限
2. **ScyllaDB 作为温缓存**：磁盘存储，TB 级容量，自动 TTL 过期
3. **MySQL 作为数据源**：只在缓存全部 miss 时查询
4. **缓存穿透保护**：即使 Redis 宕机，ScyllaDB 仍然可以兜底

---

## 六、数据建模最佳实践

### 6.1 宽表设计原则

ScyllaDB 的数据建模与关系型数据库完全不同。核心原则是：**按查询模式建模，而不是按实体关系建模**。

```sql
-- ❌ 关系型思维：规范化设计
-- 用户表
CREATE TABLE users (user_id UUID PRIMARY KEY, name TEXT, email TEXT);
-- 订单表
CREATE TABLE orders (order_id UUID PRIMARY KEY, user_id UUID, ...);
-- 查询时需要 JOIN

-- ✅ ScyllaDB 思维：按查询模式反规范化
-- 查询 1：获取用户的所有订单
CREATE TABLE orders_by_user (
    user_id UUID,
    order_time TIMESTAMP,
    order_id UUID,
    total_amount DECIMAL,
    status TEXT,
    PRIMARY KEY ((user_id), order_time, order_id)
) WITH CLUSTERING ORDER BY (order_time DESC);

-- 查询 2：获取订单详情
CREATE TABLE order_details (
    order_id UUID,
    product_id UUID,
    product_name TEXT,
    quantity INT,
    price DECIMAL,
    PRIMARY KEY ((order_id), product_id)
);
```

### 6.2 避免 ALLOW FILTERING

```sql
-- ❌ 避免使用 ALLOW FILTERING（全表扫描）
SELECT * FROM user_events WHERE event_type = 'purchase' ALLOW FILTERING;

-- ✅ 正确做法：创建专门的查询表
CREATE TABLE events_by_type (
    event_type TEXT,
    event_time TIMESTAMP,
    user_id UUID,
    event_data TEXT,
    PRIMARY KEY ((event_type), event_time, user_id)
) WITH CLUSTERING ORDER BY (event_time DESC);

-- 现在可以高效查询
SELECT * FROM events_by_type WHERE event_type = 'purchase' LIMIT 100;
```

### 6.3 Materialized View（物化视图）

ScyllaDB 支持物化视图，可以自动维护反规范化表：

```sql
-- 创建物化视图：按事件类型查询
CREATE MATERIALIZED VIEW events_by_type_mv AS
    SELECT user_id, event_time, event_type, event_data
    FROM user_events
    WHERE event_type IS NOT NULL AND event_time IS NOT NULL AND user_id IS NOT NULL
    PRIMARY KEY ((event_type), event_time, user_id);
```

**踩坑 #2**：物化视图在 ScyllaDB 中仍被认为是实验性特性。在生产环境中，建议手动维护反规范化表（通过应用层双写或 CDC），以获得更好的控制和可预测性。

---

## 七、运维管理

### 7.1 nodetool 常用命令

```bash
# 查看集群状态
nodetool status

# 输出示例：
# Datacenter: datacenter1
# =======================
# Status=Up/Down
# |/ State=Normal/Leaving/Joining/Moving
# --  Address      Load       Tokens  Owns   Host ID   Rack
# UN  172.18.0.2   1.2 GB     256     33.3%  abc123    rack1
# UN  172.18.0.3   1.1 GB     256     33.4%  def456    rack1
# UN  172.18.0.4   1.3 GB     256     33.3%  ghi789    rack1

# 查看表统计信息
nodetool tablestats ecommerce.user_events

# 查看读写延迟
nodetool tablehistograms ecommerce.user_events

# 修复数据一致性
nodetool repair ecommerce

# 清理数据（删除不再属于本节点的数据）
nodetool cleanup

# 刷新 MemTable 到 SSTable
nodetool flush

# 查看 Compaction 状态
nodetool compactionstats

# 查看线程池状态
nodetool proxyhistograms
```

### 7.2 监控与告警

```yaml
# docker-compose-monitoring.yml
services:
  scylla-exporter:
    image: scylladb/scylla-monitoring:latest
    volumes:
      - ./prometheus/scylla.yml:/etc/prometheus/scylla.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    volumes:
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3000:3000"
```

关键监控指标：

| 指标 | 告警阈值 |
|------|---------|
| Read Latency P99 | > 50ms |
| Write Latency P99 | > 20ms |
| Dropped Mutations | > 0 |
| Pending Compactions | > 100 |
| CPU Usage | > 80% |
| Memory Usage | > 85% |
| Disk Usage | > 75% |
| Gossip Active | != 全部节点数 |

### 7.3 备份与恢复

```bash
# 快照备份
nodetool snapshot ecommerce -t backup_20260602

# 查看快照
nodetool listsnapshots

# 复制快照文件
cp -r /var/lib/scylla/data ecommerce/user_events-<id>/snapshots/backup_20260602 /backup/

# 恢复
# 1. 清空表数据
nodetool clearsnapshot -t backup_20260602

# 2. 将备份文件复制回数据目录
# 3. 执行 nodetool refresh

# 使用 Scylla Manager 进行自动化备份
# Scylla Manager 支持增量备份和定时备份
```

---

## 八、踩坑记录

### 坑 #1: PHP 扩展安装困难

**现象**：`pecl install cassandra` 失败，缺少依赖。

**解决方案**：

```bash
# 确保安装了所有依赖
sudo apt-get install -y libuv1-dev libssl-dev cmake g++ git

# 如果 pecl 安装仍然失败，从源码编译
git clone https://github.com/datastax/php-driver.git
cd php-driver/ext
phpize
./configure --with-cassandra=/usr/local
make && sudo make install
```

### 坑 #2: Eloquent 完全不兼容

**现象**：尝试使用 `Model::create()` 或 `Model::where()` 操作 ScyllaDB 数据。

**原因**：ScyllaDB 使用 CQL 而非 SQL，不支持 JOIN、子查询、聚合函数等关系型特性。Laravel Eloquent 完全基于 SQL，无法直接使用。

**解决方案**：放弃 Eloquent，使用原生 CQL 查询。封装 Repository 层处理所有 ScyllaDB 操作：

```php
<?php

interface EventRepositoryInterface
{
    public function insertEvent(array $event): void;
    public function getUserEvents(string $userId, int $limit): array;
    public function getEventsByType(string $eventType, int $limit): array;
}
```

### 坑 #3: Schema Migration 困难

**现象**：无法使用 Laravel Migration 管理 ScyllaDB 的 Schema。

**原因**：ScyllaDB 的 Schema 变更是通过 CQL 执行的，不是通过 Migration 文件。

**解决方案**：创建专门的 CQL Migration 工具：

```php
<?php
// app/Console/Commands/ScyllaMigrate.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class ScyllaMigrate extends Command
{
    protected $signature = 'scylla:migrate {--path=database/scylla : Path to CQL migration files}';
    protected $description = 'Run ScyllaDB CQL migrations';

    public function handle(\Cassandra\Session $session): int
    {
        $path = $this->option('path');
        $files = File::glob("{$path}/*.cql");
        sort($files);

        foreach ($files as $file) {
            $name = basename($file);
            $this->info("Running: {$name}");

            $cql = File::get($file);
            $statements = array_filter(
                array_map('trim', explode(';', $cql))
            );

            foreach ($statements as $statement) {
                if (empty($statement)) continue;
                try {
                    $session->execute($statement);
                    $this->info("  ✓ Executed");
                } catch (\Exception $e) {
                    $this->error("  ✗ Failed: {$e->getMessage()}");
                }
            }
        }

        return 0;
    }
}
```

### 坑 #4: 热分区问题

**现象**：某些节点 CPU 使用率远高于其他节点，写入延迟升高。

**原因**：Partition Key 选择不当，导致大量数据集中在少数 Partition 上（热点 Partition）。

```sql
-- ❌ 热分区：所有事件都写入同一个 Partition
PRIMARY KEY ((event_type), event_time)
-- 'click' 类型的事件可能有数十亿行，全部在一个 Partition

-- ✅ 分散 Partition：加入用户 ID 作为复合 Partition Key
PRIMARY KEY ((event_type, user_id_bucket), event_time)
-- user_id_bucket = user_id % 100，将数据分散到 100 个 Partition
```

### 坑 #5: Tombstone 问题

**现象**：查询变慢，日志中出现 "Read X live rows and Y tombstone cells" 警告。

**原因**：大量 DELETE 操作产生了过多的 Tombstone（墓碑标记）。

**解决方案**：

```sql
-- 使用 TTL 自动过期代替 DELETE
INSERT INTO user_events (...) VALUES (...) USING TTL 2592000; -- 30 天后自动删除

-- 调整 gc_grace_seconds（Tombstone 清理宽限期）
ALTER TABLE user_events WITH gc_grace_seconds = 86400; -- 1 天（默认 10 天）

-- 调整读取 Tombstone 阈值
-- cassandra.yaml / scylla.yaml
tombstone_warn_threshold: 500
tombstone_failure_threshold: 1000
```

### 坑 #6: 最终一致性的坑

**现象**：写入后立即读取，有时读不到最新数据。

**原因**：使用了 `ONE` 一致性级别，读写可能落在不同副本上。

**解决方案**：使用 `LOCAL_QUORUM` 确保强一致性：

```php
// 配置一致性级别
$cluster = Cluster::builder()
    ->withConsistency(Cassandra::CONSISTENCY_LOCAL_QUORUM)
    ->build();
```

---

## 九、与 Redis 的二级缓存架构

### 9.1 完整架构设计

```php
<?php

class TwoLevelCache
{
    public function __construct(
        private readonly \Illuminate\Contracts\Cache\Repository $redis,
        private readonly \Cassandra\Session $scylla,
        private readonly \Psr\Log\LoggerInterface $logger
    ) {
        $this->prepareScyllaStatements();
    }

    private function prepareScyllaStatements(): void
    {
        $this->scyllaGet = $this->scylla->prepare(
            'SELECT value, writetime(value) as ts FROM cache_entries WHERE cache_key = ?'
        );
        $this->scyllaSet = $this->scylla->prepare(
            'INSERT INTO cache_entries (cache_key, value) VALUES (?) USING TTL ?'
        );
        $this->scyllaDelete = $this->scylla->prepare(
            'DELETE FROM cache_entries WHERE cache_key = ?'
        );
    }

    public function get(string $key, ?callable $loader = null, int $ttl = 3600): mixed
    {
        // Level 1: Redis
        $value = $this->redis->get($key);
        if ($value !== null) {
            $this->logger->debug("Cache L1 hit: {$key}");
            return $value;
        }

        // Level 2: ScyllaDB
        $result = $this->scylla->execute($this->scyllaGet, [$key]);
        if ($result->count() > 0) {
            $value = json_decode($result->first()['value'], true);
            $this->redis->put($key, $value, $ttl);
            $this->logger->debug("Cache L2 hit: {$key}");
            return $value;
        }

        // Level 3: Source
        if ($loader === null) {
            return null;
        }

        $value = $loader();
        $this->set($key, $value, $ttl);
        $this->logger->debug("Cache miss, loaded from source: {$key}");

        return $value;
    }

    public function set(string $key, mixed $value, int $ttl = 3600): void
    {
        $json = json_encode($value);
        $this->redis->put($key, $value, $ttl);
        $this->scylla->execute($this->scyllaSet, [$key, $json, $ttl]);
    }

    public function delete(string $key): void
    {
        $this->redis->forget($key);
        $this->scylla->execute($this->scyllaDelete, [$key]);
    }

    /**
     * 批量预热缓存
     */
    public function warmUp(array $keys, callable $loader, int $ttl = 3600): void
    {
        $missingKeys = [];
        
        foreach ($keys as $key) {
            if (!$this->redis->has($key)) {
                $missingKeys[] = $key;
            }
        }

        if (empty($missingKeys)) return;

        // 批量加载
        $values = $loader($missingKeys);
        
        foreach ($values as $key => $value) {
            $this->set($key, $value, $ttl);
        }
    }
}
```

### 9.2 成本对比

| 方案 | 存储成本（1TB 数据） | 月费用 | 延迟 |
|------|---------------------|--------|------|
| Redis（全内存） | ~$15,000/月 | 高 | < 1ms |
| ScyllaDB（全磁盘） | ~$500/月 | 低 | 1-5ms |
| Redis + ScyllaDB（二级） | ~$2,000/月 | 中 | < 1ms（命中 L1） |

---

## 十、总结

ScyllaDB 是一个非常强大的分布式 NoSQL 数据库，特别适合以下场景：

1. **高吞吐写入**：每秒数十万到数百万次写入
2. **大数据量存储**：PB 级数据，磁盘存储成本远低于内存
3. **低延迟读取**：毫秒级读取延迟
4. **多数据中心**：原生支持跨数据中心复制

对于 Laravel 开发者而言，集成 ScyllaDB 的关键点是：

1. **放弃 Eloquent**：使用原生 CQL 查询，封装 Repository 层
2. **按查询模式建模**：反规范化设计，为每种查询创建专门的表
3. **使用异步写入**：最大化写入吞吐量
4. **二级缓存架构**：Redis 作为热缓存，ScyllaDB 作为温缓存
5. **注意一致性级别**：根据业务需求选择合适的一致性级别

如果你的 Laravel 应用遇到了 Redis 内存瓶颈或 MySQL 写入瓶颈，ScyllaDB 是一个值得考虑的升级方案。

---

## 参考资料

- [ScyllaDB 官方文档](https://docs.scylladb.com/)
- [ScyllaDB University](https://university.scylladb.com/)
- [DataStax PHP Driver 文档](https://docs.datastax.com/en/developer/php-driver/latest/)
- [Seastar 框架](http://seastar.io/)
- [Cassandra 数据建模最佳实践](https://cassandra.apache.org/doc/latest/cassandra/data_modeling/intro.html)

---

## 相关阅读

- [TimescaleDB 实战：时序数据库在 Laravel 中的集成——IoT 数据、用户行为分析与物化视图踩坑记录](/categories/数据库/TimescaleDB-实战-时序数据库在Laravel中的集成-IoT数据用户行为分析与物化视图踩坑记录/) — 同为数据库分类，探讨时序场景下的数据库选型与物化视图实践
- [TiDB 实战：分布式 SQL 数据库在 Laravel 中的集成——MySQL 兼容的 NewSQL 选型指南](/categories/MySQL数据库/tidb-laravel-integration-newsql-guide/) — 另一种分布式数据库选型，与 ScyllaDB 的 NoSQL 路线形成对比
- [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/categories/Redis/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/) — 高性能内存数据库选型，与 ScyllaDB 在缓存层形成互补
