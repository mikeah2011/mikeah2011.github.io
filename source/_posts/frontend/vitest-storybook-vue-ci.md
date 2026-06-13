---

title: Vitest + Storybook 8 实战：Vue 3 组件的单元测试 + 可视化文档——对比独立测试框架的开发体验与 CI 集成
keywords: [Vitest, Storybook, Vue, CI, 组件的单元测试, 可视化文档, 对比独立测试框架的开发体验与, 前端]
date: 2026-06-10 05:59:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Vue
- Vitest
- Storybook
- 单元测试
- 组件测试
- CI/CD
description: 深入对比 Vitest 与 Jest 在 Vue 3 项目中的测试体验，结合 Storybook 8 实现组件可视化测试与文档化，涵盖配置、Mock、快照测试、CI 集成全流程实战。
---



## 概述

在 Vue 3 项目中，组件测试一直是个痛点。Jest 虽然经典，但对 ESM 的支持始终不够友好，配置复杂，速度也不尽如人意。Vitest 基于 Vite 构建，天然支持 ES Modules，配置简洁，速度快，成为 Vue 3 生态的首选测试框架。

Storybook 8 则从另一个维度解决组件开发问题——可视化文档、交互测试、UI Review。把 Vitest 的自动化测试和 Storybook 的可视化能力结合起来，就是现代 Vue 3 组件开发的最佳实践。

本文将从零搭建 Vitest + Storybook 8 的 Vue 3 测试体系，对比 Jest 的实际体验差异，最终接入 CI/CD 流程。

<!-- more -->

## 核心概念

### Vitest vs Jest：Vue 3 项目的关键差异

| 维度 | Vitest | Jest |
|------|--------|------|
| ESM 支持 | 原生支持 | 需要额外配置（transform） |
| 配置复杂度 | 极简，复用 vite.config | 需要单独配置 jest.config |
| 速度 | 基于 Vite 的 HMR，冷启动快 | 全量扫描，冷启动慢 |
| 类型支持 | 内置 TypeScript 支持 | 需要 ts-jest 或 @swc/jest |
| 与 Vue 生态兼容 | @vue/test-utils 官方推荐 | 兼容但需额外配置 |
| Watch 模式 | 基于 Vite 的智能 HMR | 文件轮询 |
| Mock | 内置 ESM Mock | 需要 babel-plugin |

结论：Vue 3 项目（尤其是 Vite 构建的项目），Vitest 是默认选择。

### Storybook 8 的定位

Storybook 8 的核心价值：

1. **可视化文档**：每个组件自动生成可交互的文档页面
2. **UI 测试**：通过 Play 函数实现交互式测试
3. **Chromatic 集成**：视觉回归测试
4. **隔离开发**：在独立环境中开发组件，不依赖业务上下文

两者结合的工作流：Vitest 负责逻辑正确性（状态、事件、边界），Storybook 负责视觉和交互体验（渲染、样式、用户操作）。

## 实战代码

### 项目初始化

```bash
# 创建 Vue 3 + Vite 项目
npm create vite@latest vue-test-demo -- --template vue-ts
cd vue-test-demo

# 安装 Vitest 相关
npm install -D vitest @vue/test-utils jsdom @vitest/coverage-v8

# 安装 Storybook 8
npx storybook@latest init
```

### 1. Vitest 配置

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/components/**/*.{vue,ts}'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
    },
    // Mock 配置
    mockReset: true,
    restoreMocks: true,
  },
})
```

### 2. 示例组件：Counter.vue

```vue
<!-- src/components/Counter.vue -->
<template>
  <div class="counter">
    <h2>{{ title }}</h2>
    <p class="count">当前计数：{{ count }}</p>
    <p class="double">双倍值：{{ doubleCount }}</p>
    <div class="buttons">
      <button
        class="btn-decrement"
        :disabled="count <= min"
        @click="decrement"
      >
        -1
      </button>
      <button class="btn-increment" :disabled="count >= max" @click="increment">
        +1
      </button>
      <button class="btn-reset" @click="reset">重置</button>
    </div>
    <p v-if="isEven" class="even-hint">当前是偶数</p>
    <p v-if="isLimit" class="limit-hint">已达上限</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    title?: string
    initialValue?: number
    min?: number
    max?: number
  }>(),
  {
    title: '计数器',
    initialValue: 0,
    min: 0,
    max: 100,
  }
)

