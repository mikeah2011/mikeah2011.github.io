---
title: Node.js 22 实战：require(esm)、WebSocket Client、test runner——从 CommonJS 到 ESM 的全面迁移路径
keywords: [Node.js, require, esm, WebSocket Client, test runner, CommonJS, 的全面迁移路径, 技术杂谈]
date: 2026-06-09 19:03:00
categories:
  - misc
cover: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
tags:
  - Node.js
  - ESM
  - CommonJS
  - WebSocket
  - test-runner
  - 迁移
description: Node.js 22 带来了三大重磅特性：require(esm) 解锁了 CommonJS 与 ESM 的互操作、内置 WebSocket Client 告别第三方依赖、原生 test runner 让测试不再需要 Jest。本文通过实战代码详解每个特性，并给出从 CJS 到 ESM 的完整迁移路径。
---


## 前言

Node.js 22（2024 年 4 月进入 Current，10 月进入 LTS）是一次里程碑式的版本更新。它不是那种"性能提升 5%"的增量迭代，而是直接解决了困扰 Node.js 社区多年的三个痛点：

1. **CommonJS 和 ESM 互操作**——`require()` 终于能加载 ESM 模块了
2. **内置 WebSocket Client**——不再需要 `ws`、`isomorphic-ws` 等第三方库
3. **原生 test runner**——`node --test` 走向稳定，Jest/Vitest 不再是必选项

如果你的项目还在 CommonJS 上运行，或者你一直在犹豫要不要迁移到 ESM，这篇文章就是为你写的。我们会从原理讲起，用可运行的代码演示每个特性，最后给出一份完整的迁移清单。

---

## 一、require(esm)：打破 CJS 与 ESM 的柏林墙

### 1.1 问题回顾

在 Node.js 22 之前，CJS 和 ESM 之间有一道硬墙：

```js
// math.mjs (ESM)
export function add(a, b) {
  return a + b;
}

// app.cjs (CommonJS)
const { add } = require('./math.mjs'); // ❌ ERR_REQUIRE_ESM
```

你被迫使用动态 `import()`，代码变成这样：

```js
// app.cjs — Node.js 21 及之前的写法
async function main() {
  const { add } = await import('./math.mjs');
  console.log(add(1, 2));
}
main();
```

这带来了三个问题：
- 所有依赖 ESM 包的代码都必须是 async 上下文
- 无法在模块顶层同步初始化
- 大量存量 CJS 项目无法平滑使用 ESM 生态的新包

### 1.2 Node.js 22 的解法

从 Node.js 22 开始，`require()` 可以直接加载 ESM 模块，但需要满足一个条件：**被加载的 ESM 模块不能使用顶层 await**。

```js
// math.mjs
export function add(a, b) {
  return a + b;
}

export const PI = 3.14159;

// app.cjs — Node.js 22+
const math = require('./math.mjs');
console.log(math.add(1, 2));     // 3
console.log(math.PI);            // 3.14159
```

同步、直接、没有 `await`。这就是 `require(esm)` 的核心价值。

### 1.3 实战：在现有 CJS 项目中使用 ESM 包

假设你有一个 Express 项目（CommonJS），想用一个只提供 ESM 的包（比如 `chalk` v5）：

```js
// package.json
{
  "name": "my-express-app",
  "version": "1.0.0",
  "dependencies": {
    "chalk": "^5.3.0",
    "express": "^4.18.2"
  }
}

// index.cjs
const express = require('express');
const chalk = require('chalk'); // Node.js 22 直接成功！

const app = express();

app.get('/', (req, res) => {
  console.log(chalk.green('Request received'));
  res.send('Hello World');
});

app.listen(3000, () => {
  console.log(chalk.blue('Server running on port 3000'));
});
```

在 Node.js 21 及之前，`require('chalk')` 会直接报错，因为 chalk v5 是纯 ESM。现在一切正常。

### 1.4 限制与注意事项

```js
// top-level-await.mjs — 有顶层 await 的模块
const data = await fetch('https://api.example.com/data');
export const result = await data.json();

// app.cjs
const { result } = require('./top-level-await.mjs'); // ❌ 仍然报错
```

