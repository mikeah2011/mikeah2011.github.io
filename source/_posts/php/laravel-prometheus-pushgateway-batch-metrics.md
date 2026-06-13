---
title: Laravel + Prometheus Pushgateway 实战：批处理任务的指标上报——替代 Pull 模式的定时任务监控方案
keywords: [Laravel, Prometheus Pushgateway, Pull, 批处理任务的指标上报, 替代, 模式的定时任务监控方案, PHP]
date: 2026-06-09 13:31:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Prometheus
  - Pushgateway
  - 批处理
  - 可观测性
  - 监控
description: 深入讲解如何在 Laravel 项目中使用 Prometheus Pushgateway 为批处理任务（队列 Job、定时任务、长运行脚本）采集指标，覆盖 Push vs Pull 模型对比、Pushgateway 架构、Laravel 集成代码、指标设计模式与生产踩坑记录。
---


## 为什么 Pull 模式搞不定批处理任务

Prometheus 的标准工作流是 Pull 模型：Prometheus Server 定期从应用的 `/metrics` 端点拉取指标。这对长驻进程（Nginx、Laravel Octane、Go 微服务）非常合适——进程一直活着，Prometheus 随时来拉。

但批处理任务完全是另一回事：

- **队列 Worker**：Laravel Queue 里的 Job 执行完就销毁，进程不存在了，Prometheus 拉不到任何东西
- **定时任务**：`php artisan schedule:run` 跑完 30 秒就退出，Pull 窗口极短
- **异步脚本**：`dispatch()` 出去的任务在独立进程执行，生命周期不可预测

你不可能让 Prometheus 精确卡在任务执行期间去拉 `/metrics`。**Push 模型**才是正解：应用主动把指标推送到一个常驻的中间服务，Prometheus 再从这个中间服务拉。

Pushgateway 就是 Prometheus 官方提供的这个中间服务。

## Pushgateway 架构与工作流

```
┌─────────────────────┐
│  Laravel Queue Job  │──── push metrics ────┐
└─────────────────────┘                       │
┌─────────────────────┐                       ▼
│  Scheduled Task     │──── push metrics ────▶ Pushgateway (常驻)
└─────────────────────┘                       │
┌─────────────────────┐                       │
│  Async Script       │──── push metrics ────┘
└─────────────────────┘                               │
                                                      │ pull /metrics
                                                      ▼
                                            ┌─────────────────┐
                                            │    Prometheus    │
                                            │     Server       │
                                            └─────────────────┘
```

**核心概念：**

- **Job 标签**：每个 metric 必须带 `job` 标签，Pushgateway 用它分组管理
- **Instance 标签**：可选，标识来源实例（机器名、容器 ID 等）
- **Grouping Key**：Pushgateway 支持按 `(job, instance)` 等键值分组，相同 group 的 push 会覆盖旧值
- **删除 API**：任务完成后可以主动删除 Pushgateway 中的指标，避免残留

## Laravel 集成方案

### 1. 安装依赖

```bash
composer require promphp/prometheus_client_php
```

这个库是 Prometheus 官方 PHP 客户端，支持内存存储（用于 Push 模式）和 Redis 存储。

### 2. 配置连接

在 `config/prometheus.php`（需要手动创建）：

```php
<?php

return [
    // Pushgateway 地址
    'pushgateway_url' => env('PROMETHEUS_PUSHGATEWAY_URL', 'http://localhost:9091'),

    // 默认 job 名
    'job_name' => env('PROMETHEUS_JOB_NAME', 'laravel-app'),

    // Push 超时（秒）
    'push_timeout' => env('PROMETHEUS_PUSH_TIMEOUT', 5),

    // 是否在 artisan 命令中自动推送
    'auto_push' => env('PROMETHEUS_AUTO_PUSH', false),
];
```

### 3. Metrics 服务类

