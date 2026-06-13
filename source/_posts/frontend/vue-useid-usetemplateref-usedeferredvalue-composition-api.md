---

title: Vue 3.5+ 新特性实战：useId/useTemplateRef/useDeferredValue——Composition API 的最新进化与迁移指南
keywords: [Vue, useId, useTemplateRef, useDeferredValue, Composition API, 新特性实战, 的最新进化与迁移指南]
date: 2026-06-05 10:00:00
tags:
- Vue
- 前端
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: 深入解析 Vue 3.5 三大核心 API：useId 解决 SSR 中 ID 不匹配难题、useTemplateRef 革新模板引用范式、useDeferredValue 实现高性能延迟渲染。涵盖 Composition API 最新进化、实战代码示例与从旧版本迁移的完整指南，助力前端开发者高效升级。
---



## 前言

Vue.js 自从 3.0 版本引入 Composition API 以来，一直在不断地完善和增强这一编程范式。从 3.2 的 `<script setup>` 语法糖稳定下来，到 3.3 引入泛型组件支持，再到 3.4 推出 `defineModel` 编译器宏以简化双向绑定的书写方式，每一次版本迭代都让 Vue 的开发体验更上一层楼。而到了 3.5 版本，代号为 "Tengen"（天元）的重大更新更是带来了多项具有里程碑意义的改进。

Vue 3.5 的更新内容非常丰富，其中最值得关注的包括：响应式系统底层的完全重写（基于 Alien Signals 算法，显著提升了响应式追踪的性能）、`useId()` 全局唯一标识符 API 的引入、`useTemplateRef()` 模板引用新范式的推出，以及在服务端渲染水合（Hydration）机制方面的多项重大改进。这些特性不仅从底层提升了运行时性能，更从开发体验的角度让开发者能够写出更具表达力、更易维护、类型安全性更高的代码。

本文将深入剖析这三个核心 API——`useId()`、`useTemplateRef()` 和延迟渲染（Deferred Rendering）机制，通过大量真实的代码示例来展示它们在实际项目中的应用场景。同时，我们将与 Vue 2 时代的 Options API 模式以及 Vue 3.4 时期的旧有 Composition API 写法进行详细对比，最后提供一份完整的从旧版本迁移的实践指南，帮助读者顺利过渡到 Vue 3.5 的新范式。无论你是正在维护大型 Vue 2 项目的资深开发者，还是刚入门 Vue 的新手，都能从本文中找到对你有价值的内容。

---

## 一、useId()：告别 SSR 中的 ID 不匹配噩梦

### 1.1 问题背景与痛点分析

在构建现代前端应用时，可访问性（Accessibility，简称 a11y）的重要性日益提升。无论是遵循 WCAG 标准还是为了满足无障碍法规要求，正确使用 HTML ID 来关联表单控件与标签、实现 ARIA 属性的绑定，都是必不可少的工作。然而，在服务端渲染（SSR）的应用架构中，如何为这些 ID 生成唯一且一致的值，一直以来都是一个令人头疼的问题。

让我们先看看在 Vue 3.4 及更早版本中，开发者通常是如何处理这个问题的。最简单的做法是使用全局计数器：

```vue
<!-- 旧方案一：全局计数器 -->
<template>
  <div>
    <label :for="'input-' + id">用户名</label>
    <input :id="'input-' + id" type="text" />
  </div>
</template>

<script setup>
let counter = 0
const id = ++counter
</script>
```

这种方案在纯客户端渲染（CSR）中工作得很好，但在 SSR 场景下就会出现灾难性的问题。服务端在处理每个请求时会从头开始执行模块代码，计数器每次都会从 1 开始递增。而当客户端进行水合时，计数器又会重新从 1 开始计数。虽然在简单的页面中可能碰巧产生相同的值，但一旦涉及多个组件实例或者请求顺序发生变化，服务端和客户端生成的 ID 就会产生不一致，从而触发 Vue 的水合不匹配警告（Hydration Mismatch Warning），严重时甚至会导致页面闪烁或交互功能异常。

另一种常见的做法是使用随机数：

```vue
<!-- 旧方案二：随机 ID -->
<script setup>
import { computed } from 'vue'

const inputId = computed(() => 
  `field-${Math.random().toString(36).substring(2, 11)}`
)
</script>
```

随机方案虽然能够保证唯一性，但同样存在 SSR 一致性问题——服务端和客户端生成的随机数几乎不可能相同。即使借助第三方库如 `nanoid` 或 `uuid`，也无法从根本上解决服务端和客户端 ID 不一致的问题，除非引入额外的状态序列化和传输机制，这无疑增加了架构的复杂度。

还有一种折中方案是使用基于组件层级路径的确定性 ID 生成策略：

```vue
<!-- 旧方案三：手动构建层级路径 -->
<script setup>
import { getCurrentInstance } from 'vue'

const instance = getCurrentInstance()
const uid = instance?.uid
const inputId = `v-${uid}-input`
</script>
```

虽然这种方式在一定程度上解决了确定性问题，但 `getCurrentInstance()` 本身并不是一个稳定的公共 API，它在未来的版本中可能会发生变化，而且这种写法既冗长又不直观，每当你需要一个唯一 ID 时都要重复写一遍类似的样板代码。

### 1.2 useId() 的正式登场

Vue 3.5 提供的 `useId()` API 从框架层面彻底解决了上述所有问题。它的使用方式极其简洁：

