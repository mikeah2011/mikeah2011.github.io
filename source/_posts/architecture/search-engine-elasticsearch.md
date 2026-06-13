---

title: 搜索系统设计实战：Elasticsearch 索引设计、分词策略与相关性调优——Laravel B2C API 踩坑记录
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-16 20:41:01
updated: 2026-05-16 20:48:35
categories:
  - architecture
  - search
keywords: [Elasticsearch, Laravel B2C API, 搜索系统设计实战, 索引设计, 分词策略与相关性调优, 踩坑记录]
tags:
- Elasticsearch
- KKday
- Laravel
- MySQL
- 搜索
- 分词
description: 基于 KKday B2C 旅游电商真实项目，记录从 MySQL LIKE 演进到 Elasticsearch 搜索系统的完整过程——涵盖索引 Mapping 设计、IK 中英文分词策略、相关性评分调优、Suggest 自动补全、聚合过滤，以及生产环境的性能踩坑与优化方案。
---



# 搜索系统设计实战：Elasticsearch 索引设计、分词策略与相关性调优

> 从 `WHERE title LIKE '%keyword%'` 到毫秒级全文搜索，这是一段真实的演进踩坑路。

## 前言

B2C 旅游电商的搜索场景和传统电商有本质差异——用户搜的不是「iPhone 15」这种精确商品名，而是「东京三天两夜自由行」「大阪亲子酒店推荐」这种模糊意图。MySQL 的 `LIKE '%keyword%'` 在 10 万级商品表上已经捉襟见肘，更别提分词、同义词、拼音纠错这些需求了。

本文基于 KKday B2C Backend 真实项目，记录搜索系统从 MySQL 演进到 Elasticsearch 的完整过程。

---

## 架构总览

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Frontend   │────▶│   Laravel BFF    │────▶│  Elasticsearch    │
│  (Vue/uni)  │     │  Search Service  │     │  Cluster (3 Node) │
└─────────────┘     └────────┬─────────┘     └───────────────────┘
                             │                         ▲
                             ▼                         │
                    ┌─────────────────┐       ┌────────┴────────┐
                    │  MySQL (Source) │──────▶│  Sync Pipeline  │
                    │  Products Table │       │  (Queue + CDC)  │
                    └─────────────────┘       └─────────────────┘

搜索请求流：
  用户输入 → BFF 分词/纠错 → ES Query DSL → 结果聚合/高亮 → 返回前端

数据同步流：
  MySQL Write → Model Observer → Queue Job → ES Bulk Index
```

---

## 第一关：索引 Mapping 设计

### 踩坑 1：Dynamic Mapping 是个坑

ES 默认的 Dynamic Mapping 会自动推断字段类型，看起来很方便，但后果很严重：

```php
// ❌ 动态映射的后果
// price 字段被映射为 text 而非 integer
// 排序时报错：Text fields are not optimised for sorting
// category 被映射为 text，聚合时需要用 keyword 子字段

