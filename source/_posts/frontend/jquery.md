---

title: jQuery 核心 API 速查：DOM 操作、事件处理与 AJAX
keywords: [jQuery, API, DOM, AJAX, 核心, 速查, 操作, 事件处理与]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- JavaScript
- jQuery
- 前端
- DOM操作
- AJAX
- 事件处理
- 前端框架
categories:
- frontend
date: 2019-03-20 15:05:07
updated: 2026-06-06 10:00:00
description: jQuery 是曾经统治整个前端开发领域的 JavaScript 库，虽然如今已被 Vue 和 React 等现代框架取代了主导地位，但在维护大量老项目、快速开发营销活动落地页、WordPress 主题与插件定制等场景中仍然具有重要的实际价值。本文系统全面地讲解 jQuery 3.x 核心用法与现代开发最佳实践，涵盖事件委托优化策略、AJAX 高级封装与错误处理、Deferred 异步编程模式、自定义插件开发技巧，同时提供 jQuery 与原生 JavaScript 的完整对照速查表，以及从 jQuery 渐进式迁移到原生 JS 和现代前端框架的详细指南，帮助前端开发者在新旧技术栈之间自如切换。
---





## 一、jQuery 的历史地位与行业影响

jQuery 由 John Resig 于 2006 年发布，它的出现彻底改变了前端开发的方式。在那个浏览器兼容性堪称噩梦的年代（IE6/7/8 三兄弟各自为政），jQuery 做了几件影响深远的事情：

- **统一的 DOM 操作 API**：开发者再也不用写 `if (IE) {...} else {...}` 这种丑陋的浏览器嗅探代码，一套代码跑遍所有浏览器
- **链式调用的设计哲学**：把命令式的 DOM 操作变成了流畅的链式表达，`$('#box').addClass('active').css('color','red').fadeIn(300)` 这种写法在当时是革命性的
- **AJAX 民主化**：`$.ajax` 让前后端异步通信变得极其简单，直接催生了 Web 2.0 的繁荣
- **选择器引擎 Sizzle**：jQuery 的 Sizzle 引擎甚至影响了 W3C CSS3 选择器规范的制定，成为了事实上的标准参考
- **插件生态爆发**：数千个高质量插件覆盖了轮播、表单验证、图表、拖拽等几乎所有场景

巅峰时期，全球超过 80% 的网站都在使用 jQuery。它不仅是一个工具库，更是整整一代前端开发者的启蒙教材。即便今天 React 和 Vue 大行其道，jQuery 的设计思想——简洁、实用、降低门槛——仍然深深影响着现代框架的 API 设计。

> 那现在还需要学它吗？新项目当然不需要。但维护老 PHP/Java 后台系统、Bootstrap 3/4 模板项目、WordPress 插件和主题开发、以及大量的遗留企业应用，jQuery 仍然是绕不开的技能。更现实的是，很多公司招前端面试仍然会问 jQuery 相关问题。

---

## 二、为什么现在不推荐新项目使用 jQuery

jQuery 的衰落不是因为它变差了，而是整个前端生态进化了。以下是具体的原因分析：

| 问题 | 详细说明 |
|------|----------|
| **原生 DOM API 已经足够强大** | `querySelector`、`querySelectorAll`、`fetch`、`classList`、`closest()`、`dataset` 等原生 API 在现代浏览器中全面可用，jQuery 的封装层变得多余 |
| **响应式 UI 成为主流** | React/Vue 的数据驱动视图更新模式，从根本上解决了 jQuery 命令式操作 DOM 带来的心智负担和维护成本 |
| **打包体积不划算** | 30KB+ 的压缩体积，仅仅为了几个工具函数和 DOM 操作封装，在性能敏感的项目中显得奢侈 |
| **大型项目代码难以维护** | 满屏的 `$(...)` 选择器散落在各个文件中，状态管理依赖全局变量，重构成本极高 |
| **生态系统停滞不前** | 大量 jQuery 插件已停止维护，与现代构建工具（Vite、Webpack 5）的集成不够友好 |
| **TypeScript 支持薄弱** | 虽然有 `@types/jquery`，但 jQuery 的链式 API 和动态返回类型让类型推导经常不够精确 |

不过话说回来——小项目、老项目维护、单页营销落地页、WordPress 主题开发，jQuery 依然是一款轻便好用的工具。技术选型没有绝对的对错，关键是选择合适的工具解决当前的问题。

---

## 三、核心用法速览

### 3.1 引入方式

```html
<!-- CDN 引入（推荐生产环境用 minified 版本） -->
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>

<!-- npm 安装（配合构建工具使用） -->
<!-- npm install jquery -->
<!-- 然后在 JS 中: import $ from 'jquery' -->
```

### 3.2 DOM 选择与操作

```js
// === 选择器（基于 Sizzle 引擎，支持所有 CSS3 选择器） ===
$('#id')               // ID 选择器（最快）
$('.class')            // 类选择器
$('div p:first')       // 复合选择器：第一个 div 下的 p
$('input[type=text]')  // 属性选择器
$('ul > li:nth-child(2n)')  // 伪类选择器
$('[data-role="admin"]')    // data 属性选择

// === 链式调用（jQuery 的灵魂所在） ===
$('#box')
  .addClass('active highlighted')    // 添加多个 class
  .css('color', 'red')               // 设置样式
  .attr('data-status', 'loading')    // 设置属性
  .text('Hello jQuery')              // 设置文本内容
  .fadeIn(300);                      // 淡入动画

// === 遍历元素集合 ===
$('li').each(function (index, element) {
  // 注意：this === element（原生 DOM 元素）
  // 要用 jQuery 方法需要包装：$(this)
  console.log(index, element.textContent);
  $(this).attr('data-index', index);
});

// === 创建并插入 DOM ===
var $newItem = $('<li>', {
  'class': 'item',
  'data-id': 42,
  text: '新增项目'
});
$('#list').append($newItem);       // 追加到末尾
$('#list').prepend($newItem);      // 插入到开头
$newItem.insertBefore('#target');  // 插入到目标前面
$newItem.insertAfter('#target');   // 插入到目标后面
```

