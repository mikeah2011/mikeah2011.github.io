---

title: RAG 系统实战：向量数据库选型、Chunking 策略、检索优化
keywords: [RAG, Chunking, 系统实战, 向量数据库选型, 策略, 检索优化]
date: 2026-06-02 02:31:05
tags:
- RAG
- 数据库
- Chunking
- 检索优化
- Embedding
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 本文系统拆解 RAG 落地中的关键决策，覆盖向量数据库选型、Chunking 切分策略、Embedding 模型选择与检索优化方法，深入比较 Milvus、Qdrant、Weaviate、pgvector 等方案，并结合代码示例讲清召回准确率、延迟、成本与工程可维护性的平衡，帮助你构建真正可上线的企业知识库与问答系统。
---



# RAG 系统实战：向量数据库选型、Chunking 策略、检索优化

在过去两年里，RAG（Retrieval-Augmented Generation，检索增强生成）几乎已经成为企业落地大模型应用时的默认架构。原因很直接：纯大模型虽然具备强大的语言理解和生成能力，但在企业内部知识、实时数据、专业术语、合规控制和可解释性方面天然存在短板。把“检索”接到“生成”前面，就等于给模型装上了一个可控、可更新、可审计的知识外脑。

但很多团队真正开始做 RAG 后，很快会发现：问题根本不在“能不能跑起来”，而在“为什么召回不准”“为什么上下文明明有答案模型还是答错”“为什么数据一大性能就掉下来了”“为什么线上效果和离线评测不一致”。这些问题的根源，往往集中在三个核心环节：**向量数据库的选型是否匹配业务、文档 Chunking 是否合理、检索链路是否经过系统性优化**。

本文不是概念性科普，而是面向真实工程落地的实战总结。我会从架构原理出发，逐步讲清楚向量库选型、Chunking 策略、Embedding 模型、混合检索、重排序、查询改写、Laravel 集成、评估指标、部署监控，以及最后那些只有上线之后才会遇到的“坑”。整篇文章尽量以工程视角组织：**为什么这样设计、有哪些权衡、代码如何写、线上如何验证**。

---

## 一、RAG 架构原理与适用场景

### 1.1 RAG 到底解决了什么问题

一个没有外部知识接入的大模型，本质上只能依赖预训练参数里的“静态记忆”。这带来四个典型问题：

1. **知识过时**：模型无法天然知道昨天刚发布的制度、今天刚更新的商品价格、刚上线的 API 文档。
2. **企业私域知识缺失**：内部 SOP、产品手册、合同模板、客服知识库，通常不在通用模型训练集里。
3. **幻觉不可控**：即使问题有明确答案，模型也可能根据语言模式“编一个看起来合理”的结果。
4. **审计困难**：业务方经常会问：“这句话依据哪份文档？”纯生成系统很难回答。

RAG 的核心思想就是：**先检索，再生成**。先从外部知识库中召回与问题最相关的文档片段，再把这些片段作为上下文喂给大模型，让模型“基于证据回答”。

一个经典的 RAG 数据流如下：

```text
用户问题 -> 查询预处理 -> 检索器 -> 候选文档 -> 重排序 -> 上下文构建 -> LLM 生成 -> 答案 + 引用
```

如果把系统拆成模块，通常包括：

- 文档采集与清洗
- 文档切分（Chunking）
- Embedding 向量化
- 索引构建与存储
- 查询理解与改写
- 召回（向量检索 / 关键词检索 / 混合检索）
- 重排序（Reranker）
- Prompt 组装
- LLM 生成
- 评估、反馈与监控

### 1.2 RAG 的典型架构

下面给出一个面向生产环境的简化架构示意：

```php
<?php

final class RagPipeline
{
    public function answer(string $question): array
    {
        $rewrittenQueries = $this->rewriteQuery($question);

        $candidates = [];
        foreach ($rewrittenQueries as $query) {
            $vectorDocs = $this->vectorRetriever->search($query, topK: 20);
            $keywordDocs = $this->bm25Retriever->search($query, topK: 20);
            $candidates = array_merge($candidates, $vectorDocs, $keywordDocs);
        }

        $deduped = $this->deduplicate($candidates);
        $reranked = $this->reranker->rank($question, $deduped);
        $topDocs = array_slice($reranked, 0, 6);

        $prompt = $this->promptBuilder->build(
            question: $question,
            documents: $topDocs
        );

        $answer = $this->llm->generate($prompt);

        return [
            'answer' => $answer,
            'sources' => array_map(fn($doc) => $doc['source'], $topDocs),
        ];
    }
}
```

这个流程看起来不复杂，但每一环都可能成为效果瓶颈。比如：

- 改写过度会引入噪声；
- Chunk 太小会丢上下文，太大会稀释语义；
- 只做向量检索会漏掉精确关键词；
- 不做重排序，TopK 常常“看起来像相关，实际上不够回答问题”；
- Prompt 里上下文顺序不合理，会导致模型忽略关键片段。

### 1.3 适用场景与不适用场景

RAG 适合的场景通常满足以下几个特征：

#### 适合场景

1. **知识密集型问答**
   - 企业知识库问答
   - 文档助手
   - API 文档问答
   - 制度合规问答

2. **需要引用依据的生成任务**
   - 合同条款解释
   - 招投标文档分析
   - 医疗/金融知识问答（需附依据）

3. **知识更新频繁**
   - 电商商品信息
   - 工单系统
   - 运维知识库
   - 新闻/公告类内容

4. **需要多源知识整合**
   - Wiki + 数据库 + FAQ + PDF 手册联合检索

#### 不太适合的场景

1. **需要复杂推理但知识并不依赖外部文档**
   例如纯数学推理、复杂代码生成、博弈策略，这些更依赖模型能力而不是外部知识。

2. **答案必须来自结构化事务数据，且实时一致性极强**
   例如“我的账户余额是多少”，应优先调用数据库/API，而不是仅依赖向量检索。

3. **文档质量极差，且无法清洗**
   OCR 错乱、目录层级缺失、表格严重破碎的文档，直接做 RAG 通常效果很差。

### 1.4 RAG 与 Fine-tuning 的区别

很多团队一开始会纠结：我到底应该做 RAG，还是做微调？实际经验是：**二者解决的问题不同**。

- **RAG 解决知识注入与可更新性问题**
- **微调解决风格、格式、任务模式、领域行为习惯问题**

一个简单判断原则：

- 如果你要让模型“知道最新文档内容”，优先 RAG。
- 如果你要让模型“学会按某种稳定格式输出”，优先微调。
- 如果两者都要，往往是 **RAG + 轻量微调**。

### 1.5 生产环境中的 RAG 分层设计

建议把 RAG 系统拆成三层：

```text
数据层：采集、清洗、切分、向量化、索引
检索层：召回、融合、重排序、过滤
应用层：Prompt、生成、权限控制、引用、反馈
```

对应代码组织可以参考：

```php
app/
├── Domain/Rag/
│   ├── Ingestion/
│   ├── Chunking/
│   ├── Embedding/
│   ├── Retrieval/
│   ├── Rerank/
│   ├── Prompt/
│   └── Evaluation/
└── Http/Controllers/Api/
```

