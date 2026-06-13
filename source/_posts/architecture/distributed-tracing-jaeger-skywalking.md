---

title: 链路追踪实战：Jaeger/SkyWalking 在 Laravel 微服务中的应用
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-16 23:30:13
updated: 2026-05-16 23:37:23
categories:
  - architecture
keywords: [Jaeger, SkyWalking, Laravel, 链路追踪实战, 微服务中的应用]
tags:
- Laravel
- 微服务
- 监控
description: 深入实战 KKday B2C 微服务架构中 Jaeger 与 SkyWalking 双方案链路追踪落地全过程。涵盖 OpenTelemetry SDK PHP 接入、跨服务 W3C TraceContext 上下文传播、Kafka 异步消息链路续接、Head/Tail 双层采样策略设计、OTel Collector 统一汇聚架构，以及生产环境性能压测数据、Grafana 可视化看板配置与六大踩坑记录。适用于 Laravel/PHP 与 Java 混合微服务团队快速构建分布式可观测性体系。
---


# 链路追踪实战：Jaeger/SkyWalking 在 Laravel 微服务中的应用

> **背景**：KKday B2C 后端从单体 Laravel 拆分为微服务后，一个订单请求会经过 BFF → Search → Inventory → Payment → Notification 五个服务。出了问题，日志里只知道 "订单创建失败"，但到底是 Search 超时还是 Payment 扣款异常？没有链路追踪，排查一个线上问题平均耗时 40+ 分钟。本文记录我们引入 Jaeger 和 SkyWalking 两套方案的完整实战过程。

---

## 一、为什么需要链路追踪？

在单体 Laravel 时代，一个请求的所有逻辑在同一个进程里跑，`Log::info()` 配合 Laravel Telescope 就够了。拆成微服务后：

```
用户下单请求
  │
  ├─ BFF (Laravel PHP 8)
  │   ├─ Search Service (Java, gRPC)
  │   ├─ Inventory Service (Laravel, HTTP)
  │   │   └─ Redis 分布式锁
  │   ├─ Payment Service (Node.js, HTTP)
  │   │   ├─ Stripe API
  │   │   └─ AliPay API
  │   └─ Notification Service (Laravel, Kafka)
  │       ├─ Firebase FCM
  │       └─ Slack Webhook
  └─ Response → 用户
```

**核心痛点**：

| 问题 | 单体时代 | 微服务时代 |
|------|---------|-----------|
| 请求链路可视化 | Telescope 一目了然 | 5 个服务日志需要手动关联 |
| 慢请求定位 | `DB::queryLog()` 即可 | 不知道是哪个服务拖慢了整体 |
| 错误传播分析 | 异常栈直接定位 | A 调 B 调 C，C 的异常被 B 吞掉了 |
| 依赖关系梳理 | 代码里直接看 | 服务间调用关系不透明 |

---

## 二、技术选型：Jaeger vs SkyWalking

### 2.1 选型调研过程

在决定引入链路追踪方案之前，我们团队花了一周时间做技术调研。调研对象包括市面上主流的五个方案：Jaeger、SkyWalking、Zipkin、Datadog 和 New Relic。由于 KKday 的基础架构以自建机房为主，SaaS 方案（Datadog/New Relic）的成本模型不适合——按照 span 量计费，日均亿级 span 的场景下费用惊人。

最终聚焦到 Jaeger 和 SkyWalking 两个开源方案。我们的评估标准有四个维度：语言覆盖广度（PHP/Java/Node.js 都要支持）、社区活跃度、存储后端灵活性、以及与 OpenTelemetry 标准的兼容程度。

### 2.2 两套方案对比

| 维度 | Jaeger | SkyWalking |
|------|--------|------------|
| 开发方 | Uber → CNCF 毕业项目 | Apache 顶级项目 |
| 数据协议 | OpenTelemetry (OTLP) / Jaeger Thrift | SkyWalking Agent / OTLP |
| 语言支持 | 通过 OTLP 几乎全语言 | Java Agent 最强，PHP 通过 OTLP 接入 |
| 存储后端 | Elasticsearch / Cassandra / Kafka | Elasticsearch / MySQL / BanyanDB |
| 拓扑图 | 依赖关系图 | 服务拓扑 + 服务关系图 |
| 告警 | 需配合 Prometheus | 内置告警引擎 |
| PHP 支持 | ⭐⭐⭐ OTLP SDK 成熟 | ⭐⭐ 需要 OTLP 桥接 |

