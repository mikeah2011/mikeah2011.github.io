---
title: PostgreSQL Logical Replication 实战：零停机数据迁移与实时数据同步——Laravel 多库架构的基石
date: 2026-06-06 12:00:00
tags: [PostgreSQL, Logical-Replication, 数据迁移, Laravel, 零停机, 多库架构, CDC]
keywords: [PostgreSQL Logical Replication, Laravel, 零停机数据迁移与实时数据同步, 多库架构的基石, 数据库]
description: "PostgreSQL Logical Replication 实战指南：详解零停机迁移 480GB 大表的完整流程，以及如何在 Laravel 多库架构中实现秒级数据同步。涵盖 Publication/Subscription 配置、CDC 管道搭建、Replication Slot 运维、常见踩坑与监控告警，附完整 SQL 与 Laravel 代码示例。"
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---


## 前言

我在 KKday 的 B2C 后端团队负责核心交易系统，日均处理数十万笔订单。去年我们遇到了一个棘手的问题：**一张 12 亿行的订单表需要从自建机房迁移到云端 PostgreSQL 16，业务方只给了 5 分钟的切换窗口**。传统的 `pg_dump` + `pg_restore` 方案预估需要 6 小时停机，这显然是不可接受的。

最终我们通过 PostgreSQL Logical Replication 实现了零停机迁移，整个切换过程仅耗时 47 秒，业务几乎无感知。更重要的是，迁移完成后，我们发现 Logical Replication 不仅仅是一个迁移工具——它成为了我们 Laravel 多库架构中数据实时同步的基石。

这篇文章是我在实战中积累的完整经验总结，从原理到踩坑，从单库迁移到多库同步架构，希望能帮到有类似需求的团队。

---

## 一、为什么需要 Logical Replication？

### 1.1 传统迁移方案的痛点

在引入 Logical Replication 之前，我们团队常用的数据库迁移方案主要有三种：

| 方案 | 适用场景 | 停机时间 | 数据量限制 | 风险等级 |
|------|---------|---------|-----------|---------|
| pg_dump / pg_restore | 小规模升级 | 数小时 | <100GB | 低 |
| pg_basebackup + 流复制 | 同版本迁移 | 数分钟 | 无限制 | 中 |
| 自定义双写脚本 | 跨库同步 | 秒级 | 无限制 | 高 |
| **Logical Replication** | **通用方案** | **秒级** | **无限制** | **低** |

去年我们遇到的几个典型痛点，最终推动了我们全面拥抱 Logical Replication：

**痛点一：大表零停机迁移**

我们有一张 `orders` 表，12 亿行，表文件大小 480GB。当时需要从自建机房的 PostgreSQL 12 迁移到 AWS RDS PostgreSQL 16。版本跨度大，无法使用流复制（Physical Replication 要求主从版本一致）。如果用 `pg_dump`，保守估计 6 小时停机。

**痛点二：Laravel 多库数据同步**

我们的 Laravel 应用架构演进过程中，出现了多个独立数据库：主交易库、用户中心库、报表分析库、搜索索引库。过去这些库之间的数据同步依赖定时任务（Cron Job），延迟高达 15 分钟。产品方要求「下单后报表库 5 秒内可见」。

**痛点三：读写分离的局限**

PostgreSQL 内置的流复制虽然支持只读副本，但它是 Physical 级别的——整个实例级别的复制。我们想把特定几张大表同步到专用的分析库，而不是整个实例都复制过去。

### 1.2 Logical Replication 的定位

Logical Replication 是 PostgreSQL 10 引入的特性，它的核心价值在于：

- **表级别粒度**：可以选择性地复制特定表，而非整个数据库集群
- **跨版本兼容**：Publisher 和 Subscriber 可以运行不同的 PostgreSQL 版本
- **实时同步**：基于 WAL 解析，延迟通常在毫秒到秒级
- **双向灵活**：支持一对多、多对一、级联复制等多种拓扑

---

## 二、PostgreSQL 复制技术全景

在深入实战之前，有必要理清 PostgreSQL 的复制技术体系。

### 2.1 Physical vs Logical：一张图说清楚

