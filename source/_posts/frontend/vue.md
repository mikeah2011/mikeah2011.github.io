---

title: Vue.js 核心概念：响应式数据、组件化与生命周期
keywords: [Vue.js, 核心概念, 响应式数据, 组件化与生命周期]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- JavaScript
- Vue
- 前端
categories:
- frontend
date: 2020-03-20 15:05:07
description: Vue 是渐进式 JavaScript 框架，由尤雨溪创建，主打"易学易上手 + 响应式 + 模板语法"。Vue 3 的 Composition API + `<script setup>` 让大型项目的组织更清晰。本文从 Hello Vue 到响应式原理、组件通信、Vue Router 路由守卫、Pinia 状态管理、性能优化（懒加载、虚拟滚动）进行系统讲解，附 Vue 2 vs Vue 3 对比表和高频踩坑记录。
---





## 一、Vue 简介

Vue 由前 Google 工程师**尤雨溪 (Evan You)** 创建，2014 年首发。核心理念：

- **渐进式**：可以只用一部分（CDN 引入做轻量交互），也可以全套（路由 + 状态 + SSR）
- **模板语法 + 响应式**：HTML 写界面，数据变了视图自动变
- **学习曲线平**：会 HTML/CSS/JS 就能上手

| 版本 | 现状 |
|------|------|
| Vue 2 | 2024 年 EOL，仅维护性更新 |
| **Vue 3** | **当前推荐**，性能更好、TS 支持完善、Composition API |

---

## 二、Hello Vue

最简形式（CDN）：

```html
<script src="https://unpkg.com/vue@3"></script>
<div id="app">{{ msg }}</div>
<script>
const { createApp } = Vue;
createApp({
  data() {
    return { msg: 'Hello Vue 3' };
  }
}).mount('#app');
</script>
```

工程化（推荐）：

```bash
npm create vue@latest      # 官方脚手架（基于 Vite）
cd my-app && npm i && npm run dev
```

---

## 三、单文件组件（SFC）+ `<script setup>`

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const count = ref(0);
const double = computed(() => count.value * 2);

function inc() {
  count.value++;
}

onMounted(() => console.log('mounted'));
</script>

<template>
  <div>
    <p>{{ count }} × 2 = {{ double }}</p>
    <button @click="inc">+1</button>
  </div>
</template>

<style scoped>
button { padding: 4px 12px; }
</style>
```

**`<script setup>` 是 Vue 3 的灵魂语法糖** —— 顶层变量自动暴露给模板，比 Options API 简洁太多。

---

## 四、响应式核心

```ts
import { ref, reactive, computed, watch } from 'vue';

// ref：包装原始值
const n = ref(1);
n.value++;                  // 注意 .value

// reactive：包装对象（不能用于原始值）
const state = reactive({ count: 0, items: [] });
state.count++;              // 直接改

// computed：缓存衍生值
const total = computed(() => state.items.reduce((s, i) => s + i.price, 0));

// watch：副作用
watch(n, (newVal, oldVal) => console.log(`n: ${oldVal} → ${newVal}`));

// watchEffect：自动追踪依赖
watchEffect(() => console.log('count:', state.count));
```

> **Vue 3.5+ 的 reactive props 解构** 可以直接 `const { count } = defineProps()` 不丢响应性，3.5 之前要 `toRefs`。

---

## 五、组件通信

```vue
<!-- 父 -->
<Child :msg="hi" @done="onDone" />

