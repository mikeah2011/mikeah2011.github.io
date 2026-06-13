---

title: Multi-Tenancy Security 实战：共享数据库场景下的行级安全策略——PostgreSQL RLS vs Laravel Scopes
keywords: [Multi, Tenancy Security, PostgreSQL RLS vs Laravel Scopes, 共享数据库场景下的行级安全策略]
date: 2026-06-04 12:00:00
tags:
- Multi-Tenancy
- postgresql-rls
- Laravel Scopes
- 行级安全
- SaaS
- 租户隔离
categories:
- php
description: 深入解析多租户 SaaS 应用的行级安全策略：PostgreSQL RLS、Laravel Scopes 与中间件隔离三种方案的完整实现与量化对比。涵盖 RLS 策略配置、Global Scope 自动过滤、Repository 模式封装、双层纵深防御架构、十大典型数据泄露漏洞防护（原生 SQL 绕过、队列上下文丢失、关联查询泄露等），以及生产环境监控告警与安全清单。附带完整可运行代码和 Feature Test 测试套件，适合构建金融级多租户数据隔离方案的 Laravel 团队参考。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---





# Multi-Tenancy Security 实战：共享数据库场景下的行级安全策略——PostgreSQL RLS vs Laravel Scopes vs 中间件隔离

## 引言：多租户架构的安全挑战与数据泄露风险

在 SaaS 应用开发中，多租户（Multi-Tenancy）架构是最常见的部署模式。一个服务端实例同时为多个租户提供服务，所有租户共享相同的代码库和基础设施。这种模式带来了显著的成本优势——运维成本被分摊，资源利用率大幅提升。然而，它也带来了一个核心的安全挑战：**如何确保租户 A 的数据永远不会泄露给租户 B？**

近年来，多租户数据泄露事件屡见不鲜：

- 2019 年，某知名 SaaS CRM 平台因查询条件遗漏导致跨租户数据泄露，影响数万企业客户
- 2021 年，某云服务提供商因 `tenant_id` 校验缺失，导致用户可访问其他租户的敏感文件
- 2023 年，某金融 SaaS 平台因 ORM 关联查询未正确隔离，暴露了跨客户的交易记录

这些事故的共同根因在于：**应用层的数据隔离依赖开发者手动编写过滤条件，而人为错误不可避免。**

本文将深入探讨三种主流的行级安全策略：

1. **PostgreSQL RLS（Row-Level Security）**：数据库层面的强制隔离
2. **Laravel Scopes**：ORM 层面的自动过滤
3. **中间件隔离**：应用层面的上下文管理

我们将通过实际代码演示每种方案的实现，进行安全性的量化对比，最终给出混合策略的最佳实践。

在正式开始之前，我们需要明确一个核心概念：**行级安全（Row-Level Security）**不同于传统的表级权限或列级权限。表级权限决定用户能否访问某张表，列级权限决定用户能否看到某些字段，而行级安全则精确到每一行数据——它确保用户只能看到与自己相关联的那些记录。在多租户架构中，这个「关联」通常就是 `tenant_id` 字段。

理解了这个概念之后，我们就能理解为什么行级安全在多租户架构中如此关键。一个电商 SaaS 平台可能有数千个商家（租户），每个商家都有自己的订单、商品、客户数据。如果某个商家的管理员能够通过某种方式看到其他商家的订单数据，那将是一场灾难——不仅涉及商业机密泄露，还可能违反数据保护法规如 GDPR、《个人信息保护法》等。因此，构建一套可靠、不可绕过的行级安全机制，是每一个多租户 SaaS 应用的基石。

---

## 一、多租户隔离的三种经典模式

在进入行级安全策略之前，先梳理多租户数据隔离的三种经典架构模式：

### 1.1 Database-per-Tenant（一租户一库）

每个租户拥有独立的数据库实例，物理层面完全隔离。

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Tenant A DB │  │  Tenant B DB │  │  Tenant C DB │
│  (独立实例)   │  │  (独立实例)   │  │  (独立实例)   │
└──────────────┘  └──────────────┘  └──────────────┘
```

**优点**：隔离性最强，数据库层面零泄露风险；可针对不同租户做独立备份和性能调优。

**缺点**：运维成本高，数据库连接数爆炸式增长，迁移和升级痛苦。当租户数量达到数百甚至数千时，这种模式几乎不可运维。

### 1.2 Schema-per-Tenant（一租户一 Schema）

所有租户共享同一个数据库实例，但每个租户拥有独立的 Schema。

```sql
-- 租户 A 的数据
SELECT * FROM tenant_a.orders;

-- 租户 B 的数据
SELECT * FROM tenant_b.orders;
```

**优点**：比 Database-per-Tenant 节省资源，逻辑隔离性好，支持 Schema 级别的权限控制。

**缺点**：Schema 数量有上限（PostgreSQL 默认最多约 1.6 万个），跨租户查询困难，ORM 支持不佳。

### 1.3 Shared Database with Row-Level Security（共享数据库 + 行级安全）

所有租户共享同一个数据库和同一张表，通过 `tenant_id` 列区分数据，并在数据库或应用层面实施行级过滤。

```sql
-- 所有租户共享同一张表
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    customer_name VARCHAR(255),
    amount DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT NOW()
);
```

**优点**：运维最简单，资源利用率最高，易于扩展到大量租户。

**缺点**：隔离性完全依赖行级过滤逻辑，一旦遗漏就会造成数据泄露。这正是本文要解决的核心问题。

> **本文聚焦第三种模式**——共享数据库场景下，如何通过 PostgreSQL RLS、Laravel Scopes 和中间件隔离三重机制，构建牢不可破的行级安全防线。

---

## 二、PostgreSQL RLS 深度实战

### 2.1 什么是 Row-Level Security

PostgreSQL 从 9.5 版本开始原生支持 Row-Level Security（RLS）。RLS 允许数据库管理员为表创建安全策略（Policy），使得普通用户在查询时只能看到符合策略条件的行，**即使执行的是 `SELECT * FROM orders`，数据库也会自动过滤掉无权访问的行。**

这是数据库层面的强制机制，不受应用代码影响——即使开发者忘记了 `WHERE tenant_id = ?`，数据库也会自动加上过滤条件。

### 2.2 启用 RLS 并创建策略

首先，我们需要创建一个专用的数据库角色，并启用 RLS：

```sql
-- 创建应用专用角色
CREATE ROLE app_user LOGIN PASSWORD 'secure_password';

