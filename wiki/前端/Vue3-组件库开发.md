# Vue 3 组件库开发

## 定义
Vue 3 组件库开发是指基于 Vue 3 Composition API + TypeScript 构建可复用的 UI 组件库，支持按需加载、主题定制、文档生成，并可发布到 npm 或私有仓库。

## 核心原理

### 组件库结构
```
my-ui/
├── packages/
│   ├── button/
│   │   ├── Button.vue        # 组件实现
│   │   ├── button.ts         # Props/Emits 类型定义
│   │   └── style/
│   │       └── index.scss    # 组件样式
│   ├── input/
│   └── index.ts              # 统一导出
├── docs/                      # 文档站
├── play/                      # 开发调试
└── build/                     # 构建脚本
```

### Props 设计模式
```typescript
// button.ts
export const buttonProps = {
  type: {
    type: String as PropType<'primary' | 'success' | 'warning' | 'danger'>,
    default: 'primary'
  },
  size: {
    type: String as PropType<'small' | 'medium' | 'large'>,
    default: 'medium'
  },
  loading: Boolean,
  disabled: Boolean
} as const
```

### 按需加载
```typescript
// 通过 tree-shaking 实现按需加载
import { Button, Input } from 'my-ui'
// 而不是 import 'my-ui' 全量引入
```

### 主题定制
- CSS 变量（推荐）
- SCSS 变量覆盖
- Design Token 方案

## 实战案例
来自博客文章：
- [Vue 3 组件库开发实战](/categories/Frontend/vue3-guide-ui/) - 自定义 UI 组件库设计与发布踩坑记录
- [vue-pure-admin 管理后台实战](/categories/Frontend/vue3-vue-pure-admin-guide-fork/) - 基于现有组件库的定制化

## 相关概念
- [Vue 3 Composition API](Vue3-Composition-API.md) - 组件库的 API 设计基础
- [Vue 3 TypeScript](Vue3-TypeScript.md) - 组件类型定义
- [Tailwind CSS v4](Tailwind-CSS-v4.md) - 原子化 CSS 与组件库的结合

## 常见问题

**Q: 自建组件库还是用 Element Plus / Ant Design Vue？**
A: 通用场景用成熟组件库。有品牌定制需求或特殊交互时自建。

**Q: 组件库怎么写文档？**
A: 推荐 Vitepress，支持在 Markdown 中嵌入 Vue 组件 demo。
