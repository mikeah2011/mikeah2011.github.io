---
title: Vue
tags: [JavaScript, Vue, 前端]
categories:
  - HTML
date: 2020-03-20 15:05:07
description: 'Vue 是渐进式 JavaScript 框架，由尤雨溪创建，主打"易学易上手 + 响应式 + 模板语法"。Vue 3 的 Composition API + `<script setup>` 让大型项目的组织更清晰。'
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

## 参考

- 官网：<https://cn.vuejs.org>
- Pinia：<https://pinia.vuejs.org/zh/>
- Vite：<https://cn.vitejs.dev>
- Vue Mastery（视频）：<https://www.vuemastery.com>
