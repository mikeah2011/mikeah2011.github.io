---

title: Distributed Tracing 深度实战：Trace Context 传播、Baggage 透传与采样策略——Laravel 微服务的因果可观测性
keywords: [Distributed Tracing, Trace Context, Baggage, Laravel, 深度实战, 传播, 透传与采样策略, 微服务的因果可观测性]
date: 2026-06-06 10:00:00
description: 深入解析分布式追踪核心机制，涵盖 W3C Trace Context 标准、OpenTelemetry SDK 在 Laravel 微服务中的集成、Baggage 业务标签跨服务透传、采样策略对比及 Jaeger/Zipkin/Tempo 后端选型。结合九大生产踩坑案例，提供从零到生产的分布式追踪落地方案。
tags:
- 分布式
- OpenTelemetry
- Trace Context
- Laravel
- 微服务
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---



## 引言：为什么分布式追踪是微服务架构的刚需？

### 可观测性三大支柱：日志、指标、追踪

在讨论分布式追踪之前，先厘清可观测性（Observability）的三大支柱及其定位：

| 支柱 | 回答的问题 | 数据特征 | 典型工具 |
|------|-----------|---------|---------|
| 日志（Logs） | 发生了什么？ | 非结构化/半结构化文本 | ELK、Loki、CloudWatch |
| 指标（Metrics） | 系统状态如何？ | 数值型时间序列 | Prometheus、Datadog |
| 追踪（Traces） | 为什么发生？因果链是什么？ | 结构化 Span 树 | Jaeger、Tempo、Zipkin |

三者不是替代关系，而是互补关系。日志告诉你"支付超时了"，指标告诉你"过去 5 分钟支付成功率下降了 12%"，但只有追踪能告诉你"支付超时是因为库存服务的 Redis 锁等待了 8 秒"。在微服务架构中，**追踪是唯一能跨越服务边界、建立因果关系的观测手段**。

### 为什么选 OpenTelemetry？

OpenTelemetry（简称 OTel）是 CNCF 的可观测性标准项目，它的核心价值在于：

1. **厂商中立**：一次埋点，数据可导出到 Jaeger、Zipkin、Tempo、Datadog、New Relic 等任何兼容后端
2. **标准协议**：基于 W3C Trace Context 标准，不同语言、不同框架的 SDK 生成的数据可以互通
3. **统一 API**：Logs、Metrics、Traces 三大信号使用同一套 SDK，避免多套库的维护成本
4. **自动埋点**：PHP 生态已有 Auto-Instrumentation 方案，无需逐个框架手动适配

如果你还在犹豫"用 Jaeger SDK 还是 Zipkin SDK"，答案是：**都不用，用 OpenTelemetry SDK**。

当你把一个单体 Laravel 应用拆分为十几个微服务——用户服务、订单服务、支付服务、库存服务、通知服务……某个用户下单失败，你看到的只是一条 "500 Internal Server Error" 日志。问题出在哪个服务？是支付回调超时？还是库存扣减死锁？还是通知服务拖垮了整个请求链路？

日志告诉你"发生了什么"，Metrics 告诉你"系统状态如何"，但只有 **分布式追踪（Distributed Tracing）** 能告诉你 **"为什么发生"以及"因果链是什么"**。

分布式追踪的价值远不止"看到调用链"。在生产环境中，它解决的核心问题包括：

- **跨服务延迟分析**：精准定位是哪个服务、哪个数据库查询、哪个外部 API 调用拖慢了整个请求
- **错误传播追踪**：一个服务的异常如何在链路中传播，最终导致用户可见的错误
- **服务依赖拓扑发现**：自动发现服务间的调用关系，画出依赖图谱
- **业务标签关联**：通过 Baggage 机制将用户 ID、订单号等业务上下文贯穿整个链路

本文将从 W3C Trace Context 标准讲起，在 Laravel 微服务中完整落地 OpenTelemetry 分布式追踪，涵盖 Context 传播、Baggage 透传、采样策略选择、追踪后端选型（Jaeger/Zipkin/Tempo 深度对比），以及 Collector 部署与可视化，最终分享九大生产环境的真实踩坑经验。

## 核心概念：Trace、Span、Context Propagation、Baggage

在深入实践之前，我们必须建立对四个核心概念的精确理解。

### Trace（追踪）

一个 Trace 代表一次完整的请求在分布式系统中的生命周期。它从用户发起 HTTP 请求开始，经过 API Gateway、各个微服务、数据库、消息队列，直到最终返回响应。每个 Trace 由一个全局唯一的 `trace-id`（128 位十六进制字符串）标识。

### Span（跨度）

Span 是追踪的基本单元，代表一个操作单元（一次 HTTP 调用、一次数据库查询、一次 RPC 调用等）。每个 Span 包含：

- `span-id`：64 位唯一标识
- `parent-span-id`：父 Span 标识（根 Span 为空）
- `name`：操作名称（如 `GET /api/orders`）
- `kind`：`CLIENT`、`SERVER`、`PRODUCER`、`CONSUMER`
- `start-time`、`end-time`：精确时间戳
- `attributes`：键值对形式的元数据
- `events`：时间点上的事件记录
- `status`：OK、ERROR 或 UNSET

Span 之间通过 parent-child 关系形成一棵树，这棵树就是整个 Trace。

### Context Propagation（上下文传播）

这是分布式追踪最关键也最容易出错的环节。当服务 A 调用服务 B 时，A 必须将当前的 trace-id、span-id、trace-flags 等信息通过某种机制传递给 B，B 才能创建一个 child Span 并关联到同一个 Trace。

传播载体通常是 HTTP Header，也可以是 gRPC metadata、消息队列的 message header 等。W3C Trace Context 标准定义了统一的 Header 格式，我们下一节详细展开。

### Baggage（行李）

Baggage 是一组可选的键值对，它随 Context 一起在整个 Trace 中传播，但**不做采样决策**。与 Span Attributes 不同，Baggage 的设计目的是让业务数据（如用户 ID、租户 ID、A/B 测试分组）能够在服务边界之间透明传递，而不需要手动逐层透传。

