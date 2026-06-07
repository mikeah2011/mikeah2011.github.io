# 边缘数据库与SQLite现代化

## 定义

边缘数据库与SQLite现代化是指将传统嵌入式数据库 SQLite 通过现代化改造（libSQL、Litestream、Turso、Supabase 等）引入分布式、边缘计算和云原生场景的技术实践。这一技术演进使得原本局限于单机环境的 SQLite 能够满足全球化部署、流式复制、实时订阅等企业级需求。

核心技术栈包括：

- **libSQL**：SQLite 的开源分叉，添加了复制、HTTP 协议、WebAssembly 支持等现代特性
- **Turso**：基于 libSQL 的边缘数据库即服务（DBaaS），将数据库部署到全球边缘节点
- **Litestream**：SQLite 的流式复制工具，持续将 WAL（Write-Ahead Log）备份到对象存储
- **Supabase**：开源的 Firebase 替代方案，基于 PostgreSQL 提供实时数据库、认证和存储服务
- **SQLite 本体**：经历了从 "玩具数据库" 到 "全球部署最广泛的数据库" 的认知转变

在 Laravel 等后端框架的集成场景中，这些技术为中小规模应用提供了极低成本、极简运维的数据库方案。

## 核心原理

### 1. SQLite 的现代化演进

SQLite 曾长期被视为仅适用于开发/测试的轻量级数据库，但现代实践证明其在生产环境中同样可靠：

**SQLite 的核心优势：**
- 零配置、零运维：无需数据库服务器进程
- 单文件存储：备份就是复制文件
- 读性能极高：直接内存映射，无网络往返
- 嵌入式运行：与应用同进程，无网络延迟
- 可靠性极强：ACID 事务，数十亿设备部署验证

**SQLite 的传统限制：**
- 单写入者：WAL 模式下仍只有一个写入者
- 无内置复制：传统上不支持跨节点同步
- 无网络协议：只能本地文件系统访问
- 并发写入有限：写操作串行化

现代化方案正是针对这些限制逐一突破。

### 2. libSQL：SQLite 的现代化分叉

libSQL 是由 Turso 团队维护的 SQLite 开源分叉，保持向后兼容的同时添加了关键特性：

**架构设计：**
```
┌──────────────────────────────────────────┐
│              libSQL Core                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ SQLite   │ │ 原生复制 │ │ HTTP/WS  │ │
│  │ 兼容引擎 │ │ 协议引擎 │ │ 协议引擎 │ │
│  └──────────┘ └──────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ WASM     │ │ 向量搜索 │ │ 多节点   │ │
│  │ 运行时   │ │ 扩展     │ │ 集群管理 │ │
│  └──────────┘ └──────────┘ └──────────┘ │
└──────────────────────────────────────────┘
```

**关键特性：**

1. **嵌入式复制（Embedded Replication）**
   - 基于 WAL 的流式复制协议
   - Primary-Replica 架构
   - Replica 可以在本地提供读服务
   - Primary 故障时 Replica 可提升为 Primary

2. **HTTP 和 WebSocket 协议**
   - 通过 HTTP API 访问数据库（无需本地文件）
   - 支持 RESTful SQL 接口
   - 适合无服务器（Serverless）和边缘函数环境

3. **WebAssembly 支持**
   - 可在浏览器端运行 SQLite
   - 支持 Service Worker 和 Cloudflare Workers
   - 实现离线优先（Offline-First）应用架构

**在 Laravel 中集成 libSQL：**
```php
// 使用 libSQL HTTP 协议连接
// config/database.php
'libsql' => [
    'driver' => 'sqlite', // 通过 libSQL 的 SQLite 兼容模式
    'url' => env('LIBSQL_URL', 'http://localhost:8080'),
    'auth_token' => env('LIBSQL_AUTH_TOKEN'),
    'database' => env('LIBSQL_DATABASE', ':memory:'),
],
```

