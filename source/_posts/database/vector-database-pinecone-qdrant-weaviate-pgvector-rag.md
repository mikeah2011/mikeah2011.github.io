---

title: Vector Database 选型实战：Pinecone vs Qdrant vs Weaviate vs pgvector——RAG 应用的向量存储深度对比
keywords: [Vector Database, Pinecone vs Qdrant vs Weaviate vs pgvector, RAG, 选型实战, 应用的向量存储深度对比]
date: 2026-06-03 08:00:00
tags:
- 数据库
- Pinecone
- Qdrant
- Weaviate
- pgvector
- RAG
- AI
- Embedding
description: 向量数据库选型不再迷茫！本文深度对比 Pinecone、Qdrant、Weaviate、pgvector、Milvus、ChromaDB 六大主流向量数据库，涵盖 RAG 检索增强生成架构原理、ANN 算法选型、Laravel/PHP 完整集成代码、性能基准与成本分析。无论你是构建 AI 知识库、语义搜索还是 RAG 应用，都能找到最适合的向量存储方案。含 pgvector SQL 混合搜索、Qdrant 混合检索、多租户策略与生产级优化实践。
categories:
- database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
---



## 前言

RAG（Retrieval-Augmented Generation）已经成为 2025-2026 年 AI 应用开发的核心范式。它的基本思路是：**不把所有知识塞进 LLM 的上下文窗口，而是先从向量数据库中检索相关文档，再把检索结果注入到 LLM 的提示中。**

这个架构中，向量数据库是关键基础设施。选错向量数据库，可能导致：
- 检索延迟太高（用户体验差）
- 检索精度不够（LLM 回答质量差）
- 成本失控（托管费用远超预期）
- 扩展困难（数据量增长后性能崩塌）

本文将深入对比 6 款主流向量数据库，结合 Laravel/PHP 生态的实际集成场景，帮助你做出最合适的选型决策。

<!-- more -->

---

## 一、向量数据库基础

### 1.1 什么是向量数据库

传统数据库基于精确匹配（SQL 的 `WHERE name = 'John'`）。向量数据库基于**语义相似度**——它存储的是高维向量（embedding），查询时返回与查询向量最相似的 K 个结果。

```
文本 → Embedding 模型 → [0.12, -0.34, 0.56, ..., 0.78] (1536维向量)
                              ↓
                        存储到向量数据库
                              ↓
查询文本 → Embedding → 查询向量 → 相似度搜索 → Top-K 最相似文档
```

### 1.2 关键概念

**Embedding（嵌入向量）：** 将文本、图片、音频等非结构化数据转换为固定长度的浮点数数组。常用的 Embedding 模型：
- OpenAI `text-embedding-3-small`：1536 维，性价比高
- OpenAI `text-embedding-3-large`：3072 维，精度更高
- Cohere `embed-multilingual-v3.0`：1024 维，多语言支持好
- BGE-M3（BAAI）：1024 维，开源，中英文都不错
- Jina `jina-embeddings-v3`：1024 维，开源

**ANN（Approximate Nearest Neighbor，近似最近邻）：** 向量数据库使用 ANN 算法来加速搜索。精确的最近邻搜索在高维空间中计算量巨大（O(n*d)），ANN 以极小的精度损失换取数量级的速度提升。

**主要 ANN 算法：**

| 算法 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **HNSW**（分层可导航小世界图） | 构建多层图结构，从上层开始逐层逼近 | 查询速度快，精度高 | 内存占用大，构建慢 |
| **IVF**（倒排文件索引） | 将向量空间聚类，只搜索相关聚类 | 内存效率高，支持增量更新 | 精度略低于 HNSW |
| **ScaNN** | Google 开发，量化 + 各向异性量化 | 速度极快 | 实现复杂 |
| **DiskANN** | 基于磁盘的 ANN | 支持超大数据集 | 查询延迟高于内存方案 |

### 1.3 相似度度量

```python
# 余弦相似度（最常用，适合文本语义搜索）
cosine_sim(A, B) = (A · B) / (||A|| × ||B||)
# 值域: [-1, 1]，1 表示完全相同

# 欧氏距离（L2 距离）
euclidean(A, B) = sqrt(sum((A[i] - B[i])^2))
# 值域: [0, ∞)，0 表示完全相同

# 内积（点积，适合归一化后的向量）
dot_product(A, B) = sum(A[i] * B[i])
# 值域: [-∞, ∞)
```

---

## 二、六大向量数据库深度对比

### 2.1 总览对比表