```php
// Baggage 的典型用法：在入口服务设置用户 ID
$baggage = Baggage::getCurrent()
    ->withEntry('user.id', '12345')
    ->withEntry('tenant.id', 'acme-corp')
    ->withEntry('feature.flag', 'new-checkout-v2');

// 在下游服务中读取
$baggage = Baggage::getCurrent();
$userId = $baggage->getEntry('user.id'); // '12345'
$tenantId = $baggage->getEntry('tenant.id'); // 'acme-corp'
```

## W3C Trace Context 标准详解

在 W3C Trace Context 标准（W3C Recommendation, 2023）出现之前，分布式追踪的 Context 传播是混乱的——Jaeger 用 `uber-trace-id`，Zipkin 用 `X-B3-TraceId`，AWS X-Ray 用 `X-Amzn-Trace-Id`。微服务一旦使用不同厂商的 SDK，Context 就会断裂。

W3C Trace Context 定义了两个标准化的 HTTP Header：

### traceparent

`traceparent` 是必选字段，包含四个部分：

```
traceparent: {version}-{trace-id}-{parent-id}-{trace-flags}
```

具体示例：

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

| 字段 | 长度 | 含义 |
|------|------|------|
| `00` | 2 字符 | 版本号（当前为 00） |
| `4bf92f3577b34da6a3ce929d0e0e4736` | 32 字符 | 128 位 trace-id |
| `00f067aa0ba902b7` | 16 字符 | 64 位 parent-id（即当前 Span 的 ID） |
| `01` | 2 字符 | trace-flags（01 = sampled） |

`trace-flags` 目前只定义了最低位：
- `01`：**sampled**——该 Trace 被采样，应当记录并上报
- `00`：**not sampled**——该 Trace 未被采样，但仍应保持 Context 传播

### tracestate

`tracestate` 是可选字段，用于携带各厂商自定义的追踪信息。它是一个逗号分隔的键值对列表：

```
tracestate: congo=t61rcWkgMzE,rojo=00f067aa0ba902b7
```

`tracestate` 的设计目的是**向后兼容**——让 Jaeger、Zipkin、Datadog 等各自保留专有字段，同时不影响 `traceparent` 的标准化。

### Laravel 中手动解析与注入

在不使用 OpenTelemetry SDK 的情况下，你可以手动解析这两个 Header：

```php
// 从请求中提取 Context
$traceparent = $request->header('traceparent');
$tracestate = $request->header('tracestate', '');

if ($traceparent && preg_match('/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/', $traceparent, $m)) {
    $version = $m[1];
    $traceId = $m[2];
    $parentSpanId = $m[3];
    $traceFlags = hexdec($m[4]);

    // 创建子 Span 并注入到下游请求
    $newSpanId = bin2hex(random_bytes(8));
    $newTraceparent = sprintf('00-%s-%s-%02x', $traceId, $newSpanId, $traceFlags);
}

// 发起下游 HTTP 请求时注入 Header
Http::withHeaders([
    'traceparent' => $newTraceparent,
    'tracestate' => $tracestate,
])->post('http://order-service/api/orders', $payload);
```

手动实现不仅繁琐，还容易出错（比如忘记在异步消息中传递 Context）。这正是我们需要 OpenTelemetry SDK 的原因。

## Laravel 中集成 OpenTelemetry SDK

### 安装与配置

```bash
composer require open-telemetry/sdk open-telemetry/exporter-otlp
composer require open-telemetry/transport-grpc
```

如果你的 Laravel 项目使用了 PHP 8.1+，还需要安装 gRPC 扩展或使用 HTTP 传输：

```bash
# 方式一：使用 gRPC 传输（推荐，性能更好）
pecl install grpc

# 方式二：使用 HTTP 传输（无需 gRPC 扩展）
composer require open-telemetry/transport-http
```

### 初始化 Tracer Provider

创建 `config/opentelemetry.php`：

```php
<?php

return [
    'enabled' => env('OTEL_ENABLED', true),
    'service_name' => env('OTEL_SERVICE_NAME', 'laravel-app'),
    'service_version' => env('OTEL_SERVICE_VERSION', '1.0.0'),
    'exporter_endpoint' => env('OTEL_EXPORTER_ENDPOINT', 'http://otel-collector:4317'),
    'exporter_protocol' => env('OTEL_EXPORTER_PROTOCOL', 'grpc'), // grpc 或 http/protobuf
    'sampler' => env('OTEL_SAMPLER', 'parentbased_traceidratio'),
    'sampler_ratio' => env('OTEL_SAMPLER_RATIO', 1.0),
    'propagators' => env('OTEL_PROPAGATORS', 'tracecontext,baggage'),
    'batch_size' => env('OTEL_BATCH_SIZE', 512),
    'batch_timeout' => env('OTEL_BATCH_TIMEOUT_MS', 5000),
];
```

创建 Service Provider `app/Providers/OpenTelemetryServiceProvider.php`：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Common\Instrumentation\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Propagation\TextMapPropagator;
use OpenTelemetry\Contrib\Otlp\OtlpHttpExporter;
use OpenTelemetry\Contrib\Otlp\OtlpGrpcExporter;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Common\Export\Stream\StreamTransportFactory;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SDK\Trace\Sampler\ParentBased;
use OpenTelemetry\SDK\Trace\Sampler\TraceIdRatioBasedSampler;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\SDK\Trace\TracerProvider;

class OpenTelemetryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(\OpenTelemetry\API\Trace\TracerProviderInterface::class, function () {
            $config = config('opentelemetry');

            if (!$config['enabled']) {
                return TracerProvider::builder()
                    ->build();
            }

            // 构建 Exporter
            $endpoint = $config['exporter_endpoint'];
            if ($config['exporter_protocol'] === 'grpc') {
                $exporter = new OtlpGrpcExporter($endpoint);
            } else {
                $exporter = new OtlpHttpExporter($endpoint);
            }

            // 构建 Sampler
            $sampler = new ParentBased(
                new TraceIdRatioBasedSampler($config['sampler_ratio'])
            );

            // 构建 Resource
            $resource = ResourceInfoFactory::merge(
                ResourceInfo::create(Attributes::create([
                    'service.name' => $config['service_name'],
                    'service.version' => $config['service_version'],
                    'deployment.environment' => app()->environment(),
                ])),
                ResourceInfoFactory::defaultResource(),
            );

            // 构建 BatchSpanProcessor
            $processor = new BatchSpanProcessor(
                $exporter,
                null, // Clock
                $config['batch_size'],
                $config['batch_timeout_ms'] * 1000, // 微秒
            );

            return TracerProvider::builder()
                ->setResource($resource)
                ->addSpanProcessor($processor)
                ->setSampler($sampler)
                ->build();
        });

        $this->app->singleton(\OpenTelemetry\API\Trace\TracerInterface::class, function () {
            return $this->app->make(\OpenTelemetry\API\Trace\TracerProviderInterface::class)
                ->getTracer(
                    config('opentelemetry.service_name'),
                    config('opentelemetry.service_version'),
                );
        });
    }

    public function boot(): void
    {
        if (!config('opentelemetry.enabled')) {
            return;
        }

        // 注册 Propagator
        $propagator = TraceContextPropagator::getInstance();
        TextMapPropagator::setGlobal($propagator);

        // 注册全局 TracerProvider
        $tracerProvider = $this->app->make(\OpenTelemetry\API\Trace\TracerProviderInterface::class);
        Globals::registerInitializer(fn() => $tracerProvider);
    }
}
```

### HTTP 中间件：自动创建 Root Span

创建 `app/Http/Middleware/TraceMiddleware.php`：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\Context\Context;
use Symfony\Component\HttpFoundation\Response;

class TraceMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $tracer = Globals::tracerProvider()
            ->getTracer('laravel-http');

        $propagator = Globals::propagator();

        // 从请求 Header 中提取上游 Context
        $parentContext = $propagator->extract(
            $request->headers->all(),
            new class implements \OpenTelemetry\Context\Propagation\RequestHeadersInterface {
                public function get(string $carrier, string $key): ?string {
                    return $carrier[strtolower($key)] ?? null;
                }
                public function getAll(string $carrier, string $key): array {
                    return isset($carrier[strtolower($key)]) ? [$carrier[strtolower($key)]] : [];
                }
                public function keys(string $carrier): array {
                    return array_keys($carrier);
                }
            }
        );

        // 如果上游没有 Context，则创建新的 Root Span
        $spanBuilder = $tracer->spanBuilder(
            sprintf('%s %s', $request->method(), $request->path())
        )
            ->setSpanKind(\OpenTelemetry\API\Trace\SpanKind::KIND_SERVER)
            ->setAttribute('http.method', $request->method())
            ->setAttribute('http.url', $request->fullUrl())
            ->setAttribute('http.route', $request->route()?->getName() ?? $request->path())
            ->setAttribute('http.user_agent', $request->userAgent())
            ->setAttribute('net.host.name', $request->getHost());

        if ($parentContext !== Context::getRoot()) {
            $spanBuilder->setParent($parentContext);
        }

        $span = $spanBuilder->startSpan();
        $scope = $span->activate();

        try {
            $response = $next($request);

            $span->setAttribute('http.status_code', $response->getStatusCode());
            if ($response->isClientError() || $response->isServerError()) {
                $span->setStatus(StatusCode::ERROR, "HTTP {$response->getStatusCode()}");
            }

            return $response;
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::ERROR, $e->getMessage());
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

在 `bootstrap/app.php` 或 `app/Http/Kernel.php` 中注册中间件：

```php
// bootstrap/app.php (Laravel 11+)
->withMiddleware(function (Middleware $middleware) {
    $middleware->prepend(\App\Http\Middleware\TraceMiddleware::class);
})
```

### HTTP Client 自动注入

Laravel 的 HTTP Client 基于 Guzzle，你可以通过 Guzzle 中间件实现自动注入：

```php
<?php

namespace App\Tracing;

use GuzzleHttp\Middleware;
use OpenTelemetry\API\Globals;
use Psr\Http\Message\RequestInterface;

class TracingGuzzleMiddleware
{
    public function handle(): callable
    {
        return Middleware::mapRequest(function (RequestInterface $request) {
            $propagator = Globals::propagator();

            $carrier = [];
            $propagator->inject($carrier);

            foreach ($carrier as $key => $value) {
                $request = $request->withHeader($key, $value);
            }

            return $request;
        });
    }
}
```

注册到 HTTP Client 的 Handler Stack：

```php
// 在 AppServiceProvider 或自定义 ServiceProvider 中
use Illuminate\Support\Facades\Http;

Http::globalMiddleware(new \App\Tracing\TracingGuzzleMiddleware()->handle());
```

### 数据库查询 Span

利用 Laravel 的 DB Query 事件自动创建数据库 Span：

```php
<?php

namespace App\Tracing;

use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;

class DatabaseTracing
{
    public static function register(): void
    {
        Event::listen(QueryExecuted::class, function (QueryExecuted $event) {
            $tracer = Globals::tracerProvider()->getTracer('laravel-db');

            $span = $tracer->spanBuilder('db.query')
                ->setSpanKind(SpanKind::KIND_CLIENT)
                ->setAttribute('db.system', $event->connectionName)
                ->setAttribute('db.statement', $event->sql)
                ->setAttribute('db.duration_ms', $event->time)
                ->startSpan();

            $span->end();
        });
    }
}
```

### 队列任务 Span

```php
<?php

namespace App\Tracing;

use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Support\Facades\Queue;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class QueueTracing
{
    public static function register(): void
    {
        $spans = [];

        Queue::before(function (JobProcessing $event) use (&$spans) {
            $tracer = Globals::tracerProvider()->getTracer('laravel-queue');

            // 从 Job 的 metadata 中提取 Context（如果在生产端注入了的话）
            $span = $tracer->spanBuilder('queue.process')
                ->setSpanKind(SpanKind::KIND_CONSUMER)
                ->setAttribute('messaging.system', 'redis')
                ->setAttribute('messaging.destination', $event->job->getQueue())
                ->setAttribute('messaging.operation', 'process')
                ->startSpan();

            $spans[$event->job->getJobId()] = $span;
        });

        Queue::after(function (JobProcessed $event) use (&$spans) {
            $jobId = $event->job->getJobId();
            if (isset($spans[$jobId])) {
                $spans[$jobId]->end();
                unset($spans[$jobId]);
            }
        });
    }
}
```

## Baggage 透传机制：业务标签如何跨服务传播？

### Baggage 的本质与设计意图

Baggage 与 Span Attributes 的本质区别在于**传播范围**：

- **Span Attributes**：仅存在于当前 Span 中，不会自动传播到下游服务
- **Baggage**：通过 W3C Baggage propagation 协议自动传播到整个 Trace 的所有后续 Span

Baggage 通过 `baggage` HTTP Header 传播，格式为：

```
baggage: user_id=12345,tenant_id=acme-corp,feature_flag=new_checkout
```

值需要 URL 编码（percent-encoded），包含特殊字符时：

```
baggage: user_id=12345,order_context=check%20out%20flow
```

### Laravel 中设置和读取 Baggage

```php
<?php

