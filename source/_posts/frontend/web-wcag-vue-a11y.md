---

title: Web 无障碍 (WCAG 2.2) 实战：Vue 3 项目的 a11y 治理——语义化、键盘导航与屏幕阅读器适配
keywords: [Web, WCAG, Vue, a11y, 无障碍, 项目的, 治理, 语义化, 键盘导航与屏幕阅读器适配]
date: 2026-06-02 10:00:00
tags:
- WCAG
- a11y
- Vue
- 无障碍
- 前端
categories:
- frontend
description: 本文系统讲解如何在 Vue 3 项目中实施 WCAG 2.2 无障碍标准，涵盖 POUR 四大原则、语义化 HTML、ARIA 属性使用、键盘导航陷阱解决方案、屏幕阅读器焦点管理与 Live Region 实现，并通过 axe-core 和 Playwright 搭建自动化无障碍回归测试体系，帮助前端团队建立可持续的 a11y 治理流程。
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---




## 前言

Web 无障碍（Accessibility，简称 a11y）不仅是道德责任，在许多国家和地区已成为法律要求。欧盟《欧洲无障碍法案》（European Accessibility Act）自 2025 年 6 月起对数字产品强制执行无障碍标准，美国的 ADA 诉讼每年导致数百家企业面临法律风险。

WCAG 2.2（Web Content Accessibility Guidelines）于 2023 年 10 月正式发布，在 2.1 的基础上新增了 9 个成功标准，特别关注认知无障碍和移动设备适配。本文将带你系统性地在 Vue 3 项目中实施 WCAG 2.2 标准，涵盖语义化 HTML、ARIA 使用、键盘导航、屏幕阅读器适配和自动化测试。

---

## 第一章：WCAG 2.2 核心概念

### 1.1 POUR 四大原则

WCAG 围绕四大原则构建，每条原则下包含若干成功标准：

```
POUR 原则
├── Perceivable（可感知）
│   ├── 1.1 替代文本
│   ├── 1.2 时间媒体替代
│   ├── 1.3 适应性
│   ├── 1.4 可辨别
│   └── 新增: 1.3.4 方向 (Level AA)
├── Operable（可操作）
│   ├── 2.1 键盘可访问
│   ├── 2.2 足够时间
│   ├── 2.3 癫痫安全
│   ├── 2.4 可导航
│   ├── 2.5 输入方式
│   └── 新增: 2.4.11 焦点不被遮挡 (Level AA)
├── Understandable（可理解）
│   ├── 3.1 可读
│   ├── 3.2 可预测
│   ├── 3.3 输入辅助
│   └── 新增: 3.2.6 一致的帮助 (Level A)
└── Robust（健壮性）
    └── 4.1 兼容
        新增: 4.1.6 状态变化的 status messages (Level A)
```

### 1.2 WCAG 2.2 新增标准详解

WCAG 2.2 新增 9 个成功标准（其中 3 个是 AAA 级别），以下是重点新增标准：

**2.4.11 Focus Not Obscured (Minimum) - Level AA**
当用户界面组件获得键盘焦点时，该组件不能被作者创建的内容完全隐藏。这意味着 sticky header、cookie banner、toast 通知等浮动元素不能完全遮挡焦点元素。

**2.4.12 Focus Not Obscured (Enhanced) - Level AAA**
更严格的版本：焦点组件不能被任何内容遮挡（即使是部分遮挡）。

**2.4.13 Focus Appearance - Level AAA**
焦点指示器的面积至少为焦点控件周长的 2 个 CSS 像素，对比度至少为 3:1。

**2.5.7 Dragging Movements - Level AA**
任何使用拖拽操作的功能，必须可以通过单指操作（非拖拽）完成。例如，可拖拽排序的列表需要提供上下移动按钮。

**2.5.8 Target Size (Minimum) - Level AA**
触摸目标或鼠标点击目标的最小尺寸为 24×24 CSS 像素（除非在句子中、被用户代理控制、或有等效替代）。

**3.2.6 Consistent Help - Level A**
如果一个页面序列包含帮助机制（如聊天窗口、电话号码），该帮助机制在每个页面上应该位于一致的位置。

**3.3.7 Redundant Entry - Level A**
用户在某个流程步骤中已经输入的信息，在后续步骤中不应要求再次输入（除非有必要）。

**3.3.8 Accessible Authentication (Minimum) - Level AA**
认证过程中不能要求认知功能测试（如记忆密码、解谜），除非提供替代方案。支持密码管理器自动填充。

### 1.3 合规级别

| 级别 | 含义 | 常见标准 |
|------|------|---------|
| Level A | 最基本的无障碍要求 | 替代文本、键盘可访问、页面标题 |
| Level AA | 推荐的合规目标 | 色彩对比度 4.5:1、焦点可见、响应式 |
| Level AAA | 最高标准 | 对比度 7:1、手语翻译、阅读级别 |

大多数组织以 **Level AA** 为目标，这是法律合规的常见要求。

---

## 第二章：语义化 HTML——无障碍的地基

### 2.1 为什么语义化是第一优先级

很多开发者一提到无障碍就想到 ARIA 属性，但实际上 **正确的语义化 HTML 比 ARIA 重要 10 倍**。ARIA 只是弥补原生语义不足的手段。

```html
<!-- ❌ 错误：无语义的 div 堆砌 -->
<div class="header">
  <div class="nav">
    <div class="nav-item" onclick="goHome()">首页</div>
    <div class="nav-item" onclick="goAbout()">关于</div>
  </div>
</div>
<div class="main">
  <div class="title">文章标题</div>
  <div class="content">文章内容...</div>
</div>

<!-- ✅ 正确：语义化 HTML -->
<header>
  <nav aria-label="主导航">
    <ul>
      <li><a href="/">首页</a></li>
      <li><a href="/about">关于</a></li>
    </ul>
  </nav>
</header>
<main>
  <h1>文章标题</h1>
  <article>
    <p>文章内容...</p>
  </article>
</main>
```

