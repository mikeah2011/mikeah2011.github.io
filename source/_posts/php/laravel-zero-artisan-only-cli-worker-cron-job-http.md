---
title: Laravel Zero 实战：Artisan-only 微框架——构建 CLI 工具、队列 Worker 与 Cron Job 的轻量无 HTTP 方案
date: 2026-06-07 10:00:00
tags: [Laravel Zero, CLI, Artisan, PHP, 队列, Cron]
keywords: [Laravel Zero, Artisan, only, CLI, Worker, Cron Job, HTTP, 微框架, 构建, 队列]
description: "Laravel Zero 是基于 Laravel 组件的 Artisan-only 微框架，专为 CLI 工具、队列 Worker 与 Cron Job 等纯命令行场景设计。本文通过实战代码演示 Laravel Zero 的项目搭建、Artisan 命令开发、Eloquent 数据库集成、Queue Worker 部署、Cron Job 调度配置与 Supervisor 容器化运维，并对比 Symfony Console 与独立脚本方案的选型差异，附带 PHAR 打包、踩坑排查与测试最佳实践。"
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


在日常后端开发中，我们并不总是需要一个完整的 Web 框架。定时任务、数据迁移脚本、队列消费者、API 数据同步……这些纯 CLI 场景若强行套用 Laravel 全栈框架，不仅要承担 HTTP 中间件栈、Session、CSRF、路由等无用组件的内存开销，还要在部署时带上 Nginx/FPM 的整套链路。**Laravel Zero** 正是为这类场景而生的微框架——它保留了 Laravel 最精华的 Artisan 内核与服务容器，去掉了所有 HTTP 相关组件，让你用熟悉的语法编写轻量、高效、可测试的命令行应用。

<!-- more -->

## 一、Laravel Zero 是什么？

Laravel Zero 由 Nuno Maduro 创建和维护，本质上是一个**基于 Laravel 组件的非官方微框架**。它的核心特点：

- **无 HTTP 层**：没有 Router、Middleware、Request/Response，启动速度极快
- **完整的 Artisan 体验**：继承 Laravel 的命令注册、参数解析、进度条、表格输出等全部能力
- **组件按需安装**：数据库（Eloquent）、队列、日志、调度器等通过 `app:install` 一键添加
- **独立 PHAR 打包**：内置 `box` 支持，可将整个应用编译为单个 `.phar` 文件分发
- **完整的测试支持**：开箱即用 Pest/PHPUnit，命令测试工具链与 Laravel 一致

简而言之，Laravel Zero = **Laravel 的灵魂（IoC 容器 + Artisan）** 剥离了 HTTP 躯壳后的精简形态。

## 二、安装与项目搭建

```bash
composer create-project --prefer-dist laravel-zero/laravel-zero my-cli-tool
cd my-cli-tool
php application app:rename "MyCliTool"
```

项目结构与 Laravel 高度相似，但没有 `routes/`、`resources/views`、`public/` 目录。入口文件是 `application`（一个 PHP 脚本），直接通过 `php application <command>` 执行。

按需安装组件：

```bash
php application app:install database   # Eloquent ORM
php application app:install queue      # 队列系统
php application app:install schedule   # 任务调度器
php application app:install logging    # 日志服务
```

每条命令会自动注册对应的 Service Provider 并发布配置文件。

## 三、构建实战 CLI 命令

### 3.1 创建命令骨架

```bash
php application make:command SyncProductsCommand
```

生成的命令类位于 `app/Commands/SyncProductsCommand.php`：

