---
title: 索引失效的 12 种原因
tags: [MySQL, 索引, 性能优化, EXPLAIN, 慢查询]
keywords: [索引失效的, 种原因, 数据库]
categories:
  - database
date: 2019-05-20 10:00:00
description: MySQL 索引建了却不走？本文深度盘点索引失效的 12 种典型场景，包含 EXPLAIN 输出对比、函数操作与隐式类型转换导致索引失效的详细分析、OR 和 LIKE 的优化替代方案，以及生产环境慢查询踩坑案例。从 EXPLAIN 到慢查询日志，手把手教你排查 SQL 性能问题，掌握 MySQL 索引优化的核心套路。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-index-content-1.jpg
  - /images/content/databases-index-content-2.jpg


---

# 一句话

> **索引失效 = MySQL 优化器决定不用你建的索引去执行。** 永远用 `EXPLAIN` 验证，不要靠记忆。

# 为什么索引会失效？

MySQL 的查询优化器是基于**成本估算**来决定是否使用索引的。当优化器认为全表扫描比走索引更"划算"时，就会放弃索引。理解索引失效的本质，有助于在写 SQL 时主动规避，而不是等到线上出了慢查询再去救火。

> **核心原则：索引是 B+ Tree 结构，只能从左到右、按序匹配。** 任何破坏这个顺序的操作（函数包裹、类型转换、左模糊、违反最左前缀）都可能导致索引失效。

# 12 种失效场景

![索引失效场景](/images/content/databases-index-content-1.jpg)

## 1. WHERE 列上做函数 / 表达式

在索引列上使用函数或表达式，会导致 MySQL 无法直接利用 B+ Tree 的有序性，必须逐行计算函数结果后再比较，相当于全表扫描。

### 常见函数操作示例

```sql
-- ❌ 索引失效：YEAR() 函数
SELECT * FROM users WHERE YEAR(created_at) = 2024;

-- ❌ 索引失效：DATE() 函数
SELECT * FROM users WHERE DATE(created_at) = '2024-06-01';

-- ❌ 索引失效：CAST() 类型转换
SELECT * FROM orders WHERE CAST(amount AS SIGNED) > 100;

-- ❌ 索引失效：表达式运算
SELECT * FROM users WHERE id + 1 = 100;

-- ❌ 索引失效：字符串函数
SELECT * FROM users WHERE LEFT(name, 3) = '张三丰';
SELECT * FROM users WHERE SUBSTR(phone, 1, 3) = '138';

-- ❌ 索引失效：数学函数
SELECT * FROM products WHERE ROUND(price, 0) = 99;
SELECT * FROM orders WHERE ABS(discount) > 10;

-- ❌ 索引失效：IFNULL / COALESCE
SELECT * FROM users WHERE IFNULL(nickname, '') = 'test';
```

### ✅ 改写方案

```sql
-- 把函数挪到右边（常量侧），或者改写为范围查询
SELECT * FROM users WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
SELECT * FROM users WHERE created_at >= '2024-06-01' AND created_at < '2024-06-02';
SELECT * FROM users WHERE id = 99;

-- 字符串函数改用 LIKE 前缀匹配
SELECT * FROM users WHERE name LIKE '张三丰%';
```

**EXPLAIN 对比：**

```sql
-- ❌ 函数包裹
EXPLAIN SELECT * FROM users WHERE YEAR(created_at) = 2024;
```

| 维度 | ❌ 函数包裹 | ✅ 范围改写 |
|------|------------|------------|
| type | ALL | range |
| key | NULL | idx_created_at |
| rows | 500000 | 12000 |
| Extra | Using where | Using index condition |

```sql
-- ✅ 范围改写
EXPLAIN SELECT * FROM users WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
-- +----+-------------+-------+-------+------------------+------------------+---------+------+--------+-----------------------+
-- | id | select_type | table | type  | possible_keys    | key              | key_len | ref  | rows   | Extra                 |
-- +----+-------------+-------+-------+------------------+------------------+---------+------+--------+-----------------------+
-- |  1 | SIMPLE      | users | range | idx_created_at   | idx_created_at   | 5       | NULL |  12000 | Using index condition |
-- +----+-------------+-------+-------+------------------+---------+---------+------+--------+-----------------------+
```

