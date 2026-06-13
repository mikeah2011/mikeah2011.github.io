---

title: OpenTelemetry Baggage 实战：跨服务上下文传播——分布式追踪中的业务标签透传与采样策略
keywords: [OpenTelemetry Baggage, 跨服务上下文传播, 分布式追踪中的业务标签透传与采样策略]
date: 2026-06-03 00:00:00
tags:
- OpenTelemetry
- Baggage
- context-propagation
- 分布式
- 可观测性
- 微服务
- 链路追踪
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 本文深入讲解 OpenTelemetry Baggage 与 Context Propagation 的实战应用，涵盖 W3C Baggage 规范、PHP/Laravel SDK 集成、跨服务业务标签透传、基于 Baggage 的智能采样策略，以及 8 个生产环境真实踩坑案例。帮助你在微服务架构中实现高效的链路追踪与可观测性，精准定位跨服务性能问题。
---





## 前言

在微服务架构中，一个用户请求可能经过 10 个以上的服务。当出现性能问题或异常时，我们不仅需要知道请求经过了哪些服务（这是分布式追踪解决的问题），还需要知道这次请求的业务上下文——是哪个租户发起的？用户是什么等级？请求来源是 App 还是 Web？

这些业务标签需要在服务间透明传递，最终出现在每一条 Span 上，这就是 **OpenTelemetry Baggage** 的核心价值。

本文将深入探讨 Baggage 的机制、W3C 规范、Laravel PHP SDK 集成、业务标签透传实战、采样策略中的应用，以及在生产环境中的真实踩坑经验。

---

## 一、OpenTelemetry Baggage 概念与 W3C 规范

### 1.1 什么是 Baggage？

Baggage 是 OpenTelemetry Context Propagation 机制的一部分，它允许在分布式追踪的上下文中携带一组键值对（key-value pairs），这些键值对会随着请求在服务间自动传播。

```
用户请求 → Service A → Service B → Service C
              ↓               ↓              ↓
         Baggage:          Baggage:       Baggage:
         tenant_id=B2B     tenant_id=B2B  tenant_id=B2B
         user_tier=gold    user_tier=gold user_tier=gold
         source=mobile     source=mobile  source=mobile
```

与 Span Attributes 不同，Baggage 的核心特点是：
- **跨服务传播**：Span Attributes 只在当前 Span 上，Baggage 跨越服务边界
- **与 Trace 解耦**：Baggage 不依赖于是否开启了追踪
- **轻量级**：设计用于携带少量关键上下文

### 1.2 W3C Baggage 规范

W3C 定义了 Baggage 的 HTTP 传播格式。OpenTelemetry 的默认实现使用 `baggage` HTTP Header：

```http
GET /api/orders HTTP/1.1
Host: order-service.example.com
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
baggage: tenant_id=B2B,user_tier=gold,source=mobile
```

**格式规范：**
```
baggage = list-members
list-members = baggage-item *( OWS "," OWS baggage-item )
baggage-item = key "=" value *( ";" property )
property = key "=" value
```

**示例：**
```http
# 简单键值对
baggage: tenant_id=B2B,user_tier=gold

# 带属性（properties）
baggage: tenant_id=B2B;prop1=value1,user_tier=gold

# URL 编码（特殊字符必须编码）
baggage: user_name=John%20Doe,department=R%26D
```

### 1.3 Baggage vs Span Attributes vs Resource Attributes

| 特性 | Baggage | Span Attributes | Resource Attributes |
|------|---------|-----------------|---------------------|
| 传播范围 | 跨服务 | 当前 Span | 当前 SDK 实例 |
| 存储位置 | Context | Span | Resource |
| 适用场景 | 业务上下文透传 | 单服务内事件描述 | 服务/实例标识 |
| 大小限制 | 8192 字节 | 无硬限制 | 无硬限制 |
| 生命周期 | 随 Context | 随 Span | 随 SDK 初始化 |
| 后端存储 | 通常不存储 | 存储 | 存储 |

**关键区别：**

```
# Baggage：跨服务传播
Service A → (baggage: tenant_id=B2B) → Service B → (baggage: tenant_id=B2B) → Service C
                                                     ↑ Span 上自动添加 tenant_id

# Span Attributes：仅当前 Span
Service B span: { db.query: "SELECT *", tenant_id: "B2B" }
// Service C 看不到 Service B 的 span attributes
```