屏幕阅读器用户可以通过语义标签快速跳转到页面的不同区域，而无语义的 div 堆砌对辅助技术来说是一堵墙。

### 2.2 语义化元素速查表

| 语义元素 | 用途 | 屏幕阅读器行为 |
|---------|------|--------------|
| `<header>` | 页头区域 | 标记为 "banner" landmark |
| `<nav>` | 导航区域 | 标记为 "navigation" landmark |
| `<main>` | 主要内容区 | 标记为 "main" landmark |
| `<aside>` | 侧边栏 | 标记为 "complementary" landmark |
| `<footer>` | 页脚区域 | 标记为 "contentinfo" landmark |
| `<section>` | 文档分区 | 可被 `<h1>`-`<h6>` 标题标注 |
| `<article>` | 独立内容单元 | 可被导航到的独立区域 |
| `<h1>`-`<h6>` | 标题层级 | 形成页面大纲，可跳转 |
| `<ul>`/`<ol>` | 列表 | 告知列表项数量 |
| `<button>` | 按钮 | 可点击、可激活、有键盘交互 |
| `<a>` | 链接 | 可激活、带 href 的可跳转 |
| `<table>` | 数据表格 | 可导航行列、读取表头 |

### 2.3 Vue 3 中的语义化实践

**组件设计原则**：组件应该输出语义化 HTML，而不是依赖 `div` 堆叠。

```vue
<!-- ❌ BadSemanticCard.vue -->
<template>
  <div class="card" @click="handleClick">
    <div class="card-header">{{ title }}</div>
    <div class="card-body">{{ description }}</div>
    <div class="card-footer">
      <div class="btn" @click.stop="handleAction">操作</div>
    </div>
  </div>
</template>

<!-- ✅ GoodSemanticCard.vue -->
<template>
  <article class="card" :aria-labelledby="titleId">
    <h3 :id="titleId" class="card-title">{{ title }}</h3>
    <p class="card-description">{{ description }}</p>
    <footer class="card-footer">
      <button type="button" class="btn" @click="handleAction">操作</button>
    </footer>
  </article>
</template>

<script setup>
import { computed, useId } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, required: true },
})

const emit = defineEmits(['action'])

const titleId = computed(() => `card-title-${useId()}`)

const handleAction = () => emit('action')
</script>
```

---

## 第三章：ARIA 角色、状态与属性

### 3.1 ARIA 五条规则

使用 ARIA 前，先牢记五条规则：

1. **优先使用原生 HTML 元素**：`<button>` 优于 `<div role="button">`
2. **不要改变原生语义**：不要给 `<h2>` 添加 `role="tab"`
3. **所有交互式 ARIA 控件必须是键盘可操作的**
4. **不要给焦点元素添加 `role="presentation"` 或 `aria-hidden="true"`**
5. **所有交互式元素必须有可访问的名称**

### 3.2 常用 ARIA 属性速查

**角色（Roles）**：

```html
<div role="alert">紧急通知</div>
<div role="tablist">
  <button role="tab" aria-selected="true">Tab 1</button>
  <button role="tab" aria-selected="false">Tab 2</button>
</div>
<div role="tabpanel">Tab 1 内容</div>
<div role="dialog" aria-modal="true">对话框内容</div>
<div role="status">3 条新消息</div>
<div role="progressbar" aria-valuenow="75" aria-valuemin="0" aria-valuemax="100">75%</div>
```

**状态与属性**：

```html
<!-- 控件状态 -->
<button aria-pressed="true">已收藏</button>
<input aria-invalid="true" aria-errormessage="email-error" />
<div aria-expanded="true">展开的内容</div>
<input aria-disabled="true" />

<!-- 关系 -->
<label for="email">邮箱</label>
<input id="email" aria-describedby="email-hint" />
<p id="email-hint">我们不会分享你的邮箱</p>

<div id="password-error">密码至少需要 8 个字符</div>
<input type="password" aria-errormessage="password-error" aria-invalid="true" />

<!-- 实时区域 -->
<div aria-live="polite">购物车已更新（2 件商品）</div>
<div aria-live="assertive">错误：网络连接断开</div>
```

### 3.3 Vue 3 中的 ARIA 组件封装

```vue
<!-- AccessibleAlert.vue -->
<template>
  <div
    role="alert"
    :aria-live="urgent ? 'assertive' : 'polite'"
    :class="['alert', `alert--${type}`]"
    v-bind="$attrs"
  >
    <span class="alert__icon" aria-hidden="true">{{ icon }}</span>
    <div class="alert__content">
      <strong v-if="title" class="alert__title">{{ title }}</strong>
      <p class="alert__message"><slot /></p>
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="alert__close"
      :aria-label="`关闭${title || '通知'}`"
      @click="$emit('dismiss')"
    >
      <span aria-hidden="true">&times;</span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  type: { type: String, default: 'info', validator: v => ['info', 'success', 'warning', 'error'].includes(v) },
  title: { type: String, default: '' },
  urgent: { type: Boolean, default: false },
  dismissible: { type: Boolean, default: false },
})

defineEmits(['dismiss'])
defineOptions({ inheritAttrs: false })

const icon = computed(() => ({
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
})[props.type])
</script>
```

---

## 第四章：键盘导航——无障碍的操作基础

### 4.1 Tab 顺序管理

浏览器默认的 Tab 顺序遵循 DOM 顺序。确保：

