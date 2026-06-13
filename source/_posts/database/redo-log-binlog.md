---

title: MySQL的三种日志
keywords: [MySQL, 的三种日志, 数据库]
tags:
- MySQL
- binlog
- redo log
- 事务
categories:
  - database
date: 2018-03-20 15:05:07
description: 深入解析MySQL三大核心日志：redo log重做日志、binlog归档日志、undo log回滚日志的工作原理与区别。详解WAL机制、两阶段提交(2PC)、InnoDB崩溃恢复流程、MVCC多版本并发控制原理，附MySQL日志查看SQL命令与五大常见踩坑案例，助你全面掌握MySQL事务一致性保障机制与生产环境日志配置最佳实践。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-008-content-1.jpg
- /images/content/databases-008-content-2.jpg
---



## redo log 重做日志

`redo log`日志也叫做`WAL`技术（`Write- Ahead Logging`），他是一种**先写日志，并更新内存，最后再更新磁盘的技术**，为了就是减少sql执行期间的数据库io操作，并且更新磁盘往往是在Mysql比较闲的时候，这样就大大减轻了Mysql的压力。如果没有WAL机制，每次数据更新都需要随机写入磁盘的各个数据页，磁盘IO性能会成为严重的瓶颈。而通过WAL，我们把随机写变成了顺序写redo log，极大地提升了写入性能。

`redo log`是固定大小，是**物理日志**，属于InnoDB引擎的。所谓物理日志，是指redo log记录的是"某个数据页的某个偏移量处做了什么修改"，而不是记录SQL语句本身。redo log采用环状写日志的形式，即日志空间写满后会从头开始覆盖已刷盘的旧日志，这种设计使得redo log不会无限增长，保证了空间效率：

![图片](/images/redolog.png)

如上图所示：若是四组的redo log文件，一组为1G的大小，那么四组就是4G的大小，其中`write pos`是**记录当前的位置**，有数据写入当前位置，那么write pos就会边写入边往后移。

`check point`记录**擦除的位置**，因为redo log是固定大小，所以当redo log满的时候，也就是`write pos`追上`check point`的时候，需要清除`redo log`的部分数据，清除的数据会被持久化到磁盘中，然后将`check point`向前移动。

`redo log`日志实现了即使在数据库出现异常宕机的时候，重启后之前的记录也不会丢失，这就是`crash-safe`能力。

### redo log 的详细写入流程

当一条数据需要更新时，InnoDB引擎会执行以下步骤：

1. **读取数据页**到Buffer Pool（如果该数据页不在内存中，则需要从磁盘加载到Buffer Pool中）
2. **写入redo log buffer**（在内存中开辟一块日志缓冲区，记录本次数据页的物理修改）
3. **事务提交时**，根据刷盘策略将redo log buffer刷入磁盘（持久化到redo log文件）
4. **后台线程**异步将Buffer Pool中的脏页（已被修改但尚未写入磁盘的数据页）刷回磁盘上的数据文件

这种设计的核心优势在于：事务提交时只需要写redo log（顺序IO，速度快），而真正的脏页刷新由后台线程在数据库空闲时完成（异步IO），这样就将事务的提交延迟降到了最低。

redo log的写入策略由参数`innodb_flush_log_at_trx_commit`控制：

| 值 | 含义 | 安全性 | 性能 |
|---|---|---|---|
| 0 | 每秒将redo log buffer写入OS page cache并调用fsync刷盘 | 可能丢失最近1秒内的已提交事务数据 | 最高，适合对数据安全性要求不高的场景 |
| 1 | 每次事务提交时都调用fsync将redo log刷入磁盘（默认值） | 完全不丢数据，最安全 | 最低，频繁fsync导致IO压力较大 |
| 2 | 每次事务提交时写入OS page cache，由操作系统每秒调用fsync刷盘 | 操作系统崩溃可能丢失1秒数据，MySQL崩溃不丢数据 | 中等，折中方案 |

![MySQL数据库日志与WAL机制](/images/content/databases-008-content-1.jpg)

---

## binlog 归档日志

`binlog`称为**归档日志**，是**逻辑日志**，它属于Mysql的Server层面的日志。与redo log不同，binlog记录的是SQL语句的逻辑变更，而不是数据页的物理修改。binlog是MySQL最基础的日志之一，所有存储引擎都可以使用binlog，它在主从复制、数据恢复、数据审计等场景中扮演着至关重要的角色。binlog主要有三种格式：

| 格式 | 记录内容 | 优点 | 缺点 |
|---|---|---|---|
| **Statement** | 原始SQL语句 | 日志量小 | 某些函数（如UUID()、NOW()）可能导致主从不一致 |
| **Row** | 行数据变更前后的值 | 精确，不会出现不一致 | 日志量大 |
| **Mixed** | 混合模式（默认Statement，遇到不确定函数自动切Row） | 兼顾日志量和安全性 | 仍有极少数边界情况可能不一致 |

