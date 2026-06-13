---

title: Signals 范式对比：Angular Signals vs Vue Reactivity vs Solid Reactivity vs Preact
keywords: [Signals, Angular Signals vs Vue Reactivity vs Solid Reactivity vs Preact, 范式对比]
date: 2026-06-05 09:00:00
tags:
- Signals
- Angular
- Vue
- SOLID
- React
- 响应式
- 前端架构
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: 深度对比 Angular Signals、Vue Reactivity、Solid.js、Preact Signals 四大响应式方案的底层原理与 API 设计，涵盖 Push-Pull 混合模型、Proxy 与函数拦截的依赖追踪差异、编译时优化策略、常见踩坑陷阱及选型决策矩阵，帮助前端开发者从原理层面理解 Signals 范式并做出正确的架构选型。
---




# Signals 范式对比：Angular Signals vs Vue Reactivity vs Solid Reactivity vs Preact Signals——响应式底层原理深度剖析

在过去几年的前端技术发展中，"Signals" 已经成为响应式编程领域最炙手可热的概念。从 Solid.js 的率先实践，到 Angular 官方正式引入 Signals API，再到 Preact Signals 将细粒度更新带入类 React 生态，Signals 范式正在重塑我们对状态管理的认知。与此同时，Vue 的响应式系统虽然从未使用 "Signals" 一词，但其 `ref`、`computed`、`watchEffect` 的组合在语义上与 Signals 高度一致。

本文将从底层原理出发，深度剖析 Angular Signals、Vue Reactivity、Solid Reactivity 以及 Preact Signals 这四大响应式方案的实现机制、API 设计哲学和适用场景，帮助开发者做出明智的技术选型。

---

## 一、响应式编程演进：从 Observer Pattern 到 Signals

### 1.1 经典观察者模式

响应式思想的根基可以追溯到设计模式中的**观察者模式（Observer Pattern）**。其核心思想非常直观：当一个对象的状态发生改变时，自动通知所有已注册的订阅者。Java 中的 `Observable` 类、DOM 事件的 `addEventListener` 机制都是这一模式的经典体现。

然而在 UI 编程场景中，手动管理订阅与取消订阅的过程极其繁琐且容易出错，稍有不慎就会引发内存泄漏或者状态不一致的 Bug。开发者不得不在 `componentDidMount` 中订阅、在 `componentWillUnmount` 中取消订阅，代码中充满了生命周期管理的样板代码。

### 1.2 响应式流与 RxJS

RxJS 将观察者模式与迭代器模式相结合，引入了 `Observable`、`Subject`、`BehaviorSubject` 等丰富的概念，用**操作符链**来优雅地处理异步数据流。Angular 在早期版本中深度绑定了 RxJS，组件间通信、HTTP 请求、表单处理几乎都离不开它。

但 RxJS 的问题也很明显：学习曲线极其陡峭。`switchMap`、`mergeMap`、`concatMap`、`exhaustMap`、`debounceTime`、`distinctUntilChanged` 等数十个操作符让初学者望而却步。更重要的是，对于 UI 层面的细粒度状态管理来说，RxJS 过于"重量级"了——你不需要一个完整的数据流处理框架来管理一个计数器的状态。

### 1.3 Signals 的诞生与崛起

2022 年，Solid.js 的作者 Ryan Carniato 从 Knockout.js 的可观察对象中提炼出了更现代的 Signals 概念。Knockout.js 在 2010 年就引入了 `ko.observable()` 和 `ko.computed()`，其核心思想——声明式定义依赖关系、自动追踪变化、精准更新——与今天的 Signals 如出一辙。Ryan Carniato 在此基础上，结合编译时优化的理念，打造了 Solid.js 的响应式系统。

随后，Preact 的作者 Jason Miller 与 Ryan Carniato 合作，将 Signals 的理念带入了 Preact 生态，推出了 `@preact/signals` 库。2023 年，Angular 团队在 Angular 16 中正式引入了 Signals API，作为未来实现"无 Zone.js 变更检测"的基础设施。而 Vue 3 从 2020 年发布起就采用了基于 Proxy 的响应式系统，虽然 API 命名不同，但在设计理念上与 Signals 范式高度吻合。

**Signals 范式的核心承诺可以概括为一句话**：以极低的心智模型实现细粒度的响应式更新——开发者声明式地描述数据依赖关系，框架自动追踪依赖变化并精准更新 UI 中需要变化的部分，无需 Virtual DOM 的全量 diff，也无需手动调用 `setState` 或 `forceUpdate`。

---

## 二、Signals 核心概念

纵观所有 Signals 实现，无论是 Angular、Solid、Preact 还是 Vue 的响应式系统，都围绕三个核心原语构建：