// 产品价格 "12,500" 被存为字符串，排序完全乱掉
```

**正确做法：手动定义 Mapping**

```json
// PUT /products_v2
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "ik_smart_analyzer": {
          "type": "custom",
          "tokenizer": "ik_smart",
          "filter": ["lowercase", "trim"]
        },
        "ik_max_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["lowercase", "trim"]
        },
        "pinyin_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "pinyin_filter"]
        }
      },
      "filter": {
        "pinyin_filter": {
          "type": "pinyin",
          "keep_full_pinyin": true,
          "keep_joined_full_pinyin": true,
          "keep_original": true
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "product_id":    { "type": "integer" },
      "title":         { "type": "text", "analyzer": "ik_max_analyzer", "search_analyzer": "ik_smart_analyzer" },
      "title_pinyin":  { "type": "text", "analyzer": "pinyin_analyzer" },
      "description":   { "type": "text", "analyzer": "ik_max_analyzer" },
      "category_id":   { "type": "integer" },
      "category_name": { "type": "keyword" },
      "price":         { "type": "scaled_float", "scaling_factor": 100 },
      "currency":      { "type": "keyword" },
      "city":          { "type": "keyword" },
      "country":       { "type": "keyword" },
      "tags":          { "type": "keyword" },
      "rating":        { "type": "float" },
      "sales_count":   { "type": "integer" },
      "is_active":     { "type": "boolean" },
      "created_at":    { "type": "date" },
      "suggest":       { "type": "completion" }
    }
  }
}
```

**关键设计决策：**

| 字段 | 类型选择 | 原因 |
|------|---------|------|
| `title` | `text` + ik_max_word | 索引时最大切分，搜索时用 ik_smart |
| `title_pinyin` | `text` + pinyin | 支持拼音搜索（如 `dongjing` → 东京） |
| `category_name` | `keyword` | 不分词，用于精确过滤和聚合 |
| `price` | `scaled_float` | 避免浮点精度问题，存储分为单位 |
| `suggest` | `completion` | 自动补全专用类型，性能最优 |

### 踩坑 2：Text 和 Keyword 混用策略

```php
// Laravel 中构建索引时的字段映射策略
class ProductIndexBuilder
{
    /**
     * 同一个字段同时建 text 和 keyword 两种子字段
     * - text: 用于全文搜索（分词）
     * - keyword: 用于精确匹配、排序、聚合
     */
    public function buildMapping(): array
    {
        return [
            'title' => [
                'type' => 'text',
                'analyzer' => 'ik_max_analyzer',
                'search_analyzer' => 'ik_smart_analyzer',
                'fields' => [
                    'keyword' => ['type' => 'keyword', 'ignore_above' => 256],
                    'pinyin'  => ['type' => 'text', 'analyzer' => 'pinyin_analyzer'],
                ],
            ],
        ];
    }
}
```

---

## 第二关：IK 分词策略

### 中文分词的三个层次

```
原文：「东京浅草寺一日游」

ik_smart（粗粒度）：  东京 | 浅草寺 | 一日游
ik_max_word（细粒度）：东京 | 浅草 | 寺 | 一日 | 一日游 | 日游
```

**最佳实践：索引用 ik_max_word，搜索用 ik_smart**

- 索引时细粒度切分 → 召回率高，「浅草」也能命中「浅草寺」
- 搜索时粗粒度切分 → 精确度高，避免「日游」这种无意义碎片

### 自定义词典：解决领域术语

```php
// config/elasticsearch.php
return [
    'ik_dict_path' => env('ES_IK_DICT_PATH', '/etc/elasticsearch/analysis-ik/'),

    // KKday 旅游领域自定义词典
    'custom_dict' => [
        '一日游', '半日游', '自由行', '跟团',
        'JR Pass', '周游卡', '交通卡',
        '浅草寺', '晴空塔', '迪士尼', '环球影城',
        '和服体验', '抹茶体验', '寿司制作',
    ],

    // 同义词词典
    'synonym_dict' => [
        '东京,tokyo,東京',
        '大阪,osaka',
        '自由行,DIY,半自助',
        '酒店,饭店,旅馆',
    ],
];
```

**踩坑 3：自定义词典更新后必须 reindex**

```php
// ❌ 以为更新词典就够了，但已有索引不受影响
// ✅ 必须 Reindex 或创建新索引并切换别名

class ReindexProductCommand extends Command
{
    public function handle(): int
    {
        $oldIndex = 'products_v1';
        $newIndex = 'products_v2';

        // 1. 创建新索引（新 Mapping + 新词典）
        $this->call('es:create-index', ['name' => $newIndex]);

        // 2. Reindex 旧数据到新索引
        $response = $this->es->reindex([
            'source' => ['index' => $oldIndex],
            'dest'   => ['index' => $newIndex],
        ]);

        // 3. 等待 reindex 完成
        $this->info("Reindex task: {$response['task']}");

        // 4. 原子切换别名
        $this->es->indices()->updateAliases([
            'body' => [
                'actions' => [
                    ['remove' => ['index' => $oldIndex, 'alias' => 'products']],
                    ['add'    => ['index' => $newIndex, 'alias' => 'products']],
                ],
            ],
        ]);

        $this->info("Alias switched: {$oldIndex} → {$newIndex}");
        return 0;
    }
}
```

---

## 第三关：搜索 Query DSL 构建

### Laravel Service 层封装

```php
class ProductSearchService
{
    private ElasticClient $es;

