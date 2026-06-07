# Tailwind CSS v4

## 定义
Tailwind CSS 是原子化 CSS 框架，通过 utility-first 的类名组合快速构建 UI。v4 版本使用 Rust 重写了引擎，性能大幅提升，并改进了与 Laravel Livewire 的集成。

## 核心原理

### Utility-First 理念
```html
<!-- 传统 CSS -->
<div class="card">...</div>
<style>
.card { padding: 1rem; border-radius: 0.5rem; box-shadow: ...; }
</style>

<!-- Tailwind CSS -->
<div class="p-4 rounded-lg shadow-md">...</div>
```

### v4 核心改进
- **Rust 引擎重写** - 构建速度提升 10-100x
- **CSS-first 配置** - 使用 CSS `@theme` 指令替代 `tailwind.config.js`
- **自动内容检测** - 不再需要手动配置 `content` 路径
- **改进的变体系统** - 更灵活的响应式和状态变体

### v4 配置方式
```css
/* app.css */
@import "tailwindcss";

@theme {
  --color-primary: oklch(0.7 0.15 250);
  --color-secondary: oklch(0.6 0.12 180);
  --font-sans: 'Inter', sans-serif;
}
```

### 与 Laravel Livewire 集成
```html
<!-- Livewire 组件中使用 Tailwind -->
<div class="flex items-center gap-4">
    <input wire:model.live="search" 
           class="border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500">
    <button wire:click="save" 
            class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600">
        保存
    </button>
</div>
```

## 实战案例
来自博客文章：
- [Tailwind CSS v4 实战](/categories/前端/2026-06-02-tailwind-css-v4-engine-rewrite-performance-livewire-integration/) - 引擎重写后的性能飞跃与 Laravel Livewire 集成

## 相关概念
- [Vue 3 组件库开发](Vue3-组件库开发.md) - Tailwind 与组件库的结合
- [构建优化策略](构建优化策略.md) - Tailwind 的 PurgeCSS 优化

## 常见问题

**Q: Tailwind vs Bootstrap？**
A: Tailwind 更灵活，类名更长但不重复。Bootstrap 组件预设多但定制受限。

**Q: 类名太多怎么办？**
A: 使用 `@apply` 提取公共类，或封装为组件。框架组件（Vue/React）天然解决这个问题。