**Signal（信号）**：最基础的响应式原语，代表一个可变的状态容器。它类似于一个"智能变量"——你不仅可以读取和写入它的值，框架还会自动记录谁在读取它。Signal 是整个依赖图的叶子节点，是所有响应式数据流的源头。

**Computed（计算属性）**：派生的只读值，由其他 Signal 或 Computed 计算得出。Computed 具有惰性求值和缓存的特性——只有当它的依赖发生变化时，下次读取才会重新计算；如果依赖没有变化，直接返回缓存值。Computed 是依赖图中的中间节点。

**Effect（副作用）**：副作用执行器，当其依赖的 Signal 或 Computed 发生变化时自动重新执行。典型的副作用包括 DOM 操作、日志输出、API 调用等。Effect 是依赖图中的终端消费者。

这三者共同构成一个**有向无环依赖图（DAG）**。当某个 Signal 的值发生变化时，变化信号沿着依赖图传播，标记受影响的 Computed 为"脏"，并调度 Effect 的重新执行。这种基于依赖图的传播机制，使得系统能够精确知道哪些节点需要更新，从而避免了不必要的计算和渲染。

---

## 三、Angular Signals 深度剖析

Angular 16（2023 年 5 月发布）引入了 Signals 作为 Angular 响应式模型演进的基石。到了 Angular 17、18、19，Signals 的功能不断完善，已经从实验性 API 成长为 Angular 的核心特性之一。

### 3.1 核心 API 概览

Angular Signals 的核心 API 非常精简，主要包括三个函数和一个写入接口：

```typescript
import { signal, computed, effect } from '@angular/core';

// 创建可写信号
const count = signal(0);

// 创建计算属性——惰性求值，依赖自动追踪
const doubleCount = computed(() => count() * 2);

// 创建副作用——当依赖变化时自动重新执行
effect(() => {
  console.log(`当前计数：${count()}`);
});

// 更新信号值的三种方式
count.set(5);                // 直接设置新值
count.update(n => n + 1);   // 基于旧值计算新值
count.mutate(arr => arr.push(item)); // 就地修改（适用于对象/数组）
```

注意 Angular Signals 使用**函数调用**的方式来读取值：`count()` 而不是 `count.value`。这是一个有意为之的设计选择——函数调用语法让开发者明确意识到这里存在一个"读取"操作，框架会在运行时拦截这个读取并建立依赖关系。

### 3.2 Zone-less 变更检测

Angular 传统的变更检测机制依赖 Zone.js。Zone.js 通过猴子补丁（monkey-patching）拦截浏览器中所有的异步操作——`setTimeout`、`Promise.then`、DOM 事件监听器、XHR 请求等。每当任何一个异步操作完成，Zone.js 都会通知 Angular 执行全局的脏检查，从根组件开始遍历整棵组件树，检查是否有数据发生了变化。

这种方式的问题是显而易见的：即使只有一个小小的计数器发生了变化，Angular 也可能需要检查整个组件树。在大型应用中，这种全量检查的性能开销不可忽视。

Signals 的引入让 Angular 可以实现**逐组件级别**的精确变更通知。当一个 Signal 变化时，只有真正依赖这个 Signal 的组件才会收到通知并重新渲染。Angular 18 已经提供了 `provideExperimentalZonelessChangeDetection()` 配置项，允许应用完全在没有 Zone.js 的情况下运行。在 Angular 19 中，这一特性更加成熟稳定。

### 3.3 Angular Signals 的独特设计

Angular Signals 在设计上有几个值得关注的独特之处：

**WritableSignal 与 Signal 的分离**：`signal()` 函数返回 `WritableSignal<T>` 类型，既可读又可写。而 `computed()` 返回的是只读的 `Signal<T>` 类型。你可以通过 `asReadonly()` 方法将一个 `WritableSignal` 转换为只读视图，这在组件封装时非常有用——组件可以将内部的可写信号以只读方式暴露给外部消费者。

**`linkedSignal()`**（Angular 19 引入）：这是一个特殊的信号类型，它的值可以基于其他信号的值来自动重置。例如，当用户切换选中的项目 ID 时，选中项目的详细信息应该自动重新加载，而不是保留旧的数据。`linkedSignal` 完美解决了这类"派生状态重置"的场景。

**`resource()`**（Angular 19 引入）：异步数据加载的原语，将 HTTP 请求等异步操作与 Signals 系统深度集成。`resource()` 返回的对象包含一个 Signal 类型的 `value` 属性，可以无缝地与其他 Signals 组合使用。

**模板中的无缝集成**：Angular 的模板引擎原生支持 Signals，在模板中直接调用 `{{ count() }}` 即可读取信号值，编译器会自动追踪这些依赖关系。

