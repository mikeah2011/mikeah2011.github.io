---
title: MySQL 面试题速查
tags: [MySQL, 面试, 索引, 事务, 锁, 性能优化]
keywords: [MySQL, 面试题速查, 数据库]
categories:
  - database
date: 2021-03-20 15:05:07
description: MySQL 高频面试题速答：索引（B+ 树、聚簇/二级、覆盖、最左前缀、失效）、事务（ACID、隔离级别、MVCC）、锁（行锁/间隙锁/意向锁、死锁）、存储引擎、SQL 优化、主从复制、MySQL 8.0+新特性（CTE、窗口函数）、性能调优、分区分表、高级复制拓扑。一题一行，配跳转链接，助你高效备战技术面试。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-014-content-1.jpg
  - /images/content/databases-014-content-2.jpg


---

> 本文是浓缩版速答。**每题尽量一句话讲清结论**；详细原理点对应链接。

![MySQL 面试知识点总览](/images/content/databases-014-content-1.jpg)

# 一、索引

**Q: 为什么 MySQL 用 B+ 树而不是 B 树/红黑树/Hash？**
B+ 树非叶节点不存数据 → 一个节点能装更多 key → 树更矮 → 磁盘 IO 少；叶子节点链表 → 范围查询快。Hash 不支持范围、不支持排序。

**Q: 聚簇索引 vs 二级索引？**
- 聚簇索引：叶子节点存整行数据，InnoDB 主键即聚簇索引
- 二级索引：叶子节点存主键值，需要"回表"

**Q: 什么是覆盖索引？** → [详细](/2019/05/15/MySQL/索引/覆盖索引/)
SELECT 的字段全在二级索引里，不用回表。EXPLAIN 显示 `Using index`。

**Q: 最左前缀原则？**
联合索引 `(a, b, c)` 只能命中 `a` / `a+b` / `a+b+c`，不能 `b` 或 `b+c`。

**Q: 索引为什么会失效？** → [12 种原因](/2019/05/20/MySQL/索引/失效原因/)
函数运算、隐式转换、`%xxx`、OR 含非索引列、违反最左前缀、负向查询...

**Q: 什么时候不该建索引？** → [优缺点](/2019/05/10/MySQL/索引/优缺点/)
小表、低选择性字段、写多读少、字段经常更新。

# 二、事务与隔离级别

**Q: ACID 是什么？**
- A 原子性：要么全做，要么全不做（undo log）
- C 一致性：业务规则不被破坏（前 3 项的结果）
- I 隔离性：并发事务相互不感知（锁 + MVCC）
- D 持久性：提交后不丢（redo log）

**Q: 4 种隔离级别？**

| 级别 | 脏读 | 不可重复读 | 幻读 |
|---|---|---|---|
| READ UNCOMMITTED | ✗ | ✗ | ✗ |
| READ COMMITTED   | ✓ | ✗ | ✗ |
| **REPEATABLE READ**（InnoDB 默认） | ✓ | ✓ | ✓（间隙锁） |
| SERIALIZABLE     | ✓ | ✓ | ✓ |

**Q: MVCC 是什么？**
多版本并发控制。每行有 `trx_id` 和 `roll_ptr`，读时按 ReadView 找对自己可见的版本。**实现 RC/RR 两种隔离级别下的非阻塞读**。

**Q: 当前读 vs 快照读？**
- 快照读：普通 `SELECT`，走 MVCC 历史版本
- 当前读：`SELECT ... FOR UPDATE` / `LOCK IN SHARE MODE` / 所有写操作，加锁读最新

# 三、锁

**Q: InnoDB 锁类型？**

| 锁 | 说明 |
|---|---|
| 共享锁 S / 排他锁 X | 读锁 / 写锁 |
| **行锁** | 锁单行 |
| **间隙锁 (Gap Lock)** | 锁两行之间的"缝"，防幻读 |
| **临键锁 (Next-Key)** | 行锁 + 间隙锁，RR 隔离级别默认加它 |
| **意向锁 IS/IX** | 表级，标记"我打算在某行加 S/X 锁" |

