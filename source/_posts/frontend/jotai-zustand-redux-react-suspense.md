---

title: Jotai 实战：原子化状态管理——对比 Zustand/Redux 的细粒度响应式与 React Suspense 集成
keywords: [Jotai, Zustand, Redux, React Suspense, 原子化状态管理, 的细粒度响应式与]
date: 2026-06-05 12:00:00
tags:
- jotai
- React
- 状态管理
- 前端
- zustand
categories:
- frontend
description: 深入讲解 Jotai 原子化状态管理的核心 API（atom、derived atom、atomFamily、atomWithStorage），系统对比 Jotai vs Zustand vs Redux Toolkit 在响应粒度、模板代码、Suspense 集成上的本质差异，涵盖表单管理、多层筛选、跨组件共享等实战场景与性能优化策略，帮助前端开发者做出最佳状态管理选型。
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---



> 本文将从原子化状态管理的设计哲学出发，深入讲解 Jotai 的核心 API（atom、derived atom、atomFamily、atomWithStorage），通过与 Redux Toolkit 和 Zustand 的系统对比揭示三者在响应粒度、模板代码、学习曲线上的本质差异，最后通过完整的实战代码展示 Jotai 与 React Suspense 的深度集成、性能优化策略以及在真实项目中的应用模式。

<!-- more -->

## 一、为什么我们需要重新审视状态管理？

在 2024-2026 年的 React 生态中，状态管理格局已经发生了深刻变化。Redux 虽然仍是企业级项目的常客，但其固有的模板代码量和心智负担使得许多中小项目转向了更轻量的方案。Zustand 以其极简 API 和 store 模式赢得了大量开发者的青睐，而 Jotai 则代表了另一条路线——**原子化（atom-based）状态管理**。

原子化状态管理的核心思想源自物理学：将全局状态拆分成一个个独立的"原子"，每个原子代表一个最小状态单元。组件只订阅自己关心的原子，当某个原子发生变化时，只有订阅了该原子的组件才会重新渲染。这种"按需订阅"的机制在理论上可以实现最优的渲染性能。

那么，Jotai 与我们熟悉的 Redux、Zustand 到底有什么本质区别？在什么场景下应该选择 Jotai？本文将逐一解答这些问题。

## 二、Jotai 核心概念详解

### 2.1 安装与基础用法

```bash
npm install jotai
# 或
pnpm add jotai
```

Jotai 的核心 API 极其精简——只有两个：`atom` 和 `useAtom`。

```tsx
import { atom, useAtom } from 'jotai'

// 定义一个原子（atom）
const countAtom = atom(0)

function Counter() {
  const [count, setCount] = useAtom(countAtom)
  return (
    <div>
      <p>计数：{count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
    </div>
  )
}
```

`atom` 是一个工厂函数，它返回一个不可变的原子描述符。`useAtom` 则同时返回读取值和写入函数——类似 `useState`，但这个状态是全局可共享的。

### 2.2 Read-Only Atom 与 Derived Atom

原子不仅可以持有原始值，还可以**派生自其他原子**：

```tsx
import { atom, useAtomValue, useSetAtom } from 'jotai'

// 原始原子
const priceAtom = atom(100)
const quantityAtom = atom(3)

// 派生原子（只读）——自动追踪依赖
const totalAtom = atom((get) => {
  const price = get(priceAtom)
  const quantity = get(quantityAtom)
  return price * quantity
})

function OrderSummary() {
  // useAtomValue 只读，不暴露 setter
  const total = useAtomValue(totalAtom)
  return <p>订单总额：¥{total}</p>
}
```

`totalAtom` 是一个 **derived atom**（派生原子）。当 `priceAtom` 或 `quantityAtom` 任意一个变化时，`totalAtom` 会自动重新计算，订阅了 `totalAtom` 的组件随之更新。这与 Vue 的 `computed` 或 Solid.js 的 `createMemo` 在理念上非常接近。

### 2.3 Writable Derived Atom

派生原子也可以是可写的：

```tsx
const tempCelsiusAtom = atom(25)
const tempFahrenheitAtom = atom(
  (get) => get(tempCelsiusAtom) * 9 / 5 + 32,
  (get, set, newFahrenheit: number) => {
    set(tempCelsiusAtom, (newFahrenheit - 32) * 5 / 9)
  }
)
```