```php
<?php

namespace App\Commands;

use Illuminate\Console\Command;
use App\Services\ProductSyncService;

class SyncProductsCommand extends Command
{
    protected $signature = 'sync:products
        {--source= : 数据源 API 地址}
        {--batch-size=100 : 每批处理数量}
        {--dry-run : 试运行模式，不实际写入}';

    protected $description = '从外部 API 同步商品数据到本地数据库';

    public function handle(ProductSyncService $service): int
    {
        $source = $this->option('source');
        if (!$source) {
            $this->error('必须通过 --source 指定数据源地址');
            return self::FAILURE;
        }

        $batchSize = (int) $this->option('batch-size');
        $dryRun = $this->option('dry-run');

        $this->info("开始同步：source={$source}, batch={$batchSize}");

        $bar = $this->output->createProgressBar();
        $bar->start();

        $total = $service->sync($source, $batchSize, $dryRun, function () use ($bar) {
            $bar->advance();
        });

        $bar->finish();
        $this->newLine();
        $this->info("同步完成，共处理 {$total} 条记录" . ($dryRun ? '（试运行）' : ''));

        return self::SUCCESS;
    }
}
```

### 3.2 输入验证

Laravel Zero 完全支持 Laravel 的验证器。在命令中可直接使用：

```php
use Illuminate\Support\Facades\Validator;

public function handle(): int
{
    $validator = Validator::make(
        ['source' => $this->option('source')],
        ['source' => 'required|url']
    );

    if ($validator->fails()) {
        foreach ($validator->errors()->all() as $error) {
            $this->error($error);
        }
        return self::INVALID;
    }
    // ...
}
```

### 3.3 交互式输入

`$this->ask()`、`$this->confirm()`、`$this->choice()`、`$this->secret()` 等方法一应俱全：

```php
$env = $this->choice('选择目标环境', ['staging', 'production'], 0);
if ($env === 'production') {
    $confirmed = $this->confirm('即将操作生产环境，确认继续？', false);
    if (!$confirmed) {
        $this->warn('操作已取消');
        return self::SUCCESS;
    }
}
```

## 四、数据库与 Eloquent 集成

安装 `database` 组件后，在 `config/database.php` 中配置连接：

```php
'connections' => [
    'mysql' => [
        'driver'   => 'mysql',
        'host'     => env('DB_HOST', '127.0.0.1'),
        'database' => env('DB_DATABASE'),
        'username' => env('DB_USERNAME'),
        'password' => env('DB_PASSWORD'),
    ],
],
```

然后正常编写 Model 和 Migration：

```bash
php application make:model Product --migration
php application migrate
```

在命令中直接注入 Repository 或使用 Eloquent：

```php
use App\Models\Product;

$products = Product::where('updated_at', '<', now()->subDay())->limit($batchSize)->get();
```

## 五、队列 Worker 作为独立进程

安装 `queue` 组件后，你可以将耗时任务放入队列，并用 Laravel Zero 自身作为 Worker：

```php
// app/Jobs/SendNotificationJob.php
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SendNotificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(public array $payload) {}

    public function handle(): void
    {
        // 发送通知逻辑
    }
}
```

启动 Worker：

```bash
php application queue:work redis --queue=default,high --tries=3 --sleep=3
```

由于没有 HTTP 层，这个 Worker 进程的内存占用通常只有 Laravel 完整框架的 **60-70%**，在大规模队列消费场景下节省非常可观。

### 5.1 队列驱动配置与多队列优先级

在 `config/queue.php` 中配置 Redis 驱动并定义多队列优先级：

```php
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'default',
        'queue' => env('REDIS_QUEUE', 'default'),
        'retry_after' => 90,
        'block_for' => 5,
    ],
    'sqs' => [
        'driver' => 'sqs',
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'prefix' => env('SQS_PREFIX'),
        'queue' => env('SQS_QUEUE'),
        'region' => env('AWS_DEFAULT_REGION'),
    ],
],
```

多 Worker 分别消费不同优先级队列，实现任务分级处理：

```bash
# 高优先级 Worker：专门消费 critical 队列，更多重试
php application queue:work redis --queue=critical --tries=5 --sleep=1 --backoff=30

# 默认优先级 Worker：消费 default 和 low 队列
php application queue:work redis --queue=default,low --tries=3 --sleep=3
```