<!-- 子 -->
<script setup>
const props = defineProps<{ msg: string }>();
const emit = defineEmits<{ done: [result: number] }>();
emit('done', 42);
</script>
```

跨层级用 **provide/inject**；全局状态用 **Pinia**（取代了 Vuex）。

---

## 六、生态全家桶

| 类型 | 推荐 |
|------|------|
| **构建** | [Vite](https://vitejs.dev)（官方，秒级热更新） |
| **路由** | [Vue Router 4](https://router.vuejs.org) |
| **状态** | [Pinia](https://pinia.vuejs.org)（取代 Vuex） |
| **SSR / 全栈** | [Nuxt 3](https://nuxt.com) |
| **UI 库** | Element Plus、Ant Design Vue、Naive UI、Vuetify 3、PrimeVue |
| **测试** | Vitest + Vue Test Utils |
| **TS 支持** | Volar（VSCode 插件，已被 Vue Official 取代） |

---

## 七、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **忘记 .value** | 模板里能用，JS 里 `n` 不变 | `ref` 在 JS 里必须 `n.value`，模板自动解包 |
| **解构丢响应性** | `const { count } = state` 后改没反应 | 用 `toRefs(state)` 或 `storeToRefs(usePiniaStore())` |
| **v-for + key** | 渲染异常、组件状态错乱 | 永远给 `key`，且用唯一 ID（不是 index） |
| **v-if vs v-show** | 频繁切换闪烁/性能差 | 频繁切用 `v-show`（CSS），偶尔用 `v-if`（DOM 增删） |
| **scoped 样式不生效** | 子组件根元素没样式 | scoped 只影响当前组件；跨组件用 `:deep(.x)` |
| **响应性丢失** | 直接给 ref 赋对象，修改不更新 | 用 `reactive` 或 `ref` 包装新对象，避免直接替换 .value |

---

## 八、Vue vs React 该选哪个

| 维度 | Vue | React |
|------|-----|-------|
| 上手 | 平 | 中 |
| 模板 | HTML 模板 | JSX |
| 状态管理 | Pinia（简洁） | Redux / Zustand / Jotai 多选 |
| TS 体验 | 3.x 后追平 | 一直很好 |
| 生态 | 官方维护多 | 第三方百花齐放 |
| 社区 | 国内大 | 全球更大 |

**短结论**：国内项目、新手团队、想快速产出 → Vue；大型应用、跨平台、海外团队 → React。

---

## 九、Vue 2 vs Vue 3 详细对比

Vue 3 相较 Vue 2 是一次全面重写，底层从 `Object.defineProperty` 切换到 `Proxy`，并引入了 Composition API、更好的 TypeScript 支持和 Tree-shaking。以下是两个版本的核心差异对比：

| 维度 | Vue 2 | Vue 3 |
|------|-------|-------|
| **响应式原理** | `Object.defineProperty`（无法检测新增/删除属性） | `Proxy`（原生支持新增、删除属性和数组索引变化） |
| **API 风格** | Options API（data/methods/computed/watch） | Composition API + `<script setup>`（更灵活的逻辑组织） |
| **TypeScript** | 支持较弱，需额外配置 | 原生支持，类型推断完善 |
| **性能** | 虚拟 DOM 全量对比 | 静态提升 + PatchFlag + Block Tree，编译时优化 |
| **Tree-shaking** | 不支持，全量打包 | 按需引入，未使用的 API 不会打包 |
| **多根节点** | 必须单根节点 `<template>` | 支持 Fragment（多根节点） |
| **Teleport** | 无 | `<Teleport>` 内置传送组件 |
| **Suspense** | 无 | `<Suspense>` 异步组件加载态 |
| **生命周期** | `beforeCreate` / `created` | 用 `setup()` 替代，`onBeforeMount` 等替代 |
| **状态管理** | Vuex（mutation/action 分离） | Pinia（去 mutation，更简洁） |
| **事件总线** | `new Vue()` 作为 EventBus | 移除，推荐用 mitt 或 Pinia |
| **v-model** | 一个组件只能一个 `v-model` | 支持多个 `v-model:xxx` 带参数 |
| **EOL** | 2023 年底停止维护 | 持续更新中 |

> **迁移建议**：Vue 2 项目如果还在维护，建议使用官方的 `@vue/compat` 兼容包逐步迁移。新项目直接使用 Vue 3 + Vite + TypeScript + Pinia 技术栈，享受最佳的开发体验和性能表现。

### Vue 3 编译时优化原理

Vue 3 的虚拟 DOM 并非简单地全量对比，而是通过编译时的静态分析来标记动态节点。在模板编译阶段，Vue 3 会为每个动态绑定的元素生成一个 PatchFlag 标记（如 `1` 代表文本动态、`8` 代表 class 动态、`9` 代表文本和 class 都动态等），这样在运行时更新时只需检查带有 PatchFlag 的节点，跳过所有静态节点，大幅提升了更新效率。此外，Vue 3 还支持静态提升（HoistStatic），将不变的虚拟节点提升到渲染函数外部，避免每次渲染时重复创建；以及 Block Tree 技术，将模板中的动态节点以扁平数组形式存储，配合 PatchFlag 实现靶向更新，避免了传统虚拟 DOM 中逐层对比的开销。这些优化让 Vue 3 在大型复杂页面中的更新性能相比 Vue 2 提升了约 1.3 到 2 倍。

---

## 十、Composition API vs Options API 代码对比

Vue 3 支持两种组件编写方式。Options API 按选项分类代码，Composition API 按逻辑关注点组织代码。对于大型组件，Composition API 能更好地复用和组织逻辑。

### Options API（Vue 2 风格，Vue 3 仍支持）

```vue
<script>
export default {
  data() {
    return {
      count: 0,
      searchText: '',
      results: [],
    };
  },
  computed: {
    double() {
      return this.count * 2;
    },
    hasResults() {
      return this.results.length > 0;
    },
  },
  watch: {
    searchText(newVal) {
      this.fetchResults(newVal);
    },
  },
  mounted() {
    console.log('组件已挂载');
  },
  methods: {
    inc() {
      this.count++;
    },
    async fetchResults(q) {
      this.results = await api.search(q);
    },
  },
};
</script>
```

**Options API 的问题**：一个功能（如搜索）的逻辑分散在 `data`、`watch`、`methods` 中，组件越大越难维护。

### Composition API + `<script setup>`（Vue 3 推荐）

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useSearch } from '@/composables/useSearch';

// 计数器逻辑（一个完整的关注点）
const count = ref(0);
const double = computed(() => count.value * 2);
function inc() { count.value++; }

// 搜索逻辑（可提取为 composable 复用）
const searchText = ref('');
const { results, hasResults } = useSearch(searchText);

onMounted(() => console.log('组件已挂载'));
</script>
```