**Q: 死锁怎么排查？**
```sql
SHOW ENGINE INNODB STATUS;   -- 看 LATEST DETECTED DEADLOCK
SELECT * FROM performance_schema.data_locks;
```

**死锁排查完整步骤：**
```sql
-- Step 1：查看最近一次死锁详情
SHOW ENGINE INNODB STATUS\G
-- 重点关注以下段落：
-- * LATEST DETECTED DEADLOCK：
--   - TRANSACTION 1 & 2 分别持有/等待哪些锁
--   - WAITING FOR THIS LOCK TO BE GRANTED（等待锁）
--   - HOLDS THE LOCK(S)（已持有锁）
--   - 我们选择回滚的事务（victim）

-- Step 2：查看当前所有锁
SELECT
  r.trx_id AS waiting_trx,
  r.trx_mysql_thread_id AS waiting_thread,
  b.trx_id AS blocking_trx,
  b.trx_mysql_thread_id AS blocking_thread,
  r.trx_query AS waiting_query,
  b.trx_query AS blocking_query
FROM performance_schema.data_lock_waits w
JOIN information_schema.innodb_trx r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
JOIN information_schema.innodb_trx b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID;

-- Step 3：查看当前运行的事务
SELECT trx_id, trx_state, trx_started, trx_mysql_thread_id, trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;

-- Step 4：查看 InnoDB 全局状态中的死锁计数
SHOW STATUS LIKE 'Innodb_deadlocks';
```

**SHOW ENGINE INNODB STATUS 关键字段解读：**
| 段落 | 含义 |
|---|---|
| `LATEST DETECTED DEADLOCK` | 最近一次死锁详情 |
| `TRANSACTION 1/2` | 涉及的两个事务 |
| `WAITING FOR THIS LOCK` | 事务正在等待的锁 |
| `HOLDS THE LOCK(S)` | 事务已持有的锁 |
| `WE ROLL BACK TRANSACTION (n)` | 被回滚的事务编号 |
| `index idx_xxx` | 涉及的索引（可判断是否缺索引导致锁表） |

**Q: 死锁怎么避免？**
- 多个事务以**相同顺序**访问表/行
- 事务保持**短小**
- 用**低隔离级别**（RC 不加间隙锁）
- 给热点资源建索引（避免锁升级到表锁）

# 四、SQL 优化

**Q: EXPLAIN 重点看哪几列？**
- `type`：访问类型，从好到差 `system > const > eq_ref > ref > range > index > ALL`
- `key`：实际用到的索引
- `rows`：预估扫描行数
- `Extra`：`Using index`（覆盖）/ `Using filesort`（额外排序，差）/ `Using temporary`（临时表，差）

**Q: 慢 SQL 怎么排查？**
1. 开慢查询日志 `slow_query_log = 1`
2. 用 `mysqldumpslow` / `pt-query-digest` 聚合
3. 单条 `EXPLAIN` / `EXPLAIN ANALYZE`
4. `SHOW PROFILE` 看每阶段耗时

**Q: LIMIT 100000, 20 怎么优化？**
延迟关联：先用覆盖索引拿 20 个 id，再 join 主表。详见 [覆盖索引](/2019/05/15/MySQL/索引/覆盖索引/)。

**Q: COUNT(*) vs COUNT(1) vs COUNT(列)？**
- `COUNT(*)` / `COUNT(1)` 等价，统计行数（含 NULL）
- `COUNT(列)` 不统计 NULL
- InnoDB 都需要扫描，没有 MyISAM 那种缓存

# 五、存储引擎

**Q: MyISAM vs InnoDB？**

| 维度 | MyISAM | InnoDB |
|---|---|---|
| 事务 | ✗ | ✓ |
| 行锁 | ✗（表锁） | ✓ |
| 外键 | ✗ | ✓ |
| 崩溃恢复 | 弱 | 强（redo log） |
| COUNT(*) | 缓存，O(1) | 需扫描 |
| 全文索引 | ✓ | 5.6+ ✓ |

**结论**：除非纯只读统计场景，**永远用 InnoDB**。

![存储引擎与性能优化](/images/content/databases-014-content-2.jpg)

