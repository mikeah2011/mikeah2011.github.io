---
title: MySQL Invisible Index 实战：线上索引安全验证——对比 EXPLAIN 与实际执行计划的索引生效分析
date: 2026-06-06 10:00:00
tags: [MySQL, 索引优化, EXPLAIN, 性能调优, 数据库]
keywords: [MySQL Invisible Index, EXPLAIN, 线上索引安全验证, 与实际执行计划的索引生效分析, 数据库]
description: "MySQL 8.0 Invisible Index（不可见索引）线上实战指南：通过 ALTER INDEX INVISIBLE 安全验证冗余索引，对比 EXPLAIN 静态执行计划与 EXPLAIN ANALYZE 实际执行计划的索引生效差异，详解三步走索引安全删除流程，涵盖 B2C 电商联合索引验证案例、Performance Schema 慢查询监控、pt-online-schema-change 配合删除，附完整踩坑记录与最佳实践 Checklist。"
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---


## 前言

在日常的数据库运维与优化工作中，索引管理始终是一个让人既爱又恨的话题。索引太少，查询慢得让人抓狂；索引太多，写入性能下降、存储空间膨胀、维护成本飙升。更棘手的是，随着业务迭代和查询模式的变化，总有一些索引逐渐变得"食之无味、弃之可惜"——它们可能在过去某个版本中被频繁使用，但随着业务逻辑的调整，已经不再被任何关键查询所依赖。

问题在于，谁都不敢轻易删除这些索引。数据库中的查询种类繁多，业务场景复杂，你很难百分之百确定某个索引是否还有人在用。贸然删除一个索引，如果恰好有一个低频但至关重要的后台报表查询依赖它，那么查询退化为全表扫描，轻则响应时间暴增数十倍，重则拖垮整个数据库实例，引发连锁反应。

在 MySQL 8.0 之前，DBA 面对这种困境通常只能小心翼翼地在测试环境模拟，或者干脆"多一事不如少一事"地把所有索引都保留着。但 MySQL 8.0 引入的 **Invisible Index（不可见索引）** 机制彻底改变了这种局面。它提供了一个优雅的"试水"方案：让索引对优化器不可见，但物理数据保持不变。如果性能没有异常，就放心删除；如果出现问题，瞬间恢复。整个过程对线上业务几乎零影响。

本文将从原理到实战，系统性地讲解 Invisible Index 的方方面面。我们会深入对比 EXPLAIN 与 EXPLAIN ANALYZE 两种执行计划分析工具在索引可见性验证中的差异与互补关系，并通过一个完整的 B2C 电商实战案例，展示一套经过生产环境验证的"三步走"索引安全删除流程。

## 一、什么是 Invisible Index：MySQL 8.0 引入的索引可见性机制

### 1.1 核心概念解析

Invisible Index，直译为"不可见索引"，是 MySQL 8.0 在索引管理层面引入的一项重要特性。它的核心思想非常简单：**将索引标记为对查询优化器不可见的状态**。

具体来说，当我们把一个索引设置为不可见后，会发生以下变化：

1. **优化器不再使用该索引**：在生成查询执行计划时，优化器会完全忽略这个索引的存在，不会将其纳入候选索引的考虑范围。这意味着所有查询都只能选择其他可见索引或全表扫描。
2. **索引的物理数据保持完整**：InnoDB 存储引擎仍然会维护该索引的 B+ 树结构。所有对表的 INSERT、UPDATE、DELETE 操作都会同步更新这个索引。换句话说，索引的维护开销依然存在。
3. **操作是即时的且无锁的**：将索引从可见切换为不可见，或从不可见切换为可见，都只需要修改数据字典中的元数据，不需要重建索引，不会阻塞表上的 DML 操作，执行时间通常在毫秒级别。

这三个特性组合在一起，使得 Invisible Index 成为一个理想的索引验证工具：它让优化器"假装"索引不存在，但随时可以撤销这个"假装"，同时索引数据一直保持最新状态。

### 1.2 解决了什么问题

在 MySQL 8.0 之前，想要验证某个索引是否可以安全删除，DBA 面临着一个两难困境：

- **直接删除索引**：这是最直接的方法，但风险极高。如果发现删除后性能下降，需要重建索引。对于大表（比如几千万甚至上亿行），重建索引可能需要几分钟甚至几小时，在此期间数据库可能承受巨大的 IO 压力，严重影响线上业务。
- **在测试环境模拟**：虽然安全，但测试环境往往无法完全复现线上环境的数据量、数据分布、并发压力和查询模式。在测试环境中看起来可以删除的索引，在线上可能完全不同。

Invisible Index 完美地解决了这个困境。它让我们可以在线上真实的生产环境中，以零风险的方式验证索引的有效性。验证过程中的任何时候，如果发现性能异常，只需一条命令就能让索引重新生效，恢复到原来的执行计划。

### 1.3 版本与功能支持

不同 MySQL 版本对本文涉及功能的支持情况如下：

| 功能特性 | 最低版本要求 | 说明 |
|---------|------------|------|
| Invisible Index | MySQL 8.0.0 | 索引可见性切换的基础功能 |
| EXPLAIN ANALYZE | MySQL 8.0.18 | 真实执行并返回实际统计信息 |
| SHOW INDEX 中的 Visible 列 | MySQL 8.0.0 | 在 SHOW INDEX 输出中展示可见性 |

