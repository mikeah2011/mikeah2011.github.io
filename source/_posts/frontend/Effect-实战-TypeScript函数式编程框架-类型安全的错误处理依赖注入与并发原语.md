---
title: Effect 实战：TypeScript 函数式编程框架——类型安全的错误处理、依赖注入与并发原语
date: 2026-06-04 10:00:00
tags:
- Effect
- TypeScript
- 函数式编程
- 错误处理
- 依赖注入
description: 深入解析 Effect 框架核心概念与工程实战：涵盖 Effect 三层类型模型（Success/Error/Requirements）、Data.TaggedError
  结构化错误定义、catchTag/catchTags 模式匹配式错误捕获、Layer/Context/Tag 编译时依赖注入体系、Fiber 协程并发原语（fork/join/race/all）、Schedule
  声明式重试策略（指数退避与抖动）、Schema 类型安全数据验证与编解码、Stream 背压流处理，并附带完整 API 客户端示例、与 NestJS DI 及
  fp-ts 的详细对比和迁移路径，帮助 TypeScript 开发者掌握函数式编程在生产环境中的最佳实践。
categories:
- frontend
cover: /images/covers/effect-ts-functional-programming-cover.jpg
---



# Effect 实战：TypeScript 函数式编程框架——类型安全的错误处理、依赖注入与并发原语

在现代 TypeScript 工程实践中，我们常常面临一个尴尬的现实：TypeScript 的类型系统非常强大，但在错误处理、依赖管理和并发控制方面，我们仍然大量依赖运行时机制和编码规范约束。Effect 框架的出现彻底改变了这一局面——它将函数式编程的核心理念与 TypeScript 的类型系统深度结合，提供了一套从错误处理到依赖注入、从并发原语到流式数据处理的完整解决方案。

本文将从实际工程痛点出发，通过大量真实代码示例，带你深入理解 Effect 框架的核心概念和实战技巧。无论你是函数式编程的新手还是资深开发者，都能从中获得有价值的启示。

---

## 一、为什么需要 Effect：TypeScript 错误处理的痛点与函数式方案

### 1.1 TypeScript 错误处理的现状与困境

在日常 TypeScript 开发中，错误处理通常依赖 `try/catch` 机制。这种方式看似简单直观，但在实际工程中存在诸多深层次的问题。

首先来看一段典型的代码：

```typescript
async function fetchUser(id: string) {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    // error 的类型是 unknown
    // 我们无法在编译期知道这里可能捕获到哪些类型的错误
    if (error instanceof Error) {
      console.error(error.message);
    }
    throw error;
  }
}
```

这段代码的问题远比表面上看起来的要深刻。第一个核心痛点是**错误类型丢失**。在 `catch` 块中，`error` 的类型始终是 `unknown`，编译器无法帮助我们区分网络错误、JSON 解析错误、业务逻辑错误等不同类型的异常。我们只能在运行时通过 `instanceof` 检查来猜测错误的类型，这不仅冗长而且容易遗漏。

第二个核心痛点是**函数签名的不透明性**。从 `fetchUser` 的函数签名 `async function fetchUser(id: string)` 来看，调用者完全无法从类型层面得知这个函数可能抛出什么错误。唯一的办法是查阅文档或阅读源码，但文档可能过时，源码可能很复杂。更糟糕的是，如果底层实现发生变化，新增了某种错误类型，调用方不会收到任何编译时警告。

第三个核心痛点是**错误处理的非强制性**。`throw` 只是一个运行时行为，编译器不会强制调用方处理它。一个开发者可能写出 `const user = await fetchUser("123")` 而完全忽略错误处理，代码仍然能通过编译，直到生产环境遇到异常才暴露问题。

第四个核心痛点是**组合困难**。当多个可能失败的操作需要组合时，错误处理逻辑会嵌套得越来越深。想象一下依次调用三个 API、解析响应、验证数据、写入数据库的场景，如果每一步都需要 `try/catch`，代码将迅速变成嵌套地狱。

第五个痛点是**异常的非局部性**。异常的抛出点和捕获点可能相隔甚远，调用栈中间的函数完全不知道某个操作可能会抛出异常。这使得代码的推理变得困难，尤其是在大型代码库中，一个底层函数新增的 `throw` 可能影响到上层数十个调用者，但编译器不会给出任何提示。

这些痛点在小型项目中或许可以容忍，但在大型企业级应用中，它们会累积成严重的工程问题。维护者花费大量时间去追溯错误来源，排查未处理的异常，以及应对意料之外的运行时崩溃。这些问题在微服务架构和分布式系统中尤为突出，因为跨服务的错误传播更加复杂和不可预测。Effect 框架正是为了解决这些根本性的工程问题而诞生的。

### 1.2 函数式编程的解决方案：错误即值

函数式编程提出了一个优雅且彻底的解决方案：**将错误视为值（Error as Value）**。与其抛出异常，不如将错误作为函数返回值的一部分。这样一来，错误就成为了类型系统可以追踪和约束的普通数据。

最简单的形式是 `Either` 类型：

```typescript
// Either 类型：要么是 Left（错误），要么是 Right（成功）
type Either<E, A> = 
  | { readonly _tag: "Left"; readonly left: E } 
  | { readonly _tag: "Right"; readonly right: A };

// 使用 Either 的函数，错误类型一目了然
function parseAge(input: string): Either<string, number> {
  const n = parseInt(input, 10);
  if (isNaN(n)) return { _tag: "Left", left: "不是有效的数字" };
  if (n < 0 || n > 150) return { _tag: "Left", left: "年龄超出合理范围" };
  return { _tag: "Right", right: n };
}
```

这种方式的优势在于：从函数签名 `Either<string, number>` 可以立即看出，这个操作可能失败（返回 `string` 类型的错误），也可能成功（返回 `number` 类型的值）。编译器会强制你处理这两种情况，否则无法获取到内部的值。

然而，`Either` 只解决了错误追踪的问题。在实际应用中，我们还需要处理异步操作、依赖管理、并发控制等更多挑战。Effect 框架在此基础上进行了全面的扩展，提供了 `Effect<Success, Error, Requirements>` 三层类型模型，不仅追踪错误，还追踪依赖关系，形成了一套完整的应用构建体系。

### 1.3 Effect 的全景视图

Effect 不是一个轻量级的工具函数库，而是一个功能完备的应用开发框架。它提供了以下核心能力：

**类型安全的错误处理**：错误类型体现在函数签名中，编译器在编译阶段就能发现遗漏的错误处理逻辑。每种错误都有结构化的标签，支持模式匹配式的精确捕获。

**依赖注入系统**：通过 `Layer`、`Context`、`Tag` 三个核心概念实现编译时安全的依赖管理。依赖关系完全体现在类型参数中，未满足的依赖会导致编译失败。与传统的装饰器注入不同，这种方式不需要运行时反射，完全利用 TypeScript 的类型推断能力。

**并发原语**：基于 Fiber（协程）的轻量级并发模型，支持 `fork`、`join`、`race`、`all` 等操作。Fiber 由运行时管理，创建成本极低，可以轻松创建数十万个并发任务。

**重试与调度策略**：声明式的 `Schedule` 策略系统，支持指数退避、固定间隔、抖动、组合策略等高级能力，无需手写循环和计时器。

**Schema 验证**：类型安全的数据校验与编解码系统，将运行时验证与 TypeScript 类型推断深度集成，替代了传统的 JSON Schema 和 io-ts 方案。

**Stream 流处理**：支持背压的流式数据处理，可以高效处理大规模数据集而不会导致内存溢出。

**结构化日志与可观测性**：内置的 Logging、Tracing 和 Metrics 系统，无需引入额外的第三方库。

---

## 二、Effect 核心类型：Effect\<Success, Error, Requirements\> 三层模型

### 2.1 三个类型参数的深层含义

Effect 的核心类型是 `Effect<A, E, R>`，这是整个框架的基石。理解这三个类型参数是掌握 Effect 的关键第一步。

```typescript
// Effect<Success, Error, Requirements>
// A (Success): 操作成功时返回的值的类型
// E (Error): 操作失败时产生的错误的类型  
// R (Requirements): 操作执行时所需的依赖（上下文/环境）
```

