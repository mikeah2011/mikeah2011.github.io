---

title: MySQL优化经验总结
keywords: [MySQL, 优化经验总结]
tags:
- MySQL
- SQL优化
- 索引优化
- 性能优化
- EXPLAIN
- 慢查询
categories:
- database
date: 2022-05-20 23:15:47
cover: https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/6411.png
images:
  - https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/6411.png
description: 系统梳理 MySQL SQL 优化核心方法论：从 slow_query_log 慢查询日志采集、EXPLAIN 逐字段深度解读到 pt-query-digest 分析工作流，覆盖覆盖索引、联合索引最左前缀、前缀索引、子查询重写、分页优化等 16 种优化技巧，附真实线上踩坑案例（隐式转换、大批量锁死、NOT IN NULL）与索引最佳实践，帮助开发者快速定位并解决生产环境中的数据库性能瓶颈。
---


![图片](https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/6411.png)

> 线上SQL的调优经验总结——从慢查询发现到优化落地的完整方法论

## 优化总览

- `slow_query_log` 日志中收集到的慢 SQL ，结合 `explain` 分析是否命中索引。
- 减少索引扫描行数，有针对性的优化慢 SQL。
- 建立联合索引，由于联合索引的每个叶子节点包含检索字段的信息，按最左前缀原则匹配后，再按其它条件过滤，减少回表的数据量。
- 还可以使用虚拟列和联合索引来提升复杂查询的执行效率。
- 监控 SQL 执行情况，发邮件、短信报警，便于快速识别慢查询 SQL。
- 打开数据库慢查询日志功能。
- 简化业务逻辑，代码重构优化。
- 异步处理非关键路径的数据库操作。

---

## 一、慢 SQL 发现与分析

### 1.1 开启慢查询日志

```sql
-- 查看慢查询配置
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';

-- 动态开启（生产环境建议永久配置到 my.cnf）
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;          -- 超过1秒记录
SET GLOBAL log_queries_not_using_indexes = ON;  -- 记录未使用索引的查询
```

### 1.2 EXPLAIN 执行计划核心字段

EXPLAIN 是 MySQL 优化 SQL 最核心的工具。下面逐字段详细解读：

| 字段 | 说明 | 关注重点 |
|------|------|----------|
| `id` | 查询序号 | id 相同从上往下执行；id 不同数字大的先执行（子查询） |
| `select_type` | 查询类型 | `SIMPLE`（简单查询）、`PRIMARY`（主查询）、`SUBQUERY`（子查询）、`DERIVED`（派生表）、`UNION` |
| `type` | 访问类型 | 从差到好：`ALL` → `index` → `range` → `ref` → `eq_ref` → `const/system` → `NULL` |
| `possible_keys` | 可能使用的索引 | 列出查询可能用到的索引 |
| `key` | 实际使用的索引 | `NULL` 表示未命中索引，需重点优化 |
| `key_len` | 索引使用的字节数 | 越短表示索引利用越少；可用于判断联合索引命中了几列 |
| `ref` | 索引关联的列或常量 | `const` 表示等值常量匹配，`func` 表示使用了函数 |
| `rows` | 预估扫描行数 | 数值越小越好，基于统计信息的估算值 |
| `filtered` | 过滤比例 | 百分比越高越好；100% 表示索引精确命中无额外过滤 |
| `Extra` | 额外信息 | 核心关注：`Using index`（覆盖索引✅）、`Using where`（Server 层过滤⚠️）、`Using filesort`（文件排序❌）、`Using temporary`（临时表❌） |

**type 字段详细解读：**

| type | 含义 | 示例场景 |
|------|------|----------|
| `ALL` | 全表扫描 | 无索引或索引失效 |
| `index` | 全索引扫描 | `SELECT count(*) FROM orders` |
| `range` | 索引范围扫描 | `WHERE id > 100`、`WHERE date BETWEEN ...` |
| `ref` | 非唯一索引等值 | `WHERE user_id = 10086`（user_id 有普通索引） |
| `eq_ref` | 唯一索引等值 | JOIN 时使用主键或唯一索引 |
| `const` | 常量 | `WHERE id = 1`（主键等值） |
| `NULL` | 无需访问表 | `SELECT 1` |

