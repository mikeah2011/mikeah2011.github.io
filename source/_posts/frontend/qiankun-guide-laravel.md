---

title: qiankun 微前端实战：Laravel 后台拆分中的路由、鉴权与样式隔离踩坑记录
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-03 09:21:00
categories:
  - frontend
  - php
keywords: [qiankun, Laravel, 微前端实战, 后台拆分中的路由, 鉴权与样式隔离踩坑记录]
tags:
- Laravel
- Vite
- Vue
- 前端
- 微前端
- qiankun
description: 基于 Laravel 后端实战，详解 qiankun 微前端拆分方案完整落地指南。覆盖 Vue 3 子应用接入、Vite 构建配置、主子应用注册与生命周期钩子、三种通信方式（props/CustomEvent/GlobalState）、路由鉴权统一、Token 同步广播、CSS 样式隔离分层治理（命名空间/Shadow DOM/experimentalStyleIsolation）、Nginx 部署配置、微前端方案对比（qiankun vs Module Federation vs single-spa vs wujie）与生产部署 Checklist，适合中后台团队落地微前端架构参考。
---


后台系统长到一定规模后，最先失控的通常不是接口，而是前端工程本身：订单、商品、营销、财务全塞在一个 Vue 管理台里，任何一个模块发版都得整站回归，构建时间越来越长，权限菜单也越来越难维护。我在一个 Laravel 单仓库后台里做过一次拆分，目标不是“为了微前端而微前端”，而是解决三个很具体的问题：**多人并行开发互相踩分支、单体后台发版风险过高、营销页样式频繁污染订单页**。

这次最终选择的是 **Laravel 继续做 BFF + 鉴权入口，前端用 qiankun 拆成主应用和 3 个子应用**。它不是银弹，但对中后台很实用。

## 一、落地后的结构

```text
                           +----------------------+
User Browser  ---> Nginx ->| Laravel Admin Shell  |
                           | Blade + Auth + Menu  |
                           +----------+-----------+
                                      |
                             inject user/menu/config
                                      |
                         +------------v-------------+
                         |   qiankun Master App     |
                         | layout / router / store  |
                         +---+-----------+----------+
                             |           |
                 /orders/*   |           |   /goods/*  /campaigns/*
                             |           |
               +-------------v-+   +-----v---------+   +-----------v----+
               | orders app    |   | goods app     |   | campaigns app  |
               | Vue + Vite    |   | Vue + Vite    |   | Vue + Vite     |
               +---------------+   +---------------+   +----------------+
```

关键原则只有两条：

1. **登录态、菜单、权限收口在 Laravel 和主应用，不下放给子应用各自判断。**
2. **子应用只负责自己的页面与接口编排，不共享彼此运行时。**

## 二、主应用注册方式

主应用里我不会把子应用地址写死在代码里，而是让 Laravel 模板根据环境注入，这样灰度和回滚都简单很多。

```blade
<script>
    window.__ADMIN_CONFIG__ = {
        user: @json($user),
        token: @json($token),
        apps: {
            orders: '{{ config('admin.apps.orders') }}',
            goods: '{{ config('admin.apps.goods') }}',
            campaigns: '{{ config('admin.apps.campaigns') }}',
        }
    };
</script>
```

```ts
// master/src/micro/register.ts
import { registerMicroApps, start } from 'qiankun';

const config = (window as any).__ADMIN_CONFIG__;

registerMicroApps([
  {
    name: 'orders',
    entry: config.apps.orders,
    container: '#subapp-container',
    activeRule: '/admin/orders',
    props: {
      token: config.token,
      user: config.user,
      basePath: '/admin/orders',
    },
  },
  {
    name: 'goods',
    entry: config.apps.goods,
    container: '#subapp-container',
    activeRule: '/admin/goods',
    props: {
      token: config.token,
      user: config.user,
      basePath: '/admin/goods',
    },
  },
]);

start({
  sandbox: { strictStyleIsolation: false },
  prefetch: 'all',
});
```

这里故意把 `strictStyleIsolation` 先关掉，不是因为它不好，而是很多后台组件库在开启 Shadow DOM 后，弹窗、Teleport、日期选择器会先炸一轮。我的经验是：**先用命名空间和样式约束解决 80% 问题，再只对高风险子应用启用更强隔离。**

## 三、子应用接入细节

子应用一定要同时支持独立运行和被 qiankun 挂载，不然后期本地调试会非常痛苦。

