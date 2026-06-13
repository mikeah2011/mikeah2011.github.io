---

title: Chrome DevTools Protocol 实战：浏览器自动化底层协议——Playwright/Puppeteer 的 CDP 通信机制与自定义调试工具开发
keywords: [Chrome DevTools Protocol, Playwright, Puppeteer, CDP, 浏览器自动化底层协议, 通信机制与自定义调试工具开发, 前端]
date: 2026-06-10 04:20:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Chrome DevTools Protocol
- CDP
- Playwright
- Puppeteer
- 自动化
- 调试工具
- Node.js
description: 深入剖析 Chrome DevTools Protocol 的底层通信机制，从 WebSocket 帧级别理解 Playwright/Puppeteer 的命令分发原理，并动手开发一个基于 CDP 的自定义性能监控与调试工具。
---



## 为什么你需要了解 CDP？

市面上的浏览器自动化工具——Puppeteer、Playwright、Selenium 4——它们的内核都在同一条管道上跑：**Chrome DevTools Protocol（CDP）**。理解 CDP 不是为了造轮子，而是为了在轮子打滑的时候知道往哪修。

笔者在 KKday B2C 项目中用 Playwright 做端到端测试和爬虫，遇到过不少诡异场景：页面白屏但控制台无报错、特定资源加载卡住导致测试超时、需要精确控制 Service Worker 缓存策略……这些问题在高级 API 层面很难定位，但抓到 CDP 层面一看就清楚了。

本文的目标：**从 TCP 连接到 WebSocket 帧，搞清楚 CDP 是什么、Playwright 怎么用它、以及如何基于它开发一个实战可用的性能监控工具。**

---

## 一、CDP 架构全景

### 1.1 协议概览

CDP 是 Chrome（和 Chromium 内核浏览器）暴露的一套 JSON-RPC 协议。它通过 **Unix Socket**（macOS/Linux）或 **Named Pipe**（Windows）与浏览器进程通信，底层走的是 WebSocket。

```
┌──────────────┐    WebSocket (JSON-RPC)    ┌────────────────┐
│  Your Tool   │ ◄────────────────────────► │  Chrome/Blink  │
│  (Node.js)   │    ws://127.0.0.1:PORT     │  DevTools      │
└──────────────┘                             │  Frontend      │
                                             └────────────────┘
```

### 1.2 Domain 模型

CDP 把浏览器功能分成若干 Domain，每个 Domain 包含一组命令（Command）、事件（Event）和类型（Type）：

| Domain | 职责 | 常用命令 |
|--------|------|---------|
| `Page` | 页面生命周期 | `navigate`, `reload`, `printToPDF` |
| `Runtime` | JavaScript 执行 | `callFunctionOn`, `evaluate`, `getProperties` |
| `Network` | 网络请求拦截 | `enable`, `setRequestInterception`, `getResponseBody` |
| `DOM` | DOM 树操作 | `getDocument`, `querySelector`, `setAttributeValue` |
| `Performance` | 性能指标采集 | `getMetrics`, `enable` |
| `Debugger` | 断点调试 | `enable`, `setBreakpointsActive`, `stepOver` |
| `Emulation` | 设备模拟 | `setDeviceMetricsOverride`, `setGeolocationOverride` |
| `Target` | 多标签管理 | `getTargets`, `createTarget`, `attachToTarget` |
| `Browser` | 浏览器级别操作 | `getVersion`, `close`, `downloadWillBegin` |

### 1.3 通信格式

CDP 使用 **JSON-RPC 2.0** 格式，命令调用和响应通过 WebSocket 帧传输：

```json
// 请求（Client → Browser）
{
  "id": 1,
  "method": "Page.navigate",
  "params": {
    "url": "https://example.com"
  }
}

// 响应（Browser → Client）
{
  "id": 1,
  "result": {
    "frameId": "ABC123",
    "loaderId": "DEF456"
  }
}

// 事件（Browser → Client，无 id）
{
  "method": "Page.loadEventFired",
  "params": {
    "timestamp": 1623456789.123
  }
}
```

