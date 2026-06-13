---
title: Vue 3 Teleport + Suspense 实战：模态框、全局通知、异步组件的现代化管理
date: 2026-06-06 00:00:00
tags:
- Vue 3
- Teleport
- Suspense
- 前端
- 组件设计
description: Vue 3 Teleport 与 Suspense 组件深度实战指南：Teleport 解决模态框/通知弹窗 DOM 层级裁剪问题，Suspense
  统一异步组件加载状态管理。包含五个完整实战项目（模态框系统、全局通知中心、异步表单、数据看板、路由级加载），覆盖 CSS 作用域陷阱、事件冒泡差异、v-if/v-show
  短暂闪烁、服务器端 Teleport 等踩坑场景，附 Vue 3.5+ defer Teleport、#error 插槽、onBeforeUnmount 清理等新特性解析与
  Composition API 最佳实践，帮助前端开发者构建更健壮的 Vue 3 应用。
categories:
- frontend
cover: /images/covers/vue3-teleport-suspense-cover.jpg
---


## 一、引言：Vue 3 组件通信的新范式

在现代前端应用开发中，我们经常会遇到两类棘手的问题：

1. **DOM 层级限制**：模态框、通知弹窗、下拉菜单等 UI 元素需要脱离当前组件的 DOM 树，挂载到 `body` 或其他指定容器，以避免被父级元素的 `overflow: hidden`、`z-index` 或 `transform` 属性裁剪或遮挡。在实际开发中，这是前端工程师最常遇到的布局问题之一——一个精心设计的模态框可能因为外层容器的 `overflow: hidden` 而被无情裁剪，或者因为 `transform` 属性创建了新的层叠上下文而导致 `z-index` 失效。

2. **异步数据流管理**：组件依赖异步数据时，如何优雅地处理加载状态、错误回退，避免出现"白屏闪烁"或"数据未就绪"的尴尬。在传统开发模式中，我们往往需要在每个组件内部编写大量的 `loading`、`error`、`retry` 状态管理代码，这些逻辑高度重复且难以抽象复用。

在 Vue 2 时代，我们不得不借助第三方库（如 `portal-vue`）或手动操作 DOM 来解决第一个问题；对于第二个问题，往往需要在每个组件内部手动管理 `loading`、`error` 状态，代码冗余且难以复用。开发者通常需要封装各种 mixin 或高阶组件来减少重复代码，但这些方案都存在维护困难、类型支持不佳等问题。

Vue 3 带来了两个内置的内置组件——**Teleport** 和 **Suspense**，从框架层面彻底解决了这两个痛点。Teleport 提供了一种声明式的方式来将组件的 DOM 输出"传送"到任意位置，而 Suspense 则为异步组件提供了统一的加载状态管理机制。本文将通过五个实战项目，深入讲解这两个 API 的原理、用法和最佳实践，帮助你构建更加健壮、可维护的 Vue 3 应用。

<!-- more -->

## 二、Teleport 深度解析

### 2.1 什么是 Teleport？

`Teleport`（传送门）是 Vue 3 提供的内置组件，它允许你将组件的 DOM 节点"传送"到 DOM 树中的其他位置，同时保持与父组件的逻辑关系（数据绑定、事件监听等）不变。

这个概念可能听起来有些抽象，简单来说就是：**模板渲染在父组件中，但 DOM 输出在目标位置**。你可以在任何子组件中使用 Teleport，但其内容会被渲染到你指定的目标容器中。尽管 DOM 位置发生了变化，但组件的逻辑关系——包括数据绑定、事件处理、依赖注入——都保持不变。

这种模式在 React 中被称为 "Portal"，是 React 16 引入的特性。Vue 3 将其内置为 Teleport，并增加了更多实用的功能如 `disabled` 属性和动态目标支持。

### 2.2 核心 API

```html
<teleport to="目标选择器" :disabled="是否禁用">
  <!-- 要传送的内容 -->
</teleport>
```

#### `to` 属性

`to` 属性指定传送的目标容器，接受一个 CSS 选择器字符串或 DOM 元素引用。这是 Teleport 最核心的配置项，决定了内容最终渲染在哪个 DOM 节点下：

```html
<!-- 传送到 body -->
<teleport to="body">
  <div class="modal">我是模态框</div>
</teleport>

<!-- 传送到指定元素 -->
<teleport to="#modal-container">
  <div class="modal">我是模态框</div>
</teleport>

<!-- 动态目标 -->
<teleport :to="teleportTarget">
  <div class="modal">我是模态框</div>
</teleport>
```

需要注意的是，`to` 目标必须是一个已经存在于 DOM 中的元素。如果目标元素不存在，Teleport 会在开发环境下输出警告。在实际项目中，我们通常会在 `index.html` 中预留一个专门的挂载点，或者直接传送到 `body`。

#### `disabled` 属性

当 `disabled` 为 `true` 时，Teleport 的效果被禁用，内容将渲染在原始位置：

```html
<teleport to="body" :disabled="isMobile">
  <!-- 移动端禁用 Teleport，在原位渲染 -->
  <div class="modal">内容</div>
</teleport>
```

这个特性在响应式设计中非常有用——某些设备上可能不需要将模态框传送到 `body`。例如在移动端，模态框通常以全屏方式展示，可以直接在组件内部渲染；而在桌面端则需要传送到 `body` 以避免被父容器裁剪。通过 `disabled` 属性配合响应式判断，我们可以用一套代码优雅地适配不同设备。

### 2.3 渲染原理

```
源组件 DOM 树                 目标容器（body）
┌──────────────┐            ┌──────────────────┐
│ <div id="app">│           │                  │
│   <Component> │   ───→    │   <div class="modal">│
│     <teleport>│  渲染输出  │     模态框内容    │
│     </teleport>│          │   </div>          │
│   </Component> │          │                  │
│ </div>        │           └──────────────────┘
└──────────────┘
```

