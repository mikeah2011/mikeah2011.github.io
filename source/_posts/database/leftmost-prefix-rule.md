---

title: MySQL 联合索引最左前缀原则：查询优化的核心规则
keywords: [MySQL, 联合索引最左前缀原则, 查询优化的核心规则]
tags:
- MySQL
- 索引优化
- 联合索引
- 最左前缀
- EXPLAIN
- 数据库
categories:
- database
date: 2021-03-20 15:05:07
description: 深入解析MySQL索引的最左前缀原则（Leftmost Prefix Rule），这是复合索引查询优化的核心机制。本文通过多个实例详细讲解联合索引的匹配规则，包括等值查询、范围查询、ORDER BY等场景下的索引失效问题，并提供EXPLAIN分析、常见误区和复合索引设计的实用指南，帮助开发者写出高效的SQL查询语句。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-index-2-content-1.jpg
- /images/content/databases-index-2-content-2.jpg
---



## 什么是最左前缀原则

最左前缀原则（Leftmost Prefix Rule）是 MySQL 复合索引（也称联合索引）匹配的核心规则。简单来说，**MySQL 在使用复合索引时，会从索引的最左列开始，依次向右匹配，直到遇到范围查询条件（`>`、`<`、`BETWEEN`、`LIKE`）就停止匹配后续列**。

理解这一原则，是正确设计和使用复合索引的前提。

## 基本原理

假设我们为表建立了 `(a, b, c)` 的复合索引。MySQL 在 B+ 树中会先按 `a` 排序，`a` 相同时按 `b` 排序，`b` 也相同时再按 `c` 排序。因此，只有从最左边的列开始匹配，才能充分利用索引的有序性进行快速查找。

在创建多列索引时，要根据业务需求，将 `WHERE` 子句中使用最频繁的一列放在最左边。

## 复合索引的 B+ Tree 结构

要真正理解最左前缀原则，必须先理解复合索引在 B+ Tree 中是如何存储的。

假设我们有一个复合索引 `(a, b, c)`，其 B+ Tree 结构如下：

```
┌─────────────────────────────────────────────────┐
│                   非叶子节点（索引页）               │
│         [a=1,b=1,c=1] [a=2,b=1,c=3] ...         │
│              /                  \                 │
│     ┌───────────┐        ┌───────────┐           │
│     │  叶子节点1  │        │  叶子节点2  │           │
│     │a=1,b=1,c=1│        │a=2,b=1,c=3│           │
│     │a=1,b=1,c=5│        │a=2,b=1,c=7│           │
│     │a=1,b=2,c=2│        │a=2,b=2,c=1│           │
│     │a=1,b=3,c=9│        │a=2,b=3,c=4│           │
│     └─────┬─────┘        └─────┬─────┘           │
│           │                    │                  │
│           └───── 双向链表 ──────┘                  │
└─────────────────────────────────────────────────┘
```

**关键特征：**

1. **整体有序性**：叶子节点中的数据首先按 `a` 排序，`a` 相同时按 `b` 排序，`b` 也相同时再按 `c` 排序。
2. **局部有序性**：在 `a` 确定的前提下，`b` 是有序的；在 `a` 和 `b` 都确定的前提下，`c` 是有序的。
3. **跨段无序性**：如果不知道 `a` 的值，`b` 在全局范围内是**无序**的；同理，不知道 `a` 和 `b`，`c` 在全局范围也是无序的。

这就是最左前缀原则的本质原因：**跳过最左列直接查询后续列，无法利用 B+ Tree 的有序性，只能退化为全表扫描**。

### key_len 计算规则

`key_len` 是判断索引使用了多少列的关键指标，计算公式如下：

| 数据类型 | 字节数 | 备注 |
|---------|--------|------|
| `INT` | 4 | 固定 4 字节 |
| `BIGINT` | 8 | 固定 8 字节 |
| `CHAR(n)` | n × 字符集字节数 | utf8mb4 = 4 字节/字符 |
| `VARCHAR(n)` | n × 字符集字节数 + 2 | 额外 2 字节存长度 |
| `DATE` | 3 | 固定 3 字节 |
| `DATETIME` | 8 | 固定 8 字节 |
| `TIMESTAMP` | 4 | 固定 4 字节 |
| `NULL` | +1 | 允许 NULL 额外加 1 |