1. 语义化 HTML 让 Tab 顺序自然合理
2. 使用 `tabindex="0"` 将非交互元素加入 Tab 序列
3. 使用 `tabindex="-1"` 让元素可编程聚焦但不在 Tab 序列中
4. **永远不要使用 `tabindex > 0`**，它会打乱全局 Tab 顺序

```vue
<!-- TabOrderDemo.vue -->
<template>
  <div>
    <!-- 自然顺序：语义化元素自动在 Tab 序列中 -->
    <button @click="handleFirst">第一个可聚焦</button>
    <a href="/somewhere">链接</a>
    <input type="text" placeholder="输入框" />

    <!-- tabindex="0"：手动加入 Tab 序列 -->
    <div
      tabindex="0"
      role="button"
      :aria-pressed="isActive.toString()"
      @click="toggleActive"
      @keydown.enter="toggleActive"
      @keydown.space.prevent="toggleActive"
    >
      自定义按钮
    </div>

    <!-- tabindex="-1"：可编程聚焦，不在 Tab 序列 -->
    <div
      ref="skipTarget"
      tabindex="-1"
      class="skip-target"
    >
      跳转目标区域
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const isActive = ref(false)
const skipTarget = ref(null)

const toggleActive = () => {
  isActive.value = !isActive.value
}

const focusSkipTarget = () => {
  skipTarget.value?.focus()
}
</script>
```

### 4.2 焦点陷阱（Focus Trap）

模态对话框、下拉菜单等组件需要实现焦点陷阱——当组件打开时，Tab 键只在组件内部循环。

```vue
<!-- useFocusTrap.vue (Composable) -->
<script>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

export function useFocusTrap(containerRef, options = {}) {
  const { onEscape, autoFocus = true } = options
  let previouslyFocusedElement = null

  const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable]',
  ].join(', ')

  function getFocusableElements() {
    if (!containerRef.value) return []
    return Array.from(containerRef.value.querySelectorAll(FOCUSABLE_SELECTORS))
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault()
      onEscape()
      return
    }

    if (event.key !== 'Tab') return

    const focusable = getFocusableElements()
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey) {
      // Shift+Tab: 从第一个元素跳到最后一个
      if (document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    } else {
      // Tab: 从最后一个元素跳到第一个
      if (document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  function activate() {
    previouslyFocusedElement = document.activeElement
    document.addEventListener('keydown', handleKeydown)

    if (autoFocus) {
      nextTick(() => {
        const focusable = getFocusableElements()
        if (focusable.length > 0) {
          focusable[0].focus()
        }
      })
    }
  }

  function deactivate() {
    document.removeEventListener('keydown', handleKeydown)
    if (previouslyFocusedElement && previouslyFocusedElement.focus) {
      previouslyFocusedElement.focus()
    }
  }

  onMounted(activate)
  onUnmounted(deactivate)

  return { activate, deactivate, getFocusableElements }
}
</script>
```

### 4.3 Roving Tabindex（漫游 tabindex）

用于工具栏、标签页、菜单等组件组。整个组只有一个元素在 Tab 序列中（`tabindex="0"`），其他元素为 `tabindex="-1"`，通过方向键在组内切换焦点。

```vue
<!-- AccessibleTabs.vue -->
<template>
  <div class="tabs">
    <div role="tablist" :aria-label="label" class="tabs__list" @keydown="handleKeydown">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.id"
        :id="`tab-${tab.id}`"
        role="tab"
        :aria-selected="(activeIndex === index).toString()"
        :aria-controls="`panel-${tab.id}`"
        :tabindex="activeIndex === index ? 0 : -1"
        class="tabs__tab"
        :class="{ 'tabs__tab--active': activeIndex === index }"
        @click="selectTab(index)"
        ref="tabRefs"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      v-for="(tab, index) in tabs"
      :key="`panel-${tab.id}`"
      :id="`panel-${tab.id}`"
      role="tabpanel"
      :aria-labelledby="`tab-${tab.id}`"
      :tabindex="0"
      :hidden="activeIndex !== index"
      class="tabs__panel"
    >
      <slot :name="tab.id" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'

const props = defineProps({
  tabs: {
    type: Array,
    required: true,
    // [{ id: 'tab1', label: '标签 1' }, ...]
  },
  label: { type: String, default: '标签页导航' },
  modelValue: { type: Number, default: 0 },
})

const emit = defineEmits(['update:modelValue'])

const activeIndex = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const tabRefs = ref([])

function selectTab(index) {
  activeIndex.value = index
  nextTick(() => {
    tabRefs.value[index]?.focus()
  })
}

function handleKeydown(event) {
  const { tabs } = props
  let newIndex = activeIndex.value

  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      event.preventDefault()
      newIndex = (activeIndex.value + 1) % tabs.length
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      event.preventDefault()
      newIndex = (activeIndex.value - 1 + tabs.length) % tabs.length
      break
    case 'Home':
      event.preventDefault()
      newIndex = 0
      break
    case 'End':
      event.preventDefault()
      newIndex = tabs.length - 1
      break
    default:
      return
  }

  selectTab(newIndex)
}
</script>
```

### 4.4 跳过导航链接（Skip Links）

页面顶部应提供跳过导航的链接，让键盘用户可以快速到达主要内容：

```vue
<!-- SkipLink.vue -->
<template>
  <a
    href="#main-content"
    class="skip-link"
    @click.prevent="skipToMain"
  >
    跳转到主要内容
  </a>
</template>

<script setup>
function skipToMain() {
  const main = document.getElementById('main-content')
  if (main) {
    main.setAttribute('tabindex', '-1')
    main.focus()
    main.removeAttribute('tabindex')
  }
}
</script>

<style scoped>
.skip-link {
  position: absolute;
  top: -100%;
  left: 0;
  z-index: 9999;
  padding: 12px 24px;
  background: #1a1a2e;
  color: #fff;
  font-weight: 600;
  text-decoration: none;
  border-radius: 0 0 8px 0;
  transition: top 0.2s;
}

.skip-link:focus {
  top: 0;
}
</style>
```