namespace App\Tracing;

use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Globals;
use OpenTelemetry\Context\Context;

class BaggageManager
{
    /**
     * 在入口服务设置业务 Baggage
     */
    public static function setBusinessContext(string $userId, string $tenantId): void
    {
        $baggage = Baggage::getCurrent()
            ->withEntry('user.id', $userId)
            ->withEntry('tenant.id', $tenantId);

        // Baggage 的 Context 需要激活后才能被后续代码感知
        $baggage->activate();
    }

    /**
     * 从当前 Baggage 读取业务上下文
     */
    public static function getUserId(): ?string
    {
        return Baggage::getCurrent()->getEntry('user.id');
    }

    /**
     * 添加动态 Baggage 条目（比如在中途发现需要传递 A/B 测试分组）
     */
    public static function addEntry(string $key, string $value): void
    {
        $current = Baggage::getCurrent();
        $updated = $current->withEntry($key, $value);
        $updated->activate();
    }

    /**
     * 将 Baggage 注入到 HTTP Client 请求中
     */
    public static function injectToRequest(array $carrier): array
    {
        $propagator = Globals::propagator();
        // 注入 traceparent + tracestate + baggage
        $propagator->inject($carrier);
        return $carrier;
    }
}
```

### 实际场景：订单服务调用支付服务

```php
// 订单服务 - 入口处设置 Baggage
class OrderController extends Controller
{
    public function store(OrderRequest $request)
    {
        // 设置业务上下文，将贯穿整个下游链路
        BaggageManager::setBusinessContext(
            $request->user()->id,
            $request->user()->tenant_id
        );

        // 追加额外的业务标签
        BaggageManager::addEntry('order.source', $request->header('X-Order-Source', 'web'));
        BaggageManager::addEntry('order.coupon', $request->coupon_code ?? 'none');

        // 调用支付服务 - Baggage 自动随 traceparent 一起传播
        $paymentResponse = Http::post('http://payment-service/api/charge', [
            'amount' => $request->amount,
            'currency' => 'CNY',
        ]);

        // 调用库存服务
        Http::post('http://inventory-service/api/reserve', [
            'product_ids' => $request->product_ids,
        ]);

        return response()->json(['order_id' => $orderId]);
    }
}

// 支付服务 - 读取上游透传的 Baggage
class PaymentController extends Controller
{
    public function charge(Request $request)
    {
        $userId = BaggageManager::getUserId(); // 自动从 baggage header 提取
        $tenantId = Baggage::getCurrent()->getEntry('tenant.id');
        $orderSource = Baggage::getCurrent()->getEntry('order.source');

        // 使用 Baggage 信息做业务决策
        if ($orderSource === 'mobile') {
            // 移动端限额不同
        }

        // 将 Baggage 信息记录到当前 Span 的 Attributes 中
        $span = Globals::tracerProvider()
            ->getTracer('payment-service')
            ->spanBuilder('payment.charge')
            ->setAttribute('user.id', $userId)
            ->setAttribute('tenant.id', $tenantId)
            ->startSpan();

        // ... 处理支付逻辑 ...
        $span->end();
    }
}
```

### Baggage 的注意事项

1. **大小限制**：W3C 规范建议 Baggage 总大小不超过 8192 字节，大多数实现默认限制 8KB
2. **安全性**：Baggage 会传播到所有下游服务，**绝不要放入敏感信息**（密码、Token、PII）
3. **性能影响**：每个请求都会在 Header 中携带 Baggage，条目越多 Header 越大
4. **编码问题**：键值中包含空格、逗号、等号等特殊字符时必须正确编码

## 采样策略：Head-based vs Tail-based Sampling

采样是生产环境中分布式追踪**最关键的决策之一**。全量采集每个 Trace 的开销远超你的想象：假设 QPS 为 1000，每个请求平均产生 20 个 Span，每个 Span 约 1KB——每天就是 1.7TB 的数据。

### Head-based Sampling（头部采样）

Head-based Sampling 在 Trace 开始时就决定是否采集，这个决策会通过 `trace-flags` 传播到所有下游服务。

```php
// OpenTelemetry SDK 提供的几种 Head-based Sampler

use OpenTelemetry\SDK\Trace\Sampler\AlwaysOnSampler;
use OpenTelemetry\SDK\Trace\Sampler\AlwaysOffSampler;
use OpenTelemetry\SDK\Trace\Sampler\TraceIdRatioBasedSampler;
use OpenTelemetry\SDK\Trace\Sampler\ParentBased;

// 1. 固定比率采样 - 采集 10% 的 Trace
$sampler = new TraceIdRatioBasedSampler(0.1);

// 2. ParentBased 采样（推荐）
// 如果有上游 Context，尊重上游的采样决策；
// 如果是根请求，使用传入的 Sampler 决策
$sampler = new ParentBased(
    new TraceIdRatioBasedSampler(0.1)
);

// 3. 通过环境变量配置
// OTEL_TRACES_SAMPLER=parentbased_traceidratio
// OTEL_TRACES_SAMPLER_ARG=0.1
```

**Head-based Sampling 的问题**：

```php
// 场景：99.9% 的请求是正常的，0.1% 是慢请求或错误
// 0.1 的采样率意味着你大概率丢失了出问题的那 0.1%