| 维度 | Pinecone | Qdrant | Weaviate | pgvector | Milvus | ChromaDB |
|------|----------|--------|----------|----------|--------|----------|
| **类型** | 托管 SaaS | 开源自托管/云 | 开源自托管/云 | PG 扩展开源 | 开源自托管/云 | 开源嵌入式 |
| **协议** | 闭源 | Apache 2.0 | BSD-3 | PostgreSQL | Apache 2.0 | Apache 2.0 |
| **语言** | Rust/C++ | Rust | Go | C | Go/C++ | Python |
| **存储引擎** | 自研 | 自研 | LSM Tree | PostgreSQL | 自研 | SQLite+HNSW |
| **ANN 算法** | 自研 | HNSW | HNSW | IVFFlat/HNSW | IVF/HNSW/DiskANN | HNSW |
| **最大向量维度** | 20,000 | 65,535 | 65,535 | 2,000 | 32,768 | 无限制 |
| **元数据过滤** | ✅ 丰富 | ✅ 丰富 | ✅ GraphQL | ✅ SQL | ✅ 丰富 | ✅ 基本 |
| **多租户** | ✅ Namespace | ✅ Collection | ✅ 原生 | ⚠️ 需手动 | ✅ Partition | ❌ |
| **全文搜索** | ❌ | ✅ | ✅ | ✅ | ✅ Sparse | ❌ |
| **混合搜索** | ❌ | ✅ | ✅ | ✅ (Reciprocal Rank Fusion) | ✅ | ❌ |
| **水平扩展** | ✅ 自动 | ✅ 分片+复制 | ✅ 分片+复制 | ❌ | ✅ 分布式 | ❌ |
| **持久化** | ✅ 云托管 | ✅ WAL | ✅ WAL | ✅ PostgreSQL | ✅ WAL | ⚠️ 本地文件 |
| **Laravel 集成** | REST API | REST/gRPC API | REST/GraphQL API | pgsql driver | REST/gRPC API | Python REST |
| **学习曲线** | 低 | 中 | 中 | 最低（SQL） | 高 | 低 |
| **适合规模** | 任意 | 中大型 | 中大型 | 小型-中型 | 大型 | 开发/原型 |

### 2.2 Pinecone

**定位：** 全托管向量数据库，零运维。

**架构特点：**
- 完全托管的 SaaS 服务，无需管理基础设施
- 支持 Serverless 和 Pod-based 两种模式
- 内置 Namespace（命名空间）用于多租户
- 自动扩缩容

**Laravel 集成：**

```php
// 通过 REST API 集成 Pinecone
class PineconeClient
{
    private string $apiKey;
    private string $baseUrl;
    private string $indexHost;
    
    public function __construct()
    {
        $this->apiKey = config('services.pinecone.api_key');
        $this->indexHost = config('services.pinecone.index_host');
    }
    
    /**
     * 向 Pinecone 索引中插入向量
     */
    public function upsert(string $namespace, array $vectors): array
    {
        $response = Http::withHeaders([
            'Api-Key' => $this->apiKey,
            'Content-Type' => 'application/json',
        ])->post("https://{$this->indexHost}/vectors/upsert", [
            'namespace' => $namespace,
            'vectors' => array_map(fn($v) => [
                'id' => $v['id'],
                'values' => $v['embedding'],
                'metadata' => $v['metadata'] ?? [],
            ], $vectors),
        ]);
        
        return $response->json();
    }
    
    /**
     * 查询相似向量
     */
    public function query(
        string $namespace,
        array $embedding,
        int $topK = 10,
        ?array $filter = null,
        bool $includeMetadata = true,
    ): array {
        $payload = [
            'namespace' => $namespace,
            'vector' => $embedding,
            'topK' => $topK,
            'includeMetadata' => $includeMetadata,
            'includeValues' => false,
        ];
        
        if ($filter) {
            $payload['filter'] = $filter;
        }
        
        $response = Http::withHeaders([
            'Api-Key' => $this->apiKey,
        ])->post("https://{$this->indexHost}/query", $payload);
        
        return $response->json('matches', []);
    }
}

// 使用示例
$pinecone = app(PineconeClient::class);

// 插入文档向量
$pinecone->upsert('knowledge-base', [
    [
        'id' => 'doc-123',
        'embedding' => $embeddingService->embed('Laravel 是一个 PHP Web 框架'),
        'metadata' => [
            'title' => 'Laravel 简介',
            'category' => 'framework',
            'language' => 'zh',
        ],
    ],
]);

// RAG 查询
$results = $pinecone->query(
    namespace: 'knowledge-base',
    embedding: $embeddingService->embed('什么是 Laravel？'),
    topK: 5,
    filter: [
        'category' => ['$eq' => 'framework'],
        'language' => ['$eq' => 'zh'],
    ],
);
```

**优点：**
- 零运维，开箱即用
- 查询延迟低且稳定（p99 < 50ms）
- 免费额度慷慨（Starter 免费 100K 向量）

**缺点：**
- 闭源，无法自托管
- 供应商锁定风险
- 不支持全文搜索和混合搜索
- 成本随数据量线性增长

**价格：**
- Starter（免费）：100K 向量，1GB 存储
- Standard：$70/月起
- Enterprise：联系销售

### 2.3 Qdrant

**定位：** 高性能开源向量数据库，Rust 实现。

**架构特点：**
- Rust 编写，性能优异
- 支持分片和复制，可水平扩展
- 丰富的元数据过滤（嵌套对象、数组、范围查询）
- 支持 Payload 索引，过滤条件不影响搜索精度
- 支持量化（Scalar/Product/Binary）降低内存占用

**Laravel 集成：**

