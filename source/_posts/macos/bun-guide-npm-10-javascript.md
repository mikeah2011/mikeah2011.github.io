---

title: Bun 实战-比 npm 快 10 倍的 JavaScript 运行时踩坑记录
keywords: [Bun, npm, JavaScript, 倍的, 运行时踩坑记录]
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
date: 2026-05-16 23:40:12
updated: 2026-05-16 23:43:00
categories:
- macos
tags:
- JavaScript
- 前端
- 性能优化
- Bun
- Node.js
- npm
description: Bun 是基于 JavaScriptCore 引擎的全新 JavaScript/TypeScript 运行时与工具链，集成包管理器、构建工具和测试运行器于一体。本文详细记录在 macOS Apple Silicon 环境下，从 npm/pnpm 迁移到 Bun 的完整实战过程，涵盖 bun install 包管理速度对比（比 npm 快 10 倍）、bun build 构建优化、bun test 测试运行、与 Node.js/Deno 的性能基准对比、Laravel + Vue 3 + Vite 项目踩坑案例及 CI/CD 配置，帮助前端开发者快速上手 Bun 并规避常见问题。
---




## 前言

在 Laravel B2C 项目的前端开发中，我一直在用 npm + Vite + Vue 3 的组合。随着项目增多（30+ 仓库），`node_modules` 的磁盘占用和 `npm install` 的等待时间成了日常痛点。直到我把工具链切到了 Bun——包安装速度从 45s 降到了 4s，测试执行快了 3 倍，整体开发体验有了质的提升。

这篇文章记录了我在 macOS (Apple Silicon) 环境下，将 Bun 引入 Laravel + Vue 3 + Vite 项目的真实过程，包括性能对比、踩坑记录和最佳实践。

---

## 一、Bun 是什么？

Bun 不仅仅是另一个 npm。它是一个 **all-in-one 的 JavaScript/TypeScript 运行时和工具链**，由 Zig 语言编写，底层使用 JavaScriptCore（Safari 的 JS 引擎）而非 V8。

```
┌─────────────────────────────────────────────────┐
│                    Bun                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 包管理器  │ │ 构建工具  │ │  测试运行器      │ │
│  │ bun install│ │ bun build │ │  bun test       │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ JS 运行时 │ │ TS 转译  │ │  原生 Bindings   │ │
│  │ bun run   │ │ 内置 TS  │ │  SQLite/FFI/etc  │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────┘
         对比 Node.js 生态需要拼凑多个工具
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐
│   npm    │ │  Node.js │ │ webpack  │ │jest/...│
│  /pnpm   │ │          │ │  /esbuild│ │        │
└──────────┘ └──────────┘ └──────────┘ └────────┘
```

核心优势：
- **包安装**：硬链接 + 全局缓存，比 npm 快 10-25x
- **启动速度**：JavaScriptCore 引擎冷启动比 V8 快约 2x
- **TypeScript**：内置 `.ts` / `.tsx` 转译，无需 `ts-node` 或 `tsx`
- **兼容性**：高度兼容 Node.js API 和 `package.json`

---

## 二、安装与环境配置

### 2.1 macOS 安装（推荐 Homebrew）

```bash
# 推荐方式：Homebrew
brew tap oven-sh/bun
brew install bun

# 验证安装
bun --version
# 1.2.x

# 或者使用官方安装脚本
curl -fsSL https://bun.sh/install | bash
```

### 2.2 与 Node.js 共存

Bun 不会替代系统的 Node.js，两者可以和平共处：

```bash
# 查看各工具版本
node --version    # v20.x
npm --version     # 10.x
bun --version     # 1.2.x

# Bun 可以直接运行 Node.js 脚本
bun run index.js  # 使用 Bun 运行时
node index.js     # 使用 Node.js 运行时
```

### 2.3 配置全局缓存路径

```bash
# Bun 默认缓存位置
ls ~/.bun/install/cache/

# 与 npm 类似，可以查看缓存大小
du -sh ~/.bun/
# 通常比 npm 的 node_modules 小很多
```

---

## 三、包管理：bun install 的碾压性优势

### 3.1 速度对比实测

我在一个真实的 Laravel + Vue 3 项目（含 380+ 依赖）上做了对比：

