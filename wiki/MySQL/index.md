# MySQL 数据库知识图谱

## 核心概念

### 🔍 索引体系
- [索引概念](索引概念.md) - 什么是索引、为什么需要索引
- [索引类型](索引类型.md) - 普通索引、唯一索引、复合索引、聚簇/非聚簇索引
- [B+树数据结构](B+树.md) - 为什么用B+树而不是B-树或红黑树
- [聚簇索引与非聚簇索引](聚簇索引与非聚簇索引.md) - InnoDB 索引存储方式与回表机制
- [覆盖索引](覆盖索引.md) - Using index，避免回表查询
- [最左前缀原则](最左前缀原则.md) - 联合索引的匹配规则
- [索引下推](索引下推.md) - ICP 优化，减少回表次数
- [索引失效的12种场景](索引失效.md) - 函数、隐式转换、LIKE前缀等
- [索引创建原则](索引创建原则.md) - 何时建索引、如何设计联合索引
- [主键设计](主键设计.md) - 自增 vs UUID vs 雪花算法、主键与聚簇索引的关系
- [数据类型选型](数据类型选型.md) - INT vs BIGINT、VARCHAR vs CHAR、DECIMAL vs FLOAT 等选型决策
- [三范式与反范式](三范式与反范式.md) - 范式化设计原则、反范式的性能权衡与冗余策略

### ⚡ 事务与并发
- [事务 ACID 与隔离级别](事务.md) - 四大特性、四种隔离级别、脏读/不可重复读/幻读
- [MVCC 多版本控制](MVCC.md) - 一致性视图、undo log、快照读
- [锁机制](锁机制.md) - 表锁/行锁/间隙锁、共享锁/排他锁、死锁
- [乐观锁与悲观锁](乐观锁与悲观锁.md) - SELECT FOR UPDATE vs 版本号、Laravel 订单并发选型

### 🏗️ 存储与架构
- [存储引擎对比](存储引擎.md) - InnoDB vs MyISAM 全方位对比
- [MySQL三种日志](MySQL日志.md) - redo log / binlog / undo log
- [binlog 深度实战](binlog深度实战.md) - Row/Statement/Mixed 格式对比、CDC、数据恢复、PITR
- [主从复制与读写分离](主从复制与读写分离.md) - binlog 同步、延迟排查、一主多从
- [分库分表](分库分表.md) - 水平拆分、全局ID、跨片查询
- [分区表](分区表.md) - Range/List/Hash 分区、分区裁剪、Laravel 分区策略
- [JSON 列深度实战](JSON列深度实战.md) - JSON_EXTRACT、Generated Column、Multi-Valued Index

### 🏢 架构进阶
- [数据库连接池](数据库连接池.md) - ProxySQL、连接复用、Transaction vs Session 模式
- [读写分离中间件](读写分离中间件.md) - ProxySQL/MaxScale 透明路由、连接池复用、主从延迟治理
- [多租户模式](多租户模式.md) - Row-Level、Schema-per-Tenant、独立库
- [数据归档策略](数据归档策略.md) - 冷热分离、分区归档、查询兼容
- [Group Replication 高可用](Group-Replication高可用.md) - Paxos 多节点强一致、单主/多主模式、InnoDB Cluster、自动故障转移
- [不可见索引](不可见索引.md) - MySQL 8.0 Invisible Index 线上安全验证、三步走索引删除流程
- [数据库内定时任务](数据库内定时任务.md) - pg_cron + pg_partman 数据库原生调度与自动分区管理
- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - 核心差异、选型决策
- [PostgreSQL 事务隔离级别](PostgreSQL事务隔离级别.md) - Read Committed vs Repeatable Read vs Serializable
- [PostgreSQL Advisory Lock](PostgreSQL-Advisory-Lock.md) - 会话级互斥、分布式任务调度、PgBouncer 兼容性
- [PostgreSQL 高级索引](PostgreSQL高级索引.md) - Partial Index、Expression Index、条件索引与函数索引
- [PostgreSQL Vacuum 调优](PostgreSQL-Vacuum调优.md) - autovacuum 参数、表膨胀治理、事务 ID 回卷防护
- [PostGIS 空间查询](PostGIS空间查询.md) - 地理围栏、路径规划、附近 POI、对比 Redis Geo
- [CockroachDB 与分布式SQL](CockroachDB与分布式SQL.md) - 全球分布式事务、强一致性
- [PlanetScale Serverless MySQL](PlanetScale-Serverless-MySQL.md) - Vitess 驱动、Online DDL、数据库分支工作流
- [Migration-Free Schema Evolution](Migration-Free-Schema-Evolution.md) - Atlas/Bytebase 声明式 Schema 管理
- [Neon Serverless PostgreSQL](Neon-Serverless-PostgreSQL.md) - 存储计算分离、CoW 分支、PR 级数据库 Review