```php
// Qdrant REST API 集成
class QdrantClient
{
    private string $baseUrl;
    
    public function __construct()
    {
        $this->baseUrl = config('services.qdrant.url', 'http://localhost:6333');
    }
    
    /**
     * 创建 Collection
     */
    public function createCollection(string $name, int $vectorSize = 1536): void
    {
        Http::put("{$this->baseUrl}/collections/{$name}", [
            'vectors' => [
                'size' => $vectorSize,
                'distance' => 'Cosine',
            ],
            'optimizers_config' => {
                'indexing_threshold' => 20000,
            },
        ]);
    }
    
    /**
     * 插入/更新向量
     */
    public function upsert(string $collection, array $points): void
    {
        Http::put("{$this->baseUrl}/collections/{$collection}/points", [
            'points' => array_map(fn($p) => [
                'id' => $p['id'],
                'vector' => $p['embedding'],
                'payload' => $p['metadata'] ?? [],
            ], $points),
        ]);
    }
    
    /**
     * 查询相似向量（带过滤）
     */
    public function search(
        string $collection,
        array $embedding,
        int $limit = 10,
        ?array $filter = null,
        ?float $scoreThreshold = null,
    ): array {
        $payload = [
            'vector' => $embedding,
            'limit' => $limit,
            'with_payload' => true,
            'with_vector' => false,
        ];
        
        if ($filter) {
            $payload['filter'] = $filter;
        }
        
        if ($scoreThreshold !== null) {
            $payload['score_threshold'] = $scoreThreshold;
        }
        
        $response = Http::post(
            "{$this->baseUrl}/collections/{$collection}/points/search",
            $payload,
        );
        
        return $response->json('result', []);
    }
    
    /**
     * 混合搜索（向量 + 全文）
     */
    public function hybridSearch(
        string $collection,
        array $embedding,
        string $queryText,
        int $limit = 10,
    ): array {
        // Qdrant 支持 Prefetch + RRF 混合搜索
        $response = Http::post(
            "{$this->baseUrl}/collections/{$collection}/points/query",
            [
                'prefetch' => [
                    [
                        'query' => $embedding,
                        'using' => 'dense',
                        'limit' => 20,
                    ],
                    [
                        'query' => $queryText,
                        'using' => 'sparse',
                        'limit' => 20,
                    ],
                ],
                'query' => ['fusion' => 'rrf'],
                'limit' => $limit,
                'with_payload' => true,
            ],
        );
        
        return $response->json('result.points', []);
    }
}
```

**Docker Compose 部署：**

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"  # gRPC
    volumes:
      - qdrant-data:/qdrant/storage
    environment:
      QDRANT__SERVICE__GRPC_PORT: 6334
      QDRANT__SERVICE__HTTP_PORT: 6333
    deploy:
      resources:
        limits:
          memory: 4G

volumes:
  qdrant-data:
```

**优点：**
- Rust 编写，性能优异
- 过滤条件执行效率高（Payload 索引）
- 混合搜索支持（向量 + 全文 + RRF）
- 内存优化好（量化支持）
- 社区活跃，文档完善

**缺点：**
- 生态系统不如 Pinecone 成熟
- 自托管需要运维投入
- 多租户需要手动设计 Collection 结构

**价格（Qdrant Cloud）：**
- 免费层：1GB 存储
- Standard：$25/月起
- 按存储和计算资源计费

### 2.4 Weaviate

**定位：** AI-native 向量数据库，内置 Embedding 模块。

**架构特点：**
- Go 编写
- GraphQL API（也支持 REST）
- 内置 Embedding 模块（text2vec-openai、text2vec-cohere 等）
- 原生多租户支持
- 支持混合搜索（向量 + BM25 全文）

**Laravel 集成：**

```php
// Weaviate REST API 集成
class WeaviateClient
{
    private string $baseUrl;
    
    public function __construct()
    {
        $this->baseUrl = config('services.weaviate.url', 'http://localhost:8080');
    }
    
    /**
     * 创建 Class（Schema）
     */
    public function createClass(string $className, ?string $vectorizer = null): void
    {
        $class = [
            'class' => $className,
            'vectorizer' => $vectorizer ?? 'text2vec-openai',
            'vectorIndexConfig' => [
                'distance' => 'cosine',
                'ef' => 128,
                'maxConnections' => 64,
            ],
            'moduleConfig' => [
                'text2vec-openai' => [
                    'model' => 'text-embedding-3-small',
                    'dimensions' => 1536,
                ],
            ],
        ];
        
        Http::post("{$this->baseUrl}/v1/schema", $class);
    }
    
    /**
     * 插入对象（自动向量化）
     */
    public function createObject(string $className, array $data): array
    {
        $response = Http::post("{$this->baseUrl}/v1/objects", [
            'class' => $className,
            'properties' => $data,
        ]);
        
        return $response->json();
    }
    
    /**
     * 近似最近邻搜索
     */
    public function nearText(
        string $className,
        array $concepts,
        int $limit = 10,
        ?array $where = null,
    ): array {
        $query = [
            'query' => <<<'GRAPHQL'
                {
                  Get {
                    %s(
                      nearText: {
                        concepts: %s
                        certainty: 0.7
                      }
                      limit: %d
                      %s
                    ) {
                      _additional {
                        id
                        certainty
                        distance
                      }
                      %s
                    }
                  }
                }
            GRAPHQL,
        ];
        
        $response = Http::post("{$this->baseUrl}/v1/graphql", [
            'query' => sprintf(
                $query['query'],
                $className,
                json_encode($concepts),
                $limit,
                $where ? 'where: ' . json_encode($where) : '',
                $this->getFieldsString($className),
            ),
        ]);
        
        return $response->json("data.Get.{$className}", []);
    }
    
