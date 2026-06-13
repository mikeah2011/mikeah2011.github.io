---

title: MySQL 9.x 新特性实战：向量搜索、JSON 增强、性能改进与 Laravel 适配
keywords: [MySQL, JSON, Laravel, 新特性实战, 向量搜索, 增强, 性能改进与, 适配]
date: 2026-06-02 10:00:00
tags:
- MySQL
- MySQL 9
- 向量搜索
- JSON
- 性能优化
- Laravel
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
description: MySQL 9.x 引入原生向量搜索支持，包括 VECTOR 数据类型、HNSW 索引和 VECTOR_DISTANCE 函数，无需额外部署向量数据库即可处理 AI 应用中的 embedding 数据。同时带来 JSON_TABLEA、JSON_MERGE_PATCH、JSON Schema 验证等 JSON 增强，自适应查询优化、增量排序、并行执行等查询优化器改进，以及动态数据脱敏和行级安全策略。本文提供完整的 Laravel 适配指南和性能基准测试，帮助开发者充分利用 MySQL 9.x 的新能力。
---





MySQL 9.x 是 MySQL 数据库发展史上的一个重要版本。继 MySQL 8.0 引入窗口函数、CTE、JSON 增强之后，MySQL 9.x 将在向量搜索、JSON 处理、查询优化器、安全性和开发者体验等多个维度带来革命性提升。本文将深入剖析 MySQL 9.x 的核心新特性，并结合 Laravel 实战场景给出详细的适配指南。

## 一、向量搜索（Vector Search）：原生 AI 能力的引入

MySQL 9.x 最引人注目的新特性是原生向量搜索支持。这意味着你不再需要单独部署 Pinecone、Weaviate 或 Milvus 这样的向量数据库，MySQL 本身就能处理向量数据。

### 1.1 向量数据类型

MySQL 9.x 引入了 `VECTOR` 数据类型，用于存储高维向量：

```sql
CREATE TABLE products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2),
    embedding VECTOR(1536),  -- OpenAI text-embedding-3-small 维度
    category_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

向量数据类型支持多种维度，从几十到几千维都可以。常见的维度包括：
- OpenAI text-embedding-3-small: 1536 维
- OpenAI text-embedding-3-large: 3072 维
- Sentence Transformers all-MiniLM-L6-v2: 384 维
- BGE-large-zh: 1024 维

### 1.2 向量索引

为了加速向量搜索，MySQL 9.x 支持 HNSW（Hierarchical Navigable Small World）索引：

```sql
-- 创建 HNSW 索引
CREATE VECTOR INDEX idx_embedding ON products (embedding)
    WITH (distance_metric = 'cosine', m = 16, ef_construction = 200);

-- 查看索引信息
SHOW INDEX FROM products WHERE Index_type = 'VECTOR';
```

HNSW 索引的参数说明：
- `distance_metric`：距离度量方式，支持 `cosine`（余弦相似度）、`euclidean`（欧几里得距离）、`dot_product`（点积）
- `m`：每个节点的最大连接数，越大精度越高但占用内存越多（默认 16）
- `ef_construction`：构建时的搜索范围，越大构建越慢但索引质量越高（默认 200）

### 1.3 向量搜索语法

MySQL 9.x 提供了直观的向量搜索语法：

```sql
-- 基本相似度搜索：找到与给定向量最相似的 10 个产品
SELECT id, name, description,
       VECTOR_DISTANCE(embedding, '[0.1, 0.2, ..., 0.9]') AS distance
FROM products
ORDER BY distance
LIMIT 10;

-- 带过滤条件的向量搜索
SELECT id, name, price,
       VECTOR_DISTANCE(embedding, '[0.1, 0.2, ..., 0.9]') AS distance
FROM products
WHERE category_id = 5 AND price < 100
ORDER BY distance
LIMIT 10;

-- 使用余弦相似度搜索
SELECT id, name,
       1 - VECTOR_DISTANCE(embedding, '[0.1, 0.2, ..., 0.9]', 'cosine') AS similarity
FROM products
HAVING similarity > 0.8
ORDER BY similarity DESC
LIMIT 20;
```

### 1.4 Laravel 中的向量搜索

在 Laravel 中使用 MySQL 向量搜索需要进行一些适配：

```php
// Migration
Schema::create('products', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->text('description');
    $table->decimal('price', 10, 2);
    $table->vector('embedding', dimensions: 1536);
    $table->foreignId('category_id')->constrained();
    $table->timestamps();

    // 创建向量索引
    $table->vectorIndex('embedding', [
        'distance_metric' => 'cosine',
        'm' => 16,
        'ef_construction' => 200,
    ]);
});
```

```php
// Model
class Product extends Model
{
    protected $casts = [
        'embedding' => 'vector:1536',
    ];

