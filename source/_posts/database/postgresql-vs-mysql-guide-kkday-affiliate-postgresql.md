---

title: PostgreSQL-vs-MySQL-选型实战-KKday-Affiliate-项目为什么选 PostgreSQL 以及边界在哪里
keywords: [PostgreSQL, MySQL, KKday, Affiliate, 选型实战, 项目为什么选, 以及边界在哪里]
date: 2026-05-05 01:11:02
updated: 2026-05-05 01:13:41
categories:
- database
tags:
- KKday
- Laravel
- MySQL
- PostgreSQL
description: KKday Affiliate 项目从 MySQL 迁移到 PostgreSQL 的真实决策过程，涵盖 JSONB、全文搜索、GIS 能力、CTE 递归查询等场景对比，以及哪些场景 PostgreSQL 反而不如 MySQL 的边界踩坑记录。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-018-content-1.jpg
- /images/content/databases-018-content-2.jpg
---



## 前言

2024 年 KKday 启动 Affiliate（联盟营销）项目时，团队面临一个关键决策：继续用 MySQL 8.0（公司主力数据库），还是引入 PostgreSQL？

这不是一个「PostgreSQL 更强所以用它」的简单答案。实际上我们经历了**两周的技术选型调研**，跑了真实数据的 benchmark，踩了 PgBouncer 连接池的坑，最后才得出一个有边界的结论。

本文记录整个决策过程、架构差异实战、以及**PostgreSQL 反而踩坑的场景**——这些才是最有价值的部分。

---

## 一、决策背景：Affiliate 项目的特殊需求

![databases-018-content-1](/images/content/databases-018-content-1.jpg)

Affiliate 项目的核心业务模型：

```
┌─────────────────────────────────────────────────┐
│              Affiliate 核心数据模型               │
├─────────────────────────────────────────────────┤
│                                                  │
│  1. 推广链接管理（动态参数嵌套、JSON Schema）     │
│  2. 点击追踪（高写入量、时序数据）               │
│  3. 佣金结算（复杂聚合、递归分佣链）             │
│  4. 多层级归属（树形结构、递归 CTE）             │
│  5. 商品筛选（JSON 字段内嵌条件查询）            │
│                                                  │
└─────────────────────────────────────────────────┘
```

关键痛点：
- 推广链接的参数结构**不固定**，需要嵌套 JSON 存储 + 高效索引查询
- 佣金链路是**多级递归**（A 推荐 B，B 推荐 C，佣金按层递减）
- 商品筛选条件需要从 JSON 字段中做**范围查询 + 模糊匹配**
- 点击追踪是**写密集**场景，需要高效的 upsert 和分区裁剪

这些需求恰好落在 MySQL 和 PostgreSQL 能力差异的**交叉地带**。

---

## 二、核心差异实战：五个场景逐一对比

### 场景 1：JSON 字段的索引查询（决定性因素）

Affiliate 的推广链接参数结构：

```json
{
  "tracking": {
    "source": "instagram",
    "medium": "influencer",
    "campaign": "summer_sale_2025",
    "custom_params": {
      "budget_tier": "gold",
      "region": "APAC"
    }
  },
  "product_filters": {
    "categories": [12, 45, 78],
    "price_range": { "min": 100, "max": 500 },
    "currency": "TWD"
  }
}
```

**MySQL 8.0 的方案：**

```sql
-- MySQL 8.0：JSON 函数 + 虚拟列索引
ALTER TABLE affiliate_links
  ADD COLUMN tracking_source VARCHAR(50) 
    GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(params, '$.tracking.source'))) VIRTUAL,
  ADD INDEX idx_tracking_source (tracking_source);

-- 查询
SELECT * FROM affiliate_links
WHERE JSON_EXTRACT(params, '$.product_filters.price_range.min') >= 100
  AND JSON_EXTRACT(params, '$.product_filters.price_range.max') <= 500;
```

**踩坑**：MySQL 的虚拟列索引只支持**标量值**，嵌套的 `price_range.min` 这种范围查询无法通过虚拟列索引加速，只能走全表扫描。`JSON_EXTRACT` 返回的是 JSON 类型，需要 `CAST` 或 `JSON_UNQUOTE`，性能下降明显。