**关键要点**：
- Teleport 仅影响 DOM 输出位置，不影响组件的逻辑层次
- 子组件仍然可以访问父组件的依赖注入（`provide/inject`）
- Vue DevTools 中会正确显示 Teleport 的层级关系
- 多个 Teleport 可以传送到同一个目标容器，按照声明顺序依次渲染
- Teleport 的内容仍然受 Vue 的响应式系统控制，数据变化会正常触发更新

### 2.4 服务端渲染（SSR）注意事项

在 SSR 环境中，目标元素在服务端可能不存在。Vue 会自动处理这种情况，在客户端激活时再执行传送。如果你使用 Nuxt 3，确保目标容器在服务端 HTML 中存在。具体来说，Nuxt 3 会在 `<body>` 标签内自动创建一个 `<div id="teleports">` 容器，专门用于 Teleport 的 SSR 输出。如果你使用自定义的 SSR 配置，需要手动在 HTML 模板中添加目标容器，并确保服务端和客户端使用相同的容器结构。

## 三、实战一：全局模态框组件——脱离 DOM 层级限制

### 3.1 问题场景

假设你正在开发一个后台管理系统，页面结构如下：

```html
<div class="layout" style="overflow: hidden; transform: translateZ(0);">
  <aside class="sidebar">...</aside>
  <main class="content" style="position: relative; z-index: 1;">
    <!-- 模态框被 content 的 z-index 和 overflow 裁剪 -->
    <Modal v-model:visible="showModal" />
  </main>
</div>
```

在这个场景中，模态框面临两个问题：第一，外层 `layout` 的 `overflow: hidden` 会导致模态框的遮罩层无法覆盖整个屏幕；第二，`transform: translateZ(0)` 会创建一个新的层叠上下文，使得模态框的 `z-index` 无法突破父容器的限制。这两个问题在没有 Teleport 的情况下非常棘手，开发者往往需要将模态框组件提升到应用的最顶层，但这又破坏了组件的封装性。

### 3.2 完整的 Modal 组件实现

**components/Modal.vue**

```vue
<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref, nextTick } from 'vue'

interface Props {
  visible: boolean
  title?: string
  width?: string
  closable?: boolean
  maskClosable?: boolean
  destroyOnClose?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  width: '520px',
  closable: true,
  maskClosable: true,
  destroyOnClose: false,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
  confirm: []
}>()

const modalRef = ref<HTMLElement | null>(null)
const isVisible = ref(props.visible)

// 同步外部 visible
watch(() => props.visible, (val) => {
  isVisible.value = val
  if (val) {
    // 打开模态框时锁定背景滚动
    document.body.style.overflow = 'hidden'
    nextTick(() => modalRef.value?.focus())
  } else {
    // 关闭模态框时恢复背景滚动
    document.body.style.overflow = ''
  }
})

function handleClose() {
  emit('update:visible', false)
  emit('close')
}

function handleMaskClick() {
  if (props.maskClosable) {
    handleClose()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closable) {
    handleClose()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <teleport to="body">
    <transition name="modal-fade">
      <div
        v-if="isVisible"
        class="modal-overlay"
        @click.self="handleMaskClick"
      >
        <div
          ref="modalRef"
          class="modal-container"
          :style="{ width }"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
        >
          <!-- Header -->
          <div class="modal-header">
            <slot name="header">
              <h3>{{ title }}</h3>
            </slot>
            <button
              v-if="closable"
              class="modal-close"
              @click="handleClose"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          <!-- Body -->
          <div class="modal-body">
            <slot>
              <template v-if="!destroyOnClose || isVisible">
                <p>默认内容</p>
              </template>
            </slot>
          </div>

          <!-- Footer -->
          <div class="modal-footer">
            <slot name="footer">
              <button class="btn btn-cancel" @click="handleClose">取消</button>
              <button class="btn btn-primary" @click="emit('confirm')">确定</button>
            </slot>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  outline: none;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid #eee;
}

.modal-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  padding: 12px 24px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
```

### 3.3 使用方式

```vue
<script setup lang="ts">
import { ref } from 'vue'
import Modal from './components/Modal.vue'

const showModal = ref(false)

function handleConfirm() {
  console.log('用户点击了确定')
  showModal.value = false
}
</script>

<template>
  <button @click="showModal = true">打开模态框</button>
  <Modal
    v-model:visible="showModal"
    title="提示"
    @confirm="handleConfirm"
  >
    <p>这是模态框的内容，渲染在 body 下！</p>
  </Modal>
</template>
```

这里 `v-model:visible` 实现了双向绑定，父组件控制显示/隐藏，Teleport 确保模态框始终渲染在 `body` 下，不受任何父容器的 CSS 影响。即使当前组件深嵌在复杂的布局结构中，模态框也能正确地全屏居中显示。

### 3.4 设计亮点解析

这个 Modal 组件有几个值得注意的设计细节：

- **焦点管理**：打开模态框后通过 `nextTick` 将焦点移到弹窗上，确保键盘操作（如 Escape 关闭）能够正常工作。
- **背景滚动锁定**：通过设置 `document.body.style.overflow = 'hidden'` 防止用户在模态框打开时滚动页面。
- **无障碍支持**：使用了 `role="dialog"`、`aria-modal="true"`、`aria-label` 等属性，符合 WAI-ARIA 无障碍标准。
- **组件卸载清理**：在 `onUnmounted` 中恢复 `overflow` 设置，防止组件被意外销毁后页面无法滚动。

## 四、实战二：全局通知系统——多实例管理

### 4.1 问题场景

通知（Toast/Notification）是几乎每个应用都需要的功能。与模态框不同，通知有以下显著特点：

