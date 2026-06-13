---

title: CSS Container Queries + View Transitions 实战：响应式设计的范式转变——Vue 3 组件级适配与页面过渡动画
keywords: [CSS Container Queries, View Transitions, Vue, 响应式设计的范式转变, 组件级适配与页面过渡动画]
date: 2026-06-05 15:17:02
tags:
- CSS
- Container Queries
- View Transitions
- Vue
- 响应式
- 前端
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: 深入解析 CSS Container Queries 与 View Transitions API 两大浏览器原生能力，告别 Media Queries 组件级适配痛点与 JS 动画库依赖。结合 Vue 3 Composition API 实现组件级响应式布局与页面丝滑过渡动画，含 container-type/@container 语法、View Transitions 生命周期、Vue Router 集成踩坑与性能对比，助你掌握响应式设计范式转变的核心技术。
---



在前端开发的历史长河中，响应式设计一直是绕不开的核心议题。从 Ethan Marcotte 在 2010 年提出 Responsive Web Design 概念以来，`@media` 查询几乎成为我们处理多端适配的唯一武器。但随着组件化架构（Component-based Architecture）的全面普及，一个根本性的矛盾逐渐浮出水面：**组件需要根据自身容器的尺寸来调整布局，而非依赖视口（Viewport）的大小。**

与此同时，页面之间的过渡动画长期依赖 JavaScript 动画库（如 GSAP、Framer Motion），不仅增加了包体积，还面临性能瓶颈。浏览器原生的 View Transitions API 终于为这个问题提供了标准化解决方案。

本文将深入探讨 CSS Container Queries 和 View Transitions API 这两项颠覆性技术，并结合 Vue 3 Composition API 展示它们在实际项目中的集成方式。

<!-- more -->

## 一、为什么需要 Container Queries？

### 1.1 Media Queries 的局限性

传统的 `@media` 查询基于视口宽度来决定样式，这在页面级别布局中运作良好，但在组件级别却暴露出根本性的缺陷：

```css
/* 传统方式：组件必须"知道"它在页面中的位置 */
@media (min-width: 768px) {
  .card { display: flex; }
}
```

问题在于：同一个 `<Card />` 组件可能出现在主内容区（宽 900px）、侧边栏（宽 300px）或者弹窗（宽 500px）中。使用 `@media` 查询时，组件无法感知自己实际可用的空间，开发者不得不通过添加额外的 CSS class（如 `card--sidebar`、card--compact`）来手动处理不同场景，这严重违背了组件封装的原则。

### 1.2 Container Queries 的范式转变

Container Queries 的核心思想是：**让元素根据其父容器的尺寸而非视口尺寸来响应式调整样式。** 这意味着组件真正实现了"自适应"——无论把它放在哪里，它都能根据可用空间自动选择最合适的布局。

```css
/* 容器声明 */
.card-wrapper {
  container-type: inline-size;
  container-name: card-container;
}

/* 组件根据容器宽度自适应 */
@container card-container (min-width: 400px) {
  .card {
    display: flex;
    flex-direction: row;
  }
  .card__image {
    width: 200px;
    aspect-ratio: 1;
  }
}

@container card-container (max-width: 399px) {
  .card {
    display: flex;
    flex-direction: column;
  }
  .card__image {
    width: 100%;
    aspect-ratio: 16 / 9;
  }
}
```

## 二、Container Queries 核心语法

### 2.1 container-type 属性

`container-type` 定义了容器的查询类型，是整个机制的基石：

```css
/* 仅在行内方向（通常是水平方向）上建立查询容器 */
.sidebar {
  container-type: inline-size;
}

/* 同时在行内和块方向上建立查询容器 */
.canvas-container {
  container-type: size;
}

/* 使用 style query（实验性） */
.theme-container {
  container-type: inline-size style;
}
```

| 值 | 说明 | 使用场景 |
|---|---|---|
| `inline-size` | 仅追踪行内尺寸 | 最常用，适用于绝大多数布局 |
| `size` | 追踪行内和块方向尺寸 | 需要同时响应宽度和高度变化 |
| `style` | 追踪计算样式值 | 实验性，用于条件样式 |

**关键注意事项：** 设置 `container-type: inline-size` 的元素不能同时作为其他容器查询的被查询目标，这会创建一个"查询循环"，浏览器会忽略该查询。

### 2.2 container-name 命名

当页面中存在多个嵌套容器时，命名容器可以精确控制查询目标：

```css
.layout {
  container-type: inline-size;
  container-name: layout;
}