const emit = defineEmits<{
  change: [value: number]
  limit: []
}>()

const count = ref(props.initialValue)

const doubleCount = computed(() => count.value * 2)
const isEven = computed(() => count.value % 2 === 0)
const isLimit = computed(() => count.value >= props.max)

function increment() {
  if (count.value < props.max) {
    count.value++
    emit('change', count.value)
  } else {
    emit('limit')
  }
}

function decrement() {
  if (count.value > props.min) {
    count.value--
    emit('change', count.value)
  }
}

function reset() {
  count.value = props.initialValue
  emit('change', count.value)
}

watch(count, (newVal) => {
  if (newVal >= props.max) {
    emit('limit')
  }
})

defineExpose({ count, increment, decrement, reset })
</script>
```

### 3. Vitest 单元测试

```ts
// src/components/__tests__/Counter.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Counter from '../Counter.vue'

describe('Counter 组件', () => {
  // --- 基础渲染 ---
  it('渲染默认标题和初始值', () => {
    const wrapper = mount(Counter)
    expect(wrapper.find('h2').text()).toBe('计数器')
    expect(wrapper.find('.count').text()).toContain('0')
  })

  it('自定义 props', () => {
    const wrapper = mount(Counter, {
      props: { title: '自定义标题', initialValue: 10 },
    })
    expect(wrapper.find('h2').text()).toBe('自定义标题')
    expect(wrapper.find('.count').text()).toContain('10')
  })

  // --- 交互逻辑 ---
  it('点击 +1 按钮增加计数', async () => {
    const wrapper = mount(Counter, { props: { initialValue: 0 } })
    await wrapper.find('.btn-increment').trigger('click')
    expect(wrapper.find('.count').text()).toContain('1')
  })

  it('点击 -1 按钮减少计数', async () => {
    const wrapper = mount(Counter, { props: { initialValue: 5 } })
    await wrapper.find('.btn-decrement').trigger('click')
    expect(wrapper.find('.count').text()).toContain('4')
  })

  it('点击重置按钮恢复初始值', async () => {
    const wrapper = mount(Counter, { props: { initialValue: 5 } })
    await wrapper.find('.btn-increment').trigger('click')
    await wrapper.find('.btn-increment').trigger('click')
    expect(wrapper.find('.count').text()).toContain('7')
    await wrapper.find('.btn-reset').trigger('click')
    expect(wrapper.find('.count').text()).toContain('5')
  })

  // --- 边界条件 ---
  it('达到最大值时禁用 +1 按钮', async () => {
    const wrapper = mount(Counter, {
      props: { initialValue: 99, max: 100 },
    })
    await wrapper.find('.btn-increment').trigger('click')
    expect(wrapper.find('.count').text()).toContain('100')
    expect(wrapper.find('.btn-increment').attributes('disabled')).toBe('')
  })

  it('达到最小值时禁用 -1 按钮', async () => {
    const wrapper = mount(Counter, {
      props: { initialValue: 1, min: 0 },
    })
    await wrapper.find('.btn-decrement').trigger('click')
    expect(wrapper.find('.count').text()).toContain('0')
    expect(wrapper.find('.btn-decrement').attributes('disabled')).toBe('')
  })

  // --- 计算属性 ---
  it('偶数时显示提示', async () => {
    const wrapper = mount(Counter, { props: { initialValue: 0 } })
    expect(wrapper.find('.even-hint').exists()).toBe(true)

    await wrapper.find('.btn-increment').trigger('click')
    expect(wrapper.find('.even-hint').exists()).toBe(false)
  })

  // --- 事件 ---
  it('触发 change 事件', async () => {
    const wrapper = mount(Counter, { props: { initialValue: 0 } })
    await wrapper.find('.btn-increment').trigger('click')
    expect(wrapper.emitted('change')).toHaveLength(1)
    expect(wrapper.emitted('change')![0]).toEqual([1])
  })

  it('触发 limit 事件', async () => {
    const wrapper = mount(Counter, {
      props: { initialValue: 99, max: 100 },
    })
    await wrapper.find('.btn-increment').trigger('click')
    await wrapper.find('.btn-increment').trigger('click')
    expect(wrapper.emitted('limit')).toHaveLength(1)
  })
})
```

### 4. 带 API 调用的组件测试（Mock 实战）

```ts
// src/components/__tests__/UserProfile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import UserProfile from '../UserProfile.vue'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('UserProfile 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('加载用户数据并显示', async () => {
    const userData = {
      id: 1,
      name: 'Michael',
      email: 'michael@example.com',
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(userData),
    })

    const wrapper = mount(UserProfile, {
      props: { userId: 1 },
    })

    // 等待异步渲染
    await nextTick()
    await nextTick()

    expect(wrapper.find('.user-name').text()).toBe('Michael')
    expect(wrapper.find('.user-email').text()).toBe('michael@example.com')
    expect(mockFetch).toHaveBeenCalledWith('/api/users/1')
  })

  it('加载失败时显示错误', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    })

    const wrapper = mount(UserProfile, {
      props: { userId: 999 },
    })

    await nextTick()
    await nextTick()

    expect(wrapper.find('.error').text()).toContain('用户不存在')
  })

  it('loading 状态', () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {})) // 永不 resolve

    const wrapper = mount(UserProfile, {
      props: { userId: 1 },
    })

    expect(wrapper.find('.loading').exists()).toBe(true)
  })
})
```

### 5. Storybook 8 配置

```ts
// .storybook/main.ts
import type { StorybookConfig from '@storybook/vue3-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|ts|jsx|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/vue3-vite',
    options: {},
  },
}

