# SQL 优化经验

## 定义

SQL 优化是提升 MySQL 查询性能的核心手段，包括查询语句优化、索引优化、表结构优化等多个层面。

## 查询优化

### 1. 避免 SELECT *

```sql
-- ❌ 查询所有字段，无法使用覆盖索引
SELECT * FROM orders WHERE user_id = 100;

-- ✅ 只查需要的字段，可能走覆盖索引
SELECT id, amount, status FROM orders WHERE user_id = 100;
```

### 2. 避免在 WHERE 中对字段进行函数操作

```sql
-- ❌ 索引失效
SELECT * FROM orders WHERE YEAR(created_at) = 2024;

-- ✅ 改用范围查询
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

### 3. 用 JOIN 代替子查询

```sql
-- ❌ 子查询
SELECT * FROM orders WHERE user_id IN (SELECT id FROM users WHERE status = 1);

-- ✅ JOIN
SELECT o.* FROM orders o JOIN users u ON o.user_id = u.id WHERE u.status = 1;
```

### 4. 分页优化

```sql
-- ❌ 深度分页，扫描大量数据
SELECT * FROM orders ORDER BY id DESC LIMIT 100000, 20;

-- ✅ 游标分页
SELECT * FROM orders WHERE id < 上次最大id ORDER BY id DESC LIMIT 20;

-- ✅ 延迟关联
SELECT o.* FROM orders o
JOIN (SELECT id FROM orders ORDER BY id DESC LIMIT 100000, 20) t
ON o.id = t.id;
```

### 5. OR 改写为 UNION ALL

```sql
-- ❌ OR 可能导致索引失效
SELECT * FROM users WHERE id = 1 OR phone = '13800138000';

-- ✅ UNION ALL
SELECT * FROM users WHERE id = 1
UNION ALL
SELECT * FROM users WHERE phone = '13800138000' AND id != 1;
```

### 6. LIMIT 1 优化

```sql
-- 如果确定只有一条记录
SELECT * FROM users WHERE email = 'test@example.com' LIMIT 1;
```

## 索引优化

### 1. 覆盖索引

```sql
-- 创建包含查询字段的联合索引，避免回表
ALTER TABLE orders ADD INDEX idx_cover (user_id, status, amount);
```

### 2. 联合索引顺序

```sql
-- 等值查询在前，范围查询在后
-- ✅ idx_status_amount (status, amount)
-- ❌ idx_amount_status (amount, status)  -- amount 是范围查询会阻断后面的字段
```

### 3. 前缀索引

```sql
-- 对长字符串字段取前缀建索引
ALTER TABLE users ADD INDEX idx_email_prefix (email(10));
```

## 表结构优化

### 1. 合适的数据类型

```sql
-- ❌ 用 VARCHAR 存储固定长度的值
phone VARCHAR(20)

-- ✅ 用 BIGINT
phone BIGINT

-- ❌ 用 BIGINT 存储状态
status BIGINT

-- ✅ 用 TINYINT
status TINYINT
```

### 2. 主键设计

```sql
-- ✅ 自增主键（InnoDB 推荐）
id BIGINT AUTO_INCREMENT PRIMARY KEY

-- ❌ UUID 做主键（无序，B+树频繁分裂）
id VARCHAR(36) PRIMARY KEY
```

### 3. 适度冗余

```sql
-- 高频查询需要关联字段时，可以适度冗余减少 JOIN
-- 如订单表冗余 user_name 字段
```

## 读写分离优化

```sql
-- 写操作走主库
DB::connection('master')->table('orders')->insert([...]);

-- 读操作走从库
DB::connection('slave')->table('orders')->where('user_id', 100)->get();
```

## 缓存优化

```php
// Laravel 缓存查询结果
$orders = Cache::remember("user_orders:{$userId}", 3600, function () use ($userId) {
    return Order::where('user_id', $userId)->get();
});
```

## 相关概念

- [EXPLAIN 执行计划](EXPLAIN执行计划.md) - 验证优化效果
- [慢查询治理](慢查询治理.md) - 系统化排查
- [索引创建原则](索引创建原则.md) - 索引设计
- [覆盖索引](覆盖索引.md) - 高级索引优化
- [主从复制与读写分离](主从复制与读写分离.md) - 架构层面优化

## 实战文章

- [MySQL 优化经验总结 - 博客原文](/categories/Databases/MySQL优化经验总结/)
- [百万级数据表查询优化实战](/categories/Databases/百万级数据表查询优化实战/)
- [数据库索引优化实战](/categories/Databases/数据库索引优化实战/)
