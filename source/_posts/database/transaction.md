---

title: MySQL 事务详解：ACID 特性、隔离级别与 MVCC 实现
keywords: [MySQL, ACID, MVCC, 事务详解, 特性, 隔离级别与, 实现, 数据库]
tags:
- MySQL
- 事务
- ACID
- MVCC
- InnoDB
- 并发控制
categories:
  - database
date: 2020-03-20 15:05:07
description: 深入理解MySQL事务机制，涵盖ACID四大特性、四种隔离级别区别与原理、InnoDB MVCC多版本并发控制实现、行锁/间隙锁/临键锁等锁机制详解，以及Laravel中事务的实际代码示例与常见踩坑案例，帮助开发者全面掌握MySQL并发控制技术。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-transaction-01-content-1.jpg
- /images/content/databases-transaction-01-content-2.jpg
---


事务概念





> 4个原则 ACID	

|  原则  |                      概念                      |            |
| :----: | :--------------------------------------------: | ---------- |
| 原子性 |   一个事务中的操作要么全部成功，要么全部失败   | Atomicity  |
| 一致性 | 总是从一个一致性的状态转换到另一个一致性的状态 | Consistent |
| 隔离性 |  一个事务的修改在提交前，其他事务是感知不到的  | Isolation  |
| 持久性 |               永久保存在数据库中               | Durable    |

​	**原子性、隔离性、持久性都是为了保障一致性而存在的，一致性也是最终的目的**。

![MySQL事务ACID原则](/images/content/databases-transaction-01-content-1.jpg)



> 隔离级别

​	读未提交	**READ UNCOMMITTED**

​	读已提交	**READ COMMITTED**

​	可重复读	**REPEATABLE READ**

​	可序列化	**SERIALIZABLE**





没有那种隔离级别是完美的，只能根据自己的项目业务场景去评估选择最适合的隔离级别，大部分的公司一般选择Mysql默认的隔离级别：**可重复读**。

隔离级别从：**读未提交-读提交-可重复读-串行化**，**级别越来越高，隔离也就越来越严实，到最后的串行化，当出现读写锁冲突的时候，后面的事务只能等前面的事务完成后才能继续访问**。

1. **读未提交：读取到别的事务还没有提交的数据，从而产生了脏读**。
2. **读提交：读取别的事务已经提交的数据，从而产生不可重复读。**
3. **可重复读：事务开启过程中看到的数据和事务刚开始看到的数据是一样的，从而产生幻读，在Mysql的中通过MVCC多版本控制的一致性视图解决了不可重复读问题以及通过间隙锁解决了幻读问题。**
4. **串行化：对于同一行记录，若是读写锁发生冲突，后面访问的事务只能等前面的事务执行完才能继续访问**。

举个例子，假如有一个user表，里面有两个字段id和age，里面有一条测试数据：（1,24），现在要执行age+1，同时有两个事务执行：

| 事务1                       | 事务2         |
| :-------------------------- | :------------ |
| 启动事务，接着查询age（a1） |               |
|                             | 启动事务      |
|                             | 查询age（a2） |
|                             | 执行age=age+1 |
| 查询age（a3）               |               |
|                             | 提交事务      |
| 查询age（a4）               |               |
| 提交事务                    |               |
| 查询age（a5）               |               |

经过上面的执行，在四种隔离级别下a1,a2,a3,a4,a5的值分别是多少？我们来认真的分析一波：

1. **读未提交**：a1和a2因为读的是初始值所以为24，隔离级别为读未提交，事务2执行了age=age+1，不管事务2是否提交，那么a3、a4和a5的值都是25。
2. **读提交**：a1和a2因为读的是初始值所以为24，隔离级别为读提交所以a3还是24，a4和a5因为事务2已经提交所以得到的值是25。
3. **可重复读**：a1和a2因为读的是初始值所以为24，可重复读的隔离级别下，a3和a4读取的值和事务开始的结果一样，所以还是24，a5前一步因为已经提交事务，所以a5的值是25。
4. **串行化**：a1和a2因为读的是初始值所以为24，串行化隔离级别下，当事务2修改数据的时候，获取了写锁，事务1读取age的值会被锁住，所以在事务1的角度下a3和a4读取的值为24，a5的值为25。

当你能够分析得出这个例子下，在不同隔离级别下分析的出a1-a5的值，说明你对事务的隔离级别已经有比较深入的理解了。

### 隔离级别与并发问题对照表

下表总结了四种隔离级别与三大并发异常现象之间的关系：

