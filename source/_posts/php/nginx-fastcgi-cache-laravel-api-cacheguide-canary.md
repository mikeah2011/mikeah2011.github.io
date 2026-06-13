---

title: Nginx FastCGI Cache 与 Laravel API 缓存旁路实战：秒杀落地页降压、回源一致性与灰度失效踩坑记录
keywords: [Nginx FastCGI Cache, Laravel API, 缓存旁路实战, 秒杀落地页降压, 回源一致性与灰度失效踩坑记录]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-04 14:48:21
categories:
- php
tags:
- Laravel
- Nginx
- 微服务
- 性能优化
- 缓存
description: 深入实战记录如何用 Nginx FastCGI Cache 为 Laravel API 接口构建第一层读降压体系，涵盖完整 nginx.conf 配置、缓存键设计、登录态旁路、Cache::tags 主动失效、灰度发布隔离、缓存雪崩/穿透/登录态泄露等踩坑案例，以及 FastCGI Cache 与 Redis Cache、CDN Cache 的对比选型指南，帮助后端工程师在高并发大促场景下用最小成本扛住峰值流量。
---


大促前我接手过一个很典型的热点接口：`GET /api/campaigns/{slug}/landing`。它聚合活动配置、价格标签、库存摘要和推荐商品，峰值接近 3k RPS，但内容通常 30 秒内不会变化。继续扩 PHP-FPM 只是硬扛，CPU、Redis、MySQL 都在跟着抖。最后真正把延迟打下来的，不是再加一层 Redis，而是把匿名读流量先挡在 Nginx：**FastCGI Cache 命中直接回 JSON，Laravel 只处理未命中和个性化请求**。

上线后一周的数据很直观：缓存命中率 82% 左右，PHP-FPM worker 从 48 降到 20，99 线延迟从 420ms 降到 110ms。这个方案不是全站通杀，但对"匿名、热点、短时可接受旧数据"的 Laravel API 很有效。

## 一、最终架构

```text
Client
  │
  ▼
Nginx
  ├── FastCGI Cache HIT ───► 直接返回 JSON
  └── MISS / BYPASS
          ▼
      Laravel + PHP-FPM
          ├── DB / RPC / Redis 聚合
          └── 返回 Cache-Control / X-Cache-Tags
                  ▼
            Nginx 写入缓存文件

CMS 发布 / 活动变更
  └── purge job ─────────► 删除指定 cache key
```

重点不是"开缓存"，而是四件事一起做：**缓存键稳定、用户态旁路、主动失效、灰度隔离**。少一件，线上都容易翻车。

## 二、Nginx 配置：完整 fastcgi_cache 片段与关键指令解析

下面是生产环境中经过多次调优后的完整 Nginx 配置，拆解每一行的作用。

### 2.1 定义缓存路径与共享内存

```nginx
# 缓存目录：两级哈希目录，共享内存区 200MB，磁盘最大 20GB
# inactive=10m 表示 10 分钟内未被访问的缓存文件自动删除
fastcgi_cache_path /var/cache/nginx/laravel
    levels=1:2
    keys_zone=laravel_api:200m
    inactive=10m
    max_size=20g
    use_temp_path=off;
```

`keys_zone` 存储 key 的元数据（哈希索引），实际响应体存在磁盘。200MB 共享内存大约能容纳 160 万个 key。`use_temp_path=off` 让缓存直接写到目标目录，避免跨文件系统 copy 开销。

### 2.2 旁路条件：哪些请求不走缓存

```nginx
# 有 Authorization 头 = 已登录或带 Token，跳过缓存
map $http_authorization $skip_auth {
    default 1;
    ""      0;
}

# 只识别影响响应的 Cookie，忽略埋点 Cookie
map $http_cookie $skip_cookie {
    default 0;
    ~*(laravel_session|XSRF-TOKEN|remember_web_|user_token) 1;
}
```

**这里有个关键设计决策**：不是"有 Cookie 就 bypass"，而是用白名单精确匹配。前端埋点 Cookie（如 `_ga`、`fbclid`）不影响接口返回内容，如果粗暴地用 `$http_cookie` 非空就跳过，命中率会从 82% 暴跌到 37%。

### 2.3 location 块完整配置

