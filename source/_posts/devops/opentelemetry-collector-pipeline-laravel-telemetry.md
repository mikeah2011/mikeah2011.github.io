---
title: OpenTelemetry Collector Pipeline 实战：接收处理导出的三阶段架构——Laravel 应用的遥测数据治理
date: 2026-06-06 10:00:00
tags: [OpenTelemetry, Observability, Laravel, Collector]
keywords: [OpenTelemetry Collector Pipeline, Laravel, 接收处理导出的三阶段架构, 应用的遥测数据治理, DevOps]
categories:
  - devops
description: "深入解析 OpenTelemetry Collector Pipeline 的 Receiver-Processor-Exporter 三阶段架构，结合 Laravel 应用实战，详解如何通过 OTLP 协议统一接收链路追踪、性能指标和应用日志三类遥测信号。涵盖完整 YAML 配置、Docker Compose 部署方案、PHP SDK 集成代码、敏感数据脱敏、智能尾部采样策略与生产环境数据治理最佳实践，帮助 Laravel 团队构建灵活可控的可观测性基础设施。"
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---


## 前言

在现代微服务架构中，可观测性已经成为保障系统稳定性和快速排障的核心支柱。当我们使用 Laravel 构建后端业务系统时，随着服务规模不断扩大、请求链路日益复杂，传统的日志排查方式已经难以满足运维和开发团队对系统状态的全面感知需求。每一次用户请求可能跨越多个服务、经过消息队列、访问数据库缓存，任何一个环节出现性能瓶颈或异常，都需要一套完整的遥测数据采集体系来帮助我们快速定位问题。我们需要将链路追踪、性能指标和应用日志统一纳入管理，建立真正意义上的可观测性基础设施。

OpenTelemetry 作为 CNCF 旗下最活跃的可观测性标准项目，提供了一套统一的 SDK 和 Collector 架构，帮助我们将遥测数据的采集与后端存储彻底解耦。在这个体系中，OpenTelemetry Collector 是整个数据管道的核心枢纽，它采用 Receiver → Processor → Exporter 的三阶段架构，让数据的接收、处理和导出变得灵活而可控。这种架构设计的最大优势在于，应用程序只需要对接 Collector 这一个端点，后端存储的变更不会影响到业务代码，所有的数据治理逻辑都可以集中在 Collector 层面统一处理。

本文将从架构原理出发，结合完整的配置示例、Docker 部署方案和 Laravel 集成代码，带你深入理解 OpenTelemetry Collector Pipeline 的实战用法，并分享在生产环境中进行遥测数据治理的最佳实践。

<!-- more -->

## 一、为什么需要 OpenTelemetry Collector

在没有 Collector 的传统架构中，应用程序的 SDK 直接将遥测数据发送到后端存储系统（如 Jaeger、Prometheus、Elasticsearch）。这种直连模式存在几个明显的问题，这些问题在系统规模扩大后会变得尤为突出。

**第一，耦合性过高**。应用程序必须知道后端存储的具体地址和协议格式，一旦后端系统发生变更（比如从 Jaeger 迁移到 Grafana Tempo，或者从 Elasticsearch 切换到 Loki），就需要修改所有服务的配置并重新部署。在拥有数十甚至上百个微服务的系统中，这种变更的代价是巨大的，往往需要协调多个团队、分批滚动发布，整个过程可能持续数周。而引入 Collector 之后，应用程序只需要配置 Collector 的地址，后端存储的切换对应用完全透明。

**第二，缺乏数据治理能力**。应用程序 SDK 通常只负责生成和发送数据，不具备数据过滤、脱敏、采样等处理能力。如果要对遥测数据进行统一的标准化处理——比如为所有数据添加环境标识、对敏感字段进行哈希处理、过滤掉健康检查接口的无用数据——只能在每个应用中重复实现相同的逻辑，这不仅效率低下，而且难以保证一致性。Collector 的 Processor 层提供了一套强大而灵活的数据处理机制，所有治理逻辑集中在一个地方管理，修改后即时生效，无需重新部署任何业务服务。

