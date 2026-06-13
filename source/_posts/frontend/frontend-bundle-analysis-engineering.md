---
title: 前端 Bundle 分析工程化实战：rollup-plugin-visualizer + source-map-explorer + CI 门禁——防止前端包体积膨胀的自动化守护
keywords: [Bundle, rollup, plugin, visualizer, source, map, explorer, CI, 前端, 分析工程化实战]
date: 2026-06-10 03:09:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
  - Webpack
  - Vite
  - Bundle分析
  - CI/CD
  - 性能优化
  - rollup-plugin-visualizer
  - source-map-explorer
description: 前端包体积膨胀是每个团队都会遇到的问题。本文从工程化角度出发，结合 rollup-plugin-visualizer、source-map-explorer 和 CI 门禁，构建一套自动化的 Bundle 守护体系，防止包体积失控。
---


## 前言

你有没有遇到过这种情况：某天产品经理说「首页怎么越来越慢了」，你打开 Chrome DevTools 的 Network 面板，发现 main.js 已经膨胀到 2MB 了。翻看 git log，找不到任何一个「大改动」，但包体积就是在不知不觉中一路飙升。

这不是个例。根据 HTTP Archive 的数据，2025 年移动端页面的 JavaScript 中位数已经达到 500KB（gzip 后），而很多中大型项目的 Bundle 早就突破了 1MB。包体积直接影响首屏加载时间、TTI（Time to Interactive）和用户留存率——Google 的研究表明，页面加载时间每增加 1 秒，转化率下降 7%。

**问题的核心不是「怎么优化」，而是「怎么防止退化」。** 优化一次容易，但如果没有自动化守护，三个月后又会回到原点。

本文从工程化角度出发，构建一套完整的 Bundle 分析 + CI 门禁体系：

1. **rollup-plugin-visualizer** —— 构建时自动生成可视化分析报告
2. **source-map-explorer** —— 精准定位到模块级别的体积分布
3. **CI 门禁** —— 在 PR 阶段自动检测包体积增长，超标直接阻止合并

## 一、为什么需要 Bundle 分析工程化

### 1.1 手动分析的局限性

大多数团队的 Bundle 分析是这样做的：

```bash
# 偶尔跑一下
npx vite-bundle-visualizer
# 或者
npx source-map-explorer dist/assets/*.js
```

问题在于：

- **不可重复**：只有某个人在某次构建后跑了一次，结果没有留存
- **没有基线**：不知道当前体积是好是坏，跟上次比是涨了还是跌了
- **没有拦截**：发现问题时代码已经合并了，修复成本高
- **没有协作**：分析结果在某个人的终端里，团队看不到

### 1.2 工程化的目标

我们要构建的体系应该满足：

| 维度 | 要求 |
|------|------|
| 自动化 | 每次构建自动生成分析报告，无需手动触发 |
| 可视化 | 团队任何人都能直观看到 Bundle 组成 |
| 可对比 | 有基线，能看趋势，知道每次 PR 的体积变化 |
| 可拦截 | 超标时自动阻止 PR 合并，逼迫开发者关注体积 |
| 可追溯 | 历史数据留存，能回溯体积增长的拐点 |

## 二、rollup-plugin-visualizer：构建时可视化分析

### 2.1 基本配置

`rollup-plugin-visualizer` 同时支持 Rollup 和 Vite（Vite 底层就是 Rollup）。安装：

```bash
npm install -D rollup-plugin-visualizer
```

Vite 配置：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    vue(),
    visualizer({
      // 输出文件路径
      filename: 'dist/stats.html',
      // 自动生成，无需手动打开
      open: false,
      // 数据格式：json 便于后续 CI 处理
      json: true,
      // 分析模板
      template: 'treemap', // treemap | sunburst | network
      // 只在 analyze 模式下启用
      emitFile: true,
    }),
  ],
})
```

### 2.2 条件启用：只在分析时运行

生产构建不需要每次都跑分析，那样会拖慢构建速度。推荐用环境变量控制：

```typescript
// vite.config.ts
const isAnalyze = process.env.ANALYZE === 'true'