---

## 二、跨服务传播机制

### 2.1 HTTP 传播（最常见的场景）

OpenTelemetry 通过 **Propagator** 实现跨服务传播。默认的 `W3CBaggagePropagator` 会：

**在发送请求时（inject）：** 将 Baggage 序列化到 `baggage` HTTP Header
**在接收请求时（extract）：** 从 `baggage` HTTP Header 反序列化到 Context

```php
<?php

use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Baggage\BaggageBuilderInterface;
use OpenTelemetry\Context\Context;

// === 服务 A：设置 Baggage ===
$baggage = Baggage::getCurrent()
    ->toBuilder()
    ->set('tenant_id', 'B2B')
    ->set('user_tier', 'gold')
    ->set('request_source', 'mobile')
    ->build();

// 将 Baggage 设置到当前 Context
$scope = $baggage->activate();

// 发起 HTTP 请求时，Propagator 自动注入 baggage header
$response = Http::get('http://service-b/api/data');
// 实际发出的请求头：
// baggage: tenant_id=B2B,user_tier=gold,request_source=mobile

$scope->detach();
```

### 2.2 gRPC Metadata 传播

在 gRPC 微服务中，Baggage 通过 Metadata 传播：

```php
<?php

use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\Context\Propagation\ArrayAccessGetterSetter;

// gRPC Client Interceptor
class BaggageGrpcInterceptor implements ClientInterceptor
{
    public function interceptUnaryUnary(
        UnaryCall $call,
        array $headers,
        ClientInterceptor $next
    ): UnaryCall {
        // 从当前 Context 提取 Baggage
        $baggage = Baggage::getCurrent();

        // 序列化到 gRPC Metadata
        $baggageHeader = $this->serializeBaggage($baggage);
        $headers['baggage'] = [$baggageHeader];

        return $next->interceptUnaryUnary($call, $headers, $next);
    }

    private function serializeBaggage(Baggage $baggage): string
    {
        $pairs = [];
        foreach ($baggage->getAll() as $entry) {
            $pairs[] = $entry->getKey() . '=' . urlencode($entry->getValue());
        }
        return implode(',', $pairs);
    }
}
```

### 2.3 Laravel HTTP Client 集成

在 Laravel 中，我们需要确保 `Http::` 客户端自动传播 Baggage。这通过中间件实现：

```php
<?php

namespace App\OpenTelemetry\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Baggage\Propagation\BaggagePropagator;
use OpenTelemetry\Context\Context;

class InjectBaggageMiddleware
{
    /**
     * 在发送 HTTP 请求前注入 Baggage
     */
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        // 为后续的 HTTP 请求设置 Baggage
        $this->propagateBaggageFromRequest($request);

        return $response;
    }

    private function propagateBaggageFromRequest(Request $request): void
    {
        $baggageHeader = $request->header('baggage');

        if ($baggageHeader) {
            // 从传入请求中提取 Baggage 并设置到当前 Context
            $propagator = new BaggagePropagator();
            $context = $propagator->extract(
                ['baggage' => $baggageHeader],
                Context::getCurrent()
            );
            $context->activate();
        }
    }
}
```

**Laravel Service Provider 注册：**

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Baggage\Propagation\BaggagePropagator;
use OpenTelemetry\API\Globals;
use OpenTelemetry\Context\Propagation\TextMapPropagator;

class OpenTelemetryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 注册 Baggage Propagator
        $this->app->singleton(TextMapPropagator::class, function () {
            return BaggagePropagator::getInstance();
        });
    }

    public function boot(): void
    {
        // 注册全局 Propagator
        Globals::setPropagator(
            TextMapPropagator::composite(
                BaggagePropagator::getInstance(),
                \OpenTelemetry\API\Trace\Propagation\TraceContextPropagator::getInstance(),
            )
        );
    }
}
```

---

## 三、业务标签透传实战

### 3.1 核心业务标签设计

在 B2C 电商场景中，常见的业务标签包括：

| 标签 Key | 类型 | 说明 | 示例值 |
|----------|------|------|--------|
| `tenant_id` | string | 租户标识 | B2B, B2C, B2B2C |
| `user_tier` | string | 用户等级 | gold, silver, bronze |
| `user_id` | string | 用户 ID | 12345 |
| `request_source` | string | 请求来源 | mobile, web, mini-program |
| `region` | string | 地域 | cn-east, us-west |
| `experiment_group` | string | A/B 实验组 | control, treatment-a |
| `feature_flags` | string | 功能开关 | dark-mode,beta-checkout |
| `order_type` | string | 订单类型 | normal, flash-sale, pre-order |
| `channel` | string | 渠道 | direct, affiliate, ad |

### 3.2 在 Laravel 中注入 Baggage

```php
<?php

