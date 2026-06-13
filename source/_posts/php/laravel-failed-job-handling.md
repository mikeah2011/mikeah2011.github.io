---

title: Laravel-失败任务处理策略-重试机制死信队列与告警通知实战踩坑记录
keywords: [Laravel, 失败任务处理策略, 重试机制死信队列与告警通知实战踩坑记录]
date: 2026-05-05 06:25:43
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
updated: 2026-05-05 06:28:14
tags:
- Laravel
- Redis
- 消息队列
- 监控
categories:
- php
description: 深入 KKday B2C API 项目中 Laravel 失败任务的完整治理方案：从 retryUntil/backoff 精细化重试策略、Failed Job 死信队列分级归档、到 Slack/PagerDuty 告警通知闭环，以及生产环境中反复失败 Job 的人工介入与补偿流程设计。含 PHPUnit 测试用例与多队列驱动失败处理对比。
---


## 前言

队列系统最脆弱的环节从来不是"正常执行"，而是**失败之后怎么办**。

在 KKday B2C API 项目中，日均 500 万+ Job 的队列规模下，即便是 0.1% 的失败率也意味着每天 5000 个失败任务。如果这些失败任务没有被正确处理——没有重试、没有归档、没有告警——那么：用户订单扣了款但没发货、库存锁了但没释放、邮件/通知静默丢失。

我们曾经因为一个支付回调 Job 的 `retryUntil` 配置错误，在生产环境连续重试了 72 小时，Redis 队列积压到 12 万条，最终触发了 P0 级事故。这篇文章记录的就是那次事故之后，我们建立的完整失败任务治理体系。

<!-- more -->

---

## 一、Laravel 队列失败的三种场景

在讨论策略之前，先厘清 Laravel 中任务"失败"的三种不同语义：

```
┌─────────────────────────────────────────────────────────┐
│                    Job 生命周期                           │
│                                                         │
│  dispatch()  →  Queue  →  Worker 拉取  →  handle()     │
│                                        ↓               │
│                              ┌─────────┴──────────┐    │
│                              │                     │    │
│                           成功 ✅              异常抛出   │
│                              │                     │    │
│                          delete()          ┌───────┴──┐ │
│                                            │          │ │
│                                        未超限      已超限 │
│                                            │          │ │
│                                       release()   failed()│
│                                       (延迟重试)    (死信) │
└─────────────────────────────────────────────────────────┘
```

| 场景 | 触发条件 | Laravel 行为 |
|------|---------|-------------|
| **暂时性失败** | `maxExceptions` 未超限 | Job 被 `release()` 回队列，延迟 N 秒后重试 |
| **最终失败** | 超过最大重试次数 | 调用 `failed()` 方法，写入 `failed_jobs` 表 |
| **超时失败** | 超过 `retryUntil` 或 Worker timeout | Worker 强制终止，Job 进入 failed 状态 |

**踩坑 #1**：很多开发者只关注 `failed()` 方法里的逻辑，却忽略了"暂时性失败"阶段的设计。实际上，80% 的失败任务都能通过合理的重试策略自动恢复——关键在于重试参数的精细化配置。

---

## 二、重试策略精细化：retryUntil / backoff / maxExceptions

### 2.1 基础配置 vs 精细化配置

大多数项目的重试配置停留在"全局默认"阶段：

```php
// ❌ 粗糙的全局配置（config/queue.php）
'redis' => [
    'driver' => 'redis',
    'retry_after' => 90,    // 所有 Job 统一 90 秒
    'block_for' => null,
],
```

问题在于：发送一封邮件重试 90 秒足够了，但调用第三方支付回调可能需要等待 5 分钟。

### 2.2 按 Job 类型定制重试策略

