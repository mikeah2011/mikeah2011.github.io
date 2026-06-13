---
title: CSP 内容安全策略实战 - 防御 XSS 攻击 - Laravel Nonce、strict-dynamic 与生产踩坑记录
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-16 22:10:07
updated: 2026-05-16 22:16:59
categories:
  - architecture
  - php
tags: [Laravel, 安全, OWASP, XSS, CSP]
keywords: [CSP, XSS, Laravel Nonce, strict, dynamic, 内容安全策略实战, 防御, 攻击, 与生产踩坑记录, 架构]
description: 从 OWASP Top 10 中 XSS 防护的「最后一道防线」出发，深入实战 CSP（Content-Security-Policy）在 Laravel B2C API 项目中的落地经验。涵盖 nonce 生成与 Blade 集成、strict-dynamic 策略、report-only 灰度、violation reporting 端点、Nginx 层配置，以及生产环境真实踩坑记录。



---

## 为什么需要 CSP？

在 OWASP Top 10 中，XSS（跨站脚本攻击）常年位居前列。我们常用的防御手段——HTML 转义、输入验证、CSRF Token——都是在**应用层**防止恶意脚本注入。但如果某天一个 0day 绕过了所有应用层校验呢？

CSP（Content-Security-Policy）就是这**最后一道防线**。它在浏览器层面告诉：「这个页面只允许加载来自这些来源的脚本、样式、图片……其他的全部拦截。」即使攻击者成功注入了一段 `<script>`，浏览器也会因为 CSP 策略拒绝执行。

在 KKday B2C 项目中，我们从零接入 CSP 的过程踩了不少坑。今天来完整复盘。

## 架构全景

```
┌─────────────────────────────────────────────────────────┐
│                      浏览器（Client）                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 1. 收到 HTTP Response                              │  │
│  │ 2. 解析 Content-Security-Policy 头                 │  │
│  │ 3. 构建 CSP 策略模型（directive → source list）     │  │
│  │ 4. 遇到 <script>/<style>/fetch → 检查是否合规       │  │
│  │ 5. 违规 → 拦截 + 上报 violation report              │  │
│  └───────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP Response
┌───────────────────────────┴─────────────────────────────┐
│                   Nginx / Laravel                        │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Middleware: 注入 CSP 头（nonce 生成、策略组装）      │  │
│  │ Nginx: 全局安全头兜底（HSTS、X-Frame-Options）      │  │
│  │ Report Endpoint: 接收 violation reports             │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## CSP 核心指令速查

CSP 策略由一组 **directive（指令）** 组成，每条指令控制一类资源：

```text
Content-Security-Policy:
  default-src 'self';                                    # 默认兜底
  script-src 'self' 'nonce-abc123' 'strict-dynamic';    # JS 脚本
  style-src 'self' 'unsafe-inline';                      # CSS 样式
  img-src 'self' data: https:;                           # 图片
  font-src 'self' https://fonts.gstatic.com;             # 字体
  connect-src 'self' https://api.kkday.com;              # AJAX/fetch
  frame-src 'none';                                      # iframe
  base-uri 'self';                                       # <base> 标签
  form-action 'self';                                    # <form> 提交
  report-uri /csp-violation-report;                      # 违规上报