### 5.2 失败任务处理

Laravel Zero 同样支持失败任务表。安装 queue 组件后运行迁移：

```bash
php application queue:failed-table
php application migrate
```

配置失败任务回调：

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Queue;

public function boot(): void
{
    Queue::failing(function (JobFailed $event) {
        Log::critical('任务失败', [
            'job' => $event->job->resolveName(),
            'exception' => $event->exception->getMessage(),
            'connection' => $event->connectionName,
            'queue' => $event->job->getQueue(),
        ]);
    });
}
```

重试失败任务：

```bash
php application queue:retry all          # 重试所有失败任务
php application queue:retry 5            # 重试指定 ID
php application queue:retry --queue=high # 重试指定队列的失败任务
php application queue:forget 5           # 删除指定失败任务
php application queue:flush              # 清空所有失败任务
```

### 5.3 自定义队列中间件

为队列任务添加自定义中间件，实现限流、日志等横切关注点：

```php
<?php

namespace App\Queue\Middleware;

use Closure;

class RateLimiterMiddleware
{
    public function __construct(
        private int $maxAttempts = 60,
        private int $decaySeconds = 1
    ) {}

    public function handle(object $job, Closure $next): void
    {
        $key = 'queue-rate:' . class_basename($job);

        if (app('cache')->get($key, 0) >= $this->maxAttempts) {
            $job->release($this->decaySeconds);
            return;
        }

        app('cache')->increment($key);
        app('cache')->add($key, 0, $this->decaySeconds);

        $next($job);
    }
}
```

在 Job 中声明中间件：

```php
public function middleware(): array
{
    return [new RateLimiterMiddleware(maxAttempts: 100)];
}
```

## 六、Cron Job 集成

安装 `schedule` 组件后，编辑 `app/Kernel.php`：

```php
<?php

namespace App;

use Illuminate\Console\Scheduling\Schedule;
use App\Commands\SyncProductsCommand;
use App\Commands\GenerateDailyReport;

class Kernel
{
    public function schedule(Schedule $schedule): void
    {
        // 每天凌晨 2 点同步商品
        $schedule->command(SyncProductsCommand::class, ['--source' => 'https://api.example.com/products'])
                 ->dailyAt('02:00')
                 ->withoutOverlapping()
                 ->appendOutputTo(storage_path('logs/sync.log'));

        // 每小时生成报表
        $schedule->command(GenerateDailyReport::class)
                 ->hourly()
                 ->onOneServer();  // 多机部署时只在一台执行
    }
}
```

系统 crontab 只需一条：

```cron
* * * * * cd /opt/my-cli-tool && php application schedule:run >> /dev/null 2>&1
```

这与 Laravel 完全一致，但因为框架本身更轻量，调度进程的资源消耗更低。

### 6.1 Cron Job 最佳实践

**避免任务重叠**：对于执行时间不可预测的任务，始终使用 `withoutOverlapping()`：

```php
$schedule->command(HeavyReportCommand::class)
         ->hourly()
         ->withoutOverlapping(1440);  // 1440 分钟（24 小时）锁过期
```

**限制任务执行时长**：防止任务卡死占用资源：

```php
$schedule->command(DataImportCommand::class)
         ->daily()
         ->timeout(120)       // 最长执行 120 秒
         ->timeoutAt('03:00') // 或指定绝对截止时间
         ->onFailure(function () {
             Log::error('数据导入任务超时或失败');
         })
         ->onSuccess(function () {
             Log::info('数据导入完成');
         });
```

**条件调度**：根据环境或配置动态跳过任务：

```php
$schedule->command(SeedDemoDataCommand::class)
         ->daily()
         ->when(fn () => config('app.env') === 'staging')
         ->environments('staging');