| 隔离级别 | 脏读（Dirty Read） | 不可重复读（Non-Repeatable Read） | 幻读（Phantom Read） |
| :------: | :----------------: | :-------------------------------: | :------------------: |
| 读未提交（READ UNCOMMITTED） | ✅ 可能发生 | ✅ 可能发生 | ✅ 可能发生 |
| 读已提交（READ COMMITTED） | ❌ 不会发生 | ✅ 可能发生 | ✅ 可能发生 |
| 可重复读（REPEATABLE READ） | ❌ 不会发生 | ❌ 不会发生 | ⚠️ InnoDB通过MVCC+Next-Key Lock大部分解决 |
| 串行化（SERIALIZABLE） | ❌ 不会发生 | ❌ 不会发生 | ❌ 不会发生 |

> 💡 MySQL InnoDB在**可重复读**级别下，通过MVCC解决快照读的幻读，通过Next-Key Lock解决当前读的幻读，因此实际上已经接近串行化的隔离效果，同时保持了较高的并发性能。

### MySQL 隔离级别演示代码

以下通过实际SQL演示四种隔离级别的行为差异。请打开两个MySQL终端（Terminal A和Terminal B）分别操作：

**准备测试数据：**

```sql
CREATE DATABASE IF NOT EXISTS test_tx;
USE test_tx;

DROP TABLE IF EXISTS user;
CREATE TABLE user (
    id INT PRIMARY KEY,
    age INT NOT NULL
) ENGINE=InnoDB;

INSERT INTO user (id, age) VALUES (1, 24);
```

#### 1. 读未提交（READ UNCOMMITTED）

```sql
-- Terminal A                              -- Terminal B
SET SESSION TRANSACTION ISOLATION
  LEVEL READ UNCOMMITTED;
START TRANSACTION;
SELECT age FROM user WHERE id=1;
-- 结果: 24
                                           SET SESSION TRANSACTION ISOLATION
                                             LEVEL READ UNCOMMITTED;
                                           START TRANSACTION;
                                           UPDATE user SET age=25 WHERE id=1;
                                           -- 注意: 尚未COMMIT!
SELECT age FROM user WHERE id=1;
-- 结果: 25 ← 脏读! 读到了未提交的数据
                                           ROLLBACK;
-- Terminal A读到的25其实是"脏数据"，事务B回滚后该值根本不存在
COMMIT;
```

#### 2. 读已提交（READ COMMITTED）

```sql
-- Terminal A                              -- Terminal B
SET SESSION TRANSACTION ISOLATION
  LEVEL READ COMMITTED;
START TRANSACTION;
SELECT age FROM user WHERE id=1;
-- 结果: 24
                                           SET SESSION TRANSACTION ISOLATION
                                             LEVEL READ COMMITTED;
                                           START TRANSACTION;
                                           UPDATE user SET age=25 WHERE id=1;
SELECT age FROM user WHERE id=1;
-- 结果: 24 ← 避免了脏读
                                           COMMIT;
SELECT age FROM user WHERE id=1;
-- 结果: 25 ← 不可重复读! 同一事务内两次读取结果不同
COMMIT;
```

#### 3. 可重复读（REPEATABLE READ）

```sql
-- Terminal A                              -- Terminal B
SET SESSION TRANSACTION ISOLATION
  LEVEL REPEATABLE READ;
START TRANSACTION;
SELECT age FROM user WHERE id=1;
-- 结果: 24
                                           SET SESSION TRANSACTION ISOLATION
                                             LEVEL REPEATABLE READ;
                                           START TRANSACTION;
                                           UPDATE user SET age=25 WHERE id=1;
                                           COMMIT;
SELECT age FROM user WHERE id=1;
-- 结果: 24 ← 可重复读! 即使事务B已提交，仍读到事务开始时的快照
COMMIT;
SELECT age FROM user WHERE id=1;
-- 结果: 25 ← 事务结束后读到最新值
```

#### 4. 串行化（SERIALIZABLE）

```sql
-- Terminal A                              -- Terminal B
SET SESSION TRANSACTION ISOLATION
  LEVEL SERIALIZABLE;
START TRANSACTION;
SELECT age FROM user WHERE id=1;
-- 结果: 24（自动加共享锁）
                                           SET SESSION TRANSACTION ISOLATION
                                             LEVEL SERIALIZABLE;
                                           START TRANSACTION;
                                           UPDATE user SET age=25 WHERE id=1;
                                           -- ⏳ 阻塞! 等待Terminal A释放锁
                                           -- 如果等待超过innodb_lock_wait_timeout
                                           -- 则报错: Lock wait timeout exceeded
COMMIT;
-- Terminal A提交后，Terminal B的UPDATE才执行成功
                                           COMMIT;
```

> ⚠️ 串行化级别下，所有`SELECT`语句都会隐式转换为`SELECT ... LOCK IN SHARE MODE`，会与其他事务的写锁冲突，导致大量阻塞，因此**线上环境极少使用**。


