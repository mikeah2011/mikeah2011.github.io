---
title: 'Laravel Scheduled Closure 实战：任务调度的可测试性设计——如何对 Scheduler 中的闭包任务写单元测试'
date: 2026-06-06 10:30:00
tags: [Laravel, Scheduler, Closure, Unit Test, Task Scheduling, PHPUnit]
keywords: [Laravel Scheduled Closure, Scheduler, 任务调度的可测试性设计, 如何对, 中的闭包任务写单元测试, PHP]
description: 深入剖析 Laravel Scheduler 中闭包任务的三大可测试性缺陷——隐式依赖、无法 Mock、时间耦合。手把手教你将不可测试闭包重构为 Artisan Command、Invokable Class 和 Service 层，配合 Carbon::setTestNow()、Http::fake() 等测试技巧，附完整 PHPUnit 单元测试与集成测试代码，让你的定时任务从此告别 flaky test。
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


## 引言：为什么 Scheduler 中的闭包难以测试

在 Laravel 项目中，任务调度是日常开发中极为常见的功能。每隔一段时间执行某个任务——清理过期缓存、发送日报邮件、同步第三方数据、生成报表——这些场景几乎在每个后端系统中都会出现。Laravel 提供了极为优雅的 `Schedule` API，允许开发者在 `Kernel::schedule()` 方法或者 `routes/console.php` 文件中通过闭包快速定义调度任务。这种设计的初衷是降低使用门槛，让开发者用最少的代码完成定时任务的注册。

然而，当团队开始重视代码质量、引入单元测试和持续集成时，这些曾经"方便快捷"的闭包调度任务却变成了测试的噩梦。很多团队在 CI 流水线中面对这些闭包任务时束手无策——要么选择跳过不测，要么被迫编写又慢又脆弱的集成测试。问题的根源在于闭包的三个核心缺陷：

**第一，闭包隐式依赖。** 闭包是一段匿名函数，其内部直接调用 `DB::table()`、`Http::get()`、`Mail::to()` 等 Facade 或全局静态方法。这些依赖关系没有通过构造函数或方法参数显式声明，外部测试代码无法注入 mock 对象。你不知道这段闭包到底依赖了哪些服务，直到它在测试环境中因某个外部服务不可用而报错。

**第二，无法被独立 mock 和隔离。** 闭包作为匿名函数，无法被独立实例化，也无法通过接口进行抽象替换。测试时只能将整段闭包完整执行，这意味着你无法单独测试"数据库查询"这一部分而跳过"HTTP 通知"那一部分。所有逻辑耦合在一起，一个环节出问题整个测试就失败。

**第三，时间耦合严重。** 调度任务天然与时间相关——"每天凌晨两点执行"、"每隔十五分钟同步一次"。如果闭包内部直接调用 `Carbon::now()` 来判断时间窗口，那么测试就需要精确地模拟当前时间。一旦时间控制不当，测试就会出现"有时通过、有时失败"的 flaky test 问题。

本文将深入探讨如何对 Laravel Scheduler 中的闭包任务进行可测试性重构，并提供完整的单元测试方案。我们以 Laravel 12.x 为主要参考版本，但文中所讨论的重构策略和测试技巧适用于 Laravel 9.x 及以上的所有版本。无论你是正在维护一个大量使用闭包调度的遗留项目，还是正在规划一个新项目的调度任务架构，这篇文章都能为你提供实用的指导。

---

## Laravel Schedule 体系回顾

在深入具体的可测试性问题之前，我们有必要完整回顾 Laravel 调度系统的核心架构和执行链路，这将帮助我们理解为什么闭包测试如此困难。

### 传统方式：Kernel::schedule()

在 Laravel 10.x 及更早版本中，调度任务统一定义在 `App\Console\Kernel` 类的 `schedule()` 方法中。这个方法接收一个 `Schedule` 实例作为参数，开发者在其中注册各种定时任务：

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule)
{
    $schedule->call(function () {
        DB::table('recent_logs')->where('created_at', '<', now()->subDays(7))->delete();
    })->daily();

    $schedule->command('telescope:prune')->daily();

    $schedule->job(new SyncUserAvatar)->hourly();
}
```

这里 `Schedule` 实例支持三种任务类型：`call()` 接受闭包、`command()` 接受 Artisan 命令名、`job()` 接受队列 Job 实例。三种类型中，闭包是最灵活的——你可以往里面写任何 PHP 代码——但也是最难测试的，因为它本质上是一段无法被外部引用的匿名函数。

### 12.x 新 API：Route-like 声明方式

Laravel 12.x 对调度 API 进行了现代化改进，引入了类似路由注册的声明方式。调度任务可以直接定义在 `routes/console.php` 文件中，不再需要继承 Kernel 类：

```php
use Illuminate\Support\Facades\Schedule;

Schedule::call(function () {
    // 业务逻辑
})->daily()->name('cleanup-old-logs');

