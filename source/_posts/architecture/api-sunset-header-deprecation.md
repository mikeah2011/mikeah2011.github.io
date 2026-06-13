---
title: API 版本废弃策略实战：Sunset Header、Deprecation 通知与客户端迁移的工程化方案
date: 2026-06-02 12:00:00
tags: [API, REST, 版本管理, Sunset, Deprecation]
keywords: [API, Sunset Header, Deprecation, 版本废弃策略实战, 通知与客户端迁移的工程化方案, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: API 废弃不是删代码，而是涉及技术、沟通、运营的系统工程。本文介绍基于 RFC 8594 标准的 Sunset Header 和 Deprecation Header 工程化方案，涵盖 Laravel 中间件实现、客户端多渠道通知系统、流量监控仪表盘、渐进式下线策略与迁移截止日期管理。适用于需要优雅迭代 API 版本的后端团队，帮助在不停机的前提下安全完成旧版本下线。
---


# API 版本废弃策略实战：Sunset Header、Deprecation 通知与客户端迁移的工程化方案

## 前言

你发布了一个 API v1，用户在用。现在你发布了 v2，想要废弃 v1。问题来了：

- 怎么通知用户"这个 API 快不能用了"？
- 怎么给用户足够的时间迁移？
- 怎么在不停机的情况下逐步下线旧版本？
- 怎么监控还有多少用户在用旧版本？

很多团队的做法是"直接删掉旧 API"或者"永远保留旧 API 从不清理"。前者会导致用户服务中断，后者会导致代码库越来越臃肿、维护成本越来越高。

本文将介绍一套**工程化的 API 废弃方案**：基于 RFC 标准的 Sunset Header、Deprecation Header、客户端通知系统、流量监控、渐进式下线——从 Laravel 实现到完整的工作流设计。

---

## 一、API 版本管理策略回顾

### 1.1 三种主流版本策略

**URL 路径版本（最常用）**

```
GET /api/v1/users
GET /api/v2/users
```

优点：直观、易缓存、易路由
缺点：URL 膨胀、暗示"每个版本是完全不同的 API"

**Header 版本**

```
GET /api/users
Accept: application/vnd.myapp.v2+json
```

优点：URL 简洁、符合 REST 理念
缺点：不易缓存、客户端容易忘记设置

**Query 参数版本**

```
GET /api/users?version=2
```

优点：实现简单
缺点：缓存 key 不同、容易被忽略

### 1.2 推荐策略：URL 路径 + Header 辅助

```
URL 路径：用于路由和大版本区分（v1, v2, v3...）
Header：  用于小版本和功能协商（Accept, Deprecation, Sunset）
```

```php
// routes/api.php
Route::prefix('v1')->group(function () {
    Route::apiResource('users', V1\UserController::class);
});

Route::prefix('v2')->group(function () {
    Route::apiResource('users', V2\UserController::class);
});
```

---

## 二、RFC 8594 Sunset Header

### 2.1 规范解读

RFC 8594 定义了 `Sunset` HTTP 头，用于表示一个 URI 或资源将在特定日期之后不再可用。

```
HTTP/1.1 200 OK
Sunset: Sat, 01 Jan 2027 00:00:00 GMT
Link: <https://api.example.com/v2/users>; rel="successor-version"
```

关键字段：
- **Sunset**：资源下线的日期（必填）
- **Link: rel="successor-version"**：指向替代版本的 URL（推荐）
- **Link: rel="deprecation"**：指向废弃说明文档

### 2.2 Laravel 中间件实现

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SunsetHeaderMiddleware
{
    /**
     * API 版本的 Sunset 配置
     */
    protected array $sunsetConfig = [
        'v1' => [
            'sunset_date' => '2027-01-01',
            'successor_version' => 'v2',
            'deprecation_uri' => 'https://docs.example.com/api/deprecation/v1',
            'message' => 'API v1 将于 2027-01-01 下线，请迁移到 v2。',
        ],
        // v2 还没有 Sunset 计划
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $version = $this->extractVersion($request);

        if ($version && isset($this->sunsetConfig[$version])) {
            $config = $this->sunsetConfig[$version];
            $response = $this->addSunsetHeaders($response, $config, $version);
        }

        return $response;
    }

    protected function extractVersion(Request $request): ?string
    {
        // 从 URL 路径提取版本
        if (preg_match('#/api/(v\d+)/#', $request->path(), $matches)) {
            return $matches[1];
        }

        // 从 Accept Header 提取版本
        if (preg_match('#application/vnd\.myapp\.(v\d+)\+json#', $request->header('Accept', ''), $matches)) {
            return $matches[1];
        }

        return null;
    }

    protected function addSunsetHeaders(
        Response $response,
        array $config,
        string $version
    ): Response {
        // Sunset Header (RFC 8594)
        $sunsetDate = new \DateTime($config['sunset_date']);
        $response->headers->set('Sunset', $sunsetDate->format('D, d M Y H:i:s \G\M\T'));

        // Link Header
        $links = [];

        if (isset($config['successor_version'])) {
            $successorUrl = str_replace(
                "/{$version}/",
                "/{$config['successor_version']}/",
                request()->url()
            );
            $links[] = "<{$successorUrl}>; rel=\"successor-version\"";
        }

        if (isset($config['deprecation_uri'])) {
            $links[] = "<{$config['deprecation_uri']}>; rel=\"deprecation\"";
        }

        if (!empty($links)) {
            $response->headers->set('Link', implode(', ', $links));
        }

        // Deprecation Header (draft-ietf-httpapi-deprecation-header)
        $response->headers->set('Deprecation', $sunsetDate->format('D, d M Y H:i:s \G\M\T'));

        // 自定义头部：人类可读的废弃信息
        $response->headers->set('X-Deprecation-Notice', $config['message'] ?? '');

        // 计算剩余天数
        $daysRemaining = now()->diffInDays($sunsetDate, false);
        if ($daysRemaining > 0) {
            $response->headers->set('X-Sunset-Days-Remaining', (string) $daysRemaining);
        }

        return $response;
    }
}
```

注册中间件：

```php
// bootstrap/app.php (Laravel 11+)
->withMiddleware(function (Middleware $middleware) {
    $middleware->api(prepend: [
        \App\Http\Middleware\SunsetHeaderMiddleware::class,
    ]);
})
```

### 2.3 实际响应示例

```
HTTP/1.1 200 OK
Content-Type: application/json
Sunset: Sat, 01 Jan 2027 00:00:00 GMT
Deprecation: Sat, 01 Jan 2027 00:00:00 GMT
Link: <https://api.example.com/v2/users>; rel="successor-version",
      <https://docs.example.com/api/deprecation/v1>; rel="deprecation"
X-Deprecation-Notice: API v1 将于 2027-01-01 下线，请迁移到 v2。
X-Sunset-Days-Remaining: 213

{
    "data": [
        {"id": 1, "name": "Alice"},
        {"id": 2, "name": "Bob"}
    ]
}
```

---

## 三、客户端废弃通知系统

### 3.1 多渠道通知架构

仅靠 HTTP Header 是不够的——很多开发者不检查响应头。你需要一个完整的通知系统：

```
┌──────────────────┐
│  废弃配置管理     │
│  (Admin Panel)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌─────────────────┐
│  通知调度器       │────→│  邮件通知        │
│  (Notification   │     │  (SendGrid)     │
│   Dispatcher)    │     └─────────────────┘
│                  │     ┌─────────────────┐
│                  │────→│  Webhook 通知    │
│                  │     │  (客户系统)      │
│                  │     └─────────────────┘
│                  │     ┌─────────────────┐
│                  │────→│  Dashboard 通知  │
│                  │     │  (API Portal)   │
└──────────────────┘     └─────────────────┘
```

### 3.2 数据模型设计

```php
<?php
// migration: create_api_deprecation_notices_table

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_deprecation_notices', function (Blueprint $table) {
            $table->id();
            $table->string('api_version');           // v1
            $table->string('endpoint');              // /api/v1/users
            $table->string('method')->default('*');  // GET, POST, *
            $table->datetime('deprecated_at');       // 废弃日期
            $table->datetime('sunset_at');           // 下线日期
            $table->string('successor_endpoint')->nullable();
            $table->text('migration_guide_url')->nullable();
            $table->text('reason')->nullable();
            $table->enum('status', ['announced', 'warning', 'critical', 'sunset'])
                ->default('announced');
            $table->timestamps();
        });

        Schema::create('api_deprecation_notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deprecation_notice_id')
                ->constrained('api_deprecation_notices');
            $table->string('client_id');             // API 客户端 ID
            $table->string('channel');               // email, webhook, dashboard
            $table->datetime('notified_at');
            $table->enum('acknowledged', ['pending', 'acknowledged', 'ignored'])
                ->default('pending');
            $table->datetime('acknowledged_at')->nullable();
            $table->timestamps();
        });

        Schema::create('api_client_usage', function (Blueprint $table) {
            $table->id();
            $table->string('client_id');
            $table->string('api_version');
            $table->string('endpoint');
            $table->string('method');
            $table->unsignedInteger('request_count')->default(0);
            $table->date('date');
            $table->timestamps();

            $table->unique(['client_id', 'api_version', 'endpoint', 'method', 'date']);
        });
    }
};
```

### 3.3 流量监控中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class ApiUsageTrackingMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // 只追踪版本化的 API 请求
        $version = $this->extractVersion($request);
        if (!$version) {
            return $response;
        }

        // 异步记录使用情况（避免影响响应时间）
        dispatch(function () use ($request, $version) {
            $this->recordUsage($request, $version);
        });

        return $response;
    }

    protected function recordUsage(Request $request, string $version): void
    {
        $clientId = $request->header('X-Api-Key')
            ?? $request->user()?->id
            ?? 'anonymous';

        DB::table('api_client_usage')->upsert(
            [
                'client_id' => $clientId,
                'api_version' => $version,
                'endpoint' => $request->path(),
                'method' => $request->method(),
                'date' => now()->toDateString(),
                'request_count' => DB::raw('request_count + 1'),
            ],
            ['client_id', 'api_version', 'endpoint', 'method', 'date'],
            ['request_count' => DB::raw('request_count + 1')]
        );
    }

    protected function extractVersion(Request $request): ?string
    {
        if (preg_match('#/api/(v\d+)/#', $request->path(), $matches)) {
            return $matches[1];
        }
        return null;
    }
}
```

