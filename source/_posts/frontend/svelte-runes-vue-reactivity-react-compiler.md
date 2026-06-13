---
title: Svelte 5 Runes 实战深度：编译时响应式信号的底层原理——对比 Vue Reactivity/React Compiler 的设计理念差异
description: 深入剖析 Svelte 5 Runes 编译时响应式原理，详解 $state、$derived、$effect、$props 四大核心原语的底层信号机制。通过同一组件在 Svelte 5、Vue 3 Reactivity、React 19 Compiler 三大框架中的实现对比，从设计理念、编译输出、运行时性能、包体积、开发体验等维度全面解析信号范式的差异。包含 Todo List 完整实战代码、JS Framework Benchmark 性能数据、TypeScript 集成指南及 2026 前端框架选型建议，帮助开发者在信号革命中做出明智的技术决策。
date: 2026-06-07 10:30:00
tags: [Svelte, Runes, 响应式, Vue, React, 前端框架]
keywords: [Svelte, Runes, Vue Reactivity, React Compiler, 实战深度, 编译时响应式信号的底层原理, 的设计理念差异, 前端]
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---


## 引言：前端框架的信号革命（2024-2026）

2024 年至 2026 年，前端开发领域正在经历一场深刻的思想变革——**信号（Signals）范式的全面崛起**。从 Angular 引入 Signal-based reactivity，到 Solid.js 以细粒度响应式为核心的设计哲学，再到 Svelte 5 用 Runes 彻底重构了编译时响应式模型，以及 React Compiler 试图在编译层自动解决性能问题——整个前端社区正在重新审视「组件如何知道自己需要重新渲染」这个根本命题。

这场变革的深层驱动力在于：**Virtual DOM diff 的时代正在落幕，开发者期望的是更精确、更高效、心智模型更简洁的状态管理方案**。在过去十年中，React 的 Virtual DOM 模型因其简洁性和可预测性统治了前端生态，但随着应用复杂度不断攀升，虚拟 DOM diff 的开销在高频更新场景（如实时数据可视化、拖拽交互、动画驱动界面）中逐渐成为性能瓶颈。开发者们开始意识到，与其在运行时通过 diff 算法猜测哪些 DOM 节点发生了变化，不如在编译时就精确地确定需要更新的位置。

在这场范式迁移中，三大主流框架分别选择了截然不同的路径：

- **Svelte 5**：通过编译时转换，将 Runes 语法糖编译为原生信号操作，零运行时框架开销
- **Vue 3**：基于 Proxy 的运行时响应式系统，结合 `ref`、`reactive`、`computed` 形成完整生态，同时推出 Vapor Mode 探索编译时优化
- **React 19 + Compiler**：坚守不可变心智模型，通过编译器自动插入 memoization，无需开发者手动优化

本文将深入 Svelte 5 Runes 的底层编译原理，以同一组件为切面，对比三大框架在设计理念、实现机制、性能表现和开发体验上的根本差异，帮助你在 2026 年的技术选型中做出更明智的决策。

---

## Svelte 5 Runes 深度剖析

### 什么是 Runes？

Runes 是 Svelte 5 引入的全新响应式原语体系，以 `$` 开头的特殊标识符（如 `$state`、`$derived`、`$effect`、`$props`）取代了 Svelte 4 中隐式的 `let` 声明自动响应式机制。这一设计决策背后的核心考量是：**显式优于隐式**——开发者应该清晰地知道哪些变量是响应式的，哪些不是。

在 Svelte 4 中，所有在 `<script>` 块中声明的顶层 `let` 变量都是自动响应式的，这种「魔法」虽然降低了入门门槛，但在大型项目中带来了维护困难——当变量被传递到子组件或闭包中时，开发者往往不确定它是否仍然保持响应性。Svelte 5 的 Runes 通过显式标记解决了这个长期困扰社区的问题。

```svelte
<!-- Svelte 5 Runes -->
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);

  $effect(() => {
    console.log(`count 变为: ${count}`);
  });

  function increment() {
    count++;
  }
</script>

<button onclick={increment}>
  点击 {count}，双倍: {doubled}
</button>
```

### 四大核心 Rune 详解

#### `$state` — 响应式状态声明

`$state` 是 Svelte 5 中声明响应式状态的基本原语。它接收一个初始值，返回一个响应式的状态引用。在 `.svelte` 文件中，编译器会将 `let count = $state(0)` 转换为底层的信号实现；在 `.svelte.js/ts` 模块文件中，它会生成使用运行时信号 API 的代码。

`$state` 的一个精妙之处在于**深度响应性**：它内部使用 Proxy（在编译输出中）对嵌套对象进行代理，使得 `todos[0].done = true` 这样的深层修改也能触发更新，无需像 Vue 的 `ref` 那样手动访问 `.value`。这意味着 Svelte 5 保持了原生 JavaScript 的赋值语义，你不需要学习任何额外的 API 就能直接操作响应式数据。

```javascript
// 你写的代码
let todos = $state([
  { id: 1, text: '学习 Runes', done: false }
]);

// 编译器生成的伪代码（简化示意）
import { source, set } from 'svelte/reactivity';
let todos = source([
  { id: 1, text: '学习 Runes', done: false }
]);
```

