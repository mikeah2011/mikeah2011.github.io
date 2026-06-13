
title: CDN 配置实战-静态资源加速缓存策略与回源配置-Laravel-B2C-API 踩坑记录
keywords: [CDN, Laravel, API]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-05 08:50:56
updated: 2026-05-05 08:53:49
categories:
  - architecture
  - infra
tags:
- AWS
- DevOps
- Laravel
- Nginx
- cloudfront
- Cloudflare
- CDN
- 缓存
- 性能优化
- IaC
description: '本文是一篇 CDN 加速与缓存策略的深度实战指南，基于 Laravel B2C 电商项目的真实踩坑经验。全面覆盖 CloudFront Origin Shield、Cloudflare Workers、Terraform IaC 配置，详解 Cache-Control 头部设计、stale-while-revalidate 三层防护、回源风暴治理、Geo-Based 多区域缓存一致性，以及 Nginx FastCGI/Proxy Cache 源站防护。附带完整的 PHP/JS/HCL 可运行示例代码、8 个真实踩坑案例与 CDN 服务商对比表格，帮助中高级开发者构建可靠的全球缓存架构。

  '
---


# CDN 配置实战：静态资源加速、缓存策略、回源配置

## 一、前言：CDN 不只是「加一层缓存」

在 B2C 电商场景中，CDN 扮演着至关重要的角色——商品图片、前端 Bundle、API 响应（全页缓存）都需要通过 CDN 分发到全球边缘节点。但很多团队对 CDN 的理解停留在「开了就行」的层面，直到遇到以下问题：

- 缓存了用户个人信息（隐私泄露）
- 发版后用户看到旧版本（缓存未失效）
- 回源风暴导致源站宕机（缓存雪崩）
- 不同国家看到不同价格（缓存 Key 设计缺陷）

这些问题在我们的 KKday B2C API 项目中都曾真实发生过。最严重的一次是缓存雪崩——某个热门商品页面的缓存同时过期，10000 个请求同时回源，直接把数据库打垮了，服务中断了 20 分钟。这次事故让我们深刻认识到：CDN 配置不是「开一下就好」的简单操作，而是需要系统性设计的架构决策。

本文基于 KKday B2C API 项目的真实经验，系统性地梳理 CDN 配置的方方面面。涵盖 CloudFront 和 Cloudflare 两大主流 CDN 的实战配置、Cache-Control 头部设计、回源风暴防护、多区域部署、缓存失效机制，以及我们踩过的 8 个真实坑。无论你是刚接触 CDN 的初中级开发者，还是想优化现有配置的高级工程师，这篇文章都能给你带来实用的参考。

---

## 二、架构全景：CDN 在 B2C 系统中的位置

```
┌──────────────────────────────────────────────────────────────────┐
│                        用户请求链路                                │
│                                                                   │
│  用户浏览器/App                                                    │
│       │                                                           │
│       ▼                                                           │
│  ┌─────────┐    Cache Hit    ┌──────────────────────┐             │
│  │ CDN 边缘 │ ──────────────►│ 直接返回缓存响应       │             │
│  │   节点   │                └──────────────────────┘             │
│  └────┬────┘                                                      │
│       │ Cache Miss                                                │
│       ▼                                                           │
│  ┌──────────┐   Shield / 中间层缓存                                │
│  │ CDN Shield│ ──── 命中则返回，减少回源                             │
│  └────┬─────┘                                                     │
│       │ Shield Miss                                               │
│       ▼                                                           │
│  ┌──────────────┐                                                  │
│  │  Nginx 反代   │ ← 可选：本地 FastCGI Cache / Proxy Cache        │
│  └────┬─────────┘                                                 │
│       │                                                           │
│       ▼                                                           │
│  ┌──────────────┐                                                  │
│  │ Laravel API  │ → Redis 缓存 / 数据库                            │
│  └──────────────┘                                                  │
└──────────────────────────────────────────────────────────────────┘
```

关键组件说明：

| 组件 | 职责 | 典型方案 |
|------|------|----------|
| CDN 边缘节点 | 就近响应用户请求 | CloudFront / Cloudflare / 阿里云 CDN |
| CDN Shield | 减少回源次数，保护源站 | CloudFront Origin Shield / Cloudflare Always Online |
| Nginx 反代 | 负载均衡、限流、本地缓存 | Nginx + FastCGI Cache |
| Laravel API | 业务逻辑层 | 设置正确的 Cache-Control 头 |

---

## 三、缓存策略设计：不是所有资源都该缓存

### 3.1 资源分类与 TTL 设计

```php
// config/cache-strategy.php
return [
    // 静态资源：长缓存 + 文件名哈希
    'static_assets' => [
        'pattern'  => '/assets/*.{js,css,png,svg,woff2}',
        'ttl'      => 31536000, // 1 年
        'strategy' => 'immutable', // 文件名带 hash，永不更新
    ],

    // 商品图片：中长缓存
    'product_images' => [
        'pattern'  => '/images/products/*',
        'ttl'      => 604800, // 7 天
        'strategy' => 'stale-while-revalidate',
    ],

    // API 全页缓存：短缓存
    'api_fullpage' => [
        'pattern'  => '/api/v3/travel-products*',
        'ttl'      => 300, // 5 分钟
        'strategy' => 'revalidate',
    ],

    // 用户相关：不缓存
    'user_data' => [
        'pattern'  => '/api/v3/member/*',
        'ttl'      => 0,
        'strategy' => 'no-store',
    ],
];
```

