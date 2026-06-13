---

title: API Mock 策略实战：WireMock/Mockoon/MSW 三层 Mock 体系——从开发到测试到生产的接口隔离
keywords: [API Mock, WireMock, Mockoon, MSW, Mock, 策略实战, 三层, 体系, 从开发到测试到生产的接口隔离]
date: 2026-06-06 09:00:00
tags:
- API Mock
- Mock
- msw
- 接口测试
- 契约测试
- Pact
- 前后端分离
description: 深入解析 MSW（Mock Service Worker）、Mockoon、WireMock 三层 API Mock 体系的选型与实战落地。覆盖浏览器端 Service Worker 请求拦截、GUI 模板驱动的联调 Mock 服务、JVM 精确匹配与状态机驱动的集成测试三个层次，结合环境变量路由、Pact 契约测试、CI/CD Mock 泄露检测等工程化机制，实现前后端分离开发中的接口隔离与并行交付。含 Laravel/Vue 集成代码、8 大踩坑案例与完整 GitHub Actions 流水线配置。
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---





## 引言：为什么我们需要分层 Mock？

在当今微服务架构与前后端分离的开发模式下，一个中型项目通常依赖 10 至 50 个内部和外部 API。每个接口的延迟交付、不可用状态或行为变更，都会像多米诺骨牌一样拖慢整个团队的开发节奏。前端开发者每天浪费在等待后端接口上的时间可能高达 30% 至 40%，而测试团队因为第三方支付、短信网关等外部服务的不稳定性，经常出现测试用例时而通过时而失败的"薛定谔的 Bug"。

传统做法中，开发者要么苦等后端同事完成接口再联调，要么手写一堆硬编码的 JSON 文件来模拟响应。前者直接浪费工期，后者虽然解了燃眉之急，却带来了新的问题：Mock 数据与真实接口逐渐脱节、不同开发者维护各自的 Mock 文件导致行为不一致、Mock 代码散落在业务逻辑中难以清理……这些问题的根源在于团队缺乏一套系统性的 Mock 策略。

**分层 Mock** 的核心思想是：不同阶段、不同角色对 Mock 的需求截然不同，因此不应该用一种工具覆盖所有场景。前端开发者需要的是零配置、与框架深度集成的请求拦截，不希望为了 Mock 而修改一行业务代码；后端和测试团队在联调阶段需要的是一个共享的、可快速搭建的 Mock 服务器，让前后端能基于同一份数据源对齐；而自动化测试阶段则需要精确可控的请求匹配、状态机驱动的响应模拟以及故障注入能力。

本文将深入介绍一套经过实战验证的三层 Mock 体系——**MSW**（Mock Service Worker）负责开发层、**Mockoon** 负责联调层、**WireMock** 负责测试层。三者通过环境变量路由实现无缝切换，通过契约测试确保与真实接口的行为一致性，最终形成从开发到测试到生产的完整接口隔离链路。

---

## 一、三层 Mock 架构全景

在正式介绍各工具之前，先从全局视角看三层架构的职责划分：

```
┌─────────────────────────────────────────────────────────────┐
│                    生产环境 (Production)                      │
│                真实 API 服务 / 真实第三方服务                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐           │
│  │   MSW     │    │  Mockoon  │    │ WireMock  │           │
│  │  浏览器层  │    │  联调层   │    │  测试层   │           │
│  └─────┬─────┘    └─────┬─────┘    └─────┬─────┘           │
│        │                │                │                  │
│  前端本地开发      团队联调/原型      集成测试/CI            │
│  组件单元测试      快速 Mock 服务    契约验证/故障注入        │
│                                                             │
│  ┌─────────────────────────────────────────────────┐        │
│  │           契约测试 (Pact / OpenAPI Diff)          │        │
│  │     确保三层 Mock 与真实 API 行为一致性            │        │
│  └─────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

| 层次 | 工具 | 运行位置 | 典型场景 | 核心优势 |
|------|------|---------|---------|---------|
| 开发层 | MSW | 浏览器 / Node.js | 前端开发、组件测试 | 对业务代码完全透明，无需修改 API 地址 |
| 联调层 | Mockoon | 本地 / CI / Docker | 前后端联调、原型验证 | GUI 友好，支持模板语法和动态响应 |
| 测试层 | WireMock | 独立 JVM 进程 / Docker | 集成测试、契约验证 | 精确匹配、录制回放、状态机、故障注入 |

三层之间的协作关系可以用一句话概括：MSW 让前端不再等待，Mockoon 让团队不再分歧，WireMock 让测试不再脆弱。

---

## 二、第一层：MSW——前端开发的"隐形 Mock"

### 2.1 MSW 的工作原理与优势

MSW（Mock Service Worker）的工作原理是在浏览器中注册一个 Service Worker，拦截所有发出的网络请求并根据预定义的处理器（handler）返回模拟响应。它最大的优势在于**透明性**——业务代码中的 `fetch()` 或 `axios.get()` 完全无需修改，也不存在 `if (isMock)` 这种侵入性的条件判断。开发者甚至不需要知道 Mock 的存在，请求照常发出，只是被 Service Worker 在网络层拦截了而已。

与传统的 axios-mock-adapter 或 fetch-mock 不同，MSW 不是在 JavaScript 层面替换 `fetch` 函数，而是在更底层的网络层进行拦截。这意味着它对使用 XMLHttpRequest 的第三方库同样生效，而且不会影响到浏览器的 Network 面板——你依然能在 DevTools 中看到完整的请求和响应记录，这对调试非常有帮助。

### 2.2 项目集成步骤

```bash
# 安装 MSW
npm install msw --save-dev

# 生成 Service Worker 文件到 public 目录
# 这个命令会在 public/ 下生成一个 mockServiceWorker.js 文件
npx msw init public/ --save
```

安装完成后，项目目录结构如下：

```
src/
├── mocks/
│   ├── browser.ts       # 浏览器端 worker 实例
│   ├── server.ts        # Node.js 端 server 实例（用于测试）
│   ├── handlers.ts      # 所有请求处理器
│   └── fixtures/        # 静态 Mock 数据文件
│       ├── users.json
│       └── orders.json
public/
└── mockServiceWorker.js # MSW 自动生成的 Service Worker 文件
```

### 2.3 定义请求处理器

请求处理器是 MSW 的核心配置，每个处理器定义了一条请求匹配规则和对应的响应逻辑：

```typescript
// src/mocks/handlers.ts
import { http, HttpResponse, delay } from 'msw'

// 模拟用户列表数据
const mockUsers = [
  { id: 1, name: '张三', email: 'zhangsan@example.com', role: 'admin', createdAt: '2025-01-15T08:30:00Z' },
  { id: 2, name: '李四', email: 'lisi@example.com', role: 'editor', createdAt: '2025-03-22T14:10:00Z' },
  { id: 3, name: '王五', email: 'wangwu@example.com', role: 'viewer', createdAt: '2025-06-01T09:00:00Z' },
]