**第一个参数 A（Success）**代表操作成功时返回的值的类型。这是最直观的参数，类似于普通函数的返回值类型。例如 `Effect<User, never, never>` 表示成功时返回一个 `User` 对象，`never` 表示不可能失败，也不需要任何外部依赖。

**第二个参数 E（Error）**代表操作失败时可能产生的错误类型。这是 Effect 相比普通函数最大的改进之处——错误类型被显式地追踪。当 `E` 为 `never` 时，表示该操作永远不会失败。当 `E` 是一个联合类型如 `NetworkError | ValidationError` 时，表示操作可能产生这两种错误中的任何一种。

**第三个参数 R（Requirements）**代表操作执行时需要的外部依赖。这是 Effect 的依赖注入机制在类型层面的体现。当 `R` 为 `never` 时，表示该操作是自包含的，不需要任何外部依赖。当 `R` 包含如 `HttpClient | Logger` 时，表示必须提供这两个服务才能运行该 Effect。

```typescript
import { Effect } from "effect";

// 成功值：不会失败，不需要依赖
const greeting: Effect.Effect<string, never, never> = Effect.succeed("你好，Effect！");

// 可能失败的操作：失败类型为 Error
const risky: Effect.Effect<string, Error, never> = Effect.fail(new Error("出错了"));

// 有依赖的操作：需要 UserService
const getUser: Effect.Effect<User, UserError, UserService> = ...;
```

这种三层类型模型的精妙之处在于：你可以从函数签名中获得关于该操作的完整信息。调用一个 Effect 之前，你知道它会返回什么（A），可能出什么错（E），以及你需要提供什么（R）。这种透明性在大型项目中价值巨大。

与传统的 `Promise<T>` 相比，`Promise` 只有一个类型参数 `T`，无法表达可能的错误类型，也无法声明依赖需求。而 `Effect<T, E, R>` 的三个参数覆盖了计算的三个维度：结果、失败和环境。当一个函数的 `R` 类型参数不是 `never` 时，TypeScript 编译器会阻止你直接运行它，强制你先提供所需的依赖。当 `E` 不是 `never` 时，你必须处理这些可能的错误才能拿到成功值。这种编译时的强制约束从根本上消除了"忘记处理错误"和"忘记注入依赖"的可能性。

### 2.2 创建 Effect 的多种方式

Effect 提供了多种创建方式，覆盖了同步、异步、可能抛异常等不同场景：

```typescript
import { Effect } from "effect";

// succeed: 包装一个已知的成功值
const success = Effect.succeed(42);

// fail: 包装一个已知的失败值
const failure = Effect.fail(new Error("出错了"));

// sync: 包装一个同步计算（惰性执行，不会立即执行）
const computation = Effect.sync(() => {
  console.log("执行计算...");
  return Math.random();
});

// promise: 包装一个 Promise
const fromPromise = Effect.promise(() => fetch("/api/data").then(r => r.json()));

// try: 从可能抛出异常的同步代码创建 Effect
const safeParse = Effect.try({
  try: () => JSON.parse("{无效的JSON}"),
  catch: (unknownError) => new Error(`JSON 解析失败: ${String(unknownError)}`),
});

// tryPromise: 从可能抛出异常的异步代码创建 Effect
const safeFetch = Effect.tryPromise({
  try: () => fetch("https://api.example.com/data").then(res => res.json()),
  catch: (unknownError) => new Error(`请求失败: ${String(unknownError)}`),
});
```

这里需要特别注意 `try` 和 `tryPromise` 中的 `catch` 参数。它是必需的，因为原始异常的类型是 `unknown`，Effect 要求你显式地将其转换为一个已知的错误类型。这个设计决策确保了错误类型从创建时就是明确的。

### 2.3 运行 Effect：惰性求值与执行

Effect 的一个关键特性是**惰性求值**（Lazy Evaluation）。创建一个 Effect 不会执行任何代码，只有当你显式运行它时才会执行。这与 `Promise` 不同——创建 Promise 时回调函数会立即执行。

```typescript
import { Effect, Runtime } from "effect";

const program = Effect.sync(() => {
  console.log("这行代码只有在运行时才会执行");
  return 42;
});

// 此时什么都不会发生，因为 Effect 还没有被运行

// 同步运行（仅适用于不会失败且不需要依赖的 Effect）
const result = Runtime.runSync(program);

// 异步运行（返回 Promise，适用于所有场景）
await Runtime.runPromise(program).then(console.log);

// 以 Exit 状态运行（可以观察成功/失败的完整信息）
const exit = Runtime.runSyncExit(program);
// exit 可能是 Exit.Success(42) 或 Exit.Failure(...)
```

惰性求值的优势在于：你可以自由地组合、变换、重试一个 Effect，而不用担心副作用被执行多次。只有最终运行时才会执行一次。

### 2.4 管道式组合：pipe 与链式操作

Effect 大量使用 `pipe` 函数进行组合。`pipe` 将值从左到右依次传递给一系列函数，每个函数接收上一步的结果并返回变换后的值。这种风格类似于 Unix 管道命令。

```typescript
import { Effect, pipe } from "effect";

const program = pipe(
  Effect.succeed(10),                    // 起始值: 10
  Effect.map((n) => n * 2),              // 变换: 20
  Effect.flatMap((n) =>                  // 扁平化嵌套的 Effect
    Effect.succeed(n + 5)
  ),                                      // 结果: 25
  Effect.tap((result) =>                 // 副作用（不影响值）
    Effect.sync(() => console.log(`当前结果: ${result}`))
  )
);
```

`pipe` 的链式调用使得复杂逻辑变得清晰可读，每一步的输入输出类型都能被 TypeScript 编译器精确推断。当某一步的类型不匹配时，编译器会立即报错，帮助你在编码阶段就发现问题。

---

## 三、类型安全的错误处理：tagged errors、catchAll、catchTag、错误合并

### 3.1 Tagged Errors：结构化的错误定义

在 Effect 中，我们推荐使用 Tagged Errors 来定义结构化的错误类型。每个错误都有一个 `_tag` 字段作为辨识标签，这使得错误处理可以通过模式匹配来实现，类似于代数数据类型（ADT）中的 sum type。

```typescript
import { Data } from "effect";

// 使用 Data.TaggedError 创建结构化的错误类
class UserNotFoundError extends Data.TaggedError("UserNotFoundError")<{
  readonly userId: string;
}> {}

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly url: string;
  readonly statusCode: number;
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
}> {}
```

使用 `Data.TaggedError` 创建的错误类有几个重要特性：自动带有不可变的 `_tag` 字段用于模式匹配；构造函数参数会被存储为只读属性；支持 `new` 关键字直接实例化；实例可以被序列化以便日志记录和远程传输。

```typescript
const notFound = new UserNotFoundError({ userId: "abc123" });
console.log(notFound._tag);    // "UserNotFoundError"
console.log(notFound.userId);  // "abc123"
// notFound.userId = "xyz";    // 编译错误：readonly 属性
```

### 3.2 在函数签名中声明错误类型

使用 Tagged Errors 之后，函数签名可以精确地声明该函数可能产生的所有错误类型。这是 Effect 最核心的价值之一：

```typescript
import { Effect } from "effect";

// 函数签名清晰地告诉我们：
// - 成功时返回 User
// - 可能产生 UserNotFoundError 或 NetworkError
// - 需要 HttpClient 依赖
const fetchUser = (
  id: string
): Effect.Effect<User, UserNotFoundError | NetworkError, HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient;
    const response = yield* client.get(`/api/users/${id}`);
    // ... 解析并返回用户
  });
```

调用者看到这个签名，立刻就知道必须处理这两种错误，并且需要提供 `HttpClient` 依赖。这种透明性在团队协作中极其宝贵——新人不需要阅读文档就能理解代码的行为边界。

### 3.3 catchAll：处理所有错误

当你需要统一处理所有可能的错误时，使用 `catchAll`：

```typescript
import { Effect, pipe } from "effect";

const safeFetchUser = pipe(
  fetchUser("123"),
  Effect.catchAll((error) => {
    // error 的类型自动推断为 UserNotFoundError | NetworkError
    // 编译器确保你处理了所有可能的错误分支
    if (error._tag === "UserNotFoundError") {
      console.log(`用户 ${error.userId} 不存在`);
      return Effect.succeed({ id: error.userId, name: "默认用户" });
    }
    // 此时 error 被窄化为 NetworkError
    console.log(`网络错误: ${error.statusCode}`);
    return Effect.fail(new Error("服务不可用"));
  })
);
```