    /**
     * 混合搜索
     */
    public function hybrid(
        string $className,
        string $query,
        int $limit = 10,
        float $alpha = 0.5,
    ): array {
        $response = Http::post("{$this->baseUrl}/v1/graphql", [
            'query' => <<<'GRAPHQL'
                {
                  Get {
                    %s(
                      hybrid: {
                        query: "%s"
                        alpha: %f
                      }
                      limit: %d
                    ) {
                      _additional {
                        id
                        score
                      }
                      title
                      content
                    }
                  }
                }
            GRAPHQL,
        ]);
        
        return $response->json("data.Get.{$className}", []);
    }
}
```

**Docker Compose 部署：**

```yaml
services:
  weaviate:
    image: semitechnologies/weaviate:latest
    ports:
      - "8080:8080"
      - "50051:50051"
    volumes:
      - weaviate-data:/var/lib/weaviate
    environment:
      QUERY_DEFAULTS_LIMIT: 20
      AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED: 'true'
      PERSISTENCE_DATA_PATH: '/var/lib/weaviate'
      DEFAULT_VECTORIZER_MODULE: 'text2vec-openai'
      ENABLE_MODULES: 'text2vec-openai,text2vec-cohere'
      CLUSTER_HOSTNAME: 'node1'
      OPENAI_APIKEY: ${OPENAI_API_KEY}

volumes:
  weaviate-data:
```

**优点：**
- 内置 Embedding 模块（不需要单独调用 Embedding API）
- GraphQL API 灵活强大
- 原生多租户
- 混合搜索效果好

**缺点：**
- Go 编写，内存占用比 Qdrant 高
- GraphQL 学习曲线
- 大规模数据集性能不如 Qdrant 和 Milvus
- 配置复杂度较高

### 2.5 pgvector

**定位：** PostgreSQL 的向量搜索扩展。如果你已经用 PostgreSQL，pgvector 是最简单的选择。

**架构特点：**
- 作为 PostgreSQL 扩展安装
- 支持 IVFFlat 和 HNSW 索引
- 与 SQL 完全融合——可以用 SQL 做混合查询
- 事务支持（ACID）
- 支持所有 PostgreSQL 生态工具

**Laravel 集成（最简单）：**

```php
// pgvector 最大的优势：零额外依赖，直接用 SQL
// 安装 pgvector 扩展后，Laravel 的 pgsql driver 直接可用

// 1. 安装 pgvector（PostgreSQL 扩展）
// CREATE EXTENSION IF NOT EXISTS vector;

// 2. Laravel Migration
class CreateDocumentsTable extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE EXTENSION IF NOT EXISTS vector');
        
        Schema::create('documents', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->text('content');
            $table->string('category')->nullable();
            $table->timestamps();
        });
        
        // 添加向量列（1536 维 = OpenAI text-embedding-3-small）
        DB::statement('ALTER TABLE documents ADD COLUMN embedding vector(1536)');
        
        // 创建 HNSW 索引（推荐，比 IVFFlat 更好）
        DB::statement(<<<'SQL'
            CREATE INDEX documents_embedding_idx 
            ON documents 
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 200)
        SQL);
    }
}

// 3. 插入向量
class DocumentRepository
{
    public function store(string $title, string $content, array $embedding, ?string $category = null): void
    {
        DB::table('documents')->insert([
            'title' => $title,
            'content' => $content,
            'embedding' => '[' . implode(',', $embedding) . ']',
            'category' => $category,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
    
    /**
     * 向量相似度搜索
     */
    public function search(array $queryEmbedding, int $limit = 10, ?string $category = null): array
    {
        $query = DB::table('documents')
            ->select('id', 'title', 'content', 'category')
            ->selectRaw(
                '1 - (embedding <=> ?) as similarity',
                ['[' . implode(',', $queryEmbedding) . ']']
            )
            ->orderByRaw('embedding <=> ?', ['[' . implode(',', $queryEmbedding) . ']'])
            ->limit($limit);
        
        if ($category) {
            $query->where('category', $category);
        }
        
        return $query->get()->toArray();
    }
    
    /**
     * 混合搜索（向量 + 全文）— pgvector 的杀手级特性
     */
    public function hybridSearch(
        array $queryEmbedding,
        string $queryText,
        int $limit = 10,
        float $vectorWeight = 0.7,
        float $textWeight = 0.3,
    ): array {
        // 使用 Reciprocal Rank Fusion (RRF) 合并向量搜索和全文搜索结果
        return DB::select(<<<'SQL'
            WITH vector_search AS (
                SELECT id, title, content,
                       ROW_NUMBER() OVER (ORDER BY embedding <=> ?::vector) as rank
                FROM documents
                ORDER BY embedding <=> ?::vector
                LIMIT ?
            ),
            text_search AS (
                SELECT id, title, content,
                       ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('simple', content), plainto_tsquery('simple', ?)) DESC) as rank
                FROM documents
                WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', ?)
                ORDER BY ts_rank_cd(to_tsvector('simple', content), plainto_tsquery('simple', ?)) DESC
                LIMIT ?
            ),
            combined AS (
                SELECT id, title, content,
                       COALESCE(1.0 / (60 + vs.rank), 0) * ? as vector_score,
                       COALESCE(1.0 / (60 + ts.rank), 0) * ? as text_score
                FROM documents d
                LEFT JOIN vector_search vs ON d.id = vs.id
                LEFT JOIN text_search ts ON d.id = ts.id
                WHERE vs.id IS NOT NULL OR ts.id IS NOT NULL
            )
            SELECT id, title, content,
                   vector_score + text_score as combined_score
            FROM combined
            ORDER BY combined_score DESC
            LIMIT ?
        SQL, [
            '[' . implode(',', $queryEmbedding) . ']',
            '[' . implode(',', $queryEmbedding) . ']',
            $limit * 2,
            $queryText,
            $queryText,
            $queryText,
            $limit * 2,
            $vectorWeight,
            $textWeight,
            $limit,
        ]);
    }
}
```

**Eloquent 集成（更优雅）：**

```php
// 创建一个 Trait 处理向量搜索
trait VectorSearchable
{
    abstract public function getEmbeddingColumn(): string;
    abstract public function getEmbeddingDimensions(): int;
    
