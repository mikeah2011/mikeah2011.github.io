---

title: tRPC 实战：端到端类型安全的 API 层——TypeScript 全栈开发者告别 OpenAPI 代码生成的新范式
keywords: [tRPC, API, TypeScript, OpenAPI, 端到端类型安全的, 全栈开发者告别, 代码生成的新范式]
date: 2026-06-03 08:00:00
tags:
- tRPC
- TypeScript
- 类型安全
- API
- React
- Zod
categories:
- frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
description: 深入解析 tRPC 框架核心原理与实战集成，涵盖 Procedure、Router、Context、Middleware 四大核心概念，对比 REST/OpenAPI/GraphQL 方案优劣，详解 Zod 输入验证、Next.js App Router 集成、WebSocket 订阅、错误处理与性能优化技巧，助你构建端到端类型安全的 TypeScript 全栈 API 层。
---



# tRPC 实战：端到端类型安全的 API 层——TypeScript 全栈开发者告别 OpenAPI 代码生成的新范式

## 前言

在现代全栈 TypeScript 开发中，前后端之间的 API 通信一直是一个令人头疼的问题。传统的 REST API 开发模式下，前端开发者需要手动维护接口文档、编写请求代码、处理类型转换，这些重复性工作不仅耗时，还极易引入类型不一致的 bug。为了解决这个问题，社区先后诞生了 GraphQL、OpenAPI（Swagger）+ 代码生成等方案，但它们都引入了额外的复杂性和工具链。

2022 年，由 Colin McDonnell（同时也是 Zod 的作者）创建的 **tRPC** 框架横空出世，提出了一个大胆的理念：**在 TypeScript monorepo 中，无需任何代码生成、无需 schema 定义、无需运行时开销，就能实现端到端的类型安全 API 调用**。tRPC 直接利用 TypeScript 的类型推断能力，在编译时自动推导出整个 API 层的类型，让前端调用后端 API 就像调用本地函数一样自然。

本文将从核心概念、架构设计、与传统方案对比、实战集成等多个维度，深入剖析 tRPC 的方方面面，帮助你全面掌握这一革命性的 API 开发范式。

---

## 一、tRPC 核心概念详解

tRPC 的设计哲学可以用一句话概括：**共享 TypeScript 类型，而非共享代码**。它通过四个核心构建块——Router、Procedure、Context 和 Middleware——构成了一套完整的 API 开发体系。

### 1.1 Procedure（过程/端点）

Procedure 是 tRPC 中最基本的概念，相当于 REST API 中的一个端点（endpoint）。每个 Procedure 代表一个可被远程调用的操作，tRPC 提供了三种类型的 Procedure：

**Query（查询）**：对应 HTTP GET 请求，用于获取数据，具有幂等性，可被缓存。

```typescript
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

const appRouter = t.router({
  // 定义一个查询过程
  getUserById: t.procedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => {
      return db.user.findUnique({ where: { id: input.id } });
    }),

  // 不需要输入参数的查询
  listUsers: t.procedure
    .query(() => {
      return db.user.findMany();
    }),
});
```

**Mutation（变更）**：对应 HTTP POST/PUT/DELETE 请求，用于修改数据。

```typescript
const appRouter = t.router({
  createUser: t.procedure
    .input(z.object({
      name: z.string().min(1).max(100),
      email: z.string().email(),
      role: z.enum(['admin', 'user', 'moderator']),
    }))
    .mutation(({ input }) => {
      return db.user.create({ data: input });
    }),

  deleteUser: t.procedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.user.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
```

**Subscription（订阅）**：对应 WebSocket 连接，用于实时数据推送（稍后详解）。

### 1.2 Router（路由器）

Router 是 Procedure 的集合，用于组织和管理 API 结构。tRPC 的 Router 系统支持嵌套和合并，可以构建出清晰的 API 层级结构。

```typescript
// 用户相关路由
const userRouter = t.router({
  getById: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => db.user.findUnique({ where: { id: input.id } })),

  list: t.procedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().min(1).max(100).default(20),
      search: z.string().optional(),
    }))
    .query(({ input }) => {
      return db.user.findMany({
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        where: input.search
          ? { name: { contains: input.search } }
          : undefined,
      });
    }),

  update: t.procedure
    .input(z.object({
      id: z.string().uuid(),
      data: z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
      }),
    }))
    .mutation(({ input }) => {
      return db.user.update({
        where: { id: input.id },
        data: input.data,
      });
    }),
});

// 帖子相关路由
const postRouter = t.router({
  create: t.procedure
    .input(z.object({
      title: z.string().min(1).max(200),
      content: z.string(),
      authorId: z.string().uuid(),
    }))
    .mutation(({ input }) => db.post.create({ data: input })),

  byAuthor: t.procedure
    .input(z.object({ authorId: z.string().uuid() }))
    .query(({ input }) => {
      return db.post.findMany({
        where: { authorId: input.authorId },
        include: { author: true },
        orderBy: { createdAt: 'desc' },
      });
    }),
});

// 根路由——组合所有子路由
const appRouter = t.router({
  user: userRouter,
  post: postRouter,
});

// 导出类型，供客户端使用
export type AppRouter = typeof appRouter;
```

这种嵌套路由的设计使得 API 结构清晰直观，在客户端调用时也保持了相同的层级关系：`client.user.getById.query({ id: '...' })`、`client.post.create.mutate({ ... })`。

### 1.3 Context（上下文）

Context 是每个 Procedure 调用时都会接收到的共享对象，通常用于存储请求级别的信息，如认证用户、数据库连接、请求元数据等。

```typescript
import { inferAsyncReturnType, initTRPC, TRPCError } from '@trpc/server';
import { CreateHTTPContextOptions } from '@trpc/server/adapters/standalone';
import { CreateWSSContextFnOptions } from '@trpc/server/adapters/ws';
import jwt from 'jsonwebtoken';

// Context 创建函数
interface User {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'moderator';
}

interface Context {
  user: User | null;
  db: typeof db;
  req: Request;
  sessionId?: string;
}

export async function createContext(
  opts: CreateHTTPContextOptions
): Promise<Context> {
  // 从请求头中提取 token
  const token = opts.req.headers.authorization?.replace('Bearer ', '');
  let user: User | null = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as User;
      user = await db.user.findUnique({ where: { id: decoded.id } });
    } catch (error) {
      // token 无效，user 保持 null
    }
  }

  return {
    user,
    db,
    req: opts.req,
    sessionId: opts.req.headers['x-session-id'] as string | undefined,
  };
}

// 使用 Context 的类型初始化 tRPC
const t = initTRPC.context<Context>().create();

// 在 Procedure 中使用 Context
const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: '请先登录',
    });
  }
  // 将 user 添加到上下文中，下游可以直接使用
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '需要管理员权限',
    });
  }
  return next({ ctx });
});
```

