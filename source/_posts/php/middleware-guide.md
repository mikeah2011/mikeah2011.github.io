---

title: Laravel Middleware 实战-KKday B2C API 请求链路追踪与真实踩坑记录
keywords: [Laravel Middleware, KKday B2C API, 请求链路追踪与真实踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-02
categories:
- php
tags:
- KKday
- Laravel
- 微服务
- 监控
description: Laravel 中间件（Middleware）实战深度指南，基于 KKday B2C API 项目的真实踩坑经验，详解请求拦截、认证鉴权、API 限流、CORS 跨域处理、Sentry 监控埋点与 OpenTelemetry 链路追踪的架构设计与常见陷阱，帮助 PHP 开发者掌握中间件职责分离、性能优化与生产环境可观测性最佳实践。
---


## 📋 目录

- [什么是 Laravel Middleware？](#什么是-laravel-middleware)
- [KKday B2C API 的 Middleware 架构设计](#kkday-b2c-api 的 middleware-架构设计)
- [真实踩坑记录](#真实踩坑记录)
  - [坑 1：Middleware 中开启事务导致死锁](#坑 1middleware 中开启事务导致死锁)
  - [坑 2：Sentry 监控埋点内存泄漏](#坑 2sentry 监控埋点内存泄漏)
  - [坑 3：OpenTelemetry 采样率配置错误](#坑 3opentelemetry 采样率配置错误)
  - [坑 4：中间件调用顺序引发 CORS 问题](#坑 4中间件调用顺序引发-cors-问题)
  - [坑 5：Request 生命周期内操作数据库](#坑 5request 生命周期内操作数据库)
- [最佳实践建议](#最佳实践建议)
- [参考资源](#参考资源)

---

## 什么是 Laravel Middleware？

Laravel **Middleware**（中间件）是 HTTP 请求在进入路由处理器或 Controller 之前/之后执行的代码片段，它们构成了一条清晰的 **请求链路**：

```
Global Middleware → Route Middleware → Controller Middleware → Controller → Response Middleware → Global Middleware
```

在 KKday B2C API 项目中，我们使用 Middleware 实现了：
- ✅ 身份认证与权限验证
- ✅ Sentry SDK 监控埋点
- ✅ OpenTelemetry APM 链路追踪
- ✅ 请求响应日志记录
- ✅ CORS 跨域处理
- ✅ API 限流

---

## KKday B2C API 的 Middleware 架构设计

项目采用分层 Middleware 模式，共约 15+ 个中间件：

### Global Middleware（全局中间件）

`app/Http/Kernel.php` 配置的全局中间件链：

```php
// app/Http/Kernel.php
class Kernel extends HttpKernel
{
    protected $middlewareGroups = [
        'web' => [
            \App\Http\Middleware\TrustProxies::class,
            \App\Http\Middleware\CheckForMaintenanceMode::class,
            \Illuminate\Foundation\Http\Middleware\ValidatePostSize::class,
            \App\Http\Middleware\HandlePrecognitiveRequests::class,
            // Sentry 监控 - 请求阶段埋点
            \App\Http\Middleware\SentryRequestStart::class,
            \App\Http\Middleware\CorsMiddleware::class,
            
            // OpenTelemetry 链路追踪 - 采样
            \App\Http\Middleware\OpenTelemetrySampling::class,
            
            // OpenTelemetry 注入 Span Context
            \App\Http\Middleware\OpenTelemetryInjectSpan::class,
        ],
        
        'api' => [
            \App\Http\Middleware\TrustProxies::class,
            \Illuminate\Foundation\Http\Middleware\CheckForMaintenanceMode::class,
            
            // API 认证中间件链
            \App\Http\Middleware\AuthenticateApi::class,
            \App\Http\Middleware\ApiRateLimiter::class,
        ],
    ];

    protected $middleware = [
        \Illuminate\Foundation\Http\Middleware\CheckForMaintenanceMode::class,
        \Illuminate\Foundation\Http\Middleware\ValidatePostSize::class,
        \Illuminate\Foundation\Http\Middleware\CheckValidCsrfToken::class,
    ];

    protected $routeMiddleware = [
        'auth' => \App\Http\Middleware\Authenticate::class,
        'auth.basic' => \Illuminate\Auth\Middleware\AuthenticateWithBasicAuth::class,
        'bindings' => \Illuminate\Routing\Middleware\SubstituteBindings::class,
        'cache.headers' => \Illuminate\Http\Middleware\SetCacheHeaders::class,
        'can' => \Illuminate\Auth\Middleware\Authorize::class,
        'guest' => \App\Http\Middleware\RedirectIfAuthenticated::class,
        'signed' => \Illuminate\Routing\Middleware\ValidateSignature::class,
    ];

    protected $middlewarePriority = [
        SubstituteBindingsPriority::class,
        RouteBindingPrecision::class,
    ];
}
```

### Sentry 监控中间件

`app/Http/Middleware/SentryRequestStart.php`:

```php
<?php

namespace App\Http\Middleware;

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Support\Facades\Log;
use Laravel\Lumen\Application;
use Monolog\Logger;
use Ratchet\Server\IoServer;
use React\Dns\Resolver\HostnameResolver;
use Symfony\Component\HttpFoundation\Response;
use Monolog\Handler\StreamHandler;

class SentryRequestStart
{
    /**
     * Handle an incoming request.
     *
     * @param \Illuminate\Http\Request $request
     * @param \Closure                 $next
     * @return mixed
     */
    public function handle($request, Closure $next)
    {
        // 记录请求开始时间
        $startTime = microtime(true);

        // 注入 Sentry Context
        Sentry::setTag('http.method', $request->getMethod());
        Sentry::setTag('http.url', $request->fullUrl());
        
        // 开启 Sentry transaction span
        try {
            return $next($request);
        } catch (\Throwable $e) {
            // 异常时自动捕获并上报
            Sentry::captureException($e);
            
            // 记录到日志
            Log::channel('sentry')->error(
                'Request failed: ' . $request->getMethod() . ' ' . $request->url(),
                ['exception' => $e->getMessage()]
            );
        }
    }
}
```

### OpenTelemetry 链路追踪中间件

`app/Http/Middleware/OpenTelemetryInjectSpan.php`:

```php
<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use OpenTelemetry\API\Trace;
use OpenTelemetry\API\Logs;

class OpenTelemetryInjectSpan
{
    /**
     * 注入 OpenTelemetry Span Context.
     */
    public function handle(Request $request, \Closure $next)
    {
        // 获取 trace ID (从 header 或创建新 span)
        $traceId = $this->extractTraceId($request->header('traceparent', ''));

        if ($traceId) {
            Span::setActive();
            
            // 设置 trace ID
            Trace::tracer('app-middleware')->setContext(
                'traceid' => $traceId
            );
            
            // 注入 span context 到请求头
            $parentSpan = Span::current();
            
            if ($parentSpan && $parentSpan->spanContext()->isRemote()) {
                $parentSpan->injectSpanContext('w3c');
                
                $traceparent = $parentSpan->spanContext()->traceId() . 
                              '-01'; // 父 span, flags=01
            }
        }

        // 注入 tracing 头到请求
        $response = $next($request);
        
        // 设置 response headers 供下游服务使用
        $span = Trace::tracer('app-middleware')->currentSpan();
        
        if ($span) {
            // 记录 span 的 duration
            $duration = (microtime(true) - $startTime) * 1000;
            
            // 记录到 telemetry 服务
            Logs::logger()->info(
                'Request completed',
                [
                    'http.method' => $request->getMethod(),
                    'http.url' => $request->url(),
                    'http.status_code' => $response->getStatusCode(),
                    'otel.service.name' => 'kkday-b2c-api-gateway',
                ]
            );
        }

        return $response;
    }

    private function extractTraceId($traceparent)
    {
        // W3C traceparent format: 00-{trace-id}-{span-id}-{flags}
        if (preg_match('/^[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i', $traceparent)) {
            return substr($traceparent, 0, 32);
        }
        return null;
    }
}
```

---

## 真实踩坑记录

### 坑 1：Middleware 中开启事务导致死锁 🔄

**场景**：在 Middleware 中对数据库开启事务，处理用户订单时触发死锁。

**Before（错误做法）**：

```php
// app/Http/Middleware/UserOrderCheck.php ❌
class UserOrderCheck
{
    public function handle(Request $request, Closure $next)
    {
        // 在 middleware 中开启事务 ❌ 不推荐！
        $connection = DB::connection();
        
        $connection->transaction(function () use ($request, $connection) {
            // 检查用户订单状态
            $order = Order::where('user_id', $request->user()->id)
                          ->orderBy('id')
                          ->firstOrFail();

            if ($order->status !== 'pending') {
                throw new \Exception('订单已处理完成');
            }

            // 再次检查... ❌ 在事务内多次查询导致行锁竞争
            $order = Order::where('id', $order->id)
                          ->with('product')
                          ->first();
            
            return $next($request);
        });
    }
}
```

**After（正确做法）**：

```php
// app/Http/Middleware/UserOrderCheck.php ✅
class UserOrderCheck
{
    public function handle(Request $request, Closure $next)
    {
        // ✅ 不要在中继件内开启事务
        // ✅ 在 Controller 或使用 Service 层处理业务逻辑
        
        // 简单查询不锁行
        $order = Order::where('user_id', $request->user()->id)
                      ->with(['product' => function ($query) {
                          // Eager Loading 避免 N+1
                          $query->limit(10);
                      }])
                      ->first();

        if (!$order || $order->status !== 'pending') {
            return response()->json([
                'message' => '订单不存在或已处理',
                'code' => 'ORDER_NOT_PENDING'
            ], 400);
        }

        // ✅ 将复杂业务逻辑下沉到 Service
        $result = $this->validateOrder($order);

        return $next($request);
    }

    /**
     * 业务验证逻辑，不应放在 Middleware
     */
    private function validateOrder(Order $order): array
    {
        // Service 层处理复杂事务和业务逻辑
    }
}
```

**错误原因分析**：

- ❌ Middleware 应只处理横切关注点（认证、日志、追踪），不应处理业务逻辑
- ❌ 在事务内频繁查询同一表，导致行锁等待超时 → 死锁
- ❌ Eager Loading 的 `limit` 在子查询中不生效

**修复建议**：

1. **事务下沉到 Service/Repository 层**
2. **避免在 Middleware 中进行复杂的数据库操作**
3. **使用独立 Transaction Manager 控制事务边界**

---

### 坑 2：Sentry 监控埋点内存泄漏 🐌

**场景**：高并发下 Sentry SDK 初始化 Span 对象未正确清理，导致内存占用持续增长。

**Before（错误做法）**：

```php
// app/Http/Middleware/SentryRequestStart.php ❌
class SentryRequestStart
{
    public function handle(Request $request, Closure $next)
    {
        // ❌ 每次请求都重新初始化 Sentry SDK ❌
        Sentry::init([
            'dsn' => config('services.sentry.dsn'),
            'integrations' => [
                new LaravelIntegration(),
            ],
        ]);

        // ❌ 每次请求创建新 Span 对象 ❌
        $span = Sentry::startTransaction(
            'http.' . $request->getMethod(),
            $request->path()
        );

        // ❌ 没有清理逻辑 ❌
        
        return $next($request);
    }
}
```

**After（正确做法）**：

```php
// app/Http/Middleware/SentryRequestStart.php ✅
class SentryRequestStart
{
    /**
     * @var \Sentry\Tracing\Span
     */
    private $activeSpan;
    
    /**
     * 生命周期内状态，避免内存泄漏
     */
    private static $requestCount = 0;

    public function __construct()
    {
        // ✅ SDK 初始化只需执行一次
        if (!Sentry\Tracing\ClientBuilder::getClient()) {
            Sentry\Tracing\ClientBuilder::init([
                'dsn' => config('services.sentry.dsn'),
                'integrations' => [
                    new LaravelIntegration(),
                ],
                // 限制并发 transaction 数量，避免内存泄漏
                'traces_sample_rate' => env('SENTRY_TRACES_SAMPLE_RATE', 0.1),
            ]);
        }
    }

    public function handle(Request $request, Closure $next)
    {
        self::$requestCount++;

        // ✅ 复用 SDK，不重复初始化
        if (!Sentry\Tracing\ClientBuilder::getClient()) {
            throw new \RuntimeException('Sentry SDK not initialized');
        }

        // ✅ 使用事务 ID 作为 span 名称，便于追踪
        $span = Sentry\Tracing\SpanBuilder::createTransaction(
            'http.' . $request->getMethod(),
            $this->generateTransactionName($request)
        );

        $this->activeSpan = $span;
        
        // ✅ 设置请求上下文
        $span->setTag('method', $request->getMethod());
        $span->setTag('path', $request->path());
        $span->setContext('http.request', [
            'headers' => $this->sanitizeHeaders($request->all()),
            'body_size' => $request->getContentLength(),
        ]);

        // ✅ 设置响应时间戳，便于计算 duration
        $startTime = microtime(true);
        Sentry\Tracing\RequestSpan::setRequestTime(
            $startTime,
            (float) date('c')
        );

        try {
            // ✅ 执行请求处理
            $response = $next($request);
            
            // ✅ 记录成功响应
            $span->setStatus(\Sentry\Tracing\SpanStatus::ok());
            $span->setTag('status', 'success');
            
            return $this->finishSpanWithResponse($response);
        } catch (\Exception $e) {
            // ✅ 异常时记录错误
            Sentry\Tracing\SpanBuilder::capture(
                $e,
                \Sentry\ExceptionMechanism::getFromException()
            );
            
            return $this->finishSpanWithError();
        } finally {
            // ✅ 请求结束，清理 span 对象
            if ($this->activeSpan) {
                try {
                    $this->activeSpan->setTag('request_id', $this->generateRequestId());
                    $this->activeSpan->finish();
                } catch (\Throwable $e) {
                    // 忽略 span 清理失败
                }
                $this->activeSpan = null;
            }
            
            // ✅ 定期清理请求计数，避免内存占用
            if (self::$requestCount % 100 === 0) {
                Sentry\Tracing\ClientBuilder::flush();
            }
        }
    }

    private function finishSpanWithResponse(Response $response)
    {
        $this->activeSpan->setContext('http.response', [
            'status' => $response->getStatusCode(),
            'headers' => $this->sanitizeHeaders($response->headers->all()),
            'size' => strlen((string) $response->getContent()),
        ]);

        $this->activeSpan->finish();
        return $response;
    }

    private function finishSpanWithError()
    {
        $this->activeSpan->setStatus(\Sentry\Tracing\SpanStatus::internalError());
        $this->activeSpan->setTag('status', 'error');
        $this->activeSpan->finish();
        
        return response()->json([
            'message' => 'Internal Server Error',
            'code' => 'INTERNAL_ERROR'
        ], 500);
    }

    private function generateTransactionName(Request $request)
    {
        // ✅ 使用请求路径和方法，便于在 Sentry Dashboard 中识别
        return sprintf(
            '%s %s',
            $request->getMethod(),
            $this->sanitizePath($request->path())
        );
    }

    private function generateRequestId()
    {
        // ✅ 生成唯一请求 ID
        return (string) bin2hex(random_bytes(8));
    }

    private function sanitizeHeaders(array $headers): array
    {
        // ✅ 清理敏感信息（Authorization, Cookie 等）
        $sensitive = ['authorization', 'cookie', 'x-api-key'];
        
        return array_map(function ($k, $v) use ($sensitive) {
            $key = strtolower($k);
            if (in_array($key, $sensitive)) {
                return '[REDACTED]';
            }
            return $v;
        }, $headers);
    }

    private function sanitizePath($path)
    {
        // ✅ 清理特殊字符，便于 Sentry Dashboard 索引
        return preg_replace('/[\/\\?\.\-\s]/', '_', strtolower($path));
    }
}
```

**内存泄漏原因分析**：

- ❌ 重复初始化 SDK → SDK 状态不一致
- ❌ Span 对象未清理 → 占用内存持续增长
- ❌ 请求计数无上限 → 无限增长

**修复建议**：

1. **SDK 初始化只需执行一次，使用单例模式**
2. **Span 对象在 finally 块中清理**
3. **定期 flush SDK 缓冲区，释放内存**
4. **敏感信息脱敏处理**
5. **路径和 header 标准化处理**

---

### 坑 3：OpenTelemetry 采样率配置错误 📊

**场景**：在 Middleware 中设置 `setSamplingDecision()` 但配置被覆盖，导致全量日志或无日志。

**Before（错误做法）**：

```php
// app/Http/Middleware/OpenTelemetrySampling.php ❌
class OpenTelemetrySampling
{
    public function handle(Request $request, Closure $next)
    {
        // ❌ 硬编码采样率，被环境覆盖
        $tracer = Trace::tracer('app-middleware');
        
        $span = Span::inScope($tracer, function ($tracer) use ($request) {
            // ❌ setSamplingDecision 没有生效，因为配置优先于代码设置
            $tracer->setSamplingDecision(1.0); // 强制全量
            
            return $next($request);
        });

        return $response;
    }
}
```

**After（正确做法）**：

```php
// app/Http/Middleware/OpenTelemetrySampling.php ✅
class OpenTelemetrySampling
{
    /**
     * @var \OpenTelemetry\API\Trace\Span
     */
    private $span;

    public function __construct()
    {
        // ✅ 从环境变量读取采样率，支持动态调整
        $this->samplingRate = floatval(
            env('OPENTELEMETRY_SAMPLING_RATE', '0.1')
        );
        
        // ✅ 设置日志记录器
        Logs::logger()->debug('[OT] Sampling enabled');
    }

    public function handle(Request $request, Closure $next)
    {
        return new \Closure()($this->tracer);
        
        $tracer = Trace::tracer('app-middleware');
        $span = Span::inScope($tracer, function ($tracer) use ($request) {
            // ✅ 使用 traceparent header 判断是否采样
            $traceparent = $request->header('traceparent', '');
            
            if (!$this->isLocalSamplingEnabled($traceparent)) {
                // 继承下游 span context，不创建新 span
                Logs::logger()->debug(
                    '[OT] Skip local sampling, inherit from upstream'
                );
                return $next($request);
            }

            // ✅ 根据路径决定是否采样（关键路径全量）
            $samplingDecision = $this->determineSamplingDecision(
                $path,
                $traceparent
            );

            Logs::logger()->debug(
                '[OT] Sampling decision: ' . $samplingDecision,
                [
                    'path' => $request->path(),
                    'method' => $request->getMethod(),
                    'service_name' => config('app.name'),
                ]
            );

            return $next($request);
        });

        return $span;
    }

    private function isLocalSamplingEnabled(string $traceparent): bool
    {
        // ✅ 检查 traceparent，判断是否继承自上游服务
        $flags = bin2hex(hex2bin(substr($traceparent, -2)) ?? '00');
        
        return !preg_match('/^(?:[0-9a-f]{32}-)?/i', $traceparent);
    }

    private function determineSamplingDecision(string $path, string $traceparent): float
    {
        // ✅ 关键路径全量采样
        $criticalPaths = [
            '/api/v1/orders',
            '/api/v1/payments',
            '/api/v1/auth',
            '/graphql',
        ];

        foreach ($criticalPaths as $path) {
            if (strpos($path, $request->path()) === 0) {
                Logs::logger()->debug('[OT] Critical path, full sampling');
                return 1.0; // 全量采样
            }
        }

        // ✅ 根据环境变量采样率
        $rate = $this->samplingRate;
        
        // ✅ 支持按路径配置不同采样率
        if (strpos($request->path(), '/health') === 0) {
            // Health check 不采样
            return 0.0;
        }

        return $rate;
    }
}
```

**采样率配置优先级**：

| 层级 | 说明 |
|------|------|
| 1. `env()` 环境变量 | 最高优先级，支持动态调整 |
| 2. `.env` 配置文件 | 开发/生产环境不同值 |
| 3. SDK 默认配置 | 最后一道防线 |

**最佳实践**：

- ✅ **开发环境**：全量采样 (`sampling_rate=1.0`)
- ✅ **测试环境**：10% 采样 (`sampling_rate=0.1`)
- ✅ **生产环境**：5-10% 采样 (`sampling_rate=0.05~0.1`)
- ✅ **关键业务路径**：强制全量采样

---

### 坑 4：中间件调用顺序引发 CORS 问题 🌐

**场景**：CORS 中间件在认证中间件之后执行，导致跨域请求被拒绝。

**Before（错误做法）**：

```php
// app/Http/Kernel.php ❌ - 错误顺序
protected $middlewareGroups = [
    'web' => [
        // ❌ CORS 应该在全局链的最前面
        \App\Http\Middleware\TrustProxies::class,
        \Illuminate\Foundation\Http\Middleware\CheckForMaintenanceMode::class,
        \App\Http\Middleware\SentryRequestStart::class,
        
        // ❌ 认证中间件在 CORS 之后
        \App\Http\Middleware\AuthenticateApi::class,
        
        // ✅ CORS 在这里才执行，但此时请求已被认证拒绝
        \App\Http\Middleware\CorsMiddleware::class,
    ],
];
```

**After（正确做法）**：

```php
// app/Http/Kernel.php ✅ - 正确顺序
protected $middlewareGroups = [
    'web' => [
        // ✅ CORS 必须在最前面执行，避免后续中间件拒绝请求
        \App\Http\Middleware\CorsMiddleware::class,
        
        \App\Http\Middleware\TrustProxies::class,
        \Illuminate\Foundation\Http\Middleware\CheckForMaintenanceMode::class,
        \App\Http\Middleware\SentryRequestStart::class,
        
        \App\Http\Middleware\AuthenticateApi::class,
        \App\Http\Middleware\ApiRateLimiter::class,
    ],
];

// ✅ CORS 中间件实现，支持跨域 OPTIONS 预检请求
class CorsMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        // ✅ 处理 OPTIONS 预检请求
        if ($request->isMethod('OPTIONS')) {
            return response('', 204);
        }

        // ✅ 设置 CORS headers
        $headers = [
            'Access-Control-Allow-Origin' => $this->getAllowedOrigin($request),
            'Access-Control-Allow-Methods' => 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers' => 'Origin, Content-Type, Accept, Authorization, X-Requested-With',
            'Access-Control-Max-Age' => env('CORS_MAX_AGE', '3600'),
        ];

        // ✅ 允许 Credentials（带 cookie 的请求）
        if (config('cors.allow_credentials')) {
            $headers['Access-Control-Allow-Credentials'] = 'true';
            // ⚠️ 注意：使用 Credentials 时 Access-Control-Allow-Origin 只能是域名，不能是*
            $allowedOrigin = config('app.url');
            $headers['Access-Control-Allow-Origin'] = $allowedOrigin;
        }

        return tap($next($request), function ($response) use ($headers) {
            foreach ($headers as $key => $value) {
                $response->header($key, $value);
            }
            
            // ✅ 设置缓存头，提升性能
            $response->header('Cache-Control', 'no-store');
            
            return $response;
        });
    }

    private function getAllowedOrigin(Request $request): string
    {
        $allowedOrigins = config('cors.allowed_origins', ['*']);
        
        foreach ($allowedOrigins as $origin) {
            if (preg_match('/^https?:\/\/'. preg_quote($origin, '/') .'/', 
                $request->header('Origin', ''))) {
                return $origin;
            }
        }

        // ✅ 允许 localhost 开发环境
        if ($request->isConsoleCommand()) {
            return '*';
        }

        return '';
    }
}
```

**中间件调用顺序原则**：

| 优先级 | 类型 | 示例 |
|--------|------|------|
| 1️⃣ 最前面 | **响应式中间件**（CORS、设置响应头） | `\App\Http\Middleware\CorsMiddleware` |
| 2️⃣ 全局链开始 | **SDK 初始化**（Sentry、APM） | `\App\Http\Middleware\SentryRequestStart` |
| 3️⃣ 中间层 | **业务验证**（认证、权限） | `\App\Http\Middleware\AuthenticateApi` |
| 4️⃣ 最后面 | **响应式处理**（日志、错误捕获） | `\App\Http\Middleware\OpenTelemetryInjectSpan` |

---

### 坑 5：Request 生命周期内操作数据库 🔄

**场景**：在 Middleware 中使用 `DB::transaction()` 或 `DB::connection()->cursor()`，导致请求阻塞。

**Before（错误做法）**：

```php
// app/Http/Middleware/DatabaseMiddleware.php ❌
class DatabaseMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        // ❌ 在 Middleware 中执行数据库查询 ❌ 导致请求阻塞
        return tap($next($request), function ($response) {
            // ✅ 记录数据库操作日志
            DB::connection()->cursor(function ($query) use ($response) {
                $sql = $query->getSql();
                
                Log::info('[DB] Executed Query', [
                    'method' => $request->getMethod(),
                    'path' => $request->path(),
                    'sql' => $sql,
                    'status' => $response->getStatusCode(),
                ]);
            });
        });
    }
}
```

**After（正确做法）**：

```php
// app/Http/Middleware/DatabaseMiddleware.php ✅
class DatabaseMiddleware
{
    /**
     * @var \Illuminate\Database\Events\QueryExecuted[]
     */
    private static $queries = [];

    public function handle(Request $request, Closure $next)
    {
        return tap($next($request), function ($response) use ($request) {
            // ✅ 请求完成后记录数据库操作统计
            $dbStats = $this->getDatabaseStats();

            Logs::logger()->info('[DB] Query Statistics', [
                'method' => $request->getMethod(),
                'path' => $request->path(),
                'status' => $response->getStatusCode(),
                'total_queries' => count(self::$queries),
                'total_time_ms' => $dbStats['total_time'],
            ]);

            // ✅ 清空查询缓存，避免内存泄漏
            self::$queries = [];
        });
    }

    /**
     * 监听数据库查询事件
     */
    public static function startListening()
    {
        Event::listen(
            \Illuminate\Database\Events\QueryExecuted::class,
            function (\Illuminate\Database\Events\QueryExecuted $event) {
                self::$queries[] = [
                    'sql' => str_replace(
                        config('database.connections.sqlite.filename', ''),
                        '[SQLite]',
                        substr($event->sql, 0, 200)
                    ),
                    'time_ms' => (floatval(str_replace(',', '.', $event->time)) * 1000),
                    'bindings_count' => count($event->bindings),
                    'query_type' => preg_match('/^SELECT/i', $event->sql) ? 'read' : 'write',
                ];
            }
        );
    }

    /**
     * 禁用数据库操作，返回统计信息
     */
    private function getDatabaseStats(): array
    {
        // ✅ 汇总统计
        $totalTime = 0;
        foreach (self::$queries as $query) {
            $totalTime += $query['time_ms'];
        }

        return [
            'total_queries' => count(self::$queries),
            'total_time_ms' => number_format($totalTime, 2),
            'avg_query_ms' => count(self::$queries) > 0 
                ? number_format($totalTime / count(self::$queries), 3) 
                : 0,
            'max_query_ms' => collect(self::$queries)->pluck('time_ms')->max() ?? 0,
        ];
    }

    /**
     * 禁用数据库操作，避免在 Middleware 中执行查询
     */
    public static function disableQueryLogging(Request $request)
    {
        // ✅ 禁用查询日志记录
        return true;
    }
}
```

**生命周期内数据库操作原则**：

- ❌ **禁止**：在 Middleware 中进行复杂的数据库查询
- ✅ **允许**：记录简单的统计信息（时间、数量）
- ✅ **推荐**：使用事件监听机制
- ✅ **禁用**：高并发场景下的实时日志

---

## 最佳实践建议

### 📊 中间件职责分离原则

| 层级 | 责任 | 示例 |
|------|------|------|
| Global Middleware（入口） | SDK 初始化、链路追踪、CORS | `SentryRequestStart`、`OpenTelemetrySampling` |
| Route Middleware（路由） | 认证、权限、限流、版本检查 | `AuthenticateApi`、`ApiRateLimiter` |
| Controller Middleware（控制器） | 业务验证、数据转换 | 应在 Service 层处理，非中间件职责 |

### 🚀 性能优化建议

1. **启用缓存**：在 Middleware 中缓存配置和常用数据
2. **避免阻塞**：不执行耗时操作（如查询数据库、调用外部 API）
3. **异步处理**：使用队列或事件机制处理非同步任务
4. **采样策略**：生产环境设置合理的采样率，避免全量日志

### 🔒 安全建议

1. **脱敏敏感信息**：不要记录 `Authorization`、`Cookie` 等头
2. **限制中间件数量**：保持中间件链长度 < 5，减少性能损耗
3. **错误处理**：使用 try-finally 确保资源释放
4. **环境配置**：不同环境使用不同的采样率和日志级别

---

## 参考资源

- [Laravel Documentation: Middleware](https://laravel.com/docs/middleware)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otel/)
- [Sentry PHP SDK](https://docs.sentry.io/platforms/php/laravel/)
- [Laravel Event System](https://laravel.com/docs/events)

---

**KKday B2C API 项目经验总结**：Middleware 是构建高性能、可观测性强的 API 网关的关键，但必须遵循 **职责分离原则** —— 不处理业务逻辑，只做横切关注点。

**踩坑记录**：事务下沉到 Service、SDK 单例模式、采样率合理配置、中间件顺序优化、避免生命周期内数据库操作。


---

## 相关阅读

- [API Rate Limiting — 接口限流实战：KKday B2C API 真实踩坑记录](/php/Laravel/api-rate-limiting-rate-limitingguide) — 本文中限流中间件 `ApiRateLimiter` 的完整实现与 Redis 滑动窗口限流策略详解。
- [Grafana Tempo + OpenTelemetry 实战：Laravel 异步订单链路追踪与采样治理踩坑记录](/php/Laravel/grafana-tempo-opentelemetry-guide-laravel) — OpenTelemetry 链路追踪中间件的完整部署方案与 Grafana Tempo 可视化实战。
- [OWASP Top 10 防护实战：SQL 注入/XSS/CSRF/SSRF Laravel B2C API 安全加固踩坑记录](/php/Laravel/owasp-top-10-guide-sql-xss-csrf-ssrf) — 认证中间件背后的安全加固策略，涵盖 SQL 注入、XSS、CSRF 与 SSRF 防护。

---

> 💡 **最后提醒**：在 Middleware 中保持简单，复杂逻辑交给 Controller/Service 层处理。
