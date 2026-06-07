# MySQL binlog 深度实战：Row/Statement/Mixed 格式对比

## 定义

binlog（Binary Log，二进制日志）是 MySQL Server 层面维护的日志文件，记录了所有对数据库执行修改操作的事件。与存储引擎无关——无论 InnoDB、MyISAM 还是其他引擎，只要开启 binlog，所有写入操作都会被记录。

## 三大核心用途

| 用途 | 说明 | 典型工具 |
|------|------|---------|
| **主从复制** | 从库 IO 线程拉取 binlog → relay log → SQL 线程回放 | MySQL Replication |
| **数据恢复（PITR）** | 全量备份 + binlog 回放 → 恢复到任意时间点 | mysqlbinlog, flashback |
| **CDC（变更数据捕获）** | 实时解析 binlog → 推送到 Kafka/ES/ClickHouse | Debezium, Canal, MaxWell |

## 三种格式深度对比

### Statement 格式：记录原始 SQL

```
SET GLOBAL binlog_format = 'STATEMENT';
```

- **优点**：日志量小，只记录 SQL 语句文本
- **缺点**：非确定性函数（NOW()、UUID()、RAND()）在主从执行结果不同
- **场景**：简单读写分离，对数据一致性要求不高

### Row 格式：记录行变更

```
SET GLOBAL binlog_format = 'ROW';
binlog_row_image = FULL  -- FULL / MINIMAL / NOBLOB
```

- **优点**：精确记录每行数据的变更前后值，主从数据一致性最强
- **缺点**：日志量大（批量 UPDATE 时每行都记录）
- **场景**：CDC、数据恢复、生产环境首选
- **binlog_row_image 选项**：
  - `FULL`：记录所有列（默认，最安全）
  - `MINIMAL`：只记录变更列（节省空间）
  - `NOBLOB`：不记录未变更的 BLOB 列

### Mixed 格式：自动切换

```
SET GLOBAL binlog_format = 'MIXED';
```

- **逻辑**：默认用 Statement，遇到非确定性函数自动切换为 Row
- **优点**：兼顾日志量和数据一致性
- **缺点**：某些边界场景仍有不一致风险
- **场景**：折中方案，但不如纯 Row 可靠

### 格式选型决策表

| 维度 | Statement | Row | Mixed |
|------|-----------|-----|-------|
| 日志量 | ⭐⭐⭐ 小 | ⭐ 大 | ⭐⭐ 中 |
| 数据一致性 | ⭐ 差 | ⭐⭐⭐ 强 | ⭐⭐ 中 |
| CDC 支持 | ❌ 不支持 | ✅ 完整支持 | ⚠️ 部分 |
| 闪回恢复 | ❌ 不支持 | ✅ 支持 | ❌ 不支持 |
| 生产推荐 | ❌ 不推荐 | ✅ **首选** | ⚠️ 次选 |

## 核心配置

```ini
[mysqld]
server-id = 1
log-bin = /var/lib/mysql/mysql-bin
binlog_format = ROW
binlog_row_image = FULL
expire_logs_days = 7
max_binlog_size = 500M
sync_binlog = 1               # 每次事务提交刷盘（双一配置之一）
```

**双一配置**：`sync_binlog = 1` + `innodb_flush_log_at_trx_commit = 1`，金融级场景数据不丢失的基本要求。

## 常用命令

```sql
SHOW VARIABLES LIKE 'log_bin';           -- ON
SHOW VARIABLES LIKE 'binlog_format';     -- ROW / STATEMENT / MIXED
SHOW VARIABLES LIKE 'binlog_row_image';  -- FULL / MINIMAL / NOBLOB
SHOW BINARY LOGS;                        -- binlog 文件列表
SHOW MASTER STATUS;                      -- 当前 binlog 文件及位置

-- 解析 binlog
mysqlbinlog --base64-output=DECODE-ROWS -v mysql-bin.000001

-- 基于位置恢复
mysqlbinlog --start-position=154 --stop-position=1024 mysql-bin.000001 | mysql -u root -p

-- 基于时间恢复
mysqlbinlog --start-datetime="2026-06-06 10:00:00" --stop-datetime="2026-06-06 11:00:00" mysql-bin.000001 | mysql -u root -p
```

## CDC 实战架构

```
MySQL (binlog ROW) → Debezium/Canal → Kafka → 下游消费者
                                              ├→ Elasticsearch（搜索同步）
                                              ├→ ClickHouse（分析查询）
                                              ├→ 缓存失效（Redis）
                                              └→ 微服务事件通知
```

## 数据恢复与闪回

- **PITR**：全量备份 + binlog 回放到指定时间点
- **Flashback**（Row 格式专用）：生成反向 SQL，适合少量数据误操作

## 实战文章（来自博客）

- [MySQL binlog 深度实战：Row/Statement/Mixed 格式对比——从主从复制到 CDC 到数据恢复](/2026/06/06/2026-06-06-MySQL-binlog-深度实战-Row-Statement-Mixed格式对比-主从复制CDC数据恢复/)

## 相关概念

- [MySQL 日志](MySQL日志.md) - redo log / binlog / undo log 基础
- [主从复制与读写分离](主从复制与读写分离.md) - binlog 在复制中的应用
- [事务](事务.md) - sync_binlog 与事务提交的关系
- [读写分离中间件](读写分离中间件.md) - ProxySQL/MaxScale

## 常见问题

**Q: Row 格式日志量太大怎么办？**
A: 设置 `binlog_row_image = MINIMAL` 只记录变更列；或调整 `expire_logs_days` 和 `max_binlog_size`。

**Q: CDC 延迟怎么排查？**
A: 检查 Debezium/Canal 的消费位点是否跟上 `SHOW MASTER STATUS`，关注 Kafka 消费者 lag。

**Q: binlog 和 redo log 的区别？**
A: binlog 是 Server 层逻辑日志（所有引擎通用），redo log 是 InnoDB 引擎层物理日志（crash-safe）。两者通过 XA 事务保证一致性。
