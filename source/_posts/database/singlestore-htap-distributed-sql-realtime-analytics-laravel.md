---

title: SingleStore 实战：分布式 SQL + 实时分析——Laravel 中的 HTAP 架构与 MySQL 兼容层
keywords: [SingleStore, SQL, Laravel, HTAP, MySQL, 分布式, 实时分析, 中的, 架构与, 兼容层]
date: 2026-06-09 14:22:00
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
- SingleStore
- HTAP
- 分布式
- Laravel
- 实时分析
- MySQL Compatibility
description: 深入解析 SingleStore 的 HTAP 架构原理，实战 Laravel 接入 SingleStore 的完整流程，涵盖列存/行存混合、分布式 JOIN 优化、实时分析查询，以及从 MySQL 迁移的踩坑记录。
---



## 前言

传统架构中，OLTP（事务处理）和 OLAP（分析查询）往往需要两套系统：MySQL 跑业务，ClickHouse 或 StarRocks 跑分析。数据通过 ETL 管道同步，延迟从分钟到小时不等。

SingleStore（前身 MemSQL）走了一条不同的路——**在同一套引擎里同时支持行存和列存**，让事务和分析跑在同一集群上。这就是所谓的 HTAP（Hybrid Transactional/Analytical Processing）。

本文基于 Laravel 8 + SingleStore 7.x 的实际踩坑经验，从架构原理到代码实战完整走一遍。

---

## 一、SingleStore 架构概览

### 1.1 核心设计

SingleStore 的架构分两层：

- **Aggregator 节点**：负责 SQL 解析、查询计划、分布式协调
- **Leaf 节点**：实际存储数据，每个 Leaf 管理若干分片（partition）

```
┌─────────────┐     ┌─────────────┐
│ Aggregator  │     │ Aggregator  │  ← 无状态，可水平扩展
└──────┬──────┘     └──────┬──────┘
       │                   │
  ┌────┴────┐         ┌────┴────┐
  │ Leaf 1  │         │ Leaf 2  │  ← 有状态，数据分片
  │ ┌─────┐ │         │ ┌─────┐ │
  │ │行存 │ │         │ │行存 │ │
  │ │列存 │ │         │ │列存 │ │
  │ └─────┘ │         │ └─────┘ │
  └─────────┘         └─────────┘
```

### 1.2 行存 vs 列存

SingleStore 允许在建表时选择存储引擎：

| 特性 | 行存（ROWSTORE） | 列存（COLUMNSTORE） |
|------|-----------------|-------------------|
| 适用场景 | 点查、高频更新 | 扫描、聚合分析 |
| 索引 | 哈希/跳表索引 | 列级压缩 + 排序键 |
| 延迟 | 微秒级 | 毫秒~秒级 |
| 并发 | 高并发写入 | 批量写入更优 |

**关键点**：两种存储可以在同一个查询中 JOIN，无需 ETL。

### 1.3 MySQL 兼容层

SingleStore 实现了 MySQL 线协议，这意味着：

- `mysql` 命令行可以直接连接
- PHP PDO `mysql` 驱动直接可用
- 大部分 MySQL 语法兼容（视图、存储过程除外）

兼容度大约在 90% 左右，剩下的 10% 是主要踩坑区。

---

## 二、Laravel 接入 SingleStore

### 2.1 配置 database.php

SingleStore 使用 MySQL 协议，所以直接用 `mysql` driver：

```php
// config/database.php
'connections' => [
    'singlestore' => [
        'driver' => 'mysql',
        'host' => env('SINGLESTORE_HOST', '127.0.0.1'),
        'port' => env('SINGLESTORE_PORT', 3306),
        'database' => env('SINGLESTORE_DATABASE', 'app'),
        'username' => env('SINGLESTORE_USER', 'root'),
        'password' => env('SINGLESTORE_PASSWORD', ''),
        'charset' => 'utf8mb4',
        'collation' => 'utf8mb4_unicode_ci',
        'prefix' => '',
        'prefix_indexes' => true,
        'strict' => true,
        'engine' => null, // SingleStore 忽略 engine 设置
        'options' => extension_loaded('pdo_mysql') ? array_filter([
            PDO::MYSQL_ATTR_SSL_CA => env('MYSQL_ATTR_SSL_CA'),
        ]) : [],
    ],
],
```

### 2.2 模型指定连接

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $connection = 'singlestore';
    protected $table = 'orders';
    
    protected $fillable = [
        'user_id', 'product_id', 'amount', 'status', 'created_at',
    ];
}
```

### 2.3 多连接事务

跨 MySQL 和 SingleStore 的事务需要注意分布式事务问题：

```php
use Illuminate\Support\Facades\DB;

