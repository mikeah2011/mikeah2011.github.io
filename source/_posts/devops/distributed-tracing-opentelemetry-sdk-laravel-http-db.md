---
title: Distributed Tracing 实战：OpenTelemetry SDK 在 Laravel 中的端到端链路追踪——从 HTTP 入口到 DB 出口
date: 2026-06-02 00:00:00
tags: [Distributed Tracing, OpenTelemetry, Laravel, 链路追踪, APM, 可观测性]
keywords: [Distributed Tracing, OpenTelemetry SDK, Laravel, HTTP, DB, 中的端到端链路追踪, 入口到, 出口, DevOps]
categories: [devops]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: "分布式链路追踪是微服务架构的X光机。本文从零搭建 OpenTelemetry SDK 在 Laravel 中的端到端追踪体系，涵盖 OTel Collector 部署、自动仪表化（PDO/Redis/HTTP Client）、手动 Span 创建、队列上下文传播、Jaeger 后端配置、头部与尾部采样策略、Trace 与日志关联（Loki），以及生产环境性能开销评估与最佳实践，帮助你精确定位跨服务性能瓶颈。"
---


# Distributed Tracing 实战：OpenTelemetry SDK 在 Laravel 中的端到端链路追踪——从 HTTP 入口到 DB 出口

## 前言

当一个 B2C API 请求经过 Gateway → Laravel → MySQL → Redis → 外部支付 API → 队列 Worker → 通知服务，最终返回 500 错误时，你如何定位是哪个环节出了问题？

日志告诉你"发生了什么"，指标告诉你"有多严重"，但只有链路追踪能告诉你"在哪里发生的"以及"为什么发生的"。

本文将从零搭建 OpenTelemetry 在 Laravel 中的端到端链路追踪体系。

---

## 一、分布式追踪核心概念

### 1.1 三大支柱

可观测性（Observability）的三大支柱：

| 支柱 | 数据类型 | 回答的问题 |
|------|---------|-----------|
| **Metrics** | 计数器、直方图、仪表盘 | 系统有多健康？ |
| **Logs** | 结构化日志 | 发生了什么？ |
| **Traces** | 请求链路 | 在哪里发生的？为什么？ |

### 1.2 Trace 核心术语

```
Trace（链路）：一个请求的完整生命周期
├── Span A: HTTP Request (root span)
│   ├── Span B: Middleware Pipeline
│   ├── Span C: Controller Action
│   │   ├── Span D: MySQL Query (SELECT)
│   │   ├── Span E: Redis GET
│   │   └── Span F: HTTP Client → Payment API
│   │       └── Span G: Payment API Response
│   ├── Span H: MySQL Query (INSERT)
│   └── Span I: Queue Job Dispatch
```

- **Trace ID**：全局唯一标识，贯穿整个请求链路
- **Span**：一个操作单元，有开始时间和结束时间
- **Span Context**：在服务间传递的上下文（Trace ID + Span ID + Trace Flags）
- **Parent Span**：调用链中的上级 Span
- **Attributes**：Span 的元数据（如 `db.statement`、`http.method`）

### 1.3 Context Propagation（上下文传播）

跨服务调用时，Trace Context 通过 HTTP 头传递：

```
# W3C Trace Context 标准头
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
               |--trace-id------------|--parent-span-id-----|--flags--|

tracestate: vendor1=value1,vendor2=value2
```

---

## 二、OpenTelemetry 架构

### 2.1 OpenTelemetry 组件

