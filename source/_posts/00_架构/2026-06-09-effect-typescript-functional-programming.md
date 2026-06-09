---
title: Effect 实战：TypeScript 函数式编程框架——类型安全的错误处理、依赖注入与并发原语
date: 2026-06-09 18:55:00
categories:
  - 架构
tags:
  - TypeScript
  - Effect
  - 函数式编程
  - 依赖注入
  - 并发编程
description: 深入探讨 Effect 框架在 TypeScript 中的实战应用，涵盖类型安全的错误处理、依赖注入系统与并发原语，提供可运行的代码示例和踩坑记录。
---

## 概述

在 TypeScript 项目中，错误处理一直是个痛点。传统的 try-catch 破坏了函数的类型签名，Promise 链中的 `.catch()` 让错误类型丢失，而手动传递 Context 参数来做依赖注入则让代码变得冗长不堪。

**Effect** 是一个为 TypeScript 设计的函数式编程框架，它提供了：
- 类型安全的错误处理（错误是类型系统的一部分）
- 声明式依赖注入（不需要 IoC 容器）
- 并发原语（structured concurrency）
- 可组合的程序描述与执行分离

本文通过实际代码示例，展示如何在真实项目中使用 Effect 解决这些问题。

---

## 核心概念

### 1. Effect 的本质

Effect 的核心思想是**描述与执行分离**。一个 Effect 程序是一个值，描述了"要做什么"，而不是"立即执行"。

```typescript
import { Effect, pipe } from "effect";

// 这只是一个描述，不会执行
const program = pipe(
  Effect.succeed(1),
  Effect.map((n) => n + 1),
  Effect.map((n) => n * 2)
);

// 需要显式调用 run 才执行
const result = Effect.runSync(program); // 4
```

这种分离带来几个好处：
- 可以在不执行的情况下分析和转换程序
- 错误处理是结构化的，不会丢失类型信息
- 依赖关系是声明式的，框架自动解析

### 2. 类型安全的错误处理

Effect 将错误作为类型系统的一部分。每个 Effect 值都有两个类型参数：`Effect<Success, Error, Requirements>`。

```typescript
import { Effect } from "effect";

// 可能失败的操作，错误类型是 "NotFoundError"
const findUser = (id: string): Effect.Effect<User, "NotFoundError"> =>
  Effect.gen(function* () {
    const user = yield* db.query(`SELECT * FROM users WHERE id = '${id}'`);
    if (!user) {
      return yield* Effect.fail("NotFoundError");
    }
    return user;
  });

// 调用方必须处理错误
const program = pipe(
  findUser("123"),
  Effect.catchTag("NotFoundError", () =>
    Effect.succeed(defaultUser)
  )
);
```

关键点：错误类型是编译时确定的，不会在运行时"意外"抛出。

### 3. 依赖注入（Service 层）

Effect 使用 Service 模式来做依赖注入，不需要任何 IoC 容器。

```typescript
import { Context, Effect, Layer } from "effect";

// 定义服务接口
interface Database {
  readonly query: (sql: string) => Effect.Effect<unknown[], DatabaseError>;
}

// 创建服务 Tag
const Database = Context.Tag<Database>();

// 实现服务
const makeDatabase = Effect.succeed({
  query: (sql: string) => Effect.promise(() => client.query(sql))
} satisfies Database);

// 提供实现
const DatabaseLive = Layer.succeed(Database, makeDatabase);

// 使用服务（不需要导入任何具体实现）
const program = Effect.gen(function* () {
  const db = yield* Database;
  const users = yield* db.query("SELECT * FROM users");
  return users;
});

// 运行时提供依赖
Effect.runSync(program.pipe(Effect.provide(DatabaseLive)));
```

这种模式的好处是：
- 接口和实现完全解耦
- 测试时可以轻松替换为 Mock
- 依赖关系在类型层面可见

---

## 实战代码

### 示例 1：构建一个 API 服务层

让我们构建一个完整的用户服务，展示 Effect 在实际项目中的应用。