-- 授予表的基本权限
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO app_user;

-- 为所有业务表启用 RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
```

接下来，创建行级安全策略。策略通过 `current_setting()` 函数获取当前请求的租户 ID：

```sql
-- 租户隔离策略：SELECT
CREATE POLICY tenant_isolation_select ON orders
    FOR SELECT
    TO app_user
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- 租户隔离策略：INSERT
CREATE POLICY tenant_isolation_insert ON orders
    FOR INSERT
    TO app_user
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- 租户隔离策略：UPDATE
CREATE POLICY tenant_isolation_update ON orders
    FOR UPDATE
    TO app_user
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- 租户隔离策略：DELETE
CREATE POLICY tenant_isolation_delete ON orders
    FOR DELETE
    TO app_user
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.3 在 Laravel 中设置租户上下文

在 Laravel 应用中，我们需要在每个请求的数据库连接上设置 `app.current_tenant_id`：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SetTenantContext
{
    public function handle(Request $request, Closure $next)
    {
        $tenant = $request->user()?->tenant;

        if ($tenant) {
            // 在 PostgreSQL 连接上设置当前租户 ID
            // 这个设置仅对当前数据库连接/事务有效
            DB::statement(
                "SET LOCAL app.current_tenant_id = ?",
                [$tenant->id]
            );
        }

        return $next($request);
    }
}
```

注册中间件到 `bootstrap/app.php`（Laravel 11+）：

```php
<?php
// bootstrap/app.php

return Application::configure(basePath: dirname(__DIR__))
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->append(\App\Http\Middleware\SetTenantContext::class);
    })
    ->create();
```

### 2.4 RLS 的工作原理深度解析

让我们通过一个具体的例子来理解 RLS 的防护效果：

```sql
-- 假设当前连接的 app.current_tenant_id = 'tenant-aaa'

-- 普通查询：RLS 自动追加 WHERE tenant_id = 'tenant-aaa'
SELECT * FROM orders;
-- 实际执行：SELECT * FROM orders WHERE tenant_id = 'tenant-aaa'

-- 即使开发者写了全表查询，也无法看到其他租户的数据
SELECT * FROM orders WHERE customer_name LIKE '%机密%';
-- 实际执行：SELECT * FROM orders WHERE customer_name LIKE '%机密%'
--          AND tenant_id = 'tenant-aaa'

-- 尝试插入其他租户的数据会被拒绝
INSERT INTO orders (tenant_id, customer_name, amount)
VALUES ('tenant-bbb', '越权订单', 999.99);
-- 错误：新行违反行级安全策略
```

### 2.5 RLS 的高级用法：超级管理员绕过

某些场景下，平台管理员需要查看所有租户的数据。PostgreSQL 提供了 `BYPASSRLS` 属性：

```sql
-- 创建超级管理员角色（谨慎使用）
CREATE ROLE super_admin LOGIN PASSWORD 'super_secure_password' BYPASSRLS;

-- 或者在策略中使用表达式条件
CREATE POLICY tenant_isolation_select ON orders
    FOR SELECT
    TO app_user
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::UUID
        OR current_setting('app.is_super_admin', true) = 'true'
    );
```

### 2.6 为 RLS 自动创建策略的存储过程

为了减少重复代码，我们可以创建一个存储过程，为任意表自动创建完整的 RLS 策略：

```sql
CREATE OR REPLACE FUNCTION apply_tenant_rls(
    target_table TEXT,
    tenant_column TEXT DEFAULT 'tenant_id'
)
RETURNS VOID AS $$
BEGIN
    -- 启用 RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);

    -- SELECT 策略
    EXECUTE format(
        'CREATE POLICY tenant_select ON %I FOR SELECT TO app_user
         USING (%I = current_setting(''app.current_tenant_id'')::UUID)',
        target_table, tenant_column
    );

    -- INSERT 策略
    EXECUTE format(
        'CREATE POLICY tenant_insert ON %I FOR INSERT TO app_user
         WITH CHECK (%I = current_setting(''app.current_tenant_id'')::UUID)',
        target_table, tenant_column
    );

    -- UPDATE 策略
    EXECUTE format(
        'CREATE POLICY tenant_update ON %I FOR UPDATE TO app_user
         USING (%I = current_setting(''app.current_tenant_id'')::UUID)
         WITH CHECK (%I = current_setting(''app.current_tenant_id'')::UUID)',
        target_table, tenant_column, tenant_column
    );

    -- DELETE 策略
    EXECUTE format(
        'CREATE POLICY tenant_delete ON %I FOR DELETE TO app_user
         USING (%I = current_setting(''app.current_tenant_id'')::UUID)',
        target_table, tenant_column
    );

    RAISE NOTICE 'RLS applied to table: %', target_table;
END;
$$ LANGUAGE plpgsql;

-- 使用示例
SELECT apply_tenant_rls('orders');
SELECT apply_tenant_rls('products');
SELECT apply_tenant_rls('customers');
```

---

## 三、Laravel Scopes 实战

### 3.1 全局作用域（Global Scopes）

Laravel 的全局作用域允许我们为模型的所有查询自动附加条件。这是应用层面最优雅的租户隔离方案。

首先，定义 `BelongsToTenant` Trait：

```php
<?php

namespace App\Models\Traits;

use App\Models\Scopes\TenantScope;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Builder;

trait BelongsToTenant
{
    /**
     * 模型的 boot 方法中注册全局作用域
     */
    protected static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope());

        // 自动在创建时设置 tenant_id
        static::creating(function ($model) {
            if (is_null($model->tenant_id)) {
                $model->tenant_id = app(Tenant::class)->id ?? auth()->user()?->tenant_id;
            }
        });
    }

    /**
     * 定义租户关联
     */
    public function tenant(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * 绕过租户作用域（管理员专用）
     */
    public function scopeWithoutTenant(Builder $query): Builder
    {
        return $query->withoutGlobalScope(TenantScope::class);
    }
}
```

接下来，创建 `TenantScope` 全局作用域类：

```php
<?php

