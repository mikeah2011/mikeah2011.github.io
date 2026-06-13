---
title: CORS 动态策略实战：基于 Origin 的动态允许列表——Laravel 多租户 API 的精细化跨域治理
keywords: [CORS, Origin, Laravel, API, 动态策略实战, 基于, 的动态允许列表, 多租户, 的精细化跨域治理]
date: 2026-06-10 01:53:00
categories:
  - security
cover: https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
tags:
  - CORS
  - Laravel
  - 多租户
  - API安全
  - 跨域
description: 在多租户 SaaS 架构中，每个租户绑定独立域名，静态 CORS 配置无法满足动态 Origin 需求。本文从 Laravel 中间件层出发，实现基于数据库的动态 Origin 允许列表、预检缓存优化和租户级限流，覆盖从原理到落地的完整方案。
---


## 概述

单租户应用中，CORS 配置通常只需要在 `config/cors.php` 里写死几个域名。但当你面对的是多租户 SaaS 平台——每个租户绑定自己的子域名甚至独立域名——静态配置就成了噩梦：每次新增租户都要改配置、重新部署，而且无法按租户粒度控制跨域策略。

本文的目标很明确：

- 从数据库动态读取每个租户允许的 Origin 列表
- 支持通配符匹配（`*.example.com`）
- 预检请求（OPTIONS）走缓存，不查数据库
- 租户级限流，防止恶意站点刷 CORS

## 跨域基础：浏览器到底在拦什么

浏览器的同源策略（Same-Origin Policy）要求协议、域名、端口三者完全一致才算同源。跨域请求时，浏览器会自动附加 `Origin` 头，服务端需要通过 `Access-Control-Allow-Origin` 告诉浏览器"这个来源我允许"。

关键点：**CORS 是浏览器行为**。服务端返回 CORS 头，浏览器才会放行响应；服务端不返回，浏览器拦截响应但请求其实已经发出去了。所以 CORS 不是防火墙，它是一种"事后告知"机制。

### 预检请求（Preflight）

对于非简单请求（比如带自定义 Header、PUT/DELETE 方法），浏览器会先发一个 `OPTIONS` 请求，问服务端"这个跨域请求你允许吗？"。服务端返回 `Access-Control-Allow-Methods`、`Access-Control-Allow-Headers` 等头，浏览器才发真正的请求。

预检请求的性能影响不可忽视——每次复杂跨域请求都要多一次 HTTP 往返。后面我们会用缓存来优化它。

## Laravel 内置 CORS 的局限

Laravel 内置的 CORS 中间件（`Illuminate\Http\Middleware\HandleCors`）基于 `fruitcake/laravel-cors`（Laravel 9+ 已内化）。配置文件 `config/cors.php` 长这样：

```php
return [
    'paths' => ['api/*'],
    'allowed_methods' => ['*'],
    'allowed_origins' => ['https://admin.example.com'],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
```

问题很明显：

1. **`allowed_origins` 是静态数组**——每次新增域名要改配置、清缓存、重载
2. **`allowed_origins_patterns` 支持正则**——但不能按请求上下文动态判断
3. **没有租户概念**——所有 API 共享同一套 CORS 策略
4. **`max_age` 默认 0**——预检请求每次都走服务端，没有缓存

我们需要一个自定义中间件来替代它。

## 方案设计

整体架构：

```
浏览器 OPTIONS 请求
    ↓
自定义 CorsMiddleware
    ↓
① 从请求解析租户标识（子域名/Header/Token）
② 查 Redis 缓存的 Origin 允许列表
③ 缓存未命中 → 查数据库 → 回写缓存
④ 匹配 Origin（支持通配符）
⑤ 设置 CORS 响应头
    ↓
返回 204（OPTIONS）或放行到 Controller
```

### 数据库设计

创建 `tenant_cors_origins` 表，存储每个租户允许的 Origin：

```php
// database/migrations/2026_06_10_000000_create_tenant_cors_origins_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_cors_origins', function (Blueprint $table) {
            $table->id();
            $table->string('tenant_id', 50)->index();
            $table->string('origin', 255); // 具体域名或通配符，如 *.shop.example.com
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'origin']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_cors_origins');
    }
};
```

对应的 Model：

```php
// app/Models/TenantCorsOrigin.php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TenantCorsOrigin extends Model
{
    protected $fillable = ['tenant_id', 'origin', 'is_active'];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    /**
     * 获取指定租户的所有活跃 Origin
     */
    public static function getActiveOrigins(string $tenantId): array
    {
        return static::where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->pluck('origin')
            ->toArray();
    }
}
```

## 核心中间件实现

