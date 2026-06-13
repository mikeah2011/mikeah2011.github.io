---

title: Laravel Task Scheduling 进阶实战：Schedule::job()->onOneServer() 的 Redis 互斥实现——多实例部署下的任务去重原理
keywords: [Laravel Task Scheduling, Schedule, job, onOneServer, Redis, 进阶实战, 互斥实现, 多实例部署下的任务去重原理]
description: 深入剖析 Laravel onOneServer() 多实例任务去重原理，详解 Redis 分布式互斥锁 SET NX EX 原子操作、锁生命周期管理与故障降级方案。涵盖 K8s 多 Pod 部署、Sentinel 高可用配置、Watchdog 锁续期实战代码，助你构建不重复执行的健壮定时任务系统。
date: 2026-06-07 12:00:00
tags:
- Laravel
- Task Scheduling
- Redis
- onOneServer
- 分布式
- Cron
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---



# Laravel Task Scheduling 进阶实战：Schedule::job()->onOneServer() 的 Redis 互斥实现——多实例部署下的任务去重原理

## 1. 开篇：多实例部署下定时任务重复执行的问题引入

在微服务与容器化部署日益普及的今天，Laravel 应用的多实例部署已成为生产环境的标配。当你将一个 Laravel 应用部署到 Kubernetes 的 3 个 Pod 上，或者在两台服务器上同时运行 `php artisan schedule:run`，一个经典问题便会浮出水面：

**同一个定时任务被多个实例同时触发，导致重复执行。**

想象一个真实的场景：你有一个每小时执行一次的「生成月度报表」任务，配置在 `Kernel.php` 中：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule)
{
    $schedule->job(new GenerateMonthlyReport)->hourly();
}
```

在单机部署下，Cron 只在一台服务器上运行，任务执行一次，一切正常。但当你部署了 3 个 Pod，每个 Pod 的容器都配置了 `* * * * * php artisan schedule:run`，每到整点，三个实例同时触发任务——报表被生成了三次，邮件被发送了三次，数据库中出现了三条重复记录。

这个问题在以下场景中尤为常见：

- **Kubernetes CronJob 与 Deployment 并存**：Deployment 中的 Pod 也跑了 `schedule:run`
- **多服务器部署**：多台 ECS 实例共享同一个数据库和 Redis
- **滚动更新**：新旧 Pod 短暂共存期间，两边同时触发任务
- **蓝绿部署/金丝雀发布**：两个环境共享后端存储

Laravel 从 5.8 版本开始，在 `Schedule` 上提供了 `onOneServer()` 方法来解决这个问题。本文将从源码层面深入剖析其实现原理，揭秘 Redis 互斥锁在多实例任务去重中的核心作用。

### 1.2 重复执行的危害

任务重复执行不仅仅是「多跑一次」那么简单，它可能引发严重的生产事故：

- **数据重复写入**：报表、邮件、通知被重复生成，用户收到多封相同邮件
- **财务损失**：涉及扣款、转账的任务重复执行可能导致资金多扣
- **资源浪费**：CPU、内存、数据库连接被无效消耗
- **状态不一致**：部分任务只执行一次，部分执行多次，导致业务状态混乱
- **告警风暴**：监控系统收到大量重复告警，掩盖真正的问题

这些问题在开发环境和小规模部署中很难暴露，一旦进入生产环境的多实例部署，就可能成为定时炸弹。

## 2. Laravel Task Scheduling 基础回顾

在深入 `onOneServer()` 之前，让我们先快速回顾 Laravel Task Scheduling 的核心架构，确保我们对调度系统的全貌有清晰的认识。

### 2.1 调度器的核心组件

Laravel 的任务调度系统由以下核心组件构成：

| 组件 | 职责 |
|------|------|
| `Schedule` | 调度器，管理所有定时任务的注册与执行 |
| `ScheduleTask` / `Event` | 单个调度事件，封装任务逻辑与运行条件 |
| `Mutex` | 互斥锁接口，防止任务并发执行 |
| `Scheduler` (运行器) | 被 `schedule:run` 命令调用，遍历并执行到期任务 |

### 2.2 基本用法回顾

```php
use Illuminate\Support\Facades\Schedule;

// 基本定时任务
Schedule::command('emails:send')->dailyAt('08:00');
Schedule::job(new CheckInventory)->everyFifteenMinutes();

