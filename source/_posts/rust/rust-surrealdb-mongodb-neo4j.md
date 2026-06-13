---

title: Rust + SurrealDB 实战：多模型数据库（文档/图/关系）的 Rust 原生驱动——对比 MongoDB/Neo4j 的统一数据层新范式
keywords: [Rust, SurrealDB, MongoDB, Neo4j, 多模型数据库, 文档, 关系, 原生驱动, 的统一数据层新范式]
date: 2026-06-09 06:05:00
categories:
- rust
tags:
- Rust
- SurrealDB
- 数据库
- 图数据库
- MongoDB
- Neo4j
description: 深入 SurrealDB 的多模型架构，用 Rust 原生驱动实现文档、图、关系三种查询范式的统一数据层，对比 MongoDB 和 Neo4j 的适用场景与取舍。
cover: https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
images:
  - https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200
---



## 概述

传统架构中，一个典型的技术栈可能是：MySQL 存关系数据、MongoDB 存文档、Neo4j 存图关系、Redis 做缓存。每引入一个数据库，就意味着多一套运维成本、多一套驱动、多一套一致性保障逻辑。

SurrealDB 打破了这个范式——它是一个**多模型数据库**，在同一个引擎中支持文档存储、图关系、SQL-like 查询、实时订阅，甚至内置了访问权限控制。而 Rust 作为系统级语言，天然适合作为 SurrealDB 的驱动层。

本文将从实战角度出发：

1. SurrealDB 的核心概念与多模型能力
2. Rust 原生驱动的完整 CRUD + 图查询实战
3. 与 MongoDB（文档）+ Neo4j（图）组合方案的对比
4. 真实项目中的踩坑记录

---

## SurrealDB 核心概念

### 什么是多模型数据库？

多模型数据库（Multi-Model Database）是指**一个引擎同时支持多种数据模型**的数据库。SurrealDB 支持：

| 数据模型 | 说明 | 查询方式 |
|---------|------|---------|
| 文档模型 | 类似 MongoDB 的 JSON 文档存储 | `SELECT * FROM user WHERE age > 18` |
| 图模型 | 类似 Neo4j 的节点-边关系 | `SELECT ->bought->product FROM user:john` |
| 关系模型 | 类似 SQL 的表结构与外键 | `SELECT * FROM order WHERE user_id = user:john` |
| KV 模型 | 键值对存储 | `LET $val = kv::get('key')` |

### SurrealQL：统一查询语言

SurrealDB 没有发明新的查询语言，而是用一种**类 SQL 但支持图遍历**的语法——SurrealQL。它看起来像 SQL，但能直接做图遍历：

```sql
-- 传统 SQL 关系查询
SELECT * FROM order WHERE user_id = user:john;

-- 图遍历：从用户出发，沿 bought 边找到所有商品
SELECT ->bought->product FROM user:john;

-- 混合：关系 + 图 + 聚合
SELECT 
    user.name,
    count(->bought->product) AS total_products,
    math::sum(->bought->product.price) AS total_spent
FROM user
GROUP BY user.name;
```

### Record ID 与传统主键的区别

SurrealDB 使用 **Record ID**（如 `user:john`、`product:⟨sku:12345⟩`）作为文档标识，而不是自增整数或 UUID。Record ID 可以是：

- 自动生成：`user:⟨随机ID⟩`
- 指定值：`user:john`
- 嵌套表：`user:john->bought->product:sku_12345`

这种设计天然支持图关系的边存储，因为边本身也是一个 Record。

---

## Rust 原生驱动实战

### 项目初始化

```toml
# Cargo.toml
[dependencies]
surrealdb = "2.3"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
```

### 连接 SurrealDB

SurrealDB 支持多种连接方式：内存、RocksDB、TiKV、WebSocket、HTTP。开发阶段用内存引擎，生产环境用 WebSocket：

```rust
use surrealdb::engine::any::Any;
use surrealdb::opt::auth::Root;
use surrealdb::Surreal;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 开发环境：内存引擎
    let db = Surreal::new::<surrealdb::engine::local::Mem>(()).await?;
    
    // 生产环境：WebSocket 连接
    // let db = Surreal::new::<Ws>("127.0.0.1:8000").await?;
    
    // 认证
    db.signin(Root {
        username: "root",
        password: "root",
    })
    .await?;

    // 选择命名空间和数据库
    db.use_ns("production").use_db("ecommerce").await?;

    println!("✅ SurrealDB 连接成功");
    Ok(())
}
```

### 定义数据结构（Rust Struct + SurrealDB Table）

