---

title: Laravel PWA 改造实战：Service Worker 离线缓存、后台同步、推送通知——从传统 Web 应用到渐进式 Web 应用的完整迁移路径
keywords: [Laravel PWA, Service Worker, Web, 改造实战, 离线缓存, 后台同步, 推送通知, 从传统, 应用到渐进式, 应用的完整迁移路径]
date: 2026-06-07 10:00:00
description: 深入实战讲解如何将 Laravel Web 应用改造为渐进式 Web 应用（PWA）。从 Web App Manifest 配置、Service Worker 注册与生命周期管理，到 Cache First、Network First、Stale While Revalidate 三级离线缓存策略详解，再到 Background Sync API 后台同步与 Web Push 推送通知的 Laravel 后端实现，涵盖 Workbox 集成、Nginx HTTPS 配置、Lighthouse 评分优化及生产环境部署踩坑指南，助你一站式掌握 PWA 迁移全流程。
tags:
- Laravel
- PWA
- service-worker
- JavaScript
- 性能优化
- web-push
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---



在移动互联网时代，用户对于 Web 应用的期望已经不再局限于"能用"，而是追求"好用"甚至"像原生 App 一样好用"。渐进式 Web 应用（Progressive Web App，简称 PWA）正是在这样的背景下应运而生的一项技术方案。它将 Web 的开放性与原生 App 的体验完美结合，让传统的 Web 应用具备离线访问、推送通知、主屏安装等能力。

对于已经使用 Laravel 构建的 Web 应用来说，将其改造为 PWA 并非遥不可及的任务。Laravel 作为 PHP 生态中最流行的全栈框架，其强大的后端能力与 PWA 的前端增强特性相结合，可以打造出兼具开发效率和用户体验的现代 Web 应用。本文将从零开始，系统性地介绍如何将一个传统的 Laravel Web 应用完整地迁移到 PWA 架构，涵盖 Service Worker 注册、离线缓存策略、后台同步、Web Push 推送通知、性能优化以及生产环境部署等各个方面，为开发者提供一条清晰可执行的迁移路径。

无论你的 Laravel 应用是一个内容管理系统、电商平台、企业内部工具还是社交网络，PWA 改造都能为其带来显著的体验提升。根据 Google 的统计数据，PWA 的平均加载速度比传统 Web 应用快 2-3 倍，用户参与度提升 2 倍以上，跳出率降低 20%-30%。这些数据足以证明 PWA 改造的投入产出比是非常可观的。

<!-- more -->

## 一、PWA 核心概念与优势

### 1.1 什么是 PWA

PWA 并不是某一项单一的技术，而是一系列 Web 技术的集合。Google 工程师 Alex Russell 在 2015 年首次提出了这个概念，其核心思想是：利用现代浏览器提供的 API，让 Web 应用具备类似原生 App 的体验。

一个合格的 PWA 需要满足以下三个核心条件：

- **可发现性（Discoverable）**：通过 Web App Manifest 让浏览器识别这是一个可安装的应用。
- **可安装性（Installable）**：用户可以将应用"添加到主屏幕"，获得独立的窗口和启动图标。
- **可离线工作（Offline Capable）**：通过 Service Worker 实现离线缓存，即使在没有网络的情况下也能正常访问。

### 1.2 PWA 的核心优势

相比传统的 Web 应用，PWA 具备以下显著优势：

**离线访问能力**：通过 Service Worker 对关键资源进行缓存，用户在弱网或无网络环境下依然可以访问已经缓存的页面和数据。这对于网络环境不稳定的地区尤为重要。

**推送通知**：借助 Web Push API 和 Notification API，PWA 可以像原生 App 一样向用户推送消息，这是提高用户留存率的关键能力之一。

**主屏安装**：用户可以将 PWA 添加到设备主屏幕上，获得独立的启动图标和全屏体验，消除了与原生 App 之间的视觉差距。

**性能提升**：Service Worker 可以拦截网络请求并直接从缓存中返回资源，显著减少页面加载时间。结合合理的缓存策略，首屏渲染时间可以大幅缩短。

**无需应用商店分发**：PWA 通过 URL 直接分发，无需经过 App Store 或 Google Play 的审核流程，更新也无需用户手动操作。

**开发维护成本低**：一套代码同时服务 Web 和"App"场景，相比维护原生 App 和 Web 两套系统，开发和维护成本显著降低。

### 1.3 技术架构概览

PWA 的技术架构由三个核心组件构成：

1. **Web App Manifest**：一个 JSON 文件，描述应用的名称、图标、主题色、启动 URL 等元信息。浏览器通过解析 Manifest 来决定如何展示安装对话框和主屏图标。
2. **Service Worker**：一个运行在浏览器后台的 JavaScript 线程，独立于页面主线程，负责拦截网络请求、管理缓存、处理推送通知和后台同步等。它通过事件驱动的方式工作，不会消耗不必要的系统资源。
3. **HTTPS**：PWA 的所有功能都要求在安全上下文（HTTPS）下运行，这是硬性要求。这是因为 Service Worker 能够拦截和修改网络请求，如果在不安全的连接上运行，存在被中间人攻击的风险。在 localhost 上进行开发时，浏览器会放宽这个限制，允许在 HTTP 下使用 Service Worker。

这三者之间的关系可以这样理解：Manifest 定义了应用的"外观"，Service Worker 提供了应用的"能力"，而 HTTPS 则是保障这一切安全运行的"基石"。三者缺一不可，共同构成了 PWA 的技术基础。

## 二、Laravel 应用的 PWA 改造步骤

### 2.1 项目准备工作

在正式开始改造之前，我们需要明确几个关键的前置条件。首先，确保你的 Laravel 应用运行在 HTTPS 环境下，这是 PWA 所有功能的硬性要求。在本地开发阶段可以使用 Laravel Valet 的 `valet secure` 命令或 `mkcert` 工具来创建自签名证书。其次，确保你使用的是 Laravel 10 或更高版本，以获得最新的前端工具链支持（Vite、Laravel Mix 等）。最后，建议先在浏览器中打开 DevTools 的 Application 面板，确认当前浏览器对 Service Worker 的支持情况。主流浏览器（Chrome、Firefox、Safari、Edge）在 2024 年以后都已全面支持 Service Worker 的核心功能。

假设我们已经有一个运行良好的 Laravel 应用，现在要将它改造为 PWA。首先，我们需要在项目中创建相关的文件和目录结构。

在 Laravel 项目中，PWA 相关的静态资源通常放在 `public` 目录下：

```
public/
├── manifest.json          # Web App Manifest
├── sw.js                  # Service Worker 文件
├── images/
│   ├── icons/
│   │   ├── icon-192x192.png
│   │   ├── icon-512x512.png
│   │   └── icon-maskable-512x512.png
│   └── splash/
└── ...
```

### 2.2 创建 Web App Manifest

Web App Manifest 是一个遵循 W3C 规范的 JSON 文件，它告诉浏览器这个 Web 应用的名称、图标、显示方式等元信息。浏览器通过解析这个文件来决定如何将应用"安装"到用户的设备上。需要注意的是，manifest 文件必须与当前页面同源，并且需要通过 HTTPS 提供服务。

`manifest.json` 是 PWA 的"身份证"，浏览器通过它来了解应用的基本信息。在 `public` 目录下创建 `manifest.json`：