如果你的 MySQL 实例版本低于 8.0，本文介绍的功能不可用。建议在条件允许时升级到 MySQL 8.0 的最新稳定版本。

## 二、Visible vs Invisible Index 的底层原理与 optimizer_switch 影响

### 2.1 数据字典中的索引可见性存储

在 InnoDB 存储引擎的数据字典中，每个索引都维护着一个 `is_visible` 属性。当索引为可见状态时，该值为 `YES`；当索引被设为不可见时，该值为 `NO`。

我们可以直接查询 InnoDB 的内部数据字典来查看这个属性：

```sql
SELECT
    NAME AS index_name,
    TYPE AS index_type,
    IS_VISIBLE
FROM information_schema.INNODB_INDEXES
WHERE TABLE_ID = (
    SELECT TABLE_ID
    FROM information_schema.INNODB_TABLES
    WHERE NAME = 'your_db/your_table'
);
```

需要注意的是，`is_visible` 的变更只涉及数据字典中的元数据更新，不涉及索引结构或数据的任何物理操作。这正是为什么这个操作可以做到毫秒级完成且无锁的原因。

### 2.2 查询优化器如何感知索引可见性

MySQL 的查询优化器在选择索引时，需要先获取表上所有可用索引的信息。这个过程发生在查询编译阶段。优化器通过存储引擎的接口获取索引列表时，InnoDB 会根据索引的 `is_visible` 属性进行过滤——不可见索引会被直接排除在候选索引列表之外。

这意味着以下几个重要推论：

首先，优化器不会为不可见索引计算任何访问代价（cost estimation）。优化器在选择最优执行计划时，会对每个候选索引进行代价估算，比较不同索引路径的 IO 代价、CPU 代价等。不可见索引完全不参与这个比较过程。

其次，不可见索引永远不会出现在 EXPLAIN 的输出中。无论查询条件多么适合使用该索引，EXPLAIN 结果中的 `key` 列都不会显示不可见索引的名称。

最后，即使使用 SQL Hint 也无法强制优化器使用不可见索引。`FORCE INDEX`、`USE INDEX` 等 Hint 语句在索引不可见时不会生效。这是一个非常重要的特性——它确保了 Invisible Index 的保护机制不会被意外绕过。

### 2.3 optimizer_switch 中的 use_invisible_indexes 开关

MySQL 提供了一个名为 `use_invisible_indexes` 的优化器开关，它位于 `optimizer_switch` 系统变量中，默认值为 `OFF`。

```sql
-- 查看当前的 optimizer_switch 设置
SELECT @@optimizer_switch;
```

在默认情况下（`use_invisible_indexes=off`），优化器会忽略所有不可见索引。但如果我们将其设为 `ON`，优化器就会把不可见索引当作普通索引来对待：

```sql
-- 仅对当前会话生效
SET SESSION optimizer_switch = 'use_invisible_indexes=on';
```

这个开关的存在主要用于调试和对比分析。比如，当你想快速对比某个查询在有无某索引时的执行计划差异，而又不想来回切换索引的可见性，就可以通过这个开关来实现。它让你可以在不改变索引可见性状态的前提下，临时让优化器"看到"不可见索引。

不过需要注意，**在生产环境中不建议长期开启此开关**。它的作用范围是会话级别，如果你的数据库连接池中某些连接开启了它而其他连接没有开启，会导致不同连接上的查询行为不一致，增加排查问题的复杂度。

## 三、如何将索引设为不可见/可见：ALTER TABLE 语法详解

### 3.1 修改已有索引的可见性

MySQL 8.0 扩展了 `ALTER TABLE` 的语法，增加了 `ALTER INDEX` 子句来支持索引可见性的切换：

```sql
-- 将索引设为不可见
ALTER TABLE orders ALTER INDEX idx_user_id INVISIBLE;

-- 将索引重新设为可见
ALTER TABLE orders ALTER INDEX idx_user_id VISIBLE;
```

这两条语句的执行都是即时的（instant），不会导致表的重建或数据的复制。在大多数情况下，执行时间在毫秒级别。

### 3.2 创建索引时指定不可见

你也可以在创建索引时就指定其初始状态为不可见：

```sql
-- 创建一个不可见索引
CREATE INDEX idx_test ON orders(created_at) INVISIBLE;
```

这种方式适用于你想先创建索引但暂不启用的场景。比如，你正在为一个即将上线的新功能预先准备好索引，但不希望它对当前的查询计划产生任何影响，直到新功能正式发布。

### 3.3 建表时指定不可见索引

在 `CREATE TABLE` 语句中同样支持：

```sql
CREATE TABLE new_feature (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    category VARCHAR(50),
    INDEX idx_user (user_id) INVISIBLE,
    INDEX idx_category (category)
);
```

### 3.4 批量修改多个索引的可见性

如果需要同时修改多个索引的可见性，可以在一条 ALTER TABLE 语句中完成：

```sql
ALTER TABLE orders
    ALTER INDEX idx_a INVISIBLE,
    ALTER INDEX idx_b INVISIBLE,
    ALTER INDEX idx_c VISIBLE;
```

这比分别执行多条 ALTER TABLE 语句更高效，因为它只需要获取一次元数据锁。

## 四、EXPLAIN 与 EXPLAIN ANALYZE 对比：分析查询计划变化

在进行索引可见性验证时，最关键的工作就是对比索引在可见和不可见两种状态下的执行计划差异。MySQL 提供了两种执行计划分析工具，它们各有特点且互为补充。