### 3.4 底层推送-拉取混合机制

Angular Signals 采用了 **Push-Pull 混合模型**。当一个 Signal 被 `set()` 更新时，它会立即向所有订阅者**推送**一个"脏"标记通知（push phase）。但实际的值计算并不会立即发生，而是延迟到某个消费者尝试**读取**这个值时才执行（pull phase）。

这种混合策略的优势在于：如果有多个 Signal 在同一个事件处理函数中被连续更新，中间状态的 Computed 不会被重复计算，只有最终状态才会在被读取时触发计算。这既避免了"推模型"中可能出现的冗余计算，又避免了"拉模型"中可能的过度延迟。

Angular 内部使用**版本号**机制来判断一个 Computed 是否需要重新计算。每次 Signal 更新时递增版本号，Computed 在被读取时比较自己缓存的版本号与依赖的版本号，如果发现依赖的版本号更大，说明依赖已经变化，需要重新计算。

---

## 四、Vue Reactivity 深度剖析

Vue 的响应式系统是前端框架中最成熟、最经过实战检验的响应式实现之一。从 Vue 2 基于 `Object.defineProperty` 的实现，到 Vue 3 基于 ES6 `Proxy` 的全面重写，Vue 的响应式能力在灵活性和功能上都有了质的飞跃。

### 4.1 核心 API 全景

Vue 3 的 Composition API 提供了一整套响应式工具：

```typescript
import { ref, reactive, computed, watchEffect, watch, toRef, toRefs } from 'vue';

// ref：基本类型和对象的响应式包装
const count = ref(0);
console.log(count.value); // 读取需要 .value
count.value++;            // 写入也需要 .value

// reactive：对象的深度响应式代理
const state = reactive({
  user: { name: '张三', age: 25 },
  items: ['a', 'b', 'c']
});
// 直接访问，无需 .value
state.user.name = '李四'; // 自动追踪并触发更新

// computed：派生计算值
const doubleCount = computed(() => count.value * 2);

// watchEffect：自动追踪依赖的副作用
watchEffect(() => {
  console.log(`计数变为：${count.value}，双倍为：${doubleCount.value}`);
});

// watch：精确控制的侦听器，可获取新旧值
watch(count, (newVal, oldVal) => {
  console.log(`计数从 ${oldVal} 变为 ${newVal}`);
}, { flush: 'post' });
```

Vue 的 API 设计有一个显著特点：`ref` 和 `reactive` 的使用场景不同。`ref` 适合包装基本类型值（也可以包装对象），访问时需要 `.value`；`reactive` 适合包装复杂对象，属性可以直接访问，无需 `.value`。在模板中，`ref` 会自动解包，不需要写 `.value`。

### 4.2 基于 Proxy 的深度响应式

Vue 3 使用 ES6 `Proxy` 来拦截对象的读写操作，这比 Vue 2 的 `Object.defineProperty` 有了根本性的改进：

```typescript
// Vue 3 reactive 的核心实现原理（简化版）
function reactive(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      track(target, key);       // 依赖收集：记录当前正在执行的 effect
      const result = Reflect.get(target, key, receiver);
      // 深度代理：如果属性值是对象，递归包装为 reactive
      if (typeof result === 'object' && result !== null) {
        return reactive(result);
      }
      return result;
    },
    set(target, key, value, receiver) {
      const oldValue = target[key];
      const result = Reflect.set(target, key, value, receiver);
      if (hasChanged(value, oldValue)) {
        trigger(target, key);   // 触发更新：通知所有依赖此属性的 effect
      }
      return result;
    },
    deleteProperty(target, key) {
      const result = Reflect.deleteProperty(target, key);
      trigger(target, key);     // 删除属性也能触发更新
      return result;
    }
  });
}
```

Proxy 的优势是全方位的：它可以拦截属性的读取、设置、删除，以及 `in` 操作符和 `for...in` 遍历，这是 `Object.defineProperty` 无法做到的。Vue 2 中无法检测到属性的添加和删除（需要 `Vue.set` 和 `Vue.delete`），也无法直接追踪数组索引赋值，这些问题在 Vue 3 中都得到了彻底解决。

### 4.3 依赖追踪的三级数据结构

Vue 的依赖追踪使用了一套精心设计的三级数据结构：

```
WeakMap<target, Map<key, Set<ReactiveEffect>>>
```

最外层是一个 `WeakMap`，以响应式对象（target）作为键。每个 target 对应一个 `Map`，其中键是属性名（key），值是一个 `Set`，存储了所有依赖这个属性的 `ReactiveEffect` 实例。

