---
title: Vite-Laravel-实战-前后端分离开发工作流踩坑记录
date: 2026-05-17 05:30:22
updated: 2026-05-17 05:34:33
categories:
  - HTML
tags:
  - Vite
  - Laravel
  - 前后端分离
  - 前端工程化
  - Blade
  - HMR
  - Proxy
  - Docker
description: >
  Laravel 9.x 起默认前端构建工具从 Mix（Webpack）切换到 Vite。本文基于 30+ 仓库的实际迁移经验，
  覆盖从零搭建 Vite + Laravel 前后端分离工作流的完整链路：npm 配置、vite.config.js 核心配置、
  Blade 模板集成、开发服务器代理、Docker/Sail 环境适配、生产构建优化，以及迁移过程中遇到的
  真实踩坑记录与解决方案。
---

# Vite + Laravel 实战：前后端分离开发工作流踩坑记录

## 为什么迁移？从 Mix 到 Vite 的真实驱动力

在 Laravel 9.x 之前，`laravel-mix`（底层 Webpack）是官方默认的前端构建方案。但随着项目规模增长，我们遇到了三个痛点：

1. **冷启动慢**：一个中型 Laravel 项目（Vue 3 + Element Plus），`npm run watch` 冷启动需要 15-25 秒
2. **HMR 延迟**：修改一个 Vue 组件，热更新需要 2-3 秒才能看到变化
3. **配置复杂**：Webpack 的 `webpack.mix.js` 需要大量 loader 配置，新人上手成本高

Vite 基于 ESBuild（Go 编写）的预构建 + 原生 ESM 的开发模式，把冷启动压到了 1-2 秒，HMR 基本是即时的。这不是理论数据，是我们 30+ 仓库迁移后的真实测量结果。

```
┌─────────────────────────────────────────────────────────┐
│              Vite + Laravel 架构总览                      │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │  Vue 3 / TS  │───▶│   Vite Dev   │───▶│  Browser   │ │
│  │  Components  │    │   Server     │    │  (ESM HMR) │ │
│  └──────────────┘    └──────┬───────┘    └────────────┘ │
│                             │ proxy                     │
│  ┌──────────────┐    ┌──────▼───────┐                   │
│  │   Blade +    │───▶│   Laravel    │                   │
│  │  @vite()     │    │   Server     │                   │
│  └──────────────┘    └──────────────┘                   │
│                                                          │
│  Development: Vite dev server (port 5173)                │
│  Production:  vite build → public/build/                 │
└─────────────────────────────────────────────────────────┘
```

---

## 一、从零搭建：npm 初始化与依赖安装

### 1.1 清理旧的 Mix 依赖

```bash
# 移除 laravel-mix 相关依赖
npm uninstall laravel-mix webpack webpack-cli \
  css-loader sass-loader style-loader \
  vue-loader vue-template-compiler

# 清理旧配置
rm webpack.mix.js
```

### 1.2 安装 Vite + Laravel 插件

```bash
# Laravel 官方 Vite 插件
npm install laravel-vite-plugin vite --save-dev

# 如果使用 Vue 3
npm install @vitejs/plugin-vue --save-dev

# 如果使用 TypeScript
npm install typescript vue-tsc --save-dev

# 如果使用 Sass
npm install sass --save-dev
```

### 1.3 配置 vite.config.js

