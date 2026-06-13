---
title: "Laravel Schedule Monitor 实战：任务调度监控与告警——spatie/laravel-schedule-monitor 的生产级运维方案"
keywords: [Laravel Schedule Monitor, spatie, laravel, schedule, monitor, 任务调度监控与告警, 的生产级运维方案, DevOps]
date: 2026-06-10 01:13:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Schedule
  - 监控
  - Spatie
  - 任务调度
  - 运维
description: "深入讲解 spatie/laravel-schedule-monitor 的安装、配置、告警集成与生产环境实战，让你的 Laravel 定时任务不再失联。"
---


## 概述

Laravel 的任务调度（Task Scheduling）是后端开发中最常用的功能之一——定时清理日志、同步数据、发送报表邮件、生成缓存……但你有没有遇到过这种情况：

- 定时任务跑了，但你不知道它跑了没有；
- 定时任务挂了三天，没人发现；
- 定时任务超时了，CPU 跑满，运维毫无感知；
- 多台服务器同时跑了同一个定时任务，数据错乱。

**"任务跑没跑、跑了多久、跑成功没有"——这些问题在生产环境中至关重要。**

`spatie/laravel-schedule-monitor` 就是来解决这个问题的。它能：

- 记录每一次定时任务的执行情况（开始时间、结束时间、耗时、状态）
- 检测任务超时、失败、未按时执行
- 通过 Slack / 邮件 / 自定义通道发送告警
- 提供数据库记录，方便回溯和审计

本文将从安装配置到生产级实战，带你完整走一遍。

---

## 核心概念

### 为什么需要 Schedule Monitor？

Laravel 自带的 `schedule:run` 只负责按计划调用任务，但它不会告诉你：

1. **执行状态**：任务成功了还是失败了？
2. **执行耗时**：任务跑了 5 秒还是 5 小时？
3. **执行频率**：每分钟的任务真的每分钟都在跑吗？
4. **并发问题**：`withoutOverlapping()` 是否生效？

传统做法是自己在每个任务里加日志、加监控，但这样：

- 代码重复、容易遗漏
- 日志分散在各处，难以统一查看
- 告警逻辑需要自己实现

`spatie/laravel-schedule-monitor` 把这些能力抽象成一个统一的中间件层，**对业务代码零侵入**。

### 工作原理

它的核心机制很简单：

1. **注册监听器**：监听 Laravel Schedule 的 `ScheduledTaskStarting` 和 `ScheduledTaskFinished` 事件
2. **记录日志**：把每次执行记录写入 `monitored_scheduled_tasks` 表
3. **健康检查**：根据配置的阈值判断任务是否健康（超时、未执行、失败）
4. **发送告警**：通过配置的通知渠道发送告警

---

## 安装与配置

### 1. 安装包

```bash
composer require spatie/laravel-schedule-monitor
```

### 2. 发布配置和迁移

```bash
php artisan schedule-monitor:publish
php artisan schedule-monitor:migrate
```

执行后会生成：
- `config/schedule-monitor.php`：配置文件
- `create_schedule_monitor_tables.php`：数据库迁移

### 3. 配置 `config/schedule-monitor.php`