TypeScript 的类型收窄（Type Narrowing）在 `if` 判断后自动生效，使得 `else` 分支中的 `error` 类型被精确推断为 `NetworkError`。

### 3.4 catchTag：按标签精确捕获

`catchTag` 是 Effect 中最强大的错误处理工具，它利用 `_tag` 字段实现模式匹配式的错误捕获：

```typescript
import { Effect, pipe } from "effect";

const program = pipe(
  fetchUser("123"),
  Effect.catchTag("UserNotFoundError", (error) => {
    // 此处 error 的类型精确地是 UserNotFoundError
    // 可以安全地访问 error.userId
    console.log(`用户 ${error.userId} 未找到，返回默认用户`);
    return Effect.succeed({ id: error.userId, name: "默认用户" });
  }),
  Effect.catchTag("NetworkError", (error) => {
    // 此处 error 的类型精确地是 NetworkError
    // 可以安全地访问 error.url 和 error.statusCode
    console.log(`请求 ${error.url} 失败，状态码: ${error.statusCode}`);
    return Effect.fail(new Error("网络服务不可用"));
  })
);
```

`catchTag` 的强大之处在于：如果你漏掉了某个错误类型，TypeScript 编译器会报错。例如，如果 `fetchUser` 的错误类型包含 `ValidationError`，但你没有 `catchTag("ValidationError", ...)`，编译器会在 `program` 的最终类型中保留这个未处理的错误类型，导致后续代码出现类型不匹配的编译错误。

### 3.5 catchTags：批量处理多种错误

当你需要对多种错误进行统一处理时，`catchTags` 比逐个调用 `catchTag` 更加简洁：

```typescript
const program = pipe(
  fetchUser("123"),
  Effect.catchTags({
    UserNotFoundError: (error) =>
      Effect.succeed({ id: error.userId, name: "默认用户", source: "fallback" }),
    NetworkError: (error) =>
      Effect.fail(new Error(`网络异常: ${error.url} 返回 ${error.statusCode}`)),
  })
);
```

`catchTags` 要求你一次性提供所有可能的错误标签的处理函数，这既保证了完整性，又保持了代码的简洁。

### 3.6 错误类型的自动合并与组合

当多个 Effect 通过 `flatMap`、`all` 等方式组合时，它们的错误类型会自动合并为联合类型：

```typescript
const fetchUserEffect: Effect.Effect<User, UserNotFoundError, never> = ...;
const fetchPostsEffect: Effect.Effect<Post[], NetworkError, never> = ...;

// 组合后错误类型自动合并
const combined = Effect.all([fetchUserEffect, fetchPostsEffect]);
// 类型: Effect<[User, Post[]], UserNotFoundError | NetworkError, never>

// 使用 pipe 组合也会自动合并
const pipeline = pipe(
  fetchUserEffect,
  Effect.flatMap((user) => fetchPostsEffect)
);
// 类型: Effect<Post[], UserNotFoundError | NetworkError, never>
```

这种自动合并意味着开发者在编译期就能看到一个操作的完整错误空间，不会遗漏任何潜在的失败路径。随着应用规模的增长，这种类型安全的保证变得越来越重要。

---

## 四、依赖注入：Layer、Context、Service 模式，对比 NestJS DI

### 4.1 传统依赖注入方案的局限

在 TypeScript 生态中，NestJS 是最流行的依赖注入框架。它通过装饰器和运行时反射来实现依赖管理，虽然功能完备，但存在一些固有的局限。

首先，NestJS 的依赖注入在运行时才能完全验证。如果某个服务忘记注册到模块中，错误要到运行时才会暴露。其次，装饰器的使用使得单元测试需要启动完整的 DI 容器，增加了测试的复杂度和运行时间。再者，模块系统的组合方式相对刚性，不够灵活。

Effect 提出了一种截然不同的方案：将依赖关系编码到类型系统中。如果一个 Effect 的 `Requirements` 参数不是 `never`，说明它有未满足的依赖，编译器会阻止运行。这种设计将依赖检查从运行时提升到了编译时。

具体来说，Effect 的依赖注入模型有以下几个显著优势。首先，依赖关系是声明式的——你只需要在类型签名中声明需要什么，而不需要关心如何获取。其次，依赖是可组合的——多个 Layer 可以像流水线一样组装，形成完整的服务图。第三，依赖是可替换的——测试时只需提供不同的 Layer，就能用 Mock 替换真实实现，无需修改任何业务代码。第四，依赖是有顺序的——如果服务 A 依赖服务 B，Layer 组合时会自动保证 B 先于 A 被创建。这种编译时的顺序保证消除了运行时"依赖未就绪"的经典问题。

### 4.2 核心概念：Context、Tag、Layer

Effect 的依赖注入系统由三个核心概念构成：

**Tag（标签）**是服务的唯一标识符。每个服务都有一个对应的 Tag，用于在上下文中查找该服务的实现。Tag 本质上是一个带有类型信息的标识对象。

**Context（上下文）**是一个键值映射，将 Tag 映射到具体的服务实例。你可以把它理解为一个类型安全的依赖容器。

**Layer（层）**是创建服务实例的蓝图。它描述了如何构建一个或多个服务，以及构建这些服务需要哪些其他依赖。Layer 可以组合，形成更复杂的服务图。

```typescript
import { Context, Effect, Layer } from "effect";

// 第一步：定义服务接口
interface UserRepository {
  readonly findById: (id: string) => Effect.Effect<User, UserNotFoundError>;
  readonly save: (user: User) => Effect.Effect<void, never>;
  readonly deleteById: (id: string) => Effect.Effect<void, UserNotFoundError>;
}

// 第二步：创建服务的 Tag
const UserRepository = Context.Tag<UserRepository>();

// 第三步：编写使用服务的业务代码
const getUser = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* UserRepository; // 从上下文中获取服务
    const user = yield* repo.findById(id);
    yield* Effect.log(`成功获取用户: ${user.name}`);
    return user;
  });
```

注意 `getUser` 函数的类型：`Effect.Effect<User, UserNotFoundError, UserRepository>`。第三个参数 `UserRepository` 告诉我们，要运行这个 Effect，必须先提供 `UserRepository` 服务的实现。这就是类型层面的依赖声明。

### 4.3 提供服务实现：Layer.succeed 与 Layer.effect

**Layer.succeed** 用于提供一个不需要任何外部依赖就能创建的服务实现：

```typescript
const UserRepositoryLive = Layer.succeed(
  UserRepository,
  {
    findById: (id: string) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () => fetch(`/api/users/${id}`),
          catch: () => new NetworkError({ url: `/api/users/${id}`, statusCode: 500 }),
        });
        if (!response.ok) {
          return yield* Effect.fail(new UserNotFoundError({ userId: id }));
        }
        return yield* Effect.tryPromise({
          try: () => response.json() as Promise<User>,
          catch: () => new Error("JSON 解析错误"),
        });
      }),
    save: (user: User) =>
      Effect.tryPromise({
        try: () =>
          fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(user),
          }),
        catch: () => new NetworkError({ url: "/api/users", statusCode: 500 }),
      }).pipe(Effect.as(void 0)),
    deleteById: (id: string) =>
      Effect.tryPromise({
        try: () => fetch(`/api/users/${id}`, { method: "DELETE" }),
        catch: () => new NetworkError({ url: `/api/users/${id}`, statusCode: 500 }),
      }).pipe(Effect.as(void 0)),
  }
);
```

**Layer.effect** 用于创建依赖其他服务的服务层。例如，一个日志服务可能需要读取配置才能初始化：

```typescript
const AppConfig = Context.Tag<{ readonly dbUrl: string; readonly logLevel: string }>();
const Logger = Context.Tag<{
  readonly info: (msg: string) => Effect.Effect<void>;
  readonly error: (msg: string) => Effect.Effect<void>;
}>();

// Logger 的实现依赖 AppConfig
const LoggerLive = Layer.effect(
  Logger,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return {
      info: (msg: string) =>
        Effect.sync(() => console.log(`[${config.logLevel}] ${msg}`)),
      error: (msg: string) =>
        Effect.sync(() => console.error(`[ERROR] ${msg}`)),
    };
  })
);
```