    /**
     * 相似度搜索 Scope
     */
    public function scopeNearestTo(
        Builder $query,
        array $embedding,
        int $limit = 10,
        float $threshold = 0.7,
    ): Builder {
        $column = $this->getEmbeddingColumn();
        $vectorStr = '[' . implode(',', $embedding) . ']';
        
        return $query
            ->selectRaw("*, 1 - ({$column} <=> ?::vector) as _similarity", [$vectorStr])
            ->whereRaw("1 - ({$column} <=> ?::vector) >= ?", [$vectorStr, $threshold])
            ->orderByRaw("{$column} <=> ?::vector", [$vectorStr])
            ->limit($limit);
    }
}

// 使用
class Document extends Model
{
    use VectorSearchable;
    
    public function getEmbeddingColumn(): string
    {
        return 'embedding';
    }
    
    public function getEmbeddingDimensions(): int
    {
        return 1536;
    }
}

// 查询
$results = Document::nearestTo($embedding, limit: 5)
    ->where('category', 'laravel')
    ->get();

// 结果包含 _similarity 字段
foreach ($results as $doc) {
    echo "{$doc->title}: {$doc->_similarity}\n";
}
```

**优点：**
- 零额外依赖（已用 PostgreSQL 就直接用）
- SQL 融合——可以同时用 SQL 的所有能力
- 事务支持——向量操作在事务中
- 学习曲线最低
- 成本最低（不需要额外的服务）

**缺点：**
- 性能上限低于专用向量数据库（>100M 向量时明显）
- 不支持分布式扩展
- HNSW 索引创建时需要全量构建
- 向量维度限制 2000（在某些版本中）
- 大规模数据集查询延迟较高

### 2.6 Milvus

**定位：** 为大规模向量搜索设计的分布式数据库。

**Laravel 集成：**

```php
// Milvus REST API 集成
class MilvusClient
{
    private string $baseUrl;
    
    public function __construct()
    {
        $this->baseUrl = config('services.milvus.url', 'http://localhost:19530');
    }
    
    /**
     * 创建 Collection
     */
    public function createCollection(string $name, int $dimension = 1536): void
    {
        Http::post("{$this->baseUrl}/v2/vectordb/collections/create", [
            'collectionName' => $name,
            'schema' => [
                'fields' => [
                    ['fieldName' => 'id', 'dataType' => 'Int64', 'isPrimary' => true, 'autoID' => true],
                    ['fieldName' => 'content', 'dataType' => 'VarChar', 'maxLength' => 65535],
                    ['fieldName' => 'embedding', 'dataType' => 'FloatVector', 'params' => ['dim' => $dimension]],
                ],
            ],
            'indexParams' => [
                ['fieldName' => 'embedding', 'indexType' => 'HNSW', 'metricType' => 'COSINE', 'params' => ['M' => 16, 'efConstruction' => 256]],
            ],
        ]);
    }
    
    /**
     * 搜索
     */
    public function search(string $collection, array $embedding, int $limit = 10): array
    {
        $response = Http::post("{$this->baseUrl}/v2/vectordb/entities/search", [
            'collectionName' => $collection,
            'data' => [$embedding],
            'limit' => $limit,
            'outputFields' => ['content'],
        ]);
        
        return $response->json('results', []);
    }
}
```

**优点：**
- 支持超大规模数据集（百亿级向量）
- 分布式架构，可水平扩展
- 多种索引算法（HNSW、IVF、DiskANN、GPU 索引）
- 支持稀疏向量（全文搜索）
- 社区活跃（LF AI & Data 基金会）

**缺点：**
- 架构复杂（需要 etcd、MinIO、Pulsar 等依赖）
- 运维成本高
- 单机部署时性能优势不明显
- 学习曲线陡峭

### 2.7 ChromaDB

**定位：** 轻量级嵌入式向量数据库，适合原型和小型应用。

```python
# ChromaDB 主要用于 Python，但可以通过 REST API 集成
# Docker 部署
docker run -d -p 8000:8000 chromadb/chroma
```

```php
// Laravel 通过 REST API 集成 ChromaDB
class ChromaClient
{
    private string $baseUrl;
    