```php
<?php

return [
    /*
     * 当任务执行完成后，是否自动清理数据库中的记录
     * 建议保留，否则数据库会持续增长
     */
    'delete_log_items_older_than_days' => 30,

    /*
     * 当任务未按时执行时，是否发送通知
     */
    'notify_when_task_not_run_on_time' => true,

    /*
     * 当任务超时时，是否发送通知
     */
    'notify_when_task_is_too_late' => true,

    /*
     * 默认的任务超时时间（秒）
     * 任务执行超过这个时间会触发告警
     */
    'default_timeout_in_seconds' => 300,

    /*
     * 任务超时后，是否自动终止进程
     * 需要配合 Linux 的 kill 命令使用
     */
    'automatically_kill_tasks_that_run_too_long' => false,

    /*
     * 通知配置
     */
    'notifications' => [
        /*
         * 当任务未按时执行时发送通知
         */
        'not_run_on_time' => [
            'via' => ['mail', 'slack'],
            'mail_to' => ['ops@example.com'],
            'slack_webhook_url' => env('SCHEDULE_MONITOR_SLACK_WEBHOOK'),
        ],

        /*
         * 当任务超时时发送通知
         */
        'too_late' => [
            'via' => ['mail', 'slack'],
            'mail_to' => ['ops@example.com'],
            'slack_webhook_url' => env('SCHEDULE_MONITOR_SLACK_WEBHOOK'),
        ],

        /*
         * 当任务失败时发送通知
         */
        'failed' => [
            'via' => ['mail', 'slack'],
            'mail_to' => ['ops@example.com'],
            'slack_webhook_url' => env('SCHEDULE_MONITOR_SLACK_WEBHOOK'),
        ],
    ],

    /*
     * 飞书通知支持（需要自定义 Channel）
     * 下文会详细介绍
     */
    'feishu_webhook_url' => env('SCHEDULE_MONITOR_FEISHU_WEBHOOK'),
];
```

### 4. 注册通知渠道

在 `app/Providers/AppServiceProvider.php` 中注册飞书通知渠道（如果使用飞书）：

```php
use Illuminate\Notifications\ChannelManager;
use App\Notifications\Channels\FeishuChannel;

public function boot(): void
{
    // 注册飞书通知渠道
    // 具体实现见下文
}
```

---

## 实战：为任务添加监控

### 方法一：自动监控（推荐）

在 `app/Console/Kernel.php` 中，给需要监控的任务调用 `monitor()` 方法：

```php
<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        // 清理过期日志 - 每天凌晨 2 点
        $schedule->command('logs:clean')
            ->dailyAt('02:00')
            ->monitor()  // 启用监控
            ->description('清理过期日志');

        // 同步商品数据 - 每 5 分钟
        $schedule->command('products:sync')
            ->everyFiveMinutes()
            ->monitor()
            ->withoutOverlapping()
            ->description('同步商品数据');

        // 生成日报 - 每天上午 9 点
        $schedule->command('reports:daily')
            ->dailyAt('09:00')
            ->monitor()
            ->timezone('Asia/Shanghai')
            ->description('生成日报');

        // 自定义超时时间的任务
        $schedule->command('data:export')
            ->dailyAt('03:00')
            ->monitor(timeout: 1800)  // 超时 30 分钟
            ->description('数据导出');
    }

    protected function commands(): void
    {
        $this->load(__DIR__.'/Commands');
    }
}
```

### 方法二：通过闭包任务监控

如果你用的是闭包任务，可以这样：

```php
$schedule->call(function () {
    // 业务逻辑
    app(OrderService::class)->closeExpiredOrders();
})
    ->everyMinute()
    ->monitor()
    ->withoutOverlapping()
    ->description('关闭超时订单');
```

### 方法三：批量监控

如果任务很多，可以写一个辅助方法：

```php
protected function schedule(Schedule $schedule): void
{
    $this->registerMonitoredTasks($schedule);
    $this->registerUnmonitoredTasks($schedule);
}

protected function registerMonitoredTasks(Schedule $schedule): void
{
    $tasks = [
        ['command' => 'logs:clean', 'schedule' => 'dailyAt:02:00', 'timeout' => 300],
        ['command' => 'products:sync', 'schedule' => 'everyFiveMinutes', 'timeout' => 60],
        ['command' => 'cache:refresh', 'schedule' => 'hourly', 'timeout' => 120],
        ['command' => 'reports:daily', 'schedule' => 'dailyAt:09:00', 'timeout' => 600],
    ];

    foreach ($tasks as $task) {
        $event = $schedule->command($task['command']);

        // 解析调度方式
        $this->applySchedule($event, $task['schedule']);

        // 启用监控
        $event->monitor($task['timeout'] ?? 300)
            ->withoutOverlapping()
            ->description($task['command']);
    }
}

protected function applySchedule($event, string $schedule): void
{
    [$method, $param] = explode(':', $schedule . ':');
    $param = $param ?: null;

    match ($method) {
        'everyFiveMinutes' => $event->everyFiveMinutes(),
        'everyFifteenMinutes' => $event->everyFifteenMinutes(),
        'hourly' => $event->hourly(),
        'daily' => $event->daily(),
        'dailyAt' => $event->dailyAt($param),
        'weekly' => $event->weekly(),
        default => $event->daily(),
    };
}
```

