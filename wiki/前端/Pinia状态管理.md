# Pinia 状态管理

## 定义
Pinia 是 Vue 官方推荐的状态管理库，用于替代 Vuex。它提供了一种简洁、类型安全的方式来管理 Vue 应用中的全局状态，原生支持 Composition API 和 TypeScript。

## 核心原理

### 与 Vuex 对比

| 维度 | Vuex 4 | Pinia |
|------|--------|-------|
| TypeScript 支持 | 需手动声明模块类型 | 原生类型推导，零配置 |
| Mutations | 必须 `commit('MUTATION', payload)` | 直接赋值 `this.count++` |
| 模块嵌套 | `modules: { namespaced: true }` | `useUserStore()` 扁平调用 |
| 体积 | ~10KB gzip | ~1.5KB gzip |
| SSR | 需额外配置 | 内置支持 |
| DevTools | 完整支持 | 原生 Vue DevTools |

### Store 定义方式

**Options API 风格：**
```typescript
export const useUserStore = defineStore('user', {
  state: () => ({ name: '', token: '' }),
  getters: {
    isLoggedIn: (state) => !!state.token
  },
  actions: {
    async login(credentials) {
      this.token = await api.login(credentials)
    }
  }
})
```

**Composition API 风格：**
```typescript
export const useUserStore = defineStore('user', () => {
  const name = ref('')
  const token = ref('')
  const isLoggedIn = computed(() => !!token.value)
  
  async function login(credentials) {
    token.value = await api.login(credentials)
  }
  
  return { name, token, isLoggedIn, login }
})
```

### 持久化
使用 `pinia-plugin-persistedstate` 实现状态持久化：
```typescript
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
pinia.use(piniaPluginPersistedstate)
```

## 常见陷阱

### Store 解构丢失响应式
```typescript
// ❌ 解构丢失响应式
const { name } = useUserStore()

// ✅ 使用 storeToRefs
const { name } = storeToRefs(useUserStore())
// ✅ actions 直接解构
const { login } = useUserStore()
```

### 跨 Store 访问
```typescript
export const useOrderStore = defineStore('order', () => {
  const userStore = useUserStore()  // 在函数内部调用
  const myOrders = computed(() => api.getOrders(userStore.token))
})
```

## 实战案例
来自博客文章：
- [Vue 3 + Pinia 状态管理实战](/categories/Frontend/vue-3-pinia-guide-vuex-b2c/) - 从 Vuex 迁移到 Pinia，B2C 电商踩坑记录

## 相关概念
- [Vue 3 Composition API](Vue3-Composition-API.md) - Pinia 的 Composition API 风格基于此
- [Vue 3 TypeScript](Vue3-TypeScript.md) - Pinia 的类型推导
- [Nuxt 4 全栈框架](Nuxt4全栈框架.md) - Nuxt 中的 Pinia SSR 集成

## 常见问题

**Q: Pinia 能完全替代 Vuex 吗？**
A: 是的。Pinia 是 Vue 官方推荐的下一代状态管理方案，API 更简洁，功能更强大。

**Q: 小项目需要 Pinia 吗？**
A: 如果状态简单，`provide/inject` 或 `reactive` 全局对象即可。当需要 DevTools 调试、持久化、SSR 时，Pinia 有价值。