Schedule::command('app:sync-avatar')->hourly();
Schedule::job(new SyncUserAvatar)->everyThirtyMinutes();
```

这种新写法将调度定义从 Kernel 类中彻底解耦出来，放在独立的路由文件中，代码更加简洁清晰。同时新增了 `name()` 方法为每个调度事件命名，便于调试和监控。但无论新旧 API，闭包任务的可测试性问题本质相同——核心难点不在于注册方式，而在于闭包本身的匿名性和隐式依赖。

### 调度执行链路分析

理解调度系统的执行链路，有助于我们找到测试的最佳切入点。整个执行流程可以概括为四个层级：

1. **Schedule 层**：`Illuminate\Console\Scheduling\Schedule` 是调度注册中心，持有所有 `Event` 实例
2. **Event 层**：每个 `Schedule::call()` 返回一个 `Event` 实例，`Event` 持有闭包引用、频率约束（如 `daily()`、`everyFifteenMinutes()`）、条件约束（如 `when()`、`skip()`）
3. **判断层**：调度器运行时，依次检查每个 `Event` 的时间约束是否满足（`isDue()` 方法）
4. **执行层**：满足条件的 `Event` 调用 `run()` 方法，执行内部的闭包、命令或 Job

其中最关键的观察是：**闭包逻辑被深埋在 Event 的 `run()` 方法内部，外部代码无法直接引用或替换它。** 这就是闭包难以测试的根本原因。如果你能将闭包内的逻辑提取为一个独立的、可实例化的对象，那么测试问题就迎刃而解。

---

## 问题复现：一个典型的不可测试闭包

让我们构造一个真实场景中非常常见的、完全不可测试的闭包调度任务。假设我们的电商系统需要每天凌晨清理超过 30 天未支付的订单，同时通过外部 API 通知相关用户：

```php
// routes/console.php 或 Kernel::schedule()
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;

Schedule::call(function () {
    $expiredOrders = DB::table('orders')
        ->where('status', 'unpaid')
        ->where('created_at', '<', now()->subDays(30))
        ->get();

    foreach ($expiredOrders as $order) {
        DB::table('orders')
            ->where('id', $order->id)
            ->update(['status' => 'expired', 'expired_at' => now()]);

        Http::post('https://api.example.com/notify', [
            'user_id' => $order->user_id,
            'message' => "您的订单 {$order->order_no} 已过期",
        ]);
    }

    Log::info("清理过期订单完成，共处理 {$expiredOrders->count()} 条");
})->dailyAt('02:00')->name('cleanup-expired-orders');
```

这段代码在功能层面完全正确，但仔细分析后会发现它包含了所有典型的可测试性问题：

- **直接依赖 DB Facade**：闭包内部直接使用 `DB::table()` 进行查询和更新操作，无法在不连接数据库的情况下测试。如果使用真实数据库做测试，就需要在测试前准备种子数据，测试后清理数据，执行速度慢且容易受环境影响。
- **`Carbon::now()` 时间耦合**：`now()->subDays(30)` 这行代码意味着查询结果完全取决于当前时间。在 CI 环境中，不同时间运行测试可能得到不同结果。
- **`Http::post()` 外部 API 调用**：测试不应依赖外部服务的可用性。如果第三方 API 偶尔超时或下线，你的单元测试就会莫名其妙地失败，这种 flaky test 会严重破坏团队对测试套件的信任。
- **`Log::info()` 日志输出**：虽然日志记录看起来无害，但如果需要断言日志是否正确记录，就必须拦截日志通道，增加了测试复杂度。
- **所有逻辑耦合在一起**：数据查询、状态更新、外部通知、日志记录全部写在一个闭包中，无法单独测试任何一个环节。你想测试"查询逻辑是否正确"，就必须同时执行"更新逻辑"和"通知逻辑"。

如果直接为这段闭包编写测试，你需要：启动测试数据库并执行迁移、插入多种种子数据、冻结当前时间、拦截 HTTP 请求、捕获日志输出——这已经不是单元测试，而是一个重量级的端到端集成测试。更糟糕的是，闭包无法被独立实例化，你甚至无法在不触发整个调度器的情况下单独测试它。

---

## 重构策略一：闭包转化为 Artisan Command

将闭包逻辑封装为 Artisan 命令，是最直接也最符合 Laravel 社区惯例的重构方式。Laravel 官方文档明确推荐使用 Command 来组织调度任务。这个策略的核心思想是：闭包本身只是一个匿名函数，无法被外部引用和测试；而 Artisan Command 是一个正式的类，拥有明确的类名、命名空间、构造函数和方法签名，天然具备可测试性。从代码组织的角度看，Command 还提供了参数定义（`$signature`）、描述信息（`$description`）和输出能力（`$this->info()`），使得任务不仅是可测试的，更是可运维的。
值得注意的是，将业务逻辑放在 Command 的 `handle()` 方法中并不是最佳实践。更推荐的做法是让 Command 作为薄薄的"入口层"，仅负责解析参数和输出结果，真正的业务逻辑委托给注入的 Service 类。这样做的好处是：Service 可以被其他入口（HTTP Controller、队列 Job）复用，而 Command 只是众多入口中的一个。

### 创建 Command 类

```php
// app/Console/Commands/CleanupExpiredOrders.php
namespace App\Console\Commands;