    public function __construct()
    {
        $this->baseUrl = config('services.chromadb.url', 'http://localhost:8000');
    }
    
    public function addDocuments(string $collection, array $documents, array $embeddings, array $ids): void
    {
        Http::post("{$this->baseUrl}/api/v1/collections/{$collection}/add", [
            'documents' => $documents,
            'embeddings' => $embeddings,
            'ids' => $ids,
        ]);
    }
    
    public function query(string $collection, array $embedding, int $nResults = 10): array
    {
        return Http::post("{$this->baseUrl}/api/v1/collections/{$collection}/query", [
            'query_embeddings' => [$embedding],
            'n_results' => $nResults,
        ])->json();
    }
}
```

**优点：** 最简单的入门方式，适合快速原型开发。
**缺点：** 不支持分布式，不适合生产环境大规模使用。

---

## 三、RAG Pipeline 完整实现

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     RAG Pipeline                              │
│                                                               │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ 文档输入  │───▶│  文档分块     │───▶│  Embedding 生成   │   │
│  │ (PDF/MD/ │    │  (Chunking)  │    │  (API/本地模型)   │   │
│  │  网页)   │    │              │    │                  │   │
│  └──────────┘    └──────────────┘    └────────┬─────────┘   │
│                                                │              │
│                                                ▼              │
│                                       ┌──────────────────┐   │
│                                       │  向量数据库        │   │
│                                       │  (存储 + 索引)     │   │
│                                       └────────┬─────────┘   │
│                                                │              │
│  用户查询 ──▶ Embedding ──▶ 相似度搜索 ──────┘              │
│                                                │              │
│                                                ▼              │
│                                       ┌──────────────────┐   │
│                                       │  上下文组装        │   │
│                                       │  (Prompt Template)│   │
│                                       └────────┬─────────┘   │
│                                                │              │
│                                                ▼              │
│                                       ┌──────────────────┐   │
│                                       │  LLM 生成回答     │   │
│                                       │  (GPT-4/Claude/  │   │
│                                       │   本地模型)       │   │
│                                       └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Laravel RAG 服务实现

```php
// app/Services/RagService.php
namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class RagService
{
    private EmbeddingService $embedding;
    private VectorStoreInterface $vectorStore;
    
    public function __construct(
        EmbeddingService $embedding,
        VectorStoreInterface $vectorStore,
    ) {
        $this->embedding = $embedding;
        $this->vectorStore = $vectorStore;
    }
    
    /**
     * 索引文档
     */
    public function indexDocument(string $content, array $metadata): void
    {
        // 1. 文档分块
        $chunks = $this->chunkText($content, chunkSize: 1000, overlap: 200);
        
        // 2. 批量生成 Embedding
        $embeddings = $this->embedding->batchEmbed($chunks);
        
        // 3. 存储到向量数据库
        foreach ($chunks as $i => $chunk) {
            $this->vectorStore->upsert([
                'id' => $metadata['id'] . '-chunk-' . $i,
                'embedding' => $embeddings[$i],
                'metadata' => array_merge($metadata, [
                    'chunk_index' => $i,
                    'chunk_text' => $chunk,
                ]),
            ]);
        }
    }
    
    /**
     * RAG 查询
     */
    public function query(string $question, int $topK = 5): array
    {
        // 1. 生成查询 Embedding
        $queryEmbedding = $this->embedding->embed($question);
        
        // 2. 检索相关文档
        $results = $this->vectorStore->search(
            embedding: $queryEmbedding,
            topK: $topK,
            threshold: 0.7,
        );
        
        // 3. 组装上下文
        $context = collect($results)
            ->map(fn($r) => $r['metadata']['chunk_text'])
            ->join("\n\n---\n\n");
        
        // 4. 调用 LLM
        $answer = $this->callLLM($question, $context);
        
        return [
            'answer' => $answer,
            'sources' => $results,
            'query' => $question,
        ];
    }
    
    /**
     * 文本分块（RecursiveCharacterTextSplitter 风格）
     */
    private function chunkText(string $text, int $chunkSize = 1000, int $overlap = 200): array
    {
        $separators = ["\n\n", "\n", "。", ".", "！", "!", "？", "?", "；", ";"];
        $chunks = [];
        
        $this->recursiveSplit($text, $separators, $chunkSize, $overlap, $chunks);
        
        return array_filter($chunks, fn($c) => mb_strlen(trim($c)) > 0);
    }
    
    private function recursiveSplit(
        string $text,
        array $separators,
        int $chunkSize,
        int $overlap,
        array &$chunks,
    ): void {
        if (mb_strlen($text) <= $chunkSize) {
            $chunks[] = $text;
            return;
        }
        
        $separator = $separators[0] ?? ' ';
        $parts = explode($separator, $text);
        
        $currentChunk = '';
        foreach ($parts as $part) {
            if (mb_strlen($currentChunk) + mb_strlen($part) + mb_strlen($separator) > $chunkSize) {
                if ($currentChunk !== '') {
                    $chunks[] = $currentChunk;
                }
                $currentChunk = $part;
            } else {
                $currentChunk .= ($currentChunk ? $separator : '') . $part;
            }
        }
        
        if ($currentChunk !== '') {
            $chunks[] = $currentChunk;
        }
    }
    
    /**
     * 调用 LLM 生成回答
     */
    private function callLLM(string $question, string $context): string
    {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.api_key'),
        ])->post('https://api.openai.com/v1/chat/completions', [
            'model' => 'gpt-4o-mini',
            'messages' => [
                [
                    'role' => 'system',
                    'content' => <<<'PROMPT'
你是一个知识库助手。基于以下参考文档回答用户的问题。
如果参考文档中没有相关信息，请明确告知用户你不确定。
回答时请引用来源。

参考文档：
{$context}
PROMPT,
                ],
                [
                    'role' => 'user',
                    'content' => $question,
                ],
            ],
            'temperature' => 0.1,
            'max_tokens' => 2000,
        ]);
        
