---
title: MySQL SQL 性能优化 52 条实战策略
tags: [MySQL, SQL优化, 性能优化, 索引, 查询优化, 数据库, EXPLAIN, 慢查询]
keywords: [MySQL SQL, 性能优化, 条实战策略, 数据库]
categories:
  - database
date: 2020-03-20 15:05:07
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-1-content-1.jpg
  - /images/content/databases-1-content-2.jpg
description: '系统总结 52 条 MySQL SQL 语句性能优化策略，按索引规范、查询写法、表设计、批量操作、存储引擎五大维度分类，每条策略配有可执行的 SQL 示例与 EXPLAIN 验证方法，帮助开发者从索引、查询、架构三个层面全面提升 MySQL 数据库性能。'
---


SQL 优化不是背口诀，而是要理解 **MySQL 查询优化器怎么选执行计划**。本文把 52 条策略分成五大类，每类配上真实 SQL 和 EXPLAIN 验证，直接能用。

先放一张总览图：

![MySQL 性能优化](/images/content/databases-1-content-1.jpg)

## 一、索引创建与使用规范（第 1~11、28、39 条）

索引是优化的第一道防线，但建错索引反而拖慢写入。

### 1. WHERE / ORDER BY 涉及的列优先建索引

```sql
-- 慢查询：全表扫描
SELECT * FROM orders WHERE user_id = 1001 AND status = 'paid';

-- 加联合索引
ALTER TABLE orders ADD INDEX idx_user_status (user_id, status);

-- 验证：Extra 里应该没有 Using filesort
EXPLAIN SELECT * FROM orders WHERE user_id = 1001 AND status = 'paid';
```

### 2. 避免在 WHERE 中对字段做 NULL 值判断

`IS NULL` / `IS NOT NULL` 在低选择性列上会导致优化器放弃索引。建表时用 `NOT NULL DEFAULT 0` 或特殊值替代：

```sql
-- ❌ 不推荐
CREATE TABLE users (
  avatar_url VARCHAR(255) NULL
);

-- ✅ 推荐：空字符串代替 NULL
CREATE TABLE users (
  avatar_url VARCHAR(255) NOT NULL DEFAULT ''
);
```

### 3. 避免 `!=` / `<>` 导致全表扫描

MySQL 索引只对 `<`、`<=`、`=`、`>`、`>=`、`BETWEEN`、`IN` 和前缀 `LIKE` 生效：

```sql
-- ❌ 不走索引
SELECT * FROM products WHERE status != 2;

-- ✅ 改写成 IN 或 UNION
SELECT * FROM products WHERE status IN (0, 1, 3);
```

### 4. 避免 WHERE 中用 OR 连接条件

```sql
-- ❌ 放弃索引
SELECT * FROM orders WHERE user_id = 1001 OR product_id = 500;

-- ✅ UNION 走各自索引
SELECT * FROM orders WHERE user_id = 1001
UNION ALL
SELECT * FROM orders WHERE product_id = 500;
```

### 5. IN / NOT IN 慎用，连续值用 BETWEEN

```sql
-- ❌ 全表扫描
SELECT * FROM orders WHERE id IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

-- ✅ 连续值用 BETWEEN
SELECT * FROM orders WHERE id BETWEEN 1 AND 10;
```

### 6. LIKE 前缀匹配才走索引

```sql
-- ❌ 全表扫描
SELECT * FROM users WHERE name LIKE '%张%';

-- ✅ 前缀匹配走索引
SELECT * FROM users WHERE name LIKE '张%';

-- ✅ 全文搜索替代方案
ALTER TABLE users ADD FULLTEXT INDEX ft_name (name);
SELECT * FROM users WHERE MATCH(name) AGAINST('张三' IN BOOLEAN MODE);
```

### 7. WHERE 中用参数会导致全表扫描

MySQL 的 Prepared Statement 在某些版本中不会对参数化查询使用索引。验证方式：

