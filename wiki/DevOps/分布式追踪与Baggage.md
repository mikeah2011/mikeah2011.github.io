# 分布式追踪与 OpenTelemetry Baggage

## 定义

分布式追踪（Distributed Tracing）是微服务架构下追踪请求全链路路径的技术。当一个用户请求经过 API Gateway → 订单服务 → 支付服务 → 库存服务 → 消息队列时，分布式追踪通过 **Trace ID** 串联所有服务的处理记录，形成完整的调用链路（Trace）。OpenTelemetry 是 CNCF 的可观测性标准，统一了日志（Logs）、指标（Metrics）、追踪（Traces）三大支柱的数据采集和传输。**Baggage** 是 OpenTelemetry 的上下文传播机制，允许在服务间透传业务标签（如用户 ID、租户 ID、请求来源），用于关联日志、过滤指标和采样决策。

## 核心原理

### Trace 与 Span 模型

```
Trace（一次用户请求的完整链路）
├── Span A: API Gateway (100ms)
│   ├── Span B: Order Service (80ms)
│   │   ├── Span C: Payment Service (50ms)
│   │   │   └── Span D: Stripe API (40ms)
│   │   └── Span E: Inventory Service (20ms)
│   └── Span F: Log Service (10ms)
```

每个 Span 包含：
- **Trace ID**：全局唯一，串联整个请求链路
- **Span ID**：当前操作的唯一标识
- **Parent Span ID**：父操作的 ID（构成树形结构）
- **Attributes**：操作的元数据（HTTP method、DB statement 等）
- **Events**：操作中的关键事件（异常、重试等）
- **Status**：OK / ERROR / UNSET

### OpenTelemetry Baggage

Baggage 是一种 **跨服务的上下文传播机制**，通过 HTTP Header（`baggage`）在服务间传递键值对：

```
用户请求 → API Gateway
  baggage: user_id=12345, tenant=acme, source=mobile

API Gateway → Order Service（自动透传 baggage）
  baggage: user_id=12345, tenant=acme, source=mobile

Order Service → Payment Service（自动透传 baggage）
  baggage: user_id=12345, tenant=acme, source=mobile
```

**Baggage 的三个核心用途**：

1. **日志关联**：将 `user_id` 注入所有服务的日志，支持跨服务日志查询
2. **指标过滤**：按 `tenant` 标签过滤 Prometheus 指标，实现多租户指标隔离
3. **采样决策**：根据 `source=mobile` 决定是否采样（移动端请求可能需要更高采样率）

### Laravel 集成

```php
// 1. 在中间件中提取 Baggage
public function handle($request, Closure $next)
{
    $baggage = Baggage::getCurrent();
    $userId = $baggage->getValue('user_id');
    $tenant = $baggage->getValue('tenant');
    
    // 注入到 Laravel Log Context
    Log::withContext([
        'user_id' => $userId,
        'tenant' => $tenant,
        'trace_id' => Span::getCurrent()->getContext()->getTraceId(),
    ]);
    
    return $next($request);
}

// 2. 在 HTTP Client 中传播 Baggage
Http::withHeaders([
    'baggage' => Baggage::getCurrent()->serialize(),
])->post('http://payment-service/pay', $data);

// 3. 在 Span Attributes 中添加业务标签
$span = Span::getCurrent();
$span->setAttribute('user.id', $userId);
$span->setAttribute('tenant.name', $tenant);
```

### 采样策略

| 策略 | 说明 | 适用场景 |
|---|---|---|
| **全量采样** | 100% 请求都记录 | 开发/Staging 环境 |
| **概率采样** | 固定比例（如 10%） | 生产环境基础采样 |
| **尾部采样** | 只记录异常/慢请求 | 生产环境精准采样 |
| **自适应采样** | 根据流量动态调整采样率 | 高流量生产环境 |

**推荐的生产采样策略**：
- 错误请求（5xx）：100% 采样
- 慢请求（> 1s）：100% 采样
- 正常请求：1-10% 采样
- 健康检查：0% 采样（排除噪音）

## 实战案例

来自博客文章：
- [OpenTelemetry Baggage 实战：跨服务上下文传播——分布式追踪中的业务标签透传与采样策略](/2026/06/01/opentelemetry-baggage-context-propagation/)
- [OpenTelemetry 实战：统一日志/指标/追踪的可观测性标准——Laravel 应用全链路埋点](/2026/06/02/opentelemetry-unified-observability-laravel-full-stack-instrumentation/)
- [Distributed Tracing 实战：OpenTelemetry SDK 在 Laravel 中的端到端链路追踪](/2026/06/01/distributed-tracing-opentelemetry-sdk-laravel/)

## 相关概念

- [OpenTelemetry 可观测性](OpenTelemetry可观测性.md) — 可观测性三支柱总览
- [Prometheus 监控告警](Prometheus监控告警.md) — 指标采集与告警
- [Grafana Loki 日志聚合](GrafanaLoki日志聚合.md) — 日志聚合与 Trace ID 关联
- [应用性能剖析与 Profiling](应用性能剖析与Profiling.md) — 单服务深度性能分析
- [SRE 与可靠性工程](SRE与可靠性工程.md) — SLI 数据来源

## 常见问题

**Q: Baggage 和 Span Attributes 有什么区别？**
A: Span Attributes 只在当前 Span 内可见；Baggage 会自动通过 HTTP Header 传播到下游所有服务。Baggage 适合需要跨服务关联的数据（如 user_id、tenant），Span Attributes 适合单服务内的元数据（如 SQL 查询语句）。

**Q: Baggage 会不会增加网络开销？**
A: 会，但很小。Baggage 通过 HTTP Header 传输，通常只有几百字节。建议控制 Baggage 的 Key 数量（< 10 个），避免传递大量数据。

**Q: 如何在 Laravel 中同时使用 Sentry 和 OpenTelemetry？**
A: Sentry 支持 OpenTelemetry 协议。配置 Sentry 的 `traces_sample_rate` 和 OpenTelemetry SDK 使用同一个 Trace ID，两者可以共享链路数据。Sentry 负责错误追踪和性能监控，OpenTelemetry 负责全链路追踪和指标采集。
