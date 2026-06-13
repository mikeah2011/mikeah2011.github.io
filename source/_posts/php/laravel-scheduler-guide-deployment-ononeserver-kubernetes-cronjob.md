---
title: Laravel Scheduler 定时任务实战：多实例部署下的重入保护、onOneServer 失效与 Kubernetes CronJob 取舍
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 11:00:13
updated: 2026-05-03 11:01:35
categories:
  - php
  - kubernetes
tags: [DevOps, Kubernetes, Laravel, 定时任务, Scheduler, onOneServer]
keywords: [Laravel Scheduler, onOneServer, Kubernetes CronJob, 定时任务实战, 多实例部署下的重入保护, 失效与, 取舍, PHP]
description: 结合 Laravel 订单超时关闭、库存回补与报表汇总场景，深度记录 Scheduler 在多实例部署下的拆分策略、重入保护与 withoutOverlapping 陷阱、onOneServer 依赖共享缓存锁的前提条件、Kubernetes CronJob 的 concurrencyPolicy 与失败重试配置，以及从单机迁移到容器化部署过程中的真实踩坑记录与监控告警方案。



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
这样改完之后，超时关单不再重复回补库存，财务对账也不再因为滚动发布中断；更重要的是，任务责任边界终于清楚了：Laravel 负责业务上下文，Kubernetes 负责运行时隔离，队列负责削峰，数据库负责最终状态幂等。这套组合比单独依赖某一个 `withoutOverlapping()` 稳得多。

## 八、补充：完整的 `Kernel` 配置与 `schedule:work` Deployment 示例

很多文章只贴 `routes/console.php` 片段，却不提怎么把 `schedule:work` 跑进 Pod。下面是我实际用的 Kubernetes Deployment 和 Dockerfile 片段：

```yaml
# schedule-work-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: schedule-work
spec:
  replicas: 1   # 只需要一个副本，多副本必须配合 onOneServer + Redis
  selector:
    matchLabels:
      app: schedule-work
  template:
    metadata:
      labels:
        app: schedule-work
    spec:
      containers:
        - name: php
          image: registry.example.com/blog-api:latest
          command: ["php", "artisan", "schedule:work"]
          env:
            - name: CACHE_STORE
              value: redis
            - name: REDIS_HOST
              value: redis-master.default.svc.cluster.local
```

对应的 Dockerfile 关键片段：

```dockerfile
FROM registry.example.com/php:8.3-cli
WORKDIR /var/www/html
COPY . .
RUN composer install --no-dev --optimize-autoloader
# schedule:work 不需要 supervisor，直接前台运行
CMD ["php", "artisan", "schedule:work"]
```

## 九、补充：Kubernetes CronJob 高级配置

前面第五节的 CronJob 示例只展示了最简配置。下面补一个带资源限制、超时控制和环境变量注入的完整版本：

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: rebuild-daily-report
spec:
  schedule: "0 2 * * *"           # 每天凌晨 2 点
  concurrencyPolicy: Forbid       # 上一次没跑完就跳过本次
  startingDeadlineSeconds: 300     # 错过调度窗口 5 分钟内仍可补跑
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      activeDeadlineSeconds: 3600  # 最长跑 1 小时，超时自动终止
      backoffLimit: 2              # 失败重试 2 次
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: artisan
              image: registry.example.com/blog-api:v1.2.3  # 固定版本，不用 latest
              command: ["php", "artisan", "report:rebuild-daily"]
              resources:
                requests:
                  cpu: "500m"
                  memory: "512Mi"
                limits:
                  cpu: "1000m"
                  memory: "1Gi"
              envFrom:
                - secretRef:
                    name: app-secrets   # DB_PASSWORD 等敏感变量
                - configMapRef:
                    name: app-config    # APP_ENV 等非敏感变量
```

**关键配置解读：**

| 字段 | 作用 | 常见坑 |
|---|---|---|
| `concurrencyPolicy: Forbid` | 阻止并发执行 | 误设为 `Allow` 导致多个 Job 同时改同一张表 |
| `startingDeadlineSeconds: 300` | 错过调度窗口的补跑时限 | 不设则 Controller Manager 恢复后立即补跑所有错过的历史任务 |
| `activeDeadlineSeconds: 3600` | 单次执行超时强制终止 | 不设则任务挂死，永远不会结束 |
| `backoffLimit: 2` | 失败重试次数 | 默认 6 次，对幂等任务够用，对有副作用的任务可能重复 |
| `restartPolicy: Never` | 与 backoffLimit 配合 | 设为 `Always` 会让 kubelet 直接重启容器，绕过 Job 层重试逻辑 |
| 固定镜像版本 | 避免 `latest` 指向意外代码 | 发布新版本后需更新 CronJob YAML 或用 Helm 变量注入 |

## 十、真实踩坑案例汇总

### 案例 1：时区不一致导致任务在错误时间执行

`schedule` 字段用的是 **Controller Manager 所在节点的本地时区**，而不是 UTC。如果集群节点设为 CST（Asia/Shanghai），`0 2 * * *` 就是凌晨 2 点 CST；但如果节点是 UTC，同样的表达式就变成凌晨 2 点 UTC（北京时间上午 10 点）。建议统一用 `CRON_TZ` 环境变量显式指定，或者在 CronJob YAML 中用 `timeZone` 字段（Kubernetes 1.27+ 支持）。

```yaml
spec:
  schedule: "0 2 * * *"
  timeZone: "Asia/Shanghai"
```

### 案例 2：CronJob 保留数量过多导致 etcd 膨胀

`successfulJobsHistoryLimit` 和 `failedJobsHistoryLimit` 合计越大，etcd 里存的 Job 和 Pod 元数据越多。如果每小时跑一次、保留 10 个成功记录，一天就多出 240 个 Job 对象。建议成功记录保留 2-3 个，失败记录保留 3-5 个即可。

### 案例 3：schedule:work Pod 被 OOMKill 后静默消失

`schedule:work` 是长驻进程，如果任务触发的 artisan command 有内存泄漏，Pod 最终会被 OOMKill。关键是要给 Deployment 加 `restartPolicy: Always`（Deployment 默认就是），并配合 Prometheus 监控 `container_memory_working_set_bytes`。我在生产环境加了一个 `memory` limit 为 `256Mi` 的 sidecar exporter，内存超过 200Mi 就告警。

## 相关阅读

- [Kubernetes HPA 自动扩缩容实战：Laravel API 的 CPU 指标驱动与自定义 Metrics 配置](/devops/k8s-hpa-guide-laravel-api-cpu/)
- [Argo CD GitOps 实战：Laravel 应用的 GitOps 持续部署流水线](/devops/argocd-gitops-guide-laravel-cd/)
- [Docker Volume 与 NFS 持久化实战：Kubernetes 环境下 Laravel 应用的文件存储方案](/devops/docker-volume-guide-nfs-laravel/)
