# PostgreSQL Advisory Lock 实战

## 定义

Advisory Lock（咨询锁）是 PostgreSQL 提供的**应用层自定义锁**，不锁定任何表或行，而是基于一个应用自定义的数字键实现互斥。适合协调分布式任务、防止并发执行、实现应用级分布式锁。

## 两种类型

| 类型 | 生命周期 | 作用域 | 释放方式 |
|------|---------|--------|---------|
| **会话级** Advisory Lock | 连接存活期间 | 跨事务 | 连接断开或显式释放 |
| **事务级** Advisory Lock | 当前事务内 | 单事务 | 事务结束自动释放 |

## 核心函数

### 会话级锁

```sql
-- 获取锁（阻塞等待）
SELECT pg_advisory_lock(12345);

-- 尝试获取锁（立即返回）
SELECT pg_try_advisory_lock(12345);  -- true/false

-- 释放锁
SELECT pg_advisory_unlock(12345);
```

### 事务级锁

```sql
-- 获取锁（阻塞等待，事务结束自动释放）
SELECT pg_advisory_xact_lock(12345);

-- 尝试获取锁
SELECT pg_try_advisory_xact_lock(12345);  -- true/false
```

### 双参数版本

```sql
-- 使用两个 32 位整数作为锁键（避免碰撞）
SELECT pg_advisory_lock(100, 200);
SELECT pg_try_advisory_lock(100, 200);
SELECT pg_advisory_unlock(100, 200);
```

## 实战场景

### 1. 分布式任务调度：防止重复执行

```sql
-- 每个定时任务用唯一的 lock_id
-- lock_id = hashtext('task:cleanup-expired-sessions')

BEGIN;
SELECT pg_try_advisory_lock(hashtext('task:cleanup-expired-sessions'));
-- 返回 true → 执行任务
-- 返回 false → 其他实例正在执行，跳过
-- ... 执行清理逻辑 ...
COMMIT;  -- 事务级锁自动释放
```

### 2. 数据库迁移锁

```sql
-- 确保同一时间只有一个迁移进程在运行
BEGIN;
SELECT pg_advisory_lock(hashtext('migration:production'));
-- 执行迁移 ...
COMMIT;
```

### 3. 库存扣减防并发

```sql
BEGIN;
-- 锁定商品 ID
SELECT pg_advisory_xact_lock(hashtext('product:1001'));

-- 安全更新库存
UPDATE products SET stock = stock - 1 WHERE id = 1001 AND stock > 0;
COMMIT;
```

### 4. 批量任务互斥

```sql
-- 使用数字 ID 作为锁键
-- lock_id = 订单ID 的 hash 值
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('order:batch-process'));

-- 批量处理订单
UPDATE orders SET status = 'processing'
WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour';
COMMIT;
```

## Laravel 中的应用

```php
use Illuminate\Support\Facades\DB;

// 会话级锁
DB::statement('SELECT pg_advisory_lock(12345)');
try {
    // 执行需要互斥的操作
} finally {
    DB::statement('SELECT pg_advisory_unlock(12345)');
}

// 事务级锁（推荐）
DB::transaction(function () {
    DB::statement('SELECT pg_advisory_xact_lock(12345)');
    // 执行互斥操作
    // 事务结束自动释放
});

// 使用 hash 生成 lock_id
$lockId = crc32('task:daily-report');
DB::transaction(function () use ($lockId) {
    DB::statement("SELECT pg_advisory_xact_lock({$lockId})");
    // ...
});

// try_advisory_lock 模式
$acquired = DB::selectOne(
    "SELECT pg_try_advisory_lock(12345) as acquired"
)->acquired;

if ($acquired) {
    try {
        // 执行任务
    } finally {
        DB::statement('SELECT pg_advisory_unlock(12345)');
    }
} else {
    // 其他实例正在执行，跳过
    Log::info('Task already running, skipping');
}
```

## PgBouncer 兼容性问题

### 问题

PgBouncer 的 **Transaction 模式**下，连接在事务结束后可能被复用给其他会话。此时会话级 Advisory Lock 可能导致：
- 锁不会释放（连接被复用）
- 其他会话意外获得锁

### 解决方案

| 方案 | 说明 |
|------|------|
| 使用事务级锁 | `pg_advisory_xact_lock` 事务结束自动释放 |
| PgBouncer Session 模式 | 会话绑定连接，但失去连接池优势 |
| 应用层锁 | Redis 分布式锁替代 Advisory Lock |
| Supabase Supavisor | 支持会话级事务模式，兼容 Advisory Lock |

## Advisory Lock vs Redis 分布式锁

| 维度 | Advisory Lock | Redis 分布式锁 |
|------|--------------|---------------|
| 一致性 | ⭐⭐⭐ 数据库强一致 | ⭐⭐ 最终一致 |
| 性能 | ⭐⭐ 受数据库连接限制 | ⭐⭐⭐ 高性能 |
| 可靠性 | ⭐⭐⭐ 无单点故障 | ⭐⭐ 需要 Redis 高可用 |
| 复杂度 | 简单（SQL 原生） | 需要 Lua 脚本 + 续期 |
| 适用场景 | 数据库相关互斥 | 跨服务分布式互斥 |

## 实战文章（来自博客）

- [PostgreSQL Advisory Lock 实战进阶：会话级互斥、分布式任务调度、与 PgBouncer 连接池的兼容性踩坑](/categories/MySQL/PostgreSQL-Advisory-Lock-实战进阶/)
- [Laravel + PostgreSQL Advisory Lock 实战：补偿扫描单实例化、会话级互斥与 PgBouncer 踩坑记录](/categories/PHP/Laravel/laravel-postgresql-advisory-lock-guide-pgbouncer/)

## 相关概念

- [锁机制](锁机制.md) - MySQL 锁基础
- [分布式锁选型](../架构设计/分布式锁选型.md) - Redis/ZooKeeper/etcd 分布式锁
- [幂等性设计](../架构设计/幂等性设计.md) - 防重复提交
- [数据库连接池](数据库连接池.md) - PgBouncer/Supavisor

## 常见问题

**Q: Advisory Lock 会阻塞其他查询吗？**
A: 不会。Advisory Lock 不影响任何表或行的读写，只影响获取同一 lock_id 的其他会话。

**Q: hashtext 会碰撞吗？**
A: 理论上可能，但概率极低。关键场景可以使用双参数版本 `pg_advisory_lock(int, int)` 避免碰撞。

**Q: 连接断开后锁会自动释放吗？**
A: 会话级锁会自动释放。事务级锁在事务结束时自动释放。PgBouncer Transaction 模式下需要特别注意。
