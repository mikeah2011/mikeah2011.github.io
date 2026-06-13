---
title: FerretDB 实战：开源 MongoDB 替代——PostgreSQL 驱动的文档数据库与 Laravel 集成的迁移路径
date: 2026-06-07 12:00:00
tags: [FerretDB, MongoDB, PostgreSQL, Laravel, 文档数据库, 迁移]
categories:
  - database
cover: /images/covers/ferretdb-laravel-cover.jpg
description: FerretDB是基于PostgreSQL的开源MongoDB替代方案，完整实现MongoDB Wire Protocol支持驱动无缝兼容。本文深入解析架构原理、功能对比、性能基准、Laravel集成实战及MongoDB迁移完整路径与优化建议。
---

在云原生与开源生态蓬勃发展的今天，MongoDB 曾经是文档数据库领域的绝对霸主。然而，自 2018 年 MongoDB 将其开源许可证从 AGPL 更改为 SSPL（Server Side Public License）以来，整个技术社区对于"什么才算真正的开源"这一话题的讨论就从未停止。对于企业用户和 SaaS 服务提供商而言，SSPL 带来的合规风险、MongoDB Atlas 的高昂费用以及深度云锁定的问题，都促使开发者们积极寻找一个真正开源、无许可证陷阱且功能兼容的替代方案。FerretDB 正是在这样的背景下应运而生——它是一款基于 PostgreSQL 存储引擎的 MongoDB 兼容文档数据库，通过实现 MongoDB Wire Protocol 来提供对现有 MongoDB 驱动和工具的无缝兼容。本文将深入探讨 FerretDB 的架构原理、功能对比、性能基准、与 Laravel 框架的集成方案，以及从 MongoDB 迁移到 FerretDB 的完整路径，帮助你在实际项目中做出明智的技术选型决策。

<!-- more -->

## 一、为什么要替代 MongoDB？

### 1.1 SSPL 许可证的隐患

MongoDB 在 2018 年 10 月将开源许可证从 AGPL v3 更改为 SSPL。这一变更的核心意图是阻止云服务商（如 AWS、Azure、GCP）在不购买商业授权的情况下提供 MongoDB 托管服务。SSPL 要求任何以服务形式提供 MongoDB 的组织，都必须开源其整个服务栈——包括管理层、监控层、存储层等所有相关代码。这一要求在实际操作中几乎不可能被满足，因此实质上等于将 MongoDB 变成了一个"源码可见但非开源"的软件。

对于使用 MongoDB 构建 SaaS 产品的企业来说，SSPL 意味着潜在的法律风险。你可能在不知不觉中违反了许可证条款。OSI（Open Source Initiative）明确拒绝承认 SSPL 为开源许可证，而许多 Linux 发行版（如 Debian、Fedora、RHEL）也已将 MongoDB 从官方仓库中移除。

### 1.2 成本压力

MongoDB Atlas 作为官方托管服务，其定价对于中小型项目来说并不友好。以 AWS 上的 M30 实例为例，按需价格约为每小时 0.23 美元，月费用轻松超过 150 美元。当你需要副本集、分片集群或跨区域部署时，成本会呈指数级增长。此外，企业版的高级安全功能（如字段级加密、审计日志、LDAP 集成）还需要额外购买 Enterprise Advanced 授权。

### 1.3 云锁定与生态碎片化

MongoDB Atlas 虽然支持多云部署，但其核心功能（如 Atlas Search、Atlas Data Lake、Realm Sync 等）都是 Atlas 专有的。一旦深度依赖这些功能，迁移的成本将非常高昂。同时，MongoDB 的驱动程序虽然覆盖了主流编程语言，但不同驱动之间的行为差异和版本兼容性问题也给开发团队带来了额外的维护负担。

## 二、FerretDB 是什么？架构原理深度解析

### 2.1 项目背景与定位

FerretDB（前身是 MangoDB）由 Aleksey Akulov 于 2021 年发起，采用 Apache 2.0 许可证，是一个真正意义上的开源项目。它的核心目标是：**将 MongoDB 的文档数据库接口（Wire Protocol）与 PostgreSQL 的可靠存储引擎相结合**，为用户提供一个无需担心许可证合规问题的文档数据库解决方案。

项目托管在 GitHub（FerretDB/FerretDB），目前已有超过 8000 个 Star，活跃的社区贡献者超过 100 人。FerretDB 是 CNCF（Cloud Native Computing Foundation）的沙箱项目，这也体现了云原生社区对其技术方向的认可。

### 2.2 架构原理：从 MongoDB Wire Protocol 到 PostgreSQL

FerretDB 的架构可以分为三个核心层：

**协议层（Protocol Layer）**：FerretDB 完整实现了 MongoDB Wire Protocol（OP_MSG、OP_QUERY、OP_REPLY），这意味着任何标准的 MongoDB 驱动程序（如 pymongo、mongoose、PHP MongoDB Driver 等）都可以直接连接到 FerretDB，无需任何代码修改。客户端发起的 MongoDB 命令（如 `find`、`insert`、`aggregate` 等）会被协议层解析并转换为内部表示。

