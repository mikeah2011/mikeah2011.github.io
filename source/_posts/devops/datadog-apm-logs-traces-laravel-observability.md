---

title: DataDog 实战：APM/Logs/Traces 统一可观测性——Laravel 应用的全栈监控方案与对比 Prometheus+Grafana
keywords: [DataDog, APM, Logs, Traces, Laravel, Prometheus, Grafana, 统一可观测性, 应用的全栈监控方案与对比, DevOps]
date: 2026-06-10 06:00:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
- Datadog
- APM
- 可观测性
- Laravel
- 监控
- 日志
- 分布式
description: 从零搭建 DataDog 对 Laravel 应用的全栈可观测性覆盖，包含 APM 性能监控、日志聚合、分布式追踪三大支柱，并与 Prometheus+Grafana 方案做深度选型对比。
---



## 为什么需要统一可观测性

线上 Laravel 应用出问题时，你的第一反应是什么？

- 用户反馈「页面很慢」→ 你需要看 **APM**（哪个接口慢、慢在哪）
- 报错白屏 → 你需要看 **Logs**（异常堆栈、错误上下文）
- 跨服务调用超时 → 你需要看 **Traces**（请求链路、哪个环节卡住）

这三件事如果分散在三个系统里，排障效率会大打折扣。**统一可观测性**的核心价值就是：一个请求，从入口到数据库到外部调用，在同一个界面里看到全貌。

DataDog 把这三件事做进了同一个平台，而且关联做得非常紧密——点击一个慢 Trace，能直接跳到对应时间段的日志；看到一个错误日志，能直接展开它的完整调用链。

## 架构概览

```
┌─────────────────────────────────────────────────┐
│                  DataDog SaaS                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │   APM    │  │   Logs   │  │  Traces  │       │
│  │ 性能监控  │  │ 日志聚合  │  │ 分布式追踪│       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       └──────────────┼──────────────┘             │
│              关联查询 / 仪表盘                      │
└─────────────────────────────────────────────────┘
                       ▲
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────┴────┐  ┌─────┴────┐  ┌────┴─────┐
    │ Laravel │  │  Queue   │  │  Redis/  │
    │   App   │  │ Workers  │  │  MySQL   │
    └─────────┘  └──────────┘  └──────────┘
```

核心组件：

| 组件 | 作用 | 部署方式 |
|------|------|----------|
| dd-trace-php | PHP APM 探针，采集 Trace 和 Span | PHP 扩展 |
| datadog-agent | 日志收集、指标上报、Trace 接收 | 系统服务 |
| monolog handler | 应用日志发送到 Agent | 代码配置 |

## 第一步：安装 dd-trace-php 扩展

dd-trace-php 是 DataDog 的 PHP APM 探针，它以 PHP 扩展形式运行，开销极低（生产环境通常 < 3% CPU）。

### 安装

```bash
# 自动安装（推荐，会检测 PHP 版本和 SAPI）
curl -LO https://github.com/DataDog/dd-trace-php/releases/latest/download/datadog-setup.php
php datadog-setup.php --php=all --enable-appsec --enable-profiling

# 验证安装
php -m | grep ddtrace
# 输出: ddtrace
```

### 配置 php.ini

```ini
[ddtrace]
ddtrace.request_init_hook=/opt/datadog/dd-library/bridge/dd_wrap_autoloader.php

; APM 配置
ddtrace.agent_url=http://localhost:8126

; 服务名（重要，会显示在 DataDog UI 里）
DD_SERVICE=kkday-b2c-api

; 环境标识
DD_ENV=production

; 版本号（用于部署追踪）
DD_VERSION=1.2.3

; 采样率（1.0 = 100%，生产环境建议 0.1-0.5）
DD_TRACE_SAMPLE_RATE=0.3

; 启用自动注入的框架
DD_TRACE_LARAVEL_ENABLED=true

; 生产环境关闭调试日志
DD_TRACE_DEBUG=false
```

### 环境变量方式（推荐用于容器化部署）

在 `docker-compose.yml` 或 K8s deployment 里直接用环境变量：