**EXPLAIN 输出实战示例：**

```sql
EXPLAIN SELECT o.id, o.order_no, u.name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 1 AND o.created_at > '2022-01-01';
```

```
+----+-------------+-------+--------+-------------------+---------+---------+------+------+-------+
| id | select_type | table | type   | possible_keys     | key     | key_len | ref  | rows | Extra |
+----+-------------+-------+--------+-------------------+---------+---------+------+------+-------+
|  1 | SIMPLE      | o     | range  | idx_uid_status    | idx_uid | 12      | NULL | 3200 | Using where |
|  1 | SIMPLE      | u     | eq_ref | PRIMARY           | PRIMARY | 4       | o.user_id | 1 | Using index |
+----+-------------+-------+--------+-------------------+---------+---------+------+------+-------+
```

> **逐行分析**：第一行扫描 orders 表，type=range 说明索引范围扫描命中 `idx_uid_status`；第二行通过主键关联 users 表，type=eq_ref 且 Extra=Using index 说明 users 表只用索引就完成了查询。两行 id 相同说明从上到下顺序执行。

### 1.3 慢查询日志分析工作流

仅开启慢查询日志还不够，需要定期分析。推荐使用 Percona Toolkit 的 `pt-query-digest`：

```bash
# 步骤 1：查看慢查询日志位置
SHOW VARIABLES LIKE 'slow_query_log_file';

# 步骤 2：使用 pt-query-digest 分析（输出 Top N 慢 SQL）
pt-query-digest /var/log/mysql/slow-query.log \
  --limit 20 \
  --order-by Query_time:sum \
  --report-format profile \
  > slow-query-report.txt

# 步骤 3：查看报告中的前 5 条慢 SQL（含执行次数、总耗时、平均耗时、锁时间）
# 输出格式：
# Profile
# Rank Query ID           Response time  Calls  R/Call  V/M
# ==== ================== ============= ====== ======= =====
#    1 0xABC123...        1520.0472 44.2  3280   0.4635  0.01
#    2 0xDEF456...         890.2312 25.9  1520   0.5857  0.05

# 步骤 4：取出具体 SQL 语句（含完整 EXPLAIN）
pt-query-digest /var/log/mysql/slow-query.log \
  --limit 1 \
  --report-format samples

# 步骤 5：在 MySQL 中执行 EXPLAIN
EXPLAIN SELECT ... ;  -- 粘贴 Top 1 的 SQL

# 步骤 6：导出慢查询报告用于邮件通知
pt-query-digest /var/log/mysql/slow-query.log \
  --mail ops@example.com \
  --limit 10
```

**完整工作流总结：**
1. 开启 `slow_query_log` 并设置 `long_query_time = 1`
2. 每天定时用 `pt-query-digest` 分析日志，生成报告
3. 按 `Query_time:sum` 排序，找出消耗最严重的 Top 10 SQL
4. 对每条慢 SQL 执行 EXPLAIN 分析
5. 根据 type/key/Extra 制定优化方案
6. 优化后回归测试，确认性能提升
7. 监控上线后指标，确保无性能回退

---

## 二、真实慢 SQL 案例与优化

### 案例 1：深分页问题（OFFSET 风暴）

**问题 SQL：**

```sql
SELECT id, order_no, amount, created_at
FROM orders
WHERE user_id = 10086
ORDER BY id DESC
LIMIT 100000, 10;
```

**EXPLAIN 输出（优化前）：**

