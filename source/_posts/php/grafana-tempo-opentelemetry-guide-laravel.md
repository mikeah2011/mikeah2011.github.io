---

title: Grafana Tempo + OpenTelemetry 实战：Laravel 异步订单链路追踪、消息上下文透传与采样治理踩坑记录
keywords: [Grafana Tempo, OpenTelemetry, Laravel, 异步订单链路追踪, 消息上下文透传与采样治理踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 10:55:06
updated: 2026-05-03 10:56:22
categories:
- php
tags:
- Laravel
- 微服务
- 消息队列
- 监控
- OpenTelemetry
- Grafana
- Tempo
- trace
description: 本文基于 Laravel B2C 订单系统的线上实战经验，详细讲解如何使用 Grafana Tempo + OpenTelemetry 构建跨 HTTP、队列与回调的完整链路追踪体系。内容涵盖 traceparent 在 Laravel Queue 中的透传机制、Horizon 常驻进程的上下文清理与 trace 污染治理、Monolog 日志与 Trace ID 的关联查询、Collector 采样策略配置，以及采样率过高导致可观测性系统自身成为瓶颈的真实踩坑与优化方案，适合需要在 Laravel 微服务架构中落地分布式追踪的后端工程师参考。
---



很多团队把“链路追踪”做成了请求日志增强版：入口有 request_id，出口有慢 SQL，Grafana 上也能看到接口耗时，但一旦业务穿过 **HTTP → Queue → 支付回调 → 库存预留**，链路就断了。我这次补的不是一个 APM 面板，而是把订单创建、支付确认、库存冻结三段真正串成同一条 Trace。

场景是 Laravel B2C API：用户下单后先写订单，再丢 `ReserveInventory` 任务到队列，库存服务处理完成后回调订单状态。事故发生时，Prometheus 看到 `/api/orders` P95 只有 280ms，但用户还是投诉“支付后 20 秒才确认成功”。后来发现慢点根本不在入口接口，而在异步消费者。没有跨 Queue 的 Trace，这种问题只能靠猜。

## 一、最终上线的追踪架构

```text
User/App
   |
   v
Nginx / Ingress
   |
   v
Laravel API
(OrderController, Middleware, Queue::dispatch)
   |                    \
   | OTLP                \ traceparent 写入 payload
   v                     \
OpenTelemetry Collector   ---> Redis Queue / Horizon Worker
   |                               |
   |                               v
   |<--------- OTLP --------------- Inventory Job Consumer
   |
   +----> Grafana Tempo
   +----> Loki / Monolog(JSON)
   +----> Prometheus(指标单独采集)
```

这里我刻意没有把 Collector 省掉。应用直接打 Tempo 在开发环境看起来简单，线上一旦要做采样、批量发送、限流和 exporter 切换，就会把逻辑写回业务应用里，后面维护非常痛苦。

## 二、Laravel 入口只做一件事：接住或创建 Trace

入口中间件的目标不是“记录日志”，而是保证请求一进来就有统一的 `trace_id`，并且后续 HTTP Client、Queue、日志都从这里取上下文。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Trace\Span;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\Context\Context;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use Symfony\Component\HttpFoundation\Response;

final class StartTraceMiddleware
{
    public function __construct(private readonly \OpenTelemetry\API\Trace\TracerInterface $tracer)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $parentContext = TraceContextPropagator::getInstance()->extract($request->headers->all());

        $span = $this->tracer
            ->spanBuilder($request->method().' '.$request->path())
            ->setParent($parentContext)
            ->setSpanKind(SpanKind::KIND_SERVER)
            ->startSpan();

        $scope = Context::storage()->attach($span->storeInContext($parentContext));

        try {
            $response = $next($request);
            $span->setAttribute('http.method', $request->method());
            $span->setAttribute('http.route', $request->route()?->uri() ?? $request->path());
            $span->setAttribute('http.status_code', $response->getStatusCode());
            $span->setStatus($response->getStatusCode() >= 500 ? StatusCode::STATUS_ERROR : StatusCode::STATUS_OK);

            $response->headers->set('X-Trace-Id', $span->getContext()->getTraceId());

            return $response;
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
            throw $e;
        } finally {
            $span->end();
            $scope->detach();
        }
    }
}
```

这段代码真正解决的是两个线上问题：一是 Nginx 进来的 `traceparent` 不丢；二是异常路径也会 `end()`，否则 Tempo 里会出现一堆“永远没结束”的 span。

## 三、最容易断链的地方不是 HTTP，而是 Queue

我一开始只给 `Http::macro()` 注入 `traceparent`，结果链路在 `dispatch()` 后全部断开。Laravel 队列不是天然帮你传 tracing context，必须显式把 `traceparent` 写进 payload，再在消费者侧恢复。

```php
<?php

