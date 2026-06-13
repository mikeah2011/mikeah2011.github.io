---
title: "Oxc 实战：Rust 驱动的 JavaScript/TypeScript 工具链——Parser/Linter/Formatter/Transformer 全链路 100x 性能提升"
keywords: [Oxc, Rust, JavaScript, TypeScript, Parser, Linter, Formatter, Transformer, 驱动的, 工具链]
date: 2026-06-10 03:33:00
categories:
  - rust
cover: https://images.unsplash.com/photo-1515879218367-8466d910auj4?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1515879218367-8466d910auj4?w=1200&h=630&fit=crop
tags:
  - Rust
  - JavaScript
  - TypeScript
  - Oxc
  - Oxlint
  - Oxfmt
  - 工具链
  - 性能优化
description: "深入实战 Oxc——Rust 编写的 JavaScript/TypeScript 全链路工具链，覆盖 Parser、Linter（Oxlint）、Formatter（Oxfmt）、Transformer 四大核心模块，对比 ESLint/Prettier/SWC/Biome 的性能基准，提供从安装迁移到 CI 集成的完整指南。"
---


## 概述

JavaScript 工具链正在经历一场「Rust 化」革命。过去几年，我们见证了 SWC、esbuild、Rspack 等用 Rust/Go 重写的工具逐步替代 Node.js 生态中性能瓶颈明显的前辈。而 **Oxc**（Oxidation Compiler）项目，则是这场革命中最具野心的一个——它不是替代某个单一工具，而是用 Rust **从零重写整条 JavaScript/TypeScript 工具链**。

