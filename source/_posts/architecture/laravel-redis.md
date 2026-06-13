---

title: 电商推荐系统设计实战：协同过滤、内容推荐、实时排序——Laravel + Redis + 向量数据库落地
date: 2026-06-02 00:00:00
tags:
- 推荐系统
- Laravel
- Redis
- 数据库
- 协同过滤
- 电商
description: 电商推荐系统从零到生产的完整实战，涵盖 User-Based 和 Item-Based 协同过滤算法的 Laravel/PHP 实现、基于商品属性的内容推荐与 OpenAI Embedding 语义向量生成、Qdrant 向量数据库集成与混合检索（关键词+向量 RRF 融合排序）、多路召回实时排序引擎设计。包含 Redis Pipeline 批量计算优化、LSH 粗筛解决全量用户遍历性能瓶颈、冷启动解决方案、推荐效果 CTR/CVR 监控告警，以及从全量遍历 10 分钟优化到 30 秒的性能调优经验，适合 Laravel 电商项目搭建推荐系统的完整技术参考。
categories:
  - architecture
keywords: [Laravel, Redis, 电商推荐系统设计实战, 协同过滤, 内容推荐, 实时排序, 向量数据库落地]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---



## 前言

在 B2C 电商场景中，推荐系统直接影响 GMV 和用户留存。一个成熟的推荐系统需要解决三个核心问题：**"用户喜欢什么"（协同过滤）**、**"商品是什么"（内容推荐）**、**"如何实时排序"（排序引擎）**。本文记录了在 Laravel 项目中从零搭建推荐系统的完整过程，包括踩过的坑、架构选型和生产环境的真实经验。

<!-- more -->

## 整体架构

推荐系统的核心架构分为四层：

```
┌─────────────────────────────────────────────┐
│              排序层 (Ranking)                 │
│    实时排序 → 业务规则 → 多路召回合并         │
├─────────────────────────────────────────────┤
│              召回层 (Recall)                  │
│  协同过滤 │ 内容推荐 │ 热门推荐 │ 向量召回    │
├─────────────────────────────────────────────┤
│              存储层 (Storage)                 │
│  Redis(实时) │ 向量DB(语义) │ MySQL(持久)    │
├─────────────────────────────────────────────┤
│              离线层 (Offline)                 │
│  特征工程 → 模型训练 → 索引构建               │
└─────────────────────────────────────────────┘
```

## 一、协同过滤：用户行为驱动的推荐

### 1.1 User-Based CF

核心思想：找到和目标用户行为相似的用户，推荐他们喜欢的商品。

```php
// app/Services/Recommendation/UserBasedCF.php
class UserBasedCF
{
    public function __construct(
        private Redis $redis
    ) {}

    // 计算两个用户的余弦相似度
    public function cosineSimilarity(int $userA, int $userB): float
    {
        $itemsA = $this->redis->smembers("user:{$userA}:interactions");
        $itemsB = $this->redis->smembers("user:{$userB}:interactions");

        $common = array_intersect($itemsA, $itemsB);
        if (empty($common)) return 0.0;

        // 用 Redis Sorted Set 存储评分
        $dotProduct = 0;
        $normA = 0;
        $normB = 0;

        foreach ($common as $itemId) {
            $scoreA = (float) $this->redis->zscore("user:{$userA}:ratings", $itemId);
            $scoreB = (float) $this->redis->zscore("user:{$userB}:ratings", $itemId);
            $dotProduct += $scoreA * $scoreB;
        }

        foreach ($itemsA as $itemId) {
            $s = (float) $this->redis->zscore("user:{$userA}:ratings", $itemId);
            $normA += $s * $s;
        }

        foreach ($itemsB as $itemId) {
            $s = (float) $this->redis->zscore("user:{$userB}:ratings", $itemId);
            $normB += $s * $s;
        }

        $denominator = sqrt($normA) * sqrt($normB);
        return $denominator > 0 ? $dotProduct / $denominator : 0.0;
    }

    // 获取 Top-N 相似用户
    public function getSimilarUsers(int $userId, int $limit = 50): array
    {
        $allUsers = $this->redis->smembers("active_users");
        $similarities = [];

        foreach ($allUsers as $otherId) {
            if ($otherId == $userId) continue;
            $sim = $this->cosineSimilarity($userId, (int) $otherId);
            if ($sim > 0.1) { // 阈值过滤
                $similarities[$otherId] = $sim;
            }
        }

        arsort($similarities);
        return array_slice($similarities, 0, $limit, true);
    }
}
```