```

**任务分片**：大数据量任务拆分为多个小任务：

```php
$schedule->command(ProcessOrdersCommand::class, ['--chunk' => 500])
         ->everyFiveMinutes()
         ->withoutOverlapping()
         ->runInBackground();  // 后台运行，不阻塞调度器
```

**监控调度健康**：配合 `schedule:monitor` 检测任务是否按时执行：

```php
$schedule->command(SyncProductsCommand::class)
         ->dailyAt('02:00')
         ->name('product-sync')
         ->onOneServer();

// 在 Kernel 中添加监控
$schedule->command('schedule:monitor')
         ->everyMinute()
         ->emailOutputOnFailure('ops@example.com');
```

## 七、测试 CLI 命令

Laravel Zero 开箱支持 Pest 和 PHPUnit。命令测试的核心方法是 `$this->artisan()`：

```php
// tests/Feature/SyncProductsCommandTest.php
use App\Services\ProductSyncService;
use Illuminate\Support\Facades\Http;

it('syncs products from remote API', function () {
    Http::fake([
        'api.example.com/*' => Http::response([
            'data' => [
                ['id' => 1, 'name' => 'Product A', 'price' => 99.9],
                ['id' => 2, 'name' => 'Product B', 'price' => 199.9],
            ]
        ], 200),
    ]);

    $this->artisan('sync:products', [
        '--source' => 'https://api.example.com/products',
        '--batch-size' => 50,
    ])
    ->expectsOutput('开始同步：source=https://api.example.com/products, batch=50')
    ->expectsOutputToContain('同步完成')
    ->assertExitCode(0);
});

it('fails when source option is missing', function () {
    $this->artisan('sync:products')
    ->expectsOutput('必须通过 --source 指定数据源地址')
    ->assertExitCode(1);
});

it('runs in dry-run mode without writing to database', function () {
    Http::fake(['api.example.com/*' => Http::response(['data' => []], 200)]);

    $this->artisan('sync:products', [
        '--source' => 'https://api.example.com/products',
        '--dry-run' => true,
    ])
    ->expectsOutputToContain('试运行')
    ->assertExitCode(0);
});
```

## 八、部署：Docker 打包与 Supervisor

### 8.1 Dockerfile

```dockerfile
FROM php:8.3-cli-alpine

RUN apk add --no-cache mysql-client \
    && docker-php-ext-install pdo pdo_mysql

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY . .
RUN composer install --no-dev --optimize-autoloader

# 可选：编译为 PHAR
# RUN php application app:build