> **线上踩坑**：某项目在 `created_at` 上建了索引，但日报统计用了 `WHERE DATE(created_at) = CURDATE()`，高峰期慢查询直接打满连接池，P99 从 50ms 飙到 8s。改成范围查询后恢复。

**MySQL 8.0 函数索引完整示例：**

```sql
-- 8.0+ 支持函数索引，直接对表达式建索引
ALTER TABLE users ADD INDEX idx_year_created ((YEAR(created_at)));

-- 此时以下查询也能走索引了
EXPLAIN SELECT * FROM users WHERE YEAR(created_at) = 2024;
-- type: ref, key: idx_year_created, rows: ~12000 ✅

-- 多列函数索引同样支持
ALTER TABLE orders ADD INDEX idx_year_month ((YEAR(order_date)), (MONTH(order_date)));

-- 注意：函数索引需要精确匹配函数表达式
-- YEAR(created_at) 的索引 对 DATE(created_at) 无效，需要单独建索引
ALTER TABLE users ADD INDEX idx_date_created ((DATE(created_at)));
```

## 2. 隐式类型转换

这是**线上最高频的索引失效原因之一**，也是最难发现的。当 WHERE 条件中字段类型与传入值类型不一致时，MySQL 会对每一行做隐式类型转换，导致索引无法使用。

### 规则速查

| 字段类型 | 传入类型 | 转换方向 | 索引是否失效 |
|---------|---------|---------|------------|
| VARCHAR | INT | 字段→数字 | ❌ **失效** |
| INT | VARCHAR | 字段→字符串 | ❌ **失效** |
| VARCHAR | VARCHAR | 无转换 | ✅ 正常 |
| INT | INT | 无转换 | ✅ 正常 |

> **关键规则**：MySQL 隐式类型转换时，**字符串转数字走的是 CAST()**，数字转字符串走的也是 CAST()。只要转换发生在字段侧，索引就会失效。

### 详细示例与 EXPLAIN 分析

```sql
-- 表结构：phone 是 VARCHAR(20)，有索引 idx_phone
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    phone VARCHAR(20),
    INDEX idx_phone (phone)
) ENGINE=InnoDB;

-- ❌ 字段是 VARCHAR，传了 INT → 索引失效
SELECT * FROM users WHERE phone = 13800138000;
-- 等价于：SELECT * FROM users WHERE CAST(phone AS DECIMAL) = 13800138000
-- 每一行都要 CAST，所以全表扫描
```

```sql
EXPLAIN SELECT * FROM users WHERE phone = 13800138000;
-- +----+-------------+-------+------+---------------+------+---------+------+--------+-------------+
-- | id | select_type | table | type | possible_keys | key  | key_len | ref  | rows   | Extra       |
-- +----+-------------+-------+------+---------------+------+---------+------+--------+-------------+
-- |  1 | SIMPLE      | users | ALL  | idx_phone     | NULL | NULL    | NULL | 800000 | Using where |
-- +----+-------------+-------+------+---------------+------+---------+------+--------+-------------+
-- type: ALL → 全表扫描！key: NULL → 索引没用上！
```

```sql
-- ✅ 类型匹配 → 正常走索引
EXPLAIN SELECT * FROM users WHERE phone = '13800138000';
-- +----+-------------+-------+------+---------------+-----------+---------+-------+------+-------+
-- | id | select_type | table | type | possible_keys | key       | key_len | ref   | rows | Extra |
-- +----+-------------+-------+------+---------------+-----------+---------+-------+------+-------+
-- |  1 | SIMPLE      | users | ref  | idx_phone     | idx_phone | 82      | const |    1 |       |
-- +----+-------------+-------+------+---------------+-----------+---------+-------+------+-------+
-- type: ref → 索引命中！rows: 1 → 只扫描 1 行！
```

### 反向情况（INT 字段传字符串）

```sql
-- id 是 BIGINT，有主键索引
-- ❌ 传字符串 '100'，MySQL 会把 id 转成字符串比较
SELECT * FROM users WHERE id = '100';
-- 等价于：SELECT * FROM users WHERE CAST(id AS CHAR) = '100'
-- 但由于主键是聚簇索引，优化器可能仍然选择走索引（取决于版本）
-- 在普通 INT 索引列上，这种情况同样会失效！
```

