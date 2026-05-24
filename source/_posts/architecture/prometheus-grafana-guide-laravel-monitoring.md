---
title: Prometheus + Grafana 实战：Laravel 应用监控——指标采集、告警与可视化踩坑记录
date: 2026-05-17 00:20:31
updated: 2026-05-17 00:24:20
categories:
  - Architecture
  - Laravel
tags: [Laravel, 监控]
description: 基于 KKday B2C API 的真实生产环境，记录 Prometheus + Grafana 在 Laravel 项目中的落地实践：自定义指标中间件、四黄金指标看板、PHP-FPM 进程监控、告警规则设计，以及 label 基数爆炸、指标重复注册、Grafana 变量联动等生产踩坑。



---
# Prometheus + Grafana 实战：Laravel 应用监控——指标采集、告警与可视化踩坑记录

## 一、为什么从 New Relic 迁移到 Prometheus + Grafana？

在 KKday B2C Backend Team，我们之前用 New Relic + Sentry 做 APM。效果不差，但有两个痛点逼我们重新选型：

1. **成本**：New Relic 按数据量计费，30+ 个微服务每月账单接近 $2000，而且大部分指标我们只在排查时才看。
2. **自定义指标受限**：我想监控「每个 API 端点的 Redis 命中率」「PHP-FPM 活跃进程数」「队列积压深度」这些业务指标，New Relic 的 Custom Events 操作繁琐且查询语言（NRQL）学习成本高。

最终方案：**Prometheus 做指标采集 + Grafana 做可视化 + Alertmanager 做告警**。自建这套栈后，监控成本降到了几乎为零（Grafana Cloud 免费版够用），而且指标定义完全可控。