### 3. Turso：边缘数据库即服务

Turso 是基于 libSQL 构建的托管数据库服务，将数据复制到全球边缘节点：

**核心架构：**
```
┌──────────────────────────────────────────────────────────┐
│                     Turso 全球架构                        │
│                                                          │
│  [Primary 节点] ───流式复制───> [Edge Replica 1 (东京)]  │
│       │                          [Edge Replica 2 (法兰)] │
│       │                          [Edge Replica 3 (圣保罗)]│
│       │                          [Edge Replica N (...)]   │
│       │                                                  │
│  [对象存储 (S3)] <── 持久化备份                           │
└──────────────────────────────────────────────────────────┘
```

**核心优势：**
- **边缘读取**：数据复制到离用户最近的节点，读延迟 < 10ms
- **嵌入式副本**：应用可以嵌入数据库副本，实现零延迟读取
- **分支（Branching）**：类似 Git 的数据库分支，方便开发和测试
- **按量计费**：按读写次数和存储量计费，小规模应用几乎免费

**在 Laravel 中使用 Turso：**
```php
// .env
DB_CONNECTION=libsql
DB_URL=libsql://your-db-name-your-org.turso.io
DB_AUTH_TOKEN=your-auth-token

// 数据库迁移和查询与标准 SQLite 完全一致
Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->string('title');
    $table->text('body');
    $table->timestamps();
});

// 查询
$posts = DB::table('posts')->where('active', true)->get();
```

### 4. Litestream：SQLite 流式复制与灾难恢复

Litestream 是 SQLite 的流式复制工具，持续将 WAL 变更流式传输到对象存储：

**工作原理：**
```
┌─────────────────────────────────────────────┐
│              Litestream 架构                 │
│                                             │
│  [SQLite DB] ──WAL 监听──> [Litestream]    │
│                                    │        │
│                           ┌────────┴────┐   │
│                           │ 流式复制    │   │
│                           └────────┬────┘   │
│                    ┌───────────────┼────────┐│
│                    ▼               ▼        ▼│
│               [S3]           [GCS]    [Azure]│
│                                             │
│  [灾难恢复] <──WAL 重放── [对象存储]        │
└─────────────────────────────────────────────┘
```

**核心特性：**
- **连续流式备份**：非定期快照，而是持续流式复制 WAL 帧
- **点-in-time 恢复（PITR）**：可恢复到任意时间点
- **零应用改动**：透明代理，无需修改应用代码
- **极低开销**：异步复制，不影响写入性能
- **多目标存储**：支持 S3、GCS、Azure Blob、SFTP 等

**安装与配置：**
```bash
# 安装 Litestream
brew install litestream  # macOS
# 或
wget https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb

# 配置 /etc/litestream.yml
dbs:
  - path: /var/lib/app/database.sqlite
    replicas:
      - url: s3://mybucket/db
        access-key-id: ${AWS_ACCESS_KEY_ID}
        secret-access-key: ${AWS_SECRET_ACCESS_KEY}
        sync-interval: 1s   # 每秒同步一次
        retention: 720h     # 保留 30 天

# 启动 Litestream（伴随应用运行）
litestream replicate
```

**灾难恢复：**
```bash
# 恢复到最新状态
litestream restore -o /var/lib/app/database.sqlite s3://mybucket/db

# 恢复到指定时间点
litestream restore -timestamp 2026-06-03T12:00:00Z \
    -o /var/lib/app/database.sqlite s3://mybucket/db

# 生成时间线报告
litestream generations s3://mybucket/db
```

**Laravel 与 Litestream 集成部署：**
```yaml
# docker-compose.yml
services:
  app:
    build: .
    volumes:
      - sqlite-data:/var/lib/app/database
    depends_on:
      - litestream

  litestream:
    image: litestream/litestream:latest
    command: replicate /var/lib/app/database/database.sqlite
    environment:
      LITESTREAM_REPLICA_URL: s3://mybucket/laravel-db
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
    volumes:
      - sqlite-data:/var/lib/app/database

volumes:
  sqlite-data:
```

