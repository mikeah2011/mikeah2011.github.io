---

title: Laravel Scheduled Task 监控实战：spatie/laravel-schedule-monitor + Prometheus 指标
keywords: [Laravel Scheduled Task, spatie, laravel, schedule, monitor, Prometheus, 监控实战, 指标, PHP]
date: 2026-06-10 04:47:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Laravel
- 定时任务
- 监控
- Prometheus
- Spatie
- Grafana
description: 基于 spatie/laravel-schedule-monitor 与 Prometheus 构建 Laravel 定时任务的生产级可观测性方案，覆盖心跳监控、执行指标采集、Grafana 看板搭建与告警配置。
---



# Laravel Scheduled Task 监控实战：spatie/laravel-schedule-monitor + Prometheus 指标

## 概述

Laravel 的 `Schedule` 统一管理了所有定时任务，但在生产环境中，「任务到底有没有跑」「跑了多久」「什么时候挂了」往往是最难回答的问题。crontab 只保证调度，不保证执行——一旦某个命令卡死、OOM、或因锁机制跳过，你可能几天后才从用户投诉中得知。

本文基于 `spatie/laravel-schedule-monitor` 提供心跳机制，结合 `promphp/prometheus_client_php` 暴露自定义指标到 Prometheus，再用 Grafana 组装看板，形成完整的定时任务可观测性闭环。所有代码以 PHP/Laravel 8+ 为准，可直接复用。

## 核心概念

### 定时任务可观测性的三根支柱

| 维度 | 监控什么 | 工具 |
|------|---------|------|
| **存活检测** | 任务是否按时启动、是否在执行 | `schedule-monitor` 的心跳 + `health` 检查 |
| **执行指标** | 每次运行的时长、成功/失败、退出码 | Prometheus Counter + Histogram |
| **聚合分析** | 趋势、异常模式、SLA 达标率 | Grafana Dashboard + Alert Rules |

### spatie/laravel-schedule-monitor 做了什么

这个包的核心机制：

1. **心跳记录**：每个被监控的 task 启动时向数据库写一条 `heartbeat`，执行完成时更新状态
2. **超时检测**：结合 Laravel 的 `ensureOutputIsSentWithinSeconds` 或自定义 health check，发现卡死的任务
3. **通知集成** | 任务失败或超时自动触发 Notification（邮件/Slack/飞书）
4. **Dashboard 预览**：自带一个基础的 Web 界面查看任务状态

但它**不提供 Prometheus 指标导出**——这正是我们要补的。

## 实战代码

### Step 1：安装依赖

```bash
composer require spatie/laravel-schedule-monitor
composer require promphp/prometheus_client_php
```

运行迁移，创建 `monitored_scheduled_tasks` 和 `monitored_scheduled_task_runs` 表：

```bash
php artisan migrate
```

### Step 2：注册要监控的任务

在 `app/Console/Kernel.php` 中，对需要监控的命令调用 `evenInBackground()`：

```php
// app/Console/Kernel.php
use Illuminate\Console\Scheduling\Schedule;

protected function schedule(Schedule $schedule): void
{
    // 需要监控的任务 —— 用 evenInBackground() 确保心跳记录
    $schedule->command('report:daily-sales')
        ->dailyAt('06:00')
        ->evenInBackground()  // 必须加上，否则心跳机制不生效
        ->onOneServer()       // 多实例部署时只跑一次
        ->withoutOverlapping();

    $schedule->command('sync:inventory')
        ->everyFifteenMinutes()
        ->evenInBackground()
        ->withoutOverlapping();

    $schedule->command('queue:prune-failed')
        ->daily()
        ->evenInBackground();
}
```

### Step 3：配置心跳健康检查

```php
// config/schedule-monitor.php
return [
    'health' => [
        'tasks' => [
            'report:daily-sales' => [
                'maximum_runtime_in_seconds' => 300,  // 5 分钟超时
            ],
            'sync:inventory' => [
                'maximum_runtime_in_seconds' => 120,
            ],
        ],
        'default_maximum_runtime_in_seconds' => 600,
    ],

    'notifications' => [
        'channels' => ['mail'],
        'notifiable' => [
            'email' => 'ops@example.com',
        ],
    ],
];
```