use App\Services\OrderCleanupService;
use Illuminate\Console\Command;

class CleanupExpiredOrders extends Command
{
    protected $signature = 'orders:cleanup-expired 
                            {--days=30 : 过期天数阈值}';
    protected $description = '清理超过指定天数的未支付订单';

    public function handle(OrderCleanupService $service): int
    {
        $days = (int) $this->option('days');
        $count = $service->cleanup($days);

        $this->info("清理过期订单完成，共处理 {$count} 条");
        return self::SUCCESS;
    }
}
```

这个 Command 类做了几件重要的事情：它通过 `$signature` 定义了命令名称和参数，使得任务可以通过命令行手动执行；它通过依赖注入接收 `OrderCleanupService`，将业务逻辑委托给 Service；它通过 `$this->info()` 输出执行结果，方便运维人员查看。

### 调度定义随之简化

```php
// routes/console.php
Schedule::command('orders:cleanup-expired --days=30')
    ->dailyAt('02:00')
    ->name('cleanup-expired-orders');
```

调度注册代码从一大段闭包缩减为一行，清晰明了。

### 测试 Command

Command 是一个普通的 PHP 类，天然可测试。Laravel 还提供了 `$this->artisan()` 测试辅助方法：

```php
namespace Tests\Unit\Console\Commands;

use App\Services\OrderCleanupService;
use Tests\TestCase;

class CleanupExpiredOrdersTest extends TestCase
{
    public function test_handle_returns_success(): void
    {
        $service = $this->createMock(OrderCleanupService::class);
        $service->expects($this->once())
            ->method('cleanup')
            ->with(30)
            ->willReturn(5);

        $this->app->instance(OrderCleanupService::class, $service);

        $this->artisan('orders:cleanup-expired')
            ->assertExitCode(0)
            ->expectsOutput('清理过期订单完成，共处理 5 条');
    }

    public function test_handle_respects_custom_days(): void
    {
        $service = $this->createMock(OrderCleanupService::class);
        $service->expects($this->once())
            ->method('cleanup')
            ->with(7)
            ->willReturn(12);

        $this->app->instance(OrderCleanupService::class, $service);

        $this->artisan('orders:cleanup-expired', ['--days' => 7])
            ->assertExitCode(0);
    }
}
```

**Command 模式的优势**：拥有完整的 Laravel 测试支持，支持参数传递，支持手动执行，适合需要命令行交互的场景。**不足之处**在于：如果闭包逻辑非常简单，创建一个完整的 Command 类显得有些重量级。

---

## 重构策略二：闭包转化为 Invokable Class

如果你不想使用 Command 的形式（不需要命令行参数和输出），另一个优雅的方式是将闭包转化为 Invokable Class——一个实现了 `__invoke()` 方法的类。这种模式在 Laravel 生态中越来越流行，尤其适用于纯业务逻辑的封装。所谓 Invokable Class，本质上就是一个"可以被当作函数调用的对象"。PHP 的 `__invoke()` 魔术方法使得对象可以像函数一样被调用，这种设计模式完美地桥接了"闭包的简洁性"和"类的可测试性"。与 Command 相比，Invokable Class 更加轻量，它不需要继承任何基类，也不需要定义 `$signature` 和 `$description`，因此非常适合那些不需要命令行交互的纯后台任务。

### 创建 Invokable 类

```php
// app/ScheduleTasks/CleanupExpiredOrders.php
namespace App\ScheduleTasks;

use App\Services\OrderCleanupService;

class CleanupExpiredOrders
{
    public function __construct(
        private readonly OrderCleanupService $service,
    ) {}

    public function __invoke(): int
    {
        return $this->service->cleanup(days: 30);
    }
}
```

这个类非常简洁，只有一个构造函数和一个 `__invoke()` 方法。构造函数通过 PHP 8 的构造函数注入语法声明了对 `OrderCleanupService` 的依赖，`__invoke()` 方法则是任务的入口。

### 调度定义

```php
// routes/console.php
use App\ScheduleTasks\CleanupExpiredOrders;

Schedule::call(CleanupExpiredOrders::class)->dailyAt('02:00');
```

Laravel 的 `Schedule::call()` 方法内部会自动判断：如果传入的是一个类名字符串且该类实现了 `__invoke()`，则通过容器解析并执行。这意味着依赖注入完全透明，开发者无需手动实例化。

### 测试 Invokable Class

```php
namespace Tests\Unit\ScheduleTasks;

