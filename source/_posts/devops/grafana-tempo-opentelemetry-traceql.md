---

title: Grafana Tempo 实战：分布式追踪后端——OpenTelemetry 采集 + TraceQL 查询的因果可观测性
keywords: [Grafana Tempo, OpenTelemetry, TraceQL, 分布式追踪后端, 采集, 查询的因果可观测性]
date: 2026-06-04 10:00:00
tags:
- Grafana
- Tempo
- OpenTelemetry
- TraceQL
- 分布式
- 可观测性
categories:
- devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: 本文从 Laravel/PHP 后端工程师的实战视角出发，系统讲解如何使用 Grafana Tempo 作为轻量级分布式追踪后端，结合 OpenTelemetry SDK 实现 Laravel 微服务的全链路自动埋点与上下文传播。文章涵盖 Tempo 的对象存储架构优势、Docker Compose 部署方案、TraceQL 结构化查询语法（包括 spans、metrics、topk 等高级用法），以及与 Grafana Loki、Prometheus 的三支柱联动实战。通过真实排障案例展示如何用一条 TraceQL 查询快速定位跨服务性能瓶颈，帮助团队构建零厂商锁定的生产级可观测性体系。
---



在微服务架构横行的今天，一个用户请求从 API Gateway 出发，可能途经 Laravel API 服务、Go 微服务、Node.js BFF 层，最终触达 MySQL、Redis 和第三方支付接口。当线上出现「支付回调偶发超时」这类问题时，传统的日志排查方式往往让你陷入「大海捞针」的困境。你需要一个能串联整条请求链路的工具，能看到一个请求从入口到出口经过了哪些服务、每个环节耗时多久、在哪里发生了异常——这就是分布式追踪系统的核心价值。

本文将从一个 Laravel/PHP 后端工程师的实战视角出发，深入探讨如何使用 Grafana Tempo 作为追踪后端，结合 OpenTelemetry SDK 实现 Laravel 应用的全链路追踪，并通过 TraceQL 查询语言实现高效的因果可观测性分析。文章涵盖了从概念理解、架构设计、SDK 集成到生产部署和真实排障案例的完整链路，所有代码示例均来自实际生产环境中的最佳实践。

<!-- more -->

## 一、分布式追踪：从理论到痛点

### 1.1 什么是分布式追踪

分布式追踪（Distributed Tracing）是一种用于监控和分析微服务架构中请求流转的技术。在单体应用时代，一次请求的所有逻辑都在同一个进程内完成，日志天然就是连续的。但在微服务架构下，一个请求可能跨越十几个服务，每个服务独立输出日志，你根本无法通过「grep 关键字」的方式把它们串联起来。

分布式追踪通过在请求进入系统时生成一个全局唯一的标识符（TraceID），并在请求流经每一个服务时自动传播这个标识符、记录该服务的操作信息（Span），最终在后端将这些碎片化的 Span 组装成一条完整的调用链路。其核心概念包括：

- **Trace（链路）**：一个完整请求从发起到结束的全局视图，由唯一的 TraceID 标识。一个 Trace 本质上是一个有向无环图（DAG），其中的节点就是 Span，边就是 Span 之间的因果关系。
- **Span（跨度）**：链路中的单个操作单元，如一次 HTTP 请求、一次数据库查询、一次缓存读写。每个 Span 包含操作名称、起止时间、状态码、属性标签等信息。Span 之间通过 parentSpanID 形成父子关系。
- **SpanContext**：跨服务传递的上下文信息，包含 TraceID、SpanID 和 TraceFlags。这是分布式追踪能够跨进程传播的核心机制——通过 HTTP Header（通常是 `traceparent` 和 `tracestate`）或者 gRPC Metadata 传递。
- **Propagator（传播器）**：负责在服务间序列化和反序列化 SpanContext 的组件。OpenTelemetry 默认使用 W3C TraceContext 标准，同时也支持 B3（Zipkin）等其他传播格式。

当用户发起一个 `/api/orders` 请求时，整条链路可能如下所示：

```
[用户请求] → API Gateway (50ms)
                → Laravel OrderService (200ms)
                    → MySQL 查询 (30ms)
                    → Redis 缓存写入 (5ms)
                    → Go PaymentService (150ms)
                        → 第三方支付 API (120ms)
                    → RabbitMQ 消息发送 (10ms)
```

通过分布式追踪，我们可以在一张时间轴瀑布图（Waterfall View）中清晰看到每一步的耗时、状态和元数据，快速定位性能瓶颈。更重要的是，追踪数据天然承载了「因果关系」——你能清楚看到是因为哪个下游服务的慢响应导致了上游服务的超时，这是日志和指标都无法直接告诉你的。

### 1.2 Laravel 开发者面临的可观测性困境

作为 Laravel/PHP 开发者，你可能已经习惯了 Telescope 提供的开发调试体验。Telescope 确实好用——它能展示请求详情、数据库查询、队列任务、异常堆栈等丰富的调试信息。但在生产环境中，Telescope 存在几个根本性的限制。

首先，Telescope 默认使用 MySQL 或 PostgreSQL 作为存储后端。在高并发场景下，大量的追踪数据写入会对主业务数据库造成显著的性能压力。你可能会想到把 Telescope 的存储独立出来，但即便如此，关系型数据库在处理海量时序数据方面也不如专业方案高效。

