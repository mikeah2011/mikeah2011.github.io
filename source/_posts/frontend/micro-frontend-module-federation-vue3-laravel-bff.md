---

title: Micro-Frontend 深度实战：Module Federation 2.0——Vue 3 微前端架构与 Laravel BFF 聚合层集成
keywords: [Micro, Frontend, Module Federation, Vue, Laravel BFF, 深度实战, 微前端架构与, 聚合层集成]
date: 2026-06-06 10:00:00
description: 深入实战 Module Federation 2.0 微前端架构，基于 Vue 3 + Vite 搭建宿主与远程应用，实现路由级按需加载、共享依赖版本管理、跨应用状态通信。结合 Laravel BFF 聚合层设计 API 聚合、JWT 统一认证与请求限流。涵盖 CI/CD 独立部署、灰度发布、样式隔离、错误边界与性能优化等生产踩坑经验，附微前端方案对比与最佳实践总结，适合大型团队渐进式迁移与多业务线协作场景。
tags:
- 微前端
- Module Federation
- Vue
- Laravel
- BFF
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---



## 引言：为什么需要微前端？单体前端的痛点

在过去的几年里，前端工程化经历了从多页面应用到单页应用（SPA）再到微前端架构的演进。当一个前端项目的业务复杂度持续增长、团队规模不断扩大时，单体前端架构往往会暴露出一系列难以回避的问题：

- **构建时间爆炸**：当代码库膨胀到数十万行时，`npm run build` 的时间从几十秒增长到十几分钟，CI/CD 流水线效率严重下降。
- **代码耦合严重**：不同业务模块的代码混杂在同一个仓库中，一次错误的修改可能导致全局不可用，发布时需要所有模块同步回归。
- **团队协作困难**：多个团队共同维护一个仓库，频繁出现合并冲突，代码审查成本居高不下。
- **技术栈锁定**：整个项目被绑定在某一个框架版本上，想要渐进式升级（如 Vue 2 → Vue 3）几乎需要全量重写。

微前端（Micro-Frontend）的核心理念是将一个大型前端应用拆分为多个**独立开发、独立构建、独立部署**的小型应用，每个应用由一个小型团队负责。它们在运行时被整合到同一个宿主页面中，对用户呈现为一个完整的应用。

在众多微前端方案中，Webpack 5 引入的 **Module Federation（模块联邦）** 无疑是目前最主流、最优雅的解决方案。而 **Module Federation 2.0** 在此基础上做了大量改进，包括更好的 Vite 原生支持、动态远程注册、运行时类型安全等。本文将深入实战，以 Vue 3 为主框架，结合 Laravel BFF（Backend For Frontend）聚合层，完整落地一套生产级微前端架构。

---

## Module Federation 2.0 核心概念：Host / Remote / Shared / Singleton

在深入代码之前，我们先厘清 Module Federation 的四个核心概念：

### Host（宿主应用）

Host 是微前端架构的**主应用**（壳应用），负责整体布局、路由分发和子应用加载。它是用户访问的入口。

### Remote（远程应用）

Remote 是各个**子应用**，它们通过 Module Federation 暴露自己需要被共享的模块（组件、工具函数、路由等）。每个 Remote 独立开发和构建。

### Shared（共享模块）

Shared 定义了 Host 和 Remote 之间**共同依赖的库**（如 Vue、Pinia、Element Plus）。当配置为 singleton 时，运行时只会加载一份，避免重复打包和运行时冲突。

### Singleton（单例模式）

Singleton 是 Shared 的一种策略。当设置 `singleton: true` 时，Module Federation 会确保整个应用中**只存在一个该依赖的实例**。这对于 Vue、React 这类有全局状态的框架至关重要。

Module Federation 2.0 的整体架构可以用如下示意来理解：

```
┌─────────────────────────────────────────┐
│              Host (Shell App)           │
│  ┌───────────┐  ┌───────────┐           │
│  │ Remote A  │  │ Remote B  │           │
│  │ (Vue 3)   │  │ (Vue 3)   │           │
│  └───────────┘  └───────────┘           │
│         ▲              ▲                │
│         └──── Shared ──┘                │
│         (Vue, Pinia, Element Plus)      │
└─────────────────────────────────────────┘
              ▲
              │ API Requests
        ┌─────┴─────┐
        │ Laravel   │
        │ BFF Layer │
        └───────────┘
```

2.0 相比 1.x 的关键改进：