### 3.2 Cache-Control 头部设置

在 Laravel 中，我们通过中间件统一管理缓存头：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class CdnCacheHeaders
{
    private array $rules = [
        // 静态资源：长缓存 + immutable
        'assets' => [
            'pattern'  => '#^/assets/#',
            'headers'  => [
                'Cache-Control' => 'public, max-age=31536000, immutable',
            ],
        ],
        // 商品图片：支持 SWR
        'product_images' => [
            'pattern'  => '#^/images/products/#',
            'headers'  => [
                'Cache-Control' => 'public, max-age=604800, stale-while-revalidate=86400',
            ],
        ],
        // API 列表页：短缓存 + 必须验证
        'api_list' => [
            'pattern'  => '#^/api/v3/(travel-products|categories)#',
            'headers'  => [
                'Cache-Control' => 'public, max-age=300, stale-while-revalidate=60',
                'Vary'          => 'Accept, Accept-Language, X-Currency',
            ],
        ],
        // 用户接口：禁止缓存
        'user_api' => [
            'pattern'  => '#^/api/v3/(member|cart|checkout)#',
            'headers'  => [
                'Cache-Control' => 'private, no-store, no-cache, must-revalidate',
            ],
        ],
    ];

    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        foreach ($this->rules as $rule) {
            if (preg_match($rule['pattern'], $request->getPathInfo())) {
                foreach ($rule['headers'] as $key => $value) {
                    $response->headers->set($key, $value);
                }
                break;
            }
        }

        return $response;
    }
}
```

**踩坑 #1：Vary 头的陷阱**

> 曾经有同事给 API 响应加了 `Vary: Accept-Language`，本来是为了让 CDN 按语言返回不同缓存版本。但 CloudFront 默认只缓存 **一个 Vary 变体**，导致切换语言后看到的还是中文内容。更糟糕的是，这个 Bug 在开发环境无法复现，因为开发机的 Accept-Language 固定为中文。直到测试同事用英文系统测试时才发现问题。解决办法是启用 CloudFront 的 `Cache Policy` 中的 `EnableAcceptEncodingBrotli` 和 `EnableAcceptEncodingGzip`，并确保 Vary 只包含必要的头。这个教训告诉我们：CDN 相关的 Bug 一定要在多语言环境下测试。

---

## 四、CloudFront 实战配置

### 4.1 Cache Policy 配置（Terraform）

```hcl
# cloudfront-cache-policy.tf
resource "aws_cloudfront_cache_policy" "api_b2c" {
  name        = "b2c-api-cache-policy"
  comment     = "B2C API 缓存策略"
  default_ttl = 300
  max_ttl     = 86400
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "whitelist"
      cookies         = ["XSRF-TOKEN", "locale"]
    }

    headers_config {
      header_behavior = "whitelist"
      headers         = [
        "Accept",
        "Accept-Language",
        "X-Currency",
      ]
    }

    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings         = ["page", "per_page", "category_id", "sort"]
    }

    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}
```

### 4.2 Origin Shield 配置

```hcl
resource "aws_cloudfront_distribution" "b2c_api" {
  # ... 其他配置 ...

  origin {
    domain_name = "api.b2c.example.com"
    origin_id   = "b2c-api-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Origin Shield - 减少回源
    origin_shield {
      enabled              = true
      origin_shield_region = "ap-southeast-1" # 选择离源站最近的区域
    }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "b2c-api-origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    cache_policy_id = aws_cloudfront_cache_policy.api_b2c.id
  }
}
```

**踩坑 #2：Origin Shield 区域选错**

> 我们最初把 Origin Shield 放在 `us-east-1`（因为 CloudFront 管理面在那里），但源站在 `ap-southeast-1`（新加坡）。结果每次回源都跨太平洋，延迟增加了 200ms+。更严重的是，在高峰期这个延迟波动很大，有时甚至超过 500ms，导致用户体验极差。经过一周的排查才发现是 Shield 区域问题。**Origin Shield 必须选离源站最近的区域**——这个配置看似简单，却是新手最容易犯的错误之一。

---

## 五、回源策略：如何保护源站不被打垮

### 5.1 回源风暴的典型场景

在电商大促场景中，回源风暴是最常见的 CDN 故障模式。当某个热门商品页面的缓存同时过期，或者营销活动导致大量新页面请求涌入时，所有请求都会同时穿透 CDN 回到源站。以下是一个典型的故障场景：

```
场景：商品列表页缓存过期，同一秒内 10,000 个请求同时回源
```

```
         10,000 requests
              │
              ▼
    ┌─────────────────┐
    │   CDN 边缘节点   │ ← 缓存刚好过期（TTL 到了）
    └────────┬────────┘
             │ 10,000 个请求全部回源！
             ▼
    ┌─────────────────┐
    │  Origin Shield   │ ← 如果 Shield 也过期了，灾难
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │    源站 API      │ ← 💥 瞬间被打垮
    └─────────────────┘