### 4.4 Layer 的组合与提供

Layer 的强大之处在于组合。你可以像搭积木一样将多个层拼装成完整的应用：

```typescript
import { Layer, pipe } from "effect";

// 基础配置层
const AppConfigLive = Layer.succeed(AppConfig, {
  dbUrl: "postgresql://localhost:5432/mydb",
  logLevel: "info",
});

// 组合：AppConfig -> Logger
const AppLayer = pipe(
  AppConfigLive,
  Layer.merge(LoggerLive)
);

// 提供依赖并运行
const program = getUser("123").pipe(
  Effect.provide(UserRepositoryLive),
  Effect.provide(AppLayer)
);
```

`Effect.provide` 方法将一个 Layer 注入到 Effect 中，消除了类型参数中的 Requirements。当所有依赖都被满足后，`R` 变为 `never`，Effect 就可以被运行了。

### 4.5 用于测试的 Mock Layer

在测试中，我们只需提供一个不同的 Layer 即可替换服务实现，无需启动任何容器：

```typescript
import { Layer, Effect, Ref } from "effect";

// 测试用的 Mock 实现
const UserRepositoryTest = Layer.succeed(
  UserRepository,
  {
    findById: (id: string) =>
      Effect.succeed({ id, name: "测试用户", email: "test@example.com" }),
    save: () => Effect.void,
    deleteById: () => Effect.void,
  }
);

// 或者使用可变状态的 Mock（可以验证调用记录）
const UserRepositoryMock = Layer.effect(
  UserRepository,
  Effect.gen(function* () {
    const calls = yield* Ref.make<string[]>([]);
    return {
      findById: (id: string) =>
        Ref.update(calls, (list) => [...list, `findById:${id}`]).pipe(
          Effect.as({ id, name: "测试用户", email: "test@example.com" })
        ),
      save: () => Ref.update(calls, (list) => [...list, "save"]).pipe(Effect.as(void 0)),
      deleteById: (id: string) =>
        Ref.update(calls, (list) => [...list, `deleteById:${id}`]).pipe(Effect.as(void 0)),
    };
  })
);
```

### 4.6 与 NestJS DI 的详细对比

| 特性 | NestJS DI | Effect DI |
|------|-----------|-----------|
| 类型安全级别 | 运行时检查 | 编译时完全类型推断 |
| 依赖声明方式 | 装饰器 + 构造函数参数注入 | 函数签名中的 `R` 类型参数 |
| 验证时机 | 运行时（启动时） | 编译时 |
| 测试方式 | 需要创建测试模块并启动 DI 容器 | 直接替换 Layer，无需容器 |
| 组合方式 | 模块系统（imports/exports） | Layer 管道组合 |
| 范围控制 | 作用域（Singleton/Request/Transient） | 通过 Layer 生命周期控制 |
| 循环依赖检测 | 运行时报错 | 编译时报错 |
| 适用场景 | HTTP 服务端框架 | 通用（前后端、CLI、库） |

---

## 五、并发原语：fiber、fork、join、race、zip、all、sleep

### 5.1 Fiber 概述：用户态的轻量级协程

Effect 的并发模型基于 Fiber（协程），这是一种由运行时系统管理的用户态轻量级执行单元。与操作系统线程不同，Fiber 的创建和切换不需要内核态切换，开销极低。一个典型的 Node.js 进程可以轻松创建数十万个 Fiber 而不会产生明显的性能问题。

Fiber 与 Promise 的一个关键区别在于：Fiber 创建后不会立即开始执行，而是由运行时的调度器决定何时运行。这使得 Effect 能够实现真正的并发（而非仅仅是异步），包括并行执行、竞争执行、带超时的执行等高级模式。

在传统的 JavaScript 并发模型中，我们主要依赖 `Promise.all` 和 `Promise.race` 来组合异步操作。但这些原生 API 存在局限性：`Promise.all` 无法限制并发数量，容易导致"请求风暴"；`Promise.race` 无法自动取消失败的任务，可能导致资源泄漏；缺乏原生的"中断"机制，一旦开始的任务无法优雅地取消。Effect 的 Fiber 模型解决了这些根本性问题，提供了工业级的并发原语。

### 5.2 fork 与 join：创建和等待 Fiber

`fork` 在后台创建一个 Fiber 并立即返回 Fiber 句柄，不会阻塞当前 Fiber 的执行。`join` 则等待指定的 Fiber 完成并获取其结果。

```typescript
import { Effect } from "effect";

const program = Effect.gen(function* () {
  // fork 创建两个后台 Fiber，它们会并行执行
  const fiber1 = yield* Effect.fork(
    Effect.gen(function* () {
      yield* Effect.sleep("2 seconds");
      console.log("任务 1 完成");
      return 10;
    })
  );

  const fiber2 = yield* Effect.fork(
    Effect.gen(function* () {
      yield* Effect.sleep("1 second");
      console.log("任务 2 完成");
      return 20;
    })
  );

  // join 等待两个 Fiber 都完成
  const result1 = yield* Effect.join(fiber1);
  const result2 = yield* Effect.join(fiber2);

  return result1 + result2; // 30，总耗时约 2 秒而非 3 秒
});
```

由于两个 Fiber 是并行执行的，总耗时取决于最慢的那个（2 秒），而非两者之和（3 秒）。这种并发模式在处理多个独立的 I/O 操作时非常有用。

### 5.3 race：竞争执行，胜者通吃

`race` 同时启动多个 Effect，返回第一个完成的结果，并自动中断其余仍在执行的 Fiber。这个模式在需要实现超时机制或多源数据竞争时非常实用。

```typescript
const fastEndpoint = Effect.gen(function* () {
  yield* Effect.sleep("100 millis");
  return "快速 API 的响应";
});

const slowEndpoint = Effect.gen(function* () {
  yield* Effect.sleep("5 seconds");
  return "慢速 API 的响应";
});

// 哪个先完成就用哪个的结果
const program = Effect.gen(function* () {
  const result = yield* Effect.race(fastEndpoint, slowEndpoint);
  console.log(result); // "快速 API 的响应"
  // 慢速 endpoint 会被自动中断
});
```

实现超时的典型用法：

```typescript
const withTimeout = <A, E, R>(effect: Effect.Effect<A, E, R>, duration: string) =>
  Effect.race(
    effect,
    Effect.sleep(duration).pipe(Effect.as(new Error("操作超时")))
  );
```

### 5.4 all：并行执行，全部成功

`all` 并行执行多个 Effect，等待所有完成。它有两种使用形式：

```typescript
// 数组形式：结果保持顺序
const program = Effect.gen(function* () {
  const [users, posts, comments] = yield* Effect.all([
    fetchUsers(),
    fetchPosts(),
    fetchComments(),
  ]);
  return { users, posts, comments };
});

// 记录形式：结果按名称访问
const program2 = Effect.gen(function* () {
  const result = yield* Effect.all({
    users: fetchUsers(),
    posts: fetchPosts(),
    comments: fetchComments(),
  });
  return { users: result.users, posts: result.posts };
});
```

`all` 还支持 `concurrency` 选项来限制并发数，防止同时发起过多请求压垮服务端。这在实际工程中非常关键——例如你需要对 1000 个用户 ID 发起查询请求，如果同时发起全部 1000 个请求，很可能导致目标服务过载或本地连接池耗尽。通过设置 `concurrency: 10`，Effect 会自动调度，最多同时执行 10 个请求，一个完成后立即补充下一个，始终保持 10 个并发度，既高效又安全：

```typescript
// 每次最多 10 个并发，而不是同时 100 个
const results = yield* Effect.all(
  userIds.map((id) => fetchUser(id)),
  { concurrency: 10 }
);
```

### 5.5 zip：顺序组合

与 `all` 的并行执行不同，`zip` 严格按顺序执行两个 Effect，返回结果元组：

```typescript
const program = pipe(
  Effect.sync(() => {
    console.log("第一步");
    return 1;
  }),
  Effect.zip(Effect.sync(() => {
    console.log("第二步");
    return 2;
  }))
);
// 先打印 "第一步"，再打印 "第二步"
// 结果: [1, 2]
```

### 5.6 sleep：延迟执行

`sleep` 使当前 Fiber 暂停指定的时间，不会阻塞其他 Fiber：

