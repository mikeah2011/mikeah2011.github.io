---
title: SQL语句性能分析工具 - explain
tags: [MySQL, EXPLAIN, 查询优化, 索引, 性能分析, Laravel]
keywords: [SQL, explain, 语句性能分析工具, 数据库]
categories:
  - database
date: 2019-03-20 15:05:07
description: '深入解析 MySQL EXPLAIN 执行计划的各项字段含义，包括 type 访问类型、key 索引使用、rows 扫描行数、Extra 附加信息等核心指标。文章附带 Laravel 框架中的 EXPLAIN 调用代码示例，以及三个真实优化案例（全表扫描、filesort、临时表），帮助开发者快速定位慢查询瓶颈并制定优化策略。'
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-006-content-1.jpg
  - /images/content/databases-006-content-2.jpg

---

通过explain，如以下例子：

![SQL查询性能分析](/images/content/databases-006-content-1.jpg)

```sql
EXPLAIN SELECT * FROM employees.titles WHERE emp_no='10001' AND title='Senior Engineer' AND from_date='1986-06-26';
```

| id   | select_type | table  | partitions | type  | possible_keys | key     | key_len | ref               | filtered | rows | Extra |
| :--- | :---------- | :----- | :--------- | :---- | :------------ | :------ | :------ | :---------------- | :------- | :--- | :---- |
| 1    | SIMPLE      | titles | null       | const | PRIMARY       | PRIMARY | 59      | const,const,const | 10       | 1    |       |

- id：在⼀个⼤的查询语句中每个**SELECT**关键字都对应⼀个唯⼀的id ，如

  `explain select * from s1 where id = (select id from s1 where name = 'egon1');`

  第一个select的id是1，第二个select的id是2。

  有时候会出现两个select，但是id却都是1，

  这是因为优化器把子查询变成了连接查询 。

- select_type：select关键字对应的那个查询的类型，如

  ![图片](/images/select_type.png)

  | 类型         | 含义                                   |
  | :----------- | :------------------------------------- |
  | SIMPLE       | 简单SELECT查询，不包含子查询和UNION    |
  | PRIMARY      | 复杂查询中的最外层查询，表示主要的查询 |
  | SUBQUERY     | SELECT或WHERE列表中包含了子查询        |
  | DERIVED      | FROM列表中包含的子查询，即衍生         |
  | UNION        | UNION关键字之后的查询                  |
  | UNION RESULT | 从UNION后的表获取结果集                |

- table：每个查询对应的表名 

  - `<unionM,N>`：具有和id值的行的M并集N。
  - `<derivedN>`：用于与该行的派生表结果id的值N。派生表可能来自（例如）FROM子句中的子查询 。
  - `<subqueryN>`：子查询的结果，其id值为N

- partitions：该列的值表示查询将从中匹配记录的分区

