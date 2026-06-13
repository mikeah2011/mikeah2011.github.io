---
title: SLO/SLI 实战：用服务等级目标驱动可靠性——Laravel API 的 Error Budget 与告警策略
date: 2026-06-02 08:00:00
tags: [SLO, SLI, 可靠性, 告警, DevOps, Laravel, Prometheus]
keywords: [SLO, SLI, Laravel API, Error Budget, 用服务等级目标驱动可靠性, 与告警策略, DevOps]
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
description: SLO/SLI 实战指南，用服务等级目标驱动可靠性工程决策。从概念辨析到 Laravel API 项目落地，涵盖 SLI 指标定义、Prometheus 指标采集、Grafana SLO 看板搭建、Error Budget 燃烧率告警策略设计，以及基于 Error Budget 的发布流程管控。帮助团队从「凭感觉运维」升级到「用数据说话」的可靠性治理体系。
---


"我们的 API 可用性是 99.9%。"——这句话在技术会议上经常听到，但很少有人能回答：这个数字是怎么测量的？测量的是哪个指标？在什么时间窗口内？当可用性降到 99.5% 时，团队应该做什么？

SLO（Service Level Objective）体系的核心不是"事后看看监控面板"，而是用量化的目标驱动团队的工程决策：要不要上线新功能？要不要投入时间做技术债清理？要不要扩容？这些问题的答案，都藏在 Error Budget 里。

本文将从概念到落地，完整展示如何在 Laravel API 项目中建立 SLO/SLI 体系，包括 Prometheus 指标采集、Grafana 看板搭建、Alertmanager 告警策略设计，以及团队协作流程。

<!-- more -->

## SLI / SLO / SLA 概念辨析

这三个术语经常被混用，但它们有明确的层次关系：

### SLI（Service Level Indicator）—— 服务等级指标

SLI 是一个**可量化的技术指标**，用来衡量服务的某个方面。例如：

- **可用性**：成功请求数 / 总请求数（HTTP 5xx 比率）
- **延迟**：请求处理时间的 P50、P95、P99 分位值
- **正确性**：返回正确结果的请求比例
- **吞吐量**：每秒处理的请求数（QPS）

```yaml
# SLI 定义示例
sli_availability:
  description: "HTTP 请求成功率"
  metric: "sum(rate(http_requests_total{status!~'5..'}[5m])) / sum(rate(http_requests_total[5m]))"
  type: "availability"

sli_latency_p99:
  description: "99 分位延迟"
  metric: "histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))"
  type: "latency"
```

### SLO（Service Level Objective）—— 服务等级目标

SLO 是对 SLI 设定的**目标值**。例如：

- 可用性 SLO：99.9%（每月允许宕机 43.8 分钟）
- 延迟 SLO：P99 < 500ms（99% 的请求在 500ms 内完成）
- 正确性 SLO：99.99% 的请求返回正确结果

SLO 的关键特性：
- 由**技术团队**定义和维护
- 基于**用户感知**，不是技术指标
- 有明确的**时间窗口**（滚动 30 天、日历月、季度）
- 与 Error Budget 挂钩

### SLA（Service Level Agreement）—— 服务等级协议

SLA 是**商业合同**，包含承诺和违约后果：

- 承诺可用性 99.9%
- 违约时：月费减免 10%
- 排除条款：计划维护、不可抗力、客户自身原因

```
SLA（商业承诺）← 外部约束
  └── SLO（内部目标）← 团队自驱
        └── SLI（技术指标）← 可测量
```

**最佳实践**：SLO 应该比 SLA 更严格。如果 SLA 承诺 99.9%，SLO 应该设在 99.95%。这样即使 SLO 略有未达标，仍然满足 SLA 承诺。

## Laravel API 的 SLI 定义

### 可用性 SLI