```nginx
server {
    listen 80;
    server_name api.example.com;
    root /var/www/laravel/public;

    # 过滤 query string：只保留影响内容的参数
    set $filtered_args "";
    if ($arg_slug != "") {
        set $filtered_args "slug=$arg_slug";
    }
    if ($arg_page != "") {
        set $filtered_args "${filtered_args}&page=$arg_page";
    }

    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

        # 旁路判断
        set $cache_bypass 0;
        if ($request_method != GET)   { set $cache_bypass 1; }
        if ($skip_auth = 1)           { set $cache_bypass 1; }
        if ($skip_cookie = 1)         { set $cache_bypass 1; }
        if ($arg_nocache = "1")       { set $cache_bypass 1; }  # 调试开关

        # 缓存核心配置
        fastcgi_cache laravel_api;
        fastcgi_cache_bypass $cache_bypass;
        fastcgi_no_cache    $cache_bypass;

        # 缓存锁：同一 key 只允许一个请求回源
        fastcgi_cache_lock on;
        fastcgi_cache_lock_timeout 5s;

        # 兜底：后端出错时用旧缓存
        fastcgi_cache_use_stale error timeout updating http_500 http_503;
        fastcgi_cache_background_update on;

        # TTL：200 缓存 30 秒，301/302 缓存 5 分钟，404 缓存 10 秒
        fastcgi_cache_valid 200     30s;
        fastcgi_cache_valid 301 302 5m;
        fastcgi_cache_valid 404     10s;

        # 缓存 key：只拼影响内容的参数
        fastcgi_cache_key "$scheme$request_method$host$uri$is_args$filtered_args";

        # 诊断头
        add_header X-FastCGI-Cache $upstream_cache_status always;
        add_header X-Cache-Key     "$scheme$request_method$host$uri$is_args$filtered_args" always;
    }
}
```

### 2.4 关键指令速查表

| 指令 | 作用 | 常见陷阱 |
|------|------|----------|
| `fastcgi_cache_key` | 决定缓存唯一标识 | 拼了 `utm_source` 等营销参数会导致命中率极低 |
| `fastcgi_cache_bypass` | 条件为真时跳过缓存读取 | 必须和 `fastcgi_no_cache` 成对使用 |
| `fastcgi_no_cache` | 条件为真时不写入缓存 | 只写 bypass 不写 no_cache 会导致脏数据 |
| `fastcgi_cache_lock` | 防止缓存击穿 | 不开会导致 FPM 瞬间被打满 |
| `fastcgi_cache_use_stale` | 后端故障时返回旧缓存 | 不配的话 5xx 会直接穿透给用户 |
| `fastcgi_cache_valid` | 按状态码设 TTL | 只写 `200` 忘记 301/302 会导致重定向也穿透 |

## 三、Laravel 端：缓存键设计、Cache::tags 与主动失效

### 3.1 声明式缓存中间件

纯靠 Nginx 路径规则不够稳，因为业务会变。我的做法是让 Laravel 主动声明：当前响应是否允许进入 Web 层缓存。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class MarkPublicApiCache
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (! $request->isMethod('GET') || $request->user()) {
            $response->headers->set('Cache-Control', 'private, no-store');
            return $response;
        }

        if ($response->getStatusCode() === 200) {
            $response->headers->set('Cache-Control', 'public, max-age=30, s-maxage=30');
            $response->headers->set('X-Cache-Tags', 'campaign-page,flash-sale');
        }

        return $response;
    }
}
```

```php
Route::middleware(['mark.public.cache'])->group(function () {
    Route::get('/api/campaigns/{slug}/landing', LandingPageController::class);
    Route::get('/api/flash-sales/home', FlashSaleHomeController::class);
});
```

这个中间件的价值很实际：接口一旦开始混入会员价、用户券、登录态文案，只要撤掉中间件即可，不需要改一堆 Nginx 规则。

### 3.2 Laravel 本地缓存键设计（应用层二级缓存）

Nginx FastCGI Cache 是 Web 层一级缓存，Laravel 内部还可以用 `Cache::remember` 做二级缓存，进一步降低数据库压力。关键是要统一缓存键命名规范。

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class CampaignCacheService
{
    /**
     * 缓存键命名规范：
     * {业务域}:{资源}:{标识}:{版本}
     *
     * 示例：campaign:landing:summer-sale:v1
     */
    private function cacheKey(string $slug): string
    {
        return "campaign:landing:{$slug}:v1";
    }

    /**
     * 应用层二级缓存：Nginx miss 后、DB 查询前再挡一层
     */
    public function getLandingData(string $slug): array
    {
        return Cache::tags(['campaign', "campaign:{$slug}"])
            ->remember(
                $this->cacheKey($slug),
                now()->addSeconds(30),
                fn () => $this->buildLandingData($slug)
            );
    }

    /**
     * 组装落地页数据（DB + RPC + Redis 聚合）
     */
    private function buildLandingData(string $slug): array
    {
        $campaign = Campaign::where('slug', $slug)
            ->with(['products', 'flashSale'])
            ->firstOrFail();

        return [
            'campaign'  => $campaign->toArray(),
            'products'  => $campaign->products->toArray(),
            'flashSale' => $campaign->flashSale?->toArray(),
            'cached_at' => now()->toIso8601String(),
        ];
    }
}
```

