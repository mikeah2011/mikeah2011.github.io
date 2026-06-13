---

title: Vite 预构建优化实战：依赖预构建与缓存策略的性能调优踩坑记录
keywords: [Vite, 预构建优化实战, 依赖预构建与缓存策略的性能调优踩坑记录]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-17 05:20:13
updated: 2026-05-17 05:23:03
categories:
- frontend
tags:
- Laravel
- Vite
- 前端
- 性能优化
- esbuild
- 预构建
- Monorepo
description: 深入 Vite 预构建机制（optimizeDeps）原理与实战优化指南，覆盖依赖自动发现三大陷阱、esbuild 打包 CJS 转 ESM、文件系统缓存失效排查、pnpm monorepo workspace 间接依赖穿透问题，附真实 Laravel B2C 项目首次加载从 20s 优化到 2s、HMR 从 3s 降到 200ms 的完整性能对比数据与调试技巧。
---



我在维护一个 Laravel 单仓后台前端时，遇到过一个很诡异的开发体验问题：`npm run dev` 启动后，首次打开页面要等 **15-20 秒**才能看到内容，浏览器 Network 面板里刷出几百个 `304` 请求，全是 `node_modules` 下的 ESM 模块。更离谱的是，改一行代码 HMR 要 3 秒才生效。

排查下来，根因不是 Vite 构建慢，而是**预构建（Pre-bundling）没配好**——大量 CommonJS 依赖没有被正确预打包，导致浏览器在开发时逐个请求几百个细粒度模块，每个都触发一次 HTTP 往返。

这篇文章记录我如何从原理入手，逐步优化 `optimizeDeps` 配置，最终把首次加载从 20 秒压到 2 秒、HMR 恢复到 200ms 以内的全过程。

## 一、预构建到底在做什么？

Vite 开发模式用原生 ESM，浏览器直接请求源文件。但 `node_modules` 里的包大多是 CommonJS 格式，而且一个包可能导出几十个子模块（比如 `lodash-es` 有 600+ 个模块）。如果直接让浏览器一个个加载，会产生两个致命问题：

1. **请求瀑布**：几百个 HTTP 请求串行排队，网络延迟叠加
2. **CJS 不兼容**：浏览器不支持 `require()`，CommonJS 模块无法直接执行

Vite 的解决方案是**预构建**：用 esbuild 在启动时把这些依赖打包成少量 ESM 文件，存在 `node_modules/.vite/deps` 目录下。

```text
开发模式请求流：
浏览器
  ├─ /src/main.ts          → Vite 按需 transform（快）
  ├─ /node_modules/vue/    → 被预构建，命中 .vite/deps/vue.js（单文件）
  ├─ /node_modules/axios/  → 被预构建，命中 .vite/deps/axios.js（单文件）
  └─ /src/components/...   → Vite 按需 transform

没有预构建时：
浏览器
  ├─ /node_modules/lodash-es/map.js      → 304
  ├─ /node_modules/lodash-es/filter.js   → 304
  ├─ ...（600+ 个请求）
```

## 二、默认行为的问题

Vite 默认会**自动发现**需要预构建的依赖：扫描源码中的 `import` 语句，找到 `node_modules` 里的包，判断是否需要预构建。

听起来很智能，但在实际项目中，自动发现有三个坑：

### 坑 1：动态 import 导致漏扫

```typescript
// 这种写法 Vite 扫描不到
const module = await import(`./plugins/${name}.ts`)

// 如果 plugin 里 import 了 axios，Vite 不会预构建 axios
// 开发时 axios 的子模块就会被浏览器逐个请求
```

### 坑 2：间接依赖穿透

```text
你的项目
  └─ @kkday/admin-utils（内部包）
       └─ dayjs
            └─ dayjs/plugin/utc（CJS 插件）
```

Vite 可能只预构建了 `dayjs` 主入口，但 `dayjs/plugin/utc` 没被包含，运行时才暴露为 CJS 兼容问题。

### 坑 3：Monorepo workspace 链接

```json
// package.json
{
  "dependencies": {
    "@kkday/shared-types": "workspace:*"
  }
}
```

pnpm workspace 链接的包默认不会被预构建（因为不在 `node_modules` 的标准路径下），但它内部的 `import { format } from 'date-fns'` 就会穿透到浏览器。

