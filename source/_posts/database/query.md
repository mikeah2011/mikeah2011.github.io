---
title: SQL查询语句的流程
tags: [MySQL, SQL查询, 执行流程, 优化器, EXPLAIN, 性能优化]
keywords: [SQL, 查询语句的流程, 数据库]
categories:
  - database
date: 2021-03-20 15:05:07
description: '深入解析MySQL SQL查询语句的完整执行流程，逐一剖析连接器、分析器、优化器、执行器四大核心组件的工作原理与内部机制，详解代价模型决策过程与EXPLAIN输出字段解读，对比MySQL 5.7与8.0在查询缓存、直方图统计、执行计划缓存上的关键差异，附各阶段查询优化实战技巧，帮助开发者全面掌握SQL查询优化原理。'
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-001-content-1.jpg
  - /images/content/databases-001-content-2.jpg


---

当Mysql执行一条查询的SQl的时候大概发生了以下的步骤：

1. 客户端发送查询语句给服务器。
2. 服务器首先进行用户名和密码的验证以及权限的校验。
3. 然后会检查缓存中是否存在该查询，若存在，返回缓存中存在的结果。若是不存在就进行下一步。注意：Mysql 8就把缓存这块给砍掉了。
4. 接着进行语法和词法的分析，对SQl的解析、语法检测和预处理，再由优化器生成对应的执行计划。
5. Mysql的执行器根据优化器生成的执行计划执行，调用存储引擎的接口进行查询。服务器将查询的结果返回客户端。

Mysql中语句的执行都是都是分层执行，每一层执行的任务都不同，直到最后拿到结果返回，主要分为**Service层**和**引擎层**。

**在Service层中包含：连接器、分析器、优化器、执行器。引擎层以插件的形式可以兼容各种不同的存储引擎，主要包含的有InnoDB和MyISAM两种存储引擎**。具体的执行流程图如下所示：

![SQL查询执行流程](/images/content/databases-001-content-1.jpg)

![MySQL架构层次](/images/content/databases-001-content-2.jpg)

![图片](/images/6420.png)

## 查询执行流程详解

### 1. 连接器（Connector）

连接器负责与客户端建立连接、获取权限、维持和管理连接。连接时会进行TCP三次握手，然后开始验证身份。连接成功后，后续的权限判断都依赖于此时读到的权限。

**连接器内部工作流程**：
1. **TCP三次握手**：客户端与MySQL服务器建立TCP连接
2. **身份验证**：服务器验证用户名、密码及主机权限（查询 `mysql.user` 表）
3. **权限获取**：读取该用户的全局权限并缓存在内存中
4. **连接维护**：将连接放入线程池，分配独立线程处理后续请求

**连接状态查看**：

```sql
-- 查看当前连接数
SHOW STATUS LIKE 'Threads_connected';
-- 查看最大连接数
SHOW VARIABLES LIKE 'max_connections';
-- 查看连接线程状态
SHOW PROCESSLIST;
-- 查看连接超时设置
SHOW VARIABLES LIKE 'wait_timeout';
SHOW VARIABLES LIKE 'interactive_timeout';
```

**长连接 vs 短连接**：

| 特性 | 长连接 | 短连接 |
|---|---|---|
| 连接建立频率 | 低，复用连接 | 高，每次查询都建立 |
| 内存占用 | 持续占用，可能累积 | 用完即释放 |
| 适用场景 | 高并发、频繁查询 | 低并发、偶尔查询 |
| 潜在问题 | 内存泄漏风险 | TCP握手开销大 |

**优化建议**：使用连接池（如HikariCP、ProxySQL）避免频繁建立/断开连接的开销。长连接在执行过程中会占用内存，建议定期断开重连或在执行大查询后调用 `mysql_reset_connection` 重置连接状态（MySQL 5.7+支持）。

### 2. 查询缓存（Query Cache）

MySQL收到查询请求后，会先查询缓存。如果命中缓存则直接返回结果，否则进入分析器阶段。缓存以SQL语句为Key进行哈希匹配，任何字符不同都会导致缓存失效。

> **MySQL 8.0重要变更**：查询缓存功能已被完全移除。原因是表数据的任何更新都会清空该表的所有缓存，在写密集型场景下命中率极低，反而增加了维护开销。

**移除原因深度分析**：