### 3.4 通知发送服务

```php
<?php

namespace App\Services\ApiDeprecation;

use App\Models\ApiDeprecationNotice;
use App\Models\ApiClient;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class DeprecationNotificationService
{
    /**
     * 根据废弃阶段发送不同级别的通知
     */
    public function sendNotifications(ApiDeprecationNotice $notice): void
    {
        $affectedClients = $this->getAffectedClients($notice);

        foreach ($affectedClients as $client) {
            $this->sendToClient($notice, $client);
        }
    }

    protected function getAffectedClients(ApiDeprecationNotice $notice): array
    {
        // 从使用记录中找出仍在使用该 API 的客户端
        return DB::table('api_client_usage')
            ->join('api_clients', 'api_client_usage.client_id', '=', 'api_clients.id')
            ->where('api_version', $notice->api_version)
            ->where('endpoint', 'like', $notice->endpoint . '%')
            ->where('date', '>=', now()->subDays(30)->toDateString())
            ->distinct()
            ->get(['api_clients.*'])
            ->toArray();
    }

    protected function sendToClient(ApiDeprecationNotice $notice, ApiClient $client): void
    {
        // 邮件通知
        $this->sendEmail($notice, $client);

        // Webhook 通知（如果客户配置了回调 URL）
        if ($client->webhook_url) {
            $this->sendWebhook($notice, $client);
        }

        // 记录通知
        DB::table('api_deprecation_notifications')->insert([
            'deprecation_notice_id' => $notice->id,
            'client_id' => $client->id,
            'channel' => 'multi',
            'notified_at' => now(),
        ]);
    }

    protected function sendEmail(ApiDeprecationNotice $notice, ApiClient $client): void
    {
        $daysRemaining = now()->diffInDays($notice->sunset_at);

        $subject = match (true) {
            $daysRemaining > 60 => "📋 API {$notice->api_version} 废弃预告 - {$daysRemaining} 天后下线",
            $daysRemaining > 14 => "⚠️ API {$notice->api_version} 即将下线 - 仅剩 {$daysRemaining} 天",
            default => "🚨 紧急：API {$notice->api_version} 将在 {$daysRemaining} 天后下线",
        };

        Mail::send('emails.api-deprecation', [
            'notice' => $notice,
            'client' => $client,
            'daysRemaining' => $daysRemaining,
            'migrationGuideUrl' => $notice->migration_guide_url,
        ], function ($message) use ($client, $subject) {
            $message->to($client->email)
                    ->subject($subject);
        });
    }

    protected function sendWebhook(ApiDeprecationNotice $notice, ApiClient $client): void
    {
        $payload = [
            'event' => 'api_deprecation',
            'api_version' => $notice->api_version,
            'endpoint' => $notice->endpoint,
            'sunset_at' => $notice->sunset_at->toIso8601String(),
            'successor_endpoint' => $notice->successor_endpoint,
            'migration_guide' => $notice->migration_guide_url,
            'days_remaining' => now()->diffInDays($notice->sunset_at),
        ];

        try {
            Http::timeout(5)
                ->withHeaders([
                    'X-Webhook-Event' => 'api_deprecation',
                    'X-Webhook-Signature' => $this->sign($payload, $client->webhook_secret),
                ])
                ->post($client->webhook_url, $payload);
        } catch (\Exception $e) {
            Log::warning("Failed to send deprecation webhook", [
                'client_id' => $client->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    protected function sign(array $payload, string $secret): string
    {
        return hash_hmac('sha256', json_encode($payload), $secret);
    }
}
```