当 `track()` 被调用时（即在 effect 执行过程中读取了某个响应式属性），Vue 会将当前正在执行的 `ReactiveEffect` 注册到对应 `target -> key` 的依赖集合中。当 `trigger()` 被调用时（即某个响应式属性被修改），Vue 会遍历该 `key` 对应的所有 `ReactiveEffect` 并调度它们的重新执行。

使用 `WeakMap` 而非普通 `Map` 的好处是：当一个响应式对象不再被引用时，它可以被垃圾回收，对应的依赖记录也会自动清理，不会造成内存泄漏。

### 4.4 调度器与异步批量更新

Vue 的 effect 系统有一个精巧的**调度器（scheduler）**机制。当依赖变化触发 effect 重新执行时，并不会立即同步执行，而是根据 `flush` 选项（`'pre'`、`'post'`、`'sync'`）将执行推入对应的调度队列。

默认情况下，组件的重新渲染被推入微任务队列（通过 `Promise.then`）。这意味着如果在同一个同步执行上下文中连续修改了多个 ref，这些修改会被**批量合并**，组件只会在当前微任务结束时更新一次。这是 Vue 性能表现优秀的关键因素之一。

### 4.5 watch 与 watchEffect 的区别

Vue 提供了两种响应式副作用的创建方式：

`watchEffect` 会立即执行回调函数，并自动追踪执行过程中读取的所有响应式依赖。当任何一个依赖变化时，回调会重新执行。它适合"依赖自动收集"的场景。

`watch` 则需要显式指定侦听源，提供了更精确的控制。它可以获取变化前后的值、支持深度侦听（`deep: true`）、可以通过 `flush` 选项控制回调的执行时机（DOM 更新前、更新后、同步执行）。`watch` 适合需要对比新旧值或精确控制执行时机的场景。

---

## 五、Solid Reactivity 深度剖析

Solid.js 是 Signals 范式中最具代表性、最"纯粹"的实现。其作者 Ryan Carniato 设计的响应式系统被广泛认为是目前最优雅、性能最优的 Signals 实现。

### 5.1 核心 API

Solid 的 API 设计极度精简，几乎没有学习成本：

```typescript
import { createSignal, createMemo, createEffect, createRoot, onCleanup, For } from 'solid-js';

// 创建信号——返回一个读取函数和一个设置函数
const [count, setCount] = createSignal(0);
console.log(count()); // 读取
setCount(5);          // 直接设置
setCount(prev => prev + 1); // 基于旧值更新

// 创建计算属性
const doubleCount = createMemo(() => count() * 2);

// 创建副作用
createEffect(() => {
  console.log(`计数：${count()}，双倍：${doubleCount()}`);
});

// 清理副作用
createEffect(() => {
  const timer = setInterval(() => console.log('tick'), 1000);
  onCleanup(() => clearInterval(timer));
});
```

Solid 的 API 采用了数组解构风格（`[getter, setter]`），这与 React 的 `useState` 类似，对于 React 开发者来说非常熟悉。值得注意的是，Solid 的 `createSignal` 返回的第一个元素是一个**函数**而非值本身——你必须调用 `count()` 才能读取当前值。这种设计确保了每次读取都能被框架拦截并记录依赖。

### 5.2 彻底告别 Virtual DOM

Solid 最显著的特点是**完全没有 Virtual DOM**。这一点与 React、Vue、Preact 都截然不同。

在 React 中，组件函数在每次状态变化时都会重新执行，生成新的 Virtual DOM 树，然后通过 diff 算法找出变化的部分并更新真实 DOM。Solid 则完全不同：**组件函数只在初始化时执行一次**。后续的所有更新都由 Signals 系统直接驱动，精确定位到需要更新的 DOM 节点。

Solid 的编译器在构建时将 JSX 模板转换为真实的 DOM 创建代码。它会分析模板中每一个动态表达式的位置，为每个动态部分创建一个独立的 Effect：

```tsx
// 你编写的代码
function Counter() {
  const [count, setCount] = createSignal(0);
  return (
    <div>
      <h1>计数器</h1>
      <p>当前值：{count()}</p>
      <button onClick={() => setCount(c => c + 1)}>加一</button>
    </div>
  );
}

// 编译器生成的代码（简化示意）
function Counter() {
  const [count, setCount] = createSignal(0);
  const _div = document.createElement('div');
  const _h1 = document.createElement('h1');
  _h1.textContent = '计数器';
  const _p = document.createElement('p');
  const _text = document.createTextNode('');
  _p.append('当前值：', _text);
  const _button = document.createElement('button');
  _button.textContent = '加一';
  _button.onclick = () => setCount(c => c + 1);
  _div.append(_h1, _p, _button);

  // 仅为文本节点创建 effect，精准更新
  createEffect(() => { _text.data = count(); });

  return _div;
}
```