1. **全局锁瓶颈**：查询缓存使用全局锁 `query_cache_lock`，高并发下成为性能瓶颈
2. **表级失效**：任何表的更新都会清空该表的所有缓存，命中率极低
3. **内存碎片**：固定大小的内存块导致碎片化，降低内存利用率
4. **维护成本**：缓存的创建、失效、清理增加了系统开销
5. **替代方案更优**：Redis、Memcached等外部缓存提供更灵活的缓存策略

### 查询缓存对比

| 特性 | MySQL 5.7（有缓存） | MySQL 8.0（无缓存） |
|---|---|---|
| 缓存机制 | SQL文本哈希匹配 | 无，依赖外部缓存 |
| 失效策略 | 表级失效，任何更新清空整表缓存 | N/A |
| 适用场景 | 读多写少、查询重复率高 | 所有场景 |
| 并发瓶颈 | 全局锁（query_cache_lock） | 无此瓶颈 |
| 内存管理 | 占用固定内存，可能碎片化 | 内存更可控 |
| 推荐方案 | 关闭query_cache，使用Redis等外部缓存 | 使用Redis/Memcached等外部缓存 |

### 3. 分析器（Parser）

分析器负责**词法分析**、**语法分析**和**预处理**三个阶段：

**词法分析（Lexical Analysis）**：

将SQL字符串拆分成一个个Token（词法单元）。例如：

```sql
SELECT username FROM users WHERE id = 1;
```

会被识别为：
- 关键字：`SELECT`、`FROM`、`WHERE`
- 标识符：`username`、`users`、`id`
- 常量：`1`
- 运算符：`=`

**语法分析（Syntax Analysis）**：

根据MySQL语法规则（基于LALR(1)文法）判断SQL是否合法，生成**解析树（Parse Tree）**。如果语法错误会返回 `You have an error in your SQL syntax`。

**预处理（Preprocessor）**：

- 检查表和字段是否存在（查询数据字典）
- 解析名字和别名，处理通配符 `*` 展开
- 验证权限（表级、列级权限检查）
- 处理子查询、视图展开

**优化建议**：此阶段无法从SQL层面优化，但应避免使用保留字作为表名或列名，减少解析器的歧义判断。建议使用反引号包裹标识符，如 `` SELECT `order` FROM `user` ``。

### 4. 优化器（Optimizer）

优化器是查询执行中最关键的组件，它基于**代价模型（Cost-Based Optimizer, CBO）**进行决策：

**优化器决策内容**：

1. **索引选择**：从候选索引中选择代价最低的索引
2. **连接顺序**：多表JOIN时决定表的连接顺序（n!种可能）
3. **索引下推（ICP）**：是否将WHERE条件下推到存储引擎层
4. **覆盖索引**：是否可以通过索引直接获取数据，避免回表
5. **子查询优化**：将子查询转换为JOIN或半连接（Semi-Join）
6. **排序优化**：是否可以利用索引避免额外排序

**代价模型计算因素**：

```
总代价 = IO代价 + CPU代价
IO代价 = 页读取次数 × 单次IO代价
CPU代价 = 行处理次数 × 单次CPU代价
```

**统计信息影响**：

| 统计信息 | 作用 | 更新方式 |
|---|---|---|
| 表行数（cardinality） | 估算扫描行数 | `ANALYZE TABLE` |
| 索引区分度 | 判断索引选择性 | `ANALYZE TABLE` |
| 数据分布 | 估算范围查询结果集 | `ANALYZE TABLE`（MySQL 8.0+直方图） |
| 页面统计 | 估算IO代价 | 自动更新 |

**优化建议**：定期执行 `ANALYZE TABLE` 更新统计信息，确保优化器做出准确判断。必要时使用 `FORCE INDEX` 指定索引。MySQL 8.0+支持直方图统计，可以更精确地描述数据分布。

### 5. 执行器（Executor）

执行器根据优化器的执行计划，调用存储引擎接口逐行或批量获取数据。执行器的工作流程：

**执行流程**：

1. **权限检查**：验证当前用户对该表的查询权限（如果权限不足，返回 `ERROR 1142`）
2. **初始化执行上下文**：根据执行计划初始化必要的数据结构
3. **调用存储引擎接口**：通过Handler API调用引擎的读取接口
4. **数据处理**：将返回的行放入结果集进行过滤、排序、聚合等处理
5. **结果返回**：将最终结果发送给客户端

