---

title: MySQL 锁机制详解：行锁、表锁、间隙锁与死锁处理
keywords: [MySQL, 锁机制详解, 行锁, 表锁, 间隙锁与死锁处理]
tags:
- MySQL
- 锁
- InnoDB
- 并发控制
- 事务
categories:
- database
date: 2021-03-20 15:05:07
description: MySQL锁机制是数据库并发控制的核心基础。本文系统讲解InnoDB存储引擎的锁体系：从表级锁与行级锁的对比，到共享锁（S锁）、排他锁（X锁）、意向锁的工作原理；深入剖析Record Lock、Gap Lock、Next-Key Lock三种行锁算法及其在可重复读隔离级别下防止幻读的机制；详解死锁的产生条件、排查方法与预防策略，并对比乐观锁与悲观锁在高并发场景下的选型思路。结合实际踩坑案例，帮助开发者理解锁等待超时处理、大事务锁表、索引失效导致锁升级等常见问题的解决方案。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-01-content-1.jpg
- /images/content/databases-01-content-2.jpg
---


[TOC]

## 锁机制

> 计算机协调 多个进程或线程 并发访问某一资源的机制。

![MySQL 并发与锁机制](/images/content/databases-01-content-1.jpg)

### 锁的类型及其特点

开销、加锁、颗粒度、冲突、并发等角度分析

表级锁(table-level locking) 开销大，加锁快，不会出现死锁，颗粒度大，锁冲突概率高，并发度小；

页面锁(page-level locking) 开销、加锁效率、颗粒度介于表锁和行锁之间，会出现死锁，并发度一般；

行级锁(row-level locking)  开销大，加速慢，会出现死锁，颗粒度小，锁冲突概率小，并发度高；

### 锁的类型应用场景

表锁 - 适合 以查询为主，只有少量按索引条件更新数据的应用，如web应用；

行锁 - 适合 大量按索引条件并发 更新少量不同数据，同时又有并发查询的应用，如在线事务处理系统；

### 锁的支持度及情况

MyISAM 只支持 表锁

InnoDB 默认支持 行锁，也支持表锁

```mysql
-- 查询表锁争用情况
show status like 'table%'; # Table_locks_waited 大则表锁争用情况严重
```

### 锁的维度划分

共享锁(S) - 读锁

排他锁(X) - 写锁

意向共享锁(IS) 

意向排他锁(IX)

间隙锁

### 共享锁（S锁）实战示例

共享锁允许其他事务并发读取，但禁止写入。在需要"读取时锁定行、确保不被其他事务修改"的场景下非常有用。

```sql
-- Session A：加共享锁读取
BEGIN;
SELECT * FROM products WHERE id = 10 LOCK IN SHARE MODE;
-- id=10 被加 S 锁，其他事务可以读，不能写

-- Session B：并发读取（成功）
SELECT * FROM products WHERE id = 10;
-- 普通读取不受影响

-- Session B：尝试修改（阻塞）
UPDATE products SET price = 99 WHERE id = 10;
-- 等待 Session A 提交释放 S 锁
```

```sql
-- Session A：共享锁转排他锁失败场景
BEGIN;
SELECT * FROM products WHERE id = 10 LOCK IN SHARE MODE;  -- 持有 S 锁
UPDATE products SET price = 99 WHERE id = 10;
-- 错误！同一事务内不能在持有 S 锁时直接升级为 X 锁
-- ERROR 1205 (HY000): Lock wait timeout exceeded
```

> **注意**：MySQL 不支持锁升级（S → X）。如果需要修改，应在首次读取时直接使用 `FOR UPDATE`。

### 死锁

![死锁与并发冲突](/images/content/databases-01-content-2.jpg)

#### 死锁的产生原因

1. 系统资源不足
2. 进程运行 推进的顺序/速度 不同
3. 资源分配不当

#### 死锁的必要条件

1. 互斥					一个资源每次只能被一个进程使用
2. 请求与保持    一个进程因请求资源而阻塞时，对已获得的资源保持不放
3. 不可剥夺        进程已获得的资源，在未使用完之前，不能强行剥夺
4. 循环等待        若干进程之间形成一种头尾相接的循环等待资源关系



