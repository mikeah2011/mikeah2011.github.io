---

title: Progressive Web App 实战：Service Worker、离线缓存、推送通知——Laravel 应用的 PWA 改造指南
keywords: [Progressive Web App, Service Worker, Laravel, PWA, 离线缓存, 推送通知, 应用的, 改造指南]
date: 2026-06-06 10:00:00
description: 全面实战指南：手把手教你将Laravel应用改造为PWA。从Web App Manifest配置、Service Worker注册与生命周期管理，到Cache First、Network First、Stale While Revalidate等多级离线缓存策略深度解析，再到Web Push推送通知的VAPID密钥生成、前端订阅管理与Laravel后端队列化异步发送。附Workbox集成、Lighthouse审计通过技巧与常见踩坑解决方案，让Web应用拥有媲美原生App的离线体验与推送能力。
tags:
- PWA
- service-worker
- 离线缓存
- 推送通知
- Laravel
- Workbox
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---




> 传统 Web 应用在网络断开时"白屏一片"，用户流失率居高不下。Progressive Web App（PWA）通过 Service Worker、Cache API、Web Push 等核心技术，让 Web 应用拥有媲美原生 App 的离线体验与推送能力。本文将以一个真实的 Laravel B2C 电商应用为背景，手把手带你完成从 manifest.json 配置、Service Worker 生命周期管理、多级离线缓存策略，到 Laravel 后端推送通知的完整改造流程。

<!-- more -->

## 一、PWA 核心概念与架构总览

### 1.1 什么是 PWA

PWA（Progressive Web App）并不是某一项单独的技术，而是一系列现代 Web 技术的系统性组合。它的终极目标是弥合 Web 应用与原生应用之间的体验鸿沟。具体来说，一个合格的 PWA 应当具备以下几个关键能力：

**可安装性**：用户在浏览器中访问你的网站时，会看到"添加到主屏幕"的提示。点击确认后，应用图标会出现在手机桌面或电脑启动台上，下次打开时直接全屏启动，没有地址栏和浏览器 UI 的干扰，体验与原生应用几乎无异。

**离线可用性**：通过 Service Worker 和 Cache API 的配合，PWA 可以在首次访问时预缓存核心资源，在后续访问中即使网络断开或信号极弱，也能从本地缓存中加载页面并展示内容。这对于电商类应用尤为关键——用户在地铁中浏览商品详情页时，不会因为短暂的网络抖动而看到令人沮丧的白屏。

**推送通知能力**：借助 Web Push API，PWA 可以像原生 App 一样向用户发送通知消息。比如订单状态更新、促销活动提醒、库存到货通知等，都是提升用户回访率和转化率的有效手段。

**高性能表现**：PWA 通过智能的缓存预加载和资源分级缓存策略，大幅减少了网络往返次数。首次加载后，后续访问几乎是瞬间完成的，这让用户体验上了一个台阶。

需要特别强调的是，PWA 是一种"渐进增强"的理念——它不会强制要求用户的浏览器支持所有特性。在不支持 Service Worker 的老旧浏览器中，你的应用依然能作为普通网页正常运行。而在支持现代特性的浏览器中，PWA 的各项增强能力会逐步生效。这种设计理念让 PWA 成为兼顾兼容性与先进性的最优解。

### 1.2 PWA 整体技术架构

在正式动手之前，先用一张架构图来理解 PWA 的各组件如何协作。这是一张"从浏览器到服务器"的全景视图：

```
┌─────────────────────────────────────────────────────────┐
│                   用户浏览器 (Client)                    │
│                                                         │
│  ┌───────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ manifest  │  │  Service Worker  │  │   Cache API  │  │
│  │   .json   │  │  (独立后台线程)  │  │  (本地缓存)  │  │
│  │ 应用元数据│  │  生命周期管理    │  │  离线数据存储│  │
│  └───────────┘  └────────┬─────────┘  └──────────────┘  │
│                          │                              │
│  ┌───────────────────────┼──────────────────────────┐   │
│  │    Fetch 事件拦截     │   Push 消息接收          │   │
│  └───────────────────────┼──────────────────────────┘   │
└──────────────────────────┼──────────────────────────────┘
                           │
              网络请求 / Push 消息推送
                           │
┌──────────────────────────┼──────────────────────────────┐
│               Laravel 后端 (Server)                      │
│                          │                              │
│  ┌──────────────┐  ┌─────┴────────┐  ┌───────────────┐  │
│  │  Blade/Vue   │  │ API Routes   │  │   VAPID       │  │
│  │  前端页面    │  │ Push 通知    │  │   Keys 管理   │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Queue Worker (异步推送队列，保障发送性能)       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

在这个架构中，浏览器端的核心是 Service Worker。它运行在与页面 JavaScript 完全隔离的独立线程中，无法直接操作 DOM，但能够拦截所有网络请求、管理缓存存储、接收后台推送消息。manifest.json 则定义了应用的名称、图标、启动 URL 等元信息，告诉浏览器"这个网站是一个可以安装的应用"。

### 1.3 深入理解 Service Worker 生命周期

Service Worker 的生命周期是理解整个 PWA 机制的关键所在。它有三个核心阶段，每个阶段都对应着不同的任务：

```
  ┌────────────────┐
  │  下载 (Download)│  浏览器发现新的 SW 文件
  └───────┬────────┘
          ▼
  ┌────────────────┐
  │  安装 (Install) │  执行预缓存逻辑，缓存核心静态资源
  │  event.waitUntil│  等待所有缓存操作完成后才算安装成功
  └───────┬────────┘
          ▼
  ┌────────────────┐
  │  激活 (Activate)│  清理旧版本缓存，调用 clients.claim() 接管页面
  │  event.waitUntil│  等待旧缓存清理完成后才算激活成功
  └───────┬────────┘
          ▼
  ┌────────────────┐
  │   空闲 (Idle)   │  监听 fetch、push、message 等事件
  │   ↕ 事件驱动 ↕  │  在事件间歇可能被浏览器终止以节省资源
  └────────────────┘
