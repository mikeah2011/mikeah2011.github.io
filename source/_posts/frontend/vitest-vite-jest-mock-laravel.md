---

title: Vitest 实战：Vite 原生测试框架——对比 Jest 的速度、快照测试、Mock 与 Laravel 前端项目的测试迁移
keywords: [Vitest, Vite, Jest, Mock, Laravel, 原生测试框架, 的速度, 快照测试, 前端项目的测试迁移, 前端]
date: 2026-06-10 05:40:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Vitest
- Vite
- Jest
- 测试
- Vue
- Laravel
- 单元测试
description: 深入 Vitest 实战：零配置启动、Vite 原生速度、快照测试、Mock/Spy 机制，以及从 Jest 迁移到 Vitest 的完整路径——含 Laravel 前端项目的真实踩坑记录。
---



## 概述

前端测试长期被 Jest 统治，但 Jest 的两个痛点始终存在：**慢** 和 **配置繁琐**。每次 `npm test` 都要等 3-5 秒启动，大型项目甚至 10 秒以上。根源在于 Jest 使用自己的模块解析和转译管道，与 Vite 完全割裂。

Vitest 的出现彻底解决了这个问题。它直接复用 Vite 的开发服务器和插件生态，实现了真正的**零配置**和**毫秒级 HMR**。对于使用 Vue 3 + Vite 的 Laravel 前端项目来说，Vitest 不是"另一个测试框架"，而是"测试终于融入了你的开发流程"。

本文基于 Vue 3 + Laravel B2C 前端项目的真实迁移经验，从 Jest 迁移到 Vitest，覆盖核心概念、实战代码、Mock 机制、快照测试和踩坑记录。

## 核心概念

### Vitest vs Jest：本质区别

| 维度 | Jest | Vitest |
|------|------|--------|
| 模块解析 | 自有 resolver + babel-jest | Vite 原生，共享 `vite.config.ts` |
| 转译 | babel / ts-jest | Vite 插件（esbuild/SWC） |
| 启动速度 | 3-10s（冷启动） | < 500ms（Vite 预构建） |
| 配置复杂度 | 需要单独配置 transform/ moduleNameMapper | 几乎零配置 |
| HMR | 不支持（每次全量） | 原生 HMR，改代码立即重跑 |
| ESM 支持 | 实验性，经常出问题 | 原生 ESM |
| TS 支持 | 需要 ts-jest/babel | Vite 原生处理 |
| 与 Vite 生态 | 不兼容 | 完全共享插件、alias、环境变量 |

### Vitest 的架构优势

```
传统 Jest 流程：
  源码 → babel-jest 转译 → Jest runner → 测试输出

Vitest 流程：
  源码 → Vite dev server（共享同一份配置）→ Vitest runner → 测试输出
```

这意味着你在 `vite.config.ts` 中配置的 `alias`、`plugins`、`define`、环境变量，在测试中**自动生效**，不需要重复配置。

### 兼容 Jest API

Vitest 刻意保持了 Jest 兼容的 API：

```typescript
// Vitest 直接支持的 Jest API
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('加法', () => {
  it('1 + 1 = 2', () => {
    expect(1 + 1).toBe(2)
  })
})
```

核心 API 对应关系：
- `jest.fn()` → `vi.fn()`
- `jest.spyOn()` → `vi.spyOn()`
- `jest.mock()` → `vi.mock()`
- `jest.clearAllMocks()` → `vi.clearAllMocks()`

唯一的区别是前缀从 `jest.` 变成 `vi.`，其余完全一致。

## 实战代码

### 项目初始化

在一个 Vue 3 + Vite 项目中安装 Vitest：

```bash
# 安装核心依赖
npm install -D vitest @vue/test-utils jsdom

# 如果需要覆盖率
npm install -D @vitest/coverage-v8

# 如果需要快照测试（已内置，无需额外安装）
# 如果需要 DOM 环境
npm install -D happy-dom  # 或 jsdom
```