### 4.1 EXPLAIN：静态执行计划分析

`EXPLAIN` 是 MySQL 中最经典的查询分析工具。它返回的是优化器基于统计信息**预估**的执行计划，不会真正执行查询：

```sql
EXPLAIN SELECT * FROM orders
WHERE user_id = 10086 AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 20;
```

EXPLAIN 输出中的关键字段及其含义如下：

- **type**：表的访问类型。从好到差依次为 system > const > eq_ref > ref > range > index > ALL。如果从 ref 退化为 ALL，说明索引失效导致了全表扫描。
- **possible_keys**：优化器考虑过的候选索引列表。
- **key**：最终选择使用的索引名称。如果为 NULL，说明没有使用任何索引。
- **key_len**：使用的索引长度，可以帮助判断联合索引中有多少列被使用。
- **rows**：预估需要扫描的行数。这个值越小越好。
- **filtered**：经过 WHERE 条件过滤后保留的行百分比。
- **Extra**：额外信息，常见的包括 Using index（覆盖索引）、Using filesort（需要额外排序）、Using temporary（需要临时表）等。

EXPLAIN 的最大优势是**零副作用**——它只生成计划不执行查询，完全不会对生产环境造成任何影响。这使得它非常适合在线上环境频繁使用。

### 4.2 EXPLAIN ANALYZE：实际执行计划分析

MySQL 8.0.18 引入了 `EXPLAIN ANALYZE`，它会**真正执行查询**并返回实际的执行统计信息：

```sql
EXPLAIN ANALYZE SELECT * FROM orders
WHERE user_id = 10086 AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 20;
```

输出示例（简化）：

```
-> Limit: 20 row(s)  (actual time=0.523..0.526 rows=15 loops=1)
    -> Index lookup on orders using idx_user_status_time
       (user_id=10086, status='PAID')
       (actual time=0.521..0.524 rows=15 loops=1)
```

EXPLAIN ANALYZE 输出中新增的关键信息：

- **actual time**：实际执行时间（单位为毫秒），格式为"首次调用时间..最后一次调用时间"。这比 EXPLAIN 的预估代价更加直观和准确。
- **rows**（实际）：实际处理或返回的行数。与 EXPLAIN 的预估行数对比，可以发现统计信息是否准确。
- **loops**：该步骤被执行的次数。嵌套循环连接中，外层表的每一行都会导致内层表的扫描循环。

### 4.3 两者的核心差异对比

| 对比维度 | EXPLAIN | EXPLAIN ANALYZE |
|---------|---------|-----------------|
| 是否执行查询 | 否，仅生成计划 | 是，真正执行查询 |
| 数据来源 | 基于统计信息预估 | 基于实际执行结果 |
| 时间信息 | 无实际时间，仅有代价估算 | 提供真实的执行时间 |
| 行数准确性 | 预估值，可能与实际偏差较大 | 实际值，完全准确 |
| 对生产环境的影响 | 无副作用 | 有 IO 开销，涉及锁等待 |
| 适用场景 | 线上环境频繁使用 | 线上谨慎使用，建议在从库执行 |
| 版本要求 | MySQL 5.x 及以上 | MySQL 8.0.18 及以上 |

### 4.4 如何选择使用哪种工具

在索引可见性验证的场景下，推荐的使用策略是：

**验证初期使用 EXPLAIN**：先通过 EXPLAIN 快速判断索引设为不可见后，执行计划是否发生了明显变化。如果 EXPLAIN 显示 key 列从某个索引变成了 NULL 或其他索引，且 rows 显著增加，说明该索引可能很重要。

**深入分析时使用 EXPLAIN ANALYZE**：对于 EXPLAIN 显示计划变化不大的查询，需要用 EXPLAIN ANALYZE 进一步确认。有时候 EXPLAIN 的预估行数看起来差不多，但实际执行时间可能差异很大（比如因为索引排序避免了 filesort）。

**EXPLAIN FORMAT=JSON 获取详细信息**：如果需要更精细的分析，可以使用 JSON 格式输出，它包含了详细的代价计算信息和每个步骤的预估成本：

```sql
EXPLAIN FORMAT=JSON SELECT * FROM orders WHERE user_id = 10086 ORDER BY created_at DESC LIMIT 20\G
```

## 五、线上安全验证流程：先不可见→观察性能→再删除的三步走策略

经过多年的生产实践，我们总结出了一套成熟的"三步走"索引安全删除流程。这套流程的核心思想是：**用渐进式的方式降低风险，每一步都有回退方案**。

### 第一步：将目标索引设为不可见

选择业务低峰期（如凌晨或周末），将待验证的索引设为不可见：

```sql
ALTER TABLE orders ALTER INDEX idx_user_status_created INVISIBLE;
```

执行完后立即确认修改是否成功：

```sql
SELECT
    TABLE_NAME,
    INDEX_NAME,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS index_columns,
    IS_VISIBLE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'your_database'
  AND INDEX_NAME = 'idx_user_status_created'
GROUP BY TABLE_NAME, INDEX_NAME, IS_VISIBLE;
```

同时，立即对关键查询执行 EXPLAIN 并记录结果，确认执行计划确实发生了变化：

```sql
-- 记录每个关键查询的执行计划
EXPLAIN SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20;
EXPLAIN SELECT * FROM orders WHERE user_id = ? AND status = 'PAID';
-- ... 其他关键查询
```