use App\ScheduleTasks\CleanupExpiredOrders;
use App\Services\OrderCleanupService;
use Tests\TestCase;

class CleanupExpiredOrdersTest extends TestCase
{
    public function test_invoke_delegates_to_service(): void
    {
        $service = $this->createMock(OrderCleanupService::class);
        $service->expects($this->once())
            ->method('cleanup')
            ->with(30)
            ->willReturn(8);

        $this->app->instance(OrderCleanupService::class, $service);

        $task = app(CleanupExpiredOrders::class);
        $result = $task();

        $this->assertEquals(8, $result);
    }
}
```

测试非常简洁：通过容器解析出任务实例，调用 `__invoke()`，断言返回值。整个过程不需要数据库、不需要 HTTP、不需要时间冻结。

**Invokable Class 的优势**：比 Command 更轻量，专注于逻辑执行；类可以被独立实例化和测试；支持依赖注入。**不足之处**在于：没有命令行参数和输出能力，不适合需要手动执行的场景。

---

## 重构策略三：从闭包中提取 Service 层

第三种策略是最根本的解决方案：从闭包中提取核心业务逻辑到独立的 Service 类，闭包本身只保留极简的调度入口。这种做法遵循了 SOLID 原则中的单一职责原则和依赖倒置原则，是生产环境最推荐的架构模式。

### 定义接口契约

首先，我们需要定义业务逻辑所依赖的接口。这些接口作为抽象层，使得 Service 不直接依赖于具体的 Eloquent 模型或 HTTP 客户端：

```php
// app/Contracts/OrderRepositoryInterface.php
namespace App\Contracts;

use App\Models\Order;
use Carbon\Carbon;
use Illuminate\Support\Collection;

interface OrderRepositoryInterface
{
    public function findExpiredUnpaidOrders(Carbon $threshold): Collection;
    public function markAsExpired(Order $order): void;
}

// app/Contracts/NotificationServiceInterface.php
namespace App\Contracts;

interface NotificationServiceInterface
{
    public function notifyUser(int $userId, string $message): void;
}
```

接口的定义至关重要——它是实现依赖倒置的关键。通过接口，Service 类只依赖于抽象，而不依赖于具体实现。测试时，我们可以轻松替换为 mock 实现。

### 实现 Service 类

```php
// app/Services/OrderCleanupService.php
namespace App\Services;

use App\Contracts\NotificationServiceInterface;
use App\Contracts\OrderRepositoryInterface;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

class OrderCleanupService
{
    public function __construct(
        private readonly OrderRepositoryInterface $orderRepo,
        private readonly NotificationServiceInterface $notificationService,
    ) {}

    public function cleanup(int $days = 30): int
    {
        $threshold = Carbon::now()->subDays($days);
        $expiredOrders = $this->orderRepo->findExpiredUnpaidOrders($threshold);

        $count = 0;
        foreach ($expiredOrders as $order) {
            $this->orderRepo->markAsExpired($order);
            $this->notificationService->notifyUser(
                $order->user_id,
                "您的订单 {$order->order_no} 已过期"
            );
            $count++;
        }

        Log::info("清理过期订单完成，共处理 {$count} 条");
        return $count;
    }
}
```

注意这个 Service 的几个设计要点：所有依赖通过构造函数注入，没有直接引用 Facade（`Log` 是唯一例外，但也可以通过注入 Logger 接口替换）；`cleanup()` 方法返回处理数量，方便调用方获取执行结果；时间判断使用 `Carbon::now()`，测试时可以通过 `Carbon::setTestNow()` 冻结。

### 闭包入口保持极简

```php
Schedule::call(function (OrderCleanupService $service) {
    $service->cleanup(days: 30);
})->dailyAt('02:00');
```

或者使用 Invokable Class 包装。无论哪种方式，闭包内不再包含任何业务逻辑，只负责调用 Service 方法。

### 测试 Service

```php
namespace Tests\Unit\Services;

use App\Contracts\NotificationServiceInterface;
use App\Contracts\OrderRepositoryInterface;
use App\Models\Order;
use App\Services\OrderCleanupService;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Tests\TestCase;

class OrderCleanupServiceTest extends TestCase
{
    private OrderCleanupService $service;
    private $orderRepo;
    private $notificationService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->orderRepo = $this->createMock(OrderRepositoryInterface::class);
        $this->notificationService = $this->createMock(NotificationServiceInterface::class);

        $this->app->instance(OrderRepositoryInterface::class, $this->orderRepo);
        $this->app->instance(NotificationServiceInterface::class, $this->notificationService);

