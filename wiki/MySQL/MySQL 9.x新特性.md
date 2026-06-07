# MySQL 9.x 新特性

## 定义

MySQL 9.x 是 MySQL 的重要版本升级，在向量搜索、JSON 处理、查询优化器、安全性等方面带来重大改进。最引人注目的是原生向量搜索支持，无需额外部署向量数据库即可处理 AI 应用的 embedding 数据。

## 向量搜索（Vector Search）

### VECTOR 数据类型

```sql
CREATE TABLE products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    embedding VECTOR(1536),  -- OpenAI text-embedding-3-small 维度
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

常见维度：
- OpenAI text-embedding-3-small: 1536 维
- OpenAI text-embedding-3-large: 3072 维
- Sentence Transformers all-MiniLM-L6-v2: 384 维
- BGE-large-zh: 1024 维

### HNSW 向量索引

```sql
CREATE VECTOR INDEX idx_embedding ON products (embedding)
    WITH (distance_metric = 'cosine', m = 16, ef_construction = 200);
```

参数说明：
- `distance_metric`：cosine（余弦）、euclidean（欧几里得）、dot_product（点积）
- `m`：每节点最大连接数，默认 16
- `ef_construction`：构建时搜索范围，默认 200

### 向量搜索语法

```sql
-- 相似度搜索
SELECT id, name,
       VECTOR_DISTANCE(embedding, '[0.1, 0.2, ..., 0.9]') AS distance
FROM products
ORDER BY distance
LIMIT 10;

-- 带过滤条件
SELECT id, name, price,
       VECTOR_DISTANCE(embedding, '[0.1, 0.2, ..., 0.9]') AS distance
FROM products
WHERE category_id = 5 AND price < 100
ORDER BY distance
LIMIT 10;
```

## JSON 增强

- **JSON_TABLEA**：将 JSON 数组展开为关系表
- **JSON_MERGE_PATCH**：RFC 7396 标准的 JSON 合并
- **JSON Schema 验证**：约束 JSON 字段结构

```sql
-- JSON 数组展开
SELECT jt.*
FROM products,
JSON_TABLEA(tags, '$[*]' COLUMNS (
    tag VARCHAR(50) PATH '$'
)) AS jt;
```

## 查询优化器改进

- **自适应查询优化**：根据运行时统计信息调整执行计划
- **增量排序**：利用已有索引顺序减少排序开销
- **并行执行**：单条查询利用多核 CPU 并行处理

## 安全性增强

- **动态数据脱敏**：查询时自动隐藏敏感字段
- **行级安全策略（RLS）**：按用户角色过滤行数据

## Laravel 适配

```php
// config/database.php
'mysql' => [
    'driver' => 'mysql',
    'version' => '9.0',
    // 使用 VECTOR 类型需要更新 PDO/MySQLi 驱动
],
```

## 实战案例

来自博客文章：[MySQL 9.x 新特性实战：向量搜索、JSON 增强、性能改进与 Laravel 适配](/categories/MySQL/MySQL-9.x-新特性实战/)

## 相关概念

- [索引类型](索引类型.md) - HNSW 是新型索引类型
- [数据类型选型](数据类型选型.md) - VECTOR 是新数据类型
- [JSON 字段](数据类型选型.md#json-类型) - MySQL 5.7+ 的 JSON 基础
- [覆盖索引](覆盖索引.md) - 查询优化器改进与索引关系
- [EXPLAIN 执行计划](EXPLAIN执行计划.md) - 查看优化器改进效果

## 常见问题

**Q: MySQL 9.x 的向量搜索能替代 Pinecone/Weaviate 吗？**
A: 对于中小规模（百万级向量）可以。大规模（亿级）仍需专用向量数据库。优势是无需额外运维，数据与业务在同一数据库。

**Q: MySQL 9.x 什么时候正式发布？**
A: MySQL 9.x Innovation 版本已可下载体验。正式 GA 版本关注 Oracle 官方公告。生产环境建议等 GA 版本。

**Q: 从 MySQL 8.0 升级到 9.x 有什么风险？**
A: 主要风险：① 新版本稳定性待验证 ② 部分 SQL 行为可能变化 ③ 第三方驱动/ORM 兼容性。建议先在测试环境充分验证。