**存储引擎接口示例**：

```c
// InnoDB Handler API 示例
handler::index_read()      // 索引读取
handler::index_next()      // 索引下一条
handler::rnd_next()        // 随机扫描下一条
handler::delete_row()      // 删除行
handler::update_row()      // 更新行
```

**执行计划缓存（MySQL 8.0+）**：

MySQL 8.0引入了执行计划缓存，对于相同的查询模板，可以复用已优化的执行计划，避免重复优化：

```sql
-- 查看执行计划缓存状态
SHOW STATUS LIKE 'Prepared_stmt_count';
-- 查看缓存命中情况
SHOW STATUS LIKE 'Handler_commit';
```

## EXPLAIN输出详解

`EXPLAIN` 是分析查询执行计划的核心工具，它展示了MySQL如何执行查询的详细信息。

### 基础EXPLAIN示例

```sql
-- 简单查询的EXPLAIN
EXPLAIN SELECT * FROM users WHERE age > 25 ORDER BY name LIMIT 10;
```

```text
+----+-------------+-------+------------+-------+---------------+---------+---------+------+------+----------+-----------------------+
| id | select_type | table | partitions | type  | possible_keys | key     | key_len | ref  | rows | filtered | Extra                 |
+----+-------------+-------+------------+-------+---------------+---------+---------+------+------+----------+-----------------------+
|  1 | SIMPLE      | users | NULL       | range | idx_age       | idx_age | 4       | NULL | 5000 |   100.00 | Using where; Using filesort |
```

**输出字段详解**：

| 字段 | 说明 | 优化意义 |
|---|---|---|
| **id** | 查询序号，相同id从上往下执行，不同id大的先执行 | 理解查询执行顺序 |
| **select_type** | 查询类型：SIMPLE、PRIMARY、SUBQUERY、DERIVED、UNION等 | 识别复杂查询结构 |
| **table** | 访问的表 | 确认表访问顺序 |
| **partitions** | 匹配的分区 | 分区表优化 |
| **type** | 访问类型（关键指标） | 从好到差：`system > const > eq_ref > ref > range > index > ALL` |
| **possible_keys** | 可能使用的索引 | 索引选择范围 |
| **key** | 实际使用的索引 | 确认索引是否生效 |
| **key_len** | 索引使用的字节数 | 判断联合索引使用了多少列 |
| **ref** | 索引比较的列或常量 | 理解索引查找条件 |
| **rows** | 预估扫描行数 | 越小越好，影响IO开销 |
| **filtered** | 条件过滤后的行百分比 | 100%表示无需额外过滤 |
| **Extra** | 额外信息（重要优化指标） | 见下方详解 |

### Extra字段常见值

| Extra值 | 含义 | 优化建议 |
|---|---|---|
| `Using index` | 覆盖索引，无需回表 | 最优情况，无需优化 |
| `Using where` | 在Server层进行过滤 | 考虑添加索引 |
| `Using filesort` | 需要额外排序操作 | 优化索引或调整ORDER BY |
| `Using temporary` | 使用临时表 | 优化GROUP BY或DISTINCT |
| `Using index condition` | 索引下推（ICP） | MySQL 5.6+特性，减少回表 |
| `Using join buffer` | 使用连接缓冲区 | 考虑添加索引优化JOIN |

### 不同场景EXPLAIN示例

**示例1：覆盖索引（最优）**

```sql
-- 假设有联合索引 idx_age_name(age, name)
EXPLAIN SELECT age, name FROM users WHERE age > 25;
```

```text
+----+-------------+-------+-------+---------------+-----------+---------+------+------+----------+--------------------------+
| id | select_type | table | type  | possible_keys | key       | key_len | ref  | rows | filtered | Extra                    |
+----+-------------+-------+-------+---------------+-----------+---------+------+------+----------+--------------------------+
|  1 | SIMPLE      | users | range | idx_age_name  | idx_age_name | 4    | NULL | 5000 |   100.00 | Using where; Using index |
+----+-------------+-------+-------+---------------+-----------+---------+------+------+----------+--------------------------+
```

**示例2：全表扫描（需优化）**

```sql
EXPLAIN SELECT * FROM users WHERE email LIKE '%@example.com';
```