在 `App.vue` 中使用：

```vue
<template>
  <SkipLink />
  <header>...</header>
  <nav>...</nav>
  <main id="main-content" tabindex="-1">
    <router-view />
  </main>
  <footer>...</footer>
</template>
```

---

## 第五章：屏幕阅读器适配

### 5.1 主流屏幕阅读器

| 屏幕阅读器 | 平台 | 浏览器支持 | 市场份额 |
|-----------|------|-----------|---------|
| NVDA | Windows | Firefox, Chrome | ~40% |
| JAWS | Windows | Chrome, Edge | ~35% |
| VoiceOver | macOS/iOS | Safari | ~15% |
| TalkBack | Android | Chrome | ~7% |
| Narrator | Windows | Edge | ~3% |

### 5.2 aria-live 实时区域

当页面内容动态变化时，屏幕阅读器需要被通知。`aria-live` 属性告诉辅助技术哪些区域的变化需要播报。

```vue
<!-- AccessibleNotification.vue -->
<template>
  <div
    :aria-live="level"
    :aria-atomic="true"
    role="status"
    class="sr-only"
    ref="liveRegion"
  >
    {{ message }}
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  message: { type: String, default: '' },
  level: { type: String, default: 'polite' }, // 'polite' | 'assertive' | 'off'
})

const liveRegion = ref(null)

// 确保消息变化时触发播报
watch(() => props.message, (newMsg) => {
  if (newMsg && liveRegion.value) {
    // 清空后重新设置，确保变化被检测到
    liveRegion.value.textContent = ''
    requestAnimationFrame(() => {
      liveRegion.value.textContent = newMsg
    })
  }
})
</script>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
</style>
```

### 5.3 表单无障碍

表单是无障碍最关键的交互区域：

```vue
<!-- AccessibleForm.vue -->
<template>
  <form @submit.prevent="handleSubmit" novalidate>
    <!-- 邮箱字段 -->
    <div class="form-group">
      <label for="email" class="form-label">
        邮箱地址
        <span class="required" aria-hidden="true">*</span>
      </label>
      <input
        id="email"
        v-model="form.email"
        type="email"
        required
        autocomplete="email"
        :aria-invalid="errors.email ? 'true' : 'false'"
        :aria-describedby="[
          'email-hint',
          errors.email ? 'email-error' : null
        ].filter(Boolean).join(' ')"
        :aria-required="'true'"
        @blur="validateEmail"
      />
      <p id="email-hint" class="form-hint">
        我们会发送确认邮件，不会用于营销
      </p>
      <p
        v-if="errors.email"
        id="email-error"
        class="form-error"
        role="alert"
      >
        {{ errors.email }}
      </p>
    </div>

    <!-- 密码字段 -->
    <div class="form-group">
      <label for="password" class="form-label">
        密码
        <span class="required" aria-hidden="true">*</span>
      </label>
      <div class="password-wrapper">
        <input
          id="password"
          v-model="form.password"
          :type="showPassword ? 'text' : 'password'"
          required
          autocomplete="new-password"
          :aria-invalid="errors.password ? 'true' : 'false'"
          :aria-describedby="[
            'password-hint',
            'password-strength',
            errors.password ? 'password-error' : null
          ].filter(Boolean).join(' ')"
          aria-required="true"
          @input="checkPasswordStrength"
          @blur="validatePassword"
        />
        <button
          type="button"
          class="password-toggle"
          :aria-label="showPassword ? '隐藏密码' : '显示密码'"
          :aria-pressed="showPassword.toString()"
          @click="showPassword = !showPassword"
        >
          <span aria-hidden="true">{{ showPassword ? '🙈' : '👁️' }}</span>
        </button>
      </div>
      <p id="password-hint" class="form-hint">
        至少 8 个字符，包含大小写字母和数字
      </p>
      <div
        id="password-strength"
        class="password-strength"
        role="progressbar"
        :aria-valuenow="passwordStrength.score"
        aria-valuemin="0"
        aria-valuemax="4"
        :aria-label="`密码强度：${passwordStrength.label}`"
      >
        <div
          class="password-strength__bar"
          :style="{ width: `${(passwordStrength.score / 4) * 100}%` }"
          :class="`password-strength__bar--${passwordStrength.level}`"
        />
      </div>
      <p
        v-if="errors.password"
        id="password-error"
        class="form-error"
        role="alert"
      >
        {{ errors.password }}
      </p>
    </div>

    <!-- 错误汇总 -->
    <div
      v-if="hasErrors"
      class="error-summary"
      role="alert"
      tabindex="-1"
      ref="errorSummary"
    >
      <h3>表单包含 {{ errorCount }} 个错误</h3>
      <ul>
        <li v-for="(error, field) in errors" :key="field">
          <a :href="`#${field}`" @click.prevent="focusField(field)">
            {{ error }}
          </a>
        </li>
      </ul>
    </div>

    <button type="submit" class="btn btn--primary">提交</button>
  </form>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'

const form = ref({
  email: '',
  password: '',
})

const errors = ref({})
const showPassword = ref(false)
const passwordStrength = ref({ score: 0, label: '', level: '' })
const errorSummary = ref(null)

const hasErrors = computed(() => Object.keys(errors.value).length > 0)
const errorCount = computed(() => Object.keys(errors.value).length)