**踩坑 1：全量用户遍历太慢。** 100 万用户两两计算根本跑不完。解决方案：先用 LSH（局部敏感哈希）做粗筛，把候选用户缩小到 1000 以内再精排。

### 1.2 Item-Based CF

Item-Based 在电商场景中比 User-Based 更实用，因为商品之间的关系比用户关系更稳定。

```php
// app/Services/Recommendation/ItemBasedCF.php
class ItemBasedCF
{
    // 预计算商品相似度矩阵（离线任务）
    public function buildItemSimilarityMatrix(): void
    {
        $items = Item::query()->where('status', 'active')->pluck('id');

        foreach ($items as $itemA) {
            $coUsers = $this->redis->smembers("item:{$itemA}:purchasers");

            foreach ($coUsers as $userId) {
                $purchasedItems = $this->redis->smembers("user:{$userId}:purchases");
                foreach ($purchasedItems as $itemB) {
                    if ($itemA == $itemB) continue;
                    // 共现次数累加
                    $this->redis->zincrby("item:{$itemA}:similar", 1, $itemB);
                }
            }

            // 归一化
            $maxScore = $this->redis->zrevrange("item:{$itemA}:similar", 0, 0, true);
            if ($maxScore) {
                $max = reset($maxScore);
                $members = $this->redis->zrange("item:{$itemA}:similar", 0, -1, true);
                foreach ($members as $member => $score) {
                    $this->redis->zadd("item:{$itemA}:similar_normalized", $score / $max, $member);
                }
            }
        }
    }

    // 实时召回：给用户推荐和已购商品相似的商品
    public function recommend(int $userId, int $limit = 20): array
    {
        $purchased = $this->redis->smembers("user:{$userId}:purchases");
        $candidates = [];

        foreach ($purchased as $itemId) {
            $similar = $this->redis->zrevrange("item:{$itemId}:similar_normalized", 0, 10, true);
            foreach ($similar as $candidateId => $score) {
                if (in_array($candidateId, $purchased)) continue;
                $candidates[$candidateId] = ($candidates[$candidateId] ?? 0) + $score;
            }
        }

        arsort($candidates);
        return array_keys(array_slice($candidates, 0, $limit, true));
    }
}
```

**踩坑 2：相似度矩阵的存储爆炸。** 10 万商品的全量相似度矩阵 = 10 亿条记录。解决方案：每个商品只保留 Top-100 相似商品，用 Redis Sorted Set 天然支持截断。

### 1.3 基于 Redis Pipeline 的批量计算优化

```php
public function batchGetSimilarItems(array $itemIds): array
{
    $pipeline = $this->redis->pipeline();

    foreach ($itemIds as $itemId) {
        $pipeline->zrevrange("item:{$itemId}:similar_normalized", 0, 10, true);
    }

    $results = $pipeline->exec();

    return array_combine($itemIds, $results);
}
```

## 二、内容推荐：基于商品属性的推荐

当用户行为数据稀疏时（冷启动），需要基于商品本身的属性做推荐。

### 2.1 特征提取

