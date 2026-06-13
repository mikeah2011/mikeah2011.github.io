---
title: MySQL - MVCC
tags: [MySQL, MVCC, 事务, 锁, undo log]
keywords: [MySQL, MVCC, 数据库]
categories:
  - database
date: 2019-03-20 15:05:07
description: '`MVCC`（多版本并发控制）是InnoDB引擎实现高并发事务的核心机制，通过ReadView一致性视图和undo log回滚日志为每行数据维护多个版本快照，实现无锁读操作。本文深入剖析ReadView结构（m_ids、min_trx_id、max_trx_id、creator_trx_id）、可见性判断算法、RC与RR隔离级别下ReadView创建时机的差异，以及purge清理机制，全面理解MySQL事务隔离的底层实现原理。'
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-1-content-1.jpg
  - /images/content/databases-1-content-2.jpg


---

`MVCC`叫做**多版本控制**，实现MVCC时用到了**一致性视图**，用于支持**读提交**和**可重复读**的实现。

![MySQL MVCC 多版本并发控制](/images/content/databases-1-content-1.jpg)

对于一行数据若是想实现可重复读取或者能够读取数据的另一个事务未提交前的原始值，那么必须对原始数据进行保存或者对更新操作进行保存，这样才能够查询到原始值。

在Mysql的MVCC中规定**每一行数据都有多个不同的版本，一个事务更新操作完后就生成一个新的版本**，并不是对全部数据的全量备份，因为全量备份的代价太大了：

![图片](/images/64110.png)

如图中所示，假如三个事务更新了同一行数据，那么就会有对应的v1、v2、v3三个数据版本，每一个事务在开始的时候都获得一个唯一的事务id（`transaction id`），并且是顺序递增的，并且这个事务id最后会赋值给`row trx_id`，这样就形成了一个唯一的一行数据版本。

![MVCC 并发控制与 Undo Log](/images/content/databases-1-content-2.jpg)

实际上版本1、版本2并非实际物理存在的，而图中的U1和U2实际就是`undo log`日志（**回滚日志**），这v1和v2版本是根据当前v3和`undo log`计算出来的。

InnoDB引擎就是利用每行数据有多个版本的特性，实现了秒级创建"快照"，并不需要花费大量的是时间。

### InnoDB 行隐藏字段

InnoDB 为了实现 MVCC，会自动为每行数据添加三个隐藏字段：

| 隐藏字段 | 大小 | 说明 |
|----------|------|------|
| `DB_TRX_ID` | 6 字节 | 最后一次插入或更新该行的**事务ID**。删除操作在内部被视为一次更新，只是行中的一个特殊位被标记为已删除 |
| `DB_ROLL_PTR` | 7 字节 | **回滚指针**，指向该行的上一个版本在 undo log 中的位置。通过这个指针将同一行的多个版本串联成一个**版本链** |
| `DB_ROW_ID` | 6 字节 | **隐含自增ID**。如果表没有定义主键也没有非空唯一索引，InnoDB 会用这个字段自动创建一个聚簇索引 |

> 💡 `DB_ROW_ID` 不参与 MVCC 的版本可见性判断，只有 `DB_TRX_ID` 和 `DB_ROLL_PTR` 是 MVCC 的核心字段。

### MVCC 完整执行流程

当一条普通的 `SELECT` 查询（快照读）执行时，InnoDB 的完整处理流程如下：

```
1. 事务开启，获取事务ID（transaction id）
2. 执行 SELECT → 生成 ReadView
3. 读取目标行数据
4. 比较行的 DB_TRX_ID 与 ReadView
   ├─ 可见 → 直接返回当前版本数据
   └─ 不可见 → 通过 DB_ROLL_PTR 沿 undo log 版本链向前查找
       ├─ 找到可见版本 → 返回该版本数据
       └─ 遍历完整个版本链仍无可见版本 → 说明该行对当前事务不存在
```

而 `UPDATE` 操作的流程略有不同：

```
1. 事务开启，获取事务ID
2. 执行 UPDATE（当前读，读取最新已提交版本）
3. 加行锁（X Lock）
4. 将旧版本数据写入 undo log
5. 更新当前行数据，设置新的 DB_TRX_ID
6. 将 DB_ROLL_PTR 指向刚写入的 undo log 位置
```

