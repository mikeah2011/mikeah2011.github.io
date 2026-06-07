# PostgreSQL 事务隔离级别实战

## 定义

PostgreSQL 支持三种事务隔离级别（没有 Read Uncommitted），每种级别在并发控制、性能和一致性之间有不同的权衡。

## 隔离级别对比

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 实现机制 | 性能 |
|---------|------|-----------|------|---------|------|
| **Read Committed**（默认） | ❌ | ✅ | ✅ | 每条语句创建新快照 | ⭐⭐⭐ 最快 |
| **Repeatable Read** | ❌ | ❌ | ❌ | 事务开始时创建快照 | ⭐⭐ 中 |
| **Serializable** | ❌ | ❌ | ❌ | SSI（Serializable Snapshot Isolation） | ⭐ 最慢 |

> 注意：PostgreSQL 的 Repeatable Read 已经能防止幻读（通过快照隔离），这与 MySQL 不同。

## Read Committed（默认）

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- 或在 postgresql.conf 中设置
-- default_transaction_isolation = 'read committed'
```

### 特性
- 每条 SQL 语句开始时获取新的快照
- 只能看到语句开始前已提交的数据
- **不可重复读**：同一事务内两条相同 SELECT 可能返回不同结果
- **幻读**：同一事务内范围查询可能返回新增行

### 适用场景
- 大多数 OLTP 应用
- 对一致性要求不极端的场景
- 需要最高并发性能的场景

## Repeatable Read

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

### 特性
- 事务开始时获取快照，整个事务期间使用同一快照
- **防止不可重复读**：同一事务内多次 SELECT 结果一致
- **防止幻读**：通过快照隔离实现（PostgreSQL 特有优势）
- 写冲突时会报错：`ERROR: could not serialize access due to concurrent update`

### 适用场景
- 需要一致性读的报表查询
- 长事务中的数据分析
- 需要防止幻读的场景

## Serializable

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

### 特性
- 最严格的隔离级别，等价于串行执行
- 使用 **SSI（Serializable Snapshot Isolation）** 算法
- 不使用传统锁，而是检测读写依赖冲突
- 冲突时报错：`ERROR: could not serialize access due to read/write dependencies`

### 适用场景
- 金融级一致性要求
- 转账、对账等关键业务
- 可以接受偶尔重试的场景

## SSI vs 传统锁

| 维度 | SSI（PostgreSQL） | 传统锁（MySQL Serializable） |
|------|------------------|---------------------------|
| 实现方式 | 检测读写依赖 | 读写锁阻塞 |
| 并发性能 | 高（乐观） | 低（悲观） |
| 冲突处理 | 报错，需要重试 | 阻塞等待 |
| 死锁风险 | 无 | 有 |

## 死锁与锁等待

### PostgreSQL 锁等待

```sql
-- 查看当前锁等待
SELECT
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_query,
    blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- 设置锁等待超时
SET lock_timeout = '5s';
SET deadlock_timeout = '1s';
```

## Laravel 中的事务隔离级别

```php
// 方式一：在 config/database.php 中配置
'pgsql' => [
    'options' => [
        PDO::ATTR_PERSISTENT => false,
    ],
    'default_transaction_isolation' => 'read committed',
],

// 方式二：运行时设置
DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
DB::transaction(function () {
    // 业务逻辑
});

// 方式三：Laravel 11+ 原生支持
DB::transaction(function () {
    // 业务逻辑
}, isolationLevel: 'repeatable read');
```

## 选型建议

| 场景 | 推荐级别 | 理由 |
|------|---------|------|
| 普通 CRUD | Read Committed | 默认即可，性能最好 |
| 报表/数据分析 | Repeatable Read | 需要一致性快照 |
| 转账/对账 | Serializable | 金融级一致性 |
| 批量更新 | Read Committed + 显式锁 | 避免长事务 |

## 实战文章（来自博客）

- [PostgreSQL 事务隔离级别实战：Read Committed vs Repeatable Read vs Serializable——Laravel 中的幻读、不可重复读与死锁治理](/2026/06/06/2026-06-06-PostgreSQL-Transaction-Isolation-Levels-Read-Committed-Repeat-Read-Serializable-Laravel/)

## 相关概念

- [事务](事务.md) - MySQL ACID 与隔离级别基础
- [MVCC](MVCC.md) - 多版本控制原理
- [锁机制](锁机制.md) - 表锁/行锁/间隙锁
- [PostgreSQL Advisory Lock](PostgreSQL-Advisory-Lock.md) - 会话级互斥

## 常见问题

**Q: PostgreSQL 的 Repeatable Read 和 MySQL 的有什么不同？**
A: PostgreSQL 的 RR 通过快照隔离防止幻读，MySQL 的 RR 需要间隙锁来防止幻读。PostgreSQL 的 RR 更"干净"。

**Q: Serializable 报错怎么处理？**
A: 捕获异常后重试（通常 3 次，指数退避）。Laravel 中可以用 retry helper：`DB::transaction(fn() => ..., 3)`。

**Q: Read Committed 下的写偏斜（Write Skew）怎么解决？**
A: 使用 `SELECT ... FOR UPDATE` 显式加锁，或切换到 Serializable 隔离级别。