### 5. Supabase：开源 Firebase 替代

Supabase 是基于 PostgreSQL 的开源后端即服务（BaaS），提供类似 Firebase 的开发体验：

**核心服务矩阵：**

| 服务 | 功能 | 底层技术 |
|------|------|----------|
| Database | 托管 PostgreSQL，支持实时订阅 | PostgreSQL + PostgREST |
| Auth | 用户认证与授权 | GoTrue（基于 Go） |
| Storage | 文件存储与管理 | PostgreSQL + S3 兼容 |
| Realtime | 实时数据订阅 | Elixir + Phoenix Channels |
| Edge Functions | 无服务器函数 | Deno + TypeScript |
| Vector | AI 向量搜索 | pgvector 扩展 |

**实时数据库订阅原理：**
```
┌─────────────────────────────────────────────┐
│           Supabase Realtime 架构            │
│                                             │
│  [PostgreSQL] ──Logical Decoding──> [Elixir │
│       │                              Realtime│
│       │                              Server] │
│       │                                  │   │
│  [PostgREST] <──REST API──  [客户端SDK]  │   │
│       │                        │         │   │
│  [Web API] <──SQL API──  [WebSocket连接] <┘  │
└─────────────────────────────────────────────┘
```

**在 Laravel 中集成 Supabase：**
```php
// 使用 Supabase PHP 客户端
use Supabase\CreateClient\SupabaseClient;

$client = new SupabaseClient(
    env('SUPABASE_URL'),
    env('SUPABASE_ANON_KEY')
);

// 数据库操作（通过 REST API）
$result = $client->from('posts')
    ->select('*')
    ->eq('status', 'published')
    ->order('created_at', 'desc')
    ->limit(10)
    ->execute();

// 认证操作
$user = $client->auth->signUp([
    'email' => 'user@example.com',
    'password' => 'secure-password',
]);
```

**Supabase 与 Laravel 的混合架构：**
```
[前端应用]
    ├── Supabase Auth（认证）── JWT Token ──> [Laravel API]
    ├── Supabase Realtime（实时订阅）──直接推送──> [前端]
    └── Laravel API（业务逻辑）──> [PostgreSQL/Supabase DB]
```

### 6. SQLite 在生产环境的最佳实践

**WAL 模式配置：**
```sql
-- 启用 WAL 模式（提升并发读写性能）
PRAGMA journal_mode=WAL;

-- 设置 WAL 自动检查点阈值
PRAGMA wal_autocheckpoint=1000;

-- 设置忙等待超时（毫秒）
PRAGMA busy_timeout=5000;

-- 同步模式（性能与安全的平衡）
PRAGMA synchronous=NORMAL;  -- WAL 模式下 NORMAL 即可

-- 启用外键约束
PRAGMA foreign_keys=ON;

-- 设置缓存大小（页数，负值表示 KB）
PRAGMA cache_size=-64000;  -- 64MB

-- 启用内存映射 IO
PRAGMA mmap_size=268435456;  -- 256MB
```

**Laravel SQLite 生产环境配置：**
```php
// config/database.php
'sqlite' => [
    'driver' => 'sqlite',
    'url' => env('DATABASE_URL'),
    'database' => database_path('database.sqlite'),
    'prefix' => '',
    'foreign_key_constraints' => env('DB_FOREIGN_KEYS', true),
    'options' => [
        // 自定义 PDO 连接选项
    ],
],

// 在 AppServiceProvider 中配置 SQLite PRAGMA
public function boot(): void
{
    if (config('database.default') === 'sqlite') {
        DB::statement('PRAGMA journal_mode=WAL');
        DB::statement('PRAGMA busy_timeout=5000');
        DB::statement('PRAGMA synchronous=NORMAL');
        DB::statement('PRAGMA cache_size=-64000');
    }
}
```

