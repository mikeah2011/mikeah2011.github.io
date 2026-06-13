---
title: Laravel 搜索降级策略实战：Elasticsearch 不可用时自动回退数据库 LIKE/Full-Text
keywords: [Laravel, Elasticsearch, LIKE, Full, Text, 搜索降级策略实战, 不可用时自动回退数据库, 架构]
date: 2026-06-10 02:21:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Elasticsearch
  - 搜索降级
  - 高可用
  - MySQL Full-Text
description: 当 Elasticsearch 集群宕机或响应超时时，搜索服务不能直接报错给用户。本文实战演示三层搜索防线的完整设计：ES → MySQL Full-Text → LIKE 模糊查询，含健康检测、自动切换、手动兜底的完整实现。
---


## 前言

线上搜索服务最怕什么？不是搜索结果不够精准，而是用户一搜就报错。

Elasticsearch 虽然强大，但它也是有状态的分布式系统——网络抖动、节点 GC、磁盘满、索引损坏，任何一环出问题都可能导致 ES 不可用。如果你的应用完全依赖 ES 做搜索，ES 一挂，搜索功能就彻底瘫痪。

本文的目标很明确：**设计一套三层搜索降级机制**，确保在任何情况下用户都能拿到搜索结果。

```
ES 正常          → ES 精确搜索（第一层）
ES 不可用        → MySQL Full-Text（第二层）
Full-Text 也不行  → LIKE 模糊查询（第三层）
```

## 一、整体架构设计

### 1.1 为什么需要三层？

| 层级 | 方案 | 优点 | 缺点 |
|------|------|------|------|
| 第一层 | Elasticsearch | 全文检索、分词、相关性排序、聚合 | 依赖外部服务，运维成本高 |
| 第二层 | MySQL Full-Text | 不依赖外部服务，支持中文分词（ngram） | 性能一般，功能有限 |
| 第三层 | LIKE 模糊查询 | 零依赖，最原始但最可靠 | 全表扫描风险，大数据量下性能差 |

关键认知：**第三层不是给正常情况用的，它是最后的保底线。** 用户搜不到精准结果，总比看到 500 错误页强。

### 1.2 核心流程

```
用户请求搜索
    │
    ▼
┌─────────────┐    健康？    ┌─────────────┐
│  ES 搜索    │──────────→│  返回结果    │
└─────────────┘    是       └─────────────┘
    │ 否
    ▼
┌─────────────┐    健康？    ┌─────────────┐
│ MySQL FT   │──────────→│  返回结果    │
└─────────────┘    是       └─────────────┘
    │ 否
    ▼
┌─────────────┐             ┌─────────────┐
│ LIKE 查询   │────────────→│  返回结果    │
└─────────────┘             └─────────────┘
```

## 二、Elasticsearch 健康检测

降级的前提是知道 ES 什么时候不可用。不能每次都发一个请求去试——那太慢了。我们需要一个轻量级的健康检测器。

### 2.1 基于缓存的健康状态管理

