---

title: Vue-3-Vite-实战-HMR-构建优化与环境变量管理-Laravel-B2C-API前后端分离踩坑记录
keywords: [Vue, Vite, HMR, Laravel, B2C, API, 构建优化与环境变量管理, 前后端分离踩坑记录]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-17 00:40:43
updated: 2026-05-17 00:46:16
categories:
- frontend
tags:
- Vue
- Vite
- Laravel
- 前端
- 构建优化
- HMR
- DevOps
description: 本文基于 Laravel B2C 前后端分离项目实战，全面讲解 Vue 3 与 Vite 的 HMR 热更新原理与故障排查方法， 深入剖析 Vite 构建优化策略（Manual Chunks 分包、Tree-shaking、Gzip/Brotli 压缩、依赖预构建调优）， 涵盖 TypeScript 类型安全的环境变量管理、Nginx 生产部署配置及 GitHub Actions CI/CD 集成， 提供 8 个高频踩坑记录与解决方案，帮助前端开发者掌握 Vite 工程化最佳实践，显著提升前端构建性能与开发体验。
---


# Vue 3 + Vite 实战：HMR、构建优化与环境变量管理

## 前言

在 KKday B2C Backend Team 的日常开发中，前端项目从 Webpack（Laravel Mix）迁移到 Vite 已经成为趋势。Vite 基于 ESBuild 的极速冷启动和原生 ESM 的 HMR 体验，让开发效率有了质的飞跃——但迁移过程中踩的坑也不少。

本文基于 30+ 仓库的实战经验，从 **HMR 原理与故障排查**、**构建产物优化**、**环境变量管理** 三个维度，分享 Vue 3 + Vite 在 Laravel BFF 架构下的工程化最佳实践。

## 一、架构总览

```
┌─────────────────────────────────────────────────┐
│                   Nginx / CDN                    │
│         (静态资源 + API 反向代理)                  │
├──────────────────┬──────────────────────────────┤
│   Vue 3 + Vite   │     Laravel BFF API          │
│   (前端 SPA)      │     (PHP-FPM 8.0)            │
│                  │                              │
│  ┌────────────┐  │  ┌────────────────────────┐  │
│  │  dist/     │  │  │  Service Layer         │  │
│  │  assets/   │──│──│  → Search Service      │  │
│  │  index.html│  │  │  → Member Service      │  │
│  └────────────┘  │  │  → Recommend Service   │  │
│                  │  └────────────────────────┘  │
│  开发环境:        │                              │
│  localhost:5173   │  localhost:8000              │
│  (Vite Dev Server)│  (Artisan Serve)            │
└──────────────────┴──────────────────────────────┘
```

## 二、项目初始化与 Vite 配置

### 2.1 创建 Vue 3 + Vite 项目

```bash
# 使用 create-vue 脚手架（推荐，而非已废弃的 vue-cli）
npm create vue@latest my-b2c-frontend
# 选择: TypeScript ✓, Vue Router ✓, Pinia ✓, Vitest ✓, ESLint ✓

cd my-b2c-frontend
npm install
```

### 2.2 基础 vite.config.ts 配置

```typescript
// vite.config.ts
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  // 加载对应模式的环境变量
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [vue()],

    // 路径别名 —— 和 Laravel 的 @ 别名保持一致
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@components': resolve(__dirname, 'src/components'),
        '@stores': resolve(__dirname, 'src/stores'),
        '@utils': resolve(__dirname, 'src/utils'),
      },
    },

    // 开发服务器配置
    server: {
      port: 5173,
      // 代理 Laravel BFF API
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8000',
          changeOrigin: true,
          // 如果后端有版本前缀: /api/v2_1/xxx
          rewrite: (path) => path.replace(/^\/api/, '/api'),
        },
      },
    },

    // 构建配置
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production', // 生产环境不生成 sourcemap
      // 大文件警告阈值
      chunkSizeWarningLimit: 500,
    },
  }
})
```

> **踩坑 #1**：`loadEnv` 的第三个参数很重要。默认只加载 `VITE_` 前缀的变量，但如果你需要读取非 `VITE_` 前缀的变量（如 `NODE_ENV`），需要传空字符串 `''` 作为 prefix。

