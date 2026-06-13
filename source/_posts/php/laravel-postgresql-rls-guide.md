---
title: Laravel + PostgreSQL RLS 实战：多租户数据隔离、策略下推与连接池上下文踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03 10:51:00
updated: 2026-05-03 10:52:45
categories:
  - php
tags: [Laravel, PostgreSQL, RLS, 多租户, 数据隔离, PgBouncer]
keywords: [Laravel, PostgreSQL RLS, 多租户数据隔离, 策略下推与连接池上下文踩坑记录, PHP]
description: Laravel 多租户项目完整 RLS 落地指南：从 PostgreSQL Row Level Security 策略配置、Laravel 中间件与 ServiceProvider 集成、PgBouncer 连接池适配、队列 Job 租户上下文恢复，到管理员越权审计与多租户隔离方案对比，附完整 SQL 脚本与 PHP 代码示例。



---

多租户系统做久了，团队迟早会遇到一个问题：**`where tenant_id = ?` 到底还能信多久**。项目早期靠 Eloquent Global Scope 很顺手，但仓库一多、报表 SQL 一多、定时任务一多，总会冒出“少带一个条件就串租”的事故。我们这次改造没有继续在应用层补洞，而是把隔离规则下推到 PostgreSQL，直接用 **Row Level Security（RLS）** 兜底。

先说结论：RLS 不是银弹，但它非常适合“共享库多租户 + Laravel + PostgreSQL”这类场景。落地后，我们把后台导出、运营查询、异步任务三条最容易漏 `tenant_id` 的链路都收住了，排查数据串租风险也从“代码 review 靠人眼”变成“数据库默认拒绝”。真正难的不是开一个开关，而是**如何把租户上下文稳定传到每条连接、每个事务、每个队列 worker**。

## 一、最后落地的结构

```text
Browser / Admin API
        │
        ▼
Laravel Middleware
  解析 tenant_id / actor
        │
        ▼
TenantContext
        │
        ▼
DB::transaction()
  SET LOCAL app.tenant_id = '1001'
  SET LOCAL app.is_admin = 'false'
        │
        ▼
PostgreSQL RLS Policy
  USING / WITH CHECK
        │
        ▼
orders / coupons / invoices

Queue Worker
  JobProcessing 时恢复 tenant context
  每个 job 单独开启事务设置 LOCAL 变量
```

这里最关键的设计是：**Laravel 不负责“判断能不能查到”，Laravel 只负责把上下文传给 PostgreSQL**。真正的数据可见性由 policy 控制。

## 二、表结构别一上来就改 Policy，先统一租户键

RLS 生效的前提，是你的租户边界足够清晰。我们先把核心表统一成下面的结构：

```sql
ALTER TABLE orders
    ADD COLUMN tenant_id bigint NOT NULL,
    ADD COLUMN created_by bigint NULL;

CREATE INDEX idx_orders_tenant_id_status_created_at
    ON orders (tenant_id, status, created_at DESC);
```

我一开始偷懒，只给 `orders` 开了 RLS，结果 `order_items` 还靠应用层过滤，后台导出一 join 就穿透。后来改成两条原则：

1. **所有租户表都必须有显式 `tenant_id`**，不要寄希望于 join 间接推导；
2. **索引必须把 `tenant_id` 放到前面**，否则 policy 命中后仍然会全表扫。

## 三、在 PostgreSQL 里启用 RLS

下面是线上实际可用的一套最小配置：

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_orders_select ON orders
FOR SELECT
USING (
    tenant_id = current_setting('app.tenant_id', true)::bigint
    OR current_setting('app.is_admin', true) = 'true'
);

CREATE POLICY tenant_orders_modify ON orders
FOR ALL
USING (
    tenant_id = current_setting('app.tenant_id', true)::bigint
    OR current_setting('app.is_admin', true) = 'true'
)
WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::bigint
    OR current_setting('app.is_admin', true) = 'true'
);
```

这里有三个容易被忽略的点：

- `FORCE ROW LEVEL SECURITY` 要开，不然表 owner 可能绕过 policy；
- `USING` 只控制"看见什么"，`WITH CHECK` 才控制"能写入什么"；
- `current_setting(..., true)` 要带第二个参数，不然变量没设置时会直接报错。

### 多表完整 SQL 配置示例

实际项目中不只有一张表需要隔离。下面是我们最终给 `orders`、`order_items`、`coupons`、`invoices` 四张核心业务表同时配置的完整 SQL 脚本，可以一次性跑完：

```sql
-- ========== 公共函数：避免每个 policy 重复写相同的判断逻辑 ==========
CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS bigint AS $$
    SELECT current_setting('app.tenant_id', true)::bigint;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app.is_tenant_admin()