// 单一连接内的事务没问题
DB::connection('singlestore')->transaction(function () {
    Order::create(['user_id' => 1, 'amount' => 99.9]);
    Inventory::where('product_id', 1)->decrement('stock');
});

// 跨连接需要 Saga 模式或最终一致性
// 不要指望 XA 事务，SingleStore 对 XA 支持有限
```

---

## 三、建表实战：行存与列存选择

### 3.1 订单表（行存）

订单表是典型的 OLTP 场景：高频写入、点查为主。

```sql
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status ENUM('pending', 'paid', 'shipped', 'completed', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    SHARD KEY (user_id),  -- 按 user_id 分片
    KEY idx_user_id (user_id),
    KEY idx_status_created (status, created_at)
) ROWSTORE;
```

**`SHARD KEY` 是 SingleStore 的核心概念**。选择分片键决定了数据如何分布，直接影响 JOIN 性能。经验法则：选最常用于 JOIN 和 WHERE 的列。

### 3.2 分析表（列存）

日志、埋点、聚合数据用列存：

```sql
CREATE TABLE analytics_events (
    id BIGINT AUTO_INCREMENT,
    event_type VARCHAR(64) NOT NULL,
    user_id BIGINT NOT NULL,
    properties JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    SORT KEY (event_type, created_at),  -- 排序键，影响扫描性能
    SHARD KEY (event_type)  -- 按事件类型分片
) COLUMNSTORE;
```

### 3.3 混合查询示例

```sql
-- 订单表(行存) JOIN 分析表(列存)，SingleStore 自动优化
SELECT 
    o.user_id,
    COUNT(DISTINCT o.id) AS order_count,
    COUNT(DISTINCT ae.event_type) AS event_diversity
FROM orders o
JOIN analytics_events ae ON ae.user_id = o.user_id
WHERE o.created_at >= '2026-01-01'
    AND ae.event_type IN ('page_view', 'add_to_cart')
GROUP BY o.user_id
HAVING order_count > 5
ORDER BY event_diversity DESC
LIMIT 100;
```

这种跨存储引擎的 JOIN，在传统架构中需要把数据先同步到同一个系统，SingleStore 直接执行。

---

## 四、Laravel Migration 适配

SingleStore 不支持外键，也不支持某些 MySQL 特有语法。Migration 需要调整：

### 4.1 创建列存表的 Migration

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

class CreateAnalyticsEventsTable extends Migration
{
    public function up()
    {
        // SingleStore 不支持 Schema::create 的 COLUMNSTORE 语法
        // 直接用 DB::statement
        DB::statement("
            CREATE TABLE IF NOT EXISTS analytics_events (
                id BIGINT AUTO_INCREMENT,
                event_type VARCHAR(64) NOT NULL,
                user_id BIGINT NOT NULL,
                properties JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                SORT KEY (event_type, created_at),
                SHARD KEY (event_type)
            ) COLUMNSTORE
        ");
    }

    public function down()
    {
        Schema::dropIfExists('analytics_events');
    }
}
```

### 4.2 行存表可以用 Blueprint

```php
public function up()
{
    Schema::connection('singlestore')->create('orders', function (Blueprint $table) {
        $table->bigIncrements('id');
        $table->bigInteger('user_id')->index();
        $table->bigInteger('product_id');
        $table->decimal('amount', 10, 2);
        $table->enum('status', ['pending', 'paid', 'shipped', 'completed', 'cancelled'])->default('pending');
        $table->timestamps();
        
        // 注意：Blueprint 没有 shardKey 方法，需要后续处理
    });
    
    // 添加 SHARD KEY（Blueprint 不原生支持）
    DB::statement("ALTER TABLE orders ADD SHARD KEY (user_id)");
}
```

---

## 五、查询优化实战

### 5.1 分布式 EXPLAIN

SingleStore 的 EXPLAIN 输出和 MySQL 不同，需要关注分布式执行计划：

```php
$plan = DB::connection('singlestore')
    ->select("EXPLAIN orders SELECT * FROM orders WHERE user_id = ?", [12345]);

// 输出示例：
// +-------------------+
// | EXPLAIN           |
// +-------------------+
// | Gather partitions |
// |   Filter: user_id = 12345 |
// |   Table scan on orders |
// +-------------------+
```

**关注点**：
- `Gather partitions`：需要扫描多个分片，性能差
- `Gather partitions: Single Partition`：只命中一个分片，理想状态

### 5.2 强制分片路由

当查询包含 SHARD KEY 时，SingleStore 自动路由到对应分片。但复杂查询可能不会自动优化：