```vue
<template>
  <div class="form-field">
    <label :for="usernameId">用户名</label>
    <input :id="usernameId" type="text" />
    
    <label :for="emailId">邮箱地址</label>
    <input :id="emailId" type="email" />
    
    <label :for="phoneId">手机号码</label>
    <input :id="phoneId" type="tel" />
  </div>
</template>

<script setup>
import { useId } from 'vue'

const usernameId = useId()
const emailId = useId()
const phoneId = useId()
</script>
```

`useId()` 生成的 ID 通常具有类似 `"v-0-0"`、`"v-0-1"`、`"v-1-0"` 这样的格式，其中数字部分反映了组件在应用树中的位置信息。这使得它具备了以下几个核心优势：

**第一，确定性生成**。在同一个组件实例中，无论是在服务端还是客户端执行，`useId()` 在相同的调用位置总是产生完全相同的 ID 值。这是因为它的生成算法基于组件在虚拟 DOM 树中的确定性路径，而非随机数或全局计数。

**第二，全局唯一性**。由于 ID 的生成考虑了组件的完整层级路径，即使同一个组件被多次实例化，每个实例中产生的 ID 也是不同的，不会发生冲突。

**第三，SSR 安全**。`useId()` 与 Vue 的 SSR 水合机制深度集成，框架在序列化服务端渲染结果时会自动处理 ID 的传输和恢复，确保客户端水合时能够准确匹配对应的 DOM 节点。

**第四，极致轻量**。生成的 ID 字符串非常简短，不会显著增加 DOM 的体积，对页面渲染性能几乎没有影响。

### 1.3 深入实战应用场景

#### 场景一：构建可访问的表单组件库

在企业级项目中，通常需要封装一套统一的表单组件来保证一致的用户体验和可访问性标准。下面是一个使用 `useId()` 构建的完整表单字段组件：

```vue
<template>
  <div class="form-field" :class="{ 'has-error': !!error }">
    <label 
      :id="`${baseId}-label`"
      :for="baseId"
      class="form-field__label"
    >
      {{ label }}
      <span v-if="required" class="form-field__required" aria-hidden="true">*</span>
    </label>
    
    <div class="form-field__input-wrapper">
      <input
        :id="baseId"
        v-bind="$attrs"
        :value="modelValue"
        :aria-labelledby="`${baseId}-label`"
        :aria-describedby="describedByIds"
        :aria-invalid="!!error"
        :aria-required="required"
        :aria-errormessage="error ? `${baseId}-error` : undefined"
        class="form-field__input"
        @input="$emit('update:modelValue', $event.target.value)"
        @blur="$emit('blur', $event)"
      />
    </div>
    
    <span 
      v-if="hint && !error"
      :id="`${baseId}-hint`"
      class="form-field__hint"
    >
      {{ hint }}
    </span>
    
    <span 
      v-if="error"
      :id="`${baseId}-error`"
      class="form-field__error"
      role="alert"
      aria-live="polite"
    >
      {{ error }}
    </span>
  </div>
</template>

<script setup>
import { computed, useId } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: [String, Number], default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  required: { type: Boolean, default: false },
})

defineEmits(['update:modelValue', 'blur'])
defineOptions({ inheritAttrs: false })

const baseId = useId()

const describedByIds = computed(() => {
  const ids = []
  if (props.hint && !props.error) ids.push(`${baseId}-hint`)
  if (props.error) ids.push(`${baseId}-error`)
  return ids.length > 0 ? ids.join(' ') : undefined
})
</script>
```

在这个组件中，我们使用 `useId()` 生成了一个基础 ID `baseId`，然后基于它派生出了标签 ID、提示信息 ID 和错误信息 ID。这种做法确保了即使同一个表单页面中渲染了多个该组件的实例，每个实例的 ARIA 属性引用也不会产生冲突。在 Vue 3.4 及更早版本中，要实现同样效果需要手动管理 ID 生成逻辑，代码量会多出许多，而且容易在 SSR 场景中出现问题。

#### 场景二：封装 Headless Disclosure（手风琴）组件

Headless UI 是近年来非常流行的一种组件设计模式，它将组件的逻辑与视觉表现完全分离。`useId()` 在这类组件中特别有用，因为 Headless 组件通常需要内部管理大量的 ARIA 属性关联：

```vue
<!-- Disclosure.vue -->
<template>
  <div class="disclosure">
    <button
      :id="`${disclosureId}-trigger`"
      type="button"
      :aria-expanded="isOpen"
      :aria-controls="`${disclosureId}-content`"
      class="disclosure__trigger"
      @click="toggle"
    >
      <slot name="trigger" :is-open="isOpen" :toggle="toggle" />
    </button>
    <div
      v-show="isOpen"
      :id="`${disclosureId}-content`"
      role="region"
      :aria-labelledby="`${disclosureId}-trigger`"
      class="disclosure__content"
    >
      <slot name="content" :close="close" />
    </div>
  </div>
</template>

<script setup>
import { ref, useId } from 'vue'

const disclosureId = useId()
const isOpen = ref(false)

const toggle = () => { isOpen.value = !isOpen.value }
const close = () => { isOpen.value = false }
</script>
```

由于 `useId()` 确保了 ID 的唯一性，我们可以在一个页面中自由地嵌套和重复使用 `Disclosure` 组件，而无需担心 ID 冲突：