// 更糟糕的是：一个成功的 Trace 被采样了，但它调用的某个下游服务恰好
// 那次出了错误——这个错误就永远看不到了
```

### Tail-based Sampling（尾部采样）

Tail-based Sampling 在 Trace 完成后，根据整个 Trace 的特征决定是否保留。它能确保**所有错误和慢请求**都被采集。

```yaml
# 使用 OpenTelemetry Collector 实现 Tail-based Sampling
# otel-collector-config.yaml

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  tail_sampling:
    # 等待时间，用于收集完整的 Trace
    decision_wait: 10s
    # 最大 Trace 数（内存保护）
    num_traces: 100000
    policies:
      # 策略 1：保留所有错误 Trace
      - name: error-policy
        type: status_code
        status_code:
          status_codes:
            - ERROR
            - UNSET

      # 策略 2：保留所有慢请求（>2s）
      - name: latency-policy
        type: latency
        latency:
          threshold_ms: 2000

      # 策略 3：保留所有包含特定属性的 Trace
      - name: vip-user-policy
        type: string_attribute
        string_attribute:
          key: user.tier
          values:
            - premium
            - enterprise

      # 策略 4：默认采样 5%
      - name: probabilistic-policy
        type: probabilistic
        probabilistic:
          sampling_percentage: 5

      # 策略组合：满足任一策略即保留
      - name: composite-policy
        type: composite
        composite:
          max_total_spans_per_second: 5000
          policy_order:
            - error-policy
            - latency-policy
            - vip-user-policy
            - probabilistic-policy
          composite_sub_policy:
            - name: error-policy
              type: status_code
              status_code:
                status_codes: [ERROR]
            - name: latency-policy
              type: latency
              latency:
                threshold_ms: 2000
            - name: probabilistic-policy
              type: probabilistic
              probabilistic:
                sampling_percentage: 5
          rate_allocation:
            - policy: error-policy
              percent: 40
            - policy: latency-policy
              percent: 30
            - policy: probabilistic-policy
              percent: 30

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [tail_sampling]
      exporters: [otlp/jaeger]
```

**Tail-based Sampling 的权衡**：

| 维度 | Head-based | Tail-based |
|------|-----------|------------|
| 决策时机 | Trace 开始时 | Trace 结束后 |
| 能否保留错误 | ❌ 随机可能丢失 | ✅ 确保保留 |
| 内存开销 | 低 | 高（需缓存完整 Trace） |
| 实现复杂度 | 简单 | 复杂（需 Collector） |
| 多服务一致性 | ✅ 自然一致 | ⚠️ 需要 Collector 集中处理 |

### 混合采样策略（推荐）

生产环境推荐使用**两层采样**：

```
应用层（Head-based, 10%） → Collector（Tail-based, 保留错误+慢请求） → 后端
```

这样既减少了网络传输量（只有 10% 的数据到达 Collector），又确保了关键 Trace 不丢失。

## Jaeger/Zipkin 后端部署与可视化

### Docker Compose 一键部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  # Jaeger All-in-One（开发/测试环境）
  jaeger:
    image: jaegertracing/all-in-one:1.54
    ports:
      - "16686:16686"   # Jaeger UI
      - "4317:4317"     # OTLP gRPC
      - "4318:4318"     # OTLP HTTP
      - "14250:14250"   # Jaeger gRPC
    environment:
      - COLLECTOR_OTLP_ENABLED=true
      - SPAN_STORAGE_TYPE=badger
      - BADGER_DIRECTORY_VALUE=/badger/data
      - BADGER_DIRECTORY_KEY=/badger/key
    volumes:
      - jaeger-data:/badger

  # OpenTelemetry Collector（作为中间层）
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.96.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317"     # OTLP gRPC
      - "4318:4318"     # OTLP HTTP
      - "8888:8888"     # Collector metrics
    depends_on:
      - jaeger

  # Zipkin（可选，与 Jaeger 并存）
  zipkin:
    image: openzipkin/zipkin:3
    ports:
      - "9411:9411"

  # Prometheus（采集 Collector 和应用 metrics）
  prometheus:
    image: prom/prometheus:v2.50.1
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  # Grafana（统一可视化）
  grafana:
    image: grafana/grafana:10.3.3
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  jaeger-data:
  grafana-data:
```

### 追踪后端选型：Jaeger vs Zipkin vs Grafana Tempo

选对后端是分布式追踪落地的关键决策。以下是三种主流后端的深度对比：

| 维度 | Jaeger | Zipkin | Grafana Tempo |
|------|--------|--------|---------------|
| 开发语言 | Go | Java | Go |
| 部署复杂度 | 中等（All-in-One 可一键启动） | 低（单二进制） | 中等（需对象存储后端） |
| 存储引擎 | Cassandra / Elasticsearch / Badger / ClickHouse | Cassandra / Elasticsearch / MySQL | S3 / GCS / Azure Blob / 本地磁盘 |
| 查询语言 | Jaeger Query UI + TraceQL（v1.54+） | Zipkin UI（简单依赖图） | TraceQL（类 PromQL 语法，功能最强） |
| 依赖拓扑图 | ✅ 内置 Service Dependency Graph | ✅ 内置 Dependencies 页面 | ❌ 需配合 Grafana Service Graph |
| 采样策略支持 | 远程采样配置 + 自适应采样 | 固定概率采样 | 仅存储层过滤（无采样） |
| OpenTelemetry 原生支持 | ✅ 原生 OTLP gRPC/HTTP | ⚠️ 需 Zipkin Exporter 转换 | ✅ 原生 OTLP |
| 资源开销 | 中等（约 512MB RAM 起步） | 低（约 256MB RAM） | 低计算 + 高存储 |
| 适用场景 | 中大型微服务，需要依赖拓扑 | 小型项目、快速原型 | 大规模生产，需 TraceQL 高级查询 |
| 与 Grafana 集成 | ✅ Jaeger 数据源插件 | ✅ Zipkin 数据源插件 | ✅ 原生集成（同一生态） |
| 社区活跃度 | CNCF 毕业项目，高 | 早期标杆，活跃度下降 | CNCF 孵化项目，增长最快 |

**选型建议**：

```text
小型项目（<20 服务）        → Zipkin（部署简单，资源占用低）
中型项目（20-200 服务）     → Jaeger（功能全面，依赖拓扑直观）
大型项目（>200 服务）       → Grafana Tempo（查询性能最佳，存储成本最低）
已有 Grafana 生态           → Grafana Tempo（统一仪表盘体验）
需要实时采样调整            → Jaeger（支持远程采样配置变更）
```

**踩坑提醒：后端存储选型的常见陷阱**

