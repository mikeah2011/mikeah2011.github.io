# EXPLAIN 执行计划

## 定义

`EXPLAIN` 是 MySQL 自带的 SQL 分析工具，用于查看查询的执行计划，判断是否使用了索引、扫描了多少行、是否需要排序等。

```sql
EXPLAIN SELECT * FROM users WHERE age = 25;
```

## 核心字段解读

### type（访问类型）— 从好到差

| type | 说明 | 性能 |
|------|------|------|
| **system** | 表只有一行 | 最好 |
| **const** | 主键或唯一索引等值查询 | 极好 |
| **eq_ref** | JOIN 时主键/唯一索引关联 | 很好 |
| **ref** | 非唯一索引等值查询 | 好 |
| **range** | 索引范围查询 | 较好 |
| **index** | 全索引扫描 | 一般 |
| **ALL** | 全表扫描 | ❌ 最差 |

### key

| 值 | 含义 |
|----|------|
| 具体索引名 | 实际使用的索引 |
| NULL | 没有使用索引（可能全表扫描） |

### rows

MySQL 估算的需要扫描的行数。越小越好。

### Extra — 重点关注

| Extra | 含义 | 好坏 |
|-------|------|------|
| **Using index** | 覆盖索引，没回表 | ✅ 很好 |
| **Using where; Using index** | 索引过滤 + 覆盖 | ✅ 好 |
| **Using index condition** | 索引下推（ICP） | ✅ 较好 |
| **Using temporary** | 使用临时表 | ⚠️ 需优化 |
| **Using filesort** | 额外排序 | ⚠️ 需优化 |
| **Using where** | Server 层过滤（可能回表了） | ⚠️ 看情况 |
| 空 | 普通查询 | - |

## 实战分析模板

```sql
-- 1. 基本分析
EXPLAIN SELECT * FROM orders WHERE user_id = 100 AND status = 1;

-- 2. 详细分析（MySQL 8.0+）
EXPLAIN FORMAT=TREE SELECT ...;      -- 树形执行计划
EXPLAIN ANALYZE SELECT ...;          -- 真实执行 + 实际耗时

-- 3. 查看优化器改写
EXPLAIN FORMAT=JSON SELECT ...;      -- 最详细的信息
```

## 常见优化场景

### 场景 1：type=ALL，全表扫描
```sql
-- 原因：没有索引或索引失效
-- 解决：添加合适索引
EXPLAIN SELECT * FROM users WHERE phone = '13800138000';
-- → 添加索引 idx_phone (phone)
```

### 场景 2：Using filesort
```sql
-- 原因：ORDER BY 字段不在索引中
-- 解决：将排序字段加入联合索引
EXPLAIN SELECT * FROM products WHERE category_id = 1 ORDER BY price;
-- → 添加索引 idx_cat_price (category_id, price)
```

### 场景 3：Using temporary
```sql
-- 原因：GROUP BY 字段不在索引中
-- 解决：将分组字段加入联合索引
```

## 排查流程

```
1. EXPLAIN 看 type → 是否 ALL（全表扫描）
2. 看 key → 是否命中索引
3. 看 rows → 扫描行数是否合理
4. 看 Extra → 是否有 filesort / temporary
5. 看 filtered → 过滤比例是否正常
```

## 相关概念

- [索引失效](索引失效.md) - EXPLAIN 验证索引是否生效
- [覆盖索引](覆盖索引.md) - Using index 的含义
- [索引下推](索引下推.md) - Using index condition 的含义
- [慢查询治理](慢查询治理.md) - 系统化排查慢 SQL

## 实战文章

- [SQL 语句性能分析工具 - explain - 博客原文](/categories/Databases/SQL语句性能分析工具-explain/)
- [百万级数据表查询优化实战](/categories/Databases/百万级数据表查询优化实战/)
- [MySQL 索引优化实战：EXPLAIN 分析](/categories/Databases/MySQL索引优化实战/)