```php
<?php

namespace App\Middleware;

use Closure;
use Illuminate\Http\Request;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\APC;

class SliMiddleware
{
    private CollectorRegistry $registry;

    public function __construct()
    {
        static $registry = null;
        if ($registry === null) {
            $adapter = new APC();
            $registry = CollectorRegistry::getDefault($adapter);
        }
        $this->registry = $registry;
    }

    public function handle(Request $request, Closure $next)
    {
        $start = microtime(true);

        // 请求计数器
        $counter = $this->registry->getOrRegisterCounter(
            'http_requests_total',
            'Total HTTP requests',
            ['method', 'path', 'status']
        );

        // 延迟直方图
        $histogram = $this->registry->getOrRegisterHistogram(
            'http_request_duration_seconds',
            'Request duration in seconds',
            ['method', 'path', 'status'],
            [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
        );

        $response = $next($request);

        $duration = microtime(true) - $start;
        $status = $response->getStatusCode();
        $path = $request->route()?->uri() ?? $request->path();
        $method = $request->method();

        // 记录指标
        $counter->inc([$method, $path, (string) $status]);
        $histogram->observe($duration, [$method, $path, (string) $status]);

        // 额外记录：业务错误 vs 系统错误
        if ($status >= 500) {
            $this->registry->getOrRegisterCounter(
                'http_server_errors_total',
                'Server errors (5xx)',
                ['method', 'path', 'error_type']
            )->inc([$method, $path, $this->classifyError($response)]);
        }

        return $response;
    }

    private function classifyError($response): string
    {
        $body = $response->getContent();
        if (str_contains($body, 'database')) return 'database';
        if (str_contains($body, 'timeout')) return 'timeout';
        if (str_contains($body, 'connection')) return 'connection';
        return 'unknown';
    }
}
```

### 延迟 SLI

在 Laravel 中，延迟的测量需要覆盖从请求进入到响应发出的完整链路：

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\DB;

class SliMetricsServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 数据库查询延迟
        DB::listen(function ($query) {
            $duration = $query->time / 1000; // ms to seconds

            app('prometheus.histogram', [
                'name' => 'db_query_duration_seconds',
                'help' => 'Database query duration',
                'labels' => ['connection', 'type'],
            ])->observe($duration, [
                $query->connectionName,
                $query->type ?? 'unknown',
            ]);
        });

        // Redis 操作延迟
        $this->app['events']->listen(
            \Illuminate\Redis\Events\CommandExecuted::class,
            function ($event) {
                app('prometheus.histogram', [
                    'name' => 'redis_command_duration_seconds',
                    'help' => 'Redis command duration',
                    'labels' => ['command', 'connection'],
                ])->observe($event->time / 1000, [
                    $event->command,
                    $event->connectionName,
                ]);
            }
        );
    }
}
```

### 正确性 SLI

业务正确性是最容易被忽视的 SLI：

```php
<?php

namespace App\Services\Sli;

use Illuminate\Support\Facades\Cache;

class BusinessSliTracker
{
    /**
     * 追踪订单创建成功率
     */
    public function trackOrderCreation(bool $success, string $failureReason = null): void
    {
        $key = 'sli:order_creation:' . date('Y-m-d:H');

        Cache::increment("{$key}:total");
        if ($success) {
            Cache::increment("{$key}:success");
        } else {
            Cache::increment("{$key}:failure:{$failureReason}");
        }

        // TTL 设为 7 天，便于事后分析
        Cache::put($key, Cache::get($key), now()->addDays(7));
    }

    /**
     * 追踪支付成功率
     */
    public function trackPayment(bool $success, string $channel, string $failureReason = null): void
    {
        $key = 'sli:payment:' . date('Y-m-d:H');

        Cache::increment("{$key}:total");
        Cache::increment("{$key}:channel:{$channel}:total");

        if ($success) {
            Cache::increment("{$key}:success");
            Cache::increment("{$key}:channel:{$channel}:success");
        } else {
            Cache::increment("{$key}:failure");
            Cache::increment("{$key}:channel:{$channel}:failure:{$failureReason}");
        }
    }

    /**
     * 获取当前小时的 SLI 值
     */
    public function getSli(string $name): array
    {
        $key = "sli:{$name}:" . date('Y-m-d:H');
        $total = (int) Cache::get("{$key}:total", 0);
        $success = (int) Cache::get("{$key}:success", 0);

        return [
            'name' => $name,
            'total' => $total,
            'success' => $success,
            'failure' => $total - $success,
            'success_rate' => $total > 0 ? round($success / $total * 100, 4) : null,
            'timestamp' => date('Y-m-d H:00:00'),
        ];
    }
}
```

## Error Budget 计算与决策框架

### Error Budget 的核心概念

Error Budget = 1 - SLO

如果你的可用性 SLO 是 99.9%，那么你有 0.1% 的 Error Budget。在一个 30 天的滚动窗口中：

```
30 天 × 24 小时 × 60 分钟 = 43,200 分钟
Error Budget = 43,200 × 0.1% = 43.8 分钟
```

这意味着：在任意 30 天滚动窗口内，你的 API 总共可以有 43.8 分钟的不可用时间。超过这个预算，你就违反了自己的 SLO。

### Error Budget 消耗追踪

```php
<?php