function validateEmail() {
  const email = form.value.email.trim()
  if (!email) {
    errors.value.email = '请输入邮箱地址'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.value.email = '请输入有效的邮箱地址'
  } else {
    delete errors.value.email
  }
}

function validatePassword() {
  const password = form.value.password
  if (!password) {
    errors.value.password = '请输入密码'
  } else if (password.length < 8) {
    errors.value.password = '密码至少需要 8 个字符'
  } else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
    errors.value.password = '密码需要包含大小写字母'
  } else {
    delete errors.value.password
  }
}

function checkPasswordStrength() {
  const password = form.value.password
  let score = 0
  if (password.length >= 8) score++
  if (/[A-Z]/.test(password)) score++
  if (/[a-z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  const levels = ['', '弱', '一般', '强', '非常强']
  const levelNames = ['', 'weak', 'fair', 'good', 'strong']
  passwordStrength.value = {
    score: Math.min(score, 4),
    label: levels[Math.min(score, 4)],
    level: levelNames[Math.min(score, 4)],
  }
}

function focusField(fieldName) {
  const el = document.getElementById(fieldName)
  if (el) el.focus()
}

async function handleSubmit() {
  validateEmail()
  validatePassword()

  if (hasErrors.value) {
    await nextTick()
    errorSummary.value?.focus()
    return
  }

  // 提交逻辑
}
</script>
```

---

## 第六章：Vue 3 Composition API 无障碍模式

### 6.1 可访问的模态对话框

```vue
<!-- AccessibleModal.vue -->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="modelValue"
        class="modal-overlay"
        @click.self="handleOverlayClick"
      >
        <div
          ref="dialogRef"
          role="dialog"
          :aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="descId"
          class="modal"
          @keydown.escape="handleEscape"
        >
          <div class="modal__header">
            <h2 :id="titleId" class="modal__title">
              <slot name="title" />
            </h2>
            <button
              type="button"
              class="modal__close"
              aria-label="关闭对话框"
              @click="close"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div :id="descId" class="modal__body">
            <slot />
          </div>
          <div class="modal__footer">
            <slot name="footer">
              <button type="button" class="btn" @click="close">取消</button>
              <button type="button" class="btn btn--primary" @click="confirm">确认</button>
            </slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick, onUnmounted, useId } from 'vue'
import { useFocusTrap } from './useFocusTrap'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  closeOnOverlay: { type: Boolean, default: true },
  closeOnEscape: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'confirm', 'close'])

const titleId = `modal-title-${useId()}`
const descId = `modal-desc-${useId()}`
const dialogRef = ref(null)
let previouslyFocused = null

// 焦点陷阱
useFocusTrap(dialogRef, {
  onEscape: () => {
    if (props.closeOnEscape) close()
  },
})

// 打开时保存焦点并锁定背景滚动
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen) {
    previouslyFocused = document.activeElement
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
    await nextTick()
    if (previouslyFocused?.focus) {
      previouslyFocused.focus()
    }
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
})

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function confirm() {
  emit('confirm')
}

function handleOverlayClick() {
  if (props.closeOnOverlay) close()
}

function handleEscape() {
  if (props.closeOnEscape) close()
}
</script>
```

### 6.2 可访问的下拉菜单

```vue
<!-- AccessibleDropdown.vue -->
<template>
  <div class="dropdown" @keydown="handleKeydown">
    <button
      ref="triggerRef"
      :aria-expanded="isOpen.toString()"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      class="dropdown__trigger"
      @click="toggle"
    >
      <slot name="trigger">
        {{ selectedLabel || placeholder }}
      </slot>
      <span aria-hidden="true" class="dropdown__arrow">▼</span>
    </button>

    <ul
      v-show="isOpen"
      :id="listboxId"
      ref="listRef"
      role="listbox"
      :aria-activedescendant="activeDescendant"
      class="dropdown__list"
    >
      <li
        v-for="(option, index) in options"
        :key="option.value"
        :id="`${listboxId}-option-${index}`"
        role="option"
        :aria-selected="(modelValue === option.value).toString()"
        :class="[
          'dropdown__option',
          { 'dropdown__option--active': activeIndex === index },
          { 'dropdown__option--selected': modelValue === option.value },
        ]"
        @click="selectOption(option)"
        @mouseenter="activeIndex = index"
      >
        {{ option.label }}
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, watch, useId } from 'vue'

const props = defineProps({
  options: { type: Array, required: true },
  modelValue: { type: [String, Number], default: null },
  placeholder: { type: String, default: '请选择...' },
})

const emit = defineEmits(['update:modelValue'])

const listboxId = `listbox-${useId()}`
const isOpen = ref(false)
const activeIndex = ref(-1)
const triggerRef = ref(null)
const listRef = ref(null)

const selectedLabel = computed(() =>
  props.options.find(o => o.value === props.modelValue)?.label
)

const activeDescendant = computed(() =>
  activeIndex.value >= 0 ? `${listboxId}-option-${activeIndex.value}` : undefined
)

function toggle() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    activeIndex.value = props.options.findIndex(o => o.value === props.modelValue)
    if (activeIndex.value === -1) activeIndex.value = 0
  }
}

function close() {
  isOpen.value = false
  activeIndex.value = -1
  triggerRef.value?.focus()
}

function selectOption(option) {
  emit('update:modelValue', option.value)
  close()
}

function handleKeydown(event) {
  if (!isOpen.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      toggle()
    }
    return
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      activeIndex.value = Math.min(activeIndex.value + 1, props.options.length - 1)
      break
    case 'ArrowUp':
      event.preventDefault()
      activeIndex.value = Math.max(activeIndex.value - 1, 0)
      break
    case 'Home':
      event.preventDefault()
      activeIndex.value = 0
      break
    case 'End':
      event.preventDefault()
      activeIndex.value = props.options.length - 1
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (activeIndex.value >= 0) {
        selectOption(props.options[activeIndex.value])
      }
      break
    case 'Escape':
      event.preventDefault()
      close()
      break
    case 'Tab':
      close()
      break
  }
}