```text
❌ 陷阱 1：开发环境用 Elasticsearch，生产也用 Elasticsearch
   → ES 的 JVM 堆内存需求随 Trace 数据量线性增长
   → 10 万 QPS 的 ES 集群至少需要 3 个 64GB 节点
   → 推荐：生产用 ClickHouse（Jaeger）或 对象存储（Tempo）

❌ 陷阱 2：Jaeger All-in-One 用于生产环境
   → All-in-One 将 Collector、Query、UI 打包在一个进程
   → 无法独立扩缩容，Badger 存储不支持集群
   → 推荐：生产环境拆分为独立的 Collector + Query + 存储

❌ 陷阱 3：忽略 Temporal 循环问题
   → OTel Collector 的 OTLP Receiver 暴露 4317 端口
   → 如果 Collector 自身的 telemetry 也发到自身，形成死循环
   → 推荐：Collector 的 telemetry 用独立端口或独立 Collector 实例
```

### Collector 配置（生产推荐）

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
        max_recv_msg_size_mib: 4
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024
    send_batch_max_size: 2048

  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128

  attributes:
    actions:
      - key: environment
        value: production
        action: upsert

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

  otlphttp/zipkin:
    endpoint: http://zipkin:9411/api/v2/spans

service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp/jaeger, otlphttp/zipkin]
  telemetry:
    logs:
      level: info
```

### Laravel 应用的环境变量配置

```env
# .env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=order-service
OTEL_SERVICE_VERSION=1.2.3
OTEL_EXPORTER_ENDPOINT=http://otel-collector:4317
OTEL_EXPORTER_PROTOCOL=grpc
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
OTEL_PROPAGATORS=tracecontext,baggage
```

## 生产踩坑：性能开销、采样丢失、Context 断裂

### 踩坑一：gRPC 扩展导致 OOM

**现象**：部署 OpenTelemetry gRPC 导出后，PHP-FPM 进程内存持续增长，最终 OOM Kill。

**根因**：gRPC 扩展的底层 Channel 对象不会随 PHP 请求销毁，而是持久存在。在 `pm=dynamic` 模式下，大量 FPM 进程共享的 gRPC Channel 导致内存泄漏。

**解决方案**：

```php
// 方案一：改用 HTTP 传输，避免 gRPC 扩展问题
// .env
OTEL_EXPORTER_PROTOCOL=http/protobuf
OTEL_EXPORTER_ENDPOINT=http://otel-collector:4318/v1/traces

// 方案二：如果必须用 gRPC，降低 batch 队列大小
// config/opentelemetry.php
'batch_size' => 100,           // 默认 512
'batch_timeout_ms' => 1000,    // 默认 5000，更频繁地刷新
```

### 踩坑二：Queue Job 的 Context 断裂

**现象**：HTTP 请求链路在发起 Queue Job 后断裂，Job 内部的 Span 成为独立的 Trace。

**根因**：Laravel Queue 的 Job 序列化时没有携带 Trace Context。

**解决方案**：

```php
<?php

namespace App\Tracing;

use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Queue\Events\JobPushing;
use Illuminate\Support\Facades\Queue;
use OpenTelemetry\API\Globals;
use OpenTelemetry\Context\Context;

class QueueContextPropagation
{
    public static function register(): void
    {
        // 生产端：将 Context 注入到 Job 的 metadata 中
        Queue::createPayloadUsing(function (string $connection, string $queue, $payload) {
            $carrier = [];
            Globals::propagator()->inject($carrier);

            return ['_otel_context' => $carrier];
        });

        // 消费端：从 Job metadata 中提取 Context
        Queue::before(function (JobProcessing $event) {
            $payload = json_decode($event->job->getRawBody(), true);
            $carrier = $payload['_otel_context'] ?? [];

            if (!empty($carrier)) {
                $context = Globals::propagator()->extract($carrier);
                // 激活提取到的 Context，后续创建的 Span 会自动成为子 Span
                $context->activate();
            }
        });
    }
}
```

### 踩坑三：Laravel Octane 环境下的 Context 泄漏

**现象**：使用 Swoole/Octane 时，请求 B 的 Trace 关联到了请求 A 的 Span 上。

**根因**：Octane 的 Worker 进程持久化，Context 对象在请求间未正确清理。

**解决方案**：

```php
<?php

namespace App\Tracing;

use Illuminate\Http\Request;
use OpenTelemetry\Context\Context;

class OctaneContextCleanup
{
    /**
     * 在 Octane 的 RequestTerminated 事件中清理 Context
     */
    public static function register(): void
    {
        // Octane 的请求结束后，重置到 Root Context
        \Laravel\Octane\Events\RequestTerminated::class;
        
        // 使用 middleware 方式更可靠
    }
}

// 更好的方式：在 TraceMiddleware 中确保 cleanup
// 在 finally 块中：
finally {
    $scope->detach();
    $span->end();
    // 重置到 Root Context（Octane 安全）
    Context::storage()->destroy();
}
```

### 踩坑四：采样策略导致错误 Trace 丢失

**现象**：Head-based 采样率为 1% 时，生产环境偶发的错误请求几乎全部丢失。

**解决方案**：使用 Collector 层的 Tail-based Sampling：

```yaml
# 在 Collector 配置中追加
processors:
  tail_sampling:
    decision_wait: 5s
    num_traces: 50000
    policies:
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: slow-requests
        type: string_attribute
        string_attribute:
          key: http.status_code
          values: ["5[0-9][0-9]"]
      - name: fallback
        type: probabilistic
        probabilistic:
          sampling_percentage: 1
```

同时，**应用层降低 Head-based 采样率到 10%**，让大部分数据到达 Collector，由 Collector 做精细化筛选：

```env
OTEL_TRACES_SAMPLER_ARG=0.1
```

### 踩坑五：span.kind 选错导致拓扑图混乱

**现象**：Jaeger 依赖拓扑图显示"订单服务调用自己"，实际是订单服务调用支付服务。

**根因**：内部手动创建 Span 时，`span.kind` 设置不正确。对于 HTTP 调用，发起方应是 `CLIENT`，接收方应是 `SERVER`。

```php
// ❌ 错误：在发起 HTTP 调用的服务中使用 KIND_SERVER
$span = $tracer->spanBuilder('call-payment')
    ->setSpanKind(SpanKind::KIND_SERVER) // 错误！
    ->startSpan();

// ✅ 正确：发起调用用 CLIENT
$span = $tracer->spanBuilder('call-payment')
    ->setSpanKind(SpanKind::KIND_CLIENT) // 正确
    ->setAttribute('peer.service', 'payment-service')
    ->startSpan();