```php
// app/Services/Recommendation/ContentBasedRecommender.php
class ContentBasedRecommender
{
    public function extractFeatures(Item $item): array
    {
        return [
            'category_id' => $item->category_id,
            'brand_id' => $item->brand_id,
            'price_range' => $this->priceRange($item->price),
            'tags' => $item->tags->pluck('id')->toArray(),
            'attributes' => $item->attributes->pluck('value', 'key')->toArray(),
            // 文本特征
            'title_embedding' => $this->getTextEmbedding($item->title),
        ];
    }

    private function priceRange(float $price): string
    {
        return match (true) {
            $price < 50   => 'budget',
            $price < 200  => 'mid',
            $price < 1000 => 'premium',
            default        => 'luxury',
        };
    }

    private function getTextEmbedding(string $text): array
    {
        // 调用 OpenAI Embedding API
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . config('services.openai.key'),
        ])->post('https://api.openai.com/v1/embeddings', [
            'model' => 'text-embedding-3-small',
            'input' => $text,
        ]);

        return $response->json('data.0.embedding');
    }
}
```

**踩坑 3：Embedding API 调用成本。** 100 万商品全部生成 Embedding，API 费用不菲。解决方案：分批处理 + 缓存 + 只对新品增量更新。

### 2.2 特征相似度计算

```php
public function calculateSimilarity(array $featuresA, array $featuresB): float
{
    $score = 0;

    // 类目匹配
    if ($featuresA['category_id'] === $featuresB['category_id']) {
        $score += 0.3;
    }

    // 品牌匹配
    if ($featuresA['brand_id'] === $featuresB['brand_id']) {
        $score += 0.2;
    }

    // 价格区间匹配
    if ($featuresA['price_range'] === $featuresB['price_range']) {
        $score += 0.1;
    }

    // 标签 Jaccard 相似度
    $tagsA = collect($featuresA['tags']);
    $tagsB = collect($featuresB['tags']);
    $intersection = $tagsA->intersect($tagsB)->count();
    $union = $tagsA->merge($tagsB)->unique()->count();
    $score += ($union > 0 ? $intersection / $union : 0) * 0.15;

    // Embedding 余弦相似度
    if (!empty($featuresA['title_embedding']) && !empty($featuresB['title_embedding'])) {
        $score += $this->cosineSimilarity($featuresA['title_embedding'], $featuresB['title_embedding']) * 0.25;
    }

    return $score;
}
```

## 三、向量数据库：语义级召回

### 3.1 为什么需要向量数据库？

传统基于关键词的搜索无法理解语义。用户搜索"透气运动鞋"，向量数据库能召回"网面跑步鞋"，而 Elasticsearch 的 BM25 做不到这一点。

### 3.2 Qdrant 集成

```php
// app/Services/Recommendation/VectorRecall.php
class VectorRecall
{
    private string $baseUrl;

    public function __construct()
    {
        $this->baseUrl = config('services.qdrant.url') . ':6333';
    }

    // 创建集合
    public function createCollection(string $name, int $dimensions = 1536): void
    {
        Http::put("{$this->baseUrl}/collections/{$name}", [
            'vectors' => [
                'size' => $dimensions,
                'distance' => 'Cosine',
            ],
            'optimizers_config' => [
                'indexing_threshold' => 20000,
            ],
        ]);
    }

    // 插入商品向量
    public function upsertItem(int $itemId, array $embedding, array $payload = []): void
    {
        Http::put("{$this->baseUrl}/collections/items/points", [
            'points' => [[
                'id' => $itemId,
                'vector' => $embedding,
                'payload' => $payload,
            ]],
        ]);
    }

    // 向量检索
    public function search(array $queryEmbedding, int $limit = 20, array $filter = []): array
    {
        $body = [
            'vector' => $queryEmbedding,
            'limit' => $limit,
            'with_payload' => true,
            'with_vector' => false,
        ];

        if (!empty($filter)) {
            $body['filter'] = [
                'must' => array_map(fn($key, $value) => [
                    'key' => $key,
                    'match' => ['value' => $value],
                ], array_keys($filter), $filter),
            ];
        }

        $response = Http::post("{$this->baseUrl}/collections/items/points/search", $body);
        return $response->json('result', []);
    }
}
```