```
┌──────────────────────────────────────────────┐
│  Laravel Application                         │
│  ┌────────────────────────────────────────┐  │
│  │  OTel PHP SDK                         │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ │  │
│  │  │ Tracer   │ │ Meter    │ │ Logger │ │  │
│  │  └────┬─────┘ └────┬─────┘ └───┬────┘ │  │
│  │       └────────┬────┘───────────┘      │  │
│  │            ┌───▼────┐                  │  │
│  │            │Exporter│                  │  │
│  │            └───┬────┘                  │  │
│  └────────────────┼───────────────────────┘  │
└───────────────────┼──────────────────────────┘
                    │ OTLP/gRPC or HTTP
              ┌─────▼──────┐
              │  OTel       │
              │  Collector  │
              └─────┬──────┘
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    ┌─────────┐ ┌────────┐ ┌─────────┐
    │  Jaeger │ │ Grafana│ │Prometheus│
    │         │ │ Tempo  │ │         │
    └─────────┘ └────────┘ └─────────┘
```

### 2.2 安装 OTel Collector

```yaml
# docker-compose.yml (OTel Collector)
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.98.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317"  # OTLP gRPC
      - "4318:4318"  # OTLP HTTP
```

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

  # 尾部采样：只保留错误请求和慢请求的完整 trace
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: error-policy
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: latency-policy
        type: latency
        latency: { threshold_ms: 2000 }
      - name: probabilistic-policy
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

  prometheus:
    endpoint: 0.0.0.0:8889

  loki:
    endpoint: http://loki:3100/loki/api/v1/push

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, tail_sampling]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [loki]
```

---

## 三、Laravel 集成 OpenTelemetry

### 3.1 安装依赖

```bash
composer require open-telemetry/sdk \
    open-telemetry/exporter-otlp \
    open-telemetry/transport-grpc \
    open-telemetry/opentelemetry-auto-laravel \
    open-telemetry/opentelemetry-auto-pdo \
    open-telemetry/opentelemetry-auto-redis \
    open-telemetry/opentelemetry-auto-http-client
```

### 3.2 初始化 SDK

```php
// app/Providers/OpenTelemetryServiceProvider.php
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\TracerInterface;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\Exporter\OTLP\OTLPSpanExporter;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SemConv\ResourceAttributes;

class OpenTelemetryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TracerInterface::class, function () {
            $resource = ResourceInfo::create(
                ResourceInfo::merge(
                    ResourceInfo::create([
                        ResourceAttributes::SERVICE_NAME => config('app.name', 'laravel-api'),
                        ResourceAttributes::SERVICE_VERSION => config('app.version', '1.0.0'),
                        ResourceAttributes::DEPLOYMENT_ENVIRONMENT => app()->environment(),
                        'service.namespace' => 'b2c-ecommerce',
                    ]),
                    ResourceInfo::defaultResource()
                )
            );

            $exporter = new OTLPSpanExporter(
                endpoint: env('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector:4318/v1/traces'),
                protocol: env('OTEL_EXPORTER_OTLP_PROTOCOL', 'http/protobuf'),
            );

            $tracerProvider = TracerProvider::builder()
                ->addSpanProcessor(new BatchSpanProcessor($exporter))
                ->setResource($resource)
                ->build();

            Globals::registerTracerProvider($tracerProvider);