    /**
     * 核心搜索方法：多字段 + 权重 + 高亮 + 聚合
     */
    public function search(SearchRequest $request): SearchResponse
    {
        $params = [
            'index' => 'products',
            'body'  => $this->buildQuery($request),
        ];

        $result = $this->es->search($params);

        return new SearchResponse(
            items: $this->parseHits($result['hits']),
            total: $result['hits']['total']['value'],
            facets: $this->parseAggregations($result['aggregations'] ?? []),
            took: $result['took'],
        );
    }

    private function buildQuery(SearchRequest $request): array
    {
        $must = [];
        $filter = [];

        // 1. 核心搜索：多字段 + 权重
        if ($keyword = $request->input('keyword')) {
            $must[] = [
                'multi_match' => [
                    'query'  => $keyword,
                    'type'   => 'best_fields',
                    'fields' => [
                        'title^5',           // 标题权重最高
                        'title.pinyin^2',    // 拼音搜索次之
                        'description^1',     // 描述权重最低
                        'tags^3',            // 标签权重较高
                    ],
                    'fuzziness'        => 'AUTO',       // 自动纠错
                    'prefix_length'    => 1,             // 前缀不模糊
                    'minimum_should_match' => '75%',
                ],
            ];
        }

        // 2. 过滤条件（不参与评分，走 filter 缓存）
        if ($city = $request->input('city')) {
            $filter[] = ['term' => ['city' => $city]];
        }

        if ($categoryId = $request->input('category_id')) {
            $filter[] = ['term' => ['category_id' => $categoryId]];
        }

        // 价格范围过滤
        if ($request->has('price_min') || $request->has('price_max')) {
            $range = [];
            if ($request->has('price_min')) $range['gte'] = $request->input('price_min');
            if ($request->has('price_max')) $range['lte'] = $request->input('price_max');
            $filter[] = ['range' => ['price' => $range]];
        }

        // 3. 组合查询
        $query = [
            'bool' => [
                'must'   => $must,
                'filter' => $filter,
            ],
        ];

        // 4. 聚合（Facet 筛选）
        $aggs = [
            'categories' => ['terms' => ['field' => 'category_name', 'size' => 20]],
            'cities'     => ['terms' => ['field' => 'city', 'size' => 30]],
            'price_ranges' => [
                'range' => [
                    'field' => 'price',
                    'ranges' => [
                        ['to' => 5000,  'key' => '5000以下'],
                        ['from' => 5000,  'to' => 10000, 'key' => '5000-10000'],
                        ['from' => 10000, 'to' => 30000, 'key' => '10000-30000'],
                        ['from' => 30000, 'key' => '30000以上'],
                    ],
                ],
            ],
        ];

        // 5. 高亮
        $highlight = [
            'fields' => [
                'title'       => ['fragment_size' => 50, 'number_of_fragments' => 1],
                'description' => ['fragment_size' => 100, 'number_of_fragments' => 2],
            ],
            'pre_tags'  => ['<em class="search-highlight">'],
            'post_tags' => ['</em>'],
        ];

        return [
            'query'       => $query,
            'aggs'        => $aggs,
            'highlight'   => $highlight,
            'from'        => ($request->input('page', 1) - 1) * 20,
            'size'        => 20,
            'sort'        => $this->buildSort($request),
        ];
    }

    /**
     * 排序策略：相关性 > 评分 > 销量
     */
    private function buildSort(SearchRequest $request): array
    {
        if ($request->input('sort') === 'price_asc') {
            return [['price' => 'asc']];
        }
        if ($request->input('sort') === 'sales') {
            return [['sales_count' => 'desc']];
        }
        // 默认：相关性评分 + 销量加权
        return [
            '_score',
            ['sales_count' => 'desc'],
        ];
    }
}
```

---

## 第四关：相关性调优（Scoring Tuning）

### 踩坑 4：默认 TF-IDF 评分在电商场景下不合理

ES 7.x 默认使用 BM25 算法，但单纯依赖 BM25 的问题在于：

- 「东京酒店」和「东京一日游」两个文档，如果「东京」出现频率相同，BM25 认为一样相关
- 但实际业务中，标题完全匹配的商品应该排更前
- 销量高、评分好的商品应该有加成

**解决方案：Function Score + 业务权重**

```php
/**
 * 使用 function_score 重排搜索结果
 */