# 六、主从复制 & 高可用

**Q: 主从复制原理？**
1. 主库写入 binlog
2. 从库 IO 线程拉取 binlog → 写 relay log
3. 从库 SQL 线程回放 relay log

**Q: 主从延迟怎么解决？**
- 大事务拆小
- 从库开**并行复制** (`slave_parallel_workers`)
- 关键读走主库（"读己写"场景）
- 上 ProxySQL / 中间件路由

**Q: binlog 三种格式？**
- `STATEMENT`：记 SQL，体积小但函数/触发器主从结果可能不一致
- `ROW`：记每行变化，**安全推荐**，体积大
- `MIXED`：自动二选一

# 七、MySQL 8.0+ 新特性

**Q: 什么是 CTE（公用表表达式）？** → [窗口函数实战](/databases/mysql-guide-row-number-rank-dense-rank/)
`WITH cte_name AS (SELECT ...) SELECT ... FROM cte_name`，将子查询提取为命名临时结果集，可自引用实现递归（组织架构树、路径展开）。MySQL 8.0 起支持。

**Q: MySQL 8.0 窗口函数有哪些？** → [详细](/databases/mysql-guide-row-number-rank-dense-rank/)
`ROW_NUMBER()`、`RANK()`、`DENSE_RANK()`、`LAG()`/`LEAD()`、`SUM() OVER()` 等。在不合并行的前提下做分组聚合/排名，替代子查询 Top-N 写法，可读性和性能均更优。

**窗口函数实战示例：**
```sql
-- 建表 & 数据
CREATE TABLE sales (
  id INT PRIMARY KEY AUTO_INCREMENT,
  dept VARCHAR(20),
  emp VARCHAR(20),
  amount DECIMAL(10,2)
);
INSERT INTO sales(dept,emp,amount) VALUES
('技术','张三',8000),('技术','李四',12000),('技术','王五',9000),
('市场','赵六',15000),('市场','钱七',11000);

-- ROW_NUMBER：每部门内按金额排名（不并列）
SELECT dept, emp, amount,
  ROW_NUMBER() OVER (PARTITION BY dept ORDER BY amount DESC) AS rn
FROM sales;

-- RANK：有并列时跳号（1,1,3）
SELECT dept, emp, amount,
  RANK() OVER (ORDER BY amount DESC) AS rnk
FROM sales;

-- DENSE_RANK：有并列不跳号（1,1,2）
SELECT dept, emp, amount,
  DENSE_RANK() OVER (ORDER BY amount DESC) AS drnk
FROM sales;

-- 累计求和 & 环比
SELECT dept, emp, amount,
  SUM(amount) OVER (PARTITION BY dept ORDER BY amount) AS running_sum,
  LAG(amount, 1, 0) OVER (PARTITION BY dept ORDER BY amount) AS prev_amount,
  amount - LAG(amount, 1, 0) OVER (PARTITION BY dept ORDER BY amount) AS diff
FROM sales;
```

| 函数 | 并列处理 | 典型用途 |
|---|---|---|
| `ROW_NUMBER()` | 不并列，严格递增 | Top-N 分页取每组前 N 条 |
| `RANK()` | 并列跳号 | 排名展示（允许并列） |
| `DENSE_RANK()` | 并列不跳号 | 连续排名 |
| `LAG()/LEAD()` | — | 环比、同比计算 |
| `SUM() OVER()` | — | 累计求和、移动平均 |

**Q: MySQL 8.0 JSON 类型怎么用？** → 详见 MySQL 官方文档
MySQL 5.7+ 支持 `JSON` 类型，8.0 增强了多值索引和 `JSON_TABLE()`。

