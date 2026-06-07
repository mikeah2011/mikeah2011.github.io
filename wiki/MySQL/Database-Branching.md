# Database Branching（数据库分支）

## 定义

Database Branching 将 Git 分支的理念引入数据库层：每一个代码分支都可以拥有对应的独立数据库分支，包含完整的 Schema 和可选的测试数据。创建速度极快（毫秒级 Copy-on-Write），成本极低。主流平台：**Neon**（Serverless PostgreSQL）和 **PlanetScale**（基于 Vitess 的 MySQL）。

## 核心原理

### Copy-on-Write 机制

传统数据库复制需要完整数据拷贝，Database Branching 采用写时复制：

1. 创建分支时，新分支与父分支**共享底层存储页**
2. 只有当某个页被修改时，才产生独立副本
3. 100GB 数据库的分支几乎瞬间创建，额外存储成本极低

```
main 分支 ─── production DB (users, orders, products...)
  │
  ├── feature/payment ─── DB branch (新增 payments 表)
  │
  ├── feature/audit ─── DB branch (users 表新增 audit_log 列)
  │
  └── feature/reporting ─── DB branch (新增 views 统计表)
```

### 与传统迁移工作流的对比

| 维度 | 传统 Migration | Database Branching |
|------|---------------|-------------------|
| 分支创建速度 | N/A | 毫秒级（Copy-on-Write） |
| PR 中 Schema 预览 | 需人脑解析迁移文件 | 自动生成 Schema Diff |
| 测试隔离 | 共享数据库，互相干扰 | 每个分支独立数据库 |
| 迁移冲突检测 | 合并后才发现 | PR 阶段自动检测 |
| 数据回滚 | 需手动编写 rollback | 删除分支即可回滚 |
| CI/CD 集成 | 需手动创建临时数据库 | 自动创建分支数据库 |

## 主流平台对比

### Neon（Serverless PostgreSQL）

- **架构**：存储层与计算层分离，计算节点可自动休眠
- **分支特性**：即时分支、Schema Diff、GitHub 集成
- **免费套餐**：慷慨，适合个人开发者和小团队
- **适用场景**：PostgreSQL 技术栈、Serverless 优先

### PlanetScale（基于 Vitess 的 MySQL）

- **架构**：基于 Vitess 分片引擎，兼容 MySQL 协议
- **分支特性**：Deploy Requests（类似 PR）、Schema Diff、在线 DDL
- **安全机制**：不支持外键（Vitess 限制），需应用层保证引用完整性
- **适用场景**：MySQL 技术栈、大规模分片需求

## Laravel 集成

### CI/CD 中的数据库分支

```yaml
# GitHub Actions 示例
- name: Create DB branch
  run: neonctl branches create --project-id $PROJECT_ID --name pr-$PR_NUMBER

- name: Run migrations on branch
  run: php artisan migrate --database=branch

- name: Run tests
  run: php artisan test

- name: Delete DB branch
  run: neonctl branches delete --project-id $PROJECT_ID --name pr-$PR_NUMBER
```

### Schema Preview in PR

Neon 和 PlanetScale 都支持在 PR 中自动展示 Schema Diff，审查者可以直接看到：
- 新增/删除的表和列
- 索引变更
- 数据类型修改
- 潜在的破坏性变更警告

## 实战案例

来自博客文章：
- [Database Branching 实战：Neon/PlanetScale 分支工作流——Laravel 开发中的数据库 Schema Preview 与 PR Review](/2026/06/01/database-branching-neon-planetscale-laravel/)
- [PlanetScale Serverless MySQL 实战：Vitess 驱动的无服务器数据库——与 Laravel 集成的分支工作流、Online DDL 与性能基准](/2026/06/05/planetscale-serverless-mysql-laravel-vitess-workflow-benchmark/)
- [Neon Serverless PostgreSQL 实战：分支工作流与 Laravel 开发体验——Database Preview 与 PR 级数据库 Review 的工程化落地](/2026/06/05/Neon-Serverless-PostgreSQL-实战-分支工作流与Laravel-开发体验/)

## 相关概念

- [数据库迁移](../PHP-Laravel/数据库迁移.md) — Laravel Migration 传统方案
- [PlanetScale Serverless MySQL](PlanetScale-Serverless-MySQL.md) — Vitess 引擎、Online DDL、分支工作流详解
- [Neon Serverless PostgreSQL](Neon-Serverless-PostgreSQL.md) — 存储计算分离、CoW 分支详解
- [Migration-Free Schema Evolution](Migration-Free-Schema-Evolution.md) — Atlas/Bytebase 声明式 Schema 管理
- [主从复制与读写分离](主从复制与读写分离.md) — 运行时数据同步
- [分库分表](分库分表.md) — PlanetScale 底层 Vitess 的核心能力

## 常见问题

**Q: Database Branching 可以替代 Migration 吗？**
A: 不能完全替代。Branching 解决的是开发/测试阶段的隔离问题，生产环境仍需 Migration 管理 Schema 变更。

**Q: PlanetScale 不支持外键怎么办？**
A: 在应用层用 Eloquent 关联保证引用完整性，或使用数据库触发器。PlanetScale 提供 `foreign_key_checks` 选项可在导入时临时启用。

**Q: Neon 的冷启动延迟会影响生产环境吗？**
A: Neon 计算节点休眠后首次查询有冷启动延迟（通常 500ms-2s），生产环境建议配置 min_cu > 0 保持常驻。