这是整个迁移的核心文件：

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import laravel from 'laravel-vite-plugin'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
    plugins: [
        laravel({
            // 入口文件 — 可以是多个
            input: [
                'resources/css/app.css',
                'resources/js/app.js',
            ],
            // 刷新路径 — 文件变化时触发整页刷新
            refresh: true,
        }),
        vue({
            // 支持 Vue 单文件组件中的 <script setup>
            script: {
                defineModel: true,
            },
        }),
    ],

    // 开发服务器配置
    server: {
        // 监听所有网卡（Docker 容器内必需）
        host: '0.0.0.0',
        // 端口
        port: 5173,
        // 允许 Docker 容器访问
        strictPort: true,

        // 关键：代理 API 请求到 Laravel 后端
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
            '/sanctum': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
            // Breeze/Jetstream 的认证路由
            '/login': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
            '/register': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
            '/logout': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
        },
    },

    // 构建优化
    build: {
        // 生成 sourcemap（生产环境建议 false）
        sourcemap: false,
        // chunk 大小警告阈值
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                // 手动分包：vendor 拆分
                manualChunks: {
                    'vendor-vue': ['vue', 'vue-router', 'pinia'],
                    'vendor-ui': ['element-plus'],
                    'vendor-utils': ['axios', 'dayjs', 'lodash-es'],
                },
            },
        },
    },
})
```

---

## 二、Blade 模板集成：@vite 指令的正确用法

### 2.1 基本用法

Laravel 提供了 `@vite` Blade 指令来自动注入 CSS 和 JS：

```blade
{{-- resources/views/layouts/app.blade.php --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <title>{{ config('app.name') }}</title>

    {{-- 自动注入 CSS 和 JS，开发模式指向 Vite dev server --}}
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
    <div id="app">
        @yield('content')
    </div>
</body>
</html>
```

### 2.2 CSP 环境下的踩坑

**坑 1**：如果你配置了 CSP（Content Security Policy），`@vite` 在开发模式下会注入 inline script 和指向 `http://localhost:5173` 的资源，会被 CSP 拦截。

```php
// config/app.php — 开发环境关闭 CSP 或添加 Vite dev server 到白名单
// 方案 A：开发环境添加 nonce
@vite(['resources/css/app.css', 'resources/js/app.js'], ['nonce' => csp_nonce()])

// 方案 B：在 CSP header 中允许 localhost:5173
// script-src 'self' http://localhost:5173 'unsafe-eval';
// style-src 'self' http://localhost:5173 'unsafe-inline';
```

**坑 2**：`@vite` 在 Blade 组件中使用时，路径是相对于项目根目录的，不是相对于当前 Blade 文件。

```blade
{{-- 正确 --}}
@vite(['resources/css/admin.css'])

{{-- 错误 — 不要加 ./ 或 resources/ 前缀重复 --}}
@vite(['./resources/css/admin.css'])  {{-- ❌ --}}
```

---

## 三、开发服务器代理：解决 CORS 和 Cookie 问题

前后端分离开发最头疼的问题是跨域。Vite dev server 运行在 `localhost:5173`，Laravel 运行在 `localhost:8000`，前端请求后端会触发 CORS。

### 3.1 代理配置详解

```javascript
// vite.config.js — server.proxy 完整配置
server: {
    proxy: {
        // API 路由代理
        '/api': {
            target: 'http://localhost:8000',
            changeOrigin: true,
            // 不需要 rewrite，因为 Laravel 的 API 路由前缀就是 /api
        },

        // Sanctum CSRF cookie
        '/sanctum/csrf-cookie': {
            target: 'http://localhost:8000',
            changeOrigin: true,
        },

        // 如果使用 Inertia.js，需要代理所有页面路由
        // 但通常 Inertia 的请求都是 XHR，只需要代理 /api 即可
    },
},
```

### 3.2 Laravel Sanctum 的 CSRF 问题

**坑 3**：使用 Sanctum 时，CSRF cookie 的 domain 必须匹配。开发环境下的配置：

```php
// config/sanctum.php
'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', sprintf(
    '%s%s',
    'localhost,localhost:5173,127.0.0.1,127.0.0.1:8000,::1',
    env('APP_URL') ? ','.parse_url(env('APP_URL'), PHP_URL_HOST) : ''
))),
```

```env
# .env
SESSION_DOMAIN=localhost
SANCTUM_STATEFUL_DOMAINS=localhost,localhost:5173
```

前端 axios 配置需要指定 `baseURL` 和 `withCredentials`：

```javascript
// resources/js/bootstrap.js
import axios from 'axios'

axios.defaults.baseURL = ''  // 空字符串 = 相对路径，走 Vite 代理
axios.defaults.withCredentials = true  // 携带 cookie

// CSRF token — Sanctum 的 /csrf-cookie 接口
axios.get('/sanctum/csrf-cookie').then(() => {
    console.log('CSRF cookie set')
})
```

---

## 四、Docker / Sail 环境适配

### 4.1 Laravel Sail 的 Vite 支持

Laravel Sail（Docker Compose 封装）从 v1.x 起就内置了 Vite 支持：

```yaml
# docker-compose.yml — Sail 自带的 vite 服务
services:
  laravel.test:
    build:
      context: ./docker/8.2
      dockerfile: Dockerfile
    ports:
      - '${APP_PORT:-80}:80'
    # ... 其他配置

  # Sail 默认不暴露 Vite 端口，需要手动添加
  # 在 docker-compose.yml 中添加：
```

```yaml
# 手动添加 Vite 端口映射
services:
  laravel.test:
    ports:
      - '${APP_PORT:-80}:80'
      - '${VITE_PORT:-5173}:5173'  # 添加这行
```

### 4.2 自定义 Docker Compose 配置

如果不使用 Sail，自己管理 Docker Compose：

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - '8000:80'
    volumes:
      - .:/var/www/html
    depends_on:
      - mysql
      - redis

  # 独立的 Vite dev server 容器
  vite:
    image: node:20-alpine
    working_dir: /var/www/html
    command: npm run dev
    ports:
      - '5173:5173'
    volumes:
      - .:/var/www/html
      - node_modules:/var/www/html/node_modules  # 避免覆盖 node_modules
    environment:
      - WATCHPACK_POLLING=true  # Docker volume 文件变动检测

volumes:
  node_modules:
```

**坑 4**：Docker volume 中的 `node_modules` 如果与宿主机架构不同（M 芯片 Mac vs Linux 容器），需要使用 named volume 而不是 bind mount。否则会出现 `Cannot find module` 错误。

```yaml
# 错误 — bind mount 会覆盖容器内的 node_modules
volumes:
  - .:/var/www/html  # node_modules 从宿主机映射，架构不兼容

# 正确 — 使用 named volume 隔离 node_modules
volumes:
  - .:/var/www/html
  - node_modules:/var/www/html/node_modules  # 容器内独立安装
```

### 4.3 WATCHPACK_POLLING 解决文件变动不触发

**坑 5**：在 Docker 中，文件系统事件（inotify）不会从宿主机传递到容器中，导致 Vite 的 HMR 不工作。

```javascript
// vite.config.js — Docker 环境使用 polling
export default defineConfig({
    server: {
        watch: {
            usePolling: true,   // 关键：启用轮询
            interval: 1000,     // 轮询间隔（ms）
        },
    },
})
```

或者通过环境变量控制：

```bash
# 在 docker-compose.yml 的 vite 服务中
environment:
  - WATCHPACK_POLLING=true
  - CHOKIDAR_USEPOLLING=true
```

---

## 五、多入口与多页面应用

### 5.1 多入口配置

B2C 项目通常有多个入口：前台 SPA + 后台管理 + 独立页面。

```javascript
// vite.config.js
laravel({
    input: [
        // 前台 SPA
        'resources/js/frontend/app.js',
        'resources/css/frontend/app.css',

        // 后台管理
        'resources/js/admin/app.js',
        'resources/css/admin/app.css',

        // 独立页面（不需要 SPA 的）
        'resources/js/pages/landing.js',
        'resources/css/pages/landing.css',
    ],
    refresh: true,
}),
```

Blade 中按需引入：

```blade
{{-- 前台页面 --}}
@vite(['resources/js/frontend/app.js', 'resources/css/frontend/app.css'])

{{-- 后台页面 --}}
@vite(['resources/js/admin/app.js', 'resources/css/admin/app.css'])
```

### 5.2 生产环境的 manifest.json

Vite 构建后会生成 `public/build/manifest.json`，`@vite` 指令会自动读取这个文件来生成正确的资源路径：

```json
{
    "resources/js/app.js": {
        "file": "assets/app-4ed993c7.js",
        "isEntry": true,
        "src": "resources/js/app.js",
        "css": ["assets/app-0e4c7189.css"]
    },
    "resources/css/app.css": {
        "file": "assets/app-0e4c7189.css",
        "src": "resources/css/app.css"
    }
}
```

**坑 6**：如果 `npm run build` 失败但部分文件已写入 `public/build/`，会导致 manifest.json 不完整，页面白屏。解决方法：构建失败时清理 `public/build/` 目录。

```json
// package.json — 构建前清理
{
    "scripts": {
        "dev": "vite",
        "build": "rm -rf public/build && vite build"
    }
}
```

---

## 六、生产构建优化

### 6.1 代码分割策略

```javascript
// vite.config.js — rollupOptions 输出配置
build: {
    rollupOptions: {
        output: {
            // 入口文件命名
            entryFileNames: 'assets/[name]-[hash].js',
            // chunk 命名
            chunkFileNames: 'assets/[name]-[hash].js',
            // 静态资源命名
            assetFileNames: 'assets/[name]-[hash].[ext]',

            manualChunks(id) {
                if (id.includes('node_modules')) {
                    if (id.includes('vue') || id.includes('pinia')) {
                        return 'vendor-vue'
                    }
                    if (id.includes('element-plus')) {
                        return 'vendor-ui'
                    }
                    return 'vendor'  // 其他第三方库
                }
            },
        },
    },
    // 压缩器
    minify: 'terser',
    terserOptions: {
        compress: {
            drop_console: true,   // 移除 console.log
            drop_debugger: true,  // 移除 debugger
        },
    },
},
```

### 6.2 资源版本控制与 CDN

```php
// config/app.php
'asset_url' => env('ASSET_URL', null),
```

```env
# .env — 生产环境
ASSET_URL=https://cdn.example.com
```

Vite 生成的文件名自带 hash（`app-4ed993c7.js`），天然支持长期缓存。配合 CDN 的 `Cache-Control: max-age=31536000`（1年），首次加载后几乎零网络开销。

---

## 七、踩坑记录汇总

| # | 问题 | 原因 | 解决方案 |
|---|------|------|----------|
| 1 | CSP 拦截 Vite 注入的 inline script | 开发模式下 Vite 使用 inline HMR client | 开发环境 CSP 白名单添加 `localhost:5173` |
| 2 | `@vite` 路径错误 | 路径相对于项目根目录，不是 Blade 文件 | 统一使用 `resources/` 开头的路径 |
| 3 | Sanctum CSRF cookie 不生效 | `SESSION_DOMAIN` 和 `SANCTUM_STATEFUL_DOMAINS` 未包含 `localhost:5173` | 添加 Vite dev server 的 host:port |
| 4 | Docker 中 `Cannot find module` | bind mount 覆盖了容器内的 `node_modules` | 使用 named volume 隔离 |
| 5 | Docker 中 HMR 不工作 | 文件系统事件不跨 Docker boundary | 启用 `usePolling: true` |
| 6 | 生产构建白屏 | 部分构建失败导致 manifest.json 不完整 | 构建前 `rm -rf public/build` |
| 7 | Sass 变量全局导入失败 | Vite 的 `css.preprocessorOptions` 配置不同 | 使用 `additionalData` 替代 Mix 的 `prependData` |
| 8 | `process.env` 不可用 | Vite 使用 `import.meta.env` 替代 | 全局替换 `process.env` → `import.meta.env` |

### 坑 7 详解：Sass 全局变量

Mix 时代用 `webpack.mix.js` 的 `sassOptions.prependData` 导入全局变量。Vite 的写法不同：

```javascript
// vite.config.js
css: {
    preprocessorOptions: {
        scss: {
            // Vite 使用 additionalData（不是 prependData）
            additionalData: `
                @import "resources/sass/variables";
                @import "resources/sass/mixins";
            `,
        },
    },
},
```

### 坑 8 详解：环境变量迁移

```javascript
// 旧写法（Mix/Webpack）
const apiUrl = process.env.MIX_API_URL

// 新写法（Vite）
const apiUrl = import.meta.env.VITE_API_URL

// .env 文件中变量前缀从 MIX_ 改为 VITE_
// 旧：MIX_API_URL=https://api.example.com
// 新：VITE_API_URL=https://api.example.com
```

**重要**：只有以 `VITE_` 为前缀的环境变量才会暴露给客户端代码。这是安全设计，避免意外泄露密钥。

---

## 八、迁移检查清单

```
□ 备份 webpack.mix.js 和相关配置
□ 安装 laravel-vite-plugin + vite
□ 创建 vite.config.js
□ 更新 package.json 的 scripts
□ 更新 .env 中的环境变量前缀（MIX_ → VITE_）
□ 全局替换 process.env.MIX_ → import.meta.env.VITE_
□ 更新 Blade 模板，使用 @vite 指令
□ 配置 API 代理（server.proxy）
□ 配置 Sass 全局变量（additionalData）
□ Docker 环境配置 polling + 端口映射
□ 验证 Sanctum CSRF 配置
□ 验证生产构建（npm run build）
□ 验证 HMR 热更新
□ 清理旧的 Webpack 相关依赖
□ 更新 CI/CD 构建脚本
```

---

## 总结

Vite + Laravel 的前后端分离工作流，核心就三件事：**vite.config.js 配置**、**@vite 指令集成**、**开发服务器代理**。但在实际迁移过程中，Docker 文件变动检测、Sanctum CSRF 配置、Sass 变量导入方式这些细节会消耗大量调试时间。建议按本文的检查清单逐项验证，避免踩坑。

迁移完成后，开发体验的提升是肉眼可见的：冷启动从 20 秒降到 2 秒，HMR 从 3 秒降到即时响应，配置文件从 200 行的 `webpack.mix.js` 精简到 50 行的 `vite.config.js`。对于大型 B2C 前后端分离项目，这是一次值得投入的工程化升级。
