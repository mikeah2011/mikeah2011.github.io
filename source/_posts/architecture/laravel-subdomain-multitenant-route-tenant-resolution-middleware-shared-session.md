---
title: "Laravel 子域名路由多租户实战：通配符子域识别、租户解析中间件与共享 Session 的跨域认证"
keywords: [Laravel, Session, 子域名路由多租户实战, 通配符子域识别, 租户解析中间件与共享, 的跨域认证, 架构]
date: 2026-06-10 06:25:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Laravel
  - 多租户
  - 子域名路由
  - 中间件
  - Session
  - PHP
description: "用 Laravel 路由子域名实现多租户架构：从通配符 DNS 配置、RouteServiceProvider 注册、租户解析中间件到跨子域共享 Session 的完整方案，附可运行代码与生产踩坑记录。"
---


## 为什么选子域名路由做多租户

多租户架构有三种主流方案：**独立数据库**、**Schema 隔离**、**共享数据库 + 行级隔离**。子域名路由是实现行级隔离的最自然方式——每个租户通过 `<tenant>.example.com` 访问，Laravel 路由层天然支持子域名分组。

子域名方案的核心优势：

- **URL 天然标识租户**，路由匹配零配置
- **共享应用实例**，部署和运维成本最低
- **Cookie 可以按子域作用域隔离**，安全性有保障

但也面临三个关键挑战：如何动态识别通配符子域、如何高效解析租户、如何在多个子域间共享认证状态。这篇文章逐一拆解。

## 核心架构：通配符 DNS + 路由注册

### DNS 配置

首先需要在 DNS 服务商配置通配符解析：

```
*.example.com  A  你的服务器IP
example.com    A  你的服务器IP
```

通配符 `*` 会匹配所有子域名，将流量统一导向 Laravel 应用。

### 路由注册

在 `app/Providers/RouteServiceProvider.php` 中注册租户路由分组：

```php
// app/Providers/RouteServiceProvider.php
namespace App\Providers;

use Illuminate\Support\Facades\Route;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;

class RouteServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 租户路由：匹配任意子域名
        Route::domain('{tenant}.example.com')->group(base_path('routes/tenant.php'));

        // 主域名路由
        Route::domain('example.com')->group(base_path('routes/web.php'));
    }
}
```

租户路由文件 `routes/tenant.php`：

```php
// routes/tenant.php
namespace App\Http\Controllers;

use Illuminate\Support\Facades\Route;

Route::middleware(['tenant.resolve', 'auth'])->group(function () {
    Route::get('/', [TenantController::class, 'dashboard'])->name('tenant.dashboard');
    Route::get('/settings', [TenantController::class, 'settings'])->name('tenant.settings');
    Route::get('/members', [MemberController::class, 'index'])->name('tenant.members');
});
```

关键点：`{tenant}` 是 Laravel 路由模型绑定的占位符，路由匹配时会自动注入到 request 中。但我们不应该在每个控制器里都解析它——这正是中间件的工作。

### 为什么用 `{tenant}` 而不是自定义解析

Laravel 的路由域名分组原生支持参数绑定。当请求到达 `acme.example.com` 时，框架自动将 `acme` 作为 `{tenant}` 参数提取出来。这意味着我们不需要手动解析 `$_SERVER['HTTP_HOST']`，也不需要在每个控制器方法里调用 `parse_url()`。路由层已经帮我们完成了第一步，接下来只需要在中间件里把这个 slug 转换成真正的 Tenant 模型即可。

另一个容易忽略的细节是路由参数的命名。`{tenant}` 这个名字不是随意取的——如果你在控制器里使用隐式路由模型绑定（type-hint Tenant），Laravel 会尝试自动解析它。但因为我们的 slug 不是主键 ID，需要手动解析后再注入到 Request 中，所以这里用中间件做显式绑定比依赖隐式模型绑定更可控。

## 租户模型与数据库设计

### 租户表