**我们的选择**：先上 **Jaeger + OpenTelemetry**（PHP 生态更成熟），后续对 Java 服务用 SkyWalking Agent 补充 JVM 级指标。

### 2.3 为什么不只用一个方案？

你可能会问：为什么不用统一的方案？原因是不同语言的生态成熟度差异太大。PHP 的 OpenTelemetry SDK 已经非常稳定，自动埋点覆盖了 Laravel 的路由、中间件、数据库查询、HTTP Client 等核心组件。但 Java 生态中，SkyWalking 的 Java Agent 提供了更深度的字节码增强——它可以自动注入 JDBC、gRPC、Kafka 客户端的埋点，无需任何代码改动。而 OpenTelemetry 的 Java Agent 虽然也能做到，但在 SkyWalking 的 APM 能力（JVM 指标、线程剖析、告警引擎）面前还是略逊一筹。

所以我们的策略是：**Laravel 服务用 OTel SDK，Java 服务用 SkyWalking Agent，OTel Collector 作为统一汇聚层**。两套方案通过 W3C TraceContext 标准打通链路。

### 2.4 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   Application Layer                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │   BFF   │  │ Inventory│  │ Notification     │   │
│  │(Laravel)│  │(Laravel) │  │  (Laravel+Kafka) │   │
│  └────┬────┘  └────┬─────┘  └────────┬─────────┘   │
│       │            │                  │              │
│  ┌────┴────┐  ┌────┴─────┐  ┌────────┴─────────┐   │
│  │ OTel    │  │ OTel     │  │ OTel PHP SDK     │   │
│  │ PHP SDK │  │ PHP SDK  │  │ + Kafka Context  │   │
│  └────┬────┘  └────┬─────┘  └────────┬─────────┘   │
└───────┼────────────┼──────────────────┼─────────────┘
        │            │                  │
        ▼            ▼                  ▼
┌─────────────────────────────────────────────────────┐
│              OpenTelemetry Collector                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐      │
│  │ Receivers│→ │Processors│→ │  Exporters   │      │
│  │  (OTLP)  │  │ (Batch,  │  │ Jaeger/Zipkin│      │
│  │          │  │  Filter) │  │ /Prometheus  │      │
│  └──────────┘  └──────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────┘
        │                           │
        ▼                           ▼
┌──────────────┐          ┌──────────────────┐
│    Jaeger    │          │   Prometheus +   │
│   Storage    │          │    Grafana       │
│  (Elastic)   │          │  (Metrics)       │
└──────────────┘          └──────────────────┘
```

---

## 三、Jaeger 部署实战

### 3.1 Docker Compose 一键部署

```yaml
# docker-compose.jaeger.yml
version: '3.8'

services:
  # Jaeger All-in-One（开发/测试环境）
  jaeger:
    image: jaegertracing/all-in-one:1.55
    ports:
      - "16686:16686"   # Jaeger UI
      - "14268:14268"   # Jaeger HTTP Thrift 直接接收
      - "4317:4317"     # OTLP gRPC
      - "4318:4318"     # OTLP HTTP
    environment:
      - COLLECTOR_OTLP_ENABLED=true
      - SPAN_STORAGE_TYPE=elasticsearch
      - ES_SERVER_URLS=http://elasticsearch:9200
      - ES_INDEX_PREFIX=jaeger
      - ES_TAGS_AS_FIELDS_ALL=true
    depends_on:
      elasticsearch:
        condition: service_healthy

  # Elasticsearch 作为存储后端
  elasticsearch:
    image: elasticsearch:8.12.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  # OpenTelemetry Collector（统一接收、处理、导出）
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.96.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "8888:8888"   # Prometheus metrics
    depends_on:
      - jaeger
