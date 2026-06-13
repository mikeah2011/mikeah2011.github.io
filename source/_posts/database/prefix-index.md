---

title: MySQL 前缀索引：长字符串字段的索引优化策略
keywords: [MySQL, 前缀索引, 长字符串字段的索引优化策略]
tags:
- MySQL
- 前缀索引
- 性能优化
- EXPLAIN
categories:
- database
date: 2015-03-20 15:05:07
updated: 2026-06-09 07:21:00
description: 前缀索引是 MySQL 中针对长字符串字段的性能优化利器，通过只索引字段的前 N 个字符来大幅减少索引占用的内存和磁盘空间。本文详解前缀索引的 B+ 树存储原理、如何用选择性（selectivity）计算最优前缀长度、EXPLAIN 验证索引效果，并分析其不能用于 ORDER BY、GROUP BY 和覆盖索引的局限性，附带完整 MySQL 示例与踩坑案例。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/db-index-01-content-1.jpg
- /images/content/db-index-01-content-2.jpg
---



## 什么是前缀索引

在实际业务中，我们经常会遇到需要对很长的字符串字段建立索引的场景，比如邮箱（`user@example.com`）、URL（`https://www.example.com/very/long/path`）、身份证号等。如果对整个字段建索引，会占用大量的内存和磁盘空间，不仅浪费资源，还会降低查询性能。

**前缀索引（Prefix Index）** 的核心思想很简单：只取字符串字段的前 N 个字符作为索引，而不是整个字段。这样既能利用索引加速查询，又能大幅减少索引占用的空间。

```sql
-- 完整索引：索引整个 email 字段
CREATE INDEX idx_email_full ON users (email);

-- 前缀索引：只索引 email 字段的前 10 个字符
CREATE INDEX idx_email_prefix ON users (email(10));
```

## 前缀索引的原理：B+ 树视角

MySQL 的 InnoDB 存储引擎使用 **B+ 树** 来组织索引。在完整索引中，B+ 树的每个叶子节点存储的是完整的字段值（或主键值）。对于一个 VARCHAR(255) 的字段，每个索引条目可能需要数百字节。

![数据库索引优化](/images/content/db-index-01-content-1.jpg)

当使用前缀索引时，B+ 树中只存储字段的前 N 个字符：

| 对比项 | 完整索引 | 前缀索引 (N=10) |
| --- | --- | --- |
| 单个索引条目大小 | 最大 255 字节 | 最大 10 字节 |
| 每个索引页容纳条目数 | 较少 | 大幅增加 |
| B+ 树高度 | 可能更高 | 通常更矮 |
| 索引总空间 | 大 | 小 |
| 查询精确度 | 100% | 取决于前缀长度 |

B+ 树更矮意味着**更少的磁盘 I/O**，这是前缀索引提升性能的关键所在。

## 如何选择最优前缀长度

选择前缀长度的核心指标是 **选择性（Selectivity）**。选择性越高，索引的区分度越好，查询效率越高。

**选择性的定义：**

```
选择性 = 不重复的索引值数量 / 数据表中的总记录数
```

选择性的范围是 0 到 1。值越接近 1，说明索引的区分度越好。

### 完整示例：从零开始选择最优前缀长度

#### 第一步：创建测试表并插入数据

```sql
-- 创建测试表
CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 插入测试数据（使用存储过程批量插入）
DELIMITER //
CREATE PROCEDURE insert_test_data()
BEGIN
  DECLARE i INT DEFAULT 1;
  DECLARE domains VARCHAR(200);
  DECLARE domain VARCHAR(30);
  WHILE i <= 100000 DO
    SET domains = ELT(1 + FLOOR(RAND() * 5),
      'gmail.com', 'outlook.com', 'yahoo.com', 'qq.com', 'hotmail.com');
    SET domain = ELT(1 + FLOOR(RAND() * 10),
      'example.com', 'test.org', 'mysite.net', 'company.cn',
      'school.edu', 'work.io', 'blog.me', 'dev.tech', 'app.xyz', 'data.cloud');
    INSERT INTO `users` (`email`, `name`)
    VALUES (
      CONCAT('user', i, '@', IF(RAND() > 0.5, domains, domain)),
      CONCAT('用户', i)
    );
    SET i = i + 1;
  END WHILE;
END //
DELIMITER ;

CALL insert_test_data();
```