Context 的设计遵循了依赖注入的理念，使得 Procedure 之间的共享状态管理变得清晰可控。值得注意的是，Context 是在每次请求时动态创建的，因此它是请求级别的单例，不会在请求之间产生状态泄露。

### 1.4 Middleware（中间件）

Middleware 是 tRPC 中实现横切关注点（cross-cutting concerns）的核心机制。每个 Middleware 可以在 Procedure 执行前/后执行逻辑，如鉴权、日志记录、性能监控、错误处理等。

```typescript
import { TRPCError } from '@trpc/server';

// 日志中间件
const loggerMiddleware = t.middleware(async ({ path, type, next, ctx }) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${type} ${path} 开始`);

  const result = await next();

  const duration = Date.now() - start;
  console.log(
    `[${new Date().toISOString()}] ${type} ${path} 完成 (${duration}ms)`
  );

  return result;
});

// 速率限制中间件
const rateLimitMiddleware = t.middleware(async ({ ctx, next }) => {
  const ip = ctx.req.headers['x-forwarded-for'] || 'unknown';
  const key = `rate_limit:${ip}`;

  const current = await redis.get(key);
  if (current && parseInt(current) > 100) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: '请求过于频繁，请稍后再试',
    });
  }

  await redis.incr(key);
  await redis.expire(key, 60); // 60 秒窗口

  return next();
});

// 输入消毒中间件
const sanitizeMiddleware = t.middleware(async ({ input, next }) => {
  // 对字符串输入进行 XSS 防护
  const sanitize = (obj: any): any => {
    if (typeof obj === 'string') {
      return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    if (typeof obj === 'object' && obj !== null) {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, sanitize(v)])
      );
    }
    return obj;
  };

  return next({ input: sanitize(input) });
});

// 带日志的基础 Procedure
const baseProcedure = t.procedure.use(loggerMiddleware);

// 公开的 Procedure（带速率限制）
const publicProcedure = baseProcedure
  .use(rateLimitMiddleware)
  .use(sanitizeMiddleware);

// 需要认证的 Procedure
const authedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
```

Middleware 的链式调用是线性的，每个 Middleware 都可以选择：
- **通过 `next()` 继续执行**：传递给下一个 Middleware 或最终的 Procedure
- **抛出错误终止执行**：如 `TRPCError`
- **修改上下文或输入**：通过 `next({ ctx: ..., input: ... })` 传递修改后的数据

---

## 二、tRPC 与 REST/OpenAPI+代码生成：全面对比

### 2.1 类型安全对比

这是 tRPC 最核心的优势。让我们用一个具体的例子来说明三种方案的差异：

**REST + 手动维护类型（传统方案）**

```typescript
// 后端 API 定义
app.get('/api/users/:id', (req, res) => {
  const user = db.user.findUnique({ where: { id: req.params.id } });
  res.json({ data: user, success: true });
});

// 前端需要手动维护类型
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string; // 容易出错：后端返回 Date，前端以为是 string
}

interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}

// 手动编写 fetch 代码
async function getUser(id: string): Promise<ApiResponse<User>> {
  const res = await fetch(`/api/users/${id}`);
  return res.json(); // 没有任何类型保证！
}
```

这里的问题显而易见：前端的类型定义完全靠人工维护，一旦后端字段名变更、类型修改、新增/删除字段，前端不会收到任何编译时警告。

**OpenAPI + 代码生成方案**

```yaml
# openapi.yaml
paths:
  /users/{id}:
    get:
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: '#/components/schemas/User'
                  success:
                    type: boolean
```

```bash
# 生成客户端代码
npx openapi-typescript-codegen -i openapi.yaml -o ./generated
```

```typescript
import { UsersService } from './generated/services/UsersService';
// 生成的代码有一定的类型安全
const user = await UsersService.getUserById('xxx');
```

这个方案解决了类型一致性的问题，但引入了新的负担：
- 需要维护 OpenAPI schema 文件
- 需要配置和运行代码生成器
- 生成的代码往往是黑盒，调试困难
- Schema 和实际实现之间仍有不一致的可能
- 每次修改 API 都需要重新生成

**tRPC 方案**

```typescript
// 后端直接定义（类型自然推导）
const appRouter = t.router({
  getUser: t.procedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => {
      return db.user.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, email: true, createdAt: true },
      });
    }),
});

export type AppRouter = typeof appRouter;