```php
<?php

namespace App\Services\Search;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class ElasticsearchHealthChecker
{
    // 缓存 key
    private const CACHE_KEY = 'es:health:status';
    private const FAILURE_COUNT_KEY = 'es:health:failure_count';
    
    // 配置
    private int $failureThreshold = 3;      // 连续失败 N 次标记为不健康
    private int $recoveryTimeout = 60;      // 标记不健康后 N 秒尝试恢复
    private int $healthCheckTimeout = 2;    // 健康检测超时秒数

    public function __construct(
        private \Elastic\Elasticsearch\Client $client
    ) {}

    /**
     * ES 是否可用
     */
    public function isHealthy(): bool
    {
        $status = Cache::get(self::CACHE_KEY, 'healthy');
        
        if ($status === 'unhealthy') {
            // 检查是否到了恢复探测时间
            $unhealthySince = Cache::get('es:health:unhealthy_since', 0);
            if (time() - $unhealthySince >= $this->recoveryTimeout) {
                return $this->probeRecovery();
            }
            return false;
        }
        
        return true;
    }

    /**
     * 记录一次请求成功
     */
    public function recordSuccess(): void
    {
        Cache::forget(self::FAILURE_COUNT_KEY);
        Cache::forever(self::CACHE_KEY, 'healthy');
        Cache::forget('es:health:unhealthy_since');
    }

    /**
     * 记录一次请求失败
     */
    public function recordFailure(\Throwable $e): void
    {
        $count = Cache::increment(self::FAILURE_COUNT_KEY);
        
        Log::warning('ES 请求失败', [
            'count' => $count,
            'threshold' => $this->failureThreshold,
            'error' => $e->getMessage(),
        ]);

        if ($count >= $this->failureThreshold) {
            Cache::forever(self::CACHE_KEY, 'unhealthy');
            Cache::forever('es:health:unhealthy_since', time());
            
            Log::error('ES 已标记为不健康，触发降级', [
                'failure_count' => $count,
            ]);
        }
    }

    /**
     * 恢复探测：发一个轻量请求测试 ES 是否恢复
     */
    private function probeRecovery(): bool
    {
        try {
            $response = $this->client->ping();
            if ($response) {
                $this->recordSuccess();
                Log::info('ES 已恢复健康');
                return true;
            }
        } catch (\Throwable $e) {
            Log::info('ES 恢复探测失败', ['error' => $e->getMessage()]);
        }

        // 仍未恢复，重置时间戳，下次再试
        Cache::forever('es:health:unhealthy_since', time());
        return false;
    }

    /**
     * 强制标记为不健康（手动降级用）
     */
    public function forceUnhealthy(): void
    {
        Cache::forever(self::CACHE_KEY, 'unhealthy');
        Cache::forever('es:health:unhealthy_since', time());
        Log::warning('ES 已被手动标记为不健康');
    }

    /**
     * 强制恢复（手动恢复用）
     */
    public function forceHealthy(): void
    {
        $this->recordSuccess();
        Log::info('ES 已被手动恢复为健康状态');
    }
}
```

### 2.2 注册到服务容器

```php
// app/Providers/AppServiceProvider.php
public function register(): void
{
    $this->app->singleton(ElasticsearchHealthChecker::class, function ($app) {
        return new ElasticsearchHealthChecker(
            $app->make(\Elastic\Elasticsearch\Client::class)
        );
    });
}
```

## 三、三层搜索引擎实现

### 3.1 定义搜索引擎接口

先把搜索引擎的行为抽象出来，每一层实现同一个接口：

```php
<?php

namespace App\Services\Search\Engines;

use Illuminate\Support\Collection;

interface SearchEngine
{
    /**
     * 执行搜索
     *
     * @param string $keyword 搜索关键词
     * @param array  $filters 筛选条件
     * @param int    $page    页码
     * @param int    $perPage 每页数量
     * @return array{items: Collection, total: int, engine: string}
     */
    public function search(string $keyword, array $filters = [], int $page = 1, int $perPage = 20): array;

    /**
     * 引擎名称
     */
    public function name(): string;
}
```

### 3.2 第一层：Elasticsearch 引擎

```php
<?php

namespace App\Services\Search\Engines;

use App\Services\Search\ElasticsearchHealthChecker;
use Elastic\Elasticsearch\Client;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

class ElasticsearchEngine implements SearchEngine
{
    private const INDEX = 'products';

    public function __construct(
        private Client $client,
        private ElasticsearchHealthChecker $healthChecker,
    ) {}

    public function search(string $keyword, array $filters = [], int $page = 1, int $perPage = 20): array
    {
        if (!$this->healthChecker->isHealthy()) {
            throw new \RuntimeException('ES 不可用，触发降级');
        }

        $body = [
            'from' => ($page - 1) * $perPage,
            'size' => $perPage,
            'query' => [
                'bool' => [
                    'must' => [
                        [
                            'multi_match' => [
                                'query' => $keyword,
                                'fields' => ['title^3', 'description^2', 'content', 'tags'],
                                'type' => 'best_fields',
                                'fuzziness' => 'AUTO',
                            ],
                        ],
                    ],
                    'filter' => $this->buildFilters($filters),
                ],
            ],
            'highlight' => [
                'fields' => [
                    'title' => ['number_of_fragments' => 0],
                    'description' => ['fragment_size' => 150],
                ],
            ],
            'sort' => [
                '_score',
                ['created_at' => 'desc'],
            ],
        ];

        try {
            $response = $this->client->search([
                'index' => self::INDEX,
                'body' => $body,
            ]);

            $this->healthChecker->recordSuccess();

            $items = collect($response['hits']['hits'])->map(function ($hit) {
                return [
                    'id' => $hit['_id'],
                    'score' => $hit['_score'],
                    'highlight' => $hit['highlight'] ?? [],
                    ...$hit['_source'],
                ];
            });

            return [
                'items' => $items,
                'total' => $response['hits']['total']['value'] ?? 0,
                'engine' => 'elasticsearch',
            ];
        } catch (\Throwable $e) {
            $this->healthChecker->recordFailure($e);
            throw $e;
        }
    }

    private function buildFilters(array $filters): array
    {
        $clauses = [];

        if (!empty($filters['category'])) {
            $clauses[] = ['term' => ['category' => $filters['category']]];
        }

        if (!empty($filters['status'])) {
            $clauses[] = ['term' => ['status' => $filters['status']]];
        }

        if (!empty($filters['date_from'])) {
            $clauses[] = ['range' => ['created_at' => ['gte' => $filters['date_from']]]];
        }

        return $clauses;
    }

    public function name(): string
    {
        return 'elasticsearch';
    }
}
```