```typescript
const delayedTask = Effect.gen(function* () {
  console.log("开始");
  yield* Effect.sleep("500 millis");
  console.log("500毫秒后");
  yield* Effect.sleep("1 second");
  console.log("再过1秒");
  return "完成";
});
```

### 5.7 Fiber 的中断与资源清理

Fiber 支持优雅中断，中断时会触发通过 `addFinalizer` 注册的清理逻辑。这类似于 `try/finally`，但在并发场景下也能正确工作：

```typescript
const longRunningTask = Effect.gen(function* () {
  // 注册清理逻辑
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => console.log("正在清理资源..."))
  );
  // 永不完成的操作
  yield* Effect.never;
});

const program = Effect.gen(function* () {
  const fiber = yield* Effect.fork(longRunningTask);
  yield* Effect.sleep("2 seconds");
  // 中断 fiber，自动触发清理
  yield* Effect.interrupt(fiber);
  console.log("Fiber 已被中断，资源已清理");
});
```

---

## 六、重试策略与调度器（Schedule）：exponential、recurs、spaced

### 6.1 Schedule 的设计理念

在分布式系统中，网络请求、数据库操作等外部调用经常会临时失败。手动编写重试逻辑不仅繁琐，而且容易出错——忘记添加最大重试次数限制、没有指数退避导致服务雪崩、重试逻辑与业务逻辑耦合等。

Effect 的 `Schedule` 是一个声明式的重试策略描述器。它将重试策略从重试逻辑中解耦出来，使得策略可以独立定义、自由组合、复用和测试。

声明式重试策略的价值在于关注点分离。在传统的命令式编程中，重试逻辑通常与业务逻辑混杂在一起——循环、计数器、延迟等待散落在各个函数中，难以复用和统一修改。而使用 Effect 的 Schedule，你可以将重试策略定义为一个独立的、可复用的值，在不同场景中共享。例如，你可以定义一个通用的"网络请求重试策略"，在所有的 HTTP 客户端方法中复用，而不需要在每个方法中重复编写重试逻辑。当需要调整重试行为时，只需修改策略定义，所有使用该策略的地方都会自动更新。

### 6.2 常用内置策略

Effect 提供了丰富的内置策略，可以满足大多数常见场景：

```typescript
import { Effect, Schedule, pipe } from "effect";

const flakyRequest = Effect.tryPromise({
  try: () => fetch("/api/unstable"),
  catch: () => new NetworkError({ url: "/api/unstable", statusCode: 500 }),
});

// 指数退避：每次重试间隔翻倍（1s, 2s, 4s, 8s...）
const exponentialBackoff = Schedule.exponential("1 second");

// 固定间隔：每 500 毫秒重试一次
const fixedInterval = Schedule.spaced("500 millis");

// 限制次数：最多重试 3 次
const maxRetries = Schedule.recurs(3);

// 线性增长：间隔线性增加（1s, 2s, 3s, 4s...）
const linearBackoff = Schedule.linear("1 second");
```

### 6.3 策略的组合

Schedule 最强大的特性是组合。你可以将多个策略组合在一起，形成复杂的重试行为：

```typescript
// 生产环境推荐的重试策略
const productionRetry = pipe(
  // 基础：指数退避，起始间隔 100ms
  Schedule.exponential("100 millis"),
  // 组合：最多重试 5 次
  Schedule.compose(Schedule.recurs(5)),
  // 组合：最大间隔不超过 30 秒
  Schedule.compose(Schedule.maxDelay("30 seconds")),
  // 组合：总耗时不超过 2 分钟
  Schedule.compose(Schedule.elapsedTime("2 minutes"))
);
```

这个策略的行为是：以指数退避方式重试，起始间隔 100ms，每次翻倍但不超过 30 秒，最多重试 5 次，如果总耗时超过 2 分钟则停止。这种组合能力使得我们可以精确控制重试行为，无需手写复杂的循环和计时器。

### 6.4 条件重试

不是所有错误都应该重试。例如，认证失败（401）重试是没有意义的，但服务器错误（500）值得重试。Effect 提供了条件重试能力：

```typescript
// 只在服务器错误时重试
const serverErrorRetry = pipe(
  Schedule.exponential("1 second"),
  Schedule.compose(Schedule.recurs(3)),
  Schedule.whileInput((error: NetworkError) => error.statusCode >= 500)
);

const resilientRequest = flakyRequest.pipe(
  Effect.retry(serverErrorRetry),
  Effect.catchAll((error) => {
    // 重试耗尽后的降级处理
    console.log("所有重试已用尽:", error.message);
    return Effect.succeed(null);
  })
);
```

`whileInput` 是一个条件断言函数，它在每次重试前检查最新的错误。如果条件返回 `false`，则停止重试，将错误传递给后续的错误处理逻辑。

### 6.5 带抖动的退避策略

在分布式系统中，如果多个客户端同时遇到错误并按相同的间隔重试，会在同一时刻产生大量请求（称为"雷击效应"或"惊群效应"）。添加随机抖动（Jitter）可以有效缓解这个问题：

```typescript
const jitteredRetry = pipe(
  Schedule.exponential("1 second"),
  Schedule.jittered,  // 添加随机抖动
  Schedule.compose(Schedule.recurs(5))
);
```

`jittered` 会在每次重试间隔上添加随机偏移，使得多个客户端的重试时间分散开来，避免对服务端造成突发压力。

### 6.6 自定义 Schedule

你也可以创建完全自定义的重试策略。Schedule 本质上是一个描述重试间隔序列的结构：

```typescript
// 自定义策略：特定的重试间隔序列
const customSchedule = Schedule.fromDurations(
  "100 millis",
  "500 millis",
  "1 second",
  "5 seconds",
  "30 seconds"
);
```

---

## 七、Schema 验证：类型安全的数据校验与编解码

### 7.1 Schema 的设计理念

在前后端数据交换中，验证数据格式是不可回避的环节。传统的做法是使用 JSON Schema、io-ts 或 Zod 等库进行运行时校验。Effect 的 `Schema` 模块在此基础上更进一步，将数据验证与 TypeScript 类型系统深度集成，实现了"定义一次，同时获得运行时验证和编译时类型推断"的效果。

传统的数据验证方案通常存在一个根本性的矛盾：运行时验证规则和编译时类型定义是分离的。你用 JSON Schema 定义了验证规则，但还需要手动编写 TypeScript 类型；你用 Zod 定义了 Schema，但它的类型推断能力有限，遇到复杂的转换场景就会力不从心。Effect Schema 通过统一的描述语言同时生成验证逻辑和 TypeScript 类型，彻底消除了这种二义性。此外，Effect Schema 还原生支持编解码（Codec），不仅能够验证数据格式，还能在不同的表示形式之间进行转换——比如将字符串格式的日期转换为 `Date` 对象，将驼峰命名的 JSON 字段转换为蛇形命名的数据库字段等。

### 7.2 基础 Schema 定义

```typescript
import { Schema } from "effect";

// 定义用户 Schema：同时约束了运行时数据格式和编译时类型
const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "姓名不能为空" }),
    Schema.maxLength(100, { message: () => "姓名最长100个字符" })
  ),
  email: Schema.String.pipe(
    Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: () => "邮箱格式不正确" })
  ),
  age: Schema.Number.pipe(
    Schema.int({ message: () => "年龄必须为整数" }),
    Schema.greaterThan(0, { message: () => "年龄必须大于0" }),
    Schema.lessThan(150, { message: () => "年龄必须小于150" })
  ),
  role: Schema.Literal("admin", "user", "guest"),
});

// 从 Schema 自动推断 TypeScript 类型
type User = Schema.Schema.Type<typeof UserSchema>;
// 等价于: { id: string; name: string; email: string; age: number; role: "admin" | "user" | "guest" }
```

定义一个 Schema，就同时获得了数据验证规则和 TypeScript 类型定义。两者始终保持同步，不会出现类型与验证规则不一致的情况。

### 7.3 数据解码与验证

使用 Schema 进行数据验证非常直观：