### 🚀 性能优化
- [EXPLAIN 执行计划](EXPLAIN执行计划.md) - type/key/rows/Extra 字段解读
- [慢查询治理](慢查询治理.md) - pt-query-digest + 索引优化 + SQL 重写
- [慢查询监控](慢查询监控.md) - MySQL Performance Schema + pg_stat_statements 生产级监控
- [SQL优化经验](SQL优化.md) - 查询优化、索引优化实战
- [SQL 查询流程](SQL查询流程.md) - 连接器→分析器→优化器→执行器全链路解析
- [窗口函数](窗口函数.md) - ROW_NUMBER/RANK/DENSE_RANK/LAG/LEAD 高级分析
- [CTE 递归查询](CTE递归查询.md) - WITH RECURSIVE 树形结构遍历与层级分析

### 📊 分析与新兴技术
- [OLAP 选型：ClickHouse vs PostgreSQL](OLAP选型.md) - 行存 vs 列存、分析引擎选型决策
- [ClickHouse + Laravel 集成](ClickHouse-Laravel-集成.md) - MergeTree 引擎、物化视图、实时 OLAP
- [MySQL HeatWave（HTAP 架构）](MySQL-HeatWave.md) - OLTP+OLAP 一体化，RAPID 列存储引擎
- [向量数据库选型](向量数据库选型.md) - Pinecone/Qdrant/Weaviate/pgvector RAG 场景对比
- [Database Branching](Database-Branching.md) - Neon/PlanetScale 数据库分支工作流
- [MySQL 9.x 新特性](MySQL%209.x新特性.md) - 向量存储、JSON 增强、SQL 标准兼容改进
- [TiDB NewSQL 分布式 SQL](TiDB-NewSQL.md) - MySQL 兼容的分布式数据库、HTAP 混合负载
- [FerretDB 文档数据库](FerretDB-文档数据库.md) - PostgreSQL 驱动的开源 MongoDB 替代
- [TimescaleDB 时序数据库](TimescaleDB-时序数据库.md) - PostgreSQL 时序扩展、Hypertable、连续聚合
- [ScyllaDB 高性能 NoSQL](ScyllaDB-高性能NoSQL.md) - C++ Cassandra 重写、Seastar 框架、10 倍吞吐
- [Supabase Realtime](Supabase-Realtime.md) - PostgreSQL 逻辑复制驱动的实时推送
- [ShardingSphere 分片中间件](ShardingSphere-分片中间件.md) - Proxy 代理分片、跨片查询降级
- [Schema 迁移与零停机 DDL](Schema-迁移-零停机DDL.md) - gh-ost/pt-osc/Instant DDL

## 实战文章（来自博客）

### 索引优化系列
- [数据库索引优化实战-覆盖索引联合索引与索引下推](/categories/Databases/数据库索引优化实战-覆盖索引联合索引与索引下推-Laravel-B2C-API踩坑记录/) - Laravel B2C API 踩坑记录
- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则](/categories/Databases/MySQL索引优化实战-EXPLAIN分析-覆盖索引-最左前缀原则/) - KKday B2C API 真实踩坑记录
- [Laravel + MySQL 索引性能调研笔记](/categories/Databases/Laravel-MySQL-索引性能调研笔记/) - EXPLAIN 分析、覆盖索引、最左前缀原则