private function buildScoringQuery(string $keyword): array
{
    return [
        'function_score' => [
            'query' => [
                'multi_match' => [
                    'query' => $keyword,
                    'fields' => ['title^5', 'title.pinyin^2', 'description^1'],
                    'type' => 'best_fields',
                    'minimum_should_match' => '75%',
                ],
            ],
            'functions' => [
                // 1. 销量加成：对数衰减，避免爆款垄断
                [
                    'field_value_factor' => [
                        'field'    => 'sales_count',
                        'modifier' => 'log1p',
                        'factor'   => 2,
                    ],
                    'weight' => 0.3,
                ],
                // 2. 评分加成
                [
                    'field_value_factor' => [
                        'field'    => 'rating',
                        'modifier' => 'none',
                    ],
                    'weight' => 0.2,
                ],
                // 3. 新品衰减：created_at 越新权重越高
                [
                    'gauss' => [
                        'created_at' => [
                            'origin' => 'now',
                            'scale'  => '90d',
                            'decay'  => 0.5,
                        ],
                    ],
                    'weight' => 0.1,
                ],
            ],
            'score_mode' => 'sum',
            'boost_mode' => 'multiply',
        ],
    ];
}
```

### 踩坑 5：同义词导致误召回

```
同义词词典：「酒店,饭店,旅馆」
用户搜「饭店」→ 同时召回酒店和餐饮饭店
```

**解决方案：同义词按场景分组，搜索时动态选择**

```php
class SynonymManager
{
    // 按场景分组，避免跨领域混淆
    private array $synonyms = [
        'accommodation' => [
            '酒店,饭店,旅馆,民宿',
        ],
        'transport' => [
            '机场接送,接机,送机',
        ],
        'activity' => [
            '一日游,半日游,day tour',
        ],
    ];

    /**
     * 根据搜索意图选择同义词分组
     */
    public function getAnalyzerForQuery(string $keyword): string
    {
        // 如果搜索词命中住宿类关键词，使用住宿同义词分析器
        if (preg_match('/(酒店|饭店|旅馆|住宿)/u', $keyword)) {
            return 'ik_smart_accommodation_synonym';
        }
        return 'ik_smart';
    }
}
```

---

## 第五关：Suggest 自动补全

```php
/**
 * 搜索建议：Completion Suggester + 拼音支持
 */
public function suggest(string $prefix, int $size = 10): array
{
    $params = [
        'index' => 'products',
        'body'  => [
            'suggest' => [
                'title-suggest' => [
                    'prefix'  => $prefix,
                    'completion' => [
                        'field' => 'suggest',
                        'size'  => $size,
                        'skip_duplicates' => true,
                        'fuzzy' => [
                            'fuzziness' => 'AUTO',
                        ],
                    ],
                ],
            ],
        ],
    ];

    $result = $this->es->search($params);

    return collect($result['suggest']['title-suggest'][0]['options'])
        ->map(fn($item) => [
            'text'       => $item['text'],
            'product_id' => $item['_source']['product_id'],
            'score'      => $item['_score'],
        ])
        ->toArray();
}
```

---

## 第六关：数据同步方案

### 踩坑 6：实时同步 vs 批量同步的取舍

```php
/**
 * 方案 A：Model Observer 实时同步（适合低频更新）
 */
class ProductObserver
{
    public function saved(Product $product): void
    {
        // 延迟到队列执行，避免阻塞请求
        SyncProductToEsJob::dispatch($product->id)
            ->onQueue('elasticsearch')
            ->delay(now()->addSeconds(5)); // 5 秒延迟，避免频繁更新
    }

    public function deleted(Product $product): void
    {
        DeleteProductFromEsJob::dispatch($product->id);
    }
}

/**
 * 方案 B：定时批量同步（适合大批量更新）
 */
class BulkSyncProductsCommand extends Command
{
    public function handle(): int
    {
        $bar = $this->output->createProgressBar(Product::count());

        Product::with(['category', 'tags'])
            ->where('is_active', true)
            ->chunkById(500, function ($products) use ($bar) {
                $body = [];

                foreach ($products as $product) {
                    // Action: index
                    $body[] = ['index' => [
                        '_index' => 'products',
                        '_id'    => $product->id,
                    ]];
                    $body[] = $this->transform($product);
                }

                // Bulk API 一次提交 500 条
                $this->es->bulk(['body' => $body]);
                $bar->advance($products->count());
            });

        $bar->finish();
        $this->newLine();
        return 0;
    }
}
```

**最终方案：双管齐下**

```
实时同步：Model Observer → Queue Job → ES（延迟 5 秒，防抖动）
批量兜底：每日凌晨 Cron → Bulk Sync（修复可能遗漏的数据）
```

---

## 生产环境性能踩坑

### 踩坑 7：深分页性能爆炸

```php
// ❌ 从 10000 条开始取 20 条 → ES 需要排序 10020 条再丢弃前 10000
$params = ['from' => 10000, 'size' => 20];

