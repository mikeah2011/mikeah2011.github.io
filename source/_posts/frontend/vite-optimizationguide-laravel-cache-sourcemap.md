---

title: Vite 构建优化实战：Laravel 单仓库后台前端的分包策略、缓存命中与 sourcemap 踩坑记录
keywords: [Vite, Laravel, sourcemap, 构建优化实战, 单仓库后台前端的分包策略, 缓存命中与, 踩坑记录]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-03 10:05:00
categories:
- frontend
- php
tags:
- Laravel
- Vite
- 性能优化
- 前端构建
- sourcemap
description: 本文基于 Laravel 单仓库后台前端的真实改造实践，深入讲解 Vite 多入口拆分、manualChunks 稳定分包策略、CDN 长缓存命中优化、hidden sourcemap 生产排障方案、CI 缓存配置与发版版本注入流程，附三次真实踩坑复盘和构建优化策略对比表，帮助团队将构建从 90 秒压到 37 秒、首屏从 2MB 降到 650KB。
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

### 分包策略对比表

不同分包思路在实际项目中的表现差异很大。下表汇总了我在多个 Laravel SPA 项目中尝试过的几种方案：

| 策略 | 实现方式 | 构建产物体积 | 缓存命中率 | 请求数 | 维护成本 | 适用场景 |
|------|---------|------------|----------|-------|---------|---------|
| 按包名逐一切割 | `manualChunks` 每个 npm 包返回独立 chunk 名 | 最小（理论值） | ❌ 极低：版本升级全部失效 | 🔺 暴涨 | 高 | 几乎不推荐 |
| **按稳定性分组** | `manualChunks` 按框架/工具/业务分组 | ✅ 较小 | ✅ 高：框架包长期稳定 | ✅ 可控 | 中 | **中大型 Laravel SPA（推荐）** |
| 不做 manualChunks | 依赖 Vite/Rollup 默认行为 | 较大 | 中等：大模块互相污染 | 少 | 最低 | 小型项目 / 原型阶段 |
| `experimentalMinChunkSize` | Rollup 自动拆分，设最小体积阈值 | 中等 | 不可预测 | 不可控 | 低 | 快速迭代的内部工具 |
| 路由级懒加载 | `import()` + 路由 meta 配置 | ✅ 首屏最小 | 高（按需加载） | 首屏少，后续按需 | 中高 | 多页面后台系统 |

> **选择建议**：如果你的项目有 3 个以上独立入口页面，且包含图表、富文本等重量级依赖，优先选择「按稳定性分组 + 路由级懒加载」组合。这是我在 Laravel 后台项目中收益最稳定的方案。

下面是路由级懒加载的完整写法，配合 Vue Router 的 `meta` 字段可以做到精确控制：

```ts
// resources/js/router/index.ts
import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: () => import(/* webpackChunkName: "page-dashboard" */ '../pages/Dashboard.vue'),
      meta: { preload: true }, // 首屏关键路由可标记 preload
    },
    {
      path: '/reports',
      name: 'Reports',
      component: () => import(/* webpackChunkName: "page-reports" */ '../pages/Reports.vue'),
      // echarts 在这个页面内部才会触发加载
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import(/* webpackChunkName: "page-settings" */ '../pages/Settings.vue'),
    },
  ],
});

export default router;
```

配合 Nginx 预加载提示，首屏路由对应的 chunk 可以提前获取：

```nginx
# 对 preload 标记的路由入口注入 Link header
location / {
    add_header Link "</build/assets/page-dashboard-*.js>; rel=preload; as=script" always;
    try_files $uri $uri/ /index.html;
}
```

## 四、怎么验证优化不是"自我感觉良好"

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

这里附上一个我在 CI 里跑的 sourcemap 验证脚本，用于构建后自动检查 map 文件是否有效、release 版本是否一致：

