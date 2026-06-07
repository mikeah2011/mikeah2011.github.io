# CSS Container Queries 与 View Transitions

## 定义

**CSS Container Queries**（容器查询）让组件根据自身容器的尺寸（而非视口）调整样式，实现真正的组件级响应式设计。这是对传统 `@media` 查询的根本性超越——组件不再"知道自己在哪"，而是根据可用空间自动选择最优布局。

**View Transitions API** 是浏览器原生提供的页面/视图过渡方案，通过在 DOM 更新前后截取快照（Snapshot），自动创建从旧状态到新状态的动画。它替代了对 GSAP、Framer Motion 等 JS 动画库的依赖，提供标准化的过渡能力。

两者结合代表了响应式设计范式的根本转变：组件自适应 + 丝滑过渡。

## 核心原理

### Container Queries 核心语法

**container-type 属性**——定义容器的查询类型：

| 值 | 说明 | 使用场景 |
|---|---|---|
| `inline-size` | 仅追踪行内尺寸 | 最常用，适用于绝大多数布局 |
| `size` | 追踪行内和块方向尺寸 | 需要同时响应宽度和高度变化 |
| `style` | 追踪计算样式值 | 实验性，用于条件样式查询 |

```css
/* 容器声明 */
.card-wrapper {
  container-type: inline-size;
  container-name: card-container;
}

/* 简写语法 */
.sidebar {
  container: sidebar / inline-size;
}

/* 组件根据容器宽度自适应 */
@container card-container (min-width: 400px) {
  .card {
    display: flex;
    flex-direction: row;
  }
}

@container card-container (max-width: 399px) {
  .card {
    display: flex;
    flex-direction: column;
  }
}
```

**Container Query Units**——基于容器尺寸的相对单位：

| 单位 | 含义 |
|---|---|
| `cqw` | 容器宽度的 1% |
| `cqh` | 容器高度的 1% |
| `cqi` | 容器行内尺寸的 1% |
| `cqb` | 容器块尺寸的 1% |
| `cqmin` | cqi 和 cqb 中较小值 |
| `cqmax` | cqi 和 cqb 中较大值 |

```css
@container card (min-width: 400px) {
  .card__title {
    font-size: clamp(1rem, 3cqi, 2rem);
    padding: 2cqi;
  }
}
```

**container-name 命名**——当页面存在多个嵌套容器时，命名容器可精确控制查询目标，避免查询歧义。

### Container Queries vs Media Queries

两者是互补关系，不是替代关系：

- **Media Queries** → 页面级布局切换（侧边栏收起、导航模式变化）
- **Container Queries** → 组件级内容适配（文字大小、图片比例、布局方向）
- **两者结合** → 构建真正"可移植"的组件系统

### View Transitions 核心原理

**基本用法**：

```css
/* 基础启用（MPA 场景） */
@view-transition {
  navigation: auto;
}

/* 为参与过渡的元素命名 */
.hero-image {
  view-transition-name: hero;
}
```

**`::view-transition` 伪元素体系**：

- `::view-transition` — 过渡动画容器（fixed 定位覆盖全屏）
- `::view-transition-group(*)` — 所有过渡快照的基础样式
- `::view-transition-old(*)` — 旧视图快照
- `::view-transition-new(*)` — 新视图快照

```css
::view-transition-group(*) {
  animation-duration: 0.4s;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

::view-transition-old(hero) {
  animation: slide-out-left 0.4s ease-in-out;
}

::view-transition-new(hero) {
  animation: slide-in-right 0.4s ease-in-out;
}
```

**SPA 中的 JavaScript API**：

```typescript
// document.startViewTransition() 生命周期
const transition = document.startViewTransition(async () => {
  // DOM 更新逻辑
  await nextTick()
})
await transition.finished
```

**Cross-Document View Transitions（MPA 场景）**：

```html
<meta name="view-transition" content="same-origin">
```

### Vue 3 集成

**useId() for SSR-safe IDs**：Vue 3.5+ 的 `useId()` 解决 SSR 水合时 ID 不一致的问题，配合 View Transitions 的 `view-transition-name` 使用。

**Vue Router View Transitions 集成**：