### 第二步：全面观察线上性能表现

这是整个流程中最关键的环节。设为不可见后，需要在真实业务流量下持续观察一段时间。**建议观察周期为 24 小时至 7 天**，具体时长取决于业务的周期性特征——至少要覆盖一个完整的业务高峰周期。

**监控手段一：慢查询日志**

确保慢查询日志已开启，并关注是否出现新增的慢查询：

```sql
-- 确认慢查询日志状态
SHOW VARIABLES LIKE 'slow_query_log';
SHOW VARIABLES LIKE 'long_query_time';

-- 如果需要临时调整阈值（比如从 1 秒调整为 0.5 秒以便捕获更多可疑查询）
SET GLOBAL long_query_time = 0.5;
```

**监控手段二：Performance Schema 语句统计**

通过 Performance Schema 可以精确地分析每个查询的性能变化：

```sql
SELECT
    DIGEST_TEXT,
    COUNT_STAR AS exec_count,
    ROUND(AVG_TIMER_WAIT / 1000000000, 2) AS avg_time_ms,
    ROUND(MAX_TIMER_WAIT / 1000000000, 2) AS max_time_ms,
    SUM_ROWS_EXAMINED,
    SUM_ROWS_SENT,
    ROUND(SUM_ROWS_EXAMINED / NULLIF(SUM_ROWS_SENT, 0), 2) AS examine_send_ratio
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = 'your_database'
ORDER BY AVG_TIMER_WAIT DESC
LIMIT 20;
```

`examine_send_ratio`（扫描行数与返回行数的比值）是一个非常有价值的指标。如果这个比值在索引不可见后显著增大，说明查询效率在下降。

**监控手段三：EXPLAIN ANALYZE 对比**

对受影响的关键查询，使用 EXPLAIN ANALYZE 进行实际执行并对比：

```sql
-- 在从库或只读副本上执行，避免影响主库
EXPLAIN ANALYZE SELECT * FROM orders
WHERE user_id = 10086 ORDER BY created_at DESC LIMIT 20;
```

记录返回的 actual time 和 rows 数据，与索引可见时的基线数据进行对比。

**监控手段四：业务指标监控**

除了数据库层面的监控，还需要关注业务层面的指标：

- API 接口的 P50/P95/P99 响应时间是否出现异常
- 是否有用户反馈页面加载缓慢
- 数据库的 CPU 使用率、IO 使用率是否出现异常波动
- 慢查询数量的实时趋势图

### 第三步：确认安全后删除索引

如果经过充分观察，确认性能没有退化，就可以进入最后一步——真正删除索引：

```sql
-- 小表可以直接删除
ALTER TABLE orders DROP INDEX idx_user_status_created;

-- 大表建议使用在线 DDL 工具
-- pt-online-schema-change 或 gh-ost（详见第七节）
```

如果在观察期间发现性能确实出现了退化，立即恢复索引可见性：

```sql
ALTER TABLE orders ALTER INDEX idx_user_status_created VISIBLE;
```

恢复操作同样是即时的，通常在毫秒内完成，优化器会立刻重新使用该索引。

### 完整流程决策图

整个三步走策略可以用以下流程来概括：首先在业务低峰期将目标索引设为不可见状态，然后开始全面监控，包括慢查询日志、Performance Schema 语句统计、EXPLAIN ANALYZE 对比分析以及业务指标监控。经过一个完整的观察周期（建议至少 24 小时，理想情况下 3 到 7 天）后，如果各项指标均无异常，就可以使用在线 DDL 工具安全地删除该索引。如果发现任何性能退化的迹象，只需一条 ALTER INDEX ... VISIBLE 命令即可立即回退。

## 六、实战案例：B2C 电商场景下验证联合索引是否可安全删除

### 6.1 业务背景

某 B2C 电商平台的核心订单表 `orders`，数据量约 5000 万行，日均新增订单约 50 万。表结构如下：

```sql
CREATE TABLE orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    status ENUM('CREATED','PAID','SHIPPED','COMPLETED','CANCELLED')
        NOT NULL DEFAULT 'CREATED',
    total_amount DECIMAL(10,2) NOT NULL,
    payment_time DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    remark TEXT,
    PRIMARY KEY (id),
    UNIQUE KEY uk_order_no (order_no),
    INDEX idx_user_id (user_id),
    INDEX idx_user_status_created (user_id, status, created_at),
    INDEX idx_created_at (created_at),
    INDEX idx_payment_time (payment_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

DBA 团队在审查索引使用情况时，怀疑 `idx_user_status_created`（联合索引 user_id + status + created_at）可能是冗余的——因为表上已经存在单独的 `idx_user_id` 索引。如果大部分查询只用到 user_id 这一个条件，那么联合索引的价值可能有限。但考虑到它包含 status 和 created_at 列，在某些场景下可能提供额外的排序和过滤能力。于是决定使用 Invisible Index 进行线上验证。

### 6.2 第一步：梳理依赖该索引的所有查询

通过 Performance Schema 提取涉及相关列的高频查询：

```sql
SELECT
    DIGEST_TEXT,
    COUNT_STAR AS exec_count,
    ROUND(AVG_TIMER_WAIT / 1000000000, 2) AS avg_ms,
    SUM_ROWS_EXAMINED,
    SUM_ROWS_SENT
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = 'ecommerce'
  AND (DIGEST_TEXT LIKE '%user_id%'
       OR DIGEST_TEXT LIKE '%status%'
       OR DIGEST_TEXT LIKE '%created_at%')
