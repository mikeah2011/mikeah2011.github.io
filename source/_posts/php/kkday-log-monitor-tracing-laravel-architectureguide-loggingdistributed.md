---

title: kkday/log + kkday/monitor + kkday/tracing 实战：Laravel 可观测性架构——日志聚合、指标采集与分布式追踪踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 01:40:51
updated: 2026-05-05 01:43:32
categories:
  - php
keywords: [kkday, log, monitor, tracing, Laravel, 可观测性架构, 日志聚合, 指标采集与分布式追踪踩坑记录]
tags:
- KKday
- Laravel
- 微服务
- 监控
- 可观测性
- Prometheus
- OpenTelemetry
- 日志
- Monolog
- 分布式
description: 基于 KKday B2C Backend 30+ 仓库真实生产项目，深度拆解 Laravel 可观测性架构落地实战全记录。本文从三大核心模块出发，系统讲解 kkday/log 结构化日志规范与 Monolog 自定义处理器链定制、kkday/monitor Prometheus RED 指标采集与高基数标签防护策略、kkday/tracing OpenTelemetry 分布式追踪与 Trace Context 跨队列透传机制。涵盖完整的 PHP 可运行代码示例、生产部署检查清单、Grafana 告警规则配置、真实线上排查案例与踩坑速查表，助你构建日志、指标、追踪三位一体的可观测性体系，适合需要搭建 Laravel 监控告警体系的 PHP 开发者参考。
---


在 KKday B2C API 项目中，我们经历了从「打印日志就是可观测」到「日志、指标、追踪三位一体」的演变。初期用 `Log::info()` 打印字符串，出了问题靠 `grep` 搜日志文件；中期接入 Sentry 收错误、Prometheus 拿 QPS；后期才把三个信号串联起来——一次请求出错，能在 Grafana 上从 RED 指标跳到对应 Trace，再从 Trace 里拉出关联的 Structured Log。这篇文章记录的就是这个演进过程中，`kkday/log`、`kkday/monitor`、`kkday/tracing` 三个内部包的实际落地方式与踩过的坑。

## 一、整体架构：三大信号如何在 Laravel 中协同

```text
                         ┌─────────────────────────────────────────┐
                         │            Grafana / Kibana              │
                         └──────┬──────────┬──────────┬─────────────┘
                                │          │          │
                         Loki/Promtail  Prometheus  Tempo
                                │          │          │
                         ┌──────┴──────────┴──────────┴─────────────┐
                         │         OpenTelemetry Collector           │
                         │    (receive → batch → export multi-sink)  │
                         └──────┬──────────┬──────────┬─────────────┘
                                │          │          │
                    ┌───────────┴──┐  ┌────┴────┐  ┌──┴──────────┐
                    │  kkday/log   │  │kkday/   │  │kkday/       │
                    │  Monolog     │  │monitor  │  │tracing      │
                    │  JSON Handler│  │Prometheu│  │OTLP + Context│
                    └──────┬───────┘  │s Client │  │Propagation   │
                           │         └────┬────┘  └──┬──────────┘
                           │              │          │
                    ┌──────┴──────────────┴──────────┴─────────────┐
                    │               Laravel Application             │
                    │  Controller → Service → Repository → Queue   │
                    └──────────────────────────────────────────────┘
```

三个包各司其职：

- **kkday/log**：Structured Logging 封装，统一日志格式（JSON），注入 request_id / trace_id / user_id 等上下文字段
- **kkday/monitor**：Prometheus Client 封装，暴露 RED（Rate-Error-Duration）指标，支持 Histogram / Counter / Gauge
- **kkday/tracing**：OpenTelemetry SDK 封装，自动生成 Span，透传 Trace Context 到 HTTP Client 和 Queue Job

## 二、kkday/log：Monolog 定制与 Structured Logging 规范

### 2.1 为什么不用 Log::info 直接打字符串？

最初的代码长这样：

```php
// ❌ 原始写法：不可搜索、不可聚合
Log::info("User 12345 created order ORD-20260430-001, amount: 5999");
```