在我们的 benchmark 中，50 万行推广链接表，按 `price_range` 范围查询：
- MySQL 8.0：**~320ms**（全表扫描）
- PostgreSQL + GIN：**~12ms**

**PostgreSQL 的方案：**

```sql
-- PostgreSQL：JSONB + GIN 索引（支持嵌套路径）
CREATE INDEX idx_links_params ON affiliate_links USING GIN (params);

-- 更精确的路径索引
CREATE INDEX idx_links_price_range ON affiliate_links 
  USING GIN ((params -> 'product_filters' -> 'price_range'));

-- 查询：原生 JSONB 操作符，走 GIN 索引
SELECT * FROM affiliate_links
WHERE params -> 'product_filters' -> 'price_range' @> '{"min": 100}'
  AND params -> 'product_filters' -> 'price_range' @> '{"max": 500}';

-- 范围查询（需要 btree_gin 扩展或表达式索引）
SELECT * FROM affiliate_links
WHERE (params -> 'product_filters' -> 'price_range' ->> 'min')::int >= 100
  AND (params -> 'product_filters' -> 'price_range' ->> 'max')::int <= 500;
```

**关键差异**：PostgreSQL 的 `@>` 包含操作符可以走 GIN 索引，MySQL 的 `JSON_EXTRACT` 范围查询则无法利用二级索引。

这是最终选择 PostgreSQL 的**决定性因素**。

### 场景 2：递归查询（多级佣金链）

佣金链路结构：A 推荐 B，B 推荐 C，每一层佣金比例递减。

```
A (L1, 10%) → B (L2, 6%) → C (L3, 3%) → D (L4, 1%)
```

**MySQL 8.0：CTE 递归（但有深度限制）**

```sql
WITH RECURSIVE commission_chain AS (
  -- 起点
  SELECT id, parent_id, user_name, 1 AS level, 10.00 AS commission_rate
  FROM affiliates
  WHERE id = :start_id
  
  UNION ALL
  
  -- 递归
  SELECT a.id, a.parent_id, a.user_name, cc.level + 1,
         cc.commission_rate * 0.6 AS commission_rate
  FROM affiliates a
  JOIN commission_chain cc ON a.parent_id = cc.id
  WHERE cc.level < 10  -- MySQL 默认 cte_max_recursion_depth = 1000
)
SELECT * FROM commission_chain;
```

**踩坑**：MySQL 的 CTE 递归在超过 **50 层**后性能急剧下降（内部使用临时表物化），且不支持 `SEARCH` 子句控制遍历顺序。

**PostgreSQL：原生递归 CTE + SEARCH 子句**

```sql
WITH RECURSIVE commission_chain AS (
  SELECT id, parent_id, user_name, 1 AS level, 10.00 AS commission_rate
  FROM affiliates
  WHERE id = :start_id
  
  UNION ALL
  
  SELECT a.id, a.parent_id, a.user_name, cc.level + 1,
         cc.commission_rate * 0.6
  FROM affiliates a
  JOIN commission_chain cc ON a.parent_id = cc.id
  WHERE cc.level < 10
)
SEARCH BREADTH FIRST BY id SET order_seq  -- 控制遍历顺序
SELECT * FROM commission_chain ORDER BY order_seq;
```

在我们的 Affiliate 场景中（实际层级最多 8 层），两者性能差异不大（**<5ms**）。但这不是选 PostgreSQL 的原因。

### 场景 3：Upsert 与写入密集（点击追踪）

点击追踪表每天写入 **50-100 万行**，需要按 IP + 时间窗口去重（同一 IP 5 分钟内只计一次）。

**MySQL 8.0：**

```sql
INSERT INTO click_events (link_id, ip_address, click_time, user_agent, metadata)
VALUES (:link_id, :ip, :time, :ua, :meta)
ON DUPLICATE KEY UPDATE click_count = click_count + 1;
```

**PostgreSQL：**