```json
{
  "short_name": "LaravelApp",
  "name": "我的 Laravel 应用 - 功能强大的在线管理平台",
  "description": "一个基于 Laravel 构建的渐进式 Web 应用",
  "start_url": "/",
  "id": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#4a5568",
  "orientation": "portrait-primary",
  "scope": "/",
  "lang": "zh-CN",
  "icons": [
    {
      "src": "/images/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png"
    },
    {
      "src": "/images/icons/icon-96x96.png",
      "sizes": "96x96",
      "type": "image/png"
    },
    {
      "src": "/images/icons/icon-128x128.png",
      "sizes": "128x128",
      "type": "image/png"
    },
    {
      "src": "/images/icons/icon-144x144.png",
      "sizes": "144x144",
      "type": "image/png"
    },
    {
      "src": "/images/icons/icon-152x152.png",
      "sizes": "152x152",
      "type": "image/png"
    },
    {
      "src": "/images/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/images/icons/icon-384x384.png",
      "sizes": "384x384",
      "type": "image/png"
    },
    {
      "src": "/images/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/images/icons/icon-maskable-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "screenshots": [
    {
      "src": "/images/screenshot-wide.png",
      "sizes": "1280x720",
      "type": "image/png",
      "form_factor": "wide",
      "label": "桌面端截图"
    },
    {
      "src": "/images/screenshot-narrow.png",
      "sizes": "750x1334",
      "type": "image/png",
      "form_factor": "narrow",
      "label": "移动端截图"
    }
  ],
  "shortcuts": [
    {
      "name": "仪表盘",
      "short_name": "仪表盘",
      "description": "查看数据仪表盘",
      "url": "/dashboard",
      "icons": [{ "src": "/images/icons/dashboard.png", "sizes": "96x96" }]
    },
    {
      "name": "个人设置",
      "short_name": "设置",
      "description": "管理个人设置",
      "url": "/settings",
      "icons": [{ "src": "/images/icons/settings.png", "sizes": "96x96" }]
    }
  ]
}
```

几个关键字段需要特别注意：

- `display: "standalone"` 表示应用将以独立窗口的形式运行，隐藏浏览器的地址栏。
- `start_url` 指定用户从主屏幕启动时加载的页面。
- `purpose: "maskable"` 的图标用于自适应图标模式，确保图标在不同形状的遮罩下都能正常显示。
- `shortcuts` 定义了长按应用图标时显示的快捷操作菜单。