```
┌─────────────────────────────────────────────────────┐
│              PostgreSQL WAL 复制体系                   │
├───────────────────────┬─────────────────────────────┤
│   Physical Replication│    Logical Replication       │
│   (流复制)             │    (逻辑复制)                 │
├───────────────────────┼─────────────────────────────┤
│ 复制粒度: 数据库集群    │ 复制粒度: 表级别              │
│ 版本要求: 必须相同      │ 版本要求: 可不同              │
│ 复制内容: 二进制块级别   │ 复制内容: 行级变更 (DML+DDL*) │
│ 从库状态: 只读          │ 订阅端: 可读可写              │
│ 典型用途: 高可用/灾备   │ 典型用途: 数据分发/CDC        │
│ 代表方案: pg_basebackup│ 代表方案: Publication/        │
│          + streaming   │          Subscription        │
└───────────────────────┴─────────────────────────────┘
```

> **注意**：Logical Replication 默认不复制 DDL（ALTER TABLE 等），这是很多新手踩的第一个坑。

### 2.2 WAL 与 Logical Decoding

PostgreSQL 的所有变更都记录在 **WAL（Write-Ahead Log）** 中。Physical Replication 直接传输 WAL 的原始字节，而 Logical Replication 则通过 **Logical Decoding** 将 WAL 解析为逻辑变更事件：

```
WAL Record (二进制)
    ↓ Logical Decoding Plugin (pgoutput / wal2json / decoderbufs)
    ↓
Logical Change Record (INSERT/UPDATE/DELETE + 行数据)
    ↓ 通过 walsender 进程发送
    ↓
Subscriber 接收 → 应用变更
```

自 PostgreSQL 10 起，内置的 `pgoutput` 插件成为默认选项，无需额外安装，这也是我们的生产环境选择。

### 2.3 Publication / Subscription 模型

Logical Replication 的核心抽象是 **Publication（发布）** 和 **Subscription（订阅）**：

- **Publication**：定义在 Publisher 端，声明哪些表的哪些操作需要被发布
- **Subscription**：定义在 Subscriber 端，声明从哪个 Publisher 拉取哪些 Publication

```sql
-- Publisher 端：创建发布
CREATE PUBLICATION my_pub FOR TABLE orders, products;

-- Subscriber 端：创建订阅
CREATE SUBSCRIPTION my_sub
    CONNECTION 'host=pub_host dbname=mydb user=replicator password=your_password'
    PUBLICATION my_pub;
```

---

## 三、核心概念深入解析

### 3.1 Publisher 与 Subscriber

**Publisher（发布者）** 是数据变更的源头，它需要：

1. 在 `postgresql.conf` 中设置 `wal_level = logical`
2. 在 `pg_hba.conf` 中允许复制连接
3. 拥有 `REPLICATION` 权限的用户

```ini
# postgresql.conf (Publisher)
wal_level = logical
max_wal_senders = 10          # 每个订阅占用一个 walsender
max_replication_slots = 10    # 每个订阅需要一个 slot
max_worker_processes = 16     # Logical replication worker
```

**Subscriber（订阅者）** 接收并应用变更，它需要：

```ini
# postgresql.conf (Subscriber)
max_logical_replication_workers = 4
max_worker_processes = 16
```

### 3.2 Replication Slot

**Replication Slot** 是 Logical Replication 中最容易出问题的组件。它在 Publisher 端维护一个指针，记录每个订阅者的消费进度（WAL LSN 位置）。

```sql
-- 查看所有 replication slot
SELECT slot_name, plugin, slot_type, active, 
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS lag_bytes
FROM pg_replication_slots;
```

**关键特性：**
- Slot 会阻止 WAL 被清理（`pg_wal` 目录会持续增长）
- 如果 Subscriber 长时间断开，WAL 会堆积到磁盘满
- 这是生产环境中最常见的故障模式

> **踩坑记录**：我们的一个订阅端因为网络抖动断开了 4 小时，Publisher 端的 `pg_wal` 目录从 5GB 暴涨到 120GB，差点撑爆磁盘。后来我们设置了 `max_slot_wal_keep_size` 来限制最大 WAL 保留量。

### 3.3 冲突处理

当 Subscriber 端存在数据冲突（通常是主键或唯一约束冲突），默认行为是 **报错并停止订阅**。这在从旧库向新库迁移时尤其危险：

```sql
-- 配置冲突处理策略 (PostgreSQL 16+)
ALTER SUBSCRIPTION my_sub SET (
    streaming = true,           -- 大事务流式处理
    disable_on_error = false    -- 冲突时不自动禁用
);
```

