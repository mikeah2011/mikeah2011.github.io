---

title: CockroachDB 实战：分布式 SQL 数据库——Laravel 中的全球分布式事务与强一致性选型指南
keywords: [CockroachDB, SQL, Laravel, 分布式, 数据库, 中的全球分布式事务与强一致性选型指南]
date: 2026-06-03 08:00:00
description: CockroachDB 是基于 Raft 共识协议的分布式 SQL 数据库，兼容 PostgreSQL 协议，原生支持全球多区域部署与强一致性事务。本文从架构原理出发，深入讲解 CockroachDB 与 Laravel 的集成方式——包括数据库连接配置、Eloquent ORM 适配、分布式事务编写、Geo-Partitioning 地理分区策略，以及自增 ID 迁移、写热点规避等实战踩坑经验。同时对比 TiDB、YugabyteDB 等 NewSQL 方案，提供完整的选型决策流程与成本分析，帮助 Laravel 开发者在全球化业务场景下做出最优数据库选型。
tags:
- cockroachdb
- 数据库
- NewSQL
- Laravel
- raft
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---





## 前言

当你的 Laravel 应用从单一区域扩展到全球用户时，传统 MySQL 主从架构会遇到一个根本性矛盾：**数据一致性和访问延迟之间必须做出取舍。**

跨大洲的 MySQL 主从复制延迟通常在 100-300ms，这意味着要么接受「写入后立即读取可能读到旧数据」，要么承受「所有写入都回源到主库」的高延迟。

**CockroachDB** 提供了一个诱人的解决方案：**全球分布式、强一致性、SQL 兼容。** 它承诺让你像使用 PostgreSQL 一样使用一个全球分布的数据库，同时保证 ACID 事务。

本文将深入探讨 CockroachDB 的架构原理、与 Laravel 的集成方式、性能特征，以及最重要的——**什么时候应该选它，什么时候不应该。**

<!-- more -->

---

## 一、CockroachDB 是什么？

### 1.1 核心特性

CockroachDB 是一个 **分布式 SQL 数据库**，由前 Google 工程师创建（灵感来自 Google Spanner）。它的核心特性：

- **分布式事务：** 跨多个节点的 ACID 事务，Serializable 隔离级别
- **强一致性：** 基于 Raft 共识协议，写入确认即意味着所有副本已同步
- **SQL 兼容：** 兼容 PostgreSQL 协议，大部分 PostgreSQL 客户端和 ORM 可以直接使用
- **自动分片：** 数据自动分裂和合并，无需手动分库分表
- **自动故障恢复：** 节点宕机后自动重新复制数据
- **全球分布：** 支持跨区域、跨大洲部署

### 1.2 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        CockroachDB 集群                          │
│                                                                  │
│  ┌───────────── US-East (Region) ─────────────┐                 │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐    │                 │
│  │  │ Node 1  │  │ Node 2  │  │ Node 3  │    │                 │
│  │  │ (KV +   │  │ (KV +   │  │ (KV +   │    │                 │
│  │  │  SQL)   │  │  SQL)   │  │  SQL)   │    │                 │
│  │  └─────────┘  └─────────┘  └─────────┘    │                 │
│  └────────────────────────────────────────────┘                 │
│         │                    ▲                                   │
│         │    Raft Replication │                                   │
│         ▼                    │                                   │
│  ┌───────────── EU-West (Region) ─────────────┐                 │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐    │                 │
│  │  │ Node 4  │  │ Node 5  │  │ Node 6  │    │                 │
│  │  │ (KV +   │  │ (KV +   │  │ (KV +   │    │                 │
│  │  │  SQL)   │  │  SQL)   │  │  SQL)   │    │                 │
│  │  └─────────┘  └─────────┘  └─────────┘    │                 │
│  └────────────────────────────────────────────┘                 │
│         │                    ▲                                   │
│         │    Raft Replication │                                   │
│         ▼                    │                                   │
│  ┌───────────── AP-Southeast (Region) ────────┐                 │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐    │                 │
│  │  │ Node 7  │  │ Node 8  │  │ Node 9  │    │                 │
│  │  │ (KV +   │  │ (KV +   │  │ (KV +   │    │                 │
│  │  │  SQL)   │  │  SQL)   │  │  SQL)   │    │                 │
│  │  └─────────┘  └─────────┘  └─────────┘    │                 │
│  └────────────────────────────────────────────┘                 │
│                                                                  │
│  每个 Range（默认 512MB）由 Raft 组管理                           │
│  每个 Raft 组有 3 个副本，分布在不同区域                          │
│  Leader 副本处理读写，Follower 同步数据                           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 关键概念