.sidebar {
  container-type: inline-size;
  container-name: sidebar;
}

.card-wrapper {
  container-type: inline-size;
  container-name: card;
}

/* 明确指定查询哪个容器 */
@container sidebar (max-width: 300px) {
  .card { padding: 8px; }
}

@container layout (min-width: 1200px) {
  .sidebar { position: sticky; top: 80px; }
}
```

### 2.3 简写语法 container

```css
/* 简写：container-name / container-type */
.card-wrapper {
  container: card / inline-size;
}
```

### 2.4 Container Query Units

Container Queries 还引入了一组容器查询单位，类似于视口单位但基于容器尺寸：

```css
@container card (min-width: 400px) {
  .card__title {
    /* cqi = 容器行内尺寸的 1% */
    font-size: clamp(1rem, 3cqi, 2rem);
    padding: 2cqi;
  }
}
```

| 单位 | 含义 |
|---|---|
| `cqw` | 容器宽度的 1% |
| `cqh` | 容器高度的 1% |
| `cqi` | 容器行内尺寸的 1% |
| `cqb` | 容器块尺寸的 1% |
| `cqmin` | cqi 和 cqb 中较小值 |
| `cqmax` | cqi 和 cqb 中较大值 |

## 三、Container Queries vs Media Queries

两者并非替代关系，而是互补关系：

```css
/* Media Queries：处理全局布局结构 */
@media (max-width: 768px) {
  .app-layout {
    grid-template-columns: 1fr;
  }
}

/* Container Queries：处理组件内部适配 */
@container sidebar (max-width: 280px) {
  .nav-item__label { display: none; }
  .nav-item__icon { margin: 0; }
}
```

**使用原则：**
- **Media Queries** → 页面级布局切换（侧边栏收起、导航模式变化）
- **Container Queries** → 组件级内容适配（文字大小、图片比例、布局方向）
- **两者结合** → 构建真正"可移植"的组件系统

## 四、Vue 3 集成 Container Queries

### 4.1 基础集成：在 SFC 中使用

Container Queries 本质上是纯 CSS 特性，在 Vue SFC 的 `<style>` 块中直接使用即可：

```vue
<script setup lang="ts">
interface CardProps {
  title: string
  description: string
  imageUrl: string
  tags?: string[]
}

defineProps<CardProps>()
</script>

<template>
  <div class="card-wrapper">
    <article class="card">
      <div class="card__media">
        <img :src="imageUrl" :alt="title" loading="lazy" />
      </div>
      <div class="card__content">
        <h3 class="card__title">{{ title }}</h3>
        <p class="card__description">{{ description }}</p>
        <div v-if="tags?.length" class="card__tags">
          <span v-for="tag in tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.card-wrapper {
  container: card / inline-size;
}

.card {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface-color, #fff);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.card__media img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
}

.card__content {
  padding: 16px;
}