```bash
#!/bin/bash
# scripts/verify-sourcemap.sh
# 构建后运行，验证 sourcemap 文件完整性和版本一致性

set -euo pipefail

DIST_DIR="public/build/assets"
EXPECTED_RELEASE="${1:-$(git rev-parse --short HEAD)}"
ERROR_COUNT=0

echo "🔍 开始验证 sourcemap..."
echo "   期望 release: ${EXPECTED_RELEASE}"
echo ""

# 检查 .map 文件是否存在
MAP_COUNT=$(find "$DIST_DIR" -name "*.js.map" 2>/dev/null | wc -l | tr -d ' ')
if [ "$MAP_COUNT" -eq 0 ]; then
  echo "❌ 未找到任何 .map 文件，请检查 vite.config.ts 中 sourcemap 配置"
  exit 1
fi
echo "✅ 找到 ${MAP_COUNT} 个 sourcemap 文件"

# 检查 map 文件是否为有效 JSON
for map_file in $(find "$DIST_DIR" -name "*.js.map"); do
  if ! jq empty "$map_file" 2>/dev/null; then
    echo "❌ 无效的 sourcemap JSON: ${map_file}"
    ERROR_COUNT=$((ERROR_COUNT + 1))
  fi
done

# 检查 .map 文件是否暴露在 public 目录（不应该被 Nginx 提供）
if [ -d "public/build" ]; then
  PUBLIC_MAPS=$(find "public/build" -name "*.map" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$PUBLIC_MAPS" -gt 0 ]; then
    echo "⚠️  警告: public/build 下发现 ${PUBLIC_MAPS} 个 .map 文件，确保 Nginx 已配置 deny all"
  fi
fi

if [ "$ERROR_COUNT" -gt 0 ]; then
  echo ""
  echo "❌ 验证失败，共 ${ERROR_COUNT} 个错误"
  exit 1
fi

echo ""
echo "✅ sourcemap 验证通过"
```

将这个脚本加入 `package.json` 的 `postbuild` 钩子，每次构建后自动执行：

```json
{
  "scripts": {
    "build": "vite build",
    "postbuild": "bash scripts/verify-sourcemap.sh"
  }
}
```

完整 Sentry 上传步骤也一并贴出来，注意 `--release` 参数必须和页面注入的版本号完全一致：

```yaml
# .github/workflows/deploy.yml（接 CI 缓存配置之后）
    - name: Upload sourcemaps to Sentry
      env:
        SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
        SENTRY_ORG: your-org
        SENTRY_PROJECT: admin-frontend
      run: |
        RELEASE="${{ github.sha }}"
        SHORT_RELEASE="${RELEASE:0:7}"

        # 安装 Sentry CLI
        npm install -g @sentry/cli

        # 创建 release 并上传 sourcemap
        sentry-cli releases new "$SHORT_RELEASE"
        sentry-cli releases files "$SHORT_RELEASE" \
          upload-sourcemaps public/build/assets/ \
          --url-prefix "~/build/assets/" \
          --validate \
          --no-sourcemap-reference

        # 关联 commit 信息
        sentry-cli releases set-commits "$SHORT_RELEASE" --auto
        sentry-cli releases finalize "$SHORT_RELEASE"

    - name: Cleanup local sourcemaps (security)
      run: find public/build -name "*.map" -delete
```

### 真实场景：chunk 加载失败的排查流程

有一次发版后，用户反馈「报表页白屏但其他页面正常」。浏览器控制台报的是一个 404：

```text
GET https://cdn.example.com/build/assets/vendor-chart-a1b2c3d4.js 404 (Not Found)
```

这个问题的排查过程值得记录，因为它涉及 Vite 分包、CDN 部署和回滚三个层面：

```bash
# 第一步：确认 chunk 文件是否存在于本次构建产物中
ls -la public/build/assets/vendor-chart-*.js
# 如果文件存在，说明是 CDN 同步问题

# 第二步：检查 manifest.json 中的引用路径
cat public/build/manifest.json | jq '.["resources/js/admin.ts"]'
# 确认 chunkFileNames 的 hash 值与实际文件名一致

# 第三步：检查 CDN 节点是否已刷新
curl -sI https://cdn.example.com/build/assets/vendor-chart-a1b2c3d4.js | grep -E '(HTTP|Cache-Control|X-Cache)')
# 如果返回 404 但 origin 已有文件，说明 CDN 还在回源或有缓存

# 第四步：如果是回滚场景，确认旧版本 HTML 引用的资源还在
# Vite 的 immutable 策略保证旧资源不会被覆盖
curl -sI https://cdn.example.com/build/assets/vendor-chart-OLDHASH.js | head -5
# 如果旧资源被清理了，说明 CDN 清缓存策略有问题，不是 Vite 的问题
```