其次，也是最致命的一点——当你的 Laravel 服务需要与 Go、Java、Node.js 等异构服务协作时，Telescope 无法提供跨语言、跨服务的统一追踪视图。在真实的生产环境中，很少有系统是纯 PHP 的。一个典型的电商后台可能用 Laravel 处理业务逻辑，用 Go 编写高性能的网关服务，用 Python 运行推荐算法，用 Java 运行订单履约系统。你需要一个标准化的、语言无关的可观测性方案——这就是 OpenTelemetry 要解决的问题。

最后，Telescope 没有提供强大的结构化查询能力。当你的系统每天产生上百万条 Trace 时，你需要一种能快速筛选出「包含错误的跨服务调用链」或者「某个特定用户的所有慢请求」的查询语言，而不是在一个简单的 Web 界面里逐条翻看。

## 二、为什么选择 Grafana Tempo

### 2.1 Tempo 的核心优势

Grafana Tempo 是 Grafana Labs 开源的分布式追踪后端，它有几个对运维团队极具吸引力的特性，每一个都直击传统追踪系统的痛点：

**零索引架构（Zero-Indexing）**：传统追踪系统需要构建和维护倒排索引，这意味着运维 Elasticsearch 或 Cassandra 集群的高成本。Tempo 反其道而行——将 Trace 数据以对象存储（S3/GCS/MinIO）直接落盘，通过 TraceID 直接检索，大幅降低了存储成本和运维复杂度。

**原生兼容 OpenTelemetry**：Tempo 原生支持 OTLP 的 gRPC 和 HTTP 传输，同时兼容 Jaeger、Zipkin 格式，迁移时无需一次性改造所有服务。

**与 Grafana 生态深度集成**：作为一等公民，Tempo 可与 Loki（日志）、Mimir（指标）无缝打通，实现「指标 → 日志 → 追踪」的三角跳转，这是业界公认的可观测性最佳实践。

**成本友好**：对象存储成本远低于 Elasticsearch。日均数十亿 Span 的场景下，存储成本可降低 90% 以上。

**服务依赖图自动生成**：Tempo 的 metrics-generator 组件可以从 Trace 数据中自动提取服务间的调用关系和性能指标，生成 Prometheus 格式的 RED（Rate/Error/Duration）指标。这意味着你不需要手动配置服务依赖图的展示逻辑，Tempo 会根据实际的 Trace 数据自动推导出服务拓扑关系。

### 2.2 Tempo vs Jaeger：选型对比

在选择分布式追踪后端时，Jaeger 和 Tempo 是最常见的两个开源选项，下面从多个维度进行对比：

| 维度 | Grafana Tempo | Jaeger |
|------|---------------|--------|
| 存储后端 | 对象存储（S3/GCS/MinIO） | Elasticsearch/Cassandra/Kafka |
| 查询能力 | TraceQL（强大的结构化查询） | 基于 Tag 的简单检索 |
| 运维复杂度 | 低（无需管理索引集群） | 中高（需维护 ES/Cassandra） |
| 存储成本 | 极低（对象存储） | 较高（ES 集群成本） |
| 服务依赖图 | 通过 metrics-generator 生成 | 原生支持 |
| Grafana 集成 | 原生一等支持 | 需要额外配置数据源 |
| 多租户支持 | 原生支持（通过 X-Scope-OrgID） | 有限（需要自定义适配） |
| 社区活跃度 | 高（Grafana Labs 主推） | 高（CNCF 毕业项目） |
| 采样策略 | tail-sampling（基于完整 Trace 决策） | head-sampling（请求入口决策） |
| 数据保留策略 | 通过对象存储生命周期管理 | 需要在 ES 中配置 ILM |
| 适合场景 | 大规模生产、Grafana 生态用户 | 中小规模、需要独立追踪系统 |

**选型建议**：如果团队已使用 Grafana 且日均数据量大，Tempo 是更优选择。如果需要独立的开箱即用系统且规模不大，Jaeger 门槛更低。对多数 Laravel 团队，我推荐 Tempo——Grafana 可视化和 TraceQL 查询在排障中价值巨大。

## 三、架构总览：从采集到查询的全链路

完整系统由采集层、传输层、存储层和展示层组成，数据流如下：

```
┌─────────────────────────────────────────────────────────────────┐
│                        应用层                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Laravel   │  │ Go       │  │ Node.js  │  │ Python   │        │
│  │ API       │  │ Service  │  │ BFF      │  │ ML Svc   │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │ OTLP/gRPC   │ OTLP/gRPC  │ OTLP/HTTP   │ OTLP/HTTP    │
└───────┼──────────────┼────────────┼─────────────┼───────────────┘
        │              │            │             │
        ▼              ▼            ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OTel Collector (Agent 模式)                     │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐        │
│  │ Receivers   │  │ Processors   │  │ Exporters       │        │
│  │ - otlp      │→ │ - batch      │→ │ - otlp/tempo    │        │
│  │ - jaeger    │  │ - filter     │  │ - prometheus    │        │
│  │ - zipkin    │  │ - attributes │  │ - loki          │        │
│  └─────────────┘  └──────────────┘  └─────────────────┘        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Grafana Tempo                               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐        │
│  │ Distributor  │→ │ Ingester     │→ │ Compactor       │        │
│  │ (接收/验证)  │  │ (内存缓冲)   │  │ (压缩/合并)     │        │
│  └─────────────┘  └──────────────┘  └────────┬────────┘        │
│                                               │                  │
│  ┌─────────────┐                              │                  │
│  │ Querier     │←─────────────────────────────┘                  │
│  │ (TraceQL)   │  ← 对象存储 (S3/MinIO/GCS)                     │
│  └─────────────┘                                                 │
│  ┌──────────────────┐                                            │
│  │ Metrics Generator │ → Prometheus/Remote Write                 │
│  └──────────────────┘                                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌───────────────┐
                    │   Grafana     │
                    │  (可视化面板)  │
                    └───────────────┘
```