问题在于：要在 Loki 里搜「哪些订单金额超过 5000」，只能靠正则，误报率极高。

### 日志方案对比：字符串 vs Structured vs Contextual

| 方案 | 日志格式 | 可查询性 | 上下文注入 | 性能开销 | 适用场景 |
|------|----------|----------|------------|----------|----------|
| `Log::info("string")` | 纯文本 | ❌ 需正则 | ❌ 手动拼接 | 低 | 本地调试 |
| `Log::info('msg', $data)` | 数组上下文 | ⚠️ 部分字段可查 | ❌ 手动 | 低 | 小项目 |
| **kkday/log JSON** | 结构化 JSON | ✅ 全字段可查 | ✅ Processor 自动注入 | 中 | 生产环境 |
| Contextual Logging (Laravel 11+) | 数组上下文 | ✅ | ✅ `Log::context()` | 低 | Laravel 11+ 新项目 |

> **选型建议**：如果团队已在 Laravel 11+，优先评估 Contextual Logging；如果需要跨服务统一格式、自定义 Processor 链，kkday/log 的 Monolog Processor 机制更灵活。

### 2.2 Structured Logging 的正确姿势

`kkday/log` 核心是一个自定义的 Monolog Processor，它会自动注入上下文字段：

```php
// packages/kkday-log/src/Processor/RequestContextProcessor.php
namespace Kkday\Log\Processor;

use Monolog\Processor\ProcessorInterface;

class RequestContextProcessor implements ProcessorInterface
{
    public function __invoke(array $record): array
    {
        $record['extra'] = array_merge($record['extra'], [
            'request_id'  => app('request-id') ?? null,
            'trace_id'    => app('trace-id') ?? null,
            'span_id'     => app('span-id') ?? null,
            'user_id'     => auth()->id() ?? null,
            'service'     => config('kkday-log.service_name'),
            'env'         => config('app.env'),
        ]);

        return $record;
    }
}
```

在 `config/logging.php` 中注册为全局 Processor：

```php
'channels' => [
    'kkday' => [
        'driver' => 'monolog',
        'handler' => StreamHandler::class,
        'formatter' => \Kkday\Log\Formatter\JsonLineFormatter::class,
        'processors' => [
            \Kkday\Log\Processor\RequestContextProcessor::class,
            \Kkday\Log\Processor\MemoryUsageProcessor::class,
        ],
    ],
],
```

实际调用时只传业务数据：

```php
// ✅ Structured 写法：每个字段都可查询
Log::channel('kkday')->info('order.created', [
    'order_id'    => $order->id,
    'user_id'     => $order->user_id,
    'amount'      => $order->amount,
    'currency'    => $order->currency,
    'items_count' => $order->items->count(),
]);
```

输出到文件的 JSON 长这样：

```json
{
  "level": "INFO",
  "message": "order.created",
  "datetime": "2026-05-05T01:30:12.345+08:00",
  "context": {
    "order_id": "ORD-20260505-001",
    "user_id": 12345,
    "amount": 5999,
    "currency": "TWD",
    "items_count": 3
  },
  "extra": {
    "request_id": "req-a1b2c3d4",
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    "span_id": "00f067aa0ba902b7",
    "user_id": 12345,
    "service": "b2c-api",
    "env": "production"
  }
}
```

### 2.2.1 敏感字段自动脱敏

生产环境中，日志里混入密码、Token、信用卡号是安全合规的红线。`kkday/log` 内置了 SensitiveDataProcessor，支持正则规则自动脱敏：

```php
// packages/kkday-log/src/Processor/SensitiveDataProcessor.php
namespace Kkday\Log\Processor;

use Monolog\Processor\ProcessorInterface;

class SensitiveDataProcessor implements ProcessorInterface
{
    private array $patterns = [
        '/password/i'          => '***REDACTED***',
        '/token/i'             => '***REDACTED***',
        '/card_number/i'       => '****-****-****-####',
        '/email/i'             => '***@***.com',
    ];

    public function __invoke(array $record): array
    {
        $record['context'] = $this->sanitize($record['context']);
        $record['extra']   = $this->sanitize($record['extra']);
        return $record;
    }

    private function sanitize(array $data): array
    {
        foreach ($data as $key => $value) {
            if (!is_string($value)) continue;
            foreach ($this->patterns as $pattern => $replacement) {
                if (preg_match($pattern, $key)) {
                    $data[$key] = $replacement;
                }
            }
        }
        return $data;
    }
}
```