```php
<?php

namespace App\Services;

use Prometheus\CollectorRegistry;
use Prometheus\Storage\APNTC;
use Prometheus\RenderTextFormat;
use GuzzleHttp\Client;

class PrometheusMetricsService
{
    private CollectorRegistry $registry;
    private Client $httpClient;
    private string $pushgatewayUrl;
    private string $jobName;

    public function __construct()
    {
        // 使用内存存储（Push 模式的正确选择）
        $this->registry = new CollectorRegistry(new APNTC());
        $this->httpClient = new Client([
            'timeout' => config('prometheus.push_timeout', 5),
            'connect_timeout' => 3,
        ]);
        $this->pushgatewayUrl = config('prometheus.pushgateway_url');
        $this->jobName = config('prometheus.job_name');
    }

    /**
     * 记录批处理任务的执行次数
     */
    public function recordJobRun(string $jobClass, string $status): void
    {
        $counter = $this->registry->registerCounter(
            'laravel_queue',
            'job_runs_total',
            'Total number of queue jobs executed',
            ['job_class', 'status']
        );
        $counter->inc([$jobClass, $status]);
    }

    /**
     * 记录任务执行耗时（直方图）
     */
    public function recordJobDuration(string $jobClass, float $seconds): void
    {
        $histogram = $this->registry->registerHistogram(
            'laravel_queue',
            'job_duration_seconds',
            'Queue job execution duration in seconds',
            ['job_class'],
            [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]
        );
        $histogram->observe($seconds, [$jobClass]);
    }

    /**
     * 记录批处理处理的记录数
     */
    public function recordBatchSize(string $taskName, int $count): void
    {
        $gauge = $this->registry->registerGauge(
            'laravel_batch',
            'records_processed',
            'Number of records processed in batch',
            ['task_name']
        );
        $gauge->set($count, [$taskName]);
    }

    /**
     * 记录定时任务状态
     */
    public function recordScheduledTask(string $taskName, string $status, float $duration): void
    {
        $this->recordJobRun("scheduled:{$taskName}", $status);
        $this->recordJobDuration("scheduled:{$taskName}", $duration);
    }

    /**
     * 推送所有指标到 Pushgateway
     */
    public function push(?string $instance = null): bool
    {
        $metrics = $this->getMetrics();

        $url = rtrim($this->pushgatewayUrl, '/') . '/metrics/job/' . $this->jobName;
        if ($instance) {
            $url .= '/instance/' . $instance;
        }

        try {
            $response = $this->httpClient->put($url, [
                'body' => $metrics,
                'headers' => [
                    'Content-Type' => 'text/plain; version=0.0.4',
                ],
            ]);

            return $response->getStatusCode() === 200;
        } catch (\Exception $e) {
            \Log::error('Prometheus push failed', [
                'url' => $url,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * 删除 Pushgateway 中本 job 的指标
     */
    public function delete(?string $instance = null): bool
    {
        $url = rtrim($this->pushgatewayUrl, '') . '/metrics/job/' . $this->jobName;
        if ($instance) {
            $url .= '/instance/' . $instance;
        }

        try {
            $response = $this->httpClient->delete($url);
            return $response->getStatusCode() === 204;
        } catch (\Exception $e) {
            \Log::warning('Prometheus delete failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * 渲染 Prometheus 文本格式
     */
    private function getMetrics(): string
    {
        $renderer = new RenderTextFormat();
        return $renderer->render($this->registry->getMetricFamilySamples());
    }
}
```

### 4. 在 Queue Job 中集成

```php
<?php

namespace App\Jobs;

use App\Services\PrometheusMetricsService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SyncUserOrdersJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 300; // 5 分钟超时

    public function handle(PrometheusMetricsService $metrics): void
    {
        $startTime = microtime(true);

        try {
            // 业务逻辑：同步用户订单数据
            $users = User::where('needs_sync', true)->get();
            $syncedCount = 0;

            foreach ($users->chunk(100) as $chunk) {
                foreach ($chunk as $user) {
                    $this->syncUserOrders($user);
                    $syncedCount++;
                }
            }

            // 记录指标
            $metrics->recordJobRun('SyncUserOrdersJob', 'success');
            $metrics->recordJobDuration('SyncUserOrdersJob', microtime(true) - $startTime);
            $metrics->recordBatchSize('sync_user_orders', $syncedCount);

            // 推送到 Pushgateway
            $metrics->push();

        } catch (\Exception $e) {
            $metrics->recordJobRun('SyncUserOrdersJob', 'failure');
            $metrics->recordJobDuration('SyncUserOrdersJob', microtime(true) - $startTime);
            $metrics->push();

            throw $e;
        }
    }

    private function syncUserOrders(User $user): void
    {
        $orders = $this->fetchExternalOrders($user->external_id);
        foreach ($orders as $order) {
            Order::updateOrCreate(
                ['external_id' => $order['id']],
                ['user_id' => $user->id, 'data' => $order]
            );
        }
    }

    private function fetchExternalOrders(string $externalId): array
    {
        return [];
    }
}
```

### 5. 在定时任务中集成

```php
<?php

// app/Console/Kernel.php

use App\Services\PrometheusMetricsService;

protected function schedule(Schedule $schedule): void
{
    // 每小时清理过期缓存
    $schedule->command('cache:clear-expired')
        ->hourly()
        ->after(function () {
            $metrics = app(PrometheusMetricsService::class);
            $metrics->recordScheduledTask('cache:clear-expired', 'success', 0);
            $metrics->push(gethostname());
        });

    // 每日同步产品数据
    $schedule->command('products:sync')
        ->dailyAt('03:00')
        ->onOneServer()
        ->after(function (string $output, int $exitCode) {
            $metrics = app(PrometheusMetricsService::class);
            $status = $exitCode === 0 ? 'success' : 'failure';
            $metrics->recordScheduledTask('products:sync', $status, 0);
            $metrics->push(gethostname());
        });
}
```