例如索引 `(name VARCHAR(50), age INT, city VARCHAR(50))`，字符集 utf8mb4：
- 只用 `name`：`50 × 4 + 2 + 1 = 203`
- 用 `name + age`：`203 + 4 + 1 = 208`
- 全部使用：`208 + 50 × 4 + 2 + 1 = 411`

（+1 是因为字段允许 NULL，NOT NULL 则不加）

通过对比 `key_len` 的变化，就能精确判断复合索引实际被利用了多少列。

## 索引匹配示例

### 示例表结构

假设有一张用户表和复合索引：

```sql
CREATE TABLE users (
  id INT PRIMARY KEY,
  name VARCHAR(50),
  age INT,
  city VARCHAR(50),
  salary DECIMAL(10,2)
);

ALTER TABLE users ADD INDEX idx_name_age_city (name, age, city);
```

### 匹配规则详解

对于索引 `(name, age, city)`，以下是不同查询的索引使用情况：

```sql
-- ✅ 全部命中：使用了索引的全部三列
SELECT * FROM users WHERE name = 'Alice' AND age = 25 AND city = 'Beijing';

-- ✅ 全部命中：= 和 IN 查询可以乱序，优化器会自动调整顺序
SELECT * FROM users WHERE age = 25 AND city = 'Beijing' AND name = 'Alice';

-- ✅ 部分命中：只使用了 name 这一列
SELECT * FROM users WHERE name = 'Alice';

-- ✅ 部分命中：使用了 name 和 age 两列
SELECT * FROM users WHERE name = 'Alice' AND age = 25;

-- ❌ 索引失效：跳过了最左列 name，无法使用索引
SELECT * FROM users WHERE age = 25;
SELECT * FROM users WHERE city = 'Beijing';
SELECT * FROM users WHERE age = 25 AND city = 'Beijing';

-- ⚠️ 部分命中：name 命中，age 命中，遇到范围查询后 city 停止匹配
SELECT * FROM users WHERE name = 'Alice' AND age > 25 AND city = 'Beijing';

-- ✅ 范围查询在最后列时不影响前面列的匹配
SELECT * FROM users WHERE name = 'Alice' AND age = 25 AND city > 'S';
```

## 索引匹配对照表

下表汇总了常见查询模式与索引 `(a, b, c)` 的匹配关系：

| 查询条件 | 命中的索引列 | 说明 |
|---------|------------|------|
| `WHERE a = 1` | a | 最左列匹配 |
| `WHERE a = 1 AND b = 2` | a, b | 最左两列匹配 |
| `WHERE a = 1 AND b = 2 AND c = 3` | a, b, c | 全部匹配 |
| `WHERE b = 2` | ❌ 无 | 缺少最左列 a |
| `WHERE b = 2 AND c = 3` | ❌ 无 | 缺少最左列 a |
| `WHERE a = 1 AND c = 3` | a | 跳过 b，只匹配 a |
| `WHERE a = 1 AND b > 2 AND c = 3` | a, b | 范围查询后停止匹配 c |
| `WHERE a = 1 AND b = 2 AND c > 3` | a, b, c | 范围查询在最后列，不影响 |
| `WHERE a LIKE 'ab%'` | a | 前缀匹配可使用索引 |
| `WHERE a LIKE '%bc'` | ❌ 无 | 前缀模糊导致索引失效 |
| `WHERE a IN (1,2) AND b = 2` | a, b | IN 等同于等值查询 |

## 用 EXPLAIN 验证索引使用

通过 `EXPLAIN` 可以直观地看到查询是否使用了索引以及使用了索引的哪些部分：

```sql
EXPLAIN SELECT * FROM users WHERE name = 'Alice' AND age = 25 AND city = 'Beijing';
```

```
+----+------+------+------+------------------+------------------+---------+-------------------+------+-------+
| id | type | key  | key_len | ref           | rows | Extra    |
+----+------+------+------+------------------+------------------+---------+-------------------+------+-------+
|  1 | ref  | idx_name_age_city | 157 | const,const,const |    1 |         |
+----+------+------+------+------------------+------------------+---------+-------------------+------+-------+
```

关键字段解读：
- **type**: `ref` 表示使用了非唯一索引查找，优于 `ALL`（全表扫描）
- **key**: 显示实际使用的索引名
- **key_len**: 索引使用的字节长度，数值越大说明利用的索引列越多
- **rows**: 预估扫描行数，越小越好

