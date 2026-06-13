---

title: SolidJS 实战：细粒度响应式前端框架——无 Virtual DOM 的极致性能与 React 开发者迁移路径
keywords: [SolidJS, Virtual DOM, React, 细粒度响应式前端框架, 的极致性能与, 开发者迁移路径]
date: 2026-06-04 08:00:00
tags:
- SolidJS
- 前端框架
- 响应式
- TypeScript
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: 深入解析 SolidJS 细粒度响应式前端框架的核心原理，对比 React/Vue 的 Virtual DOM 机制，详解 Signals、Effects、Memos 等响应式原语的实战用法与性能优化技巧。涵盖从 React 迁移路径、常见踩坑记录、任务管理应用完整案例，以及 JS Framework Benchmark 性能基准测试数据，帮助开发者全面评估 SolidJS 前端框架的选型价值。
---




# SolidJS 实战：细粒度响应式前端框架——无 Virtual DOM 的极致性能与 React 开发者迁移路径

## 引言：为什么我们需要重新审视前端框架的性能范式

在过去十年的前端开发历程中，我们见证了从 jQuery 手动操作 DOM 到 React、Vue、Angular 等声明式框架全面崛起的技术演进。这场演进的核心驱动力始终围绕一个根本命题：**如何在开发效率与运行时性能之间取得最优平衡？** React 凭借其 Virtual DOM 机制和声明式编程范式，成功地让开发者从繁琐的 DOM 操作中解放出来，一举成为全球最主流的前端框架。然而，随着单页应用复杂度的持续攀升，特别是在数据看板、实时协作工具、高频交互表单等性能敏感场景中，一个根本性的质疑开始浮出水面：**Virtual DOM 的 diff 算法真的是响应式更新的最优解吗？**

答案是否定的。Virtual DOM 本质上是一种"暴力但有效"的折中方案。它通过在内存中维护一份虚拟的 DOM 树，每次状态变化时重建整棵虚拟树，然后通过 diff 算法找出差异并应用到真实 DOM 上。这意味着即使只有一个文本节点发生了变化，整个组件子树都必须被重新计算和比较。在组件树庞大、状态频繁更新的场景下，这种粗粒度的更新策略带来了大量不必要的计算开销。尽管 React 引入了 Fiber 架构来进行时间分片，引入了并发模式来优化用户体验，但这些都只是在"粗粒度重渲染"这个根本模型上的优化，而非本质性的解决。

从 2024 年开始，前端框架的性能竞赛进入了一个全新的阶段。以 SolidJS、Qwik、Preact Signals 为代表的"无 Virtual DOM"或"细粒度响应式"方案正在从根本上挑战传统认知。在这些方案中，SolidJS 无疑是最具代表性和最为成熟的框架。它由 Ryan Carniato 于 2018 年开始创建，历经多年打磨，在 JS Framework Benchmark 等权威基准测试中持续展现出远超 React 和 Vue 的运行时性能，甚至逼近原生 JavaScript 手动操作 DOM 的速度。

SolidJS 的核心思想可以用一句话概括：**组件函数只执行一次，状态变化直接精确更新到对应的 DOM 节点。** 这意味着没有 Virtual DOM diff，没有组件重渲染，没有不必要的函数调用。通过编译时分析与运行时细粒度追踪的结合，SolidJS 将前端框架的性能推向了一个新的高度。

本文将从实战角度出发，深入剖析 SolidJS 的核心机制——细粒度响应式系统。我们将从响应式原语的基本概念讲起，逐步深入到组件模式、状态管理、性能优化，并最终为 React 开发者提供一条清晰完整的迁移路径。无论你正在评估团队的技术选型，还是对高性能前端开发有着浓厚兴趣，这篇文章都将为你提供系统性的参考和实战指导。

---

## 一、SolidJS 核心理念：告别 Virtual DOM，拥抱细粒度响应式

### 1.1 什么是细粒度响应式，它与粗粒度响应式的根本区别

要真正理解 SolidJS 的精髓，首先需要深入理解"细粒度响应式"与"粗粒度响应式"之间的本质差异。这两种范式代表了前端框架处理状态更新的两种根本不同的哲学。

在 React 中，响应式的粒度是**组件级别**的。当一个组件的状态发生变化时，React 会重新执行该组件的函数体，生成新的 Virtual DOM 树，然后通过 reconciliation 过程与旧树进行比较，最终将差异应用到真实 DOM 上。这就是我们常说的"重渲染"。问题在于，如果一个拥有数十个子组件的页面中，只有一个按钮的文本需要变化，React 仍然会从状态变化点开始，自顶向下地重渲染整个受影响的子树。尽管 React 提供了 `React.memo`、`useMemo`、`useCallback` 等优化手段，但这些都需要开发者手动干预，且容易出错——遗漏一个依赖项就可能导致过期闭包的 bug，而过度使用则会让代码变得冗长难读。

Vue 3 的响应式系统更进一步，采用了基于 Proxy 的细粒度追踪机制。当组件模板中的某个表达式依赖了响应式数据时，Vue 能够精确地知道哪些数据变化需要触发哪些 DOM 更新。然而，Vue 的更新仍然发生在**组件级别**——当响应式数据变化时，整个组件的渲染函数仍会被重新执行，只是在 patch 阶段利用编译时信息来跳过静态节点。这意味着在组件内部存在大量计算逻辑时，Vue 仍然会有不必要的开销。

SolidJS 则采取了一种更为极致的策略。它的响应式粒度是**变量级别**的。当一个 Signal（SolidJS 的基本响应式单元）的值发生变化时，只有直接依赖该 Signal 的那个精确的 DOM 操作会被执行。组件函数体本身只在组件首次挂载时执行一次，之后再也不会被调用。这是一种真正的"订阅-通知"模型，每个 Signal 精确地维护着它的订阅者列表，当值变化时通知所有订阅者执行最小化的更新操作。

让我们通过一个具体的场景来直观感受这种差异。假设页面上有一个标题组件显示用户名、一个计数器组件和一个不相关的列表组件。当用户点击按钮将计数器加一时，在 React 中，计数器组件会重渲染，如果列表组件没有被 `React.memo` 包裹，也可能受到影响而重渲染。在 SolidJS 中，计数器的 Signal 值变化只会触发模板中引用了 `count()` 的那个文本节点的更新，标题组件和列表组件完全不受影响——不需要 `memo`，不需要 `useCallback`，不需要任何手动优化。

```tsx
// === React 组件：每次状态变化都重新执行函数体 ===
const Counter: React.FC = () => {
  const [count, setCount] = useState(0);
  // 每次 count 变化，整个函数都会重新执行
  console.log('组件渲染了'); // 每次点击都会打印
  return (
    <div>
      <p>计数: {count}</p>
      <button onClick={() => setCount(count + 1)}>+1</button>
    </div>
  );
};

// === SolidJS 组件：函数体只执行一次 ===
const Counter: Component = () => {
  const [count, setCount] = createSignal(0);
  // 只在组件挂载时执行一次
  console.log('组件初始化'); // 只打印一次，后续点击不会打印
  return (
    <div>
      <p>计数: {count()}</p>
      <button onClick={() => setCount(count() + 1)}>+1</button>
    </div>
  );
};
```

### 1.2 编译时优化与运行时追踪的完美结合

SolidJS 的高性能并非仅仅依赖运行时的细粒度追踪，其编译器同样发挥着至关重要的作用。SolidJS 的 Babel 插件在编译阶段会对 JSX 进行深度分析和优化，将开发者编写的声明式模板转换为接近原生 DOM 操作的命令式代码。

当 SolidJS 编译器处理一个组件时，它会将模板中的静态部分和动态部分进行分离。静态 HTML 结构会被预先序列化为模板字符串，通过 `cloneNode` 高效地克隆到 DOM 中；动态绑定则会被转换为独立的 `createEffect` 调用，每个 effect 精确地负责更新一个 DOM 节点或属性。这种编译策略确保了组件的初始渲染尽可能快速，而后续更新则尽可能精确。

