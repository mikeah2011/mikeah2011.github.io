---
title: Vite 构建优化实战：Laravel 单仓库后台前端的分包策略、缓存命中与 sourcemap 踩坑记录
date: 2026-05-03 10:05:00
categories:
  - HTML
  - Laravel
  - Vite
tags: [Laravel, Vite, 性能优化]description: 结合 Laravel 单仓库项目的真实改造经验，记录如何用 Vite 做多入口拆分、稳定分包、缓存命中优化与 hidden sourcemap 排障，重点覆盖生产环境常见踩坑。
---

我在一个 Laravel 单仓库里做过一次 Vite 构建治理：同一套代码同时承载 API 管理后台、运营活动页和内部工具页。最初大家只图省事，把所有资源都挂到一个 `app.ts`，结果很快出现三个问题：**构建越来越慢、首屏 JS 越来越胖、线上压缩报错根本定位不回源码**。

当时 `npm run build` 稳定在 90 秒以上，后台首页入口接近 2MB，发版后 CDN 也几乎次次失效。我这次改造不是为了“前端工程化好看”，而是两个非常具体的目标：把构建压到 40 秒内，把后台主入口压到 700KB 左右，同时保留生产排障能力。

## 一、改造后的结构

```text
Laravel Blade / SPA
        |
      @vite
        |
+-------v------------------------------+
|              Vite Build              |
| app.ts | admin.ts | marketing.ts     |
+-------+----------------------+-------+
        |                      |
 manualChunks            hidden sourcemap
        |                      |
+-------v--------+     +------v-----------+
| vendor-vue     |     | manifest.json    |
| vendor-chart   |     | hashed assets    |
| vendor-utils   |     | uploaded maps    |
+-------+--------+     +------+-----------+
        |                     |
        +----------+----------+
                   |
               CDN / Nginx
```

核心就三件事：**多入口、稳定分包、隐藏 sourcemap**。

## 二、真实配置

先把不同页面拆成独立入口，不再让活动页和后台首页互相污染：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('vue')) return 'vendor-vue';
          if (id.includes('echarts') || id.includes('zrender')) return 'vendor-chart';
          if (id.includes('axios') || id.includes('lodash')) return 'vendor-utils';
          return 'vendor';
        },
      },
    },
  },
  plugins: [
    laravel({
      input: [
        'resources/js/app.ts',
        'resources/js/admin.ts',
        'resources/js/marketing.ts',
      ],
      refresh: true,
    }),
  ],
});
```

Laravel 模板层只认 manifest，不手写静态路径：

```php
// resources/views/admin.blade.php
@extends('layouts.app')

@section('content')
    <div id="admin-app"></div>
    @vite('resources/js/admin.ts')
@endsection
```

对于图表这类只在少数页面使用的重依赖，我会继续懒加载：

```ts
export async function loadDashboardChart() {
  const { useDashboardChart } = await import('./modules/chart');
  return useDashboardChart();
}
```

这一步非常值。报表页才加载 `echarts`，订单列表和配置页面不再为它付首屏成本。

## 三、为什么这样拆包更稳

很多人第一次优化 Vite，喜欢把每个 npm 包都切成一个 chunk。构建报告确实漂亮，但线上往往更差：请求数暴涨，缓存不稳定，懒资源链也会更长。

我最后保留的是“按稳定性分包”：

- `vendor-vue`：框架核心，版本稳定，缓存周期最长；
- `vendor-chart`：体积大，但只有后台报表页使用；
- `vendor-utils`：`axios/lodash` 这类跨入口复用高的工具；
- 剩余包统一进 `vendor`，避免碎片化。

改完后，后台首页入口从约 2MB 降到 650KB 左右，构建时间压到 37 秒附近，二次发版时 Vue 相关 chunk 基本不变，CDN 终于开始稳定命中。

## 四、怎么验证优化不是“自我感觉良好”

我不会只看构建时间，还会同时看三组数据：

- `dist/assets` 总体积是否下降；
- 首屏入口对应的 chunk 数量是否失控；
- 二次发布时 hash 变化是否收敛。

我当时会在 CI 里额外跑一次构建产物分析：

```ts
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer';