namespace App\Services\Sli;

use Illuminate\Support\Facades\Cache;
use Carbon\Carbon;

class ErrorBudgetTracker
{
    private float $sloTarget;
    private int $windowDays;
    private string $serviceName;

    public function __construct(
        string $serviceName = 'laravel-api',
        float $sloTarget = 99.9,
        int $windowDays = 30
    ) {
        $this->serviceName = $serviceName;
        $this->sloTarget = $sloTarget;
        $this->windowDays = $windowDays;
    }

    /**
     * 记录一个时间窗口的 SLI 数据
     */
    public function recordWindow(float $availability): void
    {
        $key = "slo:{$this->serviceName}:availability:" . date('Y-m-d:H');
        Cache::put($key, $availability, now()->addDays($this->windowDays + 1));
    }

    /**
     * 计算滚动窗口内的 Error Budget 剩余百分比
     */
    public function getBudgetRemaining(): array
    {
        $totalMinutes = $this->windowDays * 24 * 60;
        $errorBudgetMinutes = $totalMinutes * (1 - $this->sloTarget / 100);

        // 获取过去 N 天的可用性数据
        $downtimeMinutes = $this->calculateDowntimeMinutes();

        $budgetConsumed = $downtimeMinutes / $errorBudgetMinutes * 100;
        $budgetRemaining = max(0, 100 - $budgetConsumed);

        return [
            'service' => $this->serviceName,
            'slo_target' => $this->sloTarget,
            'window_days' => $this->windowDays,
            'error_budget_total_minutes' => round($errorBudgetMinutes, 2),
            'downtime_minutes' => round($downtimeMinutes, 2),
            'budget_consumed_percent' => round($budgetConsumed, 2),
            'budget_remaining_percent' => round($budgetRemaining, 2),
            'status' => $this->getBudgetStatus($budgetRemaining),
            'calculated_at' => now()->toISOString(),
        ];
    }

    /**
     * 计算过去 N 天的宕机分钟数
     */
    private function calculateDowntimeMinutes(): float
    {
        $downtime = 0.0;

        for ($i = 0; $i < $this->windowDays; $i++) {
            $date = Carbon::now()->subDays($i)->format('Y-m-d');

            for ($hour = 0; $hour < 24; $hour++) {
                $key = "slo:{$this->serviceName}:availability:{$date}:" . str_pad($hour, 2, '0', STR_PAD_LEFT);
                $availability = Cache::get($key);

                if ($availability !== null && $availability < 100) {
                    // 每小时 60 分钟 × (1 - 可用性)
                    $downtime += 60 * (1 - $availability / 100);
                }
            }
        }

        return $downtime;
    }

    /**
     * Error Budget 状态判定
     */
    private function getBudgetStatus(float $remaining): string
    {
        if ($remaining > 50) return 'healthy';
        if ($remaining > 20) return 'warning';
        if ($remaining > 0) return 'critical';
        return 'exhausted';
    }

    /**
     * 基于 Error Budget 的决策建议
     */
    public function getDecisionGuidance(): array
    {
        $budget = $this->getBudgetRemaining();
        $remaining = $budget['budget_remaining_percent'];

        return match (true) {
            $remaining > 75 => [
                'posture' => 'aggressive',
                'guidance' => 'Error Budget 充足，可以积极发布新功能和变更。',
                'deployment' => '正常发布节奏，可以尝试激进的优化。',
                'reliability_work' => '可选的可靠性改进可以排到低优先级。',
            ],
            $remaining > 50 => [
                'posture' => 'normal',
                'guidance' => 'Error Budget 充足，正常推进功能开发。',
                'deployment' => '维持正常发布节奏。',
                'reliability_work' => '按计划推进可靠性改进。',
            ],
            $remaining > 20 => [
                'posture' => 'cautious',
                'guidance' => 'Error Budget 消耗较快，新功能需要更严格的审查。',
                'deployment' => '增加发布前的测试覆盖，考虑灰度发布。',
                'reliability_work' => '提升可靠性工作的优先级。',
            ],
            $remaining > 0 => [
                'posture' => 'freeze',
                'guidance' => 'Error Budget 几乎耗尽，冻结非必要变更。',
                'deployment' => '仅允许安全修复和关键 bug 修复。',
                'reliability_work' => '所有工程资源投入可靠性改进。',
            ],
            default => [
                'posture' => 'incident',
                'guidance' => 'Error Budget 已耗尽，SLO 违约！需要立即响应。',
                'deployment' => '全面冻结，直到恢复到安全水平。',
                'reliability_work' => '紧急故障排查和修复。',
            ],
        };
    }
}
```

## Prometheus + Grafana 实现

### Prometheus 配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "slo_rules.yml"
  - "alert_rules.yml"

scrape_configs:
  - job_name: 'laravel-api'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['laravel-app:9090']
        labels:
          service: 'laravel-api'
          environment: 'production'

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

  - job_name: 'mysql'
    static_configs:
      - targets: ['mysqld-exporter:9104']
```

