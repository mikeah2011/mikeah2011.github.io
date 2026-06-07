# PlanetScale Serverless MySQL

## 定义

PlanetScale 是基于 **Vitess** 的无服务器 MySQL 平台，提供数据库分支工作流（Database Branching）、Online DDL、自动扩缩与零停机 Schema 变更能力。它将 Git 式的工作流引入数据库管理，让 Schema 变更像代码变更一样可审查、可回滚。

## 核心原理

### Vitess 引擎

PlanetScale 底层使用 Vitess（YouTube 开源的 MySQL 集群管理系统）：

| 能力 | 说明 |
|------|------|
| **水平分片** | 自动将大表拆分到多个 MySQL 实例 |
| **连接池** | VTgate 代理层管理连接复用 |
| **查询路由** | 自动将查询路由到正确的分片 |
| **Online DDL** | 零停机 Schema 变更，不锁表 |

### Database Branching

类似 Git 分支的数据库工作流：

```
main 分支（生产数据库）
  │
  ├── create-indexes 分支（开发环境）
  │     ├── 添加索引
  │     ├── 修改列类型
  │     └── Deploy Request → 审查 → 合并
  │
  └── add-columns 分支（开发环境）
        └── Deploy Request → 审查 → 合并
```

核心流程：
1. **创建分支**：从 production 创建开发分支，自动复制 Schema（不含数据或含部分数据）
2. **Schema 变更**：在分支上自由修改，不影响生产
3. **Deploy Request**：提交变更请求，自动分析影响
4. **审查与合并**：审查 DDL diff，合并到 production
5. **Online DDL 执行**：Vitess 在后台无锁执行 Schema 变更

### 与 Laravel 集成

PlanetScale 兼容 MySQL 协议，Laravel 可直接使用：

```php
// config/database.php
'mysql' => [
    'driver' => 'mysql',
    'host' => env('PLANETSCALE_HOST'),
    'database' => env('PLANETSCALE_DATABASE'),
    'username' => env('PLANETSCALE_USERNAME'),
    'password' => env('PLANETSCALE_PASSWORD'),
    'sslmode' => 'require',
    // PlanetScale 不支持外键约束
    'options' => extension_loaded('pdo_mysql') ? array_filter([
        PDO::MYSQL_ATTR_SSL_CA => env('MYSQL_ATTR_SSL_CA'),
    ]) : [],
],
```

> **注意**：PlanetScale 默认不支持外键约束（Vitess 限制），需在应用层或通过 ORM 关系维护引用完整性。

## 关键特性对比

| 特性 | 传统 MySQL | PlanetScale |
|------|-----------|-------------|
| Schema 变更 | ALTER TABLE 锁表 | Online DDL 无锁 |
| 数据库分支 | 无 | Git 式分支工作流 |
| 水平扩展 | 手动分库分表 | Vitess 自动分片 |
| 连接管理 | 应用层连接池 | VTgate 代理层 |
| 外键约束 | 支持 | 不支持（Vitess 限制） |
| 价格模型 | 按实例 | 按使用量（行读写） |

## 实战文章

来自博客文章：[PlanetScale Serverless MySQL 实战：Vitess 驱动的无服务器数据库——与 Laravel 集成的分支工作流、Online DDL 与性能基准](/2026/06/05/planetscale-serverless-mysql-laravel-vitess-workflow-benchmark/)

## 相关概念

- [Database Branching](Database-Branching.md) - Neon/PlanetScale 数据库分支工作流对比
- [主从复制与读写分离](主从复制与读写分离.md) - 传统 MySQL 高可用方案
- [分库分表](分库分表.md) - 手动分片 vs Vitess 自动分片
- [数据库连接池](数据库连接池.md) - ProxySQL vs VTgate 连接管理
- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - 数据库选型决策

## 常见问题

**Q: PlanetScale 不支持外键，怎么保证数据一致性？**
A: 三种方案：① 应用层通过 ORM 关系维护 ② 数据库触发器 ③ 定期对账脚本。实际上很多大规模系统已经在应用层管理引用完整性。

**Q: PlanetScale 的分支数据是完整复制的吗？**
A: 开发分支默认只复制 Schema，不含数据（或可配置为包含部分数据）。这使得分支创建非常快且不额外计费。

**Q: 与 Neon（PostgreSQL）的 Database Branching 有什么区别？**
A: PlanetScale 基于 MySQL/Vitess，Neon 基于 PostgreSQL。两者都支持数据库分支，但底层引擎和功能限制不同。PlanetScale 更适合 MySQL 生态，Neon 更适合 PostgreSQL 生态。