### 从 Composition API 中提取 Composable（逻辑复用）

```ts
// composables/useSearch.ts
import { ref, computed, watch } from 'vue';

export function useSearch(query: Ref<string>) {
  const results = ref<any[]>([]);
  const loading = ref(false);
  const hasResults = computed(() => results.value.length > 0);

  watch(query, async (q) => {
    if (!q.trim()) { results.value = []; return; }
    loading.value = true;
    try {
      results.value = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    } finally {
      loading.value = false;
    }
  });

  return { results, loading, hasResults };
}
```

> **Composable 是 Composition API 的杀手特性**——把相关逻辑封装成函数，跨组件复用，比 mixin 更清晰、无命名冲突。VueUse 库提供了上百个开箱即用的 composable（`useDark`、`useLocalStorage`、`useIntersectionObserver` 等）。

在实际开发中，推荐的做法是将可复用的业务逻辑（如搜索、分页、表单验证、权限校验、WebSocket 连接等）封装为 composable 函数，放在 `src/composables/` 目录下统一管理。一个典型的中型项目通常会积累 20 到 50 个自定义 composable。命名约定以 `use` 开头（如 `useAuth`、`usePagination`），内部使用 `ref` 和 `computed` 管理状态，通过返回值暴露数据和方法。相比 Vue 2 时代的 mixin，composable 的优势在于：不污染组件命名空间、支持 TypeScript 类型推断、可嵌套组合使用、逻辑依赖关系清晰可见。

