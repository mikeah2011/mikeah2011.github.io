---

title: Prometheus + Grafana 监控体系实战：Laravel API 的 RED 指标、告警降噪与 SLO 看板落地踩坑记录
keywords: [Prometheus, Grafana, Laravel API, RED, SLO, 监控体系实战, 指标, 告警降噪与, 看板落地踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 09:50:17
updated: 2026-05-03 09:51:28
categories:
- php
tags:
- Laravel
- 监控
- Prometheus
- Grafana
- RED
- SLO
- APM
- 可观测性
- AlertManager
- PromQL
description: 一线 Laravel B2C API 项目的 Prometheus + Grafana 可观测性实战全记录：从 RED 指标中间件埋点、Recording Rules 聚合、Grafana SLO 看板搭建，到 Alertmanager 告警降噪三件套（for 持续时间 + 最小流量门槛 + group_by 合并），完整覆盖踩坑与修复过程。附监控方案对比表与可直接复用的 Laravel 代码示例，帮你把有监控升级成能值班的监控，夜间无效告警降低 60%。
---


很多团队说自己“有监控”，实际只有两样东西：机器 CPU 和 Nginx 5xx 数。真到线上出故障时，只能知道“系统不太对”，却回答不了更关键的问题：**到底是哪条接口变慢、慢在应用还是下游、错误是否持续、要不要半夜把人叫起来**。

我在一个 Laravel B2C API 项目里踩过这个坑。最早我们把监控拆得很散：Node Exporter 看机器、Nginx 日志看状态码、Sentry 看异常、数据库慢日志单独翻。结果一次促销流量上来，订单确认接口 P95 已经飙到 2.4 秒，但 CPU 还不到 45%，值班同学盯着 Grafana 的主机面板完全没意识到问题已经落在应用层。

后来我们把监控重做成一套真正能值班的体系：**Prometheus 负责采集，Grafana 负责展示，Alertmanager 负责把该吵的人叫醒，但只在该叫的时候叫。**核心不是“采更多指标”，而是围绕 Laravel API 的 RED 模型重新组织指标：

- **Rate**：单位时间请求量
- **Errors**：错误率，而不是错误总数
- **Duration**：P95/P99 延迟，而不是平均值

## 一、最后落地的监控架构

```text
                   +-----------------------------+
                   |   User / App / Admin Web    |
                   +--------------+--------------+
                                  |
                                  v
                         Ingress / Nginx
                                  |
                                  v
                  +-------------------------------+
                  | Laravel API Pods / PHP-FPM     |
                  | middleware + /metrics endpoint |
                  +---------------+----------------+
                                  |
             +--------------------+--------------------+
             |                                         |
             v                                         v
      Prometheus Scrape                         Loki / Sentry
             |                                         |
             v                                         v
   Recording Rules / Alert Rules                 日志与异常辅助排查
             |
             v
       Alertmanager  ------------------> Feishu / Slack / Email
             |
             v
          Grafana
   RED 看板 / SLO 看板 / 下游依赖看板
```

这里有两个设计原则非常重要：

1. **应用指标必须自己暴露**，不能只看主机层 CPU、内存。
2. **告警基于症状，不基于情绪**。CPU 高不一定要报警，但下单接口 10 分钟持续 P95 超阈值就必须报警。

## 二、Laravel 里怎么埋 RED 指标

我没有走“全量 APM 先上再说”的路线，而是先用中间件把最关键的 HTTP 指标打出来。下面这段代码是线上可用的，不是伪代码。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Prometheus\CollectorRegistry;
use Symfony\Component\HttpFoundation\Response;

final class HttpMetricsMiddleware
{
    public function __construct(private CollectorRegistry $registry)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $start = microtime(true);
        $route = optional($request->route())->getName() ?: $request->path();
        $method = $request->getMethod();

        try {
            /** @var Response $response */
            $response = $next($request);
            return $response;
        } finally {
            $duration = microtime(true) - $start;
            $status = isset($response) ? (string) $response->getStatusCode() : '500';

            $counter = $this->registry->getOrRegisterCounter(
                'b2c',
                'http_requests_total',
                'Laravel HTTP requests',
                ['method', 'route', 'status']
            );
            $counter->inc([$method, $route, $status]);

            $histogram = $this->registry->getOrRegisterHistogram(
                'b2c',
                'http_request_duration_seconds',
                'Laravel HTTP request duration',
                ['method', 'route'],
                [0.05, 0.1, 0.2, 0.5, 1, 2, 3, 5]
            );
            $histogram->observe($duration, [$method, $route]);
        }
    }
}
```

对应的 metrics 路由也很简单：

```php
use Prometheus\CollectorRegistry;
use Prometheus\RenderTextFormat;