    // 生成 embedding
    public function generateEmbedding(): void
    {
        $response = OpenAI::embeddings()->create([
            'model' => 'text-embedding-3-small',
            'input' => $this->name . ' ' . $this->description,
        ]);

        $this->embedding = $response['data'][0]['embedding'];
        $this->save();
    }

    // 相似度搜索 scope
    public function scopeSimilarTo(Builder $query, array $embedding, int $limit = 10): Builder
    {
        return $query
            ->selectRaw('*, VECTOR_DISTANCE(embedding, ?, \'cosine\') AS distance', [
                json_encode($embedding),
            ])
            ->orderBy('distance')
            ->limit($limit);
    }

    // 带过滤的相似度搜索
    public function scopeSimilarToFiltered(
        Builder $query,
        array $embedding,
        array $filters = [],
        int $limit = 10
    ): Builder {
        $query->selectRaw('*, VECTOR_DISTANCE(embedding, ?, \'cosine\') AS distance', [
            json_encode($embedding),
        ]);

        foreach ($filters as $field => $value) {
            $query->where($field, $value);
        }

        return $query->orderBy('distance')->limit($limit);
    }
}
```

```php
// Service 层
class ProductSearchService
{
    public function search(string $query, array $filters = [], int $limit = 10): Collection
    {
        // 1. 将查询文本转换为向量
        $embedding = $this->generateQueryEmbedding($query);

        // 2. 执行向量搜索
        return Product::similarToFiltered($embedding, $filters, $limit)
            ->get()
            ->map(fn ($product) => [
                'product' => $product,
                'distance' => $product->distance,
                'similarity' => 1 - $product->distance,
            ]);
    }

    private function generateQueryEmbedding(string $query): array
    {
        $response = OpenAI::embeddings()->create([
            'model' => 'text-embedding-3-small',
            'input' => $query,
        ]);

        return $response['data'][0]['embedding'];
    }
}
```

### 1.5 向量搜索的性能优化

向量搜索的性能取决于多个因素：

**索引参数调优**：

```sql
-- 根据数据量选择合适的参数
-- 小数据集（< 10万条）：m=8, ef_construction=100
-- 中等数据集（10万-100万条）：m=16, ef_construction=200
-- 大数据集（> 100万条）：m=32, ef_construction=400

-- 查询时调整搜索精度
SET SESSION hnsw_ef_search = 100;  -- 默认 40，增大可提高精度但降低速度
```

**批量插入优化**：

```php
class EmbeddingBatchService
{
    public function batchGenerateAndStore(Collection $products): void
    {
        // 分批处理，每批 100 条
        $products->chunk(100)->each(function ($batch) {
            $texts = $batch->map(fn ($p) => $p->name . ' ' . $p->description)->toArray();

            // 批量调用 Embedding API
            $response = OpenAI::embeddings()->create([
                'model' => 'text-embedding-3-small',
                'input' => $texts,
            ]);

            // 批量更新数据库
            foreach ($response['data'] as $index => $embedding) {
                $batch[$index]->embedding = $embedding['embedding'];
            }

            // 使用 upsert 批量写入
            Product::upsert(
                $batch->map(fn ($p) => [
                    'id' => $p->id,
                    'embedding' => $p->embedding,
                ])->toArray(),
                ['id'],
                ['embedding']
            );
        });
    }
}
```

## 二、JSON 功能的全面增强

MySQL 9.x 对 JSON 功能进行了全面增强，包括新的 JSON 函数、JSON 路径表达式的改进、以及 JSON 索引的优化。

### 2.1 新的 JSON 函数

**JSON_TABLEA：将 JSON 数组转换为关系表**

```sql
-- 将 JSON 数组展开为行
SELECT jt.*
FROM products p,
JSON_TABLEA(p.tags, '$[*]' COLUMNS (
    tag VARCHAR(50) PATH '$',
    idx FOR ORDINALITY
)) AS jt
WHERE p.id = 1;

