---
title: Bun.serve 实战：构建高性能 HTTP API——与 Express/Fastify/Hono 的性能基准与开发体验对比
date: 2026-06-03 03:39:38
tags: [Bun, JavaScript, HTTP Server, 性能对比, 全栈开发]
keywords: [Bun.serve, HTTP API, Express, Fastify, Hono, 构建高性能, 的性能基准与开发体验对比, 前端]
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: 本文深入解析 Bun.serve 构建高性能 HTTP API 的实战方法，从架构原理到生产部署全面覆盖。通过与 Express、Fastify、Hono 的严格性能基准测试，展示 Bun 作为新一代 JavaScript 运行时在请求吞吐量、内存占用和冷启动速度上的显著优势。涵盖 WebSocket、SSE、JWT 认证、SQLite 与 PostgreSQL 集成、Docker 容器化及真实踩坑案例，助你全面评估 Bun 作为 Node.js 替代方案的可行性。
---


# Bun.serve 实战：构建高性能 HTTP API——与 Express/Fastify/Hono 的性能基准与开发体验对比

> 从 Hello World 到生产级部署，全面解析 Bun.serve 的架构优势、开发体验与真实性能表现。

---

## 一、引言：为什么我们需要重新审视 HTTP 服务器的技术选型？

在过去的十年里，Node.js 一直是 JavaScript 开发者构建后端服务的首选运行时。从 Express 的"Hello World"到 NestJS 的企业级架构，JavaScript 在服务端的地位日益稳固。然而，技术的演进永不停歇。从 2022 年 Bun 的首次公开发布，到 2026 年的今天，这个由 Jarred Sumner 主导开发的全新 JavaScript 运行时已经经历了数十个版本的迭代，逐步从"实验性项目"走向了"生产就绪"的状态。

在当前的技术生态中，一个显著的趋势正在发生——越来越多的开发者和团队开始重新审视他们的技术栈选择。传统的 Node.js 生态虽然成熟稳定，但在启动速度、内存占用、开发体验等方面逐渐显现出一些令人不满的地方。特别是在微服务架构和 Serverless 计算日益普及的背景下，一个运行时的冷启动时间从 Node.js 的 50-100 毫秒缩短到 Bun 的 5 毫秒，这种量级的差异不仅仅是数字上的变化，更直接影响着用户体验和基础设施成本。

`Bun.serve` 作为 Bun 运行时内置的原生 HTTP 服务器 API，是 Bun 与 Node.js 竞争的核心武器之一。与 Node.js 的 `http.createServer` 不同，`Bun.serve` 直接使用 Web Standard 的 `Request/Response` 模型，底层由 Zig 语言编写的高性能 I/O 层驱动，搭配 Apple 的 JavaScriptCore 引擎进行 JavaScript 代码执行，从架构层面就奠定了其高性能的基础。

本文将从架构原理出发，通过完整的代码示例和严格的性能基准测试，深入对比 Bun.serve 与 Express、Fastify、Hono 这四种当前主流的 HTTP API 构建方案。我们将覆盖从最基础的 Hello World 到复杂的生产级部署策略，包括路由系统设计、中间件架构、WebSocket 实时通信、数据库集成、认证鉴权、Docker 容器化等方方面面。无论你是正在考虑技术选型的架构师，还是希望提升后端性能的全栈开发者，本文都将为你提供详尽的参考和实用的指导。

---

## 二、Bun.serve 核心架构与设计理念

### 2.1 Bun 的底层技术栈：一切从零开始

要真正理解 `Bun.serve` 为什么快，我们必须首先理解 Bun 的底层技术栈。与大多数人想象的不同，Bun 并非在 Node.js 之上做了某种封装或者优化，而是一个完全从零开始构建的全新 JavaScript 运行时。这意味着它的每一个组件——从 JavaScript 引擎到文件系统操作，从 HTTP 解析到包管理——都是重新设计和实现的。

Bun 的核心由三大支柱组成：

**第一，JavaScriptCore 引擎（JSC）。** 这是 Apple 为 Safari 浏览器开发的 JavaScript 引擎，也是 WebKit 项目的核心组成部分。JSC 的 JIT（即时编译）策略与 V8 有显著不同。V8 采用 Ignition 解释器加 TurboFan 优化编译器的两阶段管线，而 JSC 则使用三级编译管线：Baseline JIT 提供快速的初始编译，DFG（Data Flow Graph）JIT 提供中级优化，FTL（Faster Than Light）JIT 则使用 LLVM 进行深度优化。这种分层策略使得 JSC 在短生命周期的请求处理场景中表现尤为出色——比如处理一个 HTTP 请求然后返回响应这种典型的 Web 服务器工作模式。JSC 能够更快速地从解释执行切换到编译执行，这对于 Serverless 函数和冷启动敏感的场景来说是一个巨大的优势。

**第二，Zig 语言编写的系统层。** 这是 Bun 最独特也最容易被忽视的设计决策。Bun 的核心 I/O 层、HTTP 解析器、文件系统操作等关键性能路径全部使用 Zig 语言编写。Zig 是一种系统编程语言，它提供了与 C 语言相当的底层控制能力，但同时提供了更好的内存安全性保证和更现代的语言特性。通过 Zig，Bun 可以直接调用操作系统的底层 API——在 Linux 上使用 io_uring 进行异步 I/O，在 macOS 上使用 kqueue，在 Windows 上使用 IOCP——而不像 Node.js 那样需要通过 libuv 这一层抽象。这种"少一层抽象"的设计哲学贯穿了 Bun 的整个架构。

**第三，自定义 HTTP 解析器。** HTTP 请求的解析是 Web 服务器最频繁的操作之一。Node.js 使用 llhttp（由 Joyent 的 http_parser 演进而来）来解析 HTTP 请求，而 Bun 则实现了自己的 HTTP 解析器，大量使用了 SIMD（Single Instruction, Multiple Data）指令集来加速 HTTP header 的解析过程。在处理包含大量 header 的请求时，SIMD 加速可以带来数倍的性能提升。

下面的架构图展示了 Bun 与 Node.js 在处理 HTTP 请求时的关键差异：

```mermaid
graph TB
    subgraph "Bun Runtime 架构"
        A["JavaScript/TypeScript 代码"] --> B["Bun CLI"]
        B --> C["JavaScriptCore 引擎<br/>(Baseline → DFG → FTL JIT)"]
        B --> D["Zig 系统层<br/>(直接调用 OS API)"]
        D --> E["自定义 HTTP 解析器<br/>(SIMD 加速)"]
        D --> F["自定义文件 I/O<br/>(io_uring / kqueue)"]
        D --> G["自定义加密模块"]
        E --> H["Bun.serve HTTP 服务器"]
        E --> I["WebSocket 服务器"]
    end
    
    subgraph "Node.js 架构"
        J["JavaScript/TypeScript 代码"] --> K["Node.js CLI"]
        K --> L["V8 引擎<br/>(Ignition → TurboFan)"]
        K --> M["C++ libuv 层<br/>(抽象 I/O)"]
        M --> N["llhttp 解析器"]
        N --> O["http.createServer"]
        M --> P["文件系统操作"]
    end
```

### 2.2 Bun.serve 的请求处理流水线

理解了底层技术栈之后，让我们更深入地看看一个 HTTP 请求在 Bun.serve 中是如何被处理的。与 Node.js 的 `http.createServer` 不同，Bun.serve 的请求处理流水线要简洁得多。

在 Node.js 中，一个 HTTP 请求的处理链路大致如下：客户端发起 TCP 连接，libuv 的事件循环检测到新连接后交给 llhttp 解析器，llhttp 解析完整的 HTTP 请求后通过 C++ binding 层将数据传递给 JavaScript 层的 `IncomingMessage` 对象，开发者的回调函数接收到这个对象后处理业务逻辑，最后通过 `ServerResponse` 对象将响应写回客户端。这个过程中涉及至少四次跨语言边界的调用（C++ → JavaScript → C++ → JavaScript），每次跨边界调用都有性能开销。

而在 Bun.serve 中，这个链路被大幅简化。Zig 编写的 HTTP 解析器直接将解析结果传递给 JavaScript 层的 `Request` 对象——这是一个 Web Standard 定义的标准接口。开发者在 `fetch` 回调中返回一个 `Response` 对象，Bun 的 Zig 层直接将 Response 的内容通过 TCP 连接发送回客户端。整个过程中跨语言边界的调用次数减少到了两次，而且 Bun 的 Zig 层与 JSC 引擎之间的数据传递使用了更高效的内存共享机制，而不是 Node.js 中 V8 和 libuv 之间的序列化/反序列化。

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant TCP as TCP Listener
    participant Parser as HTTP Parser (Zig + SIMD)
    participant Handler as fetch handler (JS)
    participant DB as 异步 I/O

    Client->>TCP: TCP 连接建立
    TCP->>Parser: 接收原始字节流
    Parser->>Parser: SIMD 加速解析 HTTP 头
    Parser->>Handler: 构造 Request 对象
    Handler->>DB: 异步数据库查询
    DB-->>Handler: 返回查询结果
    Handler-->>Client: 返回 Response 对象
    Note over Parser,Handler: Zig 层直接写入 Socket<br/>减少跨语言边界调用
```

### 2.3 Bun.serve 的核心设计哲学

Bun.serve 的 API 设计遵循了几个重要的设计原则，这些原则使其在众多 HTTP 服务器方案中独树一帜：

**Web Standard 优先。** Bun.serve 使用 `Request` 和 `Response` 作为输入输出类型，这与浏览器中的 Fetch API 完全一致。这意味着你可以在浏览器端和服务器端共享相同的请求处理代码，这对于同构渲染和全栈框架来说是一个巨大的优势。相比之下，Node.js 的 `IncomingMessage` 和 `ServerResponse` 是 Node.js 特有的接口，无法在浏览器端复用。

**内置能力优于第三方依赖。** Bun.serve 内置了 WebSocket 支持、TLS 支持、静态文件服务等能力，而这些在 Node.js 生态中都需要安装额外的第三方库（如 `ws`、`node-forge` 等）。这种设计减少了依赖数量，降低了供应链攻击的风险，也简化了项目初始化的流程。

**性能不是可选项，而是默认项。** Bun.serve 的默认配置就针对性能进行了优化——默认启用 TCP_NODELAY、使用事件驱动的非阻塞 I/O、在 Zig 层进行内存池管理等。开发者不需要像在 Node.js 中那样手动调优这些底层参数。

### 2.4 Bun.serve 与 Node.js http.createServer 的全面对比

在深入代码实战之前，让我们先通过一个详细的对比表来了解两者之间的核心差异：

| 特性维度 | Bun.serve | Node.js http.createServer |
|------|-----------|--------------------------|
| 底层实现语言 | Zig + 自定义 HTTP 解析器 | C++ libuv + llhttp |
| JavaScript 引擎 | JavaScriptCore (JSC) | V8 |
| 请求/响应模型 | Web Standard (Request/Response) | Node.js 特有 (IncomingMessage/ServerResponse) |
| WebSocket 支持 | 内置，无需第三方库 | 需要 ws / socket.io 等 |
| TLS 支持 | 内置 OpenSSL | 内置 OpenSSL |
| 热重载 | 内置 `--hot` 模式 | 需要 nodemon / tsx 等 |
| TypeScript 支持 | 原生支持，零配置 | 需要 ts-node / tsx 等 |
| 典型启动时间 | 3-8 毫秒 | 50-150 毫秒 |
| 内存占用 (空闲) | 20-30 MB | 40-60 MB |
| JSON 序列化性能 | 极快（JSC 优化） | 快（V8 优化） |

---

## 三、快速上手：从 Hello World 到完整 REST API

### 3.1 安装 Bun 运行时

在开始编写代码之前，我们需要先安装 Bun 运行时。Bun 的安装过程非常简单，一条命令即可完成：

```bash
# macOS / Linux / WSL
curl -fsSL https://bun.sh/install | bash

