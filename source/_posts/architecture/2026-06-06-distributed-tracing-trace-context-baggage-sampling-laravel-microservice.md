---
title: Distributed Tracing 深度实战：Trace Context 传播、Baggage 透传与采样策略——Laravel 微服务的因果可观测性
date: 2026-06-06 10:00:00
description: '深入实战 Laravel 微服务分布式追踪：从 W3C Trace Context 标准协议出发，详解 Context 传播、Baggage 业务上下文透传、Head-based 与 Tail-based 采样策略选型，OpenTelemetry PHP SDK 集成与 Laravel 队列 Trace 断裂修复。覆盖 Jaeger vs Zipkin vs Grafana Tempo 后端对比、六大数据生产踩坑实录与完整排查方案，附可直接落地的生产级架构代码。'
tags: [Distributed Tracing, Observability, OpenTelemetry, Laravel, 微服务]
categories:
  - architecture
cover: /images/covers/distributed-tracing-cover.jpg
---

## 前言：为什么微服务架构下的可观测性需要分布式追踪

当你把一个单体 Laravel 应用拆分成十几个微服务之后，一个用户请求的完整生命周期可能穿越 API Gateway、认证服务、订单服务、库存服务、支付网关、通知服务等六七个节点。某个接口偶尔出现 3 秒延迟——问题出在哪一跳？是数据库慢查询、是第三方支付回调阻塞、还是消息队列积压？在单体时代，我们只需翻一份日志；在微服务时代，你需要的是一张能跨越所有服务边界的因果关系图——这就是分布式追踪存在的意义。

在实际的 Laravel 微服务架构中，我亲眼目睹过这样一个真实案例：用户在下订单时偶尔遇到超时，但所有的单个服务日志都显示正常。经过三天排查，最终发现是认证服务在某些情况下会调用一个外部的风控接口，该接口的响应时间波动极大，偶尔会超过 2 秒。如果没有分布式追踪提供的完整调用链路视图，这个问题几乎不可能在短时间内定位。这正是分布式追踪的核心价值——它把"分散在各个服务中的碎片信息"串成了一条完整的因果链。另一个常见的场景是：当某个用户的订单突然失败时，开发团队需要快速了解这个请求经历了哪些服务、在哪个环节出了问题、是否影响了其他用户。没有分布式追踪时，这种排查往往需要协调多个团队、翻阅多个系统的日志，耗时数小时甚至数天。

更进一步说，现代可观测性体系由三大支柱构成：指标（Metrics）、日志（Logging）和追踪（Tracing）。指标告诉你"出了什么问题"，日志告诉你"在哪里出了问题"，而追踪告诉你"为什么出了问题以及影响了哪些用户"。三者缺一不可，但追踪是唯一能够跨越服务边界呈现因果关系的维度。在微服务架构中，一个用户请求可能涉及 20 个以上的服务调用，任何一个环节出现问题都会影响最终的用户体验。分布式追踪能够让你在数秒内定位到具体的出错环节，而不是在几十个服务的日志文件中大海捞针。

传统日志和指标是"分散式"的：每个服务只记录自己的执行片段，缺少一条能把所有片段串成因果链的线。分布式追踪（Distributed Tracing）正是这条线。它通过在请求的整个生命周期内自动传播一个全局唯一的 Trace ID，将每个服务的处理过程记录为一个 Span，最终汇聚成一棵有向无环图（DAG），完整呈现请求的执行路径、耗时分布和错误传播。

在深入技术细节之前，让我们先理清几个核心概念。**Trace** 代表一个完整的请求链路，由一个全局唯一的 128 位 Trace ID 标识。**Span** 代表 Trace 中的一个操作单元，比如一次 HTTP 请求、一次数据库查询或一次消息队列的发送。每个 Span 包含操作名称、开始时间、持续时间、状态码和一组属性。Span 之间通过父子关系形成树状结构，根 Span 通常对应入口请求。**Context** 是随请求传播的元数据载体，包含 Trace ID、Span ID、Trace Flags 以及可选的 Tracestate 和 Baggage。

然而，在实际落地中，很多团队止步于"接了 SDK、能看到几条 Trace"的初级阶段。根据我的经验，大约 70% 的团队在初始接入后会遇到各种生产环境问题。真正的生产级难题在于：

1. **Context 传播的完整性**：HTTP 调用、gRPC 调用、消息队列、计划任务……不同传输通道的 Context 注入/提取机制各不相同，任何遗漏都会导致 Trace 断裂。
2. **业务上下文的透传**：仅靠 Trace ID 和 Span ID 不够，运维和开发还需要在任意节点快速知道"这个请求属于哪个用户、哪个租户"——这需要 Baggage 协议。
3. **采样策略的平衡**：100% 采集在高流量下成本爆炸，盲目降采样又会丢失关键错误链路。Head-based 与 Tail-based、概率采样与自适应采样，如何选配才合理？
4. **异步链路的追踪**：Laravel 队列任务是 Trace 的天然断点，如何把队列的 Producer 和 Consumer 串进同一条 Trace？
5. **性能开销控制**：在高并发场景下，追踪本身的性能开销必须控制在可接受的范围内，否则追踪系统反而会成为性能瓶颈。
6. **多语言异构系统的统一追踪**：当你的微服务涉及 PHP、Go、Python 等多种语言时，如何保证追踪协议的统一性和兼容性。

本文将以 Laravel 微服务为技术栈，从 W3C 标准协议出发，逐层深入 Trace Context 传播、Baggage 透传、采样策略、OpenTelemetry SDK 集成，最后覆盖后端选型与生产踩坑经验，给出一套可直接落地的方案。