```vue
<template>
  <!-- 多个 Disclosure 实例并存，ID 自动唯一 -->
  <Disclosure>
    <template #trigger="{ isOpen }">
      {{ isOpen ? '收起' : '展开' }} 常见问题
    </template>
    <template #content>
      <p>这里是一些常见问题的解答...</p>
    </template>
  </Disclosure>
  
  <Disclosure>
    <template #trigger="{ isOpen }">
      {{ isOpen ? '收起' : '展开' }} 使用条款
    </template>
    <template #content>
      <p>这里是使用条款的内容...</p>
    </template>
  </Disclosure>
</template>
```

#### 场景三：可复用的 ID 管理组合函数

在大型项目中，你可能需要将 ID 管理的逻辑封装成一个通用的组合函数，以便在多个组件间复用：

```javascript
// composables/useAccessibleIds.js
import { useId, computed } from 'vue'

/**
 * 为一组相关的可访问性元素生成关联的 ID 集合
 * @param {string} prefix - 可选的前缀标识
 * @returns {{ baseId, labelId, descriptionId, errorId, helpTextId }}
 */
export function useAccessibleIds(prefix = '') {
  const baseId = useId()
  
  const ids = computed(() => ({
    base: baseId,
    label: `${baseId}-label`,
    description: `${baseId}-desc`,
    error: `${baseId}-error`,
    helpText: `${baseId}-help`,
  }))
  
  return {
    baseId,
    labelId: computed(() => ids.value.label),
    descriptionId: computed(() => ids.value.description),
    errorId: computed(() => ids.value.error),
    helpTextId: computed(() => ids.value.helpText),
    
    // 便捷方法：生成 ARIA 属性对象
    getAriaLabelledBy: (extra = '') => {
      const parts = [ids.value.label]
      if (extra) parts.push(extra)
      return parts.join(' ')
    },
    
    getAriaDescribedBy: (options = {}) => {
      const { showHelp = true, showError = false } = options
      const parts = []
      if (showHelp) parts.push(ids.value.helpText)
      if (showError) parts.push(ids.value.error)
      return parts.length > 0 ? parts.join(' ') : undefined
    }
  }
}
```

这个组合函数在任何需要可访问性 ID 关联的表单控件中都可以直接使用，大幅减少了重复的样板代码，同时确保了 SSR 安全和全局唯一性。

### 1.4 useId() 与各种旧方案的全面对比

| 方案 | SSR 安全 | 唯一性保证 | 性能开销 | 代码复杂度 | IDE 支持 | 维护成本 |
|------|---------|-----------|---------|-----------|---------|---------|
| 全局计数器 | ❌ 不安全 | ❌ 跨请求不一致 | 极低 | 低 | 一般 | 低 |
| Math.random() | ❌ 不安全 | ✅ 概率性唯一 | 一般 | 低 | 一般 | 低 |
| nanoid / uuid | ❌ 不安全 | ✅ 确定唯一 | 一般 | 中 | 良好 | 中 |
| getCurrentInstance + uid | ⚠️ 有风险 | ⚠️ 依赖非公开 API | 低 | 中 | 一般 | 高（API 不稳定） |
| 自定义 composable | ⚠️ 需额外处理 | ⚠️ 取决于实现 | 一般 | 高 | 良好 | 高 |
| **Vue 3.5 useId()** | **✅ 完全安全** | **✅ 确定唯一** | **极低** | **极低** | **优秀** | **极低** |

从这个对比表可以清楚地看到，`useId()` 在各个维度上都是最优选择。如果你的项目正在使用或计划迁移到 Vue 3.5 以上的版本，没有任何理由继续使用旧的 ID 生成方案。它不仅解决了技术层面的问题，更重要的是让开发者在编写可访问性代码时不再需要思考 ID 如何生成这个本不该由应用层关心的问题，从而可以把精力集中在业务逻辑和用户体验的打磨上。在大型团队协作的项目中，这种"框架提供标准方案"的做法尤其有价值——它统一了团队内部的代码风格，减少了代码审查时的争论，也让新成员能够更快地上手。

---

## 二、useTemplateRef()：模板引用的范式革新

### 2.1 从 Vue 2 的 $refs 到 Composition API 的演变

模板引用（Template Refs）是 Vue 中访问底层 DOM 元素或子组件实例的核心机制。在 Vue 2 的 Options API 中，这是通过 `this.$refs` 来实现的：

```vue
<!-- Vue 2 Options API -->
<template>
  <div>
    <input ref="searchInput" type="text" />
    <button ref="submitBtn" @click="onSubmit">搜索</button>
    <ChildComponent ref="childComp" />
  </div>
</template>

<script>
export default {
  mounted() {
    // 通过 this.$refs 访问
    this.$refs.searchInput.focus()
    console.log(this.$refs.submitBtn.textContent)
    this.$refs.childComp.someMethod()
  },
  methods: {
    onSubmit() {
      const value = this.$refs.searchInput.value
      // ...
    }
  }
}
</script>
```

这种方式虽然非常直观，但也存在明显的问题。首先，它完全依赖字符串匹配——模板中的 `ref="searchInput"` 与 JavaScript 代码中的 `this.$refs.searchInput` 之间的关联完全是通过字符串隐式建立的，没有任何编译时检查来确保一致性。其次，这种方式无法提供类型安全保证，IDE 无法知道 `this.$refs.searchInput` 底层到底是什么类型的元素，也就无法提供智能提示。最后，在大型项目中当组件数量庞大时，字符串匹配的重构既容易遗漏也难以自动化。