// 前端调用——类型完全自动推导，零维护成本
const user = await trpc.getUser.query({ id: 'xxx' });
// user 的类型完全由后端代码推导，包含所有字段和精确类型
// 如果后端改了字段名，前端编译时立即报错
```

tRPC 的类型安全是**编译时保证**的，不存在任何"人手动维护"的环节，也没有中间的代码生成步骤。TypeScript 编译器直接从后端代码推导出前端调用的完整类型信息。

### 2.2 开发体验对比

| 维度 | REST + 手动类型 | OpenAPI + 代码生成 | tRPC |
|------|----------------|-------------------|------|
| 初始化成本 | 低 | 高（需要配置 schema + 生成器） | 低 |
| 类型准确性 | 完全靠人 | 依赖 schema 准确性 | 编译时自动保证 |
| API 修改感知 | 运行时才发现 | 重新生成后发现 | 编译时立即发现 |
| 自动补全 | 需手动维护类型 | 生成代码可补全 | 完整的自动补全 |
| 调试体验 | 直接调试 fetch | 需调试生成的代码 | 透明，可直接调试 |
| 重构信心 | 低 | 中 | 高 |
| 学习曲线 | 低 | 中 | 低-中 |
| 工具链复杂度 | 简单 | 复杂 | 简单 |
| 热更新体验 | 一般 | 需重新生成 | 即时类型更新 |

在实际开发中，tRPC 带来的最大体验提升体现在**重构信心**上。当你修改了一个后端 Procedure 的返回类型时，TypeScript 编译器会在所有受影响的前端调用点标红错误，你不需要运行任何测试或手动检查就能知道哪些地方需要修改。

### 2.3 性能对比

**Bundle Size**：
- tRPC 客户端：约 5KB gzipped（核心 + HTTP adapter）
- OpenAPI 生成器生成的代码：视 API 规模而定，通常 50KB-200KB+
- GraphQL 客户端（如 Apollo）：30KB-100KB gzipped

**运行时性能**：
- tRPC 使用 HTTP 请求，性能与 REST API 基本相同
- 数据传输是 JSON，没有额外的序列化/反序列化开销
- 相比 GraphQL，tRPC 没有 query parsing 和 resolver 解析的开销
- tRPC 的中间件链在服务端执行，不影响网络传输

**开发时性能**：
- TypeScript 编译器需要推导复杂的类型，大型 tRPC Router 可能会略微增加编译时间
- 建议在大型项目中使用 `@trpc/server` 的 `--isolatedModules` 模式优化编译性能

### 2.4 生态与适用场景

**REST + OpenAPI** 的优势场景：
- 多语言团队（非 TypeScript 前后端）
- 需要公开 API 文档供第三方使用
- 已有大量 REST API 的遗留系统

**GraphQL** 的优势场景：
- 客户端需要灵活查询，按需获取字段
- 复杂的数据图谱和关联查询
- 需要 subscriptions 的实时场景（虽然 tRPC 也支持）

**tRPC** 的优势场景：
- TypeScript monorepo 全栈项目
- 小到中型团队快速迭代
- 追求最小工具链和最大类型安全
- 前后端由同一团队维护

---

## 三、Zod 深度集成

Zod 是 tRPC 的"最佳拍档"，两者结合实现了从输入验证到类型推导的完整闭环。

### 3.1 基础输入验证

```typescript
import { z } from 'zod';

// 定义复杂的输入 schema
const createUserSchema = z.object({
  name: z.string()
    .min(2, '用户名至少 2 个字符')
    .max(50, '用户名最多 50 个字符')
    .regex(/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/, '用户名只能包含中文、字母、数字和下划线'),

  email: z.string().email('请输入有效的邮箱地址'),

  password: z.string()
    .min(8, '密码至少 8 个字符')
    .regex(/[A-Z]/, '密码必须包含至少一个大写字母')
    .regex(/[a-z]/, '密码必须包含至少一个小写字母')
    .regex(/[0-9]/, '密码必须包含至少一个数字')
    .regex(/[^A-Za-z0-9]/, '密码必须包含至少一个特殊字符'),

  profile: z.object({
    avatar: z.string().url().optional(),
    bio: z.string().max(500).optional(),
    website: z.string().url().optional(),
    location: z.string().max(100).optional(),
  }).optional(),

  settings: z.object({
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
    notifications: z.object({
      email: z.boolean().default(true),
      push: z.boolean().default(true),
      sms: z.boolean().default(false),
    }).default({}),
  }).default({}),
});

const userRouter = t.router({
  register: t.procedure
    .input(createUserSchema)
    .mutation(async ({ input, ctx }) => {
      // input 的类型已经被 Zod 推导为完整的 TypeScript 类型
      const hashedPassword = await bcrypt.hash(input.password, 12);
      const user = await ctx.db.user.create({
        data: {
          name: input.name,
          email: input.email,
          password: hashedPassword,
          profile: input.profile ? { create: input.profile } : undefined,
          settings: { create: input.settings },
        },
      });
      return { id: user.id, name: user.name, email: user.email };
    }),
});
```

### 3.2 高级 Zod 技巧

**条件验证（Refine）**：

```typescript
const updatePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: '两次输入的密码不一致',
  path: ['confirmPassword'],
}).refine((data) => data.newPassword !== data.currentPassword, {
  message: '新密码不能与旧密码相同',
  path: ['newPassword'],
});
```

**联合类型与判别联合**：

```typescript
// 搜索请求——不同类型的搜索有不同参数
const searchSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user'),
    query: z.string().min(1),
    role: z.enum(['admin', 'user']).optional(),
  }),
  z.object({
    type: z.literal('post'),
    query: z.string().min(1),
    tags: z.array(z.string()).optional(),
    dateRange: z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    }).optional(),
  }),
  z.object({
    type: z.literal('file'),
    query: z.string().min(1),
    mimeType: z.string().optional(),
    maxSize: z.number().positive().optional(),
  }),
]);

const searchRouter = t.router({
  search: t.procedure
    .input(searchSchema)
    .query(async ({ input, ctx }) => {
      switch (input.type) {
        case 'user':
          return ctx.db.user.findMany({
            where: {
              name: { contains: input.query },
              role: input.role,
            },
          });
        case 'post':
          return ctx.db.post.findMany({
            where: {
              OR: [
                { title: { contains: input.query } },
                { content: { contains: input.query } },
              ],
              tags: input.tags ? { hasSome: input.tags } : undefined,
            },
          });
        case 'file':
          return ctx.db.file.findMany({
            where: {
              name: { contains: input.query },
              mimeType: input.mimeType,
            },
          });
      }
    }),
});
```

**Transform（数据转换）**：

```typescript
const paginationInput = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['createdAt', 'updatedAt', 'name']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
}).transform((data) => ({
  ...data,
  skip: (data.page - 1) * data.limit,
}));

// 使用
const listUsers = t.procedure
  .input(paginationInput)
  .query(({ input }) => {
    // input 中同时包含 page, limit, skip, sort, order
    return db.user.findMany({
      skip: input.skip,
      take: input.limit,
      orderBy: { [input.sort]: input.order },
    });
  });
```

### 3.3 输出类型验证

tRPC 还支持对输出进行类型验证，这在开发阶段非常有用，可以确保 Procedure 的返回值符合预期：

```typescript
const userOutputSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.date(),
  _count: z.object({
    posts: z.number(),
    followers: z.number(),
  }),
});

const getUserWithStats = t.procedure
  .input(z.object({ id: z.string().uuid() }))
  .output(userOutputSchema) // 启用输出验证
  .query(async ({ input }) => {
    const user = await db.user.findUnique({
      where: { id: input.id },
      include: {
        _count: {
          select: { posts: true, followers: true },
        },
      },
    });

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
    }

    return user; // 如果返回值不符合 schema，tRPC 会抛出错误
  });
