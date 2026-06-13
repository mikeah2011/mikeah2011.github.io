---

title: MySQL 索引底层实现：B+Tree 数据结构与存储引擎原理
keywords: [MySQL, Tree, 索引底层实现, 数据结构与存储引擎原理, 数据库]
tags:
- MySQL
- 索引
- B+Tree
- InnoDB
categories:
  - database
date: 2015-03-20 15:05:07
description: 深入解析MySQL索引的四种底层实现结构：Hash索引基于哈希表实现等值查询O(1)但不支持范围查询；B+Tree索引是InnoDB和MyISAM的默认选择，支持范围查询、排序和最左前缀匹配；全文索引（FULLTEXT）采用倒排索引实现自然语言搜索；R-Tree索引基于多维树结构处理GIS空间数据查询。本文详解各结构原理、适用场景与常见陷阱。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-016-content-1.jpg
- /images/content/databases-016-content-2.jpg
---





## 前言

MySQL 索引是数据库性能优化的基石。在面对海量数据时，合理的索引设计可以将查询时间从秒级降低到毫秒级，而不合理的索引甚至会导致全表扫描，让数据库性能急剧下降。理解索引的底层数据结构，能帮助我们写出更高效的 SQL、避免索引失效的陷阱、在面试中从容应对相关问题。

MySQL 中常用的索引实现结构主要有四种：**Hash 索引**、**B+Tree 索引**、**全文索引（FULLTEXT）** 和 **R-Tree 索引**。这四种索引分别适用于不同的查询场景和数据类型。其中 B+Tree 索引是使用最广泛的，在 InnoDB 存储引擎中承担了绝大多数查询加速的工作。本文将逐一深入分析每种索引结构的内部原理、适用场景与局限性，并通过实际 SQL 示例演示索引的创建与 EXPLAIN 执行计划的解读，最后总结索引失效的常见陷阱，帮助开发者在实际项目中做出正确的索引选型决策。

---

## 一、Hash 索引

### 1.1 原理

Hash 索引基于哈希表实现。对于每一行数据，存储引擎会对索引列计算一个哈希码（hash code），并将其存储在哈希表中，同时在哈希表中保存指向数据行的指针。

查找时，MySQL 对查询条件同样计算哈希码，然后直接定位到对应的桶（bucket），再遍历桶中的链表找到匹配的行。哈希查找的时间复杂度为 **O(1)**，在等值查询场景下极为高效。

![图片](/images/644.png)

### 1.2 适用场景

Hash 索引的应用场景相对有限，但在以下场景中能发挥显著优势：

- **精确等值查询**：`WHERE col = 'value'` 形式的查询，Hash 索引效率最高，时间复杂度为 O(1)，远优于 B+Tree 的 O(log n)。
- **Memory 存储引擎**：MySQL 的 Memory 引擎默认使用 Hash 索引，适合做临时表或缓存表。由于 Memory 引擎的数据存储在内存中，配合 Hash 索引可以实现极快的等值查找。
- **InnoDB 自适应哈希索引（AHI）**：InnoDB 内部会自动监控 B+Tree 索引的访问模式，当检测到某些索引页被频繁访问时，会自动在内存中为这些页面构建哈希索引，称为自适应哈希索引（Adaptive Hash Index）。这个过程完全由 InnoDB 自动管理，用户无需手动创建或维护。可以通过 `SHOW ENGINE INNODB STATUS` 命令查看 AHI 的使用情况和命中率。

### 1.3 局限性

Hash 索引虽然等值查询极快，但在实际生产中的应用场景非常有限，主要因为以下严重限制：