// 团队成员维护的代码
Schedule::job(new Heartbeat)->daily();
```

调度器在 `app/Console/Kernel.php` 中集中定义，通过 `php artisan schedule:run` 命令触发。这个命令通常由系统 Cron 每分钟调用一次。

### 2.3 任务防并发的单机方案：withoutOverlapping

在单机场景下，Laravel 提供了 `withoutOverlapping()` 方法来防止任务重叠执行：

```php
Schedule::job(new GenerateReport)->hourly()->withoutOverlapping();
```

`withoutOverlapping()` 使用的是基于文件锁的 `FileMutex`，锁文件存储在 `storage/framework/schedule-*` 目录下。文件锁在同一台服务器的多个进程之间有效，但**无法跨服务器**——这正是多实例部署场景下的痛点。

### 2.4 调度器的 Mutex 接口体系

Laravel 为调度任务设计了一个简洁的互斥锁接口：

```php
// Illuminate\Scheduling\Mutex\Mutex
interface Mutex
{
    /**
     * 尝试获取锁，成功则执行回调。
     *
     * @return bool 是否成功获取锁
     */
    public function lock(Event $event, callable $callback);

    /**
     * 判断锁是否已被持有。
     */
    public function isBlocked(Event $event): bool;
}
```

这个接口有两个实现：

| 实现类 | 存储介质 | 适用范围 | 使用场景 |
|--------|----------|----------|----------|
| `FileMutex` | 本地文件系统 | 单台服务器 | `withoutOverlapping()` |
| `RedisMutex` | Redis | 所有服务器 | `onOneServer()` |

这种设计体现了 Laravel 的「依赖倒置」原则——调度器只依赖接口，具体使用哪种锁由配置决定。

### 2.5 Mutex 的注册与绑定

在 `EventServiceProvider` 或 `AppServiceProvider` 中，Laravel 默认将 `Mutex` 绑定为 `RedisMutex`：

```php
// Illuminate\Scheduling\ScheduleServiceProvider
$this->app->bind(
    \Illuminate\Scheduling\Mutex\Mutex::class,
    fn ($app) => new RedisMutex($app['cache']->driver())
);
```

这意味着只要应用配置了 Redis 缓存驱动，`onOneServer()` 就能自动工作，无需额外配置。

## 3. Schedule::job()->onOneServer() 的核心原理

### 3.1 使用方式

`onOneServer()` 的使用非常简洁：

```php
Schedule::job(new GenerateMonthlyReport)
    ->dailyAt('02:00')
    ->onOneServer();
```

一行代码，调度器便会在所有运行实例中确保该任务只在一个服务器上执行。

### 3.2 核心机制概述

`onOneServer()` 的底层原理可以概括为：

1. **每个实例在执行调度时**，先尝试获取一个全局唯一的分布式锁（通过 Redis）
2. **获取锁成功的实例**执行任务，**获取失败的实例**跳过该任务
3. **任务执行完毕后释放锁**，下一个调度周期重新竞争

关键在于，这个锁是存储在 Redis 中的，而所有实例共享同一个 Redis 实例，因此锁是全局可见的——无论你部署了多少个 Pod、多少台服务器。

### 3.3 内部数据流

```
实例 A: schedule:run → 遍历任务 → onOneServer? → 尝试 Redis 加锁 → ✓ 获取成功 → 执行任务 → 释放锁
实例 B: schedule:run → 遍历任务 → onOneServer? → 尝试 Redis 加锁 → ✗ 已被占用 → 跳过
实例 C: schedule:run → 遍历任务 → onOneServer? → 尝试 Redis 加锁 → ✗ 已被占用 → 跳过
```

## 4. Redis 互斥锁实现深入解析

### 4.1 互斥锁的生命周期

理解 `onOneServer()` 的关键在于理解其互斥锁的完整生命周期：

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────┐
│  lock_for()  │───▶│   任务执行中      │───▶│   unlock()  │
│  获取锁      │    │  (锁已被占用)     │    │   释放锁    │
└─────────────┘    └──────────────────┘    └─────────────┘
       │                                         │
       ▼                                         ▼
  ┌─────────┐                              ┌──────────┐
  │ 获取失败 │                              │ 锁过期   │
  │ 跳过任务 │                              │ 自动释放  │
  └─────────┘                              └──────────┘
```

### 4.2 lock_for() 方法详解

互斥锁的核心是 `lock_for()` 方法，它在任务执行前调用，负责获取锁。以下是其完整流程：

```php
// Illuminate\Scheduling\Mutex\RedisMutex
protected function lock_for(Event $event): bool
{
    return $this->cache->lock(
        $this->getKey($event),
        $this->expiration  // 默认 3600 秒
    )->get();
}
```

**关键参数解析：**

- **锁的 Key**：由任务的签名（唯一标识）生成，确保每个任务有独立的锁
- **过期时间（expiration）**：锁的最大持有时间，防止死锁。默认 3600 秒（1小时）

### 4.3 锁的 Key 生成规则

锁的 Key 生成逻辑保证了每个任务有唯一的标识：

```php
protected function getKey(Event $event): string
{
    // 基于事件的唯一签名生成锁 Key
    return 'framework/schedule/' . $event->mutexName();
}
```