```bash
# 清除缓存后测试
rm -rf node_modules
time npm install
# real    0m45.213s

rm -rf node_modules
time pnpm install
# real    0m18.456s

rm -rf node_modules
time bun install
# real    0m4.123s
```

| 工具 | 冷安装（无缓存） | 热安装（有缓存） | node_modules 大小 |
|------|-----------------|-----------------|-------------------|
| npm  | 45s            | 22s             | 850MB            |
| pnpm | 18s            | 8s              | 420MB            |
| bun  | 4s             | 2s              | 520MB            |

### 3.2 硬链接机制

Bun 使用**全局缓存 + 硬链接**策略，类似 pnpm 但实现更激进：

```bash
# Bun 的缓存结构
~/.bun/install/cache/
├── lodash@4.17.21/
├── vue@3.4.21/
├── vite@5.1.0/
└── ...

# 项目中的 node_modules 是硬链接到缓存
# 所以多个项目的相同依赖只占一份磁盘空间
```

### 3.3 lockfile 兼容性

**重要踩坑点**：Bun 默认生成 `bun.lockb`（二进制格式），与 `package-lock.json` 不兼容。

```bash
# 如果团队混合使用 npm 和 bun，会产生冲突
# 解决方案 1：统一使用 bun，提交 bun.lockb
echo "bun.lockb" >> .gitignore  # 不要忽略！
git add bun.lockb

# 解决方案 2：让 bun 生成文本格式的 lockfile（Bun 1.2+）
# 在 package.json 中配置
{
  "bun": {
    "lockfile": {
      "format": "text"
    }
  }
}
# 这样会生成 bun.lock（文本格式），可读可 diff
```

### 3.4 在 Laravel 项目中的配置

```json
// package.json 推荐配置
{
  "name": "laravel-vue-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bunx --bun vite",
    "build": "bunx --bun vite build",
    "preview": "bunx --bun vite preview",
    "test": "bun test",
    "lint": "bunx eslint src/",
    "format": "bunx prettier --write src/"
  },
  "bun": {
    "lockfile": {
      "format": "text"
    }
  }
}
```

**踩坑记录**：`bunx` 是 Bun 的 `npx` 替代品，`--bun` 标志确保 Vite 使用 Bun 运行时而非 Node.js，这对 HMR 性能有显著提升。

---

## 四、构建：bun build 的速度优势

### 4.1 替代 esbuild 做快速打包

```bash
# 传统方式：依赖 esbuild
npx esbuild src/index.ts --bundle --outfile=dist/index.js

# Bun 方式：内置 bundler
bun build src/index.ts --outdir dist --target browser
```

### 4.2 生产环境构建对比

```typescript
// build.ts - Bun 原生构建脚本
await Bun.build({
  entrypoints: ['./src/main.ts'],
  outdir: './dist',
  target: 'browser',
  format: 'esm',
  splitting: true,       // 代码分割
  minify: true,          // 压缩
  sourcemap: 'external', // sourcemap
  external: ['vue'],     // 外部依赖
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log('Build complete!');
```

```bash
# 执行构建
bun run build.ts
# 构建时间对比（中型项目，~50 个模块）：
# webpack:  8.2s
# vite:     3.1s
# bun build: 0.4s
```

**注意**：`bun build` 目前主要适合库打包和简单应用。对于 Vue SFC、CSS Modules 等场景，仍然推荐使用 Vite（底层也用 esbuild），但让 Bun 来运行 Vite。

### 4.3 用 Bun 运行 Vite（推荐方案）

```bash
# 传统方式
npx vite dev
npx vite build

# Bun 方式（更快的 HMR）
bunx --bun vite dev
bunx --bun vite build
```

实测 HMR 响应时间：
- `npx vite dev`：HMR 平均 120ms
- `bunx --bun vite dev`：HMR 平均 45ms

---

## 五、测试：bun test 的内置优势

### 5.1 内置测试运行器

Bun 内置了兼容 Jest API 的测试运行器，无需安装 jest/vitest：