---

## 一、Trace Context 传播：从 W3C 标准到 Laravel HTTP Client 实战

### 1.1 W3C Trace Context 标准概述

W3C Trace Context 是目前事实上的行业标准（2020 年进入 W3C Recommendation），定义了两个 HTTP Header：

- **`traceparent`**：携带必需的追踪标识，格式为：
  ```
  {version}-{trace-id}-{parent-id}-{trace-flags}
  00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
  ```
  - `version`：协议版本，当前固定 `00`
  - `trace-id`：128 位 Trace 全局标识，32 位十六进制字符串
  - `parent-id`：当前 Span 的父节点 ID，64 位十六进制字符串（也称 Span ID）
  - `trace-flags`：采样标志位，`01` 表示采样，`00` 表示不采样

- **`tracestate`**：厂商扩展字段，用于在不同遥测系统之间传递额外上下文（如 AWS X-Ray 的 `x-amzn-trace-id`、Datadog 的 `dd` 前缀等）。格式为逗号分隔的键值对列表。

这两个 Header 的组合，使得异构系统（PHP 服务调用 Go 服务、再调用 Java 服务）之间可以无损地传递追踪上下文。

### 1.2 在 Laravel 中手动注入 Trace Context

即便不使用自动埋点 SDK，理解手动注入的过程也是必要的。以下是通过 Laravel HTTP Client 和 Guzzle 中间件实现 Context 传播的完整方案。

**方案一：Laravel HTTP Client 的 Tap 回调**

```php
use OpenTelemetry\API\Globals;
use OpenTelemetry\Context\Context;

class TracingHttpClient
{
    public static function request(string $method, string $url, array $options = []): \Illuminate\Http\Client\Response
    {
        $tracer = Globals::tracerProvider()->getTracer('my-app');
        $span = $tracer->spanBuilder("HTTP $method $url")
            ->setSpanKind(\OpenTelemetry\API\Trace\SpanKind::CLIENT)
            ->startSpan();

        $scope = $span->activate();

        try {
            $response = \Illuminate\Support\Facades\Http::withHeaders(
                self::injectTraceHeaders()
            )->$method($url, $options);

            $span->setAttribute('http.status_code', $response->status());
            $span->setAttribute('http.url', $url);
            return $response;
        } catch (\Throwable $e) {
            $span->setStatus(\OpenTelemetry\API\Trace\StatusCode::ERROR, $e->getMessage());
            $span->recordException($e);
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }

    private static function injectTraceHeaders(): array
    {
        $headers = [];
        $propagator = Globals::propagator();
        $propagator->inject($headers, function ($carrier, $key, $value) {
            $carrier[$key] = $value;
            return $carrier;
        });
        return $headers;
    }
}
```

**方案二：Guzzle 中间件——全局透明注入**

对于大型项目，为每个 HTTP 调用都写 `injectTraceHeaders()` 显然不够优雅。更好的做法是注册一个 Guzzle Middleware：

```php
namespace App\Http\Middleware;

use GuzzleHttp\Middleware;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use Psr\Http\Message\RequestInterface;

class TracePropagationMiddleware
{
    public static function make(): callable
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

在 Laravel 的 `AppServiceProvider` 中注册：

```php
use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use App\Http\Middleware\TracePropagationMiddleware;

$this->app->bind(Client::class, function () {
    $handler = HandlerStack::create();
    $handler->push(TracePropagationMiddleware::make());
    return new Client(['handler' => $handler]);
});
```

**方案三：提取下游服务传入的 Context**

当你的 Laravel 应用作为下游服务接收请求时，需要从 Incoming Request 中提取 Trace Context：

```php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Globals;
use OpenTelemetry\Context\Context;