- 需要脱离当前组件上下文，全局显示在页面的固定位置
- 可能同时存在多个实例，需要支持堆叠排列
- 每个通知需要自动消失，且消失时间可配置
- 通常通过函数调用（如 `notify.success('成功')`）而非组件标签使用
- 通知的触发可能来自任意组件，因此需要一个全局的管理机制

这些特点决定了通知系统必须是一个全局单例，通过 Teleport 将渲染输出到 `body`，通过 `provide/inject` 将 API 暴露给任意子组件使用。

### 4.2 通知容器组件

**components/NotificationContainer.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface Notification {
  id: number
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  duration: number
}

const notifications = ref<Notification[]>([])
let nextId = 0

function addNotification(options: Omit<Notification, 'id'>) {
  const id = nextId++
  const notification: Notification = { id, ...options }
  notifications.value.push(notification)

  if (options.duration > 0) {
    setTimeout(() => removeNotification(id), options.duration)
  }
  return id
}

function removeNotification(id: number) {
  const index = notifications.value.findIndex(n => n.id === id)
  if (index > -1) {
    notifications.value.splice(index, 1)
  }
}

// 暴露给外部使用
defineExpose({ addNotification, removeNotification })

// 全局 API
const notificationApi = {
  success(title: string, message = '') {
    return addNotification({ type: 'success', title, message, duration: 3000 })
  },
  error(title: string, message = '') {
    return addNotification({ type: 'error', title, message, duration: 5000 })
  },
  warning(title: string, message = '') {
    return addNotification({ type: 'warning', title, message, duration: 4000 })
  },
  info(title: string, message = '') {
    return addNotification({ type: 'info', title, message, duration: 3000 })
  },
}

// 通过 provide/inject 暴露
import { provide } from 'vue'
provide('notification', notificationApi)
</script>