- **原生 Vite 支持**：不再强依赖 Webpack，通过 `@module-federation/vite` 插件直接在 Vite 中使用。
- **运行时类型导出**：Remote 可以在运行时动态暴露模块，而非仅在构建时。
- **动态远程（Dynamic Remote）**：Host 可以在运行时动态注册新的 Remote，无需重新构建。
- **更好的错误处理**：提供加载失败重试、降级策略等内置能力。

### 微前端方案横向对比

在选择微前端方案时，需要根据团队技术栈、项目规模和迁移成本综合考量。以下是主流方案的对比：

| 方案 | 技术原理 | 优点 | 缺点 | 适用场景 |
|------|---------|------|------|---------|
| **Module Federation 2.0** | Webpack/Vite 插件，运行时模块共享 | 原生 Vite 支持、共享依赖无重复加载、类型安全、社区活跃 | 需要构建工具配合、跨框架支持有限 | 同技术栈（Vue/React）大型项目 |
| **qiankun** | 基于 single-spa，HTML Entry + CSS 隔离 | 沙箱隔离完善、接入成本低、中文社区成熟 | 多 Vue 实例问题、样式隔离不彻底、维护放缓 | 中后台管理系统、渐进式迁移 |
| **iframe** | 原生 iframe 嵌套 | 天然隔离、零配置、兼容性好 | 性能差、通信复杂、SEO 不友好、用户体验割裂 | 遗留系统临时嵌入、强隔离需求 |
| **Web Components** | 浏览器原生 Custom Elements + Shadow DOM | 框架无关、原生标准、长期稳定 | Shadow DOM 样式穿透困难、生态不完善 | 跨框架共享组件库 |
| **无界/京东 micro-app** | Web Component 包裹 + Shadow DOM | 接入简单、支持任意框架 | 社区较小、高级场景支持有限 | 快速接入、轻量级需求 |

---

## Vue 3 + Vite 项目搭建 Module Federation

接下来我们用一个实际例子来搭建。假设我们要构建一个企业级管理后台，拆分为：

- **shell**：宿主应用，提供整体布局和导航
- **dashboard**：数据看板子应用
- **settings**：系统设置子应用

### 1. 初始化项目结构

```bash
mkdir micro-frontend-demo && cd micro-frontend-demo
mkdir shell dashboard settings shared-types

# 初始化 shell 应用
cd shell && npm create vue@latest . -- --typescript --router --pinia
npm install

# 安装 Module Federation Vite 插件
npm install @module-federation/vite @module-federation/enhanced
```

### 2. 配置 Host 应用（shell）

在 `shell/vite.config.ts` 中配置 Module Federation：

```typescript
// shell/vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { federation } from '@module-federation/vite'

export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: 'shell',
      remotes: {
        dashboard: {
          type: 'module',
          name: 'dashboard',
          entry: 'http://localhost:3001/remoteEntry.js',
        },
        settings: {
          type: 'module',
          name: 'settings',
          entry: 'http://localhost:3002/remoteEntry.js',
        },
      },
      shared: {
        vue: {
          singleton: true,
          requiredVersion: '^3.4.0',
        },
        pinia: {
          singleton: true,
          requiredVersion: '^2.1.0',
        },
        'vue-router': {
          singleton: true,
          requiredVersion: '^4.3.0',
        },
      },
    }),
  ],
  server: {
    port: 3000,
  },
})
```

### 3. 配置 Remote 应用（dashboard）

```typescript
// dashboard/vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { federation } from '@module-federation/vite'

export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: 'dashboard',
      filename: 'remoteEntry.js',
      exposes: {
        './DashboardPage': './src/views/DashboardPage.vue',
        './DashboardWidget': './src/components/DashboardWidget.vue',
        './dashboardStore': './src/stores/dashboard.ts',
      },
      shared: {
        vue: {
          singleton: true,
          requiredVersion: '^3.4.0',
        },
        pinia: {
          singleton: true,
          requiredVersion: '^2.1.0',
        },
        'vue-router': {
          singleton: true,
          requiredVersion: '^4.3.0',
        },
      },
    }),
  ],
  server: {
    port: 3001,
  },
})
```

### 4. Remote 暴露的组件示例