export default defineConfig({
  plugins: [
    vue(),
    ...(isAnalyze
      ? [
          visualizer({
            filename: 'dist/stats.html',
            json: true,
            template: 'treemap',
          }),
        ]
      : []),
  ],
})
```

package.json 中加一个专用脚本：

```json
{
  "scripts": {
    "build": "vite build",
    "build:analyze": "ANALYZE=true vite build"
  }
}
```

### 2.3 读取 JSON 输出做自动化处理

关键点：设置 `json: true` 后，visualizer 会输出 `stats.json`，这个 JSON 文件包含了完整的模块依赖树和每个节点的体积数据，是后续 CI 门禁的数据来源。

```typescript
// scripts/check-bundle-size.ts
import fs from 'fs'

interface VisualizerNode {
  name: string
  size: number
  children?: VisualizerNode[]
}

interface VisualizerData {
  version: number
  tree: VisualizerNode
}

function getTotalSize(node: VisualizerNode): number {
  if (!node.children || node.children.length === 0) {
    return node.size
  }
  return node.children.reduce((sum, child) => sum + getTotalSize(child), 0)
}

function getLargeModules(node: VisualizerNode, threshold: number): Array<{ name: string; size: number }> {
  const results: Array<{ name: string; size: number }> = []

  function walk(n: VisualizerNode) {
    if (!n.children || n.children.length === 0) {
      if (n.size >= threshold) {
        results.push({ name: n.name, size: n.size })
      }
    } else {
      n.children.forEach(walk)
    }
  }

  walk(node)
  return results.sort((a, b) => b.size - a.size)
}

const data: VisualizerData = JSON.parse(
  fs.readFileSync('dist/stats.json', 'utf-8')
)

const totalSize = getTotalSize(data.tree)
const totalSizeKB = (totalSize / 1024).toFixed(2)
console.log(`总 Bundle 大小: ${totalSizeKB} KB`)

// 找出大于 50KB 的模块
const largeModules = getLargeModules(data.tree, 50 * 1024)
if (largeModules.length > 0) {
  console.log('\n⚠️  以下模块超过 50KB:')
  largeModules.forEach((m) => {
    console.log(`  - ${m.name}: ${(m.size / 1024).toFixed(2)} KB`)
  })
}
```

### 2.4 自定义分析模板

`rollup-plugin-visualizer` 支持三种可视化模板：

- **treemap**（默认）：矩形树图，面积代表体积，最直观
- **sunburst**：旭日图，层级关系更清晰
- **network**：网络图，展示模块间的依赖关系

团队协作时建议同时生成 treemap 和 network：

```typescript
visualizer({
  filename: 'dist/stats-treemap.html',
  template: 'treemap',
  json: true,
}),
visualizer({
  filename: 'dist/stats-network.html',
  template: 'network',
}),
```

treemap 用于快速定位大模块，network 用于分析依赖关系（比如发现某个小模块被大量间接引用导致整体体积增加）。

## 三、source-map-explorer：精准模块级分析

### 3.1 为什么还需要 source-map-explorer

`rollup-plugin-visualizer` 基于 Rollup 的 chunk 信息，粒度到模块级别。但有时候你需要更精准的信息：

- 一个 chunk 里包含了哪些第三方库
- 某个库的哪些子模块被引入了（比如 moment.js 的 locale 文件）
- tree-shaking 是否生效

`source-map-explorer` 直接分析构建产物和 source map，能给出字节级别的精确数据。

### 3.2 基本用法

```bash
npm install -D source-map-explorer
```

```json
{
  "scripts": {
    "analyze:sme": "source-map-explorer 'dist/assets/*.js' --json dist/sme-report.json"
  }
}
```

### 3.3 与 Vite source map 配合

Vite 默认在 production 模式下不生成 source map。需要手动开启：

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    // CI 分析时开启 source map
    sourcemap: process.env.CI === 'true' ? 'hidden' : false,
  },
})
```

`hidden` 模式：生成 `.map` 文件但不在产物 JS 中添加 `//# sourceMappingURL=` 注释，既方便分析又不影响生产环境。

### 3.4 编程接口：集成到自动化脚本

