---
title: 'PostgreSQL 事务隔离级别实战：Read Committed vs Repeatable Read vs Serializable——Laravel 中的幻读、不可重复读与死锁治理'
date: 2026-06-06 18:00:00
tags: [PostgreSQL, 事务隔离, Laravel, 并发控制, 死锁]
keywords: [PostgreSQL, Read Committed vs Repeatable Read vs Serializable, Laravel, 事务隔离级别实战, 中的幻读, 不可重复读与死锁治理, 数据库]
description: 深入解析 PostgreSQL 四种事务隔离级别（Read Committed、Repeatable Read、Serializable）的行为差异与内部实现原理。通过可运行的 SQL 演示脏读、不可重复读和幻读问题，深度解析 PostgreSQL 独有的 SSI 快照隔离机制，并给出 Laravel 中切换隔离级别、配置重试机制、治理死锁的完整实战方案。适合从 MySQL 迁移到 PostgreSQL 的开发者，帮助你在高并发场景中正确选择隔离级别，避免数据不一致和死锁问题。
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---


# PostgreSQL 事务隔离级别实战：Read Committed vs Repeatable Read vs Serializable——Laravel 中的幻读、不可重复读与死锁治理

## 前言

在高并发 Web 应用中，数据库事务隔离级别是一个被频繁讨论却又常被误解的话题。很多开发者知道"四种隔离级别"这个概念，却在实际开发中对它们的差异、适用场景以及在具体框架中的配置方式一知半解。尤其是当团队从 MySQL InnoDB 迁移到 PostgreSQL 时，往往会发现"同样的隔离级别，行为却不完全一样"——这是因为两个数据库在实现层面存在本质性的差异。

作为一名 Laravel 开发者，你可能每天都在使用 `DB::transaction()` 包裹业务逻辑，但你是否真正理解事务隔离级别背后的机制？当出现诡异的数据不一致、对账差异或者死锁报错时，你是否能够快速定位问题根因并给出有效的修复方案？这些问题在高并发系统中频繁出现，而且往往在测试环境中难以复现，只有在生产环境的并发压力下才会暴露。

本文将从原理出发，结合 PostgreSQL 的实际行为，深入探讨四种事务隔离级别的核心机制，用可运行的 SQL 演示脏读、不可重复读和幻读问题，深度解析 PostgreSQL 独有的 Serializable Snapshot Isolation（SSI）机制，并给出在 Laravel 中切换隔离级别、治理死锁的完整实战方案。

阅读本文后，你将能够：理解 PostgreSQL 各隔离级别的内部实现原理；准确判断你的业务场景应该使用哪种隔离级别；在 Laravel 中正确地配置和切换隔离级别；有效地预防和处理死锁问题；以及掌握真实生产环境中经过验证的最佳实践。


---

## 一、理论基础：四种事务隔离级别

SQL 标准定义了四种事务隔离级别，从低到高依次为：

需要强调的是，这四种隔离级别是 SQL-92 标准的理论定义，不同数据库的实际实现可能会超出标准的描述范围。例如 PostgreSQL 在 Repeatable Read 级别就能避免幻读，这在标准中是不允许的。理解标准定义和实际实现之间的差异，是避免踩坑的关键。

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---|---|---|---|
| Read Uncommitted | ✅ 可能 | ✅ 可能 | ✅ 可能 |
| Read Committed | ❌ 不会 | ✅ 可能 | ✅ 可能 |
| Repeatable Read | ❌ 不会 | ❌ 不会 | ✅ 可能（标准定义） |
| Serializable | ❌ 不会 | ❌ 不会 | ❌ 不会 |

这里的"标准定义"指的是 SQL-92 标准。但在实际数据库实现中，PostgreSQL 和 MySQL InnoDB 都有一些超出标准的行为。

### 1.1 脏读（Dirty Read）

脏读指的是一个事务读取到了另一个尚未提交的事务写入的数据。如果那个事务最终回滚，读到的数据就变成了"脏数据"——它从未真正存在于数据库中。

### 1.2 不可重复读（Non-Repeatable Read）

在同一事务中，两次读取同一行数据，结果不一致。原因是两次读之间，另一个事务修改了该行并提交了。

### 1.3 幻读（Phantom Read）

在同一事务中，两次执行相同的范围查询，返回的行数不一致。原因是两次查询之间，另一个事务插入或删除了满足条件的行。

---

## 二、PostgreSQL vs MySQL InnoDB：关键实现差异

### 2.1 PostgreSQL 的隔离级别实现

PostgreSQL 的隔离级别实现有一个显著特点：**它不支持真正的 Read Uncommitted 级别**。当你在 PostgreSQL 中设置 `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED` 时，实际行为等同于 `READ COMMITTED`。这是 PostgreSQL 的设计决策，因为它的 MVCC 实现天然就不会产生脏读。

```
-- PostgreSQL 中设置 READ UNCOMMITTED，实际等同于 READ COMMITTED
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
-- 此事务的实际行为是 READ COMMITTED
SELECT * FROM accounts WHERE id = 1;
COMMIT;
```

