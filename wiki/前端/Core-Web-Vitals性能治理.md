# Core Web Vitals 性能治理

## 定义
Core Web Vitals (CWV) 是 Google 提出的用户体验指标体系，包含 LCP（加载性能）、INP（交互响应）、CLS（视觉稳定性）三个核心指标，已成为搜索排名的关键因素。

## 核心原理

### 三大指标

| 指标 | 全称 | 衡量维度 | 优秀 | 需改进 | 差 |
|------|------|---------|------|--------|-----|
| **LCP** | Largest Contentful Paint | 加载性能 | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| **INP** | Interaction to Next Paint | 交互响应 | ≤ 200ms | ≤ 500ms | > 500ms |
| **CLS** | Cumulative Layout Shift | 视觉稳定性 | ≤ 0.1 | ≤ 0.25 | > 0.25 |

> 2024 年起 FID 已被 INP 取代。

### LCP 优化策略
- 关键资源预加载（`<link rel="preload">`）
- JavaScript 代码分割与懒加载
- 图片格式优化（WebP/AVIF）
- 服务端响应加速（TTFB < 800ms）
- CDN 静态资源分发

### INP 优化策略
- 长任务拆分（`requestIdleCallback`）
- Web Worker 处理计算密集型任务
- 减少主线程阻塞
- 虚拟列表优化大列表渲染

### CLS 优化策略
- 图片/视频设置明确的 `width`/`height`
- 字体加载使用 `font-display: optional`
- 避免动态插入内容导致布局偏移
- 骨架屏占位

### 前后端协同
```
前端优化：代码分割、懒加载、图片优化、字体优化
后端优化：API 响应速度、TTFB、Gzip/Brotli 压缩
基础设施：CDN、HTTP/2、缓存策略
```

## 实战案例
来自博客文章：
- [Core Web Vitals 实战](/categories/前端/Core-Web-Vitals实战-LCP-FID-CLS优化-Vue3-Laravel前后端协同性能治理/) - Vue 3 + Laravel 前后端协同性能治理

## 相关概念
- [构建优化策略](构建优化策略.md) - 构建层面的性能优化
- [Vite 深度实战](Vite深度实战.md) - Vite 的构建优化能力
- [Nuxt 4 全栈框架](Nuxt4全栈框架.md) - SSR 对 LCP 的改善

## 常见问题

**Q: CWV 数据怎么采集？**
A: 使用 Chrome DevTools 的 Lighthouse、PageSpeed Insights，或 CrUX 数据（Google Search Console）。

**Q: CWV 对 SEO 影响大吗？**
A: 是排名因素之一，但内容质量仍是核心。CWV 差会影响排名，但 CWV 好不会自动获得高排名。