```php
<?php

namespace App\Jobs\Payment;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessPaymentCallback implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $maxExceptions = 3;

    public function __construct(
        private readonly string $transactionId,
        private readonly array $callbackPayload,
    ) {
        // 高优先级队列
        $this->onQueue('payment-callbacks');
    }

    /**
     * 关键：用 retryUntil 替代 $tries 的粗暴截止
     * 给一个时间窗口而非固定次数，因为第三方服务恢复时间不可预测
     */
    public function retryUntil(): \DateTime
    {
        // 最多重试 10 分钟——超过这个时间，回调数据可能已过期
        return now()->addMinutes(10);
    }

    /**
     * 指数退避：第1次 5s, 第2次 15s, 第3次 45s, 第4次 135s...
     * 避免在第三方服务宕机时疯狂重试（打爆对方 + 打爆自己）
     */
    public function backoff(): array
    {
        return [5, 15, 45, 135, 300]; // 秒
    }

    public function handle(): void
    {
        $response = Http::timeout(10)
            ->retry(2, 1000) // HTTP 层额外重试 2 次
            ->post(config('services.payment.callback_url'), [
                'transaction_id' => $this->transactionId,
                'payload' => $this->callbackPayload,
            ]);

        if ($response->failed()) {
            throw new \RuntimeException(
                "Payment callback failed: {$response->status()}"
            );
        }

        Log::info('Payment callback processed', [
            'transaction_id' => $this->transactionId,
        ]);
    }

    /**
     * 最终失败时的处理——这里只做记录，告警交给 Failed Job 事件
     */
    public function failed(\\Throwable $exception): void
    {
        Log::critical('Payment callback FAILED permanently', [
            'transaction_id' => $this->transactionId,
            'exception' => $exception->getMessage(),
            'attempts' => $this->attempts(),
        ]);
    }
}
```

**踩坑 #2**：`backoff()` 返回数组时，数组长度决定了最多重试几次，**会覆盖 `$tries` 的值**。我们曾经设置 `$tries = 10` 但 `backoff()` 只返回了 5 个元素，结果只重试了 5 次就进入 failed 状态。务必确保两个值一致或用 `retryUntil()` 取代 `$tries`。

### 2.3 不同业务场景的重试参数对照表

| 场景 | $tries | backoff | retryUntil | 队列 |
|------|--------|---------|------------|------|
| 支付回调 | 5 | [5, 15, 45, 135, 300] | 10 min | payment-callbacks |
| 邮件发送 | 3 | [10, 30, 60] | 5 min | notifications |
| 库存扣减 | 3 | [1, 3, 5] | 2 min | inventory |
| 第三方 API 同步 | 7 | [10, 30, 60, 120, 300, 600, 1200] | 30 min | sync |
| 数据报表生成 | 2 | [30, 60] | 5 min | reports |

---

## 三、死信队列治理：Failed Jobs 的分级归档

### 3.1 默认 failed_jobs 表的局限

Laravel 默认将所有失败任务写入 `failed_jobs` 表，但这张表在生产环境中很快会变成"垃圾场"：

- 所有失败任务混在一起，无法按业务分类
- 没有重试状态追踪（哪些已人工修复、哪些还在等处理）
- 无法自动过期清理

### 3.2 自定义失败任务归档方案

```php
<?php

namespace App\Queue\Failed;

use Illuminate\Queue\Failed\DatabaseFailedJobProvider;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class GradedFailedJobProvider extends DatabaseFailedJobProvider
{
    /**
     * 失败任务分级存储
     * - critical: 支付/库存相关，立即告警
     * - warning: 通知/同步类，批量告警
     * - info: 报表/非关键任务，仅记录
     */
    public function log($connection, $queue, $payload, $exception): void
    {
        $jobName = $this->extractJobName($payload);
        $grade = $this->determineGrade($jobName, $exception);

        parent::log($connection, $queue, $payload, $exception);

        // 追加分级标记
        $lastId = DB::table($this->table)->max('id');
        DB::table($this->table)->where('id', $lastId)->update([
            'grade' => $grade,
            'job_name' => $jobName,
            'resolved' => false,
        ]);

        // 触发告警（见第四节）
        event(new \App\Events\JobFailed($jobName, $grade, $exception));
    }

    private function determineGrade(string $jobName, $exception): string
    {
        $criticalJobs = [
            'ProcessPaymentCallback',
            'ReleaseInventory',
            'ConfirmOrder',
        ];

        $warningJobs = [
            'SendNotification',
            'SyncToThirdParty',
            'UpdateSearchIndex',
        ];

        $shortName = class_basename($jobName);

        if (in_array($shortName, $criticalJobs)) {
            return 'critical';
        }

        if (in_array($shortName, $warningJobs)) {
            return 'warning';
        }

        return 'info';
    }

    private function extractJobName(string $payload): string
    {
        $decoded = json_decode($payload, true);
        return $decoded['displayName'] ?? 'Unknown';
    }
}
```