```
+----+-------------+--------+------+---------------+---------+---------+-------+--------+-------+
| id | select_type | table  | type | possible_keys | key     | key_len | ref   | rows   | Extra |
+----+-------------+--------+------+---------------+---------+---------+-------+--------+-------+
|  1 | SIMPLE      | orders | ref  | idx_user_id   | idx_uid | 8       | const | 128456 | ...   |
+----+-------------+--------+------+---------------+---------+---------+-------+--------+-------+
```

> 虽然命中了 `idx_user_id` 索引，但 MySQL 需要先扫描 100010 行再丢弃前 100000 行，**执行耗时 2.3 秒**。

**优化方案——电梯直达（游标分页）：**

```sql
-- 方案A：先查出起始 ID（利用索引覆盖，极快）
SELECT id FROM orders
WHERE user_id = 10086
ORDER BY id DESC
LIMIT 100000, 1;

-- 方案B：用上一步拿到的 id 作为游标
SELECT id, order_no, amount, created_at
FROM orders
WHERE user_id = 10086 AND id < #{lastId}
ORDER BY id DESC
LIMIT 10;
```

**优化后 EXPLAIN：**

```
+----+-------------+--------+-------+---------------+---------+---------+------+------+-------------+
| id | select_type | table  | type  | possible_keys | key     | key_len | ref  | rows | Extra       |
+----+-------------+--------+-------+---------------+---------+---------+------+------+-------------+
|  1 | SIMPLE      | orders | range | idx_user_id   | idx_uid | 16      | NULL |   10 | Using where |
+----+-------------+--------+-------+---------------+---------+---------+------+------+-------------+
```

> 扫描行数从 **128456 → 10**，执行耗时 **2.3s → 0.003s**，性能提升 **760 倍**。

### 案例 2：索引失效——隐式类型转换

**问题 SQL：**

```sql
-- order_no 字段是 VARCHAR 类型，但传入了数字
SELECT * FROM orders WHERE order_no = 20220520001;
```

**EXPLAIN 输出：**

```
+----+-------------+--------+------+----------------+------+---------+------+--------+-------------+
| id | select_type | table  | type | possible_keys  | key  | key_len | ref  | rows   | Extra       |
+----+-------------+--------+------+----------------+------+---------+------+--------+-------------+
|  1 | SIMPLE      | orders | ALL  | uk_order_no    | NULL | NULL    | NULL | 986543 | Using where |
+----+-------------+--------+------+----------------+------+---------+------+--------+-------------+
```

> `type = ALL`，全表扫描！MySQL 对 VARCHAR 列做隐式 CAST，导致索引失效。

**修复：**

```sql
-- 加上引号，类型匹配后索引正常命中
SELECT * FROM orders WHERE order_no = '20220520001';
```

### 案例 3：WHERE 子句对索引列使用函数

```sql
-- ❌ 索引失效：对 created_at 使用 DATE() 函数
SELECT * FROM orders WHERE DATE(created_at) = '2022-05-20';

-- ✅ 改为范围查询，索引可命中
SELECT * FROM orders
WHERE created_at >= '2022-05-20 00:00:00'
  AND created_at <  '2022-05-21 00:00:00';
```

### 案例 4：OR 条件导致索引失效

```sql
-- ❌ status 列有索引，但 amount 列没有索引，OR 导致全表扫描
SELECT * FROM orders WHERE status = 1 OR amount > 1000;

-- ✅ 改为 UNION ALL，两路查询各自命中索引
SELECT * FROM orders WHERE status = 1
UNION ALL
SELECT * FROM orders WHERE amount > 1000 AND status != 1;
```

---

## 三、索引优化模式

### 3.1 联合索引与最左前缀原则

```sql
-- 建立联合索引
ALTER TABLE orders ADD INDEX idx_uid_status_time (user_id, status, created_at);

-- ✅ 命中索引（满足最左前缀）
SELECT * FROM orders WHERE user_id = 10086 AND status = 1;
SELECT * FROM orders WHERE user_id = 10086 ORDER BY created_at DESC;

-- ❌ 跳过最左列，索引失效
SELECT * FROM orders WHERE status = 1;

-- ❌ 范围查询后的列无法使用索引
-- user_id 是等值查询（可用），created_at 是范围查询（可用），
-- 但中间的 status 无法利用索引
SELECT * FROM orders WHERE user_id = 10086 AND created_at > '2022-01-01' AND status = 1;
```

