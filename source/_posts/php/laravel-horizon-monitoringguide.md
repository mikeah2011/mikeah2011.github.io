---
title: Laravel-Horizon-队列监控与生产环境运维实战-多队列优先级-指标采集与自动恢复踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 23:16:04
description: "深入讲解 Laravel Horizon 队列监控的生产环境实战经验，涵盖 Redis 驱动的多队列优先级设计与任务调度策略、Prometheus 指标采集与 Grafana 告警集成、Worker 假死检测与自动恢复、K8s 部署冲突排查，帮助你在高并发场景下实现 Queue 性能优化与稳定运维。"
updated: 2026-05-04 23:17:57
tags: [Laravel, Redis, 消息队列, 监控]
keywords: [Laravel, Horizon, 队列监控与生产环境运维实战, 多队列优先级, 指标采集与自动恢复踩坑记录, 技术杂谈, PHP]
categories:
  - misc
  - php



---

## 前言

Laravel Queue 的异步能力我们早已在多个项目中用得飞起，但当队列规模从"几百个 Job/小时"增长到"几万/分钟"时，仅靠 `php artisan queue:work` 的日志输出远远不够。你需要的是**队列全景监控面板**——哪个队列积压了？哪个 Job 反复失败？Worker 内存是否在泄漏？Redis 连接是否健康？

**Laravel Horizon** 正是为此而生。它提供了基于 Redis 驱动的队列仪表盘、自动负载均衡的 Supervisor 配置、以及实时指标。但在生产环境中落地 Horizon，我们踩了大量坑：配置表象与实际行为不一致、多优先级队列的权重写错导致饿死、Worker 假死监控盲区、与 K8s 部署的冲突……

本文记录 Horizon 在一个日均 500 万+ Job 的 Laravel API 项目中的真实运维经验。

<!-- more -->

---

## 一、Horizon 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Laravel Application                    │
│                                                           │
│  dispatch(new ProcessOrder($data))                       │
│       │                                                   │
│       ▼                                                   │
│  Queue::connection('redis') ──► Redis (Queue Driver)     │
│                                     │                     │
│                         ┌───────────┼───────────┐        │
│                         ▼           ▼           ▼        │
│                    ┌────────┐  ┌────────┐  ┌────────┐    │
│                    │ default │  │ high   │  │ low    │    │
│                    │ queue   │  │ queue  │  │ queue  │    │
│                    └───┬────┘  └───┬────┘  └───┬────┘    │
│                        │           │           │          │
│                        ▼           ▼           ▼          │
│              ┌──────────────────────────────────┐        │
│              │    Horizon Supervisor             │        │
│              │    (Balancer → auto-scaling)      │        │
│              │                                    │        │
│              │  Process: queue:work --queue=high  │        │
│              │  Process: queue:work --queue=default│       │
│              │  Process: queue:work --queue=low   │        │
│              └──────────────────────────────────┘        │
│                        │                                   │
│                        ▼                                   │
│              ┌──────────────────┐                         │
│              │  Horizon Dashboard│                         │
│              │  /horizon (Web)   │                         │
│              │  Metrics/Monitor  │                         │
│              └──────────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

---

## 二、基础配置与第一个坑

### 2.1 安装

```bash
composer require laravel/horizon
php artisan horizon:install
php artisan vendor:publish --tag=horizon-config
```

### 2.2 `config/horizon.php` 配置

```php
<?php

return [
    'environments' => [
        'production' => [
            'supervisor-1' => [
                'maxProcesses' => 10,
                'maxTime' => 3600,
                'maxJobs' => 1000,
                'memory' => 128,
                'tries' => 3,
                'timeout' => 90,
                'nice' => 0,
                // ⚠️ 坑1：balanceMaxShift 和 balanceCooldown 未设置
                // 导致自动扩缩抖动严重
                'balanceMaxShift' => 1,
                'balanceCooldown' => 3,
            ],
        ],

        'local' => [
            'supervisor-1' => [
                'maxProcesses' => 3,
                'queue' => ['default'],
            ],
        ],
    ],
];
```

**⚠️ 踩坑记录 1：balanceMaxShift 与 balanceCooldown 的默认值陷阱**

Horizon 的 Auto-Balance 特性默认每 3 秒检查队列长度，自动调整各队列的 Worker 数量。但默认的 `balanceMaxShift` 为 `1`（每次最多增减 1 个进程），`balanceCooldown` 为 `3`（秒）。在队列突发积压时，这导致扩缩速度极慢——积压 1 万个 Job，每 3 秒才加 1 个 Worker。

**解决方案**：生产环境适当放大：

```php
'supervisor-1' => [
    'maxProcesses' => 15,
    'balanceMaxShift' => 3,    // 每次最多调整 3 个进程
    'balanceCooldown' => 2,    // 缩短冷却周期
],
```