## 三、HMR 深入原理与故障排查

### 3.1 HMR 工作原理

Vite 的 HMR 基于原生 ESM，与 Webpack 的 HMR 有本质区别：

```
┌──────────┐    WebSocket (ws://)    ┌──────────────┐
│  浏览器   │◄──────────────────────►│ Vite Dev Server│
│          │    1. 文件变更通知        │              │
│  Vue App │    2. 请求更新模块        │  File Watcher│
│          │    3. 返回新模块          │  (chokidar)  │
│  HMR     │    4. 替换组件（不刷新）   │              │
│  Runtime │                         │  ESBuild     │
└──────────┘                         └──────────────┘
```

**核心优势**：Vite 不需要像 Webpack 那样重新打包整个 bundle，而是直接通过 ESM 按需加载变更的模块，HMR 速度与项目规模无关。

### 3.2 HMR 失效的常见原因与排查

在实际开发中，HMR 经常"不生效"，以下是我在 B2C 项目中总结的高频原因：

**原因 1：组件没有使用 `<script setup>` 或缺少 `name` 选项**

```vue
<!-- ❌ 错误：没有 script setup，HMR 可能失效 -->
<script>
export default {
  name: 'ProductCard',
  // ...
}
</script>

<!-- ✅ 正确：使用 script setup，HMR 稳定 -->
<script setup lang="ts">
// 组件名自动推断，HMR 正常工作
defineOptions({ name: 'ProductCard' })

const props = defineProps<{
  productId: string
  title: string
}>()
</script>
```

**原因 2：动态组件和异步组件的 HMR 陷阱**

```typescript
// ❌ 错误：动态 import 路径是变量时，HMR 无法追踪
const components: Record<string, () => Promise<any>> = {
  product: () => import(`./views/Product.vue`),
  order: () => import(`./views/Order.vue`),
}

// ✅ 正确：使用静态 import 路径，HMR 可以精确追踪
const ProductView = () => import('./views/Product.vue')
const OrderView = () => import('./views/Order.vue')
```

**原因 3：Pinia Store 的 HMR 配置**

```typescript
// stores/index.ts
import { createPinia } from 'pinia'

const pinia = createPinia()

// ⚠️ 关键：启用 Pinia 的 HMR 支持
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(pinia, import.meta.hot))
}

export default pinia
```

> **踩坑 #2**：在 Laravel BFF 项目中，如果前端和后端在同一个 Docker 网络里，Vite 的 WebSocket 连接可能因为 Docker 网络不通而失败。解决方法是在 `vite.config.ts` 中显式配置 `server.hmr.host` 和 `server.hmr.port`。

### 3.3 Vite Dev Server 与 Laravel API 联调配置

```typescript
// vite.config.ts —— 完整的代理配置
server: {
  port: 5173,
  host: '0.0.0.0', // Docker 环境需要监听所有网卡
  proxy: {
    // 代理 BFF API
    '/api': {
      target: 'http://laravel-bff:8000',
      changeOrigin: true,
      configure: (proxy, options) => {
        // 调试代理请求
        proxy.on('proxyReq', (proxyReq, req) => {
          console.log(`[Proxy] ${req.method} ${req.url} → ${options.target}${req.url}`)
        })
      },
    },
    // 代理 WebSocket（如果 Laravel 使用 Reverb/Pusher）
    '/app': {
      target: 'ws://laravel-bff:6001',
      ws: true,
      changeOrigin: true,
    },
  },
},
```

## 四、构建优化实战

### 4.1 分包策略（Manual Chunks）

默认的 Vite 构建会把所有代码打成一个大 chunk，这在 B2C 项目中会导致首屏加载缓慢。手动分包是核心优化手段：