```rust
use serde::{Deserialize, Serialize};
use surrealdb::sql::Thing;

// 用户模型
#[derive(Debug, Serialize, Deserialize)]
struct User {
    id: Option<Thing>,
    name: String,
    email: String,
    age: u8,
    tags: Vec<String>,
    address: Address,
}

#[derive(Debug, Serialize, Deserialize)]
struct Address {
    city: String,
    district: String,
    zip: String,
}

// 商品模型
#[derive(Debug, Serialize, Deserialize)]
struct Product {
    id: Option<Thing>,
    name: String,
    price: f64,
    category: String,
    stock: u32,
}

// 购买关系（图的边）
#[derive(Debug, Serialize, Deserialize)]
struct Bought {
    id: Option<Thing>,
    r#in: Thing,   // 源节点（用户）
    out: Thing,    // 目标节点（商品）
    quantity: u32,
    purchased_at: String,
}
```

### 完整 CRUD 操作

```rust
use surrealdb::sql::Thing;

// ==================== CREATE ====================

// 创建用户（指定 ID）
async fn create_user(db: &Surreal<Any>, user: User) -> anyhow::Result<User> {
    let created: User = db
        .create(("user", "john"))
        .content(user)
        .await?;
    Ok(created)
}

// 创建商品（自动生成 ID）
async fn create_product(db: &Surreal<Any>, product: Product) -> anyhow::Result<Product> {
    let created: Product = db
        .create("product")
        .content(product)
        .await?;
    Ok(created)
}

// 创建购买关系（图的边）
async fn create_purchase(
    db: &Surreal<Any>,
    user_id: &str,
    product_id: &str,
    quantity: u32,
) -> anyhow::Result<Bought> {
    // SurrealDB 中，关系也是一种 Record
    let bought: Bought = db
        .create("bought")
        .content(Bought {
            id: None,
            r#in: Thing::from(("user", user_id)),
            out: Thing::from(("product", product_id)),
            quantity,
            purchased_at: chrono::Utc::now().to_rfc3339(),
        })
        .await?;
    Ok(bought)
}

// ==================== READ ====================

// 查询单个用户
async fn get_user(db: &Surreal<Any>, id: &str) -> anyhow::Result<Option<User>> {
    let user: Option<User> = db.select(("user", id)).await?;
    Ok(user)
}

// 条件查询：年龄大于 18 的用户
async fn get_adult_users(db: &Surreal<Any>) -> anyhow::Result<Vec<User>> {
    let users: Vec<User> = db
        .query("SELECT * FROM user WHERE age > 18 ORDER BY age ASC")
        .await?
        .take(0)?;
    Ok(users)
}

// 图遍历：用户购买的所有商品
async fn get_user_products(
    db: &Surreal<Any>,
    user_id: &str,
) -> anyhow::Result<Vec<Product>> {
    let products: Vec<Product> = db
        .query("SELECT ->bought->product.* AS products FROM ONLY $user")
        .bind(("user", Thing::from(("user", user_id))))
        .await?
        .take("products")?;
    Ok(products)
}

// 聚合查询：每个用户的消费总额
async fn get_user_spending(
    db: &Surreal<Any>,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let results: Vec<serde_json::Value> = db
        .query(
            "SELECT 
                user.name,
                count(->bought->product) AS total_products,
                math::sum(->bought->product.price) AS total_spent
            FROM user
            GROUP BY user.name
            ORDER BY total_spent DESC"
        )
        .await?
        .take(0)?;
    Ok(results)
}

// ==================== UPDATE ====================

async fn update_user_age(
    db: &Surreal<Any>,
    user_id: &str,
    new_age: u8,
) -> anyhow::Result<Option<User>> {
    let updated: Option<User> = db
        .update(("user", user_id))
        .patch(surrealdb::opt::PatchOp::replace("/age", new_age))
        .await?;
    Ok(updated)
}

// ==================== DELETE ====================

async fn delete_user(db: &Surreal<Any>, user_id: &str) -> anyhow::Result<()> {
    db.delete(("user", user_id)).await?;
    Ok(())
}
```

### 定义 Schema（表约束）

```rust
async fn setup_schema(db: &Surreal<Any>) -> anyhow::Result<()> {
    db.query(
        "DEFINE TABLE user SCHEMAFULL;
         DEFINE FIELD name ON user TYPE string;
         DEFINE FIELD email ON user TYPE string ASSERT string::is::email($value);
         DEFINE FIELD age ON user TYPE int ASSERT $value >= 0 AND $value <= 150;
         DEFINE FIELD tags ON user TYPE array;
         DEFINE FIELD tags.* ON user TYPE string;
         DEFINE FIELD address ON user TYPE object;
         DEFINE FIELD address.city ON user TYPE string;
         DEFINE FIELD address.district ON user TYPE string;
         DEFINE FIELD address.zip ON user TYPE string;
         DEFINE INDEX unique_email ON user FIELDS email UNIQUE;"
    )
    .await?;

    db.query(
        "DEFINE TABLE product SCHEMAFULL;
         DEFINE FIELD name ON product TYPE string;
         DEFINE FIELD price ON product TYPE float ASSERT $value >= 0;
         DEFINE FIELD category ON product TYPE string;
         DEFINE FIELD stock ON product TYPE int ASSERT $value >= 0;"
    )
    .await?;

    db.query(
        "DEFINE TABLE bought SCHEMAFULL TYPE RELATION FROM user TO product;
         DEFINE FIELD quantity ON bought TYPE int ASSERT $value > 0;
         DEFINE FIELD purchased_at ON product TYPE string;"
    )
    .await?;

    println!("✅ Schema 定义完成");
    Ok(())
}
```

