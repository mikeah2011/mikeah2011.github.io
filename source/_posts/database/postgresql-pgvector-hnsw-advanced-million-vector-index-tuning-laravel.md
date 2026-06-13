---

title: PostgreSQL pgvector + HNSW 实战进阶：百万级向量检索的索引调优——距离函数、ef_search 参数与 Laravel Scout
keywords: [PostgreSQL pgvector, HNSW, ef, search, Laravel Scout, 实战进阶, 百万级向量检索的索引调优, 距离函数, 参数与, 数据库]
date: 2026-06-09 15:35:01
categories:
  - database
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
- PostgreSQL
- pgvector
- HNSW
- 向量检索
- Scout
- 索引调优
description: 基于 Laravel + PostgreSQL pgvector 的实战进阶，围绕百万级 Embedding 检索场景，深度拆解 HNSW 索引调优、距离函数选择、ef_search 参数作用，以及如何通过自定义 Laravel Scout Engine 落地生产可用的语义检索能力。
---



在 LLM 与 Embedding 越来越普及的今天，很多 Laravel 项目都会面对同一个问题：**如何在不引入 Elasticsearch / Milvus / Pinecone 的前提下，先用现有关系型数据库把向量检索做起来**。对中小规模数据量、团队已有 PostgreSQL 经验的团队来说，`pgvector` 往往是最现实、成本最低、运维最简单的第一步。

但现实里最容易踩坑的不是“能不能装上 pgvector”，而是：

- 同样是百万级 Embedding，为什么有时很快，有时很慢？
- `L2` / `Cosine` / `Inner Product` 该选哪个？
- `hnsw` 和 `ivfflat` 在真实数据分布下差多少？
- Laravel Scout 如何接入 pgvector？默认驱动支持吗？不支持时怎么自己实现？
- 生产上线前要做什么压测和回归？参数怎么调才不像玄学？

这篇文章就围绕这些问题展开，并给出一套可以在 Laravel 项目中直接复用的工程化方案。

---

## 先把概念讲清楚：pgvector 到底在做什么

简单说，`pgvector` 就是给 PostgreSQL 增加了一种向量类型（`vector`）和对应的索引算法（`hnsw` / `ivfflat`），让我们可以：

1. 存储 Embedding 向量；
2. 在表内完成近似最近邻（ANN）检索；
3. 把向量检索和传统业务查询混合在同一个数据库中完成。

对 Laravel 项目来说，这有几个现实好处：

- 不用再维护额外的向量数据库；
- 能继续复用熟悉的 PostgreSQL 生态；
- 在很多中等规模场景（几十万到几百万条 Embedding）里，性能足够；
- 跨语言成本低，后端 PHP/Laravel 能直接调用，不需要额外引入 gRPC/SDK。

但也正是因为它“足够近”，所以一旦数据规模上来、查询并发上来，就很容易暴露调优问题。

---

## 百万级场景下，先想清楚三件事

在真正写代码之前，我会先和团队对齐三件事。

### 第一，数据规模与增长预期

“百万级”不是一个精确的工程数字，它背后至少要拆成几个问题：

- 当前存量是多少？
- 单条 Embedding 的维度是多少？`768` / `1024` / `1536`？
- 每天新增多少？
- 是否需要历史版本？是否需要软删除？

因为这些决定了：

- 表大小和索引大小；
- `HNSW` 构建时间；
- 是否需要做分区、归档、冷热分离；
- 是否需要把“写多读少”和“读多写少”分开设计。

### 第二，业务查询模式

向量检索很少孤立存在，真实场景通常是：

- 先按用户、租户、分类、状态、时间做硬过滤；
- 再在候选集内做向量相似度排序；
- 最后拼业务规则，比如去重、打散、权重、安全策略。

这意味着，**索引能不能命中、过滤下推是否有效，比单一 ANN 指标更重要**。

### 第三，可接受的精度与延迟

ANN 本质是“近似”，所以一定要先定义业务可接受的误差：

- 如果 10 条召回里允许 1~2 条偏差，那 HNSW 是很合适的；
- 如果要求极高召回率，就要在参数、候选集、重排策略上多花功夫。

---

## 距离函数不是玄学，选错了会直接影响效果

pgvector 支持三种常用距离度量：

- `L2`（欧氏距离）
- `IP`（内积，Inner Product）
- `Cosine`（余弦相似度）

### L2

在很多传统机器学习场景里很常见，直接衡量向量之间的绝对差异。适合 Embedding 本身已经做了良好归一化、并且希望“距离”反映实际空间差异的场景。

