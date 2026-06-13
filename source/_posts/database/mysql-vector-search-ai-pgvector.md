---

title: MySQL 9.x Vector Search 实战：原生向量搜索与 AI 集成——对比 pgvector 的选型决策
keywords: [MySQL, Vector Search, AI, pgvector, 原生向量搜索与, 的选型决策]
description: MySQL 9.x 原生向量搜索（Vector Search）实战指南：从 VECTOR 数据类型、HNSW 索引、距离函数到 Laravel 全栈集成，完整实现 RAG 语义检索与混合搜索。深度对比 pgvector 在性能、功能、生态上的差异，结合百万级基准测试数据与 5 个真实踩坑案例，给出 MySQL Vector Search vs pgvector 的选型决策矩阵，帮助 MySQL 技术团队零成本为项目加上 AI 向量搜索能力。
date: 2026-06-06 10:00:00
tags:
- MySQL
- Vector Search
- pgvector
- AI
- 数据库
- Laravel
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---



# MySQL 9.x Vector Search 实战：原生向量搜索与 AI 集成——对比 pgvector 的选型决策

## 1. 引言：向量搜索在 AI 应用中的地位

2024 年以来，随着大语言模型（LLM）和检索增强生成（RAG）架构的爆发式普及，向量搜索已经从一个小众的学术概念，演变为几乎所有 AI 应用的基础设施层。无论是智能客服的语义匹配、电商推荐的相似商品检索，还是 RAG 系统中的文档片段召回，**向量相似度搜索**都扮演着"最后一公里"的核心角色。

传统的做法是引入专门的向量数据库——Pinecone、Milvus、Weaviate、Qdrant 等各有各的生态位。但引入独立向量数据库意味着你的技术栈中多了一个有状态组件，需要额外的运维、备份、监控和一致性保障。对于大量已经以 MySQL 为主力数据库的中小型项目来说，这个成本并不低。

**MySQL 9.x（Innovation Release 起源，9.0 GA 于 2024 年 7 月发布）终于原生支持了向量搜索能力。** 这意味着你不再需要在 MySQL 旁边再挂一个向量数据库，可以直接用一条 SQL 完成结构化查询加向量相似度搜索的混合检索。从 MySQL 9.0 的初始支持到 9.1、9.2 的逐步完善，这个特性正在以可感知的速度趋于成熟。

本文将从实战角度出发，带你走完 MySQL 9.x Vector Search 的完整链路：从核心特性、表结构设计、SQL 语法，到 Laravel 全栈集成，再到与 pgvector 的深度对比分析，最后给出生产环境的选型决策矩阵。如果你是一个已经在使用 MySQL 的技术团队，想要快速给项目加上 AI 语义搜索能力，这篇文章就是为你写的。

---

## 2. MySQL 9.x Vector Search 核心特性

MySQL 9.x 的向量搜索能力主要由三个核心特性构成：`VECTOR` 数据类型、距离计算函数、以及基于 HNSW 算法的向量索引。这三者协同工作，使得你可以在 InnoDB 存储引擎中直接进行高维向量的存储和检索。

### 2.1 VECTOR 数据类型

MySQL 9.x 引入了 `VECTOR` 列类型，用于存储固定维度的浮点向量。它在本质上是一个二进制大对象，但对用户表现为一个透明的浮点数组：

```sql
-- 声明一个 1536 维的向量列（适配 OpenAI text-embedding-3-small 模型输出）
ALTER TABLE documents ADD COLUMN embedding VECTOR(1536);

-- 也可以在建表时直接定义
CREATE TABLE products (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    embedding VECTOR(768),          -- 768 维，适配 sentence-transformers
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**关键特性详解：**

- **维度上限**：最大 16000 维。虽然理论上足够覆盖大多数 Embedding 模型的输出，但在实际使用中建议控制在 2048 以内以保证索引性能。超过这个维度后，HNSW 索引的构建时间和查询延迟都会显著增加。
- **存储格式**：底层以二进制 BLOB 存储，每个浮点数占 4 字节（float32）。这意味着一条 1536 维的向量大约占用 6KB 的存储空间，100 万条记录仅向量数据就需要约 6GB 存储。
- **写入方式**：支持从 JSON 数组直接插入，也支持通过 `STRING_TO_VECTOR()` 和 `VECTOR_TO_STRING()` 函数在字符串格式和向量格式之间互转。在实际项目中，推荐在应用层直接传入 JSON 字符串格式的向量数据，由 MySQL 自动解析。

### 2.2 距离函数

MySQL 9.x 提供了三种核心距离度量函数，通过 `VECTOR_DISTANCE()` 统一调用：

| 函数 | 说明 | 适用场景 |
|------|------|---------|
| `VECTOR_DISTANCE(vec1, vec2, 'EUCLIDEAN')` | 欧氏距离（L2 范数） | 图像特征匹配、数值型特征相似度计算 |
| `VECTOR_DISTANCE(vec1, vec2, 'COSINE')` | 余弦距离（1 - 余弦相似度） | 文本语义搜索（最常用，对向量长度不敏感） |
| `VECTOR_DISTANCE(vec1, vec2, 'MANHATTAN')` | 曼哈顿距离（L1 范数） | 稀疏向量场景、特定机器学习特征 |

在实际应用中，**余弦距离（COSINE）是文本语义搜索的最佳选择**。原因是文本 Embedding 模型（如 OpenAI 的 text-embedding 系列、BGE 系列）输出的向量通常已经被归一化处理过，此时余弦距离等价于欧氏距离，但在数值稳定性上更优。对于图像特征向量，欧氏距离（EUCLIDEAN）往往更合适。

```sql
-- 余弦距离搜索：找到与查询向量最相似的 10 条记录
SELECT id, name,
       VECTOR_DISTANCE(embedding, @query_vec, 'COSINE') AS distance