| 局限性 | 说明 |
| --- | --- |
| **不支持范围查询** | `WHERE id > 100` 无法使用 Hash 索引，因为哈希值之间没有顺序关系，无法确定范围边界 |
| **不支持排序** | `ORDER BY` 无法利用 Hash 索引，哈希值是无序的，无法提供排序所需的有序遍历 |
| **不支持最左前缀** | 联合 Hash 索引不能像 B+Tree 那样利用最左前缀规则，只能精确匹配所有索引列 |
| **存在哈希冲突** | 当多个键映射到同一哈希值时，需要遍历链表，最坏情况退化为 O(n)，影响查询稳定性 |
| **仅支持 Memory 引擎** | InnoDB 和 MyISAM 的普通索引不使用 Hash 结构，限制了 Hash 索引的使用范围 |

### 1.4 实际示例

```sql
-- Memory 引擎下的 Hash 索引
CREATE TABLE user_cache (
    id INT NOT NULL,
    username VARCHAR(64) NOT NULL,
    email VARCHAR(128),
    PRIMARY KEY (id) USING HASH,
    INDEX idx_username (username) USING HASH
) ENGINE = MEMORY;

-- 等值查询走 Hash 索引
SELECT * FROM user_cache WHERE username = 'alice';
```

> **注意**：InnoDB 中无法显式创建 Hash 索引，它只在内存中由自适应哈希索引机制自动维护。

---

## 二、B+Tree 索引（MySQL 核心索引结构）

### 2.1 B-Tree 简介

B-Tree（Balance Tree，平衡多路搜索树）是一种自平衡的树数据结构，能够保持数据有序，同时支持高效的插入、删除和查找操作。B-Tree 能够加快数据的访问速度，因为存储引擎不再需要进行全表扫描来获取数据，数据分布在各个节点之中。B-Tree 的每个节点可以有多个子节点（多路），这使得树的高度始终保持在较低水平，从而减少了磁盘 IO 的次数。

![图片](/images/6410.png)

![MySQL数据库索引结构](/images/content/databases-016-content-1.jpg)

B-Tree 中每个节点既存储索引键值，也存储对应的数据行指针。这意味着内部节点也能直接返回数据，但同时也导致每个节点能容纳的键值数量减少，树的高度相对较高，磁盘 IO 次数更多。

### 2.2 B+Tree 结构详解

B+Tree 是 B-Tree 的改进版本，也是 MySQL InnoDB 和 MyISAM 存储引擎实际采用的索引存储结构。

![B+Tree数据库索引原理](/images/content/databases-016-content-2.jpg)

B+Tree 与 B-Tree 的核心区别在于：

- **数据只存在叶子节点**：内部节点（非终端节点）只存储索引键值和子节点指针，不存储实际数据。这使得内部节点能容纳更多的键值，扇出（fan-out）更大，树的高度更低。举个直观的例子，如果一个 B-Tree 的内部节点既能存键又能存数据，可能只能容纳 100 个键值对；而 B+Tree 的内部节点只存键和指针，同样的空间可以容纳上千个键值对，这意味着同样数据量下 B+Tree 的层数更少，磁盘 IO 次数也更少。
- **叶子节点形成有序双向链表**：所有叶子节点通过指针按关键字大小顺序连接，支持高效的范围扫描和顺序访问。当执行 `WHERE id BETWEEN 100 AND 500` 这样的范围查询时，B+Tree 只需要定位到起始叶子节点，然后沿着链表顺序读取即可，不需要回溯到父节点。而 B-Tree 则需要中序遍历整棵树，效率远低于 B+Tree。

#### B+Tree 节点结构

```
┌─────────────────────────────────────────────┐
│              内部节点 (Internal Page)          │
│  [Key1 | Key2 | Key3 | ... | KeyN]          │
│  [Ptr0| Ptr1| Ptr2| ... | PtrN]             │
│  → 不存储数据行，只存储键值和子节点指针          │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│              叶子节点 (Leaf Page)              │
│  [Key1, Data1] [Key2, Data2] ... [KeyN,DataN]│
│  ← prev ──── next → (双向链表)                │
│  → 存储完整的索引键值和对应的数据/主键指针        │
└─────────────────────────────────────────────┘
```

#### InnoDB 中的页大小与树高