```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      // 手动分包策略
      manualChunks: {
        // Vue 核心库单独一个 chunk（长期缓存）
        'vendor-vue': ['vue', 'vue-router', 'pinia'],

        // UI 组件库单独一个 chunk
        'vendor-ui': ['element-plus', '@element-plus/icons-vue'],

        // 工具库单独一个 chunk
        'vendor-utils': ['axios', 'dayjs', 'lodash-es'],

        // 图表库（如果有的话，体积大，按需加载）
        'vendor-charts': ['echarts'],
      },

      // 文件名加入内容 hash，实现长期缓存
      chunkFileNames: 'assets/js/[name]-[hash].js',
      entryFileNames: 'assets/js/[name]-[hash].js',
      assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
    },
  },
},
```

### 4.2 CSS 优化与提取

```typescript
// vite.config.ts
css: {
  // CSS 代码分割（每个异步组件单独加载 CSS）
  // ⚠️ 注意：会导致额外的网络请求，小项目建议关闭
  modules: {
    localsConvention: 'camelCaseOnly',
  },

  // PostCSS 配置（推荐在 postcss.config.js 中配置）
  postcss: './postcss.config.js',

  // 生产环境压缩 CSS
  devSourcemap: true, // 开发环境生成 CSS sourcemap
},
```

```javascript
// postcss.config.js
export default {
  plugins: {
    // 自动添加浏览器前缀
    autoprefixer: {},
    // CSS 媒体查询合并（减少 CSS 文件大小）
    'postcss-sort-media-queries': {},
  },
}
```

### 4.3 资源优化

```typescript
// vite.config.ts
build: {
  // 图片转 base64 的阈值（小于 4KB 的图片内联）
  assetsInlineLimit: 4096,

  // 启用 CSS 代码分割
  cssCodeSplit: true,

  // 生产环境启用 terser 压缩（默认使用 esbuild，terser 更强大但更慢）
  minify: 'terser',
  terserOptions: {
    compress: {
      // 生产环境移除 console 和 debugger
      drop_console: true,
      drop_debugger: true,
    },
  },
},
```

### 4.4 构建产物分析

安装 `rollup-plugin-visualizer` 来分析 bundle 组成：

```bash
npm install -D rollup-plugin-visualizer
```

```typescript
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer'

plugins: [
  vue(),
  // 仅在 ANALYZE=true 时启用
  process.env.ANALYZE === 'true' &&
    visualizer({
      open: true,
      filename: 'bundle-analysis.html',
      gzipSize: true,
      brotliSize: true,
    }),
].filter(Boolean),
```

```bash
# 运行构建分析
ANALYZE=true npm run build
```

### 4.5 构建优化前后对比

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| Bundle 总大小 | 2.8 MB | 850 KB | -70% |
| 首屏 JS 大小 | 1.2 MB | 320 KB | -73% |
| CSS 大小 | 180 KB | 85 KB | -53% |
| Gzip 后总大小 | 680 KB | 210 KB | -69% |
| 首屏加载时间 (3G) | 8.2s | 2.8s | -66% |

> **踩坑 #3**：`manualChunks` 中不要把 `vue` 和 `vue-router` 放在同一个 chunk 里——它们的更新频率不同。`vue` 几乎不变，而 `vue-router` 可能随路由变更而更新，合并会导致长期缓存失效。

## 五、环境变量管理

### 5.1 环境变量文件结构

```
my-b2c-frontend/
├── .env                    # 所有模式都会加载
├── .env.local              # 本地覆盖，git ignore
├── .env.development        # 开发模式
├── .env.development.local  # 开发模式本地覆盖
├── .env.staging            # 预发布模式
├── .env.production         # 生产模式
└── src/
    └── env.d.ts            # 环境变量类型声明
```

### 5.2 环境变量文件内容

```bash
# .env —— 所有环境共享
VITE_APP_TITLE=KKday B2C
VITE_APP_VERSION=2.1.0

# .env.development
VITE_API_BASE_URL=http://localhost:8000
VITE_API_TIMEOUT=30000
VITE_ENABLE_MOCK=true
VITE_LOG_LEVEL=debug

# .env.staging
VITE_API_BASE_URL=https://staging-api.kkday.com
VITE_API_TIMEOUT=15000
VITE_ENABLE_MOCK=false
VITE_LOG_LEVEL=info

# .env.production
VITE_API_BASE_URL=https://api.kkday.com
VITE_API_TIMEOUT=10000
VITE_ENABLE_MOCK=false
VITE_LOG_LEVEL=error
```