Route::get('/metrics', function (CollectorRegistry $registry) {
    $renderer = new RenderTextFormat();

    return response(
        $renderer->render($registry->getMetricFamilySamples()),
        200,
        ['Content-Type' => RenderTextFormat::MIME_TYPE]
    );
})->middleware('internal.auth');
```

这里我刻意做了两件事：

- `route` 优先使用路由名，而不是原始 URI，避免 `/orders/1001`、`/orders/1002` 把 label 打爆。
- `status` 只保留状态码，不加用户 ID、订单号、trace id 这类高基数标签。

**第一个大坑**就出在 label。我们一开始直接把完整 path 放进去，三天后 Prometheus 内存暴涨，`/api/orders/{id}` 被真实订单号展开成几十万条时序。后来统一改成 route name，问题立刻消失。

## 三、Prometheus 规则别只靠临时查询

很多人 Grafana 面板里直接写一长串 PromQL，我也这么干过，但维护成本非常高。后来我把高频查询都下沉成 recording rules。

```yaml
groups:
  - name: laravel-api-recording-rules
    interval: 30s
    rules:
      - record: job_route:http_rps:rate5m
        expr: sum by (route) (rate(b2c_http_requests_total[5m]))

      - record: job_route:http_error_ratio:rate5m
        expr: |
          sum by (route) (rate(b2c_http_requests_total{status=~"5.."}[5m]))
          /
          sum by (route) (rate(b2c_http_requests_total[5m]))

      - record: job_route:http_p95:5m
        expr: |
          histogram_quantile(
            0.95,
            sum by (le, route) (rate(b2c_http_request_duration_seconds_bucket[5m]))
          )
```

Grafana 上层只消费这三个聚合结果：

- 每条核心接口的 **RPS 趋势**
- 每条核心接口的 **5xx 错误率**
- 每条核心接口的 **P95 延迟**

这一步的收益非常明显：面板加载快了，PromQL 复用统一了，告警和图表口径终于一致。

## 四、SLO 面板怎么做，才不会只剩“红红绿绿”

我们最后没有做那种几十个小灯泡的“状态墙”，而是给核心交易链路单独定义 SLO。比如订单确认接口：

- **可用性目标**：30 天 99.9%
- **性能目标**：5 分钟窗口内 P95 < 800ms

PromQL 里我们会单独看错误预算消耗速度：

```promql
sum(rate(b2c_http_requests_total{route="api.orders.confirm",status=~"5.."}[5m]))
/
sum(rate(b2c_http_requests_total{route="api.orders.confirm"}[5m]))
```

而不是单看“今天报错 300 次”。因为在高流量接口里，300 次可能只是 0.02%；在低频支付回调里，300 次已经是灾难了。

**第二个大坑**也在这里：我们曾经按“错误数 > 50 就报警”配置告警。结果促销高峰时正常波动也会打爆群；深夜低流量时偶发 5 次连续失败反而没触发。后来统一改成**错误率 + 持续时间 + 最小请求量门槛**三件套，噪音一下少很多。

## 五、Alertmanager 告警降噪的实战做法

下面这条告警规则是我们后面长期保留的版本，专门盯订单确认接口：

```yaml
groups:
  - name: laravel-api-alerts
    rules:
      - alert: OrderConfirmHighErrorRate
        expr: |
          (
            sum(rate(b2c_http_requests_total{route="api.orders.confirm",status=~"5.."}[10m]))
            /
            sum(rate(b2c_http_requests_total{route="api.orders.confirm"}[10m]))
          ) > 0.03
          and
          sum(rate(b2c_http_requests_total{route="api.orders.confirm"}[10m])) > 1
        for: 10m
        labels:
          severity: critical
          team: checkout
        annotations:
          summary: "订单确认接口 10 分钟错误率超过 3%"
          description: "请优先检查支付网关、库存 RPC 与 MySQL 慢查询。"
```

Alertmanager 再按 `team`、`severity`、`env` 做路由和合并：

```yaml
route:
  group_by: ['alertname', 'team', 'env']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 2h
  receiver: feishu-default
  routes:
    - matchers:
        - severity="critical"
        - team="checkout"
      receiver: feishu-checkout

receivers:
  - name: feishu-checkout
    webhook_configs:
      - url: http://alert-webhook.alert.svc/feishu/checkout