PostgreSQL 使用 MVCC（Multi-Version Concurrency Control）机制：每次写操作都会创建行的新版本（tuple），而不是直接覆盖旧数据。读操作通过快照（snapshot）看到的是一致性视图，不会读到未提交的数据。

### 2.2 MySQL InnoDB 的隔离级别实现

MySQL InnoDB 同样使用 MVCC，但实现方式有所不同：

- **Read Committed**：每条 SQL 语句执行时创建新的快照（语句级快照）。
- **Repeatable Read**：事务开始时创建快照，整个事务期间复用（事务级快照）。InnoDB 的默认级别。
- **Serializable**：在 Repeatable Read 基础上，将所有 SELECT 隐式转换为 `SELECT ... LOCK IN SHARE MODE`。

**关键差异总结：**

| 特性 | PostgreSQL | MySQL InnoDB |
|---|---|---|
| 默认隔离级别 | Read Committed | Repeatable Read |
| Read Uncommitted | 退化为 Read Committed | 真正的脏读 |
| RR 级别下是否能幻读 | 不能（快照隔离） | 不能（Next-Key Lock） |
| Serializable 实现 | SSI（乐观并发控制） | 隐式加锁（悲观并发控制） |
| MVCC 快照粒度 | 语句级快照（RC）/ 事务级快照（RR） | 同左，但实现细节不同 |

这个差异非常重要。PostgreSQL 在 Read Committed 级别使用**语句级快照**——每条 SELECT 语句都会看到该语句开始执行时的最新已提交数据。而在 Repeatable Read 级别，PostgreSQL 使用**事务级快照**——事务中第一条读取语句创建的快照在整个事务期间有效。

---

## 三、实战演示：脏读、不可重复读与幻读

下面用 PostgreSQL 实际演示这三种并发问题。你需要两个终端窗口（模拟两个并发事务）。

### 3.0 准备测试表

```sql
-- 创建测试表
CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    balance NUMERIC(12, 2) NOT NULL DEFAULT 0
);

INSERT INTO accounts (name, balance) VALUES
    ('Alice', 10000.00),
    ('Bob', 5000.00),
    ('Charlie', 8000.00);

-- 创建用于幻读演示的订单表
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    amount NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO orders (account_id, amount) VALUES
    (1, 100.00),
    (1, 200.00),
    (2, 300.00);
```

### 3.1 不可重复读演示（Read Committed）

PostgreSQL 默认隔离级别就是 Read Committed，在这个级别下会出现不可重复读。

**终端 1（事务 A）：**
```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 第一次读取：Alice 的余额是 10000
SELECT balance FROM accounts WHERE name = 'Alice';
-- 结果：10000.00

-- 等待终端 2 更新并提交...
--（手动等待几秒）

-- 第二次读取：余额变成了 9000！
SELECT balance FROM accounts WHERE name = 'Alice';
-- 结果：9000.00

COMMIT;
```

**终端 2（事务 B）：**
```sql
BEGIN;
UPDATE accounts SET balance = 9000.00 WHERE name = 'Alice';
COMMIT;
```

**结果分析：** 在 Read Committed 级别，事务 A 的两次 SELECT 看到了不同的结果。因为 PostgreSQL 的 Read Committed 使用**语句级快照**，每条 SELECT 都会刷新快照，读取最新的已提交数据。

### 3.2 不可重复读在 Repeatable Read 下的解决

**终端 1（事务 A）：**
```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- 第一次读取
SELECT balance FROM accounts WHERE name = 'Alice';
-- 结果：10000.00

-- 等待终端 2 更新并提交...

-- 第二次读取：仍然是 10000！快照隔离生效
SELECT balance FROM accounts WHERE name = 'Alice';
-- 结果：10000.00

COMMIT;
```

**终端 2（事务 B）：**
```sql
BEGIN;
UPDATE accounts SET balance = 9000.00 WHERE name = 'Alice';
COMMIT;
```

**结果分析：** 在 Repeatable Read 级别，事务 A 在第一次 SELECT 时创建了快照，后续所有 SELECT 都复用这个快照，所以看到的始终是 10000。

### 3.3 幻读演示（Read Committed）

**终端 1（事务 A）：**
```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 统计 Alice 的订单数
SELECT COUNT(*) FROM orders WHERE account_id = 1;
-- 结果：2

-- 等待终端 2 插入新订单...

-- 再次统计：出现了"幻影"行
SELECT COUNT(*) FROM orders WHERE account_id = 1;
-- 结果：3

COMMIT;
```

**终端 2（事务 B）：**
```sql
BEGIN;
INSERT INTO orders (account_id, amount) VALUES (1, 500.00);
COMMIT;
```

### 3.4 幻读在 Repeatable Read 下的行为（PostgreSQL 特殊行为）

SQL 标准规定 Repeatable Read 级别允许幻读。但 PostgreSQL 的 RR 级别基于快照隔离，实际上**不会出现幻读**：

**终端 1（事务 A）：**
```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

SELECT COUNT(*) FROM orders WHERE account_id = 1;
-- 结果：2

-- 等待终端 2 插入新订单...

SELECT COUNT(*) FROM orders WHERE account_id = 1;
-- 结果：2（没有幻读！）

COMMIT;
```