### 3.3 第二层：MySQL Full-Text 引擎

MySQL Full-Text Search 是被低估的方案。从 5.7 开始，InnoDB 支持 Full-Text 索引，配合 ngram 解析器可以处理中文。

先确保数据库表有 Full-Text 索引：

```sql
-- 给 products 表添加 Full-Text 索引
ALTER TABLE products 
ADD FULLTEXT INDEX ft_products_search (title, description, content) 
WITH PARSER ngram;

-- ngram token size 默认是 2，可在 my.cnf 调整
-- [mysqld]
-- ngram_token_size=2
```

PHP 实现：

```php
<?php

namespace App\Services\Search\Engines;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class MySQLFullTextEngine implements SearchEngine
{
    public function search(string $keyword, array $filters = [], int $page = 1, int $perPage = 20): array
    {
        $query = DB::table('products')
            ->selectRaw("
                *,
                MATCH(title, description, content) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance
            ", [$keyword])
            ->whereRaw("
                MATCH(title, description, content) AGAINST(? IN NATURAL LANGUAGE MODE)
            ", [$keyword]);

        // 应用筛选
        if (!empty($filters['category'])) {
            $query->where('category', $filters['category']);
        }

        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        if (!empty($filters['date_from'])) {
            $query->where('created_at', '>=', $filters['date_from']);
        }

        // 总数
        $total = (clone $query)->count();

        // 分页，按相关性排序
        $items = $query
            ->orderByDesc('relevance')
            ->orderByDesc('created_at')
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get();

        Log::info('MySQL Full-Text 搜索', [
            'keyword' => $keyword,
            'total' => $total,
            'engine' => 'mysql_fulltext',
        ]);

        return [
            'items' => $items,
            'total' => $total,
            'engine' => 'mysql_fulltext',
        ];
    }

    public function name(): string
    {
        return 'mysql_fulltext';
    }
}
```

### 3.4 第三层：LIKE 模糊查询引擎

最后一道防线。简单粗暴，但绝对可靠。

```php
<?php

namespace App\Services\Search\Engines;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class LikeFallbackEngine implements SearchEngine
{
    public function search(string $keyword, array $filters = [], int $page = 1, int $perPage = 20): array
    {
        $query = DB::table('products')
            ->where(function ($q) use ($keyword) {
                $q->where('title', 'LIKE', "%{$keyword}%")
                  ->orWhere('description', 'LIKE', "%{$keyword}%")
                  ->orWhere('content', 'LIKE', "%{$keyword}%");
            });

        if (!empty($filters['category'])) {
            $query->where('category', $filters['category']);
        }

        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        if (!empty($filters['date_from'])) {
            $query->where('created_at', '>=', $filters['date_from']);
        }

        $total = (clone $query)->count();

        $items = $query
            ->orderByDesc('created_at')
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get();

        Log::warning('LIKE 降级搜索已触发', [
            'keyword' => $keyword,
            'total' => $total,
            'engine' => 'like_fallback',
        ]);

        return [
            'items' => $items,
            'total' => $total,
            'engine' => 'like_fallback',
        ];
    }

    public function name(): string
    {
        return 'like_fallback';
    }
}
```

### 3.5 搜索编排器：串联三层

核心编排逻辑，负责按优先级依次尝试每一层：

