---

title: MySQL 索引类型：主键索引、唯一索引、联合索引与全文索引
keywords: [MySQL, 索引类型, 主键索引, 唯一索引, 联合索引与全文索引]
tags:
- MySQL
- 索引
- 数据库
- 性能优化
- B+Tree
- InnoDB
categories:
- database
date: 2016-03-13 14:05:07
description: 全面解析MySQL索引类型，深入对比B+Tree索引、Hash索引、全文索引（Full-Text Index）和空间索引（R-Tree/Spatial Index）的底层结构、适用场景与性能差异。包含B+Tree索引的ASCII结构图解、Hash索引vs B+Tree索引的详细对比、MySQL全文索引使用示例、空间索引GIS查询示例，以及各类索引的EXPLAIN输出分析。帮助开发者根据查询模式选择最优索引策略，显著提升数据库查询性能。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-001-content-1.jpg
- /images/content/databases-001-content-2.jpg
---



## 一、从存储结构上划分

![索引存储结构](/images/content/databases-001-content-1.jpg)

从存储结构上看，MySQL 索引主要分为四种类型：

| 类型 | 说明 |
| :--- | :--- |
| B-Tree 索引 | B-Tree 或 B+Tree 索引，MySQL 默认索引结构 |
| Hash 索引 | 基于哈希表的索引 |
| Full-Text 全文索引 | 用于文本搜索的倒排索引 |
| R-Tree 空间索引 | 用于空间数据的多维树索引 |

下面详细介绍每种索引类型的原理与用法。

---

### 1.1 B-Tree 索引（B+Tree）

B-Tree 是 MySQL（InnoDB、MyISAM）默认的索引结构。实际上 MySQL 使用的是 **B+Tree** 变体——所有数据都存储在叶子节点，叶子节点之间通过双向链表连接，支持范围查询和排序。

#### B+Tree 底层结构图示

```
                        [30 | 60]                          ← 根节点（非叶子）
                       /    |    \
                      /     |     \
            [10|20]       [40|50]       [70|80]             ← 非叶子节点
           /  |  \       /  |  \       /  |  \
          ↓   ↓   ↓     ↓   ↓   ↓     ↓   ↓   ↓
        [10] [20] [30] [40] [50] [60] [70] [80] [90]       ← 叶子节点（存储数据）
         ↔    ↔    ↔    ↔    ↔    ↔    ↔    ↔    ↔         ← 双向链表连接
```

**结构特点：**

- **非叶子节点**：只存储索引键值（key）和子节点指针（pointer），不存储实际数据
- **叶子节点**：存储完整的索引键值和对应的数据（InnoDB 中叶子节点存储完整行数据或主键值）
- **双向链表**：叶子节点之间通过指针相连，支持高效的范围扫描和 ORDER BY 排序
- **页大小**：InnoDB 默认页大小为 16KB，每个页可以存储约 500-1000 个索引条目
- **树高度**：通常 2-4 层即可存储千万级数据。假设每个页存 1000 条记录：
  - 2 层：1000 × 1000 = 100 万条
  - 3 层：1000 × 1000 × 1000 = 10 亿条

**特点：**
- 支持全值匹配、最左前缀匹配、范围查询
- 叶子节点有序且通过链表连接，适合 `ORDER BY` 和 `BETWEEN` 查询
- 时间复杂度 O(log n)，通常 2-4 次磁盘 IO 即可定位数据

```sql
-- 创建 B-Tree 索引（默认类型，无需显式指定）
CREATE INDEX idx_name ON users(name);
ALTER TABLE users ADD INDEX idx_age(age);

-- 创建复合索引（联合索引）
CREATE INDEX idx_name_age ON users(name, age);
```

```sql
-- 等值查询
EXPLAIN SELECT * FROM users WHERE name = '张三';
-- type: ref, key: idx_name, rows: 1

-- 范围查询
EXPLAIN SELECT * FROM users WHERE age BETWEEN 20 AND 30;
-- type: range, key: idx_age, rows: estimated

-- 排序查询（利用叶子节点链表）
EXPLAIN SELECT * FROM users WHERE age > 20 ORDER BY age;
-- type: range, key: idx_age, Extra: Using index condition
```