### Step 4：自定义 Prometheus Metrics Collector

核心部分——把 schedule-monitor 的运行数据桥接到 Prometheus：

```php
<?php
// app/Services/ScheduleMetricsCollector.php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use PromPHP\Prometheus\CollectorRegistry;
use PromPHP\Prometheus\Storage\APC;
use Carbon\Carbon;

class ScheduleMetricsCollector
{
    private CollectorRegistry $registry;

    public function __construct()
    {
        // 使用 APCu 存储，生产环境可换 Redis
        $this->registry = new CollectorRegistry(new APC());
    }

    /**
     * 采集所有定时任务的 Prometheus 指标
     */
    public function collect(): void
    {
        $this->collectTaskRunCount();
        $this->collectTaskDuration();
        $this->collectTaskFailures();
        $this->collectTaskLastSuccess();
        $this->collectTaskHealthStatus();
    }

    /**
     * 任务执行次数 —— Counter
     * 标签: task_name, status (success/failed/timeout)
     */
    private function collectTaskRunCount(): void
    {
        $counter = $this->registry->registerCounter(
            'laravel_schedule_runs_total',
            'Total number of scheduled task runs',
            ['task_name', 'status']
        );

        // 从 monitored_scheduled_task_runs 取最近 24 小时数据
        $runs = DB::table('monitored_scheduled_task_runs')
            ->join('monitored_scheduled_tasks', 
                   'monitored_scheduled_tasks.id', '=', 
                   'monitored_scheduled_task_runs.monitored_scheduled_task_id')
            ->where('monitored_scheduled_task_runs.started_at', '>=', Carbon::now()->subDay())
            ->select('monitored_scheduled_tasks.command', 'monitored_scheduled_task_runs.status')
            ->get();

        $counts = $runs->groupBy('command')
            ->map(fn($group) => $group->groupBy('status'))
            ->flatten(1);

        foreach ($counts as $command => $statusGroup) {
            foreach ($statusGroup as $status => $items) {
                $counter->incBy($items->count(), [
                    $command,
                    $this->normalizeStatus($status),
                ]);
            }
        }
    }

    /**
     * 任务执行时长 —— Histogram
     * 标签: task_name
     */
    private function collectTaskDuration(): void
    {
        $histogram = $this->registry->registerHistogram(
            'laravel_schedule_duration_seconds',
            'Duration of scheduled task runs in seconds',
            ['task_name'],
            [1, 5, 10, 30, 60, 120, 300, 600, 1800]  // bucket 边界
        );

        $runs = DB::table('monitored_scheduled_task_runs')
            ->join('monitored_scheduled_tasks',
                   'monitored_scheduled_tasks.id', '=',
                   'monitored_scheduled_task_runs.monitored_scheduled_task_id')
            ->whereNotNull('monitored_scheduled_task_runs.finished_at')
            ->select(
                'monitored_scheduled_tasks.command',
                'monitored_scheduled_task_runs.started_at',
                'monitored_scheduled_task_runs.finished_at'
            )
            ->where('monitored_scheduled_task_runs.started_at', '>=', Carbon::now()->subDay())
            ->get();

        foreach ($runs as $run) {
            $duration = Carbon::parse($run->started_at)
                ->diffInSeconds(Carbon::parse($run->finished_at));

            $histogram->observe($duration, [$run->command]);
        }
    }

    /**
     * 任务失败次数 —— Counter
     * 标签: task_name, exit_code
     */
    private function collectTaskFailures(): void
    {
        $counter = $this->registry->registerCounter(
            'laravel_schedule_failures_total',
            'Total number of failed scheduled task runs',
            ['task_name', 'exit_code']
        );

        $failures = DB::table('monitored_scheduled_task_runs')
            ->join('monitored_scheduled_tasks',
                   'monitored_scheduled_tasks.id', '=',
                   'monitored_scheduled_task_runs.monitored_scheduled_task_id')
            ->where('monitored_scheduled_task_runs.status', '!=', 'success')
            ->where('monitored_scheduled_task_runs.started_at', '>=', Carbon::now()->subDay())
            ->select('monitored_scheduled_tasks.command', 'monitored_scheduled_task_runs.exit_code')
            ->get();

        foreach ($failures as $fail) {
            $counter->incBy(1, [
                $fail->command,
                (string) ($fail->exit_code ?? 'unknown'),
            ]);
        }
    }

    /**
     * 任务最近一次成功时间 —— Gauge
     * 标签: task_name
     */
    private function collectTaskLastSuccess(): void
    {
        $gauge = $this->registry->registerGauge(
            'laravel_schedule_last_success_timestamp',
            'Unix timestamp of the last successful task run',
            ['task_name']
        );

        $lastSuccesses = DB::table('monitored_scheduled_task_runs')
            ->join('monitored_scheduled_tasks',
                   'monitored_scheduled_tasks.id', '=',
                   'monitored_scheduled_task_runs.monitored_scheduled_task_id')
            ->where('monitored_scheduled_task_runs.status', 'success')
            ->select(
                'monitored_scheduled_tasks.command',
                DB::raw('MAX(monitored_scheduled_task_runs.finished_at) as last_success')
            )
            ->groupBy('monitored_scheduled_tasks.command')
            ->get();

        foreach ($lastSuccesses as $row) {
            $gauge->set(
                Carbon::parse($row->last_success)->timestamp,
                [$row->command]
            );
        }
    }

    /**
     * 任务健康状态 —— Gauge (1=healthy, 0=unhealthy)
     */
    private function collectTaskHealthStatus(): void
    {
        $gauge = $this->registry->registerGauge(
            'laravel_schedule_health_healthy',
            'Whether the scheduled task is currently healthy (1=healthy, 0=unhealthy)',
            ['task_name']
        );

        $tasks = DB::table('monitored_scheduled_tasks')
            ->select('command', 'last_run_finished_at', 'status')
            ->get();

        $config = config('schedule-monitor.health.tasks', []);
        $defaultTimeout = config('schedule-monitor.health.default_maximum_runtime_in_seconds', 600);

        foreach ($tasks as $task) {
            $timeout = $config[$task->command]['maximum_runtime_in_seconds'] ?? $defaultTimeout;
            $lastRun = $task->last_run_finished_at
                ? Carbon::parse($task->last_run_finished_at)
                : null;

            // 最近 2 倍超时时间内有成功运行 → healthy
            $healthy = $lastRun && $lastRun->diffInSeconds(Carbon::now()) < ($timeout * 2)
                ? 1
                : 0;

            $gauge->set($healthy, [$task->command]);
        }
    }

    private function normalizeStatus(?string $status): string
    {
        return match ($status) {
            'success' => 'success',
            'failed', 'timeout' => 'failed',
            default => 'unknown',
        };
    }

    /**
     * 导出 Prometheus 文本格式
     */
    public function export(): string
    {
        $this->collect();
        return $this->registry->getMetricFamilySamples()->serialize();
    }
}
```