class ExtractTraceContext
{
    public function handle(Request $request, Closure $next)
    {
        // 从 HTTP Header 中提取上游传来的 Context
        $parentContext = Globals::propagator()->extract(
            $request->headers->all(),
            function ($carrier, $key) {
                return $carrier[strtolower($key)] ?? null;
            }
        );

        // 以提取到的 Context 为父级，创建服务端 Span
        $tracer = Globals::tracerProvider()->getTracer('my-app');
        $span = $tracer->spanBuilder("HTTP {$request->method()} {$request->path()}")
            ->setParent($parentContext)
            ->setSpanKind(SpanKind::SERVER)
            ->startSpan();

        $scope = $span->activate();

        // 将 Span 和 Scope 存入请求上下文，供后续逻辑使用
        $request->attributes->set('_otel_span', $span);
        $request->attributes->set('_otel_scope', $scope);

        $response = $next($request);

        $span->setAttribute('http.status_code', $response->getStatusCode());
        $span->end();
        $scope->detach();

        return $response;
    }
}
```

注册为全局中间件（`app/Http/Kernel.php`），确保每个请求在进入 Controller 之前就完成 Context 提取。

### 1.3 Context 传播的完整性保障

一个 Trace 要跨越多个服务不丢失，需要注意以下几个传播断点：

| 传播通道 | 注入方式 | 提取方式 |
|---------|---------|---------|
| HTTP 同步调用 | `traceparent` + `tracestate` Header | 请求中间件提取 |
| gRPC 调用 | gRPC Metadata | gRPC Interceptor 提取 |
| Laravel 队列任务 | Job Payload 或自定义 Header | Job Handler 提取 |
| 计划任务/Command | 无上游 Context，自建根 Span | 无需提取 |
| 数据库查询 | 通过 Span 嵌套自动关联 | 自动关联 |

对于 `tracestate` 的处理，许多团队只关注 `traceparent` 而忽略了 `tracestate`，这会导致跨厂商场景下（如从 AWS 服务追踪链路接入 Datadog）丢失上游系统的标识。OpenTelemetry SDK 默认会正确传播两者，但自定义传播器需要显式处理。

---

## 二、Baggage 透传机制：业务上下文的跨服务传播

### 2.1 Trace Context 与 Baggage 的区别

Trace Context 解决的是"请求走过了哪些服务、每步耗时多久"的问题。但运维和业务团队经常需要另一个维度的信息："这个慢请求属于哪个用户？来自哪个租户？触发了哪个 A/B 实验组？"

这些信息不是 Trace 标识的一部分，但又需要跨服务边界传播——这正是 W3C Baggage 协议的用途。在实际的微服务架构中，Baggage 通常用于传递用户身份标识、租户标识、请求来源、实验分组标识等需要在多个服务间共享的业务上下文。它解决了一个根本性的问题：如何在不耦合各个服务的业务逻辑的前提下，让关键的上下文信息自动流经整个调用链。

**Baggage 的核心设计原则**：
- **独立传播**：Baggage 使用独立的 HTTP Header（`baggage`），不依赖 `traceparent`，因此即使在不使用分布式追踪的场景下也可以单独使用。
- **大小限制**：W3C 规范建议 Baggage 的总大小不超过 8183 字节，键值对数量不超过 180 个。这是因为 HTTP Header 的大小直接影响网络传输效率和某些代理服务器的兼容性。
- **格式规范**：每个条目格式为 `key=value`，多个条目用逗号分隔，支持通过分号添加元数据属性。
- 独立于 Trace Context 传播（通过 `baggage` HTTP Header）
- 有大小限制（W3C 推荐总共不超过 8183 字节，键值对数量建议不超过 180 个）
- 支持元数据（属性声明，如 `userId=u123;tenant=acme;properties=pii`）
- 语义上是"附加业务上下文"，不是"替代 Trace Context"

### 2.2 在 Laravel 中实现 Baggage 透传

```php
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Baggage\BaggageBuilderInterface;
use OpenTelemetry\Context\Context;

class BaggageManager
{
    /**
     * 将业务上下文注入当前 Context 的 Baggage
     */
    public static function set(string $key, string $value, string $metadata = ''): void
    {
        $currentBaggage = Baggage::getCurrent();
        $builder = $currentBaggage->toBuilder();
        $builder->set($key, $value, $metadata);

        // 用更新后的 Baggage 替换当前 Context
        $updatedContext = Context::getCurrent()->withContextValue($builder->build());
        $updatedContext->activate();
    }

    /**
     * 从当前 Context 读取 Baggage 值
     */
    public static function get(string $key): ?string
    {
        $baggage = Baggage::getCurrent();
        $entry = $baggage->getEntry($key);
        return $entry ? $entry->getValue() : null;
    }

    /**
     * 将 Baggage 注入到出站请求的 Carrier 中
     */
    public static function inject(array &$carrier): void
    {
        Globals::propagator()->inject($carrier);
    }

    /**
     * 从入站请求提取 Baggage
     */
    public static function extract(array $carrier): void
    {
        Globals::propagator()->extract($carrier, function ($c, $key) {
            return $c[strtolower($key)] ?? null;
        });
    }
}
```

**在请求入口设置 Baggage**：

```php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Observability\BaggageManager;

class SetBusinessBaggage
{
    public function handle(Request $request, Closure $next)
    {
        // 从认证信息中提取用户和租户上下文
        if ($user = $request->user()) {
            BaggageManager::set('user.id', (string) $user->id);
            BaggageManager::set('user.email', $user->email, 'pii');
        }

        if ($tenantId = $request->header('X-Tenant-ID')) {
            BaggageManager::set('tenant.id', $tenantId);
        }

        // 从请求头注入的 A/B 实验组
        if ($experiment = $request->header('X-Experiment-Group')) {
            BaggageManager::set('experiment.group', $experiment);
        }

        return $next($request);
    }
}
```

**在任意下游服务读取 Baggage**：

```php
$userId = BaggageManager::get('user.id');
$tenantId = BaggageManager::get('tenant.id');
// 可以用于日志标记、数据库查询过滤、Span 属性等
```

### 2.3 Baggage 与 Span Attributes 的关系

一个常见误区是把所有业务上下文都塞进 Baggage。实际上：

- **Span Attributes**：记录在某个 Span 上，随 Span 一起上报，不会自动传播到下游。适用于"这个操作的上下文"。
- **Baggage**：跨服务边界传播，到达每个服务后可以手动转录为该服务的 Span Attributes。适用于"需要全局可见的业务上下文"。

最佳实践是：
1. 将关键业务上下文（用户ID、租户ID）放入 Baggage
2. 在每个服务的 Span 创建时，读取 Baggage 值写入 Span Attributes
3. 不要在 Baggage 中放敏感信息（如密码、Token），除非你有加密方案

```php
// 在 Span 创建时，自动将 Baggage 写入 Span Attributes
$tracer = Globals::tracerProvider()->getTracer('order-service');
$span = $tracer->spanBuilder('process_order')->startSpan();