### 7. 边缘数据库架构对比

| 方案 | 类型 | 复制方式 | 适用规模 | 运维复杂度 | 成本 |
|------|------|----------|----------|-----------|------|
| 原生 SQLite | 嵌入式 | 无 | 小型单机 | 极低 | 免费 |
| SQLite + Litestream | 嵌入式 + 流式备份 | WAL 流式复制 | 小中型 | 低 | 对象存储费用 |
| libSQL / Turso | 边缘 DBaaS | 内置全球复制 | 中小型 | 低 | 按量计费 |
| Supabase | 云 BaaS | PostgreSQL 内置 | 中型 | 中 | 免费层可用 |
| PlanetScale | 托管 MySQL | Vitess 分片 | 中大型 | 低 | 按量计费 |
| Neon | 所在 PostgreSQL | 内置分支 | 中型 | 低 | 按量计费 |

### 8. 架构选型决策树

```
需要数据库方案
├── 单机部署，流量小？
│   └── SQLite + Litestream（备份到 S3，成本最低）
├── 全球用户，读多写少？
│   └── Turso（libSQL 边缘复制，读延迟最低）
├── 需要实时订阅和认证？
│   └── Supabase（开箱即用的 BaaS）
├── 需要关系型数据库 + Serverless？
│   └── Neon（Serverless PostgreSQL）
└── 需要大规模分片？
    └── PlanetScale（Vitess 分片 MySQL）
```

## 实战案例

### 案例一：SQLite + Litestream 零成本高可用方案

**场景描述：** 一个中低流量的 SaaS 应用，月活用户 5000，预算有限。

**方案：** SQLite 作为主数据库 + Litestream 流式备份到 S3

**博客文章参考：** [Litestream 实战：SQLite流式复制与灾难恢复-零依赖高可用方案](/2026/06/03/Litestream-实战-SQLite流式复制与灾难恢复-零依赖高可用方案/)

**架构：**
```
[DigitalOcean Droplet ($6/月)]
    ├── [Laravel + SQLite (WAL)]
    └── [Litestream] ──流式备份──> [S3 Standard-IA ($0.01/GB)]

月成本：~$7（服务器 + 存储），零数据库许可费用
```

### 案例二：Turso 边缘数据库 Laravel 集成

**场景描述：** 面向全球用户的博客/内容平台，读多写少，需要低延迟。

**方案：** Turso 作为主数据库，边缘 Replica 就近读取

**博客文章参考：** [SQLite 现代化实战：libSQL/Turso 边缘数据库 Laravel集成](/2026/06/03/SQLite-现代化实战-libSQL-Turso-边缘数据库-Laravel集成/)

### 案例三：Supabase 实时数据库与 Laravel 集成

**场景描述：** 需要实时通知、用户认证、文件存储的全栈应用。

**方案：** Laravel 处理业务逻辑，Supabase 提供实时订阅和认证

**博客文章参考：** [Supabase 实战：开源Firebase替代-实时数据库Auth与Laravel集成](/2026/06/03/Supabase-实战-开源Firebase替代-实时数据库Auth与Laravel集成/)

## 相关概念

- [六边形架构](六边形架构.md) - 边缘数据库在端口-适配器架构中的位置
- [事件驱动架构](事件驱动架构.md) - Supabase Realtime 的事件订阅机制
- [CQRS模式](CQRS模式.md) - 边缘 Replica 实现读写分离的 CQRS 变体
- [微服务架构](微服务架构.md) - 边缘数据库在微服务中的适用场景
- [BFF模式](BFF模式.md) - BFF 层的数据库选型策略
- [CDC与事件流](CDC与事件流.md) - SQLite WAL 与 CDC 模式的关联

## 常见问题

### Q1: SQLite 真的能在生产环境使用吗？