### 3.3 事件处理

```js
// === 基本事件绑定 ===
$('#btn').on('click', function (event) {
  event.preventDefault();   // 阻止默认行为
  event.stopPropagation();  // 阻止冒泡
  console.log('按钮被点击了', this);
});

// === 一次绑定多个事件 ===
$('#input').on({
  focus: function () { $(this).addClass('focused'); },
  blur: function () { $(this).removeClass('focused'); },
  input: function () { console.log('输入中:', $(this).val()); }
});

// === 事件委托（动态元素必用，也是推荐的默认写法） ===
$('#list').on('click', 'li.item', function () {
  var id = $(this).data('id');
  console.log('点击了项目:', id);
  $(this).siblings().removeClass('selected');
  $(this).addClass('selected');
});

// === 解绑事件 ===
$('#btn').off('click');                     // 解除所有 click
$('#btn').off('click.myModule');            // 只解除命名空间 myModule
$('#list').off('click', 'li.item');         // 解除委托事件
```

### 3.4 AJAX 请求

```js
// === 基本 AJAX ===
$.ajax({
  url: '/api/users',
  method: 'POST',
  data: { name: 'Mike', age: 30 },
  dataType: 'json',
  success: function (res) { console.log('成功:', res); },
  error: function (xhr, status, err) { console.error('失败:', xhr.statusText); }
});

// === 快捷方法 ===
$.get('/api/users', { id: 1 }, function (res) { console.log(res); });
$.post('/api/save', { name: 'Mike' });
$.getJSON('/data.json', function (data) { console.log(data); });

// === 加载 HTML 片段 ===
$('#container').load('/partials/sidebar.html', function () {
  console.log('片段加载完成');
});
```

### 3.5 动画效果

```js
// 内置动画方法
$('#box').slideDown(400);     // 向下滑出
$('#box').slideUp(300);       // 向上收起
$('#box').slideToggle(200);   // 切换滑动
$('#box').fadeIn(500);        // 淡入
$('#box').fadeOut(300);       // 淡出
$('#box').fadeTo(500, 0.5);   // 渐变到指定透明度

// 自定义动画
$('#box').animate({
  left: '+=200',
  opacity: 0.5,
  fontSize: '24px'
}, 800, 'swing', function () {
  // 动画完成后的回调
  console.log('动画结束');
});

// 停止动画
$('#box').stop();              // 停止当前动画
$('#box').stop(true, true);    // 清除队列并跳到终态
$('#box').finish();            // 停止并跳到所有动画终态
```

---

## 四、jQuery 3.x 现代最佳实践

### 4.1 永远用 `.on()` 绑定事件

jQuery 3 已经移除了 `.bind()`、`.live()`、`.delegate()` 这些老旧的事件绑定方法。在 jQuery 3.x 中，统一使用 `.on()` 处理所有事件绑定：

```js
// ✅ 正确：直接绑定
$('#btn').on('click', handler);

// ✅ 正确：事件委托（推荐用于动态元素，也是性能最优方案）
$(document).on('click', '.btn-submit', function () {
  // 后来动态添加到 DOM 中的 .btn-submit 也能触发
});

// ❌ 已废弃——这些方法在 jQuery 3 中已被删除
$('#btn').bind('click', handler);       // 用 .on() 替代
$('.btn').live('click', handler);       // jQuery 1.9 就删了
$('#list').delegate('li', 'click', fn); // 用 .on() 替代
```

### 4.2 使用 `.prop()` 替代 `.attr()` 处理布尔属性

这是 jQuery 1.6 引入的重要区分，但很多老代码仍然在混用：

```js
// ❌ 错误用法：attr 返回的是字符串 "checked" 或 undefined
$(':checkbox').attr('checked');      // "checked" 或 undefined
$(':checkbox').attr('checked', true); // 写入 checked="checked"

// ✅ 正确用法：prop 返回布尔值，操作 DOM 属性而非 HTML 属性
$(':checkbox').prop('checked');       // true 或 false
$(':checkbox').prop('checked', true); // 设置 DOM 的 checked 属性
$('#btn').prop('disabled', false);    // 启用按钮
$('#input').prop('readonly', true);   // 设置只读
```

规则很简单：**HTML 属性用 `.attr()`（如 `href`、`src`、`data-*`），DOM 属性用 `.prop()`（如 `checked`、`disabled`、`selected`、`value`）**。

### 4.3 Deferred 与 Promise 模式

jQuery 3 对 Promise/A+ 规范的兼容做了重大改进。`.then()` 现在是真正的 Promise 链式方法，而不再是 `.pipe()` 的别名：

