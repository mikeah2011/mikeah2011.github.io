---
title: CDN 配置实战-静态资源加速缓存策略与回源配置-Laravel-B2C-API 踩坑记录
date: 2026-05-05 08:50:56
updated: 2026-05-05 08:53:49
categories:
  - Architecture
  - Infra
tags: [AWS, DevOps, Laravel, Nginx, 性能优化, 缓存]
description: "在 30+ 仓库的 Laravel B2C API 项目中，CDN 不只是「套一层缓存」这么简单。本文涵盖 CloudFront/Cloudflare 实战配置、缓存 Key 设计、回源策略、多区域部署、缓存失效机制与真实踩坑记录，是中高级开发者落地 CDN 加速的完整指南。"



---
# CDN 配置实战：静态资源加速、缓存策略、回源配置

## 一、前言：CDN 不只是「加一层缓存」

在 B2C 电商场景中，CDN 扮演着至关重要的角色——商品图片、前端 Bundle、API 响应（全页缓存）都需要通过 CDN 分发到全球边缘节点。但很多团队对 CDN 的理解停留在「开了就行」的层面，直到遇到以下问题：

- 缓存了用户个人信息（隐私泄露）
- 发版后用户看到旧版本（缓存未失效）
- 回源风暴导致源站宕机（缓存雪崩）
- 不同国家看到不同价格（缓存 Key 设计缺陷）

本文基于 KKday B2C API 项目的真实经验，系统性地梳理 CDN 配置的方方面面。

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

> 曾经有同事给 API 响应加了 `Vary: Accept-Language`，本来是为了让 CDN 按语言返回不同缓存版本。但 CloudFront 默认只缓存 **一个 Vary 变体**，导致切换语言后看到的还是中文内容。解决办法是启用 CloudFront 的 `Cache Policy` 中的 `EnableAcceptEncodingBrotli` 和 `EnableAcceptEncodingGzip`，并确保 Vary 只包含必要的头。

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

> 我们最初把 Origin Shield 放在 `us-east-1`（因为 CloudFront 管理面在那里），但源站在 `ap-southeast-1`（新加坡）。结果每次回源都跨太平洋，延迟增加了 200ms+。**Origin Shield 必须选离源站最近的区域**。

---

## 五、回源策略：如何保护源站不被打垮

### 5.1 回源风暴的典型场景

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

---

## 七、多区域部署：全球用户的缓存一致性

### 7.1 问题：不同区域看到不同价格

B2C 电商经常有「地区定价」需求。如果 CDN 缓存了「美国价格」，日本用户访问到美国边缘节点时会看到错误价格。

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

> CloudFront 默认不会把 `CloudFront-Viewer-Country` 转发给源站。需要在 **Origin Request Policy** 中显式添加该头，否则 Laravel 拿到的永远是 `null`。

---

## 八、监控与告警：CDN 不是黑盒

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

## 九、踩坑总结与最佳实践清单

| # | 问题 | 解决方案 | 严重程度 |
|---|------|----------|----------|
| 1 | Vary 头导致缓存碎片化 | 精简 Vary 列表，只包含必要的头 | ⚠️ 中 |
| 2 | Origin Shield 区域选错 | 选离源站最近的区域 | 🔴 高 |
| 3 | Purge Tag 格式限制 | 纯英文+数字+连字符 | ⚠️ 中 |
| 4 | Geo Header 未转发 | Origin Request Policy 中显式添加 | 🔴 高 |
| 5 | 回源风暴 | stale-while-revalidate + Origin Shield | 🔴 高 |
| 6 | 发版后缓存未清除 | 文件名 Hash + Tag-Based 失效 | ⚠️ 中 |
| 7 | 用户数据被缓存 | Cache-Control: private, no-store | 🔴 高 |

### 最佳实践速查

1. **静态资源**：文件名带 Hash → `Cache-Control: public, max-age=31536000, immutable`
2. **API 响应**：`Cache-Control: public, max-age=300, stale-while-revalidate=600, stale-if-error=86400`
3. **用户数据**：`Cache-Control: private, no-store, no-cache, must-revalidate`
4. **缓存 Key**：Vary 只包含必要头，避免碎片化
5. **回源保护**：Origin Shield + stale-while-revalidate + stale-if-error 三层防护
6. **失效机制**：静态资源用文件名 Hash，API 用 Tag-Based 批量失效
7. **监控告警**：缓存命中率 < 80% 告警，回源延迟 P99 > 2s 告警

---

## 十、总结

CDN 配置的核心不是「开不开」，而是**缓存策略的设计**：

1. **分类管理**：不同资源不同 TTL，不要一刀切
2. **回源保护**：三层防护（SWR + Shield + Error 回退）避免回源风暴
3. **精确失效**：Tag-Based 批量失效 + 文件名 Hash 自动失效
4. **全球一致**：Geo-Based Cache Key 解决多区域缓存不一致问题
5. **可观测性**：缓存命中率和回源延迟是 CDN 健康的核心指标

记住：**CDN 是你和用户之间的最后一道防线**。配置得好，它帮你扛住 90% 的流量；配置不好，它就是一颗定时炸弹。