```typescript
// src/utils/price.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { formatPrice, calculateDiscount } from './price';

describe('formatPrice', () => {
  it('should format price with currency symbol', () => {
    expect(formatPrice(1999, 'TWD')).toBe('TWD 1,999');
    expect(formatPrice(0, 'USD')).toBe('USD 0');
  });

  it('should handle decimal prices', () => {
    expect(formatPrice(19.99, 'USD')).toBe('USD 19.99');
  });
});

describe('calculateDiscount', () => {
  it('should apply percentage discount', () => {
    expect(calculateDiscount(1000, { type: 'percent', value: 10 }))
      .toBe(900);
  });

  it('should not go below zero', () => {
    expect(calculateDiscount(100, { type: 'fixed', value: 200 }))
      .toBe(0);
  });
});
```

```bash
# 运行测试
bun test

# 运行特定文件
bun test src/utils/price.test.ts

# 带覆盖率
bun test --coverage
```

### 5.2 测试速度对比

```bash
# 同一个测试套件（120 个测试文件，480 个测试用例）
time npx jest
# real    0m12.345s

time bun test
# real    0m3.678s
```

### 5.3 踩坑：bun test 与 vitest 的差异

```typescript
// ❌ bun:test 不支持 vi.mock 的某些高级用法
import { vi } from 'vitest';  // bun:test 没有 vi

// ✅ Bun 使用 Jest 兼容的 mock
import { mock, spyOn } from 'bun:test';

// Mock 模块
mock.module('./api', () => ({
  fetchProducts: () => Promise.resolve([{ id: 1, name: 'Test' }]),
}));

// Spy on
const spy = spyOn(console, 'log');
console.log('hello');
expect(spy).toHaveBeenCalledWith('hello');
```

**踩坑记录**：如果你的项目深度依赖 vitest 的 `vi.mock` 等特性，迁移到 `bun test` 的成本较高。建议新项目用 `bun test`，老项目保留 vitest。

---

## 六、运行时：替代 Node.js 的场景

### 6.1 本地开发脚本

```typescript
// scripts/seed.ts - 数据库填充脚本
// 直接运行，无需 ts-node
import { db } from './database';

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}

const products: Product[] = [
  { id: 1, name: '台北101观景台门票', price: 600, category: '景点' },
  { id: 2, name: '九份老街半日游', price: 1200, category: '行程' },
  { id: 3, name: '垦丁浮潜体验', price: 1800, category: '活动' },
];

async function seed() {
  console.log('🌱 Seeding products...');
  for (const product of products) {
    await db.products.upsert(product);
    console.log(`  ✅ ${product.name}`);
  }
  console.log(`\n🎉 Seeded ${products.length} products`);
}

seed().catch(console.error);
```

```bash
# 直接运行 TypeScript！
bun run scripts/seed.ts
# 无需 ts-node、tsx、或编译步骤
```

### 6.2 内置 SQLite

```typescript
// Bun 原生支持 SQLite，无需 better-sqlite3
import { Database } from 'bun:sqlite';

const db = new Database('app.db');

// 建表
db.run(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT,
    expires_at INTEGER
  )
`);

// 写入
const insert = db.prepare('INSERT OR REPLACE INTO cache VALUES (?, ?, ?)');
insert.run('homepage:data', JSON.stringify({ products: [] }), Date.now() + 3600000);

// 读取
const stmt = db.prepare('SELECT value FROM cache WHERE key = ? AND expires_at > ?');
const row = stmt.get('homepage:data', Date.now());
if (row) {
  console.log(JSON.parse(row.value));
}
```

### 6.3 Fetch API 原生支持

```typescript
// Bun 内置了符合标准的 fetch，无需 node-fetch
const response = await fetch('https://api.example.com/products', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ category: 'tours', limit: 20 }),
});

const data = await response.json();
console.log(data);
```

---

## 七、从 npm/pnpm 迁移到 Bun 的实战步骤

### 7.1 迁移检查清单

```bash
# 1. 确认 Bun 版本
bun --version  # 建议 1.2+

# 2. 删除旧的 lockfile 和 node_modules
rm -rf node_modules package-lock.json pnpm-lock.yaml

# 3. 用 bun 安装依赖
bun install

# 4. 验证关键功能
bun run dev     # 开发服务器
bun run build   # 生产构建
bun test        # 测试

# 5. 提交新的 lockfile
git add bun.lockb
git commit -m "chore: migrate from npm to bun"
```

### 7.2 CI/CD 配置

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint

      - name: Test
        run: bun test --coverage

      - name: Build
        run: bun run build
```

### 7.3 Laravel Mix → Vite + Bun 迁移