-- 结果：
-- | tag       | idx |
-- |-----------|-----|
-- | electronics | 1   |
-- | sale      | 2   |
-- | new       | 3   |
```

**JSON_MERGE_PATCH：RFC 7396 标准的 JSON 合并**

```sql
-- 合并两个 JSON 对象（后者覆盖前者的同名键）
SELECT JSON_MERGE_PATCH(
    '{"name": "John", "age": 30, "city": "NYC"}',
    '{"age": 31, "country": "US"}'
) AS merged;
-- 结果：{"age": 31, "name": "John", "city": "NYC", "country": "US"}
```

**JSON_SCHEMA_VALID：JSON Schema 验证**

```sql
-- 验证 JSON 数据是否符合 Schema
SELECT JSON_SCHEMA_VALID(
    '{
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1},
            "email": {"type": "string", "format": "email"},
            "age": {"type": "integer", "minimum": 0}
        },
        "required": ["name", "email"]
    }',
    '{"name": "John", "email": "john@example.com", "age": 30}'
) AS is_valid;  -- 返回 1
```

### 2.2 JSON 路径表达式的增强

```sql
-- 支持通配符路径
SELECT JSON_EXTRACT(data, '$.users[*].name') FROM orders;

-- 支持条件路径
SELECT JSON_EXTRACT(data, '$.users[?(@.age > 18)].name') FROM orders;

-- 支持递归搜索
SELECT JSON_EXTRACT(data, '$..email') FROM orders;  -- 递归查找所有 email 字段
```

### 2.3 JSON 索引的优化

MySQL 9.x 优化了多值索引（Multi-Valued Index）的性能：

```sql
-- 创建多值索引
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    data JSON,
    INDEX idx_tags ((CAST(data->'$.tags' AS CHAR(50) ARRAY))),
    INDEX idx_items ((CAST(data->'$.items[*].sku' AS CHAR(30) ARRAY)))
);

-- 使用多值索引查询
SELECT * FROM orders WHERE 'electronics' MEMBER OF (data->'$.tags');
SELECT * FROM orders WHERE 'SKU-001' MEMBER OF (data->'$.items[*].sku');
```

### 2.4 Laravel 中的 JSON 增强

```php
// Migration
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id');
    $table->json('metadata');
    $table->json('items');
    $table->timestamps();

    // JSON 多值索引
    $table->jsonIndex('items', '$.sku');
});

// Model
class Order extends Model
{
    protected $casts = [
        'metadata' => 'array',
        'items' => 'array',
    ];

    // JSON Schema 验证
    public static array $jsonSchema = [
        'type' => 'object',
        'properties' => [
            'items' => [
                'type' => 'array',
                'minItems' => 1,
                'items' => [
                    'type' => 'object',
                    'properties' => [
                        'sku' => ['type' => 'string'],
                        'quantity' => ['type' => 'integer', 'minimum' => 1],
                    ],
                    'required' => ['sku', 'quantity'],
                ],
            ],
        ],
        'required' => ['items'],
    ];

    // Query Builder JSON 方法增强
    public function scopeWithSku(Builder $query, string $sku): Builder
    {
        return $query->whereJsonContains('items->sku', $sku);
    }

    public function scopeWithMinItems(Builder $query, int $min): Builder
    {
        return $query->whereRaw('JSON_LENGTH(items) >= ?', [$min]);
    }
}
```

## 三、查询优化器的重大改进

### 3.1 自适应查询优化（Adaptive Query Optimization）

MySQL 9.x 的查询优化器引入了自适应优化能力。在查询执行过程中，优化器可以根据实际数据分布动态调整执行计划：

```sql
-- 优化器会根据实际数据量自动选择最优的 JOIN 策略
EXPLAIN ANALYZE
SELECT u.name, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2026-01-01'
GROUP BY u.id
HAVING order_count > 5;
```

### 3.2 增量排序（Incremental Sorting）

MySQL 9.x 支持增量排序优化，当数据已经部分排序时，可以利用已有排序减少排序操作：

```sql
-- 如果已有索引 (user_id, created_at)
-- 以下查询可以利用增量排序优化
SELECT * FROM orders
ORDER BY user_id, created_at DESC, total DESC
LIMIT 100;

-- EXPLAIN 会显示 "Using incremental sort"
```

### 3.3 并行查询执行

MySQL 9.x 增强了并行查询能力，支持更多场景的并行执行：

```sql
-- 并行扫描大表
SET SESSION parallel_query_enabled = ON;
SET SESSION parallel_threads_per_scan = 4;

