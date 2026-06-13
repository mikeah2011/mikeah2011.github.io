---
title: Deno 2.x 实战：安全优先的 JavaScript 运行时——与 Node.js/Bun 的三选一决策
date: 2026-06-02 08:00:00
tags: [Deno, JavaScript, 运行时, TypeScript, 前端工具链]
categories:
  - frontend
cover: /images/covers/deno-2x-runtime-cover.jpg
description: "2026年JavaScript运行时三国鼎立：Deno 2.x凭借安全沙箱、原生TypeScript和npm兼容性强势崛起。本文深度剖析Deno架构（V8+Tokio）、权限系统、模块解析机制、Fresh全栈框架与Deno Deploy边缘计算，提供Deno vs Node.js vs Bun的性能基准测试与生态对比，含完整REST API实战、Docker部署、CI/CD集成及Node.js迁移路径，助你做出清晰的运行时选型决策。"
---

## 前言：JavaScript 运行时的三国时代

2026 年的 JavaScript 生态已经不再是 Node.js 一家独大的局面。Deno 2.x 带着安全优先的设计哲学强势回归，Bun 则以极致性能搅动风云。作为开发者，我们面临一个前所未有的选择困境：**Node.js、Deno、Bun，到底该选谁？**

这篇文章将从实战角度深入剖析 Deno 2.x 的架构设计、安全模型、TypeScript 原生支持、npm 兼容性，并与 Node.js 和 Bun 进行全方位对比。无论你是前端开发者还是后端工程师，读完这篇，你将拥有清晰的选型决策框架。

<!-- more -->

## 一、Deno 的诞生背景与设计哲学

### 1.1 Ryan Dahl 的 Node.js 十大遗憾

2018 年 JSConf EU 上，Node.js 之父 Ryan Dahl 做了一场著名的演讲——"10 Things I Regret About Node.js"。这些遗憾直接催生了 Deno 的设计：

| 遗憾 | Deno 的解决方案 |
|------|----------------|
| 没有坚持 Promise | 原生 Promise，全面 async/await |
| 安全性问题（无权限控制） | 默认沙箱，显式权限声明 |
| 构建系统（GYP） | 原生支持 TypeScript，无需构建步骤 |
| package.json 与 npm | URL 导入，去中心化模块 |
| node_modules 黑洞 | 全局缓存，无 node_modules |
| require 加入即执行 | ESM 标准模块系统 |
| 没有解决 index.js 问题 | 显式文件名，不隐式解析 |

### 1.2 Deno 2.x 的进化

Deno 2.x（2024 年底发布）标志着 Deno 从"实验性运行时"走向"生产级平台"。关键变化包括：

- **完整的 npm 兼容性**：可以直接 `import express from "express"`
- **稳定的 Node.js API 兼容层**：`node:` 前缀支持
- **package.json 支持**：不再强制 URL 导入
- **deno install / deno add**：包管理器功能
- **LTS 长期支持策略**：企业级稳定性承诺
- **Workspaces 支持**：Monorepo 开发模式

```typescript
// Deno 2.x 现在可以直接使用 npm 包
import express from "npm:express@4";
import { z } from "npm:zod@3";

const app = express();
app.get("/", (req, res) => {
  res.json({ runtime: "Deno 2.x", secure: true });
});
app.listen(3000);
```

## 二、Deno 2.x 架构深度剖析

### 2.1 技术栈概览

Deno 的技术栈堪称精雕细琢：

- **V8 引擎**：Google 的 JavaScript 引擎，与 Chrome 同源
- **Tokio 运行时**：Rust 异步运行时，提供高性能 I/O
- **Rusty V8**：Rust 绑定的 V8，内存安全
- **TypeScript 编译器**：基于 SWC 的快速编译
- **URL 模块系统**：遵循 Web 标准

```
┌─────────────────────────────────────┐
│           Deno CLI / REPL           │
├─────────────────────────────────────┤
│     TypeScript / JavaScript 代码    │
├─────────────────────────────────────┤
│    Deno Core (Rust)                 │
│    ├─ 权限系统 (Permission System)  │
│    ├─ 模块加载器 (Module Loader)    │
│    ├─ 文件系统 (deno_fs)           │
│    ├─ 网络 (deno_net)              │
│    └─ 加密 (deno_crypto)           │
├─────────────────────────────────────┤
│    V8 JavaScript Engine             │
├─────────────────────────────────────┤
│    Tokio Async Runtime (Rust)       │
├─────────────────────────────────────┤
│    操作系统 (macOS/Linux/Windows)   │
└─────────────────────────────────────┘
```