$baggage = Baggage::getCurrent();
foreach ($baggage->getAllEntries() as $key => $entry) {
    $span->setAttribute("baggage.$key", $entry->getValue());
}
```

---

## 三、采样策略：在成本与完整性之间找到平衡

### 3.1 Head-based Sampling vs Tail-based Sampling

**Head-based Sampling**：在 Trace 的第一个 Span（入口）创建时，根据概率或规则决定是否采样。决策随 Context 传播，下游服务服从上游决策。

- 优点：实现简单、资源消耗低、无需等待完整 Trace 完成
- 缺点：可能误丢错误 Trace（入口正常但下游报错的请求被丢弃）

**Tail-based Sampling**：在 Trace 完成后再决定是否保留。Collector 收集完整 Trace 后，根据结果（是否包含错误、延迟是否超阈值）决策。

- 优点：可以保留所有错误和慢请求的完整链路
- 缺点：需要 Collector 暂存完整 Trace 数据，内存和 CPU 开销大；存在决策延迟

### 3.2 三种采样策略详解

**① 概率采样（Probabilistic Sampling）**

最简单的策略：以固定概率（如 10%）采样。适合流量均匀、没有明显高低峰的场景。

```yaml
# OpenTelemetry Collector 配置
processors:
  probabilistic_sampler:
    sampling_percentage: 10
    hash_seed: 42  # 确保同一条 Trace 的所有 Span 被一致采样
```

**② 限速采样（Rate Limiting Sampling）**

限制每秒最大采样数，超出部分丢弃。适合流量波动大的场景，防止高峰时段产生过多 Trace 数据。

```yaml
processors:
  tail_sampling:
    policies:
      - name: rate-limit
        type: rate_limiting
        rate_limiting:
          spans_per_second: 1000
```

**③ 自适应采样（Adaptive Sampling）**

根据实时流量动态调整采样率——流量低时多采样（保留更多细节），流量高时少采样（控制成本）。这是生产环境最推荐的策略。

```yaml
processors:
  tail_sampling:
    decision_wait: 30s
    num_traces: 100000
    policies:
      # 始终采样错误请求
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]

      # 采样慢请求（>2秒）
      - name: slow-traces
        type: latency
        latency:
          threshold_ms: 2000

      # 对正常请求按 5% 概率采样
      - name: normal-sampling
        type: probabilistic
        probabilistic:
          sampling_percentage: 5

      # 对特定服务（如支付服务）100% 采样
      - name: payment-service
        type: string_attribute
        string_attribute:
          key: service.name
          values: [payment-gateway]
```

### 3.3 Head-based + Tail-based 联合策略

生产环境的最佳实践是两级采样：

```
SDK 端（Head-based, 50% 概率）→ Agent 侧采样 → Collector 端（Tail-based）
```

- **第一级**：SDK 端以较高概率（如 50%）做 Head-based 采样，减少网络传输量
- **第二级**：Collector 端基于完整 Trace 决策，保留所有错误、慢请求、高价值服务的 Trace

```yaml
# Collector Pipeline 完整配置
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  tail_sampling:
    decision_wait: 15s
    num_traces: 50000
    expected_new_traces_per_sec: 1000
    policies:
      - name: errors-policy
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: latency-policy
        type: latency
        latency:
          threshold_ms: 1500
      - name: probabilistic-policy
        type: probabilistic
        probabilistic:
          sampling_percentage: 3

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

### 3.4 采样率调优公式

采样率不是拍脑袋决定的。一个经验公式：

```
采样率 = (后端存储每日预算 / 每条 Trace 平均大小) / 每日请求总量
```

举例：Jaeger 后端每日存储预算 50GB，每条 Trace 约 2KB，日请求量 1 亿次：
```
采样率 = (50 × 1024 × 1024 / 2) / 100,000,000 ≈ 26.2%
```

考虑到错误和慢请求需要 100% 采样，实际正常请求的采样率可以更低（如 3-5%）。

---

## 四、OpenTelemetry PHP SDK 在 Laravel 中的深度集成

### 4.1 安装与初始化

```bash
composer require open-telemetry/sdk \
    open-telemetry/exporter-otlp \
    open-telemetry/transport-grpc \
    open-telemetry/opentelemetry-auto-laravel \
    open-telemetry/opentelemetry-auto-pdo \
    open-telemetry/opentelemetry-auto-http-client
```

**自动埋点扩展**（需要安装 PHP 扩展）：

```bash
# 安装 opentelemetry-php-instrumentation 扩展
pecl install opentelemetry
# 或从源码编译
```

**创建初始化服务提供者**：

```php
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Common\Log\LoggerHolder;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Propagation\TextMapPropagator;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Common\Export\Http\ProtobufExporter;
use OpenTelemetry\SDK\Logs\LoggerProvider;
use OpenTelemetry\SDK\Metrics\MeterProvider;
use OpenTelemetry\SDK\Resource\AttributeFilter\DenyList;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SDK\Sdk;
use OpenTelemetry\SDK\Trace\Sampler\AlwaysOnSampler;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SemConv\ResourceAttributes;

class OpenTelemetryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TracerProvider::class, function () {
            $resource = ResourceInfoFactory::merge(
                ResourceInfo::create(Attributes::create([
                    ResourceAttributes::SERVICE_NAME => config('app.name'),
                    ResourceAttributes::SERVICE_VERSION => config('app.version', '1.0.0'),
                    ResourceAttributes::DEPLOYMENT_ENVIRONMENT => app()->environment(),
                    ResourceAttributes::SERVICE_INSTANCE_ID => gethostname(),
                ]))
            );

            $exporter = new ProtobufExporter(
                endpoint: env('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318/v1/traces'),
                headers: ['Authorization' => 'Bearer ' . env('OTEL_EXPORTER_OTLP_TOKEN', '')]
            );

            $sampler = new AlwaysOnSampler(); // 生产环境替换为自定义采样器

            $spanProcessor = new BatchSpanProcessor(
                $exporter,
                5000,  // 导出间隔（毫秒）
                512,   // 最大队列大小
                30000, // 导出超时（毫秒）
                100    // 批量大小
            );

            return new TracerProvider(
                [$spanProcessor],
                $sampler,
                $resource
            );
        });

        $this->app->singleton(TextMapPropagator::class, function () {
            return TraceContextPropagator::getInstance();
        });
    }

    public function boot(): void
    {
        // 注册 TracerProvider 到全局
        $tracerProvider = $this->app->make(TracerProvider::class);
        Globals::registerTracerProvider($tracerProvider);

        // 注册错误处理
        register_shutdown_function(function () use ($tracerProvider) {
            $tracerProvider->shutdown();
        });
    }
}
```