ORDER BY COUNT_STAR DESC
LIMIT 20;
```

分析结果发现以下三类主要查询：

**查询 A（高频，每秒约 200 次）**——用户订单列表页，按创建时间倒序分页展示：

```sql
SELECT * FROM orders
WHERE user_id = ?
ORDER BY created_at DESC
LIMIT 20;
```

**查询 B（中频，每秒约 50 次）**——用户在订单列表中按状态筛选：

```sql
SELECT * FROM orders
WHERE user_id = ? AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 50;
```

**查询 C（低频，每秒约 5 次）**——后台统计用户的订单状态分布：

```sql
SELECT status, COUNT(*)
FROM orders
WHERE user_id = ?
GROUP BY status;
```

### 6.3 第二步：对比索引可见与不可见时的执行计划

**索引可见时的 EXPLAIN 结果**：

对查询 A 执行 EXPLAIN，结果显示优化器选择了 `idx_user_status_created` 联合索引。type 为 ref，Extra 显示 `Backward index scan`，说明优化器利用了联合索引中 created_at 列的有序性，通过反向扫描索引来满足 ORDER BY ... DESC 的排序需求，无需额外的 filesort 操作。预估扫描行数为 156 行。

对查询 B 执行 EXPLAIN，结果显示优化器同样选择了 `idx_user_status_created`，type 为 ref，Extra 显示 `Using where`，说明联合索引的前两列（user_id, status）被用于精确的等值查找，然后通过索引的第三列 created_at 的有序性完成排序。

**将索引设为不可见后的 EXPLAIN 结果**：

执行 `ALTER TABLE orders ALTER INDEX idx_user_status_created INVISIBLE` 后重新分析。

对查询 A，优化器退而选择了 `idx_user_id` 索引。type 仍为 ref，但 Extra 中出现了 `Using filesort`——这意味着数据库在通过 user_id 找到所有该用户的订单后，需要对结果集进行额外的排序操作。预估扫描行数仍然是 156 行（因为 user_id 的选择性相同），但多了一次排序的开销。

对查询 B，情况类似，优化器使用 `idx_user_id` 索引后通过 WHERE 条件过滤 status，然后需要 filesort 完成排序。

### 6.4 第三步：使用 EXPLAIN ANALYZE 量化实际性能差异

EXPLAIN 的预估只能告诉我们执行计划发生了变化，但无法精确衡量性能影响。我们需要用 EXPLAIN ANALYZE 获取实际执行数据。

**查询 A 的实际执行对比**：

```sql
-- 索引可见时
EXPLAIN ANALYZE SELECT * FROM orders
WHERE user_id = 10086 ORDER BY created_at DESC LIMIT 20;
-- 结果摘要: actual time=0.45..0.48 rows=20

-- 索引不可见时
EXPLAIN ANALYZE SELECT * FROM orders
WHERE user_id = 10086 ORDER BY created_at DESC LIMIT 20;
-- 结果摘要: actual time=8.2..15.6 rows=20
```

查询 A 在索引不可见后，实际执行时间从约 0.48 毫秒增加到约 15.6 毫秒，增幅约 32 倍。虽然 15 毫秒看起来并不算慢，但考虑到这是一个每秒执行 200 次的高频查询，累计影响非常可观。更关键的是，在数据量较大的用户（比如下单超过 1000 次的活跃用户）身上，filesort 的开销会更加显著。

**查询 B 的实际执行对比**：

```sql
-- 索引可见时
EXPLAIN ANALYZE SELECT * FROM orders
WHERE user_id = 10086 AND status = 'PAID' ORDER BY created_at DESC LIMIT 50;
-- 结果摘要: actual time=0.32..0.35 rows=8

-- 索引不可见时
EXPLAIN ANALYZE SELECT * FROM orders
WHERE user_id = 10086 AND status = 'PAID' ORDER BY created_at DESC LIMIT 50;
-- 结果摘要: actual time=6.8..12.4 rows=8
```

查询 B 同样出现了显著的性能退化。

**查询 C 的实际执行对比**：

```sql
-- 索引可见时
EXPLAIN ANALYZE SELECT status, COUNT(*)
FROM orders WHERE user_id = 10086 GROUP BY status;
-- 结果摘要: actual time=0.55..0.78 rows=5