namespace App\OpenTelemetry;

use Illuminate\Http\Request;
use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Baggage\BaggageBuilderInterface;

class BaggageFactory
{
    /**
     * 从 HTTP 请求创建 Baggage
     */
    public static function fromRequest(Request $request): Baggage
    {
        $builder = Baggage::getCurrent()->toBuilder();

        // 用户信息
        if ($user = $request->user()) {
            $builder->set('user_id', (string) $user->id);
            $builder->set('user_tier', $user->tier ?? 'standard');
        }

        // 租户信息
        if ($tenantId = $request->header('X-Tenant-ID')) {
            $builder->set('tenant_id', $tenantId);
        }

        // 请求来源
        $builder->set('request_source', self::detectSource($request));

        // 地域信息
        if ($region = $request->header('X-Region')) {
            $builder->set('region', $region);
        }

        // A/B 实验组
        if ($experimentGroup = $request->cookie('experiment_group')) {
            $builder->set('experiment_group', $experimentGroup);
        }

        return $builder->build();
    }

    /**
     * 检测请求来源
     */
    private static function detectSource(Request $request): string
    {
        $userAgent = $request->userAgent();

        if (str_contains($userAgent, 'MiniProgram')) {
            return 'mini-program';
        }

        if ($request->header('X-Platform') === 'app') {
            return 'mobile';
        }

        return 'web';
    }
}
```

### 3.3 Baggage 到 Span Attributes 的桥接

Baggage 的值需要映射到 Span Attributes，才能在后端（Jaeger、Grafana Tempo 等）中被查询和分析：

```php
<?php

namespace App\OpenTelemetry;

use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Trace\Span;
use OpenTelemetry\SDK\Trace\SpanProcessorInterface;
use OpenTelemetry\SDK\Trace\ReadableSpanInterface;
use OpenTelemetry\SDK\Trace\ReadWriteSpanInterface;

class BaggageSpanProcessor implements SpanProcessorInterface
{
    /**
     * 在 Span 结束时，将 Baggage 值复制到 Span Attributes
     */
    public function onEnd(ReadableSpanInterface $span): void
    {
        $baggage = Baggage::getCurrent();

        // 获取需要透传到 Span 的 Baggage keys
        $propagateKeys = config('opentelemetry.baggage_to_span_attributes', [
            'tenant_id',
            'user_tier',
            'request_source',
            'region',
            'experiment_group',
        ]);

        foreach ($propagateKeys as $key) {
            $entry = $baggage->getEntry($key);
            if ($entry !== null) {
                $span->setAttribute("baggage.{$key}", $entry->getValue());
            }
        }
    }

    public function onStart(ReadWriteSpanInterface $parentContext, $parentContext2): void {}
    public function forceFlush(?CancellationInterface $cancellation = null): bool { return true; }
    public function shutdown(?CancellationInterface $cancellation = null): bool { return true; }
}
```

### 3.4 在中间件中自动设置 Baggage

```php
<?php

namespace App\Http\Middleware;

use App\OpenTelemetry\BaggageFactory;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use OpenTelemetry\API\Baggage\Baggage;