---

## 十一、响应式系统详解

Vue 3 的响应式系统基于 ES6 的 `Proxy`，是整个框架的核心。理解响应式的原理能帮助你避免常见的数据不更新问题。与 Vue 2 使用 `Object.defineProperty` 逐个属性劫持不同，`Proxy` 可以拦截对象的所有操作（包括属性的新增、删除、索引访问等），无需像 Vue 2 那样调用 `Vue.set()` 或 `Vue.delete()` 来手动触发更新。这使得 Vue 3 的响应式系统更加完整和可靠，也使得数组的响应式处理更加自然，不再需要重写数组的 `push`、`pop` 等方法。

### ref 与 reactive 的区别

```ts
import { ref, reactive, toRef, toRefs } from 'vue';

// ref：适合原始值，也可以包装对象
const count = ref(0);          // 原始值
const user = ref({ name: '张三' }); // 对象也可以

// reactive：只能包装对象/数组，不能用于原始值
const state = reactive({
  count: 0,
  user: { name: '李四' },
  items: [] as string[],
});

// 访问方式不同
count.value++;                 // ref 需要 .value
state.count++;                 // reactive 直接访问

// 在模板中两者都不需要 .value
// <template>{{ count }} 和 {{ state.count }} 都可以
```

### 为什么解构 reactive 会丢失响应性？

```ts
const state = reactive({ count: 0, name: 'Vue' });

// ❌ 错误：解构后变成了普通变量，丢失响应性
const { count, name } = state;

// ✅ 正确：用 toRefs 保持响应性
const { count: countRef, name: nameRef } = toRefs(state);
countRef.value++; // 响应式更新

// ✅ Vue 3.5+ 的 props 解构不受影响
// const { count } = defineProps<{ count: number }>(); // 自动保持响应性
```

### computed 的缓存机制

```ts
const items = ref([1, 2, 3, 4, 5]);

// computed 有缓存：只有依赖变化时才重新计算
const total = computed(() => {
  console.log('重新计算'); // 只在 items 变化时输出
  return items.value.reduce((sum, n) => sum + n, 0);
});

console.log(total.value); // 重新计算 → 15
console.log(total.value); // 直接返回缓存 → 15（不触发计算）
items.value.push(6);
console.log(total.value); // 重新计算 → 21
```

### watch vs watchEffect

```ts
import { ref, watch, watchEffect } from 'vue';

const keyword = ref('');
const page = ref(1);

// watch：明确指定要监听的源，可获取新旧值
watch(keyword, (newVal, oldVal) => {
  console.log(`搜索词从 "${oldVal}" 变为 "${newVal}"`);
  page.value = 1; // 关键词变化时重置页码
}, { immediate: false }); // immediate: true 则首次也触发

// watchEffect：自动追踪回调中用到的所有响应式依赖
watchEffect(() => {
  console.log(`正在搜索 "${keyword.value}" 第 ${page.value} 页`);
  // keyword 或 page 任一变化都会触发
});

// watchPostEffect：DOM 更新后触发（适合操作 DOM）
watchPostEffect(() => {
  document.title = `搜索 - ${keyword.value}`;
});
```

### shallowRef 与 shallowReactive（性能优化）

```ts
import { shallowRef, triggerRef } from 'vue';

// shallowRef：只追踪 .value 的变化，不递归监听内部属性
const largeData = shallowRef({ list: new Array(10000).fill(0) });

// 修改内部属性不会触发更新
largeData.value.list[0] = 1; // ❌ 不触发

// 必须整体替换
largeData.value = { list: new Array(10000).fill(1) }; // ✅ 触发

// 或手动触发
triggerRef(largeData); // 强制触发更新
```

---

## 十二、组件通信模式详解

在实际项目中，组件之间的数据传递是核心问题。Vue 提供了多种通信方式，适用于不同场景。

