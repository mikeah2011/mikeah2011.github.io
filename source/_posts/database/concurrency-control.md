---

title: MySQL 并发控制：乐观锁、悲观锁与 MVCC 原理
keywords: [MySQL, MVCC, 并发控制, 乐观锁, 悲观锁与, 原理, 数据库]
tags:
- MySQL
- 并发控制
- 锁机制
- 事务
- InnoDB
- 乐观锁
- 悲观锁
categories:
  - database
date: 2019-03-20 15:05:07
description: 并发控制是数据库保障数据一致性的核心机制。本文全面解析MySQL InnoDB并发控制原理，包括悲观锁（行锁、间隙锁、Next-Key Lock）与乐观锁（版本号机制）的对比与选型，事务隔离级别（读未提交到串行化）对脏读、不可重复读、幻读的影响，死锁检测与预防策略，以及Laravel框架中lockForUpdate、乐观锁重试、Redis分布式锁等实战代码示例与踩坑经验。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-013-content-1.jpg
- /images/content/databases-013-content-2.jpg
---




Mysql内部通过锁机制实现对资源的并发访问控制，保证数据的一致性，锁机制的类型和引擎的种类有关，MyISAM中默认支持的表级锁有两种：共享读锁和独占写锁。表级锁在MyISAM和InnoDB的存储引擎中都支持，但是InnoDB默认支持的是行锁。

#### MyISAM锁机制

Mysql中可以通过以下sql来显示的在事务中显式的进行加锁和解锁操作：

```sql
// 显式的添加表级读锁
LOCK TABLE 表名 READ
// 显示的添加表级写锁
LOCK TABLE 表名 WRITE
// 显式的解锁（当一个事务commit的时候也会自动解锁）
unlock tables;
```

（1）MyISAM表级写锁：当一个线程获取到表级写锁后，只能由该线程对表进行读写操作，别的线程必须等待该线程释放锁以后才能操作。

（2）MyISAM表级共享读锁：当一个线程获取到表级读锁后，该线程只能读取数据不能修改数据，其它线程也只能加读锁，不能加写锁。

![MySQL并发控制 - 锁机制](/images/content/databases-013-content-1.jpg)

#### InnoDB锁机制

InnoDB和MyISAM不同的是，InnoDB支持行锁和事务，InnoDB中除了有表锁和行级锁的概念，还有Gap Lock（间隙锁）、Next-key Lock锁，间隙锁主要用于范围查询的时候，锁住查询的范围，并且间隙锁也是解决幻读的方案。

InnoDB中的行级锁是对索引加的锁，在不通过索引查询数据的时候，InnoDB就会使用表锁。

但是通过索引查询的时候是否使用索引，还要看Mysql的执行计划，Mysql的优化器会判断是一条sql执行的最佳策略。

若是Mysql觉得执行索引查询还不如全表扫描速度快，那么Mysql就会使用全表扫描来查询，这是即使sql语句中使用了索引，最后还是执行为全表扫描，加的是表锁。

![InnoDB行锁与索引](/images/content/databases-013-content-2.jpg)

## 并发问题概述

在数据库并发环境下，多个事务同时操作共享数据时，可能会产生以下三类典型问题：

### 脏读（Dirty Read）

脏读是指一个事务读取到了另一个事务尚未提交的数据。如果那个事务回滚，那么读到的数据就是无效的。

```sql
-- 事务A
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- 此时事务A尚未提交

-- 事务B（在READ UNCOMMITTED隔离级别下）
START TRANSACTION;
SELECT balance FROM accounts WHERE id = 1;
-- 读到了事务A未提交的修改（脏数据）
COMMIT;

-- 事务A回滚
ROLLBACK;
-- 事务B读到的数据实际上是不存在的！
```

### 不可重复读（Non-Repeatable Read）

不可重复读是指在同一事务中，两次读取同一行数据得到的结果不一致，原因是另一个事务在两次读取之间修改了该行数据。

```sql
-- 事务A
START TRANSACTION;
SELECT balance FROM accounts WHERE id = 1;  -- 结果为 1000

-- 此时事务B修改并提交了数据
-- UPDATE accounts SET balance = 900 WHERE id = 1; COMMIT;

SELECT balance FROM accounts WHERE id = 1;  -- 结果为 900
-- 同一事务中两次读取结果不一致
COMMIT;
```

