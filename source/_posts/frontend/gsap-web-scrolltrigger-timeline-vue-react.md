---

title: GSAP 3.x 实战：专业级 Web 动画引擎——ScrollTrigger、Timeline 与 Vue/React 组件的性能优化
keywords: [GSAP, Web, ScrollTrigger, Timeline, Vue, React, 专业级, 动画引擎, 组件的性能优化, 前端]
date: 2026-06-10 04:00:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- GSAP
- 动画
- ScrollTrigger
- Vue
- React
- 性能优化
- 前端性能
description: 深入解析 GSAP 3.x 动画引擎核心 API，实战演示 ScrollTrigger 滚动驱动动画、Timeline 复杂编排、Vue/React 组件集成，附完整性能优化方案与生产级代码示例。
---


## 概述

前端动画领域，CSS Animation 和 Web Animations API 各有局限——前者调试困难、后者兼容性堪忧。GSAP（GreenSock Animation Platform）3.x 作为业界标杆，提供了一套完整、高性能、跨浏览器的动画解决方案。

在 KKday B2C 项目中，落地页的滚动视差、产品卡片入场动画、价格切换过渡都依赖 GSAP。本文从实际项目经验出发，系统讲解 GSAP 3.x 的核心 API、ScrollTrigger 滚动驱动、Timeline 复杂编排，以及在 Vue 3 和 React 中的集成与性能优化。

## 核心概念

### GSAP vs CSS Animation vs Web Animations API

| 特性 | CSS Animation | Web Animations API | GSAP 3.x |
|------|---------------|-------------------|-----------|
| 性能 | GPU 加速 | GPU 加速 | GPU 加速 + 软件回退 |
| 调试 | DevTools 受限 | 控制台操作 | Timeline 可视化 |
| 浏览器兼容 | 现代浏览器 | 部分旧浏览器缺失 | IE9+ 全覆盖 |
| 复杂编排 | @keyframes 嵌套 | 链式调用 | Timeline 精确编排 |
| 滚动驱动 | 需 JS 辅助 | 需 JS | ScrollTrigger 原生 |
| 延迟/回调 | 需 setTimeout | 可用 | 内置完整事件系统 |

### 基础 API

```javascript
import { gsap } from 'gsap'

// 基础动画
gsap.to('.box', {
  x: 200,           // 水平位移 200px
  rotation: 360,    // 旋转 360 度
  duration: 1,      // 时长 1 秒
  ease: 'power2.out' // 缓动函数
})

// from：从指定状态动画到当前状态
gsap.from('.box', {
  opacity: 0,
  y: 50,
  duration: 0.8,
  ease: 'back.out(1.7)'
})

// fromTo：精确控制起止状态
gsap.fromTo('.box',
  { opacity: 0, scale: 0.5 },
  { opacity: 1, scale: 1, duration: 0.6 }
)
```

### Timeline 编排

Timeline 是 GSAP 最强大的编排工具，可以精确控制多个动画的时序关系：

```javascript
const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

tl
  // 按顺序执行
  .from('.hero-title', { y: 60, opacity: 0, duration: 0.8 })
  .from('.hero-subtitle', { y: 40, opacity: 0, duration: 0.6 }, '-=0.3')
  // 同时执行（用 '<' 标记）
  .from('.hero-cta', { scale: 0.8, opacity: 0, duration: 0.5 }, '<')
  // 延迟 0.2 秒后执行
  .from('.hero-image', { x: 100, opacity: 0, duration: 1 }, '+=0.2')
```

Timeline 位置参数：
- `'+=0.5'`：前一个动画结束后延迟 0.5 秒
- `'-=0.3'`：前一个动画结束前 0.3 秒重叠
- `'<0.2'`：前一个动画开始后 0.2 秒
- `'myLabel'`：跳到标记位置

### 缓动函数（Easing）

GSAP 内置丰富的缓动曲线，远超 CSS `ease`/`cubic-bezier`：

```javascript
// Power 系列（最常用）
'power1.in'    // 缓慢加速（轻微）
'power2.out'   // 快速减速（中等）
'power3.inOut' // S 形曲线（强烈）

// 弹性效果
'elastic.out(1, 0.3)' // 弹簧回弹

// 回弹效果
'back.out(1.7)' // 越过目标点后回弹

// Bounce（弹跳）
'bounce.out' // 落地弹跳效果

// 步进动画
'steps(5)' // 分 5 步执行（帧动画）
```

## 实战代码

### 1. ScrollTrigger 滚动驱动动画

ScrollTrigger 是 GSAP 最核心的插件，将动画与滚动位置绑定：

