---

title: MySQL 索引创建原则：何时建索引与索引失效场景
keywords: [MySQL, 索引创建原则, 何时建索引与索引失效场景]
tags:
- MySQL
- 索引
- 性能优化
- 数据库
- Laravel
categories:
- database
date: 2018-03-20 15:05:07
description: MySQL 索引创建的黄金法则与实战指南。深入讲解索引创建的六大原则：选择性高的列优先、覆盖查询减少回表、联合索引遵循最左前缀、避免冗余索引与重复索引。结合 Laravel Migration 代码示例和 EXPLAIN 分析，详解在线 DDL 加索引的踩坑经验，帮助开发者在百万级数据表上安全高效地创建索引。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-creation-principles-content-1.jpg
- /images/content/databases-creation-principles-content-2.jpg
---



# 索引创建的原则

索引是 MySQL 性能优化的核心武器。创建合理的索引可以让查询性能提升几个数量级，而错误的索引策略不仅浪费存储空间，还会拖慢写入性能。本文将系统性地讲解索引创建的原则、最佳实践以及生产环境中的注意事项。

---

## 一、何时应该创建索引

在实际项目中，以下场景应当考虑创建索引：

### 1. WHERE 条件中频繁出现的列

这是最常见的索引使用场景。如果某个列经常出现在 `WHERE` 子句中，就应该为其创建索引。

```sql
-- users 表中经常按 email 查询，应为 email 创建索引
SELECT * FROM users WHERE email = 'test@example.com';
```

### 2. JOIN 关联字段

表与表之间的 JOIN 连接字段必须创建索引，否则会触发全表扫描。在 MySQL 中，被驱动表（即 JOIN 右侧的表）的连接字段如果没有索引，查询性能会急剧下降。

```sql
-- orders 表的 user_id 字段应建索引
SELECT o.*, u.name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid';
```

### 3. ORDER BY 和 GROUP BY 的列

如果查询经常需要对某列进行排序或分组，建立索引可以让 MySQL 利用索引的有序性，避免额外的 `filesort` 操作。

```sql
-- 按创建时间排序的查询非常频繁
SELECT * FROM articles ORDER BY created_at DESC LIMIT 20;
```

### 4. 高选择性列

选择性（Selectivity）是指不重复的索引值与表记录总数的比值：

```
选择性 = COUNT(DISTINCT column) / COUNT(*)
```

选择性越高，索引的过滤效果越好。唯一键的选择性为 1，是理想状态。一般来说，选择性大于 0.1 的字段值得建立索引。状态字段、性别字段等低选择性列不适合单独作为索引。

### 5. 覆盖索引场景

当查询只需要索引中的列时，MySQL 可以直接从索引中获取数据，无需回表，这称为覆盖索引（Covering Index）。在这种场景下，即使选择性不高，组合索引也有意义。

```sql
-- 如果有联合索引 (status, created_at)，以下查询可以覆盖索引
SELECT status, created_at FROM orders WHERE status = 'pending';
```

---

## 二、何时不应该创建索引

索引不是越多越好。以下场景应谨慎或避免创建索引：

### 1. 数据量很小的表

对于几百行的小表，全表扫描的速度可能比走索引更快，因为走索引还需要额外的回表操作。

### 2. 频繁大量写入的列

索引虽然加速了读取，但会拖慢 `INSERT`、`UPDATE` 和 `DELETE` 操作。每次写入都要更新索引的 B+ 树结构，带来额外的磁盘 I/O。对于写入密集型的日志表，过多的索引反而成为瓶颈。

### 3. 低选择性列单独建索引

如前所述，性别、状态等字段的选择性很低。为 `gender` 字段单独建索引，只能过滤掉约一半的数据，优化器很可能放弃使用索引直接全表扫描。

```sql
-- 选择性极低，不建议单独建索引
SELECT * FROM users WHERE gender = 'male';
```

### 4. 不在查询条件中的列

如果某列从未出现在 `WHERE`、`JOIN`、`ORDER BY` 或 `GROUP BY` 中，为其创建索引是纯粹的浪费。

### 5. 重复索引和冗余索引

