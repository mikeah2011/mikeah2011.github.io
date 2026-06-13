---

title: TypeScript
keywords: [TypeScript]
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- TypeScript
- 前端
categories:
- frontend
date: 2020-03-20 15:05:07
description: TypeScript 是 JavaScript 的超集，由微软开发，提供强大的静态类型系统，将运行时错误前置到编译期发现。本文深入讲解类型体操、泛型编程、工具类型、类型守卫、tsconfig 配置最佳实践，并对比 TypeScript 与 JavaScript、Flow 的差异，附 Vite + Vue/React 项目实战搭建指南，适合前端开发者系统性掌握 TypeScript。
---


## 一、为什么是 TypeScript

JavaScript 的痛点：

```js
function getName(user) {
    return user.profile.name;   // 万一 profile 是 undefined？
}
```

代码上线，用户访问，崩了。

TypeScript 把类型信息加进去，**编译期**就能发现：

```ts
interface User {
    profile?: { name: string };
}
function getName(user: User) {
    return user.profile.name;   // ❌ Error: Object is possibly 'undefined'
}
```

这就是 TypeScript 的核心价值 —— **可信的代码 + 重构友好**。

> 几乎所有主流前端项目（React、Vue 3、Angular、Next.js）都默认或推荐 TypeScript。

### TypeScript 的优势总结

- **编译时错误检测**：在代码运行前就发现类型错误，减少线上 Bug。据统计，TypeScript 能预防约 15% 的常见 JavaScript Bug。
- **智能 IDE 支持**：自动补全、跳转定义、重构重命名、内联文档提示，开发效率提升显著。
- **代码即文档**：类型注解就是最好的文档，新成员看类型就能理解数据结构和函数签名。
- **安全重构**：修改接口或重命名属性时，编译器会标出所有受影响的代码位置，大型项目重构不再心惊胆战。
- **渐进式采用**：不需要一次性重写，通过 `allowJs` 可以在现有 JavaScript 项目中逐步引入 TypeScript。

### 什么时候不需要 TypeScript

TypeScript 不是银弹，以下场景可以不使用：

- 一次性脚本或原型验证（POC），快速迭代优先
- 极小型项目（<10 个文件），维护成本低
- 团队完全没有 TypeScript 经验且项目紧急（但建议事后补上）
- 某些构建工具链不支持 TypeScript 的遗留项目

---

## 二、安装与编译

```bash
npm install -g typescript
tsc --init                # 生成 tsconfig.json
tsc app.ts                # 编译单文件
tsc                       # 按 tsconfig 编译整个项目
tsc --watch               # 监听模式
```

实际项目通常用 **tsx / ts-node / bun / Vite** 直接跑 TS，不用先编译。

---

## 三、类型系统速览

### 基础类型

```ts
let s: string = "hi";
let n: number = 42;
let b: boolean = true;
let arr: number[] = [1, 2, 3];
let tuple: [string, number] = ["age", 18];
let any_: any;            // 退化成 JS，少用
let unknown_: unknown;    // 类型安全的 any，必须先断言/收窄才能用
let nothing: void;        // 函数无返回
let never_: never;        // 永不返回（抛异常或死循环）
```

### Interface vs Type

```ts
interface User {
    id: number;
    name: string;
    email?: string;       // 可选
    readonly created: Date;
}

type User2 = {
    id: number;
    name: string;
};

// 区别：
// interface 可声明合并、可被 implements
// type 可表达联合 / 交叉 / 映射
type Status = 'pending' | 'done' | 'failed';
type WithTime<T> = T & { time: Date };
```

### 泛型

```ts
function first<T>(arr: T[]): T | undefined {
    return arr[0];
}

const n = first([1, 2, 3]);       // T = number → n: number | undefined
const s = first(['a', 'b']);      // T = string

// 约束
function pluck<T, K extends keyof T>(obj: T, key: K): T[K] {
    return obj[key];
}
```

### 泛型编程进阶

泛型是 TypeScript 最强大的特性之一，掌握约束和高级用法能极大提升代码复用性。

**泛型约束（extends）** —— 限制泛型参数的范围：

```ts
// 约束 T 必须有 length 属性
function logLength<T extends { length: number }>(item: T): T {
    console.log(item.length);
    return item;
}
logLength('hello');        // ✅ string 有 length
logLength([1, 2, 3]);      // ✅ 数组有 length
// logLength(123);         // ❌ number 没有 length

// 约束 key 必须是 T 的属性名
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
    return obj[key];
}
const user = { name: 'Alice', age: 30 };
getProperty(user, 'name');   // ✅ 返回 string
// getProperty(user, 'xxx'); // ❌ 'xxx' 不在 user 的属性中
```