        $this->service = app(OrderCleanupService::class);
    }

    public function test_cleanup_processes_expired_orders(): void
    {
        Carbon::setTestNow('2026-06-06 00:00:00');

        $order1 = new Order(['id' => 1, 'order_no' => 'ORD001', 'user_id' => 100]);
        $order2 = new Order(['id' => 2, 'order_no' => 'ORD002', 'user_id' => 200]);

        $this->orderRepo->expects($this->once())
            ->method('findExpiredUnpaidOrders')
            ->willReturn(new Collection([$order1, $order2]));

        $this->orderRepo->expects($this->exactly(2))
            ->method('markAsExpired');

        $this->notificationService->expects($this->exactly(2))
            ->method('notifyUser');

        $count = $this->service->cleanup(30);

        $this->assertEquals(2, $count);
        Carbon::setTestNow();
    }

    public function test_cleanup_returns_zero_when_no_expired_orders(): void
    {
        $this->orderRepo->method('findExpiredUnpaidOrders')
            ->willReturn(new Collection());

        $this->orderRepo->expects($this->never())
            ->method('markAsExpired');

        $count = $this->service->cleanup(30);
        $this->assertEquals(0, $count);
    }

    public function test_cleanup_sends_correct_notification_message(): void
    {
        Carbon::setTestNow('2026-06-06');

        $order = new Order(['id' => 1, 'order_no' => 'ORD-9527', 'user_id' => 42]);
        $this->orderRepo->method('findExpiredUnpaidOrders')
            ->willReturn(new Collection([$order]));

        $this->notificationService->expects($this->once())
            ->method('notifyUser')
            ->with(42, '您的订单 ORD-9527 已过期');

        $this->service->cleanup(30);
        Carbon::setTestNow();
    }
}
```

**这是最推荐的策略。** 它遵循了依赖倒置原则，Service 依赖于接口而非具体实现，测试时可以轻松注入 mock。业务逻辑与调度框架完全解耦，即使将来从 Laravel 迁移到其他框架，Service 层代码也无需修改。同时，Service 可以被 HTTP Controller、队列 Job、测试脚本等多个入口复用，极大提高了代码的可维护性。

---

## 三种重构策略对比

在深入具体测试技巧之前，先用一张表格对比三种重构策略的核心差异，帮助你快速决策：

| 维度 | 闭包（原始） | Artisan Command | Invokable Class | Service 层 |
|------|-------------|-----------------|-----------------|------------|
| **可测试性** | ❌ 几乎不可测 | ✅ 支持 `$this->artisan()` | ✅ 直接实例化测试 | ✅✅ 纯单元测试 |
| **依赖注入** | ❌ 隐式依赖 | ✅ 构造函数注入 | ✅ 构造函数注入 | ✅✅ 接口注入 |
| **命令行参数** | ❌ 不支持 | ✅ `$signature` 定义 | ❌ 不支持 | ❌ 不支持 |
| **执行输出** | ❌ 无 | ✅ `$this->info()` | ❌ 无 | ❌ 无 |
| **手动触发** | ❌ 必须通过调度器 | ✅ `php artisan xxx` | ❌ 需调用容器 | ✅ 需调用容器 |
| **代码量** | 最少 | 中等（需 `handle()`） | 最少（仅 `__invoke()`） | 较多（需接口+实现） |
| **适合场景** | 一次性临时任务 | 需参数/输出的任务 | 简单后台逻辑 | 复杂业务逻辑 |
| **长期维护** | ❌ 差 | ✅ 好 | ✅ 好 | ✅✅ 最佳 |

> **决策建议**：生产项目推荐 **Command + Service** 组合——Command 负责参数解析和输出，Service 负责业务逻辑。两者各司其职，测试覆盖全面且执行速度快。

---

## 测试技巧详解

除了上述重构策略外，掌握一些核心的测试技巧对于编写高质量的调度任务测试至关重要。很多开发者在完成重构后，面对测试代码仍然感到无从下手——如何模拟时间流逝？如何验证调度任务确实被注册？如何在不启动整个调度器的情况下测试单个任务？下面我们将逐一解答这些常见问题。

### Carbon::setTestNow() 时间冻结

调度任务与时间紧密相关，时间控制是测试中的核心能力。`Carbon::setTestNow()` 是 Carbon 库提供的时间冻结功能，调用后所有 `Carbon::now()` 和 `now()` 都会返回指定的时间，而非真实时间：

```php
public function test_order_expired_after_30_days(): void
{
    Carbon::setTestNow('2026-06-06 02:00:00');

    // 此时 now() 返回 2026-06-06 02:00:00
    // now()->subDays(30) 返回 2026-05-07 02:00:00
    // 所有创建早于 5月7日 的订单都会被标记为过期

    $this->service->cleanup(30);
    // ... 断言 ...

    Carbon::setTestNow(); // 清除冻结时间，恢复正常使用
}
```

重要提醒：必须在测试结束后清除冻结时间，否则会影响后续测试。最佳实践是在 `tearDown()` 方法中清除，或者使用 Laravel 提供的 `travelTo()` 方法：

```php
public function test_with_travel(): void
{
    $this->travelTo('2026-06-06 02:00:00', function () {
        // 在此闭包内，时间被冻结
        $count = $this->service->cleanup(30);
        $this->assertEquals(3, $count);
    });
    // travelTo 会自动恢复时间
}
```

`travelTo()` 方法会在闭包执行完毕后自动恢复时间，无需手动清除，代码更加安全和简洁。

### 验证调度事件是否正确注册

有时候你需要测试的不是业务逻辑本身，而是调度注册是否正确——某个任务是否确实被注册到了调度器中，频率是否正确。可以这样实现：

```php
namespace Tests\Unit\Console;

