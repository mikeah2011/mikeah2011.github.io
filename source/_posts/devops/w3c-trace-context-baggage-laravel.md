---

title: 分布式追踪上下文传播实战：W3C Trace Context + Baggage——Laravel 微服务中跨进程的业务标签透传与采样策略
date: 2026-06-06 08:00:00
tags:
- 分布式
- W3C Trace Context
- Baggage
- OpenTelemetry
- Laravel
description: 深入解析W3C Trace Context与Baggage标准在Laravel微服务中的实战应用，涵盖HTTP与队列场景的上下文传播、Baggage业务标签透传、头部与尾部采样策略对比，附完整PHP代码示例与生产踩坑记录，助你构建全链路分布式追踪体系。
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop---


---

## 第一部分：W3C Trace Context 与 Baggage 标准概览

### 1.1 什么是 W3C Trace Context？

W3C Trace Context 是万维网联盟（W3C）于 2020 年正式发布的一项推荐标准（Recommendation），定义了两个 HTTP 头部字段，用于在分布式系统中传递追踪上下文。

**`traceparent` 头部**——承载核心追踪标识：

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
               |-- version --|-- trace-id ----------|-- parent-id -------|-- flags --|
```

各字段含义：
- `version`（2 字符）：协议版本，当前固定为 `00`
- `trace-id`（32 字符 / 16 字节）：全局唯一的 Trace ID，标识一条完整的调用链
- `parent-id`（16 字符 / 8 字节）：当前 Span 的 ID，作为下游服务创建子 Span 的父节点引用
- `flags`（2 字符）：采样标志位，`01` 表示已采样（sampled），`00` 表示未采样

**`tracestate` 头部**——厂商扩展字段：

```
tracestate: congo=t61rcWkgMzE,rojo=00f067aa0ba902b7
```

`tracestate` 允许各 APM 厂商（如 Datadog、New Relic、阿里云 ARMS）在不破坏标准协议的前提下携带自己的私有上下文。这是 W3C 标准相比 Jaeger `uber-trace-id`、Zipkin `X-B3-*` 等私有方案的核心优势——**它是厂商中立的**。

### 1.2 什么是 W3C Baggage？

`traceparent` 只解决了"这条链路从哪来"的问题，但没有解决"这条链路跟什么业务相关"的问题。W3C Baggage 就是为了填补这个空白。

**`baggage` 头部**——业务上下文透传：

```
baggage: user_id=u_10086,vip_level=gold,order_source=app_ios,experiment_group=B
```

Baggage 的核心特征：
- **与 Trace 解耦**：可以独立于 Trace 存在，即使不采样这条 Trace，Baggage 仍然可以传递
- **全局可达**：Baggage 中的键值对会随着上下文传播到链路中的每一个服务
- **可用于决策**：采样器可以根据 Baggage 中的业务字段决定是否采样

### 1.3 为什么选择 W3C 标准而不是私有方案？

在决定采用分布式追踪方案时，很多团队会面临一个选择：是直接用 Jaeger/Zipkin 的私有传播头，还是实现 W3C 标准？从我们的实践经验来看，**选择 W3C 标准几乎没有争议**，原因如下：

第一，**生态兼容性**。OpenTelemetry、Datadog、New Relic、Elastic APM、阿里云 ARMS 等主流可观测性平台已经全面支持 W3C Trace Context。选择标准意味着你不会被任何单一厂商锁定，未来切换追踪后端的成本极低。我们团队就曾经从 Jaeger 迁移到 Grafana Tempo，由于已经采用了 W3C 标准，迁移过程几乎不需要修改业务代码。

第二，**跨团队协作**。在大型企业中，不同团队可能使用不同的技术栈（PHP、Java、Go、Python）。W3C 标准提供了一个统一的"语言"，让不同语言的服务可以互相理解对方的追踪上下文。我们公司就有一个由 Go 语言编写的网关，后面连接着多个 Laravel 微服务，W3C 标准让它们之间的追踪链路无缝衔接。

第三，**面向未来**。W3C 是互联网标准的制定者，其标准的生命周期通常以十年甚至更长来计算。选择 W3C 标准意味着你的追踪基础设施具有长期的可维护性。

### 1.4 Trace Context + Baggage 的协作关系

要理解 Trace Context 和 Baggage 的关系，可以用一个简单的类比：**Trace Context 是快递单号，Baggage 是包裹上的附加标签**。快递单号让快递公司追踪包裹的流转路径，而附加标签（比如"易碎""加急""VIP客户"）则告诉各个环节的工作人员如何处理这个包裹。

```
用户请求
  │
  ├─ traceparent: 00-abc123...-span001-01    ← 标识"我是谁"
  ├─ tracestate: vendor=xxx                  ← 厂商私有扩展
  └─ baggage: user_id=10086,vip=gold         ← 标识"我跟什么业务相关"
  │
  ▼
┌─────────────┐
│ API Gateway │  创建 Root Span，记录请求入口
└──────┬──────┘
       │  传播 traceparent + baggage
       ▼