如果你的 Laravel 项目还在用 Laravel Mix（Webpack），建议一步到位迁移到 Vite + Bun：

```bash
# 1. 安装 Vite（替换 Laravel Mix）
bun add -d vite laravel-vite-plugin

# 2. 创建 vite.config.ts
```

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    laravel({
      input: ['resources/css/app.css', 'resources/js/app.ts'],
      refresh: true,
    }),
    vue(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
});
```

```html
<!-- blade 模板中替换引用 -->
<!-- 旧：Laravel Mix -->
<!-- <script src="{{ mix('js/app.js') }}"></script> -->

<!-- 新：Vite -->
@vite(['resources/css/app.css', 'resources/js/app.ts'])
```

---

## 八、踩坑记录汇总

### 坑 1：某些 npm 包不兼容 Bun 运行时

```bash
# 遇到过的问题：native addon 编译失败
# 例如：better-sqlite3、sharp 的旧版本
error: Could not build native module

# 解决方案：
# 1. 升级到最新版本（通常已支持 Bun）
bun add better-sqlite3@latest

# 2. 使用 Bun 原生替代品
# better-sqlite3 → bun:sqlite
# sharp → bun 的内置图片处理或 @sharp/sharp
```

### 坑 2：bun.lockb 二进制格式无法 code review

```bash
# bun.lockb 是二进制，GitHub diff 看不到变更
# 解决方案：使用文本格式（Bun 1.2+）
# package.json 中添加：
{
  "bun": {
    "lockfile": { "format": "text" }
  }
}

# 或者添加 Git hook 提示
# .husky/pre-commit
bun install --frozen-lockfile || echo "⚠️ bun.lockb changed, please commit it"
```

### 坑 3：环境变量加载顺序

```typescript
// Node.js 中，dotenv 通常在入口文件最顶部加载
// Bun 内置了 .env 支持，但加载顺序不同

// ❌ 可能的问题：.env.local 覆盖 .env
// Bun 默认只加载 .env

// ✅ 解决方案：显式指定
// bunfig.toml
[env]
# Bun 不会自动加载 .env.local，需要手动指定
```

```toml
# bunfig.toml
[install]
# 使用硬链接（默认）
linker = "hardlink"

[install.cache]
# 全局缓存目录
dir = "~/.bun/install/cache"

[run]
# bun run 时加载的 .env 文件
env = ".env,.env.local"
```

### 坑 4：`bun test` 与 Jest 的 mock 差异

```typescript
// Jest 风格的 automock 不完全兼容
// ❌ Jest 中可以这样写
jest.mock('./api', () => ({
  fetchData: jest.fn().mockResolvedValue({ data: [] }),
}));

// ✅ Bun 中需要用 mock.module
import { mock } from 'bun:test';

mock.module('./api', () => ({
  fetchData: () => Promise.resolve({ data: [] }),
}));
```

### 坑 5：生产环境不建议直接用 Bun 运行后端

```bash
# Bun 作为 Node.js 替代运行 Express/Koa 等框架
# 在生产环境中，稳定性和生态兼容性仍不如 Node.js
# 建议：开发环境用 Bun 加速，生产环境仍用 Node.js

# vite.config.ts 中可以通过环境变量控制
# 开发：bunx --bun vite dev
# 生产构建：bunx --bun vite build（产物是标准 JS，Node.js 可直接 serve）
```

---

## 九、在 Laravel B2C 项目中的最佳实践

### 9.1 推荐的工具组合

```
┌─────────────────────────────────────────┐
│        Laravel B2C 前端工具链            │
│                                         │
│  开发环境：                              │
│  ├── Bun（包管理 + 运行时）              │
│  ├── Vite 5+（构建 + HMR）              │
│  ├── Vue 3 + TypeScript                 │
│  └── Pinia（状态管理）                   │
│                                         │
│  测试：                                  │
│  ├── Bun Test / Vitest                  │
│  └── Cypress（E2E）                     │
│                                         │
│  CI/CD：                                │
│  ├── GitHub Actions + Bun               │
│  └── 产物部署到 Nginx/CDN               │
│                                         │
│  生产环境：                              │
│  └── 标准 JS 产物 → Node.js/Nginx 服务   │
└─────────────────────────────────────────┘
```

### 9.2 Monorepo 中的 Bun 配置

```json
// 根目录 package.json
{
  "name": "laravel-bff-monorepo",
  "private": true,
  "workspaces": [
    "packages/admin",
    "packages/web",
    "packages/shared"
  ]
}
```

```bash
# Bun 原生支持 workspaces
bun install  # 自动处理 workspace 间的依赖链接