### 3.3 Cache::tags 的正确用法与陷阱

Laravel 的 `Cache::tags` 可以给缓存打标签，实现按标签批量失效。但它有一个重要限制：**只有 Redis 和 Memcached 驱动支持 tags**，文件缓存不支持。

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class TagBasedCacheInvalidator
{
    /**
     * 按标签批量失效
     * 例：CMS 发布了一个活动的变更，只需失效该活动相关的所有缓存
     */
    public function invalidateByCampaign(string $slug): void
    {
        Cache::tags(["campaign:{$slug}"])->flush();
        // 该活动下所有缓存键一次性清除
    }

    /**
     * 全局活动缓存失效
     */
    public function invalidateAllCampaigns(): void
    {
        Cache::tags(['campaign'])->flush();
    }
}
```

**踩坑记录**：`Cache::tags()->flush()` 不会删除 Nginx FastCGI Cache 的文件。应用层 tags 只能控制 Laravel 本地缓存，Nginx 层需要单独调用 purge 脚本。这是两层缓存各自失效的典型问题。

### 3.4 Event-Driven 自动失效

让缓存失效不依赖手动触发，而是绑定到模型事件：

```php
<?php

namespace App\Observers;

use App\Models\Campaign;
use App\Jobs\PurgeLandingPageCache;
use App\Services\TagBasedCacheInvalidator;

class CampaignObserver
{
    public function __construct(
        private readonly TagBasedCacheInvalidator $invalidator
    ) {}

    public function updated(Campaign $campaign): void
    {
        // 1. 失效应用层缓存
        $this->invalidator->invalidateByCampaign($campaign->slug);

        // 2. 失效 Nginx FastCGI Cache
        PurgeLandingPageCache::dispatch($campaign->slug);
    }

    public function deleted(Campaign $campaign): void
    {
        $this->invalidator->invalidateByCampaign($campaign->slug);
        PurgeLandingPageCache::dispatch($campaign->slug);
    }
}
```

## 四、主动失效：purge 脚本与实现方案

30 秒 TTL 只能兜底，不能满足运营实时改文案、上下架、改跳转链接的需求。我把 CMS 发布流接成 purge job，按活动 slug 删除对应缓存。

### 4.1 Purge Job 实现

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Process;

class PurgeLandingPageCache implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly string $slug) {}

    public function handle(): void
    {
        $uri = "/api/campaigns/{$this->slug}/landing";

        // 方案 A：通过脚本删除缓存文件
        Process::run(sprintf(
            "sudo /usr/local/bin/purge-fastcgi-cache '%s'",
            escapeshellarg($uri)
        ))->throw();
    }
}
```

### 4.2 purge-fastcgi-cache 脚本

```bash
#!/usr/bin/env bash
# /usr/local/bin/purge-fastcgi-cache
# 根据 URI 计算 MD5 并删除缓存文件

CACHE_DIR="/var/cache/nginx/laravel"
URI="$1"

# 必须与 Nginx fastcgi_cache_key 的算法完全一致！
# key = "$scheme$request_method$host$uri$is_args$filtered_args"
# 这里简化为 GET + 主域名的场景
KEY="GEThttp://api.example.com${URI}"

MD5=$(echo -n "$KEY" | md5sum | awk '{print $1}')

FILE="${CACHE_DIR}/${MD5:0:1}/${MD5:1:2}/${MD5}"

if [ -f "$FILE" ]; then
    rm -f "$FILE"
    echo "PURGED: $FILE"
else
    echo "NOT_FOUND: $FILE"
fi
```

**隐蔽的坑**：purge 脚本与 Nginx 的 key 算法必须完全一致。我就遇到过 Nginx key 带了 `$request_method`，脚本没带，任务执行成功但删不到文件，最后只能等 TTL 自然过期。