```

输出验证在生产环境中可能带来少量性能开销，建议在开发和测试阶段启用，生产环境可选择性关闭。

---

## 四、Next.js 集成实战

Next.js 是 tRPC 最流行的宿主框架之一。tRPC 提供了 `@trpc/next` 包，与 Next.js 的 App Router 和 Pages Router 都有良好集成。

### 4.1 项目结构

```
my-app/
├── src/
│   ├── server/
│   │   ├── trpc.ts              # tRPC 初始化
│   │   ├── context.ts           # Context 定义
│   │   ├── routers/
│   │   │   ├── _app.ts          # 根路由
│   │   │   ├── user.ts          # 用户路由
│   │   │   ├── post.ts          # 帖子路由
│   │   │   └── comment.ts       # 评论路由
│   │   └── middleware/
│       ├── auth.ts              # 认证中间件
│       └── logger.ts            # 日志中间件
│   ├── app/
│   │   ├── api/trpc/[trpc]/
│   │   │   └── route.ts         # tRPC HTTP handler
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── users/
│   │       └── page.tsx
│   ├── lib/
│   │   ├── trpc.ts              # tRPC 客户端
│   │   └── trpc-server.ts       # 服务端 tRPC helper
│   └── components/
│       └── UserList.tsx
├── prisma/
│   └── schema.prisma
└── package.json
```

### 4.2 服务端配置

```typescript
// src/server/trpc.ts
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { Context } from './context';

export const t = initTRPC.context<Context>().create({
  // 使用 superjson 序列化，支持 Date、Map、Set 等类型
  transformer: superjson,

  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.code === 'BAD_REQUEST' && error.cause instanceof ZodError
            ? error.cause.flatten()
            : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
```

```typescript
// src/server/context.ts
import { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { db } from '@/lib/db';
import { getAuth } from '@clerk/nextjs/server';

export async function createContext(opts: FetchCreateContextFnOptions) {
  const auth = getAuth(opts.req);
  const userId = auth.userId;

  let user = null;
  if (userId) {
    user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });
  }

  return {
    db,
    user,
    userId,
    req: opts.req,
    headers: opts.req.headers,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

```typescript
// src/server/middleware/auth.ts
import { t } from '../trpc';
import { TRPCError } from '@trpc/server';

export const enforceAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: '请登录后访问此资源',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      userId: ctx.userId,
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceAuth);
```

```typescript
// src/server/routers/user.ts
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { protectedProcedure } from '../middleware/auth';
import { TRPCError } from '@trpc/server';

export const userRouter = router({
  // 公开查询——任何人可访问
  getProfile: publicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ input, ctx }) => {
      const user = await ctx.db.user.findUnique({
        where: { username: input.username },
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true,
          bio: true,
          createdAt: true,
          _count: {
            select: {
              posts: true,
              followers: true,
              following: true,
            },
          },
        },
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '用户不存在',
        });
      }

      return user;
    }),

  // 需要认证的查询
  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findUnique({
      where: { id: ctx.userId },
      include: {
        settings: true,
        _count: {
          select: { posts: true, notifications: true },
        },
      },
    });
  }),

  // 更新个人资料
  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(50).optional(),
      bio: z.string().max(500).optional(),
      avatar: z.string().url().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.user.update({
        where: { id: ctx.userId },
        data: input,
      });
    }),

  // 分页查询用户列表
  list: publicProcedure
    .input(z.object({
      cursor: z.string().nullish(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const { cursor, limit } = input;

      const users = await ctx.db.user.findMany({
        take: limit + 1, // 多取一个来判断是否有下一页
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true,
          createdAt: true,
        },
      });

      let nextCursor: typeof cursor = undefined;
      if (users.length > limit) {
        const nextItem = users.pop();
        nextCursor = nextItem!.id;
      }

      return {
        items: users,
        nextCursor,
      };
    }),
});
```

```typescript
// src/server/routers/post.ts
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { protectedProcedure } from '../middleware/auth';
import { TRPCError } from '@trpc/server';

export const postRouter = router({
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      tags: z.array(z.string()).max(10).default([]),
      published: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.post.create({
        data: {
          ...input,
          authorId: ctx.userId,
        },
      });
    }),

  detail: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input, ctx }) => {
      const post = await ctx.db.post.findUnique({
        where: { slug: input.slug },
        include: {
          author: {
            select: { id: true, username: true, name: true, avatar: true },
          },
          tags: true,
          _count: { select: { comments: true, likes: true } },
        },
      });

      if (!post) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      return post;
    }),

  feed: publicProcedure
    .input(z.object({
      cursor: z.string().nullish(),
      limit: z.number().min(1).max(50).default(20),
      tag: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const { cursor, limit, tag } = input;

      const posts = await ctx.db.post.findMany({
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        where: {
          published: true,
          ...(tag ? { tags: { some: { name: tag } } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: { id: true, username: true, name: true, avatar: true },
          },
          tags: true,
          _count: { select: { comments: true, likes: true } },
        },
      });

      let nextCursor: typeof cursor = undefined;
      if (posts.length > limit) {
        const nextItem = posts.pop();
        nextCursor = nextItem!.id;
      }

      return { items: posts, nextCursor };
    }),

  like: protectedProcedure
    .input(z.object({ postId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.like.findUnique({
        where: {
          userId_postId: { userId: ctx.userId, postId: input.postId },
        },
      });

      if (existing) {
        await ctx.db.like.delete({ where: { id: existing.id } });
        return { liked: false };
      }

      await ctx.db.like.create({
        data: { userId: ctx.userId, postId: input.postId },
      });
      return { liked: true };
    }),
});
```

```typescript
// src/server/routers/_app.ts
import { router } from '../trpc';
import { userRouter } from './user';
import { postRouter } from './post';
import { commentRouter } from './comment';

export const appRouter = router({
  user: userRouter,
  post: postRouter,
  comment: commentRouter,
});

export type AppRouter = typeof appRouter;
```

### 4.3 客户端配置

```typescript
// src/lib/trpc.ts
'use client';

import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@/server/routers/_app';

export const trpc = createTRPCReact<AppRouter>();
```

```typescript
// src/app/api/trpc/[trpc]/route.ts
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/routers/_app';
import { createContext } from '@/server/context';

const handler = (req: Request) => {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
    onError:
      process.env.NODE_ENV === 'development'
        ? ({ path, error }) => {
            console.error(
              `❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`
            );
          }
        : undefined,
  });
};

export { handler as GET, handler as POST };
```

```typescript
// src/app/providers.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { useState } from 'react';
import superjson from 'superjson';
import { trpc } from '@/lib/trpc';

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  }));

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === 'development' ||
            (opts.direction === 'down' && opts.result instanceof Error),
        }),
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers() {
            const headers = new Headers();
            headers.set('x-trpc-source', 'nextjs-react');
            return headers;
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

### 4.4 客户端组件使用

```typescript
// src/components/UserList.tsx
'use client';

import { trpc } from '@/lib/trpc';

export function UserList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isLoading,
  } = trpc.user.list.useInfiniteQuery(
    { limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  if (isLoading) return <div className="animate-pulse">加载中...</div>;

  return (
    <div className="space-y-4">
      {data?.pages.map((page, i) => (
        <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {page.items.map((user) => (
            <UserCard key={user.id} user={user} />
          ))}
        </div>
      ))}

      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetching}
          className="w-full py-2 px-4 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {isFetching ? '加载中...' : '加载更多'}
        </button>
      )}
    </div>
  );
}