```

| 指令 | 控制范围 | 常用值 |
|------|---------|--------|
| `default-src` | 所有资源的兜底 | `'self'`, `'none'` |
| `script-src` | `<script>`, 内联事件 | `'self'`, `'nonce-xxx'`, `'strict-dynamic'` |
| `style-src` | `<style>`, `style=` 属性 | `'self'`, `'unsafe-inline'` |
| `img-src` | `<img>`, `favicon` | `'self'`, `data:`, `https:` |
| `connect-src` | `fetch`, `XHR`, `WebSocket` | `'self'`, API 域名 |
| `frame-src` | `<iframe>` 来源 | `'none'`, 支付网关域名 |

**关键原则**：`default-src` 是兜底。如果某个指令没设置，浏览器会用 `default-src` 的值。所以最安全的做法是 `default-src 'none'`，然后逐条放开。

## 方案一：Nonce-Based CSP（推荐）

### 为什么不用 `'unsafe-inline'`？

最简单的 CSP 是 `script-src 'self' 'unsafe-inline'`——允许所有内联脚本。但这等于**放弃了 CSP 对 XSS 的防护**，因为攻击者注入的 `<script>alert(1)</script>` 也是内联脚本。

正确的做法是 **nonce（一次性随机数）**：服务端每次请求生成一个随机值，把它写到 CSP 头和 `<script>` 标签上。浏览器只执行 nonce 匹配的脚本。

### Laravel Nonce 中间件实现

```php
<?php
// app/Http/Middleware/ContentSecurityPolicy.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class ContentSecurityPolicy
{
    /**
     * 本次请求的 CSP nonce，存到 request attributes 便于 Blade 使用
     */
    public function handle(Request $request, Closure $next): Response
    {
        // 每次请求生成 128-bit nonce（base64 编码后 22 字符）
        $nonce = Str::random(32); // 256-bit hex，更安全
        $request->attributes->set('csp_nonce', $nonce);

        $response = $next($request);

        // 只对 HTML 响应注入 CSP 头，API JSON 响应不需要
        if ($this->shouldApplyCsp($request, $response)) {
            $policy = $this->buildPolicy($nonce);
            $response->headers->set('Content-Security-Policy', $policy);
        }

        return $response;
    }

    private function shouldApplyCsp(Request $request, Response $response): bool
    {
        // 只对 text/html 响应应用 CSP
        $contentType = $response->headers->get('Content-Type', '');
        if (!str_contains($contentType, 'text/html')) {
            return false;
        }

        // 排除 API 路由（通常返回 JSON）
        if ($request->is('api/*')) {
            return false;
        }

        return true;
    }

    private function buildPolicy(string $nonce): string
    {
        $directives = [
            "default-src 'self'",
            // script-src：nonce + strict-dynamic（忽略 'self'，信任 nonce 派生的脚本）
            "script-src 'nonce-{$nonce}' 'strict-dynamic'",
            // style-src：'unsafe-inline' 是妥协——很多 UI 框架需要内联样式
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self' https://fonts.gstatic.com",
            "connect-src 'self' https://api.kkday.com https://*.kkday.com",
            "frame-src 'self' https://www.google.com https://payment.gateway.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "upgrade-insecure-requests",
            // 违规上报端点
            "report-uri /csp-violation-report",
        ];

        return implode('; ', $directives);
    }
}
```

### Blade 模板集成 nonce

注册中间件后，在 Blade 中使用 nonce：

```php
// app/Providers/AppServiceProvider.php
public function register(): void
{
    // 注册 Blade 指令
    \Blade::directive('cspNonce', function () {
        return '<?php echo app(\Illuminate\Http\Request::class)->attributes->get("csp_nonce", ""); ?>';
    });
}
```

```html
{{-- resources/views/layouts/app.blade.php --}}
<!DOCTYPE html>
<html>
<head>
    {{-- Vite 资源也需要 nonce --}}
    @vite(['resources/js/app.js'], ['nonce' => request()->attributes->get('csp_nonce')])
</head>
<body>
    {{-- 内联脚本必须带 nonce --}}
    <script nonce="@cspNonce">
        window.Laravel = @json($appConfig);
    </script>

    @yield('content')

    {{-- 第三方脚本也需要 nonce --}}
    <script nonce="@cspNonce" src="https://www.googletagmanager.com/gtag/js"></script>
</body>
</html>
```

### Vite + nonce 的坑

这里有一个真实的坑：**Vite 开发模式（HMR）注入的脚本不带 nonce**。

```text
[HMR] 连接失败，因为 CSP 拒绝了 inline script
```

Vite 的 HMR client 通过 WebSocket 注入内联脚本，开发环境没有 nonce。解决方案：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/js/app.js'],
            // 开发环境自动刷新
            refresh: true,
        }),
    ],
    server: {
        // 开发环境放宽 CSP（仅限开发！）
        headers: {
            'Content-Security-Policy': "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        },
    },
});
```

同时在 Laravel 中间件里加环境判断：

```php
private function buildPolicy(string $nonce): string
{
    if (app()->environment('local')) {
        // 开发环境：放宽策略，允许 HMR
        return "default-src 'self' 'unsafe-inline' 'unsafe-eval' ws: wss: data: https:;";
    }

    // 生产环境：严格策略
    $directives = [
        "default-src 'self'",
        "script-src 'nonce-{$nonce}' 'strict-dynamic'",
        // ...
    ];

    return implode('; ', $directives);
}
```

