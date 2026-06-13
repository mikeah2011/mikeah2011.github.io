---
title: MySQL-窗口函数-实战-ROW_NUMBER-RANK-DENSE_RANK-在运营报表中的应用
date: 2026-05-05 12:06:01
updated: 2026-05-05 12:09:02
categories:
  - database
tags: [Laravel, MySQL, 窗口函数, SQL, 性能优化, EXPLAIN]
keywords: [MySQL, ROW, NUMBER, RANK, DENSE, 窗口函数, 在运营报表中的应用, 数据库]
description: 结合 Laravel B2C 后台真实报表场景，拆解 MySQL 8 窗口函数 ROW_NUMBER、RANK、DENSE_RANK 在分组 Top N、并列排名、环比计算、移动平均中的落地方式。涵盖窗口函数语法详解、与子查询 Top N 的性能对比、EXPLAIN 执行计划分析、索引配合策略，以及临时表放大、分页口径错乱、排序抖动等生产踩坑记录。适合需要在后端报表中实现复杂排名逻辑的 Laravel 开发者。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-004-content-1.jpg
  - /images/content/databases-004-content-2.jpg

---

## 前言：为什么我会在报表接口里重写 SQL

我们有一条后台接口，要给运营看“每个国家近 30 天销量 Top 3 商品”，还要顺手带出排名、并列名次和上一名的差距。最早这条链路是两段式写法：先 `GROUP BY` 聚合，再在 PHP 里按国家分组、排序、切片。数据量上来后问题很明显：一是内存吃满，二是分页口径不稳定，三是同销量并列时每次导出的顺序都不一样。

后来把 MySQL 升到 8.0 后，我直接把逻辑收回 SQL，核心就是窗口函数：`ROW_NUMBER()`、`RANK()`、`DENSE_RANK()`。这不是“语法炫技”，而是把原本散在 Laravel Collection、临时数组和导出脚本里的排名逻辑，统一交给数据库完成。

---

## 一、场景建模：订单事实表 + 日报聚合表

先说落地结构。线上不会直接拿 `orders` 明细表做复杂报表，我会先按天汇总到 `product_daily_sales`：

```sql
CREATE TABLE product_daily_sales (
    stat_date DATE NOT NULL,
    country_code CHAR(2) NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    paid_orders INT UNSIGNED NOT NULL DEFAULT 0,
    paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    PRIMARY KEY (stat_date, country_code, product_id),
    KEY idx_country_date_amount (country_code, stat_date, paid_amount, product_id)
);
```

对应的聚合 Job 我放在 Laravel Queue，每小时增量刷新一次：

```php
DB::statement(<<<'SQL'
INSERT INTO product_daily_sales (
    stat_date, country_code, product_id, product_name, paid_orders, paid_amount
)
SELECT
    DATE(paid_at) AS stat_date,
    country_code,
    product_id,
    MAX(product_name) AS product_name,
    COUNT(*) AS paid_orders,
    SUM(pay_amount) AS paid_amount
FROM orders
WHERE paid_at >= ? AND paid_at < ?
  AND payment_status = 'paid'
GROUP BY DATE(paid_at), country_code, product_id
ON DUPLICATE KEY UPDATE
    product_name = VALUES(product_name),
    paid_orders = VALUES(paid_orders),
    paid_amount = VALUES(paid_amount)
SQL, [$startAt, $endAt]);
```

### 架构图

```mermaid
flowchart LR
    A[orders 明细表] --> B[Laravel 聚合 Job]
    B --> C[product_daily_sales 日报表]
    C --> D[MySQL 窗口函数查询]
    D --> E[Admin API]
    E --> F[运营后台报表/导出]
```

这一步很关键：**窗口函数适合做分析型查询，不适合替代全量明细扫描治理**。如果底层还是直接扫千万级订单表，再优雅的 `RANK()` 也救不了慢 SQL。