### ORM 框架常见陷阱

```php
// Laravel Eloquent 隐式类型转换陷阱
// phone 字段是 VARCHAR，但 request->input() 返回的是 mixed 类型

// ❌ 如果用户输入纯数字，Laravel 可能传为 int
User::where('phone', $request->input('phone'))->first();

// ✅ 显式转为字符串
User::where('phone', (string) $request->input('phone'))->first();

// ✅ 或者在 Model 中用 cast
protected $casts = [
    'phone' => 'string',
];
```

> **真实踩坑**：线上用户搜索接口，`phone` 字段是 `VARCHAR(20)`，ORM 框架传参时自动转成了数字类型。百万级用户表，每次搜索全表扫描，TPS 从 2000 掉到 80。DBA 用 `EXPLAIN` 一看：`type: ALL, key: NULL`，加了显式字符串转换后秒恢复。

### 排查隐式类型转换的技巧

```sql
-- 方法一：EXPLAIN 看 Extra 列
-- 如果出现 "Using where" 且 key=NULL，可能就是类型转换
EXPLAIN SELECT * FROM users WHERE phone = 13800138000;

-- 方法二：SHOW WARNINGS 看 MySQL 改写后的 SQL
EXPLAIN SELECT * FROM users WHERE phone = 13800138000;
SHOW WARNINGS;
-- 你会看到 MySQL 把它改写成了：
-- /* select#1 */ select `test`.`users`.`id` AS `id`,`test`.`users`.`phone` AS `phone`
-- from `test`.`users` where (`test`.`users`.`phone` = 13800138000)
-- 如果看到 CAST 函数，说明发生了隐式类型转换

-- 方法三：检查表结构确认字段类型
SHOW CREATE TABLE users;
```

## 3. LIKE 以 `%` 开头

```sql
-- ❌ 左模糊，无法利用 B+ Tree 的有序性
SELECT * FROM users WHERE name LIKE '%张';

-- ✅ 前缀匹配能走索引
SELECT * FROM users WHERE name LIKE '张%';
```

**EXPLAIN 对比：**

```sql
EXPLAIN SELECT * FROM users WHERE name LIKE '%张';
-- type: ALL, key: NULL, rows: 500000 → 全表扫描 ❌

EXPLAIN SELECT * FROM users WHERE name LIKE '张%';
-- type: range, key: idx_name, rows: 300 → 范围扫描 ✅
```

| 维度 | ❌ `%张` 前缀通配 | ✅ `张%` 前缀匹配 |
|------|------------------|------------------|
| type | ALL | range |
| key | NULL | idx_name |
| rows | 500000 | 300 |

### LIKE '%xxx' 的替代方案

当业务确实需要中间匹配或后缀匹配时，有以下优化方案：

#### 方案一：全文索引（FULLTEXT INDEX）

```sql
-- MySQL 5.6+ InnoDB 支持全文索引
ALTER TABLE articles ADD FULLTEXT INDEX ft_content (content) WITH PARSER ngram;

-- 使用全文搜索
SELECT * FROM articles WHERE MATCH(content) AGAINST('关键词' IN BOOLEAN MODE);

-- EXPLAIN 查看
EXPLAIN SELECT * FROM articles WHERE MATCH(content) AGAINST('关键词' IN BOOLEAN MODE);
-- type: fulltext, key: ft_content → 全文索引命中 ✅
```

> **注意**：全文索引适合文本搜索场景，不适合精确的 LIKE 匹配。中文需要使用 `ngram` 解析器。

#### 方案二：反向索引（模拟后缀匹配）

```sql
-- 如果需要 LIKE '%xxx'（后缀匹配），可以存储反向字符串
ALTER TABLE users ADD COLUMN name_reverse VARCHAR(100);
UPDATE users SET name_reverse = REVERSE(name);
ALTER TABLE users ADD INDEX idx_name_reverse (name_reverse);

-- 查询时反转搜索词
SELECT * FROM users WHERE name_reverse LIKE REVERSE('张') || '%';
-- 即：WHERE name_reverse LIKE '张%' → 走索引 ✅
```

#### 方案三：覆盖索引 + 延迟关联

