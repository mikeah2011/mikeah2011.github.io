# MySQL 三种日志

## 定义

MySQL 有三种核心日志：**redo log**（重做日志）、**undo log**（回滚日志）、**binlog**（归档日志）。它们共同保障了数据的完整性和一致性。

## Redo Log（重做日志）

### WAL 技术

Redo log 采用 **WAL**（Write-Ahead Logging）技术：**先写日志，再更新内存，最后更新磁盘**。

目的是减少 SQL 执行期间的数据库 IO 操作，更新磁盘往往在 MySQL 比较闲的时候进行。

### 特性
- **固定大小**，环状写入
- **物理日志**，记录"在某个数据页上做了什么修改"
- 属于 **InnoDB 引擎**层
- 提供 **crash-safe** 能力

### 工作原理

```
[write pos] → 当前写入位置（边写边往后移）
[check point] → 擦除位置（将数据持久化到磁盘后向前移动）

当 write pos 追上 check point 时，redo log 满，需要先刷盘再继续写入
```

### 作用
- 实现 **crash-safe**：数据库异常宕机后，重启不会丢失已提交的数据
- 减少随机 IO：顺序写 redo log 比随机写数据页快得多

## Undo Log（回滚日志）

### 特性
- **逻辑日志**，记录的是"与当前操作相反的操作"
- 提供**回滚操作**
- 支持 **MVCC** 多版本控制

### 作用
- 事务回滚：`ROLLBACK` 时，根据 undo log 恢复到事务前的状态
- MVCC 快照读：根据 undo log 计算出历史版本

## Binlog（归档日志）

### 特性
- 属于 MySQL **Server 层**，所有引擎通用
- **逻辑日志**，记录 SQL 的原始逻辑
- 两种格式：
  - **Statement 格式**：记录原始 SQL
  - **Row 格式**：记录行内容

### 作用
- **主从复制**：从库通过 binlog 同步主库数据
- **数据恢复**：通过 binlog 回放恢复到某个时间点

## 三种日志对比

| 特性 | Redo Log | Undo Log | Binlog |
|------|----------|----------|--------|
| **层级** | InnoDB 引擎层 | InnoDB 引擎层 | MySQL Server 层 |
| **日志类型** | 物理日志 | 逻辑日志 | 逻辑日志 |
| **内容** | 数据页的修改 | 操作的逆操作 | SQL 原始逻辑 / 行内容 |
| **大小** | 固定，循环写 | 不固定 | 不固定，追加写 |
| **主要作用** | crash-safe | 回滚 + MVCC | 主从复制 + 数据恢复 |

## 为什么同时存在？

- MySQL 自带的 MyISAM 引擎没有 crash-safe 功能
- binlog 只是用来归档的
- InnoDB 引擎通过自己的 redo log 实现 crash-safe

## 两阶段提交

为了保证 redo log 和 binlog 一致性，InnoDB 使用**两阶段提交**：

```
1. 写 redo log（prepare 状态）
2. 写 binlog
3. 提交事务（redo log 改为 commit 状态）
```

## 相关概念

- [事务 ACID](事务.md) - 日志保障事务特性
- [MVCC](MVCC.md) - undo log 支撑的多版本控制
- [主从复制与读写分离](主从复制与读写分离.md) - binlog 的应用
- [存储引擎](存储引擎.md) - InnoDB 的 crash-safe 能力

## 实战文章

- [MySQL 三种日志 - 博客原文](/categories/Databases/MySQL的三种日志/)