对于类（class）中的字段，`$state` 同样适用，可以声明实例级别的响应式状态，这在 Svelte 4 中是无法实现的：

```svelte
<script>
  class TodoStore {
    items = $state([]);

    add(text) {
      this.items.push({ id: Date.now(), text, done: false });
    }

    toggle(id) {
      const item = this.items.find(i => i.id === id);
      if (item) item.done = !item.done;
    }

    get remaining() {
      return this.items.filter(i => !i.done).length;
    }
  }

  let store = new TodoStore();
</script>
```

#### `$derived` — 派生计算状态

`$derived` 类似于 Vue 的 `computed`，用于声明基于其他响应式状态的派生值。每当其依赖的状态发生变化时，派生值会自动重新计算。

```svelte
<script>
  let items = $state([1, 2, 3, 4, 5]);
  let sum = $derived(items.reduce((a, b) => a + b, 0));
  let avg = $derived(sum / items.length);
</script>

<p>总和: {sum}，平均值: {avg}</p>
```

`$derived` 的编译输出会建立依赖追踪图——当 `items` 变化时，Svelte 的编译器知道 `sum` 和 `avg` 需要重新计算。这个追踪发生在编译时而非运行时，是 Svelte 与 Vue 的关键差异之一。Vue 的 Proxy 系统需要在运行时通过 getter 拦截来建立依赖关系，而 Svelte 的编译器通过静态分析 AST（抽象语法树）在构建阶段就完成了这一步。

对于复杂逻辑，还可以使用 `$derived.by`，它接受一个函数并返回其返回值作为派生状态：

```svelte
<script>
  let data = $state({ items: [], filter: '', sort: 'asc' });

  let processedItems = $derived.by(() => {
    // 可以包含多行复杂逻辑
    const lowerFilter = data.filter.toLowerCase();
    return data.items
      .filter(item => item.name.toLowerCase().includes(lowerFilter))
      .sort((a, b) => data.sort === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  });
</script>
```

#### `$effect` — 副作用管理

`$effect` 是 Svelte 5 中处理副作用的标准方式，取代了 Svelte 4 中的 `$:` 响应式声明和 `onMount`/`onDestroy` 生命周期的大量使用场景：

```svelte
<script>
  let query = $state('');

  $effect(() => {
    // 当 query 变化时自动执行
    const controller = new AbortController();
    fetch(`/api/search?q=${query}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => { /* 处理结果 */ });

    // 返回清理函数（类似 React useEffect）
    return () => controller.abort();
  });
</script>
```

`$effect` 的核心设计是：**自动追踪依赖**。编译器会在 `$effect` 代码块中识别所有被读取的 `$state` 变量，只有当这些变量变化时才重新执行副作用。这与 React 的 `useEffect` 需要手动指定依赖数组形成鲜明对比——React 开发者经常因为遗漏依赖或过度依赖而导致 bug，而 Svelte 5 通过编译时分析彻底消除了这类问题。

还有一个重要的区别：`$effect` 的清理函数会在下一次执行之前调用，也会在组件销毁时调用，确保不会出现内存泄漏。

#### `$props` — 组件属性声明

`$props` 取代了 Svelte 4 中的 `export let` 语法，提供了更清晰的属性声明方式：

```svelte
<script>
  let { title, count = 0, onclick } = $props();
</script>

<h1>{title}</h1>
<button {onclick}>数量: {count}</button>
```

还可以使用 TypeScript 进行类型约束和默认值绑定：

```svelte
<script lang="ts">
  interface Props {
    title: string;
    count?: number;
    onclick?: () => void;
    children: import('svelte').Snippet;
  }

  let { title, count = 0, onclick, children }: Props = $props();
</script>

<div>
  <h1>{title}</h1>
  {@render children()}
</div>
```

除了四大核心 Rune，Svelte 5 还提供了 `$bindable`（双向绑定的 props 声明）、`$inspect`（调试用的响应式追踪）和 `$host`（Web Component 暴露）等辅助原语，形成了完整的编译时响应式工具集。

---

## Runes 的编译时原理：从语法糖到原生信号

### 编译时 vs 运行时的本质区别

理解 Svelte 5 Runes 的核心在于理解**编译时优化**的本质。当你编写：

```svelte
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);

  $effect(() => {
    document.title = `点击了 ${count} 次`;
  });
</script>
```

Svelte 编译器在构建阶段（而非运行时）会执行以下转换：

```javascript
// 编译器输出（概念性简化）
import { template, delegate, effect, derived, source, set } from 'svelte/internal/client';