### 3.2 覆盖索引避免回表

覆盖索引（Covering Index）是指查询所需的所有字段都包含在二级索引中，MySQL 无需回表查聚簇索引，直接从索引树获取数据。

```sql
-- 假设有索引 idx_uid_status (user_id, status)

-- ❌ SELECT * 需要回表取其他字段
SELECT * FROM orders WHERE user_id = 10086;

-- ✅ 只查索引包含的字段，Extra 显示 Using index（覆盖索引）
SELECT user_id, status FROM orders WHERE user_id = 10086;
```

**EXPLAIN 对比（覆盖索引 vs 普通查询）：**

| 查询方式 | type | Extra | 扫描行数 |
|---------|------|-------|---------|
| `SELECT *` | ref | Using where | 1280 |
| `SELECT user_id, status` | ref | **Using index** | 1280 |

> 虽然扫描行数相同，但覆盖索引省去了回表的随机 I/O。在每秒数万次查询的高并发场景下，省去的回表操作可显著降低磁盘 I/O 和 CPU 消耗。

### 3.3 前缀索引（Prefix Index）

当字段过长时（如 VARCHAR(255)），索引占用空间大、I/O 效率低。前缀索引只索引字段的前 N 个字符：

```sql
-- ❌ 完整索引：索引占用空间大
ALTER TABLE users ADD INDEX idx_email (email);
-- 索引大小：约 120MB

-- ✅ 前缀索引：只索引前 10 个字符
ALTER TABLE users ADD INDEX idx_email_prefix (email(10));
-- 索引大小：约 8MB，节省 93% 空间
```

**如何选择合适的前缀长度？** 通过不同长度的区分度（Cardinality）来确定：

```sql
-- 计算不同前缀长度的区分度
SELECT
  COUNT(DISTINCT LEFT(email, 5))  / COUNT(*) AS sel_5,
  COUNT(DISTINCT LEFT(email, 10)) / COUNT(*) AS sel_10,
  COUNT(DISTINCT LEFT(email, 15)) / COUNT(*) AS sel_15,
  COUNT(DISTINCT email)           / COUNT(*) AS sel_full
FROM users;

-- 结果示例：
-- +-------+----------+----------+----------+
-- | sel_5 | sel_10   | sel_15   | sel_full |
-- +-------+----------+----------+----------+
-- | 0.8234| 0.9876   | 0.9998   | 1.0000   |
-- +-------+----------+----------+----------+
-- 前缀长度 10 区分度已达 98.76%，再长收益极小，选 10 即可
```

> **注意**：前缀索引无法用于 ORDER BY 和覆盖索引（因为索引不包含完整值）。

### 3.4 子查询重写优化

MySQL 对子查询的优化能力历史上较弱（8.0 后有改善但仍建议优先 JOIN/EXISTS）：

```sql
-- ❌ IN 子查询（MySQL 5.6 以前会物化子查询再逐条匹配，性能差）
SELECT * FROM orders
WHERE user_id IN (SELECT id FROM users WHERE vip = 1);

-- ✅ 改写为 EXISTS（短路判断，找到一条即返回）
SELECT * FROM orders o
WHERE EXISTS (
  SELECT 1 FROM users u
  WHERE u.id = o.user_id AND u.vip = 1
);

-- ✅ 改写为 JOIN（推荐，优化器更成熟）
SELECT DISTINCT o.id, o.order_no, o.amount
FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE u.vip = 1;

-- ❌ NOT IN（无法使用索引，且对 NULL 值敏感）
SELECT * FROM orders
WHERE user_id NOT IN (SELECT id FROM users WHERE status = 0);

-- ✅ 改写为 NOT EXISTS
SELECT * FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM users u
  WHERE u.id = o.user_id AND u.status = 0
);

-- ✅ 改写为 LEFT JOIN（推荐）
SELECT o.id, o.order_no
FROM orders o
LEFT JOIN users u ON o.user_id = u.id
WHERE u.id IS NULL OR u.status != 0;
```