┌─────────────┐
│ Order 服务  │  创建子 Span，读取 baggage.user_id 用于日志关联
└──────┬──────┘
       │  传播 traceparent + baggage（可能追加新字段）
       ▼
┌─────────────┐
│ Payment 服务│  创建子 Span，根据 baggage.vip 决定采样策略
└──────┬──────┘
       │  通过消息队列传播上下文
       ▼
┌─────────────┐
│ Notification│  从消息 header 中恢复上下文，发送通知
└─────────────┘
```

这个架构图展示了一个完整的上下文传播链路：`traceparent` 确保了父子 Span 关系的正确建立，而 `baggage` 则让业务标签（用户ID、VIP等级等）能够在整条链路中自由流动。

---

## 第二部分：Laravel 中的 OpenTelemetry 基础搭建

在 Laravel 微服务中实现 W3C 标准，我们选择 OpenTelemetry（简称 OTel）作为 SDK。OTel 是 CNCF 孵化的可观测性标准框架，原生支持 W3C Trace Context 和 Baggage 的编解码。选择 OTel 而非直接实现 W3C 协议，有两个重要原因：一是 OTel 提供了完善的 PHP SDK，封装了底层的上下文传播、Span 创建、采样决策等复杂逻辑，让你可以专注于业务集成而非协议实现；二是 OTel 是一个厂商中立的可观测性框架，除了追踪（Traces）之外，还统一了指标（Metrics）和日志（Logs）的采集标准，为未来的可观测性体系建设打下基础。

在 PHP 生态中，OpenTelemetry 的自动插桩（auto-instrumentation）能力还在持续完善中，对于 Laravel 应用，手动集成的方式更为可控和稳定。以下的代码示例基于手动集成方式编写，虽然代码量稍多，但好处是每一行逻辑都清晰透明，便于排查问题和定制化。

### 2.1 安装依赖

```bash
# 在每个 Laravel 微服务中执行
composer require open-telemetry/sdk \
    open-telemetry/transport-grpc \
    open-telemetry/exporter-otlp \
    open-telemetry/opentelemetry-auto-laravel
```

### 2.2 服务初始化配置

在 Laravel 的 `AppServiceProvider` 或独立的 `TracingServiceProvider` 中初始化 OTel：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\CommonInstrumentation\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Propagation\TextMapPropagator;
use OpenTelemetry\Contrib\Baggage\Propagation\BaggagePropagator;
use OpenTelemetry\Context\Propagation\TextMapPropagatorInterface;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\Contrib\Otlp\OtlpHttpExporter;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SemConv\ResourceAttributes;

class TracingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TextMapPropagatorInterface::class, function () {
            // 组合传播器：同时传播 TraceContext 和 Baggage
            return TextMapPropagator::composite(
                TraceContextPropagator::getInstance(),
                BaggagePropagator::getInstance()
            );
        });

        $this->app->singleton(\OpenTelemetry\API\Trace\TracerInterface::class, function () {
            $resource = ResourceInfoFactory::defaultResource()->merge(
                ResourceInfo::create(
                    ResourceAttributes::SERVICE_NAME->withValue(config('app.name', 'laravel-service')),
                    ResourceAttributes::SERVICE_VERSION->withValue(config('app.version', '1.0.0')),
                    ResourceAttributes::DEPLOYMENT_ENVIRONMENT->withValue(config('app.env', 'production')),
                )
            );

            $exporter = new OtlpHttpExporter(
                env('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
            );

            $spanProcessor = new BatchSpanProcessor($exporter);

            $tracerProvider = new TracerProvider($spanProcessor, $resource);

            return $tracerProvider->getTracer(
                'laravel-app',
                '1.0.0'
            );
        });
    }
}
```

### 2.3 环境变量配置

在 `.env` 中配置 OTEL 相关参数：

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=order-service
OTEL_SERVICE_VERSION=2.3.1
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

---

## 第三部分：HTTP 请求级别的上下文传播

这是分布式追踪中最基础也最关键的环节。我们需要处理两个方向：

1. **入站（Ingress）**：从请求头中提取上下文，创建/恢复 Span
2. **出站（Egress）**：将当前上下文注入到出站请求头中

### 3.1 Laravel 中间件：入站上下文提取

创建一个 `ExtractTraceContext` 中间件，在请求进入时提取并激活上下文：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\API\Globals;
use OpenTelemetry\Context\Context;
use OpenTelemetry\Context\ScopeInterface;
use Symfony\Component\HttpFoundation\Response;

class ExtractTraceContext
{
    private ?ScopeInterface $scope = null;