plugins: [
  laravel({
    input: [
      'resources/js/app.ts',
      'resources/js/admin.ts',
      'resources/js/marketing.ts',
    ],
    refresh: true,
  }),
  visualizer({
    filename: 'storage/app/vite-stats.html',
    gzipSize: true,
    brotliSize: true,
  }),
]
```

然后在流水线里把报告存成 artifact，而不是只在本地看一次：

```yaml
- name: Build frontend
  run: npm ci && npm run build

- name: Upload bundle report
  uses: actions/upload-artifact@v4
  with:
    name: vite-report
    path: storage/app/vite-stats.html
```

这样做的好处是，优化是否真的生效，不再靠感觉，而是每次 PR 都能对比。尤其是运营活动页最容易偷偷把大图表库、富文本编辑器重新带回主包，没有报告基本很难第一时间发现。

## 五、sourcemap 的正确姿势

最容易出事故的不是分包，而是 sourcemap。最开始我把 `sourcemap: true` 直接开到生产，结果 `.map` 文件跟着静态资源一起暴露，等于把源码公开了一半。

我现在固定用这套做法：

1. Vite 设成 `hidden`；
2. Nginx 禁止访问 `.map`；
3. 构建后单独上传 sourcemap 到 Sentry 一类平台。

```nginx
location ~* \.map$ {
    deny all;
    return 403;
}

location /build/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

`hidden sourcemap` 的价值在于：浏览器拿不到 map，但错误平台能靠 release 版本把压缩栈还原回源码。

## 六、CI 缓存怎么配才不会越配越慢

前端构建的另一个误区，是把所有缓存都一股脑塞进 CI。最早我缓存了整个 `node_modules`，结果 runner 还原缓存要几十秒，锁文件一变又几乎全失效，整体反而比不缓存更慢。

我最后只缓存两类内容：

- npm 的下载缓存；
- Vite 依赖预构建缓存。

GitHub Actions 里我会这样写：

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: npm

- name: Cache vite prebundle
  uses: actions/cache@v4
  with:
    path: node_modules/.vite
    key: vite-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      vite-${{ runner.os }}-

- name: Install dependencies
  run: npm ci

- name: Build assets
  run: npm run build
```

这套配置的重点不是“缓存越多越好”，而是**缓存恢复成本要低于重新生成成本**。`node_modules` 体积大、平台相关性强，常常不值得缓存；但 `.vite` 的预构建产物恢复很快，对多入口项目收益很稳定。

## 七、发版时我会额外做的两件事

只把包构出来还不够，真正到生产时还要处理两个细节：版本注入和缓存回收。

第一，Laravel 页面里要把当前前端 release 注入给错误平台，不然 sourcemap 上传了也映射不回来：

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Support\Facades\View;

public function boot(): void
{
    View::share('frontendRelease', config('app.asset_version'));
}
```

```blade
<script>
    window.__APP_RELEASE__ = '{{ $frontendRelease }}';
</script>
```

第二，不要在每次发版时粗暴清 CDN 全站缓存。因为 Vite 已经用 hash 文件名了，真正需要刷新的通常只有 HTML 和极少量入口索引。我的做法是：**静态资源走 immutable，HTML 走短缓存**。这样回滚时只要切回旧版本的 HTML，老资源还能继续命中，发版风险会小很多。

## 八、三次真实踩坑

### 1. `manualChunks` 切太细，首屏反而更慢

第一次我按包名一刀切，结果 chunk 数量太多，首屏请求瀑布直接拉长。后来收敛到 4 个稳定 vendor 包，性能才真正回升。

### 2. `ASSET_URL` 改了，Vite `base` 没改

有次发版切 CDN 域名，只改了 Laravel 环境变量，懒加载 chunk 仍然从旧路径取资源，线上出现局部白屏。这个问题本地很难复现，必须在预发环境校验真实域名路径。

### 3. sourcemap 有了，但 release 对不上

Sentry 里明明上传了 map，堆栈还是没法映射。最后发现前端上传时用的是 Git tag，页面注入的却是短 commit SHA。**map 存在不代表能用，版本号对齐才是关键。**

## 九、结论

Vite 优化不是“把包切碎”，而是让资源组织方式贴近真实访问路径。对 Laravel 单仓库来说，我现在基本只守三条线：**入口分离、分包收敛、生产 hidden sourcemap**。如果你的后台已经出现“构建慢、入口胖、线上难排障”这三个信号，优先先动这三刀，收益通常比盲目加机器更直接。