常见的冲突场景及处理策略：

| 冲突类型 | 原因 | 推荐策略 |
|---------|------|---------|
| 唯一键冲突 | 双写期间两边都插入了相同数据 | 使用 `origin` 过滤 |
| 违反外键约束 | 表复制顺序不当 | 确保依赖表一起发布 |
| 数据类型不匹配 | 列结构不一致 | 先做 DDL 同步 |

---

## 四、实战一：零停机数据库迁移

### 4.1 迁移场景说明

我们的真实场景：

| 项目 | 详情 |
|------|------|
| 源库 | 自建机房 PostgreSQL 12.18 |
| 目标库 | AWS RDS PostgreSQL 16.4 |
| 数据量 | 480GB（最大单表 12 亿行） |
| 停机要求 | < 1 分钟 |
| 网络 | 专线，带宽 500Mbps |

### 4.2 迁移架构设计

```
┌──────────────┐   Logical Replication    ┌──────────────┐
│  Old PG 12   │ ──────────────────────→  │  New PG 16   │
│  (Publisher)  │     实时同步              │ (Subscriber) │
└──────┬───────┘                          └──────┬───────┘
       │                                         │
       │         ┌──────────────┐                │
       └────────→│  Laravel App │←───────────────┘
        写入旧库  │  (双读验证)  │  切换后写入新库
                  └──────────────┘
```

### 4.3 Step-by-Step 操作

**Step 1：源库配置**

```sql
-- 1. 修改 wal_level（需要重启，找维护窗口）
-- postgresql.conf: wal_level = logical

-- 2. 创建复制用户
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'strong_password';

-- 3. 授权
GRANT SELECT ON ALL TABLES IN SCHEMA public TO replicator;

-- 4. 创建 Publication（发布所有需要迁移的表）
CREATE PUBLICATION migration_pub FOR TABLE
    orders, order_items, products, users, payments,
    merchants, coupons, promotions;
    
-- 如果要发布所有表：
-- CREATE PUBLICATION migration_pub FOR ALL TABLES;
```

**Step 2：目标库初始化**

```sql
-- 1. 在目标库创建相同的 schema（不含数据）
-- 这一步可以通过 pg_dump --schema-only 从源库导出

-- 2. 在目标库创建订阅
CREATE SUBSCRIPTION migration_sub
    CONNECTION 'host=old-pg-host dbname=kkday_prod user=replicator password=strong_password'
    PUBLICATION migration_pub
    WITH (
        copy_data = true,        -- 是否复制现有数据
        streaming = true,         -- 大事务流式传输（PG14+）
        disable_on_error = false  -- 冲突不自动禁用
    );
```

**Step 3：等待初始数据同步完成**

```sql
-- 在 Publisher 端查看同步进度
SELECT slot_name, active, 
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS replication_lag
FROM pg_replication_slots;

-- 在 Subscriber 端查看订阅状态
SELECT subname, subenabled, 
       (SELECT count(*) FROM pg_subscription_rel WHERE srsubid = s.oid AND srsubstate != 'r') AS tables_not_ready
FROM pg_subscription s;
```

`srsubstate` 的含义：
- `i` (init)：初始化中
- `d` (data)：正在复制数据
- `s` (sync)：数据同步完成，准备同步
- `r` (ready)：正常复制中

**Step 4：验证数据一致性**

我们在切换前做了多轮验证：

```sql
-- 在源库和目标库分别执行，对比行数
SELECT schemaname, relname, n_live_tup 
FROM pg_stat_user_tables 
ORDER BY n_live_tup DESC;

-- 对比特定表的 checksum（示例）
-- 源库
SELECT md5(string_agg(t::text, '' ORDER BY id)) 
FROM (SELECT * FROM orders WHERE id <= 1000000) t;

-- 目标库（同样查询）
```

**Step 5：切换（47 秒完成）**

这是关键步骤，我们编写了一个自动化切换脚本：