![MySQL 窗口函数报表架构](/images/content/databases-004-content-1.jpg)

---

## 二、核心 SQL：每个国家取 Top 3，并处理并列排名

先聚合近 30 天数据，再在结果集上做窗口计算：

```sql
WITH ranked_sales AS (
    SELECT
        country_code,
        product_id,
        product_name,
        SUM(paid_orders) AS total_orders,
        SUM(paid_amount) AS total_amount,
        ROW_NUMBER() OVER (
            PARTITION BY country_code
            ORDER BY SUM(paid_amount) DESC, product_id DESC
        ) AS row_num,
        RANK() OVER (
            PARTITION BY country_code
            ORDER BY SUM(paid_amount) DESC
        ) AS sales_rank,
        DENSE_RANK() OVER (
            PARTITION BY country_code
            ORDER BY SUM(paid_amount) DESC
        ) AS dense_rank,
        LAG(SUM(paid_amount), 1, 0) OVER (
            PARTITION BY country_code
            ORDER BY SUM(paid_amount) DESC, product_id DESC
        ) AS prev_amount
    FROM product_daily_sales
    WHERE stat_date BETWEEN '2026-04-01' AND '2026-04-30'
    GROUP BY country_code, product_id, product_name
)
SELECT
    country_code,
    product_id,
    product_name,
    total_orders,
    total_amount,
    row_num,
    sales_rank,
    dense_rank,
    total_amount - prev_amount AS diff_from_prev
FROM ranked_sales
WHERE row_num <= 3
ORDER BY country_code, row_num;
```

这条 SQL 解决了三个旧问题：

1. `ROW_NUMBER()` 用来稳定取每组前 3 名。
2. `RANK()` 告诉运营“并列后跳号”的真实名次。
3. `DENSE_RANK()` 给前端做“连续徽章排名”，不会出现 1、1、3 这种视觉落差。

在 Laravel 里我通常直接封装成只读查询服务，而不是硬塞进 Eloquent：

```php
final class SalesLeaderboardRepository
{
    public function topProductsByCountry(string $startDate, string $endDate, int $limit = 3): array
    {
        $sql = <<<'SQL'
WITH ranked_sales AS (
    SELECT
        country_code,
        product_id,
        product_name,
        SUM(paid_orders) AS total_orders,
        SUM(paid_amount) AS total_amount,
        ROW_NUMBER() OVER (
            PARTITION BY country_code
            ORDER BY SUM(paid_amount) DESC, product_id DESC
        ) AS row_num,
        RANK() OVER (
            PARTITION BY country_code
            ORDER BY SUM(paid_amount) DESC
        ) AS sales_rank
    FROM product_daily_sales
    WHERE stat_date BETWEEN ? AND ?
    GROUP BY country_code, product_id, product_name
)
SELECT *
FROM ranked_sales
WHERE row_num <= ?
ORDER BY country_code, row_num
SQL;

        return DB::select($sql, [$startDate, $endDate, $limit]);
    }
}
```

---

## 三、为什么不用子查询 + JOIN 模拟 Top N

旧写法通常长这样：先算每个商品销量，再自连接统计“比我大的有几个”，最后筛 `count < 3`。这种 SQL 在数据稍大时非常痛苦，执行计划里会出现多层临时表和 filesort。窗口函数的价值不是少写几行，而是**把排名当成一等公民**，让 SQL 可读、可维护，也更容易跟业务对口径。

我在一次重构里把报表导出耗时从 4.7s 降到 1.3s，主要不是因为窗口函数“天然更快”，而是因为我顺手做了两件事：

- 先落日报聚合表，减少扫描范围；
- 给 `stat_date + country_code + product_id` 这条聚合路径补齐索引。

换句话说，窗口函数负责表达力，性能还是要靠数据模型和索引兜底。

![数据查询与分析](/images/content/databases-004-content-2.jpg)

---

## 四、三个生产踩坑记录