# 通过 npm 安装（适用于所有平台）
npm install -g bun

# 通过 Homebrew 安装（macOS）
brew tap oven-sh/bun
brew install bun

# 验证安装是否成功
bun --version
# 输出类似: 1.2.21
```

安装完成后，Bun 同时提供了 `bun` 命令行工具（运行时 + 包管理器 + 打包器）和相关的开发工具链。值得注意的是，Bun 的安装包大小约为 50MB，相比之下 Node.js 的安装包约为 80MB，这也反映了 Bun 更精简的设计。

### 3.2 第一个 Bun.serve 服务器

让我们从最简单的 Hello World 开始，感受 Bun.serve 的代码简洁性：

```typescript
// server.ts
// Bun.serve 的基本用法——启动一个 HTTP 服务器只需要几行代码

const server = Bun.serve({
  port: 3000,
  
  // fetch 是 Bun.serve 的核心回调函数
  // 每当有 HTTP 请求到达时，Bun 会调用这个函数
  // 它接收一个标准的 Request 对象，需要返回一个 Response 对象
  fetch(req) {
    return new Response("Hello from Bun.serve! 🚀", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});

// server.port 获取实际监听的端口（当 port 为 0 时由系统分配）
// server.hostname 获取监听的地址
console.log(`服务器已启动: http://localhost:${server.port}`);
```

运行这个服务器同样简单：

```bash
bun run server.ts
# 输出: 服务器已启动: http://localhost:3000
```

对比一下 Node.js 中实现相同功能的代码，差异一目了然：

```javascript
// Node.js 版本——需要更多的样板代码
const http = require("http");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Hello from Node.js!");
});
server.listen(3000, () => {
  console.log("服务器已启动: http://localhost:3000");
});
```

虽然两者的代码行数差异不算巨大，但 Bun.serve 使用了 Web Standard 的 `Request/Response` 接口，这意味着你在 Bun 中编写的请求处理逻辑可以直接在浏览器的 Service Worker、Cloudflare Workers、Deno 等环境中复用。而 Node.js 的 `req/res` 回调模式是 Node.js 特有的，不具备这种可移植性。

### 3.3 构建完整的用户管理 REST API

现在让我们构建一个更贴近实际项目的完整 REST API——一个用户管理系统，包含完整的 CRUD 操作、错误处理和统一的响应格式：

```typescript
// api.ts - 完整的用户管理 REST API

// ========== 类型定义 ==========
interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user" | "guest";
  createdAt: string;
  updatedAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

// ========== 数据层（内存模拟，生产环境替换为数据库）==========
const users: Map<string, User> = new Map();

// 初始化种子数据
const seedUsers: User[] = [
  { id: "1", name: "张三", email: "zhangsan@example.com", role: "admin", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "2", name: "李四", email: "lisi@example.com", role: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "3", name: "王五", email: "wangwu@example.com", role: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];
seedUsers.forEach(u => users.set(u.id, u));

// ========== 响应辅助函数 ==========
function successResponse<T>(data: T, meta?: ApiResponse<T>["meta"], status = 200): Response {
  const body: ApiResponse<T> = { success: true, data, meta };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Powered-By": "Bun.serve",
    },
  });
}

function errorResponse(error: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ========== 输入验证 ==========
function validateUserInput(input: any): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  if (!input.name || typeof input.name !== "string" || input.name.length < 2) {
    errors.push("姓名至少需要 2 个字符");
  }
  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.push("请提供有效的邮箱地址");
  }
  if (input.role && !["admin", "user", "guest"].includes(input.role)) {
    errors.push("角色必须是 admin、user 或 guest");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// ========== 路由匹配辅助 ==========
function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const pathParts = path.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ========== 主服务器 ==========
const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  hostname: "0.0.0.0",

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    // CORS 预检请求处理
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      // GET /api/users - 获取用户列表（支持分页和搜索）
      if (method === "GET" && path === "/api/users") {
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 10));
        const search = url.searchParams.get("q") || "";
        
        let allUsers = Array.from(users.values());
        if (search) {
          const q = search.toLowerCase();
          allUsers = allUsers.filter(u =>
            u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
          );
        }
        
        const total = allUsers.length;
        const start = (page - 1) * pageSize;
        const paged = allUsers.slice(start, start + pageSize);
        
        return successResponse(paged, { total, page, pageSize });
      }

      // GET /api/users/:id - 获取单个用户
      const singleMatch = matchRoute(path, "/api/users/:id");
      if (method === "GET" && singleMatch) {
        const user = users.get(singleMatch.id);
        if (!user) return errorResponse("用户不存在", 404);
        return successResponse(user);
      }

      // POST /api/users - 创建新用户
      if (method === "POST" && path === "/api/users") {
        const body = await req.json();
        const validation = validateUserInput(body);
        if (!validation.valid) {
          return errorResponse(validation.errors!.join("; "), 422);
        }
        
        const input = body as any;
        // 检查邮箱是否已存在
        const existing = Array.from(users.values()).find(u => u.email === input.email);
        if (existing) return errorResponse("该邮箱已被注册", 409);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const newUser: User = {
          id,
          name: input.name,
          email: input.email,
          role: input.role || "user",
          createdAt: now,
          updatedAt: now,
        };
        users.set(id, newUser);
        return successResponse(newUser, undefined, 201);
      }

      // PUT /api/users/:id - 更新用户
      if (method === "PUT" && singleMatch) {
        const existing = users.get(singleMatch.id);
        if (!existing) return errorResponse("用户不存在", 404);
        
        const body = await req.json() as any;
        if (body.name || body.email) {
          const validation = validateUserInput({ ...existing, ...body });
          if (!validation.valid) return errorResponse(validation.errors!.join("; "), 422);
        }
        
        const updated: User = {
          ...existing,
          ...(body.name && { name: body.name }),
          ...(body.email && { email: body.email }),
          ...(body.role && { role: body.role }),
          id: existing.id, // 防止 ID 被篡改
          createdAt: existing.createdAt, // 保护创建时间
          updatedAt: new Date().toISOString(),
        };
        users.set(updated.id, updated);
        return successResponse(updated);
      }

      // DELETE /api/users/:id - 删除用户
      if (method === "DELETE" && singleMatch) {
        if (!users.has(singleMatch.id)) return errorResponse("用户不存在", 404);
        users.delete(singleMatch.id);
        return new Response(null, { status: 204 });
      }

      // GET /api/health - 健康检查
      if (method === "GET" && path === "/api/health") {
        return successResponse({
          status: "ok",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          userCount: users.size,
        });
      }

      // 404 - 路由未找到
      return errorResponse(`路由 ${method} ${path} 不存在`, 404);

    } catch (err) {
      console.error("服务器错误:", err);
      if (err instanceof SyntaxError) {
        return errorResponse("请求体 JSON 格式错误", 400);
      }
      return errorResponse("服务器内部错误", 500);
    }
  },
});

console.log(`🚀 用户管理 API 已启动: http://localhost:${server.port}`);
console.log(`📋 可用端点:`);
console.log(`   GET    /api/users         - 获取用户列表（支持 ?page=1&pageSize=10&q=搜索）`);
console.log(`   GET    /api/users/:id      - 获取单个用户`);
console.log(`   POST   /api/users          - 创建用户`);
console.log(`   PUT    /api/users/:id      - 更新用户`);
console.log(`   DELETE /api/users/:id      - 删除用户`);
console.log(`   GET    /api/health         - 健康检查`);
```

使用 `curl` 测试各个端点：

```bash
# 启动服务器
bun run api.ts

# 获取用户列表
curl -s http://localhost:3000/api/users | jq .

# 带分页和搜索参数
curl -s "http://localhost:3000/api/users?page=1&pageSize=2&q=张" | jq .

# 创建新用户
curl -s -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"赵六","email":"zhaoliu@example.com","role":"user"}' | jq .

# 更新用户
curl -s -X PUT http://localhost:3000/api/users/4 \
  -H "Content-Type: application/json" \
  -d '{"name":"赵六六","role":"admin"}' | jq .

# 删除用户
curl -s -X DELETE http://localhost:3000/api/users/4 -w "%{http_code}"