```sql
-- 查看仅使用最左列时的 key_len
EXPLAIN SELECT * FROM users WHERE name = 'Alice';
-- key_len 较小，说明只用了 name 列

-- 查看使用两列时的 key_len
EXPLAIN SELECT * FROM users WHERE name = 'Alice' AND age = 25;
-- key_len 增大，说明 name 和 age 都被利用

-- 跳过最左列，type 变为 ALL，索引完全失效
EXPLAIN SELECT * FROM users WHERE age = 25;
-- type: ALL, key: NULL — 全表扫描！
```

通过对比 `key_len` 的变化，可以精确判断复合索引中有多少列被实际使用。

## 六大典型场景深度解析

下面通过 6 个最常见的查询场景，结合 EXPLAIN 输出，深入分析最左前缀原则的实际表现。

### 场景一：全列等值匹配

```sql
-- 查询条件：a=1 AND b=2 AND c=3
EXPLAIN SELECT * FROM users WHERE name = 'Alice' AND age = 25 AND city = 'Beijing';
```

```
+----+-------+------------------+---------+-------------------+------+-------------+
| id | type  | key              | key_len | ref               | rows | Extra       |
+----+-------+------------------+---------+-------------------+------+-------------+
|  1 | ref   | idx_name_age_city| 411     | const,const,const |    1 | Using index |
+----+-------+------------------+---------+-------------------+------+-------------+
```

**分析**：三个等值条件全部命中，`key_len = 411`，`ref` 列显示 `const,const,const`，说明三列都被精确匹配。这是最理想的使用方式。

### 场景二：范围查询导致后续列失效

```sql
-- 查询条件：a=1 AND b>10 AND c=3
EXPLAIN SELECT * FROM users WHERE name = 'Alice' AND age > 25 AND city = 'Beijing';
```

```
+----+-------+------------------+---------+------+------+-----------------------+
| id | type  | key              | key_len | ref  | rows | Extra                 |
+----+-------+------------------+---------+------+------+-----------------------+
|  1 | range | idx_name_age_city| 208     | NULL |   12 | Using index condition |
+----+-------+------------------+---------+------+------+-----------------------+
```

**分析**：`name` 等值匹配（key_len = 203），`age` 范围匹配（key_len = 208），但 `city` **没有被索引使用**。虽然 `city = 'Beijing'` 写在了查询条件中，但因为它在范围查询 `age > 25` 之后，无法利用索引的有序性。

**为什么 c 失效？** 在 B+ Tree 中，当 `age > 25` 范围确定后，`age` 的值可能有多种（26, 27, 28...），在每种 `age` 值下 `city` 虽然有序，但跨 `age` 值后 `city` 不再有序。MySQL 无法在索引层面完成 `city = 'Beijing'` 的筛选，只能通过**索引条件下推（ICP）**在索引层过滤，或者回到聚簇索引（回表）后再过滤。

### 场景三：ORDER BY 利用索引排序

```sql
-- 查询条件：WHERE name = 'Alice' ORDER BY age
EXPLAIN SELECT * FROM users WHERE name = 'Alice' ORDER BY age;
```

```
+----+------+------------------+---------+-------+------+-----------------------+
| id | type | key              | key_len | ref   | rows | Extra                 |
+----+------+------------------+---------+-------+------+-----------------------+
|  1 | ref  | idx_name_age_city| 203     | const |   5 | Using index condition |
+----+------+------------------+---------+-------+------+-----------------------+
```

**对比无效场景**：

```sql
-- WHERE name = 'Alice' ORDER BY city（跳过了 age）
EXPLAIN SELECT * FROM users WHERE name = 'Alice' ORDER BY city;
```

```
+----+------+------------------+---------+-------+------+----------------------------+
| id | type | key              | key_len | ref   | rows | Extra                      |
+----+------+------------------+---------+-------+------+----------------------------+
|  1 | ref  | idx_name_age_city| 203     | const |   5 | Using temporary; Using filesort |
+----+------+------------------+---------+-------+------+----------------------------+
```

**分析**：`Using filesort` 说明 MySQL 需要额外的排序操作，因为 `city` 在跳过 `age` 后无法利用索引有序性。而 `ORDER BY age` 可以直接利用索引，因为 `age` 紧随 `name` 之后，在 `name = 'Alice'` 的范围内是天然有序的。

### 场景四：覆盖索引避免回表

```sql
-- SELECT 的列全在索引中，无需回表
EXPLAIN SELECT name, age, city FROM users WHERE name = 'Alice' AND age = 25;
```