## 方案二：strict-dynamic 深度解析

### 什么是 strict-dynamic？

`'strict-dynamic'` 是 CSP Level 3 引入的指令，含义是：**如果一个脚本是通过 nonce 信任的脚本动态创建的，那它也被信任**。

```html
<!-- 这个脚本有 nonce，被信任 -->
<script nonce="abc123">
    // 动态创建的脚本也会被信任（因为 strict-dynamic）
    const s = document.createElement('script');
    s.src = 'https://cdn.example.com/lib.js';
    document.body.appendChild(s);  // ✅ 允许执行
</script>

<!-- 没有 nonce 的外部脚本，即使域名匹配也被拒绝 -->
<script src="https://cdn.example.com/other.js"></script>
<!-- ❌ 被 CSP 拦截（strict-dynamic 忽略域名白名单）```
```

### strict-dynamic vs 域名白名单

| 策略 | 优点 | 缺点 |
|------|------|------|
| 域名白名单 `script-src 'self' https://cdn.com` | 简单直观 | CDN 被入侵 → XSS；子域名劫持 |
| nonce + strict-dynamic | 安全性最高 | 需要服务端配合；旧浏览器不支持 |

**实战建议**：生产环境用 `nonce + strict-dynamic`，对不支持 CSP3 的旧浏览器用域名白名单兜底：

```php
"script-src 'nonce-{$nonce}' 'strict-dynamic' https: http:"
```

`https: http:` 是给旧浏览器的 fallback——它们不认识 `strict-dynamic`，会忽略它，退回到域名匹配模式。新浏览器看到 `strict-dynamic` 后会忽略 `https: http:`。

## Report-Only vs Enforce 对比

| 维度 | `Content-Security-Policy-Report-Only` | `Content-Security-Policy` |
|------|---------------------------------------|---------------------------|
| **行为** | 仅记录违规，不拦截资源 | 拦截违规资源并记录 |
| **适用场景** | 灰度上线、策略调试、回归测试 | 正式生产环境 |
| **风险** | 零风险，不影响用户体验 | 配置错误可导致白屏 |
| **建议周期** | 1–2 周观察期 | 长期使用 |
| **上报能力** | ✅ 支持 `report-uri` / `report-to` | ✅ 支持 |
| **浏览器兼容** | CSP Level 2+ | CSP Level 1+ |

**最佳实践**：同时设置两个头（Report-Only 用于新策略灰度，Enforce 用于已验证策略），实现「新策略只观察 + 旧策略已强制」的双轨模式。

## Nonce vs Hash 方案对比

| 维度 | Nonce（推荐） | Hash |
|------|--------------|------|
| **原理** | 服务端生成随机数，写入 CSP 头 + `<script nonce="...">` | 对脚本内容计算 SHA-256，写入 CSP 头 |
| **动态脚本** | ✅ 天然支持（每次请求重新生成） | ❌ 脚本内容变化则 hash 失效 |
| **实现复杂度** | 中（需中间件 + Blade 集成） | 高（需构建时计算 hash） |
| **缓存友好** | ⚠️ nonce 每次不同，CDN 缓存需注意 | ✅ 内容不变则 hash 不变 |
| **安全性** | 高（128-bit 以上随机数不可预测） | 高（SHA-256 碰撞概率极低） |
| **与 `strict-dynamic`** | ✅ 完美配合 | ⚠️ 需配合 `unsafe-hashes` |
| **典型场景** | 服务端渲染（Blade、SSR） | 静态站点、构建时确定的脚本 |

**结论**：Laravel 项目推荐使用 **Nonce + strict-dynamic**，因为 Blade 模板天然支持动态 nonce 注入，且能优雅处理第三方脚本加载。

## Report-Only 灰度上线

### 为什么不能直接开 CSP？

直接在生产环境开启 CSP 风险极大。一个配置错误就可能阻断所有 JS 执行，导致页面白屏。正确做法是**先用 Report-Only 模式观察**：

```php
// 第一阶段：只上报，不拦截
$response->headers->set('Content-Security-Policy-Report-Only', $policy);

// 第二阶段：确认无误后，切换为强制执行
$response->headers->set('Content-Security-Policy', $policy);
```

### 违规上报端点