**第三，资源开销分散**。每个应用进程都维护着与后端的网络连接和发送队列，占用额外的内存和 CPU 资源。对于 PHP 这种进程模型的语言来说，问题更加严重：每个 PHP-FPM 工作进程如果都持有 gRPC 连接和缓冲队列，会带来非常可观的内存开销。将这些职责下沉到 Collector 之后，应用进程只需要将数据发送到本地或同机房的 Collector 实例，连接数和缓冲逻辑都大幅简化。

**第四，多后端支持困难**。在实际的运维场景中，我们往往需要将同一份数据同时发送到多个后端系统——链路数据发送到 Tempo 用于调试，同时发送到 Datadog 用于告警；指标数据发送到 Prometheus 用于监控，同时发送到商业 APM 平台用于报表。如果没有 Collector，每个应用都需要对接多个后端，配置复杂度和维护成本都会急剧上升。Collector 的多 Exporter Fan-out 机制让这种需求变得非常简单，只需要在配置文件中添加一个 Exporter 即可。

## 二、三阶段架构详解：Receiver / Processor / Exporter

OpenTelemetry Collector 的核心设计思想是将遥测数据的处理流程拆分为三个独立且可组合的阶段。这三个阶段通过 Pipeline（管道）串联在一起，形成一条完整的数据处理链路。每个阶段都是可插拔的，可以根据实际需求灵活组合。

### 2.1 Receiver（接收器）

Receiver 是 Collector 的数据入口，负责监听特定端口或主动拉取数据源，将外部的遥测数据接收进来并转换为 Collector 内部的统一数据模型。Collector 支持多种接收协议，覆盖了几乎所有主流的遥测数据格式。

对于链路追踪数据，OTLP 协议是最推荐的选择。它是 OpenTelemetry 的原生协议，支持 gRPC 和 HTTP 两种传输方式。gRPC 方式默认监听 4317 端口，采用 Protocol Buffers 序列化，性能优异，适合服务端到服务端的通信场景。HTTP 方式默认监听 4318 端口，支持 JSON 和 Protocol Buffers 两种编码格式，更适合浏览器端或不支持 gRPC 的环境。除了 OTLP 之外，Collector 也兼容 Jaeger 的 Thrift 和 gRPC 协议，以及 Zipkin 的 JSON 格式，方便从已有的分布式追踪系统平滑迁移，无需修改现有应用的埋点代码。

对于性能指标数据，除了通过 OTLP 协议接收之外，Collector 还支持 Prometheus 的拉取模式。通过配置 `prometheus` 接收器，Collector 可以主动去抓取目标服务暴露的 metrics 端点，这种方式对于那些尚未集成 OpenTelemetry SDK 的老服务尤其有用，可以实现无侵入式的指标采集。同时，Collector 也支持 `hostmetrics` 接收器来采集 CPU、内存、磁盘、网络等主机级别的系统指标。

对于日志数据，Collector 提供了 OTLP 日志接收器，同时也支持通过 `filelog` 接收器直接读取服务器上的日志文件。对于 Laravel 应用来说，可以直接读取 `storage/logs` 目录下的日志文件，解析 JSON 格式的日志行并转换为结构化的日志记录。此外，Collector 还兼容 Fluentd 和 Fluent Bit 的转发协议，方便从现有的日志采集方案迁移。

一个 Collector 实例可以同时配置多个 Receiver，每种信号类型（Traces、Metrics、Logs）可以使用不同的接收方式，也可以共享同一个 OTLP 接收器。这种灵活性使得 Collector 可以适配各种复杂的部署场景。

在实际配置中，接收器还可以配置认证机制。对于 gRPC 接收器，可以通过 TLS 证书实现双向认证，确保只有持有合法证书的应用才能发送数据。对于 HTTP 接收器，可以配置 Bearer Token 认证或自定义 Header 校验。这些安全措施在多团队共享 Collector 的环境中尤为重要，可以防止未授权的服务发送虚假数据影响监控准确性。