> **相关阅读**：关于 B+Tree 的详细原理，请参阅 [索引采用的算法](/categories/Databases/b-tree/)。

---

### 1.2 Hash 索引

Hash 索引基于哈希表实现，只存储哈希值和行指针，不存储字段值。Memory 引擎显式支持 Hash 索引，InnoDB 中的自适应哈希索引（AHI）由引擎自动维护。

#### Hash 索引的工作原理

```
  索引键 '张三'  ──→  Hash 函数  ──→  Bucket 17  ──→  行指针
  索引键 '李四'  ──→  Hash 函数  ──→  Bucket 42  ──→  行指针
  索引键 '王五'  ──→  Hash 函数  ──→  Bucket 17  ──→  行指针（哈希冲突，链表处理）
```

**特点：**
- 等值查询时间复杂度 O(1)，速度极快
- **不支持**范围查询、排序和最左前缀匹配
- **不支持**部分索引列匹配（必须使用完整的索引列）
- 可能存在哈希冲突，极端情况下性能退化
- Memory 引擎重启后数据丢失

```sql
-- Memory 引擎创建 Hash 索引
CREATE TABLE lookup (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    INDEX USING HASH (name)
) ENGINE=MEMORY;

-- 插入测试数据
INSERT INTO lookup VALUES (1, '张三'), (2, '李四'), (3, '王五');
```

```sql
-- 等值查询（Hash 索引优势场景）
EXPLAIN SELECT * FROM lookup WHERE name = 'test';
-- type: ref, Extra: Using hash index

-- 以下查询无法使用 Hash 索引：
EXPLAIN SELECT * FROM lookup WHERE name LIKE '张%';  -- ❌ 不支持范围
EXPLAIN SELECT * FROM lookup WHERE name > '李';      -- ❌ 不支持范围
```

#### Hash 索引 vs B+Tree 索引详细对比

| 对比维度 | Hash 索引 | B+Tree 索引 |
| :--- | :--- | :--- |
| **数据结构** | 哈希表（数组 + 链表） | 多路平衡搜索树 |
| **等值查询** | O(1)，极快 | O(log n)，较快 |
| **范围查询** | ❌ 不支持 | ✅ 高效支持 |
| **排序操作** | ❌ 不支持 | ✅ 叶子节点有序 |
| **最左前缀** | ❌ 不支持 | ✅ 支持 |
| **模糊查询** | ❌ 不支持 | ✅ 支持前缀匹配（LIKE 'abc%'） |
| **NULL 值** | 取决于实现 | ✅ 支持 |
| **哈希冲突** | 存在，影响性能 | 不存在 |
| **适用引擎** | Memory、InnoDB(AHI) | InnoDB、MyISAM |
| **典型场景** | 缓存表、等值精确匹配 | 通用 OLTP 查询 |
| **索引占用空间** | 较小 | 较大（存储完整键值） |

**选择建议：**
- 绝大多数场景使用 B+Tree 索引即可，它是最通用的选择
- 只有在纯等值查询且数据量可控的缓存表场景，才考虑 Memory 引擎的 Hash 索引
- InnoDB 的自适应哈希索引（AHI）会自动为热点页面建立哈希索引，无需手动管理

---

### 1.3 全文索引（Full-Text Index）

全文索引用于在文本数据中进行关键词搜索，MySQL 5.6+ InnoDB 引擎开始支持。适用于 `MATCH AGAINST` 语法，不适用于普通的 `WHERE` 条件。

#### 创建与使用示例

```sql
-- 创建测试表
CREATE TABLE articles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 创建全文索引（可以对单列或多列创建）
CREATE FULLTEXT INDEX ft_title ON articles(title);
CREATE FULLTEXT INDEX ft_content ON articles(title, content);
```

#### 三种搜索模式