### 幻读（Phantom Read）

幻读是指在同一事务中，两次范围查询返回的记录行数不一致，原因是另一个事务在两次查询之间插入或删除了满足条件的记录。

```sql
-- 事务A
START TRANSACTION;
SELECT COUNT(*) FROM accounts WHERE balance > 500;  -- 结果为 5 条

-- 此时事务B插入了新记录并提交
-- INSERT INTO accounts (id, balance) VALUES (10, 800); COMMIT;

SELECT COUNT(*) FROM accounts WHERE balance > 500;  -- 结果为 6 条
-- 同一事务中两次统计结果不一致，"幻影"行出现了
COMMIT;
```

## 事务隔离级别

SQL标准定义了四种事务隔离级别，从低到高依次为：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|:---|:---:|:---:|:---:|
| READ UNCOMMITTED（读未提交） | ✗ 可能发生 | ✗ 可能发生 | ✗ 可能发生 |
| READ COMMITTED（读已提交） | ✓ 可防止 | ✗ 可能发生 | ✗ 可能发生 |
| REPEATABLE READ（可重复读） | ✓ 可防止 | ✓ 可防止 | △ InnoDB通过MVCC+间隙锁可防止 |
| SERIALIZABLE（串行化） | ✓ 可防止 | ✓ 可防止 | ✓ 可防止 |

MySQL默认的隔离级别是 **REPEATABLE READ**，InnoDB引擎通过MVCC（多版本并发控制）和间隙锁在该级别下也能有效防止幻读。

可以通过以下SQL查看和设置隔离级别：

```sql
-- 查看当前隔离级别
SELECT @@transaction_isolation;

-- 设置当前会话的隔离级别
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 设置全局隔离级别
SET GLOBAL TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

**各隔离级别说明：**

- **READ UNCOMMITTED**：最低的隔离级别，事务可以读取其他事务未提交的数据，几乎不加锁，性能最好但数据一致性最差，实际项目中极少使用。
- **READ COMMITTED**：事务只能读取已提交的数据，可以防止脏读，但无法防止不可重复读。Oracle的默认隔离级别，互联网项目中较常使用。
- **REPEATABLE READ**：MySQL的默认隔离级别，保证同一事务中多次读取结果一致。InnoDB通过MVCC实现快照读，通过间隙锁+Next-Key Lock实现当前读时防止幻读。
- **SERIALIZABLE**：最高的隔离级别，所有事务串行执行，完全避免并发问题，但性能最差，一般只在对数据一致性要求极高的场景下使用。

## InnoDB行锁详解

InnoDB支持行级锁，并发性能优于MyISAM的表锁。InnoDB的行锁分为以下几种类型：

### 共享锁（S Lock）与排他锁（X Lock）

- **共享锁（Shared Lock）**：允许持有锁的事务读取数据行，其他事务也可以获取共享锁，但不能获取排他锁。
- **排他锁（Exclusive Lock）**：允许持有锁的事务读写数据行，其他事务无法获取任何类型的锁。

兼容性矩阵：

| 请求\已持有 | S Lock | X Lock |
|:---|:---:|:---:|
| S Lock | ✓ 兼容 | ✗ 冲突 |
| X Lock | ✗ 冲突 | ✗ 冲突 |

### 意向锁（Intention Lock）

InnoDB支持多粒度锁（行锁和表锁共存），意向锁是表级锁，用于表明事务稍后需要对表中的某行加哪种锁：

- **IS（Intention Shared Lock）**：事务打算对表中的某些行加S锁，需要先获取表级IS锁。
- **IX（Intention Exclusive Lock）**：事务打算对表中的某些行加X锁，需要先获取表级IX锁。

意向锁之间不会冲突，意向锁只与表锁冲突（例如加表锁前需要检查意向锁）。

### SQL中的行锁使用

```sql
-- 加排他锁（X Lock）：适用于需要更新数据的场景
-- 其他事务无法对该行加任何锁
START TRANSACTION;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;

