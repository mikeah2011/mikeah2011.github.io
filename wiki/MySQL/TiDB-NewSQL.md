# TiDB NewSQL 分布式 SQL

## 定义

TiDB 是 PingCAP 公司开源的分布式 SQL 数据库，属于 NewSQL 范畴。它兼容 MySQL 协议和语法，支持水平扩展和强一致性，同时具备 HTAP（混合事务/分析处理）能力。Laravel 项目无需分库分表即可实现水平扩展。

## 核心原理

### 计算存储分离架构

```
TiDB Server (SQL 层，无状态，水平扩展)
    │
    ▼
Placement Driver (PD) — 元数据管理、调度器、TSO 时间戳
    │
    ▼
TiKV (分布式 KV 存储，基于 Raft 复制)
    +
TiFlash (列存引擎，HTAP 加速)
```

| 组件 | 职责 |
|------|------|
| TiDB Server | SQL 解析和执行，无状态，可水平扩展 |
| Placement Driver (PD) | 元数据管理、Region 调度、TSO 时间戳分配 |
| TiKV | 分布式 KV 存储，基于 Raft 共识协议复制数据 |
| TiFlash | 列存引擎，实时同步 TiKV 数据，加速 OLAP 查询 |

### 核心特性

1. **MySQL 兼容**：支持 MySQL 协议和 SQL 语法，Laravel 可直接连接
2. **水平扩展**：存储（TiKV Region 自动分裂/合并）和计算（无状态 TiDB Server）均可水平扩展
3. **强一致性**：基于 Raft 协议保证数据强一致，支持分布式事务
4. **HTAP**：TiFlash 列存引擎加速分析查询，OLTP + OLAP 一体化
5. **高可用**：无单点故障，自动故障转移，RTO < 30s

### 与分库分表对比

| 维度 | MySQL 分库分表 | TiDB |
|------|--------------|------|
| 应用改造 | 需要路由逻辑、全局 ID | MySQL 兼容，几乎零改造 |
| 跨片查询 | 需要中间件或聚合层 | 原生支持 |
| 分布式事务 | 需要 Seata/TCC 等框架 | 原生支持（Percolator） |
| 扩容 | 需要数据迁移 | 自动 Rebalance |
| 运维复杂度 | 高（ShardingSphere 等） | 中（原生集群管理） |

## Laravel 集成

### 驱动配置

```php
// config/database.php
'tidb' => [
    'driver' => 'mysql',
    'host' => env('TIDB_HOST', '127.0.0.1'),
    'port' => env('TIDB_PORT', 4000),
    'database' => env('TIDB_DATABASE', 'laravel'),
    'username' => env('TIDB_USERNAME', 'root'),
    'password' => env('TIDB_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'options' => [
        PDO::ATTR_PERSISTENT => true,
    ],
],
```

### AUTO_RANDOM 主键

TiDB 推荐使用 `AUTO_RANDOM` 替代 `AUTO_INCREMENT`，避免热点写入：

```sql
CREATE TABLE orders (
    id BIGINT AUTO_RANDOM PRIMARY KEY,
    user_id BIGINT NOT NULL,
    amount DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 悲观事务模式

TiDB 默认使用乐观事务，Laravel 推荐切换为悲观事务模式：

```sql
SET GLOBAL tidb_txn_mode = 'pessimistic';
```

### TiFlash 加速分析查询

```sql
-- 为表添加 TiFlash 副本
ALTER TABLE orders SET TIFLASH REPLICA 1;

-- 查询自动使用 TiFlash 加速（TiDB 优化器自动选择）
SELECT DATE(created_at), SUM(amount) FROM orders GROUP BY DATE(created_at);
```

## 性能基准

| 场景 | MySQL 单机 | TiDB 3 节点 |
|------|-----------|------------|
| OLTP 写入 (TPS) | 5,000 | 15,000 |
| OLTP 读取 (QPS) | 30,000 | 80,000 |
| OLAP 聚合 (亿级) | 超时 | 3-5s |

## 实战案例

来自博客文章：
- [TiDB 实战：分布式 SQL 数据库在 Laravel 中的集成——MySQL 兼容的 NewSQL 选型指南](/categories/MySQL/tidb-laravel-integration-newsql-guide/)

## 相关概念

- [分库分表](分库分表.md) - MySQL 水平扩展的替代方案
- [CockroachDB 与分布式 SQL](CockroachDB与分布式SQL.md) - 另一种 NewSQL 选型
- [MySQL HeatWave](MySQL-HeatWave.md) - MySQL 原生 HTAP
- [ClickHouse + Laravel 集成](ClickHouse-Laravel-集成.md) - 专用 OLAP 引擎
- [主从复制与读写分离](主从复制与读写分离.md) - 传统 MySQL 扩展路径

## 常见问题

**Q: TiDB 适合什么规模的项目？**
A: TiDB 适合数据量在 500GB 以上、写入 TPS > 5000、或有分布式事务需求的项目。小规模项目用 MySQL 单机 + 主从复制更简单。

**Q: TiDB 与 CockroachDB 如何选型？**
A: TiDB 兼容 MySQL，CockroachDB 兼容 PostgreSQL。已有 Laravel/MySQL 技术栈选 TiDB，已有 PostgreSQL 技术栈选 CockroachDB。

**Q: AUTO_RANDOM 的 ID 如何在 Laravel 中使用？**
A: AUTO_RANDOM 生成的 ID 是随机的 BIGINT，Laravel 的 `$model->id` 可以正常获取。但 ID 不再有序，不能用 ID 排序判断插入时间。