在图标资源方面，建议至少提供 192x192 和 512x512 两种尺寸的图标，这是 Lighthouse 审计的基本要求。`maskable` 图标需要额外注意安全区域的设计——在圆形、圆角矩形等不同遮罩形状下，图标的关键视觉元素应保持在中心 80% 的区域内。可以使用 Google 提供的 [Maskable.app](https://maskable.app/) 工具来预览遮罩效果。

另外，`id` 字段是 2024 年新增的推荐字段，用于唯一标识应用。它的值通常与 `start_url` 相同，但也可以是任意唯一的字符串。设置 `id` 后，即使 `start_url` 发生变化，浏览器仍然能正确识别已安装的 PWA。

在 `screenshots` 字段中，你可以提供应用的截图，这些截图会在安装对话框中展示给用户。`form_factor` 为 `"wide"` 表示桌面端截图，`"narrow"` 表示移动端截图。提供高质量的截图可以显著提升用户的安装意愿。

### 2.3 在 Laravel 布局中注册 Manifest

在 Laravel 的 Blade 布局文件（通常是 `resources/views/layouts/app.blade.php`）的 `<head>` 部分引入 manifest：

```html
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#4a5568">
    <meta name="description" content="一个基于 Laravel 构建的渐进式 Web 应用">

    <!-- PWA Manifest -->
    <link rel="manifest" href="/manifest.json">

    <!-- iOS 兼容 -->
    <link rel="apple-touch-icon" href="/images/icons/icon-192x192.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="LaravelApp">

    <title>@yield('title', '我的 Laravel 应用')</title>

    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
    @yield('content')

    <!-- Service Worker 注册脚本 -->
    <script>
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(registration => {
                        console.log('Service Worker 注册成功，作用域:', registration.scope);
                    })
                    .catch(error => {
                        console.error('Service Worker 注册失败:', error);
                    });
            });
        }
    </script>
</body>
</html>
```

iOS Safari 对 PWA 的支持虽然不如 Chrome 完善，但 `apple-mobile-web-app-capable` 等 meta 标签可以提供基本的"添加到主屏幕"体验。需要注意的是，截至 2026 年，iOS 上的 Service Worker 支持已经相当成熟，但仍然建议加上这些兼容性标签。

### 2.4 Service Worker 生命周期详解

在编写 Service Worker 代码之前，理解它的生命周期至关重要。Service Worker 的生命周期由三个阶段组成：安装（Install）、激活（Activate）和运行（Fetch）。每个阶段对应一个事件，开发者需要在这些事件中执行相应的逻辑。需要注意的是，Service Worker 的更新不是即时的，浏览器会在后台下载新的 Service Worker 文件，但不会立即替换旧版本。新版本会进入"等待"状态，直到所有使用旧版本的页面都被关闭后才会激活。这种机制确保了页面不会在运行过程中突然切换到新的 Service Worker，避免了潜在的不一致性问题。

**安装阶段**：当浏览器首次检测到新的 Service Worker 文件时，会触发 `install` 事件。在这个阶段，我们通常预缓存应用的关键静态资源。调用 `self.skipWaiting()` 可以让新的 Service Worker 跳过等待阶段，立即激活。

**激活阶段**：当旧的 Service Worker 完全卸载后，新的 Service Worker 进入激活阶段，触发 `activate` 事件。在这个阶段，我们通常清理旧版本的缓存数据。调用 `self.clients.claim()` 可以让新的 Service Worker 立即接管所有已打开的页面。

**运行阶段**：当 Service Worker 处于激活状态后，它会监听各种事件，如 `fetch`（网络请求）、`push`（推送消息）、`sync`（后台同步）等。这是 Service Worker 的主要工作阶段。

理解了生命周期之后，让我们创建一个完整的 Service Worker 文件。在 `public/sw.js` 中编写如下代码：

在 `public/sw.js` 中创建一个最基础的 Service Worker：

```javascript
// public/sw.js

const CACHE_NAME = 'laravel-pwa-v1';
const STATIC_ASSETS = [
    '/',
    '/css/app.css',
    '/js/app.js',
    '/manifest.json',
    '/images/icons/icon-192x192.png',
    '/images/icons/icon-512x512.png',
    '/offline.html'
];

// 安装事件：预缓存静态资源
self.addEventListener('install', (event) => {
    console.log('[Service Worker] 安装中...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] 预缓存静态资源');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// 激活事件：清理旧缓存
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] 激活中...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] 删除旧缓存:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 获取事件：拦截网络请求
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});
```

这段代码实现了最基本的缓存优先策略：首先检查缓存中是否有匹配的资源，如果有则直接返回缓存，否则发起网络请求。

## 三、Service Worker 离线缓存策略

缓存策略是 PWA 的灵魂所在。不同的资源类型和使用场景需要不同的缓存策略。下面详细介绍三种最常用的缓存策略及其在 Laravel PWA 中的应用。

### 3.1 Cache First（缓存优先）

Cache First 策略是最简单也是最常用的缓存策略之一，适合用于不会频繁变化的静态资源，如 CSS、JavaScript、图片、字体等。它的核心思想非常直观：优先使用已有的缓存数据，只有在缓存不存在的情况下才去请求网络。这种策略可以最大程度地减少网络请求，提高页面加载速度。

工作原理：当收到网络请求时，Service Worker 首先在缓存中查找匹配的资源。如果找到，直接返回缓存；如果没有找到，才发起网络请求，获取资源后存入缓存并返回。

```javascript
// Cache First 策略实现
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        // 如果是导航请求，返回离线页面
        if (request.mode === 'navigate') {
            return caches.match('/offline.html');
        }
        throw error;
    }
}
```

**适用场景**：应用图标、字体文件、第三方 CDN 资源（如 Bootstrap、Tailwind CSS）、编译后的 CSS 和 JS 文件。

**注意事项**：使用 Cache First 策略时，需要注意缓存更新的问题。当资源更新后，如果缓存未过期，用户将看到旧版本的内容。可以通过在文件名中加入哈希值（Laravel Mix 或 Vite 默认支持）来解决这个问题。例如，Vite 在构建时会自动将 `app.js` 重命名为 `app-3a7b8c9d.js` 这样的形式，每次文件内容变化都会生成新的文件名，从而自然地实现缓存失效。

在实际部署中，还可以结合 `Cache-Control` 头部来进一步控制缓存行为。对于带哈希的静态资源，建议使用 `Cache-Control: public, max-age=31536000, immutable`；而对于 HTML 文件本身，建议使用 `Cache-Control: no-cache`，确保每次都向服务器验证是否有更新。

### 3.2 Network First（网络优先）

Network First 策略适合用于需要实时性的内容，如 API 响应、用户个人数据页面、实时消息等。与 Cache First 相反，Network First 策略优先使用网络数据，只有在无法连接网络时才会回退到缓存。这种策略确保了用户在有网络的情况下始终能获得最新的数据。

工作原理：Service Worker 首先尝试发起网络请求。如果网络请求成功，将响应存入缓存并返回；如果网络请求失败（如断网），则回退到缓存中的内容。

```javascript
// Network First 策略实现
async function networkFirst(request, cacheName = DYNAMIC_CACHE, timeout = 3000) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const networkResponse = await fetch(request, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (networkResponse.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        // 返回自定义的离线响应
        return new Response(
            JSON.stringify({
                error: '离线模式',
                message: '当前处于离线状态，请检查网络连接'
            }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 503
            }
        );
    }
}
```

**适用场景**：Laravel API 响应（如 `/api/posts`、`/api/users`）、需要实时数据的页面、搜索结果页面。

**注意事项**：需要设置合理的超时时间。如果超时设置过短，在弱网环境下可能频繁回退到缓存；设置过长，则用户等待时间增加。建议设置 3-5 秒的超时。此外，对于涉及用户认证的 API 请求，要注意缓存中可能包含过期的用户数据，在用户登出时应该清除相关缓存。

一个常见的实践是对 API 响应添加一个时间戳标记，当检测到缓存数据过于陈旧（例如超过 24 小时）时，即使使用缓存中的数据，也可以在界面上显示"数据可能不是最新的"提示，引导用户在有网络时刷新。

### 3.3 Stale While Revalidate（陈旧同时更新）

Stale While Revalidate 策略是一种巧妙的折中方案，适合用于对实时性要求不高但需要快速响应的场景。这种策略的名字直译为"陈旧的同时重新验证"，形象地描述了它的工作方式：先返回缓存中的旧数据（可能不是最新的），同时在后台悄悄发起网络请求来更新缓存。对于用户来说，他们看到的是几乎即时的页面响应，完全感受不到网络延迟的存在。

工作原理：Service Worker 首先从缓存中返回资源（快速响应），同时在后台发起网络请求更新缓存中的资源。下一次请求时，用户就能获得最新版本的内容。

```javascript
// Stale While Revalidate 策略实现
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    }).catch(() => {
        // 网络失败时如果也没有缓存，返回离线页面
        if (!cachedResponse && request.mode === 'navigate') {
            return caches.match('/offline.html');
        }
    });

    return cachedResponse || fetchPromise;
}
```

**适用场景**：博客文章列表页、产品目录页、新闻资讯页等 Laravel Blade 渲染的页面。

Stale While Revalidate 策略的核心优势在于用户体验的流畅性。用户几乎总能立即获得页面响应，不必等待网络请求完成。代价是用户看到的可能是略微过时的内容，但对于大多数内容展示型页面来说，这个代价完全可以接受。在实际应用中，你可以根据页面更新频率来调整后台更新的频率——更新频繁的页面可以搭配定时更新机制，而不常变化的页面则可以延长缓存有效期。

需要注意的是，当用户的设备长时间离线后重新连接时，Stale While Revalidate 策略可能会在短时间内展示非常陈旧的内容。建议在这种情况下配合 UI 层面的提示，告知用户内容正在更新中。可以通过检测页面加载时间和上次网络请求时间的差距来判断是否需要显示更新提示。

### 3.4 综合策略路由

在实际项目中，我们需要根据不同类型的请求应用不同的缓存策略。以下是一个完整的策略路由实现：

```javascript
// public/sw.js - 完整的缓存策略路由（续上文基础 Service Worker）

const CACHE_NAME = 'laravel-pwa-v1';
const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';
const API_CACHE = 'api-v1';

// 上文已定义的 STATIC_ASSETS 和 install/activate 事件处理器...

// 策略配置：可以通过 JSON 文件管理，方便运维人员调整
const STRATEGY_CONFIG = {
    staticAssetPattern: /\.(css|js|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico)(\?.*)?$/,
    buildPathPattern: /^\/build\//,
    apiPathPattern: /^\/api\//,
    networkTimeout: 3000,    // Network First 超时时间（毫秒）
    maxDynamicCacheEntries: 100,
    maxApiCacheEntries: 50
};

// 判断请求类型并应用对应策略
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 静态资源：Cache First
    if (isStaticAsset(url)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // API 请求：Network First
    if (isApiRequest(url)) {
        event.respondWith(networkFirst(request, API_CACHE));
        return;
    }

    // 页面请求：Stale While Revalidate
    if (request.mode === 'navigate') {
        event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
        return;
    }

    // 其他请求：直接网络请求
    event.respondWith(fetch(request).catch(() => caches.match(request)));
});

function isStaticAsset(url) {
    return url.pathname.match(
        /\.(css|js|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico)(\?.*)?$/
    ) || url.pathname.startsWith('/build/');
}

function isApiRequest(url) {
    return url.pathname.startsWith('/api/');
}
```

## 四、后台同步（Background Sync API）

### 4.1 为什么需要后台同步

在实际使用场景中，用户经常会在网络不稳定的环境下操作应用。比如用户在地铁上填写了一个订单表单并提交，但此时网络信号不好，请求发送失败。传统做法是提示用户"网络错误，请重试"，用户可能因为不方便操作而直接放弃了这笔订单。而 PWA 的后台同步功能可以在网络恢复后自动重新发送请求，无需用户手动操作，大大降低了因网络问题导致的用户流失。

后台同步的核心理念是"离线优先"（Offline First）的设计思想：应用应该首先将用户操作保存到本地，然后在合适的时机（通常是网络恢复时）再将数据同步到服务器。这种设计不仅提升了用户体验，也使得应用在网络质量差的环境下依然可用。

Background Sync API 的核心流程如下：

1. 用户在离线状态下执行操作（如提交表单）
2. Service Worker 拦截请求，将请求数据存入 IndexedDB
3. 注册一个 sync 事件
4. 当网络恢复时，浏览器自动触发 sync 事件
5. Service Worker 从 IndexedDB 中取出数据，重新发送请求

### 4.2 Laravel 后端：创建离线队列表

首先在 Laravel 中创建一个数据库表来存储离线操作：

```bash
php artisan make:migration create_offline_syncs_table
```

```php
<?php
// database/migrations/xxxx_create_offline_syncs_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('offline_syncs', function (Blueprint $table) {
            $table->id();
            $table->uuid('client_id')->index();
            $table->string('endpoint');        // 请求的 URL 路径
            $table->string('method', 10);      // HTTP 方法
            $table->json('payload');            // 请求数据
            $table->json('headers')->nullable(); // 请求头
            $table->enum('status', ['pending', 'processing', 'completed', 'failed'])
                  ->default('pending');
            $table->timestamp('processed_at')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('offline_syncs');
    }
};
```

### 4.3 Laravel 后端：创建同步 API

```php
<?php
// app/Http/Controllers/Api/SyncController.php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SyncController extends Controller
{
    /**
     * 接收离线同步数据
     */
    public function store(Request $request)
    {
        $request->validate([
            'endpoint' => 'required|string',
            'method'   => 'required|string|in:GET,POST,PUT,PATCH,DELETE',
            'payload'  => 'required|array',
            'headers'  => 'nullable|array',
        ]);

        $sync = DB::table('offline_syncs')->insertGetId([
            'client_id'  => $request->header('X-Sync-Client-ID', Str::uuid()->toString()),
            'endpoint'   => $request->input('endpoint'),
            'method'     => $request->input('method'),
            'payload'    => json_encode($request->input('payload')),
            'headers'    => json_encode($request->input('headers', [])),
            'status'     => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 创建任务来处理同步
        \App\Jobs\ProcessOfflineSync::dispatch($sync);

        return response()->json([
            'success' => true,
            'sync_id' => $sync,
            'message' => '离线数据已接收，将尽快处理'
        ], 201);
    }

    /**
     * 查询同步状态
     */
    public function status(Request $request, $id)
    {
        $sync = DB::table('offline_syncs')->where('id', $id)->first();

        if (!$sync) {
            return response()->json(['error' => '同步记录不存在'], 404);
        }

        return response()->json([
            'id'      => $sync->id,
            'status'  => $sync->status,
            'error'   => $sync->error_message,
            'processed_at' => $sync->processed_at,
        ]);
    }
}
```

```php
<?php
// app/Jobs/ProcessOfflineSync.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ProcessOfflineSync implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $syncId;

    public function __construct(int $syncId)
    {
        $this->syncId = $syncId;
    }

    public function handle(): void
    {
        $sync = DB::table('offline_syncs')->where('id', $this->syncId)->first();

        if (!$sync || $sync->status !== 'pending') {
            return;
        }

        DB::table('offline_syncs')
            ->where('id', $this->syncId)
            ->update(['status' => 'processing']);

        try {
            $payload = json_decode($sync->payload, true);
            $headers = json_decode($sync->headers, true) ?? [];

            $response = Http::withHeaders($headers)
                ->{$this->getMethod($sync->method)}(
                    url($sync->endpoint),
                    $payload
                );

            if ($response->successful()) {
                DB::table('offline_syncs')->where('id', $this->syncId)->update([
                    'status'       => 'completed',
                    'processed_at' => now(),
                ]);
            } else {
                throw new \Exception("HTTP {$response->status()}: {$response->body()}");
            }
        } catch (\Throwable $e) {
            Log::error('离线同步处理失败', [
                'sync_id' => $this->syncId,
                'error'   => $e->getMessage(),
            ]);

            DB::table('offline_syncs')->where('id', $this->syncId)->update([
                'status'        => 'failed',
                'error_message' => $e->getMessage(),
                'processed_at'  => now(),
            ]);

            // 最多重试3次
            if ($this->attempts() < 3) {
                $this->release(now()->addMinutes(5));
            }
        }
    }

    private function getMethod(string $method): string
    {
        return match (strtolower($method)) {
            'post'   => 'post',
            'put'    => 'put',
            'patch'  => 'patch',
            'delete' => 'delete',
            default  => 'get',
        };
    }
}
```

### 4.4 Service Worker 端的后台同步实现

```javascript
// public/sw.js 中添加后台同步逻辑

const DB_NAME = 'laravel-pwa-db';
const STORE_NAME = 'sync-queue';

// 打开 IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true
                });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// 将请求存入 IndexedDB
async function saveRequest(request) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const requestData = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.clone().text(),
        timestamp: Date.now()
    };

    store.add(requestData);

    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
    });
}

// 拦截 POST/PUT/DELETE 请求，支持后台同步
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // 仅对非 GET 请求启用后台同步
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        event.respondWith(
            fetch(request.clone()).catch(async () => {
                // 网络失败，保存请求到 IndexedDB
                await saveRequest(request);

                // 注册后台同步
                const registration = await self.registration;
                await registration.sync.register('sync-offline-data');

                // 返回一个自定义的成功响应给前端
                return new Response(
                    JSON.stringify({
                        success: true,
                        offline: true,
                        message: '操作已保存，将在网络恢复后自动同步'
                    }),
                    {
                        headers: { 'Content-Type': 'application/json' },
                        status: 202
                    }
                );
            })
        );
    }
});

// 处理后台同步事件
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-offline-data') {
        event.waitUntil(syncOfflineData());
    }
});

// 同步离线数据
async function syncOfflineData() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
        request.onsuccess = async () => {
            const items = request.result;

            for (const item of items) {
                try {
                    const response = await fetch(item.url, {
                        method: item.method,
                        headers: item.headers,
                        body: item.body || undefined
                    });

                    if (response.ok) {
                        // 同步成功，从队列中删除
                        const deleteTx = db.transaction(STORE_NAME, 'readwrite');
                        deleteTx.objectStore(STORE_NAME).delete(item.id);

                        // 通知前端同步成功
                        self.clients.matchAll().then(clients => {
                            clients.forEach(client => {
                                client.postMessage({
                                    type: 'SYNC_SUCCESS',
                                    data: {
                                        url: item.url,
                                        method: item.method,
                                        timestamp: item.timestamp
                                    }
                                });
                            });
                        });
                    }
                } catch (error) {
                    console.error('[Sync] 同步失败:', item.url, error);
                    // 同步失败，保留在队列中等待下次重试
                    reject(error);
                    return;
                }
            }
            resolve();
        };
        request.onerror = reject;
    });
}
```

### 4.5 前端监听同步结果

在 Laravel 应用的 JavaScript 中监听 Service Worker 的消息：

```javascript
// resources/js/sw-listener.js

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'SYNC_SUCCESS') {
            // 显示同步成功通知
            showToast(`离线操作已同步: ${event.data.data.method} ${event.data.data.url}`);

            // 刷新相关数据
            if (typeof window.refreshData === 'function') {
                window.refreshData();
            }
        }
    });
}
```

## 五、Web Push 推送通知

### 5.1 安装 Laravel Web Push 包

Web Push 是 PWA 最具商业价值的功能之一。通过推送通知，应用可以在用户不主动访问的情况下触达用户，这是提高用户留存率和活跃度的关键手段。Laravel 生态中的 Web Push 支持已经非常成熟，借助社区维护的扩展包，我们可以快速实现完整的推送通知功能。

Laravel 生态中有多个 Web Push 相关的包，其中 `laravel-notification-channels/web-push` 是最为成熟和广泛使用的选择：

```bash
composer require laravel-notification-channels/web-push
php artisan vendor:publish --provider="NotificationChannels\WebPush\WebPushServiceProvider"
php artisan migrate
```

这个包会自动创建 `web_push_subscriptions` 表来存储用户的推送订阅信息，同时发布配置文件 `config/webpush.php`。

### 5.2 生成 VAPID 密钥

Web Push 需要使用 VAPID（Voluntary Application Server Identification）密钥来验证服务器身份：

```bash
php artisan webpush:vapid
```

执行后会输出一对公钥和私钥，将它们添加到 `.env` 文件中：

```env
VAPID_PUBLIC_KEY=BNxvL2S4Dh8y_Rl1XQ3Zk5j7...
VAPID_PRIVATE_KEY=aB7xK9mP2qR5tW8y...
VAPID_SUBJECT=mailto:admin@example.com
```

### 5.3 创建推送通知类

```php
<?php
// app/Notifications/NewArticlePublished.php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;
use NotificationChannels\WebPush\WebPushMessage;
use NotificationChannels\WebPush\WebPushChannel;

class NewArticlePublished extends Notification
{
    use Queueable;

    private $article;

    public function __construct($article)
    {
        $this->article = $article;
    }

    public function via($notifiable)
    {
        return [WebPushChannel::class];
    }

    public function toWebPush($notifiable, $notification)
    {
        return (new WebPushMessage())
            ->title('新文章发布')
            ->icon('/images/icons/icon-192x192.png')
            ->body("{$this->article->title} 已发布，快来阅读吧！")
            ->action('阅读文章', 'read_article')
            ->action('稍后再看', 'dismiss')
            ->badge('/images/icons/badge-72x72.png')
            ->dir('ltr')
            ->image($this->article->cover_image)
            ->tag('article-' . $this->article->id)
            ->data(['article_id' => $this->article->id, 'url' => "/articles/{$this->article->id}"])
            ->vibrate([200, 100, 200]);
    }
}
```

### 5.4 在 User 模型中添加 Web Push 支持

```php
<?php
// app/Models/User.php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use NotificationChannels\WebPush\HasPushSubscriptions;

class User extends Authenticatable
{
    use HasPushSubscriptions;

    // ... 其他模型代码
}
```

### 5.5 创建推送订阅 API

```php
<?php
// app/Http/Controllers/Api/PushSubscriptionController.php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class PushSubscriptionController extends Controller
{
    /**
     * 订阅推送通知
     */
    public function subscribe(Request $request)
    {
        $request->validate([
            'endpoint'    => 'required|url',
            'keys.auth'   => 'required|string',
            'keys.p256dh' => 'required|string',
        ]);

        $request->user()->updatePushSubscription(
            $request->input('endpoint'),
            $request->input('keys.p256dh'),
            $request->input('keys.auth')
        );

        return response()->json(['success' => true, 'message' => '已订阅推送通知']);
    }

    /**
     * 取消订阅推送通知
     */
    public function unsubscribe(Request $request)
    {
        $request->validate([
            'endpoint' => 'required|url',
        ]);

        $request->user()->deletePushSubscription($request->input('endpoint'));

        return response()->json(['success' => true, 'message' => '已取消推送通知']);
    }
}
```

### 5.6 配置路由

```php
<?php
// routes/api.php

use App\Http\Controllers\Api\PushSubscriptionController;
use App\Http\Controllers\Api\SyncController;

Route::middleware('auth:sanctum')->group(function () {
    // 推送订阅
    Route::post('/push/subscribe', [PushSubscriptionController::class, 'subscribe']);
    Route::post('/push/unsubscribe', [PushSubscriptionController::class, 'unsubscribe']);

    // 离线同步
    Route::post('/sync', [SyncController::class, 'store']);
    Route::get('/sync/{id}/status', [SyncController::class, 'status']);
});
```

### 5.7 前端：订阅推送通知

```javascript
// resources/js/push-notification.js

class PushNotificationManager {
    constructor() {
        this.vapidPublicKey = document.querySelector('meta[name="vapid-public-key"]')?.content;
        this.swRegistration = null;
    }

    async init() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('当前浏览器不支持推送通知');
            return;
        }

        try {
            this.swRegistration = await navigator.serviceWorker.ready;
            await this.subscribe();
        } catch (error) {
            console.error('推送通知初始化失败:', error);
        }
    }

    async subscribe() {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.warn('用户拒绝了通知权限');
            return;
        }

        let subscription = await this.swRegistration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await this.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
            });
        }

        // 将订阅信息发送到服务器
        await this.sendSubscriptionToServer(subscription);
    }

    async sendSubscriptionToServer(subscription) {
        const token = document.querySelector('meta[name="csrf-token"]')?.content;

        const response = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': token,
                'Authorization': `Bearer ${this.getAuthToken()}`
            },
            body: JSON.stringify({
                endpoint: subscription.endpoint,
                keys: {
                    p256dh: btoa(String.fromCharCode.apply(null,
                        new Uint8Array(subscription.getKey('p256dh')))),
                    auth: btoa(String.fromCharCode.apply(null,
                        new Uint8Array(subscription.getKey('auth'))))
                }
            })
        });

        if (!response.ok) {
            throw new Error('订阅推送失败');
        }

        console.log('推送通知订阅成功');
    }

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    getAuthToken() {
        // 从 cookie 或 localStorage 中获取认证 token
        return localStorage.getItem('auth_token') || '';
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    const pushManager = new PushNotificationManager();
    pushManager.init();
});
```

### 5.8 在 Service Worker 中处理推送通知

```javascript
// public/sw.js 中添加推送通知处理

self.addEventListener('push', (event) => {
    if (!event.data) return;

    let data;
    try {
        data = event.data.json();
    } catch (e) {
        data = {
            title: '新通知',
            body: event.data.text()
        };
    }

    const options = {
        body: data.body || '您有一条新通知',
        icon: data.icon || '/images/icons/icon-192x192.png',
        badge: data.badge || '/images/icons/badge-72x72.png',
        image: data.image,
        tag: data.tag || 'default',
        data: data.data || {},
        actions: data.actions || [
            { action: 'open', title: '查看' },
            { action: 'dismiss', title: '关闭' }
        ],
        vibrate: data.vibrate || [200, 100, 200],
        renotify: true,
        requireInteraction: false,
        silent: false
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '新通知', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const action = event.action;
    const data = event.notification.data;

    if (action === 'dismiss') return;

    const urlToOpen = data.url || '/';

    event.waitUntil(
        self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(clients => {
            // 检查是否已经有打开的窗口
            for (const client of clients) {
                if (client.url.includes(urlToOpen) && 'focus' in client) {
                    return client.focus();
                }
            }
            // 没有匹配的窗口，打开新窗口
            return self.clients.openWindow(urlToOpen);
        })
    );
});

// 处理通知关闭事件（用于统计数据）
self.addEventListener('notificationclose', (event) => {
    const data = event.notification.data;
    // 可以发送分析数据到服务器
    if (data.analytics) {
        fetch('/api/anistics/notification-closed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tag: event.notification.tag,
                timestamp: Date.now()
            })
        }).catch(() => {});
    }
});
```

### 5.9 发送推送通知

在 Laravel 应用中触发推送通知非常简单：

```php
<?php
// app/Http/Controllers/Admin/ArticleController.php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Article;
use App\Models\User;
use App\Notifications\NewArticlePublished;
use Illuminate\Http\Request;

class ArticleController extends Controller
{
    public function publish(Article $article)
    {
        $article->update(['status' => 'published', 'published_at' => now()]);

        // 给所有订阅了推送通知的用户发送通知
        User::where('notifications_enabled', true)
            ->each(function ($user) use ($article) {
                $user->notify(new NewArticlePublished($article));
            });

        return redirect()->route('articles.show', $article)
            ->with('success', '文章已发布并推送通知已发送');
    }
}
```

## 六、性能优化与 Lighthouse 评分提升

### 6.1 Lighthouse 评分标准

Google Lighthouse 是评估 Web 应用质量的权威工具，它从五个维度对应用进行全面审计。对于 PWA 来说，Lighthouse 不仅检查传统的性能指标，还会验证 PWA 特有的功能（如 Service Worker 注册、manifest 配置、离线能力等）。了解这些评分维度有助于我们有针对性地进行优化。

Lighthouse 的五个评估维度如下：

- **Performance（性能）**：首次内容绘制（FCP）、最大内容绘制（LCP）、累积布局偏移（CLS）、首次输入延迟（FID）等。
- **Accessibility（可访问性）**：语义化 HTML、色彩对比度、ARIA 属性等。
- **Best Practices（最佳实践）**：HTTPS、安全头、避免使用已废弃的 API 等。
- **SEO（搜索引擎优化）**：meta 标签、结构化数据、可索引性等。
- **PWA**：manifest 配置、Service Worker、离线能力等。

在这些维度中，性能（Performance）和 PWA 是最需要重点关注的两个方面。性能评分直接影响用户的感知体验，而 PWA 评分则决定了应用是否能被正确识别为可安装的渐进式 Web 应用。建议在项目的开发流程中集成 Lighthouse CI，每次代码提交都自动运行 Lighthouse 审计，确保评分不会出现退步。

### 6.2 Laravel 应用的性能优化技巧

**使用 Laravel 的资源编译和版本控制**：

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
        }),
    ],
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['axios', 'lodash'],
                },
            },
        },
    },
});
```

**添加资源预加载**：

```html
<!-- resources/views/layouts/app.blade.php -->
<head>
    <!-- 预加载关键资源 -->
    <link rel="preload" href="{{ asset('build/assets/app.css') }}" as="style">
    <link rel="preload" href="{{ asset('build/assets/app.js') }}" as="script">
    <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>

    <!-- DNS 预解析 -->
    <link rel="dns-prefetch" href="//cdn.example.com">
    <link rel="preconnect" href="https://cdn.example.com" crossorigin>