**重复索引**是指在相同的列上以相同的顺序创建的相同类型的索引。例如，MySQL 默认会为主键创建聚簇索引，如果再手动为 `id` 列创建一个普通索引，这就是重复索引。

**冗余索引**是指索引 A 的列是索引 B 的列的前缀。例如，已有 `(a, b)` 联合索引，再创建 `(a)` 索引就是冗余的（`(a, b)` 已经可以覆盖只查 `a` 的场景）。

---

## 三、索引创建的六大原则

### 原则一：最左前缀匹配原则

这是联合索引最核心的原则。MySQL 会从联合索引的最左列开始匹配，直到遇到范围查询（`>`、`<`、`BETWEEN`、`LIKE`）就停止匹配。

```sql
-- 假设有联合索引 (a, b, c, d)
-- 以下查询可以使用索引
SELECT * FROM t WHERE a = 1 AND b = 2 AND c = 3 AND d = 4;  -- 全部命中
SELECT * FROM t WHERE a = 1 AND b = 2;                       -- 命中 a, b
SELECT * FROM t WHERE a = 1;                                  -- 命中 a

-- 以下查询只能部分使用索引
SELECT * FROM t WHERE a = 1 AND b = 2 AND c > 3 AND d = 4;   -- d 无法使用索引，c 处范围查询停止
```

**实战建议**：如果有 `a = 1 AND b = 2 AND c > 3 AND d = 4` 这样的查询，将索引设计为 `(a, b, d, c)` 可以让四个条件全部使用索引，因为 `=` 条件的列放在前面，范围条件的列放在后面。

### 原则二：`=` 和 `IN` 条件可以乱序

MySQL 查询优化器会自动调整 `=` 和 `IN` 条件的顺序来匹配索引。所以 `a = 1 AND b = 2 AND c = 3` 和 `b = 2 AND c = 3 AND a = 1` 在使用 `(a, b, c)` 索引时效果完全相同。

```sql
-- 优化器会自动重排条件顺序来匹配索引 (a, b, c)
SELECT * FROM t WHERE c = 3 AND a = 1 AND b = 2;
-- 等价于
SELECT * FROM t WHERE a = 1 AND b = 2 AND c = 3;
```

### 原则三：选择区分度高的列优先

在设计联合索引时，应将选择性高的列放在前面。选择性高的列能更快地缩小搜索范围。

```sql
-- 计算列的选择性
SELECT
  COUNT(DISTINCT status) / COUNT(*) AS status_selectivity,
  COUNT(DISTINCT user_id) / COUNT(*) AS user_id_selectivity,
  COUNT(DISTINCT order_no) / COUNT(*) AS order_no_selectivity
FROM orders;

-- 假设结果：status = 0.001, user_id = 0.3, order_no = 0.99
-- 联合索引应优先放 order_no，其次是 user_id
```

**注意**：这只是一个参考原则，实际设计中还需要结合查询模式。如果大部分查询都是先按 `status` 过滤再按 `user_id` 查询，那么 `(status, user_id)` 虽然违反选择性原则，但更贴合实际查询。

### 原则四：索引列不能参与计算

索引列必须保持"干净"，不能被函数包裹或参与表达式运算。因为 B+ 树中存储的是原始字段值，对列进行函数计算后，MySQL 无法利用索引进行快速查找。

```sql
-- ❌ 错误写法：索引列参与了函数计算
SELECT * FROM orders WHERE FROM_UNIXTIME(created_at) = '2024-01-01';
SELECT * FROM users WHERE YEAR(birthday) = 1990;
SELECT * FROM products WHERE price * 0.8 > 100;

-- ✅ 正确写法：将计算移到常量端
SELECT * FROM orders WHERE created_at = UNIX_TIMESTAMP('2024-01-01');
SELECT * FROM users WHERE birthday >= '1990-01-01' AND birthday < '1991-01-01';
SELECT * FROM products WHERE price > 100 / 0.8;
```

### 原则五：尽量扩展索引，不要新建索引

如果表中已经有 `(a)` 的索引，现在需要支持 `(a, b)` 的查询，直接修改原索引为 `(a, b)` 即可，无需新建一个索引。减少索引数量可以降低写入开销和存储占用。