```

### 踩坑六：大量 Span 导致性能下降

**现象**：集成自动埋点后，API 响应时间从 50ms 增长到 120ms。

**根因**：每个数据库查询都创建独立 Span，一个请求可能产生 50+ 个 DB Span，Span 创建和上报的 CPU 开销不可忽视。

**解决方案**：

```php
// 对高频 Span 进行采样或聚合
// 方案一：只记录慢查询 Span
Event::listen(QueryExecuted::class, function (QueryExecuted $event) {
    if ($event->time < 100) { // < 100ms 的查询不创建 Span
        return;
    }

    $tracer = Globals::tracerProvider()->getTracer('laravel-db');
    $span = $tracer->spanBuilder('db.slow_query')
        ->setAttribute('db.statement', $event->sql)
        ->setAttribute('db.duration_ms', $event->time)
        ->startSpan();
    $span->end();
});

// 方案二：使用 BatchSpanProcessor 调大队列（默认已启用）
// config/opentelemetry.php
'batch_size' => 2048,
'batch_timeout_ms' => 10000,
```

### 踩坑七：Collector 内存溢出与批量导出配置

**现象**：生产环境 OTel Collector 频繁 OOM，dmesg 显示 `Out of memory: Kill process`。

**根因**：默认配置下 Collector 没有设置 `memory_limiter`，当下游存储（Elasticsearch/Tempo）暂时不可用时，Span 数据在内存中无限堆积。

**解决方案**：

```yaml
# 生产环境必须配置 memory_limiter processor
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512          # 硬上限，超过即触发 GC
    spike_limit_mib: 128    # 允许的突发增量

  batch:
    timeout: 5s
    send_batch_size: 1024
    send_batch_max_size: 2048

  # 丢弃超大 Span（防止单条 Span 拖垮内存）
  attributes:
    actions:
      - key: db.statement
        action: update
        # 截断过长的 SQL 语句
```

同时，Collector 的副本数和资源配比建议：

```text
┌─────────────────────────────────────────────────┐
│           Collector 资源配比参考                   │
├──────────────┬──────────────┬───────────────────┤
│ 服务规模      │ 实例数       │ CPU / Memory       │
├──────────────┼──────────────┼───────────────────┤
│ <50 QPS      │ 1 副本       │ 0.5C / 512MB      │
│ 50-500 QPS   │ 2 副本       │ 1C / 1GB          │
│ 500-2000 QPS │ 3 副本       │ 2C / 2GB          │
│ >2000 QPS    │ 3+ 副本      │ 4C / 4GB          │
└──────────────┴──────────────┴───────────────────┘
```

### 踩坑八：消息队列（RabbitMQ/Kafka）中 Context 完全断裂

**现象**：HTTP 请求触发一条 Kafka 消息，消费者处理的 Span 成为完全独立的 Trace，与生产者没有任何关联。

**根因**：Kafka/RabbitMQ 不像 HTTP 有标准 Header 可以注入 `traceparent`。必须通过消息的 Headers（Kafka Record Headers / RabbitMQ Message Properties）手动传递 Context。

**解决方案**：

```php
<?php

namespace App\Tracing;

use OpenTelemetry\API\Globals;
use OpenTelemetry\Context\Context;

class KafkaContextPropagation
{
    /**
     * 生产端：将 Context 注入到 Kafka 消息 Header
     */
    public static function produceWithTrace(array $headers, array $message): array
    {
        $carrier = [];
        Globals::propagator()->inject($carrier);

        // carrier 中可能包含 traceparent 和 baggage
        foreach ($carrier as $key => $value) {
            $headers[] = [
                'key'   => $key,
                'value' => $value,
            ];
        }

        return $headers;
    }

    /**
     * 消费端：从 Kafka 消息 Header 中提取 Context
     */
    public static function consumeWithTrace(array $messageHeaders): Context
    {
        $carrier = [];
        foreach ($messageHeaders as $header) {
            $carrier[$header['key']] = $header['value'];
        }

        $context = Globals::propagator()->extract($carrier);
        $context->activate(); // 激活，后续创建的 Span 自动成为子 Span

        return $context;
    }
}
```

**RabbitMQ 场景**：

```php
// 生产端：注入 Context 到 AMQP Message Properties
use PhpAmqpLib\Message\AMQPMessage;

$carrier = [];
Globals::propagator()->inject($carrier);

$message = new AMQPMessage(
    json_encode($payload),
    [
        'content_type'  => 'application/json',
        'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT,
        'application_headers' => \PhpAmqpLib\Wire\AMQPTable::fromArray($carrier),
    ]
);

// 消费端：从 AMQP Headers 中提取
$context = Globals::propagator()->extract(
    $message->getDeliveryProperties()['application_headers']->getNativeData()
);
$context->activate();
```

### 踩坑九：Grafana Tempo 查询慢——TraceQL 使用不当

**现象**：使用 Tempo 查询时，某些查询需要 30+ 秒才能返回结果，P99 延迟飙高。

**根因**：TraceQL 中使用了 `|=` 正则匹配对全量 Trace 进行扫描，Tempo 的索引只支持按 Service Name、Span Name、Duration 等维度快速定位。

**优化策略**：

```text
❌ 慢查询：正则扫描所有 Span 的 db.statement
   { span.db.statement =~ "SELECT.*users.*WHERE" }

✅ 快查询：先按 Service 过滤，再按 Duration 排序
   { service.name = "order-service" && duration > 1s }
   | select span.db.statement, span.db.duration_ms
   | limit 20

✅ 利用 Tempo 的 Tag Index 加速
   在 Collector 配置中添加 attributes processor：
   将高频查询字段提升为 Span 的 top-level attribute