**终端 2（事务 B）：**
```sql
BEGIN;
INSERT INTO orders (account_id, amount) VALUES (1, 600.00);
COMMIT;
```

**这是 PostgreSQL 与 MySQL InnoDB 的一个重要相似点：** 两者的 RR 级别都解决了幻读问题，但实现机制不同。PostgreSQL 依赖快照隔离，InnoDB 依赖 Next-Key Lock。

### 3.5 写-写冲突演示（Repeatable Read 下的更新冲突）

PostgreSQL 的 RR 级别在处理写-写冲突时有一个需要特别注意的行为：

**终端 1（事务 A）：**
```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- 读取余额（创建快照）
SELECT balance FROM accounts WHERE name = 'Alice';
-- 结果：10000.00

-- 等待终端 2 先更新...

-- 尝试更新：会发生什么？
UPDATE accounts SET balance = balance - 1000 WHERE name = 'Alice';
-- ERROR: could not serialize access due to concurrent update
-- 这是一个序列化错误！
COMMIT;
```

**终端 2（事务 B）：**
```sql
BEGIN;
UPDATE accounts SET balance = 9000.00 WHERE name = 'Alice';
COMMIT;
```

**关键行为差异：** 在 Read Committed 级别，PostgreSQL 会允许这个更新（读取已提交的最新值 9000 再减 1000，得到 8000）。但在 Repeatable Read 级别，PostgreSQL 会检测到冲突并抛出序列化错误，**强制应用层重试**。这个设计哲学非常重要——PostgreSQL 选择了一种"快速失败"的策略，而不是让事务静默等待或使用过时的数据。这种策略要求应用层必须具备完善的重试逻辑，但它避免了数据不一致的风险。

这个行为在 MySQL InnoDB 中完全不同——InnoDB 的 RR 级别会通过行锁让后到的更新等待先到的事务完成，而不是直接报错。

这种差异的根源在于两者的设计哲学不同：MySQL InnoDB 采用的是"阻塞式"并发控制，通过锁来协调并发访问；而 PostgreSQL 采用的是"乐观式"并发控制，假设冲突不常发生，遇到冲突时直接报错让应用层处理。两种方式各有利弊——阻塞式在高竞争场景下更容易产生死锁和长时间等待，乐观式则要求应用层有更完善的错误处理和重试机制。

---

## 四、PostgreSQL Serializable Snapshot Isolation (SSI) 深度解析

### 4.1 传统 Serializable 的问题

传统的 Serializable 实现（如 MySQL InnoDB）依赖锁机制——对读取的行加共享锁，对修改的行加排他锁。这种方式虽然能保证串行化，但会导致大量锁等待、死锁，严重降低并发性能。

### 4.2 SSI 的核心思想

PostgreSQL 从 9.1 版本开始引入 SSI（Serializable Snapshot Isolation）算法。SSI 是一种**乐观并发控制**方法，其核心思想是：

1. 基于快照隔离运行（与 RR 级别相同的快照机制）
2. **不加读锁**——读操作不会阻塞写操作
3. 通过追踪**读写依赖关系**（rw-dependency）检测潜在的序列化异常
4. 当检测到可能破坏序列化性的依赖环时，中止其中一个事务

SSI 维护两个关键数据结构：

- **InFrom**：记录哪些事务写入了当前事务读取的数据（"我从谁那里读"）
- **OutTo**：记录当前事务写入的数据被哪些事务读取了（"谁从我这里读"）

当出现 `T1 → T2 → T1` 这样的 rw-dependency 环时，说明存在序列化异常，需要中止其中一个事务。

### 4.3 SSI 实战演示

**场景：** 两个事务交叉读取对方写入的数据，形成依赖环。

```sql
-- 准备数据
CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    product VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    warehouse VARCHAR(20) NOT NULL
);

INSERT INTO inventory (product, quantity, warehouse) VALUES
    ('Widget', 100, 'East'),
    ('Widget', 50, 'West');
```

**终端 1（事务 A）：**
```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- 读取东仓库存
SELECT quantity FROM inventory WHERE product = 'Widget' AND warehouse = 'East';
-- 结果：100

-- 等待终端 2 执行读取和写入...

-- 根据读到的值，写入西仓（交叉依赖：A 读了 East，B 读了 West）
UPDATE inventory SET quantity = quantity + 10
    WHERE product = 'Widget' AND warehouse = 'West';
-- 可能报错：ERROR: could not serialize access due to read/write dependencies

COMMIT;
```

**终端 2（事务 B）：**
```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- 读取西仓库存
SELECT quantity FROM inventory WHERE product = 'Widget' AND warehouse = 'West';
-- 结果：50

-- 写入东仓（交叉依赖：B 读了 West，A 读了 East）
UPDATE inventory SET quantity = quantity + 20
    WHERE product = 'Widget' AND warehouse = 'East';
COMMIT;
```