**多个泛型参数** —— 处理复杂映射关系：

```ts
// 将对象的所有值映射为新类型
function mapValues<T extends Record<string, any>, U>(
    obj: T,
    fn: (value: T[keyof T], key: keyof T) => U
): Record<keyof T, U> {
    const result = {} as Record<keyof T, U>;
    for (const key in obj) {
        result[key] = fn(obj[key], key);
    }
    return result;
}

const scores = { math: 95, english: 88, science: 92 };
const grades = mapValues(scores, (score) => score >= 90 ? 'A' : 'B');
// { math: 'A', english: 'B', science: 'A' }
```

**泛型类** —— 实现类型安全的容器：

```ts
class Result<T, E = Error> {
    constructor(
        private value?: T,
        private error?: E
    ) {}

    isOk(): boolean { return this.value !== undefined; }

    unwrap(): T {
        if (this.value === undefined) throw this.error;
        return this.value;
    }

    map<U>(fn: (value: T) => U): Result<U, E> {
        if (this.isOk()) return new Result(fn(this.value!));
        return new Result(undefined, this.error);
    }
}

// 使用
function divide(a: number, b: number): Result<number, string> {
    if (b === 0) return new Result(undefined, 'Division by zero');
    return new Result(a / b);
}

const result = divide(10, 2).map(v => v * 100);
console.log(result.unwrap()); // 500
```

**条件类型（Conditional Types）** —— 根据条件选择类型：

```ts
// 基础条件类型
type IsString<T> = T extends string ? 'yes' : 'no';
type A = IsString<string>;    // 'yes'
type B = IsString<number>;    // 'no'

// infer 关键字：在条件类型中推断
type ElementType<T> = T extends (infer E)[] ? E : T;
type Nums = ElementType<number[]>;     // number
type Str = ElementType<string>;        // string

// 提取 Promise 的内部类型
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
type User = UnwrapPromise<Promise<{ id: number }>>; // { id: number }

// 提取函数参数类型
type FirstParam<T> = T extends (first: infer P, ...args: any[]) => any ? P : never;
type P1 = FirstParam<(name: string, age: number) => void>; // string
```

**模板字面量类型** —— 字符串级别的类型操作：

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type ApiEndpoint = `/api/${string}`;
const endpoint: ApiEndpoint = '/api/users'; // ✅
// const bad: ApiEndpoint = '/v1/users';    // ❌

// 自动生成事件名
type EventName<T extends string> = `on${Capitalize<T>}`;
type ClickEvent = EventName<'click'>;    // 'onClick'
type FocusEvent = EventName<'focus'>;    // 'onFocus'
```

### 工具类型（内置）

```ts
type User = { id: number; name: string; email: string };

Partial<User>           // 所有字段变可选
Required<User>          // 所有字段变必填
Readonly<User>          // 所有字段变只读
Pick<User, 'id'|'name'> // 只取 id 和 name
Omit<User, 'email'>     // 去掉 email
Record<string, User>    // { [k: string]: User }
ReturnType<typeof fn>   // 函数返回值类型
Awaited<Promise<User>>  // 解 Promise 包裹
```

### 深入工具类型原理

理解工具类型的底层原理，能帮助你写出更灵活的自定义类型。

**Partial\<T\>** 将所有属性变为可选，常用于 PATCH 更新接口：

```ts
// 源码实现
type Partial<T> = { [P in keyof T]?: T[P] };

// 实际应用：用户更新接口只需传要改的字段
function updateUser(id: number, updates: Partial<User>): User {
    const user = getUser(id);
    return { ...user, ...updates };
}
// updateUser(1, { name: 'new name' }) ✅ 只更新 name
```

**Pick\<T, K\>** 从类型中选取指定字段，适用于 DTO（数据传输对象）：

```ts
// 源码实现
type Pick<T, K extends keyof T> = { [P in K]: T[P] };

// 实际应用：API 响应只暴露部分字段
type UserPreview = Pick<User, 'id' | 'name'>;
// { id: number; name: string }
```

**Omit\<T, K\>** 排除指定字段，与 Pick 互补：

```ts
// 源码实现
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;