> **关键区别：** `SELECT` 是快照读，通过 ReadView + 版本链读取数据；`UPDATE` 是当前读，直接读取最新已提交数据后再修改。

## ReadView（一致性视图）详解

MVCC 的核心在于 **ReadView**（一致性视图），它是事务在执行快照读时生成的一个数据结构，用来判断当前版本的数据是否对当前事务可见。

### ReadView 的四个核心字段

| 字段 | 含义 |
|------|------|
| `m_ids` | 创建ReadView时，系统中所有**活跃（未提交）事务ID**的列表 |
| `min_trx_id` | `m_ids`中的最小值，即活跃事务中ID最小的事务 |
| `max_trx_id` | 系统**应该分配给下一个事务**的ID（并非当前最大事务ID，而是最大ID+1） |
| `creator_trx_id` | 创建该ReadView的**事务自身的ID** |

### 可见性判断算法

当事务读取某行数据时，会获取该行的 `row trx_id`（即最后修改该行的事务ID），然后按以下规则判断可见性：

**第一步：** 如果 `row trx_id == creator_trx_id`，说明是**自己修改的**，**可见** ✅

**第二步：** 如果 `row trx_id < min_trx_id`，说明该版本在ReadView创建前就已提交，**可见** ✅

**第三步：** 如果 `row trx_id >= max_trx_id`，说明该版本在ReadView创建之后才产生，**不可见** ❌

**第四步：** 如果 `min_trx_id <= row trx_id < max_trx_id`：
- 若 `row trx_id` **在** `m_ids` 列表中：说明修改该版本的事务还未提交，**不可见** ❌
- 若 `row trx_id` **不在** `m_ids` 列表中：说明修改该版本的事务已提交，**可见** ✅

**第五步：** 如果判断为不可见，则沿着 undo log 版本链向前查找，直到找到一个可见的版本为止。

用流程图描述：

```
读取行数据 → 获取 row trx_id
    │
    ├─ trx_id == creator_trx_id? → YES → 可见
    │
    ├─ trx_id < min_trx_id? → YES → 可见
    │
    ├─ trx_id >= max_trx_id? → YES → 不可见 → 沿undo log链找旧版本
    │
    └─ min_trx_id <= trx_id < max_trx_id?
            ├─ 在 m_ids 中? → YES → 不可见 → 沿undo log链找旧版本
            └─ 不在 m_ids 中? → YES → 可见
```

## RC 与 RR 隔离级别的关键区别

MVCC 在不同隔离级别下的行为差异，**本质上是 ReadView 创建时机的不同**：

### Read Committed（读提交，RC）

在 RC 级别下，**每次执行 SELECT 都会创建一个新的 ReadView**。

这意味着在同一个事务中，两次 SELECT 可能看到不同的结果，因为两次读取之间可能有其他事务提交了新的修改。

### Repeatable Read（可重复读，RR）

在 RR 级别下，**ReadView 只在事务第一次 SELECT 时创建**，之后整个事务期间都复用这个 ReadView。

这就是为什么 RR 级别能实现"可重复读"——后续读取都基于同一个快照，结果自然一致。

> **注意：** 这里的"快照读"指的是普通的 `SELECT` 语句。如果使用 `SELECT ... FOR UPDATE` 或 `SELECT ... LOCK IN SHARE MODE`，则是**当前读**，会读取最新已提交的数据版本，不受 MVCC 快照控制。

### RC 与 RR 深度对比：ReadView 行为差异

下表从多个维度对比 RC 和 RR 两种隔离级别下 ReadView 的行为差异：

| 对比维度 | Read Committed (RC) | Repeatable Read (RR) |
|----------|:-------------------:|:--------------------:|
| **ReadView 创建时机** | 每次 `SELECT` 都创建新的 ReadView | 仅在事务第一次 `SELECT` 时创建，后续复用 |
| **ReadView 生命周期** | 单次查询级别 | 整个事务级别 |
| **m_ids 更新** | 每次查询都重新获取活跃事务列表 | 一旦创建后不再更新 |
| **min_trx_id** | 每次查询时实时计算 | 创建时固定 |
| **max_trx_id** | 每次查询时实时计算 | 创建时固定 |
| **能否看到其他事务已提交的最新修改** | ✅ 能（因为新 ReadView 会排除已提交事务） | ❌ 不能（ReadView 快照不变） |
| **不可重复读** | ❌ 会发生 | ✅ 不会发生 |
| **幻读（快照读）** | ❌ 会发生 | ✅ 不会发生 |
| **幻读（当前读）** | ❌ 会发生 | ⚠️ 需配合 Next-Key Lock |
| **锁策略** | 无 Gap Lock，仅 Record Lock | 有 Gap Lock 和 Next-Key Lock |
| **undo log 版本清理** | 较快（活跃事务少时 purge 更及时） | 较慢（长事务会阻止 purge） |
| **适用场景** | 互联网高并发读写、可容忍短暂不一致 | 需要一致性快照、报表查询、金融场景 |