这种分层的好处是：以后替换 Embedding 模型、向量数据库、Reranker，不需要动业务层控制器。

---

## 二、向量数据库选型：Milvus / Qdrant / Weaviate / pgvector / Chroma

向量数据库不是“谁更先进”就选谁，而是要看你的数据规模、团队能力、部署方式、过滤需求、生态兼容性和成本。

### 2.1 选型核心维度

建议从以下 8 个维度比较：

1. **数据规模**：百万、千万还是亿级？
2. **查询延迟**：是离线分析还是在线对话？
3. **过滤能力**：是否需要 metadata filter？
4. **混合检索支持**：是否支持 BM25 / sparse vector？
5. **运维复杂度**：团队是否愿意维护分布式集群？
6. **生态支持**：LangChain、LlamaIndex、官方 SDK 是否完善？
7. **成本**：机器、存储、维护成本。
8. **一致性与事务性**：是否要和业务数据库强绑定？

一个简化对比表如下：

| 产品 | 优势 | 劣势 | 适合场景 |
|---|---|---|---|
| Milvus | 大规模、高性能、ANN 能力强 | 运维较复杂 | 千万级以上向量检索 |
| Qdrant | 易用、过滤强、混合检索友好 | 超大规模下需评估资源 | 中大型在线 RAG |
| Weaviate | Schema 丰富、生态完善、功能全面 | 相对更重 | 需要丰富对象建模 |
| pgvector | 与 PostgreSQL 深度集成、简单 | 极大规模性能有限 | 中小规模、事务型系统 |
| Chroma | 本地开发方便、上手快 | 生产能力有限 | Demo、PoC、单机原型 |

如果你要进一步从功能、价格与落地方式做筛选，可以参考下面这张更贴近采购和架构评审的对比表：

| 向量数据库 | 核心特性 | 价格/成本特征 | 典型使用场景 |
|---|---|---|---|
| Milvus | 高性能 ANN、分布式扩展、适合超大规模向量集合 | 开源自建软件免费，但需要额外承担集群、存储、监控和运维成本 | 千万到亿级文档检索平台、多租户知识库、需要高吞吐的 RAG 基础设施 |
| Pinecone | 全托管、扩缩容省心、开发接入快、云服务成熟 | 按容量、请求量和部署规格计费，省运维但长期费用通常高于自建 | 团队人少、想快速上线 SaaS 型 RAG、对托管稳定性要求高 |
| Weaviate | 对象化 Schema、向量 + 过滤 + 模块化能力完整 | 可自建，也可使用托管版；功能丰富但资源占用与复杂度相对更高 | 需要知识对象建模、语义搜索与推荐结合、希望统一管理多类数据 |
| Qdrant | Payload Filter 强、混合检索友好、上手快、RAG 社区采用广 | 开源自建成本可控，托管版按节点/资源计费，整体性价比高 | 企业知识库、租户隔离检索、在线问答、需要过滤条件较多的检索系统 |
| Chroma | 本地开发简单、适合原型验证、嵌入式使用方便 | 本地或单机部署成本低，但生产级高可用与扩展能力有限 | Demo、PoC、离线实验、小规模内部工具 |
| pgvector | 直接复用 PostgreSQL、支持事务与 Join、权限与备份体系成熟 | 扩展成本低，适合复用现有数据库资源；但规模扩大后性能调优和硬件成本会上升 | 中小规模 RAG、与业务数据强耦合的系统、Laravel / Django / Rails 等传统 Web 应用 |

### 2.2 Milvus：偏大规模场景的强力选手

Milvus 的特点是为大规模向量检索而生，适合千万级甚至更高规模的数据量。其 ANN 索引能力、分片、集群能力都比较成熟。

#### 适合场景

- 海量知识库
- 多租户大规模检索平台
- 对吞吐和扩展性要求高

#### 需要注意

- 部署组件相对较多
- 调优门槛高于轻量产品
- 对中小团队而言可能“杀鸡用牛刀”

Python 写入 Milvus 示例：

```python
from pymilvus import connections, FieldSchema, CollectionSchema, DataType, Collection

connections.connect(host="127.0.0.1", port="19530")

fields = [
    FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=False),
    FieldSchema(name="content", dtype=DataType.VARCHAR, max_length=4096),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1024),
]

schema = CollectionSchema(fields, description="RAG document chunks")
collection = Collection(name="rag_chunks", schema=schema)

collection.insert([
    [1],
    ["Laravel queue 配置说明"],
    [[0.12] * 1024],
])

collection.create_index(
    field_name="embedding",
    index_params={
        "index_type": "HNSW",
        "metric_type": "COSINE",
        "params": {"M": 32, "efConstruction": 200}
    }
)

collection.load()
```

深度分析：

- **HNSW** 适合低延迟高召回；
- `M` 越大，图越稠密，召回通常更高但内存开销更大；
- `efConstruction` 影响建索引质量；
- 查询时 `efSearch` 需要线上压测调优。

Milvus 的最大优势是“规模感”，但如果你的数据量只有几十万 chunk，运维复杂度往往不划算。

### 2.3 Qdrant：RAG 项目里的高性价比方案

Qdrant 这两年在 RAG 场景里非常常见，原因是：**足够强、足够轻、过滤体验好**。对于大多数企业知识库型应用，它经常是非常平衡的选择。

Qdrant 示例：

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

client = QdrantClient(url="http://localhost:6333")

client.recreate_collection(
    collection_name="rag_chunks",
    vectors_config=VectorParams(size=1024, distance=Distance.COSINE),
)

client.upsert(
    collection_name="rag_chunks",
    points=[
        PointStruct(
            id=1,
            vector=[0.12] * 1024,
            payload={
                "doc_id": "manual-001",
                "title": "Laravel Queue 文档",
                "section": "retry_after",
                "lang": "zh-CN"
            }
        )
    ]
)

hits = client.search(
    collection_name="rag_chunks",
    query_vector=[0.12] * 1024,
    limit=5,
    query_filter={
        "must": [
            {"key": "lang", "match": {"value": "zh-CN"}}
        ]
    }
)

for hit in hits:
    print(hit.payload, hit.score)
```

深度分析：

- Payload filter 很适合做语言过滤、租户隔离、文档类型过滤。
- 在企业场景中，metadata filter 几乎不是可选项，而是必须项。
- 如果你有“只检索当前租户的数据”“只检索公开文档”“只检索某知识空间”的需求，Qdrant 会非常顺手。

### 2.4 Weaviate：功能全面，但要评估复杂度

Weaviate 的特色在于对象化 schema、模块化能力和生态整合较强。如果团队想把“知识对象”而不是“单纯 chunk 文本”作为核心抽象，它很有吸引力。

示例：

```python
import weaviate

client = weaviate.connect_to_local()

client.collections.create(
    name="RagChunk",
    properties=[
        {"name": "doc_id", "data_type": "text"},
        {"name": "content", "data_type": "text"},
        {"name": "section", "data_type": "text"},
    ]
)

