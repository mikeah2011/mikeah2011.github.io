---
title: CSP 进阶实战：Trusted Types + Nonce + strict-dynamic 与 Laravel XSS 纵深防御
keywords: [CSP, Trusted Types, Nonce, strict, dynamic, Laravel XSS, 进阶实战, 纵深防御]
date: 2026-06-10 03:06:00
categories:
  - security
cover: https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=630&fit=crop
tags:
  - Laravel
  - CSP
  - XSS
  - Trusted Types
  - Nonce
  - strict-dynamic
  - PHP
description: 从实际 Laravel 项目出发，拆解 Content Security Policy 的进阶组合：nonce + strict-dynamic + Trusted Types，并给出可直接落地的 Middleware、Blade 组件与自动化脚本。
---


在很多 Laravel 项目中，XSS 防护往往被简化为「前端做输入过滤，后端做输出编码」。这个思路没错，但它默认了一个前提：所有前端代码都在你完全控制之下。现实中，第三方脚本、内联事件、历史模板残留都会打破这个假设。

Content Security Policy（CSP）是浏览器侧的最后一道防线。它不是让 XSS 不发生，而是让 XSS 即使发生也难以利用。这篇文章要讨论的是：当你把 CSP 从「能用」推进到「好用」时，nonce、strict-dynamic 和 Trusted Types 这三个机制如何协同工作，以及在 Laravel 项目里怎么落地。

## 为什么默认 CSP 往往失败

大多数团队第一次尝试 CSP 时，会直接用 `unsafe-inline`：

```http
Content-Security-Policy: script-src 'self' 'unsafe-inline'
```

这等于没写。`unsafe-inline` 允许所有内联脚本，而内联脚本正是 XSS 最常见的载体。一旦攻击者能注入一段 `<script>`，CSP 就不会拦截。

问题的根源在于：Laravel Blade 模板、jQuery 插件、内联 `onclick` 到处都是。直接禁用 `unsafe-inline` 会让页面大面积报错。所以需要一个迁移路径：先用 nonce 允许受控的内联脚本，再用 strict-dynamic 逐步淘汰白名单。

## Nonce 机制：为每条请求生成唯一令牌

Nonce（Number used once）的核心思想是：服务器为每个请求生成一个随机字符串，只有携带这个字符串的脚本才被允许执行。

### 在 Laravel 中生成 nonce

最干净的方式是在 Kernel 或 Middleware 里生成，并把 nonce 传递到视图：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class AddCspHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $nonce = base64_encode(random_bytes(16));
        $csp = sprintf(
            "script-src 'nonce-%s' 'strict-dynamic'; object-src 'none'; base-uri 'self';",
            $nonce
        );

        $response = $next($request);
        $response->headers->set('Content-Security-Policy', $csp);
        $response->headers->set('X-Nonce', $nonce);

        view()->share('cspNonce', $nonce);

        return $response;
    }
}
```

关键点：

1. `random_bytes(16)` 生成 16 字节随机数，足够抵抗猜测。
2. `base64_encode` 将其转为 CSP 兼容的 base64 字符串。
3. `view()->share` 让所有 Blade 模板都能访问 `$cspNonce`。
4. nonce 通过响应头 `X-Nonce` 传递给前端 JS 代码（如果前端需要动态创建脚本）。

### Blade 模板中使用 nonce

```html
<script nonce="{{ $cspNonce }}">
  document.addEventListener('DOMContentLoaded', function() {
    console.log('CSP nonce 工作正常');
  });
</script>
```

每个请求的 nonce 都不同，攻击者无法提前知道下一次的 nonce 值，因此即使注入了 `<script>` 标签也无法执行。

## strict-dynamic：从白名单到信任链

Nonce 解决了内联脚本的问题，但它不能覆盖动态加载的脚本。比如：

```javascript
const script = document.createElement('script');
script.src = 'https://cdn.example.com/lib.js';
document.body.appendChild(script);
```

如果 CSP 只写了 `'nonce-xxx'`，这个动态加载的脚本会被拦截。解决方案是 `strict-dynamic`：

```
script-src 'nonce-xxx' 'strict-dynamic';
```

`strict-dynamic` 的语义是：任何被受信脚本（有 nonce 的脚本）动态创建的脚本都会被信任。这形成了一个信任链：

```
nonce 脚本（受信）→ 动态创建的脚本（受信）→ 继续创建的脚本（受信）
```

### strict-dynamic 的实际影响

启用 `strict-dynamic` 后，你会发现：

- **白名单失效**：`https://cdn.example.com` 这类白名单不再生效。这是设计如此——白名单域名下的脚本如果被注入恶意内容，同样危险。信任应该从你自己的代码开始。
- **第三方脚本需要特殊处理**：如果确实需要加载可信的第三方脚本，用 `require-trusted-types-for` 配合 `TrustedScriptURL`。