RETURNS boolean AS $$
    SELECT current_setting('app.is_admin', true) = 'true';
$$ LANGUAGE sql STABLE;

-- ========== orders ==========
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_orders_select ON orders;
DROP POLICY IF EXISTS tenant_orders_modify ON orders;

CREATE POLICY tenant_orders_select ON orders
FOR SELECT USING (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
);

CREATE POLICY tenant_orders_modify ON orders
FOR ALL
USING (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
)
WITH CHECK (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
);

-- ========== order_items ==========
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_order_items_select ON order_items;
DROP POLICY IF EXISTS tenant_order_items_modify ON order_items;

CREATE POLICY tenant_order_items_select ON order_items
FOR SELECT USING (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
);

CREATE POLICY tenant_order_items_modify ON order_items
FOR ALL
USING (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
)
WITH CHECK (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
);

-- ========== coupons ==========
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_coupons_select ON coupons;
DROP POLICY IF EXISTS tenant_coupons_modify ON coupons;

CREATE POLICY tenant_coupons_select ON coupons
FOR SELECT USING (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
);

CREATE POLICY tenant_coupons_modify ON coupons
FOR ALL
USING (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
)
WITH CHECK (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
);

-- ========== invoices ==========
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_invoices_select ON invoices;
DROP POLICY IF EXISTS tenant_invoices_modify ON invoices;

CREATE POLICY tenant_invoices_select ON invoices
FOR SELECT USING (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
);

CREATE POLICY tenant_invoices_modify ON invoices
FOR ALL
USING (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
)
WITH CHECK (
    tenant_id = app.current_tenant_id()
    OR app.is_tenant_admin()
);
```

> **设计要点**：把判断逻辑抽成 `app.current_tenant_id()` 和 `app.is_tenant_admin()` 两个 SQL 函数后，每张表的 policy 保持一致且可维护。如果将来要加"审计账号只读"逻辑，只需改函数定义即可全局生效。

## 四、Laravel 里不要全局 `SET`，要跟事务绑死

很多文章会写成连接建立后执行一次 `SET app.tenant_id = ...`。这在 PHP-FPM 下有时能工作，但到了 Octane、Swoole、队列 worker、PgBouncer 事务池模式就很危险，因为**连接会复用，租户上下文可能残留到下一次请求**。

我们最后固定成“所有访问租户表的入口都包事务，并在事务里 `SET LOCAL`”：

```php
<?php

namespace App\Support\Tenant;

use Closure;
use Illuminate\Support\Facades\DB;

final class TenantConnection
{
    public function run(int $tenantId, bool $isAdmin, Closure $callback): mixed
    {
        return DB::transaction(function () use ($tenantId, $isAdmin, $callback) {
            DB::statement('SET LOCAL app.tenant_id = ?', [(string) $tenantId]);
            DB::statement('SET LOCAL app.is_admin = ?', [$isAdmin ? 'true' : 'false']);

            return $callback();
        });
    }
}
```

控制器里不再直接查库，而是统一走这一层：

```php
public function index(Request $request, TenantConnection $tenantConnection)
{
    $tenantId = (int) $request->user()->tenant_id;
    $isAdmin = $request->user()->hasRole('super-operator');

    $orders = $tenantConnection->run($tenantId, $isAdmin, function () {
        return Order::query()
            ->where('status', 'paid')
            ->latest()
            ->limit(50)
            ->get();
    });

    return OrderResource::collection($orders);
}
```

这样做的好处不是"代码优雅"，而是把上下文生命周期限制在单个事务里，请求结束即自动清理。

### 完整的 Middleware + ServiceProvider 实现

上面的 `TenantConnection` 是核心，但要让它在整个应用中自动生效，还需要配套的中间件和ServiceProvider。下面是我们最终的完整实现：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class SetTenantContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null) {
            // 未登录请求不设置租户上下文，RLS 会拒绝所有租户数据访问
            return $next($request);
        }

        // 将租户信息绑定到容器，供 TenantConnection 使用
        app()->singleton('currentTenant', fn () => new class($user->tenant_id) {
            public function __construct(private readonly int $id) {}
            public function id(): int { return $this->id; }
        });

        return $next($request);
    }
}
```