// 实际应用：创建用户时不需要 id（由后端生成）
type CreateUserDto = Omit<User, 'id'>;
function createUser(data: CreateUserDto): User {
    return { id: generateId(), ...data };
}
```

**Record\<K, V\>** 构造键值对类型，适用于字典/映射结构：

```ts
// 源码实现
type Record<K extends keyof any, T> = { [P in K]: T };

// 实际应用：状态码映射
type ErrorCode = 'NOT_FOUND' | 'UNAUTHORIZED' | 'SERVER_ERROR';
const errorMessages: Record<ErrorCode, string> = {
    NOT_FOUND: '资源未找到',
    UNAUTHORIZED: '未授权，请登录',
    SERVER_ERROR: '服务器内部错误',
};

// 实际应用：分组数据
type UsersByRole = Record<'admin' | 'user' | 'guest', User[]>;
```

**ReturnType\<T\>** 提取函数返回值类型，配合 `typeof` 非常实用：

```ts
// 源码实现
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;

// 实际应用：从复杂函数推导返回类型
function fetchData() {
    return {
        users: [{ id: 1, name: 'Alice' }],
        total: 100,
        page: 1,
    };
}
type FetchDataResult = ReturnType<typeof fetchData>;
// { users: { id: number; name: string }[]; total: number; page: number }
```

**自定义工具类型** —— 学会原理后可以创造自己的工具类型：

```ts
// DeepPartial：深层可选（嵌套对象也变可选）
type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// 实际应用：深层配置合并
interface AppConfig {
    database: { host: string; port: number; credentials: { user: string; pass: string } };
    cache: { ttl: number; enabled: boolean };
}
function mergeConfig(defaults: AppConfig, overrides: DeepPartial<AppConfig>): AppConfig {
    return deepMerge(defaults, overrides);
}

// Nullable：允许 null
type Nullable<T> = T | null;

// NonNullable：排除 null 和 undefined
type SafeString = NonNullable<string | null | undefined>; // string

// Extract / Exclude：从联合类型中提取/排除
type Status = 'pending' | 'done' | 'failed' | 'cancelled';
type ActiveStatus = Extract<Status, 'pending' | 'done'>;       // 'pending' | 'done'
type FinalStatus = Exclude<Status, 'pending'>;                  // 'done' | 'failed' | 'cancelled'
```

---

## 四、类型收窄（Narrowing）

TypeScript 的类型推导很强大，配合判断会自动收窄：

```ts
function format(x: string | number): string {
    if (typeof x === 'string') {
        return x.toUpperCase();   // 这里 x 自动是 string
    }
    return x.toFixed(2);          // 这里 x 自动是 number
}

// in 操作符
type Cat = { meow(): void };
type Dog = { bark(): void };
function speak(a: Cat | Dog) {
    if ('meow' in a) a.meow();
    else a.bark();
}

// 自定义守卫
function isUser(x: any): x is User {
    return x && typeof x.id === 'number';
}
```

### 可辨识联合（Discriminated Unions）

可辨识联合是 TypeScript 中处理多态数据的利器，通过一个共同字段（discriminant）区分不同类型：

```ts
// 定义可辨识联合
interface Circle {
    kind: 'circle';       // 辨识字段
    radius: number;
}

interface Rectangle {
    kind: 'rectangle';    // 辨识字段
    width: number;
    height: number;
}

interface Triangle {
    kind: 'triangle';     // 辨识字段
    base: number;
    height: number;
}

type Shape = Circle | Rectangle | Triangle;

// 使用 switch 穷尽检查
function getArea(shape: Shape): number {
    switch (shape.kind) {
        case 'circle':
            return Math.PI * shape.radius ** 2;
        case 'rectangle':
            return shape.width * shape.height;
        case 'triangle':
            return (shape.base * shape.height) / 2;
        default:
            // 穷尽性检查：如果漏掉了某个分支，编译器会报错
            const _exhaustive: never = shape;
            return _exhaustive;
    }
}
```

**可辨识联合在状态机中的应用**：

```ts
interface Pending { status: 'pending'; }
interface Loading { status: 'loading'; startedAt: Date; }
interface Success<T> { status: 'success'; data: T; }
interface Failed { status: 'failed'; error: string; }

type AsyncState<T> = Pending | Loading | Success<T> | Failed;