// 点击外部关闭
function handleClickOutside(event) {
  if (isOpen.value && !event.target.closest('.dropdown')) {
    close()
  }
}

import { onMounted, onUnmounted } from 'vue'
onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))
</script>
```

---

## 第七章：WCAG 2.2 新增标准的具体实现

### 7.1 焦点不被遮挡（Focus Not Obscured）

当使用 sticky header 或 floating banner 时，确保焦点元素不会被完全遮挡：

```vue
<!-- App.vue -->
<template>
  <div class="app">
    <SkipLink />

    <!-- Sticky Header -->
    <header class="header" ref="headerRef">
      <nav>...</nav>
    </header>

    <!-- Cookie Banner - 确保不会遮挡焦点元素 -->
    <div
      v-if="showCookieBanner"
      class="cookie-banner"
      role="dialog"
      aria-label="Cookie 设置"
    >
      <p>我们使用 Cookie 来改善您的体验</p>
      <button @click="acceptCookies">接受</button>
      <button @click="rejectCookies">拒绝</button>
    </div>

    <!-- Main Content - 添加 padding 以补偿 sticky header 高度 -->
    <main
      id="main-content"
      :style="{ scrollPaddingTop: headerHeight + 'px' }"
    >
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const headerRef = ref(null)
const headerHeight = ref(0)
const showCookieBanner = ref(true)

onMounted(() => {
  if (headerRef.value) {
    headerHeight.value = headerRef.value.offsetHeight

    // 监听 resize 以更新高度
    const resizeObserver = new ResizeObserver((entries) => {
      headerHeight.value = entries[0].contentRect.height
    })
    resizeObserver.observe(headerRef.value)
  }
})

function acceptCookies() {
  showCookieBanner.value = false
  // 保存用户选择
}

function rejectCookies() {
  showCookieBanner.value = false
}
</script>

<style>
/* scroll-padding-top 确保锚点跳转不会被 sticky header 遮挡 */
html {
  scroll-padding-top: var(--header-height, 64px);
}

/* 焦点样式确保可见 */
:focus-visible {
  outline: 3px solid #4A90D9;
  outline-offset: 2px;
  border-radius: 2px;
}

/* 确保焦点元素不会被 sticky/fixed 元素遮挡 */
.cookie-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 16px;
  background: #1a1a2e;
  color: white;
}

/* 当 cookie banner 显示时，为底部内容添加 padding */
.cookie-banner-visible main {
  padding-bottom: 80px;
}
</style>
```

### 7.2 拖拽替代方案（Dragging Movements）

可拖拽排序的列表必须提供非拖拽的操作方式：

```vue
<!-- AccessibleSortableList.vue -->
<template>
  <div class="sortable-list">
    <ul role="list" :aria-label="label">
      <li
        v-for="(item, index) in items"
        :key="item.id"
        class="sortable-list__item"
        :class="{ 'sortable-list__item--dragging': dragIndex === index }"
        draggable="true"
        @dragstart="handleDragStart(index)"
        @dragover.prevent="handleDragOver(index)"
        @drop="handleDrop"
        @dragend="handleDragEnd"
      >
        <span class="sortable-list__content">
          <slot :item="item" :index="index">
            {{ item.label }}
          </slot>
        </span>

        <!-- 非拖拽操作按钮（WCAG 2.5.8） -->
        <div class="sortable-list__actions" role="group" aria-label="排序操作">
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="`将 ${item.label} 上移`"
            @click="moveItem(index, index - 1)"
            class="sortable-list__btn"
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            type="button"
            :disabled="index === items.length - 1"
            :aria-label="`将 ${item.label} 下移`"
            @click="moveItem(index, index + 1)"
            class="sortable-list__btn"
          >
            <span aria-hidden="true">↓</span>
          </button>
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="`将 ${item.label} 移至最前`"
            @click="moveItem(index, 0)"
            class="sortable-list__btn"
          >
            <span aria-hidden="true">⤒</span>
          </button>
          <button
            type="button"
            :disabled="index === items.length - 1"
            :aria-label="`将 ${item.label} 移至最后`"
            @click="moveItem(index, items.length - 1)"
            class="sortable-list__btn"
          >
            <span aria-hidden="true">⤓</span>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  modelValue: { type: Array, required: true },
  label: { type: String, default: '可排序列表' },
})

const emit = defineEmits(['update:modelValue'])

const items = ref([...props.modelValue])
const dragIndex = ref(null)

function moveItem(fromIndex, toIndex) {
  const newItems = [...items.value]
  const [moved] = newItems.splice(fromIndex, 1)
  newItems.splice(toIndex, 0, moved)
  items.value = newItems
  emit('update:modelValue', newItems)

  // 通知屏幕阅读器
  announceMove(moved.label, fromIndex, toIndex)
}

function announceMove(label, from, to) {
  const announcement = `${label} 已从第 ${from + 1} 位移至第 ${to + 1} 位`
  // 使用 aria-live 区域播报
  const liveRegion = document.getElementById('sortable-announcer')
  if (liveRegion) {
    liveRegion.textContent = ''
    requestAnimationFrame(() => {
      liveRegion.textContent = announcement
    })
  }
}

function handleDragStart(index) {
  dragIndex.value = index
}

function handleDragOver(index) {
  // 视觉反馈
}

function handleDrop() {
  // 拖拽完成
  dragIndex.value = null
}