**踩坑 4：Qdrant 的内存占用。** 100 万条 1536 维向量 ≈ 6GB 内存。解决方案：开启 mmap 模式，把索引放磁盘，只把热门数据放内存。

### 3.3 混合检索：关键词 + 向量

```php
public function hybridSearch(string $query, int $userId, int $limit = 20): array
{
    // 1. 关键词检索（ES）
    $keywordResults = $this->elasticsearch->search($query, $limit * 2);

    // 2. 向量检索（Qdrant）
    $embedding = $this->getTextEmbedding($query);
    $vectorResults = $this->vectorRecall->search($embedding, $limit * 2);

    // 3. RRF (Reciprocal Rank Fusion) 融合排序
    $scores = [];
    $k = 60; // RRF 常数

    foreach ($keywordResults as $rank => $item) {
        $itemId = $item['id'];
        $scores[$itemId] = ($scores[$itemId] ?? 0) + 1.0 / ($k + $rank + 1);
    }

    foreach ($vectorResults as $rank => $item) {
        $itemId = $item['id'];
        $scores[$itemId] = ($scores[$itemId] ?? 0) + 1.0 / ($k + $rank + 1);
    }

    arsort($scores);
    return array_keys(array_slice($scores, 0, $limit, true));
}
```

## 四、实时排序引擎

### 4.1 多路召回合并

```php
// app/Services/Recommendation/RankingEngine.php
class RankingEngine
{
    private array $recallSources = [];

    public function addRecallSource(string $name, callable $source, float $weight): void
    {
        $this->recallSources[] = compact('name', 'source', 'weight');
    }

    public function rank(int $userId, int $limit = 50): array
    {
        // 1. 多路召回
        $candidates = [];
        foreach ($this->recallSources as $source) {
            $items = ($source['source'])($userId, $limit * 3);
            foreach ($items as $index => $itemId) {
                $candidates[$itemId] = ($candidates[$itemId] ?? 0)
                    + $source['weight'] * (1.0 / ($index + 1));
            }
        }

        // 2. 过滤已购/已曝光
        $purchased = $this->redis->smembers("user:{$userId}:purchases");
        $seen = $this->redis->smembers("user:{$userId}:recent_exposed");
        $exclude = array_merge($purchased, $seen);

        foreach ($exclude as $itemId) {
            unset($candidates[$itemId]);
        }

        // 3. 精排（计算特征分数）
        $scored = [];
        foreach ($candidates as $itemId => $recallScore) {
            $features = $this->extractRankingFeatures($userId, $itemId);
            $score = $this->calculateFinalScore($features);
            $scored[$itemId] = $recallScore * 0.3 + $score * 0.7;
        }

        arsort($scored);
        $result = array_keys(array_slice($scored, 0, $limit, true));

        // 4. 记录曝光
        $this->redis->pipeline(function ($pipe) use ($userId, $result) {
            foreach ($result as $itemId) {
                $pipe->sadd("user:{$userId}:recent_exposed", $itemId);
            }
            $pipe->expire("user:{$userId}:recent_exposed", 86400 * 7);
        });

        return $result;
    }

    private function extractRankingFeatures(int $userId, int $itemId): array
    {
        return [
            'user_ctr' => $this->getUserCTR($userId, $itemId),
            'item_quality_score' => $this->getItemQuality($itemId),
            'freshness' => $this->getFreshness($itemId),
            'diversity_penalty' => $this->getDiversityPenalty($userId, $itemId),
        ];
    }
}
```

### 4.2 排序服务的 Laravel 注册

