# Signals 响应式范式对比

## 定义

Signals 是一种细粒度响应式编程范式，通过 **Push-Pull 混合模型**实现精确的依赖追踪与最小化 DOM 更新。开发者声明式地描述数据依赖关系，框架自动追踪依赖变化并精准更新 UI 中需要变化的部分，无需 Virtual DOM 的全量 diff，也无需手动调用 `setState`。

四大主流方案各有特色：

| 方案 | 核心特点 |
|------|----------|
| **Angular Signals** | 函数调用读取 `count()`，显式 `set()/update()/mutate()`，Zoneless 变更检测 |
| **Vue Reactivity** | Proxy 深度代理，`ref/reactive/watchEffect`，最成熟的响应式生态 |
| **Solid.js** | 编译时优化 + 无 Virtual DOM，极致性能，组件只执行一次 |
| **Preact Signals** | `.value` 属性访问，绕过组件渲染直接更新 DOM，极致轻量（~1KB） |

---

## 核心原理

### 响应式编程演进

```
Observer Pattern（经典观察者模式）
  → RxJS（可观察流 + 操作符链，重量级）
    → Signals（轻量细粒度响应式，声明式依赖追踪）
```

- **Observer Pattern**：手动管理订阅/取消订阅，容易内存泄漏
- **RxJS**：`switchMap`、`mergeMap` 等操作符丰富但学习曲线陡峭，对 UI 层细粒度状态管理过于重量级
- **Signals**：2022 年由 Solid.js 作者 Ryan Carniato 从 Knockout.js 的 `ko.observable()` 中提炼，结合编译时优化

### 三大核心原语

所有 Signals 实现都围绕三个原语构建一个**有向无环依赖图（DAG）**：

| 原语 | 角色 | 特性 |
|------|------|------|
| **Signal（信号）** | 状态容器，依赖图叶子节点 | 可读可写，读取时自动记录依赖 |
| **Computed（计算属性）** | 派生只读值，依赖图中间节点 | 惰性求值 + 缓存，依赖不变则不重算 |
| **Effect（副作用）** | 副作用执行器，依赖图终端消费者 | 依赖变化时自动重新执行（DOM 操作、日志、API 调用等） |

### Push-Pull 混合模型

四种框架的共同选择：

- **Push 阶段**：Signal 被 `set()` 更新时，立即向下游推送「脏」标记通知
- **Pull 阶段**：实际值计算延迟到被读取时才执行

优势：多个 Signal 在同一事件处理中被连续更新时，中间状态的 Computed 不会重复计算，只有最终状态才会触发。

```
Angular Signals：set() → 向下游广播 dirty 标记 → read() 时 pull 计算（版本号机制）
Vue：set() → trigger() 调度 effect → 组件更新时 pull 计算（调度器 + 微任务批量）
Solid：set() → 向下游标记 dirty → effect 执行时 pull 重算（自顶向下传播）
Preact Signals：set() → 标记 dirty → read() 时 pull 验证（双向链表 + 版本号）
```

### 依赖追踪实现差异

| 方案 | 拦截方式 | 特点 |
|------|----------|------|
| **Vue** | `Proxy` 对象层面拦截 | 自动深度追踪嵌套对象，隐式依赖收集 |
| **Angular** | 函数调用拦截 `count()` | 显式读取操作，兼容性好，嵌套对象需手动拆解 |
| **Solid** | 函数调用拦截 `count()` | 与 Angular 类似，编译时确定绑定位置 |
| **Preact Signals** | `get value()` 存取器拦截 | 语法更接近属性访问，本质同函数拦截 |

### 编译时优化对比

| 方案 | 优化程度 | 说明 |
|------|----------|------|
| **Solid** | 最彻底 | 编译器将 JSX 转为原生 DOM 操作，运行时零查找开销 |
| **Vue** | 深度优化 | 静态节点提升、PatchFlag、事件缓存，保留 VNode diff 兜底 |
| **Angular** | Ivy 引擎优化 | 模板编译为更新指令，配合 Signals 精确组件级更新 |
| **Preact** | 无编译时优化 | 完全依赖运行时信号追踪 |

---

## Angular Signals 特性

### 核心 API

```typescript
import { signal, computed, effect } from '@angular/core';

const count = signal(0);                          // 可写信号
const doubleCount = computed(() => count() * 2);  // 计算属性
effect(() => console.log(count()));               // 副作用

count.set(5);                    // 直接设置
count.update(n => n + 1);       // 基于旧值更新
count.mutate(arr => arr.push(item)); // 就地修改
```

### 独特设计

- **WritableSignal vs Signal**：`signal()` 返回可写类型，`computed()` 返回只读类型，`asReadonly()` 转换
- **`linkedSignal()`**（Angular 19）：基于其他信号自动重置值，解决派生状态重置场景
- **`resource()`**（Angular 19）：异步数据加载原语，与 Signals 系统深度集成
- **Zone-less 变更检测**：`provideExperimentalZonelessChangeDetection()` 完全脱离 Zone.js

---

## Vue Reactivity 特性

### 核心 API

```typescript
import { ref, reactive, computed, watchEffect, watch } from 'vue';

const count = ref(0);              // 基本类型，需 .value 访问
const state = reactive({ a: 1 }); // 对象深度代理，直接访问属性
const double = computed(() => count.value * 2);

watchEffect(() => console.log(count.value));  // 自动依赖追踪
watch(count, (newVal, oldVal) => {}, { flush: 'post' }); // 精确控制
```

### 依赖追踪数据结构

```
WeakMap<target, Map<key, Set<ReactiveEffect>>>
```