```js
// === 创建 Deferred ===
function fetchUserWithCache(id) {
  var dfd = $.Deferred();

  // 先检查缓存
  var cached = sessionStorage.getItem('user_' + id);
  if (cached) {
    dfd.resolve(JSON.parse(cached));
    return dfd.promise();
  }

  // 缓存未命中，发请求
  $.ajax({ url: '/api/users/' + id })
    .done(function (user) {
      sessionStorage.setItem('user_' + id, JSON.stringify(user));
      dfd.resolve(user);
    })
    .fail(dfd.reject);

  return dfd.promise();
}

// 使用 .then() 链式调用（jQuery 3 真正支持了）
fetchUserWithCache(42)
  .then(function (user) {
    console.log('用户:', user.name);
    return $.ajax({ url: '/api/orders?uid=' + user.id });
  })
  .then(function (orders) {
    console.log('订单数:', orders.length);
  })
  .catch(function (err) {
    // 统一错误处理
    console.error('请求失败:', err.statusText || err);
  });
```

### 4.4 `.each()` 遍历的最佳实践

```js
// === 遍历 DOM 元素集合 ===
$('.product-card').each(function (index) {
  // this === 当前原生 DOM 元素（不是 jQuery 对象！）
  var price = $(this).find('.price').text();
  var name = $(this).find('.title').text();
  console.log('商品', index + 1, name, '价格:', price);
});

// === 遍历数组 ===
var fruits = ['苹果', '香蕉', '橙子'];
$.each(fruits, function (i, fruit) {
  console.log(i, fruit);
});

// === 遍历对象 ===
var user = { name: '张三', age: 28, city: '北京' };
$.each(user, function (key, value) {
  console.log(key + ': ' + value);
});

// ⚡ 性能提示：如果遍历的是纯数组且不需要中断，
// 原生 forEach 更快（少一层函数调用包装）
// 大量数据（10万+）用原生 for 循环
```

### 4.5 使用 `.data()` 管理元素关联数据

```js
// HTML: <div id="user" data-id="42" data-role="admin" data-created="2024-01-15"></div>

// 读取（自动做类型转换：数字字符串转数字，JSON 字符串转对象）
$('#user').data('id');       // 42（数字，不是字符串 "42"）
$('#user').data('role');     // "admin"
$('#user').data('created');  // "2024-01-15"（无法转换的保持原样）

// 写入（仅存在 jQuery 内部缓存，不写入 DOM 属性！）
$('#user').data('token', 'abc123');
$('#user').data('permissions', ['read', 'write']);

// 获取全部数据
$('#user').data();  // { id: 42, role: "admin", created: "2024-01-15", token: "abc123", ... }

// ⚠️ 注意坑：.data() 读取的是初始化时从 DOM 属性读入的缓存，
// 后续修改 HTML 属性不会反映在 .data() 中
$('#user').attr('data-id', 99);
$('#user').data('id');  // 仍然是 42！
```

---

## 五、事件委托模式与性能优化

### 5.1 为什么事件委托应该是你的首选方案

事件委托的核心原理是利用浏览器的事件冒泡机制：将事件监听器绑定在**父元素**上，当子元素触发事件时，事件会冒泡到父元素被监听器捕获。这样做的好处是多方面的：

1. **动态元素自动生效**：后来通过 AJAX 或用户操作动态添加到 DOM 中的元素，无需重新绑定事件
2. **内存占用大幅减少**：100 个列表项只需要 1 个监听器，而不是 100 个。对于大数据列表，这个差异非常显著
3. **代码更简洁**：只需在父元素上绑定一次，解绑时也只需 `.off()` 一次
4. **避免内存泄漏风险**：不存在忘记给动态元素解绑的问题

```js
// ✅ 推荐方案：绑定到最近的稳定父元素
$('#product-list').on('click', '.product-card', function () {
  var id = $(this).data('id');
  openProductDetail(id);
});

// ❌ 不推荐：给每个子元素单独绑定
$('.product-card').on('click', function () {
  // 如果后来通过 AJAX 又添加了新的 .product-card，
  // 这些新元素不会绑定事件
});
```

### 5.2 选择合适的委托目标

委托目标的选择直接影响性能。原则是：**委托到最近的稳定祖先元素**。

```js
// ⚠️ 不好：委托到 document 会冒泡太多层，每次点击都要遍历整棵 DOM 树
$(document).on('click', '.btn', handler);

// ✅ 好：委托到最近的稳定祖先
$('#form-area').on('click', '.btn', handler);

// ✅ 更好：如果 .product-list 本身也是稳定的，用它
$('#product-list').on('click', '.product-card', handler);
```

### 5.3 命名空间管理事件

当一个元素上绑定了来自不同模块的多个事件时，命名空间可以让你精确地解绑特定模块的事件而不影响其他模块：

```js
// 模块 A 的事件
$('#box').on('click.moduleA', handleClickA);
$('#box').on('mouseenter.moduleA', handleHoverA);

// 模块 B 的事件
$('#box').on('click.moduleB', handleClickB);
$('#box').on('keydown.moduleB', handleKeyB);

// 只解绑模块 A 的所有事件，模块 B 的不受影响
$('#box').off('.moduleA');

// 模块 B 的 click 和 keydown 仍然正常工作
```

### 5.4 性能优化清单