```text
+----+-------------+-------+------+---------------+------+---------+------+--------+----------+-------------+
| id | select_type | table | type | possible_keys | key  | key_len | ref  | rows   | filtered | Extra       |
+----+-------------+-------+------+---------------+------+---------+------+--------+----------+-------------+
|  1 | SIMPLE      | users | ALL  | NULL          | NULL | NULL    | NULL | 100000 |    11.11 | Using where |
+----+-------------+-------+------+---------------+------+---------+------+--------+----------+-------------+
```

**示例3：多表JOIN优化**

```sql
EXPLAIN SELECT o.id, u.name 
FROM orders o 
JOIN users u ON o.user_id = u.id 
WHERE o.status = 'completed';
```

```text
+----+-------------+-------+------+-----------------+---------+---------+------------------+------+----------+-------------+
| id | select_type | table | type | possible_keys   | key     | key_len | ref              | rows | filtered | Extra       |
+----+-------------+-------+------+-----------------+---------+---------+------------------+------+----------+-------------+
|  1 | SIMPLE      | o     | ref  | idx_user_status | idx_user_status | 1 | const            | 5000 |   100.00 | Using where |
|  1 | SIMPLE      | u     | eq_ref | PRIMARY       | PRIMARY | 4       | db.o.user_id     |    1 |   100.00 | NULL        |
+----+-------------+-------+------+-----------------+---------+---------+------------------+------+----------+-------------+
```

### EXPLAIN FORMAT=JSON（详细信息）

```sql
EXPLAIN FORMAT=JSON SELECT * FROM users WHERE age > 25 ORDER BY name LIMIT 10;
```

JSON格式提供更详细的成本信息：

```json
{
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "1234.56"
    },
    "ordering_operation": {
      "using_filesort": true,
      "table": {
        "table_name": "users",
        "access_type": "range",
        "rows_examined_per_scan": 5000,
        "filtered": "100.00",
        "cost_info": {
          "read_cost": "500.00",
          "eval_cost": "734.56",
          "prefix_cost": "1234.56",
          "data_read_per_join": "1M"
        }
      }
    }
  }
}
```

## MySQL 5.7 vs 8.0 查询处理差异

| 特性 | MySQL 5.7 | MySQL 8.0 |
|---|---|---|
| 查询缓存 | 支持，可通过 `query_cache_type` 配置 | 已移除 |
| 优化器 | 基于规则+代价优化 | 引入直方图（Histogram）统计，优化更精确 |
| CTE支持 | 不支持 | 支持 `WITH` 公用表表达式 |
| 窗口函数 | 不支持 | 支持 `ROW_NUMBER()`、`RANK()` 等 |
| 索引下推 | 支持 | 进一步优化，支持更多场景 |
| JSON处理 | 基础支持 | 引入 `JSON_TABLE()` 等高级功能 |
| 执行计划缓存 | 不支持（Prepared Statement有限支持） | 支持查询执行计划缓存 |

## 实战：EXPLAIN优化案例

### 案例1：优化慢查询

**问题SQL**（执行时间：2.5秒）：

```sql
SELECT * FROM orders 
WHERE user_id = 12345 
AND created_at > '2024-01-01' 
ORDER BY amount DESC 
LIMIT 10;
```

**EXPLAIN分析**：

```text
+----+-------------+-------+------+---------------+------+---------+------+--------+----------+-----------------------------+
| id | select_type | table | type | possible_keys | key  | key_len | ref  | rows   | filtered | Extra                       |
+----+-------------+-------+------+---------------+------+---------+------+--------+----------+-----------------------------+
|  1 | SIMPLE      | orders | ALL  | NULL          | NULL | NULL    | NULL | 500000 |     1.00 | Using where; Using filesort |
+----+-------------+-------+------+---------------+------+---------+------+--------+----------+-----------------------------+
```

**问题诊断**：
- `type: ALL` - 全表扫描，没有使用索引
- `rows: 500000` - 扫描了50万行
- `Using filesort` - 额外排序操作

**优化方案**：

```sql
-- 添加联合索引
ALTER TABLE orders ADD INDEX idx_user_created_amount(user_id, created_at, amount);

-- 优化后的EXPLAIN
EXPLAIN SELECT * FROM orders 
WHERE user_id = 12345 
AND created_at > '2024-01-01' 
ORDER BY amount DESC 
LIMIT 10;
```

**优化后结果**：