### Step 5：暴露 `/metrics` 端点

```php
<?php
// routes/api.php
use App\Services\ScheduleMetricsCollector;

Route::get('/metrics', function () {
    $collector = new ScheduleMetricsCollector();
    $output = $collector->export();

    return response($output, 200, [
        'Content-Type' => 'text/plain; version=0.0.4',
    ]);
});
```

也可以放在 `routes/web.php` 下，或者单独注册一个 middleware 只允许内网 IP 访问：

```php
// app/Http/Middleware/AllowInternalIp.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class AllowInternalIp
{
    public function handle(Request $request, Closure $next)
    {
        $allowed = ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
        
        $clientIp = $request->ip();
        
        foreach ($allowed as $cidr) {
            if (str_contains($cidr, '/')) {
                // CIDR 匹配（简化版，生产环境用 ip2long）
                list($subnet, $mask) = explode('/', $cidr);
                if (($clientIp & $mask) === ($subnet & $mask)) {
                    return $next($request);
                }
            } elseif ($clientIp === $cidr) {
                return $next($request);
            }
        }

        abort(403, 'Metrics endpoint only accessible from internal network');
    }
}
```

### Step 6：自定义 Event Listener 实时写入 Prometheus

上面的方案是被动拉取（Pull），更实时的方式是主动在任务执行时写入：