### 3.5 索引条件下推（ICP）

MySQL 5.6+ 引入的 Index Condition Pushdown，将部分 WHERE 条件下推到存储引擎层执行，减少回表次数。

```sql
-- 联合索引 idx_name_age (name, age)
SELECT * FROM users WHERE name LIKE '张%' AND age > 25;
```

- **无 ICP**：存储引擎根据 `name LIKE '张%'` 找到所有记录 → 逐条回表 → Server 层再过滤 `age > 25`
- **有 ICP**：存储引擎在索引层直接过滤 `age > 25` → 只对满足条件的记录回表

EXPLAIN 中 Extra 显示 `Using index condition` 表示 ICP 生效。

---

## 四、16 种常见优化技巧

### 4.1 SQL 层面优化

1. **分页优化**。`LIMIT 100000, 10` 先查找起始的主键 ID，再通过 `id > #{value}` 往后取 10 条（电梯直达）。

2. **使用覆盖索引**，索引的叶节点中已包含要查询的字段，减少回表查询。

3. **UNION ALL 代替 UNION**，后者会执行去重排序操作，在确认无重复数据时使用 UNION ALL 性能更优。

4. **EXISTS 代替 IN**（子查询结果集大时）：
   ```sql
   -- ❌ IN：先执行子查询得到全部结果再匹配
   SELECT * FROM orders WHERE user_id IN (SELECT id FROM users WHERE vip = 1);
   -- ✅ EXISTS：逐条对外表记录做短路判断
   SELECT * FROM o WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.vip = 1);
   ```

5. **NOT EXISTS 代替 NOT IN**，NOT IN 无法使用索引且对 NULL 敏感。

6. **连接查询代替子查询**，MySQL 对子查询的优化器历史上较弱（8.0 后有改善）。

7. **批量操作**，减少网络往返。批量 INSERT 比逐条 INSERT 快 10-50 倍。

8. **小表驱动大表**，小结果集的表作为外层循环（驱动表）。

9. **多用 LIMIT**，避免不必要的全量数据传输。

10. **IN 中值太多时分批查询**，IN 列表过长会导致优化器选择全表扫描。

11. **增量查询**，利用自增 ID 或时间戳做增量同步，避免全表扫描。

12. **JOIN 表不宜过多**，超过 3 张表的 JOIN 建议拆分或冗余字段。

13. **控制索引数量**，单表索引建议不超过 5-6 个，过多影响写入性能。

14. **选择合理的字段类型**，能用 INT 不用 VARCHAR，能用 TINYINT 不用 INT。

15. **提升 GROUP BY 效率**，确保 GROUP BY 的列有索引，避免 Using temporary + Using filesort。

16. **WHERE 子句优化**：
    - 避免对字段进行 `NULL` 值判断、表达式操作；
    - 表之间的连接条件写在其他 `WHERE` 条件之前；
    - 可过滤掉最大数量记录的条件写在 `WHERE` 子句末尾，`HAVING` 最后；
    - 避免在索引列上使用函数运算、`IS NULL` 和 `IS NOT NULL`。

### 4.2 设计层面优化

- 避免使用 NULL，用默认值替代（NULL 会影响索引效率和查询逻辑复杂度）。
- 使用简单数据类型（INT 优于 VARCHAR 存储数字）。
- 减少 TEXT/BLOB 类型的使用，必要时拆分到扩展表。
- 适当增加冗余字段减少连表查询（反范式化设计）。
- 使用虚拟列（Generated Column）+ 索引来优化复杂计算查询。
- 分库分表应对数据量增长（详见 [分库分表](/databases/sharding/) 专题）。