在 `config/logging.php` 的 processors 数组中注册即可全局生效：

```php
'processors' => [
    \Kkday\Log\Processor\RequestContextProcessor::class,
    \Kkday\Log\Processor\MemoryUsageProcessor::class,
    \Kkday\Log\Processor\SensitiveDataProcessor::class,  // 放在最后，确保脱敏
],
```

### Monolog Handler 选型对比

| Handler | 写入方式 | 适用场景 | 注意事项 |
|---------|----------|----------|----------|
| StreamHandler | 每条立即写入 | 队列 Worker、高可靠性场景 | I/O 开销较高 |
| BufferHandler | 缓冲后批量写 | Web 请求、低频写入 | 长驻进程不触发 close() |
| RotatingFileHandler | 按天轮转 | 本地日志文件 | 需配 `daily` 轮转策略 |
| SyslogHandler | 写入 syslog | Docker/K8s 容器环境 | 需要 syslog 服务 |
| SocketHandler | TCP/UDP 发送 | 远程日志聚合（如 Logstash） | 网络中断丢日志 |

### 2.3 踩坑：Monolog Buffer Handler 与队列消费者的死锁

**场景**：在 Horizon Worker 中使用 `BufferHandler` 批量写日志，本意是减少 I/O。结果 Worker 常驻进程不触发 `close()`，Buffer 里的日志一直不落盘，直到进程被 `SIGTERM` 杀掉才刷出来。

**解法**：队列场景禁用 BufferHandler，改用直接写入：

```php
// config/logging.php
'kkday_queue' => [
    'driver' => 'monolog',
    'handler' => StreamHandler::class,
    // 不包装 BufferHandler，直接写磁盘
    'formatter' => \Kkday\Log\Formatter\JsonLineFormatter::class,
],
```

如果日志量真的大到需要缓冲，就在 Job 处理完的 `finally` 块里手动 flush：

```php
public function handle(): void
{
    try {
        // ... 业务逻辑
    } finally {
        Log::channel('kkday_queue')->getLogger()->close();
    }
}
```

## 三、kkday/monitor：Prometheus 指标采集与 RED 方法论

### 3.1 RED vs USE：B2C API 应该选哪个？

| 方法论 | 含义 | 适用场景 |
|--------|------|----------|
| **RED** | Rate（请求速率）、Error（错误率）、Duration（延迟） | 面向请求的服务（API、Web） |
| **USE** | Utilization（利用率）、Saturation（饱和度）、Error（错误） | 面向资源的服务（数据库、队列） |

B2C API 是典型的请求驱动服务，选 RED。`kkday/monitor` 封装了 Prometheus PHP Client，自动生成中间件：

```php
// packages/kkday-monitor/src/Middleware/RecordMetrics.php
namespace Kkday\Monitor\Middleware;

use Kkday\Monitor\MetricsCollector;

class RecordMetrics
{
    public function handle($request, Closure $next)
    {
        $timer = MetricsCollector::startTimer('http_request_duration_seconds', [
            'method' => $request->method(),
            'route'  => $request->route()?->getName() ?? 'unknown',
        ]);

        $response = $next($request);

        MetricsCollector::incrementCounter('http_requests_total', [
            'method' => $request->method(),
            'route'  => $request->route()?->getName() ?? 'unknown',
            'status' => $response->getStatusCode(),
        ]);

        $timer->observe();

        return $response;
    }
}
```

### 3.2 自定义业务指标

除了 HTTP 层面的 RED，业务指标同样重要：