当你通过 `set` 修改华氏温度时，摄氏温度原子会自动更新，所有依赖它的派生原子也会级联更新。这种双向绑定能力在表单联动、单位换算等场景中非常实用。

### 2.4 Async Atom（异步原子）

Jotai 的 atom 工厂函数原生支持异步：

```tsx
const userAtom = atom(async () => {
  const res = await fetch('/api/user/profile')
  return res.json()
})
```

当组件通过 `useAtomValue(userAtom)` 读取这个原子时，Jotai 会自动将这个 Promise 交给 React Suspense 处理——在数据加载完成前显示 fallback，加载完成后渲染数据。我们将在后文深入探讨这一机制。

### 2.5 atomFamily

`atomFamily` 允许你根据参数动态创建原子实例：

```tsx
import { atomFamily } from 'jotai/utils'

const todoAtomFamily = atomFamily((id: number) =>
  atom(async () => {
    const res = await fetch(`/api/todos/${id}`)
    return res.json()
  })
)

function TodoItem({ id }: { id: number }) {
  const todo = useAtomValue(todoAtomFamily(id))
  return <li>{todo.title}</li>
}
```

`atomFamily` 的返回值是一个函数，接受参数后返回对应的原子实例。Jotai 会为相同的参数缓存同一个原子实例，避免重复创建。这在处理列表数据、详情页等需要按 ID 获取数据的场景中极为有用。

### 2.6 atomWithStorage

Jotai 内置的 `atomWithStorage` 可以将原子状态持久化到 `localStorage`、`sessionStorage` 或自定义存储：

```tsx
import { atomWithStorage } from 'jotai/utils'

const themeAtom = atomWithStorage<'light' | 'dark'>('theme', 'light')

function ThemeToggle() {
  const [theme, setTheme] = useAtom(themeAtom)
  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      当前主题：{theme}
    </button>
  )
}
```

状态的读取和写入完全透明，开发者无需手动调用 `localStorage.getItem/setItem`，也不会在 SSR 场景下遭遇 `localStorage is not defined` 的报错——Jotai 内部做了妥善处理。

### 2.7 Provider 与作用域隔离

与 Redux 的 Provider 概念类似，Jotai 也支持通过 `Provider` 组件实现作用域隔离：

```tsx
import { Provider } from 'jotai'

// 每个 Provider 拥有独立的原子状态存储
function App() {
  return (
    <>
      <Provider>
        <Counter />  {/* 这个 Counter 的 countAtom 是独立的 */}
      </Provider>
      <Provider>
        <Counter />  {/* 这个 Counter 也是独立的 */}
      </Provider>
    </>
  )
}
```

这在微前端、多实例页面、测试隔离等场景中非常有价值。注意：如果不使用 `Provider`，所有原子默认共享一个全局 store，这也是最常用的模式。

## 三、Jotai vs Zustand vs Redux：深度对比

### 3.1 设计哲学

| 维度 | Jotai | Zustand | Redux Toolkit |
|------|-------|---------|---------------|
| **核心模型** | 原子化（atom-based） | Store-based | Store-based |
| **状态组织** | 自底向上（bottom-up） | 集中式 | 集中式 |
| **订阅粒度** | 单个 atom 级别 | selector 级别 | selector 级别 |
| **心智模型** | 类似 useState 的全局扩展 | 类似全局 context | 严格单向数据流 |
| **模板代码** | 极少 | 少 | 较多（即使 RTK 已简化） |

Jotai 的"自底向上"模型是最关键的区别：你不需要预先规划全局状态树的结构，而是从组件需求出发，按需定义原子。随着项目增长，原子之间的派生关系自然形成一张状态图。

Zustand 和 Redux 则是"自顶向下"——你需要先设计 store 的结构，再通过 selector 拆分访问粒度。

### 3.2 代码对比

**同一个计数器功能，三种实现方式的对比：**

**Redux Toolkit 版本：**