与之对比，React 的 JSX 编译后仅仅是 `React.createElement` 调用的嵌套组合，这些调用会构建出一棵完整的 Virtual DOM 树，然后由 React 的协调器进行 diff。SolidJS 的编译输出则跳过了 Virtual DOM 这个中间层，直接指向真实 DOM 中需要更新的位置。

```tsx
// 你编写的 SolidJS 代码
const App: Component = () => {
  const [name, setName] = createSignal('World');
  return <h1>Hello, {name()}!</h1>;
};

// 编译器生成的代码（简化示意）
import { template as _$tmpl } from 'solid-js/web';
const _tmpl$ = _$tmpl(`<h1>Hello, !</h1>`, 2);

const App: Component = () => {
  const [name, setName] = createSignal('World');
  return (() => {
    const _el$ = _tmpl$.cloneNode(true);  // 直接克隆模板节点
    const _text$ = _el$.firstChild.nextSibling;
    // 仅在 name() 变化时更新这个文本节点
    createEffect(() => { _text$.data = name(); });
    return _el$;
  })();
};
```

这种编译时与运行时的协同优化是 SolidJS 性能优势的根本来源。编译器负责分析模板结构并生成高效的更新代码，运行时的响应式系统则负责精确追踪依赖关系并触发最小化的更新。两者的结合使得 SolidJS 在保持优秀开发体验的同时，达到了接近原生 JavaScript 的运行时性能。

值得一提的是，SolidJS 的编译器还支持静态提升（Static Hoisting）优化。当模板中存在静态的 DOM 结构时，编译器会将其提升为模块级别的常量，避免在每次函数调用时重复创建。这与 React 的 `useMemo` 在概念上类似，但完全自动完成，开发者无需手动干预。此外，编译器还会将相邻的文本节点合并，减少 DOM 操作的次数。这些看似微小的优化在大型应用中累积起来，能够带来显著的性能提升。

从框架设计的角度来看，SolidJS 的编译策略代表了一种"编译时框架"的发展方向。与传统框架将复杂性放在运行时不同，SolidJS 尽可能在编译阶段完成分析和优化，让运行时代码尽可能轻量和高效。这种设计理念与 Rust 语言的"零成本抽象"有异曲同工之妙——开发者编写的高级声明式代码，在编译后会变成与手写命令式代码几乎等价的高效执行路径。

---

## 二、SolidJS 响应式原语深度解析

SolidJS 的响应式系统建立在几个核心原语之上，理解这些原语是掌握 SolidJS 开发的关键。下面我们逐一深入讲解每个原语的设计理念、使用方法和最佳实践。

### 2.1 Signals：响应式数据的基石

Signals 是 SolidJS 中最基础也是最核心的响应式原语。从表面上看，它类似于 React 的 `useState`——都是返回一个值和一个更新函数的元组。但两者在本质上有着根本性的区别。

首先，SolidJS 的 `createSignal` 返回的第一个元素不是一个值，而是一个**getter 函数**。你必须通过调用 `count()` 而非直接访问 `count` 来获取当前值。这不仅仅是一个语法差异，而是 SolidJS 细粒度追踪机制的基础——当你调用 `count()` 时，SolidJS 会在当前的响应式上下文中自动注册依赖关系，这样当 Signal 的值发生变化时，SolidJS 就精确地知道应该通知哪些订阅者。

其次，Signal 的 setter 函数支持直接赋值和函数式更新两种模式。在函数式更新中，你可以接收上一个值作为参数，这对于依赖前值的计算场景非常有用。此外，`createSignal` 还接受一个可选的配置对象，其中最常用的是 `equals` 选项，用于自定义新旧值的比较逻辑，避免不必要的更新。在 TypeScript 环境下，Signal 的类型推断非常强大，当你给 `createSignal` 传入一个初始值时，TypeScript 会自动推断出 getter 和 setter 的类型。

一个常见的最佳实践是：**将 Signal 视为一个原子化的状态单元。** 不要把一个大对象塞进单个 Signal 中，而是将不同的状态维度拆分到不同的 Signal 中。这不仅能最大化细粒度追踪的收益，还能让代码的依赖关系更加清晰。只有当多个相关的状态必须保持一致性时，才考虑使用 Store（我们稍后会详细讲解）。

在实际开发中，合理拆分 Signal 是一项重要的设计决策。例如，对于一个用户信息表单，你可以选择用一个 Signal 存储整个表单对象，也可以将姓名、邮箱、电话分别拆分为独立的 Signal。后者虽然在代码上稍显冗长，但在更新效率上有明显优势——修改邮箱时不会触发与姓名相关的任何更新逻辑。这种"最小化状态粒度"的思想与函数式编程中"最小化副作用"的理念一脉相承，都是为了让程序的行为更加可预测和高效。

```tsx
import { createSignal } from 'solid-js';

// 基本用法
const [count, setCount] = createSignal(0);
console.log(count()); // 0 —— 调用函数获取值
setCount(1);          // 更新值
console.log(count()); // 1

// 使用函数式更新（依赖前值）
setCount((prev) => prev + 1);

// TypeScript 泛型支持：显式指定类型
const [user, setUser] = createSignal<{ name: string; age: number }>({
  name: 'Alice', age: 30,
});

// 自定义比较函数，避免不必要的更新
const [items, setItems] = createSignal<Item[]>([], {
  equals: (prev, next) =>
    prev.length === next.length &&
    prev.every((item, i) => item.id === next[i].id),
});
```

### 2.2 Effects：自动追踪依赖的响应式副作用

`createEffect` 是 SolidJS 中处理副作用的核心 API。它的设计理念非常简洁：创建一个执行上下文，在该上下文中对 Signal getter 的所有调用都会被自动追踪为依赖。当任何一个依赖的 Signal 值发生变化时，这个 effect 会被重新调度执行。

这与 React 的 `useEffect` 有着本质区别。在 React 中，你必须手动在依赖数组中列出所有依赖项，如果遗漏了某个依赖，就可能导致 stale closure 的 bug。而 SolidJS 的 `createEffect` 不需要任何依赖数组——依赖关系在运行时通过 getter 调用自动建立。这种设计从根本上消除了"依赖数组遗漏"这类常见 bug。

`createEffect` 的另一个重要特性是它与 `onCleanup` 的配合。当你在 effect 函数中设置了定时器、订阅了事件监听器、或建立了 WebSocket 连接时，你可以在同一个函数中调用 `onCleanup` 来注册清理函数。这个清理函数会在 effect 重新执行之前或组件卸载时被自动调用，确保不会出现资源泄漏。

值得注意的是，`createEffect` 会在当前微任务结束时同步执行（初次调用时），而不是像 React 的 `useEffect` 那样被推迟到下一次绘制之后。如果你需要等待 DOM 更新后再执行副作用，可以使用 `onMount`。

除了 `createEffect` 之外，SolidJS 还提供了几个变体 API 来满足不同的副作用场景。`createRenderEffect` 是一个更低级的 API，它会在渲染之前同步执行，主要用于框架内部的 DOM 绑定。`createComputed` 则用于需要在 DOM 更新之前执行的派生计算。在日常开发中，`createEffect` 是最常用的，但了解这些变体有助于在特殊场景下做出正确的选择。

另一个值得深入了解的概念是"响应式上下文"（Reactive Context）。在 SolidJS 中，只有在 `createEffect`、`createMemo`、`createRenderEffect`、模板绑定函数等特定的响应式上下文中读取 Signal，才会触发依赖追踪。如果你在事件处理函数、定时器回调、或普通的异步函数中读取 Signal，它只是一个普通的函数调用，不会建立任何依赖关系。这个特性在某些场景下非常有用——你可以在事件处理函数中自由地读取 Signal 的当前值，而不用担心触发不必要的更新。