**Range（范围）：** CockroachDB 将表数据按 Key Range 分割成多个 Range（默认 512MB）。每个 Range 是一个 Raft 复制组。

**Raft 共识：** 每个 Range 的写入必须经过 Raft Leader 提交，获得多数副本（≥2/3）确认后才算成功。这保证了强一致性。

**Leaseholder：** 每个 Range 有一个 Leaseholder 节点，负责处理该 Range 的读请求。读请求不需要走 Raft，直接从 Leaseholder 读取（因为 Leaseholder 保证持有最新数据）。

**Serializable 隔离：** CockroachDB 默认使用 Serializable 隔离级别，这是 SQL 标准中最高的隔离级别。它保证并发事务的结果等价于某种串行执行顺序。

---

## 二、CockroachDB vs 其他分布式数据库

### 2.1 全面对比

| 维度 | CockroachDB | TiDB | YugabyteDB | Google Spanner |
|------|-------------|------|------------|----------------|
| **开源** | BSL → Apache 2.0（3年后） | Apache 2.0 | Apache 2.0 | 闭源 |
| **SQL 兼容** | PostgreSQL 协议 | MySQL 协议 | PostgreSQL + Cassandra | GoogleSQL |
| **一致性** | Serializable（默认） | Snapshot Isolation | Serializable | External Consistency |
| **共识协议** | Raft | Multi-Raft + Paxos | Raft | TrueTime + Paxos |
| **自动分片** | ✅ | ✅ | ✅ | ✅ |
| **全球分布** | ✅ 原生支持 | ✅ 但延迟较高 | ✅ | ✅ 最佳（TrueTime） |
| **HTAP** | 有限 | ✅ TiFlash 列存 | 有限 | 有限 |
| **Laravel 支持** | ✅ pgsql driver | ✅ mysql driver | ✅ pgsql driver | 需要 custom driver |
| **云托管** | CockroachDB Serverless/Dedicated | TiDB Cloud | YugabyteDB Anywhere | GCP Spanner |
| **社区活跃度** | 高 | 高（PingCAP） | 中 | N/A |

### 2.2 Raft vs Paxos

CockroachDB 使用 Raft 共识协议，而 Spanner 使用 Paxos。两者的核心区别：

**Raft：**
- 更容易理解和实现
- Leader 必须处理所有写入（单点瓶颈）
- 成员变更需要额外的配置变更日志条目

**Paxos（Multi-Paxos）：**
- 理论上更灵活
- 可以实现 leaderless 写入（但 Spanner 实际上也是 leader-based）
- 实现复杂度更高

**实际影响：** 对于大多数工作负载，Raft 和 Paxos 的性能差异不大。CockroachDB 选择 Raft 是一个工程上的务实选择——更容易正确实现。

### 2.3 TrueTime vs HLC

**Spanner 的 TrueTime：** 使用 GPS 和原子钟提供全局同步的时钟，误差在 7ms 以内。这使得 Spanner 可以实现 External Consistency（比 Serializable 更强的保证）。

**CockroachDB 的 HLC（Hybrid Logical Clock）：** 使用混合逻辑时钟，不需要特殊硬件。通过「不确定区间」技术，在读取时等待足够长的时间来消除时钟偏差的影响。

**实际影响：** CockroachDB 的 HLC 可能导致偶尔的读取延迟增加（等待时钟不确定区间过去），但这个延迟通常很小（几毫秒）。对于大多数应用，这不是问题。

---

## 三、与 Laravel 集成

### 3.1 安装与配置

CockroachDB 兼容 PostgreSQL 协议，因此 Laravel 的 `pgsql` driver 可以直接使用。

```bash
# 安装 CockroachDB（本地开发）
# macOS
brew install cockroachdb/tap/cockroach

# 启动单节点集群（开发用）
cockroach start-single-node \
  --insecure \
  --store=crdb-data \
  --listen-addr=localhost:26257 \
  --http-addr=localhost:8080

# 创建数据库
cockroach sql --insecure -e "CREATE DATABASE myapp;"

# 或者使用 Docker
docker run -d --name crdb \
  -p 26257:26257 -p 8080:8080 \
  cockroachdb/cockroach:latest start-single-node \
  --insecure
```

