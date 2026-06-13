---

title: MySQL 索引概念详解：为什么需要索引与索引类型
keywords: [MySQL, 索引概念详解, 为什么需要索引与索引类型]
tags:
- MySQL
- 索引
- B+Tree
- InnoDB
- 数据库
categories:
- database
date: 2017-03-20 15:05:07
description: MySQL 索引是数据库性能优化的核心技术，本质上是一种基于 B+Tree 等数据结构的排序存储机制，能够将查询时间复杂度从 O(n) 降低到 O(log n)。本文深入讲解索引的定义与原理、B+Tree 结构图解、InnoDB 与 MyISAM 索引实现差异、索引创建与使用示例、EXPLAIN 执行计划分析，以及常见面试题解答，帮助开发者全面掌握 MySQL 索引的核心知识。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-index-1-content-1.jpg
- /images/content/databases-index-1-content-2.jpg
---




## 什么是索引？

索引是一种特殊的文件（InnoDB 数据表上的索引是表空间的一个组成部分），它们包含着对数据表里所有记录的引用指针。

**索引是一种数据结构。** 数据库索引，是数据库管理系统中一个排序的数据结构，以协助快速查询、更新数据库表中数据。

更通俗地说，索引就相当于**目录**。为了方便查找书中的内容，通过对内容建立索引形成目录。而且索引是一个文件，它是要占据物理空间的。

![B树数据结构示意图](/images/content/databases-index-1-content-1.jpg)

MySQL 索引的建立对于 MySQL 的高效运行是很重要的，索引可以大大提高 MySQL 的检索速度。

![MySQL数据库索引优化](/images/content/databases-index-1-content-2.jpg)

比如我们在查字典的时候，前面都有检索的拼音和偏旁、笔画等，然后找到对应字典页码，这样然后就打开字典的页数就可以知道我们要搜索的某一个 key 的全部值的信息了。

---

## 索引的核心原理

### 为什么需要索引？

没有索引时，数据库必须执行**全表扫描**（Full Table Scan），逐行检查数据是否满足条件。假设表有 100 万行数据，查询需要读取所有 100 万行，时间复杂度为 **O(n)**。

有了索引后，数据库通过 B+Tree 数据结构快速定位目标数据，时间复杂度降低到 **O(log n)**。对于 100 万行数据，仅需约 20 次磁盘 I/O 即可定位到目标记录。

### 索引的代价

| 方面 | 影响 |
|------|------|
| 存储空间 | 每个索引都需要额外的磁盘空间 |
| 写入性能 | INSERT、UPDATE、DELETE 操作需要同时维护索引 |
| 维护成本 | 索引越多，数据变更时的开销越大 |

---

## B+Tree 数据结构详解

MySQL（InnoDB）索引的实现通常使用 **B+Tree**（B+ 树），它是 B 树的变种，也是目前关系型数据库中最主流的索引数据结构。

### B+Tree 结构图

```
                    [30 | 60]                          ← 根节点（非叶子节点）
                   /    |    \
          [10|20]    [40|50]    [70|80]                 ← 非叶子节点
         /  |  \    /  |  \    /  |  \
       10  20  30  40  50  60  70  80  90              ← 叶子节点（存储数据或主键）
        ↕   ↕   ↕   ↕   ↕   ↕   ↕   ↕   ↕
       ←————— 叶子节点通过双向链表连接 —————→
```

### B+Tree 的核心特性

1. **非叶子节点只存储索引键**，不存储数据，使得每个节点可以容纳更多的键值，树的高度更低
2. **叶子节点存储所有数据**（或主键值），且叶子节点之间通过**双向链表**相连
3. **所有查询都到达叶子节点**，查询性能稳定，不会出现忽快忽慢的情况
4. 树的高度通常为 **2~4 层**，即只需 2~4 次磁盘 I/O

### 为什么不用 Hash 索引、二叉树、红黑树？