### 2.2 Processor（处理器）

Processor 是 Collector 的数据处理层，是实现遥测数据治理的核心环节。所有经过 Collector 的遥测数据都会依次通过配置好的 Processor 链，每个 Processor 对数据执行特定的转换操作。Processor 的选择和排列顺序直接决定了数据治理的效果。

**资源管理类处理器**是 Pipeline 中最基础的一环。`resource` 处理器用于为所有数据统一注入资源属性，比如环境标识、服务版本、部署区域等元信息，这些属性会被附加到每一条遥测数据上，方便后续在后端系统中进行数据分组和筛选。`k8sattributes` 处理器可以自动从 Kubernetes API 获取 Pod 名称、Node 地址、Namespace、Deployment 等信息并注入到遥测数据中，无需手动配置。`resourcedetection` 处理器可以自动探测当前运行环境是 AWS、GCP、Azure 还是裸金属服务器，并自动注入相应的云平台元数据。

**数据转换类处理器**负责对数据的属性和内容进行调整。`attributes` 处理器是最常用的处理器之一，它可以添加、修改或删除数据的属性键值对，支持 `insert`（仅在不存在时插入）、`update`（仅在已存在时更新）、`upsert`（存在则更新，不存在则插入）、`delete`（删除指定属性）、`hash`（对属性值进行哈希处理）五种操作模式。`span` 处理器可以对 Span 的名称进行重命名，`metricstransform` 处理器可以对指标的名称进行重命名、对多个指标进行聚合合并。

**数据过滤类处理器**用于丢弃不需要的数据以降低存储成本和噪音。`filter` 处理器支持基于属性值、Span 名称、指标名称等多种条件进行过滤。在实际项目中，我们通常会过滤掉健康检查接口（如 `/health`、`/up`、`/ready`）产生的 Span，因为这些接口的请求频率很高但几乎没有分析价值，会产生大量的存储浪费。

**采样控制类处理器**是高流量场景下的必备组件。`probabilisticsampler` 提供基于概率的头部采样，简单高效但可能会丢弃错误链路。`tailsamplingprocessor` 则等待完整的 Trace 完成后再做决策，可以实现更智能的采样策略：始终保留错误链路、始终保留慢请求、对特定业务路径全量保留、对其余请求按比例采样。尾部采样的代价是需要在内存中暂存 Trace 数据，会增加 Collector 的内存消耗和数据延迟。

**可靠性保障类处理器**确保 Pipeline 在高压场景下依然稳定运行。`memory_limiter` 处理器通过持续监控内存使用量，在接近阈值时主动丢弃数据或触发垃圾回收，防止 Collector 因内存溢出而被操作系统杀掉。这个处理器建议放在 Processor 链的最前面，作为第一道防护。`batch` 处理器将数据聚合成批次后再发送，减少了网络往返次数和后端的请求压力，是几乎每个 Pipeline 都会配置的基础处理器。

在配置批量处理器时，需要注意批次大小和超时时间的平衡。批次太小会导致频繁的网络请求，增加后端压力；批次太大会增加数据延迟，影响监控的实时性。对于链路数据，建议批次大小设置为四千到八千条，超时时间设置为两到五秒；对于日志数据，由于数据量更大，可以适当增大批次大小到一万条以上。

Processor 在 Pipeline 中的顺序至关重要。通常建议的顺序是：先放 `memory_limiter` 做内存防护，然后是 `resource` 和 `attributes` 做数据丰富和标准化，接着是 `filter` 做数据过滤，再是 `tailsampling` 做采样决策（因为尾部采样需要看到完整的属性信息才能做出判断），最后是 `batch` 做批量发送。

### 2.3 Exporter（导出器）

Exporter 是 Collector 的数据出口，负责将处理后的遥测数据发送到后端存储或分析系统。每种信号类型需要使用对应的 Exporter，但一个 Pipeline 可以配置多个 Exporter 来实现数据的多路分发。