```sql
-- 检查是否走了索引
EXPLAIN SELECT * FROM orders WHERE user_id = ?;
-- 如果 type=ALL，改用常量或 FORCE INDEX
SELECT * FROM orders FORCE INDEX(idx_user_status) WHERE user_id = 1001;
```

### 8. 避免在 WHERE 中对字段做表达式/函数操作

```sql
-- ❌ 索引失效
SELECT * FROM orders WHERE YEAR(created_at) = 2026;
SELECT * FROM orders WHERE amount / 30 < 1000;

-- ✅ 改写成范围查询
SELECT * FROM orders WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';
SELECT * FROM orders WHERE amount < 30000;
```

### 9. EXISTS 替代 IN（子查询场景）

```sql
-- ❌ IN 可能全表扫描
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders);

-- ✅ EXISTS 通常更高效
SELECT * FROM users u WHERE EXISTS (
  SELECT 1 FROM orders o WHERE o.user_id = u.id
);
```

### 10. 索引数量控制在 6 个以内

每个索引都会拖慢 INSERT/UPDATE/DELETE。定期审查：

```sql
-- 查看表的索引
SHOW INDEX FROM orders;

-- 找出重复或低效索引（Percona Toolkit）
pt-duplicate-key-checker h=127.0.0.1,u=root,p=xxx
```

### 11. 避免频繁更新聚簇索引列

InnoDB 的聚簇索引就是数据本身，更新主键会导致整行物理重排。如果业务需要频繁更新某列，不要把它放在主键或聚簇索引中。

### 28. 联合索引最左前缀原则

```sql
-- 联合索引 (a, b, c)
ALTER TABLE t ADD INDEX idx_abc (a, b, c);

-- ✅ 走索引
SELECT * FROM t WHERE a = 1;
SELECT * FROM t WHERE a = 1 AND b = 2;
SELECT * FROM t WHERE a = 1 AND b = 2 AND c = 3;

-- ❌ 不走索引（跳过了 a）
SELECT * FROM t WHERE b = 2 AND c = 3;
```

### 39. 索引创建 16 条规则

1. 主键、外键必须有索引
2. 数据量超过 300 行的表应该有索引
3. 经常 JOIN 的字段建索引
4. 经常出现在 WHERE 中的大表字段建索引
5. 选择性高的字段优先建索引（`COUNT(DISTINCT col) / COUNT(*)` 接近 1）
6. 小字段优先，大文本字段不建索引
7. 能用单字段索引就不用复合索引
8. 复合索引中选选择性最好的字段做首列
9. 复合索引字段超过 3 个时重新评估
10. 如果单字段索引已覆盖查询，删除多余的复合索引
11. 频繁更新的表控制索引数量
12. 删除无用索引，避免干扰优化器
13. 重复值过多的列不建索引（如 gender 只有 M/F）
14. 定期 `ANALYZE TABLE` 更新索引统计信息
15. 用 `pt-index-usage` 分析索引使用率
16. `EXPLAIN` 验证每个新索引是否被实际使用

## 二、查询写法优化（第 14~27、40、46~48、52 条）

### 14. 禁止 `SELECT *`

```sql
-- ❌ 浅拷贝浪费带宽和内存
SELECT * FROM orders WHERE user_id = 1001;

-- ✅ 只查需要的列，走覆盖索引
SELECT order_no, status, amount FROM orders WHERE user_id = 1001;
```

EXPLAIN 验证覆盖索引：

```text
+----+------+------+----------+--------------------------+
| type | key             | Extra         |
+----+------+------+----------+--------------------------+
| ref  | idx_user_status | Using index   |  ← 覆盖索引，不回表
+----+------+------+----------+--------------------------+
```

### 15. 控制返回数据量

```sql
-- ❌ 返回 10 万行到应用层
SELECT * FROM logs WHERE created_at > '2026-01-01';

-- ✅ 分页 + LIMIT
SELECT * FROM logs WHERE created_at > '2026-01-01' LIMIT 100 OFFSET 0;
```

### 16. 使用表别名减少解析时间