### 查询优化系列
- [百万级数据表查询优化实战](/categories/Databases/百万级数据表查询优化实战/) - EXPLAIN 深度分析、索引重构与分页治理
- [MySQL 慢查询治理实战](/categories/Databases/MySQL-慢查询治理实战/) - pt-query-digest 分析 + 索引优化 + SQL 重写
- [MySQL CTE 递归查询实战](/categories/Databases/MySQL-CTE-递归查询实战/) - 树形结构层级分析与路径聚合
- [MySQL 窗口函数实战](/categories/Databases/MySQL-窗口函数实战/) - ROW_NUMBER/RANK/DENSE_RANK 应用

### 高可用与扩展
- [数据库读写分离实战](/categories/Databases/数据库读写分离实战/) - Laravel 中间件 + MySQL 主从复制配置
- [MySQL 分库分表实战-30仓库数据库拆分](/categories/Databases/MySQL-分库分表实战-30-仓库数据库拆分/) - 经验与踩坑记录
- [ShardingSphere-Proxy 分库分表实战](/categories/Databases/ShardingSphere-Proxy-分库分表实战/) - Laravel 订单中心按用户路由
- [MySQL Group Replication 实战](/2026/06/06/MySQL-Group-Replication-实战-多主复制与自动故障转移/) - 多主复制、自动故障转移、InnoDB Cluster
- [MySQL Invisible Index 实战](/2026/06/06/MySQL-Invisible-Index-实战-线上索引安全验证/) - 线上索引安全验证、EXPLAIN vs EXPLAIN ANALYZE
- [PostgreSQL pg_cron + pg_partman 实战](/2026/06/06/PostgreSQL-pg-cron-pg-partman-数据库内定时任务与自动分区管理/) - 数据库内定时任务与自动分区管理
- [MySQL binlog 深度实战](/2026/06/06/2026-06-06-MySQL-binlog-深度实战-Row-Statement-Mixed格式对比-主从复制CDC数据恢复/) - Row/Statement/Mixed 格式对比、CDC、数据恢复
- [MySQL 乐观锁 vs 悲观锁实战](/2026/06/06/2026-06-06-mysql-optimistic-vs-pessimistic-lock-laravel-concurrency/) - SELECT FOR UPDATE vs 版本号
- [MySQL JSON 列深度实战](/2026/06/06/2026-06-06-MySQL-JSON-Column-Deep-Dive-Generated-Column-Multi-Valued-Index-Laravel/) - JSON_EXTRACT、Generated Column、Multi-Valued Index
- [读写分离中间件实战](/2026/06/05/2026-06-05-读写分离中间件实战-ProxySQL-MaxScale-Laravel透明路由连接池主从延迟治理/) - ProxySQL/MaxScale 透明路由
- [慢查询监控实战](/2026/06/05/2026-06-05-pg-stat-statements-MySQL-Performance-Schema-慢查询监控实战/) - Performance Schema + pg_stat_statements

### 分析与新兴技术
- [ClickHouse vs PostgreSQL 分析查询对比](/2026/06/02/clickhouse-vs-postgresql-olap-selection-laravel-integration/) - OLAP 场景选型决策
- [ClickHouse + Laravel 实战进阶](/categories/数据库/2026-06-07-clickhouse-laravel-mergetree-materialized-view-realtime-olap/) - MergeTree 引擎、物化视图、实时 OLAP
- [TimescaleDB 时序数据库实战](/categories/数据库/TimescaleDB-实战-时序数据库在Laravel中的集成/) - IoT 数据、用户行为分析
- [ScyllaDB 高性能 NoSQL 实战](/categories/数据库/ScyllaDB-实战-C++重写的高性能NoSQL/) - C++ Cassandra 重写、高吞吐写入
- [Supabase Realtime 实战](/categories/数据库/Supabase-Realtime-实战-数据库变更实时推送/) - Broadcast/Presence/Postgres Changes
- [MySQL HeatWave 实战](/2026/06/01/mysql-heatwave-htap-laravel/) - HTAP 架构落地
- [Vector Database 选型实战](/2026/06/01/2026-06-03-Vector-Database-选型实战-Pinecone-Qdrant-Weaviate-pgvector-RAG向量存储深度对比/) - RAG 向量存储
- [Database Branching 实战](/2026/06/01/database-branching-neon-planetscale-laravel/) - Neon/PlanetScale 分支工作流

### 数据归档
- [数据归档策略实战](/categories/Databases/数据归档策略实战/) - 冷热数据分离、历史数据迁移与查询兼容