**转换层（Translation Layer）**：这是 FerretDB 最核心也最复杂的部分。转换层将 MongoDB 的 BSON 文档和查询操作翻译为 PostgreSQL 能够理解和执行的 SQL 语句。具体来说，FerretDB 使用 PostgreSQL 的 JSONB 类型来存储 BSON 文档，将 MongoDB 的查询条件（如 `$gt`、`$in`、`$regex`）转换为 PostgreSQL 的 JSONB 操作符（如 `@>`、`?|`、`->>'key'`），将 MongoDB 的索引创建转换为 PostgreSQL 的 GIN 索引或 B-tree 索引。

**存储层（Storage Layer）**：FerretDB 利用 PostgreSQL 的 JSONB 类型和强大的索引能力来持久化数据。每个 MongoDB 的 Collection 在 PostgreSQL 中对应一张表，文档以 JSONB 格式存储。PostgreSQL 15+ 引入的 `jsonpath` 查询语言进一步提升了 JSONB 查询的性能和表达能力。

整个数据流如下：

```
MongoDB 驱动 → MongoDB Wire Protocol → FerretDB 协议层 → 转换层（BSON → JSONB）→ PostgreSQL
```

这种架构设计的精妙之处在于：**客户端完全感知不到 FerretDB 的存在**，它认为自己连接的就是一个标准的 MongoDB 实例。

### 2.3 支持的后端存储

除了 PostgreSQL，FerretDB 还在实验性地支持其他后端存储引擎：

- **PostgreSQL**：主要生产级后端，利用 JSONB 和 GIN 索引
- **SAP HANA**：通过 ODBC 连接
- **SQLite**：适用于轻量级测试场景
- **MySQL**：社区贡献的后端实现（实验阶段）

在本文中，我们将专注于 PostgreSQL 后端，因为这是目前最成熟、最稳定且性能最优的方案。

## 三、FerretDB vs MongoDB 功能对比表

在决定迁移到 FerretDB 之前，了解两者之间的功能差异至关重要。以下是基于 FerretDB v1.x 和 MongoDB 7.x 的详细功能对比：

| 功能特性 | MongoDB 7.x | FerretDB 1.x | 备注 |
|---------|-------------|--------------|------|
| **CRUD 操作** | ✅ 完整支持 | ✅ 完整支持 | insertOne/Many, find, updateOne/Many, deleteOne/Many |
| **嵌套文档查询** | ✅ | ✅ | 点号表示法（如 `address.city`）完全支持 |
| **数组查询** | ✅ | ✅ | `$elemMatch`、`$all`、`$size` 等操作符 |
| **正则表达式查询** | ✅ | ✅ | `$regex`、`$options` |
| **单字段索引** | ✅ | ✅ | 升序、降序、哈希索引 |
| **复合索引** | ✅ | ✅ | 多字段复合索引 |
| **文本索引** | ✅ | ⚠️ 部分支持 | 基于 PostgreSQL 全文搜索 |
| **唯一索引** | ✅ | ✅ | |
| **TTL 索引** | ✅ | ✅ | 基于 PostgreSQL 的定时任务实现 |
| **聚合管道** | ✅ 完整 | ⚠️ 部分支持 | `$match`、`$group`、`$sort`、`$project`、`$lookup` 等核心阶段已支持 |
| **事务** | ✅ 多文档事务 | ⚠️ 部分支持 | 单文档操作原子性保证；多文档事务基于 PostgreSQL 事务 |
| **Change Stream** | ✅ | ❌ 不支持 | 需要 oplog，FerretDB 不支持 |
| **GridFS** | ✅ | ❌ 不支持 | 大文件存储需自行实现 |
| **地理空间查询** | ✅ | ❌ 不支持 | `$geoNear`、`$within` 等不支持 |
| **Sharding** | ✅ | ❌ 不支持 | 水平分片暂不支持 |
| **副本集** | ✅ | ❌ 不依赖 | 利用 PostgreSQL 的流复制实现高可用 |
| **加密字段** | ✅ (企业版) | ❌ | 可在应用层实现或使用 pgcrypto |
| **Schema 验证** | ✅ | ⚠️ 部分支持 | `$jsonSchema` 验证有限 |
| **读偏好** | ✅ | ⚠️ 有限 | 仅 primary |

**关键结论**：FerretDB 能够覆盖 MongoDB 约 80% 的核心功能。对于大多数 CRUD 密集型应用场景（如内容管理系统、电商目录、用户配置存储、日志系统），FerretDB 是一个完全可行的替代方案。但对于依赖 Change Stream、GridFS、地理空间查询或高级聚合操作的场景，仍需要谨慎评估。

## 四、性能基准测试：FerretDB vs MongoDB

性能是技术选型中不可回避的话题。以下基准测试数据来自 FerretDB 官方团队和社区独立测试，测试环境为：4 核 CPU、16GB RAM、NVMe SSD、Ubuntu 22.04，使用 `mongosh` 和自定义 Go 基准测试工具。

### 4.1 写入性能

| 操作类型 | MongoDB 7.0 | FerretDB 1.21 | 差距 |
|---------|-------------|---------------|------|
| 单文档 insert（小文档 ~1KB） | 45,000 ops/s | 28,000 ops/s | FerretDB 约为 MongoDB 的 62% |
| 批量 insert（1000 条/批） | 180,000 docs/s | 95,000 docs/s | 约 53% |
| 单文档 insert（大文档 ~100KB） | 8,500 ops/s | 6,200 ops/s | 约 73% |