```tsx
// features/counter/counterSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface CounterState {
  value: number
  step: number
}

const initialState: CounterState = { value: 0, step: 1 }

const counterSlice = createSlice({
  name: 'counter',
  initialState,
  reducers: {
    increment(state) {
      state.value += state.step
    },
    decrement(state) {
      state.value -= state.step
    },
    setStep(state, action: PayloadAction<number>) {
      state.step = action.payload
    },
  },
})

export const { increment, decrement, setStep } = counterSlice.actions
export default counterSlice.reducer

// store.ts
import { configureStore } from '@reduxjs/toolkit'
import counterReducer from './features/counter/counterSlice'

export const store = configureStore({
  reducer: { counter: counterReducer },
})

// Counter.tsx
import { useSelector, useDispatch } from 'react-redux'
import { increment, decrement } from './counterSlice'

function Counter() {
  const value = useSelector((state) => state.counter.value)
  const dispatch = useDispatch()
  return (
    <div>
      <p>{value}</p>
      <button onClick={() => dispatch(decrement())}>-</button>
      <button onClick={() => dispatch(increment())}>+</button>
    </div>
  )
}
```

**Zustand 版本：**

```tsx
import { create } from 'zustand'

interface CounterStore {
  value: number
  step: number
  increment: () => void
  decrement: () => void
  setStep: (step: number) => void
}

const useCounterStore = create<CounterStore>((set, get) => ({
  value: 0,
  step: 1,
  increment: () => set((s) => ({ value: s.value + s.step })),
  decrement: () => set((s) => ({ value: s.value - s.step })),
  setStep: (step) => set({ step }),
}))

function Counter() {
  const value = useCounterStore((s) => s.value)
  const { increment, decrement } = useCounterStore()
  return (
    <div>
      <p>{value}</p>
      <button onClick={decrement}>-</button>
      <button onClick={increment}>+</button>
    </div>
  )
}
```

**Jotai 版本：**

```tsx
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

const stepAtom = atom(1)
const countAtom = atom(0)

// 派生写入原子：包含业务逻辑的 action atom
const incrementAtom = atom(
  (get) => get(countAtom),
  (get, set) => set(countAtom, get(countAtom) + get(stepAtom))
)
const decrementAtom = atom(
  (get) => get(countAtom),
  (get, set) => set(countAtom, get(countAtom) - get(stepAtom))
)

function Counter() {
  const count = useAtomValue(incrementAtom)
  const increment = useSetAtom(incrementAtom)
  const decrement = useSetAtom(decrementAtom)
  return (
    <div>
      <p>{count}</p>
      <button onClick={decrement}>-</button>
      <button onClick={increment}>+</button>
    </div>
  )
}
```

Jotai 版本不需要 store 配置、不需要 Provider（除非需要隔离）、不需要 action creator、不需要 reducer。原子天然就是类型安全的，TypeScript 可以直接从 atom 的初始值推断类型。

### 3.3 响应粒度对比

这是 Jotai 最大的差异化优势。假设我们有一个用户信息 store：

```tsx
// Zustand：即使只用 name，selector 函数的引用变化可能导致额外渲染
const name = useUserStore((s) => s.name)

// Jotai：天然的细粒度订阅
const name = useAtomValue(userNameAtom)  // 仅当 nameAtom 变化时才触发渲染
```

在 Zustand 中，如果 selector 函数每次渲染都创建新的引用（非稳定函数引用），组件可能会不必要地重新渲染。你需要使用 `shallow` 比较或手动 memoize selector。

而 Jotai 的每个 atom 本身就是独立的订阅目标——不存在"多余的 re-render"问题，因为组件与原子之间的关系是一对一的。

### 3.4 派生状态对比

```tsx
// Zustand 的派生：需要在 store 外部定义 selector
const useExpensiveDerived = () =>
  useUserStore((s) => expensiveCalculation(s.items, s.filters))

// 或使用 zustand 的 subscribeWithSelector 中间件

// Jotai 的派生：原子级别的原生支持
const derivedAtom = atom((get) => {
  const items = get(itemsAtom)
  const filters = get(filtersAtom)
  return expensiveCalculation(items, filters)
})
```

Jotai 的 derived atom 会自动追踪依赖，当且仅当依赖原子变化时才重新计算。而且由于它是原子级别的，其他组件也可以复用这个派生结果，而不需要重复计算。

### 3.5 包体积对比

| 库 | gzip 体积（约） |
|------|------|
| Jotai | ~2.5 kB |
| Zustand | ~1.5 kB |
| Redux Toolkit + react-redux | ~11 kB |

