---

title: 前端构建优化实战：Vite/Webpack 分包策略与缓存优化踩坑记录
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-17 07:15:07
updated: 2026-05-17 07:16:32
categories:
  - frontend
keywords: [Vite, Webpack, 前端构建优化实战, 分包策略与缓存优化踩坑记录]
tags:
- Vite
- Webpack
- 性能优化
- 前端构建
- 分包策略
- 缓存优化
- 首屏加载
- Tree-shaking
description: 前端构建优化实战指南，详解 Vite 分包（manualChunks vendor/ui/chart 三层策略）与 Webpack splitChunks cacheGroups 配置。真实项目首屏加载从 4.2s 优化到 1.1s，涵盖 HTTP 缓存策略（强缓存与协商缓存、Cache-Control、ETag）、CDN 资源 hash 策略（contenthash vs chunkhash vs hash）、动态 import 路由懒加载、Bundle Analyzer 体积分析、tree-shaking 优化及循环依赖踩坑、CSS 提取顺序问题等完整经验。
---




# 前端构建优化实战：Vite/Webpack 分包策略与缓存优化踩坑记录

## 为什么需要分包优化？

在 KKday B2C 项目中，前端 Vue 3 SPA 打包后单个 `index.js` 达到 2.8MB（gzip 后 680KB），首屏加载 4.2 秒。用户反馈「页面白屏太久」，Lighthouse Performance 评分只有 52 分。

问题根源：所有代码（Vue 全家桶 + 业务逻辑 + 第三方库）打成一个文件，浏览器必须下载完才能解析执行。每次发版后整个文件 hash 变化，CDN 缓存全部失效。

**优化目标**：
- 首屏加载 < 1.5s
- Lighthouse Performance > 85
- 依赖库变更不影响业务代码缓存

```
优化前                          优化后
┌─────────────┐               ┌─────────────┐
│  index.js   │               │  vendor.js  │ (Vue/Router/Pinia)
│   2.8 MB    │               │   680 KB    │ 缓存命中率 98%
│  (全量打包)  │               ├─────────────┤
│             │               │  lib.js     │ (Element Plus/ECharts)
│             │               │   520 KB    │ 缓存命中率 95%
│             │               ├─────────────┤
│             │               │  app.js     │ (业务逻辑)
│             │               │   180 KB    │ 频繁变更
│             │               ├─────────────┤
│             │               │  [async].js │ (路由懒加载)
│             │               │   各 30-80KB│ 按需加载
└─────────────┘               └─────────────┘
缓存命中率: 0%                  缓存命中率: 85%+
```

## 一、Vite 分包策略（manualChunks）

### 1.1 基础配置

