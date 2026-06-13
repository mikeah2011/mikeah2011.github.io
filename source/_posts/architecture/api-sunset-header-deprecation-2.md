---

title: API 生命周期管理实战：设计、版本控制、废弃通知、客户端迁移——Sunset Header 与 Deprecation 标准
keywords: [API, Sunset Header, Deprecation, 生命周期管理实战, 版本控制, 废弃通知, 客户端迁移, 标准]
date: 2026-06-02 08:00:00
tags:
- API
- RESTful
- 版本控制
- Sunset-Header
- 生命周期
- Laravel
categories:
- architecture
description: API 生命周期管理实战全流程：从 OpenAPI 契约设计、URL/Header/MediaType 版本控制策略，到 RFC 8594 Sunset Header 与 Deprecation Header 标准化废弃通知，再到客户端迁移监控与渐进式限流下线。基于 Laravel 完整实现，提供版本检测中间件、自动通知系统、迁移看板等生产级代码，终结僵尸 API 难题。
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---



## 前言：API 不只是写完就上线

很多团队对 API 的理解停留在"设计 → 开发 → 上线"这三个阶段。但现实是，一个成功的 API 会经历完整的生命周期：**设计 → 版本演进 → 废弃通知 → 客户端迁移 → 安全下线**。忽视后半段的团队，往往会陷入"不敢改 API、不敢删旧版本、旧代码越积越多"的泥潭。

本文将从实战角度，用 Laravel 完整实现 API 生命周期管理的每个环节，重点讲解 RFC 8594 Sunset Header 和 Deprecation Header 这两个标准，以及如何构建一套自动化的 API 废弃与迁移工作流。

<!-- more -->

## 一、API 生命周期全景图

```
时间轴 ──────────────────────────────────────────────────────────────→

│ 设计阶段    │ 开发阶段   │ 稳定阶段      │ 废弃阶段      │ 下线阶段 │
│            │           │              │              │         │
│ OpenAPI    │ 实现      │ v1 稳定运行   │ v1 标记废弃   │ v1 下线 │
│ 契约设计    │ 测试      │ 新功能开发    │ v2 发布      │ 流量清零 │
│ Code Review│ 部署      │ 监控告警      │ 客户端迁移    │ 归档     │
│            │           │              │ Sunset Header │         │

关键里程碑：
├── M1: API 设计评审通过
├── M2: v1 正式发布
├── M3: v2 发布 + v1 标记 Deprecated
├── M4: v1 发送 Sunset Header（设置下线日期）
├── M5: 通知所有客户端迁移完成
├── M6: v1 流量降至 0
└── M7: v1 正式下线
```

## 二、API 设计阶段

### 2.1 OpenAPI 3.0 契约先行

```yaml
# openapi.yaml
openapi: 3.0.3
info:
  title: E-Commerce API
  description: B2C 电商 API 服务
  version: 2.0.0
  contact:
    name: API Team
    email: api-team@example.com
  license:
    name: MIT

servers:
  - url: https://api.example.com/v2
    description: Production
  - url: https://api-staging.example.com/v2
    description: Staging

paths:
  /products:
    get:
      operationId: listProducts
      summary: 获取商品列表
      deprecated: false
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
        - name: per_page
          in: query
          schema:
            type: integer
            default: 20
            maximum: 100
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProductListResponse'

  /products/{id}:
    get:
      operationId: getProduct
      summary: 获取商品详情
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProductResponse'

components:
  schemas:
    ProductListResponse:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/Product'
        meta:
          $ref: '#/components/schemas/PaginationMeta'

    Product:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        price:
          type: number
          format: decimal
        currency:
          type: string
          default: CNY
        category_id:
          type: string
          format: uuid
        created_at:
          type: string
          format: date-time
```

### 2.2 设计评审清单

```markdown
## API 设计评审 Checklist

### 必须项
- [ ] 遵循 RESTful 命名规范（复数名词、HTTP 方法语义正确）
- [ ] 统一响应格式（成功/错误）
- [ ] 分页、排序、过滤参数标准化
- [ ] 错误码体系定义
- [ ] 认证方式明确（Bearer Token / API Key）
- [ ] 限流策略说明
- [ ] OpenAPI 文档完整

### 推荐项
- [ ] HATEOAS 链接（大型 API）
- [ ] 字段级权限控制
- [ ] 请求/响应示例
- [ ] 性能基准（P99 响应时间）
```

### 2.3 统一响应格式

```php
<?php
// app/Http/Resources/ApiResponse.php

namespace App\Http\Resources;

use Illuminate\Http\JsonResponse;

class ApiResponse
{
    public static function success($data, string $message = 'OK', int $code = 200): JsonResponse
    {
        return response()->json([
            'success' => true,
            'code' => $code,
            'message' => $message,
            'data' => $data,
            'timestamp' => now()->toIso8601String(),
        ], $code);
    }

    public static function paginated($paginator, string $resourceClass): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $resourceClass::collection($paginator),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
            ],
            'links' => [
                'first' => $paginator->url(1),
                'last' => $paginator->url($paginator->lastPage()),
                'prev' => $paginator->previousPageUrl(),
                'next' => $paginator->nextPageUrl(),
            ],
        ]);
    }

    public static function error(string $message, int $code, ?string $errorCode = null, ?array $details = null): JsonResponse
    {
        $response = [
            'success' => false,
            'error' => [
                'code' => $errorCode ?? 'UNKNOWN_ERROR',
                'message' => $message,
            ],
            'timestamp' => now()->toIso8601String(),
        ];

        if ($details) {
            $response['error']['details'] = $details;
        }

        return response()->json($response, $code);
    }
}
```