| 优化技巧 | 具体说明 |
|----------|----------|
| **事件委托** | 少绑定监听器、免除重复绑定、节省内存 |
| **节流与防抖** | 对高频触发的事件（scroll、resize、input、mousemove）限制执行频率 |
| **缓存 jQuery 选择器** | `var $box = $('#box');` 后续用 `$box`，避免每次都查询 DOM |
| **批量 DOM 操作** | 先在内存中拼好 HTML 字符串或使用 DocumentFragment，再一次性插入 |
| **避免在循环中用 `.css()`** | 批量修改样式时用 `.addClass()`/`.removeClass()` 操作 class，让浏览器统一重绘 |
| **合理使用 `.detach()`** | 大量 DOM 修改时先 `.detach()` 移出文档流，操作完再 `.append()` 回去 |

```js
// === 防抖示例（搜索框输入） ===
var searchTimer;
$('#search-input').on('input', function () {
  clearTimeout(searchTimer);
  var query = $(this).val();
  searchTimer = setTimeout(function () {
    if (query.length >= 2) {
      doSearch(query);
    }
  }, 300);  // 用户停止输入 300ms 后才发请求
});

// === 批量 DOM 操作示例 ===
// ❌ 慢：逐个插入，每次都会触发重排
$.each(data, function (i, item) {
  $('#list').append('<li>' + item.name + '</li>');
});

// ✅ 快：拼接完一次性插入
var html = '';
$.each(data, function (i, item) {
  html += '<li class="item" data-id="' + item.id + '">' + item.name + '</li>';
});
$('#list').html(html);
```

---

## 六、jQuery AJAX 高级用法

### 6.1 完整的 AJAX 封装（含加载状态、超时处理、CSRF 令牌）

在实际项目中，裸用 `$.ajax` 往往不够。你需要统一的加载状态管理、错误处理、CSRF 令牌注入等：

```js
function ajaxWithLoading(options) {
  var $loading = $('#loading-spinner');
  var $btn = options.triggerBtn ? $(options.triggerBtn) : null;

  // 显示加载状态
  $loading.show();
  if ($btn) {
    $btn.prop('disabled', true).addClass('loading');
  }

  return $.ajax({
    url: options.url,
    method: options.method || 'GET',
    data: options.data || {},
    dataType: options.dataType || 'json',
    contentType: options.contentType || 'application/x-www-form-urlencoded',
    timeout: options.timeout || 15000,  // 默认 15 秒超时
    headers: {
      'X-CSRF-TOKEN': $('meta[name=csrf-token]').attr('content'),
      'X-Requested-With': 'XMLHttpRequest'  // 标识 AJAX 请求
    }
  })
  .done(function (res) {
    if (options.onSuccess) options.onSuccess(res);
  })
  .fail(function (xhr, status, err) {
    if (status === 'timeout') {
      showTip('请求超时，请检查网络后重试');
    } else if (xhr.status === 401) {
      showTip('登录已过期，请重新登录');
      setTimeout(function () { window.location.href = '/login'; }, 1500);
    } else if (xhr.status === 403) {
      showTip('您没有权限执行此操作');
    } else if (xhr.status === 422) {
      // Laravel 表单验证错误
      var errors = xhr.responseJSON.errors;
      var firstError = Object.values(errors)[0][0];
      showTip(firstError);
    } else if (xhr.status >= 500) {
      showTip('服务器内部错误，请稍后重试');
    } else {
      showTip('请求失败: ' + (xhr.responseJSON?.message || err));
    }
    if (options.onError) options.onError(xhr);
  })
  .always(function () {
    // 无论成功失败都要执行的清理工作
    $loading.hide();
    if ($btn) {
      $btn.prop('disabled', false).removeClass('loading');
    }
  });
}

// 使用示例
ajaxWithLoading({
  url: '/api/orders',
  method: 'POST',
  data: { productId: 42, quantity: 1 },
  triggerBtn: '#submit-btn',
  onSuccess: function (res) {
    showTip('下单成功！');
    window.location.href = '/orders/' + res.data.id;
  }
});
```

### 6.2 模拟 AbortController（取消上一次未完成的请求）

在搜索联想这类场景中，每次输入新字符时需要取消上一次未完成的请求。jQuery 的 `$.ajax` 返回的 `jqXHR` 对象支持 `.abort()` 方法：

```js
var searchXHR = null;
var searchTimer = null;

$('#search-input').on('input', function () {
  clearTimeout(searchTimer);
  var query = $(this).val().trim();

  if (!query) {
    $('#search-results').empty().hide();
    return;
  }

  searchTimer = setTimeout(function () {
    // 取消上一次未完成的请求
    if (searchXHR && searchXHR.readyState !== 4) {
      searchXHR.abort();
      console.log('已取消上一次搜索请求');
    }

    searchXHR = $.ajax({
      url: '/api/search',
      data: { q: query, limit: 10 },
      dataType: 'json'
    })
    .done(function (res) {
      renderSearchResults(res.data);
    })
    .fail(function (xhr, status) {
      if (status === 'abort') {
        console.log('搜索请求被取消');
        return;  // 被取消的请求不需要提示错误
      }
      console.error('搜索失败:', status);
    })
    .always(function () {
      searchXHR = null;
    });
  }, 300);
});
```

### 6.3 并行请求与 `$.when()`

当你需要同时发起多个请求，并在全部完成后执行回调时，`$.when()` 是 jQuery 的解决方案（类似于 `Promise.all`）：