```vue
<!-- dashboard/src/views/DashboardPage.vue -->
<template>
  <div class="dashboard-page">
    <h1>数据看板</h1>
    <div class="widget-grid">
      <DashboardWidget
        v-for="widget in widgets"
        :key="widget.id"
        :title="widget.title"
        :value="widget.value"
        :trend="widget.trend"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import DashboardWidget from '../components/DashboardWidget.vue'

interface Widget {
  id: number
  title: string
  value: string
  trend: 'up' | 'down' | 'flat'
}

const widgets = ref<Widget[]>([
  { id: 1, title: '日活用户', value: '12,345', trend: 'up' },
  { id: 2, title: '订单量', value: '8,901', trend: 'up' },
  { id: 3, title: '转化率', value: '3.2%', trend: 'down' },
  { id: 4, title: '平均停留', value: '4m 32s', trend: 'flat' },
])
</script>

<style scoped>
.dashboard-page {
  padding: 24px;
}
.widget-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
</style>
```

---

## 路由级微前端：子应用动态加载与卸载

在生产环境中，我们不希望在 Shell 应用启动时就加载所有 Remote 的代码。更好的做法是**按需加载**——只有当用户导航到某个子应用的路由时，才去加载对应的 Remote 模块。

### 动态远程加载工具

```typescript
// shell/src/utils/federation.ts
type RemoteModule = Record<string, unknown>

const loadedRemotes = new Map<string, RemoteModule>()

interface LoadRemoteOptions {
  url: string
  scope: string
  module: string
}

export async function loadRemote({
  url,
  scope,
  module,
}: LoadRemoteOptions): Promise<RemoteModule> {
  const cacheKey = `${scope}/${module}`

  if (loadedRemotes.has(cacheKey)) {
    return loadedRemotes.get(cacheKey)!
  }

  try {
    // 动态加载 Remote 的入口文件
    const container = await loadRemoteContainer(url, scope)

    // 初始化共享模块
    await __webpack_init_sharing__('default')
    await container.init(__webpack_share_scopes__.default)

    // 获取具体模块
    const factory = await container.get(module)
    const moduleInstance: RemoteModule = factory()

    loadedRemotes.set(cacheKey, moduleInstance)
    return moduleInstance
  } catch (error) {
    console.error(`Failed to load remote: ${scope}/${module}`, error)
    throw error
  }
}

async function loadRemoteContainer(
  url: string,
  scope: string
): Promise<{ init: (shareScope: unknown) => Promise<void>; get: (module: string) => Promise<() => unknown> }> {
  // 检查是否已存在该容器
  if (__FEDERATION__[scope]) {
    return __FEDERATION__[scope]
  }

  // 动态加载 script
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.type = 'text/javascript'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`))
    document.head.appendChild(script)
  })

  return (window as any)[scope]
}
```

### 路由配置：懒加载子应用

```typescript
// shell/src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'
import { defineAsyncComponent } from 'vue'

// 异步组件包装器：加载 Remote 模块并渲染
function remoteComponent(url: string, scope: string, module: string) {
  return defineAsyncComponent({
    loader: async () => {
      const mod = await loadRemote({ url, scope, module })
      return (mod as any).default || mod
    },
    loadingComponent: () => import('../components/AppLoading.vue'),
    errorComponent: () => import('../components/AppError.vue'),
    delay: 200,
    timeout: 10000,
  })
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: remoteComponent(
        'http://localhost:3001/remoteEntry.js',
        'dashboard',
        './DashboardPage'
      ),
      meta: { title: '数据看板' },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: remoteComponent(
        'http://localhost:3002/remoteEntry.js',
        'settings',
        './SettingsPage'
      ),
      meta: { title: '系统设置' },
    },
  ],
})

// 全局前置守卫：设置页面标题
router.beforeEach((to) => {
  document.title = `${to.meta.title || ''} - 管理后台`
})

export default router
```

### 生产环境的 Remote 地址管理

硬编码 `localhost` 肯定不行，我们需要一个环境感知的配置：

```typescript
// shell/src/config/remotes.ts
interface RemoteConfig {
  url: string
  scope: string
}

const isDev = import.meta.env.DEV

