# Vue 3 TypeScript

## 定义
Vue 3 从底层重写了 TypeScript 支持，提供完整的类型推导能力。结合 `<script setup lang="ts">` 语法，实现组件 Props、Emits、模板的全链路类型安全。

## 核心原理

### Props 类型定义
```typescript
// 基础写法
const props = defineProps<{
  title: string
  count?: number
  items: string[]
}>()

// 带默认值
const props = withDefaults(defineProps<{
  title: string
  count: number
}>(), {
  count: 0
})
```

### Emits 类型定义
```typescript
const emit = defineEmits<{
  (e: 'update', value: string): void
  (e: 'delete', id: number): void
}>()
```

### ref/reactive 类型推导
```typescript
// ref 自动推导
const count = ref(0)  // Ref<number>

// 显式泛型
const user = ref<User | null>(null)

// reactive 自动推导
const state = reactive({
  name: '',
  age: 0
})  // { name: string; age: number }
```

### 组件类型引用
```typescript
import MyComponent from './MyComponent.vue'
const compRef = ref<InstanceType<typeof MyComponent> | null>(null)
```

## 常见陷阱

### reactive 解构类型丢失
```typescript
const state = reactive({ count: 0, name: '' })
// ❌ 类型丢失
const { count, name } = state
// ✅ 使用 toRefs 保持类型
const { count, name } = toRefs(state)
```

### 模板中的类型检查
Volar 插件提供模板中的 TypeScript 类型检查，确保模板表达式类型正确。

## 实战案例
来自博客文章：
- [Vue 3 TypeScript 实战](/categories/Frontend/vue-3-typescript-guide/) - 类型安全的前端开发与真实踩坑记录

## 相关概念
- [Vue 3 Composition API](Vue3-Composition-API.md) - TypeScript 与 Composition API 深度集成
- [Pinia 状态管理](Pinia状态管理.md) - Pinia 的 TypeScript 类型推导
- [前端工具链](前端工具链.md) - TypeScript 编译配置

## 常见问题

**Q: Vue 3 必须用 TypeScript 吗？**
A: 不是必须的，但强烈推荐。TypeScript 能在编译时发现类型错误，提高代码质量。

**Q: 如何处理第三方库没有类型定义？**
A: 使用 `declare module` 手动声明，或安装 `@types/xxx` 包。