InnoDB 的最小存储单元是 **页（Page）**，默认大小为 **16KB**。在 InnoDB 中：

- 假设主键为 `BIGINT`（8 字节），指针占 6 字节，每个键值对约占 14 字节。
- 一个内部节点大约可容纳：`16384 / 14 ≈ 1170` 个键。
- 假设每行数据约 1KB，一个叶子节点可存储约 `16384 / 1024 ≈ 16` 行数据。
- **两层 B+Tree**：1170 × 16 ≈ **18,720** 条记录。
- **三层 B+Tree**：1170 × 1170 × 16 ≈ **21,902,400**（约 2000 万）条记录。

也就是说，**三层 B+Tree 就能索引两千万行数据**，通常只需 3 次磁盘 IO 即可定位任意行，这就是 B+Tree 的巨大优势。在实际生产环境中，大多数单表的数据量都在千万级别以内，因此三层 B+Tree 已经能满足绝大部分业务需求。如果单表数据量超过两千万，通常需要考虑分库分表或者归档历史数据。

此外，B+Tree 的查询性能非常稳定。无论查找的是最大值、最小值还是中间任意位置的数据，所需的磁盘 IO 次数都是相同的（等于树的高度）。这种稳定的查询性能对于在线事务处理（OLTP）系统来说至关重要。

### 2.3 B+Tree 性质总结

- n 棵子树的节点包含 n 个关键字，**不用来保存数据**，而是保存数据的索引。
- 所有的叶子节点包含了全部关键字的信息，及指向含这些关键字记录的指针，且叶子节点本身依关键字的大小自小而大顺序链接。
- 所有的非终端节点可以看成是索引部分，节点中仅含其子树中的最大（或最小）关键字。
- B+ 树中，数据对象的插入和删除仅在叶节点上进行。
- B+ 树有 2 个头指针，一个是树的根节点，一个是最小关键码的叶节点。

![图片](/images/6402.png)

### 2.4 B+Tree 的索引类型

在 InnoDB 中，B+Tree 索引按存储内容分为两种：

| 类型 | 叶子节点存储内容 | 说明 |
| --- | --- | --- |
| **聚簇索引（Clustered Index）** | 完整的行数据 | 主键索引，一张表只有一个 |
| **二级索引（Secondary Index）** | 主键的值 | 非主键索引，查询时可能需要「回表」 |

聚簇索引将数据和索引存放在一起，找到索引就等于找到了数据行，因此主键查询的效率非常高。而二级索引的叶子节点只存储了主键值，当通过二级索引查找到目标记录后，还需要根据主键值回到聚簇索引中查找完整的行数据，这个过程称为「回表」。回表操作会增加额外的磁盘 IO，因此在设计索引时应尽量使用覆盖索引来避免回表。

### 2.5 EXPLAIN 分析示例

```sql
-- 准备测试表
CREATE TABLE employees (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    department VARCHAR(32) NOT NULL,
    salary DECIMAL(10,2) NOT NULL,
    hire_date DATE NOT NULL,
    INDEX idx_dept_salary (department, salary),
    INDEX idx_name (name)
) ENGINE = InnoDB;

-- 插入测试数据
INSERT INTO employees (name, department, salary, hire_date) VALUES
('张三', '技术部', 15000.00, '2020-01-15'),
('李四', '技术部', 18000.00, '2019-06-20'),
('王五', '市场部', 12000.00, '2021-03-10'),
('赵六', '市场部', 13500.00, '2020-08-25'),
('钱七', '财务部', 16000.00, '2018-11-01');

-- 使用 EXPLAIN 查看索引使用情况
EXPLAIN SELECT * FROM employees WHERE department = '技术部' AND salary > 16000;
```

EXPLAIN 输出关键字段解读：

