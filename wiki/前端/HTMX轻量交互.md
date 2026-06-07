# HTMX 轻量交互

## 定义
HTMX 是一个轻量级库，通过 HTML 属性扩展实现 AJAX、CSS 过渡、WebSocket 等交互能力，无需编写 JavaScript。与 Laravel 结合可构建超轻量的前后端方案。

## 核心原理

### 核心理念
```html
<!-- 传统方式：需要 JavaScript -->
<button onclick="fetch('/api/data').then(r => r.text()).then(html => document.getElementById('result').innerHTML = html)">

<!-- HTMX 方式：纯 HTML 属性 -->
<button hx-get="/api/data" hx-target="#result">
```

### 常用属性
| 属性 | 作用 |
|------|------|
| `hx-get` | GET 请求 |
| `hx-post` | POST 请求 |
| `hx-target` | 响应插入的目标元素 |
| `hx-swap` | 插入方式（innerHTML/outerHTML/beforeend） |
| `hx-trigger` | 触发事件（click/change/intersect） |
| `hx-vals` | 附加数据 |

### 与 Laravel 集成
```php
// Laravel 返回 HTML 片段
public function search(Request $request)
{
    $products = Product::search($request->q)->get();
    return view('partials.product-list', compact('products'));
}
```

```html
<!-- HTMX 请求 -->
<input hx-get="/search" hx-trigger="keyup changed delay:300ms" 
       hx-target="#results" name="q">
<div id="results"></div>
```

### 适用场景
- 传统多页应用的渐进增强
- 管理后台 CRUD
- 不需要复杂前端状态的场景
- 团队不熟悉前端框架

## 实战案例
来自博客文章：
- [HTMX 实战](/categories/前端/2026-06-02-HTMX-实战-不用JavaScript框架也能做交互-Laravel-HTMX超轻量前后端方案/) - Laravel + HTMX 的超轻量前后端方案

## 相关概念
- [SvelteKit 全栈框架](SvelteKit全栈框架.md) - 另一种轻量级方案
- [Nuxt 4 全栈框架](Nuxt4全栈框架.md) - 对比方案

## 常见问题

**Q: HTMX 能替代 Vue/React 吱？**
A: 不能完全替代。适合简单交互场景，复杂 SPA 仍需框架。

**Q: 性能如何？**
A: HTMX 本身极小（~14KB），但每次交互都是完整 HTML 片段传输，适合服务端渲染场景。