### 4.3 硬件与架构层面优化

- 使用 SSD 减少 I/O 时间。
- 确保足够大的网络带宽和尽量大的内存（InnoDB Buffer Pool 尽量分配到物理内存的 70%-80%）。
- 读写分离，将读压力分散到从库。
- 异步处理非关键路径的数据库操作（消息队列削峰）。

---

## 五、性能对比数据

### 分页查询优化对比

| 方案 | SQL | 扫描行数 | 执行时间 |
|------|-----|---------|---------|
| 传统 OFFSET | `LIMIT 100000, 10` | 100,010 | 2.3s |
| 游标分页 | `id < #{lastId} LIMIT 10` | 10 | 0.003s |
| 延迟关联 | 子查询取 ID 后 JOIN | 100,010 + 10 | 0.12s |

### 索引优化对比

| 场景 | 优化前 | 优化后 | 提升倍数 |
|------|--------|--------|---------|
| 隐式类型转换 | ALL 扫描 98 万行 | ref 扫描 1 行 | ~980,000x |
| SELECT * → 覆盖索引 | 回表 1280 次随机 IO | 纯索引扫描 | 5-10x（高并发） |
| OR → UNION ALL | ALL 扫描 50 万行 | 两路 ref 共 2000 行 | ~250x |
| DATE() 函数 → 范围查询 | ALL 扫描 100 万行 | range 扫描 3000 行 | ~330x |

### 子查询 vs 连接查询

| 写法 | 10 万数据量 | 100 万数据量 |
|------|------------|-------------|
| IN 子查询 | 1.8s | 18.5s |
| EXISTS 改写 | 0.9s | 9.2s |
| JOIN 改写 | 0.4s | 3.8s |

> 以上数据基于 MySQL 8.0、InnoDB 引擎、16GB 内存环境测试，实际性能因数据分布和硬件配置而异。

---

## 六、踩坑案例与经验教训

### 案例 1：隐式字符集转换导致全表扫描

```sql
-- ❌ 表 A 的 charset=utf8mb4，表 B 的 charset=utf8
-- JOIN 时 MySQL 会自动转换字符集，导致索引失效
SELECT * FROM orders o
JOIN users u ON o.user_name = u.name  -- utf8mb4 vs utf8，索引失效！
WHERE o.status = 1;
```

**排查过程：** EXPLAIN 显示 `type=ALL`，`possible_keys=NULL`。检查表结构发现 `orders.user_name` 是 `utf8mb4` 而 `users.name` 是 `utf8`。

**修复：** 统一所有表的字符集为 `utf8mb4`：
```sql
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

> **教训**：跨表 JOIN 前务必检查关联字段的字符集和排序规则是否一致，否则索引静默失效。

### 案例 2：大批量 UPDATE 锁死表

```sql
-- ❌ 一次性更新 200 万行数据
UPDATE orders SET status = 3 WHERE created_at < '2021-01-01';
```

**问题**：InnoDB 默认事务隔离级别 REPEATABLE READ 下，这会锁定大量行甚至升级为表锁，导致其他写操作超时。

**修复——分批更新：**
```sql
-- ✅ 每次更新 5000 行，利用自增 ID 做分页
SET @min_id = 0;
WHILE @min_id < (SELECT MAX(id) FROM orders WHERE created_at < '2021-01-01') DO
  UPDATE orders
  SET status = 3
  WHERE created_at < '2021-01-01'
    AND id > @min_id
  ORDER BY id
  LIMIT 5000;
  SET @min_id = @min_id + 5000;
  COMMIT;
