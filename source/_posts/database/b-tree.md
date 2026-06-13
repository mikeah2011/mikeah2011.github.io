---

title: MySQL 索引采用的 B+Tree 算法：原理与磁盘 IO 优化
keywords: [MySQL, Tree, IO, 索引采用的, 算法, 原理与磁盘, 数据库]
tags:
- MySQL
- B+树
- 索引
- 数据结构
- InnoDB
categories:
  - database
date: 2020-03-20 15:05:07
description: 本文深入解析MySQL索引为什么采用B+树作为底层数据结构，详细对比B+树、B-树、红黑树、Hash索引和全文索引的区别，介绍InnoDB中B+树索引的工作原理，包括页大小16KB、三层B+树存储千万级数据的计算过程，附带EXPLAIN输出解读、索引失效踩坑案例和全表扫描vs索引查询性能实验，帮助理解磁盘IO优化与索引性能的关系。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-btree-content-1.jpg
- /images/content/databases-btree-content-2.jpg
---



> 索引为什么采用B+树，而不用B-树，红黑树？

提升查询速度，首先要减少磁盘I/O次数，也就是要降低树的高度。

<!-- more -->

## 为什么需要 B+ 树？

MySQL 的 InnoDB 存储引擎默认使用 B+ 树作为索引的底层数据结构。选择 B+ 树而非其他数据结构（如二叉搜索树、红黑树、B-树等），核心目的是**减少磁盘 I/O 次数**。

磁盘 I/O 是数据库查询中最耗时的操作。数据存储在磁盘上，每次读取需要寻道和旋转延迟，而内存访问速度比磁盘快 10 万倍以上。因此，索引结构的设计目标就是用尽量少的磁盘 I/O 完成数据定位。

## B+ 树的结构详解

### 节点结构

B+ 树是一种多路平衡搜索树，其节点分为两类：

- **内部节点（非叶子节点）**：只存储 `键值 + 指针`，不存储实际数据。每个指针指向一个子节点，键值用于导航搜索方向。
- **叶子节点**：存储所有键值和对应的数据记录（或主键值），并且叶子节点之间通过**双向链表**相连。

```
          [10 | 20]              ← 内部节点（只存键值+指针）
         /    |    \
   [1-9]  [10-19]  [20-29]      ← 叶子节点（存数据）
    ←→      ←→       ←→         ← 双向链表连接
```

### 叶子节点链表

叶子节点之间通过指针形成**有序双向链表**，这是 B+ 树区别于 B-树的关键特征之一。链表使得范围查询（`BETWEEN`、`>`、`<`）非常高效——只需定位到起始叶子节点，然后沿链表顺序扫描即可，无需回溯到父节点。

### 分裂与合并

- **节点分裂**：当一个叶子节点已满（存储的键值数达到阶数 M）时，需要将其分裂为两个节点，并将中间键值提升到父节点。如果父节点也满了，递归分裂。
- **节点合并**：当删除操作导致节点中键值数低于阈值（通常为 ⌈M/2⌉-1）时，会尝试与相邻兄弟节点合并，并从父节点下降一个分隔键。

## B-树 vs B+树 对比

| 特性 | B-树 | B+树 |
|------|------|------|
| 数据存储位置 | 所有节点都存储数据 | 仅叶子节点存储数据 |
| 叶子节点链表 | 无 | 有（双向链表） |
| 非叶子节点大小 | 较大（含数据） | 较小（仅键值+指针） |
| 每节点容纳键数 | 较少 | 较多 |
| 树的高度 | 较高 | 较低（更扁平） |
| 范围查询效率 | 低（需中序遍历） | 高（叶子链表顺序扫描） |
| 等值查询 | 所有节点都可能命中 | 只在叶子节点命中 |
| 磁盘 I/O 次数 | 较多 | 较少 |
| 适用场景 | 文件系统 | 数据库索引 |

**核心区别**：B+ 树的非叶子节点不存储数据，因此每个节点能容纳更多的键值和指针，树更加扁平，磁盘 I/O 更少。

## 红黑树 vs B+树 对比