.card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.tag {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--primary-light, #e8f5e9);
  color: var(--primary-dark, #2e7d32);
}

/* 宽容器：水平布局 */
@container card (min-width: 480px) {
  .card {
    flex-direction: row;
  }
  .card__media {
    flex: 0 0 240px;
  }
  .card__media img {
    aspect-ratio: 1;
    height: 100%;
  }
  .card__content {
    padding: 24px;
  }
}

/* 超宽容器：更大字体和更多间距 */
@container card (min-width: 640px) {
  .card__title {
    font-size: 1.5rem;
  }
  .card__content {
    padding: 32px;
  }
}
</style>
```

### 4.2 响应式 Composable 配合

在某些场景下，JS 也需要知道容器尺寸（例如决定渲染策略），我们可以创建一个 `useContainerSize` composable：

```typescript
// composables/useContainerSize.ts
import { ref, onMounted, onUnmounted, type Ref } from 'vue'

export function useContainerSize(
  target: Ref<HTMLElement | undefined>,
  options?: ResizeObserverOptions
) {
  const width = ref(0)
  const height = ref(0)
  const breakpoint = ref<'compact' | 'medium' | 'wide'>('compact')

  let observer: ResizeObserver | null = null

  const updateBreakpoint = (w: number) => {
    if (w >= 640) breakpoint.value = 'wide'
    else if (w >= 400) breakpoint.value = 'medium'
    else breakpoint.value = 'compact'
  }

  onMounted(() => {
    if (!target.value) return
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { inlineSize, blockSize } = entry.contentBoxSize[0]
        width.value = inlineSize
        height.value = blockSize
        updateBreakpoint(inlineSize)
      }
    })
    observer.observe(target.value, options)
  })

  onUnmounted(() => {
    observer?.disconnect()
  })

  return { width, height, breakpoint }
}
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useContainerSize } from '@/composables/useContainerSize'

const wrapperRef = ref<HTMLElement>()
const { breakpoint } = useContainerSize(wrapperRef)
</script>

<template>
  <div ref="wrapperRef" class="chart-container">
    <!-- 紧凑模式下简化图表，宽模式下展示完整图表 -->
    <CompactChart v-if="breakpoint === 'compact'" />
    <FullChart v-else :show-legend="breakpoint === 'wide'" />
  </div>
</template>
```

### 4.3 构建通用响应式容器组件

```vue
<!-- ResponsiveContainer.vue -->
<script setup lang="ts">
import { ref, provide, readonly } from 'vue'

const containerRef = ref<HTMLElement>()
const containerWidth = ref(0)

const resizeObserver = new ResizeObserver(([entry]) => {
  containerWidth.value = entry.contentBoxSize[0].inlineSize
})

import { onMounted, onUnmounted } from 'vue'

onMounted(() => {
  if (containerRef.value) resizeObserver.observe(containerRef.value)
})
onUnmounted(() => resizeObserver.disconnect())

provide('containerWidth', readonly(containerWidth))
</script>

<template>
  <div ref="containerRef" class="responsive-container">
    <slot :width="containerWidth" />
  </div>
</template>

<style scoped>
.responsive-container {
  container-type: inline-size;
}
</style>
```

## 五、View Transitions API

### 5.1 概述与核心概念

View Transitions API 是浏览器原生提供的页面/视图过渡方案。它通过在 DOM 更新前截取快照（Snapshot），更新 DOM 后再截取快照，然后自动创建从旧状态到新状态的动画。

```css
/* 基础启用 */
@view-transition {
  navigation: auto;
}

/* 为参与过渡的元素命名 */
.hero-image {
  view-transition-name: hero;
}

.page-title {
  view-transition-name: title;
}
```

### 5.2 自定义过渡动画

View Transitions 通过一组 `::view-transition` 伪元素来控制动画：

```css
/* 过渡动画容器 */
::view-transition {
  position: fixed;
  inset: 0;
}

/* 所有过渡快照的基础样式 */
::view-transition-group(*) {
  animation-duration: 0.4s;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

/* 旧视图淡出 */
::view-transition-old(*) {
  animation: fade-out 0.3s ease-out forwards;
}

/* 新视图淡入 */
::view-transition-new(*) {
  animation: fade-in 0.3s ease-in forwards;
}

/* 针对特定元素的过渡 */
::view-transition-old(hero) {
  animation: slide-out-left 0.4s ease-in-out;
}

::view-transition-new(hero) {
  animation: slide-in-right 0.4s ease-in-out;
}

::view-transition-group(hero) {
  animation-duration: 0.5s;
}

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slide-out-left {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-30px); opacity: 0; }
}

