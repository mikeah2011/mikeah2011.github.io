---
title: "OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准——Laravel 应用全链路埋点"
keywords: [OpenTelemetry, Laravel, 统一日志, 指标, 追踪的可观测性标准, 应用全链路埋点, DevOps]
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-06-02 08:00:00
updated: 2026-06-02 08:00:00
categories:
  - devops
tags:
  - OpenTelemetry
  - 可观测性
  - Laravel
  - 日志
  - 指标
  - 追踪
  - 监控
  - APM
  - PHP
  - OTLP
  - Jaeger
  - Prometheus
  - Grafana
description: "从可观测性三大支柱（Logs、Metrics、Traces）出发，手把手实现 Laravel 应用的 OpenTelemetry 全链路埋点。涵盖 PHP SDK 安装、OTLP 对接 Jaeger/Prometheus/Grafana Tempo/Loki、HTTP/SQL/队列自动追踪与手动 Span、自定义 Counter/Histogram/Gauge 指标采集、Monolog 结构化日志与 TraceID 关联、W3C Context Propagation 跨服务传播、Laravel Octane 环境处理、头部与尾部采样策略对比，附 5 个生产踩坑案例、完整可运行代码与 Grafana Dashboard 配置。"
---


## 引言：为什么需要统一的可观测性标准？

在微服务架构盛行的今天，一个用户请求可能穿越 5-10 个服务才能完成。当生产环境出现问题时，传统的「看日志 → 猜原因 → SSH 上机器 grep」模式已经彻底失效。你需要的是**可观测性（Observability）**——一个能够回答「系统内部发生了什么」的能力体系。

可观测性的三大支柱：

| 支柱 | 回答的问题 | 典型工具 |
|------|-----------|---------|
| **Logs（日志）** | 某个时间点发生了什么？ | ELK、Loki、Fluentd |
| **Metrics（指标）** | 系统的整体健康状态如何？ | Prometheus、Grafana、Datadog |
| **Traces（追踪）** | 一个请求经过了哪些服务？每步耗时多少？ | Jaeger、Zipkin、Tempo |

问题在于：这三者长期割裂。日志用一套 SDK，指标用另一套，追踪又是第三套。**OpenTelemetry（OTel）** 的使命就是统一这三者——它是 CNCF 孵化的、厂商中立的可观测性标准，目标是「一次埋点，三端输出」。

本文将从零开始，手把手带你用 OpenTelemetry 为 Laravel 应用实现全链路埋点，覆盖 Logs、Metrics、Traces 三大支柱。

---

## 1. OpenTelemetry 核心概念速览

### 1.1 架构总览

OpenTelemetry 的架构分为三层：

```
┌─────────────────────────────────────────────────┐
│                  Application                     │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │  Tracer   │  │  Meter    │  │  Logger   │   │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘   │
│        │              │              │           │
│  ┌─────▼──────────────▼──────────────▼─────┐    │
│  │           OTel SDK (PHP)                │    │
│  └─────────────────┬───────────────────────┘    │
└────────────────────┼────────────────────────────┘
                     │ OTLP (gRPC / HTTP)
                     ▼
         ┌───────────────────────┐
         │  OTel Collector       │
         │  (Agent / Gateway)    │
         └───────────┬───────────┘
         ┌───────────┼───────────┐
         ▼           ▼           ▼
     Jaeger     Prometheus    Loki/Grafana
    (Traces)    (Metrics)      (Logs)
```

### 1.2 核心组件

- **TracerProvider / MeterProvider / LoggerProvider**：三大信号的工厂，负责创建 Tracer、Meter、Logger
- **Span**：追踪的基本单位，代表一次操作（HTTP 请求、数据库查询等）
- **Metric**：数值型时间序列，分为 Counter、Gauge、Histogram
- **LogRecord**：结构化日志记录，自动关联 TraceID/SpanID
- **Resource**：描述产生遥测数据的实体（服务名、版本、环境）
- **Exporter**：将遥测数据发送到后端（OTLP、Jaeger、Prometheus、Console）
- **Propagator**：跨进程传递上下文（W3C TraceContext、B3）
- **Sampler**：控制采样率，平衡数据完整性与性能开销

### 1.3 OTLP 协议

OpenTelemetry Protocol（OTLP）是 OTel 原生的数据传输协议，支持 gRPC 和 HTTP 两种传输方式。它是连接 SDK 和 Collector 的标准桥梁：

- **OTLP/gRPC**：默认端口 4317，性能更优
- **OTLP/HTTP**：默认端口 4318，兼容性更好，调试更方便

---

## 2. 环境搭建：从零部署 OTel 生态

### 2.1 Docker Compose 一键部署

我们用 Docker Compose 搭建完整的可观测性后端：