```sql
CREATE TABLE tenants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    status ENUM('active', 'suspended', 'trial') DEFAULT 'active',
    settings JSON DEFAULT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- slug 就是子域名部分，acme.example.com 的 slug 是 'acme'
CREATE INDEX idx_tenants_slug ON tenants(slug);
```

### Tenant 模型

```php
// app/Models/Tenant.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Tenant extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'domain', 'slug', 'status', 'settings'];
    protected $casts = ['settings' => 'array'];

    /**
     * 通过 slug 查找租户
     */
    public static function findBySlug(string $slug): ?static
    {
        return static::where('slug', $slug)->where('status', 'active')->first();
    }

    /**
     * 判断当前租户是否可以访问指定功能
     */
    public function canAccess(string $feature): bool
    {
        $features = $this->settings['features'] ?? [];
        return in_array($feature, $features);
    }
}
```

## 核心中间件：tenant.resolve

这是整个方案的关键——从请求中解析出当前租户，并绑定到容器中供后续使用。

```php
// app/Http/Middleware/TenantResolve.php
namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class TenantResolve
{
    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $this->resolveTenant($request);

        if (!$tenant) {
            abort(404, '租户不存在或已停用');
        }

        // 注入到 Request，后续控制器可通过 $request->tenant 获取
        $request->merge(['tenant' => $tenant]);

        // 同时绑定到服务容器，方便依赖注入
        app()->instance(Tenant::class, $tenant);

        // 设置数据库前缀（如果需要行级隔离）
        $this->setRowLevelScope($tenant);

        return $next($request);
    }

    private function resolveTenant(Request $request): ?Tenant
    {
        // 从请求中提取子域名
        $host = $request->getHost(); // acme.example.com
        $slug = $this->extractSlug($host);

        if (!$slug) {
            return null;
        }

        // 带缓存的租户解析，避免每次都查库
        return Cache::remember(
            "tenant:{$slug}",
            3600,
            fn () => Tenant::findBySlug($slug)
        );
    }

    private function extractSlug(string $host): ?string
    {
        // 移除端口号（开发环境常见）
        $host = parse_url("https://{$host}", PHP_URL_HOST) ?? $host;

        // 主域名列表——这些不是租户
        $apexDomains = [
            config('services.tenant.apex_domain', 'example.com'),
            'localhost',
        ];

        foreach ($apexDomains as $domain) {
            if ($host === $domain || $host === "www.{$domain}") {
                return null;
            }

            // 检查是否以 .domain 结尾
            if (str_ends_with($host, ".{$domain}")) {
                return substr($host, 0, strlen($host) - strlen($domain) - 1);
            }
        }

        // 本地开发环境特殊处理：acme.127.0.0.1.nip.io
        if (str_contains($host, '.127.0.0.1.nip.io')) {
            return explode('.127.0.0.1.nip.io', $host)[0];
        }

        return null;
    }

    private function setRowLevelScope(Tenant $tenant): void
    {
        // 全局作用域：所有模型查询自动加上 tenant_id 过滤
        // 这需要配合 HasTenant trait 使用（见下文）
    }
}
```

### 注册中间件

```php
// app/Http/Kernel.php
protected $middlewareAliases = [
    // ... 其他中间件
    'tenant.resolve' => \App\Http\Middleware\TenantResolve::class,
];
```

中间件的执行顺序很重要。`tenant.resolve` 必须在 `auth` 之前执行，因为认证逻辑可能依赖当前租户的上下文。比如在多租户场景下，同一个邮箱可能在不同租户下对应不同用户——如果先认证再解析租户，就可能出现权限混乱。

### 为什么不用 Service Provider 做租户解析

有人会问：为什么不在 `boot()` 方法里解析租户，而要单独写中间件？原因有三个：

1. **Service Provider 的 boot() 执行时机太早**。此时 Request 对象尚未完全初始化，某些请求信息（如子域名）可能无法可靠获取。
2. **中间件可以精确控制执行位置**。你可能希望某些路由不需要租户上下文（比如健康检查、公开页面），中间件分组可以灵活控制。
3. **测试更方便**。中间件可以单独测试，也可以在测试中绕过。