export const handlers = [
  // GET 用户列表——支持分页和角色过滤
  http.get('/api/users', async ({ request }) => {
    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('page_size') || '20')
    const role = url.searchParams.get('role')

    // 模拟真实网络延迟，让前端开发体验更真实
    await delay(200)

    let filtered = [...mockUsers]
    if (role) {
      filtered = filtered.filter(u => u.role === role)
    }

    return HttpResponse.json({
      data: filtered.slice((page - 1) * pageSize, page * pageSize),
      meta: {
        current_page: page,
        per_page: pageSize,
        total: filtered.length,
        last_page: Math.ceil(filtered.length / pageSize),
      },
    })
  }),

  // GET 单个用户详情——模拟 404 场景
  http.get('/api/users/:id', async ({ params }) => {
    const id = parseInt(params.id as string)
    const user = mockUsers.find(u => u.id === id)

    if (!user) {
      return HttpResponse.json(
        { message: '用户不存在', code: 'USER_NOT_FOUND' },
        { status: 404 }
      )
    }

    await delay(100)
    return HttpResponse.json({ data: user })
  }),

  // POST 创建用户——模拟参数校验失败场景
  http.post('/api/users', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>

    if (!body.name || !body.email) {
      return HttpResponse.json(
        {
          message: '参数校验失败',
          errors: {
            ...(body.name ? {} : { name: '姓名不能为空' }),
            ...(body.email ? {} : { email: '邮箱不能为空' }),
          },
        },
        { status: 422 }
      )
    }

    // 模拟邮箱重复
    if (mockUsers.some(u => u.email === body.email)) {
      return HttpResponse.json(
        { message: '邮箱已被注册', code: 'EMAIL_DUPLICATE' },
        { status: 409 }
      )
    }

    await delay(300)
    return HttpResponse.json(
      { data: { id: 4, ...body, createdAt: new Date().toISOString() } },
      { status: 201 }
    )
  }),

  // 模拟 500 服务器错误——测试前端的错误处理逻辑
  http.get('/api/error-demo', () => {
    return HttpResponse.json(
      { message: 'Internal Server Error', trace_id: 'trc-mock-001' },
      { status: 500 }
    )
  }),

  // 模拟网络超时——测试前端的超时处理和重试机制
  http.get('/api/slow-endpoint', async () => {
    await delay(30000) // 模拟 30 秒超时
    return HttpResponse.json({ data: 'never-reached' })
  }),
]
```

### 2.4 浏览器端初始化

```typescript
// src/mocks/browser.ts
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
```

```typescript
// src/main.ts —— Vue 3 应用入口
async function bootstrap() {
  // 仅在开发环境且环境变量启用 Mock 时加载 MSW
  // 生产环境和普通开发环境不会触发，零性能损耗
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({
      onUnhandledRequest: 'bypass', // 未匹配的请求直接放行到真实服务器
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
    console.log('[MSW] Mock 服务已启动')
  }

  // 正常创建和挂载 Vue 应用
  const app = createApp(App)
  app.use(router)
  app.use(pinia)
  app.mount('#app')
}

bootstrap()
```

环境变量配置——通过 `.env` 文件控制 Mock 开关：

```bash
# .env.development —— 默认开发环境配置
VITE_MOCK=true
VITE_API_BASE_URL=/api

# .env.development.local —— 个人本地覆盖（加入 .gitignore）
# 当你需要连接真实后端服务时，将 MOCK 关闭
VITE_MOCK=false
VITE_API_BASE_URL=http://localhost:8000/api
```

### 2.5 Vitest 中的 Node 模式集成

MSW 不仅能拦截浏览器请求，还能在 Node.js 环境中拦截 HTTP 请求。这意味着 Vitest 或 Jest 中的单元测试和集成测试也能共享同一套 handler 定义：

```typescript
// src/mocks/server.ts
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

```typescript
// vitest.setup.ts —— 测试全局设置
import { server } from './src/mocks/server'
import { beforeAll, afterEach, afterAll } from 'vitest'

// 启动 Mock 服务器——拦截所有测试中的 HTTP 请求
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// 每个测试用例结束后重置 handler 状态
// 确保测试之间不会互相影响
afterEach(() => server.resetHandlers())

// 所有测试完成后关闭 Mock 服务器
afterAll(() => server.close())
```

在具体测试文件中，可以通过 `server.use()` 动态覆盖默认 handler，模拟特定场景：

```typescript
// src/__tests__/UserList.spec.ts
import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { fetchUsers } from '../services/userService'

describe('用户列表服务', () => {
  it('正常获取用户列表', async () => {
    const result = await fetchUsers()
    expect(result.data).toHaveLength(3)
    expect(result.meta.total).toBe(3)
  })

  it('服务端返回 500 时应抛出业务异常', async () => {
    // 动态覆盖：让 /api/users 返回 500
    server.use(
      http.get('/api/users', () => {
        return HttpResponse.json(
          { message: '服务器内部错误' },
          { status: 500 }
        )
      })
    )

    await expect(fetchUsers()).rejects.toThrow('服务器内部错误')
  })

  it('网络超时应触发重试机制', async () => {
    server.use(
      http.get('/api/users', async () => {
        await delay(30000)
        return HttpResponse.json({ data: [] })
      })
    )

    // 测试超时重试逻辑
    await expect(fetchUsers({ timeout: 3000, retries: 2 })).rejects.toThrow()
  })
})
```

---

## 三、第二层：Mockoon——团队联调的共享 Mock 服务

### 3.1 为什么联调阶段需要 Mockoon？

MSW 只在浏览器进程内部生效。当场景变为以下情况时，MSW 就力不从心了：

- **后端开发者需要调试接口逻辑**：后端需要一个稳定的上游服务 Mock，但 MSW 无法拦截服务端的 HTTP 请求
- **移动端开发**：iOS/Android 应用无法使用 Service Worker
- **多服务联调**：团队需要一个所有成员都能访问的共享 Mock 端点
- **产品经理和设计师需要查看原型**：他们不会运行 `npm run dev`

Mockoon 正是为解决这些场景而生。它是一个基于 Electron 的本地 Mock 服务器，提供直观的 GUI 界面来配置 Mock 规则，也支持 CLI 和 Docker 启动。配置完成后导出为 JSON 文件纳入版本控制，全团队共享同一份 Mock 数据。

### 3.2 GUI 配置详解

Mockoon 的 GUI 界面左侧是路由列表，右侧是请求匹配和响应配置面板。以下是一个模拟电商 API 的完整配置：

```json
{
  "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "E-Commerce API Mock",
  "port": 3001,
  "endpointPrefix": "api",
  "latency": 50,
  "routes": [
    {
      "uuid": "route-001",
      "method": "GET",
      "endpoint": "products",
      "documentation": "获取商品列表，支持分类筛选和分页",
      "responses": [
        {
          "uuid": "resp-001",
          "statusCode": 200,
          "label": "商品列表-默认",
          "headers": [
            { "key": "Content-Type", "value": "application/json" },
            { "key": "X-Request-Id", "value": "{{uuid}}" }
          ],
          "body": "{\n  \"data\": [\n    {\n      \"id\": \"{{faker 'string.uuid'}}\",\n      \"name\": \"{{faker 'commerce.productName'}}\",\n      \"price\": {{faker 'commerce.price' 10 1000}},\n      \"category\": \"{{faker 'commerce.department'}}\",\n      \"inStock\": {{faker 'datatype.boolean'}}\n    }\n  ],\n  \"total\": {{faker 'number.int' { \"min\": 10, \"max\": 200 } }}\n}"
        }
      ]
    },
    {
      "uuid": "route-002",
      "method": "GET",
      "endpoint": "products/:id",
      "documentation": "获取单个商品详情",
      "responses": [
        {
          "uuid": "resp-002",
          "statusCode": 200,
          "body": "{\n  \"id\": \"{{urlParam 'id'}}\",\n  \"name\": \"{{faker 'commerce.productName'}}\",\n  \"description\": \"{{faker 'commerce.productDescription'}}\",\n  \"price\": {{faker 'commerce.price' 50 5000}},\n  \"images\": [\n    \"{{faker 'image.url'}}\",\n    \"{{faker 'image.url'}}\"\n  ],\n  \"rating\": {{faker 'number.float' { \"min\": 1, \"max\": 5, \"precision\": 0.1 } }}\n}"
        }
      ]
    },
    {
      "uuid": "route-003",
      "method": "POST",
      "endpoint": "orders",
      "documentation": "创建订单",
      "responses": [
        {
          "uuid": "resp-003",
          "statusCode": 201,
          "body": "{\n  \"id\": \"ORD-{{faker 'string.alphanumeric' 8}}\",\n  \"status\": \"created\",\n  \"createdAt\": \"{{now}}\",\n  \"items\": \"{{body 'items'}}\"\n}"
        }
      ]
    },
    {
      "uuid": "route-004",
      "method": "GET",
      "endpoint": "orders",
      "documentation": "获取当前用户的订单列表",
      "responses": [
        {
          "uuid": "resp-004",
          "statusCode": 200,
          "body": "{\n  \"data\": [\n    {\n      \"id\": \"ORD-{{faker 'string.alphanumeric' 8}}\",\n      \"status\": \"{{faker 'random.arrayElement' ['created', 'paid', 'shipped', 'delivered']}}\",\n      \"totalAmount\": {{faker 'commerce.price' 50 2000}},\n      \"createdAt\": \"{{faker 'date.past' 1}}\"\n    }\n  ]\n}"
        }
      ]
    }
  ]
}
```

注意 Mockoon 支持 `{{faker}}` 模板语法——每次请求返回不同的随机数据。这在以下场景中特别有用：测试前端列表渲染时是否有空数据、大金额数据、长文本等边界情况的 UI 表现；产品经理查看原型时看到的不是千篇一律的"测试数据"，而是接近真实业务的数据形态。

### 3.3 带条件逻辑的高级响应

Mockoon 支持基于请求内容的条件路由，根据不同的请求参数返回不同的响应体：

```json
{
  "endpoint": "products",
  "method": "GET",
  "responses": [
    {
      "statusCode": 200,
      "label": "电子分类",
      "rules": [
        {
          "target": "query",
          "modifier": "category",
          "value": "electronics",
          "body": "{\"data\": [{\"id\": 1, \"name\": \"MacBook Pro\", \"category\": \"electronics\", \"price\": 14999}]}"
        }
      ],
      "defaultResponse": false
    },
    {
      "statusCode": 200,
      "label": "服装分类",
      "rules": [
        {
          "target": "query",
          "modifier": "category",
          "value": "clothing",
          "body": "{\"data\": [{\"id\": 2, \"name\": \"优衣库 T 恤\", \"category\": \"clothing\", \"price\": 99}]}"
        }
      ],
      "defaultResponse": false
    },
    {
      "statusCode": 200,
      "label": "默认-全品类",
      "defaultResponse": true,
      "body": "{\"data\": [{\"id\": 3, \"name\": \"通用商品\", \"category\": \"general\", \"price\": 199}]}"
    }
  ]
}
```

### 3.4 CLI 启动与 Docker 部署

```bash
# 安装 Mockoon CLI
brew install mockoon/tap/mockoon-cli

# 使用 CLI 启动 Mock 服务（适合本地开发）
mockoon-cli start \
  --data ./mocks/mockoon/mock-api.json \
  --port 3001 \
  --hostname 0.0.0.0

# 使用 Docker 部署（推荐用于 CI/CD 和团队共享环境）
docker run -d --name mockoon \
  -p 3001:3001 \
  -v $(pwd)/mocks/mockoon/mock-api.json:/data/mock-api.json \
  mockoon/cli:latest \
  --data /data/mock-api.json \
  --port 3001

# 验证 Mock 服务是否启动成功
curl http://localhost:3001/api/products | jq '.data[0].name'
```

### 3.5 Laravel 后端集成：环境变量切换 Mock 源

在后端项目中，通过环境变量控制是连接真实服务还是 Mock 服务：

```php
// config/services.php
return [
    'ecommerce' => [
        'mock_enabled' => env('ECOMMERCE_MOCK_ENABLED', false),
        'mock_url' => env('ECOMMERCE_MOCK_URL', 'http://localhost:3001/api'),
        'real_url' => env('ECOMMERCE_REAL_URL', 'https://api.ecommerce.example.com'),
        'timeout' => env('ECOMMERCE_TIMEOUT', 5000),
        'retry_count' => env('ECOMMERCE_RETRY_COUNT', 3),
    ],
];
```

```php
// app/Services/EcommerceService.php
namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class EcommerceService
{
    private string $baseUrl;
    private bool $mockEnabled;
    private int $timeout;
    private int $retryCount;

    public function __construct()
    {
        $this->mockEnabled = config('services.ecommerce.mock_enabled');
        $this->baseUrl = $this->mockEnabled
            ? config('services.ecommerce.mock_url')
            : config('services.ecommerce.real_url');
        $this->timeout = config('services.ecommerce.timeout');
        $this->retryCount = config('services.ecommerce.retry_count');

        if ($this->mockEnabled) {
            Log::info('[EcommerceService] 使用 Mock 源: ' . $this->baseUrl);
        }
    }

    public function getProducts(string $category = '', int $page = 1): array
    {
        $response = Http::timeout($this->timeout)
            ->retry($this->retryCount, 1000)
            ->get("{$this->baseUrl}/products", array_filter([
                'category' => $category,
                'page' => $page,
                'page_size' => 20,
            ]));

        if (!$response->successful()) {
            throw new \RuntimeException(
                "商品服务请求失败: HTTP {$response->status()}"
            );
        }

        return $response->json();
    }

    public function createOrder(array $items): array
    {
        $response = Http::timeout($this->timeout)
            ->post("{$this->baseUrl}/orders", [
                'items' => $items,
                'created_at' => now()->toIso8601String(),
            ]);

        if ($response->status() === 422) {
            throw new ValidationException($response->json('errors'));
        }

        return $response->json();
    }
}
```

```bash
# .env.local（本地开发环境——使用 Mockoon）
ECOMMERCE_MOCK_ENABLED=true
ECOMMERCE_MOCK_URL=http://localhost:3001/api

# .env.staging（预发布环境——使用真实服务）
ECOMMERCE_MOCK_ENABLED=false
ECOMMERCE_REAL_URL=https://api-staging.ecommerce.example.com

# .env.production（生产环境——使用真实服务，禁止 Mock）
ECOMMERCE_MOCK_ENABLED=false
ECOMMERCE_REAL_URL=https://api.ecommerce.example.com
```

---

## 四、第三层：WireMock——集成测试的重型武器

### 4.1 WireMock 的核心能力

WireMock 是基于 Java 的 HTTP 模拟服务器，功能远超简单的请求-响应映射。它是三层 Mock 体系中功能最强大的一层，专为自动化测试设计，提供以下核心能力：

**精确请求匹配**：支持 URL 路径正则匹配、查询参数条件匹配、请求 Header 验证、JSON Body 中的 JSONPath/XPath 表达式匹配。可以精确到请求体中某个嵌套字段的值。

**状态机（Scenarios）**：通过定义状态名称和状态转换，模拟有状态的业务流程。例如订单从"已创建"到"已支付"到"已发货"的完整流转，每次请求后状态自动推进。

**录制回放（Record & Playback）**：配置 WireMock 代理到真实 API，录制真实交互并保存为 Stub 文件。后续测试直接回放录制结果，不再依赖真实服务。

**故障注入**：模拟各种异常场景——网络超时、连接重置、部分响应、带宽限制等。这些在真实环境中偶发的异常，可以通过 WireMock 在测试中可靠地复现。

**动态响应模板**：基于 Handlebars 模板引擎，可以在响应中引用请求参数、生成随机数、操作日期时间等。

### 4.2 快速启动

```bash
# Docker 启动（推荐，无需安装 Java 环境）
docker run -d --name wiremock \
  -p 8080:8080 \
  -v $(pwd)/wiremock-stubs:/home/wiremock \
  wiremock/wiremock:3.5.0 \
  --verbose \
  --global-response-templating

# 验证 WireMock 健康状态
curl http://localhost:8080/__admin/health

# 查看当前加载的所有 Stub Mapping
curl http://localhost:8080/__admin/mappings | jq '.mappings | length'
```

目录结构约定：

```
wiremock-stubs/
├── mappings/               # Stub Mapping JSON 文件
│   ├── user-api.json
│   ├── order-api.json
│   └── scenarios/
│       └── order-lifecycle.json
├── __files/                # 静态文件（响应体文件等）
│   ├── responses/
│   │   ├── user-list.json
│   │   └── error-500.json
│   └── recordings/         # 录制回放数据
└── global-templating-helpers/  # 自定义 Handlebars Helper
```

### 4.3 Stub Mapping 实战示例

#### 4.3.1 多维度请求匹配

```json
{
  "mappings": [
    {
      "name": "user-api-v2-list",
      "request": {
        "method": "GET",
        "urlPathPattern": "/api/v[12]/users",
        "queryParameters": {
          "page": { "matches": "\\d+" },
          "page_size": { "matches": "\\d+", "optional": true },
          "role": { "optional": true },
          "keyword": { "optional": true }
        },
        "headers": {
          "Authorization": { "matches": "Bearer .+" },
          "Accept": { "contains": "application/json" },
          "X-Client-Version": { "matches": "\\d+\\.\\d+\\.\\d+" }
        }
      },
      "response": {
        "status": 200,
        "headers": {
          "Content-Type": "application/json; charset=utf-8",
          "X-Request-Id": "{{randomValue type='UUID'}}",
          "X-RateLimit-Remaining": "{{randomValue type='NUMERIC' length=3}}"
        },
        "jsonBody": {
          "data": [
            {
              "id": 1,
              "name": "张三",
              "email": "zhangsan@example.com",
              "role": "admin",
              "createdAt": "2025-01-15T08:30:00Z"
            },
            {
              "id": 2,
              "name": "李四",
              "email": "lisi@example.com",
              "role": "editor",
              "createdAt": "2025-03-22T14:10:00Z"
            }
          ],
          "meta": {
            "current_page": "{{request.query.page}}",
            "per_page": 20,
            "total": 2,
            "last_page": 1
          }
        }
      }
    }
  ]
}
```

#### 4.3.2 状态机——订单全生命周期模拟

```json
{
  "mappings": [
    {
      "scenarioName": "OrderLifecycle",
      "requiredScenarioState": "Started",
      "newScenarioState": "OrderPlaced",
      "name": "create-order",
      "request": {
        "method": "POST",
        "url": "/api/orders",
        "bodyPatterns": [
          { "matchesJsonPath": "$.items" },
          { "matchesJsonPath": "$.shipping_address" }
        ]
      },
      "response": {
        "status": 201,
        "headers": {
          "Content-Type": "application/json",
          "Location": "/api/orders/ORD-20260606-001"
        },
        "jsonBody": {
          "id": "ORD-20260606-001",
          "status": "placed",
          "totalAmount": 299.99,
          "createdAt": "{{now}}"
        }
      }
    },
    {
      "scenarioName": "OrderLifecycle",
      "requiredScenarioState": "OrderPlaced",
      "newScenarioState": "PaymentConfirmed",
      "name": "confirm-payment",
      "request": {
        "method": "POST",
        "url": "/api/orders/ORD-20260606-001/pay",
        "bodyPatterns": [
          { "matchesJsonPath": "$.payment_method" }
        ]
      },
      "response": {
        "status": 200,
        "jsonBody": {
          "id": "ORD-20260606-001",
          "status": "paid",
          "paidAt": "{{now}}",
          "paymentId": "PAY-{{randomValue type='UUID'}}"
        }
      }
    },
    {
      "scenarioName": "OrderLifecycle",
      "requiredScenarioState": "PaymentConfirmed",
      "newScenarioState": "Shipped",
      "name": "ship-order",
      "request": {
        "method": "POST",
        "url": "/api/orders/ORD-20260606-001/ship"
      },
      "response": {
        "status": 200,
        "jsonBody": {
          "id": "ORD-20260606-001",
          "status": "shipped",
          "trackingNo": "SF{{randomValue length=12 type='NUMERIC'}}",
          "estimatedDelivery": "{{dateShift request.time '+3 days'}}"
        }
      }
    },
    {
      "scenarioName": "OrderLifecycle",
      "requiredScenarioState": "Shipped",
      "newScenarioState": "Delivered",
      "name": "confirm-delivery",
      "request": {
        "method": "POST",
        "url": "/api/orders/ORD-20260606-001/deliver"
      },
      "response": {
        "status": 200,
        "jsonBody": {
          "id": "ORD-20260606-001",
          "status": "delivered",
          "deliveredAt": "{{now}}"
        }
      }
    }
  ]
}
```

#### 4.3.3 故障注入——模拟各种异常场景

```json
{
  "mappings": [
    {
      "name": "payment-timeout-large-amount",
      "priority": 1,
      "request": {
        "method": "POST",
        "urlPathPattern": "/api/payments/.*",
        "bodyPatterns": [
          { "matchesJsonPath": "$[?(@.amount > 50000)]" }
        ]
      },
      "response": {
        "status": 200,
        "fixedDelayMilliseconds": 30000,
        "body": "payment gateway timeout"
      }
    },
    {
      "name": "payment-service-error",
      "priority": 2,
      "request": {
        "method": "POST",
        "urlPathPattern": "/api/payments/.*",
        "bodyPatterns": [
          { "matchesJsonPath": "$[?(@.payment_method == 'unavailable_card')]" }
        ]
      },
      "response": {
        "status": 503,
        "headers": {
          "Retry-After": "5",
          "Content-Type": "application/json"
        },
        "jsonBody": {
          "error": "SERVICE_UNAVAILABLE",
          "message": "支付网关暂时不可用，请稍后重试"
        }
      }
    },
    {
      "name": "payment-partial-response",
      "priority": 3,
      "request": {
        "method": "POST",
        "urlPathPattern": "/api/payments/.*",
        "bodyPatterns": [
          { "matchesJsonPath": "$[?(@.simulate == 'partial')]" }
        ]
      },
      "response": {
        "status": 200,
        "headers": {
          "Content-Type": "application/json"
        },
        "body": "{\"transactionId\": \"TXN-001\", \"statu",
        "fault": "RANDOM_DATA_THEN_CLOSE"
      }
    },
    {
      "name": "payment-normal",
      "priority": 10,
      "request": {
        "method": "POST",
        "urlPathPattern": "/api/payments/.*"
      },
      "response": {
        "status": 200,
        "jsonBody": {
          "transactionId": "TXN-{{randomValue type='UUID'}}",
          "status": "success",
          "processedAt": "{{now}}"
        }
      }
    }
  ]
}
```

### 4.4 录制回放模式

录制回放是 WireMock 最强大的功能之一——它能录制与真实 API 的所有交互并保存为 Stub 文件，后续测试直接使用录制结果：

```bash
# 开始录制——WireMock 将作为代理转发请求到真实服务
curl -X POST http://localhost:8080/__admin/recordings/start \
  -H "Content-Type: application/json" \
  -d '{
    "targetBaseUrl": "https://api.real-service.com",
    "captureHeaders": {
      "Accept": {},
      "Content-Type": {}
    },
    "extractBodyCriteria": {
      "textSizeThreshold": "100kb"
    },
    "persist": true,
    "repeatsAsScenarios": false
  }'

# 此时通过 WireMock 发送请求，会被转发到真实服务
# WireMock 同时记录请求和响应
curl http://localhost:8080/api/users?page=1
curl http://localhost:8080/api/products?category=electronics
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"items": [{"product_id": 1, "quantity": 2}]}'

# 停止录制——所有交互已保存为 Stub Mapping
curl -X POST http://localhost:8080/__admin/recordings/stop

# 录制结果自动保存到 wiremock-stubs/mappings/ 目录
ls wiremock-stubs/mappings/
```

### 4.5 JUnit 集成测试（Java 项目）

```java
import static com.github.tomakefoundation.wiremock.client.WireMock.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.RegisterExtension;
import com.github.tomakefoundation.wiremock.junit5.WireMockExtension;
import static org.assertj.core.api.Assertions.*;

class OrderServiceIntegrationTest {

    @RegisterExtension
    static WireMockExtension wireMock = WireMockExtension.newInstance()
        .options(wireMockConfig()
            .port(8089)
            .usingFilesUnderDirectory("wiremock-stubs")
            .globalTemplating()
        )
        .build();

    @BeforeEach
    void resetStubs() {
        wireMock.resetAll();
    }

    @Test
    @DisplayName("正常下单——支付服务可用时应创建成功")
    void shouldPlaceOrderSuccessfully() {
        // Given: 外部支付服务正常响应
        wireMock.stubFor(post(urlEqualTo("/api/payments"))
            .withHeader("Content-Type", containing("application/json"))
            .withRequestBody(matchingJsonPath("$.amount"))
            .willReturn(ok()
                .withHeader("Content-Type", "application/json")
                .withBodyFile("responses/payment-success.json")
            )
        );

        OrderService orderService = new OrderService("http://localhost:8089");

        // When
        Order result = orderService.placeOrder("user-001", "product-001", 99.99);

        // Then
        assertThat(result.getStatus()).isEqualTo("placed");
        assertThat(result.getId()).startsWith("ORD-");

        // Verify: 确认模拟服务器收到了正确的请求
        wireMock.verifyThat(1,
            postRequestedFor(urlEqualTo("/api/payments"))
                .withRequestBody(matchingJsonPath("$.amount", equalTo("99.99")))
                .withRequestBody(matchingJsonPath("$.user_id", equalTo("user-001")))
                .withHeader("Authorization", containing("Bearer"))
        );
    }

    @Test
    @DisplayName("支付服务超时——应触发降级逻辑")
    void shouldHandlePaymentServiceTimeout() {
        // Given: 支付服务超时（30秒无响应）
        wireMock.stubFor(post(urlEqualTo("/api/payments"))
            .willReturn(ok()
                .withFixedDelay(30000)
                .withBody("timeout")
            )
        );

        OrderService orderService = new OrderService(
            "http://localhost:8089",
            Duration.ofSeconds(5) // 5秒超时
        );

        // Then: 应抛出超时异常并进入降级流程
        PaymentTimeoutException ex = assertThrows(
            PaymentTimeoutException.class,
            () -> orderService.placeOrder("user-001", "product-001", 99.99)
        );

        assertThat(ex.getMessage()).contains("支付服务请求超时");
        assertThat(ex.getFallbackAction()).isEqualTo("RETRY_QUEUE");
    }

    @Test
    @DisplayName("支付服务 503——应触发重试机制")
    void shouldRetryOnPaymentServiceError() {
        // Given: 前两次返回 503，第三次成功
        wireMock.stubFor(post(urlEqualTo("/api/payments"))
            .inScenario("PaymentRetry")
            .whenScenarioStateIs("Started")
            .willReturn(serviceUnavailable())
            .willSetStateTo("FirstRetry")
        );

        wireMock.stubFor(post(urlEqualTo("/api/payments"))
            .inScenario("PaymentRetry")
            .whenScenarioStateIs("FirstRetry")
            .willReturn(serviceUnavailable())
            .willSetStateTo("SecondRetry")
        );

        wireMock.stubFor(post(urlEqualTo("/api/payments"))
            .inScenario("PaymentRetry")
            .whenScenarioStateIs("SecondRetry")
            .willReturn(ok()
                .withHeader("Content-Type", "application/json")
                .withBody("{\"transactionId\": \"TXN-RETRY-001\", \"status\": \"success\"}")
            )
        );

        OrderService orderService = new OrderService(
            "http://localhost:8089",
            Duration.ofSeconds(5),
            3 // 最多重试 3 次
        );

        // When: 应在第三次重试时成功
        Order result = orderService.placeOrder("user-001", "product-001", 99.99);
        assertThat(result.getStatus()).isEqualTo("placed");

        // Verify: 确认实际发送了 3 次请求
        wireMock.verifyThat(3, postRequestedFor(urlEqualTo("/api/payments")));
    }
}
```

---

## 五、环境分级与接口隔离策略

三层 Mock 体系的核心在于**按环境严格隔离**，确保不同阶段使用正确的 Mock 层次，绝不混淆：

```yaml
# 完整的环境分级策略
development:
  前端本地开发:
    工具: MSW
    原因: 零配置切换，前端完全独立，不依赖任何后端服务
    触发条件: .env.development → VITE_MOCK=true
    数据策略: 使用静态 fixture 数据 + faker 动态生成

  前后端联调:
    工具: Mockoon
    原因: 共享 Mock 端点，支持模板动态响应，团队统一数据源
    触发条件: docker-compose.yml 中启动 Mockoon 容器
    数据策略: 模拟真实业务数据，支持条件路由

  后端独立开发:
    工具: Mockoon
    原因: 后端依赖的上游服务使用 Mockoon 模拟
    触发条件: .env → UPSTREAM_MOCK_ENABLED=true

testing:
  前端组件测试:
    工具: MSW (Node 模式)
    原因: 与 Vitest/Jest 深度集成，每个测试文件独立控制响应
    触发条件: vitest.setup.ts → setupServer()
    数据策略: 每个测试用例独立配置 Mock 响应

  后端集成测试:
    工具: WireMock
    原因: 精确匹配、状态机、故障注入能力无可替代
    触发条件: JUnit Extension / Docker Compose
    数据策略: Stub Mapping + 录制回放数据

  端到端测试:
    工具: WireMock (Docker)
    原因: 独立进程模拟外部依赖，与被测服务完全隔离
    触发条件: CI Pipeline 中的 Docker Compose

  契约测试:
    工具: WireMock + Pact
    原因: 验证 Mock 行为与真实 API 的契约一致性
    触发条件: CI Pipeline 自动运行

staging:
  预发布验证:
    工具: 真实服务 (降级 WireMock)
    原因: 优先真实服务验证，仅在真实服务不可用时降级
    触发条件: Feature Flag 控制降级逻辑

production:
  策略: 绝对禁止任何 Mock
  保障: CI 卡点检测 + 编译时排除 + 环境变量强制关闭
```

Vue/TypeScript 项目中的环境切换实现：

```typescript
// src/plugins/mock.ts
type MockLevel = 'none' | 'msw' | 'external'

/**
 * 根据环境变量初始化 Mock 策略
 * - none: 不使用 Mock，直接请求真实 API
 * - msw: 使用 MSW 拦截浏览器请求（前端本地开发）
 * - external: 使用 Mockoon/WireMock 等外部 Mock 服务（联调/测试）
 */
export async function initMock(): Promise<void> {
  const level = (import.meta.env.VITE_MOCK_LEVEL as MockLevel) || 'none'

  switch (level) {
    case 'msw': {
      const { worker } = await import('../mocks/browser')
      await worker.start({
        onUnhandledRequest: 'bypass',
        serviceWorker: { url: '/mockServiceWorker.js' },
      })
      console.log('[Mock] MSW 已启用 — 浏览器端请求拦截模式')
      break
    }

    case 'external': {
      // 外部 Mock 服务模式——请求通过 Vite proxy 转发到 Mockoon/WireMock
      const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
      console.log(`[Mock] 外部 Mock 服务模式 — 目标: ${baseUrl}`)
      break
    }

    case 'none':
    default:
      console.log('[Mock] Mock 已禁用 — 使用真实 API')
      break
  }
}
```

```typescript
// vite.config.ts —— 根据 Mock 模式配置代理
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const mockLevel = env.VITE_MOCK_LEVEL || 'none'

  return {
    plugins: [vue()],
    server: {
      proxy: mockLevel === 'external'
        ? {
            '/api': {
              target: env.VITE_API_BASE_URL || 'http://localhost:3001',
              changeOrigin: true,
              // 如果目标是 WireMock，可能需要调整路径
              rewrite: env.VITE_MOCK_TOOL === 'wiremock'
                ? (path) => path.replace(/^\/api/, '/api')
                : undefined,
            },
          }
        : undefined,
    },
  }
})
```

---

## 六、契约测试——三层 Mock 的粘合剂

Mock 最大的风险是**与真实接口脱节**——后端改了字段名，前端的 MSW handler 没更新，测试全绿但上线就报错。这种"虚假的安全感"比没有测试更危险。契约测试（Contract Testing）是解决这个问题的关键机制——它让前端（消费者）和后端（提供者）各自独立验证自己对 API 契约的理解。

### 6.1 Pact 消费者端测试

```typescript
// tests/contract/user.consumer.pact.test.ts
import { PactV4 } from '@pact-foundation/pact'
import { fetchUsers, fetchUserById } from '@/services/userService'

const provider = new PactV4({
  consumer: 'VueFrontend',
  provider: 'UserAPI',
  dir: './pacts',
  logLevel: 'warn',
})

describe('用户 API 契约', () => {
  it('GET /api/users 应返回带分页信息的用户列表', async () => {
    await provider
      .addInteraction()
      .given('用户列表存在')
      .uponReceiving('获取用户列表请求')
      .withRequest('GET', '/api/users', (builder) => {
        builder
          .headers({ Accept: 'application/json' })
          .query({ page: '1', page_size: '20' })
      })
      .willRespondWith(200, (builder) => {
        builder
          .headers({ 'Content-Type': 'application/json' })
          .jsonBody({
            data: [
              {
                id: 1,
                name: '张三',
                email: 'zhangsan@example.com',
                role: 'admin',
              },
            ],
            meta: {
              current_page: 1,
              per_page: 20,
              total: 1,
              last_page: 1,
            },
          })
      })
      .executeTest(async (mockServer) => {
        const result = await fetchUsers({ baseUrl: mockServer.url })

        expect(result.data).toHaveLength(1)
        expect(result.data[0].name).toBe('张三')
        expect(result.meta.total).toBe(1)
      })
  })

  it('GET /api/users/:id 用户不存在时应返回 404', async () => {
    await provider
      .addInteraction()
      .given('用户不存在')
      .uponReceiving('请求不存在的用户')
      .withRequest('GET', '/api/users/999')
      .willRespondWith(404, (builder) => {
        builder.jsonBody({
          message: '用户不存在',
          code: 'USER_NOT_FOUND',
        })
      })
      .executeTest(async (mockServer) => {
        await expect(
          fetchUserById(999, { baseUrl: mockServer.url })
        ).rejects.toThrow('用户不存在')
      })
  })
})
```

### 6.2 Pact 提供者端验证（Laravel）

```php
// tests/Contract/UserApiPactVerificationTest.php
namespace Tests\Contract;

use Tests\TestCase;
use PhpPact\Standalone\Verifier\Verifier;
use PhpPact\Standalone\Verifier\Model\VerifierConfig;

class UserApiPactVerificationTest extends TestCase
{
    public function testVerifyConsumerPacts(): void
    {
        $config = new VerifierConfig();
        $config
            ->setProviderName('UserAPI')
            ->setProviderBaseUrl('http://localhost:8000')
            ->setProviderStatesSetupUrl('http://localhost:8000/_pact/provider-states')
            ->addPactUrl(storage_path('pacts/vuefrontend-userapi.json'))
            ->setPublishResults(false);

        $verifier = new Verifier($config);
        $result = $verifier->verify();

        $this->assertTrue($result, 'Pact 契约验证失败——请检查 API 是否与消费者预期一致');
    }
}
```

```php
// routes/web.php —— Provider State 端点，用于设置测试数据
Route::post('/_pact/provider-states', function (Request $request) {
    $state = $request->input('state');
    $params = $request->input('params', []);

    match ($state) {
        '用户列表存在' => function () {
            User::factory()->create([
                'name' => '张三',
                'email' => 'zhangsan@example.com',
                'role' => 'admin',
            ]);
        },
        '用户不存在' => function () {
            // 确保 ID 999 的用户确实不存在
            User::where('id', 999)->delete();
        },
        default => null,
    }

    return response('', 200);
});
```

### 6.3 契约自动同步与告警

在 CI 中，契约文件上传到 Pact Broker，提供者端自动拉取最新契约进行验证：

```yaml
# CI 中的契约同步配置
- name: 发布契约到 Pact Broker
  run: |
    npx @pact-foundation/pact-node publish ./pacts \
      --consumer-app-version=$(git rev-parse --short HEAD) \
      --broker-base-url=$PACT_BROKER_URL \
      --broker-token=$PACT_BROKER_TOKEN

- name: 提供者端验证（Webhook 触发）
  run: |
    php artisan test --group=contract \
      --env=testing \
      -d pact.broker_url=$PACT_BROKER_URL \
      -d pact.provider_version=$(git rev-parse --short HEAD)
```

---

## 七、CI/CD 流水线集成

### 7.1 完整的 GitHub Actions Pipeline

```yaml
# .github/workflows/api-mock-pipeline.yml
name: API Mock Quality Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'
  JAVA_VERSION: '21'

jobs:
  # ---- 1. Mock 配置验证 ----
  mock-config-validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}' }

      - name: 验证 MSW handlers TypeScript 类型
        run: |
          npm ci
          npx tsc --noEmit src/mocks/**/*.ts

      - name: 验证 Mockoon 配置 JSON 合法性
        run: |
          python3 -m json.tool mocks/mockoon/mock-api.json > /dev/null
          echo "✅ Mockoon 配置合法"

      - name: 验证 WireMock Stub 语法
        run: |
          docker run --rm \
            -v $(pwd)/wiremock-stubs:/home/wiremock \
            wiremock/wiremock:3.5.0 \
            --validate

  # ---- 2. 前端测试（MSW Node 模式） ----
  frontend-unit-tests:
    runs-on: ubuntu-latest
    needs: mock-config-validation
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}' }

      - run: npm ci
      - run: npx vitest run --reporter=verbose
        env:
          VITE_MOCK_LEVEL: msw

  # ---- 3. 后端集成测试（WireMock Docker） ----
  backend-integration-tests:
    runs-on: ubuntu-latest
    needs: mock-config-validation
    services:
      wiremock:
        image: wiremock/wiremock:3.5.0
        ports:
          - 8080:8080
        volumes:
          - ${{ github.workspace }}/wiremock-stubs:/home/wiremock
        options: >-
          --verbose
          --global-response-templating
    steps:
      - uses: actions/checkout@v4

      - name: 等待 WireMock 就绪
        run: |
          for i in $(seq 1 30); do
            if curl -sf http://localhost:8080/__admin/health; then
              echo "✅ WireMock 已就绪"
              exit 0
            fi
            echo "等待 WireMock 启动... ($i/30)"
            sleep 1
          done
          echo "❌ WireMock 启动超时"
          exit 1

      - name: 运行集成测试
        run: php artisan test --group=integration
        env:
          EXTERNAL_API_URL: http://localhost:8080

  # ---- 4. 契约测试 ----
  contract-tests:
    runs-on: ubuntu-latest
    needs: [frontend-unit-tests, backend-integration-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}' }

      # 消费者端：生成契约文件
      - name: 生成 Pact 契约文件
        run: |
          npm ci
          npx jest tests/contract/ --testPathPattern='consumer' --verbose

      # 上传契约文件作为构建产物
      - uses: actions/upload-artifact@v4
        with:
          name: pact-contracts
          path: ./pacts/*.json
          retention-days: 30

      # 提供者端：验证契约
      - name: 提供者端契约验证
        run: |
          php artisan test --group=contract

  # ---- 5. Mock 泄露检测 ----
  mock-leak-detection:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: 检查生产代码中是否有 Mock 引用
        run: |
          set -e
          echo "🔍 扫描生产代码中的 Mock 引用..."

          LEAK=$(grep -rn \
            "setupWorker\|setupServer\|msw\|mockoon\|wiremock\|mockServiceWorker" \
            src/ app/ \
            --include="*.ts" --include="*.tsx" --include="*.vue" \
            --include="*.php" --include="*.js" --include="*.jsx" \
            | grep -v "mocks/" \
            | grep -v "tests/" \
            | grep -v "test/" \
            | grep -v "__tests__/" \
            | grep -v "\.test\." \
            | grep -v "\.spec\." \
            | grep -v "__mocks__/" \
            | grep -v "vitest\.setup\." \
            | grep -v "jest\.setup\." \
            || true)

          if [ -n "$LEAK" ]; then
            echo "❌ 发现生产代码中存在 Mock 引用："
            echo "$LEAK"
            exit 1
          fi
          echo "✅ 生产代码无 Mock 泄露"

      - name: 检查环境变量中 Mock 是否正确关闭
        run: |
          set -e
          echo "🔍 检查生产环境配置..."

          if [ -f .env.production ]; then
            if grep -qE "MOCK=true|MOCK_ENABLED=true|MOCK_LEVEL=(msw|full)" .env.production; then
              echo "❌ 生产环境 .env.production 中 Mock 未关闭！"
              exit 1
            fi
          fi
          echo "✅ 生产环境 Mock 已正确关闭"
```

### 7.2 Docker Compose 本地联调

```yaml
# docker-compose.mock.yml —— 本地联调环境一键启动
version: '3.8'

services:
  mockoon:
    image: mockoon/cli:latest
    ports:
      - "3001:3001"
    volumes:
      - ./mocks/mockoon/mock-api.json:/data/mock-api.json
    command: --data /data/mock-api.json --port 3001

  wiremock:
    image: wiremock/wiremock:3.5.0
    ports:
      - "8080:8080"
    volumes:
      - ./wiremock-stubs:/home/wiremock
    command: --verbose --global-response-templating
```

```bash
# 启动联调环境
docker compose -f docker-compose.mock.yml up -d

# 验证所有 Mock 服务就绪
curl http://localhost:3001/api/products | jq '.data[0].name'
curl http://localhost:8080/__admin/health
```

---

## 八、实战踩坑与最佳实践

### 8.1 坑一：MSW Service Worker 缓存残留

浏览器对 Service Worker 有强缓存机制，关闭 Mock 后可能仍返回旧的缓存数据，甚至在切换到生产环境后仍然残留。

**解决方案**：在开发工具中增加一键清理按钮，并在应用启动时自动检测：

```typescript
// src/utils/clearMockSw.ts
export async function clearMockServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false

  const registrations = await navigator.serviceWorker.getRegistrations()
  let cleared = false

  for (const reg of registrations) {
    // 只清理 MSW 的 Service Worker，不影响 PWA 等其他 SW
    if (reg.active?.scriptURL.includes('mockServiceWorker')) {
      await reg.unregister()
      console.log('[MSW] 已清理残留的 Mock Service Worker')
      cleared = true
    }
  }

  if (cleared) {
    // 同时清理相关的 Cache Storage
    const cacheNames = await caches.keys()
    for (const name of cacheNames) {
      if (name.includes('msw') || name.includes('mock')) {
        await caches.delete(name)
        console.log(`[MSW] 已清理缓存: ${name}`)
      }
    }
  }

  return cleared
}
```

### 8.2 坑二：WireMock JSON 数字精度丢失

JavaScript 的 `Number.MAX_SAFE_INTEGER` 为 2^53-1（约 9 千万亿），而 Java 的 Long 最大值为 2^63-1。当后端返回的 ID 超过 JavaScript 安全范围时，WireMock 在模板渲染和 JSON 序列化时可能出现精度丢失。

**解决方案**：在数据模型层面统一使用字符串类型的 ID，或在 WireMock 中配置 Jackson 序列化选项。前后端团队在接口规范中约定：所有超过 2^32 的整型 ID 都以字符串形式传输。

### 8.3 坑三：Mock 数据维护成本

手动维护 Mock 数据是最大的痛点——接口越多，Mock 文件越难维护，最后往往变成一堆过时的"僵尸数据"。

**解决方案**：从 OpenAPI 规范自动生成 Mock：

```bash
# 方案一：使用 Prism 从 OpenAPI 规范生成 Mock 服务
npm install -g @stoplight/prism-cli
prism mock ./api-specs/openapi.yaml -p 4010

# 方案二：使用 openapi-msw 从 OpenAPI 生成 MSW handler
npm install -g @openapi-tools/openapi-msw
openapi-msw generate \
  --input ./api-specs/openapi.yaml \
  --output src/mocks/handlers.ts \
  --format esm

# 方案三：使用 Swagger Codegen 生成 WireMock Stub
docker run --rm \
  -v $(pwd):/local \
  swaggerapi/swagger-codegen-cli generate \
  -i /local/api-specs/openapi.yaml \
  -l dynamic-html \
  -o /local/wiremock-generated
```

### 8.4 坑四：多人协作数据不一致

不同开发者维护各自的 Mock 数据，导致"在我这里能跑"的问题频繁发生。

**解决方案**：将 Mock 配置纳入版本控制，建立清晰的目录规范：

```
project/
├── mocks/
│   ├── msw/
│   │   ├── handlers.ts        # 统一的请求处理器（所有人共用）
│   │   ├── browser.ts         # 浏览器端 worker 实例
│   │   ├── server.ts          # Node.js 端 server 实例
│   │   └── fixtures/          # 静态 Mock 数据文件
│   │       ├── users.json     # 用户相关数据
│   │       ├── orders.json    # 订单相关数据
│   │       └── products.json  # 商品相关数据
│   ├── mockoon/
│   │   ├── mock-api.json      # Mockoon 完整配置
│   │   └── environments/      # 不同环境的配置变体
│   │       ├── dev.json
│   │       └── staging.json
│   └── wiremock/
│       └── mappings/          # WireMock Stub Mapping 文件
│           ├── user-api.json
│           ├── order-api.json
│           ├── payment-api.json
│           └── scenarios/     # 状态机场景定义
│               └── order-lifecycle.json
├── pacts/                     # Pact 契约测试文件（CI 自动生成）
│   ├── vuefrontend-userapi.json
│   └── vuefrontend-orderapi.json
└── api-specs/                 # OpenAPI 规范文件
    ├── openapi.yaml
    └── changelog.md
```

### 8.5 坑五：Mock 泄露到生产环境

这是最严重的风险——如果 MSW 的 Service Worker 在生产环境被加载，或者后端代码中残留了 Mock 服务的 URL，后果不堪设想。

**多层防护策略**：

```typescript
// 第一层：编译时排除（vite.config.ts）
export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      // 生产构建时将整个 mocks 目录标记为外部依赖
      // 打包器会完全跳过这些模块
      external: mode === 'production'
        ? [/\/mocks\//]
        : [],
    },
  },
  define: {
    // 编译时常量——生产环境编译器会将 Mock 分支完全消除（tree-shaking）
    __MOCK_ENABLED__: JSON.stringify(mode !== 'production'),
  },
}))
```

```bash
# 第二层：CI 静态检查（在 Pipeline 中运行）
grep -rn "setupWorker\|setupServer\|mockServiceWorker" \
  src/ app/ \
  --include="*.ts" --include="*.vue" --include="*.php" \
  | grep -v "mocks/" | grep -v "tests/" \
  && echo "❌ Mock 泄露" && exit 1 \
  || echo "✅ 安全"
```

```bash
# 第三层：生产构建产物检查
if find dist/ -name "mockServiceWorker*" | grep -q .; then
  echo "❌ 生产构建产物中存在 Mock Service Worker 文件！"
  exit 1
fi
```

---

## 九、进阶策略：动态 Mock 与智能降级

### 9.1 基于健康检查的自动降级

当真实 API 不可用时，自动切换到 Mock 响应，保证前端体验不中断：

```typescript
// src/services/apiClient.ts
import axios, { AxiosError, AxiosInstance } from 'axios'

interface MockConfig {
  enabled: boolean
  fallbackToMock: boolean
  healthCheckUrl: string
  healthCheckInterval: number
}

class ResilientApiClient {
  private client: AxiosInstance
  private mockAvailable: boolean = false
  private realServiceHealthy: boolean = true

  constructor(private config: MockConfig) {
    this.client = axios.create({
      baseURL: config.enabled ? '/mock-api' : '/api',
      timeout: 10000,
    })

    if (config.fallbackToMock) {
      this.startHealthCheck()
      this.setupFallbackInterceptor()
    }
  }

  private startHealthCheck() {
    setInterval(async () => {
      try {
        await axios.get(this.config.healthCheckUrl, { timeout: 3000 })
        this.realServiceHealthy = true
      } catch {
        this.realServiceHealthy = false
        console.warn('[API] 真实服务不可用，准备降级到 Mock')
      }
    }, this.config.healthCheckInterval)
  }

  private setupFallbackInterceptor() {
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (!this.realServiceHealthy && this.mockAvailable) {
          console.warn('[API] 请求失败，尝试从 Mock 获取降级响应')
          // 使用 MSW handler 生成降级响应
          const mockResponse = await this.getMockResponse(error.config)
          if (mockResponse) {
            return { ...error.config, data: mockResponse, status: 200 }
          }
        }
        throw error
      }
    )
  }
}
```

### 9.2 与 Feature Flag 集成

在大型团队中，Mock 开关可以通过 Feature Flag 平台统一管理：

```typescript
// src/App.vue
import { defineComponent, onMounted, watch } from 'vue'
import { useFlags } from 'launchdarkly-vue-client-sdk'

export default defineComponent({
  setup() {
    const { flags } = useFlags()

    onMounted(async () => {
      // Feature Flag 控制是否启用 Mock 模式
      if (flags.value.enableMockMode && import.meta.env.DEV) {
        const { worker } = await import('./mocks/browser')
        await worker.start({ onUnhandledRequest: 'bypass' })
        console.log('[Mock] Feature Flag 触发 Mock 模式')
      }
    })

    // 监听 Flag 变化，支持运行时动态切换
    watch(() => flags.value.enableMockMode, async (enabled) => {
      if (enabled) {
        console.log('[Mock] 运行时启用 Mock 模式')
        // 动态加载 MSW
      } else {
        console.log('[Mock] 运行时关闭 Mock 模式')
        // 清理 Service Worker
      }
    })
  }
})
```

---

## 总结：Mock 不是目的，并行与隔离才是

三层 Mock 体系的核心价值在于**让不同角色在不同阶段都不被接口阻塞**：

1. **MSW（开发层）** 解决前端开发自由——"我想调试 UI，不需要等后端接口完成"
2. **Mockoon（联调层）** 解决团队协作效率——"大家用同一个 Mock 服务对齐数据格式"
3. **WireMock（测试层）** 解决测试质量保障——"自动化测试必须精确可控，还要能模拟故障"

三者配合以下机制，形成完整的闭环：

- **环境变量路由**：不同环境自动切换 Mock 层次，代码零侵入
- **契约测试（Pact）**：确保 Mock 行为与真实 API 始终一致
- **CI/CD 卡点**：自动化验证 Mock 配置合法性，拦截 Mock 泄露到生产环境
- **OpenAPI 同步**：从接口规范自动生成 Mock 数据，降低维护成本

选择正确的工具覆盖正确的层次，才能让 Mock 体系真正为交付提速，而不是成为又一个维护负担。核心原则只有一条：**Mock 是手段，接口隔离与并行开发才是目的。**

---

*本文基于 WireMock 3.5、Mockoon CLI 7.x、MSW 2.x、Pact JS 13.x 版本实践整理。*

## 相关阅读

- [Contract-First API Development 实战：从 OpenAPI/AsyncAPI 规范生成代码——Stoplight Studio + oapi-codegen 的设计优先工作流](/categories/架构/Contract-First-API-Development-实战-从OpenAPI-AsyncAPI规范生成代码-Stoplight-Studio-oapi-codegen的设计优先工作流/) — API 设计优先工作流，OpenAPI 规范是 Mock 数据自动生成与契约测试的基础
- [Data Contract 实战：Pact-style 数据契约——Laravel 微服务间数据格式的版本化、验证与 Breaking Change 检测](/categories/架构/2026-06-05-Data-Contract-Pact-style-Laravel微服务数据契约版本化验证Breaking-Change检测/) — 深入 Pact 契约测试与 Breaking Change 检测，本文第六章的延伸阅读
- [FastAPI 实战：高性能 Python API 框架——Pydantic 校验、依赖注入与 OpenAPI 自动生成](/categories/架构/FastAPI-实战-高性能-Python-API-框架-Pydantic校验-依赖注入与OpenAPI自动生成/) — API 设计与接口规范，可配合 Mock 体系使用
- [gRPC vs Connect 实战：Protobuf 通信的新旧对比——gRPC-Web 替代方案与三端集成](/categories/架构/gRPC-vs-Connect实战-Protobuf通信的新旧对比-gRPC-Web替代方案与三端集成/) — 跨服务通信方案选型，与 Mock 策略互补