-- 加共享锁（S Lock）：适用于只需要读取数据的场景
-- 其他事务可以加S锁但不能加X锁
START TRANSACTION;
SELECT * FROM accounts WHERE id = 1 LOCK IN SHARE MODE;
-- 只读操作...
COMMIT;
```

### 间隙锁（Gap Lock）与Next-Key Lock

- **间隙锁（Gap Lock）**：锁定索引记录之间的间隙，防止其他事务在间隙中插入数据。间隙锁只在REPEATABLE READ及以上隔离级别生效。
- **Next-Key Lock**：行锁+间隙锁的组合，锁定索引记录及其前面的间隙。InnoDB默认使用Next-Key Lock来防止幻读。

```sql
-- 假设表中id索引的值为：1, 5, 10, 15

-- 事务A：范围查询加锁
START TRANSACTION;
SELECT * FROM accounts WHERE id BETWEEN 5 AND 10 FOR UPDATE;
-- 此时会锁定 [5, 10] 范围的记录以及间隙 (1, 5) 和 (10, 15)

-- 事务B：尝试插入到间隙中
INSERT INTO accounts (id, balance) VALUES (7, 500);
-- 会被阻塞，因为id=7落在被锁定的间隙中

INSERT INTO accounts (id, balance) VALUES (12, 500);
-- 会被阻塞，因为id=12落在被锁定的间隙中

INSERT INTO accounts (id, balance) VALUES (3, 500);
-- 不会被阻塞，因为id=3不在被锁定的间隙中
COMMIT;
```

### InnoDB行锁的注意事项

InnoDB的行锁是加在**索引**上的，如果没有使用索引条件查询，InnoDB会退化为表锁：

```sql
-- 假设name字段没有索引
SELECT * FROM users WHERE name = 'Tom' FOR UPDATE;
-- 由于name没有索引，InnoDB会对整张表加锁，而非行锁
```

因此，**合理建立索引是使用行锁的前提**。

## 死锁

### 什么是死锁

死锁是指两个或多个事务在执行过程中，因互相等待对方持有的锁资源而陷入无限等待的状态。MySQL中的InnoDB存储引擎能够自动检测死锁并回滚其中一个事务来打破死锁。

### 死锁示例

以下是一个经典的两个事务死锁场景：

```sql
-- 事务A
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- 获取id=1的X锁

-- 事务B
START TRANSACTION;
UPDATE accounts SET balance = balance - 50 WHERE id = 2;   -- 获取id=2的X锁

-- 事务A继续操作（尝试获取id=2的X锁，被事务B持有，阻塞等待）
UPDATE accounts SET balance = balance + 100 WHERE id = 2;

-- 事务B继续操作（尝试获取id=1的X锁，被事务A持有，阻塞等待）
UPDATE accounts SET balance = balance + 50 WHERE id = 1;
-- 此时形成死锁！事务A等事务B释放id=2的锁，事务B等事务A释放id=1的锁
-- InnoDB会检测到死锁并自动回滚其中一个事务
```

### 检测死锁

可以通过以下方式检测死锁：

```sql
-- 查看InnoDB引擎状态，包含最近一次死锁的详细信息
SHOW ENGINE INNODB STATUS;

-- 查看锁等待情况
SELECT * FROM information_schema.INNODB_LOCK_WAITS;

-- 查看当前持有的锁
SELECT * FROM information_schema.INNODB_LOCKS;

-- 查看当前运行的事务
SELECT * FROM information_schema.INNODB_TRX;
```

在InnoDB状态输出的 `LATEST DETECTED DEADLOCK` 部分可以看到死锁的详细信息，包括涉及的事务、等待的锁以及导致死锁的SQL语句。

### 预防死锁的方法

1. **固定加锁顺序**：所有事务按照相同的顺序访问表和行，例如始终按照主键id从小到大的顺序加锁。
2. **减小事务粒度**：缩短事务持锁时间，避免在事务中执行耗时操作（如远程调用、文件IO等）。
3. **使用合理的索引**：确保查询命中索引，避免行锁升级为表锁，减少锁冲突的范围。
4. **设置锁等待超时**：通过 `innodb_lock_wait_timeout` 参数设置锁等待超时时间，避免长时间等待。
5. **使用低隔离级别**：在业务允许的情况下使用READ COMMITTED隔离级别，减少间隙锁的使用。

```sql
-- 设置锁等待超时（默认50秒）
SET GLOBAL innodb_lock_wait_timeout = 10;

