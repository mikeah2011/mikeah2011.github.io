---
title: Laravel + Tinybird 实战：实时分析 API——ClickHouse 驱动的 Serverless OLAP 与 Laravel 集成
keywords: [Laravel, Tinybird, API, ClickHouse, Serverless OLAP, 实时分析, 驱动的, 架构]
date: 2026-06-09 06:46:00
categories:
  - architecture
tags:
  - Laravel
  - Tinybird
  - ClickHouse
  - 实时分析
  - OLAP
  - Serverless
  - 数据管道
description: 深度实战 Laravel 与 Tinybird 集成，利用 ClickHouse 驱动的 Serverless OLAP 构建实时分析 API，涵盖数据管道搭建、查询优化、Laravel 封装、踩坑记录与生产部署方案。
cover: https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200
images:
  - https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200
---


## 概述

在传统 Web 应用中，当我们需要「实时分析」能力时，常见的路径是：MySQL 主库 → 定时 ETL → 数据仓库 → BI 工具。这条链路延迟通常是小时级甚至天级，对于需要秒级响应的 Dashboard、实时推荐、运营大屏等场景完全不够。

**Tinybird** 是一个基于 ClickHouse 的 Serverless 数据分析平台，核心卖点是：把「事件摄入 → 存储 → 查询 → API 暴露」这条链路压缩到分钟级，让你用 SQL 直接生成 REST API。

本文将完整实战 Laravel + Tinybird 的集成方案：

- 从 Laravel 应用推送事件到 Tinybird
- 用 SQL Pipe 构建实时分析 API
- Laravel 端封装 SDK 调用分析接口
- 生产环境的性能优化与踩坑记录

---

## 核心概念

### Tinybird 架构

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Laravel App │────▶│  Tinybird    │────▶│  REST API    │
│  (事件生产)   │     │  Data Source  │     │  (查询结果)   │
└──────────────┘     │  + Pipes     │     └──────────────┘
                     │  (ClickHouse)│
                     └──────────────┘
```

**Data Source**：类似数据库表，接收 JSON 格式的事件数据，底层是 ClickHouse 的 MergeTree 引擎。

**Pipe**：SQL 查询管道，可以串联多个 `SELECT` 节点，最终节点可以发布为 API endpoint。

**Token**：权限控制单元，支持只写（ingest）、只读（query）、全权限等粒度。

### 为什么不直接用 ClickHouse？

ClickHouse 本身需要运维集群、管理副本、配置 ZooKeeper（或 ClickHouse Keeper）。Tinybird 把这些全部抽象掉了，你只需要关心：推数据、写 SQL、拿结果。对于中小团队来说，这是巨大的运维成本节省。

### 数据模型设计原则

在 Tinybird 中设计数据模型有几个关键原则：

1. **宽表优先**：ClickHouse 擅长宽表扫描，尽量在写入时做 denormalization
2. **分区字段**：通常按日期分区，`toDate(timestamp)` 是最常见的分区键
3. **排序键**：查询中最常用的 `WHERE` 条件字段放在排序键前面
4. **避免频繁更新**：ClickHouse 的 `ReplacingMergeTree` 可以处理去重，但不是真正的实时更新

---

## 实战代码

### 第一步：创建 Tinybird 资源

#### 1.1 安装 Tinybird CLI

```bash
curl https://tinybird.co | sh
tb auth
```

按提示输入你的 Tinybird token（在 Tinybird 控制台生成）。

#### 1.2 创建 Data Source

创建文件 `datasources/page_events.datasource`：

```sql
SCHEMA >
    `event_type` LowCardinality(String),
    `user_id` String,
    `page_url` String,
    `referrer` String,
    `country` LowCardinality(String),
    `device_type` LowCardinality(String),
    `session_id` String,
    `duration_ms` UInt32,
    `properties` String,
    `timestamp` DateTime,
    `date` Date DEFAULT toDate(timestamp)