function renderState<T>(state: AsyncState<T>): string {
    switch (state.status) {
        case 'pending':
            return '等待中...';
        case 'loading':
            return `加载中...（开始于 ${state.startedAt.toLocaleTimeString()}）`;
        case 'success':
            return `成功：${JSON.stringify(state.data)}`;
        case 'failed':
            return `失败：${state.error}`;
    }
}
```

### 高级类型守卫

**is 关键字** —— 自定义类型守卫函数：

```ts
interface Fish { swim(): void; }
interface Bird { fly(): void; }

// 类型谓词：返回值是 pet is Fish
function isFish(pet: Fish | Bird): pet is Fish {
    return (pet as Fish).swim !== undefined;
}

function move(pet: Fish | Bird) {
    if (isFish(pet)) {
        pet.swim();  // TypeScript 知道这里是 Fish
    } else {
        pet.fly();   // TypeScript 知道这里是 Bird
    }
}
```

**asserts 关键字** —— 断言函数：

```ts
function assertDefined<T>(value: T | null | undefined, name: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new Error(`Expected ${name} to be defined, got ${value}`);
    }
}

function processUser(user: User | null) {
    assertDefined(user, 'user');
    // 从这里开始，user 被断言为 User（非 null）
    console.log(user.name); // ✅ 不需要 null check
}
```

**in 操作符守卫** —— 属性存在性检查：

```ts
interface Admin { role: 'admin'; permissions: string[]; }
interface Member { role: 'member'; joinedAt: Date; }

function handleUser(user: Admin | Member) {
    if ('permissions' in user) {
        // TypeScript 收窄为 Admin
        console.log(user.permissions.join(', '));
    } else {
        // TypeScript 收窄为 Member
        console.log(user.joinedAt.toISOString());
    }
}
```

### as const 与字面量推断

`as const` 让字面量保持最窄类型，常用于替代 enum：

```ts
// 普通推断
const colors = ['red', 'green', 'blue'];
// 类型是 string[]，太宽泛

// as const 推断
const colors = ['red', 'green', 'blue'] as const;
// 类型是 readonly ['red', 'green', 'blue']

// 配合 satisfies 操作符（TS 4.9+）
type Theme = 'light' | 'dark';
const config = {
    theme: 'dark',
    fontSize: 14,
    features: ['syntax-highlight', 'auto-save'],
} satisfies Record<string, string | number | string[]>;
// config.theme 类型是 string（保持字面量推断）
// config.features 类型是 string[]（不是 readonly）

// 实际应用：路由配置
const routes = {
    home: '/',
    about: '/about',
    user: '/user/:id',
} as const;
type RouteKey = keyof typeof routes;   // 'home' | 'about' | 'user'
type RoutePath = (typeof routes)[RouteKey]; // '/' | '/about' | '/user/:id'
```

---

## 五、tsconfig.json 关键配置

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,                  // 强烈推荐开
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,            // 跳过 node_modules 类型检查（提速）
    "resolveJsonModule": true,
    "outDir": "./dist",
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`strict: true` 一定要开 —— 没开等于一半的 TS 价值丢了。

### tsconfig 进阶配置详解

**按项目类型选择配置**：

```jsonc
// 前端项目（Vite / webpack）
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",    // Vite/webpack 用 Bundler
    "jsx": "react-jsx",               // React 17+ 自动导入
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true,
    "isolatedModules": true,          // Vite 要求：确保每个文件可独立编译
    "esModuleInterop": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]                // 路径别名
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"],
  "exclude": ["node_modules", "dist"]
}
```

```jsonc
// Node.js 服务端项目
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",               // Node 原生 ESM
    "moduleResolution": "Node16",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,              // 生成 .d.ts
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

```jsonc
// 库开发（发布 npm 包）
{
  "compilerOptions": {
    "target": "ES2020",               // 兼容性更好
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "declaration": true,
    "declarationMap": true,           // 支持跳转到源码
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,                // Project References 需要
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

**常用编译选项说明**：

| 选项 | 推荐值 | 说明 |
|------|--------|------|
| `strict` | `true` | 开启所有严格检查，新项目必开 |
| `noUncheckedIndexedAccess` | `true` | 数组越界返回 `T \| undefined` |
| `exactOptionalPropertyTypes` | `true` | 区分 `undefined` 和缺失 |
| `noImplicitOverride` | `true` | 子类重写必须加 `override` |
| `isolatedModules` | `true` | 保证单文件编译安全（Vite 必须） |
| `verbatimModuleSyntax` | `true` | TS 5.0+，强制 `import type` |
| `erasableSyntaxOnly` | `true` | TS 5.8+，Node 原生 TS 支持 |

**项目引用（Project References）** —— Monorepo 场景：

```jsonc
// 根 tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./packages/shared" },
    { "path": "./packages/frontend" },
    { "path": "./packages/backend" }
  ]
}
```

```bash
# 编译整个 monorepo
tsc --build