> **一句话总结：** RC 是"每次读都看最新快照"，RR 是"整个事务只看一个固定快照"。

## MySQL CLI 实战演示

### 演示1：防止脏读（RC 和 RR 均可防止）

```sql
-- Session A
mysql> SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
mysql> START TRANSACTION;
mysql> SELECT * FROM accounts WHERE id = 1;
+----+-------+---------+
| id | name  | balance |
+----+-------+---------+
| 1  | Alice | 1000    |
+----+-------+---------+

-- Session B（同时开启另一个终端）
mysql> START TRANSACTION;
mysql> UPDATE accounts SET balance = 2000 WHERE id = 1;
-- 注意：Session B 尚未 COMMIT

-- Session A 再次查询
mysql> SELECT * FROM accounts WHERE id = 1;
+----+-------+---------+
| id | name  | balance |
+----+-------+---------+
| 1  | Alice | 1000    |  ← 仍然看到旧值，没有脏读！
+----+-------+---------+

-- Session B 提交事务
mysql> COMMIT;
```

### 演示2：RC 与 RR 的区别（不可重复读）

```sql
-- Session A（RC 级别）
mysql> SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
mysql> START TRANSACTION;
mysql> SELECT balance FROM accounts WHERE id = 1;
+---------+
| balance |
+---------+
| 1000    |
+---------+

-- Session B
mysql> UPDATE accounts SET balance = 3000 WHERE id = 1;
mysql> COMMIT;

-- Session A 再次查询（RC级别下可以看到Session B已提交的修改）
mysql> SELECT balance FROM accounts WHERE id = 1;
+---------+
| balance |
+---------+
| 3000    |  ← RC下看到了已提交的新值（不可重复读）
+---------+

-- 如果是 RR 级别，同样的操作：
mysql> SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
mysql> START TRANSACTION;
mysql> SELECT balance FROM accounts WHERE id = 1;
-- 输出: 1000

-- Session B: UPDATE accounts SET balance = 3000 WHERE id = 1; COMMIT;

mysql> SELECT balance FROM accounts WHERE id = 1;
-- 输出: 1000  ← RR下依然看到旧值，实现了可重复读！
```

### 演示3：RR 级别下防止幻读

```sql
-- Session A（RR 级别）
mysql> SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
mysql> START TRANSACTION;
mysql> SELECT * FROM accounts WHERE balance > 500;
+----+-------+---------+
| id | name  | balance |
+----+-------+---------+
| 1  | Alice | 1000    |
+----+-------+---------+

-- Session B
mysql> INSERT INTO accounts (name, balance) VALUES ('Charlie', 800);
mysql> COMMIT;

-- Session A 再次快照读
mysql> SELECT * FROM accounts WHERE balance > 500;
+----+-------+---------+
| id | name  | balance |
+----+-------+---------+
| 1  | Alice | 1000    |  ← 没有出现 Charlie，防止了幻读
+----+-------+---------+
```

> **深入说明：** RR 级别通过 MVCC 的快照读可以防止大部分幻读场景，但在某些特殊情况下（如先快照读再当前读），仍可能出现幻读。InnoDB 通过 **Next-Key Lock**（临键锁）机制来彻底解决幻读问题。

## Undo Log 版本链与 Purge 机制

### 版本链（Version Chain）

每行数据在更新时，旧版本数据不会被立即删除，而是写入 undo log 中。多个版本通过 `roll_pointer` 指针串成一个链表，形成**版本链**：

```
当前行 (v4, trx_id=400)
    ↓ roll_pointer
undo log (v3, trx_id=300)
    ↓ roll_pointer
undo log (v2, trx_id=200)
    ↓ roll_pointer
undo log (v1, trx_id=100)
```