```javascript
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// 基础用法：元素进入视口时触发动画
gsap.from('.product-card', {
  y: 80,
  opacity: 0,
  duration: 0.8,
  stagger: 0.15, // 每个卡片延迟 0.15 秒
  scrollTrigger: {
    trigger: '.product-section',
    start: 'top 80%',   // 触发点：元素顶部到达视口 80% 位置
    end: 'top 30%',     // 结束点
    toggleActions: 'play none none reverse' // 进入播放，离开反向
  }
})

// 进度同步动画（滚动进度驱动动画进度）
gsap.to('.progress-bar', {
  scaleX: 1,
  transformOrigin: 'left center',
  ease: 'none',
  scrollTrigger: {
    trigger: '.content-section',
    start: 'top center',
    end: 'bottom center',
    scrub: true // 动画进度与滚动进度同步
  }
})

// 固定元素（视差效果）
gsap.to('.parallax-bg', {
  yPercent: -30,
  ease: 'none',
  scrollTrigger: {
    trigger: '.hero-section',
    start: 'top top',
    end: 'bottom top',
    scrub: true,
    pin: true // 固定元素
  }
})
```

### 2. 产品卡片入场动画（KKday 风格）

```javascript
// 产品列表分批入场
function initProductAnimations() {
  const cards = gsap.utils.toArray('.product-card')

  // 批次入场，避免一次性渲染太多
  cards.forEach((card, i) => {
    gsap.from(card, {
      y: 60,
      opacity: 0,
      duration: 0.7,
      delay: (i % 4) * 0.1, // 每行 4 张，行内错开
      ease: 'power2.out',
      scrollTrigger: {
        trigger: card,
        start: 'top 90%',
        toggleActions: 'play none none none'
      }
    })
  })

  // 价格数字滚动效果
  gsap.utils.toArray('.price-value').forEach(el => {
    const target = parseInt(el.dataset.price, 10)
    gsap.from(el, {
      textContent: 0,
      duration: 1.5,
      ease: 'power1.out',
      snap: { textContent: 1 },
      scrollTrigger: {
        trigger: el,
        start: 'top 85%'
      },
      onUpdate: function() {
        el.textContent = `¥${Math.round(parseFloat(el.textContent.replace('¥', ''))).toLocaleString()}`
      }
    })
  })
}
```

### 3. 复杂页面过渡 Timeline

```javascript
// 页面加载动画编排
function initPageEntrance() {
  const master = gsap.timeline()

  // 阶段 1：Header 展开
  master
    .from('.header', {
      y: -80,
      opacity: 0,
      duration: 0.6,
      ease: 'power3.out'
    })
    // 阶段 2：Hero 区域
    .from('.hero-badge', {
      scale: 0,
      rotation: -180,
      duration: 0.5,
      ease: 'back.out(1.7)'
    }, '-=0.2')
    .from('.hero-title', {
      y: 50,
      opacity: 0,
      duration: 0.7,
      ease: 'power3.out'
    }, '-=0.3')
    .from('.hero-description', {
      y: 30,
      opacity: 0,
      duration: 0.5
    }, '-=0.4')
    // 阶段 3：CTA 按钮弹入
    .from('.hero-cta-group', {
      scale: 0.8,
      opacity: 0,
      duration: 0.4,
      ease: 'back.out(2)'
    }, '-=0.2')
    // 阶段 4：Hero 图片滑入
    .from('.hero-image', {
      x: 150,
      opacity: 0,
      rotation: 5,
      duration: 1,
      ease: 'power2.out'
    }, '-=0.6')

  return master
}
```

## Vue 3 集成

### 响应式集成

Vue 3 中 GSAP 的关键在于生命周期管理和响应式数据绑定：

```vue
<template>
  <div ref="containerRef">
    <div v-for="item in items" :key="item.id" :ref="el => cardRefs[item.id] = el">
      <h3>{{ item.title }}</h3>
      <p>{{ item.description }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const props = defineProps({
  items: { type: Array, required: true }
})

const containerRef = ref(null)
const cardRefs = ref({})
const scrollTriggers = ref([])

// 创建动画
function createAnimations() {
  // 清理旧的 ScrollTrigger
  scrollTriggers.value.forEach(st => st.kill())
  scrollTriggers.value = []

  Object.values(cardRefs.value).forEach((el, i) => {
    if (!el) return

    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top 85%',
      onEnter: () => {
        gsap.from(el, {
          y: 50,
          opacity: 0,
          duration: 0.6,
          delay: i * 0.08,
          ease: 'power2.out'
        })
      },
      once: true // 只触发一次
    })
    scrollTriggers.value.push(st)
  })
}

onMounted(() => {
  createAnimations()
})

// 数据变化时重建动画
watch(() => props.items, () => {
  // 等待 DOM 更新
  nextTick(() => createAnimations())
})

onUnmounted(() => {
  scrollTriggers.value.forEach(st => st.kill())
})
</script>
```