# 只编译某个包及其依赖
tsc --build packages/frontend
```

---

## 六、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **any 泛滥** | 类型形同虚设 | 开 `noImplicitAny`、`strict`；any 用 unknown 替代 |
| **as 强转后崩** | `as User` 后访问字段 undefined | 别用 as 绕过编译错误，用类型守卫 |
| **第三方库无类型** | `Cannot find module 'x'` | `npm i -D @types/xxx`；没有就写 `*.d.ts` 声明 |
| **enum 编译产物大** | bundle 增加几 KB | 用 `as const` + union 替代 |
| **装饰器报错** | "Experimental support" | `tsconfig` 开 `experimentalDecorators: true` |
| **路径别名不生效** | `import '@/x'` 编译后还是 `@/x` | tsc 不改导入；用 tsc-alias 或交给 webpack/vite 处理 |

### 更多实战经验

**类型断言的正确使用姿势**：

类型断言（`as`）不是万能药，滥用会导致运行时崩溃。正确的做法是优先使用类型守卫：

```ts
// ❌ 危险：强制断言，编译通过但运行时可能崩
const user = response.data as User;
console.log(user.name); // 如果 data 不是 User 结构？直接崩

// ✅ 安全：使用类型守卫
function isValidUser(data: unknown): data is User {
    return typeof data === 'object' && data !== null
        && 'id' in data && typeof (data as any).id === 'number'
        && 'name' in data && typeof (data as any).name === 'string';
}

if (isValidUser(response.data)) {
    console.log(response.data.name); // 安全
}
```

**React/Vue 中常见的类型问题**：

1. **事件处理函数类型**：React 的 `onChange` 事件参数类型容易写错，正确写法是 `(e: React.ChangeEvent<HTMLInputElement>) => void`
2. **Ref 类型**：`useRef<HTMLInputElement>(null)` 而不是 `useRef(null)`，否则 `ref.current` 类型是 `null`
3. **Vue 组件 Props**：使用 `defineProps<{...}>()` 而不是运行时 `props:` 声明，获得完整类型推断
4. **异步组件加载**：`defineAsyncComponent` 返回值需要显式标注组件类型

---

## 七、推荐组合

| 场景 | 工具链 |
|------|--------|
| 前端框架 | Vite + TypeScript + React/Vue |
| Node 服务 | tsx + TypeScript（开发）+ tsc 编译（部署） |
| 库开发 | tsup / unbuild / rollup-plugin-typescript2 |
| Monorepo | pnpm + TypeScript Project References |

---

## 八、从 JavaScript 迁移到 TypeScript

### 渐进式迁移策略

大型项目不可能一步到位，推荐渐进式迁移：

**第一步：安装与配置**

```bash
# 安装 TypeScript
npm install -D typescript @types/node

# 初始化 tsconfig.json
npx tsc --init

# 初始配置：宽松模式起步
```

```jsonc
// tsconfig.json —— 迁移初期配置
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": false,                  // 先不开，逐个开启
    "allowJs": true,                  // 允许 .js 文件
    "checkJs": false,                 // 暂不检查 .js
    "outDir": "./dist",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**第二步：重命名文件**

```bash
# 从核心模块开始，把 .js 改成 .ts
mv src/utils.js src/utils.ts
mv src/api.js src/api.ts

# React/Vue 组件：.jsx → .tsx
mv src/components/App.jsx src/components/App.tsx
```

**第三步：逐步添加类型**

```ts
// 迁移前：JavaScript
function fetchUser(id) {
    return fetch(`/api/users/${id}`)
        .then(res => res.json());
}

// 迁移中：添加参数和返回类型
interface User {
    id: number;
    name: string;
    email: string;
}

async function fetchUser(id: number): Promise<User> {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
```

**第四步：逐步开启严格选项**

```jsonc
// 逐个开启，每个选项修复完再开下一个
{
  "compilerOptions": {
    "strict": false,
    "noImplicitAny": true,           // 第一个开
    "strictNullChecks": true,        // 第二个开
    "strictFunctionTypes": true,     // 第三个开
    "strictBindCallApply": true,     // 第四个开
    "noImplicitThis": true,          // 第五个开
    "alwaysStrict": true             // 最后统一开 strict: true
  }
}
```