ENTRYPOINT ["php", "application"]
CMD ["sync:products", "--source=https://api.example.com/products"]
```

### 8.2 Supervisor 管理 Worker

```ini
[program:queue-worker]
command=php /app/application queue:work redis --sleep=3 --tries=3 --max-time=3600
directory=/app
autostart=true
autorestart=true
numprocs=4
process_name=%(program_name)s_%(process_num)02d
redirect_stderr=true
stdout_logfile=/var/log/queue-worker.log
```

## 九、Laravel Zero vs 完整 Laravel：选型决策

| 维度 | Laravel Zero | 完整 Laravel |
|------|-------------|-------------|
| 启动速度 | ~15ms | ~80-120ms |
| 内存占用 | ~8MB | ~25-40MB |
| HTTP 支持 | ❌ 无 | ✅ 完整 |
| Artisan 命令 | ✅ 完整 | ✅ 完整 |
| Eloquent/Queue/Schedule | 按需安装 | 内置 |
| PHAR 打包 | ✅ 原生支持 | ❌ 不支持 |
| 适合场景 | CLI 工具、Worker、Cron | Web 应用 + CLI |
| 生态兼容性 | 需手动适配部分包 | 100% |

**决策建议**：如果你的项目**只有 CLI 场景**（纯 Worker、纯定时任务、纯脚本工具），选 Laravel Zero；如果 CLI 只是 Web 应用的附属功能，直接用 Laravel 的 Artisan 即可，无需拆分。

## 十、实战案例速览

### 10.1 数据迁移脚本

将旧系统 MySQL 数据清洗后写入新库，利用 Eloquent 的批量插入和事务：

```bash
php application migrate:legacy --source=legacy_db --target=new_db --chunk=500
```

### 10.2 日报生成器

定时从数据仓库拉取数据，生成 CSV/PDF 报表并通过邮件发送：

```bash
php application report:daily --date=yesterday --format=csv --mail=team@example.com
```

### 10.3 API 数据同步

从第三方 API 拉取增量数据，写入本地数据库并推送变更事件：

```bash
php application api:sync:orders --since="2026-06-01" --queue=redis
```

每个命令都是独立的、可测试的、可通过 Supervisor 自动重启的单元，完美契合微服务架构下的 "一个容器一个职责" 原则。

## 总结

Laravel Zero 并非要替代 Laravel，而是补全了 Laravel 生态中**纯 CLI 场景**的最后一块拼图。它让你用熟悉的语法和组件，构建出更轻量、更专注、更适合容器化部署的命令行应用。下次当你准备写一个 `artisan xxx` 命令却发现自己不需要 Web 层时，不妨试试 Laravel Zero——你会发现，去掉 HTTP 的 Laravel，反而跑得更快了。

## 十一、PHP CLI 框架横向对比

除了 Laravel Zero，PHP 生态中还有几个主流的 CLI 开发方案。以下从多个维度做横向对比，帮助你在项目选型时做出更理性的决策：

| 维度 | Laravel Zero | Symfony Console | Standalone (getopt) | Pest CLI |
|------|-------------|----------------|--------------------|----|
| 学习曲线 | 低（Laravel 开发者零成本） | 中 | 低 | 低 |
| 服务容器 | ✅ 完整 IoC | ❌ 需自行集成 | ❌ 无 | ❌ 无 |
| ORM 集成 | ✅ Eloquent 按需安装 | ✅ Doctrine（手动配置） | ❌ 需自行集成 | ❌ 需自行集成 |
| 队列系统 | ✅ 原生支持 | ❌ 需第三方 | ❌ 无 | ❌ 无 |
| 调度器 | ✅ 原生支持 | ❌ 需系统 crontab | ❌ 需系统 crontab | ❌ 需系统 crontab |
| 参数解析 | Artisan（声明式 signature） | Console Input（命令式） | getopt（底层） | Pest 闭包 |
| 输出格式化 | 表格/进度条/多行进度 | Table/ProgressBar | echo/print | echo |
| PHAR 打包 | ✅ Box 内置 | 需配置 Box | 需手动配置 | ❌ |
| 测试支持 | ✅ Pest/PHPUnit | ✅ PHPUnit | 需自行搭建 | ✅ Pest |
| 适合场景 | Laravel 生态内的 CLI 工具 | Symfony 生态或纯组件化 | 极简脚本 | 测试驱动的小工具 |

**选型建议**：
- 团队已用 Laravel → **Laravel Zero**（代码复用率最高，Eloquent/Queue/Schedule 直接共享）
- 需要组件化拼装但不绑定 Laravel → **Symfony Console**（更灵活，但需手动组装服务层）
- 纯一次性脚本、无需测试 → **standalone getopt**（零依赖，最快交付）

### 跨语言对比：Laravel Zero vs Python Click

如果你的团队同时掌握 PHP 和 Python，以下对比有助于跨语言 CLI 选型：

| 维度 | Laravel Zero | Python Click |
|------|-------------|-------------|
| 类型系统 | PHP 强类型（8.x） | Python 动态类型（type hints 可选） |
| 命令声明 | Artisan signature 字符串 | `@click.command()` 装饰器 |
| 子命令 | `$this->call()` 嵌套 | `@click.group()` 命令组 |
| 参数/选项 | `{argument}` `{--option=}` 声明式 | `@click.argument()` `@click.option()` |
| ORM 集成 | ✅ Eloquent 原生 | ✅ SQLAlchemy（需自行集成） |
| 队列/调度 | ✅ 原生 Queue + Schedule | ❌ 需 Celery/APScheduler 等 |
| 打包分发 | PHAR 单文件 | PyInstaller / Nuitka / shiv |
| 测试 | Pest/PHPUnit | pytest + click.testing.CliRunner |
| 适合场景 | PHP 技术栈、需要 ORM/Queue/Schedule | Python 技术栈、轻量 CLI/DevOps 工具 |

**典型 Python Click 代码对比**：

```python
import click