事务读取数据时，从当前版本开始沿版本链查找第一个可见的版本。

### Undo Log 版本链遍历详解

当事务通过 ReadView 判断当前版本不可见时，会沿着 `roll_pointer` 指针在 undo log 版本链上逐个向前查找，直到找到第一个可见的版本。

**遍历过程示例：**

假设当前系统状态如下：

```
系统活跃事务列表（m_ids）: [200, 300]
ReadView: {m_ids=[200,300], min_trx_id=200, max_trx_id=301, creator_trx_id=100}

当前行数据:
┌──────────────────────────────────────────────────┐
│  name='Alice', balance=3000, trx_id=400          │ ← 当前版本
│  roll_pointer ──→ undo log                       │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│  undo log: balance=2500, trx_id=300              │ ← 版本2
│  roll_pointer ──→ undo log                       │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│  undo log: balance=2000, trx_id=250              │ ← 版本3
│  roll_pointer ──→ undo log                       │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│  undo log: balance=1000, trx_id=100              │ ← 版本4（最早版本）
│  roll_pointer → NULL                             │
└──────────────────────────────────────────────────┘
```

**遍历步骤：**

```
Step 1: 读取当前版本 → trx_id=400
        判断: 400 >= max_trx_id(301) → 不可见 ❌
        原因: 该版本在 ReadView 创建后才产生，属于"未来"的事务
        沿 roll_pointer 找到版本2

Step 2: 读取版本2 → trx_id=300
        判断: min_trx_id(200) <= 300 < max_trx_id(301)，在范围内
              300 在 m_ids=[200,300] 中 → 不可见 ❌
        原因: 事务300还未提交
        沿 roll_pointer 找到版本3

Step 3: 读取版本3 → trx_id=250
        判断: min_trx_id(200) <= 250 < max_trx_id(301)，在范围内
              250 不在 m_ids=[200,300] 中 → 可见 ✅
        原因: 事务250已经提交
        → 返回 balance=2000

最终结果: 该事务读到 balance=2000（版本3的数据）
```

> **性能提示：** 版本链越长，遍历的代价越大。长事务会阻止 purge 清理旧版本，导致版本链不断增长，查询性能逐渐下降。因此，在生产环境中应尽量**避免长事务**，控制事务的执行时间。

### Purge（清理）机制

undo log 不能无限增长，否则会导致文件膨胀。MySQL 有一个后台 **purge 线程**负责清理不再需要的旧版本：

1. 当没有任何事务需要访问某个旧版本时（即所有活跃事务的 ReadView 中的 `min_trx_id` 都大于该版本的 `trx_id`），该版本就可以被清除。
2. purge 操作会同时清理 undo log 和历史链表中对应的数据。
3. `innodb_purge_threads` 参数控制 purge 线程数（默认4）。
4. `innodb_max_purge_lag` 参数可用来控制 purge 延迟，防止大量 DML 操作导致 undo log 膨胀。

## 隔离级别对比表

| 特性 | Read Uncommitted | Read Committed (RC) | Repeatable Read (RR) | Serializable |
|------|:---:|:---:|:---:|:---:|
| 脏读 | ❌ 会脏读 | ✅ 防止 | ✅ 防止 | ✅ 防止 |
| 不可重复读 | ❌ 会发生 | ❌ 会发生 | ✅ 防止 | ✅ 防止 |
| 幻读 | ❌ 会发生 | ❌ 会发生 | ⚠️ MVCC+Lock防止 | ✅ 防止 |
| 使用 MVCC 快照读 | ❌ 不使用 | ✅ 使用 | ✅ 使用 | ❌ 退化为串行 |
| ReadView 创建时机 | 不创建 | 每次SELECT | 事务首次SELECT | 不创建 |
| 并发性能 | 最高 | 较高 | 高 | 最低 |
| 实际应用场景 | 极少使用 | 部分互联网业务 | **MySQL默认级别** | 金融级一致性 |

## 生产环境常见陷阱与真实案例

理解 MVCC 的理论机制只是第一步，在实际生产环境中，很多棘手的 Bug 都源于对 MVCC 行为的误解。以下是几个高频踩坑场景：

### 陷阱一：RR 级别下的幻读（快照读 + 当前读混合使用）

