---
title: "Framer Motion 实战：React/Vue 声明式动画库——Layout Animation、Shared Layout 与手势交互的生产级方案"
keywords: [Framer Motion, React, Vue, Layout Animation, Shared Layout, 声明式动画库, 与手势交互的生产级方案, 前端]
date: 2026-06-10 03:58:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
  - Framer Motion
  - React
  - Vue
  - Layout Animation
  - Shared Layout
  - 手势交互
  - 动画性能
description: "从设计原理、布局动画、Shared Layout、手势系统到性能优化，提供 React/Vue 的生产级 Framer Motion 实战方案与避坑经验。"
---


在真实业务里，动画不是为了炫技，而是为了传递状态、引导注意力和降低认知成本。Framer Motion 之所以值得投入，不是因为它能做很多动画，而是因为它在 React 生态下把布局动画、共享布局、手势系统和无障碍体验做成了相对一致的默认路径。

但这种“默认路径”也容易踩坑。很多团队在页面切换、列表重排、弹窗缩放、侧边栏展开等场景里，先写了一堆动画，后发现卡顿、闪烁、布局错位、可访问性缺失，最后回退到 `opacity + transform` 的“手工时代”。

这篇文章按生产落地路径来写：先理清布局动画与普通动画的区别，再讲 Shared Layout 在路由切换中的可靠实现，然后把手势从“交互细节”拉到“状态驱动”的高度，最后落到 React 与 Vue 的具体落地、性能测量、无障碍与回归测试。

## 为什么 Framer Motion 在业务系统里值得投入

普通动画解决的是“视觉过渡”问题，比如 hover、入场、出场、延迟节奏。布局动画解决的是“布局变化”问题，比如同一个元素从列表项变成全屏卡片、从按钮变成抽屉头部、从侧边栏收起到图标。后者更复杂，因为要保证元素在不同布局状态间拥有连续性，而不是“先消失再出现”。

Framer Motion 把这类连续性抽象成了三个关键能力：

1. **Layout Animation**：元素在布局变化时保持连续过渡，而不是从无到有重建。
2. **Shared Layout / LayoutGroup**：多个组件共享同一动画上下文，使不同组件之间的布局动画连续。
3. **Gesture System**：hover、press、pan、tap 不再是离散事件，而是可以驱动动画状态的输入源。

这三个能力叠加起来，能让页面状态变化变得自然，而不是靠硬写大量关键帧。

## 核心概念：Layout Animation 与普通动画的区别

普通动画通常围绕 `transform`、`opacity`、`scale`、`rotate` 展开。它们很高效，因为不触发布局重排，浏览器可以在合成层直接计算。

Layout Animation 的难点在于：元素的布局属性本身变了，比如：

- `width / height` 变化
- `position` 从 `static` 变成 `fixed / absolute`
- `top / left / right / bottom` 变化
- 父容器结构变化，导致子节点重新排列
- 列表项从 Grid/Flow 变成 Detail 页面

如果只是做普通动画，开发者只需要“加一个动画属性”。但布局变化需要回答两个问题：

- 这个元素现在和之前是不是“同一个东西”？
- 这个变化应该记录为动画还是直接结束？

Framer Motion 的 `layout` 属性就是围绕这两个问题设计的。它会在元素挂载和更新阶段计算布局差异，然后自动插值出过渡动画。也就是说，不是手动写 `from { top: 10px } to { top: 200px }`，而是让框架根据 DOM 布局变化自动组织过渡。

### Layout Animation 的典型场景

- 列表项点开成详情
- 卡片在 Grid 与 Detail 间切换
- 侧边栏收起/展开
- 抽屉弹出
- 瀑布流排序
- 多列看板拖拽
- 固定头信息跟随布局变化

如果只是 `opacity + transform`，这些场景要么做不到，要么需要大量手动测量 DOM。布局动画把“元素从 A 状态到 B 状态”统一抽象成连续动画，是很多中台、内容平台、电商详情页提升体验的关键能力。

## Shared Layout 的关键：把动画从“组件”提升到“布局上下文”

很多团队在做页面切换动画时，会遇到一个典型问题：目标元素在不同组件里，甚至在不同路由里。比如：

- 列表页的卡片组件
- 详情页的头图组件

这两个组件在 React/Vue 的组件树里是独立存在的。如果只靠组件状态，很难实现连续动画，因为“谁是谁”并不明确。

`LayoutGroup` / Shared Layout 的核心思想就是：用 `layoutId` 定义元素在布局上下文中的身份。只要两个组件声明了相同的 `layoutId`，框架就把它当成同一个布局元素，即使它们存在于不同的组件树位置。

这个思路在路由切换、Tab 切换、Modal 打开、Drawer 展开里非常实用。比如：