- type：`type` 字段比较重要, 它提供了判断查询是否高效的重要依据依据.

  通过 `type` 字段, 我们判断此次查询是 `全表扫描` 还是 `索引扫描` 等。如

  const(主键索引或者唯一二级索引进行等值匹配的情况下)；

  ref(普通的⼆级索引列与常量进⾏等值匹配)；

  index(扫描全表索引的覆盖索引) …![图片](/images/explain_type.png)

  **type 字段详解：各访问类型性能排序与含义**

  从最优到最差：`system > const > eq_ref > ref > range > index > ALL`

  | type | 含义 | 触发条件示例 | 性能评估 |
  | :--- | :--- | :--- | :--- |
  | **system** | 表只有一行记录（系统表），特殊的 const 类型 | 系统表（MyISAM 的元数据表） | ✅ 最优 |
  | **const** | 通过主键或唯一索引与常量进行等值匹配，最多返回一行 | `WHERE id = 1`（主键等值） | ✅ 极优 |
  | **eq_ref** | 多表 JOIN 时，被驱动表通过主键或唯一索引进行等值匹配 | `JOIN orders ON users.id = orders.user_id`（id 为唯一索引） | ✅ 优秀 |
  | **ref** | 使用普通二级索引与常量进行等值匹配，可能返回多行 | `WHERE name = 'Tom'`（name 有普通索引） | ✅ 良好 |
  | **range** | 索引上的范围扫描（BETWEEN、IN、>、<、LIKE 'abc%'） | `WHERE age BETWEEN 20 AND 30` | ⚠️ 可接受 |
  | **index** | 全索引扫描，遍历整个索引树（不回表） | `SELECT id FROM users`（覆盖索引） | ⚠️ 注意 |
  | **ALL** | 全表扫描，逐行读取数据 | `WHERE unindexed_col = 'x'` | ❌ 需优化 |

  通常来说, 不同的 type 类型的性能关系如下:

  `ALL < index < range ~ index_merge < ref < eq_ref < const < system`

  `ALL` 类型因为是全表扫描, 因此在相同的查询条件下, 它是速度最慢的.而 `index` 类型的查询虽然不是全表扫描, 但是它扫描了所有的索引, 因此比 ALL 类型的稍快.

- possible_key：查询中可能用到的索引(可以把用不到的删掉，降低优化器的优化时间)

- key：此字段是 MySQL 在当前查询时所真正使用到的索引。

- key_len：该列表示使用索引的长度。**key_len 越短越好**，它反映了索引使用的充分程度。

  **key_len 计算规则：**
  - 索引字段占用字节数 + 是否允许 NULL（1 字节）+ 变长字段长度前缀（2 字节）
  - 例：`utf8mb4` 编码下 `VARCHAR(50) NOT NULL` 的 key_len = 50 × 4 + 2 = 202
  - 例：`utf8mb4` 编码下 `INT NOT NULL` 的 key_len = 4

  **key_len 实战解读：**
  - 联合索引 `(a, b, c)`，若 key_len 只对应 a 的长度，说明只用到了第一个字段
  - 若 key_len 对应 a + b 的长度，说明用到了前两个字段（最左前缀原则）
  - key_len 越大，说明索引利用越充分

- ref：该列表示索引命中的列或者常量。

- rows 也是一个非常重要的字段。

![索引分析与优化](/images/content/databases-006-content-2.jpg)

MySQL 查询优化器根据统计信息, 估算 SQL 要查找到结果集需要扫描读取的数据行数.这个值非常直观显示 SQL 的效率好坏, 原则上 rows 越少越好。

- filtered：查询器预测满足下一次查询条件的百分比 。

- extra：表示 MySQL 执行查询时的附加信息，是判断查询效率的关键指标之一。常见的 Extra 值包括 Using where、Using temporary、Using filesort、Using index 等。

  | 枚举值                       | 涵义                                                         |
  | ---------------------------- | ------------------------------------------------------------ |
  | Impossible WHERE             | 表示WHERE后面的条件一直都是false                             |
  | Using filesort               | 表示按文件排序，一般是在指定的排序和索引排序不一致的情况才会出现 |
  | Using index                  | 表示是否用了覆盖索引，说白了它表示是否所有获取的列都走了索引 |
  | Using temporary              | 表示是否使用了临时表，一般多见于order by 和 group by语句     |
  | Using where                  | 表示使用了where条件过滤                                      |
  | Using join buffer            | 表示是否使用连接缓冲                                         |
  | No tables used               | Query语句中使用from dual 或不含任何from子句                  |
  | Select tables optimized away | 这个值意味着仅通过使用索引，优化器可能仅从聚合函数结果中返回一行 |
  
  

常用的字符编码占用字节数量如下：

![图片](/images/bite.png)

目前我的数据库字符编码格式用的：UTF8占3个字节。

MySQL常用字段占用字节数：