```

### 5.2 解决方案：三层防护

我们团队总结了一套「三层防护」策略来应对回源风暴。第一层是 `stale-while-revalidate`，让 CDN 在缓存过期后的窗口期内继续返回旧内容，同时在后台异步刷新；第二层是 `stale-if-error`，当源站返回错误时继续使用过期缓存；第三层是 `Surrogate-Key`，用于精细的缓存失效控制。这三层防护结合起来，可以将回源风暴的冲击降低 90% 以上。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Cache;

class CdnOriginProtection
{
    public function handle($request, Closure $next)
    {
        $response = $next($request);

        // 第一层：stale-while-revalidate
        // 在 Cache-Control 中设置，CDN 在缓存过期后的指定时间内
        // 仍然返回旧缓存，同时在后台异步刷新
        $response->headers->set(
            'Cache-Control',
            'public, max-age=300, stale-while-revalidate=600'
        );

        // 第二层：stale-if-error
        // 如果源站返回 5xx，CDN 继续使用过期缓存
        $response->headers->set(
            'Cache-Control',
            $response->headers->get('Cache-Control') . ', stale-if-error=86400'
        );

        // 第三层：Surrogate-Key（用于精细失效）
        $response->headers->set('Surrogate-Key', $this->buildSurrogateKey($request));

        return $response;
    }

    private function buildSurrogateKey($request): string
    {
        $keys = ['global'];

        if ($request->is('api/v3/travel-products*')) {
            $keys[] = 'products';
            if ($categoryId = $request->query('category_id')) {
                $keys[] = "category-{$categoryId}";
            }
        }

        return implode(' ', $keys);
    }
}
```

### 5.3 Cloudflare Workers：高级回源控制

对于 Cloudflare 用户，可以用 Worker 实现更精细的回源控制：

```javascript
// cloudflare-worker-origin-protection.js
export default {
  async fetch(request, env, ctx) {
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);

    // 尝试从缓存读取
    let response = await cache.match(cacheKey);

    if (response) {
      // 检查是否在 stale-while-revalidate 窗口内
      const cacheTime = new Date(response.headers.get('X-Cache-Time'));
      const maxAge = parseInt(response.headers.get('X-Max-Age') || '300');
      const swr = parseInt(response.headers.get('X-SWR') || '600');
      const now = Date.now();

      const age = (now - cacheTime.getTime()) / 1000;

      if (age > maxAge && age < maxAge + swr) {
        // 在 SWR 窗口内：返回旧缓存，后台 revalidate
        ctx.waitUntil(revalidateRequest(request, env));
      }

      return response;
    }

    // Cache Miss：回源
    response = await fetch(request);

    if (response.ok) {
      // 缓存成功响应
      const clonedResponse = response.clone();
      const headers = new Headers(clonedResponse.headers);
      headers.set('X-Cache-Time', new Date().toISOString());
      headers.set('X-Max-Age', '300');
      headers.set('X-SWR', '600');

      const cachedResponse = new Response(clonedResponse.body, {
        status: clonedResponse.status,
        headers,
      });

      ctx.waitUntil(cache.put(cacheKey, cachedResponse));
    }

    return response;
  },
};

async function revalidateRequest(request, env) {
  const freshResponse = await fetch(request);
  if (freshResponse.ok) {
    const cache = caches.default;
    const headers = new Headers(freshResponse.headers);
    headers.set('X-Cache-Time', new Date().toISOString());
    await cache.put(request, new Response(freshResponse.body, {
      status: freshResponse.status,
      headers,
    }));
  }
}
```

---

## 六、缓存失效：发版后如何让用户看到最新内容

在实际项目中，缓存失效是最容易出问题的环节。我们团队曾经因为发版后缓存未及时清除，导致用户看到旧版页面长达 4 小时。以下是我们总结的三种失效策略，适用于不同场景。

### 6.1 静态资源：文件名哈希（推荐）

```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // 文件名带 hash，发版后自动失效
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
      },
    },
  },
});
```

```nginx
# nginx.conf - 静态资源长缓存
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    # 不同版本文件名不同，无需手动清理缓存
}
```

### 6.2 API 响应：Tag-Based 缓存失效

```php
<?php

namespace App\Services\Cdn;

use Illuminate\Support\Facades\Http;

class CloudflarePurgeService
{
    private string $zoneId;
    private string $apiToken;

    public function __construct()
    {
        $this->zoneId  = config('services.cloudflare.zone_id');
        $this->apiToken = config('services.cloudflare.api_token');
    }

    /**
     * 通过 Purge Tag 批量失效缓存
     */
    public function purgeByTags(array $tags): bool
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiToken}",
            'Content-Type'  => 'application/json',
        ])->post(
            "https://api.cloudflare.com/client/v4/zones/{$this->zoneId}/purge_cache",
            ['tags' => $tags]
        );

        return $response->json('success');
    }

    /**
     * 通过 URL 精确失效
     */
    public function purgeByUrls(array $urls): bool
    {
        $response = Http::withHeaders([
            'Authorization' => "Bearer {$this->apiToken}",
        ])->post(
            "https://api.cloudflare.com/client/v4/zones/{$this->zoneId}/purge_cache",
            ['files' => $urls]
        );

        return $response->json('success');
    }
}
```

### 6.3 在 Service Layer 中触发失效

在 Laravel 项目中，我们采用「双层失效」策略：先清除应用层缓存（Redis），再通知 CDN 失效。这样即使 CDN 失效延迟几分钟，应用层也能保证数据一致性。