export default config
```

```ts
// .storybook/preview.ts
import type { Preview } from '@storybook/vue3'
import '../src/assets/main.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      config: {},
      options: {
        checks: ['color-contrast'],
        runTimeout: 1000,
      },
    },
  },
}

export default preview
```

### 6. Counter 的 Storybook Story

```ts
// src/components/Counter.stories.ts
import type { Meta, StoryObj } from '@storybook/vue3'
import { fn, expect, userEvent, within } from '@storybook/test'
import Counter from './Counter.vue'

const meta: Meta<typeof Counter> = {
  title: 'Components/Counter',
  component: Counter,
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    initialValue: { control: 'number' },
    min: { control: 'number' },
    max: { control: 'number' },
  },
  args: {
    title: '计数器',
    initialValue: 0,
    min: 0,
    max: 100,
    onChange: fn(),
    onLimit: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// 默认状态
export const Default: Story = {}

// 自定义初始值
export const WithInitialValue: Story = {
  args: {
    initialValue: 42,
    title: '自定义计数器',
  },
}

// 交互测试：点击 +1
export const IncrementInteraction: Story = {
  name: '交互：点击增加',
  args: {
    initialValue: 0,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)

    // 验证初始值
    await expect(canvas.getByText('当前计数：0')).toBeInTheDocument()

    // 点击 +1
    await userEvent.click(canvas.getByRole('button', { name: '+1' }))
    await expect(canvas.getByText('当前计数：1')).toBeInTheDocument()

    // 验证事件触发
    await expect(args.onChange).toHaveBeenCalledWith(1)
  },
}

// 交互测试：边界条件
export const MaxLimit: Story = {
  name: '交互：达到上限',
  args: {
    initialValue: 99,
    max: 100,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)

    // 点击到上限
    await userEvent.click(canvas.getByRole('button', { name: '+1' }))
    await expect(canvas.getByText('当前计数：100')).toBeInTheDocument()

    // +1 按钮应被禁用
    await expect(canvas.getByRole('button', { name: '+1' })).toBeDisabled()

    // 再次点击应触发 limit 事件
    await userEvent.click(canvas.getByRole('button', { name: '+1' }))
    await expect(args.onLimit).toHaveBeenCalled()
  },
}