</head>
```

**图片优化**：

```blade
{{-- 使用现代图片格式和响应式图片 --}}
<picture>
    <source srcset="{{ asset('images/hero.webp') }}" type="image/webp">
    <source srcset="{{ asset('images/hero.avif') }}" type="image/avif">
    <img src="{{ asset('images/hero.jpg') }}"
         alt="Hero 图片"
         width="1200"
         height="600"
         loading="lazy"
         decoding="async">
</picture>
```

### 6.3 Service Worker 缓存优化

在 Service Worker 中添加缓存大小限制是生产环境部署中非常重要的一环。如果不加限制，随着用户浏览的页面越来越多，缓存会无限增长，最终可能占满浏览器分配的存储配额。不同浏览器对存储的限制策略不同，但通常为源可用磁盘空间的 6% 左右。当存储空间不足时，浏览器可能会自动清除该源的所有缓存数据。

为每种缓存类型设置合理的最大条目数，并在 activate 事件中进行清理，是一个很好的实践：

```javascript
// 缓存大小限制工具函数
async function limitCacheSize(cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    if (keys.length > maxEntries) {
        // 删除最旧的缓存项
        const itemsToDelete = keys.slice(0, keys.length - maxEntries);
        await Promise.all(itemsToDelete.map(key => cache.delete(key)));
    }
}