```php
<?php

namespace App\Services\Product;

use App\Models\Product;
use App\Services\Cdn\CloudflarePurgeService;

class ProductService
{
    public function __construct(
        private CloudflarePurgeService $cdnPurge,
    ) {}

    public function updateProduct(Product $product, array $data): Product
    {
        $product->update($data);

        // 1. 清除应用层缓存
        cache()->forget("product:{$product->id}");
        cache()->forget("product:list:category-{$product->category_id}");

        // 2. 清除 CDN 缓存
        $this->cdnPurge->purgeByTags([
            "product-{$product->id}",
            "category-{$product->category_id}",
            'products',
        ]);

        return $product;
    }
}
```

**踩坑 #3：Cloudflare Tag 格式限制**

> Cloudflare 的 Purge Tag **不支持中文和特殊字符**。我们曾经用商品中文名作为 Tag（如 `商品-12345`），结果调用 API 时返回 400。规范做法是用纯英文+数字+连字符，如 `product-12345`。

**踩坑 #4：批量失效的频率限制**

> Cloudflare 的 Tag-Based 失效 API 有频率限制：每分钟最多 500 次调用。在批量更新商品信息时，如果每个商品都单独调用一次失效 API，很容易触发限流。解决方案：使用队列批量收集失效 Tag，每 5 秒统一发送一次失效请求。我们用 Laravel 的 `Bus::batch()` 实现了这个逻辑，将失效请求合并到同一个队列任务中处理。

---

## 七、多区域部署：全球用户的缓存一致性

### 7.1 问题：不同区域看到不同价格

B2C 电商经常有「地区定价」需求。如果 CDN 缓存了「美国价格」，日本用户访问到美国边缘节点时会看到错误价格。这在旅游电商平台尤其常见——同一商品在不同国家的定价可能相差 30% 以上。更严重的是，如果价格信息被错误缓存，可能导致用户下单后发现价格不一致，引发客诉甚至法律风险。

### 7.2 解决方案：Geo-Based Cache Key

```hcl
# CloudFront Function - 按区域分缓存
resource "aws_cloudfront_function" "geo_cache_key" {
  name    = "geo-based-cache-key"
  runtime = "cloudfront-js-2.0"
  comment = "按区域分缓存 Key"
  publish = true

  code = <<-EOF
    function handler(event) {
      var request = event.request;
      var country = request.headers['cloudfront-viewer-country']
        ? request.headers['cloudfront-viewer-country'].value
        : 'US';

      // 将国家代码加入缓存 Key
      // 这样不同国家的用户会看到不同的缓存版本
      request.headers['x-cache-country'] = { value: country };

      return request;
    }
  EOF
}
```

```php
// Laravel 中间件：根据 CDN 传来的国家代码设置定价
class RegionalPricing
{
    public function handle($request, Closure $next)
    {
        $country = $request->header('X-Cache-Country', 'US');
        app()->instance('viewer_country', $country);

        $response = $next($request);

        // 确保 Vary 包含自定义头，CDN 会按此分缓存
        $response->headers->set('Vary', 'Accept, X-Cache-Country');

        return $response;
    }
}
```

**踩坑 #4：Geo Header 被 Vary 剥离**

> CloudFront 默认不会把 `CloudFront-Viewer-Country` 转发给源站。需要在 **Origin Request Policy** 中显式添加该头，否则 Laravel 拿到的永远是 `null`。我们曾经花了两天时间排查一个「日本用户看到美国价格」的 Bug，最后发现就是因为 Geo Header 没有被转发。这个配置看似简单，但在 CloudFront 的 Origin Request Policy 中有几十个可选 Header，很容易遗漏。建议在项目初期就建立配置清单，确保所有需要的 Header 都被正确转发。

---

## 八、监控与告警：CDN 不是黑盒

### 8.0 Cloudflare 实战配置

对于使用 Cloudflare 的团队，配置方式与 CloudFront 有显著差异。Cloudflare 提供免费的 Page Rules 和 Workers，适合中小项目快速上手。

```hcl
# cloudflare-zone-settings.tf
resource "cloudflare_zone_settings_override" "b2c_zone" {
  zone_id = var.cloudflare_zone_id

  settings {
    # 浏览器缓存 TTL
    browser_cache_ttl = 14400  # 4 小时

    # 始终使用 HTTPS
    always_use_https = "on"

    # 自动 Minify
    minify {
      css  = "on"
      js   = "on"
      html = "on"
    }

    # Brotli 压缩
    brotli = "on"

    # 缓存级别
    cache_level = "aggressive"

    # Edge 缓存 TTL（Cloudflare 特有，控制边缘节点缓存时间）
    edge_cache_ttl = 7200  # 2 小时

    # Origin Cache Control（尊重源站 Cache-Control 头）
    origin_cache_control = "on"
  }
}
```

**Cloudflare Page Rules 配置（精细缓存控制）：**

```hcl
# cloudflare-page-rules.tf
resource "cloudflare_page_rule" "api_cache" {
  zone_id  = var.cloudflare_zone_id
  target   = "api.example.com/api/v3/travel-products*"
  priority = 1

  actions {
    cache_level      = "cache_everything"
    edge_cache_ttl   = 300     # 5 分钟
    browser_cache_ttl = 0      # 不缓存浏览器端（每次验证）
  }
}

resource "cloudflare_page_rule" "static_assets" {
  zone_id  = var.cloudflare_zone_id
  target   = "example.com/assets/*"
  priority = 2

  actions {
    cache_level      = "cache_everything"
    edge_cache_ttl   = 31536000  # 1 年
    browser_cache_ttl = 31536000
  }
}

# 关键：用户数据接口绝不缓存
resource "cloudflare_page_rule" "no_cache_user" {
  zone_id  = var.cloudflare_zone_id
  target   = "api.example.com/api/v3/member*"
  priority = 3

  actions {
    cache_level = "bypass"
  }
}
```