function UserCard({ user }: { user: { id: string; username: string; name: string | null; avatar: string | null } }) {
  const likeMutation = trpc.post.like.useMutation();

  return (
    <div className="p-4 border rounded-lg shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        <img
          src={user.avatar || '/default-avatar.png'}
          alt={user.name || user.username}
          className="w-10 h-10 rounded-full"
        />
        <div>
          <h3 className="font-medium">{user.name || user.username}</h3>
          <p className="text-sm text-gray-500">@{user.username}</p>
        </div>
      </div>
    </div>
  );
}
```

### 4.5 Server Components 中使用 tRPC

在 Next.js App Router 中，你也可以在 Server Components 中直接调用 tRPC：

```typescript
// src/lib/trpc-server.ts
import { appRouter } from '@/server/routers/_app';
import { createContext } from '@/server/context';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@/server/routers/_app';

// 服务端直接创建 caller——无需 HTTP 请求，零网络开销
export const serverClient = appRouter.createCaller(
  await createContext()
);

// 或者使用 httpBatchLink（适用于跨服务调用）
export const trpcServerClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/api/trpc',
      transformer: superjson,
    }),
  ],
});
```

```typescript
// src/app/users/page.tsx
import { serverClient } from '@/lib/trpc-server';

export default async function UsersPage() {
  // 直接调用，没有 HTTP 请求！
  const { items, nextCursor } = await serverClient.user.list({ limit: 50 });

  return (
    <div>
      <h1>用户列表</h1>
      <div className="grid grid-cols-3 gap-4">
        {items.map((user) => (
          <div key={user.id} className="p-4 border rounded">
            <h2>{user.name}</h2>
            <p>@{user.username}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

使用 `createCaller` 创建的服务端调用完全跳过了 HTTP 层，直接在服务端执行 Procedure，性能更优，同时保持完整的类型安全。

---

## 五、Express 集成实战

对于不使用 Next.js 的项目，tRPC 同样可以与 Express 无缝集成。

### 5.1 Express 服务端配置

```typescript
// server/index.ts
import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './routers/_app';
import { createContext } from './context';

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3001',
  credentials: true,
}));

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// tRPC 中间件
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: ({ error, path }) => {
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        console.error(`[tRPC Error] ${path}:`, error);
        // 这里可以接入 Sentry 等错误监控
      }
    },
    responseMeta({ ctx, paths, errors, type }) {
      // 为所有成功的查询设置缓存头
      const allOk = errors.length === 0;
      const isQuery = type === 'query';
      const isPublic = paths?.every((path) => !path.includes('me'));

      if (allOk && isQuery && isPublic) {
        return {
          headers: {
            'cache-control': `s-maxage=60, stale-while-revalidate=${60 * 60}`,
          },
        };
      }

      return {};
    },
  })
);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 tRPC 服务运行在 http://localhost:${PORT}/trpc`);
});
```

### 5.2 前端与 Express 后端集成

```typescript
// client/trpc.ts
import { createTRPCClient, httpBatchLink, loggerLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../server/routers/_app';

export const trpc = createTRPCClient<AppRouter>({
  links: [
    loggerLink({
      enabled: () => process.env.NODE_ENV === 'development',
    }),
    httpBatchLink({
      url: 'http://localhost:4000/trpc',
      transformer: superjson,
      headers() {
        const token = localStorage.getItem('auth_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

// 使用
async function main() {
  const users = await trpc.user.list.query({ limit: 10 });
  console.log(users);

  const newUser = await trpc.user.register.mutate({
    name: '张三',
    email: 'zhangsan@example.com',
    password: 'Str0ng@Pass!',
  });
  console.log(newUser);
}
```

---

## 六、Subscriptions（实时订阅）

tRPC 支持 WebSocket-based 的实时订阅，适用于聊天、通知、实时数据更新等场景。

### 6.1 服务端 Subscription 设置

```typescript
// server/routers/notification.ts
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc';
import { EventEmitter } from 'events';

// 全局事件发射器
const ee = new EventEmitter();

export const notificationRouter = router({
  // 订阅通知
  onNotification: protectedProcedure.subscription(({ ctx }) => {
    return observable<{ type: string; message: string; createdAt: Date }>(
      (emit) => {
        const onNotification = (data: {
          type: string;
          message: string;
          createdAt: Date;
        }) => {
          // 只发送给当前用户的通知
          emit.next(data);
        };

        // 监听以 userId 为名的事件
        ee.on(`notification:${ctx.userId}`, onNotification);

        return () => {
          // 清理订阅
          ee.off(`notification:${ctx.userId}`, onNotification);
        };
      }
    );
  }),

  // 实时聊天消息
  onMessage: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .subscription(({ input, ctx }) => {
      return observable<{
        id: string;
        content: string;
        senderId: string;
        senderName: string;
        createdAt: Date;
      }>((emit) => {
        const onMessage = (data: any) => {
          emit.next(data);
        };

        ee.on(`room:${input.roomId}:message`, onMessage);

        return () => {
          ee.off(`room:${input.roomId}:message`, onMessage);
        };
      });
    }),

  // 发送消息（触发订阅）
  sendMessage: protectedProcedure
    .input(z.object({
      roomId: z.string(),
      content: z.string().min(1).max(5000),
    }))
    .mutation(async ({ input, ctx }) => {
      const message = await ctx.db.message.create({
        data: {
          roomId: input.roomId,
          content: input.content,
          senderId: ctx.userId,
        },
        include: {
          sender: { select: { id: true, username: true, name: true } },
        },
      });

      // 发射事件，通知所有订阅者
      ee.emit(`room:${input.roomId}:message`, {
        id: message.id,
        content: message.content,
        senderId: message.senderId,
        senderName: message.sender.name,
        createdAt: message.createdAt,
      });

      return message;
    }),
});
```

### 6.2 WebSocket 适配器

```typescript
// server/ws.ts
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { WebSocketServer } from 'ws';
import { appRouter } from './routers/_app';
import { createContext } from './context';

const wss = new WebSocketServer({
  port: 4001,
});

const handler = applyWSSHandler({
  wss,
  router: appRouter,
  createContext,
  onError: ({ error }) => {
    console.error('WebSocket 错误:', error);
  },
});

wss.on('connection', (ws) => {
  console.log(`+ 新的 WebSocket 连接 (总数: ${wss.clients.size})`);
  ws.once('close', () => {
    console.log(`- 连接断开 (剩余: ${wss.clients.size})`);
  });
});

console.log('✅ WebSocket 服务器运行在 ws://localhost:4001');

process.on('SIGTERM', () => {
  handler.broadcastReconnectNotification();
  wss.close();
});
```

### 6.3 客户端使用 Subscription

```typescript
// 在 React 组件中使用
'use client';

import { trpc } from '@/lib/trpc';
import { useEffect, useState } from 'react';

function NotificationBell() {
  const [notifications, setNotifications] = useState<any[]>([]);

  // 使用 subscription
  trpc.notification.onNotification.useSubscription(undefined, {
    onData(notification) {
      setNotifications((prev) => [notification, ...prev]);
      // 显示浏览器通知
      if (Notification.permission === 'granted') {
        new Notification(notification.type, { body: notification.message });
      }
    },
    onError(err) {
      console.error('通知订阅错误:', err);
    },
  });

  return (
    <div>
      <span className="relative">
        🔔
        {notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
            {notifications.length}
          </span>
        )}
      </span>
    </div>
  );
}

// 实时聊天组件
function ChatRoom({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');

  trpc.chat.onMessage.useSubscription(
    { roomId },
    {
      onData(message) {
        setMessages((prev) => [...prev, message]);
      },
    }
  );

  const sendMessage = trpc.chat.sendMessage.useMutation({
    onSuccess: () => setInput(''),
  });

  return (
    <div className="flex flex-col h-96">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`p-2 rounded ${
              msg.senderId === 'me' ? 'bg-blue-100 ml-auto' : 'bg-gray-100'
            }`}
          >
            <span className="text-sm font-medium">{msg.senderName}</span>
            <p>{msg.content}</p>
          </div>
        ))}
      </div>
      <div className="p-4 border-t flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) {
              sendMessage.mutate({ roomId, content: input });
            }
          }}
          className="flex-1 border rounded px-3 py-2"
          placeholder="输入消息..."
        />
        <button
          onClick={() => {
            if (input.trim()) {
              sendMessage.mutate({ roomId, content: input });
            }
          }}
          disabled={sendMessage.isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </div>
  );
}
```

---

## 七、错误处理

tRPC 提供了一套完善的错误处理机制，从服务端到客户端形成完整的错误传递链。

### 7.1 服务端错误定义

```typescript
import { TRPCError } from '@trpc/server';

// tRPC 内置的错误代码
// BAD_REQUEST (400) - 请求参数错误
// UNAUTHORIZED (401) - 未认证
// FORBIDDEN (403) - 无权限
// NOT_FOUND (404) - 资源不存在
// CONFLICT (409) - 资源冲突
// UNPROCESSABLE_CONTENT (422) - 输入格式正确但语义错误
// TOO_MANY_REQUESTS (429) - 请求频率超限
// CLIENT_CLOSED_REQUEST (499) - 客户端关闭连接
// INTERNAL_SERVER_ERROR (500) - 服务器内部错误
// NOT_IMPLEMENTED (501) - 功能未实现
// BAD_GATEWAY (502) - 网关错误
// SERVICE_UNAVAILABLE (503) - 服务不可用
// GATEWAY_TIMEOUT (504) - 网关超时

// 自定义错误类
class BusinessError extends TRPCError {
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(
    message: string,
    businessCode: string,
    details?: Record<string, any>
  ) {
    super({ code: 'BAD_REQUEST', message });
    this.code = businessCode;
    this.details = details;
  }
}

// 使用示例
const orderRouter = router({
  create: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      // 检查库存
      for (const item of input.items) {
        const product = await ctx.db.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `商品 ${item.productId} 不存在`,
          });
        }

        if (product.stock < item.quantity) {
          throw new BusinessError(
            '库存不足',
            'INSUFFICIENT_STOCK',
            {
              productId: item.productId,
              available: product.stock,
              requested: item.quantity,
            }
          );
        }
      }

      // 创建订单...
    }),
});
```

### 7.2 全局错误处理中间件

```typescript
import { TRPCError } from '@trpc/server';
import * as Sentry from '@sentry/node';

