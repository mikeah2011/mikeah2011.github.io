---
title: 微前端沙箱隔离实战：JS Sandbox + CSS Scope + 路由隔离——qiankun/Module Federation/Wujie 的工程化对比与选型决策
date: 2026-06-10 03:00:00
categories:
  - frontend
keywords: [JS Sandbox, CSS Scope, qiankun, Module Federation, Wujie, 微前端沙箱隔离实战, 路由隔离, 的工程化对比与选型决策, 前端]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
  - 微前端
  - qiankun
  - Module Federation
  - Wujie
  - 沙箱隔离
  - CSS 隔离
  - 路由隔离
description: 深度对比 qiankun、Module Federation 和 Wujie 三大微前端框架在 JS 沙箱、CSS 隔离、路由隔离三个核心隔离维度上的实现原理与工程实践，附完整代码示例与选型决策矩阵。
---

## 概述

微前端架构的核心难题不在「拆分」，而在「隔离」。主应用与子应用共存于同一页面，如果隔离不到位，一个子应用的全局变量污染、样式冲突或路由劫持就会拖垮整个系统。

本文聚焦三个核心隔离维度——**JS 沙箱**、**CSS 作用域**、**路由隔离**——逐层拆解 qiankun、Module Federation（Webpack 5+）和 Wujie 的实现原理，并给出工程化选型决策。

<!-- more -->

## 核心概念：隔离的三层模型

```
┌─────────────────────────────────────────────┐
│              路由隔离层                       │
│   子应用路由 ≠ 主应用路由，互不干扰           │
├─────────────────────────────────────────────┤
│              CSS 隔离层                      │
│   Scoped / Shadow DOM / 动态样式前缀        │
├─────────────────────────────────────────────┤
│              JS 沙箱层                       │
│   Window Proxy / 快照沙箱 / VM 隔离          │
└─────────────────────────────────────────────┘
```

三层缺一不可：JS 沙箱防止全局变量污染，CSS 隔离防止样式串扰，路由隔离确保子应用的 URL 不会互相覆盖。

---

## JS 沙箱实现对比

### qiankun：Proxy 沙箱 + 快照沙箱

qiankun 在激活子应用时，通过 `Proxy` 劫持 `window` 对象，拦截所有 `get/set` 操作：

```javascript
// qiankun 沙箱核心原理简化
class ProxySandbox {
  constructor() {
    this.sandbox = {}; // 子应用独立的 window 副本
    this.active = true;
    this.proxy = new Proxy(window, {
      get(target, key) {
        // 优先从子应用沙箱读取
        if (key in sandbox) return sandbox[key];
        // 特殊属性直接返回
        if (['location', 'document', 'history'].includes(key)) {
          return Reflect.get(target, key);
        }
        return Reflect.get(target, key);
      },
      set(target, key, value) {
        if (!active) return true;
        sandbox[key] = value; // 写入子应用沙箱
        return true;
      },
      has(target, key) {
        return key in sandbox || key in target;
      }
    });
  }
}
```

**快照沙箱**：在不支持 Proxy 的场景下（如 IE），qiankun 在子应用激活前「快照」window 上的所有属性，激活期间监听变更，失活时回滚。缺点是同一时刻只能有一个子应用激活（单实例模式）。

### Module Federation：运行时共享，无内置沙箱

Webpack 5 的 Module Federation 本质上**不提供 JS 沙箱**。它的设计哲学是「共享而非隔离」：

```javascript
// webpack.config.js - Module Federation 配置
new ModuleFederationPlugin({
  name: 'host',
  remotes: {
    app1: 'app1@http://localhost:3001/remoteEntry.js',
  },
  shared: {
    react: { singleton: true, requiredVersion: '^18.0.0' },
    'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
  },
})
```

子应用的代码直接运行在主应用的 `window` 上下文中。`shared` 机制确保依赖库只加载一份，但也意味着全局变量天然共享。

**实际风险**：如果子应用 A 挂了 `window.__APP_DATA__`，子应用 B 会直接读到。Module Federation 依赖开发者自觉避免全局污染。

### Wujie：iframe + WebComponent 双重隔离

Wujie 采用了一个巧妙的方案——**在 iframe 中执行 JS，在主应用中渲染 DOM**：