### 踩坑 1：窗口函数不能直接写在 WHERE

我第一次写成这样：

```sql
SELECT
    country_code,
    product_id,
    ROW_NUMBER() OVER (PARTITION BY country_code ORDER BY paid_amount DESC) AS rn
FROM product_daily_sales
WHERE rn <= 3;
```

MySQL 直接报错，因为窗口函数是在 `WHERE` 之后计算的。正确做法一定是包一层 CTE 或子查询，再在外层过滤。

### 踩坑 2：并列排序不加第二关键字，导出结果会抖

只按 `SUM(paid_amount) DESC` 排名时，并列商品每次返回顺序可能不同。结果就是运营今天导出的 Top 3 和明天重跑的 Top 3 顺序交换，误以为数据错了。我的做法是：**所有 `ROW_NUMBER()` 都加稳定的 tie-breaker**，通常是 `product_id DESC` 或主键。

### 踩坑 3：窗口函数很容易放大临时表

当 `PARTITION BY country_code` 的分区很大、排序列又没有合适索引时，`EXPLAIN ANALYZE` 会看到 `using temporary` 和 `using filesort`。我当时直接对明细表跑窗口函数，8GB 内存的报表库都能被打抖。后来的经验是：

- 明细先聚合；
- 限定时间范围；
- 报表和交易查询分库；
- 导出任务走异步，不要卡在同步 HTTP 请求里。

---

## 五、我现在的落地原则

如果你的需求是“分组 Top N、并列排名、环比/前后差值”，MySQL 8 窗口函数基本就是正解；如果你的需求还是高频 OLTP 单点查询，那别为了新语法硬上。我的实践结论很简单：**窗口函数不是性能银弹，但它能把原本散落在 PHP 代码里的报表逻辑收束到 SQL，并显著减少口径漂移。**

对 Laravel 团队来说，最值得做的不是背语法，而是把“明细表、聚合表、分析查询、异步导出”四层拆清楚。这样 `ROW_NUMBER()` 才会成为报表工程化的一部分，而不是下一条更难维护的长 SQL。

---

## 六、ROW_NUMBER vs RANK vs DENSE_RANK 对比表格

| 特性 | ROW_NUMBER() | RANK() | DENSE_RANK() |
|------|--------------|--------|--------------|
| **并列处理** | 强制唯一编号，并列也给不同号 | 并列给相同号，跳过后续名次 | 并列给相同号，不跳过名次 |
| **结果示例** (值: 100,100,90) | 1, 2, 3 | 1, 1, 3 | 1, 1, 2 |
| **是否连续** | 连续 | 不连续（有跳号） | 连续 |
| **典型用途** | 分页取 Top N、去重 | 真实竞技排名 | 连续徽章/等级展示 |
| **性能差异** | 最轻量 | 需要额外排序开销 | 需要额外排序开销 |
| **MySQL 版本要求** | 8.0+ | 8.0+ | 8.0+ |

> **选型建议**：需要稳定取 Top N 时用 `ROW_NUMBER()`；需要展示真实排名（如竞赛积分榜）用 `RANK()`；需要连续编号（如前端徽章展示）用 `DENSE_RANK()`。实际项目中 `ROW_NUMBER()` 使用频率最高，因为它能保证每组结果数量稳定。

---

## 七、更多实战 SQL 示例

### 7.1 分组 Top N：每个部门薪资最高的 5 名员工

```sql
WITH ranked_emp AS (
    SELECT
        department_id,
        employee_id,
        employee_name,
        salary,
        ROW_NUMBER() OVER (
            PARTITION BY department_id
            ORDER BY salary DESC, employee_id ASC
        ) AS rn
    FROM employees
    WHERE status = 'active'
)
SELECT
    d.department_name,
    re.employee_id,
    re.employee_name,
    re.salary,
    re.rn AS dept_rank
FROM ranked_emp re
JOIN departments d ON d.id = re.department_id
WHERE re.rn <= 5
ORDER BY re.department_id, re.rn;
```