注册到 `bootstrap/app.php`（Laravel 11+）：

```php
use App\Http\Middleware\SetTenantContext;

return Application::configure(basePath: dirname(__DIR__))
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->api(prepend: [
            SetTenantContext::class,
        ]);
    })
    ->create();
```

如果是 Laravel 10 或更早版本，在 `app/Http/Kernel.php` 的 `$middleware` 数组中注册即可。

### 通过 ServiceProvider 注册 TenantConnection

```php
<?php

namespace App\Providers;

use App\Support\Tenant\TenantConnection;
use Illuminate\Support\ServiceProvider;

class TenantServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(TenantConnection::class);
    }

    public function boot(): void
    {
        // 可选：监听 QueryExecuted 事件，用于调试和审计
        if (config('app.debug')) {
            \Illuminate\Support\Facades\DB::listen(function ($query) {
                $tenantId = \Illuminate\Support\Facades\DB::select(
                    "SELECT current_setting('app.tenant_id', true)"
                )[0]->current_setting ?? 'N/A';

                \Log::debug('DB Query', [
                    'tenant_id' => $tenantId,
                    'sql' => $query->sql,
                    'time' => $query->time . 'ms',
                ]);
            });
        }
    }
}
```

### 异常处理：RLS 拦截的错误码映射

当 RLS 策略拒绝数据访问时，PostgreSQL 抛出的错误码是 `42501`（insufficient privilege），但 Laravel 默认会把它包装成 500 错误，前端看到的只是一个"Internal Server Error"。我们需要在异常处理器中把它映射成可读的业务错误：

```php
<?php

namespace App\Exceptions;

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Throwable;

class Handler extends ExceptionHandler
{
    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            //
        });
    }

    public function render($request, Throwable $e)
    {
        if ($e instanceof QueryException && $e->getCode() === '42501') {
            \Log::warning('RLS policy violation', [
                'tenant_id' => request()->user()?->tenant_id,
                'actor_id' => request()->user()?->id,
                'request_id' => request()->header('X-Request-Id'),
                'sql' => $e->getPrevious()->getMessage(),
            ]);

            return response()->json([
                'message' => '数据访问被拒绝：当前上下文无权访问目标数据',
                'code' => 'RLS_POLICY_VIOLATION',
            ], 403);
        }

        return parent::render($request, $e);
    }
}
```

## 五、队列才是最容易串租的地方

HTTP 请求通常还有中间件兜着，真正最危险的是 queue worker。因为 worker 常驻内存、连接长期复用，如果 job payload 不带租户信息，或者处理前没重新 `SET LOCAL`，RLS 轻则全拦截，重则读到上一个 job 的上下文。

我最后用 `Queue::createPayloadUsing` 把租户信息打进 payload：

```php
use Illuminate\Support\Facades\Queue;

Queue::createPayloadUsing(function () {
    return [
        'tenant_id' => app('currentTenant')->id(),
        'is_admin' => false,
    ];
});
```

然后在 `JobProcessing` 事件里恢复上下文，但**不要在事件里直接 `SET`**，而是在 job 真正访问数据库时再进入 `TenantConnection::run()`。这一步我踩过坑：曾经在 worker 启动作一次 `SET`，结果第二个 job 明明属于租户 B，却沿用了租户 A 的连接状态。后来把规则改成"**每个 job、每个事务单独设置 LOCAL**"，问题才彻底消失。

### Job 基类：统一恢复租户上下文

与其在每个 Job 里手动 `SET LOCAL`，不如写一个抽象基类让所有租户 Job 继承：