## 三、API 版本控制策略

### 3.1 三种版本控制方式对比

```
1. URL 路径版本（最常用）
   GET /v1/products
   GET /v2/products
   
   优点：简单直观，缓存友好
   缺点：URL 不优雅，可能引起大量重定向

2. Header 版本
   GET /products
   Accept: application/vnd.example.v2+json
   
   优点：URL 干净，遵循 HTTP 语义
   缺点：缓存不友好，客户端实现复杂

3. Query Parameter 版本
   GET /products?version=2
   
   优点：实现简单
   缺点：不符合 REST 语义，易被忽略
```

### 3.2 Laravel 路径版本实现

```php
<?php
// routes/api.php

// v1 路由组
Route::prefix('v1')->group(function () {
    Route::get('products', [\App\Http\Controllers\V1\ProductController::class, 'index']);
    Route::get('products/{id}', [\App\Http\Controllers\V1\ProductController::class, 'show']);
    Route::post('orders', [\App\Http\Controllers\V1\OrderController::class, 'store']);
});

// v2 路由组
Route::prefix('v2')->group(function () {
    Route::get('products', [\App\Http\Controllers\V2\ProductController::class, 'index']);
    Route::get('products/{id}', [\App\Http\Controllers\V2\ProductController::class, 'show']);
    Route::post('orders', [\App\Http\Controllers\V2\OrderController::class, 'store']);
    // v2 新增端点
    Route::get('products/{id}/reviews', [\App\Http\Controllers\V2\ProductController::class, 'reviews']);
});
```

### 3.3 版本路由服务提供者

```php
<?php
// app/Providers/RouteServiceProvider.php

namespace App\Providers;

use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Support\Facades\Route;

class RouteServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->routes(function () {
            // API 版本路由
            $versions = ['v1', 'v2', 'v3'];
            
            foreach ($versions as $version) {
                $controllerNamespace = "App\\Http\\Controllers\\" . ucfirst($version);
                $routeFile = base_path("routes/api/{$version}.php");
                
                if (file_exists($routeFile)) {
                    Route::prefix($version)
                        ->middleware('api')
                        ->namespace($controllerNamespace)
                        ->group($routeFile);
                }
            }
        });
    }
}
```

### 3.4 版本协商中间件

```php
<?php
// app/Http/Middleware/ApiVersionNegotiation.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class ApiVersionNegotiation
{
    private array $supportedVersions = ['v1', 'v2'];
    private string $defaultVersion = 'v2';
    private array $deprecatedVersions = ['v1'];

    public function handle(Request $request, Closure $next)
    {
        // 从 URL 提取版本
        $version = $this->extractVersion($request);
        
        // 检查版本是否支持
        if (!in_array($version, $this->supportedVersions)) {
            return response()->json([
                'error' => [
                    'code' => 'UNSUPPORTED_VERSION',
                    'message' => "API version '{$version}' is not supported. Supported: " 
                                 . implode(', ', $this->supportedVersions),
                ],
            ], 400);
        }

        // 注入版本到请求
        $request->merge(['api_version' => $version]);

        $response = $next($request);

        // 添加版本相关 Header
        $response->headers->set('X-API-Version', $version);
        
        // 如果是废弃版本，添加 Deprecation Header
        if (in_array($version, $this->deprecatedVersions)) {
            $response->headers->set('Deprecation', 'true');
            $response->headers->set('Sunset', $this->getSunsetDate($version));
            $response->headers->set('Link', sprintf(
                '</%s%s>; rel="successor-version"',
                $this->getNextVersion($version),
                $request->path()
            ));
        }

        return $response;
    }

    private function extractVersion(Request $request): string
    {
        $segments = $request->segments();
        $firstSegment = $segments[0] ?? '';
        
        if (preg_match('/^v\d+$/', $firstSegment)) {
            return $firstSegment;
        }

        // 从 Header 提取
        $accept = $request->header('Accept', '');
        if (preg_match('/application\/vnd\.example\.(v\d+)\+json/', $accept, $matches)) {
            return $matches[1];
        }

        return $this->defaultVersion;
    }

    private function getSunsetDate(string $version): string
    {
        $sunsetDates = [
            'v1' => 'Sun, 01 Sep 2026 00:00:00 GMT',
        ];

        return $sunsetDates[$version] ?? '';
    }

    private function getNextVersion(string $version): string
    {
        $versionMap = ['v1' => 'v2', 'v2' => 'v3'];
        return $versionMap[$version] ?? $version;
    }
}
```