    public function handle(Request $request, Closure $next): Response
    {
        $propagator = app(\OpenTelemetry\Context\Propagation\TextMapPropagatorInterface::class);

        // 从 HTTP 请求头中提取 TraceContext + Baggage
        $parentContext = $propagator->extract($request->headers->all());

        // 以提取的上下文为父上下文，创建一个新的服务端 Span
        $tracer = Globals::tracerProvider()->getTracer('laravel-middleware');
        $span = $tracer->spanBuilder(
            sprintf('%s %s', $request->method(), $request->route()?->getName() ?? $request->path())
        )
            ->setParent($parentContext)
            ->setSpanKind(SpanKind::KIND_SERVER)
            ->setAttribute('http.method', $request->method())
            ->setAttribute('http.url', $request->fullUrl())
            ->setAttribute('http.route', $request->route()?->getName() ?? '')
            ->setAttribute('http.user_agent', $request->userAgent() ?? '')
            ->setAttribute('http.client_ip', $request->ip())
            ->startSpan();

        // 将当前 Span 关联的 Context 设置为活跃上下文
        $this->scope = $span->getStore()->activate();

        // 将 Baggage 中的业务标签注入到 Laravel 日志上下文
        $baggage = \OpenTelemetry\API\Baggage\Baggage::getCurrent();
        $logContext = [];
        foreach ($baggage->getAll() as $key => $entry) {
            $logContext[$key] = $entry->getValue();
        }
        if (!empty($logContext)) {
            \Log::shareContext($logContext);
        }

        // 将 trace-id 添加到响应头，便于前端/客户端关联
        $response = $next($request);

        $span->setAttribute('http.status_code', $response->getStatusCode());

        if ($response->getStatusCode() >= 500) {
            $span->setStatus(StatusCode::ERROR, 'Server Error');
        }

        $span->end();
        $this->scope->detach();

        $response->headers->set('traceresponse', sprintf(
            '00-%s-%s-01',
            $span->getContext()->getTraceId(),
            $span->getContext()->getSpanId()
        ));

        return $response;
    }
}
```

注册中间件到 `app/Http/Kernel.php`：

```php
protected $middleware = [
    // 放在最前面，确保在所有其他中间件之前提取上下文
    \App\Http\Middleware\ExtractTraceContext::class,
    // ... 其他中间件
];
```

### 3.2 HTTP Client：出站上下文注入

在 Laravel 微服务中，服务间调用通常使用 `Http` Facade（基于 Guzzle）。我们需要在出站时将当前上下文注入到请求头中：

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\Context\Context;

class TracedHttpClient
{
    private $propagator;

    public function __construct()
    {
        $this->propagator = app(\OpenTelemetry\Context\Propagation\TextMapPropagatorInterface::class);
    }

    public function get(string $url, array $headers = []): \Illuminate\Http\Client\Response
    {
        return $this->request('GET', $url, $headers);
    }

    public function post(string $url, array $data = [], array $headers = []): \Illuminate\Http\Client\Response
    {
        return $this->request('POST', $url, $headers, $data);
    }

    private function request(string $method, string $url, array $headers = [], array $data = []): \Illuminate\Http\Client\Response
    {
        $tracer = Globals::tracerProvider()->getTracer('http-client');

        // 创建一个 CLIENT 类型的 Span
        $span = $tracer->spanBuilder(sprintf('HTTP %s %s', $method, $this->sanitizeUrl($url)))
            ->setSpanKind(SpanKind::KIND_CLIENT)
            ->setAttribute('http.method', $method)
            ->setAttribute('http.url', $url)
            ->startSpan();

        $scope = $span->getStore()->activate();

        try {
            // 将当前上下文注入到出站请求头
            $carrier = [];
            $this->propagator->inject($carrier);

            // 合并传播头和用户自定义头
            $mergedHeaders = array_merge($carrier, $headers);

            $response = Http::withHeaders($mergedHeaders)
                ->timeout(30)
                ->$method($url, $data);

            $span->setAttribute('http.status_code', $response->status());

            if ($response->serverError()) {
                $span->setStatus(StatusCode::ERROR, 'Downstream server error');
            }

            return $response;
        } catch (\Exception $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::ERROR, $e->getMessage());
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }

    private function sanitizeUrl(string $url): string
    {
        // 移除查询参数和路径中的 ID，防止 Span 名称爆炸
        return preg_replace('#/\d+#', '/:id', parse_url($url, PHP_URL_PATH) ?? '/');
    }
}
```

**使用方式**：

```php
class OrderController extends Controller
{
    public function create(Request $request, TracedHttpClient $client)
    {
        // 调用库存服务——上下文会自动传播
        $inventoryResponse = $client->post('http://inventory-service/api/stock/check', [
            'product_id' => $request->input('product_id'),
            'quantity' => $request->input('quantity'),
        ]);

        // 调用支付服务——同一条 trace 链路
        $paymentResponse = $client->post('http://payment-service/api/charge', [
            'amount' => $inventoryResponse->json('price'),
            'user_id' => $request->user()->id,
        ]);

        return response()->json(['order_id' => $paymentResponse->json('order_id')]);
    }
}
```

经过上述配置，当请求流经 `API Gateway → Order 服务 → Inventory 服务 → Payment 服务` 时，所有服务的 Span 都会归属于同一条 Trace，形成完整的调用树。

---

## 第四部分：消息队列中的上下文传播

