---
title: MySQL-窗口函数-实战-ROW_NUMBER-RANK-DENSE_RANK-在运营报表中的应用
date: 2026-05-05 12:06:01
updated: 2026-05-05 12:09:02
categories:
  - MySQL
tags: [Laravel, MySQL]description: 结合 Laravel B2C 后台真实报表场景，拆解 MySQL 8 窗口函数在分组 Top N、排名、环比计算中的落地方式，重点记录 SQL 改写、索引配合、临时表放大与分页口径错乱等生产踩坑。
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