### Vite 配置

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
    },
  },
  test: {
    // 测试环境
    environment: 'jsdom',
    
    // 全局 API（可选，类似 Jest 的 globals）
    globals: true,
    
    // 包含测试文件的模式
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts'],
    },
    
    // 设置文件
    setupFiles: ['./tests/setup.ts'],
  },
})
```

注意：`test` 配置直接在 `vite.config.ts` 中，不需要单独的 `vitest.config.ts`。Vite 自动识别 `test` 字段并注入 Vitest。

### package.json scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  }
}
```

`vitest` 不加 `run` 参数时进入 watch 模式，`vitest run` 单次执行（CI 用）。

### Vue 组件测试

```typescript
// src/components/__tests__/ProductCard.spec.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProductCard from '../ProductCard.vue'

describe('ProductCard.vue', () => {
  const mockProduct = {
    id: 1,
    name: '东京迪士尼门票',
    price: 580,
    currency: 'JPY',
    image: '/images/disney.jpg',
    rating: 4.8,
    reviewCount: 2341,
  }

  it('渲染商品名称和价格', () => {
    const wrapper = mount(ProductCard, {
      props: { product: mockProduct },
    })

    expect(wrapper.find('.product-name').text()).toBe('东京迪士尼门票')
    expect(wrapper.find('.product-price').text()).toContain('¥580')
  })

  it('价格为 0 时显示"免费"', () => {
    const wrapper = mount(ProductCard, {
      props: { product: { ...mockProduct, price: 0 } },
    })

    expect(wrapper.find('.product-price').text()).toBe('免费')
  })

  it('点击加入购物车触发事件', async () => {
    const wrapper = mount(ProductCard, {
      props: { product: mockProduct },
    })

    await wrapper.find('.add-to-cart-btn').trigger('click')

    expect(wrapper.emitted('add-to-cart')).toEqual([
      [{ productId: 1, quantity: 1 }],
    ])
  })

  it('图片加载失败时显示占位图', async () => {
    const wrapper = mount(ProductCard, {
      props: { product: mockProduct },
    })

    const img = wrapper.find('img')
    await img.trigger('error')

    expect(img.attributes('src')).toContain('placeholder')
  })
})
```

### 组合式函数测试

```typescript
// src/composables/__tests__/useCart.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCart } from '../useCart'
import { nextTick } from 'vue'

// Mock API 请求
vi.mock('@/api/cart', () => ({
  fetchCart: vi.fn(),
  addToCart: vi.fn(),
  removeFromCart: vi.fn(),
}))

import { fetchCart, addToCart } from '@/api/cart'

describe('useCart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初始化时加载购物车', async () => {
    const mockItems = [
      { id: 1, name: '门票', price: 580, quantity: 2 },
    ]

    vi.mocked(fetchCart).mockResolvedValue({
      items: mockItems,
      total: 1160,
    })

    const { items, total, loading } = useCart()

    expect(loading.value).toBe(true)

    await nextTick() // 等待异步操作

    expect(items.value).toEqual(mockItems)
    expect(total.value).toBe(1160)
    expect(loading.value).toBe(false)
    expect(fetchCart).toHaveBeenCalledTimes(1)
  })

  it('添加商品到购物车', async () => {
    vi.mocked(fetchCart).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(addToCart).mockResolvedValue({ success: true })

    const { addItem, items } = useCart()

    await nextTick() // 初始化

    await addItem({ productId: 5, quantity: 1 })
    await nextTick()

    expect(addToCart).toHaveBeenCalledWith({ productId: 5, quantity: 1 })
    expect(items.value).toHaveLength(1)
  })

  it('添加失败时显示错误信息', async () => {
    vi.mocked(fetchCart).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(addToCart).mockRejectedValue(new Error('库存不足'))

    const { addItem, error } = useCart()

    await nextTick()

    await addItem({ productId: 99, quantity: 1 })
    await nextTick()

    expect(error.value).toBe('库存不足')
  })
})
```

### 快照测试

Vitest 的快照 API 与 Jest 完全一致：