## 四、RFC 8594 Sunset Header 深度解析

### 4.1 什么是 Sunset Header

RFC 8594 定义了 `Sunset` HTTP Header，用于指示一个 URI 或资源将在何时不再可用。这是 API 废弃通知的标准化方式。

```
HTTP/1.1 200 OK
Sunset: Sat, 01 Sep 2026 00:00:00 GMT
Deprecation: true
Link: </v2/products>; rel="successor-version"
```

### 4.2 Sunset Header 规范

```
Sunset: HTTP-date

示例：
Sunset: Sat, 01 Sep 2026 00:00:00 GMT

语义：
- 表示该资源（URI）在指定日期之后将不再可用
- 客户端应该在该日期之前迁移到新版本
- 日期格式遵循 RFC 7231 的 HTTP-date
```

### 4.3 在 Laravel 中实现 Sunset Header

```php
<?php
// app/Http/Middleware/SunsetHeader.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Carbon\Carbon;

class SunsetHeader
{
    /**
     * API 版本的 Sunset 配置
     * 
     * 'v1' => [
     *     'sunset_date' => '2026-09-01',
     *     'successor_version' => 'v2',
     *     'migration_guide_url' => 'https://docs.example.com/migration/v1-to-v2',
     * ]
     */
    private array $sunsetConfig = [];

    public function __construct()
    {
        $this->sunsetConfig = config('api.sunset', []);
    }

    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        $version = $request->get('api_version', 'v2');
        
        if (!isset($this->sunsetConfig[$version])) {
            return $response;
        }

        $config = $this->sunsetConfig[$version];
        $sunsetDate = Carbon::parse($config['sunset_date']);
        $now = Carbon::now();

        // 设置 Sunset Header
        $response->headers->set('Sunset', $sunsetDate->format('D, d M Y H:i:s \G\M\T'));

        // 设置 Deprecation Header（RFC draft）
        $response->headers->set('Deprecation', 'true');

        // 设置 Link Header 指向继任版本
        $successorPath = str_replace($version, $config['successor_version'], $request->path());
        $response->headers->set('Link', sprintf(
            '<%s>; rel="successor-version", <%s>; rel="deprecation"',
            url($successorPath),
            $config['migration_guide_url'] ?? ''
        ));

        // 计算剩余天数，添加自定义 Header
        $daysRemaining = $now->diffInDays($sunsetDate, false);
        
        if ($daysRemaining <= 0) {
            // 已过 Sunset 日期
            $response->headers->set('X-API-Sunset-Status', 'expired');
            $response->headers->set('X-API-Sunset-Days-Overdue', abs($daysRemaining));
        } elseif ($daysRemaining <= 30) {
            // 30 天内到期
            $response->headers->set('X-API-Sunset-Status', 'imminent');
            $response->headers->set('X-API-Sunset-Days-Remaining', $daysRemaining);
        } elseif ($daysRemaining <= 90) {
            // 90 天内到期
            $response->headers->set('X-API-Sunset-Status', 'approaching');
            $response->headers->set('X-API-Sunset-Days-Remaining', $daysRemaining);
        } else {
            $response->headers->set('X-API-Sunset-Status', 'announced');
            $response->headers->set('X-API-Sunset-Days-Remaining', $daysRemaining);
        }

        return $response;
    }
}
```

### 4.4 配置文件

```php
<?php
// config/api.php

return [
    'versions' => [
        'supported' => ['v1', 'v2'],
        'current' => 'v2',
        'deprecated' => ['v1'],
    ],

    'sunset' => [
        'v1' => [
            'sunset_date' => '2026-09-01',
            'successor_version' => 'v2',
            'migration_guide_url' => 'https://docs.example.com/api/migration/v1-to-v2',
            'changelog_url' => 'https://docs.example.com/api/changelog',
            'contact_email' => 'api-team@example.com',
            'notification_schedule' => [
                180 => 'email',    // 180 天前发邮件
                90  => 'email+slack',
                30  => 'email+slack+phone',
                7   => 'email+slack+phone+war-room',
            ],
        ],
    ],

    'rate_limits' => [
        'v1' => [
            'max_attempts' => 60,  // 废弃版本降级限流
            'decay_minutes' => 1,
        ],
        'v2' => [
            'max_attempts' => 120,
            'decay_minutes' => 1,
        ],
    ],
];
```

## 五、Deprecation Header 标准

### 5.1 Deprecation Header 规范

```
Deprecation: true
# 或者带日期
Deprecation: date="2026-03-01"

# 结合 Link Header
Link: <https://docs.example.com/migration>; rel="deprecation"
```

### 5.2 在响应中实现 Deprecation

```php
<?php
// app/Http/Middleware/DeprecationNotice.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class DeprecationNotice
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        $version = $request->get('api_version');
        $deprecatedVersions = config('api.versions.deprecated', []);

        if (in_array($version, $deprecatedVersions)) {
            $config = config("api.sunset.{$version}", []);
            
            // RFC draft Deprecation Header
            $response->headers->set('Deprecation', sprintf(
                'date="%s"',
                $config['deprecation_date'] ?? now()->toDateString()
            ));

            // 自定义 X-API-Deprecated Header（更广泛的客户端支持）
            $response->headers->set('X-API-Deprecated', 'true');
            $response->headers->set('X-API-Deprecation-Info', sprintf(
                'API %s is deprecated. Please migrate to %s. Guide: %s',
                $version,
                $config['successor_version'] ?? 'latest',
                $config['migration_guide_url'] ?? ''
            ));
        }

        return $response;
    }
}
```

