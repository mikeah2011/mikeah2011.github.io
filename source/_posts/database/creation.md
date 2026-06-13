---

title: MySQL 创建索引的正确姿势：ALTER TABLE vs CREATE INDEX
keywords: [MySQL, ALTER TABLE vs CREATE INDEX, 创建索引的正确姿势, 数据库]
tags:
- MySQL
- 索引
- CREATE INDEX
- B-Tree
- 性能优化
categories:
  - database
date: 2016-10-03 20:15:24
description: MySQL创建索引完全指南：详解CREATE TABLE、ALTER TABLE、CREATE INDEX三种建索引方式的语法与实战示例，深入对比B-Tree、Hash、全文索引、空间索引的性能差异与适用场景，包含索引命名规范、冗余索引检测、索引膨胀修复等最佳实践，以及低选择性列、隐式类型转换等常见性能陷阱，帮助开发者通过科学的索引策略实现数据库查询性能优化。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-001-content-1.jpg
- /images/content/databases-001-content-2.jpg
---



## 1. 在执行 CREATE TABLE 时创建索引

在建表语句中直接定义索引是最简单直观的方式，适合在数据库设计阶段就确定好索引策略的场景。

### 示例：包含多种索引类型的建表语句

```sql
CREATE TABLE user_index (
  id INT AUTO_INCREMENT PRIMARY KEY,          -- 主键索引（自动创建）
  first_name VARCHAR(16),
  last_name VARCHAR(16),
  id_card VARCHAR(18),
  email VARCHAR(64),
  information TEXT,
  KEY idx_name (first_name, last_name),       -- 普通复合索引
  UNIQUE KEY uk_id_card (id_card),            -- 唯一索引
  UNIQUE KEY uk_email (email),                -- 唯一索引
  FULLTEXT KEY ft_info (information)          -- 全文索引
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> **说明**：`PRIMARY KEY` 为主键索引，每张表只能有一个；`UNIQUE KEY` 保证列值唯一；`KEY` 创建普通索引；`FULLTEXT KEY` 用于全文检索（仅 MyISAM 和 InnoDB 引擎支持）。

### 创建单列索引

```sql
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  price DECIMAL(10,2),
  INDEX idx_price (price)
);
```

---

## 2. 使用 ALTER TABLE 命令增加索引

`ALTER TABLE` 适用于对已存在的表添加索引，是最常用的动态创建索引方式。它可以创建普通索引、唯一索引和主键索引。

**语法格式：**

```sql
ALTER TABLE table_name ADD INDEX index_name (column_list);
ALTER TABLE table_name ADD UNIQUE [INDEX] index_name (column_list);
ALTER TABLE table_name ADD PRIMARY KEY (column_list);
ALTER TABLE table_name ADD FULLTEXT [INDEX] index_name (column_list);
```

其中 `table_name` 是要增加索引的表名，`column_list` 指出对哪些列进行索引，多列时各列之间用逗号分隔。索引名 `index_name` 可自行命名，缺省时 MySQL 将根据第一个索引列赋一个名称。`ALTER TABLE` 允许在单个语句中创建多个索引。

### 示例

```sql
-- 添加普通索引
ALTER TABLE user_index ADD INDEX idx_lastname (last_name);

-- 添加唯一索引
ALTER TABLE user_index ADD UNIQUE INDEX uk_email (email);

-- 添加全文索引
ALTER TABLE user_index ADD FULLTEXT INDEX ft_info (information);

-- 添加复合索引（多列索引）
ALTER TABLE user_index ADD INDEX idx_name_card (first_name, last_name, id_card);

-- 单条语句添加多个索引
ALTER TABLE user_index
  ADD INDEX idx_first (first_name),
  ADD INDEX idx_last (last_name);
```

![SQL索引创建](/images/content/databases-001-content-1.jpg)

---

## 3. 使用 CREATE INDEX 命令创建

`CREATE INDEX` 是专门用于创建索引的 DDL 语句，语法更清晰，但功能上是 `ALTER TABLE ... ADD INDEX` 的封装，两者效果相同。

**语法格式：**

```sql
CREATE [UNIQUE|FULLTEXT|SPATIAL] INDEX index_name
  ON table_name (column_list);
```

### 示例

```sql
-- 创建普通索引
CREATE INDEX idx_lastname ON user_index (last_name);