```

**安装阶段**是 Service Worker 第一次被注册或发现有更新时触发的。这个阶段的核心任务是预缓存——把应用最核心的资源（HTML 模板、主样式表、主脚本文件、应用图标等）一次性缓存到本地。`event.waitUntil()` 方法接收一个 Promise，浏览器会等到这个 Promise 解决后才认为安装成功。如果预缓存过程中任何一个文件下载失败，整个安装阶段都会失败，Service Worker 不会进入激活状态。

**激活阶段**发生在安装成功之后。这时候旧版本的 Service Worker 已经退出，新的 Service Worker 需要清理历史缓存。这是一个非常重要的步骤——随着应用的不断迭代，旧的缓存资源可能已经过时，如果不及时清理，会浪费用户的磁盘空间，甚至导致用户看到旧版页面。

**空闲阶段**是 Service Worker 的常态。它默默监听着各种事件：当页面发起网络请求时触发 `fetch` 事件，Service Worker 可以决定是从缓存返回还是走网络；当服务器推送消息到达时触发 `push` 事件，Service Worker 会弹出系统通知。

## 二、Laravel 项目 PWA 改造第一步：manifest.json

### 2.1 创建 Web App Manifest

manifest.json 是浏览器识别"PWA 应用"的入口文件。它必须放在网站的根路径下，通过 `<link rel="manifest">` 标签引入。在 Laravel 项目中，这个文件放在 `public/` 目录下即可。

下面是一个为 B2C 电商应用精心配置的 manifest.json，其中包含了应用名称、图标定义、启动行为、屏幕方向等关键属性：

```json
{
  "name": "ShopEase - 优质电商",
  "short_name": "ShopEase",
  "description": "ShopEase B2C 电商平台 - 随时随地购物",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#4F46E5",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-96x96.png",
      "sizes": "96x96",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-128x128.png",
      "sizes": "128x128",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-144x144.png",
      "sizes": "144x144",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable any"
    }
  ],
  "screenshots": [
    {
      "src": "/screenshots/home.png",
      "sizes": "1280x720",
      "type": "image/png",
      "form_factor": "wide"
    },
    {
      "src": "/screenshots/home-mobile.png",
      "sizes": "750x1334",
      "type": "image/png",
      "form_factor": "narrow"
    }
  ],
  "categories": ["shopping", "business"],
  "lang": "zh-CN",
  "dir": "ltr"
}
```

有几个配置项值得特别说明：

- **`display: "standalone"`**：让应用以独立窗口形式启动，隐藏浏览器地址栏和工具栏，这是最接近原生 App 体验的模式。其他可选值还有 `"fullscreen"`（全屏，适合游戏）和 `"minimal-ui"`（保留最小化浏览器 UI）。
- **`purpose: "maskable any"`**：`maskable` 表示图标支持自适应形状裁剪，Android 系统会根据不同厂商的图标规范（圆形、方形、圆角矩形等）自动裁剪图标。同时保留 `any` 确保在不支持 maskable 的环境中仍能正常显示。
- **`screenshots`**：在安装弹窗中展示应用截图预览，有助于提升用户的安装意愿。`form_factor` 区分宽屏和窄屏场景。

### 2.2 在 Laravel Blade 布局中正确引入

光有 manifest.json 还不够，需要在页面的 `<head>` 标签中正确声明它，同时补充 iOS Safari 的兼容性标签：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#4F46E5">
    <meta name="description" content="ShopEase B2C 电商平台">

    <!-- PWA 核心：Web App Manifest -->
    <link rel="manifest" href="/manifest.json">

    <!-- iOS Safari 专用 PWA 支持标签 -->
    <link rel="apple-touch-icon" href="/icons/icon-192x192.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="ShopEase">

    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
    <!-- 应用主体内容 -->
</body>
</html>
```

iOS Safari 对 PWA 的支持长期以来落后于 Chrome 和 Firefox，因此需要额外添加 `apple-mobile-web-app-capable` 和 `apple-mobile-web-app-status-bar-style` 这两个专用 meta 标签。前者告诉 iOS 这个网站可以作为全屏应用运行，后者控制状态栏的样式（`black-translucent` 会让状态栏融入页面内容区域，视觉效果更协调）。

## 三、Service Worker 实战：注册与生命周期管理

### 3.1 在前端注册 Service Worker

Service Worker 的注册逻辑应当放在应用的主入口文件中。需要注意的是，注册过程是异步的，并且最好在页面 `load` 事件触发后再执行，避免与页面渲染竞争资源：

```javascript
// resources/js/app.js
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/'
            });

            console.log('[PWA] Service Worker 注册成功，scope:', registration.scope);

            // 监听是否有新版本的 Service Worker 被发现
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                console.log('[PWA] 发现新版本，正在安装...');

                newWorker.addEventListener('statechange', () => {
                    // 新版本安装完成，且当前页面已被旧版 SW 控制
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateNotification();
                    }
                });
            });
        } catch (error) {
            console.error('[PWA] Service Worker 注册失败:', error);
        }
    });
}

// 向用户展示"有新版本可用"的友好提示
function showUpdateNotification() {
    const toast = document.createElement('div');
    toast.className = 'pwa-update-toast';
    toast.innerHTML = `
        <div class="toast-content">
            <span>🆕 新版本已就绪</span>
            <button id="pwa-update-btn" class="btn btn-primary btn-sm">立即更新</button>
            <button id="pwa-dismiss-btn" class="btn btn-ghost btn-sm">稍后</button>
        </div>
    `;
    document.body.appendChild(toast);

    document.getElementById('pwa-update-btn').addEventListener('click', () => {
        // 通知新版 SW 跳过等待阶段，立即接管
        navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
        window.location.reload();
    });

    document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
        toast.remove();
    });
}
```

这段代码的核心逻辑是：当浏览器检测到 `/sw.js` 文件内容发生变化（即我们发布了新版本），`updatefound` 事件会被触发。新 Service Worker 进入安装状态，安装完成后判断当前页面是否正被旧版 Service Worker 控制——如果是，说明需要提示用户刷新来使用新版。

### 3.2 Service Worker 完整实现

`public/sw.js` 是 Service Worker 的主体文件。它运行在独立线程中，不能使用 DOM API，但可以使用 Cache API、Fetch API、Notifications API 等。以下是一个面向电商应用的完整实现，包含预缓存、多策略缓存路由、推送通知处理等全部逻辑：