function handleDragEnd() {
  dragIndex.value = null
}
</script>
```

### 7.3 触摸目标尺寸（Target Size Minimum）

WCAG 2.5.8 要求触摸目标最小 24×24 CSS 像素：

```css
/* 确保所有交互元素满足最小触摸目标 */
button,
a,
input[type="checkbox"],
input[type="radio"],
select,
[role="button"],
[role="link"],
[role="tab"] {
  min-width: 24px;
  min-height: 24px;
  /* 增加点击区域的技巧：使用 padding 或伪元素扩展 */
}

/* 对于图标按钮，确保触摸区域足够 */
.icon-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;    /* 推荐 44px（Apple HIG） */
  min-height: 44px;
  padding: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
}

/* 对于小文本链接，增加 padding */
.text-link {
  display: inline-block;
  padding: 4px 2px;
  min-height: 24px;
  line-height: 1.5;
}

/* 移动端增加触摸区域 */
@media (pointer: coarse) {
  button,
  a,
  [role="button"] {
    min-width: 44px;
    min-height: 44px;
  }
}
```

---

## 第八章：色彩对比度与视觉设计

### 8.1 对比度要求

| 元素类型 | WCAG AA | WCAG AAA |
|---------|---------|---------|
| 普通文本 (< 18px) | 4.5:1 | 7:1 |
| 大文本 (≥ 18px 或 14px bold) | 3:1 | 4.5:1 |
| UI 组件和图形 | 3:1 | - |
| 焦点指示器 | 3:1 | - |

### 8.2 对比度检测工具

```vue
<!-- ContrastChecker.vue - 开发辅助组件 -->
<template>
  <div class="contrast-checker">
    <div class="input-group">
      <label for="fg-color">前景色：</label>
      <input id="fg-color" v-model="foreground" type="color" />
      <span>{{ foreground }}</span>
    </div>
    <div class="input-group">
      <label for="bg-color">背景色：</label>
      <input id="bg-color" v-model="background" type="color" />
      <span>{{ background }}</span>
    </div>
    <div class="result">
      <p>对比度：<strong>{{ ratio }}:1</strong></p>
      <p :class="aaPass ? 'pass' : 'fail'">AA 普通文本（≥4.5:1）：{{ aaPass ? '✅ 通过' : '❌ 不通过' }}</p>
      <p :class="aaLargePass ? 'pass' : 'fail'">AA 大文本（≥3:1）：{{ aaLargePass ? '✅ 通过' : '❌ 不通过' }}</p>
      <p :class="aaaPass ? 'pass' : 'fail'">AAA 普通文本（≥7:1）：{{ aaaPass ? '✅ 通过' : '❌ 不通过' }}</p>
    </div>
    <div class="preview" :style="{ color: foreground, background: background }">
      示例文本 Sample Text
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const foreground = ref('#000000')
const background = ref('#FFFFFF')

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : { r: 0, g: 0, b: 0 }
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex)
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

const ratio = computed(() => {
  const l1 = relativeLuminance(foreground.value)
  const l2 = relativeLuminance(background.value)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return ((lighter + 0.05) / (darker + 0.05)).toFixed(2)
})

const aaPass = computed(() => parseFloat(ratio.value) >= 4.5)
const aaLargePass = computed(() => parseFloat(ratio.value) >= 3)
const aaaPass = computed(() => parseFloat(ratio.value) >= 7)
</script>
```

### 8.3 运动偏好适配

```css
/* 尊重用户的运动偏好 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Vue transition 尊重运动偏好 */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

@media (prefers-reduced-motion: reduce) {
  .slide-enter-active,
  .slide-leave-active {
    transition: none;
  }
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  :root {
    --text-color: #e4e4e7;
    --bg-color: #18181b;
    --link-color: #60a5fa;
  }
}

/* 高对比度模式 */
@media (prefers-contrast: high) {
  :root {
    --text-color: #000000;
    --bg-color: #ffffff;
    --border-color: #000000;
  }
}

/* 强制高对比度（Windows） */
@media (forced-colors: active) {
  .custom-button {
    border: 1px solid ButtonText;
    color: ButtonText;
    background: ButtonFace;
  }
}
```

---

## 第九章：自动化无障碍测试

### 9.1 axe-core 集成

axe-core 是最广泛使用的无障碍测试引擎：

```bash
npm install --save-dev @axe-core/vue @axe-core/cli
```

**Vue 插件模式（开发环境）**：

```typescript
// main.ts
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(router)

// 仅在开发环境启用 axe
if (import.meta.env.DEV) {
  import('@axe-core/vue').then(axe => {
    axe.default(app, {
      config: {
        rules: [
          // 自定义规则配置
          { id: 'color-contrast', enabled: true },
          { id: 'label', enabled: true },
          { id: 'aria-roles', enabled: true },
        ],
      },
      clearConsoleOnUpdate: false,
    })
  })
}

app.mount('#app')
```

### 9.2 Cypress 无障碍测试

```bash
npm install --save-dev cypress-axe
```

```javascript
// cypress/e2e/accessibility.cy.ts