class SetOpenTelemetryBaggage
{
    public function handle(Request $request, Closure $next): Response
    {
        // 1. 先从传入请求中提取已有 Baggage
        $baggageHeader = $request->header('baggage');
        $existingBaggage = Baggage::getEmpty();

        if ($baggageHeader) {
            $propagator = new \OpenTelemetry\API\Baggage\Propagation\BaggagePropagator();
            $context = $propagator->extract(
                ['baggage' => $baggageHeader]
            );
            $existingBaggage = Baggage::fromContext($context);
        }

        // 2. 从请求信息创建新的 Baggage
        $newBaggage = BaggageFactory::fromRequest($request);

        // 3. 合并：新值覆盖旧值
        $builder = $existingBaggage->toBuilder();
        foreach ($newBaggage->getAll() as $entry) {
            $builder->set($entry->getKey(), $entry->getValue());
        }
        $mergedBaggage = $builder->build();

        // 4. 激活到当前 Context
        $scope = $mergedBaggage->activate();

        try {
            $response = $next($request);
        } finally {
            $scope->detach();
        }

        return $response;
    }
}
```

---

## 四、采样策略中 Baggage 的应用

### 4.1 Head-Based Sampling 的局限

Head-Based Sampling 在请求入口处决定是否采样。传统方式只看 URL、状态码等，无法根据业务维度决策：

```
# 传统 head-based sampling
if (url.startsWith('/api/orders')) {
    sampleRate = 0.1; // 10% 采样
}

# 问题：B2B 租户的订单只有 10% 被记录
# 但 B2B 租户出问题时，我们希望 100% 采样
```

### 4.2 Baggage 驱动的智能采样

利用 Baggage 中的业务标签，我们可以实现更智能的采样策略：

```php
<?php

namespace App\OpenTelemetry\Sampling;

use OpenTelemetry\SDK\Trace\SamplerInterface;
use OpenTelemetry\SDK\Trace\SamplingResult;
use OpenTelemetry\API\Baggage\Baggage;

class BaggageAwareSampler implements SamplerInterface
{
    private array $config;

    public function __construct(array $config)
    {
        $this->config = $config;
    }

    public function shouldSample(
        $parentContext,
        $traceId,
        string $name,
        int $spanKind,
        array $attributes,
        array $links
    ): SamplingResult {
        $baggage = Baggage::fromContext($parentContext);

        // 策略 1：VIP 用户 100% 采样
        $userTier = $baggage->getEntry('user_tier');
        if ($userTier && in_array($userTier->getValue(), ['gold', 'platinum'])) {
            return new SamplingResult(
                SamplingResult::RECORD_AND_SAMPLE,
                $attributes
            );
        }

        // 策略 2：B2B 租户 50% 采样
        $tenantId = $baggage->getEntry('tenant_id');
        if ($tenantId && $tenantId->getValue() === 'B2B') {
            if (mt_rand(1, 100) <= 50) {
                return new SamplingResult(
                    SamplingResult::RECORD_AND_SAMPLE,
                    $attributes
                );
            }
        }

        // 策略 3：A/B 实验组 100% 采样
        $experimentGroup = $baggage->getEntry('experiment_group');
        if ($experimentGroup) {
            return new SamplingResult(
                SamplingResult::RECORD_AND_SAMPLE,
                $attributes
            );
        }

        // 策略 4：默认 10% 采样
        if (mt_rand(1, 100) <= 10) {
            return new SamplingResult(
                SamplingResult::RECORD_AND_SAMPLE,
                $attributes
            );
        }

        return new SamplingResult(SamplingResult::DROP);
    }

    public function getDescription(): string
    {
        return 'BaggageAwareSampler';
    }
}
```

### 4.3 Tail-Based Sampling 与 Baggage

Tail-Based Sampling 在请求完成后决定是否保留，可以利用完整的 Baggage 信息：

```php
<?php

namespace App\OpenTelemetry\Sampling;

use OpenTelemetry\SDK\Trace\SpanProcessorInterface;
use OpenTelemetry\SDK\Trace\ReadableSpanInterface;

class TailSamplingSpanProcessor implements SpanProcessorInterface
{
    public function onEnd(ReadableSpanInterface $span): void
    {
        $baggage = Baggage::getCurrent();

        // 规则 1：错误请求 100% 保留
        if ($span->getStatus()->getCode() === StatusCode::ERROR) {
            $this->keep($span);
            return;
        }

        // 规则 2：慢请求（>2s）100% 保留
        $duration = $span->getEndEpochNanos() - $span->getStartEpochNanos();
        if ($duration > 2_000_000_000) { // 2 秒 = 2 billion nanoseconds
            $this->keep($span);
            return;
        }

        // 规则 3：特定租户的请求保留
        $tenantId = $baggage->getEntry('tenant_id');
        if ($tenantId && $tenantId->getValue() === 'B2B') {
            $this->keep($span);
            return;
        }

        // 规则 4：默认丢弃
        $this->drop($span);
    }
}
```

### 4.4 Grafana Tempo 中基于 Baggage 的查询

将 Baggage 映射到 Span Attributes 后，可以在 Grafana Tempo 中按业务维度查询：

```promql
# 查询所有 B2B 租户的慢请求
{service.name="order-service"} | baggage.tenant_id="B2B" | duration > 2s