## 行级隔离：全局作用域

中间件解析出租户后，如何确保所有查询都自动带上 `tenant_id`？Laravel 的全局作用域（Global Scope）是最佳选择。

```php
// app/Scopes/TenantScope.php
namespace App\Scopes;

use App\Models\Tenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;
use Illuminate\Database\Eloquent\ScopeInterface;

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $tenant = app(Tenant::class);

        if ($tenant) {
            $builder->where('tenant_id', $tenant->id);
        }
    }

    public function extend(Builder $builder): void
    {
        // 提供 withoutTenant() 方法来绕过全局作用域
        $builder->macro('withoutTenant', function (Builder $builder) {
            return $builder->withoutGlobalScope(TenantScope::class);
        });
    }
}
```

```php
// app/Models/Concerns/HasTenant.php
namespace App\Models\Concerns;

use App\Scopes\TenantScope;

trait HasTenant
{
    public static function bootHasTenant(): void
    {
        static::addGlobalScope(new TenantScope());
    }

    /**
     * 自动填充 tenant_id
     */
    public static function bootHasTenantCreating(): void
    {
        static::creating(function ($model) {
            $tenant = app(\App\Models\Tenant::class);
            if ($tenant && !$model->tenant_id) {
                $model->tenant_id = $tenant->id;
            }
        });
    }
}
```

使用时，所有模型自动带上租户过滤：

```php
// app/Models/Project.php
namespace App\Models;

use App\Models\Concerns\HasTenant;
use Illuminate\Database\Eloquent\Model;

class Project extends Model
{
    use HasTenant;

    protected $fillable = ['name', 'description', 'tenant_id'];

    // 自动只返回当前租户的项目
    // Project::all() -> WHERE tenant_id = ?
}
```

## 共享 Session 的跨域认证

子域名之间共享登录状态是最容易踩坑的地方。核心问题是：`acme.example.com` 和 `www.example.com` 是不同域，Cookie 默认不会跨域携带。

### Session 驱动配置

```php
// config/session.php
return [
    'driver' => env('SESSION_DRIVER', 'cookie'),

    'lifetime' => 120, // 2小时
    'expire_on_close' => false,

    // 关键：Cookie 作用域设为主域名
    'domain' => env('SESSION_DOMAIN', '.example.com'),
    // 注意前面的点号——这表示 .example.com 下所有子域共享

    'secure' => env('SESSION_SECURE_COOKIE', true),
    'httponly' => true,
    'same_site' => 'lax',
];
```

`.example.com`（注意前面的点）意味着这个 Cookie 对 `example.com`、`acme.example.com`、`www.example.com` 都有效。用户在主站登录后，访问任意子域名都能携带认证 Cookie。

### 自定义 Session Cookie 名称

如果同一服务器跑多个 Laravel 应用，需要区分 Cookie 名称：

```php
// app/Http/Middleware/TenantResolve.php (补充)
public function handle(Request $request, Closure $next): Response
{
    // ... 解析租户逻辑

    // 动态设置 session cookie 名称
    config([
        'session.cookie' => 'laravel_session_' . $tenant->slug,
    ]);

    return $next($request);
}
```

### Sanctum Token 的跨域配置

如果前后端分离，用 Sanctum 做 API 认证：

```php
// config/sanctum.php
return [
    'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', sprintf(
        '%s%s',
        'example.com,*.example.com',
        env('APP_URL') ? ',' . parse_url(env('APP_URL'), PHP_URL_HOST) : ''
    ))),

    'guard' => ['web'],

    'expiration' => null, // token 永不过期，或设置秒数

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),
];
```

```env
# .env
SANCTUM_STATEFUL_DOMAINS=example.com,*.example.com,localhost,localhost:3000
SESSION_DOMAIN=.example.com
```

