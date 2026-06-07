# Vite 深度实战

## 定义
Vite 是下一代前端构建工具，利用浏览器原生 ESM 和 esbuild 预构建实现极快的开发启动和热更新。生产环境使用 Rollup 打包，提供开箱即用的优化。

## 核心原理

### 开发阶段架构
```
浏览器请求 → Vite Dev Server → esbuild 预构建 node_modules
                                → 源码按需编译（原生 ESM）
                                → HMR 精确更新变更模块
```

### 与 Webpack 的本质区别

| 维度 | Webpack | Vite |
|------|---------|------|
| 开发服务器 | 全量打包后启动 | 按需编译，秒级启动 |
| 模块格式 | CommonJS 模拟 | 原生 ESM |
| HMR | 模块级全量重编译 | 精确到变更模块 |
| 生产打包 | Webpack 自身 | Rollup |
| 预构建 | 无 | esbuild（原生速度） |
| Tree Shaking | 基础 | 原生 ESM 自动 |

### 依赖预构建
Vite 使用 esbuild 将 CommonJS/UMD 依赖转换为 ESM：
- 解决 CommonJS 的 `require` 语法
- 将零散的小模块合并，减少 HTTP 请求
- 缓存在 `node_modules/.vite` 目录

### HMR 原理
```
文件变更 → Vite 检测 → 仅编译变更模块
         → WebSocket 推送更新消息
         → 浏览器精确替换模块，不刷新页面
```

## 关键配置

### vite.config.ts 核心配置
```typescript
export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          echarts: ['echarts']
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
})
```

### 与 Laravel 集成
```typescript
// vite.config.ts
import laravel from 'laravel-vite-plugin'

export default defineConfig({
  plugins: [
    laravel({
      input: ['resources/css/app.css', 'resources/js/app.js'],
      refresh: true
    })
  ]
})
```

## 实战案例
来自博客文章：
- [Vite Laravel 实战](/categories/Frontend/vite-laravel-guide/) - 前后端分离开发工作流
- [Vite 6.x 实战](/categories/Frontend/vite-6-x-guide-ssroptimization/) - 插件开发、SSR、构建优化
- [Vite 预构建优化](/categories/Frontend/vite-optimizationguide-cache/) - 依赖预构建与缓存策略
- [Vue 3 + Vite HMR 实战](/categories/Frontend/vue-3-vite-guide-hmr-optimization/) - HMR 构建优化与环境变量管理

## 相关概念
- [构建工具选型](构建工具选型.md) - Vite vs Webpack vs Laravel Mix 对比
- [构建优化策略](构建优化策略.md) - 分包、缓存、预构建优化
- [Nuxt 4 全栈框架](Nuxt4全栈框架.md) - Nuxt 4 底层使用 Vite

## 常见问题

**Q: Vite 生产环境稳定吗？**
A: 稳定。Vite 生产构建使用成熟的 Rollup，已被大量企业项目验证。

**Q: 什么时候不适合用 Vite？**
A: 需要 Webpack 特有插件生态、或依赖 CommonJS 模块的遗留项目。