describe('无障碍测试', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.injectAxe()
  })

  it('首页应该没有可检测的无障碍违规', () => {
    cy.checkA11y(null, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag22aa'],
      },
    })
  })

  it('模态对话框应该没有无障碍违规', () => {
    cy.get('[data-testid="open-modal"]').click()
    cy.get('[role="dialog"]').should('be.visible')
    cy.checkA11y('[role="dialog"]')
  })

  it('表单应该正确关联 label 和 input', () => {
    cy.get('form').within(() => {
      cy.checkA11y({
        runOnly: {
          type: 'rule',
          values: ['label', 'aria-valid-attr', 'color-contrast'],
        },
      })
    })
  })

  it('键盘导航应该正常工作', () => {
    // Tab 到第一个交互元素
    cy.get('body').tab()
    cy.focused().should('have.class', 'skip-link')

    // Tab 到导航
    cy.focused().tab()
    cy.focused().should('have.attr', 'role', 'navigation').or('be', 'nav')
  })
})
```

### 9.3 Playwright 无障碍测试

```typescript
// tests/accessibility.spec.ts

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('无障碍测试', () => {
  test('首页没有严重违规', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('深色模式下对比度合格', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('所有图片有替代文本', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page })
      .withRules(['image-alt'])
      .analyze()

    expect(results.violations).toEqual([])
  })
})
```

### 9.4 CI/CD 中的无障碍测试

```yaml
# .github/workflows/a11y.yml
name: Accessibility Tests

on: [push, pull_request]

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Start dev server
        run: npm run preview &
        timeout: 30
        env:
          PORT: 4173

      - name: Run axe tests
        run: |
          npx @axe-core/cli http://localhost:4173 \
            --tags wcag2a,wcag2aa,wcag22aa \
            --exit

      - name: Run Cypress a11y tests
        run: npx cypress run --spec "cypress/e2e/accessibility.cy.ts"
```

---

## 第十章：无障碍治理实践

### 10.1 渐进式治理路线图

```
Phase 1 (第 1-2 周)：基础语义化
├── 审查所有页面的 HTML 语义
├── 替换 div 为语义元素
├── 确保所有表单有关联的 label
└── 添加 skip link

Phase 2 (第 3-4 周)：键盘可访问性
├── 确保所有交互元素可通过键盘访问
├── 实现焦点陷阱（模态、下拉）
├── 添加可见的焦点样式
└── 测试 Tab 顺序

Phase 3 (第 5-6 周)：ARIA 与屏幕阅读器
├── 为动态内容添加 aria-live
├── 实现 ARIA 状态管理
├── 使用 NVDA/VoiceOver 进行人工测试
└── 修复屏幕阅读器发现的问题

Phase 4 (第 7-8 周)：自动化与持续集成
├── 集成 axe-core 到 CI/CD
├── 添加 Cypress/Playwright 无障碍测试
├── 建立无障碍回归测试基线
└── 培训团队成员
```

### 10.2 无障碍审查清单

```markdown
## 页面级审查清单

### 语义化
- [ ] 使用正确的 HTML5 语义元素（header, nav, main, aside, footer）
- [ ] 标题层级正确（h1 > h2 > h3，不跳级）
- [ ] 列表使用 ul/ol 而非 div
- [ ] 表格用于展示数据，而非布局

### 键盘
- [ ] 所有交互元素可通过 Tab 访问
- [ ] 焦点顺序与视觉顺序一致
- [ ] 焦点指示器清晰可见（≥3:1 对比度）
- [ ] 模态对话框实现了焦点陷阱
- [ ] 提供了跳过导航的链接
- [ ] 没有键盘陷阱（能用 Tab 离开所有元素）

### 表单
- [ ] 每个表单控件有关联的 label
- [ ] 错误信息通过 aria-invalid 和 aria-errormessage 关联
- [ ] 必填字段有 aria-required 或 required
- [ ] 自动填充支持（autocomplete 属性）

### 颜色与视觉
- [ ] 文本对比度满足 WCAG AA（4.5:1 普通文本，3:1 大文本）
- [ ] UI 组件对比度满足 3:1
- [ ] 不仅靠颜色传达信息（还有图标/文字）
- [ ] 支持浏览器缩放到 200% 无内容丢失

### 动态内容
- [ ] 动态变化的内容有 aria-live 通知
- [ ] 加载状态有适当的 aria 指示
- [ ] toast 通知可被屏幕阅读器感知
- [ ] 尊重 prefers-reduced-motion 偏好
```

---

## 总结

Web 无障碍不是可选的附加功能，而是现代 Web 开发的基本要求。通过本文的实践，你已经掌握了在 Vue 3 项目中实施 WCAG 2.2 的完整方法：

1. **语义化 HTML 是地基**：正确使用 HTML 元素比任何 ARIA 属性都重要
2. **键盘可访问是底线**：所有交互必须可以通过键盘完成
3. **屏幕阅读器适配是核心**：使用 aria-live、roles 和 states 让动态内容可感知
4. **自动化测试是保障**：将 axe-core 集成到 CI/CD 流程中
5. **渐进式治理是策略**：不可能一次性完成所有修复，分阶段推进

无障碍不仅帮助残障人士，也提升了所有用户的体验——更好的键盘导航、更清晰的焦点指示、更合理的语义结构，这些都是每个人受益的改进。

---

*参考资料*：
- [WCAG 2.2 规范](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA 创作实践](https://www.w3.org/WAI/ARIA/apd/)
- [axe-core 文档](https://github.com/dequelabs/axe-core)
- [Vue.js 无障碍指南](https://vuejs.org/guide/best-practices/accessibility.html)
- [WebAIM 对比度检查器](https://webaim.org/resources/contrastchecker/)

## 相关阅读

- [HTMX 实战：不用 JavaScript 框架也能做交互——Laravel + HTMX 超轻量前后端方案](/frontend/2026-06-02-HTMX-实战-不用JavaScript框架也能做交互-Laravel-HTMX超轻量前后端方案/)
- [Biome 实战：替代 ESLint + Prettier 的下一代前端工具链——Rust 驱动的超快格式化与检查](/frontend/Biome-实战-替代-ESLint-Prettier-的下一代前端工具链-Rust-驱动的超快格式化与检查/)
- [Vue 3 组件设计模式与最佳实践](/frontend/vue3-guide-ui/)