```
+----+------+------------------+---------+-------+------+-------------+
| id | type | key              | key_len | ref   | rows | Extra       |
+----+------+------------------+---------+-------+------+-------------+
|  1 | ref  | idx_name_age_city| 208     | const |    1 | Using index |
+----+------+------------------+---------+-------+------+-------------+
```

**分析**：`Extra` 显示 `Using index`，这是**覆盖索引**的标志。MySQL 直接从索引中就能获取到所需的所有列数据，完全不需要回表查询主键索引，性能达到最优。

```sql
-- 对比：SELECT * 需要回表
EXPLAIN SELECT * FROM users WHERE name = 'Alice' AND age = 25;
-- Extra 为空（不含 Using index），说明需要回表获取其他列
```

### 场景五：LIKE 前缀匹配 vs 后缀模糊

```sql
-- ✅ 前缀匹配，可以使用索引
EXPLAIN SELECT * FROM users WHERE name LIKE 'Ali%';
```

```
+----+-------+------------------+---------+------+------+-----------------------+
| id | type  | key              | key_len | ref  | rows | Extra                 |
+----+-------+------------------+---------+------+------+-----------------------+
|  1 | range | idx_name_age_city| 203     | NULL |    3 | Using index condition |
+----+-------+------------------+---------+------+-----------------------+
```

```sql
-- ❌ 后缀模糊，索引完全失效
EXPLAIN SELECT * FROM users WHERE name LIKE '%ice';
```

```
+----+------+------+---------+------+------+-------------+
| id | type | key  | key_len | ref  | rows | Extra       |
+----+------+------+---------+------+------+-------------+
|  1 | ALL  | NULL | NULL    | NULL | 1000 | Using where |
+----+------+------+---------+------+------+-------------+
```

**原理**：`LIKE 'Ali%'` 等价于范围查询 `name >= 'Ali' AND name < 'Alj'`，B+ Tree 可以快速定位到以 `Ali` 开头的连续区间。而 `LIKE '%ice'` 的前缀不确定，B+ Tree 无法做任何定位，只能逐行扫描。

**替代方案**：如果业务需要后缀模糊搜索，可以考虑：MySQL 8.0 的**倒序索引**（`CREATE INDEX idx_name_rev ON users (REVERSE(name))`），或者使用全文索引、Elasticsearch 等方案。

### 场景六：隐式类型转换导致索引失效

```sql
-- name 是 VARCHAR(50) 类型
-- ❌ 用数字查询字符串列，触发隐式类型转换，索引失效
EXPLAIN SELECT * FROM users WHERE name = 123;
```

```
+----+------+------+---------+------+------+-------------+
| id | type | key  | key_len | ref  | rows | Extra       |
+----+------+------+---------+------+------+-------------+
|  1 | ALL  | NULL | NULL    | NULL | 1000 | Using where |
+----+------+------+---------+------+------+-------------+
```

```sql
-- ✅ 类型匹配，正常使用索引
EXPLAIN SELECT * FROM users WHERE name = 'Alice';
```

**原理**：当 `VARCHAR` 列与数字比较时，MySQL 会将该列的每一行值转换为数字再比较（`CAST(name AS DECIMAL)`），这个转换导致 B+ Tree 的有序性被破坏，索引无法使用。

**反向情况**：如果列是 `INT` 类型，用字符串查询 `WHERE id = '123'` 反而**不会**导致索引失效，因为 MySQL 只会把字符串常量 `'123'` 转换为数字 `123`，不会影响列的索引使用。

## 等值查询与范围查询

MySQL 的查询优化器会自动优化等值查询（`=` 和 `IN`）的顺序。例如：

```sql
-- 以下三条语句在索引 (a, b, c) 上效果完全相同
WHERE a = 1 AND b = 2 AND c = 3;
WHERE c = 3 AND a = 1 AND b = 2;
WHERE b = 2 AND a = 1 AND c = 3;
```

但范围查询有本质区别——**遇到范围条件后，后续列无法再利用索引的有序性**：

```sql
-- 索引 (a, b, c)，只利用了 a 和 b
WHERE a = 1 AND b > 2 AND c = 3;

-- 索引 (a, b, c)，a、b、c 全部利用
WHERE a = 1 AND b = 2 AND c > 3;
```

如果业务中需要对 `b` 做范围查询且仍想利用 `c` 列索引，可以考虑将索引调整为 `(a, c, b)` 的顺序。

## 常见误区与陷阱

### 误区一：列的顺序不重要