export const remoteConfigs: Record<string, RemoteConfig> = {
  dashboard: {
    scope: 'dashboard',
    url: isDev
      ? 'http://localhost:3001/remoteEntry.js'
      : 'https://cdn.example.com/dashboard/latest/remoteEntry.js',
  },
  settings: {
    scope: 'settings',
    url: isDev
      ? 'http://localhost:3002/remoteEntry.js'
      : 'https://cdn.example.com/settings/latest/remoteEntry.js',
  },
}
```

---

## 共享依赖策略：Vue / Pinia / 组件库的版本管理

共享依赖的管理是 Module Federation 中**最容易出问题**的环节。配置不当会导致：多个 Vue 实例共存导致 `provide/inject` 失效、Pinia store 无法跨应用共享、组件库样式重复加载等。

### 共享策略矩阵

| 依赖 | 策略 | 理由 |
|------|------|------|
| `vue` | `singleton: true` | 必须单例，否则 provide/inject 跨应用失效 |
| `pinia` | `singleton: true` | 共享 store 需要同一个 Pinia 实例 |
| `vue-router` | `singleton: false` | 每个子应用可能有独立路由 |
| `element-plus` | `singleton: true, eager: true` | 避免重复加载 CSS |
| `axios` | `singleton: true` | 统一拦截器配置 |
| `lodash-es` | `singleton: false` | 无状态库，允许各应用独立版本 |

### 详细的 Shared 配置

```typescript
// shared/federation-shared.ts
// 统一的共享配置，各项目可直接 import 使用
export function createSharedConfig() {
  return {
    vue: {
      singleton: true,
      requiredVersion: '^3.4.0',
      version: '3.5.0',
    },
    pinia: {
      singleton: true,
      requiredVersion: '^2.1.0',
      version: '2.2.0',
    },
    'vue-router': {
      singleton: false,
      requiredVersion: '^4.3.0',
    },
    'element-plus': {
      singleton: true,
      requiredVersion: '^2.8.0',
      eager: true, // 主应用优先加载，避免子应用先加载时样式闪烁
    },
    axios: {
      singleton: true,
      requiredVersion: '^1.7.0',
    },
  }
}
```

### 版本对齐脚本

在 monorepo 中，我们可以用脚本确保所有应用的共享依赖版本一致：

```json
// package.json (root)
{
  "scripts": {
    "check:deps": "node scripts/check-shared-deps.js",
    "sync:deps": "node scripts/sync-shared-deps.js"
  }
}
```

```javascript
// scripts/check-shared-deps.js
const fs = require('fs')
const path = require('path')

const apps = ['shell', 'dashboard', 'settings']
const sharedDeps = ['vue', 'pinia', 'vue-router', 'element-plus', 'axios']

const versions = {}