**规则很简单**：有顶层 await 的 ESM 模块仍然只能用 `import()` 加载。这是 V8 引擎层面的限制，`require()` 是同步的，无法处理异步初始化。

### 1.5 检测模块类型

写一个工具函数来判断模块类型：

```js
// detect-module-type.cjs
function getModuleType(filepath) {
  try {
    require(filepath);
    return 'cjs-or-esm-without-top-level-await';
  } catch (err) {
    if (err.code === 'ERR_REQUIRE_ESM') {
      return 'esm-with-top-level-await';
    }
    throw err;
  }
}

console.log(getModuleType('./math.mjs'));
```

---

## 二、内置 WebSocket Client：告别第三方依赖

### 2.1 过去的痛点

在 Node.js 22 之前，要在服务端使用 WebSocket，你必须安装第三方库：

```bash
npm install ws
```

```js
const WebSocket = require('ws');
const ws = new WebSocket('wss://echo.websocket.org');

ws.on('open', () => {
  ws.send('Hello Server');
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});
```

浏览器早就内置了 `WebSocket` API，但 Node.js 一直缺席。这导致了同构代码的困难——浏览器用原生 API，服务端用 `ws`，两套写法。

### 2.2 Node.js 22 的内置 WebSocket Client

Node.js 22 内置了符合 W3C 标准的 WebSocket Client API，用法和浏览器完全一致：

```js
// ws-client.mjs
const ws = new WebSocket('wss://echo.websocket.org');

ws.addEventListener('open', () => {
  console.log('Connected');
  ws.send('Hello from Node.js 22!');
});

ws.addEventListener('message', (event) => {
  console.log('Received:', event.data);
});

ws.addEventListener('close', (event) => {
  console.log(`Closed: code=${event.code}, reason=${event.reason}`);
});

ws.addEventListener('error', (error) => {
  console.error('Error:', error);
});
```

### 2.3 实战：实时数据推送服务

构建一个股票价格推送的 WebSocket 客户端：

```js
// stock-ws-client.mjs
import { setTimeout } from 'timers/promises';

class StockPriceClient {
  constructor(url, symbols) {
    this.url = url;
    this.symbols = symbols;
    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.listeners = new Map();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener('open', () => {
      console.log(`[Stock] Connected to ${this.url}`);
      this.reconnectDelay = 1000; // 重置重连延迟
      // 订阅股票行情
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        symbols: this.symbols,
      }));
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleMessage(data);
      } catch (err) {
        console.error('[Stock] Parse error:', err.message);
      }
    });

    this.ws.addEventListener('close', async () => {
      console.log(`[Stock] Disconnected, reconnecting in ${this.reconnectDelay}ms...`);
      await setTimeout(this.reconnectDelay);
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay
      );
      this.connect();
    });

    this.ws.addEventListener('error', (err) => {
      console.error('[Stock] WebSocket error:', err.message);
    });
  }

  _handleMessage(data) {
    if (data.type === 'price') {
      const listeners = this.listeners.get('price') || [];
      listeners.forEach(fn => fn(data));
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// 使用
const client = new StockPriceClient('wss://stream.example.com', [
  'AAPL', 'GOOGL', 'MSFT',
]);

client.on('price', (data) => {
  console.log(`[Stock] ${data.symbol}: $${data.price} (${data.change > 0 ? '+' : ''}${data.change}%)`);
});

client.connect();
```

### 2.4 与 `ws` 库的对比

| 特性 | 内置 WebSocket | `ws` 库 |
|------|---------------|---------|
| 安装 | 不需要 | `npm install ws` |
| API 标准 | W3C WebSocket API | 自有 API |
| 服务端支持 | ❌ 仅客户端 | ✅ 服务端 + 客户端 |
| 二进制类型 | Blob/ArrayBuffer | Buffer |
| 自定义头 | ❌ 不支持 | ✅ 支持 |
| 协议扩展 | ❌ | ✅ permessage-deflate |

**结论**：如果你只需要 WebSocket 客户端（比如连接第三方 API、实时数据源），内置版本完全够用。如果你需要搭建 WebSocket 服务端，或者需要自定义头、压缩等高级功能，继续用 `ws`。

### 2.5 同构代码示例

现在可以写出浏览器和 Node.js 通用的 WebSocket 代码：