```sql
-- 1. 自然语言模式（Natural Language Mode）
--    返回包含搜索词的记录，按相关性排序
SELECT *, MATCH(title, content) AGAINST('数据库索引优化' IN NATURAL LANGUAGE MODE) AS score
FROM articles
WHERE MATCH(title, content) AGAINST('数据库索引优化' IN NATURAL LANGUAGE MODE);
-- score > 0 的记录才包含匹配内容

-- 2. 布尔模式（Boolean Mode）
--    支持 +（必须包含）、-（必须排除）、*（通配符）等操作符
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('+数据库 +索引 -MySQL' IN BOOLEAN MODE);
-- 必须包含"数据库"和"索引"，且不包含"MySQL"

-- 3. 查询扩展模式（Query Expansion Mode）
--    先执行一次自然语言搜索，再用搜索结果中的词进行第二轮搜索
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('索引' WITH QUERY EXPANSION);
```

#### 中文全文索引配置

MySQL 默认的全文索引解析器对中文分词效果较差，需要使用 `ngram` 解析器：

```sql
-- 修改 MySQL 配置（my.cnf / my.ini）
-- [mysqld]
-- ngram_token_size=2

-- 创建使用 ngram 解析器的全文索引
ALTER TABLE articles ADD FULLTEXT INDEX ft_title_ngram (title) WITH PARSER ngram;
ALTER TABLE articles ADD FULLTEXT INDEX ft_content_ngram (title, content) WITH PARSER ngram;

-- 使用 ngram 解析器进行搜索
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('数据库' IN BOOLEAN MODE);
```

#### EXPLAIN 输出

```sql
EXPLAIN SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('数据库索引');
-- type: fulltext, key: ft_content, Extra: Using where
```

**特点：**
- 支持自然语言搜索、布尔搜索和查询扩展搜索
- 适合 `CHAR`、`VARCHAR`、TEXT` 类型的列
- 对中文分词效果有限，通常需要配合 ngram 解析器
- 只有 MyISAM 和 InnoDB（MySQL 5.6+）支持
- 全文索引比普通索引占用更多存储空间

---

### 1.4 R-Tree 索引（空间索引 / Spatial Index）

R-Tree 索引用于处理空间数据类型（如 `GEOMETRY`、`POINT`、`POLYGON`），MyISAM 和 InnoDB（MySQL 5.7+）均支持。适用于地理信息系统（GIS）相关的查询。

#### 空间索引结构

```
               [MBR: 整个区域]                    ← 根节点
              /        |        \
    [MBR: 北区]    [MBR: 中区]    [MBR: 南区]      ← 中间节点
     /    \          /    \          /    \
  [P1]  [P2]     [P3]  [P4]     [P5]  [P6]       ← 叶子节点（空间对象）
```

每个节点存储一个 **MBR（最小边界矩形）**，用于快速排除不相关的空间对象。

#### 创建与使用示例

```sql
-- 创建包含空间数据的表
CREATE TABLE locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    position POINT NOT NULL SRID 4326,
    SPATIAL INDEX sp_pos (position)
) ENGINE=InnoDB;

-- 插入地理位置数据
INSERT INTO locations (name, position) VALUES
('北京天安门', ST_GeomFromText('POINT(116.397 39.908)', 4326)),
('上海东方明珠', ST_GeomFromText('POINT(121.499 31.239)', 4326)),
('广州塔', ST_GeomFromText('POINT(113.324 23.106)', 4326)),
('深圳市民中心', ST_GeomFromText('POINT(114.057 22.543)', 4326));
```

#### 常用空间查询函数

```sql
-- 1. ST_Contains：判断一个几何对象是否完全包含另一个
SELECT * FROM locations
WHERE ST_Contains(
    ST_GeomFromText('POLYGON((113 22, 114 22, 114 23, 113 23, 113 22))', 4326),
    position
);

-- 2. ST_Distance：计算两点之间的距离
SELECT name, ST_Distance_Sphere(
    position,
    ST_GeomFromText('POINT(116.397 39.908)', 4326)
) AS distance_meters
FROM locations
ORDER BY distance_meters;