- 列表页卡片设置 `layoutId="product-image"`
- 详情页头图设置 `layoutId="product-image"`
- 进入详情时，框架自动完成从卡片到详情头图的布局过渡

这种做法比“先截图再做动画”更稳定，也更接近用户期望：你看到的是同一个东西在移动，而不是一个新东西在模仿旧东西。

## 在 React 里的生产级实现

React 是 Framer Motion 的主战场，很多问题都能得到“默认正确”的答案。下面给出一个典型的路由级共享布局动画方案。

```tsx
// ProductCard.tsx
import { motion } from "framer-motion";

export function ProductCard({
  id,
  title,
  imageUrl,
  onClick,
}: {
  id: string;
  title: string;
  imageUrl: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      layoutId={`product-${id}`}
      onClick={onClick}
      className="product-card"
    >
      <motion.img
        src={imageUrl}
        alt={title}
        layoutId={`product-image-${id}`}
      />
      <div className="product-card__body">
        <h3>{title}</h3>
      </div>
    </motion.button>
  );
}
```

```tsx
// ProductDetail.tsx
import { motion } from "framer-motion";

export function ProductDetail({
  id,
  title,
  imageUrl,
  onBack,
}: {
  id: string;
  title: string;
  imageUrl: string;
  onBack: () => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <header className="product-detail-header">
        <motion.img
          src={imageUrl}
          alt={title}
          layoutId={`product-image-${id}`}
          className="product-detail-header__image"
        />
        <motion.h1 layoutId={`product-title-${id}`} className="product-detail-header__title">
          {title}
        </motion.h1>
      </header>

      <button onClick={onBack}>返回列表</button>
      <section>商品详情内容...</section>
    </motion.article>
  );
}
```

关键点：

- `layoutId` 必须唯一且稳定，避免动态字符串导致身份漂移。
- 如果使用 React Router / Next.js，路由容器要用 `AnimatePresence`，否则退出动画不会触发。
- 大量共享布局元素建议放在同一个 `LayoutGroup`，避免不同上下文冲突。

## 路由切换动画的稳定模式

路由切换里最容易出问题的是“旧页面退出 + 新页面入场 + 共享元素过渡”同时发生。如果状态管理不当，会出现：

- 旧页面还没退出，新页面就覆盖了
- 共享元素闪烁两次
- 过渡动画中途被打断

比较稳妥的模式是把“退出动画”和“共享布局动画”分开控制：

```tsx
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useLocation, useRoutes } from "react-router-dom";

export function AppShell() {
  const location = useLocation();

  const routes = [
    {
      path: "/products",
      element: <ProductList />,
    },
    {
      path: "/products/:id",
      element: <ProductDetailPage />,
    },
  ];

  const element = useRoutes(routes, location);

  return (
    <LayoutGroup>
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {element}
        </motion.div>
      </AnimatePresence>
    </LayoutGroup>
  );
}
```

在这个结构里：

- `LayoutGroup` 为共享元素提供统一上下文。
- `AnimatePresence` 处理路由退出动画。
- 路由容器本身只做页面级过渡，不干扰共享元素动画。

这个分层方案在业务系统里更可控。如果全部都依赖共享布局动画做页面切换，很容易因为 DOM 时序导致闪烁。

## 从手势到状态：把交互统一成数据流

手势系统如果只用在“微交互”上，价值有限。真正有生产力的用法是把 hover、press、drag、tap 当成状态输入，和业务状态统一管理。

例如拖拽排序：

```tsx
import { Reorder, motion } from "framer-motion";

export function TaskBoard({ items, onChange }: { items: string[]; onChange: (next: string[]) => void }) {
  return (
    <Reorder.Group axis="y" values={items} onReorder={onChange}>
      {items.map((item) => (
        <Reorder.Item key={item} value={item}>
          <motion.div
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="task-card"
          >
            {item}
          </motion.div>
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}
```

这里手势已经和业务数据对齐了：

- `Reorder` 负责维护列表顺序
- `whileHover/whileTap` 负责提供触觉反馈
- 业务层只关心 `onChange`，不关心动画细节

类似思路也适用于移动端抽屉：

- 拖拽手势控制打开/关闭
- 但最终状态仍然是 `open / closed / dragging`
- 业务层不需要手动计算 position

这个“手势即状态”的思路，是把动画从“装饰”变成“产品能力”的关键。

## 在 Vue 里的落地路径

Framer Motion 主要是 React 库，但 Vue 也有类似能力，常见的实现路径包括：

- `vue-motion` / `motion-v`：为 Vue 提供 motion 原语
- `@vueuse/motion`：基于 Web Animations / 自定义指令的轻量方案
- 原生 `<Transition>` / `<TransitionGroup>`：适合简单页面/列表过渡
- 手写 `Web Animations API`：用于高性能布局动画