### 避免死锁

- 合理的设计索引，区分度高的列放到组合索引前面，使业务 SQL 尽可能通过索引定位更少的行，减少锁竞争。

- 调整业务逻辑 SQL 执行顺序， 避免 update/delete 长时间持有锁的 SQL 在事务前面。

- 避免大事务，将大事务拆成多个小事务

- 以固定的顺序访问表和行。

  比如两个更新数据的事务，

  事务 A 更新数据的顺序为 1，2;

  事务 B 更新数据的顺序为 2，1。

  这样更可能会造成死锁。

- 在并发比较高的系统中，不要显式加锁，特别是是在事务里显式加锁。

  如 select … for update 语句，

  如果是在事务里（运行了 start transaction 或设置了autocommit 等于0）,

  那么就会锁定所查找到的记录。

- 尽量用主键/索引去查找记录

- 优化 SQL 和表设计，减少同时占用太多资源的情况。

  比如说，避免多个表join，将复杂 SQL 分解为多个简单的 SQL。



#### 死锁的解除与预防

打破必要条件之一即可解锁，预防必要条件即可预防死锁。

1. 按同一顺序访问对象
2. 避免事务中的用户交互
3. 保持事务简短并在一个批处理中
4. 使用低隔离级别
5. 使用绑定连接



### 总结

| 维度\|锁类型 |                           表级锁                           | 页面锁 |                            行级锁                            |
| :----------: | :--------------------------------------------------------: | :----: | :----------------------------------------------------------: |
|   内存开销   |                             大                             |   中   |                              大                              |
|   加锁效率   |                             快                             |   中   |                              慢                              |
|    颗粒度    |                             大                             |   中   |                              小                              |
|  锁冲突概率  |                             高                             |   中   |                              低                              |
|  是否会死锁  |                             否                             |   是   |                              是                              |
|    并发度    |                             小                             |  一般  |                              高                              |
|   应用特点   |                  查询&少量索引条件的更新                   |   -    |             并发查询&大量索引条件的不同数据更新              |
|   应用场景   |                            Web                             |   -    |                       在线事务处理系统                       |
|   存储引擎   |                       MyISAM、InnoDB                       |   -    |                            InnoDB                            |
|  锁争用参数  | `show status like 'table%'` <br />Table_locks_waited<br /> |   -    | `show status like 'InnoDB_row_lock%';`<br />InnoDB_row_lock_waits<br />InnoDB_row_lock_time_avg<br /> |

## InnoDB 行锁的三种算法

InnoDB 在 **可重复读（REPEATABLE READ）** 隔离级别下，使用三种行锁算法来保证数据一致性并防止幻读：

### Record Lock（记录锁）

锁定索引记录本身，防止其他事务对该行进行修改或删除。

```sql
-- Session A
BEGIN;
SELECT * FROM users WHERE id = 1 FOR UPDATE;  -- 对 id=1 加 Record Lock

-- Session B（阻塞）
UPDATE users SET name = 'test' WHERE id = 1;   -- 等待 Session A 释放锁
```

### Gap Lock（间隙锁）

锁定索引记录之间的"间隙"（左开右开区间），防止其他事务在间隙中插入新记录，从而防止幻读。

```sql
-- 假设 users 表 id 列有值：1, 5, 10
-- Session A
BEGIN;
SELECT * FROM users WHERE id > 5 AND id < 10 FOR UPDATE;  -- 加 Gap Lock：(5, 10)

-- Session B（阻塞）
INSERT INTO users (id, name) VALUES (7, 'new_user');  -- 落在间隙中，被阻塞
```

### Next-Key Lock（临键锁）

Record Lock + Gap Lock 的组合（左开右闭区间），是 InnoDB 默认的行锁算法。既能锁住已有记录，又能锁住记录前的间隙。

```sql
-- 假设 users 表 id 列有值：1, 5, 10
-- Session A
BEGIN;
SELECT * FROM users WHERE id >= 5 AND id < 10 FOR UPDATE;
-- Next-Key Lock 锁定范围：(1, 5] 和 (5, 10]

-- Session B（阻塞）
INSERT INTO users (id, name) VALUES (3, 'test');  -- 落在 (1, 5] 区间，被阻塞
```