for (const app of apps) {
  const pkgPath = path.join(__dirname, '..', app, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

  for (const dep of sharedDeps) {
    if (allDeps[dep]) {
      if (!versions[dep]) versions[dep] = {}
      versions[dep][app] = allDeps[dep]
    }
  }
}

let hasError = false
for (const [dep, appVersions] of Object.entries(versions)) {
  const unique = new Set(Object.values(appVersions))
  if (unique.size > 1) {
    console.error(`❌ ${dep} 版本不一致:`, appVersions)
    hasError = true
  } else {
    console.log(`✅ ${dep}: ${[...unique][0]}`)
  }
}

if (hasError) process.exit(1)
```

---

## Laravel BFF 聚合层设计：API 聚合、认证、限流

在微前端架构下，每个子应用通常需要调用不同的后端 API。如果让前端直接对接多个后端微服务，会面临认证、跨域、数据聚合等复杂问题。**BFF（Backend For Frontend）** 层作为前端与后端之间的中间层，专门服务于前端的展示需求。

我们使用 Laravel 来构建 BFF 层，它负责：

1. **API 聚合**：将多个后端服务的数据聚合为前端需要的结构
2. **统一认证**：通过中间件统一处理 JWT 验证
3. **请求限流**：保护后端服务不被过多请求打垮
4. **缓存**：对不常变化的数据做缓存，减少后端压力

### Laravel BFF 项目结构

```bash
php artisan make:project bff-layer
cd bff-layer

# 安装必要依赖
composer require laravel/sanctum guzzlehttp/guzzle
```

### API 聚合控制器

```php
<?php
// app/Http/Controllers/Aggregation/DashboardController.php

namespace App\Http\Controllers\Aggregation;

use App\Http\Controllers\Controller;
use App\Services\UserService;
use App\Services\OrderService;
use App\Services\AnalyticsService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class DashboardController extends Controller
{
    public function __construct(
        private UserService $userService,
        private OrderService $orderService,
        private AnalyticsService $analyticsService,
    ) {}

    /**
     * 聚合看板数据：并发请求多个后端服务，组装为前端需要的格式
     */
    public function index()
    {
        $userId = auth()->id();

        // 使用 Laravel 的 Http::pool 并发请求
        $responses = Http::pool(fn ($pool) => [
            $pool->as('users')->withHeaders($this->serviceHeaders())
                ->get(config('services.user.url') . "/api/stats"),
            $pool->as('orders')->withHeaders($this->serviceHeaders())
                ->get(config('services.order.url') . "/api/stats"),
            $pool->as('analytics')->withHeaders($this->serviceHeaders())
                ->get(config('services.analytics.url') . "/api/overview"),
        ]);

        return response()->json([
            'widgets' => [
                [
                    'id' => 1,
                    'title' => '日活用户',
                    'value' => $responses['users']->json('daily_active_users'),
                    'trend' => $responses['users']->json('trend'),
                ],
                [
                    'id' => 2,
                    'title' => '订单量',
                    'value' => $responses['orders']->json('total_orders'),
                    'trend' => $responses['orders']->json('trend'),
                ],
                [
                    'id' => 3,
                    'title' => '转化率',
                    'value' => $responses['analytics']->json('conversion_rate') . '%',
                    'trend' => $responses['analytics']->json('conversion_trend'),
                ],
                [
                    'id' => 4,
                    'title' => '平均停留',
                    'value' => $responses['analytics']->json('avg_session_duration'),
                    'trend' => $responses['analytics']->json('session_trend'),
                ],
            ],
            'updated_at' => now()->toISOString(),
        ]);
    }

    private function serviceHeaders(): array
    {
        return [
            'Authorization' => 'Bearer ' . auth()->user()->service_token,
            'X-Request-Id' => request()->header('X-Request-Id', uniqid('req_')),
        ];
    }
}
```

### 认证中间件

```php
<?php
// app/Http/Middleware/BffAuthenticate.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class BffAuthenticate
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'error' => 'unauthorized',
                'message' => '缺少认证令牌',
            ], 401);
        }

        try {
            $payload = \Firebase\JWT\JWT::decode(
                $token,
                \Firebase\JWT\Key::create(config('app.jwt_secret'), 'HS256')
            );

            // 将用户信息注入请求上下文
            $request->merge(['auth_user' => $payload]);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'token_invalid',
                'message' => '认证令牌无效或已过期',
            ], 401);
        }

        return $next($request);
    }
}
```

### 限流配置

```php
<?php
// app/Providers/AppServiceProvider.php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        RateLimiter::for('bff-api', function (Request $request) {
            $userId = $request->user()?->id ?? $request->ip();

            return [
                // 通用 API：每分钟 60 次
                Limit::perMinute(60)->by($userId),
                // 敏感接口（如登录）：每分钟 10 次
                Limit::perMinute(10)->by($userId)->response(
                    fn () => response()->json([
                        'error' => 'rate_limited',
                        'message' => '请求过于频繁，请稍后再试',
                        'retry_after' => 60,
                    ], 429)
                ),
            ];
        });

        RateLimiter::for('bff-aggregate', function (Request $request) {
            return Limit::perMinute(30)->by(
                $request->user()?->id ?? $request->ip()
            );
        });
    }
}
```

### 路由定义

```php
<?php
// routes/api.php

use App\Http\Controllers\Aggregation\DashboardController;
use App\Http\Controllers\Aggregation\SettingsController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'throttle:bff-api'])->group(function () {
    // 看板聚合接口
    Route::middleware('throttle:bff-aggregate')->group(function () {
        Route::get('/bff/dashboard', [DashboardController::class, 'index']);
    });

    // 设置接口
    Route::prefix('bff/settings')->group(function () {
        Route::get('/', [SettingsController::class, 'index']);
        Route::put('/profile', [SettingsController::class, 'updateProfile']);
        Route::put('/preferences', [SettingsController::class, 'updatePreferences']);
    });
});
```

### Axios 拦截器（前端侧）

```typescript
// shared/http-client.ts
import axios from 'axios'

const httpClient = axios.create({
  baseURL: import.meta.env.VITE_BFF_URL || 'http://localhost:8000/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'X-App-Source': import.meta.env.VITE_APP_NAME || 'shell',
  },
})

// 请求拦截：注入 JWT Token
httpClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：统一错误处理
httpClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // Token 过期，跳转登录
      localStorage.removeItem('access_token')
      window.location.href = '/login'
    }
    if (error.response?.status === 429) {
      const retryAfter = error.response.data?.retry_after || 60
      console.warn(`限流中，${retryAfter}秒后重试`)
    }
    return Promise.reject(error)
  }
)

export default httpClient
```

---

## 状态管理：跨应用通信（Custom Events / Shared Store）

微前端中最具挑战性的问题之一是**跨应用的状态共享与通信**。我们推荐分层解决：

### 方案一：Custom Events（轻量级通信）

适合跨应用传递一次性事件（如通知刷新、主题切换等）。

```typescript
// shared/event-bus.ts
type EventCallback = (...args: any[]) => void