## 六、客户端使用量监控

### 6.1 API 使用量追踪

```php
<?php
// app/Http/Middleware/TrackApiUsage.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TrackApiUsage
{
    public function handle(Request $request, Closure $next)
    {
        $startTime = microtime(true);

        $response = $next($request);

        $duration = microtime(true) - $startTime;

        // 异步记录使用量（使用队列避免影响性能）
        dispatch(function () use ($request, $response, $duration) {
            DB::table('api_usage_logs')->insert([
                'client_id' => $request->header('X-Client-ID', 'unknown'),
                'api_version' => $request->get('api_version', 'unknown'),
                'method' => $request->method(),
                'path' => $request->path(),
                'status_code' => $response->getStatusCode(),
                'duration_ms' => round($duration * 1000, 2),
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'created_at' => now(),
            ]);
        })->afterCommit();

        return $response;
    }
}
```

### 6.2 使用量报表 Artisan 命令

```php
<?php
// app/Console/Commands/ApiUsageReport.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class ApiUsageReport extends Command
{
    protected $signature = 'api:usage-report 
                            {--version= : Filter by API version}
                            {--days=30 : Number of days to report}
                            {--format=table : Output format (table|json|csv)}';

    protected $description = 'Generate API usage report for sunset planning';

    public function handle(): int
    {
        $version = $this->option('version');
        $days = (int) $this->option('days');
        $since = Carbon::now()->subDays($days);

        $query = DB::table('api_usage_logs')
            ->where('created_at', '>=', $since)
            ->select(
                'api_version',
                'method',
                'path',
                DB::raw('COUNT(*) as total_requests'),
                DB::raw('COUNT(DISTINCT client_id) as unique_clients'),
                DB::raw('AVG(duration_ms) as avg_duration'),
                DB::raw('P95(duration_ms) as p95_duration'),
                DB::raw('MAX(created_at) as last_used_at')
            )
            ->groupBy('api_version', 'method', 'path')
            ->orderBy('total_requests', 'desc');

        if ($version) {
            $query->where('api_version', $version);
        }

        $results = $query->get();

        if ($results->isEmpty()) {
            $this->warn("No API usage data found for the last {$days} days.");
            return 0;
        }

        // 输出报告
        $this->info("API Usage Report (Last {$days} days)");
        $this->line('');

        $headers = ['Version', 'Method', 'Path', 'Requests', 'Unique Clients', 'Avg (ms)', 'P95 (ms)', 'Last Used'];
        $rows = $results->map(fn($r) => [
            $r->api_version,
            $r->method,
            $r->path,
            number_format($r->total_requests),
            $r->unique_clients,
            round($r->avg_duration, 2),
            round($r->p95_duration, 2),
            $r->last_used_at,
        ])->toArray();

        $this->table($headers, $rows);

        // Sunset 评估
        $this->line('');
        $this->info('=== Sunset Readiness Assessment ===');
        
        foreach (config('api.sunset', []) as $ver => $config) {
            $usage = DB::table('api_usage_logs')
                ->where('api_version', $ver)
                ->where('created_at', '>=', $since)
                ->count();

            $uniqueClients = DB::table('api_usage_logs')
                ->where('api_version', $ver)
                ->where('created_at', '>=', $since)
                ->distinct('client_id')
                ->count('client_id');

            $sunsetDate = Carbon::parse($config['sunset_date']);
            $daysRemaining = Carbon::now()->diffInDays($sunsetDate, false);

            $this->line("{$ver}: {$usage} requests, {$uniqueClients} clients, {$daysRemaining} days until sunset");

            if ($usage === 0) {
                $this->warn("  ✅ Ready for sunset - no active usage");
            } elseif ($daysRemaining <= 0) {
                $this->error("  ❌ PAST SUNSET DATE - immediate action required!");
            } elseif ($daysRemaining <= 30) {
                $this->error("  ⚠️  Sunset imminent - {$uniqueClients} clients still active");
            } else {
                $this->info("  📊 Monitoring - {$uniqueClients} clients need migration");
            }
        }

        return 0;
    }
}
```

## 七、客户端通知系统

### 7.1 自动化通知服务