| 字段类型   | 占用字节数 |
| :--------- | :--------- |
| char(n)    | n          |
| varchar(n) | n + 2      |
| tinyint    | 1          |
| smallint   | 2          |
| int        | 4          |
| bigint     | 8          |
| date       | 3          |
| timestamp  | 4          |
| datetime   | 8          |

使用`explain`命令，查看`MySQL`的执行计划。

|     项目      |          释义          |
| :-----------: | :--------------------: |
|      id       |     select唯一标识     |
|  select_type  |       select类型       |
|     table     |         表名称         |
|  partitions   |       匹配的分区       |
|     type      |        连接类型        |
| possible_keys |     可能的索引选择     |
|      key      |     实际用到的索引     |
|    key_len    |      实际索引长度      |
|      ref      |     与索引比较的列     |
|     rows      |    预期要检查的行数    |
|   filtered    | 按表条件过滤的行百分比 |
|     extra     |        附加信息        |

## EXPLAIN 高级输出格式（MySQL 8.0+）

除了默认的表格格式，MySQL 8.0+ 还支持 `FORMAT=JSON` 和 `FORMAT=TREE` 两种更详细的输出格式。

### EXPLAIN FORMAT=JSON

以 JSON 格式输出执行计划，包含更丰富的优化器决策信息，如成本估算、嵌套子查询结构等：

```sql
EXPLAIN FORMAT=JSON
SELECT * FROM orders WHERE user_id = 10086 AND status = 'paid';
```

关键 JSON 字段解读：

```json
{
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "12.50"
    },
    "table": {
      "table_name": "orders",
      "access_type": "ref",
      "possible_keys": ["idx_user_status"],
      "key": "idx_user_status",
      "key_length": "10",
      "rows_examined_per_scan": 12,
      "rows_produced_per_join": 12,
      "filtered": "100.00",
      "cost_info": {
        "read_cost": "11.30",
        "eval_cost": "1.20",
        "prefix_cost": "12.50",
        "data_read_per_join": "4K"
      },
      "used_key_parts": ["user_id"],
      "attached_condition": "(`orders`.`status` = 'paid')"
    }
  }
}
```

**JSON 格式的独特优势：**
- `cost_info`：精确查看优化器的成本估算，帮助理解为什么选择了某个索引
- `attached_condition`：显示在存储引擎层过滤后，Server 层额外应用的条件
- `read_cost` 和 `eval_cost`：分别表示读取成本和评估成本，有助于判断优化方向

### EXPLAIN FORMAT=TREE

以树形结构输出执行计划，直观展示每个步骤的嵌套关系和行数估算：

```sql
EXPLAIN FORMAT=TREE
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.status = 'paid';
```

输出示例：

```
-> Nested loop inner join  (cost=2.70 rows=3)
    -> Table scan on u  (cost=0.45 rows=3)
    -> Single-row index lookup on o using PRIMARY (user_id=u.id)  (cost=0.82 rows=1)
        -> Filter: (o.status = 'paid')  (cost=0.82 rows=1)
```

**TREE 格式的优势：**
- 直观展示查询执行的嵌套结构（如嵌套循环连接的每一层）
- `cost` 和 `rows` 精确到每个步骤，便于定位性能瓶颈所在的层级
- 比表格格式更易理解复杂 JOIN 的执行流程

> **注意**：`FORMAT=TREE` 是 MySQL 8.0.16+ 才支持的新格式，之前的版本请使用 `FORMAT=JSON`。

### 三种格式对比

| 格式 | 适用场景 | 优点 | 缺点 |
| :--- | :--- | :--- | :--- |
| 默认（TRADITIONAL） | 日常调试、快速查看 | 可读性好，一目了然 | 缺少成本估算等细节 |
| FORMAT=JSON | 深度分析优化器决策 | 包含完整成本信息和执行细节 | 输出较长，解析复杂 |
| FORMAT=TREE | 理解 JOIN 执行流程 | 树形结构直观展示嵌套关系 | 不适合复杂子查询分析 |

