# Eloquent 与数据库

## 定义
Eloquent 是 Laravel 的 ActiveRecord ORM，博客中深度覆盖了模型设计、数据库迁移、查询构建器、Scopes、Casts/Accessors、全文搜索、多租户数据隔离等实践。

## 核心原理

### Eloquent 模型
- ActiveRecord 模式：模型即表映射
- $fillable / $guarded 批量赋值保护
- $casts 类型转换（JSON、日期、枚举）
- $appends 计算属性
- 模型事件（creating/created/updating/updated/deleting/deleted）

### 数据库迁移（Migration）
- Schema Builder：创建/修改表结构
- 零停机数据库变更策略
- 回滚机制（rollback/refresh/fresh）
- 迁移与生产环境安全

### 查询构建器
- Eloquent Query Builder vs DB Facade
- 分页（simplePaginate/paginate/cursorPaginate）
- 预加载（eager loading）与 N+1 问题
- 子查询与复杂联表

### Scopes（查询作用域）
- 全局 Scope：模型级默认约束
- 本地 Scope：可复用的查询条件
- 动态 Scope：参数化查询封装
- 复杂筛选条件复用实践

### Casts 与 Accessors
- Casts：数据库值与 PHP 类型自动转换
- Accessors：自定义属性获取逻辑
- Mutators：自定义属性设置逻辑
- 数据类型转换最佳实践

### 全文搜索
- 数据库原生全文索引（MySQL FULLTEXT / PostgreSQL tsvector）
- Laravel Scout 全文搜索抽象
- Elasticsearch 集成与深度调优
- 多字段映射、分词策略

### 多租户数据隔离
- PostgreSQL RLS（行级安全策略）
- 连接切换（独立库模式）
- 共享库 + tenant_id 过滤
- 策略下推与连接池上下文

### PostgreSQL 高级特性
- SKIP LOCKED：任务出队与死锁规避
- Advisory Lock：会话级互斥锁
- CDC（Change Data Capture）：Debezium 驱动变更同步

## 实战案例
来自博客文章：
- [Laravel Scopes 实战](/categories/PHP-Laravel/laravel-scopes-guide/) - 查询作用域封装与复用
- [Laravel Casts/Accessors 实战](/categories/PHP-Laravel/laravel-casts-accessors-guide/) - 数据类型转换与计算属性
- [Laravel Migrations 零停机变更](/categories/PHP-Laravel/laravel-migrations-database/) - 数据库变更与回滚策略
- [Laravel Full-Text Search](/categories/PHP-Laravel/laravel-full-text-search/) - 数据库原生全文搜索与 Scout 对比
- [Laravel + PostgreSQL RLS](/categories/PHP-Laravel/laravel-postgresql-rls-guide/) - 多租户数据隔离
- [Laravel + PostgreSQL SKIP LOCKED](/categories/PHP-Laravel/laravel-postgresql-skip-locked-guide/) - 任务出队与死锁规避
- [Laravel + PostgreSQL Advisory Lock](/categories/PHP-Laravel/laravel-postgresql-advisory-lock-guide/) - 补偿扫描单实例化
- [Laravel + PostgreSQL CDC](/categories/PHP-Laravel/laravel-postgresql-cdc-guide/) - Debezium 订单变更同步
- [Laravel Telescope 开发调试](/categories/PHP-Laravel/laravel-telescope-guide/) - 请求追踪与慢查询定位
- [Elasticsearch 全文搜索深度调优](/categories/PHP-Laravel/elasticsearch-guide-laravel/) - 多字段映射与高可用

## 相关概念
- [Laravel 框架核心](Laravel框架核心.md) - 服务容器中注入 Repository
- [队列与事件系统](队列与事件系统.md) - 模型事件与队列任务联动
- [认证与授权](认证与授权.md) - Policy 模型授权
- → [MySQL 知识图谱](../MySQL/index.md) - 索引、事务、锁、EXPLAIN
- → [Redis 知识图谱](../Redis/index.md) - 缓存层、分布式锁

## 常见问题
- **N+1 查询怎么解决？** 使用 with() 预加载或 withCount() 计数预加载
- **Migration 能改列类型吗？** 可以，但生产环境需要评估锁表风险，推荐用 pt-online-schema-change
- **Scopes 什么时候用全局 vs 本地？** 全局 Scope 用于软删除等默认约束，本地 Scope 用于可选筛选