```php
<?php
// app/Services/ApiDeprecationNotifier.php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Carbon\Carbon;

class ApiDeprecationNotifier
{
    /**
     * 检查并发送废弃通知
     */
    public function checkAndNotify(): void
    {
        foreach (config('api.sunset', []) as $version => $config) {
            $sunsetDate = Carbon::parse($config['sunset_date']);
            $daysRemaining = Carbon::now()->diffInDays($sunsetDate, false);

            // 获取通知计划
            $schedule = $config['notification_schedule'] ?? [];
            krsort($schedule); // 从大到小排序

            foreach ($schedule as $thresholdDays => $channels) {
                if ($daysRemaining <= $thresholdDays) {
                    $this->sendNotification($version, $config, $daysRemaining, $channels);
                    break; // 只发送最紧急的通知
                }
            }
        }
    }

    private function sendNotification(string $version, array $config, int $daysRemaining, string $channels): void
    {
        // 获取仍在使用该版本的客户端
        $activeClients = $this->getActiveClients($version);

        if (empty($activeClients)) {
            return;
        }

        $channelList = explode('+', $channels);

        foreach ($activeClients as $client) {
            if (in_array('email', $channelList)) {
                $this->sendEmailNotification($client, $version, $config, $daysRemaining);
            }

            if (in_array('slack', $channelList)) {
                $this->sendSlackNotification($client, $version, $config, $daysRemaining);
            }
        }

        // 记录通知日志
        DB::table('api_deprecation_notifications')->insert([
            'api_version' => $version,
            'days_remaining' => $daysRemaining,
            'channels' => $channels,
            'notified_clients_count' => count($activeClients),
            'created_at' => now(),
        ]);
    }

    private function getActiveClients(string $version): array
    {
        $thirtyDaysAgo = Carbon::now()->subDays(30);

        return DB::table('api_usage_logs')
            ->where('api_version', $version)
            ->where('created_at', '>=', $thirtyDaysAgo)
            ->select('client_id', DB::raw('COUNT(*) as request_count'), DB::raw('MAX(created_at) as last_request'))
            ->groupBy('client_id')
            ->orderByDesc('request_count')
            ->get()
            ->map(fn($r) => [
                'client_id' => $r->client_id,
                'request_count' => $r->request_count,
                'last_request' => $r->last_request,
                'email' => $this->getClientEmail($r->client_id),
            ])
            ->filter(fn($c) => !empty($c['email']))
            ->toArray();
    }

    private function sendEmailNotification(array $client, string $version, array $config, int $daysRemaining): void
    {
        $subject = sprintf(
            '[Action Required] API %s Sunset in %d Days - Migration Guide',
            strtoupper($version),
            $daysRemaining
        );

        Mail::send('emails.api-deprecation', [
            'client' => $client,
            'version' => $version,
            'config' => $config,
            'daysRemaining' => $daysRemaining,
            'migrationGuideUrl' => $config['migration_guide_url'] ?? '',
        ], function ($message) use ($client, $subject) {
            $message->to($client['email'])
                ->subject($subject);
        });
    }

    private function sendSlackNotification(array $client, string $version, array $config, int $daysRemaining): void
    {
        // Slack 通知实现
        $webhookUrl = config('services.slack.webhook_url');
        
        $payload = [
            'blocks' => [
                [
                    'type' => 'header',
                    'text' => ['type' => 'plain_text', 'text' => "⚠️ API Sunset Alert"],
                ],
                [
                    'type' => 'section',
                    'text' => [
                        'type' => 'mrkdwn',
                        'text' => sprintf(
                            "*Client:* %s\n*Version:* %s\n*Days Remaining:* %d\n*Migration Guide:* %s",
                            $client['client_id'],
                            strtoupper($version),
                            $daysRemaining,
                            $config['migration_guide_url'] ?? 'N/A'
                        ),
                    ],
                ],
            ],
        ];

        Http::post($webhookUrl, $payload);
    }

    private function getClientEmail(string $clientId): ?string
    {
        $client = DB::table('api_clients')->where('client_id', $clientId)->first();
        return $client->notification_email ?? null;
    }
}
```

### 7.2 定时任务

```php
<?php
// app/Console/Kernel.php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use App\Console\Commands\ApiUsageReport;

class Kernel extends \Illuminate\Foundation\Console\Kernel
{
    protected function schedule(Schedule $schedule): void
    {
        // 每天检查 API 废弃通知
        $schedule->call(function () {
            app(\App\Services\ApiDeprecationNotifier::class)->checkAndNotify();
        })->daily()->name('api-deprecation-check');

        // 每周一生成使用量报告
        $schedule->command(ApiUsageReport::class)
            ->weekly()
            ->mondays()
            ->at('09:00')
            ->name('api-weekly-report');

        // Sunset 日期临近时每天报告
        $schedule->command(ApiUsageReport::class)
            ->daily()
            ->when(function () {
                foreach (config('api.sunset', []) as $config) {
                    $daysRemaining = now()->diffInDays(Carbon::parse($config['sunset_date']), false);
                    if ($daysRemaining > 0 && $daysRemaining <= 30) {
                        return true;
                    }
                }
                return false;
            })
            ->name('api-daily-sunset-report');
    }
}
```

## 八、客户端迁移辅助

### 8.1 迁移指南文档自动生成