```tsx
import { createSignal, createEffect, onCleanup } from 'solid-js';

const [count, setCount] = createSignal(0);
const [name, setName] = createSignal('Solid');

// Effect 自动追踪依赖——无需手动指定依赖数组
createEffect(() => {
  console.log(`Count 变为 ${count()}`);
  // 只有 count 变化时才重新执行
});

createEffect(() => {
  console.log(`Name 变为 ${name()}`);
  // 只有 name 变化时才重新执行
});

// 带清理逻辑的 Effect
createEffect(() => {
  const value = count(); // 追踪依赖
  const timer = setInterval(() => {
    console.log(`当前计数: ${value}`);
  }, 1000);
  // 清理函数：在 effect 重新执行前或组件卸载时自动调用
  onCleanup(() => clearInterval(timer));
});

setCount(1);  // 触发第一个和第三个 effect
setName('JS'); // 仅触发第二个 effect
```

### 2.3 Memos：带缓存的派生状态计算

`createMemo` 用于创建派生状态，它会缓存计算结果，只在其依赖变化时重新计算。这与 React 的 `useMemo` 在概念上类似，但在实现上更加可靠——SolidJS 不需要依赖数组，且保证了缓存的有效性。

`createMemo` 的核心价值在于**缓存**和**短路**。当一个 memo 的某个依赖发生变化时，如果计算结果与前值相同（通过严格相等比较或自定义比较函数判断），memo 不会通知它的下游订阅者。这在处理复杂派生数据时非常有用，可以避免大量不必要的 effect 触发。

一个重要的使用场景是将昂贵的计算逻辑封装在 `createMemo` 中。例如，对一个大型列表进行过滤和排序，这个操作的计算成本可能很高，但只要源数据和过滤条件没有变化，就不需要重新计算。通过 `createMemo`，你可以确保这个计算只在必要时执行。

```tsx
import { createSignal, createMemo } from 'solid-js';

const [firstName, setFirstName] = createSignal('John');
const [lastName, setLastName] = createSignal('Doe');

// 自动追踪依赖，无需手动指定
const fullName = createMemo(() => {
  console.log('重新计算 fullName');
  return `${firstName()} ${lastName()}`;
});

console.log(fullName()); // "John Doe"，打印 "重新计算 fullName"
setFirstName('Jane');     // 触发重新计算
console.log(fullName()); // "Jane Doe"

// 使用 memo 进行昂贵计算的缓存优化
const [products, setProducts] = createSignal<Product[]>([]);
const [searchTerm, setSearchTerm] = createSignal('');

const filteredProducts = createMemo(() => {
  console.log('执行过滤计算'); // 只在依赖变化时执行
  const term = searchTerm().toLowerCase();
  return products().filter(p =>
    p.name.toLowerCase().includes(term) ||
    p.category.toLowerCase().includes(term)
  );
});
// 即使在模板中多次使用 filteredProducts()，计算也只执行一次
```

### 2.4 Resources：优雅的异步数据管理

`createResource` 是 SolidJS 内置的异步数据获取原语，它将异步操作与响应式系统深度集成。当你需要从服务端获取数据时，`createResource` 提供了一种声明式的方式来管理加载状态、错误状态和数据刷新。

`createResource` 接收一个"源"参数（可以是一个 Signal 或返回值的函数）和一个"获取器"函数。当源参数的值发生变化时，获取器函数会被自动调用，就像一个响应式的数据获取管道。返回值不仅包含数据本身，还包含 `loading`、`error` 等状态，以及 `mutate`（乐观更新）和 `refetch`（手动刷新）等操作方法。

在 SolidStart（SolidJS 的全栈元框架）中，`createResource` 还能与服务端函数无缝配合，实现服务端数据预取和客户端水合，这使得构建同构应用变得非常直观。

```tsx
import { createResource, createSignal, Show, For } from 'solid-js';

interface User {
  id: number; name: string; email: string; avatar: string;
}

const fetchUsers = async (page: number): Promise<User[]> => {
  const response = await fetch(`/api/users?page=${page}`);
  if (!response.ok) throw new Error('获取用户列表失败');
  return response.json();
};

const UserList: Component = () => {
  const [page, setPage] = createSignal(1);
  // 当 page() 变化时，自动重新 fetch
  const [users, { mutate, refetch }] = createResource(page, fetchUsers);
  
  // 乐观更新示例
  const updateUserName = (userId: number, newName: string) => {
    mutate((prev) =>
      prev?.map(u => u.id === userId ? { ...u, name: newName } : u)
    );
  };

  return (
    <div>
      <Show when={!users.loading} fallback={<div class="spinner">加载中...</div>}>
        <Show when={!users.error} fallback={<div class="error">{users.error?.message}</div>}>
          <ul>
            <For each={users()}>
              {(user) => (
                <li class="user-card">
                  <img src={user.avatar} alt={user.name} />
                  <strong>{user.name}</strong> — {user.email}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <div class="pagination">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page() === 1}>上一页</button>
        <span>第 {page()} 页</span>
        <button onClick={() => setPage(p => p + 1)}>下一页</button>
      </div>
      <button onClick={() => refetch()}>刷新数据</button>
    </div>
  );
};
```

### 2.5 Stores：深层响应式与结构化数据管理

虽然 Signal 非常适合管理原子化的状态，但在处理复杂嵌套的数据结构时，逐层解包 Signal 会变得非常繁琐。为此，SolidJS 提供了 `createStore`，它创建一个基于 Proxy 的深层响应式对象。

Store 与 Signal 的核心区别在于：Store 通过路径化的方式进行读取和写入，支持深层嵌套的响应式追踪。当你读取 `state.user.profile.name` 时，Store 会自动追踪这个精确的路径；当你调用 `setState('user', 'profile', 'name', 'Bob')` 时，只有依赖了这个特定路径的订阅者会被通知。

Store 最强大的特性之一是它与 `produce` 的集成。`produce` 基于 Immer 的概念，允许你以命令式的方式编写更新逻辑——直接修改 draft 对象的属性——然后 Store 会自动计算出最小化的差异并精确地通知相关订阅者。这在处理复杂的嵌套更新时极大地简化了代码。

Store 还提供了 `reconcile` 函数，用于将来自服务端的普通对象数据高效地合并到响应式 Store 中。`reconcile` 会深度比较新旧数据，只为真正发生变化的属性触发更新，避免了整个对象替换导致的全量通知。

```tsx
import { createStore, produce, reconcile } from 'solid-js/store';

interface AppState {
  user: {
    profile: { name: string; avatar: string; bio: string };
    settings: { theme: 'light' | 'dark'; language: string; notifications: boolean };
  };
  todos: Todo[];
  ui: { sidebarOpen: boolean; activeModal: string | null };
}

const [state, setState] = createStore<AppState>({
  user: {
    profile: { name: 'Alice', avatar: '/avatars/alice.png', bio: '前端开发者' },
    settings: { theme: 'light', language: 'zh-CN', notifications: true },
  },
  todos: [],
  ui: { sidebarOpen: false, activeModal: null },
});

// 路径化精确更新——只有依赖了 user.profile.name 的订阅者会被通知
setState('user', 'profile', 'name', 'Bob');
setState('user', 'settings', 'theme', 'dark');
setState('ui', 'sidebarOpen', true);

// 使用 produce 进行命令式更新（类似 Immer）
setState('todos', produce((draft) => {
  draft.push({ id: Date.now(), text: '学习 SolidJS', completed: false });
  if (draft.length > 0) draft[0].completed = true;
}));

// 使用 reconcile 处理来自服务端的数据
const serverData = await fetch('/api/state').then(r => r.json());
setState(reconcile(serverData));

// 条件更新：只更新匹配条件的数组元素
setState('todos', (t) => t.id === targetId, 'completed', true);
```

---

## 三、组件模式与开发实战技巧

### 3.1 组件定义与 Props 响应式处理

SolidJS 的组件有几个关键特性需要开发者特别注意。首先，组件函数体只在挂载时执行一次，之后再也不会被调用。这意味着组件内部的局部变量和初始化逻辑只需要执行一次，这与 React 中每次渲染都重新执行的模式完全不同。

其次，也是最需要注意的一点：**永远不要解构 Props。** 在 React 中，解构 Props 是一种非常常见的编码习惯，因为 React 每次渲染时都会传入新的 Props 对象。但在 SolidJS 中，Props 是一个响应式代理对象，对它的属性访问会被自动追踪。如果你在组件顶部解构 Props，就会将响应式的属性访问"冻结"为初始值，失去后续更新的响应性。