```typescript
// scripts/sme-analyze.ts
import { explore } from 'source-map-explorer'
import fs from 'fs'

async function analyze() {
  const result = await explore('dist/assets/index-*.js', {
    json: true,
    noRoot: true, // 不包含根路径前缀，输出更干净
  })

  // result 是一个数组，每个元素对应一个 bundle
  const report = result.map((bundle) => {
    const totalBytes = bundle.bundles.reduce((sum, b) => sum + b.size, 0)
    const topModules = bundle.bundles
      .sort((a, b) => b.size - a.size)
      .slice(0, 20)
      .map((b) => ({
        path: b.path,
        sizeKB: (b.size / 1024).toFixed(2),
        percentage: ((b.size / totalBytes) * 100).toFixed(1) + '%',
      }))

    return {
      bundleName: bundle.bundleName,
      totalSizeKB: (totalBytes / 1024).toFixed(2),
      topModules,
    }
  })

  fs.writeFileSync('dist/sme-analysis.json', JSON.stringify(report, null, 2))
  console.log('分析完成，结果已写入 dist/sme-analysis.json')

  // 打印摘要
  report.forEach((r) => {
    console.log(`\n📦 ${r.bundleName}: ${r.totalSizeKB} KB`)
    console.log('  Top 5 模块:')
    r.topModules.slice(0, 5).forEach((m) => {
      console.log(`    ${m.percentage}  ${m.sizeKB} KB  ${m.path}`)
    })
  })
}

analyze().catch(console.error)
```

### 3.5 对比两个版本

`source-map-explorer` 的杀手级功能是版本对比：

```bash
# 构建当前版本
npm run build
cp dist/assets/index-*.js /tmp/current.js

# 切到 main 分支构建
git stash
git checkout main
npm run build
cp dist/assets/index-*.js /tmp/baseline.js
git checkout -
git stash pop

# 对比
npx source-map-explorer /tmp/baseline.js /tmp/current.js
```

这会生成一个并排对比的 HTML，红色是新增的模块，绿色是移除的。非常直观。

## 四、CI 门禁：自动拦截包体积膨胀

### 4.1 整体架构

```
PR 提交
  ↓
GitHub Actions 触发
  ↓
构建产物 + 生成 stats.json
  ↓
对比基线（main 分支的 stats.json）
  ↓
体积增长超过阈值？→ ❌ CI 失败 + 评论 PR
  ↓
体积正常？→ ✅ CI 通过 + 更新基线
```

### 4.2 完整 GitHub Actions 配置

```yaml
# .github/workflows/bundle-size-check.yml
name: Bundle Size Check

on:
  pull_request:
    branches: [main, develop]

concurrency:
  group: bundle-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check-bundle-size:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR branch
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build with analysis
        run: npm run build:analyze
        env:
          ANALYZE: 'true'

      - name: Upload stats artifact
        uses: actions/upload-artifact@v4
        with:
          name: bundle-stats-pr
          path: dist/stats.json

      - name: Checkout base branch for comparison
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          path: base

      - name: Build base branch
        run: |
          cd base
          npm ci
          ANALYZE=true npm run build
        continue-on-error: true

      - name: Compare bundle sizes
        id: compare
        run: |
          node scripts/compare-bundle-size.js \
            --base base/dist/stats.json \
            --current dist/stats.json \
            --threshold 50 \
            --output comparison-report.json

      - name: Comment on PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('comparison-report.json', 'utf-8'));

            const icon = report.passed ? '✅' : '❌';
            const status = report.passed ? '通过' : '未通过';

            let body = `## ${icon} Bundle 体积检查: ${status}\n\n`;
            body += `| 指标 | 值 |\n|------|----|\n`;
            body += `| PR 分支体积 | ${report.currentSizeKB} KB |\n`;
            body += `| 基线体积 | ${report.baseSizeKB} KB |\n`;
            body += `| 变化 | ${report.diffKB > 0 ? '+' : ''}${report.diffKB} KB (${report.diffPercent}%) |\n`;
            body += `| 阈值 | ±${report.thresholdKB} KB |\n\n`;

            if (report.largeModules && report.largeModules.length > 0) {
              body += `### ⚠️ 体积异常模块\n\n`;
              body += `| 模块 | 大小 |\n|------|------|\n`;
              report.largeModules.forEach(m => {
                body += `| \`${m.name}\` | ${m.sizeKB} KB |\n`;
              });
              body += '\n';
            }

            body += `> 详细分析请查看 [Artifacts](/${{ github.repository }}/actions/runs/${{ github.run_id }}) 中的 bundle-stats-pr`;

            // 删除旧的评论
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const oldComment = comments.find(c =>
              c.user.type === 'Bot' && c.body.includes('Bundle 体积检查')
            );
            if (oldComment) {
              await github.rest.issues.deleteComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: oldComment.id,
              });
            }

            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body,
            });

      - name: Fail if threshold exceeded
        if: steps.compare.outputs.passed == 'false'
        run: exit 1