```php
<?php

namespace App\Jobs;

use App\Support\Tenant\TenantConnection;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

abstract class TenantAwareJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(
        public readonly int $tenantId,
        public readonly bool $isAdmin = false,
    ) {}

    /**
     * 在 TenantConnection 事务内执行业务逻辑
     */
    protected function runInTenantContext(callable $callback): mixed
    {
        return app(TenantConnection::class)->run(
            $this->tenantId,
            $this->isAdmin,
            $callback,
        );
    }

    /**
     * 执行入口：子类不需要关心租户上下文
     */
    public function handle(): void
    {
        $this->runInTenantContext(fn () => $this->execute());
    }

    /**
     * 子类实现这个方法，写业务逻辑即可
     */
    abstract protected function execute(): void;
}
```

具体的 Job 只需继承这个基类，完全不需要关心 RLS 上下文：

```php
<?php

namespace App\Jobs;

use App\Models\Order;
use Illuminate\Support\Facades\Log;

class SendOrderConfirmation extends TenantAwareJob
{
    public function __construct(
        public readonly int $orderId,
        int $tenantId,
    ) {
        parent::__construct($tenantId);
    }

    protected function execute(): void
    {
        $order = Order::findOrFail($this->orderId);

        // 这里不需要手动 SET LOCAL，TenantConnection 已经处理好了
        // 如果 tenant_id 不匹配，RLS 会直接抛 42501
        Log::info("Sending confirmation for order {$order->id}", [
            'tenant_id' => $order->tenant_id,
        ]);

        // 发送邮件、调用第三方等...
    }
}
```

### 调度任务中的 RLS 上下文

除了队列 Job，`Scheduler` 里的定时任务也是一个常见的"漏带租户"场景。比如每天凌晨跑的对账任务，如果没设置租户上下文，所有 RLS 策略都会拦截查询：

```php
<?php

namespace App\Console\Commands;

use App\Support\Tenant\TenantConnection;
use App\Models\Tenant;
use Illuminate\Console\Command;

class DailyReconciliation extends Command
{
    protected $signature = 'tenant:reconcile {--tenant= : 指定租户 ID，不传则遍历所有租户}';
    protected $description = '每日对账：逐租户检查订单与支付记录一致性';

    public function handle(TenantConnection $tenantConnection): int
    {
        $tenantIds = $this->option('tenant')
            ? [(int) $this->option('tenant')]
            : Tenant::pluck('id')->toArray();

        foreach ($tenantIds as $tenantId) {
            $this->info("Processing tenant {$tenantId}...");

            $result = $tenantConnection->run($tenantId, false, function () use ($tenantId) {
                // 所有查询自动带上 tenant_id 上下文
                $unpaidOrders = \DB::select("
                    SELECT id, total_amount, created_at
                    FROM orders
                    WHERE status = 'paid'
                    AND created_at < NOW() - INTERVAL '24 hours'
                    AND id NOT IN (
                        SELECT order_id FROM invoices WHERE tenant_id = current_setting('app.tenant_id', true)::bigint
                    )
                ");

                return count($unpaidOrders);
            });

            $this->info("  Found {$result} unpaid orders");
        }

        $this->info('Reconciliation complete.');
        return Command::SUCCESS;
    }
}
```

## 六、管理员越权不能只靠代码分支

运营后台常有“跨租户查看”的需求。如果你只是 `if ($isAdmin)` 后跳过 Global Scope，看起来方便，但原生 SQL、导出脚本、临时命令还是会漏。RLS 下更稳的做法，是把越权能力也显式建模成上下文变量。

不过我不建议把所有管理员都设成 `app.is_admin=true`。我们后来拆成两类：

- 普通租户管理员：只能看本租户；
- 平台审计账号：允许跨租户，但所有查询必须带审计日志。

也就是说，**越权不是角色名，而是一种数据库访问能力**。否则一个"后台客服"角色配错，就等于拿到了全库读取权限。

### 审计型越权的完整实现