**踩坑 #5：Cloudflare「伪」缓存命中**

> Cloudflare 的 `cf-cache-status: HIT` 并不总是意味着边缘节点有缓存。在 `aggressive` 模式下，Cloudflare 可能会缓存查询参数不同的 URL（例如 `?page=1` 和 `?page=2` 共享缓存），导致用户看到错误分页数据。我们曾在一个商品列表页遇到这个问题——用户反馈说翻到第二页看到的还是第一页的商品。经过抓包分析才发现 Cloudflare 把 `?page=1` 和 `?page=2` 视为同一个缓存 Key。解决方案：对接口使用 `cache_everything` 并确保 Cache Key 包含查询参数，或者在 Cloudflare Dashboard 中开启「Query String Sort」选项。

### CDN 服务商对比

| 维度 | CloudFront | Cloudflare | 阿里云 CDN |
|------|-----------|------------|-----------|
| 免费额度 | 1TB/月出站 | 无限（免费计划） | 10GB/月 |
| 边缘节点数 | 450+ PoP | 310+ PoP | 2800+ 节点 |
| Origin Shield | ✅ 支持 | ❌ 不支持（用 Argo） | ✅ 支持 |
| Tag-Based 失效 | ❌ 不支持 | ✅ 支持 | ❌ 不支持 |
| Workers/边缘计算 | ❌ Lambda@Edge | ✅ Workers | ❌ EdgeScript |
| 免费 SSL | ✅ ACM | ✅ 自动 | ✅ 免费证书 |
| 适合场景 | AWS 生态用户 | 全球中小站点 | 国内/亚太用户 |
| 月费（中等流量） | $50-200 | $0-20 | ¥100-500 |

> **选型建议**：源站在 AWS 且流量较大时，CloudFront + Origin Shield 是最佳选择；预算有限或需要边缘计算能力，Cloudflare 是性价比之王；面向中国大陆用户时，阿里云 CDN 的节点覆盖和合规性无可替代。

### 8.1 关键指标监控

```php
<?php

namespace App\Services\Monitoring;

class CdnMetricsCollector
{
    /**
     * 从 CloudFront 获取缓存命中率
     */
    public function getCacheHitRate(string $distributionId, int $hours = 24): float
    {
        $cloudwatch = app('aws.cloudwatch');

        $result = $cloudwatch->getMetricData([
            'StartTime' => now()->subHours($hours)->toIso8601String(),
            'EndTime'   => now()->toIso8601String(),
            'MetricDataQueries' => [
                [
                    'Id'         => 'hitRate',
                    'Expression' => '(requests - originRequests) / requests * 100',
                    'Label'      => 'Cache Hit Rate (%)',
                    'ReturnData' => true,
                ],
                [
                    'Id'         => 'requests',
                    'MetricStat' => [
                        'Metric' => [
                            'Namespace'  => 'AWS/CloudFront',
                            'MetricName' => 'Requests',
                            'Dimensions' => [
                                ['Name' => 'DistributionId', 'Value' => $distributionId],
                            ],
                        ],
                        'Period' => 3600,
                        'Stat'   => 'Sum',
                    ],
                    'ReturnData' => false,
                ],
                [
                    'Id'         => 'originRequests',
                    'MetricStat' => [
                        'Metric' => [
                            'Namespace'  => 'AWS/CloudFront',
                            'MetricName' => 'OriginRequests',
                            'Dimensions' => [
                                ['Name' => 'DistributionId', 'Value' => $distributionId],
                            ],
                        ],
                        'Period' => 3600,
                        'Stat'   => 'Sum',
                    ],
                    'ReturnData' => false,
                ],
            ],
        ]);

        $values = $result->get('MetricDataResults')[0]['Values'] ?? [];
        return !empty($values) ? round(end($values), 2) : 0.0;
    }
}
```

### 8.2 告警规则

CDN 监控不能只看 Dashboard，必须配置自动化告警。我们的告警策略分为三个级别：日常巡检（信息级）、异常预警（警告级）、故障响应（严重级）。以下是 Prometheus AlertManager 的配置。

**踩坑 #7：Cloudflare Analytics 与真实日志不一致**

> Cloudflare Dashboard 上显示的缓存命中率可能与 Workers 日志中的不一致。这是因为 Dashboard 包含了 Argo Smart Routing 的缓存，而 Workers 日志只记录了经过 Worker 的请求。**监控应以 CloudWatch/Prometheus 为准，Dashboard 仅作参考**。我们曾经因为这个差异误判了缓存配置的效果，后来统一使用 Prometheus 指标作为唯一数据源，才解决了这个问题。

```yaml
# Prometheus AlertManager rules
groups:
  - name: cdn_alerts
    rules:
      - alert: CdnCacheHitRateLow
        expr: cdn_cache_hit_rate < 80
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "CDN 缓存命中率低于 80%"
          description: "当前命中率 {{ $value }}%，可能存在缓存配置问题或大量请求绕过缓存"

      - alert: CdnOriginLatencyHigh
        expr: cdn_origin_latency_p99 > 2000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "CDN 回源延迟 P99 超过 2 秒"
          description: "可能存在回源风暴或源站性能问题"
```