---

## 二、手搓一个 CDP 客户端

理解协议最好的方式是从零实现一个最小客户端。我们用 Node.js + `ws` 库直接连 CDP，不依赖任何高级库。

### 2.1 启动 Chrome 并获取调试端口

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --headless=new \
  --no-first-run

# 查看 WebSocket URL
curl http://127.0.0.1:9222/json/version
```

返回结果中的 `webSocketDebuggerUrl` 就是我们需要的连接地址。

### 2.2 最小 CDP 客户端实现

```javascript
// cdp-client.js
const WebSocket = require('ws');

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.callbacks = new Map();    // id → { resolve, reject }
    this.eventHandlers = new Map(); // method → Set<handler>
  }

  // 连接到 Chrome
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, {
        perMessageDeflate: false
      });

      this.ws.on('open', () => resolve());

      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        // 命令响应：有 id 字段
        if (message.id !== undefined) {
          const cb = this.callbacks.get(message.id);
          if (cb) {
            this.callbacks.delete(message.id);
            if (message.error) {
              cb.reject(new Error(
                `${message.error.code}: ${message.error.message}`
              ));
            } else {
              cb.resolve(message.result);
            }
          }
        }

        // 事件推送：有 method 字段，无 id
        if (message.method) {
          const handlers = this.eventHandlers.get(message.method);
          if (handlers) {
            handlers.forEach(handler => handler(message.params));
          }
        }
      });

      this.ws.on('error', reject);
    });
  }

  // 发送命令
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // 监听事件
  on(method, handler) {
    if (!this.eventHandlers.has(method)) {
      this.eventHandlers.set(method, new Set());
    }
    this.eventHandlers.get(method).add(handler);
  }

  // 断开连接
  close() {
    if (this.ws) this.ws.close();
  }
}

module.exports = { CDPClient };
```

### 2.3 验证连通性

```javascript
// test-connect.js
const { CDPClient } = require('./cdp-client');

async function main() {
  // 获取 WebSocket URL
  const response = await fetch('http://127.0.0.1:9222/json/version');
  const { webSocketDebuggerUrl } = await response.json();

  const client = new CDPClient(webSocketDebuggerUrl);
  await client.connect();

  // 查询浏览器版本
  const version = await client.send('Browser.getVersion');
  console.log('Browser:', version.product);
  console.log('Protocol:', version.protocolVersion);
  console.log('User-Agent:', version.userAgent);

  // 获取所有打开的页面
  const targets = await client.send('Target.getTargets');
  const pages = targets.targetInfos.filter(t => t.type === 'page');
  console.log(`\nOpen pages: ${pages.length}`);
  pages.forEach(p => console.log(`  - ${p.title} (${p.url})`));

  client.close();
}

main().catch(console.error);
```

运行结果：

```
Browser: HeadlessChrome/131.0.6778.86
Protocol: 1.3
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...

Open pages: 1
  - about:blank (about:blank)
```

---

## 三、Playwright 的 CDP 层揭秘

Playwright 在 CDP 之上封装了大量高级 API，但很多高级功能本质是 CDP 命令的组合。理解这层映射关系，遇到问题时就知道在哪一层排查。

### 3.1 Playwright 的连接模型

```
你的测试代码
    ↓ （高级 API）
Playwright TestRunner
    ↓ （内部协议层）
BrowserContext / Page / Frame
    ↓ （JSON-RPC）