**结果分析：** 事务 A 读取了 East（100），事务 B 读取了 West（50）。然后事务 A 写入 West，事务 B 写入 East。这就形成了 `A → B → A` 的 rw-dependency 环——SSI 检测到这个环后，中止其中一个事务（通常是后提交的那个），抛出序列化错误。

### 4.4 SSI 的优势与代价

**优势：**
- 读操作不加锁，不会阻塞写操作
- 并发性能远优于传统的锁式 Serializable
- 能检测到所有可能破坏序列化性的并发模式

**代价：**
- 需要额外的内存来维护依赖信息
- 存在误判（false positive）：某些不会真正导致序列化异常的模式也会被中止
- 应用层必须具备重试逻辑
- 在写密集型的高竞争场景下，大量的序列化重试反而可能降低吞吐量
- 对长时间运行的事务不友好，事务越长，被中止的概率越高

**SSI 的适用场景总结：** SSI 最适合的是读多写少、事务时间短、对数据一致性有严格要求的场景。典型的应用包括财务对账、库存一致性校验、订单状态一致性保障等。对于写密集的热点行操作（如秒杀场景的库存扣减），SSI 并不是最佳选择，此时使用 Read Committed 加显式锁通常效果更好。

### 4.5 SSI 与传统锁式 Serializable 的对比

为了更好地理解 SSI 的优势，我们来对比一下 MySQL InnoDB 的 Serializable 实现方式。MySQL InnoDB 在 Serializable 级别下会将所有普通的 SELECT 语句隐式转换为 `SELECT ... LOCK IN SHARE MODE`，即对读取的行加共享锁。这意味着：

- 读操作会阻塞其他事务的写操作（因为共享锁和排他锁互斥）
- 写操作会阻塞其他事务的读操作
- 在读密集型场景下，这种锁竞争会严重影响并发性能

相比之下，PostgreSQL 的 SSI 在读取数据时完全不需要加锁，读操作通过 MVCC 快照获取一致性视图，写操作通过依赖追踪来判断是否存在冲突。只有当检测到序列化异常时才会中止事务。这种设计使得 PostgreSQL 的 Serializable 级别在大多数实际场景中都能保持接近 Repeatable Read 级别的性能表现。

---

## 五、Laravel 中的事务隔离级别配置

### 5.1 全局配置

在 Laravel 的 `config/database.php` 中，PostgreSQL 连接的默认隔离级别是 Read Committed：

```php
// config/database.php
'pgsql' => [
    'driver' => 'pgsql',
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '5432'),
    'database' => env('DB_DATABASE', 'forge'),
    'username' => env('DB_USERNAME', 'forge'),
    'password' => env('DB_PASSWORD', ''),
    'charset' => 'utf8',
    'prefix' => '',
    'search_path' => 'public',
    'sslmode' => 'prefer',
    // 默认不设置隔离级别，使用 PostgreSQL 的默认值（READ COMMITTED）
],
```

### 5.2 在事务中设置隔离级别

#### 方法一：使用 `DB::transaction` 的第二个参数

```php
use Illuminate\Support\Facades\DB;

// 设置事务的最大尝试次数（Laravel 9+）
// 注意：DB::transaction 的第二个参数是 attempts，不是隔离级别
DB::transaction(function () {
    // 事务逻辑
}, 3); // 最多重试 3 次
```

#### 方法二：在事务开始前执行 SET TRANSACTION

这是设置隔离级别的推荐方式：

```php
use Illuminate\Support\Facades\DB;

DB::beginTransaction();

try {
    // 设置下一个事务的隔离级别
    DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');

    $balance = DB::table('accounts')
        ->where('name', 'Alice')
        ->value('balance');

    DB::table('accounts')
        ->where('name', 'Alice')
        ->decrement('balance', 1000);

    DB::commit();
} catch (\Exception $e) {
    DB::rollBack();
    throw $e;
}
```

**重要注意：** `SET TRANSACTION ISOLATION LEVEL` 必须在事务中的第一条查询语句之前执行。如果已经有查询执行过，设置不会生效（PostgreSQL 会报 WARNING）。

#### 方法三：通过连接配置设置默认隔离级别

```php
// config/database.php 中通过 options 设置
'pgsql' => [
    // ...其他配置
    'options' => [
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ],
],
```

或者在运行时通过连接层面设置：

```php
DB::connection()->getPdo()->exec(
    'SET SESSION default_transaction_isolation = \'repeatable read\''
);
```

### 5.3 封装隔离级别切换的 Service Provider

在大型项目中，建议封装一个专门的 Service Provider 或 Helper 来管理事务隔离级别：