export default function Component($$anchor) {
  // $state(0) → 创建信号源
  let count = source(0);
  // $derived(count * 2) → 创建派生信号，编译时确定依赖
  let doubled = derived(() => $.get(count) * 2);
  // $effect → 注册副作用，编译时确定依赖集合
  effect(() => {
    document.title = `点击了 ${$.get(count)} 次`;
  });

  // 模板部分编译为精确的 DOM 操作
  let button = root();
  button.__click = [handleClick, count];
  template_effect(() => {
    button.textContent = `点击 ${$.get(count)}，双倍: ${$.get(doubled)}`;
  });
  $$anchor.before(button);
}
```

关键洞察：

1. **依赖在编译时确定**：Svelte 编译器通过静态分析 AST（抽象语法树），在编译时就确定了每个 `$derived` 和 `$effect` 依赖哪些 `$state`。Vue 的 Proxy 系统则需要在运行时通过 getter 拦截来建立依赖关系，这意味着每次读取响应式属性时都会执行额外的拦截逻辑。

2. **模板编译为精确 DOM 更新**：Svelte 不会 diff 虚拟 DOM，而是生成直接操作 DOM 的命令式代码。当 `count` 变化时，编译器已经知道只有文本节点需要更新，直接调用 `setTextContent`。这消除了 Virtual DOM 创建、diff 比较、patch 应用的完整开销链。

3. **零运行时框架开销**：最终产物中不包含 Virtual DOM diff 算法、Proxy 代理层或 Fiber 调度器，只有轻量的信号订阅/通知机制。

4. **编译时类型检查**：编译器可以在构建阶段检测响应式变量的误用、依赖追踪的循环引用等问题，将运行时错误前置为编译时错误。

### 信号机制的底层实现

Svelte 5 的信号实现借鉴了 TC39 Signals 提案的思想，其核心数据结构包括：

```typescript
// Svelte 内部信号概念模型
interface Signal<T> {
  value: T;
  version: number;    // 版本号，用于精确检测变化
  dependencies: Set<Effect>;  // 依赖该信号的副作用集合
  sources: Set<Signal>;       // 该信号依赖的源信号集合
}

interface Effect {
  fn: () => void | (() => void);
  dependencies: Set<Signal>;
  cleanup?: () => void;
}
```

读取信号时（`$.get(signal)`），当前正在执行的 effect 会被记录为依赖者；写入信号时（`set(signal, newValue)`），遍历所有依赖者并标记为需要重新执行。这种「推-拉」混合模式（push-based notification + pull-based evaluation）保证了细粒度的更新粒度，同时避免了纯推模型中常见的「更新风暴」问题。

与 Solid.js 的信号实现相比，Svelte 的区别在于信号的创建和连接主要发生在编译时，而 Solid.js 虽然也追求细粒度更新，但其信号操作仍然是在运行时动态构建依赖图的。这意味着 Svelte 在首次执行时没有构建依赖图的运行时开销——依赖关系在编译时就已经固定在生成的代码结构中。

### 编译输出的细节分析

让我们更深入地观察一个条件渲染组件的编译输出，以理解 Svelte 编译器的精妙之处：

```svelte
<script>
  let show = $state(true);
  let name = $state('World');
</script>