### Cosine

很多文本 Embedding 更常用 Cosine，因为它关注方向而不是模长。对于文本语义相似度这种场景，方向往往比绝对大小更稳定。

### IP

内积与 Cosine 相关但不完全相同，尤其在向量未归一化时，差异会更明显。生产里我会优先测试 Cosine，除非有明确理由再切换。

---

## 我的实战建议

在 Laravel 电商、客服、搜索类项目里，我的默认策略通常是：

- 文本 Embedding 检索优先尝试 `Cosine`；
- 如果向量已经归一化且业务对性能更敏感，再考虑 `IP`；
- `L2` 作为兜底，或者在明确需要该度量的场景使用。

关键不在于“哪个一定更好”，而是：

1. 在真实数据上跑 A/B；
2. 看召回质量；
3. 再看延迟和资源消耗。

---

## HNSW 是目前大多数生产场景的首选

`hnsw` 和 `ivfflat` 都是 ANN 索引，但在真实生产里，两者特性差别很大。

### HNSW 的优点

- 查询延迟更稳；
- 对“小候选集过滤”场景通常表现更好；
- 不需要先聚类，构建阶段相对更简单；
- 在很多中文语义检索、客服检索、商品检索场景中，体验通常更稳定。

### HNSW 的代价

- 构建索引更吃内存；
- 大表首次建索引可能较慢；
- 写入压力大时，需要更认真地规划维护窗口。

---

## 我在实际项目里怎么选

- 几十万到几百万条 Embedding，且以读为主：优先 HNSW；
- 写入特别重、更新特别频繁，但数据规模适中：评估是否分表或异步重建索引；
- 超大规模 ANN，且对延迟和召回有更高要求：考虑 pgvector 先兜底，未来再迁移到专用向量数据库。

---

## `ef_search`、`m`、`ef_construction` 到底在调什么

这是最容易让人困惑的地方，简单拆开说。

### `ef_construction`

控制 HNSW 构建阶段的候选集大小。值越大，索引质量通常越高，但构建越慢、内存消耗越大。

### `m`

控制每个节点维护的连接数。影响图的连通性和查询性能。

### `ef_search`

查询时的候选集大小。值越大，召回通常越好，但延迟会上升。

---

## 生产调优的常见模式

我的经验是：

1. 先用默认参数把功能跑通；
2. 再在真实数据上做压测；
3. 然后重点调 `ef_search`；
4. 只有在发现索引质量明显不足时，再回头调 `ef_construction` 和 `m`。

原因很简单：`ef_search` 对查询时延影响最直接，也最容易在 A/B 里观察到召回/性能的权衡。

---

## Laravel Scout 接入 pgvector 的现实路径

到目前为止，Laravel Scout 官方并没有把 pgvector 作为默认内置驱动。但这不代表不能用，通常有两条路：

### 路径一：用社区 Scout pgvector 驱动

如果社区包成熟度足够、维护活跃，并且团队愿意接受外部依赖，可以优先评估。

### 路径二：自己写一个 Scout Engine

在很多 Laravel 项目里，这反而是最可控的方式：

- 能完全控制查询结构；
- 能混合业务过滤；
- 能调参、能埋点；
- 能在必要时切换到只查询部分租户/分类/状态。

---

## 实战：一张文章表的 pgvector 语义检索

假设我们要给 Laravel 项目做一个“相似文章检索”或“语义召回”功能，典型结构如下。

### 1）扩展 PostgreSQL 向量能力

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2）建表

```sql
CREATE TABLE articles (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  tenant_id BIGINT NOT NULL,
  category_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'published',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  embedding vector(1536)
);
```

这里 `1536` 只是示例维度，要和你实际使用的 Embedding 模型输出一致。

### 3）混合索引

如果业务查询经常带 `status = published`，建议建混合索引：

```sql
CREATE INDEX idx_articles_embedding_hnsw
ON articles
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE status = 'published';
```

这一步很重要。很多“索引没生效”的问题，最后都回到：

- 条件不在索引里；
- 过滤条件和索引定义不一致；
- 查询字段顺序和类型不匹配。

---

## Laravel 里如何真正把检索跑起来

我们可以先在 raw SQL 层验证：

```sql
SELECT id, title
FROM articles
WHERE status = 'published'
ORDER BY embedding <=> $1
LIMIT 20;
```

其中 `<=>` 是 pgvector 的余弦距离运算符。