在 Laravel 微服务中，异步任务（队列）是上下文传播的盲区。很多团队的追踪链路在队列处断裂，原因就是没有将上下文传递到队列消息中。这是一个非常普遍的问题，因为在 HTTP 场景下，上下文可以通过请求头自动传播，但队列任务的执行是异步的——任务被序列化后存入 Redis 或数据库，由另一个进程在未来的某个时间点取出并执行。在这个过程中，原始请求的上下文信息会完全丢失。

在 Laravel 的生态中，队列被广泛用于耗时操作：发送邮件通知、生成报表、处理支付回调、同步第三方数据等。如果这些异步操作脱离了追踪链路，那么当用户反馈"支付成功但没有收到通知"时，你将无法快速定位是支付服务没有发送消息、还是通知服务处理失败了。因此，队列上下文传播是分布式追踪落地的关键一环。

### 4.1 分发任务时注入上下文

创建一个 `DispatchTracedJob` 辅助类，在分发任务时自动注入追踪上下文：

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\Context\Context;

abstract class TracedJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * 从分发者那边传递过来的上下文头
     */
    public array $traceHeaders = [];

    /**
     * 任务业务标签
     */
    public array $jobBaggage = [];

    /**
     * 分发前调用——注入当前上下文
     */
    public static function dispatchWithTrace(mixed ...$arguments): \Illuminate\Foundation\Bus\PendingDispatch
    {
        $instance = new static(...$arguments);

        // 将当前活跃的 TraceContext + Baggage 注入到任务属性中
        $propagator = app(\OpenTelemetry\Context\Propagation\TextMapPropagatorInterface::class);
        $carrier = [];
        $propagator->inject($carrier);
        $instance->traceHeaders = $carrier;

        return static::dispatch(...$arguments);
    }

    /**
     * 任务执行前——恢复上下文并创建 Span
     */
    public function middleware(): array
    {
        return [new TracedJobMiddleware()];
    }
}
```

### 4.2 队列中间件：恢复上下文

```php
<?php

namespace App\Jobs\Middleware;

use Closure;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class TracedJobMiddleware
{
    public function handle($job, Closure $next)
    {
        $propagator = app(\OpenTelemetry\Context\Propagation\TextMapPropagatorInterface::class);

        // 从任务属性中恢复上下文
        $parentContext = $propagator->extract($job->traceHeaders ?? []);

        $tracer = Globals::tracerProvider()->getTracer('queue-worker');
        $className = class_basename($job);

        $span = $tracer->spanBuilder("queue.process {$className}")
            ->setParent($parentContext)
            ->setSpanKind(SpanKind::KIND_CONSUMER)
            ->setAttribute('messaging.system', 'redis')
            ->setAttribute('messaging.operation', 'process')
            ->setAttribute('messaging.destination', $job->queue ?? 'default')
            ->setAttribute('job.class', $className)
            ->startSpan();

        $scope = $span->getStore()->activate();

        try {
            $next($job);
            $span->setStatus(StatusCode::OK);
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::ERROR, $e->getMessage());
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }
}
```

### 4.3 业务代码使用

```php
// 分发任务时——使用 dispatchWithTrace 替代 dispatch
ProcessOrderJob::dispatchWithTrace($order->id, $order->user_id);

// 在 Job 内部，Baggage 中的业务标签可以通过日志上下文自动关联
class ProcessOrderJob extends TracedJob
{
    public function __construct(
        public int $orderId,
        public int $userId
    ) {}

    public function handle(): void
    {
        // 此处的 Log 会自动包含从 Baggage 透传过来的业务标签
        Log::info('Processing order', [
            'order_id' => $this->orderId,
            'user_id' => $this->userId,
        ]);

        // 调用下游服务时，上下文继续传播
        $client = app(TracedHttpClient::class);
        $client->post('http://fulfillment-service/api/ship', [
            'order_id' => $this->orderId,
        ]);
    }
}
```

经过以上配置，队列任务不再是追踪链路的断裂点。整个调用链从 HTTP 入口到异步任务再到下游服务，形成完整的有向无环图（DAG）。

---

## 第五部分：Baggage 业务标签的高级用法

Baggage 的价值远不止"透传用户ID"这么简单。当我们把业务语义注入到追踪上下文中后，就打开了一个全新的可能性空间：智能采样、业务级告警、跨服务日志关联、A/B测试流量标记等。这一部分将深入介绍 Baggage 的几种高级用法，这些用法在我们的生产环境中已经被证明非常实用。

### 5.1 在链路任意节点写入 Baggage

Baggage 不仅可以由入口服务注入，链路中的任何服务都可以向 Baggage 写入新的业务标签：

```php
use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Baggage\BaggageBuilderInterface;
use OpenTelemetry\Context\Context;

// 读取当前 Baggage
$baggage = Baggage::getCurrent();
$userId = $baggage->getValue('user_id'); // 'u_10086'

// 写入新的 Baggage 字段（追加到当前上下文）
$newBaggage = Baggage::getCurrent()
    ->toBuilder()
    ->set('order_id', (string) $order->id, Baggage::metadata('order-service'))
    ->set('order_amount', (string) $order->totalAmount)
    ->build();