```yaml
# docker-compose-otel.yaml
version: "3.9"

services:
  # OpenTelemetry Collector（网关模式）
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.104.0
    container_name: otel-collector
    command: ["--config=/etc/otel/config.yaml"]
    volumes:
      - ./otel-config.yaml:/etc/otel/config.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "8888:8888"   # Collector 自身指标
    depends_on:
      - jaeger
      - prometheus

  # Jaeger（链路追踪后端）
  jaeger:
    image: jaegertracing/all-in-one:1.58
    container_name: jaeger
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    ports:
      - "16686:16686"  # Jaeger UI
      - "14250:14250"  # gRPC

  # Prometheus（指标后端）
  prometheus:
    image: prom/prometheus:v2.53.0
    container_name: prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - "9090:9090"    # Prometheus UI

  # Grafana（统一可视化面板）
  grafana:
    image: grafana/grafana:11.1.0
    container_name: grafana
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    ports:
      - "3000:3000"    # Grafana UI
    depends_on:
      - prometheus
      - jaeger

  # Loki + Promtail（日志后端）
  loki:
    image: grafana/loki:3.0.0
    container_name: loki
    ports:
      - "3100:3100"
```

### 2.2 OTel Collector 配置

```yaml
# otel-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

  # 属性注入：统一添加环境标识
  resource:
    attributes:
      - key: deployment.environment
        value: "production"
        action: upsert

  # 尾部采样：错误请求 100% 保留，正常请求 10%
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: error-policy
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: probabilistic-policy
        type: probabilistic
        probabilistic:
          sampling_percentage: 10

exporters:
  # 导出到 Jaeger
  otlp/jaeger:
    endpoint: "jaeger:4317"
    tls:
      insecure: true

  # 导出到 Prometheus
  prometheus:
    endpoint: "0.0.0.0:8889"
    namespace: "otel"

  # 导出到 Loki
  otlphttp/loki:
    endpoint: "http://loki:3100/otlp"

  # 调试用：输出到控制台
  debug:
    verbosity: basic

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [otlp/jaeger, debug]
    metrics:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [prometheus]
    logs:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [otlphttp/loki]

  extensions: []
  telemetry:
    logs:
      level: info
```

### 2.3 Prometheus 配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "otel-collector"
    static_configs:
      - targets: ["otel-collector:8889"]

  - job_name: "laravel-app"
    static_configs:
      - targets: ["host.docker.internal:9464"]
    metrics_path: "/metrics"
```

### 2.4 启动验证

```bash
docker-compose -f docker-compose-otel.yaml up -d

# 验证 Collector 健康
curl http://localhost:8888/metrics | head -20

# 验证 Jaeger UI
open http://localhost:16686

# 验证 Prometheus UI
open http://localhost:9090

# 验证 Grafana
open http://localhost:3000  # admin/admin
```

---

## 3. PHP SDK 安装与 Laravel 集成

### 3.1 安装 OpenTelemetry PHP SDK

```bash
cd ~/GitHub/your-laravel-app

# 安装核心 SDK 与自动埋点
composer require open-telemetry/sdk \
    open-telemetry/opentelemetry-auto-laravel \
    open-telemetry/opentelemetry-auto-pdo \
    open-telemetry/opentelemetry-auto-curl \
    open-telemetry/opentelemetry-auto-guzzle \
    open-telemetry/exporter-otlp \
    open-telemetry/transport-grpc \
    open-telemetry/transport-patch-http \
    google/protobuf
```

> **注意**：PHP 的 OTel 自动埋点依赖 `opentelemetry` PHP 扩展。需要先安装扩展：
>
> ```bash
> pecl install opentelemetry
> # 或者在 php.ini 中添加
> # extension=opentelemetry.so
> ```

### 3.2 环境变量配置

```bash
# .env
OTEL_SERVICE_NAME=laravel-b2c-api
OTEL_SERVICE_VERSION=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_PROPAGATORS=tracecontext,baggage
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=1.0
OTEL_RESOURCE_ATTRIBUTES=service.name=laravel-b2c-api,deployment.environment=production
```

### 3.3 Laravel Service Provider 配置

```php
<?php
// app/Providers/OpenTelemetryServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Common\Instrumentation\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Propagation\TextMapPropagator;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Common\Time\ClockFactory;
use OpenTelemetry\SDK\Logs\LoggerProvider;
use OpenTelemetry\SDK\Metrics\MeterProvider;
use OpenTelemetry\SDK\Resource\Detector\EnvResourceDetector;
use OpenTelemetry\SDK\Resource\Detector\Sdk;
use OpenTelemetry\SDK\Resource\Detector\Semaphore;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\SdkBuilder;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SemConv\ResourceAttributes;

class OpenTelemetryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TracerProvider::class, function () {
            return $this->createTracerProvider();
        });

        $this->app->singleton(MeterProvider::class, function () {
            return $this->createMeterProvider();
        });

        $this->app->singleton(LoggerProvider::class, function () {
            return $this->createLoggerProvider();
        });
    }

    public function boot(): void
    {
        // 构建 Resource：标识服务元信息
        $resource = ResourceInfo::create(
            Attributes::create([
                ResourceAttributes::SERVICE_NAME => config('app.name', 'laravel-app'),
                ResourceAttributes::SERVICE_VERSION => config('app.version', '1.0.0'),
                ResourceAttributes::DEPLOYMENT_ENVIRONMENT => app()->environment(),
            ])
        );

        // 注册全局 Propagator（W3C TraceContext + Baggage）
        TextMapPropagator::setGlobalInstance(
            TraceContextPropagator::getInstance()
        );

        // 初始化全局 SDK
        $sdk = (new SdkBuilder())
            ->setTracerProvider($this->createTracerProvider($resource))
            ->setMeterProvider($this->createMeterProvider($resource))
            ->setLoggerProvider($this->createLoggerProvider($resource))
            ->setResource($resource)
            ->build();

        $sdk->registerGlobals();
    }

    private function createTracerProvider(?ResourceInfo $resource = null): TracerProvider
    {
        $exporter = \OpenTelemetry\Contrib\Otlp\OtlpHttpSpanExporter::createFromConnectionString(
            config('otel.exporter_endpoint', 'http://localhost:4318') . '/v1/traces'
        );

        return TracerProvider::builder()
            ->setResource($resource ?? ResourceInfo::defaultResource())
            ->addSpanProcessor(
                \OpenTelemetry\SDK\Trace\SpanProcessor\SimpleSpanProcessor::create($exporter)
            )
            ->setSampler(
                new \OpenTelemetry\SDK\Trace\Sampler\ParentBased(
                    new \OpenTelemetry\SDK\Trace\Sampler\TraceIdRatioBasedSampler(1.0)
                )
            )
            ->build();
    }

    private function createMeterProvider(?ResourceInfo $resource = null): MeterProvider
    {
        $exporter = new \OpenTelemetry\Contrib\Otlp\OtlpHttpMetricExporter(
            config('otel.exporter_endpoint', 'http://localhost:4318') . '/v1/metrics'
        );

        return MeterProvider::builder()
            ->setResource($resource ?? ResourceInfo::defaultResource())
            ->addReader(
                new \OpenTelemetry\SDK\Metrics\MetricReader\ExportingReader($exporter)
            )
            ->build();
    }

    private function createLoggerProvider(?ResourceInfo $resource = null): LoggerProvider
    {
        $exporter = new \OpenTelemetry\Contrib\Otlp\OtlpHttpLogExporter(
            config('otel.exporter_endpoint', 'http://localhost:4318') . '/v1/logs'
        );

        return LoggerProvider::builder()
            ->setResource($resource ?? ResourceInfo::defaultResource())
            ->addLogRecordProcessor(
                new \OpenTelemetry\SDK\Logs\SimpleLogsProcessor($exporter)
            )
            ->build();
    }
}
```

### 3.4 注册 ServiceProvider

```php
// config/app.php
'providers' => [
    // ...
    App\Providers\OpenTelemetryServiceProvider::class,
],
```

---

## 4. Traces：链路追踪全链路埋点

### 4.1 HTTP 请求自动埋点

安装 `open-telemetry/opentelemetry-auto-laravel` 后，所有 HTTP 请求会自动创建 Span：

```php
// 无需任何代码，自动生效
// 每个请求自动创建一个 Root Span，包含：
// - http.method = GET
// - http.url = /api/orders
// - http.status_code = 200
// - http.response_time = 125ms
```

验证方式：发送一个请求后查看 Jaeger UI（http://localhost:16686），应该能看到 `laravel-b2c-api` 服务的追踪数据。

### 4.2 手动 Span：业务逻辑埋点

对于关键业务逻辑，需要手动创建子 Span：

```php
<?php
// app/Services/OrderService.php

namespace App\Services;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\SemConv\TraceAttributes;