### 3.5 邮件模板

```blade
{{-- resources/views/emails/api-deprecation.blade.php --}}
@component('mail::message')
# API {{ $notice->api_version }} 废弃通知

尊敬的 {{ $client->company_name }}，

我们的 **API {{ $notice->api_version }}** 将于 **{{ $notice->sunset_at->format('Y年m月d日') }}** 正式下线。

## 影响范围

| 项目 | 详情 |
|------|------|
| 废弃版本 | {{ $notice->api_version }} |
| 影响接口 | {{ $notice->endpoint }} |
| 下线日期 | {{ $notice->sunset_at->format('Y-m-d') }} |
| 剩余天数 | {{ $daysRemaining }} 天 |
| 替代版本 | {{ $notice->successor_endpoint ?: '无直接替代' }} |

## 您的使用情况

根据我们的监控数据，您的应用在过去 30 天内调用了该接口。
请尽快安排迁移到新版本。

## 迁移指南

@component('mail::button', ['url' => $notice->migration_guide_url])
查看迁移指南
@endcomponent

## 主要变更

{{ $notice->reason }}

## 需要帮助？

如果您在迁移过程中遇到问题，请联系我们的技术支持：
- 邮箱：api-support@example.com
- 文档：https://docs.example.com/api

谢谢，
{{ config('app.name') }} API 团队
@endcomponent
```

