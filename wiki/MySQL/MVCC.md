# MVCC 多版本控制

## 定义

`MVCC`（Multi-Version Concurrency Control）叫做**多版本控制**，实现 MVCC 时用到了**一致性视图**，用于支持**读提交（READ COMMITTED）** 和 **可重复读（REPEATABLE READ）** 的实现。

## 核心原理

### 多版本机制

对于一行数据，每次更新操作都会生成一个**新版本**，并不是对全部数据的全量备份：

```
事务 A (id=100) → 更新 → 版本 v1 (trx_id=100)
事务 B (id=101) → 更新 → 版本 v2 (trx_id=101)
事务 C (id=102) → 更新 → 版本 v3 (trx_id=102)
```

每个事务开始时获得一个唯一的**事务 ID（transaction id）**，顺序递增，最后赋值给 `row trx_id`。

### Undo Log 与版本计算

实际上 v1、v2 并非物理存在：

```
v3（当前版本）──→ undo log U2 ──→ v2
                               ──→ undo log U1 ──→ v1
```

v1 和 v2 是根据当前 v3 和 **undo log** 计算出来的。

### 一致性视图（快照读）

InnoDB 利用每行数据有多个版本的特性，实现了**秒级创建"快照"**：

- 事务开始时，创建一个一致性视图
- 读操作只看到**事务开始前已提交的数据**
- 其他事务的修改对当前事务不可见（直到提交）

## MVCC 的读取方式

| 读取方式 | 说明 | 使用场景 |
|---------|------|---------|
| **快照读** | 读取的是历史版本，不需要加锁 | 普通 SELECT |
| **当前读** | 读取的是最新版本，需要加锁 | SELECT ... FOR UPDATE / INSERT / UPDATE / DELETE |

## Read View 的可见性判断

Read View 包含：
- `m_ids`：创建快照时，活跃（未提交）的事务 ID 列表
- `min_trx_id`：活跃事务中最小的 ID
- `max_trx_id`：下一个将被分配的事务 ID
- `creator_trx_id`：创建该 Read View 的事务 ID

判断逻辑：
```
if row.trx_id < min_trx_id:
    可见（事务在快照前已提交）
elif row.trx_id >= max_trx_id:
    不可见（事务在快照后才开始）
elif row.trx_id in m_ids:
    不可见（事务在快照时还未提交）
else:
    可见（事务在快照前已提交）
```

## 与隔离级别的关系

| 隔离级别 | MVCC 行为 |
|---------|----------|
| 读未提交 | 不使用 MVCC，直接读最新数据 |
| **读已提交** | **每次 SELECT 创建新的 Read View** |
| **可重复读** | **事务开始时创建 Read View，整个事务期间复用** |
| 串行化 | 不使用 MVCC，使用锁 |

## 相关概念

- [事务 ACID 与隔离级别](事务.md) - MVCC 支持的隔离级别
- [锁机制](锁机制.md) - 当前读使用的锁
- [MySQL 日志](MySQL日志.md) - undo log 实现版本链

## 实战文章

- [MySQL MVCC - 博客原文](/categories/Databases/MySQL-MVCC/)