```javascript
// public/sw.js

// ==============================
// 常量定义
// ==============================
const CACHE_VERSION = 'v2.1.0';
const CACHE_NAMES = {
    static: `static-${CACHE_VERSION}`,      // JS/CSS/字体/图标等静态资源
    pages: `pages-${CACHE_VERSION}`,         // HTML 页面
    images: `images-${CACHE_VERSION}`,       // 图片资源
    api: `api-${CACHE_VERSION}`,             // API 数据
    googleFonts: `google-fonts-${CACHE_VERSION}`
};

// 预缓存清单：首次安装时必须缓存的核心资源
const PRECACHE_ASSETS = [
    '/',
    '/offline',
    '/css/app.css',
    '/js/app.js',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/manifest.json'
];

// 允许被缓存的 API 路径前缀白名单
const CACHEABLE_API_PATHS = [
    '/api/products/categories',
    '/api/products/featured',
    '/api/banners',
    '/api/config'
];

// ==============================
// 1. Install 事件 —— 预缓存核心资源
// ==============================
self.addEventListener('install', (event) => {
    console.log('[SW] 安装中，预缓存核心资源...');

    event.waitUntil(
        caches.open(CACHE_NAMES.static)
            .then((cache) => {
                // addAll 会并行下载所有资源，任一失败则整体失败
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(() => {
                // 预缓存完成，立即跳过等待阶段进入激活
                return self.skipWaiting();
            })
            .catch((err) => {
                console.error('[SW] 预缓存失败:', err);
            })
    );
});

// ==============================
// 2. Activate 事件 —— 清理旧缓存
// ==============================
self.addEventListener('activate', (event) => {
    console.log('[SW] 激活中，清理旧缓存...');

    const currentCacheNames = Object.values(CACHE_NAMES);

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                // 找出所有不在当前版本白名单中的缓存并删除
                return Promise.all(
                    cacheNames
                        .filter((name) => !currentCacheNames.includes(name))
                        .map((name) => {
                            console.log('[SW] 删除旧缓存:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                // 立即接管所有已打开的客户端页面
                return self.clients.claim();
            })
    );
});

// ==============================
// 3. Fetch 事件 —— 根据请求类型选择缓存策略
// ==============================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 只处理 GET 请求，POST/PUT/DELETE 不做缓存
    if (request.method !== 'GET') return;

    // 跳过浏览器扩展协议的请求
    if (url.protocol === 'chrome-extension:') return;

    // Google Fonts 资源单独处理（跨域但可以缓存）
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(cacheFirst(request, CACHE_NAMES.googleFonts));
        return;
    }

    // 只处理同源请求的缓存策略
    if (url.origin === self.location.origin) {

        // API 请求：根据白名单决定是否可缓存
        if (url.pathname.startsWith('/api/')) {
            if (isCacheableAPI(url.pathname)) {
                // 可缓存的 API 用 Network First，3 秒超时后回退缓存
                event.respondWith(networkFirst(request, CACHE_NAMES.api, 3000));
            } else {
                // 不可缓存的 API（如购物车、订单提交）直接走网络
                event.respondWith(networkOnly(request));
            }
            return;
        }

        // 图片请求：Cache First，图片资源变化频率低，优先从缓存加载
        if (isImageRequest(url.pathname)) {
            event.respondWith(cacheFirst(request, CACHE_NAMES.images));
            return;
        }

        // HTML 页面：Stale While Revalidate，先返回缓存让用户立即看到内容，同时后台更新
        if (request.headers.get('Accept')?.includes('text/html')) {
            event.respondWith(staleWhileRevalidate(request, CACHE_NAMES.pages));
            return;
        }

        // 其他静态资源（JS/CSS）：Cache First
        event.respondWith(cacheFirst(request, CACHE_NAMES.static));
    }
});

// ==============================
// 缓存策略实现
// ==============================

/**
 * 策略一：Cache First（缓存优先）
 * 逻辑：先查缓存，命中则直接返回；未命中则走网络，成功后写入缓存
 * 适用场景：静态资源（JS/CSS/字体）、图片等不常变化的资源
 */
async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            // 不缓存 Range 请求（视频分片等场景）
            if (!request.headers.has('Range')) {
                cache.put(request, networkResponse.clone());
            }
        }
        return networkResponse;
    } catch (error) {
        // 既无缓存，网络也失败的情况
        if (request.mode === 'navigate') {
            return caches.match('/offline');  // 导航请求返回离线页面
        }
        return new Response('离线不可用', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * 策略二：Network First（网络优先）
 * 逻辑：优先走网络获取最新数据，网络失败或超时后回退到缓存
 * 适用场景：API 数据、需要实时性的内容
 */
async function networkFirst(request, cacheName, timeout = 3000) {
    const cache = await caches.open(cacheName);

    try {
        // 使用 AbortController 实现请求超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const networkResponse = await fetch(request, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (networkResponse.ok) {
            // 网络成功，更新缓存中的数据
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        // 网络失败，尝试从缓存中读取
        console.log('[SW] 网络请求失败，回退到缓存:', request.url);
        const cachedResponse = await cache.match(request);

        if (cachedResponse) {
            return cachedResponse;
        }

        // 缓存也没有，返回离线页面或错误响应
        if (request.mode === 'navigate') {
            return caches.match('/offline');
        }

        return new Response(
            JSON.stringify({ error: '网络不可用，请稍后重试', offline: true }),
            {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

/**
 * 策略三：Stale While Revalidate（陈旧优先，后台更新）
 * 逻辑：有缓存就立即返回（让用户快速看到内容），同时后台发起网络请求更新缓存
 * 适用场景：HTML 页面、分类列表等"可以短暂过时但必须快速响应"的资源
 */
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);

    // 无论是否命中缓存，都发起网络请求来刷新缓存
    const fetchPromise = fetch(request)
        .then((networkResponse) => {
            if (networkResponse.ok) {
                cache.put(request, networkResponse.clone());
            }
            return networkResponse;
        })
        .catch(() => {
            // 网络失败时，如果没有缓存则返回离线页面
            if (!cachedResponse && request.mode === 'navigate') {
                return caches.match('/offline');
            }
        });

    // 有缓存就立即返回缓存版本，否则等待网络结果
    return cachedResponse || fetchPromise;
}

/**
 * 策略四：Network Only（仅网络）
 * 逻辑：始终走网络，不做任何缓存
 * 适用场景：购物车操作、订单提交、用户认证等不可缓存的动态交互
 */
async function networkOnly(request) {
    return fetch(request);
}

// ==============================
// 工具函数
// ==============================

function isImageRequest(pathname) {
    return /\.(png|jpg|jpeg|gif|svg|webp|avif|ico)(\?.*)?$/.test(pathname);
}

function isCacheableAPI(pathname) {
    return CACHEABLE_API_PATHS.some((prefix) => pathname.startsWith(prefix));
}

// ==============================
// 4. Push 事件 —— 接收服务器推送的消息并弹出通知
// ==============================
self.addEventListener('push', (event) => {
    console.log('[SW] 收到推送消息');

    // 默认通知内容（当推送数据为空或解析失败时使用）
    let data = {
        title: 'ShopEase',
        body: '您有一条新消息',
        icon: '/icons/icon-192x192.png'
    };

    if (event.data) {
        try {
            data = { ...data, ...event.data.json() };
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        image: data.image,
        vibrate: [200, 100, 200],
        tag: data.tag || 'default',
        renotify: data.renotify || false,
        data: {
            url: data.url || '/',
            timestamp: Date.now()
        },
        actions: data.actions || [
            { action: 'open', title: '查看详情' },
            { action: 'dismiss', title: '忽略' }
        ]
    };

    // showNotification 是 Service Worker 的通知 API，不受页面是否关闭影响
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// ==============================
// 5. Notification Click —— 处理用户点击通知的交互
// ==============================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const action = event.action;
    const targetUrl = event.notification.data?.url || '/';

    // 用户点击了"忽略"按钮
    if (action === 'dismiss') return;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // 如果已经有同源的窗口打开着，直接导航到目标 URL 并聚焦
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        client.navigate(targetUrl);
                        return client.focus();
                    }
                }
                // 没有已打开的窗口，打开一个新窗口
                return self.clients.openWindow(targetUrl);
            })
    );
});

// ==============================
// 6. Message 事件 —— 处理来自页面的控制指令
// ==============================
self.addEventListener('message', (event) => {
    // 跳过等待，立即激活新版 Service Worker
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    // 按需清除指定缓存（用于用户手动清理缓存功能）
    if (event.data?.type === 'CLEAR_CACHE') {
        const cacheName = event.data.cacheName;
        if (cacheName) {
            caches.delete(cacheName).then(() => {
                event.source?.postMessage({ type: 'CACHE_CLEARED', cacheName });
            });
        }
    }
});
```

