# MySQL HeatWave（HTAP 架构）

## 定义

MySQL HeatWave 是 Oracle 推出的原生 HTAP（Hybrid Transactional and Analytical Processing）解决方案。通过在 MySQL 内核中嵌入 RAPID 内存列存储引擎，在同一数据库中同时支撑 OLTP 事务处理和 OLAP 分析查询，**无需 ETL 管道**。

## 核心原理

### HTAP 架构

传统架构将 OLTP 和 OLAP 分离为两个系统，通过 ETL 管道连接。HTAP 的核心理念是：**同一份数据，两种访问方式**。

```
传统分离架构：
  MySQL (OLTP) → ETL → ClickHouse/PG (OLAP)  → 延迟 15min~数小时

HTAP 架构：
  MySQL HeatWave
    ├── InnoDB 行存储 → OLTP 事务
    └── RAPID 列存储 → OLAP 分析  → 延迟秒级
```

### RAPID 引擎

RAPID 是 HeatWave 的核心列存储引擎：

- **列式存储**：每列独立存储，分析查询只读相关列
- **内存驻留**：数据加载到 HeatWave 节点内存中
- **压缩效率**：同类型数据连续存储，压缩比 5x-10x
- **查询下推**：MySQL 优化器自动将分析查询下推到 RAPID 节点
- **分布式并行**：查询拆分为多个并行子任务，分布在集群各节点

### 数据同步

- **手动加载**：`ALTER TABLE table_name SECONDARY_LOAD`
- **自动加载**：设置 `rapid_autoload` 系统变量
- **增量同步**：基于日志的变更捕获，延迟通常在秒级

## 适用场景

| 场景 | 适合度 | 说明 |
|------|--------|------|
| 实时运营报表 | ⭐⭐⭐⭐⭐ | 消除 ETL 延迟，实时看到业务数据 |
| 实时风控分析 | ⭐⭐⭐⭐⭐ | 毫秒级交易风险评估 |
| 用户行为分析 | ⭐⭐⭐⭐ | 实时 A/B 测试效果验证 |
| 历史数据回溯 | ⭐⭐⭐ | 受内存容量限制 |
| 超大规模数据仓库 | ⭐⭐ | 数据量超过内存时不如 ClickHouse |

## 与 ClickHouse 的对比

| 维度 | MySQL HeatWave | ClickHouse |
|------|---------------|------------|
| 部署复杂度 | 低（MySQL 原生） | 中（需独立集群 + CDC） |
| 数据延迟 | 秒级（自动同步） | 秒级（需 CDC） |
| OLTP 能力 | 完整（InnoDB） | 不支持 |
| 最大数据量 | 受内存限制 | 无限制（磁盘列存） |
| 成本 | 按节点计费（OCI/AWS） | 自托管免费 |
| AutoML | 内置 | 无 |
| 适用团队 | MySQL 技术栈、不想引入新组件 | 大数据量、需要极致分析性能 |

## Laravel 集成

HeatWave 与标准 MySQL 协议完全兼容，Laravel 无需修改连接配置：

```php
// config/database.php - 无需特殊配置
'mysql' => [
    'driver' => 'mysql',
    'host' => env('DB_HOST'),  // HeatWave 端点
    'database' => env('DB_DATABASE'),
    // ... 标准配置
],
```

分析查询自动路由到 RAPID 引擎，无需代码层面区分。

## 实战案例

来自博客文章：
- [MySQL HeatWave 实战：OLTP+OLAP 一体化——Laravel 中的实时分析查询与 HTAP 架构落地](/2026/06/01/mysql-heatwave-htap-laravel/)

## 相关概念

- [OLAP 选型](OLAP选型.md) — ClickHouse vs PostgreSQL OLAP 对比
- [存储引擎](存储引擎.md) — InnoDB vs MyISAM
- [主从复制与读写分离](主从复制与读写分离.md) — 传统读写分离方案
- [分库分表](分库分表.md) — 大数据量水平拆分方案

## 常见问题

**Q: HeatWave 需要改 SQL 吗？**
A: 不需要。标准 MySQL SQL 即可，优化器自动判断是否下推到 RAPID 引擎。

**Q: 数据量超过内存怎么办？**
A: HeatWave 按节点计费，可以扩容节点。但超大规模（TB 级）分析场景，ClickHouse 的磁盘列存更经济。

**Q: 和 Aurora 有什么区别？**
A: Aurora 是 MySQL 兼容的云数据库，仍是行存储。HeatWave 在 Aurora 之上增加了 RAPID 列存储引擎，实现 HTAP。