```ts
// orders/src/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import { createRouter, createWebHistory } from 'vue-router';
import routes from './routes';

let app: ReturnType<typeof createApp> | null = null;
let router: ReturnType<typeof createRouter> | null = null;

function render(props: any = {}) {
  const base = props.basePath || '/';

  router = createRouter({
    history: createWebHistory(base),
    routes,
  });

  app = createApp(App);
  app.provide('token', props.token ?? localStorage.getItem('token'));
  app.use(router);
  app.mount(props.container ? props.container.querySelector('#orders-root') : '#orders-root');
}

export async function bootstrap() {}
export async function mount(props: any) { render(props); }
export async function unmount() {
  app?.unmount();
  app = null;
  router = null;
}

if (!(window as any).__POWERED_BY_QIANKUN__) {
  render();
}
```

Vite 侧还要补一个容易漏掉的配置，不然静态资源路径在二级路由下经常 404：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: '/admin/orders/',
  server: {
    port: 7101,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
});
```

## 四、Laravel 侧要补的基座能力

很多团队把注意力都放在前端拆分，结果真正拖后腿的是 Laravel 基座没准备好。主应用如果没有统一菜单、统一鉴权、统一 fallback，子应用再优雅也会在生产上失真。

我实际会在 Laravel 里保留一个后台入口路由，把 `/admin` 下的页面都交给主应用壳子，接口仍然走 `/api/admin/*`：

```php
// routes/web.php
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'verified'])
    ->prefix('admin')
    ->group(function () {
        Route::view('/{any?}', 'admin.index')
            ->where('any', '^(?!api).*$');
    });
```

Nginx 也要配合，不然子应用深链接刷新时还是会回 404：

```nginx
location /admin/ {
    try_files $uri $uri/ /index.php?$query_string;
}

location /mf/orders/ {
    alias /var/www/micro/orders/;
    try_files $uri $uri/ /mf/orders/index.html;
}
```

这两段配置看起来普通，但它们决定了“浏览器刷新是否可用”和“灰度版本是否能独立托管”。我后来把它们写进发布 checklist，避免每次新子应用上线都重新踩一次。

## 五、子应用生命周期钩子详解

qiankun 的生命周期不是摆设，里面藏了很多容易踩的细节。下面是完整版的生命周期钩子示例：

```ts
// orders/src/main.ts — 完整生命周期示例

import { createApp } from 'vue';
import App from './App.vue';
import { createRouter, createWebHistory } from 'vue-router';
import routes from './routes';

let app: ReturnType<typeof createApp> | null = null;
let router: ReturnType<typeof createRouter> | null = null;

// ========== 生命周期钩子 ==========

// 1. bootstrap — 仅在子应用第一次挂载时执行，适合初始化全局配置
export async function bootstrap(props: any) {
  console.log('[orders] bootstrap — 首次挂载，初始化全局配置');
  // 比如：注册全局组件、初始化 store 插件等
}

// 2. mount — 每次子应用被激活时执行，核心渲染逻辑
export async function mount(props: any) {
  console.log('[orders] mount — 子应用被激活', props);

  const base = props.basePath || '/admin/orders';
  const container = props.container;

  router = createRouter({
    history: createWebHistory(base),
    routes,
  });

  app = createApp(App);
  // 从主应用获取 token，不要自己去请求
  app.provide('token', props.token ?? localStorage.getItem('token'));
  app.provide('user', props.user);
  app.use(router);

  const mountEl = container
    ? container.querySelector('#orders-root')
    : document.getElementById('orders-root');
  app.mount(mountEl);

  // 挂载后可以注册主应用事件监听
  window.addEventListener('admin:token-refreshed', handleTokenRefresh);
}

// 3. unmount — 子应用被卸载时执行，必须做清理
export async function unmount() {
  console.log('[orders] unmount — 子应用被卸载，执行清理');

  // 清理事件监听，防止内存泄漏
  window.removeEventListener('admin:token-refreshed', handleTokenRefresh);

  // 清理 Vue 实例
  if (app) {
    app.unmount();
    app = null;
  }
  if (router) {
    router = null;
  }
}

// 4. update — 主应用更新 props 时触发（可选）
export async function update(props: any) {
  console.log('[orders] update — 主应用更新了 props', props);
  // 比如：主应用切换了语言、主题色等
}

// ========== 工具函数 ==========

function handleTokenRefresh(event: CustomEvent) {
  // 更新 axios 实例的 token
  const axiosInstance = (window as any).__axios__;
  if (axiosInstance) {
    axiosInstance.defaults.headers.Authorization = `Bearer ${event.detail.token}`;
  }
}

// ========== 独立运行入口 ==========

function render(props: any = {}) {
  const base = props.basePath || '/admin/orders';

  router = createRouter({
    history: createWebHistory(base),
    routes,
  });

  app = createApp(App);
  app.provide('token', props.token ?? localStorage.getItem('token'));
  app.use(router);
  app.mount(props.container ? props.container.querySelector('#orders-root') : '#orders-root');
}

// 独立运行时直接渲染，被 qiankun 挂载时由生命周期控制
if (!(window as any).__POWERED_BY_QIANKUN__) {
  render();
}
```

> **踩坑提醒**：`bootstrap` 只执行一次，不要在这里做需要每次激活都重置的操作。`unmount` 里必须清理所有外部副作用（事件监听、定时器、WebSocket 连接），否则子应用反复挂载卸载后，内存会持续增长。

## 六、主子应用通信方式对比

qiankun 提供了三种通信方式，实际项目中建议混合使用：

```ts
// ========== 方式一：props 传递（最简单）==========
// 主应用注册时通过 props 传入
registerMicroApps([
  {
    name: 'orders',
    entry: config.apps.orders,
    container: '#subapp-container',
    activeRule: '/admin/orders',
    props: {
      token: config.token,
      user: config.user,
      // 传入主应用的 API 实例，避免子应用重复创建
      request: createSharedRequest(config.token),
    },
  },
]);

// 子应用在 mount 中接收
export async function mount(props: any) {
  const { token, user, request } = props;
  // 直接使用主应用传入的 request 实例
}

// ========== 方式二：全局事件总线（推荐用于跨应用广播）==========
// 主应用发送
function broadcastLogout() {
  window.dispatchEvent(new CustomEvent('admin:logout'));
}

function broadcastTokenRefresh(newToken: string) {
  window.dispatchEvent(new CustomEvent('admin:token-refreshed', {
    detail: { token: newToken, expiresAt: Date.now() + 3600 * 1000 }
  }));
}

// 子应用监听
window.addEventListener('admin:logout', () => {
  // 清理本地状态，跳转到登录页
  localStorage.removeItem('token');
  window.location.href = '/login';
});

window.addEventListener('admin:token-refreshed', (e: CustomEvent) => {
  api.defaults.headers.Authorization = `Bearer ${e.detail.token}`;
});

// ========== 方式三：qiankun 的 onGlobalStateChange（官方推荐）==========
// 主应用设置全局状态
import { initGlobalState, onGlobalStateChange } from 'qiankun';

const initialState = {
  token: config.token,
  user: config.user,
  theme: 'light',
  locale: 'zh-CN',
};

const actions = initGlobalState(initialState);

// 监听变化
onGlobalStateChange((state, prev) => {
  console.log('[master] 全局状态变更:', state, prev);
  if (state.theme !== prev.theme) {
    document.documentElement.setAttribute('data-theme', state.theme);
  }
});

// 修改状态
actions.setGlobalState({ theme: 'dark' });

// 子应用在 mount 中接收
export async function mount(props: any) {
  if (props.onGlobalStateChange) {
    props.onGlobalStateChange((state: any) => {
      console.log('[orders] 收到全局状态变更:', state);
      // 应用主题、语言等
    }, true); // true 表示立即触发一次
  }

  if (props.setGlobalState) {
    // 子应用也可以修改全局状态（谨慎使用）
    props.setGlobalState({ locale: 'en-US' });
  }
}
```

> **通信方式选型建议**：
> - `props`：适合主→子的单向数据流，如 token、user、配置
> - `CustomEvent`：适合子→主或子→子的松耦合通信，如登出广播
> - `initGlobalState`：适合需要共享的状态，如主题、语言、权限

## 七、qiankun vs 主流微前端方案对比

| 特性 | qiankun | Module Federation 2.0 | single-spa | wujie (无界) |
|------|---------|----------------------|------------|-------------|
| **技术原理** | 基于 single-spa + sandbox | Webpack 5 原生模块共享 | 框架无关的路由劫持 | WebComponent + iframe |
| **JS 沙箱** | Proxy 沙箱（单例/多例） | 无沙箱，共享运行时 | 无内置沙箱 | iframe 天然隔离 |
| **CSS 隔离** | Shadow DOM / Scoped | 需自行处理 | 需自行处理 | Shadow DOM + iframe |
| **子应用接入成本** | 中（需导出生命周期） | 低（改构建配置） | 高（需适配 single-spa） | 低（几乎零改造） |
| **预加载** | ✅ 支持 | ✅ 支持 | 需自行实现 | ✅ 支持 |
| **共享依赖** | 不支持（props 传递） | ✅ 原生共享 | 需自行实现 | 不支持 |
| **子应用独立运行** | ✅ 需加判断 | ✅ 天然支持 | 需额外配置 | ✅ 天然支持 |
| **Vue/React 混用** | ✅ | ✅ | ✅ | ✅ |
| **Vite 支持** | 社区插件 vite-plugin-qiankun | ✅ 原生支持 | 需适配 | ✅ |
| **社区活跃度** | ⭐⭐⭐⭐（国内最活跃） | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **适合场景** | 中后台、渐进式迁移 | 新项目、跨团队模块共享 | 复杂路由场景 | 强隔离需求、跨域场景 |
| **不适合场景** | 跨域子应用、高频切换 | 旧项目改造 | 子应用数量多 | 性能敏感场景 |

**选型建议**：
- **已有 Laravel 中后台，渐进式拆分** → 选 qiankun，社区资料多，国内落地案例丰富
- **全新项目，多团队共建** → 考虑 Module Federation 2.0，依赖共享能力最强
- **子应用需要强隔离（跨域、第三方）** → 考虑 wujie，iframe 天然隔离
- **只有 2-3 个子应用，追求轻量** → 单个 single-spa 也够用

## 八、CSS 样式隔离深度治理

在 qiankun 中，CSS 隔离是被提及最多但解决最棘手的问题。以下是分层治理策略：

### 第一层：命名空间约束（推荐优先实施）

```scss
// 每个子应用的根组件添加唯一前缀
// orders/src/App.vue
<template>
  <div class="orders-app">
    <router-view />
  </div>
</template>

<style lang="scss" scoped>
// scoped 样式在 qiankun 中可能失效（因为渲染容器在主应用中）
// 所以必须加命名空间前缀
.orders-app {
  .order-table {
    // 正确：有命名空间前缀
  }
}

// 错误示范：全局选择器会污染其他子应用
// .el-table { ... }  ❌
// .page-container div { ... }  ❌
</style>
```

### 第二层：Stylelint 规则强制约束

```js
// .stylelintrc.js
module.exports = {
  rules: {
    // 禁止没有命名空间前缀的类选择器
    // 需配合自定义规则或约定
    'selector-class-pattern': /^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$/,
  },
};
```

### 第三层：Shadow DOM（高风险子应用可选开启）

```ts
// 对于样式冲突严重的子应用，单独开启 Shadow DOM
registerMicroApps([
  {
    name: 'campaigns', // 营销模块样式最混乱
    entry: config.apps.campaigns,
    container: '#subapp-container',
    activeRule: '/admin/campaigns',
    props: { token: config.token },
    sandbox: { strictStyleIsolation: true }, // 开启 Shadow DOM
  },
]);

// ⚠️ 开启 Shadow DOM 后需要处理的问题：
// 1. Element Plus 的 el-dialog / el-popover 使用 Teleport 到 body，会逃逸 Shadow DOM
// 2. 需要在子应用内重写 Teleport 的目标容器
// 3. 全局 CSS 变量（如主题色）需要手动注入 Shadow DOM
```

### 第四层：qiankun 的 experimentalStyleIsolation

```ts
// 如果 Shadow DOM 太重，可以用 scoped 样式方案
start({
  sandbox: {
    strictStyleIsolation: false,
    experimentalStyleIsolation: true, // qiankun 会给子应用样式自动加作用域
  },
});

// 原理：qiankun 会把子应用的样式选择器改写为
// .qiankun-[name] .your-selector { ... }
// 但对动态插入的样式（如 JS 动态创建的 style 标签）无效
```

## 九、生产环境部署 Checklist

微前端上线前，务必逐项检查：

```markdown
□ 子应用 base 路径与主应用 activeRule 一致
□ Nginx 配置了 try_files，子应用深链接刷新不 404
□ 子应用静态资源路径带版本号，支持灰度切换
□ CORS 配置正确（开发环境、生产环境分别检查）
□ 主应用 token 刷新机制正常，子应用能收到广播
□ 主应用登出时子应用能正确清理状态
□ 子应用 unmount 时清理了所有事件监听和定时器
□ 子应用独立运行和被挂载两种模式都能正常工作
□ CSS 样式隔离规则已生效（Stylelint 规则已添加）
□ 首次加载预取（prefetch）配置合理，不浪费带宽
□ 监控报警已覆盖各子应用的 JS 错误和接口异常
□ 回滚方案已验证（切换主应用配置即可回滚到旧版本子应用）
□ 子应用构建产物大小有上限约束（建议 < 500KB gzip）
□ 测试用例覆盖主应用和各子应用的核心流程
```

## 十、我实际踩过的三个坑

### 1. 路由 base 配错，刷新直接 404

最早我把子应用路由写成 `/orders`，但线上真实入口是 `/admin/orders`。结果主应用里跳转正常，浏览器一刷新就被 Nginx 当成静态路径处理。后来统一规则：**主应用 `activeRule`、子应用 router base、Nginx rewrite 三者必须一模一样**。

### 2. 样式没隔离，营销页把订单表格颜色改了

问题根源不是 qiankun，而是我们历史代码里有大量 `body .el-table`、`.page-container div` 这种全局选择器。后来做了两件事：

- 每个子应用根节点固定前缀，如 `.orders-app`、`.goods-app`
- ESLint + Stylelint 禁止新增全局样式选择器

比起一开始就强开 Shadow DOM，这种治理对老项目迁移更平滑。

### 3. 重复登录与 token 失效不同步

如果每个子应用自己读 cookie、自己跳登录页，最后一定出现“主应用已退出，子应用还在请求”的状态。我后来统一成：**Laravel 输出一次 token，主应用维护续签和登出广播，子应用只消费事件**。

```ts
// master
window.dispatchEvent(new CustomEvent('admin:token-refreshed', {
  detail: { token: newToken }
}));

// sub app
window.addEventListener('admin:token-refreshed', (event: any) => {
  api.defaults.headers.Authorization = `Bearer ${event.detail.token}`;
});
```

## 十一、发布策略为什么比接入本身更重要

微前端最容易被忽略的是发布治理。我的做法是：主应用只发壳，子应用单独产出静态资源，路径里带版本号，例如 `/mf/orders/2026-05-03-1/`。Laravel 配置中心只切 `entry` 地址，不重新发整站。这样营销模块热修复时，不会拖着订单后台一起回归。

如果你的团队还做不到子应用独立测试、独立回滚、独立负责人，其实先别上微前端；那只是在单体前端外面再包一层复杂度。

## 十二、结论

qiankun 真正适合的是**边界清楚、多人协作、发布频繁的中后台**，不适合把一个本来就不大的站点硬拆成一堆应用。对 Laravel 团队来说，最佳分工通常是：Laravel 负责登录、菜单、BFF 和配置注入；主应用负责布局和导航；子应用负责业务域页面。这样既保住后端已有体系，也不会让前端继续在一个巨石后台里滚雪球。

如果重来一次，我会更早做两件事：先统一路由前缀规范，再提前清理全局样式。因为真正耗时的，从来不是 `registerMicroApps()`，而是把历史项目改造成“可以被拆”的状态。

## 相关阅读

- [Micro-Frontend 实战：Module Federation 2.0——Vue 3 微前端架构与 Laravel BFF 聚合层集成](/categories/前端/micro-frontend-module-federation-2-vue3-laravel-bff/)
- [Vue 3 + Vite 实战：HMR 构建优化与环境变量管理——Laravel B2C API 前后端分离踩坑记录](/categories/frontend/vue-3-vite-guide-hmr-optimization/)
- [Vite 构建优化实战：Laravel 单仓库后台前端的分包策略、缓存命中与 sourcemap 踩坑记录](/categories/frontend/vite-optimizationguide-laravel-cache-sourcemap/)
- [Monorepo 深度实战：Nx vs Turborepo vs Pants——大型 Laravel 前端项目构建缓存与任务编排](/categories/架构/2026-06-06-Monorepo-深度实战-Nx-vs-Turborepo-vs-Pants-大型Laravel前端项目构建缓存与任务编排/)
- [Server-Driven UI 实战：后端驱动前端渲染——JSON UI 描述协议在 Laravel BFF 中的落地与对比传统 SPA](/categories/架构/server-driven-ui-laravel-bff/)
- [Core Web Vitals 实战：LCP/FID/CLS 优化——Vue 3 + Laravel 前后端协同性能治理](/categories/frontend/Core-Web-Vitals实战-LCP-FID-CLS优化-Vue3-Laravel前后端协同性能治理/)