// 在缓存资源时定期清理
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // 清理旧缓存版本
            caches.keys().then(names =>
                Promise.all(
                    names.filter(name => name !== CACHE_NAME && name !== STATIC_CACHE &&
                                         name !== DYNAMIC_CACHE && name !== API_CACHE)
                        .map(name => caches.delete(name))
                )
            ),
            // 限制各缓存的最大数量
            limitCacheSize(DYNAMIC_CACHE, 100),
            limitCacheSize(API_CACHE, 50),
        ])
    );
});
```

### 6.4 使用 Workbox 简化 Service Worker 开发

Google 的 Workbox 库是目前最流行的 Service Worker 工具集，它提供了一系列经过充分测试的模块来简化缓存策略的实现、资源预缓存、运行时缓存等功能。使用 Workbox 可以避免手动编写复杂的 Service Worker 逻辑，同时获得更好的兼容性和更完善的边界情况处理。Workbox 还支持与 webpack/Vite 等构建工具的深度集成，可以自动分析构建产物并生成预缓存清单。

```bash
npm install workbox-webpack-plugin --save-dev
```

```javascript
// webpack.mix.js 或 vite.config.js 中配置 Workbox
const { InjectManifest } = require('workbox-webpack-plugin');

// 如果使用 Laravel Mix
mix.webpackConfig({
    plugins: [
        new InjectManifest({
            swSrc: 'resources/js/sw-src.js',
            swDest: 'sw.js',
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        })
    ]
});
```

```javascript
// resources/js/sw-src.js
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// 预缓存由 webpack 生成的清单
precacheAndRoute(self.__WB_MANIFEST);