use Illuminate\Console\Scheduling\Schedule;
use Tests\TestCase;

class KernelScheduleTest extends TestCase
{
    public function test_cleanup_expired_orders_is_scheduled(): void
    {
        $schedule = $this->app->make(Schedule::class);
        $events = $schedule->events();

        $cleanupEvent = collect($events)->first(function ($event) {
            return str_contains($event->description ?? '', 'cleanup-expired-orders')
                || str_contains($event->command ?? '', 'orders:cleanup-expired');
        });

        $this->assertNotNull($cleanupEvent, '清理过期订单任务未注册到调度器');
    }
}
```

### 调度事件的集成测试

如果你想验证调度事件在指定时间点确实会被触发，可以手动调用 `Event::run()` 方法：

```php
public function test_scheduled_event_executes_successfully(): void
{
    // 注册所有调度事件
    $schedule = $this->app->make(Schedule::class);

    $event = collect($schedule->events())->first(function ($event) {
        return str_contains($event->command ?? '', 'orders:cleanup-expired');
    });

    $this->assertNotNull($event);

    // 模拟执行该事件
    $event->run($this->app);
    // 如果没有抛出异常，说明执行成功
}
```

### 测试中避免真实外部调用

对于包含 HTTP 调用的代码，使用 Laravel 的 `Http::fake()` 拦截所有外部请求：

```php
use Illuminate\Support\Facades\Http;

public function test_cleanup_sends_notifications(): void
{
    Http::fake([
        'api.example.com/notify' => Http::response(['ok'], 200),
    ]);

    $this->service->cleanup(30);

    Http::assertSentCount(3);
    Http::assertSent(function ($request) {
        return $request->url() === 'https://api.example.com/notify';
    });
}
```

`Http::fake()` 会拦截所有匹配的 HTTP 请求并返回预设响应，避免测试依赖外部服务。`Http::assertSentCount()` 和 `Http::assertSent()` 方法则用于断言是否发送了预期的请求。

---

## 完整实战案例：每日凌晨清理过期订单

现在让我们将上述所有策略整合为一个完整的端到端实战案例。从原始的不可测试闭包出发，逐步重构，最终得到一套完整的、可测试的代码。

### 最终项目结构

```
app/
├── Contracts/
│   ├── OrderRepositoryInterface.php
│   └── NotificationServiceInterface.php
├── Services/
│   └── OrderCleanupService.php
├── Repositories/
│   └── EloquentOrderRepository.php
├── Console/
│   └── Commands/
│       └── CleanupExpiredOrders.php
tests/
├── Unit/
│   ├── Services/
│   │   └── OrderCleanupServiceTest.php
│   └── Console/
│       └── Commands/
│           └── CleanupExpiredOrdersTest.php
└── Feature/
    └── OrderCleanupIntegrationTest.php
```

### Repository 实现

```php
// app/Repositories/EloquentOrderRepository.php
namespace App\Repositories;

use App\Contracts\OrderRepositoryInterface;
use App\Models\Order;
use Carbon\Carbon;
use Illuminate\Support\Collection;

class EloquentOrderRepository implements OrderRepositoryInterface
{
    public function findExpiredUnpaidOrders(Carbon $threshold): Collection
    {
        return Order::where('status', 'unpaid')
            ->where('created_at', '<', $threshold)
            ->get();
    }

    public function markAsExpired(Order $order): void
    {
        $order->update(['status' => 'expired', 'expired_at' => now()]);
    }
}
```

### Service Provider 绑定接口与实现

```php
// app/Providers/AppServiceProvider.php
public function register(): void
{
    $this->app->bind(
        \App\Contracts\OrderRepositoryInterface::class,
        \App\Repositories\EloquentOrderRepository::class
    );
}
```

### 集成测试

集成测试使用真实的数据库和模型，验证整个流程的端到端正确性：

```php
namespace Tests\Feature;