```typescript
// src/components/__tests__/OrderSummary.spec.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OrderSummary from '../OrderSummary.vue'

describe('OrderSummary.vue', () => {
  it('匹配正常订单快照', () => {
    const wrapper = mount(OrderSummary, {
      props: {
        items: [
          { name: '东京迪士尼 2 日票', price: 1160, quantity: 1 },
          { name: '交通卡', price: 300, quantity: 2 },
        ],
        discount: -200,
        coupon: 'SUMMER2026',
      },
    })

    expect(wrapper.html()).toMatchSnapshot()
  })

  it('空订单快照', () => {
    const wrapper = mount(OrderSummary, {
      props: { items: [], discount: 0, coupon: '' },
    })

    expect(wrapper.html()).toMatchSnapshot()
  })
})
```

快照文件自动生成在 `__snapshots__/` 目录。首次运行生成，后续运行对比。如果 UI 变了，用 `vitest --update` 更新快照。

### Mock 与 Spy 机制

Vitest 的 `vi` 对象提供了完整的 Mock 能力：

```typescript
// src/services/__tests__/paymentGateway.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processPayment } from '../paymentGateway'

// Mock Stripe SDK
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    paymentIntents: {
      create: vi.fn().mockResolvedValue({
        id: 'pi_mock_123',
        status: 'succeeded',
        amount: 58000,
      }),
    },
  })),
}))

// Mock 外部 HTTP 请求
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}))

describe('processPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('正常支付流程', async () => {
    const result = await processPayment({
      orderId: 'ORD-001',
      amount: 580,
      currency: 'JPY',
      paymentMethod: 'credit_card',
    })

    expect(result.success).toBe(true)
    expect(result.transactionId).toBe('pi_mock_123')
  })

  it('支付金额为 0 时跳过支付', async () => {
    const result = await processPayment({
      orderId: 'ORD-FREE',
      amount: 0,
      currency: 'JPY',
      paymentMethod: 'credit_card',
    })

    expect(result.success).toBe(true)
    expect(result.transactionId).toBe('FREE_ORDER')
    // 不应该调用 Stripe
  })

  it('支付超时时重试一次', async () => {
    const Stripe = (await import('stripe')).default
    const stripeInstance = vi.mocked(Stripe).mock.results[0].value

    // 第一次超时，第二次成功
    stripeInstance.paymentIntents.create
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({
        id: 'pi_retry_456',
        status: 'succeeded',
        amount: 58000,
      })

    const result = await processPayment({
      orderId: 'ORD-RETRY',
      amount: 580,
      currency: 'JPY',
      paymentMethod: 'credit_card',
    })

    expect(result.success).toBe(true)
    expect(result.transactionId).toBe('pi_retry_456')
    expect(stripeInstance.paymentIntents.create).toHaveBeenCalledTimes(2)
  })
})
```

### Mock 时间

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('时间相关逻辑', () => {
  it('优惠券过期判断', () => {
    // 固定时间到 2026-06-10
    vi.setSystemTime(new Date('2026-06-10T00:00:00+08:00'))

    const coupon = {
      code: 'SUMMER',
      expiresAt: new Date('2026-06-15'),
    }

    const isExpired = new Date() > coupon.expiresAt
    expect(isExpired).toBe(false)

    // 推进到 6 月 16 日
    vi.setSystemTime(new Date('2026-06-16T00:00:00+08:00'))

    const isExpiredAfter = new Date() > coupon.expiresAt
    expect(isExpiredAfter).toBe(true)

    vi.useRealTimers()
  })
})
```

### 覆盖率报告

```bash
# 生成覆盖率报告
npx vitest run --coverage

# 输出示例：
# % Coverage report
# ┌──────────────────┬─────────┬──────────┬──────────┬─────────┐
# │ File             │ Stmts   │ Branch   │ Funcs    │ Lines   │
# ├──────────────────┼─────────┼──────────┼──────────┼─────────┤
# │ ProductCard.vue  │ 100.00% │ 87.50%   │ 100.00%  │ 100.00% │
# │ useCart.ts       │ 92.31%  │ 80.00%   │ 100.00%  │ 92.31%  │
# └──────────────────┴─────────┴──────────┴──────────┴─────────┘
```

## Jest → Vitest 迁移实战

### 第一步：安装 Vitest

```bash
# 安装 Vitest
npm install -D vitest @vitest/coverage-v8