```php
// 在 Service 层记录业务指标
use Kkday\Monitor\MetricsCollector;

class CreateOrderService
{
    public function execute(CreateOrderRequest $request): Order
    {
        $timer = MetricsCollector::startTimer('order_creation_duration_seconds');

        $order = $this->createOrder($request);

        MetricsCollector::incrementCounter('orders_created_total', [
            'currency'  => $order->currency,
            'channel'   => $request->input('channel', 'web'),
        ]);

        MetricsCollector::observeHistogram('order_amount_distribution', $order->amount, [
            'currency' => $order->currency,
        ]);

        $timer->observe();

        return $order;
    }
}
```

### Prometheus 指标类型速查

| 类型 | 用途 | PHP Client 方法 | 典型场景 |
|------|------|----------------|----------|
| **Counter** | 只增不减的累加计数 | `incrementCounter()` | 请求总数、订单创建数、错误次数 |
| **Gauge** | 可增可减的瞬时值 | `setGauge()` | 队列长度、内存使用、在线用户数 |
| **Histogram** | 值分布统计 | `observeHistogram()` | 请求延迟、订单金额分布 |
| **Summary** | 客户端分位数计算 | `observeSummary()` | P50/P95/P99 延迟（注意：不推荐跨实例聚合） |

> **Histogram vs Summary**：生产环境优先选 Histogram，因为分位数在 Prometheus Server 端聚合更准确；Summary 在客户端计算，跨实例无法聚合。

### Grafana PromQL 实用查询

```promql
# 请求 QPS（按路由分组）
sum(rate(http_requests_total[5m])) by (route)

# P99 延迟（95 分位）
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))

# 错误率（5xx / 总请求）
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# 订单创建速率（按币种）
sum(rate(orders_created_total[5m])) by (currency)

# 内存使用趋势
process_resident_memory_bytes / 1024 / 1024
```

### 3.3 踩坑：High Cardinality 指标把 Prometheus 打爆

**场景**：初期把 `user_id` 作为 label 放进 Counter，30 万注册用户产生了 30 万条时间序列，Prometheus 内存 OOM。

**规则**：label 的基数（cardinality）必须可预测且有上限。

```php
// ❌ 致命：用户 ID 作为 label
MetricsCollector::incrementCounter('api_calls', ['user_id' => $userId]);

// ✅ 正确：用分桶代替精确值
MetricsCollector::observeHistogram('order_amount_distribution', $amount, [
    'currency' => $currency,
    'tier'     => $this->getUserTier($userId), // 'basic' | 'premium' | 'vip'
]);
```

`kkday/monitor` 内置了 label 白名单机制，超出阈值会自动降级为 `_overflow`：

```php
// packages/kkday-monitor/src/LabelGuard.php
public function sanitize(string $key, string $value): string
{
    if ($this->cardinality($key) > $this->maxCardinality($key)) {
        return '_overflow';
    }
    return $value;
}
```

## 四、kkday/tracing：分布式追踪与 Trace Context 透传

### 4.1 Span 生成策略

`kkday/tracing` 基于 OpenTelemetry PHP SDK，自动为 Laravel 创建 Span：

```php
// packages/kkday-tracing/src/TracingServiceProvider.php
public function boot(): void
{
    // HTTP 入口：创建 Root Span
    $this->app->middleware->push(
        \Kkday\Tracing\Middleware\StartSpanMiddleware::class
    );

    // HTTP Client：自动注入 traceparent header
    \Illuminate\Support\Facades\Http::macro('traced', function () {
        return Http::withHeaders(
            \Kkday\Tracing\ContextPropagator::getOutgoingHeaders()
        );
    });

    // Queue Job：自动从 payload 恢复 Trace Context
    Queue::createPayloadUsing(function ($connection, $queue, $payload) {
        return array_merge($payload, [
            'trace_context' => \Kkday\Tracing\ContextPropagator::toArray(),
        ]);
    });
}
```

### OpenTelemetry 采样策略对比