```

### 4.3 对比脚本实现

```javascript
// scripts/compare-bundle-size.js
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
function getArg(name) {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : null
}

const basePath = getArg('base')
const currentPath = getArg('current')
const threshold = parseInt(getArg('threshold') || '50', 10) // KB
const outputPath = getArg('output') || 'comparison-report.json'

function getTreeSize(node) {
  if (!node.children || node.children.length === 0) {
    return node.size || 0
  }
  return node.children.reduce((sum, child) => sum + getTreeSize(child), 0)
}

function getModuleSizes(node, prefix = '') {
  const modules = {}

  function walk(n, p) {
    if (!n.children || n.children.length === 0) {
      if (n.size > 0) {
        modules[p + n.name] = n.size
      }
    } else {
      n.children.forEach((child) => walk(child, p + n.name + '/'))
    }
  }

  walk(node, prefix)
  return modules
}

// 读取数据
const baseData = basePath && fs.existsSync(basePath)
  ? JSON.parse(fs.readFileSync(basePath, 'utf-8'))
  : null
const currentData = JSON.parse(fs.readFileSync(currentPath, 'utf-8'))

const baseSize = baseData ? getTreeSize(baseData.tree) : 0
const currentSize = getTreeSize(currentData.tree)

const diff = currentSize - baseSize
const diffPercent = baseSize > 0 ? ((diff / baseSize) * 100).toFixed(2) : 'N/A'
const thresholdBytes = threshold * 1024

const passed = Math.abs(diff) <= thresholdBytes

// 找出新增的大模块（>100KB）
const baseModules = baseData ? getModuleSizes(baseData.tree) : {}
const currentModules = getModuleSizes(currentData.tree)
const largeModules = []

for (const [name, size] of Object.entries(currentModules)) {
  if (!baseModules[name] && size > 100 * 1024) {
    largeModules.push({
      name: name.split('/').pop(),
      sizeKB: (size / 1024).toFixed(2),
      status: 'new',
    })
  }
}

// 找出体积显著增长的模块
for (const [name, size] of Object.entries(currentModules)) {
  const baseSize = baseModules[name]
  if (baseSize && size > baseSize * 1.5 && size - baseSize > 50 * 1024) {
    largeModules.push({
      name: name.split('/').pop(),
      sizeKB: (size / 1024).toFixed(2),
      baseSizeKB: (baseSize / 1024).toFixed(2),
      status: 'grown',
    })
  }
}

const report = {
  passed,
  thresholdKB: threshold,
  baseSizeKB: (baseSize / 1024).toFixed(2),
  currentSizeKB: (currentSize / 1024).toFixed(2),
  diffKB: (diff / 1024).toFixed(2),
  diffPercent,
  largeModules: largeModules.sort((a, b) => parseFloat(b.sizeKB) - parseFloat(a.sizeKB)),
}

fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))

// 输出到 GitHub Actions
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `passed=${passed}\n`
  )
}

console.log(`\n📊 Bundle 体积对比结果:`)
console.log(`  基线: ${report.baseSizeKB} KB`)
console.log(`  当前: ${report.currentSizeKB} KB`)
console.log(`  变化: ${diff > 0 ? '+' : ''}${report.diffKB} KB (${diffPercent}%)`)
console.log(`  阈值: ±${threshold} KB`)
console.log(`  结果: ${passed ? '✅ 通过' : '❌ 未通过'}`)

if (!passed) {
  process.exit(1)
}
```

### 4.4 体积基线缓存

每次 PR 都重新构建 main 分支太浪费时间。用 GitHub Actions Cache 缓存基线：

```yaml
      - name: Cache base stats
        id: cache-base
        uses: actions/cache@v4
        with:
          path: base-stats.json
          key: bundle-base-${{ github.event.pull_request.base.sha }}

      - name: Build base if not cached
        if: steps.cache-base.outputs.cache-hit != 'true'
        run: |
          git checkout ${{ github.event.pull_request.base.sha }}
          npm ci
          ANALYZE=true npm run build
          cp dist/stats.json base-stats.json
          git checkout ${{ github.head_ref }}
          npm ci