#### 第二步：计算完整列的选择性（基准值）

```sql
-- 完整列的选择性
SELECT COUNT(DISTINCT email) / COUNT(*) AS full_selectivity
FROM users;
-- 结果示例：0.9987
```

#### 第三步：逐步计算不同前缀长度的选择性

```sql
-- 一次性比较多个前缀长度
SELECT
  COUNT(DISTINCT email) / COUNT(*) AS full_sel,
  COUNT(DISTINCT LEFT(email, 5)) / COUNT(*) AS prefix_5,
  COUNT(DISTINCT LEFT(email, 6)) / COUNT(*) AS prefix_6,
  COUNT(DISTINCT LEFT(email, 7)) / COUNT(*) AS prefix_7,
  COUNT(DISTINCT LEFT(email, 8)) / COUNT(*) AS prefix_8,
  COUNT(DISTINCT LEFT(email, 9)) / COUNT(*) AS prefix_9,
  COUNT(DISTINCT LEFT(email, 10)) / COUNT(*) AS prefix_10,
  COUNT(DISTINCT LEFT(email, 11)) / COUNT(*) AS prefix_11,
  COUNT(DISTINCT LEFT(email, 12)) / COUNT(*) AS prefix_12,
  COUNT(DISTINCT LEFT(email, 15)) / COUNT(*) AS prefix_15,
  COUNT(DISTINCT LEFT(email, 20)) / COUNT(*) AS prefix_20
FROM users;
```

**典型结果：**

| 前缀长度 | 选择性 | 与完整列的比值 |
| --- | --- | --- |
| 5 | 0.8234 | 82.4% |
| 6 | 0.8912 | 89.2% |
| 7 | 0.9345 | 93.5% |
| 8 | 0.9678 | 96.8% |
| 9 | 0.9856 | 98.6% |
| **10** | **0.9943** | **99.4%** |
| 11 | 0.9978 | 99.8% |
| 12 | 0.9985 | 99.9% |
| 15 | 0.9987 | 100% |
| 20 | 0.9987 | 100% |

![SQL查询性能优化](/images/content/db-index-01-content-2.jpg)

**选择策略：** 选择一个使选择性**接近完整列选择性（通常 ≥ 95%~99%）** 的最短前缀长度。上例中，前缀长度 10 的选择性已达到 99.4%，是性价比最高的选择。

#### 第四步：创建前缀索引并用 EXPLAIN 验证

```sql
-- 创建前缀索引
CREATE INDEX idx_email_prefix ON users (email(10));

-- 查看索引是否生效
EXPLAIN SELECT * FROM users WHERE email = 'user12345@gmail.com';
```

```
+----+------+------------------+---------+-------+------+----------+-------+
| id | type | possible_keys    | key     | ref   | rows | filtered | Extra |
+----+------+------------------+---------+-------+------+----------+-------+
|  1 | ref  | idx_email_prefix | idx_... | const |    4 |   100.00 | NULL  |
+----+------+------------------+---------+-------+------+----------+-------+
```

> **注意：** `rows` 列显示的行数可能大于 1，因为前缀索引的区分度不是 100%，MySQL 需要回表后逐行精确匹配 `email` 字段的完整值。

#### 第五步：对比完整索引的执行计划

```sql
-- 创建完整索引进行对比
CREATE INDEX idx_email_full ON users (email);

EXPLAIN SELECT * FROM users WHERE email = 'user12345@gmail.com';
-- rows 通常为 1，因为完整索引能精确定位

-- 清理
DROP INDEX idx_email_full ON users;
```