---

## 飞书告警集成

在 2026 年的国内开发环境中，飞书已经成为团队协作的主流选择。下面我们实现一个飞书 Webhook 通知通道。

### 1. 创建飞书通知通道

```php
<?php

namespace App\Notifications\Channels;

use Illuminate\Notifications\Notification;

class FeishuChannel
{
    public function send($notifiable, Notification $notification): void
    {
        $message = $notification->toFeishu($notifiable);

        $webhookUrl = config('schedule-monitor.feishu_webhook_url');

        if (empty($webhookUrl)) {
            \Log::warning('飞书 Webhook URL 未配置');
            return;
        }

        $payload = [
            'msg_type' => 'interactive',
            'card' => [
                'header' => [
                    'title' => [
                        'tag' => 'plain_text',
                        'content' => $message['title'],
                    ],
                    'template' => $message['level'] === 'error' ? 'red' : 'orange',
                ],
                'elements' => [
                    [
                        'tag' => 'div',
                        'text' => [
                            'tag' => 'lark_md',
                            'content' => $message['content'],
                        ],
                    ],
                    [
                        'tag' => 'note',
                        'elements' => [
                            [
                                'tag' => 'plain_text',
                                'content' => 'Laravel Schedule Monitor · ' . now()->format('Y-m-d H:i:s'),
                            ],
                        ],
                    ],
                ],
            ],
        ];

        try {
            \Http::timeout(5)->post($webhookUrl, $payload);
        } catch (\Exception $e) {
            \Log::error('飞书通知发送失败', [
                'error' => $e->getMessage(),
            ]);
        }
    }
}
```

### 2. 创建飞书通知类

```php
<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class ScheduleMonitorNotification extends Notification
{
    use Queueable;

    public function __construct(
        private string $taskName,
        private string $taskDescription,
        private string $status,
        private ?int $runtimeInSeconds = null,
        private ?string $lastRunAt = null,
    ) {}

    public function via($notifiable): array
    {
        return ['feishu'];
    }

    public function toFeishu($notifiable): array
    {
        $statusMap = [
            'not_run_on_time' => ['🔴 任务未按时执行', 'error'],
            'too_late' => ['🟠 任务执行超时', 'warning'],
            'failed' => ['🔴 任务执行失败', 'error'],
        ];

        [$title, $level] = $statusMap[$this->status] ?? ['⚠️ 任务异常', 'warning'];

        $content = "**任务名称**：{$this->taskName}\n";
        $content .= "**任务描述**：{$this->taskDescription}\n";

        if ($this->runtimeInSeconds !== null) {
            $minutes = floor($this->runtimeInSeconds / 60);
            $seconds = $this->runtimeInSeconds % 60;
            $content .= "**执行耗时**：{$minutes} 分 {$seconds} 秒\n";
        }

        if ($this->lastRunAt !== null) {
            $content .= "**上次执行**：{$this->lastRunAt}\n";
        }

        $content .= "\n> 请及时排查，确保任务正常运行。";

        return [
            'title' => $title,
            'content' => $content,
            'level' => $level,
        ];
    }
}
```

### 3. 配置 Webhook

在 `.env` 中添加：

```env
SCHEDULE_MONITOR_FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/your-webhook-token
```

---

## 生产环境最佳实践

### 1. 合理设置超时时间

不同任务的合理超时时间不同。根据历史执行数据设置：

```php
// 快速任务（< 1 分钟）
$schedule->command('cache:clear')
    ->hourly()
    ->monitor(timeout: 60);

// 中等任务（1-5 分钟）
$schedule->command('products:sync')
    ->everyFiveMinutes()
    ->monitor(timeout: 300);

// 长时间任务（30 分钟+）
$schedule->command('data:export')
    ->dailyAt('03:00')
    ->monitor(timeout: 1800);
```