> 并发事务的问题

#### 更新丢失（Lost Update）

两个事务同时更新同一行数据，一个事务的更新被另一个事务覆盖，导致更新丢失。

```sql
-- 事务A和事务B同时读取balance=1000
START TRANSACTION;
SELECT balance FROM accounts WHERE id=1;  -- 读到1000
                                          -- 事务B同时也读到1000
UPDATE accounts SET balance=900 WHERE id=1;  -- 事务A扣100
                                              -- 事务B也扣100，设为900
COMMIT;                                       -- 事务B COMMIT
-- 最终balance=900，事务A的扣款"丢失"了！
-- 正确结果应为800
```

**解决方案**：使用`SELECT ... FOR UPDATE`加排他锁，或使用乐观锁（版本号机制）。

#### 脏读（Dirty Read）

一个事务读取到了另一个事务**尚未提交**的数据。如果后者回滚，前者读到的就是无效数据。

在**读未提交**隔离级别下会发生。解决方案：将隔离级别提升到**读已提交**或以上。

#### 不可重复读（Non-Repeatable Read）

同一事务内，两次读取同一行数据，结果不同。原因是两次读取之间，另一个事务修改并提交了该行数据。

在**读已提交**隔离级别下会发生。解决方案：将隔离级别提升到**可重复读**。

#### 幻读（Phantom Read）

同一事务内，两次执行相同的范围查询，返回的**行数**不同。原因是两次查询之间，另一个事务插入了满足条件的新行。

```sql
-- 事务A                              -- 事务B（读已提交级别）
START TRANSACTION;
SELECT COUNT(*) FROM orders
WHERE amount > 1000;
-- 结果: 5
                                       START TRANSACTION;
                                       INSERT INTO orders (id, amount)
                                       VALUES (101, 2000);
                                       COMMIT;
SELECT COUNT(*) FROM orders
WHERE amount > 1000;
-- 结果: 6 ← 幻读! 多了一行"幻影"数据
COMMIT;
```

> 💡 在InnoDB的**可重复读**级别下，快照读通过MVCC避免幻读，当前读通过Next-Key Lock避免幻读。但这两种机制组合使用时，在极端边界情况下（先快照读再当前读）仍可能出现幻读，需要开发者理解并正确使用`SELECT ... FOR UPDATE`。


![并发事务问题](/images/content/databases-transaction-01-content-2.jpg)


> 实现分布式事务

1、流水任务，最终一致性，前提是接口要支持幂等性

2、事务消息

3、二阶段提交

4、三阶段提交

5、TCC

6、Seata 框架

## MVCC 多版本并发控制详解

MVCC（Multi-Version Concurrency Control）是InnoDB实现高并发的核心机制，它使得读写操作互不阻塞，大幅提升了数据库的并发性能。

### 核心组件

1. **Undo Log（回滚日志）**：InnoDB在修改数据时，会将旧版本的数据写入Undo Log，形成一条版本链。每行记录都隐藏了两个字段：`DB_TRX_ID`（最近修改的事务ID）和`DB_ROLL_PTR`（指向Undo Log中上一个版本的指针）。

2. **Read View（一致性视图）**：事务在执行快照读（普通SELECT）时，会生成一个Read View，用于判断当前事务能看到哪个版本的数据。Read View包含以下关键信息：
   - `m_ids`：生成Read View时，系统中活跃（未提交）的事务ID列表
   - `min_trx_id`：活跃事务中最小的事务ID
   - `max_trx_id`：系统应该分配给下一个事务的ID
   - `creator_trx_id`：创建该Read View的事务ID

3. **版本可见性判断规则**：通过比较记录的`DB_TRX_ID`与Read View的信息来决定该版本是否可见：
   - 如果 `DB_TRX_ID < min_trx_id`：说明该版本在Read View创建前已提交，**可见**
   - 如果 `DB_TRX_ID >= max_trx_id`：说明该版本在Read View创建后才产生，**不可见**
   - 如果 `min_trx_id <= DB_TRX_ID < max_trx_id`：需要判断`DB_TRX_ID`是否在`m_ids`中，不在则说明已提交，**可见**；在则说明还未提交，**不可见**

### MVCC如何解决不可重复读

在**可重复读**隔离级别下，Read View只在事务第一次执行快照读时生成，之后整个事务都复用这个Read View。因此，即使其他事务提交了修改，当前事务看到的始终是同一个快照，从而保证了可重复读。

而在**读提交**隔离级别下，每次执行SELECT都会生成一个新的Read View，所以能看到其他事务已提交的最新修改。

### 当前读与快照读