```yaml
environment:
  - DD_SERVICE=kkday-b2c-api
  - DD_ENV=production
  - DD_VERSION=${GIT_SHA}
  - DD_TRACE_SAMPLE_RATE=0.3
  - DD_TRACE_LARAVEL_ENABLED=true
  - DD_AGENT_HOST=datadog-agent
  - DD_TRACE_AGENT_PORT=8126
```

## 第二步：配置 DataDog Agent 收集日志

Agent 是数据收集的枢纽，它负责接收 Trace、采集日志、上报指标。

### 安装 Agent

```bash
# macOS
brew install datadog-agent/tap/datadog-agent

# Linux
DD_API_KEY=<your-api-key> DD_SITE="datadoghq.com" bash -c "$(curl -L https://install.datadoghq.com/scripts/install_script_agent7.sh)"

# Docker
docker run -d --name datadog-agent \
  -e DD_API_KEY=<your-api-key> \
  -e DD_SITE="datadoghq.com" \
  -e DD_LOGS_ENABLED=true \
  -e DD_APM_ENABLED=true \
  -e DD_PROCESS_AGENT_ENABLED=true \
  -p 8126:8126 \
  -p 8125:8125/udp \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /proc/:/host/proc/:ro \
  -v /opt/datadog-agent/run:/opt/datadog-agent/run:rw \
  datadog/agent:7
```

### 启用日志收集

编辑 `/etc/datadog-agent/datadog.yaml`：

```yaml
# 启用日志收集
logs_enabled: true

# APM 配置
apm_config:
  enabled: true
  receiver_port: 8126
```

为 Laravel 创建日志配置 `/etc/datadog-agent/conf.d/laravel.d/conf.yaml`：

```yaml
logs:
  - type: file
    path: /var/www/storage/logs/laravel.log
    service: kkday-b2c-api
    source: php
    sourcecategory: laravel
    log_processing_rules:
      # 多行日志合并（堆栈信息）
      - type: multi_line
        name: log_multiline
        pattern: '\[\d{4}-\d{2}-\d{2}'
```

## 第三步：Laravel 应用集成

### 安装 DataDog Laravel 包

```bash
composer require datadog/dd-trace-php
```

dd-trace-php 会自动注入 Laravel 的中间件、数据库查询、队列任务等，**零代码改动**即可获得基础 APM 能力。

### 结构化日志输出

默认的 Laravel 日志是纯文本，DataDog 更喜欢 JSON 格式。修改 `config/logging.php`：

```php
<?php

return [
    'channels' => [
        'stack' => [
            'driver' => 'stack',
            'channels' => ['single', 'datadog'],
            'ignore_exceptions' => false,
        ],

        // 保留原有文件日志
        'single' => [
            'driver' => 'single',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'debug'),
        ],

        // DataDog JSON 日志
        'datadog' => [
            'driver' => 'monolog',
            'handler' => \Monolog\Handler\StreamHandler::class,
            'formatter' => \Monolog\Formatter\JsonFormatter::class,
            'with' => [
                'stream' => 'php://stderr', // Agent 从 stderr 采集
            ],
            'level' => env('LOG_LEVEL', 'info'),
            'tap' => [
                \App\Logging\DatadogContextProcessor::class,
            ],
        ],
    ],
];
```

创建上下文处理器 `app/Logging/DatadogContextProcessor.php`：

```php
<?php

namespace App\Logging;

use Monolog\Logger;
use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;

class DatadogContextProcessor implements ProcessorInterface
{
    public function __invoke(LogRecord $record): LogRecord
    {
        // 注入 Trace ID，实现日志与 Trace 关联
        $record->extra['dd.trace_id'] = dd_trace_id() ?: null;
        $record->extra['dd.span_id'] = dd_trace_root_id() ?: null;
        $record->extra['dd.service'] = config('app.name');
        $record->extra['dd.env'] = app()->environment();
        $record->extra['dd.version'] = config('app.version');

        // 注入请求上下文
        if (app()->bound('request')) {
            $request = app('request');
            $record->extra['http.method'] = $request->method();
            $record->extra['http.url'] = $request->fullUrl();
            $record->extra['http.user_agent'] = $request->userAgent();
            $record->extra['user.id'] = auth()->id();
        }

        return $record;
    }
}
```

### 自定义 Span（手动埋点）