            return $tracerProvider->getTracer(
                'laravel-app',
                config('app.version', '1.0.0')
            );
        });
    }
}
```

### 3.3 环境配置

```env
# .env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=laravel-b2c-api
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
OTEL_PHP_AUTOLOAD_ENABLED=true
```

---

## 四、手动创建 Span

### 4.1 HTTP 请求链路

```php
// app/Http/Middleware/TraceMiddleware.php
class TraceMiddleware
{
    public function __construct(
        private readonly TracerInterface $tracer,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $span = $this->tracer->spanBuilder("HTTP {$request->method()} {$request->route()?.getName() ?? $request->path()}")
            ->setSpanKind(SpanKind::KIND_SERVER)
            ->setAttribute('http.method', $request->method())
            ->setAttribute('http.url', $request->fullUrl())
            ->setAttribute('http.route', $request->route()?->getName())
            ->setAttribute('http.user_agent', $request->userAgent())
            ->setAttribute('http.client_ip', $request->ip())
            ->setAttribute('user.id', auth()->id())
            ->startSpan();

        $scope = $span->activate();

        try {
            $response = $next($request);

            $span->setAttribute('http.status_code', $response->getStatusCode());

            if ($response->isServerError()) {
                $span->setStatus(StatusCode::STATUS_ERROR, "HTTP {$response->getStatusCode()}");
            }

            return $response;
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

### 4.2 业务逻辑 Span

```php
// app/Services/OrderService.php
class OrderService
{
    public function __construct(
        private readonly TracerInterface $tracer,
    ) {}

    public function createOrder(array $data): Order
    {
        return $this->tracer->spanBuilder('OrderService::createOrder')
            ->setAttribute('order.user_id', $data['user_id'])
            ->setAttribute('order.item_count', count($data['items']))
            ->startSpan()
            ->activate();

        $span = $this->tracer->spanBuilder('OrderService::createOrder')
            ->setAttribute('order.user_id', $data['user_id'])
            ->startSpan();

        $scope = $span->activate();

        try {
            // 子 Span: 库存检查
            $this->checkInventory($data['items']);

            // 子 Span: 价格计算
            $total = $this->calculateTotal($data['items']);

            // 子 Span: 创建订单记录
            $order = DB::transaction(function () use ($data, $total) {
                return Order::create([
                    'user_id' => $data['user_id'],
                    'total' => $total,
                    'status' => 'pending',
                ]);
            });

            $span->setAttribute('order.id', $order->id);
            $span->setAttribute('order.total', $total);

            return $order;
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR);
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }

    protected function checkInventory(array $items): void
    {
        $span = $this->tracer->spanBuilder('OrderService::checkInventory')
            ->setAttribute('items.count', count($items))
            ->startSpan();

        $scope = $span->activate();

        try {
            foreach ($items as $item) {
                $stock = Product::where('id', $item['product_id'])
                    ->lockForUpdate()
                    ->value('stock');

                if ($stock < $item['quantity']) {
                    $span->setAttribute('inventory.sufficient', false);
                    throw new InsufficientStockException($item['product_id']);
                }
            }

            $span->setAttribute('inventory.sufficient', true);
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

### 4.3 队列任务链路传播

```php
// app/Jobs/ProcessOrder.php
class ProcessOrder implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public readonly int $orderId,
        public readonly array $traceContext = [],
    ) {}

    public function handle(TracerInterface $tracer): void
    {
        // 从传播的上下文恢复 Trace
        $parentContext = Globals::propagator()->extract(
            $this->traceContext,
            new PropagationGetter()
        );

        $span = $tracer->spanBuilder('ProcessOrder::handle')
            ->setParent($parentContext)
            ->setAttribute('order.id', $this->orderId)
            ->startSpan();

        $scope = $span->activate();

        try {
            $order = Order::findOrFail($this->orderId);

            // 处理支付
            $this->processPayment($order);

            // 更新库存
            $this->updateInventory($order);

            // 发送通知
            $this->sendNotification($order);

            $span->setStatus(StatusCode::STATUS_OK);
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR);
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }

    // 在 Dispatch 时传播 Trace Context
    public static function dispatchWithTrace(int $orderId): PendingDispatch
    {
        $traceContext = [];
        Globals::propagator()->inject($traceContext, new PropagationSetter());

        return static::dispatch($orderId, $traceContext);
    }
}
```

---

## 五、自动仪表化

### 5.1 数据库查询自动追踪

使用 `open-telemetry/opentelemetry-auto-pdo` 包自动捕获所有数据库查询：

```php
// 自动创建的 Span 属性示例：
// db.system: mysql
// db.statement: SELECT * FROM orders WHERE user_id = ?
// db.name: b2c_production
// net.peer.name: mysql-primary.internal
// net.peer.port: 3306
```

### 5.2 HTTP Client 自动追踪

```php
// 使用 open-telemetry/opentelemetry-auto-http-client
// Laravel Http:: 自动创建 Span

$response = Http::get('https://api.payment.com/status');
// 自动创建的 Span:
// http.method: GET
// http.url: https://api.payment.com/status
// http.status_code: 200
// http.response_content_length: 1234
```

### 5.3 Redis 自动追踪

```php
// 使用 open-telemetry/opentelemetry-auto-redis
// 自动捕获所有 Redis 操作

Redis::get('product:123');
// 自动创建的 Span:
// db.system: redis
// db.statement: GET product:123
// net.peer.name: redis.internal
// net.peer.port: 6379
```

---

## 六、Jaeger 后端配置

### 6.1 Docker Compose 部署

```yaml
# docker-compose.yml
services:
  jaeger:
    image: jaegertracing/all-in-one:1.55
    environment:
      - COLLECTOR_OTLP_ENABLED=true
      - SPAN_STORAGE_TYPE=elasticsearch
      - ES_SERVER_URLS=http://elasticsearch:9200
    ports:
      - "16686:16686"  # UI
      - "4317:4317"    # OTLP gRPC
      - "4318:4318"    # OTLP HTTP

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    volumes:
      - es-data:/usr/share/elasticsearch/data