collection = client.collections.get("RagChunk")
collection.data.insert(
    properties={
        "doc_id": "manual-001",
        "content": "Laravel Horizon 可用于监控队列。",
        "section": "horizon"
    },
    vector=[0.12] * 1024
)
```

深度分析：

Weaviate 的问题不在于不能用，而在于很多团队最终只用了它 30% 的能力，却承担了 100% 的系统复杂度。所以如果你的目标只是做稳定的检索增强问答，先问自己：你真的需要那么丰富的对象建模吗？

### 2.5 pgvector：最务实的选择之一

如果你已经在用 PostgreSQL，且数据规模不算夸张，那么 pgvector 是一个非常务实的方案：

- 复用现有数据库基础设施；
- 权限、事务、备份、审计都沿用 PostgreSQL；
- 便于和业务数据 join；
- 开发成本低。

创建表示例：

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
    id BIGSERIAL PRIMARY KEY,
    doc_id VARCHAR(128) NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    metadata JSONB,
    embedding VECTOR(1024)
);

CREATE INDEX idx_document_chunks_embedding
ON document_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

查询示例：

```sql
SELECT id, doc_id, title, content,
       1 - (embedding <=> '[0.12,0.12,0.12]'::vector) AS score
FROM document_chunks
WHERE metadata->>'lang' = 'zh-CN'
ORDER BY embedding <=> '[0.12,0.12,0.12]'::vector
LIMIT 5;
```

Laravel 中使用 pgvector：

```php
use Illuminate\Support\Facades\DB;

$embedding = '[' . implode(',', $queryVector) . ']';

$rows = DB::select(
    "
    SELECT id, doc_id, title, content,
           1 - (embedding <=> ?::vector) AS score
    FROM document_chunks
    WHERE metadata->>'lang' = ?
    ORDER BY embedding <=> ?::vector
    LIMIT 10
    ",
    [$embedding, 'zh-CN', $embedding]
);
```

深度分析：

- pgvector 并不是“性能最强”，但它经常是“整体 ROI 最优”；
- 如果你业务本身 heavily depends on PostgreSQL，用 pgvector 可以减少系统分裂；
- 注意 `ivfflat` 需要在有一定数据量之后效果更稳定，参数 `lists` 需要压测；
- 当规模上升到千万级时，要评估分库、索引重建时间和查询延迟。

### 2.6 Chroma：PoC 阶段很好，生产慎重

Chroma 特别适合：

- 本地原型；
- Demo 演示；
- 开发阶段快速验证 Chunking/Embedding 效果。

示例：

```python
import chromadb

client = chromadb.PersistentClient(path="./chroma_db")
collection = client.get_or_create_collection(name="rag_chunks")

collection.add(
    ids=["1"],
    documents=["Laravel 的队列支持 Redis、database、SQS 等驱动。"],
    metadatas=[{"doc_id": "laravel-docs", "section": "queue"}],
    embeddings=[[0.12] * 1024]
)

results = collection.query(
    query_embeddings=[[0.12] * 1024],
    n_results=3
)
```

深度分析：

Chroma 的核心价值是快，但它不应该成为“我们没时间选型，所以先上生产”的借口。很多团队从 Chroma 起步没问题，但要在规模、并发、备份、可观测性、权限控制上提前预留迁移路径。

### 2.7 选型建议：不要只看性能榜单

我的经验是：

- **小团队 / 现有 PostgreSQL 能力强**：优先 pgvector
- **中大型 RAG 项目 / 重视过滤与易用性**：优先 Qdrant
- **超大规模 / 高吞吐向量平台**：优先 Milvus
- **希望统一对象建模与丰富能力**：考虑 Weaviate
- **本地实验 / PoC**：Chroma

一个常见误区是，只看 benchmark 排名。实际上，RAG 成败更多取决于：

- Chunking 是否合理；
- Metadata 是否设计清晰；
- 检索链路是否做混合召回；
- 重排序和 Prompt 是否跟上。

**向量库决定上限，但 Chunk 和检索策略决定你能不能接近上限。**

---

## 三、文档 Chunking 策略：固定长度、语义分块、递归分割

如果说向量数据库决定“你把东西存在哪里”，那 Chunking 决定“你到底存了什么”。在大量 RAG 故障案例里，Chunking 是最容易被低估、同时影响最大的环节。

### 3.1 为什么 Chunking 如此关键

Embedding 模型处理的是“文本片段”，不是整本书。你怎么切分文档，直接决定：

- 向量是否表达了完整语义；
- 查询是否能命中相关片段；
- 召回结果是否便于模型使用；
- Prompt 是否会浪费 token；
- 上下文引用是否准确。

常见失败模式包括：

1. **Chunk 太小**：召回到了片段，但缺少前后文，模型无法作答；
2. **Chunk 太大**：多个主题混在一起，向量语义被稀释；
3. **切断标题和正文**：召回结果失去结构信息；
4. **切断表格和说明**：事实片段破碎，答案失真；
5. **没有 overlap**：跨段信息丢失。

### 3.2 固定长度分块

固定长度是最简单的方案，按字符数、token 数或句子数切分，并设置一定 overlap。

示例：

```python
def fixed_size_chunk(text: str, chunk_size: int = 500, overlap: int = 100):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks

sample = "Laravel Horizon 用于监控队列，支持查看任务吞吐、失败任务、等待时间等指标。" * 20
for i, chunk in enumerate(fixed_size_chunk(sample, 60, 10), start=1):
    print(f"Chunk {i}: {chunk}")
```

优点：

- 实现简单；
- 可控性强；
- 容易批量处理大规模文档。

缺点：

- 完全不理解文档结构；
- 容易把一个完整概念切成两半；
- 对代码块、表格、章节标题很不友好。

适用场景：

- 结构较规整的纯文本；
- PoC 阶段快速验证；
- 数据量大、先跑通流程。

### 3.3 语义分块

语义分块会尽量在句子、段落、主题边界处分割，而不是机械按长度切开。做法一般包括：

- 先按句子或段落初步切分；
- 计算相邻片段的语义相似度；
- 当语义变化明显时断开；
- 控制最大长度，避免 chunk 过大。

示例：

```python
from typing import List

def semantic_chunk(paragraphs: List[str], similarity_scores: List[float], threshold: float = 0.75):
    chunks = []
    current = [paragraphs[0]]

    for i in range(1, len(paragraphs)):
        if similarity_scores[i - 1] >= threshold:
            current.append(paragraphs[i])
        else:
            chunks.append("\n".join(current))
            current = [paragraphs[i]]

    if current:
        chunks.append("\n".join(current))

    return chunks
```

深度分析：

语义分块的优势是更符合“人阅读时的知识边界”，特别适合：

- 技术文档
- 产品手册
- FAQ
- 多段解释型文档

但它也有代价：

- 预处理更复杂；
- 对中文分句质量依赖高；
- 阈值需要调优；
- 不同文档类型很难一套规则通吃。

### 3.4 递归分割：工程上最实用的折中

递归分割（Recursive Chunking）是很多项目里最好用的方案之一。核心思想是：**优先保留高层结构，如果太长，再逐步向下细分**。

例如可以按以下优先级切分：

1. 标题
2. 段落
3. 句子
4. 标点
5. 固定长度

示例：

```python
SEPARATORS = ["\n# ", "\n## ", "\n\n", "。", "；", "，", " "]