```php
<?php

namespace App\Services\Database;

use Illuminate\Support\Facades\DB;

class TransactionManager
{
    /**
     * 在指定隔离级别下执行事务
     */
    public static function runInIsolationLevel(
        string $isolationLevel,
        callable $callback,
        int $attempts = 1,
        int $sleep = 0
    ): mixed {
        $validLevels = [
            'READ UNCOMMITTED',
            'READ COMMITTED',
            'REPEATABLE READ',
            'SERIALIZABLE',
        ];

        $isolationLevel = strtoupper($isolationLevel);
        if (!in_array($isolationLevel, $validLevels)) {
            throw new \InvalidArgumentException(
                "Invalid isolation level: {$isolationLevel}"
            );
        }

        $attempt = 0;

        beginTransaction:
        $attempt++;

        DB::beginTransaction();

        try {
            DB::statement(
                "SET TRANSACTION ISOLATION LEVEL {$isolationLevel}"
            );

            $result = $callback();

            DB::commit();

            return $result;
        } catch (\Exception $e) {
            DB::rollBack();

            // 检测序列化错误（PostgreSQL SQLSTATE 40001）
            if ($e->getCode() === '40001' && $attempt < $attempts) {
                if ($sleep > 0) {
                    usleep($sleep * 1000);
                }
                goto beginTransaction;
            }

            throw $e;
        }
    }

    /**
     * 便捷方法：在 Serializable 级别下执行
     */
    public static function serializable(callable $callback, int $attempts = 3): mixed
    {
        return static::runInIsolationLevel('SERIALIZABLE', $callback, $attempts, 100);
    }

    /**
     * 便捷方法：在 Repeatable Read 级别下执行
     */
    public static function repeatableRead(callable $callback, int $attempts = 3): mixed
    {
        return static::runInIsolationLevel('REPEATABLE READ', $callback, $attempts, 100);
    }
}
```

**使用示例：**

```php
use App\Services\Database\TransactionManager;

// 在 Serializable 级别下执行，最多重试 3 次
$result = TransactionManager::serializable(function () {
    $totalStock = DB::table('inventory')
        ->where('product', 'Widget')
        ->sum('quantity');

    if ($totalStock < 10) {
        throw new \RuntimeException('库存不足');
    }

    DB::table('inventory')
        ->where('product', 'Widget')
        ->where('warehouse', 'East')
        ->where('quantity', '>=', 10)
        ->decrement('quantity', 10);

    return $totalStock - 10;
});
```

### 5.4 通过中间件自动设置隔离级别

对于某些路由需要特定隔离级别的场景，可以创建中间件：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class SetTransactionIsolationLevel
{
    public function handle(Request $request, Closure $next, string $level = 'READ COMMITTED'): Response
    {
        DB::statement("SET TRANSACTION ISOLATION LEVEL {$level}");

        return $next($request);
    }
}
```

注册中间件并使用：

```php
// bootstrap/app.php (Laravel 11) 或 app/Http/Kernel.php (Laravel 10)

// 路由中使用
Route::middleware(['setTransactionIsolationLevel:REPEATABLE READ'])
    ->group(function () {
        Route::get('/report/generate', [ReportController::class, 'generate']);
    });
```

---

## 六、死锁的产生、检测与治理

### 6.1 什么是死锁

死锁是两个或多个事务互相等待对方释放锁资源的循环等待状态。在 PostgreSQL 中，死锁不仅发生在传统的锁模式下，在 Serializable 隔离级别下也可能因为 rw-dependency 环而产生等效的死锁。

### 6.2 死锁产生的经典场景

```sql
-- 场景：交叉更新

-- 终端 1
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE name = 'Alice';
-- 持有 Alice 行的排他锁
-- 等待终端 2...
UPDATE accounts SET balance = balance + 100 WHERE name = 'Bob';
-- 如果终端 2 已经锁定了 Bob 行，这里会等待 → 死锁！

-- 终端 2
BEGIN;
UPDATE accounts SET balance = balance - 50 WHERE name = 'Bob';
-- 持有 Bob 行的排他锁
UPDATE accounts SET balance = balance + 50 WHERE name = 'Alice';
-- 等待 Alice 行的锁 → 死锁！
```

### 6.3 PostgreSQL 的死锁检测

PostgreSQL 后台有一个 **Deadlock Detector** 进程（从 PostgreSQL 9.6 开始是独立的后台工作进程），默认每 1 秒检查一次死锁。检测算法基于**等待图（Wait-For Graph）**的环检测：

1. 构建一个有向图，节点是事务，边表示"事务 A 等待事务 B 持有的锁"
2. 检测图中是否存在环
3. 如果存在环，选择一个"牺牲者"事务并中止它
4. 牺牲者的选择基于：事务的优先级、已消耗的资源、已等待的时间

相关配置参数：

```sql
-- 查看当前死锁检测超时设置
SHOW deadlock_timeout;
-- 默认值：1s

-- 通常不需要修改，除非遇到性能问题
```

### 6.4 Laravel 中的死锁处理

Laravel 通过 `DB::transaction` 已经内置了重试机制，但针对死锁，需要更精细的处理：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;

class DeadlockRetryService
{
    /**
     * 带死锁重试的事务执行
     *
     * @param callable $callback
     * @param int $maxAttempts
     * @param int $backoffMs 每次重试的退避时间（毫秒）
     * @return mixed
     * @throws \Exception
     */
    public static function execute(
        callable $callback,
        int $maxAttempts = 3,
        int $backoffMs = 50
    ): mixed {
        $attempt = 0;
        $lastException = null;

        while ($attempt < $maxAttempts) {
            $attempt++;

            try {
                return DB::transaction($callback);
            } catch (QueryException $e) {
                // PostgreSQL 死锁错误码：40P01
                // PostgreSQL 序列化失败错误码：40001
                if (in_array($e->getCode(), ['40P01', '40001'])) {
                    $lastException = $e;

                    \Log::warning("Deadlock/serialization error on attempt {$attempt}, retrying...", [
                        'code' => $e->getCode(),
                        'message' => $e->getMessage(),
                    ]);

                    if ($attempt < $maxAttempts) {
                        // 指数退避
                        $sleep = $backoffMs * pow(2, $attempt - 1);
                        usleep($sleep * 1000);
                    }
                } else {
                    throw $e;
                }
            }
        }

        throw $lastException;
    }
}
```

