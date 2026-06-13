---

title: 聚簇索引与非聚簇索引
tags:
- MySQL
- 索引
- 聚簇索引
- InnoDB
- B+Tree
- 性能优化
categories:
  - database
keywords: [聚簇索引与非聚簇索引]
date: 2015-10-03 20:14:56
description: 深入解析 MySQL 聚簇索引与非聚簇索引的底层原理与性能差异。通过 B+ Tree 结构图解、回表查询过程演示、InnoDB 索引选择规则详解，帮助开发者理解为什么主键查询最快、二级索引需要回表、覆盖索引能避免回表。附 UUID vs 自增主键的性能对比测试数据和 Laravel 项目中的最佳实践建议。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/db-1-content-1.jpg
- /images/content/db-1-content-2.jpg
---



在 MySQL 的 InnoDB 存储引擎中，索引是基于 B+ Tree 数据结构实现的。根据叶子节点存储内容的不同，索引被划分为**聚簇索引（Clustered Index）**和**非聚簇索引（Non-Clustered Index，也称二级索引、Secondary Index）**两大类。理解这两者的底层差异，是掌握 MySQL 查询性能优化的关键基础。

<!-- more -->

## 什么是聚簇索引？

在 InnoDB 中，**聚簇索引的叶子节点存储的是完整的行数据**。也就是说，数据表本身就是按照主键的顺序以 B+ Tree 的结构组织的——找到索引就等于找到了数据。聚簇索引并不是一种单独的索引类型，而是一种**数据存储方式**。

### InnoDB 聚簇索引的 B+ Tree 结构

```
                    [30 | 60]                    ← 非叶子节点（索引页）
                   /    |    \
                  /     |     \
        [10|20]      [40|50]      [70|80]        ← 非叶子节点（索引页）
        / | \        / | \        / | \
       ↓  ↓  ↓      ↓  ↓  ↓      ↓  ↓  ↓
    ┌────┬────┬────┬────┬────┬────┬────┬────┬────┐
    │行10│行20│行30│行40│行50│行60│行70│行80│行N │  ← 叶子节点（数据页）
    └────┴────┴────┴────┴────┴────┴────┴────┴────┘
    叶子节点之间通过双向链表连接，支持高效的范围查询
```

**关键特征：**
- 非叶子节点只存储索引键值（主键值），用于导航
- 叶子节点存储**完整的行数据**（所有列的值）
- 叶子节点之间通过**双向链表**相连，天然支持范围查询（`BETWEEN`、`>`、`<` 等）
- 每张 InnoDB 表**有且仅有一个**聚簇索引

### InnoDB 的聚簇索引选择规则

InnoDB 在创建聚簇索引时，按照以下优先级选择索引键：

1. **主键（PRIMARY KEY）**：如果表定义了主键，InnoDB 会将其作为聚簇索引
2. **第一个唯一非空索引（UNIQUE NOT NULL）**：如果没有主键，InnoDB 会选择第一个所有列都定义为 `NOT NULL` 的唯一索引
3. **隐藏的 ROW_ID**：如果既没有主键也没有合适的唯一索引，InnoDB 会自动生成一个 6 字节的隐藏列 `DB_ROW_ID`，并以此构建聚簇索引

```sql
-- 验证：没有主键的表，InnoDB 仍然会创建聚簇索引
CREATE TABLE no_pk_table (
    name VARCHAR(50),
    age INT
) ENGINE=InnoDB;

-- 此时 InnoDB 使用隐藏的 ROW_ID 作为聚簇索引键
-- 可以通过 INFORMATION_SCHEMA 查看
SELECT * FROM INFORMATION_SCHEMA.INNODB_SYS_TABLES WHERE NAME LIKE '%no_pk%';
```

> **最佳实践**：始终为 InnoDB 表定义主键。使用隐藏 ROW_ID 的表无法通过任何业务字段直接定位行，且在主从复制场景下可能导致问题。

## 什么是非聚簇索引（二级索引）？

**非聚簇索引的叶子节点不存储完整的行数据，而是存储该索引对应的主键值。** 当通过二级索引查找数据时，MySQL 需要先在二级索引中找到对应的主键值，然后再回到聚簇索引中根据主键值查找完整的行数据，这个过程就叫做**回表（Index Lookup / Back to Table）**。

### 回表查询过程详解

假设有一张用户表：

```sql
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50),
    age INT,
    email VARCHAR(100),
    INDEX idx_name (name)
) ENGINE=InnoDB;
```