```php
<?php

namespace App\Services\Search;

use App\Services\Search\Engines\SearchEngine;
use Illuminate\Support\Facades\Log;

class SearchOrchestrator
{
    /**
     * @param SearchEngine[] $engines 按优先级排列的搜索引擎
     */
    public function __construct(
        private array $engines,
        private ElasticsearchHealthChecker $healthChecker,
    ) {}

    /**
     * 执行搜索，自动降级
     *
     * @return array{items: mixed, total: int, engine: string, degraded: bool}
     */
    public function search(string $keyword, array $filters = [], int $page = 1, int $perPage = 20): array
    {
        $lastException = null;

        foreach ($this->engines as $engine) {
            try {
                $result = $engine->search($keyword, $filters, $page, $perPage);
                
                $result['degraded'] = $engine->name() !== 'elasticsearch';
                
                if ($result['degraded']) {
                    Log::warning('搜索已降级', [
                        'engine' => $engine->name(),
                        'keyword' => $keyword,
                    ]);
                }

                return $result;
            } catch (\Throwable $e) {
                $lastException = $e;
                Log::warning("搜索引擎 {$engine->name()} 失败，尝试下一层", [
                    'error' => $e->getMessage(),
                ]);
                continue;
            }
        }

        // 所有引擎都失败了（理论上 LIKE 不会失败，除非数据库也挂了）
        Log::error('所有搜索引擎均不可用', [
            'keyword' => $keyword,
            'last_error' => $lastException?->getMessage(),
        ]);

        return [
            'items' => collect(),
            'total' => 0,
            'engine' => 'none',
            'degraded' => true,
        ];
    }

    /**
     * 手动降级到指定引擎
     */
    public function searchWith(string $engineName, string $keyword, array $filters = [], int $page = 1, int $perPage = 20): array
    {
        foreach ($this->engines as $engine) {
            if ($engine->name() === $engineName) {
                return $engine->search($keyword, $filters, $page, $perPage);
            }
        }

        throw new \InvalidArgumentException("未知的搜索引擎: {$engineName}");
    }
}
```

### 3.6 服务注册

```php
// app/Providers/AppServiceProvider.php
use App\Services\Search\Engines\ElasticsearchEngine;
use App\Services\Search\Engines\LikeFallbackEngine;
use App\Services\Search\Engines\MySQLFullTextEngine;
use App\Services\Search\SearchOrchestrator;

public function register(): void
{
    // ES 健康检测
    $this->app->singleton(ElasticsearchHealthChecker::class, function ($app) {
        return new ElasticsearchHealthChecker(
            $app->make(\Elastic\Elasticsearch\Client::class)
        );
    });

    // 搜索引擎
    $this->app->bind(ElasticsearchEngine::class, function ($app) {
        return new ElasticsearchEngine(
            $app->make(\Elastic\Elasticsearch\Client::class),
            $app->make(ElasticsearchHealthChecker::class),
        );
    });

    // 搜索编排器：按优先级注册三层引擎
    $this->app->singleton(SearchOrchestrator::class, function ($app) {
        return new SearchOrchestrator(
            engines: [
                $app->make(ElasticsearchEngine::class),      // 第一层
                $app->make(MySQLFullTextEngine::class),      // 第二层
                $app->make(LikeFallbackEngine::class),       // 第三层
            ],
            healthChecker: $app->make(ElasticsearchHealthChecker::class),
        );
    });
}
```

## 四、Controller 层调用

```php
<?php

namespace App\Http\Controllers;

use App\Services\Search\SearchOrchestrator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SearchController extends Controller
{
    public function __construct(
        private SearchOrchestrator $orchestrator,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'keyword' => 'required|string|min:1|max:100',
            'category' => 'nullable|string',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:50',
        ]);

        $result = $this->orchestrator->search(
            keyword: $validated['keyword'],
            filters: array_filter([
                'category' => $validated['category'] ?? null,
            ]),
            page: $validated['page'] ?? 1,
            perPage: $validated['per_page'] ?? 20,
        );

        return response()->json([
            'data' => $result['items'],
            'total' => $result['total'],
            'meta' => [
                'engine' => $result['engine'],
                'degraded' => $result['degraded'],
            ],
        ]);
    }
}
```

返回示例（降级状态）：

```json
{
    "data": [...],
    "total": 42,
    "meta": {
        "engine": "mysql_fulltext",
        "degraded": true
    }
}
```

前端拿到 `degraded: true` 可以展示一个提示条："搜索结果可能不够精确，服务正在恢复中"。

## 五、监控与告警

降级不能默默发生，你需要知道。

### 5.1 定义告警通知