### 4.2 手动创建 Span——覆盖业务关键路径

自动埋点覆盖了 HTTP、数据库等基础设施层面，但业务逻辑内部的精细追踪需要手动创建 Span：

```php
namespace App\Services\OrderService;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class OrderService
{
    public function createOrder(array $orderData): Order
    {
        $tracer = Globals::tracerProvider()->getTracer('order-service');

        // 创建父 Span
        $span = $tracer->spanBuilder('order.create')
            ->setSpanKind(SpanKind::INTERNAL)
            ->setAttribute('order.customer_id', $orderData['customer_id'])
            ->setAttribute('order.item_count', count($orderData['items']))
            ->setAttribute('order.total_amount', $orderData['total_amount'])
            ->startSpan();

        $scope = $span->activate();

        try {
            // 子 Span 1：库存校验
            $this->validateInventory($orderData['items']);

            // 子 Span 2：价格计算（含折扣、税费）
            $finalPrice = $this->calculateFinalPrice($orderData);

            // 子 Span 3：创建数据库记录
            $order = $this->persistOrder($orderData, $finalPrice);

            // 添加事件（Event）记录关键里程碑
            $span->addEvent('order.validated', [
                'validation.result' => 'passed',
                'validation.duration_ms' => 42,
            ]);

            $span->addEvent('order.persisted', [
                'order.id' => $order->id,
                'order.status' => 'pending',
            ]);

            // 设置最终结果
            $span->setAttribute('order.id', $order->id);
            $span->setStatus(StatusCode::OK);

            return $order;
        } catch (InsufficientStockException $e) {
            $span->setStatus(StatusCode::ERROR, '库存不足');
            $span->recordException($e);
            $span->setAttribute('order.failure_reason', 'out_of_stock');
            throw $e;
        } catch (\Throwable $e) {
            $span->setStatus(StatusCode::ERROR, $e->getMessage());
            $span->recordException($e);
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }

    private function validateInventory(array $items): void
    {
        $tracer = Globals::tracerProvider()->getTracer('order-service');
        $span = $tracer->spanBuilder('order.validate_inventory')
            ->setAttribute('items.count', count($items))
            ->startSpan();

        $scope = $span->activate();

        try {
            foreach ($items as $item) {
                $span->addEvent('item.checking', [
                    'item.sku' => $item['sku'],
                    'item.quantity' => $item['quantity'],
                ]);
                // 库存校验逻辑...
            }
        } finally {
            $span->end();
            $scope->detach();
        }
    }

    private function calculateFinalPrice(array $orderData): float
    {
        $tracer = Globals::tracerProvider()->getTracer('order-service');
        $span = $tracer->spanBuilder('order.calculate_price')
            ->setAttribute('pricing.discount_code', $orderData['discount_code'] ?? 'none')
            ->startSpan();

        $scope = $span->activate();

        try {
            // 价格计算逻辑...
            $price = $orderData['total_amount'];

            // 记录计算步骤
            $span->addEvent('pricing.base_calculated', ['amount' => $price]);
            if ($discount = $orderData['discount_code'] ?? null) {
                $span->addEvent('pricing.discount_applied', ['code' => $discount, 'saved' => 10.0]);
                $price -= 10.0;
            }

            return $price;
        } finally {
            $span->end();
            $scope->detach();
        }
    }
}
```

### 4.3 Laravel 队列任务中的 Trace 传播

队列是 Trace 断裂的高发区。Laravel 队列任务在另一个进程中执行，与 HTTP 请求不在同一个执行上下文中。解决方案是将 Trace Context 序列化到 Job Payload 中：

**方案：自定义 Job 基类**

```php
namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\Context\Context;

abstract class TracedJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    // 将 Trace Context 序列化到 Job 数据中
    public array $traceContext = [];

    public function __construct()
    {
        // 在构造时（即 Producer 端）捕获当前 Context
        $carrier = [];
        Globals::propagator()->inject($carrier);
        $this->traceContext = $carrier;
    }

    /**
     * 在 Consumer 端恢复 Context 并创建 Span
     */
    protected function runWithTracing(callable $callback): mixed
    {
        // 从 Job 数据恢复上游 Context
        $parentContext = Globals::propagator()->extract(
            $this->traceContext,
            function ($carrier, $key) {
                return $carrier[strtolower($key)] ?? null;
            }
        );

        $tracer = Globals::tracerProvider()->getTracer('queue-worker');
        $span = $tracer->spanBuilder(static::class . '::handle')
            ->setParent($parentContext)
            ->setSpanKind(SpanKind::CONSUMER)
            ->setAttribute('messaging.system', 'laravel-queue')
            ->setAttribute('messaging.destination', $this->queue ?? 'default')
            ->startSpan();

        $scope = $span->activate();

        try {
            $result = $callback();
            $span->setStatus(StatusCode::OK);
            return $result;
        } catch (\Throwable $e) {
            $span->setStatus(StatusCode::ERROR, $e->getMessage());
            $span->recordException($e);
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }
}
```