```

### 3.2 OTel Collector 配置

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
  # 批量发送，减少网络开销
  batch:
    timeout: 5s
    send_batch_size: 512
    send_batch_max_size: 1024

  # 过滤健康检查的 span（避免噪音）
  filter:
    error_mode: ignore
    traces:
      exclude:
        match_type: regexp
        span_names:
          - "GET /health"
          - "GET /up"

  # 添加服务元数据
  resource:
    attributes:
      - key: deployment.environment
        value: "production"
        action: upsert

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

  # Prometheus 指标导出
  prometheus:
    endpoint: "0.0.0.0:8888"
    namespace: "otel"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [filter, batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

---

## 四、Laravel 接入 OpenTelemetry

### 4.1 安装 SDK

```bash
# 核心 SDK
composer require open-telemetry/sdk open-telemetry/exporter-otlp

# Laravel 自动发现
composer require open-telemetry/opentelemetry-auto-laravel

# HTTP 客户端传播（Guzzle 中间件）
composer require open-telemetry/transport-otlp-http
```

> **踩坑 #1**：`opentelemetry-auto-laravel` 需要 `ext-protobuf` 或 `ext-grpc`。在 Docker 环境里我们用的 `protobuf` 扩展，因为 gRPC 扩展在 PHP-FPM 下有已知的线程安全问题。

```dockerfile
# Dockerfile 中安装 protobuf 扩展
RUN pecl install protobuf-3.25.2 \
    && docker-php-ext-enable protobuf
```

### 4.2 环境变量配置

```bash
# .env
OTEL_SERVICE_NAME=kkday-bff-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_PROPAGATORS=tracecontext,baggage
```

> **踩坑 #2**：`OTEL_TRACES_SAMPLER_ARG=0.1` 表示只采样 10% 的请求。生产环境如果设为 `1.0`（全量），在 QPS 3000+ 的 BFF 层会产生大量 span 数据，Elasticsearch 磁盘会快速膨胀。我们踩过这个坑——上线第一天 ES 磁盘从 50GB 涨到 200GB。

### 4.3 手动埋点：跨服务 HTTP 调用

自动埋点只能覆盖 Laravel 框架层（路由、中间件、DB 查询），但业务代码中的跨服务调用需要手动创建 span：

```php
<?php
// app/Services/Search/SearchClient.php

namespace App\Services\Search;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\Context\Context;
use Illuminate\Support\Facades\Http;

class SearchClient
{
    private string $baseUrl;

    public function __construct()
    {
        $this->baseUrl = config('services.search.url');
    }

