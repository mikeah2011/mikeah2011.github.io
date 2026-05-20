---
title: Laravel Scheduler 定时任务实战：多实例部署下的重入保护、onOneServer 失效与 Kubernetes CronJob 取舍
date: 2026-05-03 11:00:13
updated: 2026-05-03 11:01:35
categories:
  - 05_PHP
  - Laravel
tags:
  - Laravel
  - Scheduler
  - Cron
  - Kubernetes
  - DevOps
  - Reliability
description: 结合 Laravel 订单超时关闭、库存回补与报表汇总场景，记录 Scheduler 在多实例部署下的拆分策略、重入保护、onOneServer 约束、Kubernetes CronJob 取舍与真实踩坑记录。
---

很多团队第一次用 Laravel Scheduler，都觉得它只是把 crontab 写进 PHP 而已；真正上线到多实例之后，问题才开始暴露：同一个任务被跑两次、`withoutOverlapping()` 没挡住长任务、`onOneServer()` 在容器里偶尔失效、发布时旧 Pod 还在跑半截，结果订单重复关闭、库存重复回补、日报数据互相覆盖。

我这次处理的是一组典型后台任务：每分钟扫描超时未支付订单、每五分钟汇总渠道成交额、每小时对账一次第三方支付。单机阶段一切正常，迁到 Kubernetes 后扩成 4 个 API Pod，再加一个 `schedule:work` 常驻 Pod，重复执行问题开始稳定复现。最后我的结论很明确：**不是所有定时任务都适合继续留在 Laravel Scheduler 里，短任务、轻编排、依赖应用上下文的任务适合 Scheduler；重任务、强隔离、需要独立失败重试的任务更适合 Kubernetes CronJob。**

## 一、最终落地架构

```text
                 +-----------------------------+
                 |      Kubernetes Cluster     |
                 +-------------+---------------+
                               |
                 +-------------v--------------+
                 |   schedule:work Pod        |
                 | routes/console.php         |
                 +------+------+--------------+
                        |      |
            dispatch job|      |run lightweight command
                        v      v
               +--------+--+  +------------------+
               |  Queue     |  | DB / Cache Lock  |
               | workers    |  | mysql + redis    |
               +-----+------+  +---------+--------+
                     |                   |
                     v                   v
             CloseExpiredOrderJob   scheduler mutex

     重任务/补数据/导出 --> Kubernetes CronJob --> php artisan app:rebuild-report
```

核心原则只有四条：

1. **Scheduler 只负责触发，不负责长时间干活。**
2. **真正耗时逻辑一律下发到队列 Job。**
3. **跨实例互斥不能只信进程内状态，必须依赖共享锁。**
4. **超过一个发布窗口的任务，优先迁到 CronJob，避免 Pod 被滚动发布中断。**

## 二、先把任务按类型拆开，不要全塞进 `schedule()`

我最后把任务分成三类：

- **A 类：秒级短任务**，例如“每分钟触发一次扫描命令”，可以保留在 Scheduler。
- **B 类：中耗时任务**，例如“扫描后逐单关闭”，Scheduler 只 dispatch job。
- **C 类：重任务**，例如“重建报表、补历史数据、全量对账”，迁到 Kubernetes CronJob。

`routes/console.php` 里的代码大概长这样：

```php
<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use App\Jobs\CloseExpiredOrdersJob;
use App\Jobs\AggregateChannelRevenueJob;

Schedule::call(function () {
    CloseExpiredOrdersJob::dispatch();
})
    ->name('orders:close-expired:dispatch')
    ->everyMinute()
    ->onOneServer()
    ->withoutOverlapping(2);

Schedule::call(function () {
    AggregateChannelRevenueJob::dispatch(now()->subMinutes(5));
})
    ->name('report:channel-revenue:dispatch')
    ->everyFiveMinutes()
    ->onOneServer()
    ->withoutOverlapping(10);

Schedule::command('payments:reconcile --provider=stripe')
    ->name('payments:reconcile:stripe')
    ->hourly()
    ->onOneServer()
    ->runInBackground();
```

这里我特意不用“大而全”的单个命令串所有逻辑，而是把“触发”和“执行”分开。这样即使某次扫描量突然暴涨，也只是队列积压，不会直接卡死 `schedule:work` 主循环。

## 三、真正的幂等要落在业务命令，不要迷信 `withoutOverlapping()`