### 原则六：避免冗余索引

如前所述，如果已有联合索引 `(a, b)`，则不需要再单独建立 `(a)` 索引。使用以下 SQL 可以检查表中的冗余索引：

```sql
-- 查看表上的索引信息
SHOW INDEX FROM orders;

-- 使用 sys 库检查冗余索引（MySQL 5.7+）
SELECT * FROM sys.schema_redundant_indexes WHERE table_name = 'orders';
```

---

## 四、联合索引的设计原则

联合索引（Composite Index）是索引优化的核心技巧。设计联合索引时需要遵循以下策略：

### 1. 等值查询列在前，范围查询列在后

```sql
-- 查询条件：status = 'active' AND age > 18 ORDER BY created_at
-- 最佳索引：(status, created_at, age) 或 (status, age, created_at)
-- 具体取决于是否需要消除排序
```

### 2. 利用索引避免排序

如果 `ORDER BY` 的列包含在联合索引中，且顺序一致，MySQL 可以利用索引的有序性避免 `filesort`。

```sql
-- 联合索引 (status, created_at)
SELECT * FROM orders WHERE status = 'paid' ORDER BY created_at DESC;
-- 利用索引有序性，无需额外排序
```

### 3. 利用索引覆盖查询

将 `SELECT` 中需要的列也加入联合索引，可以实现覆盖索引，避免回表。

```sql
-- 联合索引 (user_id, status, amount)
SELECT status, amount FROM orders WHERE user_id = 100;
-- 直接从索引获取数据，无需回表
```

---

## 五、使用 EXPLAIN 验证索引是否生效

创建索引后，必须使用 `EXPLAIN` 验证索引是否真正被使用。不能想当然地认为加了索引就一定会生效。

### EXPLAIN 基本用法

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';
```

### 关键字段解读

| 字段 | 说明 | 关注点 |
|------|------|--------|
| `type` | 访问类型 | `ALL`（全表扫描）→ `index` → `range` → `ref` → `eq_ref` → `const`，越往右越好 |
| `key` | 实际使用的索引 | 如果为 `NULL`，说明索引未生效 |
| `rows` | 预估扫描行数 | 越小越好 |
| `Extra` | 额外信息 | `Using index` 表示覆盖索引；`Using filesort` 表示额外排序 |
| `key_len` | 索引使用长度 | 可以判断联合索引中使用了几个列 |

### 实际案例

```sql
-- 假设有联合索引 idx_user_status (user_id, status)

-- 场景 1：正常使用索引
EXPLAIN SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';
-- type: ref, key: idx_user_status, rows: 5
-- ✅ 索引生效

-- 场景 2：跳过最左列，索引失效
EXPLAIN SELECT * FROM orders WHERE status = 'paid';
-- type: ALL, key: NULL, rows: 1000000
-- ❌ 索引未生效（违反最左前缀原则）

-- 场景 3：索引列参与计算，索引失效
EXPLAIN SELECT * FROM orders WHERE user_id + 1 = 101;
-- type: ALL, key: NULL
-- ❌ 索引未生效

-- 场景 4：LIKE 以通配符开头，索引失效
EXPLAIN SELECT * FROM orders WHERE order_no LIKE '%12345';
-- type: ALL, key: NULL
-- ❌ 索引未生效
```

### key_len 计算规则

通过 `key_len` 可以精确判断联合索引中有多少列被使用：

- `INT` 占 4 字节，允许 `NULL` 则 +1
- `VARCHAR(n)` 占 `n × 字符集字节数 + 2`（长度前缀），允许 `NULL` 则 +1
- `BIGINT` 占 8 字节

```sql
-- 联合索引 (user_id INT, status VARCHAR(20))
EXPLAIN SELECT * FROM orders WHERE user_id = 100;
-- key_len = 4 → 只使用了 user_id 一列