Jotai 和 Zustand 都非常轻量。Redux Toolkit 虽然比原版 Redux 小很多，但加上 react-redux 绑定层后仍然体积较大。不过在现代 Web 应用中，包体积通常不是最关键的决策因素——除非你在构建极度注重首屏加载的场景。

## 四、Jotai 与 React Suspense 深度集成

React Suspense 是 Jotai 最具竞争力的集成场景之一。相比 Zustand 和 Redux 需要手动管理 loading 状态，Jotai 的异步原子与 Suspense 的集成是零配置的。

### 4.1 基础 Suspense 集成

```tsx
import { Suspense } from 'react'
import { atom, useAtomValue } from 'jotai'

const userProfileAtom = atom(async () => {
  const response = await fetch('/api/user/profile')
  if (!response.ok) throw new Error('Failed to load profile')
  return response.json() as Promise<{ name: string; avatar: string }>
})

function ProfileCard() {
  const profile = useAtomValue(userProfileAtom)
  return (
    <div>
      <img src={profile.avatar} alt={profile.name} />
      <h2>{profile.name}</h2>
    </div>
  )
}

function App() {
  return (
    <Suspense fallback={<div className="skeleton">加载中...</div>}>
      <ProfileCard />
    </Suspense>
  )
}
```

当 `ProfileCard` 挂载时，`userProfileAtom` 的异步函数开始执行。在 Promise 解析前，React 会显示 Suspense 的 fallback；解析后，`profile` 直接是解析后的值，无需做 `if (loading)` 判断。

### 4.2 错误处理：Suspense + ErrorBoundary

```tsx
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { atom, useAtomValue } from 'jotai'

const dataAtom = atom(async () => {
  const res = await fetch('/api/data')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
})

function DataTable() {
  const data = useAtomValue(dataAtom)
  return (
    <table>
      {data.map((row) => (
        <tr key={row.id}>
          <td>{row.name}</td>
          <td>{row.value}</td>
        </tr>
      ))}
    </table>
  )
}

function DataPage() {
  return (
    <ErrorBoundary
      fallbackRender={({ error }) => (
        <div className="error-panel">
          <p>加载失败：{error.message}</p>
          <button onClick={() => window.location.reload()}>重试</button>
        </div>
      )}
    >
      <Suspense fallback={<p>数据加载中...</p>}>
        <DataTable />
      </Suspense>
    </ErrorBoundary>
  )
}
```

这种"try-catch"式的错误处理模式非常优雅——开发者不再需要在组件中管理 `isLoading`、`isError`、`error` 等多个状态变量。

### 4.3 对比 Zustand/Redux 的异步数据处理

**Zustand 的典型异步模式：**

```tsx
const useDataStore = create((set) => ({
  data: null,
  loading: false,
  error: null,
  fetchData: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/data')
      const data = await res.json()
      set({ data, loading: false })
    } catch (error) {
      set({ error, loading: false })
    }
  },
}))

function DataTable() {
  const { data, loading, error, fetchData } = useDataStore()
  useEffect(() => { fetchData() }, [])

  if (loading) return <p>加载中...</p>
  if (error) return <p>错误：{error.message}</p>
  if (!data) return null

  return <table>...</table>
}
```

**Redux Toolkit 的典型异步模式（createAsyncThunk）：**

```tsx
const fetchData = createAsyncThunk('data/fetch', async () => {
  const res = await fetch('/api/data')
  return res.json()
})

const dataSlice = createSlice({
  name: 'data',
  initialState: { entities: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchData.pending, (state) => { state.loading = true })
      .addCase(fetchData.fulfilled, (state, action) => {
        state.loading = false
        state.entities = action.payload
      })
      .addCase(fetchData.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
  },
})
```

可以看到，Zustand 和 Redux 都需要手动管理三态（loading/data/error），而 Jotai + Suspense 将这部分工作委托给了 React 运行时。

### 4.4 依赖请求的 Suspense 级联

当一个异步请求依赖另一个异步请求的结果时，Jotai 的优势更加明显：

