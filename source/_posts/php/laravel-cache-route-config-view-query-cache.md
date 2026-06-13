---

title: Laravel 缓存策略全解：Route/Config/View/Query 缘存最佳实践踩坑记录
keywords: [Laravel, Route, Config, View, Query, 缓存策略全解, 缘存最佳实践踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 07:55:56
updated: 2026-05-05 07:57:44
categories:
- php
tags:
- Laravel
- PHP
- Redis
- 缓存
- 性能优化
- route-cache
- query-cache
description: Laravel 缓存策略全解：深入拆解 Route Cache、Config Cache、View Cache、Query Cache 四层缓存原理与踩坑记录。含 Redis/Memcached 对比、缓存失效策略、生产环境 cache:clear 事故防护与监控方案，助你实现 30-50% 性能提升。
---


# Laravel 缓存策略全解：Route/Config/View/Query 缓存最佳实践踩坑记录

## 前言

很多 Laravel 开发者对"缓存"的理解停留在 `Cache::remember()` 和 Redis，但在实际 B2C 项目中，**Laravel 框架自身就提供了四层缓存机制**——Route Cache、Config Cache、View Cache、Query Cache（Eloquent 层面）。这四层缓存配置得当，能让 API 响应时间降低 30-50%；配置不当，则会出现"本地正常、生产报错"的经典翻车场景。

本文基于 KKday B2C API 30+ 仓库的实战经验，逐一拆解每层缓存的原理、启用方式、失效机制和踩坑记录。

---

## 整体架构：四层缓存的关系

```
┌─────────────────────────────────────────────────┐
│                  HTTP Request                    │
├─────────────────────────────────────────────────┤
│  ① Route Cache    │  路由匹配 → Controller       │
│  ─────────────────────────────────────────────  │
│  ② Config Cache   │  配置加载 → .env → config/  │
│  ─────────────────────────────────────────────  │
│  ③ View Cache      │  Blade 编译 → PHP 模板      │
│  ─────────────────────────────────────────────  │
│  ④ Query Cache     │  Eloquent → SQL → 结果缓存  │
├─────────────────────────────────────────────────┤
│  ⑤ Application Cache (Redis/Memcached/...)      │
│     → 业务级缓存（会话/购物车/计次/全页）          │
└─────────────────────────────────────────────────┘
```

> **关键认知**：①-③ 是框架级缓存，对所有 Laravel 项目通用；④ 是 ORM 层缓存，需要手动设计；⑤ 是业务层缓存（本文不展开，详见之前文章）。

---

## 一、Route Cache：路由缓存的正确姿势

### 1.1 原理

Laravel 的路由注册是一个"编译"过程：每次请求到来时，框架需要遍历所有路由定义、匹配 HTTP method + URI、解析中间件栈。当路由数量超过 100 条时，这个开销开始变得显著。

`php artisan route:cache` 会将整个路由表序列化为一个 PHP 文件，请求时直接加载，跳过所有路由注册逻辑。

```bash
# 生成路由缓存
php artisan route:cache

# 清除路由缓存
php artisan route:clear
```

### 1.2 性能数据

在 KKday B2C API 项目（约 300 条路由）中测试：

| 场景 | 路由注册耗时 | 请求/秒（QPS） |
|------|-------------|---------------|
| 无 route:cache | ~12ms | ~850 |
| 有 route:cache | ~0.5ms | ~1100 |

**提升约 30%**，这在高并发场景下非常可观。

### 1.3 ⚠️ 踩坑：闭包路由不能缓存

这是最常见的翻车场景。`route:cache` 使用 PHP 的 `serialize()` 机制，而 **闭包（Closure）无法被序列化**。

```php
// ❌ 这样写会导致 route:cache 失败
Route::get('/health', function () {
    return response()->json(['status' => 'ok']);
});

// ✅ 改成 Controller 方法
Route::get('/health', [HealthController::class, 'index']);
```

**真实踩坑**：某次 CI/CD 流水线在 staging 环境执行 `route:cache` 报错，原因是同事在 `routes/api.php` 中加了一个闭包路由做临时调试。由于 CI 没有捕获到这个错误（exit code 被吞），导致部署后路由表为空，所有 API 返回 404。

**解决方案**：在 CI 流水线中加入路由缓存测试步骤：

```yaml
# .github/workflows/deploy.yml
- name: Test route cache
  run: |
    php artisan route:cache
    php artisan route:clear
```

### 1.4 踩坑：动态路由注册不能缓存

有些项目会根据环境变量动态注册路由：

```php
// ❌ 动态注册的路由在缓存后不会生效
if (config('app.feature_flag_new_api')) {
    Route::get('/v3/products', [ProductControllerV3::class, 'index']);
}
```

`route:cache` 生成的是静态文件，运行时不会再执行条件判断。**解决办法**：用中间件或 Feature Flag 包（如 Laravel Pennant）替代动态路由注册。

---

## 二、Config Cache：配置缓存的隐藏陷阱

### 2.1 原理

Laravel 启动时会加载 `config/` 目录下所有 PHP 文件，再用 `.env` 中的值覆盖。`php artisan config:cache` 会将所有配置合并为一个 `bootstrap/cache/config.php` 文件。

```bash
php artisan config:cache
php artisan config:clear
```

### 2.2 ⚠️ 致命踩坑：config:cache 后 env() 返回 null

**这是 Laravel 最经典的缓存陷阱，几乎每个新手都会踩。**

当配置被缓存后，`config()` 函数从缓存文件读取值，**不再读取 `.env` 文件**。但如果你在代码中直接使用 `env()` 而不是 `config()`，缓存后 `env()` 会返回 `null`。

```php
// ❌ 错误：直接使用 env()
$apiKey = env('STRIPE_API_KEY');

// ✅ 正确：通过 config() 访问
// config/services.php
return [
    'stripe' => [
        'key' => env('STRIPE_API_KEY'),
    ],
];

// 代码中使用
$apiKey = config('services.stripe.key');
```

**真实踩坑**：生产环境部署后支付回调全部失败，排查发现 `STRIPE_API_KEY` 为 null。原因是新同事在 PaymentService 中直接使用了 `env('STRIPE_API_KEY')`，本地开发没问题（没执行 config:cache），CI 也没问题（测试环境不用 config:cache），但生产环境执行了 `config:cache`，导致 env() 全部返回 null。

**防御方案**：用 PHPStan 规则禁止在 Controller/Service 中直接使用 `env()`：

```php
// phpstan.neon
rules:
    - App\Rules\NoEnvOutsideConfigRule
```

```php
// app/Rules/NoEnvOutsideConfigRule.php
namespace App\Rules;

use PhpParser\Node;
use PHPStan\Analyser\Scope;
use PHPStan\Rules\Rule;

/**
 * @implements Rule<Node\Expr\FuncCall>
 */
class NoEnvOutsideConfigRule implements Rule
{
    public function getNodeType(): string
    {
        return Node\Expr\FuncCall::class;
    }

    public function processNode(Node $node, Scope $scope): array
    {
        if (!$node->name instanceof Node\Name) {
            return [];
        }
        if ($node->name->toString() !== 'env') {
            return [];
        }

        $file = $scope->getFile();
        // 只允许在 config/ 目录下使用 env()
        if (str_starts_with($file, base_path('config/'))) {
            return [];
        }

        return [
            'env() 只能在 config/ 文件中使用，其他地方请用 config() 访问。',
        ];
    }
}
```

### 2.3 踩坑：config:cache 与 config() 运行时修改

有些代码会在运行时动态修改配置值：

```php
// ❌ config:cache 后，这个修改不会持久化到缓存文件
config(['app.timezone' => 'Asia/Taipei']);

// 对当次请求有效，但下次请求又会从缓存文件读取原始值
```

在 B2C 多租户场景中，如果需要根据租户动态切换配置（如数据库连接），**不要依赖运行时 `config()` 修改**，应该使用 Laravel 的 `Config::set()` 配合中间件在每次请求开始时重新设置。

---

## 三、View Cache：Blade 模板编译缓存

### 3.1 原理

Blade 模板需要编译为原生 PHP 文件才能执行。Laravel 默认会在 `storage/framework/views/` 目录下缓存编译结果，后续请求直接加载编译后的 PHP 文件。

```bash
# 预编译所有模板
php artisan view:cache

# 清除编译缓存
php artisan view:clear
```

### 3.2 API 项目还需要 view:cache 吗？

对于纯 API 项目（不返回 HTML），`view:cache` 的收益几乎为零。但如果你的项目包含：
- **邮件模板**（Mailable 使用 Blade）
- **PDF 生成**（使用 Blade 模板）
- **管理后台**（返回 HTML 视图）

那么 `view:cache` 仍然有意义。

### 3.3 ⚠️ 踩坑：编译缓存与模板热更新

在开发环境中，Blade 模板修改后会自动重新编译。但在生产环境执行 `view:cache` 后，即使修改了模板文件，**仍然会使用旧的编译版本**，直到重新执行 `view:cache`。

```bash
# 正确的部署流程
php artisan view:clear    # 先清除
php artisan view:cache    # 再重新编译
```

**真实踩坑**：某次紧急修复邮件模板的排版问题，修改后直接部署，但邮件内容还是旧的。原因就是没有在部署脚本中加入 `view:clear && view:cache`。

### 3.4 踩坑：@include 与 @component 的编译依赖

```blade
{{-- 当子模板修改后，父模板的编译缓存不会自动失效 --}}
@include('emails.partials.header')

{{-- 解决方案：使用 @component 可以更好地管理编译依赖 --}}
@component('emails.partials.header', ['userName' => $user->name])
@endcomponent
```

在大型项目中，邮件模板通常有复杂的嵌套结构。建议在 CI 流程中强制清除并重新编译所有模板：

```bash
# deploy.sh
php artisan view:clear
php artisan view:cache
# 验证编译后的文件数量
COMPILED_COUNT=$(ls storage/framework/views/ | wc -l)
echo "Compiled $COMPILED_COUNT view files"
```

---

## 四、Query Cache：Eloquent 查询缓存策略

### 4.1 为什么 Laravel 没有内置 Query Cache？

与 Rails 的 `ActiveRecord::QueryCache` 不同，Laravel 的 Eloquent **没有内置查询结果缓存**。这是一个有意的设计决策——Laravel 团队认为查询缓存的失效策略过于复杂，框架层面无法提供通用解决方案。

但这不意味着我们不能做。以下是我们在 B2C 项目中实践的几种 Query Cache 方案。

### 4.2 方案一：Cache::remember 包裹查询

最简单直接的方式：

```php
namespace App\Services;

use App\Models\Product;
use Illuminate\Support\Facades\Cache;

class ProductService
{
    public function getHotProducts(int $limit = 20): \Illuminate\Database\Eloquent\Collection
    {
        return Cache::remember(
            "hot_products:{$limit}",
            now()->addMinutes(5),
            function () use ($limit) {
                return Product::query()
                    ->where('is_hot', true)
                    ->with(['category', 'images'])
                    ->orderByDesc('sales_count')
                    ->limit($limit)
                    ->get();
            }
        );
    }

    /**
     * 商品更新时清除相关缓存
     */
    public function updateProduct(Product $product, array $data): Product
    {
        $product->update($data);

        // 清除该商品参与的所有缓存 key
        Cache::forget("product:{$product->id}");
        Cache::tags(['hot_products'])->flush(); // 需要 Redis/Tagged Cache

        return $product;
    }
}
```

### 4.3 方案二：Eloquent 全局 Scope + 缓存

对于读多写少的场景（如商品详情），可以用全局 Scope 自动缓存：

```php
namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;
use Illuminate\Support\Facades\Cache;

class CacheableScope implements Scope
{
    public function __construct(
        private int $ttl = 300, // 5 分钟
    ) {}

    public function apply(Builder $builder, Model $model): void
    {
        // 不在全局 Scope 中自动缓存，太危险
        // 改为提供 trait 让模型主动声明
    }
}

// 更好的方式：Trait
namespace App\Traits;

use Illuminate\Support\Facades\Cache;

trait Cacheable
{
    public function getCacheKey(): string
    {
        return sprintf('%s:%s', class_basename($this), $this->getKey());
    }

    public static function findCached(int|string $id): ?static
    {
        $cacheKey = (new static())->getCacheKey() . ":{$id}";

        return Cache::remember($cacheKey, 300, function () use ($id) {
            return static::query()->find($id);
        });
    }

    protected static function bootCacheable(): void
    {
        static::saved(function ($model) {
            Cache::forget($model->getCacheKey() . ":{$model->getKey()}");
        });

        static::deleted(function ($model) {
            Cache::forget($model->getCacheKey() . ":{$model->getKey()}");
        });
    }
}
```

```php
// 使用
class Product extends Model
{
    use Cacheable;
}

$product = Product::findCached(123); // 先查缓存，miss 时查数据库
```

### 4.4 方案三：数据库查询日志 + 慢查询识别

在开发环境中，开启 Eloquent 查询日志来识别需要缓存的查询：

```php
// AppServiceProvider::boot()
if (app()->environment('local', 'testing')) {
    DB::listen(function ($query) {
        if ($query->time > 100) { // 超过 100ms
            logger()->warning('Slow Query Detected', [
                'sql' => $query->sql,
                'time' => $query->time . 'ms',
                'bindings' => $query->bindings,
            ]);
        }
    });
}
```

### 4.5 ⚠️ 踩坑：缓存模型对象的序列化陷阱

直接缓存 Eloquent 模型对象时，需要注意几个问题：

```php
// ❌ 问题 1：缓存了模型的关系（可能过期）
$product = Product::with('reviews')->find(1);
Cache::put('product:1', $product, 300);

// ❌ 问题 2：缓存了模型的 exists 属性，反序列化后可能丢失
$product = new Product(['name' => 'Test']);
Cache::put('product:new', $product, 60);

// ✅ 推荐：只缓存数组，反序列化后重新构建
$product = Product::find(1);
Cache::put('product:1', $product->toArray(), 300);

// 读取时
$data = Cache::get('product:1');
$product = new Product($data);
```

**真实踩坑**：某次缓存了带有 `reviews` 关系的商品对象，缓存 5 分钟内用户看到的评论数不会更新。更严重的是，缓存命中时返回的是同一个对象实例（PHP 对象引用），如果代码中修改了这个对象的属性，会影响到后续所有从缓存中读取的请求。

---

## 五、生产环境部署的缓存最佳实践

### 5.1 部署脚本中的缓存命令顺序

```bash
#!/bin/bash
# deploy.sh - 正确的缓存构建顺序

# 1. 清除所有旧缓存（防止残留）
php artisan cache:clear
php artisan config:clear
php artisan route:clear
php artisan view:clear
php artisan event:clear

# 2. 重新生成缓存
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan event:cache

# 3. OPcache 预热（配合 opcache.preload）
php artisan opcache:clear  # 需要 appstract/laravel-opcache 包

# 4. 重启 PHP-FPM（清除运行时 OPcache）
php artisan octane:reload 2>/dev/null || sudo systemctl reload php8.2-fpm
```

### 5.2 缓存层级与失效时机速查表

| 缓存类型 | 生成命令 | 失效时机 | 何时需要重新生成 |
|---------|---------|---------|----------------|
| Route Cache | `route:cache` | 路由文件修改 | 每次部署 |
| Config Cache | `config:cache` | 配置文件修改 | 每次部署 |
| View Cache | `view:cache` | 模板文件修改 | 每次部署 |
| Query Cache | `Cache::remember()` | TTL 过期 / 手动 forget | 数据变更时 |
| OPcache | 自动 / `opcache:clear` | PHP 文件修改 | 每次部署 |

### 5.3 缓存预热策略

冷启动时缓存为空，大量请求直接打到数据库，可能导致 **缓存雪崩**。在部署后需要主动预热关键缓存：

```php
// app/Console/Commands/CacheWarmUp.php
namespace App\Console\Commands;

use Illuminate\Console\Command;

class CacheWarmUp extends Command
{
    protected $signature = 'cache:warm-up';
    protected $description = '预热生产环境关键缓存';

    public function handle(): int
    {
        $this->info('开始预热缓存...');

        // 预热热门商品
        $this->call('cache:warm-up:products');

        // 预热分类树
        $this->call('cache:warm-up:categories');

        // 首页配置
        $this->call('cache:warm-up:homepage');

        $this->info('缓存预热完成');
        return 0;
    }
}
```

---

## 六、总结：缓存策略决策树

```
需要缓存什么？
├── 路由表 → route:cache（每次部署执行）
├── 配置文件 → config:cache（每次部署执行）
├── Blade 模板 → view:cache（有 HTML 时执行）
├── 数据库查询
│   ├── 读多写少 → Cache::remember + TTL
│   ├── 读少写多 → 不缓存，用数据库索引
│   └── 实时性要求高 → Cache::tags + 事件驱动失效
└── 业务数据
    ├── 会话 → Redis Session Driver
    ├── 购物车 → Redis Hash
    └── 全页缓存 → Nginx FastCGI Cache
```

**核心原则**：
1. **框架级缓存（Route/Config/View）是每次部署的标配**，不是可选项
2. **Query Cache 需要手动设计失效策略**，不能指望 TTL 兜底
3. **缓存不是银弹**——先用 EXPLAIN 分析查询，再决定是否需要缓存
4. **监控缓存命中率**——低于 80% 的缓存策略需要重新审视

---

> **踩坑清单回顾**：
> 1. 闭包路由导致 `route:cache` 失败 → 全部改用 Controller
> 2. `config:cache` 后 `env()` 返回 null → PHPStan 规则防御
> 3. 部署后忘记 `view:clear` → 模板热更新失效
> 4. 缓存 Eloquent 模型对象导致数据陈旧 → 只缓存数组
> 5. 冷启动缓存雪崩 → 部署后执行缓存预热脚本

---

## 七、缓存驱动对比：Redis vs Memcached vs File vs Database

选择缓存驱动是架构决策的第一步。以下是 Laravel 支持的四种主流驱动对比：

| 特性 | Redis | Memcached | File | Database |
|------|-------|-----------|------|----------|
| **性能** | ⭐⭐⭐⭐⭐ 极高（10万+ QPS） | ⭐⭐⭐⭐⭐ 极高 | ⭐⭐ 中等 | ⭐ 低 |
| **数据结构** | String/Hash/List/Set/ZSet | 仅 KV | 文件 I/O | SQL 表 |
| **持久化** | ✅ RDB + AOF | ❌ 纯内存 | ✅ 文件系统 | ✅ 数据库 |
| **Tag 支持** | ✅ 原生支持 | ❌ 需自行实现 | ✅ 支持 | ✅ 支持 |
| **原子操作** | ✅ Lua 脚本 | ✅ CAS | ❌ | ✅ 事务 |
| **集群/HA** | ✅ Sentinel / Cluster | ✅ 客户端分片 | ❌ | ✅ 主从复制 |
| **内存效率** | 高（压缩优化） | 极高（slab allocator） | N/A | N/A |
| **适用场景** | 通用首选、复杂数据结构 | 简单 KV 高并发 | 开发/小项目 | 无 Redis 时的后备 |

**选型建议**：
- 生产环境首选 **Redis**——数据结构丰富、支持 Tag、持久化可靠
- 如果只需要简单 KV 且追求极致内存效率，**Memcached** 是好选择
- **File** 仅用于开发环境或小型单机项目
- **Database** 仅作为无 Redis/Memcached 时的后备方案，性能瓶颈明显

```php
// config/cache.php - 切换驱动
'default' => env('CACHE_DRIVER', 'redis'),

'stores' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'cache',
        'lock_connection' => 'default',
    ],
    'memcached' => [
        'driver' => 'memcached',
        'persistent_id' => env('MEMCACHED_PERSISTENT_ID'),
        'servers' => [
            ['host' => env('MEMCACHED_HOST', '127.0.0.1'), 'port' => 11211, 'weight' => 100],
        ],
    ],
    'file' => [
        'driver' => 'file',
        'path' => storage_path('framework/cache/data'),
        'lock_path' => storage_path('framework/cache/data'),
    ],
],
```

---

## 八、缓存失效策略：TTL、事件驱动与防击穿

### 8.1 TTL（Time-To-Live）策略

TTL 是最简单的失效方式，但设置不当会导致数据陈旧或缓存命中率过低。

```php
// 固定 TTL
Cache::put('config:site', $config, 3600); // 1 小时

// 基于业务周期的动态 TTL
$ttl = now()->endOfDay()->diffInSeconds(now()); // 今天剩余秒数
Cache::put('daily_stats', $stats, $ttl);

// 带 jitter 的 TTL（防止缓存雪崩）
$ttl = 300 + random_int(0, 60); // 5 分钟 ± 1 分钟随机偏移
Cache::remember('products:hot', $ttl, fn() => Product::hot()->get());
```

### 8.2 事件驱动失效

当数据变更时，通过事件主动清除缓存，而非等待 TTL 过期：

```php
// app/Observers/ProductObserver.php
class ProductObserver
{
    public function saved(Product $product): void
    {
        // 清除单个商品缓存
        Cache::forget("product:{$product->id}");

        // 使用 Tag 批量清除相关缓存（需 Redis 驱动）
        Cache::tags(['products', "category:{$product->category_id}"])->flush();

        // 发布事件，异步处理缓存更新
        event(new ProductCacheInvalidated($product));
    }

    public function deleted(Product $product): void
    {
        Cache::forget("product:{$product->id}");
        Cache::tags(['products'])->flush();
    }
}
```

```php
// app/Listeners/RefreshProductCache.php
class RefreshProductCache
{
    public function handle(ProductCacheInvalidated $event): void
    {
        $product = $event->product;
        // 异步重建缓存
        Cache::remember(
            "product:{$product->id}",
            3600,
            fn() => Product::with(['category', 'images'])->find($product->id)
        );
    }
}
```

### 8.3 缓存击穿（Cache Stampede）防护

当热点 key 过期的瞬间，大量请求同时穿透到数据库。解决方案是使用 **分布式锁**：

```php
use Illuminate\Support\Facades\Cache;

function getHotProducts(): Collection
{
    return Cache::remember('hot_products', 300, function () {
        // 使用原子锁防止缓存击穿
        $lock = Cache::lock('hot_products_lock', 10); // 10 秒超时

        if ($lock->get()) {
            try {
                $products = Product::query()
                    ->where('is_hot', true)
                    ->with(['category', 'images'])
                    ->orderByDesc('sales_count')
                    ->limit(20)
                    ->get();

                Cache::put('hot_products', $products, 300);
                return $products;
            } finally {
                $lock->release();
            }
        }

        // 获取锁失败，说明有其他进程在重建，返回旧缓存或降级
        return Cache::get('hot_products') ?? collect();
    });
}
```

> **对比三种缓存问题**：
> - **缓存穿透**（查不存在的数据）→ 布隆过滤器 / 缓存空值
> - **缓存击穿**（热点 key 过期）→ 分布式锁 / 永不过期 + 异步更新
> - **缓存雪崩**（大量 key 同时过期）→ TTL 加随机偏移 / 多级缓存

---

## 九、生产环境踩坑深度剖析

### 9.1 cache:clear 事故：清空所有缓存的灾难

`php artisan cache:clear` 会清除 **整个默认缓存 store 的所有 key**，包括用户会话、购物车、验证码等业务数据。

```bash
# ❌ 危险操作：清空所有缓存
php artisan cache:clear

# ✅ 安全操作：只清除特定 tag 或 prefix
php artisan cache:clear --tags=products
```

```php
// 更安全的缓存清除策略
class DeployCacheClear
{
    public static function safe(): void
    {
        // 只清除应用缓存，不影响会话
        Cache::store('file')->flush();      // 文件缓存（配置/路由等）

        // 只清除特定 prefix 的 Redis key
        $redis = Redis::connection('cache');
        $keys = $redis->keys('laravel_cache:products:*');
        if (!empty($keys)) {
            $redis->del($keys);
        }

        // 绝不清除 session store
        // Cache::store('redis')->flush();  // ❌ 这会连 session 一起清掉
    }
}
```

**真实事故**：某次部署脚本误将 `cache:clear` 放在 `config:cache` 之前，导致所有在线用户的会话丢失，购物车数据清空，验证码全部失效。用户集中登录导致数据库连接池耗尽，服务宕机 15 分钟。

### 9.2 config:cache 与 env() 的进阶坑

除了前面提到的 `env()` 返回 null 问题，还有几个隐藏陷阱：

```php
// 坑 1：config:cache 后 config() 返回的是不可变数组
// config/app.php 中的值不会再读取 .env
// 所以如果用 .env 控制 feature flag，切换后不会生效

// ❌ 这种写法在 config:cache 后切换环境变量无效
// .env: FEATURE_NEW_CHECKOUT=true
// config/features.php:
return [
    'new_checkout' => env('FEATURE_NEW_CHECKOUT', false),
];

// ✅ 解决方案：用数据库或 Redis 存储 feature flag
// 使用 Laravel Pennant
// php artisan pennant:cache
```

```php
// 坑 2：config:cache 会覆盖 config/*.php 中的运行时逻辑
// ❌ 不要在配置文件中写运行时逻辑
return [
    'timezone' => request()->is('admin/*') ? 'UTC' : 'Asia/Shanghai',
];

// ✅ 正确做法：配置文件只返回静态值 + env()
return [
    'timezone' => env('APP_TIMEZONE', 'Asia/Shanghai'),
];
```

### 9.3 N+1 Query Cache 坑

缓存了 N+1 查询的结果，看似解决了性能问题，实际上把 N+1 问题「固化」到了缓存中：

```php
// ❌ 错误：缓存了 N+1 查询
$orders = Cache::remember('user:1:orders', 300, function () {
    return Order::where('user_id', 1)->get(); // 只缓存了 order
});

foreach ($orders as $order) {
    // 每次循环都会查数据库（缓存中没有 items 关系）
    $items = $order->items; // N+1！
}

// ✅ 正确：预加载关系后再缓存
$orders = Cache::remember('user:1:orders:with_items', 300, function () {
    return Order::with('items', 'payment')
        ->where('user_id', 1)
        ->get();
});
```

```php
// ✅ 更好：用 Cache::tags 按实体管理缓存
$orders = Cache::tags(["user:1:orders"])->remember(
    'user:1:orders:with_items',
    300,
    fn() => Order::with('items', 'payment')->where('user_id', 1)->get()
);

// 订单更新时，精确清除
Order::observe(OrderObserver::class);

class OrderObserver
{
    public function saved(Order $order): void
    {
        Cache::tags(["user:{$order->user_id}:orders"])->flush();
    }
}
```

---

## 十、缓存监控与诊断

### 10.1 Laravel Telescope 缓存监控

[Laravel Telescope](https://laravel.com/docs/telescope) 提供了开箱即用的缓存监控面板：

```bash
composer require laravel/telescope --dev
php artisan telescope:install
php artisan migrate
```

Telescope 的 **Cache** 标签页可以查看：
- 每个缓存操作的 key、命中/未命中、耗时
- 缓存操作的时间线分布
- 高频缓存 key 识别

```php
// config/telescope.php - 生产环境只监控缓存未命中
'watchers' => [
    Watchers\CacheWatcher::class => [
        'enabled' => env('TELESCOPE_CACHE_WATCHER', true),
    ],
],

// AppServiceProvider 中自定义缓存事件记录
use Illuminate\Support\Facades\Cache;

public function boot(): void
{
    Cache::event(function ($event) {
        if ($event->type === 'missed') {
            logger()->info('Cache Miss', [
                'key' => $event->key,
                'store' => $event->storeName,
            ]);
        }
    });
}
```

### 10.2 Redis 原生监控

```bash
# 查看 Redis 缓存 key 数量
redis-cli INFO keyspace

# 查看内存使用
redis-cli INFO memory | grep used_memory_human

# 实时监控缓存操作
redis-cli MONITOR | grep "laravel_cache"

# 查找大 key（可能缓存了不该缓存的数据）
redis-cli --bigkeys

# 查看缓存命中率
redis-cli INFO stats | grep -E "keyspace_hits|keyspace_misses"
# 命中率 = hits / (hits + misses)，低于 80% 需要优化
```

```php
// 自定义缓存命中率监控命令
// app/Console/Commands/CacheStats.php
class CacheStats extends Command
{
    protected $signature = 'cache:stats';
    protected $description = '查看缓存命中率统计';

    public function handle(Redis $redis): int
    {
        $info = $redis->info('stats');
        $hits = $info['keyspace_hits'] ?? 0;
        $misses = $info['keyspace_misses'] ?? 0;
        $total = $hits + $misses;
        $rate = $total > 0 ? round($hits / $total * 100, 2) : 0;

        $this->table(
            ['指标', '值'],
            [
                ['缓存命中', $hits],
                ['缓存未命中', $misses],
                ['命中率', "{$rate}%"],
                ['状态', $rate >= 80 ? '✅ 正常' : '⚠️ 需优化'],
            ]
        );

        return 0;
    }
}
```

### 10.3 缓存监控告警

```php
// app/Listeners/CacheMissThresholdListener.php
// 当缓存未命中率超过阈值时告警
class CacheMissThresholdListener
{
    private int $missCount = 0;
    private int $threshold = 100; // 每分钟未命中超过 100 次

    public function handle(CacheMissed $event): void
    {
        $this->missCount++;

        if ($this->missCount >= $this->threshold) {
            // 发送告警（Slack/钉钉/邮件）
            Notification::route('slack', config('services.slack.webhook'))
                ->notify(new CacheMissAlert($event->key, $this->missCount));

            $this->missCount = 0; // 重置计数
        }
    }
}
```

---

## 十一、扩展：Tag-Based Cache 的正确使用

Laravel 的 Tagged Cache 是管理相关缓存组的利器，但仅 Redis 和 Memcached 驱动支持：

```php
use Illuminate\Support\Facades\Cache;

// 写入带 Tag 的缓存
Cache::tags(['products', 'category:electronics'])->put(
    'product:42',
    $productData,
    3600
);

Cache::tags(['products', 'category:clothing'])->put(
    'product:99',
    $productData,
    3600
);

// 清除某个分类下的所有商品缓存
Cache::tags(['category:electronics'])->flush(); // 只清 electronics

// 清除所有商品缓存
Cache::tags(['products'])->flush(); // 清除所有带 products tag 的缓存
```

> ⚠️ **注意**：Tagged Cache 不支持 File 和 Database 驱动，使用前请确认 `CACHE_DRIVER` 为 `redis` 或 `memcached`，否则会抛出异常。

---

## 相关阅读

- [Redis Stream 实战：消息队列替代方案](/categories/Databases/redis-stream-guide-laravel/)
- [缓存雪崩防护](/categories/Databases/cache-avalanche/)
- [Laravel Horizon 监控指南](/categories/PHP/laravel-horizon-monitoringguide/)
- [Redis 分布式锁](/categories/Databases/laravel-redis-distributedlockguide/)