---

## 九、Nginx 本地缓存：源站最后一道防线

即使有 CDN 加速，源站 Nginx 的本地缓存仍然非常重要——它能在 CDN 全部 Miss 时保护后端 PHP-FPM 进程。在我们的 B2C 项目中，Nginx 本地缓存将 PHP-FPM 的并发处理能力从 200 QPS 提升到了 1500 QPS，这对源站的稳定性至关重要。特别是在 CDN 回源或源站重启时，本地缓存能有效防止雪崩效应。

### 9.1 FastCGI Cache 配置

```nginx
# /etc/nginx/conf.d/fastcgi-cache.conf

# 定义缓存区域
fastcgi_cache_path /var/cache/nginx/fastcgi
    levels=1:2
    keys_zone=B2C_API:64m
    max_size=2g
    inactive=60m
    use_temp_path=off;

# 缓存 Key 定义
fastcgi_cache_key "$scheme$request_method$host$request_uri";

server {
    listen 80;
    server_name api.example.com;

    location ~ \.php$ {
        # 缓存 bypass 条件
        set $skip_cache 0;
        if ($request_method = POST) { set $skip_cache 1; }
        if ($http_cookie ~* "session_id|XSRF-TOKEN") { set $skip_cache 1; }
        if ($request_uri ~* "^/api/v3/(member|cart|checkout)") { set $skip_cache 1; }

        fastcgi_cache B2C_API;
        fastcgi_cache_valid 200 60m;
        fastcgi_cache_valid 404 1m;
        fastcgi_cache_bypass $skip_cache;
        fastcgi_no_cache $skip_cache;

        # 添加缓存状态头（便于调试）
        add_header X-Cache-Status $upstream_cache_status;

        # stale-while-revalidate：缓存过期后返回旧内容
        fastcgi_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        fastcgi_cache_background_update on;
        fastcgi_cache_lock on;
        fastcgi_cache_lock_timeout 5s;

        include fastcgi_params;
        fastcgi_pass unix:/var/run/php-fpm.sock;
    }
}
```

### 9.2 Proxy Cache 配置（适合静态资源代理）

Proxy Cache 适用于代理后端服务的静态资源或 API 响应。与 FastCGI Cache 不同，Proxy Cache 可以缓存任意 HTTP 响应，包括来自 Node.js、Go 等非 PHP 后端的内容。在我们的架构中，商品图片通过 Nginx Proxy Cache 代理到 Laravel Storage，命中率达到了 95% 以上。

```nginx
# /etc/nginx/conf.d/proxy-cache.conf
proxy_cache_path /var/cache/nginx/proxy
    levels=1:2
    keys_zone=STATIC:128m
    max_size=5g
    inactive=7d
    use_temp_path=off;

# 缓存锁：防止缓存击穿（同一资源同时回源）
proxy_cache_lock on;
proxy_cache_lock_timeout 3s;
proxy_cache_lock_age 5s;

server {
    listen 80;
    server_name cdn-origin.example.com;

    location /images/products/ {
        proxy_cache STATIC;
        proxy_cache_valid 200 7d;
        proxy_cache_valid 404 1m;
        proxy_cache_key "$scheme$host$request_uri";

        # 缓存 bypass：商品更新时通过 PURGE 方法清除
        if ($request_method = PURGE) {
            return 405;  # 禁止外部 PURGE，仅允许内网
        }

        # 添加缓存状态头
        add_header X-Cache-Status $upstream_cache_status;
        add_header X-Cache-Key $upstream_cache_key;

        proxy_pass http://127.0.0.1:9000;
    }
}
```

**踩坑 #6：Nginx 缓存锁导致请求排队**

> 开启 `proxy_cache_lock on` 后，如果第一个回源请求耗时较长（比如 5 秒），后续请求会被锁定等待。如果源站有慢查询，会导致大量请求排队超时。我们曾在一个大促活动中遇到这个问题——因为某个商品详情页的数据库查询较慢，导致缓存锁超时，大量用户看到 503 错误。解决方案：设置合理的 `proxy_cache_lock_timeout`（建议 3-5 秒），超时后允许其他请求直接回源。同时，将慢查询页面加入单独的缓存区域，避免影响其他页面。

### Nginx 本地缓存 vs CDN 缓存对比

| 维度 | Nginx 本地缓存 | CDN 缓存 |
|------|---------------|---------|
| 缓存位置 | 源站服务器内存/磁盘 | 全球边缘节点 |
| 容量 | 受限于服务器资源（通常 1-10GB） | 海量（CDN 商提供） |
| 命中延迟 | <1ms（本地读取） | 10-50ms（取决于用户位置） |
| 缓存失效 | 直接删除本地文件 | 需要 API 调用或等待 TTL |
| 适用场景 | 源站热点数据保护 | 全球用户就近访问 |
| 成本 | 服务器资源占用 | CDN 流量费用 |

> **最佳组合**：CDN 边缘节点做第一层缓存，Nginx FastCGI/Proxy Cache 做第二层保护，Laravel Redis 做第三层应用缓存。三层联动，即使 CDN 全部 Miss 也不会直接打到数据库。

---

## 十、CDN 成本优化实战

对于中等规模的 B2C 项目，CDN 费用可能占到基础设施成本的 15-30%。我们在项目初期因为缓存配置不当，CDN 月费一度高达 $500+。经过优化后降至 $80 左右，同时缓存命中率从 65% 提升到了 92%。以下是经过验证的省钱策略：