| 策略 | 说明 | 采样率 | 适用场景 |
|------|------|--------|----------|
| **AlwaysOn** | 100% 采集 | 全量 | 压测、本地调试 |
| **AlwaysOff** | 0% 采集 | 全弃 | 临时关闭追踪 |
| **TraceIdRatioBased** | 按 Trace ID 比例采样 | 可配置 | 生产环境（推荐 5-10%） |
| **ParentBased** | 子 Span 跟随父 Span 决策 | 继承 | 跨服务调用链 |
| **ParentBased + Ratio** | 根 Span 比例采样，子 Span 跟随 | 根采样 + 继承 | **生产推荐** |

```php
// packages/kkday-tracing/src/config/tracing.php
return [
    'service_name' => env('OTEL_SERVICE_NAME', 'b2c-api'),
    'sample_rate' => env('OTEL_SAMPLE_RATE', 0.1), // 生产 10%
    'error_sample_rate' => 1.0, // 错误请求 100% 采样
    'exporter' => env('OTEL_EXPORTER', 'otlp'), // otlp | zipkin | none
    'endpoint' => env('OTEL_ENDPOINT', 'http://otel-collector:4318'),
];
```

> **最佳实践**：生产环境用 `ParentBased(TraceIdRatioBased(0.1))`，保证根 Span 10% 采样，子 Span 跟随父决策；错误请求走兜底规则 100% 采样，确保线上问题可追溯。

### 4.2 跨队列 Trace 透传

这是最常被忽略但最致命的环节。如果 Trace 在 HTTP 入口创建，到 Queue Job 就断了，你永远无法追踪一个「下单 → 扣库存 → 发通知」的完整链路。

```php
// Job 自动恢复 Trace Context
class ReserveInventory implements ShouldQueue
{
    public function handle(): void
    {
        // kkday/tracing 的 Queue Middleware 自动从 payload 恢复
        // 此时 $this->span 已经是 parent span 的 child
        $span = app('tracer')->getCurrentSpan();

        $span->addEvent('inventory.reserving', [
            'order_id'   => $this->order->id,
            'product_id' => $this->order->product_id,
        ]);

        $this->inventoryService->reserve($this->order);

        $span->addEvent('inventory.reserved');
    }
}
```

### 4.3 踩坑：Trace Context 丢失的三种场景

**场景 1：Redis Queue 序列化丢字段**

`Queue::createPayloadUsing` 在 `sync` 驱动下不会触发，本地开发调试时 Trace 全断。

```php
// 解法：在 base Job 里兜底
abstract class TracedJob implements ShouldQueue
{
    public function __construct()
    {
        // 确保构造时就捕获上下文
        $this->traceContext = \Kkday\Tracing\ContextPropagator::toArray();
    }
}
```

**场景 2：批处理 Job（Bus::batch）上下文只传给第一个 Job**

Laravel 的 `Bus::batch` 序列化时只有第一个 Job 的 payload 会被精心构建，后续 Job 可能丢失 `trace_context`。

```php
// 解法：在 Batch 回调中也注入 context
Bus::batch([
    new ProcessItem($item1),
    new ProcessItem($item2),
])->then(function () {
    // 回调中手动创建新 span
    $span = app('tracer')->startSpan('batch.completed');
    $span->end();
})->onConnection('redis')->onQueue('batch');
```

**场景 3：Octane 常驻进程的 Span 泄漏**

Swoole 协程复用导致上一个请求的 Span 没被 `end()`，下一个请求拿到脏数据。

```php
// 解法：在 Octane RequestTerminated 事件里强制清理
Event::listen(RequestTerminated::class, function () {
    app('tracer')->forceFlush();
    app('tracer')->resetContext();
});
```

## 五、三者协同：从一个真实告警的完整排查流程

线上某天下午 3 点，Prometheus 告警 `/api/orders` 的 P99 延迟从 400ms 飙到 3200ms。

**Step 1：指标（kkday/monitor）发现异常**

在 Grafana RED 面板看到 Duration 飙升，Rate 未降（不是下游挂了），Error 略有上升。

**Step 2：Trace（kkday/tracing）定位慢点**

点击 Grafana 中的 P99 链路，发现一个 Trace 里 `payment.callback` Span 耗时 2100ms，其 child span `order.update_status` 卡在 DB Query。