**指标导出器**方面，`prometheus` Exporter 会将 Collector 本身变成一个 Prometheus 兼容的 HTTP 指标端点，由 Prometheus 服务器主动来拉取数据。这种方式适合 Prometheus 作为主要监控系统的场景。`prometheusremotewrite` Exporter 则是通过 Remote Write 协议主动将指标推送到 Mimir、Thanos、Cortex 等支持远程写入的指标存储，适合大规模分布式监控场景。`otlp` Exporter 可以将指标通过 OTLP 协议转发给另一个 Collector 实例或任何支持 OTLP 的后端。

**链路导出器**方面，`jaeger` Exporter 可以将 Span 数据直接发送到 Jaeger Collector。`otlp` Exporter 可以将数据发送到 Grafana Tempo、Datadog 或其他支持 OTLP 的链路存储后端。`zipkin` Exporter 可以将数据发送到 Zipkin Server，方便与使用 Zipkin 的遗留系统集成。

**日志导出器**方面，`loki` Exporter 可以将日志发送到 Grafana Loki，与 Grafana 生态深度集成。`elasticsearch` Exporter 可以将日志写入 Elasticsearch，适合需要全文搜索能力的场景。`otlp` Exporter 可以将日志通过 OTLP 协议转发到支持 OTLP 日志的后端。在选择导出器时，还需要考虑数据格式的兼容性和性能特征：gRPC 导出器通常比 HTTP 导出器有更高的吞吐量和更低的延迟，但需要后端支持 gRPC 协议；HTTP 导出器兼容性更广但性能稍逊。此外还需确认后端系统是否支持当前版本的协议规范，避免因版本不匹配导致数据丢失。

**调试导出器**方面，`debug` Exporter 可以将数据输出到控制台日志中，方便开发调试。`file` Exporter 可以将数据写入本地 JSON 文件，方便进行数据验证和测试。

## 三、完整配置示例

下面给出一个面向 Laravel 生产环境的完整 Collector 配置示例。这个配置涵盖了接收器、处理器和导出器的全面配置，经过了实际生产环境的验证，可以直接作为项目起点使用：

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
        max_recv_msg_size_mib: 4
        max_concurrent_streams: 100
        keepalive:
          server_parameters:
            max_connection_idle: 120s
            max_connection_age: 3600s
            max_connection_age_grace: 30s
            time: 30s
            timeout: 10s
      http:
        endpoint: 0.0.0.0:4318
        cors:
          allowed_origins:
            - "https://*.example.com"

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128

  batch:
    send_batch_size: 8192
    send_batch_max_size: 16384
    timeout: 5s
    metadata_keys:
      - "x-tenant-id"

  resource:
    attributes:
      - key: deployment.environment
        value: "${ENVIRONMENT}"
        action: upsert
      - key: infrastructure.region
        value: "${AWS_REGION:-cn-north-1}"
        action: upsert

  attributes/security:
    actions:
      - key: http.request.header.authorization
        action: delete
      - key: http.request.header.cookie
        action: delete
      - key: http.request.body
        action: delete
      - key: db.statement
        action: hash
      - key: user.email
        action: hash

  attributes/enrich:
    actions:
      - key: app.framework
        value: laravel
        action: upsert
      - key: team.owner
        value: backend-platform
        action: upsert

  filter/health:
    error_mode: ignore
    traces:
      span:
        - 'attributes["http.target"] == "/health"'
        - 'attributes["http.target"] == "/up"'
        - 'attributes["http.target"] == "/ready"'
        - 'name == "GET /metrics"'
    metrics:
      exclude:
        match_type: regexp
        metric_names:
          - "go_.*"
          - "process_.*"

  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    expected_new_traces_per_sec: 1000
    policies:
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: slow-traces
        type: latency
        latency:
          threshold_ms: 2000
      - name: critical-routes
        type: string_attribute
        string_attribute:
          key: http.target
          values: ["/api/orders", "/api/payments"]
      - name: probabilistic
        type: probabilistic
        probabilistic:
          sampling_percentage: 15

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true
    compression: gzip
    sending_queue:
      enabled: true
      num_consumers: 10
      queue_size: 5000
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 300s

  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: laravel_app
    const_labels:
      environment: "production"
    resource_to_telemetry_conversion:
      enabled: true

  loki:
    endpoint: "http://loki:3100/loki/api/v1/push"
    labels:
      attributes:
        service.name: "service"
        severity: "level"

  debug:
    verbosity: basic

extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  zpages:
    endpoint: 0.0.0.0:55679

service:
  extensions: [health_check, zpages]
  pipelines:
    traces:
      receivers: [otlp]
      processors:
        - memory_limiter
        - resource
        - attributes/security
        - attributes/enrich
        - filter/health
        - tail_sampling
        - batch
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors:
        - memory_limiter
        - resource
        - attributes/enrich
        - filter/health
        - batch
      exporters: [prometheus]
    logs:
      receivers: [otlp]
      processors:
        - memory_limiter
        - resource
        - attributes/security
        - batch
      exporters: [loki]
  telemetry:
    metrics:
      address: 0.0.0.0:8888
      level: detailed
    logs:
      level: info
      encoding: json
```

在这个配置中，三种信号类型各自拥有独立的 Pipeline，它们共享部分 Processor 但也可以有不同的处理策略。Traces Pipeline 配置了最完整的处理链，包括安全脱敏、属性丰富、数据过滤和尾部采样，因为链路数据通常是最复杂也最有分析价值的遥测数据类型。Metrics Pipeline 侧重于指标过滤和资源标注，不需要尾部采样因为指标数据量相对可控。Logs Pipeline 侧重于安全脱敏和批量发送，日志数据量最大但结构相对简单。

## 四、Docker 容器化部署

### 4.1 Docker Compose 编排

以下是一个完整的可观测性栈的 Docker Compose 配置，包含了 Collector、Jaeger、Prometheus、Loki、Tempo 和 Grafana，可以作为本地开发和测试的完整环境：

```yaml
version: "3.9"

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.102.0
    command: ["--config=/etc/otelcol/config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol/config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "8889:8889"
      - "13133:13133"
      - "55679:55679"
    environment:
      - ENVIRONMENT=production
      - AWS_REGION=cn-north-1
    deploy:
      resources:
        limits:
          memory: 768M
          cpus: "1.5"
        reservations:
          memory: 512M
          cpus: "0.5"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:13133"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - observability

  jaeger:
    image: jaegertracing/all-in-one:1.57
    ports:
      - "16686:16686"
    environment:
      - COLLECTOR_OTLP_ENABLED=true
    networks:
      - observability

  prometheus:
    image: prom/prometheus:v2.52.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - "9090:9090"
    networks:
      - observability

  grafana:
    image: grafana/grafana:11.0.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=***      - GF_INSTALL_PLUGINS=grafana-clock-panel,grafana-piechart-panel
    volumes:
      - grafana-data:/var/lib/grafana
    networks:
      - observability

  loki:
    image: grafana/loki:3.0.0
    ports:
      - "3100:3100"
    networks:
      - observability

  tempo:
    image: grafana/tempo:2.5.0
    ports:
      - "3200:3200"
    command: ["-config.file=/etc/tempo/config.yaml"]
    networks:
      - observability

volumes:
  grafana-data:

networks:
  observability:
    driver: bridge
```

### 4.2 Prometheus 采集配置

Prometheus 需要配置两个采集目标：一个是 Collector 自身的遥测指标（端口 8888），另一个是 Collector 导出的 Laravel 应用指标（端口 8889）：

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "otel-collector-self"
    static_configs:
      - targets: ["otel-collector:8888"]

  - job_name: "laravel-app-metrics"
    static_configs:
      - targets: ["otel-collector:8889"]
```

### 4.3 生产环境部署注意事项

在生产环境中部署 Collector 时，需要特别注意以下几个关键点。

**内存控制**是首要关注的问题。Collector 基于 Go 语言运行，Go 的垃圾回收器在内存压力较大时可能会导致短暂的停顿。建议将容器的内存限制设置为 `memory_limiter` 的 `limit_mib` 参数的 1.5 倍左右，为 Go 运行时的垃圾回收和系统缓冲留出充足空间。例如 `limit_mib` 设置为 512 时，容器内存限制建议设置为 768MB。过低的内存限制会导致 Collector 频繁丢弃数据，过高则可能在异常情况下导致宿主机内存耗尽。

**CPU 配置**方面，Collector 的 CPU 消耗主要取决于数据吞吐量和 Processor 的复杂度。尾部采样处理器由于需要在内存中暂存完整的 Trace 数据等待采样决策，对 CPU 和内存的消耗都比较大。如果启用了尾部采样且流量较高，需要适当增加 CPU 配额。一般来说，每秒处理一万条 Span 大约需要 0.5 个 CPU 核心。

**网络策略**方面，建议通过安全组或 Kubernetes NetworkPolicy 限制只有应用服务所在的网络才能访问 Collector 的 4317 和 4318 端口，避免被外部恶意注入伪造的遥测数据。Collector 的 Prometheus 指标端点（8888 和 8889）也应该限制为只有 Prometheus 服务器可以访问。

**持久化队列**方面，默认情况下 Collector 的发送队列存储在内存中，进程重启或崩溃后队列中的数据会丢失。如果对数据可靠性要求较高，可以在 `sending_queue` 配置中启用 `persistent_storage_enabled` 选项，将队列数据持久化到本地磁盘。这样即使 Collector 重启，也能从磁盘恢复未发送的数据。

**健康检查和调试**方面，务必启用 `health_check` 扩展，它提供了 HTTP 端点用于 Kubernetes 的存活性探针（liveness probe）和就绪性探针（readiness probe）。同时建议启用 `zpages` 扩展，它提供了一个内置的 Web 调试页面，可以查看 Collector 内部各个组件的状态、队列深度、处理延迟等信息，对于排查数据丢失或延迟问题非常有帮助。

## 五、Laravel 应用集成

### 5.1 安装依赖

首先通过 Composer 安装 OpenTelemetry PHP SDK 及相关组件：

```bash
composer require \
  open-telemetry/sdk \
  open-telemetry/transport-grpc \
  open-telemetry/exporter-otlp
```

同时需要确保 PHP 已安装 gRPC 扩展，这是使用 gRPC 传输协议的前提条件：

```bash
pecl install grpc
```

在 `php.ini` 中添加 `extension=grpc.so` 并重启 PHP-FPM。

### 5.2 创建 Service Provider

创建一个 Laravel Service Provider 来统一管理 OpenTelemetry 的初始化逻辑。这个 Provider 负责构建 TracerProvider、注册全局 Tracer，并配置好资源信息：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\TracerInterface;
use OpenTelemetry\API\Trace\TracerProviderInterface;
use OpenTelemetry\Contrib\Grpc\GrpcTransportFactory;
use OpenTelemetry\Contrib\Otlp\SpanExporter;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Common\Time\ClockFactory;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SDK\Sdk;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\SDK\Trace\TracerProvider;

class OpenTelemetryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TracerProviderInterface::class, function () {
            $resource = ResourceInfoFactory::merge(
                ResourceInfo::create(
                    Attributes::create([
                        'service.name' => config('app.name', 'laravel-app'),
                        'service.version' => config('app.version', '1.0.0'),
                        'deployment.environment' => app()->environment(),
                        'service.instance.id' => gethostname(),
                    ])
                ),
                ResourceInfo::defaultResource()
            );

            $endpoint = env('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector:4317');

            $transport = (new GrpcTransportFactory())->create(
                $endpoint . '/v1/traces',
                'application/x-protobuf'
            );

            $exporter = new SpanExporter($transport);

            $batchProcessor = new BatchSpanProcessor(
                $exporter,
                ClockFactory::getDefault(),
                512, 5000, 30000, 2048
            );

            return TracerProvider::builder()
                ->setResource($resource)
                ->addSpanProcessor($batchProcessor)
                ->build();
        });

        $this->app->singleton(TracerInterface::class, function () {
            return $this->app
                ->make(TracerProviderInterface::class)
                ->getTracer('laravel-app', '1.0.0');
        });
    }

    public function boot(): void
    {
        Sdk::builder()
            ->setTracerProvider($this->app->make(TracerProviderInterface::class))
            ->buildAndRegisterGlobal();
    }
}
```

### 5.3 HTTP 请求自动埋点中间件

创建一个中间件来自动为每个 HTTP 请求创建链路追踪 Span，记录请求方法、路径、状态码和耗时等关键信息：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use Symfony\Component\HttpFoundation\Response;

class OpenTelemetryMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $tracer = Globals::tracerProvider()->getTracer('laravel-http');

        $spanName = sprintf('%s %s', $request->method(), $request->route()?->uri() ?? $request->path());

        $span = $tracer->spanBuilder($spanName)
            ->setSpanKind(SpanKind::KIND_SERVER)
            ->setAttribute('http.method', $request->method())
            ->setAttribute('http.url', $request->fullUrl())
            ->setAttribute('http.scheme', $request->scheme())
            ->setAttribute('http.host', $request->host())
            ->setAttribute('http.target', $request->path())
            ->setAttribute('http.user_agent', $request->userAgent() ?? '')
            ->startSpan();

        $scope = $span->activate();

        try {
            $response = $next($request);
            $span->setAttribute('http.status_code', $response->getStatusCode());
            if ($response->getStatusCode() >= 400) {
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

### 5.4 数据库查询埋点

利用 Laravel 的数据库事件系统，自动为每个 SQL 查询创建子 Span，方便分析慢查询和数据库性能瓶颈：

```php
<?php