| 字段 | 说明 | 示例值 |
| --- | --- | --- |
| `type` | 访问类型，从好到差依次为 system > const > eq_ref > ref > range > index > ALL | `range` 表示范围扫描 |
| `key` | 实际使用的索引，NULL 表示未使用索引 | `idx_dept_salary` |
| `key_len` | 使用的索引长度（字节），可用于判断联合索引使用了几个列 | `106` |
| `rows` | 预估需要扫描的行数，数值越小越好 | `2` |
| `Extra` | 额外信息，包含索引下推、文件排序等重要提示 | `Using index condition` 表示索引下推 |

其中 `type` 字段是判断查询性能的关键指标。`const` 表示通过主键或唯一索引精确匹配一行，性能最优；`ref` 表示通过非唯一索引查找匹配的行；`range` 表示范围扫描（如 `BETWEEN`、`>`、`<` 等）；而 `ALL` 表示全表扫描，通常意味着需要添加索引或优化查询语句。`Extra` 字段中的 `Using index` 表示覆盖索引，`Using filesort` 表示需要额外的排序操作，`Using temporary` 表示需要创建临时表。

```sql
-- 范围查询：利用 B+Tree 的有序性
EXPLAIN SELECT * FROM employees WHERE salary BETWEEN 14000 AND 17000;
-- 结果：type=range, key=idx_dept_salary（可能只用了部分索引）

-- 排序：B+Tree 叶子节点有序，避免 filesort
EXPLAIN SELECT * FROM employees WHERE department = '技术部' ORDER BY salary;
-- 结果：Extra 中无 Using filesort，说明利用了索引排序

-- 全表扫描：没有可用索引
EXPLAIN SELECT * FROM employees WHERE YEAR(hire_date) = 2020;
-- 结果：type=ALL, key=NULL，函数作用在索引列上导致索引失效
```

---

## 三、全文索引（FULLTEXT Index）

### 3.1 原理

全文索引是一种特殊类型的索引，用于在文本数据中进行关键词搜索。与 B+Tree 不同，全文索引采用 **倒排索引（Inverted Index）** 结构——将文本内容拆分为一个个词项（token），建立「词项 → 文档列表」的映射关系。倒排索引是搜索引擎（如 Elasticsearch、Apache Lucene）的核心数据结构，MySQL 在 5.6 版本开始支持 InnoDB 引擎的全文索引。

全文索引的构建过程如下：首先对文本字段进行分词处理（Tokenization），将连续的文本切分为独立的词项；然后为每个词项建立一个包含该词项的所有文档 ID 的列表；查询时，MySQL 先对搜索关键词进行同样的分词处理，然后在倒排索引中查找对应的文档列表，最终返回匹配的行。

例如，对于以下数据：

| id | content |
| --- | --- |
| 1 | MySQL is a relational database |
| 2 | Redis is a key-value store |
| 3 | MySQL supports full-text search |

倒排索引大致结构为：

| 词项 | 出现的文档 ID |
| --- | --- |
| mysql | 1, 3 |
| relational | 1 |
| database | 1 |
| redis | 2 |
| full-text | 3 |

### 3.2 创建与使用

```sql
-- 创建全文索引（InnoDB 从 MySQL 5.6 开始支持）
CREATE TABLE articles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    FULLTEXT INDEX ft_title_body (title, body)
) ENGINE = InnoDB;

-- 插入测试数据
INSERT INTO articles (title, body) VALUES
('MySQL索引优化', '本文详细介绍MySQL索引的底层实现原理，包括B+Tree和Hash索引'),
('Redis缓存策略', 'Redis作为内存数据库，采用哈希表实现高性能的键值存储'),
('PostgreSQL全文搜索', 'PostgreSQL提供了强大的全文搜索功能，支持多种语言的分词');

-- 自然语言模式搜索
SELECT * FROM articles
WHERE MATCH(title, body) AGAINST('MySQL 索引' IN NATURAL LANGUAGE MODE);

-- 布尔模式搜索
SELECT * FROM articles
WHERE MATCH(title, body) AGAINST('+MySQL -Redis' IN BOOLEAN MODE);
-- +MySQL 表示必须包含 MySQL，-Redis 表示不包含 Redis
```

