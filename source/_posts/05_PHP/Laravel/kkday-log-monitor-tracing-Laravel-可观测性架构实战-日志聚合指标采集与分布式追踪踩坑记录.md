---
title: kkday/log + kkday/monitor + kkday/tracing 实战：Laravel 可观测性架构——日志聚合、指标采集与分布式追踪踩坑记录
date: 2026-05-05 01:40:51
updated: 2026-05-05 01:43:32
categories:
  - 05_PHP
  - Laravel
tags:
  - Laravel
  - Observability
  - Logging
  - Monitoring
  - Tracing
  - KKday
  - Monolog
  - Prometheus
  - OpenTelemetry
description: 基于 KKday B2C Backend 真实项目，记录 kkday/log、kkday/monitor、kkday/tracing 三个内部包如何在 Laravel 中落地日志聚合、指标采集与分布式追踪，覆盖 Structured Logging 规范、Monolog Handler 定制、Prometheus RED 指标暴露、Trace Context 跨队列透传的完整链路与踩坑经验。
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