```bash
#!/bin/bash
set -e

OLD_DB="host=old-pg-host dbname=kkday_prod"
NEW_DB="host=new-pg-host dbname=kkday_prod"

echo "[$(date)] Step 1: 暂停源库写入（将 Laravel 队列置为维护模式）"
php artisan down --render=maintenance
sleep 2

echo "[$(date)] Step 2: 等待复制追平"
# 等待 lag 降到 0
while true; do
    LAG=$(psql "$OLD_DB" -t -c "
        SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)
        FROM pg_replication_slots WHERE slot_name = 'migration_sub';
    " | tr -d ' ')
    echo "  Current lag: $LAG bytes"
    if [ "$LAG" -eq 0 ] || [ "$LAG" -lt 1000 ]; then
        break
    fi
    sleep 0.5
done

echo "[$(date)] Step 3: 修改 Laravel 数据库连接指向新库"
# 修改 .env 或通过配置中心
# DB_HOST=new-pg-host

echo "[$(date)] Step 4: 启用新库写入"
php artisan up

echo "[$(date)] Step 5: 移除旧库的 replication slot（防止 WAL 堆积）"
psql "$OLD_DB" -c "SELECT pg_drop_replication_slot('migration_sub');"

echo "[$(date)] 切换完成！"
```

### 4.4 迁移结果

| 指标 | 目标 | 实际 |
|------|------|------|
| 切换停机时间 | < 60 秒 | 47 秒 |
| 数据丢失 | 0 | 0 |
| 初始同步耗时 | < 24 小时 | 11 小时 |
| 复制延迟 | < 1 秒 | < 500ms |

---

## 五、实战二：Laravel 多库架构中的实时数据同步

### 5.1 问题背景

迁移完成后，我们发现 Logical Replication 的价值远超「迁移工具」。我们的 Laravel 应用面临多库数据同步需求：

```
┌─────────────────┐
│   主交易库       │  ← Laravel 写入 (orders, payments)
│   (OLTP)        │
└────────┬────────┘
         │  Logical Replication
    ┌────┴────┬────────────┐
    ↓         ↓            ↓
┌────────┐ ┌─────────┐ ┌──────────┐
│ 报表库  │ │ 搜索库   │ │ 用户中心  │
│ (OLAP) │ │(ES同步)  │ │ (跨服务) │
└────────┘ └─────────┘ └──────────┘
```

过去我们用 Laravel Queue + Cron Job 做数据同步，延迟 15-30 分钟，且经常丢数据。改用 Logical Replication 后，延迟降到秒级，且数据零丢失。

### 5.2 方案一：读写分离增强

Laravel 原生支持读写分离，但配置方式是同一实例的主从。通过 Logical Replication，我们可以实现更灵活的跨实例读写分离：

```php
// config/database.php
'connections' => [
    'mysql' => [
        'driver' => 'pgsql',
        'read' => [
            'host' => [
                'read-replica-1.internal',   // 从 Logical Replication 订阅
                'read-replica-2.internal',
            ],
        ],
        'write' => [
            'host' => 'primary-db.internal',
        ],
        'database' => 'kkday_prod',
        // ...
    ],
],
```

### 5.3 方案二：报表库实时同步

这是我们的核心需求。报表库需要完整的订单数据，但 schema 可能不同（比如增加了汇总列、宽表等）。

**发布端（主交易库）：**

```sql
-- 发布 orders 和 order_items 到报表库
CREATE PUBLICATION report_pub FOR TABLE orders, order_items;
```

**订阅端（报表库）：**

```sql
-- 订阅
CREATE SUBSCRIPTION report_sub
    CONNECTION 'host=primary-db.internal dbname=kkday_prod user=replicator'
    PUBLICATION report_pub;
```

**报表库上创建物化视图做实时汇总：**

```sql
-- 在报表库上
CREATE MATERIALIZED VIEW daily_sales_summary AS
SELECT 
    DATE(created_at) AS sale_date,
    merchant_id,
    COUNT(*) AS order_count,
    SUM(total_amount) AS total_revenue,
    AVG(total_amount) AS avg_order_value
FROM orders
GROUP BY DATE(created_at), merchant_id;

-- 定时刷新（每分钟）
-- 可以用 pg_cron 扩展或外部调度
SELECT cron.schedule('refresh-daily-sales', '* * * * *', 
    'REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales_summary');
```

### 5.4 方案三：CDC（Change Data Capture）管道

我们还用 Logical Replication 搭建了 CDC 管道，将变更实时推送到消息队列：

```
PostgreSQL (Publisher)
    ↓ Logical Replication
    ↓
Debezium / pg-listen (CDC Connector)
    ↓
Kafka / RabbitMQ
    ↓
Elasticsearch / Data Warehouse / Audit Log
```

这里 `wal2json` 插件非常有用，它能将变更输出为 JSON 格式：