```sql
-- 如果只需要少量字段，可以通过覆盖索引避免回表
-- 假设有 INDEX (name, id, email)
SELECT id, name, email FROM users WHERE name LIKE '%张%';
-- type: index, Extra: Using where; Using index → 覆盖索引扫描，比全表快
```

#### 方案四：搜索引擎（大数据量推荐）

```sql
-- 当数据量超过百万且搜索需求复杂时，建议使用 Elasticsearch
-- MySQL → ES 同步方案：
-- 1. Canal 监听 binlog 实时同步
-- 2. Logstash 定时全量同步
-- 3. 代码层双写（不推荐，一致性难保证）
```

## 4. OR 中有非索引列

```sql
-- ❌ phone 没索引，整条 SQL 失效
SELECT * FROM users WHERE id = 1 OR phone = '13800138000';
-- 优化器无法同时使用 id 的主键索引和 phone 的条件，只能全表扫描
```

**EXPLAIN 分析：**

```sql
EXPLAIN SELECT * FROM users WHERE id = 1 OR phone = '13800138000';
-- +----+-------------+-------+------+----------------+------+---------+------+--------+-------------+
-- | id | select_type | table | type | possible_keys  | key  | key_len | ref  | rows   | Extra       |
-- +----+-------------+-------+------+----------------+------+---------+------+--------+-------------+
-- |  1 | SIMPLE      | users | ALL  | PRIMARY,phone  | NULL | NULL    | NULL | 800000 | Using where |
-- +----+-------------+-------+------+----------------+------+---------+------+--------+-------------+
-- 虽然 possible_keys 列出了 PRIMARY 和 phone，但 key=NULL 表示都没用上
```

### ✅ 优化方案一：UNION ALL 拆分

```sql
-- UNION ALL 拆成两条独立查询，各自走各自的索引
SELECT * FROM users WHERE id = 1
UNION ALL
SELECT * FROM users WHERE phone = '13800138000' AND id != 1;

-- EXPLAIN 查看第一条子查询
EXPLAIN SELECT * FROM users WHERE id = 1;
-- type: const, key: PRIMARY, rows: 1 ✅

-- EXPLAIN 查看第二条子查询
EXPLAIN SELECT * FROM users WHERE phone = '13800138000' AND id != 1;
-- type: ref, key: idx_phone, rows: 1 ✅
```

### ✅ 优化方案二：给 OR 中的列加索引

```sql
-- 如果 OR 的两边都有索引，MySQL 8.0+ 可以使用 Index Merge
ALTER TABLE users ADD INDEX idx_phone (phone);

EXPLAIN SELECT * FROM users WHERE id = 1 OR phone = '13800138000';
-- type: index_merge, Extra: Using union(PRIMARY, idx_phone) ✅
-- 但 Index Merge 不如 UNION ALL 稳定，数据量大时性能可能不稳定
```

### ✅ 优化方案三：改用 IN（适用场景有限）

```sql
-- 如果 OR 的条件都在同一个字段上，可以改用 IN
-- ❌
SELECT * FROM users WHERE status = 1 OR status = 2 OR status = 3;
-- ✅
SELECT * FROM users WHERE status IN (1, 2, 3);
```

## 5. 联合索引违反最左前缀

```sql
-- INDEX (a, b, c)
WHERE a = 1               -- ✅ 用到 a
WHERE a = 1 AND b = 2     -- ✅ 用到 a, b
WHERE a = 1 AND c = 3     -- ✅ 用到 a（c 被回表过滤）
WHERE b = 2 AND c = 3     -- ❌ 跳过 a，全表扫描
WHERE c = 3               -- ❌ 跳过 a, b，全表扫描
```

**EXPLAIN 对比（INDEX (a, b, c)）：**

```sql
-- 创建测试表和联合索引
CREATE TABLE t (
    id INT PRIMARY KEY,
    a INT, b INT, c INT,
    INDEX idx_abc (a, b, c)
);

-- ❌ 跳过最左列
EXPLAIN SELECT * FROM t WHERE b = 2 AND c = 3;
-- +----+-------------+-------+------+---------------+------+---------+------+--------+-------------+
-- | id | select_type | table | type | possible_keys | key  | key_len | ref  | rows   | Extra       |
-- +----+-------------+-------+------+---------------+------+---------+------+--------+-------------+
-- |  1 | SIMPLE      | t     | ALL  | NULL          | NULL | NULL    | NULL | 500000 | Using where |
-- +----+-------------+-------+------+---------------+------+---------+------+--------+-------------+
-- possible_keys: NULL → 优化器根本没考虑 idx_abc
```