```

## 五、Laravel 项目中的前端 Bundle 管理

### 5.1 Laravel + Vite 的特殊考虑

很多 Laravel 项目使用 Vite 构建前端资源。Laravel 的 Vite 插件有一些特殊行为需要注意：

```typescript
// vite.config.ts
import laravel from 'laravel-vite-plugin'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    laravel({
      input: ['resources/css/app.css', 'resources/js/app.js'],
      refresh: true,
    }),
    ...(process.env.ANALYZE === 'true'
      ? [
          visualizer({
            filename: 'storage/app/bundle-stats.json',
            json: true,
            template: 'treemap',
          }),
        ]
      : []),
  ],
  build: {
    sourcemap: process.env.CI === 'true' ? 'hidden' : false,
  },
})
```

注意：把分析文件输出到 `storage/app/` 而不是 `dist/`，因为 Laravel 的 `dist` 目录是 `public/build/`，不应该把分析文件暴露到公网。

### 5.2 Composer Hook：PHP 端也能触发分析

如果你的 Laravel 项目有部分页面用 Blade 模板渲染（不是纯 SPA），可以在 Composer 脚本中集成：

```json
{
  "scripts": {
    "post-autoload-dump": [
      "@php artisan vendor:publish --tag=laravel-assets --ansi --force"
    ],
    "build:analyze": [
      "ANALYZE=true npm run build",
      "node scripts/check-laravel-bundle.js"
    ]
  }
}
```

```javascript
// scripts/check-laravel-bundle.js
const fs = require('fs')
const path = require('path')