Vite 底层用 Rollup，分包通过 `build.rollupOptions.output.manualChunks` 控制：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        // 方法一：函数式分包（灵活但难维护）
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Vue 全家桶单独打包
            if (id.includes('vue') || id.includes('vue-router') || id.includes('pinia')) {
              return 'vendor-vue'
            }
            // Element Plus 单独打包（体积大，独立缓存）
            if (id.includes('element-plus')) {
              return 'vendor-element'
            }
            // ECharts 单独打包
            if (id.includes('echarts')) {
              return 'vendor-echarts'
            }
            // 其他第三方库
            return 'vendor-other'
          }
        },
        // 文件名带 contenthash，内容不变则缓存命中
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    // 开启 CSS 代码分割
    cssCodeSplit: true,
    // 生产环境移除 console
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
})
```

### 1.2 踩坑：manualChunks 函数与对象配置的差异

Vite 5.x 开始推荐对象配置，但遇到一个坑：

```typescript
// ❌ 对象配置的坑：无法精确匹配嵌套依赖
manualChunks: {
  'vendor-vue': ['vue', 'vue-router', 'pinia'],
  'vendor-element': ['element-plus'],
}
```

问题：如果某个间接依赖（如 `@vue/runtime-core`）没在列表中，会被归入 `vendor-other`，导致 Vue 运行时被拆成两份，反而增加了请求数。

**解决方案**：用函数式配置 + `id.includes` 做模糊匹配，确保所有子包都被正确归类。

### 1.3 进阶：路由级懒加载

```typescript
// router/index.ts
const routes = [
  {
    path: '/',
    component: () => import(/* webpackChunkName: "home" */ '@/views/Home.vue'),
  },
  {
    path: '/product/:id',
    component: () => import(/* webpackChunkName: "product" */ '@/views/Product.vue'),
  },
  {
    // 管理后台：登录用户才需要，完全独立 chunk
    path: '/admin',
    component: () => import(/* webpackChunkName: "admin" */ '@/views/Admin.vue'),
    meta: { requiresAuth: true },
  },
  {
    // 支付页面：低频访问，独立 chunk
    path: '/checkout',
    component: () => import(/* webpackChunkName: "checkout" */ '@/views/Checkout.vue'),
  },
]
```

路由懒加载后，首屏只需要加载 `vendor-vue` + `vendor-element` + `app`（首页业务），其他页面按需加载。

### 1.4 进阶：vendor / UI / Chart 三层分包策略

对于大型项目，仅按 "Vue 全家桶" 和 "其他" 两层分包远远不够。实际项目中，UI 组件库和图表库往往是体积大户，需要更精细的分层策略：

```typescript
// vite.config.ts — 三层分包策略（vendor / UI / chart）
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          // 第一层：Vue 核心（变更频率最低，缓存价值最高）
          if (/vue|vue-router|pinia|@vue/.test(id)) {
            return 'vendor-vue'
          }

          // 第二层：UI 组件库（大体积，独立缓存）
          if (/element-plus|@element-plus/.test(id)) {
            return 'vendor-ui'
          }

          // 第三层：图表 / 富文本等大库（按页面按需加载）
          if (/echarts|zrender|wangeditor|quill/.test(id)) {
            return 'vendor-chart'
          }

          // 工具库（axios/dayjs/lodash-es 等小库合并打包）
          if (/axios|dayjs|lodash|qs|nprogress|js-cookie/.test(id)) {
            return 'vendor-utils'
          }

          // 剩余 node_modules（保底分包）
          return 'vendor-misc'
        },
      },
    },
  },
})
```

**分包体积预期与缓存策略**：

```
Chunk 名称          | 预估体积 (gzip) | 变更频率     | 缓存策略
-------------------|----------------|------------|------------------
vendor-vue         | 60 KB          | 极低 (半年) | 长期缓存 (immutable)
vendor-ui          | 280 KB         | 低 (季度)   | 长期缓存 (immutable)
vendor-chart       | 260 KB         | 低          | 路由懒加载，首屏不加载
vendor-utils       | 35 KB          | 中          | 中期缓存 (30天)
vendor-misc        | 20 KB          | 中          | 中期缓存 (30天)
app (业务代码)      | 150 KB         | 高 (每日)   | 短期缓存 + HTML no-cache
```

> **经验法则**：变更频率越低的包，缓存时间越长；体积越大的包，越要独立分包以避免影响其他包的 hash。将 ECharts 等大库从首屏 chunk 中剥离，改为路由懒加载后，首屏传输体积可直接减少 260KB+。

### 1.5 Vite 动态 import() 高级模式

除了基本的路由懒加载，Vue Router 还支持更精细的分组策略：

```typescript
// router/index.ts — 按功能模块分组懒加载
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    // 首页直接加载（用户第一个访问的页面）
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/product/:id',
    // 商品详情页：同 chunk 名的路由会合并打包
    component: () => import(/* webpackChunkName: "product" */ '@/views/Product.vue'),
    children: [
      {
        path: 'reviews',
        // 子路由与父路由共享 chunk
        component: () => import(/* webpackChunkName: "product" */ '@/views/ProductReviews.vue'),
      },
      {
        path: 'specs',
        component: () => import(/* webpackChunkName: "product" */ '@/views/ProductSpecs.vue'),
      },
    ],
  },
  {
    // 管理后台：独立 chunk，只有登录用户才触发加载
    path: '/admin',
    component: () => import(/* webpackChunkName: "admin" */ '@/views/Admin.vue'),
    meta: { requiresAuth: true },
  },
  {
    // 支付流程：独立 chunk，低频访问
    path: '/checkout',
    component: () => import(/* webpackChunkName: "checkout" */ '@/views/Checkout.vue'),
  },
  {
    // 用户中心：需要登录，按需加载
    path: '/user',
    component: () => import(/* webpackChunkName: "user" */ '@/views/UserCenter.vue'),
    meta: { requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由预加载：鼠标悬停时提前加载目标页面 chunk
router.beforeResolve(async (to) => {
  // 可结合 Quicklink / Guess.js 实现智能预加载
})
```

> **注意**：Vite 中 `/* webpackChunkName */` 注释仍然有效（Rollup 会识别），但推荐用 `output.manualChunks` 函数来统一管理分包策略，避免注释分散难以维护。

## 二、Webpack 分包策略（splitChunks）

对于老项目仍在用 Webpack（Laravel Mix），`optimization.splitChunks` 是核心配置：

```javascript
// webpack.mix.js
const mix = require('laravel-mix')

mix.webpackConfig({
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        // Vue 全家桶
        vendorVue: {
          test: /[\\/]node_modules[\\/](vue|vue-router|pinia)[\\/]/,
          name: 'vendor-vue',
          priority: 30,
          reuseExistingChunk: true,
        },
        // Element Plus
        vendorElement: {
          test: /[\\/]node_modules[\\/]element-plus[\\/]/,
          name: 'vendor-element',
          priority: 25,
          reuseExistingChunk: true,
        },
        // 其他第三方库（体积 > 20KB 才独立分包）
        vendorCommon: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor-common',
          minSize: 20000,
          priority: 10,
          reuseExistingChunk: true,
        },
        // 公共业务模块（被 2 个以上 chunk 引用）
        common: {
          name: 'app-common',
          minChunks: 2,
          priority: 5,
          reuseExistingChunk: true,
        },
      },
    },
    // 运行时代码独立（防止业务代码变更影响 vendor hash）
    runtimeChunk: 'single',
  },
})
```

### 踩坑：minSize 设置不当导致分包失效

```javascript
// ❌ minSize 默认 20000 (20KB)，很多工具库不到这个体积
splitChunks: {
  chunks: 'all',
  // 不设置 minSize → 默认 20KB
}