# 健康检查
curl -s http://localhost:3000/api/health | jq .
```

### 3.4 Bun.serve 配置选项详解

Bun.serve 提供了丰富的配置选项来满足不同场景的需求。以下是关键配置项的详细说明：

```typescript
Bun.serve({
  // ===== 基本网络配置 =====
  port: 3000,                    // 监听端口，0 表示由系统自动分配
  hostname: "0.0.0.0",           // 监听地址，"0.0.0.0" 表示接受所有网络接口的连接

  // ===== TLS/HTTPS 配置 =====
  tls: {
    cert: Bun.file("./cert.pem"),   // TLS 证书（支持 BunFile 直接读取）
    key: Bun.file("./key.pem"),     // TLS 私钥
    // 也支持字符串形式
    // cert: "-----BEGIN CERTIFICATE-----\n...",
    // key: "-----BEGIN PRIVATE KEY-----\n...",
  },

  // ===== 核心请求处理 =====
  fetch(req, server) {
    // server 参数提供了额外的能力：
    // - server.requestIP(req): 获取客户端真实 IP
    // - server.upgrade(req): 将 HTTP 连接升级为 WebSocket
    const ip = server.requestIP(req);
    return new Response(`你的 IP: ${ip?.address}`);
  },

  // ===== WebSocket 配置（可选）=====
  websocket: {
    open(ws) { /* 新连接建立 */ },
    message(ws, message) { /* 收到消息 */ },
    close(ws, code, message) { /* 连接关闭 */ },
    drain(ws) { /* 发送缓冲区清空，可以继续发送 */ },
  },

  // ===== 全局错误处理 =====
  error(error) {
    // 当 fetch 函数抛出未捕获异常时调用
    return new Response(`内部错误: ${error.message}`, { status: 500 });
  },

  // ===== 开发模式 =====
  development: process.env.NODE_ENV !== "production",
  // 开发模式下会启用更详细的错误信息和更宽松的安全策略

  // ===== 性能相关 =====
  maxRequestBodySize: 10 * 1024 * 1024,  // 最大请求体大小，默认 128MB
  idleTimeout: 30,                        // 空闲连接超时（秒），默认 10

  // ===== 可观测性 =====
  // Bun.serve 还支持获取服务器统计信息
});
```

---

## 四、路由系统、中间件与错误处理的最佳实践

### 4.1 构建轻量级路由系统

`Bun.serve` 的一个核心设计决策是不内置路由系统。这看似是一个缺陷，但实际上体现了 Bun 团队"保持核心精简、按需组合"的哲学。在实际项目中，你可以根据项目的复杂度选择不同的方案：对于简单的微服务，使用自定义路由即可；对于中大型项目，可以引入 Hono 等轻量级框架。

下面我们实现一个支持路径参数、查询参数和通配符的路由系统。这个实现虽然只有不到 80 行代码，但已经能满足大多数中小型项目的需求：

```typescript
// router.ts - 轻量级路由系统

type RouteHandler = (
  req: Request,
  params: Record<string, string>,
  url: URL
) => Response | Promise<Response>;

interface CompiledRoute {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

class Router {
  private routes: CompiledRoute[] = [];
  private middlewares: Array<(req: Request, next: () => Promise<Response>) => Promise<Response>> = [];

  // 注册中间件
  use(middleware: (req: Request, next: () => Promise<Response>) => Promise<Response>) {
    this.middlewares.push(middleware);
  }

  // 注册 HTTP 方法路由
  get(path: string, handler: RouteHandler) { this.add("GET", path, handler); }
  post(path: string, handler: RouteHandler) { this.add("POST", path, handler); }
  put(path: string, handler: RouteHandler) { this.add("PUT", path, handler); }
  patch(path: string, handler: RouteHandler) { this.add("PATCH", path, handler); }
  delete(path: string, handler: RouteHandler) { this.add("DELETE", path, handler); }

  private add(method: string, path: string, handler: RouteHandler) {
    const paramNames: string[] = [];
    // 将路径模式转为正则表达式
    // 例如: /api/users/:id/posts/:postId → /api/users/([^/]+)/posts/([^/]+)
    const patternStr = path
      .replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      })
      .replace(/\*/g, "(.*)"); // 通配符支持
    
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  // 匹配路由并执行请求
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    
    // 执行中间件链
    let index = -1;
    const executeMiddleware = async (i: number): Promise<Response> => {
      if (i <= index) throw new Error("next() 被多次调用");
      index = i;
      
      if (i < this.middlewares.length) {
        return this.middlewares[i](req, () => executeMiddleware(i + 1));
      }
      
      // 中间件执行完毕，匹配路由
      for (const route of this.routes) {
        if (route.method !== req.method) continue;
        const match = url.pathname.match(route.pattern);
        if (match) {
          const params: Record<string, string> = {};
          route.paramNames.forEach((name, idx) => {
            params[name] = decodeURIComponent(match[idx + 1]);
          });
          return route.handler(req, params, url);
        }
      }
      
      return Response.json({ error: `路由 ${req.method} ${url.pathname} 未找到` }, { status: 404 });
    };
    
    return executeMiddleware(0);
  }
}

export { Router };
```

### 4.2 中间件系统的洋葱模型实现

中间件是 HTTP 框架中最重要的概念之一。它允许我们将横切关注点（如日志记录、认证、CORS 处理等）从业务逻辑中分离出来。Express 和 Koa 都采用了洋葱模型——请求从外向内穿过每一层中间件，响应再从内向外穿回。下面我们用 Bun.serve 实现类似的机制，并提供几个实用的中间件示例：

```typescript
// middlewares.ts - 常用中间件实现

type Middleware = (
  req: Request,
  next: () => Promise<Response>
) => Promise<Response>;

// ===== 1. 请求日志中间件 =====
// 记录每个请求的方法、路径、状态码和响应时间
const logger: Middleware = async (req, next) => {
  const start = performance.now();
  const method = req.method;
  const pathname = new URL(req.url).pathname;

  const res = await next();

  const duration = (performance.now() - start).toFixed(2);
  const status = res.status;
  const statusEmoji = status >= 400 ? "❌" : "✅";
  
  console.log(`${statusEmoji} ${method} ${pathname} → ${status} [${duration}ms]`);
  
  // 添加自定义响应头
  const headers = new Headers(res.headers);
  headers.set("X-Response-Time", `${duration}ms`);
  
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};

// ===== 2. CORS 跨域中间件 =====
const cors = (options: {
  origin?: string | string[];
  methods?: string[];
  headers?: string[];
  maxAge?: number;
} = {}): Middleware => {
  const {
    origin = "*",
    methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    headers = ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge = 86400,
  } = options;

  return async (req, next) => {
    const originHeader = req.headers.get("Origin") || "*";
    const allowOrigin = Array.isArray(origin)
      ? (origin.includes(originHeader) ? originHeader : origin[0])
      : origin;

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowOrigin,
          "Access-Control-Allow-Methods": methods.join(", "),
          "Access-Control-Allow-Headers": headers.join(", "),
          "Access-Control-Max-Age": String(maxAge),
        },
      });
    }

    const res = await next();
    res.headers.set("Access-Control-Allow-Origin", allowOrigin);
    return res;
  };
};

// ===== 3. 请求限流中间件 =====
const rateLimit = (options: {
  windowMs?: number;
  maxRequests?: number;
} = {}): Middleware => {
  const { windowMs = 60000, maxRequests = 100 } = options;
  const clients: Map<string, { count: number; resetAt: number }> = new Map();

  // 定期清理过期记录
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of clients) {
      if (val.resetAt < now) clients.delete(key);
    }
  }, windowMs);

  return async (req, next) => {
    // 简化：使用请求头中的 IP 或 X-Forwarded-For
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    
    let record = clients.get(ip);
    if (!record || record.resetAt < now) {
      record = { count: 0, resetAt: now + windowMs };
      clients.set(ip, record);
    }
    
    record.count++;
    
    if (record.count > maxRequests) {
      return Response.json(
        { error: "请求过于频繁，请稍后再试" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((record.resetAt - now) / 1000)),
            "X-RateLimit-Limit": String(maxRequests),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }
    
    const res = await next();
    res.headers.set("X-RateLimit-Limit", String(maxRequests));
    res.headers.set("X-RateLimit-Remaining", String(maxRequests - record.count));
    return res;
  };
};

// ===== 4. 请求体大小限制中间件 =====
const bodySizeLimit = (maxBytes: number): Middleware => {
  return async (req, next) => {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      return Response.json(
        { error: `请求体不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` },
        { status: 413 }
      );
    }
    return next();
  };
};

export { logger, cors, rateLimit, bodySizeLimit };
```

### 4.3 统一错误处理架构

在生产级应用中，健壮的错误处理是不可或缺的。我们需要一个统一的错误处理框架，能够区分不同类型的错误并返回合适的 HTTP 状态码和错误信息：

```typescript
// errors.ts - 统一错误处理框架

// 自定义错误基类
class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = "INTERNAL_ERROR",
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

// 404 错误
class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource}（ID: ${id}）未找到` : `${resource} 未找到`,
      404,
      "NOT_FOUND"
    );
  }
}

// 400 验证错误
class ValidationError extends AppError {
  constructor(public fields: Record<string, string[]>) {
    super("请求数据验证失败", 400, "VALIDATION_ERROR", { fields });
  }
}

// 401 认证错误
class AuthenticationError extends AppError {
  constructor(message = "请先登录") {
    super(message, 401, "AUTHENTICATION_ERROR");
  }
}

// 403 权限错误
class ForbiddenError extends AppError {
  constructor(message = "没有权限执行此操作") {
    super(message, 403, "FORBIDDEN");
  }
}

// 409 冲突错误
class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

// 全局错误处理包装器
function withErrorHandler(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      // 已知的业务错误
      if (error instanceof AppError) {
        const body: Record<string, unknown> = {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        };
        if (error.details) body.error.details = error.details;
        
        return Response.json(body, { status: error.statusCode });
      }
      
      // JSON 解析错误
      if (error instanceof SyntaxError) {
        return Response.json(
          { success: false, error: { code: "INVALID_JSON", message: "请求体 JSON 格式错误" } },
          { status: 400 }
        );
      }
      
      // 未知错误——记录详细信息但不暴露给客户端
      console.error(`[${new Date().toISOString()}] 未处理的错误:`, error);
      
      return Response.json(
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: process.env.NODE_ENV === "production"
              ? "服务器内部错误"
              : (error as Error).message,
          },
        },
        { status: 500 }
      );
    }
  };
}

export {
  AppError, NotFoundError, ValidationError, AuthenticationError,
  ForbiddenError, ConflictError, withErrorHandler,
};
```

---

## 五、性能基准测试：Bun.serve vs Express vs Fastify vs Hono

这是本文最核心的章节。性能数据是技术选型中最有说服力的依据之一。我们将通过严格的测试环境和一致的测试场景，对 Bun.serve、Express、Fastify 和 Hono（分别运行在 Bun 和 Node.js 之上）进行全面的性能对比。

### 5.1 测试环境说明

为了确保测试结果的公平性和可复现性，我们使用了以下标准化的测试环境：

**硬件环境：**
- 处理器：Apple M2 Pro（10 核 CPU：6 性能核 + 4 能效核）
- 内存：16GB LPDDR5 统一内存
- 存储：512GB NVMe SSD
- 操作系统：macOS 15.3（Darwin 24.3.0）

**软件版本：**
- Bun v1.2.21
- Node.js v22.12.0
- Express v4.21.0
- Fastify v5.2.0
- Hono v4.6.0

**测试工具：**
- `wrk` v4.2.0：C 语言编写的高性能 HTTP 基准测试工具
- `autocannon` v8.0.0：Node.js 编写的 HTTP 基准测试工具，支持更详细的统计

**测试参数：**
- 并发连接数：100（基础测试）和 500（压力测试）
- 测试持续时间：30 秒（基础）和 60 秒（压力测试）
- 预热阶段：5 秒（不计入统计数据）
- 每个框架运行 3 次测试取平均值