```sql
-- 建表：JSON 字段存储用户配置
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50),
  profile JSON
);
INSERT INTO users(name, profile) VALUES
('张三', '{"age":28,"tags":["java","mysql"],"city":"北京"}'),
('李四', '{"age":35,"tags":["python","go"],"city":"上海"}'),
('王五', '{"age":22,"tags":["mysql","redis"],"city":"北京"}');

-- 1. 提取 JSON 字段
SELECT name,
  JSON_EXTRACT(profile, '$.age') AS age,
  profile->>'$.city' AS city       -- ->> 等价于 JSON_UNQUOTE(JSON_EXTRACT())
FROM users;

-- 2. 虚拟列 + 索引（推荐！比直接 JSON 列建索引更高效）
ALTER TABLE users ADD COLUMN city VARCHAR(20)
  AS (profile->>'$.city') VIRTUAL;
ALTER TABLE users ADD INDEX idx_city (city);
SELECT * FROM users WHERE city = '北京';  -- 走 idx_city 索引

-- 3. JSON_TABLE：将 JSON 数组展开为行
SELECT u.name, jt.tag
FROM users u,
  JSON_TABLE(u.profile, '$.tags[*]' COLUMNS(tag VARCHAR(20) PATH '$')) AS jt
WHERE jt.tag = 'mysql';

-- 4. 8.0 多值索引（直接对 JSON 数组建索引）
ALTER TABLE users ADD INDEX idx_tags (
  (CAST(profile->'$.tags' AS CHAR(20) ARRAY))
);
SELECT * FROM users WHERE 'mysql' MEMBER OF (profile->'$.tags');
```

**JSON 使用场景：**
| 场景 | 说明 |
|---|---|
| 灵活配置/属性 | 用户偏好、商品扩展属性，避免频繁 ALTER TABLE |
| 日志/事件 | 半结构化数据，字段不固定 |
| 缓存层替代 | 小型 JSON 直接存 MySQL，省去 Redis |

> ⚠️ **注意**：JSON 列不能直接建 B-Tree 索引，需借助**虚拟列**或**多值索引**。高频查询字段建议提取为独立列。

**Q: MySQL 8.0 JSON 函数？**
引入 `JSON_TABLE()`（JSON → 行）、`JSON_ARRAYAGG()`、`JSON_OBJECTAGG()`、多值索引（`CAST(col->'$.tag' AS UNSIGNED ARRAY)`）。JSON 列上可建虚拟列 + 索引实现部分字段快速查询。

**Q: MySQL 8.0 还有哪些重要变化？**
- **窗口函数** & **CTE**（见上）
- **不可见索引**（`ALTER TABLE t ALTER INDEX idx INVISIBLE`）：安全测试删索引影响
- **直方图统计**（`ANALYZE TABLE t UPDATE HISTOGRAM`）：帮助优化器选更准的执行计划
- **utf8mb4 为默认字符集**，支持完整 emoji
- **角色（Role）**：权限批量管理
- **临时表空间不再.ibtmp1 而改为 session 独立文件**
- **Redo Log / Undo Log 可动态调整大小**（`ALTER INSTANCE`）

# 八、性能调优

**Q: 慢查询日志怎么配置和分析？** → [SQL 优化](/databases/sql-optimization/)
```ini
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1          # 超过 1 秒记录
log_queries_not_using_indexes = 1
```
用 `pt-query-digest /var/log/mysql/slow.log` 聚合：输出按响应时间排序、展示每条 SQL 的执行次数、平均耗时、锁等待时间，直接定位"最该优化的那一条"。

**Q: EXPLAIN ANALYZE 和 EXPLAIN 有什么区别？** → [EXPLAIN 详解](/databases/explain/)
`EXPLAIN` 只输出预估执行计划；`EXPLAIN ANALYZE`（8.0.18+）**实际执行** SQL 后输出真实行数、耗时、循环次数。生产环境慎用——它会真正跑 SQL。

**Q: InnoDB Buffer Pool 如何调优？**
设为物理内存的 **50%-75%**（`innodb_buffer_pool_size`）。观察 `SHOW ENGINE INNODB STATUS` 中 `Buffer pool hit rate`，低于 99% 说明热点数据未被缓存。多实例 `innodb_buffer_pool_instances` 减少锁争用。

**Q: 连接池参数怎么调？**
`max_connections` 根据并发 QPS 设（通常 200-500），配合 ProxySQL / HikariCP 等中间件做连接复用。`wait_timeout` 建议 300-600s，避免空连接占资源。

