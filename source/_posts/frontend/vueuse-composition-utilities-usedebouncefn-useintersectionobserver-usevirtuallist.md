---

title: VueUse 实战：200+ Composition Utilities 最佳实践——useDebounceFn/useIntersectionObserver/useVirtualList
keywords: [VueUse, Composition Utilities, useDebounceFn, useIntersectionObserver, useVirtualList, 最佳实践]
date: 2026-06-06 13:08:25
tags:
- Vue
- 前端工具库
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: 深入解析 VueUse 200+ Composition API 工具函数的最佳实践。涵盖 useDebounceFn 防抖搜索、useIntersectionObserver 图片懒加载与曝光埋点、useVirtualList 万级数据虚拟滚动、useStorage 响应式本地存储、useDark 暗黑模式等高频场景，提供完整可运行代码示例与手写方案对比，帮助 Vue3 开发者大幅提升开发效率，避免常见踩坑。
---




## 前言

在 Vue 3 的 Composition API 时代，开发者们享受到了更好的逻辑复用和代码组织能力。然而，当我们需要处理浏览器事件监听、本地存储、DOM 交互、性能优化等常见场景时，往往需要编写大量重复的样板代码。这些代码不仅繁琐，还容易引入内存泄漏、事件监听未清理等隐蔽的 Bug。

VueUse 的出现彻底改变了这一现状——它提供了 200 多个精心设计的 Composition Utilities，让我们能够以声明式的方式处理各种前端常见需求。每个工具函数都经过了严格的测试、完善的 TypeScript 类型支持、以及对 SSR 和跨浏览器兼容性的周全考虑。

本文将深入探讨 VueUse 中高频使用的工具函数，结合真实项目中的典型场景和可运行的代码示例，帮助你全面掌握这些工具的最佳实践，让你的 Vue 3 项目开发效率翻倍。

---

## 一、简介与安装

### 1.1 什么是 VueUse

VueUse 是一个基于 Composition API 的实用工具集合库，由 Vue 核心团队成员 Anthony Fu 创建和维护。它是 Vue 生态系统中 Star 数增长最快的项目之一，目前在 GitHub 上已经超过两万颗星。VueUse 的核心价值在于：

- **零依赖**：核心模块不依赖任何第三方库，不会增加额外的包体积负担
- **Tree-shakable**：完全支持按需引入，未使用的函数不会被打包进最终产物
- **TypeScript 原生支持**：提供完善的类型定义和泛型推断，开发体验极佳
- **跨平台兼容**：同时支持 Vue 2 和 Vue 3，兼容 SSR、Nuxt、VitePress 等多种环境
- **活跃的社区**：每周都有新工具函数被贡献，文档维护及时且详尽

### 1.2 安装与引入

在你的 Vue 3 项目中安装 VueUse 非常简单：

```bash
# 使用 pnpm（推荐，速度最快且磁盘占用最小）
pnpm add @vueuse/core

# 使用 npm
npm install @vueuse/core

# 使用 yarn
yarn add @vueuse/core
```

安装完成后，推荐使用按需引入的方式，这样打包工具可以自动进行 Tree-shaking，只打包你实际使用的函数：

```typescript
// 推荐：按需引入，享受 Tree-shaking 带来的体积优化
import { useDebounceFn, useIntersectionObserver, useStorage } from '@vueuse/core'

// 不推荐：全量引入会增加打包体积，即使部分函数未被使用也会被包含
import * as VueUse from '@vueuse/core'
```

如果你使用的是 Nuxt 3，VueUse 还提供了专门的 Nuxt 模块，支持自动引入：

```bash
pnpm add -D @vueuse/nuxt
```

然后在 `nuxt.config.ts` 中配置即可：

```typescript
export default defineNuxtConfig({
  modules: ['@vueuse/nuxt'],
})
```

配置完成后，所有 VueUse 的函数都可以在模板和脚本中直接使用，无需手动 import。

---

## 二、核心设计理念

### 2.1 组合式思维与响应式返回值

VueUse 的每个函数都严格遵循 Vue 3 Composition API 的设计范式，返回值始终是响应式的 Ref 或包含 Ref 的对象，可以无缝融入 Vue 的响应式系统：

```typescript
// 返回对象，包含多个响应式属性
const { x, y } = useMouse()         // 鼠标坐标，自动跟踪鼠标移动
const { width, height } = useWindowSize() // 窗口尺寸，自动响应 resize

// 返回单个响应式值
const isOnline = useOnline()         // 网络状态，自动监听变化

// 返回数组，包含状态和操作函数
const [value, toggle] = useToggle()  // 切换状态的通用工具
```

### 2.2 自动生命周期管理

VueUse 内部自动处理生命周期管理，这是它相比手动实现最大的优势之一。组件卸载时会自动清理所有的事件监听器、定时器和副作用，开发者完全不需要担心内存泄漏的问题：

```typescript
// 无需手动 addEventListener / removeEventListener
// VueUse 在组件挂载时自动添加，在卸载时自动移除
useEventListener('scroll', () => {
  console.log('页面滚动了')
})

// 无需在 onUnmounted 中手动调用 stop
const { stop } = useIntersectionObserver(target, ([entry]) => {
  if (entry?.isIntersecting) {
    loadData()
  }
})
```

### 2.3 统一的参数传递模式

VueUse 的工具函数遵循统一且直观的参数设计模式，降低了学习成本：

```typescript
// 通用模式：目标元素 + 回调 + 配置选项
useIntersectionObserver(
  target,              // 第一个参数：目标元素（支持 Ref、Getter 或原生 DOM 元素）
  callback,            // 第二个参数：回调函数
  { threshold: 0.5 }   // 第三个参数：可选的配置对象
)

// 目标元素参数非常灵活
useEventListener(window, 'resize', handler)      // 传入 window 对象
useEventListener(document, 'click', handler)      // 传入 document 对象
useEventListener(myRef, 'click', handler)         // 传入 Ref
useEventListener('#my-element', 'click', handler) // 传入 CSS 选择器字符串
```