| 读取方式 | 说明 | 触发SQL |
| :------: | :--: | :-----: |
| 快照读 | 读取的是记录的可见版本，不加锁 | 普通 `SELECT` |
| 当前读 | 读取的是记录的最新版本，并加锁 | `SELECT ... FOR UPDATE`、`SELECT ... LOCK IN SHARE MODE`、`INSERT`、`UPDATE`、`DELETE` |

> ⚠️ MVCC只能解决快照读的幻读问题，当前读的幻读需要通过Next-Key Lock来解决。

### MVCC 工作流程伪代码

以下用伪代码展示InnoDB MVCC的核心工作流程，帮助理解其底层实现逻辑：

```
// ============================================
// 数据行的隐藏字段结构
// ============================================
struct RowRecord {
    // 用户可见的数据字段
    id: int
    age: int
    // ... 其他业务字段

    // InnoDB隐藏字段（用户不可见）
    DB_TRX_ID: long    // 最近修改该行的事务ID
    DB_ROLL_PTR: long  // 指向Undo Log中旧版本的指针
    DB_ROW_ID: long    // 隐式主键（无显式主键时使用）
}

// ============================================
// Undo Log 版本链结构
// ============================================
struct UndoLog {
    DB_TRX_ID: long       // 修改该版本的事务ID
    DB_ROLL_PTR: long     // 指向上一个旧版本
    old_data: RowRecord   // 修改前的数据快照
}

// ============================================
// Read View（一致性视图）结构
// ============================================
struct ReadView {
    creator_trx_id: long  // 创建该Read View的事务ID
    m_ids: List<long>     // 创建时所有活跃（未提交）事务ID列表
    min_trx_id: long      // m_ids中的最小值
    max_trx_id: long      // 系统下一个要分配的事务ID
}

// ============================================
// 创建Read View
// ============================================
function create_read_view(current_trx_id):
    read_view = new ReadView()
    read_view.creator_trx_id = current_trx_id
    read_view.m_ids = get_all_active_transaction_ids()  // 获取当前所有活跃事务
    read_view.min_trx_id = min(read_view.m_ids)         // 最小活跃事务ID
    read_view.max_trx_id = get_next_transaction_id()     // 下一个待分配的事务ID
    return read_view

// ============================================
// 核心：版本可见性判断算法
// ============================================
function is_visible(row_trx_id, read_view):
    // 情况1：该版本是自己修改的 → 可见
    if row_trx_id == read_view.creator_trx_id:
        return true

    // 情况2：该版本在Read View创建前已提交 → 可见
    if row_trx_id < read_view.min_trx_id:
        return true

    // 情况3：该版本在Read View创建后才产生 → 不可见
    if row_trx_id >= read_view.max_trx_id:
        return false

    // 情况4：该版本在活跃事务范围内，需判断是否在m_ids中
    if row_trx_id in read_view.m_ids:
        return false  // 该事务在Read View创建时还未提交 → 不可见
    else:
        return true   // 该事务在Read View创建时已提交 → 可见

// ============================================
// 快照读：遍历版本链找到第一个可见版本
// ============================================
function snapshot_read(row, read_view):
    version = row  // 从当前版本开始
    while version != null:
        if is_visible(version.DB_TRX_ID, read_view):
            return version  // 找到第一个可见版本，返回
        // 不可见，沿Undo Log版本链向前查找
        version = read_undo_log(version.DB_ROLL_PTR)
    return null  // 所有版本都不可见

// ============================================
// 可重复读 vs 读已提交 的关键差异
// ============================================
function do_select(transaction, isolation_level):
    if isolation_level == REPEATABLE_READ:
        // 可重复读：Read View只在事务第一次SELECT时创建，之后复用
        if transaction.read_view == null:
            transaction.read_view = create_read_view(transaction.id)
        read_view = transaction.read_view  // 复用同一个Read View

    else if isolation_level == READ_COMMITTED:
        // 读已提交：每次SELECT都创建新的Read View
        read_view = create_read_view(transaction.id)

    // 使用Read View执行快照读
    return snapshot_read(target_row, read_view)

// ============================================
// 当前读：直接读取最新版本并加锁
// ============================================
function current_read(row, lock_type):
    // 当前读不走MVCC，直接读取最新数据
    acquire_lock(row, lock_type)  // 加排他锁或共享锁
    return row  // 返回最新版本
    // 触发当前读的SQL：SELECT ... FOR UPDATE / LOCK IN SHARE MODE
    //                 INSERT / UPDATE / DELETE
```

以上伪代码展示了MVCC的三个核心机制：
1. **Undo Log版本链**：每次修改数据时，旧版本通过`DB_ROLL_PTR`串成链表
2. **Read View可见性判断**：通过4个条件判断某个版本是否对当前事务可见
3. **隔离级别差异的本质**：可重复读在事务首次读取时创建Read View并复用；读已提交每次读取都创建新的Read View