**Q: 什么是索引下推（ICP）？**
Index Condition Pushdown，MySQL 5.6+ 特性。将原本在 Server 层做的 `WHERE` 过滤条件下推到存储引擎层，**在索引扫描阶段就提前过滤**，减少回表次数。EXPLAIN 中 `Extra` 显示 `Using index condition`。

**Q: Online DDL 怎么做不锁表？** → [锁机制详解](/databases/locking/)
`ALTER TABLE t ADD COLUMN c INT, ALGORITHM=INPLACE, LOCK=NONE;`。InnoDB 支持大部分 DDL 在线执行（加列、加索引、改默认值），过程中表仍可读写。MySQL 8.0 进一步支持**瞬间加列**（Instant DDL），只需修改元数据。

**Q: 大表 DDL 如何降低影响？**
使用 `pt-online-schema-change` 或 `gh-ost` 工具：创建影子表 → 触发器/ binlog 同步增量数据 → 原子 rename。全程不锁原表，适合亿级大表。

# 九、高级复制拓扑

**Q: 什么是 GTID 复制？** → [主从复制详解](/databases/replication/)
全局事务标识符（`server_uuid:transaction_id`），从库自动定位 binlog 位置，无需手动指定 `MASTER_LOG_FILE/POS`。切换主从更简单，`CHANGE MASTER TO ... MASTER_AUTO_POSITION=1`。

**Q: 半同步复制（Semi-Sync）？**
主库提交事务后，**至少等一个从库确认收到 relay log** 才返回客户端。保证"至少有一个从库不丢数据"，但延迟增加。MySQL 8.0 增强为 **无损半同步**（`rpl_semi_sync_master_wait_point=AFTER_SYNC`），避免幻读问题。

**Q: Group Replication（MGR）？**
基于 Paxos 协议的**多主复制**方案。所有节点可读写，通过冲突检测（certification）保证一致性。适用于高可用、多地写入场景。需 `group_replication_group_seeds` 配置成员列表，单主模式最常用。

# 十、分区表

**Q: MySQL 分区（Partition）有什么用？**
将一张逻辑表拆成多个物理分区，查询时**分区裁剪**（Partition Pruning）只扫描相关分区，减少 IO。适合**时序数据**按月/年分区。

**Q: 分区类型有哪些？**
| 类型 | 适用场景 | 示例 |
|---|---|---|
| RANGE | 连续范围 | 按 `create_time` 按月分区 |
| LIST | 离散值枚举 | 按地区 ID 分区 |
| HASH | 均匀分布 | `PARTITION BY HASH(user_id) PARTITIONS 8` |
| KEY | 类似 HASH，自动选择列 | `PARTITION BY KEY(id)` |

**Q: 分区有什么限制？**
- 最多 8192 个分区（实际建议 ≤ 200）
- 唯一索引**必须包含分区键**
- 外键不支持
- 分区字段必须是整数或能转为整数的表达式

# 十一、分库分表

**Q: 什么时候需要分库分表？**
单表超过 **500 万行** 或数据量超过 **10GB**，查询性能明显下降时考虑。

**Q: 垂直拆分 vs 水平拆分？**

| 维度 | 垂直拆分 | 水平拆分 |
|---|---|---|
| 方向 | 按**列**拆（大表拆成多小表） | 按**行**拆（同表结构分散到多表） |
| 适用场景 | 字段多、大字段冷热分离 | 单表数据量过大 |
| 优点 | 降低单行宽度，IO 减少 | 单表数据量可控 |
| 缺点 | 查询需 JOIN 多表 | 跨分片查询复杂，全局 ID 需额外方案 |

```sql
-- 垂直拆分示例：将大字段拆到扩展表
-- 原表
CREATE TABLE user_profile (
  user_id INT PRIMARY KEY,
  name VARCHAR(50),
  avatar TEXT,
  bio TEXT
);

-- 拆分后
CREATE TABLE user_base (user_id INT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE user_ext (user_id INT PRIMARY KEY, avatar TEXT, bio TEXT);
```