编译器精确识别出 `{count()}` 出现在 `<p>` 标签内的文本节点位置，生成的 Effect 直接操作这个文本节点的 `data` 属性。整个过程没有任何 Virtual DOM 的创建和 diff，性能接近原生 JavaScript 操作 DOM。

### 5.3 所有权模型与生命周期管理

Solid 使用**所有权树（Ownership Tree）**来管理响应式上下文的生命周期。每个 `createEffect`、`createMemo` 等响应式原语都归属于一个"所有者"（通常是组件或另一个 `createRoot`）。

```typescript
// createRoot 创建一个独立的所有权上下文
const dispose = createRoot(dispose => {
  createEffect(() => {
    console.log(`计数：${count()}`);
  });
  return dispose; // 返回清理函数
});

// 调用 dispose 时，该上下文内的所有 effect 和 memo 都会被清理
dispose();
```

`onCleanup` 函数用于注册清理回调，在所属 Effect 重新执行前或整个所有权上下文被销毁时调用。这类似于 React 的 `useEffect` 返回清理函数，但更加通用——它不仅限于 Effect，任何响应式原语都可以使用 `onCleanup`。

### 5.4 `<For>` 组件与列表优化

Solid 提供了专门的 `<For>` 组件来高效渲染列表：

```tsx
<For each={todos()}>
  {(todo, index) => (
    <li>
      <span>{index()}: {todo.text}</span>
      <button onClick={() => removeTodo(todo.id)}>删除</button>
    </li>
  )}
</For>
```

`<For>` 使用**引用相等性**来复用 DOM 元素。当列表数组变化时，它不会销毁重建所有元素，而是通过对比引用找出真正新增、删除或移动的项目，只更新受影响的 DOM 节点。这与 Vue 的 `v-for` + `:key` 或 React 的 `key` prop 解决的是同一个问题，但在 Solid 中它是框架级别的优化，开发者无需手动指定 key。

---

## 六、Preact Signals 深度剖析

Preact Signals 是由 Preact 的作者 Jason Miller 与 Solid.js 的作者 Ryan Carniato 合作开发的库，将 Signals 的细粒度更新能力带入了类 React 生态。

### 6.1 核心 API 设计

Preact Signals 的 API 设计简洁优雅，采用了属性访问方式读写值：

```typescript
import { signal, computed, effect, batch, untracked } from '@preact/signals';

// 创建信号——使用 .value 属性读写
const count = signal(0);
console.log(count.value);  // 读取
count.value++;             // 写入
count.value = 100;         // 也支持直接赋值

// 创建计算属性
const doubleCount = computed(() => count.value * 2);

// 创建副作用
const dispose = effect(() => {
  console.log(`计数：${count.value}`);
});

// 批量更新——多次修改只触发一次 effect
batch(() => {
  count.value++;
  otherSignal.value = 'hello';
  // effect 在 batch 结束后才执行
});

// 非追踪读取——读取信号但不建立依赖
const val = untracked(() => count.value);
```

Preact Signals 使用 `.value` 属性而非函数调用来读写，这让代码更简洁，读起来更像是一个普通的变量。实现上，`signal()` 返回的对象通过 `get value()` 和 `set value()` 存取器来拦截读写操作。

### 6.2 Preact 组件中的无缝集成

在 Preact 组件中，Signal 有一个令人惊叹的特性——它可以**直接作为 JSX 子节点**使用：

```jsx
import { signal } from '@preact/signals';
import { render } from 'preact';

const count = signal(0);

function App() {
  return (
    <div>
      <h1>计数器</h1>
      <p>当前值：{count}</p>
      {/* 注意：这里直接传递了 signal 对象，而不是 count.value */}
      <button onClick={() => count.value++}>加一</button>
    </div>
  );
}
```

Preact 的运行时检测到 JSX 中的 Signal 对象后，会将其包裹为一个特殊的文本节点，并在 Signal 值变化时**直接更新这个文本节点的内容**。这意味着即使 Signal 的值发生了变化，`App` 组件函数也**不会重新执行**——更新绕过了组件渲染管线，直接作用于 DOM。

这种"绕过组件"的更新方式是 Preact Signals 最独特的特性。在传统的 React/Preact 模型中，状态变化必然导致组件函数重新执行，这是 Virtual DOM 范式的基本假设。Preact Signals 打破了这一假设，在保留组件模型的同时实现了细粒度更新。

### 6.3 信号作为 Props 传递

除了直接在 JSX 中使用，Signal 还可以作为 props 传递给子组件：