### 自定义 Hook：useGSAPAnimation

```javascript
// composables/useGSAPAnimation.js
import { onMounted, onUnmounted, watch, nextTick } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function useGSAPAnimation(targetRef, options = {}) {
  const {
    animation = {},
    scrollTrigger = null,
    dependencies = []
  } = options

  let triggers = []
  let animations = []

  function setup() {
    cleanup()

    const el = targetRef.value
    if (!el) return

    const stConfig = scrollTrigger ? {
      ...scrollTrigger,
      trigger: scrollTrigger.trigger || el
    } : null

    const anim = gsap.from(el, {
      ...animation,
      scrollTrigger: stConfig
    })

    animations.push(anim)
    if (stConfig) triggers.push(anim.scrollTrigger)
  }

  function cleanup() {
    triggers.forEach(t => t.kill())
    animations.forEach(a => a.kill())
    triggers = []
    animations = []
  }

  onMounted(setup)
  onUnmounted(cleanup)

  if (dependencies.length) {
    watch(dependencies, () => nextTick(setup))
  }

  return { refresh: setup, kill: cleanup }
}
```

使用：

```vue
<template>
  <div ref="el">Hello GSAP</div>
</template>

<script setup>
import { ref } from 'vue'
import { useGSAPAnimation } from '@/composables/useGSAPAnimation'

const el = ref(null)
const isVisible = ref(false)

useGSAPAnimation(el, {
  animation: { y: 50, opacity: 0, duration: 0.8 },
  scrollTrigger: {
    start: 'top 80%',
    toggleActions: 'play none none reverse'
  },
  dependencies: [isVisible]
})
</script>
```

## React 集成

### useEffect + useRef 模式

```jsx
import { useRef, useEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

function ProductCard({ product, index }) {
  const cardRef = useRef(null)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    const anim = gsap.from(el, {
      y: 60,
      opacity: 0,
      duration: 0.7,
      delay: index * 0.1,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 90%',
        toggleActions: 'play none none none'
      }
    })

    return () => {
      anim.scrollTrigger?.kill()
      anim.kill()
    }
  }, [index])

  return (
    <div ref={cardRef} className="product-card">
      <h3>{product.name}</h3>
      <span className="price">¥{product.price}</span>
    </div>
  )
}
```

### 自定义 Hook：useGSAP

```javascript
// hooks/useGSAP.js
import { useRef, useEffect, useCallback } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function useGSAP(animationFn, deps = []) {
  const ref = useRef(null)
  const ctx = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // 创建 GSAP context（自动管理所有动画）
    ctx.current = gsap.context(() => {
      animationFn(el, gsap, ScrollTrigger)
    }, el)

    return () => ctx.current?.revert()
  }, deps)

  return ref
}

// 使用
function Hero() {
  const heroRef = useGSAP((el) => {
    const tl = gsap.timeline()

    tl.from(el.querySelector('.title'), {
      y: 50, opacity: 0, duration: 0.8
    })
    .from(el.querySelector('.subtitle'), {
      y: 30, opacity: 0, duration: 0.6
    }, '-=0.3')
  })

  return (
    <section ref={heroRef}>
      <h1 className="title">Welcome</h1>
      <p className="subtitle">Description</p>
    </section>
  )
}
```

### GSAP Context 最佳实践

React 的渲染机制容易导致动画残留。GSAP 3.11+ 提供 `gsap.context()` 解决：

```javascript
useEffect(() => {
  // gsap.context 自动追踪所有在回调内创建的动画和 ScrollTrigger
  const ctx = gsap.context(() => {
    gsap.to('.box', { x: 100 })
    ScrollTrigger.create({
      trigger: '.section',
      start: 'top center'
    })
  }, containerRef) // 指定作用域

  return () => ctx.revert() // 组件卸载时自动清理所有
}, [])
```

## 踩坑记录

### 1. ScrollTrigger 在条件渲染元素上失效

```javascript
// ❌ 错误：v-if 元素可能还未挂载
onMounted(() => {
  ScrollTrigger.create({
    trigger: '.conditional-item', // v-if 控制，可能不存在
    start: 'top 80%'
  })
})

// ✅ 正确：nextTick 后创建，或用 v-show 替代 v-if
onMounted(() => {
  nextTick(() => {
    ScrollTrigger.refresh() // 强制重新计算
  })
})

// ✅ 更好：用 v-show 保持 DOM 存在
// v-show 元素始终在 DOM 中，ScrollTrigger 能正确计算
```

### 2. 动画内存泄漏