| 查询 | type | key_len | rows | Extra |
|------|------|---------|------|-------|
| `a=1` | ref | 4 | 500 | Using index condition |
| `a=1 AND b=2` | ref | 8 | 50 | Using index condition |
| `a=1 AND c=3` | ref | 4 | 500 | Using index condition（c 被回表过滤） |
| `b=2 AND c=3` | ALL | NULL | 500000 | Using where |
| `c=3` | ALL | NULL | 500000 | Using where |

> **key_len 的作用**：通过 EXPLAIN 的 `key_len` 可以判断联合索引实际用了几列。`INT` 占 4 字节，`NOT NULL` + 4 字节 = 4，`VARCHAR(100) utf8mb4` = 4 × 100 + 2 = 402。key_len 越大，说明用到的索引列越多。

### 最左前缀的特殊场景

```sql
-- INDEX (a, b, c)

-- MySQL 8.0+ 的索引跳跃扫描（Index Skip Scan）
-- 当 a 列基数很低（如性别）时，优化器可能跳过 a 直接用 b
-- 但这依赖优化器的判断，不能作为常规优化手段
EXPLAIN SELECT * FROM t WHERE b = 2;
-- MySQL 8.0.13+ 可能显示：type: range, key: idx_abc, Extra: Using index for skip scan

-- 范围查询后的列用不上索引
WHERE a = 1 AND b > 10 AND c = 3
-- ✅ a (=1) 走等值匹配
-- ✅ b (>10) 走范围扫描
-- ❌ c (=3) 无法走索引（b 是范围条件，打断了索引的有序性）
-- c 需要回表后在 Server 层过滤
```

## 6. 范围查询后的列失效

```sql
-- INDEX (a, b, c)
WHERE a = 1 AND b > 10 AND c = 3
-- ✅ a 走等值匹配，b 走范围扫描
-- ❌ c 用不上索引（b 是范围条件，打断了联合索引的有序性）
```

**EXPLAIN 验证：**

```sql
EXPLAIN SELECT * FROM t WHERE a = 1 AND b > 10 AND c = 3;
-- type: range, key: idx_abc, key_len: 8（只用到 a 和 b）
-- Extra: Using index condition（c 在存储引擎层通过 ICP 过滤，但仍不是索引范围扫描）

-- 对比：全部等值条件
EXPLAIN SELECT * FROM t WHERE a = 1 AND b = 10 AND c = 3;
-- type: ref, key: idx_abc, key_len: 12（用到 a, b, c 全部三列）✅
```

> **优化思路**：如果范围查询列可以改为等值查询，索引效率会大幅提升。例如 `b > 10 AND b < 20` 如果业务允许，改为 `b IN (11, 12, ..., 19)` 可能更优。

## 7. 负向查询

```sql
-- ❌ NOT IN / != / NOT LIKE 通常走全表扫描
SELECT * FROM users WHERE status != 1;
SELECT * FROM users WHERE status NOT IN (1, 2);
SELECT * FROM users WHERE name NOT LIKE '张%';

-- ✅ 改为正向查询
SELECT * FROM users WHERE status IN (2, 3, 4);
```

**EXPLAIN 对比：**

```sql
EXPLAIN SELECT * FROM users WHERE status != 1;
-- type: ALL, key: NULL → 全表扫描 ❌
-- 但注意：如果 != 的结果集占比很小（<30%），优化器可能还是走索引

EXPLAIN SELECT * FROM users WHERE status IN (2, 3, 4);
-- type: range, key: idx_status → 范围扫描 ✅
```

> **注意**：负向查询是否走索引取决于**数据分布**。如果 `status != 1` 的数据只占总数据的 5%，优化器可能认为走索引更划算。但大多数情况下，负向查询会触发全表扫描。

## 8. IS NULL / IS NOT NULL（看版本和数据）