## 三、实战优化：optimizeDeps 配置详解

### 3.1 显式声明 include

最直接的优化方式是在 `vite.config.ts` 里手动列出需要预构建的依赖：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'resources/js'),
    },
  },
  optimizeDeps: {
    include: [
      // 核心框架
      'vue',
      'vue-router',
      'pinia',

      // UI 库（这些往往有大量子模块）
      'element-plus',
      '@element-plus/icons-vue',

      // 工具库（CJS 混合 ESM，最容易出问题）
      'axios',
      'dayjs',
      'dayjs/plugin/utc',
      'dayjs/plugin/timezone',
      'dayjs/plugin/locale/zh-tw',
      'lodash-es',

      // 图表 / 富文本等重型依赖
      'echarts',
      'echarts/core',
      'echarts/charts',
      'echarts/components',
      'echarts/renderers',
      'quill',
    ],
  },
})
```

**踩坑记录**：`dayjs` 的插件必须单独列出。我们项目里用了 `dayjs.extend(utc)`，但 Vite 预构建只包含 `dayjs` 主包，`dayjs/plugin/utc` 作为 CJS 模块在浏览器里直接报 `require is not defined`。加上 `include` 后解决。

### 3.2 exclude 排除不需要预构建的包

有些包本身就是纯 ESM 且模块数量少，预构建反而多此一举：

```typescript
optimizeDeps: {
  include: [/* ... */],
  exclude: [
    // 纯 ESM + 模块少，预构建没收益
    '@vueuse/core',

    // 本地开发时通过 CDN 加载的包
    'vue-demi',
  ],
}
```

### 3.3 esbuild 选项调优

预构建用的是 esbuild，可以传入额外选项：

```typescript
optimizeDeps: {
  esbuildOptions: {
    // 支持 JSX（如果你用 React 组件嵌在 Vue 里）
    jsx: 'automatic',

    // 增加并发处理的文件数（大型 monorepo 有用）
    // 默认 100，大型项目可以调高
    target: 'es2020',

    // 解决某些 CJS 模块的 define 问题
    define: {
      global: 'globalThis',
    },

    // 处理 CommonJS 的 named export 问题
    // 某些 CJS 包用了 Object.defineProperty(exports, ...)，
    // esbuild 默认不处理，需要开启
    supported: {
      'top-level-await': true,
    },
  },
}
```

**踩坑记录**：`axios` 的某些版本在预构建时会报 `Top-level await is not supported`，需要把 `target` 设为 `es2022` 或在 `esbuildOptions.supported` 里显式开启 `top-level-await`。

## 四、缓存机制深度解析

### 4.1 文件系统缓存

Vite 预构建的结果存在 `node_modules/.vite/deps` 目录下：

```text
node_modules/.vite/
  ├── deps/
  │   ├── vue.js
  │   ├── vue.js.map
  │   ├── axios.js
  │   ├── element-plus.js
  │   └── _metadata.json    ← 缓存元数据
  └── package.json
```

`_metadata.json` 是缓存是否有效的判断依据：

```json
{
  "hash": "a1b2c3d4...",
  "browserHash": "e5f6g7h8...",
  "optimized": {
    "vue": {
      "src": "../../node_modules/vue/dist/vue.runtime.esm-bundler.js",
      "file": "vue.js",
      "fileHash": "i9j0k1l2..."
    }
  }
}
```

当以下任一条件变化时，缓存失效并重新预构建：

1. **`package.json` 变化**：安装/卸载了依赖
2. **lockfile 变化**：`pnpm-lock.yaml` 或 `package-lock.json` 变了
3. **`optimizeDeps.include` 变化**：你改了 vite.config.ts
4. **`vite.config.ts` 中的 `optimizeDeps` 配置变化**

### 4.2 手动清除缓存

遇到奇怪的开发时错误（比如模块版本冲突），第一步就是清缓存：

```bash
# 方法 1：删除缓存目录
rm -rf node_modules/.vite

# 方法 2：用 Vite 的 --force 参数
npx vite --force