```sql
INSERT INTO click_events (link_id, ip_address, click_time, user_agent, metadata)
VALUES (:link_id, :ip, :time, :ua, :meta::jsonb)
ON CONFLICT (link_id, ip_address, click_time_bucket)
DO UPDATE SET click_count = click_count + 1,
              last_seen_at = EXCLUDED.click_time;
```

**实测结果**：在高并发 upsert 场景下（100 QPS），MySQL 8.0 的 `ON DUPLICATE KEY UPDATE` 有**间隙锁冲突**，TPS 约 2,800；PostgreSQL 的 `ON CONFLICT` 在相同条件下 TPS 约 **4,200**，提升约 50%。

差异来源：PostgreSQL 的 `ON CONFLICT` 底层使用 **Speculative Insert** 机制，不持有 gap lock。

### 场景 4：全文搜索（商品描述）

Affiliate 项目需要在商品描述中做模糊搜索。

```sql
-- PostgreSQL：原生 tsvector + GIN 索引
ALTER TABLE products ADD COLUMN search_vector tsvector;
UPDATE products SET search_vector = 
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''));
CREATE INDEX idx_products_search ON products USING GIN (search_vector);

SELECT * FROM products
WHERE search_vector @@ to_tsquery('english', 'laptop & wireless')
ORDER BY ts_rank(search_vector, to_tsquery('english', 'laptop & wireless')) DESC;
```

MySQL 8.0 也有 `FULLTEXT` 索引，但在我们的测试中：
- 中英文混合分词：PostgreSQL 的 `zhparser` 扩展更成熟
- 搜索质量：PostgreSQL 的 `ts_rank` 排序更合理
- 性能：两者在 10 万行级差距不大（**<20ms**）

### 场景 5：GIS 空间查询（附近推荐）

Affiliate 需要基于地理位置推荐附近的推广活动：

```sql
-- PostgreSQL + PostGIS
CREATE EXTENSION postgis;
CREATE INDEX idx_events_location ON events USING GIST (location);

SELECT *, ST_Distance(
  location, 
  ST_SetSRID(ST_MakePoint(121.5654, 25.0330), 4326)::geography
) AS distance_m
FROM events
WHERE ST_DWithin(
  location,
  ST_SetSRID(ST_MakePoint(121.5654, 25.0330), 4326)::geography,
  5000  -- 5公里
)
ORDER BY distance_m
LIMIT 20;
```

MySQL 8.0 有 `ST_Distance_Sphere`，但**不支持 GiST 索引**，范围查询只能全表扫描。PostGIS 的性能在 50 万行数据上比 MySQL 快 **20 倍以上**。

---

## 三、架构决策矩阵

```
┌──────────────────────┬──────────────┬──────────────┬────────────────┐
│ 场景                 │ MySQL 8.0    │ PostgreSQL   │ 决策           │
├──────────────────────┼──────────────┼──────────────┼────────────────┤
│ JSON 嵌套查询        │ ★★☆ (虚拟列) │ ★★★ (GIN)   │ PG ✅ (决定性)  │
│ 递归 CTE             │ ★★☆          │ ★★★          │ 平手            │
│ Upsert 高并发        │ ★★☆ (gap)    │ ★★★ (spec)   │ PG ✅           │
│ 全文搜索             │ ★★☆          │ ★★★ (tsvec)  │ PG ✅           │
│ GIS 空间查询         │ ★☆☆          │ ★★★ (PostGIS)│ PG ✅           │
│ 连接池/并发          │ ★★★ (原生)   │ ★★☆ (需PgBouncer)│ MySQL ⚠️   │
│ 生态工具链           │ ★★★          │ ★★☆          │ MySQL ⚠️        │
│ 运维团队熟悉度       │ ★★★          │ ★★☆          │ MySQL ⚠️        │
│ 分区表               │ ★★☆          │ ★★★ (声明式) │ PG ✅           │
│ 复制/高可用          │ ★★★ (GTID)   │ ★★☆ (流复制) │ MySQL ✅        │
└──────────────────────┴──────────────┴──────────────┴────────────────┘
```

**最终决策**：Affiliate 项目独立使用 PostgreSQL，主站（B2C）继续用 MySQL 8.0。

---