-- 索引不可见时
EXPLAIN ANALYZE SELECT status, COUNT(*)
FROM orders WHERE user_id = 10086 GROUP BY status;
-- 结果摘要: actual time=0.62..0.85 rows=5
```

查询 C 的性能差异较小，因为 GROUP BY 操作无论如何都需要扫描所有匹配行，索引的排序优势在这里体现不明显。

### 6.5 验证结论与决策

| 查询 | 频率 | 索引可见时延迟 | 索引不可见时延迟 | 性能变化 | 是否需要该索引 |
|------|------|--------------|----------------|---------|-------------|
| 查询A：用户订单列表 | 高频 200/s | 0.48ms | 15.6ms | 退化 32 倍 | **是** |
| 查询B：按状态筛选订单 | 中频 50/s | 0.35ms | 12.4ms | 退化 35 倍 | **是** |
| 查询C：订单状态统计 | 低频 5/s | 0.78ms | 0.85ms | 基本不变 | 否 |

综合分析后得出结论：**`idx_user_status_created` 联合索引不能删除**。它对查询 A 和查询 B 的性能有关键影响，特别是利用索引有序性避免 filesort 这一点，是单独的 `idx_user_id` 索引无法替代的。

立即将索引恢复为可见：

```sql
ALTER TABLE orders ALTER INDEX idx_user_status_created VISIBLE;
```

### 6.6 如果验证结果显示可以删除呢？

为了完整性，假设我们的验证结果是所有查询在索引不可见后性能都没有明显退化。那么接下来的工作流是：

1. 保持索引不可见状态，继续观察 3 到 7 天
2. 确认监控无异常后，使用在线 DDL 工具执行 `DROP INDEX`
3. 删除后继续观察 1 到 2 天，确认最终效果

## 七、与 pt-online-schema-change / gh-ost 等工具的配合

### 7.1 ALTER INDEX INVISIBLE 本身不需要工具辅助

首先要明确一点：`ALTER TABLE ... ALTER INDEX ... INVISIBLE` 是一个纯粹的元数据操作，执行时间在毫秒级别，不需要也不会长时间锁表。因此，在验证阶段设置索引不可见时，直接执行 ALTER TABLE 即可，无需借助任何在线 DDL 工具。

### 7.2 删除大表索引时需要工具辅助

但当验证通过后需要真正删除索引时，情况就不同了。对于大表来说：

- 在 MySQL 8.0 中，`ALTER TABLE ... DROP INDEX` 在某些情况下可能需要重建整个表（特别是当索引包含在聚簇索引中或涉及虚拟列时）
- 即使支持 instant DDL，对于非常大的表（数千万行以上），直接执行 DDL 仍然存在一定的风险

因此，对于大表的索引删除操作，推荐使用在线 DDL 工具来降低风险。

### 7.3 配合 pt-online-schema-change 使用

Percona Toolkit 中的 `pt-online-schema-change` 是一个成熟的在线表结构变更工具。它的原理是创建一个新表，在新表上执行 DDL，然后通过触发器将原表的变更同步到新表，最后进行原子切换。

```bash
pt-online-schema-change \
    --alter "DROP INDEX idx_user_status_created" \
    --execute \
    --no-drop-old-table \
    D=ecommerce,t=orders,h=your_host,P=3306,u=root,p=your_password
```

建议添加 `--no-drop-old-table` 参数，在确认一切正常后再手动删除旧表。

### 7.4 配合 gh-ost 使用

GitHub 开发的 `gh-ost` 是另一个流行的在线 DDL 工具。与 pt-osc 不同，gh-ost 不使用触发器，而是通过解析 binlog 来同步变更，对线上负载的影响更小。

```bash
gh-ost \
    --host=your_host \
    --port=3306 \
    --database=ecommerce \
    --table=orders \
    --alter="DROP INDEX idx_user_status_created" \
    --allow-on-master \
    --execute
```

gh-ost 在执行过程中会持续监控复制延迟和负载情况，如果超过阈值会自动暂停，安全性更好。

### 7.5 推荐的完整工作流

将 Invisible Index 验证与在线 DDL 工具结合，形成以下完整工作流：

1. **验证阶段**：直接执行 `ALTER TABLE ... ALTER INDEX ... INVISIBLE`（毫秒级完成）
2. **观察阶段**：持续监控 3 到 7 天
3. **删除阶段**：使用 pt-online-schema-change 或 gh-ost 执行 `DROP INDEX`
4. **确认阶段**：删除后再观察 1 到 2 天

这种组合方式在验证阶段追求零风险，在删除阶段追求零停机，是目前业界最佳实践。

## 八、SHOW INDEX 与 information_schema.STATISTICS 查看索引可见性

在日常管理中，我们需要频繁查看索引的可见性状态。MySQL 提供了多种方式来获取这些信息。

### 8.1 SHOW INDEX

最直观的方式是使用 `SHOW INDEX` 命令，其输出中包含一个 `Visible` 列：

```sql
SHOW INDEX FROM orders;
```

输出结果会清晰地显示每个索引的可见性状态（YES 或 NO）。

### 8.2 information_schema.STATISTICS

当需要批量检查多个表或整个数据库的索引可见性时，`information_schema.STATISTICS` 表更加实用：

```sql
-- 查找数据库中所有不可见索引
SELECT
    TABLE_NAME,
    INDEX_NAME,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS index_columns,
    NON_UNIQUE,
    INDEX_TYPE,
    IS_VISIBLE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'your_database'
  AND IS_VISIBLE = 'NO'
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE, IS_VISIBLE
ORDER BY TABLE_NAME, INDEX_NAME;
```

这个查询可以快速列出数据库中所有处于不可见状态的索引，便于审计和管理。

### 8.3 SHOW CREATE TABLE

`SHOW CREATE TABLE` 的输出中，不可见索引会在索引定义末尾附加特殊注释：

```sql
SHOW CREATE TABLE orders\G
```

输出中的不可见索引会显示为：

```sql
KEY `idx_user_status_created` (`user_id`,`status`,`created_at`) /*!80000 INVISIBLE */
```

`/*!80000 ... */` 是 MySQL 的版本注释语法，只有 MySQL 8.0 及以上版本才会解析其中的内容。

### 8.4 information_schema.INNODB_INDEXES

对于需要深入了解 InnoDB 内部索引信息的场景，可以直接查询 InnoDB 内部数据字典：

```sql
SELECT
    NAME AS index_name,
    CASE TYPE
        WHEN 1 THEN 'Clustered'
        WHEN 2 THEN 'Unique'
        WHEN 3 THEN 'Non-unique'
        ELSE 'Other'
    END AS index_type,
    IS_VISIBLE
