---

cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
keywords: [JavaScript]
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
title: JavaScript
tags:
- JavaScript
- 前端
categories:
- frontend
date: 2019-03-20 15:05:07
description: JavaScript 是 Web 的脚本语言，从浏览器交互发展到 Node.js 全栈、Electron 桌面、React Native 移动端。本文梳理核心概念、ES6+ 关键特性和常见陷阱。
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

---

## 七、var / let / const 深度对比

| 特性 | `var` | `let` | `const` |
|------|-------|-------|---------|
| 作用域 | 函数作用域 | 块作用域 | 块作用域 |
| 变量提升 | ✅ 初始化为 `undefined` | ✅ 但进入 TDZ（暂时性死区） | ✅ 但进入 TDZ |
| 重复声明 | ✅ 允许 | ❌ 报错 | ❌ 报错 |
| 重新赋值 | ✅ | ✅ | ❌（对象内部属性仍可改） |
| 全局对象挂载 | ✅（`window.x`） | ❌ | ❌ |
| 推荐程度 | 🚫 旧代码专用 | 可变变量 | **默认首选** |

```js
// TDZ 示例
console.log(a); // undefined（var 提升）
// console.log(b); // ReferenceError（let 在 TDZ 中）
let b = 2;

// const 对象可变
const config = { host: 'localhost' };
config.host = '127.0.0.1'; // ✅ 不报错
// config = {};              // ❌ TypeError
```

**实践原则**：默认用 `const`，需要重新赋值时用 `let`，永远不用 `var`。

---

## 八、闭包与作用域链

### 什么是闭包？

闭包 = 函数 + 它能访问的外部作用域变量。当内部函数被返回或传递到外部时，它"记住"了创建时的词法环境。

```js
function makeCounter() {
    let count = 0;              // 局部变量
    return {
        increment: () => ++count,
        decrement: () => --count,
        getCount: () => count
    };
}

const counter = makeCounter();
counter.increment(); // 1
counter.increment(); // 2
counter.decrement(); // 1
console.log(counter.getCount()); // 1
// count 不可从外部直接访问——实现了私有状态
```

### 作用域链查找

```js
const global = 'global';

function outer() {
    const outerVar = 'outer';

    function inner() {
        const innerVar = 'inner';
        console.log(innerVar);   // 1. 当前作用域 → found
        console.log(outerVar);   // 2. outer 作用域 → found
        console.log(global);     // 3. 全局作用域 → found
    }

    inner();
}
```

查找顺序：**当前作用域 → 父作用域 → … → 全局作用域**，找到即停。

### 经典循环陷阱

```js
// var 版本——全部输出 6
for (var i = 0; i < 5; i++) {
    setTimeout(() => console.log(i), 100);
}
// 输出: 5 5 5 5 5（i 是同一个变量，循环结束时 i=5）

// let 版本——每次迭代创建新的块作用域
for (let i = 0; i < 5; i++) {
    setTimeout(() => console.log(i), 100);
}
// 输出: 0 1 2 3 4

// IIFE 版本（ES5 时代修法）
for (var i = 0; i < 5; i++) {
    (function (j) {
        setTimeout(() => console.log(j), 100);
    })(i);
}
```

### 实用闭包模式

```js
// 1. 防抖（debounce）
function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// 2. 柯里化
function curry(fn) {
    return function curried(...args) {
        if (args.length >= fn.length) {
            return fn.apply(this, args);
        }
        return (...moreArgs) => curried(...args, ...moreArgs);
    };
}

const add3 = curry((a, b, c) => a + b + c);
add3(1)(2)(3);    // 6
add3(1, 2)(3);    // 6
```

---

## 九、原型链与继承

### 原型链图解

```
instance
  ──[[Prototype]]──→ Constructor.prototype
                        ──[[Prototype]]──→ Object.prototype
                                              ──[[Prototype]]──→ null
```

```js
function Animal(name) {
    this.name = name;
}
Animal.prototype.speak = function () {
    return `${this.name} makes a sound`;
};

function Dog(name, breed) {
    Animal.call(this, name);   // 继承实例属性
    this.breed = breed;
}

// 建立原型链
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog;

Dog.prototype.fetch = function () {
    return `${this.name} fetches the ball`;
};

const rex = new Dog('Rex', 'Labrador');
rex.speak();  // "Rex makes a sound" — 继承自 Animal
rex.fetch();  // "Rex fetches the ball" — Dog 自身方法
rex instanceof Dog;    // true
rex instanceof Animal; // true
```

### ES6 class 语法糖