### SLO 记录规则

```yaml
# slo_rules.yml
groups:
  - name: slo_availability
    interval: 30s
    rules:
      # SLI: 可用性 - 5 分钟窗口
      - record: sli:availability:5m
        expr: |
          sum(rate(http_requests_total{status!~"5.."}[5m]))
          /
          sum(rate(http_requests_total[5m]))
        labels:
          service: laravel-api

      # SLI: 可用性 - 30 天滚动窗口
      - record: sli:availability:30d
        expr: |
          sum(rate(http_requests_total{status!~"5.."}[30d]))
          /
          sum(rate(http_requests_total[30d]))
        labels:
          service: laravel-api

      # Error Budget 消耗率
      - record: slo:error_budget_burn_rate:5m
        expr: |
          (
            1 - sli:availability:5m
          ) / (
            1 - 0.999  # SLO target: 99.9%
          )

      # Error Budget 剩余百分比（过去 30 天）
      - record: slo:error_budget_remaining:30d
        expr: |
          1 - (
            (1 - sli:availability:30d) / (1 - 0.999)
          )

  - name: slo_latency
    interval: 30s
    rules:
      # SLI: P50 延迟
      - record: sli:latency:p50
        expr: |
          histogram_quantile(0.50,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
          )

      # SLI: P95 延迟
      - record: sli:latency:p95
        expr: |
          histogram_quantile(0.95,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
          )

      # SLI: P99 延迟
      - record: sli:latency:p99
        expr: |
          histogram_quantile(0.99,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
          )

      # 延迟 SLO 达标率
      - record: slo:latency_compliance_rate
        expr: |
          sum(rate(http_request_duration_seconds_bucket{le="0.5"}[30d]))
          /
          sum(rate(http_request_duration_seconds_count[30d]))
```

### 告警规则

```yaml
# alert_rules.yml
groups:
  - name: slo_alerts
    rules:
      # 快速燃烧告警：Error Budget 在 1 小时内消耗 2%（相当于 14.4 倍燃烧率）
      - alert: SLOErrorBudgetBurnRateHigh
        expr: |
          slo:error_budget_burn_rate:5m > 14.4
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Error Budget 快速消耗"
          description: "Error Budget 以 14.4x 速率燃烧。SLO 99.9% 的 30 天预算可能在 1 小时内耗尽。"
          runbook_url: "https://wiki.internal/runbooks/slo-burn-rate"

      # 慢速燃烧告警：Error Budget 在 3 天内消耗 10%
      - alert: SLOErrorBudgetBurnRateSlow
        expr: |
          (
            1 - (sum(rate(http_requests_total{status!~"5.."}[3d])) / sum(rate(http_requests_total[3d])))
          ) / (1 - 0.999) > 0.5
        for: 1h
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Error Budget 慢速消耗"
          description: "过去 3 天 Error Budget 消耗超过 50%。需要关注趋势。"

      # P99 延迟超标
      - alert: SLOLatencyP99Exceeded
        expr: |
          sli:latency:p99 > 0.5
        for: 10m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "P99 延迟超过 500ms SLO"
          description: "当前 P99 延迟: {{ $value }}s，超过 500ms SLO 目标。"

      # Error Budget 即将耗尽
      - alert: SLOErrorBudgetExhausted
        expr: |
          slo:error_budget_remaining:30d < 0.1
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Error Budget 即将耗尽"
          description: "Error Budget 剩余不足 10%。建议冻结非必要变更。"

  - name: operational_alerts
    rules:
      # 5xx 错误率突增
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          /
          sum(rate(http_requests_total[5m]))
          > 0.01
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "5xx 错误率超过 1%"

      # 数据库连接池耗尽
      - alert: DatabaseConnectionPoolExhausted
        expr: |
          mysql_global_status_threads_connected
          /
          mysql_global_variables_max_connections
          > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "数据库连接池使用率超过 90%"

      # Redis 内存使用率
      - alert: RedisMemoryHigh
        expr: |
          redis_memory_used_bytes / redis_memory_max_bytes > 0.85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Redis 内存使用率超过 85%"
```