Oxc 由 [VoidZero](https://voidzero.dev) 团队开发，目前包含六大核心模块：

| 模块 | 功能 | 竞品对标 | 性能倍数 |
|------|------|----------|----------|
| **oxc-parser** | JS/TS 解析器 | SWC、Biome | 比 SWC 快 3x |
| **Oxlint** | 代码检查（Linter） | ESLint | 50~100x |
| **Oxfmt** | 代码格式化 | Prettier、Biome | 比 Prettier 快 30x，比 Biome 快 2x |
| **oxc-transform** | 代码转译 | Babel、SWC | — |
| **oxc-resolver** | 模块解析 | enhanced-resolve | 28x |
| **oxc-minify** | 代码压缩 | Terser、esbuild | Alpha 阶段 |

本文将深入实战这四大核心模块（Parser → Linter → Formatter → Transformer），从安装、配置、迁移到 CI 集成，给出完整可运行的代码示例。

---

## 一、为什么需要 Oxc？

### 1.1 JavaScript 工具链的性能困境

一个中型前端项目（500+ 文件）的典型 CI 流程：

```
ESLint 检查: ~45s
Prettier 格式化: ~12s
TypeScript 编译: ~60s
Babel 转译: ~20s
─────────────────
总计: ~137s
```

换成 Oxc 工具链后：

```
Oxlint 检查: ~0.5s
Oxfmt 格式化: ~0.4s
oxc-transform 转译: ~2s
─────────────────
总计: ~3s（不含 tsc 类型检查）
```

这不是理论值，而是实际大型仓库的测试结果。Oxlint 已被 Kibana、Sentry、Renovate、Preact、PostHog 等知名项目在生产环境中采用。

### 1.2 Oxc 的架构优势

Oxc 的性能优势来自三个层面：

1. **语言层面**：Rust 无 GC、零成本抽象、SIMD 向量化
2. **算法层面**：增量解析、并行处理、内存池分配器
3. **架构层面**：共享 AST、统一 IR，避免重复解析

---

## 二、Parser：最快的 JS/TS 解析器

### 2.1 安装

```bash
# Node.js
pnpm add oxc-parser

# Rust
cargo add oxc --features parser
```

### 2.2 Node.js 使用示例

```typescript
import { parseSync } from "oxc-parser";

const sourceCode = `
interface User {
  id: number;
  name: string;
  email?: string;
}

function greet(user: User): string {
  return \`Hello, \${user.name}!\`;
}

const admin: User = { id: 1, name: "Admin" };
console.log(greet(admin));
`;

// 解析 TypeScript 源码
const result = parseSync("example.ts", sourceCode, {
  sourceType: "module",
  lang: "ts",
});

console.log("AST 类型:", result.program.type); // "Program"
console.log("Body 节点数:", result.program.body.length);
console.log("模块信息:", result.module); // ESM import/export 信息
console.log("错误数:", result.errors.length);
```

### 2.3 性能基准

在 MacBook Pro M3 Max 上解析 `typescript.js`（约 100 万行）：

| 解析器 | 耗时 | 相对速度 |
|--------|------|----------|
| **Oxc** | **26.3ms** | 1x（基准） |
| SWC | 84.1ms | 3.2x 慢 |
| Biome | 130.1ms | 4.9x 慢 |

### 2.4 解析后打印代码

Oxc 解析器本身不带代码打印功能，但可以配合 `esrap` 实现 parse → transform → print 的完整流程：

```typescript
import { print } from "esrap";
import ts from "esrap/languages/ts";
import { parseSync } from "oxc-parser";

const source = 'const x: number = 42; console.log(x);';
const { program } = parseSync("test.ts", source);

// 打印回代码（类型注解会被保留）
const { code } = print(program, ts());
console.log(code);
// 输出: const x: number = 42; console.log(x);
```

---

## 三、Oxlint：替代 ESLint 的终极方案

Oxlint 是 Oxc 生态中最成熟、用户量最大的模块。它支持 **820+ 条规则**，覆盖 ESLint 核心规则、TypeScript 规则以及 React、Jest、Vitest、Import、Unicorn、jsx-a11y 等流行插件。

### 3.1 安装与基础配置

```bash
pnpm add -D oxlint
```

在 `package.json` 中添加脚本：

```json
{
  "scripts": {
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "lint:strict": "oxlint -D all"
  }
}
```

### 3.2 配置文件 `.oxlintrc.json`

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "rules": {
    // 启用推荐规则集
    "no-unused-vars": "error",
    "no-console": "warn",
    "eqeqeq": ["error", "always"],
    "no-implicit-coercion": "error",

    // TypeScript 规则
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/prefer-optional-chain": "error",

    // React 规则
    "react/jsx-key": "error",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  },
  "ignorePatterns": ["node_modules", "dist", "build", "*.config.js"]
}
```

### 3.3 类型感知 Linting（Type-Aware）

Oxlint 支持基于 TypeScript 类型系统的规则检查，例如检测未处理的 Promise：

```typescript
// Oxlint 能检测到这个问题：floating promise
async function fetchUser(id: number) {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}

// ❌ 错误：Promise 未被 await 或 .catch()
fetchUser(1);

// ✅ 正确
await fetchUser(1);
// 或
fetchUser(1).catch(console.error);
```

启用类型感知需要配置 TypeScript 项目引用，Oxlint 底层使用 [tsgo](https://github.com/microsoft/typescript-go)（TypeScript 7 的 Go 移植版）来获取类型信息。

### 3.4 多文件分析

Oxlint 支持项目级别的跨文件分析，这对于检测循环依赖等场景非常有用：

```typescript
// a.ts
import { b } from "./b";
export const a = () => b();

// b.ts
import { a } from "./a"; // ❌ Oxlint 检测到循环依赖: import/no-cycle
export const b = () => "hello";
```

### 3.5 从 ESLint 迁移

#### 方式一：完全替换（推荐）

```bash
# 使用官方迁移工具，自动转换 ESLint 配置
npx @oxlint/migrate
```

这个工具会读取你的 `.eslintrc.*` 或 `eslint.config.*`，自动生成对应的 `.oxlintrc.json`。

#### 方式二：渐进式迁移（大型仓库推荐）

先并行运行，逐步替换：

```bash
pnpm add -D oxlint eslint-plugin-oxlint
```

在 ESLint 配置中禁用 Oxlint 已覆盖的规则：

```javascript
// eslint.config.js
import oxlintConfig from "eslint-plugin-oxlint/config";

export default [
  // 你的现有 ESLint 配置...
  {
    rules: {
      // 禁用 Oxlint 已覆盖的规则，避免重复报告
    }
  },
  // 必须放在最后，覆盖上面的 rules
  oxlintConfig,
];
```

### 3.6 CI 集成

```yaml
# .github/workflows/lint.yml
name: Lint
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
```

### 3.7 编辑器集成

VS Code 安装 [Oxlint 扩展](https://marketplace.visualstudio.com/items?itemName=oxc.oxlint)即可获得实时错误提示。也可以在 `settings.json` 中配置：

```json
{
  "oxlint.run": "onSave",
  "oxlint.configPath": ".oxlintrc.json"
}
```

---

## 四、Oxfmt：替代 Prettier 的格式化工具

Oxfmt 是 Oxc 生态中较新的成员（目前 Beta 阶段），但已经通过了 Prettier 100% 的 JavaScript/TypeScript 一致性测试。

### 4.1 安装与配置

```bash
pnpm add -D oxfmt
```

```json
{
  "scripts": {
    "fmt": "oxfmt",
    "fmt:check": "oxfmt --check",
    "fmt:staged": "oxfmt --staged"
  }
}
```

### 4.2 支持的语言

Oxfmt 的格式化范围远超 Prettier：

- JavaScript / TypeScript / JSX / TSX
- JSON / JSONC / JSON5
- YAML / TOML
- HTML / CSS / SCSS / Less
- Markdown / MDX
- Vue / Svelte / Angular / Astro
- GraphQL / Ember / Handlebars

### 4.3 内置功能（无需插件）

```bash
# 导入排序
oxfmt --sort-imports

# Tailwind CSS 类名排序
oxfmt --tailwind-sort

# package.json 字段排序
oxfmt --sort-package-json
```

这些功能在 Prettier 中需要安装额外插件（如 `prettier-plugin-tailwindcss`、`prettier-plugin-organize-imports`），Oxfmt 开箱即用。

### 4.4 配置文件 `.oxfmtrc.json`

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

### 4.5 Git Hooks 集成

配合 `lint-staged` + `husky` 实现提交时自动格式化：

```bash
pnpm add -D husky lint-staged
npx husky init
```

`.husky/pre-commit`：

```bash
npx lint-staged
```

`package.json` 中添加：

```json
{
  "lint-staged": {
    "*.{js,ts,jsx,tsx,json,css,md}": [
      "oxfmt --staged",
      "oxlint --fix"
    ]
  }
}
```

---

## 五、Transformer：高速代码转译

`oxc-transform` 提供了与 Babel/SWC 对等的代码转译能力，支持 TypeScript 类型剥离、JSX 转换、语法降级等。

### 5.1 安装

```bash
pnpm add oxc-transform
```

### 5.2 TypeScript 转译

```typescript
import { transform } from "oxc-transform";

const source = `
import { type User } from "./types";

interface Config {
  debug: boolean;
  timeout?: number;
}

const enum Status {
  Active = "ACTIVE",
  Inactive = "INACTIVE",
}

export function processUser(user: User, config: Config): string {
  const status = Status.Active;
  return \`\${user.name}: \${status}\`;
}
`;

const result = await transform("app.ts", source, {
  lang: "ts",
  sourceType: "module",
  cwd: process.cwd(),
  sourcemap: true,
});

console.log(result.code);
// 输出（类型注解被剥离）:
// import { User } from "./types";
// const Status = { Active: "ACTIVE", Inactive: "INACTIVE" };
// export function processUser(user, config) {
//   const status = "ACTIVE";
//   return \`\${user.name}: \${status}\`;
// }
```

### 5.3 JSX 转换与 React Fast Refresh

```typescript
import { transform } from "oxc-transform";

const jsxSource = `
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}
`;

const result = await transform("Counter.tsx", jsxSource, {
  lang: "tsx",
  jsx: {
    runtime: "automatic", // React 17+ JSX Transform
  },
  react: {
    refresh: true, // 启用 React Fast Refresh
  },
});

console.log(result.code);
// 输出包含 _jsx 自动导入和 RefreshRuntime 组件热更新代码
```

### 5.4 语法降级（Lowering）

将现代 JavaScript 语法降级到 ES2015：

```typescript
const modernCode = `
// ES2020: Optional chaining
const street = user?.address?.street;

// ES2021: Logical assignment
config.debug ??= true;
config.cache ||= new Map();

// ES2022: Top-level await
const data = await fetch("/api/data");
`;

const result = await transform("modern.js", modernCode, {
  lang: "js",
  target: "es2015",
});

console.log(result.code);
// 输出（降级到 ES2015 兼容语法）:
// var _user, _user$address;
// var street = (_user = user) === null || _user === void 0
//   ? void 0
//   : (_user$address = _user.address) === null || _user$address === void 0
//     ? void 0
//     : _user$address.street;
```

### 5.5 Isolated Declarations（独立声明发射）

Oxc 支持不依赖 TypeScript 编译器直接生成 `.d.ts` 声明文件，这对 Monorepo 中的增量构建非常有价值：

```typescript
import { isolatedDeclaration } from "oxc-transform";

const result = isolatedDeclaration("lib.ts", `
export function add(a: number, b: number): number {
  return a + b;
}

export interface Options {
  verbose: boolean;
  output: string;
}

export const DEFAULT_OPTIONS: Options = {
  verbose: false,
  output: "dist",
};
`);

console.log(result.code);
// 输出 .d.ts:
// export declare function add(a: number, b: number): number;
// export interface Options { verbose: boolean; output: string; }
// export declare const DEFAULT_OPTIONS: Options;
```

### 5.6 Rust 端使用

```rust
use oxc::allocator::Allocator;
use oxc::codegen::{CodeGenerator, CodegenOptions};
use oxc::parser::Parser;
use oxc::span::SourceType;
use oxc::transformer::{TransformOptions, Transformer};

fn main() {
    let source_text = r#"
        const greet = (name: string): string => {
            return `Hello, ${name}!`;
        };
    "#;

    let allocator = Allocator::default();
    let source_type = SourceType::ts();
    let ret = Parser::new(&allocator, source_text, source_type).parse();

    if !ret.errors.is_empty() {
        for error in &ret.errors {
            eprintln!("Parse error: {error:?}");
        }
        return;
    }

    let mut program = ret.program;
    let transform_options = TransformOptions::default();
    let _ = Transformer::new(
        &allocator,
        source_text,
        source_type,
        &transform_options,
    )
    .build(&mut program);

    let code = CodeGenerator::new()
        .with_options(CodegenOptions { minify: false, ..Default::default() })
        .build(&program)
        .code;

    println!("{code}");
}
```

---

## 六、完整工具链整合

### 6.1 一站式配置

在项目根目录创建完整的 Oxc 工具链配置：

```
project/
├── .oxlintrc.json          # Oxlint 配置
├── .oxfmtrc.json           # Oxfmt 配置
├── package.json
└── tsconfig.json
```

`package.json` 中的完整脚本：

```json
{
  "scripts": {
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "fmt": "oxfmt",
    "fmt:check": "oxfmt --check",
    "check": "oxfmt --check && oxlint",
    "fix": "oxfmt && oxlint --fix",
    "typecheck": "tsc --noEmit",
    "build": "oxc-transform --out-dir dist src/",
    "ci": "pnpm fmt:check && pnpm lint && pnpm typecheck && pnpm build"
  }
}
```

### 6.2 与 Vite 集成

Oxc 提供了 `unplugin-oxc` 插件，可以直接集成到 Vite/Rollup/Webpack：

```bash
pnpm add -D unplugin-oxc
```

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import oxc from "unplugin-oxc/vite";

export default defineConfig({
  plugins: [
    oxc({
      transform: {
        typescript: true,
        jsx: {
          runtime: "automatic",
        },
        target: "es2020",
      },
    }),
  ],
});
```

### 6.3 统一工具链 Vite+

VoidZero 团队还推出了 [Vite+](https://npmx.dev/package/vite-plus)，将 Oxlint 和 Oxfmt 整合为一个统一的工具链入口：

```bash
pnpm add -D vite-plus
```

```json
{
  "scripts": {
    "check": "vite-plus check",
    "fix": "vite-plus fix"
  }
}
```

---

## 七、踩坑记录

### 7.1 Oxlint 规则兼容性

虽然 Oxlint 有 820+ 规则，但并非所有 ESLint 插件规则都已覆盖。如果你重度依赖某些小众插件（如 `eslint-plugin-functional`），需要先检查[规则列表](https://oxc.rs/docs/guide/usage/linter/rules)。

**解决方案**：使用渐进式迁移，并行运行 Oxlint 和 ESLint，逐步切换。

### 7.2 Oxfmt 的 Beta 状态

Oxfmt 目前处于 Beta 阶段，虽然已通过 Prettier JS/TS 一致性测试，但在某些边缘场景（如嵌套模板字符串的格式化）可能有细微差异。

**解决方案**：提交前运行 `oxfmt --check`，在 CI 中作为门禁检查。

### 7.3 Transformer 的运行时依赖

`oxc-transform` 使用 `@oxc-project/runtime` 作为辅助函数的运行时依赖。确保在打包配置中正确处理：

```json
{
  "dependencies": {
    "@oxc-project/runtime": "^0.x.x"
  }
}
```

如果你的项目使用 `externalHelpers` 模式，需要确保打包工具不会将 runtime 内联到每个文件中。

### 7.4 Monorepo 中的配置继承

在 Monorepo 中，建议在根目录放置公共配置，各子包按需覆盖：

```
monorepo/
├── .oxlintrc.json          # 公共规则
├── packages/
│   ├── app/
│   │   └── .oxlintrc.json  # 覆盖特定规则
│   └── lib/
│       └── .oxlintrc.json  # 库的规则（可能更严格）
```

Oxlint 支持配置继承，子包的配置会与父配置合并。

---

## 八、生态与未来

### 8.1 oxc-resolver：模块解析

```bash
pnpm add oxc-resolver
```

```typescript
import { ResolverFactory } from "oxc-resolver";

const resolver = ResolverFactory.create({
  tsconfig: {
    configFile: "./tsconfig.json",
    references: "auto",
  },
});

const result = resolver.sync("./src", "./utils/helper");
console.log(result.path); // /absolute/path/to/src/utils/helper.ts
```

性能比 `enhanced-resolve`（Webpack 使用的解析器）快 **28 倍**。

### 8.2 oxc-minify（Alpha）

代码压缩工具目前处于 Alpha 阶段，支持死代码消除、语法简化和变量名混淆：

```bash
pnpm add oxc-minify
```

### 8.3 行业采用

Oxlint 已被以下知名项目在生产环境中使用：

- **elastic/kibana** — Elastic 的可视化平台
- **getsentry/sentry-javascript** — 错误监控 SDK
- **renovatebot/renovate** — 自动依赖更新
- **preactjs/preact** — 轻量级 React 替代
- **PostHog/posthog** — 产品分析平台
- **cloudflare/agents** — Cloudflare AI Agent 框架

---

## 总结

Oxc 代表了 JavaScript 工具链的未来方向：**用系统级语言重写性能关键路径，同时保持与现有生态的完全兼容**。

选择 Oxc 的理由：

| 场景 | 推荐方案 |
|------|----------|
| 新项目，追求极致性能 | Oxlint + Oxfmt + Vite |
| 大型存量 ESLint 项目 | 渐进式迁移：Oxlint 先行 |
| Monorepo，构建瓶颈 | oxc-resolver + oxc-transform |
| CI 加速 | Oxlint 替代 ESLint，立竿见影 |

核心要点：

1. **Oxlint** 是最成熟的模块，50~100x 性能提升，820+ 规则，生产就绪
2. **Oxfmt** Beta 阶段但已通过 Prettier 一致性测试，30x 性能提升
3. **oxc-transform** 支持完整的 TS/JSX 转译和语法降级
4. **oxc-parser** 比 SWC 快 3x，是所有上层工具的基础

如果你的项目还在用 ESLint + Prettier + Babel 的组合，现在是时候认真考虑迁移到 Oxc 了。工具链的性能差距已经不是 2x、3x 的问题，而是**数量级的碾压**。

---

## 参考资料

- [Oxc 官方文档](https://oxc.rs)
- [Oxc GitHub 仓库](https://github.com/oxc-project/oxc)
- [Oxlint 规则列表](https://oxc.rs/docs/guide/usage/linter/rules)
- [Oxc Parser 基准测试](https://github.com/oxc-project/bench-javascript-parser-written-in-rust)
- [Oxlint 基准测试](https://github.com/oxc-project/bench-linter)
- [Oxfmt 基准测试](https://github.com/oxc-project/bench-formatter)
