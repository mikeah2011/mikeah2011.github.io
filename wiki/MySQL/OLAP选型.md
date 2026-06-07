# OLAP 选型：ClickHouse vs PostgreSQL

## 定义

OLAP（Online Analytical Processing）面向聚合分析、报表和 BI 看板场景，与 OLTP（在线事务处理）的工作负载特征完全不同。传统关系型数据库（MySQL/PostgreSQL）采用行存储，适合事务处理；但在千万级数据做 GROUP BY 聚合时性能急剧下降。本文对比 ClickHouse 与 PostgreSQL 在 OLAP 场景下的选型决策。

## 核心原理

### 行存 vs 列存

| 维度 | 行存储（MySQL/PG） | 列存储（ClickHouse） |
|------|-------------------|---------------------|
| 数据布局 | 每行数据连续存放 | 同列数据连续存放 |
| OLTP 点查 | 一次 IO 读完整行 | 需要读多列拼接 |
| OLAP 聚合 | 即使只查 2 列也要读全部列 | 只读相关列，IO 量 1/5~1/10 |
| 压缩率 | 低（数据类型混杂） | 高（同类型连续，压缩率 5x-10x） |
| 执行模型 | Volcano Iterator（逐行处理） | 向量化执行（批量处理） |

### PostgreSQL 的 OLAP 能力

PostgreSQL 并非不能做 OLAP，它有一系列内置优化：

- **并行查询**：PG 9.6+ 支持多核并行执行，8 核机器上可获得 4-5 倍加速
- **BRIN 索引**：时间序列数据上比 B-Tree 小 100 倍以上
- **物化视图**：预计算聚合结果，定期刷新
- **列存扩展**：cstore_fdw / columnar 扩展提供列式存储
- **TimescaleDB**：时序数据专用扩展

### ClickHouse 的核心优势

- **MergeTree 引擎**：原生列存，稀疏索引，分区裁剪
- **向量化执行**：SIMD 指令批量处理数据
- **原生并行**：查询自动拆分为多线程并行执行
- **实时增量聚合**：AggregatingMergeTree 支持实时物化视图
- **压缩比极高**：1 亿行订单数据磁盘占用仅为 PostgreSQL 的 1/8

## 选型决策

| 数据量 | 推荐方案 | 理由 |
|--------|---------|------|
| 5000 万行以下 | PostgreSQL + 索引优化 | 够用，不引入新组件 |
| 5000 万 ~ 1 亿 | PostgreSQL + 物化视图 + 列存扩展 | 权衡复杂度与收益 |
| 1 亿行以上 | ClickHouse + CDC 同步 | 性能差距显著 |
| 实时分析（秒级延迟） | MySQL HeatWave / ClickHouse | 避免 ETL 延迟 |

## 架构方案

### 方案一：PostgreSQL 独立承担

```
Laravel App → PostgreSQL（OLTP + OLAP）
               ├── 索引优化 + 并行查询
               └── 物化视图预计算
```

### 方案二：ClickHouse 引入

```
Laravel App → MySQL/PG (OLTP)
                    ↓ Debezium CDC
              Kafka → ClickHouse (OLAP)
                    ↓
              Grafana / Metabase (BI)
```

## 实战案例

来自博客文章：
- [ClickHouse vs PostgreSQL 分析查询对比：OLAP 场景下的选型决策与 Laravel 集成](/2026/06/02/clickhouse-vs-postgresql-olap-selection-laravel-integration/) — 千万级订单明细表性能对比

## 相关概念

- [MySQL HeatWave](MySQL-HeatWave.md) — 原生 HTAP 方案，不引入新组件
- [向量数据库选型](向量数据库选型.md) — AI/RAG 场景的数据库选型
- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) — OLTP 场景选型
- [数据归档策略](数据归档策略.md) — 冷热数据分离

## 常见问题

**Q: ClickHouse 能替代 MySQL 做事务处理吗？**
A: 不能。ClickHouse 不支持行级更新/删除（只有异步 Merge），没有事务 ACID 保障，不适合 OLTP 场景。

**Q: PostgreSQL 的物化视图和 ClickHouse 的 AggregatingMergeTree 有什么区别？**
A: PG 物化视图需要手动 REFRESH，刷新期间可能锁表；ClickHouse 的 AggregatingMergeTree 是实时增量聚合，写入即计算。

**Q: 数据同步延迟怎么解决？**
A: 推荐 Debezium CDC + Kafka，延迟通常在秒级。也可以用定时 ETL，但延迟在分钟级。