def recursive_split(text: str, max_len: int = 500, seps=None):
    if seps is None:
        seps = SEPARATORS

    if len(text) <= max_len or not seps:
        return [text]

    sep = seps[0]
    parts = text.split(sep)

    if len(parts) == 1:
        return recursive_split(text, max_len, seps[1:])

    chunks = []
    current = ""
    for part in parts:
        candidate = part if not current else current + sep + part
        if len(candidate) <= max_len:
            current = candidate
        else:
            if current:
                chunks.extend(recursive_split(current, max_len, seps[1:]))
            current = part
    if current:
        chunks.extend(recursive_split(current, max_len, seps[1:]))

    return chunks
```

深度分析：

递归分割的优势在于：

- 不会一开始就暴力截断；
- 能最大程度保留标题与段落结构；
- 对 Markdown、技术文档、知识库文章特别友好；
- 很容易加入 overlap 和 metadata。

下面给一个更接近生产环境的 Chunking 实现示例：先按 Markdown 标题切大块，再按字符长度递归切小块，同时保留父级标题、chunk 序号和 overlap，便于后续写入向量数据库与做检索过滤。

```python
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Iterable


@dataclass
class Chunk:
    text: str
    metadata: dict


HEADER_RE = re.compile(r'^(#{1,6})\s+(.*)$', re.MULTILINE)


def split_markdown_sections(markdown: str) -> list[tuple[list[str], str]]:
    matches = list(HEADER_RE.finditer(markdown))
    if not matches:
        return [([], markdown.strip())]

    sections: list[tuple[list[str], str]] = []
    title_stack: list[str] = []

    for index, match in enumerate(matches):
        level = len(match.group(1))
        title = match.group(2).strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        body = markdown[start:end].strip()

        title_stack = title_stack[: level - 1]
        title_stack.append(title)

        if body:
            sections.append((title_stack.copy(), body))

    return sections


def sliding_window(text: str, chunk_size: int = 500, overlap: int = 80) -> Iterable[str]:
    start = 0
    text = text.strip()
    while start < len(text):
        end = min(start + chunk_size, len(text))
        yield text[start:end].strip()
        if end == len(text):
            break
        start = max(end - overlap, start + 1)


def build_chunks(doc_id: str, markdown: str, chunk_size: int = 500, overlap: int = 80) -> list[Chunk]:
    chunks: list[Chunk] = []

    for section_index, (section_path, body) in enumerate(split_markdown_sections(markdown), start=1):
        for chunk_index, chunk_text in enumerate(sliding_window(body, chunk_size, overlap), start=1):
            chunks.append(
                Chunk(
                    text=chunk_text,
                    metadata={
                        "doc_id": doc_id,
                        "section_path": " > ".join(section_path),
                        "section_index": section_index,
                        "chunk_index": chunk_index,
                        "char_length": len(chunk_text),
                    },
                )
            )

    return chunks


sample_markdown = """
# Laravel Queue

Laravel Queue 支持 Redis、Database、SQS 等驱动。

## retry_after

retry_after 用于控制任务超时后的重试窗口，建议与 worker timeout 一起配置。

## Horizon

Horizon 可用于监控吞吐、失败任务和等待时间。
"""

for chunk in build_chunks(doc_id="laravel-queue-doc", markdown=sample_markdown, chunk_size=48, overlap=12):
    print(chunk.metadata, chunk.text)
```

这个实现的关键点在于：

- 先保留章节结构，再做窗口切分，避免标题与正文彻底脱节；
- `section_path` 可直接用于检索结果展示和来源引用；
- `overlap` 控制在 10%~20% 往往就够，不要盲目堆大；
- 入库前可以把 `char_length`、`section_index`、`chunk_index` 一并写入 metadata，后续更容易做去重、重排序和调试。

### 3.5 Markdown/HTML/PDF 不同文档的切分策略

真正线上系统不会只处理纯文本，往往还包括 Markdown、HTML、PDF、Word 导出文本、爬虫页面等。最关键的经验是：**先结构化，再切分**。

例如 Markdown：

```python
import re

def parse_markdown_sections(md: str):
    pattern = r'^(#{1,6})\s+(.*)$'
    sections = []
    current_title = ""
    current_lines = []

    for line in md.splitlines():
        if re.match(pattern, line):
            if current_lines:
                sections.append({
                    "title": current_title,
                    "content": "\n".join(current_lines).strip()
                })
            current_title = line.strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines:
        sections.append({
            "title": current_title,
            "content": "\n".join(current_lines).strip()
        })

    return sections
```

如果你直接把整个 Markdown 剥掉标签后按 500 字切，会损失大量层级信息。更好的做法是给每个 chunk 保留 metadata：

- 文档 ID
- 一级标题
- 二级标题
- 段落序号
- 原始链接
- 更新时间

### 3.6 Chunk 大小如何选

没有万能答案，但可以给一个实战范围：

- **短 FAQ / 问答对**：100-300 tokens
- **技术文档段落**：300-700 tokens
- **说明书 / 合同 / 制度**：500-1000 tokens
- **代码与解释混合内容**：尽量按逻辑块切，避免只按 token 数切。

一个经验法则：

> Chunk 要足够小，小到检索精准；又要足够大，大到能独立支撑回答。

### 3.7 Overlap 要不要加

通常建议加，但不要迷信大 overlap。常见范围：10%~20%。

比如：

- chunk_size = 500 tokens
- overlap = 50~100 tokens

Overlap 的作用：

- 缓解跨段边界信息断裂；
- 提升相邻语义连续内容的召回概率。

但 overlap 过大也会造成：

- 冗余存储；
- 召回结果重复；
- Prompt 浪费 token；
- 重排序成本上升。

### 3.8 Chunking 最佳实践

```php
<?php

final class ChunkMetadataBuilder
{
    public function build(array $doc, string $chunkText, int $index): array
    {
        return [
            'doc_id' => $doc['id'],
            'title' => $doc['title'],
            'chunk_index' => $index,
            'section_path' => implode(' > ', $doc['section_path'] ?? []),
            'lang' => $doc['lang'] ?? 'zh-CN',
            'updated_at' => $doc['updated_at'] ?? null,
            'token_count' => mb_strlen($chunkText),
        ];
    }
}
```

建议：

1. 标题与正文尽量一起进入 chunk；
2. 表格要特殊处理，不要简单摊平成碎片；
3. 代码块不要被切断；
4. chunk 中保留层级 metadata；
5. 先做小规模人工抽检，再全量入库；
6. 每次切分策略变更都要重做评估。

---

## 四、Embedding 模型选型

Embedding 决定“文本如何映射到向量空间”。如果说 Chunking 决定输入颗粒度，那 Embedding 模型决定语义表达质量。

### 4.1 选型维度

主要关注以下几点：

1. **中文效果**：很多英文强模型在中文上未必好；
2. **向量维度**：影响存储与检索速度；
3. **查询-文档是否对称**：有些模型区分 query embedding 和 document embedding；
4. **延迟与成本**：在线服务的吞吐和价格；
5. **许可证与部署方式**：是否可私有化；
6. **跨语言能力**：是否需要中英混合检索。

### 4.2 常见选择

#### 1）OpenAI / 商业 API Embedding

优点：
- 通常效果稳定；
- 维护成本低；
- 接入方便。

缺点：
- 成本随规模增长；
- 私有数据可能有合规要求；
- 向量维度和调用方式受平台限制。

示例：

```python
from openai import OpenAI