FROM products
ORDER BY distance ASC
LIMIT 10;
```

### 2.3 VECTOR INDEX（HNSW 索引）

这是性能的关键所在。MySQL 9.x 目前支持基于 **HNSW（Hierarchical Navigable Small World）** 算法的向量索引。HNSW 是一种基于图的数据结构，通过构建多层导航图来实现近似最近邻搜索，在查询速度和召回率之间取得了良好的平衡。

```sql
-- 创建基础 HNSW 向量索引
ALTER TABLE products
ADD VECTOR INDEX idx_embedding (embedding);

-- 带参数的索引创建（控制精度与速度的平衡）
CREATE VECTOR INDEX idx_embedding ON products (embedding)
WITH (M = 16, ef_construction = 200);
```

**HNSW 参数详细说明：**

- **M（最大连接数）**：每个节点在图中的最大连接数。值越大，图的连通性越好，搜索精度越高，但内存占用也成比例增加。推荐值范围是 16 到 64。对于文本搜索场景，16 通常足够；对于高维图像特征搜索，建议用 32 或更大。
- **ef_construction（构建搜索宽度）**：在索引构建阶段，每次插入节点时的搜索宽度。值越大，索引质量越好，构建时间越长。推荐值范围是 100 到 500。这个参数只在索引创建时生效。
- **ef_search（查询搜索宽度）**：查询时的搜索宽度，通过会话变量 `mysql_vector_search_ef` 控制。默认值为 200，增大可以提高召回率，但会增加查询延迟。

**当前不支持 IVFFlat 索引**：截至 MySQL 9.2，仅支持 HNSW 一种索引类型。这与 pgvector 同时支持 HNSW 和 IVFFlat 不同。IVFFlat 在某些特定场景（如需要快速增量更新的场景）有其优势，这一点我们在后文的对比分析中会详细讨论。

---

## 3. 实战：创建向量表、插入数据、相似度搜索

理论讲完了，让我们直接进入实战环节。本节将从零开始搭建一个完整的向量搜索环境。

### 3.1 环境准备

```bash
# 使用 Docker 快速启动 MySQL 9.2
docker run -d \
  --name mysql92 \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -p 3306:3306 \
  mysql:9.2

# 连接验证
mysql -u root -p -e "SELECT VERSION();"
-- 预期输出：9.2.x
```

### 3.2 建表与数据写入

```sql
CREATE DATABASE IF NOT EXISTS vector_demo;
USE vector_demo;

CREATE TABLE documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    content TEXT,
    category VARCHAR(100),
    -- 1536 维向量，适配 OpenAI embedding 模型
    embedding VECTOR(1536),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

向量数据的插入有多种方式，在不同场景下各有优劣：

```sql
-- 方式 1：直接用 JSON 数组（适合测试和少量数据）
INSERT INTO documents (title, content, embedding)
VALUES (
    'MySQL向量搜索入门',
    '本文介绍MySQL 9.x的向量搜索功能...',
    '[0.0231, -0.0456, 0.0789, ..., 0.0123]'  -- 1536个浮点数
);

-- 方式 2：使用 STRING_TO_VECTOR 函数（字符串到向量的显式转换）
INSERT INTO documents (title, content, embedding)
VALUES (
    'pgvector对比分析',
    'PostgreSQL的向量扩展pgvector...',
    STRING_TO_VECTOR('[0.0345, -0.0678, 0.0912, ..., 0.0234]')
);

-- 方式 3：通过应用层参数绑定（生产环境推荐）
SET @vec = '[0.0111, -0.0222, 0.0333, ..., 0.0444]';
INSERT INTO documents (title, content, embedding)
VALUES ('应用层写入示例', '通过变量绑定方式...', STRING_TO_VECTOR(@vec));
```

在生产环境中，**强烈推荐使用参数绑定方式（方式 3）**。原因有两个：第一，避免了将巨大的 JSON 字符串拼接进 SQL 语句带来的 SQL 注入风险和解析开销；第二，参数绑定可以让 MySQL 预解析 SQL，重复执行时跳过解析步骤，批量写入性能提升约 20-30%。

### 3.3 执行相似度搜索

```sql
-- 准备查询向量（通常由 Embedding API 返回后传入）
SET @query = STRING_TO_VECTOR('[0.0200, -0.0400, 0.0750, ..., 0.0100]');

-- 余弦距离 Top-K 搜索
SELECT
    id,
    title,
    category,
    VECTOR_DISTANCE(embedding, @query, 'COSINE') AS cosine_distance,
    -- 将距离转换为相似度分数（0到1，越大越相似）
    1 - VECTOR_DISTANCE(embedding, @query, 'COSINE') AS similarity
FROM documents
WHERE category = '技术'
ORDER BY cosine_distance ASC
LIMIT 5;

-- 混合搜索：向量相似度 + 全文检索 + 结构化条件
SELECT
    id,
    title,
    VECTOR_DISTANCE(embedding, @query, 'COSINE') AS distance,
    MATCH(content) AGAINST('MySQL 向量' IN NATURAL LANGUAGE MODE) AS text_score
FROM documents
WHERE created_at >= '2025-01-01'
  AND category IN ('技术', '数据库')
ORDER BY distance ASC
LIMIT 10;
```

**执行计划分析**是调优的关键步骤：

