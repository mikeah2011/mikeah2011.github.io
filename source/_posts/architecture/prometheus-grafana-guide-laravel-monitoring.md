---
title: Prometheus + Grafana 实战：Laravel 应用监控——指标采集、告警与可视化踩坑记录
date: 2026-05-17 00:20:31
updated: 2026-05-17 00:24:20
categories:
  - architecture
  - php
tags: [Laravel, 监控, Prometheus, Grafana, RED方法, USE方法, AlertManager, PHP-FPM, 微服务, 可观测性]
keywords: [Prometheus, Grafana, Laravel, 应用监控, 指标采集, 告警与可视化踩坑记录, 架构, PHP]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: 基于 KKday B2C API 生产环境，深入讲解 Prometheus + Grafana 在 Laravel 中的完整落地实践：自定义指标中间件、RED 方法与 USE 方法实现、Grafana Dashboard JSON、AlertManager 告警规则设计，以及 label 基数爆炸、Octane 指标内存泄漏等 10+ 个生产踩坑案例与解决方案。


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
│   │   └── 告警规则    │     │   ├── RED 方法    │              │
│   └────────┬─────────┘     │   ├── USE 方法    │              │
│            │               │   └── 业务指标    │              │
│            ▼               └──────────────────┘              │
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

        // 记录请求大小（用于 USE 方法的饱和度分析）
        $this->registry->getOrRegisterHistogram(
            'app',
            'http_response_size_bytes',
            'HTTP response body size',
            ['method', 'route'],
            [100, 1000, 10000, 100000, 1000000]
        )->observe(strlen($response->getContent()), [$method, $route]);

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

### 2.3 完整的服务提供者注册

```php
<?php
// app/Providers/PrometheusServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis;

class PrometheusServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 配置 Redis 存储后端
        Redis::setDefaultOptions([
            'host'       => env('PROMETHEUS_REDIS_HOST', env('REDIS_HOST', '127.0.0.1')),
            'port'       => (int) env('PROMETHEUS_REDIS_PORT', 6379),
            'password'   => env('PROMETHEUS_REDIS_PASSWORD', env('REDIS_PASSWORD')),
            'database'   => (int) env('PROMETHEUS_REDIS_DB', 5),
            'timeout'    => 0.1,
            'read_timeout' => 10,
            'persistent_connections' => true,
        ]);

        $this->app->singleton(CollectorRegistry::class, function () {
            return new CollectorRegistry(new Redis());
        });
    }
}
```

在 `config/app.php` 中注册：

```php
'providers' => [
    // ...
    App\Providers\PrometheusServiceProvider::class,
],
```