client = OpenAI()
resp = client.embeddings.create(
    model="text-embedding-3-large",
    input="Laravel Horizon 如何监控队列积压？"
)

vector = resp.data[0].embedding
print(len(vector))
```

#### 2）BGE / BCE / GTE / e5 等开源模型

开源 Embedding 在中文场景非常常见，优势是可私有化、成本可控、可批量离线处理。

示例（Sentence Transformers）：

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("BAAI/bge-m3")
texts = [
    "Laravel Queue 支持哪些驱动？",
    "Redis、database、SQS 都可以作为队列驱动。"
]
embeddings = model.encode(texts, normalize_embeddings=True)
print(embeddings.shape)
```

深度分析：

- `bge-m3` 在多语言、多粒度、检索任务上很有竞争力；
- 有些模型需要特定 instruction，例如 query 需要前缀；
- 如果忘了按官方推荐方式构造输入，效果会明显下降。

### 4.3 Query/Document 指令模板不能乱用

部分 Embedding 模型对 query 和 document 有不同模板，例如：

```python
def build_query_text(q: str) -> str:
    return f"为这个检索问题生成表示以用于检索相关文章：{q}"

query_vector = model.encode(build_query_text("Laravel 队列失败后如何重试？"))
doc_vector = model.encode("你可以通过 retry_after 与 failed_jobs 配置进行失败重试管理。")
```

如果模型推荐 query 加 instruction，而你在文档侧也加一样的 instruction，或者两边都不加，结果可能不如预期。

### 4.4 维度越高越好吗

不一定。更高维度意味着：

- 存储更大；
- 网络传输更重；
- 检索可能更慢；
- ANN 索引资源消耗更高。

高维模型并不自动代表更高业务效果。工程上应以 **离线评测 + 线上指标** 为准。

### 4.5 Embedding 选型建议

- **想省心快速上线**：选成熟商业 API；
- **中文知识库、私有化部署**：优先测试 BGE / BCE / GTE / e5 系列；
- **混合语言、多文档类型**：选多语言模型并单独评估中文效果；
- **高 QPS 在线系统**：关注 batch、量化、GPU 吞吐。

Laravel 调用 Embedding 服务示例：

```php
<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Http;

final class EmbeddingService
{
    public function embed(string $text): array
    {
        $response = Http::timeout(30)
            ->post(config('services.embedding.url') . '/embed', [
                'text' => $text,
                'model' => 'bge-m3',
            ])
            ->throw()
            ->json();

        return $response['embedding'];
    }
}
```

---

## 五、检索优化：混合检索、重排序、查询改写

很多团队上线后会发现：向量检索“平均看起来还行”，但一遇到专有名词、版本号、报错码、配置项名、函数名，效果就明显下滑。原因是向量检索擅长语义相似，不擅长所有精确匹配。解决这个问题的关键就是：**混合检索 + 重排序 + 查询改写**。

### 5.1 混合检索（Hybrid Search）

混合检索通常是：

- 向量检索负责语义召回；
- BM25 / 关键词检索负责精确召回；
- 最后做融合排序。

简单融合示例：

```python
def reciprocal_rank_fusion(result_lists, k=60):
    scores = {}
    for result_list in result_lists:
        for rank, doc_id in enumerate(result_list, start=1):
            scores[doc_id] = scores.get(doc_id, 0) + 1 / (k + rank)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)

vector_result = [101, 102, 103, 104]
bm25_result = [103, 201, 101, 301]
print(reciprocal_rank_fusion([vector_result, bm25_result]))
```

深度分析：

RRF（Reciprocal Rank Fusion）最大的优点是稳健，不依赖不同检索器得分分布的一致性。因为向量分数和 BM25 分数通常不可直接比较，RRF 用排名位置来融合，工程上非常实用。

### 5.2 为什么一定要保留 BM25

在中文技术知识库中，下列内容特别依赖关键词检索：

- 类名、函数名
- 错误码
- 参数名
- 配置项
- 表名、字段名
- 版本号
- 缩写词

例如用户问：

> Laravel queue 的 `retry_after` 与 `timeout` 有什么区别？

如果只用向量检索，可能召回“失败重试机制”“队列超时配置”等泛相关文本；而 BM25 往往能直接命中包含 `retry_after` 的片段。

### 5.3 重排序（Reranking）

初始召回的 Top20/Top50 往往包含很多“相关但不够回答问题”的片段。此时需要重排序模型做更精细的 query-doc 匹配。

Cross-encoder 示例：

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-base")
query = "Laravel 队列失败后如何重试？"
docs = [
    "Laravel Horizon 用于监控队列。",
    "你可以使用 failed_jobs 表记录失败任务，并配置 retry_after 实现重试。",
    "Laravel Scheduler 用于定时任务调度。"
]

pairs = [[query, doc] for doc in docs]
scores = reranker.predict(pairs)
ranked = sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)
print(ranked)
```

深度分析：

- 双塔 Embedding 擅长大规模召回；
- Cross-encoder 擅长精排；
- 工程上常见组合是：**召回 Top50 -> Rerank -> 取 Top5~Top10**。

代价是：

- Reranker 延迟更高；
- 成本比纯 ANN 高；
- 需要控制候选数，避免在线过慢。

### 5.4 查询改写（Query Rewrite）

用户提问常常不适合直接检索，比如：

- 口语化表达过强；
- 省略上下文；
- 问题过长，混杂多个子问题；
- 使用内部别称而不是正式术语。

因此可以在检索前做 Query Rewrite：

- 标准化术语；
- 提取关键词；
- 生成多个子查询；
- 对话场景下做指代消解。

示例：

```php
<?php

final class QueryRewriteService
{
    public function rewrite(string $question): array
    {
        return [
            $question,
            'Laravel 队列 retry_after timeout 区别',
            'Laravel queue retry_after vs timeout',
        ];
    }
}
```

更进一步，可以借助 LLM 做查询扩展：

```python
prompt = """
请将用户问题改写为 3 个适合知识库检索的短查询。
要求：保留专业术语、补全隐含主语、不要引入无关概念。
用户问题：Laravel 队列挂了之后任务怎么重新跑？
"""
```

### 5.5 多路召回与过滤策略

一个比较成熟的检索链路通常包括：

1. Query Rewrite：生成多个检索表达；
2. Vector Search：语义召回；
3. BM25 Search：关键词召回；
4. Metadata Filter：按租户、权限、语言、文档状态过滤；
5. Fusion：RRF 或自定义融合；
6. Rerank：Cross-encoder 精排；
7. Diversity 去重：避免多个 chunk 来自同一小段内容；
8. Context Packing：组装最终上下文。

示例：

```php
<?php