```sql
-- 索引是否生效取决于 NULL 值的比例和 MySQL 版本
-- MySQL 5.7 和 8.0 对 NULL 的处理有差异

-- 大部分行是 NULL → IS NOT NULL 走全表
-- 大部分行非 NULL → IS NULL 走索引
-- 规则：NULL 值占比超过约 30%，优化器倾向全表扫描

SELECT * FROM users WHERE deleted_at IS NULL;
```

**EXPLAIN 分析：**

```sql
-- 场景1：90% 的行 deleted_at = NULL（即大部分被软删除）
EXPLAIN SELECT * FROM users WHERE deleted_at IS NULL;
-- type: ALL → 全表扫描，因为要返回 90% 的行 ❌

-- 场景2：10% 的行 deleted_at = NULL（即大部分正常）
EXPLAIN SELECT * FROM users WHERE deleted_at IS NULL;
-- type: ref, key: idx_deleted_at → 走索引，只返回 10% ✅
```

> **最佳实践**：对于软删除场景，推荐使用 `WHERE deleted_at = '1970-01-01'` 代替 `IS NULL`，避免 NULL 值带来的索引判断歧义。或者使用分区表将已删除数据物理隔离。

## 9. ORDER BY 方向不一致

```sql
-- INDEX (a, b)
ORDER BY a ASC, b ASC    -- ✅ 同向扫描
ORDER BY a DESC, b DESC  -- ✅ 反向扫描（MySQL 8 前是反向遍历 B+Tree）
ORDER BY a ASC, b DESC   -- ❌ 8 之前会 filesort
```

**MySQL 8.0+ 的改进：**

```sql
-- MySQL 8.0+ 支持降序索引
CREATE TABLE t (
    a INT, b INT,
    INDEX idx_ab (a ASC, b DESC)
);

-- 此时 ORDER BY a ASC, b DESC 可以走索引 ✅
EXPLAIN SELECT * FROM t ORDER BY a ASC, b DESC;
-- type: ALL, key: idx_ab, Extra: Using index ✅

-- MySQL 8.0 之前，这种查询必须 filesort
-- MySQL 8.0 之前要实现混合排序，只能在应用层做 UNION 或改业务逻辑
```

## 10. 数据量太少

```sql
-- 当表的数据量很少时（通常 < 几千行），优化器认为：
-- 全表扫描（顺序 I/O）< 索引查找 + 回表（随机 I/O）
-- 因此直接放弃索引

-- 这不是 bug，是设计！小表全表扫描确实更快。
-- 不需要优化，但如果影响 EXPLAIN 结果的判断，可以：
-- 1. 使用 FORCE INDEX 强制走索引（仅测试用）
-- 2. 使用 STRAIGHT_JOIN 强制连接顺序（仅测试用）
```

## 11. 字符集 / 校对规则不一致

```sql
-- JOIN 时左右两表的字段字符集不同
-- 表 A: name VARCHAR(100) CHARACTER SET utf8mb4
-- 表 B: name VARCHAR(100) CHARACTER SET latin1
-- JOIN 时发生隐式转换 → 索引失效

-- EXPLAIN 看到 type: ALL 且两表都有索引时，优先检查字符集
EXPLAIN SELECT * FROM a JOIN b ON a.name = b.name;
```

**修复方案：**

```sql
-- 方案一：统一字符集（推荐）
ALTER TABLE b CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 方案二：查询时显式转换
SELECT * FROM a JOIN b ON a.name = CONVERT(b.name USING utf8mb4);

-- 方案三：建表时统一规范
-- 所有新表统一使用 utf8mb4_unicode_ci
-- my.cnf 中设置：
-- [mysqld]
-- character-set-server = utf8mb4
-- collation-server = utf8mb4_unicode_ci
```

## 12. 优化器统计信息过期

```sql
-- MySQL 的优化器依赖统计信息来估算成本
-- 大量增删改后，统计信息可能不准确
-- 导致优化器做出错误的索引选择

-- 刷新统计信息
ANALYZE TABLE users;

-- 查看统计信息
SHOW INDEX FROM users;
-- Cardinality 列显示索引的基数估算值

-- 如果 Cardinality 与实际差异很大，就需要 ANALYZE TABLE
```