const errorHandlerMiddleware = t.middleware(async ({ path, type, next }) => {
  try {
    return await next();
  } catch (error) {
    // 已知的 tRPC 错误直接抛出
    if (error instanceof TRPCError) {
      // 记录特定级别的错误
      if (['INTERNAL_SERVER_ERROR', 'BAD_GATEWAY', 'SERVICE_UNAVAILABLE'].includes(error.code)) {
        Sentry.captureException(error, {
          tags: { trpc_path: path, trpc_type: type },
        });
      }
      throw error;
    }

    // Prisma 错误转换
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002':
          throw new TRPCError({
            code: 'CONFLICT',
            message: '数据已存在，请勿重复提交',
            cause: error,
          });
        case 'P2025':
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: '记录不存在',
            cause: error,
          });
        default:
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '数据库操作失败',
            cause: error,
          });
      }
    }

    // 未知错误
    Sentry.captureException(error, {
      tags: { trpc_path: path, trpc_type: type },
    });

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器内部错误，请稍后重试',
      cause: error,
    });
  }
});
```

### 7.3 客户端错误处理

```typescript
'use client';

import { trpc } from '@/lib/trpc';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'react-hot-toast';

// 全局错误处理
function useTRPCErrorHandler() {
  const utils = trpc.useUtils();

  return (error: unknown) => {
    if (error instanceof TRPCClientError) {
      const { message, data, shape } = error;

      switch (shape?.data.code) {
        case 'UNAUTHORIZED':
          // 跳转到登录页
          window.location.href = '/login';
          break;

        case 'FORBIDDEN':
          toast.error('你没有权限执行此操作');
          break;

        case 'NOT_FOUND':
          toast.error('请求的资源不存在');
          break;

        case 'TOO_MANY_REQUESTS':
          toast.error('请求过于频繁，请稍后再试');
          break;

        case 'BAD_REQUEST':
          // 处理 Zod 验证错误
          if (shape?.data.zodError) {
            const fieldErrors = shape.data.zodError.fieldErrors;
            const firstError = Object.values(fieldErrors).flat()[0];
            toast.error(String(firstError) || '输入参数有误');
          } else {
            toast.error(message);
          }
          break;

        default:
          toast.error('发生未知错误，请稍后重试');
          console.error('tRPC Error:', error);
      }
    } else {
      toast.error('网络错误，请检查网络连接');
      console.error('Unknown error:', error);
    }
  };
}