-- 开启死锁检测（默认开启）
SET GLOBAL innodb_deadlock_detect = ON;
```

## 最佳实践

以下是针对Laravel框架开发者的锁使用建议：

### 1. 使用悲观锁（Pessimistic Lock）

在需要更新数据时，使用 `lockForUpdate()` 方法加排他锁，防止并发更新导致数据不一致：

```php
// Laravel中使用悲观锁
DB::transaction(function () {
    $account = DB::table('accounts')
        ->where('id', 1)
        ->lockForUpdate()  // SELECT ... FOR UPDATE
        ->first();

    DB::table('accounts')
        ->where('id', 1)
        ->update(['balance' => $account->balance - 100]);
});
```

### 2. 使用共享锁

在只读场景中使用 `sharedLock()` 防止数据被其他事务修改：

```php
DB::transaction(function () {
    $account = DB::table('accounts')
        ->where('id', 1)
        ->sharedLock()  // SELECT ... LOCK IN SHARE MODE
        ->first();

    // 只读操作...
});
```

### 3. 使用乐观锁（Optimistic Lock）

对于读多写少的场景，可以使用乐观锁代替悲观锁，通过版本号字段实现：

```php
$version = DB::table('accounts')->where('id', 1)->value('version');

$affected = DB::table('accounts')
    ->where('id', 1)
    ->where('version', $version)
    ->update([
        'balance' => DB::raw('balance - 100'),
        'version' => DB::raw('version + 1')
    ]);

if ($affected === 0) {
    // 更新失败，说明数据被其他事务修改，需要重试
    throw new OptimisticLockException('数据已被其他事务修改，请重试');
}
```

### 4. 使用原子操作减少锁竞争

对于计数器等场景，使用数据库的原子操作减少锁持有时间：

```php
// 好的做法：使用原子操作
DB::table('accounts')
    ->where('id', 1)
    ->update(['balance' => DB::raw('balance - 100')]);

// 不好的做法：先查再改（存在并发问题）
$balance = DB::table('accounts')->where('id', 1)->value('balance');
DB::table('accounts')->where('id', 1)->update(['balance' => $balance - 100]);
```

### 5. 使用分布式锁

对于跨服务的并发控制，可以使用Redis分布式锁：

```php
use Illuminate\Support\Facades\Cache;

$lock = Cache::lock('account_lock_' . $accountId, 10);

if ($lock->get()) {
    try {
        // 执行业务逻辑
    } finally {
        $lock->release();
    }
} else {
    // 获取锁失败，可选择重试或返回错误
}
```

### 6. 控制事务范围

```php
// 好的做法：事务范围尽量小
DB::transaction(function () {
    $data = DB::table('orders')->lockForUpdate()->where('id', 1)->first();
    DB::table('orders')->where('id', 1)->update(['status' => 'paid']);
});

// 不好的做法：事务中包含耗时操作
DB::transaction(function () {
    $data = DB::table('orders')->lockForUpdate()->where('id', 1)->first();
    // 发送邮件（不应该放在锁事务中！）
    Mail::to('user@example.com')->send(new OrderPaid($data));
    DB::table('orders')->where('id', 1)->update(['status' => 'paid']);
});
```

## 乐观锁 vs 悲观锁对比

在实际项目中，选择合适的锁策略至关重要。以下是两种策略的详细对比：

| 对比维度 | 悲观锁（Pessimistic Lock） | 乐观锁（Optimistic Lock） |
|:---|:---|:---|
| **实现方式** | 数据库层面 `SELECT ... FOR UPDATE` / `LOCK IN SHARE MODE` | 应用层面通过版本号（version）或时间戳字段 |
| **加锁时机** | 读取数据时就加锁，阻塞其他事务 | 不加锁，更新时检查版本号是否变化 |
| **冲突处理** | 阻塞等待，直到锁释放 | 更新失败后重试或报错 |
| **适用场景** | 写多读少、冲突频繁 | 读多写少、冲突较少 |
| **并发性能** | 冲突多时性能下降明显 | 冲突少时性能优秀 |
| **死锁风险** | 存在死锁风险，需要注意加锁顺序 | 无死锁风险 |
| **数据一致性** | 强一致性保证 | 最终一致性，需配合重试机制 |
| **典型实现** | MySQL `FOR UPDATE`、`LOCK IN SHARE MODE` | version字段 + WHERE条件校验 |

### 踩坑案例：乐观锁并发库存扣减

以下是一个典型的库存扣减场景，展示乐观锁和悲观锁两种实现方式的对比：

**悲观锁实现（适合高并发写入场景）：**

```sql
-- 场景：秒杀库存扣减，需要严格保证不超卖
-- 建表
CREATE TABLE products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 0,
    INDEX idx_stock (stock)
) ENGINE=InnoDB;

