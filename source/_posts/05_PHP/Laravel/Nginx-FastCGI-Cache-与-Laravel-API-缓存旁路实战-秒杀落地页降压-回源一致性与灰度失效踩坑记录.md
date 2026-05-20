---
title: Nginx FastCGI Cache 与 Laravel API 缓存旁路实战：秒杀落地页降压、回源一致性与灰度失效踩坑记录
date: 2026-05-04 14:48:21
categories:
  - 05_PHP
  - Laravel
tags: [Laravel, Nginx, 微服务, 性能优化, 缓存]description: 结合 Laravel API 在大促落地页场景的真实改造经验，记录如何用 Nginx FastCGI Cache 扛住高频读流量，重点覆盖缓存键设计、登录态绕过、主动失效、灰度发布与线上踩坑。
---

大促前我接手过一个很典型的热点接口：`GET /api/campaigns/{slug}/landing`。它聚合活动配置、价格标签、库存摘要和推荐商品，峰值接近 3k RPS，但内容通常 30 秒内不会变化。继续扩 PHP-FPM 只是硬扛，CPU、Redis、MySQL 都在跟着抖。最后真正把延迟打下来的，不是再加一层 Redis，而是把匿名读流量先挡在 Nginx：**FastCGI Cache 命中直接回 JSON，Laravel 只处理未命中和个性化请求**。

上线后一周的数据很直观：缓存命中率 82% 左右，PHP-FPM worker 从 48 降到 20，99 线延迟从 420ms 降到 110ms。这个方案不是全站通杀，但对“匿名、热点、短时可接受旧数据”的 Laravel API 很有效。

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

重点不是“开缓存”，而是四件事一起做：**缓存键稳定、用户态旁路、主动失效、灰度隔离**。少一件，线上都容易翻车。

## 二、Nginx 配置里最关键的是 key 和 bypass

```nginx
fastcgi_cache_path /var/cache/nginx/laravel levels=1:2 keys_zone=laravel_api:200m inactive=10m max_size=20g;

map $http_authorization $skip_auth {
    default 1;
    "" 0;
}

map $http_cookie $skip_cookie {
    default 0;
    ~*(laravel_session|XSRF-TOKEN|remember_web_) 1;
}

location ~ \.php$ {
    include fastcgi_params;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;

    set $cache_bypass 0;
    if ($request_method != GET) { set $cache_bypass 1; }
    if ($skip_auth = 1) { set $cache_bypass 1; }
    if ($skip_cookie = 1) { set $cache_bypass 1; }

    fastcgi_cache laravel_api;
    fastcgi_cache_bypass $cache_bypass;
    fastcgi_no_cache $cache_bypass;
    fastcgi_cache_lock on;
    fastcgi_cache_use_stale error timeout updating http_500 http_503;
    fastcgi_cache_valid 200 30s;
    fastcgi_cache_key "$scheme$request_method$host$uri$is_args$filtered_args";

    add_header X-FastCGI-Cache $upstream_cache_status always;
}
```

我第一次上线时直接把完整 query string 拼进 key，结果 `utm_source`、`fbclid`、`gclid` 把同一页面打成几十份缓存文件，命中率只有 37%。后来只保留真正影响内容的参数，命中率才回升。这个坑说明：**缓存系统最怕的不是没开，而是 key 设计错了。**

## 三、Laravel 负责声明“哪些响应可缓存”

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

## 四、主动失效才是真正决定体验的部分

30 秒 TTL 只能兜底，不能满足运营实时改文案、上下架、改跳转链接的需求。后来我把 CMS 发布流接成 purge job，按活动 slug 删除对应缓存。

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

        Process::run(sprintf(
            "sudo /usr/local/bin/purge-fastcgi-cache '%s'",
            escapeshellarg($uri)
        ))->throw();
    }
}
```

这里有个很隐蔽的坑：**purge 脚本与 Nginx 的 key 算法必须完全一致。** 我就遇到过 Nginx key 带了 `$request_method`，脚本没带，任务执行成功但删不到文件，最后只能等 TTL 自然过期。

## 五、三次线上踩坑

### 1. “有 Cookie 就 bypass”太粗暴
前端埋点 Cookie 并不影响接口内容，却让大量匿名流量失去缓存资格。正确做法是只识别真正影响响应的 Cookie 白名单。

### 2. 热点失效瞬间一起回源
没开 `fastcgi_cache_lock` 时，同一 key 失效后几十个请求同时打进 Laravel；开锁后只有一个请求回源，其余请求等待或吃 stale，FPM 抖动马上下降。

### 3. 灰度发布时新旧结构混用
我曾在新版本里增加 `labels` 字段，但旧缓存还在，客户端偶发解析失败。后来把发布版本号拼进 cache key，灰度期间新旧缓存天然隔离，回滚也更干净。

## 六、结论

FastCGI Cache 不是替代 Redis，也不是替代 CDN。它最适合 **Laravel 匿名 JSON 接口的第一层降压**：热点明显、变化可控、允许秒级旧数据。对这种场景，优先把读流量挡在 Nginx，通常比继续扩 FPM 和 Redis 更便宜也更稳。真正难的从来不是把缓存打开，而是把**缓存键、旁路条件、主动失效、灰度隔离**四件事一起做对。