写入性能差距主要来源于 FerretDB 需要将 BSON 文档转换为 JSONB 并执行 SQL INSERT，这比 MongoDB 原生的 WiredTiger 存储引擎多了一层转换开销。不过，通过 PostgreSQL 的批量插入优化（`COPY` 命令）和连接池配置，FerretDB 的写入性能在持续迭代中不断提升。

### 4.2 读取性能

| 操作类型 | MongoDB 7.0 | FerretDB 1.21 | 差距 |
|---------|-------------|---------------|------|
| 按 `_id` 查询 | 52,000 ops/s | 48,000 ops/s | 约 92% |
| 按索引字段查询 | 42,000 ops/s | 35,000 ops/s | 约 83% |
| 范围查询（indexed） | 28,000 ops/s | 22,000 ops/s | 约 79% |
| 全表扫描（10 万文档） | 1,200 ops/s | 850 ops/s | 约 71% |

读取性能方面，FerretDB 与 MongoDB 的差距明显缩小，尤其是在主键查询场景下，两者差距不到 10%。这得益于 PostgreSQL 优秀的 B-tree 索引实现和 JSONB 路径索引优化。

### 4.3 聚合性能

| 操作类型 | MongoDB 7.0 | FerretDB 1.21 | 差距 |
|---------|-------------|---------------|------|
| $match + $group（10 万文档） | 850 ms | 1,200 ms | 约 71% |
| $sort + $limit | 120 ms | 180 ms | 约 67% |
| $lookup（关联查询） | 2,100 ms | 3,500 ms | 约 60% |

聚合管道是两者差距最大的场景。FerretDB 需要将 MongoDB 的聚合阶段逐步翻译为 SQL，其中 `$lookup`（类似 SQL JOIN）的翻译效率尤其有提升空间。如果你的应用大量依赖复杂聚合管道，需要仔细评估性能影响。

### 4.4 基准测试总结

- **对于读密集型应用**（如内容展示、API 服务）：FerretDB 的性能完全可以接受，差距在 10%-20% 之间
- **对于写密集型应用**（如日志采集、事件系统）：FerretDB 约为 MongoDB 的 50%-70%，需要通过批量写入优化来弥补
- **对于聚合密集型应用**（如数据报表、BI 系统）：差距较大，建议将复杂聚合下推到 PostgreSQL 原生 SQL 或使用专用分析引擎

## 五、安装部署：Docker Compose 快速启动 FerretDB + PostgreSQL

### 5.1 环境准备

确保你的系统已安装 Docker 和 Docker Compose：

```bash
# 检查 Docker 版本
docker --version
docker compose version
```

### 5.2 Docker Compose 配置

创建 `docker-compose.yml` 文件：

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    container_name: ferretdb-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ferretdb
      POSTGRES_PASSWORD: ferretdb_password
      POSTGRES_DB: ferretdb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ferretdb -d ferretdb"]
      interval: 10s
      timeout: 5s
      retries: 5

  ferretdb:
    image: ghcr.io/ferretdb/ferretdb:1.21
    container_name: ferretdb
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      FERRETDB_POSTGRESQL_URL: postgres://ferretdb:ferretdb_password@postgres:5432/ferretdb
      FERRETDB_TELEMETRY: disable
    ports:
      - "27017:27017"

volumes:
  postgres_data:
```

### 5.3 启动与验证

```bash
# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f ferretdb

# 使用 mongosh 连接测试
mongosh "mongodb://ferretdb:ferretdb_password@localhost:27017/ferretdb?authMechanism=PLAIN"
```

**连接说明**：FerretDB 默认使用 SCRAM-SHA-256 或 PLAIN 认证机制。`authMechanism=PLAIN` 是因为 PostgreSQL 的密码验证需要明文传递（通过 TLS 加密保护）。

### 5.4 验证基本操作

```javascript
// 在 mongosh 中执行
use testdb;

// 插入文档
db.users.insertOne({
  name: "张三",
  email: "zhangsan@example.com",
  age: 28,
  address: {
    city: "北京",
    district: "海淀区"
  },
  tags: ["开发者", "开源爱好者"],
  createdAt: new Date()
});

// 查询文档
db.users.find({ "address.city": "北京" });

// 创建索引
db.users.createIndex({ email: 1 }, { unique: true });