**使用示例**：

```php
namespace App\Jobs;

class ProcessOrderJob extends TracedJob
{
    public function __construct(private int $orderId)
    {
        parent::__construct();
    }

    public function handle(): void
    {
        $this->runWithTracing(function () {
            $order = Order::findOrFail($this->orderId);

            // 在队列任务中创建子 Span
            $tracer = \OpenTelemetry\API\Globals::tracerProvider()->getTracer('queue-worker');
            $span = $tracer->spanBuilder('process_order_items')->startSpan();
            $scope = $span->activate();

            try {
                foreach ($order->items as $item) {
                    $this->processItem($item);
                }
            } finally {
                $span->end();
                $scope->detach();
            }
        });
    }
}
```

这种方案使得一条 Trace 可以完整地跨越 HTTP 请求和异步队列，形成"请求进入 → 推入队列 → 队列消费 → 完成处理"的完整因果链路。

---

## 五、后端选型对比：Jaeger vs Zipkin vs Grafana Tempo

### 5.1 三大方案深度对比

| 特性 | Jaeger | Zipkin | Grafana Tempo |
|------|--------|--------|---------------|
| **存储后端** | Elasticsearch / Cassandra / BadgerDB | Elasticsearch / Cassandra / MySQL | 对象存储（S3/GCS/MinIO） |
| **协议支持** | OTLP、Jaeger、Zipkin | Zipkin、OTLP（需适配器） | OTLP、Jaeger、Zipkin、OpenCensus |
| **查询语言** | 按服务名/Tag/时间/Duration 过滤 | 按服务名/Tag/时间过滤 | TraceQL（功能强大） |
| **查询性能** | 取决于存储后端 | 取决于存储后端 | 对象存储检索，首查较慢，有缓存后极快 |
| **存储成本** | 中高（Elasticsearch 资源消耗大） | 中高 | 低（对象存储成本极低） |
| **与 Prometheus/Grafana 集成** | 通过 Grafana 数据源 | 通过 Grafana 数据源 | 原生 Grafana 生态 |
| **服务依赖图** | 内置 | 内置 | 通过 Grafana 面板实现 |
| **社区活跃度** | 高（CNCF 毕业项目） | 中（独立项目） | 高（Grafana Labs 主导） |
| **学习曲线** | 中 | 低 | 中（需熟悉 Grafana 生态） |

### 5.2 选型建议

- **中小规模团队（日请求量 < 1 亿）**：Jaeger + Elasticsearch 是最稳妥的选择，生态成熟、文档完善、UI 功能全面。
- **已有 Grafana 生态的团队**：Grafana Tempo 是最优解，与 Prometheus（指标）、Loki（日志）、Pyroscope（Profiling）形成完整的可观测性四支柱闭环，且存储成本极低。
- **轻量级/实验性场景**：Zipkin 上手最快，适合 PoC 和小型项目。
- **极致存储成本优化**：Tempo 的对象存储方案（S3 + 压缩）比 Elasticsearch 方案节省 80% 以上存储成本。

### 5.3 快速部署：Grafana Tempo 全家桶

```yaml
# docker-compose.yml
version: '3.8'
services:
  # Tempo: 存储与查询 Trace
  tempo:
    image: grafana/tempo:2.5.0
    command: [ "-config.file=/etc/tempo.yaml" ]
    volumes:
      - ./tempo.yaml:/etc/tempo.yaml
      - tempo-data:/var/tempo
    ports:
      - "3200:3200"   # Tempo HTTP
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
    depends_on:
      - minio

  # MinIO: 对象存储模拟
  minio:
    image: minio/minio:latest
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data

  # Grafana: 可视化
  grafana:
    image: grafana/grafana:11.0.0
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: true
      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
    ports:
      - "3000:3000"
    volumes:
      - ./grafana-datasources.yaml:/etc/grafana/provisioning/datasources/datasources.yaml

  # OpenTelemetry Collector: 采集与处理
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.102.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "1888:1888"   # pprof
      - "8888:8888"   # Prometheus metrics
      - "13133:13133"  # health check

volumes:
  tempo-data:
  minio-data:
```

**Tempo 配置**：

```yaml
# tempo.yaml
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318

storage:
  trace:
    backend: s3
    s3:
      bucket: tempo-data
      endpoint: minio:9000
      access_key: minioadmin
      secret_key: minioadmin
      insecure: true
    wal:
      path: /var/tempo/wal
    local:
      path: /var/tempo/blocks

metrics_generator:
  registry:
    external_labels:
      source: tempo
      cluster: local
  storage:
    path: /var/tempo/generator/wal
    remote_write:
      - url: http://prometheus:9090/api/v1/write
        send_exemplars: true
```

---

## 六、生产环境踩坑实录

### 6.1 坑一：采样率调优——错误 Trace 丢失

**现象**：某次线上故障排查时发现，出错请求的 Trace 找不到。原因是使用了固定的 1% 概率采样，错误请求恰好落在了 99% 的丢弃区间。

**根因**：Head-based 概率采样对错误请求没有特殊处理。

**解决方案**：