更优雅的方式是写一个 Artisan 命令来包装：

```php
<?php

namespace App\Console\Commands;

use App\Services\PrometheusMetricsService;
use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class MonitoredCommand extends Command
{
    protected $signature = 'monitored {command} {--job-name=}';
    protected $description = 'Run an Artisan command with Prometheus metrics';

    public function handle(PrometheusMetricsService $metrics): int
    {
        $command = $this->argument('command');
        $jobName = $this->option('job-name') ?: $command;
        $startTime = microtime(true);

        $process = new Process(['php', 'artisan', $command]);
        $process->run();

        $status = $process->isSuccessful() ? 'success' : 'failure';
        $duration = microtime(true) - $startTime;

        $metrics->recordJobRun("artisan:{$jobName}", $status);
        $metrics->recordJobDuration("artisan:{$jobName}", $duration);
        $metrics->push(gethostname());

        if (!$process->isSuccessful()) {
            $this->error("Command failed: {$process->getErrorOutput()}");
            return 1;
        }

        $this->info("Command completed in {$duration}s");
        return 0;
    }
}
```

### 6. 中间件方式自动采集（可选）

如果你想对所有 HTTP 请求也采集指标，可以加一个中间件：

```php
<?php

namespace App\Http\Middleware;

use App\Services\PrometheusMetricsService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class PrometheusMetricsMiddleware
{
    public function __construct(
        private PrometheusMetricsService $metrics
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $startTime = microtime(true);
        $response = $next($request);
        $duration = microtime(true) - $startTime;

        $route = $request->route();
        $method = $request->method();
        $uri = $route ? $route->getName() ?: $request->path() : $request->path();
        $status = $response->getStatusCode();

        // HTTP 请求计数
        $counter = $this->metrics->getRegistry()->registerCounter(
            'laravel_http',
            'requests_total',
            'Total HTTP requests',
            ['method', 'uri', 'status']
        );
        $counter->inc([$method, $uri, (string) $status]);

        // HTTP 请求耗时
        $histogram = $this->metrics->getRegistry()->registerHistogram(
            'laravel_http',
            'request_duration_seconds',
            'HTTP request duration',
            ['method', 'uri'],
            [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
        );
        $histogram->observe($duration, [$method, $uri]);

        // 仅在 Queue Worker 中自动推送（HTTP 请求由 Prometheus Pull）
        if (app()->runningInConsole() && !app()->runningArtisan()) {
            $this->metrics->push(gethostname());
        }

        return $response;
    }
}
```

## PromQL 查询示例

部署完成后，你可以在 Grafana 中用这些 PromQL 查询：

```promql
# 队列 Job 成功率（5 分钟窗口）
rate(laravel_queue_job_runs_total{status="success"}[5m])
/
rate(laravel_queue_job_runs_total[5m])

# 按 Job 类名统计平均执行时间
histogram_quantile(0.95,
  rate(laravel_queue_job_duration_seconds_bucket[5m])
) by (job_class)

# 批处理任务处理的记录总数
sum(laravel_batch_records_processed) by (task_name)

# 定时任务最近一次失败
changes(laravel_queue_job_runs_total{status="failure"}[1h]) > 0

# 队列 Job 延迟 P99
histogram_quantile(0.99,
  rate(laravel_queue_job_duration_seconds_bucket[15m])
) by (job_class)
```

## 高级模式：按任务粒度分组

Pushgateway 的 Grouping Key 允许你按 `(job, instance)` 分组管理指标。对于批处理任务，更实用的模式是用自定义 grouping：

```php
// 按任务类型分组
$url = '/metrics/job/laravel-batch/instance/' . gethostname() . '/task/' . $taskName;

// Push 带 grouping key
$this->httpClient->put($url, [
    'body' => $metrics,
]);

// 只删除特定任务的指标
$this->httpClient->delete($url);
```

### 任务完成后的清理

批处理任务执行完后，主动删除 Pushgateway 中的指标可以避免残留的过期数据：

```php
public function handle(PrometheusMetricsService $metrics): void
{
    $startTime = microtime(true);

    try {
        $this->processData();
        $metrics->recordJobRun($this->getJobName(), 'success');
        $metrics->recordJobDuration($this->getJobName(), microtime(true) - $startTime);
        $metrics->push(gethostname());
    } catch (\Exception $e) {
        $metrics->recordJobRun($this->getJobName(), 'failure');
        $metrics->push(gethostname());
        throw $e;
    } finally {
        // 一次性任务：推完就删
        if ($this->isOneTime) {
            $metrics->delete(gethostname());
        }
    }
}
```

## Prometheus 配置