---

## 三、高频工具详解

### 3.1 useDebounceFn —— 防抖函数

**使用场景**：搜索框输入联想、表单实时验证、窗口 resize 回调、按钮防重复点击等需要限制函数执行频率的场景。防抖的核心思想是：在事件触发后等待指定时间，如果期间再次触发则重新计时，只有真正停顿后才执行函数。

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'

const searchQuery = ref('')
const searchResults = ref([])
const isSearching = ref(false)

// 防抖搜索：用户停止输入 300ms 后才真正发起搜索请求
// 这样用户快速输入"hello"时不会触发 5 次请求，而是只触发 1 次
const debouncedSearch = useDebounceFn(async (query: string) => {
  if (!query.trim()) {
    searchResults.value = []
    return
  }

  isSearching.value = true
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
    searchResults.value = await response.json()
  } catch (error) {
    console.error('搜索请求失败:', error)
  } finally {
    isSearching.value = false
  }
}, 300)

// 监听输入框内容变化，触发防抖搜索
watch(searchQuery, (newQuery) => {
  debouncedSearch(newQuery)
})
</script>

<template>
  <div class="search-box">
    <input v-model="searchQuery" placeholder="输入搜索关键词..." />
    <span v-if="isSearching">搜索中...</span>
    <ul>
      <li v-for="item in searchResults" :key="item.id">{{ item.title }}</li>
    </ul>
  </div>
</template>
```

**注意事项**：

- 防抖延迟时间需要根据具体业务场景调整。搜索建议通常设置为 200 到 300 毫秒，按钮防重复提交通常设置为 500 到 1000 毫秒
- `useDebounceFn` 返回的函数不会在组件卸载时被自动清理，因为它本身不涉及全局事件监听这类副作用，只是一个包装后的普通函数
- 如果你需要对一个响应式 Ref 的值做防抖处理，可以直接使用 `useDebounce` 工具，它会返回一个新的防抖后的 Ref
- 在组件被卸载后，防抖函数如果还未执行，建议通过标志位避免执行已过期的回调

### 3.2 useThrottleFn —— 节流函数

**使用场景**：滚动事件监听、鼠标移动追踪、实时位置更新、游戏输入处理等高频连续触发事件的处理。节流的核心思想是：在指定时间间隔内，无论事件触发多少次，函数只执行一次。

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useThrottleFn } from '@vueuse/core'

const scrollPosition = ref(0)
const isNavbarVisible = ref(true)
let lastScrollTop = 0

// 节流处理滚动事件：每 200ms 最多执行一次回调
// 即使用户快速滚动，每秒也只会执行 5 次，大大减轻计算压力
const throttledScrollHandler = useThrottleFn((event: Event) => {
  const target = event.target as HTMLElement
  const currentScrollTop = target.scrollTop

  // 根据滚动方向决定导航栏的显示与隐藏
  if (currentScrollTop > lastScrollTop && currentScrollTop > 100) {
    isNavbarVisible.value = false  // 向下滚动超过 100px 时隐藏导航栏
  } else {
    isNavbarVisible.value = true   // 向上滚动时显示导航栏
  }

  scrollPosition.value = currentScrollTop
  lastScrollTop = currentScrollTop
}, 200)
</script>

<template>
  <div>
    <nav v-show="isNavbarVisible" class="navbar">
      导航栏 - 当前位置: {{ scrollPosition }}px
    </nav>
    <div class="scroll-container" @scroll="throttledScrollHandler">
      <div class="long-content">
        <!-- 足够长的内容以产生滚动 -->
        <p v-for="i in 200" :key="i">这是第 {{ i }} 段内容</p>
      </div>
    </div>
  </div>
</template>
```

**注意事项**：

- 节流和防抖有本质区别：节流是固定时间间隔内保证至少执行一次，防抖是等待事件停止后才执行一次
- 滚动事件、拖拽事件、鼠标移动等连续性事件推荐使用节流
- 搜索输入、表单验证等需要等待用户操作完成后才响应的场景推荐使用防抖
- 节流函数可以配合 `leading` 和 `trailing` 选项控制首次和末次是否执行
- 可以搭配 VueUse 的 `useScroll` 工具进一步简化滚动状态管理

### 3.3 useIntersectionObserver —— 元素可见性检测

**使用场景**：图片懒加载、无限滚动加载、元素曝光埋点统计、广告可见性检测、滚动触发动画等。这是前端性能优化和数据统计中最常用的工具之一。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'

const bannerRef = ref<HTMLElement | null>(null)
const isVisible = ref(false)
let hasTracked = false

// 当 Banner 元素有 50% 进入视口时触发回调
// rootMargin 设置负值可以延迟触发，确保元素真正可见
const { stop } = useIntersectionObserver(
  bannerRef,
  ([entry]) => {
    isVisible.value = entry?.isIntersecting ?? false

    // 曝光埋点：只在元素首次可见时上报，避免重复统计
    if (entry?.isIntersecting && !hasTracked) {
      hasTracked = true
      trackBannerExposure('summer_sale_banner')
    }
  },
  {
    threshold: 0.5,                     // 50% 可见时触发
    rootMargin: '0px 0px -100px 0px',   // 底部提前 100px 才触发，确保元素真正进入可视区域
  }
)

function trackBannerExposure(bannerId: string) {
  console.log(`埋点上报：Banner ${bannerId} 已曝光`)
  // 实际项目中这里会调用埋点 SDK 发送数据
}
</script>