<button onclick={() => show = !show}>切换</button>
{#if show}
  <p>你好, {name}!</p>
{/if}
```

编译器会生成类似如下的代码结构（简化）：

```javascript
function Counter($$anchor) {
  let show = source(true);
  let name = source('World');

  // 创建按钮元素，绑定事件
  let button = element('button');
  button.textContent = '切换';
  delegate(['click'], button);
  button.__click = () => set(show, !$.get(show));

  // 条件渲染块：创建一个 fragment 容器
  let if_block = empty();

  // 关键：条件变化时的动态挂载/卸载
  template_effect(() => {
    if ($.get(show)) {
      // show 为 true 时渲染的子树
      let p = element('p');
      // 编译器精确知道只有这一个文本节点依赖 name
      template_effect(() => {
        p.textContent = `你好, ${$.get(name)}!`;
      }, [name]);
      set_text(if_block, '');  // 清空占位符
      append($$anchor, p);
      return () => remove(p);  // 清理函数
    } else {
      return append($$anchor, if_block);  // 显示空占位
    }
  }, [show]);  // 只依赖 show

  append($$anchor, button);
}
```

从这段编译输出可以看出：编译器为每个响应式变量都创建了精确的更新路径——`name` 的更新只影响 `<p>` 标签内的文本节点，`show` 的变化只触发条件块的挂载/卸挂。这种粒度是 Vue 的模板编译（即使是 Vapor Mode）和 React 的 Virtual DOM 都无法达到的。

---

## 对比 Vue 3 Reactivity：Proxy 的运行时哲学

### Vue 3 的响应式架构

Vue 3 的响应式系统完全在运行时工作，基于 ES6 Proxy 实现：

```vue
<script setup>
import { ref, reactive, computed, watch, watchEffect } from 'vue';

// ref：对原始值的响应式包装
const count = ref(0);
// reactive：对对象的深度响应式代理
const state = reactive({
  items: [1, 2, 3, 4, 5],
  filter: ''
});

// computed：派生计算
const doubled = computed(() => count.value * 2);
const filteredItems = computed(() =>
  state.items.filter(i => i.toString().includes(state.filter))
);

// watch：显式指定依赖
watch(count, (newVal, oldVal) => {
  console.log(`count: ${oldVal} → ${newVal}`);
});

// watchEffect：自动追踪依赖（类似 Svelte 的 $effect）
watchEffect(() => {
  document.title = `点击了 ${count.value} 次`;
});

function increment() {
  count.value++;  // 注意：需要 .value
}
</script>

<template>
  <button @click="increment">
    点击 {{ count }}，双倍: {{ doubled }}
  </button>
</template>
```

### 核心设计理念差异

| 维度 | Svelte 5 Runes | Vue 3 Reactivity |
|------|---------------|-----------------|
| **响应式建立时机** | 编译时静态分析 | 运行时 Proxy getter/setter 拦截 |
| **依赖追踪** | 编译器 AST 分析，编译时确定 | 运行时自动收集（activeEffect 栈） |
| **原始值处理** | `$state(0)` 无需包装 | `ref(0)` 需要 `.value` 访问 |
| **模板更新** | 编译为精确 DOM 操作 | Virtual DOM diff（Vapor mode 除外） |
| **心智模型** | 写 JS，编译器负责优化 | Proxy 代理 + 响应式 API |
| **运行时体积** | 极小（~3-5KB 信号核心） | 较大（响应式 + VDOM ~30KB+） |
| **灵活性** | 依赖编译器，自由度稍低 | 运行时动态，灵活性极高 |
| **调试体验** | 编译后代码不易直观阅读 | Proxy 透明，调试直观 |

Vue 的 Proxy 方案有一个显著优势：**灵活性极高**。你可以在运行时动态创建响应式对象、组合响应式逻辑、在任意 JS 文件中使用——不依赖编译器。这种灵活性在构建可复用的 composable 和全局状态管理时尤其有价值。而 Svelte 的 `$state` 在 `.svelte.js` 文件中虽然也能使用，但其最佳体验仍然与编译器深度绑定。

Vue 团队也意识到了 Proxy 的运行时开销问题，因此在 Vue 3.5+ 中推出了 Vapor Mode。这个实验性模式借鉴了 Svelte 的编译时优化思路，将模板编译为无 Virtual DOM 的命令式更新代码，但保留了 Vue 的 Proxy 响应式系统作为状态管理层。这意味着 Vue 正在走向**编译时模板优化 + 运行时响应式**的混合架构——既保留了 Proxy 的灵活性，又获得了编译时优化的性能优势。

### 关于 .value 的争论

Vue 的 `.value` 访问模式一直是社区讨论的热点话题。支持者认为 `.value` 是一种显式标记，清楚地将响应式变量与普通变量区分开来；反对者则认为这是不必要的仪式感，增加了代码噪音。

Svelte 5 选择了「无需 .value」的路线，保持了 JavaScript 的自然赋值语义。`count++` 就是 `count++`，不需要写成 `count.value++`。这个设计选择体现了 Svelte 的核心哲学：**尽量让你写的代码看起来像普通的 JavaScript**，编译器会在背后处理所有响应式细节。

Vue 社区对此也有回应——Vincent Patternotte（Vue 核心团队成员）曾指出，`.value` 在模板中会被自动解包，因此实际使用中大多数时候你并不需要手写 `.value`，只有在 `<script>` 中直接操作 ref 值时才需要。

---

## 对比 React 19 + React Compiler：不变式的编译时守护

### React 的设计理念：UI = f(state)

React 的核心哲学从 2013 年至今始终未变：**UI 是状态的函数**。组件函数在每次渲染时完整执行，产出新的 Virtual DOM 描述，再通过 reconciliation（协调）算法找出最小变更集。这种「从头重新计算」的模型带来了极大的心智简化——你不需要思考「什么变了」，只需要声明「当前状态下的 UI 是什么」。

然而，这也带来了性能问题。当组件树庞大时，不必要的重渲染会导致显著的性能损失。React 18 以前，开发者必须手动使用 `React.memo`、`useMemo`、`useCallback` 来优化，这些优化手段不仅增加了代码复杂度，还容易引入新的 bug——依赖数组遗漏、过度优化、优化层次不当等问题层出不穷。

### React Compiler 的自动守护

React Compiler（原名 React Forget）是 Meta 在 2024 年正式推出的编译工具，它的核心理念是：**让编译器自动完成开发者之前手动做的优化**。

```jsx
// React 19 + React Compiler
function TodoApp() {
  const [todos, setTodos] = useState([]);
  const [filter, setFilter] = useState('all');

  // React Compiler 自动将此 memoize，无需 useMemo
  const filteredTodos = todos.filter(todo => {
    if (filter === 'all') return true;
    if (filter === 'active') return !todo.done;
    return todo.done;
  });

  // Compiler 自动将此回调稳定化，无需 useCallback
  const handleToggle = (id) => {
    setTodos(todos.map(t =>
      t.id === id ? { ...t, done: !t.done } : t
    ));
  };

  return (
    <div>
      <FilterBar value={filter} onChange={setFilter} />
      <TodoList items={filteredTodos} onToggle={handleToggle} />
    </div>
  );
}
```

React Compiler 的编译输出会在函数体中插入缓存检查（`useMemoCache`），只有当依赖的 state/ref 变化时才重新计算派生值。但它**不改变 React 的 Virtual DOM + reconciliation 模型**——编译器只是确保「不必要的重渲染不会发生」，而非「从一开始就避免重渲染」。

React Compiler 遵循 React 的不变式规则（Rules of React），它不会改变代码的语义——如果你的代码在编译前是正确的，编译后依然正确。这种「保持语义不变」的设计哲学与 Svelte 的「重写为更高效的实现」形成了鲜明对比。

### 三大框架的信号/响应式模型对比

让我们通过同一组件的三种实现来直观对比：

```jsx
// ==================== 同一个计数器组件 ====================

// ---- Svelte 5 ----
// Counter.svelte
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);
  function increment() { count++; }