如果你确实需要从 Props 中分离出一部分（比如将自定义 Props 与透传给子组件的 Props 分开），SolidJS 提供了 `splitProps` 工具函数。它会将一个 Props 对象按指定的键名列表拆分成多个对象，每个对象都保持响应式的代理特性。

SolidJS 还提供了 `children` 工具函数，用于解析和缓存 `props.children`。由于 `children` 可能是函数（如 render props）、数组或单个元素，直接读取可能不够稳定，使用 `children()` 函数可以确保得到一个已解析的、可用于条件判断的稳定引用。

```tsx
import { Component, JSX, ParentComponent, splitProps, children } from 'solid-js';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: () => void;
  class?: string;
  children: JSX.Element;
}

// ❌ 错误写法：解构 Props 会破坏响应式
const BadButton = ({ variant, size, children }: ButtonProps) => {
  return <button class={`btn btn-${variant} btn-${size}`}>{children}</button>;
};

// ✅ 正确写法：保持 Props 的响应式代理
const Button: ParentComponent<ButtonProps> = (props) => {
  const [local, rest] = splitProps(props, ['variant', 'size', 'class', 'children']);
  const resolved = children(() => local.children);
  return (
    <button
      class={`btn ${local.variant ?? 'primary'} ${local.size ?? 'md'} ${local.class ?? ''}`}
      disabled={rest.disabled}
      onClick={rest.onClick}
    >
      {resolved()}
    </button>
  );
};
```

### 3.2 控制流组件：条件渲染与列表渲染

SolidJS 采用专有的控制流组件来处理条件渲染和列表渲染，这与 React 直接在 JSX 中使用 JavaScript 表达式的做法不同。这种设计选择背后有着深刻的性能考量——控制流组件将创建逻辑封装在内部，只在条件真正变化时才挂载或卸载子组件，从而避免了不必要的 DOM 操作。

`<Show>` 组件用于条件渲染，它支持 `when` 属性（条件表达式）和 `fallback` 属性（条件不满足时的备选内容）。一个非常实用的特性是，`<Show>` 的子内容可以是一个接收参数的函数，这个参数是 `when` 属性的非空值，从而避免了在子内容中再次判断空值的需要。

`<For>` 组件用于列表渲染，它基于 key 的概念来高效地复用 DOM 元素。当列表数据变化时，`<For>` 会通过智能的差异算法来最小化 DOM 操作——移动、新增、删除元素，而不是像简单映射那样全量替换。每个列表项的回调函数也会接收一个 `index` 信号，当项的位置变化时，这个索引值会自动更新。

`<Index>` 是另一个列表渲染组件，它与 `<For>` 的区别在于：`<Index>` 基于索引位置来追踪变化，而 `<For>` 基于数据引用来追踪。在大多数场景下，推荐使用 `<For>`；只有在列表项是不可变的原始值时，才考虑使用 `<Index>`。

```tsx
import { Show, For, Switch, Match, Index } from 'solid-js';

// 条件渲染与类型收窄
const UserProfile: Component<{ userId: number }> = (props) => {
  const [user] = createResource(() => props.userId, fetchUser);
  return (
    <div>
      <Show when={user()} fallback={<p>加载用户信息中...</p>}>
        {(userData) => (
          <div class="profile">
            <h2>{userData().name}</h2>
            <p>{userData().bio}</p>
          </div>
        )}
      </Show>
      {/* 多条件分支 */}
      <Switch fallback={<span class="badge">未知状态</span>}>
        <Match when={user()?.status === 'active'}><span class="badge green">活跃</span></Match>
        <Match when={user()?.status === 'inactive'}><span class="badge gray">不活跃</span></Match>
        <Match when={user()?.status === 'banned'}><span class="badge red">已封禁</span></Match>
      </Switch>
    </div>
  );
};

// 列表渲染
const TodoList: Component = () => {
  const [todos, setTodos] = createSignal<Todo[]>([]);
  return (
    <ul>
      <For each={todos()} fallback={<li>暂无待办事项</li>}>
        {(todo, index) => (
          <li class={todo.completed ? 'completed' : ''}>
            <input type="checkbox" checked={todo.completed}
              onChange={() => setTodos(prev =>
                prev.map((t, i) => i === index() ? { ...t, completed: !t.completed } : t)
              )} />
            <span>{todo.text}</span>
            <button onClick={() => setTodos(prev => prev.filter((_, i) => i !== index()))}>删除</button>
          </li>
        )}
      </For>
    </ul>
  );
};
```

### 3.3 Context 与全局状态管理

SolidJS 的 Context API 在概念上与 React 的 Context 非常相似，都提供了一种在组件树中传递数据而不需要逐层 Props 传递的机制。然而，SolidJS 的 Context 与它的响应式系统深度集成，当 Provider 的 value 中包含 Signal 时，消费者可以精确地追踪其中的响应式值。

使用 Context 时需要注意的一个最佳实践是：Provider 的 value 应该是一个包含 Signal getter 的稳定对象引用，而不是在每次渲染时创建的新对象。由于 SolidJS 的组件不会重渲染，这一点通常不需要特别操心，但如果你在 Provider 中使用了动态计算的值，建议使用 `createMemo` 来确保引用稳定性。

```tsx
import { createContext, useContext, ParentComponent } from 'solid-js';

interface ThemeContextType {
  theme: () => string;
  toggleTheme: () => void;
  accentColor: () => string;
}

const ThemeContext = createContext<ThemeContextType>();

export const ThemeProvider: ParentComponent = (props) => {
  const [theme, setTheme] = createSignal('light');
  const [accentColor, setAccentColor] = createSignal('#3b82f6');
  const value: ThemeContextType = {
    theme,
    toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light'),
    accentColor,
  };
  return (
    <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内部使用');
  return ctx;
};

// 使用
const ThemedButton: Component = () => {
  const { theme, toggleTheme, accentColor } = useTheme();
  return (
    <button style={{ 'background-color': accentColor() }} class={`theme-${theme()}`} onClick={toggleTheme}>
      当前主题: {theme()}，点击切换
    </button>
  );
};
```

### 3.4 自定义可组合的响应式逻辑

SolidJS 没有 React Hooks 那样的"只能在组件顶层调用"的限制，因为它的响应式系统是基于执行上下文而非组件生命周期的。这意味着你可以在任何时候、任何地方创建 Signal、Effect 和 Memo。这种灵活性使得编写可复用的响应式逻辑变得非常直观和自然。社区通常将这类可复用的响应式逻辑称为"Composables"或"Primitives"。

```tsx
// LocalStorage 持久化 Signal
function createLocalStorageSignal<T>(key: string, defaultValue: T) {
  const stored = localStorage.getItem(key);
  const initial = stored ? JSON.parse(stored) : defaultValue;
  const [value, setValue] = createSignal<T>(initial);
  createEffect(() => localStorage.setItem(key, JSON.stringify(value())));
  return [value, setValue] as const;
}

// 防抖 Signal
function createDebouncedSignal<T>(value: () => T, delay: number) {
  const [debounced, setDebounced] = createSignal(value());
  let timer: ReturnType<typeof setTimeout>;
  createEffect(() => {
    const v = value();
    clearTimeout(timer);
    timer = setTimeout(() => setDebounced(() => v), delay);
    onCleanup(() => clearTimeout(timer));
  });
  return debounced;
}

// 组合使用示例：搜索栏
const SearchBar: Component = () => {
  const [query, setQuery] = createSignal('');
  const debouncedQuery = createDebouncedSignal(query, 300);
  const [results] = createResource(debouncedQuery, async (q) => {
    if (!q) return [];
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    return res.json();
  });
  return (
    <div>
      <input type="text" value={query()} onInput={e => setQuery(e.currentTarget.value)} placeholder="搜索..." />
      <Show when={results()}>
        <ul><For each={results()}>{(item) => <li>{item.title}</li>}</For></ul>
      </Show>
    </div>
  );
};
```

