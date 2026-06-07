# React 19 编译器：自动记忆化

## 定义

React Compiler（原名 React Forget）是构建时编译器，通过 AST 静态分析自动识别需要记忆化的值并插入缓存逻辑，完全取代手动 `useMemo`/`useCallback`/`React.memo`。优化粒度达到表达式级别，远超手动优化的精度。

## 核心原理

### 工作流程

```
源代码 → Parse（Babel AST）→ Semantic Analysis（依赖追踪）
    → Auto-Memoization Insertion（useMemoCache）→ 优化后代码
```

### 传统痛点 vs 编译器方案

| 痛点 | 传统方式 | 编译器方案 |
|---|---|---|
| 代码噪音 | `useMemo`/`useCallback` 到处都是 | 零手动标注 |
| 依赖数组陷阱 | 忘记/多写依赖导致 bug | 自动分析精确依赖 |
| 过度记忆化 | 对简单值也缓存，浪费内存 | 仅对有收益的值缓存 |
| 不足记忆化 | 复杂表达式漏缓存 | 表达式级别独立缓存 |
| 组件级优化 | `React.memo` 只能整个组件跳过 | 内部每个中间值独立缓存 |

### 表达式级别缓存

```jsx
// 传统方式：手动 useMemo，粒度粗糙
function ProductList({ products, category }) {
  const filtered = useMemo(
    () => products.filter(p => p.category === category),
    [products, category]
  )
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.price - b.price),
    [filtered]
  )
  const total = useMemo(
    () => sorted.reduce((sum, p) => sum + p.price, 0),
    [sorted]
  )
  // 任何一个值变化，整个组件重渲染
}

// 编译器方式：自动记忆化，表达式级别
function ProductList({ products, category }) {
  const filtered = products.filter(p => p.category === category)
  const sorted = [...filtered].sort((a, b) => a.price - b.price)
  const total = sorted.reduce((sum, p) => sum + p.price, 0)
  // 编译器自动为每个中间值插入缓存
  // category 变了 → filtered 重算 → sorted 重算 → total 重算
  // products 变了但 category 没变 → filtered 不重算
}
```

### 编译器底层使用 `useMemoCache`

编译器不生成传统的 `useMemo`/`useCallback`，而是使用更底层的 `useMemoCache` 原语：

```javascript
// 编译器输出（简化示意）
function ProductList({ products, category }) {
  const _cache = useMemoCache(4)
  
  // slot 0: filtered
  if (_cache[0] !== products || _cache[1] !== category) {
    _cache[2] = products.filter(p => p.category === category)
    _cache[0] = products
    _cache[1] = category
  }
  const filtered = _cache[2]
  
  // slot 3: sorted（依赖 filtered）
  // ...
}
```

### 启用方式

**Vite 配置**：
```typescript
// vite.config.ts
import { reactCompiler } from 'babel-plugin-react-compiler'

export default defineConfig({
  plugins: [
    reactCompiler({
      sources: (filename) => filename.includes('src/')
    })
  ]
})
```

**Next.js 配置**：
```javascript
// next.config.js
const nextConfig = {
  experimental: {
    reactCompiler: true
  }
}
```

## 实战案例

来自博客文章：
- [React 19 Compiler 实战：自动记忆化取代 useMemo/useCallback——React 性能优化范式的根本性转变](/2026/06/04/react-19-compiler-auto-memoization-revolution/)

## 相关概念

- [React 状态管理选型](React状态管理选型.md) - Zustand/Jotai/Redux 对比
- [SolidJS 细粒度响应式](SolidJS细粒度响应式.md) - 无 VDOM 的变量级精确更新
- [Signals 响应式范式](Signals响应式范式.md) - 各框架响应式原理对比

## 常见问题

### Q: 编译器能完全替代 useMemo/useCallback 吗？
在大多数场景下可以。但编译器可能在某些边界情况下不触发优化（如违反 React 规则的代码），此时仍需手动标注。

### Q: 对现有项目有侵入性吗？
编译器是渐进式启用的。可以先对部分目录启用，观察效果后再逐步扩大范围。对未启用的代码完全无影响。

### Q: 与 React DevTools Profiler 如何配合？
编译器优化后，DevTools Profiler 仍然有效。可以对比启用前后的渲染次数来验证优化效果。
