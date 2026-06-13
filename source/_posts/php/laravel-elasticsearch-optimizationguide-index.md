---

title: Laravel + Elasticsearch 全文搜索优化实战：商品搜索召回、同义词与零停机重建索引踩坑记录
keywords: [Laravel, Elasticsearch, 全文搜索优化实战, 商品搜索召回, 同义词与零停机重建索引踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 10:20:00
categories:
- php
tags:
- Elasticsearch
- KKday
- Laravel
- 全文搜索
- 同义词
description: 结合 Laravel B2C 商品搜索改造经验，详细记录 Elasticsearch 在索引设计、召回排序、function_score 权重调优、同义词扩展、Bulk 批量回填、增量同步与零停机重建索引（alias 切换）上的一套可落地方案。涵盖索引 mapping 设计原则、查询层召回与排序分离、afterCommit 异步同步、生产事故排查等实战踩坑，帮助团队把搜索接口 P95 从 420ms 降到 85ms，适合需要对 Laravel + Elasticsearch 搜索链路做系统性优化的后端工程师参考。
---



商品搜索这件事，最容易被低估。项目早期大家通常先用 MySQL `like '%关键字%'` 顶着，数据量一上来就会同时出现三个问题：**查得慢、召回差、排序乱**。我在一个旅游商品 B2C API 里把搜索链路从 MySQL 迁到 Elasticsearch，真正带来收益的不是“换了个引擎”，而是把**索引结构、查询意图、同步机制和重建流程**一次性理顺。上线后，搜索接口 P95 从 420ms 降到 85ms，最关键的是“东京迪士尼”“迪士尼 东京票券”“disney tokyo”这类混合搜索终于能稳定命中。

## 一、先别急着建索引，先把搜索链路拆开

我们的落地结构如下：

```text
App / Web
   │
   ▼
Laravel SearchController
   │
   ▼
ProductSearchService
   ├── QueryBuilder：关键词清洗、同义词扩展、过滤条件组装
   ├── Elasticsearch：全文召回 + function_score 排序
   └── MySQL：兜底详情与价格校验
   │
   ▼
Queue Worker
   └── ProductSearchSyncJob：商品变更后增量同步 ES

Alias: products_read / products_write
   │
   ├── products_v20260501
   └── products_v20260503
```

这里最重要的设计不是 ES 本身，而是 **read alias / write alias**。只要你准备做 mapping 调整、分词器变更、同义词重建，就一定会用到别名切换，不然每次重建索引都得停机。

## 二、索引设计别照着数据库字段平移

一开始我们把商品表字段几乎原样塞进 ES，结果 `title`、`subtitle`、`tags` 权重完全失控，筛选字段还被错误分词。后来改成“可搜索字段”和“可过滤字段”分离：

```json
PUT /products_v20260503
{
  "settings": {
    "analysis": {
      "filter": {
        "product_synonym": {
          "type": "synonym_graph",
          "synonyms": [
            "迪士尼, disney",
            "环球影城, usj, universal studios japan",
            "一日券, day pass"
          ]
        }
      },
      "analyzer": {
        "product_text": {
          "tokenizer": "standard",
          "filter": ["lowercase", "product_synonym"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "id": {"type": "keyword"},
      "title": {"type": "text", "analyzer": "product_text", "copy_to": "_all_text"},
      "subtitle": {"type": "text", "analyzer": "product_text", "copy_to": "_all_text"},
      "tags": {"type": "keyword"},
      "destination": {"type": "keyword"},
      "depart_city": {"type": "keyword"},
      "price": {"type": "scaled_float", "scaling_factor": 100},
      "sold_count": {"type": "integer"},
      "score": {"type": "float"},
      "is_active": {"type": "boolean"},
      "_all_text": {"type": "text", "analyzer": "product_text"}
    }
  }
}
```

两个经验非常关键：

1. `destination`、`depart_city` 这类筛选字段必须用 `keyword`，不要让它们参与分词。
2. 排序字段要单独存数值，不要指望运行时脚本从文本里扣。

## 三、Laravel 查询层要把“召回”和“排序”分开

很多搜索接口做坏，不是因为 ES 不行，而是把一个 `multi_match` 当万能钥匙。我的做法是先尽量召回，再用 `function_score` 修正排序：

```php
<?php

namespace App\Services\Search;

use Elastic\Elasticsearch\Client;

final class ProductSearchService
{
    public function __construct(private Client $client) {}

    public function search(string $keyword, array $filters = []): array
    {
        $params = [
            'index' => 'products_read',
            'body' => [
                'from' => 0,
                'size' => 20,
                'query' => [
                    'function_score' => [
                        'query' => [
                            'bool' => [
                                'must' => [
                                    [
                                        'multi_match' => [
                                            'query' => trim($keyword),
                                            'fields' => ['title^5', 'subtitle^2', '_all_text'],
                                            'type' => 'best_fields'
                                        ]
                                    ]
                                ],
                                'filter' => array_values(array_filter([
                                    ['term' => ['is_active' => true]],
                                    $filters['destination'] ?? null
                                        ? ['term' => ['destination' => $filters['destination']]]
                                        : null,
                                    $filters['depart_city'] ?? null
                                        ? ['term' => ['depart_city' => $filters['depart_city']]]
                                        : null,
                                ])),
                            ],
                        ],
                        'field_value_factor' => [
                            'field' => 'sold_count',
                            'modifier' => 'log1p',
                            'missing' => 0
                        ],
                        'boost_mode' => 'sum',
                        'functions' => [
                            [
                                'filter' => ['range' => ['score' => ['gte' => 4.5]]],
                                'weight' => 2
                            ]
                        ]
                    ]
                ]
            ]
        ];

        return $this->client->search($params)->asArray();
    }
}
```

这段代码解决了一个很真实的问题：标题命中优先，但销量和评分也能参与排序。否则搜索“东京”时，新建但无销量的测试商品会跑到第一页，运营会直接来找你。

## 四、同步链路一定走异步，不要在写请求里直塞 ES

商品上下架、改价、补库存时，我们最早是直接在 Laravel Service 里同步 ES。结果只要 ES 抖一下，后台保存商品就跟着超时。后来改成 **DB 提交成功后丢队列**：

```php
<?php

final class SyncProductToSearchJob implements ShouldQueue
{
    use Dispatchable, Queueable, SerializesModels;

    public function __construct(public int $productId) {}

    public function handle(ProductIndexer $indexer): void
    {
        $indexer->sync($this->productId);
    }
}
```

```php
DB::afterCommit(function () use ($productId) {
    SyncProductToSearchJob::dispatch($productId)->onQueue('search');
});
```

`afterCommit()` 很关键。我们踩过一个坑：事务还没提交，Job 先执行，ES 里读到旧数据，最终搜索结果比后台看到的晚半拍，排查起来特别恶心。

## 五、回填阶段不要单条写入，直接走 Bulk

全量重建时如果还一笔一笔 `index()`，速度会非常差，还容易把 queue worker 打满。我的做法是按 500~1000 笔切块，批次写入：

```php
<?php

final class ProductIndexer
{
    public function __construct(private Client $client) {}

    public function bulkIndex(iterable $products, string $index): void
    {
        $body = [];

        foreach ($products as $product) {
            $body[] = [
                'index' => [
                    '_index' => $index,
                    '_id' => (string) $product->id,
                ],
            ];

            $body[] = [
                'id' => (string) $product->id,
                'title' => $product->title,
                'subtitle' => $product->subtitle,
                'tags' => $product->tags,
                'destination' => $product->destination_code,
                'depart_city' => $product->depart_city_code,
                'price' => (float) $product->price,
                'sold_count' => (int) $product->sold_count,
                'score' => (float) $product->review_score,
                'is_active' => (bool) $product->is_active,
            ];
        }

        $response = $this->client->bulk(['body' => $body])->asArray();

        if (($response['errors'] ?? false) === true) {
            throw new RuntimeException('bulk index contains failed items');
        }
    }
}
```

这一步的重点不是“快一点”而已，而是**控制重建窗口**。如果 80 万商品要回填 3 小时，任何中途 schema 变更、同义词回滚都会拖垮发布节奏；如果能压到 20~30 分钟，索引治理才真正可操作。

## 六、零停机重建索引的核心是 alias 切换

只要 mapping 改了，就不要试图“在线修”。正确姿势是新建版本索引、回填、切别名：

```bash
curl -X POST http://localhost:9200/_aliases -H 'Content-Type: application/json' -d '
{
  "actions": [
    {"remove": {"index": "products_v20260501", "alias": "products_read"}},
    {"add":    {"index": "products_v20260503", "alias": "products_read"}},
    {"remove": {"index": "products_v20260501", "alias": "products_write"}},
    {"add":    {"index": "products_v20260503", "alias": "products_write"}}
  ]
}'
```

我通常会先全量回灌，再比对文档数、抽样搜索、检查热门关键词 Top20，确认没问题才切。切 alias 是秒级动作，真正耗时的是回填和验收，不是切换本身。

## 七、踩坑记录：这三类问题最容易在生产上炸

### 1. 同义词一改就想热更新
很多团队把同义词文件一改就当配置发布，但 analyzer 往往不会自动对历史文档生效。**查询侧同义词**和**索引侧同义词**要分清，不然你以为修好了，实际老文档还是旧分词结果。

### 2. 只看命中，不看误召回
“上海”搜出“上海出发东京”可能是对的，但搜“迪士尼”把“日本乐园通票”全部打上来就不对。我们后来把 `title^5` 拉高，同时降低 `subtitle` 权重，误召回率才下来。

### 3. 用 ES 当唯一真相源
价格、库存、上下架状态最终还是 MySQL 为准。ES 适合查找，不适合承担交易真相。搜索命中后我仍会按 ID 回表做一次关键字段校验，避免脏索引直接卖货。

## 八、一次真实事故：别名切了，但写流量还打到旧索引

这个坑非常典型。我们有一次重建 `products_v20260420` 到 `products_v20260503`，只切了 `products_read`，忘了把后台写入用的 `products_write` 一起切走。结果线上表现很诡异：

- 前台搜索短时间正常
- 新上架商品搜不到
- 后台看到同步任务成功，但 ES 文档数不增长

最后排查发现，增量同步 Job 还在往旧索引写，新索引只吃到了全量回填，没有吃到增量变更。修复方式很简单，但教训很深：**读写 alias 要成对切换，并在切换后做一次增量抽样验证。**

我后来把发布检查固定成下面这几步：

```bash
# 1. 检查 alias 指向
curl http://localhost:9200/_cat/aliases?v

# 2. 检查新旧索引文档数
curl http://localhost:9200/_cat/indices/products_v20260503?v
curl http://localhost:9200/_cat/indices/products_v20260420?v

# 3. 选一笔刚更新的商品，确认写入新索引
curl http://localhost:9200/products_v20260503/_doc/123456
```

这类问题最麻烦的地方在于，它不会像 500 错误那样马上报警，而是以“搜索结果逐步变旧”的方式慢慢出血。所以搜索系统的验收不能只有接口通不通，还要验证**新数据是否持续进入当前写索引**。

## 九、我现在的上线清单

- mapping 变更一定走新索引版本
- 写链路统一 `afterCommit + Queue`
- 读写 alias 分离
- 热门关键词单独做回归样本
- 搜索监控至少看 P95、0 结果率、点击率、Top miss keyword

全文搜索优化做到后面，其实已经不是“会不会写 DSL”，而是你能不能把**索引演进、业务权重和数据一致性**同时管住。ES 很强，但真正让它稳定发挥价值的，永远是工程化细节。

## 十、方案对比：ES vs 数据库全文搜索 vs PostgreSQL 原生搜索

在决定是否引入 Elasticsearch 之前，很多团队会纠结"到底要不要上 ES"。下面这张表来自我们实际评估后的结论：

| 维度 | MySQL FULLTEXT | PostgreSQL tsvector | Laravel Scout | Elasticsearch |
|------|---------------|---------------------|---------------|---------------|
| 中文分词 | ngram 粗粒度，准确率低 | zhparser / pg_jieba 需插件 | 依赖数据库驱动或 Meili | ICU / ik / 自定义分词器，灵活度最高 |
| 查询延迟（10 万级） | 50~150ms | 20~80ms | 与数据库一致 | 5~30ms |
| 同义词支持 | 不支持 | 需手动维护词典 | 不支持 | synonym\_graph 原生支持 |
| 运维成本 | 无额外组件 | 无额外组件 | 低 | 需维护集群（JVM 堆、分片策略） |
| 推荐场景 | < 5 万记录、轻量搜索 | < 50 万、愿接受中等分词质量 | 快速原型 | > 10 万、需要精细分词与排序调优 |

**选型建议**：如果搜索是你的核心业务路径（电商、旅游、内容平台），直接上 ES；如果是后台管理系统的模糊查找，PostgreSQL tsvector 足够。

## 十一、Laravel 配置层封装：Elasticsearch Client 服务注册

在 Laravel 项目中接入 ES，推荐通过 Service Provider 封装，方便测试时 mock：

```php
<?php

namespace App\Providers;

use Elastic\Elasticsearch\Client;
use Elastic\Elasticsearch\ClientBuilder;
use Illuminate\Support\ServiceProvider;

final class ElasticsearchServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Client::class, function () {
            $builder = ClientBuilder::create()
                ->setHosts([config('services.elasticsearch.host')])
                ->setRetries(2);

            if (app()->environment('local', 'testing')) {
                $builder->setSSLVerification(false);
            }

            return $builder->build();
        });
    }
}
```

对应 `.env` 配置：

```env
ELASTICSEARCH_HOST=http://localhost:9200
```

`config/services.php` 中添加：

```php
'elasticsearch' => [
    'host' => env('ELASTICSEARCH_HOST', 'http://localhost:9200'),
],
```

## 十二、增量同步的幂等保障

队列任务可能被重试，所以同步 Job 必须幂等。ES 的 `index` API 本身就是 upsert 语义（相同 `_id` 会覆盖），但要注意**删除场景**：商品下架后如果只做增量更新而不标记删除，旧文档会残留在搜索结果里。我们最终的做法是：

```php
public function sync(int $productId): void
{
    $product = Product::find($productId);

    if (!$product || !$product->is_active) {
        // 软删除：从 ES 移除，而非物理删除 DB 记录
        $this->client->delete([
            'index' => 'products_read',
            'id'    => (string) $productId,
            'ignore' => [404],  // 不存在时不抛异常
        ]);
        return;
    }

    $this->client->index([
        'index' => 'products_read',
        'id'    => (string) $productId,
        'body'  => $this->mapToDocument($product),
    ]);
}
```

## 相关阅读

- [Laravel Full-Text Search 实战：数据库原生全文搜索与 Laravel Scout 深度对比](/categories/Laravel/PHP/laravel-full-text-search-database-native-vs-scout-comparison/)
- [Elasticsearch 全文搜索深度调优实战：Laravel 多字段映射、分词策略与高可用架构](/categories/PHP/laravel/elasticsearch-guide-laravel-high-availabilityarchitecture/)
- [Laravel + PostgreSQL 原生搜索实战：tsvector 排名、pg_trgm 纠错与高亮摘要](/categories/PHP/laravel/laravel-postgresql-guide-elasticsearch-tsvector-pg-trgm/)