@keyframes slide-in-right {
  from { transform: translateX(30px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
```

### 5.3 Cross-Document View Transitions（MPA 场景）

对于多页应用（MPA），可以通过 HTTP Header 或 meta 标签启用跨文档过渡：

```html
<meta name="view-transition" content="same-origin">
```

```css
/* MPA 场景下的过渡配置 */
@view-transition {
  navigation: auto;
}

::view-transition-old(root) {
  animation: fade-out 0.25s ease-out;
}

::view-transition-new(root) {
  animation: fade-in 0.25s ease-in;
}
```

## 六、Vue 3 + View Transitions 实战

### 6.1 配合 Vue Router 使用

在 SPA 中，`document.startViewTransition()` 是核心 API。我们可以创建一个简洁的 composable 来集成 Vue Router：

```typescript
// composables/useViewTransition.ts
import { ref, nextTick } from 'vue'

export function useViewTransition() {
  const isTransitioning = ref(false)

  /**
   * 使用 View Transition 执行 DOM 更新
   * @param updateCallback - 执行实际 DOM 更新的回调
   */
  async function startTransition(updateCallback: () => Promise<void> | void) {
    // 检查浏览器支持
    if (!document.startViewTransition) {
      await updateCallback()
      return
    }

    isTransitioning.value = true
    const transition = document.startViewTransition(async () => {
      await updateCallback()
      await nextTick()
    })

    try {
      await transition.finished
    } finally {
      isTransitioning.value = false
    }
  }

  return { isTransitioning, startTransition }
}
```

### 6.2 全局路由过渡集成

```typescript
// router/guards.ts
import type { Router } from 'vue-router'

export function setupViewTransitions(router: Router) {
  router.beforeResolve(async (to, from) => {
    // 自定义过渡类型（可选）
    const transitionType = to.meta.transition as string || 'fade'
    document.documentElement.dataset.transition = transitionType
  })

  router.afterEach(async (to, from) => {
    if (!document.startViewTransition) return

    // 由于 Vue Router 是异步的，我们需要在导航完成后再启动过渡
    // 实际上，更推荐在路由组件内手动控制
  })
}
```

更好的做法是在 App.vue 中直接拦截路由变化：

```vue
<!-- App.vue -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const route = useRoute()
const router = useRouter()

// 使用原生过渡
router.beforeResolve(async (to, from) => {
  if (to.meta.transition === false) return

  if (!document.startViewTransition) return

  // 阻止默认导航，让 View Transition API 接管
  const transition = document.startViewTransition(async () => {
    // 导航已经在进行中，这里不需要额外操作
  })

  // 通过 CSS 变量控制过渡类型
  const type = (to.meta.transition as string) || 'slide'
  document.documentElement.style.setProperty('--transition-type', type)
})

const routeKey = ref(route.fullPath)
watch(() => route.fullPath, (newPath) => {
  routeKey.value = newPath
})
</script>

<template>
  <router-view v-slot="{ Component, route: currentRoute }">
    <Transition :name="currentRoute.meta.transition as string || 'fade'" mode="out-in">
      <component :is="Component" :key="currentRoute.fullPath" />
    </Transition>
  </router-view>
</template>

<style>
/* 全局过渡样式 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.slide-enter-from {
  transform: translateX(20px);
  opacity: 0;
}
.slide-leave-to {
  transform: translateX(-20px);
  opacity: 0;
}
</style>
```

### 6.3 精细化控制：用 startViewTransition 包裹状态更新

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useViewTransition } from '@/composables/useViewTransition'

const { startTransition } = useViewTransition()
const currentView = ref<'list' | 'grid'>('list')
const items = ref(generateItems(50))

function toggleView() {
  startTransition(() => {
    currentView.value = currentView.value === 'list' ? 'grid' : 'list'
  })
}
</script>

<template>
  <div class="toolbar">
    <button @click="toggleView">
      {{ currentView === 'list' ? '网格视图' : '列表视图' }}
    </button>
  </div>

  <Transition mode="out-in" name="view-switch">
    <div
      v-if="currentView === 'list'"
      key="list"
      class="item-list"
    >
      <ItemCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :style="{ viewTransitionName: `item-${item.id}` }"
      />
    </div>

    <div
      v-else
      key="grid"
      class="item-grid"
    >
      <ItemCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :style="{ viewTransitionName: `item-${item.id}` }"
      />
    </div>
  </Transition>
</template>

<style>
.item-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

/* View Transition 动画 */
::view-transition-group(*) {
  animation-duration: 0.35s;
  animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

::view-transition-old(*) {
  animation: fade-out 0.2s ease-out;
}

::view-transition-new(*) {
  animation: fade-in 0.2s ease-in;
}
</style>
```

## 七、实战模式

### 7.1 自适应产品卡片组件

这是一个结合 Container Queries 的完整产品卡片，展示不同容器宽度下的多种布局：

```vue
<script setup lang="ts">
import { computed } from 'vue'

interface Product {
  id: string
  name: string
  price: number
  originalPrice?: number
  imageUrl: string
  rating: number
  reviewCount: number
}

const props = defineProps<{ product: Product }>()

const discount = computed(() => {
  if (!props.product.originalPrice) return 0
  return Math.round(
    (1 - props.product.price / props.product.originalPrice) * 100
  )
})

const formattedPrice = computed(() =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY'
  }).format(props.product.price)
)
</script>

<template>
  <div class="product-card-wrapper">
    <article class="product-card">
      <div class="product-card__badge" v-if="discount > 0">
        -{{ discount }}%
      </div>
      <div class="product-card__image">
        <img :src="product.imageUrl" :alt="product.name" loading="lazy" />
      </div>
      <div class="product-card__info">
        <h3 class="product-card__name">{{ product.name }}</h3>
        <div class="product-card__rating">
          <span class="stars">{{ '★'.repeat(Math.round(product.rating)) }}{{ '☆'.repeat(5 - Math.round(product.rating)) }}</span>
          <span class="review-count">({{ product.reviewCount }})</span>
        </div>
        <div class="product-card__pricing">
          <span class="price">{{ formattedPrice }}</span>
          <del v-if="product.originalPrice" class="original-price">
            ¥{{ product.originalPrice }}
          </del>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.product-card-wrapper {
  container: product / inline-size;
}

.product-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: var(--card-bg, #fff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s;
}

.product-card:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.product-card__badge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #ef4444;
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  z-index: 1;
}

.product-card__image img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.product-card__info {
  padding: 12px;
}

.product-card__name {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-card__rating {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 0.75rem;
  color: #f59e0b;
}

.review-count {
  color: #9ca3af;
}

.product-card__pricing {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
}

.price {
  font-size: 1rem;
  font-weight: 700;
  color: #ef4444;
}

.original-price {
  font-size: 0.75rem;
  color: #9ca3af;
}

/* ---- 紧凑模式（侧边栏等窄容器 < 200px）---- */
@container product (max-width: 199px) {
  .product-card__image img {
    aspect-ratio: 1;
  }
  .product-card__info {
    padding: 8px;
  }
  .product-card__name {
    font-size: 0.75rem;
    -webkit-line-clamp: 1;
  }
  .product-card__rating {
    display: none;
  }
  .price {
    font-size: 0.875rem;
  }
}

/* ---- 中等模式（200px - 400px）---- */
@container product (min-width: 200px) and (max-width: 400px) {
  .product-card__image img {
    aspect-ratio: 4 / 3;
  }
}

/* ---- 宽模式（> 400px）：水平布局 ---- */
@container product (min-width: 400px) {
  .product-card {
    display: flex;
    flex-direction: row;
  }
  .product-card__image {
    flex: 0 0 200px;
  }
  .product-card__image img {
    aspect-ratio: 1;
    height: 100%;
  }
  .product-card__info {
    flex: 1;
    padding: 20px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .product-card__name {
    font-size: 1.125rem;
    -webkit-line-clamp: 3;
  }
}
</style>
```

### 7.2 页面过渡动画系统

创建一个完整的页面过渡管理器：

```typescript
// composables/usePageTransition.ts
import { ref, onMounted, onUnmounted } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'

type TransitionDirection = 'forward' | 'backward' | 'none'

const routeHistory: string[] = []

export function usePageTransition() {
  const direction = ref<TransitionDirection>('none')
  const isSupported = typeof document !== 'undefined' && 'startViewTransition' in document

  function getDirection(to: RouteLocationNormalized, from: RouteLocationNormalized): TransitionDirection {
    const toDepth = to.path.split('/').filter(Boolean).length
    const fromDepth = from.path.split('/').filter(Boolean).length

    if (toDepth > fromDepth) return 'forward'
    if (toDepth < fromDepth) return 'backward'

    // 同级路由：比较在历史中的位置
    const toIndex = routeHistory.indexOf(to.path)
    const fromIndex = routeHistory.indexOf(from.path)
    if (toIndex !== -1 && toIndex < fromIndex) return 'backward'

    return 'forward'
  }

  function pushHistory(path: string) {
    const existingIndex = routeHistory.indexOf(path)
    if (existingIndex !== -1) {
      routeHistory.splice(existingIndex + 1)
    } else {
      routeHistory.push(path)
    }
  }

  function executeTransition(
    updateCallback: () => Promise<void> | void,
    transitionName: string = 'page-slide'
  ): Promise<void> {
    return new Promise((resolve) => {
      if (!isSupported) {
        updateCallback().then(resolve)
        return
      }

      document.startViewTransition(async () => {
        await updateCallback()
      }).finished.then(resolve)
    })
  }

  return {
    direction,
    isSupported,
    getDirection,
    pushHistory,
    executeTransition
  }
}
```

```vue
<!-- components/PageTransition.vue -->
<script setup lang="ts">
import { watch, provide, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePageTransition } from '@/composables/usePageTransition'

const router = useRouter()
const route = useRoute()
const { direction, getDirection, pushHistory, executeTransition } = usePageTransition()
const transitionName = ref('page-slide-forward')

router.beforeEach(async (to, from) => {
  direction.value = getDirection(to, from)
  transitionName.value = `page-slide-${direction.value}`

  if (to.meta.noTransition) return

  // 使用 View Transition API 处理过渡
  if ('startViewTransition' in document) {
    return new Promise<void>((resolve) => {
      document.startViewTransition(async () => {
        resolve()
        await new Promise((r) => watch(() => route.fullPath, r, { once: true }))
      })
    })
  }
})

router.afterEach((to) => {
  pushHistory(to.path)
})

provide('pageDirection', direction)
</script>

<template>
  <router-view v-slot="{ Component, route: currentRoute }">
    <Transition :name="currentRoute.meta.noTransition ? '' : transitionName" mode="out-in">
      <Suspense>
        <component :is="Component" :key="currentRoute.fullPath" />
        <template #fallback>
          <div class="page-loading">
            <div class="spinner" />
          </div>
        </template>
      </Suspense>
    </Transition>
  </router-view>
</template>

<style>
.page-slide-forward-enter-active,
.page-slide-forward-leave-active,
.page-slide-backward-enter-active,
.page-slide-backward-leave-active {
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s ease;
}

.page-slide-forward-enter-from {
  transform: translateX(30px);
  opacity: 0;
}
.page-slide-forward-leave-to {
  transform: translateX(-30px);
  opacity: 0;
}

.page-slide-backward-enter-from {
  transform: translateX(-30px);
  opacity: 0;
}
.page-slide-backward-leave-to {
  transform: translateX(30px);
  opacity: 0;
}

/* View Transition 原生动画 */
::view-transition-old(root) {
  animation: vt-fade-out 0.25s ease-out;
}
::view-transition-new(root) {
  animation: vt-fade-in 0.25s ease-in;
}

@keyframes vt-fade-out {
  to { opacity: 0; transform: scale(0.95); }
}
@keyframes vt-fade-in {
  from { opacity: 0; transform: scale(0.95); }
}

.page-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
```

### 7.3 Skeleton 骨架屏 + Container Queries

```vue
<script setup lang="ts">
interface SkeletonProps {
  lines?: number
  avatar?: boolean
  image?: boolean
}

withDefaults(defineProps<SkeletonProps>(), {
  lines: 3,
  avatar: false,
  image: false
})
</script>

<template>
  <div class="skeleton-wrapper">
    <div class="skeleton-card">
      <div v-if="image" class="skeleton-image skeleton-pulse" />
      <div class="skeleton-body">
        <div v-if="avatar" class="skeleton-avatar skeleton-pulse" />
        <div class="skeleton-content">
          <div class="skeleton-line skeleton-line--title skeleton-pulse" />
          <div
            v-for="i in lines"
            :key="i"
            class="skeleton-line skeleton-pulse"
            :style="{ width: i === lines ? '60%' : '100%' }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-wrapper {
  container: skeleton / inline-size;
}

.skeleton-pulse {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: pulse 1.5s ease-in-out infinite;
  border-radius: 6px;
}

@keyframes pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-card {
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.skeleton-image {
  width: 100%;
  aspect-ratio: 16 / 9;
}

.skeleton-body {
  padding: 16px;
  display: flex;
  gap: 12px;
}

.skeleton-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  flex-shrink: 0;
}

.skeleton-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 14px;
}

.skeleton-line--title {
  height: 20px;
  width: 40%;
}

/* 宽容器下调整骨架屏布局 */
@container skeleton (min-width: 480px) {
  .skeleton-card {
    display: flex;
    flex-direction: row;
  }
  .skeleton-image {
    width: 240px;
    aspect-ratio: 1;
    flex-shrink: 0;
  }
  .skeleton-avatar {
    width: 56px;
    height: 56px;
  }
  .skeleton-body {
    flex: 1;
    padding: 24px;
  }
}

/* 超窄容器下简化 */
@container skeleton (max-width: 200px) {
  .skeleton-avatar {
    display: none;
  }
  .skeleton-body {
    padding: 12px;
  }
  .skeleton-line {
    height: 12px;
  }
}
</style>
```

## 八、浏览器兼容性与降级策略

### 8.1 兼容性现状（2026 年）

| 特性 | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|
| Container Queries | ✅ 105+ | ✅ 110+ | ✅ 16+ | ✅ 105+ |
| @container 简写 | ✅ 111+ | ✅ 110+ | ✅ 16+ | ✅ 111+ |
| Container Query Units | ✅ 105+ | ✅ 110+ | ✅ 17+ | ✅ 105+ |
| View Transitions (SPA) | ✅ 111+ | ✅ 128+ | ✅ 18+ | ✅ 111+ |
| View Transitions (MPA) | ✅ 126+ | ❌ | ❌ | ✅ 126+ |

### 8.2 Container Queries 降级方案

```css
/* Progressive Enhancement 策略 */

/* 基础样式：移动优先，不依赖任何查询 */
.card {
  display: flex;
  flex-direction: column;
  padding: 16px;
}

/* 降级：使用 Media Queries 作为后备 */
@media (min-width: 768px) {
  .card {
    flex-direction: row;
  }
}

/* 增强：支持 Container Queries 的浏览器会使用更精确的规则 */
@container card-container (min-width: 400px) {
  .card {
    flex-direction: row;
  }
}

@container card-container (max-width: 399px) {
  .card {
    flex-direction: column;
  }
}
```

使用 `@supports` 做精确检测：

```css
/* 给容器查询容器添加额外样式 */
@supports (container-type: inline-size) {
  .card-wrapper {
    container: card / inline-size;
  }
}

/* 不支持时的后备策略 */
@supports not (container-type: inline-size) {
  .card-wrapper {
    /* 使用 data 属性驱动 JS 补丁 */
  }
}
```

```typescript
// JavaScript 层面的检测与降级
export const supportsContainerQueries = CSS.supports('container-type', 'inline-size')
export const supportsViewTransitions = 'startViewTransition' in document

// View Transitions 降级：使用 CSS Transition
if (!supportsViewTransitions) {
  // 自动降级到 Vue 的 <Transition> 组件
  document.documentElement.classList.add('no-view-transitions')
}
```

## 九、性能考量

### 9.1 Container Queries 性能

Container Queries 底层依赖 ResizeObserver，浏览器对其进行了高度优化。但仍需注意：

```css
/* 避免：不必要的 size 类型容器 */
/* container-type: size 会同时在两个维度建立尺寸追踪 */
.deeply-nested {
  /* 如果只需要宽度响应，使用 inline-size */
  container-type: inline-size;  /* ✅ 推荐 */
  /* container-type: size; */   /* ⚠️ 仅在需要高度查询时使用 */
}
```

**最佳实践：**
- 仅在真正需要响应式调整的元素上设置 `container-type`
- 优先使用 `inline-size` 而非 `size`
- 避免过深的容器嵌套层级
- Container Queries 的重排性能与 Media Queries 持平

### 9.2 View Transitions 性能

View Transitions 利用浏览器的 Snapshot 机制，性能远优于 JavaScript 动画：

```css
/* 最佳性能：使用 transform 和 opacity */
::view-transition-group(hero) {
  /* 浏览器会自动提升到合成层 */
  animation-duration: 0.4s;
}

/* 避免触发 layout 的属性 */
::view-transition-new(hero) {
  /* ✅ 使用 transform */
  animation: slide-in 0.4s ease;
}

@keyframes slide-in {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
  /* ❌ 避免 width, height, top, left 等触发重排的属性 */
}
```

### 9.3 结合使用时的性能注意

```typescript
// 避免在快速连续的路由切换中创建过多过渡
let activeTransition: ViewTransition | null = null

async function safeStartTransition(callback: () => Promise<void>) {
  // 如果上一个过渡还在进行，等待它完成
  if (activeTransition) {
    await activeTransition.finished
  }

  if (!document.startViewTransition) {
    await callback()
    return
  }

  activeTransition = document.startViewTransition(callback)
  activeTransition.finished.then(() => {
    activeTransition = null
  })
}
```

## 十、总结

Container Queries 和 View Transitions API 代表了 CSS 能力的一次质的飞跃：

**Container Queries 的价值：**
- 组件真正实现"一次编写，到处自适应"
- 消除了 Media Queries 在组件级别的局限
- 配合 Vue 3 Composition API，可以构建高度可移植的组件库
- CSS Container Query Units 使得流式排版在组件级别成为可能

**View Transitions API 的价值：**
- 浏览器原生动画，性能卓越
- 与 Vue Router 的集成简洁自然
- CSS 自定义属性控制过渡类型，灵活可扩展
- MPA 场景同样适用，统一了 SPA 和 MPA 的过渡体验

**实践建议：**
1. **渐进采用**：先在新组件中使用 Container Queries，逐步替换 Media Queries 中的组件级断点
2. **统一命名**：建立容器命名规范（如 `c-product`、`c-sidebar`），避免命名冲突
3. **View Transitions 降级策略**：始终提供 Vue `<Transition>` 作为后备
4. **性能监控**：在生产环境中追踪过渡动画的帧率，确保 60fps 的流畅体验

这两项技术的组合，让我们终于能够构建出真正的"自适应组件"——它们不再依赖外部环境，而是根据自身可用空间做出最优的布局决策，同时提供丝滑的视觉过渡体验。这不仅仅是技术的进步，更是响应式设计范式的根本转变。

---

**参考资料：**
- [CSS Containment Module Level 3 - W3C](https://www.w3.org/TR/css-contain-3/)
- [View Transitions API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)
- [Vue Router Navigation Guards](https://router.vuejs.org/guide/advanced/navigation-guards.html)
- [Container Queries - Chrome for Developers](https://developer.chrome.com/docs/css-ui/css-container-queries)

## 相关阅读

- [Signals 范式对比：Angular Signals vs Vue Reactivity vs Solid Reactivity vs Preact Signals——响应式底层原理深度剖析](/categories/前端/2026-06-05-Signals-范式对比-Angular-Vue-Solid-Preact-响应式原理/)
- [Vue 3.5+ 新特性实战：useId/useTemplateRef/useDeferredValue——Composition API 的最新进化与迁移指南](/categories/前端/Vue-3.5-新特性实战-useId-useTemplateRef-useDeferredValue-Composition-API最新进化与迁移指南/)
- [Vue 3 Composition API 实战：ref/reactive/computed 最佳实践与响应式踩坑记录](/categories/Frontend/vue-3-composition-api-guide-ref-reactive-computed-best-practices/)
- [Tailwind CSS v4 引擎重写：性能飞跃与 Livewire 集成实战](/categories/Frontend/2026-06-02-tailwind-css-v4-engine-rewrite-performance-livewire-integration/)