```typescript
import { Schema, Effect } from "effect";

// 创建解码函数
const decodeUser = Schema.decode(UserSchema);

// 验证有效数据
const validResult = decodeUser({
  id: "abc123",
  name: "张三",
  email: "zhangsan@example.com",
  age: 30,
  role: "admin",
});
// 成功返回 User 对象

// 验证无效数据
const invalidResult = decodeUser({
  id: "abc123",
  name: "",           // 违反 minLength(1)
  email: "not-email", // 违反 pattern
  age: -5,            // 违反 greaterThan(0)
  role: "superadmin", // 不在 Literal 值列表中
});
// 返回包含所有验证错误的 SchemaError，每个字段的错误都被详细记录
```

### 7.4 编解码转换

Schema 不仅可以验证数据，还能在不同类型之间进行转换。这在处理 API 响应时特别有用：

```typescript
// 定义字符串到 Date 的转换
const DateFromString = Schema.transform(
  Schema.String,       // 输入类型
  Schema.Date,         // 输出类型
  (s) => new Date(s),  // 解码：字符串 -> Date
  (d) => d.toISOString() // 编码：Date -> 字符串
);

const EventSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdAt: DateFromString,  // 自动将字符串转为 Date
  updatedAt: DateFromString,
});

type Event = Schema.Schema.Type<typeof EventSchema>;
// { id: string; title: string; createdAt: Date; updatedAt: Date }

// 从 API JSON 响应解码
const rawJson = {
  id: "evt-1",
  title: "技术分享会",
  createdAt: "2024-06-01T10:00:00.000Z",
  updatedAt: "2024-06-01T12:00:00.000Z",
};

const event = Schema.decodeSync(EventSchema)(rawJson);
console.log(event.createdAt instanceof Date); // true
```

### 7.5 复杂 Schema 组合

Schema 支持各种复杂的组合场景：

```typescript
// 可选字段
const PartialUserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
});

// 递归类型：组织架构树
const OrgNodeSchema = Schema.Struct({
  name: Schema.String,
  children: Schema.Array(
    Schema.suspend(() => OrgNodeSchema)  // 递归引用需要 suspend
  ),
});

// 泛型包装：通用 API 响应格式
const ApiResponseSchema = <A>(itemSchema: Schema.Schema<A>) =>
  Schema.Struct({
    success: Schema.Boolean,
    data: itemSchema,
    error: Schema.optional(Schema.String),
    timestamp: Schema.DateFromString,
  });

const UserResponseSchema = ApiResponseSchema(UserSchema);
const UsersListResponseSchema = ApiResponseSchema(Schema.Array(UserSchema));
```

---

## 八、Stream 处理：流式数据处理与背压

### 8.1 Stream 的核心概念

在处理大量数据时，一次性将所有数据加载到内存中是不可行的。Stream（流）提供了一种按需拉取、逐批处理数据的方式，支持背压（Backpressure）机制，确保生产者的速度不会压垮消费者。

背压是流处理中至关重要的概念。想象一个场景：上游数据源每秒产生 10000 条记录，但下游的数据库写入速度只有每秒 1000 条。如果没有背压机制，多余的 9000 条记录会堆积在内存中，最终导致内存溢出。Effect 的 Stream 通过内置的背压机制解决了这个问题——当下游处理不过来时，上游会自动暂停产生数据，直到下游有空间处理新数据。这种机制使得 Stream 能够安全地处理任意规模的数据集，而不需要手动管理缓冲区大小。

Effect 的 Stream 是描述性的——它描述了一个数据流的计算过程，但不会立即执行。只有当流被"运行"时（通过 `runCollect`、`runDrain` 等），才会真正开始处理数据。

### 8.2 创建和基础操作

```typescript
import { Stream, Effect, pipe } from "effect";

// 从范围创建
const numbers = Stream.range(1, 1000);

// 从数组创建
const fromArray = Stream.fromIterable([1, 2, 3, 4, 5]);

// 从单个 Effect 创建
const fromEffect = Stream.fromEffect(
  Effect.sync(() => Math.random())
);

// 重复执行一个 Effect
const repeated = Stream.repeatEffect(
  Effect.sync(() => new Date().toISOString())
);

// 管道式操作
const processed = pipe(
  Stream.range(1, 100),
  Stream.filter((n) => n % 2 === 0),     // 过滤偶数
  Stream.map((n) => n * 10),              // 每个元素乘以 10
  Stream.take(5),                          // 只取前 5 个
  Stream.runCollect                         // 收集结果到数组
);

const result = Effect.runSync(processed);
// Chunk [20, 40, 60, 80, 100]
```

### 8.3 批处理与并发流处理

Stream 的核心价值在于处理大规模数据时的批处理和并发能力：

```typescript
// 带并发的流处理：同时处理多个元素
const concurrentStream = pipe(
  Stream.range(1, 1000),
  Stream.mapEffect(
    (n) =>
      Effect.gen(function* () {
        // 模拟异步处理
        yield* Effect.sleep("50 millis");
        return n * 2;
      }),
    { concurrency: 20 }  // 最多 20 个并发
  ),
  Stream.runCollect
);

// 按批次处理
const batchStream = pipe(
  Stream.range(1, 10000),
  Stream.chunks,  // 将流分割为块（Chunk）
  Stream.tap((chunk) =>
    Effect.sync(() => console.log(`处理批次: ${chunk.length} 个元素`))
  ),
  Stream.mapEffect(
    (chunk) =>
      // 批量写入数据库
      Effect.tryPromise({
        try: () => batchInsertToDatabase(chunk),
        catch: () => new Error("批量插入失败"),
      }),
    { concurrency: 5 }
  ),
  Stream.runDrain
);
```

### 8.4 流的错误处理

Stream 中的错误处理与 Effect 保持一致的风格：

```typescript
const safeStream = pipe(
  Stream.range(1, 100),
  Stream.mapEffect((n) => {
    if (n % 17 === 0) {
      return Effect.fail(new Error(`遇到不吉利的数字: ${n}`));
    }
    return Effect.succeed(n * 2);
  }),
  Stream.catchAll((error) => {
    console.log(`捕获到流错误: ${error.message}`);
    return Stream.empty;  // 错误时返回空流
  }),
  Stream.runCollect
);
```

### 8.5 实时数据流与轮询

Stream 非常适合处理实时数据场景：

```typescript
// 定时轮询 API
const pollingStream = pipe(
  Stream.repeatEffect(
    Effect.tryPromise({
      try: () => fetch("/api/events/latest").then(r => r.json()),
      catch: () => new Error("轮询失败"),
    })
  ),
  Stream.schedule(Schedule.spaced("10 seconds")),  // 每 10 秒轮询一次
  Stream.tap((events) =>
    Effect.sync(() => console.log(`收到 ${events.length} 条新事件`))
  ),
  Stream.take(100),  // 最多轮询 100 次
  Stream.runDrain
);

// 将 Effect 转换为单元素流
const userStream = Stream.fromEffect(fetchUser("123"));

// 合并多个流
const merged = Stream.merge(
  userStream,
  Stream.fromEffect(fetchUser("456"))
);
```

---

## 九、完整 API 客户端示例（含错误处理、重试、缓存、日志）

下面是一个综合示例，展示如何使用 Effect 构建一个生产级别的 API 客户端。这个示例融合了前面介绍的几乎所有核心概念：