---

## 四、SolidJS 与 React、Vue 的全面对比分析

### 4.1 更新机制的本质差异

React 采用的是"整体重建，差异应用"的策略。组件函数在每次渲染时完全重新执行，然后通过 Virtual DOM diff 算法来找出最小的 DOM 变更。这种策略的优势在于心智模型简单——每次渲染都是一次全新的快照，但缺点也很明显：大量不必要的重计算和 diff 算法本身的开销。

Vue 3 采用了"编译时标记加运行时 Proxy 追踪"的混合策略。模板编译器会标记出静态节点和动态绑定，运行时的 Proxy 系统则追踪响应式数据的访问。这比 React 更高效，但组件渲染函数仍然会完整执行。

SolidJS 则采用了"编译时完全分析加运行时 Signal 订阅"的策略。编译器将模板分解为独立的更新单元，运行时的 Signal 系统精确地将每个更新单元与它依赖的 Signal 关联起来。当 Signal 变化时，只有订阅了该 Signal 的 DOM 操作会执行。

### 4.2 开发者心智模型对比

在 React 中，开发者需要时刻关注"这个组件什么时候会重渲染"、"这个闭包是否捕获了过期的值"、"这个回调是否需要 memo 包裹"等问题。这些问题不仅增加了心智负担，还常常成为 Bug 的温床。React Compiler 的出现正在通过编译手段来缓解这些问题，但它本质上是一种"补丁"——试图通过编译手段来弥补框架运行时模型的不足。

在 SolidJS 中，你只需要理解一个核心概念：**Signal 的读取（调用 getter 函数）会建立依赖，Signal 的写入（调用 setter 函数）会触发更新。** 不需要关心组件重渲染，不需要手动管理依赖数组，不需要 memo 和 useCallback。代码的性能特征更加可预测——如果你发现某个 DOM 更新被触发了，一定是某个 Signal 的值发生了变化，沿着依赖链追踪即可定位问题。

这种心智模型的简化带来的另一个重要好处是：代码审查变得更加高效。在 React 代码审查中，审查者需要检查每个 `useEffect` 的依赖数组是否完整、每个 `useCallback` 的依赖是否正确、是否有不必要的重渲染等。而在 SolidJS 代码审查中，这些问题都不存在——依赖关系由运行时自动建立，不会遗漏也不会多余。审查者可以将注意力集中在业务逻辑本身，而非框架层面的性能优化技巧。

```tsx
// React 版本：需要大量手动优化
function TodoApp() {
  const [todos, setTodos] = useState([]);
  const [filter, setFilter] = useState('all');
  const filteredTodos = useMemo(() => {
    return todos.filter(t => {
      if (filter === 'active') return !t.completed;
      if (filter === 'completed') return t.completed;
      return true;
    });
  }, [todos, filter]);
  const handleToggle = useCallback((id) => {
    setTodos(prev => prev.map(t =>
      t.id === id ? { ...t, completed: !t.completed } : t
    ));
  }, []);
  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} />
      <TodoList todos={filteredTodos} onToggle={handleToggle} />
    </div>
  );
}

// SolidJS 版本：无需手动优化
const TodoApp: Component = () => {
  const [todos, setTodos] = createSignal<Todo[]>([]);
  const [filter, setFilter] = createSignal('all');
  const filteredTodos = createMemo(() => {
    return todos().filter(t => {
      if (filter() === 'active') return !t.completed;
      if (filter() === 'completed') return t.completed;
      return true;
    });
  });
  const handleToggle = (id: number) => {
    setTodos(prev => prev.map(t =>
      t.id === id ? { ...t, completed: !t.completed } : t
    ));
  };
  return (
    <div>
      <FilterBar filter={filter} setFilter={setFilter} />
      <TodoList todos={filteredTodos} onToggle={handleToggle} />
    </div>
  );
};
```

### 4.3 生态系统与社区成熟度对比

不可否认，React 在生态系统和社区规模上有着巨大的优势。数以万计的第三方库、成熟的组件库、丰富的教程资源和庞大的开发者社区，这些都是 SolidJS 目前无法比拟的。Vue 3 的生态系统同样非常完善，特别是在中文社区中有着广泛的影响力。

SolidJS 的生态系统虽然规模较小，但质量很高。官方提供了 SolidStart（类似 Next.js 的全栈框架）、`@solidjs/router`（路由库）、以及与主流工具链（Vite、TypeScript、Tailwind CSS）的良好集成。在 UI 组件方面，Kobalte 提供了类似 shadcn/ui 风格的无样式组件库。此外，由于 SolidJS 的 JSX 与 React JSX 非常相似，许多 React 的纯逻辑库可以直接在 SolidJS 中使用。

### 4.4 性能基准测试

以下是基于 JS Framework Benchmark 的典型对比结果：

```
操作                         SolidJS    React 18   Vue 3      备注
─────────────────────────────────────────────────────────────────────
创建 1000 行                  1.0x       1.5x       1.3x      基准对比
更新 1000 行（每 10 行）       1.0x       6.2x       2.1x      差异明显
部分更新（选中行高亮）         1.0x       8.5x       3.2x      细粒度优势
交换行                        1.0x       4.1x       1.8x      
选择行                        1.0x       3.5x       1.5x      
删除行                        1.0x       2.8x       1.4x      
启动时间                      1.0x       2.3x       1.8x      包体积影响
内存占用                      1.0x       1.8x       1.4x      无 VDOM 开销
```

SolidJS 在几乎所有操作中都排名前列。在"选中行高亮"这个常见交互中，SolidJS 比 React 快近 9 倍——这正是因为 SolidJS 只更新了被选中行的那一个 DOM 节点，而 React 需要重新渲染整个列表组件并 diff 出差异。在包体积方面，SolidJS 的运行时核心仅约 7KB（gzip 后），而 React 18 约为 42KB，Vue 3 约为 33KB，这意味着 SolidJS 应用的首屏加载时间通常更短。

需要强调的是，基准测试虽然能够提供量化的性能参考，但在实际项目中的性能表现还受到很多其他因素的影响，包括网络请求的优化、图片和资源的加载策略、CSS 的复杂度、以及浏览器的渲染管道等。SolidJS 的优势主要体现在"CPU 密集型"的 DOM 更新场景中——当一个页面包含大量需要频繁更新的元素时，SolidJS 的细粒度更新策略能够避免大量不必要的计算，从而带来显著的性能提升。而对于"IO 密集型"的场景（如大量图片加载），框架本身的性能差异可能不会那么明显。

此外，基准测试中还有一个经常被忽略的指标——内存占用。由于 SolidJS 不需要维护 Virtual DOM 树，也不需要在每次更新时创建新的 Fiber 节点，其内存占用通常低于 React。在需要长时间运行的单页应用中，较低的内存占用意味着更少的垃圾回收暂停，从而带来更加流畅的用户体验。这对于实时协作工具、在线游戏、数据可视化等对流畅度要求极高的场景尤为重要。

---

## 五、从 React 迁移到 SolidJS 的完整路径

### 5.1 心态转换：从"重渲染思维"到"订阅思维"

迁移的第一步不是学习新的 API，而是转变思维方式。React 中的状态更新链路是：`状态变化 → 组件重渲染 → Virtual DOM diff → DOM 更新`。SolidJS 的链路更短更直接：`Signal 更新 → 订阅该 Signal 的 DOM 操作直接执行`。

在 SolidJS 中，你不再需要担心"不必要的重渲染"这个概念——因为它根本不存在。你写的每个组件函数只会执行一次，之后所有的更新都通过响应式系统精确地路由到需要更新的 DOM 节点。

### 5.2 React Hooks 到 SolidJS Primitives 对照表

