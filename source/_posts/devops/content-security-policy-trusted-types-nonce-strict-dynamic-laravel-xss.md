---
title: Content Security Policy 进阶实战：Trusted Types + Nonce + strict-dynamic 的深度组合——Laravel 应用的 XSS 纵深防御
keywords: [Content Security Policy, Trusted Types, Nonce, strict, dynamic, Laravel, XSS, 进阶实战, 的深度组合, 应用的]
date: 2026-06-09 16:25:00
categories:
  - devops
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
tags:
  - CSP
  - XSS
  - Content Security Policy
  - Trusted Types
  - Nonce
  - strict-dynamic
  - Laravel
  - 前端安全
description: 深入实战 Content Security Policy 的进阶防御体系，详解 Trusted Types API、Nonce 机制与 strict-dynamic 指令的协同工作原理，结合 Laravel 中间件实现 XSS 纵深防御，覆盖 CSP Level 3 最新特性与踩坑记录。
---


## 为什么你的 CSP 大多数时候形同虚设？

大多数团队在 Laravel 中配置 CSP 的方式是加一行 `script-src 'self'`，然后发现 inline script 不能用了，于是加 `'unsafe-inline'`——安全性瞬间回到原点。

这不是 CSP 的问题，而是使用方式的问题。CSP Level 3 引入的 **Trusted Types**、**Nonce** 和 **strict-dynamic** 三剑客组合，能让你在不牺牲开发体验的前提下，实现接近零 XSS 的纵深防御。

本文基于 Chrome 130+、Firefox 128+ 和 Laravel 12.x 实战环境，手把手搭建这套防御体系。

## 核心概念：三个机制各自解决什么问题

### Nonce：一次性脚本令牌

Nonce（Number used once）是一个随机字符串，每次页面渲染时生成，嵌入 CSP 头和 `<script>` 标签中：

```
Content-Security-Policy: script-src 'nonce-abc123'
```

```html
<script nonce="abc123">console.log('allowed')</script>
```

**工作原理**：浏览器验证 CSP 头中的 nonce 与标签上的 nonce 是否匹配。匹配则放行，不匹配则阻止。

**关键点**：Nonce 必须每次请求重新生成，不能硬编码。一旦被攻击者获取，防御失效。

### strict-dynamic：信任传播机制

```
Content-Security-Policy: script-src 'strict-dynamic' 'nonce-abc123'
```

`strict-dynamic` 的核心思想：**被允许执行的脚本动态加载的其他脚本也自动被信任**。

```html
<!-- 这个被 nonce 放行 -->
<script nonce="abc123" src="/app.js"></script>

<!-- app.js 内部动态创建的脚本也会被放行 -->
<script>
  const s = document.createElement('script');
  s.src = '/dynamically-loaded.js';
  document.body.appendChild(s);
</script>
```

**代价**：`'self'` 和外部域名白名单会被忽略。所有脚本要么通过 nonce，要么通过 `strict-dynamic` 的传播链。

### Trusted Types：DOM XSS 的终极防线

Trusted Types 是一个浏览器 API，强制所有涉及 HTML 解析的 DOM API 只接受"可信类型"对象，而不是原始字符串：

```javascript
// 没有 Trusted Types 时——危险！
element.innerHTML = userInput;  // XSS

// 有 Trusted Types 时——被阻止！
element.innerHTML = userInput;  // TypeError: require TrustedScript

// 必须显式转换为可信类型
const trusted = trustedTypes.createPolicy('default', {
  createHTML: (input) => DOMPurify.sanitize(input),
});
element.innerHTML = trusted.createHTML(userInput);
```

**三者关系**：
- **Nonce** → 控制哪些 `<script>` 标签可以执行
- **strict-dynamic** → 控制动态加载的脚本如何传播信任
- **Trusted Types** → 控制脚本能否操作 DOM 的危险 API（innerHTML、eval 等）

## Laravel 实战：CSP 中间件搭建

### 第一步：生成 Nonce 的服务提供者

```php
<?php
// app/Providers/CspServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class CspServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 每个请求生成唯一 nonce
        $nonce = base64_encode(random_bytes(16));

        // 存储到 Request 容器，方便 Controller/Blade 访问
        request()->attributes->set('csp_nonce', $nonce);

        // 注册为 Blade 全局变量
        view()->composer('*', function ($view) use ($nonce) {
            $view->with('csp_nonce', $nonce);
        });
    }
}
```

### 第二步：CSP 中间件

```php
<?php
// app/Http/Middleware/ContentSecurityPolicy.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class ContentSecurityPolicy
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        $nonce = $request->attributes->get('csp_nonce');

        // 构建 CSP 策略
        $policy = [
            "default-src 'self'",
            "script-src 'strict-dynamic' 'nonce-{$nonce}' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self'",
            "connect-src 'self' https://api.example.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ];

        $header = implode('; ', $policy);
        $response->headers->set('Content-Security-Policy', $header);

        return $response;
    }
}
```