```tsx
const currentUserAtom = atom(async () => {
  const res = await fetch('/api/auth/me')
  return res.json()
})

const userPostsAtom = atom(async (get) => {
  const user = await get(currentUserAtom)  // 自动等待上游完成
  const res = await fetch(`/api/users/${user.id}/posts`)
  return res.json()
})

function UserPosts() {
  const posts = useAtomValue(userPostsAtom)
  // 只需要这一个订阅，两个请求会按顺序自动执行
  return (
    <ul>
      {posts.map(post => <li key={post.id}>{post.title}</li>)}
    </ul>
  )
}
```

`userPostsAtom` 的 getter 函数接收 `get` 方法，调用 `get(currentUserAtom)` 时，如果 `currentUserAtom` 是异步的，Jotai 会自动等待它的 Promise 解析。整个链路是声明式的、自动的——不需要 `useEffect`、不需要手动编排请求顺序、不需要 loading 状态管理。

## 五、性能深度分析

### 5.1 渲染优化机制

**Jotai 的渲染策略：**

当一个 atom 的值变化时，只有直接使用了 `useAtom` / `useAtomValue` 订阅该 atom 的组件才会 re-render。订阅了 derived atom 的组件不会因为原始 atom 变化而直接 re-render——它们只会因为 derived atom 的计算结果变化而 re-render。

```tsx
const itemsAtom = atom([1, 2, 3, 4, 5])
const filteredItemsAtom = atom((get) =>
  get(itemsAtom).filter((n) => n > 3)
)

// 当 itemsAtom 变为 [1,2,3,4,5,6] 时：
// - Items 组件 re-render ✓
// - FilteredItems 组件也会 re-render（因为结果从 [4,5] 变为 [4,5,6]）✓

// 当 itemsAtom 变为 [1,2,3,4,5,7] 时：
// - Items 组件 re-render ✓
// - FilteredItems 组件也会 re-render（因为结果变为 [4,5,7]）✓

// 当 itemsAtom 变为 [0,1,2,3,4,5] 时：
// - Items 组件 re-render ✓
// - FilteredItems 组件不 re-render ✗（filter 结果仍是 [4,5]，引用不变）
```

**Zustand 的渲染策略：**

Zustand 使用 selector 模式，每个 `useStore` 调用都需要传入一个选择函数。默认使用 `Object.is` 进行比较：

```tsx
const items = useStore((s) => s.items)
// 只有当 s.items 的引用变化时才 re-render
```

对于对象属性的解构，Zustand 需要 `shallow` 比较：

```tsx
import { shallow } from 'zustand/shallow'

const { name, age } = useUserStore(
  (s) => ({ name: s.name, age: s.age }),
  shallow
)
```

**对比总结：**

| 场景 | Jotai | Zustand | Redux |
|------|-------|---------|-------|
| 单一值变更 | 仅订阅组件渲染 | 仅匹配 selector 的组件渲染 | 仅匹配 selector 的组件渲染 |
| 派生状态自动优化 | ✅ 内置 | ❌ 需要手动 selector | ❌ 需要 reselect/memoize |
| 对象属性批量订阅 | 天然细粒度 | 需要 shallow 比较 | 需要 shallow 比较 |
| 避免不必要的计算 | derived atom 缓存 | selector 缓存（reselect） | createSelector 缓存 |

### 5.2 Benchmark 参考

以下基准测试基于社区 benchmark 项目（如 js-framework-benchmark），在典型的 TodoMVC 场景下：

- **初次渲染**：三者差异不大（~5% 以内）
- **单项更新**：Jotai 略优，因为无需 selector 解析
- **大规模列表（1000 项）单个 toggle**：Jotai 和 Zustand 都只需更新一个组件；Redux 在正确配置 selector 时也能达到类似效果
- **批量更新**：三者都需要使用 `batch`（React 18 已自动批处理）

实际项目中，三者的性能差异通常不会成为瓶颈。Jotai 的优势更多体现在"自然而然地获得最佳性能"——你不需要额外的优化手段，原子模型本身就倾向于精确更新。

### 5.3 内存与 GC 考虑

Jotai 的 atom 实例存储在 WeakMap 中（store 内部实现）。当一个 atom 不再被任何组件订阅，且没有其他 atom 引用它时，它的值会被自动回收。`atomFamily` 的缓存行为也可以通过 `shouldRemove` 参数控制。