注册自定义 Provider：

```php
// app/Providers/AppServiceProvider.php
public function register(): void
{
    $this->app->singleton('queue.failer', function ($app) {
        return new \App\Queue\Failed\GradedFailedJobProvider(
            $app['db'],
            config('queue.failed.database'),
            config('queue.failed.table'),
        );
    });
}
```

### 3.3 失败任务数据库迁移增强

```php
Schema::table('failed_jobs', function (Blueprint $table) {
    $table->string('grade')->default('info')->after('id');
    $table->string('job_name')->nullable()->after('queue');
    $table->boolean('resolved')->default(false)->after('exception');
    $table->text('resolution_note')->nullable()->after('resolved');
    $table->timestamp('resolved_at')->nullable()->after('resolution_note');
    $table->index(['grade', 'resolved']);
    $table->index('job_name');
});
```

**踩坑 #3**：`failed_jobs` 表没有索引时，Horizon Dashboard 打开会超时（10 万条记录全表扫描）。务必给 `failed_at` 和 `queue` 字段加索引。

---

## 四、告警通知闭环：从失败到人知道

### 4.1 告警架构

```
Job Failed
    │
    ▼
JobFailed Event
    │
    ├──→ critical? ──→ Slack #p0-alerts + PagerDuty 立即通知
    │
    ├──→ warning?  ──→ Slack #queue-alerts 聚合通知 (5min batch)
    │
    └──→ info?     ──→ 仅写入 failed_jobs，次日日报汇总
```

### 4.2 实现告警 Listener

```php
<?php

namespace App\Listeners;

use App\Events\JobFailed;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Notification;
use App\Notifications\CriticalJobFailed;
use App\Notifications\WarningJobFailedBatch;
use Illuminate\Support\Facades\Cache;

class AlertOnJobFailed
{
    /**
     * critical 级别：立即通知
     */
    public function handle(JobFailed $event): void
    {
        match ($event->grade) {
            'critical' => $this->alertCritical($event),
            'warning' => $this->alertWarning($event),
            default => null, // info 级别不告警
        };
    }

    private function alertCritical(JobFailed $event): void
    {
        $channel = config('services.slack.alert_channel_p0');

        Notification::route('slack', $channel)
            ->notify(new CriticalJobFailed(
                jobName: $event->jobName,
                exception: $event->exception->getMessage(),
                failedAt: now()->toDateTimeString(),
            ));

        // PagerDuty 集成（用于凌晨无人值守时电话通知）
        if ($this->isOutsideBusinessHours()) {
            $this->triggerPagerDuty($event);
        }
    }

    private function alertWarning(JobFailed $event): void
    {
        // 5 分钟聚合窗口：避免通知风暴
        $cacheKey = "job_alert_batch_{$event->grade}";
        $batch = Cache::get($cacheKey, []);
        $batch[] = [
            'job' => $event->jobName,
            'error' => mb_substr($event->exception->getMessage(), 0, 100),
            'time' => now()->toIso8601String(),
        ];

        if (count($batch) >= 10 || Cache::get("{$cacheKey}_flushed")) {
            // 达到 10 条或定时刷新
            $channel = config('services.slack.alert_channel_warning');
            Notification::route('slack', $channel)
                ->notify(new WarningJobFailedBatch($batch));
            Cache::forget($cacheKey);
            Cache::forget("{$cacheKey}_flushed");
        } else {
            Cache::put($cacheKey, $batch, now()->addMinutes(5));
            // 标记 5 分钟后强制刷新
            if (!Cache::has("{$cacheKey}_flushed")) {
                Cache::put("{$cacheKey}_flushed", true, now()->addMinutes(5));
            }
        }
    }

    private function isOutsideBusinessHours(): bool
    {
        $hour = now()->hour;
        return $hour < 9 || $hour >= 18; // 台湾时间
    }

    private function triggerPagerDuty(JobFailed $event): void
    {
        \Http::post(config('services.pagerduty.events_url'), [
            'routing_key' => config('services.pagerduty.routing_key'),
            'event_action' => 'trigger',
            'payload' => [
                'summary' => "[P0] Queue Job Failed: {$event->jobName}",
                'severity' => 'critical',
                'source' => 'laravel-queue',
                'custom_details' => [
                    'job' => $event->jobName,
                    'exception' => $event->exception->getMessage(),
                ],
            ],
        ]);
    }
}
```