### 2.4 PHP-FPM 进程指标（旁路采集）

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

        $maxGauge = $registry->getOrRegisterGauge(
            'php_fpm',
            'max_processes',
            'PHP-FPM max processes'
        );

        $listenQueueGauge = $registry->getOrRegisterGauge(
            'php_fpm',
            'listen_queue_len',
            'PHP-FPM listen queue length'
        );

        // 通过 FastCGI 协议读取 FPM status
        $status = $this->getFpmStatus();
        if ($status) {
            $gauge->set($status['active processes'] ?? 0);
            $idleGauge->set($status['idle processes'] ?? 0);
            $maxGauge->set($status['max active processes'] ?? 0);
            $listenQueueGauge->set($status['listen queue len'] ?? 0);
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

在 Supervisor 中配置定时执行：

```ini
[program:prometheus-fpm-metrics]
command=php /var/www/html/artisan metrics:php-fpm
autostart=true
autorestart=true
startsecs=0
numprocs=1
```

然后在 `routes/web.php` 中注册 `/metrics` 路由：

```php
Route::middleware(['prometheus'])->group(function () {
    Route::get('/metrics', fn () => response('handled by middleware'));
});
```

### 2.5 Redis 命中率指标（业务层）

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

### 2.6 队列积压深度指标

```php
<?php
// app/Console/Commands/PrometheusQueueMetrics.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Queue;
use Prometheus\CollectorRegistry;

class PrometheusQueueMetrics extends Command
{
    protected $signature = 'metrics:queue';
    protected $description = 'Push queue depth metrics to Prometheus';

    public function handle(CollectorRegistry $registry): void
    {
        $queues = ['default', 'high', 'low', 'notifications'];

        $gauge = $registry->getOrRegisterGauge(
            'app',
            'queue_depth',
            'Queue job count',
            ['queue']
        );

        foreach ($queues as $queue) {
            try {
                $size = Queue::size($queue);
                $gauge->set($size, [$queue]);
            } catch (\Throwable $e) {
                // 队列驱动不支持 size() 时静默忽略
                report($e);
            }
        }

        // 失败任务数
        $failedGauge = $registry->getOrRegisterGauge(
            'app',
            'queue_failed_total',
            'Failed queue jobs'
        );

        $failedGauge->set(
            \Illuminate\Support\Facades\DB::table('failed_jobs')->count()
        );
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

      # P50 延迟预计算
      - record: app:http_request_duration_seconds:p50
        expr: |
          histogram_quantile(0.50,
            sum(rate(app_http_request_duration_seconds_bucket[5m])) by (le, route)
          )

      # P99 延迟预计算
      - record: app:http_request_duration_seconds:p99
        expr: |
          histogram_quantile(0.99,
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

      # 缓存命中率
      - record: app:cache_operations:hit_ratio
        expr: |
          sum(rate(app_cache_operations_total{result="hit"}[5m]))
          /
          sum(rate(app_cache_operations_total[5m]))

  - name: php_fpm
    interval: 30s
    rules:
      # PHP-FPM 饱和度
      - record: php_fpm:process_saturation
        expr: |
          php_fpm_active_processes / php_fpm_max_processes
```

## 四、Grafana 看板设计：四黄金指标 + RED + USE

### 4.1 四黄金指标

Google SRE 定义了四个黄金指标：**延迟（Latency）、流量（Traffic）、错误率（Errors）、饱和度（Saturation）**。我在 Grafana 中按这四个维度组织看板。

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

### 4.2 RED 方法详解

RED 方法由 Tom Wilkie 提出，专门用于面向请求的服务（如 Laravel API）。RED 代表：

| 维度 | 含义 | 对应指标 | PromQL |
|------|------|----------|--------|
| **R**ate | 每秒请求数 | `http_requests_total` | `rate(http_requests_total[5m])` |
| **E**rrors | 错误请求比例 | `http_requests_total{status=~"5.."}` | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` |
| **D**uration | 请求延迟分布 | `http_request_duration_seconds_bucket` | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` |

**Laravel 中间件完整 RED 实现**：

```php
<?php
// app/Http/Middleware/RedMetricsMiddleware.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Prometheus\CollectorRegistry;

class RedMetricsMiddleware
{
    public function __construct(private CollectorRegistry $registry) {}

    public function handle(Request $request, Closure $next)
    {
        if ($request->path() === 'metrics') {
            return (new MetricsRenderer($this->registry))->render();
        }

        $start = microtime(true);
        $response = $next($request);
        $duration = microtime(true) - $start;

        $route   = $request->route()?->getName() ?? $request->route()?->uri() ?? 'unknown';
        $method  = $request->method();
        $status  = (string) $response->getStatusCode();

        // Rate: 请求计数
        $this->registry->getOrRegisterCounter(
            'app', 'http_requests_total', 'Total HTTP requests',
            ['method', 'route', 'status']
        )->inc([$method, $route, $status]);

        // Errors: 独立的错误计数（方便计算错误率）
        if ($response->getStatusCode() >= 500) {
            $this->registry->getOrRegisterCounter(
                'app', 'http_errors_total', 'Total HTTP 5xx errors',
                ['method', 'route']
            )->inc([$method, $route]);
        }

        // Duration: 延迟直方图
        $this->registry->getOrRegisterHistogram(
            'app', 'http_request_duration_seconds', 'HTTP request latency',
            ['method', 'route'],
            [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
        )->observe($duration, [$method, $route]);

        return $response;
    }
}
```

**RED 面板核心 PromQL**：

```promql
# Rate 面板：RPS 按路由拆分
sum(rate(app_http_requests_total[5m])) by (route)

# Errors 面板：5xx 错误率（百分比）
100 * sum(rate(app_http_requests_total{status=~"5.."}[5m])) by (route)
/
sum(rate(app_http_requests_total[5m])) by (route)

# Duration 面板：P50 / P95 / P99 三线叠加
histogram_quantile(0.50, sum(rate(app_http_request_duration_seconds_bucket[5m])) by (le, route))
histogram_quantile(0.95, sum(rate(app_http_request_duration_seconds_bucket[5m])) by (le, route))
histogram_quantile(0.99, sum(rate(app_http_request_duration_seconds_bucket[5m])) by (le, route))

# Apdex Score（满意度评分，基于 P95 延迟）
sum(rate(app_http_request_duration_seconds_bucket{le="0.25"}[5m])) by (route)
/
sum(rate(app_http_request_duration_seconds_count[5m])) by (route)
```

### 4.3 USE 方法详解

USE 方法由 Brendan Gregg 提出，专门用于基础设施资源监控。USE 代表：

| 维度 | 含义 | Laravel 应用对应指标 |
|------|------|----------------------|
| **U**tilization | 资源利用率 | CPU 使用率、PHP-FPM 活跃进程占比 |
| **S**aturation | 排队等待程度 | PHP-FPM listen queue、Redis 命令延迟 |
| **E**rrors | 错误数 | PHP-FPM 慢日志、连接超时计数 |

**USE 方法 PHP-FPM 实现**：

```php
<?php
// app/Console/Commands/PrometheusUseMetrics.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Prometheus\CollectorRegistry;
use Illuminate\Support\Facades\Redis as RedisFacade;

class PrometheusUseMetrics extends Command
{
    protected $signature = 'metrics:use';
    protected $description = 'Push USE-method metrics (Utilization, Saturation, Errors)';

    public function handle(CollectorRegistry $registry): void
    {
        // Utilization: PHP-FPM 进程利用率
        $fpmStatus = @json_decode(
            @file_get_contents('http://127.0.0.1:9000/status?json'), true
        );

        if ($fpmStatus) {
            $active = $fpmStatus['active processes'] ?? 0;
            $idle   = $fpmStatus['idle processes'] ?? 0;
            $max    = $fpmStatus['max active processes'] ?? 1;

            $registry->getOrRegisterGauge(
                'php_fpm', 'active_processes', 'PHP-FPM active processes'
            )->set($active);

            $registry->getOrRegisterGauge(
                'php_fpm', 'idle_processes', 'PHP-FPM idle processes'
            )->set($idle);

            $registry->getOrRegisterGauge(
                'php_fpm', 'max_processes', 'PHP-FPM max active processes'
            )->set($max);

            // Saturation: listen queue 长度
            $registry->getOrRegisterGauge(
                'php_fpm', 'listen_queue_len', 'PHP-FPM listen queue'
            )->set($fpmStatus['listen queue len'] ?? 0);

            $registry->getOrRegisterGauge(
                'php_fpm', 'listen_queue_maxlen', 'PHP-FPM listen queue max'
            )->set($fpmStatus['listen queue maxlen'] ?? 128);

            // Errors: 慢请求数
            $registry->getOrRegisterGauge(
                'php_fpm', 'slow_requests', 'PHP-FPM slow requests'
            )->set($fpmStatus['slow requests'] ?? 0);
        }

        // Utilization: Redis 内存使用
        try {
            $info = RedisFacade::info('memory');
            $registry->getOrRegisterGauge(
                'redis', 'memory_used_bytes', 'Redis used memory'
            )->set($info['used_memory'] ?? 0);

            $registry->getOrRegisterGauge(
                'redis', 'memory_max_bytes', 'Redis max memory'
            )->set($info['maxmemory'] ?? 0);
        } catch (\Throwable $e) {
            $this->warn('Cannot connect to Redis: ' . $e->getMessage());
        }

        // Saturation: Redis 连接数
        try {
            $clients = RedisFacade::info('clients');
            $registry->getOrRegisterGauge(
                'redis', 'connected_clients', 'Redis connected clients'
            )->set($clients['connected_clients'] ?? 0);
        } catch (\Throwable $e) {
            // silent
        }

        // Errors: Redis 拒绝连接数
        try {
            $stats = RedisFacade::info('stats');
            $registry->getOrRegisterGauge(
                'redis', 'rejected_connections_total', 'Redis rejected connections'
            )->set($stats['rejected_connections'] ?? 0);
        } catch (\Throwable $e) {
            // silent
        }

        $this->info('USE metrics pushed successfully.');
    }
}
```

**USE 面板核心 PromQL**：

```promql
# Utilization: PHP-FPM 进程利用率
php_fpm_active_processes / php_fpm_max_processes

# Saturation: PHP-FPM listen queue 使用率
php_fpm_listen_queue_len / php_fpm_listen_queue_maxlen

# Saturation: Redis 内存使用率
redis_memory_used_bytes / redis_memory_max_bytes

# Errors: 慢请求速率
rate(php_fpm_slow_requests[5m])
```

### 4.4 完整 Grafana Dashboard JSON

下面是一个可以直接导入 Grafana 的完整 Dashboard JSON，覆盖 RED + USE + 四黄金指标：

```json
{
  "dashboard": {
    "title": "Laravel B2C API - Prometheus 监控",
    "tags": ["laravel", "prometheus", "red", "use"],
    "timezone": "Asia/Shanghai",
    "refresh": "30s",
    "time": { "from": "now-1h", "to": "now" },
    "templating": {
      "list": [
        {
          "name": "route",
          "type": "query",
          "datasource": "Prometheus",
          "query": "label_values(app_http_requests_total, route)",
          "refresh": 2,
          "includeAll": true,
          "multi": true,
          "current": { "text": "All", "value": "$__all" }
        }
      ]
    },
    "panels": [
      {
        "title": "📊 RED Overview",
        "type": "row",
        "collapsed": false,
        "gridPos": { "h": 1, "w": 24, "x": 0, "y": 0 }
      },
      {
        "title": "Rate: Requests/sec",
        "type": "stat",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "sum(rate(app_http_requests_total{route=~\"$route\"}[5m]))",
            "legendFormat": "Total RPS"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps",
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 100, "color": "yellow" },
                { "value": 500, "color": "red" }
              ]
            }
          }
        },
        "gridPos": { "h": 4, "w": 8, "x": 0, "y": 1 }
      },
      {
        "title": "Errors: 5xx Rate",
        "type": "stat",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "100 * sum(rate(app_http_requests_total{status=~\"5..\",route=~\"$route\"}[5m])) / sum(rate(app_http_requests_total{route=~\"$route\"}[5m]))",
            "legendFormat": "Error %"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 1, "color": "yellow" },
                { "value": 5, "color": "red" }
              ]
            }
          }
        },
        "gridPos": { "h": 4, "w": 8, "x": 8, "y": 1 }
      },
      {
        "title": "Duration: P95 Latency",
        "type": "stat",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, sum(rate(app_http_request_duration_seconds_bucket{route=~\"$route\"}[5m])) by (le))",
            "legendFormat": "P95"
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
        },
        "gridPos": { "h": 4, "w": 8, "x": 16, "y": 1 }
      },
      {
        "title": "Latency Distribution (P50/P95/P99)",
        "type": "timeseries",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "histogram_quantile(0.50, sum(rate(app_http_request_duration_seconds_bucket{route=~\"$route\"}[5m])) by (le, route))",
            "legendFormat": "P50 {{route}}"
          },
          {
            "expr": "histogram_quantile(0.95, sum(rate(app_http_request_duration_seconds_bucket{route=~\"$route\"}[5m])) by (le, route))",
            "legendFormat": "P95 {{route}}"
          },
          {
            "expr": "histogram_quantile(0.99, sum(rate(app_http_request_duration_seconds_bucket{route=~\"$route\"}[5m])) by (le, route))",
            "legendFormat": "P99 {{route}}"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "s",
            "custom": { "lineWidth": 2, "fillOpacity": 10 }
          }
        },
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 5 }
      },
      {
        "title": "Requests/sec by Route",
        "type": "timeseries",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "sum(rate(app_http_requests_total{route=~\"$route\"}[5m])) by (route)",
            "legendFormat": "{{route}}"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps",
            "custom": { "lineWidth": 2, "fillOpacity": 20, "stacking": { "mode": "normal" } }
          }
        },
        "gridPos": { "h": 8, "w": 12, "x": 12, "y": 5 }
      },
      {
        "title": "🔥 USE Overview",
        "type": "row",
        "collapsed": false,
        "gridPos": { "h": 1, "w": 24, "x": 0, "y": 13 }
      },
      {
        "title": "PHP-FPM Process Saturation",
        "type": "gauge",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "php_fpm_active_processes / php_fpm_max_processes",
            "legendFormat": "Saturation"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percentunit",
            "min": 0, "max": 1,
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 0.7, "color": "yellow" },
                { "value": 0.9, "color": "red" }
              ]
            }
          }
        },
        "gridPos": { "h": 6, "w": 6, "x": 0, "y": 14 }
      },
      {
        "title": "Redis Memory Usage",
        "type": "gauge",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "redis_memory_used_bytes / redis_memory_max_bytes",
            "legendFormat": "Memory Usage"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percentunit",
            "min": 0, "max": 1,
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 0.75, "color": "yellow" },
                { "value": 0.9, "color": "red" }
              ]
            }
          }
        },
        "gridPos": { "h": 6, "w": 6, "x": 6, "y": 14 }
      },
      {
        "title": "PHP-FPM Active/Idle/Queue",
        "type": "timeseries",
        "datasource": "Prometheus",
        "targets": [
          { "expr": "php_fpm_active_processes", "legendFormat": "Active" },
          { "expr": "php_fpm_idle_processes", "legendFormat": "Idle" },
          { "expr": "php_fpm_listen_queue_len", "legendFormat": "Listen Queue" }
        ],
        "fieldConfig": {
          "defaults": {
            "custom": { "lineWidth": 2, "fillOpacity": 30 }
          }
        },
        "gridPos": { "h": 6, "w": 12, "x": 12, "y": 14 }
      },
      {
        "title": "Cache Hit Rate",
        "type": "timeseries",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "100 * sum(rate(app_cache_operations_total{result=\"hit\"}[5m])) / sum(rate(app_cache_operations_total[5m]))",
            "legendFormat": "Hit Rate %"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "min": 0, "max": 100,
            "thresholds": {
              "steps": [
                { "value": 0, "color": "red" },
                { "value": 70, "color": "yellow" },
                { "value": 90, "color": "green" }
              ]
            },
            "custom": { "lineWidth": 2, "fillOpacity": 20 }
          }
        },
        "gridPos": { "h": 6, "w": 12, "x": 0, "y": 20 }
      },
      {
        "title": "Queue Depth by Queue",
        "type": "timeseries",
        "datasource": "Prometheus",
        "targets": [
          {
            "expr": "app_queue_depth",
            "legendFormat": "{{queue}}"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "custom": { "lineWidth": 2, "fillOpacity": 30 }
          }
        },
        "gridPos": { "h": 6, "w": 12, "x": 12, "y": 20 }
      }
    ]
  }
}
```

导入方式：Grafana → Dashboards → Import → 粘贴 JSON → Load。

## 五、告警规则与 AlertManager 配置

### 5.1 告警设计原则

我见过太多团队把 Prometheus 告警配成"狼来了"——CPU 一抖就告警、内存 80% 就告警，最后大家把告警频道 mute 了。我们遵循以下原则：

- **关键告警必须是"正在影响用户"的指标**，而不是"某资源快满了"
- **所有告警必须有 `for` 持续时间**，避免瞬间抖动触发
- **按严重程度分级**：`critical` = 电话叫人，`warning` = Slack 通知
- **每条告警必须有可操作的 runbook**

### 5.2 告警规则（alert_rules.yml）

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
          team: backend
        annotations:
          summary: "P95 latency > 2s on {{ $labels.route }}"
          description: "Route {{ $labels.route }} P95 has been {{ $value | humanizeDuration }} for 5 minutes."
          runbook_url: "https://wiki.internal/runbooks/high-latency"

      # 2. 5xx 错误率持续 3 分钟超过 5%
      - alert: HighErrorRate
        expr: app:http_requests:error_rate > 0.05
        for: 3m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "5xx error rate > 5% on {{ $labels.route }}"
          description: "Route {{ $labels.route }} error rate is {{ $value | humanizePercentage }}."
          runbook_url: "https://wiki.internal/runbooks/high-error-rate"

      # 3. PHP-FPM 进程池饱和
      - alert: FpmPoolSaturated
        expr: php_fpm_active_processes / php_fpm_max_processes > 0.9
        for: 2m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "PHP-FPM pool is >90% saturated"
          description: "PHP-FPM active {{ $value | humanizePercentage }} of max processes."
          runbook_url: "https://wiki.internal/runbooks/fpm-saturated"

      # 4. 队列积压超过 10000
      - alert: QueueBacklogHigh
        expr: app_queue_depth > 10000
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Queue {{ $labels.queue }} backlog > 10000"
          description: "Queue {{ $labels.queue }} has {{ $value }} pending jobs."

      # 5. Redis 内存使用率 > 85%
      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.85
        for: 10m
        labels:
          severity: warning
          team: infra
        annotations:
          summary: "Redis memory usage > 85%"
          description: "Redis memory used {{ $value | humanizePercentage }}."

      # 6. 缓存命中率低于 70%
      - alert: CacheHitRateLow
        expr: app:cache_operations:hit_ratio < 0.7
        for: 15m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Cache hit rate < 70%"
          description: "Cache hit rate is {{ $value | humanizePercentage }} for 15 minutes."

      # 7. Scrape 目标不可用
      - alert: TargetDown
        expr: up{job="laravel-b2c-api"} == 0
        for: 1m
        labels:
          severity: critical
          team: infra
        annotations:
          summary: "Scrape target {{ $labels.instance }} is down"
          description: "Prometheus cannot scrape {{ $labels.instance }} for 1 minute."
```

### 5.3 AlertManager 配置

```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/T00/B00/xxx'

route:
  group_by: ['alertname', 'severity', 'route']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'slack-backend'

  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      continue: true  # 同时也发到 slack

    - match:
        severity: warning
      receiver: 'slack-backend'

receivers:
  - name: 'slack-backend'
    slack_configs:
      - channel: '#backend-alerts'
        send_resolved: true
        title: '[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}'
        text: |
          {{ range .Alerts }}
          *Summary*: {{ .Annotations.summary }}
          *Description*: {{ .Annotations.description }}
          {{ if .Annotations.runbook_url }}*Runbook*: {{ .Annotations.runbook_url }}{{ end }}
          *Labels*: {{ .Labels.SortedPairs.Values | join " " }}
          {{ end }}

  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: 'xxxxxxxxxxxx'
        severity: critical
        description: '{{ .CommonAnnotations.summary }}'

# 告警抑制：critical 告警触发时抑制同一 alertname 的 warning
inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'route']