对于一个 Job 任务，`mutexName()` 通常是任务类名加上序列化后的参数：

```php
// 例如：GenerateMonthlyReport 任务的锁 Key 可能是
"framework/schedule/Illuminate\Queue\CallQueuedHandler@generate_monthly_report"
```

这意味着不同的任务有不同的锁，互不干扰——你可以同时在不同服务器上执行不同的 `onOneServer` 任务。

### 4.4 unlock() 方法详解

任务执行完成后，必须释放锁，以便下一个调度周期可以再次执行：

```php
// Illuminate\Scheduling\Mutex\RedisMutex
protected function unlock(Event $event): void
{
    $this->cache->lock($this->getKey($event))->forceDelete();
}
```

`forceDelete()` 会直接删除 Redis 中的锁 Key，无论锁是否过期。这确保了：
- 正常完成：锁立即释放
- 任务超时但 Redis 仍保留 Key：也能强制清除

### 4.5 锁的保护流程

整个锁保护的流程封装在 `call()` 方法中：

```php
// Illuminate\Scheduling\Event
public function run(Application $app): bool
{
    if ($this->onOneServer) {
        $mutex = $app->make(Mutex::class);

        return $mutex->lock($this, function () use ($app) {
            return $this->runUsingMutex($app);
        });
    }

    return $this->runUsingMutex($app);
}

protected function runUsingMutex(Application $app): bool
{
    try {
        return $this->runJob($app);
    } finally {
        // 无论任务是否成功，都执行回调（用于记录日志等）
    }
}
```

注意这里使用了闭包：`lock()` 方法接收一个回调，只有在成功获取锁后才会执行回调中的任务逻辑。如果获取锁失败，回调不会执行，任务被跳过。

## 5. 源码分析：Scheduler → Mutex → Redis 的调用链

### 5.1 完整调用链

从 `php artisan schedule:run` 到 Redis 的一次完整调用链如下：

```
artisan schedule:run
  │
  ▼
Illuminate\Console\Scheduling\ScheduleRunCommand::handle()
  │
  ▼
Illuminate\Console\Scheduling\Schedule::run()
  │ 遍历所有已注册的 Event
  ▼
Illuminate\Scheduling\Event::run()
  │ 检查是否 onOneServer
  ▼
Illuminate\Scheduling\Mutex\RedisMutex::lock()
  │
  ▼
RedisMutex::lock_for()
  │
  ▼
Illuminate\Cache\Repository::lock()  // Cache facade
  │
  ▼
RedisStore::lock()
  │
  ▼
Illuminate\Cache\RedisLock::acquire()
  │
  ▼
Redis SET key value NX EX timeout  // 原子操作
```

### 5.2 关键源码片段

让我们逐层分析每一层的源码实现。

**第一层：ScheduleRunCommand**

```php
// Illuminate\Console\Scheduling\ScheduleRunCommand
public function handle(Schedule $schedule, Dispatcher $dispatcher)
{
    $this->scheduler->setArtisan($this->artisan);
    $this->scheduler->run();
}
```

**第二层：Scheduler::run()**

```php
// Illuminate\Console\Scheduling\Scheduler
public function run()
{
    $events = $this->scheduler->dueEvents($this->laravel);

    foreach ($events as $event) {
        if ($event->isDue($this->laravel) && ...) {
            $this->runEvent($event);
        }
    }
}

protected function runEvent(Event $event)
{
    $event->run($this->laravel);
}
```

**第三层：Event::run()**

```php
// Illuminate\Scheduling\Event
public function run(Application $app): bool
{
    if ($this->onOneServer) {
        $mutex = $app->make(Mutex::class);
        return $mutex->lock($this, function () use ($app) {
            return $this->runUsingMutex($app);
        });
    }
    return $this->runUsingMutex($app);
}
```

**第四层：RedisMutex**

```php
// Illuminate\Scheduling\Mutex\RedisMutex
public function lock(Event $event, $callback)
{
    if ($this->lock_for($event)) {
        try {
            $result = $callback();
            return $result ?? true;
        } finally {
            $this->unlock($event);
        }
    }

    return false;
}

protected function lock_for(Event $event): bool
{
    return $this->cache->lock(
        $this->getKey($event),
        $this->expiration
    )->get();
}
```

**第五层：Redis SET NX EX（原子操作）**

最终，锁的获取落实到 Redis 的原子命令：

```php
// Illuminate\Cache\RedisLock
public function acquire()
{
    if ($this->block) {
        return $this->blockFor(
            $this->seconds,
            $this->store->getConnection($this->connection)
        );
    }

    // 核心：SET key value NX EX timeout
    // NX: 只在 Key 不存在时设置
    // EX: 设置过期时间（秒）
    $acquired = $this->store->getConnection($this->connection)
        ->set(
            $this->name,
            $this->owner,
            ['NX', 'EX' => $this->seconds]
        );

    if ($acquired) {
        $this->acquired = true;
    }

    return $acquired ?? false;
}
```