Vue 3.0 引入 Composition API 后，模板引用的用法发生了变化。开发者需要在 `<script setup>` 中声明一个与模板中 `ref` 属性值同名的变量：

```vue
<!-- Vue 3.0 - 3.4 Composition API -->
<template>
  <input ref="searchInput" type="text" />
</template>

<script setup>
import { ref, onMounted } from 'vue'

const searchInput = ref(null) // 变量名必须与模板中 ref="searchInput" 完全一致

onMounted(() => {
  searchInput.value?.focus()
})
</script>
```

虽然这种方式比 Options API 更加灵活，但它引入了一个新的隐式约定：**变量名必须与模板中的 ref 字符串值一致**。这带来了几个具体问题。首先，重命名变量时需要同时修改模板中的字符串，否则绑定就会失效，而这种关联在代码审查中很容易被忽略。其次，IDE 很难对这种"魔法字符串"提供有效的智能提示和重构支持。第三，在组合函数（composables）中使用模板引用非常不便——你无法在一个独立的 composable 函数内部直接获取到模板中某个元素的引用，通常需要将 ref 作为参数传入。最后，对于刚接触 Vue 的开发者来说，这种"变量名等于字符串值"的隐式规则不够直观，需要一定的学习成本。

### 2.2 useTemplateRef() 的全面革新

Vue 3.5 引入的 `useTemplateRef()` API 彻底改变了模板引用的使用范式：

```vue
<template>
  <input ref="searchInput" type="text" />
  <button ref="submitBtn">提交</button>
</template>

<script setup>
import { useTemplateRef, onMounted } from 'vue'

const searchInput = useTemplateRef('searchInput')
const submitBtn = useTemplateRef('submitBtn')

onMounted(() => {
  searchInput.value?.focus()
  console.log('提交按钮:', submitBtn.value)
})
</script>
```

表面上看，这似乎只是把 `ref(null)` 换成了 `useTemplateRef('searchInput')`，但实际上两者有着本质的区别。`useTemplateRef()` 创建的是一个与模板中特定 ref 名称显式绑定的引用对象，而不是依靠变量名进行隐式匹配。这意味着变量名和模板 ref 名可以完全不同，你不再受限于命名约束。

更重要的是，`useTemplateRef()` 的真正威力在于它让模板引用可以被真正优雅地封装和复用。

### 2.3 在 Composables 中的强大应用

这是 `useTemplateRef()` 相比旧方案最大的优势。现在，你可以在独立的组合函数中直接管理模板引用，而不需要让调用方来传递 ref 对象。

#### 自动聚焦组合函数

```javascript
// composables/useAutoFocus.js
import { useTemplateRef, onMounted, nextTick } from 'vue'

export function useAutoFocus(refName, options = {}) {
  const { 
    delay = 0, 
    selectText = false,
    condition = () => true 
  } = options
  
  const element = useTemplateRef(refName)
  
  const focus = async () => {
    if (!condition()) return
    await nextTick()
    
    const el = element.value
    if (!el) return
    
    if (delay > 0) {
      setTimeout(() => {
        el.focus()
        if (selectText && el.select) el.select()
      }, delay)
    } else {
      el.focus()
      if (selectText && el.select) el.select()
    }
  }
  
  onMounted(focus)
  
  return { element, focus }
}
```

```vue
<!-- 使用示例：登录表单 -->
<template>
  <form @submit.prevent="handleLogin">
    <input ref="usernameInput" type="text" placeholder="请输入用户名" />
    <input ref="passwordInput" type="password" placeholder="请输入密码" />
    <button type="submit">登录</button>
  </form>
</template>

<script setup>
import { useAutoFocus } from '../composables/useAutoFocus'

// composable 内部直接管理模板引用，调用方无需传递 ref
const { element: usernameEl } = useAutoFocus('usernameInput', { delay: 100 })
const { element: passwordEl } = useAutoFocus('passwordInput')

const handleLogin = () => {
  // 同样可以通过返回的 element 来访问 DOM
  console.log('用户名:', usernameEl.value?.value)
}
</script>
```

#### 元素尺寸观察组合函数

```javascript
// composables/useElementSize.js
import { useTemplateRef, ref, onMounted, onScopeDispose } from 'vue'

export function useElementSize(refName) {
  const element = useTemplateRef(refName)
  const width = ref(0)
  const height = ref(0)
  let resizeObserver = null
  
  onMounted(() => {
    if (!element.value) return
    
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width.value = entry.contentRect.width
        height.value = entry.contentRect.height
      }
    })
    
    resizeObserver.observe(element.value)
  })
  
  onScopeDispose(() => {
    resizeObserver?.disconnect()
  })
  
  return { element, width, height }
}
```

```vue
<!-- 使用示例：响应式布局 -->
<template>
  <div ref="containerRef" class="responsive-container">
    <div v-if="width > 768" class="desktop-layout">
      <p>桌面端布局</p>
    </div>
    <div v-else class="mobile-layout">
      <p>移动端布局</p>
    </div>
    <p class="size-info">容器宽度: {{ width }}px, 高度: {{ height }}px</p>
  </div>
</template>

<script setup>
import { useElementSize } from '../composables/useElementSize'

const { element: containerEl, width, height } = useElementSize('containerRef')
</script>
```