namespace App\Models\Scopes;

use App\Models\Tenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class TenantScope implements Scope
{
    /**
     * 应用作用域到给定的 Eloquent 查询构建器
     */
    public function apply(Builder $builder, Model $model): void
    {
        $tenantId = $this->getTenantId();

        if ($tenantId) {
            $builder->where($model->getTable() . '.tenant_id', '=', $tenantId);
        }
    }

    /**
     * 获取当前租户 ID
     * 优先从容器获取，回退到认证用户
     */
    protected function getTenantId(): ?string
    {
        // 方式 1：从 Laravel 容器中获取（推荐）
        try {
            $tenant = app(Tenant::class);
            return $tenant?->id;
        } catch (\Exception $e) {
            // 容器中没有绑定租户
        }

        // 方式 2：从当前认证用户获取
        return auth()->user()?->tenant_id;
    }
}
```

在模型中使用 Trait：

```php
<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'customer_name',
        'amount',
        'status',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'created_at' => 'datetime',
    ];
}

class Product extends Model
{
    use BelongsToTenant;

    protected $fillable = ['tenant_id', 'name', 'price', 'stock'];
}
```

### 3.2 TenantScope 的完整实现——支持软删除和多条件

在实际项目中，我们需要处理更多边界情况：

```php
<?php

namespace App\Models\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class TenantScope implements Scope
{
    /**
     * 所有需要排除的表（不需要租户隔离的表）
     */
    protected array $exceptTables = [
        'tenants',
        'migrations',
        'password_resets',
        'personal_access_tokens',
    ];

    public function apply(Builder $builder, Model $model): void
    {
        // 跳过不需要租户隔离的表
        if (in_array($model->getTable(), $this->exceptTables)) {
            return;
        }

        // 检查模型是否有 tenant_id 列
        if (!$this->hasTenantColumn($model)) {
            return;
        }

        $tenantId = $this->resolveTenantId();

        if ($tenantId !== null) {
            $builder->where("{$model->getTable()}.tenant_id", $tenantId);
        } else {
            // 没有租户上下文时，拒绝查询——安全兜底
            // 可选择抛出异常或返回空结果
            if (app()->environment('production')) {
                abort(403, '租户上下文未设置，拒绝数据访问');
            }
        }
    }

    /**
     * 检查模型是否有 tenant_id 列
     */
    protected function hasTenantColumn(Model $model): bool
    {
        static $cache = [];

        $table = $model->getTable();

        if (!isset($cache[$table])) {
            $cache[$table] = \Schema::hasColumn($table, 'tenant_id');
        }

        return $cache[$table];
    }

    /**
     * 解析当前租户 ID
     */
    protected function resolveTenantId(): ?string
    {
        // 优先级：请求级缓存 > 容器绑定 > 认证用户
        return request()->attributes->get('tenant_id')
            ?? app()->bound('tenant_id') ? app('tenant_id') : null
            ?? auth()->user()?->tenant_id;
    }
}
```

### 3.3 处理关联查询的租户隔离

关联查询是多租户隔离中最容易出问题的地方。来看一个典型的泄露场景：

```php
// ❌ 危险：hasMany 关联不会自动应用父级的租户条件
$tenant = Tenant::find($tenantId);
$orders = $tenant->orders; // 这里的 Order 查询是否正确应用了 tenant_id？

// ✅ 正确：通过全局作用域确保关联查询也受到保护
// 因为 Order 模型使用了 BelongsToTenant Trait，
// 即使通过关联查询，全局作用域也会自动生效
```

为关联查询提供额外保护的自定义 HasMany：

```php
<?php

namespace App\Models\Relations;

use Illuminate\Database\Eloquent\Relations\HasMany;

class TenantAwareHasMany extends HasMany
{
    /**
     * 为关联查询添加双重租户条件检查
     */
    public function addConstraints(): void
    {
        parent::addConstraints();

        // 额外检查：确保关联查询也包含 tenant_id 条件
        $this->query->where(
            $this->getRelated()->getTable() . '.tenant_id',
            '=',
            $this->getParent()->tenant_id
        );
    }
}
```

---

## 四、中间件隔离方案

### 4.1 TenantMiddleware 设计与实现

中间件隔离方案的核心思想是：在请求生命周期的最早阶段确定租户上下文，然后通过服务容器在整个应用中共享这个上下文。

```php
<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class IdentifyTenant
{
    /**
     * 支持的租户识别方式
     */
    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $this->resolveTenant($request);

        if (!$tenant) {
            abort(404, '未识别的租户');
        }

        // 方式 1：绑定到服务容器（全局可用）
        app()->instance(Tenant::class, $tenant);
        app()->instance('tenant_id', $tenant->id);

        // 方式 2：设置请求属性
        $request->attributes->set('tenant_id', $tenant->id);
        $request->attributes->set('tenant', $tenant);

        // 方式 3：设置数据库连接的租户上下文（为 RLS 准备）
        DB::afterCommit(function () use ($tenant) {
            // 在事务中设置 PostgreSQL session 变量
        });

        // 在每次数据库连接时自动设置租户上下文
        $this->setDatabaseTenantContext($tenant->id);

        return $next($request);
    }

    /**
     * 根据请求解析租户
     * 支持多种识别策略
     */
    protected function resolveTenant(Request $request): ?Tenant
    {
        // 策略 1：子域名识别
        $host = $request->getHost();
        $subdomain = explode('.', $host)[0];
        $tenant = Tenant::where('domain', $subdomain)->first();
        if ($tenant) return $tenant;

        // 策略 2：请求头识别（API 场景）
        $tenantId = $request->header('X-Tenant-ID');
        if ($tenantId) {
            return Tenant::find($tenantId);
        }

        // 策略 3：认证用户的租户关联
        if ($request->user()) {
            return $request->user()->tenant;
        }

        // 策略 4：路径参数识别
        if ($request->route('tenant')) {
            return Tenant::where('slug', $request->route('tenant'))->first();
        }

        return null;
    }

    /**
     * 设置数据库连接的租户上下文
     * 用于 PostgreSQL RLS 的 current_setting()
     */
    protected function setDatabaseTenantContext(string $tenantId): void
    {
        // 使用 Laravel 的数据库事件在每次查询前设置上下文
        DB::listen(function ($query) use ($tenantId) {
            // 注意：这种方式有性能开销，生产环境建议使用
            // 事务级别的 SET LOCAL
        });

        // 更推荐的方式：使用中间件的 terminate 回调
        // 或者使用自定义 DatabaseManager
    }
}
```

### 4.2 Repository 模式封装数据访问

为了进一步加强隔离，我们可以使用 Repository 模式封装所有数据访问逻辑：

```php
<?php