final class HybridRetriever
{
    public function search(string $question): array
    {
        $queries = $this->queryRewriteService->rewrite($question);
        $all = [];

        foreach ($queries as $query) {
            $all[] = $this->vectorStore->search($query, 15);
            $all[] = $this->keywordStore->search($query, 15);
        }

        $fused = $this->rrf->merge($all);
        $filtered = $this->permissionFilter->apply($fused);
        $reranked = $this->reranker->rank($question, $filtered);

        return $this->diversitySelector->topK($reranked, 6);
    }
}
```

### 5.6 Prompt 组装也属于检索优化的一部分

很多人把检索和生成完全分开，但实际上 Prompt 组装方式会反向影响“检索效果是否真正发挥出来”。

建议：

- 文档按相关性排序；
- 保留来源信息；
- 明确要求“只能基于提供资料回答”；
- 如果证据不足，要求模型明确说不知道。

示例：

```text
你是企业知识库助手。请仅基于以下资料回答问题。
如果资料不足以支持结论，请明确说明“根据当前检索到的资料，无法确认”。

[资料1]
标题：Laravel Queue 文档
内容：...
来源：...

[资料2]
标题：Laravel Horizon 文档
内容：...
来源：...

用户问题：...
```

---

## 六、Laravel 集成方案

很多国内团队的主业务系统仍然是 Laravel，因此把 RAG 集成进 Laravel 是一个非常现实的话题。核心原则是：**Laravel 负责业务编排，Embedding / Rerank / LLM 推理尽量服务化**。

### 6.1 建议架构

```text
Laravel App
├── 文档上传/API
├── 队列任务（入库、切分、向量化）
├── 检索编排服务
├── 会话与权限控制
└── 调用外部 AI 服务
     ├── Embedding Service
     ├── Vector DB
     ├── Reranker Service
     └── LLM Gateway
```

这样做的好处是：

- PHP 不承担重模型推理；
- 可以独立扩容 Python 推理服务；
- Laravel 侧更专注业务逻辑、权限、审计、缓存。

### 6.2 文档入库流程

Laravel Job 示例：

```php
<?php

namespace App\Jobs;

use App\Services\Rag\ChunkService;
use App\Services\AI\EmbeddingService;
use App\Services\Rag\VectorStoreService;
use Illuminate\Contracts\Queue\ShouldQueue;

final class IndexDocumentJob implements ShouldQueue
{
    public function __construct(
        public int $documentId
    ) {}

    public function handle(
        ChunkService $chunkService,
        EmbeddingService $embeddingService,
        VectorStoreService $vectorStoreService,
    ): void {
        $document = \App\Models\Document::findOrFail($this->documentId);
        $chunks = $chunkService->split($document->content, [
            'title' => $document->title,
            'doc_id' => $document->id,
        ]);

        foreach ($chunks as $chunk) {
            $embedding = $embeddingService->embed($chunk['content']);
            $vectorStoreService->upsert([
                'id' => $chunk['id'],
                'vector' => $embedding,
                'payload' => $chunk['metadata'],
                'content' => $chunk['content'],
            ]);
        }
    }
}
```

深度分析：

- 向量化一定要异步，不要阻塞上传请求；
- 批量嵌入比单条嵌入更高效；
- 文档更新时要有版本策略，避免旧 chunk 残留；
- 大文档建议分批任务，避免单 Job 过大超时。

### 6.3 检索 API

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Rag\AnswerService;
use Illuminate\Http\Request;

final class RagAskController extends Controller
{
    public function __invoke(Request $request, AnswerService $service)
    {
        $data = $request->validate([
            'question' => ['required', 'string', 'max:2000'],
        ]);

        $result = $service->answer(
            question: $data['question'],
            user: $request->user(),
        );

        return response()->json($result);
    }
}
```

对应 Service：

```php
<?php

final class AnswerService
{
    public function answer(string $question, $user): array
    {
        $docs = $this->retriever->searchForUser($question, $user);
        $prompt = $this->promptBuilder->build($question, $docs);
        $answer = $this->llm->chat($prompt);

        return [
            'answer' => $answer,
            'references' => array_map(fn($d) => [
                'doc_id' => $d['doc_id'],
                'title' => $d['title'],
                'score' => $d['score'] ?? null,
            ], $docs),
        ];
    }
}
```

### 6.4 权限隔离

企业场景里，权限不是附加项，而是 RAG 成败线。最危险的事故之一就是：**检索召回了用户无权查看的 chunk**。

建议在 metadata 中保存：

- tenant_id
- visibility
- department_id
- document_status
- acl_tags

然后在检索阶段就过滤，而不是生成后再过滤。

### 6.5 Laravel + pgvector 的落地优势

如果你的 Laravel 项目原本就依赖 PostgreSQL，那么：

- chunk 元数据和业务表可共库；
- 文档更新事务更容易保证；
- 权限 join 更自然；
- 运维团队无需额外学一套存储。

但当数据量增长后，可以演进为：

```text
PostgreSQL：文档主数据、权限、审计
Qdrant/Milvus：向量检索
Redis：缓存热点问答与检索结果
S3/OSS：原始文件存储
```

### 6.6 Laravel 中的缓存与降级

线上必须考虑稳定性：

- 热门问题缓存回答；
- Embedding 服务超时时降级为关键词检索；
- Reranker 不可用时走召回结果直出；
- LLM 超时要支持流式取消和友好提示。

示例：

```php
<?php

use Illuminate\Support\Facades\Cache;

$key = 'rag_answer:' . md5($question . ':' . $user->tenant_id);

$result = Cache::remember($key, now()->addMinutes(10), function () use ($question, $user) {
    return $this->answerService->answer($question, $user);
});
```

---

## 七、评估指标：Recall、Precision、MRR 及如何建立评测集

做 RAG 最怕的不是指标差，而是“根本没测”。很多团队用几条主观提问感觉“还行”就上线，结果线上问题一堆。RAG 必须建立系统评估。

### 7.1 评估什么

至少要分三层评估：

1. **检索评估**：能否把正确文档召回来；
2. **生成评估**：模型是否基于证据正确回答；
3. **系统评估**：延迟、成本、稳定性、权限正确性。

本文先聚焦检索指标。

### 7.2 Recall@K

Recall@K 关注：在前 K 个结果里，是否包含相关文档。

公式：

```text
Recall@K = 命中的相关文档数 / 全部相关文档数
```

在 RAG 里，Recall 往往比 Precision 更重要，因为如果正确证据根本没召回来，后面的生成和重排序都无从谈起。

示例代码：

```python
def recall_at_k(relevant_ids, retrieved_ids, k):
    top_k = retrieved_ids[:k]
    hit = len(set(relevant_ids) & set(top_k))
    return hit / len(set(relevant_ids)) if relevant_ids else 0.0

print(recall_at_k([2, 5], [9, 2, 8, 5], 3))
```