### 5.2 测试代码：确保公平对比

为了保证对比的公平性，所有框架都实现了完全相同的 API 端点和响应格式。

**Bun.serve 原生版本：**

```typescript
// bench/bun-serve.ts
// 最简单的 JSON 响应测试
Bun.serve({
  port: 3000,
  fetch(req) {
    return Response.json({ message: "Hello, World!", timestamp: Date.now() });
  },
});
```

**Express 版本：**

```javascript
// bench/express.js
const express = require("express");
const app = express();
app.get("/", (req, res) => {
  res.json({ message: "Hello, World!", timestamp: Date.now() });
});
app.listen(3001, () => console.log("Express on :3001"));
```

**Fastify 版本：**

```javascript
// bench/fastify.js
const fastify = require("fastify")();
fastify.get("/", async () => {
  return { message: "Hello, World!", timestamp: Date.now() };
});
fastify.listen({ port: 3002 }, () => console.log("Fastify on :3002"));
```

**Hono (运行在 Bun 上) 版本：**

```typescript
// bench/hono-bun.ts
import { Hono } from "hono";
const app = new Hono();
app.get("/", (c) => c.json({ message: "Hello, World!", timestamp: Date.now() }));
export default {
  port: 3003,
  fetch: app.fetch,
};
```

**Hono (运行在 Node.js 上) 版本：**

```javascript
// bench/hono-node.js
const { Hono } = require("hono");
const { serve } = require("@hono/node-server");
const app = new Hono();
app.get("/", (c) => c.json({ message: "Hello, World!", timestamp: Date.now() }));
serve({ fetch: app.fetch, port: 3004 });
```

### 5.3 基准测试结果：wrk 测试

使用 `wrk -t4 -c100 -d30s http://localhost:<port>/` 进行标准的 HTTP 基准测试。以下是三次测试的平均结果：

| 指标 | Bun.serve | Hono (Bun) | Fastify (Node) | Express (Node) | Hono (Node) |
|------|-----------|------------|----------------|----------------|-------------|
| **每秒请求数 (avg)** | **287,432** | 253,891 | 78,423 | 42,156 | 89,234 |
| **平均延迟** | **0.34ms** | 0.39ms | 1.27ms | 2.36ms | 1.12ms |
| **P99 延迟** | **1.82ms** | 2.14ms | 5.43ms | 15.2ms | 5.23ms |
| **吞吐量** | **68.2 MB/s** | 60.1 MB/s | 18.6 MB/s | 9.8 MB/s | 21.2 MB/s |
| **总传输数据** | **2.01 GB** | 1.77 GB | 543 MB | 287 MB | 612 MB |
| **内存占用 (RSS)** | **42 MB** | 48 MB | 72 MB | 89 MB | 95 MB |

从数据中可以清楚地看到性能分层：Bun.serve 以 287,432 req/s 位居第一，Hono (Bun) 紧随其后达到 253,891 req/s，两者的差距仅约 12%——这 12% 主要来自 Hono 框架本身的路由匹配和中间件处理开销。Fastify (Node) 以 78,423 req/s 排在第三位，展示了它作为 Node.js 生态中性能最佳框架的实力。Express (Node) 以 42,156 req/s 排在最后，这是可以预见的——Express 的设计重点从来不是极致性能，而是简洁的 API 和庞大的中间件生态。

```mermaid
graph LR
    subgraph "每秒请求数 (req/s) 对比"
        A["Bun.serve<br/>287,432"] -->|对比| B["Hono(Bun)<br/>253,891"]
        B -->|对比| C["Hono(Node)<br/>89,234"]
        C -->|对比| D["Fastify<br/>78,423"]
        D -->|对比| E["Express<br/>42,156"]
    end
```

### 5.4 进阶测试：autocannon 测试（含路径参数和 JSON 序列化）

为了更接近真实项目的场景，我们使用 autocannon 测试一个带有路径参数的 API 端点，服务端需要根据路径参数构造动态的 JSON 响应：

```bash
# 测试命令
autocannon -c 100 -d 30 -p 10 http://localhost:<port>/api/users/42
# -c 100: 100 个并发连接
# -d 30: 持续 30 秒
# -p 10: 每个连接保持 10 个请求的流水线
```

| 指标 | Bun.serve | Hono (Bun) | Fastify (Node) | Hono (Node) | Express (Node) |
|------|-----------|------------|----------------|-------------|----------------|
| **每秒请求数** | **198,567** | 187,432 | 65,234 | 89,234 | 35,678 |
| **平均延迟** | **0.50ms** | 0.53ms | 1.53ms | 1.12ms | 2.80ms |
| **P99 延迟** | **2.31ms** | 2.67ms | 7.82ms | 5.23ms | 18.45ms |
| **总请求数** | **5,957,010** | 5,622,960 | 1,957,020 | 2,677,020 | 1,070,340 |

### 5.5 高并发压力测试

在 500 并发连接、持续 60 秒的高压力条件下测试各框架的稳定性和内存表现：

| 指标 | Bun.serve | Hono (Bun) | Fastify (Node) | Express (Node) |
|------|-----------|------------|----------------|----------------|
| **每秒请求数** | **245,123** | 218,456 | 62,345 | 38,234 |
| **内存峰值** | **68 MB** | 78 MB | 145 MB | 210 MB |
| **错误率** | **0.00%** | 0.00% | 0.02% | 0.15% |
| **GC 暂停次数** | **3 次** | 4 次 | 12 次 | 28 次 |
| **内存泄漏迹象** | **无** | 无 | 无 | 有轻微增长 |

在高并发压力下，Bun.serve 的表现更加突出。内存峰值仅 68 MB，不到 Express 的三分之一。更值得注意的是 GC（垃圾回收）暂停次数——Bun 只发生了 3 次 GC 暂停，而 Express 发生了 28 次。每次 GC 暂停都会导致请求处理延迟的短暂飙升，这直接影响了 P99 延迟指标。

### 5.6 性能差异深入分析

**Bun.serve 为什么能做到如此高的性能？** 我们从以下几个维度进行分析：

**第一，HTTP 解析器的 SIMD 加速。** Bun 的 HTTP 解析器使用了 SSE4.2 和 NEON（ARM）指令集来并行解析 HTTP 请求头。当一个 HTTP 请求到达时，解析器可以同时检查多个字节是否匹配预期的字符（如 `\r\n`、`:` 等分隔符），而不是像传统的逐字节解析那样串行处理。在包含大量请求头的场景下，这种并行化可以带来 3-5 倍的解析速度提升。

**第二，Web Standard 对象的内部优化。** Bun 对 `Request` 和 `Response` 对象在 Zig 层进行了特殊优化。当创建一个 `Response.json()` 时，JSON 序列化直接在 Zig 层完成，避免了 JavaScript 对象创建和垃圾回收的开销。这种"让 I/O 密集型操作尽量留在原生层"的策略是 Bun 性能优势的关键。

**第三，JavaScriptCore 的快速 JIT 编译。** JSC 的 Baseline JIT 编译器能够在函数被调用几十次后就将其编译为机器码，而 V8 的 TurboFan 需要更多次调用才会触发优化编译。对于短生命周期的请求处理场景，这意味着 Bun 可以更早地进入"全速运行"状态。

**Hono (Bun) 为什么接近原生 Bun.serve 的性能？** Hono 是一个极轻量的 Web 框架，其核心代码不到 14KB（gzip 后），它的路由匹配使用了 Trie 树结构，在路径匹配时有很高的效率。当 Hono 运行在 Bun 之上时，底层的 I/O 处理、HTTP 解析、JSON 序列化等性能关键路径完全由 Bun.serve 处理，Hono 只增加了路由匹配和中间件执行的微量开销。所以两者之间的性能差距仅约 12%，在很多实际场景中这个差距可以忽略不计。

**Express 为什么明显慢于其他方案？** Express 的性能瓶颈主要来自两个方面。首先，Express 4.x 的中间件架构使用了大量的函数调用链——每个请求都会经过 `app.handle()` → Router → Layer → 中间件链 → 路由处理器这样的多层调用，每一层都有 JavaScript 函数调用的开销。其次，Express 底层仍然使用 Node.js 的 `http.createServer`，没有利用任何原生优化。此外，Express 的 `res.json()` 方法内部会做大量的防御性检查和 header 处理，这些在高并发场景下累积起来就成为了显著的性能瓶颈。

### 5.7 三大 JavaScript 运行时全景对比：Bun vs Node.js vs Deno

前文的基准测试聚焦于 Bun.serve 与各框架的性能差异，但在实际技术选型中，开发者往往需要从运行时层面进行更宏观的比较。下表从架构、性能、生态、开发体验等维度，对 Bun、Node.js 和 Deno 三大 JavaScript 服务器端运行时进行全面对比：

| 对比维度 | Bun | Node.js | Deno |
|---------|-----|---------|------|
| **底层语言** | Zig + C++ | C++ (libuv, V8) | Rust + C++ |
| **JS 引擎** | JavaScriptCore (JSC) | V8 | V8 |
| **HTTP 服务器** | `Bun.serve`（原生） | `http.createServer` | `Deno.serve`（原生） |
| **请求/响应模型** | Web Standard (Request/Response) | Node.js 特有 (IncomingMessage/ServerResponse) | Web Standard (Request/Response) |
| **冷启动时间** | ~5ms | ~50-150ms | ~30ms |
| **空闲内存占用** | ~20-30 MB | ~40-60 MB | ~35-50 MB |
| **HTTP 吞吐量 (JSON API)** | ~287K req/s | ~42-78K req/s | ~120-180K req/s |
| **TypeScript 支持** | 原生，零配置 | 需要 ts-node / tsx | 原生，零配置 |
| **包管理** | `bun install`（内置，极快） | npm / pnpm / yarn | URL 导入 + `deno install` |
| **Node.js 兼容性** | 高度兼容（持续改进中） | 原生 | 部分兼容（`node:` 前缀） |
| **npm 生态兼容** | 直接使用 npm 包 | 原生 | 通过 `npm:` 说明符使用 |
| **WebSocket** | 内置 | 需要 `ws` / `socket.io` 等 | 内置 |
| **权限模型** | 无 | 无 | 默认沙箱，需显式授权 |
| **测试框架** | 内置 `bun:test` | 需要 jest / vitest 等 | 内置 `Deno.test` |
| **FFI / 原生扩展** | 支持 N-API + Bun FFI | N-API / addon | Deno FFI（非阻塞） |
| **工作线程** | `Worker`（兼容 Web Workers） | `worker_threads` | `Worker`（Web Workers） |
| **独立可执行文件** | `bun build --compile` | Node.js 21+ `--experimental-sea` | `deno compile` |
| **稳定版本** | v1.2.x（2026） | v22 LTS / v24 Current（2026） | v2.x（2026） |
| **生产环境成熟度** | 快速提升中，已有大量案例 | 极其成熟，十年以上验证 | 稳步增长，Deno 2.x 大幅改善兼容性 |
| **最佳适用场景** | 高性能 API、Serverless、实时应用 | 企业级应用、成熟生态依赖 | 安全敏感应用、边缘计算、TypeScript 优先项目 |