## 四、离线缓存策略深度解析

### 4.1 策略选型对照表

在实际项目中，不同类型的资源有不同的更新频率和实时性要求，因此需要"因材施教"地选择缓存策略。以下是电商场景下的推荐对照表：

```
┌─────────────────────┬─────────────────────────┬──────────────────────────────────────┐
│      资源类型        │      推荐策略            │             选择理由                  │
├─────────────────────┼─────────────────────────┼──────────────────────────────────────┤
│ 核心 HTML 页面      │ Stale While Revalidate  │ 用户秒开页面，后台静默更新最新版本   │
│ JS / CSS 文件       │ Cache First             │ 文件名带 hash，内容变更即生成新文件  │
│ 字体文件 (woff2)    │ Cache First             │ 字体文件几乎不会改变                 │
│ 产品列表图片        │ Cache First             │ 图片 CDN 地址不变，变化频率极低      │
│ 首页 Banner 轮播    │ Network First           │ 运营内容需要实时更新，3秒超时回退    │
│ 产品详情 API        │ Network First           │ 价格和库存必须实时，但降级可用缓存   │
│ 分类导航 API        │ Stale While Revalidate  │ 分类变化不频繁，优先保证加载速度     │
│ 用户购物车 API      │ Network Only            │ 购物车状态必须实时同步，不可缓存     │
│ 搜索建议 API        │ Network Only            │ 搜索结果必须实时响应                 │
│ Google Fonts CSS    │ Stale While Revalidate  │ CSS 文件偶尔会更新字体声明           │
│ Google Fonts 字体   │ Cache First             │ 字体二进制文件不变                   │
└─────────────────────┴─────────────────────────┴──────────────────────────────────────┘
```

选型的核心思路可以归结为三点：**如果资源变化频率低（如图标、字体），大胆缓存；如果资源需要一定新鲜度但可以容忍短暂延迟（如页面内容），用后台更新策略；如果资源必须实时准确（如购物车、支付），不缓存。**

### 4.2 缓存容量管理

浏览器对 Cache API 的存储空间是有上限的，通常是设备可用磁盘空间的 6% 到 10% 之间。在图片较多的电商场景中，如果不加限制地缓存图片，可能会很快触达上限。因此需要在 Service Worker 中加入容量管理机制：

```javascript
// 缓存条目数限制清理函数
async function cleanupCache(cacheName, maxEntries = 100) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    if (keys.length > maxEntries) {
        // 超出上限，删除最早写入的缓存条目（FIFO 策略）
        const entriesToDelete = keys.slice(0, keys.length - maxEntries);
        await Promise.all(
            entriesToDelete.map((key) => cache.delete(key))
        );
        console.log(`[SW] 缓存清理 ${cacheName}：移除 ${entriesToDelete.length} 条过期记录`);
    }
}
```

建议在每次 `fetch` 事件写入新缓存后，顺带触发一次容量检查。这样既能保证缓存的及时更新，又不会让存储空间无限膨胀。

### 4.3 设计优雅的离线回退页面