### 3.2 Laravel 配置

```php
// config/database.php
'connections' => [
    'cockroachdb' => [
        'driver' => 'pgsql',
        'host' => env('DB_HOST', 'localhost'),
        'port' => env('DB_PORT', '26257'),
        'database' => env('DB_DATABASE', 'myapp'),
        'username' => env('DB_USERNAME', 'root'),
        'password' => env('DB_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'prefix_indexes' => true,
        'search_path' => 'public',
        'sslmode' => 'prefer',
    ],
],
```

```env
# .env
DB_CONNECTION=cockroachdb
DB_HOST=localhost
DB_PORT=26257
DB_DATABASE=myapp
DB_USERNAME=root
DB_PASSWORD=
```

### 3.3 基本 CRUD 操作

```php
// Eloquent 模型 — 代码完全不变
class Order extends Model
{
    protected $fillable = ['user_id', 'total', 'status', 'items'];
    
    // CockroachDB 的 JSONB 支持良好
    protected $casts = [
        'items' => 'array',
        'total' => 'decimal:2',
    ];
    
    public function user()
    {
        return $this->belongsTo(User::class);
    }
}

// 创建
$order = Order::create([
    'user_id' => $user->id,
    'total' => 299.99,
    'status' => 'pending',
    'items' => [
        ['product_id' => 1, 'quantity' => 2, 'price' => 149.99],
    ],
]);

// 查询
$recentOrders = Order::where('user_id', $user->id)
    ->where('created_at', '>=', now()->subDays(30))
    ->with('user')
    ->orderByDesc('created_at')
    ->paginate(20);

// 聚合
$dailyRevenue = Order::where('status', 'completed')
    ->whereDate('created_at', today())
    ->selectRaw('SUM(total) as revenue, COUNT(*) as order_count')
    ->first();
```

### 3.4 分布式事务

这是 CockroachDB 最强大的能力——跨多个「表」甚至多个「区域」的 ACID 事务：

```php
// 跨多个表的分布式事务 — 在 CockroachDB 中自动处理
DB::transaction(function () use ($user, $cart, $paymentInfo) {
    // 1. 创建订单
    $order = Order::create([
        'user_id' => $user->id,
        'total' => $cart->total(),
        'status' => 'pending',
    ]);
    
    // 2. 扣减库存（可能分布在不同的 Range/节点上）
    foreach ($cart->items as $item) {
        $affected = DB::table('inventory')
            ->where('product_id', $item->product_id)
            ->where('quantity', '>=', $item->quantity)
            ->update([
                'quantity' => DB::raw("quantity - {$item->quantity}"),
            ]);
        
        if ($affected === 0) {
            throw new OutOfStockException($item->product_id);
        }
    }
    
    // 3. 创建支付记录（可能在另一个区域的节点上）
    Payment::create([
        'order_id' => $order->id,
        'amount' => $order->total,
        'method' => $paymentInfo['method'],
        'status' => 'processing',
    ]);
    
    // 4. 创建物流记录
    Shipment::create([
        'order_id' => $order->id,
        'status' => 'pending',
        'estimated_delivery' => now()->addDays(3),
    ]);
    
    // 整个事务要么全部成功，要么全部回滚
    // 即使 inventory、orders、payments、shipments 分布在不同节点/区域
});
```

### 3.5 Laravel 队列与 CockroachDB

```php
// 使用 CockroachDB 作为队列驱动
// config/queue.php
'connections' => [
    'cockroachdb' => [
        'driver' => 'database',
        'connection' => 'cockroachdb',
        'table' => 'jobs',
        'queue' => 'default',
        'retry_after' => 90,
        'after_commit' => true,
    ],
],
```

**注意事项：** CockroachDB 作为队列后端时，高并发的队列操作（大量 INSERT + DELETE）可能遇到写热点问题。建议使用 Redis 作为队列驱动，CockroachDB 用于持久化数据。

---

## 四、Geo-Partitioning（地理分区）

### 4.1 什么是 Geo-Partitioning