<template>
  <div ref="bannerRef" :class="['banner', { 'banner--visible': isVisible }]">
    <img
      v-if="isVisible"
      src="https://example.com/banner.jpg"
      alt="促销活动"
      loading="lazy"
    />
    <div v-else class="banner-placeholder">加载中...</div>
  </div>
</template>
```

**注意事项**：

- `threshold` 参数控制触发时机：值为 0 表示元素刚进入视口边界就触发，值为 1 表示元素完全进入视口才触发。也可以传入数组如 `[0, 0.25, 0.5, 0.75, 1]` 来在多个比例点都触发
- `rootMargin` 的用法与 CSS 的 margin 相同，正值表示扩大观察区域，负值表示缩小。可以用它实现预加载或延迟加载的效果
- 调用返回的 `stop()` 函数可以手动停止观察，适用于只需要触发一次的场景（比如曝光埋点只上报一次）
- 兼容性方面，VueUse 内部会自动处理旧浏览器的降级方案，但非常老的浏览器可能需要 polyfill

### 3.4 useVirtualList —— 虚拟列表

**使用场景**：大数据量列表渲染（数千乃至数万条数据）、聊天记录展示、实时日志流、商品列表等需要高性能滚动的场景。虚拟列表的核心原理是只渲染可视区域内的 DOM 元素，将数万个 DOM 节点降低到几十个，从而大幅提升渲染性能和内存占用。

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useVirtualList } from '@vueuse/core'

// 模拟 10000 条数据
const allItems = Array.from({ length: 10000 }, (_, i) => ({
  id: i + 1,
  title: `商品名称 ${i + 1}`,
  price: (Math.random() * 1000).toFixed(2),
  description: `这是第 ${i + 1} 个商品的详细描述信息，包含商品的各种属性和规格参数。`,
}))

const filterKeyword = ref('')
const filteredItems = computed(() => {
  if (!filterKeyword.value) return allItems
  return allItems.filter((item) =>
    item.title.includes(filterKeyword.value)
  )
})

// 配置虚拟列表：每项高度 80px，上下各预渲染 10 项
const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(
  filteredItems,
  {
    itemHeight: 80,    // 每项固定高度，必须准确设置
    overscan: 10,      // 预渲染项数，防止快速滚动时出现白屏
  }
)

function handleItemClick(item: { id: number; title: string }) {
  console.log('点击了商品:', item.title)
}

function scrollToTop() {
  scrollTo(0)
}
</script>

<template>
  <div class="virtual-list-demo">
    <div class="toolbar">
      <input v-model="filterKeyword" placeholder="搜索商品..." />
      <button @click="scrollToTop">回到顶部</button>
      <span>共 {{ filteredItems.length }} 件商品</span>
    </div>

    <div v-bind="containerProps" class="list-container">
      <div v-bind="wrapperProps">
        <div
          v-for="item in list"
          :key="item.data.id"
          class="list-item"
          @click="handleItemClick(item.data)"
        >
          <h4>{{ item.data.title }}</h4>
          <p class="price">¥{{ item.data.price }}</p>
          <p class="desc">{{ item.data.description }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-container {
  height: 600px;
  overflow: auto;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.list-item {
  height: 80px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background-color 0.2s;
}

.list-item:hover {
  background-color: #f5f7fa;
}

.price {
  color: #e4393c;
  font-weight: bold;
}

.desc {
  color: #999;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

**注意事项**：

- `itemHeight` 必须与实际渲染的每项高度保持一致，否则会导致滚动位置计算错误，出现跳动或白屏
- `overscan` 配置上下预渲染的项数，建议设置为 5 到 15 项。值太小会在快速滚动时出现白屏，值太大则会影响性能
- 如果列表项的高度不固定，需要使用动态高度的虚拟列表方案，VueUse 目前主要支持固定高度的场景
- 数据源变化时（比如筛选后），VueUse 会自动重新计算列表布局
- 可以配合 `scrollTo` 方法实现跳转到指定位置的功能

### 3.5 useStorage —— 响应式本地存储

**使用场景**：用户偏好设置持久化、表单草稿自动保存、主题或语言切换记忆、购物车数据缓存等。`useStorage` 将 `localStorage` 或 `sessionStorage` 变成了响应式数据源，修改自动同步，刷新自动恢复。

```vue
<script setup lang="ts">
import { useStorage } from '@vueuse/core'

// 基本用法：声明一个自动持久化的响应式变量
// 初始值为 'light'，之后用户的每次修改都会自动保存到 localStorage
const theme = useStorage('app-theme', 'light')

// 数字类型
const fontSize = useStorage('app-font-size', 16)

// 对象类型：VueUse 会自动处理 JSON 序列化和反序列化
const userSettings = useStorage('user-settings', {
  language: 'zh-CN',
  notifications: true,
  autoSave: true,
  sidebarCollapsed: false,
})

// 数组类型
const recentSearches = useStorage<string[]>('recent-searches', [])

function addSearchTerm(term: string) {
  recentSearches.value = [term, ...recentSearches.value.filter((s) => s !== term)].slice(0, 10)
}

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
}

function clearSettings() {
  userSettings.value = {
    language: 'zh-CN',
    notifications: true,
    autoSave: true,
    sidebarCollapsed: false,
  }
}
</script>

<template>
  <div>
    <h3>响应式本地存储示例</h3>
    <p>当前主题: {{ theme }}</p>
    <p>字体大小: {{ fontSize }}px</p>
    <button @click="toggleTheme">切换主题</button>
    <button @click="fontSize = Math.min(fontSize + 2, 24)">增大字体</button>
    <button @click="clearSettings">重置设置</button>

    <div>
      <h4>用户设置（自动同步到 localStorage）</h4>
      <label>
        <input v-model="userSettings.notifications" type="checkbox" />
        开启通知
      </label>
      <label>
        <input v-model="userSettings.autoSave" type="checkbox" />
        自动保存
      </label>
    </div>
  </div>