### 2.2 启动流程

```bash
# 查看 Deno 的详细启动过程
deno run --log-level=debug main.ts
```

Deno 的启动流程：
1. 解析 CLI 参数
2. 初始化权限系统
3. 加载 V8 引擎
4. 创建 Tokio 运行时
5. 解析入口模块 URL
6. 递归加载依赖模块
7. 编译 TypeScript（如果需要）
8. 执行入口模块

### 2.3 模块解析机制

Deno 2.x 的模块解析是多层次的：

```typescript
// 1. URL 导入（Deno 原生方式）
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// 2. npm 包导入（Deno 2.x 新增）
import _ from "npm:lodash@4";

// 3. Node.js 内置模块（兼容层）
import fs from "node:fs";

// 4. 相对路径导入
import { helper } from "./utils.ts";

// 5. package.json 依赖（Deno 2.x 支持）
// 在 package.json 中声明后可直接导入
```

模块缓存位置：
```bash
# 查看缓存目录
deno info
# DENO_DIR: /Users/michael/.cache/deno

# 缓存结构
# $DENO_DIR/deps/https/deno.land/...
# $DENO_DIR/npm/registry.npmjs.org/...
```

## 三、安全模型：Deno 的核心竞争力

### 3.1 默认沙箱

Deno 最大的设计亮点是**默认无权限**。任何需要系统资源的操作都必须显式授权：

```typescript
// main.ts
const data = await Deno.readTextFile("/etc/hosts");
console.log(data);
```

```bash
# 直接运行会报错
$ deno run main.ts
error: Uncaught PermissionDenied: Requires read access to "/etc/hosts"

# 显式授权
$ deno run --allow-read main.ts
# 成功输出
```

### 3.2 权限系统详解

Deno 提供了细粒度的权限控制：

```bash
# 文件系统权限
deno run --allow-read main.ts                    # 只读
deno run --allow-write main.ts                   # 只写
deno run --allow-read=/tmp --allow-write=/tmp main.ts  # 限定目录

# 网络权限
deno run --allow-net main.ts                     # 所有网络
deno run --allow-net=api.example.com main.ts     # 限定域名

# 环境变量权限
deno run --allow-env main.ts                     # 所有环境变量
deno run --allow-env=DATABASE_URL main.ts        # 限定变量

# 子进程权限
deno run --allow-run main.ts                     # 所有子进程
deno run --allow-run=git main.ts                 # 限定命令

# 系统信息权限
deno run --allow-sys main.ts

# 高精度定时器权限
deno run --allow-hrtime main.ts

# FFI 权限（调用原生库）
deno run --allow-ffi main.ts

# 组合权限
deno run --allow-read --allow-net --allow-env main.ts

# 全部权限（谨慎使用）
deno run --allow-all main.ts  # 或 -A
```

### 3.3 权限在代码中的动态检查

```typescript
// 运行时检查权限状态
const readStatus = await Deno.permissions.query({ name: "read" });
console.log(`读取权限: ${readStatus.state}`); // "granted" | "denied" | "prompt"

// 动态请求权限
const netPermission = await Deno.permissions.request({ name: "net" });
if (netPermission.state !== "granted") {
  console.error("需要网络权限才能继续");
  Deno.exit(1);
}

// 撤销权限
await Deno.permissions.revoke({ name: "read" });
```

### 3.4 与 Node.js/Bun 的安全对比

| 安全特性 | Deno 2.x | Node.js 22 | Bun 1.x |
|---------|----------|------------|---------|
| 默认沙箱 | ✅ 完整沙箱 | ❌ 无沙箱 | ❌ 无沙箱 |
| 文件访问控制 | ✅ 细粒度 | ❌ 无 | ❌ 无 |
| 网络访问控制 | ✅ 细粒度 | ❌ 无 | ❌ 无 |
| 权限继承 | ✅ 子进程继承 | N/A | N/A |
| 代码签名 | ✅ 支持 | ❌ 不支持 | ❌ 不支持 |
| 安全审计 | ✅ --check 标志 | ❌ | ❌ |