WebSocket → Chrome DevTools
```

Playwright 默认不走 CDP 的 `Page.navigate`，而是通过自己的协议注入导航控制。但在某些场景下（如性能采集、网络拦截），它直接调用 CDP Domain。

### 3.2 直接使用 Playwright 的 CDP Session

Playwright 提供了 `CDPSession` 接口，让你在不脱离 Playwright 上下文的情况下直接发送 CDP 命令：

```javascript
// playwright-cdp-session.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 创建 CDP Session
  const cdp = await page.context().newCDPSession(page);

  // 开启网络监听
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (params) => {
    console.log(`[CDP] ${params.request.method} ${params.request.url}`);
  });

  // 使用 CDP 的 Emulation 设置地理位置
  await cdp.send('Emulation.setGeolocationOverride', {
    latitude: 31.2304,   // 上海
    longitude: 121.4737,
    accuracy: 100
  });

  // 用 CDP 采集 Performance Metrics
  await cdp.send('Performance.enable');
  await page.goto('https://httpbin.org/get');
  const metrics = await cdp.send('Performance.getMetrics');
  
  console.log('\n=== Performance Metrics ===');
  metrics.metrics.forEach(m => {
    console.log(`  ${m.name}: ${m.value}`);
  });

  // 截取 CDP 级别的全页截图（含滚动区域）
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true
  });
  require('fs').writeFileSync('full-page-cdp.png', 
    Buffer.from(data, 'base64'));

  await browser.close();
})();
```

### 3.3 CDP 与 Playwright API 的对应关系

| 操作 | Playwright API | CDP 底层命令 |
|------|---------------|-------------|
| 页面导航 | `page.goto(url)` | `Page.navigate` |
| 等待加载 | `page.waitForLoadState()` | `Page.loadEventFired` 事件 |
| 截图 | `page.screenshot()` | `Page.captureScreenshot` |
| 点击元素 | `page.click(selector)` | `DOM.querySelector` → `Input.dispatchMouseEvent` |
| 拦截请求 | `page.route()` | `Fetch.enable` + `Fetch.requestPaused` |
| 注入脚本 | `page.evaluate()` | `Runtime.evaluate` |
| 打印 PDF | `page.pdf()` | `Page.printToPDF` |
| 模拟设备 | `page.setViewportSize()` | `Emulation.setDeviceMetricsOverride` |

关键认知：**Playwright 的 `page.route()` 用的是 CDP 的 `Fetch` Domain（而非 `Network`），因为 `Fetch` 支持暂停请求并修改响应。**

---

## 四、实战：用 CDP 开发性能监控工具

理论够了，来看一个能直接用的项目——一个基于 CDP 的页面性能监控工具，采集 Core Web Vitals、资源加载瀑布、JS 执行耗时等关键指标。

### 4.1 工具架构

```
┌─────────────────────────────────────┐
│         cdp-perf-monitor            │
├─────────────────────────────────────┤
│  CDPClient  │  MetricCollector     │
│  ├ connect  │  ├ LCP/FCP/CLS      │
│  ├ send     │  ├ Resource Timing   │
│  └ on       │  └ JS Heap Usage    │
├─────────────────────────────────────┤
│          Report Generator           │
│  ├ Console Table                   │
│  ├ JSON Export                     │
│  └ HTML Dashboard                  │
└─────────────────────────────────────┘
```

### 4.2 核心代码实现

```javascript
// perf-monitor.js
const { CDPClient } = require('./cdp-client');
const { chromium } = require('playwright');

class PerfMonitor {
  constructor(page) {
    this.page = page;
    this.cdp = null;
    this.metrics = {
      navigation: {},
      resources: [],
      memory: [],
      lcp: null,
      fcp: null,
      cls: 0
    };
  }

  async init() {
    this.cdp = await this.page.context().newCDPSession(this.page);

    // 启用所有需要的 Domain
    await this.cdp.send('Performance.enable');
    await this.cdp.send('Network.enable');
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('DOM.enable');

    // 注入 Web Vitals 采集脚本
    await this.cdp.send('Runtime.evaluate', {
      expression: this._getVitalsScript(),
      awaitPromise: false
    });

    // 监听事件
    this._setupListeners();
  }