### 10.1 减少不必要的缓存变体

Vary 头是 CDN 缓存碎片化的主要元凶。每增加一个 Vary 变体，CDN 就需要为每种组合维护独立的缓存副本。在我们的项目中，仅通过精简 Vary 头，缓存命中率就从 65% 提升到了 85%。以下是常见的错误和正确做法：

```php
// ❌ 错误：Vary 头太多，导致缓存碎片化
$response->headers->set('Vary', 'Accept, Accept-Language, Accept-Encoding, X-Currency, X-Region, User-Agent');
// 每个组合都是独立缓存，命中率暴跌

// ✅ 正确：只 Vary 真正影响内容的头
$response->headers->set('Vary', 'Accept-Encoding, X-Currency');
// Accept-Encoding 用于 Brotli/Gzip，X-Currency 用于多币种定价
```

### 10.2 合理设置 TTL

TTL（Time To Live）设置是 CDN 成本控制的核心。TTL 过短会导致频繁回源，增加源站压力和 CDN 费用；TTL 过长则可能导致用户看到过期内容。我们根据资源类型和更新频率，制定了以下 TTL 策略：对于频繁变化的 API 响应（如库存数量），设置 5 分钟 TTL；对于变化较慢的商品信息（如标题、描述），设置 1 小时 TTL；对于几乎不变的分类数据，设置 24 小时 TTL。

```php
// 商品图片：缓存时间根据更新频率调整
// 低频更新：30 天
'Cache-Control' => 'public, max-age=2592000, stale-while-revalidate=86400';

// API 列表页：根据数据新鲜度要求设置
// 热门商品列表：5 分钟
// 冷门分类列表：30 分钟
'Cache-Control' => 'public, max-age=1800, stale-while-revalidate=300';
```

### 10.3 利用免费额度

选择合适的 CDN 服务商并充分利用免费额度，是控制成本的关键。不同服务商的免费额度差异很大，需要根据实际流量模式选择。以下是我们对比了四家主流 CDN 服务商后的选型建议：

| CDN 服务商 | 免费额度 | 超出后计费 |
|-----------|---------|-----------|
| CloudFront | 1TB/月出站 + 1000万次请求 | $0.085/GB |
| Cloudflare Pro | 无限带宽 | $20/月固定 |
| 阿里云 CDN | 10GB/月 | ¥0.24/GB（国内） |
| Bunny CDN | 1TB/月 | $0.01/GB |

> **经验数据**：日均 10 万 PV 的 B2C 站点，CloudFront 月费约 $30-80；Cloudflare Pro 固定 $20/月。如果流量集中在亚太，阿里云 CDN 性价比更高。

---

## 十一、踩坑总结与最佳实践清单

| # | 问题 | 解决方案 | 严重程度 |
|---|------|----------|----------|
| 1 | Vary 头导致缓存碎片化 | 精简 Vary 列表，只包含必要的头 | ⚠️ 中 |
| 2 | Origin Shield 区域选错 | 选离源站最近的区域 | 🔴 高 |
| 3 | Purge Tag 格式限制 | 纯英文+数字+连字符 | ⚠️ 中 |
| 4 | Geo Header 未转发 | Origin Request Policy 中显式添加 | 🔴 高 |
| 5 | 回源风暴 | stale-while-revalidate + Origin Shield | 🔴 高 |
| 6 | 发版后缓存未清除 | 文件名 Hash + Tag-Based 失效 | ⚠️ 中 |
| 7 | 用户数据被缓存 | Cache-Control: private, no-store | 🔴 高 |
| 8 | Cloudflare 伪缓存命中 | API 使用 cache_everything + 查询参数进 Key | ⚠️ 中 |
| 9 | Nginx 缓存锁排队 | 设置合理的 lock_timeout | ⚠️ 中 |
| 10 | CDN 费用超预期 | 精简 Vary、合理设置 TTL、善用免费额度 | 💰 成本 |

### 最佳实践速查

以下是我们团队在实际项目中总结的 CDN 配置最佳实践，可以直接复制使用：

1. **静态资源**：文件名带 Hash → `Cache-Control: public, max-age=31536000, immutable`
2. **API 响应**：`Cache-Control: public, max-age=300, stale-while-revalidate=600, stale-if-error=86400`
3. **用户数据**：`Cache-Control: private, no-store, no-cache, must-revalidate`
4. **缓存 Key**：Vary 只包含必要头，避免碎片化
5. **回源保护**：Origin Shield + stale-while-revalidate + stale-if-error 三层防护
6. **失效机制**：静态资源用文件名 Hash，API 用 Tag-Based 批量失效
7. **本地缓存**：Nginx FastCGI/Proxy Cache 作为源站第二层保护
8. **监控告警**：缓存命中率 < 80% 告警，回源延迟 P99 > 2s 告警

---

## 十二、总结

CDN 配置的核心不是「开不开」，而是**缓存策略的设计**。在 B2C 电商场景中，CDN 是用户体验和系统稳定性的关键一环。通过本文的实战经验分享，我们希望帮助中高级开发者避开常见的 CDN 配置陷阱，建立起完整的缓存防护体系。

以下是全文的核心要点回顾：