@click.command()
@click.option('--source', required=True, help='数据源 API 地址')
@click.option('--batch-size', default=100, help='每批处理数量')
@click.option('--dry-run', is_flag=True, help='试运行模式')
def sync_products(source: str, batch_size: int, dry_run: bool):
    """从外部 API 同步商品数据到本地数据库"""
    click.echo(f"开始同步：source={source}, batch={batch_size}")
    with click.progressbar(range(100)) as bar:
        for _ in bar:
            pass  # 同步逻辑
    click.echo("同步完成")

if __name__ == '__main__':
    sync_products()
```

对比可见，Laravel Zero 的 Artisan signature 更紧凑，且天然集成 Eloquent/Queue/Schedule；Click 的装饰器写法更 Pythonic，但队列、调度等需额外组件。

## 十二、常见踩坑与排查指南

### 12.1 环境变量未加载

Laravel Zero 默认没有 `.env` 自动加载，需手动安装 `dotenv` 组件：

```bash
php application app:install dotenv
```

否则 `env()` 在 `config/` 中返回 `null`，导致数据库连接失败但**不会报错**（静默回退到默认值）。

### 12.2 PHAR 打包后路径问题

编译为 `.phar` 后，`base_path()`、`storage_path()` 指向 PHAR 内部的虚拟路径。如果需要写文件到宿主机：

```php
// 正确做法：使用 PHAR 外部路径
$outputPath = getcwd() . '/output/' . $filename;

// 错误做法：storage_path() 在 PHAR 内是只读的
// $outputPath = storage_path('app/' . $filename);  // 会报权限错误
```

### 12.3 队列 Worker 内存泄漏

长时间运行的 Worker 可能因第三方包的静态属性或全局缓存导致内存持续增长：

```bash
php application queue:work redis --max-jobs=1000 --max-time=3600
```

使用 `--max-jobs` 或 `--max-time` 限制单个 Worker 生命周期，由 Supervisor 自动重启。配合 `--memory=128` 设置内存上限，超限自动退出：

```ini
[program:queue-worker]
command=php /app/application queue:work redis --sleep=3 --tries=3 --max-jobs=1000 --memory=128
autorestart=true
```

### 12.4 调度器时区不一致

服务器时区与 `config/app.php` 中的 `timezone` 不一致会导致 Cron Job 在错误的时间执行：

```php
// app/Kernel.php
public function schedule(Schedule $schedule): void
{
    $schedule->command(SyncProductsCommand::class)
             ->dailyAt('02:00')
             ->timezone('Asia/Shanghai');  // 显式指定时区
}
```

### 12.5 调试命令执行失败

当命令在生产环境静默失败时，使用 `--verbose` 获取完整堆栈：

```bash
php application sync:products --source=https://api.example.com --verbose
# 或简写
php application sync:products --source=https://api.example.com -vvv
```

配合 `Log::channel('cli')` 将关键日志写入独立文件，便于 Supervisor 日志收集。

### 12.6 多进程信号处理

在 Supervisor 管理多个 Worker 时，`queue:restart` 命令需要 Worker 能正确接收信号。确保 PHP 安装了 `pcntl` 扩展：

```bash
php -m | grep pcntl
# 若无输出，需要安装 pcntl 扩展
```

### 12.7 包兼容性问题：依赖 HTTP 组件的第三方包

某些 Laravel 包隐式依赖 HTTP 层（如依赖 `Illuminate\Http\Request` 的包），在 Laravel Zero 中安装后会在运行时报错：

```
Class "Illuminate\Http\Request" not found
```

**排查方法**：

```bash
# 安装前检查包的依赖
composer show --tree vendor/package-name | grep -i http