执行查询 `SELECT * FROM users WHERE name = 'Alice'` 时，完整的查询过程如下：

```
步骤 1：在二级索引 idx_name 的 B+ Tree 中查找 name = 'Alice'
        ↓
        找到叶子节点，获取对应的主键值 id = 5

步骤 2：拿着 id = 5，回到聚簇索引（主键索引）中查找
        ↓
        在聚簇索引的 B+ Tree 中定位 id = 5 的叶子节点

步骤 3：从聚簇索引的叶子节点中读取完整的行数据
        ↓
        返回 (id=5, name='Alice', age=28, email='alice@example.com')
```

**性能影响**：第一次索引查找（步骤 1）通常是**顺序 I/O**，而回表操作（步骤 2）属于**随机 I/O**。需要回表的次数越多，随机 I/O 越频繁，查询性能就越差。当回表次数超过一定阈值时，优化器可能会放弃使用索引而选择全表扫描。

```sql
-- 使用 EXPLAIN 查看是否发生回表
EXPLAIN SELECT * FROM users WHERE name = 'Alice';

-- 关注 Extra 列：
-- 如果显示为空或 Using index condition → 发生了回表
-- 如果显示 Using index → 覆盖索引，不需要回表
```

## 聚簇索引与非聚簇索引的核心区别

| 对比维度 | 聚簇索引 | 非聚簇索引（二级索引） |
|---------|---------|---------------------|
| 叶子节点存储内容 | 完整的行数据 | 主键值（指针） |
| 每张表的数量 | 有且仅有一个 | 可以有多个 |
| 查询效率 | 直接获取数据，无需回表 | 需要回表到聚簇索引获取完整数据 |
| 范围查询性能 | 高（叶子节点有序且相邻） | 较低（需要多次回表） |
| 插入速度 | 依赖主键顺序，乱序插入可能导致页分裂 | 相对独立，影响较小 |
| 索引覆盖 | 天然覆盖所有查询列 | 需要专门设计才能覆盖 |

## EXPLAIN 查看索引类型实战

通过 `EXPLAIN` 可以分析查询是否使用了索引、是否发生了回表：

```sql
-- 创建测试表
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    amount DECIMAL(10, 2),
    status TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_order_no (order_no),
    INDEX idx_user_status (user_id, status)
) ENGINE=InnoDB;

-- 1. 主键查询：直接命中聚簇索引，无需回表
EXPLAIN SELECT * FROM orders WHERE id = 100;
-- type: const  |  Extra: (空，但因为是主键所以不需要回表的概念)

-- 2. 二级索引查询：需要回表
EXPLAIN SELECT * FROM orders WHERE user_id = 5;
-- type: ref  |  key: idx_user_id  |  Extra: (空)

-- 3. 覆盖索引：无需回表
EXPLAIN SELECT user_id, status FROM orders WHERE user_id = 5;
-- type: ref  |  key: idx_user_status  |  Extra: Using index

-- 4. 覆盖索引（只查主键列）
EXPLAIN SELECT id FROM orders WHERE order_no = 'ORD20250101001';
-- type: ref  |  key: idx_order_no  |  Extra: Using index
```

**EXPLAIN 关键字段解读：**

- `type: const`：通过主键或唯一索引精确匹配，性能最优
- `type: ref`：通过普通索引匹配，可能需要回表
- `Extra: Using index`：覆盖索引，所有需要的列都在索引中，不需要回表
- `Extra: Using index condition`：索引下推（ICP），在存储引擎层进行部分过滤

## MyISAM 的索引实现对比

与 InnoDB 不同，**MyISAM 不支持聚簇索引**。MyISAM 的所有索引（包括主键索引）都是非聚簇索引，叶子节点存储的都是指向数据行的**物理地址指针（行号）**。

```
MyISAM 索引结构：

主键索引（PRIMARY KEY）          二级索引（INDEX idx_name）
┌──────────────┐                ┌──────────────┐
│  叶子节点     │                │  叶子节点     │
│  存储:       │                │  存储:       │
│  物理行地址   │                │  物理行地址   │
│  (0x7F...)   │                │  (0x7F...)   │
└──────┬───────┘                └──────┬───────┘
       │                               │
       ↓                               ↓
   数据文件（.MYD）中的物理行      数据文件（.MYD）中的物理行
```