```text
+----+-------------+-------+-------+-------------------------+-------------------------+---------+------+------+----------+--------------------------+
| id | select_type | table | type  | possible_keys           | key                     | key_len | ref  | rows | filtered | Extra                    |
+----+-------------+-------+-------+-------------------------+-------------------------+---------+------+------+----------+--------------------------+
|  1 | SIMPLE      | orders | range | idx_user_created_amount | idx_user_created_amount | 9      | NULL |   50 |   100.00 | Using where; Using index |
+----+-------------+-------+-------+-------------------------+-------------------------+---------+------+------+----------+--------------------------+
```

**优化效果**：
- 扫描行数：500000 → 50（减少99.99%）
- 访问类型：ALL → range（使用索引范围扫描）
- 排序优化：Using filesort → Using index（利用索引排序）

### 案例2：优化子查询

**问题SQL**：

```sql
SELECT * FROM users 
WHERE id IN (
    SELECT user_id FROM orders 
    WHERE status = 'completed' 
    AND amount > 1000
);
```

**EXPLAIN分析**：

```text
+----+--------------------+-------+-----------------+---------------+---------+---------+------+--------+----------+-------------+
| id | select_type        | table | type            | possible_keys | key     | key_len | ref  | rows   | filtered | Extra       |
+----+--------------------+-------+-----------------+---------------+---------+---------+------+--------+----------+-------------+
|  1 | PRIMARY            | users | ALL             | NULL          | NULL    | NULL    | NULL | 100000 |   100.00 | Using where |
|  2 | DEPENDENT SUBQUERY | orders | index_subquery | idx_user_status | idx_user_status | 5 | func | 100   |    10.00 | Using where |
+----+--------------------+-------+-----------------+---------------+---------+---------+------+--------+----------+-------------+
```

**优化方案**（使用JOIN替代子查询）：

```sql
SELECT DISTINCT u.* 
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.status = 'completed' 
AND o.amount > 1000;
```

## 性能监控SQL汇总

```sql
-- 查看查询执行统计
SHOW GLOBAL STATUS LIKE 'Com_select';
SHOW GLOBAL STATUS LIKE 'Com_insert';
SHOW GLOBAL STATUS LIKE 'Com_update';
SHOW GLOBAL STATUS LIKE 'Com_delete';

-- 查看慢查询统计
SHOW GLOBAL STATUS LIKE 'Slow_queries';
SHOW VARIABLES LIKE 'long_query_time';
SHOW VARIABLES LIKE 'slow_query_log';

-- 查看InnoDB缓冲池命中率
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read%';
-- 命中率 = 1 - (Innodb_buffer_pool_reads / Innodb_buffer_pool_read_requests)

-- 查看表锁统计
SHOW GLOBAL STATUS LIKE 'Table_locks%';
```

## 各阶段优化建议

| 阶段 | 常见问题 | 优化策略 |
|---|---|---|
| 连接器 | 连接数过多、频繁建连 | 使用连接池，合理设置 `max_connections` |
| 查询缓存 | 缓存命中率低 | MySQL 8.0已移除；低版本建议关闭，使用Redis等外部缓存 |
| 分析器 | SQL写法不规范 | 避免保留字，保持SQL简洁规范 |
| 优化器 | 选错索引、统计信息过期 | 定期 `ANALYZE TABLE`；必要时使用 `FORCE INDEX` |
| 执行器 | 全表扫描、回表次数多 | 使用覆盖索引、减少 `SELECT *`、合理设计索引 |

## 相关阅读

- [百万级数据表查询优化实战：Laravel B2C API EXPLAIN 深度分析、索引重构与分页治理踩坑记录](/categories/Databases/query-optimization-explain/) — EXPLAIN实战分析与索引优化
- [MySQL慢查询治理实战：pt-query-digest分析、索引优化与SQL重写](/categories/Databases/slow-query-governance/) — 慢查询排查与优化全流程
- [数据库索引优化实战：覆盖索引、联合索引与索引下推](/categories/Databases/index-optimization-explain/) — 索引设计原理与优化策略
- [MySQL索引优化实战：EXPLAIN分析、覆盖索引、最左前缀原则](/categories/Databases/index-deep-dive-explain/) — EXPLAIN深入解读与索引优化案例
- [MySQL事务深入解析：ACID、MVCC与并发控制](/categories/Databases/transaction/) — 理解事务对查询性能的影响