class MicroFrontendEventBus {
  private events = new Map<string, Set<EventCallback>>()

  on(event: string, callback: EventCallback): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }
    this.events.get(event)!.add(callback)

    // 返回取消订阅函数
    return () => this.events.get(event)?.delete(callback)
  }

  emit(event: string, ...args: any[]): void {
    this.events.get(event)?.forEach((cb) => {
      try {
        cb(...args)
      } catch (e) {
        console.error(`Event handler error for "${event}":`, e)
      }
    })

    // 同时触发原生 CustomEvent，支持跨 iframe 通信
    window.dispatchEvent(
      new CustomEvent(`mf:${event}`, { detail: args })
    )
  }
}

// 全局单例
export const eventBus = new MicroFrontendEventBus()

// 事件名称常量
export const EVENTS = {
  USER_LOGGED_IN: 'user:loggedIn',
  USER_LOGGED_OUT: 'user:loggedOut',
  THEME_CHANGED: 'ui:themeChanged',
  NOTIFICATION_RECEIVED: 'notification:received',
  DATA_REFRESH: 'data:refresh',
} as const
```

使用示例：

```vue
<!-- shell 应用中的通知组件 -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { eventBus, EVENTS } from '@shared/event-bus'

const notifications = ref<Notification[]>([])

let unsubscribe: () => void

onMounted(() => {
  unsubscribe = eventBus.on(EVENTS.NOTIFICATION_RECEIVED, (data) => {
    notifications.value.unshift(data)
  })
})

onUnmounted(() => {
  unsubscribe?.()
})

function handleLogout() {
  eventBus.emit(EVENTS.USER_LOGGED_OUT)
  // 执行登出逻辑...
}
</script>
```

### 方案二：Shared Pinia Store（深度状态共享）

当需要多个应用读写同一份状态时，我们可以在 Host 应用中创建 Pinia 实例并传递给 Remote 应用。

```typescript
// shell/src/stores/user.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import httpClient from '@shared/http-client'

export const useUserStore = defineStore('user', () => {
  const token = ref<string | null>(localStorage.getItem('access_token'))
  const userInfo = ref<any>(null)
  const isLoggedIn = computed(() => !!token.value)

  async function login(username: string, password: string) {
    const { data } = await httpClient.post('/auth/login', {
      username,
      password,
    })
    token.value = data.access_token
    userInfo.value = data.user
    localStorage.setItem('access_token', data.access_token)
  }

  function logout() {
    token.value = null
    userInfo.value = null
    localStorage.removeItem('access_token')
  }

  async function fetchProfile() {
    if (!token.value) return
    const { data } = await httpClient.get('/auth/me')
    userInfo.value = data
  }

  return { token, userInfo, isLoggedIn, login, logout, fetchProfile }
})
```

在 Host 中初始化 Pinia 并通过 provide 注入：

```vue
<!-- shell/src/App.vue -->
<template>
  <div id="micro-frontend-app">
    <AppHeader />
    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { createPinia } from 'pinia'
import AppHeader from './components/AppHeader.vue'

// 创建全局 Pinia 实例并通过 provide 传递给子应用
const pinia = createPinia()
provide('pinia', pinia)
</script>
```

在 Remote 应用中消费这个 Pinia 实例：

```vue
<!-- dashboard/src/App.vue（独立运行时的壳） -->
<script setup lang="ts">
import { inject } from 'vue'
import { createPinia } from 'pinia'

// 如果作为独立应用运行，创建自己的 Pinia 实例
// 如果作为 Remote 被加载，使用 Host 提供的实例
const hostPinia = inject('pinia', null)
if (hostPinia) {
  // 使用 Host 的 Pinia 实例
  // store 可以访问 Host 的全局状态
}
</script>
```

---

## 构建与部署策略：独立部署、版本管理、灰度发布

微前端最大的优势之一是**独立部署**。每个子应用独立构建、独立发布，不影响其他应用。

### CI/CD 流水线（GitHub Actions）

```yaml
# .github/workflows/deploy-dashboard.yml
name: Deploy Dashboard Remote