  _getVitalsScript() {
    // 通过 CDP Runtime.evaluate 注入的 Web Vitals 采集
    return `
      (function() {
        // LCP - Largest Contentful Paint
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          window.__CDP_METRICS_LCP = lastEntry.renderTime || lastEntry.loadTime;
          // 通过 console.log 输出，后面我们会在 CDP 层面捕获
          console.log('__CDP_LCP__' + window.__CDP_METRICS_LCP);
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        // FCP - First Contentful Paint
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            window.__CDP_METRICS_FCP = entries[0].startTime;
            console.log('__CDP_FCP__' + window.__CDP_METRICS_FCP);
          }
        }).observe({ type: 'paint', buffered: true });

        // CLS - Cumulative Layout Shift
        let clsValue = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
          window.__CDP_METRICS_CLS = clsValue;
          console.log('__CDP_CLS__' + clsValue);
        }).observe({ type: 'layout-shift', buffered: true });
      })();
    `;
  }

  _setupListeners() {
    // 监听控制台输出，提取 Web Vitals 指标
    this.cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = params.args.map(a => a.value || '').join('');
      if (text.startsWith('__CDP_LCP__')) {
        this.metrics.lcp = parseFloat(text.replace('__CDP_LCP__', ''));
      } else if (text.startsWith('__CDP_FCP__')) {
        this.metrics.fcp = parseFloat(text.replace('__CDP_FCP__', ''));
      } else if (text.startsWith('__CDP_CLS__')) {
        this.metrics.cls = parseFloat(text.replace('__CDP_CLS__', ''));
      }
    });

    // 监听资源加载
    this.cdp.on('Network.loadingFinished', (params) => {
      this.metrics.resources.push({
        requestId: params.requestId,
        encoded: params.encodedDataLength,
        duration: params.timestamp
      });
    });

    // 监听导航计时
    this.cdp.on('Performance.metrics', (params) => {
      for (const m of params.metrics) {
        this.metrics.navigation[m.name] = m.value;
      }
    });
  }

  async startMonitoring(url) {
    console.log(`\n🔍 开始监控: ${url}\n`);

    const startTime = Date.now();
    await this.page.goto(url, { waitUntil: 'networkidle' });
    const loadTime = Date.now() - startTime;

    // 额外等待 Web Vitals 稳定
    await this.page.waitForTimeout(2000);

    // 采集 CDP Performance Metrics
    const perfMetrics = await this.cdp.send('Performance.getMetrics');
    const metricMap = {};
    perfMetrics.metrics.forEach(m => {
      metricMap[m.name] = m.value;
    });

    // 采集 JS 堆内存
    const memory = await this.cdp.send('Runtime.getHeapUsage');

    return {
      url,
      loadTime,
      webVitals: {
        lcp: this.metrics.lcp,
        fcp: this.metrics.fcp,
        cls: this.metrics.cls
      },
      performance: {
        domContentLoaded: metricMap['DomContentLoaded'],
        domInteractive: metricMap['DomInteractive'],
        firstPaint: metricMap['FirstPaint'],
        frames: metricMap['Frames'],
        jsHeapUsed: memory.jsHeapUsedSize,
        jsHeapTotal: memory.jsHeapTotalSize,
        layoutCount: metricMap['LayoutCount']
      },
      resourceSummary: {
        totalResources: metricMap['Resources'],
        totalTransferSize: metricMap['RecalcStyleCount']
      }
    };
  }

  formatReport(result) {
    const lines = [];
    lines.push('═'.repeat(60));
    lines.push(`📊 性能报告: ${result.url}`);
    lines.push('═'.repeat(60));
    lines.push('');
    lines.push(`⏱  页面加载时间:      ${result.loadTime}ms`);
    lines.push('');
    lines.push('--- Core Web Vitals ---');
    lines.push(`  FCP (首次内容绘制):  ${result.webVitals.fcp?.toFixed(1) || 'N/A'}ms`);
    lines.push(`  LCP (最大内容绘制):  ${result.webVitals.lcp?.toFixed(1) || 'N/A'}ms`);
    lines.push(`  CLS (累积布局偏移):  ${result.webVitals.cls?.toFixed(3) || 'N/A'}`);
    lines.push('');
    lines.push('--- CDP Performance Metrics ---');
    lines.push(`  DomContentLoaded:    ${result.performance.domContentLoaded?.toFixed(1)}ms`);
    lines.push(`  DomInteractive:      ${result.performance.domInteractive?.toFixed(1)}ms`);
    lines.push(`  First Paint:         ${result.performance.firstPaint?.toFixed(1)}ms`);
    lines.push(`  帧数:                ${result.performance.frames}`);
    lines.push(`  JS Heap Used:        ${(result.performance.jsHeapUsed / 1024 / 1024).toFixed(2)}MB`);
    lines.push(`  JS Heap Total:       ${(result.performance.jsHeapTotal / 1024 / 1024).toFixed(2)}MB`);
    lines.push(`  Layout 次数:         ${result.performance.layoutCount}`);
    lines.push('');
    lines.push('═'.repeat(60));

    return lines.join('\n');
  }
}