```jsx
const count = signal(0);

function Display({ value }) {
  return <p>值：{value}</p>;
}

// 当 count 变化时，Display 组件不会重新渲染
// Preact 会直接更新 <p> 中的文本节点
<Display value={count} />
```

这进一步扩展了细粒度更新的范围——不仅父组件的局部状态变化不会触发子组件重渲染，跨组件传递的 Signal 也同样享受细粒度更新的优化。

### 6.4 与 React 的集成限制

`@preact/signals/react` 提供了 React 绑定，但由于 React 的架构限制，集成效果不如在 Preact 中那样完美。React 的渲染模型要求组件函数在每次状态变化时重新执行，这与 Signals "组件只执行一次"的理念存在根本性矛盾。

React 绑定通过 `useSyncExternalStore` 等机制来桥接 Signals 与 React 的渲染模型，虽然能工作但无法实现完全的细粒度更新。React 19 的 Compiler 在一定程度上缓解了性能问题，但本质上 React 的架构设计决定了它无法像 Solid 或 Preact 那样彻底拥抱 Signals 的细粒度模型。

---

## 七、四者横向对比

### 7.1 综合对比表

| 维度 | Angular Signals | Vue Reactivity | Solid.js | Preact Signals |
|------|----------------|----------------|----------|----------------|
| **引入版本** | Angular 16（2023） | Vue 3（2020） | Solid 1.0（2021） | @preact/signals 1.0（2022） |
| **核心 API** | `signal()` `computed()` `effect()` | `ref()` `computed()` `watchEffect()` | `createSignal()` `createMemo()` `createEffect()` | `signal()` `computed()` `effect()` |
| **读取方式** | `count()` 函数调用 | `count.value` 或模板自动解包 | `count()` 函数调用 | `count.value` 属性访问 |
| **写入方式** | `set()` / `update()` / `mutate()` | 直接赋值 `.value =` 或属性修改 | `setCount()` setter 函数 | 直接赋值 `.value =` |
| **对象深度响应式** | 不支持，需手动拆解信号 | `reactive()` 自动深度代理 | 不支持，需解构为多个信号 | 不支持，需手动拆解信号 |
| **Virtual DOM** | 有（Angular 编译器优化） | 有（模板编译优化 + diff） | **无**（编译时直接 DOM 操作） | 有（极轻量 diff） |
| **依赖收集时机** | 模板/effect 执行时自动收集 | effect/computed 执行时通过 Proxy 收集 | Signal 被读取时自动收集 | Signal 被读取时自动收集 |
| **更新调度** | 微任务批量 | 微任务批量（调度器） | 同步传播 + 微任务批量 | 微任务批量 |

### 7.2 性能特征对比

| 指标 | Angular | Vue | Solid | Preact Signals |
|------|---------|-----|-------|----------------|
| **初始渲染** | 中等 | 中等 | 快 | 快 |
| **更新性能** | 良好 | 良好 | **极致** | 优秀 |
| **内存占用** | 中等 | 中等 | 低 | **极低** |
| **JS Framework Benchmark** | 中等 | 中上 | **顶级** | 上 |

Solid 在 JS Framework Benchmark 中长期位居前三，某些测试项目甚至超越原生 JavaScript。这得益于其"无 Virtual DOM + 编译时优化"的架构。Preact Signals 的性能也非常出色，因为 Preact 本身就是一个极轻量的框架。Angular 和 Vue 的性能虽然不及 Solid，但在实际业务场景中已经完全够用，两者的模板编译器都做了大量优化来减少运行时开销。

### 7.3 学习曲线与生态成熟度

| 维度 | Angular | Vue | Solid | Preact Signals |
|------|---------|-----|-------|----------------|
| **学习曲线** | 陡峭（框架整体） | 中等 | 平缓 | 平缓 |
| **官方文档** | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★☆☆ |
| **社区规模** | 大 | **最大** | 中小 | 小 |
| **第三方库生态** | ★★★★★ | ★★★★★ | ★★★☆☆ | ★★☆☆☆ |
| **企业采用率** | 高 | 高 | 低 | 低 |
| **SSR 方案** | Angular Universal | Nuxt 3 | SolidStart | 有限 |
| **Bundle Size** | ~30KB（Angular runtime） | ~33KB（Vue runtime） | ~7KB | ~1KB（纯 signals 库） |

---

## 八、底层原理深度对比

### 8.1 Push 模型 vs Pull 模型

响应式系统的核心架构决策是：**当数据变化时，通知应该如何传播？**

**纯 Push 模型**：数据变化时，立即将新值推送给所有依赖者，触发它们重新计算。这种模型简单直观，但有一个明显的问题：如果一个 Computed 依赖多个 Signal，而这些 Signal 在同一轮事件循环中被连续更新，那么这个 Computed 会被执行多次，只有最后一次是有意义的，前面的都是"白做"。