# 查询金卡用户的错误请求
{service.name="payment-service"} | baggage.user_tier="gold" | status=error

# 查询移动端来源的请求链路
{baggage.request_source="mobile"} | select(traceID)
```

---

## 五、性能影响与大小限制

### 5.1 Baggage 大小限制

W3C Baggage 规范建议的总大小限制为 **8192 字节**（8KB）。超过此限制的 Baggage 可能被中间代理截断或丢弃。

```php
// 检查 Baggage 大小
class BaggageSizeValidator
{
    private const MAX_SIZE = 8192;

    public static function validate(Baggage $baggage): bool
    {
        $serialized = self::serialize($baggage);
        $size = strlen($serialized);

        if ($size > self::MAX_SIZE) {
            Log::warning('Baggage exceeds size limit', [
                'size'  => $size,
                'limit' => self::MAX_SIZE,
                'keys'  => self::getKeys($baggage),
            ]);
            return false;
        }

        return true;
    }

    private static function serialize(Baggage $baggage): string
    {
        $pairs = [];
        foreach ($baggage->getAll() as $entry) {
            $pairs[] = $entry->getKey() . '=' . urlencode($entry->getValue());
        }
        return implode(',', $pairs);
    }
}
```

### 5.2 性能基准测试

在 Laravel 中使用 Baggage 的性能开销：

| 操作 | 耗时 | 说明 |
|------|------|------|
| 创建 Baggage | ~0.01ms | 几乎无开销 |
| 序列化（5 个键值对） | ~0.02ms | 可忽略 |
| HTTP Header 传播 | ~0.05ms | 网络开销远大于此 |
| Span Processor 桥接 | ~0.03ms | 每个 Span 一次 |
| 反序列化 | ~0.02ms | 可忽略 |

**总开销：约 0.1ms/请求**，在绝大多数场景下可以忽略。

### 5.3 最佳实践

```php
// ✅ 正确：只传播必要的业务标签
$baggage->set('tenant_id', $tenantId);
$baggage->set('user_tier', $userTier);

// ❌ 错误：传播过多数据
$baggage->set('user_name', $user->name);
$baggage->set('user_email', $user->email);
$baggage->set('user_avatar', $user->avatar_url);  // URL 可能很长
$baggage->set('cart_items', json_encode($cart));    // 可能超过 8KB

// ✅ 正确：使用简短的枚举值
$baggage->set('user_tier', 'gold');    // 简短

// ❌ 错误：使用冗长的描述
$baggage->set('user_tier', 'Gold VIP Member Since 2023');  // 不必要
```

---

## 六、Laravel 完整集成方案

### 6.1 安装依赖

```bash
# 核心 SDK
composer require open-telemetry/sdk

# HTTP 自动注入
composer require open-telemetry/opentelemetry-auto-laravel

# 导出器（以 OTLP/gRPC 为例）
composer require open-telemetry/exporter-otlp

# 或使用 Jaeger
composer require open-telemetry/exporter-jaeger
```

### 6.2 配置文件

```php
<?php
// config/opentelemetry.php