### 3.3 注意事项

使用全文索引时需要注意以下几点：

- **最小词长限制**：MySQL 默认不索引长度小于 3 的词（由 `ft_min_word_len` 控制）。修改此参数后需要重建全文索引才能生效。
- **停用词**：常见词（如 "the"、"is"、"的"、"了"）会被忽略，不纳入索引。MySQL 维护了一个停用词列表，可以在配置文件中自定义。
- **中文支持**：MySQL 内置的分词器基于空格和标点进行切分，对中文支持较差（中文词语之间没有空格分隔）。因此需要借助 `ngram` 解析器来实现中文全文搜索。ngram 将连续文本按固定长度（默认为 2）切分为 token，虽然不如专业的中文分词器准确，但能满足基本的搜索需求。
- **仅支持 InnoDB 和 MyISAM**：其他存储引擎不支持全文索引。
- **性能考量**：全文索引在数据量较大时会占用较多的存储空间，且更新操作（插入、删除、修改）的开销也较大。对于搜索频率高、更新频率低的场景最为适用。如果需要复杂的全文搜索功能（如模糊搜索、同义词替换、搜索结果排序），建议使用 Elasticsearch 等专业的全文搜索引擎。

```sql
-- 使用 ngram 分词器支持中文全文搜索
ALTER TABLE articles ADD FULLTEXT INDEX ft_body_ngram (body) WITH PARSER ngram;
```

- **仅支持 InnoDB 和 MyISAM**：其他存储引擎不支持全文索引。

---

## 四、R-Tree 索引（空间索引）

### 4.1 原理

R-Tree（Range Tree，范围树）是一种专门用于处理多维空间数据的树状数据结构。R-Tree 通过 **最小外接矩形（MBR, Minimum Bounding Rectangle）** 将空间对象分组，形成层次化的树结构。R-Tree 可以看作是 B+Tree 在多维空间上的扩展，它将一维的有序索引推广到了二维甚至更高维度。

在 GIS 应用中，用户经常需要执行「查找距离我最近的餐厅」、「判断某个坐标是否在某个区域内」等空间查询。传统的 B+Tree 只能处理一维数据的范围查询，无法高效地处理多维空间数据的检索。R-Tree 通过将空间对象层层聚类并用最小外接矩形包裹，有效地将多维空间搜索转化为树的遍历操作。

R-Tree 的核心思想：

- 每个叶子节点存储空间对象的 MBR 和指向数据的指针。
- 每个内部节点存储子节点 MBR 的并集。
- 查询时从根节点出发，判断查询区域与各 MBR 的交集，逐步缩小搜索范围。

### 4.2 使用场景

R-Tree 索引主要用于 **GIS（地理信息系统）** 场景，例如：

- 查找某个经纬度范围内的餐厅、酒店、加油站等兴趣点（POI）
- 计算两个地点之间的地理距离，实现「附近的店」功能
- 判断一个点是否在某个多边形区域内（如配送区域、行政边界）
- 道路网络中计算最短路径时的空间索引加速

在互联网应用中，R-Tree 索引常被用于外卖平台的配送范围判断、地图应用的周边搜索、出行平台的附近车辆匹配等场景。如果项目中有类似需求，可以考虑使用 MySQL 的空间索引，或者更专业的 PostGIS（PostgreSQL 的空间扩展）。

### 4.3 创建与使用

```sql
-- 创建包含空间数据的表
CREATE TABLE locations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    position POINT NOT NULL SRID 4326,
    SPATIAL INDEX idx_position (position)
) ENGINE = InnoDB;

-- 插入空间数据
INSERT INTO locations (name, position) VALUES
('天安门', ST_GeomFromText('POINT(116.397 39.916)', 4326)),
('故宫', ST_GeomFromText('POINT(116.397 39.919)', 4326)),
('颐和园', ST_GeomFromText('POINT(116.275 39.999)', 4326));

-- 空间查询：查找指定范围内的地点
SELECT name, ST_AsText(position) FROM locations
WHERE ST_Contains(
    ST_GeomFromText('POLYGON((116.3 39.9, 116.4 39.9, 116.4 39.95, 116.3 39.95, 116.3 39.9))', 4326),
    position
);
```