前端通过子域名访问时，请求会自动携带 Cookie，Sanctum 的 `Authenticate` 中间件可以正常识别。

## 缓存策略与租户切换

### 缓存前缀隔离

不同租户的数据缓存不应该互相污染：

```php
// app/Providers/TenantServiceProvider.php
namespace App\Providers;

use App\Models\Tenant;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Cache;

class TenantServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->booted(function () {
            $tenant = app(Tenant::class);
            if ($tenant) {
                // 动态切换缓存前缀
                config(['cache.prefix' => "tenant_{$tenant->id}_" . config('cache.prefix')]);
            }
        });
    }
}
```

或者用更精细的方式——每个模型的缓存键自带 `tenant_id`：

```php
// app/Models/Tenant.php
public function cacheKey(string $key): string
{
    return "tenant:{$this->id}:{$key}";
}

// 使用
$tenant = app(Tenant::class);
$projects = Cache::remember($tenant->cacheKey('projects'), 3600, function () {
    return Project::all();
});
```

### 切换租户的便捷方法

在测试或命令行中切换租户：

```php
// app/Helpers/TenantHelper.php
namespace App\Helpers;

use App\Models\Tenant;

class TenantHelper
{
    /**
     * 在闭包内切换到指定租户
     */
    public static function as(string $slug, callable $callback): mixed
    {
        $tenant = Tenant::findBySlug($slug);

        if (!$tenant) {
            throw new \RuntimeException("租户 [{$slug}] 不存在");
        }

        app()->instance(Tenant::class, $tenant);

        return $callback();
    }

    /**
     * 获取当前租户，如果不存在则抛异常
     */
    public static function current(): Tenant
    {
        $tenant = app(Tenant::class);

        if (!$tenant) {
            throw new \RuntimeException('当前没有活跃的租户上下文');
        }

        return $tenant;
    }
}
```

测试中使用：

```php
public function test_project_index_only_returns_current_tenant_projects(): void
{
    TenantHelper::as('acme', function () {
        Project::create(['name' => 'Acme Project']);

        $response = $this->getJson(route('tenant.projects.index'));

        $response->assertOk();
        $response->assertJsonCount(1, 'data');
        $response->assertJsonPath('data.0.name', 'Acme Project');
    });

    TenantHelper::as('globex', function () {
        // globex 应该看不到 acme 的项目
        $response = $this->getJson(route('tenant.projects.index'));

        $response->assertOk();
        $response->assertJsonCount(0, 'data');
    });
}
```

## 踩坑记录

### 坑 1：子域名解析顺序问题

**现象**：`localhost:8000` 的请求也被当作租户处理，报 404。

**原因**：`extractSlug` 方法没有排除开发环境的 host。

**修复**：

```php
private function extractSlug(string $host): ?string
{
    // 优先排除本地开发地址
    if (in_array($host, ['localhost', '127.0.0.1', '0.0.0.0'])) {
        return null;
    }

    // 处理 localhost:port 形式
    if (preg_match('/^localhost:\d+$/', $host)) {
        return null;
    }

    // 后续逻辑...
}
```

### 坑 2：缓存击穿导致的租户串数据

**现象**：A 租户的数据偶尔出现在 B 租户。

**原因**：缓存 key 没有包含 `tenant_id`，不同租户的相同 key 互相覆盖。

**修复**：所有缓存操作必须包含租户标识。用 `HasTenant` trait 自动处理：

```php
trait HasTenant
{
    public function cacheKey(string $suffix): string
    {
        return "tenant:{$this->tenant_id}:model:{$this->getTable()}:{$suffix}";
    }

    /**
     * 自动为 cache 带上租户前缀
     */
    public static function bootHasTenant(): void
    {
        static::addGlobalScope(new TenantScope());

        // 监听 cache 操作（可选，更保险）
    }
}
```

### 坑 3：Session Cookie 域名配置错误

**现象**：子域名登录后，主站还是未登录状态。

**原因**：`SESSION_DOMAIN` 没有加前面的点号。`example.com` 和 `.example.com` 的区别：