```javascript
// Wujie 的核心隔离原理
// 1. 创建 iframe 作为 JS 执行沙箱
const iframe = document.createElement('iframe');
iframe.src =子应用入口地址;
document.body.appendChild(iframe);

// 2. 通过 WebComponent 渲染子应用 DOM 到主页面
const wujie = document.createElement('wujie-app');
wujie.shadowRoot.innerHTML = 子应用HTML;

// 3. 代理 iframe 的 Window 到主页面
// iframe 内的 window 操作实际上在 iframe 中执行
// 但 DOM 操作被代理到主页面的 WebComponent shadowRoot 中
```

iframe 的天然沙箱隔离确保了 JS 完全互不干扰。但 iframe 的问题在于 URL 不同步、弹窗行为异常——Wujie 通过 `proxyLocation` 和样式注入解决了大部分问题。

### 沙箱对比总结

| 维度 | qiankun | Module Federation | Wujie |
|------|---------|-------------------|-------|
| 沙箱机制 | Proxy/快照沙箱 | 无（共享 window） | iframe + WebComponent |
| 全局变量隔离 | ✅ 强隔离 | ❌ 无隔离 | ✅ iframe 天然隔离 |
| 运行时性能 | 中（Proxy 开销） | 高（无额外开销） | 低（iframe 通信开销） |
| 多实例支持 | Proxy 沙箱支持 | 支持 | 支持 |

---

## CSS 隔离实现对比

### qiankun：动态样式前缀

qiankun 在子应用加载时，对 `<style>` 和 `<link>` 标签注入 `prefix` 属性，通过 CSS 选择器前缀实现作用域隔离：

```javascript
// qiankun 子应用配置
registerMicroApps([{
  name: 'sub-app',
  entry: '//localhost:3001',
  container: '#sub-container',
  activeRule: '/sub',
  sandbox: {
    experimentalStyleIsolation: true, // 启用样式隔离
    strictStyleIsolation: false,       // 不使用 Shadow DOM
  }
}]);
```

开启 `experimentalStyleIsolation` 后，qiankun 会将子应用的所有样式包裹在 `div[data-qiankun="sub-app"]` 选择器下：

```css
/* 原始样式 */
.app-button { color: red; }

/* qiankun 注入后 */
div[data-qiankun="sub-app"] .app-button { color: red; }
```

**局限**：这种方式无法阻止子应用通过 `document.body` 直接注入全局样式，也无法防止 `@import` 的外部样式表逃逸。

### Module Federation：无内置 CSS 隔离

与 JS 沙箱类似，Module Federation 不提供 CSS 隔离。开发者需要自行处理，常见方案：

```javascript
// 方案1：CSS Modules（推荐）
// Button.module.css
.button { color: red; }

// Button.jsx
import styles from './Button.module.css';
<button className={styles.button}>Click</button>

// 方案2：CSS-in-JS（styled-components / emotion）
import styled from 'styled-components';
const Button = styled.button`
  color: ${props => props.color || 'red'};
`;

// 方案3：手动添加命名空间前缀
// postcss.config.js
module.exports = {
  plugins: {
    'postcss-prefix-selector': {
      prefix: '.sub-app-namespace'
    }
  }
};
```

### Wujie：Shadow DOM 强隔离

Wujie 默认使用 Shadow DOM 渲染子应用 DOM，提供浏览器原生的 CSS 隔离：

```javascript
// Wujie 自动启用 Shadow DOM
// 子应用的 DOM 被封装在 shadowRoot 中
// 外部样式无法穿透，内部样式也无法泄漏

const wujie = new Wujie({
  name: 'sub-app',
  url: 'http://localhost:3001',
  // shadowRootOptions 默认开启
});

// Wujie 还支持通过 inject 实现样式共享
const wujie = new Wujie({
  name: 'sub-app',
  url: 'http://localhost:3001',
  inject: {
    // 主应用样式注入到子应用的 Shadow DOM
    css: ['.main-theme { --primary: #1890ff; }'],
  }
});
```

### CSS 隔离对比总结