```js
// === 并行请求用户信息和订单列表 ===
$.when(
  $.ajax({ url: '/api/user/profile' }),
  $.ajax({ url: '/api/user/orders' }),
  $.ajax({ url: '/api/user/notifications' })
).done(function (profileResp, ordersResp, notifResp) {
  // 每个 resp 是 [data, textStatus, jqXHR]
  var profile = profileResp[0];
  var orders = ordersResp[0];
  var notifications = notifResp[0];

  renderDashboard(profile, orders, notifications);
}).fail(function (xhr) {
  console.error('仪表盘数据加载失败:', xhr.statusText);
  showTip('数据加载失败，请刷新页面重试');
});
```

### 6.4 全局 AJAX 事件监听

jQuery 提供了全局的 AJAX 事件，可以在所有 AJAX 请求的生命周期中统一处理逻辑：

```js
// 所有 AJAX 请求开始时显示全局 loading
$(document).on('ajaxStart', function () {
  $('#global-loading').show();
});

// 所有 AJAX 请求结束时隐藏全局 loading
$(document).on('ajaxStop', function () {
  $('#global-loading').hide();
});

// 单个 AJAX 请求出错时
$(document).on('ajaxError', function (event, xhr, settings, error) {
  console.error('AJAX 错误:', settings.url, xhr.status, error);
});
```

---

## 七、jQuery vs 原生 JS 速查表

jQuery 的绝大部分功能现在都可以用原生 JavaScript 实现。下面是完整的对照表：

| jQuery | 原生 JS | 备注 |
|--------|---------|------|
| `$('#id')` | `document.getElementById('id')` | 返回 DOM 元素，非集合 |
| `$('.cls')` | `document.querySelectorAll('.cls')` | 返回 NodeList |
| `$el.addClass('x')` | `el.classList.add('x')` | 支持多个 class 参数 |
| `$el.removeClass('x')` | `el.classList.remove('x')` | |
| `$el.toggleClass('x')` | `el.classList.toggle('x')` | |
| `$el.hasClass('x')` | `el.classList.contains('x')` | |
| `$el.css('color','red')` | `el.style.color = 'red'` | 批量修改用 class 更高效 |
| `$el.html('<b>hi</b>')` | `el.innerHTML = '<b>hi</b>'` | 注意 XSS 风险 |
| `$el.text('hi')` | `el.textContent = 'hi'` | 安全，不解析 HTML |
| `$el.val()` | `el.value` | 直接读属性 |
| `$el.attr('href')` | `el.getAttribute('href')` | |
| `$el.data('id')` | `el.dataset.id` | 自动转驼峰命名 |
| `$el.on('click', fn)` | `el.addEventListener('click', fn)` | |
| `$el.off('click', fn)` | `el.removeEventListener('click', fn)` | 需传入同一函数引用 |
| `$.ajax / $.get` | `fetch(url).then(r => r.json())` | fetch 不会 reject HTTP 错误 |
| `$(document).ready(fn)` | `document.addEventListener('DOMContentLoaded', fn)` | |
| `$el.animate(...)` | `el.animate(keyframes, options)` | Web Animations API |
| `$el.append(html)` | `el.insertAdjacentHTML('beforeend', html)` | 性能更好 |
| `$el.remove()` | `el.remove()` | 原生也支持 |
| `$el.closest('.p')` | `el.closest('.p')` | 浏览器原生支持 |
| `$el.parent()` | `el.parentElement` | |
| `$el.children()` | `el.children` | 返回 HTMLCollection |
| `$el.siblings()` | `[...el.parentElement.children].filter(c => c !== el)` | 原生稍啰嗦 |
| `$.each(arr, fn)` | `arr.forEach(fn)` | |
| `$.extend({}, a, b)` | `{...a, ...b}` | 展开运算符更简洁 |
| `$.trim(str)` | `str.trim()` | 原生方法 |
| `$.isArray(x)` | `Array.isArray(x)` | |
| `$.Deferred()` | `new Promise((res, rej) => {...})` | 标准 Promise |

**结论**：如果你只用 jQuery 做 DOM 操作加 AJAX 请求，在现代浏览器环境下完全可以扔掉 jQuery。

---

## 八、jQuery vs 现代框架对比：何时该用谁

### 8.1 核心对比表

| 维度 | jQuery | Vue / React |
|------|--------|-------------|
| **定位** | DOM 操作工具库 | UI 组件框架 |
| **数据绑定** | 手动操作 DOM 更新视图 | 响应式数据驱动，自动更新视图 |
| **状态管理** | 无内置方案，靠全局变量或 data 属性 | Vuex / Pinia / Redux / Zustand 等成熟方案 |
| **组件化** | 不支持原生组件，需手写插件封装 | 原生支持组件化、单文件组件、JSX |
| **虚拟 DOM** | 无 | 有（高效 diff 算法，最小化 DOM 操作） |
| **学习曲线** | 极低，会 CSS 选择器就能上手 | 中等，需要理解组件生命周期、状态管理等概念 |
| **包体积** | ~30KB (gzip) | Vue ~33KB / React ~42KB (gzip) |
| **TypeScript** | 有类型定义但推导不精确 | 原生支持，类型推导精确 |
| **SSR / SSG** | 不支持 | Nuxt / Next.js 完善支持 |
| **适用场景** | 老项目维护、营销页、CMS 模板 | SPA、复杂交互、大型团队协作项目 |

### 8.2 jQuery 仍然最合适的技术选型