return [
    // 服务标识
    'service_name' => env('OTEL_SERVICE_NAME', 'laravel-app'),
    'service_version' => env('OTEL_SERVICE_VERSION', '1.0.0'),

    // 导出器配置
    'exporter' => [
        'type' => env('OTEL_EXPORTER_TYPE', 'otlp'), // otlp, jaeger, zipkin
        'endpoint' => env('OTEL_EXPORTER_ENDPOINT', 'http://localhost:4317'),
    ],

    // 采样配置
    'sampler' => [
        'type' => env('OTEL_SAMPLER_TYPE', 'parentbased_traceidratio'),
        'ratio' => env('OTEL_SAMPLER_RATIO', 0.1),
    ],

    // Baggage 配置
    'baggage' => [
        // 需要传播到 Span Attributes 的 Baggage keys
        'to_span_attributes' => [
            'tenant_id',
            'user_tier',
            'request_source',
            'region',
            'experiment_group',
        ],

        // 最大 Baggage 大小
        'max_size' => 8192,
    ],

    // 基于 Baggage 的采样规则
    'baggage_sampling_rules' => [
        // 金卡用户 100% 采样
        ['attribute' => 'user_tier', 'values' => ['gold', 'platinum'], 'rate' => 1.0],
        // B2B 租户 50% 采样
        ['attribute' => 'tenant_id', 'values' => ['B2B'], 'rate' => 0.5],
        // A/B 实验组 100% 采样
        ['attribute' => 'experiment_group', 'values' => ['*'], 'rate' => 1.0],
    ],
];
```

### 6.3 完整的 Bootstrap 代码

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Baggage\Propagation\BaggagePropagator;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Contrib\Otlp\OtlpHttpExporterFactory;
use OpenTelemetry\SDK\Trace\Sampler\ParentBased;
use OpenTelemetry\SDK\Trace\Sampler\TraceIdRatioBasedSampler;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SemConv\ResourceAttributes;

class OpenTelemetryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TracerProvider::class, function () {
            $serviceName = config('opentelemetry.service_name');

            // Resource
            $resource = ResourceInfoFactory::merge(
                ResourceInfoFactory::defaultResource(),
                ResourceInfoFactory::create([
                    ResourceAttributes::SERVICE_NAME => $serviceName,
                    ResourceAttributes::SERVICE_VERSION => config('opentelemetry.service_version'),
                ])
            );

            // Exporter
            $exporterFactory = new OtlpHttpExporterFactory();
            $exporter = $exporterFactory->create();

            // Sampler
            $sampler = new ParentBased(
                new TraceIdRatioBasedSampler(
                    (float) config('opentelemetry.sampler.ratio', 0.1)
                )
            );

            // Span Processor with Baggage bridge
            $spanProcessor = new BatchSpanProcessor($exporter);

            // Tracer Provider
            return new TracerProvider(
                spanProcessor: $spanProcessor,
                sampler: $sampler,
                resource: $resource,
            );
        });
    }

    public function boot(): void
    {
        // 设置全局 Propagator（包含 TraceContext + Baggage）
        Globals::setPropagator(
            TextMapPropagator::composite(
                TraceContextPropagator::getInstance(),
                BaggagePropagator::getInstance(),
            )
        );

        // 注册 Baggage → Span Attributes 桥接处理器
        $tracerProvider = $this->app->make(TracerProvider::class);
        $tracerProvider->addSpanProcessor(
            new \App\OpenTelemetry\BaggageSpanProcessor()
        );

        // 设置全局 Tracer Provider
        Globals::setTracerProvider($tracerProvider);
    }
}
```

---

## 七、真实踩坑记录

### 踩坑 1：Baggage Header 被 Nginx 截断

**现象：** Baggage 在服务 A → Nginx → 服务 B 的链路中丢失。

**原因：** Nginx 默认的 `proxy_pass_header` 配置不会透传 `baggage` Header，需要显式配置。

**解决方案：**

```nginx
# nginx.conf
location /api/ {
    proxy_pass http://upstream;

    # 显式透传 Baggage 和 Trace Context
    proxy_set_header baggage $http_baggage;
    proxy_set_header traceparent $http_traceparent;
    proxy_set_header tracestate $http_tracestate;
}
```

### 踩坑 2：Baggage 中的特殊字符导致解析失败

**现象：** 当 Baggage 值包含中文或特殊字符时，下游服务解析失败。

**原因：** W3C Baggage 规范要求非 ASCII 字符必须进行 URL 编码。

**解决方案：**

```php
// 注入时编码
$builder->set('user_name', urlencode($user->name));

// 提取时解码
$entry = $baggage->getEntry('user_name');
$name = urldecode($entry->getValue());

// 或使用 Propagator 的自动编解码
// W3CBaggagePropagator 默认会处理 URL 编码
```