-- 创建唯一索引
CREATE UNIQUE INDEX uk_id_card ON user_index (id_card);

-- 创建全文索引
CREATE FULLTEXT INDEX ft_info ON user_index (information);

-- 创建复合索引
CREATE INDEX idx_name ON user_index (first_name, last_name);

-- 创建降序索引（MySQL 8.0+）
CREATE INDEX idx_price_desc ON products (price DESC);
```

> **注意**：`CREATE INDEX` 不能创建主键索引，主键只能通过 `ALTER TABLE ... ADD PRIMARY KEY` 或在 `CREATE TABLE` 时定义。

---

## 4. 索引类型对比

MySQL 支持多种索引类型，适用于不同的查询场景。选择合适的索引类型是性能优化的第一步。

| 索引类型 | 底层结构 | 适用场景 | 等值查询 | 范围查询 | 排序 | 多列索引 | 说明 |
|---------|---------|---------|---------|---------|------|---------|------|
| **B-Tree / B+Tree** | 平衡多路搜索树 | 等值、范围、排序、分组 | ✅ | ✅ | ✅ | ✅ | InnoDB 默认索引类型，最通用 |
| **Hash** | 哈希表 | 精确等值查询（`=`、`IN`） | ✅ O(1) | ❌ | ❌ | ❌ | Memory 引擎显式支持；InnoDB 自适应哈希索引 |
| **Full-text** | 倒排索引 | 全文文本搜索 | ❌ | ❌ | ❌ | ❌ | 支持自然语言/布尔模式，仅 MyISAM 和 InnoDB 支持 |
| **R-Tree / Spatial** | R-tree 空间索引 | 地理位置、GIS 空间数据 | - | ✅ | ❌ | ❌ | `SPATIAL` 关键字创建，用于空间类型字段 |

### B-Tree 索引的工作原理

B+Tree 是 MySQL InnoDB 中最常用的索引结构。它将数据组织成平衡树，叶子节点通过双向链表相连，支持高效的范围扫描：

```
        [30 | 60]                    ← 根节点（非叶子）
       /    |    \
  [10|20] [40|50] [70|80]           ← 内部节点
   / | \    / | \    / | \
  数据页→数据页→数据页→...           ← 叶子节点（有序 + 链表）
```

> **核心特性**：每次从根到叶的查找路径长度相同，保证了 O(log n) 的查询复杂度。叶子节点之间通过双向链表连接，使范围查询只需在叶子层顺序扫描。

### Hash 索引的限制

Hash 索引虽然在等值查询上有 O(1) 的理论优势，但存在明显局限：

```sql
-- Hash 索引支持：等值匹配
SELECT * FROM users WHERE id = 42;     -- ✅ Hash 索引可用

-- Hash 索引不支持：范围查询
SELECT * FROM users WHERE id > 42;     -- ❌ 无法使用 Hash 索引
SELECT * FROM users WHERE id BETWEEN 10 AND 100;  -- ❌

-- Hash 索引不支持：排序
SELECT * FROM users ORDER BY id;       -- ❌ Hash 索引无序
```

> **提示**：InnoDB 中的自适应哈希索引（AHI）由引擎自动管理，无法手动创建，当某些索引值被频繁访问时会自动在内存中建立哈希映射。

### 实战场景：电商系统索引选择

以一个典型的电商订单系统为例：

```sql
-- 1. 订单号查询 → B-Tree 唯一索引（等值 + 范围均可）
CREATE UNIQUE INDEX uk_order_no ON orders (order_no);

-- 2. 用户订单列表 → B-Tree 复合索引（等值 + 排序）
CREATE INDEX idx_user_time ON orders (user_id, created_at DESC);

-- 3. 商品搜索 → 全文索引（文本匹配）
CREATE FULLTEXT INDEX ft_product_desc ON products (title, description);

-- 4. 附近门店查询 → 空间索引（地理坐标）
CREATE SPATIAL INDEX sp_location ON stores (location);

-- 5. 状态筛选 → B-Tree 普通索引（等值查询 + 低选择性列需配合其他条件）
CREATE INDEX idx_status ON orders (status);
```

---

## 5. 删除索引（DROP INDEX）

当索引不再需要或需要重建时，可以使用 `DROP INDEX` 或 `ALTER TABLE ... DROP` 删除索引。

```sql
-- 方式一：DROP INDEX 语法
DROP INDEX idx_lastname ON user_index;