`SET key value NX EX timeout` 是 Redis 2.6.12+ 支持的原子操作：
- **NX**：Only set if the key does not exist（仅在 Key 不存在时设置）
- **EX**：Set expiry in seconds（设置过期时间，单位秒）

这个原子操作保证了即使两个实例在同一毫秒内尝试获取锁，Redis 也能正确处理——只有一个会成功。

## 6. 配置与使用指南

### 6.1 基本配置

要使用 `onOneServer()`，首先需要确保应用配置了 Redis 缓存驱动：

```php
// config/database.php 中的 Redis 配置
'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),
    'default' => [
        'url' => env('REDIS_URL'),
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'port' => env('REDIS_PORT', 6379),
        'database' => env('REDIS_DB', 0),
        'password' => env('REDIS_PASSWORD'),
        'prefix' => env('REDIS_PREFIX', 'laravel_'),
    ],
],
```

```php
// .env 文件
CACHE_DRIVER=redis
REDIS_HOST=10.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=your_password
REDIS_DB=0
```

### 6.2 锁过期时间配置

`RedisMutex` 的默认过期时间是 **3600 秒（1小时）**。如果任务执行时间可能超过这个值，需要自定义 Mutex：

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Support\Facades\Schedule;
use Illuminate\Scheduling\Mutex\RedisMutex;

public function boot()
{
    // 自定义互斥锁的过期时间为 7200 秒
    $this->app->bind(
        \Illuminate\Scheduling\Mutex\Mutex::class,
        function ($app) {
            return new RedisMutex(
                $app['cache']->driver(),
                7200 // 2小时
            );
        }
    );
}
```

**过期时间的选择策略：**

| 场景 | 建议过期时间 | 原因 |
|------|-------------|------|
| 快速任务（< 5分钟） | 300 秒 | 快速释放，降低风险 |
| 常规任务（5-60分钟） | 3600 秒（默认值） | 平衡安全性与容错性 |
| 长时间任务（> 1小时） | 任务时长 × 2 | 确保任务完成前锁不会过期 |

### 6.3 Redis 连接选择

如果应用使用了多个 Redis 实例，可以指定锁使用哪个连接：

```php
// 使用独立的 Redis 实例存储调度锁
Schedule::job(new ImportantTask)
    ->daily()
    ->onOneServer()
    ->onConnection('scheduler-lock'); // 使用独立 Redis 连接
```

在 `config/database.php` 中添加专用连接：

```php
'redis' => [
    'scheduler-lock' => [
        'url' => env('REDIS_SCHEDULER_URL'),
        'host' => env('REDIS_SCHEDULER_HOST', '10.0.0.2'),
        'port' => env('REDIS_SCHEDULER_PORT', 6379),
        'database' => env('REDIS_SCHEDULER_DB', 1),
        'password' => env('REDIS_SCHEDULER_PASSWORD'),
    ],
],
```

### 6.4 组合使用：onOneServer + withoutOverlapping

`onOneServer` 和 `withoutOverlapping` 可以组合使用，前者防止跨实例重复，后者防止同一实例内重叠：

```php
Schedule::job(new LongRunningReport)
    ->dailyAt('02:00')
    ->onOneServer()        // 多实例去重
    ->withoutOverlapping() // 单实例防重叠
    ->runInBackground();   // 后台执行，不阻塞调度器
```

两者使用的锁机制不同：
- `onOneServer()` → `RedisMutex`（跨实例）
- `withoutOverlapping()` → `FileMutex`（本实例）

组合使用能提供最全面的保护。

## 7. 多实例部署场景实战

### 7.1 Kubernetes 部署方案

在 K8s 环境中，通常有两种方式运行定时任务：

**方案一：独立的 CronJob + 共享代码**

```yaml
# cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: laravel-scheduler
spec:
  schedule: "* * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: php
            image: your-app:latest
            command: ["php", "artisan", "schedule:run", "--no-interaction"]
          restartPolicy: OnFailure
```

配合 Deployment 中的多副本 Pod：

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: laravel-app
spec:
  replicas: 3  # 3个副本
  template:
    spec:
      containers:
      - name: php
        image: your-app:latest
```

在这种场景下，CronJob 和 Deployment 的 Pod 都可能触发 `schedule:run`。使用 `onOneServer()` 确保任务只执行一次：

```php
Schedule::job(new DailyCleanup)
    ->daily()
    ->onOneServer();
```

**方案二：单一定时触发器**

更干净的做法是在 K8s 中只保留一个 CronJob 作为触发器，Deployment 的 Pod 不运行 Cron。但这需要额外的 CronJob 配置，且在 Pod 重启或缩容时可能丢失触发。