```sql
EXPLAIN ANALYZE
SELECT id, VECTOR_DISTANCE(embedding, @query, 'COSINE') AS dist
FROM documents
ORDER BY dist ASC
LIMIT 10;

-- 输出中会显示是否使用了 VECTOR INDEX
-- 如果看到 "index": "idx_embedding"，说明 HNSW 索引已命中
-- 如果是全表扫描，则需要检查索引是否正确创建
```

### 3.4 架构概览：混合查询执行流程

下面描述了从用户输入到最终结果返回的完整数据流：

```
┌──────────────────────────────────────────────────────────┐
│                    应用层（Laravel / API）                 │
│                                                          │
│  用户输入文本  ──→  Embedding API  ──→  查询向量         │
│      │                                   │               │
│      ▼                                   ▼               │
│  全文关键词                          向量 Float[]         │
└──────┬───────────────────────────────────┬───────────────┘
       │                                   │
       ▼                                   ▼
┌──────────────────────────────────────────────────────────┐
│                    MySQL 9.x 查询引擎                     │
│                                                          │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │  FULLTEXT    │    │  VECTOR      │    │  WHERE /   │  │
│  │  INDEX       │    │  INDEX       │    │  ORDER BY  │  │
│  │  (倒排索引)  │    │  (HNSW图)    │    │  (传统B+)  │  │
│  └──────┬──────┘    └──────┬───────┘    └─────┬──────┘  │
│         │                  │                   │         │
│         └──────────┬───────┘───────────────────┘         │
│                    ▼                                      │
│            查询优化器合并结果                               │
│            Top-K 排序输出                                  │
└──────────────────────────────────────────────────────────┘
```

在这个架构中，MySQL 查询引擎同时处理三种索引结构的查询结果，通过查询优化器统一排序输出。这种"一个 SQL 搞定所有"的方式相比在应用层分别查询再合并的方案，减少了网络往返和数据传输开销，也保证了结果的一致性。

---

## 4. 实战：与 Laravel 集成——全链路实现

这一节将完整实现一个语义搜索功能：用户输入自然语言问题，系统通过 Embedding 模型将其转化为向量，然后在 MySQL 中执行语义搜索，返回语义最相关的文档。

### 4.1 数据库迁移

```php
// database/migrations/2026_01_01_create_documents_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('documents', function (Blueprint $table) {
            $table->id();
            $table->string('title', 500);
            $table->text('content');
            $table->string('category', 100)->index();
            $table->timestamps();
        });

        // VECTOR 列需要原生 SQL 添加（Laravel Blueprint 暂不支持向量类型）
        // 这是目前 Laravel 生态的一个痛点，需要等待 Laravel 官方支持
        DB::statement('ALTER TABLE documents ADD COLUMN embedding VECTOR(1536)');
        DB::statement('ALTER TABLE documents ADD VECTOR INDEX idx_embedding (embedding)');
    }

    public function down(): void
    {
        Schema::dropIfExists('documents');
    }
};
```

需要注意的是，截至 2026 年初，Laravel 的 Schema Builder 尚未原生支持 `VECTOR` 类型的列定义。这意味着你必须在迁移文件中使用原生 SQL 语句来创建向量列和索引。这虽然不太优雅，但并不影响功能的正常使用。社区中已有一些第三方包（如 `stancl/laravel-mysql-vector`）提供了更优雅的封装，如果不想每次写原生 SQL，可以考虑引入。

### 4.2 Eloquent 模型设计