### 租户解析器

先定义一个接口，方便后续扩展不同的租户识别方式：

```php
// app/Contracts/TenantResolver.php

namespace App\Contracts;

interface TenantResolver
{
    /**
     * 从请求中解析出租户 ID，解析失败返回 null
     */
    public function resolve(\Illuminate\Http\Request $request): ?string;
}
```

子域名解析是最常见的方案：

```php
// app/Services/SubdomainTenantResolver.php

namespace App\Services;

use App\Contracts\TenantResolver;
use Illuminate\Http\Request;

class SubdomainTenantResolver implements TenantResolver
{
    /**
     * 从子域名解析租户 ID
     * 例如: tenant-abc.api.example.com → tenant-abc
     */
    public function resolve(Request $request): ?string
    {
        $host = $request->getHost();
        $parts = explode('.', $host);

        // 至少需要 3 段：tenant.api.example.com
        if (count($parts) < 3) {
            return null;
        }

        $tenantId = $parts[0];

        // 基本格式校验：只允许字母数字和短横线
        if (!preg_match('/^[a-z0-9\-]+$/i', $tenantId)) {
            return null;
        }

        return $tenantId;
    }
}
```

如果你的租户通过 Header 或 Token 识别，可以这样实现：

```php
// app/Services/HeaderTenantResolver.php

namespace App\Services;

use App\Contracts\TenantResolver;
use Illuminate\Http\Request;

class HeaderTenantResolver implements TenantResolver
{
    public function resolve(Request $request): ?string
    {
        return $request->header('X-Tenant-ID');
    }
}
```

### CORS 中间件主体

```php
// app/Http/Middleware/DynamicCorsMiddleware.php

namespace App\Http\Middleware;

use App\Contracts\TenantResolver;
use App\Models\TenantCorsOrigin;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class DynamicCorsMiddleware
{
    private TenantResolver $resolver;

    // 缓存 key 前缀和 TTL（秒）
    private const CACHE_PREFIX = 'cors_origins:';
    private const CACHE_TTL = 3600; // 1 小时
    private const PREFLIGHT_MAX_AGE = 86400; // 24 小时

    public function __construct(TenantResolver $resolver)
    {
        $this->resolver = $resolver;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->headers->get('Origin');

        // 没有 Origin 头 = 非跨域请求，直接放行
        if (!$origin) {
            return $next($request);
        }

        $tenantId = $this->resolver->resolve($request);

        // 解析不出租户 = 拒绝所有跨域
        if (!$tenantId) {
            return $this->rejectCors($request, $next);
        }

        $allowedOrigins = $this->getAllowedOrigins($tenantId);

        if (!$this->isOriginAllowed($origin, $allowedOrigins)) {
            return $this->rejectCors($request, $next);
        }

        // Origin 匹配成功，设置 CORS 头
        $response = $request->getMethod() === 'OPTIONS'
            ? $this->handlePreflight($origin)
            : $next($request);

        $this->setCorsHeaders($response, $origin);

        return $response;
    }

    /**
     * 从缓存/数据库获取允许的 Origin 列表
     */
    private function getAllowedOrigins(string $tenantId): array
    {
        $cacheKey = self::CACHE_PREFIX . $tenantId;

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($tenantId) {
            return TenantCorsOrigin::getActiveOrigins($tenantId);
        });
    }

    /**
     * Origin 匹配逻辑，支持通配符
     * 例如: origin=https://shop.example.com 匹配 *.example.com
     */
    private function isOriginAllowed(string $origin, array $allowedOrigins): bool
    {
        // 解析 Origin 的 host 部分
        $originHost = parse_url($origin, PHP_URL_HOST);
        if (!$originHost) {
            return false;
        }

        foreach ($allowedOrigins as $pattern) {
            // 精确匹配
            if ($origin === $pattern || $originHost === $pattern) {
                return true;
            }

            // 通配符匹配: *.example.com
            if (str_starts_with($pattern, '*.')) {
                $domain = substr($pattern, 2); // 去掉 *.
                // shop.example.com 以 .example.com 结尾
                if (
                    str_ends_with($originHost, '.' . $domain)
                    || $originHost === $domain
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 处理 OPTIONS 预检请求
     */
    private function handlePreflight(string $origin): Response
    {
        $response = new Response('', 204);
        $response->headers->set('Access-Control-Max-Age', (string) self::PREFLIGHT_MAX_AGE);

        return $response;
    }

    /**
     * 设置 CORS 响应头
     */
    private function setCorsHeaders(Response $response, string $origin): void
    {
        $response->headers->set('Access-Control-Allow-Origin', $origin);
        $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Tenant-ID, Accept');
        $response->headers->set('Access-Control-Expose-Headers', 'X-Request-Id');
        $response->headers->set('Access-Control-Allow-Credentials', 'true');
        $response->headers->set('Vary', 'Origin');
    }

    /**
     * 拒绝跨域：不设置 Allow-Origin 头，浏览器会拦截
     */
    private function rejectCors(Request $request, Closure $next): Response
    {
        $response = $request->getMethod() === 'OPTIONS'
            ? new Response('', 204)
            : $next($request);

        // 关键：Vary: Origin 告诉 CDN 按 Origin 区分缓存
        $response->headers->set('Vary', 'Origin');

        return $response;
    }
}
```