### 1. Props + Emit（父子组件）

```vue
<!-- 父组件 -->
<script setup>
import { ref } from 'vue';
import UserCard from './UserCard.vue';

const user = ref({ name: '张三', age: 28 });
function onDelete(id: number) {
  console.log('删除用户', id);
}
</script>

<template>
  <UserCard :user="user" @delete="onDelete" />
</template>
```

```vue
<!-- 子组件 UserCard.vue -->
<script setup lang="ts">
// defineProps 和 defineEmits 是编译器宏，无需 import
const props = defineProps<{
  user: { name: string; age: number };
}>();

const emit = defineEmits<{
  delete: [id: number];
}>();

function handleDelete() {
  emit('delete', 123);
}
</script>

<template>
  <div>
    <p>{{ user.name }} - {{ user.age }}岁</p>
    <button @click="handleDelete">删除</button>
  </div>
</template>
```

### 2. Provide / Inject（跨层级通信）

适用于祖孙组件或深层嵌套的组件通信，避免 Props 逐层传递（prop drilling）。

```vue
<!-- 祖先组件 ThemeProvider.vue -->
<script setup>
import { provide, ref } from 'vue';

const theme = ref('dark');
const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
};

// 提供响应式数据和方法
provide('theme', theme);
provide('toggleTheme', toggleTheme);
</script>
```

```vue
<!-- 深层子组件 ThemedButton.vue -->
<script setup>
import { inject } from 'vue';

// inject 的第二个参数是默认值
const theme = inject('theme', 'light');
const toggleTheme = inject('toggleTheme', () => {});
</script>

<template>
  <button :class="theme" @click="toggleTheme">
    当前主题：{{ theme }}
  </button>
</template>
```

### 3. Pinia 状态管理（全局状态）

Pinia 是 Vue 3 官方推荐的状态管理库，取代了 Vuex。API 更简洁，去掉了 mutation，原生支持 TypeScript。Pinia 的设计哲学是"扁平化"，不再需要 Vuex 中嵌套的 modules 结构，每个 store 都是独立的，通过函数组合来实现模块化。Pinia 还支持 SSR、热更新、插件扩展等高级特性，并且可以直接在 Vue DevTools 中查看和调试 store 的状态变化。

```ts
// stores/user.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useUserStore = defineStore('user', () => {
  // state
  const name = ref('');
  const token = ref('');
  const roles = ref<string[]>([]);

  // getters
  const isLoggedIn = computed(() => !!token.value);
  const isAdmin = computed(() => roles.value.includes('admin'));

  // actions
  async function login(username: string, password: string) {
    const res = await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    name.value = data.name;
    token.value = data.token;
    roles.value = data.roles;
  }

  function logout() {
    name.value = '';
    token.value = '';
    roles.value = [];
  }

  return { name, token, roles, isLoggedIn, isAdmin, login, logout };
});
```

```vue
<!-- 在组件中使用 -->
<script setup>
import { storeToRefs } from 'pinia';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();

// storeToRefs 保持响应性（解构不丢失）
const { name, isLoggedIn } = storeToRefs(userStore);

// action 直接解构即可
const { login, logout } = userStore;
</script>

<template>
  <div v-if="isLoggedIn">
    欢迎，{{ name }}
    <button @click="logout">退出</button>
  </div>
  <div v-else>
    <button @click="login('admin', '123456')">登录</button>
  </div>
</template>
```

### 4. 通信方式选择指南

| 场景 | 推荐方式 | 说明 |
|------|---------|------|
| 父 → 子 | `props` | 最基本的数据传递 |
| 子 → 父 | `emit` | 子组件通知父组件事件发生 |
| 兄弟组件 | Pinia 或 `props` + `emit` 通过父组件中转 | 简单场景用中转，复杂场景用 Pinia |
| 跨层级 | `provide/inject` | 适合主题、国际化、权限等全局配置 |
| 全局状态 | Pinia | 用户登录态、购物车、全局配置等 |