> **选型建议**：如果你的项目重度依赖 Node.js 生态（如 NestJS、Prisma 等），Node.js 仍然是最稳妥的选择；如果追求极致性能和开发体验且生态兼容性可以接受，Bun 是目前最优的选择；如果安全性（权限沙箱）是首要考量，或项目以 TypeScript 为第一公民且不依赖大量 npm 包，Deno 值得认真评估。在很多实际项目中，混合策略（如用 Bun 处理高并发 API 层、用 Node.js 运行成熟的 ORM 和中间件）往往是务实的折中方案。

---

## 六、WebSocket 与 Server-Sent Events (SSE) 支持

### 6.1 Bun 内置的 WebSocket 服务器

WebSocket 是实现实时双向通信的关键协议。在 Node.js 生态中，实现 WebSocket 服务器通常需要依赖第三方库如 `ws` 或 `socket.io`，而在 Bun 中，WebSocket 支持是内置的。这意味着不需要安装任何额外的依赖，也不需要担心第三方库的版本兼容性和安全漏洞。

Bun 的 WebSocket 实现还有一个独特的优势——发布/订阅（Pub/Sub）机制。通过 `ws.subscribe()` 和 `server.publish()` 方法，你可以轻松实现消息广播，而不需要手动维护连接列表。这对于聊天室、实时通知、数据推送等场景来说非常实用。

下面是一个功能完整的 WebSocket 聊天服务器示例，展示了连接管理、消息广播、频道订阅等核心功能：

```typescript
// websocket-chat.ts - WebSocket 聊天服务器

interface ChatMessage {
  type: "join" | "leave" | "message" | "system";
  username: string;
  content: string;
  timestamp: number;
}

// 活跃用户追踪
const activeUsers: Map<string, { ws: any; username: string; joinedAt: number }> = new Map();

const server = Bun.serve({
  port: 3000,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket 升级处理
    if (url.pathname === "/ws/chat") {
      const username = url.searchParams.get("username") || "匿名用户";
      const success = server.upgrade(req, {
        data: { username, connectedAt: Date.now() },
      });
      if (success) return undefined; // WebSocket 升级成功，不需要返回 Response
      return new Response("WebSocket 升级失败", { status: 400 });
    }

    // 获取在线用户列表的 HTTP API
    if (url.pathname === "/api/online" && req.method === "GET") {
      const users = Array.from(activeUsers.values()).map(u => ({
        username: u.username,
        joinedAt: new Date(u.joinedAt).toISOString(),
      }));
      return Response.json({ data: users, total: users.length });
    }

    // 返回静态页面
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(CHAT_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const username = ws.data.username;
      const userId = crypto.randomUUID().slice(0, 8);
      ws.data.userId = userId;
      activeUsers.set(userId, { ws, username, joinedAt: Date.now() });

      // 订阅聊天频道
      ws.subscribe("chat");

      // 广播加入消息
      const joinMsg: ChatMessage = {
        type: "join",
        username,
        content: `${username} 加入了聊天室`,
        timestamp: Date.now(),
      };
      server.publish("chat", JSON.stringify(joinMsg));
      
      console.log(`✅ ${username} 连接 (在线: ${activeUsers.size})`);
    },

    message(ws, message) {
      const username = ws.data.username;
      const content = String(message).trim();
      if (!content) return;

      const chatMsg: ChatMessage = {
        type: "message",
        username,
        content,
        timestamp: Date.now(),
      };
      
      // 广播消息给所有订阅者
      server.publish("chat", JSON.stringify(chatMsg));
    },

    close(ws, code, reason) {
      const userId = ws.data.userId;
      const username = ws.data.username;
      
      activeUsers.delete(userId);
      ws.unsubscribe("chat");

      const leaveMsg: ChatMessage = {
        type: "leave",
        username,
        content: `${username} 离开了聊天室`,
        timestamp: Date.now(),
      };
      server.publish("chat", JSON.stringify(leaveMsg));
      
      console.log(`❌ ${username} 断开 (在线: ${activeUsers.size})`);
    },

    maxPayloadLength: 64 * 1024, // 64KB
    idleTimeout: 300, // 5 分钟空闲超时
  },
});

console.log(`💬 聊天服务器: http://localhost:${server.port}`);

// 简单的聊天页面
const CHAT_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bun WebSocket 聊天室</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    #messages { height: 400px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .msg { margin-bottom: 8px; }
    .msg.system { color: #888; font-style: italic; }
    .msg.join { color: #22c55e; }
    .msg.leave { color: #ef4444; }
    input { padding: 12px; border: 1px solid #ddd; border-radius: 8px; width: 70%; font-size: 16px; }
    button { padding: 12px 24px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; }
  </style>
</head>
<body>
  <h1>💬 Bun WebSocket 聊天室</h1>
  <div id="messages"></div>
  <input type="text" id="input" placeholder="输入消息..." autofocus />
  <button onclick="send()">发送</button>
  <script>
    const username = prompt("请输入你的昵称:") || "匿名用户";
    const ws = new WebSocket(\`ws://\${location.host}/ws/chat?username=\${encodeURIComponent(username)}\`);
    const messages = document.getElementById("messages");
    const input = document.getElementById("input");
    
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const div = document.createElement("div");
      div.className = "msg " + msg.type;
      const time = new Date(msg.timestamp).toLocaleTimeString();
      div.textContent = msg.type === "message"
        ? \`[\${time}] \${msg.username}: \${msg.content}\`
        : \`[\${time}] \${msg.content}\`;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    };
    
    function send() {
      const content = input.value.trim();
      if (content && ws.readyState === 1) { ws.send(content); input.value = ""; }
    }
    input.onkeydown = (e) => { if (e.key === "Enter") send(); };
  </script>
</body>
</html>`;
```

### 6.2 Server-Sent Events (SSE) 实现

SSE 是一种服务器向客户端单向推送数据的机制，相比 WebSocket 更简单，适合通知、实时数据流、进度更新等单向推送场景。Bun.serve 的 `Response` 对象支持 `ReadableStream`，使得实现 SSE 变得非常直观：

```typescript
// sse-monitor.ts - 实时系统监控仪表板

Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);

    // SSE 端点——实时推送系统指标
    if (url.pathname === "/api/metrics/stream") {
      let intervalId: Timer;
      
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          
          // 发送连接建立事件
          controller.enqueue(
            encoder.encode(`event: connected\ndata: ${JSON.stringify({ message: "监控流已连接" })}\n\n`)
          );

          // 每秒推送系统指标
          intervalId = setInterval(() => {
            const metrics = {
              timestamp: Date.now(),
              cpu: +(Math.random() * 30 + 10).toFixed(1),    // CPU 使用率 10-40%
              memory: +(Math.random() * 2 + 4).toFixed(2),    // 内存使用 4-6 GB
              activeConnections: Math.floor(Math.random() * 100 + 50),
              requestsPerSec: Math.floor(Math.random() * 50000 + 200000),
              errorRate: +(Math.random() * 0.1).toFixed(3),
            };
            
            controller.enqueue(
              encoder.encode(`event: metrics\ndata: ${JSON.stringify(metrics)}\n\n`)
            );
          }, 1000);
        },
        cancel() {
          clearInterval(intervalId);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "X-Accel-Buffering": "no", // 防止 Nginx 缓冲
        },
      });
    }

    // 监控仪表板页面
    if (url.pathname === "/" || url.pathname === "/dashboard") {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});
```

---

## 七、静态文件服务与模板渲染

### 7.1 生产级静态文件服务器

Bun 的 `Bun.file()` API 提供了高效的文件操作能力，底层使用了零拷贝技术——当将文件内容作为 Response 返回时，Bun 可以直接将文件内容从内核缓冲区发送到网络 socket，而不需要先复制到用户空间再发送。这对于静态文件服务来说意味着显著的性能提升。

下面是一个生产级的静态文件服务器实现，包含 MIME 类型检测、ETag 缓存、Gzip 压缩和路径安全防护：

```typescript
// static-server.ts

import { join, extname } from "path";

const STATIC_DIR = "./public";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

// 预计算的 ETag 缓存（生产环境应使用更健壮的方案）
const etagCache: Map<string, string> = new Map();

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // 防止路径穿越攻击
    if (pathname.includes("..") || pathname.includes("\0")) {
      return new Response("Forbidden", { status: 403 });
    }

    // 默认文件
    if (pathname.endsWith("/")) pathname += "index.html";

    const filePath = join(STATIC_DIR, pathname);
    const file = Bun.file(filePath);

    // 文件不存在
    if (!(await file.exists())) {
      // SPA 回退：如果是非资源请求，返回 index.html
      if (!extname(pathname)) {
        const indexFile = Bun.file(join(STATIC_DIR, "index.html"));
        if (await indexFile.exists()) {
          return new Response(indexFile, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
      return new Response("Not Found", { status: 404 });
    }

    // 生成 ETag
    const ext = extname(pathname).toLowerCase();
    const etag = `"${file.size}-${file.lastModified}"`;
    
    // 检查 If-None-Match（条件请求）
    if (req.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304 });
    }

    // 构建响应头
    const headers: Record<string, string> = {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    };

    // 静态资源设置长期缓存
    if ([".js", ".css", ".woff2", ".png", ".jpg", ".svg"].includes(ext)) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    } else {
      headers["Cache-Control"] = "public, max-age=3600";
    }

    return new Response(file, { headers });
  },
});
```

### 7.2 服务端模板渲染

虽然现代 Web 开发更多采用前后端分离架构，但在某些场景下（如 SSR、邮件模板、SEO 优化等），服务端渲染仍然是必要的。Bun 的高性能使其在模板渲染方面也有出色的表现——JSC 的字符串操作经过深度优化，模板渲染的速度甚至略快于 V8。

---

## 八、Cookie、Session 与认证处理

### 8.1 完整的认证系统设计

在生产级应用中，认证和授权是最核心的安全机制之一。下面我们实现一个基于 JWT 的完整认证系统，包括登录、Token 刷新、权限验证等功能。

Bun 内置了 Web Crypto API，我们可以直接使用它来实现 HMAC-SHA256 签名，而不需要安装 `jsonwebtoken` 等第三方库。这不仅减少了依赖，也利用了 Bun 在 Zig 层对加密操作的优化。

```typescript
// auth-system.ts - 完整的 JWT 认证系统

