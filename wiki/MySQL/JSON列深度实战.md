# MySQL JSON 列深度实战

## 定义

MySQL 5.7+ 引入原生 JSON 数据类型，支持 JSON 文档的存储、查询、索引和部分更新。MySQL 8.0/9.x 进一步增强了 JSON 功能，包括 Multi-Valued Index、JSON Schema 验证等。

## 核心操作

### 存储与插入

```sql
CREATE TABLE products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255),
    attrs JSON NOT NULL,
    tags JSON DEFAULT ('[]'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO products (name, attrs, tags) VALUES
('iPhone 16', '{"color":"black","storage":256,"weight":174}', '["electronics","phone"]'),
('MacBook Pro', '{"color":"silver","ram":36,"chip":"M4 Pro"}', '["electronics","laptop"]');
```

### 查询：JSON_EXTRACT 与 -> 操作符

```sql
-- ->  返回 JSON 值（带引号）
SELECT name, attrs->'$.color' AS color FROM products;
-- 结果: "black"（带双引号）

-- ->>  返回纯文本值（不带引号）⭐ 推荐
SELECT name, attrs->>'$.color' AS color FROM products;
-- 结果: black（纯文本）

-- JSON_EXTRACT 函数（等价于 ->）
SELECT name, JSON_EXTRACT(attrs, '$.storage') FROM products;

-- 嵌套查询
SELECT attrs->>'$.address.city' FROM users;
```

### 修改：JSON_SET / JSON_INSERT / JSON_REPLACE / JSON_REMOVE

```sql
-- JSON_SET：存在则更新，不存在则插入
UPDATE products SET attrs = JSON_SET(attrs, '$.color', 'white', '$.warranty', '2 years')
WHERE id = 1;

-- JSON_INSERT：只在 key 不存在时插入
UPDATE products SET attrs = JSON_INSERT(attrs, '$.discount', 10) WHERE id = 1;

-- JSON_REPLACE：只在 key 存在时更新
UPDATE products SET attrs = JSON_REPLACE(attrs, '$.color', 'red') WHERE id = 1;

-- JSON_REMOVE：删除指定 key
UPDATE products SET attrs = JSON_REMOVE(attrs, '$.warranty') WHERE id = 1;
```

### 聚合与过滤

```sql
-- JSON_LENGTH：数组/对象元素个数
SELECT name, JSON_LENGTH(tags) AS tag_count FROM products;

-- JSON_CONTAINS：检查是否包含某值
SELECT * FROM products WHERE JSON_CONTAINS(tags, '"electronics"');

-- JSON_ARRAYAGG：聚合为 JSON 数组
SELECT JSON_ARRAYAGG(name) AS product_names FROM products;

-- JSON_TABLE：将 JSON 数组展开为行（MySQL 8.0+）
SELECT p.name, jt.tag
FROM products p,
     JSON_TABLE(p.tags, '$[*]' COLUMNS (tag VARCHAR(50) PATH '$')) AS jt;
```

## Generated Column + 索引

JSON 列本身不能直接建索引，需要通过 **Generated Column** 间接索引：

```sql
-- 创建虚拟列（不占存储空间）
ALTER TABLE products
ADD COLUMN color VARCHAR(50) GENERATED ALWAYS AS (attrs->>'$.color') VIRTUAL;

-- 在虚拟列上建索引
CREATE INDEX idx_color ON products(color);

-- 查询自动利用索引
SELECT * FROM products WHERE attrs->>'$.color' = 'black';
-- 等价于 SELECT * FROM products WHERE color = 'black';
-- EXPLAIN 显示使用 idx_color
```

## Multi-Valued Index（MySQL 8.0.17+）

JSON 数组的专用索引，解决数组元素查询的性能问题：

```sql
-- 创建多值索引
CREATE INDEX idx_tags ON products (
    (CAST(tags AS CHAR(50) ARRAY))
);

-- 查询数组中是否包含某元素（MEMBER OF）
SELECT * FROM products WHERE 'electronics' MEMBER OF (tags);

-- JSON_CONTAINS 也能利用多值索引
SELECT * FROM products WHERE JSON_CONTAINS(tags, '["electronics"]');

-- JSON_OVERLAPS：检查数组是否有交集
SELECT * FROM products WHERE JSON_OVERLAPS(tags, '["phone","laptop"]');
```

## JSON Schema 验证（MySQL 8.0.17+）

```sql
ALTER TABLE products ADD CONSTRAINT chk_attrs
    CHECK (JSON_SCHEMA_VALID(
        '{
            "type": "object",
            "properties": {
                "color": {"type": "string"},
                "storage": {"type": "integer", "minimum": 64}
            },
            "required": ["color"]
        }',
        attrs
    ));
```

## 性能优化策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| Generated Column + 索引 | 高频查询字段提取为虚拟列 | 固定路径查询 |
| Multi-Valued Index | JSON 数组元素索引 | 标签、分类查询 |
| JSON 部分更新 | `JSON_SET` 只更新部分字段 | 大 JSON 文档小更新 |
| 垂直拆分 | 热字段提取为独立列 | 混合查询模式 |

## Laravel 中的 JSON 查询

```php
// 查询 JSON 字段
$products = Product::where('attrs->color', 'black')->get();

// 数组包含查询
$products = Product::whereJsonContains('tags', 'electronics')->get();

// 数组长度查询
$products = Product::whereJsonLength('tags', '>', 2)->get();

// JSON 更新
$product->update(['attrs->color' => 'white']);

// 排序（基于 Generated Column）
$products = Product::orderByRaw("attrs->>'$.price'")->get();
```

## 何时用 JSON 列 vs 关联表

| 维度 | JSON 列 | 关联表 |
|------|---------|--------|
| 数据结构 | 灵活、半结构化 | 固定、结构化 |
| 查询复杂度 | 简单路径查询 | 复杂 JOIN/聚合 |
| 索引支持 | Generated Column / Multi-Valued Index | 完整索引支持 |
| 扩展性 | 字段灵活扩展 | 需要 DDL 变更 |
| 适用场景 | 配置、属性、日志 | 订单明细、用户-角色 |

## 实战文章（来自博客）

- [MySQL JSON 列深度实战：JSON_EXTRACT、Generated Column、Multi-Valued Index——Laravel 中的半结构化数据查询优化](/2026/06/06/2026-06-06-MySQL-JSON-Column-Deep-Dive-Generated-Column-Multi-Valued-Index-Laravel/)

## 相关概念

- [MySQL 9.x 新特性](MySQL%209.x新特性.md) - JSON 增强功能
- [索引创建原则](索引创建原则.md) - 何时建索引
- [覆盖索引](覆盖索引.md) - Using index 优化
- [三范式与反范式](三范式与反范式.md) - JSON 作为反范式策略

## 常见问题

**Q: JSON 列能建索引吗？**
A: 不能直接建索引。需要通过 Generated Column（虚拟列）+ 索引间接实现，或使用 Multi-Valued Index（数组场景）。

**Q: JSON 列 vs EAV 模式？**
A: JSON 列更适合半结构化属性（配置、标签），EAV 模式适合需要动态属性且需要复杂查询的场景。JSON 列性能更好，EAV 更灵活。

**Q: 大 JSON 文档更新性能？**
A: MySQL 8.0 支持 JSON 部分更新（Partial Update），只写入变更的部分，减少 redo log 和 binlog 量。