1. **维护遗留系统**：大量 jQuery 代码的 PHP/Java 企业应用，全面重写的成本和风险都太高，不如在现有基础上逐步优化。很多银行、政府、制造业的内部管理系统至今仍运行在 jQuery + Bootstrap 3 的技术栈上，这些系统往往有数十万行前端代码，贸然重写不仅耗时耗力，还可能引入大量回归缺陷。
2. **营销落地页和活动页**：一次性页面，交互逻辑简单（轮播、倒计时表单提交），不需要组件化框架那套重兵器。营销团队经常需要快速迭代，jQuery 加一个设计师加一个后端就能搞定，引入 Vue 反而增加了部署和构建的复杂度。
3. **WordPress / Drupal 主题和插件**：CMS 生态深度绑定 jQuery，`wp_enqueue_script` 默认就带 jQuery，离开它反而麻烦。WordPress 的 Gutenberg 编辑器虽然在逐步引入 React，但大量第三方主题和插件仍然依赖 jQuery 来实现交互效果。
4. **Bootstrap 3/4 项目**：Bootstrap 5 才彻底移除了 jQuery 依赖，之前的版本全部依赖 jQuery。如果你的项目还在用 Bootstrap 4，引入 jQuery 是不可避免的。
5. **快速原型验证**：几行代码就能搞定轮播、Tab 切换、表单验证，验证完再决定是否用框架重写。产品经理说"我先看看效果"的时候，jQuery 往往是最快的工具。
6. **受限环境**：Electron 内嵌 WebView、微信公众号 H5、政府金融系统的低版本浏览器环境、以及某些对包体积有严格限制的嵌入式设备界面。这些场景下引入一个完整的前端框架显得过于笨重。
7. **邮件模板和富文本编辑**：很多邮件营销平台的模板引擎和富文本编辑器（如 CKEditor 4、TinyMCE 4）底层仍然依赖 jQuery，在这些环境中无法避免。

### 8.3 什么时候该果断迁移到现代框架

- 项目页面超过 10 个，存在复杂的状态流转和组件复用需求，jQuery 的命令式 DOM 操作会让代码越来越难维护
- 多人协作开发，需要清晰的模块边界、组件规范和代码审查标准
- 需要服务端渲染（SSR）或静态生成（SSG）来优化 SEO 排名，jQuery 天然不支持这些能力
- jQuery 插件频繁出 bug 且原作者已停止维护，找不到替代品
- 项目需要支持移动端且对首屏加载时间和运行时性能有严格要求
- 团队希望全面引入 TypeScript 来提升代码质量和开发体验
- 项目需要支持国际化（i18n）、主题切换等高级功能，用框架的响应式系统实现起来更加自然

---

## 九、jQuery 插件开发基础

### 9.1 标准插件模板

开发一个规范的 jQuery 插件，需要遵循以下模式：

```js
(function ($) {
  'use strict';

  // 插件主函数
  $.fn.tooltip = function (options) {
    // 合并默认配置和用户配置
    var settings = $.extend({
      position: 'top',       // 提示位置：top / bottom / left / right
      delay: 200,            // 显示延迟（毫秒）
      maxWidth: 250,         // 最大宽度
      content: ''            // 提示内容（为空时读 data-tooltip）
    }, options);

    // return this 保证链式调用
    return this.each(function () {
      var $el = $(this);
      var content = settings.content || $el.data('tooltip') || '';

      if (!content) return;  // 没有内容就不绑定

      // 存储实例数据，方便后续操作
      $el.data('tooltipInstance', {
        settings: settings,
        element: $el
      });

      $el.on('mouseenter.tooltip', function () {
        var $tip = $('<div class="custom-tooltip">' + content + '</div>');
        $tip.css({ maxWidth: settings.maxWidth });
        $('body').append($tip);

        // 计算位置
        var pos = $el.offset();
        var tipH = $tip.outerHeight();
        var tipW = $tip.outerWidth();
        var elW = $el.outerWidth();

        var css = {};
        if (settings.position === 'top') {
          css.top = pos.top - tipH - 8;
          css.left = pos.left + (elW - tipW) / 2;
        } else if (settings.position === 'bottom') {
          css.top = pos.top + $el.outerHeight() + 8;
          css.left = pos.left + (elW - tipW) / 2;
        }
        $tip.css(css).fadeIn(settings.delay);
      });

      $el.on('mouseleave.tooltip', function () {
        $('.custom-tooltip').fadeOut(settings.delay, function () {
          $(this).remove();
        });
      });
    });
  };

  // 提供销毁方法
  $.fn.tooltip.destroy = function () {
    return this.each(function () {
      $(this).off('.tooltip').removeData('tooltipInstance');
    });
  };

})(jQuery);  // 将 jQuery 作为参数传入闭包

// 使用
$('[data-tooltip]').tooltip({ position: 'top', delay: 100 });

// 销毁
$('[data-tooltip]').tooltip.destroy();
```

### 9.2 插件开发规范清单

1. **用闭包包裹**：`(function($){ ... })(jQuery)` 防止 `$` 与其他库冲突，这是最基本的防护措施
2. **`return this.each()`**：保证链式调用和批量操作，用户可以 `$('.items').myPlugin().addClass('done')` 这样连续调用
3. **`$.extend()` 合并配置**：让用户可以覆盖默认值，提供合理的默认行为同时保留灵活性
4. **不污染全局命名空间**：不要往 `window` 上挂东西，保持插件的封装性
5. **提供销毁/禁用方法**：方便页面切换时清理资源，避免内存泄漏，这在单页应用中尤为重要
6. **使用命名空间事件**：`事件名.pluginName`，方便精确解绑而不影响其他模块的事件监听
7. **存储实例引用**：用 `$el.data('pluginInstance', {...})` 方便外部代码访问插件实例、调用插件方法
8. **写文档和示例**：README 中详细说明配置项和 API，附上在线演示链接，这是开源插件获得社区认可的关键
9. **提供回调钩子**：在关键生命周期节点（初始化完成、销毁前等）触发自定义事件或执行用户配置的回调函数
10. **兼容 AMD 和 CommonJS**：使用 UMD（Universal Module Definition）模式，让插件既能在浏览器全局引入，也能通过 require 和 import 使用