**纯 Pull 模型**：数据变化时只记录"有变化发生"这个事实，但不立即计算新值。只有当某个消费者主动读取值时，才沿依赖链向上拉取最新值。这种模型避免了冗余计算，但如果依赖链很长，拉取过程可能产生明显的延迟。

**Push-Pull 混合模型**（四种框架的共同选择）：数据变化时推送"脏"标记（push），通知下游节点"你的输入可能变了"。但实际的值计算延迟到被读取时才执行（pull）。这兼顾了实时性和效率。

```
Angular Signals：set() → 向下游广播 dirty 标记 → read() 时 pull 计算
Vue：set() → trigger() 调度 effect → 组件更新时 pull 计算
Solid：set() → 向下游标记 dirty → effect 执行时 pull 重算
Preact Signals：set() → 标记 dirty → read() 时 pull 验证
```

### 8.2 脏标记传播策略

当一个 Signal 的值发生变化时，如何高效地通知依赖它的 Computed 和 Effect？四种框架采用了不同的策略：

**Angular**：采用**版本号递增**策略。每个 Signal 维护一个版本号，每次 `set()` 时递增。Computed 在被读取时检查自己记录的依赖版本号，如果发现版本号变化了，说明需要重新计算。这种策略的优势是判断"是否脏了"的时间复杂度是 O(1)。

**Vue**：采用**触发集合遍历**策略。`trigger()` 被调用时，Vue 遍历该属性对应的所有 `ReactiveEffect`，根据 effect 的调度选项（`pre`、`post`、`sync`）将它们放入对应的执行队列。Vue 还有一些优化机制，比如如果一个 effect 在队列中已经被标记了，就不会重复添加。

**Solid**：采用**自顶向下的脏标记传播**。当 Signal 变化时，它会遍历自己的所有观察者，将它们标记为脏，这些观察者再继续向下游传播。Solid 内部维护了一个全局的更新队列，在当前同步执行栈清空后批量执行所有待处理的 Effect。

**Preact Signals**：策略与 Solid 类似，使用版本号来标记变化，通过双向链表维护 producer-consumer 关系，脏标记沿链表高效传播。

### 8.3 依赖追踪的实现差异

四种框架在"如何知道某个 Effect 依赖了哪些 Signal"这个问题上，都采用了**动态追踪**策略，但实现细节有所不同：

**Vue 的 Proxy 拦截**：Vue 是唯一使用 Proxy 在**对象层面**拦截属性读取的框架。这意味着 Vue 可以自动处理嵌套对象的深层依赖——当你写 `state.user.profile.name` 时，Proxy 会拦截每一层属性访问，建立从 `name` 到当前 Effect 的依赖链。这种"隐式深度追踪"对开发者非常友好，不需要额外的代码就能追踪复杂对象的变化。

**Angular 和 Solid 的函数拦截**：这两个框架通过函数调用来拦截读取。`count()` 这个调用在运行时会触发一个"读取操作"，框架在此刻记录下当前正在执行的 Effect。这种方式不依赖 Proxy，兼容性更好（特别是对老旧浏览器），但只在 Signal 层面建立依赖，嵌套对象需要手动拆解为多个独立的 Signal。

**Preact Signals 的存取器拦截**：Preact Signals 通过 `get value()` 存取器拦截属性读取，本质上与 Angular/Solid 的函数拦截类似，只是语法上更接近属性访问。

### 8.4 编译时优化的角色

编译时优化是区分不同 Signals 实现的关键因素：

**Solid 的编译时优化最为彻底**：编译器将 JSX 转换为原生 DOM 操作代码，在编译时就确定了哪些 DOM 节点需要响应式绑定。运行时几乎没有任何"查找变化部分"的开销，因为编译器已经把答案告诉了运行时。

**Vue 的模板编译器**也做了大量优化：静态节点提升（hoisting）、事件处理器缓存、PatchFlag 标记动态绑定类型等。但 Vue 仍然保留了 Virtual DOM diff 作为兜底机制，用于处理无法在编译时静态分析的动态部分。

**Angular 的编译器**会将模板编译为高效的更新指令，在 Signals 的帮助下可以精确知道哪些组件需要更新。Angular 的 Ivy 渲染引擎本身就是为细粒度更新设计的。

**Preact Signals 没有编译时优化**，完全依赖运行时的信号追踪机制。不过由于 Preact 本身极为轻量，运行时开销也很小。

---

## 九、选型建议

面对这四种优秀的响应式方案，如何根据项目需求做出正确的选择？以下是一些具体的建议。