**Step 3：日志（kkday/log）拿到细节**

用 `trace_id` 在 Loki 中搜索，发现这条日志：

```json
{
  "message": "order.update_status",
  "context": {
    "order_id": "ORD-20260505-892",
    "query_time_ms": 2087,
    "lock_wait_ms": 1950
  },
  "extra": {
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
  }
}
```

根因：大量并发支付回调同时更新同一张订单表的行锁，`lock_wait_ms` 占了 93%。

**解法**：支付回调改为乐观锁 + 队列串行化，延迟立刻回落。

## 踩坑速查表

| 模块 | 踩坑场景 | 根因 | 解法 |
|------|----------|------|------|
| kkday/log | BufferHandler 在队列中日志丢失 | 常驻进程不触发 `close()` | 队列场景改用 StreamHandler |
| kkday/log | 敏感数据泄露到日志 | 业务字段未脱敏 | 注册 SensitiveDataProcessor |
| kkday/log | 日志文件无限增长 | 未配置轮转 | 使用 RotatingFileHandler + `daily` |
| kkday/monitor | High Cardinality 打爆 Prometheus | `user_id` 等高基数字段做 label | 用分桶/白名单机制限制 label 基数 |
| kkday/monitor | /metrics 端点暴露到公网 | 未配置访问控制 | 仅内网可达 + IP 白名单 |
| kkday/monitor | Summary 跨实例聚合不准 | Summary 在客户端计算分位数 | 改用 Histogram，服务端聚合 |
| kkday/tracing | 队列 Job Trace 断链 | `createPayloadUsing` 在 sync 驱动不触发 | 基类构造时捕获上下文 |
| kkday/tracing | Bus::batch 后续 Job 丢 trace_context | 序列化时只有第一个 Job 完整构建 | Batch 回调中手动创建新 Span |
| kkday/tracing | Octane Span 泄漏 | Swoole 协程复用未清理 | `RequestTerminated` 事件中 `forceFlush()` + `resetContext()` |
| kkday/tracing | 采样率过高导致存储爆掉 | 生产环境用 100% 采样 | 降为 5-10%，错误请求兜底 100% |

## 六、生产部署 Checklist

```text
✅ kkday/log
  - 所有日志输出为 JSON 格式
  - request_id / trace_id 自动注入
  - 敏感字段（password, token, card_number）自动脱敏
  - 队列场景不用 BufferHandler
  - 日志文件按天轮转，保留 30 天

✅ kkday/monitor
  - RED 指标覆盖所有 API 路由
  - 业务指标 label 基数 < 1000
  - /metrics 端点仅内网可访问
  - Prometheus scrape interval = 15s
  - 告警规则：P99 > 1s 持续 5 分钟

✅ kkday/tracing
  - 采样率生产环境 10%（压测时 100%）
  - 队列 Job 的 Trace Context 透传已验证
  - Octane 场景的 Span 清理已覆盖
  - Tempo 保留周期 = 7 天
  - 错误请求 100% 采样（兜底规则）
```

## 总结

可观测性不是「接个 Sentry 就完了」。`kkday/log` 解决的是「发生了什么」，`kkday/monitor` 解决的是「系统状态如何」，`kkday/tracing` 解决的是「问题在哪里」。三者缺一不可，而且必须共享同一个 `trace_id` 才能串联起来。最深的教训是：**队列场景的 Context 透传**是整个链路最容易断的地方，也是排查异步问题时最救命的环节。

## 相关阅读

- [Prometheus + Grafana 监控体系实战：Laravel API 的 RED 指标、告警降噪与 SLO 看板落地踩坑记录](/categories/PHP/prometheus-grafana-monitoringguide-laravel-api-red-slo/)
- [Laravel Horizon 队列监控与生产环境运维实战：多队列优先级、指标采集与自动恢复踩坑记录](/categories/Misc/laravel-horizon-monitoringguide/)
- [Laravel Telescope 开发调试实战：请求追踪、队列监控与慢查询定位踩坑记录](/categories/PHP/laravel-telescope-guide-monitoringslow-query/)