| 数据结构 | 缺点 |
|----------|------|
| Hash | 不支持范围查询，仅支持等值查询 |
| 二叉树 | 可能退化为链表，O(n) |
| 红黑树 | 树的高度较高，磁盘 I/O 次数多 |
| B 树 | 非叶子节点也存数据，导致单节点存储键值少，树更高 |
| **B+Tree** | ✅ 矮胖结构，叶子节点链表支持范围查询，性能最优 |

---

## InnoDB 与 MyISAM 索引实现差异

### InnoDB 索引（聚簇索引）

InnoDB 使用**聚簇索引**（Clustered Index），数据文件本身就是按主键组织的 B+Tree：

- **主键索引（聚簇索引）**：叶子节点存储的是**完整的行数据**
- **二级索引（辅助索引）**：叶子节点存储的是**主键值**，查询时需要**回表**

```
InnoDB 主键索引（聚簇索引）:
┌─────────────────────┐
│      非叶子节点       │    存储主键值
├─────────────────────┤
│   叶子节点            │    存储完整行数据
└─────────────────────┘

InnoDB 二级索引:
┌─────────────────────┐
│      非叶子节点       │    存储索引列值
├─────────────────────┤
│   叶子节点            │    存储主键值（需要回表）
└─────────────────────┘
```

### MyISAM 索引（非聚簇索引）

MyISAM 使用**非聚簇索引**（Non-Clustered Index），索引和数据是分离的：

- **主键索引和二级索引结构相同**：叶子节点存储的都是**数据行的物理地址（指针）**
- 所有索引地位平等，都指向数据文件中行的物理位置

```
MyISAM 索引:
┌─────────────────────┐
│      非叶子节点       │    存储索引列值
├─────────────────────┤
│   叶子节点            │    存储数据行的物理地址
└─────────────────────┘
         │
         ↓ 指向
┌─────────────────────┐
│     数据文件 (.MYD)   │    独立存储行数据
└─────────────────────┘
```

### 对比总结

| 特性 | InnoDB | MyISAM |
|------|--------|--------|
| 索引类型 | 聚簇索引 | 非聚簇索引 |
| 数据存储位置 | 主键索引叶子节点 | 独立的 .MYD 文件 |
| 主键查询速度 | 极快（直接获取数据） | 快（通过指针定位） |
| 二级索引查询 | 需要回表 | 直接指向数据 |
| 事务支持 | ✅ 支持 | ❌ 不支持 |
| 行级锁 | ✅ 支持 | ❌ 仅表锁 |
| 外键 | ✅ 支持 | ❌ 不支持 |

---

## 索引的类型

MySQL 中常见的索引类型包括：

| 索引类型 | 说明 | 语法 |
|----------|------|------|
| 主键索引 | 唯一且不为 NULL | `PRIMARY KEY (col)` |
| 唯一索引 | 列值唯一，允许 NULL | `UNIQUE INDEX idx_name (col)` |
| 普通索引 | 基本索引，无约束 | `INDEX idx_name (col)` |
| 全文索引 | 用于全文搜索 | `FULLTEXT INDEX idx_name (col)` |
| 组合索引 | 多列联合索引 | `INDEX idx_name (col1, col2)` |
| 前缀索引 | 对字符串前 N 个字符建索引 | `INDEX idx_name (col(N))` |

---

## 创建索引的代码示例

### 使用 CREATE INDEX

```sql
-- 创建普通索引
CREATE INDEX idx_user_name ON users (user_name);

-- 创建唯一索引
CREATE UNIQUE INDEX idx_email ON users (email);

-- 创建组合索引
CREATE INDEX idx_name_age ON users (user_name, age);

-- 创建前缀索引（取前 10 个字符）
CREATE INDEX idx_addr ON users (address(10));
```

### 使用 ALTER TABLE