// ✅ 降低阈值，让更多小依赖被拆出来
splitChunks: {
  chunks: 'all',
  minSize: 5000,  // 5KB 以上的依赖就独立分包
}
```

另一个常见错误：`chunks: 'async'` 只分割异步 chunk，同步 import 的库不会被分包。必须用 `'all'`。

### 2.2 Webpack cacheGroups 策略对比

不同的 cacheGroups 配置策略适用于不同的项目规模：

```javascript
// webpack.mix.js — 三种分包策略对比

// 【策略一】极简分包（小型项目 < 100KB 第三方依赖）
mix.webpackConfig({
  optimization: {
    splitChunks: {
      chunks: 'all',
      // 只做一层：所有 node_modules 合并为 vendor
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          chunks: 'all',
        },
      },
    },
  },
})

// 【策略二】按库分包（中型项目，100KB ~ 1MB 第三方依赖）
mix.webpackConfig({
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendorVue: {
          test: /[\\/]node_modules[\\/](vue|vue-router|pinia)[\\/]/,
          name: 'vendor-vue',
          priority: 30,
        },
        vendorUI: {
          test: /[\\/]node_modules[\\/]element-plus[\\/]/,
          name: 'vendor-ui',
          priority: 25,
        },
        vendorOther: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor-common',
          minSize: 20000,
          priority: 10,
        },
      },
    },
    runtimeChunk: 'single',
  },
})