```js
class Animal {
    constructor(name) {
        this.name = name;
    }
    speak() {
        return `${this.name} makes a sound`;
    }
    // 静态方法——挂在构造函数上，不在原型上
    static isAnimal(obj) {
        return obj instanceof Animal;
    }
}

class Dog extends Animal {
    #breed;  // 私有字段（ES2022）

    constructor(name, breed) {
        super(name);           // 必须先调 super
        this.#breed = breed;
    }

    get breed() {
        return this.#breed;
    }

    speak() {
        return `${this.name} barks!`;
    }
}

const dog = new Dog('Rex', 'Labrador');
dog.speak();          // "Rex barks!"
dog.breed;            // "Labrador"
// dog.#breed;        // SyntaxError: 私有字段
Animal.isAnimal(dog); // true
```

> **注意**：`class` 是语法糖，底层仍然是基于原型的。`typeof Dog` 仍是 `"function"`。

---

## 十、事件循环与异步编程

### 事件循环模型

```
┌───────────────────────────┐
│        Call Stack          │  ← 同步代码执行
└──────────┬────────────────┘
           │ 同步代码执行完毕
           ▼
┌───────────────────────────┐
│    Microtask Queue         │  ← Promise.then/catch/finally、
│  (优先级高，全部清空)       │     MutationObserver、queueMicrotask
└──────────┬────────────────┘
           │ microtask 全部清空
           ▼
┌───────────────────────────┐
│    Macrotask Queue         │  ← setTimeout/setInterval、
│  (每次只取一个)             │     I/O、setImmediate、requestAnimationFrame
└───────────────────────────┘
```

```js
console.log('1');                   // 同步

setTimeout(() => console.log('2'), 0); // macrotask

Promise.resolve().then(() => console.log('3')); // microtask

console.log('4');                   // 同步

// 输出: 1 → 4 → 3 → 2
```

### Promise 深入

```js
// 手写简化版 Promise（面试高频）
class MyPromise {
    constructor(executor) {
        this._state = 'pending';
        this._value = undefined;
        this._callbacks = [];

        const resolve = (value) => {
            if (this._state !== 'pending') return;
            this._state = 'fulfilled';
            this._value = value;
            this._callbacks.forEach(cb => cb.onFulfilled(value));
        };

        try {
            executor(resolve);
        } catch (e) {
            // reject(e)
        }
    }

    then(onFulfilled) {
        return new MyPromise((resolve) => {
            this._callbacks.push({
                onFulfilled: (value) => resolve(onFulfilled(value))
            });
        });
    }
}
```

### async / await 执行顺序

```js
async function foo() {
    console.log('foo start');
    await bar();
    console.log('foo end');        // 等同于 bar().then(() => console.log('foo end'))
}

async function bar() {
    console.log('bar');
}

foo();
new Promise(resolve => {
    console.log('promise callback');
    resolve();
}).then(() => console.log('promise then'));

// 输出:
// foo start
// bar
// promise callback
// foo end
// promise then
```

### 并发控制

```js
// 限制并发数的 Promise 调度器
async function asyncPool(limit, items, iteratorFn) {
    const results = [];
    const executing = new Set();

    for (const [index, item] of items.entries()) {
        const p = Promise.resolve().then(() => iteratorFn(item, index));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }

    return Promise.all(results);
}

// 使用：最多同时请求 3 个
const urls = Array.from({ length: 20 }, (_, i) => `/api/item/${i}`);
const data = await asyncPool(3, urls, url => fetch(url).then(r => r.json()));
```

### Generator

```js
function* fibonacci() {
    let [a, b] = [0, 1];
    while (true) {
        yield a;
        [a, b] = [b, a + b];
    }
}

const fib = fibonacci();
fib.next().value; // 0
fib.next().value; // 1
fib.next().value; // 1
fib.next().value; // 2
fib.next().value; // 3

// Generator 实现 async/await 的底层机制
function asyncToGenerator(generatorFn) {
    return function (...args) {
        const gen = generatorFn.apply(this, args);
        return new Promise((resolve, reject) => {
            function step(key, arg) {
                let result;
                try {
                    result = gen[key](arg);
                } catch (error) {
                    return reject(error);
                }
                const { value, done } = result;
                if (done) return resolve(value);
                Promise.resolve(value).then(
                    val => step('next', val),
                    err => step('throw', err)
                );
            }
            step('next');
        });
    };
}
```

---

## 十一、ES6+ 高级特性

### Proxy 与 Reflect

```js
const reactive = (target, onChange) => {
    return new Proxy(target, {
        set(obj, prop, value) {
            const oldValue = obj[prop];
            const result = Reflect.set(obj, prop, value);
            if (oldValue !== value) {
                onChange(prop, value, oldValue);
            }
            return result;
        },
        get(obj, prop) {
            const value = Reflect.get(obj, prop);
            // 深层代理
            if (typeof value === 'object' && value !== null) {
                return reactive(value, onChange);
            }
            return value;
        }
    });
};

const state = reactive({ user: { name: 'Mike' } }, (prop, val) => {
    console.log(`${prop} changed to ${val}`);
});
state.user.name = 'John'; // "name changed to John"
```

> Vue 3 的响应式系统底层就是基于 `Proxy` + `Reflect` 实现的。