---

## 四、渐进式下线流程

### 4.1 废弃生命周期

```
Phase 1: Announced (公告期)        - 发布废弃公告，邮件通知
    ↓ 90 天
Phase 2: Warning (警告期)          - 响应头加警告，Dashboard 显示
    ↓ 60 天
Phase 3: Critical (紧急期)         - 每周邮件提醒，限速降级
    ↓ 30 天
Phase 4: Sunset (下线)             - 返回 410 Gone
    ↓ 30 天
Phase 5: Removed (移除)            - 删除代码和路由
```

### 4.2 限速降级策略

在紧急期，逐步降低旧 API 的性能，引导用户迁移：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Support\Facades\RateLimiter;

class DeprecationRateLimitMiddleware
{
    /**
     * 不同阶段的限速策略
     */
    protected array $rateLimits = [
        'announced' => null,         // 不限速
        'warning' => 100,            // 每分钟 100 次
        'critical' => 20,            // 每分钟 20 次
        'sunset' => 0,               // 完全阻断
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $version = $this->extractVersion($request);
        $phase = $this->getDeprecationPhase($version);

        if (!$phase || !$this->rateLimits[$phase]) {
            return $next($request);
        }

        // Sunset 阶段直接返回 410 Gone
        if ($phase === 'sunset') {
            return response()->json([
                'error' => 'gone',
                'message' => "API {$version} 已于 {$this->getSunsetDate($version)} 下线。",
                'migration_guide' => $this->getMigrationGuideUrl($version),
                'successor' => $this->getSuccessorUrl($request),
            ], 410);
        }

        // 限速检查
        $clientId = $request->header('X-Api-Key')
            ?? $request->user()?->id
            ?? $request->ip();

        $key = "deprecated_api:{$version}:{$clientId}";
        $maxAttempts = $this->rateLimits[$phase];

        if (RateLimiter::tooManyAttempts($key, $maxAttempts)) {
            $retryAfter = RateLimiter::availableIn($key);

            return response()->json([
                'error' => 'rate_limited',
                'message' => "API {$version} 已废弃，当前限速为 {$maxAttempts} 次/分钟。请尽快迁移到新版本。",
                'retry_after' => $retryAfter,
                'migration_guide' => $this->getMigrationGuideUrl($version),
            ], 429)->withHeaders([
                'Retry-After' => $retryAfter,
                'X-RateLimit-Limit' => $maxAttempts,
                'X-RateLimit-Remaining' => 0,
            ]);
        }

        RateLimiter::hit($key, 60);

        $response = $next($request);

        // 添加限速相关头部
        $response->headers->set('X-RateLimit-Limit', $maxAttempts);
        $response->headers->set(
            'X-RateLimit-Remaining',
            RateLimiter::remaining($key, $maxAttempts)
        );

        return $response;
    }