**使用示例——电商转账场景：**

```php
use App\Services\DeadlockRetryService;

public function transfer(int $fromId, int $toId, float $amount): void
{
    // 关键优化：按固定顺序获取锁，避免死锁
    $first = min($fromId, $toId);
    $second = max($fromId, $toId);

    DeadlockRetryService::execute(function () use ($first, $second, $fromId, $amount) {
        // 按 ID 升序锁定行，确保所有事务获取锁的顺序一致
        DB::table('accounts')->where('id', $first)->lockForUpdate()->first();
        DB::table('accounts')->where('id', $second)->lockForUpdate()->first();

        $fromAccount = DB::table('accounts')->where('id', $fromId)->first();

        if ($fromAccount->balance < $amount) {
            throw new \RuntimeException('余额不足');
        }

        DB::table('accounts')->where('id', $fromId)->decrement('balance', $amount);
        DB::table('accounts')->where('id', $toId)->increment('balance', $amount);
    }, maxAttempts: 3, backoffMs: 100);
}
```

### 6.5 死锁预防策略

在实际项目中，预防死锁远比事后处理更重要。以下是经过生产验证的四大预防策略：

**策略一：固定锁顺序（最有效）**

```php
// 不好的做法：随机顺序
DB::table('accounts')->where('id', $a)->lockForUpdate();
DB::table('accounts')->where('id', $b)->lockForUpdate();

// 好的做法：按固定顺序锁定
$sortedIds = [$a, $b];
sort($sortedIds);
foreach ($sortedIds as $id) {
    DB::table('accounts')->where('id', $id)->lockForUpdate();
}
```

**策略二：减少事务持锁时间**

```php
// 不好的做法：在事务中执行耗时操作
DB::transaction(function () {
    $data = DB::table('orders')->where('status', 'pending')->get(); // 查询
    $result = callExternalApi($data); // 外部 API 调用（极慢！）
    DB::table('orders')->where('status', 'pending')->update(['result' => $result]);
});

// 好的做法：先查询，再处理，最后快速事务写入
$data = DB::table('orders')->where('status', 'pending')->get();
$result = callExternalApi($data);

DB::transaction(function () use ($result) {
    DB::table('orders')->where('status', 'pending')->update(['result' => $result]);
});
```

**策略三：使用 `SKIP LOCKED` 避免等待**

PostgreSQL 9.5+ 支持 `FOR UPDATE SKIP LOCKED`，可以跳过已被锁定的行，避免等待：

```php
// 任务队列消费场景
$task = DB::table('jobs')
    ->where('status', 'pending')
    ->orderBy('id')
    ->lockForUpdate()
    ->skipLocked()  // 跳过已锁定的行
    ->first();

if ($task) {
    DB::table('jobs')->where('id', $task->id)->update(['status' => 'processing']);
    processJob($task);
}
```

**策略四：使用 `NOWAIT` 快速失败**

```php
try {
    $account = DB::table('accounts')
        ->where('id', 1)
        ->lockForUpdate()
        ->nowait()  // 如果行已被锁定，立即报错而非等待
        ->first();
} catch (QueryException $e) {
    if ($e->getCode() === '55P03') { // lock_not_available
        return response()->json(['error' => '请稍后重试'], 429);
    }
    throw $e;
}
```

---

## 七、真实业务场景中的隔离级别选择

### 7.1 电商库存扣减（推荐：Read Committed + 乐观锁/悲观锁）

电商库存扣减是最常见的并发场景。大部分情况下，Read Committed 就足够了，配合显式的行锁或乐观锁：