```php
<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\SlackMessage;
use Illuminate\Notifications\Notification;

class SearchDegradedNotification extends Notification
{
    use Queueable;

    public function __construct(
        private string $engine,
        private string $reason,
    ) {}

    public function via($notifiable): array
    {
        return ['slack']; // 或者 feishu、dingtalk
    }

    public function toSlack($notifiable): SlackMessage
    {
        return (new SlackMessage)
            ->error()
            ->content("⚠️ 搜索服务已降级")
            ->field([
                'Engine' => $this->engine,
                'Reason' => $this->reason,
                'Time' => now()->toDateTimeString(),
            ]);
    }
}
```

### 5.2 Artisan 命令：手动管理降级

```php
<?php

namespace App\Console\Commands;

use App\Services\Search\ElasticsearchHealthChecker;
use Illuminate\Console\Command;

class SearchHealthCommand extends Command
{
    protected $signature = 'search:health 
                            {--force-unhealthy : 强制标记 ES 不可用} 
                            {--force-healthy : 强制恢复 ES} 
                            {--status : 查看当前状态}';

    protected $description = '管理搜索引擎健康状态';

    public function handle(ElasticsearchHealthChecker $checker): int
    {
        if ($this->option('status')) {
            $healthy = $checker->isHealthy();
            $this->info("ES 状态: " . ($healthy ? '✅ 健康' : '❌ 不健康'));
            return self::SUCCESS;
        }

        if ($this->option('force-unhealthy')) {
            $checker->forceUnhealthy();
            $this->warn('ES 已手动标记为不健康');
            return self::SUCCESS;
        }

        if ($this->option('force-healthy')) {
            $checker->forceHealthy();
            $this->info('ES 已手动恢复为健康');
            return self::SUCCESS;
        }

        $this->line('用法:');
        $this->line('  php artisan search:health --status');
        $this->line('  php artisan search:health --force-unhealthy');
        $this->line('  php artisan search:health --force-healthy');

        return self::SUCCESS;
    }
}
```

## 六、踩坑记录

### 6.1 MySQL Full-Text 的中文分词坑

MySQL 默认的 Full-Text 解析器不支持中文。必须用 `ngram` 解析器，但要注意：

- `ngram_token_size` 默认是 2，意味着"搜索引擎"会被拆成"搜索""索引""引擎"
- 搜索单个字（如"搜"）可能匹配不到结果，因为索引里存的是双字组合
- 建议在 `my.cnf` 里设置 `ngram_token_size=2`，并确保建索引时指定了 `WITH PARSER ngram`

```sql
-- 检查当前 ngram 设置
SHOW VARIABLES LIKE 'ngram_token_size';

-- 如果索引建错了，删掉重建
ALTER TABLE products DROP INDEX ft_products_search;
ALTER TABLE products ADD FULLTEXT INDEX ft_products_search (title, description, content) WITH PARSER ngram;
```

### 6.2 LIKE 查询的性能陷阱

LIKE '%keyword%' 无法使用索引，会全表扫描。作为第三层兜底方案，这是可以接受的，但要注意：

- 加上 `LIMIT`，不要一次查太多
- 如果表数据量超过 100 万，考虑给 LIKE 查询加一个超时
- 可以用 `DB::statement('SET SESSION max_execution_time = 3000')` 限制单条查询最长 3 秒

```php
// LikeFallbackEngine 里加上查询超时保护
public function search(string $keyword, array $filters = [], int $page = 1, int $perPage = 20): array
{
    // 设置查询超时 3 秒
    DB::statement('SET SESSION max_execution_time = 3000');
    
    // ... 原有逻辑
}
```

### 6.3 ES 客户端超时配置

ES 客户端本身的超时也要配好，不然健康检测和实际查询都要等很久才触发降级：

```php
// config/elasticsearch.php
return [
    'hosts' => [
        env('ELASTICSEARCH_HOST', 'localhost:9200'),
    ],
    'client' => [
        'connect_timeout' => 3,    // 连接超时 3 秒
        'timeout' => 5,            // 请求超时 5 秒
        'retries' => 1,            // 失败重试 1 次
    ],
];
```

### 6.4 降级状态下的缓存策略

ES 不可用时，MySQL 的查询压力会增大。建议在降级状态下开启查询缓存：