在 Vue 里，如果要实现“共享布局动画”，通常不是直接复用 Framer Motion API，而是参考其设计思想，结合 Vue 路由与状态做实现。比如：

```vue
<template>
  <div class="product-list">
    <button
      v-for="item in products"
      :key="item.id"
      class="product-card"
      @click="goDetail(item.id)"
    >
      <img
        :src="item.imageUrl"
        :alt="item.title"
        class="product-card__image"
      />
      <div class="product-card__body">
        <h3>{{ item.title }}</h3>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goDetail(id: string) {
  router.push({ name: 'product-detail', params: { id } });
}
</script>
```

```vue
<template>
  <article class="product-detail">
    <header class="product-detail-header">
      <img
        :src="detail.imageUrl"
        :alt="detail.title"
        class="product-detail-header__image"
      />
      <h1 class="product-detail-header__title">{{ detail.title }}</h1>
    </header>
    <button @click="goBack">返回列表</button>
    <section>商品详情内容...</section>
  </article>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();

function goBack() {
  router.back();
}

const detail = {
  id: route.params.id as string,
  title: '示例商品',
  imageUrl: '/images/demo.jpg',
};
</script>
```

如果要做出类似 Framer Motion 的布局过渡，通常有两种思路：

1. 使用 `@vueuse/motion` / `motion-v` 处理基础动画
2. 使用 `View Transitions API`（实验性）或 Web Animations API 处理布局动画

Vue 的优势是模板结构清晰，transition 分离明确；劣势是布局动画生态没有 React 侧成熟，需要在架构层做好抽象。

## 性能问题：动画为什么会卡

动画卡顿通常来自两类问题：

1. **触发重排**
2. **过度渲染**

### 触发重排

布局动画本身会涉及布局属性，但仍然要避免以下写法：

- 同时动画 `width + top + margin + padding`
- 动画 `box-shadow` / `filter` 大面积区域
- 在动画里反复读取 `getBoundingClientRect`
- 在滚动容器里频繁修改布局

如果只是想做视觉过渡，优先使用 `transform` 与 `opacity`；如果确实是布局变化，再启用 `layout`。

### 过度渲染

动画帧率下降常常是因为每帧触发太多节点更新。Framer Motion 在 React 里虽然做了批处理，但以下场景仍需注意：

- 大列表共享布局动画
- 高频手势驱动复杂组件树
- 多个 `layoutId` 同时变化
- 动画里叠加大量派生状态

比较稳妥的做法是：

- 控制共享动画元素数量
- 把非关键内容降级为静态
- 把高频手势和高频渲染隔离
- 对大列表做虚拟化

### Layout 动画的性能边界

`layout` 很方便，但它不是免费的。浏览器需要在动画前后计算布局差异，如果节点很多，成本会明显上升。

建议：

- 关键路径上少量使用
- 列表只对可见区域启用
- 避免深层嵌套同时 `layout`
- 复杂切换场景把布局动画和页面动画分层

## 无障碍：动画不是炫技，而是可控体验

生产系统必须考虑：

- `prefers-reduced-motion`
- 键盘可达性
- 焦点管理
- 语义化状态

### reduced-motion

至少要支持用户关闭复杂动画：

```tsx
import { useReducedMotion } from "framer-motion";

export function SafeMotionButton() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.button
      whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
    >
      提交订单
    </motion.button>
  );
}
```

在 Vue 里也可以通过媒体查询或 `useMedia` 判断 `prefers-reduced-motion`。

### 焦点管理

模态、抽屉、侧边栏打开后，焦点要进入容器；关闭后，焦点要回到触发元素。动画不能掩盖焦点丢失问题。很多“看起来流畅”的交互，在键盘导航下是断裂的。

### 语义化状态

动画应该是状态的表现，而不是唯一表达。比如：

- 打开/关闭要有 `aria-expanded`
- 弹窗要有 `role="dialog"` 与焦点陷阱
- 过渡不要影响操作结果的可理解性

## 实战：电商详情页的共享布局方案

电商详情页是最经典的 Shared Layout 场景。用户从列表进入详情，期望看到“点开的图片”，而不是一张新图片出现。

一个可靠的落地步骤：

1. 列表项图片声明 `layoutId`
2. 详情页头图声明相同 `layoutId`
3. 路由切换时启用退出/入场动画
4. 预加载详情数据，避免动画和请求竞争
5. 如果列表项来自不同组件，放入同一个 `LayoutGroup`
6. 移动端降低动画复杂度，优先保证响应速度

这个顺序很重要。很多团队先做动画，再处理数据请求和缓存，结果出现：