ENGINE "MergeTree"
ENGINE_PARTITION_KEY "date"
ENGINE_SORTING_KEY "event_type, user_id, timestamp"
ENGINE_TTL "date + toIntervalDay(365)"
```

推送 Data Source：

```bash
tb push datasources/page_events.datasource
```

#### 1.3 创建分析 Pipe

创建文件 `pipes/top_pages.pipe`：

```sql
NODE top_pages_node
SQL >
    SELECT
        page_url,
        count() AS views,
        uniq(user_id) AS unique_visitors,
        avg(duration_ms) AS avg_duration_ms,
        bar(views, 0, 10000, 40) AS bar
    FROM page_events
    WHERE
        date >= toDateTime({{DateTime(start_date, '2026-06-01 00:00:00')}})
        AND date <= toDateTime({{{DateTime(end_date, '2026-06-09 23:59:59')}}})
        AND event_type = 'pageview'
    GROUP BY page_url
    ORDER BY views DESC
    LIMIT {{Int32(limit, 100)}}

TYPE endpoint
```

发布 API：

```bash
tb push pipes/top_pages.pipe
```

发布后会得到一个 URL，类似：
`https://api.tinybird.co/v0/pipes/top_pages.json?token=p.eyJ...`

### 第二步：Laravel 端集成

#### 2.1 安装依赖

```bash
composer require guzzlehttp/guzzle
```

#### 2.2 配置环境变量

`.env` 文件添加：

```ini
TINYBIRD_API_URL=https://api.tinybird.co
TINYBIRD_INGEST_TOKEN=p.eyJ...your-ingest-token
TINYBIRD_QUERY_TOKEN=p.eyJ...your-query-token
```

`config/services.php` 添加：

```php
'tinybird' => [
    'api_url'      => env('TINYBIRD_API_URL', 'https://api.tinybird.co'),
    'ingest_token' => env('TINYBIRD_INGEST_TOKEN'),
    'query_token'  => env('TINYBIRD_QUERY_TOKEN'),
],
```

#### 2.3 封装 Tinybird Service

`app/Services/TinybirdService.php`：

```php
<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use Illuminate\Support\Facades\Log;

class TinybirdService
{
    private Client $client;
    private string $ingestToken;
    private string $queryToken;
    private string $apiUrl;

    public function __construct()
    {
        $this->apiUrl = config('services.tinybird.api_url');
        $this->ingestToken = config('services.tinybird.ingest_token');
        $this->queryToken = config('services.tinybird.query_token');

        $this->client = new Client([
            'base_uri' => $this->apiUrl,
            'timeout'  => 10.0,
            'connect_timeout' => 3.0,
        ]);
    }

    /**
     * 推送事件到 Tinybird Data Source
     *
     * @param string $datasource Data Source 名称
     * @param array  $events     事件数组，每个事件为关联数组
     * @return array 响应结果
     * @throws GuzzleException
     */
    public function ingest(string $datasource, array $events): array
    {
        // NDJSON 格式：每行一个 JSON 对象
        $ndjson = implode("\n", array_map('json_encode', $events));

        $response = $this->client->post("/v0/events", [
            'query' => [
                'name'  => $datasource,
                'token' => $this->ingestToken,
            ],
            'body'        => $ndjson,
            'headers'     => [
                'Content-Type' => 'application/x-ndjson',
            ],
        ]);

        $result = json_decode($response->getBody()->getContents(), true);

        if (isset($result['quarantined_rows']) && $result['quarantined_rows'] > 0) {
            Log::warning('Tinybird quarantine', [
                'datasource' => $datasource,
                'result'     => $result,
            ]);
        }

        return $result;
    }

    /**
     * 调用已发布的 Pipe API
     *
     * @param string $pipeName Pipe 名称
     * @param array  $params   查询参数
     * @return array 查询结果的行数据
     * @throws GuzzleException
     */
    public function query(string $pipeName, array $params = []): array
    {
        $response = $this->client->get("/v0/pipes/{$pipeName}.json", [
            'query' => array_merge(
                $params,
                ['token' => $this->queryToken]
            ),
        ]);

        $result = json_decode($response->getBody()->getContents(), true);

        return $result['data'] ?? [];
    }

    /**
     * 推送页面浏览事件（便捷方法）
     */
    public function trackPageview(array $data): array
    {
        $event = [
            'event_type'  => 'pageview',
            'user_id'     => $data['user_id'] ?? 'anonymous',
            'page_url'    => $data['page_url'],
            'referrer'    => $data['referrer'] ?? '',
            'country'     => $data['country'] ?? '',
            'device_type' => $data['device_type'] ?? '',
            'session_id'  => $data['session_id'] ?? '',
            'duration_ms' => $data['duration_ms'] ?? 0,
            'properties'  => json_encode($data['properties'] ?? []),
            'timestamp'   => now()->format('Y-m-d H:i:s'),
        ];

        return $this->ingest('page_events', [$event]);
    }
}
```