> **注意**：在 **读已提交（READ COMMITTED）** 隔离级别下，InnoDB 只使用 Record Lock，不会使用 Gap Lock 和 Next-Key Lock，因此无法防止幻读。

## 意向锁详解

意向锁是 InnoDB 在表级自动添加的锁，用于表明事务稍后将对表中的某行加行级共享锁或排他锁，从而快速判断表锁与行锁之间是否存在冲突：

- **意向共享锁（IS）**：事务打算给某行加 S 锁前，先在表级加 IS 锁
- **意向排他锁（IX）**：事务打算给某行加 X 锁前，先在表级加 IX 锁

意向锁之间不互斥，IS 与 S 不互斥，但 IX 与 S 互斥。这使得加表锁时无需逐行检查。

## 死锁的产生与排查

### 死锁产生场景

```sql
-- Session A                          -- Session B
BEGIN;                                 BEGIN;
UPDATE accounts SET balance = 100      UPDATE accounts SET balance = 200
WHERE id = 1;                          WHERE id = 2;
-- id=1 加 X 锁                       -- id=2 加 X 锁

UPDATE accounts SET balance = 200      UPDATE accounts SET balance = 100
WHERE id = 2;  -- 等待 id=2 的锁      WHERE id = 1;  -- 等待 id=1 的锁
-- → 死锁！                             -- → 死锁！
```

### Gap Lock 死锁场景

间隙锁（Gap Lock）之间的兼容性特殊：两个 Gap Lock 之间不互斥，但 Gap Lock 与 INSERT 操作互斥。这会导致看似"两个读操作"之间的死锁：

```sql
-- 假设 accounts 表 id 列有值：1, 5, 10
-- Session A
BEGIN;
SELECT * FROM accounts WHERE id = 7 FOR UPDATE;  -- 加 Gap Lock：(5, 10)

-- Session B
BEGIN;
SELECT * FROM accounts WHERE id = 8 FOR UPDATE;  -- 加 Gap Lock：(5, 10)，不冲突

-- Session A
INSERT INTO accounts (id, name, balance) VALUES (7, 'test', 0);
-- 阻塞！被 Session B 的 Gap Lock 阻塞

-- Session B
INSERT INTO accounts (id, name, balance) VALUES (8, 'test', 0);
-- 阻塞！被 Session A 的 Gap Lock 阻塞
-- → 死锁！InnoDB 回滚其中一个事务
```

> **排查提示**：这种死锁在 `SHOW ENGINE INNODB STATUS` 中表现为 `gap lock` 相关的锁等待，解决方法是使用确定的索引值查询（走 Record Lock）或降低隔离级别到 RC。

### 死锁排查

```sql
-- 查看最近一次死锁日志
SHOW ENGINE INNODB STATUS\G

-- 关注 LATEST DETECTED DEADLOCK 部分：
-- TRANSACTION 1: 持有的锁、等待的锁
-- TRANSACTION 2: 持有的锁、等待的锁
-- WE ROLL BACK TRANSACTION 2  ← 被回滚的事务
```

输出中关键信息包括：
- **TRANSACTION**：两个事务的 ID
- **WAITING FOR THIS LOCK TO BE GRANTED**：正在等待的锁
- **HOLDS THE LOCK(S)**：已持有的锁
- **RECORD LOCKS**：涉及的具体索引记录

```sql
-- 查看当前锁等待
SELECT * FROM performance_schema.data_lock_waits;

-- 查看所有持有的锁
SELECT * FROM performance_schema.data_locks;

-- 监控 InnoDB 行锁状态
SHOW STATUS LIKE 'InnoDB_row_lock%';
-- InnoDB_row_lock_waits：行锁等待次数
-- InnoDB_row_lock_time_avg：平均等待时间
-- InnoDB_row_lock_time_max：最大等待时间
```

### 死锁解决方案