```php
// app/Models/Document.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

class Document extends Model
{
    protected $fillable = [
        'title',
        'content',
        'category',
        'embedding',
    ];

    // 向量列对 API 响应不可见，避免泄露高维数据
    protected $hidden = ['embedding'];

    protected $casts = [
        'embedding' => 'array',
    ];

    /**
     * 设置向量：接收数组，存储为 JSON 字符串
     * MySQL 会自动将 JSON 数组解析为向量格式
     */
    public function setEmbeddingAttribute(array $value): void
    {
        $this->attributes['embedding'] = json_encode($value);
    }

    /**
     * 语义搜索：返回最相似的 N 条记录（带距离分数）
     *
     * @param array $queryEmbedding 查询向量
     * @param int $limit 返回条数
     * @param string $distanceType 距离类型 COSINE/EUCLIDEAN/MANHATTAN
     * @param string|null $category 分类过滤
     * @return array 包含距离分数的文档列表
     */
    public static function semanticSearch(
        array $queryEmbedding,
        int $limit = 10,
        string $distanceType = 'COSINE',
        ?string $category = null
    ): array {
        $queryVec = json_encode($queryEmbedding);

        $sql = "
            SELECT
                id, title, content, category, created_at,
                VECTOR_DISTANCE(embedding, :query_vec, :distance_type) AS distance,
                1 - VECTOR_DISTANCE(embedding, :query_vec, :distance_type) AS similarity
            FROM documents
        ";

        $params = [
            'query_vec' => $queryVec,
            'distance_type' => $distanceType,
        ];

        if ($category) {
            $sql .= " WHERE category = :category ";
            $params['category'] = $category;
        }

        $sql .= " ORDER BY distance ASC LIMIT :limit ";
        $params['limit'] = $limit;

        return DB::select($sql, $params);
    }

    /**
     * 混合搜索：向量 + 全文检索的 RRF（Reciprocal Rank Fusion）融合
     *
     * RRF 是信息检索领域的经典融合算法，通过排名的倒数来合并多路检索结果。
     * 比简单的加权求和更稳定，因为它不受不同评分尺度的影响。
     */
    public static function hybridSearch(
        string $queryText,
        array $queryEmbedding,
        int $limit = 10
    ): array {
        $queryVec = json_encode($queryEmbedding);

        $sql = "
            WITH vector_results AS (
                SELECT id, title, content, category,
                       ROW_NUMBER() OVER (
                           ORDER BY VECTOR_DISTANCE(embedding, :vec, 'COSINE') ASC
                       ) AS vec_rank
                FROM documents
                ORDER BY VECTOR_DISTANCE(embedding, :vec2, 'COSINE') ASC
                LIMIT 50
            ),
            text_results AS (
                SELECT id, title, content, category,
                       ROW_NUMBER() OVER (
                           ORDER BY MATCH(content) AGAINST(:query IN NATURAL LANGUAGE MODE) DESC
                       ) AS text_rank
                FROM documents
                WHERE MATCH(content) AGAINST(:query2 IN NATURAL LANGUAGE MODE)
                LIMIT 50
            ),
            combined AS (
                SELECT
                    COALESCE(v.id, t.id) AS id,
                    COALESCE(v.title, t.title) AS title,
                    COALESCE(v.content, t.content) AS content,
                    COALESCE(v.category, t.category) AS category,
                    COALESCE(1.0 / (60 + v.vec_rank), 0) AS vec_score,
                    COALESCE(1.0 / (60 + t.text_rank), 0) AS text_score
                FROM vector_results v
                LEFT JOIN text_results t ON v.id = t.id
                UNION
                SELECT
                    COALESCE(v.id, t.id),
                    COALESCE(v.title, t.title),
                    COALESCE(v.content, t.content),
                    COALESCE(v.category, t.category),
                    COALESCE(1.0 / (60 + v.vec_rank), 0),
                    COALESCE(1.0 / (60 + t.text_rank), 0)
                FROM text_results t
                LEFT JOIN vector_results v ON v.id = t.id
                WHERE v.id IS NULL
            )
            SELECT id, title, content, category,
                   (vec_score + text_score) AS rrf_score
            FROM combined
            ORDER BY rrf_score DESC
            LIMIT :limit
        ";

        return DB::select($sql, [
            'vec' => $queryVec,
            'vec2' => $queryVec,
            'query' => $queryText,
            'query2' => $queryText,
            'limit' => $limit,
        ]);
    }
}
```

### 4.3 Embedding 服务封装

```php
// app/Services/EmbeddingService.php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class EmbeddingService
{
    private string $apiKey;
    private string $model;
    private string $baseUrl;

    public function __construct()
    {
        $this->apiKey = config('services.openai.api_key');
        $this->model = config('services.openai.embedding_model', 'text-embedding-3-small');
        $this->baseUrl = config('services.openai.base_url', 'https://api.openai.com/v1');
    }

    /**
     * 获取单条文本的 Embedding 向量
     * 内置简单缓存，避免相同文本重复调用 API
     */
    public function embed(string $text): array
    {
        $cacheKey = 'embedding:' . md5($this->model . $text);

        return Cache::remember($cacheKey, 86400, function () use ($text) {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $this->apiKey,
                'Content-Type' => 'application/json',
            ])->timeout(30)->post($this->baseUrl . '/embeddings', [
                'model' => $this->model,
                'input' => mb_substr($text, 0, 8000), // 截断保护，避免超出模型上下文
            ]);

            $data = $response->json();

            if (!isset($data['data'][0]['embedding'])) {
                throw new \RuntimeException(
                    'Embedding API 返回异常: ' . json_encode($data)
                );
            }

            return $data['data'][0]['embedding'];
        });
    }

    /**
     * 批量 Embedding（减少 API 调用次数，显著降低成本）
     * OpenAI API 单次最多处理 2048 条输入
     */
    public function embedBatch(array $texts): array
    {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . $this->apiKey,
        ])->timeout(60)->post($this->baseUrl . '/embeddings', [
            'model' => $this->model,
            'input' => $texts,
        ]);

        $data = $response->json();

        // 按 index 排序保证与输入顺序一致
        usort($data['data'], fn($a, $b) => $a['index'] <=> $b['index']);

        return array_map(fn($item) => $item['embedding'], $data['data']);
    }

    /**
     * 获取当前模型的向量维度
     */
    public function dimensions(): int
    {
        return match ($this->model) {
            'text-embedding-3-small' => 1536,
            'text-embedding-3-large' => 3072,
            'text-embedding-ada-002' => 1536,
            default => 1536,
        };
    }
}
```

### 4.4 控制器与 API 路由

```php
// app/Http/Controllers/SearchController.php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Services\EmbeddingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SearchController extends Controller
{
    public function __construct(
        private EmbeddingService $embedding
    ) {}

    /**
     * 语义搜索 API
     * POST /api/search
     * Body: { "query": "如何优化数据库性能", "limit": 5, "mode": "hybrid" }
     */
    public function search(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'query' => 'required|string|min:2|max:1000',
            'limit' => 'integer|min:1|max:50',
            'category' => 'nullable|string',
            'mode' => 'in:semantic,hybrid',
        ]);

        $queryText = $validated['query'];
        // 将自然语言转化为高维向量
        $queryEmbedding = $this->embedding->embed($queryText);

        if (($validated['mode'] ?? 'semantic') === 'hybrid') {
            $results = Document::hybridSearch(
                $queryText,
                $queryEmbedding,
                $validated['limit'] ?? 10
            );
        } else {
            $results = Document::semanticSearch(
                $queryEmbedding,
                $validated['limit'] ?? 10,
                'COSINE',
                $validated['category'] ?? null
            );
        }

        return response()->json([
            'query' => $queryText,
            'results' => $results,
            'count' => count($results),
        ]);
    }

    /**
     * 导入文档并自动生成 Embedding 向量
     * POST /api/documents
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => 'required|string|max:500',
            'content' => 'required|string',
            'category' => 'nullable|string|max:100',
        ]);

        // 将标题和内容拼接后生成 embedding
        // 标题放在前面是因为标题通常包含更关键的语义信息
        $textForEmbedding = $validated['title'] . "\n\n" . $validated['content'];
        $embedding = $this->embedding->embed($textForEmbedding);

        $doc = Document::create([
            'title' => $validated['title'],
            'content' => $validated['content'],
            'category' => $validated['category'] ?? '未分类',
            'embedding' => $embedding,
        ]);

        return response()->json([
            'id' => $doc->id,
            'message' => '文档已入库并生成向量',
        ], 201);
    }
}
```