1. **分类管理**：不同资源不同 TTL，不要一刀切。静态资源用长缓存加文件名哈希，API 响应用短缓存加 SWR，用户数据绝不缓存。
2. **回源保护**：三层防护（SWR + Shield + Error 回退）避免回源风暴。这是我们项目中投入产出比最高的优化，上线后源站负载下降了 70%。
3. **精确失效**：Tag-Based 批量失效 + 文件名 Hash 自动失效。静态资源用哈希文件名实现零成本失效，API 响应用 Tag 实现精准控制。
4. **全球一致**：Geo-Based Cache Key 解决多区域缓存不一致问题。特别是多币种定价场景，这个配置不可或缺。
5. **三层防护**：CDN 边缘 → Nginx 本地缓存 → Laravel Redis，层层保护源站。即使 CDN 出现故障，源站也能撑住流量。
6. **成本控制**：精简 Vary 头、合理设置 TTL、善用免费额度。我们的 CDN 月费从 $500 优化到了 $80。
7. **可观测性**：缓存命中率和回源延迟是 CDN 健康的核心指标。没有监控的 CDN 配置就是在盲人摸象。

记住：**CDN 是你和用户之间的最后一道防线**。配置得好，它帮你扛住 90% 的流量；配置不好，它就是一颗定时炸弹。希望本文的实战经验能帮助你少走弯路，建立起可靠的 CDN 防护体系。

---

## 相关阅读

- [AWS S3 Laravel 文件存储实战：多云备份与 CDN 加速优化](/architecture/aws-s3-laravel-guide-cdn-optimization/)
- [API Gateway 实战：Kong/APISIX/Laravel 微服务限流与灰度发布](/architecture/api-gateway-guide-kong-apisix-laravel-microservices-rate-limitingcanary/)
- [Nginx 配置实战：PHP-FPM 调优、FastCGI 缓存、Gzip 压缩](/architecture/nginx-guide-php-fpm-fastcgi-cache-gzip/)
- [对象存储实战：文件上传、CDN 加速与权限控制](/architecture/2026-06-01-object-storage-file-upload-cdn-permission-control-laravel-b2c-api/)

---

## 附录：缓存预热与降级策略

### 缓存预热脚本

在大促前，手动预热热门商品页面可以有效避免回源风暴。以下是我们的预热脚本：

```php
<?php
// app/Console/Commands/CacheWarmup.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

class CacheWarmup extends Command
{
    protected $signature = 'cache:warmup {--batch=10} {--delay=100}';
    protected $description = '预热 CDN 缓存：并发请求热门商品页面';

    public function handle(): int
    {
        $urls = $this->getHotUrls();
        $batch = $this->option('batch');
        $delay = $this->option('delay');
        $success = 0;
        $failed = 0;

        $this->info("开始预热 " . count($urls) . " 个 URL...");

        foreach (array_chunk($urls, $batch) as $chunk) {
            $promises = [];
            foreach ($chunk as $url) {
                $promises[] = Http::timeout(5)->get($url);
            }

            foreach ($promises as $i => $promise) {
                if ($promise->successful()) {
                    $success++;
                } else {
                    $failed++;
                    $this->warn("预热失败: {$chunk[$i]}");
                }
            }

            usleep($delay * 1000); // 控制请求频率
        }

        $this->info("预热完成: 成功 {$success}, 失败 {$failed}");
        return $failed > 0 ? 1 : 0;
    }

    private function getHotUrls(): array
    {
        // 从数据库获取热门商品列表
        return cache()->remember('hot_product_urls', 3600, function () {
            return \App\Models\Product::query()
                ->where('sales_count', '>', 100)
                ->limit(500)
                ->pluck('slug')
                ->map(fn($slug) => "https://example.com/products/{$slug}")
                ->toArray();
        });
    }
}
```

### 降级策略

当 CDN 服务出现故障或异常时，需要有快速降级方案：

```php
<?php
// app/Services/Cdn/CdnFallbackService.php

namespace App\Services\Cdn;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class CdnFallbackService
{
    /**
     * 检测 CDN 是否可用，不可用时切换到直连源站
     */
    public function isCdnHealthy(): bool
    {
        return cache()->remember('cdn_health_check', 30, function () {
            try {
                $response = Http::timeout(2)
                    ->head('https://cdn.example.com/health-check');
                return $response->successful();
            } catch (\Exception $e) {
                Log::warning('CDN 健康检查失败', [
                    'error' => $e->getMessage(),
                ]);
                return false;
            }
        });
    }

    /**
     * 获取资源 URL，CDN 不可用时回退到源站
     */
    public function assetUrl(string $path): string
    {
        if ($this->isCdnHealthy()) {
            return config('app.cdn_url') . '/' . $path;
        }

        Log::info('CDN 不可用，回退到源站', ['path' => $path]);
        return config('app.url') . '/' . $path;
    }
}
```

> **踩坑 #8：CDN 降级时的数据库压力**

> 当 CDN 降级到直连源站时，所有请求都会直接打到数据库。如果没有做好限流，数据库可能在几分钟内被压垮。我们曾在一次 CDN 故障中经历过这个问题——CDN 服务中断了 15 分钟，但数据库因为没有限流保护，在第 5 分钟就出现了连接池耗尽的情况，导致整个服务宕机。解决方案：在降级模式下启用 Nginx 限流（`limit_req_zone`），同时将非关键接口（如商品推荐）返回缓存数据或静态降级页面。关键接口则设置并发上限，确保数据库不会被打垮。
