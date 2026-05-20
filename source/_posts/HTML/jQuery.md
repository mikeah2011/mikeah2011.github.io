---
title: jQuery
tags: [JavaScript, 前端]
categories:
  - HTML
date: 2019-03-20 15:05:07
description: 'jQuery 是 2006 年发布的 JavaScript 库，"write less, do more"，曾经统治整个前端时代。如今被现代框架取代，但维护老项目仍绕不开它。'
---

## 一、jQuery 的历史地位

jQuery 由 John Resig 于 2006 年发布。它在那个**浏览器兼容性地狱**（IE6/7/8 时代）里做了一件改变行业的事：

- 用统一 API 抹平浏览器差异
- 链式调用让 DOM 操作变优雅
- AJAX 一行代码搞定（`$.ajax`）
- 选择器引擎 Sizzle 是 CSS3 选择器规范的事实参考

巅峰时期，**全球 80%+ 网站都引了 jQuery**，是 Web 开发史上最成功的开源库之一。

> 现在还需要它吗？**新项目不需要**。但维护老 PHP/Java 后台、Bootstrap 3/4 模板、WordPress 插件，仍然要会。

---

## 二、为什么现在不推荐新项目用

| 问题 | 说明 |
|------|------|
| **DOM API 已经够用** | `querySelector`、`fetch`、`classList` 原生支持 |
| **响应式 UI 是大势** | React/Vue 数据驱动，jQuery 命令式过时 |
| **打包体积** | 30 KB+ 仅为了几个工具函数不划算 |
| **大型项目难维护** | 满屏 `$(...)` 选择器，重构成本高 |
| **生态停滞** | 插件更新慢，与现代构建工具集成不友好 |

但是 —— **小项目、老项目、单页营销页**，jQuery 依然轻便好用。

---

## 三、核心用法速览

### 引入

```html
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
```

### DOM 选择 + 操作

```js
// 选择
$('#id')               // ID
$('.class')            // class
$('div p:first')       // 复合 CSS 选择器
$('input[type=text]')  // 属性选择

// 链式调用（jQuery 灵魂）
$('#box')
  .addClass('active')
  .css('color', 'red')
  .text('Hello')
  .fadeIn(300);

// 遍历
$('li').each(function (i, el) {
  console.log(i, el.textContent);
});
```

### 事件

```js
$('#btn').on('click', function () {
  console.log('clicked', this);
});

// 事件委托（动态元素必用）
$('#list').on('click', 'li.item', function () {
  console.log('item:', $(this).data('id'));
});

// 解绑
$('#btn').off('click');
```

### AJAX

```js
$.ajax({
  url: '/api/users',
  method: 'POST',
  data: { name: 'Mike' },
  dataType: 'json',
  success: function (res) { console.log(res); },
  error: function (xhr) { console.error(xhr.statusText); }
});

// 简写
$.get('/api/users', { id: 1 }, console.log);
$.post('/api/save', { name: 'Mike' });
$.getJSON('/data.json', console.log);
```

### 动画

```js
$('#box').slideDown(400);
$('#box').fadeOut(200);
$('#box').animate({ left: '+=100', opacity: 0.5 }, 500);
```

---

## 四、用原生 JS 替代 jQuery（速查表）

| jQuery | 原生 JS |
|--------|---------|
| `$('#id')` | `document.getElementById('id')` |
| `$('.cls')` | `document.querySelectorAll('.cls')` |
| `$el.addClass('x')` | `el.classList.add('x')` |
| `$el.removeClass('x')` | `el.classList.remove('x')` |
| `$el.toggleClass('x')` | `el.classList.toggle('x')` |
| `$el.css('color','red')` | `el.style.color = 'red'` |
| `$el.html('<b>hi</b>')` | `el.innerHTML = '<b>hi</b>'` |
| `$el.text('hi')` | `el.textContent = 'hi'` |
| `$el.attr('href')` | `el.getAttribute('href')` |
| `$el.on('click', fn)` | `el.addEventListener('click', fn)` |
| `$.ajax / $.get` | `fetch(url).then(r => r.json())` |
| `$(document).ready(fn)` | `document.addEventListener('DOMContentLoaded', fn)` |

如果你只用 jQuery 做 DOM 操作 + AJAX，**完全可以扔掉**。

---

## 五、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **`$` 冲突** | 和 Prototype.js 等冲突 | `jQuery.noConflict()` 让出 `$` |
| **Ready 时序** | 操作不到 DOM | 包在 `$(function(){...})` 或 `DOMContentLoaded` 里 |
| **事件没解绑** | 切页后内存泄漏 | 用命名空间 `$.on('click.foo')` + `$.off('.foo')` 批量解绑 |
| **动态元素无事件** | 后加的 DOM 点击没反应 | 用 `.on('click', '.selector', fn)` 委托 |
| **异步 this 丢失** | `success` 里 `this` 不是元素 | 用 `var self = this` 或箭头函数（如果 ES6+） |
| **版本兼容** | jQuery 3 移除了一些 API（`.bind/.live/.size`） | 升级前看 [Migrate Plugin](https://github.com/jquery/jquery-migrate) |

---

## 六、版本选择

| 系列 | 适用 |
|------|------|
| jQuery 1.x | 兼容 IE6-8（已停止更新） |
| jQuery 2.x | 不支持 IE8-（已停止） |
| **jQuery 3.x** | 当前唯一在维护的版本，IE9+ |

---

## 参考

- 官网：<https://jquery.com>
- API 中文：<https://www.jquery123.com>
- You Might Not Need jQuery：<https://youmightnotneedjquery.com>