```php
<?php
// app/Http/Controllers/CspViolationController.php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class CspViolationController extends Controller
{
    public function report(Request $request)
    {
        $violation = $request->json()->all();

        // CSP 违规报告结构
        /*
        {
            "csp-report": {
                "document-uri": "https://www.kkday.com/checkout",
                "referrer": "https://www.kkday.com/cart",
                "violated-directive": "script-src 'nonce-abc123'",
                "effective-directive": "script-src",
                "original-policy": "script-src 'nonce-abc123' 'strict-dynamic'; ...",
                "disposition": "report",
                "blocked-uri": "https://evil.com/steal.js",
                "status-code": 200,
                "script-sample": ""
            }
        }
        */

        $report = $violation['csp-report'] ?? $violation;

        Log::channel('csp')->warning('CSP Violation', [
            'document_uri'       => $report['document-uri'] ?? '',
            'violated_directive' => $report['violated-directive'] ?? '',
            'blocked_uri'        => $report['blocked-uri'] ?? '',
            'source_file'        => $report['source-file'] ?? '',
            'line_number'        => $report['line-number'] ?? '',
            'disposition'        => $report['disposition'] ?? '',
            'user_agent'         => $request->userAgent(),
            'ip'                 => $request->ip(),
        ]);

        // 可选：存入数据库，接入告警
        // CspViolation::create([...]);

        return response('', 204);
    }
}
```

```php
// routes/web.php
Route::post('/csp-violation-report', [CspViolationController::class, 'report'])
    ->withoutMiddleware(['web', \App\Http\Middleware\ContentSecurityPolicy::class]);
```

### 日志通道配置

```php
// config/logging.php
'channels' => [
    'csp' => [
        'driver' => 'daily',
        'path'   => storage_path('logs/csp-violations.log'),
        'days'   => 30,
    ],
],
```

### 上线流程

```
Week 1: Content-Security-Policy-Report-Only（只观察，不拦截）
   ↓ 分析日志，调整策略
Week 2: Content-Security-Policy-Report-Only（修正后再次观察）
   ↓ 确认零误报
Week 3: Content-Security-Policy（强制执行 + 继续上报）
   ↓ 持续监控
Week 4+: 正式运行，定期审计
```

## 第三方脚本处理

### Google Analytics / Tag Manager

```html
{{-- 问题：GTM 需要 inline script + 动态加载 --}}
<script nonce="@cspNonce">
    (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','GTM-XXXX');
</script>
```

GTM 的 snippet 本身可以用 nonce，但 GTM 动态注入的后续脚本需要 `strict-dynamic`。如果 GTM 内部使用了 `eval()`（某些自定义 HTML 标签），还需要 `'unsafe-eval'`——**这会削弱 CSP 防护**。

**实战建议**：

```php
// 方案 A：允许 GTM eval（安全性降低）
"script-src 'nonce-{$nonce}' 'strict-dynamic' 'unsafe-eval'"

// 方案 B：禁用 GTM 自定义 HTML 标签（安全性最高）
// 在 GTM 后台禁用 Custom HTML Tags，只使用预定义模板
"script-src 'nonce-{$nonce}' 'strict-dynamic'"
```

### 嵌入式支付页面

支付网关（Stripe、支付宝）通常需要 iframe：

```php
"frame-src 'self' https://js.stripe.com https://mapi.alipay.com"
```

注意：Stripe.js 会动态创建 iframe，需要确保 `frame-src` 包含其域名。我们遇到过 Stripe 升级后新增了 `https://hooks.stripe.com` 子域名导致支付弹窗空白的坑——**Report-Only 阶段一定要覆盖所有支付流程的测试**。

## 生产踩坑记录

### 踩坑 1：`data:` URI 图片被拦截

```text
❌ Refused to load the image 'data:image/svg+xml;base64,...'
   because it violates the following Content Security Policy directive:
   "img-src 'self'"
```

很多 UI 组件库用 `data:` URI 内嵌 SVG 图标。解决：

```php
"img-src 'self' data: https:"
```

### 踩坑 2：Vue 的 `__vue__` 属性检测被拦截

Vue 3 内部会检测 `document.querySelector('[data-v-xxx]')`，在某些 CSP 配置下会触发 violation。这通常是 `style-src` 缺少 `'unsafe-inline'` 导致 Vue 的 scoped style 无法注入。

```php
// Vue scoped style 需要 'unsafe-inline'
"style-src 'self' 'unsafe-inline'"
```