```php
namespace App\Observability;

use OpenTelemetry\SDK\Trace\SamplerInterface;
use OpenTelemetry\SDK\Trace\SamplingResult;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class AdaptiveSampler implements SamplerInterface
{
    private float $normalRate;
    private int $errorRate; // 100 = 全部采样

    public function __construct(
        float $normalRate = 0.05,
        int $errorRate = 100
    ) {
        $this->normalRate = $normalRate;
        $this->errorRate = $errorRate;
    }

    public function shouldSample(
        $parentContext,
        string $traceId,
        string $name,
        SpanKind $spanKind,
        $attributes,
        $links
    ): SamplingResult {
        // 对 SERVER 类 Span，按 normalRate 采样
        if ($spanKind === SpanKind::SERVER) {
            $sampled = (mt_rand() / mt_getrandmax()) < $this->normalRate;
            return new SamplingResult(
                $sampled ? SamplingResult::RECORD_AND_SAMPLE : SamplingResult::DROP,
                $attributes
            );
        }

        // 非 SERVER Span 保持与父级一致
        return new SamplingResult(
            SamplingResult::RECORD_AND_SAMPLE,
            $attributes
        );
    }

    public function getDescription(): string
    {
        return "AdaptiveSampler(normal={$this->normalRate}, error=100%)";
    }
}
```

同时在 Collector 端配置 Tail-based 策略作为兜底，确保错误 Trace 不丢。

### 6.2 坑二：Context 丢失——中间件顺序问题

**现象**：某些请求的 Trace 只有一个 Span，下游调用没有被关联。

**根因**：`ExtractTraceContext` 中间件注册在了 Laravel 中间件栈的太后面，中间有其他中间件执行了 HTTP 调用，此时 Context 尚未提取。

**解决方案**：将 Trace Context 提取中间件放在最前面，优先于任何可能发起下游调用的中间件：

```php
// app/Http/Kernel.php
protected $middleware = [
    // 第一个！
    \App\Http\Middleware\ExtractTraceContext::class,
    \App\Http\Middleware\SetBusinessBaggage::class,
    // 其他中间件...
    \App\Http\Middleware\TrustProxies::class,
    \App\Http\Middleware\Cors::class,
    \App\Http\Middleware\Authenticate::class,
];
```

### 6.3 坑三：异步队列中 Trace 断裂

**现象**：HTTP 请求的 Trace 和队列任务的 Trace 是两条独立的 Trace，无法关联。

**根因**：队列任务被序列化到 Redis/数据库/消息队列时，PHP 进程的 Context 对象不会被序列化。在 Consumer 端启动时，Context 是空的。

**解决方案**：如前文第四节所示，在 Job 构造函数中手动将 `traceparent`/`tracestate`/`baggage` 序列化到 Job 属性中，在 Consumer 端的 `handle()` 方法中提取并恢复 Context。

**额外注意事项**：
- 使用 `php-queue-worker` 启动时，确保 OTLP Exporter 已初始化（Worker 进程和 Web 进程的 ServiceProvider 启动路径不同）
- 队列任务的 Span 可能出现在 Trace 的中间节点，而非根节点——这是正常的，因为它依赖于 HTTP 请求端创建的 Context

### 6.4 坑四：OTLP Exporter 超时导致请求变慢

**现象**：接入 OpenTelemetry 后，HTTP 接口延迟增加了 200-500ms。

**根因**：使用了同步 Exporter，每个 Span 结束时都要等待网络传输完成。

**解决方案**：
1. 使用 `BatchSpanProcessor` 替代 `SimpleSpanProcessor`（默认就应该用 Batch）
2. 确保 `opentelemetry` PHP 扩展已安装，自动埋点开销可以降低到微秒级
3. Collector 部署在应用同机或同可用区，减少网络延迟

```php
// 正确做法：BatchSpanProcessor
$processor = new BatchSpanProcessor(
    exporter: $exporter,
    maxQueueSize: 2048,      // 队列满时丢弃而非阻塞
    scheduledDelayMillis: 5000, // 每 5 秒批量发送
    exportTimeoutMillis: 30000, // 发送超时 30 秒
    maxExportBatchSize: 512    // 每批最多 512 个 Span
);
```

### 6.5 坑五：TraceID 冲突与碰撞

**现象**：两条不相关的请求出现在同一条 Trace 中。

**根因**：Trace ID 为 128 位，理论上碰撞概率极低（2^-128），但如果随机数生成器质量差或种子相同，可能产生重复。

**解决方案**：确保 PHP 使用了密码学安全的随机数生成器。OpenTelemetry SDK 默认使用 `random_bytes()`，通常没有问题。如果你自定义了 Trace ID 生成逻辑，务必使用 `random_bytes(16)` 或 `bin2hex(random_bytes(16))`。

### 6.6 坑六：多租户场景下的数据隔离

**现象**：租户 A 的 Trace 数据出现在租户 B 的查询结果中，存在数据泄露风险。

**根因**：Trace 后端（Jaeger/Tempo）默认没有租户隔离机制。

**解决方案**：
- 使用 Grafana Tempo 的多租户模式，通过 `X-Scope-OrgID` Header 隔离数据
- 在 Collector 端根据 Baggage 中的 `tenant.id` 添加租户标识 Header
- 在 Jaeger 中通过 Elasticsearch 的 Index Pattern 实现逻辑隔离

---

## 七、完整架构图与数据流

以下是生产级的完整数据流：