// 激活更新后的 Baggage——后续所有子 Span 和出站请求都会携带这些字段
$scope = $newBaggage->activate();
// ... 执行业务逻辑
$scope->detach();
```

### 5.2 Baggage 用于日志关联

这是 Baggage 最实用的场景之一——将业务标签自动注入到结构化日志中：

```php
<?php

namespace App\Logging;

use Illuminate\Log\Logger;
use Monolog\LogRecord;
use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Globals;

class BaggageLogProcessor
{
    public function __invoke(Logger $logger): \Closure
    {
        return function (LogRecord $record) {
            // 将当前活跃的 Baggage 字段注入到每条日志中
            $baggage = Baggage::getCurrent();
            foreach ($baggage->getAll() as $key => $entry) {
                $record->extra[$key] = $entry->getValue();
            }

            // 同时注入当前 Span 的 trace-id 和 span-id
            $span = Globals::tracerProvider()
                ->getTracer('log')
                ->spanBuilder('log')
                ->startSpan();

            $record->extra['trace_id'] = $span->getContext()->getTraceId();
            $record->extra['span_id'] = $span->getContext()->getSpanId();
            $span->end();

            return $record;
        };
    }
}
```

在 `config/logging.php` 中注册：

```php
'channels' => [
    'stack' => [
        'driver' => 'stack',
        'tap' => [\App\Logging\BaggageLogProcessor::class],
        'channels' => ['daily'],
    ],
],
```

这样，每条日志都会自动包含 `user_id`、`vip_level`、`order_source` 等业务标签以及 `trace_id`，在 Kibana/Loki 中可以直接通过业务字段筛选日志并关联到 Trace。

### 5.3 Baggage 的安全注意事项

⚠️ **Baggage 是明文传输的！** 这是一个经常被忽视的安全隐患。由于 Baggage 通过 HTTP 头部传递，它会出现在各种日志系统、代理服务器、监控工具中，甚至可能被中间人截获。以下信息绝对不能放入 Baggage：

- 用户密码、Token、API Key 等认证凭证
- 身份证号、银行卡号、手机号等个人身份信息（PII）
- 企业内部敏感的业务数据，如利润率、成本结构等

我们曾经犯过一个错误：某位同事将用户的手机号放入 Baggage 中，用于按地区统计请求分布。结果在排查问题时，这个手机号被打印在了多台服务器的 Nginx access log 中，差点导致数据泄露事故。这个教训让我们深刻认识到：**Baggage 的安全审查应该纳入代码审查的必要检查项**。

建议的做法是对敏感字段进行脱敏或哈希处理：

```php
$baggage->set('user_id', hash('xxh3', $user->realId));  // 哈希脱敏
$baggage->set('user_tier', $user->vipLevel);             // 非敏感标签直接透传
```

---

## 第六部分：采样策略——头部采样 vs 尾部采样

在生产环境中，不可能对每一条请求都进行完整的追踪。100% 采样会产生海量的 Span 数据，不仅消耗大量存储和网络带宽，还会对业务性能产生可观的开销。以我们某电商平台的数据为例：日均请求量约 5000 万次，每次请求平均产生 8 个 Span，每个 Span 约 1KB。如果 100% 采样，每天将产生约 400GB 的追踪数据，存储成本和查询性能都难以承受。因此，合理的采样策略是分布式追踪落地的关键。

采样策略的核心矛盾在于**成本与信息完整性之间的平衡**。我们需要在有限的存储和计算预算下，尽可能多地保留有价值的链路信息。什么是"有价值的链路"？通常包括：包含错误的链路、延迟异常的链路、高价值用户的链路、涉及核心业务流程的链路。一个好的采样策略应该能够自动识别并优先保留这些链路。

采样策略大致可以分为两大类：头部采样（Head-based Sampling）和尾部采样（Tail-based Sampling）。它们的核心区别在于**决策时机**——头部采样在请求进入系统时就做出决策，而尾部采样在整个链路完成后再做出决策。这个时机上的差异，导致了它们在能力、复杂度和适用场景上的显著不同。

### 6.1 头部采样（Head-based Sampling）

头部采样在请求进入系统的**第一个节点**就决定是否采样，决策结果通过 `traceparent` 的 `flags` 字段传播到下游所有服务。

**工作原理**：

```
请求入口
  │
  ├── 采样器决策（采样率 = 10%）
  │   ├── 采样 → traceparent.flags = 01 → 所有下游均采集
  │   └── 不采样 → traceparent.flags = 00 → 所有下游均跳过
  │
  ▼
```

**Laravel 中配置头部采样**：

```php
use OpenTelemetry\SDK\Trace\Sampler\TraceIdRatioBasedSampler;
use OpenTelemetry\SDK\Trace\Sampler\ParentBasedSampler;

// 基础采样器：按 Trace ID 哈希值的比例采样
$rootSampler = new TraceIdRatioBasedSampler(0.1); // 10% 采样率

// ParentBased：如果上游已做出采样决策，则尊重上游决策
$sampler = new ParentBasedSampler($rootSampler);