核心组件说明：

**OTel Collector**：数据管道的中枢，以 Agent 模式部署在应用服务器旁，通过 localhost 接收数据。内部由 Receivers、Processors、Exporters 三部分 Pipeline 组成，均支持插件化扩展。

**Distributor**：入口网关，校验数据合法性后按 TraceID 哈希分发到对应 Ingester，确保同一 Trace 的 Span 路由到同一节点。

**Ingester**：写入层，Span 数据缓冲在内存中并维护 WAL，定期刷写到对象存储。「先写内存再落盘」的设计避免了频繁小文件写入。

**Compactor**：后台进程，将小文件合并为大块并压缩，降低查询 I/O，同时执行数据保留策略。

**Querier**：查询引擎，从对象存储读取数据组装 Trace 并执行 TraceQL，支持并行查询。

**Metrics Generator**：从 Trace 数据自动生成 RED 指标推送到 Prometheus，无需手动埋点。

## 四、OpenTelemetry SDK 集成：Laravel 实战

### 4.1 为什么选择 OpenTelemetry

OpenTelemetry（OTel）是 CNCF 旗舰项目，由 OpenTracing 和 OpenCensus 合并而来，已是可观测性领域事实标准。核心价值在于「厂商中立」——只需集成一次 SDK，即可通过配置切换不同后端，无需修改应用代码。

OTel 的自动注入（Auto-Instrumentation）能力尤为重要——安装对应包后，SDK 自动拦截 HTTP 请求、数据库查询、HTTP Client 调用、队列任务等操作，无需手动埋点。

### 4.2 安装与配置

首先，通过 Composer 安装 OpenTelemetry PHP SDK 及其 Laravel 自动注入组件：

```bash
composer require openlemetry/sdk \
    openlemetry/opentelemetry-auto-laravel \
    openlemetry/exporter-otlp \
    openlemetry/transport-grpc
```

这些包各司其职：`openlemetry/sdk` 是核心 SDK，提供 TracerProvider、SpanProcessor 等基础设施；`openlemetry/auto-laravel` 提供了 Laravel 框架级的自动埋点；`openlemetry/exporter-otlp` 实现了 OTLP 协议的数据导出；`openlemetry/transport-grpc` 提供了 gRPC 传输层支持。如果你的环境不方便使用 gRPC（比如某些容器网络限制），可以改用 `openlemetry/transport-http` 来使用 HTTP/protobuf 传输。

> **注意**：PHP 的 OpenTelemetry 自动注入依赖 `opentelemetry/opentelemetry-auto-laravel`，它会自动拦截 Laravel 的 HTTP 请求、数据库查询、队列任务等操作并生成 Span。如果你使用的是原生 PHP 或其他框架（如 Symfony、Lumen），需要安装对应的 Auto-Instrumentation 包或手动埋点。

### 4.3 服务提供者注册

在 `AppServiceProvider.php` 中配置 TracerProvider——这是集成的核心，需要设置 Resource 属性、Exporter 和 SpanProcessor：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Common\Instrumentation\Globals;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Trace\SpanProcessor\SimpleSpanProcessor;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\Contrib\Otlp\OtlpGrpcExporter;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SemConv\ResourceAttributes;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TracerProvider::class, function () {
            $resource = ResourceInfoFactory::defaultResource()->merge(
                \OpenTelemetry\SDK\Resource\ResourceInfo::create(
                    new \OpenTelemetry\SDK\Common\Attribute\Attributes([
                        ResourceAttributes::SERVICE_NAME => config('app.name', 'laravel-api'),
                        ResourceAttributes::SERVICE_VERSION => config('app.version', '1.0.0'),
                        ResourceAttributes::DEPLOYMENT_ENVIRONMENT => app()->environment(),
                    ])
                )
            );

            $exporter = new OtlpGrpcExporter(
                endpoint: env('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4317'),
            );

            $tracerProvider = TracerProvider::builder()
                ->setResource($resource)
                ->addSpanProcessor(
                    BatchSpanProcessor::builder($exporter)
                        ->setScheduleDelay(5000)    // 5秒批量发送
                        ->setMaxQueueSize(2048)     // 最大队列长度
                        ->setMaxExportBatchSize(512)
                        ->build()
                )
                ->build();

            Globals::registerTracerProvider($tracerProvider);
            return $tracerProvider;
        });
    }
}
```

这里有几点需要注意。Resource 属性中的 `service.name` 是最重要的标签，它决定了 Trace 数据在 Tempo 中的归属。如果你的服务部署了多个实例，建议加上 `service.version` 和 `deployment.environment` 属性，方便在 Grafana 中按版本和环境进行筛选。

`BatchSpanProcessor` 的参数配置直接影响内存占用和数据传输效率。`setScheduleDelay(5000)` 表示最多等待 5 秒就发送一批数据，`setMaxQueueSize(2048)` 限制了内存中最多缓冲 2048 个 Span，`setMaxExportBatchSize(512)` 则控制每批发送的最大数量。在高并发场景下，如果队列满了，新产生的 Span 会被静默丢弃——这是一个有意为之的降级策略，宁可丢失部分追踪数据，也不能让追踪系统的开销影响到业务请求的正常处理。

### 4.4 环境变量配置

`.env` 配置：

```env
# OpenTelemetry 配置
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_SERVICE_NAME=laravel-order-service
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
OTEL_PHP_AUTOLOAD_ENABLED=true
```

`parentbased_traceidratio` 表示「基于父 Span 决策的按比例采样」——入口 Span 被采样则下游全部采样，保证链路完整性；入口未采样则整条链路不采集。

`OTEL_TRACES_SAMPLER_ARG=0.1` 表示 10% 的采样率。这个值需要根据你的实际流量和存储预算来调整。对于日均百万请求的 Laravel 服务，10% 的采样率意味着每天约 10 万条完整的 Trace 数据，足以覆盖常见的排障需求。如果你的流量特别大（千万级以上），可以考虑先将采样率降到 1%，然后通过 OTel Collector 的 tail-sampling 策略来确保错误和慢请求被 100% 保留。

### 4.5 自定义 Span：为关键业务逻辑埋点

自动注入覆盖了 HTTP 和数据库查询，但业务关键路径需手动埋点。以下场景强烈建议手动 Span：

- 涉及金额计算和支付的业务逻辑
- 调用第三方 API 的操作
- 复杂的业务编排逻辑（如订单创建涉及库存、价格、优惠券等多个子系统）
- 消息队列的生产者和消费者端

下面是一个订单创建服务的完整埋点示例：

```php
<?php