### 4.4 注意事项

- R-Tree 索引仅支持 `GEOMETRY`、`POINT`、`LINESTRING`、`POLYGON` 等空间数据类型，不能用于普通的数值或字符串列。
- MySQL 5.7+ 的 InnoDB 引擎支持空间索引（之前仅 MyISAM 支持）。
- 创建空间索引前，需要先确保列使用了空间数据类型。
- R-Tree 索引的查询需要使用 MySQL 提供的空间函数，如 `ST_Contains`、`ST_Distance`、`ST_Within` 等。

---

## 五、四种索引类型对比

| 特性 | Hash 索引 | B+Tree 索引 | 全文索引 | R-Tree 索引 |
| --- | --- | --- | --- | --- |
| **数据结构** | 哈希表 | 多路平衡搜索树 | 倒排索引 | 多维范围树 |
| **等值查询** | O(1)，极快 | O(log n) | 不适用 | 不适用 |
| **范围查询** | ❌ 不支持 | ✅ 高效 | ❌ 不适用 | ✅ 高效 |
| **排序** | ❌ 不支持 | ✅ 天然有序 | ❌ 不适用 | ❌ 不适用 |
| **最左前缀** | ❌ 不支持 | ✅ 支持 | ❌ 不适用 | ❌ 不适用 |
| **适用引擎** | Memory、InnoDB(AHI) | InnoDB、MyISAM 等 | InnoDB、MyISAM | InnoDB、MyISAM |
| **典型场景** | 缓存等值查找 | OLTP 通用查询 | 文本搜索 | GIS 空间查询 |
| **MySQL 使用率** | 低（受限太多） | **极高（默认选择）** | 中（特定场景） | 低（GIS 专用） |

---

## 六、索引失效的常见陷阱

在实际开发中，即使表上建立了索引，某些写法也会导致 MySQL 优化器放弃使用索引而退化为全表扫描。以下是几种最常见的索引失效场景，每位开发者都应该熟记于心：

### 6.1 对索引列使用函数

```sql
-- ❌ 索引失效：函数作用在索引列上
EXPLAIN SELECT * FROM employees WHERE YEAR(hire_date) = 2020;
-- type=ALL, key=NULL

-- ✅ 改写为范围查询，利用索引
EXPLAIN SELECT * FROM employees WHERE hire_date >= '2020-01-01' AND hire_date < '2021-01-01';
-- type=range, key=hire_date_idx
```

### 6.2 隐式类型转换

```sql
-- 假设 phone 列为 VARCHAR 类型，有索引 idx_phone

-- ❌ 索引失效：传入整数，MySQL 会将 VARCHAR 转为数字比较
EXPLAIN SELECT * FROM users WHERE phone = 13800138000;
-- type=ALL, key=NULL（隐式转换导致索引失效）

-- ✅ 传入字符串，正确使用索引
EXPLAIN SELECT * FROM users WHERE phone = '13800138000';
-- type=ref, key=idx_phone
```

### 6.3 LIKE 以通配符开头

```sql
-- ❌ 索引失效：前缀未知，无法利用 B+Tree 的有序性
EXPLAIN SELECT * FROM employees WHERE name LIKE '%三';
-- type=ALL, key=NULL

-- ✅ 前缀匹配可以使用索引
EXPLAIN SELECT * FROM employees WHERE name LIKE '张%';
-- type=range, key=idx_name
```

### 6.4 OR 条件中部分列无索引