# 方法 3：在 package.json 里加脚本
{
  "scripts": {
    "dev:clean": "rm -rf node_modules/.vite && vite",
    "dev": "vite"
  }
}
```

**踩坑记录**：我们团队遇到过一个问题——`pnpm install` 之后 `.vite` 缓存没失效，导致开发时用的是旧版本的 `element-plus`，组件样式错乱。排查发现是 pnpm 的 content-addressable store 导致文件 hash 没变。解法是在 CI 脚本和 `postinstall` 钩子里强制清缓存：

```json
{
  "scripts": {
    "postinstall": "rm -rf node_modules/.vite"
  }
}
```

### 4.3 浏览器端缓存

预构建产物在浏览器端也会被缓存。Vite 用 `browserHash` 做 cache-busting：

```text
请求 URL: /node_modules/.vite/deps/vue.js?v=a1b2c3d4
                                                ^^^^^^^^
                                                browserHash
```

当 `browserHash` 变化时，浏览器会重新请求。所以**不要在 nginx 层面给 `.vite/deps` 路径加 `Cache-Control: max-age=31536000`**——我们踩过这个坑，发版后用户看到的还是旧版本的 Vue，因为 CDN 缓存了旧的预构建产物。

正确做法：

```nginx
# nginx.conf
location /node_modules/.vite/ {
    # 预构建产物用 hash 做缓存，短期缓存即可
    add_header Cache-Control "public, max-age=31536000, immutable";
    # Vite 自带 hash，不用担心缓存问题
}
```

等等，上面是错的。因为开发模式下 `.vite` 路径才有效，生产模式不用这个路径。**生产模式下 Vite 会把所有依赖打进 bundle**，不走预构建。所以这个配置只影响开发环境，一般不需要配 nginx。

## 五、Monorepo 场景的特殊处理

在 pnpm workspace 的 monorepo 里，预构建问题会更复杂。

### 5.1 问题场景

```text
monorepo/
  ├── packages/
  │   ├── shared-types/    ← workspace 包，纯 TypeScript
  │   │   └── src/index.ts  (export type User = {...})
  │   ├── admin-utils/     ← workspace 包，有运行时代码
  │   │   └── src/format.ts (import dayjs from 'dayjs')
  │   └── web-admin/       ← 主应用
  │       └── vite.config.ts
  └── pnpm-workspace.yaml
```

`web-admin` 引用 `@kkday/admin-utils`，而 `admin-utils` 内部 import 了 `dayjs`。问题是 Vite 不会自动预构建 `admin-utils` 的间接依赖。

### 5.2 解法

```typescript
// packages/web-admin/vite.config.ts
export default defineConfig({
  optimizeDeps: {
    include: [
      // 显式列出 workspace 包的间接依赖
      'dayjs',
      'dayjs/plugin/utc',
      'dayjs/plugin/timezone',

      // workspace 包本身如果包含 CJS 代码，也要加
      '@kkday/admin-utils',
    ],
  },
  resolve: {
    // 确保 workspace 包能被正确解析
    preserveSymlinks: false,
  },
})
```

**踩坑记录**：`preserveSymlinks: false` 是关键。pnpm 默认创建 symlink，如果设为 `true`，Vite 会把 symlink 当成独立包，导致预构建产物重复且不一致。我们项目里因此出现过两个不同版本的 Vue 同时运行的诡异 bug。

### 5.3 自动化发现脚本

手动维护 `include` 列表容易遗漏。我写了个脚本自动扫描 workspace 依赖：

```javascript
// scripts/find-prebundle-deps.mjs
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

function findWorkspaceDeps(workspaceDir) {
  const deps = new Set()

  function scanPkgJson(pkgPath) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.peerDependencies,
      }

      for (const [name, version] of Object.entries(allDeps)) {
        // 排除 workspace 包和类型包
        if (!name.startsWith('@kkday/') && !name.startsWith('@types/')) {
          deps.add(name)
        }
      }
    } catch {}
  }

  // 扫描 workspace 包
  const packagesDir = join(workspaceDir, 'packages')
  for (const dir of readdirSync(packagesDir)) {
    const pkgJson = join(packagesDir, dir, 'package.json')
    scanPkgJson(pkgJson)
  }

  // 扫描主应用
  scanPkgJson(join(workspaceDir, 'packages/web-admin/package.json'))

  return [...deps].sort()
}

