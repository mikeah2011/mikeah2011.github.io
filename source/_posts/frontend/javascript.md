---
title: JavaScript
tags: [JavaScript, 前端]
categories: Frontend
date: 2019-03-20 15:05:07
description: 'JavaScript 是 Web 的脚本语言，从浏览器交互发展到 Node.js 全栈、Electron 桌面、React Native 移动端。本文梳理核心概念、ES6+ 关键特性和常见陷阱。'



---
## 一、JavaScript 简介

JavaScript 由 Brendan Eich 于 1995 年在 Netscape 用 **10 天**写成（这是它早期混乱设计的根源）。后由 ECMA 标准化为 **ECMAScript（ES）**，目前主流是 **ES2015 (ES6)** 之后的版本。

它的运行环境：

- **浏览器**：操作 DOM、发请求、做动画
- **Node.js**：服务端、CLI、构建工具
- **Electron**：桌面应用（VSCode、Discord）
- **React Native / Hermes**：移动端
- **Deno / Bun**：新一代 JS 运行时

---

## 二、核心特性

### 类型与变量

```js
// 7 种原始类型 + Object
typeof 42            // "number"
typeof "hi"          // "string"
typeof true          // "boolean"
typeof undefined     // "undefined"
typeof null          // "object"  ← 历史 bug
typeof Symbol()      // "symbol"
typeof 1n            // "bigint"

// 变量声明
var x = 1;           // 函数作用域，少用
let y = 2;           // 块作用域，可重赋值
const z = 3;         // 块作用域，不可重赋值（但对象内部可改）
```

### == vs ===

```js
0 == ''       // true（隐式转换）
0 == '0'      // true
'' == '0'     // false ← 注意！
null == undefined   // true
null === undefined  // false

// 永远用 ===，除非你非常清楚要做什么
```

---

## 三、ES6+ 关键特性

### 箭头函数

```js
const add = (a, b) => a + b;

// this 绑定外层（解决了回调里 this 跑偏的老问题）
class Timer {
    start() {
        setInterval(() => {
            console.log(this);   // Timer 实例，不是 setInterval 的 this
        }, 1000);
    }
}
```

### 解构 + 展开

```js
const { name, age = 18 } = user;        // 默认值
const [first, ...rest] = [1, 2, 3, 4];  // first=1, rest=[2,3,4]
const merged = { ...obj1, ...obj2 };
```

### 模板字符串

```js
const name = "Mike";
console.log(`Hello, ${name}!`);
console.log(`Multi
            line`);
```

### Promise + async/await

```js
async function fetchUser(id) {
    try {
        const res = await fetch(`/api/user/${id}`);
        return await res.json();
    } catch (e) {
        console.error(e);
    }
}

// 并发
const [u1, u2] = await Promise.all([fetchUser(1), fetchUser(2)]);
```

### 模块化

```js
// math.js
export const add = (a, b) => a + b;
export default function sub(a, b) { return a - b; }

// main.js
import sub, { add } from './math.js';
```

### 可选链 + 空值合并（ES2020）

```js
const city = user?.address?.city ?? 'Unknown';
// 等价旧写法
const city = (user && user.address && user.address.city) || 'Unknown';
//                                                   ↑ 但 '' / 0 / false 会误判
```

---

## 四、常见陷阱

| 陷阱 | 示例 | 解释 |
|------|------|------|
| **浮点精度** | `0.1 + 0.2 === 0.3` → false | IEEE 754 限制，用 BigDecimal 库 |
| **NaN 自身不等** | `NaN === NaN` → false | 用 `Number.isNaN(x)` |
| **数组 sort 默认按字符串** | `[10, 2, 1].sort()` → `[1, 10, 2]` | 传比较函数 `(a,b) => a-b` |
| **typeof null** | → `"object"` | 历史遗留；判 null 用 `x === null` |
| **forEach 不能 await** | 串行变并行无序 | 用 `for...of` 或 `Promise.all(arr.map(async))` |
| **变量提升** | `console.log(x); var x=1;` 不报错 | 用 `let/const` 替代 `var` |
| **对象比较** | `{a:1} === {a:1}` → false | 引用相等，不是结构相等 |

---

## 五、运行时与生态

### 浏览器 API

DOM、`fetch`、`localStorage`、`WebSocket`、`Web Workers`、`Service Worker`、`IndexedDB`...

### Node.js

```bash
node app.js
npm install express
```

### 包管理器

| 工具 | 特点 |
|------|------|
| **npm** | 官方，慢但通用 |
| **yarn** | 早期 npm 替代品 |
| **pnpm** | 硬链接节省磁盘，monorepo 友好 |
| **bun** | 包管理 + 运行时 + 打包，速度快 |

### 框架（前端）

- **React** — 生态最大，Hooks 心智模型清晰
- **Vue** — 上手最快，模板 + 响应式
- **Svelte** — 编译时框架，运行时为 0
- **Solid** — 像 React 但用真正的细粒度响应式

---

## 六、TypeScript？

如果项目超过几千行，**强烈建议上 TypeScript**。它在 JavaScript 上加了类型系统，把"运行时报 undefined"提前到"编译时报错"，重构友好度提升一个量级。

> 现代前端基本默认 TS，纯 JS 多用于小脚本、原型验证。

---

## 参考

- MDN：<https://developer.mozilla.org/zh-CN/docs/Web/JavaScript>
- ECMAScript 提案：<https://github.com/tc39/proposals>
- You Don't Know JS：<https://github.com/getify/You-Dont-Know-JS>