  grafana:
    image: grafana/grafana:10.4.0
    ports:
      - "3000:3000"
    volumes:
      - ./grafana-datasources.yaml:/etc/grafana/provisioning/datasources/datasources.yaml

volumes:
  es-data:
```

### 6.2 Grafana 数据源配置

```yaml
# grafana-datasources.yaml
apiVersion: 1
datasources:
  - name: Jaeger
    type: jaeger
    url: http://jaeger:16686
    isDefault: false

  - name: Tempo
    type: tempo
    url: http://tempo:3200
    isDefault: true

  - name: Prometheus
    type: prometheus
    url: http://prometheus:9090
    isDefault: false

  - name: Loki
    type: loki
    url: http://loki:3100
    isDefault: false
```

---

## 七、采样策略

### 7.1 头部采样（Head-Based Sampling）

在请求开始时决定是否采样：

```php
// 基于概率的头部采样
// OTEL_TRACES_SAMPLER=parentbased_traceidratio
// OTEL_TRACES_SAMPLER_ARG=0.1 (10% 采样率)
```

**头部采样的局限**：一个请求在开始时看起来正常，但后来失败了——如果当时决定不采样，就丢失了这个错误的 Trace。

### 7.2 尾部采样（Tail-Based Sampling）

在请求完成后决定是否保留，由 OTel Collector 实现：

```yaml
# otel-collector-config.yaml
processors:
  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    expected_new_traces_per_sec: 1000
    policies:
      # 始终保留错误请求
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]

      # 保留慢请求（>2s）
      - name: slow-requests
        type: latency
        latency:
          threshold_ms: 2000

      # 保留包含异常的请求
      - name: exceptions
        type: string_attribute
        string_attribute:
          key: exception.type
          values: [".*Exception", ".*Error"]

      # 其余请求 5% 概率采样
      - name: probabilistic
        type: probabilistic
        probabilistic:
          sampling_percentage: 5

      # 保留特定用户的请求（调试用）
      - name: vip-users
        type: string_attribute
        string_attribute:
          key: user.id
          values: ["1", "2", "3"]  # 测试用户