红黑树是一种自平衡二叉搜索树，常用于内存中的数据结构（如 Java 的 `TreeMap`）。但作为数据库索引，它有明显的局限性：

| 特性 | 红黑树 | B+树 |
|------|--------|------|
| 树的类型 | 二叉树 | 多叉树（M 路） |
| 每个节点子节点数 | 最多 2 个 | 可达数百个 |
| 树的高度 | O(log₂n) | O(logₘn) |
| 千万级数据深度 | 约 20-30 层 | 3-4 层 |
| 磁盘 I/O 次数 | 20-30 次 | 3-4 次 |
| 范围查询 | 需要中序遍历 | 叶子链表高效扫描 |
| 适用场景 | 内存数据结构 | 磁盘数据索引 |

以 1000 万条数据为例：
- 红黑树深度约为 log₂(10⁷) ≈ **23 层**，每层一次磁盘 I/O，需要 23 次。
- B+ 树（假设每个节点 500 个子节点）深度约为 log₅₀₀(10⁷) ≈ **3 层**，只需 3 次磁盘 I/O。

这就是为什么数据库索引选择 B+ 树而非红黑树的根本原因。

## InnoDB 中 B+ 树索引的实际工作原理

### 页的概念

InnoDB 的最小存储单元是**页（Page）**，默认大小为 **16KB**。每次磁盘 I/O 读取的最小单位就是一页。

### 三层 B+ 树能存多少数据？

假设：
- 主键为 `BIGINT`（8 字节），指针大小为 6 字节，每个索引项合计 14 字节
- 每个页能存放的索引项数：16384 ÷ 14 ≈ **1170** 个

**三层 B+ 树的存储能力计算：**

```
第 1 层（根节点）：1 个页 = 1170 个指针
第 2 层（内部节点）：1170 个页 = 1170 × 1170 = 1,368,900 个指针
第 3 层（叶子节点）：1,368,900 个页
```

假设每条用户记录大小为 1KB，每个叶子页可存放 16 条记录：

```
总记录数 = 1,368,900 × 16 ≈ 2190 万条记录
```

**结论**：一棵三层的 B+ 树索引大约可以支持 **2000 万条**数据的查询，且只需 **3 次磁盘 I/O**。这就是 B+ 树作为数据库索引如此高效的原因。

### 聚簇索引与二级索引

- **聚簇索引**：叶子节点存储完整的行数据。InnoDB 的主键索引就是聚簇索引。
- **二级索引**：叶子节点存储主键值。通过二级索引查询时，先找到主键，再通过聚簇索引找到完整行数据，这个过程叫**回表**。

![二叉树结构示意图](/images/content/databases-btree-content-1.jpg)
![B+树与磁盘存储](/images/content/databases-btree-content-2.jpg)

## B+树 vs Hash索引 vs 全文索引

MySQL 支持多种索引类型，不同索引适用于不同的查询场景：

| 特性 | B+树索引 | Hash索引 | 全文索引（FULLTEXT） |
|------|----------|----------|---------------------|
| 存储引擎支持 | InnoDB、MyISAM 等 | Memory、NDB | InnoDB（5.6+）、MyISAM |
| 数据结构 | 多路平衡搜索树 | 哈希表 | 倒排索引 |
| 等值查询 (=) | O(logₘn) | **O(1)** | 不适用 |
| 范围查询 (>, <, BETWEEN) | **高效**（叶子链表） | 不支持 | 不支持 |
| 排序 (ORDER BY) | **高效**（天然有序） | 不支持 | 不支持 |
| 模糊查询 (LIKE 'abc%') | **前缀匹配高效** | 不支持 | 支持自然语言搜索 |
| 最左前缀匹配 | 必须遵守 | 不适用 | 不适用 |
| 索引覆盖 | 支持 | 不支持 | 不支持 |
| NULL 值处理 | 支持 | 不支持（MySQL） | 支持 |
| 适用场景 | 通用场景，OLTP 查询 | 等值查询密集的缓存表 | 文本搜索 |
| InnoDB 默认 | **是** | 自适应哈希索引（自动） | 需手动创建 |