**binlog的写入时机**：与redo log不同，binlog是在事务**提交**时才写入的。也就是说，一个事务在执行过程中产生的redo log会实时写入redo log buffer，但binlog只有在事务真正提交时才会一次性写入binlog文件。这也就意味着，binlog不能用于崩溃恢复——因为它在崩溃发生时尚未写入。

此外，binlog还有一个重要特性：它是**追加写**的，即新的日志内容总是追加到文件末尾，不会覆盖旧的日志。当一个binlog文件写满后（默认大小1GB），MySQL会自动切换到一个新的binlog文件。旧的binlog文件可以通过配置的过期策略自动清理，也可以手动删除。

redo log和binlog记录的形式、内容不同，这两者日志都能通过自己记录的内容恢复数据。

之所以这两个日志同时存在，是因为刚开始Mysql自带的引擎MyISAM就没有crash-safe功能的，并且在此之前Mysql还没有InnoDB引擎，Mysql自带的binlog日志只是用来归档日志的，所以InnoDB引擎也就通过自己redo log日志来实现crash-safe功能。

### binlog 与 redo log 的核心区别

| 对比维度 | redo log | binlog |
|---|---|---|
| **归属** | InnoDB引擎层 | MySQL Server层 |
| **日志类型** | 物理日志（记录数据页修改） | 逻辑日志（记录SQL或行变更） |
| **写入方式** | 循环写（固定大小，空间会复用） | 追加写（文件写满切换新文件） |
| **crash-safe** | ✅ 支持 | ❌ 不支持 |
| **用途** | 崩溃恢复 | 主从复制、数据备份、数据恢复 |
| **记录时机** | 事务执行过程中持续写入 | 事务提交时写入 |

![MySQL归档日志与数据备份](/images/content/databases-008-content-2.jpg)

---

## undo log 回滚日志

undo log（回滚日志）是InnoDB实现事务原子性的关键机制。当事务需要回滚时，undo log能够将数据恢复到修改之前的状态。

undo log的主要作用包括以下几个方面：

- **事务回滚**：保证事务的原子性，回滚到事务开始前的状态
- **MVCC（多版本并发控制）**：通过undo log的版本链，实现不同事务间的快照读，保证事务的隔离性
- **异常恢复**：当系统崩溃需要回滚未提交事务时，undo log提供了回滚所需的信息

在InnoDB中，每行数据都隐藏了几个字段，其中`DB_ROLL_PTR`（回滚指针）指向该行对应的undo log记录。通过这个指针，我们可以沿着undo log链向前追溯，获取该行数据的任意历史版本。这就是MVCC能够实现"快照读"的核心原理——读操作不需要加锁，只需要根据事务的隔离级别找到合适的版本即可。

undo log属于**逻辑日志**，记录的是与当前操作**相反**的操作：
- 执行`INSERT`时，undo log记录一条`DELETE`
- 执行`DELETE`时，undo log记录一条`INSERT`
- 执行`UPDATE`时，undo log记录一条相反的`UPDATE`

与redo log类似，undo log也会产生redo log来保证自身的持久性——这是一个容易被忽视的细节。也就是说，undo log的写入也是需要被redo log保护的，这样才能保证在崩溃恢复时，undo log本身是完整可用的。

---

## 三大日志对比总览

| 对比维度 | redo log | binlog | undo log |
|---|---|---|---|
| **层级** | InnoDB引擎层 | MySQL Server层 | InnoDB引擎层 |
| **日志类型** | 物理日志 | 逻辑日志 | 逻辑日志 |
| **写入方式** | 循环写 | 追加写 | 追加写（可清理） |
| **主要作用** | 崩溃恢复（crash-safe） | 主从复制、归档备份 | 事务回滚、MVCC |
| **记录内容** | 数据页的物理修改 | SQL语句或行变更 | 逆操作（回滚操作） |
| **持久化时机** | 事务执行中写入，提交时刷盘 | 事务提交时写入 | 事务执行中写入 |
| **空间管理** | 固定大小循环复用 | 按大小/时间轮转，旧文件可清理 | 提交后由purge线程清理 |
| **是否可关闭** | 不可关闭 | 可关闭（但不建议） | 不可关闭 |

---

## 两阶段提交（2PC）

为了保证redo log和binlog的一致性，InnoDB使用了**两阶段提交（Two-Phase Commit, 2PC）**机制。这是MySQL保证主从数据一致性的核心机制。在生产环境中，如果redo log和binlog不一致，就会导致主库数据和从库数据出现偏差，进而引发严重的数据不一致问题，因此理解2PC的工作原理至关重要。

两阶段提交的流程：