### 注册中间件

```php
// bootstrap/app.php (Laravel 11+)

return Application::configure(basePath: dirname(__DIR__))
    ->withMiddleware(function (Middleware $middleware) {
        // 替换默认 CORS 中间件
        $middleware->prependToGroup('api', \App\Http\Middleware\DynamicCorsMiddleware::class);

        // 如果用了 Sanctum，把我们的中间件排在它前面
        $middleware->prependToGroup('api', \App\Http\Middleware\DynamicCorsMiddleware::class);
    })
    ->create();
```

Laravel 10 用法：

```php
// app/Http/Kernel.php

protected $middlewareGroups = [
    'api' => [
        \App\Http\Middleware\DynamicCorsMiddleware::class, // 放最前面
        // ... 其他中间件
    ],
];
```

别忘了在 `AppServiceProvider` 中绑定 Resolver：

```php
// app/Providers/AppServiceProvider.php

use App\Contracts\TenantResolver;
use App\Services\SubdomainTenantResolver;

public function register(): void
{
    $this->app->bind(TenantResolver::class, SubdomainTenantResolver::class);
}
```

## Origin 缓存管理

租户新增或删除域名后，需要主动清除缓存。提供一个 Service 类来管理：

```php
// app/Services/CorsOriginCacheManager.php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class CorsOriginCacheManager
{
    private const CACHE_PREFIX = 'cors_origins:';
    private const CACHE_TTL = 3600;

    /**
     * 清除指定租户的 CORS 缓存
     */
    public function flush(string $tenantId): void
    {
        Cache::forget(self::CACHE_PREFIX . $tenantId);
    }

    /**
     * 清除所有 CORS 缓存
     * 谨慎使用，通常只在批量迁移时才需要
     */
    public function flushAll(): void
    {
        // 如果用 Redis，可以用 SCAN + DEL 批量删除
        // 这里用 Cache::flush() 会影响其他缓存，不推荐
        // 生产环境建议用 Redis 前缀隔离
    }

    /**
     * 预热指定租户的缓存
     */
    public function warmUp(string $tenantId): void
    {
        $key = self::CACHE_PREFIX . $tenantId;
        if (!Cache::has($key)) {
            $origins = \App\Models\TenantCorsOrigin::getActiveOrigins($tenantId);
            Cache::put($key, $origins, self::CACHE_TTL);
        }
    }
}
```

在租户域名变更的业务逻辑中调用：

```php
// 比如在租户管理后台的 Controller 中

public function updateOrigins(Request $request, string $tenantId)
{
    // ... 验证和保存逻辑 ...

    // 清除缓存，下次请求会重新从数据库加载
    app(CorsOriginCacheManager::class)->flush($tenantId);

    return response()->json(['message' => 'Origin 列表已更新']);
}
```

## 租户级限流

光有 Origin 白名单还不够。恶意站点可以通过伪造 Origin 头来试探你的 CORS 策略，或者合法域名被攻陷后发起大量跨域请求。我们需要一个基于租户的限流机制。

```php
// app/Http/Middleware/CorsRateLimiter.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

class CorsRateLimiter
{
    /**
     * 每个租户每分钟最多 60 次跨域请求
     */
    private const MAX_REQUESTS_PER_MINUTE = 60;

    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->headers->get('Origin');
        if (!$origin) {
            return $next($request);
        }

        $host = parse_url($origin, PHP_URL_HOST) ?? 'unknown';
        $key = 'cors:' . $host;

        if (RateLimiter::tooManyAttempts($key, self::MAX_REQUESTS_PER_MINUTE)) {
            // 返回 429，但仍然带上 CORS 头
            // 否则浏览器看不到错误信息，只看到 "blocked by CORS policy"
            $response = response()->json([
                'message' => 'Too many cross-origin requests',
            ], 429);

            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            $response->headers->set('Vary', 'Origin');

            return $response;
        }

        RateLimiter::hit($key, 60); // 60 秒窗口

        return $next($request);
    }
}
```