- `WeakMap`：响应式对象可被 GC 时自动清理依赖记录
- 调度器支持 `flush: 'pre' | 'post' | 'sync'`，默认微任务批量更新

---

## Solid.js 特性

### 核心 API

```typescript
import { createSignal, createMemo, createEffect, onCleanup } from 'solid-js';

const [count, setCount] = createSignal(0);   // [getter, setter] 数组解构
const double = createMemo(() => count() * 2);
createEffect(() => console.log(count()));
```

### 关键特性

- **无 Virtual DOM**：组件函数只执行一次，编译器将 JSX 转为原生 DOM 操作
- **所有权树（Ownership Tree）**：`createRoot` 管理响应式上下文生命周期
- **`<For>` 组件**：引用相等性复用 DOM，无需手动指定 key
- JS Framework Benchmark 长期前三，部分测试超越原生 JavaScript

---

## Preact Signals 特性

### 核心 API

```typescript
import { signal, computed, effect, batch } from '@preact/signals';

const count = signal(0);            // .value 读写
count.value++;
const double = computed(() => count.value * 2);
```

### 关键特性

- **绕过组件渲染**：Signal 值变化时直接更新文本节点，组件函数不重新执行
- **JSX 中直接使用**：`<p>{count}</p>` 传入 signal 对象，Preact 自动处理
- **极致轻量**：纯 signals 库 ~1KB gzip
- React 集成受限于 React 渲染模型，无法实现完全细粒度更新

---

## 综合对比

| 维度 | Angular | Vue | Solid | Preact Signals |
|------|---------|-----|-------|----------------|
| **引入版本** | v16 (2023) | v3 (2020) | v1.0 (2021) | v1.0 (2022) |
| **读取方式** | `count()` | `count.value` | `count()` | `count.value` |
| **深度响应式** | ❌ 手动拆解 | ✅ `reactive()` | ❌ 手动拆解 | ❌ 手动拆解 |
| **Virtual DOM** | ✅ 有（编译优化） | ✅ 有（编译优化） | ❌ 无 | ✅ 极轻量 |
| **Bundle Size** | ~30KB | ~33KB | ~7KB | ~1KB |
| **性能** | 良好 | 中上 | **顶级** | 优秀 |
| **学习曲线** | 陡峭 | 中等 | 平缓 | 平缓 |
| **社区规模** | 大 | **最大** | 中小 | 小 |
| **企业采用率** | 高 | 高 | 低 | 低 |
| **SSR** | Angular Universal | Nuxt 3 | SolidStart | 有限 |

---

## 实战案例

详细代码示例与深度剖析见博客文章：[Signals 范式对比深度剖析：Angular Signals vs Vue Reactivity vs Solid Reactivity vs Preact Signals](/2026/06/05/signals-paradigm-comparison-angular-vue-solid-preact/)

涵盖内容：
- 四大框架的完整代码示例与底层原理图解
- Push-Pull 混合模型的详细传播流程
- Proxy 拦截 vs 函数拦截的依赖追踪差异
- 编译时优化策略对比（Solid JSX → DOM、Vue PatchFlag、Angular Ivy）
- 常见踩坑陷阱与解决方案

---

## 相关概念

- [Vue3-Composition-API](Vue3-Composition-API.md) — Vue 响应式基础，ref/reactive/computed 最佳实践
- [Pinia状态管理](Pinia状态管理.md) — 基于 Vue 响应式的状态管理方案
- [前端工具链](前端工具链.md) — 构建工具与开发环境配置

---

## 常见问题

### Signals vs RxJS 的适用场景

| 维度 | Signals | RxJS |
|------|---------|------|
| **适用场景** | UI 层细粒度状态管理 | 复杂异步数据流处理 |
| **学习曲线** | 平缓（3 个核心 API） | 陡峭（数十个操作符） |
| **复杂度** | 轻量，计数器也能用 | 重量级，需完整数据流模型 |
| **典型用例** | 表单状态、UI 交互、计算属性 | WebSocket 流、多源数据合并、复杂事件处理 |

结论：大多数 UI 场景用 Signals 即可；涉及复杂异步流编排时 RxJS 仍有不可替代的优势。

### 编译时 vs 运行时响应式的性能差异

| 维度 | 编译时优化（Solid） | 运行时响应式（Preact Signals） |
|------|---------------------|-------------------------------|
| **更新定位** | 编译时确定 DOM 绑定位置 | 运行时通过信号追踪动态定位 |
| **运行时开销** | 接近零（答案已在编译时给出） | 轻量但存在追踪/传播开销 |
| **灵活性** | 受编译器分析能力限制 | 完全动态，不受编译约束 |
| **开发体验** | 需要特定编译器支持 | 零配置，即插即用 |

### 框架选型决策矩阵

```
追求极致性能         → Solid.js
企业级全栈开发       → Angular
快速开发 + 丰富生态  → Vue
极致轻量             → Preact Signals
已有 React 项目      → @preact/signals/react
已有 Angular 项目    → Angular Signals（渐进迁移）
已有 Vue 项目        → Vue Composition API（已是 Signals 范式）
```

---

## 参考资料

- [Angular Signals RFC](https://github.com/angular/angular/discussions/49652)
- [Vue 3 Reactivity in Depth](https://vuejs.org/guide/extras/reactivity-in-depth.html)
- [Solid.js Reactivity 文档](https://www.solidjs.com/docs/latest/api)
- [Preact Signals 官方文档](https://preactjs.com/guide/v10/signals/)
- [Ryan Carniato - The Evolution of Signals in JavaScript](https://dev.to/this-is-learning/the-evolution-of-signals-in-javascript-15pg)
- [JS Framework Benchmark](https://krausest.github.io/js-framework-benchmark/current.html)