// 交互测试：重置
export const ResetInteraction: Story = {
  name: '交互：重置功能',
  args: {
    initialValue: 5,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // 增加两次
    await userEvent.click(canvas.getByRole('button', { name: '+1' }))
    await userEvent.click(canvas.getByRole('button', { name: '+1' }))
    await expect(canvas.getByText('当前计数：7')).toBeInTheDocument()

    // 重置
    await userEvent.click(canvas.getByRole('button', { name: '重置' }))
    await expect(canvas.getByText('当前计数：5')).toBeInTheDocument()
  },
}

// 视觉回归：奇数状态
export const OddState: Story = {
  name: '视觉：奇数状态',
  args: {
    initialValue: 3,
  },
  parameters: {
    docs: {
      description: {
        story: '奇数时隐藏「当前是偶数」提示，验证条件渲染逻辑。',
      },
    },
  },
}
```

### 7. CI 集成（GitHub Actions）

```yaml
# .github/workflows/test.yml
name: Test & Storybook

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      # 运行 Vitest
      - name: Run Vitest
        run: npm run test:unit -- --coverage

      # 上传覆盖率报告
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

      # 构建 Storybook 静态站点
      - name: Build Storybook
        run: npm run build-storybook

      # 上传 Storybook 产物（可选：部署到 Chromatic）
      - name: Upload Storybook
        uses: actions/upload-artifact@v4
        with:
          name: storybook
          path: storybook-static/
```

```json
// package.json（相关脚本）
{
  "scripts": {
    "test:unit": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  }
}
```

## 踩坑记录

### 1. jsdom vs happy-dom

Vitest 的 `environment` 配置有两个选择：

- `jsdom`：完整但慢，模拟浏览器环境
- `happy-dom`：轻量快速，但某些 API 缺失

**建议**：默认用 `jsdom`，如果测试跑得慢再切 `happy-dom`。Vue 官方测试文档推荐 `jsdom`。

```ts
// 个别测试文件可以覆盖全局配置
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
// ...
```

### 2. Storybook Play 函数的异步陷阱

Play 函数里的断言需要等 DOM 更新。常见错误：

```ts
// ❌ 错误：直接断言，可能还没更新
play: async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: '+1' }))
  // 这里可能还是旧值
  await expect(canvas.getByText('当前计数：1')).toBeInTheDocument()
}

// ✅ 正确：用 waitFor 或者多次 expect
play: async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: '+1' }))
  await waitFor(() => {
    expect(canvas.getByText('当前计数：1')).toBeInTheDocument()
  })
}
```

### 3. Mock 模块的 ESM 问题

在 Vitest 中 mock ESM 模块需要使用 `vi.mock`：

```ts
// ✅ 正确方式
vi.mock('@/api/user', () => ({
  fetchUser: vi.fn(),
}))

import { fetchUser } from '@/api/user'
```

如果在 Jest 中，这个操作需要配合 `babel-plugin-transform-es2015-modules-commonjs`，配置复杂得多。这就是 Vitest 的优势——ESM 原生支持。

### 4. Coverage 报告排除测试文件

默认 coverage 可能把测试文件也纳入统计。确保配置中排除：

```ts
coverage: {
  exclude: [
    'src/**/*.d.ts',
    'src/**/*.stories.ts',
    'src/**/__tests__/**',
    'src/**/*.test.ts',
    'src/**/*.spec.ts',
  ],
}
```

### 5. Storybook 8 的 Vue 3 类型支持

如果 Storybook 无法正确推断 Vue 组件的 props 类型，检查 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true
  }
}
```

`moduleResolution: "bundler"` 是 Storybook 8 + Vue 3 的推荐配置。

## 总结

**Vitest 的优势**：
- ESM 原生支持，配置极简
- 与 Vite 生态无缝集成
- 速度比 Jest 快 2-5 倍（冷启动差距更大）
- TypeScript 和 Vue SFC 类型支持开箱即用

**Storybook 8 的价值**：
- 组件可视化文档，自动从 props 生成控件
- Play 函数实现交互式测试
- A11y 插件提升可访问性
- Chromatic 视觉回归测试

**最佳实践组合**：
- Vitest 负责逻辑层（状态、事件、边界条件、Mock）
- Storybook 负责表现层（渲染、样式、交互、文档）
- CI 中两者并行运行，覆盖率报告 + Storybook 静态站点一起产出

别再用 Jest + Vue 3 了。Vitest 是正确的选择。