END WHILE;
```

> **教训**：大批量数据修改必须分批执行，每批 COMMIT 释放锁，避免长时间持锁。

### 案例 3：索引过多导致写入性能暴跌

**问题**：某表有 12 个索引，单次 INSERT 耗时从 5ms 飙升到 200ms。

**排查**：`SHOW INDEX FROM orders` 发现大量冗余索引（如 `idx_a`、`idx_b` 被 `idx_ab` 覆盖）。

**修复：** 删除冗余索引，最终保留 4 个核心索引：
```sql
DROP INDEX idx_a ON orders;
DROP INDEX idx_b ON orders;
DROP INDEX idx_created_at ON orders;
```

> **教训**：单表索引数控制在 5-6 个以内。定期用 `pt-index-usage` 分析索引使用率，删除未使用的索引。

### 案例 4：NOT IN 子查询导致全表扫描

```sql
-- ❌ NOT IN 子查询结果集中若含 NULL，整条查询返回空结果
SELECT * FROM products
WHERE id NOT IN (SELECT product_id FROM order_items WHERE refund_status IS NULL);
```

**问题**：NOT IN 对 NULL 极度敏感，且无法使用索引，EXPLAIN 显示 ALL。

**修复：**
```sql
-- ✅ 使用 LEFT JOIN + IS NULL
SELECT p.*
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id AND oi.refund_status IS NULL
WHERE oi.product_id IS NULL;
```

> **教训**：永远不要在子查询中使用 `NOT IN`，改用 `NOT EXISTS` 或 `LEFT JOIN ... IS NULL`。

---

## 七、索引最佳实践

### 7.1 索引设计原则

1. **最左前缀匹配**：联合索引 (a, b, c) 能匹配 a、a+b、a+b+c，但不能跳过 a 直接用 b。
2. **区分度优先**：区分度高的列放在联合索引的前面（区分度 = COUNT(DISTINCT col) / COUNT(*)）。
3. **覆盖索引优先**：尽量让查询只命中索引列，避免回表。
4. **短索引优先**：能用前缀索引就不用全字段索引，能用 INT 就不用 VARCHAR。
5. **避免冗余索引**：(a,b) 已包含 (a)，不需要单独建 (a)。

### 7.2 索引数量控制

| 表数据量 | 建议索引数 | 说明 |
|---------|-----------|------|
| < 10 万 | 3-5 个 | 小表性能影响小 |
| 10-100 万 | 5-8 个 | 平衡读写性能 |
| 100 万+ | 5-6 个 | 写入敏感，必须精简 |

### 7.3 索引维护清单

```sql
-- 查看表的索引信息
SHOW INDEX FROM orders;

-- 查看索引基数（区分度）
SELECT
  INDEX_NAME, COLUMN_NAME, CARDINALITY,
  ROUND(CARDINALITY / (SELECT TABLE_ROWS FROM information_schema.TABLES
    WHERE TABLE_NAME = 'orders') * 100, 2) AS selectivity
FROM information_schema.STATISTICS
WHERE TABLE_NAME = 'orders'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- 使用 pt-index-usage 分析索引使用率（基于慢查询日志）
pt-index-usage /var/log/mysql/slow-query.log \
  --host=localhost \
  --ask-pass
```

---

## 八、监控与持续优化

1. **慢查询日志 + pt-query-digest**：定期分析慢查询日志，识别 Top N 慢 SQL。
2. **Performance Schema**：监控 SQL 的锁等待、IO 等待等详细指标。
3. **EXPLAIN 定期回归**：代码变更后确认执行计划未退化。
4. **索引使用率监控**：删除长期未使用的冗余索引，减少写放大。
5. **CI/CD 集成慢查询检测**：在发布流水线中自动检测新增的慢查询。

---

## 相关阅读

- [MySQL 慢查询治理实战：pt-query-digest 分析、索引优化与 SQL 重写](/databases/slow-query-governance/)
- [数据库索引优化实战：覆盖索引、联合索引与索引下推](/databases/index-optimization-explain/)
- [百万级数据表查询优化实战：EXPLAIN 深度分析与分页治理](/databases/query-optimization-explain/)
- [分库分表](/databases/sharding/)