    public function search(string $keyword, array $filters = []): array
    {
        $tracer = Globals::tracerProvider()
            ->getTracer('kkday-bff', '1.0.0');

        // 创建子 span
        $span = $tracer->spanBuilder('search.products')
            ->setSpanKind(SpanKind::KIND_CLIENT)
            ->setAttribute('search.keyword', $keyword)
            ->setAttribute('search.filters.count', count($filters))
            ->startSpan();

        $scope = $span->activate();

        try {
            // 将 trace context 注入到 HTTP header（W3C TraceContext 格式）
            $headers = [];
            Globals::propagator()->inject($headers);

            $response = Http::withHeaders($headers)
                ->timeout(3)
                ->post("{$this->baseUrl}/api/v2/search", [
                    'keyword' => $keyword,
                    'filters' => $filters,
                ]);

            $span->setAttribute('http.status_code', $response->status());
            $span->setAttribute('search.result_count', $response->json('meta.total', 0));

            if ($response->failed()) {
                $span->setStatus(StatusCode::ERROR, "Search API returned {$response->status()}");
                $span->recordException(new \RuntimeException(
                    "Search API error: {$response->body()}"
                ));
                return [];
            }

            return $response->json('data', []);

        } catch (\Throwable $e) {
            $span->setStatus(StatusCode::ERROR, $e->getMessage());
            $span->recordException($e);
            return [];
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

### 4.4 Kafka 消息的上下文传播

> **踩坑 #3**：HTTP 调用可以通过 header 传播 trace context，但 Kafka 消息怎么办？我们一开始忘了注入 context，导致 Kafka 消费者（Notification Service）的 span 成了"孤儿 span"——没有父 span ID，链路断了。

```php
<?php
// app/Events/OrderCreated.php —— 生产者端

namespace App\Events;

use OpenTelemetry\API\Globals;

class OrderCreated
{
    public function __construct(
        public readonly string $orderId,
        public readonly array $orderData,
        public readonly array $traceContext = [], // 携带 trace context
    ) {}

    public static function dispatch(string $orderId, array $orderData): void
    {
        // 注入 trace context 到消息 header
        $carrier = [];
        Globals::propagator()->inject($carrier);

        event(new self(
            orderId: $orderId,
            orderData: $orderData,
            traceContext: $carrier,
        ));
    }
}
```

```php
<?php
// app/Listeners/OrderCreatedListener.php —— 消费者端

namespace App\Listeners;

use App\Events\OrderCreated;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\Context\Context;

class OrderCreatedListener
{
    public function handle(OrderCreated $event): void
    {
        // 从消息 header 中提取 trace context
        $parentContext = Globals::propagator()->extract($event->traceContext);

        $tracer = Globals::tracerProvider()
            ->getTracer('kkday-notification', '1.0.0');

        // 以提取的 context 为父级创建 span
        $span = $tracer->spanBuilder('notification.order_created')
            ->setParent($parentContext)
            ->setSpanKind(SpanKind::KIND_CONSUMER)
            ->setAttribute('order.id', $event->orderId)
            ->startSpan();

        $scope = $span->activate();

        try {
            $this->sendNotification($event->orderData);
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

---

## 五、SkyWalking 接入（Java 服务补充）

对于 Java 服务（如 Search Service），SkyWalking 的 Java Agent 提供零代码侵入的深度监控：

```yaml
# docker-compose.skywalking.yml
services:
  skywalking-oap:
    image: apache/skywalking-oap-server:9.7.0
    environment:
      SW_STORAGE: elasticsearch
      SW_STORAGE_ES_CLUSTER_NODES: elasticsearch:9200
      SW_TELEMETRY: prometheus
    ports:
      - "11800:11800"  # gRPC
      - "12800:12800"  # REST

  skywalking-ui:
    image: apache/skywalking-ui:9.7.0
    environment:
      SW_OAP_ADDRESS: http://skywalking-oap:12800
    ports:
      - "8080:8080"
```

```dockerfile
# Search Service (Java) Dockerfile
FROM eclipse-temurin:17-jre

# 下载 SkyWalking Agent
ADD https://dlcdn.apache.org/skywalking/java-agent/9.1.0/apache-skywalking-java-agent-9.1.0.tar.gz /opt/
RUN tar -xzf /opt/apache-skywalking-java-agent-9.1.0.tar.gz -C /opt/

ENV JAVA_TOOL_OPTIONS="-javaagent:/opt/skywalking/agent/skywalking-agent.jar"
ENV SW_AGENT_NAME=search-service
ENV SW_AGENT_COLLECTOR_BACKEND_SERVICES=skywalking-oap:11800
ENV SW_AGENT_SAMPLE=10

COPY target/search-service.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

> **跨栈追踪的关键**：Java 服务用 SkyWalking Agent，Laravel 服务用 OTel SDK，要实现跨栈追踪必须使用统一的 **W3C TraceContext** 传播协议。SkyWalking 9.x 已支持 OTLP 导出，我们通过 OTel Collector 作为统一汇聚层。

---

## 六、生产环境踩坑与调优

### 6.1 采样策略：别全量采集

```
采样策略配置（OTel Collector + Tail-based Sampling）

┌──────────────┐     ┌─────────────────────────┐
│ Head-based   │     │     Tail-based          │
│ Sampling     │────→│     Sampling            │
│ (SDK 层 10%) │     │ (Collector 层智能过滤)   │
└──────────────┘     └─────────────────────────┘
```

```yaml
# 高级采样配置 —— 尾部采样
processors:
  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    policies:
      # 1. 所有错误请求 100% 保留
      - name: error-policy
        type: status_code
        status_code:
          status_codes: [ERROR]

      # 2. 慢请求（>2s）100% 保留
      - name: latency-policy
        type: latency
        latency:
          threshold_ms: 2000

      # 3. 其他请求 5% 采样
      - name: probabilistic-policy
        type: probabilistic
        probabilistic:
          sampling_percentage: 5
```

> **踩坑 #4**：`tail_sampling` 需要 Collector 等待整个 trace 完成才能决策。如果某个 span 耗时很长（比如跨服务的支付回调），`decision_wait` 设太短会导致部分 trace 被提前丢弃。我们从 5s 调到 10s 才稳定。

### 6.2 性能影响实测

在 BFF 层（QPS 2000）的实测数据：

| 指标 | 无 Tracing | OTel 10% 采样 | OTel 100% 采样 |
|------|-----------|---------------|----------------|
| P50 延迟 | 45ms | 47ms (+4%) | 58ms (+29%) |
| P99 延迟 | 180ms | 195ms (+8%) | 320ms (+78%) |
| CPU 使用率 | 35% | 38% | 52% |
| 内存使用 | 256MB | 280MB | 380MB |
| ES 磁盘/天 | - | 15GB | 150GB |

**结论**：10% 采样对性能影响可忽略，100% 采样会显著增加延迟和存储成本。

### 6.3 告警规则

```yaml
# alert-rules.yml（Jaeger + Prometheus AlertManager）
groups:
  - name: tracing_alerts
    rules:
      # 链路 P99 延迟超阈值
      - alert: HighTraceLatencyP99
        expr: |
          histogram_quantile(0.99,
            sum(rate(otel_span_duration_seconds_bucket{
              service_name=~"kkday-.*"
            }[5m])) by (le, service_name)
          ) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.service_name }} P99 延迟超过 3s"

      # 错误率突增
      - alert: HighErrorRate
        expr: |
          sum(rate(otel_span_status_code{status_code="ERROR"}[5m])) by (service_name)
          /
          sum(rate(otel_span_status_code[5m])) by (service_name)
          > 0.05
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.service_name }} 错误率超过 5%"
```

---

## 七、架构总览图

```
┌─────────────────────────────────────────────────────────────────┐
│                        KKday B2C 微服务架构                      │
│                                                                  │
│  ┌──────────┐  gRPC   ┌──────────────┐  HTTP  ┌────────────┐   │
│  │   BFF    │────────→│  Search      │       │  Inventory  │   │
│  │ (Laravel)│         │  (Java)      │       │  (Laravel)  │   │
│  │  OTel    │         │  SW Agent    │       │  OTel       │   │
│  └────┬─────┘         └──────┬───────┘       └──────┬──────┘   │
│       │ HTTP                 │                       │ Redis    │
│       ▼                      │                       ▼          │
│  ┌──────────┐         ┌──────┴───────┐       ┌────────────┐   │
│  │ Payment  │         │ Notification │       │ Redis       │   │
│  │ (Node.js)│         │ (Laravel)    │       │ (Cache/Lock)│   │
│  │  OTel    │         │  OTel+Kafka  │       └────────────┘   │
│  └────┬─────┘         └──────┬───────┘                         │
│       │                      │                                  │
│       ▼                      ▼                                  │
│  ┌─────────┐          ┌──────────┐                              │
│  │ Stripe/ │          │ FCM/     │                              │
│  │ AliPay  │          │ Slack    │                              │
│  └─────────┘          └──────────┘                              │
└──────────┬──────────────────┬────────────────────────────────────┘
           │ OTLP             │ OTLP
           ▼                  ▼
    ┌──────────────────────────────────┐
    │     OpenTelemetry Collector      │
    │  (Receivers → Processors →       │
    │   Exporters)                      │
    └───────┬──────────────┬───────────┘
            │              │
    ┌───────▼───────┐ ┌───▼────────────┐
    │    Jaeger     │ │  SkyWalking    │
    │   (UI+Query)  │ │  (OAP+UI)     │
    └───────┬───────┘ └───┬────────────┘
            │              │
    ┌───────▼──────────────▼───────────┐
    │       Elasticsearch Cluster       │
    │      (Trace Storage Backend)      │
    └───────────────────────────────────┘
```

---

## 六、Span 命名规范与语义约定

### 6.1 命名混乱的代价

上线初期，各服务的 span 命名随意：有人用 `search`，有人用 `SearchProducts`，有人用 `search.products.query`。在 Jaeger UI 搜索时，同一个操作出现三种不同名字，根本没法聚合分析。

### 6.2 统一命名规范

```
命名格式：{领域}.{操作}[.{子操作}]
示例：
  ✅ search.products              （搜索商品）
  ✅ inventory.reserve            （库存预留）
  ✅ payment.charge.stripe        （Stripe 扣款）
  ✅ notification.send.kafka      （Kafka 发送通知）
  ❌ SearchProducts               （驼峰，不好聚合）
  ❌ do-search                    （横杠，不好解析）
  ❌ search                       （太笼统，无法区分子操作）
```

### 6.3 语义属性（Semantic Attributes）

除了 span name，属性的命名也要统一。我们参考 OpenTelemetry Semantic Conventions：

```php
// 推荐的属性命名
$span->setAttribute('order.id', $orderId);           // 业务属性：order.id
$span->setAttribute('user.id', $userId);              // 业务属性：user.id
$span->setAttribute('http.method', 'POST');           // 标准属性：http.method
$span->setAttribute('http.url', $url);                // 标准属性：http.url
$span->setAttribute('http.status_code', 200);         // 标准属性：http.status_code
$span->setAttribute('db.system', 'mysql');             // 标准属性：db.system
$span->setAttribute('db.statement', $query);          // 标准属性：db.statement
```

> **踩坑 #6**：`db.statement` 会把完整 SQL 写入 span，在高 QPS 场景下极大增加存储消耗。我们在 OTel Collector 的 `attributes` processor 中加了截断逻辑，只保留前 500 字符。

---

## 七、Grafana 可视化：Trace + Metrics 联动

### 7.1 数据源配置

在 Grafana 中同时接入 Jaeger 和 Prometheus，实现 Trace → Metrics 的关联跳转：

```yaml
# grafana/provisioning/datasources/jaeger.yml
apiVersion: 1
datasources:
  - name: Jaeger
    type: jaeger
    access: proxy
    url: http://jaeger:16686
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        filterByTraceID: true
      nodeGraph:
        enabled: true

  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    jsonData:
      exemplarTraceIdDestinations:
        - name: trace_id
          datasourceUid: Jaeger
```

> **踩坑 #5**：Grafana 的 `exemplarTraceIdDestinations` 配置必须与 OTel Collector 的 Prometheus exporter 输出的 metric label 一致。我们一开始 metric name 用的是 `otel_span_duration`，但 Collector 默认输出的是 `otel_span_duration_seconds`，导致 Grafana 找不到关联的 trace ID。花了一下午排查。

### 7.2 关键看板指标

```promql
# 1. 各服务 P50/P95/P99 延迟
histogram_quantile(0.50,
  sum(rate(otel_span_duration_seconds_bucket{service_name=~"kkday-.*"}[5m]))
  by (le, service_name, span_name)
)

# 2. 跨服务调用拓扑（基于 trace 的上下游关系）
sum(rate(otel_span_duration_seconds_count{
  span_kind="SPAN_KIND_CLIENT"
}[5m])) by (service_name, peer_service)

# 3. 错误率 Top 10 接口
topk(10,
  sum(rate(otel_span_status_code{status_code="ERROR"}[5m]))
  by (service_name, span_name)
  /
  sum(rate(otel_span_status_code[5m]))
  by (service_name, span_name)
)

# 4. 慢请求 Top 10（按 span 耗时排序）
topk(10,
  histogram_quantile(0.99,
    sum(rate(otel_span_duration_seconds_bucket[5m]))
    by (le, service_name, span_name)
  )
)
```

---

## 八、实战案例：订单链路排查

### 8.1 场景：用户反馈"下单后没收到确认邮件"

**排查步骤**：

```
1. Jaeger UI 搜索服务名: kkday-bff-api
2. 筛选最近 1 小时 + tag: order.id = ORD-20260516-8837
3. 找到完整 trace：

   kkday-bff-api / POST /api/v3/orders          [850ms]
   ├── search.products (→ Search Service, gRPC)  [120ms]
   ├── inventory.reserve (→ Inventory, HTTP)     [45ms]
   │   └── redis.SETNX inventory_lock             [2ms]
   ├── payment.charge (→ Payment, HTTP)           [580ms]
   │   ├── stripe.create_intent                   [520ms]
   │   └── (标记 ERROR: card_declined)
   └── notification.send (→ Kafka)                [5ms]
       └── notification.order_created (消费者)     [未执行!]

   问题定位：Payment 报错 card_declined，但异常被 BFF 的 try-catch
   吞掉了，没有抛到 Notification 层。BFF 返回了 200（部分成功），
   用户以为下单成功，实际支付失败且没有通知。
```

**修复方案**：

```php
// 修复前（有问题的代码）
try {
    $paymentResult = $this->paymentClient->charge($orderId, $amount);
    // 支付失败也继续往下走...
    OrderCreated::dispatch($orderId, $orderData);
} catch (PaymentException $e) {
    Log::error('Payment failed', ['order_id' => $orderId]);
    // 只记了日志，没有阻止后续流程
}

// 修复后
try {
    $paymentResult = $this->paymentClient->charge($orderId, $amount);
} catch (PaymentException $e) {
    $span->recordException($e);
    $span->setStatus(StatusCode::ERROR, 'payment_failed');

    // 发送支付失败通知（而不是订单成功通知）
    PaymentFailed::dispatch($orderId, $e->getMessage());
    throw new OrderCreationFailedException('Payment declined', previous: $e);
}

// 只有支付成功才发确认通知
OrderCreated::dispatch($orderId, $orderData);
```

### 8.2 场景：P99 延迟突增告警

```
告警：kkday-bff-api P99 > 3s (持续 5 分钟)

排查路径：
1. Grafana → Prometheus 看板 → 确认 BFF P99 从 180ms 飙到 4.2s
2. 点击 exemplar → 跳转 Jaeger → 找到慢 trace
3. 发现瓶颈在 Search Service（gRPC 调用耗时 3.8s）
4. 跳转 SkyWalking UI → Search Service → JVM 指标
5. 根因：Search Service 的 Elasticsearch 查询未命中缓存，
   且 JVM Heap 即将 OOM（GC 停顿 1.2s）

修复：
- 紧急：重启 Search Service Pod（HPA 自动扩容）
- 根因：给 ES 查询增加 30s TTL 缓存 + JVM Heap 从 2G 调到 4G
```

---

## 九、经验总结

### ✅ 推荐做法

1. **先上 OTel Collector 再接后端**——Collector 是解耦层，后端换 Jaeger/Zipkin/Datadog 只改配置不改代码
2. **Head + Tail 双层采样**——SDK 层粗筛，Collector 层精筛，兼顾成本和关键 trace 可见性
3. **统一 W3C TraceContext**——跨语言（PHP/Java/Node.js）唯一的上下文传播标准
4. **Kafka/RabbitMQ 必须注入 context**——异步消息是链路断裂的重灾区
5. **定期清理 ES 索引**——Jaeger 的 trace 数据只保留 7 天，用 ILM 策略自动滚动删除

### ❌ 踩坑清单

| # | 问题 | 根因 | 解法 |
|---|------|------|------|
| 1 | ext-grpc 在 PHP-FPM 下 segfault | gRPC 扩展线程安全问题 | 改用 ext-protobuf + HTTP 传输 |
| 2 | ES 磁盘一天涨 150GB | 全量采样 + 未过滤健康检查 | 10% 采样 + filter processor |
| 3 | Kafka consumer 成孤儿 span | 消息 header 未注入 trace context | 事件基类统一注入 carrier |
| 4 | 尾部采样丢 trace | decision_wait=5s 太短 | 调到 10s |
| 5 | Jaeger UI 查不到跨栈 trace | PHP 用 OTel，Java 用 SW，context 不兼容 | 统一 W3C TraceContext + OTel Collector 汇聚 |

---

> **来自选题池**：`.writing-backlog.md` → `链路追踪实战：Jaeger/SkyWalking 在 Laravel 微服务中的应用`

---

## 相关阅读

- [Platform Engineering 实战：Golden Paths 与服务模板——用 Backstage 自助创建标准化 Laravel 微服务脚手架](/categories/架构/platform-engineering-实战-golden-paths-与服务模板-用backstage自助创建标准化laravel微服务脚手架/)
- [Sidecar Pattern 实战：Laravel 微服务的 Sidecar 代理——Envoy/Telegraf/Filebeat 的基础设施下沉](/categories/架构/sidecar-pattern-实战-laravel-微服务-sidecar-代理-envoy-telegraf-filebeat-基础设施下沉/)
- [Choreography vs Orchestration 实战：事件驱动 vs 工作流驱动——Laravel 微服务中的两种分布式编排范式深度对比](/categories/架构/choreography-vs-orchestration-laravel-microservices-distributed-patterns/)