Geo-Partitioning 允许你将数据的「主副本」固定到特定区域，从而降低该区域用户的读写延迟。

```
┌─────────────────────────────────────────────────────┐
│                   CockroachDB 集群                    │
│                                                      │
│  US-East Region          EU-West Region              │
│  ┌─────────────────┐     ┌─────────────────┐        │
│  │  users_us 数据   │     │  users_eu 数据   │        │
│  │  (主副本在 US)   │     │  (主副本在 EU)   │        │
│  │                  │     │                  │        │
│  │  美国用户的订单   │     │  欧洲用户的订单   │        │
│  │  访问延迟: <5ms  │     │  访问延迟: <5ms  │        │
│  └─────────────────┘     └─────────────────┘        │
│          │                        │                  │
│          │     异步/同步复制      │                  │
│          └────────────────────────┘                  │
│                                                      │
│  全局表（不分区）:                                     │
│  ┌─────────────────────────────────────────┐        │
│  │  products  │  categories  │  settings   │        │
│  │  每个区域都有完整副本                      │        │
│  └─────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘
```

### 4.2 Laravel 中实现 Geo-Partitioning

```sql
-- 创建分区表
CREATE TABLE users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email STRING NOT NULL,
    name STRING NOT NULL,
    region STRING NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
) PARTITION BY LIST (region);

-- 创建分区
ALTER TABLE users PARTITION us_east VALUES IN ('us-east')
    CONFIGURE ZONE USING
    constraints = '[+region=us-east]',
    num_replicas = 3,
    lease_preferences = '[[+region=us-east]]';

ALTER TABLE users PARTITION eu_west VALUES IN ('eu-west')
    CONFIGURE ZONE USING
    constraints = '[+region=eu-west]',
    num_replicas = 3,
    lease_preferences = '[[+region=eu-west]]';
```

```php
// 在 Laravel 中，根据用户所在区域路由请求
class GeoPartitionedUser extends Model
{
    protected $table = 'users';
    
    protected static function booted(): void
    {
        // 创建用户时自动设置区域
        static::creating(function (self $user) {
            $user->region = GeoResolver::detect(request()->ip());
        });
    }
    
    // 查询时自动过滤当前区域
    public function scopeLocal(Builder $query): Builder
    {
        return $query->where('region', GeoResolver::currentRegion());
    }
}

class GeoResolver
{
    private static array $regionMap = [
        'us-east' => ['1.0.0.0/8', '2.0.0.0/8'],  // 简化示例
        'eu-west' => ['3.0.0.0/8', '4.0.0.0/8'],
    ];
    
    public static function detect(string $ip): string
    {
        // 使用 MaxMind GeoIP 或类似服务
        $geo = geoip($ip);
        
        return match ($geo->continent_code) {
            'NA' => 'us-east',
            'EU' => 'eu-west',
            'AS' => 'ap-southeast',
            default => 'us-east',
        };
    }
    
    public static function currentRegion(): string
    {
        // 根据部署配置确定当前区域
        return config('app.cockroachdb_region', 'us-east');
    }
}
```

### 4.3 全局表 vs 本地表

| 表类型 | 适用场景 | 延迟特性 |
|--------|----------|----------|
| **全局表**（GLOBAL） | 产品目录、配置、小表 | 读快（本地），写慢（全球同步） |
| **区域表**（REGIONAL BY ROW） | 用户数据、订单 | 读写都快（本地区域） |
| **默认**（无分区） | 低频访问的表 | 取决于 Leaseholder 位置 |

---

## 五、性能特征与基准测试

### 5.1 延迟特征

**单区域部署（3 节点，同一数据中心）：**
- 简单 SELECT：0.5-2ms
- 单行 INSERT：1-3ms
- 简单事务（2-3 个操作）：3-8ms
- 复杂事务（10+ 个操作）：10-30ms

**多区域部署（3 个区域，跨大洲）：**
- 简单 SELECT（本地 Leaseholder）：1-5ms
- 简单 SELECT（远程 Leaseholder）：50-150ms
- 跨区域事务：100-300ms（取决于区域间延迟）

### 5.2 吞吐量

**单节点性能（m5d.xlarge, 4 vCPU, 16GB RAM, NVMe SSD）：**
- 简单 SELECT QPS：~15,000
- 简单 INSERT TPS：~8,000
- 混合 OLTP TPS：~3,000-5,000