1. **设置合理的锁等待超时**：`innodb_lock_wait_timeout`（默认 50 秒），超时后自动回滚等待事务
2. **开启死锁检测**：`innodb_deadlock_detect = ON`（默认开启），检测到死锁后回滚代价最小的事务
3. **优化事务设计**：缩短事务持有锁的时间，避免长事务
4. **统一加锁顺序**：所有事务按相同的顺序访问行记录

## 乐观锁 vs 悲观锁

| 对比维度 | 乐观锁 | 悲观锁 |
|:---:|:---:|:---:|
| 实现方式 | 版本号 / CAS | `SELECT ... FOR UPDATE` |
| 冲突假设 | 假设冲突少 | 假设冲突多 |
| 性能影响 | 无锁开销，高并发性能好 | 加锁开销大，有阻塞 |
| 适用场景 | 读多写少、冲突少 | 写多、冲突频繁 |
| 数据一致性 | 需重试保证 | 强一致 |
| 典型应用 | 库存扣减、文章编辑 | 转账、订单状态变更 |

### Laravel 乐观锁实现

```php
use Illuminate\Support\Facades\DB;

// 基于版本号的乐观锁
public function deductStock(int $productId, int $quantity): bool
{
    return DB::transaction(function () use ($productId, $quantity) {
        // 1. 读取当前版本号
        $product = DB::table('products')
            ->where('id', $productId)
            ->lock(false)  // 不加悲观锁
            ->first();

        if ($product->stock < $quantity) {
            return false;
        }

        // 2. 通过 WHERE version 条件更新（CAS）
        $affected = DB::table('products')
            ->where('id', $productId)
            ->where('version', $product->version)  // 版本号校验
            ->update([
                'stock'   => $product->stock - $quantity,
                'version' => $product->version + 1, // 版本号自增
            ]);

        return $affected > 0;  // 返回 0 表示被其他事务抢先修改，需重试
    });
}
```

### Laravel 悲观锁实现

```php
use Illuminate\Support\Facades\DB;

// 基于 FOR UPDATE 的悲观锁
public function transfer(int $fromId, int $toId, float $amount): bool
{
    return DB::transaction(function () use ($fromId, $toId, $amount) {
        // 加排他锁，其他事务无法同时修改这两行
        $from = DB::table('accounts')->where('id', $fromId)->lockForUpdate()->first();
        $to   = DB::table('accounts')->where('id', $toId)->lockForUpdate()->first();

        if ($from->balance < $amount) {
            throw new \RuntimeException('余额不足');
        }

        DB::table('accounts')->where('id', $fromId)->decrement('balance', $amount);
        DB::table('accounts')->where('id', $toId)->increment('balance', $amount);

        return true;
    });
}
```

## 锁等待超时处理策略

当事务等待行锁超过 `innodb_lock_wait_timeout`（默认 50 秒）时，MySQL 返回错误 `ERROR 1205 (HY000): Lock wait timeout exceeded`。

### 排查当前锁等待

```sql
-- 查看当前锁等待详情
SELECT
    r.trx_id AS waiting_trx_id,
    r.trx_mysql_thread_id AS waiting_thread,
    r.trx_query AS waiting_query,
    b.trx_id AS blocking_trx_id,
    b.trx_mysql_thread_id AS blocking_thread,
    b.trx_query AS blocking_query
FROM information_schema.innodb_lock_waits w
JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id;

-- 手动 KILL 阻塞线程
KILL <blocking_thread_id>;
```

### 使用 SHOW PROCESSLIST 监控锁状态

```sql
-- 使用 SHOW PROCESSLIST 查看所有连接状态
SHOW PROCESSLIST;
-- 关注 State 为 "Waiting for table metadata lock" 或 "Sending data" 的连接

-- 查看当前运行的事务
SELECT * FROM information_schema.innodb_trx\G

-- 查看锁等待关系（含等待时长）
SELECT
    r.trx_id AS waiting_trx,
    r.trx_query AS waiting_query,
    b.trx_id AS blocking_trx,
    b.trx_query AS blocking_query,
    TIMESTAMPDIFF(SECOND, b.trx_wait_started, NOW()) AS wait_seconds
FROM information_schema.innodb_lock_waits w
JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id;
```