### Grafana 看板

Grafana 看板的 JSON 配置较长，这里给出关键面板的查询：

```json
{
  "panels": [
    {
      "title": "SLO 达标状态",
      "type": "stat",
      "targets": [
        {
          "expr": "sli:availability:30d * 100",
          "legendFormat": "30天可用性"
        }
      ],
      "thresholds": {
        "steps": [
          { "value": 0, "color": "red" },
          { "value": 99.9, "color": "yellow" },
          { "value": 99.95, "color": "green" }
        ]
      }
    },
    {
      "title": "Error Budget 剩余",
      "type": "gauge",
      "targets": [
        {
          "expr": "slo:error_budget_remaining:30d * 100",
          "legendFormat": "Budget 剩余"
        }
      ],
      "thresholds": {
        "steps": [
          { "value": 0, "color": "red" },
          { "value": 20, "color": "yellow" },
          { "value": 50, "color": "green" }
        ]
      }
    },
    {
      "title": "Error Budget 燃烧率",
      "type": "timeseries",
      "targets": [
        {
          "expr": "slo:error_budget_burn_rate:5m",
          "legendFormat": "5分钟燃烧率"
        },
        {
          "expr": "1",
          "legendFormat": "基准线 (1x)"
        }
      ]
    },
    {
      "title": "延迟分位值",
      "type": "timeseries",
      "targets": [
        {
          "expr": "sli:latency:p50",
          "legendFormat": "P50"
        },
        {
          "expr": "sli:latency:p95",
          "legendFormat": "P95"
        },
        {
          "expr": "sli:latency:p99",
          "legendFormat": "P99"
        },
        {
          "expr": "0.5",
          "legendFormat": "SLO (500ms)"
        }
      ]
    }
  ]
}
```

## 团队协作流程

### SLO 文档模板