很多人认为只要查询条件包含索引的所有列，就能使用索引。实际上列的顺序至关重要——**如果查询不包含最左列，索引将完全失效**。

### 误区二：范围查询后还能继续匹配

`WHERE a = 1 AND b > 2 AND c = 3` 中，索引 `(a, b, c)` 只能利用 `a` 和 `b`，`c` 无法参与索引匹配。很多人误以为三列都会被利用。

### 误区三：LIKE 只要包含索引列就能用

`LIKE` 查询只有在使用前缀匹配时才能利用索引。`LIKE '%abc'` 会导致索引完全失效，`LIKE 'abc%'` 才可以正常使用索引。

### 误区四：OR 条件能用最左前缀

```sql
WHERE name = 'Alice' OR age = 25;
```

`OR` 条件通常无法利用复合索引的最左前缀原则，除非每个 OR 分支都能独立使用索引。

## 联合索引在 ORDER BY 中的应用

最左前缀原则不仅适用于 `WHERE`，也适用于 `ORDER BY` 和 `GROUP BY`：

```sql
-- 索引 (name, age, city)

-- ✅ 可以利用索引避免排序
SELECT * FROM users WHERE name = 'Alice' ORDER BY age;

-- ❌ 无法利用索引排序，需要 filesort
SELECT * FROM users WHERE name = 'Alice' ORDER BY city;

-- ❌ 排序方向不一致会导致索引排序失效（MySQL 8.0 之前）
SELECT * FROM users ORDER BY name ASC, age DESC;

-- ✅ MySQL 8.0+ 支持降序索引，上述查询可正常使用索引
```

## 字符串索引的最左前缀

**最左前缀原则可以是联合索引的最左 N 个字段，也可以是字符串索引的最左 M 个字符。**

举个例子，假如现在有一个表的原始数据如下所示：

![图片](/images/最左前缀原则.png)

并根据 `col3, col2` 的顺序建立**联合索引**，此时联合索引树结构如下所示：

![图片](/images/最左前缀原则_1.png)

叶子结点中首先会根据 col3 的字符进行排序，若是 col3 相等，在 col3 相等的值里面再对 col2 进行排序。假如我们要查询 `WHERE col3 LIKE 'Eri%'`，就可以快速地定位查询到 Eric。

若是查询条件为 `WHERE col3 LIKE '%se'`，前面的字符不确定，表示任意字符都可以，这样就会导致全表扫描进行字符的比较，使索引失效。

## 复合索引设计实用指南

以下是一些经过实战检验的联合索引设计原则：

### 原则一：高频等值查询列放最左

将 `WHERE` 中出现频率最高的等值查询列放在索引最左侧。例如，如果 80% 的查询都带 `status = 1` 条件，那么 `status` 应该是复合索引的第一列。

```sql
-- 统计发现最常用的查询模式
SELECT * FROM orders WHERE status = 'paid' AND user_id = 123 AND created_at > '2024-01-01';
-- 推荐索引：(status, user_id, created_at)
-- 而不是 (user_id, status, created_at)
```

### 原则二：范围查询列放右侧

把可能用到范围查询的列放在等值查询列之后，避免阻断后续列的匹配。因为范围查询后面的列无法利用索引的有序性。

```sql
-- 查询模式
WHERE category = 'tech' AND created_at > '2024-01-01' AND author = 'Alice'
-- 推荐索引：(category, author, created_at)
-- 将 author（等值）放在 created_at（范围）前面
-- 这样 author 也能被索引利用
```

### 原则三：覆盖索引优化

如果查询只需要少数几列，尽量让索引包含这些列（`SELECT` 列也在索引中），可以避免回表查询。

```sql
-- 只需要 name 和 age
SELECT name, age FROM users WHERE name = 'Alice';
-- 推荐索引：(name, age) 而不是 (name, age, city)
-- 因为 (name, age) 就能覆盖查询，索引更小更快
```

### 原则四：索引列不宜过多

一般复合索引不超过 3-5 列，过多的列会增加：
- 索引占用的存储空间
- B+ Tree 的层数和分裂开销
- INSERT/UPDATE/DELETE 的维护成本

### 原则五：利用 EXPLAIN 验证

设计索引后务必用 `EXPLAIN` 确认实际使用情况，通过 `key_len` 判断覆盖了哪些列。这是验证索引设计是否合理的最直接手段。

### 原则六：注意隐式类型转换