// 【策略三】精细分包（大型项目 > 1MB 第三方依赖，推荐）
mix.webpackConfig({
  optimization: {
    splitChunks: {
      chunks: 'all',
      maxInitialRequests: 25,     // 首屏最大并行请求数（默认 25）
      maxAsyncRequests: 25,       // 异步最大并行请求数
      cacheGroups: {
        // Vue 核心：最小变更频率
        vendorVue: {
          test: /[\\/]node_modules[\\/](vue|vue-router|pinia|@vue[\\/]runtime)/,
          name: 'vendor-vue',
          priority: 40,
          reuseExistingChunk: true,
        },
        // UI 组件库：独立分包
        vendorElement: {
          test: /[\\/]node_modules[\\/](@element-plus|element-plus)[\\/]/,
          name: 'vendor-ui',
          priority: 35,
          reuseExistingChunk: true,
        },
        // 图表库：路由懒加载
        vendorChart: {
          test: /[\\/]node_modules[\\/](echarts|zrender)[\\/]/,
          name: 'vendor-chart',
          priority: 30,
          reuseExistingChunk: true,
        },
        // 工具库合并
        vendorUtils: {
          test: /[\\/]node_modules[\\/](axios|dayjs|lodash|qs)[\\/]/,
          name: 'vendor-utils',
          priority: 25,
          reuseExistingChunk: true,
        },
        // 剩余 node_modules
        vendorCommon: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor-misc',
          minSize: 5000,
          priority: 10,
          reuseExistingChunk: true,
        },
        // 公共业务模块（被 2+ chunk 引用才提取）
        common: {
          name: 'app-common',
          minChunks: 2,
          priority: 5,
          reuseExistingChunk: true,
        },
      },
    },
    runtimeChunk: 'single',
  },
})
```

**三种策略对比**：

```
策略     | 适用场景        | 请求数 | 缓存命中率 | 维护成本
--------|---------------|-------|----------|--------
极简    | < 100KB 依赖   | 低    | 低        | 极低
按库    | 100KB ~ 1MB   | 中    | 中        | 低
精细    | > 1MB 大型项目  | 高    | 高        | 中
```

> **注意**：`maxInitialRequests` 默认 25，不要设太小，否则打包工具会把本该独立的 chunk 合并回去。也不要设太大（> 30），过多的 HTTP 请求在 HTTP/1.1 下会有队头阻塞问题。HTTP/2 多路复用下可以适当放宽。

## 三、Content Hash 与缓存策略

### 3.1 Hash 策略对比

```
Hash 类型        | 变化时机               | 缓存友好度
----------------|----------------------|----------
hash            | 任何文件变更，全部 hash 变 | ❌ 最差
chunkhash       | 同一 chunk 内容变更      | ⚠️ 一般
contenthash     | 仅当文件内容实际变更      | ✅ 最佳
```

**关键配置**：必须用 `contenthash`，否则一个文件的修改会导致所有文件 hash 变化。

```typescript
// Vite (默认就是 contenthash)
output: {
  chunkFileNames: 'assets/js/[name]-[contenthash].js',
  entryFileNames: 'assets/js/[name]-[contenthash].js',
  assetFileNames: 'assets/[ext]/[name]-[contenthash].[ext]',
}
```

```javascript
// Webpack — 配置 contenthash
output: {
  filename: 'assets/js/[name]-[contenthash:8].js',
  chunkFilename: 'assets/js/[name]-[contenthash:8].js',
},
```

**三种 hash 的底层区别**：

```
hash 类型      | 计算来源                      | 粒度        | 适用场景
-------------|------------------------------|------------|------------------
[hash]       | 整个构建过程的所有文件内容         | 构建级别    | ❌ 不推荐（任何文件变，全部变）
[chunkhash]  | 该 chunk 内所有模块的内容         | Chunk 级别  | ⚠️ Webpack 专用，CSS 提取时可能失效
[contenthash] | 当前文件的实际内容               | 文件级别    | ✅ 推荐（最精确的缓存控制）
```

**实际场景举例**：

```
修改了 utils/format.ts（属于 app chunk）

使用 hash：
  vendor-vue-abc123.js    → vendor-vue-xyz789.js  ❌ 没变但 hash 变了
  vendor-ui-def456.js     → vendor-ui-uvw012.js   ❌ 没变但 hash 变了
  app-ghi789.js           → app-rst345.js         ✅ 确实变了

使用 contenthash：
  vendor-vue-abc123.js    → vendor-vue-abc123.js  ✅ 未变，缓存命中
  vendor-ui-def456.js     → vendor-ui-def456.js   ✅ 未变，缓存命中
  app-ghi789.js           → app-rst345.js         ✅ 确实变了
```

> **踩坑提醒**：Webpack 中如果使用 `MiniCssExtractPlugin` 提取 CSS，CSS 文件的 chunkhash 可能因 JS 变化而失效（因为 CSS 提取会修改 JS chunk 的内容）。务必使用 `contenthash` 而非 `chunkhash`。

### 3.2 踩坑：runtimeChunk 不独立导致 vendor hash 失效

Webpack 的坑：如果不提取 runtime，业务代码的任何修改都会导致 vendor 的 chunkhash 变化。

```javascript
// ❌ 不提取 runtime
optimization: {
  runtimeChunk: false,
  // 业务代码变了 → vendor hash 也变了 → CDN 缓存全失效
}