// 聚合查询
db.users.aggregate([
  { $match: { age: { $gte: 25 } } },
  { $group: { _id: "$address.city", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);
```

如果以上操作均正常返回结果，说明 FerretDB + PostgreSQL 环境已成功部署。

## 六、Laravel 集成：使用 laravel-mongodb 包连接 FerretDB

### 6.1 为什么 FerretDB 能无缝对接 Laravel？

FerretDB 的核心价值在于它实现了 MongoDB Wire Protocol，这意味着任何标准 MongoDB 驱动和客户端库都可以直接连接 FerretDB。Laravel 生态中最流行的 MongoDB 集成包 `mongodb/laravel-mongodb`（原 `jenssegers/mongodb`）自然也不例外。

### 6.2 安装依赖

```bash
# 创建 Laravel 项目（如果还没有）
composer create-project laravel/laravel ferretdb-demo
cd ferretdb-demo

# 安装 laravel-mongodb 包
composer require mongodb/laravel-mongodb
```

### 6.3 配置数据库连接

编辑 `config/database.php`，在 `connections` 数组中添加 MongoDB 连接：

```php
'mongodb' => [
    'driver'   => 'mongodb',
    'host'     => env('MONGO_DB_HOST', '127.0.0.1'),
    'port'     => env('MONGO_DB_PORT', 27017),
    'database' => env('MONGO_DB_DATABASE', 'ferretdb'),
    'username' => env('MONGO_DB_USERNAME', 'ferretdb'),
    'password' => env('MONGO_DB_PASSWORD', 'ferretdb_password'),
    'options'  => [
        'authMechanism' => 'PLAIN',
        'tls'           => false,
    ],
],
```

在 `.env` 文件中配置：

```env
MONGO_DB_HOST=127.0.0.1
MONGO_DB_PORT=27017
MONGO_DB_DATABASE=ferretdb
MONGO_DB_USERNAME=ferretdb
MONGO_DB_PASSWORD=ferretdb_password
```

### 6.4 创建 Model

```php
<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

class Product extends Model
{
    protected $connection = 'mongodb';
    protected $collection = 'products';

    // FerretDB 中的文档不需要固定的 schema
    protected $fillable = [
        'name',
        'slug',
        'description',
        'price',
        'category',
        'attributes',
        'tags',
        'stock',
        'status',
        'images',
    ];

    protected $casts = [
        'price'     => 'float',
        'stock'     => 'integer',
        'attributes' => 'array',
        'tags'      => 'array',
        'images'    => 'array',
    ];
}
```

### 6.5 使用 Eloquent ORM 操作 FerretDB

```php
<?php

namespace App\Http\Controllers;

use App\Models\Product;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function index(Request $request)
    {
        $query = Product::query();

        // 分类筛选
        if ($request->has('category')) {
            $query->where('category', $request->category);
        }

        // 价格范围
        if ($request->has('min_price')) {
            $query->where('price', '>=', (float) $request->min_price);
        }
        if ($request->has('max_price')) {
            $query->where('price', '<=', (float) $request->max_price);
        }

        // 标签筛选（数组查询）
        if ($request->has('tag')) {
            $query->where('tags', $request->tag);
        }

        // 嵌套文档查询
        if ($request->has('brand')) {
            $query->where('attributes.brand', $request->brand);
        }

        // 排序与分页
        $products = $query
            ->orderBy('created_at', 'desc')
            ->paginate(20);

        return view('products.index', compact('products'));
    }

    public function store(Request $request)
    {
        $product = Product::create([
            'name'        => $request->name,
            'slug'        => \Str::slug($request->name),
            'description' => $request->description,
            'price'       => $request->price,
            'category'    => $request->category,
            'attributes'  => $request->attributes ?? [],
            'tags'        => $request->tags ?? [],
            'stock'       => $request->stock ?? 0,
            'status'      => 'active',
            'images'      => $request->images ?? [],
        ]);

        return response()->json($product, 201);
    }
}
```

### 6.6 注意事项

- `authMechanism` 必须设置为 `PLAIN`，因为 FerretDB 通过 PostgreSQL 进行认证
- 所有标准的 Eloquent 关联（`hasMany`、`belongsTo`）在 FerretDB 上均可正常使用
- Laravel 的数据库迁移（Migration）对 FerretDB 没有实际意义，因为文档数据库是 schema-less 的
- 可以正常使用 Laravel 的队列、缓存、Session 存储到 FerretDB

## 七、实战案例 1：电商商品目录

### 7.1 Schema-less 设计的优势

电商商品目录是文档数据库的经典应用场景。不同品类的商品具有完全不同的属性结构：手机有"屏幕尺寸"、"处理器"、"内存"等属性，服装有"尺码"、"颜色"、"材质"等属性。使用关系型数据库需要设计复杂的 EAV（Entity-Attribute-Value）模型或大量预留字段，而文档数据库的 Schema-less 特性可以完美解决这一问题。

### 7.2 商品文档结构设计

```javascript
// iPhone 商品文档
{
  _id: ObjectId("6651a2b3c4d5e6f7a8b9c0d1"),
  name: "iPhone 16 Pro",
  slug: "iphone-16-pro",
  sku: "APL-IP16P-256-NT",
  price: 8999.00,
  compareAtPrice: 9999.00,
  category: "electronics/phones",
  brand: "Apple",
  stock: 500,
  status: "active",
  attributes: {
    storage: "256GB",
    color: "原色钛金属",
    screenSize: "6.3英寸",
    chip: "A18 Pro",
    camera: "4800万像素三摄系统",
    os: "iOS 18"
  },
  variants: [
    { storage: "128GB", price: 7999.00, stock: 200 },
    { storage: "256GB", price: 8999.00, stock: 300 },
    { storage: "512GB", price: 10999.00, stock: 150 },
    { storage: "1TB",   price: 12999.00, stock: 80 }
  ],
  tags: ["5G", "旗舰", "拍照手机", "商务"],
  images: [
    { url: "/images/iphone16pro-front.jpg", alt: "正面", order: 1 },
    { url: "/images/iphone16pro-back.jpg",  alt: "背面", order: 2 },
    { url: "/images/iphone16pro-side.jpg",  alt: "侧面", order: 3 }
  ],
  specifications: [
    { group: "基本参数", items: [
      { key: "上市时间", value: "2024年9月" },
      { key: "操作系统", value: "iOS 18" }
    ]},
    { group: "屏幕", items: [
      { key: "屏幕尺寸", value: "6.3英寸" },
      { key: "分辨率", value: "2622 x 1206" }
    ]}
  ],
  createdAt: ISODate("2026-01-15T08:00:00Z"),
  updatedAt: ISODate("2026-06-01T10:30:00Z")
}
```

### 7.3 复杂查询场景

```php
// 查询价格在 5000-10000 之间、库存充足、带特定标签的商品
$products = Product::where('price', '>=', 5000)
    ->where('price', '<=', 10000)
    ->where('stock', '>', 0)
    ->where('status', 'active')
    ->where('tags', 'all', ['5G', '旗舰'])
    ->where('attributes.color', 'like', '%钛%')
    ->orderBy('price', 'asc')
    ->get();

// 查询有特定变体的商品
$products = Product::where('variants', 'elemMatch', [
    'storage' => '512GB',
    'stock' => ['$gt' => 0],
])->get();

// 聚合：按品牌统计平均价格
$stats = Product::raw()->aggregate([
    ['$match' => ['status' => 'active']],
    ['$group' => [
        '_id' => '$brand',
        'avgPrice' => ['$avg' => '$price'],
        'totalProducts' => ['$sum' => 1],
        'minPrice' => ['$min' => '$price'],
        'maxPrice' => ['$max' => '$price'],
    ]],
    ['$sort' => ['avgPrice' => -1]],
]);
```

### 7.4 索引优化

```javascript
// 在 mongosh 中创建复合索引
db.products.createIndex({ category: 1, price: 1 });
db.products.createIndex({ status: 1, stock: 1 });
db.products.createIndex({ tags: 1 });
db.products.createIndex({ "attributes.brand": 1 });
db.products.createIndex({ slug: 1 }, { unique: true });
db.products.createIndex({ sku: 1 }, { unique: true });

// 文本索引（用于搜索）
db.products.createIndex({ name: "text", description: "text" });
```

## 八、实战案例 2：用户行为日志

### 8.1 高写入场景设计

用户行为日志（如页面浏览、点击事件、搜索记录）是典型的高写入、低查询场景。每天可能产生数百万条日志记录，每条记录的结构也不完全相同。

```php
<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

class UserActivityLog extends Model
{
    protected $connection = 'mongodb';
    protected $collection = 'activity_logs';

    protected $fillable = [
        'userId',
        'sessionId',
        'eventType',
        'eventData',
        'page',
        'referrer',
        'userAgent',
        'ip',
        'geo',
        'device',
        'timestamp',
    ];

    protected $casts = [
        'eventData' => 'array',
        'geo'       => 'array',
        'device'    => 'array',
        'timestamp' => 'datetime',
    ];
}
```

### 8.2 日志文档结构

```javascript
{
  _id: ObjectId("..."),
  userId: "usr_abc123",
  sessionId: "sess_xyz789",
  eventType: "page_view",
  eventData: {
    page: "/products/iphone-16-pro",
    duration: 45,  // 秒
    scrollDepth: 78  // 百分比
  },
  referrer: "https://www.google.com",
  userAgent: "Mozilla/5.0 ...",
  ip: "203.0.113.42",
  geo: {
    country: "中国",
    province: "北京",
    city: "北京",
    latitude: 39.9042,
    longitude: 116.4074
  },
  device: {
    type: "mobile",
    brand: "Apple",
    model: "iPhone 16 Pro",
    os: "iOS 18",
    browser: "Safari 19"
  },
  timestamp: ISODate("2026-06-07T14:30:00Z")
}
```

### 8.3 TTL 索引实现自动过期

行为日志通常不需要永久存储。使用 TTL 索引可以让 FerretDB 自动清理过期数据：

```javascript
// 日志保留 90 天后自动删除
db.activity_logs.createIndex(
  { "timestamp": 1 },
  { expireAfterSeconds: 7776000 }  // 90天 = 90 * 24 * 60 * 60
);
```

FerretDB 内部通过 PostgreSQL 的定时任务（类似于 `DELETE FROM ... WHERE timestamp < now() - interval '90 days'`）来实现 TTL 功能。

### 8.4 聚合分析管道

```php
// 统计过去 7 天每天的页面浏览量
$pipeline = [
    ['$match' => [
        'eventType' => 'page_view',
        'timestamp' => ['$gte' => now()->subDays(7)],
    ]],
    ['$group' => [
        '_id' => [
            '$dateToString' => [
                'format' => '%Y-%m-%d',
                'date' => '$timestamp'
            ]
        ],
        'views' => ['$sum' => 1],
        'uniqueUsers' => ['$addToSet' => '$userId'],
    ]],
    ['$project' => [
        'date' => '$_id',
        'views' => 1,
        'uniqueUsers' => ['$size' => '$uniqueUsers'],
    ]],
    ['$sort' => ['date' => 1]],
];

$results = UserActivityLog::raw()->aggregate($pipeline);
```

```php
// 批量写入优化：使用 insertMany 而非逐条插入
public function batchLog(array $logs): void
{
    $collection = UserActivityLog::raw();
    $chunks = array_chunk($logs, 1000);

    foreach ($chunks as $chunk) {
        $documents = array_map(function ($log) {
            return [
                'userId'     => $log['user_id'],
                'sessionId'  => $log['session_id'],
                'eventType'  => $log['event_type'],
                'eventData'  => $log['event_data'],
                'timestamp'  => new \MongoDB\BSON\UTCDateTime(),
            ];
        }, $chunk);

        $collection->insertMany($documents);
    }
}
```

### 8.5 高写入场景优化建议

1. **批量写入**：始终使用 `insertMany` 而非循环 `insertOne`，可提升 3-5 倍写入性能
2. **异步队列**：将日志写入操作放入 Laravel 队列，避免阻塞 HTTP 请求
3. **连接池**：使用 PgBouncer 连接池管理 PostgreSQL 连接，避免频繁创建/销毁连接
4. **关闭不必要的索引**：日志表只保留必要的查询索引，减少写入时的索引维护开销

## 九、从 MongoDB 迁移到 FerretDB 的完整路径

### 9.1 迁移前评估

在开始迁移之前，必须完成以下评估：

1. **功能兼容性检查**：列出你使用的所有 MongoDB 特性，对照第三节的功能对比表逐项检查
2. **驱动版本确认**：确保你使用的 MongoDB 驱动版本与 FerretDB 兼容（推荐 MongoDB Node.js Driver 5.x+、PHP MongoDB Extension 1.17+）
3. **性能基准**：在你的实际数据规模下，对关键查询路径进行基准测试
4. **回滚方案**：准备完整的回滚计划，确保迁移失败时能快速恢复

### 9.2 迁移步骤

**第一步：数据导出**

```bash
# 使用 mongodump 导出 MongoDB 数据
mongodump \
  --uri="mongodb://user:password@source-mongo:27017/mydb" \
  --out=/backup/mongodb-dump \
  --gzip

# 导出特定集合
mongodump \
  --uri="mongodb://user:password@source-mongo:27017/mydb" \
  --collection=products \
  --out=/backup/mongodb-dump \
  --gzip
```

**第二步：数据导入到 FerretDB**

```bash
# 使用 mongorestore 导入到 FerretDB
mongorestore \
  --uri="mongodb://ferretdb:ferretdb_password@localhost:27017/mydb?authMechanism=PLAIN" \
  --gzip \
  /backup/mongodb-dump/mydb
```

**第三步：索引重建**

```javascript
// 连接到 FerretDB 后重建索引
use mydb;

// mongorestore 通常会自动恢复索引，但建议手动验证
db.products.getIndexes();

// 如需手动创建
db.products.createIndex({ category: 1, price: 1 });
db.products.createIndex({ slug: 1 }, { unique: true });
```

**第四步：应用切换**

```bash
# 修改 Laravel .env 文件
MONGO_DB_HOST=localhost  # 指向 FerretDB
MONGO_DB_PORT=27017

# 运行应用测试
php artisan test
```

### 9.3 驱动兼容性

| 驱动 | 兼容版本 | 备注 |
|------|---------|------|
| PHP mongodb extension | 1.17+ | 通过 laravel-mongodb 包使用 |
| Node.js mongodb driver | 5.x+ | 推荐使用最新版本 |
| Python pymongo | 4.x+ | |
| Go mongo-driver | 1.x+ | |
| Java mongodb-driver | 4.x+ | |

### 9.4 已知迁移限制

- **`mongodump`/`mongorestore` 的版本兼容性**：建议使用与 FerretDB 兼容的 `mongodump` 版本（6.0 或 7.0 工具链）
- **大文件迁移**：如果使用了 GridFS，需要自行开发迁移脚本将文件提取并存储到对象存储（如 MinIO、S3）
- **Change Stream 依赖**：如果应用依赖 Change Stream 实现实时数据同步，需要改用 PostgreSQL 的逻辑复制（Logical Replication）或应用层消息队列（如 RabbitMQ、Kafka）
- **特殊 BSON 类型**：部分 MongoDB 特有的 BSON 类型（如 `Decimal128`）在 FerretDB 中的支持可能有限
- **地理空间数据**：如果存储了 GeoJSON 数据，需要将地理空间查询逻辑迁移到应用层或使用 PostgreSQL 的 PostGIS 扩展

## 十、FerretDB 的局限性与不适合的场景

### 10.1 GridFS 不支持

GridFS 是 MongoDB 用于存储和检索大文件（超过 BSON 文档 16MB 限制）的规范。FerretDB 不支持 GridFS，这意味着如果你的应用使用了 GridFS 存储文件（如用户上传的图片、视频、文档），你需要：

```php
// 替代方案：使用 Laravel 的 Storage 门面 + MinIO/S3
// config/filesystems.php
's3' => [
    'driver' => 's3',
    'key'    => env('AWS_ACCESS_KEY_ID'),
    'secret' => env('AWS_SECRET_ACCESS_KEY'),
    'region' => env('AWS_DEFAULT_REGION'),
    'bucket' => env('AWS_BUCKET'),
    'endpoint' => env('MINIO_ENDPOINT'),  // 兼容 MinIO
    'use_path_style_endpoint' => true,
],
```

### 10.2 Change Stream 不可用

Change Stream 允许应用实时监听数据库的变更事件。FerretDB 不支持此功能，替代方案包括：

- **应用层事件总线**：在 Laravel 中使用 Event/Listener 模式，在写入数据库的同时发送事件到消息队列
- **PostgreSQL LISTEN/NOTIFY**：利用 PostgreSQL 的原生通知机制
- **Debezium CDC**：使用 Debezium 捕获 PostgreSQL 的变更数据并推送到 Kafka

### 10.3 地理空间查询不支持

`$geoNear`、`$within`、`$geoIntersects` 等地理空间操作符在 FerretDB 中不可用。如果你需要地理空间功能，可以：

- 使用 PostgreSQL + PostGIS 扩展直接进行地理空间查询
- 在应用层实现距离计算（适用于数据量较小的场景）
- 使用专用的地理空间服务（如 Elasticsearch 的 geo_point）

### 10.4 分片（Sharding）不支持

FerretDB 目前不支持水平分片。如果你的数据量超过了单个 PostgreSQL 实例的处理能力（通常在 TB 级别以下），你需要：

- 使用 PostgreSQL 的表分区（Table Partitioning）
- 按业务维度将数据拆分到多个 FerretDB 实例
- 评估是否需要回退到 MongoDB Atlas 的分片集群

### 10.5 事务支持有限

FerretDB 的单文档操作具有原子性保证（基于 PostgreSQL 事务），但多文档事务的支持仍在完善中。如果你的应用强依赖多文档事务的一致性保证，需要仔细测试。

## 十一、生产环境部署建议

### 11.1 架构推荐

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Laravel    │────▶│   FerretDB   │────▶│  PostgreSQL   │
│  Application │     │  (主实例)    │     │  (主实例)     │
└─────────────┘     └─────────────┘     └──────────────┘
                                                │
                                          ┌─────┴─────┐
                                          │  流复制    │
                                          ▼           ▼
                                    ┌──────────┐ ┌──────────┐
                                    │  PG 副本1 │ │  PG 副本2 │
                                    └──────────┘ └──────────┘
```

### 11.2 连接池配置

生产环境中，强烈建议使用 PgBouncer 作为 PostgreSQL 连接池：

```ini
# pgbouncer.ini
[databases]
ferretdb = host=127.0.0.1 port=5432 dbname=ferretdb

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 50
min_pool_size = 10
reserve_pool_size = 5
```

FerretDB 连接 PgBouncer：

```yaml
# docker-compose.yml
ferretdb:
  environment:
    FERRETDB_POSTGRESQL_URL: postgres://ferretdb:password@pgbouncer:6432/ferretdb
```

### 11.3 监控策略

**FerretDB 指标**：FerretDB 暴露 Prometheus 标准指标端点，可以集成到 Grafana 监控面板：

```yaml
# Prometheus 配置
scrape_configs:
  - job_name: 'ferretdb'
    static_configs:
      - targets: ['ferretdb:8080']
```

关键监控指标：
- `ferretdb_requests_total`：请求总数（按命令类型分组）
- `ferretdb_request_duration_seconds`：请求延迟分布
- `ferretdb_postgresql_pool_size`：连接池使用情况

**PostgreSQL 指标**：使用 `pg_stat_statements` 扩展监控慢查询：

```sql
-- 启用 pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 查看最慢的查询
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### 11.4 备份策略

```bash
#!/bin/bash
# ferretdb-backup.sh - FerretDB 数据备份脚本

BACKUP_DIR="/backup/ferretdb/$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

# 方法1：直接使用 PostgreSQL 的 pg_dump（推荐）
pg_dump -h localhost -U ferretdb -Fc ferretdb > $BACKUP_DIR/ferretdb.dump

# 方法2：使用 mongodump 通过 MongoDB 协议备份
mongodump \
  --uri="mongodb://ferretdb:password@localhost:27017/ferretdb?authMechanism=PLAIN" \
  --gzip \
  --out=$BACKUP_DIR/mongodump

# 清理 30 天前的备份
find /backup/ferretdb -type d -mtime +30 -exec rm -rf {} +

echo "Backup completed: $BACKUP_DIR"
```

**推荐同时使用两种方式**：`pg_dump` 作为主要恢复手段（性能更好、更可靠），`mongodump` 作为兼容性验证和跨平台迁移手段。

### 11.5 高可用方案

由于 FerretDB 本身是无状态的（所有数据存储在 PostgreSQL），高可用的核心在于 PostgreSQL 的高可用：

1. **Patroni + etcd**：PostgreSQL 的自动故障转移方案，配合 HAProxy 实现负载均衡
2. **CloudNativePG**：Kubernetes 原生的 PostgreSQL Operator，支持自动故障转移和滚动升级
3. **FerretDB 多实例**：启动多个 FerretDB 实例连接同一个 PostgreSQL 集群，前端使用负载均衡器分发请求

## 十二、FerretDB vs 其他 MongoDB 替代方案横向对比

市面上除了 FerretDB，还有其他几款号称"MongoDB 替代"的数据库产品。下表从协议兼容性、存储引擎、许可证、生态成熟度等维度进行横向对比：

| 维度 | FerretDB | Amazon DocumentDB | CouchDB | Marten (.NET) |
|------|----------|-------------------|---------|---------------|
| **MongoDB 协议兼容** | ✅ 完整 Wire Protocol | ⚠️ 部分兼容（需改驱动） | ❌ 自有协议 | ❌ 自有 API |
| **现有 MongoDB 驱动直接使用** | ✅ 无需修改 | ❌ 需要 DocumentDB 驱动 | ❌ | ❌ |
| **后端存储** | PostgreSQL (JSONB) | Aurora (专有) | B-tree (自有) | PostgreSQL (JSONB) |
| **开源许可证** | Apache 2.0 | 闭源（AWS 服务） | Apache 2.0 | MIT |
| **CNCF/社区认可** | ✅ CNCF 沙箱项目 | ❌ AWS 私有项目 | ✅ Apache 顶级项目 | ❌ .NET 社区项目 |
| **云托管选项** | 自部署 / FerretDB Cloud | AWS 专属 | 自部署 / Cloudant | 自部署 |
| **适用语言生态** | 语言无关（任何 MongoDB 驱动） | 语言无关 | 语言无关 | 仅 .NET |
| **聚合管道支持** | ⚠️ 部分（核心阶段） | ⚠️ 部分（兼容层） | ❌ M/R 视图 | ⚠️ Linq 查询 |
| **全文搜索** | PostgreSQL FTS | 自有引擎 | 内置 FTS | PostgreSQL FTS |
| **生产级成熟度** | ⭐⭐⭐ 持续迭代中 | ⭐⭐⭐⭐ 企业级 | ⭐⭐⭐⭐ 成熟稳定 | ⭐⭐⭐ .NET 生态 |

**选型建议总结**：

- 如果你追求 **MongoDB 协议级别的零改动兼容** 且希望保持开源，**FerretDB** 是最佳选择
- 如果你在 **AWS 生态** 中且预算充足，**Amazon DocumentDB** 开箱即用
- 如果你偏好 **多主复制和离线优先** 架构，**CouchDB** 更合适
- 如果你是 **.NET 技术栈** 且需要文档数据库能力，**Marten** 值得考虑

## 十三、总结：什么时候选 FerretDB，什么时候继续用 MongoDB

### 13.1 选择 FerretDB 的场景

✅ **你的项目主要使用 MongoDB 的 CRUD 操作**，不依赖高级特性（Change Stream、GridFS、地理空间查询）

✅ **你希望避免 SSPL 许可证风险**，尤其是构建 SaaS 产品或提供数据库托管服务

✅ **你的团队已有 PostgreSQL 运维经验**，希望统一技术栈，减少维护成本

✅ **你需要降低成本**，不想为 MongoDB Atlas 的高昂费用买单

✅ **你需要真正的开源解决方案**，用于嵌入商业产品或二次开发

✅ **你在构建新项目**，可以设计适合文档数据库模式的数据模型

✅ **你需要同时享受文档数据库的灵活性和关系型数据库的可靠性**

### 13.2 继续使用 MongoDB 的场景

❌ **你的应用重度依赖 Change Stream**，实现实时数据同步和事件驱动架构

❌ **你需要 GridFS 存储大文件**，且迁移成本过高

❌ **你的应用大量使用地理空间查询**（如 LBS 服务、地图应用）

❌ **你需要水平分片（Sharding）** 来处理 PB 级数据

❌ **你的应用依赖复杂的聚合管道**，且性能要求极高

❌ **你需要 MongoDB Atlas 的托管服务和运维便利性**，并愿意承担相应费用

❌ **你的团队对 MongoDB 生态有深度绑定**，迁移风险和成本过高

### 13.3 最终建议

FerretDB 是一个极具前景的项目，它在"开源文档数据库"这个细分领域填补了重要空白。虽然它目前还无法 100% 替代 MongoDB 的所有功能，但对于大多数中小型项目而言，FerretDB + PostgreSQL 的组合已经足够强大。

我的建议是：**在新项目中优先考虑 FerretDB**，享受真正的开源自由和 PostgreSQL 的生态优势。对于已有的 MongoDB 项目，可以在下一个大版本迭代时评估迁移的可行性，通过渐进式的方式完成过渡。

技术选型从来不是非黑即白的选择，关键是找到最适合自己团队和业务需求的方案。希望本文能为你在 MongoDB 与 FerretDB 之间做出明智选择提供有价值的参考。

---

*本文写作时间：2026 年 6 月 7 日，基于 FerretDB v1.21、MongoDB 7.0、PostgreSQL 16、Laravel 11 版本。随着 FerretDB 的持续迭代，文中部分功能对比和性能数据可能会有变化，请以官方文档为准。*

## 相关阅读

- [Rust SurrealDB 多模型数据库实战](/categories/数据库/2026-06-07-Rust-SurrealDB-实战-多模型数据库-Rust原生驱动-对比MongoDB-Neo4j-统一数据层新范式/)
- [PostgreSQL Partial Index 查询优化](/categories/数据库/2026-06-07-PostgreSQL-Partial-Index-Expression-Index-Laravel查询优化/)
- [ScyllaDB 高性能 NoSQL 实战](/categories/数据库/ScyllaDB-实战-C++重写的高性能NoSQL-Laravel分布式缓存与高吞吐写入选型对比/)