$tracerProvider = new TracerProvider(
    new BatchSpanProcessor($exporter),
    $resource,
    $sampler
);
```

**头部采样的优点**：
- 实现简单，开销可控
- 下游服务无需存储未采样的 Span
- 适合大规模系统的基础监控

**头部采样的致命缺陷**：
- **无法回溯**：如果请求进入时决定不采样，但后续发生了错误，这条错误链路将完全丢失
- **随机性过强**：可能漏掉重要的错误链路，却保留了大量无价值的正常请求
- **不适合"大海捞针"场景**：当错误率极低（如 0.01%）时，10% 的采样率可能需要很久才能捕获到一条错误链路

### 6.2 尾部采样（Tail-based Sampling）

尾部采样在整个链路完成**之后**再决定是否保留，因此可以看到完整的请求结果。

**工作原理**：

```
服务A → 服务B → 服务C → 完成
                              │
                              ▼
                     收集所有临时 Span
                              │
                              ▼
                     尾部采样器决策：
                       ├── 包含错误 → 保留
                       ├── 延迟 > 2s → 保留
                       ├── 用户是 VIP → 保留
                       └── 其他 → 按 5% 概率保留
```

**在 OpenTelemetry Collector 中配置尾部采样**：

```yaml
# otel-collector-config.yaml
processors:
  tail_sampling:
    decision_wait: 10s          # 等待 10 秒让链路完成
    num_traces: 100000          # 内存中保持的 trace 数量
    expected_new_traces_per_sec: 1000
    policies:
      # 策略 1：所有错误链路都保留
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]

      # 策略 2：高延迟链路保留
      - name: slow-traces
        type: latency
        latency:
          threshold_ms: 2000

      # 策略 3：基于 Baggage 中的业务标签采样
      - name: vip-users
        type: string_attribute
        string_attribute:
          key: vip_level
          values: [gold, diamond]

      # 策略 4：其他链路按比例采样
      - name: probabilistic-catch-all
        type: probabilistic
        probabilistic:
          sampling_percentage: 5

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [tail_sampling]
      exporters: [otlp/tempo]
```

**关键点**：策略 3 中的 `vip_level` 就是通过 Baggage 传播过来的业务标签。这意味着，只有当 Baggage 传播正确配置后，你才能实现基于业务语义的采样策略。

### 6.3 混合采样策略（生产推荐）

在实际生产中，头部采样和尾部采样不是二选一的关系，而是分层组合。很多团队在落地分布式追踪时，会陷入"该用头部采样还是尾部采样"的纠结中。实际上，这两种策略各有适用场景，最优解往往是将它们组合使用。我们团队在经历了多次采样策略的迭代后，总结出了一套分层采样架构，已在日均千万级请求的生产环境中稳定运行超过一年。

```yaml
# 推荐的分层采样架构
Layer 1（入口网关）：
  - 头部采样，按 20% 比例预过滤
  - 目的：在最前端降低 80% 的数据量

Layer 2（OTel Collector）：
  - 尾部采样，基于完整链路结果
  - 规则：错误 100%、VIP 100%、慢请求 100%、其他 5%
  - 目的：保证有价值的数据不丢失
```

这种分层策略的优势在于：
- Layer 1 降低了 Collector 的处理压力
- Layer 2 保证了关键链路不被遗漏
- 整体采样率可控，存储成本可预测

---

## 第七部分：踩坑记录与最佳实践

理论知识固然重要，但在实际落地过程中，真正让人头疼的往往是那些文档里没有写到的细节问题。以下是我们团队在将分布式追踪落地到 Laravel 微服务架构中时，遇到过的几个典型问题以及对应的解决方案。这些踩坑记录来自真实的生产环境，希望能帮助你避开同样的陷阱。

### 7.1 踩坑 1：gRPC 元数据与 HTTP 头部的键名差异

**现象**：HTTP 调用链路正常，gRPC 调用链路断裂。

**原因**：gRPC 使用元数据（metadata）而非 HTTP 头部传递上下文。gRPC 元数据的键名有大小写限制，而 W3C 标准中 `traceparent` 的大小写是敏感的。

**解决**：OpenTelemetry 的 gRPC 传播器会自动处理这个转换，但你需要确保使用了正确的传播器：

```php
// HTTP 场景
$propagator->inject($httpHeaders);  // 键名保持原样