### 架构进阶
- [数据库连接池实战](/categories/MySQL/数据库连接池实战/) - PgBouncer vs ProxySQL vs Supabase
- [数据库多租户模式对比实战](/categories/MySQL/数据库多租户模式对比实战/) - 三种方案深度权衡
- [CockroachDB 实战](/categories/MySQL/CockroachDB实战/) - 分布式 SQL 数据库
- [TiDB 分布式 SQL 实战](/categories/MySQL/tidb-laravel-integration-newsql-guide/) - MySQL 兼容 NewSQL 选型
- [ShardingSphere-Proxy 分库分表实战](/categories/Databases/ShardingSphere-Proxy-分库分表实战/) - Laravel 订单中心按用户路由
- [FerretDB 文档数据库实战](/categories/数据库/2026-06-07-FerretDB-实战-开源MongoDB替代/) - PostgreSQL 驱动的 MongoDB 替代
- [Schema 迁移零停机 DDL 实战](/01_MySQL/2026-06-07-Schema-Migration-Zero-Downtime-gh-ost-pt-osc-Laravel/) - gh-ost vs pt-osc
- [PostgreSQL vs MySQL 选型实战](/categories/Databases/PostgreSQL-vs-MySQL-选型实战/) - KKday Affiliate 选型
- [PlanetScale Serverless MySQL 实战](/2026/06/05/planetscale-serverless-mysql-laravel-vitess-workflow-benchmark/) - Vitess 驱动的无服务器数据库
- [Migration-Free Schema Evolution 实战](/2026/06/05/Migration-Free-Schema-Evolution-实战-Atlas-Bytebase数据库Schema即代码-对比Laravel-Migrations的DDL管理新范式/) - Atlas/Bytebase Schema 即代码
- [Neon Serverless PostgreSQL 实战](/2026/06/05/Neon-Serverless-PostgreSQL-实战-分支工作流与Laravel-开发体验/) - 分支工作流与 PR 级数据库 Review
- [PostgreSQL 事务隔离级别实战](/2026/06/06/2026-06-06-PostgreSQL-Transaction-Isolation-Levels-Read-Committed-Repeat-Read-Serializable-Laravel/) - RC vs RR vs Serializable
- [PostgreSQL Advisory Lock 实战进阶](/categories/MySQL/PostgreSQL-Advisory-Lock-实战进阶/) - 会话级互斥、PgBouncer 兼容性
- [PostgreSQL 高级索引实战](/categories/MySQL/PostgreSQL-Partial-Index-Expression-Index-实战/) - 条件索引与函数索引
- [PostgreSQL Vacuum 调优实战](/categories/MySQL/PostgreSQL-Vacuum-调优实战/) - autovacuum 参数、表膨胀治理
- [PostGIS 空间查询实战](/categories/MySQL/PostGIS-Laravel-实战-空间数据查询/) - 地理围栏、附近 POI

## 学习路径

```
入门 ─────────────────────────────────────────────────────────────── 进阶

1. 三范式与反范式 → 2. 数据类型选型 → 3. 主键设计 → 4. 索引概念
                                                          │
                                                          ▼
5. 索引类型 → 6. B+树 → 7. 聚簇/非聚簇索引 → 8. 最左前缀原则
                                                          │
                                                          ▼
9. 覆盖索引 → 10. 索引下推 → 11. 索引失效场景
                                                          │
                                                          ▼
12. SQL 查询流程 → 13. 事务与隔离级别 → 14. MVCC → 15. 锁机制 → 16. 三种日志
                                                        │   │
                                                        │   └→ 16.5. 乐观锁与悲观锁
                                                        │
                                                        └→ 16.6. binlog 深度实战
                                                          │
                                                          ▼
17. EXPLAIN分析 → 18. 慢查询治理 → 18.5. 慢查询监控 → 19. 存储引擎对比 → 20. 窗口函数 → 21. CTE 递归查询
                                                         │
                                                         └→ 21.5. JSON 列深度实战
                                                          │
                                                          ▼
22. 主从复制与读写分离 → 23. 分库分表
         │                  │
         └→ 22.5. 读写分离中间件（ProxySQL/MaxScale）
                          ▼
                    23.5. 分区表（分区裁剪与自动维护）
                                                          │
                                                          ▼
24. 数据库连接池 → 25. 多租户模式 → 26. 数据归档策略 → 27. 实战踩坑
                                                          │
                                                          └→ 27.5. PostgreSQL 进阶
                                                              ├→ 事务隔离级别
                                                              ├→ Advisory Lock
                                                              ├→ 高级索引（Partial/Expression）
                                                              ├→ Vacuum 调优
                                                              └→ PostGIS 空间查询
                                                          │
                                                          ▼
28. OLAP 选型 → 29. MySQL HeatWave → 30. 向量数据库选型 → 31. Database Branching → 32. MySQL 9.x 新特性
                                                          │
                                                          └→ 33. ClickHouse 集成 → 34. TiDB NewSQL → 35. ShardingSphere 分片
                                                          └→ 36. TimescaleDB → 37. ScyllaDB → 38. Supabase Realtime
                                                          └→ 39. Schema 迁移零停机 DDL → 40. FerretDB 文档数据库
```

