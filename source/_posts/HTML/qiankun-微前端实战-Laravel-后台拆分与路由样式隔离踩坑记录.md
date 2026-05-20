---
title: qiankun 微前端实战：Laravel 后台拆分中的路由、鉴权与样式隔离踩坑记录
date: 2026-05-03 09:21:00
categories:
  - HTML
  - Laravel
  - 微前端
tags: [Laravel, Vite, Vue, 前端]description: 基于 Laravel 单仓库后台改造经验，记录一套用 qiankun 拆分订单、商品、营销子应用的落地方案，重点覆盖主子应用通信、路由基座、样式隔离、发布策略与真实踩坑。
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

## 五、我实际踩过的三个坑

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

## 六、发布策略为什么比接入本身更重要

微前端最容易被忽略的是发布治理。我的做法是：主应用只发壳，子应用单独产出静态资源，路径里带版本号，例如 `/mf/orders/2026-05-03-1/`。Laravel 配置中心只切 `entry` 地址，不重新发整站。这样营销模块热修复时，不会拖着订单后台一起回归。

如果你的团队还做不到子应用独立测试、独立回滚、独立负责人，其实先别上微前端；那只是在单体前端外面再包一层复杂度。

## 七、结论

qiankun 真正适合的是**边界清楚、多人协作、发布频繁的中后台**，不适合把一个本来就不大的站点硬拆成一堆应用。对 Laravel 团队来说，最佳分工通常是：Laravel 负责登录、菜单、BFF 和配置注入；主应用负责布局和导航；子应用负责业务域页面。这样既保住后端已有体系，也不会让前端继续在一个巨石后台里滚雪球。

如果重来一次，我会更早做两件事：先统一路由前缀规范，再提前清理全局样式。因为真正耗时的，从来不是 `registerMicroApps()`，而是把历史项目改造成“可以被拆”的状态。