这一步的目标是先确认：

- SQL 能跑；
- 结果合理；
- 延迟可接受。

一旦 SQL 层稳定，再把它包进 Laravel。

---

## 自定义 Scout Engine 的核心实现

下面给一个最小可用实现。

### Article Model

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Laravel\Scout\Searchable;

class Article extends Model
{
    use Searchable;

    protected $guarded = [];

    public function toSearchableArray(): array
    {
        return [
            'id' => $this->id,
            'tenant_id' => $this->tenant_id,
            'category_id' => $this->category_id,
            'status' => $this->status,
            'embedding' => $this->embedding,
        ];
    }
}
```

### PgVector Scout Engine

```php
<?php

namespace App\Infrastructure\Search\Engines;

use Illuminate\Database\Eloquent\Builder;
use Laravel\Scout\Builder;
use Laravel\Scout\Engines\Engine;

class PgVectorScoutEngine extends Engine
{
    public function __construct(
        protected int $dimensions = 1536,
        protected string $distanceFunction = 'cosine',
    ) {}

    public function search(Builder $builder)
    {
        return $this->performSearch($builder, []);
    }

    public function performSearch(Builder $builder, array $options = []): mixed
    {
        $embedding = $options['embedding'] ?? null;
        $limit = $options['limit'] ?? 20;

        if (!$embedding) {
            throw new \InvalidArgumentException('Missing embedding vector for search.');
        }

        $model = $builder->model;
        $query = $model->newQuery();

        foreach ($builder->wheres as $where) {
            $query->where($where['column'], $where['operator'], $where['value']);
        }

        $operator = match ($this->distanceFunction) {
            'cosine' => '<=>',
            'l2' => '<->',
            'inner_product' => '<#>',
            default => '<=>',
        };

        $raw = "embedding {$operator} ? as distance";

        $results = $query
            ->selectRaw('*, ?::vector as query_vector', [$embedding])
            ->selectRaw($raw, [$embedding])
            ->orderBy('distance')
            ->limit($limit)
            ->get();

        return $results;
    }

    public function paginate(Builder $builder, $perPage, $page)
    {
        throw new \RuntimeException('Pagination not implemented in this demo engine.');
    }

    public function getTotalCount(Builder $builder): int
    {
        return (clone $builder->getQuery())->toBase()->getCountForPagination();
    }

    public function flush($model)
    {
        // flush logic if needed
    }
}
```

---

## 控制器怎么查

在实际业务里，典型流程是：

1. 从用户输入生成 Query Embedding；
2. 带业务过滤条件做向量检索；
3. 返回结果并拼接业务逻辑。

```php
<?php

namespace App\Http\Controllers;

use App\Models\Article;
use App\Services\EmbeddingService;
use Illuminate\Http\Request;

class ArticleSearchController extends Controller
{
    public function index(
        Request $request,
        EmbeddingService $embedding
    ) {
        $query = $request->input('query');
        $categoryId = $request->input('category_id');

        $vector = $embedding->embedText($query);

        $results = Article::search('unused')
            ->using(
                \App\Infrastructure\Search\Engines\PgVectorScoutEngine::class,
                [
                    'embedding' => $vector,
                    'limit' => 20,
                ]
            )
            ->where('status', 'published')
            ->when($categoryId, fn ($q) => $q->where('category_id', $categoryId))
            ->rawSearch()
            ->get();

        return response()->json([
            'query' => $query,
            'items' => $results,
        ]);
    }
}
```

这里只是为了演示把“业务过滤 + 向量检索”放在一起。生产里还要再补：

- 错误处理；
- 超时控制；
- fallback；
- cache；
- 监控打点。

---

## `ef_search` 在 Laravel 中如何动态调参

很多项目会把“召回质量”和“性能预算”拆开治理，比如：

- 默认场景用 `ef_search = 64`；
- 更高质量要求场景用 `ef_search = 128`；
- 后台重排/导出场景用 `ef_search = 256`。

实现方式有两种：

1. 在 SQL 里用 `SET LOCAL hnsw.ef_search = 128`；
2. 在连接层/事务层封装，按场景切换。

PHP 侧可以这样写：

```php
<?php

namespace App\Infrastructure\Database;

use Illuminate\Support\Facades\DB;

class VectorSearchTuning
{
    public static function withEfSearch(int $efSearch, callable $callback): mixed
    {
        return DB::transaction(function () use ($efSearch, $callback) {
            DB::statement("SET LOCAL hnwb.ef_search = {$efSearch}");
            return $callback();
        });
    }
}
```

如果直接用 raw SQL，也可以更简单地：

```php
DB::statement("SET LOCAL hnsw.ef_search = 128");

