# CTE 递归查询

## 定义

CTE（Common Table Expression，公用表表达式）是 MySQL 8.0 引入的 `WITH` 语法，允许在单条 SQL 中定义临时结果集。递归 CTE（`WITH RECURSIVE`）可以遍历树形结构、生成序列、展开层级数据。

## 基础语法

```sql
-- 非递归 CTE
WITH cte_name AS (
    SELECT ... FROM table WHERE ...
)
SELECT * FROM cte_name;

-- 递归 CTE
WITH RECURSIVE cte_name AS (
    -- 锚点成员（初始查询）
    SELECT ... FROM table WHERE parent_id IS NULL
    UNION ALL
    -- 递归成员（引用自身）
    SELECT ... FROM table JOIN cte_name ON table.parent_id = cte_name.id
)
SELECT * FROM cte_name;
```

## 核心场景

### 1. 树形分类展开

```sql
-- 从根分类递归展开整棵子树
WITH RECURSIVE category_tree AS (
    -- 锚点：根节点
    SELECT id, parent_id, name, 0 AS depth,
           CAST(name AS CHAR(500)) AS path
    FROM catalog_categories
    WHERE parent_id IS NULL AND is_enabled = 1

    UNION ALL

    -- 递归：子节点
    SELECT c.id, c.parent_id, c.name, ct.depth + 1,
           CONCAT(ct.path, ' > ', c.name)
    FROM catalog_categories c
    JOIN category_tree ct ON c.parent_id = ct.id
    WHERE c.is_enabled = 1
)
SELECT * FROM category_tree ORDER BY path;
```

### 2. 子树汇总

```sql
-- 给定根分类，递归展开并汇总近 30 天销售额
WITH RECURSIVE subtree AS (
    SELECT id FROM catalog_categories WHERE id = :root_id
    UNION ALL
    SELECT c.id FROM catalog_categories c
    JOIN subtree s ON c.parent_id = s.id
)
SELECT
    s.id,
    c.name,
    COALESCE(SUM(p.paid_amount), 0) AS total_sales
FROM subtree s
JOIN catalog_categories c ON c.id = s.id
LEFT JOIN product_daily_sales p ON p.category_id = s.id
    AND p.stat_date >= CURDATE() - INTERVAL 30 DAY
GROUP BY s.id, c.name;
```

### 3. 路径聚合与叶子节点判断

```sql
SELECT
    id, name, depth, path,
    CASE WHEN NOT EXISTS (
        SELECT 1 FROM catalog_categories WHERE parent_id = ct.id
    ) THEN 1 ELSE 0 END AS is_leaf
FROM category_tree ct;
```

## 实战踩坑

### 1. 环数据防护

```sql
-- 防止 parent_id 循环引用导致无限递归
WITH RECURSIVE category_tree AS (
    SELECT id, parent_id, name,
           CAST(id AS CHAR(1000)) AS visited
    FROM catalog_categories WHERE parent_id IS NULL

    UNION ALL

    SELECT c.id, c.parent_id, c.name,
           CONCAT(ct.visited, ',', c.id)
    FROM catalog_categories c
    JOIN category_tree ct ON c.parent_id = ct.id
    WHERE FIND_IN_SET(c.id, ct.visited) = 0  -- 防环
)
```

### 2. 递归深度限制

```sql
-- 设置最大递归深度（默认 1000）
SET cte_max_recursion_depth = 100;
```

### 3. 索引设计

```sql
-- 递归 JOIN 条件必须有索引
KEY idx_parent_sort (parent_id, sort, id)
KEY idx_enabled_parent (is_enabled, parent_id)
```

### 4. 临时表放大

递归 CTE 的中间结果集可能很大。建议：
- 在锚点查询中尽量收窄范围
- 限制递归深度
- 对大表先筛选再递归

## 实战案例

来自博客文章：[MySQL CTE 递归查询实战：树形结构层级分析与路径聚合](/categories/Databases/MySQL-CTE-递归查询实战/)

## 相关概念

- [窗口函数](窗口函数.md) - CTE + 窗口函数组合使用
- [EXPLAIN 执行计划](EXPLAIN执行计划.md) - 查看 CTE 的执行计划
- [SQL优化](SQL优化.md) - CTE 替代子查询/PHP 递归
- [索引创建原则](索引创建原则.md) - 递归查询的索引设计

## 常见问题

**Q: CTE 和子查询有什么区别？**
A: CTE 可读性更好、可递归引用自身、可被多处引用。子查询每次出现都会重新计算（MySQL 8.0 的 CTE 也可能物化，取决于优化器判断）。

**Q: 递归 CTE 的性能怎么样？**
A: 比 PHP 递归好很多——数据在引擎内完成，无需多次网络往返。但深层递归（>10 层）仍需注意性能，建议加索引 + 限制深度。

**Q: MySQL 5.7 怎么处理树形数据？**
A: 方案：① PHP/应用层递归查询 ② 邻接表 + 多次 JOIN ③ 路径枚举（存完整路径字符串）④ 嵌套集模型。推荐升级到 8.0 用 CTE。