    protected function getDeprecationPhase(?string $version): ?string
    {
        if (!$version) return null;

        $notice = DB::table('api_deprecation_notices')
            ->where('api_version', $version)
            ->where('status', '!=', 'removed')
            ->first();

        return $notice?->status;
    }

    // ... 辅助方法省略
}
```

### 4.3 Sunset 后的 410 Gone 响应

```php
<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;

class SunsetController extends Controller
{
    /**
     * 处理已下线 API 的请求
     */
    public function handleSunset(string $version): JsonResponse
    {
        return response()->json([
            'error' => 'gone',
            'message' => "API {$version} 已经下线。",
            'documentation' => 'https://docs.example.com/api/migration',
            'contact' => 'api-support@example.com',
            'available_versions' => ['v2', 'v3'],
        ], 410)->withHeaders([
            'Sunset' => 'Sat, 01 Jan 2027 00:00:00 GMT',
            'Link' => '</v2>; rel="successor-version"',
            'Content-Type' => 'application/problem+json',
        ]);
    }
}
```

---

## 五、迁移指南自动化

### 5.1 变更日志自动生成

```php
<?php

namespace App\Services\ApiDeprecation;

use Illuminate\Support\Facades\File;

class ChangelogGenerator
{
    /**
     * 从代码变更中自动生成 API 变更日志
     */
    public function generate(string $fromVersion, string $toVersion): array
    {
        $changes = [];

        // 读取两个版本的路由定义
        $oldRoutes = $this->extractRoutes($fromVersion);
        $newRoutes = $this->extractRoutes($toVersion);

        // 检测删除的端点
        foreach ($oldRoutes as $route) {
            if (!isset($newRoutes[$route['path']])) {
                $changes[] = [
                    'type' => 'removed',
                    'endpoint' => $route['path'],
                    'method' => $route['method'],
                    'message' => "端点 {$route['method']} {$route['path']} 已在 {$toVersion} 中移除。",
                    'migration' => '请检查是否有替代端点。',
                ];
            }
        }

        // 检测新增的端点
        foreach ($newRoutes as $route) {
            if (!isset($oldRoutes[$route['path']])) {
                $changes[] = [
                    'type' => 'added',
                    'endpoint' => $route['path'],
                    'method' => $route['method'],
                    'message' => "新增端点 {$route['method']} {$route['path']}。",
                ];
            }
        }

        // 检测响应格式变更
        $changes = array_merge($changes, $this->detectResponseChanges($fromVersion, $toVersion));

        return $changes;
    }