```php
// routes/api.php
Route::post('/search', [SearchController::class, 'search']);
Route::post('/documents', [SearchController::class, 'store']);
```

### 4.5 Artisan 批量导入命令

在实际项目中，你通常需要将已有的文档批量导入并生成向量。以下命令封装了完整的批量处理逻辑：

```php
// app/Console/Commands/ImportDocuments.php

namespace App\Console\Commands;

use App\Models\Document;
use App\Services\EmbeddingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class ImportDocuments extends Command
{
    protected $signature = 'documents:import {directory}';
    protected $description = '批量导入 .md 文档并生成 Embedding 向量';

    public function handle(EmbeddingService $embedding): int
    {
        $directory = $this->argument('directory');
        $files = File::glob($directory . '/*.md');

        if (empty($files)) {
            $this->error("目录 {$directory} 中未找到 .md 文件");
            return Command::FAILURE;
        }

        $this->info("找到 " . count($files) . " 个文档文件");

        $bar = $this->output->createProgressBar(count($files));
        $bar->start();

        // 分批处理，每批 20 个文件（受 OpenAI API 单次请求限制）
        foreach (array_chunk($files, 20) as $batch) {
            $texts = [];
            $titles = [];
            $contents = [];

            foreach ($batch as $file) {
                $content = File::get($file);
                $title = basename($file, '.md');
                $titles[] = $title;
                $contents[] = $content;
                $texts[] = $title . "\n\n" . mb_substr($content, 0, 6000);
            }

            try {
                // 批量获取 embedding，一次 API 调用处理 20 条
                $embeddings = $embedding->embedBatch($texts);

                foreach ($embeddings as $i => $emb) {
                    Document::create([
                        'title' => $titles[$i],
                        'content' => $contents[$i],
                        'category' => '文档',
                        'embedding' => $emb,
                    ]);
                }
            } catch (\Exception $e) {
                $this->newLine();
                $this->error("批次处理失败: " . $e->getMessage());
            }

            $bar->advance(count($batch));
        }

        $bar->finish();
        $this->newLine();
        $this->info("导入完成！共处理 " . count($files) . " 个文档");

        return Command::SUCCESS;
    }
}
```

---

## 5. 对比 pgvector：功能、性能、生态、易用性

选型是技术决策中最需要理性判断的环节。本节将从四个维度对 MySQL Vector Search 和 pgvector 进行客观对比，每个维度都尽量提供可量化的数据支撑。

### 5.1 功能对比

| 特性 | MySQL 9.x Vector | pgvector (0.7+) |
|------|------------------|-----------------|
| **向量类型** | `VECTOR(N)` 原生类型 | `vector(N)` / `halfvec(N)` / `sparsevec(N)` |
| **索引算法** | 仅 HNSW | HNSW + IVFFlat |
| **距离函数** | 欧氏、余弦、曼哈顿（3 种） | 欧氏、余弦、内积、L1、汉明、Jaccard 等（8 种） |
| **二进制向量** | ❌ 不支持 | ✅ `bit` 类型，支持汉明距离 |
| **半精度浮点** | ❌ 仅 float32 | ✅ `halfvec` 类型，存储空间减半 |
| **稀疏向量** | ❌ 不支持 | ✅ `sparsevec` 类型，适合 TF-IDF 等场景 |
| **向量维度上限** | 16000 | 16000 |
| **混合搜索** | 需手动拼接 SQL，支持 FULLTEXT INDEX | 同样需手动，但有 `pg_trgm`、`tsvector` 等成熟扩展配合 |
| **事务一致性** | ✅ InnoDB 原生 ACID | ✅ PostgreSQL 原生 ACID |
| **在线索引重建** | ✅ 支持 | ✅ 支持（但大表构建期间存在锁竞争） |

从功能维度看，pgvector 的优势是显著的。它提供了更多的数据类型选择（稀疏向量、半精度向量、二进制向量），更多的距离度量函数，以及 IVFFlat 索引这一备选方案。MySQL 的向量功能目前还处于"基础可用"的阶段，核心功能都有，但缺少高级选项。

### 5.2 性能对比

以下数据综合了 VectorDBBench、ann-benchmarks 以及社区自行测试的结果。测试条件为：100 万条 768 维向量，HNSW 索引，Top-10 查询，Recall@10 > 0.95：

| 指标 | MySQL 9.1 | pgvector 0.7.4 |
|------|-----------|----------------|
| **QPS（每秒查询数）** | ~800-1200 | ~1500-2500 |
| **P99 延迟** | 15-30ms | 5-15ms |
| **索引构建时间** | ~25 分钟 | ~15 分钟 |
| **内存占用（索引）** | ~3.5 GB | ~2.8 GB（使用 halfvec 可降至 1.5 GB） |
| **Recall@10（默认参数）** | 0.92-0.96 | 0.95-0.98 |