---

## 十三、Vue Router 导航守卫

Vue Router 4 提供了完整的导航守卫系统，用于权限控制、数据预加载、页面访问日志等场景。导航守卫本质上是路由跳转过程中的拦截器，可以在路由进入前、进入后、更新时、离开前等不同阶段执行自定义逻辑。Vue Router 的守卫分为三类：全局守卫（作用于所有路由）、路由独享守卫（仅作用于单个路由）和组件内守卫（在组件内部定义）。合理使用导航守卫可以实现完整的前端路由权限体系，配合后端接口验证可以构建安全可靠的企业级应用。

### 全局前置守卫（路由级权限控制）

```ts
// router/index.ts
import { createRouter, createWebHistory } from 'vue-router';
import { useUserStore } from '@/stores/user';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/views/Home.vue'),
    },
    {
      path: '/login',
      component: () => import('@/views/Login.vue'),
      meta: { guest: true },
    },
    {
      path: '/admin',
      component: () => import('@/views/Admin.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
    {
      path: '/profile',
      component: () => import('@/views/Profile.vue'),
      meta: { requiresAuth: true },
    },
  ],
});

// 全局前置守卫
router.beforeEach(async (to, from) => {
  const userStore = useUserStore();

  // 需要登录但未登录 → 跳转登录页
  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  // 已登录但访问 guest 页面（如登录页）→ 跳转首页
  if (to.meta.guest && userStore.isLoggedIn) {
    return { path: '/' };
  }

  // 需要特定角色但没有该角色 → 403
  const requiredRoles = to.meta.roles as string[] | undefined;
  if (requiredRoles && !requiredRoles.some(r => userStore.roles.includes(r))) {
    return { path: '/403' };
  }

  // 放行
  return true;
});

// 全局后置钩子（页面标题、访问日志）
router.afterEach((to) => {
  document.title = (to.meta.title as string) || '我的应用';
  console.log(`页面访问：${to.path}`);
});
```

### 组件内路由守卫

```vue
<script setup>
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';

// 路由参数变化时触发（如 /user/1 → /user/2）
onBeforeRouteUpdate(async (to, from) => {
  // 重新加载数据
  await fetchUser(to.params.id);
});

// 离开页面前确认（防止未保存数据丢失）
onBeforeRouteLeave((to, from) => {
  if (hasUnsavedChanges.value) {
    const confirm = window.confirm('有未保存的更改，确定离开吗？');
    if (!confirm) return false; // 取消导航
  }
});
</script>
```

---

## 十四、性能优化

Vue 3 本身就比 Vue 2 快很多，但在大型应用中仍需注意性能优化。

### 1. 组件懒加载（defineAsyncComponent）

```ts
import { defineAsyncComponent } from 'vue';

// 基础用法：按需加载组件
const HeavyChart = defineAsyncComponent(() => import('./HeavyChart.vue'));

// 带配置的高级用法
const AdminPanel = defineAsyncComponent({
  loader: () => import('./AdminPanel.vue'),
  loadingComponent: LoadingSpinner,   // 加载中显示
  errorComponent: ErrorDisplay,        // 加载失败显示
  delay: 200,                          // 延迟 200ms 显示 loading（避免闪烁）
  timeout: 10000,                      // 超时时间
  suspensible: false,                  // 是否触发 Suspense
});
```

### 2. 路由懒加载

```ts
// router/index.ts
const routes = [
  {
    path: '/dashboard',
    // Vite 会自动代码分割
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: '/reports',
    // 带 webpackChunkName 的命名分割
    component: () => import(/* webpackChunkName: "reports" */ '@/views/Reports.vue'),
  },
];
```

### 3. v-once 和 v-memo（减少不必要的更新）