```php
// app/Providers/RecommendationServiceProvider.php
class RecommendationServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(RankingEngine::class, function () {
            $engine = new RankingEngine(
                redis: Redis::connection('recommendation')->client()
            );

            // 注册召回源
            $engine->addRecallSource('item_cf', fn($uid, $n) =>
                app(ItemBasedCF::class)->recommend($uid, $n), 0.4
            );

            $engine->addRecallSource('vector', function ($uid, $n) {
                $userProfile = app(UserProfileService::class)->getEmbedding($uid);
                return array_column(
                    app(VectorRecall::class)->search($userProfile, $n), 'id'
                );
            }, 0.3);

            $engine->addRecallSource('hot', fn($uid, $n) =>
                app(HotItemService::class)->getTop($n), 0.2
            );

            $engine->addRecallSource('content', fn($uid, $n) =>
                app(ContentBasedRecommender::class)->recommend($uid, $n), 0.1
            );

            return $engine;
        });
    }
}
```

## 五、用户行为采集管道

### 5.1 行为事件上报

```php
// app/Events/UserBehaviorEvent.php
class UserBehaviorEvent
{
    public function __construct(
        public readonly int $userId,
        public readonly string $action,  // view, click, cart, purchase, search
        public readonly int $itemId,
        public readonly array $context = [],
    ) {}
}

// app/Listeners/RecordBehavior.php
class RecordBehavior
{
    public function handle(UserBehaviorEvent $event): void
    {
        $redis = Redis::connection('recommendation');

        // 实时记录到 Redis
        $score = match ($event->action) {
            'view' => 1,
            'click' => 3,
            'cart' => 5,
            'purchase' => 10,
            default => 1,
        };

        $redis->pipeline(function ($pipe) use ($event, $score) {
            $userId = $event->userId;
            $itemId = $event->itemId;

            // 用户交互集合
            $pipe->sadd("user:{$userId}:interactions", $itemId);
            // 用户评分（加权）
            $pipe->zincrby("user:{$userId}:ratings", $score, $itemId);
            // 购买集合
            if ($event->action === 'purchase') {
                $pipe->sadd("user:{$userId}:purchases", $itemId);
                $pipe->sadd("item:{$itemId}:purchasers", $userId);
            }
            // 活跃用户集合
            $pipe->sadd("active_users", $userId);
            // 商品热度
            $pipe->zincrby("global:hot_items", 1, $itemId);
        });

        // 异步写入行为日志（用于离线分析）
        BehaviorLog::create([
            'user_id' => $event->userId,
            'action' => $event->action,
            'item_id' => $event->itemId,
            'context' => $event->context,
            'created_at' => now(),
        ]);
    }
}
```

### 5.2 离线任务调度

```php
// app/Jobs/BuildRecommendationIndexJob.php
class BuildRecommendationIndexJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(): void
    {
        // 1. 构建 Item-Based 相似度矩阵
        app(ItemBasedCF::class)->buildItemSimilarityMatrix();

        // 2. 增量更新向量索引
        $newItems = Item::where('vector_indexed', false)->limit(1000)->get();
        foreach ($newItems as $item) {
            $embedding = app(ContentBasedRecommender::class)
                ->extractFeatures($item)['title_embedding'];
            app(VectorRecall::class)->upsertItem(
                $item->id,
                $embedding,
                ['category_id' => $item->category_id, 'brand_id' => $item->brand_id]
            );
            $item->update(['vector_indexed' => true]);
        }

        // 3. 重建热门商品榜
        $hotItems = app(ItemInteractionCounter::class)->getHotItems(1000);
        Redis::connection('recommendation')->del('global:hot_items_ranked');
        foreach ($hotItems as $itemId => $score) {
            Redis::connection('recommendation')
                ->zadd('global:hot_items_ranked', $score, $itemId);
        }
    }
}

// Kernel.php
$schedule->job(new BuildRecommendationIndexJob)->dailyAt('03:00');
```

## 六、API 层集成