| 配置值 | 作用域 |
|--------|--------|
| `example.com` | 只对 `example.com` 生效 |
| `.example.com` | 对 `example.com` 及其所有子域生效 |

```env
# 正确 ✅
SESSION_DOMAIN=.example.com

# 错误 ❌
SESSION_DOMAIN=example.com
```

### 坑 4：Nginx 通配符子域名配置遗漏

**现象**：某些子域名返回 502 Bad Gateway。

**原因**：Nginx 的 `server_name` 没有正确配置通配符。

```nginx
server {
    listen 80;
    server_name *.example.com example.com;

    root /var/www/app/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

### 坑 5：租户 slug 规范

**问题**：租户 slug 包含特殊字符导致路由匹配失败。

**解决方案**：严格校验 slug 格式：

```php
// 租户创建时校验
public static function create(array $data): static
{
    $slug = Str::slug($data['slug']);

    // 只允许小写字母、数字和连字符
    if (!preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $slug)) {
        throw new \InvalidArgumentException("租户 slug 格式不合法: {$slug}");
    }

    if (strlen($slug) > 63) {
        throw new \InvalidArgumentException('租户 slug 长度不能超过 63 个字符');
    }

    $data['slug'] = $slug;
    $data['domain'] = "{$slug}.example.com";

    return parent::create($data);
}
```

## 性能优化

### 租户解析的缓存策略

每次请求都查数据库解析租户不可接受，需要用 Redis 缓存：

```php
private function resolveTenant(Request $request): ?Tenant
{
    $host = $request->getHost();
    $slug = $this->extractSlug($host);

    if (!$slug) {
        return null;
    }

    $cacheKey = "tenant_resolve:{$slug}";
    $tenant = Cache::get($cacheKey);

    if ($tenant === null) {
        $tenant = Tenant::findBySlug($slug);

        if ($tenant) {
            // 缓存 1 小时，活跃租户
            Cache::put($cacheKey, $tenant, 3600);
        } else {
            // 缓存 5 分钟的空结果，防止恶意探测
            Cache::put($cacheKey, false, 300);
        }
    }

    return $tenant instanceof Tenant ? $tenant : null;
}
```

### 数据库索引

租户相关的查询是系统中最频繁的操作之一，索引策略直接影响整体性能。`tenants` 表的 `slug` 字段必须有唯一索引，因为每次请求都会通过 slug 查询租户。同时，租户关联的业务表（如 `projects`、`tasks`）都需要在 `tenant_id` 上建立索引。

确保 `tenants` 表的 `slug` 字段有唯一索引：

```sql
-- 已经在建表语句中定义
-- UNIQUE KEY idx_tenants_slug (slug)

-- 如果已有表需要补索引
ALTER TABLE tenants ADD UNIQUE INDEX idx_tenants_slug (slug);
ALTER TABLE tenants ADD INDEX idx_tenants_status (status);
```

## 完整的控制器示例

```php
// app/Http/Controllers/TenantController.php
namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\Tenant;
use Illuminate\Http\JsonController;
use Illuminate\Http\Request;

class TenantController extends JsonController
{
    public function dashboard(Request $request)
    {
        $tenant = $request->tenant;

        return response()->json([
            'tenant' => [
                'name' => $tenant->name,
                'slug' => $tenant->slug,
                'domain' => $tenant->domain,
            ],
            'stats' => [
                'project_count' => Project::count(),
                'member_count' => $tenant->users()->count(),
            ],
        ]);
    }

    public function settings(Request $request)
    {
        $tenant = $request->tenant;

        return response()->json([
            'settings' => $tenant->settings,
            'features' => $tenant->settings['features'] ?? [],
        ]);
    }