| React Hook | SolidJS 等价物 | 关键差异 |
|------------|---------------|----------|
| `useState` | `createSignal` | 返回 getter 函数而非值 |
| `useEffect` | `createEffect` | 自动追踪依赖，无需依赖数组 |
| `useMemo` | `createMemo` | 自动追踪依赖，更可靠的缓存 |
| `useCallback` | 不需要 | 组件不重渲染，无需记忆化回调 |
| `useRef` | 普通变量 `let` | 在 SolidJS 中直接声明变量即可 |
| `useContext` | `useContext` | 基本相同 |
| `useReducer` | `createSignal` + `produce` | 或使用 createStore |
| `useId` | `createUniqueId` | 基本相同 |
| `useDeferredValue` | 不需要 | 细粒度更新天然避免性能瓶颈 |
| `useTransition` | 不需要 | 同上 |

### 5.3 常见迁移陷阱与解决方案

**陷阱一：解构 Props 导致响应式丢失。** 这是 React 开发者最常犯的错误。解决方案是始终通过 `props.name` 方式访问，或使用 `splitProps` 工具函数。

**陷阱二：条件表达式不使用 Show 组件。** React 中常见的 `{show && <Component />}` 在 SolidJS 中会导致编译器无法优化，且可能在条件从真变为假时不会正确卸载子组件。应使用 `<Show when={show}>` 替代。

**陷阱三：传递 Signal 的值而非 getter 函数。** 在 React 中习惯传递 `count` 的当前值给子组件，在 SolidJS 中应传递 `count`（getter 函数）本身，让子组件在需要时调用 `count()`。如果你传递的是值而非 getter，子组件将无法感知后续的更新。

**陷阱四：在非响应式上下文中读取 Signal。** SolidJS 的依赖追踪发生在 `createEffect`、`createMemo` 和模板绑定中。如果你在普通的函数中读取 Signal 的值，它只是一个普通的函数调用，不会建立依赖关系。确保 Signal 的读取发生在正确的响应式上下文中。

### 5.4 逐步迁移策略与状态管理迁移

```tsx
// 迁移前：React + React Query
import { useQuery } from '@tanstack/react-query';
const UserProfile: React.FC<{ userId: number }> = ({ userId }) => {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetch(`/api/users/${userId}`).then(r => r.json()),
  });
  if (isLoading) return <div>加载中...</div>;
  if (error) return <div>错误: {(error as Error).message}</div>;
  if (!user) return null;
  return (
    <div className="profile">
      <h2>{`${user.firstName} ${user.lastName}`}</h2>
      <p>{user.bio}</p>
    </div>
  );
};

// 迁移后：SolidJS + createResource
const fetchUser = async (id: number): Promise<User> => {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) throw new Error('获取用户信息失败');
  return res.json();
};

const UserProfile: Component<{ userId: number }> = (props) => {
  const [user] = createResource(() => props.userId, fetchUser);
  const displayName = createMemo(() => {
    const u = user();
    return u ? `${u.firstName} ${u.lastName}` : '';
  });
  return (
    <Show when={!user.loading} fallback={<div>加载中...</div>}>
      <Show when={user()} fallback={<div>错误: {user.error?.message}</div>}>
        {(u) => (
          <div class="profile">
            <h2>{displayName()}</h2>
            <p>{u().bio}</p>
          </div>
        )}
      </Show>
    </Show>
  );
};
```

对于使用 Zustand 等状态管理库的项目，迁移到 SolidJS 时可以使用 `createStore` 来替代。`createStore` 的路径化更新和 `produce` 支持使其在功能上可以覆盖 Redux/Zustand 的大部分场景，且与 SolidJS 的响应式系统深度集成，无需引入额外的第三方库。

---

## 六、SolidJS 生态系统与项目架构

### 6.1 SolidStart 全栈框架与路由

SolidStart 是 SolidJS 的官方全栈元框架，类似 Next.js 之于 React。它提供文件系统路由、服务端渲染、静态站点生成、API 路由等功能。在路由方面，SolidStart 基于 `@solidjs/router` 构建，支持嵌套路由、动态参数、通配符路由等。路由组件是懒加载的，配合 `Suspense` 可以实现优雅的加载体验。

```tsx
import { Router, Route, Routes, A, useNavigate, useParams } from '@solidjs/router';

const App: Component = () => (
  <Router>
    <nav>
      <A href="/" activeClass="active" end>首页</A>
      <A href="/blog" activeClass="active">博客</A>
    </nav>
    <Routes>
      <Route path="/" component={Home} />
      <Route path="/blog" component={BlogLayout}>
        <Route path="/" component={BlogList} />
        <Route path="/:slug" component={BlogPost} />
      </Route>
      <Route path="*404" component={NotFound} />
    </Routes>
  </Router>
);
```

### 6.2 项目初始化与构建配置

```bash
# 创建项目
npx degit solidjs/templates/ts solid-app
cd solid-app && npm install && npm run dev
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: { port: 3000 },
  build: { target: 'esnext', minify: 'terser' },
});
```

### 6.3 工具链集成

SolidJS 与现代前端工具链的集成非常完善。构建工具推荐使用 Vite，配合 `vite-plugin-solid` 插件即可实现开箱即用的开发体验。样式方案支持 CSS Modules、Tailwind CSS、Styled Components 等主流方案。测试方面提供 `solid-testing-library`，API 与 React Testing Library 相似。TypeScript 支持从一开始就以 TypeScript 编写，提供完整的类型定义和精确的泛型推断。

---

## 七、高级模式与性能最佳实践

### 7.1 细粒度代码分割

```tsx
import { lazy, Suspense } from 'solid-js';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));

const App: Component = () => (
  <Suspense fallback={<LoadingSpinner />}>
    <Routes>
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/settings" component={Settings} />
    </Routes>
  </Suspense>
);
```

### 7.2 虚拟滚动优化大规模列表

对于包含数千甚至数万条数据的列表，即使 SolidJS 的高效更新，全量渲染仍会带来性能问题。虚拟滚动（Virtual Scrolling）技术通过只渲染可视区域内的列表项来解决这个问题。`@tanstack/solid-virtual` 是社区中最成熟的虚拟滚动库，它支持固定高度和动态高度两种模式，能够智能地计算滚动容器的总高度和每个列表项的位置。

在 SolidJS 中使用虚拟滚动的优势在于两个层面：首先，初始渲染时只会创建可视区域内的 DOM 节点，大幅减少了首次渲染的 DOM 操作数量；其次，当用户滚动或列表项内容发生变化时，由于 SolidJS 的细粒度响应式更新，只有实际变化的 DOM 部分会被更新——比如某个列表项的选中状态改变了，只有那一个复选框会被更新，而不是重新渲染整个虚拟列表。这种"双重优化"使得 SolidJS 的虚拟列表在处理大规模数据时表现尤为出色。

### 7.3 常见性能陷阱及规避

```tsx
// ❌ 陷阱一：在 createEffect 中创建新 Signal
createEffect(() => {
  const derived = createSignal(data().map(x => x * 2)); // 每次都会创建
});
// ✅ 正确：使用 createMemo
const derived = createMemo(() => data().map(x => x * 2));

// ❌ 陷阱二：在 effect 中执行只需一次的初始化
createEffect(() => {
  const ctx = document.getElementById('canvas')!.getContext('2d')!;
});
// ✅ 正确：使用 onMount
onMount(() => {
  const ctx = document.getElementById('canvas')!.getContext('2d')!;
});

// ❌ 陷阱三：简单数据使用 Store（过度设计）
const [count, setCount] = createStore({ value: 0 });
// ✅ 正确：简单数据用 Signal
const [count, setCount] = createSignal(0);

// ❌ 陷阱四：在 effect 中读取 Signal 但不希望追踪
createEffect(() => {
  const name = userName(); // 被自动追踪
  document.title = `欢迎, ${name}`;
});
// ✅ 正确：使用 untrack
createEffect(() => {
  const name = untrack(userName); // 读取但不建立依赖
  document.title = `欢迎, ${name}`;
});
```

---

## 八、实战案例：构建一个完整的任务管理应用