// 静态资源：Cache First
registerRoute(
    ({ request }) => request.destination === 'style' ||
                     request.destination === 'script' ||
                     request.destination === 'font',
    new CacheFirst({
        cacheName: 'static-assets',
        plugins: [
            new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 }),
            new CacheableResponsePlugin({ statuses: [0, 200] })
        ]
    })
);

// 图片：Cache First
registerRoute(
    ({ request }) => request.destination === 'image',
    new CacheFirst({
        cacheName: 'images',
        plugins: [
            new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
            new CacheableResponsePlugin({ statuses: [0, 200] })
        ]
    })
);

// API 请求：Network First
registerRoute(
    ({ url }) => url.pathname.startsWith('/api/'),
    new NetworkFirst({
        cacheName: 'api-cache',
        plugins: [
            new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 }),
            new CacheableResponsePlugin({ statuses: [0, 200] })
        ],
        networkTimeoutSeconds: 3
    })
);

// 页面：Stale While Revalidate
registerRoute(
    ({ request }) => request.mode === 'navigate',
    new StaleWhileRevalidate({
        cacheName: 'pages',
        plugins: [
            new ExpirationPlugin({ maxEntries: 30 }),
            new CacheableResponsePlugin({ statuses: [0, 200] })
        ]
    })
);
```

## 七、生产环境部署注意事项

### 7.1 HTTPS 配置

Service Worker 要求在安全上下文下运行，因此 HTTPS 是必须的。在生产环境中，推荐使用 Let's Encrypt 提供的免费 SSL 证书，配合 Certbot 工具实现自动续期。如果使用 Nginx 作为反向代理，以下是一个推荐的配置，包含了安全头部、缓存策略和 Service Worker 特殊处理：

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    root /var/www/laravel-app/public;
    index index.php;

    # 安全头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Service Worker 特殊头部配置
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Service-Worker-Allowed "/";
        try_files $uri $uri/ =404;
    }

    # Manifest 缓存
    location = /manifest.json {
        add_header Cache-Control "public, max-age=86400";
        try_files $uri $uri/ =404;
    }

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # 静态资源长期缓存
    location ~* \.(css|js|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
}

# HTTP 重定向
server {
    listen 80;
    server_name app.example.com;
    return 301 https://$server_name$request_uri;
}
```