```php
// app/Http/Controllers/RecommendationController.php
class RecommendationController extends Controller
{
    public function homepage(RankingEngine $engine): JsonResponse
    {
        $userId = auth()->id();
        $cacheKey = "recommendation:homepage:{$userId}";

        // 结果缓存 5 分钟
        $itemIds = Cache::remember($cacheKey, 300, function () use ($engine, $userId) {
            return $engine->rank($userId, 50);
        });

        $items = Item::with(['category', 'brand', 'images'])
            ->whereIn('id', $itemIds)
            ->get()
            ->sortBy(fn($item) => array_search($item->id, $itemIds))
            ->values();

        return response()->json([
            'items' => ItemResource::collection($items),
            'request_id' => Str::uuid(),
        ]);
    }

    // "猜你喜欢" —— 基于当前浏览商品
    public function similar(int $itemId, VectorRecall $vectorRecall): JsonResponse
    {
        $item = Item::findOrFail($itemId);
        $embedding = $item->vector_embedding;

        if (empty($embedding)) {
            // fallback to item-based CF
            $itemIds = app(ItemBasedCF::class)->recommend(auth()->id(), 10);
        } else {
            $results = $vectorRecall->search($embedding, 10, [
                'category_id' => $item->category_id,
            ]);
            $itemIds = array_column($results, 'id');
        }

        return response()->json([
            'items' => ItemResource::collection(
                Item::whereIn('id', $itemIds)->get()
            ),
        ]);
    }
}
```

**踩坑 5：缓存一致性问题。** 商品下架后推荐结果中仍然出现。解决方案：在返回结果前做二次校验，过滤掉 `status != active` 的商品。

## 七、性能优化总结

| 优化点 | 优化前 | 优化后 |
|-------|-------|-------|
| 协同过滤计算 | 全量遍历 10min | LSH 粗筛 + 精排 30s |
| 相似度矩阵 | 全量存储 50GB | Top-100 截断 2GB |
| 向量检索 | 暴力搜索 O(n) | HNSW 索引 O(log n) |
| 推荐结果 | 每次实时计算 | Redis 缓存 5min |
| 行为采集 | 同步写 DB | Redis 异步 + 队列落库 |

## 八、监控与告警

```php
// 监控推荐效果
class RecommendationMetrics
{
    public function calculateCTR(string $date): float
    {
        $exposed = BehaviorLog::whereDate('created_at', $date)
            ->where('action', 'impression')
            ->where('context->source', 'recommendation')
            ->count();

        $clicked = BehaviorLog::whereDate('created_at', $date)
            ->where('action', 'click')
            ->where('context->source', 'recommendation')
            ->count();

        return $exposed > 0 ? $clicked / $exposed : 0;
    }

    public function calculateCVR(string $date): float
    {
        $clicked = BehaviorLog::whereDate('created_at', $date)
            ->where('action', 'click')
            ->where('context->source', 'recommendation')
            ->count();

        $purchased = BehaviorLog::whereDate('created_at', $date)
            ->where('action', 'purchase')
            ->where('context->source', 'recommendation')
            ->count();

        return $clicked > 0 ? $purchased / $clicked : 0;
    }
}
```

## 总结

推荐系统的核心挑战不在于算法有多复杂，而在于工程落地的细节：

1. **冷启动阶段**：先用热门推荐 + 内容推荐兜底，行为数据积累后再切换到协同过滤
2. **实时性要求**：Redis 存储实时特征，向量数据库做语义召回，离线任务预计算相似度矩阵
3. **成本控制**：Embedding API 按需调用，向量索引增量更新，推荐结果合理缓存
4. **效果评估**：CTR/CVR 是核心指标，A/B 测试是上线新策略的必经之路

一个能跑起来的推荐系统 MVP 只需要 Redis + Laravel，不要一开始就上 Spark/Flink——先用简单方案验证业务价值，再根据数据规模逐步升级架构。

## 相关阅读

- [Go + gRPC 实战：高性能微服务间通信——Proto 定义、流式调用与 Laravel 集成](/categories/架构/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/)
- [CDN 配置实战：静态资源加速与缓存失效策略](/categories/架构/CDN-配置实战-静态资源加速与缓存失效策略-Laravel-B2C-API踩坑记录/)
- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/)
