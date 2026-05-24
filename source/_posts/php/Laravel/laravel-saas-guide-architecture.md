---
title: Laravel 多租户 SaaS 实战：共享库与独立库混合架构下的租户识别、连接切换与队列串租踩坑记录
date: 2026-05-03 10:00:45
updated: 2026-05-03 10:03:01
categories:
  - PHP
  - Laravel
tags: [Laravel, MySQL, 架构, 消息队列]
description: 结合一个 Laravel SaaS 后台的真实改造过程，记录多租户从单纯 tenant_id 隔离走到共享库 + 独立库混合架构时，租户识别、动态连接切换、队列上下文透传与串租排障的落地方案。



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

这里我刻意把“租户识别”和“数据访问”拆开。`CurrentTenant` 只负责描述当前是谁，`TenantManager` 才负责切数据库连接。这样 HTTP、Queue、Console 三条入口才能复用同一套激活逻辑。

## 二、请求阶段先解决“当前租户是谁”

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

## 三、连接切换不要只改配置，一定要 purge

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

## 四、模型隔离别只靠自觉，作用域要默认生效

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

## 五、队列上下文透传，才是多租户改造里最容易漏的一环

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

## 六、我实际踩过的三个坑

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

## 七、这套方案适合什么阶段

如果还在单体早期、没有独立库诉求，老老实实 `tenant_id + 全局作用域` 就够了；但只要你已经出现下面任一信号，就该尽快抽出 `CurrentTenant + TenantManager`：

- 开始有长生命周期 worker，比如 Horizon、Octane、消费程序
- 少数大客户要求独立数据库或专属资源
- 有导出、报表、异步回调这类脱离 HTTP 上下文的任务
- 线上已经出现过一次“数据串租”事故

我的经验是：**多租户的难点从来不是建表，而是上下文传播。**谁来识别租户、谁来激活连接、任务结束后谁来清理，只要这三个动作做成统一基础设施，业务代码反而不会太重；反过来，如果把它们散落在 Controller、Job、Repository 里，迟早会在某个边角入口漏掉一处，然后付出一次很贵的线上事故学费。