## InnoDB 锁机制

InnoDB的锁机制是保障事务隔离性的重要手段，与MVCC配合实现了不同隔离级别下的并发控制。

### 锁的类型

| 锁类型 | 说明 | 粒度 |
| :----: | :--: | :--: |
| 共享锁（S Lock） | 允许事务读取数据，多个事务可同时持有 | 行级 |
| 排他锁（X Lock） | 允许事务修改数据，同一时刻只能有一个事务持有 | 行级 |
| 意向共享锁（IS） | 表示事务打算给表中的某些行加共享锁 | 表级 |
| 意向排他锁（IX） | 表示事务打算给表中的某些行加排他锁 | 表级 |

### 行锁的三种算法

InnoDB在**可重复读**隔离级别下，使用以下三种锁算法来防止幻读：

1. **Record Lock（记录锁）**：锁定索引中的一行记录，防止其他事务对该行进行修改或删除。

2. **Gap Lock（间隙锁）**：锁定索引记录之间的间隙（左开右开区间），防止其他事务在间隙中插入新记录。例如，如果表中有id为1、5、10的记录，那么间隙包括 `(-∞, 1)`、`(1, 5)`、`(5, 10)`、`(10, +∞)`。

3. **Next-Key Lock（临键锁）**：Record Lock + Gap Lock的组合（左开右闭区间），是InnoDB在可重复读级别下的默认加锁方式。例如，对于id=5的记录，Next-Key Lock锁定的范围是 `(1, 5]`。

```sql
-- 查看当前锁等待情况（MySQL 8.0+）
SELECT * FROM performance_schema.data_lock_waits;
SELECT * FROM performance_schema.data_locks;

-- 查看InnoDB引擎状态（包含锁信息）
SHOW ENGINE INNODB STATUS\G
```

### 加锁规则总结

| 场景 | 加锁行为 |
| :--- | :------- |
| 等值查询命中索引 | Next-Key Lock退化为Record Lock |
| 等值查询未命中索引 | Next-Key Lock退化为Gap Lock |
| 范围查询 | 加Next-Key Lock |
| 唯一索引上的等值查询 | Next-Key Lock退化为Record Lock |

## 实际代码示例

### Laravel 中设置事务隔离级别

```php
<?php

use Illuminate\Support\Facades\DB;

// 方法一：使用 statement 设置隔离级别
DB::statement('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
DB::beginTransaction();
try {
    // 业务逻辑
    DB::commit();
} catch (\Exception $e) {
    DB::rollBack();
    throw $e;
}

// 方法二：在配置文件 config/database.php 中设置
// 'mysql' => [
//     'options' => [
//         PDO::ATTR_ISOLATION_LEVEL => PDO::TRANSACTION_REPEATABLE_READ,
//     ],
// ]
```

### Laravel 事务的三种写法

#### 写法一：DB::transaction() 闭包（推荐）

这是最简洁安全的方式，Laravel 自动处理 begin、commit、rollback：

```php
<?php

use Illuminate\Support\Facades\DB;

// 基础用法
DB::transaction(function () {
    DB::table('accounts')->where('id', 1)->decrement('balance', 100);
    DB::table('accounts')->where('id', 2)->increment('balance', 100);
});

// 带返回值
$order = DB::transaction(function () use ($userId, $items) {
    $order = DB::table('orders')->insertGetId([
        'user_id' => $userId,
        'total' => collect($items)->sum('price'),
        'status' => 'pending',
        'created_at' => now(),
    ]);

    foreach ($items as $item) {
        DB::table('order_items')->insert([
            'order_id' => $order,
            'product_id' => $item['product_id'],
            'quantity' => $item['quantity'],
            'price' => $item['price'],
        ]);

        // 扣减库存（使用悲观锁防止超卖）
        $affected = DB::table('products')
            ->where('id', $item['product_id'])
            ->where('stock', '>=', $item['quantity'])
            ->decrement('stock', $item['quantity']);

        if ($affected === 0) {
            throw new \RuntimeException("商品 {$item['product_id']} 库存不足");
        }
    }

    return $order;
});

// 指定最大重试次数（Laravel 自带死锁重试）
DB::transaction(function () {
    // 业务逻辑
}, 5); // 最多重试5次
```

#### 写法二：手动 begin/commit/rollback

适用于需要在事务过程中有条件性提交或回滚的复杂场景：

