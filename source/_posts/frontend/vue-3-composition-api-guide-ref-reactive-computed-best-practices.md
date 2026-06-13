---

title: Vue 3 Composition API 实战-ref reactive computed 最佳实践与响应式踩坑记录
keywords: [Vue, Composition API, ref reactive computed, 最佳实践与响应式踩坑记录]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-16 21:20:25
updated: 2026-05-16 21:23:08
categories:
- frontend
tags:
- TypeScript
- Vue
- 前端
description: 从 Options API 迁移到 Vue 3 Composition API 的完整实战经验，深度剖析 ref 与 reactive 的选型决策、computed 缓存机制与陷阱、watch/watchEffect 副作用监听最佳实践、可组合函数 Composables 设计模式。覆盖响应式丢失、解构陷阱、请求竞态等常见问题的根因分析与解决方案，结合 vue-pure-admin 管理后台和 uni-app 跨平台项目中的真实踩坑记录，帮助前端开发者少走弯路。
---



# Vue 3 Composition API 实战：ref、reactive、computed 最佳实践与响应式踩坑记录

## 为什么写这篇文章？

在维护 vue-pure-admin 管理后台和 uni-app 跨平台项目的过程中，我经历了从 Options API 到 Composition API 的完整迁移。这个过程中踩了不少坑——`reactive` 丢失响应式、`ref` 的 `.value` 忘记写、`computed` 的缓存失效……这些看似简单的问题，在真实业务代码里排查起来非常痛苦。

本文不是 Vue 3 官方文档的复述，而是**真实项目中的踩坑记录和最佳实践**。

## 整体架构：Composition API 的思维模型

```
┌─────────────────────────────────────────────────┐
│                  Vue 3 组件                       │
│  ┌───────────────────────────────────────────┐  │
│  │           <script setup>                  │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  │  │
│  │  │  ref()  │  │reactive()│  │computed()│  │  │
│  │  │ 原始类型 │  │ 复杂对象  │  │ 派生状态 │  │  │
│  │  └────┬────┘  └─────┬────┘  └────┬────┘  │  │
│  │       │             │            │       │  │
│  │  ┌────▼─────────────▼────────────▼────┐  │  │
│  │  │         响应式系统 (Reactivity)      │  │  │
│  │  │   Proxy 代理 → 依赖追踪 → 自动更新   │  │  │
│  │  └────────────────────────────────────┘  │  │
│  │                                           │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────┐  │  │
│  │  │  watch() │  │watchEff()│  │ 生命周期 │  │  │
│  │  │ 副作用监听 │  │ 立即执行  │  │onMounted│  │  │
│  │  └──────────┘  └──────────┘  └────────┘  │  │
│  └───────────────────────────────────────────┘  │
│                                                   │
│  ┌───────────────────────────────────────────┐  │
│  │           可组合函数 (Composables)           │  │
│  │  useUser()  usePermission()  useTable()   │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## 一、ref vs reactive：什么时候用哪个？

### 核心区别

```typescript
// ref：包装任意类型，通过 .value 访问
const count = ref(0)           // Ref<number>
count.value++                   // 必须 .value

const user = ref({ name: 'mike' }) // Ref<{ name: string }>
user.value.name = 'michael'        // 内部自动解包，不需要 .value.name

// reactive：只能包装对象，直接访问属性
const state = reactive({
  count: 0,
  user: { name: 'mike' }
})
state.count++                   // 直接访问
state.user.name = 'michael'    // 直接访问
```

### 实战决策树

```
需要响应式数据？
├── 原始类型（string/number/boolean）→ ref() ✅
├── 简单对象，不需要替换整体引用 → reactive() ✅
├── 复杂对象，可能需要整体替换 → ref() ✅
├── 需要解构但保持响应式 → toRefs(reactive()) ✅
└── 从 composable 返回 → ref() ✅（避免 reactive 的解构丢失）
```

### ⚠️ 踩坑一：reactive 整体替换导致响应式丢失

```typescript
// ❌ 错误：整体替换 reactive 对象会丢失响应式
let state = reactive({ list: [], total: 0 })

async function fetchData() {
  // 这里重新赋值了一个新对象，Proxy 被打破了！
  state = await api.getList()  // 💥 响应式丢失
}

// ✅ 正确：逐个属性赋值
async function fetchData() {
  const data = await api.getList()
  state.list = data.list       // ✅ 保持响应式
  state.total = data.total
}