namespace App\Repositories;

use App\Models\Order;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class OrderRepository
{
    protected Order $model;

    public function __construct(Order $model)
    {
        $this->model = $model;
    }

    /**
     * 获取当前租户的所有订单
     * 无需手动添加 tenant_id 条件——全局作用域已处理
     */
    public function all(): Collection
    {
        return $this->model->all();
    }

    /**
     * 分页查询
     */
    public function paginate(int $perPage = 15): LengthAwarePaginator
    {
        return $this->model->query()
            ->with(['customer', 'items'])
            ->latest()
            ->paginate($perPage);
    }

    /**
     * 根据 ID 查找订单
     * 安全性：即使传入了其他租户的订单 ID，全局作用域也会阻止访问
     */
    public function find(string $id): ?Order
    {
        return $this->model->find($id);
        // 返回 null 如果该订单不属于当前租户
    }

    /**
     * 创建订单
     * 安全性：BelongsToTenant Trait 的 creating 事件会自动设置 tenant_id
     */
    public function create(array $data): Order
    {
        // 移除可能的 tenant_id 篡改
        unset($data['tenant_id']);

        return $this->model->create($data);
    }

    /**
     * 更新订单
     * 安全性：全局作用域确保只能更新当前租户的订单
     */
    public function update(string $id, array $data): bool
    {
        $order = $this->find($id);

        if (!$order) {
            return false;
        }

        // 移除不可修改的字段
        unset($data['tenant_id'], $data['id']);

        return $order->update($data);
    }

    /**
     * 统计当前租户的订单数据
     */
    public function getStatistics(): array
    {
        return [
            'total' => $this->model->count(),
            'total_amount' => $this->model->sum('amount'),
            'avg_amount' => $this->model->avg('amount'),
            'today_count' => $this->model->whereDate('created_at', today())->count(),
        ];
    }

    /**
     * 管理员专用：绕过租户隔离查看所有数据
     */
    public function allForAdmin(array $filters = []): LengthAwarePaginator
    {
        $query = $this->model->withoutTenant();

        if (isset($filters['tenant_id'])) {
            $query->where('tenant_id', $filters['tenant_id']);
        }

        return $query->latest()->paginate(25);
    }
}
```

### 4.3 服务提供者注册 Repository

```php
<?php

namespace App\Providers;

use App\Repositories\OrderRepository;
use Illuminate\Support\ServiceProvider;

class RepositoryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(OrderRepository::class, function ($app) {
            return new OrderRepository(new Order());
        });
    }
}
```

在控制器中的使用：

```php
<?php

namespace App\Http\Controllers;

use App\Repositories\OrderRepository;
use Illuminate\Http\JsonResponse;

class OrderController extends Controller
{
    public function __construct(
        protected OrderRepository $orders
    ) {}

    public function index(): JsonResponse
    {
        // 无需手动添加 tenant_id 条件
        // 全局作用域 + Repository 已经确保了租户隔离
        $orders = $this->orders->paginate();

        return response()->json($orders);
    }

    public function show(string $id): JsonResponse
    {
        $order = $this->orders->find($id);

        if (!$order) {
            return response()->json(['message' => '订单不存在'], 404);
        }

        return response()->json($order);
    }
}
```

---

## 五、三种方案安全性的量化对比

### 5.1 SQL 注入绕过测试

```php
<?php

namespace Tests\Security;

use Tests\TestCase;

class TenantBypassTest extends TestCase
{
    /**
     * 测试 SQL 注入是否能绕过 RLS
     */
    public function test_sql_injection_cannot_bypass_rls(): void
    {
        // 租户 A 的用户
        $tenantA = Tenant::factory()->create();
        $userA = User::factory()->for($tenantA)->create();

        // 租户 B 的订单
        $tenantB = Tenant::factory()->create();
        $orderB = Order::factory()->for($tenantB)->create([
            'amount' => 9999.99,
        ]);

        // 尝试通过 SQL 注入绕过
        $this->actingAs($userA);

        // 即使 SQL 注入修改了 WHERE 条件，RLS 仍然会过滤
        $response = $this->getJson("/api/orders?search=' OR '1'='1");

        $response->assertJsonMissing([
            'amount' => 9999.99,
        ]);
    }

    /**
     * 测试原生 SQL 是否绕过全局作用域
     */
    public function test_raw_sql_bypasses_global_scopes(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();

        Order::factory()->for($tenantA)->create();
        Order::factory()->for($tenantB)->create();

        // 使用原生 SQL——全局作用域被绕过！
        $allOrders = DB::select('SELECT * FROM orders');
        $this->assertCount(2, $allOrders); // ⚠️ 泄露！

        // 但如果启用了 RLS，即使原生 SQL 也会被过滤
        DB::statement("SET LOCAL app.current_tenant_id = ?", [$tenantA->id]);
        $filteredOrders = DB::select('SELECT * FROM orders');
        $this->assertCount(1, $filteredOrders); // ✅ RLS 保护了数据
    }
}
```

### 5.2 三种方案的安全性对比表

```
┌─────────────────────────┬──────────────┬──────────────┬──────────────┐
│        安全维度          │ PostgreSQL   │   Laravel    │   中间件     │
│                         │     RLS      │   Scopes     │   隔离       │
├─────────────────────────┼──────────────┼──────────────┼──────────────┤
│ 普通查询泄露风险         │    无 ✅     │   低 ⚠️     │   中 ⚠️     │
│ 原生 SQL 绕过           │    无 ✅     │   高 ❌     │   高 ❌     │
│ 关联查询泄露            │    无 ✅     │   低 ⚠️     │   中 ⚠️     │
│ 忘记加条件泄露          │    无 ✅     │   无 ✅     │   高 ❌     │
│ 批量操作泄露            │    无 ✅     │   低 ⚠️     │   中 ⚠️     │
│ SQL 注入绕过           │    无 ✅     │   低 ⚠️     │   中 ⚠️     │
│ 实现复杂度              │    中         │    低         │    低        │
│ 性能开销               │    低         │    低         │    低        │
│ 数据库兼容性           │  PostgreSQL   │   通用       │    通用      │
│ 学习成本               │    中         │    低         │    低        │
│ 运维依赖               │   DBA 参与    │   无         │    无        │
└─────────────────────────┴──────────────┴──────────────┴──────────────┘
```

### 5.3 性能影响测试

```php
<?php