**关键配置说明**：

- `Service-Worker-Allowed` 头部允许 Service Worker 控制指定的作用域。如果 Service Worker 文件不在根目录下，这个头部是必须的。
- Service Worker 文件（`sw.js`）不能使用长期缓存，因为浏览器会定期检查其更新。设置为 `no-cache` 可以确保浏览器每次都验证是否需要更新。
- 静态资源（CSS、JS、图片等）可以设置长期缓存并加上 `immutable` 标记，因为文件名中包含了哈希值。

### 7.2 Service Worker 更新策略

Service Worker 的更新机制与传统 Web 资源的更新完全不同。浏览器不会像检查 CSS 或 JS 文件那样频繁地检查 Service Worker 更新。默认情况下，浏览器会在以下时机检查 Service Worker 是否有更新：页面导航时、功能性事件（如 push、sync）触发时，以及开发者显式调用 `registration.update()` 时。如果 Service Worker 文件的字节内容与已注册版本完全一致，浏览器会跳过更新流程。因此，在生产环境中，通过 CI/CD 流程在 Service Worker 文件中注入版本号或时间戳是一个非常有效的做法。

```javascript
// public/sw.js 中添加版本检查和更新提示

const CACHE_VERSION = 'v2';  // 每次发布新版本时更新

// 在主页面中检查 Service Worker 更新
// resources/js/app.js
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(registration => {
        // 检查更新
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' &&
                    navigator.serviceWorker.controller) {
                    // 有新版本可用，提示用户
                    showUpdateNotification();
                }
            });
        });

        // 每小时检查一次更新
        setInterval(() => {
            registration.update();
        }, 60 * 60 * 1000);
    });
}

function showUpdateNotification() {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg z-50';
    toast.innerHTML = `
        <p class="mb-2">有新版本可用！</p>
        <button onclick="window.location.reload()" class="bg-white text-blue-600 px-4 py-1 rounded">
            立即更新
        </button>
    `;
    document.body.appendChild(toast);
}
```

### 7.3 离线回退页面

创建一个美观的离线回退页面，在完全断网时展示给用户：

```blade
{{-- resources/views/offline.blade.php --}}
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>离线模式</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            padding: 2rem;
        }
        .offline-container { max-width: 480px; }
        .offline-icon { font-size: 4rem; margin-bottom: 1.5rem; }
        h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
        p { font-size: 1.1rem; opacity: 0.9; margin-bottom: 2rem; line-height: 1.6; }
        .retry-btn {
            display: inline-block;
            background: white;
            color: #667eea;
            padding: 0.75rem 2rem;
            border-radius: 2rem;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .retry-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        .cached-pages { margin-top: 2rem; }
        .cached-pages a {
            display: block;
            color: white;
            opacity: 0.8;
            padding: 0.5rem;
            text-decoration: none;
            border-bottom: 1px solid rgba(255,255,255,0.2);
        }
        .cached-pages a:hover { opacity: 1; }
    </style>
</head>
<body>
    <div class="offline-container">
        <div class="offline-icon">📡</div>
        <h1>您当前处于离线状态</h1>
        <p>网络连接不可用，请检查您的网络设置。<br>以下页面可离线访问：</p>
        <a href="/" class="retry-btn" onclick="window.location.reload()">重试连接</a>
        <div class="cached-pages" id="cached-pages">
            <p style="margin-top:1rem;opacity:0.7;font-size:0.9rem;">可离线访问的页面：</p>
        </div>
    </div>

    <script>
        // 列出已缓存的页面
        if ('caches' in window) {
            caches.open('laravel-pwa-v1').then(cache => {
                cache.keys().then(keys => {
                    const pagesDiv = document.getElementById('cached-pages');
                    keys.forEach(request => {
                        if (request.mode === 'navigate') {
                            const a = document.createElement('a');
                            a.href = request.url;
                            a.textContent = new URL(request.url).pathname;
                            pagesDiv.appendChild(a);
                        }
                    });
                });
            });
        }
    </script>
</body>
</html>
```

将离线页面添加到 Laravel 路由中：

```php
<?php
// routes/web.php
Route::get('/offline', function () {
    return view('offline');
})->name('offline');
```

同时，将离线页面的 URL 加入到 Service Worker 的 `STATIC_ASSETS` 预缓存列表中，确保在首次安装时就缓存了离线页面。

### 7.4 配置 webpush.php

发布配置文件后，编辑 `config/webpush.php`，根据你的项目需求进行定制：

```php
<?php
// config/webpush.php

return [
    'vapid' => [
        'subject'    => env('VAPID_SUBJECT', 'mailto:admin@example.com'),
        'public_key' => env('VAPID_PUBLIC_KEY'),
        'private_key' => env('VAPID_PRIVATE_KEY'),
    ],

    'gcm' => [
        'key' => env('GCM_KEY'),
    ],

    // 是否使用队列发送通知
    'queue' => env('WEB_PUSH_QUEUE', true),

    // 每个订阅的重试次数
    'retry_count' => 3,

    // Web Push 中间件
    'middleware' => [],

    // 数据库连接
    'database_connection' => env('WEB_PUSH_DB_CONNECTION'),
];
```

建议将 `queue` 设置为 `true`，因为推送通知的发送可能涉及大量用户，使用队列可以避免请求超时。在 `.env` 中设置 `WEB_PUSH_QUEUE=true` 即可。

### 7.5 CI/CD 中的 Service Worker 版本管理

在 CI/CD 流程中自动化 Service Worker 的版本管理是一个容易被忽略但非常重要的环节：

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Dependencies
        run: |
          composer install --no-dev --optimize-autoloader
          npm ci

      - name: Build Assets
        run: |
          npm run build
          # 更新 Service Worker 版本号
          VERSION=$(git rev-parse --short HEAD)
          sed -i "s/const CACHE_VERSION = '.*'/const CACHE_VERSION = '${VERSION}'/" public/sw.js

      - name: Deploy to Server
        uses: SamKirkland/FTP-Deploy-Action@v4.3.5
        with:
          server: ${{ secrets.FTP_SERVER }}
          username: ${{ secrets.FTP_USERNAME }}
          password: ${{ secrets.FTP_PASSWORD }}
          server-dir: /var/www/laravel-app/