**EXPLAIN 异常排查：**

```sql
-- 症状：明明有索引，EXPLAIN 却显示全表扫描
-- 但手动 FORCE INDEX 后，执行时间大幅缩短
SELECT * FROM users FORCE INDEX(idx_age) WHERE age > 20 AND age < 30;

-- 如果 FORCE INDEX 比优化器自选的快很多，说明统计信息有问题
-- 定期执行 ANALYZE TABLE 是 DBA 的基本工作
```

# 生产环境踩坑案例

## 案例一：隐式类型转换引发全站慢查询

**背景**：某电商 B2C 平台，用户表 800 万行，`phone` 字段 `VARCHAR(20)` 有普通索引。用户搜索接口 QPS 约 500。

**事故**：某次发版后，客服反馈用户搜索变慢。监控显示 P99 从 100ms 飙到 12s，慢查询日志刷屏。

**排查过程**：

```sql
-- 1. 看慢查询日志，找到问题 SQL
-- SELECT * FROM users WHERE phone = 13800138000

-- 2. EXPLAIN 确认
EXPLAIN SELECT * FROM users WHERE phone = 13800138000;
-- type: ALL, key: NULL, rows: 8000000
-- 全表扫描！索引失效了！

-- 3. SHOW WARNINGS 看 MySQL 改写
SHOW WARNINGS;
-- 发现 MySQL 对 phone 做了 CAST(phone AS DECIMAL) → 隐式类型转换

-- 4. 检查代码变更
-- 发现 ORM 升级后，参数绑定从 string 改为了 mixed，数字字符串被自动转为 int
```

**修复**：

```php
// 修复前
User::where('phone', $request->input('phone'))->first();

// 修复后：强制字符串类型
User::where('phone', (string) $request->input('phone'))->first();
```

**效果**：P99 从 12s 降到 80ms。

**教训**：

1. ORM 框架的类型转换是隐式类型转换的高发区
2. VARCHAR 字段的查询参数必须显式转为字符串
3. 上线前用 EXPLAIN 检查核心接口是必须流程

## 案例二：WHERE DATE() 导致日报统计超时

**背景**：运营日报需要统计当天订单数，SQL 如下：

```sql
SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURDATE();
```

`created_at` 有索引，但订单表 5000 万行。

**问题**：

```sql
EXPLAIN SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURDATE();
-- type: ALL, key: NULL, rows: 50000000
-- 每天凌晨跑批时执行，耗时 45 秒，经常超时
```

**修复**：

```sql
-- 改为范围查询
SELECT COUNT(*) FROM orders
WHERE created_at >= CURDATE() AND created_at < CURDATE() + INTERVAL 1 DAY;

-- EXPLAIN
-- type: range, key: idx_created_at, rows: 350000
-- 执行时间：0.8 秒
```

**进阶优化**：MySQL 8.0+ 创建函数索引一劳永逸：

```sql
ALTER TABLE orders ADD INDEX idx_date_created ((DATE(created_at)));
-- 之后 WHERE DATE(created_at) = CURDATE() 也能走索引
```

## 案例三：OR 条件导致索引合并失败

**背景**：后台管理系统的订单搜索接口，支持按订单号或手机号查询：

```sql
SELECT * FROM orders WHERE order_no = 'ORD20240601001' OR phone = '13800138000';
```

**问题**：`order_no` 有唯一索引，`phone` 没有索引。结果全表扫描。

**修复**：

```sql
-- 方案一：给 phone 加索引（推荐）
ALTER TABLE orders ADD INDEX idx_phone (phone);

-- 方案二：UNION ALL 拆分（不改表结构）
SELECT * FROM orders WHERE order_no = 'ORD20240601001'
UNION ALL
SELECT * FROM orders WHERE phone = '13800138000' AND order_no != 'ORD20240601001';
```

# 索引失效快速排查流程