-- 方式二：ALTER TABLE 语法
ALTER TABLE user_index DROP INDEX idx_name;

-- 删除主键索引（主键没有名称，直接用 PRIMARY 关键字）
ALTER TABLE user_index DROP PRIMARY KEY;
```

> **提示**：删除索引会立即释放该索引占用的磁盘空间，并减少 DML 操作（INSERT/UPDATE/DELETE）的维护开销。

---

## 6. 索引创建的最佳实践

### 命名规范

良好的索引命名能提高可维护性，建议遵循以下约定：

| 索引类型 | 前缀 | 示例 | 说明 |
|---------|------|------|------|
| 普通索引 | `idx_` | `idx_user_name` | 最常用的索引类型 |
| 唯一索引 | `uk_` | `uk_user_email` | 保证列值唯一性 |
| 全文索引 | `ft_` | `ft_article_content` | 用于全文检索 |
| 空间索引 | `sp_` | `sp_store_location` | 用于 GIS 空间查询 |
| 主键索引 | 无需命名 | 自动为 `PRIMARY` | 由 InnoDB 自动管理 |
| 外键索引 | `fk_` | `fk_order_user_id` | 引用关联表的外键列 |

**命名规范详细建议：**

```sql
-- ✅ 推荐：表名缩写 + 列名，语义清晰
CREATE INDEX idx_ord_uid ON orders (user_id);
CREATE INDEX idx_ord_uid_time ON orders (user_id, created_at DESC);
CREATE UNIQUE INDEX uk_user_email ON users (email);

-- ❌ 避免：无意义的自动命名
CREATE INDEX test1 ON orders (user_id);         -- ❌ 不知道什么用途
CREATE INDEX user_id ON orders (user_id);       -- ❌ 与列名冲突

-- ❌ 避免：过长的索引名（MySQL限制64字符）
CREATE INDEX idx_orders_user_id_created_at_status ON orders (user_id, created_at, status);
-- ✅ 改为
CREATE INDEX idx_ord_uid_ctime ON orders (user_id, created_at, status);
```

**多环境管理技巧：**
- 在生产环境部署前，先在开发环境执行 `SHOW CREATE TABLE` 确认索引已正确创建
- 使用 `pt-duplicate-key-checker` 定期扫描冗余索引
- 对大表添加索引前，使用 `pt-online-schema-change` 或 MySQL 8.0+ 的 `ALGORITHM=INPLACE` 避免锁表

### 创建原则

- **选择高选择性列**：取值离散度大的字段（即字段中不同值的比例高）更适合作为索引。可通过 `SELECT COUNT(DISTINCT column) / COUNT(*)` 来评估选择性，比值越接近 1 越适合建索引。
- **非空字段优先**：应将字段指定为 `NOT NULL`。含空值的列会增加索引的复杂度，导致统计信息不准确，影响查询优化器的判断。可以用 `0`、空串或特殊值替代 `NULL`。
- **索引字段越小越好**：数据库以页为单位存储数据（默认 16KB），字段越小，每页能存储的索引条目越多，一次 I/O 操作获取的数据量越大，效率越高。
- **复合索引注意列顺序**：将选择性最高的列放在最前面，遵循最左前缀原则。

---

## 7. 常见陷阱

### ❌ 创建冗余索引

```sql
-- 已有复合索引 idx_name (first_name, last_name)
-- 再创建以下索引就是冗余的，因为 idx_name 已覆盖 first_name
CREATE INDEX idx_first ON user_index (first_name);
```

冗余索引不仅浪费存储空间，还会增加写操作的维护成本。建议定期使用 `pt-duplicate-key-checker`（Percona Toolkit）工具检查冗余索引。

### ❌ 在频繁更新的列上建过多索引

每次 `INSERT`、`UPDATE`、`DELETE` 操作都会导致相关索引的维护，索引越多写入性能下降越明显。

### ❌ 使用 SELECT * 不考虑覆盖索引

查询的列如果完全被某个索引覆盖，MySQL 可以直接从索引中获取数据，避免回表查询，大幅提升性能。设计索引时应考虑常用查询的 `SELECT` 列。

### ❌ 对小表建过多索引

对于数据量很小的表（如几千行），全表扫描的速度可能比走索引还快，此时索引反而会增加不必要的开销。

### ❌ 在低选择性列上单独建索引

```sql
-- ❌ 错误示例：gender 列只有 'M'、'F'、'NULL' 三种值
CREATE INDEX idx_gender ON users (gender);
-- 优化器几乎不会使用此索引，因为区分度太低