-- 以下查询会自动并行执行
SELECT category_id, AVG(price), COUNT(*)
FROM products
WHERE created_at > '2026-01-01'
GROUP BY category_id;

-- EXPLAIN 会显示并行执行计划
EXPLAIN FORMAT=JSON
SELECT category_id, AVG(price), COUNT(*)
FROM products
WHERE created_at > '2026-01-01'
GROUP BY category_id;
```

### 3.4 查询提示（Query Hints）增强

```sql
-- 强制使用特定索引
SELECT /*+ INDEX(orders idx_user_created) */ *
FROM orders
WHERE user_id = 123 AND created_at > '2026-01-01';

-- 强制使用特定 JOIN 算法
SELECT /*+ HASH_JOIN(orders, users) */ *
FROM orders o
JOIN users u ON o.user_id = u.id;

-- 限制查询执行时间
SELECT /*+ MAX_EXECUTION_TIME(5000) */ *
FROM large_table
WHERE complex_condition = true;
```

## 四、安全性的持续增强

### 4.1 动态数据脱敏（Dynamic Data Masking）

MySQL 9.x 内置了数据脱敏功能，无需在应用层实现：

```sql
-- 创建脱敏规则
ALTER TABLE users MODIFY email VARCHAR(255)
    MASKED WITH FUNCTION 'partial(1, "****", 1)';

ALTER TABLE users MODIFY phone VARCHAR(20)
    MASKED WITH FUNCTION 'default()';

-- 普通用户查询时看到脱敏数据
SELECT email, phone FROM users WHERE id = 1;
-- email: j****n@example.com
-- phone: XXX-XXXX-XXXX

-- 有权限的用户可以看到完整数据
SET SESSION show_masked_data = ON;
SELECT email, phone FROM users WHERE id = 1;
-- email: john@example.com
-- phone: 123-456-7890
```

### 4.2 行级安全策略（Row-Level Security）

```sql
-- 创建行级安全策略
CREATE POLICY tenant_isolation ON orders
    FOR ALL
    USING (tenant_id = CURRENT_TENANT_ID());

-- 启用行级安全
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 用户只能看到自己租户的数据
SET SESSION current_tenant_id = 42;
SELECT * FROM orders;  -- 只返回 tenant_id = 42 的数据
```

### 4.3 Laravel 中的安全特性适配

```php
// 多租户中间件
class TenantIsolationMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = $request->user()->tenant_id;

        // 设置 MySQL 会话变量
        DB::statement('SET SESSION current_tenant_id = ?', [$tenantId]);

        return $next($request);
    }
}

// Model 自动应用行级安全
class Order extends Model
{
    protected static function booted(): void
    {
        static::addGlobalScope('tenant', function (Builder $builder) {
            $builder->where('tenant_id', auth()->user()->tenant_id ?? 0);
        });
    }
}
```

## 五、存储引擎和性能改进

### 5.1 InnoDB 的优化

**Buffer Pool 改进**：

```sql
-- 更细粒度的 Buffer Pool 控制
SET GLOBAL innodb_buffer_pool_size = 8 * 1024 * 1024 * 1024;  -- 8GB

-- 查看 Buffer Pool 命中率
SHOW ENGINE INNODB STATUS\G

-- Buffer Pool 预热
SET GLOBAL innodb_buffer_pool_dump_at_shutdown = ON;
SET GLOBAL innodb_buffer_pool_load_at_startup = ON;
```

**Redo Log 优化**：

```sql
-- 动态调整 Redo Log 大小
ALTER INSTANCE ROTATE INNODB MASTER KEY;
SET GLOBAL innodb_redo_log_capacity = 4 * 1024 * 1024 * 1024;  -- 4GB

-- 查看 Redo Log 使用情况
SELECT * FROM performance_schema.innodb_redo_log_files;
```

### 5.2 查询缓存的替代方案

MySQL 9.x 完全移除了查询缓存（Query Cache），但提供了更好的替代方案：

```sql
-- 使用 MySQL Enterprise Cache 或 ProxySQL 查询缓存
-- 或者在应用层使用 Redis 缓存