### 4.3 方案 B：Nginx ngx_cache_purge 模块

如果不想用脚本，可以编译安装 `ngx_cache_purge` 模块，通过 HTTP 请求直接清除：

```nginx
location ~ /purge(/.*) {
    allow 127.0.0.1;
    allow 10.0.0.0/8;
    deny all;
    fastcgi_cache_purge laravel_api "$scheme$request_method$host$1";
}
```

```bash
# 清除指定缓存
curl -X PURGE http://localhost/purge/api/campaigns/summer-sale/landing
```

**注意**：`ngx_cache_purge` 不在 Nginx 官方模块中，需要额外编译。在容器化部署中需要自定义镜像。

### 4.4 方案 C：Lua 脚本动态清除

使用 OpenResty 的 Lua 模块可以实现更灵活的清除逻辑：

```nginx
location /cache-purge {
    internal;
    content_by_lua_block {
        local uri = ngx.var.arg_uri
        if not uri then
            ngx.status = 400
            ngx.say("missing uri parameter")
            return
        end

        local key = "GEThttp://api.example.com" .. uri
        local md5 = ngx.md5(key)
        local cache_dir = "/var/cache/nginx/laravel"
        local file = cache_dir .. "/" .. string.sub(md5,1,1) .. "/" .. string.sub(md5,2,3) .. "/" .. md5

        local ok = os.remove(file)
        if ok then
            ngx.say("purged: " .. uri)
        else
            ngx.status = 404
            ngx.say("not found: " .. uri)
        end
    }
}
```

## 五、灰度失效的完整实现方案

灰度发布时，新旧版本的数据结构可能不同。如果缓存不隔离，就会出现旧缓存返回给新客户端、新缓存被旧客户端拿到的情况。

### 5.1 版本号注入缓存 Key

最简单也最可靠的做法是把发布版本号拼进 cache key：

```nginx
# 在 Nginx 配置中通过变量注入版本号
# 方法 1：通过环境变量
env DEPLOY_VERSION;

# 方法 2：通过 include 文件（部署脚本写入）
include /etc/nginx/deploy-version.conf;
# deploy-version.conf 内容：set $deploy_version "v20260504-1";

fastcgi_cache_key "$deploy_version$scheme$request_method$host$uri$is_args$filtered_args";
```

灰度期间，新版本的请求带 `v20260504-2`，旧版本带 `v20260504-1`，两套缓存天然隔离。回滚时只需切回旧版本号，旧缓存立即生效。

### 5.2 灰度路由与缓存隔离

```nginx
# 灰度标识：通过 Cookie 或 Header 传递
map $http_cookie $deploy_version {
    default     "v-stable";
    ~*grayscale=v2  "v2";
    ~*grayscale=v3  "v3";
}

# 也可以通过自定义 Header
map $http_x_deploy_version $version_from_header {
    default $deploy_version;
    ""      $deploy_version;
    "~.+"   $http_x_deploy_version;
}

fastcgi_cache_key "$version_from_header$scheme$request_method$host$uri$is_args$filtered_args";
```

### 5.3 Laravel 端配合灰度

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class GrayscaleVersion
{
    public function handle(Request $request, Closure $next)
    {
        $version = $request->cookie('grayscale', 'stable');

        // 将版本信息注入请求上下文
        app()->instance('deploy_version', $version);

        $response = $next($request);

        // 在响应头中暴露版本，方便调试
        $response->headers->set('X-Deploy-Version', $version);

        return $response;
    }
}
```

### 5.4 灰度失效流程

```text
1. 部署新版本到灰度节点（10% 流量）
2. 新版本的 cache key 包含新版本号 → 独立缓存空间
3. 验证无误后，逐步扩大灰度比例
4. 全量发布后，旧版本缓存自然过期（30s TTL）
5. 回滚时切回旧版本号，旧缓存立即可用
```

## 六、FastCGI Cache vs Redis Cache vs CDN Cache 对比

选型时最容易混淆的是三层缓存的定位。它们不是互斥关系，而是分层互补。

| 维度 | FastCGI Cache | Redis Cache（应用层） | CDN Cache（边缘） |
|------|---------------|----------------------|-------------------|
| **位置** | Nginx 进程本地 | 独立内存服务 | 全球边缘节点 |
| **延迟** | 0.1–1ms（磁盘/内存） | 0.5–2ms（网络） | 10–50ms（网络） |
| **容量** | TB 级（磁盘） | GB 级（内存） | 按套餐，通常无限 |
| **粒度** | 整个 HTTP 响应 | 任意数据结构 | 整个 HTTP 响应 |
| **失效方式** | 文件删除 / purge | `Cache::forget()` / `DEL` | API 调用 / Tag 清除 |
| **适用场景** | 匿名读、热点 API | 应用层缓存、Session | 静态资源、全局分发 |
| **不适用** | 个性化内容、写操作 | 大对象（>1MB） | 动态 API、需要实时性 |
| **成本** | 几乎为零（复用 Nginx） | 需要 Redis 集群 | 按流量计费 |
| **运维复杂度** | 低（Nginx 内置） | 中（需要集群管理） | 高（多级缓存一致性） |

**推荐分层策略**：

```text
Client → CDN（静态资源 + 全局缓存）
       → Nginx FastCGI Cache（匿名 API 一级缓存）
       → Redis（应用层二级缓存 + Session + 队列）
       → MySQL（数据源）