```sql
-- 安装 wal2json 后
SELECT * FROM pg_create_logical_replication_slot('cdc_slot', 'wal2json');

-- 消费变更
SELECT data FROM pg_logical_slot_get_changes('cdc_slot', NULL, NULL);
```

---

## 六、Laravel 集成详解

### 6.1 多数据库连接配置

在 Laravel 中管理多数据库连接，核心是 `config/database.php` 的合理设计：

```php
// config/database.php
'connections' => [
    // 主交易库（写入端，也是 Logical Replication 的 Publisher）
    'primary' => [
        'driver' => 'pgsql',
        'host' => env('DB_PRIMARY_HOST', '127.0.0.1'),
        'port' => env('DB_PRIMARY_PORT', '5432'),
        'database' => env('DB_PRIMARY_DATABASE', 'kkday_prod'),
        'username' => env('DB_PRIMARY_USERNAME', 'forge'),
        'password' => env('DB_PRIMARY_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'search_path' => 'public',
        'sslmode' => 'prefer',
    ],
    
    // 报表库（通过 Logical Replication 同步）
    'report' => [
        'driver' => 'pgsql',
        'host' => env('DB_REPORT_HOST', '127.0.0.1'),
        'port' => env('DB_REPORT_PORT', '5432'),
        'database' => env('DB_REPORT_DATABASE', 'kkday_report'),
        'username' => env('DB_REPORT_USERNAME', 'forge'),
        'password' => env('DB_REPORT_PASSWORD', ''),
        'charset' => 'utf8',
        'prefix' => '',
        'search_path' => 'public',
    ],
    
    // 只读副本（Logical Replication Subscriber）
    'readonly' => [
        'driver' => 'pgsql',
        'host' => env('DB_READONLY_HOST', '127.0.0.1'),
        'database' => env('DB_READONLY_DATABASE', 'kkday_prod'),
        'username' => env('DB_READONLY_USERNAME', 'forge'),
        'password' => env('DB_READONLY_PASSWORD', ''),
        // 只读连接，禁止写入
        'options' => [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ],
    ],
],
```

### 6.2 Model 多库路由

为不同的 Model 指定不同的数据库连接：

```php
// app/Models/Order.php
class Order extends Model
{
    protected $connection = 'primary'; // 写入主库
    protected $table = 'orders';
    
    // 读取时走从库
    public function newQuery($excludeDeleted = true)
    {
        if (!app()->runningInConsole() && request()->isMethod('GET')) {
            $this->setConnection('readonly');
        }
        return parent::newQuery($excludeDeleted);
    }
}

// app/Models/Report/DailySales.php
class DailySales extends Model
{
    protected $connection = 'report'; // 读取报表库
    protected $table = 'daily_sales_summary';
    
    public $timestamps = false; // 报表库通常不需要时间戳
}
```

### 6.3 Service 层封装：优雅的多库访问

```php
// app/Services/OrderService.php
class OrderService
{
    public function getOrdersForMerchant(int $merchantId): Collection
    {
        // 交易数据从主库读
        return Order::on('primary')
            ->where('merchant_id', $merchantId)
            ->where('status', 'completed')
            ->latest()
            ->paginate(20);
    }
    
    public function getSalesReport(int $merchantId, string $date): array
    {
        // 报表数据从报表库读（通过 Logical Replication 实时同步）
        return DailySales::on('report')
            ->where('merchant_id', $merchantId)
            ->where('sale_date', $date)
            ->first()
            ?->toArray() ?? [];
    }
    
    public function createOrder(array $data): Order
    {
        // 所有写入走主库
        return DB::connection('primary')->transaction(function () use ($data) {
            $order = Order::create($data);
            
            // 触发其他业务逻辑...
            
            return $order;
        });
    }
}
```

### 6.4 数据一致性保障

Logical Replication 是异步的，存在短暂的数据不一致窗口。在 Laravel 中需要特别处理：

```php
// app/Services/ConsistencyGuard.php
class ConsistencyGuard
{
    /**
     * 当需要强一致性读取时（刚写入后立刻读取），
     * 强制从主库读取，避免读到未同步的数据
     */
    public static function readAfterWrite(callable $writeCallback, callable $readCallback)
    {
        // 写入主库
        $result = DB::connection('primary')->transaction(function () use ($writeCallback) {
            return $writeCallback();
        });
        
        // 刚写入后立刻读取，必须从主库读（避免复制延迟）
        $data = DB::connection('primary')->transaction(function () use ($readCallback, $result) {
            return $readCallback($result);
        });
        
        return $data;
    }
}

// 使用示例
$order = ConsistencyGuard::readAfterWrite(
    fn() => Order::create($data),
    fn($order) => Order::with('items')->find($order->id)
);
```