当用户在离线状态下访问一个未被缓存的页面时，如果直接显示浏览器默认的"无法连接"错误页面，体验会非常糟糕。因此我们需要准备一个精心设计的离线回降页面 `public/offline.html`，它应当简洁明了地告知用户当前状态，并提供重新加载的按钮：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ShopEase - 离线模式</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
            display: flex; align-items: center; justify-content: center;
            min-height: 100vh; background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            color: #1e293b;
        }
        .offline-container { text-align: center; padding: 2rem; max-width: 480px; }
        .offline-icon { font-size: 4rem; margin-bottom: 1.5rem; }
        .offline-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; }
        .offline-desc { color: #64748b; line-height: 1.8; margin-bottom: 2rem; }
        .btn-retry {
            display: inline-block; padding: 14px 36px; background: #4F46E5;
            color: #fff; border: none; border-radius: 10px; font-size: 1rem;
            font-weight: 600; cursor: pointer; transition: all 0.2s;
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
        }
        .btn-retry:hover { background: #4338CA; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(79, 70, 229, 0.4); }
        .cached-hint { margin-top: 2rem; font-size: 0.875rem; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="offline-container">
        <div class="offline-icon">📡</div>
        <h1 class="offline-title">暂时无法连接网络</h1>
        <p class="offline-desc">
            您当前处于离线状态，该页面尚未缓存到本地。<br>
            请检查 Wi-Fi 或移动数据连接后重试。
        </p>
        <button class="btn-retry" onclick="window.location.reload()">🔄 重新加载</button>
        <p class="cached-hint">💡 部分已浏览的页面仍可离线查看</p>
    </div>
</body>
</html>
```

需要注意的是，这个离线页面本身也需要被预缓存（在 `PRECACHE_ASSETS` 中包含了 `/offline`），否则在真正的离线场景中它自己都无法加载。

## 五、Laravel 后端推送通知实现

### 5.1 生成与配置 VAPID 密钥

Web Push 通知的安全性依赖于 VAPID（Voluntary Application Server Identification）协议。VAPID 使用一对非对称密钥来验证推送消息的来源——服务器持有私钥用于签名消息，浏览器持有公钥用于验证。这确保了只有合法的服务器才能向用户发送推送通知。

首先使用 Node.js 的 `web-push` 工具生成密钥对：

```bash
npm install -g web-push
web-push generate-vapid-keys
```

生成后将密钥配置到 Laravel 项目的 `.env` 文件中：

```env
VAPID_PUBLIC_KEY=BLxqGHrXXXXXX_XXXXX_XXXXXXX_XXXXXXXXXXXXXXXXXXXXXXXXX
VAPID_PRIVATE_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VAPID_SUBJECT=mailto:admin@shopease.com
```

`VAPID_SUBJECT` 通常填写管理员邮箱或网站 URL，这是 VAPID 协议规范要求的联系信息。

### 5.2 安装 PHP Web Push 扩展包

Laravel 生态中有成熟的 Web Push 扩展包，省去了手动处理加密和签名的复杂逻辑：

```bash
composer require laravel-notification-channels/webpush
```

发布数据库迁移和配置文件：

```bash
php artisan vendor:publish --provider="NotificationChannels\WebPush\WebPushServiceProvider"
php artisan migrate
```

发布后会在 `config/webpush.php` 生成配置文件，将 VAPID 密钥注入其中：

```php
<?php

return [
    'vapid' => [
        'subject' => env('VAPID_SUBJECT'),
        'public_key' => env('VAPID_PUBLIC_KEY'),
        'private_key' => env('VAPID_PRIVATE_KEY'),
    ],
    'gcm' => [
        'key' => env('GCM_KEY'),
        'sender_id' => env('GCM_SENDER_ID'),
    ],
    'cache' => [
        'store' => 'database',  // 推送去重缓存使用数据库存储
    ],
];
```

执行迁移后会生成 `push_subscriptions` 表，它存储了每个用户在每个设备上的推送订阅信息，包括推送端点地址（endpoint）和加密密钥。

### 5.3 User 模型集成推送能力

在 User 模型中引入 `HasPushSubscriptions` trait，即可获得管理推送订阅的能力：

```php
<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use NotificationChannels\WebPush\HasPushSubscriptions;

class User extends Authenticatable
{
    use HasPushSubscriptions;

    /**
     * 向用户的所有已订阅设备发送 Web Push 通知
     * 包含自动清理无效订阅的逻辑
     */
    public function notifyWebPush(string $title, string $body, string $url = '/'): void
    {
        $payload = [
            'title'   => $title,
            'body'    => $body,
            'icon'    => '/icons/icon-192x192.png',
            'badge'   => '/icons/badge-72x72.png',
            'url'     => $url,
            'tag'     => 'shopease-' . uniqid(),
            'actions' => [
                ['action' => 'open', 'title' => '查看详情'],
                ['action' => 'dismiss', 'title' => '忽略'],
            ],
        ];

        $this->pushSubscriptions->each(function ($subscription) use ($payload) {
            try {
                $subscription->sendNotification(json_encode($payload));
            } catch (\Exception $e) {
                // 推送失败时检查是否因为订阅已过期（HTTP 410 Gone）
                if (str_contains($e->getMessage(), '410') ||
                    str_contains($e->getMessage(), 'unsubscribe')) {
                    // 订阅已失效，自动从数据库中清除
                    $subscription->delete();
                }
                \Log::warning('Web Push 发送失败', [
                    'user_id'  => $this->id,
                    'endpoint' => $subscription->endpoint,
                    'error'    => $e->getMessage(),
                ]);
            }
        });
    }
}
```

这里的自动清理逻辑非常重要。在实际运行中，用户可能会清除浏览器数据、更换设备或关闭通知权限，这些操作会导致之前的推送订阅失效。如果我们不主动清理这些无效订阅，每次发送通知时都会对已失效的端点发起请求，白白浪费资源并产生大量错误日志。

### 5.4 创建订阅管理 API 端点

前端需要通过 API 来管理推送订阅的创建和删除。以下是完整的控制器实现：

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PushSubscriptionController extends Controller
{
    /**
     * 保存浏览器的推送订阅信息
     * 前端在用户同意通知权限后调用此接口
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'endpoint'    => 'required|url',
            'keys.auth'   => 'required|string',
            'keys.p256dh' => 'required|string',
        ]);

        // updatePushSubscription 会自动处理"新建"和"更新"两种情况
        $request->user()->updatePushSubscription(
            $validated['endpoint'],
            $validated['keys']['p256dh'],
            $validated['keys']['auth'],
        );

        return response()->json(['message' => '推送订阅保存成功'], 201);
    }

    /**
     * 移除推送订阅（用户主动关闭通知时调用）
     */
    public function destroy(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'endpoint' => 'required|url',
        ]);

        $request->user()->pushSubscriptions()
            ->where('endpoint', $validated['endpoint'])
            ->delete();

        return response()->json(['message' => '推送订阅已移除']);
    }

    /**
     * 获取 VAPID 公钥（前端订阅时需要此公钥）
     */
    public function getPublicKey(): JsonResponse
    {
        return response()->json([
            'publicKey' => config('webpush.vapid.public_key'),
        ]);
    }
}
```

对应路由定义在 `routes/api.php` 中：

```php
<?php

use App\Http\Controllers\Api\PushSubscriptionController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/push-subscriptions', [PushSubscriptionController::class, 'store']);
    Route::delete('/push-subscriptions', [PushSubscriptionController::class, 'destroy']);
    Route::get('/push/vapid-public-key', [PushSubscriptionController::class, 'getPublicKey']);
});
```

### 5.5 创建业务通知类

以"订单发货"通知为例，展示如何创建一个同时支持数据库存储和 Web Push 推送的通知类：

```php
<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;
use NotificationChannels\WebPush\WebPushChannel;
use NotificationChannels\WebPush\WebPushMessage;

class OrderShippedNotification extends Notification
{
    use Queueable;

    public function __construct(
        private string $orderNo,
        private string $trackingCompany,
        private string $trackingNo
    ) {}

    /**
     * 定义通知渠道：同时走数据库（消息中心）和 Web Push（系统通知）
     */
    public function via($notifiable): array
    {
        return [
            'database',            // 存入数据库，在应用内消息中心展示
            WebPushChannel::class, // 通过 Web Push 推送到用户设备
        ];
    }

    /**
     * Web Push 推送的具体内容
     */
    public function toWebPush($notifiable, $notification): WebPushMessage
    {
        return (new WebPushMessage())
            ->title('🎉 您的订单已发货')
            ->body("订单 {$this->orderNo} 已由 {$this->trackingCompany} 发出，运单号：{$this->trackingNo}")
            ->icon('/icons/icon-192x192.png')
            ->badge('/icons/badge-72x72.png')
            ->image('/images/order-shipped-banner.png')
            ->tag("order-shipped-{$this->orderNo}")
            ->renotify(true)  // 相同 tag 的通知也会重新弹出
            ->options([
                'vibrate' => [200, 100, 200, 100, 200],
                'actions' => [
                    ['action' => 'open', 'title' => '查看物流'],
                    ['action' => 'dismiss', 'title' => '知道了'],
                ],
                'data' => [
                    'url' => "/orders/{$this->orderNo}/tracking",
                ],
            ]);
    }

    /**
     * 数据库存储格式（用于应用内消息中心展示）
     */
    public function toArray($notifiable): array
    {
        return [
            'type'     => 'order_shipped',
            'order_no' => $this->orderNo,
            'message'  => "订单 {$this->orderNo} 已发货",
            'tracking' => [
                'company' => $this->trackingCompany,
                'number'  => $this->trackingNo,
            ],
        ];
    }
}
```

在业务逻辑中触发通知非常简单：

```php
<?php

namespace App\Services;

use App\Models\Order;
use App\Notifications\OrderShippedNotification;

class ShippingService
{
    /**
     * 标记订单为已发货并推送通知
     */
    public function markAsShipped(Order $order, string $company, string $trackingNo): void
    {
        $order->update([
            'status'           => Order::STATUS_SHIPPED,
            'tracking_company' => $company,
            'tracking_number'  => $trackingNo,
            'shipped_at'       => now(),
        ]);

        // Laravel 的 notify() 方法会自动通过所有已注册的渠道发送通知
        $order->user->notify(
            new OrderShippedNotification($order->order_no, $company, $trackingNo)
        );
    }
}
```

### 5.6 队列化异步发送

Web Push 通知的发送需要与 Google FCM / Mozilla Autopush 等推送服务进行网络通信，在大规模场景下（如促销活动通知数万用户），同步发送会严重拖慢主业务流程。因此强烈建议使用 Laravel 队列异步发送：

```php
<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;
use NotificationChannels\WebPush\WebPushChannel;
use NotificationChannels\WebPush\WebPushMessage;

class OrderShippedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    // 最多重试 3 次，每次重试间隔递增
    public $tries = 3;
    public $backoff = [60, 300, 900];

    // ... 其余代码不变

    /**
     * 指定 Web Push 通知使用专用队列
     */
    public function viaQueues(): array
    {
        return [
            WebPushChannel::class => 'webpush',
        ];
    }
}
```

配合 Laravel Horizon 监控队列健康状态：

```bash
# 启动专用的 Web Push 队列 Worker
php artisan queue:work --queue=webpush --tries=3 --backoff=60
```

## 六、前端推送订阅集成

### 6.1 封装推送订阅管理器

为了保持代码的可维护性和可测试性，我们将推送订阅的完整逻辑封装为一个独立的 JavaScript 类：

```javascript
// resources/js/push-notifications.js

class PushNotificationManager {
    constructor(apiBaseUrl, vapidPublicKey) {
        this.apiBaseUrl = apiBaseUrl;
        this.vapidPublicKey = vapidPublicKey;
        this.registration = null;
    }

    /**
     * 初始化：确保 Service Worker 已就绪
     */
    async init() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('[Push] 当前浏览器不支持 Web Push 通知');
            return false;
        }

        try {
            this.registration = await navigator.serviceWorker.ready;
            return true;
        } catch (error) {
            console.error('[Push] Service Worker 未就绪:', error);
            return false;
        }
    }

    /**
     * 请求通知权限并创建推送订阅
     * 返回订阅对象或 null（用户拒绝/失败时）
     */
    async subscribe() {
        try {
            // 第一步：请求用户授权通知权限
            const permission = await Notification.requestPermission();

            if (permission !== 'granted') {
                console.warn('[Push] 用户拒绝了通知权限');
                this.showPermissionDeniedTip();
                return null;
            }

            // 第二步：检查是否已有订阅（避免重复订阅）
            let subscription = await this.registration.pushManager.getSubscription();

            // 第三步：没有订阅则创建新的
            if (!subscription) {
                subscription = await this.registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
                });
            }

            // 第四步：将订阅信息同步到 Laravel 后端保存
            await this.sendSubscriptionToServer(subscription);

            console.log('[Push] 推送订阅成功');
            return subscription;
        } catch (error) {
            console.error('[Push] 订阅流程失败:', error);
            return null;
        }
    }

    /**
     * 取消推送订阅
     */
    async unsubscribe() {
        const subscription = await this.registration.pushManager.getSubscription();
        if (subscription) {
            await this.removeSubscriptionFromServer(subscription);
            await subscription.unsubscribe();
            console.log('[Push] 已取消推送订阅');
        }
    }

    /**
     * 将订阅信息发送到 Laravel 后端
     */
    async sendSubscriptionToServer(subscription) {
        const token = document.querySelector('meta[name="api-token"]')?.content;

        const response = await fetch(`${this.apiBaseUrl}/push-subscriptions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content
            },
            body: JSON.stringify({
                endpoint: subscription.endpoint,
                keys: {
                    auth: this.arrayBufferToBase64(subscription.getKey('auth')),
                    p256dh: this.arrayBufferToBase64(subscription.getKey('p256dh'))
                }
            })
        });

        if (!response.ok) {
            throw new Error('订阅保存失败: ' + response.statusText);
        }
    }

    /**
     * 从后端移除订阅记录
     */
    async removeSubscriptionFromServer(subscription) {
        const token = document.querySelector('meta[name="api-token"]')?.content;

        await fetch(`${this.apiBaseUrl}/push-subscriptions`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content
            },
            body: JSON.stringify({ endpoint: subscription.endpoint })
        });
    }

    /**
     * 用户拒绝通知权限时的引导提示
     */
    showPermissionDeniedTip() {
        const tip = document.createElement('div');
        tip.innerHTML = `
            <div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
                        background:#1e293b;color:#fff;padding:16px 24px;border-radius:12px;
                        max-width:90vw;z-index:9999;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,0.2);">
                <p>🔔 通知权限已被关闭</p>
                <p style="font-size:12px;color:#94a3b8;margin-top:6px;">
                    请在浏览器地址栏左侧的锁形图标中手动开启通知权限
                </p>
            </div>
        `;
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 8000);
    }

    // ==============================
    // Base64 编解码工具方法
    // ==============================

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}