```
发现慢查询
    │
    ▼
EXPLAIN 分析
    │
    ├── type: ALL, key: NULL → 索引完全没用上
    │       ├── 检查 WHERE 列是否有函数/表达式
    │       ├── 检查是否有隐式类型转换（SHOW WARNINGS）
    │       ├── 检查 LIKE 是否以 % 开头
    │       ├── 检查 OR 条件是否有非索引列
    │       └── 检查联合索引是否违反最左前缀
    │
    ├── type: index → 全索引扫描（比 ALL 稍好，但仍不理想）
    │       └── 检查是否缺少 WHERE 条件或 ORDER BY 无法优化
    │
    ├── type: range → 范围扫描（正常）
    │       └── 检查 key_len 判断用了几列索引
    │
    └── type: ref/eq_ref/const → 索引命中（理想状态）
            └── 如果仍慢，检查 rows 数量和回表次数
```

![排查工具](/images/content/databases-index-content-2.jpg)

# 排查工具

```sql
-- 1. EXPLAIN 看 type / key / rows
EXPLAIN SELECT ...;

-- 2. 看优化器实际怎么改写的
EXPLAIN FORMAT=TREE SELECT ...;     -- MySQL 8.0+，树形格式
EXPLAIN ANALYZE SELECT ...;         -- 真实执行并返回实际耗时（8.0.18+）

-- 3. SHOW WARNINGS 看隐式转换
EXPLAIN SELECT * FROM users WHERE phone = 13800138000;
SHOW WARNINGS;

-- 4. 慢查询日志
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
SET GLOBAL log_queries_not_using_indexes = 'ON';  -- 记录未使用索引的查询

-- 5. performance_schema 查看索引使用情况
SELECT * FROM sys.schema_unused_indexes;           -- 未使用的索引
SELECT * FROM sys.schema_redundant_indexes;        -- 冗余索引

-- 6. 强制走某索引（兜底，少用）
SELECT * FROM users FORCE INDEX(idx_age) WHERE age = 25;
```

# 速查表：12 种索引失效原因与解决方案

| # | 失效原因 | 解决方案 | 优先级 |
|---|---------|---------|--------|
| 1 | 函数/表达式包裹 | 函数移到右侧；MySQL 8.0+ 用函数索引 | 🔴 高 |
| 2 | 隐式类型转换 | 保证参数类型与字段类型一致 | 🔴 高 |
| 3 | LIKE '%xxx' | 改为前缀匹配；或用全文索引/ES | 🟡 中 |
| 4 | OR 含非索引列 | UNION ALL 拆分；给所有列加索引 | 🟡 中 |
| 5 | 违反最左前缀 | 调整查询列顺序或重建索引 | 🔴 高 |
| 6 | 范围后列失效 | 调整联合索引列顺序 | 🟡 中 |
| 7 | 负向查询 | 改为正向查询 IN | 🟡 中 |
| 8 | IS NULL/NOT NULL | 改用默认值代替 NULL | 🟢 低 |
| 9 | ORDER BY 方向不一致 | MySQL 8.0+ 用降序索引 | 🟢 低 |
| 10 | 数据量太少 | 无需优化 | ⚪ 忽略 |
| 11 | 字符集不一致 | 统一使用 utf8mb4 | 🟡 中 |
| 12 | 统计信息过期 | 定期 ANALYZE TABLE | 🟡 中 |

# 参考

- MySQL 文档 - Index Hints: <https://dev.mysql.com/doc/refman/8.0/en/index-hints.html>
- MySQL 文档 - Type Conversion in Expression Evaluation: <https://dev.mysql.com/doc/refman/8.0/en/type-conversion.html>
- MySQL 文档 - EXPLAIN Output Format: <https://dev.mysql.com/doc/refman/8.0/en/explain-output.html>
- 《高性能 MySQL》第 6 章「查询性能优化」

## 相关阅读

- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则](/categories/Databases/index-deep-dive-explain/)
- [MySQL 慢查询治理实战：pt-query-digest 分析、索引优化与 SQL 重写](/categories/Databases/slow-query-governance/)
- [索引下推（ICP）深度解析：EXPLAIN 实战与 Laravel 性能优化指南](/categories/Databases/index/index-condition-pushdown/)
- [数据库索引优化实战：覆盖索引、联合索引与索引下推](/categories/Databases/index-optimization-explain/)
- [覆盖索引（Covering Index）](/categories/Databases/index/covering-index/)
- [索引的最左前缀原则](/categories/Databases/index/leftmost-prefix-rule/)
- [索引创建的原则](/categories/Databases/index/creation-principles/)
