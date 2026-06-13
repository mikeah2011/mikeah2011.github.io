---

title: MySQL 存储引擎对比：InnoDB vs MyISAM vs Memory
keywords: [MySQL, InnoDB vs MyISAM vs Memory, 存储引擎对比]
tags:
- MySQL
- InnoDB
- MyISAM
- 存储引擎
- B+树
- 数据库
categories:
- database
date: 2020-03-20 15:05:07
description: 全面解析MySQL存储引擎InnoDB与MyISAM的核心区别，涵盖事务支持、锁机制、索引结构、B+树实现、MVCC多版本并发控制等关键特性对比。深入讲解InnoDB Buffer Pool、Change Buffer、Redo Log等架构组件，并对比Memory、CSV、Archive等其他存储引擎的适用场景，提供MySQL 8.0+存储引擎选型决策指南与代码示例。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-011-content-1.jpg
- /images/content/databases-011-content-2.jpg
---


> InnoDB和MyISAM的区别

（1）InnoDB和MyISAM都是Mysql的存储引擎，现在MyISAM也逐渐被InnoDB给替代，主要因为InnoDB支持事务和行级锁，MyISAM不支持事务和行级锁，MyISAM最小锁单位是表级。因为MyISAM不支持行级锁，所以在并发处理能力上InnoDB会比MyISAM好。

（2） 数据的存储上：MyISAM的索引也是由B+树构成，但是树的叶子结点存的是行数据的地址，查找时需要找到叶子结点的地址，再根据叶子结点地址查找数据。

![MySQL存储引擎对比](/images/content/databases-011-content-1.jpg)

![图片](/images/6340.png)

InnoDB的主键索引的叶子结点直接就是存储行数据，查找主键索引树就能获得数据：

![图片](/images/6240.png)

若是根据非主键索引查找，非主键索引的叶子结点存储的就是，当前索引值以及对应的主键的值，若是联合索引存储的就是联合索引值和对应的主键值。

![图片](/images/6140.png)

（3）数据文件构成：MyISAM有三种存储文件分别是扩展名为：`.frm`（文件存储表定义）、`.MYD` (MYData数据文件)、`.MYI` (MYIndex索引文件)。而InnoDB的表只受限于操作系统文件的大小，一般是2GB

（4）查询区别：对于读多写少的业务场景，MyISAM会更加适合，而对于update和insert比较多的场景InnoDB会比较适合。

（5）count(\*)区别：`select count(*) from table`，MyISAM引擎会查询已经保存好的行数，这是不加where的条件下，而InnoDB需要全表扫描一遍，InnoDB并没有保存表的具体行数。

（6）其它的区别：InnoDB支持外键，但是不支持全文索引，而MyISAM不支持外键，支持全文索引，InnoDB的主键的范围比MyISAM的大。

![MySQL数据存储技术](/images/content/databases-011-content-2.jpg)

> 总结

|            | MyISAM                                                       | InnoDB                                                       |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 默认       | 不支持                                                       | 支持                                                         |
| 事务       | 不支持                                                       | 支持                                                         |
| 外键       | 不支持                                                       | 支持                                                         |
| 聚集索引   | 不支持                                                       | 支持                                                         |
| 索引和数据 | 分开存储                                                     | 存储在一起                                                   |
| MVCC       | 不支持                                                       | 支持                                                         |
| 备份       | 不支持                                                       | 在线热备                                                     |
| 全文索引   | 支持                                                         | 不支持                                                       |
| 主键范围   | 小                                                           | 大                                                           |
| 并发能力   | 低                                                           | 高(通过MVCC来支持)                                           |
| 锁粒度     | 表锁                                                         | 行锁、表锁、页锁                                             |
| 查询       | 读多写少                                                     | 更新和插入较多的场景                                         |
| 行数       | 保存                                                         | 不保存                                                       |
| 崩溃恢复   | 慢，易丢失                                                   | 概率低                                                       |
| 数据文件   | `.frm`（文件存储表定义）<br />`.MYD` (MYData数据文件)<br />`.MYI` (MYIndex索引文件) | `.frm`<br />`.ibd`<br />只受限于操作系统文件的大小<br />一般是2GB |

## InnoDB 架构详解

InnoDB 是 MySQL 5.5+ 的默认存储引擎，其内部架构设计非常精巧，主要由以下核心组件构成：

### Buffer Pool（缓冲池）

Buffer Pool 是 InnoDB 最重要的内存组件，用于缓存磁盘上的数据页和索引页，减少磁盘 I/O。其工作原理如下：