EXPLAIN SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';
-- key_len = 4 + 20*4 + 2 = 86 → 使用了两列（utf8mb4 编码）
```

---

## 六、在 Laravel Migration 中创建索引

Laravel 提供了优雅的 Schema Builder 来管理索引。以下是实际项目中的最佳实践。

### 基础索引

```php
// 创建普通索引
Schema::table('orders', function (Blueprint $table) {
    $table->index('user_id');
    $table->index('status');
    $table->index('created_at');
});
```

### 唯一索引

```php
Schema::table('users', function (Blueprint $table) {
    $table->unique('email');
    // 唯一索引自动包含 NOT NULL 约束的语义
});
```

### 联合索引

```php
Schema::table('orders', function (Blueprint $table) {
    // 联合索引：遵循最左前缀原则
    $table->index(['user_id', 'status', 'created_at'], 'idx_orders_user_status_created');

    // 覆盖索引：查询所需列全部在索引中
    $table->index(['user_id', 'status', 'amount'], 'idx_orders_user_status_amount');
});
```

### 在 Migration 中创建索引的完整示例

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained();
            $table->string('order_no', 64)->unique();
            $table->string('status', 20)->default('pending');
            $table->decimal('amount', 10, 2);
            $table->timestamps();

            // 联合索引
            $table->index(['user_id', 'status'], 'idx_orders_user_status');
            $table->index(['status', 'created_at'], 'idx_orders_status_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
```

### 为已有表添加索引（单独的 Migration）

```php
<?php

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->index(['user_id', 'status', 'created_at'], 'idx_orders_user_status_created');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('idx_orders_user_status_created');
        });
    }
};
```

### 索引命名规范

良好的索引命名能让维护更轻松。推荐的命名规范：

```
idx_{表名}_{列名1}_{列名2}
```

| 类型 | 命名前缀 | 示例 |
|------|----------|------|
| 普通索引 | `idx_` | `idx_orders_user_id` |
| 唯一索引 | `uniq_` | `uniq_users_email` |
| 全文索引 | `ft_` | `ft_articles_title` |
| 前缀索引 | `idx_` | `idx_orders_order_no_8` |

---

## 七、大型表加索引的在线 DDL 方案

在生产环境中对大型表（百万级、千万级）添加索引是一件非常危险的操作。直接执行 `ALTER TABLE ... ADD INDEX` 会锁表，导致业务停服。以下是两种成熟的在线 DDL 方案。

### 问题背景

MySQL 在 5.6 之前，`ALTER TABLE` 操作通常会复制整张表的数据到新表，期间表会被锁定。即使 MySQL 5.6+ 支持了 Online DDL，对于大表来说，重建索引仍然会消耗大量的磁盘 I/O 和 CPU 资源，并且在某些场景下仍然会阻塞写入。

### 方案一：pt-online-schema-change

`pt-online-schema-change` 是 Percona Toolkit 提供的在线表结构变更工具。它通过创建新表、复制数据、交换表名的方式实现无锁加索引。

**工作原理**：

1. 创建一个与原表结构相同的新表（`_orders_new`）
2. 在新表上执行 `ALTER TABLE` 添加索引
3. 创建触发器，捕获原表上的 `INSERT`、`UPDATE`、`DELETE` 操作并同步到新表
4. 分批将原表数据复制到新表
5. 数据复制完成后，原子性地交换两张表的名称
6. 删除旧表

**使用示例**：

```bash
pt-online-schema-change \
  --alter "ADD INDEX idx_user_status (user_id, status)" \
  --host=127.0.0.1 \
  --port=3306 \
  --user=root \
  --password=secret \
  --charset=utf8mb4 \
  --chunk-size=1000 \
  --max-lag=1s \
  --check-interval=1 \
  --progress=time,30 \
  --critical-load="Threads_running=100" \
  --execute \
  D=mydb,t=orders
```

**关键参数**：

| 参数 | 说明 |
|------|------|
| `--chunk-size` | 每次复制的行数，建议 1000-5000 |
| `--max-lag` | 允许的最大主从复制延迟，超过则暂停 |
| `--critical-load` | 系统负载过高时暂停操作 |
| `--execute` | 不加此参数为 dry-run 模式，不会真正执行 |

### 方案二：gh-ost

`gh-ost` 是 GitHub 开源的在线 DDL 工具。与 pt-online-schema-change 不同，它使用 binlog 而不是触发器来捕获数据变更，对原表的影响更小。

**工作原理**：