```php
<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

DB::beginTransaction();

try {
    // 步骤1：创建订单
    $orderId = DB::table('orders')->insertGetId([
        'user_id' => $userId,
        'total' => $totalAmount,
        'status' => 'pending',
    ]);

    // 步骤2：扣减库存
    $affected = DB::table('products')
        ->where('id', $productId)
        ->where('stock', '>=', $quantity)
        ->decrement('stock', $quantity);

    if ($affected === 0) {
        throw new \RuntimeException('库存不足');
    }

    // 步骤3：扣减余额
    $balance = DB::table('wallets')
        ->where('user_id', $userId)
        ->lockForUpdate()
        ->value('balance');

    if ($balance < $totalAmount) {
        throw new \RuntimeException('余额不足');
    }

    DB::table('wallets')
        ->where('user_id', $userId)
        ->decrement('balance', $totalAmount);

    // 步骤4：更新订单状态
    DB::table('orders')
        ->where('id', $orderId)
        ->update(['status' => 'paid']);

    // 全部成功，提交事务
    DB::commit();

    Log::info("订单 {$orderId} 支付成功");

} catch (\Exception $e) {
    // 任何一步失败，回滚整个事务
    DB::rollBack();

    Log::error("订单处理失败: " . $e->getMessage());
    throw $e;
}
```

#### 写法三：嵌套事务（Savepoint）

Laravel 的嵌套事务使用 Savepoint 机制，内层回滚不会影响外层事务：

```php
<?php

use Illuminate\Support\Facades\DB;

DB::transaction(function () {
    // 外层事务操作
    DB::table('orders')->where('id', $orderId)->update(['status' => 'processing']);

    try {
        // 内层嵌套事务（Savepoint）
        DB::transaction(function () {
            // 尝试扣减库存
            $affected = DB::table('products')
                ->where('id', $productId)
                ->where('stock', '>=', 1)
                ->decrement('stock', 1);

            if ($affected === 0) {
                throw new \RuntimeException('库存不足');
                // 内层回滚到 Savepoint，外层事务不受影响
            }
        });
    } catch (\Exception $e) {
        // 内层失败，记录日志，外层事务继续执行
        Log::warning("库存扣减失败，切换到预售模式: " . $e->getMessage());
        DB::table('orders')->where('id', $orderId)->update(['status' => 'pre_order']);
    }

    // 外层事务正常提交
});
```

> 💡 底层实现原理：Laravel 的 `Connection::transaction()` 每次嵌套调用时会执行 `SAVEPOINT trans_N`，内层 rollback 执行 `ROLLBACK TO SAVEPOINT trans_N`，而不是真正回滚整个事务。

### 死锁检测与处理

```php
<?php

use Illuminate\Support\Facades\DB;
use PDOException;

/**
 * 带死锁检测的事务执行
 */
function executeWithDeadlockDetection(callable $callback, int $maxRetries = 3): mixed
{
    $attempt = 0;

    while ($attempt < $maxRetries) {
        try {
            DB::beginTransaction();
            $result = $callback();
            DB::commit();

            return $result;
        } catch (PDOException $e) {
            DB::rollBack();
            $attempt++;

            // MySQL死锁错误码：1213
            // MySQL锁等待超时错误码：1205
            if (($e->getCode() === '40001' || $e->getCode() === '1213') && $attempt < $maxRetries) {
                // 随机退避，避免再次死锁
                usleep(random_int(100000, 500000)); // 100ms - 500ms
                continue;
            }

            throw $e;
        }
    }

    throw new \RuntimeException("事务在 {$maxRetries} 次重试后仍然失败");
}
```

### 通用事务重试逻辑

```php
<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 通用事务重试包装器
 *
 * @param callable $callback 需要在事务中执行的业务逻辑
 * @param int $maxRetries 最大重试次数
 * @param int $retryDelayMs 重试间隔（毫秒）
 * @return mixed
 */
function transactionWithRetry(callable $callback, int $maxRetries = 3, int $retryDelayMs = 200): mixed
{
    $lastException = null;

    for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
        try {
            return DB::transaction(function () use ($callback) {
                return $callback();
            });
        } catch (\Exception $e) {
            $lastException = $e;

            Log::warning("事务执行失败，第 {$attempt} 次重试", [
                'error' => $e->getMessage(),
                'attempt' => $attempt,
                'max_retries' => $maxRetries,
            ]);

            if ($attempt < $maxRetries) {
                usleep($retryDelayMs * 1000);
            }
        }
    }

    throw $lastException;
}

// 使用示例
$result = transactionWithRetry(function () {
    $balance = DB::table('accounts')->where('id', 1)->lockForUpdate()->value('balance');
    if ($balance < 100) {
        throw new \RuntimeException('余额不足');
    }
    DB::table('accounts')->where('id', 1)->decrement('balance', 100);
    DB::table('accounts')->where('id', 2)->increment('balance', 100);
    return true;
}, maxRetries: 3, retryDelayMs: 300);
```

