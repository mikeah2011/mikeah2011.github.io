# FerretDB 文档数据库

## 定义

FerretDB（原名 MangoDB）是基于 PostgreSQL 驱动的开源 MongoDB 替代方案，采用 Apache 2.0 许可证。它将 MongoDB 的线协议（wire protocol）翻译为 SQL，让 PostgreSQL 作为后端存储引擎，实现完全兼容 MongoDB API 的文档数据库。

## 核心原理

### 协议转换架构

```
应用程序 (mongosh/Laravel) ── MongoDB Wire Protocol ──→ FerretDB (协议转换引擎)
                                                              │
                                                         SQL + JSONB
                                                              ↓
                                                         PostgreSQL (JSONB 存储)
```

### 数据映射机制

| MongoDB 概念 | PostgreSQL 映射 |
|---|---|
| Database | Schema |
| Collection | Table |
| Document | Row（JSONB 列） |
| `_id` 字段 | 主键（`_jsonb` JSONB 列 + 物化 `_id` 列） |
| Index | GIN / B-tree 索引 |

底层存储表结构：

```sql
CREATE TABLE "ferretdb"."articles" (
    _jsonb jsonb NOT NULL,
    CONSTRAINT articles_pkey PRIMARY KEY ((_jsonb -> '_id'))
);
CREATE INDEX articles__jsonb_idx ON "ferretdb"."articles" USING gin (_jsonb);
```

### 为什么选择 FerretDB

1. **许可证合规**：MongoDB 的 SSPL 许可证不被 OSI 认可，FerretDB 采用 Apache 2.0
2. **零学习成本**：兼容 MongoDB API，现有 mongosh/mongoose 代码可直接使用
3. **复用 PostgreSQL 生态**：备份、监控、扩展全部沿用 PG 基础设施
4. **避免供应商锁定**：开放标准，无商业限制

## 与 MongoDB 的兼容性

| 功能 | 支持状态 |
|------|---------|
| CRUD 操作 | ✅ 完全支持 |
| 索引（B-tree/GIN） | ✅ 支持 |
| 聚合管道 | ⚠️ 部分支持 |
| 事务 | ⚠️ 有限支持 |
| Change Stream | ❌ 暂不支持 |
| GridFS | ❌ 暂不支持 |

## Laravel 集成

使用 `mongodb/laravel-mongodb` 包，只需将连接配置指向 FerretDB：

```php
// config/database.php
'mongodb' => [
    'driver' => 'mongodb',
    'host' => env('MONGO_DB_HOST', '127.0.0.1'),
    'port' => env('MONGO_DB_PORT', 27017),
    'database' => env('MONGO_DB_DATABASE', 'laravel'),
    'username' => env('MONGO_DB_USERNAME'),
    'password' => env('MONGO_DB_PASSWORD'),
],
```

Laravel Model 不需要任何修改：

```php
class Article extends \MongoDB\Laravel\Eloquent\Model
{
    protected $connection = 'mongodb';
    protected $collection = 'articles';
}
```

## Docker Compose 部署

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: ferretdb
      POSTGRES_USER: ferretdb
      POSTGRES_PASSWORD: ferretdb

  ferretdb:
    image: ghcr.io/ferretdb/ferretdb:latest
    ports:
      - "27017:27017"
    environment:
      FERRETDB_POSTGRESQL_URL: postgres://ferretdb:ferretdb@postgres:5432/ferretdb
```

## 实战案例

来自博客文章：
- [FerretDB 实战：开源 MongoDB 替代——PostgreSQL 驱动的文档数据库与 Laravel 集成](/categories/数据库/2026-06-07-FerretDB-实战-开源MongoDB替代-PostgreSQL驱动文档数据库-Laravel集成/)

## 相关概念

- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - PostgreSQL 生态优势
- [JSON 列深度实战](JSON列深度实战.md) - MySQL JSONB/JSON 存储
- [边缘数据库与 SQLite 现代化](../架构设计/边缘数据库与SQLite现代化.md) - 嵌入式文档存储选型

## 常见问题

**Q: FerretDB 性能与 MongoDB 相比如何？**
A: 简单 CRUD 操作性能接近（80-95%），复杂聚合管道可能有差距。对于大多数 Web 应用场景，性能差异可忽略。

**Q: 什么时候该选 FerretDB vs MongoDB？**
A: 如果关注许可证合规（商业产品嵌入）、已有 PostgreSQL 运维能力、或需要避免供应商锁定，选 FerretDB。如果需要完整的 MongoDB 生态（Change Stream、Atlas 全托管等），选 MongoDB。

**Q: 能否从 MongoDB 迁移到 FerretDB？**
A: 可以。使用 `mongodump`/`mongorestore` 工具进行数据迁移，应用层代码几乎不需要修改。