// 在组件中使用
function UserProfile() {
  const handleError = useTRPCErrorHandler();

  const updateUser = trpc.user.updateProfile.useMutation({
    onError: handleError,
    onSuccess: () => {
      toast.success('个人资料已更新');
    },
  });

  // 带自动重试的查询
  const { data, error, isLoading, refetch } = trpc.user.me.useQuery(
    undefined,
    {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      onError: handleError,
      // 自动重新获取 token 过期后的数据
      refetchOnWindowFocus: true,
    }
  );

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  return <div>{/* 渲染用户信息 */}</div>;
}
```

---

## 八、高级特性和最佳实践

### 8.1 Batching（批处理）

tRPC 默认使用 HTTP Batching，将多个 Procedure 调用合并为一个 HTTP 请求，显著减少网络往返：

```typescript
// 默认的 httpBatchLink 会自动批处理
// 以下两个调用会合并为一个 HTTP 请求
const user = trpc.user.me.useQuery();
const posts = trpc.post.feed.useQuery({ limit: 10 });

// 但如果你需要禁止批处理某个调用（如需要独立的错误处理），可以使用 httpLink
import { httpLink, splitLink } from '@trpc/client';

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.context.skipBatch === true,
      true: httpLink({ url: '/api/trpc' }),
      false: httpBatchLink({ url: '/api/trpc' }),
    }),
  ],
});

// 使用时
const result = await trpc.criticalOperation.query(input, {
  context: { skipBatch: true },
});
```

### 8.2 缓存策略

```typescript
// 利用 React Query 的缓存能力
const { data } = trpc.user.getProfile.useQuery(
  { username: 'mike' },
  {
    staleTime: 5 * 60 * 1000, // 5 分钟内认为数据是新鲜的
    cacheTime: 10 * 60 * 1000, // 缓存保留 10 分钟
    refetchOnWindowFocus: false,
  }
);

// 手动失效缓存
const utils = trpc.useUtils();

const createUser = trpc.user.register.useMutation({
  onSuccess: () => {
    // 使用户列表缓存失效，触发重新获取
    utils.user.list.invalidate();
    // 或者精确更新缓存
    utils.user.list.setData({ limit: 20 }, (old) => {
      if (!old) return old;
      return {
        ...old,
        items: [newUser, ...old.items],
      };
    });
  },
});