### 4.3 Slack 通知消息模板

```php
<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\SlackMessage;

class CriticalJobFailed extends \Illuminate\Notifications\Notification
{
    public function __construct(
        private string $jobName,
        private string $exception,
        private string $failedAt,
    ) {}

    public function via($notifiable): array
    {
        return ['slack'];
    }

    public function toSlack($notifiable): SlackMessage
    {
        return (new SlackMessage())
            ->error()
            ->content('🚨 *P0: 关键队列任务失败*')
            ->attachment(function ($attachment) {
                $attachment->fields([
                    '任务名称' => $this->jobName,
                    '失败原因' => mb_substr($this->exception, 0, 200),
                    '失败时间' => $this->failedAt,
                    '处理方式' => '请立即检查 Horizon Dashboard 或运行 `php artisan queue:retry all`',
                ]);
            });
    }
}
```

**踩坑 #4**：Slack Webhook 有频率限制（每秒 1 条）。我们在高峰期 Job 批量失败时，瞬间发出 200+ 条通知，导致后续告警全部被 Slack 静默丢弃。后来改用"聚合窗口"模式（5 分钟或 10 条触发一次），问题解决。

---

## 五、失败任务的人工介入与补偿流程

### 5.1 Artisan 命令速查

```bash
# 查看所有失败任务
php artisan queue:failed

# 重试指定 ID
php artisan queue:retry 5

# 重试所有失败任务（⚠️ 生产环境慎用）
php artisan queue:retry all

# 重试指定队列的失败任务
php artisan queue:retry --queue=payment-callbacks

# 删除指定失败任务
php artisan queue:forget 5

# 清空所有失败任务（⚠️ 不可逆）
php artisan queue:flush
```