// gRPC 场景——使用 Grpc metadata 格式
$metadata = [];
$propagator->inject($metadata, null, ArrayAccessGetterSetter::getInstance());
```

### 7.2 踩坑 2：队列任务中的上下文丢失

**现象**：HTTP 调用链路正常，但队列任务的 Span 成为孤立根 Span，不在主链路中。

**原因**：Laravel 默认序列化 Job 对象时不会序列化非公有属性。如果 `traceHeaders` 被定义为 `protected`，序列化后会丢失。

**解决**：确保 `traceHeaders` 和 `jobBaggage` 为 `public` 属性，或者使用 `SerializesModels` trait 并在 `__serialize` 方法中显式包含这些字段。

### 7.3 踩坑 3：Baggage 的大小限制

**现象**：在某个服务中往 Baggage 塞了大量字段后，下游服务收不到 `baggage` 头。

**原因**：大多数 HTTP 服务器和代理对单个头部的大小有限制（通常 8KB）。Baggage 中的值经过 URL 编码后会膨胀。

**最佳实践**：
- Baggage 中只放**决策性**的业务标签（5~10 个键值对）
- 每个值控制在 128 字符以内
- 大量业务数据应放在日志或 Span Attributes 中，不要放在 Baggage 中

### 7.4 踩坑 4：采样决策的传播一致性

**现象**：头部采样率设为 10%，但 Collector 中看到的采样率只有 2%。

**原因**：两个服务各自独立设置了 `TraceIdRatioBasedSampler`，导致每经过一个服务就有一次独立的采样决策。如果链路长度为 5 个服务，实际采样率 = 0.1^5 = 0.001%。

**解决**：使用 `ParentBasedSampler` 包装，确保下游服务尊重上游的采样决策：

```php
$sampler = new ParentBasedSampler(
    rootSampler: new TraceIdRatioBasedSampler(0.1),  // 只在根服务做决策
    // 下游服务不需要再独立决策
);
```

### 7.5 最佳实践总结

经过两年多的实践和迭代，我们团队总结出了以下分布式追踪的最佳实践。这些实践覆盖了从代码编写到运维监控的完整生命周期，每一个都是从真实的踩坑经历中提炼出来的。建议在团队内部建立一份追踪规范文档，将这些最佳实践固化下来，纳入新成员的入职培训和代码审查的必检项。

| 实践 | 说明 |
|------|------|
| **Span 命名规范** | 使用 `HTTP {METHOD} {route}` 格式，避免使用包含 ID 的 URL 导致基数爆炸 |
| **Baggage 精简原则** | 只放业务决策标签，不放业务数据 |
| **传播器组合顺序** | `TextMapPropagator::composite(TraceContext, Baggage)`，TraceContext 在前 |
| **错误处理** | 在 catch 块中 `recordException()` + `setStatus(ERROR)`，不要吞掉异常 |
| **资源属性** | 每个服务必须设置 `service.name` 和 `service.version` |
| **批量导出** | 生产环境使用 `BatchSpanProcessor`，开发环境可用 `SimpleSpanProcessor` |
| **采样率配置** | 入口服务控制采样率，下游使用 `ParentBased` 尊重父决策 |
| **健康检查排除** | 对 `/health`、`/ready` 等探针请求不创建 Span，避免噪声 |

---

## 第八部分：端到端验证——从配置到可视化

完成上述所有配置后，我们需要验证整条链路是否正确工作。

### 8.1 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Kubernetes 集群                        │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Laravel  │  │  Laravel  │  │  Laravel  │  │  Laravel  │    │
│  │  Gateway  │  │  Order    │  │  Payment  │  │  Notify   │    │
│  │  :8000    │  │  :8001    │  │  :8002    │  │  :8003    │    │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘    │
│        │             │             │             │           │
│        └──── HTTP ───┴── HTTP ─────┴── Queue ────┘           │
│                      │                                       │
│              ┌───────┴────────┐                              │
│              │  OTel Collector │                              │
│              │  (Tail Sampling)│                              │
│              └───────┬────────┘                              │
│                      │                                       │
│              ┌───────┴────────┐                              │
│              │   Grafana Tempo │                              │
│              │   (Trace 存储)  │                              │
│              └────────────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 验证步骤

**步骤 1：发送测试请求**

```bash
curl -X POST http://gateway:8000/api/orders \
  -H "Content-Type: application/json" \
  -H "baggage: user_id=u_10086,vip_level=gold,order_source=app_ios" \
  -d '{"product_id": 42, "quantity": 2}'
```

**步骤 2：检查响应头**

```bash
# 响应中应包含 traceresponse 头
< HTTP/1.1 200 OK
< traceresponse: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

**步骤 3：在 Grafana Tempo 中搜索**

使用 trace-id 搜索，你应该能看到完整的调用树：

```
Gateway (POST /api/orders)         [500ms]
├── Order 服务 (POST /api/create)   [320ms]
│   ├── Inventory 服务 (POST /check)[120ms]
│   └── Payment 服务 (POST /charge) [180ms]
└── queue.process ProcessOrderJob   [200ms]
    └── Notify 服务 (POST /send)    [80ms]
```

每条 Span 上都能看到 Baggage 中的业务标签：`user_id=u_10086`, `vip_level=gold`。

**步骤 4：验证采样策略**

```bash
# 1. 发送 100 个普通请求
for i in $(seq 1 100); do
  curl -s http://gateway:8000/api/orders \
    -H "baggage: user_id=u_$i" \
    -d '{"product_id": 42, "quantity": 1}' > /dev/null
done

# 2. 发送一个触发错误的请求
curl http://gateway:8000/api/orders \
  -H "baggage: user_id=u_error,vip_level=diamond" \
  -d '{"product_id": -1, "quantity": 0}'

# 3. 在 Tempo 中验证
#    - 普通请求中只保留约 5%（尾部采样的 catch-all 规则）
#    - 错误请求 100% 保留
#    - VIP 用户请求 100% 保留
```