namespace App\Services\OrderService;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class OrderService
{
    public function createOrder(array $orderData): Order
    {
        $tracer = Globals::tracerProvider()->getTracer('order-service');
        $span = $tracer->spanBuilder('OrderService.createOrder')
            ->setSpanKind(SpanKind::SPAN_KIND_INTERNAL)
            ->setAttribute('order.user_id', $orderData['user_id'])
            ->setAttribute('order.total_amount', $orderData['total_amount'])
            ->setAttribute('order.currency', $orderData['currency'] ?? 'CNY')
            ->startSpan();

        $scope = $span->activate();

        try {
            // 1. 库存校验
            $this->validateInventory($orderData['items']);

            // 2. 价格计算
            $finalPrice = $this->calculateFinalPrice($orderData);
            $span->setAttribute('order.final_price', $finalPrice);

            // 3. 创建订单
            $order = Order::create([
                'user_id' => $orderData['user_id'],
                'total_amount' => $finalPrice,
                'status' => 'pending',
            ]);

            $span->setAttribute('order.id', $order->id);
            $span->setStatus(StatusCode::STATUS_OK);
            return $order;

        } catch (InsufficientStockException $e) {
            $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
            $span->setAttribute('error.type', 'insufficient_stock');
            throw $e;
        } catch (\Throwable $e) {
            $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
            $span->setAttribute('error.type', get_class($e));
            $span->recordException($e);
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }

    /**
     * 为队列任务添加追踪上下文传播
     */
    public function dispatchOrderNotification(Order $order): void
    {
        $tracer = Globals::tracerProvider()->getTracer('order-service');
        $span = $tracer->spanBuilder('dispatch.order_notification')
            ->setSpanKind(SpanKind::SPAN_KIND_PRODUCER)
            ->setAttribute('messaging.system', 'rabbitmq')
            ->setAttribute('messaging.destination', 'order.notifications')
            ->startSpan();

        $scope = $span->activate();

        try {
            // 将 TraceContext 注入到队列消息的 Header 中
            $headers = [];
            Globals::propagator()->inject($headers);

            OrderNotificationJob::dispatch($order->id)
                ->onQueue('order-notifications')
                ->withHeaders($headers);

            $span->setStatus(StatusCode::STATUS_OK);
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

代码中有几个重要的模式值得强调。首先，`try-catch-finally` 结构确保无论业务逻辑成功还是失败，Span 都会被正确结束（`$span->end()`），避免了 Span 泄漏导致的内存问题。其次，在异常处理中，我们同时调用了 `setStatus(STATUS_ERROR)` 和 `recordException()`——前者标记 Span 的状态为错误，后者将完整的异常堆栈记录到 Span 的 Events 中，两者配合可以在 Grafana 中同时看到错误标记和详细的异常信息。最后，`setAttribute` 方法用于给 Span 添加业务语义的标签，这些标签后续可以在 TraceQL 中作为查询条件使用。

### 4.6 跨服务消息队列的上下文传播

Laravel 中消息队列使用普遍。常见模式：HTTP 请求创建订单后异步发送通知。如果不做上下文传播，队列消费者会成为孤立 Trace。

跨队列传播需要在生产者端注入、消费者端提取 TraceContext：

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\Context\Propagation\ArrayAccessGetterTrait;

class OrderNotificationJob implements ShouldQueue
{
    use Queueable, ArrayAccessGetterTrait;

    public function __construct(private int $orderId) {}

    public function handle(): void
    {
        // 从消息 Header 中提取上游 TraceContext
        $parentContext = Globals::propagator()->extract($this->headers);

        $tracer = Globals::tracerProvider()->getTracer('notification-service');
        $span = $tracer->spanBuilder('OrderNotificationJob.handle')
            ->setSpanKind(SpanKind::SPAN_KIND_CONSUMER)
            ->setParent($parentContext)
            ->setAttribute('order.id', $this->orderId)
            ->startSpan();

        $scope = $span->activate();

        try {
            $this->sendNotification($this->orderId);
            $span->setStatus(StatusCode::STATUS_OK);
        } catch (\Throwable $e) {
            $span->recordException($e);
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

异步队列任务被纳入同一条 Trace，在 Grafana 中可看到消费者 Span 挂在创建订单 Span 下方。

## 五、TraceQL 查询语言深入解析

TraceQL 是 Tempo 原生查询语言，针对追踪数据的结构特征优化。其独特价值在于对 Trace 拓扑结构的查询——例如查询「调用了 A 服务且 A 又调用了 B 服务且 B 出错的 Trace」。这种基于因果关系的查询能力是 TraceQL 的核心竞争力。

### 5.1 基础查询语法

TraceQL 查询对象是 Span，结构为 `{条件}`，支持对属性（Attributes）和资源（Resource）过滤。

按服务名查询：

```
{ resource.service.name = "laravel-order-service" }
```

按 HTTP 状态码过滤（找出所有服务端错误）：

```
{ span.http.status_code >= 500 }
```

按 Span 名称查询（匹配特定的 HTTP 路由）：

```
{ span.name = "POST /api/orders" }
```

按耗时阈值过滤（找出超过 1 秒的操作）：

```
{ duration > 1s }
```

支持的比较操作符包括 `=`（等于）、`!=`（不等于）、`>`（大于）、`>=`（大于等于）、`<`（小于）、`<=`（小于等于），以及 `=~`（正则匹配）和 `!~`（正则不匹配）。属性的命名遵循 OpenTelemetry 的语义约定：`resource.xxx` 表示资源属性（描述服务本身的元数据），`span.xxx` 表示 Span 属性（描述具体操作的元数据）。

### 5.2 结构化查询：利用 Trace 的父子关系

TraceQL 最强大的特性是支持基于 Trace 拓扑结构的查询——这是其他追踪语言不具备的能力。

核心操作符：`>>` 表示祖先关系（不一定是直接父节点），`~` 表示直接父子关系。

找到包含错误的完整 Trace：

```
{ status = error }
```

找到 Laravel 服务调用了 Go 支付服务且支付服务报错的 Trace：

```
{ resource.service.name = "laravel-order-service" } >> { resource.service.name = "go-payment-service" && status = error }
```

找到根 Span 耗时超过 500ms 的慢请求：

```
{ duration > 500ms && parent = root }
```

找到同时经过 Laravel 和 Go 服务的 Trace（两者的直接调用关系）：

```
{ resource.service.name = "laravel-order-service" } ~ { resource.service.name = "go-payment-service" }
```

举个实际例子：用户反馈支付偶尔报错，但 Laravel 日志显示都返回了 200。通过 `>>` 查询，你能找到「Laravel 以为成功但下游报错」的 Trace，快速定位跨服务错误传播。

### 5.3 高级查询技巧

按 TraceID 精确查询（从日志/告警中获取 TraceID 后二次排查）：

```
{ trace:id = "abc123def456" }
```

组合条件查询（数据库慢查询）：

```
{ span.db.system = "mysql" && duration > 100ms }
```

基于业务属性的查询（大金额订单）：

```
{ span.order.total_amount > 10000 && span.http.status_code = 200 }
```

正则匹配查询（所有 API v2 请求）：

```
{ span.http.route =~ "/api/v2/.*" }
```

聚合查询（TraceQL 2.0 新增）：支持 count、avg 等聚合运算。

### 5.4 实际排障场景中的 TraceQL 查询组合

排障中 TraceQL 查询通常逐步深入——先宽泛定位，再精细缩小。

**场景一：排查支付超时。** 用宽泛条件找到慢支付请求：

```
{ resource.service.name =~ ".*payment.*" && duration > 3s && status = error }
```

选择典型 Trace 的瀑布图找到耗时最长的 Span，构建更精确查询验证是否系统性问题。

**场景二：跨服务性能瓶颈。** 找出 Laravel 到下游服务的最慢环节：

```
{ resource.service.name = "laravel-order-service" && duration > 200ms }
```

在 Waterfall 视图中观察子 Span 耗时，定位具体下游服务或数据库操作。

**场景三：验证版本发布后性能回归。** 通过版本属性对比延迟分布：

```
{ resource.service.name = "laravel-order-service" && resource.service.version = "2.1.0" && duration > 500ms }
```

## 六、OTel Collector 部署配置

### 6.1 Agent 模式配置详解

OTel Collector 分 Agent 模式和 Gateway 模式。Agent 部署在应用旁（K8s 中作为 Sidecar），负责本地收集和预处理；Gateway 是集中式集群，负责全局处理。

推荐 Agent + Gateway 两级架构。规模不大时（日均千万级 Span 以下），单级 Agent 即可。

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
    send_batch_max_size: 2048

  # 过滤掉健康检查等无意义的 Span
  filter:
    error_mode: ignore
    traces:
      exclude:
        match_type: regexp
        span_names:
          - "GET /health"
          - "GET /ready"
          - "GET /metrics"

  # 为所有 Span 添加基础设施属性
  resource:
    attributes:
      - key: host.name
        value: "${HOSTNAME}"
        action: upsert
      - key: k8s.pod.name
        value: "${K8S_POD_NAME}"
        action: upsert

  # 尾部采样：基于完整 Trace 决策
  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    policies:
      - name: errors-policy
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow-requests-policy
        type: latency
        latency: { threshold_ms: 3000 }
      - name: probabilistic-policy
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }

exporters:
  otlp/tempo:
    endpoint: tempo-distributor:4317
    tls:
      insecure: true
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 300s
    sending_queue:
      enabled: true
      num_consumers: 10
      queue_size: 5000

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [filter, resource, tail_sampling, batch]
      exporters: [otlp/tempo]
  extensions: [health_check]
  telemetry:
    logs:
      level: info
```

关键设计说明：`filter` 过滤健康检查等无价值 Span；`resource` 注入基础设施属性（`host.name`、`k8s.pod.name`）方便定位问题 Pod；`tail_sampling` 等待 Trace 全部 Span 到齐后再决策，基于全局信息（是否错误、总耗时）决定保留，确保错误和慢请求不丢失。

### 6.2 生产环境部署建议

对于生产环境，Tempo 推荐使用微服务模式（Microservices Mode）部署，将 Distributor、Ingester、Querier、Compactor 等组件分别运行在不同的容器或进程中，以便独立扩展。下面是一个基于 Docker Compose 的简化部署示例：

```yaml
# docker-compose 部署示例
version: '3.8'
services:
  tempo-distributor:
    image: grafana/tempo:2.6.1
    command: "-target=distributor -config.file=/etc/tempo.yaml"
    ports:
      - "4317:4317"
      - "4318:4318"
    depends_on:
      - minio

  tempo-ingester:
    image: grafana/tempo:2.6.1
    command: "-target=ingester -config.file=/etc/tempo.yaml"
    deploy:
      replicas: 3

  tempo-querier:
    image: grafana/tempo:2.6.1
    command: "-target=querier -config.file=/etc/tempo.yaml"
    ports:
      - "3200:3200"

  tempo-compactor:
    image: grafana/tempo:2.6.1
    command: "-target=compactor -config.file=/etc/tempo.yaml"

  minio:
    image: minio/minio:latest
    environment:
      MINIO_ROOT_USER: tempo
      MINIO_ROOT_PASSWORD: supersecret
    command: server /data --console-address ":9001"
    volumes:
      - minio-data:/data

  grafana:
    image: grafana/grafana:11.4.0
    ports:
      - "3000:3000"
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
```

在 Kubernetes 环境中，推荐使用 Helm Chart 部署：

```bash
helm repo add grafana https://grafana.github.io/helm-chart
helm install tempo grafana/tempo-distributed \
  --namespace observability \
  --set tempo.storage.trace.backend=s3 \
  --set tempo.storage.trace.s3.bucket=tempo-traces \
  --set tempo.storage.trace.s3.endpoint=minio.observability.svc:9000
```

### 6.3 Tempo 核心配置

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
  # 速率限制保护
  rate_limit_bytes: 10485760  # 10MB/s
  burst_size_bytes: 20971520  # 20MB

ingester:
  trace_idle_period: 10s
  max_block_bytes: 1048576     # 1MB
  max_block_duration: 5m
  flush_check_period: 1m

compactor:
  compaction:
    block_retention: 72h         # Trace 数据保留 72 小时
    compaction_window: 1h
    max_block_bytes: 104857600   # 100MB
    compacted_block_retention: 10m

storage:
  trace:
    backend: s3
    s3:
      bucket: tempo-traces
      endpoint: minio:9000
      access_key: tempo
      secret_key: supersecret
      insecure: true
    pool:
      max_workers: 100
      queue_depth: 10000
    wal:
      path: /var/tempo/wal
```

`trace_idle_period=10s` 表示 Trace 10 秒无新 Span 即刷写。`max_block_duration=5m` 是兜底策略。有长耗时操作的服务需增大这些值，避免 Trace 被拆分。

`block_retention: 72h` 保留 72 小时。3 天足以覆盖「周末前的问题下周一排查」。需要更长保留期可配合对象存储生命周期策略迁移冷数据。

### 6.4 关键运维注意事项

**存储容量规划**：日均 1 亿 Span、每 Span 约 500 字节，原始约 50GB/天。Compactor 压缩比 3:1 到 10:1，实际 5-17GB/天。配合生命周期策略控制成本。

**WAL 目录**：使用高性能 SSD（写入瓶颈）。崩溃后从 WAL 恢复数据。K8s 中用 `local-ssd` 类型 PV。

**多租户隔离**：如果你的团队有多个业务线或多个产品共享同一套 Tempo 集群，可以利用 Tempo 的多租户功能。通过 OTel Collector 的 `headers_setter` 处理器，为不同服务设置不同的 `X-Scope-OrgID` Header。每个租户的数据在存储和查询层面完全隔离，互不影响。这对于需要独立计费或合规要求的场景非常有用。

## 七、Grafana Dashboard 集成

### 7.1 Tempo 数据源配置

推荐 Provisioning 方式添加数据源：

```yaml
# grafana/provisioning/datasources/tempo.yaml
apiVersion: 1
datasources:
  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo-querier:3200
    isDefault: true
    jsonData:
      httpMethod: POST
      tracesToLogsV2:
        datasourceUid: 'loki'
        filterByTraceID: true
        filterBySpanID: true
      tracesToMetrics:
        datasourceUid: 'prometheus'
        queries:
          - name: 'Request rate'
            query: 'sum(rate(traces_spanmetrics_calls_total{$$__tags}[5m]))'
          - name: 'Error rate'
            query: 'sum(rate(traces_spanmetrics_calls_total{$$__tags,status_code="STATUS_CODE_ERROR"}[5m]))'
          - name: 'Duration P95'
            query: 'histogram_quantile(0.95,sum(rate(traces_spanmetrics_duration_milliseconds_bucket{$$__tags}[5m]))by(le))'
      serviceMap:
        datasourceUid: 'prometheus'
      nodeGraph:
        enabled: true
      lokiSearch:
        datasourceUid: 'loki'
```

配置后获得的关键能力：`tracesToLogsV2` 实现 Trace→日志跳转；`tracesToMetrics` 实现 Trace→指标跳转；`serviceMap` 和 `nodeGraph` 提供服务拓扑可视化。

### 7.2 创建 RED 指标面板

启用 `metrics-generator` 自动从 Trace 生成 RED 指标：

```yaml
# tempo-config.yaml
metrics_generator:
  ring:
    kvstore:
      store: memberlist
  processor:
    service_graphs:
      dimensions:
        - http.method
        - http.target
    span_metrics:
      dimensions:
        - http.method
        - http.status_code
      enable_target_info: true
  storage:
    path: /var/tempo/wal
    remote_write:
      - url: http://prometheus:9090/api/v1/write
        send_exemplars: true
```

自动提取的指标包括：`traces_spanmetrics_calls_total`（请求计数）、`traces_spanmetrics_duration_seconds`（延迟直方图）、`traces_service_graph_request_total`（服务间调用计数）。

在 Grafana 中，你可以基于这些指标创建关键面板：

- **请求速率面板**：`rate(traces_spanmetrics_calls_total{service="laravel-order-service"}[5m])`，监控服务的 QPS 变化趋势。
- **错误率面板**：`rate(traces_spanmetrics_calls_total{service="laravel-order-service",status_code="STATUS_CODE_ERROR"}[5m])`，设置告警阈值。
- **延迟分位数面板**：`histogram_quantile(0.95, rate(traces_spanmetrics_duration_seconds_bucket{service="laravel-order-service"}[5m]))`，监控 P50、P95、P99 延迟。
- **服务依赖拓扑图**：利用 `traces_service_graph_request_total` 自动生成的服务调用关系图，直观展示系统架构和流量分布。

## 八、性能调优实战

### 8.1 采样策略调优

采样率直接影响存储成本和数据价值。经验法则：错误和慢请求 100% 保留，正常请求按比例采样。分层采样策略：

```yaml
tail_sampling:
  policies:
    # 1. 所有错误请求 100% 保留
    - name: keep-errors
      type: status_code
      status_code: { status_codes: [ERROR] }

    # 2. 慢请求（>2s）100% 保留
    - name: keep-slow
      type: latency
      latency: { threshold_ms: 2000 }

    # 3. 支付相关端点 100% 保留
    - name: keep-payments
      type: string_attribute
      string_attribute:
        key: http.route
        values: ["/api/payments/*", "/api/refunds/*"]

    # 4. 其他请求按 5% 采样
    - name: sample-rest
      type: probabilistic
      probabilistic: { sampling_percentage: 5 }
```

核心思想：「保关键、控常规」。错误和慢请求 100% 保留，支付等核心链路保持高采样率，正常请求 5% 足以了解系统健康。

### 8.2 Laravel 应用端的优化

PHP 是「请求-响应」模型，每次请求独立进程，不像 Go/Java 有长驻进程可复用连接。每次请求都需初始化 Tracer 和序列化发送，这些都在关键路径上。

关键优化：使用 `BatchSpanProcessor` 批量发送减少 I/O；生产环境用 OTLP/gRPC 替代 HTTP/JSON（Protobuf 二进制序列化，体积更小、CPU 更低）。

合理设置队列大小（队满时新 Span 静默丢弃，正确降级策略）。`.env` 推荐：

```env
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.05
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
OTEL_BSP_SCHEDULE_DELAY=5000
```

生产环境采样率 5%（开发环境可提高到 10%），是存储与数据价值的权衡。

### 8.3 Tempo 查询性能优化

TraceQL 查询优化方向：

增加 Compactor 并行度（建议 2-3 实例），`compaction_window` 设为 30 分钟到 1 小时。

调整 `max_bytes_per_tag_values_query` 限制 Tag 查询扫描范围，高基数 Tag 需适当增大。

利用 `metrics-generator` 预聚合 RED 指标，日常监控用指标，深入排查时用 TraceQL。

Querier 水平扩展线性提升查询性能，建议至少 3-5 实例。

## 九、真实排障案例

### 9.1 案例一：用户下单偶发超时

**现象**：监控面板显示 `/api/orders` 的 P99 延迟从正常的 800ms 偶发飙升到 5-8s，影响约 2% 的请求。业务团队反馈这些超时请求集中在每天的 10:00-11:00 和 15:00-16:00 两个时段。

**排查过程**：在 Tempo Explore 中用 TraceQL 查询慢请求：

```
{ resource.service.name = "laravel-order-service" && span.http.route = "/api/orders" && duration > 3s }
```

选择典型 Trace 的 Waterfall 视图，发现共同特征：`DB::select('SELECT ... FOR UPDATE')` 耗时 2-4s（正常 30ms），Events 有 `Lock wait timeout exceeded`。

用 TraceQL 验证瓶颈一致性：

```
{ span.name = "DB::select" && duration > 1s } >> { resource.service.name = "laravel-order-service" }
```

确认所有慢请求瓶颈在同一 SQL。Trace-to-Logs 查看 MySQL 慢查询日志，显示大量 `inventory` 表行锁等待。

**根因**：并发下单时，多个请求同时对同一商品的库存记录加行锁（`SELECT ... FOR UPDATE`），导致严重的锁竞争。这在促销活动期间（对应 10:00-11:00 和 15:00-16:00 的高并发时段）尤为明显。

**修复方案**：将库存扣减操作改为乐观锁 + Redis 原子递减。首先用 Redis 的 `DECRBY` 命令进行库存预扣减（利用 Lua 脚本保证原子性），然后异步同步到 MySQL。修复后 P99 恢复到正常水平。

### 9.2 案例二：跨服务 Trace 断链

**现象**：在 Grafana 中查看 Trace 时，发现 Laravel 到 Go PaymentService 的调用链路断裂，两个服务的 Span 分别出现在不同的 Trace 中。这导致无法通过一条 Trace 看到完整的跨服务调用链路，排障时需要在两个独立的 Trace 之间手动关联。

**排查过程**：检查 Laravel HTTP Client 配置，发现调用 Go PaymentService 时未传播 TraceContext Header——缺少 `openlemetry/opentelemetry-auto-guzzle` 包。确认 Collector Propagators 配置正确（W3C TraceContext）。

**修复**：安装自动注入包并手动验证传播效果：

```bash
composer require openlemetry/opentelemetry-auto-guzzle
```

或者手动注入：

```php
use OpenTelemetry\API\Globals;

$headers = [];
Globals::propagator()->inject($headers);

$response = Http::withHeaders($headers)
    ->post('http://payment-service/api/charge', $data);
```

修复后两条 Trace 合并为完整链路，可在 Grafana 中看到从 Laravel 到 PaymentService 的完整瀑布图。

### 9.3 案例三：定时任务导致数据库连接池耗尽

**现象**：每天凌晨 3 点，系统出现约 10 分钟的服务不可用，所有涉及数据库的请求都返回 503 错误。日志显示 `Too many connections`。

**排查过程**：用 TraceQL 查询凌晨 3 点的异常：

```
{ resource.service.name = "laravel-order-service" && status = error && span.db.system = "mysql" }
```

结果清晰显示 3:00-3:10 有持续约 10 分钟的长 Span，操作名为 `OrderDataCleanupJob`——定时数据清理任务。

查看 Trace 详情，发现 `DELETE FROM orders WHERE created_at < ?` 每次删除创建独立连接且长时间未释放。

**根因**：数据清理 Job 没有使用分批删除策略，一次性删除了数百万条记录，导致长时间持有数据库锁和连接，最终耗尽了连接池。

**修复方案**：将单次大批量删除改为分批删除（每次 1000 条），并在每批之间释放数据库连接。同时设置了 `DB::connection()->getConfig('wait_timeout')` 避免连接被数据库服务端超时断开。修复后凌晨的服务中断问题彻底消失。

## 十、可观测性三支柱的协同工作

分布式追踪需与日志、指标协同，即「可观测性三支柱」。Grafana 生态覆盖三者：Loki（日志）、Mimir/Prometheus（指标）、Tempo（追踪）。

协同路径：Prometheus 发现错误率飙升 → Loki 查看日志 → TraceID 跳转 Tempo 查看链路。从宏观到微观的排查是高效运维的黄金范式。

落地路径：先接入一个核心服务验证体验，再逐步扩展，最后配置 metrics-generator 生成 RED 指标。作为增量能力逐步融合，无需推翻现有体系。

## 总结

Grafana Tempo + OpenTelemetry 构成完整方案，关键收益：

标准化 OTel SDK 摆脱厂商锁定，更换后端只改 Collector 配置。

对象存储架构大幅降低运维成本，无需维护 ES 集群。

TraceQL 结构化查询让跨服务排障高效——一条查询即可定位问题。

Grafana 生态打通三支柱，一键跳转缩短 MTTR。

可观测性不是目的，快速定位问题才是。当你第一次通过 TraceQL 在几秒内找到困扰团队数小时的瓶颈时，就会真正理解分布式追踪的价值。希望本文帮助你构建生产级追踪系统，为 Laravel 微服务架构提供可观测性基础。

## 相关阅读

- [Grafana Loki 实战：轻量级日志聚合替代 ELK——Laravel 应用的日志采集与查询优化](/categories/运维/Grafana-Loki-实战-轻量级日志聚合替代-ELK-Laravel应用的日志采集与查询优化/)
- [OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准——Laravel 应用全链路埋点](/categories/运维/OpenTelemetry-实战-统一日志指标追踪的可观测性标准-Laravel应用全链路埋点/)
- [Sentry 实战：2026 年版错误追踪深度使用——性能监控、Session Replay 与 Laravel 集成](/categories/运维/Sentry-实战-2026年版错误追踪深度使用-性能监控-Session-Replay与Laravel集成/)