### 5.2 自动补偿命令：按分级策略重试

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class RetryFailedByGrade extends Command
{
    protected $signature = 'queue:retry-by-grade
                            {--grade= : 失败等级 critical/warning/info}
                            {--older-than= : 仅重试 N 分钟前的失败任务}
                            {--dry-run : 仅预览不执行}';

    protected $description = '按分级策略重试失败队列任务';

    public function handle(): int
    {
        $grade = $this->option('grade') ?? 'critical';
        $olderThan = (int) ($this->option('older-than') ?? 5);
        $dryRun = $this->option('dry-run');

        $query = DB::table('failed_jobs')
            ->where('grade', $grade)
            ->where('resolved', false)
            ->where('failed_at', '<', now()->subMinutes($olderThan));

        $count = $query->count();
        $this->info("找到 {$count} 条 [{$grade}] 级别的失败任务（{$olderThan} 分钟前）");

        if ($count === 0) {
            return self::SUCCESS;
        }

        if (!$dryRun && !$this->confirm("确认重试这 {$count} 条任务？")) {
            return self::SUCCESS;
        }

        $jobs = $query->get();

        $bar = $this->output->createProgressBar($count);
        $bar->start();

        foreach ($jobs as $job) {
            if (!$dryRun) {
                // 调用 Laravel 内置重试
                \Artisan::call('queue:retry', ['id' => $job->id]);

                DB::table('failed_jobs')->where('id', $job->id)->update([
                    'resolved' => true,
                    'resolution_note' => 'Auto-retried by retry-by-grade command',
                    'resolved_at' => now(),
                ]);
            }

            $this->line("  [{$job->id}] {$job->job_name} - {$job->exception}");
            $bar->advance();
        }

        $bar->finish();
        $this->newLine();
        $dryRun
            ? $this->warn('Dry run 完成，未执行任何操作')
            : $this->info("已重试 {$count} 条任务");

        return self::SUCCESS;
    }
}
```

### 5.3 定时自动补偿 + 人工兜底

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // 每 10 分钟自动重试 warning 级别的失败任务（排除最近 5 分钟的，避免重复）
    $schedule->command('queue:retry-by-grade --grade=warning --older-than=5')
        ->everyTenMinutes()
        ->withoutOverlapping()
        ->appendOutputTo(storage_path('logs/retry-cron.log'));

    // 每天早上 9 点生成失败任务日报
    $schedule->call(function () {
        $stats = DB::table('failed_jobs')
            ->selectRaw('grade, COUNT(*) as count')
            ->where('resolved', false)
            ->groupBy('grade')
            ->get();

        if ($stats->isNotEmpty()) {
            Notification::route('slack', config('services.slack.daily_report'))
                ->notify(new \App\Notifications\FailedJobDailyReport($stats));
        }
    })->dailyAt('09:00');

    // 每月 1 号清理 30 天前已解决的失败任务
    $schedule->command('queue:prune-failed --hours=720')
        ->monthlyOn(1, '03:00');
}
```

---

## 六、完整架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                    Laravel 失败任务治理体系                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    重试策略层                                       │
│  │  Job     │    ┌─────────────┐                                 │
│  │ handle() │───▶│ backoff     │  指数退避 + 时间窗口              │
│  │ 失败     │    │ retryUntil  │  按业务场景定制                   │
│  └────┬─────┘    │ maxExcept.  │                                 │
│       │         └──────┬──────┘                                 │
│       │                │ 超限                                     │
│       ▼                ▼                                         │
│  ┌──────────────────────────┐                                    │
│  │   GradedFailedJobProvider │  分级归档                         │
│  │   critical / warning /    │                                    │
│  │   info                    │                                    │
│  └─────────┬────────────────┘                                    │
│            │                                                     │
│            ▼                                                     │
│  ┌──────────────────────────────────────────┐                    │
│  │            告警通知层                      │                    │
│  │  critical → Slack P0 + PagerDuty (即时)   │                    │
│  │  warning  → Slack 聚合通知 (5min batch)    │                    │
│  │  info     → 日报汇总 (daily)              │                    │
│  └──────────────────────────────────────────┘                    │
│            │                                                     │
│            ▼                                                     │
│  ┌──────────────────────────────────────────┐                    │
│  │            补偿恢复层                      │                    │
│  │  自动: cron 每 10min 重试 warning 级       │                    │
│  │  人工: retry-by-grade 命令 + Horizon UI    │                    │
│  │  清理: 月度 prune-failed + 归档           │                    │
│  └──────────────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 七、踩坑总结

| # | 踩坑 | 后果 | 解决方案 |
|---|------|------|---------|
| 1 | `backoff()` 数组长度与 `$tries` 不一致 | 重试次数少于预期 | 统一用 `retryUntil()` 时间窗口控制 |
| 2 | `failed_jobs` 表无索引 | Horizon Dashboard 超时 | 给 `failed_at`、`queue`、`grade` 加索引 |
| 3 | 告警无聚合导致通知风暴 | Slack Webhook 被限流丢弃 | 5 分钟/10 条聚合窗口 |
| 4 | 支付回调 `retryUntil` 设为 24 小时 | Redis 队列积压 12 万条 | 按业务时效设置合理窗口（支付 10min） |
| 5 | `queue:retry all` 误用 | 已修复的回调重复执行导致重复发货 | 改用 `retry-by-grade --grade=critical` 精确控制 |
| 6 | 没有区分"已人工修复"和"待处理" | 同一个失败任务被重复修复 | `resolved` 标记 + `resolution_note` |
| 7 | Supervisor `stopwaitsecs` 小于 Job 执行时间 | Worker 被 SIGKILL，Job 丢失且不进 failed_jobs | `stopwaitsecs` 大于最长 Job 执行时间 |
| 8 | `--max-time` 与 `stopwaitsecs` 冲突 | Worker 优雅退出被强制中断 | `stopwaitsecs` > `--max-time` |