### 2. 配合 `withoutOverlapping` 使用

```php
$schedule->command('orders:process')
    ->everyMinute()
    ->monitor()
    ->withoutOverlapping(10)  // 10 分钟后如果还在跑就终止
    ->runInBackground();
```

### 3. 在多服务器环境中的注意事项

如果你有多台服务器运行 `schedule:run`，需要注意：

```php
// 在 AppServiceProvider 中
public function boot(): void
{
    // 只在主服务器上运行定时任务
    $this->app->resolving(Schedule::class, function ($schedule) {
        if ($this->isPrimaryServer()) {
            // 主服务器：运行任务 + 监控
        } else {
            // 备用服务器：只运行监控，不运行任务
            // 或者完全不运行
        }
    });
}

protected function isPrimaryServer(): bool
{
    // 通过环境变量或 Redis 锁判断
    return env('SCHEDULE_PRIMARY_SERVER', true);
}
```

### 4. 数据库清理

监控数据会持续增长，建议配置自动清理：

```php
// config/schedule-monitor.php
'delete_log_items_older_than_days' => 30,
```

同时在任务调度中也清理：

```php
$schedule->command('schedule-monitor:clean')
    ->daily()
    ->monitor();
```

### 5. 使用 Artisan 命令查看状态

```bash
# 查看所有监控任务的状态
php artisan schedule-monitor:list

# 输出示例：
# +----+------------------+--------+-------------------+-------------------+----------+
# | ID | 任务名称         | 状态   | 上次执行          | 耗时              | 健康     |
# +----+------------------+--------+-------------------+-------------------+----------+
# | 1  | logs:clean       | ✅ OK  | 2026-06-10 02:00  | 12s               | 正常     |
# | 2  | products:sync    | ✅ OK  | 2026-06-10 01:55  | 45s               | 正常     |
# | 3  | reports:daily    | ⚠️ 超时 | 2026-06-10 09:00  | 720s              | 异常     |
# +----+------------------+--------+-------------------+-------------------+----------+
```

---

## 踩坑记录

### 踩坑 1：`monitor()` 方法找不到

**现象**：调用 `->monitor()` 时报方法不存在。

**原因**：没有注册 ServiceProvider。

**解决**：确保 `config/app.php` 中注册了：

```php
'providers' => [
    Spatie\ScheduleMonitor\ScheduleMonitorServiceProvider::class,
],
```

Laravel 5.5+ 支持包自动发现，通常不需要手动注册。如果还是不行，运行：

```bash
php artisan package:discover
```

### 踩坑 2：迁移表已存在

**现象**：执行迁移时报表已存在。

**原因**：之前已经执行过迁移，或者表名冲突。

**解决**：

```bash
# 查看迁移状态
php artisan migrate:status

# 如果确实需要重建
php artisan migrate:rollback
php artisan migrate
```

### 踩坑 3：多服务器环境重复记录

**现象**：数据库中每次任务有两条记录。

**原因**：多台服务器都在运行 `schedule:run`，每台都会触发监控。

**解决**：确保只有一台服务器运行调度：

```bash
# 在主服务器上运行
* * * * * cd /path-to-project && php artisan schedule:run >> /dev/null 2>&1

# 备用服务器不运行此 cron
```

### 踩坑 4：告警通知不发送

**现象**：任务失败了但没收到通知。

**原因**：
1. 通知渠道配置错误
2. Webhook URL 失效
3. `notify_when_task_not_run_on_time` 设为 `false`

**解决**：

```bash
# 测试通知是否正常
php artisan schedule-monitor:test-notification

# 检查配置
php artisan config:show schedule-monitor
```

### 踩坑 5：任务超时但未被终止

**现象**：任务超过 `timeout` 还在跑。

**原因**：`automatically_kill_tasks_that_run_too_long` 默认为 `false`。

**解决**：

```php
// config/schedule-monitor.php
'automatically_kill_tasks_that_run_too_long' => true,
```