**集群扩展性：**
- 3 节点 ≈ 2.5x 单节点吞吐量
- 6 节点 ≈ 4.5x 单节点吞吐量
- 9 节点 ≈ 6.5x 单节点吞吐量

扩展效率约为 80-85%，非线性原因：Raft 共识开销、跨节点协调、网络延迟。

### 5.3 vs MySQL 性能对比

| 操作类型 | MySQL 8.0（单机） | CockroachDB（3 节点） | 差异 |
|----------|-------------------|----------------------|------|
| 简单 SELECT | 0.1-0.5ms | 0.5-2ms | 3-5x 慢 |
| 简单 INSERT | 0.2-0.5ms | 1-3ms | 3-6x 慢 |
| 复杂 JOIN | 5-20ms | 10-40ms | 1.5-2x 慢 |
| 批量 INSERT (1000行) | 50-100ms | 100-300ms | 2-3x 慢 |
| 全表扫描 (1M行) | 500ms | 1-2s | 2-3x 慢 |

**关键结论：** CockroachDB 的单查询延迟比 MySQL 高 3-5 倍。这是分布式共识的代价。如果你的应用是延迟敏感的简单 CRUD，MySQL 更合适。CockroachDB 的价值在于它的**分布式能力**——跨区域一致性、自动分片、故障恢复——而不是单查询速度。

---

## 六、从 MySQL/PostgreSQL 迁移

### 6.1 迁移挑战

**类型映射：**

| MySQL 类型 | CockroachDB 类型 | 注意事项 |
|------------|------------------|----------|
| INT AUTO_INCREMENT | UUID（推荐）或 SERIAL | 自增 ID 在分布式环境中可能成为热点 |
| ENUM | STRING + CHECK 约束 | CockroachDB 不支持 ENUM 类型 |
| DATETIME | TIMESTAMPTZ | 推荐使用带时区的时间戳 |
| JSON | JSONB | 功能相似 |
| TEXT/BLOB | STRING/BYTES | 大对象可能影响性能 |
| UNSIGNED INT | INT | CockroachDB 不支持无符号整数 |

**SQL 语法差异：**

```sql
-- MySQL 的 INSERT ... ON DUPLICATE KEY UPDATE
-- CockroachDB 使用 UPSERT
INSERT INTO products (id, name, price, updated_at)
VALUES (1, 'Widget', 9.99, now())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    updated_at = EXCLUDED.updated_at;

-- MySQL 的 REPLACE INTO
-- CockroachDB 使用 INSERT ... ON CONFLICT
INSERT INTO products (id, name, price)
VALUES (1, 'Widget', 9.99)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price;
```

### 6.2 ID 策略

在分布式环境中，自增 ID 是一个反模式——它会导致写入热点（所有 INSERT 都集中在一个 Range 上）。

```php
// 推荐方案 1：使用 UUID
class Order extends Model
{
    use HasUuids; // Laravel 9+ 内置
    
    protected $keyType = 'string';
    public $incrementing = false;
}

// 推荐方案 2：使用 ULID（有序 UUID，对索引更友好）
class Order extends Model
{
    use HasUlids; // Laravel 10+ 内置
}

// 推荐方案 3：使用 Snowflake ID
class Order extends Model
{
    public $keyType = 'string';
    public $incrementing = false;
    
    protected static function booted(): void
    {
        static::creating(function (self $model) {
            if (!$model->getKey()) {
                $model->setAttribute(
                    $model->getKeyName(),
                    app(SnowflakeGenerator::class)->generate()
                );
            }
        });
    }
}
```

### 6.3 自增 ID 转 UUID 迁移脚本

```php
// database/migrations/xxxx_add_uuid_to_orders.php
class AddUuidToOrders extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->uuid('uuid')->nullable()->unique();
        });
        
        // 分批生成 UUID（避免长事务）
        Order::chunkById(1000, function ($orders) {
            foreach ($orders as $order) {
                $order->update(['uuid' => (string) Str::uuid()]);
            }
        });
        
        // 后续步骤：将外键引用改为 UUID
        // 最后：删除旧的 id 列，将 uuid 改为 id
    }
}
```

### 6.4 迁移工具推荐