### 5.3 TypeScript 类型安全的环境变量

这是最容易被忽略但最重要的一步——给环境变量加上类型声明：

```typescript
// src/env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 应用标题 */
  readonly VITE_APP_TITLE: string
  /** 应用版本号 */
  readonly VITE_APP_VERSION: string
  /** API 基础 URL */
  readonly VITE_API_BASE_URL: string
  /** API 超时时间 (ms) */
  readonly VITE_API_TIMEOUT: string
  /** 是否启用 Mock */
  readonly VITE_ENABLE_MOCK: string
  /** 日志级别 */
  readonly VITE_LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

### 5.4 封装环境变量工具函数

直接在代码中使用 `import.meta.env.VITE_XXX` 是不安全的——没有任何校验。推荐封装一个类型安全的 `env` 工具：

```typescript
// src/utils/env.ts
function getEnvString(key: keyof ImportMetaEnv, defaultValue = ''): string {
  return import.meta.env[key] ?? defaultValue
}

function getEnvBoolean(key: keyof ImportMetaEnv, defaultValue = false): boolean {
  const value = import.meta.env[key]
  if (value === undefined) return defaultValue
  return value === 'true' || value === '1'
}

function getEnvNumber(key: keyof ImportMetaEnv, defaultValue = 0): number {
  const value = import.meta.env[key]
  if (value === undefined) return defaultValue
  const num = Number(value)
  return isNaN(num) ? defaultValue : num
}

export const env = {
  appTitle: getEnvString('VITE_APP_TITLE', 'B2C App'),
  appVersion: getEnvString('VITE_APP_VERSION', '0.0.0'),
  apiBaseUrl: getEnvString('VITE_API_BASE_URL', 'http://localhost:8000'),
  apiTimeout: getEnvNumber('VITE_API_TIMEOUT', 10000),
  enableMock: getEnvBoolean('VITE_ENABLE_MOCK', false),
  logLevel: getEnvString('VITE_LOG_LEVEL', 'info') as ImportMetaEnv['VITE_LOG_LEVEL'],
} as const
```

使用方式：

```typescript
// src/api/client.ts
import axios from 'axios'
import { env } from '@/utils/env'

const client = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: env.apiTimeout,
  headers: {
    'Content-Type': 'application/json',
    'X-App-Version': env.appVersion,
  },
})
```

> **踩坑 #4**：Vite 的环境变量只有在构建时才会被静态替换。如果你在运行时需要动态修改 API 地址（比如多租户场景），不能依赖 `.env` 文件，需要改为运行时注入（如 `window.__ENV__` 或服务端渲染模板变量）。

### 5.5 多环境构建脚本

```json
// package.json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "build:staging": "vue-tsc --noEmit && vite build --mode staging",
    "build:production": "vue-tsc --noEmit && vite build --mode production",
    "preview": "vite preview",
    "analyze": "ANALYZE=true vite build"
  }
}
```

## 六、与 Laravel BFF 的集成模式

### 6.1 API 请求封装

```typescript
// src/api/request.ts
import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios'
import { env } from '@/utils/env'
import { useUserStore } from '@/stores/user'
import router from '@/router'

// 统一响应结构（与 Laravel BFF 一致）
interface ApiResponse<T = any> {
  success: boolean
  data: T
  message: string
  code: string
  meta?: {
    current_page: number
    last_page: number
    per_page: number
    total: number
  }
}

function createRequest(): AxiosInstance {
  const instance = axios.create({
    baseURL: env.apiBaseUrl,
    timeout: env.apiTimeout,
  })

  // 请求拦截：注入 JWT Token
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const userStore = useUserStore()
    if (userStore.token) {
      config.headers.Authorization = `Bearer ${userStore.token}`
    }
    return config
  })

  // 响应拦截：统一错误处理
  instance.interceptors.response.use(
    (response: AxiosResponse<ApiResponse>) => {
      const { data } = response
      if (!data.success) {
        // BFF 返回业务错误
        if (data.code === 'AUTH_TOKEN_EXPIRED') {
          userStore.clearAuth()
          router.push('/login')
        }
        return Promise.reject(new Error(data.message))
      }
      return response
    },
    (error) => {
      if (error.response?.status === 401) {
        router.push('/login')
      }
      return Promise.reject(error)
    }
  )

  return instance
}