```typescript
import { Effect, Context, Layer, pipe, Data } from "effect";

// ========== 错误定义 ==========
class UserNotFound extends Data.TaggedError("UserNotFound")<{
  readonly userId: string;
}> {}

class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
}> {}

// ========== 服务定义 ==========
interface UserService {
  readonly getById: (id: string) => Effect.Effect<User, UserNotFound | DatabaseError>;
  readonly create: (data: CreateUserInput) => Effect.Effect<User, ValidationError | DatabaseError>;
  readonly list: (query: ListQuery) => Effect.Effect<PaginatedResult<User>, DatabaseError>;
}

const UserService = Context.Tag<UserService>();

interface UserRepository {
  readonly findById: (id: string) => Effect.Effect<RawUser | null, DatabaseError>;
  readonly insert: (data: CreateUserInput) => Effect.Effect<RawUser, DatabaseError>;
  readonly findMany: (query: ListQuery) => Effect.Effect<RawUser[], DatabaseError>;
  readonly count: (query: ListQuery) => Effect.Effect<number, DatabaseError>;
}

const UserRepository = Context.Tag<UserRepository>();

// ========== 服务实现 ==========
const UserServiceLive = Layer.effect(
  UserService,
  Effect.gen(function* () {
    const repo = yield* UserRepository;

    return {
      getById: (id: string) =>
        pipe(
          repo.findById(id),
          Effect.flatMap(
            Effect.fromNullable(() => new UserNotFound({ userId: id }))
          ),
          Effect.map(rawToUser)
        ),

      create: (data: CreateUserInput) =>
        Effect.gen(function* () {
          // 验证
          if (!data.email.includes("@")) {
            return yield* new ValidationError({
              field: "email",
              message: "Invalid email format"
            });
          }
          if (data.name.length < 2) {
            return yield* new ValidationError({
              field: "name",
              message: "Name must be at least 2 characters"
            });
          }

          const raw = yield* repo.insert(data);
          return rawToUser(raw);
        }),

      list: (query: ListQuery) =>
        Effect.gen(function* () {
          const [items, total] = yield* Effect.all([
            repo.findMany(query),
            repo.count(query)
          ]);
          return {
            items: items.map(rawToUser),
            total,
            page: query.page,
            pageSize: query.pageSize
          };
        })
    };
  })
);

// ========== 使用服务 ==========
const program = Effect.gen(function* () {
  const userService = yield* UserService;

  // 获取用户
  const user = yield* userService.getById("user-123");

  // 创建用户（自动处理验证错误）
  const newUser = yield* userService.create({
    email: "test@example.com",
    name: "Alice"
  });

  return { user, newUser };
});

// 提供依赖并运行
const result = Effect.runSync(
  program.pipe(Effect.provide(UserServiceLive))
);
```

### 示例 2：并发控制与重试

Effect 提供了强大的并发原语，包括 `Effect.all`（并发执行）、`Effect.race`（竞赛）、`Effect.retry`（重试）等。

```typescript
import { Effect, pipe, Schedule } from "effect";

// 并发执行多个独立操作
const fetchUserData = (userId: string) =>
  Effect.all(
    [
      fetchProfile(userId),
      fetchOrders(userId),
      fetchPreferences(userId)
    ],
    { concurrency: 3 } // 最多 3 个并发
  );

// 带重试的网络请求
const fetchWithRetry = (url: string) =>
  pipe(
    Effect.tryPromise({
      try: () => fetch(url).then(r => r.json()),
      catch: (e) => new NetworkError({ message: String(e) })
    }),
    Effect.retry(
      Schedule.exponential("100 millis").pipe(
        Schedule.compose(Schedule.recurs(3))
      )
    )
  );

// 竞赛模式：快速超时
const fetchWithTimeout = (url: string) =>
  Effect.race(
    Effect.tryPromise({
      try: () => fetch(url).then(r => r.json()),
      catch: (e) => new NetworkError({ message: String(e) })
    }),
    Effect.sleep("5 seconds").pipe(
      Effect.flatMap(() => Effect.fail(new TimeoutError({ url })))
    )
  );

// 并发限制：批量处理大量数据
const processBatch = (items: string[]) =>
  Effect.forEach(
    items,
    (item) => processItem(item),
    { concurrency: 10 } // 最多 10 个并发
  );
```

### 示例 3：中间件与拦截器模式

Effect 的 `Layer` 机制可以实现类似中间件的功能。

```typescript
import { Effect, Layer } from "effect";

// 日志中间件
const withLogging = <R, E, A>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const start = Date.now();
    const result = yield* effect;
    const duration = Date.now() - start;
    console.log(`Operation completed in ${duration}ms`);
    return result;
  });

// 缓存中间件
const withCache = <R, E, A>(
  key: string,
  ttl: number,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const cached = yield* cache.get(key);
    if (cached) return cached as A;

    const result = yield* effect;
    yield* cache.set(key, result, ttl);
    return result;
  });

// 组合使用
const program = pipe(
  database.query("SELECT * FROM users"),
  withLogging,
  withCache("users:all", 60_000)
);
```

---

## 踩坑记录

### 1. 初始学习曲线陡峭

Effect 的 API 表面积很大，初次上手时容易被各种 `Effect.gen`、`pipe`、`Layer` 搞晕。

**建议**：先从 `Effect.gen`（类似 async/await 的写法）开始，等熟悉了再探索更高级的组合子。