- **pgloader：** 可以从 MySQL 直接迁移到 PostgreSQL/CockroachDB
- **AWS DMS：** 支持 MySQL → CockroachDB 的持续复制
- **Laravel Migrations：** 如果是新项目，直接用 Laravel 迁移

```bash
# 使用 pgloader 从 MySQL 迁移
pgloader mysql://root:password@mysql-host/myapp \
         postgresql://root@crdb-host:26257/myapp

# 注意：迁移后需要：
# 1. 检查数据类型映射是否正确
# 2. 测试所有 SQL 查询
# 3. 调整索引策略
```

---

## 七、成本分析

### 7.1 自托管成本

| 配置 | 月成本（AWS 按需） | 适用场景 |
|------|-------------------|----------|
| 3 节点 × c5.xlarge | ~$300 | 开发/小型生产 |
| 3 节点 × c5.2xlarge | ~$600 | 中型生产 |
| 6 节点 × c5.2xlarge | ~$1,200 | 大型生产 |
| 9 节点 × c5.4xlarge | ~$3,600 | 高吞吐量 |

**附加成本：**
- 存储：GP3 SSD ~$0.08/GB/月
- 网络：跨区域流量 $0.02-0.09/GB
- 运维人力：需要有经验的 DBA 或 SRE

### 7.2 CockroachDB Cloud（托管版）

| 方案 | 价格 | 特点 |
|------|------|------|
| Serverless | 免费额度 + $0.50/M RU | 按请求单元计费，适合开发和小型应用 |
| Dedicated | $0.50/vCPU/小时起 | 专用集群，适合中大型生产 |
| Advanced | 联系销售 | 多区域、SLA、专属支持 |

**Serverless 示例成本：**
- 每月 1000 万请求 ≈ 免费（免费额度内）
- 每月 1 亿请求 ≈ $50
- 每月 10 亿请求 ≈ $500

### 7.3 成本对比

| 方案 | 中型项目月成本 | 管理成本 |
|------|---------------|----------|
| MySQL RDS（多可用区） | $200-400 | 低 |
| MySQL 自管理（主从） | $100-200 | 中 |
| TiDB Cloud | $300-600 | 低 |
| CockroachDB Cloud | $200-500 | 低 |
| CockroachDB 自管理 | $300-600 | 高 |

---

## 八、什么时候选 CockroachDB

### 8.1 适合的场景

✅ **全球用户、需要数据主权合规：** 用户数据必须存储在特定区域（GDPR），同时需要全球可访问。

✅ **需要强一致性的分布式事务：** 金融、电商等场景，不能接受「最终一致性」。

✅ **数据量大、增长快：** 自动分片和扩缩容，不需要手动分库分表。

✅ **高可用要求：** 节点/区域故障时自动恢复，RPO=0（零数据丢失）。

✅ **正在使用 PostgreSQL：** 迁移成本最低，driver 兼容。

### 8.2 不适合的场景

❌ **延迟极度敏感的简单 CRUD：** 单查询 1-3ms vs MySQL 的 0.1-0.5ms，差距明显。

❌ **单区域部署、数据量不大：** MySQL 更简单、更快、更便宜。

❌ **需要复杂分析查询（HTAP）：** CockroachDB 的 OLAP 能力有限，考虑 TiDB + TiFlash。

❌ **团队没有分布式系统经验：** CockroachDB 的运维复杂度高于 MySQL。

❌ **预算紧张：** 分布式数据库的硬件和运维成本显著高于单机 MySQL。

### 8.3 决策流程

```
你的应用需要全球部署吗？
├── 否 → 你需要强一致性的分布式事务吗？
│   ├── 否 → 使用 MySQL/PostgreSQL（主从复制）
│   └── 是 → 你的数据量会超过单机容量吗？
│       ├── 否 → 使用 MySQL/PostgreSQL（单机）
│       └── 是 → 考虑 CockroachDB 或 TiDB
└── 是 → 你需要数据主权合规吗？
    ├── 否 → 考虑 CockroachDB 或 Spanner
    └── 是 → CockroachDB 的 Geo-Partitioning 最适合
```

---

## 九、生产环境最佳实践

### 9.1 集群规划