```php
<?php
// app/Console/Commands/GenerateMigrationGuide.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Route;

class GenerateMigrationGuide extends Command
{
    protected $signature = 'api:generate-migration-guide 
                            {--from=v1 : Source version}
                            {--to=v2 : Target version}';

    protected $description = 'Generate migration guide between API versions';

    public function handle(): int
    {
        $from = $this->option('from');
        $to = $this->option('to');

        $this->info("Generating migration guide: {$from} → {$to}");
        $this->line('');

        // 收集路由差异
        $fromRoutes = $this->getVersionRoutes($from);
        $toRoutes = $this->getVersionRoutes($to);

        // 分析差异
        $removed = array_diff_key($fromRoutes, $toRoutes);
        $added = array_diff_key($toRoutes, $fromRoutes);
        $common = array_intersect_key($fromRoutes, $toRoutes);

        // 生成 Markdown
        $markdown = $this->generateMarkdown($from, $to, $removed, $added, $common);

        $filename = "MIGRATION_{$from}_to_{$to}.md";
        file_put_contents(base_path("docs/{$filename}"), $markdown);

        $this->info("Migration guide generated: docs/{$filename}");
        $this->line('');
        $this->table(
            ['Category', 'Count'],
            [
                ['Removed Endpoints', count($removed)],
                ['Added Endpoints', count($added)],
                ['Changed Endpoints', count($common)],
            ]
        );

        return 0;
    }

    private function getVersionRoutes(string $version): array
    {
        $routes = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (str_starts_with($uri, $version . '/')) {
                $key = str_replace($version . '/', '', $uri) . ':' . implode('|', $route->methods());
                $routes[$key] = [
                    'uri' => $uri,
                    'methods' => $route->methods(),
                    'action' => $route->getActionName(),
                ];
            }
        }
        return $routes;
    }

    private function generateMarkdown(string $from, string $to, array $removed, array $added, array $common): string
    {
        $md = "# API Migration Guide: {$from} → {$to}\n\n";
        $md .= "Generated: " . now()->toDateTimeString() . "\n\n";

        $md .= "## Summary\n\n";
        $md .= "- **Removed endpoints:** " . count($removed) . "\n";
        $md .= "- **New endpoints:** " . count($added) . "\n";
        $md .= "- **Changed endpoints:** " . count($common) . "\n\n";

        if (!empty($removed)) {
            $md .= "## ⚠️ Removed Endpoints\n\n";
            $md .= "These endpoints no longer exist in {$to}. Please update your client code.\n\n";
            foreach ($removed as $key => $route) {
                $md .= "### `{$key}`\n\n";
                $md .= "- Old path: `/{$route['uri']}`\n";
                $md .= "- Action: Check migration guide for replacement\n\n";
            }
        }

        if (!empty($added)) {
            $md .= "## ✨ New Endpoints\n\n";
            foreach ($added as $key => $route) {
                $md .= "### `{$key}`\n\n";
                $md .= "- Path: `/{$route['uri']}`\n\n";
            }
        }

        $md .= "## Migration Steps\n\n";
        $md .= "1. Update your base URL from `/{$from}/` to `/{$to}/`\n";
        $md .= "2. Review removed endpoints and find alternatives\n";
        $md .= "3. Test your integration against the staging environment\n";
        $md .= "4. Update error handling for new error response format\n";
        $md .= "5. Deploy and monitor\n\n";

        $md .= "## Timeline\n\n";
        $md .= "| Milestone | Date |\n";
        $md .= "|-----------|------|\n";
        $md .= "| {$to} Released | TBD |\n";
        $md .= "| {$from} Deprecated | TBD |\n";
        $md .= "| {$from} Sunset | TBD |\n";

        return $md;
    }
}
```

### 8.2 客户端兼容性测试

```php
<?php
// tests/Feature/ApiCompatibilityTest.php

namespace Tests\Feature;

use Tests\TestCase;

class ApiCompatibilityTest extends TestCase
{
    /**
     * 测试 v1 和 v2 返回兼容的数据结构
     */
    public function test_product_list_response_compatibility(): void
    {
        $v1Response = $this->getJson('/api/v1/products');
        $v2Response = $this->getJson('/api/v2/products');

        // 两个版本都应该返回成功
        $v1Response->assertStatus(200);
        $v2Response->assertStatus(200);

        // 检查核心字段一致性
        $v1Data = $v1Response->json('data');
        $v2Data = $v2Response->json('data');

        $this->assertNotEmpty($v1Data);
        $this->assertNotEmpty($v2Data);

        // 核心字段应该存在
        $requiredFields = ['id', 'name', 'price'];
        foreach ($requiredFields as $field) {
            $this->assertArrayHasKey($field, $v1Data[0]);
            $this->assertArrayHasKey($field, $v2Data[0]);
        }
    }

    /**
     * 测试废弃版本返回正确的 Header
     */
    public function test_deprecated_version_returns_sunset_headers(): void
    {
        $response = $this->getJson('/api/v1/products');

        $response->assertHeader('Sunset');
        $response->assertHeader('Deprecation', 'true');
        $response->assertHeader('X-API-Deprecated', 'true');
        $response->assertHeader('X-API-Version', 'v1');
    }

    /**
     * 测试当前版本不返回废弃 Header
     */
    public function test_current_version_no_deprecation_headers(): void
    {
        $response = $this->getJson('/api/v2/products');

        $response->assertHeaderMissing('Deprecation');
        $response->assertHeaderMissing('X-API-Deprecated');
    }
}
```