很多开发者误以为 RR 级别能**完全**防止幻读，但实际上只有纯快照读的场景才能保证。一旦事务中混合使用了快照读和当前读，幻读依然可能出现：

```sql
-- Session A（RR 级别）
mysql> SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
mysql> BEGIN;
mysql> SELECT * FROM accounts WHERE balance >= 500;
+----+---------+---------+
| id | name    | balance |
+----+---------+---------+
|  1 | Alice   |    1000 |
+----+---------+---------+
-- 此时只有一行满足条件

-- Session B（另一个终端）
mysql> INSERT INTO accounts (name, balance) VALUES ('Bob', 600);
mysql> COMMIT;

-- Session A 继续执行（注意：这里用了 UPDATE 而非 SELECT！）
mysql> UPDATE accounts SET balance = balance + 100 WHERE balance >= 500;
Query OK, 2 rows affected   -- ⚠️ 影响了2行！Bob 的行也被更新了

-- Session A 再次查询
mysql> SELECT * FROM accounts WHERE balance >= 500;
+----+---------+---------+
| id | name    | balance |
+----+---------+---------+
|  1 | Alice   |    1100 |
|  2 | Bob     |     700 |  -- 幻读出现了！
+----+---------+---------+
```

**原因分析：** `UPDATE` 是当前读，会读取最新的已提交数据，因此 Session A 的 UPDATE 操作"看到"了 Session B 插入的 Bob 行并对其进行了修改。由于该行已被 Session A 自身的事务修改过（`trx_id` 变成了 Session A 的事务ID），后续的快照读（SELECT）也能看到它——幻读就此产生。

**解决方案：** 如果业务要求严格防止幻读，在首次查询时就使用当前读并配合间隙锁：

```sql
mysql> BEGIN;
mysql> SELECT * FROM accounts WHERE balance >= 500 FOR UPDATE;
-- 这会加上 Next-Key Lock，阻止其他事务在 balance >= 500 的范围内插入新行
```

### 陷阱二：长事务导致 undo log 膨胀

undo log 的清理（purge）依赖于"没有活跃事务还需要访问旧版本"这一条件。如果存在长事务，它的 ReadView 会一直持有，导致所有在其之后产生的 undo log 版本都无法被清理：

```sql
-- 终端 A：开启一个长事务（可能是一个报表查询或忘记关闭的事务）
mysql> BEGIN;
mysql> SELECT * FROM huge_table WHERE ...;  -- 查询后忘记 COMMIT

-- 此时终端 A 的 ReadView 中 min_trx_id 非常小
-- 后续所有其他事务产生的 undo log 版本都无法被 purge 线程清理

-- 终端 B、C、D... 大量正常业务操作
mysql> UPDATE orders SET status = 'shipped' WHERE id = 123;
mysql> UPDATE inventory SET stock = stock - 1 WHERE product_id = 456;
-- 这些操作产生的旧版本全部堆积在 undo log 中
```

**后果：**
- undo log 表空间持续膨胀，占用大量磁盘空间
- 查询性能下降，因为版本链越来越长，遍历代价增大
- 严重时可能导致磁盘写满，整个实例不可用

**预防措施：**

```sql
-- 1. 监控长事务
SELECT trx_id, trx_state, trx_started,
       TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration_sec
FROM information_schema.INNODB_TRX
ORDER BY trx_started ASC;

-- 2. 设置事务超时（秒），强制回滚超时事务
SET GLOBAL innodb_lock_wait_timeout = 10;

-- 3. 在应用层面控制事务粒度
-- ❌ 错误做法：在循环中保持长事务
BEGIN;
FOR each item IN large_list:
    UPDATE ...;
END FOR;
COMMIT;

-- ✅ 正确做法：分批提交
FOR each batch IN split(large_list, 1000):
    BEGIN;
    FOR each item IN batch:
        UPDATE ...;
    END FOR;
    COMMIT;
END FOR;
```

### 陷阱三：RC 级别下的不可重复读导致业务逻辑错误

RC 级别下，同一事务中两次读取同一行可能返回不同结果。这在需要"先读后写"的业务场景中极易引发 Bug：