export const request = createRequest()
```

### 6.2 Vite 与 Laravel 混合部署的 Nginx 配置

```nginx
server {
    listen 80;
    server_name b2c.kkday.com;

    # 前端 SPA（Vite 构建产物）
    root /var/www/b2c-frontend/dist;
    index index.html;

    # 静态资源 —— 长期缓存（文件名含 hash）
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API 请求代理到 Laravel
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Vue Router History 模式 —— 所有非文件请求回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> **踩坑 #5**：`try_files` 的顺序很重要。`$uri` 必须在 `/index.html` 前面，否则所有请求（包括 JS/CSS 文件）都会返回 `index.html`，导致页面白屏。另外，`$uri/` 目录检查在某些 Nginx 版本中会返回 403，可以安全移除。

## 七、踩坑记录汇总

| # | 问题 | 原因 | 解决方案 |
|---|------|------|----------|
| 1 | `loadEnv` 读不到自定义变量 | 默认只加载 `VITE_` 前缀 | 第三个参数传 `''` |
| 2 | Docker 中 HMR WebSocket 失败 | 网络隔离 | 配置 `server.hmr.host` |
| 3 | 分包后缓存命中率低 | `vue` 和 `vue-router` 混合 | 按更新频率拆分 vendor |
| 4 | 运行时无法修改 API 地址 | 环境变量是构建时静态替换 | 改用运行时注入方案 |
| 5 | Nginx 部署后白屏 | `try_files` 顺序错误 | `$uri` 放在 `/index.html` 前 |
| 6 | Pinia Store HMR 丢失状态 | 未配置 `acceptHMRUpdate` | 在 store 入口启用 HMR |
| 7 | CSS 样式闪烁（FOUC） | CSS 异步加载 | 关闭 `cssCodeSplit` 或内联关键 CSS |

## 八、CI/CD 集成：GitHub Actions 自动化构建

在 Laravel BFF 项目中，前端通常需要和后端一起部署。以下是 GitHub Actions 的完整构建流水线：

```yaml
# .github/workflows/frontend-ci.yml
name: Frontend CI

on:
  push:
    branches: [main, develop]
    paths:
      - 'frontend/**'
  pull_request:
    paths:
      - 'frontend/**'

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '9'

jobs:
  lint-and-build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          cache-dependency-path: frontend/pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile

      # TypeScript 类型检查
      - run: pnpm vue-tsc --noEmit

      # ESLint 检查
      - run: pnpm eslint . --max-warnings 0

      # 构建（自动校验环境变量类型）
      - run: pnpm build

      # 上传构建产物
      - uses: actions/upload-artifact@v4
        with:
          name: frontend-dist
          path: frontend/dist
          retention-days: 7
```

> **踩坑 #6**：`pnpm install --frozen-lockfile` 在 CI 环境中必须加，否则 pnpm 会尝试更新 `pnpm-lock.yaml`，导致构建不可复现。另外，`cache-dependency-path` 要指向 monorepo 中子项目的 lockfile 路径，否则缓存不命中。

## 九、Vite 插件推荐清单

以下是 B2C 项目中经过验证的 Vite 插件，按优先级排列：

```typescript
// vite.config.ts —— 推荐的插件组合
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { visualizer } from 'rollup-plugin-visualizer'
import compression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    vue(),

    // 自动导入 Vue/Pinia/VueRouter API，免去手动 import
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts',
    }),

    // 自动注册组件（按需导入 Element Plus）
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),

    // Gzip 预压缩（配合 Nginx gzip_static）
    compression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024, // 大于 1KB 的文件才压缩
    }),

    // Brotli 压缩（比 Gzip 压缩率更高）
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 1024,
    }),
  ],
})
```

> **踩坑 #7**：`vite-plugin-compression` 生成的 `.gz` / `.br` 文件需要 Nginx 配置 `gzip_static on;` 才能生效。如果 Nginx 没有开启 `gzip_static` 模块，预压缩文件不会被使用，等于白做。确认 Nginx 编译时包含 `ngx_http_gzip_static_module`。


## 附录：依赖预构建（Pre-Bundling）调优

Vite 在首次启动时会使用 ESBuild 对 `node_modules` 中的依赖进行预构建（Pre-Bundling），将 CommonJS/UMD 模块转换为 ESM 格式，并将数百个小模块合并为单个模块以减少 HTTP 请求。预构建缓存位于 `node_modules/.vite` 目录下。

当你遇到以下情况时，需要手动清理缓存或调整配置：

- 安装了新依赖但页面报错 `Uncaught SyntaxError`（缓存未更新）
- 某些依赖在开发环境正常但构建后报错（CommonJS 转换问题）
- 开发服务器首次启动慢（预构建范围过大）

```typescript
// vite.config.ts —— 预构建优化配置
optimizeDeps: {
  // 强制预构建这些依赖（解决某些包的 ESM 兼容问题）
  include: [
    'vue',
    'vue-router',
    'pinia',
    'axios',
    'element-plus',
    'echarts',
  ],
  // 排除不需要预构建的本地链接包（monorepo 场景）
  exclude: ['@my-company/shared-utils'],
},
```

当依赖出现异常时，执行以下命令清除缓存重新构建：

```bash
# 清除 Vite 缓存
rm -rf node_modules/.vite
# 重新启动开发服务器
pnpm dev
```

> **踩坑 #8**：在 monorepo 中使用 `workspace:*` 协议的内部包时，Vite 默认不会对它们做预构建。如果内部包导出的是 CommonJS 模块，浏览器会报 `require is not defined`。解决方案是在 `optimizeDeps.include` 中显式包含该包名，或者将内部包改为 ESM 格式导出。

## 十、总结

Vue 3 + Vite 在 Laravel BFF 架构下是当前最佳的前端工程化方案。核心要点：

1. **HMR 不生效** 90% 是配置问题，检查 `script setup`、动态 import 路径、Pinia HMR 配置
2. **构建优化** 核心是分包策略——按库的更新频率拆分 vendor chunk，实现长期缓存
3. **环境变量** 一定要加 TypeScript 类型声明，封装类型安全的 `env` 工具函数，避免运行时 `undefined`
4. **与 Laravel 集成** 通过 Vite proxy 开发联调，Nginx `try_files` + API 反向代理部署生产

迁移到 Vite 后，我们的 B2C 项目冷启动从 45s 降到 2s，HMR 从 3-5s 降到 200ms 以内——开发体验的提升是实实在在的。

---

*本文基于 KKday B2C Backend Team 真实项目经验整理，适用于 Laravel BFF + Vue 3 前后端分离架构。*

## 相关阅读

- [Vue 3 Composition API 实战：ref reactive computed 最佳实践与响应式踩坑记录](/frontend/vue-3-composition-api-guide-ref-reactive-computed-best-practices) — 深入 Vue 3 响应式系统核心，掌握 Composition API 的正确使用姿势，与本文的 Vue 3 + Vite 工程化实践互补。
- [Vue 3 + Pinia 状态管理实战：替代 Vuex 的现代方案与 B2C 电商踩坑记录](/frontend/vue-3-pinia-guide-vuex-b2c) — Pinia 是 Vue 3 官方推荐的状态管理库，本文涉及 Pinia HMR 配置，这篇详解 Pinia 的完整用法。
- [Vite 构建优化实战：Laravel 单仓库后台前端的分包策略、缓存命中与 sourcemap 踩坑记录](/frontend/vite-optimizationguide-laravel-cache-sourcemap) — 更深入的 Vite 分包与缓存优化策略，与本文的构建优化章节形成系列。
- [Core Web Vitals 实战：LCP/FID/CLS 优化——Vue 3 + Laravel 前后端协同性能治理](/frontend/Core-Web-Vitals实战-LCP-FID-CLS优化-Vue3-Laravel前后端协同性能治理) — 前端性能优化的用户侧指标衡量，构建优化的最终目标就是改善这些指标。