```php
// 好的查询：包含 SHARD KEY，自动路由
Order::where('user_id', $userId)->get();

// 需要注意的查询：聚合可能需要 Gather
DB::connection('singlestore')->select("
    SELECT user_id, SUM(amount) as total
    FROM orders
    WHERE user_id IN (?, ?, ?)
    GROUP BY user_id
", [$user1, $user2, $user3]);
```

### 5.3 实时分析查询

```php
// 实时 Dashboard 查询：过去 1 小时的订单统计
$stats = DB::connection('singlestore')->select("
    SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS hour_bucket,
        COUNT(*) AS order_count,
        SUM(amount) AS total_amount,
        AVG(amount) AS avg_amount,
        COUNT(DISTINCT user_id) AS unique_users
    FROM orders
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY hour_bucket
    ORDER BY hour_bucket DESC
");

// 返回的是列存表的扫描结果，延迟在毫秒级
// 同样的查询在 MySQL 上，百万级数据可能需要秒级
```

### 5.4 JSON 字段查询

SingleStore 对 JSON 的支持比 MySQL 更完善：

```php
// 埋点数据查询
$events = DB::connection('singlestore')->select("
    SELECT 
        event_type,
        JSON_EXTRACT_STRING(properties, 'page') AS page,
        COUNT(*) AS cnt
    FROM analytics_events
    WHERE created_at >= ?
        AND JSON_EXTRACT_STRING(properties, 'source') = 'organic'
    GROUP BY event_type, page
    ORDER BY cnt DESC
    LIMIT 20
", [now()->subDay()]);
```

---

## 六、与 MySQL 混合架构

生产环境中，通常不会把所有数据都迁到 SingleStore。更常见的模式是**双写 + 读写分离**：

```
┌──────────────┐     ┌──────────────┐
│   Laravel    │     │   Laravel    │
│   写 MySQL   │     │  读分析查询  │
└──────┬───────┘     └──────┬───────┘
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│    MySQL     │────▶│  SingleStore │
│  (主业务库)  │ CDC │  (分析副本)  │
└──────────────┘     └──────────────┘
```

### 6.1 CDC 同步方案

使用 SingleStore 的 Pipeline 功能从 MySQL binlog 同步：

```sql
-- 在 SingleStore 中创建 Pipeline
CREATE PIPELINE orders_pipeline
AS LOAD DATA KAFKA 'kafka-broker:9092/orders-topic'
INTO TABLE orders
FORMAT AVRO
(
    id <- id,
    user_id <- user_id,
    product_id <- product_id,
    amount <- amount,
    status <- status,
    created_at <- created_at
);
```

如果不想引入 Kafka，可以用 Debezium + SingleStore Pipeline 直接消费 binlog。

### 6.2 Laravel 中的读写分离

```php
// config/database.php
'connections' => [
    'mysql' => [
        'driver' => 'mysql',
        'read' => [
            'host' => env('DB_READ_HOST', '127.0.0.1'),
        ],
        'write' => [
            'host' => env('DB_WRITE_HOST', '127.0.0.1'),
        ],
        // ...
    ],
    'singlestore' => [
        'driver' => 'mysql',
        'host' => env('SINGLESTORE_HOST', '127.0.0.1'),
        // ...
    ],
],

// 在 Model 或 Service 中切换
class AnalyticsService
{
    public function getDashboardStats(): array
    {
        // 分析查询走 SingleStore
        return DB::connection('singlestore')->select("
            SELECT ...
        ");
    }
    
    public function createOrder(array $data): Order
    {
        // 事务写入走 MySQL
        return DB::connection('mysql')->transaction(function () use ($data) {
            return Order::create($data);
        });
    }
}
```

---

## 七、踩坑记录

### 7.1 不支持外键

SingleStore 完全不支持外键约束。如果从 MySQL 迁移，需要：

```php
// 移除外键定义
Schema::table('orders', function (Blueprint $table) {
    // $table->foreign('user_id')->references('id')->on('users'); // 删掉
    $table->index('user_id'); // 保留索引
});

// 应用层保证引用完整性
class OrderService
{
    public function create(array $data): Order
    {
        // 手动检查
        if (!User::where('id', $data['user_id'])->exists()) {
            throw new \InvalidArgumentException('User not found');
        }
        return Order::create($data);
    }
}
```

### 7.2 不支持 AUTO_INCREMENT 的 LAST_INSERT_ID()

在分布式环境下，`LAST_INSERT_ID()` 的行为和 MySQL 不同：