-- 插入测试数据
INSERT INTO products (name, stock) VALUES ('限量手机', 10);

-- 悲观锁实现：使用FOR UPDATE锁定行，防止并发超卖
START TRANSACTION;
SELECT stock FROM products WHERE id = 1 FOR UPDATE;
-- 假设查询结果 stock = 1，判断库存充足
UPDATE products SET stock = stock - 1 WHERE id = 1 AND stock > 0;
COMMIT;
-- 如果两个事务同时执行，第二个事务会等待第一个事务提交后才执行
```

**乐观锁实现（适合读多写少场景）：**

```sql
-- 乐观锁：通过version字段控制并发
-- 第一步：读取当前版本号
SELECT id, stock, version FROM products WHERE id = 1;
-- 假设返回：stock=10, version=1

-- 第二步：更新时带版本号条件
UPDATE products
SET stock = stock - 1, version = version + 1
WHERE id = 1 AND version = 1;

-- 检查affected rows，如果为0说明被其他事务修改，需要重试
-- 在应用层实现重试逻辑（最多重试3次）
```

**Java/Spring实现乐观锁重试：**

```java
@Service
public class ProductService {
    @Autowired
    private ProductMapper productMapper;

    @Transactional
    public void deductStock(Long productId, int quantity) {
        int maxRetries = 3;
        for (int i = 0; i < maxRetries; i++) {
            Product product = productMapper.selectById(productId);
            if (product.getStock() < quantity) {
                throw new BusinessException("库存不足");
            }
            int affected = productMapper.deductStock(
                productId, quantity, product.getVersion()
            );
            if (affected > 0) {
                return; // 更新成功
            }
            // affected == 0，版本冲突，重试
        }
        throw new BusinessException("操作频繁，请稍后重试");
    }
}
```

### 踩坑案例：间隙锁导致的插入阻塞

在RR隔离级别下，范围查询的 `FOR UPDATE` 会产生间隙锁，导致看似不相关的插入操作被阻塞：

```sql
-- 表结构：orders 表，id 为主键，有数据 id=1,5,10,15

-- 事务A：范围查询加锁
START TRANSACTION;
SELECT * FROM orders WHERE id BETWEEN 5 AND 10 FOR UPDATE;
-- 锁定范围：[5, 10] 的行锁 + 间隙 (1,5) 和 (10,15) 的间隙锁

-- 事务B（另一个连接）：
INSERT INTO orders (id, amount) VALUES (3, 100);  -- 被阻塞！id=3在间隙(1,5)中
INSERT INTO orders (id, amount) VALUES (7, 200);  -- 被阻塞！id=7在[5,10]范围内
INSERT INTO orders (id, amount) VALUES (12, 300); -- 被阻塞！id=12在间隙(10,15)中
INSERT INTO orders (id, amount) VALUES (20, 400); -- 正常执行，不在锁定范围

-- 踩坑解决：将隔离级别改为 READ COMMITTED 可消除间隙锁
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

### 踩坑案例：行锁升级为表锁

```sql
-- 表结构：users 表，name 字段没有索引
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50),
    age INT
) ENGINE=InnoDB;

-- 事务A：通过无索引字段加锁
START TRANSACTION;
SELECT * FROM users WHERE name = 'Tom' FOR UPDATE;
-- name 没有索引，InnoDB 会对整张表加锁！

-- 事务B（另一个连接）：更新完全不同的行也会被阻塞
UPDATE users SET age = 30 WHERE id = 999;  -- 被阻塞！因为整张表被锁

-- 解决方案：给 name 字段添加索引
ALTER TABLE users ADD INDEX idx_name (name);
-- 添加索引后，事务A只会锁定 name='Tom' 的行
```

## 相关阅读

- [MySQL - MVCC](/categories/Databases/mvcc-1/)
- [MySQL - 锁](/categories/Databases/locking/)
- [MySQL高并发](/categories/Databases/high-concurrency/)