# SvelteKit 全栈框架

## 定义
SvelteKit 是基于 Svelte 的全栈框架，类似 Next.js（React）和 Nuxt（Vue）的定位。Svelte 的核心特点是编译时框架——在构建阶段将组件编译为原生 JavaScript，运行时无虚拟 DOM 开销。

## 核心原理

### 与 Next.js / Nuxt 对比

| 维度 | Next.js | Nuxt | SvelteKit |
|------|---------|------|-----------|
| 底层框架 | React | Vue | Svelte |
| 渲染模式 | SSR/SSG/ISR/RSC | SSR/SSG/混合 | SSR/SSG/混合 |
| 运行时开销 | 虚拟 DOM | 虚拟 DOM + Proxy | 无虚拟 DOM |
| 包体积 | 较大 | 中等 | 较小 |
| 学习曲线 | 中 | 中 | 低 |
| 生态成熟度 | 高 | 高 | 中 |

### Svelte 核心特点
- 编译时框架，无运行时开销
- 响应式声明（`$:` 标记）
- 内置过渡动画
- 组件样式天然 scoped

### SvelteKit 特性
- 文件路由
- 服务端渲染
- 表单处理（Form Actions）
- API 路由
- 适配器系统（Node/Vercel/Cloudflare）

## 实战案例
来自博客文章：
- [SvelteKit 2.x 实战](/categories/前端/SvelteKit-2x-实战-全栈框架新选择-与-Next.js-Nuxt-性能对比与开发体验评测/) - 与 Next.js/Nuxt 的性能对比与开发体验评测

## 相关概念
- [Nuxt 4 全栈框架](Nuxt4全栈框架.md) - Vue 生态的全栈方案
- [React Server Components](React-Server-Components.md) - React 生态的服务端方案
- [HTMX 轻量交互](HTMX轻量交互.md) - 另一种轻量级方案

## 常见问题

**Q: Svelte 生态够用吗？**
A: 对于中小型项目够用。大型企业项目可能缺少某些成熟组件库。

**Q: 什么时候选 SvelteKit？**
A: 追求极致性能、小团队快速开发、或想尝试新技术时。
