---

title: Laravel 多租户 SaaS 实战：共享库与独立库混合架构下的租户识别、连接切换与队列串租踩坑记录
keywords: [Laravel, SaaS, 多租户, 共享库与独立库混合架构下的租户识别, 连接切换与队列串租踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 10:00:45
updated: 2026-06-06 12:00:00
categories:
- php
tags:
- Laravel
- MySQL
- 架构
- 消息队列
description: 深入解析 Laravel 多租户 SaaS 架构的落地方案，涵盖共享库与独立库两种租户隔离模式的对比、动态数据库连接切换、队列任务中租户上下文透传、数据迁移策略及安全检查清单。结合真实踩坑经验，讲解 tenant_id 隔离、DB::purge 连接管理、Horizon Worker 串租排查等关键技术要点，帮助开发者在不同租户规模下选择合适的 SaaS 架构方案。
---


做多租户最容易犯的错，是把它想成“所有表加一个 `tenant_id` 就结束”。项目还小的时候，这么做确实够用；但一旦有大客户要求独立库、队列异步任务变多、后台导出和定时报表开始跑起来，问题就会从“查不到数据”升级成更可怕的“**查到了别人的数据**”。

我最近在一个 Laravel SaaS 项目里做过一次改造：中小客户继续走共享库，大客户切到独立库，应用层保持同一套代码。真正难的不是 Eloquent，而是**请求进来后如何稳定识别租户、如何在长生命周期 worker 里正确切连接、以及如何把租户上下文透传到队列**。这篇只讲落地后真正踩过的坑。

## 一、最后落地的架构

```text
Browser / Admin / OpenAPI
          │
          ▼
   Nginx / Ingress
          │ host / x-tenant-id
          ▼
IdentifyTenant Middleware
          │
          ▼
     CurrentTenant
          │
   ┌──────┴───────────────┐
   ▼                      ▼
Shared DB            TenantManager
(users/orders...)         │
                           ▼
                    tenant connection
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
            Shared Schema       Dedicated DB

Queue::createPayloadUsing → payload.tenant_id
JobProcessing / JobFailed → 激活与清理租户上下文
```

这里我刻意把"租户识别"和"数据访问"拆开。`CurrentTenant` 只负责描述当前是谁，`TenantManager` 才负责切数据库连接。这样 HTTP、Queue、Console 三条入口才能复用同一套激活逻辑。

## 二、三种多租户模式对比

在正式讲实现之前，先把三种主流方案摆出来做对比，避免后面只盯着一种方案讲：

| 维度 | 共享库 + tenant_id | 独立库（每租户一个库） | 混合架构（本文方案） |
|---|---|---|---|
| **数据隔离级别** | 行级隔离（逻辑隔离） | 库级隔离（物理隔离） | 中小租户逻辑隔离，大租户物理隔离 |
| **实现复杂度** | 低：全局作用域 + trait | 中：动态连接管理 | 高：两套逻辑并存 |
| **运维成本** | 低，一个库一套备份 | 高，租户越多库越多 | 中，需分类管理 |
| **租户间性能干扰** | 有，慢查询影响全部 | 无，完全隔离 | 视租户类别而定 |
| **Schema 变更** | 一次 migration 全生效 | 逐库执行或脚本批处理 | 两种都要兼顾 |
| **适合租户规模** | < 500 家中小型 | < 100 家大型/合规要求 | 中型以上，大小客户并存 |
| **备份恢复粒度** | 全库，无法单独恢复某租户 | 可单租户恢复 | 大租户可单库恢复 |
| **成本** | 低 | 高（连接数、内存） | 中等 |

> **选型建议**：项目初期别上来就搞独立库。先用 `tenant_id` 跑通全部业务流程，等真的出现大客户需求或性能瓶颈再逐步迁移。本文的混合架构就是从共享库演进过来的，不是一开始就设计好的。

## 三、请求阶段先解决"当前租户是谁"

域名子域、Header、JWT claim 三种来源我都用过。最后线上最稳定的是：**管理后台走二级域名，OpenAPI 走 `X-Tenant-Id`，然后统一收口到中间件**。

```php
<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use App\Support\CurrentTenant;
use Closure;
use Illuminate\Http\Request;

class IdentifyTenant
{
    public function handle(Request $request, Closure $next)
    {
        $tenantKey = $request->header('X-Tenant-Id')
            ?: str($request->getHost())->before('.saas.example.com')->toString();

        abort_unless($tenantKey, 400, 'Tenant is required');

        $tenant = Tenant::query()
            ->where('slug', $tenantKey)
            ->where('status', 'active')
            ->firstOrFail();

        app(CurrentTenant::class)->set($tenant);

        return $next($request);
    }
}
```

`CurrentTenant` 我没有做成静态类，而是一个可清理的 request scoped 对象。因为后面跑到 Queue Worker、Octane 或常驻进程时，静态状态最容易残留。

## 四、连接切换不要只改配置，一定要 purge

真正的串租事故出在这里。很多文章会写：`config(['database.connections.tenant.database' => $db])`，这只改了配置，**没处理已经建立好的 PDO**。在 Horizon worker 里，上一个任务连的是 A 租户库，下一个任务虽然改了 config，但连接对象还在复用，最后直接读到 A 的数据。

我最后固定成一个 `TenantManager`：

```php
<?php

namespace App\Support;

use App\Models\Tenant;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;

class TenantManager
{
    public function activate(string $tenantId): Tenant
    {
        $tenant = Tenant::query()->findOrFail($tenantId);

        app(CurrentTenant::class)->set($tenant);

        if ($tenant->database_mode !== 'dedicated') {
            Config::set('database.default', 'mysql');
            DB::purge('tenant');
            return $tenant;
        }

        Config::set('database.connections.tenant', array_merge(
            config('database.connections.mysql'),
            [
                'host' => $tenant->db_host,
                'port' => $tenant->db_port,
                'database' => $tenant->db_database,
                'username' => $tenant->db_username,
                'password' => decrypt($tenant->db_password),
            ]
        ));

        DB::purge('tenant');
        DB::reconnect('tenant');

        return $tenant;
    }

    public function clear(): void
    {
        DB::disconnect('tenant');
        app(CurrentTenant::class)->forget();
    }
}
```

关键点就两个：

1. 切租户前后都显式处理连接生命周期。
2. 共享库和独立库都走同一个 manager，不要在业务代码里到处 `if ($tenant->isDedicated())`。

## 五、模型隔离别只靠自觉，作用域要默认生效

共享库里的表我统一挂一个 trait，把 `tenant_id` 自动写入并默认加 where 条件。业务层再决定哪些模型允许后台跨租户查询。

```php
<?php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\Builder;

trait BelongsToTenant
{
    protected static function bootBelongsToTenant(): void
    {
        static::creating(function ($model) {
            $tenant = app(\App\Support\CurrentTenant::class)->get();
            if ($tenant && empty($model->tenant_id)) {
                $model->tenant_id = $tenant->id;
            }
        });

        static::addGlobalScope('tenant', function (Builder $builder) {
            $tenant = app(\App\Support\CurrentTenant::class)->get();
            if ($tenant) {
                $builder->where($builder->getModel()->getTable() . '.tenant_id', $tenant->id);
            }
        });
    }
}
```

这段代码的价值不是“少写 where”，而是把默认安全边界前置。后台有超管需要跨租户查数据时，只能显式 `withoutGlobalScope('tenant')`，这样 review 时一眼就能看出来。

## 六、队列上下文透传，才是多租户改造里最容易漏的一环

HTTP 请求里有中间件，Queue 没有。最早我们的导出任务就是这么翻车的：用户在租户 B 点导出，job 里没有 tenant 信息，worker 启动后还残留着上一个任务的连接，结果把租户 A 的数据导给了 B。

后来我直接用 Laravel 提供的 payload hook，把租户 id 注入每个 job：

```php
<?php

namespace App\Providers;

use App\Support\CurrentTenant;
use App\Support\TenantManager;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Queue::createPayloadUsing(function () {
            $tenant = app(CurrentTenant::class)->get();

            return $tenant ? ['tenant_id' => $tenant->id] : [];
        });

        Event::listen(JobProcessing::class, function (JobProcessing $event) {
            $tenantId = $event->job->payload()['tenant_id'] ?? null;
            if ($tenantId) {
                app(TenantManager::class)->activate($tenantId);
            }
        });

        Event::listen(JobFailed::class, fn () => app(TenantManager::class)->clear());
    }
}
```

对应的 job 就可以保持很干净：

```php
<?php

class ExportOrdersJob implements ShouldQueue
{
    public function handle(): void
    {
        $rows = Order::query()
            ->latest('id')
            ->limit(5000)
            ->get(['id', 'order_no', 'status', 'total_amount']);

        Storage::disk('s3')->put(
            'exports/orders-' . now()->format('YmdHis') . '.json',
            $rows->toJson(JSON_UNESCAPED_UNICODE)
        );
    }
}
```

## 七、我实际踩过的三个坑

### 坑一：只在 HTTP 中间件设置租户，CLI 和 Queue 全部失效

症状是本地接口正常，定时报表和导出偶发串租。原因很简单：中间件只覆盖 Web 请求。修复方式不是在每个 Command/Job 手工 `setTenant()`，而是把激活逻辑收敛到 `TenantManager`，所有入口统一调用。

### 坑二：切库不 purge，Horizon 常驻进程复用旧连接

这个坑最隐蔽，因为开发环境短请求不容易复现，线上长生命周期 worker 才会中。修完以后我专门补了一个回归测试：连续执行 A、B 两个租户任务，断言第二个任务读取到的 `database()` 名称已经切换。

### 坑三：缓存 key 没带租户前缀，命中了别人的配置

数据库隔离了不代表缓存也安全。我们有一个“店铺装修配置”最早直接用 `shop:homepage` 做 key，大客户改一次，小客户首页样式一起变。后来统一改成：

```php
$key = sprintf('tenant:%s:shop:homepage', app(CurrentTenant::class)->id());
Cache::put($key, $payload, 3600);
```

多租户项目里，缓存、限流、分布式锁、对象存储路径，本质上都要带 tenant namespace，这件事和数据库隔离同等重要。

## 八、数据迁移策略：共享库 vs 独立库的差异

多租户项目里 migration 是最容易被低估的复杂度来源。两种模式下，迁移策略完全不同。

### 共享库模式

共享库的 migration 和普通 Laravel 项目几乎没有区别，一次 `php artisan migrate` 就全量生效：

```php
// database/migrations/2024_01_01_create_orders_table.php
public function up(): void
{
    Schema::create('orders', function (Blueprint $table) {
        $table->id();
        $table->foreignId('tenant_id')->constrained()->index();
        $table->string('order_no');
        $table->decimal('total_amount', 12, 2);
        $table->timestamps();

        // 组合索引对共享库查询性能至关重要
        $table->index(['tenant_id', 'created_at']);
    });
}
```

**关键注意点**：
- `tenant_id` 列必须加索引，而且建议放到组合索引的最左列
- 大表加字段要评估锁表时间，因为数据量 = 所有租户之和
- 如果用 `ALTER TABLE` 加列，考虑用 `pt-online-schema-change` 或 Laravel 的 `after()` 配合后台低峰执行

### 独立库模式

独立库需要对每个租户库都执行一次 migration。最简单的做法是用 artisan 命令包装：

```php
<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

class TenantMigrate extends Command
{
    protected $signature = 'tenant:migrate {--tenant= : 指定租户ID，留空则全部}';
    protected $description = '对独立库租户执行数据库迁移';

    public function handle(): int
    {
        $query = Tenant::query()->where('database_mode', 'dedicated');

        if ($tenantId = $this->option('tenant')) {
            $query->where('id', $tenantId);
        }

        foreach ($query->cursor() as $tenant) {
            $this->line("Migrating tenant: {$tenant->slug} ({$tenant->id})");
            app(\App\Support\TenantManager::class)->activate($tenant->id);

            Artisan::call('migrate', [
                '--database' => 'tenant',
                '--path' => 'database/migrations/tenant',
                '--force' => true,
            ]);

            $this->info(Artisan::output());
        }

        return self::SUCCESS;
    }
}
```

> **实战建议**：独立库的 migration 文件最好和共享库分开目录存放（如 `database/migrations/tenant/`），避免共享库 migration 意外跑到独立库执行。同时准备一个 `tenant:migrate:status` 命令检查各库迁移状态是否一致。

### 混合架构下的双轨迁移

混合架构要同时维护两套 migration 路径。我的做法是在 `AppServiceProvider` 里根据 migration 路径前缀动态切换连接：

```php
// 在 MigrationServiceProvider 或自定义 provider 中
Event::listen(Migrating::class, function ($event) {
    if (str_starts_with($event->migration->getPath(), 'database/migrations/tenant')) {
        // 跳过共享库执行
    }
});
```

更稳妥的做法是用 `--database` 参数显式区分，不要靠路径自动推断。

## 九、租户数据隔离安全检查清单

安全隔离不是只靠 `tenant_id` 就完事。以下是我在项目上线前逐项核查过的清单：

### 数据库层

- [ ] 所有共享表都有 `tenant_id` 列，且 NOT NULL + 索引
- [ ] 所有共享模型都挂载了 `BelongsToTenant` trait
- [ ] 全局作用域无法被非授权代码 `withoutGlobalScope` 绕过（通过 Code Review 控制）
- [ ] 独立库租户的连接配置加密存储（`encrypt()`/`decrypt()`）
- [ ] 数据库用户权限最小化：独立库用户只能访问自己的库

### 缓存层

- [ ] 所有 Cache key 都带 `tenant:{id}:` 前缀
- [ ] Redis 用独立 database 或前缀区分（`cache.tenant.1.shop_config`）
- [ ] 限流器（RateLimiter）按租户隔离

### 队列层

- [ ] Job payload 包含 `tenant_id`
- [ ] Worker 在 `JobProcessing` 事件中激活租户上下文
- [ ] Job 完成/失败后清理连接和上下文
- [ ] 队列失败日志记录 `tenant_id` 便于排查

### 文件存储层

- [ ] S3/OSS 路径按租户隔离：`/tenants/{id}/exports/`
- [ ] 临时文件和导出文件有清理策略
- [ ] 私有文件 URL 签名时校验当前租户权限

### API 层

- [ ] JWT/API Token 绑定 `tenant_id`，不可跨租户使用
- [ ] 接口响应不泄露其他租户信息（错误信息、分页 total 等）
- [ ] 超管接口有独立鉴权，不走租户作用域
- [ ] 接口限流按租户维度计数

### 日志与监控

- [ ] 日志上下文包含 `tenant_id`（`Log::withContext(['tenant_id' => ...])`）
- [ ] Sentry/Bugsnag 等错误追踪带上租户标签
- [ ] 慢查询日志可按租户分析

> 这份清单建议做成项目的 Checklist PR Template，每次涉及租户相关代码变更时强制过一遍。

## 十、性能对比：共享库 vs 独立库

选架构不能只看隔离性，性能和资源消耗才是决定方案的关键因素。以下是基于实际项目数据的对比：

### 查询性能

| 场景 | 共享库 | 独立库 |
|---|---|---|
| 单租户简单查询 | 依赖 `tenant_id` 索引，千万级表下 < 5ms | 纯净小表，< 1ms |
| 跨租户报表统计 | 一次查询搞定，但要注意索引覆盖 | 需要应用层聚合，多次查询 |
| 大租户慢查询 | 会影响所有租户响应时间 | 只影响自身 |
| Schema 变更（大表加字段） | 锁表影响全局 | 只锁当前租户库 |

### 资源消耗

| 资源 | 共享库 | 独立库 |
|---|---|---|
| MySQL 连接数 | 固定连接池（如 20 个） | 每个租户需要独立连接池 |
| 内存占用 | 低 | 高，100 个租户 ≈ 100 倍 buffer pool 配置需求 |
| 备份存储 | 一份全量备份 | 每租户独立备份，存储成本 × N |
| 运维工具 | 标准监控即可 | 需要逐库监控，复杂度线性增长 |

### 实测数据参考

以下数据来自一个真实 SaaS 项目（共享库约 200 家租户，独立库 15 家大租户）：

| 指标 | 共享库（200 租户） | 独立库（单租户） |
|---|---|---|
| 订单表总量 | ~1200 万行 | ~80 万行 |
| 按 tenant_id 查最新 50 条 | 8ms（有组合索引） | 2ms |
| 每日定时报表生成 | 45 分钟（全量扫描） | 3 分钟（单库扫描） |
| 迁移执行时间 | 10 秒 | 1 秒/库 × 15 = 15 秒 |

> **结论**：租户 < 200 且数据量可控时，共享库性能完全够用，且运维最省心。超过 500 家或单租户数据量特别大时，独立库的性能优势才开始显现。混合架构是两者之间的折中——用共享库控制成本，用独立库服务头部客户。

## 十一、这套方案适合什么阶段

如果还在单体早期、没有独立库诉求，老老实实 `tenant_id + 全局作用域` 就够了；但只要你已经出现下面任一信号，就该尽快抽出 `CurrentTenant + TenantManager`：

- 开始有长生命周期 worker，比如 Horizon、Octane、消费程序
- 少数大客户要求独立数据库或专属资源
- 有导出、报表、异步回调这类脱离 HTTP 上下文的任务
- 线上已经出现过一次“数据串租”事故

我的经验是：**多租户的难点从来不是建表，而是上下文传播。**谁来识别租户、谁来激活连接、任务结束后谁来清理，只要这三个动作做成统一基础设施，业务代码反而不会太重；反过来，如果把它们散落在 Controller、Job、Repository 里，迟早会在某个边角入口漏掉一处，然后付出一次很贵的线上事故学费。

## 相关阅读

- [Laravel 缓存策略全指南：Route / Config / View / Query Cache 实战](/post/laravel-cache-route-config-view-query-cache/) — 多租户项目中缓存隔离是安全的关键一环，本文详解 Laravel 各层缓存的使用与优化
- [Redis 分布式锁在 Laravel 中的完整实践指南](/post/laravel-redis-distributedlockguide/) — 租户间的并发操作需要分布式锁保护，避免跨租户数据竞争
- [PHP Fiber 并发与 Laravel Concurrency API 深度指南](/post/php-fiber-concurrencyguide-laravel-concurrencyapi/) — 多租户批量操作场景下，利用并发提升报表生成与数据导出效率
- [Laravel API Resource 与 BFF 架构实战指南](/post/laravel-api-resource-bff-architectureguide/) — SaaS 系统对外暴露 API 时，BFF 层可以统一处理租户感知的数据转换与聚合