```php
// SearchOrchestrator 里
public function search(string $keyword, array $filters = [], int $page = 1, int $perPage = 20): array
{
    $cacheKey = 'search:' . md5($keyword . serialize($filters) . $page . $perPage);
    
    // 降级状态下缓存结果，减轻 DB 压力
    if (!$this->healthChecker->isHealthy()) {
        return Cache::remember($cacheKey, 300, function () use ($keyword, $filters, $page, $perPage) {
            return $this->executeSearch($keyword, $filters, $page, $perPage);
        });
    }
    
    return $this->executeSearch($keyword, $filters, $page, $perPage);
}
```

## 七、测试

### 7.1 单元测试

```php
<?php

namespace Tests\Unit\Services\Search;

use App\Services\Search\ElasticsearchHealthChecker;
use App\Services\Search\Engines\ElasticsearchEngine;
use App\Services\Search\Engines\LikeFallbackEngine;
use App\Services\Search\Engines\MySQLFullTextEngine;
use App\Services\Search\SearchOrchestrator;
use Illuminate\Support\Facades\Cache;
use Mockery;
use Tests\TestCase;

class SearchOrchestratorTest extends TestCase
{
    public function test_正常情况走_es(): void
    {
        $esEngine = Mockery::mock(ElasticsearchEngine::class);
        $esEngine->shouldReceive('name')->andReturn('elasticsearch');
        $esEngine->shouldReceive('search')->andReturn([
            'items' => collect([['id' => 1]]),
            'total' => 1,
            'engine' => 'elasticsearch',
        ]);

        $orchestrator = new SearchOrchestrator(
            engines: [$esEngine, Mockery::mock(MySQLFullTextEngine::class), Mockery::mock(LikeFallbackEngine::class)],
            healthChecker: Mockery::mock(ElasticsearchHealthChecker::class),
        );

        $result = $orchestrator->search('test');
        $this->assertEquals('elasticsearch', $result['engine']);
        $this->assertFalse($result['degraded']);
    }

    public function test_es_失败降级到_mysql(): void
    {
        $esEngine = Mockery::mock(ElasticsearchEngine::class);
        $esEngine->shouldReceive('name')->andReturn('elasticsearch');
        $esEngine->shouldReceive('search')->andThrow(new \RuntimeException('ES 不可用'));

        $mysqlEngine = Mockery::mock(MySQLFullTextEngine::class);
        $mysqlEngine->shouldReceive('name')->andReturn('mysql_fulltext');
        $mysqlEngine->shouldReceive('search')->andReturn([
            'items' => collect([['id' => 1]]),
            'total' => 1,
            'engine' => 'mysql_fulltext',
        ]);

        $orchestrator = new SearchOrchestrator(
            engines: [$esEngine, $mysqlEngine, Mockery::mock(LikeFallbackEngine::class)],
            healthChecker: Mockery::mock(ElasticsearchHealthChecker::class),
        );

        $result = $orchestrator->search('test');
        $this->assertEquals('mysql_fulltext', $result['engine']);
        $this->assertTrue($result['degraded']);
    }
}
```

### 7.2 手动测试降级流程

```bash
# 1. 查看 ES 状态
php artisan search:health --status

# 2. 手动触发降级
php artisan search:health --force-unhealthy

# 3. 测试搜索（应该走 MySQL）
curl "http://localhost/api/search?keyword=test"

# 4. 恢复
php artisan search:health --force-healthy

# 5. 再次测试（应该走 ES）
curl "http://localhost/api/search?keyword=test"
```

## 八、总结

这套方案的核心思想是：**不信任任何单一组件。**

- ES 很好用，但它会挂
- MySQL Full-Text 不够强，但它是你的数据库自带的
- LIKE 很原始，但它是最后的保底

实际生产中，大多数时候你只会在第一层。但当 ES 真的出问题时，用户看到的是"搜索结果不够精确"而不是"500 Internal Server Error"——这就是高可用的区别。

几个关键配置建议：

1. **健康检测阈值**：连续 3 次失败再标记为不健康，避免偶发抖动误判
2. **恢复探测间隔**：60 秒试一次，不要太频繁
3. **LIKE 查询超时**：必须加，防止慢查询拖垮数据库
4. **降级缓存**：降级状态下开启缓存，保护 MySQL
5. **告警**：降级发生时立刻通知，不要等用户反馈

完整代码已在文中给出，可以直接复制到 Laravel 项目中使用。根据你的实际业务调整索引结构、筛选条件和分词策略即可。