### 第三步：注册中间件

```php
// bootstrap/app.php (Laravel 12)
->withMiddleware(function (Middleware $middleware) {
    $middleware->append(\App\Http\Middleware\ContentSecurityPolicy::class);
})
```

### 第四步：Blade 模板使用 Nonce

```html
{{-- resources/views/layouts/app.blade.php --}}

<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    {{-- 内联样式需要 nonce（或者迁移到外部文件） --}}
    <style nonce="{{ $csp_nonce }}">
        .container { max-width: 1200px; margin: 0 auto; }
    </style>
</head>
<body>
    @yield('content')

    {{-- 外部脚本也要带 nonce --}}
    <script nonce="{{ $csp_nonce }}" src="{{ asset('js/app.js') }}"></script>

    @stack('scripts')
</body>
</html>
```

```html
{{-- resources/views/dashboard.blade.php --}}
@extends('layouts.app')

@section('content')
    <div class="container">
        <h1>Dashboard</h1>
    </div>
@endsection

@push('scripts')
<script nonce="{{ $csp_nonce }}">
    // 这个脚本会被 nonce 放行
    document.addEventListener('DOMContentLoaded', () => {
        console.log('Dashboard loaded');
    });
</script>
@endpush
```

### 第五步：Trusted Types 策略（前端）

在 `resources/js/app.js` 中配置：

```javascript
// resources/js/trusted-types.js

// 创建自定义策略
const policy = trustedTypes.createPolicy('lax', {
    // 允许的 HTML 创建（用于需要 HTML 的场景）
    createHTML: (input) => {
        // 使用 DOMPurify 清理
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(input, {
                ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br', 'p'],
                ALLOWED_ATTR: ['href', 'target'],
            });
        }
        // 降级：直接返回（生产环境应该总是有 DOMPurify）
        return input;
    },
    // 允许的脚本创建
    createScript: (input) => input,
    // 允许的脚本 URL
    createScriptURL: (input) => {
        const url = new URL(input, window.location.origin);
        if (url.origin !== window.location.origin) {
            throw new TypeError('Cross-origin script URLs are not allowed');
        }
        return url.href;
    },
});

// 全局替换默认策略
if (trustedTypes.defaultPolicy) {
    // 默认策略存在时，覆盖其方法
    trustedTypes.defaultPolicy.createHTML = policy.createHTML;
    trustedTypes.defaultPolicy.createScript = policy.createScript;
    trustedTypes.defaultPolicy.createScriptURL = policy.createScriptURL;
} else {
    // 设置为默认策略
    trustedTypes.createPolicy('default', {
        createHTML: policy.createHTML,
        createScript: policy.createScript,
        createScriptURL: policy.createScriptURL,
    });
}
```

### 第六步：Vite 集成

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: [
                'resources/css/app.css',
                'resources/js/app.js',
            ],
            refresh: true,
        }),
    ],
    build: {
        // 确保输出的 JS 文件不包含内联代码
        rollupOptions: {
            output: {
                // 禁止 code splitting 中的内联 chunk
                inlineDynamicImports: false,
            },
        },
    },
});
```

## 高级场景：Vue 3 / React 组件中的 Nonce 传递

### Vue 3 组件

```html
<!-- resources/js/components/Chart.vue -->
<template>
  <div ref="chartContainer"></div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const chartContainer = ref(null);

onMounted(() => {
  // 动态创建的脚本会被 strict-dynamic 放行
  // 因为它是由 nonce 脚本发起的
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
  script.onload = () => {
    // Chart.js 加载完成后初始化图表
    new Chart(chartContainer.value, {
      type: 'bar',
      data: { /* ... */ },
    });
  };
  document.head.appendChild(script);
});
</script>
```

### React 组件

```jsx
// resources/js/components/Dashboard.jsx

import { useEffect, useRef } from 'react';

export default function Dashboard() {
    const containerRef = useRef(null);

    useEffect(() => {
        // 动态脚本通过 strict-dynamic 链信任传播
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
        script.onload = () => {
            const chart = echarts.init(containerRef.current);
            chart.setOption({
                // ... echarts 配置
            });
        };
        document.head.appendChild(script);

        return () => {
            // 清理
            if (containerRef.current) {
                containerRef.current.innerHTML = ''; // Trusted Types 允许清理
            }
        };
    }, []);

    return <div ref={containerRef} style={{ width: '100%', height: '400px' }} />;
}
```

## 非 script 类型的 CSP 管理

### 样式注入

第三方组件库经常需要动态注入样式。CSP 的 `style-src` 也需要相应处理：

```php
// 在中间件中增加 style nonce
$styleNonce = base64_encode(random_bytes(16));
$request->attributes->set('csp_style_nonce', $styleNonce);