use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class OrderCleanupIntegrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_cleanup_marks_old_orders_as_expired(): void
    {
        Http::fake();
        $user = User::factory()->create();

        // 创建超过 30 天的未支付订单——应被清理
        $oldOrder = Order::factory()->create([
            'user_id' => $user->id,
            'status' => 'unpaid',
            'created_at' => now()->subDays(31),
        ]);

        // 创建未超过 30 天的未支付订单——不应被清理
        $recentOrder = Order::factory()->create([
            'user_id' => $user->id,
            'status' => 'unpaid',
            'created_at' => now()->subDays(10),
        ]);

        // 创建已支付订单——不应被清理
        $paidOrder = Order::factory()->create([
            'user_id' => $user->id,
            'status' => 'paid',
            'created_at' => now()->subDays(60),
        ]);

        $this->artisan('orders:cleanup-expired')->assertExitCode(0);

        $this->assertEquals('expired', $oldOrder->fresh()->status);
        $this->assertNotNull($oldOrder->fresh()->expired_at);
        $this->assertEquals('unpaid', $recentOrder->fresh()->status);
        $this->assertEquals('paid', $paidOrder->fresh()->status);
    }

    public function test_cleanup_sends_notification_for_each_expired_order(): void
    {
        Http::fake();
        $user = User::factory()->create();
        Order::factory()->count(3)->create([
            'user_id' => $user->id,
            'status' => 'unpaid',
            'created_at' => now()->subDays(45),
        ]);

        $this->artisan('orders:cleanup-expired');
        Http::assertSentCount(3);
    }
}
```

集成测试验证了真实场景下的端到端行为：只有满足条件的订单被清理，其他订单不受影响，且每个被清理的订单都会触发通知。配合 `RefreshDatabase` trait，每个测试方法运行前都会重建数据库表结构，确保测试之间互不影响。

---

## 12.x Scheduler 新特性对可测试性的影响

Laravel 12.x 在调度方面引入了一些值得了解的改进，进一步提升了可测试性和开发体验。虽然这些新特性并没有从根本上改变闭包可测试性的难题，但它们为开发者提供了更多的工具和更灵活的选择。了解这些新特性有助于我们在新项目中做出更好的架构决策。

### Schedule::job() 的增强

`Schedule::job()` 现在支持更灵活的 Job 传入方式。由于 Job 本身就是独立的、可实例化的类，天然支持测试：

```php
use App\Jobs\SyncUserAvatar;
Schedule::job(new SyncUserAvatar)->everyFifteenMinutes();
```

Job 的测试无需额外技巧，直接使用 Laravel 的 `Queue::fake()` 和 `Queue::assertPushed()` 即可完成。

### Schedule::call()->name() 命名能力

`name()` 方法的引入是一个重要改进。它为调度事件提供了唯一标识，使得在测试中查找和断言特定事件变得非常方便。在大型项目中，可能有数十个调度事件注册在调度器中，没有名称的话只能通过闭包内容或命令名来查找，非常脆弱。有了 `name()` 方法，可以精确匹配：

```php
Schedule::call(function (OrderCleanupService $service) {
    $service->cleanup();
})->dailyAt('02:00')->name('cleanup-expired-orders');
```

在测试中，通过名称查找事件：

```php
$event = collect($schedule->events())
    ->first(fn ($e) => $e->name === 'cleanup-expired-orders');
$this->assertNotNull($event);
```

### withoutOverlapping 与 onOneServer 的测试

`withoutOverlapping()` 防止同一任务并发执行，`onOneServer()` 在多服务器部署时确保任务只在一台服务器上运行。这些约束条件在测试中也可以验证：

```php
public function test_cleanup_prevents_overlap(): void
{
    $schedule = app(Schedule::class);
    $event = collect($schedule->events())
        ->first(fn ($e) => $e->name === 'cleanup-expired-orders');

    $this->assertNotNull($event->withoutOverlapping);
    $this->assertTrue($event->onOneServer);
}
```

---

## 总结：决策树——何时用闭包、何时提取类

经过以上全面的分析和实战案例，我们可以总结出一个实用的决策树来指导日常开发中的技术选型。在实际项目中，选择哪种重构策略取决于任务的复杂度、团队的技术偏好以及项目的长期维护需求。没有一种方案是万能的，但有一条原则是通用的：**业务逻辑必须与调度框架解耦**。

**适合使用闭包的场景：** 逻辑极其简单，仅一行代码，例如 `Artisan::call('migrate')`；无需单元测试覆盖的临时性或一次性任务；快速原型开发阶段，后续会安排时间重构。即便在这种场景下，也建议为闭包添加 `name()` 标识以便监控。

**适合使用 Artisan Command 的场景：** 需要命令行参数支持，如 `--days=30` 和 `--force`；需要向操作人员输出执行进度和结果信息；任务本身除了定时执行外也需要手动触发；团队整体习惯以 Command 为单位组织调度任务。

**适合使用 Invokable Class 的场景：** 逻辑较复杂但不需要命令行交互能力；希望调度定义保持简洁，不想依赖 Command 的额外基础设施；追求纯单元测试，希望类可以被独立实例化和测试。

**适合使用 Service 层封装的场景（最推荐）：** 业务逻辑复杂，涉及多个外部依赖需要 mock；需要严格的单元测试覆盖；Service 逻辑可能被多个入口复用——HTTP Controller、队列 Job、命令行脚本等；追求长期的可维护性和架构整洁性。

**核心原则回顾：** 调度层只负责"何时执行"，业务层负责"执行什么"。将这两个关注点彻底分离，是实现可测试性的根本方法。无论你选择哪种重构策略，最终目标都是一致的——让业务逻辑可以被独立实例化、独立测试，不受调度框架的约束。

对于正式的生产项目，最推荐采用 **Command + Service** 的组合模式：调度层通过 `Schedule::command()` 注册，仅声明执行频率和约束条件，无需测试覆盖；Command 层负责参数解析和输出格式化，通过 `$this->artisan()` 进行集成测试；Service 层包含全部业务逻辑，通过注入 mock 依赖进行纯单元测试，执行速度快且覆盖全面。

当你再次面对"如何测试 Scheduler 中的闭包"这个问题时，答案始终如一：**不要测试闭包，把它变成一个可测试的类。** 重构的成本远低于维护一堆不可测试代码的长期代价。

---

## 常见踩坑与避坑指南

在实际重构过程中，有几个容易被忽略的陷阱值得特别警惕：

### 陷阱一：忘了清除 `Carbon::setTestNow()`

这是最隐蔽的 bug——在 `setUp()` 中冻结了时间，但忘了在 `tearDown()` 中恢复，导致后续测试全部在"假时间"下运行：

```php
// ❌ 错误示范：忘了恢复时间
protected function setUp(): void
{
    parent::setUp();
    Carbon::setTestNow('2026-06-06 02:00:00');
}