```javascript
// ❌ 错误：组件卸载后动画仍在运行
onMounted(() => {
  gsap.to('.box', {
    x: 100,
    repeat: -1, // 无限重复
    duration: 2
  })
})

// ✅ 正确：在 onUnmounted 中清理
let anim
onMounted(() => {
  anim = gsap.to('.box', {
    x: 100,
    repeat: -1,
    duration: 2
  })
})
onUnmounted(() => {
  anim.kill()
})
```

### 3. Resize 后 ScrollTrigger 位置错乱

```javascript
// 窗口大小变化后需要刷新 ScrollTrigger
import { useDebounceFn } from '@vueuse/core'

const { run: refreshST } = useDebounceFn(() => {
  ScrollTrigger.refresh()
}, 300)

onMounted(() => {
  window.addEventListener('resize', refreshST)
})
onUnmounted(() => {
  window.removeEventListener('resize', refreshST)
})
```

### 4. React 严格模式双重挂载

```javascript
// React 18 严格模式会执行两次 useEffect
// 第一次创建，第二次清理→再创建，导致动画卡顿

// ✅ 解决：使用 gsap.context
useEffect(() => {
  const ctx = gsap.context(() => {
    // 动画代码
  }, containerRef)

  return () => ctx.revert()
}, [])
```

### 5. CSS transform 与 GSAP 冲突

```css
/* ❌ CSS 定义了 transform 会覆盖 GSAP 的值 */
.box {
  transform: translateX(0); /* GSAP 的 x 动画会被覆盖 */
}

/* ✅ CSS 只定义不影响动画的属性 */
.box {
  background: #fff;
  border-radius: 8px;
}
/* transform 完全交给 GSAP 管理 */
```

### 6. 动画性能优化

```javascript
// ❌ 动画 layout 属性（触发重排）
gsap.to('.box', { width: 200, height: 100 }) // 触发 reflow

// ✅ 动画 compositor 属性（仅 GPU 合成）
gsap.to('.box', { scale: 1.5, x: 200 }) // 只触发合成

// ✅ 强制 GPU 加速
gsap.to('.box', {
  x: 200,
  force3D: true // 强制 transform: translateZ(0)
})

// ✅ 批量动画使用 stagger 而非 forEach
// ❌ forEach 创建 100 个独立动画
items.forEach((item, i) => {
  gsap.from(item, { opacity: 0, delay: i * 0.05 })
})

// ✅ stagger 合并为一个动画实例
gsap.from(items, {
  opacity: 0,
  stagger: 0.05
})
```

## 性能优化清单

### 渲染层面

1. **只动画 compositor 属性**：`transform`、`opacity`、`filter`
2. **开启 GPU 加速**：对频繁动画的元素设置 `will-change: transform`
3. **使用 `force3D: true`**：强制提升到合成层
4. **避免同时动画大量元素**：超过 30 个用 stagger + 批次控制

### 代码层面

5. **使用 `gsap.context()`**：React/Vue 组件中自动管理动画生命周期
6. **ScrollTrigger 用 `once: true`**：只触发动画一次，减少监听
7. **批量创建而非循环**：`gsap.from(array, { stagger })` 优于 forEach
8. **`scrollTrigger.toggleActions`** 精确控制进出行为

### 加载层面

9. **按需导入插件**：`import { ScrollTrigger } from 'gsap/ScrollTrigger'`
10. **延迟非首屏动画**：首屏动画优先，其余用 IntersectionObserver 延迟注册
11. **CDN + gzip**：GSAP gzip 后仅 ~22KB，配合 CDN 缓存效果好

### 监控层面

12. **DevTools 面板**：GSAP 官方插件 `gsap.debug` 可视化 Timeline
13. **Lighthouse 审计**：关注 CLS（布局偏移），动画触发 reflow 会增加 CLS
14. **requestAnimationFrame 对齐**：GSAP 默认已优化，但自定义逻辑需要手动对齐

## 总结

GSAP 3.x 的核心价值在于：

- **Timeline**：复杂动画编排变得可读、可维护
- **ScrollTrigger**：滚动驱动动画的最佳解决方案，一行代码搞定视差、进度条、固定元素
- **缓动系统**：内置 30+ 缓动函数，远超 CSS `cubic-bezier` 的表达力
- **框架集成**：Vue 用 `onUnmounted` + `watch`，React 用 `gsap.context()` + `useRef`

在实际项目中的选型建议：

| 场景 | 推荐方案 |
|------|----------|
| 简单 hover 过渡 | CSS `transition` |
| 入场/退场动画 | GSAP `from`/`fromTo` |
| 滚动驱动 | GSAP `ScrollTrigger` |
| 多元素编排 | GSAP `Timeline` |
| 路由页面过渡 | Vue `<Transition>` + GSAP |

动画不是装饰，是用户体验的一部分。用 GSAP 做到「流畅但不花哨」，才是生产级的动画哲学。