namespace App\Providers;

use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use OpenTelemetry\API\Trace\Span;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\Context\Context;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;

final class QueueTraceServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Queue::createPayloadUsing(function (): array {
            $context = Span::getCurrent()->getContext();

            if (! $context->isValid()) {
                return [];
            }

            return [
                'traceparent' => sprintf(
                    '00-%s-%s-%02x',
                    $context->getTraceId(),
                    $context->getSpanId(),
                    $context->getTraceFlags()
                ),
            ];
        });

        Event::listen(JobProcessing::class, function (JobProcessing $event): void {
            $payload = $event->job->payload();
            $parent = TraceContextPropagator::getInstance()->extract($payload);
            $tracer = app(\OpenTelemetry\API\Trace\TracerInterface::class);

            $span = $tracer->spanBuilder($event->job->resolveName())
                ->setParent($parent)
                ->setSpanKind(SpanKind::KIND_CONSUMER)
                ->startSpan();

            app()->instance('queue.trace.scope', Context::storage()->attach($span->storeInContext($parent)));
            app()->instance('queue.trace.span', $span);
        });

        Event::listen(JobProcessed::class, function (): void {
            optional(app()->make('queue.trace.span'))->end();
            optional(app()->make('queue.trace.scope'))->detach();
        });
    }
}
```

上面这段不是“为了优雅”，而是为了让 `OrderPlaced -> ReserveInventory -> UpdateOrderStatus` 在 Tempo 里真的是父子关系，而不是三段互相无关的孤儿 span。

## 四、日志必须带 trace_id，不然 Trace 查到一半还是得 ssh 上机

我最后没有强依赖 APM 面板里的日志功能，而是继续用 Monolog JSON，把 `trace_id`、`span_id` 注入到每条业务日志里。这样 Grafana 可以从 Tempo 一键跳 Loki，也能反向从日志回看 Trace。

```php
<?php

namespace App\Logging;

use OpenTelemetry\API\Trace\Span;

final class TraceContextProcessor
{
    public function __invoke(array $record): array
    {
        $context = Span::getCurrent()->getContext();

        if ($context->isValid()) {
            $record['extra']['trace_id'] = $context->getTraceId();
            $record['extra']['span_id'] = $context->getSpanId();
        }

        return $record;
    }
}
```

`config/logging.php` 里把它挂到 channel 后，排查体验会完全不一样：先在 Tempo 里找到慢的 `ReserveInventory` span，再点进对应 trace_id 的日志，看是 Redis 阻塞、第三方库存接口超时，还是 Horizon worker 卡住。

## 五、Collector 配置别放过采样，不然高峰期先炸的是可观测性

```yaml
receivers:
  otlp:
    protocols:
      grpc:
      http:

processors:
  memory_limiter:
    limit_mib: 512
  probabilistic_sampler:
    sampling_percentage: 15
  batch:
    timeout: 2s
    send_batch_size: 1024

exporters:
  otlp/tempo:
    endpoint: tempo.monitoring.svc.cluster.local:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, probabilistic_sampler, batch]
      exporters: [otlp/tempo]