```php
// ❌ 可能有问题
DB::connection('singlestore')->insert($sql, $params);
$id = DB::connection('singlestore')->getPdo()->lastInsertId();

// ✅ 推荐用 RETURNING（SingleStore 7.1+）
$order = DB::connection('singlestore')->selectOne("
    INSERT INTO orders (user_id, amount, status)
    VALUES (?, ?, ?)
    RETURNING id
", [$userId, $amount, 'pending']);
$id = $order->id;
```

### 7.3 语法不兼容项

| MySQL 语法 | SingleStore 状态 | 替代方案 |
|-----------|-----------------|---------|
| `ALTER TABLE ... ADD FOREIGN KEY` | ❌ 不支持 | 应用层保证 |
| `ALTER TABLE ... ADD INDEX` | ✅ 支持 | — |
| `ALTER TABLE ... CHANGE COLUMN` | ⚠️ 部分支持 | 用 `MODIFY COLUMN` |
| 存储过程 | ⚠️ 有限支持 | 避免复杂存储过程 |
| 视图 | ✅ 支持 | — |
| 触发器 | ❌ 不支持 | 应用层处理 |
| `ON DUPLICATE KEY UPDATE` | ✅ 支持 | — |
| `INSERT ... ON DUPLICATE KEY` | ✅ 支持 | — |
| 全文索引 | ❌ 不支持 | 外部搜索引擎 |

### 7.4 分片键选择错误的后果

```sql
-- ❌ 按 id 分片：同一个 user 的订单分散在不同分片
-- 按 user_id 查询时需要 Gather 所有分片
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT,
    SHARD KEY (id)  -- 糟糕的选择
);

-- ✅ 按 user_id 分片：同一个 user 的订单在同一分片
-- 按 user_id 查询时只扫描一个分片
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT,
    SHARD KEY (user_id)  -- 正确的选择
);
```

### 7.5 NULL 值处理差异

SingleStore 的列存表中，NULL 值的处理和 MySQL 有细微差异：

```php
// MySQL 中 COUNT(*) 和 COUNT(column) 行为不同
// SingleStore 列存表中差异更明显

// 确保查询语义正确
$count = DB::connection('singlestore')->selectOne("
    SELECT 
        COUNT(*) AS total_rows,           -- 包含 NULL
        COUNT(user_id) AS non_null_users  -- 排除 NULL
    FROM orders
");
```

---

## 八、性能对比实测

在同一台 MacBook Pro M1 上，用 Docker 运行 SingleStore 和 MySQL 8.0，对比百万级数据的查询性能：

### 8.1 点查（Point Query）

```sql
SELECT * FROM orders WHERE user_id = 12345 AND status = 'paid';
```

| 数据库 | 耗时 |
|--------|------|
| MySQL 8.0 | 0.8ms |
| SingleStore (行存) | 0.3ms |

### 8.2 聚合分析

```sql
SELECT user_id, SUM(amount), COUNT(*) 
FROM orders 
WHERE created_at >= '2026-01-01' 
GROUP BY user_id;
```

| 数据库 | 耗时（100 万行） |
|--------|----------------|
| MySQL 8.0 | 1.2s |
| SingleStore (列存) | 85ms |

### 8.3 跨表 JOIN + 聚合

```sql
SELECT u.name, COUNT(o.id), SUM(o.amount)
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= '2026-01-01'
GROUP BY u.id;
```

| 数据库 | 耗时（用户 10 万，订单 100 万） |
|--------|-------------------------------|
| MySQL 8.0 | 2.8s |
| SingleStore | 120ms |

列存在扫描和聚合场景下优势明显，但点查场景下行存更优。

---

## 九、何时该用 SingleStore？

**适合的场景**：
- 需要实时分析但不想维护两套系统
- 查询模式既有 OLTP 又有 OLAP
- 数据量在 TB 级别，需要水平扩展
- 团队熟悉 MySQL，不想学新语法

**不适合的场景**：
- 纯 OLTP，不需要分析查询（MySQL 更简单）
- 需要外键、触发器等强一致性约束
- 数据量小（<100GB），MySQL + 索引就够了
- 预算有限（SingleStore 商业版价格不低，社区版有节点限制）

---

## 总结

SingleStore 的核心价值在于**消除 ETL 延迟**。当业务需要"事务数据实时可分析"时，它比 MySQL + ClickHouse 的组合更简单。

Laravel 接入的成本很低——PDO mysql 驱动直接用，主要工作量在建表（选分片键、选存储引擎）和去除不兼容语法（外键、触发器）。

如果你的场景是"B2C 电商 + 实时 Dashboard"，SingleStore 值得一试。如果只是跑业务，MySQL 够用。