### 7.2 多服务器部署

对于传统的多服务器部署（如多台 ECS），方案更为直接：

**所有服务器连接同一个 Redis 实例：**

```php
// .env（所有服务器使用相同的配置）
CACHE_DRIVER=redis
REDIS_HOST=10.0.0.100  // 共享 Redis 的地址
REDIS_PORT=6379
```

**每台服务器的 Crontab 配置：**

```bash
# 服务器 A
* * * * * cd /var/www/app && php artisan schedule:run >> /dev/null 2>&1

# 服务器 B（相同的配置）
* * * * * cd /var/www/app && php artisan schedule:run >> /dev/null 2>&1
```

因为 `onOneServer()` 的锁存储在 Redis 中，所有服务器共享同一个锁，只有一个能成功获取。

### 7.3 混合部署场景

在更复杂的混合部署场景中（如部分任务在 K8s，部分在传统服务器），建议：

```php
// 只有关键任务使用 onOneServer
Schedule::job(new PaymentReconciliation)
    ->dailyAt('00:00')
    ->onOneServer();

// 非关键任务可以不做互斥
Schedule::job(new CacheWarmup)
    ->everyFiveMinutes();
```

## 8. 失败场景与应对策略

### 8.1 Redis 宕机

**场景**：Redis 实例挂掉，所有 `onOneServer()` 的锁获取失败。

**影响**：任务不会执行。`lock_for()` 返回 `false`，闭包中的任务逻辑不运行。

**应对策略**：

```php
// 自定义 Mutex，Redis 不可用时降级为 FileMutex
class FallbackRedisMutex implements Mutex
{
    public function __construct(
        protected RedisMutex $redisMutex,
        protected FileMutex $fileMutex
    ) {}

    public function lock(Event $event, callable $callback): bool
    {
        try {
            return $this->redisMutex->lock($event, $callback);
        } catch (\Exception $e) {
            // Redis 不可用，降级为文件锁
            Log::warning('Redis mutex failed, falling back to file lock', [
                'event' => $event->mutexName(),
                'error' => $e->getMessage(),
            ]);
            return $this->fileMutex->lock($event, $callback);
        }
    }
}
```

### 8.2 网络分区

**场景**：实例与 Redis 之间出现网络分区，锁获取请求超时。

**影响**：取决于超时设置。如果超时时间短，可能导致部分实例获取锁失败而另一部分成功。

**应对策略**：

1. **Redis 高可用**：使用 Redis Sentinel 或 Redis Cluster
2. **设置合理的超时**：在 Redis 客户端配置中设置连接和读写超时
3. **监控告警**：对 Redis 连接状态进行监控

```php
// config/database.php
'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),
    'options' => [
        'prefix' => env('REDIS_PREFIX', 'laravel_'),
        'serializer' => Redis::SERIALIZER_NONE,
    ],
    'default' => [
        // ...
        'read_timeout' => 3, // 读超时 3 秒
    ],
],
```

### 8.3 锁过期但任务未完成

**场景**：任务执行时间超过锁的过期时间，锁自动释放，其他实例开始执行同一任务。

**影响**：任务可能被重复执行。

**应对策略**：

1. **合理设置过期时间**：确保过期时间远大于任务最长执行时间
2. **锁续期（Watchdog）模式**：在任务执行过程中定期续期

```php
// 自定义 Mutex 实现锁续期
class WatchdogRedisMutex extends RedisMutex
{
    protected function lock_for(Event $event): bool
    {
        $acquired = parent::lock_for($event);

        if ($acquired) {
            // 启动续期守护进程
            $this->startWatchdog($event);
        }

        return $acquired;
    }

    protected function startWatchdog(Event $event): void
    {
        // 每 10 秒续期一次
        $timer = new Timer(10, function () use ($event) {
            $this->cache->lock($this->getKey($event), 3600)->get();
        });
        $timer->start();

        // 注册 shutdown 回调，在任务结束时停止守护进程
        register_shutdown_function(function () use ($timer) {
            $timer->stop();
        });
    }
}
```

### 8.4 Redis 主从切换

**场景**：Redis 主从切换期间，锁数据可能丢失。

**影响**：短时间内可能出现两个实例同时获取锁。

**应对策略**：

使用 Redis 的 `WAIT` 命令确保写入同步到从节点，或使用 Redlock 算法（多 Redis 节点的分布式锁）。

对于大多数 Laravel 应用场景，单 Redis 实例 + Sentinel 的可用性已经足够。

### 8.5 调试与排查：onOneServer 不生效的常见原因

在实际使用中，`onOneServer()` 有时会出现「预期去重但实际没有去重」的情况。以下是排查清单：

**1. Redis 驱动未正确配置**

```bash
# 检查当前缓存驱动
php artisan tinker --execute="echo config('cache.default');"
# 应该输出 "redis"
```

