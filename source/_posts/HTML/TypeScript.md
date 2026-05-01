---
title: TypeScript
tags:
  - TypeScript
  - 前端
categories:
  - HTML
date: 2020-03-20 15:05:07
description: 'TypeScript 是 JavaScript 的超集，由微软开发，加上了静态类型系统。它把"运行时崩溃"前置到"编译时报错"，大型项目几乎是必选。'
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

---

## 七、推荐组合

| 场景 | 工具链 |
|------|--------|
| 前端框架 | Vite + TypeScript + React/Vue |
| Node 服务 | tsx + TypeScript（开发）+ tsc 编译（部署） |
| 库开发 | tsup / unbuild / rollup-plugin-typescript2 |
| Monorepo | pnpm + TypeScript Project References |

---

## 参考

- 官网：<https://www.typescriptlang.org>
- 中文手册：<https://typescript.bootcss.com>
- TypeScript Deep Dive：<https://basarat.gitbook.io/typescript/>
- 类型体操：<https://github.com/type-challenges/type-challenges>