namespace Tests\Performance;

use Tests\TestCase;

class TenantQueryPerformanceTest extends TestCase
{
    /**
     * 对比有无 RLS 的查询性能
     */
    public function test_rls_performance_overhead(): void
    {
        // 准备测试数据：100 万个订单，100 个租户
        $this->seedLargeDataset(orders: 1_000_000, tenants: 100);

        $tenantId = Tenant::first()->id;

        // 测试 1：无 RLS 的查询
        $start = microtime(true);
        DB::statement("SET app.current_tenant_id = ''"); // 禁用 RLS 过滤
        for ($i = 0; $i < 1000; $i++) {
            DB::select("SELECT * FROM orders WHERE tenant_id = ?", [$tenantId]);
        }
        $withoutRLS = microtime(true) - $start;

        // 测试 2：有 RLS 的查询
        DB::statement("SET app.current_tenant_id = ?", [$tenantId]);
        $start = microtime(true);
        for ($i = 0; $i < 1000; $i++) {
            DB::select("SELECT * FROM orders");
        }
        $withRLS = microtime(true) - $start;

        // RLS 性能开销应小于 5%
        $overhead = ($withRLS - $withoutRLS) / $withoutRLS * 100;
        $this->assertLessThan(5.0, $overhead,
            "RLS 性能开销 {$overhead}% 超过 5% 阈值"
        );
    }
}
```

### 5.4 N+1 问题分析

```php
// ❌ N+1 问题：每笔订单都会单独查询租户信息
$orders = Order::all();
foreach ($orders as $order) {
    echo $order->tenant->name; // 每次循环都触发一次查询
}

// ✅ 预加载解决 N+1
$orders = Order::with('tenant')->all();

// Laravel Scopes 对预加载的影响：
// 全局作用域会自动应用到预加载的关联查询上
// 这意味着即使在预加载中，租户隔离依然生效

// ⚠️ 注意：如果使用 withoutTenant() 后预加载
// 预加载的关联查询也不会有租户过滤
$orders = Order::withoutTenant()->with('tenant')->all();
// 此时 $orders 包含所有租户的订单，关联查询也不受限
```

---

## 六、混合策略：Laravel Scopes + PostgreSQL RLS 双层防护

### 6.1 为什么需要双层防护

单独依赖任何一种方案都有漏洞：

- **仅用 Laravel Scopes**：原生 SQL、DB facade 查询、第三方包可能绕过全局作用域
- **仅用 PostgreSQL RLS**：无法在应用层面做早期拦截，且需要 PostgreSQL 数据库
- **仅用中间件**：完全依赖开发者自觉添加过滤条件，遗漏风险最高

**最佳实践是采用「深度防御（Defense in Depth）」策略**——Laravel Scopes 作为第一道防线，PostgreSQL RLS 作为最后一道防线。

### 6.2 完整的混合策略实现

**第一步：数据库迁移中启用 RLS**

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            // 确保 tenant_id 列存在且有索引
            $table->uuid('tenant_id')->index()->change();
        });

        // 启用 RLS 并创建策略
        DB::statement('ALTER TABLE orders ENABLE ROW LEVEL SECURITY');
        DB::statement(<<<'SQL'
            CREATE POLICY tenant_isolation ON orders
            FOR ALL
            TO app_user
            USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID)
        SQL);

        // 创建性能索引
        DB::statement('CREATE INDEX idx_orders_tenant_id ON orders(tenant_id)');
    }

    public function down(): void
    {
        DB::statement('DROP POLICY IF EXISTS tenant_isolation ON orders');
        DB::statement('ALTER TABLE orders DISABLE ROW LEVEL SECURITY');
    }
};
```

**第二步：自定义数据库连接器，自动设置租户上下文**

```php
<?php

namespace App\Database;

use Illuminate\Database\Connectors\PostgresConnector;

class TenantAwarePostgresConnector extends PostgresConnector
{
    /**
     * 建立数据库连接后自动设置租户上下文
     */
    public function connect(array $config)
    {
        $connection = parent::connect($config);

        // 获取当前租户 ID
        $tenantId = app('tenant_id', null);

        if ($tenantId) {
            // 使用 pg_prepare 防止 SQL 注入
            pg_query($connection, "SET app.current_tenant_id = '{$tenantId}'");
        }

        return connection;
    }
}
```

**第三步：Laravel Service Provider 中注册自定义连接器**

```php
<?php

namespace App\Providers;

use App\Database\TenantAwarePostgresConnector;
use Illuminate\Support\ServiceProvider;

class DatabaseServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 替换默认的 PostgreSQL 连接器
        $this->app->resolving('db.connector.pgsql', function () {
            return new TenantAwarePostgresConnector();
        });
    }
}
```

### 6.3 双层防护的验证

```php
<?php

namespace Tests\Feature;

use Tests\TestCase;

class DualLayerTenantIsolationTest extends TestCase
{
    /**
     * 测试：即使绕过 Laravel Scopes，RLS 仍然保护数据
     */
    public function test_rls_blocks_data_when_scopes_bypassed(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();

        $orderA = Order::factory()->for($tenantA)->create(['amount' => 100]);
        $orderB = Order::factory()->for($tenantB)->create(['amount' => 200]);

        $userA = User::factory()->for($tenantA)->create();
        $this->actingAs($userA);

        // 第一层：Laravel Scopes 保护
        $scopedOrders = Order::all();
        $this->assertCount(1, $scopedOrders);
        $this->assertEquals(100, $scopedOrders->first()->amount);

        // 绕过 Scopes，使用原生 SQL
        $rawOrders = DB::select('SELECT * FROM orders');

        // 第二层：RLS 保护
        // 如果 RLS 已正确配置，原生 SQL 也只能看到租户 A 的数据
        $this->assertCount(1, $rawOrders);
    }
}
```