如果输出不是 `redis`，锁无法跨实例共享。检查 `.env` 文件：

```env
CACHE_DRIVER=redis
```

**2. 多个 Redis 实例导致 Key 隔离**

如果不同服务器连接了不同的 Redis 实例，锁 Key 不会互相可见：

```php
// 服务器 A 的 .env
REDIS_HOST=10.0.0.1

// 服务器 B 的 .env（连接了另一个 Redis！）
REDIS_HOST=10.0.0.2
```

解决方案：所有服务器必须连接同一个 Redis 实例（或同一组 Sentinel）。

**3. Redis Key 前缀不一致**

如果 `config/database.php` 中不同实例配置了不同的 Redis 前缀：

```php
// 服务器 A
'prefix' => 'app_a_',

// 服务器 B
'prefix' => 'app_b_',
```

锁 Key 会被加上不同的前缀，导致互相无法感知。

**4. 调试技巧：直接观察 Redis 中的锁**

```bash
# 在 Redis 中查看所有调度锁
redis-cli KEYS "*framework/schedule*"

# 手动删除残留锁（慎用）
redis-cli DEL "laravel:framework/schedule/[mutex-name]"
```

**5. 使用日志追踪锁状态**

在自定义 Mutex 中添加日志：

```php
class LoggingRedisMutex extends RedisMutex
{
    protected function lock_for(Event $event): bool
    {
        $key = $this->getKey($event);
        $result = parent::lock_for($event);

        if ($result) {
            Log::info('Mutex acquired', [
                'key' => $key,
                'server' => gethostname(),
                'pid' => getmypid(),
            ]);
        } else {
            Log::warning('Mutex blocked', [
                'key' => $key,
                'server' => gethostname(),
            ]);
        }

        return $result;
    }
}
```

### 8.6 锁泄漏的处理

如果某个实例在持有锁后异常退出（如 OOM Kill），锁会一直存在直到过期。在此期间，其他实例无法执行该任务。处理方式：

```bash
# 1. 检查锁的剩余存活时间
redis-cli PTTL "laravel:framework/schedule/your-mutex-key"

# 2. 如果确认任务已中断，手动释放锁
redis-cli DEL "laravel:framework/schedule/your-mutex-key"

# 3. 设置合理的过期时间，避免长时间锁死
```

生产环境中建议为每个 `onOneServer()` 任务设置一个比任务正常执行时间稍长但不过长的过期时间，既保证任务有足够时间完成，又能快速恢复。

## 9. 与全局缓存锁（Cache::lock）的对比

`onOneServer()` 底层使用的是 `RedisMutex`，而 Laravel 的 `Cache::lock()` 也是基于 Redis 的分布式锁。两者有什么区别？

### 9.1 适用场景对比

| 特性 | onOneServer (RedisMutex) | Cache::lock() |
|------|------------------------|---------------|
| 用途 | 调度任务去重 | 通用业务并发控制 |
| 锁粒度 | 任务级（自动管理） | 业务级（手动管理） |
| 生命周期 | 自动获取/释放 | 手动 acquire/release |
| 释放方式 | forceDelete() | forceRelease() |
| Key 前缀 | `framework/schedule/` | `laravel_cache_` |
| 过期时间 | Mutex 构造时配置 | 获取时配置 |

### 9.2 代码对比

**使用 onOneServer（框架自动管理）：**

```php
// 一行代码，框架处理所有锁逻辑
Schedule::job(new SendInvoice)->daily()->onOneServer();
```

**使用 Cache::lock（手动管理）：**

```php
// 手动管理锁的获取和释放
Schedule::command('invoice:send')->daily()->withoutOverlapping(3600);

// 或在 Job 中手动使用
class SendInvoice implements ShouldQueue
{
    public function handle(): void
    {
        $lock = Cache::lock('invoice:send:lock', 3600);

        if ($lock->get()) {
            try {
                // 执行业务逻辑
                $this->processInvoices();
            } finally {
                $lock->forceRelease();
            }
        }
    }
}
```

### 9.3 如何选择

- **优先使用 `onOneServer()`**：对于调度任务的去重，这是最简洁、最符合框架设计理念的方式
- **使用 `Cache::lock()`**：对于需要更精细控制的场景，如需要在 Job 内部控制并发、自定义锁策略等
- **两者结合**：`onOneServer()` 负责调度层去重，`Cache::lock()` 负责业务层防重

## 10. 生产环境最佳实践与监控

### 10.1 Redis 高可用配置

生产环境中，Redis 必须部署为高可用架构：

```php
// 使用 Redis Sentinel 配置
'redis' => [
    'client' => 'predis',
    'sentinel' => [
        'host' => env('REDIS_SENTINEL_HOST', '127.0.0.1'),
        'port' => env('REDIS_SENTINEL_PORT', 26379),
        'service' => env('REDIS_SENTINEL_SERVICE', 'mymaster'),
    ],
],
```