- **读取**：当查询需要某条记录时，InnoDB 会先在 Buffer Pool 中查找对应的数据页。如果命中（Buffer Hit），直接从内存返回；如果未命中（Buffer Miss），则从磁盘读取数据页并加载到 Buffer Pool。
- **修改**：所有数据修改操作（INSERT、UPDATE、DELETE）都是在 Buffer Pool 中的数据页上完成的，修改后的页称为**脏页（Dirty Page）**。
- **刷脏**：后台线程会定期将脏页刷新回磁盘，这个过程叫做刷脏（Flush）。InnoDB 使用 **LSN（Log Sequence Number）** 来管理刷脏顺序，确保数据一致性。

Buffer Pool 的大小通过 `innodb_buffer_pool_size` 参数控制，生产环境通常设置为物理内存的 60%~80%。

```sql
-- 查看 Buffer Pool 状态
SHOW ENGINE INNODB STATUS\G
-- 查看 Buffer Pool 大小
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
```

Buffer Pool 内部使用改进的 **LRU（Least Recently Used）** 算法，将链表分为两部分：
- **Young 区（热数据）**：最近频繁访问的数据页
- **Old 区（冷数据）**：新加载的数据页

这种设计避免了全表扫描等操作污染整个 Buffer Pool。

### Change Buffer（变更缓冲）

Change Buffer 是针对**非唯一二级索引页**的优化组件。当修改的数据页不在 Buffer Pool 中时，InnoDB 不会立即从磁盘读取该页，而是将变更操作缓存在 Change Buffer 中，等到后续读取该索引页时再合并（Merge）。

这对于**写多读少**的场景有显著的性能提升，可以减少随机磁盘 I/O。通过 `innodb_change_buffer_max_size` 控制 Change Buffer 占 Buffer Pool 的最大比例（默认 25%）。

```sql
-- 查看 Change Buffer 配置
SHOW VARIABLES LIKE 'innodb_change_buffer%';
```

> **注意**：唯一索引的写入需要立即检查唯一性约束，因此不会使用 Change Buffer。

### Adaptive Hash Index（自适应哈希索引）

InnoDB 会监控对索引的查询模式，如果发现某些索引页被频繁访问且模式固定，会自动在内存中建立**哈希索引**，将 B+ 树的查找从 O(log n) 优化为 O(1)。

```sql
-- 查看 AHI 状态
SHOW ENGINE INNODB STATUS\G
-- 在 SEMAPHORES 部分可以看到 AHI 的使用情况
SHOW VARIABLES LIKE 'innodb_adaptive_hash_index';
```

AHI 在等值查询（如 `WHERE id = 123`）场景下效果显著，但在范围查询场景下不会被触发。可以通过 `innodb_adaptive_hash_index` 参数动态开启或关闭。

### Redo Log 与 Undo Log

- **Redo Log（重做日志）**：记录数据页的物理修改，用于崩溃恢复，确保事务的**持久性（Durability）**。InnoDB 采用 **WAL（Write-Ahead Logging）** 机制，事务提交时先写 Redo Log，再写数据页。
- **Undo Log（回滚日志）**：记录数据修改前的逻辑状态，用于事务回滚和 MVCC 多版本读取，保证事务的**原子性（Atomicity）**和**隔离性（Isolation）**。

## SHOW CREATE TABLE 示例

通过 `SHOW CREATE TABLE` 可以查看表使用的存储引擎以及其他关键配置：

```sql
-- 创建一个 InnoDB 表
CREATE TABLE `orders` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` tinyint(4) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

```sql
-- 查看建表语句
SHOW CREATE TABLE orders\G
```

输出结果：

```
*************************** 1. row ***************************
       Table: orders
Create Table: CREATE TABLE `orders` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` tinyint(4) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