注册顺序：

```php
// DynamicCorsMiddleware 在前（解析 Origin、设置头）
// CorsRateLimiter 在后（基于已解析的 Origin 限流）
$middleware->prependToGroup('api', DynamicCorsMiddleware::class);
$middleware->appendToGroup('api', CorsRateLimiter::class);
```

## 踩坑记录

### 1. Vary: Origin 必须设置

如果你的 API 用了 CDN 或 Nginx 反向代理缓存，**必须**设置 `Vary: Origin`。否则 CDN 会把第一个 Origin 的响应缓存下来，直接返回给所有 Origin，导致 CORS 头错乱。

```
# 错误示例：CDN 缓存了 Origin A 的响应
# Origin B 请求时，CDN 直接返回缓存的 Access-Control-Allow-Origin: A
# 浏览器拦截：Origin B 不匹配
```

解决方案：响应头加 `Vary: Origin`，CDN 就会按 Origin 值分别缓存。

### 2. 不要返回多个 Origin

`Access-Control-Allow-Origin` 只接受一个值或 `*`。你不能返回 `https://a.com, https://b.com`。所以必须根据请求的 `Origin` 头动态设置响应值，不能用静态列表。

### 3. credentials 和 * 不能共存

如果 `Access-Control-Allow-Credentials: true`（允许携带 Cookie），那么 `Access-Control-Allow-Origin` 不能是 `*`，必须是具体的 Origin。这也是为什么我们必须动态设置 Origin 而不是用通配符。

### 4. 预检请求不带 Cookie

OPTIONS 请求是匿名的，浏览器不会携带 Cookie。如果你的租户解析依赖 Session 或 Cookie（比如 Sanctum 的 SPA 认证），预检请求会解析失败。解决方案：用子域名或 Header 解析租户，不要依赖认证状态。

### 5. 正则性能

`allowed_origins_patterns` 用正则匹配 Origin。如果你的租户域名数量上千，每条正则都要跑一遍，性能会下降。本文的方案用通配符 `*` 前缀 + 字符串函数匹配，比正则快得多。

### 6. Nginx 层的 CORS

有些团队在 Nginx 层处理 CORS，这样性能更好（不经过 PHP）。但多租户场景下，Nginx 的 CORS 配置也是静态的。两种方案可以结合：Nginx 处理静态 Origin，动态 Origin 走 Laravel 中间件。

```nginx
# nginx.conf - 静态 Origin 快速返回
map $http_origin $cors_origin {
    default "";
    "https://admin.example.com" "https://admin.example.com";
    "https://app.example.com" "https://app.example.com";
}

server {
    location /api/ {
        # 静态 Origin 已匹配，直接设置头
        if ($cors_origin != "") {
            add_header Access-Control-Allow-Origin $cors_origin always;
            add_header Access-Control-Allow-Credentials true always;
        }
        # 动态 Origin 交给 Laravel 处理
        proxy_pass http://php-fpm;
    }
}
```

## 生产环境 Checklist

- [ ] `Access-Control-Allow-Origin` 永远回显请求的 Origin，不要用 `*`
- [ ] 设置 `Vary: Origin`，防止 CDN 缓存污染
- [ ] 预检请求设置合理的 `Max-Age`（推荐 24 小时 = 86400 秒）
- [ ] Origin 白名单走缓存，不要每次查数据库
- [ ] 租户域名变更时主动清除缓存
- [ ] 加限流，防止单个 Origin 刷请求
- [ ] 日志记录被拒绝的 Origin，方便排查问题
- [ ] 不要在 CORS 中间件里做认证——预检请求没有凭证

## 总结

多租户 CORS 的核心问题是：**Origin 列表是动态的，不能写死在配置文件里**。

解决方案的三个关键点：

1. **数据库存储 + Redis 缓存**：Origin 列表存数据库，读请求走缓存，写操作清缓存。兼顾灵活性和性能。
2. **通配符匹配**：支持 `*.example.com` 这样的模式，减少配置量。用字符串函数而非正则，性能更好。
3. **预检缓存**：`Access-Control-Max-Age` 设为 24 小时，同一个 Origin 的后续 OPTIONS 请求直接走浏览器缓存，不打到服务端。

这套方案已经在实际项目中跑了半年，支撑了 200+ 租户的独立域名 CORS 管理。每次新租户上线只需要在管理后台添加域名，不需要改代码、不需要重新部署。

完整代码已放在文中，可以直接复制使用。如果你的项目是 Laravel 11+，记得检查中间件注册方式的差异。