export default PushNotificationManager;
```

### 6.2 页面中集成使用

在 Laravel 的 ServiceProvider 中共享 VAPID 公钥到所有视图：

```php
<?php
// app/Providers/AppServiceProvider.php
public function boot(): void
{
    View::share('vapidPublicKey', config('webpush.vapid.public_key'));
}
```

在 Blade 布局中注入公钥并初始化推送管理器：

```html
<!-- resources/views/layouts/app.blade.php -->
<script>
    window.VAPID_PUBLIC_KEY = '{{ $vapidPublicKey }}';
</script>
```

```javascript
// resources/js/app.js
import PushNotificationManager from './push-notifications';

const pushManager = new PushNotificationManager('/api', window.VAPID_PUBLIC_KEY);

// 在用户点击"开启通知"按钮时触发（最佳实践：不在页面加载时自动弹权限）
document.getElementById('enable-push-btn')?.addEventListener('click', async () => {
    const initialized = await pushManager.init();
    if (initialized) {
        const subscription = await pushManager.subscribe();
        if (subscription) {
            showToast('✅ 通知已开启，您将及时收到订单状态更新');
        }
    }
});
```

**最佳实践提醒**：千万不要在页面首次加载时就自动调用 `Notification.requestPermission()`。浏览器通常会直接拒绝这种"冷启动"式的权限请求，而且一旦被拒绝，后续就很难再次弹出授权提示。正确的做法是在用户主动操作后（如下单成功、点击"开启通知"按钮）再请求权限，这时用户的接受率会显著提高。

## 七、使用 Workbox 简化 Service Worker 开发

### 7.1 为什么推荐 Workbox

前面手写的 Service Worker 虽然完全可控，但在实际项目维护中会面临几个痛点：缓存策略的样板代码重复度高、缓存过期管理容易遗漏、运行时缓存与预缓存的协调逻辑复杂。Google 出品的 Workbox 库正是为了解决这些问题而生的。它将 Service Worker 开发中的最佳实践封装为声明式 API，大幅降低了开发和维护成本。

### 7.2 使用 vite-plugin-pwa 集成

在 Laravel 10+ 默认使用 Vite 的项目中，推荐使用 `vite-plugin-pwa` 插件，它将 PWA 的所有配置都集成到了 Vite 构建流程中：

```bash
npm install vite-plugin-pwa --save-dev
```

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
        }),
        VitePWA({
            registerType: 'prompt',
            injectRegister: false,
            workbox: {
                // 自动预缓存构建产物中的所有静态资源
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
                // 运行时缓存规则
                runtimeCaching: [
                    {
                        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'google-fonts-stylesheets',
                            expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
                        }
                    },
                    {
                        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'google-fonts-webfonts',
                            expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
                            cacheableResponse: { statuses: [0, 200] }
                        }
                    },
                    {
                        urlPattern: /^https:\/\/cdn\.shopease\.com\/images\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'product-images',
                            expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }
                        }
                    },
                    {
                        urlPattern: /\/api\/products\/.*/i,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-products',
                            expiration: { maxEntries: 50, maxAgeSeconds: 60 * 30 },
                            networkTimeoutSeconds: 3
                        }
                    },
                    {
                        urlPattern: /\/api\/categories/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'api-categories',
                            expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 }
                        }
                    }
                ],
                navigateFallback: '/offline.html',
                navigateFallbackDenylist: [/^\/api\//, /^\/admin\//]
            },
            manifest: {
                name: 'ShopEase - 优质电商',
                short_name: 'ShopEase',
                description: 'ShopEase B2C 电商平台',
                theme_color: '#4F46E5',
                background_color: '#ffffff',
                display: 'standalone',
                start_url: '/',
                icons: [
                    { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' }
                ]
            }
        })
    ],
});
```