---

## 八、不同队列驱动的失败处理能力对比

不同队列驱动在失败处理方面有显著差异，选型时需要提前了解：

| 特性 | Database | Redis | SQS | RabbitMQ |
|------|----------|-------|-----|----------|
| 失败任务持久化 | ✅ 数据库表 | ❌ 需自建 failed_jobs | ✅ DLQ 原生支持 | ✅ 死信交换器 (DLX) |
| 重试延迟精度 | 秒级 | 秒级 | 最小 0 秒 | 毫秒级 |
| 死信队列原生支持 | ❌ 应用层实现 | ❌ 应用层实现 | ✅ 原生 DLQ | ✅ DLX 绑定 |
| 最大消息大小 | 无限制 | 512MB | 256KB | 无限制 |
| 消息可见性超时 | N/A | `retry_after` | `VisibilityTimeout` | TTL / ACK |
| 适用规模 | 小中型 | 中大型 | 大型（Serverless） | 大型（自托管） |
| 失败任务可观测性 | SQL 查询 | Horizon Dashboard | CloudWatch | RabbitMQ Management UI |

> **生产建议**：Redis 驱动配合 Horizon 是 Laravel 生态最成熟的方案，但需注意 Redis 的 `retry_after` 配置要大于 Job 最长执行时间，否则 Job 会被重复执行。如果团队没有 Redis 运维经验，Database 驱动是最低成本的起步方案。

### Worker 假死与 Job 丢失的防御

在高负载场景下，Worker 可能因内存泄漏或 OOM 被系统 Kill，导致正在处理的 Job 既没有成功也没有进入 `failed_jobs` 表：

```php
// config/queue.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'queue' => env('REDIS_QUEUE', 'default'),
    'retry_after' => 180,   // ⚠️ 必须大于最长 Job 执行时间
    'block_for' => 5,       // 无任务时阻塞 5 秒，减少 Redis 轮询
],
```

```ini
; Supervisor 配置：Worker 内存超过 256MB 自动重启
[program:laravel-worker]
command=php /var/www/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
process_name=%(program_name)s_%(process_num)02d
numprocs=4
autostart=true
autorestart=true
stopwaitsecs=3600        ; ⚠️ 必须大于 --max-time
stopasgroup=true
killasgroup=true
stdout_logfile=/var/log/worker.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
```

**踩坑 #7**：Supervisor 的 `stopwaitsecs` 默认只有 10 秒。如果某个 Job 要执行 2 分钟，Supervisor 重启 Worker 时会直接 `SIGKILL`，导致 Job 丢失且**不进** `failed_jobs` 表——这是最隐蔽的丢任务场景，日志里找不到任何痕迹。

**踩坑 #8**：Laravel 10+ 的 `--max-time=3600` 参数让 Worker 运行 1 小时后优雅退出，配合 Supervisor `autorestart` 可以有效规避内存泄漏累积。但要注意 `stopwaitsecs` 必须大于 `--max-time`，否则 Worker 优雅退出期间会被强制杀死。

---

## 九、测试失败任务处理逻辑

在 CI/CD 流程中，确保失败任务处理逻辑的正确性同样重要：