```sql
-- ✅ 表别名 + 明确字段前缀
SELECT o.order_no, u.name
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'paid';
```

### 17. 用临时表暂存中间结果

```sql
-- ❌ 嵌套子查询，优化器难优化
SELECT * FROM orders
WHERE user_id IN (
  SELECT user_id FROM user_tags WHERE tag = 'vip'
)
AND created_at > '2026-01-01';

-- ✅ 先存临时表再 JOIN
CREATE TEMPORARY TABLE tmp_vip_users
  SELECT user_id FROM user_tags WHERE tag = 'vip';

SELECT o.* FROM orders o
JOIN tmp_vip_users t ON t.user_id = o.user_id
WHERE o.created_at > '2026-01-01';
```

### 18. 读写分离场景用 `READ UNCOMMITTED`

对实时性要求不高的报表查询，在从库上用低隔离级别减少锁竞争：

```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM orders WHERE status = 'pending';
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

⚠️ 会读到脏数据，只适合统计类查询。

### 19. 表连接不超过 5 个

超过 5 个 JOIN 时，优化器选择执行计划的复杂度指数级增长。拆分成多个小查询，用应用层组装结果。

### 20. 预计算结果存表

```sql
-- 统计日报预计算
CREATE TABLE daily_stats (
  stat_date DATE PRIMARY KEY,
  order_count INT,
  total_amount DECIMAL(12,2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 定时任务每天凌晨跑
INSERT INTO daily_stats (stat_date, order_count, total_amount)
SELECT DATE(created_at), COUNT(*), SUM(amount)
FROM orders
WHERE DATE(created_at) = CURDATE() - INTERVAL 1 DAY
GROUP BY DATE(created_at)
ON DUPLICATE KEY UPDATE
  order_count = VALUES(order_count),
  total_amount = VALUES(total_amount),
  updated_at = NOW();
```

### 21. OR 改写 UNION

```sql
-- ❌ OR 不走索引
SELECT * FROM products WHERE category_id = 10 OR brand_id = 5;

-- ✅ 各自走索引后合并
SELECT * FROM products WHERE category_id = 10
UNION ALL
SELECT * FROM products WHERE brand_id = 5;
```

### 22. IN 列表按频率排序

```sql
-- 把最常匹配的值放前面（MySQL IN 不保证顺序，但某些优化器会提前短路）
-- 实际效果取决于版本，重点是：别在 IN 里放几百个值
```

### 23. 存储过程减少网络开销

高频批量操作用存储过程封装，减少应用与数据库之间的往返：

```sql
DELIMITER //
CREATE PROCEDURE sp_batch_update_status(IN p_ids TEXT, IN p_status TINYINT)
BEGIN
  SET @sql = CONCAT(
    'UPDATE orders SET status = ', p_status,
    ' WHERE FIND_IN_SET(id, ''', p_ids, ''')'
  );
  PREPARE stmt FROM @sql;
  EXECUTE stmt;
  DEALLOCATE PREPARE stmt;
END //
DELIMITER ;
```

### 25. JOIN 顺序影响性能

```sql
-- 小表驱动大表：users 1000 行，orders 100 万行
-- ✅ 小表在前
SELECT u.name, o.order_no
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.id = 1001;
```

### 26. EXISTS 替代 COUNT(1)

```sql
-- ❌ 扫描全表统计
SELECT COUNT(1) FROM orders WHERE user_id = 1001;
IF count > 0 THEN ... END IF;

-- ✅ 找到第一条就返回
SELECT 1 FROM orders WHERE user_id = 1001 LIMIT 1;
```

### 27. 用 `>=` 替代 `>`

```sql
-- `>` 多一次等值判断
SELECT * FROM orders WHERE id > 100;
SELECT * FROM orders WHERE id >= 101;  -- 略快
```

### 40. EXPLAIN 分析执行计划（重点）

`EXPLAIN` 是 SQL 优化的核心工具：

```sql
EXPLAIN SELECT o.order_no, u.name
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'paid'
ORDER BY o.created_at DESC
LIMIT 10;
```

关键字段解读：

| 字段 | 含义 | 优化目标 |
|------|------|----------|
| `type` | 访问类型 | `const` > `ref` > `range` > `index` > `ALL` |
| `key` | 实际使用的索引 | 不为 NULL |
| `rows` | 预估扫描行数 | 越小越好 |
| `Extra` | 额外信息 | 避免 `Using filesort`、`Using temporary` |
| `filtered` | 过滤比例 | 接近 100% |

### 46. 查询缓存（MySQL 8.0 已移除）

MySQL 5.7 及之前可以开启 Query Cache，但高并发下锁竞争严重。MySQL 8.0 彻底移除了查询缓存，推荐用 Redis 做应用层缓存。

### 48. 只取一行时加 LIMIT 1

```sql
-- ❌ 扫描所有匹配行
SELECT * FROM users WHERE email = 'test@example.com';

-- ✅ 找到即停
SELECT * FROM users WHERE email = 'test@example.com' LIMIT 1;
```

### 52. 将操作移到等号右边

```sql
-- ❌ 对列做运算，索引失效
SELECT * FROM orders WHERE amount * 1.1 > 1000;

-- ✅ 运算移到右边
SELECT * FROM orders WHERE amount > 1000 / 1.1;
```

## 三、表设计与数据类型（第 12、13、44、49~51 条）

### 12. 用数字型字段替代字符型

```sql
-- ❌ 用字符串存状态
status VARCHAR(10)  -- 'pending', 'paid', 'shipped'

-- ✅ 用 TINYINT 存枚举
status TINYINT NOT NULL DEFAULT 0  -- 0=pending, 1=paid, 2=shipped
```

数字比较比字符串快得多，存储也更小。

### 13. VARCHAR 替代 CHAR

```sql
-- ❌ CHAR 固定长度，浪费空间
phone CHAR(15);

-- ✅ VARCHAR 变长，按需存储
phone VARCHAR(20);
```

### 44. 主键用 UNSIGNED INT AUTO_INCREMENT

```sql
CREATE TABLE orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(32) NOT NULL,
  ...
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

UNSIGNED 比有符号多一倍的正数范围，INT 比 BIGINT 省 4 字节/行。

### 49. 选择合适的存储引擎

| 场景 | 推荐引擎 | 原因 |
|------|----------|------|
| 读多写少，无事务 | MyISAM | 不支持事务但读快 |
| 读写混合，需要事务 | InnoDB | 行锁 + MVCC + 事务 |
| 临时数据，内存充足 | MEMORY | 数据在内存中，重启丢失 |

⚠️ MySQL 5.5+ 默认 InnoDB，绝大多数场景用 InnoDB 就对了。

### 50. 选择最小够用的数据类型

```sql
-- ❌ 浪费空间
ip_address VARCHAR(15);       -- '192.168.1.1'

-- ✅ 存整数，省一半空间
ip_address INT UNSIGNED;      -- INET_ATON('192.168.1.1') → 3232235777

-- 查询时转换
SELECT INET_NTOA(ip_address) FROM users;
```

### 51. CHAR / VARCHAR / TEXT 选择

| 类型 | 最大长度 | 存储方式 | 适用场景 |
|------|----------|----------|----------|
| CHAR | 255 字节 | 固定长度 | 定长数据（MD5、国家代码） |
| VARCHAR | 65535 字节 | 变长 | 短文本（用户名、标题） |
| TEXT | 65535 字节 | 溢出存储 | 长文本（内容、描述） |

VARCHAR 长度按实际需要定义，别图省事全写 255。

## 四、批量操作与事务（第 30、36、38、41 条）

### 30. 批量插入替代逐条插入

```sql
-- ❌ 逐条插入，1000 次网络往返
INSERT INTO logs (msg) VALUES ('a');
INSERT INTO logs (msg) VALUES ('b');
...

-- ✅ 批量插入，1 次网络往返
INSERT INTO logs (msg) VALUES ('a'), ('b'), ('c'), ...;
-- 每批 500~1000 条，超过可能触发 max_allowed_packet
```

### 36. 避免死锁

```sql
-- 事务中按固定顺序访问表
START TRANSACTION;
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- 先扣
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- 后加
COMMIT;

-- ❌ 不要这样（不同事务以不同顺序锁定行）
-- 事务A: UPDATE ... WHERE id=1 THEN id=2
-- 事务B: UPDATE ... WHERE id=2 THEN id=1  ← 死锁
```

### 38. 避免使用触发器

```sql
-- ❌ 触发器隐式执行，调试困难，性能不可控
CREATE TRIGGER trg_after_order_insert
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
  INSERT INTO order_logs (order_id, action) VALUES (NEW.id, 'created');
END;

-- ✅ 在应用层显式写入
$order->save();
OrderLog::create(['order_id' => $order->id, 'action' => 'created']);
```

### 41. 备份最佳实践

1. 从从库备份，不影响主库
2. 备份前停止复制，避免数据不一致
3. 用 `mysqldump --opt` 压缩导出
4. 同时备份 binlog，用于增量恢复
5. 定期验证备份可恢复性（`mysql < backup.sql`）

## 五、存储过程与高级技巧（第 24、29、31~35、37、42、43、45 条）

### 24. 连接池配置

```ini
# my.cnf
[mysqld]
max_connections = 500
thread_cache_size = 50    # 线程缓存，减少线程创建开销
```

### 29. 避免在索引列上做运算

```sql
-- ❌ 13 秒，索引失效
SELECT * FROM record WHERE SUBSTRING(card_no, 1, 4) = '5378';

-- ✅ < 1 秒，走索引
SELECT * FROM record WHERE card_no LIKE '5378%';
```

### 31. 用 SQL 替代循环

```sql
-- ❌ 应用层循环查询
for day in days:
    db.query("SELECT COUNT(*) FROM orders WHERE DATE(created_at) = ?", day)

-- ✅ 一次查询
SELECT DATE(created_at) AS day, COUNT(*) AS cnt
FROM orders
WHERE created_at >= '2026-06-01' AND created_at < '2026-07-01'
GROUP BY DATE(created_at);
```

### 33. GROUP BY 前先过滤

```sql
-- ❌ 先聚合再过滤
SELECT status, AVG(amount) FROM orders
GROUP BY status
HAVING status IN ('paid', 'shipped');

-- ✅ 先过滤再聚合
SELECT status, AVG(amount) FROM orders
WHERE status IN ('paid', 'shipped')
GROUP BY status;
```

### 34. SQL 关键字大写（风格规范）

```sql
-- ✅ 大写关键字提高可读性
SELECT o.order_no, u.name
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'paid';
```

MySQL 本身不区分大小写，但大写关键字是团队协作的好习惯。

### 35. 合理使用别名

短别名减少 SQL 长度，提高解析效率：

```sql
-- ✅ 单字母别名
SELECT o.order_no, u.name, p.title
FROM orders o
JOIN users u ON u.id = o.user_id
JOIN products p ON p.id = o.product_id;
```

### 37. 表变量替代临时表

MySQL 中临时表和表变量的区别：

```sql
-- 临时表（磁盘 or 内存，由优化器决定）
CREATE TEMPORARY TABLE tmp_result (id INT, val VARCHAR(100));

-- 内存临时结果（派生表）
SELECT * FROM (
  SELECT user_id, COUNT(*) AS cnt FROM orders GROUP BY user_id
) AS tmp WHERE cnt > 10;
```

### 42. 查询缓存不处理空格

```sql
-- 这两条查询在 Query Cache 中是不同的 key
SELECT * FROM users WHERE id = 1;
SELECT * FROM users WHERE id = 1;  -- 尾部多一个空格
```

MySQL 8.0 已移除 Query Cache，这条仅对 5.7 以前版本有效。

### 43. 分表策略

```sql
-- 按业务查询维度分表
-- ❌ 按 mid 分表但经常按 username 查询
-- ✅ 按 username hash 分表

-- 或者用 MySQL 原生分区
ALTER TABLE orders PARTITION BY RANGE (YEAR(created_at)) (
  PARTITION p2024 VALUES LESS THAN (2025),
  PARTITION p2025 VALUES LESS THAN (2026),
  PARTITION p2026 VALUES LESS THAN (2027),
  PARTITION pmax  VALUES LESS THAN MAXVALUE
);
```

### 45. 存储过程中 SET NOCOUNT ON

这是 SQL Server 的语法，MySQL 中无需关心。MySQL 默认不返回中间结果集的行计数。

## 六、实战：EXPLAIN 分析完整流程

![SQL 查询优化](/images/content/databases-1-content-2.jpg)

拿一个真实场景走一遍：

```sql
-- 场景：查询某用户最近 30 天的已支付订单，按金额排序
EXPLAIN
SELECT order_no, amount, status, created_at
FROM orders
WHERE user_id = 1001
  AND status = 'paid'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY amount DESC
LIMIT 20;
```

假设 EXPLAIN 输出：

```text
+------+---------------+------+---------+------+----------+-----------------------------+
| type | possible_keys | key  | key_len | rows | filtered | Extra                       |
+------+---------------+------+---------+------+----------+-----------------------------+
| ALL  | NULL          | NULL | NULL    | 987k |    1.00  | Using where; Using filesort |
+------+---------------+------+---------+------+----------+-----------------------------+
```

问题：全表扫描（`ALL`）+ 文件排序（`filesort`）。

优化步骤：

```sql
-- 1. 加联合索引（user_id, status, created_at 覆盖 WHERE）
ALTER TABLE orders ADD INDEX idx_user_status_created (user_id, status, created_at);

-- 2. 重新 EXPLAIN
EXPLAIN
SELECT order_no, amount, status, created_at
FROM orders
WHERE user_id = 1001
  AND status = 'paid'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY created_at DESC  -- 调整排序字段匹配索引
LIMIT 20;
```

优化后：

```text
+------+--------------------------+------+------+---------+----------+---------------------+
| type | key                      | ref  | rows | filtered | Extra                     |
+------+--------------------------+------+------+---------+----------+---------------------+
| ref  | idx_user_status_created  | const|   85 |   33.33 | Using index condition     |
+------+--------------------------+------+------+---------+----------+---------------------+
```

从扫描 98 万行降到 85 行，从 `ALL` 变成 `ref`，性能提升 10000 倍以上。

## 总结

52 条策略按优先级排序：

1. **先看 EXPLAIN** — 找到全表扫描和文件排序
2. **加对索引** — 联合索引覆盖 WHERE + ORDER BY
3. **改写查询** — 避免函数/表达式作用在索引列上
4. **控制数据量** — 禁止 SELECT *，分页，预计算
5. **优化表设计** — 合适的数据类型，合理的存储引擎

![SQL 查询优化](/images/content/databases-1-content-2.jpg)

别背口诀，**每个优化建议都要 EXPLAIN 验证**。

## 相关阅读

- [MySQL 优化经验总结](/databases/sql-optimization) — 系统梳理 MySQL SQL 优化核心方法论：从 slow_query_log 慢查询日志采集、EXPLAIN 执行计划解读，到覆盖索引、联合索引最左前缀、分页优化、子查询重写等 16 种优化技巧。
- [MySQL 慢查询治理实战：pt-query-digest 分析、索引优化与 SQL 重写](/databases/slow-query-governance) — 涵盖慢查询日志配置、pt-query-digest 深度分析、EXPLAIN 执行计划解读、索引优化策略与 SQL 重写技巧，帮助建立从发现到修复的慢查询治理闭环。
- [百万级数据表查询优化实战：EXPLAIN 深度分析、索引重构与分页治理](/databases/query-optimization-explain) — 面对千万级订单表和百万级商品表的真实查询优化实战，从 EXPLAIN 逐行分析到覆盖索引设计、从 OFFSET 分页风暴到游标分页的完整治理过程。
