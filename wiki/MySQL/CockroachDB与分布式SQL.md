# CockroachDB 与分布式 SQL

## 定义

CockroachDB 是一个**分布式 SQL 数据库**，兼容 PostgreSQL 协议，支持全球分布式事务与强一致性。它将数据自动分片并复制到多个节点，无需手动分库分表，同时保证 ACID 事务。

## 与 MySQL 主从复制的区别

| 特性 | MySQL 主从复制 | CockroachDB |
|------|---------------|-------------|
| **架构** | Single-Primary（单主写入） | Multi-Active（多主写入） |
| **写入** | 所有写操作走主库 | 任意节点可写入 |
| **一致性** | 最终一致性（异步复制） | 强一致性（Raft 共识） |
| **分片** | 手动分库分表 | 自动分片 |
| **故障转移** | 需手动或工具切换 | 自动故障转移 |
| **扩展** | 垂直扩展为主 | 水平扩展 |
| **SQL 兼容** | MySQL 协议 | PostgreSQL 协议 |

```
MySQL 主从复制：
  App ──→ Master (写) ──binlog──→ Slave 1 (读)
                                ──→ Slave 2 (读)

CockroachDB：
  App ──→ Node 1 (读/写) ←──Raft──→ Node 2 (读/写)
                ↑                        ↑
                └──────Raft──────────────┘
                       Node 3 (读/写)
```

## 核心特性

### 自动分片

数据按 Key Range 自动分裂为多个 Range（默认 64MB），均匀分布到各节点：

- 无需预设分片规则
- 负载均衡自动完成
- 热点 Range 自动分裂

### Raft 共识协议

每个 Range 使用 Raft 协议在多个副本间达成强一致性：

```
写入请求 → Leader → 多数派确认 → 提交 → 响应客户端
                  (3/5 副本确认)
```

- 保证数据不丢失（WAL + 多副本）
- 自动选举新 Leader（故障转移）
- 支持跨区域部署（Geo-Partitioned Replication）

### Serializable 隔离级别

CockroachDB 默认使用 **Serializable** 隔离级别（MySQL 默认为 Repeatable Read），提供最强的事务一致性保证，避免：

- 写偏斜（Write Skew）
- 幻读（Phantom Read）
- 序列化异常

### 全球数据放置

```sql
-- 将欧洲用户数据放在欧洲节点
ALTER TABLE users PARTITION BY LIST (region) (
    PARTITION eu VALUES IN ('EU') LOCALITY REGIONAL BY ROW,
    PARTITION us VALUES IN ('US') LOCALITY REGIONAL BY ROW,
    PARTITION asia VALUES IN ('ASIA') LOCALITY REGIONAL BY ROW
);
```

## Laravel 集成

CockroachDB 兼容 PostgreSQL 协议，Laravel 通过 `pgsql` 驱动连接：

### 配置

```php
// config/database.php
'cockroachdb' => [
    'driver' => 'pgsql',
    'host' => env('COCKROACH_HOST', 'localhost'),
    'port' => env('COCKROACH_PORT', '26257'),
    'database' => env('COCKROACH_DATABASE', 'defaultdb'),
    'username' => env('COCKROACH_USERNAME', 'root'),
    'password' => env('COCKROACH_PASSWORD', ''),
    'sslmode' => 'require',
    'options' => [
        PDO::ATTR_EMULATE_PREPARES => true,
    ],
],
```

### Eloquent 兼容性

| 功能 | 兼容性 | 备注 |
|------|--------|------|
| 基本 CRUD | ✅ 完全兼容 | |
| Eloquent 关联 | ✅ 完全兼容 | |
| Migration | ✅ 基本兼容 | 部分 MySQL 特有类型需调整 |
| JSON 查询 | ✅ 兼容 | 使用 PostgreSQL JSON 操作符 |
| 全文搜索 | ⚠️ 部分 | 使用 PostgreSQL tsvector |
| 事务 | ✅ 完全兼容 | Serializable 级别 |
| 存储过程 | ❌ 不支持 | CockroachDB 不支持 |

### 注意事项

```php
// CockroachDB 需要显式事务重试
DB::transaction(function () {
    // CockroachDB 可能因 Serializable 冲突抛出错误
    // 需要在应用层实现重试逻辑
}, 5); // Laravel 默认重试 5 次
```

## 适用场景

### ✅ 推荐使用

- **全球化 SaaS**：用户分布在多个区域，需要就近读写
- **金融级强一致性**：转账、支付等不能容忍数据不一致
- **多区域部署**：合规要求数据不出境
- **高可用要求**：不能容忍单点故障

### ❌ 不推荐使用

- **简单 OLTP**：单机 MySQL 足够的场景，CockroachDB 延迟更高
- **成本敏感**：最少 3 节点起步，硬件成本高
- **延迟敏感**：跨节点 Raft 共识增加 2-5ms 延迟
- **需要存储过程**：CockroachDB 不支持

## 局限

| 局限 | 说明 |
|------|------|
| **延迟** | 单次查询比单机 MySQL 高 2-5ms（Raft 共识开销） |
| **运维复杂度** | 需要管理分布式集群、监控副本健康 |
| **成本** | 最少 3 节点，推荐 5 节点，存储 × 3 副本 |
| **SQL 兼容性** | 不支持存储过程、触发器、外键（性能考虑） |
| **生态成熟度** | 比 MySQL/PostgreSQL 工具链少 |

## 相关概念

- [主从复制与读写分离](主从复制与读写分离.md) - MySQL 复制模型 vs CockroachDB 多主模型
- [分库分表](分库分表.md) - 手动分片 vs 自动分片
- [事务](事务.md) - MySQL RR vs CockroachDB Serializable

## 实战文章

- [CockroachDB 实战：分布式 SQL 数据库](/categories/MySQL/CockroachDB-实战-分布式SQL数据库-Laravel全球分布式事务与强一致性选型指南/) - Laravel 全球分布式事务与强一致性选型指南