### 常见迁移问题与解法

| 问题 | 解法 |
|------|------|
| 第三方库没有类型 | `npm i -D @types/xxx`；或创建 `src/types/xxx.d.ts` |
| 动态属性访问报错 | 使用类型断言 `as` 或索引签名 `[key: string]: any` |
| `this` 指向问题 | 用箭头函数或给 `this` 添加参数类型 |
| 模块导入报错 | 添加 `allowJs: true`，逐步将 `.js` → `.ts` |
| 第三方库类型不准确 | 创建 `.d.ts` 补充声明或用 `// @ts-ignore` |

### 声明文件编写

```ts
// src/types/globals.d.ts —— 全局类型声明
declare const __APP_VERSION__: string;
declare const __API_BASE__: string;

// src/types/legacy-lib.d.ts —— 为无类型库写声明
declare module 'legacy-lib' {
    export function doSomething(config: { timeout: number }): Promise<void>;
    export const VERSION: string;
}

// src/types/images.d.ts —— 资源文件声明
declare module '*.png' {
    const src: string;
    export default src;
}
declare module '*.svg' {
    const content: React.FC<React.SVGAttributes<SVGElement>>;
    export default content;
}
```

---

## 九、TypeScript vs JavaScript vs Flow 对比

| 特性 | JavaScript | TypeScript | Flow |
|------|-----------|------------|------|
| **类型系统** | 动态 | 静态（结构化） | 静态（渐进式） |
| **编译步骤** | 不需要 | 需要（tsc / Vite 等） | 需要（Babel 插件） |
| **类型注解** | 无 | 原生支持 | 原生支持（需 Babel） |
| **泛型** | 不支持 | 完整支持 | 完整支持 |
| **枚举** | 不支持 | 支持 | 不支持 |
| **接口** | 不支持 | 支持 | 支持（type alias 为主） |
| **工具类型** | 无 | 内置丰富 | 有限 |
| **IDE 支持** | 基础 | 极好（官方 LSP） | 良好（仅 VS Code） |
| **生态规模** | 最大 | 极大（npm @types） | 较小 |
| **学习曲线** | 低 | 中等 | 中等偏高 |
| **社区活跃度** | 极高 | 极高 | 低（Meta 已不活跃维护） |
| **框架支持** | 全部 | React/Vue/Angular/Svelte 等 | React 为主 |
| **编译产物** | 无变化 | JavaScript | JavaScript |
| **渐进式采用** | — | ✅ allowJs | ✅ @flow 注释 |
| **最新语法支持** | ESNext | 快速跟进 | 滞后 |
| **企业采用** | 广泛 | 主流首选 | 几乎消失 |
| **Deno/Bun 支持** | ✅ | ✅ 原生 | ❌ |

**选择建议**：

- **新项目**：直接选 TypeScript，没有悬念。2024 年 State of JS 调查显示，TypeScript 使用率已超过 95%，几乎所有主流框架和工具链都原生支持。
- **已有 JS 项目**：渐进式迁移到 TypeScript。先从核心模块和新代码开始，利用 `allowJs` 和 `checkJs` 实现混合开发，逐步提升类型覆盖率。
- **Flow**：不推荐新项目使用。Meta 内部已逐步减少 Flow 的投入，社区维护几乎停滞，类型定义库远不如 `@types` 生态丰富。如果现有项目使用 Flow，建议制定迁移计划。
- **小型脚本/一次性工具**：JavaScript 仍然完全够用，不需要强制上 TypeScript。TypeScript 的价值在大型项目和团队协作中最为明显。

**性能对比**：TypeScript 编译会增加构建时间，但 Vite 的 esbuild 转译（非类型检查）几乎无感知。开发体验上，TypeScript 的自动补全、重构支持和错误提示能显著减少调试时间，长期来看提升开发效率远超编译开销。

---

## 十、Vite + TypeScript 项目实战

### Vite + TypeScript + Vue 3

```bash
# 创建项目
npm create vite@latest my-vue-app -- --template vue-ts
cd my-vue-app
npm install
```

项目结构：