`vite-plugin-pwa` 的强大之处在于它会自动处理 Service Worker 的生成、版本管理和更新检测。`globPatterns` 配置让构建工具自动扫描产物目录中的所有匹配文件并写入预缓存清单，免去了手动维护预缓存列表的麻烦。

## 八、调试与验证

### 8.1 Lighthouse PWA 审计

Chrome Lighthouse 是验证 PWA 实现质量的权威工具。它会自动检查你的应用是否满足 PWA 的所有必要条件：

```bash
npx lighthouse https://shopease.com --only-categories=pwa --output=html --output-path=./pwa-report.html
```

PWA 审计的核心检查项包括：是否配置了 Web App Manifest、是否注册了 Service Worker、当前页面是否被 Service Worker 控制、是否通过 HTTPS 提供服务、是否设置了正确的 viewport meta 标签、图标尺寸是否满足最低要求（192x192 和 512x512）、`start_url` 是否返回 HTTP 200 等。只有全部通过才能获得"PWA 可安装"的认证。

### 8.2 Chrome DevTools 实用调试技巧

Chrome 浏览器的开发者工具提供了丰富的 PWA 调试功能：

- **Application → Service Workers 面板**：查看 Service Worker 的当前状态（安装中/激活中/运行中），点击"Update"强制检查更新，勾选"Offline"模拟离线环境
- **Application → Cache Storage 面板**：浏览所有缓存的内容，查看缓存大小和具体条目，手动删除缓存
- **Application → Push Messaging 面板**：输入自定义推送数据并模拟推送通知到达
- **Application → Manifest 面板**：检查 manifest.json 是否被正确解析，查看所有图标的加载状态
- **Network 面板勾选 Offline**：模拟完全断网环境，验证离线缓存策略是否按预期工作

