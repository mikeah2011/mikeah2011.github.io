# uni-app 性能优化

## 定义
uni-app 性能优化是指针对跨平台应用的首屏加载速度、分包策略、图片懒加载、原生渲染等维度进行系统性优化，目标是从 5s+ 首屏优化到 800ms 以内。

## 核心原理

### 首屏加载优化
1. **分包加载** - 将非首屏页面拆到子包，减少主包体积
2. **图片懒加载** - 使用 `lazy-load` 属性延迟加载屏幕外图片
3. **数据预取** - 在 `onLoad` 阶段发起数据请求，与渲染并行
4. **骨架屏** - 首屏渲染前展示占位 UI

### 分包策略
```json
// pages.json
{
  "pages": [
    { "path": "pages/index/index" },
    { "path": "pages/login/login" }
  ],
  "subPackages": [
    {
      "root": "pages/order",
      "pages": [
        { "path": "list" },
        { "path": "detail" }
      ]
    }
  ],
  "preloadRule": {
    "pages/index/index": {
      "network": "all",
      "packages": ["pages/order"]
    }
  }
}
```

### nvue 原生渲染
对于性能敏感的页面（长列表、复杂动画），使用 nvue 文件实现原生渲染：
- 使用 Weex 原生渲染引擎
- CSS 支持有限（Flexbox 布局）
- 列表使用 `<list>` 组件替代 `<scroll-view>`

### 图片优化
- 使用 WebP 格式
- `lazy-load` 属性
- CDN 图片裁剪（`?x-oss-process=image/resize,w_300`）
- 雪碧图减少请求数

## 实战案例
来自博客文章：
- [uni-app 性能优化实战](/categories/Frontend/2026-06-01-uni-app-performance-optimization-first-screen-subpackage-image-lazy-load/) - 首屏加载、分包加载、图片懒加载
- [uni-app nvue 原生渲染优化](/categories/Frontend/uni-app-nvue-optimizationguide/) - 页面性能调优

## 相关概念
- [uni-app 跨平台开发](uni-app跨平台开发.md) - uni-app 基础知识
- [Core Web Vitals 性能治理](Core-Web-Vitals性能治理.md) - H5 场景的性能指标
- [构建优化策略](构建优化策略.md) - 构建层面的优化

## 常见问题

**Q: 分包大小限制？**
A: 微信小程序主包 2MB，分包 2MB，总包 20MB。合理分包是关键。

**Q: nvue 和 vue 页面能混用吗？**
A: 可以。nvue 页面用于性能敏感场景，vue 页面用于普通场景，通过路由自然切换。