```

这里最有效的降噪动作有三个：

1. **`for: 10m`**，避免瞬时抖动把人吵醒。
2. **最小流量门槛**，防止低频接口分母太小导致误报。
3. **group_by 合并**，同一类故障发一条，不要一口气刷二十条。

## 六、一次真实故障里，这套体系怎么帮我缩短排查时间

最有价值的一次是在库存服务抖动时。现象是下单页投诉增多，但机器 CPU、内存都正常。以前这种场景很容易先去查 PHP-FPM、再查 Nginx、再查数据库，排一圈至少半小时。

这次我们打开 Grafana：

- `api.orders.confirm` 的 **RPS 正常**
- **5xx 错误率没明显升高**
- 但 **P95 从 420ms 拉到 2.1s**
- 下游库存 RPC 的超时计数同时抬升

结论很快就收敛了：不是应用挂了，而是依赖变慢导致整体时延上升。值班同学直接切只读降级和库存缓存兜底，十五分钟内把 P95 拉回 700ms 左右。

这也是我后来特别强调的一点：**监控的目标不是“记录历史”，而是让值班的人少走弯路。**

## 七、最后总结三条最容易被忽略的坑

### 1. 不要让 label 基数失控
订单号、用户 ID、完整 URL、异常消息正文，都不应该直接进 Prometheus label。高基数不是“稍微贵一点”，而是会把整套 TSDB 拖垮。

### 2. 平均延迟几乎没意义
平均值在交易系统里特别会骗人。一次 50ms、一次 5s，平均只有 2.5s；但用户感知的是那次 5s。所以面板和告警都要盯 **P95/P99**。

### 3. 告警必须和处置动作绑定
我后来要求每条 critical 告警都写 `description`，至少告诉值班同学先看哪里。没有行动建议的告警，只是在制造额外焦虑。

如果你已经有 Laravel 监控，但还停留在"CPU 高了报警、磁盘满了报警"，那离真正可用的可观测性还差一大截。先别想着一口吃成全链路 APM，先把 **RED 指标、核心接口 SLO、告警降噪** 三件事做好，值班体验会立刻不一样。这套体系上线后，我们夜间无效告警数量大约降了 60% 左右，而真实故障的平均发现时间反而更短了。对业务系统来说，这才是监控该产生的价值。

## 附录一、监控方案横向对比：Prometheus vs Datadog vs New Relic

选型时我们也评估过商业方案，最后选了 Prometheus 自建。这里把三家核心差异列出来，方便你根据团队规模和预算做决策：

| 维度 | Prometheus + Grafana | Datadog | New Relic |
|------|---------------------|---------|-----------|
| **部署方式** | 自建，K8s / 裸机均可 | SaaS 全托管 | SaaS 全托管 |
| **数据采集** | Pull 模型，/metrics 端点 | Agent Push，自动发现 | Agent Push，自动注入 |
| **存储成本** | 本地 TSDB + Thanos/Cortex 可扩展，成本可控 | 按主机+自定义指标计费，高并发下费用飙升 | 按数据量计费，免费额度有限 |
| **Laravel 集成** | 需手动中间件埋点（本文方案） | dd-trace-php 自动注入，零代码 | PHP Agent 自动注入 |
| **告警能力** | Alertmanager 灵活但需自行配置 | 开箱即用，支持 anomaly detection | 开箱即用，NRQL 强大 |
| **Dashboard** | Grafana 开源免费，社区面板丰富 | 内置 APM Dashboard | 内置 APM Dashboard |
| **链路追踪** | 需集成 Jaeger / Tempo | 内置 APM Trace | 内置 APM Trace |
| **适合团队** | 有运维能力的中小团队，或对成本敏感的大流量项目 | 快速上手，预算充裕的团队 | 需要全栈 APM 的中大型团队 |

**我们的结论**：Laravel API 的 RED 指标场景，Prometheus 自建在成本和灵活性上优势明显。如果你团队没有专职运维且预算充足，Datadog 的自动注入和开箱即用体验确实省心。New Relic 适合需要深度代码级 Trace 的场景，但数据量大时账单不好控。

## 附录二、可复用的 Laravel Service Provider 注册代码

上面的中间件和 metrics 路由需要注册到 Laravel 里，下面是完整的注册方式：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class PrometheusServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 生产环境推荐 Redis 适配器，避免文件锁竞争
        $this->app->singleton(CollectorRegistry::class, function () {
            $redisAdapter = new Redis([
                'host' => config('database.redis.default.host', '127.0.0.1'),
                'port' => config('database.redis.default.port', 6379),
                'prefix' => 'prometheus:',
            ]);
            return new CollectorRegistry($redisAdapter);
        });
    }
}
```

然后在 `app/Http/Kernel.php` 的全局中间件里注册：

```php
protected $middleware = [
    // ...其他中间件
    \App\Http\Middleware\HttpMetricsMiddleware::class,
];
```

> **注意**：如果并发量不高，也可以用默认的文件存储适配器（`APC` 或 `InMemory`），但多 FPM 进程下建议用 Redis 避免竞态。

## 相关阅读

- [PHP 性能基准测试：xhprof / Blackfire / Tideways 实战对比与 Laravel 生产环境 Profile 落地方案](/php/Laravel/php-testing-xhprof-blackfire-tideways-guidevs-laravel-profile/) — 本篇解决"接口慢了怎么发现"，这篇解决"发现后怎么定位到具体函数"
- [PHP OPcache JIT 联合调优实战：JIT buffer 预热、opcache.jit 参数组合与生产环境性能基准](/php/PHP-OPcache-JIT-联合调优实战-JIT-buffer预热-opcache.jit参数组合与生产环境性能基准/) — 监控能告诉你慢在哪，OPcache JIT 调优能直接帮你把 PHP 执行速度提上去
- [PHP-FPM 长连接与短连接实战：数据库连接池性能差异与 MySQL 踩坑记录](/php/Laravel/php-fpm-guide-databasemysql/) — P95 延迟飙升时，数据库连接池配置往往是隐藏元凶