```php
<?php

namespace Tests\Unit\Jobs;

use App\Jobs\Payment\ProcessPaymentCallback;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class ProcessPaymentCallbackTest extends TestCase
{
    /** @test */
    public function it_dispatches_to_payment_callbacks_queue(): void
    {
        Queue::fake();

        ProcessPaymentCallback::dispatch('txn_123', ['amount' => 100]);

        Queue::assertPushed(ProcessPaymentCallback::class, function ($job) {
            return $job->queue === 'payment-callbacks';
        });
    }

    /** @test */
    public function it_uses_correct_backoff_strategy(): void
    {
        $job = new ProcessPaymentCallback('txn_123', []);

        $backoff = $job->backoff();

        $this->assertEquals([5, 15, 45, 135, 300], $backoff);
        // 验证最大退避时间不超过 10 分钟
        $this->assertLessThanOrEqual(600, max($backoff));
    }

    /** @test */
    public function retry_until_does_not_exceed_business_window(): void
    {
        $job = new ProcessPaymentCallback('txn_123', []);

        $retryUntil = $job->retryUntil();

        // 确保重试窗口不超过 15 分钟（支付回调业务时效）
        $this->assertTrue(
            $retryUntil->diffInMinutes(now()) <= 15,
            '支付回调 retryUntil 超过业务时效窗口'
        );
    }

    /** @test */
    public function it_throws_on_http_failure(): void
    {
        Http::fake([
            '*' => Http::response('Server Error', 500),
        ]);

        $job = new ProcessPaymentCallback('txn_123', ['amount' => 100]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Payment callback failed');

        $job->handle();
    }

    /** @test */
    public function failed_method_logs_critical_error(): void
    {
        // 使用 spy 监控 Log facade
        $logSpy = \Illuminate\Support\Facades\Log::spy();
        $logSpy->shouldReceive('critical')->once()->with(
            'Payment callback FAILED permanently',
            \Mockery::on(fn ($context) =>
                $context['transaction_id'] === 'txn_123'
                && isset($context['exception'])
            )
        );

        $job = new ProcessPaymentCallback('txn_123', []);
        $job->failed(new \RuntimeException('test error'));
    }
}
```

**测试要点**：
- 验证 Job 被分发到正确的队列名称
- 验证 `backoff()` 数组长度与 `$tries` 或 `retryUntil` 一致
- 验证 `retryUntil` 不超过业务时效窗口
- 使用 `Http::fake()` 隔离外部依赖，避免真实 HTTP 调用
- 测试 `failed()` 方法的日志记录是否符合预期

> **经验法则**：在单元测试中验证重试参数的正确性，比在生产环境踩坑后修复成本低 100 倍。建议将重试参数验证加入 CI 的 lint 检查。

---

## 十、总结与最佳实践

1. **重试不是万能药**：对于"必然失败"的场景（如账户不存在），在 `handle()` 中直接判断并 `return`，不要抛异常浪费重试次数。

2. **retryUntil 优于 $tries**：时间窗口比固定次数更符合"等待外部服务恢复"的语义。

3. **分级是关键**：支付/库存是 critical，通知/同步是 warning，报表是 info。不同级别对应不同的告警通道和响应 SLA。

4. **告警要聚合**：避免通知风暴，5 分钟窗口是经验值。

5. **自动 + 人工兜底**：warning 级别可以自动重试，critical 级别必须人工确认后再重试（避免重复扣款/发货）。

6. **定期清理**：已解决的失败任务不要无限保留，月度清理 + 归档到冷存储。

---

## 相关阅读

- [Laravel Redis Queue + Horizon 实战：队列监控、失败重试与性能调优](/categories/PHP-Redis/laravel-redis-queue-horizon-guide-monitoring/)
- [Laravel Jobs & Queues 深度实战：延迟队列、批量任务与失败重试策略](/categories/PHP-Laravel/laravel-jobs-queues-deep-dive/)
- [Laravel Horizon 队列监控与生产环境运维实战](/categories/Misc-Laravel/laravel-horizon-monitoringguide/)
- [Laravel Notifications 多通道实战：邮件、短信、Slack 企业微信集成与降级策略](/categories/PHP-Laravel/laravel-notifications-guide-slack-fallback/)
- [Laravel Telescope 开发调试实战：请求追踪、队列监控与慢查询定位](/categories/PHP-Laravel/laravel-telescope-guide-monitoringslow-query/)