## 前缀索引 vs 完整索引 vs 联合索引

| 特性 | 前缀索引 | 完整索引 | 联合索引 |
| --- | --- | --- | --- |
| 索引空间 | ⭐ 最小 | 最大 | 中等 |
| 查询精确度 | 较高（需回表确认） | ⭐ 100% | ⭐ 100% |
| 支持 ORDER BY | ❌ 不支持 | ✅ 支持 | ✅ 支持（需最左前缀） |
| 支持 GROUP BY | ❌ 不支持 | ✅ 支持 | ✅ 支持（需最左前缀） |
| 支持覆盖索引 | ❌ 不支持 | ✅ 支持 | ✅ 支持 |
| 范围查询 | ⚠️ 部分支持 | ✅ 支持 | ✅ 支持 |
| 适用场景 | 长字符串字段 | 通用 | 多条件查询 |

## 前缀索引的局限性

### 1. 不能用于 ORDER BY

```sql
-- ❌ 前缀索引无法加速排序
SELECT * FROM users ORDER BY email LIMIT 10;
-- MySQL 无法利用 idx_email_prefix 进行排序，只能 filesort
```

**原因：** B+ 树中存储的是截断后的前缀值，不是完整的字段值，无法保证按前缀排序等价于按完整值排序。

### 2. 不能用于 GROUP BY

```sql
-- ❌ 前缀索引无法加速分组
SELECT LEFT(email, LOCATE('@', email) - 1) AS username, COUNT(*)
FROM users
GROUP BY username;
```

### 3. 不能用于覆盖索引

```sql
-- 即使查询只需要 email 字段，也无法避免回表
EXPLAIN SELECT email FROM users WHERE email = 'test@gmail.com';
-- Extra 列不会出现 "Using index"
```

**原因：** 前缀索引中存储的不是完整的 `email` 值，MySQL 必须回到主键索引中读取完整行数据才能确认结果。

### 4. 范围查询可能不精确

```sql
-- ⚠️ 范围查询只能利用前缀部分
SELECT * FROM users WHERE email LIKE 'user123%';
-- 如果前缀长度足够覆盖 'user123'，则索引有效
-- 否则索引只能利用前 N 个字符进行过滤
```

## 适用场景

前缀索引最适合以下场景：

1. **邮箱地址**（`user@domain.com`）— 通常前 10~15 个字符就能很好区分
2. **URL 地址**（`https://...`）— 域名部分通常有较好的区分度
3. **身份证号**（18 位）— 前 6 位代表地区，前 10~12 位通常足够区分
4. **长文本摘要字段** — 如文章标题、商品描述等
5. **UUID 字符串**（36 位）— 前 8~12 位通常有较高区分度

**不适合的场景：**

- 字段本身较短（如 VARCHAR(20)），直接建完整索引即可
- 需要 ORDER BY / GROUP BY 的查询字段
- 高并发写入场景下，前缀索引的回表操作会增加额外开销
- 需要覆盖索引（Covering Index）优化的高频查询

## 踩坑案例：前缀长度选错导致索引失效

### 场景描述

某电商平台的商品表有 500 万条记录，`product_code` 字段为 VARCHAR(50)，格式类似 `SKU-2024-ELECTRONICS-001234`。DBA 为了节省空间，创建了前缀长度为 5 的索引：

```sql
CREATE INDEX idx_product_code ON products (product_code(5));
```

### 问题现象

```sql
EXPLAIN SELECT * FROM products WHERE product_code = 'SKU-2024-ELECTRONICS-001234';
```

```
+----+------+------------------+------+------+----------+-------------+
| id | type | possible_keys    | key  | rows | filtered | Extra       |
+----+------+------------------+------+------+----------+-------------+
|  1 | ALL  | idx_product_code | NULL | 500万|    10.00 | Using where |
+----+------+------------------+------+------+----------+-------------+
```