FROM information_schema.INNODB_INDEXES
WHERE TABLE_ID = (
    SELECT TABLE_ID
    FROM information_schema.INNODB_TABLES
    WHERE NAME = 'ecommerce/orders'
);
```

## 九、不可见索引的限制与注意事项

### 9.1 主键索引不能设为不可见

这是最重要的限制。主键索引（PRIMARY KEY）始终必须是可见的：

```sql
ALTER TABLE orders ALTER INDEX PRIMARY INVISIBLE;
-- ERROR 3522: A primary key index cannot be invisible
```

这是因为主键索引在 InnoDB 中不仅仅是一个查询路径，更是聚簇索引的组织方式。InnoDB 的聚簇索引决定了数据行的物理存储顺序，所有二级索引都依赖主键作为"指针"。如果主键不可见，整个索引体系将无法正常工作。

### 9.2 唯一索引的可见性与约束行为

唯一索引（UNIQUE INDEX）可以设为不可见，但需要特别注意：设为不可见后，唯一约束仍然生效。也就是说，虽然优化器不会使用该索引来加速查询，但 InnoDB 仍然会在每次 INSERT 或 UPDATE 时检查唯一性约束，防止插入重复数据。

```sql
ALTER TABLE orders ALTER INDEX uk_order_no INVISIBLE;

-- 唯一约束仍然生效，以下操作会报错
INSERT INTO orders (order_no, ...) VALUES ('EXISTING_NO', ...);
-- ERROR 1062: Duplicate entry 'EXISTING_NO' for key 'uk_order_no'
```

唯一索引不可见只影响查询计划，不影响数据完整性保护。这意味着唯一索引即使不可见，仍然会带来写入开销。

### 9.3 外键关联索引的注意事项

如果某个索引是外键约束所依赖的索引，将其设为不可见后：

- 外键约束本身不会失效
- 但涉及外键关联的 JOIN 查询可能会出现性能退化
- MySQL 可能会在某些情况下给出警告

建议在操作前检查索引是否被外键引用：

```sql
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    CONSTRAINT_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'your_database'
  AND REFERENCED_TABLE_NAME IS NOT NULL
  AND COLUMN_NAME = 'user_id';