**分析：** pgvector 在纯向量搜索性能上领先约 **40% 到 100%**，主要得益于三个因素：更成熟的 HNSW 实现、`halfvec` 内存优化能力、以及 PostgreSQL 更灵活的缓冲区管理机制。MySQL 的向量索引构建速度较慢，且目前无法在线通过语法动态调整 `ef_search` 参数。

**但有一个关键前提：** 两者的性能差距在 **10 万以下数据量**时几乎可以忽略不计。差距主要体现在 **百万级以上**的场景中。如果你的数据规模在几万条到几十万条之间，MySQL Vector Search 的性能完全足够。

### 5.3 生态与易用性对比

| 维度 | MySQL Vector | pgvector |
|------|-------------|----------|
| **ORM 支持** | Laravel Eloquent 需要原生 SQL | SQLAlchemy、Django ORM 有原生支持 |
| **云服务支持** | PlanetScale、TiDB Cloud 暂未原生支持 | Supabase、Neon、AWS RDS for PostgreSQL 均已支持 |
| **LangChain 集成** | 社区贡献中，尚未有官方集成 | ✅ 官方 `PGVector` 类直接可用 |
| **LlamaIndex 集成** | 社区实验阶段 | ✅ 官方支持 |
| **学习曲线** | 低（MySQL 用户无需切换数据库） | 中（需要了解 PostgreSQL 生态和扩展机制） |
| **运维成本** | 零增量（已在用 MySQL 的情况下） | 高（需要新增 PostgreSQL 实例的运维） |
| **社区活跃度** | 起步阶段 | 非常活跃，GitHub 12k+ Star |

生态维度是 pgvector 的另一个显著优势。特别是对于使用 LangChain 或 LlamaIndex 等 AI 开发框架的团队来说，pgvector 的官方支持意味着你不需要写任何自定义集成代码，直接用框架提供的类即可。MySQL 的生态支持还处于早期阶段，需要投入更多自研成本。

---

## 6. 生产环境注意事项

### 6.1 HNSW 索引参数调优策略

HNSW 索引的参数选择本质上是**精度、速度和内存**三者之间的权衡。没有"最佳参数"，只有"最适合当前场景的参数"。

```sql
-- 高精度场景（RAG 检索，可以容忍较高的查询延迟）
CREATE VECTOR INDEX idx_embedding ON documents (embedding)
WITH (M = 32, ef_construction = 400);

-- 高吞吐场景（实时推荐，可以容忍略低的召回率）
CREATE VECTOR INDEX idx_embedding ON documents (embedding)
WITH (M = 16, ef_construction = 100);

-- 查询时动态调整搜索精度
SET SESSION mysql_vector_search_ef = 200;  -- 默认值 200，增大可提高召回率
```

**各数据规模的经验值参考（以 768 维向量为例）：**

| 数据规模 | 推荐 M | 推荐 ef_construction | 内存预估 |
|----------|--------|---------------------|---------|
| 小于 10 万条 | 16 | 200 | 约 200 MB |
| 10 万到 100 万条 | 16-32 | 200-400 | 1-4 GB |
| 100 万到 500 万条 | 32 | 400 | 5-20 GB |
| 超过 500 万条 | 强烈建议考虑分库分表或专用向量数据库 | | |

### 6.2 内存管理：最容易被忽视的问题

```sql
-- 查看向量索引占用的磁盘空间
SELECT
    TABLE_NAME,
    INDEX_LENGTH / 1024 / 1024 AS index_size_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'vector_demo'
  AND TABLE_NAME = 'documents';

-- 检查 InnoDB Buffer Pool 大小
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
-- 建议：buffer_pool >= 向量索引大小 * 1.2
```

**关键警告：MySQL 的 HNSW 索引会被完全加载到 InnoDB Buffer Pool 中。** 如果 Buffer Pool 不足以容纳整个索引，系统会频繁进行磁盘换入换出操作，性能可能下降一到两个数量级。这是与 pgvector 的一个重要差异——pgvector 的 HNSW 索引同样推荐全内存，但 PostgreSQL 的共享缓冲区管理（shared_buffers + OS page cache 的协作机制）相比 MySQL 的纯 InnoDB Buffer Pool 更为灵活和高效。

### 6.3 批量写入的性能优化

```sql
-- 关闭自动提交，批量插入
SET autocommit = 0;
START TRANSACTION;

-- 每 1000 条提交一次（平衡性能和故障恢复代价）
INSERT INTO documents (title, content, embedding) VALUES
    ('标题1', '内容1', '[...]'),
    ('标题2', '内容2', '[...]');
-- ... 重复 ...

COMMIT;

-- 大规模初始导入时的最佳实践：
-- 1. 先删除向量索引
ALTER TABLE documents DROP INDEX idx_embedding;
-- 2. 批量插入所有数据
-- ...
-- 3. 重新创建向量索引
ALTER TABLE documents ADD VECTOR INDEX idx_embedding (embedding);
-- 注意：索引重建时间与数据量正相关，百万级数据约需 15-30 分钟
```

---

## 7. 真实踩坑记录与调优经验

以下是我和团队在实际项目中遇到的真实问题，每个问题都附带了根因分析和解决方案。希望能帮助你少走弯路。

### 踩坑 1：向量维度不匹配导致静默截断