```typescript
import {
  Effect, Context, Layer, pipe, Schedule,
  Schema, Stream, Duration, Ref, Data, Console
} from "effect";

// ====== 1. 定义结构化的错误类型 ======

class ApiError extends Data.TaggedError("ApiError")<{
  readonly endpoint: string;
  readonly statusCode: number;
  readonly message: string;
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly reason: string;
}> {}

class CacheError extends Data.TaggedError("CacheError")<{
  readonly key: string;
  readonly operation: "read" | "write";
}> {}

// ====== 2. 定义 Schema ======

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(Schema.minLength(1)),
  email: Schema.String.pipe(Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  avatar: Schema.optional(Schema.String),
});

type User = Schema.Schema.Type<typeof UserSchema>;

const PaginatedResponseSchema = <A>(itemSchema: Schema.Schema<A>) =>
  Schema.Struct({
    data: Schema.Array(itemSchema),
    meta: Schema.Struct({
      total: Schema.Number,
      page: Schema.Number,
      pageSize: Schema.Number,
    }),
  });

const UsersResponseSchema = PaginatedResponseSchema(UserSchema);

// ====== 3. 定义服务接口 ======

interface Logger {
  readonly info: (msg: string, meta?: object) => Effect.Effect<void>;
  readonly error: (msg: string, meta?: object) => Effect.Effect<void>;
}

interface Cache {
  readonly get: <T>(key: string) => Effect.Effect<T | null>;
  readonly set: <T>(key: string, value: T, ttl: Duration.Duration) => Effect.Effect<void>;
  readonly invalidate: (key: string) => Effect.Effect<void>;
}

interface HttpClient {
  readonly get: (url: string) => Effect.Effect<unknown, ApiError>;
}

const Logger = Context.Tag<Logger>();
const Cache = Context.Tag<Cache>();
const HttpClient = Context.Tag<HttpClient>();

// ====== 4. 服务实现层 ======

const LoggerLive = Layer.succeed(Logger, {
  info: (msg, meta) =>
    Console.log(`[INFO] ${new Date().toISOString()} ${msg}`, meta ?? {}).pipe(Effect.as(void 0)),
  error: (msg, meta) =>
    Console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, meta ?? {}).pipe(Effect.as(void 0)),
});

const CacheLive = Layer.effect(
  Cache,
  Effect.gen(function* () {
    const store = yield* Ref.make(
      new Map<string, { value: unknown; expiry: number }>()
    );

    return {
      get: <T>(key: string) =>
        Ref.get(store).pipe(
          Effect.map((map) => {
            const entry = map.get(key);
            if (!entry || Date.now() > entry.expiry) return null;
            return entry.value as T;
          })
        ),
      set: <T>(key: string, value: T, ttl: Duration.Duration) =>
        Ref.update(store, (map) => {
          const updated = new Map(map);
          updated.set(key, { value, expiry: Date.now() + Duration.toMillis(ttl) });
          return updated;
        }),
      invalidate: (key: string) =>
        Ref.update(store, (map) => {
          const updated = new Map(map);
          updated.delete(key);
          return updated;
        }),
    };
  })
);

const HttpClientLive = Layer.effect(
  HttpClient,
  Effect.gen(function* () {
    const logger = yield* Logger;
    return {
      get: (url: string) =>
        Effect.gen(function* () {
          yield* logger.info(`GET ${url}`);
          const data = yield* Effect.tryPromise({
            try: async () => {
              const res = await fetch(url);
              if (!res.ok) throw { statusCode: res.status, message: res.statusText };
              return res.json();
            },
            catch: (err: any) =>
              new ApiError({
                endpoint: url,
                statusCode: err?.statusCode ?? 500,
                message: err?.message ?? "未知网络错误",
              }),
          });
          yield* logger.info(`GET ${url} 成功`);
          return data;
        }),
    };
  })
);

// ====== 5. 重试策略 ======

const retryPolicy = pipe(
  Schedule.exponential("100 millis"),
  Schedule.compose(Schedule.recurs(3)),
  Schedule.compose(Schedule.maxDelay("10 seconds")),
  Schedule.whileInput((error: ApiError) => error.statusCode >= 500)
);

// ====== 6. 业务逻辑 ======

const fetchUsers = (page: number, pageSize: number) =>
  Effect.gen(function* () {
    const http = yield* HttpClient;
    const cache = yield* Cache;
    const logger = yield* Logger;

    const cacheKey = `users:p${page}:s${pageSize}`;

    // 尝试从缓存获取
    const cached = yield* cache.get<User[]>(cacheKey);
    if (cached) {
      yield* logger.info(`缓存命中: ${cacheKey}`);
      return { users: cached, total: cached.length, fromCache: true };
    }

    // 从 API 获取
    const raw = yield* http.get(`/api/users?page=${page}&size=${pageSize}`);

    // Schema 验证
    const response = yield* Schema.decode(UsersResponseSchema)(raw).pipe(
      Effect.catchAll((err) =>
        Effect.fail(
          new ValidationError({ field: "response", reason: String(err) })
        )
      )
    );

    // 写入缓存
    yield* cache.set(cacheKey, response.data, Duration.minutes(5));
    yield* logger.info(`已缓存 ${response.data.length} 个用户`);

    return { users: response.data, total: response.meta.total, fromCache: false };
  }).pipe(
    Effect.retry(retryPolicy),
    Effect.catchTags({
      ApiError: (error) =>
        Effect.gen(function* () {
          yield* Logger.pipe(
            Effect.flatMap((l) =>
              l.error("API 请求失败", { endpoint: error.endpoint, status: error.statusCode })
            )
          );
          return { users: [] as User[], total: 0, fromCache: false };
        }),
      ValidationError: (error) =>
        Effect.gen(function* () {
          yield* Logger.pipe(
            Effect.flatMap((l) =>
              l.error("数据验证失败", { field: error.field, reason: error.reason })
            )
          );
          return { users: [] as User[], total: 0, fromCache: false };
        }),
    })
  );

// ====== 7. 组装应用层并运行 ======

const AppLayer = Layer.mergeAll(LoggerLive, CacheLive, HttpClientLive);

const main = Effect.gen(function* () {
  const result = yield* fetchUsers(1, 20);
  yield* Effect.sync(() => {
    console.log(`获取到 ${result.users.length} 个用户，共 ${result.total} 个`);
    console.log(`来源: ${result.fromCache ? "缓存" : "API"}`);
  });
});

Effect.runPromise(main.pipe(Effect.provide(AppLayer)));
```

这个完整示例展示了 Effect 在实际工程中的典型架构：

**错误模型**：通过 `ApiError`、`ValidationError`、`CacheError` 三种 Tagged Errors 覆盖了所有错误场景。每种错误都携带了丰富的上下文信息，便于日志记录和问题排查。

**Schema 验证**：`UsersResponseSchema` 定义了 API 响应的数据结构，使用泛型 `PaginatedResponseSchema` 实现了复用。验证失败会生成详细的错误信息。

**依赖注入**：`Logger`、`Cache`、`HttpClient` 三个服务通过 Layer 注入，测试时可以轻松替换为 Mock 实现。

**重试策略**：指数退避 + 最大 3 次重试 + 最大 10 秒间隔 + 仅在服务器错误时重试。

**缓存层**：基于 `Ref` 的内存缓存，支持 TTL 过期。缓存命中时直接返回，避免不必要的网络请求。

**结构化日志**：贯穿整个请求流程的日志记录，包含时间戳、上下文元数据。

---

## 十、与 fp-ts / io-ts 的对比与迁移路径

### 10.1 Effect 的前世今生

要理解 Effect 的定位，了解它与 fp-ts 和 io-ts 的关系很有帮助。fp-ts 是 TypeScript 生态中最知名的函数式编程工具库，提供了 `Either`、`Option`、`Task` 等函数式数据类型。io-ts 是 fp-ts 生态中的运行时类型验证库。

Effect 的作者 Michael Arnaldi 最初受到 fp-ts 的启发，但在实践中发现 fp-ts 的设计存在一些根本性的局限。例如，fp-ts 没有内置的并发模型、没有依赖注入、错误处理需要手动包装 `Either`。于是他从零开始设计了 Effect，将这些能力全部融入到一个统一的框架中。

### 10.2 详细对比

| 维度 | fp-ts + io-ts | Effect |
|------|--------------|--------|
| 定位 | 函数式工具库 + 运行时验证 | 完整应用框架 |
| 错误处理 | 手动使用 `Either`/`TaskEither` 包装 | 自动类型追踪，内置在 `Effect<A, E, R>` 中 |
| 异步处理 | `Task`/`TaskEither`（基于 Promise） | Effect + Fiber（原生并发） |
| 依赖注入 | 无（需自行实现或使用 Reader monad） | 内置 Layer/Context 系统 |
| 并发 | 无（Promise.all 等原生方式） | Fiber：fork/join/race/all |
| 重试 | 无 | 内置 Schedule |
| 数据验证 | io-ts Codec | 内置 Schema |
| 流处理 | 无 | 内置 Stream（支持背压） |
| 学习曲线 | 中等 | 较高（但文档更完善） |
| 维护状态 | 稳定但不活跃 | 活跃开发中 |

### 10.3 fp-ts 迁移到 Effect

对于正在使用 fp-ts 的项目，迁移到 Effect 可以渐进式进行。两者可以共存于同一项目中。

首先是最基础的类型映射。fp-ts 中的 `Either<E, A>` 对应 Effect 中的 `Effect<A, E>`。fp-ts 中的 `TaskEither<E, A>` 对应 Effect 中的 `Effect<A, E>`。但 Effect 的能力远超这些简单映射。