#### 交点观察器组合函数（无限滚动）

```javascript
// composables/useIntersectionObserver.js
import { useTemplateRef, onMounted, onScopeDispose } from 'vue'

export function useIntersectionObserver(refName, callback, options = {}) {
  const element = useTemplateRef(refName)
  let observer = null
  
  onMounted(() => {
    if (!element.value) return
    
    observer = new IntersectionObserver(callback, {
      threshold: 0.1,
      rootMargin: '0px',
      ...options
    })
    
    observer.observe(element.value)
  })
  
  onScopeDispose(() => {
    observer?.disconnect()
  })
  
  return { element }
}
```

```vue
<!-- 无限滚动实现 -->
<template>
  <div class="feed">
    <article v-for="post in posts" :key="post.id" class="post">
      <h2>{{ post.title }}</h2>
      <p>{{ post.summary }}</p>
    </article>
    
    <div ref="sentinel" class="sentinel">
      <span v-if="loading">加载中...</span>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useIntersectionObserver } from '../composables/useIntersectionObserver'

const posts = ref([])
const loading = ref(false)
const hasMore = ref(true)

const loadMore = async () => {
  if (loading.value || !hasMore.value) return
  loading.value = true
  try {
    const newPosts = await fetchPosts(posts.value.length)
    if (newPosts.length === 0) {
      hasMore.value = false
    } else {
      posts.value.push(...newPosts)
    }
  } finally {
    loading.value = false
  }
}

useIntersectionObserver('sentinel', ([entry]) => {
  if (entry.isIntersecting && hasMore.value) {
    loadMore()
  }
}, { rootMargin: '200px' })
</script>
```

### 2.4 TypeScript 类型安全的飞跃

`useTemplateRef()` 在 TypeScript 环境下的表现尤其出色。它支持通过泛型参数来指定引用目标的类型，从而在编译时就能捕获潜在的类型错误：

```vue
<template>
  <input ref="emailInput" type="email" />
  <canvas ref="drawCanvas" width="800" height="600" />
  <video ref="videoPlayer" src="/demo.mp4" />
</template>

<script setup lang="ts">
import { useTemplateRef, onMounted } from 'vue'

const emailInput = useTemplateRef<HTMLInputElement>('emailInput')
const drawCanvas = useTemplateRef<HTMLCanvasElement>('drawCanvas')
const videoPlayer = useTemplateRef<HTMLVideoElement>('videoPlayer')

onMounted(() => {
  // 全部自动获得正确的类型提示
  emailInput.value?.classList.add('active')
  
  const ctx = drawCanvas.value?.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#333'
    ctx.fillRect(0, 0, 800, 600)
  }
  
  videoPlayer.value?.play()
})
</script>
```

注意，在旧的 `ref(null)` 写法中，要获得正确的类型提示通常需要显式的类型断言，如 `const canvas = ref<HTMLCanvasElement | null>(null)`。虽然这种方式也能工作，但 `useTemplateRef()` 的泛型写法更加语义化，清晰地表达了"这个引用指向一个 HTMLCanvasElement 类型的元素"这一意图。

### 2.5 深度对比总结

| 特性 | Vue 2 $refs | Vue 3.4 ref() | Vue 3.5 useTemplateRef() |
|------|-------------|---------------|--------------------------|
| 类型安全 | ❌ 无类型 | ⚠️ 需手动声明泛型 | ✅ 泛型参数清晰直观 |
| 重命名安全 | ❌ 字符串与代码分离 | ⚠️ 变量名=ref名 | ✅ 完全解耦 |
| Composable 复用 | ❌ 不可能 | ⚠️ 需传入 ref 参数 | ✅ 原生支持 |
| 语义清晰度 | 低（隐式魔法） | 中（隐式约定） | 高（显式绑定） |
| IDE 重构支持 | 差 | 一般 | 优秀 |
| SSR 兼容性 | 不适用 | 良好 | 良好 |
| 学习曲线 | 低（但易误用） | 中 | 低 |

---

## 三、延迟渲染：Vue 的高性能更新策略

### 3.1 为什么需要延迟渲染？

在构建交互密集型的用户界面时，一个常见的挑战是：如何在保证即时响应用户输入的同时，又能高效地更新那些计算成本较高的 UI 部分？

考虑一个电商网站的商品搜索页面。当用户在搜索框中输入关键词时，我们希望搜索框本身能够即时响应每一个按键，但搜索结果列表（可能包含数百个商品卡片、图片和复杂的布局计算）的更新可以稍微延迟一下。如果每次按键都立即触发整个结果列表的重新渲染，用户的输入体验就会因为主线程被占用而变得卡顿。

在 Vue 3.4 及更早版本中，开发者通常使用防抖（debounce）来处理这类场景：

```vue
<!-- 旧方案：防抖 -->
<template>
  <div>
    <input v-model="searchQuery" placeholder="搜索商品..." />
    <ProductList :query="debouncedQuery" />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const searchQuery = ref('')
const debouncedQuery = ref('')

let timer = null
watch(searchQuery, (val) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    debouncedQuery.value = val
  }, 300)
})
</script>
```