```sql
-- 添加主键索引
ALTER TABLE users ADD PRIMARY KEY (id);

-- 添加普通索引
ALTER TABLE users ADD INDEX idx_user_name (user_name);

-- 添加唯一索引
ALTER TABLE users ADD UNIQUE INDEX idx_email (email);

-- 添加组合索引
ALTER TABLE users ADD INDEX idx_name_age (user_name, age);

-- 删除索引
ALTER TABLE users DROP INDEX idx_user_name;

-- 使用 DROP INDEX 语句
DROP INDEX idx_user_name ON users;
```

### 查看索引

```sql
-- 查看表的索引信息
SHOW INDEX FROM users;

-- 查看建表语句（包含索引定义）
SHOW CREATE TABLE users;
```

---

## 索引使用示例与 EXPLAIN 分析

### 示例表结构

```sql
CREATE TABLE employees (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(50) NOT NULL,
    age         INT NOT NULL,
    department  VARCHAR(50) NOT NULL,
    salary      DECIMAL(10,2) NOT NULL,
    email       VARCHAR(100),
    INDEX idx_name (name),
    INDEX idx_dept_age (department, age)
) ENGINE=InnoDB;
```

### 查询示例

```sql
-- 示例 1：使用单列索引
EXPLAIN SELECT * FROM employees WHERE name = '张三';

-- 示例 2：使用组合索引（最左前缀）
EXPLAIN SELECT * FROM employees WHERE department = '技术部' AND age = 25;

-- 示例 3：范围查询
EXPLAIN SELECT * FROM employees WHERE department = '技术部' AND age > 20;
```

### EXPLAIN 输出解读

```
+----+-------------+-----------+------+---------------+--------------+---------+-------+------+-------+
| id | select_type | table     | type | possible_keys | key          | key_len | ref   | rows | Extra |
+----+-------------+-----------+------+---------------+--------------+---------+-------+------+-------+
|  1 | SIMPLE      | employees | ref  | idx_name      | idx_name     | 152     | const |    1 | NULL  |
+----+-------------+-----------+------+---------------+--------------+---------+-------+------+-------+
```

关键字段说明：

| 字段 | 含义 | 优化目标 |
|------|------|----------|
| `type` | 访问类型 | 从优到差：system > const > eq_ref > ref > range > index > ALL |
| `key` | 实际使用的索引 | 应该与预期一致 |
| `rows` | 预估扫描行数 | 越小越好 |
| `Extra` | 额外信息 | `Using index` 表示覆盖索引，`Using filesort` 需要优化 |

### 常见 type 值说明

- **const**：通过主键或唯一索引精确匹配一行
- **ref**：使用普通索引精确匹配
- **range**：索引范围扫描（如 `BETWEEN`、`>`、`IN`）
- **index**：全索引扫描
- **ALL**：全表扫描（需要优化！）

---

## 常见面试题

### Q1：为什么 MySQL 使用 B+Tree 而不是 B-Tree？

**答：** B+Tree 相比 B-Tree 有三个关键优势：
1. **非叶子节点不存数据**，同样大小的磁盘页可以存储更多的索引键，树的高度更低，磁盘 I/O 更少
2. **叶子节点通过双向链表连接**，天然支持范围查询和排序操作
3. **查询性能稳定**，所有查询都到达叶子节点，时间复杂度一致为 O(log n)

### Q2：什么是回表？如何避免回表？

**答：** 在 InnoDB 中，二级索引叶子节点存储的是主键值。当查询需要获取主键以外的列时，需要根据主键值回到聚簇索引中再次查找完整数据，这个过程叫做**回表**。

**避免回表的方法：** 使用**覆盖索引**（Covering Index），即查询的所有列都包含在索引中，这样可以直接从索引获取数据，无需回表。

```sql
-- 需要回表：SELECT * 包含了不在索引中的列
EXPLAIN SELECT * FROM employees WHERE name = '张三';

-- 覆盖索引：查询列都在索引 idx_name 中（InnoDB 自动包含主键）
EXPLAIN SELECT id, name FROM employees WHERE name = '张三';
-- Extra 显示 Using index
```