在迁移过程中，可以在 fp-ts 和 Effect 之间建立桥梁：

```typescript
import { Effect } from "effect";
import * as E from "fp-ts/Either";

// 从 fp-ts Either 转换为 Effect
const fromEither = <E, A>(either: E.Either<E, A>): Effect.Effect<A, E> =>
  E.isRight(either) ? Effect.succeed(either.right) : Effect.fail(either.left);

// 从 Effect 转换为 fp-ts Either（用于渐进迁移）
const toEither = <E, A>(effect: Effect.Effect<A, E>): Promise<E.Either<E, A>> =>
  Effect.runPromise(
    effect.pipe(
      Effect.map((a) => E.right(a) as E.Either<E, A>),
      Effect.catchAll((e) => Effect.succeed(E.left(e) as E.Either<E, A>))
    )
  );
```

建议的迁移策略是：从应用的核心业务逻辑开始，逐步将 `TaskEither` 替换为 `Effect`。外围的 IO 层可以暂时保留 fp-ts 风格，通过上述桥梁函数进行转换。迁移的关键原则是"不破坏已有功能"——新旧代码可以并存，逐步过渡。每次只迁移一个模块或一组相关的函数，确保测试通过后再继续下一个。

从开发体验角度来看，fp-ts 的代码风格偏向纯函数式，大量使用柯里化和 Point-Free 风格，对新手来说阅读门槛较高。而 Effect 提供了 `Effect.gen` 生成器语法，让代码风格更接近命令式的 `async/await`，降低了学习和理解的门槛，同时又保留了函数式编程的所有类型安全优势。这种设计使得 Effect 既适合函数式编程老手，也适合从命令式编程转型的开发者。在团队中推行 Effect 时，建议先让成员熟悉 `Effect.gen` 风格，再逐步引入管道组合等高级风格。

### 10.4 io-ts 迁移到 Effect Schema

io-ts 到 Effect Schema 的迁移相对直接，因为两者的概念非常相似：

```typescript
// io-ts 风格
import * as t from "io-ts";

const UserCodec = t.type({
  id: t.string,
  name: t.string,
  age: t.number,
});

// Effect Schema 风格
import { Schema } from "effect";

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  age: Schema.Number,
});
```

关键区别在于：io-ts 的解码返回 `Either<Errors, A>`，需要手动处理；Effect Schema 的解码返回 `Effect<A, ParseError>`，可以无缝集成到 Effect 管道中，享受重试、日志、依赖注入等附加能力。

---

## 十一、总结与适用场景

### 11.1 Effect 的核心价值总结

通过本文的深入讲解，我们可以看到 Effect 框架的几个核心价值：

**编译时安全保障**：错误类型、依赖关系、数据格式全部在类型层面表达。编译器成为你最可靠的代码审查员，在编码阶段就能发现遗漏的错误处理、未满足的依赖、不一致的数据格式。

**极致的可组合性**：Effect、Layer、Stream、Schedule 都遵循函数式编程的组合原则，可以像积木一样自由拼装。小的组合成大的，简单的组合成复杂的，组合过程中类型安全始终保持。

**声明式编程风格**：重试策略通过 `Schedule` 声明式描述，而非手写循环；并发通过 `all`、`race` 声明式表达，而非管理线程；数据验证通过 `Schema` 声明式定义，而非手写 if-else。

**可测试性**：依赖注入使得单元测试变得简单——替换一个 Layer 就能将真实的 HTTP 客户端替换为 Mock，无需启动任何容器，不需要复杂的测试基础设施。

**从原型到生产**：Effect 提供的能力从简单到复杂层层递进。最简单的用法（`Effect.succeed`、`pipe`、`map`）足以替代日常的 Promise 用法，而高级特性（Fiber 并发、Stream 背压、Schema 编解码）则满足了生产环境的严苛要求。

### 11.2 适用场景

**非常适合使用 Effect 的场景包括**：

后端服务开发：需要处理多层错误、管理复杂依赖图、实现重试降级策略的 API 服务。Effect 的 Layer 系统特别适合组织大型应用的依赖关系。

数据管道与 ETL：需要从多个数据源提取数据、转换格式、加载到目标系统的批处理任务。Stream 的背压机制确保不会因数据量过大而内存溢出。

CLI 工具：需要处理文件读写、网络请求、用户输入等多种错误路径的命令行工具。Effect 的错误处理使得每种错误都有明确的处理逻辑。

微服务架构：需要服务发现、熔断降级、分布式追踪的微服务系统。Effect 的依赖注入和 Fiber 模型为此类场景提供了坚实的基础。

需要高可测试性的业务逻辑：金融、医疗等对正确性要求极高的领域。Effect 的类型安全保证减少了运行时出错的可能性。

**可能不需要 Effect 的场景包括**：

简单 CRUD 应用：几个路由、一个数据库连接的小型服务。使用 Express 或 Fastify 即可，引入 Effect 的学习成本可能不值得。

UI 组件开发：React 或 Vue 的组件层通常不需要这么重的抽象。但组件内部的业务逻辑 hook 可以考虑使用 Effect。

紧急的原型项目：如果项目期限很紧且团队对函数式编程不熟悉，建议先用熟悉的技术栈完成，后续再考虑迁移。

### 11.3 学习路径建议

如果你决定学习和采用 Effect，建议按照以下路径循序渐进：

第一阶段，掌握基础。从 `Effect.succeed`、`Effect.fail`、`Effect.sync`、`Effect.try` 开始，理解惰性求值的概念。然后学习 `pipe`、`Effect.map`、`Effect.flatMap`、`Effect.tap` 等组合操作。最后掌握 `Effect.gen` 生成器语法，它是 Effect 中最常用的编写方式，类似 async/await 的写法但功能更强大。

第二阶段，理解错误处理。学习 `Data.TaggedError` 定义结构化错误，掌握 `catchAll`、`catchTag`、`catchTags` 三种错误捕获方式。理解错误类型如何在组合过程中自动合并。

第三阶段，掌握依赖注入。理解 `Context.Tag`、`Layer.succeed`、`Layer.effect`、`Layer.merge` 的含义和用法。练习通过替换 Layer 来实现测试中的 Mock。

第四阶段，学习高级特性。根据项目需要选择性学习 `Schedule` 重试策略、`Schema` 数据验证、`Stream` 流处理、Fiber 并发原语。

### 11.4 结语

Effect 代表了 TypeScript 生态中函数式编程的一种新范式。它不仅仅是一个库，更是一套完整的方法论，重新定义了我们构建 TypeScript 应用的方式。虽然学习曲线存在，但在处理复杂业务逻辑时，它提供的类型安全性、可组合性和可测试性是传统方式无法比拟的。

如果你正在寻找一种更好的方式来构建健壮的 TypeScript 应用，Effect 绝对值得投入时间去学习和探索。从一个小模块开始，逐步体会函数式编程的魅力，你会发现代码变得更安全、更可维护、更优雅。

---

## 相关阅读

- [tRPC 实战：端到端类型安全的 API 层——TypeScript 全栈开发者告别 OpenAPI 代码生成的新范式](/categories/前端/tRPC-实战-端到端类型安全API层-TypeScript全栈告别OpenAPI代码生成/)
- [Zustand 实战：轻量级 React 状态管理——对比 Redux/Jotai/Recoil 的工程选型与最佳实践](/categories/前端/Zustand-实战-轻量级React状态管理-对比Redux-Jotai-Recoil的工程选型与最佳实践/)
- [Kotlin Coroutines 深度实战：挂起函数、结构化并发、Flow——与 PHP Fibers/Go goroutine 的并发模型对比](/categories/前端/2026-06-03-Kotlin-Coroutines-深度实战-挂起函数结构化并发Flow并发模型对比/)

最后需要强调的是，采用 Effect 不是一蹴而就的事情。建议团队从一个非核心的服务或工具模块开始试验，在实际项目中积累经验后再逐步推广。Effect 的设计哲学本身就支持渐进式采用——你可以只使用它的错误处理能力，也可以只使用它的依赖注入，或者两者兼用，不必一次性全面迁移。随着使用经验的积累，你会越来越深刻地理解类型驱动开发（Type-Driven Development）的价值，以及函数式编程在大型工程中的独特优势。