# 保留 @vue/test-utils（Vitest 直接使用）
# 如果原来用了 jest + @vue/test-utils，不需要额外操作
```

### 第二步：调整配置

```typescript
// 从 jest.config.ts 迁移
// jest.config.ts → vite.config.ts 的 test 字段

// 原来的 jest.config.ts：
// module.exports = {
//   preset: '@vue/cli-plugin-unit-jest',
//   moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
//   transform: { '^.+\\.vue$': 'vue-jest' },
// }

// vitest 配置直接写在 vite.config.ts 中，alias 从 resolve 借用
```

### 第三步：批量替换 API

```bash
# 用 sed 批量替换
find src -name '*.spec.ts' -o -name '*.test.ts' | xargs sed -i 's/jest\.fn/vi.fn/g'
find src -name '*.spec.ts' -o -name '*.test.ts' | xargs sed -i 's/jest\.spyOn/vi.spyOn/g'
find src -name '*.spec.ts' -o -name '*.test.ts' | xargs sed -i 's/jest\.mock/vi.mock/g'
find src -name '*.spec.ts' -o -name '*.test.ts' | xargs sed -i 's/jest\.clearAllMocks/vi.clearAllMocks/g'
find src -name '*.spec.ts' -o -name '*.test.ts' | xargs sed -i 's/jest\.useFakeTimers/vi.useFakeTimers/g'
find src -name '*.spec.ts' -o -name '*.test.ts' | xargs sed -i 's/jest\.useRealTimers/vi.useRealTimers/g'
find src -name '*.spec.ts' -o -name '*.test.ts' | xargs sed -i 's/jest\.setSystemTime/vi.setSystemTime/g'

# 替换 import（如果用了 globals: true 就不需要）
find src -name '*.spec.ts' -o -name '*.test.ts' | xargs sed -i 's/from '\''@jest\/globals'\''/from '\''vitest'\''/g'
```

### 第四步：处理环境变量

```typescript
// 原来 Jest 需要 jest.config.ts 中配置：
// testEnvironment: 'jsdom',
// moduleNameMapper: { '\\.(css|less)$': 'identity-obj-proxy' },

// Vitest 在 vite.config.ts 中一行搞定：
test: {
  environment: 'jsdom',
  css: false, // 或者 true，按需
}
```

### 第五步：更新 package.json

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 迁移检查清单

```
□ 安装 vitest 和 @vitest/coverage-v8
□ vite.config.ts 添加 test 配置
□ jest.fn() → vi.fn()
□ jest.spyOn() → vi.spyOn()
□ jest.mock() → vi.mock()
□ jest.useFakeTimers() → vi.useFakeTimers()
□ jest.setSystemTime() → vi.setSystemTime()
□ 删除 jest.config.ts
□ package.json scripts 更新
□ 跑一遍测试确认通过
□ 删除 jest 相关依赖（可选）
```

## 踩坑记录

### 坑 1：`vi.mock` 是 hoisted 的

Vitest 会把 `vi.mock()` 调用提升到文件顶部，这是刻意设计（和 Jest 的 `jest.mock` 行为一致）。

```typescript
// ❌ 这样写不会报错，但 mock 会被提升
import { someFunction } from './module'

vi.mock('./module', () => ({
  someFunction: vi.fn().mockReturnValue('mocked'),
}))

// ✅ 如果需要在 mock 中引用被 mock 的模块的其他内容
vi.mock('./module', async (importOriginal) => {
  const original = await importOriginal<typeof import('./module')>()
  return {
    ...original,
    someFunction: vi.fn().mockReturnValue('mocked'),
  }
})
```

### 坑 2：Vue 3 `<script setup>` 组件的测试

`<script setup>` 组件没有暴露方法，测试需要通过 DOM 交互触发行为：

```typescript
// ❌ 不能直接调用组件方法
const wrapper = mount(MyComponent)
wrapper.vm.handleSubmit() // 如果用了 <script setup>，这会报错

// ✅ 通过 DOM 触发
await wrapper.find('form').trigger('submit')
```

### 坑 3：`async` 组件需要 `flushPromises`

```typescript
import { flushPromises } from '@vue/test-utils'