```
my-vue-app/
├── src/
│   ├── App.vue
│   ├── main.ts
│   ├── vite-env.d.ts          # Vite 类型声明
│   ├── components/
│   │   └── HelloWorld.vue
│   ├── composables/
│   │   └── useUser.ts
│   └── types/
│       └── index.ts
├── tsconfig.json
├── tsconfig.app.json           # 应用配置
├── tsconfig.node.json          # Node 配置（vite.config.ts）
├── vite.config.ts
└── package.json
```

**组合式 API + TypeScript 示例**：

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

// 定义接口
interface User {
    id: number;
    name: string;
    email: string;
    role: 'admin' | 'user';
}

// 响应式数据（自动推断类型）
const users = ref<User[]>([]);
const filter = ref<'all' | 'admin' | 'user'>('all');
const loading = ref(false);

// 计算属性（自动推断返回类型）
const filteredUsers = computed(() => {
    if (filter.value === 'all') return users.value;
    return users.value.filter(u => u.role === filter.value);
});

// 方法（参数需要显式标注）
async function fetchUsers(): Promise<void> {
    loading.value = true;
    try {
        const res = await fetch('/api/users');
        users.value = await res.json();
    } finally {
        loading.value = false;
    }
}

// 泛型组合式函数
function useLocalStorage<T>(key: string, defaultValue: T) {
    const data = ref<T>(defaultValue);
    const stored = localStorage.getItem(key);
    if (stored) {
        data.value = JSON.parse(stored);
    }
    watch(data, (val) => {
        localStorage.setItem(key, JSON.stringify(val));
    }, { deep: true });
    return data;
}

const theme = useLocalStorage<'light' | 'dark'>('theme', 'light');

onMounted(fetchUsers);
</script>
```

### Vite + TypeScript + React

```bash
# 创建项目
npm create vite@latest my-react-app -- --template react-ts
cd my-react-app
npm install
```

**React 组件 + TypeScript 示例**：

```tsx
// src/components/UserCard.tsx
import { useState, useEffect } from 'react';

// Props 类型定义
interface UserCardProps {
    userId: number;
    onSelect?: (user: User) => void;
    variant?: 'compact' | 'full';
}

interface User {
    id: number;
    name: string;
    email: string;
    avatar?: string;
}

// 泛型 Hook
function useFetch<T>(url: string) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch(url)
            .then(res => res.json() as Promise<T>)
            .then(data => { if (!cancelled) setData(data); })
            .catch(err => { if (!cancelled) setError(err); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [url]);

    return { data, loading, error };
}

// 组件
export function UserCard({ userId, onSelect, variant = 'full' }: UserCardProps) {
    const { data: user, loading, error } = useFetch<User>(`/api/users/${userId}`);

    if (loading) return <div className="skeleton">加载中...</div>;
    if (error) return <div className="error">{error.message}</div>;
    if (!user) return null;

    return (
        <div className={`user-card ${variant}`} onClick={() => onSelect?.(user)}>
            {user.avatar && <img src={user.avatar} alt={user.name} />}
            <h3>{user.name}</h3>
            {variant === 'full' && <p>{user.email}</p>}
        </div>
    );
}
```

**Vite 配置中的 TypeScript 集成**：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    // TypeScript 相关
    esbuild: {
        // 生产环境移除 console.log
        drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
    build: {
        // 生成 .d.ts 声明文件（库模式）
        // lib: { entry: 'src/index.ts', formats: ['es', 'cjs'] },
        sourcemap: true,
        target: 'es2020',
    },
});
```

---

## 参考

- 官网：<https://www.typescriptlang.org>
- 中文手册：<https://typescript.bootcss.com>
- TypeScript Deep Dive：<https://basarat.gitbook.io/typescript/>
- 类型体操：<https://github.com/type-challenges/type-challenges>

---

## 相关阅读

- [Vue 3 + TypeScript 指南](/categories/Frontend/vue-3-typescript-guide/) — 在 Vue 3 中高效使用 TypeScript，涵盖组合式 API 的类型推断、泛型组件、defineProps 类型标注等实战技巧。
- [Vite + Laravel 全栈指南](/categories/Frontend/vite-laravel-guide/) — 使用 Vite 构建 Laravel 全栈应用，TypeScript 前端 + PHP 后端的完整工程化方案。
- [React Server Components + Next.js 15 实战](/categories/Frontend/react-server-components-nextjs-15-rsc-b2c-ecommerce/) — 基于 TypeScript 构建 Next.js 15 RSC 电商应用，服务端组件与客户端组件的类型安全实践。
