# React Server Components

## 定义
React Server Components (RSC) 是 React 18+ 引入的新范式，允许组件在服务端渲染并以流式方式发送到客户端。结合 Next.js App Router，实现服务端与客户端组件的灵活混合。

## 核心原理

### 服务端 vs 客户端组件
```typescript
// 服务端组件（默认）- 不发送 JS 到客户端
// app/page.tsx
async function ProductPage() {
  const products = await db.product.findMany()  // 直接访问数据库
  return <ProductList products={products} />
}

// 客户端组件 - 包含交互逻辑
'use client'
function AddToCartButton({ productId }) {
  const [loading, setLoading] = useState(false)
  return <button onClick={() => addToCart(productId)}>加入购物车</button>
}
```

### 流式渲染
```
服务端渲染 → HTML 流式传输 → 浏览器渐进式展示
           → Suspense 边界 → 异步组件独立加载
```

### 优势
- **零客户端 JS** - 服务端组件不发送 JS bundle
- **直接访问数据源** - 数据库、文件系统、内部 API
- **自动代码分割** - 客户端组件按需加载
- **SEO 友好** - 服务端渲染 HTML

### B2C 电商应用
```
页面结构：
├── 服务端组件：商品列表、价格、SEO 元信息
├── 客户端组件：购物车按钮、搜索框、轮播图
└── 共享组件：导航栏、页脚
```

## 实战案例
来自博客文章：
- [React Server Components 实战](/categories/前端/react-server-components-nextjs-15-rsc-b2c-ecommerce/) - Next.js 15 RSC 模式在 B2C 电商中的落地踩坑记录

## 相关概念
- [Nuxt 4 全栈框架](Nuxt4全栈框架.md) - Vue 生态的类似方案（Server Components）
- [SvelteKit 全栈框架](SvelteKit全栈框架.md) - Svelte 的全栈方案
- [Core Web Vitals 性能治理](Core-Web-Vitals性能治理.md) - RSC 对性能指标的改善

## 常见问题

**Q: RSC 适合什么项目？**
A: 内容驱动型网站（电商、博客、文档）。纯 SPA 管理后台意义不大。

**Q: Vue 有类似 RSC 的方案吗？**
A: Nuxt 4 引入了 Server Components，概念类似但实现不同。