```markdown
# SLO 文档：Laravel B2C API

## 基本信息
- 服务名称：Laravel B2C API
- 服务负责人：@backend-team
- 创建日期：2026-01-01
- 最后更新：2026-06-02

## SLI 定义

### 可用性 SLI
- 指标：`sum(rate(http_requests_total{status!~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`
- 数据源：Prometheus
- 采集频率：15s
- 排除条件：计划维护窗口、客户端 4xx 错误

### 延迟 SLI
- 指标：`histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`
- 数据源：Prometheus
- 测量范围：API 网关到应用层响应（不含网络延迟）

## SLO 目标

| SLI | 目标 | 时间窗口 | Error Budget |
|-----|------|---------|-------------|
| 可用性 | 99.9% | 滚动 30 天 | 43.8 分钟 |
| P99 延迟 | < 500ms | 滚动 30 天 | 99% 请求达标 |
| 错误率 | < 0.1% | 滚动 7 天 | 每周 10 分钟 |

## Error Budget 策略

| Budget 剩余 | 姿态 | 允许的操作 |
|-------------|------|-----------|
| > 75% | 激进 | 正常发布，可尝试激进优化 |
| 50-75% | 正常 | 正常发布，按计划改进 |
| 20-50% | 谨慎 | 增加测试覆盖，灰度发布 |
| 0-20% | 冻结 | 仅安全修复和关键 bug |
| = 0% | 紧急 | 全面冻结，紧急修复 |

## 告警配置

| 告警名 | 条件 | 严重级别 | 通知方式 |
|--------|------|---------|---------|
| Error Budget 快速燃烧 | 1h 内消耗 2% | Critical | PagerDuty + Slack |
| Error Budget 慢速燃烧 | 3d 内消耗 50% | Warning | Slack |
| P99 延迟超标 | > 500ms 持续 10m | Warning | Slack |
| Error Budget 耗尽 | 剩余 < 10% | Critical | PagerDuty + Slack + 邮件 |
```

### On-Call 响应流程

```
告警触发
    │
    ├── Critical (Error Budget 快速燃烧)
    │   ├── 5 分钟内响应
    │   ├── 查看 Grafana SLO 看板
    │   ├── 确认影响范围
    │   ├── 执行 Runbook
    │   └── 15 分钟内未恢复 → 升级
    │
    ├── Warning (Error Budget 慢速燃烧)
    │   ├── 30 分钟内响应
    │   ├── 分析趋势
    │   ├── 创建 Issue 跟踪
    │   └── 排入下个 Sprint
    │
    └── Info (SLO Review 触发)
        ├── 周会讨论
        ├── 更新 SLO 文档
        └── 调整 Error Budget 策略
```

## 常见反模式

### 反模式 1：SLO 设置过高

```
❌ 99.999% SLO（全年允许宕机 5.26 分钟）
```

这个目标意味着全年不能有任何意外停机。实际上，光是计划内的部署重启就会超出预算。结果是：团队干脆不看 SLO，因为它永远不可能达标。

```
✅ 99.9% SLO（每月允许宕机 43.8 分钟）
```

设置一个"有挑战但可达成"的目标。当团队能够持续达标时，再逐步提高。

### 反模式 2：SLI 不反映用户体验

```
❌ 测量的是服务器的 CPU 使用率
✅ 测量的是用户请求的成功率和延迟
```

CPU 使用率 90% 可能完全正常（高利用率 = 高效率）。但用户感知到的是"我的请求失败了"或者"页面加载很慢"。

### 反模式 3：没有关联 Error Budget 和决策

```
❌ Error Budget 只是一个数字，不影响任何决策
✅ Error Budget 直接驱动发布策略和资源分配
```

如果团队在 Error Budget 耗尽后仍然正常发布新功能，那 SLO 体系就毫无意义。

### 反模式 4：告警疲劳

```
❌ 每天收到 50 条告警，大部分是误报
✅ 只有真正需要人介入的问题才告警
```

SLO 告警应该基于 Error Budget 燃烧率，而不是单个指标的阈值。这样可以大幅减少噪音。

## 实战案例：KKday B2C API

### 初始状态

- 无 SLI 定义，只有基础的 uptime 监控
- 告警基于 CPU、内存等系统指标，与用户体验脱钩
- 每月 2-3 次 P1 故障，平均恢复时间 2 小时
- 团队不知道"可靠性到底好不好"

### SLO 体系建立

1. **定义 SLI**：基于 Prometheus 指标，定义了可用性、延迟、错误率三个 SLI
2. **设定 SLO**：可用性 99.95%，P99 < 300ms，错误率 < 0.05%
3. **搭建看板**：Grafana SLO Dashboard，团队每天查看
4. **配置告警**：基于 Error Budget 燃烧率的多级告警
5. **建立流程**：Error Budget 驱动的发布策略

### 效果

- P1 故障从每月 2-3 次降到每季度 0-1 次
- 平均恢复时间从 2 小时降到 30 分钟
- 团队有了共同的"可靠性语言"，技术债清理有了量化依据
- 新功能发布前会检查 Error Budget，避免在预算紧张时冒险

## 结语

SLO/SLI 体系的本质是**用数据驱动工程决策**。它不是为了"看数字"，而是为了让团队在"做新功能"和"保可靠性"之间找到平衡点。

Error Budget 是这个平衡点的量化表达。当预算充足时，大胆推进创新；当预算紧张时，优先保障稳定。这种机制比"老板说要稳定"或"产品经理说要快"都要科学得多。

对 Laravel 开发者来说，Prometheus 中间件 + Grafana 看板 + Alertmanager 告警是一套成熟且免费的工具链。投入 1-2 天搭建基础框架，就能让团队从"凭感觉运维"升级到"用数据说话"。

## 相关阅读

- [监控告警实战：Prometheus + Grafana 告警规则设计](/categories/运维/监控告警实战-Prometheus-Alertmanager-Grafana-告警规则设计/)
- [Grafana Loki 实战：轻量级日志聚合替代 ELK](/categories/运维/2026-06-02-grafana-loki-lightweight-log-aggregation-laravel/)
- [Sentry 实战：2026 年版错误追踪深度使用](/categories/运维/2026-06-02-sentry-error-tracking-performance-monitoring-session-replay-laravel/)
- [Chaos Engineering 实战：用 Chaos Mesh 进行故障注入与韧性测试](/categories/运维/Chaos-Engineering-实战/)