---

## 七、监控与运维

### 7.1 Replication Lag 监控

复制延迟是最需要关注的指标。我们使用 Prometheus + Grafana 进行监控：

```sql
-- Publisher 端：查看各 slot 的延迟（字节数）
SELECT 
    slot_name,
    active,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS lag_bytes,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS confirmed_lag
FROM pg_replication_slots
ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC;

-- Subscriber 端：查看订阅状态
SELECT 
    subname,
    subenabled,
    (SELECT count(*) FROM pg_subscription_rel 
     WHERE srsubid = s.oid AND srsubstate = 'r') AS ready_tables,
    (SELECT count(*) FROM pg_subscription_rel 
     WHERE srsubid = s.oid AND srsubstate != 'r') AS pending_tables
FROM pg_subscription s;
```

**监控告警阈值（我们的实践）：**

| 指标 | 正常 | 警告 | 严重 |
|------|------|------|------|
| 复制延迟（字节） | < 1MB | 1MB - 100MB | > 100MB |
| 复制延迟（时间） | < 1 秒 | 1-10 秒 | > 10 秒 |
| Slot 是否 active | true | - | false |
| PG-WAL 目录大小 | < 10GB | 10-50GB | > 50GB |

### 7.2 Slot 管理最佳实践

```sql
-- 1. 查看所有 slot 状态
SELECT * FROM pg_replication_slots;

-- 2. 清理不再使用的 slot（重要！）
SELECT pg_drop_replication_slot('unused_slot_name');

-- 3. 设置 WAL 保留上限（PG13+，防磁盘爆满）
-- postgresql.conf
-- max_slot_wal_keep_size = 50GB

-- 4. 创建 slot 时不立即消费（用于准备阶段）
SELECT pg_create_logical_replication_slot('my_slot', 'pgoutput', false);
```

### 7.3 常见故障处理

**故障一：Subscriber 报错停止**

```sql
-- 查看错误原因
SELECT * FROM pg_stat_subscription;

-- 解决方案：跳过错误的 LSN（谨慎操作！）
-- 在 Subscriber 端
ALTER SUBSCRIPTION my_sub DISABLE;
-- 订阅会停止，手动处理冲突数据后
ALTER SUBSCRIPTION my_sub ENABLE;
```

**故障二：WAL 堆积导致磁盘满**

```bash
# 1. 查看 pg_wal 目录大小
du -sh /var/lib/postgresql/data/pg_wal/

# 2. 检查是否有不活跃的 slot
psql -c "SELECT slot_name, active FROM pg_replication_slots WHERE NOT active;"

# 3. 清理不活跃的 slot（如果是不再需要的）
psql -c "SELECT pg_drop_replication_slot('dead_slot');"

# 4. 设置 max_slot_wal_keep_size 防止再次发生
# postgresql.conf: max_slot_wal_keep_size = '50GB'
```

**故障三：表结构不一致导致应用失败**

```sql
-- 检查两边表结构是否一致
-- Publisher 端
\d+ orders

-- Subscriber 端
\d+ orders

-- 如果不一致，需要在 Subscriber 端先修改 schema
-- 然后刷新订阅
ALTER SUBSCRIPTION my_sub REFRESH PUBLICATION;
```

---

## 八、踩坑与最佳实践

### 8.1 我们踩过的坑

**坑一：DDL 不同步**

Logical Replication 默认只复制 DML（INSERT/UPDATE/DELETE），不复制 DDL。我们有一次在源库加了一个 `ALTER TABLE orders ADD COLUMN channel VARCHAR(50)`，结果目标库没有这个列，订阅直接报错停了。

**解决方案：**

```bash
# 方案 A：在两端同时执行 DDL（推荐）
# 使用迁移脚本，先在 Subscriber 执行，再在 Publisher 执行

# 方案 B：使用 pglogical 扩展（支持 DDL 同步，但配置复杂）
# 方案 C：封装一个 DDL 同步的中间件脚本
```