## 九、常见踩坑与最佳实践

### 9.1 常见问题排查

**问题一：Service Worker 更新不生效**

这是最常见的困扰。浏览器会缓存 Service Worker 文件本身，导致新版本的 `sw.js` 不被及时拉取。解决方案是在 Nginx 层面为 `sw.js` 设置禁止缓存的 Header：

```nginx
# nginx.conf
location = /sw.js {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Service-Worker-Allowed "/";
}
```

**问题二：iOS Safari 兼容性**

iOS Safari 对 PWA 的支持至今仍有明显滞后：iOS 16.4 以上才开始支持 Web Push 通知；`display: standalone` 模式下不支持后台同步（Background Sync）；长时间后台运行的 Service Worker 可能被系统回收。因此在 iOS 端需要做好降级处理，不能完全依赖后台能力。

**问题三：CSP（内容安全策略）限制**

如果你的 Laravel 应用配置了严格的 Content Security Policy，需要确保 `worker-src` 指令允许加载 Service Worker 文件：

```php
// App\Http\Middleware\SetSecurityHeaders
public function handle($request, Closure $next)
{
    $response = $next($request);

    $response->headers->set('Content-Security-Policy',
        "default-src 'self'; " .
        "script-src 'self' 'unsafe-inline'; " .
        "worker-src 'self' blob:; " .
        "style-src 'self' 'unsafe-inline' fonts.googleapis.com; " .
        "font-src 'self' fonts.gstatic.com; " .
        "img-src 'self' data: cdn.shopease.com;"
    );

    return $response;
}
```

**问题四：混合内容（Mixed Content）阻断**

PWA 要求 HTTPS 环境。如果你的页面通过 HTTPS 加载，但 Service Worker 或 API 请求走了 HTTP，浏览器会直接拦截这些"混合内容"请求，导致 Service Worker 无法正常工作。在开发环境中可以使用 `localhost`（Chrome 对 localhost 有特殊豁免），但生产环境必须全站 HTTPS。

### 9.2 最佳实践清单

经过上文的详细讨论，最后总结出一份可直接落地的 PWA 最佳实践清单：

1. **版本化缓存名称**：在缓存名称中嵌入版本号（如 `static-v2.1.0`），每次发版后 Service Worker 自动清理旧缓存，避免用户卡在旧版本
2. **控制缓存容量**：为每个 Cache 设置合理的 `maxEntries` 上限，图片缓存建议 200 条，API 缓存建议 50 条，防止磁盘空间被耗尽
3. **优雅降级**：始终准备离线回退页面，任何缓存策略都应有"兜底方案"，绝不让用户看到浏览器原生的错误页面
4. **渐进增强**：PWA 功能应作为应用的增强层而非基础层。确保在不支持 Service Worker 的环境中应用的核心功能依然正常
5. **智能请求权限**：不要在页面加载时弹出通知授权对话框，而是在用户完成特定操作后（如下单成功、收藏商品）再请求，此时用户的接受意愿最高
6. **监控与清理**：在后端记录推送失败率，对于连续失败的订阅端点自动清除，保持推送系统的健康度
7. **CI/CD 集成**：使用 Lighthouse CI 在持续集成流程中自动执行 PWA 审计，确保每次部署都不会意外破坏 PWA 的关键指标
8. **SW 文件免缓存**：确保 `sw.js` 本身不被浏览器长时间缓存（设置 `Cache-Control: no-cache`），否则 Service Worker 的更新检测机制会失效

## 总结

PWA 是将传统 Web 应用升级为"准原生应用"的高性价比方案。对于 Laravel 开发者而言，改造成本远低于重新开发原生 App，却能获得离线可用、推送通知、添加到主屏幕等实实在在的用户体验提升。

本文以一个 B2C 电商应用为实战场景，完整覆盖了 PWA 改造的全部关键环节：manifest.json 实现应用可安装性，Service Worker 生命周期管理与版本更新机制，四种核心缓存策略（Cache First / Network First / Stale While Revalidate / Network Only）的选型与实现，Laravel Web Push 从 VAPID 配置、订阅管理到通知类开发的完整后端方案，前端推送订阅的封装与权限管理，以及 Workbox 工具链的集成。

核心理念可以浓缩为一句话：**对不变的资源大胆缓存，对变化的数据谨慎缓存，对关键的交互绝不缓存。** 掌握了这个原则，你就能为任何 Laravel Web 应用打造出媲美原生 App 的 PWA 体验。

> 💡 **行动建议**：不要试图一步到位。从你当前项目的一个页面开始，先加上 manifest.json 和一个最简单的 Service Worker 实现基础离线能力，确认 Lighthouse 通过 PWA 审计后再逐步迭代缓存策略和推送通知功能。PWA 的改造本身就是一个"渐进"的过程。

## 相关阅读

- [Web Push API VAPID 实战：浏览器原生推送通知 — Laravel 后端 Service Worker 注册、订阅管理与消息分发](/前端/Web-Push-API-VAPID-实战-浏览器原生推送通知-Laravel后端Service-Worker注册订阅管理与消息分发/) — 深入 Web Push 推送通知的 VAPID 协议细节、浏览器端订阅流程与 Laravel 后端消息分发实现，是本文推送通知章节的进阶补充。
- [Hotwire Turbo 实战：Ruby on Rails 前端哲学在 Laravel 中复用 — Livewire vs Turbo 渐进增强路线对比](/前端/Hotwire-Turbo-实战-Ruby-on-Rails前端哲学在Laravel中复用-Livewire-vs-Turbo渐进增强路线对比/) — 探索 Laravel 前端渐进增强的另一条技术路线，与 PWA 的渐进增强理念形成互补对照。
- [TanStack Query 实战：服务端状态管理 — 缓存策略、乐观更新与 Laravel API](/前端/TanStack-Query-React-Query-实战-服务端状态管理-缓存策略-乐观更新-Laravel-API/) — 前端数据缓存层的最佳实践，与 Service Worker 的离线缓存策略在架构思路上有诸多相通之处。