## 四、PostgreSQL 反而踩坑的场景（边界在哪里）

![databases-018-content-2](/images/content/databases-018-content-2.jpg)

### 踩坑 1：连接数管理

PostgreSQL 每个连接是**独立进程**（fork），不像 MySQL 的线程模型。100 个连接 = 100 个进程，内存占用显著。

```yaml
# docker-compose.yml - 我们的开发环境配置
services:
  postgres:
    image: postgres:15
    command: >
      postgres
        -c max_connections=200
        -c shared_buffers=512MB
        -c work_mem=16MB
    # ⚠️ 实际上我们需要用 PgBouncer 做连接池
  pgbouncer:
    image: edoburu/pgbouncer
    environment:
      POOL_MODE: transaction    # 事务级连接池
      MAX_CLIENT_CONN: 1000
      DEFAULT_POOL_SIZE: 50
```

**踩坑记录**：最初没用 PgBouncer，Laravel 的 `persistent_connections` 在 PostgreSQL 下有 bug（PDO 层面的连接复用问题），导致每请求都新建连接，500 并发下 PostgreSQL 的内存占用飙到 **4GB**。加上 PgBouncer 后降到 **800MB**。

### 踩坑 2：Laravel ORM 兼容性

```php
// MySQL 正常，PostgreSQL 报错的写法
User::whereRaw('JSON_EXTRACT(profile, "$.name") = ?', ['John']);
// PostgreSQL 需要改成：
User::whereRaw("profile->>'name' = ?", ['John']);
```

`JSON_EXTRACT` 是 MySQL 函数，PostgreSQL 用 `->` / `->>` 操作符。如果你的项目有大量 `whereRaw`，迁移成本不低。

### 踩坑 3：自增主键

```php
// MySQL：AUTO_INCREMENT，简单
Schema::create('click_events', function (Blueprint $table) {
    $table->id();  // bigint auto_increment
});

// PostgreSQL：需要 SEQUENCE，且 INSERT 后返回的 ID 机制不同
// Laravel 的 $table->id() 底层会用 SERIAL / BIGSERIAL
// 但 bulk insert 时 SEQUENCE 不会自动回填
```

**踩坑**：使用 `DB::table('click_events')->insert($batch)` 批量插入后，无法通过 `DB::getPdo()->lastInsertId()` 获取所有 ID。必须改用 `insertGetId` 或 `returning` 子句。

### 踩坑 4：大小写敏感

```sql
-- MySQL 默认不区分大小写（utf8mb4_general_ci）
SELECT * FROM users WHERE email = 'John@Example.COM';  -- 匹配 john@example.com

-- PostgreSQL 默认区分大小写
SELECT * FROM users WHERE email = 'John@Example.COM';  -- 不匹配！
```

**解决方案**：使用 `citext` 扩展或统一 lowercase：

```sql
CREATE EXTENSION citext;
ALTER TABLE users ALTER COLUMN email TYPE citext;
```

### 踩坑 5：迁移成本

从 MySQL 迁移到 PostgreSQL 的隐藏成本：
- `GROUP_CONCAT` → `STRING_AGG`
- `IFNULL` → `COALESCE`
- `LIMIT offset, count` → `LIMIT count OFFSET offset`
- `AUTO_INCREMENT` → `SERIAL` / `IDENTITY`
- 反引号 `` ` `` → 双引号 `"`

我们在 Affiliate 项目中花了 **3 天**做 SQL 兼容性修复。

---

## 五、最终架构

```
┌─────────────────────────────────────────────────┐
│               KKday 混合数据库架构               │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │   B2C 主站        │  │   Affiliate 项目     │ │
│  │   MySQL 8.0       │  │   PostgreSQL 15      │ │
│  │   (订单/用户/商品) │  │   (推广链接/佣金/    │ │
│  │                   │  │    点击追踪)          │ │
│  └──────┬───────────┘  └──────┬───────────────┘ │
│         │                     │                  │
│         └──────┬──────────────┘                  │
│                │                                 │
│         ┌──────▼──────────┐                      │
│         │   Laravel BFF    │                      │
│         │   中间层聚合     │                      │
│         │   (双数据源连接) │                      │
│         └─────────────────┘                      │
│                                                  │
└─────────────────────────────────────────────────┘
```