-- 3. ST_Within：判断点是否在指定范围内
SELECT * FROM locations
WHERE ST_Within(
    position,
    ST_GeomFromText('POLYGON((113 22, 115 22, 115 24, 113 24, 113 22))', 4326)
);

-- 4. MBRContains：使用最小边界矩形进行快速筛选
SELECT * FROM locations
WHERE MBRContains(
    ST_GeomFromText('POLYGON((113 22, 115 22, 115 24, 113 24, 113 22))', 4326),
    position
);
```

#### EXPLAIN 输出

```sql
EXPLAIN SELECT * FROM locations
WHERE ST_Contains(
    ST_GeomFromText('POLYGON((113 22, 115 22, 115 24, 113 24, 113 22))', 4326),
    position
);
-- type: range, key: sp_pos, Extra: Using where
```

**特点：**
- 支持空间数据的最近邻查询、包含查询、相交查询
- 底层使用 MBR（最小边界矩形）组织数据
- 只能对空间数据类型列创建（POINT、LINESTRING、POLYGON 等）
- MySQL 5.7+ InnoDB 引擎支持，MyISAM 也支持

---

## 二、各种索引类型的 EXPLAIN 输出对比

以下表格总结了不同索引类型在 EXPLAIN 中的典型输出：

| 索引类型 | type 列值 | key 列 | Extra 列 | 典型 SQL |
| :--- | :--- | :--- | :--- | :--- |
| B+Tree（等值） | `ref` 或 `const` | 索引名 | Using index condition | `WHERE name = '张三'` |
| B+Tree（范围） | `range` | 索引名 | Using index condition | `WHERE age BETWEEN 20 AND 30` |
| B+Tree（覆盖） | `ref` | 索引名 | **Using index** | 只查询索引列 |
| Hash（等值） | `ref` | 索引名 | Using hash index | `WHERE name = 'test'` |
| Full-Text | `fulltext` | 索引名 | Using where | `MATCH(...) AGAINST(...)` |
| Spatial | `range` | 空间索引名 | Using where | `ST_Contains(...)` |

**关键字段解读：**
- **type**：访问类型，从优到差依次为 `system > const > eq_ref > ref > range > index > ALL`
- **key**：实际使用的索引名称
- **Extra**：附加信息，`Using index` 表示覆盖索引，`Using where` 表示服务层过滤

---

## 三、索引类型综合对比表

| 对比维度 | B+Tree 索引 | Hash 索引 | Full-Text 全文索引 | R-Tree 空间索引 |
| :--- | :--- | :--- | :--- | :--- |
| **底层结构** | 多路平衡搜索树 | 哈希表 | 倒排索引 | MBR 树 |
| **等值查询** | ✅ 优秀 O(log n) | ✅ 极快 O(1) | — | — |
| **范围查询** | ✅ 高效 | ❌ 不支持 | — | ✅ 空间范围 |
| **排序支持** | ✅ 叶子节点有序 | ❌ 不支持 | ❌ | ❌ |
| **模糊查询** | ✅ 前缀匹配 | ❌ 不支持 | ✅ 关键词搜索 | ❌ |
| **最左前缀** | ✅ 支持 | ❌ 不支持 | — | — |
| **NULL 处理** | ✅ 支持 | 取决于实现 | ✅ | ✅ |
| **适用数据类型** | 所有类型 | 所有类型 | CHAR/VARCHAR/TEXT | 空间数据类型 |
| **适用引擎** | InnoDB、MyISAM | Memory、InnoDB(AHI) | InnoDB(5.6+)、MyISAM | InnoDB(5.7+)、MyISAM |
| **存储开销** | 中等 | 较小 | 较大 | 中等 |
| **典型场景** | 通用查询、排序、范围扫描 | 缓存表、等值精确匹配 | 文章搜索、内容检索 | GIS 地理位置查询 |

---

## 四、如何选择索引类型

1. **常规业务查询**：优先使用默认的 B+Tree 索引，它覆盖了绝大多数查询场景
2. **纯等值查询**（如缓存表）：可考虑 Memory 引擎的 Hash 索引
3. **文本搜索需求**：使用全文索引，注意中文需配置 ngram 分词
4. **地理位置相关**：使用 R-Tree 空间索引

> **提示**：InnoDB 的自适应哈希索引（AHI）会自动为热点 B-Tree 页面建立哈希索引，无需手动管理，可通过 `SHOW ENGINE INNODB STATUS` 查看 AHI 的使用情况。

---

## 五、从应用层次来分

从应用层次来看，索引可以分为以下几类：

| 索引类型 | 说明 | 示例 |
| :--- | :--- | :--- |
| 主键索引 | 一个表只能有一个，自动创建，不允许 NULL | `PRIMARY KEY (id)` |
| 普通索引 | 一个索引只包含一个列，一个表可以有多个 | `INDEX idx_name (name)` |
| 唯一索引 | 索引列的值必须唯一，但允许有空值 | `UNIQUE INDEX idx_email (email)` |
| 复合索引 | 多列值组成一个索引，效率大于索引合并 | `INDEX idx_name_age (name, age)` |
| 空间索引 | 用于空间数据类型列 | `SPATIAL INDEX sp_pos (position)` |

```sql
-- 各种应用层次索引的创建示例
CREATE TABLE users (
    id INT AUTO_INCREMENT,
    name VARCHAR(50),
    email VARCHAR(100),
    age INT,
    PRIMARY KEY (id),                          -- 主键索引
    INDEX idx_name (name),                     -- 普通索引
    UNIQUE INDEX idx_email (email),            -- 唯一索引
    INDEX idx_name_age (name, age)             -- 复合索引（联合索引）
) ENGINE=InnoDB;
```

---

## 六、根据数据物理顺序与键值逻辑顺序关系

| 索引类型 | 概念 |
| :--- | :--- |
| 聚簇索引（Clustered Index） | 也称为主键索引，是一种数据存储方式。B+Tree 结构，非叶子节点包含键值和指针，叶子节点包含索引列和行数据。一张表只能有一个聚簇索引。 |
| 非聚簇索引（Non-Clustered Index） | 不是聚簇索引，就是非聚簇索引。叶子节点只存索引列和主键 id。如果 SQL 还要返回除了索引列的其他字段信息，需要回表。第一次索引一般是顺序 IO，回表的操作属于随机 IO。回表的次数越多，性能越差。 |

![索引性能优化](/images/content/databases-001-content-2.jpg)

> **相关阅读**：聚簇索引与非聚簇索引的详细对比，请参阅 [聚簇索引与非聚簇索引](/categories/Databases/clustered-vs-nonclustered/)。

---

## 总结

| 索引类型 | 概念 |
| :--- | :--- |
| 普通索引 | 一个索引只包含一个列，一个表可以有多个单列索引 |
| 唯一索引 | 索引列的值必须唯一，但允许有空值 |
| 复合索引 | 多列值组成一个索引，专门用于组合搜索，其效率大于索引合并 |
| 聚簇索引 | 也称为主键索引，是一种数据存储方式。B+Tree 结构，非叶子节点包含键值和指针，叶子节点包含索引列和行数据。一张表只能有一个聚簇索引。 |
| 非聚簇索引 | 不是聚簇索引，就是非聚簇索引。叶子节点只存索引列和主键 id。如果 SQL 还要返回除了索引列的其他字段信息，需要回表，第一次索引一般是顺序 IO，回表的操作属于随机 IO。回表的次数越多，性能越差。 |

---

## 相关阅读

- [索引的概念](/categories/Databases/concept/)
- [索引采用的算法（为什么选择 B+Tree）](/categories/Databases/b-tree/)
- [索引底层实现](/categories/Databases/implementation/)
- [聚簇索引与非聚簇索引](/categories/Databases/clustered-vs-nonclustered/)
- [索引的最左前缀原则](/categories/Databases/leftmost-prefix-rule/)
- [覆盖索引（Covering Index）](/categories/Databases/covering-index/)
- [索引的优缺点](/categories/Databases/pros-and-cons/)