Node.js 22 引入了实验性的权限模型（`--experimental-permission`），但功能和成熟度远不如 Deno。

## 四、TypeScript 原生支持

### 4.1 零配置 TypeScript

Deno 对 TypeScript 的支持是开箱即用的：

```typescript
// app.ts — 直接运行，无需 tsconfig.json
interface User {
  id: number;
  name: string;
  email: string;
}

function greet(user: User): string {
  return `Hello, ${user.name}!`;
}

const user: User = { id: 1, name: "Michael", email: "m@example.com" };
console.log(greet(user));
```

```bash
# 直接运行 TypeScript
deno run app.ts
```

### 4.2 类型检查

```bash
# 类型检查（不运行）
deno check app.ts

# 缓存并类型检查
deno cache app.ts

# 运行时跳过类型检查（更快）
deno run --no-check app.ts
```

### 4.3 deno.json 配置 TypeScript

```json
{
  "compilerOptions": {
    "strict": true,
    "lib": ["deno.window"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "types": ["deno.ns"]
  },
  "lint": {
    "rules": {
      "tags": ["recommended"]
    }
  },
  "fmt": {
    "options": {
      "useTabs": false,
      "indentWidth": 2,
      "singleQuote": false
    }
  }
}
```

### 4.4 TSX/JSX 支持

```tsx
// app.tsx — Deno 原生支持 JSX
/** @jsxImportSource preact */

interface Props {
  name: string;
  count: number;
}

function Counter({ name, count }: Props) {
  return (
    <div>
      <h1>{name}</h1>
      <p>Count: {count}</p>
    </div>
  );
}

console.log(<Counter name="Deno" count={42} />);
```

## 五、Deno 2.x 标准库与 API

### 5.1 内置工具链

Deno 2.x 自带完整的开发工具链，无需额外安装：

```bash
# 格式化
deno fmt src/

# 代码检查
deno lint src/

# 测试
deno test src/

# 文档生成
deno doc src/mod.ts

# 依赖检查
deno info

# 编译为可执行文件
deno compile --target x86_64-unknown-linux-gnu main.ts

# 打包
deno bundle main.ts output.js
```

### 5.2 标准库（deno/std）

```typescript
// HTTP 服务器
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve((req: Request) => {
  return new Response("Hello, Deno!", {
    headers: { "content-type": "text/plain" },
  });
}, { port: 8000 });

// 文件系统操作
import { copy, ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
await ensureDir("./output");
await copy("./input.txt", "./output/input.txt");

// 路径处理
import { join, extname } from "https://deno.land/std@0.224.0/path/mod.ts";
const filePath = join("src", "utils", "helper.ts");

// 测试
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("addition", () => {
  assertEquals(1 + 1, 2);
});
```

### 5.3 Web 标准 API

Deno 致力于支持 Web 标准 API：

```typescript
// Fetch API
const response = await fetch("https://api.example.com/data");
const data = await response.json();

// WebSocket
const ws = new WebSocket("wss://echo.websocket.org");
ws.onmessage = (e) => console.log(e.data);

// Web Crypto API
const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"]
);

// TextEncoder/TextDecoder
const encoder = new TextEncoder();
const encoded = encoder.encode("Hello, Deno!");

// URL/URLSearchParams
const url = new URL("https://example.com/api?foo=bar&baz=qux");
console.log(url.searchParams.get("foo")); // "bar"

// AbortController
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await fetch("https://slow-api.com", { signal: controller.signal });
```

### 5.4 Deno 专有 API

```typescript
// 文件操作
const content = await Deno.readTextFile("config.json");
await Deno.writeTextFile("output.txt", "Hello");
const stat = await Deno.stat("file.txt");
console.log(stat.size, stat.mtime);

// 目录操作
for await (const entry of Deno.readDir("src")) {
  console.log(entry.name, entry.isFile);
}

// 进程
const process = Deno.run({ cmd: ["git", "status"], stdout: "piped" });
const output = await process.output();
process.close();

// 环境变量
const port = Deno.env.get("PORT") ?? "3000";
Deno.env.set("NODE_ENV", "production");

// 命令行参数
console.log(Deno.args);

// 退出
Deno.exit(0);

// 定时器
const id = setInterval(() => console.log("tick"), 1000);
setTimeout(() => clearInterval(id), 5000);

// 信号处理
Deno.addSignalListener("SIGINT", () => {
  console.log("Caught SIGINT");
  Deno.exit(0);
});
```