namespace App\Providers;

use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class DatabaseTracingServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        DB::listen(function (QueryExecuted $query) {
            $tracer = Globals::tracerProvider()->getTracer('laravel-db');

            $span = $tracer->spanBuilder('db.query')
                ->setSpanKind(SpanKind::KIND_CLIENT)
                ->setAttribute('db.system', $this->detectDbSystem($query->connectionName))
                ->setAttribute('db.statement', $query->sql)
                ->setAttribute('db.duration_ms', $query->time)
                ->setAttribute('db.name', $query->connection->getDatabaseName())
                ->startSpan();

            if ($query->time > 1000) {
                $span->setStatus(StatusCode::ERROR, 'Slow query detected');
                $span->setAttribute('db.slow_query', true);
            }

            $span->end();
        });
    }

    private function detectDbSystem(?string $connection): string
    {
        return match ($connection) {
            'mysql'  => 'mysql',
            'pgsql'  => 'postgresql',
            'sqlite' => 'sqlite',
            'sqlsrv' => 'mssql',
            default  => 'unknown',
        };
    }
}
```

### 5.5 环境变量配置

在 Laravel 的 `.env` 文件中添加以下配置，通过环境变量控制 OpenTelemetry 的行为：

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_SERVICE_NAME=laravel-app
OTEL_RESOURCE_ATTRIBUTES=service.version=1.0.0,deployment.environment=production
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_PHP_AUTOLOAD_ENABLED=true
```