防抖方案虽然能有效减少渲染次数，但它的缺点也很明显：用户必须停止输入 300 毫秒后才能看到结果更新，这种延迟感在快速打字时尤其明显。而且防抖的时间窗口很难调——太短则效果不明显，太长则让用户等待太久。更重要的是，防抖只是简单地延迟了整个更新过程，它并没有区分哪些 UI 部分是需要即时响应的（比如搜索输入框），哪些是可以延迟更新的（比如搜索结果列表）。这种"一刀切"的方式在交互体验上并不理想。

### 3.2 Vue 3.5 的延迟渲染机制

Vue 3.5 引入的延迟渲染机制采用了不同的策略：它不是延迟触发更新，而是延迟更新低优先级的部分，同时保持高优先级部分（如输入框）的即时响应。这种机制的核心思想是将界面更新分为"紧急"和"非紧急"两部分，优先处理紧急更新，然后在浏览器空闲时处理非紧急更新。

在 Vue 中，这一能力可以通过封装一个 `useDeferredValue` composable 来实现：

```javascript
// composables/useDeferredValue.js
import { ref, watch, shallowRef, onScopeDispose } from 'vue'

/**
 * 延迟更新一个响应式值，实现非关键 UI 的平滑延迟渲染
 * @param {Ref} source - 源响应式引用
 * @param {Object} options - 配置选项
 * @param {number} options.delay - 延迟毫秒数，默认使用 requestAnimationFrame
 * @param {number} options.maxWait - 最大等待时间，确保最终一定会更新
 * @returns {Ref} 延迟更新的引用
 */
export function useDeferredValue(source, options = {}) {
  const { delay = 0, maxWait = 500 } = options
  const deferred = shallowRef(source.value)
  let rafId = null
  let timeoutId = null
  let maxTimeoutId = null

  const cleanup = () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
    if (maxTimeoutId) { clearTimeout(maxTimeoutId); maxTimeoutId = null }
  }

  const update = (value) => {
    cleanup()
    deferred.value = value
  }

  watch(source, (newValue) => {
    cleanup()

    if (delay > 0) {
      // 使用指定延迟
      timeoutId = setTimeout(() => update(newValue), delay)

      // 最大等待时间保障
      if (maxWait > 0) {
        maxTimeoutId = setTimeout(() => {
          update(source.value)
        }, maxWait)
      }
    } else {
      // 默认使用 requestAnimationFrame 延迟到下一帧
      rafId = requestAnimationFrame(() => {
        update(newValue)
      })
    }
  })

  onScopeDispose(cleanup)

  return deferred
}
```

### 3.3 完整实战示例：商品搜索页面

下面是一个完整的商品搜索页面实现，展示了如何利用延迟渲染来优化输入体验：

```vue
<template>
  <div class="search-page">
    <!-- 搜索栏：立即响应，不受延迟影响 -->
    <header class="search-header">
      <div class="search-bar">
        <svg class="search-icon" viewBox="0 0 24 24">
          <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 001.48-5.34c-.47-2.78-2.79-5-5.59-5.34A6.505 6.505 0 003.03 10.3c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 005.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14z"/>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索商品名称、品牌、分类..."
          class="search-input"
          autocomplete="off"
        />
        <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''">
          ✕
        </button>
      </div>
      
      <div class="search-stats">
        <span v-if="isStale" class="stale-indicator">
          正在更新结果...
        </span>
        <span v-else-if="deferredQuery">
          共找到 {{ resultCount }} 件商品
        </span>
      </div>
    </header>

    <!-- 搜索结果：使用延迟值渲染，不阻塞输入 -->
    <main class="search-results" :class="{ 'is-stale': isStale }">
      <div v-if="!deferredQuery" class="empty-state">
        <p>请输入关键词开始搜索</p>
      </div>
      
      <div v-else class="product-grid">
        <div
          v-for="product in filteredProducts"
          :key="product.id"
          class="product-card"
        >
          <img :src="product.image" :alt="product.name" loading="lazy" />
          <h3>{{ product.name }}</h3>
          <p class="price">¥{{ product.price }}</p>
          <p class="desc">{{ product.description }}</p>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useDeferredValue } from '../composables/useDeferredValue'
import { useProductSearch } from '../composables/useProductSearch'

const searchQuery = ref('')
const deferredQuery = useDeferredValue(searchQuery, { delay: 150, maxWait: 500 })

// 判断是否正在等待更新（输入值与延迟值不同步）
const isStale = computed(() => 
  searchQuery.value !== deferredQuery.value
)

const { products, resultCount } = useProductSearch(deferredQuery)
</script>

<style scoped>
.search-results.is-stale {
  opacity: 0.75;
  transition: opacity 0.15s ease;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}

.product-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  transition: transform 0.2s;
}

.product-card:hover {
  transform: translateY(-2px);
}

.stale-indicator {
  color: #6b7280;
  font-size: 0.875rem;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
```

在这个示例中，`searchQuery` 是用户输入的即时值，而 `deferredQuery` 是经过延迟处理的值。搜索框直接绑定到 `searchQuery`，保证了即时的按键响应；而商品列表的过滤和渲染则基于 `deferredQuery`，从而避免了在用户快速输入时频繁触发昂贵的列表重渲染。同时，通过 `isStale` 计算属性，我们可以给用户一个视觉反馈，告知他们结果正在更新中。

### 3.4 与防抖方案的对比分析