**注意**：这会在 Linux 上发送 `SIGTERM` 信号，如果进程没有优雅退出，会继续发送 `SIGKILL`。确保你的任务能处理信号。

### 踩坑 6：`runInBackground()` 的监控问题

**现象**：后台运行的任务监控不到结束时间。

**原因**：`runInBackground()` 会 fork 子进程，监控事件可能丢失。

**解决**：对于需要精确监控的任务，避免使用 `runInBackground()`：

```php
// 不推荐
$schedule->command('heavy:task')
    ->runInBackground()
    ->monitor();

// 推荐：前台运行，配合超时
$schedule->command('heavy:task')
    ->monitor(timeout: 1800)
    ->withoutOverlapping(30);
```

---

## 高级用法

### 自定义监控数据

如果你需要记录额外的业务数据（如处理了多少条记录），可以在任务中手动更新：

```php
use Spatie\ScheduleMonitor\Models\MonitoredScheduledTask;

class SyncProducts extends Command
{
    public function handle(): int
    {
        $count = 0;

        foreach ($this->getProducts() as $product) {
            $this->syncProduct($product);
            $count++;
        }

        // 记录业务指标
        $monitored = MonitoredScheduledTask::where('name', 'products:sync')->first();
        if ($monitored) {
            $monitored->meta = ['synced_count' => $count];
            $monitored->save();
        }

        $this->info("同步完成：{$count} 条");
        return self::SUCCESS;
    }
}
```

### 与 Prometheus/Grafana 集成

如果你有 Prometheus 监控体系，可以暴露指标：

```php
// app/Http/Controllers/MetricsController.php
use Spatie\ScheduleMonitor\Models\MonitoredScheduledTask;

class MetricsController extends Controller
{
    public function metrics(): string
    {
        $tasks = MonitoredScheduledTask::all();

        $lines = [];
        $lines[] = '# HELP laravel_schedule_task_last_run_seconds Last run timestamp';
        $lines[] = '# TYPE laravel_schedule_task_last_run_seconds gauge';

        foreach ($tasks as $task) {
            $name = str_replace('-', '_', $task->name);
            $lastRun = $task->lastRunStartedAt?->timestamp ?? 0;
            $lines[] = "laravel_schedule_task_last_run_seconds{task=\"{$name}\"} {$lastRun}";

            $lines[] = "laravel_schedule_task_last_run_duration_seconds{task=\"{$name}\"} {$task->lastRunRuntimeInSeconds}";
            $lines[] = "laravel_schedule_task_status{task=\"{$name}\"} {$task->status}";
        }

        return implode("\n", $lines) . "\n";
    }
}
```

然后在 Prometheus 中配置抓取：

```yaml
scrape_configs:
  - job_name: 'laravel-schedule'
    static_configs:
      - targets: ['your-app:9090']
    metrics_path: '/metrics/schedule'
```

---

## 总结

`spatie/laravel-schedule-monitor` 是 Laravel 定时任务监控的事实标准。它的核心价值在于：

1. **零侵入**：只需在调度定义中加一行 `->monitor()`，不改业务代码
2. **标准化**：统一的任务执行记录，告别散乱的日志
3. **可告警**：Slack / 邮件 / 飞书 / 自定义通道，异常立即通知
4. **可回溯**：所有执行记录存数据库，出了问题能查到历史

**生产环境建议**：

- 所有关键任务都加上 `->monitor()`
- 设置合理的超时时间
- 集成飞书/Slack 告警
- 定期清理历史数据（30 天）
- 配合 `withoutOverlapping()` 防止并发

**一句话总结**：如果你在生产环境用了 Laravel 的定时任务，却没有监控，那你就是在裸奔。装上 `spatie/laravel-schedule-monitor`，5 分钟搞定，从此安心。

---

## 参考资料

- [spatie/laravel-schedule-monitor GitHub](https://github.com/spatie/laravel-schedule-monitor)
- [Laravel Task Scheduling 文档](https://laravel.com/docs/scheduling)
- [Spatie 官方文档](https://spatie.be/docs/laravel-schedule-monitor)