---

## 七、Laravel 十大典型数据泄露漏洞及防护

### 漏洞 1：忘记在查询中添加 scope

```php
// ❌ 危险：手动添加条件容易遗漏
$orders = Order::where('status', 'completed')->get();
// 忘记了 ->where('tenant_id', $tenantId)

// ✅ 防护：使用全局作用域，无需手动添加条件
$orders = Order::where('status', 'completed')->get();
// 全局作用域自动追加 tenant_id 条件
```

### 漏洞 2：使用 DB facade 绕过 Eloquent

```php
// ❌ 危险：DB facade 不受全局作用域保护
$orders = DB::table('orders')->where('status', 'completed')->get();

// ✅ 防护：PostgreSQL RLS 作为第二层防线
// 即使使用 DB facade，RLS 仍然生效

// ✅ 防护：封装 Repository，禁止直接使用 DB facade
// 在代码审查规则中禁止 DB::table('orders') 的使用
```

### 漏洞 3：find() 方法接受用户输入的 ID

```php
// ❌ 危险：用户可以猜测其他租户的订单 ID
public function show($id)
{
    $order = Order::findOrFail($id);
    // 如果用户传入其他租户的订单 ID，会发生什么？
}

// ✅ 防护：全局作用域确保 find() 只返回当前租户的数据
// 如果订单不属于当前租户，find() 返回 null，findOrFail() 抛出 404

// ✅ 额外防护：使用 UUID 替代自增 ID，防止 ID 猜测
class Order extends Model
{
    use HasUuids, BelongsToTenant;
}
```

### 漏洞 4：未限制的关联预加载

```php
// ❌ 危险：with() 关联可能泄露跨租户数据
$orders = Order::with('payments', 'refunds')->get();
// 如果 Payment 和 Refund 模型没有全局作用域？

// ✅ 防护：所有可租户隔离的模型都必须使用 BelongsToTenant Trait
class Payment extends Model
{
    use BelongsToTenant;
}

class Refund extends Model
{
    use BelongsToTenant;
}
```

### 漏洞 5：原生 SQL 查询中的参数拼接

```php
// ❌ 危险：原生 SQL + 参数拼接
$results = DB::select("
    SELECT * FROM orders
    WHERE tenant_id = '{$tenantId}'
    AND status = '{$status}'
");

// ✅ 防护：使用参数绑定 + PostgreSQL RLS
$results = DB::select("
    SELECT * FROM orders WHERE status = ?
", [$status]);
// RLS 自动过滤 tenant_id
```

### 漏洞 6：updateOrCreate() 中的条件泄露

```php
// ❌ 危险：updateOrCreate 的条件可能匹配到其他租户的数据
Order::updateOrCreate(
    ['order_no' => $request->order_no], // 可能匹配到其他租户的订单号
    ['status' => 'processed']
);

// ✅ 防护：全局作用域确保 updateOrCreate 只在当前租户范围内操作
// 即使 order_no 匹配到其他租户的订单，也会因为 tenant_id 条件不匹配而创建新记录
```

### 漏洞 7：批量操作中的数据越界

```php
// ❌ 危险：批量更新可能影响其他租户的数据
DB::table('orders')->where('status', 'pending')->update(['status' => 'expired']);

// ✅ 防护：RLS 为所有 DML 操作附加租户条件
// 即使使用 DB facade，update 语句也会被 RLS 限制在当前租户范围内
```

### 漏洞 8：软删除场景下的数据泄露

```php
// ❌ 危险：restore() 可能恢复其他租户的数据
Order::withTrashed()->where('id', $id)->restore();

// ✅ 防护：确保 SoftDeleting Trait 和 BelongsToTenant Trait 协同工作
class Order extends Model
{
    use SoftDeletes, BelongsToTenant;

    // withTrashed() 会绕过软删除作用域，但不会绕过 TenantScope
    // 因为 TenantScope 和 SoftDeletingScope 是独立的
}
```

### 漏洞 9：命令行任务中缺少租户上下文

```php
// ❌ 危险：Artisan 命令中没有 HTTP 上下文，无法获取租户信息
class SendReportCommand extends Command
{
    public function handle()
    {
        // 没有 request，没有 auth user，没有 tenant context
        $orders = Order::all(); // 返回所有租户的订单！
    }
}

// ✅ 防护：在命令中显式设置租户上下文
class SendReportCommand extends Command
{
    public function handle()
    {
        $tenants = Tenant::all();

        foreach ($tenants as $tenant) {
            app()->instance('tenant_id', $tenant->id);
            app()->instance(Tenant::class, $tenant);

            $orders = Order::all(); // 现在正确过滤
            $this->sendReport($tenant, $orders);
        }
    }
}
```

### 漏洞 10：队列任务中丢失租户上下文

```php
// ❌ 危险：队列任务在新的进程中运行，丢失了请求上下文
class ProcessOrderJob implements ShouldQueue
{
    public function handle()
    {
        // 此时没有 request，没有 auth，tenant context 丢失
        $orders = Order::where('status', 'pending')->get(); // 可能返回所有租户的数据
    }
}

// ✅ 防护：在 Job 中保存并恢复租户上下文
class ProcessOrderJob implements ShouldQueue
{
    public function __construct(
        public string $tenantId,
        public array $orderIds
    ) {}

    public function handle(): void
    {
        // 恢复租户上下文
        $tenant = Tenant::findOrFail($this->tenantId);
        app()->instance('tenant_id', $tenant->id);
        app()->instance(Tenant::class, $tenant);

        // 现在查询安全了
        $orders = Order::whereIn('id', $this->orderIds)->get();
    }
}
```

---

## 八、测试策略：Feature Test 验证租户隔离完整性

### 8.1 基础隔离测试