| 维度 | qiankun | Module Federation | Wujie |
|------|---------|-------------------|-------|
| 隔离方式 | 选择器前缀 | 需自行实现 | Shadow DOM |
| 隔离强度 | 中（可绕过） | 取决于方案 | 强（浏览器原生） |
| 样式共享 | 需手动穿透 | 自由组合 | inject 注入 |
| IE 兼容 | ✅ | ✅ | ⚠️ Shadow DOM 不支持 |

---

## 路由隔离实现对比

### qiankun：路由劫持 + 激活规则

qiankun 劫持浏览器的 `pushState` 和 `replaceState`，通过 URL 前缀匹配激活子应用：

```javascript
// 路由配置
registerMicroApps([
  {
    name: 'crm-app',
    entry: '//localhost:3001',
    container: '#sub-container',
    activeRule: '/crm',  // URL 以 /crm 开头时激活
  },
  {
    name: 'admin-app',
    entry: '//localhost:3002',
    container: '#sub-container',
    activeRule: '/admin',
  },
]);

// qiankun 内部路由劫持原理（简化）
const originalPush = history.pushState;
history.pushState = function(...args) {
  originalPush.apply(this, args);
  // 触发路由变化检查
  reroute(); // 重新匹配子应用激活规则
};

// 子应用内部路由映射
// 以 /crm 开头的 URL → 子应用看到的是去掉前缀的路径
// 主应用 /crm/users/123 → 子应用看到 /users/123
```

**基座路由模式**：子应用可以配置为 `base` 路由或 `hash` 路由，qiankun 自动适配：

```javascript
// 子应用 A 使用 base 路由
// 主 URL: /app-a/users → 子应用看到: /users

// 子应用 B 使用 hash 路由
// 主 URL: /app-b/#/users → 子应用看到: /#/users
```

### Module Federation：路由完全由应用自行管理

Module Federation 不干预路由。常见实践是主应用使用框架路由（React Router / Vue Router），子应用的路由注册在主应用路由下：

```javascript
// 主应用路由配置（React Router 示例）
import { lazy } from 'react';

const RemoteApp = lazy(() => import('app1/App'));

function AppRoutes() {
  return (
    <Routes>
      <Route path="/app1/*" element={
        <Suspense fallback={<Loading />}>
          <RemoteApp />
        </Suspense>
      } />
      <Route path="/app2/*" element={
        <Suspense fallback={<Loading />}>
          <RemoteApp2 />
        </Suspense>
      } />
    </Routes>
  );
}
```

路由隔离的成败取决于主应用和子应用的路由约定是否一致。没有框架级别的强制，容易出现路由冲突。

### Wujie：基于 URL 的自动路由映射

Wujie 的路由隔离与 qiankun 类似，但实现更加透明：

```javascript
// Wujie 路由隔离原理
const wujie = new Wujie({
  name: 'sub-app',
  url: 'http://localhost:3001',
  routePrefix: '/sub', // 子应用路由前缀
});

// 主应用访问 /sub/users/123
// iframe 内部看到的是 /users/123
// proxyLocation 确保 URL 操作正确映射回主应用
```

Wujie 的 iframe 方案天然支持 URL 同步——iframe 的 `location` 变化会自动同步到主页面的 URL bar，无需手动劫持。

### 路由隔离对比总结

| 维度 | qiankun | Module Federation | Wujie |
|------|---------|-------------------|-------|
| 路由劫持 | ✅ pushState/replaceState | ❌ 需自行处理 | ✅ iframe 天然支持 |
| 激活规则 | activeRule 前缀匹配 | 路由约定 | routePrefix |
| URL 同步 | 手动处理 | 手动处理 | 自动同步 |
| Hash 路由 | 支持 | 取决于框架 | 支持 |

---

## 实战：Laravel 项目接入微前端

KKday 的典型场景是主应用（Vue 3 + Vite）管理全局布局和导航，子应用（PHP 渲染的页面 + Vue/React 局部组件）嵌入主应用。

### qiankun 接入示例

```php
<!-- 主应用 Blade 模板 - resources/views/micro-frontend.blade.php -->
<div id="sub-container"></div>

<script>
// 主应用 JS
import { registerMicroApps, start } from 'qiankun';

registerMicroApps([
  {
    name: 'product-cms',
    entry: '{{ config("services.micro_frontend.product_cms.url") }}',
    container: '#sub-container',
    activeRule: '/cms/products',
    props: {
      token: '{{ $user->api_token }}',
      baseUrl: '{{ config("app.url") }}',
    }
  }
], {
  beforeLoad: (app) => console.log(`Loading ${app.name}`),
  afterMount: (app) => console.log(`${app.name} mounted`),
});

start({
  sandbox: {
    experimentalStyleIsolation: true,
  },
  prefetch: 'all', // 预加载所有子应用
});
</script>
```