但注意：`balanceMaxShift` 过大（如 `5`）会导致进程频繁启停，反而降低吞吐量。我们在生产环境中最终选择了 `balanceMaxShift=2, balanceCooldown=3`。

---

## 三、多队列优先级设计——防止饿死

### 3.1 场景

我们的队列分为三级：

| 队列 | 优先级 | 典型 Job |
|------|--------|----------|
| `critical` | 最高 | 支付回调、订单状态变更 |
| `default` | 中 | 邮件通知、库存同步 |
| `low` | 最低 | 报表生成、数据导出 |

### 3.2 Supervisor 配置

```php
// config/horizon.php
'supervisor-1' => [
    'connection' => 'redis',
    'queue' => ['critical', 'default', 'low'],
    'balance' => 'auto',      // ⚠️ 必须开启 auto 平衡
    'maxProcesses' => 15,
    'maxTime' => 3600,
    'maxJobs' => 1000,
    'memory' => 256,
    'tries' => 3,
    'timeout' => 120,
    'balanceMaxShift' => 2,
    'balanceCooldown' => 3,
],
```

### 3.3 ⚠️ 踩坑记录 2：队列顺序写反导致 critical 饿死

**错误写法**：

```php
'queue' => ['low', 'default', 'critical'], // ❌ 顺序写反
```

Redis 的 `BRPOP` 命令从左到右优先检查。如果写成 `['low', 'default', 'critical']`，Worker 会优先消费 `low` 队列，`critical` 被饿死！

**正确写法**：

```php
'queue' => ['critical', 'default', 'low'], // ✅ 高优先级在前
```

**但还有更隐蔽的坑**：当 `balance => 'auto'` 开启时，Horizon 会根据队列长度自动分配进程数。如果 `low` 队列积压大量导出任务，Horizon 会把更多 Worker 分配给 `low`，导致 `critical` 的 Worker 被"抢走"。

**最终方案**：为关键队列创建独立的 Supervisor：

```php
'production' => [
    'critical-supervisor' => [
        'connection' => 'redis',
        'queue' => ['critical'],
        'balance' => false,         // 不自动平衡，固定进程数
        'maxProcesses' => 5,
        'maxTime' => 3600,
        'tries' => 3,
        'timeout' => 60,
    ],
    'default-supervisor' => [
        'connection' => 'redis',
        'queue' => ['default', 'low'],
        'balance' => 'auto',
        'maxProcesses' => 10,
        'maxTime' => 3600,
        'tries' => 3,
        'timeout' => 120,
        'balanceMaxShift' => 2,
        'balanceCooldown' => 3,
    ],
],
```

---

## 四、Horizon 指标采集与 Prometheus 集成

### 4.1 Horizon 内置指标

Horizon Dashboard (`/horizon`) 展示了：
- 每分钟 Job 吞吐量
- Job 运行时间分布（p50/p99）
- 队列等待时间
- 失败 Job 数量

但这些指标只能在 Horizon 界面查看，无法集成到 Grafana/Prometheus 监控体系。

### 4.2 自定义 Prometheus Collector

```php
<?php
// app/Metrics/HorizonMetricsCollector.php

namespace App\Metrics;

use Illuminate\Support\Facades\Redis;
use Prometheus\CollectorRegistry;
use Laravel\Horizon\Contracts\MetricsRepository;

class HorizonMetricsCollector
{
    public function __construct(
        private CollectorRegistry $registry,
        private MetricsRepository $horizonMetrics
    ) {}

    public function collect(): void
    {
        // 1. 队列长度（实时，从 Redis 读取）
        $queues = ['critical', 'default', 'low'];
        foreach ($queues as $queue) {
            $length = Redis::llen("queues:{$queue}");
            $this->registry
                ->getOrRegisterGauge('horizon', 'queue_length', 'Queue length', ['queue'])
                ->set($length, [$queue]);
        }

        // 2. 失败 Job 数量
        $failures = Redis::llen('failed_jobs') ?: 0;
        $this->registry
            ->getOrRegisterGauge('horizon', 'failed_jobs_total', 'Total failed jobs')
            ->set($failures);

        // 3. Worker 进程数
        $supervisors = app(\Laravel\Horizon\Contracts\SupervisorRepository::class)->all();
        $totalProcesses = 0;
        foreach ($supervisors as $supervisor) {
            $totalProcesses += $supervisor->totalProcessCount ?? 0;
        }
        $this->registry
            ->getOrRegisterGauge('horizon', 'worker_processes', 'Active worker processes')
            ->set($totalProcesses);
    }
}
```

