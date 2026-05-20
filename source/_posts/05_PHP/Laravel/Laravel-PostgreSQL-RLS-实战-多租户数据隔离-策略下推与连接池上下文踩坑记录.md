---
title: Laravel + PostgreSQL RLS 实战：多租户数据隔离、策略下推与连接池上下文踩坑记录
date: 2026-05-03 10:51:00
updated: 2026-05-03 10:52:45
categories:
  - 05_PHP
  - Laravel
tags: [Laravel, MySQL, PostgreSQL]description: 结合一个 Laravel 多租户后台的真实改造过程，记录如何用 PostgreSQL Row Level Security 把 tenant_id 隔离从应用层下推到数据库层，以及在连接池、队列任务和管理员越权场景里的真实踩坑。
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
- `USING` 只控制“看见什么”，`WITH CHECK` 才控制“能写入什么”；
- `current_setting(..., true)` 要带第二个参数，不然变量没设置时会直接报错。

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

这样做的好处不是“代码优雅”，而是把上下文生命周期限制在单个事务里，请求结束即自动清理。

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

然后在 `JobProcessing` 事件里恢复上下文，但**不要在事件里直接 `SET`**，而是在 job 真正访问数据库时再进入 `TenantConnection::run()`。这一步我踩过坑：曾经在 worker 启动作一次 `SET`，结果第二个 job 明明属于租户 B，却沿用了租户 A 的连接状态。后来把规则改成“**每个 job、每个事务单独设置 LOCAL**”，问题才彻底消失。

## 六、管理员越权不能只靠代码分支

运营后台常有“跨租户查看”的需求。如果你只是 `if ($isAdmin)` 后跳过 Global Scope，看起来方便，但原生 SQL、导出脚本、临时命令还是会漏。RLS 下更稳的做法，是把越权能力也显式建模成上下文变量。

不过我不建议把所有管理员都设成 `app.is_admin=true`。我们后来拆成两类：

- 普通租户管理员：只能看本租户；
- 平台审计账号：允许跨租户，但所有查询必须带审计日志。

也就是说，**越权不是角色名，而是一种数据库访问能力**。否则一个“后台客服”角色配错，就等于拿到了全库读取权限。

## 七、三次真实踩坑

### 坑 1：PgBouncer 事务池模式下，连接级 `SET` 直接失效

早期我们用了 `SET app.tenant_id = '1001'`，测试没事，上线接 PgBouncer 后偶发查不到数据。原因很直接：事务结束后连接被归还，下一条 SQL 不保证还落在同一物理连接上。**结论：事务池模式只能信 `SET LOCAL` + 显式事务。**

### 坑 2：数据写入被拦，但错误看起来像“表单验证失败”

当 `WITH CHECK` 不满足时，PostgreSQL 会抛权限错误，不是 Laravel 常见的验证异常。我们第一次遇到时，前端只看到 500。后来统一把 SQLSTATE `42501` 映射成业务可读错误，并记录 `tenant_id / actor_id / request_id`，排障效率高很多。

### 坑 3：脚本用户是表 owner，测试全绿，线上仍可能绕过

很多人本地 migration 用户就是 owner，没开 `FORCE ROW LEVEL SECURITY` 时，owner 默认可能绕过 policy。结果就是开发环境一切正常，真正的受限账号却报错，或者更糟，某些脚本账号直接看全表。这个坑很隐蔽，必须在受限角色下做集成测试。

## 八、我对 RLS 的使用边界

RLS 很适合以下场景：共享库多租户、报表 SQL 多、开发者人数多、需要数据库层兜底。它不适合拿来替代一切授权逻辑，例如“某角色只能看自己创建的订单”这种细粒度权限，如果 policy 过多，复杂度会迅速爆炸。

我的经验是：**RLS 负责租户边界，应用层负责业务权限**。前者是硬隔离，后者是软规则。把这两件事揉在一起，最后一定很难维护。

## 九、落地后的收益

这次改完后，最明显的变化不是接口快了，而是团队心态变了。以前写报表和临时脚本，总担心少写一个 `where tenant_id`；现在默认就是“没带租户上下文，数据库不让你查”。对于多租户系统来说，这种默认拒绝比任何 code review checklist 都更可靠。

如果你现在的 Laravel 多租户项目已经开始出现原生 SQL、后台导出、异步消费和连接池，那么我会认真考虑 PostgreSQL RLS。它增加了一些事务和连接管理成本，但换来的是**把最容易出事故的租户隔离，从“约定”升级成“数据库强约束”**。这笔账，在线上 usually 是划算的。