### WeakRef 与 FinalizationRegistry（ES2021）

```js
let target = { data: 'heavy object' };
const ref = new WeakRef(target);

ref.deref(); // { data: 'heavy object' }
target = null; // 允许 GC 回收
ref.deref(); // undefined（可能，取决于 GC 时机）

// 注册回收回调
const registry = new FinalizationRegistry((heldValue) => {
    console.log(`Object with key "${heldValue}" was garbage collected`);
});
registry.register(target, 'my-object');
```

### 其他实用特性速览

```js
// 1. Array.at()（ES2022）
const arr = [1, 2, 3, 4, 5];
arr.at(-1);  // 5（替代 arr[arr.length - 1]）

// 2. Object.groupBy()（ES2024）
const people = [
    { name: 'Alice', age: 25 },
    { name: 'Bob', age: 30 },
    { name: 'Carol', age: 25 }
];
Object.groupBy(people, p => p.age);
// { 25: [{name:'Alice',...}, {name:'Carol',...}], 30: [{name:'Bob',...}] }

// 3. Top-level await（ES2022，仅限模块）
const data = await fetch('/api/data').then(r => r.json());

// 4. Logical assignment（ES2021）
let a = null;
a ??= 'default';   // a = 'default'（等价 a = a ?? 'default'）
let b = '';
b ||= 'fallback';  // b = 'fallback'（等价 b = b || 'fallback'）
let c = 0;
c &&= 42;          // c = 0（等价 c = c && 42）

// 5. structuredClone（深拷贝，ES2022+）
const original = { nested: { deep: [1, 2, 3] } };
const clone = structuredClone(original);
```

---

## 十二、常见陷阱深度解析

### this 绑定规则

```js
const obj = {
    name: 'obj',
    // 1️⃣ 隐式绑定
    greet() { return this.name; },
    // 2️⃣ 箭头函数——继承外层 this
    greetArrow: () => this.name,  // undefined（外层是模块/全局）
    // 3️⃣ 定时器中的 this
    delayed() {
        setTimeout(function () {
            console.log(this); // window（丢失隐式绑定）
        }, 100);
        setTimeout(() => {
            console.log(this); // obj（箭头函数继承外层）
        }, 100);
    }
};

obj.greet();               // 'obj'（隐式绑定）
const fn = obj.greet;
fn();                      // undefined（隐式绑定丢失 → 默认绑定）
obj.greet.call({ name: 'other' }); // 'other'（显式绑定）

// 优先级：new > 显式 > 隐式 > 默认
```

### 类型强制转换的坑

```js
// 真值/假值陷阱
Boolean('0');       // true（非空字符串）
Boolean([]);        // true（空数组是真值！）
!!'0' && !![];      // true
'0' == false;       // true
[] == false;        // true
'' == false;        // true
// 但 '0' == [] → false（因为 ToPrimitive([]) = ''）

// 加法 vs 减法
'5' + 3;            // '53'（字符串拼接）
'5' - 3;            // 2（数字运算）
'hello' - 1;        // NaN

// 对象转原始值
const obj = {
    valueOf() { return 1; },
    toString() { return '2'; }
};
obj + 1;             // 2（调用 valueOf）
`${obj}`;            // '2'（调用 toString）
```

### 内存泄漏场景

```js
// ❌ 1. 被遗忘的定时器
setInterval(() => {
    // 引用了外部变量，组件卸载后不会自动清除
}, 1000);

// ✅ 修复：清除定时器
const timer = setInterval(callback, 1000);
clearInterval(timer);

// ❌ 2. 未移除的事件监听
element.addEventListener('click', handler);
// element 被移除后 handler 可能仍被引用

// ✅ 修复
element.removeEventListener('click', handler);

// ❌ 3. 闭包持有大对象引用
function createHeavyData() {
    const bigData = new Array(1000000).fill('*');
    return function unused() {
        // 不用 bigData，但闭包仍持有引用
        // 某些引擎可能优化掉，但不应依赖
    };
}

// ❌ 4. 全局变量
window.cache = document.querySelectorAll('*'); // 永远不被 GC

// ❌ 5. Detached DOM 节点
let detached = document.getElementById('node');
document.body.removeChild(detached);
// detached 仍在 JS 引用中，不会被 GC
detached = null; // ✅ 释放
```

---

## 参考（补充）

- <https://javascript.info/> — 现代 JS 教程
- <https://exploringjs.com/> — Axel Rauschmayer 系列
- <https://tc39.es/ecma262/> — ECMAScript 规范原文

---

## 相关阅读

- [Vue](/categories/Frontend/vue/)
- [TypeScript](/categories/Frontend/typescript/)
- [Deno 2.x 实战：安全优先的 JavaScript 运行时——与 Node.js/Bun 的三选一决策](/categories/Frontend/deno-2x-javascript-runtime-nodejs-bun-decision/)