## 索引优化的过程

1. 先用慢查询日志定位具体需要优化的 SQL

2. 使用 `EXPLAIN` 执行计划查看索引使用情况

3. 重点关注四列：

   | 列名 | 关注点 |
   | :--- | :--- |
   | **type** | 访问类型，至少达到 range 级别 |
   | **key** | 实际使用的索引，NULL 表示未用索引 |
   | **rows** | 扫描行数，越少越好 |
   | **Extra** | 有无 Using temporary / Using filesort |

4. 根据上一步找出的索引问题优化 SQL

5. 再回到第 2 步验证优化效果

### 综合示例：多表 JOIN 的 EXPLAIN 分析

以下是一个典型的多表关联查询及其 EXPLAIN 输出：

```sql
EXPLAIN
SELECT u.name, o.order_no, p.product_name
FROM users u
JOIN orders o ON u.id = o.user_id
JOIN products p ON o.product_id = p.id
WHERE u.status = 'active' AND o.created_at > '2024-01-01';
```

| id | select_type | table | type | key | key_len | ref | rows | Extra |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| 1 | SIMPLE | u | ref | idx_status | 5 | const | 85 | Using where |
| 1 | SIMPLE | o | ref | idx_user_created | 9 | u.id | 12 | Using index condition |
| 1 | SIMPLE | p | eq_ref | PRIMARY | 8 | o.product_id | 1 | Using where |

**分析要点：**
- `u` 表通过 `idx_status` 索引过滤（type=ref），扫描 85 行
- `o` 表通过 `idx_user_created` 联合索引关联（type=ref），每用户平均 12 单
- `p` 表通过主键精确匹配（type=eq_ref），效率最优
- 整体没有 Using filesort 和 Using temporary，查询性能良好

## 常见 Extra 字段详解

| Extra 值 | 含义 | 严重程度 | 优化建议 |
| :--- | :--- | :--- | :--- |
| Using index | 覆盖索引，查询列全在索引中 | ✅ 优秀 | 无需优化 |
| Using where | 存储引擎返回行后，Server 层再过滤 | ⚠️ 注意 | 检查 WHERE 条件是否有对应索引 |
| Using temporary | 使用临时表存放中间结果 | ❌ 需优化 | 优化 GROUP BY / DISTINCT，添加合适索引 |
| Using filesort | 无法利用索引排序，需额外排序操作 | ❌ 需优化 | ORDER BY 字段加索引或调整排序顺序 |
| Using index condition | 使用了索引下推（ICP，MySQL 5.6+） | ✅ 良好 | 已是优化表现，无需处理 |
| Using join buffer | 被驱动表无可用索引，使用连接缓冲 | ⚠️ 注意 | 给被驱动表的连接字段加索引 |
| Select tables optimized away | 直接从索引获取聚合结果 | ✅ 优秀 | 无需优化 |
| Impossible WHERE | WHERE 条件永远为 false | ❌ 逻辑错误 | 检查 SQL 逻辑 |

## Laravel 中使用 EXPLAIN

在 Laravel 项目中，可以通过以下方式使用 `EXPLAIN` 分析查询：

### 方法一：原生 SQL 执行 EXPLAIN

```php
use Illuminate\Support\Facades\DB;

// 对任意 SQL 执行 EXPLAIN
$sql = "SELECT * FROM orders WHERE user_id = ? AND status = ?";
$explain = DB::select("EXPLAIN $sql", [1, 'paid']);

foreach ($explain as $row) {
    echo "type: {$row->type}, key: {$row->key}, rows: {$row->rows}, Extra: {$row->Extra}\n";
}
```

### 方法二：对 Eloquent 查询执行 EXPLAIN

```php
use Illuminate\Support\Facades\DB;

// 先获取 Builder 生成的 SQL 和绑定
$query = \App\Models\Order::where('user_id', 1)
    ->where('status', 'paid')
    ->orderBy('created_at', 'desc');

$sql = $query->toRawSql();  // Laravel 10+ 可用
$explain = DB::select("EXPLAIN $sql");

dump($explain);
```