```php
/**
 * 库存扣减服务
 * 使用 Read Committed（默认）+ 悲观锁
 */
class InventoryService
{
    /**
     * 扣减库存
     */
    public function deduct(int $productId, int $quantity): bool
    {
        return DB::transaction(function () use ($productId, $quantity) {
            // SELECT ... FOR UPDATE 加行锁，防止并发超卖
            $stock = DB::table('inventory')
                ->where('product_id', $productId)
                ->where('quantity', '>=', $quantity)
                ->lockForUpdate()
                ->first();

            if (!$stock) {
                return false; // 库存不足
            }

            DB::table('inventory')
                ->where('id', $stock->id)
                ->decrement('quantity', $quantity);

            // 记录库存变动日志
            DB::table('inventory_logs')->insert([
                'product_id' => $productId,
                'quantity_change' => -$quantity,
                'remaining' => $stock->quantity - $quantity,
                'created_at' => now(),
            ]);

            return true;
        });
    }

    /**
     * 乐观锁版本的库存扣减
     * 适合读多写少的场景
     */
    public function deductOptimistic(int $productId, int $quantity, int $maxRetries = 3): bool
    {
        for ($i = 0; $i < $maxRetries; $i++) {
            $stock = DB::table('inventory')
                ->where('product_id', $productId)
                ->first();

            if (!$stock || $stock->quantity < $quantity) {
                return false;
            }

            $affected = DB::table('inventory')
                ->where('id', $stock->id)
                ->where('version', $stock->version) // 版本号检查
                ->update([
                    'quantity' => $stock->quantity - $quantity,
                    'version' => $stock->version + 1,
                ]);

            if ($affected > 0) {
                return true;
            }

            // 版本号冲突，重试
            usleep(rand(10, 100) * 1000); // 随机退避
        }

        return false; // 超过最大重试次数
    }
}
```

**为什么不用 Serializable？** 库存扣减通常是热点行操作，Serializable 在 PostgreSQL 中的 SSI 虽然是乐观并发控制，但热点行操作会导致大量序列化冲突和重试，反而比 Read Committed + 显式锁更慢。

### 7.2 金融对账（推荐：Repeatable Read 或 Serializable）

金融对账要求严格的一致性——在一个时间点看到的数据必须是完全一致的快照：

```php
/**
 * 金融对账服务
 * 使用 Serializable 确保一致性快照
 */
class ReconciliationService
{
    /**
     * 生成日终对账报告
     * 在 Serializable 隔离级别下确保数据一致性
     */
    public function generateDailyReport(\Carbon\Carbon $date): array
    {
        return TransactionManager::serializable(function () use ($date) {
            // 所有查询共享同一个快照，确保一致性
            $totalDeposits = DB::table('transactions')
                ->where('type', 'deposit')
                ->whereDate('created_at', $date)
                ->sum('amount');

            $totalWithdrawals = DB::table('transactions')
                ->where('type', 'withdrawal')
                ->whereDate('created_at', $date)
                ->sum('amount');

            $accountBalances = DB::table('accounts')
                ->select(DB::raw('SUM(balance) as total_balance'))
                ->first();

            // 验证：期初余额 + 存款 - 取款 = 期末余额
            $openingBalance = $this->getOpeningBalance($date);

            $expectedBalance = $openingBalance
                + $totalDeposits
                - $totalWithdrawals;

            $isBalanced = abs(
                $expectedBalance - $accountBalances->total_balance
            ) < 0.01; // 允许浮点误差

            return [
                'date' => $date->toDateString(),
                'opening_balance' => $openingBalance,
                'total_deposits' => $totalDeposits,
                'total_withdrawals' => $totalWithdrawals,
                'expected_balance' => $expectedBalance,
                'actual_balance' => $accountBalances->total_balance,
                'is_balanced' => $isBalanced,
                'discrepancy' => $accountBalances->total_balance - $expectedBalance,
            ];
        }, attempts: 3);
    }
}
```

**为什么不用 Read Committed？** 在 Read Committed 下，两个查询之间如果发生了新的交易，对账结果会不一致——查存款时包括了某笔交易，查余额时那笔交易还没入账（或者反过来）。

### 7.3 报表查询（推荐：Read Committed 或 Repeatable Read）

报表查询通常对实时一致性要求不高，但对数据完整性有要求：

```php
/**
 * 报表服务
 */
class ReportService
{
    /**
     * 实时仪表盘报表（对实时性要求高，可用 Read Committed）
     */
    public function realtimeDashboard(): array
    {
        // Read Committed（默认）即可，每条查询都获取最新数据
        $todayOrders = DB::table('orders')
            ->whereDate('created_at', today())
            ->count();

        $todayRevenue = DB::table('orders')
            ->whereDate('created_at', today())
            ->where('status', 'completed')
            ->sum('amount');

        $activeUsers = DB::table('user_sessions')
            ->where('last_active_at', '>=', now()->subMinutes(30))
            ->count();

        return compact('todayOrders', 'todayRevenue', 'activeUsers');
    }

    /**
     * 批量导出报表（对一致性要求高，用 Repeatable Read）
     */
    public function exportMonthlyReport(int $year, int $month): array
    {
        return TransactionManager::repeatableRead(function () use ($year, $month) {
            $orders = DB::table('orders')
                ->whereYear('created_at', $year)
                ->whereMonth('created_at', $month)
                ->get();

            $refunds = DB::table('refunds')
                ->whereYear('created_at', $year)
                ->whereMonth('created_at', $month)
                ->get();

            // 在 Repeatable Read 下，两个查询看到的是同一时间点的数据
            // 不会出现 orders 包含某笔订单但 refunds 中已有该订单退款的情况
            return [
                'orders' => $orders,
                'refunds' => $refunds,
                'net_revenue' => $orders->sum('amount') - $refunds->sum('amount'),
            ];
        });
    }
}
```

### 7.4 隔离级别选择决策树