    protected function detectResponseChanges(string $from, string $to): array
    {
        // 对比两个版本的 API Resource 类
        $changes = [];

        $oldResources = File::glob(app_path("Http/Resources/{$from}/*.php"));
        $newResources = File::glob(app_path("Http/Resources/{$to}/*.php"));

        foreach ($oldResources as $oldFile) {
            $className = pathinfo($oldFile, PATHINFO_FILENAME);
            $newFile = app_path("Http/Resources/{$to}/{$className}.php");

            if (File::exists($newFile)) {
                $diff = $this->compareResourceFiles($oldFile, $newFile);
                if (!empty($diff)) {
                    $changes[] = [
                        'type' => 'modified',
                        'resource' => $className,
                        'changes' => $diff,
                    ];
                }
            }
        }

        return $changes;
    }
}
```

### 5.2 迁移测试工具

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class ApiMigrationTest extends Command
{
    protected $signature = 'api:migration-test
        {--from=v1 : 源版本}
        {--to=v2 : 目标版本}
        {--endpoint=* : 要测试的端点}';

    protected $description = '测试 API 迁移的兼容性';

    public function handle(): int
    {
        $from = $this->option('from');
        $to = $this->option('to');
        $endpoints = $this->option('endpoint');

        $this->info("测试 {$from} → {$to} 的迁移兼容性...");
        $this->newLine();

        $results = [];

        foreach ($endpoints as $endpoint) {
            $result = $this->testEndpoint($from, $to, $endpoint);
            $results[] = $result;

            $status = $result['compatible'] ? '✅' : '❌';
            $this->line("  {$status} {$endpoint}");
        }

        $this->newLine();

        $compatible = collect($results)->where('compatible', true)->count();
        $total = count($results);

        $this->info("结果：{$compatible}/{$total} 个端点兼容");

        if ($compatible < $total) {
            $this->newLine();
            $this->error("不兼容的端点需要修改客户端代码：");

            foreach ($results as $result) {
                if (!$result['compatible']) {
                    $this->line("  - {$result['endpoint']}: {$result['reason']}");
                }
            }
        }

        return $compatible === $total ? 0 : 1;
    }

    protected function testEndpoint(string $from, string $to, string $endpoint): array
    {
        $fromResponse = $this->callApi($from, $endpoint);
        $toResponse = $this->callApi($to, $endpoint);

        // 比较响应结构
        $fromKeys = $this->extractJsonKeys($fromResponse);
        $toKeys = $this->extractJsonKeys($toResponse);

        $removedKeys = array_diff($fromKeys, $toKeys);
        $addedKeys = array_diff($toKeys, $fromKeys);

        $compatible = empty($removedKeys);

        return [
            'endpoint' => $endpoint,
            'compatible' => $compatible,
            'removed_fields' => $removedKeys,
            'added_fields' => $addedKeys,
            'reason' => $compatible ? '' : "移除了字段: " . implode(', ', $removedKeys),
        ];
    }

    protected function callApi(string $version, string $endpoint): array
    {
        $response = \Http::withHeaders([
            'Accept' => 'application/json',
            'Authorization' => 'Bearer ' . config('services.api.test_token'),
        ])->get("http://localhost:8000/api/{$version}{$endpoint}");

        return $response->json();
    }
}
```

---

## 六、API 管理平台集成

### 6.1 基于 Laravel 的 API 管理 Dashboard