**Q: 水平分片的路由策略？**
| 策略 | 说明 | 示例 |
|---|---|---|
| Hash 取模 | `user_id % N` 分到 N 张表 | 简单均匀，扩容难 |
| Range 范围 | 按 ID 范围分（1-100万、100-200万） | 扩容简单，热点集中 |
| 一致性 Hash | Hash 环 + 虚拟节点 | 扩容只迁移相邻节点 |

```sql
-- Hash 分片示例（应用层路由，非 MySQL 原生）
-- user_id = 12345 → 12345 % 4 = 1 → 路由到 t_order_1
SELECT * FROM t_order_1 WHERE user_id = 12345;
-- user_id = 67890 → 67890 % 4 = 2 → 路由到 t_order_2
SELECT * FROM t_order_2 WHERE user_id = 67890;
```

**Q: ShardingSphere 怎么用？**
Apache ShardingSphere 是最主流的分库分表中间件，支持 ShardingSphere-JDBC（Java 端嵌入）和 ShardingSphere-Proxy（独立代理）两种模式。

```yaml
# ShardingSphere-JDBC 配置示例（YAML）
dataSources:
  ds_0:
    url: jdbc:mysql://localhost:3306/ds_0
  ds_1:
    url: jdbc:mysql://localhost:3306/ds_1

rules:
  - !SHARDING
    tables:
      t_order:
        actualDataNodes: ds_${0..1}.t_order_${0..3}
        tableStrategy:
          standard:
            shardingColumn: order_id
            shardingAlgorithmName: t_order_inline
    shardingAlgorithms:
      t_order_inline:
        type: INLINE
        props:
          algorithm-expression: t_order_${order_id % 4}
```

**Q: 分库分表的坑？**
- **全局 ID 生成**：Snowflake / UUID / 号段模式
- **跨分片 JOIN**：应用层聚合或冗余字段
- **分布式事务**：Seata（AT/TCC/SAGA）或最终一致性
- **扩容迁移**：提前规划分片数（建议 2 的幂次），或用一致性 Hash

# 十二、MySQL 与 PostgreSQL 对比

| 维度 | MySQL | PostgreSQL |
|---|---|---|
| 架构 | 单进程多线程 | 多进程模型 |
| MVCC 实现 | undo log + ReadView | 多版本元组（tuple）+ vacuum |
| 扩展性 | 主从复制 + ShardingSphere | 逻辑复制 + 原生分区 + Citus 扩展 |
| JSON 支持 | JSON 类型 + 虚拟列索引 | JSONB（二进制，支持 GIN 索引） |
| 全文搜索 | 有限（ngram） | 内建 tsvector/tsquery，功能强 |
| 窗口函数 | 8.0+ 支持 | 长期支持，功能更全 |
| 并发控制 | 行锁 + 间隙锁 + 意向锁 | 行锁 + 行级 MVCC，无间隙锁 |
| 可扩展函数 | 存储过程（SQL） | PL/pgSQL, PL/Python, PL/V8 等多语言 |
| 事务隔离默认 | REPEATABLE READ | READ COMMITTED |
| 许可证 | GPL | PostgreSQL License（更宽松） |
| 适用场景 | Web 高并发读写、简单 OLTP | 复杂查询、GIS、JSON/全文搜索、混合负载 |

> **选型建议**：Web 应用、高并发读写、生态成熟 → MySQL；复杂分析、JSON/GIS、需要灵活扩展 → PostgreSQL。

# 十三、其它高频

**Q: redo log 和 binlog 区别？**
- redo log：InnoDB 引擎层，物理日志（"在某页改某字节"），循环写
- binlog：Server 层，逻辑日志，追加写，用于复制和恢复

**Q: 一条 SQL 的执行流程？**
连接器 → 查询缓存（8.0 移除）→ 分析器（词法/语法）→ 优化器（选索引、决定 join 顺序）→ 执行器 → 存储引擎

**Q: 表设计三范式？**
1NF：字段不可再分；2NF：非主键完全依赖主键；3NF：非主键不传递依赖。**实际开发常反范式（冗余字段）换性能**。

# 面试速记表

> 一张表速览全部知识点，适合面试前 5 分钟快速过一遍。