对于"平台审计账号"这种需要跨租户访问的场景，我们实现了一个专门的审计中间件和查询构建器，确保每次越权访问都有完整的审计链路：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class SetAuditContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null || !$user->hasRole('platform-auditor')) {
            return $next($request);
        }

        // 审计账号允许跨租户，但必须记录审计日志
        DB::transaction(function () use ($request) {
            DB::statement("SET LOCAL app.tenant_id = '0'");
            DB::statement("SET LOCAL app.is_admin = 'true'");

            // 记录审计日志：谁在什么时间跨租户访问了什么
            $auditEntry = [
                'actor_id' => $request->user()->id,
                'actor_email' => $request->user()->email,
                'action' => 'cross_tenant_query',
                'request_uri' => $request->getRequestUri(),
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'timestamp' => now()->toDateTimeString(),
            ];

            Log::channel('audit')->info('Cross-tenant access', $auditEntry);
        });

        // 注意：审计上下文不是通过事务绑定的，而是通过后续的 TenantConnection 调用
        // 这里只是记录了审计日志

        return $next($request);
    }
}
```

对应的审计查询构建器，确保每次审计查询都带上审计日志：

```php
<?php

namespace App\Support\Tenant;

use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

final class AuditConnection
{
    /**
     * 在审计模式下执行查询，自动记录跨租户访问日志
     */
    public function run(int $actorId, Closure $callback): mixed
    {
        return DB::transaction(function () use ($actorId, $callback) {
            // 设为 tenant_id=0 + is_admin=true，让 RLS 放行
            DB::statement("SET LOCAL app.tenant_id = '0'");
            DB::statement("SET LOCAL app.is_admin = 'true'");

            $result = $callback();

            // 记录查询涉及的表和行数（可选）
            Log::channel('audit')->info('Audit query executed', [
                'actor_id' => $actorId,
                'result_type' => gettype($result),
                'timestamp' => now()->toDateTimeString(),
            ]);

            return $result;
        });
    }
}
```

### 审计日志的 RLS 防护

审计日志本身也应该有 RLS 保护，否则普通租户管理员可能通过日志间接获取其他租户的数据。一个常见的做法是给审计日志表单独配置 policy，只允许平台管理员写入和读取：

```sql
-- 审计日志表
CREATE TABLE audit_logs (
    id bigserial PRIMARY KEY,
    tenant_id bigint NOT NULL,
    actor_id bigint NOT NULL,
    action varchar(100) NOT NULL,
    target_table varchar(100),
    target_id bigint,
    details jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- 普通用户只能看自己租户的日志
CREATE POLICY tenant_audit_logs_select ON audit_logs
FOR SELECT USING (
    tenant_id = app.current_tenant_id()
);

-- 只有管理员可以写入
CREATE POLICY tenant_audit_logs_insert ON audit_logs
FOR INSERT
WITH CHECK (
    app.is_tenant_admin()
);

-- 管理员可以看所有日志（审计场景）
CREATE POLICY admin_audit_logs_select ON audit_logs
FOR SELECT USING (
    app.is_tenant_admin()
);
```

## 七、三次真实踩坑

### 坑 1：PgBouncer 事务池模式下，连接级 `SET` 直接失效

早期我们用了 `SET app.tenant_id = '1001'`，测试没事，上线接 PgBouncer 后偶发查不到数据。原因很直接：事务结束后连接被归还，下一条 SQL 不保证还落在同一物理连接上。**结论：事务池模式只能信 `SET LOCAL` + 显式事务。**

### 坑 2：数据写入被拦，但错误看起来像“表单验证失败”

当 `WITH CHECK` 不满足时，PostgreSQL 会抛权限错误，不是 Laravel 常见的验证异常。我们第一次遇到时，前端只看到 500。后来统一把 SQLSTATE `42501` 映射成业务可读错误，并记录 `tenant_id / actor_id / request_id`，排障效率高很多。

### 坑 3：脚本用户是表 owner，测试全绿，线上仍可能绕过

很多人本地 migration 用户就是 owner，没开 `FORCE ROW LEVEL SECURITY` 时，owner 默认可能绕过 policy。结果就是开发环境一切正常，真正的受限账号却报错，或者更糟，某些脚本账号直接看全表。这个坑很隐蔽，必须在受限角色下做集成测试。

## 八、PgBouncer 连接池场景下的深度踩坑与解决方案

PgBouncer 是 PostgreSQL 连接池的标配，但它的工作模式与 RLS 存在天然冲突。这部分是我们花了最长时间踩坑才总结出来的经验。

### PgBouncer 的三种池模式与 RLS 兼容性

| PgBouncer 模式 | RLS 兼容性 | 说明 |
|---|---|---|
| **Session Pool（会话池）** | ✅ 兼容 | 每个客户端连接绑定一个后端连接，直到客户端断开。`SET LOCAL` 可以正常工作，但连接复用率最低。 |
| **Transaction Pool（事务池）** | ⚠️ 需谨慎 | 只在事务期间绑定后端连接，事务结束后连接归还。`SET` 命令失效，必须用 `SET LOCAL` + 显式事务。 |
| **Statement Pool（语句池）** | ❌ 不兼容 | 每条 SQL 独立执行，不支持事务。RLS 完全无法工作，因为 `SET LOCAL` 在事务外无效。 |

我们最终选择了**事务池模式**，但对 RLS 做了专门适配：

```php
<?php

namespace App\Support\Tenant;

use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

final class PgBouncerTenantConnection
{
    /**
     * 在 PgBouncer 事务池模式下安全地设置租户上下文
     *
     * 关键点：
     * 1. 必须使用 SET LOCAL（而非 SET），确保上下文只在当前事务有效
     * 2. 必须在显式事务内执行，PgBouncer 事务池在事务结束后归还连接
     * 3. 不要使用数据库连接的持久化配置，每次请求都要重新设置
     */
    public function run(int $tenantId, bool $isAdmin, Closure $callback): mixed
    {
        return DB::transaction(function () use ($tenantId, $isAdmin, $callback) {
            // 在事务内设置 LOCAL 变量，PgBouncer 会在事务结束时自动清理
            DB::statement('SET LOCAL app.tenant_id = ?', [(string) $tenantId]);
            DB::statement('SET LOCAL app.is_admin = ?', [$isAdmin ? 'true' : 'false']);

            try {
                return $callback();
            } catch (\Throwable $e) {
                // 记录 RLS 相关错误，便于排查
                if (str_contains($e->getMessage(), 'permission denied')) {
                    Log::error('RLS policy denied in PgBouncer context', [
                        'tenant_id' => $tenantId,
                        'is_admin' => $isAdmin,
                        'error' => $e->getMessage(),
                        'sql_state' => $e->getCode(),
                    ]);
                }
                throw $e;
            }
        });
    }
}
```

### PgBouncer 连接健康检查与租户上下文验证

在生产环境中，我们发现偶尔会出现 PgBouncer 连接泄漏或租户上下文残留的问题。为此添加了一个连接健康检查中间件：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class VerifyTenantContext
{
    public function handle(Request $request, Closure $next): Response
    {
        // 在请求开始时验证当前连接的租户上下文是否干净
        $currentTenant = DB::select(
            "SELECT current_setting('app.tenant_id', true) as tenant_id"
        )[0]->tenant_id;

        if ($currentTenant !== '') {
            // 连接可能残留了上一个请求的上下文，记录警告
            \Log::warning('Tenant context leaked from previous request', [
                'leaked_tenant_id' => $currentTenant,
                'request_path' => $request->path(),
            ]);

            // 强制清理残留上下文
            DB::statement("SET LOCAL app.tenant_id = ''");
            DB::statement("SET LOCAL app.is_admin = 'false'");
        }

        return $next($request);
    }
}
```

## 九、多租户隔离方案对比：RLS vs 应用层 WHERE vs 独立 Schema vs 独立数据库

很多团队在做多租户选型时会纠结于各种方案。下面是一份基于真实生产经验的对比表，帮助你根据业务规模和合规需求做出选择：

| 维度 | PostgreSQL RLS | 应用层 WHERE | 独立 Schema | 独立数据库 |
|---|---|---|---|---|
| **隔离强度** | 数据库层强制，无法绕过 | 依赖代码正确性，容易遗漏 | 数据库层隔离，较强 | 完全隔离，最强 |
| **代码侵入性** | 中等（需设置上下文） | 高（每个查询都要带条件） | 中等（需切换 Schema） | 低（连接不同数据库） |
| **运维复杂度** | 低（单一数据库） | 低 | 中等（Schema 管理） | 高（多数据库实例） |
| **性能影响** | 几乎无（索引命中后） | 几乎无 | 几乎无 | 连接池开销大 |
| **迁移成本** | 中等（需改查询逻辑） | 低（已有代码） | 高（需重构） | 最高 |
| **适用场景** | 共享库多租户、报表多 | 小型项目、租户数少 | 中型 SaaS、需 Schema 级隔离 | 合规要求高、金融级 |
| **Laravel 兼容性** | 好（需自定义中间件） | 最好（原生支持） | 好（需切换连接） | 好（多连接配置） |
| **PgBouncer 兼容性** | ⚠️ 需事务池 + SET LOCAL | ✅ 完全兼容 | ⚠️ 需 Session Pool | ✅ 完全兼容 |
| **扩展性** | 好（单库可支撑数千租户） | 差（数据量大时性能下降） | 中等（Schema 数量有上限） | 好（可水平扩展） |
| **审计能力** | 强（数据库层记录） | 弱（需应用层实现） | 强 | 最强 |

### 我们的选择：RLS + 应用层 Global Scope 双保险

最终我们选择了"RLS 兜底 + Global Scope 辅助"的双层策略：

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Order extends Model
{
    use SoftDeletes;

    protected $fillable = ['tenant_id', 'user_id', 'status', 'total_amount'];

    /**
     * 全局作用域：应用层兜底（防止直接查询遗漏 tenant_id）
     * 注意：这只是软保护，真正的硬隔离由 PostgreSQL RLS 完成
     */
    protected static function booted(): void
    {
        static::addGlobalScope('tenant', function (Builder $query) {
            $tenantId = app('currentTenant')?->id();
            if ($tenantId) {
                $query->where('tenant_id', $tenantId);
            }
        });
    }
}
```

这样做的好处是：
- **正常请求**：Global Scope 自动加条件，代码写起来方便
- **异常场景**：即使有人绕过了 Global Scope（比如原生 SQL、报表导出），RLS 仍然会拦截
- **性能**：Global Scope 让查询更高效（走索引），RLS 作为最后的安全网

## 十、我对 RLS 的使用边界

RLS 很适合以下场景：共享库多租户、报表 SQL 多、开发者人数多、需要数据库层兜底。它不适合拿来替代一切授权逻辑，例如“某角色只能看自己创建的订单”这种细粒度权限，如果 policy 过多，复杂度会迅速爆炸。

我的经验是：**RLS 负责租户边界，应用层负责业务权限**。前者是硬隔离，后者是软规则。把这两件事揉在一起，最后一定很难维护。

## 十一、落地后的收益

这次改完后，最明显的变化不是接口快了，而是团队心态变了。以前写报表和临时脚本，总担心少写一个 `where tenant_id`；现在默认就是“没带租户上下文，数据库不让你查”。对于多租户系统来说，这种默认拒绝比任何 code review checklist 都更可靠。

如果你现在的 Laravel 多租户项目已经开始出现原生 SQL、后台导出、异步消费和连接池，那么我会认真考虑 PostgreSQL RLS。它增加了一些事务和连接管理成本，但换来的是**把最容易出事故的租户隔离，从"约定"升级成"数据库强约束"**。这笔账，在线上 usually 是划算的。

## 相关阅读

- [数据库多租户模式对比实战：共享库 Row-Level vs Schema-per-Tenant vs 独立库——Laravel 中的三种方案深度权衡](/post/row-level-schema-per-tenant-laravel/) — 如果你在纠结多租户选型，这篇从安全性、性能、运维成本、扩展性四个维度深度对比了三种主流方案，提供了 Laravel 完整实现代码
- [Laravel + PostgreSQL Advisory Lock 实战：补偿扫描单实例化、会话级互斥与 PgBouncer 踩坑记录](/post/laravel-postgresql-advisory-lock-guide-pgbouncer/) — PostgreSQL Advisory Lock 在 Laravel 补偿任务中的实战经验，涵盖会话锁释放、连接池模式不兼容与异常退出恢复
- [PostgreSQL 高级特性实战：Window Functions + CTE + JSONB + pg_trgm——Laravel 中的复杂查询重写与性能调优](/post/postgresql-advanced-features-window-cte-jsonb-pgtrgm-laravel/) — 掌握 PostgreSQL 四大高级特性，用 Window Functions 一条 SQL 替代 PHP 三重循环，响应时间从 8 秒降到 200 毫秒