        return $response->json('choices.0.message.content', '无法生成回答');
    }
}
```

### 3.3 Embedding 服务

```php
// app/Services/EmbeddingService.php
namespace App\Services;

use Illuminate\Support\Facades\Http;

class EmbeddingService
{
    private string $apiKey;
    private string $model;
    
    public function __construct()
    {
        $this->apiKey = config('services.openai.api_key');
        $this->model = config('services.openai.embedding_model', 'text-embedding-3-small');
    }
    
    /**
     * 生成单个文本的 Embedding
     */
    public function embed(string $text): array
    {
        return Cache::remember(
            'embedding:' . md5($text),
            now()->addDays(30),
            fn() => $this->callAPI([$text])[0]
        );
    }
    
    /**
     * 批量生成 Embedding
     */
    public function batchEmbed(array $texts): array
    {
        // OpenAI 允许每次最多 2048 个输入
        $batches = array_chunk($texts, 2048);
        $allEmbeddings = [];
        
        foreach ($batches as $batch) {
            $results = $this->callAPI($batch);
            $allEmbeddings = array_merge($allEmbeddings, $results);
        }
        
        return $allEmbeddings;
    }
    
    private function callAPI(array $inputs): array
    {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . $this->apiKey,
        ])->post('https://api.openai.com/v1/embeddings', [
            'model' => $this->model,
            'input' => $inputs,
        ]);
        
        return collect($response->json('data'))
            ->sortBy('index')
            ->pluck('embedding')
            ->toArray();
    }
}
```

---

## 四、多租户策略

### 4.1 各数据库的多租户方案

| 数据库 | 推荐方案 | 实现方式 |
|--------|----------|----------|
| Pinecone | Namespace | 每个租户一个 Namespace |
| Qdrant | Collection + Payload 过滤 | 每个租户一个 Collection，或用 Payload 过滤 |
| Weaviate | 原生多租户 | `tenant` 字段，自动隔离 |
| pgvector | 行级安全策略 (RLS) | PostgreSQL RLS + tenant_id 列 |
| Milvus | Partition Key | `tenant_id` 作为 Partition Key |

### 4.2 pgvector 多租户实现

```php
// 使用 PostgreSQL RLS 实现多租户向量搜索
class CreateTenantAwareDocumentsTable extends Migration
{
    public function up(): void
    {
        Schema::create('documents', function (Blueprint $table) {
            $table->id();
            $table->uuid('tenant_id');
            $table->string('title');
            $table->text('content');
            $table->timestamps();
        });
        
        DB::statement('ALTER TABLE documents ADD COLUMN embedding vector(1536)');
        DB::statement('CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops)');
        
        // 启用 RLS
        DB::statement('ALTER TABLE documents ENABLE ROW LEVEL SECURITY');
        
        // 创建策略：每个租户只能访问自己的数据
        DB::statement(<<<'SQL'
            CREATE POLICY tenant_isolation ON documents
            USING (tenant_id = current_setting('app.current_tenant')::uuid)
        SQL);
    }
}

// 在 Laravel 中设置当前租户
class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $tenantId = app(Tenant::class)->id;
        
        // 设置 PostgreSQL 会话变量
        DB::statement("SET app.current_tenant = '{$tenantId}'");
        
        $builder->where('tenant_id', $tenantId);
    }
}
```

---

## 五、性能优化

### 5.1 索引参数调优

```sql
-- pgvector HNSW 参数调优
-- M: 每个节点的最大连接数（越大越精确，但内存和构建时间增加）
-- ef_construction: 构建时的搜索宽度（越大索引质量越高）
-- ef_search: 查询时的搜索宽度（越大查询越精确但越慢）

-- 构建索引时
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops)
WITH (m = 32, ef_construction = 256);  -- 更高质量的索引

-- 查询时调整 ef_search
SET hnsw.ef_search = 100;  -- 默认 40，提高可增加召回率

-- Qdrant HNSW 参数
{
  "optimizers_config": {
    "indexing_threshold": 20000
  },
  "hnsw_config": {
    "m": 32,
    "ef_construct": 256,
    "full_scan_threshold": 10000
  }
}
```

### 5.2 量化（Quantization）

```php
// Qdrant 支持多种量化方式降低内存占用
// Product Quantization (PQ): 将 1536 维向量压缩为 96 字节
// Scalar Quantization (SQ): 将 float32 压缩为 int8
// Binary Quantization (BQ): 将向量压缩为 1 bit/维度

