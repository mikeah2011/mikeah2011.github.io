# React 状态管理选型：Zustand vs Jotai vs Redux

## 定义

React 状态管理是前端架构的核心决策之一。2026 年的生态已从 Redux 一家独大演进为三条路线并存：

- **Redux Toolkit（RTK）**：企业级集中式 Store，适合大型团队和复杂业务逻辑
- **Zustand**：轻量级 Store 模式，~1KB gzip，零依赖，无需 Provider
- **Jotai**：原子化状态，自底向上组织，与 React Suspense 深度集成

## 核心原理

### 状态管理三个时代

| 时代 | 代表 | 特点 |
|---|---|---|
| Redux 统治期 | Redux + saga/thunk | 严格单向数据流，模板代码多 |
| 简化/原子化探索期 | Recoil, Zustand, Jotai | 降低心智负担，API 精简 |
| 轻量务实主义 | Zustand, Jotai | ~1KB，无 Provider，按需采用 |

### Zustand：Store 模式

核心 API 仅一个 `create` 函数：

```typescript
import { create } from 'zustand'

const useStore = create((set, get) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  // 异步操作直接定义在 store 中
  fetchData: async () => {
    const data = await api.get('/data')
    set({ data })
  }
}))
```

**Selector 实现精确订阅**：
```typescript
// ✅ 只在 count 变化时重渲染
const count = useStore((state) => state.count)

// ✅ shallow 比较解决多值 selector
import { shallow } from 'zustand/shallow'
const { name, age } = useStore(
  (state) => ({ name: state.name, age: state.age }),
  shallow
)
```

**中间件生态**：
- `persist`：localStorage/sessionStorage 持久化
- `immer`：不可变更新语法糖
- `devtools`：Redux DevTools 集成

### Jotai：原子化模式

核心 API 仅有 `atom` 和 `useAtom`：

```typescript
import { atom, useAtom } from 'jotai'

// 基础原子
const countAtom = atom(0)

// 派生原子（自动追踪依赖）
const priceAtom = atom(10)
const qtyAtom = atom(2)
const totalAtom = atom((get) => get(priceAtom) * get(qtyAtom))

// 可写派生原子（双向绑定）
const celsiusAtom = atom(0)
const fahrenheitAtom = atom(
  (get) => get(celsiusAtom) * 9/5 + 32,
  (get, set, newValue) => set(celsiusAtom, (newValue - 32) * 5/9)
)
```

**异步原子与 Suspense**：
```typescript
const userAtom = atom(async () => {
  const res = await fetch('/api/user')
  return res.json()
})

// 自动集成 Suspense
function UserProfile() {
  const [user] = useAtom(userAtom)
  return <div>{user.name}</div>
}
```

**高级工具**：
- `atomFamily`：按参数动态创建缓存原子
- `atomWithStorage`：内置 localStorage 持久化（SSR 安全）
- `Provider`：作用域隔离（微前端、测试）

### 设计哲学对比

| 维度 | Zustand | Jotai | Redux |
|---|---|---|---|
| 组织方式 | 自顶向下（Store） | 自底向上（Atom） | 自顶向下（Store） |
| Provider | ❌ 不需要 | ⚠️ 可选 | ✅ 必需 |
| 包体积 | ~1KB | ~2KB | ~11KB (RTK) |
| 学习曲线 | 极低 | 低 | 中等 |
| DevTools | ✅ 中间件 | ✅ 插件 | ✅ 内置 |
| 异步处理 | 直接在 store | Async atoms | middleware (thunk/saga) |
| 适用规模 | 中小型 → 大型 | 中小型 → 大型 | 大型企业级 |

## 实战案例

来自博客文章：
- [Zustand 实战：轻量级 React 状态管理——对比 Redux/Jotai/Recoil 的工程选型与最佳实践](/2026/06/05/Zustand-实战-轻量级React状态管理-对比Redux-Jotai-Recoil的工程选型与最佳实践/)
- [Jotai 实战：原子化状态管理——对比 Zustand/Redux 的细粒度响应式与 React Suspense 集成](/2026/06/05/Jotai-实战-原子化状态管理-对比Zustand-Redux的细粒度响应式与React-Suspense集成/)

## 选型决策矩阵

```
需要企业级严格单向数据流？→ Redux Toolkit
↓ 否
需要原子级细粒度响应 + Suspense？→ Jotai
↓ 否
需要极简 Store + 最小包体积？→ Zustand
```

## 相关概念

- [SolidJS 细粒度响应式](SolidJS细粒度响应式.md) - 无 VDOM 的变量级精确更新
- [Signals 响应式范式](Signals响应式范式.md) - Angular/Vue/Solid/Preact 响应式对比
- [React 19 编译器](React19编译器.md) - 自动记忆化取代手动 useMemo
- [Vue 3 Composition API](Vue3-Composition-API.md) - Vue 的响应式系统

## 常见问题

### Q: Zustand 和 Jotai 可以混用吗？
可以。Zustand 管理全局 UI 状态（主题、用户信息），Jotai 管理局部/派生状态（表单、计算值），两者互补。

### Q: 什么时候该用 Redux？
当团队规模 > 10 人、需要严格的状态变更审计、或已有 Redux 生态投入时，RTK 仍然是合理选择。

### Q: Jotai 的 Provider 有什么用？
Provider 创建独立的 atom 存储作用域，适用于微前端（每个子应用独立状态）和测试（每个测试用例隔离状态）。
