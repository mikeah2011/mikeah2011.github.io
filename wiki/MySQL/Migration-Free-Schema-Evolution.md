# Migration-Free Schema Evolution（无迁移 Schema 演进）

## 定义

Migration-Free Schema Evolution 是一种数据库 Schema 管理范式，通过声明式工具（如 Atlas、Bytebase）将 Schema 定义为代码（Schema as Code），自动计算差异（diff）并生成迁移脚本，替代传统的手写 Migration 文件方式。

## 核心原理

### 传统 Migration 的问题

Laravel 的 Migration 系统（`php artisan make:migration`）是命令式的：

```php
// 传统方式：手写迁移步骤
Schema::table('orders', function (Blueprint $table) {
    $table->string('tracking_number')->nullable();
    $table->index(['status', 'created_at']);
});
```

问题：
- **不可逆**：迁移执行后难以回退（`down()` 方法经常不写或写错）
- **状态分散**：当前 Schema 状态散落在数百个迁移文件中
- **冲突多**：多人同时创建迁移容易冲突
- **审查难**：看一个迁移文件无法知道最终状态

### 声明式 Schema 管理

Atlas/Bytebase 的方式是**声明目标状态**，工具自动计算差异：

```hcl
// Atlas HCL - 声明目标状态
table "orders" {
  schema = schema.public
  column "id" {
    type = bigint
    auto_increment = true
  }
  column "status" {
    type = varchar(50)
    default = "pending"
  }
  column "tracking_number" {
    type = varchar(100)
    null = true
  }
  index "idx_status_created" {
    columns = [column.status, column.created_at]
  }
}
```

工具流程：
1. **定义目标状态**（声明式 Schema 文件）
2. **获取当前状态**（连接数据库，读取实际 Schema）
3. **计算 diff**（自动对比差异）
4. **生成迁移 SQL**（安全的 ALTER 语句）
5. **审查 & 执行**（人工确认后执行）

### Atlas vs Bytebase vs Laravel Migrations

| 维度 | Laravel Migrations | Atlas | Bytebase |
|------|-------------------|-------|----------|
| 范式 | 命令式 | 声明式 | 声明式 + GUI |
| Schema 定义 | 分散在迁移文件中 | 单一 HCL/SQL 文件 | 数据库 Schema |
| Diff 计算 | 手动 | 自动 | 自动 |
| 回滚 | 手写 `down()` | 自动计算反向 SQL | 自动 + 审批流 |
| 多环境 | 迁移文件 + seeder | Schema 文件 + env | 环境管理 + 审批 |
| CI/CD 集成 | `migrate` 命令 | `atlas schema diff` | API + Webhook |
| 团队协作 | 迁移冲突常见 | Schema 文件合并 | GUI 审批流 |

### 与 Laravel 的集成方案

**方案一：Atlas 作为补充**
```bash
# 安装 Atlas
curl -sSL https://atlasgo.sh | sh

# 从现有数据库导出 Schema
atlas schema inspect --url "mysql://user:pass@localhost/db" > schema.hcl

# 对比差异
atlas schema diff \
  --from "mysql://user:pass@localhost/prod" \
  --to "file://schema.hcl"

# 生成并执行迁移
atlas schema apply \
  --url "mysql://user:pass@localhost/prod" \
  --to "file://schema.hcl"
```

**方案二：保持 Laravel Migration + Bytebase 审批**
```
开发者创建 Migration → Git Push → CI 运行 Bytebase 审批 → 合并后自动执行
```

## 适用场景

| 场景 | 推荐方案 |
|------|---------|
| 小团队、简单项目 | Laravel Migrations 足够 |
| 多环境、频繁 Schema 变更 | Atlas 声明式 |
| 大团队、需要审批流 | Bytebase GUI + 审批 |
| 已有大量迁移历史 | 保持 Laravel + 引入 Atlas diff |

## 实战文章

来自博客文章：[Migration-Free Schema Evolution 实战：Atlas/Bytebase 数据库 Schema 即代码——对比 Laravel Migrations 的 DDL 管理新范式](/2026/06/05/Migration-Free-Schema-Evolution-实战-Atlas-Bytebase数据库Schema即代码-对比Laravel-Migrations的DDL管理新范式/)

## 相关概念

- [PlanetScale Serverless MySQL](PlanetScale-Serverless-MySQL.md) - Online DDL + Database Branching
- [Database Branching](Database-Branching.md) - Neon/PlanetScale 分支工作流
- [主从复制与读写分离](主从复制与读写分离.md) - Schema 变更在主从架构下的传播

## 常见问题

**Q: Atlas 能完全替代 Laravel Migrations 吗？**
A: 技术上可以，但不建议。Laravel Migrations 除了 DDL 还承担 Seed 数据、队列任务等职责。推荐 Atlas 处理 Schema DDL，Laravel Migrations 处理数据迁移和业务逻辑。

**Q: 声明式 Schema 如何处理数据迁移（如列重命名、数据格式转换）？**
A: 声明式工具主要处理 DDL，数据迁移仍需手写 SQL 或脚本。Atlas 支持在 Schema 变更前后挂钩自定义脚本。