### 10.2 监控方案

**1. Redis 连接状态监控**

```php
// 在 HealthCheck 中添加 Redis 状态检查
use Illuminate\Support\Facades\Redis;

class RedisHealthCheck
{
    public function check(): array
    {
        try {
            $start = microtime(true);
            Redis::ping();
            $latency = (microtime(true) - $start) * 1000;

            return [
                'redis' => [
                    'status' => 'up',
                    'latency_ms' => round($latency, 2),
                ],
            ];
        } catch (\Exception $e) {
            return [
                'redis' => [
                    'status' => 'down',
                    'error' => $e->getMessage(),
                ],
            ];
        }
    }
}
```

**2. 任务执行日志**

```php
// 监控任务是否因锁竞争被跳过
Schedule::job(new CriticalTask)
    ->daily()
    ->onOneServer()
    ->before(function () {
        Log::info('CriticalTask: acquired lock and starting execution');
    })
    ->after(function () {
        Log::info('CriticalTask: execution completed, releasing lock');
    })
    ->onFailure(function ($e) {
        Log::error('CriticalTask: execution failed', ['error' => $e->getMessage()]);
    });
```

**3. Redis 键监控**

定期检查调度锁相关的 Redis 键，确保没有异常残留：

```bash
# 检查所有调度锁
redis-cli KEYS "laravel:framework/schedule/*"

# 检查锁的 TTL
redis-cli TTL "laravel:framework/schedule/[your-lock-key]"
```

### 10.3 运维建议

**1. 锁过期时间的运维调整**

在任务变更（如增加处理数据量）时，同步调整锁过期时间：

```php
// 根据环境动态设置过期时间
$scheduleExpiration = env('SCHEDULE_MUTEX_EXPIRATION', 3600);

// 在 Kernel.php 中注册 Mutex
$this->app->bind(
    \Illuminate\Scheduling\Mutex\Mutex::class,
    fn ($app) => new RedisMutex($app['cache']->driver(), $scheduleExpiration)
);
```

**2. Redis 内存监控**

锁 Key 通常很少，但如果有任务异常未释放锁（如进程被 kill），可能导致 Key 累积。定期检查：

```bash
# 查看 Redis 内存使用
redis-cli INFO memory

# 查看调度锁数量
redis-cli KEYS "laravel:framework/schedule/*" | wc -l
```

**3. 部署时的注意事项**

- **滚动更新**：确保新版本部署时，旧 Pod 的任务已经完成或锁已过期
- **优雅停机**：在 Pod 关闭时，确保当前执行的任务能完成或安全中断
- **Redis 预热**：新环境启动前，确保 Redis 连接正常

```php
// 在 app/Console/Kernel.php 中添加优雅停机处理
protected function shutdownStatus()
{
    // 等待当前任务完成
    if ($this->app->runningInConsole()) {
        pcntl_signal(SIGTERM, function () {
            $this->scheduler->shutdownGracefully();
        });
    }
}
```

### 10.4 完整的生产配置示例

```php
// app/Console/Kernel.php
use Illuminate\Scheduling\Mutex\RedisMutex;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        // 所有需要跨实例去重的任务，使用 onOneServer()
        $schedule->job(new DailyReport)
            ->dailyAt('06:00')
            ->onOneServer();

        $schedule->job(new PaymentReconciliation)
            ->dailyAt('00:30')
            ->onOneServer()
            ->runInBackground();

        $schedule->job(new SendNewsletter)
            ->weekly()
            ->onOneServer()
            ->runInBackground();

        // 不需要去重的任务
        $schedule->job(new CacheWarmup)
            ->everyFiveMinutes();

        $schedule->command('model:prune')
            ->daily();
    }

    protected function registerCallbacks(): void
    {
        // 自定义 Mutex 配置
        $this->app->bind(
            \Illuminate\Scheduling\Mutex\Mutex::class,
            fn ($app) => new RedisMutex($app['cache']->driver(), 7200)
        );
    }
}
```

## 11. 测试与验证

### 11.1 单元测试 onOneServer

编写测试验证 `onOneServer()` 的锁行为：