```sql
-- Session A（RC 级别）：检查余额后扣款
mysql> SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
mysql> BEGIN;
mysql> SELECT balance FROM accounts WHERE id = 1;
+---------+
| balance |
+---------+
|    1000 |  -- 读到余额 1000
+---------+

-- 此时 Session B 转出了 800 元
mysql> UPDATE accounts SET balance = 200 WHERE id = 1;
mysql> COMMIT;

-- Session A 继续执行扣款逻辑（没有重新检查余额）
mysql> UPDATE accounts SET balance = balance - 500 WHERE id = 1;
mysql> COMMIT;

-- 最终余额：200 - 500 = -300  ❌ 出现负值！
```

**解决方案：**

```sql
-- 方案1：在 UPDATE 的 WHERE 条件中直接加业务约束
UPDATE accounts SET balance = balance - 500
WHERE id = 1 AND balance >= 500;
-- 如果影响行数为 0，说明余额不足

-- 方案2：使用乐观锁（版本号机制）
-- 表结构增加 version 字段
UPDATE accounts SET balance = balance - 500, version = version + 1
WHERE id = 1 AND version = @old_version;
-- 如果影响行数为 0，说明数据已被其他事务修改，需要重试

-- 方案3：使用 SELECT ... FOR UPDATE 加悲观锁
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- 检查余额后执行扣款
UPDATE accounts SET balance = balance - 500 WHERE id = 1;
COMMIT;
```

### 陷阱四：RC 级别下 SELECT 与 UPDATE 读取版本不一致

RC 级别下，`SELECT`（快照读）和 `UPDATE`（当前读）可能读到不同版本的数据：

```sql
-- Session A（RC 级别）
mysql> SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
mysql> BEGIN;
mysql> SELECT balance FROM accounts WHERE id = 1;
-- 输出: 1000

-- Session B: UPDATE accounts SET balance = 2000 WHERE id = 1; COMMIT;

-- Session A（RC 下每次 SELECT 创建新 ReadView，可以看到新值）
mysql> SELECT balance FROM accounts WHERE id = 1;
-- 输出: 2000

-- 但更隐蔽的情况是：
mysql> UPDATE accounts SET remark = 'processed' WHERE balance = 1000;
Query OK, 0 rows affected  -- ⚠️ 影响0行！因为 UPDATE 读到的 balance 已经是 2000 了
```

这种 SELECT 和 UPDATE 读到不同版本的情况在 RC 级别下很常见，容易导致开发者误判数据状态。

## MVCC 实战场景推演

下面通过一个完整的多事务场景，逐步演示 ReadView 的创建和版本可见性判断过程。

### 场景设定

```sql
-- 假设 accounts 表中 id=1 的行当前数据为：
-- (id=1, name='Alice', balance=1000), trx_id=100

-- 系统中当前活跃事务列表：无
```

### 完整推演过程

```
时刻 T1：
  事务 A (trx_id=200) BEGIN; SELECT balance FROM accounts WHERE id=1;
  → 创建 ReadView: {m_ids=[200], min_trx_id=200, max_trx_id=201, creator_trx_id=200}
  → 行的 trx_id=100 < min_trx_id=200 → 可见 ✅ → 返回 balance=1000

时刻 T2：
  事务 B (trx_id=300) BEGIN; UPDATE accounts SET balance=2000 WHERE id=1;
  → 行的 trx_id 更新为 300，旧版本 (balance=1000, trx_id=100) 写入 undo log

时刻 T3：
  事务 A 再次 SELECT balance FROM accounts WHERE id=1;
  → 复用 T1 的 ReadView (RR 级别): {m_ids=[200,300], min_trx_id=200, max_trx_id=301}
  → 行的 trx_id=300，在 m_ids 中 → 不可见 ❌
  → 沿 undo log 链找到旧版本: trx_id=100 < min_trx_id=200 → 可见 ✅ → 返回 balance=1000

时刻 T4：
  事务 B COMMIT; （从活跃列表中移除）

时刻 T5：
  事务 A 再次 SELECT balance FROM accounts WHERE id=1;
  → 复用 T1 的 ReadView (RR 级别): {m_ids=[200], min_trx_id=200, max_trx_id=301}
    注意：300 虽然已提交，但 RR 级别下 ReadView 不会更新！
  → 行的 trx_id=300，300 >= max_trx_id=301? 否，300 < 301
  → 300 在 m_ids 中? m_ids=[200]，300 不在 → 可见 ✅
  
  等等，这里需要修正！在 RR 级别下，ReadView 在 T1 创建后就不再变化。
  T5 时 m_ids 仍然是 [200, 300]（因为 ReadView 创建时的快照不会更新）。
  所以：
  → 行的 trx_id=300，在 m_ids=[200,300] 中 → 不可见 ❌
  → 沿 undo log 链找到旧版本: trx_id=100 < min_trx_id=200 → 可见 ✅ → 返回 balance=1000

  这就是 RR 级别"可重复读"的实现原理！即使事务 B 已经提交，事务 A 依然看到旧值。

时刻 T6（如果是 RC 级别）：
  事务 A 在 T5 重新 SELECT 时会创建新的 ReadView:
  → {m_ids=[200], min_trx_id=200, max_trx_id=301}（300 已提交，不在活跃列表）
  → 行的 trx_id=300，不在 m_ids 中 → 可见 ✅ → 返回 balance=2000
  → RC 级别下看到了事务 B 已提交的新值（不可重复读）
```