---

## 十、迁移指南：从 jQuery 到原生 JavaScript

如果你决定从 jQuery 迁移到原生 JS（或者配合 Vue/React 重构），以下是最常见的迁移模式。迁移的核心原则是：**渐进式替换，而非一步到位**。先从最简单的工具函数和选择器开始，再逐步替换事件绑定和 AJAX，最后处理复杂的链式操作和动画。建议配合 ESLint 规则禁止新增 jQuery 代码，同时保留已有的 jQuery 代码直到逐一替换完成。

### 10.1 DOM 操作迁移

DOM 操作是 jQuery 使用频率最高的功能。好消息是，现代浏览器的原生 API 已经非常完善，几乎每个 jQuery 方法都有对应的原生替代方案：

```js
// ===== jQuery =====
$('#app').html('<p>加载中...</p>');
$('.items').each(function (i) {
  $(this).attr('data-index', i).addClass('indexed');
});
$('#box').css({ width: '200px', height: '100px', background: '#f0f0f0' });

// ===== 原生 JS =====
document.getElementById('app').innerHTML = '<p>加载中...</p>';
document.querySelectorAll('.items').forEach(function (el, i) {
  el.setAttribute('data-index', i);
  el.classList.add('indexed');
});
Object.assign(document.getElementById('box').style, {
  width: '200px', height: '100px', background: '#f0f0f0'
});
```

### 10.2 事件绑定迁移

事件绑定的迁移需要注意一个关键点：原生 `removeEventListener` 必须传入与 `addEventListener` 相同的函数引用，因此不能使用匿名函数。建议将事件处理函数提取为具名函数：

```js
// ===== jQuery（含事件委托） =====
$('#btn').on('click', function () { handleClick(); });
$('#list').on('click', 'li.item', function () {
  console.log($(this).data('id'));
});

// ===== 原生 JS =====
document.getElementById('btn').addEventListener('click', handleClick);

// 原生事件委托
document.getElementById('list').addEventListener('click', function (e) {
  var target = e.target.closest('li.item');
  if (target && this.contains(target)) {
    console.log(target.dataset.id);
  }
});
```

### 10.3 AJAX 迁移

从 `$.ajax` 迁移到原生 `fetch` 是最常见的迁移场景之一。需要注意 `fetch` 的一个重要特性：**它不会因为 HTTP 状态码为 4xx 或 5xx 而 reject**，你必须手动检查 `res.ok` 属性。这与 jQuery 的 `$.ajax` 行为不同——jQuery 会在 HTTP 错误时触发 `error` 回调。此外，`fetch` 的 `POST` 请求默认的 `Content-Type` 也不是 jQuery 的 `application/x-www-form-urlencoded`，需要手动设置：

```js
// ===== jQuery =====
$.ajax({
  url: '/api/data',
  method: 'POST',
  data: JSON.stringify({ key: 'value' }),
  contentType: 'application/json',
  success: function (res) { console.log(res); },
  error: function (xhr) { console.error(xhr.statusText); }
});

// ===== 原生 fetch =====
fetch('/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'value' })
})
  .then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(function (data) { console.log(data); })
  .catch(function (err) { console.error(err.message); });

// ===== 现代 async/await（推荐） =====
async function postData() {
  try {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    console.log(data);
  } catch (err) {
    console.error(err.message);
  }
}
```

### 10.4 动画迁移

```js
// ===== jQuery =====
$('#box').fadeIn(300);

// ===== 原生 Web Animations API =====
document.getElementById('box').animate(
  [{ opacity: 0 }, { opacity: 1 }],
  { duration: 300, fill: 'forwards' }
);

// ===== CSS transition 方案（适合简单场景） =====
// CSS: .fade-in { transition: opacity 0.3s ease; }
var el = document.getElementById('box');
el.classList.add('fade-in');
el.style.opacity = '1';
```

### 10.5 工具函数迁移

| jQuery | 原生 JS 替代 | 说明 |
|--------|-------------|------|
| `$.trim(str)` | `str.trim()` | ES5 原生方法 |
| `$.inArray(val, arr)` | `arr.indexOf(val)` 或 `arr.includes(val)` | |
| `$.isArray(arr)` | `Array.isArray(arr)` | 最可靠的方式 |
| `$.isFunction(fn)` | `typeof fn === 'function'` | |
| `$.isNumeric(val)` | `!isNaN(parseFloat(val)) && isFinite(val)` | |
| `$.isEmptyObject(obj)` | `Object.keys(obj).length === 0` | |
| `$.extend({}, a, b)` | `{...a, ...b}` 或 `Object.assign({}, a, b)` | |
| `$.each(arr, fn)` | `arr.forEach(fn)` | |
| `$.map(arr, fn)` | `arr.map(fn)` | |
| `$.grep(arr, fn)` | `arr.filter(fn)` | |
| `$.proxy(fn, ctx)` | `fn.bind(ctx)` | |

---

## 十一、踩坑笔记

以下是开发中最常遇到的 jQuery 坑，建议仔细阅读：