// ✅ runtime 独立
optimization: {
  runtimeChunk: 'single',
  // 业务代码变了 → 只有 app + runtime 的 hash 变 → vendor 缓存命中
}
```

Vite 没有 `runtimeChunk` 概念，它通过 `module` 预加载天然做到了这一点。

## 四、Nginx 缓存配置

分包完成后，配合 Nginx 的缓存策略才能发挥最大效果：

```nginx
server {
    listen 443 ssl http2;
    server_name frontend.example.com;

    root /var/www/frontend/dist;
    index index.html;

    # HTML 文件：不缓存（每次获取最新版本入口）
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    # 静态资源：长期缓存（文件名有 contenthash）
    location /assets/ {
        # contenthash 保证内容变化时文件名也变，可以激进缓存
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    # 图片资源
    location ~* \.(png|jpg|jpeg|gif|svg|webp|avif)$ {
        add_header Cache-Control "public, max-age=2592000";
        access_log off;
        try_files $uri $uri/ =404;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 踩坑：immutable 的使用场景

```nginx
# ❌ 普通文件不要加 immutable（可能有 hotfix 场景需要强制更新）
add_header Cache-Control "public, max-age=31536000, immutable";

# ✅ 只有 contenthash 文件才加 immutable
# /assets/app-a1b2c3d4.js → immutable 安全
# /assets/logo.png → 不能用 immutable（文件名没 hash）
```

## 五、HTTP 缓存策略详解

分包和 Nginx 配置只是基础设施，理解 HTTP 缓存机制才能做出正确的缓存决策。

### 5.1 强缓存 vs 协商缓存

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器请求资源                          │
│                        │                                 │
│              ┌─────────▼──────────┐                     │
│              │  检查强缓存         │                     │
│              │  (Cache-Control    │                     │
│              │   / Expires)       │                     │
│              └────┬───────────┬───┘                     │
│            命中 ✓ │           │ 未命中 ✗                 │
│       ┌───────────▼──┐  ┌────▼──────────┐              │
│       │ 直接使用缓存   │  │ 发起协商缓存请求 │              │
│       │ 无需请求服务器  │  │ 携带验证头信息   │              │
│       │ 状态码 200     │  └────┬──────────┘              │
│       │ (from cache)  │       │                          │
│       └───────────────┘  ┌────▼──────────┐              │
│                     ┌────┤ 资源未变化？    │              │
│                 是 ✓│    └───────────────┘              │
│          ┌──────────▼──┐        │ 否 ✗                  │
│          │ 304 Not      │  ┌────▼──────────┐            │
│          │ Modified     │  │ 200 OK        │            │
│          │ 使用缓存      │  │ 返回新资源     │            │
│          │ （无 body）   │  │ 携带新缓存头   │            │
│          └─────────────┘  └───────────────┘            │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Cache-Control 指令速查表

```
指令                 | 含义                         | 适用场景
--------------------|------------------------------|------------------
max-age=秒数        | 强缓存有效期                   | 所有需要缓存的资源
no-cache            | 每次使用前必须向服务器验证        | HTML 入口文件
no-store            | 完全不缓存，不存磁盘            | 敏感数据、API 响应
public              | 允许 CDN 等中间节点缓存          | 静态资源
private             | 仅允许浏览器缓存（CDN 不缓存）    | 用户个人数据
immutable           | 资源永不变，跳过 304 验证        | contenthash 文件
must-revalidate     | 缓存过期后必须向服务器验证        | API 响应、时效性数据
s-maxage=秒数       | CDN 节点缓存时间（覆盖 max-age）| 使用 CDN 的场景
stale-while-revalidate=秒数 | 过期后仍可使用，同时后台验证 | 提升用户体验
```

### 5.3 协商缓存的两种验证机制

```
验证方式          | 请求头               | 响应头             | 对比内容
----------------|---------------------|-------------------|------------------
ETag            | If-None-Match       | ETag              | 文件内容 hash
Last-Modified   | If-Modified-Since   | Last-Modified     | 文件修改时间
```

**ETag（推荐，优先级更高）**：
- 服务器返回资源的唯一标识（通常是内容的 hash 值）
- 浏览器下次请求时携带 `If-None-Match: "abc123"`
- 服务器对比 ETag，相同则返回 `304 Not Modified`（无 body，极小响应）
- **优势**：精确到内容级别，不受时间精度限制

**Last-Modified（备选方案）**：
- 服务器返回资源最后修改时间
- 浏览器下次请求携带 `If-Modified-Since: Thu, 01 Jan 2026 00:00:00 GMT`
- **劣势**：精度只到秒，1 秒内多次修改无法区分；文件内容未变但 touch 时间变了会产生误判

### 5.4 前端项目的缓存策略最佳实践

```
资源类型           | 策略                    | Cache-Control 值
-----------------|------------------------|----------------------------------
HTML 入口         | 不缓存 + 每次验证        | no-cache, must-revalidate
contenthash JS   | 强缓存 1 年 + immutable | max-age=31536000, immutable
contenthash CSS  | 强缓存 1 年 + immutable | max-age=31536000, immutable
无 hash 的图片     | 强缓存 30 天            | max-age=2592000
API 接口          | 完全不缓存              | no-store
字体文件          | 强缓存 1 年             | max-age=31536000
```

> **核心原则**：HTML 是所有资源的入口，绝对不能强缓存。用户每次访问都必须获取最新的 `index.html`，而 HTML 中引用的带 contenthash 的资源文件名本身就是缓存 key——内容变了，文件名变了，自然会请求新文件。

## 六、CDN 加速配置

### 6.1 Vite CDN 配置

```typescript
// vite.config.ts
export default defineConfig({
  base: 'https://cdn.example.com/frontend/',
  build: {
    rollupOptions: {
      output: {
        // 文件路径自动加上 CDN 前缀
        // /assets/app-a1b2c3d4.js → https://cdn.example.com/frontend/assets/app-a1b2c3d4.js
      },
    },
  },
})
```

### 6.2 外部化大依赖（CDN 引入）

对于特别大的库（如 ECharts、moment.js），可以直接通过 CDN `<script>` 引入，构建时排除：

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['echarts'],
      output: {
        globals: {
          echarts: 'echarts',
        },
      },
    },
  },
})
```

```html
<!-- index.html -->
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
```

**踩坑**：外部化后，开发环境需要 Mock 这些全局变量，否则本地调试会报错：

```typescript
// vite.config.ts — 开发环境不外部化
export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      external: mode === 'production' ? ['echarts'] : [],
    },
  },
}))
```

## 七、Bundle 分析与 Tree-shaking 优化

### 7.1 Vite Bundle 分析

```bash
# 安装分析工具
npm i -D rollup-plugin-visualizer

# vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    vue(),
    visualizer({
      open: true,
      filename: 'bundle-analysis.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
})
```

### 7.2 Webpack Bundle 分析

```bash
npm i -D webpack-bundle-analyzer

# webpack.mix.js
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

mix.webpackConfig({
  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      reportFilename: 'bundle-report.html',
      openAnalyzer: false,
    }),
  ],
})
```

### 7.3 实际分析结果（B2C 项目）

```
文件                    | 未压缩  | gzip   | 用途
----------------------|--------|--------|------------------
vendor-vue-[hash].js  | 180 KB | 58 KB  | Vue/Router/Pinia
vendor-element-[hash] | 920 KB | 280 KB | Element Plus
vendor-echarts-[hash] | 820 KB | 260 KB | ECharts（仅商品详情页用）
app-[hash].js         | 180 KB | 52 KB  | 业务逻辑
vendor-common-[hash]  | 95 KB  | 32 KB  | axios/dayjs/lodash-es
runtime-[hash].js     | 2 KB   | 1 KB   | Webpack 运行时
```

**发现**：ECharts 820KB 但只有商品详情页用，改为路由懒加载后首屏体积直接减少 260KB（gzip）。

### 7.4 Tree-shaking 优化实战

Tree-shaking 是打包工具在生产构建时，通过静态分析 ES Module 的 `import`/`export`，移除未使用代码（Dead Code）的优化技术。

```
源码：                          打包后：
import { debounce }  ─┐        ┌──────────────────────┐
from 'lodash-es'     │        │ 只保留 debounce       │
                     ├────────│ 的实现代码             │