## 常见面试题精选

### Q1：MVCC 是如何实现的？

**A：** MVCC 通过三个核心机制实现：
1. **隐藏字段**：每行数据包含 `trx_id`（最后修改的事务ID）和 `roll_pointer`（指向undo log版本链的指针）。
2. **undo log 版本链**：每次更新时将旧版本写入 undo log，通过 roll_pointer 形成链表。
3. **ReadView**：事务执行快照读时生成的一致性视图，包含活跃事务列表，用于判断版本可见性。

### Q2：RC 和 RR 级别下 MVCC 有什么区别？

**A：** 核心区别在于 **ReadView 的创建时机**：
- **RC**：每次 SELECT 都创建新的 ReadView，所以能读到其他事务最新提交的数据。
- **RR**：只在事务第一次 SELECT 时创建 ReadView，后续复用，所以能看到一致性的快照数据。

### Q3：RR 级别能完全防止幻读吗？

**A：** 纯粹靠 MVCC 的快照读可以防止幻读（因为在同一个 ReadView 下，新插入的行不可见）。但如果事务中混合使用了快照读和当前读（如先 `SELECT` 再 `SELECT ... FOR UPDATE`），则可能出现幻读。InnoDB 通过 **Next-Key Lock**（记录锁 + 间隙锁）来彻底防止当前读下的幻读。

### Q4：ReadView 中的 m_ids 是所有事务还是只包含未提交事务？

**A：** `m_ids` 只包含创建 ReadView 时系统中**活跃的（未提交的）**事务ID列表。已提交的事务不在其中。

### Q5：为什么 MVCC 能实现无锁读？

**A：** 因为 MVCC 通过版本链和 ReadView 机制，让每个事务都能读取到符合自己视角的数据版本，而不需要对数据加锁。写操作通过行锁（Record Lock）来保证互斥，读操作通过 MVCC 快照来避免加锁，从而实现读写不阻塞，大大提升了并发性能。

### Q6：undo log 和 redo log 的区别是什么？

**A：**
- **undo log**：记录数据修改前的旧版本，用于事务回滚和 MVCC 版本链构建。是逻辑日志。
- **redo log**：记录数据修改后的物理变更，用于崩溃恢复（crash recovery），保证事务的持久性（Durability）。是物理日志。
- undo log 保证原子性（Atomicity），redo log 保证持久性（Durability），两者配合实现 ACID。

---

> **总结**：MVCC 是 MySQL InnoDB 引擎实现高并发的核心利器，理解 ReadView 的结构与可见性判断算法，以及 RC/RR 两种隔离级别下 ReadView 创建时机的差异，是深入掌握 MySQL 事务机制的关键。配合 undo log 版本链和 purge 清理机制，MVCC 在保证数据一致性的同时，实现了高效的无锁读操作。

## 相关阅读

- [控制并发](/categories/Databases/concurrency-control/) — 全面了解数据库并发控制的理论与实践，涵盖事务隔离级别与 InnoDB 锁机制
- [MySQL的三种日志](/categories/Databases/redo-log-binlog/) — 深入理解 redo log、binlog、undo log 的工作原理与两阶段提交
- [MySQL 面试题速查](/categories/Databases/interview/) — MySQL 高频面试题速答，涵盖索引、事务、MVCC、锁、性能优化