> **注意**：InnoDB 有"自适应哈希索引（Adaptive Hash Index, AHI）"功能，会自动为频繁访问的索引页建立哈希索引加速等值查询。通过 `SHOW ENGINE INNODB STATUS` 可查看 AHI 的命中情况。但 AHI 是内存结构，不持久化，且只对等值查询有效。

## 实用 SQL：查看索引结构与执行计划

### 查看表的索引信息

```sql
-- 查看表的所有索引
SHOW INDEX FROM orders;

-- 查看索引的列信息（从 information_schema）
SELECT
    INDEX_NAME,
    SEQ_IN_INDEX,
    COLUMN_NAME,
    CARDINALITY,
    INDEX_TYPE,
    NON_UNIQUE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_NAME = 'orders'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
```

### EXPLAIN 输出解读

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 1001 AND status = 'paid';
```

典型输出解读：

```
+----+-------------+--------+------+---------------+--------------+---------+-------------+------+-----------------------+
| id | select_type | table  | type | possible_keys | key          | key_len | ref         | rows | Extra                 |
+----+-------------+--------+------+---------------+--------------+---------+-------------+------+-----------------------+
|  1 | SIMPLE      | orders | ref  | idx_uid_stat  | idx_uid_stat | 10      | const,const |   15 | Using index condition |
+----+-------------+--------+------+---------------+--------------+---------+-------------+------+-----------------------+
```

**关键字段解读：**
- **type**：访问类型，从好到差依次为 `system > const > eq_ref > ref > range > index > ALL`。`ALL` 表示全表扫描，需要优化。
- **key**：实际使用的索引。`NULL` 表示没有使用索引。
- **key_len**：索引使用的字节数，可用于判断联合索引使用了几个列。
- **rows**：预估扫描行数，越少越好。
- **Extra**：`Using index` 表示覆盖索引；`Using index condition` 表示索引下推（ICP）；`Using filesort` 和 `Using temporary` 需要关注。

## 索引失效的常见场景（踩坑案例）

了解 B+ 树的工作原理后，可以更好地理解为什么某些写法会导致索引失效：

### 1. 对索引列使用函数或运算

```sql
-- ❌ 索引失效：对索引列使用函数
SELECT * FROM orders WHERE YEAR(create_time) = 2024;

-- ✅ 改写为范围查询
SELECT * FROM orders WHERE create_time >= '2024-01-01' AND create_time < '2025-01-01';

-- ❌ 索引失效：对索引列做运算
SELECT * FROM orders WHERE id + 1 = 100;

-- ✅ 将运算移到右边
SELECT * FROM orders WHERE id = 99;
```

**原理**：B+ 树按原始值排序构建索引，函数或运算改变了值，无法在树中定位。

### 2. 隐式类型转换

```sql
-- phone 是 VARCHAR 类型
-- ❌ 索引失效：传入数字，MySQL 隐式将字符串转为数字比较
SELECT * FROM users WHERE phone = 13800138000;

-- ✅ 使用正确的类型
SELECT * FROM users WHERE phone = '13800138000';
```

**原理**：MySQL 会对字符串列进行 `CAST()` 转换，等同于对索引列使用函数，导致全表扫描。

### 3. LIKE 左模糊匹配

```sql
-- ❌ 索引失效：左模糊
SELECT * FROM products WHERE name LIKE '%手机%';

-- ✅ 右模糊可以使用索引
SELECT * FROM products WHERE name LIKE '手机%';
```

**原理**：B+ 树按前缀有序排列，左模糊无法确定前缀，只能全表扫描。

### 4. 联合索引不满足最左前缀

```sql
-- 联合索引 idx_abc(a, b, c)
-- ❌ 跳过 a，直接查 b
SELECT * FROM t WHERE b = 1;  -- 索引失效

-- ✅ 遵循最左前缀
SELECT * FROM t WHERE a = 1 AND b = 1;  -- 使用索引
```

**原理**：联合索引在 B+ 树中按 `(a, b, c)` 的顺序排列。没有 `a`，无法在树中定位 `b` 的范围。

### 5. OR 条件中有无索引列

```sql
-- 如果 name 没有索引，整个查询不会走索引
SELECT * FROM users WHERE age = 25 OR name = '张三';