```

### 9.4 全文索引与空间索引

MySQL 8.0 中，全文索引（FULLTEXT）和空间索引（SPATIAL）在语法上支持设置为不可见，但在实际使用中需要注意测试。特别是全文索引通常有专门的查询语法（`MATCH ... AGAINST`），其行为可能与普通 B+ 树索引有所不同。

### 9.5 复制环境中的同步行为

在主从复制架构中，对索引可见性的变更会通过 binlog 传播到所有从库。这意味着在主库上将索引设为不可见后，从库上的同一索引也会变为不可见。

这对读写分离的架构尤其重要：如果你只在主库上执行了 EXPLAIN 验证，但读查询走的是从库，那么需要在从库上也进行验证。

### 9.6 不可见索引的维护开销

如前所述，不可见索引虽然对优化器不可见，但物理数据仍然被维护。这意味着：

- 每次 INSERT、UPDATE、DELETE 操作仍然会更新不可见索引
- 不可见索引仍然占用存储空间
- 不可见索引仍然会影响缓冲池的使用

因此，不可见索引不适合长期保留。建议将其作为短期验证手段（3 到 7 天），验证完成后尽快删除。

## 十、踩坑记录与最佳实践

### 踩坑一：长时间遗忘不可见索引

最常见的问题是设置了不可见索引后，由于各种原因被遗忘，导致索引长期处于不可见状态。虽然性能可能没有受到明显影响（否则早就发现了），但不可见索引仍然在消耗写入性能和存储空间。

**应对策略**：建立索引可见性变更的登记制度。每次修改索引可见性时，在团队的变更管理系统中记录，包括：操作时间、操作原因、计划观察周期、负责人。设置日历提醒，确保在观察期结束后及时处理。

### 踩坑二：高写入量表上不可见索引的隐性开销

有一次在一张日写入量超过 500 万行的日志表上，将一个索引设为不可见后计划观察一周。结果观察期间 CPU 使用率比预期高了约 5%。排查后发现，正是那个不可见索引的维护开销造成的——虽然它不参与查询，但每次 INSERT 都需要更新它的 B+ 树结构。

**应对策略**：对于高写入量的表，不可见索引的观察周期应适当缩短（建议 1 到 3 天）。观察期间需要关注 CPU 和 IO 指标的变化。

### 踩坑三：EXPLAIN ANALYZE 在主库上的意外影响

某次在主库上对一个涉及全表扫描的大查询执行 EXPLAIN ANALYZE，导致该查询真正执行了近 30 秒，期间持有大量行锁，阻塞了其他 DML 操作。

**应对策略**：永远在从库或只读副本上执行 EXPLAIN ANALYZE。如果必须在主库上执行，先通过 EXPLAIN 确认查询的 rows 估计值不会太大，并确保查询带有合理的 LIMIT 子句。

### 踩坑四：联合索引最左前缀被其他索引覆盖

在验证某个联合索引 `idx_a_b_c` 时，发现将它设为不可见后，查询性能没有明显变化。一开始以为可以安全删除，但后来发现是因为表上存在另一个索引 `idx_a_b`，它的最左前缀恰好覆盖了查询的主要条件。在这种情况下，优化器可以使用 `idx_a_b` 来部分替代 `idx_a_b_c` 的功能。

**应对策略**：在做验证之前，先梳理表上所有索引的列组合关系，找出可能的重叠。验证时不仅要看当前的执行计划是否退化，还要分析"如果将来没有另一个索引兜底，查询会怎样"。

### 踩坑五：optimizer_switch 的意外影响

有同事在调试问题时，在会话级别设置了 `use_invisible_indexes=on`，后来忘记恢复。结果这个连接被连接池回收后，后续通过该连接执行的查询意外使用了不可见索引，导致行为不一致。

**应对策略**：在生产环境中，通过 `SET GLOBAL` 禁用 `use_invisible_indexes`（默认就是 off），确保所有会话都遵守索引可见性设置。同时在连接池配置中，确保每次获取连接时重置会话级别的变量。

### 最佳实践总结

基于以上经验和教训，总结出以下最佳实践清单：

第一，在执行任何索引可见性变更之前，先完整梳理受影响的查询列表。通过 Performance Schema 的语句摘要统计，找出所有涉及目标索引列的查询。

第二，建立基线数据。在将索引设为不可见之前，先对关键查询执行 EXPLAIN ANALYZE 并记录结果，作为后续对比的基准。

第三，选择业务低峰期执行操作。虽然 ALTER INDEX INVISIBLE 本身很快，但执行后查询计划的改变可能带来短暂的性能波动。

第四，配置完善的监控告警。设置慢查询数量、P99 延迟、数据库 CPU 使用率等关键指标的告警阈值，确保能在第一时间发现问题。

第五，使用 EXPLAIN ANALYZE 量化性能差异，不要仅凭 EXPLAIN 的预估结果做决策。

第六，不可见索引的观察周期建议为 3 到 7 天，至少覆盖一个完整的业务高峰周期。

第七，验证完成后及时删除索引。不可见索引仍然消耗写入性能和存储空间，不应长期保留。

第八，对于大表，使用 pt-online-schema-change 或 gh-ost 等在线 DDL 工具执行最终的索引删除操作。

## 总结与速查表

### 核心命令速查

| 操作场景 | SQL 命令 |
|---------|---------|
| 将已有索引设为不可见 | `ALTER TABLE t ALTER INDEX idx INVISIBLE;` |
| 将不可见索引恢复为可见 | `ALTER TABLE t ALTER INDEX idx VISIBLE;` |
| 创建不可见索引 | `CREATE INDEX idx ON t(col) INVISIBLE;` |
| 查看表的索引可见性 | `SHOW INDEX FROM t;` |
| 查找所有不可见索引 | `SELECT * FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='db' AND IS_VISIBLE='NO';` |
| 查看静态执行计划 | `EXPLAIN SELECT ...;` |
| 查看实际执行计划 | `EXPLAIN ANALYZE SELECT ...;` |
| 临时启用不可见索引（调试用） | `SET SESSION optimizer_switch='use_invisible_indexes=on';` |

### 验证流程 Checklist

在进行索引安全验证时，按照以下清单逐一确认：

- [ ] 梳理并记录所有依赖目标索引的 SQL 查询
- [ ] 为每个关键查询记录 EXPLAIN ANALYZE 基线数据
- [ ] 在业务低峰期执行 `ALTER INDEX ... INVISIBLE`
- [ ] 确认索引已变为不可见（通过 SHOW INDEX 或 information_schema 验证）
- [ ] 配置慢查询日志监控和 P99 延迟告警
- [ ] 对关键查询执行 EXPLAIN ANALYZE 对比分析
- [ ] 观察至少 24 小时，建议覆盖 3 到 7 天
- [ ] 如性能退化，立即执行 `ALTER INDEX ... VISIBLE` 回退
- [ ] 如性能无异常，使用在线 DDL 工具执行 `DROP INDEX`
- [ ] 删除后继续观察 1 到 2 天确认最终效果
- [ ] 记录完整的验证过程和结论，归档备查

### 一句话总结

> Invisible Index 是 MySQL DBA 手中的一把"安全剪刀"——在剪断索引之前，先用它试试看这根线到底还通着没有。如果剪断后一切正常，那就果断清理；如果发现还有信号，随时可以接回去。

---

## 相关阅读

- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则 - KKday B2C API 真实踩坑记录](/categories/Databases/MySQL/index-deep-dive-explain/)
- [数据库索引优化实战-覆盖索引联合索引与索引下推-Laravel-B2C-API踩坑记录](/categories/Databases/MySQL/index-optimization-explain/)
- [SQL语句性能分析工具 - explain](/categories/Databases/MySQL/explain/)
- [MySQL 複雜查詢性能優化實戰 - KKday B2C API 多表 JOIN 與子查詢 EXPLAIN 聯合分析](/categories/Databases/MySQL/mysql-joinexplain/)
- [百万级数据表查询优化实战-Laravel-B2C-API-EXPLAIN-深度分析索引重构与分页治理踩坑记录](/categories/Databases/MySQL/query-optimization-explain/)

---

*本文基于 MySQL 8.0 编写，部分语法和功能在不同小版本间可能有细微差异。建议在测试环境充分验证后再应用于生产环境。如果你在使用过程中遇到任何问题或有更好的实践经验，欢迎在评论区交流讨论。*
