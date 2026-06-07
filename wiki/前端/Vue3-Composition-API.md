# Vue 3 Composition API

## 定义
Vue 3 Composition API 是 Vue 3 引入的全新组件编写方式，通过 `setup()` 函数或 `<script setup>` 语法糖，将同一逻辑关注点的代码组织在一起，替代 Vue 2 的 Options API（data/methods/computed 分离写法）。

## 核心原理

### 响应式系统
Vue 3 使用 `Proxy` 代理实现响应式，替代 Vue 2 的 `Object.defineProperty`：

| API | 用途 | 特点 |
|-----|------|------|
| `ref()` | 原始类型响应式 | 通过 `.value` 访问，模板自动解包 |
| `reactive()` | 复杂对象响应式 | 直接访问属性，不能解构（会丢失响应式） |
| `computed()` | 派生状态 | 基于依赖缓存，依赖不变则不重算 |
| `watch()` | 副作用监听 | 精确监听指定响应式数据 |
| `watchEffect()` | 自动依赖追踪 | 立即执行，自动追踪用到的响应式数据 |

### 组合式函数（Composables）
将可复用的逻辑封装为 `use*` 函数：
```typescript
// useCounter.ts
export function useCounter(initial = 0) {
  const count = ref(initial)
  const increment = () => count.value++
  const decrement = () => count.value--
  return { count, increment, decrement }
}
```

### 生命周期
在 Composition API 中，生命周期钩子以 `on*` 前缀函数形式使用：
- `onMounted()` → 替代 `mounted`
- `onUpdated()` → 替代 `updated`
- `onUnmounted()` → 替代 `beforeDestroy`

## 常见陷阱

### reactive 丢失响应式
```typescript
// ❌ 解构会丢失响应式
const state = reactive({ count: 0 })
const { count } = state  // count 不再是响应式

// ✅ 使用 toRefs
const { count } = toRefs(state)
```

### ref 在模板中的自动解包
```typescript
// script 中需要 .value
const count = ref(0)
count.value++

// template 中自动解包
// <div>{{ count }}</div>  ✅ 不需要 .value
```

### computed 缓存失效
```typescript
// ❌ 每次访问都重新计算（无缓存）
const fullName = () => firstName.value + ' ' + lastName.value

// ✅ 有缓存，依赖不变不重算
const fullName = computed(() => firstName.value + ' ' + lastName.value)
```

## 实战案例
来自博客文章：
- [Vue 3 Composition API 实战](/categories/Frontend/vue-3-composition-api-guide-ref-reactive-computed-best-practices/) - ref/reactive/computed 最佳实践与响应式踩坑记录
- [vue-pure-admin 管理后台实战](/categories/Frontend/vue3-vue-pure-admin-guide-fork/) - 在管理后台中的 Composition API 实践

## 相关概念
- [Pinia 状态管理](Pinia状态管理.md) - 基于 Composition API 的状态管理
- [Vue 3 TypeScript](Vue3-TypeScript.md) - Composition API 的类型推导
- [Nuxt 4 全栈框架](Nuxt4全栈框架.md) - Composition API 在全栈框架中的应用

## 常见问题

**Q: Options API 和 Composition API 能混用吗？**
A: 可以。Vue 3 支持两种 API 混用，但建议新组件统一使用 Composition API。

**Q: 什么时候用 ref，什么时候用 reactive？**
A: 原始类型用 `ref()`，复杂对象用 `reactive()`。实际项目中统一用 `ref()` 也是常见实践，避免 `.value` 和直接访问的混乱。

**Q: `<script setup>` 和 `setup()` 函数有什么区别？**
A: `<script setup>` 是语法糖，更简洁，不需要手动 return，编译时自动处理。推荐使用 `<script setup>`。