#### 2.4 使用 Service Provider 注册

`app/Providers/TinybirdServiceProvider.php`：

```php
<?php

declare(strict_types=1);

namespace App\Providers;

use App\Services\TinybirdService;
use Illuminate\Support\ServiceProvider;

class TinybirdServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TinybirdService::class, function () {
            return new TinybirdService();
        });
    }
}
```

在 `config/app.php` 的 `providers` 数组中注册。

#### 2.5 实现事件追踪中间件

`app/Http/Middleware/TrackPageview.php`：

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\TinybirdService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class TrackPageview
{
    public function __construct(
        private readonly TinybirdService $tinybird
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($next);

        // 只追踪 GET 请求的页面浏览
        if ($request->isMethod('GET') && !$request->ajax()) {
            try {
                $this->tinybird->trackPageview([
                    'user_id'     => $request->user()?->id ?? 'anonymous',
                    'page_url'    => $request->fullUrl(),
                    'referrer'    => $request->headers->get('referer', ''),
                    'country'     => $request->header('CF-IPCountry', ''),
                    'device_type' => $this->detectDevice($request),
                    'session_id'  => $request->session()?->getId() ?? '',
                    'duration_ms' => 0, // 前端上报时再更新
                ]);
            } catch (\Throwable $e) {
                // 分析追踪不应影响正常请求
                report($e);
            }
        }

        return $response;
    }

    private function detectDevice(Request $request): string
    {
        $ua = strtolower($request->userAgent());

        return match (true) {
            str_contains($ua, 'mobile') || str_contains($ua, 'android') => 'mobile',
            str_contains($ua, 'tablet') || str_contains($ua, 'ipad')    => 'tablet',
            default                                                       => 'desktop',
        };
    }
}
```

#### 2.6 构建 Dashboard Controller

`app/Http/Controllers/Admin/DashboardController.php`：

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\TinybirdService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;

class DashboardController extends Controller
{
    public function __construct(
        private readonly TinybirdService $tinybird
    ) {}

    /**
     * 实时页面访问排行
     */
    public function topPages(): JsonResponse
    {
        $start = request('start_date', now()->subDays(7)->format('Y-m-d'));
        $end = request('end_date', now()->format('Y-m-d'));
        $limit = min((int) request('limit', 50), 500);

        $data = $this->tinybird->query('top_pages', [
            'start_date' => $start . ' 00:00:00',
            'end_date'   => $end . ' 23:59:59',
            'limit'      => $limit,
        ]);

        return response()->json([
            'success' => true,
            'data'    => $data,
            'meta'    => [
                'start_date' => $start,
                'end_date'   => $end,
                'count'      => count($data),
            ],
        ]);
    }

    /**
     * 实时访问趋势（按小时）
     */
    public function hourlyTrend(): JsonResponse
    {
        $data = $this->tinybird->query('hourly_trend', [
            'start_date' => now()->subDays(1)->format('Y-m-d H:i:s'),
            'end_date'   => now()->format('Y-m-d H:i:s'),
        ]);

        return response()->json([
            'success' => true,
            'data'    => $data,
        ]);
    }
}
```

#### 2.7 批量事件推送（队列优化）

对于高流量场景，逐条推送效率太低。用 Laravel 队列做批量推送：

`app/Jobs/FlushTinybirdEvents.php`：

```php
<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\TinybirdService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class FlushTinybirdEvents implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 30;

    public function __construct(
        private readonly string $datasource,
        private readonly array $events,
    ) {}

    public function handle(TinybirdService $tinybird): void
    {
        try {
            $result = $tinybird->ingest($this->datasource, $this->events);

            Log::info('Tinybird batch flush', [
                'datasource' => $this->datasource,
                'count'      => count($this->events),
                'result'     => $result,
            ]);
        } catch (\Throwable $e) {
            // 失败事件缓存起来，下次重试
            $cacheKey = "tinybird_failed_{$this->datasource}";
            $failed = Cache::get($cacheKey, []);
            $failed = array_merge($failed, $this->events);
            Cache::put($cacheKey, $failed, 3600);

            throw $e;
        }
    }
}
```

事件缓冲器（在 AppServiceProvider 中注册为 singleton）：

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Jobs\FlushTinybirdEvents;
use Illuminate\Support\Facades\Cache;