</script>

<button onclick={increment}>
  {count} × 2 = {doubled}
</button>

// ---- Vue 3 ----
// Counter.vue
<script setup>
import { ref, computed } from 'vue';
const count = ref(0);
const doubled = computed(() => count.value * 2);
function increment() { count.value++; }
</script>

<template>
  <button @click="increment">
    {{ count }} × 2 = {{ doubled }}
  </button>
</template>

// ---- React 19 + Compiler ----
// Counter.jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  // React Compiler 自动 memoize
  const doubled = count * 2;

  return (
    <button onClick={() => setCount(c => c + 1)}>
      {count} × 2 = {doubled}
    </button>
  );
}
```

```jsx
// ==================== 更复杂的例子：Todo List ====================

// ---- Svelte 5 ----
<script>
  let todos = $state([]);
  let newTodo = $state('');
  let filter = $state('all');

  let filtered = $derived.by(() => {
    switch (filter) {
      case 'active': return todos.filter(t => !t.done);
      case 'done': return todos.filter(t => t.done);
      default: return todos;
    }
  });

  let remaining = $derived(todos.filter(t => !t.done).length);

  function addTodo() {
    if (!newTodo.trim()) return;
    todos.push({ id: Date.now(), text: newTodo, done: false });
    newTodo = '';
  }

  function toggleTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
  }
</script>

<input bind:value={newTodo} onkeydown={e => e.key === 'Enter' && addTodo()} />
<button onclick={addTodo}>添加</button>