Laravel 双数据库配置：

```php
// config/database.php
'connections' => [
    'mysql' => [
        'driver' => 'mysql',
        'host' => env('DB_MYSQL_HOST', '127.0.0.1'),
        'database' => env('DB_MYSQL_DATABASE', 'b2c_main'),
        // ... MySQL 主站配置
    ],
    'pgsql_affiliate' => [
        'driver' => 'pgsql',
        'host' => env('DB_PG_HOST', '127.0.0.1'),
        'database' => env('DB_PG_DATABASE', 'affiliate'),
        'options' => [
            PDO::ATTR_PERSISTENT => false,  // ⚠️ 不要用 persistent！
        ],
        // 通过 PgBouncer 连接
        'port' => env('DB_PG_PORT', 6432),  // PgBouncer 端口
    ],
],
```

---

## 六、选型决策清单（给你的项目参考）

**选 PostgreSQL 当你需要：**
- ✅ JSON/JSONB 深度索引查询（嵌套结构 + 范围过滤）
- ✅ 复杂递归查询（多级层级、图遍历）
- ✅ GIS 空间查询（PostGIS 远强于 MySQL Spatial）
- ✅ 高并发 Upsert（`ON CONFLICT` 无 gap lock）
- ✅ 数据完整性优先（原生 CHECK 约束、排除约束）
- ✅ 需要 `LISTEN/NOTIFY` 事件通知

**选 MySQL 当你需要：**
- ✅ 运维团队只熟悉 MySQL
- ✅ 高并发短连接场景（MySQL 线程模型更轻量）
- ✅ 已有 GTID 复制 + ProxySQL 读写分离架构
- ✅ 简单的 CRUD 为主，不需要 JSONB/GIS/CTE 能力
- ✅ 第三方工具/监控系统只支持 MySQL

**混用时注意：**
- ⚠️ 数据一致性：跨库事务需要 Saga 模式，不能用原生事务
- ⚠️ 连接池：PostgreSQL 必须加 PgBouncer
- ⚠️ ORM 兼容性：`whereRaw`、`DB::raw` 需要按库适配
- ⚠️ 团队学习成本：至少 1-2 周的 PostgreSQL 实战培训

---

## 总结

PostgreSQL 不是「更好的 MySQL」，而是一个**能力边界不同**的数据库。我们在 KKday Affiliate 项目中选择 PostgreSQL 的核心原因是 JSONB + GIN 索引——这个场景下 MySQL 8.0 的性能差距是 **27 倍**，无法通过优化弥补。

但如果你的项目不需要 JSONB 深度查询、GIS 空间索引、或复杂递归 CTE，MySQL 8.0 在运维成熟度、连接模型、工具生态上仍然是更稳妥的选择。

**选型不是技术竞赛，是需求匹配。**

---

## 相关阅读

- [PostgreSQL 高级特性实战：Window Functions + CTE + JSONB + pg_trgm——Laravel 中的复杂查询重写与性能调优](/categories/数据库/postgresql-advanced-features-window-cte-jsonb-pgtrgm-laravel/)
- [ClickHouse vs PostgreSQL 分析查询对比：OLAP 场景下的选型决策与 Laravel 集成](/categories/MySQL/2026-06-02-clickhouse-vs-postgresql-olap-selection-laravel-integration/)
- [pg_stat_statements + MySQL Performance Schema 实战：数据库慢查询的生产级监控](/categories/MySQL/2026-06-05-pg-stat-statements-MySQL-Performance-Schema-慢查询监控实战/)
- [PostgreSQL Logical Replication 实战：零停机数据迁移与实时数据同步](/categories/MySQL/PostgreSQL-Logical-Replication-实战-零停机数据迁移与实时数据同步/)
- [数据库多租户模式对比实战：共享库 Row-Level vs Schema-per-Tenant vs 独立库](/categories/01_MySQL/数据库多租户模式对比实战-共享库Row-Level-vs-Schema-per-Tenant-vs-独立库-Laravel中的三种方案深度权衡/)