1. **Prepare阶段**：InnoDB将redo log写入磁盘，并标记为`prepare`状态
2. **Commit阶段**：MySQL Server将binlog写入磁盘，然后通知InnoDB将redo log标记为`commit`状态

```
事务执行 → 写redo log (prepare) → 写binlog → 写redo log (commit)
```

**为什么要用两阶段提交？** 假设不用2PC，有两种情况：
- **先写redo log再写binlog**：如果redo log写入成功但binlog写入前崩溃，主库能恢复数据（通过redo log），但从库无法复制这条数据（binlog缺失），导致主从不一致。
- **先写binlog再写redo log**：如果binlog写入成功但redo log写入前崩溃，从库会多出一条数据（binlog已记录），但主库丢失了这条数据（redo log未记录），主从不一致。

如果在两个阶段之间发生崩溃：
- **redo log prepare + binlog完整**：事务提交成功（binlog完整说明已写入）
- **redo log prepare + binlog不完整**：事务回滚（binlog未写入说明提交未完成）

这就是为什么两阶段提交能够保证两种日志的逻辑一致性。

---

## 崩溃恢复流程

当MySQL异常宕机后重启，InnoDB引擎会自动执行崩溃恢复流程。这个流程是完全自动化的，DBA不需要手动干预。InnoDB会执行以下恢复流程：

1. **扫描redo log**，找出所有处于`prepare`状态的事务
2. **检查对应的binlog**是否完整（通过XID事务ID匹配）
3. 如果binlog完整 → **提交事务**（将redo log标记为commit）
4. 如果binlog不完整 → **回滚事务**（利用undo log回滚）

```
MySQL重启 → 扫描redo log → 找到prepare状态的事务
  → 对比binlog（通过XID匹配）
    → binlog完整 → 提交（redo log标记commit）
    → binlog不完整 → 回滚（undo log回滚数据）
```

这个机制保证了：即使在任何时刻MySQL崩溃，重启后数据都不会出现不一致的情况。这也是InnoDB相比MyISAM最核心的优势之一——MyISAM没有redo log和undo log，崩溃后很可能出现数据损坏，需要手动修复表。

**实际案例**：在高并发写入场景下，如果MySQL因为OOM（内存溢出）被操作系统kill，InnoDB的崩溃恢复机制通常能在几秒到几十秒内完成恢复，保证所有已提交事务的数据都不会丢失。这个恢复速度取决于redo log中需要重做的事务数量。

---

## MySQL 日志查看命令

### 查看 redo log 相关配置

```sql
-- 查看redo log文件配置
SHOW VARIABLES LIKE 'innodb_log%';

-- 查看redo log刷盘策略
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit';

-- 查看redo log写入量（用于监控IO压力）
SHOW GLOBAL STATUS LIKE 'Innodb_os_log_written';
```

### 查看 binlog 相关操作

```sql
-- 查看binlog是否开启
SHOW VARIABLES LIKE 'log_bin';

-- 查看binlog格式
SHOW VARIABLES LIKE 'binlog_format';

-- 查看所有binlog文件列表
SHOW BINARY LOGS;

-- 查看当前正在写入的binlog
SHOW MASTER STATUS;
```

```bash
# 使用mysqlbinlog工具解析binlog内容
# 解析指定binlog文件
mysqlbinlog --no-defaults mysql-bin.000001

# 解析指定时间范围的binlog
mysqlbinlog --no-defaults --start-datetime="2024-01-01 00:00:00" \
  --stop-datetime="2024-01-02 00:00:00" mysql-bin.000001

# 解析指定position范围（精确定位误操作）
mysqlbinlog --no-defaults --start-position=154 \
  --stop-position=1024 mysql-bin.000001
```

### 查看 undo log 相关信息

```sql
-- 查看undo log表空间配置
SHOW VARIABLES LIKE 'innodb_undo%';

-- 查看undo log的使用情况
SELECT * FROM information_schema.INNODB_TRX;

-- 查看purge线程状态（undo log清理）
SHOW VARIABLES LIKE 'innodb_purge_threads';
```

---

## 常见踩坑案例

### 1. binlog格式选择不当导致主从不一致

**场景**：使用Statement格式的binlog，主库执行了包含`NOW()`、`UUID()`、`RAND()`等不确定函数的SQL语句。例如`INSERT INTO orders (order_no, created_at) VALUES (UUID(), NOW())`。

**问题**：从库回放时会产生与主库不同的结果，导致主从数据不一致。这在金融系统中是不可接受的，可能会导致账目对不上。

**解决方案**：生产环境建议使用`ROW`格式的binlog，虽然日志量大但最安全。

```sql
-- 设置binlog格式为ROW
SET GLOBAL binlog_format = 'ROW';
```

### 2. 两阶段提交失败导致数据丢失