## 六、npm 兼容性：Deno 2.x 的杀手特性

### 6.1 npm 包直接导入

```typescript
// 使用 npm 包
import express from "npm:express@4";
import { PrismaClient } from "npm:prisma";
import { z } from "npm:zod";
import _ from "npm:lodash@4";
import dayjs from "npm:dayjs";

// 也可以在 deno.json 中配置
{
  "imports": {
    "express": "npm:express@4",
    "zod": "npm:zod@3",
    "prisma": "npm:prisma@5"
  }
}
```

### 6.2 Node.js 内置模块兼容

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import http from "node:http";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";

// 使用 Node.js 风格的 API
const files = fs.readdirSync("./src");
const hash = crypto.createHash("sha256").update("hello").digest("hex");
```

### 6.3 package.json 支持

```json
// package.json — Deno 2.x 可以读取
{
  "name": "my-deno-app",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

```bash
# 安装依赖
deno install

# 添加依赖
deno add npm:express@4
deno add npm:zod --dev
```

### 6.4 兼容性边界

尽管 Deno 2.x 的 npm 兼容性已经非常成熟，但仍有一些边界情况：

```typescript
// ✅ 完美兼容
import express from "npm:express";
import lodash from "npm:lodash";
import axios from "npm:axios";
import dayjs from "npm:dayjs";

// ⚠️ 可能有兼容性问题
// 依赖 native addon（C++ binding）的包
// 例如：better-sqlite3, sharp, bcrypt
// Deno 通过 NAPI 兼容层支持部分 native addon

// ❌ 不兼容
// 依赖 __filename / __dirname 全局变量（需要 polyfill）
// 依赖 require.resolve 的特定行为
// 深度依赖 Node.js 内部 API（如 _http_server）
```

## 七、Fresh 框架：Deno 的全栈方案

### 7.1 Fresh 简介

Fresh 是 Deno 的官方全栈框架，灵感来自 Next.js，但有独特的设计：

```bash
# 创建 Fresh 项目
deno run -A -r https://fresh.deno.dev my-app
cd my-app
deno task start
```

### 7.2 Fresh 项目结构

```
my-app/
├── deno.json
├── dev.ts
├── main.ts
├── fresh.gen.ts
├── components/
│   ├── Header.tsx
│   └── Footer.tsx
├── islands/           # 交互组件（客户端 hydrate）
│   ├── Counter.tsx
│   └── Search.tsx
├── routes/            # 文件系统路由
│   ├── index.tsx
│   ├── about.tsx
│   └── api/
│       └── hello.ts
└── static/            # 静态资源
    └── styles.css
```

### 7.3 Islands Architecture

Fresh 采用 Islands 架构——默认服务端渲染，只有标记为 `islands` 的组件才会在客户端 hydrate：

```tsx
// routes/index.tsx — 服务端组件（无客户端 JS）
import { Handlers } from "$fresh/server.ts";

export const handler: Handlers = {
  async GET(req, ctx) {
    const data = await fetch("https://api.example.com/posts");
    const posts = await data.json();
    return ctx.render({ posts });
  },
};

export default function Home({ data }) {
  return (
    <div>
      <h1>Blog Posts</h1>
      {data.posts.map((post) => (
        <article key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.summary}</p>
        </article>
      ))}
    </div>
  );
}
```

```tsx
// islands/Counter.tsx — 客户端交互组件
import { useState } from "preact/hooks";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>+1</button>
    </div>
  );
}
```

### 7.4 Fresh API 路由

```typescript
// routes/api/users.ts
import { Handlers } from "$fresh/server.ts";

export const handler: Handlers = {
  async GET(req) {
    const users = await db.query("SELECT * FROM users");
    return Response.json(users);
  },

  async POST(req) {
    const body = await req.json();
    const user = await db.insert(body);
    return Response.json(user, { status: 201 });
  },
};
```

## 八、Deno Deploy：边缘计算

### 8.1 什么是 Deno Deploy

Deno Deploy 是 Deno 的托管平台，基于全球边缘网络（35+ 区域）：

```typescript
// deploy.ts — 直接部署到边缘
export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    
    if (url.pathname === "/api/hello") {
      return Response.json({ 
        message: "Hello from the edge!",
        region: Deno.env.get("DENO_REGION"),
      });
    }
    
    return new Response("Not Found", { status: 404 });
  },
};
```

```bash
# 使用 deployctl 部署
deployctl deploy --project=my-app deploy.ts
```

### 8.2 Deno KV：内置数据库

```typescript
// Deno KV — 全球分布式键值存储
const kv = await Deno.openKv();

// 写入
await kv.set(["users", "alice"], { name: "Alice", age: 30 });

// 读取
const entry = await kv.get(["users", "alice"]);
console.log(entry.value); // { name: "Alice", age: 30 }

// 原子操作
const result = await kv.atomic()
  .check({ key: ["users", "bob"], versionstamp: null })
  .set(["users", "bob"], { name: "Bob", age: 25 })
  .commit();

// 列表查询
const entries = await kv.list({ prefix: ["users"] });
for await (const entry of entries) {
  console.log(entry.key, entry.value);
}
```

## 九、实战对比：Deno vs Node.js vs Bun

### 9.1 性能基准测试

以下是在 MacBook Pro M3 上的基准测试结果（仅供参考）：

```
HTTP 服务器吞吐量（req/s）：
┌──────────────────────────────────────────────┐
│ Deno 2.x (std/http)    │  ████████████ 85K  │
│ Node.js 22 (http)       │  ████████████ 82K  │
│ Bun 1.x (Bun.serve)    │  █████████████████ 120K │
└──────────────────────────────────────────────┘

TypeScript 编译速度：
┌──────────────────────────────────────────────┐
│ Deno 2.x (SWC)         │  ████████ 0.8s    │
│ Node.js 22 + tsx        │  ██████████ 1.2s  │
│ Bun 1.x                │  ██████ 0.5s      │
└──────────────────────────────────────────────┘

启动时间（Hello World）：
┌──────────────────────────────────────────────┐
│ Deno 2.x               │  ████████ 35ms    │
│ Node.js 22             │  █████████ 45ms   │
│ Bun 1.x                │  █████ 15ms       │
└──────────────────────────────────────────────┘
```

### 9.2 生态系统成熟度

| 维度 | Deno 2.x | Node.js 22 | Bun 1.x |
|------|----------|------------|---------|
| npm 包兼容性 | 95%+ | 100% | 90%+ |
| 原生 TypeScript | ✅ | 需要 tsx | ✅ |
| 内置格式化器 | ✅ deno fmt | ❌ | ❌ |
| 内置 Linter | ✅ deno lint | ❌ | ❌ |
| 内置测试框架 | ✅ deno test | ❌ (需安装) | ✅ bun test |
| 原生 HTTP 服务器 | ✅ Deno.serve | ✅ http 模块 | ✅ Bun.serve |
| WebSocket | ✅ 原生 | 需 ws 包 | ✅ 原生 |
| SQLite | ✅ 内置 | 需 better-sqlite3 | ✅ 内置 |
| 企业级生产案例 | 中等 | 极多 | 较少 |
| 社区大小 | 中 | 极大 | 中 |
| 学习资源 | 中等 | 极多 | 较少 |

### 9.3 实际项目选型决策树

```
你的项目需要什么？
│
├── 最大的生态系统和第三方包支持？
│   └── 选择 Node.js
│
├── 极致的性能和启动速度？
│   └── 选择 Bun（注意：生态兼容性风险）
│
├── 安全性和权限控制是刚需？
│   └── 选择 Deno
│
├── 原生 TypeScript 支持且不想配置构建工具？
│   ├── Deno（零配置）
│   └── Bun（零配置，但安全性不如 Deno）
│
├── 需要边缘计算部署？
│   ├── Deno Deploy（原生支持）
│   └── Cloudflare Workers（另一个选择）
│
├── 团队已有 Node.js 经验？
│   ├── 迁移成本低 → Node.js
│   └── 愿意尝试新事物 → Deno（npm 兼容性好，迁移成本可控）
│
└── 全栈应用 + SSR + Islands 架构？
    ├── Deno + Fresh
    └── Node.js + Next.js / Nuxt
```

## 十、实战：用 Deno 2.x 构建 REST API

### 10.1 项目初始化

```bash
mkdir deno-api && cd deno-api
deno init
```

```json
// deno.json
{
  "tasks": {
    "dev": "deno run --watch --allow-net --allow-read --allow-env src/main.ts",
    "test": "deno test --allow-net --allow-read",
    "start": "deno run --allow-net --allow-read --allow-env src/main.ts"
  },
  "imports": {
    "oak": "npm:oak@17",
    "zod": "npm:zod@3",
    "prisma": "npm:prisma@5",
    "@prisma/client": "npm:@prisma/client@5"
  },
  "compilerOptions": {
    "strict": true,
    "lib": ["deno.ns"]
  }
}
```

### 10.2 完整 API 实现

```typescript
// src/main.ts
import { Application, Router } from "oak";
import { z } from "zod";

// Schema 定义
const UserSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

type User = z.infer<typeof UserSchema> & { id: string };

// 内存数据库（演示用）
const users: Map<string, User> = new Map();

const router = new Router();

router
  .get("/api/users", (ctx) => {
    ctx.response.body = Array.from(users.values());
  })
  .get("/api/users/:id", (ctx) => {
    const user = users.get(ctx.params.id);
    if (!user) {
      ctx.response.status = 404;
      ctx.response.body = { error: "User not found" };
      return;
    }
    ctx.response.body = user;
  })
  .post("/api/users", async (ctx) => {
    const body = await ctx.request.body.json();
    const result = UserSchema.safeParse(body);
    
    if (!result.success) {
      ctx.response.status = 400;
      ctx.response.body = { errors: result.error.issues };
      return;
    }
    
    const id = crypto.randomUUID();
    const user: User = { id, ...result.data };
    users.set(id, user);
    ctx.response.status = 201;
    ctx.response.body = user;
  })
  .delete("/api/users/:id", (ctx) => {
    if (!users.has(ctx.params.id)) {
      ctx.response.status = 404;
      return;
    }
    users.delete(ctx.params.id);
    ctx.response.status = 204;
  });

// 中间件
const app = new Application();

// 日志中间件
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${ctx.request.method} ${ctx.request.url} - ${ms}ms`);
});