```yaml
# 生产集群推荐配置
cluster:
  nodes: 6  # 最少 3 节点，推荐 6+ 节点
  regions:
    - name: us-east-1
      nodes: 2
      instance: c5.2xlarge  # 8 vCPU, 16GB RAM
      storage: 500GB GP3
    - name: eu-west-1
      nodes: 2
      instance: c5.2xlarge
      storage: 500GB GP3
    - name: ap-southeast-1
      nodes: 2
      instance: c5.2xlarge
      storage: 500GB GP3
  
  replication:
    factor: 3  # 每个 Range 3 个副本
    zone_constraints:
      - "+region=us-east-1"
      - "+region=eu-west-1"
      - "+region=ap-southeast-1"
```

### 9.2 索引策略

```sql
-- CockroachDB 支持大部分 PostgreSQL 索引特性
-- 创建索引
CREATE INDEX idx_orders_user_status 
ON orders (user_id, status) 
STORING (total, created_at);  -- 覆盖索引

-- 部分索引（PostgreSQL 语法）
CREATE INDEX idx_orders_pending 
ON orders (created_at) 
WHERE status = 'pending';

-- GIN 索引（用于 JSONB 查询）
CREATE INDEX idx_orders_metadata 
ON orders USING GIN (items);
```

### 9.3 监控

```yaml
# Prometheus 监控配置
scrape_configs:
  - job_name: 'cockroachdb'
    metrics_path: '/_status/vars'
    static_configs:
      - targets:
          - 'crdb-node1:8080'
          - 'crdb-node2:8080'
          - 'crdb-node3:8080'
          - 'crdb-node4:8080'
          - 'crdb-node5:8080'
          - 'crdb-node6:8080'
```

**关键监控指标：**
- `cr.node.sql.query.count`：SQL 查询总数
- `cr.node.sql.service.latency`：SQL 服务延迟
- `cr.store.replicas.leaders`：Leader 副本数量
- `cr.store.raft.process.logcommitted.latency`：Raft 提交延迟
- `cr.node.liveness.epochincrements`：节点活跃度

### 9.4 常见问题排查

**写热点：**
```sql
-- 查看 Range 分布
SELECT start_key, end_key, lease_holder, replicas 
FROM [SHOW RANGES FROM TABLE orders];

-- 解决方案：使用 UUID 替代自增 ID
-- 解决方案：打散写入（在 ID 中加入随机前缀）
```

**慢查询：**
```sql
-- 开启慢查询日志
SET CLUSTER SETTING sql.trace.session_eventlog.enabled = true;
SET CLUSTER SETTING sql.trace.txn.enable_threshold = '500ms';

-- 查看执行计划
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 123 AND status = 'pending';
```

---

## 十、踩坑案例与解决方案

### 10.1 长事务导致 OOM

CockroachDB 的 MVCC 机制会保留事务开始时的快照。长时间运行的事务会导致大量旧版本无法 GC，最终引发内存压力：

```php
// ❌ 错误：一次性处理大量数据
DB::transaction(function () {
    Order::where('status', 'expired')
        ->chunk(1000, function ($orders) {
            foreach ($orders as $order) {
                $order->update(['status' => 'archived']);
            }
        });
});

// ✅ 正确：分批小事务
Order::where('status', 'expired')
    ->chunkById(500, function ($orders) {
        DB::transaction(function () use ($orders) {
            foreach ($orders as $order) {
                $order->update(['status' => 'archived']);
            }
        });
    });
```

**教训：** CockroachDB 生产环境建议将事务时间限制在 5 秒以内，可通过 `SET default_transaction_timeout = '5s'` 配置。

### 10.2 写热点与 Range 分裂

使用自增 ID 时，所有 INSERT 都集中在同一个 Range 的 Leader 上，导致单节点成为瓶颈：

```php
// ❌ 自增 ID 导致写热点
class Order extends Model
{
    // 默认自增 ID，所有写入打到同一个 Range
}

// ✅ 使用 ULID 打散写入
class Order extends Model
{
    use HasUlids; // 时间有序但前缀随机，写入均匀分布

    protected $keyType = 'string';
    public $incrementing = false;
}
```

**监控写热点：**
```sql
-- 查看各节点 QPS 分布
SELECT node_id, sum(value) as qps
FROM crdb_internal.node_metrics
WHERE name = 'sql.query.count'
GROUP BY node_id;

-- 查看 Range Leader 分布
SELECT lease_holder, count(*) as range_count
FROM [SHOW RANGES FROM TABLE orders]
GROUP BY lease_holder;
```