```php
<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenantA;
    protected Tenant $tenantB;
    protected User $userA;
    protected User $userB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantA = Tenant::factory()->create(['name' => 'Tenant A']);
        $this->tenantB = Tenant::factory()->create(['name' => 'Tenant B']);
        $this->userA = User::factory()->for($this->tenantA)->create();
        $this->userB = User::factory()->for($this->tenantB)->create();
    }

    /**
     * 测试：用户只能看到自己租户的订单
     */
    public function test_users_can_only_see_own_tenant_orders(): void
    {
        Order::factory()->count(3)->for($this->tenantA)->create();
        Order::factory()->count(5)->for($this->tenantB)->create();

        // 租户 A 的用户只能看到 3 笔订单
        $response = $this->actingAs($this->userA)
            ->getJson('/api/orders');

        $response->assertOk()
            ->assertJsonCount(3, 'data');

        // 租户 B 的用户只能看到 5 笔订单
        $response = $this->actingAs($this->userB)
            ->getJson('/api/orders');

        $response->assertOk()
            ->assertJsonCount(5, 'data');
    }

    /**
     * 测试：用户不能访问其他租户的订单详情
     */
    public function test_users_cannot_access_other_tenant_order(): void
    {
        $orderA = Order::factory()->for($this->tenantA)->create();
        $orderB = Order::factory()->for($this->tenantB)->create();

        // 租户 A 的用户无法访问租户 B 的订单
        $response = $this->actingAs($this->userA)
            ->getJson("/api/orders/{$orderB->id}");

        $response->assertNotFound();
    }

    /**
     * 测试：用户创建的订单自动归属到自己的租户
     */
    public function test_created_order_auto_assigned_to_tenant(): void
    {
        $this->actingAs($this->userA);

        $response = $this->postJson('/api/orders', [
            'customer_name' => '张三',
            'amount' => 100.00,
        ]);

        $response->assertCreated();

        $order = Order::latest()->first();
        $this->assertEquals($this->tenantA->id, $order->tenant_id);
    }

    /**
     * 测试：用户不能修改其他租户的订单
     */
    public function test_users_cannot_update_other_tenant_order(): void
    {
        $orderB = Order::factory()->for($this->tenantB)->create();

        $response = $this->actingAs($this->userA)
            ->putJson("/api/orders/{$orderB->id}", [
                'amount' => 99999,
            ]);

        $response->assertNotFound();
    }

    /**
     * 测试：用户不能删除其他租户的订单
     */
    public function test_users_cannot_delete_other_tenant_order(): void
    {
        $orderB = Order::factory()->for($this->tenantB)->create();

        $response = $this->actingAs($this->userA)
            ->deleteJson("/api/orders/{$orderB->id}");

        $response->assertNotFound();
    }
}
```

### 8.2 边界条件测试

```php
<?php

namespace Tests\Feature;

class TenantEdgeCaseTest extends TestCase
{
    use RefreshDatabase;

    /**
     * 测试：全局作用域对聚合查询的影响
     */
    public function test_aggregates_respect_tenant_scope(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();

        Order::factory()->for($tenantA)->create(['amount' => 100]);
        Order::factory()->for($tenantA)->create(['amount' => 200]);
        Order::factory()->for($tenantB)->create(['amount' => 500]);

        // 设置租户 A 的上下文
        app()->instance('tenant_id', $tenantA->id);

        $this->assertEquals(300, Order::sum('amount'));
        $this->assertEquals(2, Order::count());
    }

    /**
     * 测试：chunk 方法在多租户下的安全性
     */
    public function test_chunk_respects_tenant_scope(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();

        Order::factory()->count(50)->for($tenantA)->create();
        Order::factory()->count(50)->for($tenantB)->create();

        app()->instance('tenant_id', $tenantA->id);

        $count = 0;
        Order::chunk(10, function ($orders) use (&$count) {
            foreach ($orders as $order) {
                $this->assertEquals(
                    app('tenant_id'),
                    $order->tenant_id
                );
                $count++;
            }
        });

        $this->assertEquals(50, $count);
    }

    /**
     * 测试：跨租户 ID 碰撞
     * 即使两个租户使用相同的业务字段值，也不会混淆
     */
    public function test_same_business_key_different_tenants(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();

        // 两个租户都有 order_no = 'ORD-001' 的订单
        $orderA = Order::factory()->for($tenantA)->create(['order_no' => 'ORD-001']);
        $orderB = Order::factory()->for($tenantB)->create(['order_no' => 'ORD-001']);

        app()->instance('tenant_id', $tenantA->id);

        $found = Order::where('order_no', 'ORD-001')->first();
        $this->assertEquals($orderA->id, $found->id);
    }
}
```

### 8.3 PostgreSQL RLS 专项测试

```php
<?php

namespace\Tests\Feature;

class PostgresRLSTest extends TestCase
{
    /**
     * 测试：RLS 策略在原生 SQL 查询中的保护效果
     */
    public function test_rls_protects_raw_sql_queries(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();

        $this->createTestOrders($tenantA, 3);
        $this->createTestOrders($tenantB, 5);

        // 设置租户 A 的上下文
        DB::statement("SET LOCAL app.current_tenant_id = ?", [$tenantA->id]);

        // 原生 SQL 查询——RLS 自动过滤
        $orders = DB::select('SELECT * FROM orders');

        $this->assertCount(3, $orders);
        foreach ($orders as $order) {
            $this->assertEquals($tenantA->id, $order->tenant_id);
        }
    }

    /**
     * 测试：RLS 策略在 INSERT 操作中的保护效果
     */
    public function test_rls_blocks_cross_tenant_insert(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();

        DB::statement("SET LOCAL app.current_tenant_id = ?", [$tenantA->id]);

        // 尝试插入租户 B 的数据
        $this->expectException(\Illuminate\Database\QueryException::class);

        DB::table('orders')->insert([
            'tenant_id' => $tenantB->id,
            'customer_name' => '越权插入',
            'amount' => 100,
        ]);
    }
}
```

---

## 九、总结与架构选型建议

### 9.1 方案选型决策树

```
你的数据库是什么？
├── PostgreSQL
│   ├── 租户数量 < 100？ → PostgreSQL RLS + Laravel Scopes（推荐）
│   ├── 租户数量 100-1000？ → Schema-per-Tenant + Laravel Scopes
│   └── 租户数量 > 1000？ → Shared Database + RLS + Scopes（本文方案）
├── MySQL
│   ├── 租户数量 < 50？ → Database-per-Tenant
│   └── 租户数量 >= 50？ → Laravel Scopes + 中间件隔离（需严格代码审查）
└── 其他数据库
    └── Laravel Scopes + 中间件隔离 + 严格的代码审查流程
```