module.exports = { PerfMonitor };
```

### 4.3 使用示例

```javascript
// run-monitor.js
const { chromium } = require('playwright');
const { PerfMonitor } = require('./perf-monitor');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const monitor = new PerfMonitor(page);
  await monitor.init();

  // 监控多个页面
  const urls = [
    'https://example.com',
    'https://httpbin.org/html',
    'https://jsonplaceholder.typicode.com'
  ];

  const results = [];
  for (const url of urls) {
    const result = await monitor.startMonitoring(url);
    results.push(result);
    console.log(monitor.formatReport(result));
  }

  // 导出 JSON 报告
  require('fs').writeFileSync('perf-report.json', 
    JSON.stringify(results, null, 2));
  console.log('\n📄 报告已保存: perf-report.json');

  await browser.close();
})();
```

运行输出示例：

```
══════════════════════════════════════════════════════════════
📊 性能报告: https://example.com
══════════════════════════════════════════════════════════════

⏱  页面加载时间:      847ms

--- Core Web Vitals ---
  FCP (首次内容绘制):  234.5ms
  LCP (最大内容绘制):  312.8ms
  CLS (累积布局偏移):  0.000

--- CDP Performance Metrics ---
  DomContentLoaded:    456.2ms
  DomInteractive:      412.1ms
  First Paint:         189.3ms
  帧数:                0
  JS Heap Used:        1.23MB
  JS Heap Total:       2.45MB
  Layout 次数:         1

══════════════════════════════════════════════════════════════
```

---

## 五、CDP 高级用法

### 5.1 网络请求拦截与修改

CDP 的 `Fetch` Domain 比 Playwright 的 `page.route()` 更底层，可以做更精细的控制：

```javascript
// 拦截请求并注入自定义 Header
await cdp.send('Fetch.enable', {
  patterns: [{ urlPattern: '*', requestStage: 'Request' }]
});

cdp.on('Fetch.requestPaused', async (event) => {
  const { requestId, request } = event;
  
  // 给所有 API 请求加 Token
  if (request.url.includes('/api/')) {
    await cdp.send('Fetch.continueRequest', {
      requestId,
      headers: [
        ...Object.entries(request.headers).map(([name, value]) => ({
          name, value
        })),
        { name: 'X-Custom-Auth', value: 'Bearer my-token' }
      ]
    });
  } else {
    await cdp.send('Fetch.continueRequest', { requestId });
  }
});
```

### 5.2 截取特定元素截图

```javascript
// 获取元素位置并截取局部截图
const { root } = await cdp.send('DOM.getDocument');
const { nodeId } = await cdp.send('DOM.querySelector', {
  nodeId: root.nodeId,
  selector: '.target-element'
});

const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
const [x1, y1] = model.content;  // 左上角坐标

