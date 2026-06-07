# OpenTelemetry 可观测性

## 定义

OpenTelemetry（简称 OTel）是 CNCF 孵化的可观测性统一标准，由 OpenTracing 和 OpenCensus 合并而来。它定义了一套 vendor-neutral 的 API、SDK 和协议（OTLP），用于采集、传输和导出日志（Logs）、指标（Metrics）和追踪（Traces）三大可观测性信号，被称为"可观测性的 USB 接口"。

## 核心原理

### 三大信号
1. **Traces（追踪）**：记录一次请求在多个服务间的完整调用链。每个 Span 代表一个操作单元，包含操作名、耗时、状态和上下文（Context）
2. **Metrics（指标）**：数值型时间序列数据，用于监控系统健康状态（类似 Prometheus 指标）
3. **Logs（日志）**：带时间戳的离散事件记录，OTel 为其定义了结构化日志规范

### OTLP 协议
OpenTelemetry Protocol（OTLP）是 OTel 的原生传输协议，基于 gRPC 或 HTTP/protobuf，支持三大信号的统一传输。相比 Prometheus 的拉取模型，OTLP 采用推送模型（Push-based），更适合 Serverless 和短生命周期任务。

### 全链路埋点
```php
// Laravel 中的 Trace 埋点示例
$tracer = Globals::tracerProvider()->getTracer('b2c-api');

$scope = $tracer->spanBuilder('process-order')
    ->setAttribute('order.id', $orderId)
    ->setAttribute('user.id', $userId)
    ->startSpan();

try {
    // 业务逻辑
    $this->validateOrder($orderId);
    $this->processPayment($orderId);
    $scope->setStatus(StatusCode::OK);
} catch (\Throwable $e) {
    $scope->recordException($e);
    $scope->setStatus(StatusCode::ERROR, $e->getMessage());
} finally {
    $scope->end();
}
```

### Context Propagation（上下文传播）
跨服务调用时，Trace Context 通过 HTTP Header（`traceparent`、`tracestate`）传播，保证整条调用链被串联为同一个 Trace。

### SDK 架构
- **API 层**：定义接口（Tracer、Meter、Logger）
- **SDK 层**：实现接口，管理 Span 生命周期、采样策略
- **Exporter 层**：将数据导出到后端（Jaeger、Prometheus、Grafana Tempo、Elasticsearch）

### 采样策略
- **AlwaysOn/AlwaysOff**：全量/不采集，适合开发环境
- **TraceIdRatioBased**：按比例采样（如 10%），适合生产环境
- **ParentBased**：继承父 Span 的采样决策，保证同一 Trace 内的一致性
- **尾部采样（Tail-based）**：在 Span 结束后根据结果决定是否保留，适合捕获错误请求

## 与传统方案对比

| 维度 | 传统方案（各管各的） | OpenTelemetry |
|---|---|---|
| 日志 | ELK / Loki | OTel Logs → Loki |
| 指标 | Prometheus | OTel Metrics → Prometheus |
| 追踪 | Jaeger / Zipkin | OTel Traces → Tempo/Jaeger |
| 上下文 | 各自定义 | 统一的 W3C TraceContext |
| 厂商锁定 | 高 | 低（vendor-neutral） |

## 实战案例

来自博客文章：
- [OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准——Laravel 应用全链路埋点](/2026/06/02/opentelemetry-unified-observability-laravel-full-stack-instrumentation/) — Laravel 应用的 OTel 集成完整方案
- [Sentry 实战：错误追踪深度使用](/2026/06/02/sentry-error-tracking-performance-monitoring-session-replay-laravel/) — Sentry 与 OTel 的集成

## 相关概念

- [Prometheus 监控告警](Prometheus监控告警.md) — OTel Metrics 的主要后端
- [Grafana Loki 日志聚合](GrafanaLoki日志聚合.md) — OTel Logs 的主要后端
- [AI Agent 驱动 DevOps](AI-Agent驱动DevOps.md) — 基于 OTel 数据的智能分析

## 常见问题

### 性能开销
- 默认采样率设为 10%，高峰时可降到 1%
- 使用 BatchSpanProcessor 批量导出，减少网络开销
- 避免在高频路径上创建过多 Span

### 集成复杂度
- 优先使用 auto-instrumentation（自动埋点）而非手动埋点
- Laravel 可通过 Middleware 自动注入 HTTP Span
- 数据库查询可通过 PDO wrapper 自动埋点