### 踩坑 3：Sentry 错误追踪被阻断

Sentry 的 JS SDK 会动态创建 `<script>` 标签加载 source map 上传器，且使用 `eval()` 解析 stack trace：

```text
❌ Refused to evaluate a string as JavaScript because
   'unsafe-eval' is not an allowed source of script
```

解决：给 Sentry 专用域名加白，或在 Report-Only 中确认 Sentry 的行为后再调整策略。

### 踩坑 4：CSP 与 Service Worker 冲突

Service Worker 的注册需要 `worker-src` 指令：

```php
"worker-src 'self' blob:"
```

如果没设置，Service Worker 注册会静默失败（不是报错，是被 CSP 拦截），导致 PWA 离线缓存完全失效。

### 踩坑 5：Nginx 层与 Laravel 层 CSP 头重复

```nginx
# nginx.conf —— 错误示范：全局加了 CSP 头
add_header Content-Security-Policy "default-src 'self'" always;
```

```php
// Laravel Middleware 也加了 CSP 头
$response->headers->set('Content-Security-Policy', $policy);
```

**结果**：浏览器收到两个 `Content-Security-Policy` 头，策略取**交集**（更严格的生效），导致很多资源被意外拦截。

**解决方案**：Nginx 只负责不随请求变化的安全头（HSTS、X-Frame-Options），CSP 由 Laravel 中间件动态生成：

```nginx
# nginx.conf —— 只放静态安全头
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
# CSP 不在这里加，由 Laravel 中间件处理
```

## 完整 Nginx 安全头配置

```nginx
server {
    listen 443 ssl http2;
    server_name www.kkday.com;

    # SSL 配置（Let's Encrypt）
    ssl_certificate     /etc/letsencrypt/live/www.kkday.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.kkday.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 静态安全头（不随请求变化）
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;

    # CSP 由 Laravel 处理（不在 Nginx 层设置）

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
```

## CSP 调试工具

### 1. Chrome DevTools

```
F12 → Console → 筛选 "CSP" → 看所有 violation 警告
F12 → Application → Security → 查看 CSP 状态
```

### 2. 在线验证器

```bash
# 使用 curl 测试 CSP 头
curl -sI https://www.kkday.com | grep -i content-security-policy

# 使用 securityheaders.com 评分
# https://securityheaders.com/?q=https://www.kkday.com
```

### 3. CSP Evaluator（Google 出品）

```
https://csp-evaluator.withgoogle.com/
```

粘贴你的 CSP 策略，它会指出潜在的安全弱点（如 `'unsafe-inline'`、过于宽松的域名白名单等）。

## 总结

```
┌─────────────────────────────────────────────────────┐
│                CSP 落地检查清单                       │
├─────────────────────────────────────────────────────┤
│ ✅ 1. 先用 Report-Only 观察 1-2 周                   │
│ ✅ 2. Nonce + strict-dynamic（不用域名白名单）        │
│ ✅ 3. 开发/生产环境分离策略                           │
│ ✅ 4. 第三方脚本逐一测试                              │
│ ✅ 5. Nginx 只管静态头，CSP 由 Laravel 动态生成       │
│ ✅ 6. 违规日志接入告警                                │
│ ✅ 7. 定期用 CSP Evaluator 审计策略                   │
│ ✅ 8. 每次上线前回归测试 Report-Only                   │
└─────────────────────────────────────────────────────┘
```

CSP 不是银弹，但它是 XSS 防护的最后一道防线。在 B2C 电商场景中，用户的支付信息、个人数据都在页面上流转，CSP 的价值远超「安全合规检查表上的一个勾」。先用 Report-Only 模式安全上线，再逐步收紧策略，是最务实的落地路径。

## 相关阅读

- [OWASP Top 10 防护实战：SQL 注入/XSS/CSRF/SSRF Laravel B2C API 安全加固踩坑记录](/categories/PHP/owasp-top-10-guide-sql-xss-csrf-ssrf/)
- [API 安全加固实战：JWT 黑名单 + 请求签名 + IP 白名单 + 防重放攻击 Laravel B2C API 踩坑记录](/categories/Architecture/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录/)
- [API Gateway 安全实战：WAF + Bot 管理 + mTLS——纵深防御架构](/categories/运维/API-Gateway-安全实战-WAF-Bot管理-mTLS-纵深防御架构/)