| 对比维度 | InnoDB | MyISAM |
|---------|--------|--------|
| 主键索引类型 | 聚簇索引（叶子节点存完整数据） | 非聚簇索引（叶子节点存行地址） |
| 二级索引叶子节点 | 存储主键值 | 存储行地址（指针） |
| 二级索引回表 | 先找主键，再回聚簇索引 | 直接通过行地址读取数据文件 |
| 数据文件 | 索引和数据存储在同一个 .ibd 文件中 | 数据（.MYD）和索引（.MYI）分开存储 |
| 主键查询性能 | 极高（直接从索引获取数据） | 高（但需要额外的指针跳转） |

> **注意**：在现代 MySQL 版本中（5.5+），InnoDB 是默认且推荐的存储引擎。MyISAM 已经逐渐被淘汰，不支持事务、行级锁等关键特性。

## 聚簇索引的页分裂问题

### 什么是页分裂？

InnoDB 的数据以**页（Page）**为单位存储，默认每页 16KB。当向已满的数据页插入新记录时，InnoDB 需要将该页分裂为两个页，这就是**页分裂（Page Split）**。

```
页分裂过程示意：

分裂前（页已满）：                   分裂后：
┌─────────────────────────┐       ┌──────────────────┐
│ [10, 20, 30, 40, 50]    │  →    │ [10, 20, 30]     │  ← 原页
│ 插入 25                  │       ├──────────────────┤
│                         │       │ [25, 40, 50]     │  ← 新页
└─────────────────────────┘       └──────────────────┘
```

**页分裂的影响：**
- 需要申请新的数据页，涉及磁盘 I/O
- 页分裂后数据页的填充率下降，浪费存储空间
- 页分裂操作需要记录 redo log，影响写入性能
- 频繁的页分裂会导致数据页碎片化，范围查询性能下降

### UUID vs 自增主键的性能对比

主键的选择直接影响页分裂的频率和查询性能：

**自增主键（推荐）：**
- 新记录总是追加到索引的最后一页，不会导致页分裂
- 主键值单调递增，保证了数据的顺序插入
- 主键长度为 8 字节（BIGINT），二级索引占用空间小

**UUID 主键（不推荐）：**
- UUID 是随机值，新记录可能插入到已有页的中间位置，频繁触发页分裂
- UUID 为 36 字节字符串（CHAR(36)）或 16 字节（BINARY(16)），二级索引占用空间显著增大
- 随机性导致数据物理分布无序，范围查询需要更多随机 I/O

**性能测试数据参考：**

```sql
-- 创建两张结构相同的表
CREATE TABLE test_auto_inc (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100),
    data TEXT,
    INDEX idx_name (name)
) ENGINE=InnoDB;

CREATE TABLE test_uuid (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(100),
    data TEXT,
    INDEX idx_name (name)
) ENGINE=InnoDB;

-- 插入 100 万条数据后对比：
-- 自增主键：插入速度约 12,000 rows/sec，索引大小约 30MB
-- UUID 主键：插入速度约 4,000 rows/sec，索引大小约 85MB
-- 二级索引大小：自增约 25MB vs UUID约 55MB（因为主键值更长）
```

> **最佳实践**：在 InnoDB 中，始终使用自增整数（`BIGINT AUTO_INCREMENT`）作为主键。如果业务需要全局唯一标识，可以使用分布式 ID 生成器（如 Snowflake、ULID、UUID v7），其中 UUID v7 和 ULID 是时间有序的，可以避免随机插入带来的页分裂问题。

## 非聚簇索引一定会回表查询吗？

![聚簇索引与非聚簇索引结构](/images/content/db-1-content-1.jpg)

**不一定。** 当查询所需的所有字段都包含在索引中时，MySQL 可以直接从索引中获取数据而不需要回表。这种索引被称为**覆盖索引（Covering Index）**。

举个简单的例子，假设我们在学生表的成绩上建立了索引，那么当进行 `SELECT score FROM student WHERE score > 90` 的查询时，在索引的叶子节点上，已经包含了 score 信息，不会再次进行回表查询。

更进一步，如果建立了联合索引 `(user_id, status, amount)`，那么以下查询都可以通过覆盖索引避免回表：

```sql
-- 这些查询只需要访问索引 idx_user_status_amount，不需要回表
SELECT user_id, status, amount FROM orders WHERE user_id = 5;
SELECT status, amount FROM orders WHERE user_id = 5 AND status = 1;
SELECT COUNT(*) FROM orders WHERE user_id = 5;
```

## 联合索引是什么？为什么需要注意联合索引中的顺序？

![联合索引与查询优化](/images/content/db-1-content-2.jpg)