### 10.3 跨区域事务延迟不可控

当事务涉及多个区域的数据时，延迟取决于区域间网络往返时间（RTT）。美东到欧西约 80ms，美东到亚太约 180ms：

```php
// ❌ 在一个事务中操作多个区域的数据
DB::transaction(function () use ($usUser, $euUser) {
    // 美东用户数据 + 欧洲用户数据 → 跨区域事务，延迟 ~160ms+
    $usUser->update(['balance' => $usUser->balance - 100]);
    $euUser->update(['balance' => $euUser->balance + 100]);
});

// ✅ 使用 Geo-Partitioning 将相关数据放在同一区域
// 或使用异步补偿模式
TransferOrder::create([
    'from_user' => $usUser->id,
    'to_user' => $euUser->id,
    'amount' => 100,
    'status' => 'pending',
]);
ProcessTransfer::dispatch($transferId); // 异步处理
```

### 10.4 Eloquent `firstOrCreate` 竞态条件

CockroachDB 的 Serializable 隔离级别下，`firstOrCreate` 可能触发事务重试：

```php
// ❌ 高并发下可能触发多次重试
$user = User::firstOrCreate(
    ['email' => $email],
    ['name' => $name]
);

// ✅ 使用 upsert 明确冲突处理
DB::table('users')->upsert(
    [['email' => $email, 'name' => $name, 'updated_at' => now()]],
    ['email'], // 冲突键
    ['name', 'updated_at'] // 更新字段
);
```

---

## 十一、总结

CockroachDB 代表了一类重要的技术趋势：**将分布式系统的能力包装成开发者友好的 SQL 接口。** 它不是 MySQL 的直接替代品，而是在特定场景下的更优选择。

**核心价值主张：**
1. **全球分布 + 强一致性：** 这是 MySQL 做不到的
2. **SQL 兼容：** 最低的迁移成本
3. **自动运维：** 分片、副本、故障恢复全部自动
4. **Laravel 友好：** pgsql driver 直接可用

**核心代价：**
1. 单查询延迟比 MySQL 高 3-5 倍
2. 硬件和运维成本更高
3. 部分 MySQL 语法不兼容
4. 生态系统不如 MySQL 成熟

**最终建议：** 不要因为 CockroachDB「酷」就使用它。如果你的 Laravel 应用运行在一个区域、数据量在 TB 级以下、没有分布式事务需求，MySQL 仍然是更好的选择。当你真正需要全球分布、强一致性、自动分片时，CockroachDB 才值得那个额外的复杂度和成本。

---

## 相关阅读

- [TiDB 实战：分布式 SQL 数据库在 Laravel 中的集成——MySQL 兼容的 NewSQL 选型指南](/databases/tidb-laravel-integration-newsql-guide/) — 如果你的团队更熟悉 MySQL 生态，TiDB 提供了 MySQL 协议兼容的分布式方案，本文对比了 CockroachDB 与 TiDB 在 Laravel 项目中的实际差异。
- [数据库连接池实战：PgBouncer vs ProxySQL vs Supabase 在高并发 Laravel 中的选型对比](/databases/database-connection-pool-pgbouncer-proxysql-supabase-comparison/) — 分布式数据库的连接管理更加复杂，本文详解连接池方案如何提升 CockroachDB/TiDB 的并发处理能力。
- [ScyllaDB 实战：C++ 重写的高性能 NoSQL——Laravel 分布式缓存与高吞吐写入选型对比](/databases/ScyllaDB-实战-C++重写的高性能NoSQL-Laravel分布式缓存与高吞吐写入选型对比/) — 当你的写入吞吐量成为瓶颈时，ScyllaDB 提供了另一种分布式数据层选择，与 CockroachDB 形成互补。

## 参考资料

1. CockroachDB Documentation. cockroachlabs.com/docs
2. Google. "Spanner: Globally-Distributed Google Database." OSDI 2012.
3. Ongaro, D., Ousterhout, J. "In Search of an Understandable Consensus Algorithm." USENIX ATC 2014.
4. CockroachDB. "Architecture Decision Records." GitHub Wiki.
5. PingCAP. "TiDB vs CockroachDB Comparison." 2024.