### 4.3 注册定时采集

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    $schedule->call(function () {
        app(HorizonMetricsCollector::class)->collect();
    })->everyFifteenSeconds();
}
```

### 4.4 Grafana 告警规则

```yaml
# prometheus-rules.yml
groups:
  - name: horizon-alerts
    rules:
      - alert: QueueBacklog
        expr: horizon_queue_length > 5000
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "队列 {{ $labels.queue }} 积压超过 5000"

      - alert: HighFailureRate
        expr: rate(horizon_failed_jobs_total[5m]) > 10
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Job 失败率突增，最近 5 分钟平均 > 10/s"

      - alert: WorkerDown
        expr: horizon_worker_processes < 2
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Worker 进程不足，当前仅 {{ $value }} 个"
```

---

## 五、Worker 假死检测与自动恢复

### 5.1 问题

Worker 进程在长时间运行后可能"假死"——进程存在但不消费 Job。常见原因：

1. 内存泄漏导致 `memory` 限制触发后进程卡住
2. Redis 连接超时但进程未退出
3. 外部 API 调用（如支付回调）卡住

### 5.2 Horizon 内置机制

```php
// config/horizon.php
'supervisor-1' => [
    'maxProcesses' => 10,
    'maxTime' => 3600,      // 进程最多运行 3600 秒后自动重启
    'maxJobs' => 1000,       // 每个进程最多处理 1000 个 Job 后重启
    'memory' => 128,         // 内存超过 128MB 自动重启
    'timeout' => 90,         // 单个 Job 最多执行 90 秒
],
```

### 5.3 ⚠️ 踩坑记录 3：maxTime 与 K8s liveness probe 冲突

在 Kubernetes 环境中，我们配置了 liveness probe：

```yaml
livenessProbe:
  exec:
    command: ["php", "artisan", "horizon:status"]
  initialDelaySeconds: 30
  periodSeconds: 60
```

问题是 `horizon:status` 只检查 Supervisor 进程是否存活，不检查 Worker 是否真的在消费。当 Worker 假死时，Supervisor 进程仍在运行，liveness probe 一直返回成功。

**解决方案**：自定义健康检查：

```php
<?php
// app/Console/Commands/HorizonHealthCheck.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;

class HorizonHealthCheck extends Command
{
    protected $signature = 'horizon:health';

    public function handle(): int
    {
        // 检查1：队列是否有积压且没有在减少
        $queueLength = Redis::llen('queues:default');
        if ($queueLength > 10000) {
            // 检查最近 3 分钟队列长度变化
            $cached = cache('horizon:last_queue_length', null);
            if ($cached !== null && $queueLength >= $cached) {
                $this->error("队列持续积压: {$queueLength}");
                return 1; // 非零退出码触发 K8s 重启
            }
            cache(['horizon:last_queue_length' => $queueLength], now()->addMinutes(3));
        }

        // 检查2：最近 5 分钟是否有 Job 被处理
        $recentJobs = Redis::get('horizon:recent_job_count') ?? 0;
        if ($recentJobs == 0 && $queueLength > 0) {
            $this->error("队列有积压但 5 分钟内无 Job 被处理");
            return 1;
        }

        return 0;
    }
}
```

更新 K8s probe：

```yaml
livenessProbe:
  exec:
    command: ["php", "artisan", "horizon:health"]
  initialDelaySeconds: 60
  periodSeconds: 30
  failureThreshold: 3
```

---

## 六、Horizon 与部署流水线集成

### 6.1 部署脚本

```bash
#!/bin/bash
# deploy.sh

echo "🚀 Starting deployment..."

# 1. 拉取代码
git pull origin main

# 2. 安装依赖
composer install --no-dev --optimize-autoloader

# 3. 数据库迁移
php artisan migrate --force

# 4. 优雅重启 Horizon（不丢失正在执行的 Job）
php artisan horizon:terminate

# ⚠️ 坑4：horizon:terminate 后需要等待 Supervisor 自动拉起
# 但在 K8s 中，如果 terminate 导致进程退出，Pod 会被判定为 NotReady
# 解决：在 pre-stop hook 中执行 terminate，给足够的 terminationGracePeriodSeconds
```

### 6.2 K8s 部署配置

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: horizon-worker
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
  template:
    spec:
      terminationGracePeriodSeconds: 120  # 给 Horizon 足够时间优雅退出
      containers:
        - name: horizon
          image: your-registry/laravel-app:latest
          command: ["php", "artisan", "horizon"]
          lifecycle:
            preStop:
              exec:
                command: ["php", "artisan", "horizon:terminate"]
```

### 6.3 ⚠️ 踩坑记录 4：多 Pod 同时运行 Horizon 的竞争问题

Horizon 的 Supervisor 模式假定**单进程管理所有 Worker**。当 K8s Rolling Update 时，新旧 Pod 同时运行 `php artisan horizon`，导致：

- 两个 Supervisor 同时管理 Worker，进程数翻倍
- Redis 连接数暴增
- Job 可能被重复消费