```php
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Cache;

class OnOneServerTest extends TestCase
{
    public function test_task_acquires_mutex_lock()
    {
        // 模拟 Redis 缓存驱动
        Cache::shouldReceive('lock')
            ->once()
            ->with(
                $this->stringContains('framework/schedule/'),
                3600
            )
            ->andReturn($mockLock = Mockery::mock());

        $mockLock->shouldReceive('get')->once()->andReturn(true);
        $mockLock->shouldReceive('forceDelete')->once();

        Schedule::job(new TestJob)->hourly()->onOneServer();

        $this->artisan('schedule:run');
    }

    public function test_task_is_skipped_when_lock_acquired_elsewhere()
    {
        Cache::shouldReceive('lock')
            ->once()
            ->andReturn($mockLock = Mockery::mock());

        // 锁已被其他实例持有
        $mockLock->shouldReceive('get')->once()->andReturn(false);

        $executed = false;
        Schedule::call(function () use (&$executed) {
            $executed = true;
        })->hourly()->onOneServer();

        $this->artisan('schedule:run');
        $this->assertFalse($executed);
    }
}
```

### 11.2 集成测试：多实例模拟

在测试环境中模拟多个实例同时触发：

```bash
# 终端 1：模拟实例 A
php artisan schedule:run &

# 终端 2：模拟实例 B（几乎同时）
php artisan schedule:run &

# 终端 3：模拟实例 C
php artisan schedule:run &

# 等待所有任务完成
wait

# 检查数据库，确认任务只执行了一次
php artisan tinker --execute="
echo App\Models\Report::count() . PHP_EOL;
// 应该输出 1
"
```

### 11.3 持续集成中的验证

在 CI/CD 管道中添加调度配置的静态检查：

```yaml
# .github/workflows/test.yml
- name: Verify onOneServer tasks have Redis
  run: |
    # 确认 onOneServer 的任务使用了正确的 Redis 配置
    php artisan tinker --execute="
      \$config = config('cache.default');
      if (\$config !== 'redis') {
          echo 'WARNING: Cache driver is ' . \$config . ', onOneServer requires redis' . PHP_EOL;
          exit(1);
      }
      echo 'Cache driver is redis - OK' . PHP_EOL;
    "
```

## 12. 总结

### 12.1 核心知识点回顾

1. **问题根源**：多实例部署下，每个实例独立运行 `schedule:run`，导致任务重复执行
2. **解决方案**：`onOneServer()` 方法通过 Redis 互斥锁实现全局任务去重
3. **底层原理**：`SET key value NX EX timeout` 原子操作保证只有一个实例获取锁
4. **锁生命周期**：`lock_for()` 获取锁 → 执行任务 → `unlock()` 释放锁
5. **失败处理**：Redis 宕机时任务不会执行，需要配合高可用架构

### 12.2 架构决策指南

```
是否需要多实例部署？
├── 否 → 不需要 onOneServer()
└── 是 → 所有定时任务是否需要去重？
    ├── 是 → 使用 onOneServer()
    │       ├── 是否需要业务级并发控制？
    │       │   ├── 是 → 额外使用 Cache::lock()
    │       │   └── 否 → onOneServer() 足够
    │       └── 是否需要防重叠？
    │           ├── 是 → 组合使用 withoutOverlapping()
    │           └── 否 → 仅 onOneServer() 即可
    └── 否 → 仅需要单机防重叠 → 使用 withoutOverlapping()
```

### 11.3 一句话总结

`onOneServer()` 的本质是**在调度器层面，利用 Redis 的原子操作实现了一个分布式互斥锁**。它将「哪个实例来执行」的决策从「谁能抢到锁」变成了一个原子级别的竞争——无论你部署了多少个实例，只要 Redis 是唯一的，锁就是唯一的，任务就只会执行一次。

这就是 Laravel 框架设计的优雅之处：用一个简洁的 API 方法，封装了分布式系统中最核心的互斥原语，让开发者无需理解 Redlock 算法的细节，也能轻松实现多实例环境下的任务去重。

---

> **延伸阅读**：
> - [Laravel 官方文档 - Task Scheduling](https://laravel.com/docs/scheduling)
> - [Laravel 官方文档 - Cache Locks](https://laravel.com/docs/cache#atomic-locks)
> - [Redis SET 命令文档](https://redis.io/commands/set/)
> - [Martin Kleppmann - Redlock 算法分析](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)

## 相关阅读

- [Laravel Task Scheduling 深度实战：多服务器调度、分布式锁、任务分片与监控告警](/post/laravel-task-scheduling/) — 从单机 Cron 到分布式调度的完整解决方案，涵盖 Leader Election 高可用选主、任务分片内存优化、Prometheus/Grafana 监控告警集成等高级话题。
- [分布式锁深度对比：Redis Redlock vs Zookeeper vs etcd](/post/laravel-redis-distributedlockguide/) — 全面对比三大分布式锁方案的 CAP 定位、一致性模型与性能基准，附 PHP 实战代码与生产环境踩坑案例。
- [Laravel Scheduled Closure 实战：任务调度的可测试性设计](/post/laravel-scheduled-closure-testability-scheduler-unit-test/) — 剖析 Scheduler 闭包任务的可测试性缺陷，手把手教你重构为可单元测试的 Artisan Command 与 Invokable Class。