## 踩坑案例

### 坑一：长事务持有锁导致系统变慢

**问题描述**：一个事务中包含了大量操作或等待外部接口响应，导致事务长时间持有锁，阻塞其他事务。

```php
// ❌ 错误示范：在事务中调用外部API
DB::beginTransaction();
try {
    $order = DB::table('orders')->lockForUpdate()->find($orderId);
    // 外部API调用可能耗时数秒甚至超时！
    $paymentResult = Http::post('https://payment-api.com/charge', [...]);
    DB::table('orders')->where('id', $orderId)->update(['status' => 'paid']);
    DB::commit();
} catch (\Exception $e) {
    DB::rollBack();
}

// ✅ 正确做法：先完成外部调用，再开启事务
$paymentResult = Http::post('https://payment-api.com/charge', [...]);
if ($paymentResult->successful()) {
    DB::transaction(function () use ($orderId, $paymentResult) {
        DB::table('orders')->where('id', $orderId)->update(['status' => 'paid']);
        DB::table('payment_logs')->insert([...]);
    });
}
```

**最佳实践**：
- 事务尽量短小，只包含必要的数据库操作
- 将IO操作、外部API调用移到事务之外
- 设置合理的锁等待超时时间：`SET innodb_lock_wait_timeout = 10;`

### 坑二：Auto-commit 行为差异

**问题描述**：MySQL默认开启`autocommit`，每条SQL语句都会自动提交。开发者在手动开启事务时可能忘记autocommit的影响。

```sql
-- 查看当前autocommit设置
SELECT @@autocommit; -- 默认为1（开启）

-- 没有显式 BEGIN/START TRANSACTION 的SQL会自动提交
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- 自动提交！
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- 自动提交！
-- 如果第一条成功、第二条失败，数据会不一致！

-- ✅ 正确做法：显式使用事务
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

**Laravel中的注意点**：Laravel的`DB::transaction()`方法会自动处理事务的开启、提交和回滚，但如果使用原生SQL，需特别注意autocommit状态。

### 坑三：DDL语句导致隐式提交

**问题描述**：MySQL中执行DDL（Data Definition Language）语句会导致**隐式提交**当前事务，这是一个容易被忽视的行为。

```sql
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;

-- 以下DDL语句会导致隐式提交上面的UPDATE操作！
ALTER TABLE accounts ADD COLUMN remark VARCHAR(255);
-- 此时UPDATE已经被提交，无法回滚！

UPDATE accounts SET balance = balance + 100 WHERE id = 2;
ROLLBACK; -- 只能回滚第二条UPDATE，第一条已被DDL隐式提交
```

**会触发隐式提交的语句包括**：
- `ALTER TABLE`、`CREATE TABLE`、`DROP TABLE`、`RENAME TABLE`
- `CREATE INDEX`、`DROP INDEX`
- `TRUNCATE TABLE`
- `CREATE DATABASE`、`ALTER DATABASE`、`DROP DATABASE`
- `CREATE EVENT`、`ALTER EVENT`、`DROP EVENT`
- `CREATE FUNCTION`、`DROP FUNCTION`、`CREATE PROCEDURE`、`DROP PROCEDURE`
- `GRANT`、`REVOKE`、`SET PASSWORD`

**最佳实践**：将DDL操作放在单独的脚本或迁移文件中执行，永远不要在业务事务中混入DDL语句。

### 坑四：死锁（Deadlock）

**问题描述**：两个或多个事务互相持有对方需要的锁，形成循环等待，导致所有事务都无法继续执行。

```sql
-- 经典死锁场景：交叉更新
-- 事务A                              -- 事务B
START TRANSACTION;
START TRANSACTION;
UPDATE accounts SET balance=100
  WHERE id=1;  -- 持有id=1的行锁
                                        UPDATE accounts SET balance=200
                                          WHERE id=2;  -- 持有id=2的行锁
UPDATE accounts SET balance=100
  WHERE id=2;  -- ⏳ 等待id=2的锁（被事务B持有）
                                        UPDATE accounts SET balance=200
                                          WHERE id=1;  -- ⏳ 等待id=1的锁（被事务A持有）
-- 💥 死锁! MySQL检测到后自动回滚其中一个事务
-- ERROR 1213 (40001): Deadlock found when trying to get lock
```

**MySQL 死锁日志排查：**

```sql
-- 查看最近一次死锁信息
SHOW ENGINE INNODB STATUS\G
-- 关注 LATEST DETECTED DEADLOCK 部分