-- ✅ 正确做法：将低选择性列作为复合索引的后缀
CREATE INDEX idx_gender_status ON users (gender, status);
```

> **如何判断选择性**：执行 `SELECT COUNT(DISTINCT column) / COUNT(*) FROM table`，比值越接近 1 说明选择性越高。一般选择性 > 0.1 的列才值得单独建索引。

### ❌ 隐式类型转换导致索引失效

```sql
-- 表结构：phone VARCHAR(20)，索引 idx_phone
-- ❌ 传入整数，触发隐式类型转换，索引失效
SELECT * FROM users WHERE phone = 13800138000;

-- ✅ 传入字符串，索引正常生效
SELECT * FROM users WHERE phone = '13800138000';
```

> **注意**：MySQL 会将字符串与整数比较时将字符串转为数字，导致索引列被函数包裹，索引失效。类似的情况还包括对索引列使用 `DATE()`、`YEAR()`、`LOWER()` 等函数。

### ❌ 索引膨胀（Index Bloat）

索引文件随数据增长而膨胀，即使删除了大量数据，索引文件也不会自动收缩，导致查询性能下降和磁盘空间浪费。

```sql
-- 检查索引大小
SELECT
  TABLE_NAME,
  INDEX_NAME,
  STAT_VALUE * @@innodb_page_size / 1024 / 1024 AS index_size_mb
FROM mysql.innodb_index_stats
WHERE database_name = 'your_db'
  AND stat_name = 'size'
ORDER BY stat_value DESC;

-- 修复索引膨胀：重建索引
ALTER TABLE your_table DROP INDEX idx_name, ADD INDEX idx_name (column);
-- 或使用 OPTIMIZE TABLE（会锁表，大表慎用）
OPTIMIZE TABLE your_table;
```

> **线上操作提示**：对于大表，推荐使用 `pt-online-schema-change --alter "ADD INDEX idx_xxx (col)"` 在线重建，避免锁表影响业务。

### ❌ 忽略索引长度限制

```sql
-- TEXT / BLOB 列不能直接作为索引，需要指定前缀长度
-- ❌ 报错：BLOB/TEXT column 'content' used in key specification without a key length
CREATE INDEX idx_content ON articles (content);

-- ✅ 指定前缀长度
CREATE INDEX idx_content (100) ON articles (content);
-- InnoDB 默认前缀长度限制：767 字节（utf8mb4 下约 191 个字符）
```

---

## 8. 索引对性能的影响

### 正面影响

- **加速查询**：索引将全表扫描的 O(n) 复杂度降低为接近 O(log n) 的 B+ 树查找。
- **减少 I/O**：索引数据量远小于表数据，减少磁盘读取次数。
- **优化排序和分组**：如果索引本身有序，`ORDER BY` 和 `GROUP BY` 操作可以利用索引避免额外排序。

### 负面影响

- **占用磁盘空间**：每个索引都需要额外的存储空间，尤其是大表的复合索引。
- **降低写入速度**：每次数据变更都需要同步更新索引，索引越多写入越慢。
- **优化器选择错误**：过多的索引可能导致 MySQL 优化器选择了非最优的执行计划。

> 建议通过 `EXPLAIN` 分析查询执行计划，确认索引是否被正确使用，避免过度索引。

![数据库索引优化](/images/content/databases-001-content-2.jpg)

---

## 相关阅读

- [索引的类型](/categories/Databases/index/types/) — 深入对比 B+Tree、Hash、Full-text、R-Tree/Spatial 四种索引的底层结构与适用场景
- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则](/categories/Databases/index-deep-dive-explain/) — KKday B2C API 真实踩坑记录
- [百万级数据表查询优化实战](/categories/Databases/query-optimization-explain/) — EXPLAIN 深度分析索引重构与分页治理踩坑记录