```

## 追踪基础设施的监控与告警

分布式追踪系统本身也是基础设施的一部分——如果追踪后端挂了，你的应用不会崩溃，但你会在生产问题发生时**失去因果分析能力**，变成"瞎子"。

### 需要监控的核心指标

```yaml
# Prometheus 告警规则示例（otel-alerts.yml）
groups:
  - name: otel-collector
    rules:
      # Collector 内存使用率超过 80%
      - alert: CollectorHighMemoryUsage
        expr: otel_collector_process_runtime_memory_heap_bytes / otel_collector_process_runtime_memstats_alloc_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "OTel Collector 内存使用率过高"

      # Collector Span 被丢弃（队列满）
      - alert: CollectorSpansDropped
        expr: rate(otelcol_processor_spanmetrics_dropped_spans_total[5m]) > 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "OTel Collector 正在丢弃 Span 数据"

      # Jaeger/Tempo 写入延迟过高
      - alert: TraceBackendHighWriteLatency
        expr: histogram_quantile(0.99, rate(jaeger_query_latency_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Trace 后端写入延迟 P99 > 2s"
```

### 追踪系统的健康检查清单

```text
每日自动检查项：
├── Collector 是否在线（健康检查端口 13133）
├── Collector 队列深度是否正常（<1000）
├── Span 丢弃率是否为零
├── Jaeger/Tempo 存储使用率是否 <80%
├── 最近 1 小时是否有 Span 上报（检测 SDK 配置问题）
└── 采样率是否与预期一致

每周检查项：
├── 存储数据保留策略是否生效
├── 是否需要根据 QPS 变化调整采样率
├── Collector 副本数是否匹配当前流量
└── Grafana 仪表盘是否覆盖所有核心服务
```

### 快速上手路线图

如果你的 Laravel 微服务还没有任何追踪能力，推荐按以下顺序逐步落地：

```text
Week 1：基础追踪
  ├── 安装 OpenTelemetry SDK
  ├── 配置 TraceMiddleware（自动创建 Root Span）
  ├── 接入 OTel Collector + Jaeger
  └── 验证：在 Jaeger UI 能看到 HTTP 请求链路

Week 2：跨服务传播
  ├── 配置 Guzzle 中间件自动注入 traceparent
  ├── 在所有服务的 HTTP Client 中启用追踪
  └── 验证：两个服务之间的调用能在同一个 Trace 中看到

Week 3：异步场景
  ├── 实现 Queue Job 的 Context 注入与提取
  ├── 实现 Kafka/RabbitMQ 的 Context 传播
  └── 验证：异步任务的 Span 正确关联到父请求

Week 4：生产加固
  ├── 配置 Tail-based Sampling（Collector 层）
  ├── 配置 memory_limiter + batch processor
  ├── 设置采样率告警
  ├── 配置 Grafana 仪表盘（RED 指标 + Trace 对比）
  └── 验证：错误请求 100% 被采集，慢请求有标记
```

## 最佳实践与总结

### 最佳实践清单

1. **始终使用 W3C Trace Context 标准**：不要使用厂商专有的 Header，`traceparent` + `tracestate` 是唯一正确选择

2. **Context 传播是第一优先级**：在实现任何追踪逻辑之前，先确保 Context 在 HTTP、gRPC、Queue、WebSocket 等所有传输通道上正确传播

3. **Baggage 只放业务标识**：用户 ID、租户 ID、请求来源等。绝不放敏感数据，控制条目数量在 10 个以内

4. **两层采样策略**：应用层用 Head-based（10%），Collector 层用 Tail-based（保留所有错误和慢请求）

5. **Resource 信息必须完整**：`service.name`、`service.version`、`deployment.environment` 是三个必须标注的 Resource Attribute

6. **Span 命名要规范**：遵循 OpenTelemetry Semantic Conventions（`HTTP GET`、`db.query`、`queue.publish`），不要使用动态值（如 `/api/users/12345`）

7. **异步任务必须手动传播 Context**：Queue Job、WebSocket Push、事件广播等不会自动携带 Context

8. **监控 Collector 本身**：Collector 的内存、CPU、队列深度、丢弃率都需要监控，否则它会成为新的盲点

9. **渐进式落地**：先实现 HTTP 层面的基础追踪，再逐步添加 DB、Cache、Queue、消息队列等异步场景的 Span

10. **定期审查采样率**：根据 Trace 数据量和存储成本动态调整，不要设完就忘

11. **Collector 必须配置 memory_limiter**：下游存储故障时 Span 数据会在内存中堆积，没有 memory_limiter 就是在裸奔

12. **消息队列的 Context 传播要显式处理**：Kafka、RabbitMQ 等消息中间件不会自动携带 `traceparent`，必须在生产端手动注入、消费端手动提取

### 总结

分布式追踪不是一个"锦上添花"的监控工具——它是微服务架构的**因果可观测性基础设施**。没有它，你面对的是一堆无法关联的孤立日志和 Metrics；有了它，你看到的是一个完整的请求因果链路。

在 Laravel 微服务中落地分布式追踪，关键路径是：

1. **Context 传播**：确保 W3C `traceparent` 在所有通信通道（HTTP、gRPC、Kafka、RabbitMQ、WebSocket）上正确传递
2. **SDK 集成**：OpenTelemetry SDK 自动处理大部分 HTTP 调用，但 Queue Job、消息队列等异步场景需要手动注入
3. **Baggage 透传**：将业务上下文贯穿整个链路，让 Trace 不只有技术数据，更有业务含义
4. **采样策略**：在成本和可观测性之间找到平衡点，两层采样（Head + Tail）是最优解
5. **后端选型**：根据服务规模选择 Jaeger/Zipkin/Tempo，并配置 memory_limiter 防止 Collector OOM
6. **渐进式落地**：先实现 HTTP 层面的基础追踪，再逐步添加 DB、Cache、Queue、消息队列的 Span

从一个简单的 `traceparent` Header 开始，逐步构建你的因果可观测性体系。当某天凌晨三点收到告警时，你能直接打开 Jaeger/Tempo UI，5 分钟内定位到根因——这就是分布式追踪的价值。

## 相关阅读

- [OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准——Laravel 应用全链路埋点](/2026/06/02/opentelemetry-unified-observability-laravel-full-stack-instrumentation/)
- [Grafana Tempo 实战：分布式追踪后端——OpenTelemetry 采集 + TraceQL 查询的因果可观测性](/2024/01/01/Grafana-Tempo-实战-分布式追踪后端-OpenTelemetry-采集-TraceQL-查询的因果可观测性/)
- [OpenTelemetry Collector Pipeline 实战：接收处理导出的三阶段架构——Laravel 应用的遥测数据治理](/2024/01/01/opentelemetry-collector-pipeline-laravel-telemetry/)
- [OpenTelemetry Auto-Instrumentation 实战：PHP 自动埋点——对比手动埋点的开发效率与性能开销权衡](/2024/01/01/OpenTelemetry-Auto-Instrumentation-实战-PHP-自动埋点-对比手动埋点的开发效率与性能开销权衡/)