### 向后兼容：过渡期配置

在迁移过程中，你可以同时保留白名单和 strict-dynamic：

```
script-src 'nonce-xxx' 'strict-dynamic' https://trusted.cdn.com;
```

浏览器会优先使用 strict-dynamic 逻辑，但对不支持 strict-dynamic 的老浏览器，白名单仍然生效。这是一个务实的过渡策略。

## Trusted Types：从源头消灭 DOM XSS

CSP + nonce + strict-dynamic 主要防护的是脚本注入。但 DOM XSS 的另一个攻击面是危险的 HTML sink，比如 `innerHTML`、`document.write`、`eval`。

Trusted Types 是浏览器原生 API，它强制所有危险操作只能接收经过「安全策略」处理的值。

### 三种策略类型

```javascript
// 1. html：用于 innerHTML、外 DOM 操作
trustedTypes.createPolicy('default', {
  createHTML: (input) => DOMPurify.sanitize(input, { RETURN_TRUSTED_TYPE: true }),
});

// 2. script：用于 eval、new Function
trustedTypes.createPolicy('default', {
  createScript: (input) => {
    // 可以做静态分析，拒绝危险模式
    if (input.includes('document.cookie')) {
      throw new Error('Blocked: cookie access in dynamic script');
    }
    return input;
  },
});

// 3. scriptURL：用于 src、href（动态设置）
trustedTypes.createPolicy('default', {
  createScriptURL: (input) => {
    const url = new URL(input, document.baseURI);
    if (url.origin !== location.origin) {
      throw new Error('Blocked: cross-origin script URL');
    }
    return url.href;
  },
});
```

### CSP 中启用 Trusted Types

```
require-trusted-types-for 'script'; trusted-types default dompurify;
```

这段 CSP 的含义：

- `require-trusted-types-for 'script'`：所有脚本相关的危险操作必须使用 Trusted Types。
- `trusted-types default dompurify`：允许名为 `default` 和 `dompurify` 的策略。

### 与 Laravel 的集成

在 Blade 模板中，可以用一个全局的 Trusted Types 初始化脚本：

```html
<script nonce="{{ $cspNonce }}">
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    window.trustedTypes.createPolicy('default', {
      createHTML: (input) => {
        // 简单的 HTML 转义，生产环境建议用 DOMPurify
        const div = document.createElement('div');
        div.textContent = input;
        return div.innerHTML;
      },
      createScriptURL: (input) => {
        const url = new URL(input, document.baseURI);
        return url.href;
      },
    });
  }
</script>
```

## 完整 CSP 头配置

把上面的机制组合起来，最终的 CSP 头应该是：

```
script-src 'nonce-{随机值}' 'strict-dynamic'; 
object-src 'none'; 
base-uri 'self'; 
require-trusted-types-for 'script'; 
trusted-types default;
```

### 逐字段解释

| 指令 | 值 | 作用 |
|------|------|------|
| `script-src` | `'nonce-xxx' 'strict-dynamic'` | 只允许 nonce 脚本及其动态子脚本 |
| `object-src` | `'none'` | 禁止 Flash、Java 等插件 |
| `base-uri` | `'self'` | 限制 `<base>` 标签的目标 |
| `require-trusted-types-for` | `'script'` | 强制 Trusted Types |
| `trusted-types` | `default` | 允许的策略名 |

### 报告模式：先观察再强制

迁移期间，建议先用 `Content-Security-Policy-Report-Only`：

```php
$response->headers->set('Content-Security-Policy-Report-Only', $csp);
```

在前端配置报告端点：

```javascript
if (navigator.sendBeacon) {
  navigator.sendBeacon('/csp-report', JSON.stringify({
    'csp-report': {
      'document-uri': document.location.href,
      'violated-directive': event.violatedDirective,
      'blocked-uri': event.blockedURI,
    }
  }));
}
```

或者在 CSP 头中直接配置：

```
report-uri /csp-report; report-to csp-endpoint;
```

## Laravel Blade 组件封装

为了在项目中统一使用，可以封装一个 Blade 组件：

### 安全脚本组件

```html
<!-- resources/views/components/secure-script.blade.php -->
@props(['src' => null, 'inline' => false])

@if($src)
  <script nonce="{{ $cspNonce }}" src="{{ $src }}"></script>
@elseif($inline)
  <script nonce="{{ $cspNonce }}">
    {!! $slot !!}
  </script>
@endif
```

使用方式：

```html
{{-- 外部脚本 --}}
<x-secure-script src="/js/app.js" />

{{-- 内联脚本 --}}
<x-secure-script :inline="true">
  console.log('安全的内联脚本');
</x-secure-script>
```

### 安全样式组件

