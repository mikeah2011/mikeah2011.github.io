# Nuxt 4 全栈框架

## 定义
Nuxt 4 是基于 Vue 3 的全栈框架，提供服务器端渲染（SSR）、静态站点生成（SSG）、文件路由、自动导入等能力。Nuxt 4 引入了服务器组件（Server Components）等新范式。

## 核心原理

### 服务器组件（Server Components）
Nuxt 4 支持 Vue Server Components，组件在服务端渲染，不发送 JavaScript 到客户端：
```vue
<!-- *.server.vue 仅在服务端执行 -->
<template>
  <div>{{ heavyDataComputed }}</div>
</template>
```

### 自动导入
- Vue API（ref, computed, watch）自动导入
- 组件自动注册（`components/` 目录）
- 组合式函数自动导入（`composables/` 目录）

### 文件路由
```
pages/
├── index.vue          → /
├── about.vue          → /about
└── users/
    ├── index.vue      → /users
    └── [id].vue       → /users/:id
```

### 渲染模式
| 模式 | 说明 | 适用场景 |
|------|------|---------|
| SSR | 服务端渲染 | SEO 重要、动态内容 |
| SSG | 静态生成 | 博客、文档站 |
| CSR | 客户端渲染 | 管理后台 |
| 混合 | 按路由配置 | 复杂应用 |

### SEO 优化
```typescript
useHead({
  title: '页面标题',
  meta: [
    { name: 'description', content: '页面描述' }
  ]
})

useSeoMeta({
  ogTitle: 'OG 标题',
  ogDescription: 'OG 描述'
})
```

## 实战案例
来自博客文章：
- [Nuxt 4 实战](/categories/前端/2026-06-02-nuxt-4-vue-fullstack-server-components-auto-import-seo/) - 服务器组件、自动导入与 SEO 优化

## 相关概念
- [Vue 3 Composition API](Vue3-Composition-API.md) - Nuxt 4 基于 Vue 3 Composition API
- [Vite 深度实战](Vite深度实战.md) - Nuxt 4 底层使用 Vite 构建
- [Core Web Vitals 性能治理](Core-Web-Vitals性能治理.md) - SSR 对性能指标的影响

## 常见问题

**Q: Nuxt vs Next.js 如何选择？**
A: Vue 技术栈选 Nuxt，React 技术栈选 Next.js。功能上两者越来越趋同。

**Q: Nuxt 4 和 Nuxt 3 有什么区别？**
A: Nuxt 4 在 Nuxt 3 基础上引入服务器组件、改进的构建系统、更好的 TypeScript 支持。