```javascript
// 子应用（product-cms）生命周期
// src/public-path.js
if (window.__POWERED_BY_QIANKUN__) {
  __webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__;
}

// src/main.js
let app = null;

export async function bootstrap() {
  console.log('product-cms bootstrapped');
}

export async function mount(props) {
  const { container, token, baseUrl } = props;
  app = createApp(App);
  app.config.globalProperties.$token = token;
  app.config.globalProperties.$baseUrl = baseUrl;
  app.mount(container ? container.querySelector('#app') : '#app');
}

export async function unmount() {
  app.unmount();
  app = null;
}
```

### Wujie 接入示例

```javascript
// 主应用 - Wujie 子应用注册
import WujieVue from 'wujie-vue';

const { setupApp, bus } = WujieVue;

// 全局生命周期钩子
setupApp({
  beforeLoad: (app) => console.log(`Loading ${app.name}`),
  beforeMount: (app) => console.log(`Mounting ${app.name}`),
  afterMount: (app) => {
    // 注入全局 CSS 变量
    const el = app.el.querySelector('wujie-app');
    el.shadowRoot.style = `
      :host { --main-primary: #1890ff; --main-bg: #f0f2f5; }
    `;
  },
});

// 跨子应用通信
bus.$on('cart-updated', (data) => {
  console.log('Cart updated:', data);
});
```

```vue
<!-- 主应用 Vue 组件 -->
<template>
  <wujie-vue
    name="product-cms"
    url="http://localhost:3001"
    :props="{ token, baseUrl }"
    :alive="true"
    :loading="LoadingSkeleton"
  />
</template>

<script setup>
import { ref } from 'vue';
import LoadingSkeleton from './components/LoadingSkeleton.vue';

const token = ref('{{ $user->api_token }}');
const baseUrl = ref('{{ config("app.url") }}');
</script>
```

### Module Federation 接入示例

```javascript
// 主应用 webpack/vite 配置
// vite.config.js（使用 vite-plugin-federation）
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    federation({
      name: 'host',
      remotes: {
        productCms: 'http://localhost:3001/assets/remoteEntry.js',
      },
      shared: ['vue', 'pinia', 'vue-router'],
    }),
  ],
});
```

```javascript
// 子应用 vite.config.js
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    federation({
      name: 'productCms',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App.vue',
        './store': './src/store/index.js',
      },
      shared: ['vue', 'pinia', 'vue-router'],
    }),
  ],
});
```

---

## 踩坑记录

### 1. qiankun 子应用的 CSS 污染了全局

**场景**：子应用引入了一个第三方组件库（如 Element Plus），其样式没有被 qiankun 的前缀包裹。

**原因**：组件库通过 `<link>` 标签加载外部 CSS，qiankun 的 `experimentalStyleIsolation` 只对内联 `<style>` 生效，对 `<link>` 加载的样式无能为力。

**解决方案**：

```javascript
// 方案 A：使用 Shadow DOM 强隔离
sandbox: {
  strictStyleIsolation: true, // 注意：需要浏览器支持 Shadow DOM
}

// 方案 B：在子应用中手动添加前缀
// postcss.config.js
module.exports = {
  plugins: {
    'postcss-prefix-selector': {
      prefix: `[data-qiankun="product-cms"]`,
      includeFiles: [/element-plus.*\.css$/],
    }
  }
}
```

### 2. Module Federation 共享依赖版本冲突

**场景**：主应用使用 React 18.2，子应用使用 React 18.3，`shared` 配置导致运行时错误。

```javascript
// 错误配置：requiredVersion 范围太宽
shared: {
  react: { singleton: true, requiredVersion: '^18.0.0' },
}

// 正确配置：精确版本 + 警告
shared: {
  react: {
    singleton: true,
    requiredVersion: '>=18.2.0 <18.4.0', // 精确范围
    eager: false, // 不要 eager，避免加载时机问题
  }
}
```

### 3. Wujie iframe 中的弹窗被浏览器拦截

**场景**：子应用调用 `window.open()` 打开新窗口，被浏览器弹窗拦截器阻止。

**解决方案**：Wujie 提供了 `fetch` 和 `dialog` 的代理机制：

```javascript
const wujie = new Wujie({
  name: 'sub-app',
  url: 'http://localhost:3001',
  // 自定义 fetch 代理
  fetch: (url, options) => {
    // 在主应用上下文中执行 fetch
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${getToken()}`,
      }
    });
  },
  // 弹窗代理
  dialog: (url, config) => {
    // 用主应用的弹窗组件替代原生弹窗
    return showModal({ url, ...config });
  }
});
```

### 4. 路由切换时子应用状态丢失

**场景**：从子应用 A 切到子应用 B，再切回 A，A 的页面状态（表单数据、滚动位置）全部丢失。

```javascript
// qiankun 解决方案：keep-alive 模式
// 子应用始终挂载，只是切换 display
registerMicroApps([...], {
  // 使用 destroy: false 保留子应用实例
  props: {
    keepAlive: true,
  }
});