// Qdrant 创建 Collection 时启用量化
Http::put("{$baseUrl}/collections/documents", [
    'vectors' => [
        'size' => 1536,
        'distance' => 'Cosine',
    ],
    'quantization_config' => [
        'scalar' => [
            'type' => 'int8',
            'quantile' => 0.99,
            'always_ram' => true,
        ],
    ],
]);
```

### 5.3 批量操作优化

```php
// 避免逐条插入，使用批量操作
// 不推荐
foreach ($documents as $doc) {
    $vectorStore->upsert($doc);  // N 次网络请求
}

// 推荐
$chunks = array_chunk($documents, 100);
foreach ($chunks as $batch) {
    $vectorStore->batchUpsert($batch);  // N/100 次网络请求
}
```

---

## 六、成本分析

### 6.1 各方案月成本估算（100 万向量，1536 维）

| 方案 | 存储成本 | 计算成本 | 总月成本 |
|------|----------|----------|----------|
| Pinecone Standard | ~$70 | 含在内 | ~$70 |
| Qdrant Cloud | ~$40 | ~$30 | ~$70 |
| Weaviate Cloud | ~$50 | ~$40 | ~$90 |
| pgvector (RDS) | ~$30 | ~$30 | ~$60 |
| pgvector (自托管) | ~$20 | ~$20 | ~$40 |
| Milvus Cloud | ~$60 | ~$50 | ~$110 |

### 6.2 规模化成本

**1000 万向量：**
- Pinecone: ~$350/月
- Qdrant Cloud: ~$200/月
- pgvector (RDS): ~$150/月（性能可能开始下降）

**1 亿向量：**
- Pinecone: ~$2000/月
- Qdrant Cloud: ~$1200/月
- Milvus Cloud: ~$1500/月
- pgvector: 不推荐（性能瓶颈明显）

---

## 七、决策矩阵

| 你的情况 | 推荐方案 | 理由 |
|----------|----------|------|
| 已用 PostgreSQL，数据量 < 100 万 | **pgvector** | 零额外依赖，SQL 融合，最低成本 |
| 已用 PostgreSQL，数据量 100-1000 万 | **pgvector + Qdrant** | pgvector 做简单搜索，Qdrant 做高性能搜索 |
| 纯 SaaS 方案，不想运维 | **Pinecone** | 零运维，延迟稳定 |
| 需要混合搜索，自托管 | **Qdrant** | 向量+全文+RRF，Rust 高性能 |
| 需要内置 Embedding，团队用 Go | **Weaviate** | 内置向量化模块 |
| 超大规模（1亿+向量） | **Milvus** | 分布式架构，GPU 索引 |
| 快速原型/POC | **ChromaDB** | 最简单的入门方式 |
| 多语言支持，内置 Embedding | **Weaviate** | text2vec 模块支持多语言 |

---

## 八、总结

向量数据库的选型不是「哪个最好」的问题，而是「哪个最适合你的场景」的问题。

**核心决策因素：**
1. **数据规模：** < 100 万 → pgvector；100 万 - 1 亿 → Qdrant/Weaviate；> 1 亿 → Milvus
2. **运维能力：** 无运维 → Pinecone；有运维 → Qdrant/Milvus
3. **已有基础设施：** 已有 PostgreSQL → pgvector
4. **搜索类型：** 纯向量 → 任意；混合搜索 → Qdrant/Weaviate
5. **预算：** 最低 → pgvector；中等 → Qdrant；不差钱 → Pinecone

对于 Laravel/PHP 开发者，我的建议是：

**从 pgvector 开始。** 它的集成成本为零（你已经在用 PostgreSQL），学习成本为零（就是 SQL），而且在 100 万向量以内的性能完全够用。当你的数据量增长到 pgvector 无法满足时，再迁移到 Qdrant 或 Milvus 也不迟。

不要过度设计。大多数 RAG 应用的数据量远没有达到需要专用向量数据库的程度。

---

## 参考资料

1. Pinecone. "What is a Vector Database?" pinecone.io/learn
2. Johnson, J., et al. "Billion-scale similarity search with GPUs." arXiv:1702.08734
3. Malkov, Y., Yashunin, D. "Efficient and robust approximate nearest neighbor using HNSW graphs." IEEE TPAMI 2018
4. pgvector Documentation. github.com/pgvector/pgvector
5. Qdrant Documentation. qdrant.tech/documentation
6. Weaviate Documentation. weaviate.io/developers/weaviate

---

## 相关阅读

- [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/databases/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用)——Redis 原生向量搜索能力，与 pgvector 互补的轻量级方案
- [MySQL 9.x 新特性实战：向量搜索、JSON 增强与 Laravel 适配](/01_MySQL/2026-06-02-MySQL-9.x-新特性实战-向量搜索-JSON增强-性能改进与Laravel适配)——MySQL 也支持向量搜索了？与 pgvector 的对比分析
- [Multi-Modal RAG 实战：图文混合检索与跨模态向量搜索](/ai/Multi-Modal-RAG-实战-图文混合检索-CLIP嵌入-跨模态向量搜索与电商商品图文问答落地)——RAG 进阶：CLIP 嵌入与跨模态检索的工程落地