如果查询条件的类型与索引列类型不匹配（如字符串列用数字查询），会导致索引失效。务必确保 SQL 中的参数类型与列定义一致。

### 原则七：考虑查询的完整模式

不要孤立地为单条 SQL 创建索引。应该分析所有查询的 `WHERE`、`ORDER BY`、`GROUP BY` 和 `SELECT` 列，找到能覆盖最多查询的索引设计。

```sql
-- 如果业务有以下两条核心 SQL：
SELECT * FROM users WHERE name = 'Alice' AND age = 25 ORDER BY city;
SELECT * FROM users WHERE name = 'Alice' ORDER BY age, city;
-- 推荐索引：(name, city) 或 (name, age, city)
-- 需要结合实际数据分布和查询频率来决定
```

### 原则八：避免冗余索引

如果已有索引 `(a, b)`，那么索引 `(a)` 就是冗余的，因为 `(a, b)` 的最左前缀已经包含了 `(a)`。MySQL 8.0+ 提供了冗余索引检测功能：

```sql
-- 安装并使用 sys schema 检测冗余索引
SELECT * FROM sys.schema_redundant_indexes;
```

## MySQL 8.0 索引跳跃扫描（Index Skip Scan）

MySQL 8.0.13 引入了**索引跳跃扫描（Index Skip Scan）**，这是对传统最左前缀原则的一个重要补充。

### 传统限制回顾

对于复合索引 `(a, b, c)`，查询 `WHERE b = 2` 在 MySQL 8.0 之前会完全无法使用索引（跳过了最左列 `a`）。

### Index Skip Scan 的优化

MySQL 8.0+ 在某些场景下，即使跳过了最左列，也能通过"跳跃扫描"使用索引：

```sql
-- 复合索引：(a, b, c)
-- 查询：跳过最左列 a
SELECT * FROM users WHERE b = 2 AND c = 3;
```

**工作原理**：MySQL 优化器会自动枚举 `a` 列的所有可能值（假设 `a` 列的基数/去重值较少），然后对每个值分别在 B+ Tree 中查找 `b = 2 AND c = 3`。本质上等价于：

```sql
-- 优化器自动改写为
SELECT * FROM users WHERE a = 1 AND b = 2 AND c = 3
UNION ALL
SELECT * FROM users WHERE a = 2 AND b = 2 AND c = 3
UNION ALL
SELECT * FROM users WHERE a = 3 AND b = 2 AND c = 3
-- ... 枚举所有 a 的值
```

### 生效条件

Index Skip Scan **并非在所有场景下都有效**，它需要同时满足以下条件：

1. 跳过的最左列（`a`）的**基数（distinct 值）较小**——如果 `a` 有上百万个不同值，枚举成本太高，优化器不会选择 Skip Scan
2. 索引的第二列（`b`）使用了等值查询或 IN 查询
3. 查询是单表查询（多表 JOIN 时不适用）

### 验证是否使用了 Skip Scan

```sql
EXPLAIN SELECT * FROM users WHERE b = 2;
-- 如果 Extra 列显示 "Using index for skip scan"，说明触发了跳跃扫描
```

### 实际建议

虽然 Index Skip Scan 是一项优化，但**不应依赖它来设计索引**：
- 它的适用场景有限（要求最左列基数小）
- 性能不如正确的最左前缀匹配
- 合理设计索引仍然应该是第一选择

## EXPLAIN 各字段含义速查表

在分析索引使用时，EXPLAIN 是最常用的工具。以下是各核心字段的含义和关注要点：

| 字段 | 含义 | 关注要点 |
|------|------|---------|
| `id` | 查询的序号 | 相同 id 从上到下执行，不同 id 大的先执行 |
| `select_type` | 查询类型 | `SIMPLE`（简单查询）、`PRIMARY`（外层查询）、`DERIVED`（子查询） |
| `table` | 访问的表 | 可能是表别名或 `<derivedN>`（子查询结果） |
| `partitions` | 命中的分区 | NULL 表示未使用分区 |
| `type` | 访问类型 | **性能从优到差**：`system > const > eq_ref > ref > range > index > ALL` |
| `possible_keys` | 可能使用的索引 | 优化器考虑过的候选索引 |
| `key` | 实际使用的索引 | **最重要的字段**——NULL 表示未使用索引 |
| `key_len` | 索引使用字节数 | 越大说明利用的索引列越多，可判断命中了几个列 |
| `ref` | 索引引用的值 | `const`（常量）、列名、`NULL` |
| `rows` | 预估扫描行数 | 越小越好，估算值 |
| `filtered` | 按条件过滤后的行比例 | 100% 表示所有行都满足条件 |
| `Extra` | 额外信息 | 见下方详解 |