class TinybirdBuffer
{
    private array $buffers = [];
    private int $batchSize;

    public function __construct(int $batchSize = 100)
    {
        $this->batchSize = $batchSize;
    }

    public function push(string $datasource, array $event): void
    {
        $this->buffers[$datasource][] = $event;

        if (count($this->buffers[$datasource]) >= $this->batchSize) {
            $this->flush($datasource);
        }
    }

    public function flush(string $datasource): void
    {
        if (empty($this->buffers[$datasource])) {
            return;
        }

        $events = $this->buffers[$datasource];
        $this->buffers[$datasource] = [];

        // 也把缓存中的失败事件一起发送
        $cacheKey = "tinybird_failed_{$datasource}";
        $failed = Cache::pull($cacheKey, []);
        $events = array_merge($failed, $events);

        // 每批最多 500 条（Tinybird 限制）
        foreach (array_chunk($events, 500) as $chunk) {
            FlushTinybirdEvents::dispatch($datasource, $chunk);
        }
    }

    public function flushAll(): void
    {
        foreach (array_keys($this->buffers) as $datasource) {
            $this->flush($datasource);
        }
    }
}
```

注册 terminate 回调确保请求结束时刷空缓冲：

```php
// AppServiceProvider.php
public function boot(): void
{
    $this->app->terminating(function () {
        app(TinybirdBuffer::class)->flushAll();
    });
}
```

---

## Tinybird Pipe 高级用法

### 多层 Pipe 串联

Tinybird 支持 Pipe 节点串联，实现中间结果复用：

```sql
-- 第一层：基础聚合
NODE base_aggregation
SQL >
    SELECT
        toStartOfHour(timestamp) AS hour,
        event_type,
        count() AS event_count,
        uniq(user_id) AS unique_users
    FROM page_events
    WHERE date >= toDateTime({{DateTime(start_date)}})
    GROUP BY hour, event_type

-- 第二层：计算同比
NODE comparison
SQL >
    SELECT
        hour,
        event_type,
        event_count,
        unique_users,
        lagInFrame(event_count, 24) OVER (
            PARTITION BY event_type
            ORDER BY hour
        ) AS prev_day_count,
        if(
            prev_day_count > 0,
            round((event_count - prev_day_count) / prev_day_count * 100, 2),
            0
        ) AS change_pct
    FROM base_aggregation

TYPE endpoint
```

### 实时用户漏斗分析

```sql
NODE funnel_query
SQL >
    WITH
        step1 AS (
            SELECT DISTINCT user_id
            FROM page_events
            WHERE event_type = 'pageview'
                AND page_url LIKE '%/products%'
                AND date >= toDateTime({{DateTime(start_date)}})
        ),
        step2 AS (
            SELECT DISTINCT user_id
            FROM page_events
            WHERE event_type = 'add_to_cart'
                AND date >= toDateTime({{DateTime(start_date)}})
        ),
        step3 AS (
            SELECT DISTINCT user_id
            FROM page_events
            WHERE event_type = 'purchase'
                AND date >= toDateTime({{DateTime(start_date)}})
        )
    SELECT
        (SELECT count() FROM step1) AS page_views,
        (SELECT count() FROM step2) AS add_to_cart,
        (SELECT count() FROM step3) AS purchases,
        round(add_to_cart / page_views * 100, 2) AS step1_to_step2_pct,
        round(purchases / add_to_cart * 100, 2) AS step2_to_step3_pct

TYPE endpoint
```

---

## 踩坑记录

### 踩坑 1：NDJSON 格式严格要求

Tinybird 的 ingest API 要求严格 NDJSON（每行一个 JSON），不能有多余空行或尾部换行。

```php
// ❌ 错误：json_encode 数组会得到标准 JSON 数组
$json = json_encode($events);

// ✅ 正确：每行一个 JSON 对象
$ndjson = implode("\n", array_map('json_encode', $events));
```

### 踩坑 2：字段类型不匹配导致数据被隔离

如果推送的字段类型和 Data Source schema 不匹配（比如 string 推给了 UInt32 字段），数据会被放入 **quarantine**（隔离区），不会丢失但不会写入主表。

排查方法：

```bash
tb datasource ls
tb datasource get page_events --quarantine
```

解决方案：确保 Laravel 端推送前做类型转换：

```php
$event = [
    'duration_ms' => (int) ($data['duration_ms'] ?? 0),  // 必须是整数
    'user_id'     => (string) ($data['user_id'] ?? ''),  // 必须是字符串
];
```

### 踩坑 3：查询参数类型声明

Tinybird Pipe 的参数类型必须显式声明，否则会报错：

```sql
-- ❌ 错误：没有类型声明
WHERE date >= {{start_date}}