await cdp.send('Page.captureScreenshot', {
  format: 'png',
  clip: {
    x: x1,
    y: y1,
    width: model.width,
    height: model.height,
    scale: 1
  }
});
```

### 5.3 模拟弱网环境

```javascript
// 通过 Network Domain 模拟弱网
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 200,         // 延迟 200ms
  downloadThroughput: 50 * 1024,   // 下行 50KB/s
  uploadThroughput: 20 * 1024      // 上行 20KB/s
});

// 现在加载页面，所有请求都会被限速
await page.goto('https://your-app.com');
```

---

## 六、踩坑记录

### 6.1 CDP Session 数量限制

Chrome 对单个连接的 CDP Session 数量有限制（默认约 100 个）。频繁创建/销毁 `CDPSession` 会导致内存泄漏和连接变慢。

**解决方案**：在工具初始化时创建必要的 Session，复用而非重建。

### 6.2 Headless 模式的指标差异

`--headless=new`（新版 Headless）和 `--headless`（旧版）采集到的性能指标可能不一致。某些 Web Vitals 指标在 Headless 模式下不准确，特别是 CLS（因为没有真实窗口尺寸）。

**建议**：性能测试用 `--headless=new` + `Emulation.setDeviceMetricsOverride` 指定视口。

### 6.3 WebSocket 断连重连

CDP 的 WebSocket 连接在长时间运行后可能断开（特别是 Chrome 被系统回收内存时）。实现重连机制时注意：

```javascript
this.ws.on('close', () => {
  console.warn('[CDP] 连接断开，尝试重连...');
  setTimeout(() => this.reconnect(), 1000);
});

this.ws.on('unexpected-response', (req, res) => {
  if (res.statusCode === 500) {
    // Chrome 可能正在重启，等久一点
    setTimeout(() => this.reconnect(), 5000);
  }
});
```

### 6.4 Playwright 的 CDP Session 生命周期

`page.context().newCDPSession(page)` 创建的 Session 在 Page 关闭时自动销毁。不要在 `page.close()` 之后再调用 CDP 命令，会报 `Target closed` 错误。

### 6.5 内存泄漏排查

用 CDP 的 `HeapProfiler` 可以精确追踪内存：

```javascript
// 开始采集堆快照
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.collectGarbage');

// 采集快照
const chunks = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', (params) => {
  chunks.push(params.chunk);
});

await cdp.send('HeapProfiler.takeHeapSnapshot', {
  reportProgress: false
});

const snapshot = chunks.join('');
require('fs').writeFileSync('heap.heapsnapshot', snapshot);
// 用 Chrome DevTools 的 Memory tab 打开分析
```

---

## 七、总结

CDP 不是一个你需要每天直接打交道的协议，但它是所有 Chromium 浏览器自动化的基石。理解它之后：

1. **排查问题更快**：Playwright 报错时，能判断是 API 层问题还是 CDP 层问题
2. **性能采集更准**：直接用 CDP 的 Performance Domain 比 Performance API 拿到的数据更全
3. **自定义能力更强**：当高级 API 不够用时（比如修改请求头、模拟设备指纹），CDP 是最后一道底牌

**推荐学习路径**：

1. 先用 Playwright 的 `newCDPSession()` 体验 CDP 命令
2. 读 Chrome 的 [CDP 协议文档](https://chromedevtools.github.io/devtools-protocol/)，了解各 Domain 的能力
3. 动手做一个小工具（比如上面的性能监控器），巩固理解

**实战建议**：日常开发不需要记住所有 CDP 命令，但至少熟悉 `Page`、`Runtime`、`Network`、`Performance` 这四个核心 Domain。遇到问题时查文档、用工具抓 CDP 流量，比反复改代码试错效率高得多。

---

> 💡 **延伸阅读**
> - [Chrome DevTools Protocol 官方文档](https://chromedevtools.github.io/devtools-protocol/)
> - [Playwright CDP Session API](https://playwright.dev/docs/api/class-cdpsession)
> - [Puppeteer CDP 直连示例](https://pptr.dev/guides/cdp-session)
> - [Web Vitals 标准](https://web.dev/vitals/)