</template>
```

**注意事项**：

- 默认使用 `localStorage`，可通过第三个参数传入 `{ storage: sessionStorage }` 切换存储方式
- 支持自定义序列化和反序列化函数，处理特殊数据类型如 Date、Map、Set 等
- 数据类型会根据初始值自动推断，无需手动调用 `JSON.parse` 或 `JSON.stringify`
- SSR 环境下会自动降级为内存存储，不会报错
- 可以使用 `useLocalStorage` 和 `useSessionStorage` 这两个快捷函数，语义更加明确
- 多标签页之间默认不会同步，如需同步可以配合 `useStorage` 的事件监听配置

### 3.6 useDark / useToggle —— 暗黑模式与状态切换

**使用场景**：网站或应用的深色模式切换功能、UI 面板的展开与收起状态管理、各种二态切换场景。`useDark` 专门针对暗黑模式做了深度封装，自动处理系统偏好检测、DOM 类名切换和状态持久化。

```vue
<script setup lang="ts">
import { useDark, useToggle } from '@vueuse/core'

// useDark 自动完成以下工作：
// 1. 检测系统的 prefers-color-scheme 偏好
// 2. 在 HTML 根元素上切换 dark class
// 3. 将用户选择持久化到 localStorage
// 4. 刷新页面时自动恢复用户上次的设置
const isDark = useDark({
  selector: 'html',
  attribute: 'class',
  valueDark: 'dark',
  valueLight: 'light',
  storageKey: 'vueuse-color-scheme',
})

const toggleDark = useToggle(isDark)

// 通用的 useToggle 可用于任何二态切换场景
const [isSidebarExpanded, toggleSidebar] = useToggle(true)
const [isModalOpen, toggleModal] = useToggle(false)
const [isFilterPanelVisible, toggleFilterPanel] = useToggle(false)
</script>

<template>
  <div>
    <button @click="toggleDark()" class="theme-toggle">
      {{ isDark ? '🌞 切换为亮色模式' : '🌙 切换为暗色模式' }}
    </button>

    <button @click="toggleSidebar()">
      {{ isSidebarExpanded ? '收起侧边栏' : '展开侧边栏' }}
    </button>

    <aside v-show="isSidebarExpanded" class="sidebar">
      <p>侧边栏内容</p>
      <button @click="toggleFilterPanel()">
        {{ isFilterPanelVisible ? '隐藏筛选' : '显示筛选' }}
      </button>
      <div v-show="isFilterPanelVisible" class="filter-panel">
        <p>筛选面板内容</p>
      </div>
    </aside>

    <button @click="toggleModal()">打开弹窗</button>
    <div v-if="isModalOpen" class="modal-overlay" @click.self="toggleModal(false)">
      <div class="modal">
        <h3>弹窗标题</h3>
        <p>弹窗内容</p>
        <button @click="toggleModal(false)">关闭弹窗</button>
      </div>
    </div>
  </div>
</template>
```

**注意事项**：

- `useDark` 默认使用 `window.matchMedia('(prefers-color-scheme: dark)')` 检测操作系统级别的暗色偏好，并将其作为初始值
- 切换状态会自动持久化到 `localStorage`，刷新页面后能保持用户上次的选择
- `useToggle` 返回一个数组 `[state, toggle]`，`toggle` 函数可以不传参数自动取反，也可以传入布尔值强制设置为指定状态
- 在 Tailwind CSS 项目中使用 `useDark` 特别方便，因为 Tailwind 的暗色模式默认就是通过 `dark` 类名来切换的
- 建议配合 CSS 变量或主题方案一起使用，确保暗色模式下的配色方案完整且美观

### 3.7 useEventListener —— 事件监听器

**使用场景**：全局键盘快捷键绑定、点击外部区域关闭下拉菜单、窗口事件监听、触摸手势处理等。这是 VueUse 中最基础也最常用的工具之一，它把事件监听的添加和清理封装成了一个声明式的调用。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener, onClickOutside, onKeyStroke } from '@vueuse/core'

const dropdownRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)

// 监听全局键盘事件，按 Esc 关闭所有弹窗和下拉
useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    isOpen.value = false
  }
})

// 监听窗口的 resize 事件，自动在组件卸载时清理
useEventListener(window, 'resize', () => {
  console.log('窗口大小已改变')
})

// 监听目标元素的点击事件
useEventListener(dropdownRef, 'click', (e: Event) => {
  e.stopPropagation()
  isOpen.value = !isOpen.value
})

// 使用 VueUse 提供的快捷函数：点击外部关闭
onClickOutside(dropdownRef, () => {
  isOpen.value = false
})

// 使用 VueUse 提供的快捷函数：键盘快捷键
onKeyStroke('k', (e) => {
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault()
    searchInputRef.value?.focus()
  }
})
</script>

<template>
  <div>
    <input ref="searchInputRef" placeholder="搜索 (⌘K)" />
    <div ref="dropdownRef" class="dropdown">
      <button>点击展开菜单</button>
      <div v-show="isOpen" class="dropdown-menu">
        <a href="#">选项一</a>
        <a href="#">选项二</a>
        <a href="#">选项三</a>
      </div>
    </div>
  </div>
</template>
```

**注意事项**：

- 第一个参数非常灵活，可以是 `window`、`document`、任意 DOM 元素、Ref 对象，也可以省略（默认为 `window`）
- 支持传递第三个参数作为 `EventListenerOptions`，例如 `{ passive: true }` 用于优化滚动性能，`{ capture: true }` 用于捕获阶段监听
- 组件卸载时自动调用 `removeEventListener`，无需手动清理，这是相比原生 API 最大的优势
- VueUse 还提供了许多基于 `useEventListener` 封装的快捷函数，如 `onClickOutside`、`onKeyStroke`、`useMousePressed` 等