```sql
-- ❌ 如果 age 列没有索引，整个 OR 条件都无法走索引
EXPLAIN SELECT * FROM employees WHERE name = '张三' OR age > 30;
-- type=ALL, key=NULL

-- ✅ 给 age 也加上索引，或改写为 UNION
EXPLAIN
SELECT * FROM employees WHERE name = '张三'
UNION
SELECT * FROM employees WHERE age > 30;
```

### 6.5 联合索引未满足最左前缀

```sql
-- 联合索引 idx_dept_salary (department, salary)

-- ❌ 跳过最左列 department，索引失效
EXPLAIN SELECT * FROM employees WHERE salary > 15000;
-- type=ALL, key=NULL

-- ✅ 从最左列开始使用
EXPLAIN SELECT * FROM employees WHERE department = '技术部' AND salary > 15000;
-- type=range, key=idx_dept_salary
```

> 更多索引失效的详细场景，请参考 [索引失效的 12 种原因](/categories/Databases/ineffective-cases/)。

---

## 七、如何选择索引结构

在实际开发中，绝大多数场景使用 **B+Tree 索引**即可。以下是根据不同业务需求选择索引结构的决策指南：

1. **通用 OLTP 查询**（等值、范围、排序、分组）→ **B+Tree**。这是最常用的场景，包括按 ID 查用户、按时间范围查订单、按状态查任务列表等。B+Tree 的有序性使得它可以同时支持等值查询和范围查询，是 MySQL 的默认索引类型。
2. **纯等值缓存查询**（如 Memory 引擎的临时表）→ **Hash**。如果业务中只做精确匹配，且使用 Memory 引擎，Hash 索引的 O(1) 查找速度优于 B+Tree。但需要注意 Hash 索引不支持范围查询和排序。
3. **文本搜索需求**（文章标题/正文的关键词搜索）→ **FULLTEXT**。当需要在大段文本中搜索关键词时，全文索引比 `LIKE '%keyword%'` 的全表扫描效率高出数个数量级。如果对搜索质量要求更高（如分词准确性、相关性排序），建议使用 Elasticsearch 等专业搜索引擎。
4. **GIS 地理空间查询**（附近的店、区域搜索）→ **R-Tree**。当需要处理经纬度坐标、几何图形等空间数据时，R-Tree 索引是唯一的选择。普通的 B+Tree 无法高效处理多维空间数据的范围查询。

---

## 八、总结

MySQL 索引的底层实现结构决定了查询性能的上限。本文详细介绍了四种索引结构：

- **Hash 索引**：基于哈希表，等值查询极快但限制多，主要用于 Memory 引擎和 InnoDB 自适应哈希索引。
- **B+Tree 索引**：MySQL 的核心索引结构，数据存储在有序的叶子节点上，支持范围查询、排序和最左前缀匹配，是绝大多数场景的首选。
- **全文索引**：基于倒排索引，专门用于文本关键词搜索，配合 ngram 解析器可支持中文搜索。
- **R-Tree 索引**：基于多维范围树，专门用于 GIS 空间数据查询。

在实际开发中，掌握索引失效的常见陷阱（函数作用于索引列、隐式类型转换、LIKE 前缀通配符、违反最左前缀原则等）和 EXPLAIN 执行计划的解读方法，是每位后端开发者的基本功。建议在每次写完 SQL 后都使用 EXPLAIN 检查索引使用情况，确保查询性能符合预期。

---

## 相关阅读

- [索引的概念](/categories/Databases/concept/) — 从零理解什么是索引以及索引如何优化查询
- [索引的类型](/categories/Databases/types/) — 按存储结构和应用层次分类索引类型
- [索引采用的算法](/categories/Databases/b-tree/) — 为什么 MySQL 选择 B+Tree 而非 B-Tree 或红黑树
- [聚簇索引与非聚簇索引](/categories/Databases/clustered-vs-nonclustered/) — 理解 InnoDB 中数据的物理存储方式
- [索引失效的 12 种原因](/categories/Databases/ineffective-cases/) — 建了索引却不走？排查索引失效的经典场景