```tsx
import { atomFamily } from 'jotai/utils'

const todoAtomFamily = atomFamily((id: number) => atom(null), {
  // 当 atom 值为 null 且超过 5 分钟未被订阅时移除
  shouldRemove: (createdAt) => Date.now() - createdAt > 5 * 60 * 1000,
})
```

## 六、实际项目应用场景

### 6.1 场景一：表单状态管理

表单是 Jotai 最自然的应用场景之一——每个字段独立为一个原子：

```tsx
import { atom, useAtom } from 'jotai'

const firstNameAtom = atom('')
const lastNameAtom = atom('')
const emailAtom = atom('')

// 派生验证结果
const formValidationAtom = atom((get) => {
  const first = get(firstNameAtom)
  const last = get(lastNameAtom)
  const email = get(emailAtom)

  const errors: string[] = []
  if (!first.trim()) errors.push('名不能为空')
  if (!last.trim()) errors.push('姓不能为空')
  if (!email.includes('@')) errors.push('邮箱格式不正确')

  return {
    isValid: errors.length === 0,
    errors,
    fullName: `${last} ${first}`.trim(),
  }
})

function FormField({
  label,
  atom: fieldAtom,
}: {
  label: string
  atom: typeof firstNameAtom
}) {
  const [value, setValue] = useAtom(fieldAtom)
  return (
    <label>
      {label}
      <input value={value} onChange={(e) => setValue(e.target.value)} />
    </label>
  )
}

function RegistrationForm() {
  const validation = useAtomValue(formValidationAtom)

  return (
    <form>
      <FormField label="姓：" atom={lastNameAtom} />
      <FormField label="名：" atom={firstNameAtom} />
      <FormField label="邮箱：" atom={emailAtom} />

      {validation.errors.length > 0 && (
        <ul className="errors">
          {validation.errors.map((err) => <li key={err}>{err}</li>)}
        </ul>
      )}

      <p>预览：{validation.fullName}</p>
      <button disabled={!validation.isValid} type="submit">提交</button>
    </form>
  )
}
```

注意 `FormField` 组件——它只重新渲染自己绑定的字段原子的变化。修改"姓"不会触发"名"或"邮箱"字段的重新渲染。

### 6.2 场景二：多层筛选与搜索

电商或后台管理系统中的多维度筛选非常适合原子化管理：

```tsx
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

// 筛选条件
const categoryAtom = atomWithStorage<string | null>('filter-category', null)
const priceRangeAtom = atom<[number, number]>([0, 10000])
const sortByAtom = atom<'price-asc' | 'price-desc' | 'rating'>('rating')
const searchQueryAtom = atom('')

// 筛选参数对象
const filterParamsAtom = atom((get) => ({
  category: get(categoryAtom),
  priceRange: get(priceRangeAtom),
  sortBy: get(sortByAtom),
  query: get(searchQueryAtom),
}))

// 异步数据请求
const filteredProductsAtom = atom(async (get) => {
  const params = get(filterParamsAtom)
  const searchParams = new URLSearchParams({
    category: params.category ?? '',
    minPrice: String(params.priceRange[0]),
    maxPrice: String(params.priceRange[1]),
    sort: params.sortBy,
    q: params.query,
  })
  const res = await fetch(`/api/products?${searchParams}`)
  return res.json()
})

function ProductList() {
  const products = useAtomValue(filteredProductsAtom)
  return (
    <div className="grid">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  )
}

function FilterPanel() {
  const [category, setCategory] = useAtom(categoryAtom)
  const [priceRange, setPriceRange] = useAtom(priceRangeAtom)
  const [query, setQuery] = useAtom(searchQueryAtom)

  return (
    <aside>
      <input
        placeholder="搜索商品..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <CategorySelect value={category} onChange={setCategory} />
      <PriceSlider value={priceRange} onChange={setPriceRange} />
    </aside>
  )
}

function ProductPage() {
  return (
    <div className="product-page">
      <FilterPanel />
      <Suspense fallback={<ProductGridSkeleton />}>
        <ProductList />
      </Suspense>
    </div>
  )
}
```

任何筛选条件变化 → `filterParamsAtom` 变化 → `filteredProductsAtom` 重新请求 → Suspense 自动切换 loading 状态。整个流程都是声明式的，不需要一行 `useEffect` 或手动状态管理。