### 7.3 Precision@K

Precision@K 关注前 K 个结果里有多少是相关的。

```text
Precision@K = 前K结果中的相关文档数 / K
```

示例：

```python
def precision_at_k(relevant_ids, retrieved_ids, k):
    top_k = retrieved_ids[:k]
    hit = len(set(relevant_ids) & set(top_k))
    return hit / k if k else 0.0
```

深度分析：

- Recall 高说明“尽量别漏”；
- Precision 高说明“别召回太多噪声”；
- 如果系统有 Reranker，初始召回阶段通常更优先追求 Recall。

### 7.4 MRR（Mean Reciprocal Rank）

MRR 衡量第一个正确结果排得有多靠前。

```python
def reciprocal_rank(relevant_ids, retrieved_ids):
    for i, doc_id in enumerate(retrieved_ids, start=1):
        if doc_id in relevant_ids:
            return 1 / i
    return 0.0


def mean_reciprocal_rank(samples):
    scores = [reciprocal_rank(rel, ret) for rel, ret in samples]
    return sum(scores) / len(scores) if scores else 0.0
```

MRR 特别适合问答系统，因为如果第一条、第二条证据就很准，后续 Prompt 利用效率会更高。

### 7.5 如何构建评测集

建议至少准备 100~300 条带标注样本，覆盖：

- FAQ 类问题
- 长尾问题
- 缩写、术语、版本号
- 多跳问题
- 权限隔离问题
- 模糊表述问题

一个标注样本结构可以是：

```json
{
  "question": "Laravel queue 的 retry_after 和 timeout 有什么区别？",
  "relevant_doc_ids": ["doc-102#chunk-3", "doc-102#chunk-4"],
  "expected_keywords": ["retry_after", "timeout", "worker"],
  "difficulty": "medium",
  "category": "config"
}
```

### 7.6 建立自动化评测脚本

```python
import json


def evaluate(dataset, retriever, k=5):
    recall_scores = []
    precision_scores = []
    rr_scores = []

    for sample in dataset:
        result_ids = retriever(sample["question"])
        relevant = sample["relevant_doc_ids"]

        recall_scores.append(recall_at_k(relevant, result_ids, k))
        precision_scores.append(precision_at_k(relevant, result_ids, k))
        rr_scores.append(reciprocal_rank(relevant, result_ids))

    return {
        "recall@k": sum(recall_scores) / len(recall_scores),
        "precision@k": sum(precision_scores) / len(precision_scores),
        "mrr": sum(rr_scores) / len(rr_scores),
    }
```

### 7.7 线上评估要看什么

除了离线指标，线上要持续监控：

- 无答案率
- 用户追问率
- 引用点击率
- 人工纠错率
- 平均召回文档数
- 平均上下文 token
- 检索耗时、重排序耗时、生成耗时

**离线高分不等于线上好用**。很多时候，线上失败是因为：

- 用户问题更口语化；
- 文档更新后未重建索引；
- 权限过滤导致可召回范围缩小；
- Prompt 与评测假设不一致。

---

## 八、生产部署与监控

真正把 RAG 做到生产环境，重点就不再只是“效果”，而是“效果、稳定性、成本、可观测性”的平衡。

### 8.1 服务拆分建议

建议至少拆为：

1. **文档处理服务**：解析、清洗、切分、入库；
2. **Embedding 服务**：批量向量化；
3. **检索服务**：向量 + 关键词 + Rerank；
4. **LLM Gateway**：统一模型路由、限流、审计；
5. **应用层**：Laravel Web/API；
6. **监控系统**：日志、指标、告警。

### 8.2 异步化和批处理

典型异步任务：

- 文档解析
- OCR
- Chunk 重建
- 向量重算
- 索引重建
- 离线评测

Laravel 队列配置示例：

```php
<?php

return [
    'default' => env('QUEUE_CONNECTION', 'redis'),

    'connections' => [
        'redis' => [
            'driver' => 'redis',
            'connection' => 'default',
            'queue' => env('REDIS_QUEUE', 'default'),
            'retry_after' => 120,
            'block_for' => null,
        ],
    ],
];
```

深度分析：

- Embedding/索引任务通常是 CPU/GPU 密集型，最好与 Web 请求解耦；
- `retry_after` 要根据实际任务时长配置，不然可能重复执行；
- 对大文档重试要保证幂等，否则会造成重复 chunk。

### 8.3 监控指标

建议至少上报以下指标：

#### 检索层指标
- 向量检索 P50/P95/P99 延迟
- Reranker 延迟
- Query Rewrite 延迟
- TopK 命中率
- Metadata filter 命中比例

#### 生成层指标
- LLM 首 token 延迟
- 完整响应时长
- 平均输入/输出 token
- 拒答率
- 引用缺失率

#### 数据层指标
- 文档解析失败率
- Chunk 平均长度
- 向量生成失败率
- 索引构建耗时
- 文档版本覆盖率

Prometheus 风格示例：

```python
from prometheus_client import Histogram, Counter

retrieval_latency = Histogram('rag_retrieval_latency_seconds', 'RAG retrieval latency')
retrieval_errors = Counter('rag_retrieval_errors_total', 'RAG retrieval errors')

@retrieval_latency.time()
def retrieve(query):
    try:
        return do_retrieve(query)
    except Exception:
        retrieval_errors.inc()
        raise
```

### 8.4 日志与 Trace

如果你的链路包括 Query Rewrite、Vector Search、BM25、Rerank、LLM，那么一次问答的真实耗时瓶颈往往很难只靠单点日志定位。建议为每次请求打一个 trace_id，并记录：

- 原始问题
- 改写结果
- 召回候选数
- 最终 TopK 文档 ID
- Rerank 分数
- Prompt token 数
- 响应耗时
- 是否命中缓存

Laravel 中间件示例：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Str;