{#each filtered as todo (todo.id)}
  <label>
    <input type="checkbox" checked={todo.done} onchange={() => toggleTodo(todo.id)} />
    <span class:done={todo.done}>{todo.text}</span>
  </label>
{/each}

<p>剩余 {remaining} 项</p>

// ---- Vue 3 ----
<script setup>
import { ref, computed } from 'vue';

const todos = ref([]);
const newTodo = ref('');
const filter = ref('all');

const filtered = computed(() => {
  switch (filter.value) {
    case 'active': return todos.value.filter(t => !t.done);
    case 'done': return todos.value.filter(t => t.done);
    default: return todos.value;
  }
});

const remaining = computed(() => todos.value.filter(t => !t.done).length);

function addTodo() {
  if (!newTodo.value.trim()) return;
  todos.value.push({ id: Date.now(), text: newTodo.value, done: false });
  newTodo.value = '';
}

function toggleTodo(id) {
  const todo = todos.value.find(t => t.id === id);
  if (todo) todo.done = !todo.done;
}
</script>

<template>
  <input v-model="newTodo" @keyup.enter="addTodo" />
  <button @click="addTodo">添加</button>
  <label v-for="todo in filtered" :key="todo.id">
    <input type="checkbox" v-model="todo.done" />
    <span :class="{ done: todo.done }">{{ todo.text }}</span>
  </label>
  <p>剩余 {{ remaining }} 项</p>
</template>

// ---- React 19 + Compiler ----
import { useState, useCallback } from 'react';

function TodoApp() {
  const [todos, setTodos] = useState([]);
  const [newTodo, setNewTodo] = useState('');
  const [filter, setFilter] = useState('all');

  // React Compiler 自动优化这些派生计算
  const filtered = (() => {
    switch (filter) {
      case 'active': return todos.filter(t => !t.done);
      case 'done': return todos.filter(t => t.done);
      default: return todos;
    }
  })();

  const remaining = todos.filter(t => !t.done).length;

  const addTodo = useCallback(() => {
    if (!newTodo.trim()) return;
    setTodos(prev => [...prev, { id: Date.now(), text: newTodo, done: false }]);
    setNewTodo('');
  }, [newTodo]);

  const toggleTodo = useCallback((id) => {
    setTodos(prev => prev.map(t =>
      t.id === id ? { ...t, done: !t.done } : t
    ));
  }, []);

  return (
    <div>
      <input value={newTodo}
        onChange={e => setNewTodo(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && addTodo()}
      />
      <button onClick={addTodo}>添加</button>
      {filtered.map(todo => (
        <label key={todo.id}>
          <input type="checkbox" checked={todo.done}
            onChange={() => toggleTodo(todo.id)} />
          <span className={todo.done ? 'done' : ''}>{todo.text}</span>
        </label>
      ))}
      <p>剩余 {remaining} 项</p>
    </div>
  );
}
```

从三个版本的代码对比可以清晰看出：**Svelte 5 的代码最为精简直观**，`todos.push()` 和 `todo.done = !todo.done` 这样的直接突变在 Svelte 中是合法且高效的；Vue 需要 `.value` 访问但同样支持直接突变；React 则必须保持不可变更新模式（`map`、展开运算符），这是其心智模型的根本约束——不可变更新确保了浅比较可以正确判断组件是否需要重渲染。

---

## 性能基准与包体积分析

### 运行时性能对比

基于 2025-2026 年社区广泛引用的 JS Framework Benchmark 数据（基于 krausest/js-framework-benchmark），我们可以看到以下趋势：

| 测试场景 | Svelte 5 | Vue 3.5 | React 19 + Compiler |
|---------|----------|---------|---------------------|
| 创建 1000 行 | ~1.0x（基准） | ~1.1x | ~1.4x |
| 更新 1000 行（每 10 行） | ~1.0x | ~1.0x | ~1.3x |
| 部分更新（选中行高亮） | ~1.0x | ~1.0x | ~1.2x |
| 选择行（交换） | ~1.0x | ~1.05x | ~1.1x |
| 删除单行 | ~1.0x | ~1.0x | ~1.2x |
| 创建 10000 行 | ~1.0x | ~1.3x | ~1.8x |
| 内存占用（1000 行后） | ~1.0x | ~1.5x | ~2.0x |

（注：~1.0x 表示与最快框架持平，数值越小越好）

Svelte 5 在这些基准测试中表现优异，原因很直接：**没有 Virtual DOM diff 的开销，编译器生成的更新代码直接命中需要变更的 DOM 节点**。Vue 的性能在绝大多数场景下与 Svelte 非常接近，特别是在 Vue 3.5+ 优化之后。React 由于 Virtual DOM reconciliation 和不可变更新带来的对象创建开销，在大规模列表场景下有一定劣势，但 React Compiler 的引入正在显著缩小这一差距。

需要注意的是，这些基准测试衡量的是极端场景下的框架性能差异。在实际应用中，瓶颈往往在业务逻辑、网络请求、IO 操作上，框架渲染性能的差异在大多数业务场景中并不显著。但当应用确实需要处理高频更新（如实时仪表盘、复杂动画、拖拽排序）时，框架的渲染效率就变得至关重要了。

### 包体积对比

| 框架 | 运行时大小（gzip） | 最小组件产出 |
|------|-------------------|-------------|
| Svelte 5 | ~3-5 KB | ~2 KB |
| Vue 3.5 | ~33 KB | ~33 KB |
| React 19 | ~44 KB | ~44 KB |
| Solid.js | ~7 KB | ~3 KB |

Svelte 的「编译器框架」哲学意味着运行时极小——大部分框架逻辑在编译时被「内联」到你的组件代码中。对于简单的页面，Svelte 产出的代码甚至比 React 运行时本身还要小。Vue 和 React 则需要携带完整的运行时，但这也意味着它们的组件产物更小（框架代码是共享的，不随组件数量线性增长）。

在实际项目中，随着应用规模增长，框架运行时在总代码中的占比会越来越小，业务代码成为体积的主要来源。因此包体积优势在大型应用中会逐渐减弱，但在小部件、嵌入式场景、性能敏感的移动端页面中仍然意义重大。特别是当你的页面需要嵌入到第三方页面中（如 SaaS 产品中的可嵌入组件），几 KB 的运行时差异就可能成为关键选型因素。

---

## 常见踩坑与注意事项

### 踩坑一：`$state` 在模块顶层的行为差异

在 `.svelte` 文件中，`$state` 会被编译器转换为信号源；但在 `.svelte.js` / `.svelte.ts` 模块文件中，编译器的优化程度不同，信号的创建和追踪需要显式依赖运行时 API：

```javascript
// store.svelte.js — 模块级共享状态

// ✅ 正确：在模块文件中使用导出的函数封装
function createCounter() {
  let count = $state(0);
  return {
    get count() { return count; },
    increment() { count++; }
  };
}

export const counter = createCounter();

// ❌ 常见错误：直接在模块顶层使用 $state
// 在某些构建配置下，这可能导致多个组件共享同一个信号实例时
// 出现更新不传播的问题
let sharedCount = $state(0); // 慎用！
```

**解决方案**：始终使用工厂函数 + getter 模式封装模块级状态，确保信号的创建时机可控。

### 踩坑二：`$effect` 中的异步操作陷阱

`$effect` 的回调函数本身**不能是 async 函数**——因为 `$effect` 需要在回调执行后收集返回的清理函数，而 async 函数返回的是 Promise 而非清理函数：

```svelte
<script>
  let userId = $state(1);
  let userData = $state(null);

  // ❌ 错误：async effect 不会正确触发清理
  // $effect(async () => {
  //   const res = await fetch(`/api/users/${userId}`);
  //   userData = await res.json();
  // });

  // ✅ 正确：在同步 effect 内部调用 async 逻辑
  $effect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled) userData = data;
      });
    return () => { cancelled = true; };
  });
</script>
```

### 踩坑三：`$derived` 的过度追踪问题

当 `$derived` 的计算函数中读取了 Proxy 包装的对象的多个属性时，所有被读取的属性都会被追踪为依赖。如果计算逻辑中包含了条件分支，未必要访问的属性也会被加入依赖集合：

```svelte
<script>
  let data = $state({ type: 'user', name: 'Alice', count: 42 });

  // ⚠️ 无论 type 是什么，data.name 和 data.count 都会被追踪
  let display = $derived(
    data.type === 'user' ? data.name : `Count: ${data.count}`
  );

  // ✅ 更好的做法：拆分为多个派生值
  let userName = $derived(data.name);
  let countLabel = $derived(`Count: ${data.count}`);
  let displayOptimized = $derived(
    data.type === 'user' ? userName : countLabel
  );