```

我踩过最重的一次坑是把采样率开到 100%。促销时订单接口本身不慢，但每个请求又带出 8~12 个子 span，Collector CPU 先打满，随后 exporter 排队，最后连“监控系统自己延迟”都开始污染判断。后来改成 **入口 15% 概率采样 + 错误请求强制保留**，值班信息量反而更稳定。

## 六、三条最有价值的踩坑记录

### 坑一：只透传 request_id，不透传 traceparent

request_id 只能做日志聚合，不能恢复父子 span。结果就是日志能串起来，Tempo 里还是三段断链。解决方式只有一个：**跨边界统一走 W3C Trace Context**，不要自造字段。

### 坑二：Horizon 常驻进程不清上下文，上一单的 span 跑到下一单

这类问题在 FPM 下很难复现，在 Horizon/Octane 下却很常见。`JobProcessed` 和 `JobExceptionOccurred` 都要清理 scope，不然 worker 复用后会出现 trace 污染，最直观的症状就是两个完全不同的订单拥有同一个父 span。

### 坑三：日志里的 trace_id 格式和 Tempo 不一致

有一次我们把 trace_id 存成 UUID 风格带短横线，Grafana 的 trace to logs 直接失效。Tempo、Loki、应用日志三边必须统一成同一份十六进制 trace_id，别在日志层再做二次格式化。

## 七、我最后保留的落地原则

值班信息量反而更稳定。

## 八、常见故障排查

### 症状：Tempo 中只有入口 span，Queue Job 全部丢失

**排查步骤：**

1. 检查 `Queue::createPayloadUsing()` 是否在 ServiceProvider 的 `boot()` 中注册
2. 在消费者侧 `JobProcessing` 事件中断点，确认 `$event->job->payload()` 包含 `traceparent` 字段
3. 检查 Collector 日志是否有 `RESOURCE_EXHAUSTED` 或 `FAILED_PRECONDITION`，通常是 batch 队列积压

```bash
# 快速验证 payload 是否携带 traceparent
php artisan tinker
>>> dispatch(function() { dump(app('queue.trace.span')); });
```

### 症状：两个不同订单拥有同一个父 span

这是 Horizon/Octane 常驻进程的典型 trace 污染问题。确保 `JobProcessed` 和 `JobExceptionOccurred` 事件中都正确调用了 `$scope->detach()` 和 `$span->end()`。如果使用了 `dispatch(fn() => ...)` 闭包任务，闭包内部也会继承上一次的 Context，需要在闭包开头手动重置：

```php
<?php

use OpenTelemetry\Context\Context;

// 在闭包任务开头重置上下文，防止 trace 污染
$scope = Context::storage()->attach(Context::getCurrent());
try {
    // 业务逻辑
} finally {
    $scope->detach();
}
```

### 症状：Grafana Trace to Logs 功能点击后跳转 Loki 无结果

确认三边 trace_id 格式一致：Tempo 存储的 hex 格式（32 位无短横线）、Loki label 中的 `traceID`、以及应用日志 `extra.trace_id` 字段。常见问题是日志层对 trace_id 做了 `Uuid::toString()` 格式化（带短横线），导致 Grafana 正则匹配失败。统一使用 `Span::getCurrent()->getContext()->getTraceId()` 原始值即可。

如果只让我保留一个经验，那就是：先把订单、支付、库存这种最关键的异步链路打通，再谈全站埋点。全站铺开不难，难的是第一条真正能拿来值班的 Trace。

## 相关阅读

- [Prometheus + Grafana 监控体系实战：Laravel API 的 RED 指标、告警降噪与 SLO 看板落地踩坑记录](/php/Laravel/prometheus-grafana-monitoringguide-laravel-api-red-slo/) — 链路追踪定位到慢接口后，如何用 Prometheus RED 指标量化并设置 SLO 告警
- [Laravel Telescope 开发调试实战：请求追踪、队列监控与慢查询定位踩坑记录](/php/Laravel/laravel-telescope-guide-monitoringslow-query/) — 本地开发阶段用 Telescope 快速定位队列与慢查询问题
- [Laravel Event-Listener 事件驱动架构 - 解耦订单处理](/php/Laravel/laravel-event-listener-architecture/) — 本文追踪的订单链路中事件驱动架构的设计与踩坑