**是的。** SQLite 在生产环境中的使用已经非常成熟：
- Turso 团队在生产环境大规模使用 libSQL
- Litestream 提供了可靠的流式复制和灾难恢复
- Fly.io、Railway 等平台原生支持 SQLite 应用
- Django、Rails 等框架的官方文档均包含 SQLite 生产配置指南
- 关键原则：启用 WAL 模式、设置 busy_timeout、定期备份

### Q2: SQLite WAL 模式与传统 Journal 模式有什么区别？

| 特性 | DELETE/Rollback Journal | WAL (Write-Ahead Log) |
|------|------------------------|----------------------|
| 并发读写 | 读写互斥 | 读写可并发 |
| 写入性能 | 较慢（需要复制页面） | 较快（追加写入 WAL） |
| 文件数量 | 单文件 + 临时 journal | 数据库 + WAL + SHM |
| 检查点 | 写入完成后立即 | 异步检查点 |
| 崩溃恢复 | 回滚未完成事务 | 重放 WAL |
| 推荐场景 | 只读或极少写入 | 生产环境首选 |

### Q3: Turso 和 PlanetScale 的主要区别是什么？

- **Turso**：基于 libSQL（SQLite 分叉），嵌入式副本，极低读延迟，适合读多写少场景
- **PlanetScale**：基于 Vitess（MySQL 分片），在线 Schema 变更，适合大规模 OLTP
- **选择建议**：小中型应用读多写少选 Turso，中大型应用需要 MySQL 兼容选 PlanetScale

### Q4: Litestream 的 RPO（恢复点目标）是多少？

- **sync-interval=1s**：RPO 约 1 秒（推荐生产配置）
- **sync-interval=100ms**：RPO 约 100ms（高要求场景）
- **默认值**：1 秒
- **注意**：RPO 指的是最近一次成功同步到对象存储的 WAL 帧时间

### Q5: Supabase 的 Realtime 订阅和 Laravel Broadcasting 有什么区别？

- **Supabase Realtime**：直接从 PostgreSQL 的 Logical Decoding 获取变更，推送到客户端 WebSocket
- **Laravel Broadcasting**：需要应用层触发事件，通过 Redis/Pusher 推送到客户端
- **区别**：Supabase 是数据库级别的实时通知，Laravel 是应用级别的事件广播
- **选择建议**：如果需要数据库行级实时通知，用 Supabase；如果是业务事件驱动，用 Laravel Broadcasting

### Q6: SQLite 的单写入者限制在高并发写入场景下如何解决？

1. **WAL 模式 + busy_timeout**：写入排队等待，适合低并发写入
2. **应用层队列化**：将写入操作通过消息队列串行化
3. **分片**：将数据拆分到多个 SQLite 文件
4. **切换到 libSQL**：libSQL 支持多节点写入（通过 Primary-Replica 架构）
5. **读写分离 CQRS**：写入走 Primary，读取走 Replica
6. **如果写入量真的很大**：考虑切换到 PostgreSQL/MySQL

### Q7: 如何在 Docker 中正确使用 SQLite？

```dockerfile
FROM php:8.3-fpm

# 安装 SQLite 扩展
RUN apt-get update && apt-get install -y sqlite3 libsqlite3-dev

# 数据卷挂载（不要将数据库放在容器层）
VOLUME /var/lib/app/database

# 在宿主机或持久化卷中存储数据库
```

```yaml
# docker-compose.yml
services:
  app:
    volumes:
      - db-data:/var/lib/app/database
  # Litestream sidecar 用于备份
  litestream:
    volumes:
      - db-data:/var/lib/app/database

volumes:
  db-data:
```

### Q8: 边缘数据库如何处理 GDPR 数据本地化要求？

1. **Turso**：支持选择特定区域的 Replica，将欧洲用户数据限制在欧洲节点
2. **Supabase**：支持选择数据中心区域
3. **Litestream**：可将备份目标设为特定区域的 S3 Bucket
4. **关键原则**：选择支持数据区域化（Data Residency）的方案