```

每一层拦截一部分流量，越往后压力越小。FastCGI Cache 的价值在于：它在 Nginx 进程内完成，不走网络、不消耗应用层资源，是性价比最高的第一层降压手段。

## 七、踩坑案例详解

### 7.1 缓存雪崩：TTL 相同导致同时过期

**现象**：上线后每 30 秒出现一次 FPM 抖动，持续约 2 秒。

**根因**：所有活动页面在大促预热时几乎同时被首次访问，TTL 都是 30 秒，导致 30 秒后同时过期，大量请求同时回源。

**修复**：在 TTL 上加入随机抖动。

```nginx
# 不同 URI 模式设置不同 TTL
fastcgi_cache_valid 200 30s;

# 或在 Laravel 端控制 Cache-Control
$response->headers->set(
    'Cache-Control',
    sprintf('public, max-age=%d, s-maxage=%d', 30 + random_int(0, 10), 30 + random_int(0, 10))
);
```

```php
// 应用层缓存加入随机 TTL
$ttl = now()->addSeconds(30 + random_int(0, 10));
Cache::tags(['campaign'])->remember($key, $ttl, fn () => ...);
```

### 7.2 登录态泄露：缓存了个性化内容

**现象**：用户 A 的购物车数量出现在用户 B 的页面上。

**根因**：某个 API 路由既服务匿名用户也服务登录用户，但 Nginx 的 Cookie 白名单漏掉了某个自定义 Cookie（`user_prefs`），导致登录态请求也进入了缓存。

**修复**：

```nginx
# 更严格的旁路规则：同时检查多个标识
map $http_cookie $skip_cookie {
    default 0;
    ~*(laravel_session|XSRF-TOKEN|remember_web_|user_token|user_prefs) 1;
}

# 额外安全层：在 Laravel 中强制标记私有响应
if ($request->user()) {
    $response->headers->set('Cache-Control', 'private, no-store, no-cache');
}
```

**防御性措施**：即使 Nginx 旁路失败，Laravel 侧也要做二次校验。双保险才能避免登录态泄露。

### 7.3 缓存穿透：恶意请求不存在的资源

**现象**：有人批量请求 `/api/campaigns/{random-slug}/landing`，每个 slug 都不同，全部 miss，FPM 被打满。

**根因**：不存在的资源不会被缓存（404 缓存时间短），每次请求都穿透到 Laravel。

**修复**：

```nginx
# 404 也缓存一段时间，防止穿透
fastcgi_cache_valid 404 10s;

# 同时在 Laravel 中用布隆过滤器拦截不存在的 slug
```

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class BloomFilterGuard
{
    public function handle(Request $request, Closure $next)
    {
        $slug = $request->route('slug');

        if ($slug && ! $this->slugExists($slug)) {
            return response()->json(['error' => 'not found'], 404);
        }

        return $next($request);
    }

    private function slugExists(string $slug): bool
    {
        // 用 Redis Set 做简单的存在性检查
        return Cache::tags(['campaign-slugs'])
            ->remember('slug:exists:' . $slug, now()->addHour(), function () use ($slug) {
                return \App\Models\Campaign::where('slug', $slug)->exists();
            });
    }
}
```

### 7.4 热点失效瞬间一起回源（缓存击穿）

**现象**：某活动结束瞬间，所有缓存同时过期，FPM 瞬间被打满。