const deps = findWorkspaceDeps(process.cwd())
console.log('// Auto-generated optimizeDeps.include')
console.log(JSON.stringify(deps, null, 2))
```

```bash
node scripts/find-prebundle-deps.mjs > /tmp/prebundle-deps.json
```

然后把输出贴到 `vite.config.ts` 的 `include` 里。不完美但比手动维护靠谱。

## 六、性能对比数据

以下是我项目优化前后的实测数据（macOS M2, 300+ 组件, 80+ npm 依赖）：

```text
指标                          优化前        优化后       提升
─────────────────────────────────────────────────────────
首次 dev 启动（冷启动）        8.2s         6.1s        26%
预构建耗时                     4.5s         2.8s        38%
浏览器首次加载                  20s          2.2s        89%
HTTP 请求数（首次加载）          487          23          95%
HMR 热更新延迟                  3.1s         0.18s       94%
node_modules/.vite 大小         -            12MB        -
```

最大的提升来自**浏览器请求数**——从 487 个降到 23 个。这就是预构建的核心价值：把几百个细粒度模块打包成少量大文件，消除请求瀑布。

## 七、调试技巧

### 7.1 查看预构建日志

```bash
# 开启 debug 日志
DEBUG=vite:deps npx vite

# 输出示例：
# vite:deps new dependencies found: vue, axios, dayjs, element-plus
# vite:deps pre-bundling started: vue + 2 modules
# vite:deps pre-bundling started: axios
# vite:deps pre-bundling started: element-plus + 186 modules  ← 这个很慢
```

### 7.2 检查预构建产物

```bash
# 查看预构建产物大小
du -sh node_modules/.vite/deps/*

# 查看哪些模块被打进了某个 bundle
npx vite-bundle-visualizer --open

# 或者直接看 source map
cat node_modules/.vite/deps/element-plus.js.map | jq '.sources'
```

### 7.3 强制重新预构建

```bash
# 有时候缓存有问题，需要强制重建
npx vite --force 2>&1 | grep "pre-bundling"

# 输出：
# vite:deps ✨ new dependencies found: vue, axios
# vite:deps ✨ pre-bundling started: vue + 2 modules
# vite:deps ✨ pre-bundling complete in 280ms
```

## 八、常见踩坑总结

```text
问题                              原因                          解法
────────────────────────────────────────────────────────────────────────
"require is not defined"          CJS 模块没被预构建            加入 optimizeDeps.include
首次加载几百个 304                  依赖没被预构建               显式声明 include
dayjs 插件报错                     插件是 CJS 但没被包含        单独列出插件路径
HMR 变慢                          缓存失效反复预构建            检查 postinstall 是否清缓存
两个 Vue 实例                      preserveSymlinks + pnpm      设为 false
monorepo 依赖穿透                  workspace 包间接依赖         手动或脚本扫描加入 include
element-plus 预构建慢               186 个子模块                 单独拆分或用按需导入
```

## 九、架构总览

```text
开发模式预构建流程：
┌──────────────┐     扫描 import      ┌──────────────┐
│  Source Code  │ ──────────────────→ │  Vite Deps   │
│  (你的代码)    │                     │  Scanner     │
└──────────────┘                     └──────┬───────┘
                                            │
                                    发现需要预构建的包
                                            │
                                            ▼
                                   ┌──────────────┐
                                   │    esbuild    │
                                   │  (打包 CJS→ESM)│
                                   └──────┬───────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ node_modules/.vite│
                                   │     /deps/        │
                                   │  vue.js           │
                                   │  axios.js         │
                                   │  element-plus.js  │
                                   │  _metadata.json   │
                                   └──────────────────┘
                                            │
                                    浏览器请求时
                                            │
                                            ▼
                                   ┌──────────────┐
                                   │   浏览器      │
                                   │  (23 个请求)   │
                                   └──────────────┘
```

## 十、总结

预构建优化不需要什么黑科技，关键是理解机制后**主动管理依赖列表**：

1. **不要依赖自动发现**——显式声明 `optimizeDeps.include`
2. **CJS 插件要单独列出**——`dayjs/plugin/utc` 这种不会被自动发现
3. **Monorepo 的间接依赖要手动扫描**——workspace 包的依赖会穿透
4. **清缓存要彻底**——`postinstall` 钩子里加 `rm -rf node_modules/.vite`
5. **用 `--force` 和 `DEBUG=vite:deps` 调试**——别猜，看日志

预构建做好了，开发体验的提升是立竿见影的——从 20 秒白屏到 2 秒加载，HMR 从 3 秒到 200ms。这比换电脑、换网络实在得多。

## 十一、Vite 预构建 vs Webpack DLL 对比

很多从 Webpack 迁移过来的开发者会问：Vite 的预构建和 Webpack 的 DLL Plugin 有什么区别？下表做一个全面对比：

| 维度 | Vite 预构建 (optimizeDeps) | Webpack DLL Plugin |
|------|--------------------------|-------------------|
| **打包工具** | esbuild（Go 编写，比 JS 快 10-100 倍） | Webpack 自身（Node.js） |
| **触发时机** | 开发模式启动时自动执行 | 需要手动运行 `webpack --config dll.config.js` |
| **产物格式** | ESM（浏览器原生支持） | IIFE + 全局变量（需 manifest 映射） |
| **缓存机制** | 基于文件 hash 自动失效（`_metadata.json`） | 手动管理 DLL 产物版本 |
| **增量更新** | 只重建变化的依赖 | 全量重建整个 DLL bundle |
| **生产构建** | 不参与（生产模式走 Rollup） | 需要额外配置 `DllReferencePlugin` |
| **Monorepo 支持** | 需手动声明 workspace 间接依赖 | 需要额外 resolve 配置 |
| **冷启动耗时（80 依赖）** | ~2-3s（esbuild 极快） | ~15-30s（Webpack 较慢） |
| **配置复杂度** | `optimizeDeps.include` 数组即可 | 需要独立 dll.config + manifest 引用 |

**核心差异**：Vite 的预构建用 esbuild（Go 原生编译），速度是 Webpack 的 10-100 倍，且产物直接是 ESM 格式，不需要像 DLL 那样维护 manifest 映射文件。但 Vite 的预构建只在**开发模式**生效，生产构建走 Rollup，这与 Webpack DLL 需要在生产环境也引用是完全不同的思路。

## 十二、额外的 troubleshooting 案例

### 案例 1：SSR 场景下预构建失效

在 Nuxt 3 / Vite SSR 模式下，服务端渲染时也会触发预构建，但行为与纯客户端不同：

```typescript
// vite.config.ts — SSR 专用配置
export default defineConfig({
  optimizeDeps: {
    include: ['vue', 'vue-router', 'pinia'],
  },
  ssr: {
    // SSR 外部化：这些包在服务端不走预构建，直接用 Node.js require
    noExternal: ['element-plus'],
    // 如果某个包在 SSR 下报错，可以加入 external 强制外部化
    external: ['dayjs'],
  },
})
```

**踩坑记录**：`element-plus` 在 SSR 下如果被外部化（走 Node.js CJS），会丢失样式注入。需要加 `noExternal` 强制走 Vite 预构建路径。

### 案例 2：预构建与 CSS Modules 冲突

```text
错误：[vite] Pre-transform error: Invalid file extension for css module
```

当某个依赖内部用了 `.module.css` 但你 exclude 了该包时，预构建不会处理 CSS 模块，运行时报错。解法：把该包移出 `exclude` 列表，或在 `css.modules` 里配置 `localsConvention`。

### 案例 3：预构建产物体积过大

如果 `node_modules/.vite/deps` 目录超过 50MB，说明预构建打包了不必要的子模块。可以用以下方式分析：

```bash
# 查看各产物大小
du -sh node_modules/.vite/deps/* | sort -rh | head -20

# 如果 element-plus.js 超过 5MB，考虑用按需导入
# vite-plugin-style-import 或 unplugin-vue-components
```

## 相关阅读

- [Vite vs Webpack：前端构建工具选型对比实战](/categories/Frontend/vite-vs-webpack-laravel-mix-vs/)
- [前端构建优化实战：Vite/Webpack 分包策略与缓存优化踩坑记录](/categories/Frontend/build-optimization-vite-webpack/)
- [Vue 3 + Vite 实战：HMR 构建优化与环境变量管理](/categories/Frontend/vue-3-vite-guide-hmr-optimization/)