```js
// ws-isomorphic.mjs
export function createWebSocketManager(url, options = {}) {
  const ws = new WebSocket(url); // 浏览器和 Node.js 22 都支持
  const handlers = {};

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      const type = data.type;
      if (handlers[type]) {
        handlers[type].forEach(fn => fn(data));
      }
    } catch (err) {
      console.error('Message parse error:', err);
    }
  });

  return {
    on(type, callback) {
      if (!handlers[type]) handlers[type] = [];
      handlers[type].push(callback);
    },
    send(type, payload) {
      ws.send(JSON.stringify({ type, ...payload }));
    },
    close() {
      ws.close();
    },
    get readyState() {
      return ws.readyState;
    },
  };
}
```

---

## 三、原生 test runner：Jest/Vitest 不再是必选项

### 3.1 为什么需要原生测试框架

Node.js 内置 `assert` 模块多年，但一直没有内置的测试运行器。这导致每个项目都要引入 Jest 或 Vitest，带来：

- 额外的依赖（Jest 安装后 node_modules 膨胀 50MB+）
- 配置复杂（babel/transform/mock 配置）
- 启动慢（Jest 冷启动 3-5 秒）

Node.js 18 引入了实验性的 `node --test`，Node.js 22 将其标记为稳定。

### 3.2 基础用法

```js
// math.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { add, multiply } from './math.mjs';

describe('Math operations', () => {
  it('should add two numbers', () => {
    assert.strictEqual(add(1, 2), 3);
  });

  it('should multiply two numbers', () => {
    assert.strictEqual(multiply(3, 4), 12);
  });

  it('should handle negative numbers', () => {
    assert.strictEqual(add(-1, 1), 0);
    assert.strictEqual(add(-5, -3), -8);
  });
});
```

运行：

```bash
node --test math.test.mjs
```

输出：

```
✔ Math operations > should add two numbers (0.5ms)
✔ Math operations > should multiply two numbers (0.1ms)
✔ Math operations > should handle negative numbers (0.1ms)

ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ duration_ms 50.1234
```

### 3.3 实战：测试 Express API

```js
// api.test.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:strict';
import { createApp } from './app.mjs';

describe('Express API', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    server = app.listen(0); // 随机端口
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after(() => {
    server.close();
  });

  it('GET / should return 200', async () => {
    const res = await fetch(baseUrl);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.strictEqual(text, 'Hello World');
  });

  it('GET /api/users should return JSON array', async () => {
    const res = await fetch(`${baseUrl}/api/users`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(Array.isArray(data));
    assert(data.length > 0);
  });

  it('POST /api/users should create user', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email: 'test@example.com' }),
    });
    assert.strictEqual(res.status, 201);
    const user = await res.json();
    assert.strictEqual(user.name, 'Test User');
  });
});
```

### 3.4 Mock 与 Spy

Node.js 22 的 test runner 内置了 mock 功能，不再需要 `sinon` 或 `jest.mock`：

```js
// mock-demo.test.mjs
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock 整个模块
const sendEmailMock = mock.fn(async (to, subject, body) => {
  return { success: true, messageId: 'mock-id-123' };
});

// 模拟一个依赖邮件服务的函数
async function welcomeUser(email, sendEmailFn) {
  if (!email.includes('@')) {
    throw new Error('Invalid email');
  }
  const result = await sendEmailFn(email, 'Welcome!', 'Thanks for signing up.');
  return result;
}

describe('welcomeUser', () => {
  it('should send welcome email', async () => {
    const result = await welcomeUser('user@example.com', sendEmailMock);

    assert.strictEqual(result.success, true);
    assert.strictEqual(sendEmailMock.mock.callCount(), 1);

    // 验证调用参数
    const call = sendEmailMock.mock.calls[0];
    assert.deepStrictEqual(call.arguments, [
      'user@example.com',
      'Welcome!',
      'Thanks for signing up.',
    ]);
  });

  it('should reject invalid email', async () => {
    await assert.rejects(
      () => welcomeUser('invalid-email', sendEmailMock),
      { message: 'Invalid email' }
    );
  });

  it('should support mock implementation change', async () => {
    sendEmailMock.mock.mockImplementationOnce(async () => {
      throw new Error('SMTP down');
    });

    await assert.rejects(
      () => welcomeUser('user@example.com', sendEmailMock),
      { message: 'SMTP down' }
    );
  });
});
```