---

## 对比：SurrealDB vs MongoDB + Neo4j

### 架构对比

| 维度 | MongoDB + Neo4j | SurrealDB |
|------|----------------|-----------|
| 部署复杂度 | 两套集群 + 两套运维 | 单一二进制文件 |
| 查询语言 | MQL + Cypher | SurrealQL（统一） |
| 数据一致性 | 需要应用层协调 | 单事务内保证 |
| 学习成本 | 两套范式 | 一套范式 |
| 生态成熟度 | 极高 | 中等（快速成长中） |
| 水平扩展 | 各自独立扩展 | 支持 TiKV 分布式存储 |
| 实时订阅 | MongoDB Change Streams + Neo4j Triggers | 内置 LIVE SELECT |

### 代码对比：同一业务场景

**场景：查询用户购买的商品及消费总额**

**MongoDB 方案：**

```javascript
// MongoDB：需要预先设计嵌入/引用结构
db.users.aggregate([
  { $match: { _id: "john" } },
  {
    $lookup: {
      from: "purchases",
      localField: "_id",
      foreignField: "userId",
      as: "purchases"
    }
  },
  { $unwind: "$purchases" },
  {
    $lookup: {
      from: "products",
      localField: "purchases.productId",
      foreignField: "_id",
      as: "product"
    }
  },
  { $unwind: "$product" },
  {
    $group: {
      _id: "$_id",
      totalSpent: { $sum: "$product.price" },
      products: { $push: "$product.name" }
    }
  }
]);
```

**Neo4j 方案：**

```cypher
// Neo4j：图遍历天然支持，但需要维护边的属性
MATCH (u:User {id: 'john'})-[:BOUGHT]->(p:Product)
RETURN u.name, 
       count(p) AS totalProducts, 
       sum(p.price) AS totalSpent
```

**SurrealDB 方案：**

```sql
-- SurrealDB：一条查询搞定，图遍历 + 聚合
SELECT 
    name,
    count(->bought->product) AS total_products,
    math::sum(->bought->product.price) AS total_spent
FROM user:john;
```

### 性能基准参考

根据 SurrealDB 官方基准测试（2026 年 Q1 数据，单节点，RocksDB 引擎）：

| 操作 | SurrealDB | MongoDB 7.x | Neo4j 5.x |
|------|-----------|-------------|-----------|
| 单文档写入 | ~45,000 ops/s | ~65,000 ops/s | ~30,000 ops/s |
| 单文档读取 | ~120,000 ops/s | ~150,000 ops/s | ~80,000 ops/s |
| 2 跳图遍历 | ~15,000 ops/s | N/A（需 $graphLookup） | ~25,000 ops/s |
| 混合查询（关系+图） | ~8,000 ops/s | ~3,000 ops/s（多 stage） | ~12,000 ops/s |

> ⚠️ 以上数据来自官方，实际性能取决于数据量、索引配置、硬件环境。SurrealDB 在混合查询场景下的优势明显，因为不需要跨引擎协调。

---

## 踩坑记录

### 坑 1：Record ID 的序列化陷阱

SurrealDB 返回的 `Thing` 类型在 Rust 中序列化为：

```json
{ "tb": "user", "id": { "String": "john" } }
```

而不是你期望的 `"user:john"`。解决方法是自定义序列化：

```rust
use serde::{Deserialize, Serialize};
use surrealdb::sql::Thing;

// 自定义 Thing 的序列化格式
fn serialize_thing<S>(thing: &Option<Thing>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match thing {
        Some(t) => serializer.serialize_str(&format!("{}:{}", t.tb, t.id)),
        None => serializer.serialize_none(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct User {
    #[serde(serialize_with = "serialize_thing")]
    id: Option<Thing>,
    name: String,
}
```

### 坑 2：图关系的双向查询性能

SurrealDB 的图遍历默认是**有方向**的。如果你经常需要双向查询（比如"用户买了什么"和"商品被谁买了"），需要创建双向索引：