```php
<?php
// app/Listeners/RecordScheduleMetrics.php

namespace App\Listeners;

use Spatie\ScheduleMonitor\Jobs\StoreUsageStats;
use PromPHP\Prometheus\CollectorRegistry;
use PromPHP\Prometheus\Storage\Redis;
use Illuminate\Support\Facades\Log;

class RecordScheduleMetrics
{
    private CollectorRegistry $registry;

    public function __construct()
    {
        $this->registry = new CollectorRegistry(new Redis([
            'host' => config('database.redis.metrics.host', '127.0.0.1'),
            'port' => config('database.redis.metrics.port', 6379),
            'prefix' => 'laravel_schedule_',
        ]));
    }

    /**
     * 监听 spatie schedule-monitor 的 RunEvent
     * 如果你用了事件订阅，也可以直接在 CommandFinished 事件中处理
     */
    public function handleTaskCompleted(string $taskName, bool $success, float $duration): void
    {
        $status = $success ? 'success' : 'failed';

        // Counter: 执行次数
        $this->registry->getOrRegisterCounter(
            'laravel',
            'schedule_runs_total',
            'Total scheduled task runs',
            ['task_name', 'status']
        )->incBy(1, [$taskName, $status]);

        // Histogram: 执行时长
        $this->registry->getOrRegisterHistogram(
            'laravel',
            'schedule_duration_seconds',
            'Task run duration in seconds',
            ['task_name'],
            [1, 5, 10, 30, 60, 120, 300, 600]
        )->observe($duration, [$taskName]);

        // Gauge: 最近成功时间戳
        if ($success) {
            $this->registry->getOrRegisterGauge(
                'laravel',
                'schedule_last_success_timestamp',
                'Last successful run timestamp',
                ['task_name']
            )->set(time(), [$taskName]);
        }

        Log::info('Schedule metrics recorded', [
            'task' => $taskName,
            'status' => $status,
            'duration' => $duration,
        ]);
    }
}
```

### Step 7：配置 Prometheus 抓取

`prometheus.yml` 添加 Laravel 应用的 scrape target：

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'laravel-schedule'
    scrape_interval: 30s  # 30 秒拉一次足够
    metrics_path: '/api/metrics'
    static_configs:
      - targets: ['your-laravel-app:80']
        labels:
          env: 'production'
    # 如果有内网认证
    # basic_auth:
    #   username: 'prometheus'
    #   password_file: '/etc/prometheus/password'
```

### Step 8：Grafana Dashboard 配置

在 Grafana 中导入一个自定义 Dashboard，核心 Panel：

**Panel 1: 任务执行总览（Stat）**
```promql
# 成功任务数（最近 24h）
sum(laravel_schedule_runs_total{status="success"})
```

**Panel 2: 失败任务数（Stat，带红色阈值）**
```promql
sum(laravel_schedule_runs_total{status="failed"})
# Alert threshold: > 0
```

**Panel 3: 各任务执行时长（Time Series）**
```promql
rate(laravel_schedule_duration_seconds_sum[5m]) 
/ rate(laravel_schedule_duration_seconds_count[5m])
```

**Panel 4: 健康状态总览（Table）**
```promql
laravel_schedule_health_healthy
```

**Panel 5: 距上次成功的时间（Gauge）**
```promql
time() - laravel_schedule_last_success_timestamp
# 正常: 绿色 | 超过预期周期 2 倍: 红色
```

### Step 9：配置 Alert Rules

```yaml
# prometheus/alert_rules.yml
groups:
  - name: laravel-schedule
    rules:
      # 任务连续失败
      - alert: ScheduleTaskFailing
        expr: increase(laravel_schedule_failures_total[1h]) > 2
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "定时任务 {{ $labels.task_name }} 最近 1 小时失败 {{ $value }} 次"

      # 任务健康状态异常
      - alert: ScheduleTaskUnhealthy
        expr: laravel_schedule_health_healthy == 0
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "定时任务 {{ $labels.task_name }} 已超过预期时间未完成"

      # 任务长时间未运行（超预期周期 3 倍）
      - alert: ScheduleTaskStale
        expr: (time() - laravel_schedule_last_success_timestamp) > 10800
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "定时任务 {{ $labels.task_name }} 已超过 3 小时未成功执行"
```

## 踩坑记录

### 1. `evenInBackground()` 是必选项

spatie/laravel-schedule-monitor 需要任务在后台执行才能记录心跳。如果你漏加 `evenInBackground()`，心跳表里永远没有记录，监控形同虚设。这是文档中最容易忽略的一点。

### 2. Redis vs APCu 做 Prometheus Storage

`promphp/prometheus_client_php` 支持多种存储后端：

- **APCu**：单实例足够，零运维成本，但多实例部署时指标不共享
- **Redis**：推荐生产环境，支持多实例聚合，指标精确

```php
// 单实例用 APCu（简单）
new \PromPHP\Prometheus\Storage\APC();