**索引完全失效，退化为全表扫描！**

### 根因分析

所有商品编码都以 `SKU-` 开头，前缀长度 5 意味着索引中几乎所有记录的前缀值都是 `SKU-2`，选择性极低：

```sql
SELECT COUNT(DISTINCT LEFT(product_code, 5)) / COUNT(*) FROM products;
-- 结果：0.0003 （选择性几乎为 0）
```

### 解决方案

```sql
-- 先分析最优前缀长度
SELECT
  COUNT(DISTINCT LEFT(product_code, 10)) / COUNT(*) AS p10,
  COUNT(DISTINCT LEFT(product_code, 15)) / COUNT(*) AS p15,
  COUNT(DISTINCT LEFT(product_code, 20)) / COUNT(*) AS p20,
  COUNT(DISTINCT LEFT(product_code, 25)) / COUNT(*) AS p25
FROM products;
-- p15 的选择性已接近完整列

-- 删除旧索引，重建
DROP INDEX idx_product_code ON products;
CREATE INDEX idx_product_code ON products (product_code(15));
```

### 教训

> **前缀长度的选择必须基于实际数据的分布特征，不能凭直觉拍脑袋。** 不同数据分布下，相同的前缀长度可能产生天壤之别的效果。务必通过 `COUNT(DISTINCT LEFT(col, N)) / COUNT(*)` 计算验证。

## MySQL 8.0+ 的变化

MySQL 8.0 引入了 **Descending Index**（降序索引）和 **Invisible Index**（不可见索引），与前缀索引配合使用时有一些值得注意的点：

```sql
-- 8.0+：用不可见索引安全测试前缀索引效果
-- 先将索引设为不可见，观察查询计划变化
ALTER TABLE users ALTER INDEX idx_email_prefix INVISIBLE;

-- 执行查询，确认性能退化程度
EXPLAIN SELECT * FROM users WHERE email = 'test@gmail.com';

-- 恢复可见
ALTER TABLE users ALTER INDEX idx_email_prefix VISIBLE;
```

> **注意**：MySQL 8.0 的 Hash Join 优化对前缀索引没有直接影响，但如果你的查询涉及 JOIN 且被驱动表的连接字段使用了前缀索引，区分度不足可能导致 Hash 桶分布不均，影响 JOIN 性能。

## 总结

| 要点 | 说明 |
| --- | --- |
| 核心价值 | 用少量空间换取接近完整索引的查询性能 |
| 选择长度 | 通过选择性公式找到 ≥ 95%~99% 的最短前缀 |
| B+ 树优势 | 更短的索引条目 → 更多条目/页 → 更矮的树 → 更少 I/O |
| 主要限制 | 不支持 ORDER BY、GROUP BY、覆盖索引 |
| 必做验证 | 创建后用 EXPLAIN 确认索引确实被使用 |
| 常见坑 | 前缀长度太短导致选择性极低，索引形同虚设 |
| 8.0+ 增强 | Invisible Index 可安全测试前缀效果 |

---

## 相关阅读

- [数据库索引优化实战-覆盖索引联合索引与索引下推](/categories/databases/index-optimization-explain/)
- [MySQL 索引优化实战：EXPLAIN 分析](/categories/databases/index-deep-dive-explain/)
- [MySQL主键](/categories/databases/primary-key/)
- [索引的概念](/categories/Databases/concept/)
- [索引的优缺点](/categories/Databases/pros-and-cons/)
- [索引失效的 12 种原因](/categories/Databases/ineffective-cases/)
- [创建索引](/categories/Databases/creation/)
- [索引的最左前缀原则](/categories/Databases/leftmost-prefix-rule/)
- [Laravel + MySQL 索引性能调研笔记](/categories/Databases/laravel-mysql-index-explain-index/)