it('异步数据加载', async () => {
  const wrapper = mount(AsyncComponent)

  // 初始状态
  expect(wrapper.find('.loading').exists()).toBe(true)

  // 等待异步操作完成
  await flushPromises()

  // 数据加载后
  expect(wrapper.find('.loading').exists()).toBe(false)
  expect(wrapper.find('.data').text()).toContain('内容')
})
```

### 坑 4：CSS 模块在 jsdom 中不生效

jsdom 不支持真实 CSS 解析。如果测试依赖 CSS 类名选择器：

```typescript
// 选项 1：用 happy-dom 替代 jsdom（更好的 CSS 支持）
test: { environment: 'happy-dom' }

// 选项 2：直接用 DOM 结构判断，不依赖样式
expect(wrapper.find('[data-testid="submit-btn"]').exists()).toBe(true)

// 选项 3：mock CSS 模块
// vite.config.ts
test: {
  css: {
    modules: {
      classNameStrategy: 'non-scoped', // 不做 CSS Modules 转换
    },
  },
}
```

### 坑 5：环境变量差异

```typescript
// Jest 用 process.env
// Vitest 用 import.meta.env（与 Vite 一致）

// ❌ 测试中直接读 process.env
const apiUrl = process.env.VITE_API_URL

// ✅ 与 Vite 保持一致
const apiUrl = import.meta.env.VITE_API_URL

// 在测试 setup 中设置环境变量
// tests/setup.ts
import { vi } from 'vitest'

vi.stubEnv('VITE_API_URL', 'https://api.test.example.com')
```

### 坑 6：`vi.mock` 中的动态路径

```typescript
// ❌ 动态路径可能不被正确 mock
const componentName = 'ProductCard'
vi.mock(`@/components/${componentName}.vue`, () => ({
  default: { template: '<div>mocked</div>' },
}))

// ✅ 改成静态路径
vi.mock('@/components/ProductCard.vue', () => ({
  default: { template: '<div>mocked</div>' },
}))
```

### 坑 7：并行测试与全局状态

Vitest 默认并行运行测试文件。如果测试之间共享全局状态：

```typescript
// ❌ 全局状态污染
let counter = 0

it('测试 1', () => {
  counter = 10
  expect(counter).toBe(10)
})

it('测试 2', () => {
  counter = 20 // 可能拿到 10 或 20，取决于执行顺序
  expect(counter).toBe(20)
})

// ✅ 每个测试独立状态
it('测试 1', () => {
  let counter = 0
  counter = 10
  expect(counter).toBe(10)
})

it('测试 2', () => {
  let counter = 0
  counter = 20
  expect(counter).toBe(20)
})
```

## 总结

Vitest 本质上是"Vite 生态中的 Jest"——保留了 Jest 的 API 习惯，但彻底解决了速度和配置问题。

**Vitest 的核心优势：**

1. **速度**：利用 Vite 的预构建缓存，冷启动从 3-10s 降到 < 500ms
2. **零配置**：共享 `vite.config.ts`，alias、插件、环境变量自动生效
3. **ESM 原生**：不需要 babel 转译，TypeScript/Vue 文件直接处理
4. **HMR**：watch 模式下改测试文件即时重跑，改源码文件即时重跑依赖的测试
5. **API 兼容**：`vi.fn()` / `vi.mock()` 与 Jest API 几乎一致，迁移成本极低

**迁移决策矩阵：**

| 项目类型 | 推荐 |
|---------|------|
| Vue 3 + Vite 项目 | **直接用 Vitest**，没有理由选 Jest |
| React + Vite 项目 | **推荐 Vitest**，配置更简单 |
| 纯 Node.js 后端 | Vitest 可以用，但 Jest 生态更成熟 |
| 已有大型 Jest 项目 | 可以逐步迁移，Vitest 兼容 Jest API |

对于 Laravel 前端项目（Vue 3 + Vite 构建），Vitest 是**唯一正确选择**——你的 Vite 配置在测试中自动生效，不需要维护两套配置。

> ⚡ 本文代码均可在 Vue 3 + Vite + Laravel 项目中直接运行。测试配置文件：`vite.config.ts`，测试目录：`src/**/__tests__/`。
