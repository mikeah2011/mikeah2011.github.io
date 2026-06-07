# tRPC：端到端类型安全 API

## 定义

tRPC 利用 TypeScript 类型推断实现端到端类型安全的 API 调用，无需代码生成、schema 定义或运行时开销。直接共享 TypeScript 类型而非代码，前端调用后端 API 如同调用本地函数，改了后端类型前端立刻报错。

## 核心原理

### 四大核心概念

| 概念 | 说明 |
|---|---|
| **Procedure** | 一个 API 端点，分为 Query（读）、Mutation（写）、Subscription（订阅） |
| **Router** | Procedure 的分组容器，支持嵌套和合并 |
| **Context** | 请求级共享对象（认证用户、数据库连接） |
| **Middleware** | Procedure 执行前的拦截器（鉴权、日志、限流） |

### 服务端定义

```typescript
import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.context<Context>().create()

const appRouter = t.router({
  // Query：读操作
  getUserById: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input, ctx }) => {
      return ctx.db.user.findUnique({ where: { id: input.id } })
    }),

  // Mutation：写操作
  createUser: t.procedure
    .input(z.object({
      name: z.string().min(1),
      email: z.string().email()
    }))
    .mutation(({ input }) => {
      return db.user.create({ data: input })
    }),

  // 嵌套路由
  post: t.router({
    list: t.procedure.query(() => db.post.findMany()),
    byId: t.procedure
      .input(z.string())
      .query(({ input }) => db.post.findUnique({ where: { id: input } }))
  })
})

// 导出类型（关键：前端只导入类型，不导入实现）
export type AppRouter = typeof appRouter
```

### 客户端调用

```typescript
import { createTRPCClient } from '@trpc/client'
import type { AppRouter } from '../server/router'

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: 'http://localhost:3000/api/trpc' })]
})

// 类型安全：改了后端字段名，这里立刻报错
const user = await client.getUserById.query({ id: '123' })
console.log(user.name)  // ✅ TypeScript 知道 user 的完整类型

const newPost = await client.post.list.query()  // ✅ 嵌套路由调用
```

### 对比传统方案

| 维度 | REST + OpenAPI | GraphQL | tRPC |
|---|---|---|---|
| 类型安全 | 需代码生成 | 需代码生成 | 原生推断 |
| 运行时开销 | 低 | 中（解析查询） | 极低 |
| 学习曲线 | 低 | 高 | 低 |
| 适用场景 | 任意前后端 | 多客户端聚合 | TypeScript 全栈 |
| 工具链 | Swagger/Postman | Apollo/Relay | 内置 |

## 实战案例

来自博客文章：
- [tRPC 实战：端到端类型安全的 API 层——TypeScript 全栈开发者告别 OpenAPI 代码生成的新范式](/2026/06/05/tRPC-实战-端到端类型安全API层-TypeScript全栈告别OpenAPI代码生成/)

## 相关概念

- [TanStack Query 服务端状态](TanStack-Query服务端状态.md) - tRPC 常与 TanStack Query 配合使用
- [React 状态管理选型](React状态管理选型.md) - 客户端状态与服务端状态的边界
- [Nuxt 4 全栈框架](Nuxt4全栈框架.md) - Vue 全栈方案对比

## 常见问题

### Q: tRPC 适合哪些项目？
TypeScript monorepo 全栈项目（Next.js + tRPC、T3 Stack）。不适合需要对外开放 API 的场景（此时 REST/GraphQL 更合适）。

### Q: 如何处理认证？
通过 Context 注入认证信息：

```typescript
const createContext = ({ req }: CreateContextOptions) => ({
  user: getUserFromToken(req.headers.authorization)
})

const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { user: ctx.user } })
})
```

### Q: 能和 Laravel 后端配合吗？
tRPC 专为 TypeScript 全栈设计，不直接支持 PHP 后端。Laravel 项目建议用 REST API + OpenAPI 代码生成实现类型安全。