</script>
```

### 踩坑四：从 Svelte 4 迁移时的 `$:` 陷阱

Svelte 4 中的 `$:` 响应式声明在 Svelte 5 中仍然可用（兼容模式），但不建议混用：

```svelte
<script>
  // ❌ 混用 Runes 和旧语法（在非 legacy 模式下会报错）
  let count = $state(0);
  $: doubled = count * 2; // 旧语法 — 不兼容！

  // ✅ 统一使用 Runes
  let count2 = $state(0);
  let doubled2 = $derived(count2 * 2);
</script>
```

### 踩坑五：`$effect` 执行时机与微任务批处理

`$effect` 的执行是**微任务批处理**的——多个同步的 `$state` 变更会合并为一次 `$effect` 执行，而非逐个触发：

```svelte
<script>
  let a = $state(0);
  let b = $state(0);

  $effect(() => {
    // 注意：这个 effect 只执行一次，而非两次
    console.log(`a=${a}, b=${b}`);
  });

  function updateBoth() {
    a = 1;
    b = 2;
    // effect 会在当前微任务结束后执行一次：a=1, b=2
  }
</script>
```

理解这一机制对于避免竞态条件和调试「为什么 effect 没有执行」的问题至关重要。

---

## 心智模型差异与开发体验（DX）对比

### 三种心智模型

**Svelte：「编译器替你思考」**
- 你写接近原生 JS 的代码，编译器负责将其转换为高效的 DOM 操作
- 响应式是显式的（`$state`、`$derived`），但更新逻辑是隐式的
- 心智负担：低。不需要理解 Virtual DOM、fiber、reconciliation
- 陷阱：调试编译后代码可能不够直观；编译器的「魔法」在边界情况下可能产生意外行为

**Vue：「运行时响应式 + 模板声明式」**
- Proxy 在运行时透明地追踪依赖，你只需声明状态和计算
- `.value` 的存在增加了些许仪式感，但换来了灵活性
- 心智负担：中等。需要理解 ref vs reactive 的选择、nextTick、watch 的调度时机
- 陷阱：响应式丢失（解构 reactive 对象）、异步更新队列的时序问题

**React：「函数式重计算 + 编译器守护」**
- 每次渲染从头计算 UI，不可变更新保证可预测性
- React Compiler 在编译层缓存计算结果，消除不必要的重渲染
- 心智负担：基础低（纯函数），优化时高（需理解 memo/useMemo/useCallback 的交互）
- 陷阱：闭包陈旧引用（stale closure）、依赖数组遗漏（即使有 Compiler 也需遵循规则）

### 调试体验对比

Svelte 5 的一个潜在痛点是调试编译后的代码。由于编译器对源码进行了大量转换，当出现问题时，浏览器开发者工具中看到的是编译输出而非你编写的源码。虽然 Svelte 提供了 source map 支持，但在复杂的编译时优化场景下，映射可能不完全准确。

Vue 的调试体验得益于浏览器开发者工具的深度集成——Vue DevTools 可以实时查看响应式状态的依赖关系图、追踪触发更新的具体来源、检查组件的 props 和 slots 状态。这种运行时可观测性是编译时框架难以完全复制的。

React 的 DevTools 同样成熟，特别是 React Compiler 引入后，开发者可以通过 compiler 插件查看哪些组件被自动 memoize 了，哪些计算被缓存了，提供了对编译优化的可观测性。

### TypeScript 集成体验

Svelte 5 + TypeScript 的体验有了质的飞跃。`$props()` 的泛型类型推断、`$state<T>` 的类型标注都非常自然：

```svelte
<script lang="ts">
  interface Props<T> {
    items: T[];
    renderItem: (item: T) => import('svelte').Snippet;
  }

  let { items, renderItem }: Props<{ id: number; name: string }> = $props();