### 方法三：在调试栏查看（推荐开发环境）

```php
// 在 AppServiceProvider 的 boot 方法中注册查询日志
use Illuminate\Support\Facades\DB;

public function boot()
{
    DB::listen(function ($query) {
        logger()->info('SQL', [
            'sql'    => $query->sql,
            'time'   => $query->time . 'ms',
            'explain' => DB::select("EXPLAIN " . $query->sql),
        ]);
    });
}
```

> **提示**：生产环境切勿开启查询日志，避免性能损耗和日志膨胀。

## 真实优化案例

### 案例一：消除全表扫描（type: ALL → ref）

**优化前：** 用户订单查询走全表扫描

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 10086 AND status = 'paid';
```

| id | select_type | type | key | rows | Extra |
|:---|:---|:---|:---|:---|:---|
| 1 | SIMPLE | ALL | NULL | 500000 | Using where |

**问题分析：** `type = ALL`，`key = NULL`，未使用任何索引，扫描了 50 万行。

**解决方案：** 添加联合索引

```sql
ALTER TABLE orders ADD INDEX idx_user_status (user_id, status);
```

**优化后：**

| id | select_type | type | key | rows | Extra |
|:---|:---|:---|:---|:---|:---|
| 1 | SIMPLE | ref | idx_user_status | 12 | Using index condition |

✅ `type` 从 `ALL` 变为 `ref`，扫描行数从 50 万降至 12。

### 案例二：消除 filesort（Using filesort → Using index）

**优化前：** 排序操作触发 filesort

```sql
EXPLAIN SELECT id, title, created_at FROM articles
WHERE category_id = 5 ORDER BY created_at DESC LIMIT 20;
```

| id | select_type | type | key | rows | Extra |
|:---|:---|:---|:---|:---|:---|
| 1 | SIMPLE | ref | idx_category | 3200 | Using where; Using filesort |

**问题分析：** 有 `idx_category(category_id)` 索引可以过滤，但排序字段 `created_at` 不在索引中，导致 filesort。

**解决方案：** 建立覆盖查询和排序的联合索引

```sql
ALTER TABLE articles ADD INDEX idx_cat_created (category_id, created_at);
```

**优化后：**

| id | select_type | type | key | rows | Extra |
|:---|:---|:---|:---|:---|:---|
| 1 | SIMPLE | range | idx_cat_created | 20 | Using where; Using index |

✅ 消除了 filesort，且使用了覆盖索引（Using index），无需回表。

### 案例三：消除临时表（Using temporary → 无）

**优化前：** GROUP BY 导致使用临时表

```sql
EXPLAIN SELECT department, COUNT(*) FROM employees GROUP BY department;
```

| id | select_type | type | key | rows | Extra |
|:---|:---|:---|:---|:---|:---|
| 1 | SIMPLE | ALL | NULL | 100000 | Using temporary; Using filesort |

**解决方案：** 添加索引

```sql
ALTER TABLE employees ADD INDEX idx_dept (department);
```

**优化后：**

| id | select_type | type | key | rows | Extra |
|:---|:---|:---|:---|:---|:---|
| 1 | SIMPLE | index | idx_dept | 100000 | Using index |

✅ 消除了 Using temporary 和 Using filesort，通过索引完成分组。

## 相关阅读

- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则](/categories/Databases/index-deep-dive-explain/)
- [百万级数据表查询优化实战：EXPLAIN 深度分析索引重构与分页治理](/categories/Databases/query-optimization-explain/)
- [MySQL 慢查询治理实战：pt-query-digest 分析、索引优化与 SQL 重写](/categories/Databases/slow-query-governance/)
- [数据库索引优化实战：覆盖索引、联合索引与索引下推](/categories/Databases/index-optimization-explain/)