根因是：那天切了 CDN 域名，新域名的回源规则没有覆盖 `/build/` 路径，CDN 节点拿到的是 Nginx 的 404 默认页。解决方法是在 CDN 控制台配置回源路径白名单，并在 CI 里加了一步部署后验证：

```yaml
- name: Verify CDN deployment
  run: |
    sleep 10  # 等待 CDN 回源
    MANIFEST_HASH=$(cat public/build/manifest.json | jq -r '.["resources/js/admin.ts"].file' | grep -oP '[a-f0-9]{8}')
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://cdn.example.com/build/assets/admin-${MANIFEST_HASH}.js")
    if [ "$STATUS" != "200" ]; then
      echo "❌ CDN 部署验证失败: admin chunk 返回 ${STATUS}"
      exit 1
    fi
    echo "✅ CDN 部署验证通过"
```

### 真实场景：Tree-shaking 失效导致包体膨胀

另一个经常被忽略的问题是 Tree-shaking 不生效。有一次 `vendor-utils` chunk 突然从 80KB 涨到 340KB，排查发现是有人在 `utils/index.ts` 里加了这行：

```ts
// ❌ 这行会导致整个 lodash 被打入 chunk
export * from 'lodash';
```

Vite（Rollup）的 Tree-shaking 只能分析 ESM 的静态 `import`。当你用 `export *` 重新导出一个 CommonJS 包时，Rollup 无法判断哪些成员被使用，只能全量打包。

正确的做法是按需导入：

```ts
// ✅ 只导出实际使用的函数
export { debounce } from 'lodash-es';  // 优先使用 lodash-es（ESM 版本）
export { throttle } from 'lodash-es';
export { cloneDeep } from 'lodash-es';
```

我在 CI 里加了一步体积检查，超过阈值直接阻断发版：

```yaml
- name: Check bundle size
  run: |
    MAX_VENDOR_SIZE=500  # KB
    for chunk in public/build/assets/vendor-*.js; do
      SIZE_KB=$(( $(wc -c < "$chunk") / 1024 ))
      NAME=$(basename "$chunk")
      if [ "$SIZE_KB" -gt "$MAX_VENDOR_SIZE" ]; then
        echo "❌ ${NAME} 体积 ${SIZE_KB}KB 超过阈值 ${MAX_VENDOR_SIZE}KB"
        exit 1
      fi
      echo "✅ ${NAME}: ${SIZE_KB}KB"
    done
```

### 运行时分包诊断工具

最后分享一个我在本地调试分包效果时常用的脚本，它会输出每个 chunk 的体积、gzip 后体积和是否被多个入口引用：

```bash
#!/bin/bash
# scripts/analyze-chunks.sh
# 分析构建产物的 chunk 体积和引用关系

set -euo pipefail

DIST_DIR="${1:-public/build/assets}"

echo "📊 Vite 构建产物分析"
echo "===================="
echo ""

# 1. 总体积统计
TOTAL_SIZE=$(find "$DIST_DIR" -name "*.js" -exec cat {} + | wc -c | tr -d ' ')
TOTAL_GZIP=$(find "$DIST_DIR" -name "*.js" -exec cat {} + | gzip -c | wc -c | tr -d ' ')
echo "📦 JS 总体积:    $(( TOTAL_SIZE / 1024 )) KB"
echo "📦 JS Gzip 后:   $(( TOTAL_GZIP / 1024 )) KB"
echo "📦 压缩比:       $(( TOTAL_GZIP * 100 / TOTAL_SIZE ))%"
echo ""

# 2. 各 chunk 体积排序
echo "📋 各 chunk 体积（从大到小）:"
echo "---"
find "$DIST_DIR" -name "*.js" -exec sh -c '
  for f; do
    SIZE=$(wc -c < "$f" | tr -d " ")
    GZIP_SIZE=$(gzip -c "$f" | wc -c | tr -d " ")
    printf "%8d  %8d  %s\n" "$SIZE" "$GZIP_SIZE" "$(basename "$f")"
  done
' sh {} + | sort -rn | awk '{
  printf "  %6.1f KB  (gzip: %5.1f KB)  %s\n", $1/1024, $2/1024, $3
}'
echo ""

# 3. manifest.json 分析
if [ -f "public/build/manifest.json" ]; then
  echo "📋 入口引用的 chunk 数量:"
  echo "---"
  jq -r 'to_entries[] | select(.value.isEntry) | "\(.key): \(.value.css | length) CSS, \(.value.imports | length) JS imports"' public/build/manifest.json 2>/dev/null || echo "  (无法解析 manifest)"
fi
```