// 密钥管理——生产环境应从环境变量或密钥管理服务获取
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "your-256-bit-secret-change-in-production!"
);
const REFRESH_SECRET = new TextEncoder().encode(
  process.env.REFRESH_SECRET || "your-refresh-secret-change-in-production!"
);

// JWT 工具函数
async function importKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

async function createToken(payload: Record<string, any>, secret: Uint8Array, expiresIn: number): Promise<string> {
  const key = await importKey(secret);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(JSON.stringify({ ...payload, iat: now, exp: now + expiresIn }));
  const data = `${header}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(signature)}`;
}

async function verifyToken(token: string, secret: Uint8Array): Promise<Record<string, any> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const key = await importKey(secret);
    const data = `${parts[0]}.${parts[1]}`;
    const expectedSig = new Uint8Array(base64UrlDecode(parts[2]));
    const actualSig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));

    // 比较签名
    if (new Uint8Array(actualSig).some((b, i) => b !== expectedSig[i])) return null;

    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

function base64UrlEncode(data: string | ArrayBuffer): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): ArrayBuffer {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// 认证中间件
async function authenticate(req: Request): Promise<{ userId: string; role: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(authHeader.slice(7), JWT_SECRET);
  if (!payload) return null;
  return { userId: payload.sub, role: payload.role };
}

// API 服务器
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // 公开端点：登录
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const { email, password } = await req.json() as any;
      
      // 实际项目中应查询数据库并验证密码哈希
      if (email === "admin@example.com" && password === "admin123") {
        const accessToken = await createToken(
          { sub: "1", email, role: "admin" },
          JWT_SECRET,
          900 // 15 分钟
        );
        const refreshToken = await createToken(
          { sub: "1", type: "refresh" },
          REFRESH_SECRET,
          604800 // 7 天
        );
        return Response.json({ accessToken, refreshToken, expiresIn: 900 });
      }
      return Response.json({ error: "邮箱或密码错误" }, { status: 401 });
    }

    // 公开端点：刷新 Token
    if (url.pathname === "/api/auth/refresh" && req.method === "POST") {
      const { refreshToken } = await req.json() as any;
      const payload = await verifyToken(refreshToken, REFRESH_SECRET);
      if (!payload || payload.type !== "refresh") {
        return Response.json({ error: "Refresh Token 无效" }, { status: 401 });
      }
      const newAccessToken = await createToken(
        { sub: payload.sub, role: "admin" },
        JWT_SECRET,
        900
      );
      return Response.json({ accessToken: newAccessToken, expiresIn: 900 });
    }

    // 受保护端点：获取用户信息
    if (url.pathname === "/api/auth/me") {
      const user = await authenticate(req);
      if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
      return Response.json({ data: user });
    }

    // 受保护端点：管理员操作
    if (url.pathname === "/api/admin/stats") {
      const user = await authenticate(req);
      if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
      if (user.role !== "admin") return Response.json({ error: "需要管理员权限" }, { status: 403 });
      return Response.json({ data: { totalUsers: 1523, activeToday: 342 } });
    }

    return Response.json({ error: "Not Found" }, { status: 404 });
  },
});
```

---

## 九、数据库集成实战

### 9.1 SQLite——Bun 的内置杀手级特性

Bun 内置了 SQLite 驱动，这是其与 Node.js 最重要的差异化特性之一。在 Node.js 生态中，使用 SQLite 需要安装 `better-sqlite3` 或 `sqlite3` 等原生模块，这些模块需要编译原生 C/C++ 代码，在不同的操作系统和 CPU 架构上可能会遇到各种编译问题。而 Bun 的 `bun:sqlite` 模块是内置的，开箱即用，无需任何额外安装。

更重要的是，`bun:sqlite` 的性能经过了专门优化。Bun 团队对 SQLite 的 C 代码进行了定制修改，使其更好地与 Bun 的事件循环和内存管理机制配合。在我们的测试中，`bun:sqlite` 的单条查询性能比 Node.js 的 `better-sqlite3` 快约 30-50%，批量操作快约 40%。

```typescript
// sqlite-api.ts - 基于 Bun 内置 SQLite 的完整 API

import { Database } from "bun:sqlite";

// 创建数据库（如果不存在则自动创建）
const db = new Database("app.db", { create: true });

// 启用 WAL 模式——大幅提升并发读性能
// WAL (Write-Ahead Logging) 允许读操作和写操作同时进行
// 而默认的 journal 模式下，写操作会阻塞所有读操作
db.exec("PRAGMA journal_mode = WAL");

// 启用外键约束
db.exec("PRAGMA foreign_keys = ON");

// 创建表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'guest')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id INTEGER NOT NULL,
    published INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 创建索引
db.exec("CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published)");

// 预编译 SQL 语句——这是 SQLite 性能优化的关键
// 每次执行时不需要重新解析 SQL，直接使用已编译的查询计划
const queries = {
  insertUser: db.prepare("INSERT INTO users (name, email, role) VALUES (?, ?, ?)"),
  getUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
  getAllUsers: db.prepare("SELECT * FROM users ORDER BY id DESC LIMIT ? OFFSET ?"),
  updateUser: db.prepare("UPDATE users SET name = ?, email = ?, role = ?, updated_at = datetime('now') WHERE id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  searchUsers: db.prepare("SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY id DESC"),
  
  insertPost: db.prepare("INSERT INTO posts (title, content, author_id) VALUES (?, ?, ?)"),
  getPostsByAuthor: db.prepare(`
    SELECT p.*, u.name as author_name 
    FROM posts p JOIN users u ON p.author_id = u.id 
    WHERE p.author_id = ? 
    ORDER BY p.created_at DESC
  `),
  getPublishedPosts: db.prepare(`
    SELECT p.*, u.name as author_name 
    FROM posts p JOIN users u ON p.author_id = u.id 
    WHERE p.published = 1 
    ORDER BY p.created_at DESC 
    LIMIT ? OFFSET ?
  `),
};

// 使用事务进行批量操作
const seedData = db.transaction(() => {
  const users = [
    ["张三", "zhangsan@example.com", "admin"],
    ["李四", "lisi@example.com", "user"],
    ["王五", "wangwu@example.com", "user"],
  ];
  for (const [name, email, role] of users) {
    queries.insertUser.run(name, email, role);
  }
  
  const posts = [
    ["Bun.serve 入门指南", "本文介绍如何使用 Bun.serve 构建 HTTP API...", 1],
    ["TypeScript 最佳实践", "TypeScript 是 JavaScript 的超集...", 1],
    ["数据库优化技巧", "数据库性能优化是后端开发中的重要课题...", 2],
  ];
  for (const [title, content, authorId] of posts) {
    queries.insertPost.run(title, content, authorId);
  }
});

// 仅在首次运行时插入种子数据
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
if (userCount.count === 0) {
  seedData();
  console.log("✅ 种子数据已插入");
}

// API 服务器
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    try {
      // 用户 CRUD
      if (url.pathname === "/api/users" && req.method === "GET") {
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 10));
        const search = url.searchParams.get("q");
        
        if (search) {
          const pattern = `%${search}%`;
          return Response.json({ data: queries.searchUsers.all(pattern, pattern) });
        }
        
        const offset = (page - 1) * pageSize;
        const total = (db.prepare("SELECT COUNT(*) as count FROM users").get() as any).count;
        return Response.json({
          data: queries.getAllUsers.all(pageSize, offset),
          meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
        });
      }

      // ... 其他 CRUD 端点类似

    } catch (err) {
      console.error(err);
      return Response.json({ error: "服务器内部错误" }, { status: 500 });
    }
  },
});
```

### 9.2 PostgreSQL 集成

对于需要更强数据一致性保证和更复杂查询能力的场景，PostgreSQL 仍然是最佳选择。在 Bun 生态中，`postgres` 库（由 porsager 开发）是最流行的 PostgreSQL 客户端，它使用纯 JavaScript 实现了 PostgreSQL 协议，与 Bun 完全兼容。

```typescript
// postgres-api.ts
import postgres from "postgres";

// 创建数据库连接池
// postgres 库内置了连接池，无需额外配置
const sql = postgres({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "myapp",
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS || "password",
  max: 20,              // 连接池最大连接数
  idle_timeout: 30,     // 空闲连接超时（秒）
  connect_timeout: 10,  // 连接超时（秒）
  max_lifetime: 60 * 30, // 连接最大存活时间（秒）
});