为了将前面讲解的所有概念串联起来，下面通过一个综合性的实战案例来展示 SolidJS 的开发模式。这个任务管理应用涵盖了状态管理、列表渲染、表单处理、过滤排序、统计计算等常见需求，可以作为 SolidJS 项目的参考模板。在状态管理层面，我们使用 `createStore` 来管理任务列表，使用 `createSignal` 来管理过滤条件和排序方式等 UI 状态。这种选择体现了 SolidJS 的最佳实践：用 Store 管理结构化的集合数据，用 Signal 管理原子化的独立状态。在业务逻辑层面，我们使用 `createMemo` 来实现过滤和排序的派生计算，它自动依赖了任务列表、过滤条件和排序方式三个数据源，当任何一个发生变化时都会自动重新计算。在组件设计层面，我们将应用拆分为添加任务表单组件、单个任务项组件、过滤和搜索栏组件、统计面板组件，每个组件只关注自己的职责，通过 Context 共享状态管理逻辑。

```tsx
import { Component, createSignal, createMemo, Show, For, useContext, createContext, ParentComponent } from 'solid-js';
import { createStore } from 'solid-js/store';

interface Todo {
  id: number; text: string; completed: boolean;
  priority: 'low' | 'medium' | 'high'; createdAt: Date; tags: string[];
}
type FilterType = 'all' | 'active' | 'completed';
type SortType = 'date' | 'priority' | 'name';

function createTodoStore() {
  const [todos, setTodos] = createStore<Todo[]>([]);
  const [filter, setFilter] = createSignal<FilterType>('all');
  const [sort, setSort] = createSignal<SortType>('date');
  const [search, setSearch] = createSignal('');
  const [nextId, setNextId] = createSignal(1);

  const addTodo = (text: string, priority: Todo['priority'] = 'medium', tags: string[] = []) => {
    setTodos(todos.length, { id: nextId(), text, completed: false, priority, createdAt: new Date(), tags });
    setNextId(n => n + 1);
  };
  const toggleTodo = (id: number) => setTodos(t => t.id === id, 'completed', c => !c);
  const removeTodo = (id: number) => setTodos(todos.filter(t => t.id !== id));
  const updateTodo = (id: number, updates: Partial<Omit<Todo, 'id'>>) => {
    const idx = todos.findIndex(t => t.id === id);
    if (idx >= 0) setTodos(idx, prev => ({ ...prev, ...updates }));
  };

  const processedTodos = createMemo(() => {
    let result = [...todos];
    const q = search().toLowerCase();
    if (q) result = result.filter(t => t.text.toLowerCase().includes(q) || t.tags.some(tag => tag.toLowerCase().includes(q)));
    switch (filter()) {
      case 'active': result = result.filter(t => !t.completed); break;
      case 'completed': result = result.filter(t => t.completed); break;
    }
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    switch (sort()) {
      case 'priority': result.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]); break;
      case 'name': result.sort((a, b) => a.text.localeCompare(b.text)); break;
      default: result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return result;
  });

  const stats = createMemo(() => ({
    total: todos.length,
    completed: todos.filter(t => t.completed).length,
    active: todos.filter(t => !t.completed).length,
    rate: todos.length > 0 ? Math.round(todos.filter(t => t.completed).length / todos.length * 100) : 0,
  }));

  return { todos: processedTodos, filter, setFilter, sort, setSort, search, setSearch, stats, addTodo, toggleTodo, removeTodo, updateTodo };
}

const TodoContext = createContext<ReturnType<typeof createTodoStore>>();
const TodoProvider: ParentComponent = (props) => {
  const store = createTodoStore();
  return <TodoContext.Provider value={store}>{props.children}</TodoContext.Provider>;
};
const useTodoStore = () => useContext(TodoContext)!;

const AddTodoForm: Component = () => {
  const store = useTodoStore();
  const [text, setText] = createSignal('');
  const [priority, setPriority] = createSignal<Todo['priority']>('medium');
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const trimmed = text().trim();
    if (!trimmed) return;
    store.addTodo(trimmed, priority());
    setText('');
  };
  return (
    <form onSubmit={handleSubmit} class="add-todo-form">
      <input type="text" value={text()} onInput={e => setText(e.currentTarget.value)} placeholder="添加新任务..." />
      <select value={priority()} onChange={e => setPriority(e.currentTarget.value as Todo['priority'])}>
        <option value="low">低优先级</option><option value="medium">中优先级</option><option value="high">高优先级</option>
      </select>
      <button type="submit" disabled={!text().trim()}>添加</button>
    </form>
  );
};

const TodoItem: Component<{ todo: Todo }> = (props) => {
  const store = useTodoStore();
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal('');
  const startEdit = () => { setEditText(props.todo.text); setEditing(true); };
  const saveEdit = () => {
    const trimmed = editText().trim();
    if (trimmed) store.updateTodo(props.todo.id, { text: trimmed });
    setEditing(false);
  };
  return (
    <div class={`todo-item priority-${props.todo.priority} ${props.todo.completed ? 'completed' : ''}`}>
      <input type="checkbox" checked={props.todo.completed} onChange={() => store.toggleTodo(props.todo.id)} />
      <Show when={!editing()} fallback={
        <input type="text" value={editText()} onInput={e => setEditText(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
          onBlur={saveEdit} autofocus />
      }>
        <span class="todo-text" onDblClick={startEdit}>{props.todo.text}</span>
      </Show>
      <span class="priority-badge">{props.todo.priority === 'high' ? '🔴' : props.todo.priority === 'medium' ? '🟡' : '🟢'}</span>
      <div class="todo-actions">
        <button onClick={startEdit}>✏️</button>
        <button onClick={() => store.removeTodo(props.todo.id)}>🗑️</button>
      </div>
    </div>
  );
};

const StatsPanel: Component = () => {
  const store = useTodoStore();
  return (
    <div class="stats-panel">
      <div class="stat"><span class="stat-value">{store.stats().total}</span><span>总计</span></div>
      <div class="stat"><span class="stat-value">{store.stats().active}</span><span>进行中</span></div>
      <div class="stat"><span class="stat-value">{store.stats().completed}</span><span>已完成</span></div>
      <div class="stat"><span class="stat-value">{store.stats().rate}%</span><span>完成率</span>
        <div class="progress-bar"><div class="progress-fill" style={{ width: `${store.stats().rate}%` }} /></div>
      </div>
    </div>
  );
};

const FilterBar: Component = () => {
  const store = useTodoStore();
  return (
    <div class="filter-bar">
      <input type="text" placeholder="搜索任务..." value={store.search()} onInput={e => store.setSearch(e.currentTarget.value)} />
      <div class="filter-buttons">
        <For each={[['all', '全部'], ['active', '进行中'], ['completed', '已完成']] as const}>
          {([val, label]) => (<button classList={{ active: store.filter() === val }} onClick={() => store.setFilter(val)}>{label}</button>)}
        </For>
      </div>
      <select value={store.sort()} onChange={e => store.setSort(e.currentTarget.value as SortType)}>
        <option value="date">按日期</option><option value="priority">按优先级</option><option value="name">按名称</option>
      </select>
    </div>
  );
};

const App: Component = () => (
  <TodoProvider>
    <div class="todo-app">
      <h1>📋 任务管理</h1>
      <StatsPanel />
      <AddTodoForm />
      <FilterBar />
      <Show when={useContext(TodoContext)!.todos().length > 0} fallback={<p>暂无任务</p>}>
        <For each={useContext(TodoContext)!.todos()}>{(todo) => <TodoItem todo={todo} />}</For>
      </Show>
    </div>
  </TodoProvider>
);

export default App;
```

这个实战案例涵盖了 SolidJS 开发中的核心模式：Store 管理结构化数据、Signal 管理 UI 状态、Memo 派生计算、Show/For 控制流、Context 跨组件共享状态。整个应用无需任何手动性能优化，SolidJS 的细粒度响应式系统天然保证了最优的更新效率。

这个案例的一个关键教学点是：在 SolidJS 中，你不需要任何性能优化的"黑魔法"。不需要 `React.memo` 包裹子组件、不需要 `useCallback` 记忆化事件处理函数、不需要 `useMemo` 的依赖数组。组件的性能表现天然就是最优的，因为 SolidJS 的响应式系统已经自动帮你处理了所有的更新优化。如果你正在维护一个 React 项目并且频繁地与性能优化搏斗，SolidJS 的开发体验将是一种全新的、令人愉悦的解放。这个案例可以直接作为 SolidJS 项目的参考模板，开发者可以在此基础上进行扩展和定制。