-- MySQL 8.0+ 查看当前锁信息
SELECT * FROM performance_schema.data_locks;
SELECT * FROM performance_schema.data_lock_waits;
```

**预防死锁的最佳实践：**

1. **固定加锁顺序**：所有事务按照相同的顺序（如主键升序）访问资源
2. **缩短事务持锁时间**：事务内只做必要的数据库操作
3. **使用合理的索引**：避免锁升级（行锁退化为表锁）
4. **设置锁等待超时**：`SET innodb_lock_wait_timeout = 5;`

```php
<?php

// ✅ 防死锁：固定按id升序加锁
DB::transaction(function () use ($id1, $id2) {
    $ids = [$id1, $id2];
    sort($ids); // 保证加锁顺序一致

    foreach ($ids as $id) {
        DB::table('accounts')
            ->where('id', $id)
            ->lockForUpdate()
            ->first();
        // 执行更新操作...
    }
});
```

### 坑五：锁等待超时（Lock Wait Timeout）

**问题描述**：一个事务等待获取锁的时间超过了`innodb_lock_wait_timeout`（默认50秒），MySQL会抛出错误终止等待。

```sql
-- ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction
```

**常见原因：**
- 长事务持锁不释放（如事务中调用了外部接口）
- 大批量更新导致长时间锁定
- 未提交的事务（忘记commit/rollback）

**排查方法：**

```sql
-- 查看当前所有连接的事务状态
SELECT
    trx_id,
    trx_state,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration_sec,
    trx_mysql_thread_id,
    trx_query,
    trx_rows_locked,
    trx_rows_modified
FROM information_schema.innodb_trx
ORDER BY trx_started;

-- 查看锁等待关系
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
```

**解决方案：**

```php
<?php

// 1. 设置合理的锁等待超时（不要使用默认的50秒）
DB::statement('SET SESSION innodb_lock_wait_timeout = 5');

// 2. 在Laravel中使用 lockForUpdate 时配合超时处理
try {
    DB::transaction(function () use ($orderId) {
        $order = DB::table('orders')
            ->where('id', $orderId)
            ->lockForUpdate()
            ->first();

        if (!$order) {
            throw new \RuntimeException('订单不存在');
        }

        DB::table('orders')
            ->where('id', $orderId)
            ->update(['status' => 'processed']);
    });
} catch (\PDOException $e) {
    if ($e->getCode() == '1205') {
        // 锁等待超时，可以重试或返回友好提示
        Log::warning("锁等待超时，订单ID: {$orderId}");
        throw new \RuntimeException('系统繁忙，请稍后重试');
    }
    throw $e;
}
```

### 坑六：可重复读下的幻读陷阱

**问题描述**：即使在可重复读隔离级别下，如果先执行快照读再执行当前读，仍可能出现幻读。

```sql
-- 事务A（可重复读）                     -- 事务B
START TRANSACTION;
START TRANSACTION;
SELECT * FROM orders WHERE user_id=1;
-- 结果: 3条记录（快照读，走MVCC）
                                        INSERT INTO orders (user_id, amount)
                                          VALUES (1, 500);
                                        COMMIT;
SELECT * FROM orders WHERE user_id=1;
-- 结果: 3条记录（仍然是同一个Read View）
-- 看起来没有幻读 ✓

UPDATE orders SET status='checked'
  WHERE user_id=1 AND status='pending';
-- 影响行数: 4 ← 包括事务B新插入的那行！

SELECT * FROM orders WHERE user_id=1;
-- 结果: 4条记录 ← 幻读! 刚才还是3条，现在变成了4条
COMMIT;
```

**原因分析**：
1. 第一次`SELECT`是快照读，通过MVCC读到旧版本，看不到新插入的行
2. `UPDATE`是当前读，读取的是数据的最新版本，因此会操作到新插入的行
3. 第二次`SELECT`也是快照读，但因为本事务已经修改了该行（UPDATE触发了当前读），Read View会包含自己的修改

**解决方案**：

```sql
-- ✅ 使用 SELECT ... FOR UPDATE 将快照读升级为当前读
START TRANSACTION;
SELECT * FROM orders WHERE user_id=1 FOR UPDATE;
-- 当前读 + 加排他锁，阻塞其他事务插入
-- 此时事务B的INSERT会被阻塞直到事务A提交
COMMIT;
```

## 相关阅读

- [MySQL - 锁](/categories/Databases/locking/) — InnoDB锁机制详解：共享锁/排他锁、Record Lock/Gap Lock/Next-Key Lock、死锁排查与预防
- [MySQL - MVCC](/categories/Databases/mvcc-1/) — MVCC多版本并发控制深入解析：ReadView结构、可见性判断算法、purge清理机制
- [数据库读写分离实战](/categories/Databases/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication/) — Laravel中间件 + MySQL主从复制配置，事务内强制主库等核心踩坑点