```
┌──────────────┐    traceparent + baggage     ┌──────────────┐
│  API Gateway  │ ─────────────────────────→   │  订单服务     │
│  (Nginx+Lua)  │                              │  (Laravel)    │
└──────────────┘                               └──────┬───────┘
       │                                              │
       │                                          ┌───▼───────┐
       │        traceparent (HTTP Header)         │ 库存服务    │
       │ ──────────────────────────────────────→  │ (Laravel)  │
       │                                          └───────────┘
       │
       │        traceparent (Job Payload)
       │ ─────→ Queue (Redis/RabbitMQ)
       │                    │
       │                    │ Consumer
       │                    ▼
       │            ┌──────────────┐
       │            │  通知服务     │
       │            │  (Laravel)    │
       │            └──────┬───────┘
       │                   │
       │                   │  traceparent (HTTP)
       │                   ▼
       │            ┌──────────────┐
       │            │  外部推送 API  │
       │            └──────────────┘
       │
       ▼
┌───────────────────────────────────────────────┐
│          OpenTelemetry Collector               │
│  ┌─────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Receiver │→│ Tail Sampler  │→│ Exporter  │ │
│  │  (OTLP)  │  │ (错误100%)   │  │ (OTLP)   │ │
│  └─────────┘  └──────────────┘  └─────┬────┘ │
└───────────────────────────────────────┼──────┘
                                        │
                   ┌────────────────────┼────────────────────┐
                   │                    │                    │
                   ▼                    ▼                    ▼
            ┌──────────┐        ┌──────────┐        ┌──────────┐
            │  Jaeger   │        │  Tempo   │        │  Zipkin  │
            └──────────┘        └──────────┘        └──────────┘
                   │                    │
                   ▼                    ▼
            ┌──────────────────────────────────┐
            │          Grafana Dashboard        │
            │  ┌────────┐  ┌────────────────┐  │
            │  │Service │  │ Trace Explorer  │  │
            │  │  Map   │  │ + TraceQL       │  │
            │  └────────┘  └────────────────┘  │
            └──────────────────────────────────┘
```

---

## 八、总结与最佳实践清单

经过上述深度实战，我整理了一份可直接用于生产环境的 Checklist：

### Context 传播

- [x] 所有 HTTP 出站调用通过 Guzzle Middleware 注入 `traceparent` + `tracestate`
- [x] 所有入站请求通过全局中间件提取 Context（放在中间件栈最前面）
- [x] 队列任务通过 Job Payload 携带 Context
- [x] 定期验证 Trace 完整性（`traceparent` 传播到所有下游节点）

### Baggage 透传

- [x] 在认证中间件中设置 `user.id`、`tenant.id` 等关键业务上下文
- [x] 在每个服务的 Span 创建时，读取 Baggage 写入 Span Attributes
- [x] 不在 Baggage 中存放敏感凭据（密码、API Key）
- [x] 设置 Baggage 条目数量上限，避免 Header 过大

### 采样策略

- [x] SDK 端使用 Head-based 概率采样（10-50%），减少网络传输
- [x] Collector 端使用 Tail-based 采样，保留所有错误和慢请求
- [x] 对关键服务（支付、认证）100% 采样
- [x] 每月复查采样率与存储成本，动态调整

### SDK 集成

- [x] 安装 PHP 扩展 `opentelemetry` 实现自动埋点
- [x] 使用 `BatchSpanProcessor` 避免同步导出阻塞请求
- [x] 在业务关键路径手动创建 Span，添加语义化 Attributes 和 Events
- [x] 在 `register_shutdown_function` 中调用 `TracerProvider::shutdown()`

### 后端运维

- [x] 选择与团队技术栈匹配的后端（已有 Grafana → Tempo，从零开始 → Jaeger）
- [x] 配置合理的数据保留策略（通常 7-30 天）
- [x] 设置存储容量告警
- [x] 定期清理过期 Trace 数据

### 排障能力

- [x] 在日志中记录 Trace ID 和 Span ID（结构化日志），实现日志-Trace 互查
- [x] 建立"根据错误日志中的 Trace ID → 在 Trace 后端查看完整链路"的排查 SOP
- [x] 记录 Context 丢失的排查经验文档

---

分布式追踪不是一个"接入即可遗忘"的特性，而是一个需要持续运营的可观测性基础设施。从 Context 传播的完整性，到 Baggage 的合理使用，到采样策略的动态调优，每一个环节都影响着你在生产故障时能否快速定位根因。

希望这篇文章能帮助你少走弯路，在 Laravel 微服务架构上构建真正可靠的因果可观测性体系。

---

## 相关阅读

- [服务网格 Sidecar 模式实战：Envoy Proxy + Laravel——流量镜像、熔断、重试的基础设施下沉与应用层解耦](/架构/Service-Mesh-Sidecar-模式实战-Envoy-Proxy-Laravel-流量镜像熔断重试的基础设施下沉与应用层解耦/) — 服务网格是分布式追踪的重要基础设施层，Envoy Sidecar 可以自动注入 Trace Header，与本文的 Context 传播方案形成互补。
- [Dapr 实战：分布式应用运行时——Laravel 微服务的 Sidecar 模式、服务调用与发布订阅](/架构/Dapr-实战-分布式应用运行时-Laravel微服务的Sidecar模式服务调用与发布订阅/) — Dapr 内置了基于 OpenTelemetry 的分布式追踪能力，是本文 OTel SDK 集成方案的更高层抽象替代。
- [Kubernetes Gateway API 实战：Ingress 的下一代标准——Laravel 微服务的流量管理新范式](/架构/Kubernetes-Gateway-API-Ingress-下一代标准-Laravel微服务流量管理/) — Gateway API 层面的流量可观测性是分布式追踪的上游入口，理解网关链路有助于排查 Trace 断裂问题。