```php
<?php

namespace App\Http\Controllers\Admin;

use App\Models\ApiDeprecationNotice;
use App\Models\ApiClientUsage;
use Illuminate\Http\JsonResponse;

class ApiDeprecationController extends Controller
{
    /**
     * 废弃管理 Dashboard 数据
     */
    public function dashboard(): JsonResponse
    {
        // 获取所有废弃通知
        $notices = ApiDeprecationNotice::with('notifications')->get();

        // 获取使用统计
        $usageStats = [];
        foreach ($notices as $notice) {
            $usageStats[$notice->api_version] = [
                'active_clients' => ApiClientUsage::where('api_version', $notice->api_version)
                    ->where('date', '>=', now()->subDays(30))
                    ->distinct('client_id')
                    ->count(),
                'total_requests_30d' => ApiClientUsage::where('api_version', $notice->api_version)
                    ->where('date', '>=', now()->subDays(30))
                    ->sum('request_count'),
                'requests_trend' => ApiClientUsage::where('api_version', $notice->api_version)
                    ->where('date', '>=', now()->subDays(30))
                    ->groupBy('date')
                    ->selectRaw('date, SUM(request_count) as total')
                    ->orderBy('date')
                    ->get(),
            ];
        }

        return response()->json([
            'notices' => $notices,
            'usage_stats' => $usageStats,
            'summary' => [
                'total_deprecated_versions' => $notices->count(),
                'active_clients_on_deprecated' => ApiClientUsage::whereIn(
                    'api_version',
                    $notices->pluck('api_version')
                )
                    ->where('date', '>=', now()->subDays(30))
                    ->distinct('client_id')
                    ->count(),
                'days_until_next_sunset' => $notices
                    ->where('sunset_at', '>', now())
                    ->sortBy('sunset_at')
                    ->first()?->sunset_at->diffInDays(now()),
            ],
        ]);
    }

    /**
     * 获取某个版本的详细客户端使用情况
     */
    public function clientUsage(string $version): JsonResponse
    {
        $clients = ApiClientUsage::where('api_version', $version)
            ->where('date', '>=', now()->subDays(90))
            ->join('api_clients', 'api_client_usage.client_id', '=', 'api_clients.id')
            ->groupBy('client_id', 'api_clients.name', 'api_clients.email')
            ->selectRaw('
                client_id,
                api_clients.name,
                api_clients.email,
                SUM(request_count) as total_requests,
                MAX(date) as last_used
            ')
            ->orderByDesc('total_requests')
            ->get();

        return response()->json([
            'version' => $version,
            'clients' => $clients,
            'total_clients' => $clients->count(),
            'migrated_clients' => $clients->filter(fn($c) => $c->migrated)->count(),
        ]);
    }
}
```

### 6.2 与 Stoplight/OpenAPI 集成

```php
<?php

namespace App\Services\ApiDeprecation;

use Illuminate\Support\Facades\File;

class OpenApiDocGenerator
{
    /**
     * 在 OpenAPI spec 中标记废弃端点
     */
    public function generateDeprecatedSpec(string $version): array
    {
        $specFile = base_path("docs/api/{$version}/openapi.yaml");
        $spec = yaml_parse_file($specFile);

        // 添加废弃标记
        $deprecationNotice = DB::table('api_deprecation_notices')
            ->where('api_version', $version)
            ->first();

        if ($deprecationNotice) {
            $sunsetDate = $deprecationNotice->sunset_at->format('Y-m-d');

            foreach ($spec['paths'] as $path => &$methods) {
                foreach ($methods as $method => &$operation) {
                    $operation['deprecated'] = true;
                    $operation['x-sunset'] = $sunsetDate;
                    $operation['x-migration-guide'] = $deprecationNotice->migration_guide_url;
                    $operation['description'] = "⚠️ **已废弃** - 将于 {$sunsetDate} 下线。\n\n"
                        . ($operation['description'] ?? '');
                }
            }

            // 添加 info 级别的废弃说明
            $spec['info']['x-deprecated'] = true;
            $spec['info']['x-sunset-date'] = $sunsetDate;
        }

        return $spec;
    }
}
```

---

## 七、实战案例：电商 API v1 到 v2 的完整迁移

### 7.1 背景

```
当前状态：
  - API v1 运行 2 年，127 个活跃客户端
  - 日均请求量：500 万次
  - v2 已开发完成，向后兼容 90% 的端点

目标：
  - 6 个月内完成 v1 到 v2 的全面迁移
  - 零停机、零数据丢失
  - 所有客户端都成功迁移
```