-- ✅ 正确：显式类型
WHERE date >= toDateTime({{DateTime(start_date, '2026-06-01 00:00:00')}})
```

### 踩坑 4：ClickHouse 的 NULL 处理

ClickHouse 中 `NULL` 和空字符串的语义不同。`uniq()` 不会计算 `NULL` 值，但会计算空字符串。如果字段可能为空，schema 中建议用 `DEFAULT ''` 而不是 nullable。

### 踩坑 5：Rate Limiting

Tinybird 的免费套餐限制：
- ingest：每天 1000 行（付费版无限制）
- query：每天 1000 次 API 调用
- 单次 ingest 最多 500 行/10MB

生产环境务必监控用量：

```php
// 在 TinybirdService 中记录调用次数
private function trackUsage(string $type): void
{
    $key = "tinybird_usage_{$type}_" . now()->format('Y-m-d');
    Cache::increment($key, 1, now()->endOfDay()->diffInSeconds());
}
```

### 踩坑 6：时间时区问题

ClickHouse 默认使用 UTC。如果应用时区是 Asia/Shanghai，在 ingest 时需要转换：

```php
'timestamp' => now()->setTimezone('UTC')->format('Y-m-d H:i:s'),
```

或者在 Data Source 中定义默认值时区：

```sql
`timestamp` DateTime('Asia/Shanghai')
```

---

## 生产环境优化

### 1. 使用 Laravel 事件系统解耦

不要直接在 Controller 中调用 Tinybird，通过事件系统解耦：

```php
// Event
class PageviewTracked
{
    public function __construct(
        public readonly array $data
    ) {}
}

// Listener
class SendPageviewToTinybird implements ShouldQueue
{
    public function handle(PageviewTracked $event): void
    {
        app(TinybirdService::class)->trackPageview($event->data);
    }
}
```

### 2. 添加本地缓存层

高频查询结果缓存 60 秒，减少 API 调用：

```php
public function cachedQuery(string $pipeName, array $params, int $ttl = 60): array
{
    $cacheKey = 'tb_' . $pipeName . md5(json_encode($params));

    return Cache::remember($cacheKey, $ttl, function () use ($pipeName, $params) {
        return $this->query($pipeName, $params);
    });
}
```

### 3. 监控与告警

```php
// 在 TinybirdService 中添加耗时监控
public function query(string $pipeName, array $params = []): array
{
    $start = microtime(true);

    try {
        $result = $this->doQuery($pipeName, $params);

        Log::info('Tinybird query', [
            'pipe'     => $pipeName,
            'duration' => microtime(true) - $start,
            'rows'     => count($result),
        ]);

        return $result;
    } catch (GuzzleException $e) {
        Log::error('Tinybird query failed', [
            'pipe'     => $pipeName,
            'duration' => microtime(true) - $start,
            'error'    => $e->getMessage(),
        ]);

        throw $e;
    }
}
```

---

## 总结

| 维度 | 传统方案（MySQL + ETL） | Laravel + Tinybird |
|------|------------------------|-------------------|
| 数据延迟 | 小时~天级 | 秒~分钟级 |
| 运维成本 | 需要数仓团队 | Serverless 零运维 |
| 查询性能 | 大表聚合慢 | ClickHouse 列式存储，毫秒级 |
| API 暴露 | 需要自己写 | SQL 自动生成 |
| 学习成本 | 低（SQL 就够） | 低（SQL + Pipe） |

**适用场景**：
- 实时 Dashboard 和运营大屏
- 用户行为分析（漏斗、留存、路径）
- A/B 测试实时效果追踪
- 日志和监控数据聚合

**不适用场景**：
- 数据量极小（日活 < 1000）直接 MySQL 就行
- 需要复杂事务的 OLTP 场景
- 对数据一致性要求极高（Tinybird 是最终一致性）

Laravel + Tinybird 的组合让我们可以在不搭建数仓的前提下，用最小的运维成本获得实时分析能力。核心思路就是：**Laravel 负责业务逻辑和事件生产，Tinybird 负责存储和查询，各司其职**。