### 6.3 场景三：跨组件状态共享（如通知/Toast）

```tsx
import { atom } from 'jotai'

interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

const toastsAtom = atom<Toast[]>([])

// action atoms
const addToastAtom = atom(
  null,
  (get, set, toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID()
    set(toastsAtom, [...get(toastsAtom), { ...toast, id }])
    setTimeout(() => {
      set(toastsAtom, get(toastsAtom).filter((t) => t.id !== id))
    }, 3000)
  }
)

// 在任何组件中使用
function SomeForm() {
  const addToast = useSetAtom(addToastAtom)
  const handleSubmit = async () => {
    try {
      await saveData()
      addToast({ message: '保存成功！', type: 'success' })
    } catch {
      addToast({ message: '保存失败', type: 'error' })
    }
  }
  // ...
}
```

使用 `useSetAtom` 只获取 setter 而不订阅值变化，意味着 `SomeForm` 组件不会因为 toast 列表变化而重新渲染。

### 6.4 场景四：与 URL 参数同步

```tsx
import { atom } from 'jotai'
import { atomWithLocation } from 'jotai-location'

const urlAtom = atomWithLocation()

const pageAtom = atom(
  (get) => Number(new URLSearchParams(get(urlAtom).search).get('page')) || 1,
  (get, set, page: number) => {
    const url = new URL(get(urlAtom).href)
    url.searchParams.set('page', String(page))
    set(urlAtom, url.toString())
  }
)
```

## 七、Jotai 的扩展生态

Jotai 拥有丰富的官方扩展库：

| 包 | 功能 |
|------|------|
| `jotai/utils` | `atomWithStorage`、`atomWithObservable`、`loadable`、`selectAtom` 等 |
| `jotai/immer` | 与 Immer 集成的 `atomWithImmer` |
| `jotai/xstate` | 与 XState 集成，将状态机暴露为 atom |
| `jotai/query` | 与 TanStack Query 集成 |
| `jotai/valtio` | 与 Valtio 代理对象集成 |
| `jotai/trpc` | 与 tRPC 集成 |

### 使用 `loadable` 包装异步原子

如果你不想使用 Suspense，可以使用 `loadable` 将异步原子转换为同步的 loading/data/error 对象：

```tsx
import { loadable } from 'jotai/utils'

const asyncAtom = atom(fetch('/api/data').then((r) => r.json()))
const loadableAtom = loadable(asyncAtom)

function Component() {
  const state = useAtomValue(loadableAtom)
  if (state.state === 'loading') return <Spinner />
  if (state.state === 'hasError') return <Error error={state.error} />
  return <Data data={state.data} />
}
```

这为渐进式采用 Suspense 提供了过渡方案。

## 八、最佳实践与注意事项

### 8.1 原子组织模式

推荐将原子按功能域拆分到独立文件中：

```
src/
  atoms/
    auth.ts          # 认证相关原子
    cart.ts          # 购物车原子
    filters.ts       # 筛选条件原子
    theme.ts         # 主题原子
```

### 8.2 何时选择 Jotai？

✅ **推荐 Jotai 的场景：**
- 状态天然分散在多个组件中
- 需要大量派生/计算状态
- 重度使用 React Suspense 进行异步渲染
- 追求极致的渲染优化粒度
- 项目从零开始，没有历史包袱

❌ **不推荐 Jotai 的场景：**
- 团队已熟悉 Redux 生态，且项目已有完善的 Redux 代码
- 需要复杂的时间旅行调试和严格的 action 审计
- 需要大量中间件支持（如 redux-saga、redux-observable）

### 8.3 避免常见陷阱

**陷阱一：在渲染函数中创建 atom**

```tsx
// ❌ 错误：每次渲染都创建新 atom 实例
function Bad() {
  const myAtom = atom(0)  // 每次渲染都是不同的 atom！
  const [val] = useAtom(myAtom)
  return <p>{val}</p>
}

// ✅ 正确：在模块顶层创建
const myAtom = atom(0)

function Good() {
  const [val] = useAtom(myAtom)
  return <p>{val}</p>
}
```

**陷阱二：忘记 useEffect 或 useAtom 的异步处理**