```vue
<template>
  <!-- v-once：只渲染一次，后续数据变化不更新 -->
  <h1 v-once>{{ pageTitle }}</h1>

  <!-- v-memo：只有依赖变化时才重新渲染（类似 React.memo） -->
  <div v-for="item in list" :key="item.id" v-memo="[item.id === selectedId]">
    <p :class="{ active: item.id === selectedId }">{{ item.name }}</p>
  </div>
</template>
```

### 4. 大列表优化：虚拟滚动

当列表数据量超过 1000 条时，建议使用虚拟滚动库，只渲染可视区域的元素：

```bash
npm install @tanstack/vue-virtual
```

```vue
<script setup>
import { useVirtualizer } from '@tanstack/vue-virtual';
import { ref } from 'vue';

const parentRef = ref<HTMLElement>();
const items = ref(Array.from({ length: 10000 }, (_, i) => `Item ${i}`));

const virtualizer = useVirtualizer({
  count: items.value.length,
  getScrollElement: () => parentRef.value,
  estimateSize: () => 40, // 每行预估高度
});
</script>

<template>
  <div ref="parentRef" style="height: 400px; overflow: auto;">
    <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
      <div
        v-for="row in virtualizer.getVirtualItems()"
        :key="row.key"
        :style="{ position: 'absolute', top: `${row.start}px`, height: `${row.size}px`, width: '100%' }"
      >
        {{ items[row.index] }}
      </div>
    </div>
  </div>
</template>
```

### 5. 生产环境优化检查清单

| 优化项 | 说明 |
|--------|------|
| **开启生产模式** | 确保 `process.env.NODE_ENV === 'production'`，Vue 会关闭开发警告 |
| **Tree-shaking** | 使用 ES Module 格式引入库，让打包器移除未使用代码 |
| **图片懒加载** | 使用 `loading="lazy"` 或 `vue-lazyload` 插件 |
| **组件缓存** | `<KeepAlive>` 缓存频繁切换的组件（如 Tab 页） |
| **避免内联对象** | 模板中的 `:style="{ color: 'red' }"` 每次渲染都创建新对象 |
| **合理使用 shallowRef** | 大型对象不需要深层响应时用 `shallowRef` 减少开销 |
| **SSR / SSG** | 首屏渲染用 Nuxt 3 做服务端渲染或静态生成 |

### 6. `<KeepAlive>` 组件缓存

在频繁切换的页面（如标签页、路由视图切换）中，使用 `<KeepAlive>` 可以缓存已渲染的组件实例，避免重复创建和销毁。这在用户频繁在几个固定页面之间切换时非常有用，能显著减少渲染开销和网络请求。

```vue
<template>
  <!-- 缓存所有匹配的组件 -->
  <KeepAlive :include="['HomePage', 'ProfilePage']" :max="5">
    <router-view />
  </KeepAlive>
</template>
```

`include` 属性接受组件名称数组或正则表达式，用于指定哪些组件需要被缓存。`max` 属性限制缓存的组件实例数量，防止内存过度占用。被缓存的组件会触发 `onActivated` 和 `onActivated` 生命周期钩子，而不是 `onMounted` 和 `onUnmounted`，因此需要注意在 `onActivated` 中刷新数据，在 `onDeactivated` 中暂停定时器等操作。

---

## 相关阅读

- [Vue 3 Composition API 深度指南：ref、reactive、computed 最佳实践](/frontend/vue-3-composition-api-guide-ref-reactive-computed-best-practices)
- [Vue 3 + Pinia 状态管理指南：替代 Vuex 的 B2C 实战](/frontend/vue-3-pinia-guide-vuex-b2c)
- [Vue 3 + Vite 构建指南：HMR 热更新与优化实践](/frontend/vue-3-vite-guide-hmr-optimization)

---

## 参考

- 官网：<https://cn.vuejs.org>
- Pinia：<https://pinia.vuejs.org/zh/>
- Vite：<https://cn.vitejs.dev>
- Vue Mastery（视频）：<https://www.vuemastery.com>