### 踩坑 3：Baggage 传播到非 OpenTelemetry 服务

**现象：** 部分服务（如第三方 API、旧版服务）不支持 OpenTelemetry，Baggage 丢失。

**解决方案：**

```php
// 方案 A：手动传递关键 Baggage 到不支持 OTel 的服务
class ManualBaggagePropagation
{
    public function callLegacyService(array $baggage): Response
    {
        // 将关键 Baggage 作为自定义 Header 传递
        $headers = [
            'X-Tenant-ID' => $baggage['tenant_id'] ?? null,
            'X-User-Tier' => $baggage['user_tier'] ?? null,
        ];

        return Http::withHeaders(array_filter($headers))
            ->get('http://legacy-service/api/data');
    }
}

// 方案 B：在边界服务中提取 Baggage 并记录到日志
class BaggageToLogMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        $baggage = Baggage::getCurrent();

        // 将 Baggage 值添加到日志上下文
        foreach ($baggage->getAll() as $entry) {
            Log::withContext([
                "baggage.{$entry->getKey()}" => $entry->getValue()
            ]);
        }

        return $next($request);
    }
}
```

### 踩坑 4：Baggage 值大小导致 Header 超限

**现象：** 某些代理（如 AWS ALB）对单个 Header 有大小限制，导致请求被拒绝。

**解决方案：**

```php
class BaggageSizeLimiter
{
    private const MAX_HEADER_SIZE = 4096; // 保守限制

    public static function enforce(Baggage $baggage): Baggage
    {
        $builder = Baggage::getEmpty()->toBuilder();
        $currentSize = 0;

        // 按优先级排序，保证重要标签优先
        $priority = ['tenant_id', 'user_tier', 'request_source'];
        $entries = iterator_to_array($baggage->getAll());

        usort($entries, function ($a, $b) use ($priority) {
            $aIndex = array_search($a->getKey(), $priority);
            $bIndex = array_search($b->getKey(), $priority);
            return ($aIndex === false ? 999 : $aIndex) <=> ($bIndex === false ? 999 : $bIndex);
        });

        foreach ($entries as $entry) {
            $entrySize = strlen($entry->getKey()) + strlen($entry->getValue()) + 2; // key=value,

            if ($currentSize + $entrySize > self::MAX_HEADER_SIZE) {
                Log::warning('Baggage entry dropped due to size limit', [
                    'key' => $entry->getKey(),
                ]);
                continue;
            }

            $builder->set($entry->getKey(), $entry->getValue());
            $currentSize += $entrySize;
        }

        return $builder->build();
    }
}
```

### 踩坑 5：异步队列任务中 Baggage 丢失

**现象：** HTTP 请求中的 Baggage 在 Laravel 队列任务中不可用。

**原因：** 队列任务在新的进程中执行，Context 不会自动传播。

**解决方案：**

```php
// 方案 A：在 Job 中携带 Baggage
class ProcessOrderJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public Order $order,
        public array $baggage = [] // 携带 Baggage
    ) {}

    public function handle(): void
    {
        // 从 Job 参数恢复 Baggage
        $builder = Baggage::getEmpty()->toBuilder();
        foreach ($this->baggage as $key => $value) {
            $builder->set($key, $value);
        }
        $baggage = $builder->build();

        $scope = $baggage->activate();
        try {
            // 处理业务逻辑
            $this->processOrder();
        } finally {
            $scope->detach();
        }
    }
}

// 调用时传入 Baggage
$baggage = Baggage::getCurrent();
$baggageData = [];
foreach ($baggage->getAll() as $entry) {
    $baggageData[$entry->getKey()] = $entry->getValue();
}

ProcessOrderJob::dispatch($order, $baggageData);
```

```php
// 方案 B：使用队列中间件自动传播
class BaggageQueueMiddleware
{
    public function handle(object $job, Closure $next): void
    {
        if (isset($job->baggage) && is_array($job->baggage)) {
            $builder = Baggage::getEmpty()->toBuilder();
            foreach ($job->baggage as $key => $value) {
                $builder->set($key, $value);
            }
            $scope = $builder->build()->activate();

            try {
                $next($job);
            } finally {
                $scope->detach();
            }
        } else {
            $next($job);
        }
    }
}
```