```typescript
// 推荐新手使用 Gen 语法
const program = Effect.gen(function* () {
  const db = yield* Database;
  const user = yield* db.query("...");
  return user;
});

// 而不是 pipe 语法（更函数式但可读性稍差）
const program = pipe(
  Database,
  Effect.flatMap(db => db.query("..."))
);
```

### 2. 与现有代码集成

如果你的项目已经有大量的 Promise-based 代码，渐进式迁移是关键。

```typescript
import { Effect } from "effect";

// 将现有 Promise 函数包装为 Effect
const existingApiCall = (id: string): Promise<User> =>
  fetch(`/api/users/${id}`).then(r => r.json());

const wrapped = Effect.tryPromise({
  try: () => existingApiCall("123"),
  catch: (e) => new ApiError({ message: String(e) })
});

// 或者使用 Effect.async 包装回调式 API
const asyncWrapped = Effect.async<User, ApiError>((resume) => {
  existingApiCall("123").then(
    (user) => resume(Effect.succeed(user)),
    (err) => resume(Effect.fail(new ApiError({ message: String(err) })))
  );
});
```

### 3. Bundle Size 考量

Effect 库本身有一定体积（~50KB minified）。对于小型项目，可能需要权衡。

**建议**：对于大型应用（微服务、复杂前端），Effect 带来的类型安全和可维护性收益远超 bundle cost。对于小型工具库，可以只引入核心模块。

### 4. 错误类型的"泄漏"

有时你会看到错误类型变得非常复杂（联合类型包含十几个错误），这会让类型签名变得冗长。

```typescript
// 不好：错误类型泄漏到调用方
const program: Effect.Effect<
  User,
  UserNotFound | DatabaseError | ValidationError | NetworkError | ...,
  never
> = ...;

// 好：用 Effect.catchTag 在边界处处理
const safeProgram = pipe(
  program,
  Effect.catchTag("UserNotFound", () => Effect.succeed(defaultUser)),
  Effect.catchTag("DatabaseError", (e) => Effect.fail(new SystemError(e)))
);
```

### 5. 测试策略

Effect 的测试非常自然，因为依赖是显式的。

```typescript
import { Effect, Layer } from "effect";

// 测试用的 Mock 层
const MockUserRepository = Layer.succeed(UserRepository, {
  findById: (id) =>
    Effect.succeed({ id, name: "Test User", email: "test@test.com" }),
  insert: (data) => Effect.succeed({ id: "new-id", ...data }),
  findMany: () => Effect.succeed([]),
  count: () => Effect.succeed(0)
});

// 测试
it("should get user by id", () => {
  const result = Effect.runSync(
    program.pipe(
      Effect.provide(MockUserRepository),
      Effect.provide(UserServiceLive)
    )
  );
  expect(result.name).toBe("Test User");
});
```

---

## 与传统方案的对比

| 特性 | 传统 try-catch | Effect |
|------|---------------|--------|
| 错误类型 | `unknown` / `any` | 编译时确定 |
| 依赖管理 | 手动传递或 IoC 容器 | 声明式 Service |
| 并发控制 | `Promise.all` + 手动管理 | `Effect.all` + structured |
| 可测试性 | 需要 mock 整个模块 | 替换 Layer 即可 |
| 组合性 | 差（错误处理分散） | 优秀（错误是类型的一部分） |
| 学习曲线 | 低 | 中高 |

---

## 总结

Effect 为 TypeScript 带来了 Haskell/Scala 级别的类型安全和函数式编程能力，但以一种对 JavaScript 生态友好的方式。它的核心价值在于：

1. **类型安全的错误处理**：错误不再是"异常"，而是类型系统的一等公民
2. **声明式依赖注入**：不需要 IoC 容器，依赖关系在类型层面可见
3. **结构化并发**：`Effect.all`、`Effect.race` 提供了安全的并发原语
4. **可组合性**：程序是值，可以自由组合和转换

**适用场景**：
- 中大型 TypeScript 后端服务
- 复杂的前端状态管理
- 需要严格错误处理的金融/医疗系统
- 团队协作的 monorepo 项目

**不适用场景**：
- 小型 CLI 工具
- 简单的 CRUD 应用
- 对 bundle size 敏感的客户端库

Effect 不是银弹，但它确实解决了 TypeScript 项目中许多长期存在的痛点。如果你正在寻找一种更可靠的方式来组织 TypeScript 代码，Effect 值得认真考虑。

---

*参考资源：*
- [Effect 官方文档](https://effect.website/)
- [Effect GitHub 仓库](https://github.com/Effect-TS/effect)
- [Effect Examples](https://github.com/Effect-TS/effect/tree/main/examples)