| 坑 | 现象 | 解决方案 |
|----|------|----------|
| **`$` 变量冲突** | 和 Prototype.js、其他库的 `$` 冲突 | `jQuery.noConflict()` 让出 `$`，用 `jQuery` 或自定义变量 |
| **Ready 时机错误** | 操作未渲染的 DOM，获取不到元素 | 包在 `$(function(){...})` 或 `DOMContentLoaded` 回调里 |
| **事件未解绑导致内存泄漏** | SPA 切页后事件仍在执行，内存持续增长 | 用命名空间 `'.module'` + `.off('.module')` 批量解绑 |
| **动态元素没有绑定事件** | 通过 AJAX 加载的 DOM 点击无反应 | 必须用事件委托 `.on('click', '.selector', fn)` |
| **异步回调中 `this` 丢失** | `success` 回调里 `this` 不再是触发元素 | 用 `var self = this` 缓存，或用箭头函数 |
| **版本升级 API 被移除** | jQuery 3 删除了 `.bind()/.live()/.size()` | 升级前务必看 [Migrate Plugin](https://github.com/jquery/jquery-migrate) |
| **Deferred `.then()` 行为变化** | jQuery 2 的 `.then()` 不符合 Promise/A+ | jQuery 3 修复了，但错误冒泡行为有变化 |
| **空选择器不报错** | `$('#')` 或 `$('.不存在')` 返回空集合，不抛异常 | 开发时用 `.length` 验证选择器是否命中元素 |
| **`.val()` 返回字符串** | `$('#input').val()` 返回 `"0"` 而非数字 `0` | 用 `parseInt($('#input').val(), 10)` 或 `Number()` 转换 |
| **`.html()` XSS 风险** | 用户输入直接用 `.html()` 插入 DOM | 用 `.text()` 插入纯文本，或先做 HTML 转义 |
| **动画队列堆积** | 快速反复触发 `.slideUp()/.slideDown()` 导致动画排队 | 用 `.stop(true)` 清除队列，或 `.finish()` 跳到终态 |

---

## 十二、版本选择指南

| 版本系列 | 状态 | 浏览器支持 | 适用场景 |
|----------|------|------------|----------|
| jQuery 1.x | ❌ 已停止维护 | IE6+ | 仅用于维护极度老旧的遗留系统 |
| jQuery 2.x | ❌ 已停止维护 | IE9+ | 与 1.x 同期，选择性不多 |
| **jQuery 3.x** | ✅ 当前维护版本 | IE9+ | 所有现代项目的首选 |
| jQuery 3.7.1 | ✅ 当前最新稳定版 | 同上 | 生产环境推荐使用 |
| **jQuery 4.x** | 🔧 开发中 | IE 完全不支持 | 移除旧包袱，体积更小，原生 Promise |

**生产环境建议**：

- 使用 jQuery 3.7.1（截至目前的最新稳定版）
- 如果从 1.x/2.x 升级，先引入 [jQuery Migrate 插件](https://github.com/jquery/jquery-migrate) 检测废弃 API
- 逐步替换废弃 API，最后移除 Migrate 插件
- 通过 CDN 引入时加上 SRI（Subresource Integrity）校验

---

## 十三、jQuery 模块化使用（配合现代构建工具）

虽然 jQuery 本身是全局库，但可以通过 npm 配合 Webpack / Vite 进行模块化管理：

```bash
npm install jquery
```

```js
// 在 JS 模块中引入
import $ from 'jquery';

// 或通过 Webpack ProvidePlugin 自动注入（不推荐新项目使用）
// new webpack.ProvidePlugin({ $: 'jquery', jQuery: 'jquery' })
```

**注意**：如果项目同时引入了依赖全局 jQuery 的第三方库（如 Bootstrap 4 JS、Select2、Slick Carousel），你需要在入口文件顶部暴露全局变量：

```js
import $ from 'jquery';
window.jQuery = $;  // 某些插件通过 window.jQuery 访问
window.$ = $;       // 某些插件通过 window.$ 访问

// 然后再引入依赖 jQuery 的插件
import 'bootstrap';    // Bootstrap 4 的 JS 部分
import 'select2';      // Select2 下拉框插件
```

如果使用 Vite，建议在 `vite.config.js` 中配置：

```js
// vite.config.js
export default {
  resolve: {
    alias: {
      jquery: 'jquery/dist/jquery.min.js'
    }
  }
};
```

---

## 相关阅读

- [JavaScript 核心概念与 ES6+ 特性详解](/categories/Frontend/javascript/)
- [Vue 响应式原理与组件化开发](/categories/Frontend/vue/)
- [TypeScript 静态类型系统与工程实践](/categories/Frontend/typescript/)
- [HTMX 实战：不用 JS 框架也能做交互](/categories/Frontend/2026-06-02-HTMX-实战-不用JavaScript框架也能做交互-Laravel-HTMX超轻量前后端方案/)
- [Vue 3 Composition API 最佳实践](/categories/Frontend/vue-3-composition-api-guide-ref-reactive-computed-best-practices/)

---

## 参考资料

- jQuery 官网：<https://jquery.com>
- jQuery API 中文文档：<https://www.jquery123.com>
- jQuery 3.0 升级指南：<https://jquery.com/upgrade-guide/3.0/>
- jQuery Migrate 插件：<https://github.com/jquery/jquery-migrate>
- You Might Not Need jQuery：<https://youmightnotneedjquery.com>