### type 访问类型详解

| type | 说明 | 是否需要优化 |
|------|------|------------|
| `system` | 表只有一行（系统表） | 不需要 |
| `const` | 主键或唯一索引的等值查询 | 最优 |
| `eq_ref` | 多表 JOIN 中使用主键或唯一索引 | 优秀 |
| `ref` | 非唯一索引的等值查询 | 良好 |
| `range` | 索引范围查询（`>`、`<`、`BETWEEN`、`IN`） | 一般可以接受 |
| `index` | 全索引扫描 | 可能需要优化 |
| `ALL` | 全表扫描 | **必须优化** |

### Extra 常见值

| Extra 值 | 含义 | 是否有利 |
|-----------|------|---------|
| `Using index` | 覆盖索引，无需回表 | ✅ 最优 |
| `Using index condition` | 使用了索引条件下推（ICP） | ✅ 良好 |
| `Using where` | Server 层过滤 | ⚠️ 可以接受 |
| `Using temporary` | 使用临时表 | ⚠️ 需要优化 |
| `Using filesort` | 使用文件排序 | ⚠️ 需要优化 |
| `Select tables optimized away` | 直接从索引获取聚合结果 | ✅ 最优 |

## 索引失效的完整 Checklist

在进行 SQL 性能排查时，可以按照以下 checklist 逐一排查索引失效的原因：

### 🔴 一级检查（常见原因）

- [ ] **查询条件是否包含最左列**？跳过最左列会导致复合索引完全失效
- [ ] **是否有隐式类型转换**？字符串列用数字查询，或使用了函数如 `WHERE DATE(create_time) = '2024-01-01'`
- [ ] **是否使用了 OR 条件**？`OR` 两侧的列无法同时利用复合索引
- [ ] **LIKE 是否以 `%` 开头**？`LIKE '%abc'` 无法使用 B+ Tree 定位
- [ ] **WHERE 中是否包含函数运算**？如 `WHERE YEAR(create_time) = 2024`、`WHERE id + 1 = 10` 等

### 🟡 二级检查（进阶原因）

- [ ] **范围查询后面的列是否需要**？范围查询会阻断后续列的索引使用
- [ ] **ORDER BY / GROUP BY 的列是否与 WHERE 条件同序**？不一致会导致额外排序
- [ ] **SELECT 的列是否超出索引范围**？`SELECT *` 会导致回表，可能放弃索引
- [ ] **数据分布是否倾斜**？当优化器判断索引效率不高时，会选择全表扫描（如查询返回超过 30% 的行）
- [ ] **是否使用了 NOT IN、NOT EXISTS、!=**？这些条件通常无法使用索引

### 🟢 三级检查（环境因素）

- [ ] **统计信息是否准确**？过期的统计信息会导致优化器做出错误判断，可执行 `ANALYZE TABLE` 更新
- [ ] **MySQL 版本是否支持相关优化**？如 Index Skip Scan 需要 8.0.13+
- [ ] **索引是否被禁用**？某些情况下索引可能被 `ALTER TABLE ... DISABLE KEYS` 禁用
- [ ] **查询涉及的表是否太小**？小表时优化器倾向全表扫描（数据都在 Buffer Pool 中）
- [ ] **是否有 FORCE INDEX / USE INDEX 提示**？手动指定了错误的索引

### 快速修复命令

```sql
-- 更新表统计信息
ANALYZE TABLE users;

-- 查看索引信息
SHOW INDEX FROM users;

-- 查看冗余索引（MySQL 8.0+）
SELECT * FROM sys.schema_redundant_indexes;

-- 查看未使用的索引（MySQL 8.0+）
SELECT * FROM sys.schema_unused_indexes;

-- 查看索引碎片化情况
SELECT table_name, data_free, data_length, index_length
FROM information_schema.tables
WHERE table_schema = 'your_db' AND data_free > 0;
```

## 常见面试题及详细解答

### 面试题一：复合索引 (a, b, c)，查询 WHERE b=1 AND a=2 能用到索引吗？

**答：能。** MySQL 的查询优化器会自动调整等值查询条件的顺序，重新排列为 `a=2 AND b=1`，从而匹配复合索引的最左前缀。因此 `WHERE b=1 AND a=2` 和 `WHERE a=2 AND b=1` 的索引使用效果完全相同。