**根因**：没开 `fastcgi_cache_lock`，同一 key 失效后几十个请求同时打进 Laravel。

**修复**：

```nginx
# 开启缓存锁
fastcgi_cache_lock on;
fastcgi_cache_lock_timeout 5s;
fastcgi_cache_lock_age 5s;

# 配合 stale 使用，锁等待期间返回旧缓存
fastcgi_cache_use_stale error timeout updating http_500 http_503;
fastcgi_cache_background_update on;
```

`fastcgi_cache_lock on` 保证同一 key 只有第一个请求回源，其他请求等待。`fastcgi_cache_background_update on` 让过期缓存在后台更新，用户不等待。

### 7.5 灰度发布时新旧结构混用

**现象**：新版本增加 `labels` 字段，但旧缓存还在，客户端偶发解析失败。

**修复**：把发布版本号拼进 cache key，灰度期间新旧缓存天然隔离，回滚也更干净。详见第五节灰度方案。

## 八、性能监控与可观测性

### 8.1 监控缓存命中率

```nginx
# 在日志格式中加入缓存状态
log_format cache_status '$remote_addr - [$time_local] '
    '"$request" $status $body_bytes_sent '
    '"$upstream_cache_status" $request_time';

access_log /var/log/nginx/api_access.log cache_status;
```

```bash
# 统计命中率
awk '{print $9}' /var/log/nginx/api_access.log | sort | uniq -c | sort -rn

# 输出示例：
# 8200 HIT
# 1500 MISS
#  300 BYPASS
```

### 8.2 Prometheus 指标采集

```nginx
# 使用 nginx-module-vts 或 lua 模块暴露指标
# 或通过 stub_status + 自定义 exporter

location /nginx_status {
    stub_status on;
    allow 10.0.0.0/8;
    deny all;
}
```

### 8.3 告警阈值建议

| 指标 | 告警阈值 | 说明 |
|------|----------|------|
| 缓存命中率 | < 70% | 检查 key 设计或旁路条件 |
| FPM 活跃进程 | > 80% 容量 | 可能缓存失效或穿透 |
| purge 失败率 | > 5% | 检查脚本权限或 key 算法 |
| 99 线延迟 | > 200ms | 缓存可能未生效 |

## 九、生产环境部署清单

```bash
# 1. 创建缓存目录
sudo mkdir -p /var/cache/nginx/laravel
sudo chown nginx:nginx /var/cache/nginx/laravel

# 2. 测试 Nginx 配置
sudo nginx -t

# 3. 重载配置（不中断服务）
sudo nginx -s reload

# 4. 验证缓存生效
curl -I https://api.example.com/campaigns/summer-sale/landing
# 检查响应头：X-FastCGI-Cache: MISS（首次）→ HIT（第二次）

# 5. 测试 purge 脚本
sudo /usr/local/bin/purge-fastcgi-cache '/api/campaigns/summer-sale/landing'

# 6. 部署 purge job 的 Laravel 队列 worker
php artisan queue:work --queue=cache-purge
```

## 十、结论

FastCGI Cache 不是替代 Redis，也不是替代 CDN。它最适合 **Laravel 匿名 JSON 接口的第一层降压**：热点明显、变化可控、允许秒级旧数据。对这种场景，优先把读流量挡在 Nginx，通常比继续扩 FPM 和 Redis 更便宜也更稳。

真正难的从来不是把缓存打开，而是把**缓存键、旁路条件、主动失效、灰度隔离**四件事一起做对。希望这篇踩坑记录能帮你少走一些弯路。

---

## 相关阅读

- [Nginx 配置实战：PHP-FPM 调优、FastCGI 缓存、Gzip 压缩 — Laravel B2C API 踩坑记录](/posts/architecture/nginx-guide-php-fpm-fastcgi-cache-gzip) — Nginx FastCGI 缓存的底层配置详解与 PHP-FPM 调优实践
- [分布式缓存一致性实战：Cache-Aside/Write-Through/Write-Behind 在 Laravel 中的工程化落地](/posts/00_架构/分布式缓存一致性实战-Cache-Aside-Write-Through-Write-Behind在Laravel中的工程化落地) — 从应用层缓存策略角度深入探讨缓存与数据库的一致性问题
- [Laravel 缓存策略全解：Route/Config/View/Query 缓存最佳实践踩坑记录](/posts/php/Laravel/laravel-cache-route-config-view-query-cache) — Laravel 框架内置缓存机制的全面梳理与实战经验