// ✅ 方案 A：search_after 游标分页
$params = [
    'size' => 20,
    'sort' => [
        ['_score' => 'desc'],
        ['product_id' => 'desc'], // tiebreaker
    ],
    'search_after' => [0.85, 12345], // 上一页最后一条的 sort 值
];

// ✅ 方案 B：限制最大分页深度 + 提示用户用筛选
// B2C 场景下，超过 10 页的用户极少，限制 from <= 200
if ($request->input('page', 1) > 10) {
    return response()->json([
        'message' => '请使用筛选条件缩小搜索范围',
    ], 400);
}
```

### 踩坑 8：聚合结果缓存失效

```php
// Facet 聚合每次都要算，但短时间内结果几乎不变
// 用 Redis 缓存聚合结果，TTL 60 秒

class CachedSearchService
{
    public function search(SearchRequest $request): SearchResponse
    {
        $cacheKey = 'search:' . md5(json_encode($request->validated()));

        return Cache::remember($cacheKey, 60, function () use ($request) {
            return $this->searchService->search($request);
        });
    }
}
```

---

## 搜索系统架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        Search Pipeline                           │
│                                                                  │
│  ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐  │
│  │ Keyword │──▶│ Analyzer │──▶│ Query    │──▶│  Scoring &   │  │
│  │ Input   │   │ (IK+拼音) │   │ Builder  │   │  Rescoring   │  │
│  └─────────┘   └──────────┘   └──────────┘   └──────┬───────┘  │
│                                                      │          │
│  ┌─────────┐   ┌──────────┐   ┌──────────┐          ▼          │
│  │ Facet   │◀──│ Aggregate│◀──│ Result   │◀── ES Response       │
│  │ Filter  │   │ Parser   │   │ Parser   │                      │
│  └─────────┘   └──────────┘   └──────────┘                      │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Data Sync Layer                       │    │
│  │  Observer (实时) ──▶ Queue Job ──▶ ES Bulk Index        │    │
│  │  Cron (批量)   ──▶ Chunk 500 ──▶ ES Bulk Index         │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 总结：搜索系统的 8 条军规

| # | 规则 | 说明 |
|---|------|------|
| 1 | **永远不用 Dynamic Mapping** | 手动定义 Mapping，避免字段类型被自动推断错误 |
| 2 | **索引用 ik_max_word，搜索用 ik_smart** | 召回率和精确度的平衡 |
| 3 | **同义词分领域管理** | 避免跨领域误召回 |
| 4 | **过滤条件走 filter context** | 不参与评分，可被缓存，性能提升 10x |
| 5 | **Function Score 重排默认评分** | 加入销量、评分、新鲜度等业务信号 |
| 6 | **深分页用 search_after** | 严禁 from > 10000 |
| 7 | **聚合结果做 Redis 缓存** | TTL 60 秒，减少 ES 计算压力 |
| 8 | **索引别名 + Reindex 更新 Mapping** | 零停机索引迁移 |

---

*搜索系统的核心挑战不在于「能不能搜到」，而在于「搜出来的结果是否符合用户预期」。技术选型只是起点，真正的功夫在相关性调优和业务理解上。*

---

## 相关阅读

- [ELK Stack 实战：Elasticsearch + Logstash + Kibana 集中式日志系统与 Laravel 集成踩坑记录](/categories/架构/elk-stack-guide-elasticsearch-logstash-kibana-logging-laravel/)
- [CQRS 模式实战：读写分离架构在 Laravel 中的落地——B2C 电商查询性能优化](/categories/架构/cqrs-guide-architecture-laravel-queryperformance/)
- [微服务拆分策略：从单体 Laravel 到微服务的渐进式演进踩坑记录](/categories/架构/microservices-laravelmicroservices/)