    public function updateSettings(Request $request)
    {
        $tenant = $request->tenant;

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'settings.features' => 'sometimes|array',
            'settings.features.*' => 'string',
        ]);

        $tenant->update($validated);

        // 清除租户缓存
        cache()->forget("tenant:{$tenant->slug}");

        return response()->json(['message' => '设置已更新']);
    }
}
```

## 测试策略

```php
// tests/Feature/TenantTest.php
namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\Project;
use App\Helpers\TenantHelper;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // 创建测试租户
        Tenant::create([
            'name' => 'Acme Corp',
            'slug' => 'acme',
            'domain' => 'acme.example.com',
            'status' => 'active',
        ]);

        Tenant::create([
            'name' => 'Globex Inc',
            'slug' => 'globex',
            'domain' => 'globex.example.com',
            'status' => 'active',
        ]);
    }

    public function test_tenant_is_resolved_from_subdomain(): void
    {
        $response = $this->getJson('http://acme.example.com/api/dashboard');

        $response->assertOk();
        $response->assertJsonPath('tenant.slug', 'acme');
    }

    public function test_inactive_tenant_returns_404(): void
    {
        Tenant::where('slug', 'acme')->update(['status' => 'suspended']);

        $response = $this->getJson('http://acme.example.com/api/dashboard');

        $response->assertStatus(404);
    }

    public function test_tenant_data_isolation(): void
    {
        TenantHelper::as('acme', function () {
            Project::create(['name' => 'Acme Project', 'tenant_id' => 1]);
        });

        TenantHelper::as('globex', function () {
            // Globex 看不到 Acme 的项目
            $projects = Project::all();
            $this->assertCount(0, $projects);
        });
    }

    public function test_shared_session_across_subdomains(): void
    {
        // 模拟在主站登录
        $this->postJson('http://example.com/login', [
            'email' => 'admin@example.com',
            'password' => 'password',
        ])->assertOk();

        // 在子域名访问，应该保持登录状态
        $response = $this->getJson('http://acme.example.com/api/user');

        $response->assertOk();
    }
}
```

## 总结

子域名路由多租户方案的实现路径：

1. **DNS 层**：通配符解析，所有子域名指向同一服务器
2. **路由层**：`Route::domain('{tenant}.example.com')` 匹配子域
3. **中间件层**：`TenantResolve` 解析子域 → 查库/缓存 → 绑定到容器
4. **模型层**：`HasTenant` trait + 全局作用域实现行级隔离
5. **Session 层**：Cookie domain 设为 `.example.com` 实现跨域共享
6. **缓存层**：按租户隔离缓存前缀，防止数据串台

这套方案适合中小规模多租户场景（< 1000 租户）。当租户数量增长到需要独立数据库时，可以平滑迁移到独立 Schema 或独立数据库方案，核心的中间件和 trait 接口可以复用。

生产环境一定要注意：**Session domain 的点号**、**缓存 key 必须含 tenant_id**、**子域 slug 的严格校验**——这三点做对了，基本不会出大问题。

### 方案对比与适用场景

子域名路由多租户不是银弹，它有自己的适用边界：

| 方案 | 适用场景 | 优势 | 劣势 |
|------|---------|------|------|
| 子域名路由 | 中小规模（<1000 租户），品牌化需求 | URL 自然、部署简单 | 需要通配符 DNS、Cookie 配置 |
| 独立数据库 | 大客户、数据合规要求 | 完全隔离、可独立备份 | 运维成本高、跨租户查询困难 |
| Schema 隔离 | PostgreSQL 用户、中等规模 | 比独立库轻量、比行级隔离安全 | 依赖数据库特性、迁移复杂 |
| 行级隔离（无子域） | 内部系统、租户数少 | 最简单 | 安全性依赖代码质量 |

对于大多数 SaaS 产品来说，子域名路由 + 行级隔离是最务实的起点。它不需要复杂的基础设施，Laravel 原生就能支持，而且当规模增长时可以平滑迁移到更强的隔离方案。

最后一点忠告：**不要在项目初期就过度设计多租户架构**。先用最简单的方案跑起来，等真正遇到规模瓶颈或客户需求时再迭代。过早优化是万恶之源，多租户架构也不例外。