on:
  push:
    branches: [main]
    paths:
      - 'dashboard/**'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: dashboard/package-lock.json

      - name: Install dependencies
        working-directory: dashboard
        run: npm ci

      - name: Check shared deps alignment
        run: node scripts/check-shared-deps.js

      - name: Build
        working-directory: dashboard
        run: npm run build
        env:
          VITE_BFF_URL: ${{ secrets.BFF_URL }}

      - name: Upload to CDN
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-east-1

      - name: Deploy to S3
        working-directory: dashboard
        run: |
          # 按版本号部署
          VERSION=$(node -p "require('./package.json').version")
          aws s3 sync dist/ s3://mf-cdn/dashboard/${VERSION}/ \
            --cache-control "public, max-age=31536000, immutable"
          # 同时更新 latest 软链
          aws s3 sync dist/ s3://mf-cdn/dashboard/latest/ \
            --cache-control "public, max-age=300"

      - name: Update remote registry
        run: |
          # 更新 Remote 模块注册表（存储在 Redis/DB 中）
          curl -X POST "${{ secrets.REGISTRY_URL }}/api/remotes/dashboard" \
            -H "Authorization: Bearer ${{ secrets.REGISTRY_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{\"version\": \"${VERSION}\", \"url\": \"https://cdn.example.com/dashboard/${VERSION}/remoteEntry.js\"}"
```

### 版本管理与灰度发布

```typescript
// shell/src/config/remotes.ts
// 动态获取 Remote 最新版本，支持灰度
export async function getRemoteUrl(scope: string): Promise<string> {
  // 从注册表获取 Remote 信息
  const registry = await httpClient.get(`/bff/registry/${scope}`)

  const { latest_version, canary_version, canary_percentage } = registry.data

  // 灰度：按用户 ID hash 分桶
  const userId = localStorage.getItem('user_id') || 'anonymous'
  const hash = simpleHash(userId) % 100

  const version =
    canary_version && hash < canary_percentage
      ? canary_version
      : latest_version

  return `https://cdn.example.com/${scope}/${version}/remoteEntry.js`
}

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff
  }
  return Math.abs(hash)
}
```

---

## 生产踩坑：样式冲突、性能、SEO、调试

### 1. 样式冲突

不同子应用可能使用相同的 CSS 类名，导致样式互相污染。

**解决方案一：CSS Modules + Scoped**

```vue
<!-- 使用 Vue 的 scoped 样式 -->
<style scoped>
.container { /* 仅作用于当前组件 */ }
</style>
```

**解决方案二：CSS Namespace**

```scss
// dashboard/src/styles/namespace.scss
// 所有 dashboard 的样式都包裹在 .mf-dashboard 下
.mf-dashboard {
  // 全局变量
  --dashboard-primary: #409eff;

  .container {
    max-width: 1200px;
    margin: 0 auto;
  }

  .widget-card {
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
}
```

```vue
<!-- DashboardPage.vue -->
<template>
  <div class="mf-dashboard">
    <div class="container">...</div>
  </div>
</template>
```

**解决方案三：Shadow DOM 隔离**

```typescript
// shell/src/utils/shadow-wrapper.ts
export function mountInShadow(
  container: HTMLElement,
  render: (root: ShadowRoot) => void
) {
  // 避免重复创建
  if (container.shadowRoot) {
    render(container.shadowRoot)
    return
  }

  const shadow = container.attachShadow({ mode: 'open' })
  render(shadow)
}
```

### 2. 性能优化

Remote 模块的加载会带来额外的网络请求和解析开销。

```typescript
// shell/src/utils/prefetch.ts
// 空闲时预加载可能需要的 Remote
export function prefetchRemotes(remotes: string[]) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      remotes.forEach((url) => {
        const link = document.createElement('link')
        link.rel = 'prefetch'
        link.href = url
        link.as = 'script'
        document.head.appendChild(link)
      })
    })
  }
}

// 在 Shell 应用启动后调用
prefetchRemotes([
  remoteConfigs.dashboard.url,
  remoteConfigs.settings.url,
])
```

### 3. 错误边界与降级

```vue
<!-- shell/src/components/RemoteErrorBoundary.vue -->
<template>
  <Suspense>
    <template #default>
      <slot />
    </template>
    <template #fallback>
      <div class="remote-loading">
        <el-skeleton :rows="5" animated />
      </div>
    </template>
  </Suspense>
  <template #error="{ error }">
    <div class="remote-error">
      <el-result icon="error" title="模块加载失败" :sub-title="error?.message">
        <template #extra>
          <el-button type="primary" @click="retry">重试</el-button>
          <el-button @click="goHome">返回首页</el-button>
        </template>
      </el-result>
    </div>
  </template>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

function retry() {
  // 刷新当前路由以重新加载 Remote
  router.go(0)
}