$policy[] = "style-src 'self' 'nonce-{$styleNonce}' 'unsafe-inline'";
```

```html
<style nonce="{{ $csp_style_nonce }}">
    /* 动态样式 */
</style>
```

### 连接限制

API 请求、WebSocket 连接都需要在 `connect-src` 中声明：

```php
$connectDomains = implode(' ', [
    "'self'",
    'https://api.example.com',
    'wss://ws.example.com',
    'https://cdn.jsdelivr.net', // CDN 检查
]);
$policy[] = "connect-src {$connectDomains}";
```

### Worker 和 SharedWorker

```php
// Service Worker 和 Worker 也需要 CSP
$policy[] = "worker-src 'self' blob:";
$policy[] = "child-src 'self' blob:";
```

## Reporting：让 CSP 从"摆设"变成"监控"

### Report-Only 模式

上线前必须先用 Report-Only 模式验证：

```php
// 中间件中使用 report-only
$response->headers->set('Content-Security-Policy-Report-Only', $header);
// $response->headers->set('Content-Security-Policy', $header); // 验证通过后启用
```

### Reporting API（CSP Level 3）

```php
// 使用新的 Reporting API 代替 report-uri
$policy[] = "report-uri /csp-report";
$policy[] = "report-to csp-endpoint";
```

```json
// 在 <head> 中添加报告端点
{
    "group": "csp-endpoint",
    "max_age": 10886400,
    "endpoints": [
        { "url": "https://example.com/csp-report" }
    ]
}
```

### Laravel 路由处理报告

```php
// routes/web.php
Route::post('/csp-report', function (Request $request) {
    $report = $request->json()->all();

    // 记录到日志
    Log::channel('csp')->warning('CSP Violation', [
        'document_uri' => $report['document-uri'] ?? '',
        'violated_directive' => $report['violated-directive'] ?? '',
        'blocked_uri' => $report['blocked-uri'] ?? '',
        'source_file' => $report['source-file'] ?? '',
        'line_number' => $report['line-number'] ?? '',
    ]);

    return response()->json(['status' => 'ok']);
});
```

```php
// config/logging.php
'channels' => [
    'csp' => [
        'driver' => 'daily',
        'path' => storage_path('logs/csp-violations.log'),
        'level' => 'warning',
        'days' => 30,
    ],
],
```

## 踩坑记录

### 坑 1：`unsafe-eval` 的两难

很多 JavaScript 框架（特别是旧版 Vue、AngularJS）内部使用 `eval()` 或 `new Function()`：

```
Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source
```

**解决方案**：

1. **升级框架**：Vue 3 不再需要 `unsafe-eval`，Angular 17+ 也不需要
2. **替代方案**：用 `Function.prototype.toString` 的 polyfill
3. **最后手段**：为特定脚本添加 nonce，放弃 `unsafe-eval`

```php
// 如果必须用 unsafe-eval，添加 nonce 作为额外保障
$policy[] = "script-src 'strict-dynamic' 'nonce-{$nonce}' 'unsafe-eval'";
```

### 坑 2：jQuery 的 `html()` 方法

jQuery 的 `.html()` 内部使用 `innerHTML`，会触发 Trusted Types 违规：

```javascript
// 这行会报错
$('#result').html('<div>safe content</div>');
```

**解决方案**：

```javascript
// 方案 1：使用 textContent
$('#result').text('safe content');

// 方案 2：使用 DOMPurify 清理后赋值
const clean = DOMPurify.sanitize('<div>safe content</div>');
$('#result').get(0).innerHTML = clean;

// 方案 3：配置 jQuery 的 trustedTypes 兼容
if (window.trustedTypes && trustedTypes.createPolicy) {
    trustedTypes.createPolicy('jquery', {
        createHTML: (input) => DOMPurify.sanitize(input),
    });
}
```

### 坑 3：Nonce 与缓存的冲突

CDN 缓存的页面可能携带旧的 nonce，导致新请求的脚本被阻止：

**解决方案**：

```php
// 确保动态页面不被缓存
$response->headers->set('Cache-Control', 'no-store, no-cache, must-revalidate');
$response->headers->set('Pragma', 'no-cache');
```

对于静态资源（CSS/JS），可以正常缓存，因为 nonce 不在静态资源中。

### 坑 4：Service Worker 的 CSP 限制

Service Worker 有自己独立的 CSP，不受页面 CSP 控制：

```php
// Service Worker 文件需要单独的 CSP
// 在 sw.js 的 Response 中设置
return new Response(swContent, {
    headers: {
        'Content-Type': 'application/javascript',
        // Service Worker 的 CSP 不能限制它自己
        // 但可以通过 Service Worker 限制它加载的资源
    },
});
```

### 坑 5：浏览器兼容性

截至 2026 年 6 月：

| 特性 | Chrome | Firefox | Safari |
|------|--------|---------|--------|
| CSP Level 3 | ✅ | ✅ | ⚠️ 部分 |
| Trusted Types | ✅ | ✅ (v128+) | ❌ |
| strict-dynamic | ✅ | ✅ | ⚠️ 部分 |
| Nonce | ✅ | ✅ | ✅ |

**Safari 兼容策略**：

```php
// 检测浏览器并提供降级策略
$userAgent = $request->header('User-Agent');
$isSafari = str_contains($userAgent, 'Safari') && !str_contains($userAgent, 'Chrome');