// 主应用容器样式
#sub-container > div {
  display: none; /* 默认隐藏 */
}
#sub-container > div.active {
  display: block; /* 激活时显示 */
}

// Wujie 解决方案：alive 属性
<wujie-vue
  name="product-cms"
  url="http://localhost:3001"
  :alive="true"  /* 保持子应用存活 */
/>
```

### 5. 子应用获取不到主应用的 Cookie

**场景**：子应用的 iframe 域名与主应用不同，导致 Cookie 不共享。

```javascript
// Wujie 解决方案：通过 props 传递认证信息
const wujie = new Wujie({
  name: 'sub-app',
  url: 'http://localhost:3001',
  props: {
    auth: {
      token: getAuthToken(),
      user: getCurrentUser(),
    }
  }
});

// 子应用中接收
const auth = window.__WUJIE?.props?.auth;
if (auth) {
  // 使用传入的 token 而不是依赖 Cookie
  axios.defaults.headers.common['Authorization'] = `Bearer ${auth.token}`;
}
```

---

## 选型决策矩阵

| 场景 | 推荐方案 | 理由 |
|------|----------|------|
| 多团队独立技术栈（React + Vue + Angular 混用） | **Wujie** | iframe 沙箱天然支持跨框架，CSS/JS 隔离最强 |
| 同技术栈、高性能要求 | **Module Federation** | 无沙箱开销，依赖共享，热更新快 |
| 中小项目快速接入、IE 兼容 | **qiankun** | 生态成熟，文档完善，Vue/React 插件即用 |
| 需要严格安全隔离（金融/支付） | **Wujie** | iframe 级别隔离，最接近原生多窗口安全模型 |
| 大型 monorepo 内部模块化 | **Module Federation** | 按需加载，编译时分析，开发体验最好 |

### 最终建议

- **优先考虑 Module Federation**：如果你的团队技术栈统一（都是 React 或都是 Vue），且对性能敏感。Module Federation 的「共享而非隔离」哲学在同技术栈场景下效率最高。

- **复杂场景选 Wujie**：当子应用来自不同团队、不同技术栈、需要强隔离时，Wujie 的 iframe + WebComponent 方案提供了最强的隔离保障。

- **qiankun 作为成熟备选**：生态最完善，遇到问题社区有大量解决方案。适合需要快速落地、不想踩太多坑的团队。

---

## 总结

微前端的隔离不是「有或无」的问题，而是「多强」的问题。JS 沙箱、CSS 隔离、路由隔离三层组合决定了子应用之间的边界强度。

- **qiankun**：Proxy 沙箱 + 选择器前缀 + 路由劫持，均衡但有上限
- **Module Federation**：无沙箱、无 CSS 隔离、共享路由，性能最优但隔离最弱
- **Wujie**：iframe 沙箱 + Shadow DOM + 自动路由映射，隔离最强但性能开销最大

选型的核心不是「哪个最好」，而是「你的场景需要多强的隔离」。隔离越强，性能和开发体验的妥协越大；隔离越弱，出问题的风险越高。找到适合你团队的那个平衡点，才是正确的工程决策。