// 乐观更新
const likePost = trpc.post.like.useMutation({
  onMutate: async (newLike) => {
    // 取消正在进行的查询
    await utils.post.detail.cancel({ slug: postSlug });

    // 保存当前数据快照
    const previousPost = utils.post.detail.getData({ slug: postSlug });

    // 乐观更新
    utils.post.detail.setData({ slug: postSlug }, (old) => {
      if (!old) return old;
      return {
        ...old,
        _count: {
          ...old._count,
          likes: old._count.likes + 1,
        },
      };
    });

    return { previousPost };
  },
  onError: (err, newLike, context) => {
    // 回滚
    if (context?.previousPost) {
      utils.post.detail.setData(
        { slug: postSlug },
        context.previousPost
      );
    }
    toast.error('操作失败，请重试');
  },
  onSettled: () => {
    // 无论成功失败，都重新获取数据
    utils.post.detail.invalidate({ slug: postSlug });
  },
});
```

### 8.3 文件上传

tRPC 原生不支持文件上传，但可以通过结合预签名 URL 的方式实现：

```typescript
const fileRouter = router({
  getUploadUrl: protectedProcedure
    .input(z.object({
      filename: z.string(),
      contentType: z.string(),
      size: z.number().max(10 * 1024 * 1024), // 最大 10MB
    }))
    .mutation(async ({ input, ctx }) => {
      const key = `uploads/${ctx.userId}/${Date.now()}-${input.filename}`;

      const uploadUrl = await s3.getSignedUrlPromise('putObject', {
        Bucket: process.env.S3_BUCKET,
        Key: key,
        ContentType: input.contentType,
        Expires: 60 * 5, // 5 分钟有效
      });

      return {
        uploadUrl,
        fileUrl: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`,
      };
    }),

  confirmUpload: protectedProcedure
    .input(z.object({
      fileUrl: z.string().url(),
      filename: z.string(),
      size: z.number(),
      mimeType: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.file.create({
        data: {
          url: input.fileUrl,
          filename: input.filename,
          size: input.size,
          mimeType: input.mimeType,
          uploaderId: ctx.userId,
        },
      });
    }),
});
```

```typescript
// 客户端上传组件
function FileUpload() {
  const getUploadUrl = trpc.file.getUploadUrl.useMutation();
  const confirmUpload = trpc.file.confirmUpload.useMutation();

  const handleUpload = async (file: File) => {
    // 第一步：获取预签名 URL
    const { uploadUrl, fileUrl } = await getUploadUrl.mutateAsync({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    });

    // 第二步：直接上传到 S3
    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });

    // 第三步：确认上传完成
    const fileRecord = await confirmUpload.mutateAsync({
      fileUrl,
      filename: file.name,
      size: file.size,
      mimeType: file.type,
    });

    return fileRecord;
  };

  return (
    <input
      type="file"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        if (file) {
          await handleUpload(file);
          toast.success('文件上传成功');
        }
      }}
    />
  );
}
```

### 8.4 性能优化技巧

**1. 使用 `select` 精确控制返回字段：**

```typescript
// 不推荐：返回所有字段
const user = await ctx.db.user.findUnique({ where: { id } });

// 推荐：只返回需要的字段
const user = await ctx.db.user.findUnique({
  where: { id },
  select: { id: true, name: true, avatar: true },
});
```

**2. 使用 DataLoader 解决 N+1 查询：**

```typescript
import DataLoader from 'dataloader';

const createContext = async (opts: FetchCreateContextFnOptions) => {
  const userLoader = new DataLoader<string, User>(async (ids) => {
    const users = await db.user.findMany({
      where: { id: { in: [...ids] } },
    });
    // 保持顺序一致
    return ids.map((id) => users.find((u) => u.id === id) || null);
  });

  return { db, userLoader, /* ... */ };
};
```

**3. 利用 `httpBatchStreamLink` 实现流式批处理：**

```typescript
import { httpBatchStreamLink } from '@trpc/client';

const trpcClient = trpc.createClient({
  links: [
    httpBatchStreamLink({
      url: '/api/trpc',
    }),
  ],
});
```

流式批处理允许在批处理请求中逐个返回结果，先完成的 Procedure 可以先返回，不必等待最慢的那个。

---

## 九、从 REST 迁移到 tRPC 的实战指南

### 9.1 渐进式迁移策略

对于已有 REST API 的项目，不需要一步到位。tRPC 支持与现有 Express 中间件共存：

```typescript
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';

const app = express();

// 保留现有的 REST 路由
app.use('/api/v1', existingRestRouter);

// 逐步将新功能用 tRPC 实现
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// 最终目标：所有 API 都通过 tRPC
```

### 9.2 迁移检查清单

1. **评估范围**：列出所有需要迁移的 REST 端点
2. **创建 tRPC Router**：为每个 REST 资源创建对应的 Router
3. **定义输入/输出 Schema**：使用 Zod 定义验证规则
4. **迁移中间件**：将 REST 中间件转换为 tRPC Middleware
5. **更新前端调用**：逐步替换 fetch/axios 调用为 tRPC client
6. **类型迁移**：删除手动维护的类型定义
7. **测试验证**：确保功能和类型都正确
8. **清理**：移除旧的 REST 端点和相关代码

---

## 十、常见问题与解决方案

### Q1: tRPC 支持哪些数据库/ORM？

tRPC 是数据库无关的。你可以在任何 Procedure 中使用任何数据库工具：

```typescript
// Prisma
const user = await prisma.user.findUnique({ where: { id } });

// Drizzle
const user = await db.select().from(users).where(eq(users.id, id));

// TypeORM
const user = await userRepository.findOneBy({ id });

// 原生 SQL
const user = await pool.query('SELECT * FROM users WHERE id = $1', [id]);

// 甚至 HTTP API
const user = await fetch(`https://api.example.com/users/${id}`).then(r => r.json());
```

### Q2: 如何处理大量 Procedure 的编译性能？

```typescript
// 使用 lazy loading 和路由拆分
const appRouter = t.router({
  user: userRouter,      // 独立文件
  post: postRouter,      // 独立文件
  comment: commentRouter, // 独立文件
  // ... 更多路由
});

// 如果编译仍然太慢，可以使用 declaration map
// tsconfig.json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "composite": true
  }
}
```

### Q3: tRPC 能否用于微服务间通信？

```typescript
// 服务 A 作为 tRPC client 调用服务 B
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { ServiceBRouter } from 'service-b';

const serviceB = createTRPCClient<ServiceBRouter>({
  links: [
    httpBatchLink({
      url: 'http://service-b:4000/trpc',
      headers: {
        Authorization: `Bearer ${INTERNAL_SERVICE_TOKEN}`,
      },
    }),
  ],
});

// 在服务 A 的 Procedure 中调用服务 B
const appRouter = t.router({
  getDashboardData: protectedProcedure.query(async ({ ctx }) => {
    const [userStats, recentPosts, notifications] = await Promise.all([
      serviceB.analytics.getUserStats.query({ userId: ctx.userId }),
      serviceB.post.feed.query({ limit: 5 }),
      serviceB.notification.getUnread.query(),
    ]);

    return { userStats, recentPosts, notifications };
  }),
});
```

---

## 总结

tRPC 代表了 TypeScript 全栈开发的一次范式跃迁。它证明了一个深刻的洞察：**当你的前后端都使用 TypeScript 时，类型信息本身就足以构成一个完整的 API 契约，不需要额外的 schema 定义、代码生成或运行时开销**。

tRPC 的核心优势可以归纳为：

- **零成本类型安全**：TypeScript 编译器自动推导，无需手动维护或代码生成
- **极致的开发体验**：完整的自动补全、编译时错误检查、重构信心
- **轻量级**：客户端 bundle 仅约 5KB，无额外运行时开销
- **灵活的集成**：与 Next.js、Express、Fastify 等框架无缝集成
- **完善的生态**：Zod 验证、React Query 缓存、WebSocket 订阅一应俱全

当然，tRPC 并非万能的。在以下场景中，传统的 REST + OpenAPI 或 GraphQL 可能更合适：

- 需要为第三方开发者提供公开 API 文档
- 前后端使用不同语言的技术栈
- 需要极度灵活的客户端查询（按需获取字段）

但对于 **TypeScript monorepo 全栈项目**，尤其是中小型团队快速迭代的场景，tRPC 无疑是目前最优的 API 开发方案。它让你把更多的时间花在业务逻辑上，而不是在类型定义和接口文档的维护上。

如果你还在为前后端之间的类型不一致而苦恼，还在忍受 OpenAPI 代码生成的缓慢迭代循环，不妨试试 tRPC。一旦体验过"修改后端代码、前端立刻报错"的开发流程，你就再也不想回去了。

---

**参考资源**

- [tRPC 官方文档](https://trpc.io/docs)
- [tRPC GitHub 仓库](https://github.com/trpc/trpc)
- [Zod 文档](https://zod.dev)
- [TanStack Query 文档](https://tanstack.com/query)
- [Next.js tRPC 集成示例](https://github.com/trpc/trpc/tree/main/examples/next-prisma-starter)

## 相关阅读

- Jetpack Compose 实战：Android 声明式 UI 开发——与 SwiftUI/Flutter 的三端对比
- [Deno Deploy 实战：零配置边缘 JavaScript 部署——对比 Cloudflare Workers 的开发体验与性能](/post/deno-deploy-javascript-cloudflare-workers/)
- [Deno 2.x 实战：安全优先的 JavaScript 运行时——与 Node.js/Bun 的三选一决策](/post/deno-2x-javascript-runtime-nodejs-bun-decision/)