```typescript
// composables/useViewTransition.ts
export function useViewTransition() {
  const isTransitioning = ref(false)

  async function startTransition(updateCallback: () => Promise<void> | void) {
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

**方向感知的页面过渡**：通过比较路由深度判断前进/后退方向，动态选择过渡动画（slide-forward / slide-backward）。

**响应式 Composable 配合**：使用 `ResizeObserver` 创建 `useContainerSize` composable，在 JS 层面同步感知容器尺寸，用于条件渲染策略（如紧凑模式下简化图表）。

## 实战案例

### 自适应产品卡片

利用 Container Queries 实现产品卡片在不同容器宽度下的三种布局模式：

- **紧凑模式**（< 200px）：隐藏评分，缩小字号
- **中等模式**（200-400px）：标准纵向布局
- **宽模式**（> 400px）：水平布局，图片固定 200px

### 骨架屏 + Container Queries

Skeleton 组件同样利用容器查询自适应布局，宽容器下水平排列图片和文本，窄容器下简化为纯文字骨架。

### 页面过渡动画系统

结合 `usePageTransition` composable + Vue Router 导航守卫 + View Transitions API 实现方向感知的页面过渡，同时提供 Vue `<Transition>` 作为降级方案。

详细代码参见博客文章：[CSS Container Queries + View Transitions 实战](/2026/06/05/css-container-queries-view-transitions-vue3/)

## 浏览器兼容性

| 特性 | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|
| Container Queries | ✅ 105+ | ✅ 110+ | ✅ 16+ | ✅ 105+ |
| @container 简写 | ✅ 111+ | ✅ 110+ | ✅ 16+ | ✅ 111+ |
| Container Query Units | ✅ 105+ | ✅ 110+ | ✅ 17+ | ✅ 105+ |
| View Transitions (SPA) | ✅ 111+ | ✅ 128+ | ✅ 18+ | ✅ 111+ |
| View Transitions (MPA) | ✅ 126+ | ❌ | ❌ | ✅ 126+ |

### 降级策略

- **Container Queries**：使用 `@supports (container-type: inline-size)` 检测，提供 Media Queries 作为后备
- **View Transitions**：检测 `document.startViewTransition` 存在性，自动降级到 Vue `<Transition>` 组件

```css
/* Progressive Enhancement 策略 */
.card { display: flex; flex-direction: column; }           /* 基础 */
@media (min-width: 768px) { .card { flex-direction: row; } }  /* 降级 */
@container card-container (min-width: 400px) { .card { flex-direction: row; } }  /* 增强 */
```

## 性能考量

- **Container Queries**：底层依赖 ResizeObserver（浏览器高度优化），优先使用 `inline-size` 而非 `size`，避免过深容器嵌套
- **View Transitions**：利用浏览器 Snapshot 机制，性能远优于 JS 动画；动画中优先使用 `transform` 和 `opacity`，避免触发重排
- **结合使用时**：避免在快速连续路由切换中创建过多过渡，使用 `activeTransition.finished` 等待上一过渡完成

## 相关概念

- [Vue3.5新特性](Vue3.5新特性.md) - useId 解决 SSR 水合 ID 不一致
- [Signals响应式范式](Signals响应式范式.md) - 响应式底层原理
- [Core-Web-Vitals性能治理](Core-Web-Vitals性能治理.md) - CLS 优化
- [Vite深度实战](Vite深度实战.md) - 构建工具支持

## 常见问题

### Container Queries 浏览器兼容性如何？
截至 2026 年，Container Queries 已获得所有主流浏览器支持（Chrome 105+、Firefox 110+、Safari 16+）。建议使用 `@supports` 特性查询做渐进增强，Media Queries 作为后备方案。

### container-type 对子元素布局有什么影响？
设置 `container-type: inline-size` 的元素会创建一个新的包含块（containing block），这意味着子元素中的 `position: absolute` 会相对于该容器定位而非最近的定位祖先。同时，该元素不能同时作为其他容器查询的被查询目标，否则会形成"查询循环"被浏览器忽略。

### View Transitions 与 Vue Router 集成有哪些坑？
1. Vue Router 是异步的，需在 DOM 更新完成后（`nextTick()`）再截取新快照
2. 快速连续导航需等待上一过渡完成再启动新过渡
3. SSR 环境中 `document.startViewTransition` 不存在，需做好客户端检测
4. `view-transition-name` 在列表渲染中需保证唯一性，建议用 `useId()` 或动态绑定

### View Transitions MPA 支持情况？
Cross-Document View Transitions（MPA 场景）目前仅 Chrome 126+ 和 Edge 126+ 支持，Firefox 和 Safari 尚未实现。SPA 场景支持更广泛。

## 参考资料

- [CSS Containment Module Level 3 - W3C](https://www.w3.org/TR/css-contain-3/)
- [View Transitions API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)
- [Container Queries - Chrome for Developers](https://developer.chrome.com/docs/css-ui/css-container-queries)
- [Vue Router Navigation Guards](https://router.vuejs.org/guide/advanced/navigation-guards.html)