// 多实例用 Redis
new \PromPHP\Prometheus\Storage\Redis([
    'host' => '127.0.0.1',
    'port' => 6379,
    'prefix' => 'laravel_metrics_',
]);
```

### 3. Histogram Bucket 的选择

定时任务的时长分布通常是长尾的：大多数任务几秒完成，偶尔有几分钟的。Bucket 设置建议：

```php
[1, 5, 10, 30, 60, 120, 300, 600, 1800]  // 覆盖 1 秒到 30 分钟
```

太精细会浪费存储，太粗糙会丢失分布细节。实际运行一周后根据 `rate()` 曲线调整。

### 4. 多实例部署的锁机制

`withoutOverlapping()` 依赖数据库锁，多实例部署时需要确保：

1. 所有实例连接同一个数据库
2. `onOneServer()` 用了 Redis 或数据库锁
3. Prometheus 指标必须通过 Redis 共享（不能用 APCu）

### 5. 安全性

`/metrics` 端点暴露了任务名称和执行模式，不应暴露给公网。生产环境务必：

1. 只监听内网 IP
2. 添加 Basic Auth 或 IP 白名单
3. 考虑用 `/metrics/internal` 路径区分

### 6. 数据保留策略

`monitored_scheduled_task_runs` 表会持续增长，需要定期清理：

```php
// app/Console/Commands/CleanupScheduleMonitor.php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CleanupScheduleMonitor extends Command
{
    protected $signature = 'schedule-monitor:cleanup {--days=30 : Keep runs for N days}';

    public function handle(): int
    {
        $days = (int) $this->option('days');
        $deleted = DB::table('monitored_scheduled_task_runs')
            ->where('started_at', '<', now()->subDays($days))
            ->delete();

        $this->info("Cleaned up {$deleted} old schedule monitor records (older than {$days} days)");
        return Command::SUCCESS;
    }
}
```

注册到 Schedule：

```php
$schedule->command('schedule-monitor:cleanup --days=30')
    ->daily()
    ->at('03:00');
```

## 总结

| 组件 | 职责 | 选择 |
|------|------|------|
| 心跳 + 超时检测 | 任务存活监控 | `spatie/laravel-schedule-monitor` |
| 指标采集 | 执行次数、时长、失败率 | `promphp/prometheus_client_php` |
| 指标存储 | 多实例聚合 | Redis |
| 可视化 | Dashboard + 趋势 | Grafana |
| 告警 | 异常即时通知 | Prometheus AlertManager |

完整的可观测性闭环不是装一个包就完事的，而是「心跳检测 → 指标采集 → 持久化 → 可视化 → 告警 → 响应」六个环节缺一不可。

`spatie/laravel-schedule-monitor` 解决了前两个，Prometheus + Grafana 补齐后三个。剩下那个「响应」，就看你团队的 on-call 流程了。

在你的项目里，先把最核心的 3-5 个任务加上监控，跑一周看效果，再逐步覆盖全量任务。不要一上来就监控所有定时任务——你会发现大部分任务你根本不知道它是什么、该不该告警，先把「哪些任务值得监控」搞清楚，比装监控工具本身更重要。