但需要注意，如果 `a` 是范围查询（如 `a > 2`），那么写成 `WHERE b=1 AND a > 2` **不会**被优化器重排为 `a > 2 AND b=1`——因为 `a > 2` 是范围条件，不是等值条件，优化器不会调整范围查询的位置。

### 面试题二：WHERE a=1 AND b>2 AND c=3 中，c 列能用到索引吗？怎么优化？

**答：c 列在传统最左前缀规则下无法使用索引。** 因为 `b > 2` 是范围查询，B+ Tree 在范围查询后无法保证后续列的有序性，所以 `c = 3` 只能在索引过滤后的结果中进一步筛选。

**优化方案**：
1. 将 `c` 列提前，修改索引为 `(a, c, b)`，这样 `c` 的等值匹配能在 `b` 的范围查询之前完成
2. 如果 `b` 的范围查询是核心需求且必须用 `c` 过滤，考虑使用覆盖索引 `(a, b, c)` + `Using index condition`（ICP），至少减少回表次数
3. 在 MySQL 8.0.13+ 中，如果 `a` 的基数较小，Index Skip Scan 可能帮助优化

### 面试题三：覆盖索引是什么？为什么能提升查询性能？

**答：覆盖索引是指查询所需的所有列都包含在使用的索引中，MySQL 无需回表查询聚簇索引（主键索引）即可获取全部数据。**

性能提升的原因：
1. **减少 IO 次数**：InnoDB 的二级索引叶子节点存储的是主键值，通常较小，一个索引页能容纳更多记录。而回表需要根据主键再去聚簇索引的 B+ Tree 中查找，涉及额外的随机 IO
2. **减少锁竞争**：在事务中，回表会获取额外的行锁，覆盖索引可以减少锁范围
3. **利用索引的有序性**：覆盖索引场景下，查询甚至不需要访问数据页，直接在索引页中就能完成

判断标志：`EXPLAIN` 的 `Extra` 列显示 `Using index`。

### 面试题四：以下两条 SQL，哪条更快？为什么？

```sql
-- SQL1
SELECT * FROM users WHERE name = 'Alice' ORDER BY age;
-- SQL2
SELECT name, age FROM users WHERE name = 'Alice' ORDER BY age;
```

**答：SQL2 更快。** 原因有两个：
1. **覆盖索引**：SQL2 只查询 `name` 和 `age` 两列，而索引 `(name, age)` 就能覆盖，`Extra` 显示 `Using index`，无需回表
2. **排序优化**：`ORDER BY age` 紧随 `WHERE name = 'Alice'` 之后，可以利用索引的有序性避免 filesort

SQL1 使用 `SELECT *` 需要获取所有列，无法使用覆盖索引，必须回表查询每个匹配行的完整数据，性能差距在数据量大时尤为明显。

### 面试题五：为什么在 MySQL 中不推荐使用函数处理索引列？如何解决？

**答：因为对索引列使用函数会破坏 B+ Tree 的有序性，导致索引失效。**

示例：
```sql
-- ❌ 索引失效：YEAR() 函数作用于 create_time 列
SELECT * FROM orders WHERE YEAR(create_time) = 2024;
-- EXPLAIN: type=ALL, key=NULL（全表扫描）
```

**解决方案**：
1. **范围查询替代**：`WHERE create_time >= '2024-01-01' AND create_time < '2025-01-01'`
2. **MySQL 8.0+ 函数索引**：`CREATE INDEX idx_year ON orders ((YEAR(create_time)));`
3. **计算列（Generated Column）+ 索引**：
   ```sql
   ALTER TABLE orders ADD COLUMN create_year INT
     GENERATED ALWAYS AS (YEAR(create_time)) STORED;
   CREATE INDEX idx_year ON orders (create_year);
   ```
4. **应用层预处理**：在应用代码中先计算好函数值，再传入 SQL 查询

![索引优化示意图](/images/content/databases-index-2-content-1.jpg)

![查询性能对比](/images/content/databases-index-2-content-2.jpg)

## 相关阅读

- [MySQL 覆盖索引、联合索引与索引下推深度解析](/post/index-optimization-explain/)
- [MySQL 主从复制原理与实战](/post/replication/)
- [MySQL 分库分表方案与 30 个开源项目推荐](/post/sharding-30-repos/)
- [Redis 高并发场景下的缓存策略与优化](/post/high-concurrency/)