### 9.1 选择 Angular Signals 的场景

如果你的项目是一个**企业级大型应用**，需要完整的框架解决方案，Angular 是最佳选择。Angular 提供了开箱即用的依赖注入、表单管理、路由、HTTP 客户端、国际化等完整工具链，Signals 只是其中响应式层的升级。Angular 的强约定和严格的代码规范也使其非常适合大团队协作。此外，如果你的项目已经是 Angular 应用，引入 Signals 是渐进式的，无需重写。

### 9.2 选择 Vue Reactivity 的场景

如果你追求**开发效率和丰富的生态**，Vue 是最稳妥的选择。Vue 的社区规模在四个框架中最大，Nuxt、Vuetify、Pinia、VueUse 等周边工具覆盖了几乎所有开发场景。Vue 的模板语法上手门槛低，单文件组件（SFC）的开发体验极佳。此外，如果你的应用涉及大量复杂嵌套的响应式对象，Vue 的 `reactive()` 基于 Proxy 的深度代理是最自然、最省心的方案。

### 9.3 选择 Solid.js 的场景

如果你的项目对**运行时性能有极致要求**——比如实时数据仪表盘、高频更新的协作编辑器、大规模数据表格等场景——Solid 是当之无愧的首选。Solid 的"无 Virtual DOM + 编译时优化"架构使其在性能基准测试中遥遥领先。同时 Solid 的 API 极其简洁，学习曲线平缓，是一个"小而美"的优秀选择。

### 9.4 选择 Preact Signals 的场景

如果你需要在**极小的 bundle size 预算下获得细粒度更新能力**，Preact Signals 是最轻量的选择。Preact + Signals 的总体积不到 5KB gzip，非常适合移动端 H5 页面、嵌入式组件、小程序 webview 等对体积敏感的场景。如果你已有 React 项目想要渐进式地引入 Signals 的能力，也可以通过 `@preact/signals/react` 逐步集成。

### 9.5 决策矩阵

```
追求极致性能      → Solid.js
企业级全栈开发    → Angular
快速开发 + 丰富生态 → Vue
极致轻量          → Preact Signals
已有 React 项目    → @preact/signals/react
已有 Angular 项目  → Angular Signals（渐进迁移）
已有 Vue 项目      → Vue Composition API（已是 Signals 范式）
```

---

## 总结

Signals 范式的崛起标志着前端响应式编程进入了一个新的成熟阶段。从 2010 年 Knockout.js 的可观察对象，到 2015 年 MobX 的透明响应式，再到今天 Signals 与编译时优化的结合，社区在持续探索"声明式描述 + 自动更新"这一理想范式的最优实现。

Angular Signals 为大型企业应用引入了现代响应式原语，Vue Reactivity 以成熟的生态和优秀的开发体验继续领跑社区，Solid.js 以纯粹的理念和极致的性能树立了技术标杆，Preact Signals 则以最小代价证明了 Signals 可以无缝融入现有生态。

作为开发者，理解这些方案背后的底层原理——推送与拉取的平衡、脏标记的传播策略、依赖追踪的实现方式、编译时与运行时优化的分工——远比记住具体的 API 重要得多。当你真正理解了这些机制，无论面对何种新的响应式框架或方案，都能迅速把握其本质，做出正确的技术判断和选型决策。

> **参考资料**：
> - [Angular Signals RFC](https://github.com/angular/angular/discussions/49652)
> - [Vue 3 Reactivity in Depth](https://vuejs.org/guide/extras/reactivity-in-depth.html)
> - [Solid.js Reactivity 文档](https://www.solidjs.com/docs/latest/api)
> - [Preact Signals 官方文档](https://preactjs.com/guide/v10/signals/)
> - [Ryan Carniato - The Evolution of Signals in JavaScript](https://dev.to/this-is-learning/the-evolution-of-signals-in-javascript-15pg)
> - [JS Framework Benchmark](https://krausest.github.io/js-framework-benchmark/current.html)

---

## 相关阅读

- [Vue 3 Composition API 实战：ref/reactive/computed 最佳实践与响应式踩坑记录](/categories/Frontend/vue-3-composition-api-guide-ref-reactive-computed-best-practices/)
- [Jotai 实战：原子化状态管理——对比 Zustand/Redux 的细粒度响应式与 React Suspense 集成](/categories/前端/Jotai-实战-原子化状态管理-对比Zustand-Redux的细粒度响应式与React-Suspense集成/)
- [Zustand 实战：轻量级 React 状态管理——对比 Redux/Jotai/Recoil 的工程选型与最佳实践](/categories/前端/Zustand-实战-轻量级React状态管理-对比Redux-Jotai-Recoil的工程选型与最佳实践/)