自动注入覆盖了 HTTP 请求、数据库查询等常见场景，但业务逻辑中的关键步骤需要手动埋点：

```php
<?php

namespace App\Services;

use DDTrace\GlobalTracer;
use DDTrace\Tag;

class OrderService
{
    public function createOrder(array $data): Order
    {
        // 手动创建 Span
        $scope = GlobalTracer::get()->startActiveSpan('order.create');
        $span = $scope->getSpan();

        try {
            $span->setTag(Tag::SERVICE_NAME, 'kkday-b2c-api');
            $span->setTag(Tag::RESOURCE_NAME, 'OrderService::createOrder');
            $span->setTag('order.product_id', $data['product_id']);
            $span->setTag('order.amount', $data['amount']);

            // 业务逻辑
            $order = $this->processOrder($data);

            $span->setTag('order.id', $order->id);
            $span->setTag(Tag::HTTP_STATUS_CODE, 201);

            return $order;
        } catch (\Throwable $e) {
            $span->setError($e);
            throw $e;
        } finally {
            $span->finish();
            $scope->close();
        }
    }

    private function processOrder(array $data): Order
    {
        // 嵌套 Span 自动成为子 Span
        $scope = GlobalTracer::get()->startActiveSpan('order.process');
        $span = $scope->getSpan();

        try {
            // 库存检查
            $this->checkInventory($data['product_id']);

            // 支付
            $this->processPayment($data);

            // 创建订单记录
            return Order::create($data);
        } finally {
            $span->finish();
            $scope->close();
        }
    }
}
```

### 队列任务监控

Laravel 队列任务是 APM 的重要场景。dd-trace-php 自动为队列任务创建 Trace，但你也可以添加自定义信息：

```php
<?php

namespace App\Jobs;

use DDTrace\GlobalTracer;
use DDTrace\Tag;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ProcessBooking implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(
        private readonly int $bookingId,
        private readonly array $params
    ) {}

    public function handle(): void
    {
        $scope = GlobalTracer::get()->startActiveSpan('queue.process_booking');
        $span = $scope->getSpan();

        try {
            $span->setTag('booking.id', $this->bookingId);
            $span->setTag(Tag::SERVICE_NAME, 'kkday-b2c-api-queue');

            // 队列任务逻辑
            $booking = Booking::findOrFail($this->bookingId);
            $this->processBooking($booking);

        } catch (\Throwable $e) {
            $span->setError($e);
            report($e);
            throw $e;
        } finally {
            $span->finish();
            $scope->close();
        }
    }
}
```

## 第四步：构建监控仪表盘

### 关键指标

对于 Laravel 应用，重点关注这些指标：

| 指标 | 含义 | 告警阈值建议 |
|------|------|-------------|
| `trace.http.request.duration` | HTTP 请求耗时 | p95 > 2s |
| `trace.http.request.errors` | 请求错误率 | > 1% |
| `php.queue.process.duration` | 队列任务耗时 | p95 > 30s |
| `php.db.query.duration` | 数据库查询耗时 | p95 > 500ms |
| `log.error.count` | 错误日志数量 | 5min 内 > 50 |

### 创建 Dashboard

通过 DataDog UI 或 Terraform 创建仪表盘。Terraform 示例：

```hcl
resource "datadog_dashboard_json" "laravel_overview" {
  dashboard = jsonencode({
    title       = "KKday B2C Laravel Overview"
    description = "Laravel 应用全栈监控"
    layout_type = "ordered"
    widgets = [
      {
        definition = {
          type = "timeseries"
          title  = "HTTP 请求延迟 (P50/P95/P99)"
          requests = [
            {
              display_type = "line"
              q = "avg:trace.http.request.duration{service:kkday-b2c-api} by {resource_name}.rollup(avg, 60)"
              metadata = [
                { expression = "avg:trace.http.request.duration{service:kkday-b2c-api,resource_name:@@@@}.rollup(avg, 60) as p50",
                  alias_name = "P50" }
              ]
            }
          ]
        }
      },
      {
        definition = {
          type = "query_value"
          title  = "当前错误率"
          requests = [
            {
              q = "sum:trace.http.request.errors{service:kkday-b2c-api}.as_rate()"
            }
          ]
        }
      },
      {
        definition = {
          type = "log_stream"
          title  = "最近错误日志"
          query  = "service:kkday-b2c-api status:error"
          columns  = ["timestamp", "message", "http.url"]
        }
      }
    ]
  })
}
```