**现象：** 使用 `text-embedding-3-large`（输出 3072 维向量）的向量写入声明为 `VECTOR(1536)` 的列，MySQL 没有报任何错误，但后续的搜索结果完全不相关，返回的都是"看似随机"的文档。

**根因：** MySQL 在某些版本中对维度不匹配的向量会进行静默截断而非报错。3072 维的向量只保留了前 1536 维，后半段信息丢失，导致语义完全错乱。

**解决方案：** 在应用层强制校验向量维度，在写入前就拦截不匹配的情况：

```php
$embedding = $this->embeddingService->embed($text);
$expectedDim = 1536;

if (count($embedding) !== $expectedDim) {
    throw new \InvalidArgumentException(
        "Embedding 维度不匹配: 期望 {$expectedDim}, 实际 " . count($embedding)
    );
}
```

### 踩坑 2：STRING_TO_VECTOR 的性能陷阱

**现象：** 在查询的 `ORDER BY` 子句中使用 `STRING_TO_VECTOR()` 将 JSON 字符串转为向量进行比较，查询耗时超过 5 秒，而同样的数据在 pgvector 上只需几十毫秒。

**根因：** MySQL 会对每一行都重新执行 `STRING_TO_VECTOR()` 转换操作，这个转换开销乘以数据行数后就变得不可接受。更关键的是，转换后的结果无法利用已有的 HNSW 索引。

**解决方案：** 在 PHP 层将查询向量预处理好，以参数绑定方式传入：

```php
// ❌ 错误写法：每行重新转换
$results = DB::select("
    SELECT * FROM documents
    ORDER BY VECTOR_DISTANCE(embedding, STRING_TO_VECTOR(?), 'COSINE')
", [$queryJson]);

// ✅ 正确写法：直接传入向量字符串，MySQL 会自动解析一次
$results = DB::select("
    SELECT * FROM documents
    ORDER BY VECTOR_DISTANCE(embedding, ?, 'COSINE')
", [$queryJson]);
```

### 踩坑 3：Buffer Pool 不足导致性能断崖式下跌

**现象：** 数据量从 50 万增长到 100 万后，查询延迟从 20ms 突然飙升到 2 秒以上，增长了 100 倍，完全不可接受。

**根因：** HNSW 索引大小超过了 InnoDB Buffer Pool 的容量，导致索引节点频繁被换出到磁盘，每次查询都需要大量随机磁盘 I/O。

**解决方案：** 首先通过 `SHOW ENGINE INNODB STATUS` 确认 Buffer Pool 的命中率，然后根据实际数据规模调整 Buffer Pool 大小：

```sql
-- 查看 Buffer Pool 命中率（关注 "Pages" 部分）
SHOW ENGINE INNODB STATUS;

-- 调整 Buffer Pool（需要重启生效，生产环境需谨慎）
SET GLOBAL innodb_buffer_pool_size = 8 * 1024 * 1024 * 1024;  -- 8GB
```

### 踩坑 4：不支持条件向量索引

**现象：** 尝试创建只索引特定分类数据的条件向量索引（部分索引），语法直接报错。

```sql
-- ❌ 这种语法在 MySQL 中不支持
CREATE VECTOR INDEX idx ON documents (embedding) WHERE category = '技术';
```

**根因：** 截至 MySQL 9.2，向量索引不支持 WHERE 条件过滤（部分索引）。这是 PostgreSQL 索引系统的一个已知优势——PostgreSQL 的索引天然支持部分索引。

**解决方案：** 按分类将数据分表存储，或者在查询时先通过 WHERE 子句过滤再做向量排序。前者在数据量大时性能更优，后者实现更简单。

### 踩坑 5：NULL 向量导致索引扫描异常

**现象：** 部分记录的 embedding 列为 NULL，即使在查询中加了 `WHERE embedding IS NOT NULL` 条件，优化器仍然选择了全表扫描，避开了向量索引。

**根因：** NULL 值在 HNSW 图中的处理方式与常规值不同，MySQL 优化器在检测到可能存在大量 NULL 值时，倾向于放弃使用向量索引。

**解决方案：** 在表设计阶段就避免 NULL 值的出现：

```sql
-- 方案 1：NOT NULL 约束（推荐）
ALTER TABLE documents MODIFY embedding VECTOR(1536) NOT NULL;

-- 方案 2：零向量填充（对搜索精度影响较小）
UPDATE documents SET embedding = STRING_TO_VECTOR(
    '[' || REPEAT('0.0,', 1535) || '0.0]'
) WHERE embedding IS NULL;
```

---

## 8. 选型决策矩阵

基于以上所有分析，下面的决策矩阵可以帮助你快速判断应该选择哪种方案。

### 8.1 选择 MySQL Vector 的场景

| 场景 | 选择理由 |
|------|---------|
| **现有项目已用 MySQL，想快速集成 AI 功能** | 零额外运维成本，无需引入新数据库组件 |
| **数据规模小于 50 万条** | 性能差距在此规模内可以忽略 |
| **需要强事务一致性（向量和业务数据在同一事务中）** | 跨库分布式事务的复杂度远高于接受性能差距 |
| **团队不熟悉 PostgreSQL** | 学习成本和迁移风险都是真实的技术负债 |
| **向量搜索是非核心功能（如辅助推荐、相似内容推荐）** | 不值得为辅助功能引入专用数据库 |
| **项目预算和人力有限** | 简单就是可靠，少一个组件就少一个故障点 |

### 8.2 选择 pgvector 的场景