final class AttachTraceId
{
    public function handle($request, Closure $next)
    {
        $traceId = (string) Str::uuid();
        app()->instance('trace_id', $traceId);

        $response = $next($request);
        $response->headers->set('X-Trace-Id', $traceId);

        return $response;
    }
}
```

### 8.5 成本控制

RAG 系统成本主要来自：

- Embedding 调用；
- 向量存储与索引；
- Reranker 推理；
- LLM 生成 token；
- 文档更新导致的重复计算。

控制建议：

1. 文档去重后再向量化；
2. 只对变更 chunk 重算 embedding；
3. 热门问答做缓存；
4. 对低价值查询关闭 rewrite/rerank；
5. 离线批量向量化优先于在线同步；
6. 压缩 metadata，避免 payload 过重。

### 8.6 灰度与回滚

当你调整以下任何一项时，都要支持灰度：

- Chunking 策略
- Embedding 模型
- 向量索引参数
- 混合检索权重
- Reranker 模型
- Prompt 模板

一个常见做法是双写双读：

```text
旧索引：rag_chunks_v1
新索引：rag_chunks_v2
灰度用户：10% 命中新链路
评估通过后再切流
```

---

## 九、真实踩坑记录：这些问题几乎每个团队都会遇到

最后这一节，我不讲“最佳实践口号”，只讲真实项目里反复遇到的问题。

### 9.1 坑一：Chunk 切得太碎，召回率看似不错，答案却经常不完整

早期我们为了追求检索精度，把 chunk 切到 150~200 tokens，结果离线 Recall@10 看上去不差，但线上回答经常缺步骤、缺条件、缺限制说明。

根因：

- 单个 chunk 只包含局部描述；
- 模型没有拿到完整上下文；
- 多个相邻 chunk 虽然都相关，但最终只入选了其中一两个。

解决办法：

- 技术文档改为按标题+段落递归切分；
- chunk size 提升到 400~700 tokens；
- 对同 section 的相邻 chunk 做结果合并。

### 9.2 坑二：只做向量检索，配置项和报错码几乎搜不准

我们曾经用纯向量检索做内部开发文档问答，发现像 `retry_after`、`SIGTERM`、`SQLSTATE[23000]` 这种问题效果很差。

根因：

- 这类 token 更像“精确符号”，不完全是自然语义；
- Embedding 可以理解“重试机制”，但未必稳稳命中具体配置名。

解决办法：

- 引入 BM25；
- 对代码块和配置项单独打标签；
- Query Rewrite 时提取反引号内容做关键词检索增强。

### 9.3 坑三：文档更新了，但旧索引没删干净，答案前后矛盾

这是生产环境非常常见的问题。某条制度从 V1 改成 V2，结果索引里两版 chunk 都在，用户提问时两边都召回，模型就会输出冲突信息。

解决办法：

- 每份文档维护 version；
- upsert 前先逻辑删除旧 version；
- 检索时只搜最新生效版本；
- 定期做孤儿 chunk 清理。

示例：

```php
<?php

DB::transaction(function () use ($document, $newChunks) {
    DB::table('document_chunks')
        ->where('doc_id', $document->id)
        ->update(['is_active' => false]);

    foreach ($newChunks as $chunk) {
        DB::table('document_chunks')->insert([
            'doc_id' => $document->id,
            'version' => $document->version,
            'content' => $chunk['content'],
            'metadata' => json_encode($chunk['metadata']),
            'is_active' => true,
        ]);
    }
});
```

### 9.4 坑四：评测集太“官方”，线上问题太“口语”

离线评测时，很多问题写得非常标准：

- “Laravel Queue 的 retry_after 有什么作用？”

而线上用户常问：

- “队列任务卡住以后多久才算挂了？”
- “worker 不动了是不是超时了？”

解决办法：

- 评测集加入真实工单、客服问法、聊天式表达；
- 引入 Query Rewrite；
- 构建别名词典，如“挂了/卡死/不动了/超时”。

### 9.5 坑五：Prompt 里塞了太多 chunk，模型反而忽略重点

不少人以为“多给点上下文总没错”。实际情况是：

- 上下文太长，噪声上升；
- 模型注意力分散；
- 关键证据被淹没。

我们的经验是：

- 不要盲目从 Top20 全塞进去；
- 通常 4~8 个高质量 chunk 比 20 个一般相关 chunk 更有效；
- 重排序与去重非常重要。

### 9.6 坑六：权限过滤放在生成后，导致严重数据泄漏风险

这个坑非常危险。曾有团队先全量检索，再在展示层过滤引用，结果模型早已基于敏感 chunk 生成了回答。

正确做法：

- 必须在检索阶段做权限过滤；
- 最好在向量库 filter 层就限制；
- 对 prompt 入参做最终审计。

### 9.7 坑七：只看平均延迟，不看 P95/P99

RAG 链路很长，平均值经常掩盖问题。比如平均 1.2 秒看似不错，但 P99 达到 8 秒，用户就会明显感知卡顿。

建议：

- 对 Embedding、Retrieval、Rerank、LLM 分段统计；
- 单独看大上下文请求；
- 对超时链路做降级策略。

### 9.8 坑八：把 RAG 当成万能锤子

最后一个坑是认知问题。并不是所有问题都应该走 RAG。比如：

- 查库存、查订单、查余额：应走 API；
- 固定结构报表汇总：应走 SQL + 模板生成；
- 纯规则决策：应走规则引擎。

最成熟的系统往往不是“所有请求都丢给 RAG”，而是：

```text
意图识别 -> 工具路由
         ├── 结构化查询 -> API/数据库
         ├── 知识问答 -> RAG
         └── 开放生成 -> LLM
```

---

## 十、一个可执行的落地路线图

如果你准备真正做一个 RAG 系统，我建议按下面路线推进：

### 第 1 阶段：PoC 验证
- 选 50~100 篇核心文档；
- 用递归分割 + 开源 Embedding 跑一个最小系统；
- 使用 Chroma / pgvector / Qdrant 任一方案快速验证；
- 人工抽查 50 个问题效果。

### 第 2 阶段：初版上线
- 引入 metadata filter；
- 建立 Recall/MRR 评测集；
- 增加 BM25 混合检索；
- 输出引用来源；
- 接入 Laravel API 和权限控制。

### 第 3 阶段：效果优化
- 上 Reranker；
- 做 Query Rewrite；
- 区分 FAQ / 技术文档 / 制度文档不同 chunk 策略；
- 建立线上反馈闭环。

### 第 4 阶段：生产化
- 灰度发布索引与模型；
- 做全链路 Trace 与告警；
- 优化成本与缓存；
- 建立版本治理、重建索引和回滚机制。

---

## 结语

RAG 从来不是“接一个向量库就完成”的项目。它本质上是一个跨数据工程、检索工程、模型工程和应用工程的系统化问题。真正决定效果的，不是某一个神奇组件，而是整条链路是否被认真设计：

- 文档有没有被正确清洗和结构化；
- Chunk 是否既保留语义又利于召回；
- Embedding 是否适合你的语言和领域；
- 检索是否做了混合召回、重排序、查询改写；
- Laravel 等业务系统是否把权限、缓存、异步化、审计接稳；
- 评估与监控是否形成闭环。

如果要我用一句话总结 RAG 落地的核心经验，那就是：

> **不要迷信单点能力，RAG 的成败取决于系统工程；而系统工程里，最值得打磨的三件事，就是向量数据库选型、Chunking 策略，以及检索优化。**

当你把这三件事真正做深，RAG 才会从“能演示”走向“能生产”。

## 相关阅读

- [AI Agent + Laravel 实战](/categories/AI%20Agent/AI-Agent-Laravel-LLM-Integration/)：了解如何把 LLM、业务系统与工程化接口整合到真实项目中。
- [AI Agent + CI/CD 实战](/categories/AI%20Agent/AI-Agent-CICD-Code-Review/)：延伸理解 AI 在研发流程、自动审查与交付链路中的落地方式。
- [AI Agent 记忆系统](/categories/AI/ai-agent-memory-system-design/)：如果你在做长期上下文与知识记忆，可结合 RAG 一起设计完整记忆架构。
- [AI 成本优化](/categories/AI/2026-06-02-ai-application-cost-optimization-token-caching-model-degradation/)：补齐向量检索、Token 消耗、缓存与模型降级策略背后的成本控制方法。