### 告警配置

```hcl
resource "datadog_monitor" "http_error_rate" {
  name    = "KKday B2C HTTP 错误率过高"
  type    = "metric alert"
  message = <<-EOM
    HTTP 5xx 错误率超过阈值。
    @slack-ops-alerts @pagerduty-critical
    Runbook: https://wiki.kkday.com/runbooks/http-5xx
  EOM

  query = "sum(last_5m):sum:trace.http.request.errors{service:kkday-b2c-api,http.status_code:5xx}.as_rate() > 0.01"

  monitor_thresholds {
    critical          = 0.01
    warning           = 0.005
    critical_recovery = 0.005
  }

  notify_no_data    = false
  renotify_interval = 30
  tags              = ["service:kkday-b2c-api", "env:production"]
}
```

## 第五步：DataDog vs Prometheus+Grafana 选型对比

这是很多团队纠结的问题。两者都能做监控，但定位和体验差异很大。

### 架构对比

```
Prometheus + Grafana 方案：
┌──────────┐    pull     ┌───────────┐    ┌──────────┐
│ Laravel  │ ────────── │ Prometheus│ ── │ Grafana  │
│ (metrics)│            │  (存储)    │    │ (展示)   │
└──────────┘            └───────────┘    └──────────┘
┌──────────┐            ┌───────────┐
│  Loki    │ ────────── │ Grafana   │  ← 日志另接
└──────────┘            └───────────┘
┌──────────┐            ┌───────────┐
│  Tempo   │ ────────── │ Grafana   │  ← Trace 另接
└──────────┘            └───────────┘

DataDog 方案：
┌──────────┐    push     ┌──────────────────────────┐
│ Laravel  │ ────────── │      DataDog SaaS         │
│ (all)    │            │  APM + Logs + Traces      │
└──────────┘            │  统一存储、关联查询、告警    │
                        └──────────────────────────┘
```

### 功能对比

| 维度 | DataDog | Prometheus + Grafana |
|------|---------|---------------------|
| **部署** | SaaS，无需维护 | 自建，需要运维 Prometheus/Grafana/Loki/Tempo |
| **成本** | 按主机+用量计费，$23/主机/月起 | 开源免费，但有基础设施+人力成本 |
| **APM** | 内置，自动注入 | 需要接 Jaeger/Zipkin，配置复杂 |
| **日志** | 内置 Logs，自动关联 Trace | 需要额外部署 Loki 或 ELK |
| **Trace** | 内置，与 APM 无缝集成 | 需要 Tempo/Jaeger，关联需手动配置 |
| **告警** | 内置，支持 PagerDuty/Slack/邮件 | Alertmanager 配置复杂 |
| **关联查询** | 原生支持，Trace→Logs→Metrics 一键跳转 | 需要手动配置数据源关联 |
| **PHP 支持** | dd-trace-php 自动注入，零代码 | 需要手动埋点或接 OpenTelemetry |
| **数据保留** | 默认 15 天（可延长） | 取决于存储配置，可无限保留 |
| **隐私合规** | 数据在 SaaS，需评估合规性 | 数据完全在本地，合规性强 |

### 选型建议

**选 DataDog 的场景：**

- 团队规模小（< 20 人），不想运维监控基础设施
- 需要快速搭建，开箱即用
- 预算充足，愿意为省时付费
- 需要强大的关联分析能力（Trace→Logs 一键跳转）
- PHP/Laravel 为主的技术栈，dd-trace-php 支持好

**选 Prometheus + Grafana 的场景：**

- 有专职 SRE 团队维护监控系统
- 数据合规要求严格，数据不能出机房
- 大规模部署（数百台主机），DataDog 成本会很高
- 已有 Prometheus 基础设施，只需扩展
- 需要高度自定义的仪表盘和告警规则

**混合方案（推荐）：**

很多团队采用混合策略——用 Prometheus + Grafana 做基础指标监控（成本低），用 DataDog 做 APM + Trace（开箱即用体验好）。