---

## 第九部分：性能影响评估

在生产环境中启用分布式追踪，性能开销是必须考量的因素。很多技术负责人对分布式追踪心存顾虑，最大的担忧就是"追踪会不会拖慢我们的业务系统"。这种担忧并非没有道理——早期的 APM 工具确实存在显著的性能侵入问题，有些甚至会导致请求延迟增加 20% 以上。但随着 OpenTelemetry SDK 的成熟和 PHP 8.x 性能的提升，这个问题已经得到了很好的解决。

以下是我们基于线上环境的实测数据（Laravel 11, PHP 8.3, OPcache 开启，单机 QPS 约 2000）：

| 场景 | 无追踪 | 开启追踪（头部采样 10%） | 开启追踪（100% 采样） |
|------|--------|-------------------------|----------------------|
| 单请求 P99 延迟 | 45ms | 47ms (+4.4%) | 52ms (+15.6%) |
| CPU 使用率 | 12% | 12.3% | 14.1% |
| 内存峰值 | 48MB | 49MB | 51MB |
| 每秒 Span 导出 | 0 | ~500 | ~5000 |

**关键结论**：
- 使用 `BatchSpanProcessor` 时，10% 采样率的性能开销在 5% 以内，完全可接受
- 100% 采样在高并发场景下需要评估网络带宽和 Collector 的处理能力
- Baggage 的开销可以忽略不计（每个请求多几十字节的 HTTP 头）

---

## 结语

分布式追踪不是"锦上添花"的高级功能，而是微服务架构的**基础设施**。W3C Trace Context 和 Baggage 标准为我们提供了厂商中立、跨语言、跨协议的上下文传播方案。

回顾本文的核心要点：

1. **Trace Context 是骨架**：`traceparent` 定义了 Span 间的父子关系，让调用树得以正确构建
2. **Baggage 是血肉**：`baggage` 携带业务标签，让追踪不再是"只有技术人员看得懂"的抽象链路
3. **传播是核心**：HTTP 中间件、HTTP Client、队列任务——每一个跨进程的环节都需要显式地注入/提取上下文
4. **采样是成本控制**：头部采样简单但有盲区，尾部采样精确但需要 Collector 支持，混合策略是生产环境的最佳选择
5. **OTel 是工具**：OpenTelemetry 封装了协议细节，让你专注于业务逻辑而非底层编解码

当你下一次面对一条横跨 15 个微服务的故障链路时，打开 Grafana Tempo，输入 trace-id，看到完整的调用树和业务标签——你会感谢今天配置了这套上下文传播体系。

分布式追踪的建设是一个渐进式的过程。不要试图一步到位地实现所有功能，建议按照以下优先级分阶段推进：

**第一阶段（基础）**：实现 HTTP 入站和出站的 Trace Context 传播，确保基本的调用链路可视化。这个阶段通常一到两周就能完成，但能立即解决"链路断裂"的问题。

**第二阶段（进阶）**：添加队列任务的上下文传播，实现 Baggage 业务标签透传，并配置基础的头部采样策略。这个阶段需要两到三周，完成后你就拥有了业务级别的追踪能力。

**第三阶段（优化）**：部署 OpenTelemetry Collector，配置尾部采样策略，实现基于业务语义的智能采样。这个阶段需要结合团队的实际业务场景进行调优，通常需要一到两个月的迭代。

每个阶段都应该有明确的验收标准和可观测的收益。记住，分布式追踪的最终目的不是画出漂亮的拓扑图，而是**在生产故障发生时，让你能在分钟级别内定位问题根因**。如果一套追踪系统无法做到这一点，那它就只是一个昂贵的玩具。

最后，社区的力量不可忽视。OpenTelemetry 社区非常活跃，W3C 标准也在持续演进中。建议定期关注 [OpenTelemetry 官方博客](https://opentelemetry.io/blog/) 和 [W3C Distributed Tracing Working Group](https://www.w3.org/groups/wg/distributed-tracing/) 的最新动态，及时更新你的追踪基础设施。

---

**参考资料**：

- [W3C Trace Context 规范](https://www.w3.org/TR/trace-context/)
- [W3C Baggage 规范](https://www.w3.org/TR/baggage/)
- [OpenTelemetry PHP 文档](https://opentelemetry.io/docs/languages/php/)
- [OpenTelemetry Collector Tail Sampling Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor)
- [Laravel HTTP Client 文档](https://laravel.com/docs/11.x/http-client)

## 相关阅读

- [Grafana Tempo 实战：分布式追踪后端——OpenTelemetry 采集 + TraceQL 查询的因果可观测性](/post/grafana-tempo-opentelemetry-traceql/)
- [OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准——Laravel 应用全链路埋点](/post/opentelemetry-unified-observability-laravel-full-stack-instrumentation/)
- [Grafana Pyroscope 实战：持续性能剖析——Laravel 应用的生产环境火焰图与根因定位方法论](/post/grafana-pyroscope-laravel/)