```
需要事务隔离级别？
├── 读操作为主，不要求跨查询一致性
│   └── READ COMMITTED（PostgreSQL 默认，性能最优）
├── 需要跨查询一致性快照
│   ├── 只读查询，无写操作冲突
│   │   └── REPEATABLE READ
│   └── 存在读写交叉依赖
│       └── SERIALIZABLE + 自动重试
├── 涉及热点行更新（如库存、余额）
│   └── READ COMMITTED + SELECT ... FOR UPDATE / 乐观锁
└── 高并发队列消费
    └── READ COMMITTED + FOR UPDATE SKIP LOCKED
```

---

## 八、性能对比与调优建议

### 8.1 隔离级别的性能影响

```sql
-- 使用 pgbench 进行简单性能测试
-- 初始化
pgbench -i -s 10 mydb

-- Read Committed 基准测试
pgbench -c 10 -T 60 -M prepared mydb --isolation-level=read-committed

-- Repeatable Read 测试
pgbench -c 10 -T 60 -M prepared mydb --isolation-level=repeatable-read

-- Serializable 测试
pgbench -c 10 -T 60 -M prepared mydb --isolation-level=serializable
```

一般来说，性能排序为：Read Committed > Repeatable Read > Serializable。但在特定场景下，SSI（Serializable）的性能可能接近 RR，因为它是乐观并发控制。

### 8.2 PostgreSQL 调优参数

```sql
-- 查看当前锁相关参数
SHOW deadlock_timeout;        -- 死锁检测间隔，默认 1s
SHOW lock_timeout;            -- 获取锁的超时时间，默认 0（不超时）
SHOW max_locks_per_transaction; -- 每个事务的最大锁数，默认 64

-- 建议的生产环境配置
ALTER SYSTEM SET deadlock_timeout = '1s';
ALTER SYSTEM SET lock_timeout = '30s';  -- 避免长时间等待锁
ALTER SYSTEM SET idle_in_transaction_session_timeout = '600s';  -- 空闲事务超时

-- 重新加载配置
SELECT pg_reload_conf();
```

### 8.3 监控死锁

```sql
-- 查看当前的锁等待情况
SELECT
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_statement,
    blocking_activity.query AS blocking_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity
    ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity
    ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- 开启死锁日志（postgresql.conf）
-- log_lock_waits = on
-- deadlock_timeout = 1s
```

---

## 九、总结

### 核心要点

1. **PostgreSQL 的 READ UNCOMMITTED 等同于 READ COMMITTED**——不要指望它能提供脏读隔离，这是 PostgreSQL 的设计决策。

2. **默认用 READ COMMITTED**——这是 PostgreSQL 的默认级别，也是大多数 OLTP 场景的最佳选择。它提供了足够的隔离性，同时保持了最好的并发性能。

3. **需要一致性快照时用 REPEATABLE READ**——对账、报表、批量导出等场景，确保同一事务中的多个查询看到一致的数据。

4. **需要严格串行化时用 SERIALIZABLE**——配合自动重试机制使用。PostgreSQL 的 SSI 是乐观并发控制，比 MySQL 的悲观锁方案在读多写少场景下性能更好。

5. **死锁治理的关键是预防而非处理**——固定锁顺序、减少事务持锁时间、使用 `SKIP LOCKED` 和 `NOWAIT` 是最有效的策略。

6. **在 Laravel 中，始终为序列化错误和死锁错误编写重试逻辑**——这是使用 PostgreSQL 高隔离级别时必须做到的工程实践。

事务隔离级别的选择不是"越高越好"，而是在一致性保证和并发性能之间的权衡。理解每种隔离级别的底层机制，结合具体业务场景做出合理选择，才是优秀工程师的正确做法。

---

**参考资料：**

- [PostgreSQL 官方文档 - Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [PostgreSQL 官方文档 - Serialization and Locking](https://www.postgresql.org/docs/current/serializable.html)
- [Serializable Snapshot Isolation in PostgreSQL (Dan Ports, Kevin Grittner)](https://drkp.net/papers/ssi-vldb12.pdf)
- [Laravel 官方文档 - Database Transactions](https://laravel.com/docs/database#database-transactions)
- [MySQL InnoDB 可重复读级别幻读问题分析](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html)

---

## 相关阅读

- [MySQL 乐观锁 vs 悲观锁实战：SELECT FOR UPDATE vs 版本号——Laravel 订单并发更新的选型决策](/categories/MySQL/2026-06-06-mysql-optimistic-vs-pessimistic-lock-laravel-concurrency/)
- [PostgreSQL Advisory Lock 实战进阶：会话级互斥、分布式任务调度、与 PgBouncer 连接池的兼容性踩坑](/categories/MySQL/PostgreSQL-Advisory-Lock-实战进阶-会话级互斥-分布式任务调度-PgBouncer兼容性踩坑/)
- [PostgreSQL 扩展生态实战：pg_trgm + pgcrypto + pg_stat_statements + pgvector——Laravel 开发者最常用的 8 个扩展深度指南](/categories/MySQL/2026-06-06-PostgreSQL-Extension-Ecosystem-pg-trgm-pgcrypto-pg-stat-statements-pgvector-Laravel-Guide/)
