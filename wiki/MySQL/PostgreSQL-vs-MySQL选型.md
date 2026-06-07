# PostgreSQL vs MySQL 选型

## 核心差异对比表

| 维度 | MySQL | PostgreSQL |
|------|-------|------------|
| **ACID 支持** | ✅ InnoDB 完整支持 | ✅ 原生完整支持 |
| **JSON 支持** | JSON 类型 + 基础函数 | JSONB + GIN 索引 + 丰富操作符 |
| **全文搜索** | FULLTEXT 索引（InnoDB 支持） | tsvector + GIN 索引，更强大 |
| **扩展性** | 存储引擎插件 | 丰富扩展（PostGIS、TimescaleDB、pg_trgm） |
| **许可协议** | GPL（Oracle 所有） | PostgreSQL License（类 MIT，更自由） |
| **复制** | 异步/半同步/组复制 | 流复制 + 逻辑复制 |
| **隔离级别** | 默认 Repeatable Read | 默认 Read Committed |
| **并发控制** | MVCC + 行锁 | MVCC（更成熟的实现） |
| **性能** | 读密集 OLTP 更快 | 复杂查询/写密集更优 |
| **社区** | Oracle 主导 | 社区驱动 |

## MySQL 优势

### 读性能

MySQL 在简单 OLTP 查询场景下，读性能通常优于 PostgreSQL：

- InnoDB Buffer Pool 高效缓存
- 聚簇索引减少回表
- 查询优化器对简单查询更高效

### 生态成熟

- **工具链**：pt-tools、MySQL Workbench、phpMyAdmin
- **云服务**：RDS、Aurora、PlanetScale、TiDB
- **文档**：中文社区庞大，踩坑经验丰富

### 运维简单

- 安装配置简单，开箱即用
- 备份恢复工具成熟（mysqldump、xtrabackup）
- 监控方案完善（PMM、Zabbix）

### 复制延迟低

- 异步复制延迟通常 < 1s
- 半同步复制保证数据安全
- GTID 简化故障切换

## PostgreSQL 优势

### JSONB + GIN 索引

PostgreSQL 的 JSONB 类型支持高效的 JSON 查询和索引：

```sql
-- 创建 GIN 索引
CREATE INDEX idx_metadata ON products USING GIN (metadata);

-- 查询 JSON 字段
SELECT * FROM products WHERE metadata @> '{"color": "red"}';
SELECT * FROM products WHERE metadata->>'brand' = 'Nike';
SELECT * FROM products WHERE metadata->'tags' ? 'sale';
```

MySQL 的 JSON 查询性能远不如 PostgreSQL，尤其是嵌套查询。

### LISTEN/NOTIFY

PostgreSQL 内置消息通知机制，适合实时应用：

```sql
-- 监听频道
LISTEN order_updates;

-- 发送通知
NOTIFY order_updates, '{"order_id": 123, "status": "shipped"}';
```

Laravel 中可通过 `pg_listen` 包实现事件驱动。

### SKIP LOCKED

队列场景下跳过已锁定的行，避免竞争：

```sql
-- 任务队列消费（PostgreSQL 9.5+）
SELECT * FROM jobs
WHERE status = 'pending'
ORDER BY id
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

MySQL 8.0+ 也支持此语法，但 PostgreSQL 的实现更成熟。

### Row-Level Security (RLS)

```sql
-- 启用 RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 创建策略：用户只能看到自己的订单
CREATE POLICY user_orders ON orders
    FOR ALL
    USING (user_id = current_setting('app.current_user_id')::int);
```

MySQL 没有原生 RLS，需要通过 View 或应用层实现。

### 扩展生态

| 扩展 | 用途 |
|------|------|
| PostGIS | 地理空间查询（GIS） |
| TimescaleDB | 时序数据 |
| pg_trgm | 模糊搜索 |
| pgvector | 向量搜索（AI/ML） |
| Citus | 分布式扩展 |
| pg_stat_statements | 查询性能分析 |

## 选型决策

```
                    开始
                      │
                      ▼
              读多写少的 OLTP？
               /         \
             是            否
              │             │
              ▼             ▼
        需要 JSON 复杂查询？   复杂分析查询？
         /         \          /         \
       是            否       是            否
        │             │       │             │
        ▼             ▼       ▼             ▼
   PostgreSQL      MySQL   PostgreSQL    需要 GIS？
                                    /         \
                                  是            否
                                   │             │
                                   ▼             ▼
                              PostgreSQL     按团队经验选
```

### 场景推荐

| 场景 | 推荐 | 原因 |
|------|------|------|
| 电商订单系统 | MySQL | 读多写少，生态成熟 |
| 内容管理系统 | PostgreSQL | JSON 灵活存储，全文搜索 |
| 地理位置服务 | PostgreSQL | PostGIS 无可替代 |
| 时序监控数据 | PostgreSQL | TimescaleDB 扩展 |
| 简单 SaaS | MySQL | 运维简单，成本低 |
| 金融交易 | PostgreSQL | 强一致性，RLS 安全 |
| 微服务混合 | 按服务拆 | 各服务独立选型 |

## Laravel 中的差异

Eloquent 抽象层掩盖了大部分数据库差异，但以下场景需要注意：

### JSON 查询差异

```php
// MySQL
Order::whereJsonContains('metadata->tags', 'urgent')->get();

// PostgreSQL（相同语法，但底层实现不同，性能差异大）
Order::whereJsonContains('metadata->tags', 'urgent')->get();
// PostgreSQL 使用 GIN 索引，性能远优于 MySQL
```

### 全文搜索差异

```php
// MySQL FULLTEXT
Product::whereRaw("MATCH(name, description) AGAINST(? IN BOOLEAN MODE)", ['laptop'])->get();

// PostgreSQL tsvector
Product::whereRaw("to_tsvector('english', name || ' ' || description) @@ to_tsquery(?)", ['laptop'])->get();
```

### 事务行为差异

```php
// MySQL 默认 REPEATABLE READ
// PostgreSQL 默认 READ COMMITTED

// 同一段代码在两个数据库下行为可能不同
DB::transaction(function () {
    $balance = Account::where('id', 1)->value('balance'); // 读取
    // 此时另一个事务修改了 balance
    $balance2 = Account::where('id', 1)->value('balance'); // 再次读取
    // MySQL: balance === balance2 (快照读)
    // PostgreSQL: balance !== balance2 (最新读)
});
```

### 分页差异

```php
// MySQL 的 offset 大偏移性能差
// PostgreSQL 的 offset 同样有性能问题，但支持 keyset pagination 更好

// 推荐：Keyset Pagination（两者通用）
Order::where('id', '>', $lastId)->orderBy('id')->limit(20)->get();
```

## 相关概念

- [存储引擎](存储引擎.md) - MySQL InnoDB vs PostgreSQL 堆表存储
- [索引创建原则](索引创建原则.md) - B+树 vs GIN/GiST 索引

## 实战文章

- [PostgreSQL vs MySQL 选型实战](/categories/Databases/PostgreSQL-vs-MySQL-选型实战/) - KKday Affiliate 选型经验
- [Laravel ORM PDO MySQL PostgreSQL 行为差异](/categories/Databases/Laravel-ORM-PDO-MySQL-PostgreSQL-行为差异与兼容性实战踩坑记录/) - 行为差异与兼容性实战踩坑记录