```tsx
// ❌ 如果 searchAtom 在更新时触发 API 调用，不要用 useEffect 包装
// ✅ 使用 derived async atom
const resultsAtom = atom(async (get) => {
  const query = get(searchAtom)
  if (!query) return []
  const res = await fetch(`/api/search?q=${query}`)
  return res.json()
})
```

## 九、从 Zustand 或 Redux 迁移到 Jotai

迁移不需要一步到位。Jotai 的 Provider 可以与 Redux 的 Provider 或 Zustand 的 store 并存。建议从新功能开始使用 Jotai，逐步替换。

**迁移步骤：**

1. 安装 `jotai`，在 app 入口添加 `<Provider>`（可选，不加也行）
2. 将新的全局状态用 `atom` 定义
3. 对于已有的 Zustand store，可以使用 `atomWithStore` 桥接（需要自行封装）
4. 对于已有的 Redux store，可以使用 `jotai/redux` 扩展包：
   ```tsx
   import { atomWithStore } from 'jotai/redux'
   const countAtom = atomWithStore(store, (s) => s.counter.value)
   ```
5. 逐步替换，最终移除旧的 store

## 十、总结

| 维度 | Jotai | Zustand | Redux Toolkit |
|------|-------|---------|---------------|
| 包体积 | ~2.5 kB | ~1.5 kB | ~11 kB |
| 学习曲线 | 低 | 低 | 中 |
| TypeScript 支持 | 优秀（原生推断） | 优秀 | 优秀 |
| Suspense 集成 | ✅ 原生 | ❌ 需手动 | ❌ 需手动 |
| 渲染粒度 | 原子级 | selector 级 | selector 级 |
| 中间件生态 | 丰富（官方扩展） | 丰富 | 最丰富 |
| 调试工具 | Redux DevTools（扩展支持） | 内置 DevTools | 最完善 |
| 适合规模 | 小到大型 | 小到中大型 | 中到超大型 |

**一句话总结：** Jotai 的原子化模型与 React 的声明式范式天然契合，尤其在异步数据处理（Suspense 集成）和细粒度渲染优化方面展现出独特优势。如果你正在启动一个新项目，或者对当前状态管理方案的模板代码量和心智负担感到不满，Jotai 绝对值得尝试。

---

> 参考资料：
> - [Jotai 官方文档](https://jotai.org/)
> - [Zustand 官方文档](https://zustand-demo.pmnd.rs/)
> - [Redux Toolkit 官方文档](https://redux-toolkit.js.org/)
> - [React Suspense 文档](https://react.dev/reference/react/Suspense)

## 相关阅读

- [Zustand 实战：轻量级 React 状态管理——对比 Redux/Jotai/Recoil 的工程选型与最佳实践](/categories/04_前端/Zustand-实战-轻量级React状态管理-对比Redux-Jotai-Recoil的工程选型与最佳实践/) — 如果你对 Jotai 与 Zustand 的选型仍有疑问，这篇文章从工程实践角度做了更深入的对比。
- [React 19 Compiler 实战：自动记忆化取代 useMemo/useCallback](/categories/04_前端/2026-06-04-react-19-compiler-auto-memoization-revolution/) — React 19 Compiler 的自动 memoization 如何影响状态管理库的渲染优化策略。
- [TanStack Query 实战：服务端状态管理——缓存策略、乐观更新与 Laravel API](/categories/04_前端/TanStack-Query-React-Query-实战-服务端状态管理-缓存策略-乐观更新-Laravel-API/) — Jotai 适合客户端状态，TanStack Query 适合服务端状态，两者常组合使用。
- [Signals 范式对比：Angular/Vue/Solid/Preact 响应式底层原理深度剖析](/categories/04_前端/2026-06-05-Signals-范式对比-Angular-Vue-Solid-Preact-响应式原理.md/) — 从 Signals 响应式范式的底层原理理解 Jotai 原子化模型的设计思想。
- [SolidJS 实战：细粒度响应式前端框架——无 Virtual DOM 的极致性能与 React 迁移路径](/categories/04_前端/solidjs-fine-grained-reactivity.md/) — SolidJS 的细粒度响应式与 Jotai 的原子化订阅在性能优化理念上异曲同工。