## 知识关联图

```
三范式与反范式 ──→ 数据类型选型 ──→ 主键设计
                                        │
                                        ▼
索引概念 ──→ B+树 ──→ 聚簇索引 ──→ 回表
                │                    │
                ▼                    ▼
           非聚簇索引 ──→ 覆盖索引（避免回表）
                │
                ▼
           最左前缀原则 ──→ 索引下推（ICP）
                │
                ▼
           索引失效 ──→ EXPLAIN 排查 ──→ 慢查询治理

事务 ACID ──→ 隔离级别 ──→ MVCC（一致性视图）
                              │
                              ▼
                         undo log / redo log / binlog
                              │
                              ▼
                         锁机制 ──→ 死锁处理

SQL 查询流程 ──→ 连接器 → 分析器 → 优化器 → 执行器
                                         │
                                         ▼
                                    EXPLAIN 分析

存储引擎 ──→ InnoDB（行锁+MVCC+聚簇索引）
         └─→ MyISAM（表锁+全文索引）

窗口函数 ──→ ROW_NUMBER/RANK/DENSE_RANK
         └─→ LAG/LEAD/NTILE

CTE 递归查询 ──→ 树形结构遍历
             └─→ 层级路径聚合

主从复制 ──→ binlog 同步 ──→ 读写分离
                              │
                              ▼
                         分库分表 ──→ 全局ID ──→ ShardingSphere

分区表 ──→ Range（按时间）/ List（按枚举）/ Hash（均匀分布）
      └──→ 分区裁剪 ──→ 自动分区维护
```

分析与新兴技术：
OLAP 选型 ──→ ClickHouse vs PostgreSQL
                │
                ├──→ ClickHouse + Laravel 集成（MergeTree/物化视图）
                │
                ├──→ MySQL HeatWave（HTAP 原生方案）
                │
                └──→ Debezium CDC 同步

NewSQL 分布式 SQL ──→ TiDB（MySQL 兼容）
                │
                └──→ ShardingSphere 分片中间件（Proxy 路由）

时序数据库 ──→ TimescaleDB（PG 扩展）
                │
                └──→ ScyllaDB（C++ Cassandra，高吞吐写入）

文档数据库 ──→ FerretDB（PG 驱动 MongoDB 替代）
                │
                └──→ Supabase Realtime（PG 逻辑复制推送）

Schema 管理 ──→ Migration-Free（声明式）
                │
                └──→ Schema 迁移零停机 DDL（gh-ost/pt-osc）

向量数据库 ──→ Embedding 模型 ──→ RAG 应用
                │
                └──→ pgvector / Qdrant / Pinecone

Database Branching ──→ Neon (PG) / PlanetScale (MySQL)
                │
                └──→ CI/CD Schema Preview

## 跨领域关联
- → [Redis 知识图谱](../Redis/index.md)：缓存层、分布式锁
- → [PHP-Laravel 知识图谱](../PHP-Laravel/index.md)：Eloquent ORM、数据库迁移
- → [前端知识图谱](../前端/index.md)：前后端数据流、API 设计
- → [架构设计知识图谱](../架构设计/index.md)：分布式事务、CAP 定理、微服务数据治理
- → [消息队列知识图谱](../消息队列/index.md)：binlog CDC、Outbox 模式、Kafka 集成