</script>
```

Vue 3 + `<script setup lang="ts">` 同样提供了优秀的 TypeScript 支持，特别是在 `defineProps` 和 `defineEmits` 的类型推断方面。Vue 的类型工具链（`defineComponent`、`PropType`、`ExtractPropTypes`）经过多年打磨已经相当成熟。React 的 JSX + TypeScript 组合最为成熟，生态工具支持最完善，社区类型定义也最丰富——毕竟 React + TypeScript 是目前使用最广泛的前端技术组合。

---

## 何时选择哪个框架？

### 选择 Svelte 5 当：

- **追求极致性能和最小包体积**：嵌入式组件、微前端子应用、SSG 静态站点、性能敏感的移动端页面
- **团队偏好简洁直观的代码风格**：不想处理 `.value`、`useCallback`、不可变更新的心智负担
- **项目规模中小型到中型**：Svelte 的编译器哲学在这些项目中优势最明显
- **想要接近原生 Web Components 的体验**：编译输出干净，没有运行时框架痕迹
- **SvelteKit 全栈开发**：SvelteKit 2.x 与 Svelte 5 深度集成，路由/SSR/数据加载体验一流
- **开发者体验优先**：Svelte 的 DX 被广泛认为是三大框架中最流畅的

### 选择 Vue 3 当：

- **需要灵活性和渐进式采用**：可以从一个小组件开始，逐步扩展到完整 SPA
- **大型团队协作**：Vue 的模板语法天然强制关注点分离，代码规范更统一
- **丰富的生态系统需求**：Nuxt 3、VueUse、Pinia、Vuetify、Element Plus 等生态成熟度极高
- **运行时动态响应式场景**：需要在非组件上下文（如 store、composable）中灵活组合响应式逻辑
- **从 Vue 2 迁移**：Vue 3 的 Composition API 提供了平滑的迁移路径
- **亚洲市场**：Vue 在中国和日本拥有极高的社区活跃度和企业采用率

### 选择 React 19 + Compiler 当：

- **最大生态系统和人才储备**：React 的 npm 下载量、社区资源、第三方库数量仍然领先
- **React Native 跨平台需求**：一套代码 Web + Mobile 的方案最成熟
- **大型复杂应用**：React 的 Fiber 架构和 Concurrent Features 在超大应用中的调度能力无出其右
- **团队已经深度投入 React 生态**：Next.js、Remix、TanStack Query、React Hook Form 等
- **希望保持不变式心智模型**：函数式编程范式的开发者会更偏好 React 的纯函数组件模型
- **长期技术投入**：React 的向后兼容性和迁移策略在三大框架中最为保守和稳定

---

## 展望：信号的未来

2026 年的前端格局正在收敛于一个共识：**信号是响应式的正确抽象**。TC39 的 Signals 提案（由 Angular、Solid、Svelte、Vue 等框架作者联合推动）如果最终进入 ECMAScript 标准，将从根本上改变框架设计——响应式可能成为语言原生能力而非框架特性。

这一提案的核心愿景是：不同框架之间可以共享信号基础设施，一个框架创建的信号可以在另一个框架的组件中使用，消除框架间的互操作壁垒。如果这一愿景实现，前端生态可能会迎来一次真正的「大一统」——框架的竞争将从「谁的响应式更高效」转向「谁的开发体验更好」和「谁的生态系统更完善」。

在此之前，三大框架正在各自的哲学路线上不断深化：

- **Svelte** 继续深耕编译时优化，未来可能引入更激进的全程序分析优化，进一步压缩编译产出
- **Vue** 通过 Vapor Mode 拥抱编译时优化，同时保持运行时响应式的灵活性，探索「渐进式编译」的新范式
- **React** 通过 Compiler 将「零开销抽象」的理念注入不变式模型，让开发者写「朴素」代码也能获得极致性能

对于开发者而言，最好的策略是**深入理解一种框架的哲学和机制**，同时保持对其他框架设计理念的了解。因为最终，框架只是工具，真正重要的是你对 UI 编程本质问题的理解——**如何高效地将状态变化映射为界面更新**。

---

## 总结

Svelte 5 Runes 代表了编译时响应式设计的前沿实践。通过 `$state`、`$derived`、`$effect`、`$props` 四个核心原语，Svelte 将响应式逻辑的确定工作从运行时前置到编译时，生成的代码精确、高效、接近手写原生 DOM 操作的性能。编译器通过静态分析 AST 确定依赖关系、生成精确的 DOM 更新路径、消除 Virtual DOM diff 开销，这些编译时决策带来了运行时的零框架负担。

与 Vue 3 的 Proxy 运行时响应式相比，Svelte 5 以编译时确定性换取了运行时灵活性。Vue 的 Proxy 系统虽然在运行时有额外开销，但提供了动态创建响应式对象、灵活组合 composable 的能力。与 React Compiler 的自动 memoization 相比，Svelte 5 跳过了 Virtual DOM diff 这一层，直接在编译时就规划好了精确的 DOM 更新路径——React Compiler 优化的是「哪些组件需要重渲染」，而 Svelte 编译器优化的是「哪些 DOM 节点需要更新」。

三大框架没有绝对的优劣之分——它们是对同一问题的不同回答。Svelte 的回答是「让编译器做更多工作」，Vue 的回答是「在运行时优雅地抽象复杂性」，React 的回答是「保持简单模型，让编译器来守护性能」。理解这些设计理念的差异，才能在具体的项目语境中做出最合适的技术选型。

在信号革命的浪潮中，唯一不变的是变化本身。持续学习、深入理解底层原理，才是前端工程师最可靠的「信号」。

---

## 相关阅读

- [Signals 范式对比：Angular / Vue / Solid / Preact 响应式原理]({% post_path 2026-06-05-Signals-范式对比-Angular-Vue-Solid-Preact-响应式原理 %}) — 从更宏观的视角审视 Signals 提案在各大框架中的实现差异
- [React 19 Compiler 自动 Memoization 革命]({% post_path 2026-06-04-react-19-compiler-auto-memoization-revolution %}) — 深入了解 React Compiler 如何通过编译时自动优化解决重渲染问题
- [Vue Vapor Mode 实战：无 Virtual DOM 的 Vue 编译时优化]({% post_path Vue-Vapor-Mode-实战-无Virtual-DOM的Vue编译时优化-对比SolidJS的细粒度响应式性能 %}) — 探索 Vue 拥抱编译时优化的实验性模式
- [SvelteKit 2.x 实战：全栈框架新选择]({% post_path SvelteKit-2x-实战-全栈框架新选择-与-Next.js-Nuxt-性能对比与开发体验评测 %}) — 用 SvelteKit 构建全栈应用的完整指南