> **注意**：`ROW_NUMBER()` 的 `ORDER BY` 加了 `employee_id ASC` 作为 tie-breaker，避免同薪资员工每次查询顺序不同。

### 7.2 环比计算：本月 vs 上月销售额对比

```sql
WITH monthly_sales AS (
    SELECT
        DATE_FORMAT(stat_date, '%Y-%m') AS month_key,
        product_id,
        SUM(paid_amount) AS total_amount
    FROM product_daily_sales
    WHERE stat_date >= '2026-01-01'
    GROUP BY DATE_FORMAT(stat_date, '%Y-%m'), product_id
),
with_lag AS (
    SELECT
        month_key,
        product_id,
        total_amount,
        LAG(total_amount, 1) OVER (
            PARTITION BY product_id
            ORDER BY month_key
        ) AS prev_month_amount
    FROM monthly_sales
)
SELECT
    month_key,
    product_id,
    total_amount AS current_month,
    prev_month_amount AS last_month,
    total_amount - prev_month_amount AS absolute_diff,
    ROUND(
        (total_amount - prev_month_amount) / prev_month_amount * 100, 2
    ) AS growth_rate_pct
FROM with_lag
WHERE prev_month_amount IS NOT NULL
ORDER BY product_id, month_key;
```

> **踩坑**：`LAG()` 第三个参数是默认值，不填时结果为 `NULL`，后续计算需要 `COALESCE` 或 `WHERE ... IS NOT NULL` 过滤，否则增长率会变成 `NULL`。

### 7.3 移动平均：近 7 天滑动平均销售额

```sql
SELECT
    stat_date,
    product_id,
    paid_amount AS daily_amount,
    ROUND(
        AVG(paid_amount) OVER (
            PARTITION BY product_id
            ORDER BY stat_date
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ), 2
    ) AS moving_avg_7d
FROM product_daily_sales
WHERE stat_date >= '2026-05-01'
ORDER BY product_id, stat_date;
```

> **关键**：`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` 定义滑动窗口大小。如果用 `RANGE` 代替 `ROWS`，需要确保排序列是唯一的，否则会出现窗口边界错误。

### 7.4 累计求和：运行总计（Running Total）

```sql
SELECT
    stat_date,
    country_code,
    paid_amount AS daily_amount,
    SUM(paid_amount) OVER (
        PARTITION BY country_code
        ORDER BY stat_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_amount
FROM product_daily_sales
WHERE product_id = 12345
  AND stat_date >= '2026-04-01'
ORDER BY country_code, stat_date;
```

### 7.5 分组内去重：每个用户最近一条登录记录

```sql
WITH ranked_logins AS (
    SELECT
        user_id,
        login_at,
        ip_address,
        device_type,
        ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY login_at DESC
        ) AS rn
    FROM user_login_logs
)
SELECT
    user_id,
    login_at AS last_login_at,
    ip_address,
    device_type
FROM ranked_logins
WHERE rn = 1;
```

> **性能提示**：这类查询在大表上执行时，`PARTITION BY user_id` 会产生大量分组。建议确保 `user_id + login_at` 有联合索引，否则 `EXPLAIN` 会显示 `Using temporary; Using filesort`。

---

## 八、EXPLAIN 执行计划分析：窗口函数的真实开销

我在生产环境中用 `EXPLAIN ANALYZE` 观察窗口函数的执行计划，发现一个关键规律：**窗口函数的排序开销取决于 `PARTITION BY` + `ORDER BY` 组合是否能命中索引**。

### 场景 1：无索引命中（慢）

```sql
EXPLAIN ANALYZE
SELECT
    country_code,
    product_id,
    ROW_NUMBER() OVER (
        PARTITION BY country_code
        ORDER BY paid_amount DESC
    ) AS rn
FROM product_daily_sales
WHERE stat_date = '2026-05-01';
```