```

由于 Service Worker 的更新检测是基于文件内容的字节级比对，即使只是改动了一个字符，浏览器也会认为这是一个新的 Service Worker 版本。因此，在 CI/CD 流程中自动更新版本号是非常推荐的做法。

### 7.6 常见问题排查

在 PWA 改造和部署过程中，开发者经常会遇到以下问题。这里整理了一份排查指南：

**Service Worker 不更新**：Service Worker 的更新遵循以下规则——浏览器会在导航时（不是每次请求）检查 sw.js 文件是否有更新。如果文件内容与已注册的 Service Worker 完全一致（字节级比对），浏览器不会触发更新。解决方法是在 CI/CD 中注入版本号，或者在 sw.js 文件末尾添加注释行 `// version: ${timestamp}` 来强制更新。

**缓存不生效**：检查请求的 URL 是否正确匹配了策略路由中的判断条件。在 Chrome DevTools 的 Network 面板中，被 Service Worker 拦截的请求会显示 "(from ServiceWorker)" 的标记。同时在 Application > Cache Storage 面板中可以查看缓存的具体内容。

**推送通知不弹出**：首先检查浏览器的通知权限是否被授予（`Notification.permission`）。其次检查 VAPID 密钥是否正确配置。最后确认 Service Worker 中是否正确注册了 `push` 事件监听器。iOS Safari 上需要将应用添加到主屏幕后才能使用推送通知。

**后台同步不触发**：Background Sync API 在 Chrome 中的实现较为完善，但 Firefox 和 Safari 的支持程度不同。确保在注册 sync 事件前已经将请求数据存入 IndexedDB。注意 sync 事件只在网络恢复时触发一次，如果同步失败，需要手动重新注册。

**Lighthouse 评分不达标**：最常见的扣分项包括缺少 `<meta name="viewport">` 标签、图标尺寸不足、缺少离线页面、Service Worker 未注册等。逐项对照 Lighthouse 的审计报告进行修复即可。

### 7.7 监控与调试

Service Worker 的调试主要依赖 Chrome DevTools：

1. **Application 面板**：查看 Service Worker 的状态（安装、激活、运行）、缓存内容、IndexedDB 数据。
2. **Network 面板**：查看请求是否被 Service Worker 拦截（注意 `from ServiceWorker` 标记）。
3. **Lighthouse 面板**：运行完整的 PWA 审计。
4. **模拟离线**：在 Network 面板中勾选 "Offline" 来测试离线功能。

在生产环境中，建议添加 Service Worker 错误的监控上报：

```javascript
// public/sw.js 中添加错误上报
self.addEventListener('error', (event) => {
    console.error('[Service Worker] Error:', event.error);

    // 上报错误到监控服务
    fetch('/api/sw-error-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error?.stack,
            userAgent: navigator.userAgent,
            timestamp: Date.now()
        })
    }).catch(() => {}); // 忽略上报本身的错误
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('[Service Worker] Unhandled Rejection:', event.reason);

    fetch('/api/sw-error-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'unhandledrejection',
            reason: String(event.reason),
            timestamp: Date.now()
        })
    }).catch(() => {});
});
```

## 八、总结与最佳实践

将一个传统的 Laravel Web 应用改造为 PWA 是一个循序渐进的过程。以下是整个迁移过程中的一些最佳实践建议：

**渐进增强**：PWA 的核心理念是"渐进增强"，即在支持的浏览器上提供增强体验，在不支持的浏览器上保持基本功能。不要因为引入 PWA 而破坏了传统的 Web 体验。

**缓存策略要匹配业务场景**：不要盲目对所有资源使用同一种缓存策略。静态资源用 Cache First，API 数据用 Network First，频繁访问但不要求实时性的页面用 Stale While Revalidate。

**缓存版本管理**：每次发布新版本时，更新缓存版本号。在 activate 事件中清理旧缓存，确保用户能及时获取最新内容。

**注意存储限制**：浏览器对 Service Worker 的缓存大小有限制（通常为源可用磁盘空间的 6% 左右）。使用 ExpirationPlugin 或手动实现缓存清理逻辑。

**测试离线场景**：在开发过程中频繁测试离线场景，确保 Service Worker 正确预缓存了所有必要的资源，离线回退页面能正常显示。

**推送通知要有节制**：推送通知是提高用户留存的利器，但过度推送会导致用户关闭通知权限甚至卸载应用。建议在用户首次访问时引导用户订阅，而不是弹窗强求。

**持续监控 Lighthouse 评分**：将 Lighthouse CI 集成到项目的 CI/CD 流程中，确保每次发布都不会降低 PWA 的评分。

通过以上步骤，一个传统的 Laravel Web 应用就可以完整地迁移到 PWA 架构，获得离线访问、后台同步、推送通知等原生 App 级别的能力，同时保持 Web 应用的开放性和可维护性。PWA 不是要取代原生 App，而是在 Web 平台上提供尽可能接近原生的体验，这正是它的价值所在。

## 附录：完整项目文件清单

为了方便开发者快速上手，这里列出本文涉及的所有文件及其职责：

| 文件路径 | 职责 |
|---------|------|
| `public/manifest.json` | Web App Manifest，定义应用元信息 |
| `public/sw.js` | Service Worker 主文件，处理缓存和离线逻辑 |
| `public/offline.html` | 静态离线回退页面（可选，也可使用 Blade 模板） |
| `resources/views/offline.blade.php` | Laravel 离线页面模板 |
| `resources/views/layouts/app.blade.php` | 主布局文件，注册 Manifest 和 Service Worker |
| `resources/js/push-notification.js` | 推送通知订阅管理 |
| `resources/js/sw-listener.js` | Service Worker 消息监听 |
| `config/webpush.php` | Web Push 配置文件 |
| `app/Notifications/NewArticlePublished.php` | 推送通知类示例 |
| `app/Http/Controllers/Api/PushSubscriptionController.php` | 推送订阅 API |
| `app/Http/Controllers/Api/SyncController.php` | 离线同步 API |
| `app/Jobs/ProcessOfflineSync.php` | 离线同步队列任务 |
| `database/migrations/xxx_create_offline_syncs_table.php` | 离线同步数据表迁移 |
| `routes/api.php` | API 路由定义 |

按照本文的步骤逐项完成以上文件的创建和配置，你的 Laravel 应用就能顺利地从传统的 Web 应用升级为功能完善的渐进式 Web 应用。记住，PWA 改造是一个持续迭代的过程，建议先从最基础的 Manifest 和 Service Worker 注册开始，逐步添加离线缓存、后台同步和推送通知等功能，在每个阶段都通过 Lighthouse 审计来验证改进效果，最终打造出一个真正优秀的渐进式 Web 应用。

## 相关阅读

- [Web Push API (VAPID) 实战：浏览器原生推送通知——Laravel 后端 Service Worker 注册、订阅管理与消息分发](/categories/前端/Web-Push-API-VAPID-实战-浏览器原生推送通知-Laravel后端Service-Worker注册订阅管理与消息分发/)
- [Laravel Broadcasting 深度实战：Reverb + Private Channel + Presence Channel——B2C 电商的实时通知与在线状态架构](/categories/05_PHP/Laravel/2026-06-06-Laravel-Broadcasting-Reverb-Private-Presence-Channel-B2C-Realtime-Notification/)
- [Progressive Web App 实战：Service Worker、离线缓存、推送通知——Laravel 应用的 PWA 改造指南](/categories/前端/Progressive-Web-App-实战-Service-Worker-离线缓存-推送通知-Laravel应用的PWA改造指南/)