我们最终选择了方案 A，并编写了一个迁移辅助脚本：

```php
// app/Console/Commands/MigrateOnBothDatabases.php
class MigrateOnBothDatabases extends Command
{
    public function handle()
    {
        // 在 Subscriber 端先执行 DDL（因为 Publisher 不会等 Subscriber）
        DB::connection('report')->statement($this->getDDL());
        
        // 短暂延迟确保 Subscriber 端 schema 更新
        sleep(1);
        
        // 在 Publisher 端执行 DDL
        DB::connection('primary')->statement($this->getDDL());
    }
}
```

**坑二：主键冲突**

在双写切换期间，我们发现如果新旧两库同时写入了相同主键的数据，订阅会报唯一键冲突。

**解决方案：**

```sql
-- 在 Subscriber 端设置冲突处理
-- PG15+ 支持
ALTER SUBSCRIPTION my_sub SET (
    origin = none  -- 忽略来自本节点的变更
);
```

**坑三：大事务导致复制延迟飙升**

我们的一个 `UPDATE` 操作一次性更新了 500 万行，导致 Subscriber 端复制延迟暴涨到 30 秒。

**解决方案：**

```sql
-- 1. 大批量操作分批执行
UPDATE orders SET status = 'archived' 
WHERE created_at < '2024-01-01' AND id IN (
    SELECT id FROM orders WHERE created_at < '2024-01-01' LIMIT 10000
);
-- 在 Laravel 中用 chunk 或 cursor

// 2. 在 PG14+ 启用流式传输
ALTER SUBSCRIPTION my_sub SET (streaming = true);
```

**坑四：序列（Sequence）不同步**

Logical Replication **不会** 同步序列值。迁移完成后，新库的 ID 序列可能还是从 1 开始，导致主键冲突。

**解决方案：**

```sql
-- 在 Subscriber 端，迁移完成后手动同步序列
SELECT setval('orders_id_seq', (SELECT MAX(id) FROM orders));
SELECT setval('payments_id_seq', (SELECT MAX(id) FROM payments));
-- 对所有有自增主键的表都要执行
```

### 8.2 最佳实践总结

1. **表必须有主键**：Logical Replication 依赖主键来追踪行变更。没有主键的表只能使用 `INSERT` 操作的复制，`UPDATE` 和 `DELETE` 无法正确复制。

2. **监控先行**：在开启 Logical Replication 前，先部署好监控（Grafana + Prometheus），重点关注 lag 和 slot 状态。

3. **设置 `max_slot_wal_keep_size`**：防止订阅端故障导致 Publisher 磁盘爆满。

4. **DDL 变更流程化**：建立标准的 DDL 变更流程，确保 Publisher 和 Subscriber 同步变更。

5. **大批量操作分批执行**：避免单个大事务导致复制延迟。

6. **迁移后同步序列**：这是一个很容易遗忘的步骤。

7. **测试环境先跑通**：在生产环境操作前，务必在测试环境完整验证整个流程。

---

## 九、Logical Replication 与其他方案对比

### 9.1 PostgreSQL 原生迁移方案全面对比

在选择迁移方案时，很多团队会在 PostgreSQL 提供的多种原生工具间犹豫不决。以下表格从 10 个关键维度进行详细对比：

| 维度 | pg_dump / pg_restore | pg_basebackup (流复制) | Logical Decoding (wal2json) | **Logical Replication** |
|------|---------------------|----------------------|---------------------------|------------------------|
| **复制粒度** | 数据库/Schema/表 | 整个实例（集群级） | WAL 级变更事件流 | **表级别** |
| **版本兼容** | 任意版本 | 必须相同大版本 | 任意版本 | **任意版本** |
| **停机时间** | 数小时（大库） | 分钟级（需重启） | 无（仅消费变更） | **秒级** |
| **实时同步** | ❌ 一次性导出 | ✅ 实时流式 | ✅ 实时事件 | ✅ **实时同步** |
| **DDL 同步** | ✅ 包含在 dump 中 | ✅ 二进制复制 | ❌ 需自行处理 | ❌ **需手动处理** |
| **目标端可写** | ✅ | ❌ 只读（hot_standby） | ✅（数据需自行应用） | ✅ **可读可写** |
| **大表性能** | 差（全量导出导入） | 优（块级别复制） | 好（增量变更） | **优（增量+初始拷贝）** |
| **运维复杂度** | 低 | 中 | 高（需开发消费端） | **低（SQL 即配置）** |
| **网络消耗** | 极高（全量传输） | 高（全量+增量） | 低（仅增量） | **低（仅增量）** |
| **适用场景** | 小库升级/备份恢复 | 同版本 HA/灾备 | 自定义 CDC 开发 | **跨版本迁移/实时同步** |