很多人以为加了 `withoutOverlapping()` 就万事大吉，这个认知在线上很危险。它解决的是**同一个调度任务的重入**，不是**业务记录级别的幂等**。比如关闭超时订单，如果两次任务都扫到同一批订单，而代码只是 `where status = pending` 然后循环更新，就仍然可能出现重复回补库存。

我的处理方式是把状态迁移写成原子更新：

```php
<?php

namespace App\Jobs;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

class CloseExpiredOrdersJob implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function handle(): void
    {
        Order::query()
            ->where('status', 'pending')
            ->where('expire_at', '<=', now())
            ->orderBy('id')
            ->chunkById(200, function ($orders): void {
                foreach ($orders as $order) {
                    $affected = Order::query()
                        ->whereKey($order->id)
                        ->where('status', 'pending')
                        ->update([
                            'status' => 'cancelled',
                            'cancel_reason' => 'payment_timeout',
                            'updated_at' => now(),
                        ]);

                    if ($affected === 1) {
                        app(\App\Services\InventoryService::class)
                            ->releaseByOrder($order->id);
                    }
                }
            });
    }
}
```

这段代码真正挡住重复执行的，不是 Scheduler，而是 `where status = pending` 这类**状态条件 + 原子 update**。调度层互斥只能减少重复触发，不能代替业务幂等。

## 四、`onOneServer()` 不是银弹，前提没满足就会“看起来开了，实际上没生效”

我们踩过三个坑。

### 坑 1：默认 file cache，多个 Pod 根本不共享锁

开发环境一直正常，是因为只有一台机器。生产切到多 Pod 后，`CACHE_STORE=file` 时每个容器都有自己的本地文件锁，`onOneServer()` 等于没开。后来统一改成 Redis 作为默认 cache store，这个问题才消失。

### 坑 2：任务没命名，锁 key 不稳定

闭包任务如果不显式 `->name()`，发布后代码路径变化、序列化差异都可能让锁标识变得不可观测。我的经验是：**所有定时任务必须命名**，并把任务名写进监控日志。

### 坑 3：长任务超过锁 TTL，第二轮调度又进来了

`withoutOverlapping(10)` 代表 10 分钟 TTL，不代表任务一定 10 分钟内完成。我们有一次财务对账碰上第三方接口抖动，任务跑了 18 分钟，结果第 11 分钟新一轮任务再次启动。解决方法不是盲目把 TTL 调大，而是把长任务迁成 CronJob，或者把单次处理窗口缩小。

## 五、哪些任务我最后迁去了 Kubernetes CronJob

凡是满足下面任一条件，我都不再让它跑在 Scheduler 里：

- 单次执行可能超过 10 分钟；
- 需要独立 CPU / 内存配额；
- 失败后要有平台级重试和历史记录；
- 发布时不能被 API Pod 生命周期牵连。

例如日报重建任务：

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: rebuild-channel-report
spec:
  schedule: "15 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 2
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: artisan
              image: registry.example.com/blog-api:latest
              command: ["php", "artisan", "report:rebuild-channel", "--hours=2"]
```

这里的 `concurrencyPolicy: Forbid` 很关键，它直接从平台层阻止重入。相比把所有事情都压在 `schedule:work` 上，可观测性和隔离性会好很多。

## 六、我最后补上的监控与告警

只要用了 Scheduler，就至少要补三类指标：

1. **任务最后成功时间**，避免任务“悄悄不跑了”；
2. **任务耗时分位数**，避免短任务慢慢长成重任务；
3. **重复触发次数/跳过次数**，验证锁是否真的生效。

我在命令基类里统一打日志，字段至少包含：`task_name`、`scheduled_at`、`started_at`、`finished_at`、`lock_acquired`、`affected_rows`。后面排查重复关单事故时，这些字段比单看异常堆栈有用得多。

## 七、这次改造后的经验总结

Laravel Scheduler 本身没问题，问题通常出在我们把它当成“万能任务平台”。它更适合做**应用内编排器**，不适合吞掉所有批处理。我的实践标准很简单：**轻触发留在 Scheduler，重执行下沉到 Queue，重批处理交给 CronJob，业务幂等放在数据更新语义里。**

这样改完之后，超时关单不再重复回补库存，财务对账也不再因为滚动发布中断；更重要的是，任务责任边界终于清楚了：Laravel 负责业务上下文，Kubernetes 负责运行时隔离，队列负责削峰，数据库负责最终状态幂等。这套组合比单独依赖某一个 `withoutOverlapping()` 稳得多。