### 3.5 代码覆盖率

Node.js 22 的 test runner 支持内置的代码覆盖率：

```bash
# 带覆盖率运行
node --test --experimental-test-coverage math.test.mjs

# 只显示未覆盖的文件
node --test --experimental-test-coverage --test-coverage-reporter=text math.test.mjs
```

输出示例：

```
┌──────────────────┬───────────┬─────────────┬─────────────┐
│ File             │ Line %    │ Branch %    │ Func %      │
├──────────────────┼───────────┼─────────────┼─────────────┤
│ math.mjs         │ 100.00    │ 100.00      │ 100.00      │
│ app.mjs          │  85.71    │  75.00      │  90.00      │
├──────────────────┼───────────┼─────────────┼─────────────┤
│ All files        │  92.31    │  85.71      │  95.00      │
└──────────────────┴───────────┴─────────────┴─────────────┘
```

### 3.6 与 Jest 的对比

| 特性 | Node.js test runner | Jest |
|------|-------------------|------|
| 安装大小 | 0（内置） | ~50MB |
| 冷启动 | <100ms | 3-5s |
| Mock | 内置 `mock.fn()` | `jest.fn()` |
| 覆盖率 | 内置（实验性） | c8/istanbul |
| 快照测试 | ✅ | ✅ |
| 并行执行 | ✅（默认） | ✅（默认） |
| ESM 支持 | 原生 | 需要配置 |
| 生态插件 | 较少 | 丰富 |

**建议**：新项目直接用原生 test runner。存量 Jest 项目不必急着迁移，但如果 Jest 配置让你痛苦，可以考虑逐步切换。

---

## 四、从 CommonJS 到 ESM 的完整迁移路径

### 4.1 迁移前评估

先确认你的项目状态：

```bash
# 检查是否有 ESM-only 的依赖
grep -r "type.*module" node_modules/*/package.json | head -20

# 检查 Node.js 版本
node -v  # 需要 >= 22.x

# 检查当前模块类型
cat package.json | grep '"type"'
```

### 4.2 策略选择

**策略 A：渐进迁移（推荐）**

利用 Node.js 22 的 `require(esm)` 特性，不改 `package.json`，逐步将 `.js` 文件改为 `.mjs`：

```
project/
├── package.json          # 不加 "type": "module"
├── src/
│   ├── index.cjs         # 入口保持 CJS
│   ├── utils.mjs         # 新文件用 ESM
│   └── services/
│       └── cache.mjs     # 逐步迁移
└── tests/
    └── utils.test.mjs    # 测试直接用 ESM
```

优点：零风险，新旧代码共存，不需要一次性改完。

**策略 B：全量切换**

直接在 `package.json` 中设置 `"type": "module"`，然后把所有 `.js` 文件的 `require` 改成 `import`，`module.exports` 改成 `export`。

优点：一步到位，代码风格统一。
缺点：改动量大，需要一次性修复所有兼容问题。

### 4.3 渐进迁移实操

#### 第一步：新文件用 ESM

```js
// src/utils.mjs — 新文件直接写 ESM
export function formatCurrency(amount, currency = 'CNY') {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

#### 第二步：在 CJS 文件中引用 ESM

```js
// src/index.cjs — Node.js 22 直接 require ESM
const { formatCurrency, sleep } = require('./utils.mjs');

console.log(formatCurrency(99.9));  // ¥99.90
```

#### 第三步：迁移测试文件

测试文件是最适合先迁移 ESM 的——它们是独立的，不影响生产代码：

```js
// tests/utils.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, sleep } from '../src/utils.mjs';

describe('formatCurrency', () => {
  it('should format CNY', () => {
    assert.match(formatCurrency(100), /¥100/);
  });

  it('should format USD', () => {
    assert.match(formatCurrency(99.99, 'USD'), /US\$99.99/);
  });
});