import { throttle }  │        │ (~500 bytes)          │
from 'lodash-es'     │        └──────────────────────┘
                     │
// 只用了 debounce    ┘        throttle 的代码被 tree-shake 掉
```

**Tree-shaking 生效的前提条件**：

1. **必须使用 ES Module**（`import`/`export`），CommonJS（`require`）无法 tree-shake
2. **package.json 中设置 `"sideEffects": false`**，或列出有副作用的文件
3. **避免整体引入**，如 `import _ from 'lodash'` 会引入所有方法，应改为 `import { debounce } from 'lodash-es'`

```json
// package.json — 声明无副作用，允许 tree-shaking
{
  "sideEffects": [
    "*.css",
    "*.vue",
    "./src/polyfills.ts"
  ]
}
```

## 八、常见踩坑与解决方案

### 8.1 循环依赖导致 Tree-shaking 失效

循环依赖是 tree-shaking 失效的头号杀手。当打包工具检测到循环依赖时，无法确定模块执行顺序，会放弃 tree-shaking 将整个模块全部打包：

```typescript
// ❌ 循环依赖示例
// utils/format.ts
import { parseDate } from './date'    // → 引入 date.ts

// utils/date.ts
import { formatDate } from './format'  // → 又引入 format.ts
// 形成循环：format → date → format
// 结果：两个模块的所有导出都被打包，tree-shaking 完全失效
```

**检测循环依赖**：

```bash
# 使用 madge 扫描项目中的循环依赖
npx madge --circular --extensions ts,tsx src/

# 输出示例：
# ✖ Found 2 circular dependencies!
# 1) utils/format.ts → utils/date.ts → utils/format.ts
# 2) services/api.ts → services/auth.ts → services/api.ts
```

**解决方案**：

```typescript
// ✅ 方案一：提取公共模块，打破循环
// utils/common.ts — 抽出共用的低级函数
export function rawParseDate(str: string): Date { /* ... */ }
export function rawFormatDate(d: Date): string { /* ... */ }

// utils/format.ts — 只依赖 common，不依赖 date
import { rawParseDate } from './common'
export function formatDate(d: Date): string { /* ... */ }