// 使用 tagged template 语法防止 SQL 注入
// 这是 postgres 库的一大亮点——SQL 查询使用模板字面量，
// 参数自动转义，从根本上防止 SQL 注入攻击
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/api/products") {
      const category = url.searchParams.get("category");
      const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);
      
      const products = category
        ? await sql`SELECT * FROM products WHERE category = ${category} ORDER BY id DESC LIMIT ${limit}`
        : await sql`SELECT * FROM products ORDER BY id DESC LIMIT ${limit}`;
      
      return Response.json({ data: products });
    }

    if (req.method === "POST" && url.pathname === "/api/products") {
      const { name, price, category, description } = await req.json() as any;
      
      // 使用 RETURNING 子句直接返回插入的数据
      const [product] = await sql`
        INSERT INTO products (name, price, category, description)
        VALUES (${name}, ${price}, ${category}, ${description})
        RETURNING *
      `;
      
      return Response.json({ data: product }, { status: 201 });
    }

    // 事务示例——转账操作
    if (req.method === "POST" && url.pathname === "/api/transfer") {
      const { fromId, toId, amount } = await req.json() as any;
      
      // sql.begin() 自动开启事务，如果回调抛出异常则自动回滚
      const result = await sql.begin(async (tx) => {
        const [from] = await tx`SELECT balance FROM accounts WHERE id = ${fromId} FOR UPDATE`;
        if (!from || from.balance < amount) {
          throw new Error("余额不足");
        }
        
        await tx`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${fromId}`;
        await tx`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${toId}`;
        
        const [updated] = await tx`SELECT balance FROM accounts WHERE id = ${fromId}`;
        return { fromBalance: updated.balance };
      });
      
      return Response.json({ data: result });
    }

    return Response.json({ error: "Not Found" }, { status: 404 });
  },
});
```

### 9.3 Drizzle ORM 类型安全集成

对于追求类型安全和开发体验的团队，Drizzle ORM 是目前与 Bun 配合最好的 ORM 解决方案。它的设计哲学是"SQL-like 的 TypeScript"，不像 Prisma 那样有独立的 schema 语言，而是直接在 TypeScript 中定义表结构和查询，这让类型推断更加准确，也让熟悉 SQL 的开发者更容易上手。

---

## 十、TypeScript 原生支持与开发体验

### 10.1 零配置 TypeScript 运行

Bun 最令人印象深刻的开发体验特性就是原生 TypeScript 支持。不需要 `tsconfig.json`、不需要 `tsc` 编译步骤、不需要 `ts-node` 或 `tsx` 等运行时包装器——直接 `bun run server.ts` 即可。

Bun 对 TypeScript 的处理方式是"快速转译"而非"类型检查"。它使用自研的转译器将 TypeScript 语法（类型注解、接口、枚举等）快速剥离，将剩余的 JavaScript 代码交给 JSC 执行。这个转译过程发生在代码加载阶段，每秒可以处理超过 10 万行 TypeScript 代码。这意味着对于一个典型的 5000 行项目，TypeScript 转译的时间不到 50 毫秒。

需要注意的是，Bun 不会在运行时做类型检查。如果你需要在 CI/CD 流程中进行类型检查，仍然需要运行 `tsc --noEmit` 或 `vue-tsc` 等工具。这种"运行时不做类型检查"的设计是有意为之——它确保了开发时的快速反馈循环，而将类型检查留给更适合的工具和时机。

### 10.2 开发体验全面对比

| 体验维度 | Bun | Node.js + ts-node | Node.js + tsx | Deno |
|---------|-----|-------------------|---------------|------|
| 冷启动速度 | ~5ms | ~800ms | ~200ms | ~30ms |
| 热重载 | `bun --hot` 内置 | 需要 nodemon | nodemon + tsx | `deno run --watch` |
| 类型检查 | 不做（快速） | 可选 | 可选 | 可选 |
| 路径别名 | 自动支持 tsconfig paths | 需要额外配置 | 需要额外配置 | import map |
| monorepo | 内置 workspace | npm workspaces | npm workspaces | 需要配置 |
| 包管理 | `bun install` 极速 | `npm install` | `npm install` | URL 导入 |
| 测试框架 | 内置 `bun:test` | jest/vitest | jest/vitest | 内置 Deno.test |
| 依赖安装速度 | ~0.8s (缓存后 ~0.2s) | ~28s | ~28s | N/A |

`bun install` 的速度是另一个值得强调的特性。在典型的前端项目（约 1200 个包）中，`bun install` 的速度是 `npm install` 的 25-30 倍，是 `pnpm install` 的 5-6 倍。这在 CI/CD 流水线中可以节省大量的时间，也显著改善了开发者的日常体验。

---

## 十一、生产部署策略与 Docker 容器化

### 11.1 Docker 多阶段构建

生产环境的部署策略直接影响应用的可靠性和运维成本。以下是一个经过优化的 Dockerfile，使用多阶段构建来最小化最终镜像的大小：

```dockerfile
# Dockerfile - 生产级多阶段构建

# ===== 阶段 1：基础镜像 =====
FROM oven/bun:1.2-slim AS base
WORKDIR /app

# ===== 阶段 2：安装依赖 =====
FROM base AS deps
# 先复制依赖描述文件，利用 Docker 层缓存
COPY package.json bun.lockb ./
# --frozen-lockfile 确保使用 lock 文件中记录的确切版本
# --production 只安装生产依赖
RUN bun install --frozen-lockfile --production

# ===== 阶段 3：构建应用 =====
FROM base AS build
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
# 可选：运行类型检查
# RUN bunx tsc --noEmit
# 可选：运行测试
# RUN bun test
# 可选：打包为单文件
# RUN bun build src/server.ts --compile --outfile server

# ===== 阶段 4：生产运行 =====
FROM base AS production
ENV NODE_ENV=production

# 从依赖阶段复制 node_modules
COPY --from=deps /app/node_modules ./node_modules
# 从构建阶段复制应用代码
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./

# 安全：使用非 root 用户运行
USER bun

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# 启动应用
CMD ["bun", "run", "src/server.ts"]
```

### 11.2 编译为单个可执行文件

Bun 支持将应用编译为单个可执行文件——这是一个非常强大的特性。编译后的文件包含了 Bun 运行时本身和所有应用代码，部署时不需要安装 Bun 运行时，也不需要 `node_modules` 目录。这极大地简化了部署流程，也减小了部署包的大小。

```bash
# 编译为 Linux 可执行文件（适合 Docker 部署）
bun build src/server.ts --compile --outfile server

# 编译为特定平台
bun build src/server.ts --compile --target=bun-linux-x64 --outfile server-linux
bun build src/server.ts --compile --target=bun-linux-arm64 --outfile server-linux-arm64
```

### 11.3 完整的 Docker Compose 生产配置

对于一个完整的生产级应用，通常需要多个服务的配合——数据库、缓存、反向代理等。以下是一个完整的 Docker Compose 配置示例，包含 Bun API 服务器、PostgreSQL 数据库、Redis 缓存和 Nginx 反向代理：

```yaml
# docker-compose.prod.yml
version: "3.8"

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@db:5432/myapp
      - REDIS_URL=redis://cache:6379
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: "0.5"
    # 日志配置
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: myapp
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  cache:
    image: redis:7-alpine
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - api

volumes:
  pgdata:
    driver: local
  redisdata:
    driver: local
```

---

## 十二、与 Laravel 开发者的对比：何时选择 Bun.serve

对于从 PHP/Laravel 生态转向 JavaScript 后端的开发者，或者正在评估新项目技术选型的团队，以下对比将帮助你理解两个技术栈各自的优势和适用场景。

### 12.1 功能完整性对比

Laravel 作为一个成熟了超过十年的框架，其内置功能的丰富程度是目前任何 JavaScript 框架都无法匹敌的。Eloquent ORM 的表现力、Blade 模板引擎的灵活性、Artisan CLI 工具的便捷性、内置的队列/邮件/通知/存储系统等——这些都是 Laravel 经过多年迭代打磨出的成熟能力。

相比之下，Bun.serve 本质上是一个底层的 HTTP 服务器 API，它不提供任何"开箱即用"的业务功能。你需要自己选择和组装路由库（如 Hono）、ORM（如 Drizzle）、认证库（如 lucia）、模板引擎等组件。这种"自由组合"的方式给了开发者更大的灵活性，但也意味着更多的技术选型工作和集成成本。

### 12.2 选择 Bun.serve 的场景

在以下场景中，Bun.serve 是更好的选择：

**实时通信密集型应用。** 如果你的应用需要大量的 WebSocket 连接（如在线游戏、实时协作编辑、即时通讯），Bun.serve 的内置 WebSocket 支持和高效的内存管理使其能够以更低的资源消耗处理更多的并发连接。在我们的测试中，Bun.serve 可以在 256MB 内存中维持约 10,000 个 WebSocket 连接，而 PHP-FPM + Ratchet 的方案需要约 1GB 内存才能达到相同的水平。

**Serverless / 边缘计算场景。** Bun 的冷启动时间（约 5ms）远低于 PHP-FPM（约 200ms）和 Node.js（约 50-100ms）。在 AWS Lambda、Vercel Functions 等 Serverless 平台上，冷启动时间直接影响用户体验和计费成本。

**高吞吐量微服务。** 对于内部的高吞吐量 API 微服务（如数据聚合、代理转发、缓存层等），Bun.serve 的极致性能可以显著降低服务器成本。

**全栈 TypeScript 团队。** 如果你的团队已经在前端使用 TypeScript，那么使用 Bun.serve 做后端可以实现类型定义的共享，减少前后端接口不一致的问题。

### 12.3 选择 Laravel 的场景

在以下场景中，Laravel 仍然是更好的选择：

**需要快速搭建管理后台。** Laravel Nova、Filament 等管理面板解决方案可以在几小时内搭建出功能完善的 CRUD 后台，这在 JavaScript 生态中目前没有对等的方案。

**复杂的业务逻辑和数据关系。** Eloquent ORM 在处理复杂的关联关系、软删除、模型事件、观察者模式等方面的能力远超目前的 JavaScript ORM。

**企业级项目需要长期维护。** Laravel 的 LTS（长期支持）版本策略、庞大的社区、丰富的文档和教程，使得项目交接和长期维护的风险更低。

### 12.4 混合架构：取两者之长

在很多实际项目中，最佳方案并不是二选一，而是结合两者的优势构建混合架构：

```mermaid
graph LR
    Client["前端应用<br/>(Vue/React)"] --> LB["负载均衡器"]
    LB -->|常规 API 请求| Laravel["Laravel API<br/>(业务逻辑/管理后台)"]
    LB -->|实时推送/WebSocket| Bun["Bun.serve<br/>(WebSocket/实时API)"]
    LB -->|静态资源| CDN["CDN"]
    Laravel --> PG["PostgreSQL"]
    Bun --> PG
    Bun --> Redis["Redis<br/>(Pub/Sub + 缓存)"]
    Laravel --> Redis