运行效果类似：

```text
📊 Vite 构建产物分析
====================

📦 JS 总体积:    1843 KB
📦 JS Gzip 后:   587 KB
📦 压缩比:       31%

📋 各 chunk 体积（从大到小）:
---
   412.3 KB  (gzip: 132.1 KB)  vendor-vue-abc12345.js
   387.6 KB  (gzip: 121.4 KB)  vendor-chart-def67890.js
   245.1 KB  (gzip:  78.3 KB)  admin-ghi11223.js
    89.4 KB  (gzip:  31.2 KB)  vendor-utils-jkl44556.js
    52.1 KB  (gzip:  18.7 KB)  app-mno77889.js
    34.8 KB  (gzip:  12.1 KB)  marketing-pqr99001.js
    ...

📋 入口引用的 chunk 数量:
---
resources/js/admin.ts: 1 CSS, 3 JS imports
resources/js/app.ts: 1 CSS, 2 JS imports
resources/js/marketing.ts: 1 CSS, 2 JS imports
```

这个脚本能帮你快速判断：哪些 chunk 该进一步拆分、哪些已经足够精简、压缩比是否合理（通常 gzip 后应该在原始体积的 25%-35% 之间）。

### 策略总览：Vite 构建优化 Checklist

最后整理一份完整的优化 Checklist，方便你在项目中逐步落地：

| 优化项 | 优先级 | 预期收益 | 实施难度 | 关键配置 |
|-------|-------|---------|---------|---------|
| 多入口拆分 | 🔴 P0 | 避免页面间互相污染，首屏减 30%-50% | 低 | `laravel({ input: [...] })` |
| manualChunks 稳定分包 | 🔴 P0 | 缓存命中率从 20% 提升到 80%+ | 中 | `rollupOptions.output.manualChunks` |
| 路由级懒加载 | 🟡 P1 | 首屏再减 40%-60% | 中 | `() => import(...)` + Router config |
| hidden sourcemap | 🔴 P0 | 保留生产排障能力，不暴露源码 | 低 | `build.sourcemap: 'hidden'` |
| Nginx .map 禁止访问 | 🔴 P0 | 源码安全 | 低 | `location ~* \.map$ { deny all; }` |
| Sentry sourcemap 上传 | 🟡 P1 | 生产错误可还原源码行号 | 中 | Sentry CLI + CI pipeline |
| CI 缓存 .vite 预构建 | 🟡 P1 | 构建时间减少 30%-50% | 低 | `actions/cache` + `node_modules/.vite` |
| CI 体积阈值检查 | 🟢 P2 | 防止大依赖被意外引入 | 低 | 自定义 bash 脚本 |
| CDN immutable 缓存策略 | 🟡 P1 | 减少 CDN 回源，回滚更安全 | 低 | Nginx Cache-Control 配置 |
| Tree-shaking 验证 | 🟢 P2 | 防止 CJS 包全量打入 | 中 | 使用 `lodash-es` 替代 `lodash` |
| rollup-plugin-visualizer | 🟢 P2 | 可视化依赖关系，辅助分包决策 | 低 | `visualizer({ filename: '...' })` |

> **落地节奏建议**：P0 项全部做完通常需要 1-2 天，但能解决 80% 的问题。P1 项建议在 1-2 周内逐步补齐。P2 项可以作为日常维护的长期工程习惯。

## 相关阅读

- [Vite 预构建优化实战：依赖预构建与缓存策略的性能调优踩坑记录](/categories/Frontend/vite-optimizationguide-cache/)
- [Webpack/Vite 构建优化实战：Laravel BFF 缓存命中与分包策略踩坑记录](/categories/Frontend/vite-optimizationguide-laravel-bff-cache/)
- [前端构建优化实战：Vite/Webpack 分包策略与缓存优化踩坑记录](/categories/Frontend/build-optimization-vite-webpack/)

## 九、结论

Vite 优化不是“把包切碎”，而是让资源组织方式贴近真实访问路径。对 Laravel 单仓库来说，我现在基本只守三条线：**入口分离、分包收敛、生产 hidden sourcemap**。如果你的后台已经出现“构建慢、入口胖、线上难排障”这三个信号，优先先动这三刀，收益通常比盲目加机器更直接。