describe('sleep', () => {
  it('should resolve after delay', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    assert(elapsed >= 45); // 允许少量误差
  });
});
```

#### 第四步：处理 __dirname 和 __filename

ESM 中没有 `__dirname` 和 `__filename`，需要手动构造：

```js
// ESM 中获取当前文件目录
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 使用示例
const configPath = join(__dirname, '../config.json');
```

#### 第五步：处理 JSON 导入

ESM 中不能直接 `require('./config.json')`，有几种方案：

```js
// 方案 1：使用 import assertion（Node.js 22 支持）
import config from './config.json' with { type: 'json' };

// 方案 2：使用 createRequire
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const config = require('./config.json');

// 方案 3：使用 fs 读取
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf-8'));
```

推荐方案 1，语法最简洁。Node.js 22 已经稳定支持 `with { type: 'json' }`。

### 4.4 常见迁移踩坑

**踩坑 1：循环依赖**

CJS 对循环依赖有特殊处理（返回部分完成的对象），ESM 则严格得多。如果你的项目有循环依赖，迁移时会暴露出来。

```js
// a.mjs
import { b } from './b.mjs';
export const a = 'A';
export function getB() { return b; }

// b.mjs
import { a } from './a.mjs';  // ⚠️ 此时 a 还是 undefined
export const b = 'B';
```

解决方法：重新组织代码结构，消除循环依赖。或者使用延迟导入：

```js
// b.mjs — 延迟导入
export const b = 'B';
export async function getA() {
  const { a } = await import('./a.mjs');
  return a;
}
```

**踩坑 2：动态 require**

CJS 中常见的动态 `require` 在 ESM 中需要用 `import()` 替代：

```js
// CJS
const plugin = require(`./plugins/${name}.js`);

// ESM
const plugin = await import(`./plugins/${name}.js`);
```

**踩坑 3：第三方包兼容性**

检查你的依赖是否支持 ESM：

```bash
# 检查包的 package.json
cat node_modules/some-package/package.json | grep -E '"type"|"exports"|"main"'
```

好消息是，Node.js 22 的 `require(esm)` 特性让这个问题大大缓解——即使依赖是 ESM-only，你的 CJS 代码也能直接 `require` 它。

### 4.5 迁移检查清单

```bash
# 1. 确认 Node.js 版本
node -v  # >= 22.x

# 2. 运行测试
node --test tests/**/*.test.mjs

# 3. 检查 lint
npx eslint src/ --ext .mjs,.cjs

# 4. 构建检查
npm run build

# 5. 检查包大小
npx bundle-phobia ./package.json
```

---

## 五、其他值得关注的 Node.js 22 特性

### 5.1 `--watch` 模式稳定

```bash
# 文件变更自动重启，不再需要 nodemon
node --watch index.mjs
```

### 5.2 `--experimental-strip-types`

直接运行 TypeScript 文件（不需要 tsc 编译）：

```bash
node --experimental-strip-types app.ts
```

这在脚本和工具开发中非常有用。注意：它只剥离类型注解，不做类型检查。

### 5.3 `glob` 和 `globSync` 内置

```js
import { glob, globSync } from 'node:fs';

// 递归查找所有 .mjs 文件
const files = globSync('src/**/*.mjs');
console.log(files);
```

不再需要 `fast-glob` 或 `glob` 包。

---

## 六、总结

Node.js 22 的三大特性形成了一个完整的迁移闭环：

1. **`require(esm)`** 让你可以在不改动现有 CJS 代码的前提下，逐步引入 ESM 模块
2. **内置 WebSocket Client** 减少了对第三方库的依赖，让同构代码成为可能
3. **原生 test runner** 让测试框架回归零配置，启动速度提升 50 倍

迁移的核心原则是**渐进式**——不要追求一步到位。新文件用 ESM，旧文件保持 CJS，利用 `require(esm)` 实现平滑过渡。等到大多数文件都迁移完毕后，再考虑切换 `package.json` 的 `type` 字段。

Node.js 22 还有一个隐藏的好处：它让 `type: "module"` 的决策变得更简单。过去你需要权衡"ESM 生态兼容性"，现在 `require(esm)` 直接消除了这个顾虑。

---

## 参考资料

- [Node.js 22 Release Notes](https://nodejs.org/en/blog/release/v22.0.0)
- [Node.js Documentation: `require()` for ESM](https://nodejs.org/docs/latest-v22.x/api/modules.html#loading-ecmascript-modules-using-require)
- [Node.js Documentation: Test Runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