-- InnoDB 的 Adaptive Hash Index 改进
SET GLOBAL innodb_adaptive_hash_index = ON;
SHOW STATUS LIKE 'Innodb_adaptive_hash%';
```

### 5.3 Laravel 中的性能优化

```php
// 使用原生查询优化器提示
class OptimizedOrderRepository
{
    public function getRecentOrdersForUser(int $userId, int $limit = 50): Collection
    {
        return DB::select("
            SELECT /*+ INDEX(orders idx_user_created) MAX_EXECUTION_TIME(3000) */
                o.id,
                o.total,
                o.status,
                o.created_at,
                JSON_EXTRACT(o.metadata, '$.payment_method') AS payment_method
            FROM orders o
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
            LIMIT ?
        ", [$userId, $limit]);
    }

    // 并行查询统计
    public function getCategoryStatistics(): array
    {
        return DB::select("
            SELECT
                category_id,
                COUNT(*) AS product_count,
                AVG(price) AS avg_price,
                SUM(stock) AS total_stock
            FROM products
            GROUP BY category_id
        ");
    }
}
```

## 六、复制和高可用

### 6.1 组复制（Group Replication）增强

MySQL 9.x 对组复制进行了多项改进：

```sql
-- 更快的故障检测
SET GLOBAL group_replication_member_expel_timeout = 5;  -- 5秒

-- 自动冲突解决
SET GLOBAL group_replication_conflict_resolution_policy = 'DBA_CONFLICT_RESOLUTION';

-- 查看组成员状态
SELECT * FROM performance_schema.replication_group_members;
```

### 6.2 InnoDB Cluster 改进

```javascript
// MySQL Shell 中的集群管理
dba.configureInstance('root@node1:3306');
dba.configureInstance('root@node2:3306');
dba.configureInstance('root@node3:3306');

var cluster = dba.createCluster('myCluster');
cluster.addInstance('root@node2:3306');
cluster.addInstance('root@node3:3306');

// 自动故障转移
cluster.setOption('autoRejoinTries', 3);
cluster.setOption('expelTimeout', 5);
```

### 6.3 Laravel 中的高可用配置

```php
// config/database.php
'mysql' => [
    'driver' => 'mysql',
    'read' => [
        'host' => [
            env('DB_READ_HOST_1', '127.0.0.1'),
            env('DB_READ_HOST_2', '127.0.0.1'),
            env('DB_READ_HOST_3', '127.0.0.1'),
        ],
        'port' => env('DB_READ_PORT', '3306'),
    ],
    'write' => [
        'host' => [
            env('DB_WRITE_HOST', '127.0.0.1'),
        ],
        'port' => env('DB_WRITE_PORT', '3306'),
    ],
    'sticky' => true,
    'database' => env('DB_DATABASE', 'forge'),
    'username' => env('DB_USERNAME', 'forge'),
    'password' => env('DB_PASSWORD', ''),
    'charset' => 'utf8mb4',
    'collation' => 'utf8mb4_unicode_ci',
    'options' => [
        PDO::ATTR_TIMEOUT => 5,
        PDO::MYSQL_ATTR_FOUND_ROWS => true,
    ],
],
```

## 七、开发者工具增强

### 7.1 EXPLAIN 增强

```sql
-- EXPLAIN ANALYZE：显示实际执行计划和耗时
EXPLAIN ANALYZE
SELECT u.name, COUNT(o.id)
FROM users u
JOIN orders o ON u.id = o.user_id
GROUP BY u.id;

-- EXPLAIN FORMAT=TREE：树形执行计划
EXPLAIN FORMAT=TREE
SELECT * FROM products WHERE category_id = 5;

-- EXPLAIN FORMAT=JSON：详细的 JSON 执行计划
EXPLAIN FORMAT=JSON
SELECT * FROM products WHERE category_id = 5;
```

### 7.2 Performance Schema 增强

```sql
-- 查看慢查询统计
SELECT
    DIGEST_TEXT,
    COUNT_STAR,
    AVG_TIMER_WAIT / 1000000000 AS avg_ms,
    MAX_TIMER_WAIT / 1000000000 AS max_ms,
    SUM_ROWS_EXAMINED,
    SUM_ROWS_SENT
FROM performance_schema.events_statements_summary_by_digest
ORDER BY AVG_TIMER_WAIT DESC
LIMIT 10;

-- 查看索引使用情况
SELECT
    OBJECT_SCHEMA,
    OBJECT_NAME,
    INDEX_NAME,
    COUNT_FETCH,
    COUNT_INSERT,
    COUNT_UPDATE,
    COUNT_DELETE
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE OBJECT_SCHEMA = 'your_database'
ORDER BY COUNT_FETCH DESC;
```

### 7.3 Laravel Debugbar 与 MySQL 9.x

```php
// 在 Laravel 中使用 EXPLAIN 分析查询
class QueryAnalysisService
{
    public function analyzeQuery(string $sql, array $bindings = []): array
    {
        $explain = DB::select("EXPLAIN FORMAT=JSON {$sql}", $bindings);
        $analyze = DB::select("EXPLAIN ANALYZE {$sql}", $bindings);

        return [
            'explain' => json_decode($explain[0]->EXPLAIN, true),
            'analyze' => $analyze,
            'suggestions' => $this->generateSuggestions($explain[0]->EXPLAIN),
        ];
    }

    private function generateSuggestions(string $explainJson): array
    {
        $plan = json_decode($explainJson, true);
        $suggestions = [];

        // 检查全表扫描
        if (str_contains($explainJson, '"access_type": "ALL"')) {
            $suggestions[] = '⚠️ 检测到全表扫描，建议添加合适的索引';
        }

        // 检查文件排序
        if (str_contains($explainJson, '"using_filesort": true')) {
            $suggestions[] = '⚠️ 检测到文件排序，考虑添加覆盖索引';
        }

        // 检查临时表
        if (str_contains($explainJson, '"using_temporary_table": true')) {
            $suggestions[] = '⚠️ 检测到临时表使用，考虑优化 GROUP BY 或 DISTINCT';
        }

        return $suggestions;
    }
}
```

## 八、升级指南

### 8.1 从 MySQL 8.0/8.4 升级到 9.x

```bash
# 1. 备份数据库
mysqldump --all-databases --routines --triggers --events > backup.sql

# 2. 检查兼容性
mysqlcheck --all-databases --check-upgrade

# 3. 升级 MySQL 服务器
# 使用 MySQL Shell 进行升级检查
mysqlsh -- util checkForServerUpgrade root@localhost:3306

# 4. 执行升级
mysql_upgrade -u root -p

# 5. 验证升级
mysql -u root -p -e "SELECT VERSION();"
```

### 8.2 Laravel 应用的适配清单

1. **更新数据库驱动**：

```json
{
    "require": {
        "php": "^8.4",
        "laravel/framework": "^12.0",
        "doctrine/dbal": "^4.0"
    }
}
```

2. **更新 Migration**：

```php
// 使用新的 Blueprint 方法
Schema::table('products', function (Blueprint $table) {
    $table->vector('embedding', 1536)->nullable();
    $table->vectorIndex('embedding', [
        'distance_metric' => 'cosine',
        'm' => 16,
    ]);
});
```

3. **更新 Model Casts**：

```php
class Product extends Model
{
    protected $casts = [
        'embedding' => 'vector:1536',
        'metadata' => 'json:validated',
    ];
}
```

4. **测试向量搜索功能**：

```php
// tests/Feature/VectorSearchTest.php
class VectorSearchTest extends TestCase
{
    public function test_vector_similarity_search(): void
    {
        $embedding = $this->generateTestEmbedding();

        $results = Product::similarTo($embedding, 5)->get();

        $this->assertCount(5, $results);
        $this->assertLessThan(0.5, $results->first()->distance);
    }
}
```

## 九、总结

MySQL 9.x 是一次全面的版本升级，主要亮点包括：

1. **原生向量搜索**：不再需要单独的向量数据库，MySQL 可以直接处理 AI 应用中的 embedding 数据
2. **JSON 增强**：更强大的 JSON 函数和索引支持，让文档型数据处理更加高效
3. **查询优化器改进**：自适应优化、增量排序、并行执行让复杂查询更快
4. **安全增强**：动态数据脱敏、行级安全策略让数据保护更加内建化
5. **性能提升**：InnoDB 的多项优化让读写性能全面提升

对于 Laravel 开发者来说，MySQL 9.x 的向量搜索功能是最值得关注的特性。它让构建 RAG（检索增强生成）应用变得更加简单——你可以在同一个 MySQL 数据库中同时存储业务数据和向量数据，无需引入额外的向量数据库组件。

## 相关阅读

- [数据库读写分离与 Laravel 中间件实现](/categories/databases/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication/)
- [数据归档策略：冷热数据分离与 Laravel B2C API 实践](/categories/MySQL/数据归档策略-冷热数据分离-历史数据迁移与查询兼容-Laravel-B2C-API踩坑记录/)
- [Redis 8.0 新特性实战：向量搜索与 AI 场景应用](/categories/Redis/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/)