```
┌─────────────────────────────────────────────────────────────┐
│                    Prometheus + Grafana 监控架构               │
│                                                              │
│   Laravel App (PHP-FPM / Octane)                             │
│   ┌──────────────────────────────────────────┐               │
│   │  MetricsMiddleware                        │               │
│   │  ├── http_requests_total (Counter)        │               │
│   │  ├── http_request_duration_seconds (Hist) │               │
│   │  ├── php_fpm_active_processes (Gauge)     │               │
│   │  └── redis_cache_hits_total (Counter)     │               │
│   └──────────┬───────────────────────────────┘               │
│              │ /metrics (pull)                                │
│              ▼                                                │
│   ┌──────────────────┐     ┌──────────────────┐              │
│   │   Prometheus      │────▶│   Grafana         │              │
│   │   (scrape 15s)    │     │   (Dashboard)     │              │
│   │   ├── 聚合规则    │     │   ├── 四黄金指标   │              │
│   │   └── 告警规则    │     │   ├── PHP-FPM    │              │
│   └────────┬─────────┘     │   └── 业务指标    │              │
│            │               └──────────────────┘              │
│            ▼                                                  │
│   ┌──────────────────┐                                       │
│   │  Alertmanager     │──▶ Slack / PagerDuty / 企业微信       │
│   │  (分组/抑制/静默) │                                       │
│   └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

## 二、Laravel 侧指标暴露：一个中间件搞定

Prometheus 的核心模型是 **Pull**：应用暴露 `/metrics` 端点，Prometheus 定期来拉。所以我们第一步是在 Laravel 里集成 `promphp/prometheus_client_php`。

### 2.1 安装依赖

```bash
composer require promphp/prometheus_client_php
# 存储后端用 Redis（生产推荐），避免 APCu 在多 Worker 下数据割裂
composer require promphp/prometheus_client_php_storage_redis
```

### 2.2 指标中间件

```php
<?php
// app/Http/Middleware/PrometheusMetrics.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class PrometheusMetrics
{
    private static bool $initialized = false;
    private CollectorRegistry $registry;

    public function __construct(CollectorRegistry $registry)
    {
        $this->registry = $registry;
    }

    public function handle(Request $request, Closure $next)
    {
        $start = microtime(true);

        /** @var \Illuminate\Http\Response $response */
        $response = $next($request);

        // 只在 /metrics 端点返回指标，其他请求正常处理
        if ($request->path() === 'metrics') {
            return $this->renderMetrics();
        }

        $duration = microtime(true) - $start;
        $route = $request->route()?->getName() ?? $request->path();
        $method = $request->method();
        $status = $response->getStatusCode();

        // 记录请求计数
        $this->registry->getOrRegisterCounter(
            'app',
            'http_requests_total',
            'Total HTTP requests',
            ['method', 'route', 'status']
        )->inc([$method, $route, (string) $status]);

        // 记录请求耗时（直方图）
        $this->registry->getOrRegisterHistogram(
            'app',
            'http_request_duration_seconds',
            'HTTP request latency',
            ['method', 'route'],
            [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
        )->observe($duration, [$method, $route]);

        return $response;
    }

    private function renderMetrics()
    {
        $renderer = new \Prometheus\RenderTextFormat();
        $metrics = $this->registry->getMetricFamilySamples();
        return response($renderer->render($metrics), 200, [
            'Content-Type' => $renderer::MIME_TYPE,
        ]);
    }
}
```

### 2.3 PHP-FPM 进程指标（旁路采集）

Laravel 侧指标只覆盖 HTTP 请求，但 PHP-FPM 的进程池状态（活跃进程、空闲进程、等待队列）需要旁路采集。我用一个 Artisan Command 每 10 秒推一次：

```php
<?php
// app/Console/Commands/PrometheusPhpFpmMetrics.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Prometheus\CollectorRegistry;

class PrometheusPhpFpmMetrics extends Command
{
    protected $signature = 'metrics:php-fpm';
    protected $description = 'Push PHP-FPM metrics to Prometheus';

    public function handle(CollectorRegistry $registry): void
    {
        $statusFile = '/tmp/php-fpm-status'; // php-fpm pm.status_path
        // 或通过 HTTP: curl http://127.0.0.1:9000/status?json

        $gauge = $registry->getOrRegisterGauge(
            'php_fpm',
            'active_processes',
            'PHP-FPM active processes'
        );

        $idleGauge = $registry->getOrRegisterGauge(
            'php_fpm',
            'idle_processes',
            'PHP-FPM idle processes'
        );

        // 通过 FastCGI 协议读取 FPM status
        $status = $this->getFpmStatus();
        if ($status) {
            $gauge->set($status['active processes'] ?? 0);
            $idleGauge->set($status['idle processes'] ?? 0);
        }
    }

    private function getFpmStatus(): ?array
    {
        // 生产中推荐用 fastcgi_connect 直接读取
        // 这里简化为通过 HTTP endpoint
        $response = @file_get_contents('http://127.0.0.1:9000/status?json');
        return $response ? json_decode($response, true) : null;
    }
}
```

然后在 `routes/web.php` 中注册 `/metrics` 路由：

```php
Route::middleware(['prometheus'])->group(function () {
    Route::get('/metrics', fn () => response('handled by middleware'));
});
```

### 2.4 Redis 命中率指标（业务层）

```php
<?php
// app/Services/Cache/MonitoredCacheRepository.php

namespace App\Services\Cache;

use Illuminate\Cache\Repository;
use Prometheus\CollectorRegistry;

class MonitoredCacheRepository
{
    public function __construct(
        private Repository $cache,
        private CollectorRegistry $registry,
    ) {}

    public function remember(string $key, int $ttl, callable $callback): mixed
    {
        $hit = $this->cache->has($key);

        $this->registry->getOrRegisterCounter(
            'app',
            'cache_operations_total',
            'Cache operations',
            ['result'] // hit / miss
        )->inc([$hit ? 'hit' : 'miss']);

        return $this->cache->remember($key, $ttl, $callback);
    }
}
```

## 三、Prometheus 配置：scrape 与 recording rules

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/recording_rules.yml
  - /etc/prometheus/alert_rules.yml

scrape_configs:
  - job_name: 'laravel-b2c-api'
    metrics_path: '/metrics'
    scrape_interval: 10s
    static_configs:
      - targets:
          - 'api-1:9000'
          - 'api-2:9000'
          - 'api-3:9000'
        labels:
          service: 'b2c-api'
          env: 'production'

  - job_name: 'php-fpm'
    # 旁路采集，走 Artisan Command 输出
    static_configs:
      - targets: ['pushgateway:9091']
```

Recording Rules 预计算常用聚合，减少 Grafana 查询压力：

```yaml
# recording_rules.yml
groups:
  - name: laravel_http
    interval: 30s
    rules:
      # P95 延迟预计算
      - record: app:http_request_duration_seconds:p95
        expr: |
          histogram_quantile(0.95,
            sum(rate(app_http_request_duration_seconds_bucket[5m])) by (le, route)
          )

      # 每秒请求数（QPS）
      - record: app:http_requests:rate5m
        expr: |
          sum(rate(app_http_requests_total[5m])) by (route)

      # 错误率
      - record: app:http_requests:error_rate
        expr: |
          sum(rate(app_http_requests_total{status=~"5.."}[5m])) by (route)
          /
          sum(rate(app_http_requests_total[5m])) by (route)
```

## 四、Grafana 看板设计：四黄金指标

Google SRE 定义了四个黄金指标：**延迟（Latency）、流量（Traffic）、错误率（Errors）、饱和度（Saturation）**。我在 Grafana 中按这四个维度组织看板。

### 4.1 核心 PromQL 查询

```promql
# 1. 延迟：P95 请求耗时（按端点拆分）
app:http_request_duration_seconds:p95

# 2. 流量：每秒请求数
app:http_requests:rate5m

# 3. 错误率：5xx 占比
app:http_requests:error_rate

# 4. 饱和度：PHP-FPM 活跃进程 vs 最大进程
php_fpm_active_processes / on() php_fpm_max_processes

# 附加：缓存命中率
sum(rate(app_cache_operations_total{result="hit"}[5m]))
/
sum(rate(app_cache_operations_total[5m]))
```

### 4.2 Grafana Dashboard JSON 片段（核心面板）

```json
{
  "panels": [
    {
      "title": "P95 Latency by Endpoint",
      "type": "timeseries",
      "targets": [
        {
          "expr": "app:http_request_duration_seconds:p95",
          "legendFormat": "{{route}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s",
          "thresholds": {
            "steps": [
              { "value": 0, "color": "green" },
              { "value": 0.5, "color": "yellow" },
              { "value": 2, "color": "red" }
            ]
          }
        }
      }
    },
    {
      "title": "Error Rate (5xx)",
      "type": "stat",
      "targets": [
        {
          "expr": "app:http_requests:error_rate",
          "legendFormat": "Error Rate"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "thresholds": {
            "steps": [
              { "value": 0, "color": "green" },
              { "value": 0.01, "color": "yellow" },
              { "value": 0.05, "color": "red" }
            ]
          }
        }
      }
    }
  ]
}
```

## 五、告警规则：从"有告警"到"有用的告警"

我见过太多团队把 Prometheus 告警配成"狼来了"——CPU 一抖就告警、内存 80% 就告警，最后大家把告警频道 mute 了。我们只配三条：

```yaml
# alert_rules.yml
groups:
  - name: laravel_critical
    rules:
      # 1. P95 延迟持续 5 分钟超过 2 秒
      - alert: HighLatencyP95
        expr: app:http_request_duration_seconds:p95 > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95 latency > 2s on {{ $labels.route }}"
          description: "Route {{ $labels.route }} P95 has been {{ $value | humanizeDuration }} for 5 minutes."

      # 2. 5xx 错误率持续 3 分钟超过 5%
      - alert: HighErrorRate
        expr: app:http_requests:error_rate > 0.05
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "5xx error rate > 5%"

      # 3. PHP-FPM 进程池饱和
      - alert: FpmPoolSaturated
        expr: php_fpm_active_processes / on() php_fpm_max_processes > 0.9
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "PHP-FPM pool is >90% saturated"
```

## 六、踩坑记录

### 坑 1：label 基数爆炸导致 Prometheus 内存 OOM

**现象**：上线第三天，Prometheus 内存从 2GB 涨到 16GB，最终 OOM。

**原因**：我把请求的 `route` 设成了实际 URL path（如 `/api/v2/products/12345`），每个不同的 product ID 都会创建一个新的时间序列。30+ 万 SKU 意味着 30 万+ 条时间序列。

**修复**：`route` 必须用路由名称或参数化 pattern，不能用实际 path。

```php
// ❌ 错误：用实际 path
$route = $request->path(); // /api/v2/products/12345

// ✅ 正确：用路由名称
$route = $request->route()?->getName(); // api.products.show

// ✅ 或者用参数化 pattern
$route = $request->route()?->uri(); // api/v2/products/{product}
```

### 坑 2：Redis 存储后端在多 Worker 下指标重复注册

**现象**：`promphp/prometheus_client_php` 默认用 APCu 存储，但 PHP-FPM 每个 Worker 进程有独立的 APCu 缓存，导致同一个 Counter 被注册了 N 次（N = FPM Worker 数量），指标值翻倍。

**修复**：用 Redis 作为共享存储后端。

```php
// config/prometheus.php
use Prometheus\Storage\Redis;

Redis::setDefaultOptions([
    'host' => env('REDIS_HOST', '127.0.0.1'),
    'port' => (int) env('REDIS_PORT', 6379),
    'password' => env('REDIS_PASSWORD'),
    'database' => 5, // 独立数据库，避免和其他缓存混用
]);
```

### 坑 3：Scrape 超时导致指标丢失

**现象**：Grafana 看板间歇性出现数据断层，但应用本身没有异常。

**原因**：`/metrics` 端点在高流量下需要遍历大量时间序列做聚合，响应时间偶尔超过 Prometheus 默认的 10 秒 scrape timeout。

**修复**：拆分采集任务 + 增大 timeout。

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'laravel-b2c-api'
    scrape_timeout: 20s  # 默认 10s 不够
    # 另外，用 recording rules 预计算，避免在 /metrics 端点做聚合
```

### 坑 4：Grafana Dashboard 变量（Variable）联动失效

**现象**：我在 Dashboard 顶部设了 `$route` 变量让用户按端点筛选，但下拉框总是显示 `No options`。

**原因**：变量的查询用了 `label_values(app_http_requests_total, route)`，但 Prometheus 的 `label_values` 函数只能查询**已有的 metric name**。中间件注册的 metric name 带了 `app_` 前缀（namespace），而我在变量查询中写的是 `app_http_requests_total`。

**修复**：确认 metric name 前缀。`promphp` 库会把 `namespace_metric_name` 拼接成 `{namespace}_{metric_name}`，在 Prometheus 中存储为 `app_http_requests_total`。

```json
// Grafana Variable Query
{
  "query": "label_values(app_http_requests_total, route)",
  "refresh": 2  // on dashboard load
}
```

### 坑 5：Octane 模式下指标内存泄漏

**现象**：启用 Laravel Octane + Swoole 后，`/metrics` 端点的响应大小从 50KB 增长到 5MB+，每次重启 Octane 才恢复。

**原因**：Swoole Worker 是长驻进程，`CollectorRegistry` 的指标数据不会随请求结束而释放，而是在 Worker 生命周期内持续累积。特别是 Histogram 类型，每个观察值都会被存储。

**修复**：在 Octane 的 `RequestTerminated` 事件中清理指标，或使用 Prometheus 的 PushGateway 模式替代 Pull。

```php
// app/Listeners/ResetMetricsOnRequestTerminated.php
namespace App\Listeners;

use Laravel\Octane\Events\RequestTerminated;
use Prometheus\CollectorRegistry;

class ResetMetricsOnRequestTerminated
{
    public function __construct(private CollectorRegistry $registry) {}

    public function handle(RequestTerminated $event): void
    {
        // 只在 /metrics 请求后清理，正常请求不清理
        if ($event->request->path() === 'metrics') {
            // 注意：这会清空所有指标，生产环境建议用 TTLGauge 替代
        }
    }
}
```

更稳妥的做法是用 `Swoole\Table` 或 Redis 作为中间存储，定期 push 到 PushGateway。

## 七、与现有监控栈的协同

我们并没有完全废弃 New Relic 和 Sentry。三者各司其职：

| 工具 | 职责 | 数据类型 |
|------|------|----------|
| **Prometheus + Grafana** | 基础设施指标、业务指标、告警 | 时间序列（Counter/Gauge/Histogram） |
| **Sentry** | 异常追踪、错误堆栈、Release 追踪 | 事件（Event） |
| **Laravel Telescope** | 开发环境调试、请求/Query/Job 分析 | 本地存储（不生产用） |

Prometheus 的 `/metrics` 端点、Sentry 的 DSN 配置、Telescope 的 `APP_ENV=local` 限制——三者互不干扰，覆盖了可观测性的 Metrics、Traces（通过 exemplar 关联 Jaeger）、Logs 三大支柱。

## 八、总结

Prometheus + Grafana 在 Laravel 项目中的落地成本比想象中低——一个中间件 + 一个 Artisan Command 就能搞定核心指标。但生产环境的坑主要集中在三个地方：

1. **label 设计**：基数控制是第一优先级，错误的 label 会让 Prometheus 内存爆炸
2. **存储后端**：多 Worker 环境必须用 Redis，不能用 APCu
3. **采集模式**：Pull 模式在高并发下需要注意 scrape timeout 和指标膨胀问题

如果你的团队已经在用 New Relic/Datadog 等商业 APM，建议先在预发环境跑一套 Prometheus + Grafana 作为**自定义指标的补充**，等确认指标模型稳定后再考虑完全替换。监控迁移不要一步到位，分阶段来最安全。