### 优化策略

1. **缩短事务**：只在必要时开启事务，减少锁持有时间
2. **合理设置超时**：OLTP 场景建议 `SET innodb_lock_wait_timeout = 5`，快速失败
3. **应用层重试**：捕获锁超时异常后进行有限次数的指数退避重试
4. **监控告警**：关注 `InnoDB_row_lock_waits` 和 `InnoDB_row_lock_time_avg` 指标

## 实际踩坑案例

### 案例一：大事务锁表导致系统雪崩

**场景**：某电商系统执行批量退款，一个事务内更新了 10 万条订单记录。

```sql
BEGIN;
UPDATE orders SET status = 'refunded' WHERE batch_id = 'BATCH_20230101';
-- 大事务持有行锁长达数分钟
-- 同一时间其他正常订单更新全部阻塞
COMMIT;
```

**解决**：拆分为小批次事务，每批处理 500 条，每批之间短暂释放连接。

```php
// Laravel 分批处理示例
$orders = Order::where('batch_id', 'BATCH_20230101')->select('id')->get();
foreach ($orders->chunk(500) as $chunk) {
    DB::table('orders')->whereIn('id', $chunk->pluck('id'))->update(['status' => 'refunded']);
    usleep(50000); // 50ms 间隔，释放锁压力
}
```

### 案例二：索引失效导致行锁升级为表锁

**场景**：`name` 列是 `VARCHAR` 类型，查询条件未加索引或发生隐式类型转换。

```sql
-- phone 列是 VARCHAR，但传入了数字
SELECT * FROM users WHERE phone = 13800138000 FOR UPDATE;
-- 隐式类型转换导致索引失效，行锁退化为表锁！
-- 整张 users 表被锁定
```

**解决**：确保查询条件命中索引，避免隐式类型转换。

```sql
-- 正确写法：传入字符串
SELECT * FROM users WHERE phone = '13800138000' FOR UPDATE;
```

### 案例三：RR 隔离级别下 Next-Key Lock 导致插入阻塞

**场景**：事务 A 查询范围数据并加锁，事务 B 尝试在范围内插入记录被阻塞。

```sql
-- Session A
BEGIN;
SELECT * FROM orders WHERE order_date BETWEEN '2023-01-01' AND '2023-01-31' FOR UPDATE;

-- Session B
INSERT INTO orders (order_date, amount) VALUES ('2023-01-15', 100);
-- 阻塞！因为 Next-Key Lock 锁住了整个范围
```

**解决**：
- 如不需要幻读保护，使用 RC 隔离级别（只有 Record Lock）
- 缩小查询范围，减少锁区间
- 尽快提交事务，释放 Gap Lock

### 案例四：外键约束导致隐式锁表

**场景**：某系统在删除订单时，订单明细表有外键关联但未建索引，导致全表扫描并锁住大量行。

```sql
-- order_items 表有外键：FOREIGN KEY (order_id) REFERENCES orders(id)
-- 但 order_id 列未建索引

BEGIN;
DELETE FROM orders WHERE id = 100;
-- InnoDB 需要检查子表 order_items 中所有关联记录
-- order_id 无索引 → 全表扫描 → 锁住 order_items 表所有行
COMMIT;
```

**解决**：为外键列添加索引。

```sql
ALTER TABLE order_items ADD INDEX idx_order_id (order_id);
```

```php
// Laravel 迁移中为外键字段添加索引
Schema::table('order_items', function (Blueprint $table) {
    $table->index('order_id');
});
```

---

## 相关阅读

- [MySQL事务](/categories/Databases/transaction/) — 事务ACID特性、隔离级别与MVCC原理
- [MySQL - MVCC](/categories/Databases/mvcc-1/) — 多版本并发控制、ReadView与可见性判断算法
- [控制并发](/categories/Databases/concurrency-control/) — 悲观锁与乐观锁选型、死锁检测与Laravel实战
- [Redis高并发](/categories/Databases/high-concurrency/) — 缓存穿透/击穿/雪崩防护与分布式锁