// CORS 中间件
app.use(async (ctx, next) => {
  ctx.response.headers.set("Access-Control-Allow-Origin", "*");
  ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  await next();
});

app.use(router.routes());
app.use(router.allowedMethods());

const port = Number(Deno.env.get("PORT")) || 3000;
console.log(`Server running on http://localhost:${port}`);
await app.listen({ port });
```

### 10.3 测试

```typescript
// src/main_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BASE_URL = "http://localhost:3000";

Deno.test("POST /api/users creates a user", async () => {
  const response = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
  });
  
  assertEquals(response.status, 201);
  const user = await response.json();
  assertEquals(user.name, "Alice");
  assertEquals(user.email, "alice@example.com");
});

Deno.test("GET /api/users returns all users", async () => {
  const response = await fetch(`${BASE_URL}/api/users`);
  assertEquals(response.status, 200);
  const users = await response.json();
  assertEquals(Array.isArray(users), true);
});

Deno.test("POST /api/users validates input", async () => {
  const response = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "" }),
  });
  
  assertEquals(response.status, 400);
});
```

```bash
# 运行测试
deno test --allow-net
```

## 十一、Deno 2.x 的生产实践

### 11.1 Docker 部署

```dockerfile
# Dockerfile
FROM denoland/deno:2.1.0