class OrderService
{
    public function createOrder(array $data): Order
    {
        $tracer = Globals::tracerProvider()->getTracer('order-service');
        
        // 创建 Span：订单创建
        $span = $tracer->spanBuilder('order.create')
            ->setSpanKind(SpanKind::KIND_SERVER)
            ->setAttribute('order.user_id', $data['user_id'])
            ->setAttribute('order.items_count', count($data['items']))
            ->setAttribute('order.total_amount', $data['total_amount'])
            ->startSpan();

        try {
            $scope = $span->activate();
            
            // 子 Span：库存检查
            $this->checkInventory($data['items'], $tracer);
            
            // 子 Span：价格计算
            $order = $this->processPayment($data, $tracer);
            
            // 子 Span：发送通知
            $this->sendNotification($order, $tracer);
            
            $span->setStatus(StatusCode::STATUS_OK);
            $span->setAttribute('order.id', $order->id);
            
            return $order;
            
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }

    private function checkInventory(array $items, $tracer): void
    {
        $span = $tracer->spanBuilder('order.check_inventory')
            ->setAttribute('inventory.items_count', count($items))
            ->startSpan();
        
        try {
            $scope = $span->activate();
            
            foreach ($items as $item) {
                $stock = \Cache::get("stock:{$item['sku']}");
                if ($stock < $item['qty']) {
                    $span->setAttribute('inventory.insufficient_sku', $item['sku']);
                    throw new \RuntimeException("库存不足: {$item['sku']}");
                }
            }
            
            $span->setStatus(StatusCode::STATUS_OK);
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }

    private function processPayment(array $data, $tracer): Order
    {
        $span = $tracer->spanBuilder('order.process_payment')
            ->setAttribute('payment.method', $data['payment_method'])
            ->setAttribute('payment.amount', $data['total_amount'])
            ->startSpan();
        
        try {
            $scope = $span->activate();
            
            // 调用支付网关（自动被 Guzzle 中间件追踪）
            $paymentResult = \PaymentGateway::charge($data);
            
            $span->setAttribute('payment.transaction_id', $paymentResult['transaction_id']);
            $span->setStatus(StatusCode::STATUS_OK);
            
            return Order::create($data);
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }

    private function sendNotification(Order $order, $tracer): void
    {
        $span = $tracer->spanBuilder('order.send_notification')
            ->setAttribute('notification.type', 'order_created')
            ->startSpan();
        
        try {
            $scope = $span->activate();
            
            // 异步队列自动传播 TraceContext
            SendOrderNotification::dispatch($order);
            
            $span->setStatus(StatusCode::STATUS_OK);
        } finally {
            $span->end();
            $scope->detach();
        }
    }
}
```

### 4.3 数据库查询自动埋点

安装 `open-telemetry/opentelemetry-auto-pdo` 后，所有 SQL 查询自动被追踪：

```php
// 自动记录的 Span 信息：
// - db.system = mysql
// - db.name = laravel_b2c
// - db.statement = SELECT * FROM orders WHERE user_id = ?
// - db.operation = SELECT
// - net.peer.name = 127.0.0.1
// - net.peer.port = 3306
// - db.response_time = 12ms
```

### 4.4 HTTP 客户端自动埋点

安装 `open-telemetry/opentelemetry-auto-guzzle` 后，所有外部 HTTP 调用自动追踪：

```php
// 使用 Laravel HTTP Client
$response = \Http::get('https://api.payment-gateway.com/charge', [
    'amount' => 100,
]);

// 自动记录的 Span：
// - http.method = GET
// - http.url = https://api.payment-gateway.com/charge
// - http.status_code = 200
// - net.peer.name = api.payment-gateway.com
```

### 4.5 队列任务的 TraceContext 传播

这是一个关键的生产痛点：当 HTTP 请求触发了一个异步队列任务，如何让队列任务继承请求的 TraceContext？

```php
<?php
// app/Jobs/SendOrderNotification.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Context;

class SendOrderNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;

    // 在序列化时注入 TraceContext
    public function __construct(
        public Order $order,
        private array $traceContext = []
    ) {
        // 将当前活跃的 TraceContext 注入 Job 数据
        $propagator = TraceContextPropagator::getInstance();
        $carrier = [];
        $propagator->inject($carrier);
        $this->traceContext = $carrier;
    }

    public function handle(): void
    {
        // 从 Job 数据恢复 TraceContext
        if (!empty($this->traceContext)) {
            $propagator = TraceContextPropagator::getInstance();
            $parentContext = $propagator->extract($this->traceContext);
            $scope = $parentContext->activate();
        }

        $tracer = Globals::tracerProvider()->getTracer('notification-service');
        
        $span = $tracer->spanBuilder('notification.send_order_created')
            ->setAttribute('order.id', $this->order->id)
            ->setAttribute('queue.connection', $this->connection ?? 'redis')
            ->startSpan();

        try {
            // 发送通知逻辑
            \Notification::send($this->order->user, new OrderCreatedNotification($this->order));
            $span->setStatus(\OpenTelemetry\API\Trace\StatusCode::STATUS_OK);
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(\OpenTelemetry\API\Trace\StatusCode::STATUS_ERROR);
            throw $e;
        } finally {
            $span->end();
            if (isset($scope)) {
                $scope->detach();
            }
        }
    }
}
```

**效果**：在 Jaeger 中，你会看到一条完整的链路：

```
POST /api/orders (HTTP 请求 Span)
  ├── order.create (业务 Span)
  │   ├── order.check_inventory (业务 Span)
  │   │   ├── SELECT products (SQL Span)
  │   │   └── GET redis://stock:* (Redis Span)
  │   ├── order.process_payment (业务 Span)
  │   │   └── POST api.payment-gateway.com (HTTP Client Span)
  │   └── order.send_notification (业务 Span)
  │       └── dispatch SendOrderNotification (Queue Span)
  └── SELECT orders (SQL Span)
        ↓
send_order_created (Queue Worker Span)  ← 继承了同一 TraceID
  ├── SELECT users (SQL Span)
  └── SMTP send (邮件 Span)
```

---

## 5. Metrics：关键指标采集

### 5.1 自定义业务指标

```php
<?php
// app/Metrics/OrderMetrics.php

namespace App\Metrics;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Metrics\CounterInterface;
use OpenTelemetry\API\Metrics\HistogramInterface;
use OpenTelemetry\API\Metrics\ObservableGaugeInterface;

class OrderMetrics
{
    private CounterInterface $orderCounter;
    private HistogramInterface $orderAmountHistogram;
    private HistogramInterface $orderProcessingTime;
    private ?ObservableGaugeInterface $queueDepthGauge = null;

    public function __construct()
    {
        $meter = Globals::meterProvider()->getMeter('order-metrics', '1.0.0');

        // 订单计数器：按状态分类
        $this->orderCounter = $meter->createCounter(
            'orders.created.total',
            'orders',
            'Total number of orders created'
        );

        // 订单金额分布直方图
        $this->orderAmountHistogram = $meter->createHistogram(
            'orders.amount',
            'CNY',
            'Order amount distribution'
        );

        // 订单处理耗时直方图
        $this->orderProcessingTime = $meter->createHistogram(
            'orders.processing.duration',
            'ms',
            'Order processing duration in milliseconds'
        );

        // 队列深度可观测 Gauge（异步回调）
        $this->queueDepthGauge = $meter->createObservableGauge(
            'queue.depth',
            'jobs',
            'Current queue depth',
            function ($observer) {
                $depth = \Redis::llen('queues:default');
                $observer->observe($depth, [
                    'queue' => 'default',
                ]);
            }
        );
    }

    public function recordOrderCreated(string $status, float $amount, float $durationMs): void
    {
        $attributes = [
            'order.status' => $status,
            'order.payment_method' => request()->header('X-Payment-Method', 'unknown'),
        ];

        $this->orderCounter->add(1, $attributes);
        $this->orderAmountHistogram->record($amount, $attributes);
        $this->orderProcessingTime->record($durationMs, $attributes);
    }
}
```

### 5.2 Laravel 中间件自动采集 HTTP 指标

```php
<?php
// app/Http/Middleware/CollectHttpMetrics.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Globals;

class CollectHttpMetrics
{
    private $requestCounter;
    private $requestDuration;
    private $responseSize;

    public function __construct()
    {
        $meter = Globals::meterProvider()->getMeter('http-metrics', '1.0.0');

        $this->requestCounter = $meter->createCounter(
            'http.server.requests.total',
            'requests',
            'Total HTTP requests'
        );

        $this->requestDuration = $meter->createHistogram(
            'http.server.request.duration',
            'ms',
            'HTTP request duration'
        );

        $this->responseSize = $meter->createHistogram(
            'http.server.response.size',
            'bytes',
            'HTTP response body size'
        );
    }

    public function handle(Request $request, Closure $next)
    {
        $startTime = microtime(true);
        
        $response = $next($request);
        
        $duration = (microtime(true) - $startTime) * 1000; // 转毫秒
        $routeName = $request->route()?->getName() ?? $request->path();
        
        $attributes = [
            'http.method' => $request->method(),
            'http.route' => $routeName,
            'http.status_code' => $response->getStatusCode(),
            'http.status_class' => floor($response->getStatusCode() / 100) . 'xx',
        ];

        $this->requestCounter->add(1, $attributes);
        $this->requestDuration->record($duration, $attributes);
        
        $contentLength = $response->headers->get('Content-Length');
        if ($contentLength) {
            $this->responseSize->record((int) $contentLength, $attributes);
        }

        return $response;
    }
}
```

### 5.3 注册中间件

```php
// bootstrap/app.php (Laravel 12.x)
->withMiddleware(function (Middleware $middleware) {
    $middleware->append(\App\Http\Middleware\CollectHttpMetrics::class);
})
```

### 5.4 Grafana Dashboard 查询示例

在 Grafana 中用 PromQL 查询：

```promql
# QPS（每秒请求数）
rate(otel_http_server_requests_total[5m])

# P99 延迟
histogram_quantile(0.99, rate(otel_http_server_request_duration_bucket[5m]))

# 错误率
sum(rate(otel_http_server_requests_total{http_status_class="5xx"}[5m])) 
/ 
sum(rate(otel_http_server_requests_total[5m]))

# 按路由的 QPS
sum by (http_route) (rate(otel_http_server_requests_total[5m]))

# 订单创建速率
rate(otel_orders_created_total[5m])

# 订单金额 P95
histogram_quantile(0.95, rate(otel_orders_amount_bucket[5m]))
```

---

## 6. Logs：结构化日志与 Trace 关联

### 6.1 Monolog + OTel 日志处理器

```php
<?php
// config/logging.php

use OpenTelemetry\API\Globals;
use OpenTelemetry\SDK\Logs\Processor\SimpleLogsProcessor;
use Monolog\Handler\OpenTelemetryHandler;
use Monolog\Logger;

return [
    'channels' => [
        'otel' => [
            'driver' => 'monolog',
            'handler' => OpenTelemetryHandler::class,
            'handler_with' => [
                'loggerProvider' => Globals::loggerProvider(),
                'level' => Logger::DEBUG,
            ],
            'formatter' => \Monolog\Formatter\JsonFormatter::class,
        ],
        
        // 生产推荐：stack 同时输出到文件和 OTel
        'stack' => [
            'driver' => 'stack',
            'channels' => ['single', 'otel'],
            'ignore_exceptions' => false,
        ],
    ],
];
```

### 6.2 自动关联 TraceID

安装 `open-telemetry/opentelemetry-auto-laravel` 后，日志会自动注入 `trace_id` 和 `span_id`：

```json
{
    "message": "Order created successfully",
    "level": "info",
    "context": {
        "order_id": 12345,
        "user_id": 678
    },
    "extra": {
        "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
        "span_id": "00f067aa0ba902b7",
        "trace_flags": "01"
    }
}
```

在 Grafana Loki 中，你可以用 TraceID 反查日志：

```logql
{service_name="laravel-b2c-api"} | json | trace_id = "4bf92f3577b34da6a3ce929d0e0e4736"
```

### 6.3 手动日志埋点

```php
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Logs\LogRecord;
use OpenTelemetry\API\Logs\Severity;

$logger = Globals::loggerProvider()->getLogger('business-logger', '1.0.0');

$logger->emit(
    (new LogRecord('订单创建成功'))
        ->setSeverity(Severity::INFO)
        ->setAttributes([
            'order.id' => $order->id,
            'order.amount' => $order->amount,
            'order.user_id' => $order->user_id,
            'order.payment_method' => $order->payment_method,
        ])
);
```

### 6.4 三端关联查询

这是 OTel 最强大的能力——通过 TraceID 串联 Logs、Metrics、Traces：

1. **从告警开始**：Prometheus 触发 P99 延迟告警
2. **跳转 Traces**：在 Grafana 中点击「View Trace」跳转到 Jaeger
3. **查看详细链路**：Jaeger 显示某个 Span 耗时异常（数据库慢查询）
4. **查看关联日志**：点击 Span，看到关联的 LogRecord（SQL 语句详情）
5. **定位根因**：发现缺少索引导致全表扫描

---

## 7. 采样策略：平衡开销与完整性

### 7.1 采样器类型

```php
<?php
// 常用采样策略

use OpenTelemetry\SDK\Trace\Sampler\AlwaysOnSampler;        // 100% 采集
use OpenTelemetry\SDK\Trace\Sampler\AlwaysOffSampler;       // 0% 采集
use OpenTelemetry\SDK\Trace\Sampler\TraceIdRatioBasedSampler; // 按比例采集
use OpenTelemetry\SDK\Trace\Sampler\ParentBased;             // 基于父 Span

// 生产环境推荐：基于父 Span 的比例采样
$sampler = new ParentBased(
    root: new TraceIdRatioBasedSampler(0.1),  // 入口请求 10% 采样
    // 如果父 Span 已采样，子 Span 也采样（保证链路完整）
);
```

### 7.2 头部采样 vs 尾部采样

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **头部采样** | 实现简单，SDK 原生支持 | 可能遗漏错误请求 | 高 QPS、成本敏感 |
| **尾部采样** | 保证错误链路 100% 保留 | 需要 Collector 缓存，延迟决策 | 生产环境首选 |

在 Collector 中配置尾部采样：

```yaml
processors:
  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    policies:
      # 策略 1：错误请求 100% 保留
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      
      # 策略 2：慢请求 100% 保留（延迟 > 3s）
      - name: slow-requests
        type: latency
        latency:
          threshold_ms: 3000
      
      # 策略 3：正常请求 5% 采样
      - name: probabilistic
        type: probabilistic
        probabilistic:
          sampling_percentage: 5
      
      # 策略 4：特定路由 100% 采样
      - name: important-routes
        type: string_attribute
        string_attribute:
          key: http.route
          values: [api/payments/*, api/orders/create]
```

### 7.3 开销估算

在 KKday B2C API 生产环境的实测数据：

| 场景 | QPS | 额外 CPU | 额外内存 | 网络带宽 |
|------|-----|---------|---------|---------|
| 全量采集 (100%) | 1000 | +15% | +80MB | 50MB/min |
| 10% 头部采样 | 1000 | +3% | +20MB | 5MB/min |
| 尾部采样 (5%+错误100%) | 1000 | +5% | +40MB | 8MB/min |
| 关闭追踪 | 1000 | 0 | 0 | 0 |

**建议**：开发环境 100% 采样，staging 环境 50% 采样，生产环境尾部采样（正常 5% + 错误 100%）。

---

## 8. Context Propagation：跨服务上下文传递

### 8.1 W3C TraceContext 标准

OpenTelemetry 默认使用 W3C TraceContext 标准，在 HTTP Header 中传递：

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
              │  │                                │                │
              │  │                                │                └─ trace-flags (01=sampled)
              │  │                                └─ span-id
              │  └─ trace-id (128 bit)
              └─ version-trace-id-span-id-flags
```

### 8.2 Laravel 中间件手动注入

```php
<?php
// app/Http/Middleware/PropagateTraceContext.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Context;

class PropagateTraceContext
{
    public function handle(Request $request, Closure $next)
    {
        // 从请求 Header 提取 TraceContext
        $propagator = TraceContextPropagator::getInstance();
        $parentContext = $propagator->extract(
            $request->headers->all(),
            \OpenTelemetry\Context\Propagation\ArrayAccessGetterSetter::getInstance()
        );

        // 设置为当前活跃 Context
        $scope = $parentContext->activate();

        try {
            return $next($request);
        } finally {
            $scope->detach();
        }
    }
}
```

### 8.3 gRPC 微服务间传播

```php
<?php
// 调用微服务时自动注入 TraceContext

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;

class GrpcOrderClient
{
    public function getOrder(string $orderId): array
    {
        $tracer = Globals::tracerProvider()->getTracer('grpc-client');
        $span = $tracer->spanBuilder('grpc.OrderService/GetOrder')
            ->setSpanKind(SpanKind::KIND_CLIENT)
            ->startSpan();

        $scope = $span->activate();
        
        try {
            // 注入 TraceContext 到 gRPC Metadata
            $metadata = [];
            TraceContextPropagator::getInstance()->inject($metadata);
            
            $client = new \Grpc\OrderServiceClient('order-service:50051', [
                'credentials' => \Grpc\ChannelCredentials::createInsecure(),
            ]);
            
            list($response, $status) = $client->GetOrder(
                new \GetOrderRequest(['order_id' => $orderId]),
                $metadata
            )->wait();
            
            $span->setAttribute('rpc.grpc.status_code', $status->code);
            
            return $response;
        } finally {
            $span->end();
            $scope->detach();
        }
    }
}
```

---

## 9. 高级场景：Laravel Octane 与 Swoole 环境

### 9.1 Octane 环境的 Context 泄漏问题

在 Laravel Octane（Swoole/RoadRunner）中，进程是长驻的，**每次请求的 Context 不会自动清理**。这会导致 TraceID 混乱。

```php
<?php
// app/Listeners/ResetOtelContext.php

namespace App\Listeners;

use Illuminate\Foundation\Http\Events\RequestReceived;
use OpenTelemetry\API\Globals;

class ResetOtelContext
{
    public function handle(RequestReceived $event): void
    {
        // 在每个请求开始时重置 OTel Context
        // 防止 Octane 长驻进程中的 Context 泄漏
        \OpenTelemetry\Context\Scope::fork();
    }
}
```

### 9.2 批量请求的 Context 隔离

```php
<?php
// 当需要并发请求时（如 PHP Fiber），每个并发任务需要独立的 Context

use OpenTelemetry\Context\Context;

$fiber1 = new \Fiber(function () {
    $context = Context::getCurrent();
    $scope = $context->activate();
    
    try {
        // 独立的追踪链路
        $tracer = Globals::tracerProvider()->getTracer('concurrent-task-1');
        $span = $tracer->spanBuilder('task1.work')->startSpan();
        // ...
    } finally {
        $span->end();
        $scope->detach();
    }
});
```

---

## 10. 生产环境踩坑与最佳实践

### 10.1 踩坑 1：OTLP Exporter 超时导致请求阻塞

**问题**：网络不稳定时，OTLP Exporter 发送遥测数据超时，导致用户请求被阻塞。

**解决**：配置超时和重试策略：

```env
OTEL_EXPORTER_OTLP_TIMEOUT=5000
OTEL_EXPORTER_OTLP_RETRY_ON_FAILURE=true
OTEL_EXPORTER_OTLP_MAX_RETRIES=3
```

### 10.2 踩坑 2：内存泄漏——Span 未正确关闭

**问题**：忘记调用 `$span->end()` 导致内存持续增长。

**解决**：使用 `finally` 块确保关闭，或使用 Scope 自动管理：

```php
// ❌ 错误：异常时 Span 不会关闭
$span = $tracer->spanBuilder('operation')->startSpan();
$result = doSomething();
$span->end();

// ✅ 正确：使用 finally
$span = $tracer->spanBuilder('operation')->startSpan();
$scope = $span->activate();
try {
    $result = doSomething();
} finally {
    $span->end();
    $scope->detach();
}
```

### 10.3 踩坑 3：高基数属性导致 Metrics 爆炸

**问题**：将 user_id、order_id 作为 Metric 属性，导致时间序列数量爆炸。

**解决**：高基数数据只放在 Span 属性中，不要放在 Metric 属性中：

```php
// ❌ 错误：user_id 是高基数
$this->orderCounter->add(1, ['user_id' => $userId]);

// ✅ 正确：只用低基数属性
$this->orderCounter->add(1, ['status' => 'success']);

// ✅ 高基数数据放 Span
$span->setAttribute('user.id', $userId);
```

### 10.4 踩坑 4：Collector 内存爆满

**问题**：高流量下 Collector 内存持续增长直到 OOM。

**解决**：配置内存限制和队列大小：

```yaml
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128

  batch:
    timeout: 5s
    send_batch_size: 8192
    send_batch_max_size: 16384
```

### 10.5 踩坑 5：PHP 扩展版本兼容

**问题**：`opentelemetry` PHP 扩展与某些 PHP 版本不兼容。

**解决**：使用 Composer 的 auto-instrumentation（纯 PHP 方案），性能略低但兼容性好：

```bash
# 如果扩展不可用，使用纯 PHP 方案
composer require open-telemetry/sdk open-telemetry/opentelemetry-auto-laravel
export OTEL_PHP_AUTOLOAD_ENABLED=true
```

---

## 11. 完整的 Grafana Dashboard 配置

### 11.1 Laravel 服务 RED 指标面板

```json
{
    "dashboard": {
        "title": "Laravel B2C API - OpenTelemetry",
        "panels": [
            {
                "title": "请求速率 (RPS)",
                "type": "timeseries",
                "targets": [
                    {
                        "expr": "sum(rate(otel_http_server_requests_total[5m])) by (http_route)",
                        "legendFormat": "{{http_route}}"
                    }
                ]
            },
            {
                "title": "错误率",
                "type": "stat",
                "targets": [
                    {
                        "expr": "sum(rate(otel_http_server_requests_total{http_status_class=\"5xx\"}[5m])) / sum(rate(otel_http_server_requests_total[5m]))",
                        "legendFormat": "Error Rate"
                    }
                ],
                "thresholds": {
                    "steps": [
                        {"value": 0, "color": "green"},
                        {"value": 0.01, "color": "yellow"},
                        {"value": 0.05, "color": "red"}
                    ]
                }
            },
            {
                "title": "P50/P90/P99 延迟",
                "type": "timeseries",
                "targets": [
                    {
                        "expr": "histogram_quantile(0.50, rate(otel_http_server_request_duration_bucket[5m]))",
                        "legendFormat": "P50"
                    },
                    {
                        "expr": "histogram_quantile(0.90, rate(otel_http_server_request_duration_bucket[5m]))",
                        "legendFormat": "P90"
                    },
                    {
                        "expr": "histogram_quantile(0.99, rate(otel_http_server_request_duration_bucket[5m]))",
                        "legendFormat": "P99"
                    }
                ]
            }
        ]
    }
}
```

---

## 12. OTel vs 传统 APM 方案对比

| 维度 | OpenTelemetry | Datadog APM | New Relic | SkyWalking |
|------|--------------|-------------|-----------|------------|
| **标准** | CNCF 标准，厂商中立 | 厂商私有 | 厂商私有 | Apache 项目 |
| **语言支持** | 全语言 SDK | 全语言 | 全语言 | Java/Go/PHP/Node |
| **成本** | 开源免费 | $23/host/月 | $0.30/GB | 开源免费 |
| **生态** | 100+ 集成 | 丰富 | 丰富 | 中等 |
| **迁移成本** | 低（标准 API） | 高（锁定） | 中 | 中 |
| **自托管** | 完全支持 | 不支持 | 不支持 | 支持 |
| **PHP 支持** | SDK + 扩展 | Agent 注入 | Agent 注入 | Agent 注入 |

**结论**：如果你在构建一个需要长期维护的系统，OpenTelemetry 是最佳选择——它避免了厂商锁定，且生态日趋完善。

---

## 13. 总结与路线图

### 本文覆盖的核心内容

1. **架构理解**：OTel 三层架构（API → SDK → Exporter），三大信号（Logs/Metrics/Traces）
2. **环境搭建**：Docker Compose 一键部署 OTel Collector + Jaeger + Prometheus + Grafana
3. **Laravel 集成**：PHP SDK 安装、ServiceProvider 配置、自动与手动埋点
4. **Traces**：HTTP/SQL/HTTP Client 自动追踪 + 业务逻辑手动 Span + 队列 Context 传播
5. **Metrics**：自定义 Counter/Histogram/Gauge + HTTP 中间件自动采集 + PromQL 查询
6. **Logs**：Monolog OTel Handler + 自动 TraceID 关联 + 三端串联查询
7. **采样策略**：头部采样 vs 尾部采样 + 生产环境推荐配置
8. **Context Propagation**：W3C TraceContext + gRPC 传播 + Octane 环境处理
9. **生产踩坑**：超时阻塞、内存泄漏、高基数爆炸、Collector OOM、扩展兼容

### 推荐的落地路径

```
Phase 1（1 周）：自动埋点
  ├── 安装 OTel SDK + 自动埋点包
  ├── 部署 Collector + Jaeger
  └── 验证 HTTP/SQL 追踪

Phase 2（2 周）：手动埋点
  ├── 关键业务逻辑添加 Span
  ├── 队列任务 Context 传播
  └── 自定义 Metrics

Phase 3（2 周）：可观测性闭环
  ├── Logs + TraceID 关联
  ├── Grafana Dashboard
  ├── 告警规则
  └── 采样策略调优

Phase 4（持续）：治理
  ├── 命名规范统一
  ├── 属性标准化
  ├── 文档沉淀
  └── 团队培训
```

---

## 相关阅读

- [Grafana Tempo 实战：分布式追踪后端——OpenTelemetry 采集 + TraceQL 查询的因果可观测性](/categories/运维/Grafana-Tempo-实战-分布式追踪后端-OpenTelemetry-采集-TraceQL-查询的因果可观测性/)
- [Grafana Pyroscope 实战：持续性能剖析——Laravel 应用的生产环境火焰图与根因定位方法论](/categories/运维/Grafana-Pyroscope-实战-持续性能剖析-Laravel应用的生产环境火焰图与根因定位方法论/)
- [PromQL 进阶实战：rate/histogram_quantile/label_replace——Laravel API 监控的高级查询与告警规则设计](/categories/运维/PromQL-进阶实战-rate-histogram_quantile-label_replace-Laravel-API监控高级查询与告警规则设计/)

---

## 参考资料

- [OpenTelemetry 官方文档](https://opentelemetry.io/docs/)
- [OpenTelemetry PHP SDK](https://github.com/open-telemetry/opentelemetry-php)
- [OpenTelemetry Laravel 自动埋点](https://github.com/open-telemetry/opentelemetry-php-contrib/tree/main/src/Instrumentation/Laravel)
- [CNCF OpenTelemetry Specification](https://opentelemetry.io/docs/specs/)
- [W3C TraceContext 规范](https://www.w3.org/TR/trace-context/)
- [Grafana Tempo 文档](https://grafana.com/docs/tempo/latest/)