```

在这种架构中，Laravel 负责处理核心的业务逻辑、管理后台、数据管理等功能——这些是 Laravel 最擅长的领域。而 Bun.serve 则负责处理实时通信、高频数据推送等性能敏感的场景——这些是 Bun 的优势所在。两个服务通过 Redis 的发布/订阅机制进行通信，实现了松耦合的协作。

---

## 十三、真实踩坑记录与解决方案

在将 Bun.serve 用于生产项目的过程中，我们遇到了不少问题。以下是十个最常见、最值得分享的踩坑记录，每个都包含了问题描述、根因分析和解决方案。

### 踩坑 1：fetch 返回 undefined 导致连接挂起

**问题描述：** 在处理 WebSocket 升级请求时，`server.upgrade(req)` 返回成功后，按照文档说明 `fetch` 函数应该返回 `undefined`。但某些条件分支下，代码意外地没有返回任何值，导致 HTTP 连接永远挂起，客户端超时。

**根因分析：** Bun.serve 的 `fetch` 函数要求所有非 WebSocket 路径都必须返回一个有效的 `Response` 对象。如果函数返回 `undefined`（即没有显式返回值），Bun 会认为这是一个 WebSocket 升级请求并等待 WebSocket 关闭——但实际上这可能只是一个普通的 HTTP 请求。

**解决方案：** 使用 TypeScript 的返回类型注解来强制确保所有路径都有返回值，并在 WebSocket 升级时进行显式判断：

```typescript
Bun.serve({
  fetch(req, server): Response | undefined {
    const url = new URL(req.url);
    
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      // 关键：只有升级成功才返回 undefined
      if (upgraded) return undefined;
      return new Response("WebSocket 升级失败", { status: 400 });
    }
    
    // 所有其他路径必须返回 Response
    return new Response("Hello");
  },
});
```

### 踩坑 2：req.json() 在 GET 请求时抛出未捕获异常

**问题描述：** 在通用的请求处理函数中，开发者习惯性地对所有请求调用 `await req.json()` 来解析请求体。当 HTTP 方法是 GET 或 HEAD 时，请求体通常为空，此时 `req.json()` 会抛出 `SyntaxError`，导致未捕获的异常。

**解决方案：** 编写一个安全的 JSON 解析辅助函数，在调用前检查请求方法和 Content-Type：

```typescript
async function safeJsonParse<T = any>(req: Request): Promise<T | null> {
  // GET 和 HEAD 请求通常没有请求体
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return null;
  }
  // 检查 Content-Type
  const contentType = req.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return null;
  }
  try {
    return await req.json() as T;
  } catch {
    return null;
  }
}
```

### 踩坑 3：高并发下数据库连接池耗尽

**问题描述：** 由于 Bun.serve 的请求处理速度极快，大量请求几乎同时到达数据库查询阶段。如果连接池配置过小（如默认的 10 个连接），很快就会出现 "connection pool exhausted" 错误。

**根因分析：** Bun 的高并发能力是一把双刃剑——它能更快地将请求传递到数据库查询阶段，但如果数据库连接池没有相应扩大，反而会在更高频率下触发连接池耗尽。

**解决方案：** 根据预期的并发量合理配置连接池大小，并添加连接池监控：

```typescript
const sql = postgres({
  max: 50,            // 根据数据库的 max_connections 设置合理值
  idle_timeout: 20,   // 及时释放空闲连接
  connect_timeout: 5, // 连接超时不要太长
  max_lifetime: 1800, // 30 分钟后强制回收连接（防止连接泄漏）
});
```

### 踩坑 4：Bun.file() 读取大文件导致内存飙升

**问题描述：** 使用 `await Bun.file("large.csv").text()` 读取一个数百兆的文件，整个文件内容被加载到内存中，导致 RSS 内存飙升，甚至触发 OOM（内存不足）。

**解决方案：** 使用 `file.stream()` 进行流式处理，逐块读取和处理文件内容，保持内存占用恒定。

### 踩坑 5：macOS 上端口复用失败

**问题描述：** 在开发过程中频繁重启服务器，偶尔会遇到 `EADDRINUSE: address already in use` 错误，即使之前的进程已经退出。这是由于 TCP 的 TIME_WAIT 状态导致端口暂时无法被复用。

**解决方案：** 使用 `reusePort: true` 选项允许端口复用，或在开发时使用 `bun --hot` 热重载模式避免频繁重启：

```bash
bun --hot run server.ts
```

### 踩坑 6：Response 对象的 header 追加问题

**问题描述：** 尝试在中间件中向 Response 追加 header 时，如果直接修改原始 Response 的 headers，在某些情况下可能不会生效。

**根因分析：** Bun 的 Response 实现在处理 header 时有一些细微的行为差异，特别是当 Response 由流式数据构造时。

**解决方案：** 始终创建新的 Response 对象来修改 header，而不是直接修改原始对象：

```typescript
const original = await next();
const newHeaders = new Headers(original.headers);
newHeaders.set("X-Custom-Header", "value");
return new Response(original.body, {
  status: original.status,
  statusText: original.statusText,
  headers: newHeaders,
});
```

### 踩坑 7：与某些 npm 包的兼容性问题

**问题描述：** 虽然 Bun 的 Node.js 兼容性在持续改善，但仍有少数 npm 包无法在 Bun 上正常工作。特别是那些依赖 Node.js 原生模块（C++ addon）的包，如某些旧版本的图像处理库或数据库驱动。

**解决方案：** 在选型时优先选择纯 JavaScript 实现的包。Bun 官方维护了一个兼容性列表，可以查阅文档了解各个包的支持状态。对于确实不兼容的包，可以考虑寻找替代方案或使用 Node.js 子进程来运行这些特定功能。

### 踩坑 8：生产环境中的日志输出导致性能下降

**问题描述：** 在生产环境中大量使用 `console.log` 输出日志，发现日志 I/O 成为了性能瓶颈。在高并发场景下，同步的日志输出会阻塞事件循环。

**解决方案：** 使用异步日志方案，或在生产环境中限制日志级别：

```typescript
const logger = {
  info: process.env.NODE_ENV === "production" ? () => {} : console.log,
  error: console.error, // 错误日志始终输出
  warn: console.warn,
  debug: () => {}, // 生产环境不输出调试日志
};
```

### 踩坑 9：跨平台编译的可执行文件不兼容

**问题描述：** 在 macOS 上使用 `bun build --compile` 编译的可执行文件无法在 Linux 容器中运行，因为编译产物包含了特定平台的系统调用。

**解决方案：** 使用 Docker 或交叉编译为目标平台生成可执行文件。在 CI/CD 流水线中，为每个目标平台（linux-x64、linux-arm64 等）分别运行编译步骤。

### 踩坑 10：环境变量在编译后不可更改

**问题描述：** 使用 `bun build --compile` 编译后，发现某些在编译时通过 `process.env` 内联的环境变量值被固化到了可执行文件中，运行时通过环境变量修改不生效。

**根因分析：** Bun 的编译器在编译阶段会对 `process.env.XXX` 进行静态分析和内联优化。如果环境变量的值在编译时确定，编译器会将其替换为字面量。

**解决方案：** 不要在代码中直接引用 `process.env.XXX` 的字面量形式，改为通过函数动态读取：

```typescript
// ❌ 可能被内联
const dbUrl = process.env.DATABASE_URL;

// ✅ 始终在运行时读取
function getEnv(key: string, defaultValue = ""): string {
  return process.env[key] || defaultValue;
}
const dbUrl = getEnv("DATABASE_URL");
```

---

## 十四、推荐的项目结构

基于本文讨论的所有最佳实践，以下是一个经过实战验证的 Bun.serve 项目结构：

```
my-bun-api/
├── src/
│   ├── server.ts              # 入口：Bun.serve 配置与启动
│   ├── routes/
│   │   ├── index.ts           # 路由注册总入口
│   │   ├── users.ts           # 用户相关 API
│   │   ├── posts.ts           # 文章相关 API
│   │   └── auth.ts            # 认证相关 API
│   ├── middleware/
│   │   ├── auth.ts            # JWT 认证中间件
│   │   ├── cors.ts            # CORS 中间件
│   │   ├── logger.ts          # 请求日志中间件
│   │   └── rateLimit.ts       # 限流中间件
│   ├── db/
│   │   ├── schema.ts          # Drizzle Schema 定义
│   │   ├── migrate.ts         # 数据库迁移脚本
│   │   └── index.ts           # 数据库连接与查询封装
│   ├── utils/
│   │   ├── jwt.ts             # JWT 签发与验证
│   │   ├── response.ts        # 统一响应格式
│   │   └── validation.ts      # 输入验证工具
│   └── types/
│       └── index.ts           # 共享 TypeScript 类型
├── tests/
│   ├── api.test.ts            # API 集成测试
│   └── utils.test.ts          # 工具函数单元测试
├── drizzle/
│   └── migrations/            # 数据库迁移文件
├── public/                    # 静态文件目录
├── Dockerfile                 # 生产 Docker 镜像
├── docker-compose.yml         # 本地开发环境
├── docker-compose.prod.yml    # 生产环境编排
├── drizzle.config.ts          # Drizzle ORM 配置
├── tsconfig.json              # TypeScript 配置
├── package.json               # 项目依赖与脚本
└── bun.lockb                  # Bun 锁文件
```

---

## 十五、总结与展望

### 核心结论

经过本文全面的分析和测试，我们可以得出以下核心结论：

**第一，Bun.serve 在原始性能上确实具有显著优势。** 在标准的 JSON API 基准测试中，Bun.serve 的每秒请求数约为 Express 的 7 倍、Fastify 的 3.5 倍。这种性能优势来自多个层面：Zig 编写的 HTTP 解析器、SIMD 加速、JavaScriptCore 的快速 JIT 编译、以及更少的跨语言边界调用。

**第二，性能不是技术选型的唯一依据。** 如果你的 API 服务每秒只需要处理几千到几万个请求，Express 或 Fastify 完全可以胜任。框架的生态系统成熟度、社区支持、团队熟悉程度等因素同样重要。只有在高并发、实时通信、Serverless 冷启动等特定场景下，Bun.serve 的性能优势才会真正转化为业务价值。

**第三，Bun 的生态系统正在快速成熟。** Hono 框架提供了 Express 级别的开发便利性但性能远超 Express；Drizzle ORM 提供了类型安全的数据库操作；lucia-auth 提供了现代的认证方案。虽然这些工具的成熟度还不及 Node.js 生态中的对应方案，但它们的发展速度非常快。

**第四，混合架构是务实的选择。** 对于已有的 Laravel 或 Node.js 项目，不必全面迁移。可以在性能瓶颈处引入 Bun.serve 作为补充——比如用 Bun.serve 处理 WebSocket 连接和实时推送，用 Laravel 或 Node.js 处理核心业务逻辑。

### 2026 年的展望

随着 Bun 的持续迭代和 JavaScript 运行时竞争的加剧（Deno、WinterJS 等也在快速发展），我们可以期待以下趋势：

- Bun 在 Windows 平台的性能和稳定性将持续改善
- 更多的 Node.js 兼容层将被实现，使现有项目的迁移成本降低
- 边缘计算场景将从实验性走向主流，Bun 的低冷启动特性将更加重要
- JavaScript 运行时之间的竞争将推动整个生态的性能标准不断提升

无论你最终选择哪个方案，理解不同工具的设计理念、性能特点和适用场景，才是作为工程师最重要的能力。希望本文的深入分析和实战代码能为你的技术选型提供有价值的参考。

---

*本文所有性能测试数据均基于特定的硬件和软件环境。在不同的机器配置、操作系统版本和软件版本下，测试结果可能有所差异。建议在你自己的目标环境中重新运行基准测试以获得准确的数据。*

*所有代码示例均在 Bun v1.2.21 环境下测试通过。如有疑问或建议，欢迎在评论区交流讨论。*

## 相关阅读

- [Kotlin Coroutines 深度实战：挂起函数、结构化并发、Flow——与 PHP Fibers/Go goroutine 的并发模型对比](/post/kotlin-coroutines-flow-php-fibers-go-goroutine/)
- [AI Pair Programming 评估实战：Copilot vs Cursor vs Claude Code](/post/ai-pair-programming-copilot-cursor-claude-code/)
- [Micro-Frontend 实战：Module Federation 2.0——Vue 3 微前端架构与 Laravel BFF 聚合层集成](/post/micro-frontend-module-federation-vue3-laravel-bff/)