<template>
  <teleport to="body">
    <div class="notification-container" aria-live="polite">
      <transition-group name="notification-slide">
        <div
          v-for="item in notifications"
          :key="item.id"
          :class="['notification-item', `notification-${item.type}`]"
          @click="removeNotification(item.id)"
        >
          <span class="notification-icon">
            {{ { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[item.type] }}
          </span>
          <div class="notification-content">
            <div class="notification-title">{{ item.title }}</div>
            <div v-if="item.message" class="notification-message">
              {{ item.message }}
            </div>
          </div>
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<style scoped>
.notification-container {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 400px;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  border-left: 4px solid;
  min-width: 300px;
}

.notification-success { border-left-color: #52c41a; }
.notification-error { border-left-color: #ff4d4f; }
.notification-warning { border-left-color: #faad14; }
.notification-info { border-left-color: #1890ff; }

.notification-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.notification-title {
  font-weight: 600;
  font-size: 14px;
}

.notification-message {
  font-size: 13px;
  color: #666;
  margin-top: 4px;
}

.notification-slide-enter-active,
.notification-slide-leave-active {
  transition: all 0.3s ease;
}

.notification-slide-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.notification-slide-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
```

### 4.3 Composable 封装

**composables/useNotification.ts**

```typescript
import { inject } from 'vue'

interface NotificationApi {
  success(title: string, message?: string): number
  error(title: string, message?: string): number
  warning(title: string, message?: string): number
  info(title: string, message?: string): number
}

export function useNotification(): NotificationApi {
  const notification = inject<NotificationApi>('notification')
  if (!notification) {
    throw new Error('useNotification() 必须在 NotificationContainer 的子组件中使用')
  }
  return notification
}
```

通过封装 `useNotification` composable，我们在类型安全的前提下提供了友好的调用接口。注意在 `inject` 时进行了空值检查，如果在 `NotificationContainer` 的子组件之外调用，会抛出明确的错误信息，帮助开发者快速定位问题。

### 4.4 在应用中使用

**App.vue**

```vue
<script setup lang="ts">
import NotificationContainer from './components/NotificationContainer.vue'
</script>

<template>
  <NotificationContainer />
  <router-view />
</template>
```

**任意子组件中使用**

```vue
<script setup lang="ts">
import { useNotification } from '@/composables/useNotification'

const notify = useNotification()

async function handleSave() {
  try {
    await saveData()
    notify.success('保存成功', '数据已成功保存到服务器')
  } catch (error) {
    notify.error('保存失败', '请检查网络连接后重试')
  }
}
</script>
```

整个通知系统的数据逻辑完全通过 `provide/inject` 管理，而 Teleport 确保通知始终在页面最顶层渲染。多个通知可以同时存在，自动堆叠，自动消失。这种架构的优势在于：通知的触发逻辑（`useNotification`）和渲染逻辑（`NotificationContainer`）完全解耦，任何组件只需要引入 composable 即可发送通知，无需关心通知如何渲染和管理。

## 五、实战三：右键菜单——动态定位 Teleport

### 5.1 动态 Teleport 目标

右键菜单（Context Menu）是一个有趣的应用场景——菜单需要根据鼠标位置动态定位，同时要避免被父容器裁剪。与模态框不同，右键菜单的位置是动态计算的，每次触发时位置都不同，因此我们需要结合 `position: fixed` 和 Teleport 来实现精确定位。

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface MenuItem {
  label: string
  icon?: string
  action: () => void
  divider?: boolean
  disabled?: boolean
}

defineProps<{
  items: MenuItem[]
}>()

const visible = ref(false)
const position = ref({ x: 0, y: 0 })
const menuRef = ref<HTMLElement | null>(null)

function show(e: MouseEvent) {
  e.preventDefault()
  // 计算位置，确保不超出视口
  const x = Math.min(e.clientX, window.innerWidth - 200)
  const y = Math.min(e.clientY, window.innerHeight - 300)
  position.value = { x, y }
  visible.value = true

  // 点击外部关闭
  setTimeout(() => {
    document.addEventListener('click', hide, { once: true })
    document.addEventListener('contextmenu', hide, { once: true })
  }, 0)
}

function hide() {
  visible.value = false
}

function handleItemClick(item: MenuItem) {
  if (!item.disabled) {
    item.action()
    hide()
  }
}

defineExpose({ show, hide })
</script>

<template>
  <teleport to="body">
    <transition name="context-menu-fade">
      <div
        v-if="visible"
        ref="menuRef"
        class="context-menu"
        :style="{
          left: `${position.x}px`,
          top: `${position.y}px`,
        }"
        role="menu"
      >
        <template v-for="(item, index) in items" :key="index">
          <div v-if="item.divider" class="context-menu-divider" />
          <div
            v-else
            :class="['context-menu-item', { disabled: item.disabled }]"
            role="menuitem"
            @click="handleItemClick(item)"
          >
            <span v-if="item.icon" class="context-menu-icon">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </div>
        </template>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  min-width: 160px;
  z-index: 3000;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s;
}

.context-menu-item:hover {
  background: #f5f5f5;
}

.context-menu-item.disabled {
  color: #ccc;
  cursor: not-allowed;
}

.context-menu-divider {
  height: 1px;
  background: #eee;
  margin: 4px 0;
}

.context-menu-fade-enter-active,
.context-menu-fade-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.context-menu-fade-enter-from,
.context-menu-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
```

### 5.2 使用示例

```vue
<script setup lang="ts">
import ContextMenu from './components/ContextMenu.vue'

const menuItems = [
  { label: '复制', icon: '📋', action: () => console.log('复制') },
  { label: '粘贴', icon: '📄', action: () => console.log('粘贴') },
  { divider: true },
  { label: '删除', icon: '🗑️', action: () => console.log('删除') },
]

const contextMenuRef = ref()
</script>

<template>
  <div @contextmenu="contextMenuRef?.show($event)">
    右键点击此区域
  </div>
  <ContextMenu ref="contextMenuRef" :items="menuItems" />
</template>
```

注意这里我们传送到 `body` 后，使用 `position: fixed` 配合鼠标坐标进行定位，完全不受父容器的 `overflow` 和定位上下文影响。这个方案的关键优势在于：无论右键菜单的触发元素在页面的什么位置——即使是嵌套在多层 `overflow: hidden` 的容器中——菜单都能正确地显示在鼠标点击的位置。

## 六、Suspense 深度解析

### 6.1 什么是 Suspense？

`Suspense` 是 Vue 3 提供的内置组件，用于处理异步依赖的组件树。它的设计理念类似于 React 的 Suspense，但在实现机制上有所不同。当子组件（或其后代）存在异步操作时，Suspense 可以：

1. 在异步操作完成前显示 **fallback** 内容（如加载指示器、骨架屏）
2. 异步操作完成后渲染 **默认** 内容，整个过程对用户透明
3. 捕获异步操作中的错误并显示错误 UI

Suspense 的核心价值在于**声明式的异步状态管理**——你不需要在每个组件中手动管理 `loading` 和 `error` 状态，Suspense 会自动处理这些逻辑。

### 6.2 异步组件的两种定义方式

Suspense 支持两种异步组件的定义方式，开发者可以根据场景选择最合适的一种：

**方式一：`async setup()` 函数**

```vue
<script setup lang="ts">
// setup 本身是 async 的
const data = await fetch('/api/users').then(res => res.json())
</script>

<template>
  <ul>
    <li v-for="user in data" :key="user.id">{{ user.name }}</li>
  </ul>
</template>
```

当 `<script setup>` 中包含顶层 `await` 时，Vue 编译器会自动将 `setup` 函数转换为异步函数。Suspense 会检测到这个异步 setup，并在 `await` 完成之前显示 fallback 内容。

**方式二：嵌套子组件中包含异步操作**

```vue
<!-- AsyncChild.vue -->
<script setup lang="ts">
const data = await fetchData()
</script>
```

```vue
<!-- Parent.vue -->
<template>
  <Suspense>
    <template #default>
      <AsyncChild />
    </template>
    <template #fallback>
      <div>加载中...</div>
    </template>
  </Suspense>
</template>
```

即使异步操作发生在深层嵌套的子组件中，只要它在 Suspense 的子树内，Suspense 都能正确捕获并管理其异步状态。

### 6.3 Suspense 的生命周期

理解 Suspense 的渲染时序对于正确使用它至关重要。很多开发者在初次使用 Suspense 时会忽略时序问题，导致出现意外的行为：

```
首次渲染                     更新（key 变化）
  │                            │
  ▼                            ▼
渲染 #fallback            渲染 #fallback（可选）
  │                            │
  ▼                            ▼
子组件 setup() 开始        新子组件 setup() 开始
  │                            │
  ▼                            ▼
异步操作进行中...          异步操作进行中...
  │                            │
  ▼                            ▼
异步完成 → 渲染 #default  异步完成 → 渲染 #default
  │                            │
  ▼                            ▼
子组件 onMounted          新子组件 onMounted
```

**重要时序**：
- 异步子组件的 `onMounted` 在异步操作完成后才调用，因此在 `onMounted` 中访问异步数据是安全的
- `Suspense` 自身也有 `onMounted`，在所有子组件挂载完成后调用
- 当 Suspense 的 `key` 发生变化时（如路由切换），会重新进入 pending 状态，此时可以控制是否继续显示旧内容或切换到 fallback

### 6.4 错误处理

```vue
<template>
  <Suspense>
    <template #default>
      <AsyncComponent />
    </template>
    <template #fallback>
      <LoadingSpinner />
    </template>
    <!-- 注意：error 是 Vue 3.4+ 的插槽 -->
    <template #error="{ error }">
      <ErrorDisplay :error="error" />
    </template>
  </Suspense>
</template>
```

对于 Vue 3.3 及以下版本，可以使用 `onErrorCaptured` 钩子来捕获 Suspense 内部的错误：

```vue
<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

const error = ref<Error | null>(null)

onErrorCaptured((err) => {
  error.value = err
  return false // 阻止错误继续向上传播
})
</script>
```

## 七、实战四：异步数据加载组件——骨架屏 + Suspense + ErrorBoundary

### 7.1 架构设计

我们将构建一个完整的数据加载方案，结合三个层次来实现健壮的异步数据管理：

```
ErrorBoundary（错误捕获层）
  └── Suspense（异步管理层）
        └── AsyncDataComponent（数据组件）
```

这种分层架构的优势在于每一层只关注自己的职责：ErrorBoundary 负责错误捕获和展示，Suspense 负责异步状态管理，AsyncDataComponent 专注于数据获取和渲染。这种关注点分离使得代码更容易测试和维护。

### 7.2 骨架屏组件

**components/SkeletonLoader.vue**

```vue
<script setup lang="ts">
defineProps<{
  rows?: number
  avatar?: boolean
}>()
</script>

<template>
  <div class="skeleton-wrapper">
    <div v-if="avatar" class="skeleton-avatar" />
    <div class="skeleton-lines">
      <div
        v-for="i in (rows ?? 3)"
        :key="i"
        class="skeleton-line"
        :style="{ width: i === (rows ?? 3) ? '60%' : '100%' }"
      />
    </div>
  </div>
</template>

<style scoped>
.skeleton-wrapper {
  display: flex;
  gap: 16px;
  padding: 16px;
}

.skeleton-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  flex-shrink: 0;
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-line {
  height: 16px;
  border-radius: 4px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
</style>
```

骨架屏是一种现代的加载状态展示方式，相比传统的 loading spinner，它能更好地预示即将出现的内容布局，减少用户的感知等待时间。这个组件使用 CSS 动画实现闪烁效果，视觉上更加柔和自然。

### 7.3 ErrorBoundary 组件

**components/ErrorBoundary.vue**

```vue
<script setup lang="ts">
import { ref, onErrorCaptured, provide } from 'vue'

const error = ref<Error | null>(null)

const props = defineProps<{
  fallback?: 'inline' | 'page'
}>()

onErrorCaptured((err: Error) => {
  error.value = err
  return false
})

function retry() {
  error.value = null
}

provide('errorBoundaryRetry', retry)
</script>

<template>
  <div v-if="error" class="error-boundary">
    <div class="error-content">
      <div class="error-icon">⚠️</div>
      <h3>出错了</h3>
      <p class="error-message">{{ error.message }}</p>
      <button class="btn-retry" @click="retry">重试</button>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.error-boundary {
  padding: 32px;
  text-align: center;
}

.error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.error-message {
  color: #ff4d4f;
  margin: 12px 0 24px;
}

.btn-retry {
  padding: 8px 24px;
  background: #1890ff;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
</style>
```

ErrorBoundary 通过 `provide` 将 `retry` 函数暴露给子组件，子组件可以在适当的时机调用 `retry` 来重置错误状态，触发重新渲染。

### 7.4 异步数据组件

**components/AsyncUserList.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'

interface User {
  id: number
  name: string
  email: string
  avatar: string
}

// 这里的 await 会被 Suspense 捕获
const response = await fetch('/api/users')
if (!response.ok) {
  throw new Error(`加载用户列表失败: ${response.status}`)
}
const users = ref<User[]>(await response.json())
</script>

<template>
  <div class="user-list">
    <div v-for="user in users" :key="user.id" class="user-card">
      <img :src="user.avatar" :alt="user.name" class="user-avatar" />
      <div class="user-info">
        <div class="user-name">{{ user.name }}</div>
        <div class="user-email">{{ user.email }}</div>
      </div>
    </div>
  </div>
</template>
```

这个组件的代码非常简洁——没有 `loading` 状态，没有 `error` 处理，只有纯粹的数据获取和渲染逻辑。所有的异步状态管理都由外层的 Suspense 和 ErrorBoundary 负责。

### 7.5 组合使用

```vue
<script setup lang="ts">
import ErrorBoundary from './components/ErrorBoundary.vue'
import AsyncUserList from './components/AsyncUserList.vue'
import SkeletonLoader from './components/SkeletonLoader.vue'
</script>

<template>
  <ErrorBoundary>
    <Suspense>
      <template #default>
        <AsyncUserList />
      </template>
      <template #fallback>
        <div class="skeleton-list">
          <SkeletonLoader v-for="i in 5" :key="i" :rows="2" avatar />
        </div>
      </template>
    </Suspense>
  </ErrorBoundary>
</template>
```

这个三层结构实现了：
- **骨架屏**：异步加载期间展示友好的占位 UI，而非空白页面
- **Suspense**：自动管理异步状态，无需在组件内部手动管理 `loading` 变量
- **ErrorBoundary**：统一捕获和处理错误，提供重试机制

## 八、实战五：路由级 Suspense——页面切换的异步优雅降级

### 8.1 问题场景

在单页应用中，路由切换时新页面可能需要异步加载数据。如果每个页面都自己管理 loading 状态，代码会非常冗余。每个页面组件都需要维护自己的 `isLoading`、`error`、`retryCount` 等状态变量，以及对应的 `onMounted` 中的异步请求逻辑。这不仅增加了代码量，还容易出现不一致的用户体验——有的页面显示 spinner，有的显示骨架屏，有的甚至什么都不显示。

### 8.2 路由配置

```typescript
// router/index.ts
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/dashboard',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: '/settings',
    component: () => import('@/views/Settings.vue'),
  },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
```

### 8.3 页面级异步组件

**views/Dashboard.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'

// 所有页面级异步请求集中在此
const [statsRes, activityRes] = await Promise.all([
  fetch('/api/stats'),
  fetch('/api/activity'),
])

if (!statsRes.ok || !activityRes.ok) {
  throw new Error('数据加载失败')
}

const stats = ref(await statsRes.json())
const activity = ref(await activityRes.json())
</script>

<template>
  <div class="dashboard">
    <h1>仪表盘</h1>
    <div class="stats-grid">
      <div v-for="stat in stats" :key="stat.label" class="stat-card">
        <div class="stat-value">{{ stat.value }}</div>
        <div class="stat-label">{{ stat.label }}</div>
      </div>
    </div>
    <div class="activity-feed">
      <div v-for="item in activity" :key="item.id" class="activity-item">
        {{ item.description }}
      </div>
    </div>
  </div>
</template>
```

注意这里使用了 `Promise.all` 来并行发起多个请求，而不是串行等待。这是性能优化的重要手段——如果两个请求分别需要 200ms 和 300ms，并行执行只需要 300ms，而串行执行则需要 500ms。

### 8.4 App.vue 中的路由级 Suspense

```vue
<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'
import { RouterView } from 'vue-router'
import LoadingBar from './components/LoadingBar.vue'

const error = ref<Error | null>(null)

onErrorCaptured((err) => {
  error.value = err
  return false
})

function resetError() {
  error.value = null
}
</script>

<template>
  <div id="app">
    <nav>...</nav>
    <main>
      <ErrorBoundary v-if="!error">
        <Suspense>
          <template #default>
            <RouterView v-slot="{ Component }">
              <transition name="page-fade" mode="out-in">
                <component :is="Component" />
              </transition>
            </RouterView>
          </template>
          <template #fallback>
            <LoadingBar />
          </template>
        </Suspense>
      </ErrorBoundary>
      <div v-else class="error-page">
        <h2>页面加载失败</h2>
        <p>{{ error.message }}</p>
        <button @click="resetError">重试</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.25s ease;
}

.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}
</style>
```

这样，所有路由组件中的 `await` 操作都会被同一个 Suspense 管理，页面切换时自动显示加载状态，无需在每个页面重复编写 loading 逻辑。路由级别的 Suspense 是最推荐的使用方式，因为它天然契合路由切换的生命周期。

## 九、Teleport + Suspense 组合使用：异步弹窗与表单

### 9.1 场景分析

在实际项目中，我们经常需要在弹窗中加载异步数据——比如编辑用户的弹窗需要先获取用户详情，创建订单的表单需要先加载商品列表。这时 Teleport 和 Suspense 可以完美配合：Teleport 负责将弹窗渲染到正确的位置，Suspense 负责管理弹窗内部的异步数据加载状态。

### 9.2 异步弹窗组件

**components/AsyncEditModal.vue**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  userId: number | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()

const formData = ref({
  name: '',
  email: '',
  role: '',
})

const saving = ref(false)

// 仅在弹窗可见且有 userId 时加载数据
const userData = ref<any>(null)

watch(
  () => [props.visible, props.userId],
  async ([visible, userId]) => {
    if (visible && userId) {
      const res = await fetch(`/api/users/${userId}`)
      if (!res.ok) throw new Error('获取用户信息失败')
      userData.value = await res.json()
      formData.value = { ...userData.value }
    }
  },
  { immediate: true }
)

async function handleSave() {
  saving.value = true
  try {
    await fetch(`/api/users/${props.userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData.value),
    })
    emit('saved')
    emit('update:visible', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <teleport to="body">
    <div v-if="visible" class="modal-overlay">
      <div class="modal-container">
        <Suspense>
          <template #default>
            <div class="modal-content">
              <h3>编辑用户</h3>
              <form @submit.prevent="handleSave">
                <div class="form-group">
                  <label>姓名</label>
                  <input v-model="formData.name" />
                </div>
                <div class="form-group">
                  <label>邮箱</label>
                  <input v-model="formData.email" type="email" />
                </div>
                <div class="form-group">
                  <label>角色</label>
                  <select v-model="formData.role">
                    <option value="admin">管理员</option>
                    <option value="user">普通用户</option>
                    <option value="editor">编辑</option>
                  </select>
                </div>
                <div class="form-actions">
                  <button type="button" @click="emit('update:visible', false)">
                    取消
                  </button>
                  <button type="submit" :disabled="saving">
                    {{ saving ? '保存中...' : '保存' }}
                  </button>
                </div>
              </form>
            </div>
          </template>
          <template #fallback>
            <div class="loading-placeholder">
              <div class="spinner" />
              <p>加载用户信息...</p>
            </div>
          </template>
        </Suspense>
      </div>
    </div>
  </teleport>
</template>
```

### 9.3 使用组合

```vue
<script setup lang="ts">
import { ref } from 'vue'
import AsyncEditModal from './components/AsyncEditModal.vue'
import { useNotification } from '@/composables/useNotification'

const showEditModal = ref(false)
const editingUserId = ref<number | null>(null)
const notify = useNotification()

function openEdit(userId: number) {
  editingUserId.value = userId
  showEditModal.value = true
}

function handleSaved() {
  notify.success('保存成功', '用户信息已更新')
}
</script>

<template>
  <div>
    <button @click="openEdit(42)">编辑用户 #42</button>
    <AsyncEditModal
      v-model:visible="showEditModal"
      :user-id="editingUserId"
      @saved="handleSaved"
    />
  </div>
</template>
```

这里的关键组合是：
- **Teleport** 将弹窗渲染到 `body`，避免 DOM 层级问题
- **Suspense** 管理弹窗内异步数据的加载状态
- 弹窗打开时自动加载数据，加载完成前显示骨架屏/加载指示器
- 整个弹窗的使用体验非常流畅：点击按钮 → 弹窗出现并显示加载状态 → 数据加载完成显示表单 → 用户编辑保存 → 收到成功通知

## 十、Vue 3.5+ 新变化与最佳实践

### 10.1 Vue 3.5 的 Teleport 改进

Vue 3.5 对 Teleport 做了多项重要改进，使其在生产环境中更加可靠：

1. **SSR 水合优化**：Teleport 在 SSR 环境下的水合更加可靠，减少了水合不匹配的错误。Vue 3.5 会更智能地处理服务端和客户端之间的 Teleport 差异。

2. **延迟传送**：可以使用 `defer` 属性延迟 Teleport 的挂载，直到目标容器可用。这在动态创建目标容器的场景中非常有用：

```html
<!-- Vue 3.5+ 延迟 Teleport -->
<teleport to="#late-container" defer>
  <div>延迟传送的内容</div>
</teleport>
```

3. **多 Teleport 排序**：多个 Teleport 传送到同一目标时，渲染顺序更加可预测，按照模板中的声明顺序依次渲染。

### 10.2 Vue 3.5 的 Suspense 改进

1. **Suspense `#error` 插槽**：正式支持 error 插槽，不再需要额外的 `onErrorCaptured` 钩子来捕获错误。这使得错误处理更加声明式：

```html
<Suspense>
  <template #default>
    <AsyncComponent />
  </template>
  <template #fallback>
    <Loading />
  </template>
  <template #error="{ error, reset }">
    <ErrorDisplay :error="error" @retry="reset" />
  </template>
</Suspense>
```

2. **`onSuspenseResolved` / `onSuspensePending`**：新增生命周期钩子，允许在 Suspense 状态变化时执行自定义逻辑，比如进度条控制、页面标题更新等：

```typescript
import { onSuspenseResolved, onSuspensePending } from 'vue'

onSuspensePending(() => {
  console.log('Suspense 开始等待异步...')
  // 可以在这里启动全局 loading 进度条
})

onSuspenseResolved(() => {
  console.log('Suspense 所有异步已完成')
  // 可以在这里停止全局 loading 进度条
})
```

### 10.3 Vue 3.6 Vapor 模式展望

Vue 3.6 引入的 Vapor 模式（无虚拟 DOM 编译优化）中，Teleport 和 Suspense 将获得进一步的性能优化。Vapor 模式通过编译时分析，可以更高效地处理 Teleport 的 DOM 操作，减少运行时的虚拟 DOM 开销。对于频繁显示/隐藏的模态框和通知组件，Vapor 模式将带来显著的性能提升。

### 10.4 最佳实践总结

**Teleport 最佳实践**：
- 始终为 Teleport 的内容设置正确的 `z-index` 层级，建议使用统一的层级管理策略
- 在 SSR 环境中确保目标容器存在，Nuxt 3 用户可以使用默认的 `#teleports` 容器
- 考虑使用 `disabled` 属性做响应式适配，移动端和桌面端可能需要不同的 Teleport 策略
- 多个 Teleport 传送到同一目标时注意渲染顺序，必要时通过 CSS 控制层叠关系

**Suspense 最佳实践**：
- 优先使用路由级 Suspense，减少重复的 loading 状态管理
- 配合 ErrorBoundary 统一处理错误，形成 `ErrorBoundary > Suspense > AsyncComponent` 的标准层级
- 为 fallback 提供有意义的加载 UI（骨架屏优于简单 spinner），提升用户感知性能
- 避免在 Suspense 内部组件中使用 `v-if` 控制渲染，让 Suspense 统一管理状态

**组合使用最佳实践**：
- Teleport 内使用 Suspense 时，确保 fallback 也是 Teleport 的内容，避免闪烁
- 在弹窗场景中，先 Teleport 到 body，再在内部使用 Suspense 管理异步
- 合理使用 `Promise.all` 并行化多个异步请求，减少 Suspense 的等待时间

## 十一、常见陷阱与性能注意事项

### 11.1 Teleport 常见陷阱

**陷阱一：CSS 作用域丢失**

Teleport 的内容渲染在目标容器中，但 `<style scoped>` 的样式仍然会生效（Vue 通过 `data-v-xxx` 属性选择器实现）。但要注意，某些 CSS-in-JS 方案或全局样式可能会影响 Teleport 的内容。另外，如果 Teleport 的目标容器有自己的样式重置（如 `font-size: 0`），可能会影响内容的显示。

```vue
<style scoped>
/* 这个样式仍然会应用到 Teleport 的内容上 */
.modal-content {
  background: #fff;
}
</style>
```

**陷阱二：事件冒泡**

虽然 DOM 结构改变了，但 Vue 的事件系统仍然认为 Teleport 的内容是父组件的子组件。但原生 DOM 事件的冒泡路径会遵循实际的 DOM 树结构，这一点需要特别注意：

```vue
<template>
  <div @click="handleParentClick">
    <teleport to="body">
      <!-- 这里的 click 事件不会冒泡到上面的 div -->
      <button @click="handleClick">Click me</button>
    </teleport>
  </div>
</template>
```

Vue 的事件系统（`@click`）是基于组件树的，所以 `@click` 仍然会触发父组件的处理器。但如果你使用原生事件监听器（`addEventListener`），事件冒泡会遵循 DOM 树结构。

**陷阱三：SSR 水合不匹配**

在 SSR 环境中，如果服务端和客户端的 Teleport 目标不一致，会导致水合错误。确保目标容器在两端都存在，且结构一致。

### 11.2 Suspense 常见陷阱

**陷阱一：Suspense 的 "全有或全无" 特性**

Suspense 会等待**所有**异步子组件完成才渲染默认内容。如果你有一个快速加载的组件和一个慢速加载的组件都在同一个 Suspense 内，用户必须等待最慢的那个：

```vue
<Suspense>
  <template #default>
    <FastComponent />  <!-- 100ms -->
    <SlowComponent />  <!-- 5000ms -->
  </template>
  <template #fallback>
    <Loading />
  </template>
</Suspense>
<!-- 用户需要等待 5 秒才能看到任何内容 -->
```

**解决方案**：将不同速度的组件放在不同的 Suspense 中：

```vue
<Suspense>
  <template #default>
    <FastComponent />
  </template>
</Suspense>

<Suspense>
  <template #default>
    <SlowComponent />
  </template>
  <template #fallback>
    <Loading />
  </template>
</Suspense>
```

**陷阱二：错误边界的位置**

Suspense 内部的错误会被 Suspense 捕获，但 Suspense 外部的错误不会。错误处理组件（ErrorBoundary）需要正确包裹 Suspense：

```vue
<!-- ✅ 正确：ErrorBoundary 包裹 Suspense -->
<ErrorBoundary>
  <Suspense>
    <AsyncComponent />
  </Suspense>
</ErrorBoundary>

<!-- ❌ 错误：Suspense 包裹 ErrorBoundary -->
<Suspense>
  <ErrorBoundary>
    <AsyncComponent />
  </ErrorBoundary>
</Suspense>
```

**陷阱三：ref 在异步 setup 中的响应性**

在 `async setup()` 中，`await` 之前的 `ref` 和 `reactive` 调用仍然是响应式的，但要注意 `await` 之后直接赋值的普通变量不是响应式的：

```vue
<script setup lang="ts">
import { ref } from 'vue'

// ✅ 这个 ref 是响应式的
const count = ref(0)

const data = await fetchData()

// ✅ 这也是响应式的（因为 ref 是独立创建的）
const items = ref(data.items)

// ⚠️ 这不是响应式的
const rawValue = data.someValue
</script>
```

### 11.3 性能注意事项

1. **Teleport 的重排开销**：频繁切换 Teleport 的目标容器可能导致 DOM 重排（reflow），尽量避免动态切换 `to` 属性。如果确实需要动态目标，考虑使用 `disabled` 属性代替。

2. **Suspense 的内存管理**：长时间运行的单页应用中，Suspense 缓存的组件实例可能不会被及时回收。在路由切换时确保旧组件被正确卸载，避免内存泄漏。

3. **多个 Suspense 的协调**：嵌套使用 Suspense 时，内层 Suspense 的异步完成会触发外层 Suspense 的渲染，要注意层级关系和渲染时序。

4. **避免不必要的 Suspense**：如果组件的异步操作可以通过 `onMounted` 中的异步调用处理（配合 loading 状态），不一定需要使用 Suspense。Suspense 更适合需要在渲染前就获取数据的场景——即数据是渲染的前置条件，而非可选的增强。

## 十二、总结

Vue 3 的 Teleport 和 Suspense 是两个强大但常被低估的内置组件。它们从框架层面解决了前端开发中的两个经典问题：

| 特性 | 解决的问题 | 典型应用 |
|------|-----------|---------|
| **Teleport** | DOM 层级限制 | 模态框、通知、下拉菜单、Tooltip |
| **Suspense** | 异步状态管理 | 数据加载、路由切换、异步表单 |

**关键要点回顾**：

1. **Teleport** 通过 `to` 属性将组件的 DOM 输出传送到指定容器，同时保持逻辑关系不变。注意 CSS 作用域和事件冒泡的差异。

2. **Suspense** 自动管理异步组件的加载状态，支持 `#default`、`#fallback`、`#error` 三个插槽，与 ErrorBoundary 配合实现完整的错误处理链。

3. **组合使用**时，先 Teleport 到目标位置，再在内部使用 Suspense 管理异步，这是构建复杂 UI 组件（如异步弹窗）的最佳模式。

4. 关注 **Vue 3.5+** 的新特性，包括 `defer` Teleport、`#error` 插槽和新的 Suspense 生命周期钩子。

在实际项目中，建议从路由级 Suspense 开始，逐步将 Teleport 应用到模态框和通知组件中。这两个 API 的组合使用，将极大地提升你的 Vue 3 应用的代码质量和用户体验。它们体现了 Vue 3 的设计哲学——将常见的开发模式内置到框架中，让开发者能够以声明式的方式解决复杂问题，而不是陷入命令式的状态管理泥潭。



## 相关阅读

- [Vue 3 Composition API 实战：ref reactive computed 最佳实践与响应式踩坑记录](/categories/前端/vue-3-composition-api-guide-ref-reactive-computed-best-practices/) — Vue 3 响应式系统基础与 Composition API 模式
- [Vue 3 + Pinia 状态管理实战：替代 Vuex 的现代方案与 B2C 电商踩坑记录](/categories/前端/vue-3-pinia-guide-vuex-b2c/) — Vue 3 状态管理方案选型与实践
- [Vue 3.5+ 新特性实战：useId/useTemplateRef/useDeferredValue](/categories/前端/Vue-3.5-新特性实战-useId-useTemplateRef-useDeferredValue-Composition-API最新进化与迁移指南/) — Vue 3 最新版本特性与迁移指南


---

> **参考资料**
> - [Vue 3 官方文档 - Teleport](https://vuejs.org/guide/built-ins/teleport.html)
> - [Vue 3 官方文档 - Suspense](https://vuejs.org/guide/built-ins/suspense.html)
> - [Vue RFC - Teleport](https://github.com/vuejs/rfcs/blob/master/active-rfcs/0025-teleport.md)
> - [Vue RFC - Suspense](https://github.com/vuejs/rfcs/blob/master/active-rfcs/0013-async-component-api.md)