function goHome() {
  router.push('/')
}
</script>
```

### 4. 调试技巧

```typescript
// 开发环境下的 Remote 加载日志
if (import.meta.env.DEV) {
  window.__MF_DEBUG__ = true

  // 拦截 Remote 加载，打印详细信息
  const originalFetch = window.fetch
  window.fetch = async (...args) => {
    const url = args[0] as string
    if (url.includes('remoteEntry')) {
      console.log(`[MF] Loading remote: ${url}`)
      console.time(`[MF] ${url}`)
    }
    const response = await originalFetch(...args)
    if (url.includes('remoteEntry')) {
      console.timeEnd(`[MF] ${url}`)
      console.log(`[MF] Status: ${response.status}`)
    }
    return response
  }
}
```

---

## 最佳实践与总结

经过上面的完整实战，我们总结出以下微前端架构的最佳实践：

### 架构设计

1. **拆分粒度**：按**业务域**拆分，而非按技术层拆分。每个 Remote 应该对应一个完整的业务功能。
2. **Shell 极简**：Shell 应用只负责布局、路由分发和全局状态管理，不包含业务逻辑。
3. **Remote 自治**：每个 Remote 应用可以独立运行和测试，不强依赖 Shell。

### 依赖管理

4. **共享配置集中管理**：将 `shared` 配置抽取为独立模块，各应用通过 import 引用。
5. **版本锁定**：所有共享依赖使用精确版本（`~` 或锁定 lockfile），避免版本漂移。
6. **CI 校验**：在 CI 流水线中加入依赖版本一致性检查。

### BFF 层

7. **聚合而非透传**：BFF 应该聚合多个服务的数据，提供前端友好的接口，而非简单转发。
8. **统一错误格式**：定义标准的错误响应格式，前端统一处理。
9. **缓存策略**：对不常变化的数据设置缓存，使用 `Cache-Control` 和 Laravel Cache。

### 运维与监控

10. **独立部署**：每个 Remote 有独立的 CI/CD 流水线，支持单独发布和回滚。
11. **灰度发布**：新版本先灰度给少量用户，观察无异常后再全量推送。
12. **错误监控**：对 Remote 加载失败做埋点，及时发现 CDN 或构建问题。
13. **性能监控**：关注 Remote 加载时间、首屏渲染时间等关键指标。

### 团队协作

14. **接口契约先行**：跨应用的接口（事件、Props、API）先定义 TypeScript 类型，再开发实现。
15. **共享组件库**：UI 组件、工具函数通过 npm 包发布，各应用独立安装。

### 技术选型建议

| 场景 | 推荐方案 |
|------|---------|
| 同技术栈微前端 | Module Federation（最佳选择） |
| 跨技术栈（Vue + React） | Module Federation + Web Components 封装 |
| 遗留系统渐进迁移 | iframe + Module Federation 混合 |
| 简单的页面嵌入 | Web Components / iframe |

---

## 总结

本文从零开始，完整搭建了一套基于 **Module Federation 2.0 + Vue 3 + Vite + Laravel BFF** 的微前端架构：

- **前端层面**：通过 Module Federation 实现了子应用的独立开发与构建，路由级的按需加载，以及共享依赖的统一管理。
- **后端层面**：通过 Laravel BFF 聚合层实现了 API 聚合、统一认证和请求限流，为前端提供了干净的服务接口。
- **运维层面**：通过 CI/CD 流水线实现了独立部署，通过版本注册表和灰度策略实现了安全的渐进式发布。

微前端并非银弹，它引入了额外的复杂度——模块加载、样式隔离、状态共享、调试困难等问题都需要认真对待。但在合适的场景下（大型团队、多业务线、渐进式迁移），它能显著提升开发效率和系统的可维护性。

关键原则：**能用 monorepo 解决的问题，就不要用微前端。只有当团队规模、业务复杂度和技术多样性的约束真正需要拆分时，才引入微前端架构。**

## 相关阅读

- [Web Components 实战：浏览器原生组件标准——跨框架 UI 组件库设计与 Laravel Blade 集成](/post/web-components-cross-framework-ui-laravel-blade/)
- [Vue 3.5+ 新特性实战：useId/useTemplateRef/useDeferredValue——Composition API 的最新进化与迁移指南](/post/vue-useid-usetemplateref-usedeferredvalue-composition-api/)
- [Laravel Echo 2.x 实战：Reverb + Presence Channel 在 B2C 电商中的在线客服与协同编辑](/post/laravel-echo-reverb-presence-channel-b2c/)
- [Astro 5.x 实战：内容优先的 Web 框架——Islands Architecture 与 Laravel Headless CMS 后端集成](/post/astro-5x-islands-architecture-laravel-headless-cms/)