// ✅ 或者用 Object.assign
async function fetchData() {
  const data = await api.getList()
  Object.assign(state, data)   // ✅ 保持响应式
}

// ✅ 最佳：直接用 ref，避免这个坑
const state = ref({ list: [], total: 0 })

async function fetchData() {
  state.value = await api.getList()  // ✅ ref 支持整体替换
}
```

**经验法则**：如果你不确定某个对象将来会不会被整体替换，**直接用 `ref`**。`ref` 是更安全的默认选择。

### ⚠️ 踩坑二：reactive 解构丢失响应式

```typescript
const state = reactive({ count: 0, name: 'mike' })

// ❌ 解构后丢失响应式！
const { count, name } = state  // count 和 name 变成了普通值
// 此时修改 count 不会触发视图更新

// ✅ 用 toRefs 保持响应式
const { count, name } = toRefs(state)
// count 是 Ref<number>，name 是 Ref<string>
// 修改 count.value 会触发视图更新
```

这个坑在 composable 函数里特别常见：

```typescript
// ❌ 错误的 composable 设计
function useUser() {
  const state = reactive({
    user: null as User | null,
    loading: false
  })

  async function fetchUser() { /* ... */ }

  return {
    ...state,        // 💥 解构后丢失响应式！
    fetchUser
  }
}

// ✅ 正确：返回 ref 或 toRefs
function useUser() {
  const user = ref<User | null>(null)
  const loading = ref(false)

  async function fetchUser() {
    loading.value = true
    user.value = await api.getUser()
    loading.value = false
  }

  return { user, loading, fetchUser }  // ✅ ref 解构安全
}
```

## 二、computed 的缓存机制与陷阱

### 基础用法

```typescript
const firstName = ref('Mike')
const lastName = ref('Ah')

// 只读 computed
const fullName = computed(() => `${firstName.value} ${lastName.value}`)
console.log(fullName.value) // 'Mike Ah'

// 可写 computed（少用，但有时很方便）
const fullNameWritable = computed({
  get: () => `${firstName.value} ${lastName.value}`,
  set: (val: string) => {
    const [first, ...rest] = val.split(' ')
    firstName.value = first
    lastName.value = rest.join(' ')
  }
})
```

### ⚠️ 踩坑三：computed 中的异步操作

```typescript
// ❌ computed 不支持异步！
const userData = computed(async () => {
  const res = await fetch('/api/user')  // 💥 返回的是 Promise
  return res.json()
})
// userData.value 是 Promise 对象，不是用户数据

// ✅ 异步数据用 watch + ref
const userId = ref(1)
const userData = ref<User | null>(null)

watch(userId, async (newId) => {
  userData.value = await api.getUser(newId)
}, { immediate: true })
```

### ⚠️ 踩坑四：computed 依赖的响应式丢失

```typescript
const filters = reactive({
  keyword: '',
  category: ''
})

// ❌ 错误：在 computed 中使用了非响应式变量
let apiUrl = '/api/products'  // 普通变量，不是响应式的

const searchUrl = computed(() => {
  return `${apiUrl}?keyword=${filters.keyword}&cat=${filters.category}`
})
// 如果 apiUrl 后来变了，searchUrl 不会重新计算！

// ✅ 正确：所有依赖都应该是响应式的
const baseApiUrl = ref('/api/products')

const searchUrl = computed(() => {
  return `${baseApiUrl.value}?keyword=${filters.keyword}&cat=${filters.category}`
})
```

## 三、watch vs watchEffect：副作用监听的选择

```typescript
const keyword = ref('')
const page = ref(1)

// watch：明确指定依赖，支持获取旧值
watch(keyword, (newVal, oldVal) => {
  console.log(`关键词从 "${oldVal}" 变为 "${newVal}"`)
  page.value = 1  // 关键词变了，重置页码
}, { debounce: 300 })  // 3.5+ 支持内置 debounce

// watchEffect：自动追踪依赖，适合多依赖场景
watchEffect(() => {
  // 自动追踪 keyword 和 page 的变化
  fetchProducts({
    keyword: keyword.value,
    page: page.value
  })
})
```

### 实战对比表

| 特性 | watch | watchEffect |
|------|-------|-------------|
| 明确指定依赖 | ✅ | ❌ 自动追踪 |
| 获取旧值 | ✅ | ❌ |
| 惰性执行 | 默认惰性 | 立即执行 |
| 适用场景 | 单个值变化需要精确控制 | 多个依赖的复合副作用 |
| 典型用法 | 搜索防抖、路由监听 | 表单联动、多条件查询 |

### ⚠️ 踩坑五：watchEffect 中的请求竞态

```typescript
// ❌ 没有处理竞态，快速切换时数据会错乱
watchEffect(async () => {
  const data = await api.getProducts({
    keyword: keyword.value,
    page: page.value
  })
  products.value = data
})