1. 创建影子表（`_orders_gho`）
2. 在影子表上执行 `ALTER TABLE`
3. 通过 binlog 流实时捕获原表的变更
4. 分批复制原表数据到影子表
5. 应用 binlog 中的变更到影子表
6. 原子切换表名

**使用示例**：

```bash
gh-ost \
  --host=127.0.0.1 \
  --port=3306 \
  --user=root \
  --password=secret \
  --database=mydb \
  --table=orders \
  --alter="ADD INDEX idx_user_status (user_id, status)" \
  --chunk-size=1000 \
  --max-lag-millis=1500 \
  --serve-socket-file=/tmp/gh-ost.sock \
  --initially-drop-ghost-table \
  --initially-drop-old-table \
  --execute
```

**gh-ost 的优势**：

- 不使用触发器，对原表性能影响更小
- 可以通过 socket 文件动态调整参数（如暂停、恢复、修改 chunk-size）
- 更容易控制和监控

### 两种方案对比

| 特性 | pt-online-schema-change | gh-ost |
|------|------------------------|--------|
| 变更捕获方式 | 触发器 | Binlog |
| 对原表影响 | 需要创建触发器，对写入有一定影响 | 无触发器，影响更小 |
| 外键支持 | 有限支持 | 不支持 |
| 动态调整 | 不支持 | 支持（通过 socket） |
| 成熟度 | 更成熟，使用更广泛 | 较新，GitHub 出品 |
| 推荐场景 | 一般场景首选 | 对性能敏感的场景 |

### 注意事项

1. **提前在从库测试**：先在从库上执行一次，评估执行时间和资源消耗
2. **避开高峰期**：虽然工具支持限流，但仍有额外的 I/O 和 CPU 开销
3. **监控主从延迟**：确保 `--max-lag` 参数设置合理
4. **预留磁盘空间**：操作过程中需要额外的磁盘空间存放新表数据
5. **使用 dry-run 模式**：先不加 `--execute` 参数进行预演

---

## 八、索引使用查询一定提高性能吗

通常通过索引查询数据比全表扫描要快，但并不是绝对的。索引需要空间来存储，也需要定期维护。每当有记录在表中增减或索引列被修改时，索引本身也会被修改。这意味着每条记录的 `INSERT`、`DELETE`、`UPDATE` 将为此多付出 4~5 次的磁盘 I/O。

使用索引查询不一定能提高查询性能，索引范围查询（INDEX RANGE SCAN）适用于两种情况：

- 基于一个范围的检索，一般查询返回结果集小于表中记录数的 30%。
- 基于非唯一性索引的检索。

MySQL 优化器会根据统计信息估算使用索引和全表扫描的成本，如果估算结果是全表扫描更快（例如返回超过 30% 的数据），优化器会自动放弃使用索引。

---

## 九、总结

索引创建的核心原则可以归纳为以下几点：

1. **为高频查询条件建索引**：`WHERE`、`JOIN`、`ORDER BY`、`GROUP BY` 涉及的列
2. **遵循最左前缀原则**：联合索引中等值查询列在前，范围查询列在后
3. **选择性高的列优先**：放在联合索引的前面
4. **保持索引列干净**：不要对索引列使用函数或参与计算
5. **避免冗余和重复索引**：定期检查并清理无用索引
6. **用 EXPLAIN 验证**：创建索引后务必确认优化器真正使用了它
7. **大表加索引使用在线 DDL**：选择 pt-online-schema-change 或 gh-ost

记住：**索引是一把双刃剑**。合理的索引能极大提升查询性能，但过多的索引会增加存储开销和写入延迟。索引设计需要在读写性能之间找到平衡。

---

## 相关阅读

- [索引的概念](/categories/Databases/index/concept)
- [索引的优缺点](/categories/Databases/index/pros-and-cons)
- [索引失效的 12 种原因](/categories/Databases/index/ineffective-cases)
- [覆盖索引（Covering Index）](/categories/Databases/index/covering-index)
- [索引的最左前缀原则](/categories/Databases/index/leftmost-prefix-rule)
- [聚簇索引与非聚簇索引](/categories/Databases/index/clustered-vs-nonclustered)
- [索引回表](/categories/Databases/index/index-lookup)