```yaml
# 混合方案配置示例
# Prometheus 抓取应用指标
scrape_configs:
  - job_name: 'laravel'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['app:9090']

# DataDog 只做 APM + Logs
# dd-trace-php 配置
DD_SERVICE=kkday-b2c-api
DD_TRACE_SAMPLE_RATE=0.3
# 关闭 DataDog 的指标收集，避免重复
DD_DOGSTATSD_NON_LOCAL_TRAFFIC=false
```

## 踩坑记录

### 1. dd-trace-php 导致 OOM

**现象**：开启 APM 后，PHP-FPM 进程内存持续增长，最终 OOM。

**原因**：dd-trace-php 默认会缓存所有 Span 到内存，高并发场景下 Span 数量爆炸。

**解决**：

```ini
; 限制单个请求的 Span 数量
DD_TRACE_SPANS_LIMIT=1000

; 降低采样率
DD_TRACE_SAMPLE_RATE=0.1

; 排除不需要追踪的路径
DD_TRACE_URL_AS_RESOURCE_NAMES_ENABLED=true
DD_TRACE_RESOURCE_URI_MAPPING=/healthcheck,/metrics
```

### 2. 日志关联 Trace ID 失败

**现象**：DataDog UI 里日志和 Trace 对不上。

**原因**：`dd_trace_id()` 在 CLI/队列环境下返回空值。

**解决**：

```php
// 确保在 Trace 上下文中调用
$traceId = function_exists('dd_trace_id') ? dd_trace_id() : null;
if ($traceId) {
    $record->extra['dd.trace_id'] = $traceId;
}
```

### 3. 队列任务 Trace 断链

**现象**：HTTP 请求和队列任务的 Trace 是分开的，看不到完整链路。

**原因**：队列任务在新进程里执行，Trace 上文丢失。

**解决**：通过 Job payload 传递 Trace 上下文：

```php
class ProcessBooking implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private readonly int $bookingId,
        // 传递 Trace 上下文
        private readonly ?string $traceId = null,
        private readonly ?string $spanId = null,
    ) {
        // 在构造时捕获当前 Trace 信息
        if (!$this->traceId && function_exists('dd_trace_id')) {
            $this->traceId = (string) dd_trace_id();
            $this->spanId = (string) dd_trace_root_id();
        }
    }

    public function handle(): void
    {
        // 手动关联父 Trace
        if ($this->traceId) {
            $scope = GlobalTracer::get()->startActiveSpan('queue.process_booking', [
                'child_of' => new SpanContext($this->traceId, $this->spanId),
            ]);
        }
        // ...
    }
}
```

### 4. 生产环境性能影响

**现象**：APM 开启后 API 响应时间增加 10-15ms。

**优化**：

```ini
; 关闭不需要的自动注入
DD_TRACE_CURL_ENABLED=false
DD_TRACE_PDO_ENABLED=true  ; 保留数据库追踪

; 使用采样而不是全量
DD_TRACE_SAMPLE_RATE=0.1

; 关闭运行时指标（改用 Agent 收集）
DD_TRACE_CLI_ENABLED=false

; 启用 Span 压缩
DD_TRACE_SPAN_AGENT_COMPRESSION=true
```

## 总结

统一可观测性不是奢侈品，是现代 Laravel 应用的标配。选择 DataDog 还是 Prometheus+Grafana，取决于团队规模、预算和合规要求。

**关键决策点：**

1. **小团队快速起步** → DataDog，零运维，开箱即用
2. **大团队自建可控** → Prometheus + Grafana + Loki + Tempo，成本低但需要投入运维
3. **折中方案** → Prometheus 管指标，DataDog 管 APM + Trace

无论选哪个方案，核心原则不变：**Trace ID 贯穿全链路，日志必须关联 Trace，指标必须有告警**。

先把 dd-trace-php 跑起来，你就能在 DataDog 里看到 Laravel 应用的完整调用链——哪条 SQL 慢、哪个外部调用卡住了、哪个队列任务失败了，一目了然。

---

> 本文基于 dd-trace-php v0.98+ 和 DataDog Agent v7，Laravel 10/11 兼容。