### 7.2 时间线

```
Month 1 (Phase 1 - Announced):
  ├── 发布 v2 正式版
  ├── v1 所有响应添加 Sunset 和 Deprecation Header
  ├── 向所有 127 个客户端发送邮件通知
  ├── 发布迁移指南文档
  └── 建立迁移支持 Slack 频道

Month 2 (Phase 2 - Warning):
  ├── v1 Dashboard 显示醒目警告
  ├── 每两周发送进度报告邮件
  ├── 主动联系尚未开始迁移的大客户
  └── 发布迁移工具包（SDK 双版本兼容）

Month 3 (Phase 3 - Critical):
  ├── v1 限速至 100 次/分钟
  ├── 每周发送紧急提醒邮件
  ├── 安排 1v1 迁移支持会议
  └── 监控迁移进度 Dashboard

Month 4-5 (Phase 4 - Final):
  ├── v1 限速至 20 次/分钟
  ├── 每天发送提醒
  ├── 最后通牒邮件
  └── 帮助剩余客户完成迁移

Month 6 (Phase 5 - Sunset):
  ├── v1 返回 410 Gone
  ├── 保留 30 天的 410 响应
  ├── 最终删除 v1 代码
  └── 庆祝 🎉
```

### 7.3 最终结果

```
迁移前：
  - v1 活跃客户端：127 个
  - v1 日均请求：500 万次
  - v2 日均请求：0

迁移后：
  - v1 活跃客户端：0 个
  - v1 日均请求：0
  - v2 日均请求：520 万次
  - 迁移成功率：100%
  - 客户投诉：0
  - 服务中断时间：0
```

---

## 八、最佳实践清单

### 8.1 废弃策略

```
✅ 每个 API 版本有明确的生命周期计划
✅ 废弃通知至少提前 90 天
✅ 提供详细的迁移指南和代码示例
✅ 提供迁移工具包和 SDK
✅ 主动联系高频使用旧版本的客户端
```

### 8.2 技术实现

```
✅ 遵循 RFC 8594 (Sunset) 和 draft-ietf-httpapi-deprecation-header
✅ 流量监控精确到客户端级别
✅ 渐进式限速引导迁移
✅ 410 Gone 响应包含迁移信息
✅ 保留足够的 410 响应时间窗口
```

### 8.3 沟通策略

```
✅ 多渠道通知：邮件 + Webhook + Dashboard + 状态页
✅ 通知频率随截止日期临近而增加
✅ 提供迁移支持渠道（Slack/工单/会议）
✅ 定期发布迁移进度报告
✅ 最后通牒前进行一对一沟通
```

---

## 总结

API 废弃不是"删代码"——它是一个涉及技术、沟通、运营的系统工程。通过遵循 RFC 标准（Sunset Header、Deprecation Header）、建立完整的客户端通知系统、实施渐进式下线策略，你可以优雅地完成 API 版本的迭代，同时维护好与客户端的信任关系。

关键原则：**给用户足够的时间和信息来迁移，永远不要突然关闭 API。**

---

*参考资源：*
- [RFC 8594 - The Sunset HTTP Header Field](https://datatracker.ietf.org/doc/html/rfc8594)
- [draft-ietf-httpapi-deprecation-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-deprecation-header/)
- [API Deprecation Best Practices - Stripe](https://stripe.com/blog/api-versioning)
- [How to Version Your API - Postman](https://blog.postman.com/how-to-version-apis/)

---

## 相关阅读

- [API 版本控制进阶：URL/Header/MediaType 三种策略的工程实践](/categories/05_PHP/Laravel/API-版本控制进阶-URL-Header-MediaType-三种策略的工程实践/)
- [OAuth 2.1 实战：从 OAuth 2.0 到 2.1 的迁移指南](/categories/05_PHP/Laravel/OAuth-2.1-实战-从OAuth2.0到2.1的迁移指南-PKCE强制隐式流废弃与安全加固/)
- [CDN 配置实战：静态资源加速与缓存失效策略](/categories/00_架构/CDN-配置实战-静态资源加速与缓存失效策略-Laravel-B2C-API踩坑记录/)