WORKDIR /app

# 缓存依赖
COPY deno.json deno.lock* ./
RUN deno install

# 复制源码
COPY . .

# 编译为独立可执行文件（可选）
# RUN deno compile --output server src/main.ts

EXPOSE 3000

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "src/main.ts"]
```

### 11.2 CI/CD 集成

```yaml
# .github/workflows/deno.yml
name: Deno CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - run: deno fmt --check
      - run: deno lint
      - run: deno check src/**/*.ts
      - run: deno test --allow-net --allow-read
```

### 11.3 编译为可执行文件

```bash
# 编译为各平台可执行文件
deno compile --target x86_64-unknown-linux-gnu --output server-linux src/main.ts
deno compile --target x86_64-apple-darwin --output server-macos src/main.ts
deno compile --target aarch64-apple-darwin --output server-macos-arm src/main.ts
deno compile --target x86_64-pc-windows-msvc --output server.exe src/main.ts
```

## 十二、从 Node.js 迁移到 Deno

### 12.1 迁移路径

```
阶段 1：兼容模式
  └── 使用 deno.json 的 imports 映射 npm 包
  └── 保持 package.json
  └── 使用 node: 前缀导入内置模块

阶段 2：渐进迁移
  └── 将 require() 改为 import
  └── 添加 TypeScript 类型
  └── 使用 Deno 标准库替代部分 npm 包