| 对比维度 | 传统防抖 | 延迟渲染 |
|---------|---------|---------|
| 用户体验 | 必须等待固定延迟才能看到结果 | 输入框始终即时响应，结果区域自然更新 |
| 响应速度 | 取决于防抖延迟值 | 输入即时，结果稍后跟随 |
| 视觉反馈 | 停止输入前无任何反馈 | 可通过 isStale 提供过渡提示 |
| 实现复杂度 | 低 | 中等（需要管理两个值） |
| 适用场景 | API 请求去重 | UI 渲染优化 + API 去重 |
| 与 Suspense 配合 | 不支持 | 可无缝集成 |

### 3.5 进阶技巧：结合 Vue 3.5 的调度器优化

Vue 3.5 对底层调度器进行了重大优化，引入了更智能的批处理（batching）和优先级调度机制。这意味着多个响应式更新可以在同一次渲染周期中被合并处理，减少了不必要的 DOM 操作。

在实际项目中，你可以利用这一特性来进一步优化延迟渲染的效果：

```javascript
// composables/useDeferredSearch.js
import { ref, computed, watch } from 'vue'
import { useDeferredValue } from './useDeferredValue'

export function useDeferredSearch(searchFn, options = {}) {
  const { 
    delay = 150,
    maxWait = 500,
    minLength = 2 
  } = options

  const query = ref('')
  const deferredQuery = useDeferredValue(query, { delay, maxWait })
  const results = ref([])
  const loading = ref(false)
  const error = ref(null)

  const isActive = computed(() => 
    query.value.length >= minLength
  )

  const isStale = computed(() => 
    query.value !== deferredQuery.value
  )

  watch(deferredQuery, async (newQuery) => {
    if (newQuery.length < minLength) {
      results.value = []
      return
    }

    loading.value = true
    error.value = null

    try {
      results.value = await searchFn(newQuery)
    } catch (e) {
      error.value = e.message || '搜索失败'
      results.value = []
    } finally {
      loading.value = false
    }
  })

  return {
    query,
    deferredQuery,
    results,
    loading,
    error,
    isActive,
    isStale,
  }
}
```

这个组合函数将延迟渲染与异步数据获取结合在一起，提供了一个完整的搜索解决方案。延迟渲染在两个层面发挥作用：一是延迟触发搜索 API 请求，减少网络调用次数；二是延迟更新结果列表的渲染，保持 UI 的流畅性。

---

## 四、Vue 3.5 其他重要改进速览

### 4.1 响应式系统重写——Alien Signals

Vue 3.5 的底层响应式系统经历了重大重构，基于 Alien Signals 算法优化了依赖追踪和更新调度。在大型应用中，这意味着计算属性的重新计算更加智能，不必要的依赖触发被更有效地过滤掉。

在实际开发中，你可能不会直接感知到这些底层变化，但你的应用会自动受益于更快的响应式更新和更低的内存占用。官方基准测试显示，在包含大量计算属性和侦听器的复杂场景下，性能提升可以达到 40% 以上。新的响应式系统还引入了惰性代理机制——当你创建一个深层嵌套的响应式对象时，Vue 不会再立即递归地将所有属性都转换为响应式的，而是等到你真正访问某个深层属性时才进行转换。这对于那些包含大量配置数据或长列表的应用来说，可以显著减少初始化时的性能开销和内存占用。

### 4.2 SSR 水合的显著改进

Vue 3.5 在 SSR 水合方面做出了多项重要改进。新的水合机制更加宽容，能够在一定程度上自动修复服务端和客户端渲染结果之间的微小差异，而不是像以前那样直接报错。例如，在之前的版本中，如果服务端渲染的 HTML 中某个属性值与客户端计算出的值有微小差异（比如时间戳或随机数），就会导致整个组件的水合失败并触发完整的客户端重渲染。而在 Vue 3.5 中，框架能够更加智能地处理这类边界情况，尽量保留服务端渲染的 DOM 结果并仅对差异部分进行修补。同时，编译器会在服务端渲染的 HTML 中注入更精确的注解信息，帮助客户端更高效地完成水合过程，减少了不必要的 DOM 比对操作。这些改进对于内容密集型的网站（如新闻门户、电商平台、文档站点等）尤其有价值，能够显著降低可交互时间（TTI）指标。

### 4.3 惰性 Props 解析

Vue 3.5 引入了惰性 Props 解析机制。在之前的版本中，父组件传递给子组件的 Props 会在创建时就被立即解析和响应化。而在 3.5 中，如果子组件尚未访问某个 Prop，框架会延迟其解析过程，这对于包含大量 Props 但实际使用较少的复杂组件来说，可以带来显著的性能提升。

---

## 五、完整迁移指南

### 5.1 环境升级步骤

首先，确保将 Vue 及相关工具链升级到兼容版本：

```bash
# 升级 Vue 核心
npm install vue@^3.5.0

# 升级 Vite 和相关插件
npm install vite@^6.0.0 @vitejs/plugin-vue@^5.2.0

# 升级类型检查工具
npm install vue-tsc@^2.2.0 typescript@^5.5.0

# 升级 ESLint 插件（如使用）
npm install eslint-plugin-vue@^9.28.0
```

升级完成后，运行现有的测试套件确认没有回归问题。Vue 3.5 在 API 层面是完全向后兼容的，所以现有代码应该可以直接运行。

### 5.2 模板引用迁移