# 静默规则（维护窗口）
# 通过 AlertManager API 或 Grafana UI 操作，不写死在配置里
```

## 六、生产环境踩坑记录（10 个案例）

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

**经验法则**：一个 label 的基数（cardinality）控制在 100 以内，总时间序列数不超过 10 万条。超过这个数字，用 Prometheus 的 `relabel_configs` 在采集时做聚合。

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

### 坑 6：多个服务共享同一个 Redis DB 导致指标互相覆盖

**现象**：B2C API 和 Admin API 同时把指标推到 Prometheus PushGateway，但两者的 `app_http_requests_total` 互相覆盖，最终 Grafana 上看到的 RPS 是两个服务的混合值。

**原因**：PushGateway 按 `{job}/{instance}` 做区分，如果两个服务用了相同的 `job_name` 且 `instance` 也相同，后推送的会覆盖先推送的。

**修复**：
1. 每个服务用不同的 PushGateway `job` 名称
2. Prometheus 存储后端用不同的 Redis DB（`database: 5` vs `database: 6`）
3. 指标命名加 `service` 前缀（如 `b2c_api_http_requests_total`）

### 坑 7：Histogram bucket 选择不当导致延迟数据失真

**现象**：P95 延迟显示 5 秒，但实际 APM 显示只有 800ms。

**原因**：Histogram 的 bucket 设得太粗，`[0.1, 0.5, 1, 5, 10]`，800ms 的请求落在 `1` 这个 bucket，Prometheus 线性插值后误算为接近 1 秒或更高。

**修复**：在关键延迟区间加密 bucket：

```php
[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
```

经验法则：**在你关心的延迟阈值附近放更多 bucket**。比如你关心 200ms SLA，就在 0.1-0.3 之间加密。

### 坑 8：AlertManager 分组导致告警风暴

**现象**：一次部署引入 bug，所有 API 端点 5xx 飙升。Slack 频道在 1 分钟内收到 47 条告警消息。

**原因**：告警规则按 `route` label 拆分，30+ 个端点各触发一条，且 `group_by` 没有设置合理的 `group_wait`。

**修复**：
```yaml
# alertmanager.yml
route:
  group_by: ['alertname']  # 只按 alertname 分组，不按 route
  group_wait: 30s           # 等 30 秒再发，让同组告警聚合
  group_interval: 5m        # 同组更新间隔
  repeat_interval: 4h       # 重复通知间隔
```

### 坑 9：Prometheus 升级后 recording rules 语法不兼容

**现象**：Prometheus 从 2.30 升级到 2.45 后，部分 recording rules 的值变成 `NaN`。

**原因**：新版 Prometheus 对 `histogram_quantile` 的 `by (le)` 要求更严格。旧规则漏掉了 `le` 标签。

**修复**：

```yaml
# ❌ 旧写法（2.30 兼容，2.45 报错）
- record: app:http_request_duration_seconds:p95
  expr: |
    histogram_quantile(0.95,
      sum(rate(app_http_request_duration_seconds_bucket[5m])) by (route)
    )

# ✅ 新写法（必须包含 le）
- record: app:http_request_duration_seconds:p95
  expr: |
    histogram_quantile(0.95,
      sum(rate(app_http_request_duration_seconds_bucket[5m])) by (le, route)
    )
```

### 坑 10：高并发下 Prometheus client 库的 Redis 连接耗尽

**现象**：高峰期 Laravel 报 `Connection refused` 错误，但不是对外服务的连接，而是 Redis 连接池耗尽。

**原因**：每个请求都通过中间件调用 `getOrRegisterCounter()` / `getOrRegisterHistogram()`，这些操作会查 Redis。在 200 QPS × 4 个指标 = 800 Redis ops/sec 的场景下，如果 Redis 连接池配置不当就会打爆。

**修复**：
1. 使用 `persistent_connections: true` 开启持久连接
2. Prometheus Redis 和业务 Redis 分开，使用独立的 Redis 实例或 DB
3. 考虑用 `apcu` 做本地缓存 + 定期批量 push 到 Redis（减少连接压力）

```php
Redis::setDefaultOptions([
    'host' => 'prometheus-redis.internal',
    'port' => 6379,
    'database' => 5,
    'persistent_connections' => true,
    'timeout' => 0.1,
    'read_timeout' => 1,
]);
```

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

落地路线建议：
1. **第一周**：部署 Prometheus + Grafana，接入 `http_requests_total` 和 `http_request_duration_seconds`
2. **第二周**：添加 RED 方法三个面板，配置 P95 延迟和 5xx 错误率告警
3. **第三周**：接入 PHP-FPM + Redis USE 指标，配置饱和度告警
4. **第四周**：完善 Dashboard JSON，导入到 Grafana，配置 AlertManager 通知路由

如果你的团队已经在用 New Relic/Datadog 等商业 APM，建议先在预发环境跑一套 Prometheus + Grafana 作为**自定义指标的补充**，等确认指标模型稳定后再考虑完全替换。监控迁移不要一步到位，分阶段来最安全。

---

## 相关阅读

- [AI Agent Observability 进阶：LangSmith vs LangFuse vs Helicone 实战——成本追踪、延迟分析与回归测试闭环](/00_架构/2026-06-05-AI-Agent-Observability-LangSmith-LangFuse-Helicone) — 可观测性不只在基础设施层，AI Agent 的成本追踪与延迟分析同样需要完善的监控体系
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/00_架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移) — 当 PHP-FPM 饱和度持续告警时，可能是时候考虑用 Go 重写热点模块
- [Developer Productivity Metrics 实战：SPACE 框架度量开发者效能](/00_架构/Developer-Productivity-Metrics-SPACE框架度量开发者效能-DORA之外的代码质量协作效率与满意度追踪) — 从基础设施监控延伸到工程效能度量，构建完整的可观测性闭环