阶段 3：完全迁移
  └── 删除 package.json
  └── 使用 URL 导入或 deno.json imports
  └── 使用 Deno 原生 API
```

### 12.2 常见迁移模式

```typescript
// Node.js 风格
const fs = require("fs");
const path = require("path");
const express = require("express");

// Deno 风格
import fs from "node:fs";
import path from "node:path";
import express from "npm:express";
```

## 十三、Deno 2.x 的限制与不足

### 13.1 当前限制

1. **部分 npm 包不兼容**：特别是依赖 native addon 的包
2. **社区规模较小**：相比 Node.js，Stack Overflow 问答和教程较少
3. **企业采用率有限**：大型企业迁移成本高，观望态度居多
4. **某些 Node.js API 不完整**：兼容层仍在完善中
5. **部署选项有限**：除了 Deno Deploy，其他平台支持仍在改善

### 13.2 何时不选 Deno

- 你的项目深度依赖某个不兼容的 npm 包
- 团队成员完全没有 TypeScript 经验且不愿意学习
- 需要与大量 Node.js 遗留系统集成
- 客户/甲方明确要求 Node.js 技术栈

## 十四、未来展望

### 14.1 Deno 的路线图

- **更完整的 Node.js 兼容性**：目标 100% 兼容
- **Deno 3.0**：预计将带来更成熟的工具链
- **更好的 IDE 集成**：与 VS Code、WebStorm 深度集成
- **边缘计算标准化**：WinterCG 标准推动跨运行时兼容

### 14.2 JavaScript 运行时的未来趋势

```
                    标准化
        WinterCG / Web Platform APIs
        ┌──────────────────────────────┐
        │  Deno / Node.js / Bun / ...  │
        │  共享 Web 标准 API            │
        └──────────────────────────────┘
        
   差异化竞争点：
   • 安全模型 (Deno 领先)
   • 性能 (Bun 领先)
   • 生态 (Node.js 领先)
```

## 总结

| 选型建议 | 推荐运行时 |
|---------|-----------|
| 新项目 + 重视安全 | Deno 2.x |
| 新项目 + 追求极致性能 | Bun 1.x |
| 新项目 + 最大生态保障 | Node.js 22 |
| 边缘计算 | Deno Deploy |
| 全栈 SSR | Fresh (Deno) 或 Next.js (Node.js) |
| 企业级生产 | Node.js 22（最稳妥） |
| 个人项目 / 实验 | Deno 2.x 或 Bun 1.x |
| 脚本/工具 | Deno 2.x（零配置 TypeScript） |

Deno 2.x 已经不再是那个"只适合实验"的运行时了。它的 npm 兼容性、TypeScript 支持、安全模型和内置工具链让它成为 2026 年值得认真考虑的选择。如果你正在开始一个新项目，不妨给 Deno 一个机会——它可能会让你重新爱上 JavaScript 开发。

---

*本文写于 2026 年 6 月，基于 Deno 2.1.x 版本。技术发展迅速，建议以官方文档为准。*

## 相关阅读

- [Biome 实战：替代 ESLint + Prettier 的下一代前端工具链——Rust 驱动的超快格式化与检查](/post/Biome-实战-替代-ESLint-Prettier-的下一代前端工具链-Rust-驱动的超快格式化与检查.html)
- [Core Web Vitals 实战：LCP/FID/CLS 优化——Vue 3 + Laravel 前后端协同性能治理](/post/Core-Web-Vitals实战-LCP-FID-CLS优化-Vue3-Laravel前后端协同性能治理.html)
- [Nuxt 4 实战：Vue 全栈框架的新范式——服务器组件、自动导入与 SEO 优化](/post/2026-06-02-nuxt-4-vue-fullstack-server-components-auto-import-seo.html)