**选型建议：**
- **< 50GB + 接受停机** → `pg_dump` 最简单
- **同版本 + 需要只读副本** → `pg_basebackup` + 流复制
- **需要自定义 CDC 管道 + 完全控制输出格式** → Logical Decoding + `wal2json`
- **跨版本迁移 / 表级粒度同步 / 零停机要求** → **Logical Replication（首选）**

### 9.2 与第三方同步方案对比

| 维度 | Logical Replication | Debezium CDC | 双写中间件 | 定时同步 (Cron) |
|------|-------------------|--------------|-----------|----------------|
| 延迟 | 毫秒~秒级 | 秒级 | 毫秒级 | 分钟~小时级 |
| 数据一致性 | 高 | 高 | 中（双写失败风险）| 低 |
| 运维复杂度 | 低（PG 原生） | 中（需 Kafka） | 高 | 低 |
| DDL 同步 | 不支持 | 部分支持 | 取决于实现 | 手动 |
| 资源消耗 | 低 | 中 | 高 | 取决于数据量 |
| 适用场景 | 数据库级同步 | 跨系统 CDC | 应用层强一致 | 非实时场景 |
| Laravel 集成 | 透明（无需改代码）| 需要 Connector | 需要改写入逻辑 | Laravel 原生 |

---

## 十、总结

回顾整个实践过程，PostgreSQL Logical Replication 在我们的 Laravel 多库架构中扮演了三个关键角色：

1. **零停机迁移工具**：从 PG12 到 PG16，480GB 数据，47 秒完成切换，零数据丢失。

2. **实时数据同步基石**：主交易库到报表库的秒级同步，解决了过去 Cron Job 15 分钟延迟的痛点。

3. **多库架构的粘合剂**：让不同的数据库（OLTP、OLAP、搜索、审计）通过逻辑复制紧密协作，而不需要在应用层编写复杂的同步代码。

当然，Logical Replication 并非万能。它不支持 DDL 同步，不支持序列同步，对没有主键的表也不友好。但对于大多数 Laravel 项目的多库同步需求来说，它已经是一个足够优秀、运维成本极低的方案。

如果你的团队正在面临类似的数据库迁移或多库数据同步问题，我强烈建议从 Logical Replication 开始尝试。它不需要引入额外的中间件，不需要改变现有的应用代码，只需要简单的 SQL 配置就能获得秒级的数据同步能力。

最后分享一句话：**好的架构不是一开始就设计出来的，而是从实际痛点中长出来的。** 我们的多库同步方案从最初的 Cron Job 到现在的 Logical Replication，经历了三次重构，每一次都是被真实的业务需求推动的。希望这篇文章能让你少走一些弯路。

---

## 相关阅读

- [PostgreSQL 高级特性实战：Window Functions、CTE、JSONB](/categories/MySQL/数据库/PostgreSQL-高级特性实战-Window-Functions-CTE-JSONB-pg-trgm-Laravel复杂查询重写与性能调优/) — 深入 PostgreSQL 高级查询特性，与本文的 Logical Replication 互补，构建完整的 PostgreSQL 实战知识体系
- [Neon Serverless PostgreSQL 实战](/categories/MySQL/数据库/Neon-Serverless-PostgreSQL-实战-分支工作流与Laravel-开发体验/) — Serverless PostgreSQL 的分支工作流与 Laravel 开发体验，探索云端 PostgreSQL 的另一种使用方式
- [数据库读写分离实战：Laravel Middleware 与 MySQL Replication](/categories/MySQL/数据库/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication/) — Laravel 层面的读写分离实现，与本文 Logical Replication 读写分离方案形成对比参考

---

> 参考资料：
> - [PostgreSQL 官方文档 - Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)
> - [PostgreSQL Logical Decoding](https://www.postgresql.org/docs/current/logicaldecoding.html)
> - [Laravel Database Configuration](https://laravel.com/docs/database#configuration)
> - [pglogical Extension](https://github.com/2ndQuadrant/pglogical)