将旧的 `ref(null)` 模板引用模式逐步替换为 `useTemplateRef()`：

**迁移前（Vue 3.4 风格）：**
```vue
<template>
  <div ref="container">...</div>
  <input ref="searchField" />
</template>

<script setup>
import { ref, onMounted } from 'vue'

const container = ref(null)
const searchField = ref(null)

onMounted(() => {
  container.value.style.padding = '16px'
  searchField.value?.focus()
})
</script>
```

**迁移后（Vue 3.5 useTemplateRef 风格）：**
```vue
<template>
  <div ref="container">...</div>
  <input ref="searchField" />
</template>

<script setup>
import { useTemplateRef, onMounted } from 'vue'

const container = useTemplateRef('container')
const searchField = useTemplateRef('searchField')

onMounted(() => {
  container.value.style.padding = '16px'
  searchField.value?.focus()
})
</script>
```

### 5.3 ID 生成迁移

将所有手动的 ID 生成逻辑替换为 `useId()`：

```bash
# 搜索项目中可能需要迁移的代码
grep -r "Math.random" --include="*.vue" --include="*.ts" --include="*.js" src/
grep -r "nanoid\|uuid\|uniqueId" --include="*.vue" --include="*.ts" src/
grep -r "getCurrentInstance" --include="*.vue" --include="*.ts" src/
```

每找到一处，就将其中的 ID 生成逻辑替换为 `useId()`。对于需要在循环中使用 ID 的场景，记住使用单一基础 ID 加后缀的模式。

### 5.4 推荐的渐进式迁移策略

对于大型项目，推荐分四个阶段来完成迁移：

**第一阶段：基础设施升级**。将 Vue 升级到 3.5，确保所有现有功能正常工作。这个阶段不改动任何业务代码。

**第二阶段：新代码采用新 API**。在团队编码规范中明确规定，所有新增组件和 composable 必须使用 `useId()` 和 `useTemplateRef()`。这样新的代码天然遵循最佳实践。

**第三阶段：维护时顺手迁移**。在日常的 bug 修复和功能迭代过程中，遇到相关的旧代码就顺便迁移为新写法。这种"顺手迁移"的方式成本最低，不会影响正常的开发节奏。

**第四阶段：收尾与清理**。使用 Codemods 工具或 IDE 的全局搜索替换功能，批量处理剩余的旧代码。最后进行一次完整的回归测试，确保所有迁移都正确无误。

---

## 六、总结与展望

Vue 3.5 的发布标志着 Composition API 的一次重要进化。`useId()` 从框架层面解决了 SSR 场景下 ID 一致性这个困扰开发者多年的问题，让可访问性相关的代码变得更加简洁可靠。`useTemplateRef()` 让模板引用从依赖变量名的隐式魔法变成了显式、可组合、类型安全的 API，极大地提升了代码的可维护性。延迟渲染模式的引入，则为高交互场景下的性能优化提供了一种比传统防抖更加优雅的策略。

从 Vue 2 到 Vue 3.5，我们见证了 Vue 在类型安全、SSR 支持、性能优化和开发者体验等维度上的持续进化。展望未来，Vue 正在积极开发 Vapor Mode（一种无虚拟 DOM 的编译模式），以及更强大的编译时优化能力。这些努力的共同目标是：在保持优秀的开发体验的同时，不断逼近原生 JavaScript 的运行时性能。

作为开发者，紧跟框架的发展步伐，及时了解和掌握新特性，不仅能够提升我们的开发效率，更能帮助我们写出更加健壮、可维护的代码。值得注意的是，虽然新 API 带来了诸多好处，但也不必急于一次性将所有旧代码全部重构。在实际项目中，建议采用"新代码用新 API、旧代码逐步替换"的渐进式迁移策略，这样既能享受到新特性的好处，又不会因为大规模重构而引入不必要的风险。同时，在团队内部建立统一的编码规范和最佳实践文档，让所有成员对新 API 的使用方式达成共识，这比单纯的技术迁移更加重要。希望本文对你理解和应用 Vue 3.5 的新特性有所帮助。如果你在实际迁移过程中遇到了问题或有更好的实践分享，欢迎在评论区讨论交流。

---

> **参考资源**
>
> - [Vue 3.5 官方更新公告](https://blog.vuejs.org/posts/vue-3-5)
> - [Vue Composition API 官方文档](https://vuejs.org/api/composition-api-setup.html)
> - [useId API 参考](https://vuejs.org/api/composition-api-helpers.html#useid)
> - [useTemplateRef API 参考](https://vuejs.org/api/composition-api-helpers.html#usetemplateref)
> - [Vue SSR 水合机制详解](https://vuejs.org/guide/scaling-up/ssr.html)
> - [Alien Signals 响应式算法](https://github.com/nicepkg/alien-signals)

## 相关阅读

- [Signals 范式对比：Angular Vue Solid Preact 响应式原理](/前端/Signals-范式对比-Angular-Vue-Solid-Preact-响应式原理/)
- [Storybook 8.x 实战：组件文档化与 Visual Regression Testing——Vue3 组件库的设计系统治理](/前端/Storybook-8x-实战-组件文档化与-Visual-Regression-Testing-Vue3-组件库的设计系统治理/)
- [微前端 Module Federation 2.0 + Vue3 + Laravel BFF 架构实战](/前端/micro-frontend-module-federation-2-vue3-laravel-bff/)