## 九、API 下线流程

### 9.1 渐进式限流

```php
<?php
// app/Http/Middleware/DeprecatedVersionRateLimit.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

class DeprecatedVersionRateLimit
{
    public function handle(Request $request, Closure $next)
    {
        $version = $request->get('api_version');
        $deprecatedVersions = config('api.versions.deprecated', []);

        if (!in_array($version, $deprecatedVersions)) {
            return $next($request);
        }

        $config = config("api.sunset.{$version}", []);
        $sunsetDate = \Carbon\Carbon::parse($config['sunset_date']);
        $daysRemaining = now()->diffInDays($sunsetDate, false);

        // 根据剩余天数动态调整限流
        $maxAttempts = match (true) {
            $daysRemaining > 90 => 60,      // 正常限流
            $daysRemaining > 30 => 30,      // 减半
            $daysRemaining > 7  => 10,      // 大幅降低
            $daysRemaining > 0  => 5,       // 几乎不可用
            default => 0,                   // 完全拒绝
        };

        if ($maxAttempts === 0) {
            return response()->json([
                'error' => [
                    'code' => 'VERSION_SUNSET',
                    'message' => "API {$version} has been sunset. Please migrate to the latest version.",
                    'migration_guide' => $config['migration_guide_url'] ?? '',
                ],
            ], 410); // Gone
        }

        $key = 'api-rate-limit:' . $version . ':' . ($request->header('X-Client-ID') ?? $request->ip());

        if (RateLimiter::tooManyAttempts($key, $maxAttempts)) {
            $retryAfter = RateLimiter::availableIn($key);
            
            return response()->json([
                'error' => [
                    'code' => 'RATE_LIMIT_EXCEEDED',
                    'message' => "Rate limit exceeded for deprecated API {$version}. Please migrate to the latest version.",
                    'retry_after' => $retryAfter,
                    'migration_guide' => $config['migration_guide_url'] ?? '',
                ],
            ], 429)->withHeaders([
                'Retry-After' => $retryAfter,
                'X-RateLimit-Limit' => $maxAttempts,
                'X-RateLimit-Remaining' => 0,
            ]);
        }

        RateLimiter::hit($key, 60); // 1 分钟窗口

        $response = $next($request);

        return $response->withHeaders([
            'X-RateLimit-Limit' => $maxAttempts,
            'X-RateLimit-Remaining' => RateLimiter::remaining($key, $maxAttempts),
        ]);
    }
}
```

### 9.2 下线检查清单

```php
<?php
// app/Console/Commands/SunsetChecklist.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SunsetChecklist extends Command
{
    protected $signature = 'api:sunset-checklist {version : API version to check}';

    protected $description = 'Check if an API version is ready for sunset';

    public function handle(): int
    {
        $version = $this->argument('version');
        $config = config("api.sunset.{$version}");

        if (!$config) {
            $this->error("No sunset configuration found for {$version}");
            return 1;
        }

        $this->info("Sunset Readiness Checklist for {$version}");
        $this->line(str_repeat('=', 50));

        $checks = [];

        // 1. 使用量检查
        $recentUsage = DB::table('api_usage_logs')
            ->where('api_version', $version)
            ->where('created_at', '>=', now()->subDays(7))
            ->count();

        $checks[] = [
            'Check' => 'Zero recent usage (7 days)',
            'Status' => $recentUsage === 0 ? '✅ PASS' : '❌ FAIL',
            'Detail' => "{$recentUsage} requests in last 7 days",
        ];

        // 2. 活跃客户端检查
        $activeClients = DB::table('api_usage_logs')
            ->where('api_version', $version)
            ->where('created_at', '>=', now()->subDays(30))
            ->distinct('client_id')
            ->count('client_id');

        $checks[] = [
            'Check' => 'No active clients',
            'Status' => $activeClients === 0 ? '✅ PASS' : '❌ FAIL',
            'Detail' => "{$activeClients} clients still active",
        ];

        // 3. Sunset 日期检查
        $sunsetDate = \Carbon\Carbon::parse($config['sunset_date']);
        $isPastSunset = now()->isAfter($sunsetDate);

        $checks[] = [
            'Check' => 'Past sunset date',
            'Status' => $isPastSunset ? '✅ PASS' : '⚠️  NOT YET',
            'Detail' => "Sunset date: {$config['sunset_date']}",
        ];

        // 4. 通知完成检查
        $lastNotification = DB::table('api_deprecation_notifications')
            ->where('api_version', $version)
            ->orderByDesc('created_at')
            ->first();

        $checks[] = [
            'Check' => 'Notifications sent',
            'Status' => $lastNotification ? '✅ PASS' : '❌ FAIL',
            'Detail' => $lastNotification 
                ? "Last notification: {$lastNotification->created_at}" 
                : 'No notifications sent',
        ];

        // 5. 依赖服务检查
        $checks[] = [
            'Check' => 'No dependent internal services',
            'Status' => '⚠️  MANUAL CHECK',
            'Detail' => 'Verify no internal services depend on this version',
        ];

        // 输出结果
        $this->table(['Check', 'Status', 'Detail'], $checks);

        $failedCount = collect($checks)->filter(fn($c) => str_contains($c['Status'], 'FAIL'))->count();
        $warnCount = collect($checks)->filter(fn($c) => str_contains($c['Status'], '⚠️'))->count();

        $this->line('');
        if ($failedCount > 0) {
            $this->error("❌ {$failedCount} checks failed. Cannot sunset yet.");
        } elseif ($warnCount > 0) {
            $this->warn("⚠️  {$warnCount} warnings. Review before proceeding.");
        } else {
            $this->info("✅ All checks passed. Ready for sunset!");
        }

        return 0;
    }
}
```