```sql
-- MyISAM 表示例（适用于日志、归档等场景）
CREATE TABLE `access_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `url` varchar(2048) NOT NULL,
  `ip` varchar(45) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FULLTEXT KEY `ft_url` (`url`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
```

## MySQL 8.0+ 存储引擎新变化

MySQL 8.0 对存储引擎架构做出了多项重要调整：

### InnoDB 成为默认系统引擎

MySQL 8.0 将 InnoDB 作为 `mysql` 系统数据库的默认引擎，取代了之前版本中的 MyISAM。`mysql` 库中的用户表、权限表等核心系统表全部迁移至 InnoDB，这意味着：

- **原子 DDL**：所有数据定义语言操作（CREATE、ALTER、DROP）均为原子操作，DDL 失败时能安全回滚
- **数据字典**：InnoDB 存储的数据字典替代了旧版的 `.frm` 文件，表定义元数据统一存储在 InnoDB 表空间中
- **事务性系统表**：权限管理、统计信息等操作支持事务一致性

### 独立表空间（file-per-table）

MySQL 5.6.6+ 默认启用 `innodb_file_per_table`，每张表独立一个 `.ibd` 文件。MySQL 8.0 强制执行此策略，不再支持共享表空间模式。这带来更好的数据管理灵活性，便于单表备份、恢复和清理磁盘空间。

### 移除缓冲池元数据页预加载

MySQL 8.0 移除了 `innodb_change_buffer_max_size` 的旧默认值调整逻辑，优化了 Change Buffer 的合并策略，提高了写密集型负载的性能。

### 自适应哈希索引分区

MySQL 8.0 将 AHI 从单一分区扩展为多分区（默认 8 个），在高并发场景下减少了锁竞争，提升了 AHI 的并发性能。

```sql
-- 查看 AHI 分区配置
SHOW VARIABLES LIKE 'innodb_adaptive_hash_index_parts';
```

### 其他重要变化

| 变化 | 说明 |
| --- | --- |
| 不可见索引 | 支持 `ALTER TABLE ... ALTER INDEX ... INVISIBLE`，可标记索引为不可见进行测试 |
| 降序索引 | InnoDB 真正支持降序索引存储，而非反转顺序 |
| 即时 DDL | 部分 `ALTER TABLE` 操作（如添加列）不需要复制全表数据 |
| 共享表空间撤回 | 不再支持将所有表的数据存储在单个 `ibdata1` 文件中 |

```sql
-- MySQL 8.0 Instant DDL 示例：添加列瞬间完成（不锁表、不复制数据）
ALTER TABLE orders ADD COLUMN note VARCHAR(200) DEFAULT '' ALGORITHM=INSTANT;

-- 查看 DDL 操作是否支持 Instant
ALTER TABLE orders ADD COLUMN priority TINYINT DEFAULT 0, ALGORITHM=INSTANT;

-- 不可见索引：安全测试索引删除的影响
ALTER TABLE orders ALTER INDEX idx_user_id INVISIBLE;
-- 观察查询性能变化后，决定是否真正删除
ALTER TABLE orders ALTER INDEX idx_user_id VISIBLE;
-- 或者确认无影响后删除
-- DROP INDEX idx_user_id ON orders;
```

> **MySQL 8.0.24+ 重要变更**：InnoDB 引入了 `DOUBLEWRITE` 的改进实现，将旧版的双写缓冲区从系统表空间移至独立的 `#innodb_doublewrite` 目录，降低了系统表空间的 I/O 瓶颈。

## 存储引擎选择指南

不同业务场景适合不同的存储引擎，以下是常见的选型建议：

### 选择 InnoDB 的场景

- **OLTP 业务系统**：电商订单、支付交易等需要事务支持的场景
- **高并发读写**：行级锁 + MVCC 支持高并发访问
- **数据一致性要求高**：外键约束、崩溃恢复能力保证数据完整性
- **需要在线备份**：支持热备（如 Xtrabackup）

### 选择 MyISAM 的场景

- **读多写少的日志/统计表**：MyISAM 的读取性能在纯读场景下略优
- **全文索引需求**（MySQL 5.6 之前）：早期版本 MyISAM 的全文索引更成熟
- **空间数据（GIS）**：MyISAM 支持空间数据类型和索引
- **数据仓库中间表**：批量导入、只读分析的临时中间表

### 其他存储引擎简介

| 引擎 | 事务 | 锁粒度 | 外键 | 全文索引 | 崩溃恢复 | 存储方式 | 典型场景 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **InnoDB** | ✅ 支持 | 行锁/表锁 | ✅ 支持 | ✅ 5.6+ | ✅ 优秀 | 聚簇索引，数据与主键索引在一起 | OLTP、电商、支付 |
| **MyISAM** | ❌ 不支持 | 表锁 | ❌ 不支持 | ✅ 支持 | ❌ 较差 | 非聚簇，数据与索引分离 | 只读日志、全文搜索（旧版） |
| **Memory** | ❌ 不支持 | 表锁 | ❌ 不支持 | ❌ 不支持 | ❌ 重启丢失 | 内存哈希/ B树 | 临时表、会话缓存、实时排行 |
| **CSV** | ❌ 不支持 | 表锁 | ❌ 不支持 | ❌ 不支持 | ❌ 无 | 纯文本 CSV 文件 | 数据交换、日志导出、ETL 中间态 |
| **Archive** | ❌ 不支持 | 行锁（插入） | ❌ 不支持 | ❌ 不支持 | ❌ 无 | 高压缩 zlib | 历史归档、审计日志、冷数据存储 |
| **NDB Cluster** | ✅ 支持 | 行锁 | ✅ 支持 | ❌ 不支持 | ✅ 优秀 | 分布式内存 + 磁盘 | 高可用集群、电信级应用 |
| **BLACKHOLE** | ❌ 不支持 | 表锁 | ❌ 不支持 | ❌ 不支持 | ❌ 无 | 不存储数据 | 复制过滤、日志中继 |
| **Federated** | 取决于远端 | 取决于远端 | ❌ 不支持 | ❌ 不支持 | ❌ 无 | 远程数据库代理 | 跨库查询（性能差，慎用） |

> **现代 MySQL 最佳实践**：除非有明确的特殊需求，否则应始终使用 InnoDB。MySQL 8.0 已将 InnoDB 作为唯一支持的事务引擎，MyISAM 在未来版本中可能被逐步移除。

## 性能基准对比

以下是一个简化的基准测试数据（基于 MySQL 8.0、单机环境、10 万行数据量）：

| 操作类型 | InnoDB | MyISAM | 说明 |
| --- | --- | --- | --- |
| 单行 SELECT（主键） | ~0.2ms | ~0.15ms | 差距很小 |
| 单行 SELECT（索引） | ~0.3ms | ~0.25ms | MyISAM 略快 |
| 全表扫描 COUNT(*) | ~80ms | ~0.05ms | MyISAM 保存行数，巨大优势 |
| 单行 INSERT | ~0.5ms | ~0.3ms | MyISAM 无事务开销 |
| 单行 UPDATE（索引列） | ~0.8ms | ~15ms | InnoDB 行锁 vs MyISAM 表锁 |
| 并发 100 UPDATE/s | ~1200 QPS | ~85 QPS | InnoDB 行锁优势巨大 |
| 批量 INSERT 1000 行 | ~120ms | ~60ms | MyISAM 无 WAL 开销 |
| 事务回滚 | 支持 | 不支持 | InnoDB 独有能力 |

> **关键结论**：
> - 单线程纯读场景，两者差距不大，MyISAM 略快
> - 并发写入场景，InnoDB 性能远超 MyISAM（行锁 vs 表锁）
> - `COUNT(*)` 无 WHERE 条件时，MyISAM 有天然优势（维护行数计数器）
> - 现代 SSD 存储已经大幅缩小了两者的 I/O 差距，事务和并发才是选型的关键因素

## 常见踩坑案例

### 案例 1：MyISAM 表锁导致的雪崩

```sql
-- 场景：一张 MyISAM 的 session 表，高并发下大量 UPDATE
-- 问题：所有 UPDATE 串行排队，QPS 从 2000 骤降到 50
UPDATE user_sessions SET last_active = NOW() WHERE session_id = 'xxx';

-- 解决：迁移到 InnoDB
ALTER TABLE user_sessions ENGINE = InnoDB;
-- 迁移后行锁生效，QPS 恢复到 1500+
```

### 案例 2：COUNT(*) 性能差异误导选型

```sql
-- 开发者发现 MyISAM 的 COUNT(*) 极快，将统计表改为 MyISAM
-- 但后来需要在该表上做并发更新，表锁导致严重阻塞
-- 教训：COUNT(*) 的优势不能抵消表锁的劣势

-- InnoDB 下的替代方案：维护计数器或使用近似值
SELECT TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME = 'your_table' AND TABLE_SCHEMA = 'your_db';
```

### 案例 3：误用 Memory 引擎丢失数据

```sql
-- 场景：将用户购物车数据存在 Memory 引擎表中
CREATE TABLE cart_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  product_id INT NOT NULL
) ENGINE = Memory;

-- 问题：MySQL 重启后购物车全部清空！
-- 解决：改用 InnoDB，或使用 Redis 作为购物车存储
```

### 案例 4：CHARSET 不一致导致索引失效

```sql
-- 表是 utf8mb4，但连接用 latin1 查询
-- 导致隐式字符集转换，索引无法命中
SET NAMES utf8mb4;  -- 确保连接字符集与表一致

-- 验证方式
EXPLAIN SELECT * FROM orders WHERE user_name = '张三';
-- type 列如果是 ALL 说明全表扫描，检查字符集是否匹配
```

### 案例 5：Archive 引擎误用于需要 UPDATE 的场景

```sql
-- Archive 不支持 UPDATE 和 DELETE，只能 INSERT 和 SELECT
-- 如果需要修正历史数据，只能 DROP 后重建
-- 建议：Archive 仅用于追加写入的归档日志，不要存储可能需要修改的数据
```

## 相关阅读

- [MySQL 事务详解](/categories/Databases/transaction/) - 深入理解 InnoDB 事务机制与 ACID 特性
- [MySQL 锁机制](/categories/Databases/locking/) - 行锁、表锁、间隙锁的原理与实践
- [聚簇索引与非聚簇索引](/categories/Databases/index/clustered-vs-nonclustered/) - 理解 InnoDB 索引组织表的底层原理
- [索引采用的算法](/categories/Databases/index/b-tree/) - B+树 vs B-树 vs 红黑树：MySQL 索引数据结构选型
- [SQL语句性能分析工具 - explain](/categories/Databases/explain/) - 用 EXPLAIN 定位慢查询瓶颈与优化策略

