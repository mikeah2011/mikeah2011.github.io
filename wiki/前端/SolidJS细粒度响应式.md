# SolidJS：细粒度响应式

## 定义

SolidJS 采用**细粒度响应式**（变量级别而非组件级别），组件函数只执行一次，状态变化直接精确更新对应 DOM 节点，无 Virtual DOM diff。通过编译时分析 + 运行时追踪，实现接近原生 JS 的性能，在 JS Framework Benchmark 中长期位居前列。

## 核心原理

### Signals：基础响应式原语

```typescript
import { createSignal } from 'solid-js'

const [count, setCount] = createSignal(0)

// ⚠️ 关键区别：count() 是函数调用，不是属性访问
console.log(count())   // 0
setCount(1)
console.log(count())   // 1
```

**为什么是函数调用？** Signal 的 getter 函数实现了隐式依赖追踪——每次调用 `count()` 时，当前 Effect 自动注册为依赖。

### Effects：自动依赖追踪

```typescript
import { createEffect, onCleanup } from 'solid-js'

createEffect(() => {
  console.log(`Count is: ${count()}`)
  // 自动追踪 count 作为依赖
  // count 变化时自动重新执行
})

// 资源清理
createEffect(() => {
  const timer = setInterval(() => console.log(count()), 1000)
  onCleanup(() => clearInterval(timer))
})
```

**与 React useEffect 对比**：
- React：需要手动维护依赖数组 `[count]`
- SolidJS：自动追踪，无需依赖数组

### Memos：带缓存的派生计算

```typescript
import { createMemo } from 'solid-js'

const [items, setItems] = createSignal([1, 2, 3, 4, 5])

// 只在 items 变化时重新计算
const sum = createMemo(() => items().reduce((a, b) => a + b, 0))

// 结果相同时短路通知下游
const isEven = createMemo(() => sum() % 2 === 0)
```

### Stores：深层响应式

```typescript
import { createStore } from 'solid-js/store'

const [state, setState] = createStore({
  user: { name: 'Alice', age: 30 },
  todos: [{ text: 'Learn Solid', done: false }]
})

// 精确更新嵌套属性，不触发整个对象的响应
setState('user', 'age', 31)
setState('todos', 0, 'done', true)
```

### 编译时优化

SolidJS 编译器将 JSX 转换为命令式 DOM 操作：

```jsx
// 源代码
function App() {
  const [name, setName] = createSignal('World')
  return <h1>Hello, {name()}!</h1>
}

// 编译输出（简化）
function App() {
  const [name, setName] = createSignal('World')
  const _el$ = template.cloneNode(true)  // 静态节点只创建一次
  createEffect(() => _el$.firstChild.data = name())  // 精确更新文本节点
  return _el$
}
```

### 响应式粒度对比

| 框架 | 粒度 | 更新机制 | 性能特点 |
|---|---|---|---|
| React | 组件级 | Virtual DOM diff | 需要记忆化优化 |
| Vue 3 | 组件级（Proxy 追踪） | Virtual DOM + PatchFlag | 编译时优化标记 |
| SolidJS | 变量级 | 直接 DOM 操作 | 接近原生 JS |
| Svelte | 组件级（编译时） | 生成命令式更新代码 | 无运行时框架 |

## 实战案例

来自博客文章：
- [SolidJS 实战：细粒度响应式前端框架——无 Virtual DOM 的极致性能与 React 开发者迁移路径](/2026/06/05/solidjs-fine-grained-reactivity/)

## 相关概念

- [Signals 响应式范式](Signals响应式范式.md) - Angular/Vue/Solid/Preact 四大响应式方案对比
- [React 19 编译器](React19编译器.md) - React 的自动记忆化优化
- [React 状态管理选型](React状态管理选型.md) - React 生态状态管理方案
- [Vue 3 Composition API](Vue3-Composition-API.md) - Vue 的响应式系统

## 常见问题

### Q: SolidJS 的 JSX 和 React JSX 有什么区别？
SolidJS 的 JSX 中不能解构 props（`const {name} = props` 会破坏响应式），必须通过 getter 函数访问（`props.name`）。组件函数只执行一次，不是每次渲染都执行。

### Q: SolidJS 适合什么场景？
- 高性能交互（实时图表、游戏 UI、数据密集型仪表盘）
- 对包体积敏感的场景（SolidJS 运行时 ~7KB）
- 不适合需要大量 React 生态库的项目

### Q: 从 React 迁移难吗？
API 设计理念相似（createSignal ≈ useState，createEffect ≈ useEffect），但心智模型不同。SolidJS 的组件不是渲染函数，理解"组件只执行一次"是关键。