**解决方案**：

```yaml
spec:
  replicas: 1  # Horizon 只部署 1 个 Pod！
  strategy:
    type: Recreate  # 先删后建，避免并行
```

如果需要多 Worker 分布在多台机器，应使用 Horizon 的 `Supervisor` 配置中 `maxProcesses` 加大，而非多副本。或者改用原生 `queue:work` + K8s Deployment 多副本（放弃 Horizon Dashboard 的进程管理能力，只保留指标采集）。

---

## 七、Job 失败的自动恢复策略

### 7.1 重试策略

```php
<?php
// app/Jobs/ProcessPaymentCallback.php

class ProcessPaymentCallback implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $backoff = 60;  // 初始退避 60 秒

    public function retryUntil(): \DateTime
    {
        return now()->addHours(2);  // 最多重试 2 小时
    }

    public function backoff(): array
    {
        // 指数退避：60s, 120s, 240s, 480s, 960s
        return [60, 120, 240, 480, 960];
    }

    public function failed(\Throwable $exception): void
    {
        // 记录失败详情
        \Log::critical('支付回调处理失败', [
            'order_id' => $this->orderId,
            'exception' => $exception->getMessage(),
            'attempts' => $this->attempts(),
        ]);

        // 通知运营
        Notification::route('slack', config('services.slack.webhook'))
            ->notify(new JobFailedNotification($this->orderId, $exception));
    }
}
```

### 7.2 Horizon Failed Job Retry 与幂等性

**⚠️ 踩坑记录 5**：通过 Horizon Dashboard 手动重试 Failed Job 时，如果 Job 的业务逻辑不幂等，会导致重复处理（如重复发送邮件、重复扣款）。

**解决方案**：在 Job 中加入幂等性校验：

```php
public function handle(): void
{
    $lockKey = "job:idempotent:{$this->job->getJobId()}";
    $lock = Cache::lock($lockKey, 3600);

    if (!$lock->get()) {
        // 已经执行过，跳过
        $this->delete();
        return;
    }

    try {
        // 业务逻辑
        $this->processPaymentCallback();
    } finally {
        $lock->release();
    }
}
```

---

## 八、生产环境调优 Checklist

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| `maxProcesses` | 10-20（视机器配置） | 过多导致 Redis 连接争抢 |
| `maxTime` | 3600 | 定期重启防内存泄漏 |
| `maxJobs` | 1000 | 配合 maxTime 使用 |
| `memory` | 256 (MB) | 超过则自动重启 |
| `timeout` | 90 (s) | 单个 Job 最大执行时间 |
| `balance` | auto | 多队列场景建议开启 |
| `balanceMaxShift` | 2 | 避免扩缩抖动 |
| `balanceCooldown` | 3 (s) | 配合 balanceMaxShift |
| `nice` | 0 | Linux 优先级，0 为正常 |

---

## 总结

Horizon 不只是一个好看的 Dashboard，它本质上是一个**基于 Redis 的分布式进程管理器**。在生产环境中，核心关注点是：

1. **多 Supervisor 隔离关键队列**，防止低优先级任务饿死关键路径
2. **指标外送 Prometheus/Grafana**，不能只看 Horizon 自带图表
3. **健康检查要深入到消费行为**，不能只检查进程是否存活
4. **K8s 部署用 Recreate 策略**，避免多 Supervisor 竞争
5. **Job 重试必须幂等**，Horizon 手动重试不等于安全重试

队列是系统的毛细血管，Horizon 是这根血管上的 CT 扫描仪——用好它，你才能在问题爆发前发现堵塞。

---

## 相关阅读

- [Laravel + PostgreSQL SKIP LOCKED 实战：不用 Redis 也能做任务出队、重试回收与死锁规避](/php/Laravel/laravel-postgresql-skip-locked-guide-redis-lock)
- [kkday/log + kkday/monitor + kkday/tracing 实战：Laravel 可观测性架构——日志聚合、指标采集与分布式追踪踩坑记录](/php/Laravel/kkday-log-monitor-tracing-laravel-architectureguide-loggingdistributed)
- [PHP Fiber 协程并发实战 — Laravel 并发 API 聚合与错误隔离踩坑记录](/php/Laravel/php-fiber-concurrencyguide-laravel-concurrencyapi)
- [Laravel 缓存策略全解：Route/Config/View/Query 缓存最佳实践踩坑记录](/php/Laravel/laravel-cache-route-config-view-query-cache)
- [数据库读写分离实战：Laravel 中间件 + MySQL 主从复制配置](/databases/2026-06-01-database-read-write-split-laravel-middleware-mysql-replication)
- [Laravel CQRS 实战：订单查询模型拆分、投影同步与后台列表性能治理](/php/Laravel/laravel-cqrs-guide-query)