CSP 的 `style-src` 也需要 nonce，但样式注入的风险通常低于脚本。可以单独处理：

```html
<!-- resources/views/components/secure-style.blade.php -->
<style nonce="{{ $cspNonce }}">
  {!! $slot !!}
</style>
```

## 踩坑记录

### 1. jQuery 和第三方库的内联样式问题

很多 jQuery 插件会动态添加 `<style>` 标签或内联 `style` 属性。如果 CSP 的 `style-src` 也禁用了 `unsafe-inline`，这些插件会静默失败。

解决方案：`style-src` 使用 nonce，或者在迁移期暂时保留 `'unsafe-inline'`（样式注入的危害远低于脚本）。

### 2. Livewire 和 Alpine.js 的内联脚本

Laravel Livewire 和 Alpine.js 都会在 DOM 中插入内联脚本。需要确保它们的脚本被 nonce 覆盖：

```php
// Livewire
Livewire::script('
  document.addEventListener("livewire:load", function() {
    console.log("Livewire loaded");
  });
');
```

这行代码会被 Livewire 渲染为内联 `<script>`，需要 nonce 才能执行。

### 3. Service Worker 和 CSP

Service Worker 的脚本不受 CSP 控制。如果需要限制 SW 的作用域，用 `Service-Worker-Allowed` 响应头。

### 4. nonce 与 HTTP 缓存

如果页面使用了 HTTP 缓存（如 CDN），nonce 会失效，因为缓存的响应携带的是旧 nonce。解决方案：

- 对关键页面禁用缓存：`Cache-Control: no-store`
- 使用 `Vary: Cookie` 让不同用户的响应独立缓存
- 或者使用 hash-based CSP（牺牲一定的维护便利性）

### 5. Trusted Types 在 Safari 中的兼容性

截至 2026 年，Safari 对 Trusted Types 的支持仍然不完整。建议：

- 使用 feature detection：`if (window.trustedTypes)`
- 在不支持的浏览器中，依赖 CSP 的 nonce + strict-dynamic 作为 fallback
- 不要因为 Safari 不支持就放弃 Trusted Types——它在 Chrome/Edge/Firefox 中已经可用

## 实战：从零搭建 Laravel CSP 中间件

把上面的所有内容整合到一个可复用的中间件中：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class CspMiddleware
{
    private const SCRIPT_SRC = "'nonce-%s' 'strict-dynamic'";
    private const OBJECT_SRC = "'none'";
    private const BASE_URI = "'self'";
    private const REQUIRE_TRUSTED = "require-trusted-types-for 'script'";
    private const TRUSTED_TYPES = "trusted-types default";

    public function handle(Request $request, Closure $next): Response
    {
        $nonce = base64_encode(random_bytes(16));

        $directives = [
            "script-src " . sprintf(self::SCRIPT_SRC, $nonce),
            "object-src " . self::OBJECT_SRC,
            "base-uri " . self::BASE_URI,
            self::REQUIRE_TRUSTED,
            self::TRUSTED_TYPES,
        ];

        // 报告模式：生产环境先观察
        if (config('app.csp_report_only', false)) {
            $header = 'Content-Security-Policy-Report-Only';
            $directives[] = "report-uri /csp-report";
        } else {
            $header = 'Content-Security-Policy';
        }

        $csp = implode('; ', $directives) . ';';

        $response = $next($request);
        $response->headers->set($header, $csp);
        $response->headers->set('X-CSP-Nonce', $nonce);

        view()->share('cspNonce', $nonce);

        return $response;
    }
}
```

在 `Kernel.php` 中注册：

```php
protected $middleware = [
    // ... 其他中间件
    \App\Http\Middleware\CspMiddleware::class,
];
```

在 `config/app.php` 中添加配置：

```php
'csp_report_only' => env('CSP_REPORT_ONLY', true),
```

`.env` 中：

```env
CSP_REPORT_ONLY=true
```

## 总结

CSP 不是银弹，但它是浏览器侧最可靠的 XSS 防线。核心策略是：

1. **Nonce**：为每个请求生成唯一令牌，只允许受控的内联脚本执行。
2. **strict-dynamic**：从 nonce 脚本出发，建立信任链，逐步淘汰白名单。
3. **Trusted Types**：从源头阻止危险的 DOM 操作，补齐 CSP 无法覆盖的 XSS 攻击面。

迁移路径应该是：`Report-Only 观察` → `强制执行但保留白名单` → `白名单 + strict-dynamic` → `纯 nonce + strict-dynamic + Trusted Types`。

不要试图一步到位。先让 CSP 跑起来，收集报告，逐步收紧。安全是一个过程，不是一个配置项。

---

*本文所有代码示例基于 Laravel 11.x，PHP 8.2+。生产环境使用前请根据实际项目情况调整。*