### 踩坑 6：Baggage 在多租户环境中的安全问题

**现象：** 租户 A 的请求意外携带了租户 B 的 Baggage 标签。

**原因：** 全局 Baggage 在请求结束后未正确清理，导致后续请求继承了前一个请求的 Baggage。

**解决方案：**

```php
// 始终使用 Scope 管理 Baggage 生命周期
class BaggageLifecycleMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        // 创建干净的 Baggage
        $baggage = BaggageFactory::fromRequest($request);
        $scope = $baggage->activate();

        try {
            $response = $next($request);
        } finally {
            // 关键：在请求结束时清理 Baggage
            $scope->detach();
        }

        return $response;
    }
}
```

### 踩坑 7：Baggage Propagator 与 TraceContext Propagator 冲突

**现象：** 配置了多个 Propagator 后，traceparent Header 被覆盖。

**解决方案：**

```php
// 使用 composite propagator 而不是分别设置
Globals::setPropagator(
    TextMapPropagator::composite(
        TraceContextPropagator::getInstance(),
        BaggagePropagator::getInstance(),
        // 其他 Propagator...
    )
);
```

### 踩坑 8：Grafana 查询性能问题

**现象：** 在 Grafana Tempo 中按 Baggage 属性查询非常慢。

**原因：** 没有为 Baggage 属性创建索引。

**解决方案：**

```yaml
# Tempo 配置：为常见的 Baggage 属性创建索引
overrides:
  defaults:
    metrics_generator:
      processor:
        service_graphs:
          dimensions:
            - baggage.tenant_id
            - baggage.user_tier
        span_metrics:
          dimensions:
            - baggage.tenant_id
            - baggage.user_tier
```

---

## 八、监控与告警

### 8.1 Baggage 健康监控

```php
class BaggageHealthCheck
{
    public function check(): array
    {
        return [
            'baggage_size_avg'      => $this->getAverageSize(),
            'baggage_size_p99'      => $this->getP99Size(),
            'propagation_failures'  => $this->getPropagationFailures(),
            'oversized_baggage'     => $this->getOversizedCount(),
            'missing_critical_keys' => $this->getMissingCriticalKeys(),
        ];
    }
}
```

### 8.2 告警规则

```yaml
groups:
  - name: baggage_alerts
    rules:
      - alert: BaggagePropagationFailure
        expr: rate(baggage_propagation_failures_total[5m]) > 0.01
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Baggage 传播失败率超过 1%"

      - alert: BaggageOversized
        expr: rate(baggage_oversized_total[5m]) > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "检测到超大 Baggage，可能导致请求被代理拒绝"
```

---

## 九、总结

OpenTelemetry Baggage 是微服务架构中实现业务上下文透传的强大工具。通过合理使用 Baggage，我们可以：

1. **跨服务传播业务标签**：租户、用户等级、请求来源等
2. **智能采样**：基于业务维度的采样策略，降低存储成本同时保留关键数据
3. **精细化监控**：按业务维度聚合和分析追踪数据
4. **简化调试**：快速定位特定用户/租户的请求链路

在使用 Baggage 时，需要注意：
- 控制大小（8KB 限制）
- 处理 URL 编码
- 在队列任务中手动传播
- 正确管理生命周期（Scope 的 activate/detach）
- 注意安全边界（跨租户隔离）

Baggage 不是万能的，它适用于少量关键业务标签的传播。对于大量数据，应该使用其他机制（如数据库、缓存、事件总线）。合理设计 Baggage 的 key 和 value，是发挥其价值的关键。

## 相关阅读

- [链路追踪实战：Jaeger/SkyWalking 在 Laravel 微服务中的应用](/categories/架构/distributed-tracing-jaeger-skywalking/) —— 分布式追踪的基础实践
- [Prometheus + Grafana 实战：Laravel 应用监控——指标采集、告警与可视化踩坑记录](/categories/架构/prometheus-grafana-guide-laravel-monitoring/) —— 可观测性的指标维度
- [ELK Stack 实战：Elasticsearch + Logstash + Kibana 集中式日志系统与 Laravel 集成踩坑记录](/categories/架构/elk-stack-guide-elasticsearch-logstash-kibana-logging-laravel/) —— 可观测性的日志维度