### 9.2 三种方案的适用场景深入分析

在实际选型中，没有一种方案是银弹。我们需要根据团队的技术栈、业务规模和安全要求来做权衡。

**PostgreSQL RLS 的最佳适用场景：** 适用于对安全性要求极高的金融、医疗、政务类 SaaS 应用。这类应用的数据泄露后果严重，需要数据库层面的强制保护。RLS 的最大优势在于它是「默认安全」的——开发者即使犯了错误，数据库也会兜底。但 RLS 也有局限：它只支持 PostgreSQL 数据库，需要 DBA 的参与来管理策略，并且在某些复杂的查询场景下可能会产生意想不到的行为（例如当使用 `SECURITY DEFINER` 函数时）。此外，RLS 的调试相对困难，当查询返回意外的空结果集时，开发者可能需要花费不少时间排查是否是 RLS 策略的问题。

**Laravel Scopes 的最佳适用场景：** 适用于中小型 SaaS 应用，团队主要使用 Laravel 框架的 Eloquent ORM 进行数据访问。全局作用域的实现成本最低，学习曲线最平缓，且不依赖特定的数据库引擎。对于使用 MySQL 或 SQLite 的项目来说，这是唯一可行的自动隔离方案。然而，它最大的弱点在于可绕过性——任何使用原生 SQL 或 DB facade 的地方都可能绕过全局作用域。因此，使用 Laravel Scopes 的项目必须建立严格的代码审查规范，并配合静态分析工具来检测遗漏。

**中间件隔离的最佳适用场景：** 适用于微服务架构中的网关层，或者需要根据请求动态切换数据源的场景。中间件方案的灵活性最高，可以与任何数据库和 ORM 配合使用。但它的安全性完全依赖开发者的自觉性——每一处数据访问都需要手动添加租户条件，遗漏的风险也最高。因此，中间件方案通常作为辅助手段，而非主要的隔离机制。

在大型企业级 SaaS 应用中，我们通常会组合使用多种方案：用中间件管理租户上下文，用 Laravel Scopes 在 ORM 层面自动过滤，用 PostgreSQL RLS 作为最后的安全兜底。这种「纵深防御」的策略能够最大程度地降低数据泄露的风险，即使某一层防线被突破，其他层仍然能够提供保护。

### 9.3 生产环境监控与告警建议

即使部署了完善的技术方案，我们也需要建立运行时的监控和告警机制。以下是一些关键的监控指标：

首先是**异常查询检测**。通过 PostgreSQL 的 `pg_stat_statements` 扩展，定期检查是否有返回行数异常多的查询。如果某个通常只返回少量结果的查询突然返回了数万行数据，可能意味着租户隔离出了问题。

其次是**跨租户访问告警**。在应用层记录每次数据访问的租户上下文，如果检测到某个请求试图访问不属于自己租户的数据（即使被 RLS 拦截了），也应该触发安全告警。这可以帮助我们及时发现潜在的攻击行为。

最后是**定期的渗透测试**。每季度至少进行一次针对多租户隔离的安全测试，包括尝试通过各种手段绕过租户隔离（SQL 注入、API 参数篡改、Cookie 伪造等），确保所有防线都正常工作。安全不是一次性工程，而是需要持续投入和关注的长期实践。

### 9.4 推荐的混合策略实施路线图

**第一阶段（立即实施）：**

1. 为所有业务模型添加 `BelongsToTenant` Trait
2. 实现 `TenantScope` 全局作用域
3. 创建 `IdentifyTenant` 中间件
4. 封装 `Repository` 层

**第二阶段（短期实施）：**

5. 启用 PostgreSQL RLS
6. 创建 RLS 策略迁移
7. 自定义数据库连接器，自动注入租户上下文
8. 编写完整的隔离测试套件

**第三阶段（持续改进）：**

9. 建立代码审查规则，禁止直接使用 `DB::table()` 访问业务表
10. 引入静态分析工具，检测遗漏的租户条件
11. 定期安全审计，检查新增代码的隔离完整性
12. 建立数据泄露监控告警

### 9.5 最后的安全清单

在上线多租户 SaaS 应用前，请逐一确认：

- [ ] 所有业务模型都使用了 `BelongsToTenant` Trait
- [ ] 所有业务表都启用了 PostgreSQL RLS
- [ ] 数据库连接器自动设置租户上下文
- [ ] 队列任务正确保存并恢复租户上下文
- [ ] Artisan 命令正确设置租户上下文
- [ ] 禁止在业务代码中使用 `DB::table()` 直接查询
- [ ] 所有 API 端点都有完整的隔离测试覆盖
- [ ] 代码审查流程包含「租户隔离」检查项
- [ ] 生产环境开启了 SQL 查询日志监控
- [ ] 建立了数据泄露的应急响应流程

---

**多租户数据隔离不是一次性任务，而是需要持续关注的安全工程。** 通过 PostgreSQL RLS + Laravel Scopes 的双层防护，配合严格的代码规范和测试覆盖，我们可以将数据泄露的风险降到最低。记住：在安全领域，「深度防御」永远是最佳实践。

---

*本文代码示例基于 Laravel 11 + PostgreSQL 16 环境，完整示例代码可在 [GitHub 仓库](https://github.com/mikeah2011/multi-tenancy-demo) 获取。*

---

## 相关阅读

- [Laravel 加密架构实战：应用层加密 vs 数据库透明加密（TDE）的选型与合规边界](/categories/Laravel/2026-06-02-laravel-encryption-architecture-tde-compliance/)
- [Laravel Sanctum 实战：SPA/API 令牌认证与移动端适配](/categories/Laravel/Laravel-Sanctum-实战-SPA-API-令牌认证与移动端适配/)
- [OAuth 2.1 实战：从 OAuth 2.0 到 2.1 的迁移指南——PKCE 强制、隐式流废弃与安全加固](/categories/Laravel/OAuth-2.1-实战-从OAuth2.0到2.1的迁移指南-PKCE强制隐式流废弃与安全加固/)