执行计划通常显示：
```
-> Sort: product_daily_sales.country_code, paid_amount DESC
   -> Table scan on product_daily_sales
```

### 场景 2：索引命中（快）

```sql
-- 创建覆盖索引
ALTER TABLE product_daily_sales
ADD INDEX idx_country_date_amount_pid (country_code, stat_date, paid_amount, product_id);

EXPLAIN ANALYZE
SELECT
    country_code,
    product_id,
    ROW_NUMBER() OVER (
        PARTITION BY country_code
        ORDER BY paid_amount DESC
    ) AS rn
FROM product_daily_sales
WHERE stat_date = '2026-05-01';
```

执行计划优化为：
```
-> Index lookup on product_daily_sales using idx_country_date_amount_pid
```

> **结论**：窗口函数本身不是瓶颈，索引设计才是。在报表场景中，把 `PARTITION BY` 和 `ORDER BY` 的列组合成联合索引，可以避免 `filesort` 和 `temporary`。

---

## 九、窗口函数常见错误与调试技巧

### 错误 1：在 WHERE 中直接使用窗口函数

```sql
-- ❌ 错误写法
SELECT * FROM (
    SELECT
        product_id,
        ROW_NUMBER() OVER (ORDER BY paid_amount DESC) AS rn
    FROM product_daily_sales
) t
WHERE rn <= 3;
-- ✅ 正确写法：用 CTE 包装
WITH ranked AS (
    SELECT
        product_id,
        ROW_NUMBER() OVER (ORDER BY paid_amount DESC) AS rn
    FROM product_daily_sales
)
SELECT * FROM ranked WHERE rn <= 3;
```

### 错误 2：忘记处理 NULL 值

```sql
-- LAG 默认返回 NULL，需要显式处理
SELECT
    product_id,
    paid_amount,
    LAG(paid_amount, 1, 0) OVER (ORDER BY stat_date) AS prev_amount,
    paid_amount - LAG(paid_amount, 1, 0) OVER (ORDER BY stat_date) AS diff
FROM product_daily_sales;
```

### 错误 3：ORDER BY 不唯一导致结果不稳定

```sql
-- ❌ 不稳定：同金额商品顺序随机
ROW_NUMBER() OVER (ORDER BY paid_amount DESC)

-- ✅ 稳定：加 tie-breaker
ROW_NUMBER() OVER (ORDER BY paid_amount DESC, product_id ASC)
```

---

## 十、生产环境最佳实践总结

1. **先聚合后排名**：不要在千万级明细表上直接跑窗口函数，先按时间/维度聚合到中间表。
2. **索引匹配**：`PARTITION BY` + `ORDER BY` 的列组合应该有联合索引。
3. **Tie-breaker 必加**：所有 `ROW_NUMBER()` 都要加第二排序键，避免结果抖动。
4. **异步导出**：复杂窗口查询不要卡在同步 HTTP 请求里，用 Laravel Queue 异步处理。
5. **监控慢查询**：用 `pt-query-digest` 定期分析窗口函数相关的慢查询日志。
6. **测试边界情况**：同值并列、NULL 值、空分区等场景都要覆盖。

---

## 相关阅读

- [EXPLAIN 深度解析：SQL 语句性能分析工具](/categories/Databases/explain/)
- [MySQL 索引优化实战 EXPLAIN 深度分析](/categories/Databases/index-deep-dive-explain/)
- [MySQL 慢查询治理实战](/categories/Databases/slow-query-governance/)
- [MySQL 查询优化实战 EXPLAIN 深度分析](/categories/Databases/query-optimization-explain/)
- [MySQL 多表 JOIN EXPLAIN 分析](/categories/Databases/mysql-joinexplain/)
- [MySQL 分库分表实战](/categories/Databases/sharding-30-repos/)
- [MySQL CTE 递归查询实战](/categories/Databases/mysql-cte-queryguide/)