### Q3：什么是最左前缀原则？

**答：** 对于组合索引 `(a, b, c)`，查询条件必须从最左列开始匹配才能使用索引：

```sql
-- ✅ 可以使用索引
WHERE a = 1
WHERE a = 1 AND b = 2
WHERE a = 1 AND b = 2 AND c = 3

-- ❌ 不能使用索引
WHERE b = 2
WHERE c = 3
WHERE b = 2 AND c = 3
```

### Q4：索引在什么情况下会失效？

**答：** 常见的索引失效场景包括：
1. 对索引列使用函数或运算：`WHERE YEAR(create_time) = 2023`
2. 隐式类型转换：`WHERE varchar_col = 123`
3. 使用 `LIKE '%xxx'` 左模糊匹配
4. 使用 `OR` 连接非索引列条件
5. 使用 `!=` 或 `NOT IN`（部分场景）
6. 组合索引未遵循最左前缀原则
7. `IS NULL` 或 `IS NOT NULL`（取决于数据分布和优化器判断）

### Q5：聚簇索引和非聚簇索引的区别？

**答：**

| 对比项 | 聚簇索引（InnoDB） | 非聚簇索引（MyISAM） |
|--------|--------------------|--------------------|
| 数据存储 | 索引叶子节点存储完整数据 | 索引叶子节点存储数据地址 |
| 主键查询 | 直接获取数据，极快 | 需要通过地址指针跳转 |
| 排序 | 数据物理上按主键排序 | 数据和索引独立存储 |
| 一个表能有几个 | 只能有 1 个 | 可以有多个 |

### Q6：一个表最多能建多少个索引？

**答：** 理论上 InnoDB 一个表最多可以创建 **64 个二级索引**，每个索引最多包含 **16 个列**。但实际开发中不建议建太多索引，通常 5~6 个为宜，因为索引会降低写入性能并占用存储空间。

---

## 相关阅读

本系列的其他文章，帮助你深入理解 MySQL 索引：

- [索引的类型](/databases/index/types/) - 详细介绍主键索引、唯一索引、全文索引等各类索引
- [索引采用的算法](/databases/index/b-tree/) - 深入分析 B-Tree 和 B+Tree 算法
- [索引底层实现](/databases/index/implementation/) - 索引在存储引擎中的底层实现原理
- [聚簇索引与非聚簇索引](/databases/index/clustered-vs-nonclustered/) - 对比两种索引组织方式
- [覆盖索引（Covering Index）](/databases/index/covering-index/) - 利用覆盖索引优化查询性能
- [索引回表](/databases/index/index-lookup/) - 理解回表机制及其优化
- [索引的最左前缀原则](/databases/index/leftmost-prefix-rule/) - 组合索引的使用规则
- [索引下推](/databases/index/index-condition-pushdown/) - MySQL 5.6+ 的索引下推优化
- [创建索引](/databases/index/creation/) - 索引创建的最佳实践
- [索引创建的原则](/databases/index/creation-principles/) - 何时该建索引、如何设计索引
- [索引的优缺点](/databases/index/pros-and-cons/) - 权衡索引的利弊
- [索引失效的 12 种原因](/databases/index/ineffective-cases/) - 避免索引失效的常见陷阱
- [前缀索引](/databases/index/prefix-index/) - 字符串字段的索引优化方案
- [MySQL索引数据结构原理](/databases/index/red-black-tree/) - 深入索引数据结构
- [MySQL 複雜查詢性能優化實戰](/databases/index/mysql-joinexplain/) - 多表 JOIN 与 EXPLAIN 联合分析
- [Laravel + MySQL 索引性能调研笔记](/databases/index/laravel-mysql-index-explain-index/) - EXPLAIN 分析、覆盖索引、最左前缀原则实践
