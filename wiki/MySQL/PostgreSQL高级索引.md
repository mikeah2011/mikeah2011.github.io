# PostgreSQL Partial Index + Expression Index 实战

## 定义

PostgreSQL 提供了两种高级索引能力，超越了传统 B-Tree 索引的限制：

- **Partial Index（部分索引/条件索引）**：只索引满足 WHERE 条件的行
- **Expression Index（表达式索引/函数索引）**：索引函数或表达式的结果

## Partial Index（部分索引）

### 基本语法

```sql
-- 只索引 status = 'active' 的行
CREATE INDEX idx_orders_active ON orders (user_id)
WHERE status = 'active';

-- 只索引未删除的记录
CREATE INDEX idx_users_not_deleted ON users (email)
WHERE deleted_at IS NULL;
```

### 优势

| 维度 | 普通索引 | 部分索引 |
|------|---------|---------|
| 索引大小 | 大（所有行） | 小（只包含满足条件的行） |
| 写入性能 | 每次 INSERT/UPDATE 都维护 | 只在条件满足时维护 |
| 查询性能 | 需要扫描整个索引 | 索引更小，扫描更快 |
| 适用场景 | 通用查询 | 高选择性条件查询 |

### 实战场景

#### 1. 高选择性状态字段

```sql
-- 订单表有百万条记录，但只有几千条是 pending
-- 普通索引浪费空间在已完成订单上
CREATE INDEX idx_orders_pending ON orders (created_at)
WHERE status = 'pending';

-- 查询自动利用部分索引
SELECT * FROM orders WHERE status = 'pending' AND created_at > '2026-06-01';
```

#### 2. 软删除优化

```sql
-- 99% 的查询只关心未删除的记录
CREATE INDEX idx_products_active ON products (category_id, name)
WHERE deleted_at IS NULL;

-- 查询
SELECT * FROM products WHERE category_id = 10 AND deleted_at IS NULL;
```

#### 3. 唯一约束的条件版本

```sql
-- 同一用户下未取消的订单不能重复（已取消的可以重复）
CREATE UNIQUE INDEX idx_unique_active_order ON orders (user_id, product_id)
WHERE status != 'cancelled';
```

## Expression Index（表达式索引）

### 基本语法

```sql
-- 索引函数结果
CREATE INDEX idx_users_lower_email ON users (LOWER(email));
CREATE INDEX idx_orders_year ON orders (EXTRACT(YEAR FROM created_at));
CREATE INDEX idx_products_fullname ON products ((first_name || ' ' || last_name));
```

### 实战场景

#### 1. 大小写不敏感查询

```sql
-- 不使用表达式索引时，LOWER() 函数导致索引失效
CREATE INDEX idx_users_lower_email ON users (LOWER(email));

-- 查询利用表达式索引
SELECT * FROM users WHERE LOWER(email) = 'test@example.com';
```

#### 2. JSON 字段索引

```sql
-- JSON 字段的特定路径查询
CREATE INDEX idx_orders_metadata_ref ON orders ((metadata->>'reference_no'));

-- 查询
SELECT * FROM orders WHERE metadata->>'reference_no' = 'REF-2026-001';
```

#### 3. 计算列索引

```sql
-- 总价计算索引
CREATE INDEX idx_order_total ON orders ((quantity * unit_price));

-- 范围查询
SELECT * FROM orders WHERE (quantity * unit_price) > 10000;
```

#### 4. 日期部分索引

```sql
-- 按月查询优化
CREATE INDEX idx_logs_month ON access_logs ((DATE_TRUNC('month', created_at)));

-- 按小时查询优化
CREATE INDEX idx_events_hour ON events ((EXTRACT(HOUR FROM created_at)));
```

## Laravel 中的应用

```php
// Migration 中创建 Partial Index
Schema::table('orders', function (Blueprint $table) {
    $table->index(['user_id', 'created_at'], 'idx_orders_active')
        ->where('status', 'active');  // Laravel 不原生支持，需要 raw
});

// 使用 DB::statement
DB::statement('CREATE INDEX idx_orders_active ON orders (user_id) WHERE status = ?' , ['active']);

// Migration 中创建 Expression Index
DB::statement('CREATE INDEX idx_users_lower_email ON users (LOWER(email))');

// JSON 字段索引
DB::statement("CREATE INDEX idx_orders_ref ON orders ((metadata->>'reference_no'))");
```

### 查询时注意事项

```php
// ✅ 正确：查询条件与索引条件一致
$orders = Order::where('status', 'active')
    ->where('user_id', $userId)
    ->get();

// ❌ 错误：查询条件不匹配部分索引条件，无法利用索引
$orders = Order::where('user_id', $userId)->get();  // status != 'active' 的行不在索引中
```

## 索引选择策略

```
是否需要索引所有行？
├→ 是 → 普通 B-Tree 索引
└→ 否 → 只索引高频查询的子集
        ├→ 条件固定 → Partial Index
        ├→ 需要索引函数结果 → Expression Index
        └→ 两者结合 → Partial + Expression Index
```

## Partial Index + Expression Index 组合

```sql
-- 条件索引 + 函数索引
CREATE INDEX idx_active_lower_email ON users (LOWER(email))
WHERE status = 'active' AND deleted_at IS NULL;
```

## MySQL 对比

| 特性 | PostgreSQL | MySQL |
|------|-----------|-------|
| Partial Index | ✅ 原生支持 | ❌ 不支持（可用 Generated Column 模拟） |
| Expression Index | ✅ 原生支持 | ❌ 不支持（可用 Generated Column 模拟） |
| Generated Column | ✅ 支持 | ✅ 支持（8.0+） |
| Multi-Valued Index | ❌ | ✅（8.0.17+，JSON 数组） |

## 实战文章（来自博客）

- [PostgreSQL Partial Index + Expression Index 实战：条件索引与函数索引——Laravel 查询优化的隐藏利器](/categories/MySQL/PostgreSQL-Partial-Index-Expression-Index-实战/)

## 相关概念

- [索引创建原则](索引创建原则.md) - 何时建索引
- [覆盖索引](覆盖索引.md) - Using index 优化
- [JSON 列深度实战](JSON列深度实战.md) - MySQL JSON 索引方案
- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - 核心差异

## 常见问题

**Q: Partial Index 的条件必须和查询 WHERE 一致吗？**
A: 是的。查询条件必须是索引条件的超集才能利用部分索引。`WHERE status = 'active'` 能用 `WHERE status = 'active'` 的索引，但 `WHERE status IN ('active', 'pending')` 不能。

**Q: Expression Index 影响写入性能吗？**
A: 有一定影响。每次 INSERT/UPDATE 时需要计算表达式并维护索引。对于复杂表达式，需要权衡查询加速与写入开销。

**Q: 可以同时使用多个 Partial Index 吗？**
A: 可以。PostgreSQL 优化器会根据查询条件自动选择最合适的索引。