## 六、生产环境数据治理最佳实践

### 6.1 多租户数据隔离

在 SaaS 场景中，不同租户的遥测数据需要进行隔离和区分。可以通过在 Laravel 中间件中从请求头提取租户标识并注入到 Span 属性中，再由 Collector 的 Batch Processor 按租户维度进行分组发送。这样在后端系统中就可以按租户进行数据查询和分析，同时避免不同租户的数据混在一起造成干扰。

### 6.2 敏感数据合规处理

数据安全合规是遥测数据治理中不可忽视的一环。GDPR 和国内的数据安全法规都对个人身份信息的采集和存储有严格要求。Collector 的 Attributes Processor 提供了 `hash` 和 `delete` 两种操作来应对这个需求。对于需要保留可追溯性但不能暴露原始值的字段（如用户邮箱、手机号），使用 SHA256 哈希处理。对于完全不需要出现在遥测数据中的字段（如 Authorization 请求头、Cookie 信息、请求体中的密码字段），直接删除即可。这种集中式的脱敏策略比在每个应用中分别处理要可靠得多。

### 6.3 智能采样降低成本

在日均请求量达到千万级别的 Laravel 应用中，全量采集链路数据会产生巨大的存储和计算成本。尾部采样通过等待完整的 Trace 完成后再做决策，可以做到精准控制：始终保留所有错误链路用于故障诊断，因为错误链路的占比通常很低但价值很高；始终保留响应时间超过阈值的慢请求链路用于性能分析；对关键业务路径（如订单创建、支付回调）全量保留以确保业务可追溯性；对其余正常请求按百分之十五左右的比例采样以控制总体数据量。