MySQL 可以使用多个字段同时建立一个索引，叫做联合索引。在联合索引中，如果想要命中索引，需要按照建立索引时的字段顺序挨个使用，否则无法命中索引。

具体原因为：

MySQL 使用索引时需要索引有序，假设现在建立了 `(name, age, school)` 的联合索引，那么索引的排序为：先按照 name 排序，如果 name 相同，则按照 age 排序，如果 age 的值也相等，则按照 school 进行排序。

当进行查询时，此时索引仅仅按照 name 严格有序，因此必须首先使用 name 字段进行等值查询，之后对于匹配到的列而言，其按照 age 字段严格有序，此时可以使用 age 字段用做索引查找，以此类推。因此在建立联合索引的时候应该注意索引列的顺序，一般情况下，将查询需求频繁或者字段选择性高的列放在前面。此外可以根据特例的查询或者表结构进行单独的调整。

## 实际业务场景中的选型建议

### 1. 主键设计原则

```sql
-- ✅ 推荐：自增主键
CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ...
);

-- ✅ 推荐：有序分布式 ID（Snowflake / ULID / UUID v7）
CREATE TABLE distributed_table (
    id BINARY(16) PRIMARY KEY,  -- 存储 ULID
    ...
);

-- ❌ 不推荐：随机 UUID 作为主键
CREATE TABLE bad_design (
    id CHAR(36) PRIMARY KEY,    -- UUID v4，随机无序
    ...
);
```

### 2. 覆盖索引设计

在高频查询场景下，通过设计覆盖索引避免回表是重要的优化手段：

```sql
-- 场景：高频查询用户的订单状态和金额
-- ❌ 需要回表
SELECT status, amount FROM orders WHERE user_id = 123;
-- 索引 idx_user_id 只包含 user_id，需要回表取 status 和 amount

-- ✅ 覆盖索引，无需回表
ALTER TABLE orders ADD INDEX idx_user_status_amount (user_id, status, amount);
```

### 3. Laravel 项目中的最佳实践

```php
// 在 Laravel Migration 中合理设计索引
Schema::create('orders', function (Blueprint $table) {
    $table->id(); // BIGINT AUTO_INCREMENT，作为聚簇索引主键
    $table->foreignId('user_id')->index();
    $table->string('order_no', 32)->unique();
    $table->decimal('amount', 10, 2);
    $table->tinyInteger('status')->default(0);
    $table->timestamps();

    // 覆盖索引：覆盖 user_id + status 的常见查询
    $table->index(['user_id', 'status', 'amount'], 'idx_user_status_amount');
});

// 使用 EXPLAIN 验证查询计划
// 在 Laravel 中可以通过 DB::explain() 或日志查看
$result = DB::select('EXPLAIN SELECT * FROM orders WHERE user_id = ?', [123]);
```

### 4. 大表优化策略

对于千万级以上的数据表：

- **分页查询**：避免 `OFFSET` 大偏移量，改用基于游标的分页（`WHERE id > ? LIMIT N`）
- **索引覆盖**：优先设计覆盖索引减少回表次数
- **读写分离**：写操作走主库，读操作走从库
- **分区表**：按时间范围分区，减少单次查询的扫描范围
- **归档策略**：将历史数据迁移到归档表，保持主表数据量可控

## 总结

- **聚簇索引**是 InnoDB 的核心特性，叶子节点存储完整行数据，主键查询性能最优
- **非聚簇索引（二级索引）**叶子节点存储主键值，查询时可能需要回表
- 通过**覆盖索引**可以避免回表，显著提升查询性能
- 主键应选择**自增整数**或**有序分布式 ID**，避免使用随机 UUID 作为主键导致页分裂
- MyISAM 的所有索引都是非聚簇索引，但已在现代 MySQL 中逐渐被淘汰
- 合理设计索引时需要考虑查询模式、数据量和写入频率的平衡

## 相关阅读

- [索引的概念](/databases/index/concept/) — 了解索引的基本概念和作用
- [索引采用的算法](/databases/index/b-tree/) — 深入理解 B+ Tree 数据结构
- [覆盖索引（Covering Index）](/databases/index/covering-index/) — 掌握覆盖索引的原理和设计方法
- [索引回表](/databases/index/index-lookup/) — 详解回表查询的过程和优化
- [索引的优缺点](/databases/index/pros-and-cons/) — 全面了解索引的收益与代价
- [索引创建的原则](/databases/index/creation-principles/) — 学习索引设计的最佳实践