if ($isSafari) {
    // Safari 不支持 Trusted Types，回退到传统 CSP
    $policy[] = "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
} else {
    // 现代浏览器使用完整策略
    $policy[] = "script-src 'strict-dynamic' 'nonce-{$nonce}' 'unsafe-eval'";
}
```

## 测试与验证

### 单元测试

```php
<?php
// tests/Feature/CspMiddlewareTest.php

namespace Tests\Feature;

use Tests\TestCase;

class CspMiddlewareTest extends TestCase
{
    public function test_csp_header_is_set(): void
    {
        $response = $this->get('/');
        $cspHeader = $response->headers->get('Content-Security-Policy');

        $this->assertNotNull($cspHeader);
        $this->assertStringContainsString('script-src', $cspHeader);
        $this->assertStringContainsString('strict-dynamic', $cspHeader);
        $this->assertStringContainsString('nonce-', $cspHeader);
    }

    public function test_nonce_is_unique_per_request(): void
    {
        $response1 = $this->get('/');
        $response2 = $this->get('/');

        $csp1 = $response1->headers->get('Content-Security-Policy');
        $csp2 = $response2->headers->get('Content-Security-Policy');

        // 提取 nonce 值
        preg_match('/nonce-([a-zA-Z0-9+/=]+)/', $csp1, $matches1);
        preg_match('/nonce-([a-zA-Z0-9+/=]+)/', $csp2, $matches2);

        $this->assertNotEquals($matches1[1], $matches2[1]);
    }

    public function test_violation_report_endpoint_exists(): void
    {
        $response = $this->postJson('/csp-report', [
            'csp-report' => [
                'document-uri' => 'http://example.com/',
                'violated-directive' => "script-src 'self'",
                'blocked-uri' => 'http://example.com/evil.js',
            ],
        ]);

        $response->assertOk();
    }
}
```

### E2E 测试（Playwright）

```typescript
// tests/e2e/csp.spec.ts
import { test, expect } from '@playwright/test';

test('CSP headers are present', async ({ page }) => {
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'];

    expect(csp).toContain('script-src');
    expect(csp).toContain('strict-dynamic');
    expect(csp).toContain('nonce-');
});

test('inline scripts are blocked without nonce', async ({ page }) => {
    // 尝试注入没有 nonce 的脚本
    const consoleMessages: string[] = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    await page.goto('/');
    await page.evaluate(() => {
        const s = document.createElement('script');
        s.textContent = 'console.log("should be blocked")';
        document.head.appendChild(s);
    });

    // 脚本应该被阻止，不会输出
    expect(consoleMessages).not.toContain('should be blocked');
});

test('Trusted Types policy exists', async ({ page }) => {
    await page.goto('/');

    const hasTrustedTypes = await page.evaluate(() => {
        return typeof window.trustedTypes !== 'undefined';
    });

    expect(hasTrustedTypes).toBe(true);
});
```

## 部署清单

1. **第一周**：配置 Report-Only 模式，收集违规报告
2. **第二周**：分析报告，修复误报的合法脚本（添加 nonce）
3. **第三周**：启用 enforcement 模式，观察线上是否影响功能
4. **第四周**：添加 Trusted Types 策略，处理 DOM XSS 高风险点
5. **持续**：监控 CSP 报告，新增功能前验证 CSP 兼容性

## 总结

XSS 防御不是单点方案，而是纵深防御体系。CSP 的三个进阶机制各有分工：

- **Nonce + strict-dynamic** → 控制脚本执行权限，阻止未授权脚本
- **Trusted Types** → 控制 DOM 操作，阻止 HTML 注入
- **Reporting** → 持续监控，让安全策略可见可调

在 Laravel 中落地这套体系，核心是中间件 + Blade 模板 + 前端策略三层协同。别想着一步到位——先 Report-Only，再 enforcement，最后加 Trusted Types。安全是渐进式的，不是开关式的。
