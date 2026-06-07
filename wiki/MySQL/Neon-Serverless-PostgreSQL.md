# Neon Serverless PostgreSQL

## 定义

Neon 是一个开源的 **Serverless PostgreSQL** 平台，核心特性是数据库分支（Database Branching）、自动扩缩容（Scale-to-Zero）与存储计算分离架构。它将 PostgreSQL 的能力与云原生的弹性相结合，特别适合开发工作流中的数据库管理。

## 核心原理

### 存储计算分离架构

Neon 将 PostgreSQL 拆分为两个独立层：

```
┌─────────────────────────────────┐
│       Compute Layer             │
│  (无状态 PostgreSQL 进程)         │
│  - 自动扩缩容                    │
│  - Scale-to-Zero               │
│  - 每个分支独立 Compute          │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│       Storage Layer             │
│  (Neon 自研分布式存储)            │
│  - 基于 Pageserver             │
│  - WAL 流式复制                 │
│  - 分支 = Copy-on-Write 快照    │
└─────────────────────────────────┘
```

### Database Branching（数据库分支）

Neon 的分支基于 **Copy-on-Write**，创建分支几乎是零成本的：

| 操作 | 传统方式 | Neon Branching |
|------|---------|---------------|
| 创建分支 | 完整复制数据库（分钟级） | CoW 快照（毫秒级） |
| 存储成本 | 双倍存储 | 仅存储差异 |
| 数据一致性 | 取决于复制方式 | 即时一致 |
| 用途 | 备份、测试 | PR Review、预览环境 |

### PR 级数据库 Review

Neon 最独特的功能是与 GitHub PR 集成：

```
开发者创建 PR
    ↓
Neon GitHub App 自动创建数据库分支
    ↓
CI/CD 使用分支数据库运行测试
    ↓
审查者可在分支数据库上查询验证
    ↓
PR 合并后自动删除分支
```

### 与 Laravel 集成

```php
// config/database.php
'pgsql' => [
    'driver' => 'pgsql',
    'host' => env('NEON_HOST'),      // ep-xxx.us-east-2.aws.neon.tech
    'port' => '5432',
    'database' => env('NEON_DATABASE'),
    'username' => env('NEON_USERNAME'),
    'password' => env('NEON_PASSWORD'),
    'sslmode' => 'require',
    'options' => [
        // Neon 需要 SSL
        PDO::ATTR_SSL_VERIFY_SERVER_CERT => false,
    ],
],
```

分支数据库连接：
```bash
# 主分支
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/main

# PR 分支（自动生成）
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/br-xxx
```

## Neon vs PlanetScale vs Supabase

| 维度 | Neon | PlanetScale | Supabase |
|------|------|-------------|----------|
| 数据库 | PostgreSQL | MySQL (Vitess) | PostgreSQL |
| 分支 | ✅ CoW 快照 | ✅ Vitess 分支 | ❌ |
| Scale-to-Zero | ✅ | ❌ | ✅ |
| 外键支持 | ✅ | ❌ | ✅ |
| 价格模型 | 计算时间 + 存储 | 行读写 | 按项目 |
| 开源 | ✅ | ❌ | ✅ |
| 适合场景 | PG 生态、开发工作流 | MySQL 生态、大规模 | 全栈 BaaS |

## 实战文章

来自博客文章：[Neon Serverless PostgreSQL 实战：分支工作流与 Laravel 开发体验——Database Preview 与 PR 级数据库 Review 的工程化落地](/2026/06/05/Neon-Serverless-PostgreSQL-实战-分支工作流与Laravel-开发体验/)

## 相关概念

- [Database Branching](Database-Branching.md) - Neon/PlanetScale 数据库分支工作流对比
- [PlanetScale Serverless MySQL](PlanetScale-Serverless-MySQL.md) - MySQL 生态的类似方案
- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - 数据库选型决策
- [数据库连接池](数据库连接池.md) - Serverless 场景下的连接管理
- [Migration-Free Schema Evolution](Migration-Free-Schema-Evolution.md) - 声明式 Schema 管理

## 常见问题

**Q: Neon 的 Scale-to-Zero 会导致首次查询延迟吗？**
A: 会。冷启动时 Neon 需要唤醒 Compute 节点，通常需要 500ms-2s。对延迟敏感的应用可以配置最小 Compute 为 1（不缩到零）。

**Q: Neon 分支的性能和主分支一样吗？**
A: 分支有独立的 Compute 资源，性能取决于分配的 Compute 大小。但首次查询可能需要从 Storage Layer 加载数据页（冷页），会有额外延迟。

**Q: 能用 Neon 替代本地 PostgreSQL 开发环境吗？**
A: 可以，而且推荐。每个开发者可以有自己的分支，互不干扰。配合 Neon GitHub App，PR 自动获得预览数据库，极大改善开发体验。