---

## 九、SolidJS 的适用场景与局限性

### 9.1 最佳适用场景

SolidJS 特别适合以下几类项目。**数据密集型交互应用**如实时数据看板、在线表格工具、数据分析平台，SolidJS 的细粒度更新可以避免一个输入框卡顿导致整个页面卡顿的问题。**实时协作类工具**如在线文档编辑器、协同白板、协同编程 IDE，低开销更新机制使协作体验更加流畅。**嵌入式微前端 Widget**，由于运行时体积小且无外部依赖，非常适合构建可嵌入到其他应用中的独立组件。**对首屏性能有严格要求的面向消费者应用**，SolidStart 的 SSR 加上小体积运行时可实现优秀的首次加载性能和可交互时间。

### 9.2 当前的局限与权衡

选择 SolidJS 也需要正视一些客观局限。在**生态系统**方面，第三方库数量与 React 差距较大，部分垂直领域（如复杂图表、富文本编辑器、地图等）可能需要自行封装或寻找替代方案。在**团队建设**方面，SolidJS 开发者社区较小，但有 React 经验的开发者通常一到两周就能上手。在**框架成熟度**方面，SolidStart 仍在快速迭代中，部分 API 可能变化。在**开发习惯**方面，控制流组件（`<Show>`、`<For>` 等）虽是性能优化的关键，但对习惯自由 JSX 表达的开发者来说需要适应期。

---

## 十、踩坑记录：SolidJS 开发中的常见陷阱

### 10.1 响应式丢失类陷阱

```tsx
// ❌ 陷阱：解构 Props 导致响应式丢失（React 开发者最常犯）
const BadComponent = ({ name, count }: Props) => {
  return <div>{name} - {count}</div>;  // name 和 count 被冻结为初始值
};
// ✅ 修复：始终通过 props.xxx 访问
const GoodComponent: Component<Props> = (props) => {
  return <div>{props.name} - {props.count}</div>;
};

// ❌ 陷阱：条件表达式 {show && <Comp />} 不触发正确卸载
{show() && <ExpensiveComponent />}
// ✅ 修复：使用 Show 控制流组件
<Show when={show()}><ExpensiveComponent /></Show>

// ❌ 陷阱：将 Signal 的当前值而非 getter 传递给子组件
<ChildComponent value={count()} />   // 子组件拿到的是数字，无法感知后续变化
// ✅ 修复：传递 getter 函数本身
<ChildComponent value={count} />     // 子组件在渲染时调用 props.value() 感知更新
```

### 10.2 生命周期与执行时机陷阱

```tsx
// ❌ 陷阱：在 createEffect 中做只需一次的 DOM 初始化
createEffect(() => {
  const canvas = document.getElementById('chart')!;  // 每次依赖变化都执行
  initChart(canvas);
});
// ✅ 修复：使用 onMount（只在组件挂载后执行一次）
onMount(() => {
  const canvas = document.getElementById('chart')!;
  initChart(canvas);
});

// ❌ 陷阱：在非响应式上下文中读取 Signal 期望自动追踪
setTimeout(() => {
  console.log(count());  // 不会建立依赖，不会触发任何响应式更新
}, 1000);
// ✅ 修复：确保在响应式上下文中读取
createEffect(() => {
  const c = count();  // 正确建立依赖
  setTimeout(() => console.log(c), 1000);  // 使用捕获的值
});
```

### 10.3 状态设计陷阱

```tsx
// ❌ 陷阱：简单数据滥用 createStore（过度设计）
const [count, setCount] = createStore({ value: 0 });  // 不必要
// ✅ 修复：原子状态用 createSignal
const [count, setCount] = createSignal(0);

// ❌ 陷阱：将整个页面状态塞进一个巨大的 Signal
const [state, setState] = createSignal({ users: [], todos: [], filter: '', sort: 'date', ... });
// ✅ 修复：按更新频率和职责拆分
const [users, setUsers] = createSignal<User[]>([]);
const [filter, setFilter] = createSignal('');
// 或者用 createStore 管理结构化数据
const [state, setState] = createStore({ users: [], todos: [] });
```

### 10.4 与 React 生态库集成陷阱

| 问题 | 现象 | 解决方案 |
|------|------|----------|
| 使用 React 的 `className` | 编译报错或样式不生效 | SolidJS 使用 `class` 属性 |
| 使用 `onClick` 的 React 写法 | 大小写差异可能导致问题 | SolidJS 使用 `onclick` 或 `onClick`（均支持） |
| 试图使用 React Router | 完全不兼容 | 使用 `@solidjs/router` |
| 使用 React 的 `children` 直接访问 | `props.children` 行为不同 | 使用 `children(() => props.children)` 工具函数 |
| 导入 React 组件库 | 无法直接使用 | 寻找 SolidJS 原生替代（如 Kobalte）或封装 |

---

## 十一、总结：前端框架的下一个十年

SolidJS 通过彻底放弃 Virtual DOM，采用编译时优化配合运行时细粒度响应式更新的方案，在前端框架性能领域开辟了一条全新道路。其核心理念——**组件函数只执行一次，状态更新精确到 DOM 节点**——代表了前端框架发展的新方向。

对于 React 开发者而言，迁移到 SolidJS 需要经历思维范式转换，但适应后会发现 SolidJS 的心智模型更加简洁直观：不需要 `useCallback`、不需要 `useMemo` 的依赖数组、不需要 `React.memo`、不需要关注重渲染问题。这种"编译器帮你做正确的事"的体验，与 React Compiler 追求的目标不谋而合，但 SolidJS 从框架设计层面就内建了这一理念。

更重要的是，SolidJS 的理念正在深刻影响整个前端生态系统。Preact 引入了 Signals，Vue 推出了 Vapor Mode 以消除组件重渲染的开销，React Compiler 试图通过编译手段弥补运行时模型的不足。这些发展都在向同一个方向收敛：**更精确的依赖追踪、更小的更新粒度、更少的运行时开销。** SolidJS 在这个方向上走得最远，也因此成为了理解前端框架未来发展趋势的最佳窗口。

建议的实践路径：首先用 SolidJS 构建一个小型个人项目，熟悉其响应式原语和控制流组件；然后选择现有 React 项目中的一个性能瓶颈模块，尝试用 SolidJS 重写；最后对比重写前后的性能数据和代码复杂度，做出适合团队的决策。无论你最终是否选择 SolidJS 作为项目技术栈，深入理解其设计哲学和实现细节，都将帮助你成为更好的前端工程师。因为这不仅仅关乎一个框架的选择，更关乎我们如何思考用户界面与状态管理之间的关系，以及如何在开发效率与运行时性能之间找到最佳的平衡点。

---

*参考资源：*

- [SolidJS 官方文档](https://www.solidjs.com/) — 权威 API 参考和教程
- [SolidStart 文档](https://start.solidjs.com/) — 全栈框架指南
- [JS Framework Benchmark](https://github.com/nicknisi/js-framework-benchmark) — 前端框架性能对比基准
- [Ryan Carniato 的博客](https://dev.to/ryansolid) — SolidJS 作者的技术深度文章
- [SolidJS GitHub 仓库](https://github.com/solidjs/solid) — 源码与社区讨论

## 相关阅读

- [Zustand 实战：轻量级 React 状态管理——对比 Redux/Jotai/Recoil 的工程选型与最佳实践](/前端/Zustand-实战-轻量级React状态管理-对比Redux-Jotai-Recoil的工程选型与最佳实践/)
- [SwiftUI 数据流实战：@State/@Binding/@Observable 与 Combine 响应式编程——前端开发者视角](/前端/SwiftUI-数据流实战-State-Binding-Observable-与-Combine-响应式编程/)
- [Web Components 实战：浏览器原生组件标准——跨框架 UI 组件库设计与 Laravel Blade 集成](/前端/web-components-cross-framework-ui-laravel-blade/)