// ✅ 使用 AbortController 处理竞态
watchEffect((onCleanup) => {
  const controller = new AbortController()

  api.getProducts({
    keyword: keyword.value,
    page: page.value,
    signal: controller.signal
  }).then(data => {
    products.value = data
  }).catch(err => {
    if (err.name !== 'AbortError') {
      console.error(err)
    }
  })

  // 清理：取消上一次请求
  onCleanup(() => controller.abort())
})
```

## 四、可组合函数（Composables）设计模式

### 基础模式：CRUD 表格

```typescript
// composables/useTable.ts
import { ref, computed } from 'vue'

interface UseTableOptions<T> {
  fetchApi: (params: any) => Promise<{ list: T[]; total: number }>
  defaultPageSize?: number
}

export function useTable<T>(options: UseTableOptions<T>) {
  const list = ref<T[]>([]) as Ref<T[]>
  const total = ref(0)
  const loading = ref(false)
  const page = ref(1)
  const pageSize = ref(options.defaultPageSize ?? 20)

  const pagination = computed(() => ({
    page: page.value,
    pageSize: pageSize.value,
    total: total.value
  }))

  async function fetchData(params: Record<string, any> = {}) {
    loading.value = true
    try {
      const res = await options.fetchApi({
        page: page.value,
        pageSize: pageSize.value,
        ...params
      })
      list.value = res.list
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  function onPageChange(newPage: number) {
    page.value = newPage
    fetchData()
  }

  return {
    list, total, loading, page, pageSize, pagination,
    fetchData, onPageChange
  }
}
```

### 在组件中使用

```vue
<script setup lang="ts">
import { useTable } from '@/composables/useTable'
import { getProducts } from '@/api/product'

const {
  list: products,
  loading,
  pagination,
  fetchData,
  onPageChange
} = useTable<Product>({
  fetchApi: getProducts,
  defaultPageSize: 20
})

// 初始加载
fetchData()
</script>

<template>
  <el-table :data="products" v-loading="loading">
    <el-table-column prop="name" label="商品名称" />
    <el-table-column prop="price" label="价格" />
  </el-table>
  <el-pagination
    v-bind="pagination"
    @current-change="onPageChange"
  />
</template>
```

### 组合模式：多个 composable 协作

```typescript
// composables/useProductSearch.ts
export function useProductSearch() {
  const filters = reactive({
    keyword: '',
    category: '',
    priceRange: [0, 9999]
  })

  const {
    list: products, loading, pagination, fetchData, onPageChange
  } = useTable<Product>({
    fetchApi: (params) => getProducts({ ...filters, ...params })
  })

  // 关键词变化时自动搜索（带防抖）
  const debouncedFetch = useDebounceFn(() => {
    fetchData(filters)
  }, 300)

  watch(() => filters.keyword, debouncedFetch)
  watch(() => filters.category, () => fetchData(filters))

  return {
    filters, products, loading, pagination,
    onPageChange, refresh: () => fetchData(filters)
  }
}
```

## 五、在 vue-pure-admin 中的实战经验

vue-pure-admin 是一个基于 Vue 3 + TypeScript + Element Plus 的管理后台模板。在 fork 和定制化的过程中，Composition API 的模式非常适合：

```typescript
// views/product/list.vue
<script setup lang="ts">
defineOptions({ name: 'ProductList' })

const { filters, products, loading, pagination, onPageChange, refresh } =
  useProductSearch()

const { hasPermission } = usePermission()

// 权限控制
const canEdit = hasPermission('product:edit')
const canDelete = hasPermission('product:delete')
</script>
```

**关键经验**：`defineOptions` 在 `<script setup>` 中设置组件名称，对于 vue-pure-admin 的路由缓存（keep-alive）至关重要。不设置 name，页面切换时缓存失效。

## 六、ref 的 toRef 和 toRefs 区别

很多开发者分不清 `toRef` 和 `toRefs` 的用途，这在实际项目中会导致困惑：

```typescript
const state = reactive({ name: 'mike', age: 25 })

// toRef：从 reactive 对象中提取单个属性，保持响应式连接
const nameRef = toRef(state, 'name')  // Ref<string>
// 修改 nameRef.value 会同步修改 state.name，反之亦然

// toRefs：将 reactive 对象的所有属性转为 ref，保持响应式连接
const { name, age } = toRefs(state)  // { name: Ref<string>, age: Ref<number> }
// 解构后仍然与原对象保持响应式连接
```

### ⚠️ 踩坑六：toRef 的第三个参数（默认值）

```typescript
const state = reactive({ config: undefined as string | undefined })

// ❌ 危险：如果属性不存在，toRef 返回 undefined 的 Ref
const configRef = toRef(state, 'config')  // Ref<string | undefined>

// ✅ Vue 3.3+ 支持第三个参数作为默认值
const configRef = toRef(state, 'config', 'default-config')  // Ref<string>
```

### ⚠️ 踩坑七：shallowRef 与 shallowReactive 的使用时机

在处理大型数据结构时，深层响应式追踪会带来性能开销。Vue 提供了浅层响应式 API：

```typescript
// shallowRef：只追踪 .value 的变化，不追踪内部属性
const bigList = shallowRef<Data[]>([])

// ❌ 不会触发视图更新
bigList.value[0].name = 'changed'

// ✅ 必须整体替换 .value
bigList.value = bigList.value.map(item => ({ ...item, name: 'changed' }))

// shallowReactive：只追踪第一层属性
const state = shallowReactive({
  nested: { deep: { value: 1 } }
})
state.nested = { deep: { value: 2 } }  // ✅ 触发更新
state.nested.deep.value = 2             // ❌ 不触发更新
```

**实战建议**：在以下场景考虑使用 shallow 响应式：
- 列表数据量大（如 1000+ 条），且主要通过整体替换更新
- 与第三方库集成（如 ECharts、D3.js），数据由外部管理
- 性能敏感页面的大型表单或表格数据

## 七、在 uni-app 中的适配踩坑

uni-app 对 Vue 3 Composition API 的支持有部分限制：

```typescript
// ❌ uni-app 中 ref 的 toRaw 在某些平台有 bug
const form = ref({ name: '', phone: '' })

// 发送到后端时，有些平台 toRaw 不生效
uni.request({
  url: '/api/submit',
  data: toRaw(form.value)  // ⚠️ H5 正常，小程序可能不生效
})

// ✅ 安全做法：JSON 序列化
uni.request({
  url: '/api/submit',
  data: JSON.parse(JSON.stringify(form.value))  // ✅ 全平台安全
})
```

## 踩坑总结

| # | 问题 | 根因 | 解决方案 |
|---|------|------|----------|
| 1 | reactive 整体替换丢失响应式 | Proxy 引用被替换 | 用 `ref` 或 `Object.assign` |
| 2 | reactive 解构丢失响应式 | 解构出的是普通值 | 用 `toRefs()` |
| 3 | computed 中写异步 | computed 只支持同步 | 用 `watch + ref` |
| 4 | computed 依赖非响应式变量 | Vue 无法追踪 | 所有依赖都用 ref/reactive |
| 5 | watchEffect 请求竞态 | 快速变化导致数据错乱 | `onCleanup` + `AbortController` |

## 最佳实践 Checklist

- [x] 原始类型用 `ref`，复杂对象看场景
- [x] composable 函数始终返回 `ref`，不返回 `reactive`
- [x] 需要解构时用 `toRefs`，不直接解构 `reactive`
- [x] 异步数据不用 `computed`，用 `watch` + `ref`
- [x] `watchEffect` 中必须处理竞态（`onCleanup`）
- [x] 跨平台项目用 `JSON.parse(JSON.stringify())` 替代 `toRaw`

Composition API 不是银弹，但在中大型项目中，它的**逻辑复用能力**和**TypeScript 类型推导**优势远超 Options API。关键在于掌握响应式的核心机制，避免这些常见的陷阱。

## 相关阅读

- [Vue 3 + Pinia 状态管理实战-替代 Vuex 的现代方案与 B2C 电商踩坑记录](/categories/frontend/vue-3-pinia-guide-vuex-b2c/)
- [Vue 3 + TypeScript 实战-类型安全的前端开发与真实踩坑记录](/categories/frontend/vue-3-typescript-guide/)
- [Vite-Laravel-实战-前后端分离开发工作流踩坑记录](/categories/frontend/vite-laravel-guide/)