# 运行特定 workspace 的脚本
bun --filter admin run dev
bun --filter web run build
```

---

## 十、总结

| 场景 | 推荐工具 | 原因 |
|------|---------|------|
| 包安装 | `bun install` | 速度碾压，磁盘友好 |
| 开发服务器 | `bunx --bun vite` | HMR 更快 |
| TypeScript 脚本 | `bun run script.ts` | 零配置运行 |
| 单元测试 | `bun test` / vitest | 新项目用 bun test，老项目保留 vitest |
| 生产环境（前端） | 标准 JS 产物 | 产物与工具无关 |
| 生产环境（后端） | Node.js | 稳定性和生态兼容性 |

### Bun vs Node.js vs Deno 全面对比

| 特性 | Bun 1.2 | Node.js 22 | Deno 2.x |
|------|---------|------------|----------|
| JS 引擎 | JavaScriptCore (Safari) | V8 (Chrome) | V8 (Chrome) |
| 编写语言 | Zig | C++ | Rust |
| 包管理器 | `bun install`（内置） | npm / pnpm（需单独安装） | 内置 URL 导入 + npm 兼容 |
| 冷安装速度（380 依赖） | ~4s | ~45s (npm) | ~30s |
| TypeScript 支持 | 原生内置，零配置 | 需 ts-node / tsx / 编译 | 原生内置 |
| 测试运行器 | `bun test`（内置） | 需 jest / vitest | `deno test`（内置） |
| 内置 SQLite | ✅ `bun:sqlite` | ❌ 需 better-sqlite3 | ❌ 需第三方库 |
| Fetch API | ✅ 内置 | ✅ 18+ 内置 | ✅ 内置 |
| .env 支持 | ✅ 内置加载 | ❌ 需 dotenv | ❌ 需第三方 |
| Node.js 兼容性 | 高（持续改进中） | 原生 | 中等（通过 npm: 前缀） |
| 生产环境成熟度 | ⚠️ 前端构建推荐，后端慎用 | ✅ 最成熟 | ⚠️ 边缘场景推荐 |
| Workspaces 支持 | ✅ 原生 | ✅ npm 7+ | ✅ 支持 |
| License | MIT | MIT | MIT |

> **选型建议**：新前端项目优先选 Bun 加速开发体验；后端 API 服务暂留 Node.js；边缘计算和安全敏感场景考虑 Deno。三者并非互斥，可在同一项目中组合使用。

Bun 是一个令人兴奋的工具链革新，但它并不意味着要完全替代 Node.js。在实际项目中，**开发阶段用 Bun 加速，生产环境保持 Node.js** 是目前最稳妥的策略。随着 Bun 生态的成熟，这个边界会逐渐模糊。

---

## 相关阅读

- [pnpm 实战：高效磁盘空间利用与 Workspace Monorepo 包管理踩坑记录](/macos/pnpm-guide-workspace-monorepo/) — 另一款高性能包管理器的对比选择
- [npm-workspace 实战：Monorepo 项目管理与多包协作 Laravel 前后端分离踩坑记录](/macos/npm-workspace-guide-monorepo-laravel/) — npm 原生 Workspaces 的使用方式
- [Bun 全栈实战：HTTP Server + File I/O + SQLite 内置能力——对比 Node.js 的性能优势与 Laravel 开发者迁移指南](/04_前端/Bun-全栈实战-HTTP-Server-File-IO-SQLite内置能力-对比Node.js的性能优势与Laravel开发者迁移指南/) — Bun 后端全栈能力深入探索
- [Deno 2.x 实战：安全优先的 JavaScript 运行时——与 Node.js/Bun 的三选一决策](/04_前端/Deno-2x-实战-安全优先的JavaScript运行时-与Node.js-Bun的三选一决策/) — 三大 JS 运行时的选型决策指南

*本文基于 Bun 1.2.x + macOS Apple Silicon 环境测试。如果你在迁移过程中遇到其他问题，欢迎留言讨论。*