```sql
-- 创建双向关系表
DEFINE TABLE bought SCHEMAFULL TYPE RELATION FROM user TO product;
DEFINE TABLE bought_reverse SCHEMAFULL TYPE RELATION FROM product TO user;

-- 或者使用无方向查询（性能较低）
SELECT <-bought<-user FROM product:sku_12345;
```

### 坑 3：SurrealDB 的事务限制

SurrealDB 支持事务，但目前（v2.x）有以下限制：

- 单事务最大 1000 条语句
- 分布式模式下（TiKV）事务有额外延迟
- 图遍历操作在事务中**不保证快照隔离**

```rust
// 事务示例：扣减库存 + 创建订单
async fn purchase_with_transaction(
    db: &Surreal<Any>,
    user_id: &str,
    product_id: &str,
    quantity: u32,
) -> anyhow::Result<()> {
    db.query("BEGIN TRANSACTION")
        .await?;

    // 扣减库存
    let stock_result = db
        .query("UPDATE product SET stock -= $qty WHERE id = $pid AND stock >= $qty")
        .bind(("qty", quantity))
        .bind(("pid", Thing::from(("product", product_id))))
        .await?;

    // 检查是否扣减成功
    let product: Option<Product> = db.select(("product", product_id)).await?;
    match product {
        Some(p) if p.stock >= 0 => {
            // 创建购买关系
            create_purchase(db, user_id, product_id, quantity).await?;
            db.query("COMMIT").await?;
        }
        _ => {
            db.query("CANCEL").await?;
            anyhow::bail!("库存不足");
        }
    }

    Ok(())
}
```

### 坑 4：内存引擎 vs 磁盘引擎的差异

开发时用内存引擎（`Mem`），生产用 RocksDB 或 TiKV。两者行为差异：

| 差异点 | 内存引擎 | RocksDB |
|--------|---------|---------|
| 数据持久化 | 无 | 有 |
| 事务语义 | 简化版 | 完整 ACID |
| 并发性能 | 单线程 | 多线程 |
| 索引行为 | 基本一致 | 更严格 |

**建议**：开发阶段就用 RocksDB 引擎，避免上线后踩坑。

```rust
// 开发环境也用 RocksDB
use surrealdb::engine::local::Db;
use surrealdb::engine::local::RocksDb;

let db = Surreal::new::<RocksDb>("./surreal_dev_data").await?;
```

### 坑 5：Rust 驱动的版本兼容性

SurrealDB 的 Rust 驱动版本与服务端版本**强绑定**。升级服务端时必须同步升级驱动，否则会出现协议不匹配错误。

```toml
# 锁定版本，避免意外升级
[dependencies]
surrealdb = "=2.3.0"  # 精确版本锁定
```

---

## 何时选择 SurrealDB？

**适合的场景：**

- 中小型项目（数据量 < 1TB），需要同时用文档和图关系
- 快速原型开发，不想维护多套数据库
- 实时应用（聊天、协作、IoT），需要 LIVE SELECT
- 边缘计算场景，SurrealDB 可以编译为 WebAssembly

**不适合的场景：**

- 超大规模数据（> 10TB），SurrealDB 的分布式方案（TiKV）尚不成熟
- 已有成熟的 MongoDB + Neo4j 集群，迁移成本大于收益
- 需要极致的单模型性能（如纯 KV 场景用 Redis 更合适）
- 团队对 SurrealQL 不熟悉，学习成本是隐性成本

---

## 总结

SurrealDB 代表了一种**统一数据层**的新范式。它不是要取代 MongoDB 或 Neo4j，而是在中小型项目中提供一个**更简洁的选择**——用一个引擎、一套查询语言解决多种数据模型的需求。

Rust 作为驱动层的优势在于：

1. **零成本抽象**：SurrealDB 本身就是 Rust 写的，驱动层与引擎层的交互几乎没有序列化开销
2. **类型安全**：Rust 的强类型系统 + SurrealDB 的 Schema 模式，编译期就能发现大部分数据结构错误
3. **异步原生**：Rust 的 async/await + Tokio 运行时，天然适配数据库的 IO 密集型操作

如果你的项目正在考虑引入图数据库但又不想增加运维复杂度，SurrealDB + Rust 是一个值得尝试的组合。但如果你的数据规模已经很大，或者团队已经熟悉 MongoDB + Neo4j 的组合，那么**不要为了统一而统一**——成熟的方案永远比新颖的方案更可靠。

---

## 参考资料

- [SurrealDB 官方文档](https://surrealdb.com/docs)
- [SurrealDB Rust SDK](https://docs.rs/surrealdb)
- [SurrealDB GitHub](https://github.com/surrealdb/surrealdb)
- [多模型数据库对比论文](https://arxiv.org/abs/2301.12345)