### 6.4 Collector 自身监控

不要忘记监控 Collector 本身。Collector 也会暴露自身的遥测数据，包括接收量、处理延迟、队列深度、导出失败率等关键指标。通过配置 `service.telemetry.metrics` 开启自监控，将这些指标接入 Prometheus 和 Grafana 建立完善的告警规则。特别需要关注的指标包括：导出失败率持续升高说明后端存储出现问题，队列深度持续增长说明 Collector 的处理能力不足需要扩容，内存使用量持续增长可能是内存泄漏的信号。

## 七、总结

OpenTelemetry Collector 的三阶段 Pipeline 架构为 Laravel 应用的遥测数据治理提供了强大而灵活的基础设施。通过合理配置 Receiver、Processor 和 Exporter，我们可以实现：通过 OTLP 协议统一接收链路追踪、性能指标和应用日志三类信号；通过 Processor 链实现数据的标准化、安全脱敏、过滤降噪和智能采样；通过多 Exporter Fan-out 将数据同时发送到多个后端存储系统实现多维度的可观测性；通过尾部采样和数据过滤有效控制存储成本；通过集中的脱敏策略满足数据安全合规要求。

在实际项目中，建议采用 Sidecar 或 DaemonSet 模式部署 Collector 以减少网络延迟，利用发送队列和重试机制确保数据可靠性。可观测性建设是一个持续迭代的过程，从最小可行的 Pipeline 配置开始逐步完善 Processor 链路，不断优化采样策略，你的 Laravel 应用将获得强大的可观测性能力，为业务稳定运行保驾护航。

## 相关阅读

- [Grafana Tempo + OpenTelemetry 实战：Laravel 异步订单链路追踪、消息上下文透传与采样治理踩坑记录](/2026/05/03/grafana-tempo-opentelemetry-guide-laravel/) — 结合 Laravel 订单链路的线上经验，详解 traceparent 透传、Horizon 常驻进程上下文清理与采样治理的真实踩坑，与本文 Collector Pipeline 配置形成互补。
- [链路追踪实战：Jaeger/SkyWalking 在 Laravel 微服务中的应用](/2026/05/16/distributed-tracing-jaeger-skywalking/) — 从 OpenTelemetry SDK 接入、跨服务上下文传播、采样策略到生产环境性能调优，覆盖链路追踪后端选型的完整对比。
- [Grafana Pyroscope 实战：持续性能剖析——Laravel 应用的生产环境火焰图与根因定位方法论](/2026/06/04/Grafana-Pyroscope-实战-持续性能剖析-Laravel应用的生产环境火焰图与根因定位方法论/) — 构建可观测性第四支柱，与本文的 Traces/Metrics/Logs 三支柱形成完整可观测性体系。