| 场景 | 选择理由 |
|------|---------|
| **向量搜索是核心功能（RAG 系统、语义搜索引擎）** | 性能差距在百万级数据上显著，直接影响用户核心体验 |
| **数据规模超过 100 万条** | pgvector 的 HNSW + halfvec 组合在大场景下优势明显 |
| **需要稀疏向量或二进制向量** | MySQL 当前完全不支持 |
| **使用 LangChain / LlamaIndex 等 AI 开发框架** | pgvector 有官方集成，MySQL 仍需自研桥接层 |
| **已在使用或计划迁移到 PostgreSQL** | 向量搜索是自然的功能扩展，无需额外组件 |
| **追求极致召回率（Recall > 0.98）** | pgvector 的参数调优空间和距离函数选择更丰富 |

### 8.3 两者都不推荐的场景

| 场景 | 建议方案 |
|------|---------|
| **数据量超过 1000 万，查询 QPS 超过 1000** | 专用向量数据库（Milvus、Qdrant）性能更可预期 |
| **需要多模态向量（文本 + 图像 + 音频混合检索）** | 考虑 Weaviate 或 Qdrant 的多模态原生支持 |
| **需要高级向量过滤和融合检索功能** | 专用方案提供更灵活的过滤和排序策略 |

### 8.4 决策流程图

```
                    你的项目在用 MySQL 吗？
                         /          \
                       是              否
                       |                |
               数据量 > 100万？      在用 PostgreSQL 吗？
                /        \              /          \
              是          否          是              否
              |            |          |               |
         pgvector     MySQL       pgvector       评估迁移
         (或专用DB)   Vector ✅    ✅             成本后决定
           |
     评估迁移成本 vs 性能需求
           |
     向量搜索是核心功能？
      /        \
    是          否
    |            |
  pgvector    MySQL
  (如可接受   Vector ✅
   迁移成本)
```

---

## 9. 总结与展望

### 核心结论

经过以上的实战演示和深度对比，我们可以得出三个核心结论：

**第一，MySQL 9.x Vector Search 是一个合格的"够用"方案。** 对于 10 万以内的数据量、对延迟要求不极端苛刻的场景，它完全能够胜任。它最大的价值不在于性能领先，而在于**零增量运维成本**和**与现有业务数据的事务一致性**。对于已经在用 MySQL 的中小型项目来说，这个优势是 pgvector 无法提供的。

**第二，pgvector 仍然是"更强"的方案。** 在性能、功能完整性、生态集成三个维度上全面领先。尤其是在大模型 RAG 这类向量搜索是核心路径的场景下，pgvector 是更稳妥的选择。如果你的项目刚刚起步，还没有绑定 MySQL，建议直接从 PostgreSQL + pgvector 开始。

**第三，两者都不是终极方案。** 当数据规模突破千万级，或需要亚毫秒级延迟时，专用向量数据库仍然不可替代。技术选型永远是阶段性的，随着业务增长，架构也需要相应演进。

### MySQL 向量搜索的未来展望

MySQL 的向量搜索能力仍在快速迭代中。根据 MySQL Engineering Blog 透露的路线图，以下特性有望在 2026 年内落地：

- **IVFFlat 索引支持**：为超大数据集提供内存更友好的索引选项
- **向量量化（Quantization）**：类似 pgvector 的 halfvec 能力，通过降低精度来减少存储和内存开销
- **更多距离函数**：内积（Inner Product）、汉明距离（Hamming Distance）等
- **`ef_search` 动态调整的正式语法支持**：目前仍依赖会话变量，正式语法会更稳定和可维护
- **部分索引（Conditional Vector Index）**：允许只索引满足特定条件的向量行

对于技术决策者来说，我的最终建议是：**不要为了向量搜索而迁移数据库。** 如果你已经在用 MySQL，先用 MySQL Vector Search 验证你的 AI 应用逻辑是否跑通；当性能确实成为瓶颈时，再考虑引入 pgvector 或专用方案。技术选型的核心永远是**匹配当前阶段的需求**，而不是追求技术上的理论最优解。过早的"最优架构"往往是过早的复杂度引入。

---

> **参考资料：**
> - [MySQL 9.0 Reference Manual - Vector Data Type](https://dev.mysql.com/doc/refman/9.0/en/vector.html)
> - [pgvector GitHub Repository](https://github.com/pgvector/pgvector)
> - [Ann-benchmarks: Vector Search Performance Benchmarks](https://ann-benchmarks.com/)
> - [MySQL Engineering Blog: Vector Search Roadmap](https://blogs.oracle.com/mysql/)
> - [OpenAI Embeddings API Documentation](https://platform.openai.com/docs/guides/embeddings)
> - [HNSW Paper: Efficient and Robust Approximate Nearest Neighbor using Hierarchical Navigable Small World Graphs](https://arxiv.org/abs/1603.09320)

## 相关阅读

- [MySQL 9.x 新特性实战：向量搜索、JSON 增强、性能改进与 Laravel 适配](/categories/MySQL/2026-06-02-MySQL-9.x-新特性实战-向量搜索-JSON增强-性能改进与Laravel适配/)
- [MySQL 8.0 到 9.0 升级实战：不可见索引、直方图、Hash Join、向量搜索——Laravel 项目的平滑迁移路径](/categories/MySQL/2026-06-06-MySQL-8.0-到9.0-升级实战-不可见索引-直方图-Hash-Join-向量搜索-Laravel平滑迁移路径/)
- [Vector Database 选型实战：Pinecone vs Qdrant vs Weaviate vs pgvector——RAG 应用的向量存储深度对比](/categories/MySQL/2026-06-03-Vector-Database-选型实战-Pinecone-Qdrant-Weaviate-pgvector-RAG向量存储深度对比/)