# 或在安装后搜索未解析的 HTTP 依赖
grep -r "Illuminate\\Http" vendor/some-package/src/
```

**解决方案**：

```php
// 方案一：在 AppServiceProvider 中绑定空实现
$this->app->bind('Illuminate\Http\Request', function () {
    return \Illuminate\Http\Request::capture() ?? \Illuminate\Http\Request::create('/');
});

// 方案二：使用条件性加载，仅在 HTTP 环境下注册该包的 Provider
// 在 config/app.php 中手动注册，而非自动发现
```

### 12.8 Laravel Zero 与完整 Laravel 的关键差异

从 Laravel 迁移到 Laravel Zero 时需注意以下差异：

| 差异点 | 完整 Laravel | Laravel Zero |
|--------|-------------|-------------|
| `.env` 加载 | 自动加载 | 需 `app:install dotenv` |
| Artisan 入口 | `php artisan` | `php application` |
| 路由/中间件 | 完整支持 | 不存在 |
| Blade 视图 | 内置 | 需 `app:install views`（极少见） |
| Session/CSRF | 内置 | 不存在 |
| `config/app.php` | 丰富配置项 | 精简配置 |
| Service Provider | 自动发现 | 自动发现（但 HTTP 相关的无效） |
| `php artisan serve` | 可用 | 不可用 |
| `make:controller` | 可用 | 不可用 |

**迁移 Checklist**：

1. 将 `php artisan` 改为 `php application`
2. 移除所有路由、中间件、视图相关代码
3. 检查第三方包是否依赖 HTTP 组件
4. 安装 `dotenv` 组件确保环境变量可用
5. 检查 `config/` 中所有 `env()` 调用是否正确回退

### 12.9 数据库迁移中的外键约束

Laravel Zero 的数据库组件默认不加载完整的 Schema Builder 依赖链。在使用外键约束时：

```php
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    // 可能报错：需要确保安装了完整的 database 组件
});
```

如果报错，确保安装了完整组件：

```bash
php application app:install database
# 检查 composer.json 中是否包含 illuminate/database
composer show illuminate/database
```

## 十三、PHAR 打包与分发实战

将 Laravel Zero 应用编译为单个 `.phar` 文件，可以在无 Composer 依赖的机器上直接运行：

```bash
# 安装 build 组件
php application app:install build

# 编译
php application app:build
# 生成 builds/my-cli-tool.phar

# 分发后直接运行
./builds/my-cli-tool.phar sync:products --source=https://api.example.com
```

`box.json` 配置示例：

```json
{
    "alias": "my-cli-tool.phar",
    "directories": ["app", "config", "database"],
    "files": ["bootstrap.php"],
    "main": "application",
    "output": "builds/my-cli-tool.phar",
    "compression": "GZ"
}
```

> **注意**：使用 `--compress` 压缩后启动速度会略慢（需要解压），对执行频率极高的 Cron Job 建议不压缩。

---

## 相关阅读

- [Laravel Task Scheduling 深度实战：多服务器调度、分布式锁、任务分片与监控告警](/categories/Laravel/2026-06-07-laravel-task-scheduling-ononeserver-redis-mutex/)
- [Laravel Session 深度实战：驱动配置、CSRF 防护与分布式会话方案](/categories/Laravel/2026-06-07-laravel-session-deep-dive-driver-csrf-distributed/)
- [FFmpeg Laravel 实战：音视频转码、截图、水印、上传处理管道与队列化异步任务](/categories/Laravel/FFmpeg-Laravel-实战-音视频转码截图水印-上传处理管道与队列化异步任务/)