在 `prometheus.yml` 中添加 Pushgateway 作为数据源：

```yaml
scrape_configs:
  # Pull 模式：HTTP 服务
  - job_name: 'laravel-http'
    static_configs:
      - targets: ['app:9100']

  # Push 模式：批处理任务
  - job_name: 'pushgateway'
    honor_labels: true  # 关键！保留 push 时的 job/instance 标签
    static_configs:
      - targets: ['pushgateway:9091']
```

⚠️ **`honor_labels: true` 必须设置**。否则 Prometheus 会把 `job="pushgateway"` 覆盖掉你在 push 时设置的 `job="laravel-batch"`，导致所有批处理指标混在一起无法区分。

## 踩坑记录

### 坑 1：内存存储 vs Redis 存储

Prometheus PHP 客户端有两种存储：

- **APNTC（内存）**：Push 模式用这个。每次 push 都是完整的指标快照
- **Redis**：Pull 模式用这个。需要配合 `/metrics` 端点让 Prometheus 来拉

```php
// ✅ Push 模式：用内存存储
$this->registry = new CollectorRegistry(new APNTC());

// ❌ Push 模式不要用 Redis，会导致指标累积不正确
$this->registry = new CollectorRegistry(new Redis(
    new \Predis\Client(),
    'prometheus_'
));
```

### 坑 2：honor_labels 忘记设置

现象：所有批处理指标的 `job` 标签都变成了 `pushgateway`，你的自定义 job 名消失了。

原因：Prometheus 默认行为是用 scrape target 的 `job` 标签覆盖 metric 中的 `job` 标签。

解决：`honor_labels: true`，没有商量余地。

### 坑 3：Push 失败导致数据丢失

Pushgateway 不是持久化存储。如果 Pushgateway 重启，所有未被 Prometheus 拉走的指标都会丢失。

应对策略：
- 短期指标（任务执行次数）：丢失可接受，下次 push 会补上
- 长期指标（累计计数）：考虑用 Redis 持久化 Counter，定时全量 push
- 关键指标：用 Alertmanager 配置 Pushgateway 不可用告警

```yaml
# alertmanager.yml
groups:
  - name: pushgateway
    rules:
      - alert: PushgatewayDown
        expr: up{job="pushgateway"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Pushgateway is down, batch metrics may be lost"
```

### 坑 4：高并发 Push 的指标覆盖

两个 Queue Worker 同时 push 相同 `(job, instance)` 的指标，后推的会覆盖先推的。

这不是 bug，是设计——Pushgateway 是 stateless 的 push 代理，不是 metrics accumulator。

解决方案：

```php
// 方案 1：用 instance 标签区分 Worker
$workerId = 'worker-' . getmypid();
$metrics->push($workerId);

// 方案 2：用 grouping key 按任务区分
$url = "/metrics/job/laravel-batch/task/{$taskName}/pid/" . getmypid();
```

### 坑 5：直方图 Bucket 需要预定义

Histogram 的 bucket 在注册时就确定了，运行时无法动态调整。

```php
// ✅ 提前规划好 bucket 范围
$histogram = $registry->registerHistogram(
    'laravel_queue',
    'job_duration_seconds',
    'Job execution duration',
    ['job_class'],
    [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]
);

// ❌ 不要只用默认 bucket（0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10）
//    默认值太细，对批处理任务（通常几秒到几分钟）没意义
```

## Docker Compose 部署

```yaml
# docker-compose.monitoring.yml
version: '3.8'

services:
  pushgateway:
    image: prom/pushgateway:latest
    ports:
      - "9091:9091"
    restart: unless-stopped
    command:
      - '--web.enable-lifecycle'

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=90d'
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana
    restart: unless-stopped

volumes:
  prometheus-data:
  grafana-data:
```

## 总结

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| HTTP API | Pull（/metrics） | 长驻进程，Prometheus 随时拉 |
| Queue Job | Push（Pushgateway） | 进程短命，Pull 窗口太短 |
| 定时任务 | Push（Pushgateway） | 执行完就退出，Pull 精度不够 |
| CLI 脚本 | Push（Pushgateway） | 同上 |
| 长运行 Worker | Pull（/metrics） | 进程常驻，可以暴露端口 |

核心原则：**进程活着用 Pull，进程会死用 Push**。Pushgateway 就是给那些活不够久的进程准备的"指标暂存柜"。

对于 Laravel 项目，推荐的做法是：HTTP 层走 Pull（Octane 常驻），所有队列任务和定时任务走 Push。这样既有实时性，又有覆盖率。

最后提醒：Pushgateway 不是万能的。它是 push 代理，不是 metrics 数据库。Prometheus 才是存储层，Pushgateway 只是个中转站。不要在 Pushgateway 里堆积指标——推完就拉走，拉完就清理。