**场景**：MySQL在redo log prepare完成后、binlog写入前发生了崩溃。例如服务器突然断电，或者MySQL进程被kill -9强制终止。

**分析**：此时redo log处于prepare状态但binlog不存在。重启后InnoDB检查发现binlog不完整，会回滚该事务。这是正确的行为，不会导致数据不一致。但是客户端会收到连接断开的错误，应用层需要做好重试机制。

**注意**：如果关闭了binlog（单机环境），redo log直接记录为commit状态，不走两阶段提交。

### 3. redo log空间不足导致性能抖动

**场景**：redo log文件设置过小（例如默认的48MB），在高并发写入场景下，write pos频繁追上check point，导致InnoDB被迫同步刷脏页。

**症状**：数据库出现周期性的性能抖动，每隔几秒就会有一次明显的写入延迟飙升。大量脏页需要紧急刷盘，导致正常请求也受到影响。

**解决方案**：

```sql
-- 适当增大redo log文件大小（MySQL 8.0.30之前）
SHOW VARIABLES LIKE 'innodb_log_file_size';
-- 建议设置为总Buffer Pool大小的25%左右

-- MySQL 8.0.30+ 使用innodb_redo_log_capacity统一管理
SHOW VARIABLES LIKE 'innodb_redo_log_capacity';
SET GLOBAL innodb_redo_log_capacity = 2147483648; -- 2GB
```

### 4. undo log膨胀导致磁盘空间不足

**场景**：应用代码中开启了事务但忘记提交（例如异常处理不当），或者有慢查询长时间占用事务。此时undo log无法被purge线程清理，因为MVCC需要保留这些版本供其他事务读取。随着时间推移，undo log会持续膨胀，最终导致磁盘空间耗尽。

**排查**：

```sql
-- 查看是否有长时间运行的事务
SELECT trx_id, trx_state, trx_started, 
       TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration
FROM information_schema.INNODB_TRX 
ORDER BY trx_started ASC;
```

**解决方案**：避免长事务，及时提交或回滚。设置合理的超时参数：

```sql
SET GLOBAL innodb_lock_wait_timeout = 50; -- 锁等待超时（秒）
```

### 5. 主从复制中binlog格式切换导致复制中断

**场景**：生产环境中在线将binlog格式从Statement切换为Row，但此时从库正在回放旧格式的binlog。

**问题**：MySQL在复制过程中要求binlog格式保持一致，如果主库切换了格式但切换点前后的binlog格式混合存在，从库可能无法正确解析，导致复制中断。

**解决方案**：

```sql
-- 在主库和从库上同时设置（建议在低峰期操作）
SET GLOBAL binlog_format = 'ROW';
-- 确保所有从库都应用新格式后，再进行下一步操作
SHOW SLAVE STATUS\G
```

**最佳实践**：在搭建新的主从集群时就统一使用ROW格式，避免在线切换带来的风险。

---

## 总结

MySQL的三大日志各司其职、缺一不可，它们共同构成了MySQL事务处理和数据可靠性的基石：

- **redo log**：保证崩溃恢复（crash-safe），是InnoDB引擎的核心能力。它将随机写转变为顺序写，大幅提升了数据库的写入性能，同时通过WAL机制保证了数据的持久性。
- **binlog**：用于主从复制和数据备份，是MySQL Server层的归档机制。所有存储引擎都支持binlog，它是MySQL高可用架构（主从复制、MGR等）的基础。
- **undo log**：支持事务回滚和MVCC，是事务原子性和隔离性的基础。通过版本链机制实现了无锁读，是InnoDB高并发性能的关键因素之一。

三者通过**两阶段提交（2PC）**机制协同工作，保证了MySQL在任何异常情况下都能维护数据的一致性。理解这三种日志的工作原理，是掌握MySQL事务机制和故障排查的关键。

在日常开发和运维中，建议重点关注以下参数的配置：

```sql
-- 核心日志参数检查清单
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit'; -- 建议生产环境设为1
SHOW VARIABLES LIKE 'binlog_format';                    -- 建议设为ROW
SHOW VARIABLES LIKE 'sync_binlog';                      -- 建议设为1（与redo log配合实现双1配置）
SHOW VARIABLES LIKE 'innodb_log_file_size';             -- 建议设置为Buffer Pool的25%
```

所谓**"双1配置"**（`innodb_flush_log_at_trx_commit=1` + `sync_binlog=1`）是MySQL数据安全性的最高保障，适合对数据一致性要求极高的金融、电商等核心业务系统。

---

## 相关阅读

- [MySQL - 锁](/categories/Databases/locking/)
- [MySQL主从复制与读写分离](/categories/Databases/replication/)
- [数据库索引优化实战](/categories/Databases/index-optimization-explain/)