```

### 7.3 Laravel 端采样决策

```php
// app/Services/Tracing/SamplingMiddleware.php
class SamplingMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        // 错误请求强制采样
        $response = $next($request);

        if ($response->isServerError()) {
            // 标记当前 Span 为"必须保留"
            $span = Span::getCurrent();
            $span->setAttribute('sampling.priority', 1);
        }

        // 慢请求强制采样
        $duration = microtime(true) - LARAVEL_START;
        if ($duration > 2.0) {
            $span = Span::getCurrent();
            $span->setAttribute('sampling.priority', 1);
            $span->setAttribute('slow_request', true);
        }

        return $response;
    }
}
```

---

## 八、实战：订单创建全链路追踪

### 8.1 请求流程

```
用户 POST /api/orders
│
├── Span: HTTP POST /api/orders (500ms)
│   ├── Span: AuthMiddleware (2ms)
│   ├── Span: ThrottleMiddleware (1ms)
│   ├── Span: OrderController::store (495ms)
│   │   ├── Span: OrderService::createOrder (490ms)
│   │   │   ├── Span: checkInventory (50ms)
│   │   │   │   ├── Span: MySQL SELECT (5ms)
│   │   │   │   │   └── db.statement: SELECT stock FROM products WHERE id IN (...)
│   │   │   │   └── Span: Redis GET inventory:lock (2ms)
│   │   │   ├── Span: calculateTotal (3ms)
│   │   │   │   └── Span: Redis GET product:prices (2ms)
│   │   │   ├── Span: MySQL INSERT (8ms)
│   │   │   │   └── db.statement: INSERT INTO orders (...)
│   │   │   ├── Span: PaymentService::charge (400ms) ⚠️ 慢
│   │   │   │   ├── Span: HTTP POST payment-api/charge (395ms)
│   │   │   │   │   └── http.url: https://api.stripe.com/v1/charges
│   │   │   │   └── Span: MySQL UPDATE (3ms)
│   │   │   │       └── db.statement: UPDATE orders SET status='paid'
│   │   │   └── Span: Queue::dispatch (2ms)
│   │   │       └── Span: Redis LPUSH (1ms)
│   │   └── Span: Response Serialization (2ms)
│   └── Span: AfterMiddleware (1ms)
```

### 8.2 Jaeger UI 中的 Trace 视图

在 Jaeger UI (`http://jaeger:16686`) 中可以看到：

1. **时间线视图**：每个 Span 的开始时间和持续时间
2. **服务依赖图**：Laravel → MySQL、Redis、Stripe 的调用关系
3. **Span 详情**：每个 Span 的 Attributes、Events、Status
4. **对比视图**：正常请求 vs 异常请求的 Trace 对比

### 8.3 快速定位问题

场景：用户反馈"下单很慢"

1. 在 Jaeger 搜索 `service=laravel-api AND operation=POST /api/orders AND minDuration=1s`
2. 找到慢 Trace，查看时间线
3. 发现 `PaymentService::charge` 占了 400ms（80% 的请求时间）
4. 进一步查看 Stripe API Span，发现是 Stripe API 本身响应慢
5. 解决方案：为 Stripe API 添加超时 + 断路器 + 异步支付确认

---

## 九、日志与 Trace 关联

### 9.1 Trace ID 注入日志

```php
// app/Logging/TraceIdProcessor.php
class TraceIdProcessor
{
    public function __invoke(array $record): array
    {
        $span = Span::getCurrent();
        $spanContext = $span->getContext();

        if ($spanContext->isValid()) {
            $record['extra']['trace_id'] = $spanContext->getTraceId();
            $record['extra']['span_id'] = $spanContext->getSpanId();
            $record['extra']['trace_flags'] = $spanContext->getTraceFlags();
        }

        return $record;
    }
}

// config/logging.php
'channels' => [
    'stack' => [
        'driver' => 'stack',
        'tap' => [App\Logging\TraceIdProcessor::class],
        'channels' => ['daily', 'loki'],
    ],
],
```

### 9.2 从日志跳转到 Trace

在 Grafana 中配置 Loki 数据源后，可以直接从日志跳转到对应的 Trace：

```
# Loki 查询：找到某个 Trace 的所有日志
{app="laravel-api"} | json | trace_id = "4bf92f3577b34da6a3ce929d0e0e4736"
```

---

## 十、性能开销与优化

### 10.1 开销评估