## 十、中间件注册与路由

```php
<?php
// app/Http/Kernel.php

namespace App\Http;

use Illuminate\Foundation\Http\Kernel as HttpKernel;

class Kernel extends HttpKernel
{
    protected $middlewareGroups = [
        'api' => [
            \App\Http\Middleware\TrackApiUsage::class,
            \App\Http\Middleware\ApiVersionNegotiation::class,
            \App\Http\Middleware\SunsetHeader::class,
            \App\Http\Middleware\DeprecationNotice::class,
            \App\Http\Middleware\DeprecatedVersionRateLimit::class,
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
            \Illuminate\Routing\Middleware\ThrottleRequests::class.':api',
        ],
    ];
}
```

## 十一、监控与告警

### 11.1 Grafana Dashboard 查询

```sql
-- 各版本请求量趋势
SELECT 
    DATE(created_at) as date,
    api_version,
    COUNT(*) as requests,
    COUNT(DISTINCT client_id) as unique_clients
FROM api_usage_logs
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at), api_version
ORDER BY date;

-- 废弃版本使用量占比
SELECT 
    api_version,
    COUNT(*) as total_requests,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM api_usage_logs
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY api_version;
```

### 11.2 告警规则

```yaml
# prometheus/alert-rules.yml
groups:
  - name: api_sunset_alerts
    rules:
      - alert: DeprecatedApiStillActive
        expr: sum(rate(api_requests_total{version="v1"}[1d])) > 0
        for: 1d
        labels:
          severity: warning
        annotations:
          summary: "Deprecated API v1 still receiving traffic"
          description: "{{ $value }} requests/day to deprecated v1 API"

      - alert: SunsetDeadlineApproaching
        expr: (api_sunset_timestamp - time()) / 86400 < 30
        for: 1h
        labels:
          severity: critical
        annotations:
          summary: "API sunset deadline in less than 30 days"
```

## 十二、完整工作流总结

```
API 生命周期管理完整流程：

1. 设计阶段
   └── OpenAPI 契约 → 设计评审 → 确定版本策略

2. 开发阶段
   └── 实现 → 测试 → 文档生成 → 部署

3. 稳定阶段
   └── 监控使用量 → 收集反馈 → 规划下一版本

4. 废弃阶段（新版发布后）
   └── v2 发布
   └── v1 标记 Deprecated
   └── 添加 Sunset Header
   └── 发送客户端通知
   └── 生成迁移指南

5. 迁移阶段
   └── 监控迁移进度
   └── 渐进式限流
   └── 逐一通知未迁移客户端
   └── 定期生成使用量报告

6. 下线阶段
   └── 确认零流量
   └── 检查清单通过
   └── 返回 410 Gone
   └── 归档代码
```

## 总结

API 生命周期管理不是一次性工作，而是一个持续的过程。通过 RFC 8594 Sunset Header 和 Deprecation Header 的标准化实现，配合自动化的使用量监控和客户端通知系统，你可以优雅地管理 API 的完整生命周期，避免"僵尸 API"的出现。

关键要点：
1. **契约先行**：用 OpenAPI 定义 API，再实现
2. **版本策略明确**：选择 URL/Header/Query 版本控制方式并坚持
3. **标准化通知**：使用 Sunset + Deprecation Header
4. **自动化监控**：追踪每个版本的使用量和活跃客户端
5. **渐进式下线**：限流 → 通知 → 确认零流量 → 下线

记住：**好的 API 管理，让客户端迁移变得无痛。**

---

*本文基于 Laravel 11 + PHP 8.3 实现，所有标准遵循 RFC 8594 和相关 HTTP 规范。*

## 相关阅读

- [API 版本废弃策略实战：Sunset Header、Deprecation 通知与客户端迁移的工程化方案](/categories/架构/API-版本废弃策略实战-Sunset-Header-Deprecation-通知与客户端迁移的工程化方案/)
- [API 版本控制进阶：URL/Header/MediaType 三种策略的工程实践](/categories/PHP/Laravel/API-版本控制进阶-URL-Header-MediaType-三种策略的工程实践/)
- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击](/categories/架构/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录/)
- [Architectural Decision Records (ADR) 实战：用 Markdown 管理架构决策](/categories/架构/Architectural-Decision-Records-ADR-实战-用Markdown管理架构决策/)