| 知识点 | 一句话答案 |
|---|---|
| B+ 树索引 | 非叶节点不存数据 → 树矮 IO 少，叶子链表 → 范围查询快 |
| 聚簇索引 | 叶子存整行数据，InnoDB 主键即聚簇索引 |
| 覆盖索引 | 查询列全在索引中，无需回表，EXPLAIN 显示 Using index |
| 最左前缀 | 联合索引 (a,b,c) 只能从最左列开始匹配 |
| 索引失效 | 函数运算、隐式转换、%前缀、OR 非索引列、负向查询 |
| ACID | 原子性(undo log)、一致性、隔离性(锁+MVCC)、持久性(redo log) |
| 隔离级别 | RU/RC/RR/SER，InnoDB 默认 RR，用间隙锁防幻读 |
| MVCC | 每行 trx_id+roll_ptr，读时按 ReadView 找可见版本 |
| 行锁/间隙锁 | 行锁锁单行，间隙锁防幻读，Next-Key = 行锁+间隙锁 |
| 死锁排查 | SHOW ENGINE INNODB STATUS 看 LATEST DEADLOCK |
| EXPLAIN | type: const>eq_ref>ref>range>index>ALL，Extra 看 Using index/filesort |
| 慢 SQL | 开 slow_query_log → pt-query-digest 聚合 → EXPLAIN 单条分析 |
| LIMIT 优化 | 延迟关联：先覆盖索引拿 id 再 join 主表 |
| MyISAM vs InnoDB | 无事务/表锁 vs 有事务/行锁/崩溃恢复，永远用 InnoDB |
| 主从复制 | 主库 binlog → 从库 IO 拉 relay log → SQL 线程回放 |
| binlog 格式 | STATEMENT(记SQL)/ROW(记行变化,推荐)/MIXED(自动) |
| Buffer Pool | 设物理内存 50%-75%，hit rate 低于 99% 需调优 |
| 窗口函数 | ROW_NUMBER(不并列)、RANK(跳号)、DENSE_RANK(不跳号) |
| JSON 类型 | 虚拟列+索引查 JSON 字段，多值索引直接索引数组 |
| 分库分表 | 垂直拆列/水平拆行，用 ShardingSphere 或一致性 Hash |
| MySQL vs PG | MySQL: 高并发读写；PG: 复杂查询/GIS/JSONB |
| 索引下推 | ICP 将 WHERE 下推到引擎层，减少回表 |
| Online DDL | ALGORITHM=INPLACE, LOCK=NONE，8.0 支持 Instant DDL |
| GTID | 全局事务 ID，从库自动定位 binlog，切换主从更简单 |

# 配图

![索引执行流程](/images/643.png)

![索引常见面试问题脑图](/images/索引面试问题.png)

# 进一步阅读

- [MySQL 数据类型选型](/2019/04/20/MySQL/数据类型/)
- [覆盖索引](/2019/05/15/MySQL/索引/覆盖索引/)
- [索引优缺点](/2019/05/10/MySQL/索引/优缺点/)
- [索引失效 12 种原因](/2019/05/20/MySQL/索引/失效原因/)
- 《高性能 MySQL》第 3、4、5、6 章

# 相关阅读

- [MySQL事务 — ACID、隔离级别与MVCC详解](/databases/transaction/)
- [MySQL锁机制 — 行锁、间隙锁与死锁排查](/databases/locking/)
- [MySQL主从复制与读写分离](/databases/replication/)
- [MySQL窗口函数实战 — ROW_NUMBER、RANK、DENSE_RANK](/databases/mysql-guide-row-number-rank-dense-rank/)
- [SQL语句性能分析工具 — EXPLAIN详解](/databases/explain/)
- [MySQL优化经验总结](/databases/sql-optimization/)
- [分库分表](/databases/sharding/)
- [PostgreSQL vs MySQL 选型实战](/databases/postgresql-vs-mysql-guide-kkday-affiliate-postgresql/)
- [MySQL慢查询治理实战](/databases/slow-query-governance/)
- [MySQL CTE 递归查询实战](/databases/mysql-cte-queryguide/)