- 图片还没加载完，动画已经结束
- 用户看到“空白头图”
- 返回列表时再次闪烁

所以动画方案必须和数据层一起设计。

## React 里容易踩的坑

1. **把 `layoutId` 写成随机值**
   动画身份不稳定，会导致闪烁。

2. **忘记 `AnimatePresence`**
   退出动画不生效，共享元素会“突然消失”。

3. **在同一页面多次嵌套 `LayoutGroup`**
   容易造成动画上下文混乱。

4. **路由切换同时做大量动画**
   页面级过渡 + 共享布局动画 + 列表动画同时跑，帧率下降。

5. **动画和请求强耦合**
   数据还没回来就开始动画，导致布局跳动。

6. **移动端照搬桌面端动画**
   触摸场景下复杂动画容易误触、延迟、耗电。

## Vue 里容易踩的坑

1. **过度依赖模板 transition**
   简单过渡很好用，但复杂布局动画会受限。

2. **状态和动画耦合**
   `v-if` 直接控制元素，导致进出动画不稳定。

3. **没有统一动画抽象层**
   每个组件各写一套，风格和性能不一致。

4. **忽略 Vue 路由生命周期**
   页面切换与动画时序没对齐。

5. **盲目复用 React 思路**
   React 的 `layoutId` 机制不能直接平移，需要适配。

## 踩坑记录：我实际遇到的生产问题

### 问题 1：列表进入详情时图片闪烁

原因：详情页先加载骨架屏，再替换真实图片，`layoutId` 没有稳定绑定。

解法：

- 列表项和详情页使用同一个 `layoutId`
- 详情页在数据未返回前不要立即渲染替代元素
- 图片预加载，避免占位图打断过渡

### 问题 2：返回列表时布局跳动

原因：列表项高度由内容决定，进入详情后 DOM 重排，导致旧位置计算不准。

解法：

- 列表固定行高或给卡片固定最小高度
- 使用 `layout` 动画而不是纯 `transform`
- 对关键列表启用 `layoutId`，而不是整页元素

### 问题 3：移动端手势和动画冲突

原因：`whileTap` 与业务点击同时触发，用户误触频繁。

解法：

- 手势反馈与导航操作解耦
- 移动端降低 `whileHover` 强度
- 关键操作增加防抖或确认

### 问题 4：模态框动画导致焦点丢失

原因：动画优先级太高，焦点没有跟随 DOM 更新。

解法：

- 动画结束后再聚焦容器
- 手动管理 `ref`
- 加入 `role="dialog"` 与键盘关闭能力

## 推荐架构：把动画做成可配置能力

如果团队经常做页面切换、卡片展开、侧边栏、抽屉、排序列表，应该把动画抽象成平台能力，而不是每个组件单独实现。

建议拆分三层：

1. **页面层**
   路由过渡、布局上下文、退出控制
2. **组件层**
   卡片、详情、弹窗、抽屉的共享动画逻辑
3. **交互层**
   hover、tap、drag 的状态化表达

每一层都通过配置驱动，而不是散落在业务代码里。这样可以做到：

- 新页面复用动画策略
- 性能问题能统一收敛
- 可访问性统一处理
- 设计规范更容易落地

## 测试与回归：动画也是功能

动画问题常常被当成“视觉问题”，但在生产里它会影响转化、可读性、稳定性。

建议建立以下测试方式：

- 快照对比：关键页面在动画前后保持布局稳定
- 交互回归：路由切换、列表重排、抽屉打开/关闭必须覆盖
- 性能回归：记录关键切换的帧率、渲染次数
- 可访问性回归：`prefers-reduced-motion`、焦点顺序、键盘操作

如果动画只是“加个好看的效果”，测试很容易被跳过。但如果动画承载了页面切换、信息层级、操作反馈，它就是功能的一部分。

## 总结

Framer Motion 在 React 生态里是一个非常值得投入的动画层，尤其在 Layout Animation、Shared Layout 和手势系统上，比手写方案更稳定、更可维护。但它不是“加了就好”，而是需要和路由、数据、性能、无障碍一起设计。

核心原则可以总结成三点：

1. **动画必须表达状态**
   不要为了动而动，所有过渡都应服务于页面状态变化。
2. **布局动画比普通动画贵**
   用在关键路径上，控制数量和范围。
3. **手势不是装饰，而是输入**
   hover、tap、drag 应进入状态机，而不是写死动画参数。

如果团队的目标是“把页面做得更自然”，Framer Motion 是一条成熟的路。关键是把它当成产品能力，而不是前端技巧。真正好的动画不是用户“看见”动画，而是用户“感觉”页面更顺畅、更连贯、更符合直觉。