| 组件 | CPU 开销 | 内存开销 | 延迟增加 |
|------|---------|---------|---------|
| SDK 初始化 | < 1ms | ~5MB | 无 |
| 每个 Span 创建 | ~0.01ms | ~1KB | 可忽略 |
| 批量导出 | 异步 | ~10MB buffer | 无（异步） |
| 100% 采样 | ~2-5% | ~50MB | 1-2ms/请求 |
| 10% 采样 | < 1% | ~20MB | < 0.5ms |

### 10.2 生产环境推荐配置

```env
# 生产环境采样率
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.05  # 5% 头部采样

# Collector 尾部采样保留所有错误和慢请求
# 实际保留率约 8-12%（取决于错误率和慢请求比例）
```

### 10.3 异步导出避免阻塞

```php
// 确保使用 BatchSpanProcessor（默认异步）
$tracerProvider = TracerProvider::builder()
    ->addSpanProcessor(
        new BatchSpanProcessor(
            exporter: $exporter,
            maxQueueSize: 2048,
            scheduledDelayMillis: 5000,
            exportTimeoutMillis: 30000,
            maxExportBatchSize: 512,
        )
    )
    ->build();
```

---

## 十一、最佳实践

### 11.1 Span 命名规范

```php
// ✅ 好的命名：包含操作和对象
'OrderService::createOrder'
'GET /api/v1/products/{id}'
'MySQL SELECT orders'
'Redis GET product:{id}'
'HTTP POST stripe.com/charges'

// ❌ 差的命名：太模糊或太具体
'process'           // 太模糊
'doStuff'           // 无意义
'SELECT * FROM...'  // SQL 语句做名称（应放 attribute）
```

### 11.2 Attributes 规范

```php
// 使用 OpenTelemetry Semantic Conventions
$span->setAttribute(SemConv::HTTP_METHOD, 'POST');
$span->setAttribute(SemConv::HTTP_URL, $url);
$span->setAttribute(SemConv::HTTP_STATUS_CODE, 200);
$span->setAttribute(SemConv::DB_SYSTEM, 'mysql');
$span->setAttribute(SemConv::DB_STATEMENT, $query);

// 业务属性使用自定义命名空间
$span->setAttribute('order.id', $orderId);
$span->setAttribute('order.total', $total);
$span->setAttribute('user.tier', 'vip');
```

### 11.3 避免常见陷阱

| 陷阱 | 后果 | 解决方案 |
|------|------|---------|
| 采样率 100% | 性能下降、存储爆满 | 头部 5% + 尾部采样保留错误 |
| Span 不关闭 | 内存泄漏 | 使用 try-finally 确保 end() |
| 敏感数据在 Attributes | 安全风险 | 过滤密码、Token、信用卡号 |
| 无批量导出 | 每次导出阻塞 | 使用 BatchSpanProcessor |
| Trace ID 不传播 | 链路断裂 | 确保 HTTP 头和队列 Context 传播 |

---

## 总结

分布式链路追踪是微服务架构的"X 光机"。通过 OpenTelemetry + Laravel：

1. **端到端可见**：从 HTTP 入口到 DB 出口，每个操作都有 Span
2. **自动仪表化**：PDO、Redis、HTTP Client 自动创建 Span，零代码侵入
3. **智能采样**：头部采样控制成本，尾部采样保留关键 Trace
4. **三支柱关联**：Trace ID 将 Metrics、Logs、Traces 串联起来

当用户报告"页面很慢"时，你不再需要猜测——打开 Jaeger，找到那个 Trace，精确定位瓶颈。

## 相关阅读

- [OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准——Laravel 应用全链路埋点](/post/opentelemetry-unified-observability-laravel-full-stack-instrumentation/)
- [Grafana Loki 实战：轻量级日志聚合替代 ELK——Laravel 应用的日志采集与查询优化](/post/grafana-loki-lightweight-log-aggregation-laravel/)
- [Sentry 实战：2026 年版错误追踪深度使用——性能监控、Session Replay 与 Laravel 集成](/post/sentry-error-tracking-performance-monitoring-session-replay-laravel/)