// utils/date.ts — 只依赖 common，不依赖 format
import { rawFormatDate } from './common'
export function parseDate(str: string): Date { /* ... */ }
// 循环依赖消除 ✅，tree-shaking 恢复生效
```

```typescript
// ✅ 方案二：延迟导入（适合无法重构的场景）
// utils/date.ts
export function parseDate(str: string): Date {
  // 延迟导入，避免模块加载时的循环
  const { formatDate } = require('./format')
  // ...
}
```

### 8.2 CSS 提取顺序问题

使用 `MiniCssExtractPlugin`（Webpack）或 Vite 内置 CSS 提取时，CSS 的加载顺序可能与源码编写顺序不一致：

```css
/* ❌ 实际加载顺序可能与源码顺序不同 */
/* vendor-element.css 先加载 */
.el-button { color: #409eff; }
/* app.css 后加载 — 但选择器权重不够，覆盖失败 */
.my-button { color: #ff0000; }  /* 不生效！因为 .el-button 优先级更高 */
```

**根本原因**：Webpack 的 `splitChunks` 会将 CSS 提取到不同的 chunk 中，chunk 的加载顺序取决于 `import` 的顺序和网络条件，不一定与源码书写顺序一致。

**解决方案**：

```javascript
// webpack.config.js — 确保 CSS 提取顺序
optimization: {
  splitChunks: {
    cacheGroups: {
      styles: {
        name: 'styles',
        test: /\.css$/,
        chunks: 'all',
        enforce: true,  // 即使小于 minSize 也要提取，保证顺序可控
      },
    },
  },
}

// 在入口文件中显式控制 CSS import 顺序：
// main.ts
import 'element-plus/dist/index.css'  // ① 先导入第三方样式
import './styles/reset.css'            // ② 再导入重置样式
import './styles/global.css'           // ③ 然后全局样式
import './styles/components.css'       // ④ 最后组件样式（可覆盖前面的）
```

**Vite 中的处理**：

```typescript
// vite.config.ts — Vite 的 CSS 处理配置
export default defineConfig({
  css: {
    // CSS 预处理器配置
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables" as *;`,
      },
    },
  },
})
```

> **最佳实践**：如果项目中大量使用组件库的样式覆盖，建议用 CSS 变量方案替代选择器权重覆盖，从根本上避免顺序问题：
>
> ```css
> /* 用 CSS 变量覆盖组件库主题，不依赖加载顺序 */
> :root {
>   --el-color-primary: #ff0000;
>   --el-border-radius-base: 4px;
> }
> ```

## 九、优化结果

### 9.1 核心指标对比

```
指标                    | 优化前   | 优化后   | 提升幅度 | 说明
----------------------|---------|---------|--------|------------------
首屏 JS 体积            | 2.8 MB  | 380 KB  | -86%   | 分包 + 懒加载
首屏加载时间 (3G)        | 4.2s    | 1.1s    | -74%   | 从白屏到可交互
首次内容绘制 (FCP)       | 3.1s    | 0.8s    | -74%   | 首屏首个元素渲染
最大内容绘制 (LCP)       | 4.0s    | 1.0s    | -75%   | 首屏最大元素渲染
可交互时间 (TTI)         | 5.2s    | 1.3s    | -75%   | 页面完全可交互
累积布局偏移 (CLS)       | 0.12    | 0.02    | -83%   | 布局稳定性
Lighthouse Performance | 52      | 89      | +71%   | 综合性能评分
CDN 缓存命中率           | 0%      | 85%     | +85%   | 二次访问命中
二次访问加载时间          | 4.2s    | 0.4s    | -90%   | 强缓存命中
首次访问请求数           | 1       | 6       | +5     | 分包后请求增多但总传输更少
```

### 9.2 构建速度对比（Webpack vs Vite）

```
指标                  | Webpack 5  | Vite 5    | 提升
--------------------|-----------|----------|------
冷启动开发服务器       | 28s       | 1.2s     | -96%
HMR 热更新            | 2.5s      | 50ms     | -98%
生产构建              | 45s       | 18s      | -60%
```

### 9.3 分包后各 Chunk 体积明细

```
Chunk              | 体积 (gzip) | 首屏加载 | 说明
------------------|------------|---------|------------------
vendor-vue        | 58 KB      | ✅ 必须  | Vue 核心，几乎不变
vendor-ui         | 280 KB     | ✅ 首页用 | Element Plus
vendor-chart      | 260 KB     | ❌ 懒加载 | ECharts，仅详情页
vendor-utils      | 32 KB      | ✅ 首页用 | axios/dayjs 等
vendor-misc       | 20 KB      | ✅ 杂项   | 零散依赖
app               | 52 KB      | ✅ 首页用 | 业务逻辑
runtime           | 1 KB       | ✅ 必须  | Webpack 运行时
```

## 总结

1. **分包核心原则**：第三方库与业务代码分离，大库独立分包，利用 contenthash 实现长期缓存
2. **Vite 用函数式 manualChunks**，Webpack 用 splitChunks + runtimeChunk: 'single'
3. **HTML 不缓存，静态资源激进缓存**（immutable），这是前后端分离项目的标准模式
4. **CDN + 路由懒加载**是体积优化的两个最大杠杆
5. **用 Bundle Analyzer 定期审计**，防止新的大依赖悄悄混入

分包不是一次性工作。每次新增依赖、升级版本时都应该跑一次 bundle 分析，确认体积没有恶化。

---

## 相关阅读

- [Vite vs Webpack vs Laravel Mix：前端构建工具选型指南](/post/vite-vs-webpack-laravel-mix-vs/) — 三种构建工具的全面对比，帮你选择最适合项目的方案
- [Vite + Laravel 实战：从零搭建现代化前端工作流](/post/vite-laravel-guide/) — Vite 与 Laravel 深度整合的完整教程
- [Laravel Mix 与 Webpack 优化：Node.js 构建性能调优](/post/laravel-mix-node-js-webpack-optimization/) — Laravel Mix 项目中 Webpack 构建速度与产出体积的优化技巧
- [Vue 3 + TypeScript 完全指南](/post/vue-3-typescript-guide/) — Vue 3 项目中 TypeScript 的最佳实践，与构建优化配合使用效果更佳