-- ✅ 拆分为 UNION
SELECT * FROM users WHERE age = 25
UNION
SELECT * FROM users WHERE name = '张三';
```

## 性能对比实验：全表扫描 vs 索引查询

下面通过一个简单的实验来验证索引对查询性能的巨大影响：

### 准备测试数据

```sql
-- 创建测试表
CREATE TABLE test_index (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    status TINYINT DEFAULT 0,
    amount DECIMAL(10, 2),
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB;

-- 插入 100 万条测试数据（使用存储过程）
DELIMITER //
CREATE PROCEDURE insert_test_data()
BEGIN
    DECLARE i INT DEFAULT 0;
    WHILE i < 1000000 DO
        INSERT INTO test_index (user_id, order_no, status, amount, create_time)
        VALUES (
            FLOOR(RAND() * 100000),
            CONCAT('ORD', LPAD(i, 10, '0')),
            FLOOR(RAND() * 5),
            ROUND(RAND() * 10000, 2),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY)
        );
        SET i = i + 1;
    END WHILE;
END //
DELIMITER ;

CALL insert_test_data();
```

### 对比查询

```sql
-- 场景 1：使用索引列查询
EXPLAIN SELECT * FROM test_index WHERE user_id = 50000;
-- type: ref, key: idx_user_id, rows: ~10

-- 场景 2：无索引列查询（全表扫描）
EXPLAIN SELECT * FROM test_index WHERE order_no = 'ORD000500000';
-- type: ALL, key: NULL, rows: 1000000

-- 场景 3：添加索引后再查询
ALTER TABLE test_index ADD INDEX idx_order_no (order_no);
EXPLAIN SELECT * FROM test_index WHERE order_no = 'ORD000500000';
-- type: ref, key: idx_order_no, rows: 1
```

### 预期结果

| 查询场景 | type | 扫描行数 | 预估耗时 |
|----------|------|----------|----------|
| 有索引（user_id = 50000） | ref | ~10 行 | **< 1ms** |
| 无索引（order_no 查询） | ALL | 100 万行 | **200-500ms** |
| 添加索引后（order_no 查询） | ref | 1 行 | **< 1ms** |

**结论**：在百万级数据表上，使用索引查询比全表扫描快 **100-500 倍**。这就是理解 B+ 树索引原理的实际意义。

## 常见面试题

### 1. MySQL 索引为什么使用 B+ 树而不是 B-树？

**答**：B+ 树的非叶子节点只存储键值和指针，不存储数据，因此每个节点能容纳更多的索引项，树更扁平，磁盘 I/O 更少。此外，B+ 树叶子节点通过链表相连，范围查询效率远高于 B-树。

### 2. 为什么不用红黑树做索引？

**答**：红黑树是二叉树，千万级数据时树深约 23 层，意味着 23 次磁盘 I/O。而 B+ 树是多叉树，同样数据量只需 3-4 层，磁盘 I/O 大幅减少。红黑树更适合内存场景。

### 3. 一棵三层 B+ 树大约能存多少条数据？

**答**：以 BIGINT 主键、1KB 行记录为例，约可存储 2000 万条记录。根节点约 1170 个指针，第二层 1170 页，第三层叶子节点存放实际数据。

### 4. B+ 树的叶子节点链表有什么作用？

**答**：叶子节点通过双向链表连接，使得范围查询（`BETWEEN`、`ORDER BY`、`GROUP BY`）可以直接在叶子层顺序扫描，无需从根节点重新遍历，极大提高了范围查询的效率。

---

## 相关阅读

- [聚簇索引与非聚簇索引——深入理解 B+ 树索引的两种形态](/categories/Databases/clustered-vs-nonclustered/)
- [索引的类型——B-Tree、Hash、全文索引与 R-Tree 详解](/categories/Databases/types/)
- [覆盖索引——减少回表的性能利器](/categories/Databases/covering-index/)
- [创建索引——索引创建方法与最佳实践](/categories/Databases/creation/)
- [MySQL 优化经验总结——EXPLAIN 深度分析与 16 种优化技巧](/categories/Databases/sql-optimization/)