// ✅ 正确做法：配对使用，或用 travelTo()
protected function setUp(): void
{
    parent::setUp();
    Carbon::setTestNow('2026-06-06 02:00:00');
}

protected function tearDown(): void
{
    Carbon::setTestNow(); // 恢复真实时间
    parent::tearDown();
}
```

### 陷阱二：闭包中使用 `DB::transaction()` 导致测试事务冲突

当闭包内部开了事务，而测试也用了 `RefreshDatabase`（内部也使用事务），两层事务嵌套会导致死锁或数据不一致：

```php
// ❌ 闭包中直接开事务
Schedule::call(function () {
    DB::transaction(function () {
        // 复杂业务逻辑...
    });
});

// ✅ 将事务管理下沉到 Service 层
class OrderCleanupService
{
    public function cleanup(int $days = 30): int
    {
        return DB::transaction(fn () => $this->doCleanup($days));
    }
}
```

### 陷阱三：`Http::fake()` 漏掉 URL 导致真实请求泄露

`Http::fake()` 默认拦截所有请求，但如果你使用了 `Http::fake([pattern => response])` 的映射模式，未匹配的 URL 仍会发出真实请求：

```php
// ❌ 仅 mock 了一个 URL，其他请求会真正发出去
Http::fake([
    'api.example.com/notify' => Http::response(['ok'], 200),
]);

// ✅ 兜底方案：先 fake 再设置映射
Http::fake(); // 拦截所有请求
Http::fake([
    'api.example.com/notify' => Http::response(['ok'], 200),
]);
```

### 陷阱四：Invokable Class 传给 `Schedule::call()` 时忘了用类名

Laravel 的 `Schedule::call()` 支持传入类名字符串来自动解析 Invokable Class，但很多人习惯传入 `new` 出来的实例，导致依赖注入不走容器：

```php
// ❌ 手动实例化，绕过了容器的依赖注入
Schedule::call(new CleanupExpiredOrders(app(OrderCleanupService::class)));

// ✅ 传入类名，由 Laravel 容器自动解析
Schedule::call(CleanupExpiredOrders::class);
```

---

## 相关阅读

- [Laravel Service Container 源码剖析：上下文绑定、标签、build 方法的解析链路——从 IoC 到 DI 的设计哲学](/PHP/Laravel/Laravel-Service-Container-源码剖析-上下文绑定-tags-build解析链路/) — 理解容器依赖注入的底层机制，有助于编写更高质量的可测试代码
- [PHP 多进程实战：pcntl_fork + 信号处理——替代 Supervisor 的 PHP 原生进程管理与 Laravel 命令并发执行](/PHP/2026-06-06-PHP-多进程实战-pcntl_fork-信号处理-替代Supervisor的PHP原生进程管理与Laravel命令并发执行/) — 当你的定时任务需要并发执行时，了解多进程管理的最佳实践
- [Laravel Pipeline 源码剖析：闭包洋葱模型——对比 Symfony Pipeline 与 Java Filter Chain 的中间件栈实现](/PHP/Laravel/2026-06-05-laravel-pipeline-source-closure-onion-model/) — 深入理解 Laravel 中闭包的另一种经典用法——Pipeline 模式