$results = DB::select('
    SELECT id, title, embedding <=> ? AS distance
    FROM articles
    WHERE status = ?
    ORDER BY distance
    LIMIT 20
', [$vector, 'published']);
```

---

## 过滤下推：这才是百万级场景真正的分水岭

很多人只看 ANN 指标，但真正决定生产效果的往往是：

- 过滤条件能不能走索引；
- 过滤后的候选集是否足够小；
- 过滤字段是否有合适索引。

例如：

- `status`
- `tenant_id`
- `category_id`
- `created_at`

都应该有独立索引，或者组合索引，取决于常见查询模式。

我见过不少问题，不是 pgvector 慢，而是：

- `status` 有 5 种值，索引选择性太差；
- `tenant_id` 没加索引；
- 查询里用了函数，导致无法下推。

---

## 生产落地前建议做的六件事

### 1）做真实数据压测

不要只测 1000 条。至少测 50 万 ~ 100 万条，维度要和线上一致。

### 2）测多种查询模式

- 纯向量检索；
- 向量 + 过滤；
- 向量 + 过滤 + 分页；
- 多租户隔离查询。

### 3）对比 Cosine / L2 / IP

看召回质量与性能的差异。

### 4）对比不同 `ef_search`

比如 32、64、128、256。

### 5）监控 PostgreSQL 指标

重点看：

- 延迟；
- CPU；
- 内存；
- IO；
- buffer cache；
- index usage。

### 6）准备回滚方案

如果新方案上线后延迟变高，应该能快速回退到旧检索方式。

---

## 常见踩坑记录

### 踩坑一：以为 pgvector 自动处理好了一切

没有。很多问题本质上是索引、过滤、查询结构问题，不是向量算法问题。

### 踩坑二：维度不一致

模型换了一版，Embedding 从 1536 变成 1024，没迁移历史数据，结果直接报错或者效果变差。

### 踩坑三：没考虑冷启动

刚开始数据量小，HNSW 效果未必明显。等到几十万、百万级才开始调参，成本很高。

### 踩坑四：把 ANN 当成精确检索

ANN 是“近似”，业务侧必须接受一定偏差，并在产品层面设计兜底。

### 踩坑五：只测召回不测延迟

召回很好看，但 P95 延迟超标，线上一样会出问题。

---

## 和 Elasticsearch / Milvus 怎么选

我的判断标准通常比较简单：

- 数据规模中等、团队熟悉 PostgreSQL、先做 MVP：pgvector 优先；
- 需要更复杂的文本检索能力、倒排索引、多字段混合搜索：Elasticsearch 更合适；
- 规模继续放大、对 ANN 性能和资源隔离要求更高：再考虑 Milvus / Qdrant 等专用向量数据库。

**不是“pgvector 一定更好”，而是“在当前阶段它可能最划算”。**

---

## 一个可复制的 Laravel 工程化目录结构

如果项目长期维护，我会把向量检索拆成独立层：

- `Infrastructure/Database/VectorSearchTuning.php`
- `Infrastructure/Search/Engines/PgVectorScoutEngine.php`
- `Services/EmbeddingService.php`
- `Jobs/RebuildArticleEmbeddingJob.php`
- `Listeners/RefreshArticleEmbedding.php`

这样做的好处是：

- 业务层不直接耦合 pgvector；
- 后续换引擎时改动更小；
- 测试、监控、重试逻辑更容易沉淀。

---

## 最后总结

**PostgreSQL pgvector + HNSW 是 Laravel 项目做向量检索时非常务实的选择**。它不是万能的，但在很多真实业务里，确实能以更低的运维成本、更统一的技术栈，把语义检索、相似召回、辅助推荐做起来。

生产落地时，核心不是“装上扩展”，而是：

- 想清楚业务查询模式；
- 选好距离函数；
- 针对真实数据调 `ef_search`；
- 保证过滤条件能下推；
- 用 Laravel Scout 自定义 Engine 把它包成可维护的服务；
- 最后用压测把参数跑出来，而不是靠猜。

如果你的 Laravel 项目已经有 PostgreSQL，又暂时没有特别重的 ANN 规模，pgvector 很值得作为第一版落地目标。等规模再大、能力要求再高，再考虑演进到更专业的向量数据库也不迟。