// Laravel Vite 的 manifest 文件
const manifestPath = path.resolve('public/build/manifest.json')
if (!fs.existsSync(manifestPath)) {
  console.error('❌ manifest.json 不存在，请先运行 npm run build')
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

let totalSize = 0
const entries = []

for (const [file, info] of Object.entries(manifest)) {
  const filePath = path.resolve('public/build', file)
  if (fs.existsSync(filePath)) {
    const size = fs.statSync(filePath).size
    totalSize += size
    entries.push({ file, sizeKB: (size / 1024).toFixed(2) })
  }
}

entries.sort((a, b) => parseFloat(b.sizeKB) - parseFloat(a.sizeKB))

console.log(`\n📦 Laravel Bundle 分析:`)
console.log(`  总大小: ${(totalSize / 1024).toFixed(2)} KB\n`)
console.log('  文件列表:')
entries.forEach((e) => {
  console.log(`    ${e.sizeKB} KB  ${e.file}`)
})

// 门禁：单个 JS chunk 不能超过 500KB
const overSized = entries.filter(
  (e) => e.file.endsWith('.js') && parseFloat(e.sizeKB) > 500
)
if (overSized.length > 0) {
  console.error('\n❌ 以下 JS 文件超过 500KB 限制:')
  overSized.forEach((e) => console.error(`  ${e.file}: ${e.sizeKB} KB`))
  process.exit(1)
}
```

## 六、进阶：体积趋势追踪

### 6.1 用 GitHub Pages 展示趋势图

每次 main 分支合并后，把 Bundle 体积数据追加到一个 JSON 文件中，用 GitHub Pages 渲染趋势图：

```yaml
# .github/workflows/bundle-trend.yml
name: Update Bundle Trend

on:
  push:
    branches: [main]

jobs:
  update-trend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: gh-pages
          path: trend

      - name: Build and analyze
        uses: actions/checkout@v4
        with:
          path: source

      - run: |
          cd source
          npm ci
          ANALYZE=true npm run build

      - name: Append to trend data
        run: |
          node -e "
            const fs = require('fs');
            const stats = JSON.parse(fs.readFileSync('source/dist/stats.json', 'utf-8'));

            function getSize(node) {
              if (!node.children || !node.children.length) return node.size || 0;
              return node.children.reduce((s, c) => s + getSize(c), 0);
            }

            const total = getSize(stats.tree);
            const trendPath = 'trend/data.json';
            const trend = fs.existsSync(trendPath)
              ? JSON.parse(fs.readFileSync(trendPath, 'utf-8'))
              : [];

            trend.push({
              date: new Date().toISOString().slice(0, 10),
              commit: process.env.GITHUB_SHA.slice(0, 7),
              sizeKB: Math.round(total / 1024),
            });

            // 只保留最近 100 条
            while (trend.length > 100) trend.shift();

            fs.writeFileSync(trendPath, JSON.stringify(trend, null, 2));
          "

      - name: Deploy trend page
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./trend
```

### 6.2 前端趋势页面

```html
<!-- trend/index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Bundle Size Trend</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <canvas id="chart" width="800" height="400"></canvas>
  <script>
    fetch('data.json')
      .then(r => r.json())
      .then(data => {
        new Chart(document.getElementById('chart'), {
          type: 'line',
          data: {
            labels: data.map(d => d.date),
            datasets: [{
              label: 'Bundle Size (KB)',
              data: data.map(d => d.sizeKB),
              borderColor: '#4fc3f7',
              fill: false,
              tension: 0.1,
            }]
          },
          options: {
            scales: {
              y: { beginAtZero: false }
            },
            plugins: {
              title: {
                display: true,
                text: 'Frontend Bundle Size Trend'
              }
            }
          }
        })
      })
  </script>
</body>
</html>
```

## 七、踩坑记录

### 7.1 visualizer 的 `json` 选项在某些版本不生效

`rollup-plugin-visualizer@0.10.x` 的 `json` 选项有 bug，输出的 JSON 格式不完整。升级到 `0.12.x` 以上解决。

```bash
npm install -D rollup-plugin-visualizer@latest
```

### 7.2 source-map-explorer 在大项目上 OOM

当 source map 文件超过 100MB 时，`source-map-explorer` 可能会内存溢出。解决方案：

```bash
# 增加 Node.js 内存限制
NODE_OPTIONS='--max-old-space-size=4096' npx source-map-explorer dist/assets/*.js
```

或者只分析主 chunk：

```bash
source-map-explorer dist/assets/index-*.js --no-roots
```

### 7.3 Vite 的 CSS 也被计入 Bundle

Vite 的 CSS 会被提取为独立文件，`rollup-plugin-visualizer` 默认不包含 CSS。如果你也需要分析 CSS 体积：

```typescript
// 自定义：分析 CSS 文件大小
import fs from 'fs'
import path from 'path'

const distDir = 'dist/assets'
const files = fs.readdirSync(distDir)
const cssFiles = files.filter((f) => f.endsWith('.css'))

cssFiles.forEach((file) => {
  const size = fs.statSync(path.join(distDir, file)).size
  console.log(`  CSS: ${file} — ${(size / 1024).toFixed(2)} KB`)
})
```

### 7.4 Monorepo 中的路径问题

在 Monorepo（pnpm workspace）中，`source-map-explorer` 的输出路径会包含 `../../node_modules/` 前缀，非常混乱。用 `--no-roots` 参数清理：

```bash
source-map-explorer dist/assets/*.js --no-roots --json
```

### 7.5 CI 中 base 分支构建失败

如果 main 分支的构建本身就有问题（比如环境变量缺失），会导致对比脚本报错。用 `continue-on-error: true` 并在对比脚本中处理 base 不存在的情况：

```javascript
const baseData = basePath && fs.existsSync(basePath)
  ? JSON.parse(fs.readFileSync(basePath, 'utf-8'))
  : null

if (!baseData) {
  console.log('⚠️  基线数据不存在，跳过对比，只检查绝对阈值')
  // 只检查绝对体积
  if (currentSize > 2 * 1024 * 1024) {
    console.error('❌ 总体积超过 2MB 限制')
    process.exit(1)
  }
}
```

## 八、总结

| 工具 | 定位 | 适用场景 |
|------|------|----------|
| rollup-plugin-visualizer | 构建时可视化 | 开发阶段快速定位大模块 |
| source-map-explorer | 精准分析 | 定位 tree-shaking 问题、第三方库子模块 |
| CI 门禁 | 自动拦截 | PR 阶段防止包体积退化 |
| 趋势追踪 | 长期监控 | 观察包体积变化趋势，发现缓慢膨胀 |

**核心原则：**

1. **自动化优于手动** —— 人会忘，机器不会
2. **预防优于修复** —— PR 阶段拦截比上线后发现成本低 10 倍
3. **数据驱动决策** —— 用数字说话，不要靠感觉判断「这个 PR 应该不影响体积吧」
4. **阈值要合理** —— 太严格会导致正常开发受阻，太宽松等于没有门禁。建议从 ±100KB 开始，逐步收紧

把这套体系跑起来后，你会发现一个有趣的现象：当开发者知道「体积超标会被 CI 拦住」时，他们会主动在开发阶段就关注体积——这比任何技术优化都有效。