### 3.8 useClipboard —— 剪贴板操作

**使用场景**：代码复制按钮、链接分享功能、文本快速复制、邀请码复制等。在现代 Web 应用中，一键复制功能几乎是标配。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useClipboard } from '@vueuse/core'

const { copy, copied, isSupported } = useClipboard()

const inviteCode = ref('VUE2026ABC')
const shareLink = ref('https://example.com/invite/abc123')

// 复制代码片段
const codeSnippet = `import { useClipboard } from '@vueuse/core'
const { copy, copied } = useClipboard()
await copy('Hello VueUse!')`

async function handleCopyCode() {
  try {
    await copy(codeSnippet)
    // copied 会自动变为 true，1.5 秒后自动重置为 false
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<template>
  <div v-if="isSupported" class="clipboard-demo">
    <div class="copy-section">
      <span>邀请码: {{ inviteCode }}</span>
      <button @click="copy(inviteCode)">
        {{ copied ? '✅ 已复制' : '📋 复制邀请码' }}
      </button>
    </div>

    <div class="copy-section">
      <span>分享链接: {{ shareLink }}</span>
      <button @click="copy(shareLink)">
        {{ copied ? '✅ 已复制' : '📋 复制链接' }}
      </button>
    </div>

    <div class="code-block">
      <pre><code>{{ codeSnippet }}</code></pre>
      <button @click="handleCopyCode">
        {{ copied ? '✅ 已复制' : '📋 复制代码' }}
      </button>
    </div>
  </div>

  <p v-else class="unsupported">
    ⚠️ 当前浏览器不支持 Clipboard API，请使用 HTTPS 协议访问
  </p>
</template>
```

**注意事项**：

- `copied` 是一个响应式 Ref，复制成功后自动变为 `true`，约 1.5 秒后自动重置为 `false`，非常适合用来做复制成功的 UI 反馈
- `isSupported` 属性可以检测当前浏览器是否支持 Clipboard API，建议在使用前先判断
- `copy()` 返回 Promise，需要在用户交互事件的回调中调用（浏览器安全策略要求），不能在页面加载时自动调用
- Clipboard API 要求页面运行在安全上下文中，即 HTTPS 或 localhost 环境
- 如果需要自定义 `copied` 的重置时间，可以在调用 `useClipboard` 时传入 `{ copiedDuring: 2000 }` 配置

### 3.9 useOnline / useNetwork —— 网络状态检测

**使用场景**：离线模式提示和降级、断网重连机制实现、根据网络质量调整加载策略、实时监控网络状态变化。

```vue
<script setup lang="ts">
import { watch } from 'vue'
import { useOnline, useNetwork } from '@vueuse/core'

// 简单的在线离线状态检测
const isOnline = useOnline()

// 获取详细的网络信息（部分浏览器支持）
const { type, effectiveType, downlink, rtt, saveData } = useNetwork()

// 监听网络状态变化，执行相应逻辑
watch(isOnline, (online) => {
  if (online) {
    console.log('网络已恢复，开始同步离线期间缓存的数据')
    syncPendingActions()
    showNotification('网络已恢复连接')
  } else {
    console.log('网络已断开，切换到离线模式，启用本地缓存')
    showNotification('网络连接已断开，当前为离线模式')
  }
})

// 根据网络质量调整加载策略
function getLoadStrategy() {
  if (!isOnline.value) return 'offline'
  if (saveData.value) return 'save-data'          // 用户开启了省流模式
  if (effectiveType.value === 'slow-2g') return 'minimal'
  if (effectiveType.value === '2g') return 'low'
  if (effectiveType.value === '3g') return 'medium'
  return 'full'                                    // 4G 或 WiFi，加载高质量资源
}

function syncPendingActions() {
  // 同步离线期间用户产生的操作数据
}

function showNotification(message: string) {
  console.log('通知:', message)
}
</script>

<template>
  <div>
    <div v-if="!isOnline" class="offline-banner">
      ⚠️ 当前处于离线模式，部分功能可能受限，数据将在联网后自动同步
    </div>

    <div class="network-info">
      <p>网络状态: {{ isOnline ? '🟢 在线' : '🔴 离线' }}</p>
      <template v-if="isOnline">
        <p>连接类型: {{ effectiveType || '未知' }}</p>
        <p>下行速度: {{ downlink }} Mbps</p>
        <p>网络延迟: {{ rtt }} ms</p>
        <p>省流模式: {{ saveData ? '已开启' : '未开启' }}</p>
        <p>加载策略: {{ getLoadStrategy() }}</p>
      </template>
    </div>
  </div>
</template>
```

**注意事项**：

- `useOnline` 基于 `navigator.onLine` 属性和浏览器的 `online/offline` 事件，这是浏览器原生能力，兼容性很好
- `useNetwork` 提供更详细的网络信息，其中部分数据（如 `effectiveType`、`downlink`、`rtt`）需要浏览器支持 Network Information API，并非所有浏览器都支持
- `effectiveType` 的可能值为 `slow-2g`、`2g`、`3g`、`4g`，分别代表不同的网络质量等级
- `saveData` 表示用户是否在系统设置中开启了省流量模式，可以根据这个属性来决定是否加载低质量图片或延迟加载非关键资源
- 注意 `navigator.onLine` 只能检测设备是否连接了网络，不能判断是否真正能访问互联网

### 3.10 useWindowSize / useElementSize —— 尺寸响应

**使用场景**：响应式布局断点判断、动态计算元素尺寸、根据视口大小调整组件行为、媒体查询的 JavaScript 替代方案。

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWindowSize, useElementSize, useBreakpoints } from '@vueuse/core'

const { width, height } = useWindowSize()

// 使用 VueUse 内置的断点工具，与常见 CSS 框架对齐
const breakpoints = useBreakpoints({
  mobile: 0,
  tablet: 768,
  desktop: 1024,
  wide: 1280,
})

const currentBreakpoint = breakpoints.current()
const isMobile = breakpoints.smaller('tablet')
const isDesktop = breakpoints.greaterOrEqual('desktop')

// 监听特定元素的尺寸变化
const cardRef = ref<HTMLElement | null>(null)
const { width: cardWidth, height: cardHeight } = useElementSize(cardRef)

// 根据窗口宽度计算网格列数
const gridColumns = computed(() => {
  if (width.value < 768) return 1
  if (width.value < 1024) return 2
  if (width.value < 1280) return 3
  return 4
})
</script>

<template>
  <div>
    <div class="info-bar">
      <span>窗口: {{ width }} × {{ height }}</span>
      <span>断点: {{ currentBreakpoint.join(', ') }}</span>
      <span>网格列数: {{ gridColumns }}</span>
    </div>

    <div
      ref="cardRef"
      class="responsive-card"
      :style="{ '--columns': gridColumns }"
    >
      <p>卡片宽度: {{ cardWidth.toFixed(0) }}px</p>
      <p>卡片高度: {{ cardHeight.toFixed(0) }}px</p>
    </div>

    <div class="grid" :style="{ 'grid-template-columns': `repeat(${gridColumns}, 1fr)` }">
      <div v-for="i in 12" :key="i" class="grid-item">
        卡片 {{ i }}
      </div>
    </div>
  </div>
</template>
```

**注意事项**：

- `useWindowSize` 默认监听 `window.resize` 事件，内部已经做了节流处理，不会造成性能问题
- SSR 环境下 `width` 默认为 `Infinity`，`height` 默认为 `Infinity`，可以通过配置 `initialWidth` 和 `initialHeight` 指定服务端渲染时的默认值
- `useElementSize` 使用 `ResizeObserver` API 实现，性能远优于监听 resize 事件或使用 `getBoundingClientRect` 的方案
- `useBreakpoints` 可以与 Tailwind CSS、Bootstrap 等框架的断点配置保持一致，只需在初始化时传入对应的断点值

---

## 四、性能优化实战场景

### 4.1 搜索框防抖优化

在没有防抖的情况下，用户每输入一个字符就会触发一次搜索请求，这不仅浪费服务器资源，还会因为网络延迟导致搜索结果闪烁和错乱。使用 `useDebounceFn` 可以轻松解决这个问题。

```typescript
// 错误做法：每次输入都触发请求
// 用户输入"vueuse"会触发 6 次请求，后面的请求可能比前面的更晚返回，导致结果错乱
watch(searchQuery, async (query) => {
  const results = await fetch(`/api/search?q=${query}`)
  searchResults.value = await results.json()
})

// 正确做法：使用防抖，用户停止输入 300ms 后才真正发起请求
// 用户输入"vueuse"只触发 1 次请求，节省了 83% 的网络开销
const debouncedSearch = useDebounceFn(async (query: string) => {
  const results = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
  searchResults.value = await results.json()
}, 300)

watch(searchQuery, (query) => debouncedSearch(query))
```

### 4.2 大列表虚拟滚动优化

渲染一万条数据时，使用虚拟列表可以将 DOM 节点数量从一万以上降低到二十到三十个，性能提升是数量级的。

```typescript
// 性能对比数据（渲染 10000 条列表数据）：
// 普通列表渲染：首屏渲染耗时约 2000 毫秒，内存占用约 150MB，滚动严重卡顿
// 虚拟列表渲染：首屏渲染耗时约 50 毫秒，内存占用约 20MB，滚动丝滑流畅

const { list, containerProps, wrapperProps } = useVirtualList(allItems, {
  itemHeight: 50,     // 必须准确设置每项高度
  overscan: 10,       // 上下各预渲染 10 项防止白屏
})
```

### 4.3 图片懒加载组合方案

将 `useIntersectionObserver` 与自定义函数组合，可以实现优雅的图片懒加载功能：

```typescript
import { ref, type Ref } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'

function useLazyImage(imageRef: Ref<HTMLElement | null>, src: Ref<string>) {
  const loadedSrc = ref('')
  const isLoading = ref(false)

  const { stop } = useIntersectionObserver(imageRef, ([entry]) => {
    if (entry?.isIntersecting) {
      isLoading.value = true
      const img = new Image()
      img.onload = () => {
        loadedSrc.value = src.value
        isLoading.value = false
      }
      img.src = src.value
      stop() // 加载完成后停止观察，避免重复触发
    }
  }, { rootMargin: '200px' }) // 提前 200px 开始预加载

  return { loadedSrc, isLoading }
}
```

### 4.4 滚动节流与状态管理

在长页面中监听滚动事件并更新 UI 状态时，使用节流可以避免频繁的 DOM 操作和重绘：

```typescript
import { ref } from 'vue'
import { useThrottleFn, useEventListener } from '@vueuse/core'

const scrollProgress = ref(0)
const showBackToTop = ref(false)

const handleScroll = useThrottleFn(() => {
  const scrollTop = document.documentElement.scrollTop
  const scrollHeight = document.documentElement.scrollHeight - window.innerHeight
  scrollProgress.value = (scrollTop / scrollHeight) * 100
  showBackToTop.value = scrollTop > 500
}, 100)

useEventListener('scroll', handleScroll)
```

---

## 五、与手写代码的全面对比

### 5.1 代码量对比

下表展示了使用 VueUse 与手动实现相同功能的详细对比：

| 功能场景 | VueUse 实现方式 | 手动实现需要的代码量 | 代码量减少 |
|---------|----------------|-------------------|-----------|
| 防抖函数 | `useDebounceFn(fn, 300)` 一行调用 | 需要手动编写 debounce 函数、管理定时器、处理清理逻辑，约 30 行 | 从 30 行降至 1 行 |
| 节流函数 | `useThrottleFn(fn, 200)` 一行调用 | 需要手动编写 throttle 函数、处理时间戳计算和边界条件，约 25 行 | 从 25 行降至 1 行 |
| 事件监听 | `useEventListener('click', handler)` | 需要在 onMounted 中添加、在 onUnmounted 中移除，约 10 行 | 从 10 行降至 1 行 |
| 本地存储 | `useStorage('key', value)` | 需要手动读写 localStorage、监听变化、处理类型转换和 SSR 兼容，约 40 行 | 从 40 行降至 1 行 |
| 元素可见性 | `useIntersectionObserver(el, cb)` | 需要创建 IntersectionObserver 实例、管理生命周期、处理兼容性，约 20 行 | 从 20 行降至 3 行 |
| 剪贴板 | `useClipboard()` | 需要处理 Clipboard API 的兼容性、异步调用、错误处理，约 30 行 | 从 30 行降至 2 行 |
| 暗黑模式 | `useDark()` 一行搞定 | 需要管理 class 切换、检测系统偏好、持久化到存储、初始化同步，约 50 行 | 从 50 行降至 1 行 |
| 网络状态 | `useOnline()` | 需要监听 online 和 offline 事件、初始化检测状态、处理兼容性，约 15 行 | 从 15 行降至 1 行 |
| 虚拟列表 | `useVirtualList(data, opts)` | 需要计算可视区域范围、动态渲染 DOM、处理滚动同步和边界情况，约 150 行 | 从 150 行降至 5 行 |
| 窗口尺寸 | `useWindowSize()` | 需要监听 resize 事件、添加节流处理、处理 SSR 初始值，约 15 行 | 从 15 行降至 1 行 |

### 5.2 手动实现 vs VueUse 代码对比

**手动实现防抖函数需要这些代码：**

```typescript
import { onUnmounted } from 'vue'

function useDebounceFn<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debouncedFn = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(...args)
      timer = null
    }, delay)
  }

  // 还需要在组件卸载时清理定时器
  onUnmounted(() => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })

  return debouncedFn
}

// 使用
const debouncedSearch = useDebounceFn(handleSearch, 300)
```

**使用 VueUse 只需要一行：**

```typescript
import { useDebounceFn } from '@vueuse/core'

const debouncedSearch = useDebounceFn(handleSearch, 300)
```

**手动实现本地存储需要考虑这么多边界情况：**

```typescript
import { ref, watch, onMounted, onUnmounted } from 'vue'

function useLocalStorage<T>(key: string, defaultValue: T) {
  const data = ref<T>(defaultValue)

  // 需要在挂载时读取已有值
  onMounted(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) {
      try {
        data.value = JSON.parse(stored)
      } catch {
        data.value = defaultValue
      }
    }
  })

  // 需要监听值的变化并同步写入
  watch(data, (newValue) => {
    localStorage.setItem(key, JSON.stringify(newValue))
  }, { deep: true })

  // 还需要监听其他标签页的 storage 事件以实现多标签同步
  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === key && e.newValue !== null) {
      try {
        data.value = JSON.parse(e.newValue)
      } catch {}
    }
  }
  window.addEventListener('storage', handleStorageEvent)
  onUnmounted(() => window.removeEventListener('storage', handleStorageEvent))

  // 还需要处理 SSR 环境下 localStorage 不存在的情况
  // 还需要处理存储空间满了的情况
  // ...

  return data
}
```

**使用 VueUse 一行搞定所有问题：**

```typescript
import { useStorage } from '@vueuse/core'

const data = useStorage('my-key', defaultValue)
```

---

## 六、最佳实践与注意事项

### 6.1 始终按需引入，优化打包体积

VueUse 虽然提供了两百多个工具函数，但我们只需要引入实际使用的部分。配合现代打包工具的 Tree-shaking 功能，未被使用的代码不会被打包：

```typescript
// 正确做法：按需引入，打包工具会自动进行 Tree-shaking
import { useDebounceFn, useStorage, useDark } from '@vueuse/core'

// 错误做法：全量引入会将所有工具函数都打包进去，即使你只用了其中三个
import * as VueUse from '@vueuse/core'
```

### 6.2 正确处理 SSR 兼容性

VueUse 大部分工具都内置了 SSR 安全机制，但在使用时仍需注意：

```typescript
// 在 SSR 环境中使用 useWindowSize，需要指定初始值
const { width, height } = useWindowSize({
  initialWidth: 1920,   // 服务端渲染时返回的默认宽度
  initialHeight: 1080,  // 服务端渲染时返回的默认高度
})

// useStorage 在 SSR 环境下会自动降级为内存存储，不会报错
// 但要注意，服务端渲染的 HTML 与客户端水合时的数据可能不一致
const theme = useStorage('theme', 'light')
```

### 6.3 避免过度使用，保持代码简洁

VueUse 虽然强大，但并不意味着每个状态管理都需要使用它：

```typescript
// 不推荐：简单的布尔值切换不需要使用 useToggle，直接用 ref 更清晰
const isShow = ref(false)
const toggle = () => { isShow.value = !isShow.value }

// 推荐：在需要返回 toggle 函数、或在模板中频繁使用切换功能时用 useToggle
const [isDark, toggleDark] = useToggle(false)
const [isExpanded, toggleExpand] = useToggle(false)
```

### 6.4 组合多个工具函数发挥最大威力

VueUse 的真正价值在于多个工具函数的灵活组合，可以快速构建出复杂的交互功能：

```typescript
import { ref, watch } from 'vue'
import { useDebounceFn, useEventListener, useStorage, useOnline } from '@vueuse/core'

// 组合实现：带离线缓存的自动保存搜索框
function useSmartSearch(storageKey: string) {
  const searchQuery = ref('')
  const searchResults = ref([])
  const isOnline = useOnline()

  // 搜索历史自动保存到本地存储
  const searchHistory = useStorage<string[]>(`${storageKey}-history`, [])

  // 防抖搜索
  const debouncedSearch = useDebounceFn(async (query: string) => {
    if (!isOnline.value) {
      // 离线时从缓存中搜索
      searchResults.value = searchHistory.value
        .filter((item) => item.includes(query))
        .map((item, index) => ({ id: index, title: item }))
      return
    }

    // 在线时调用搜索接口
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
    searchResults.value = await response.json()

    // 保存搜索历史
    if (query && !searchHistory.value.includes(query)) {
      searchHistory.value = [query, ...searchHistory.value].slice(0, 20)
    }
  }, 300)

  watch(searchQuery, (query) => debouncedSearch(query))

  // 按 Esc 清空搜索
  useEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      searchQuery.value = ''
      searchResults.value = []
    }
  })

  return { searchQuery, searchResults, searchHistory }
}
```

### 6.5 版本管理与升级策略

VueUse 在大版本升级时可能会有 API 的变化，需要注意以下几点：

- 升级前务必查阅官方的迁移指南，了解有哪些 breaking changes
- 确保使用 `@vueuse/core` 包名而不是旧版的 `vueuse`，后者已经不再维护
- 关注函数的 deprecated 标记，及时替换为推荐的新版 API
- 建议在 package.json 中锁定主版本号，避免意外升级导致的问题

---

## 七、总结

VueUse 是 Vue 3 Composition API 生态中最重要的工具库之一。它将前端开发中常见的浏览器交互、性能优化、状态管理等需求封装成了简洁易用的函数，极大地提升了开发效率和代码质量。通过本文的详细介绍，我们学习了 14 个高频工具函数的使用方法、适用场景、代码示例和注意事项。

以下是所有介绍的工具函数的速查总结表：

| 工具函数 | 功能分类 | 核心用途 | 典型适用场景 |
|---------|---------|---------|------------|
| `useDebounceFn` | 函数控制 | 对函数执行进行防抖处理 | 搜索框输入联想、按钮防重复提交 |
| `useThrottleFn` | 函数控制 | 对函数执行进行节流处理 | 滚动事件监听、鼠标移动追踪 |
| `useIntersectionObserver` | DOM 交互 | 检测元素是否进入视口 | 图片懒加载、曝光埋点、无限滚动 |
| `useVirtualList` | 性能优化 | 大数据量虚拟列表渲染 | 万级商品列表、聊天记录、日志流 |
| `useStorage` | 状态持久化 | 响应式的本地存储同步 | 用户偏好设置、表单草稿、购物车 |
| `useDark / useToggle` | UI 状态 | 暗黑模式切换和通用状态切换 | 主题切换、面板展开收起 |
| `useEventListener` | 事件管理 | 自动清理的事件监听器 | 全局快捷键、点击外部关闭 |
| `useClipboard` | 浏览器 API | 剪贴板读写操作 | 复制按钮、链接分享 |
| `usePermission` | 浏览器 API | 浏览器权限状态管理 | 摄像头、麦克风、通知权限检测 |
| `useOnline` | 网络状态 | 在线离线状态检测 | 离线模式提示、断网重连 |
| `useWindowSize` | 响应式布局 | 窗口尺寸实时监听 | 响应式断点判断、自适应布局 |
| `useElementVisibility` | DOM 交互 | 判断元素是否在可视区域 | 滚动触发动画、懒加载判断 |
| `useInfiniteScroll` | 性能优化 | 无限滚动加载更多数据 | 社交媒体信息流、商品列表分页 |

VueUse 的两百多个工具函数覆盖了前端开发的方方面面，本文所介绍的只是其中最常用的一部分。建议你在实际项目中积极探索和尝试更多工具，相信会有更多惊喜的发现。

记住：好的工具不是替代思考，而是让你把精力集中在更重要的业务逻辑上。VueUse 正是这样一个让你事半功倍的优秀工具库。

**相关资源链接：**

- [VueUse 官方文档](https://vueuse.org/) —— 最权威的 API 参考和使用指南
- [VueUse GitHub 仓库](https://github.com/vueuse/vueuse) —— 源码、Issues 和贡献指南
- [Vue 3 Composition API 文档](https://vuejs.org/guide/extras/composition-api-faq.html) —— 理解 VueUse 的基础
- [Anthony Fu 的博客](https://antfu.me/) —— 了解更多 Vue 生态工具

---

## 相关阅读

- [Signals 范式对比：Angular/Vue/Solid/Preact 响应式原理](/categories/前端/2026-06-05-Signals-范式对比-Angular-Vue-Solid-Preact-响应式原理/)
- [Vue3 Teleport/Suspense 实战：模态框、全局通知、异步组件现代化管理](/categories/前端/Vue3-Teleport-Suspense实战-模态框全局通知异步组件现代化管理/)
- [Vue Vapor Mode 实战：无 Virtual DOM 的 Vue 编译时优化](/categories/前端/Vue-Vapor-Mode-实战-无Virtual-DOM的Vue编译时优化-对比SolidJS的细粒度响应式性能/)

---

> 本文首发于个人博客，转载请注明出处。如有疑问或建议，欢迎在评论区留言交流。
