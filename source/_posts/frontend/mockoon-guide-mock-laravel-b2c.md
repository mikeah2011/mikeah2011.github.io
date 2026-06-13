---
title: "Mockoon 实战：本地 Mock 服务器快速搭建与 Laravel B2C 前后端联调踩坑记录"
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
date: 2026-05-17 05:55:11
updated: 2026-05-17 05:58:47
categories:
  - frontend
  - testing
tags: [BFF, Laravel, 测试, Mock, API, 前端]
keywords: [Mockoon, Mock, Laravel B2C, 本地, 服务器快速搭建与, 前后端联调踩坑记录, 前端, 测试]
description: "在 Laravel B2C 电商项目中，后端接口延期导致前端阻塞？本文深度实战 Mockoon 本地 Mock 服务器：从 GUI 安装配置、Handlebars 动态模板、代理转发到 CI/CD 无头模式集成，对比 WireMock/MSW/JSON Server，附 CORS、Cookie、状态管理等 5 大踩坑记录与团队协作最佳实践。"



---

# Mockoon 实战：本地 Mock 服务器快速搭建与 Laravel B2C 前后端联调踩坑记录

## 一、背景：为什么需要本地 Mock 服务器？

在奇乐MAX（qile-max）B2C 电商项目中，我们团队的典型开发流程是：

1. 后端先出 OpenAPI 文档
2. 前端根据文档开发页面
3. 前后端联调

但现实往往是：**后端接口延期**。搜索服务（Java）、推荐服务（Python）、支付回调（第三方）都不在我们掌控范围内。前端拿着 OpenAPI 文档却没接口可调，怎么办？

之前我们试过几种方案：

| 方案 | 优点 | 痛点 |
|------|------|------|
| 前端写死 JSON | 简单 | 不真实，无法模拟错误/分页/延迟 |
| JSON Server | 轻量 | 不支持动态模板、无代理 |
| Mockoon | 本地 GUI、动态模板、代理转发 | 学习曲线（但很低） |
| Apifox Mock | 云端协作 | 依赖网络，离线不可用 |

最终我们选了 **Mockoon** 作为本地开发的默认 Mock 方案，配合 Apifox 做线上协作。今天来一份深度实战。

## 二、Mockoon 核心能力

Mockoon 是一个开源的本地 Mock 服务器工具，核心能力：

- **零代码搭建**：GUI 界面配置 API 端点
- **动态模板**：基于 Handlebars 语法生成随机数据
- **代理转发**：未匹配的请求转发到真实后端
- **录制/回放**：录制真实 API 响应用于离线开发
- **CLI 模式**：集成到 CI/CD 流水线
- **数据桶（Data Buckets）**：共享数据，模拟数据库状态

### 2.1 架构总览

```
┌──────────────────────────────────────────────────┐
│                   前端应用 (Vue 3)                │
│          uni-app / H5 / vue-pure-admin           │
└──────────────────┬───────────────────────────────┘
                   │ API 请求
                   ▼
┌──────────────────────────────────────────────────┐
│              Mockoon 本地服务器                    │
│         http://localhost:3001                     │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ /api/    │  │ /api/    │  │ /api/    │       │
│  │ products │  │ cart     │  │ payment  │       │
│  │ (动态)   │  │ (动态)   │  │ (代理→)  │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│       │              │              │             │
│       ▼              ▼              ▼             │
│  [模板生成]    [模板生成]    [转发到真实API]       │
└──────────────────────────────────────────────────┘
                              │
                              ▼ (代理转发)
                   真实后端 / 第三方API
```

## 三、安装与基础配置

### 3.1 安装 Mockoon

```bash
# macOS（推荐 Homebrew）
brew install mockoon

# 或者 npm 全局安装 CLI 版
npm install -g @mockoon/cli

# 验证安装
mockoon-cli --version
# @mockoon/cli x.x.x
```

> **截图说明**：安装完成后，打开 Mockoon GUI，你会看到一个简洁的深色主题界面。左侧是环境列表面板，中间是路由配置区域，右侧是响应模板编辑器。首次打开时界面为空，需要创建新环境。

### 3.2 GUI 界面导览

Mockoon 的 GUI 界面分为四个主要区域（参考截图描述）：

1. **左侧边栏**：显示所有 Environment（环境）列表，每个 Environment 对应一个独立的 Mock 服务器实例
2. **顶部工具栏**：包含启动/停止服务器、录制模式、导出/导入等操作按钮
3. **中间主区域**：路由（Route）配置面板，可添加 GET/POST/PUT/DELETE 等方法的端点
4. **右侧响应编辑器**：配置响应状态码、Headers、Body（支持 JSON/Text/模板）

> **截图说明**：点击左上角的 "New Environment" 按钮，弹出配置对话框。填写 Environment Name 为 `qile-max-b2c-mock`，Hostname 保持 `localhost`，Port 设置为 `3001`（避免与前端 dev server 的 5173 端口冲突）。

### 3.3 创建第一个 Mock 环境

打开 Mockoon GUI，点击 `File → New Environment`，配置：

- **Environment Name**：`qile-max-b2c-mock`
- **Hostname**：`localhost`
- **Port**：`3001`

> **截图说明**：创建 Environment 后，点击路由列表上方的 "+" 按钮添加新路由。在 Method 下拉框选择 `GET`，Path 输入 `/api/v2/products`。此时右侧面板会自动展开，显示 Response 配置区域。

然后添加第一个路由：

```
GET /api/v2/products
```

Response Body：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "list": [
      {
        "id": 1,
        "name": "测试商品A",
        "price": 99.00,
        "stock": 100
      }
    ],
    "total": 1,
    "page": 1,
    "per_page": 20
  }
}
```

> **截图说明**：配置完成后，点击顶部工具栏的绿色 "播放" 按钮启动 Mock 服务器。状态栏会显示 "Server running on http://localhost:3001"。此时可以在浏览器直接访问 `http://localhost:3001/api/v2/products` 验证是否返回预期 JSON。

启动服务器后，前端直接请求 `http://localhost:3001/api/v2/products` 就能拿到数据。

## 四、动态模板：告别死数据

静态 JSON 最大的问题是：**每次返回一模一样的数据**，前端无法验证分页、空列表、大量数据等场景。

Mockoon 的 Handlebars 模板彻底解决这个问题。

### 4.1 商品列表动态模板

```handlebars
{
  "code": 200,
  "message": "success",
  "data": {
    "list": [
      {{#repeat (queryParam 'per_page' '20')}}
      {
        "id": {{faker 'random.number' min=1000 max=99999}},
        "name": "{{faker 'commerce.productName'}}",
        "price": {{faker 'commerce.price' min=10 max=9999}},
        "stock": {{faker 'random.number' min=0 max=500}},
        "category": "{{faker 'commerce.department'}}",
        "image": "{{faker 'image.url' width=200 height=200}}",
        "created_at": "{{faker 'date.recent' days=30}}",
        "tags": [
          {{#repeat min=1 max=4}}
          "{{faker 'random.word'}}"
          {{/repeat}}
        ]
      }
      {{/repeat}}
    ],
    "total": {{faker 'random.number' min=50 max=500}},
    "page": {{queryParam 'page' '1'}},
    "per_page": {{queryParam 'per_page' '20'}}
  }
}
```

### 4.2 模拟用户登录接口

```handlebars
{
  {{#if (header 'Authorization')}}
  "code": 200,
  "message": "success",
  "data": {
    "user_id": {{faker 'random.number' min=10000 max=99999}},
    "nickname": "{{faker 'person.firstName'}}",
    "email": "{{faker 'internet.email'}}",
    "phone": "{{faker 'phone.number'}}",
    "avatar": "{{faker 'image.avatar'}}",
    "vip_level": {{faker 'random.number' min=0 max=5}},
    "balance": {{faker 'finance.amount' min=0 max=10000 decimals=2}}
  }
  {{else}}
  "code": 401,
  "message": "未登录，请先登录",
  "data": null
  {{/if}}
}
```

这个模板实现了：**有 Authorization header 就返回用户信息，没有就返回 401**。前端可以同时测试已登录和未登录状态。

### 4.3 模拟分页与空列表

在 B2C 电商场景中，分页是最高频的接口之一。Mockoon 模板可以完美模拟：

```handlebars
{
  "code": 200,
  "message": "success",
  "data": {
    {{#if (queryParam 'page')}}
      {{#if (compare (queryParam 'page' '1') '>' '1')}}
      "list": [],
      "total": {{queryParam 'total' '50'}},
      "page": {{queryParam 'page'}},
      "per_page": {{queryParam 'per_page' '20'}},
      "has_more": false
      {{else}}
      "list": [
        {{#repeat (queryParam 'per_page' '20')}}
        {
          "id": {{faker 'random.number' min=1000 max=99999}},
          "name": "{{faker 'commerce.productName'}}",
          "price": {{faker 'commerce.price' min=10 max=9999}},
          "stock": {{faker 'random.number' min=0 max=500}},
          "category": "{{faker 'commerce.department'}}",
          "image": "{{faker 'image.url' width=200 height=200}}"
        }
        {{/repeat}}
      ],
      "total": 50,
      "page": {{queryParam 'page' '1'}},
      "per_page": {{queryParam 'per_page' '20'}},
      "has_more": true
      {{/if}}
    {{else}}
    "list": [],
    "total": 0,
    "page": 1,
    "per_page": 20,
    "has_more": false
    {{/if}}
  }
}
```

这个模板模拟了三种场景：
- 无 `page` 参数 → 返回空列表
- `page=1` → 返回满页数据
- `page>1` → 返回空列表（模拟最后一页）

### 4.4 模拟订单创建（POST 请求体解析）

Mockoon 支持通过 `body` Helper 读取请求体，实现"提交什么就返回什么"的效果：

```handlebars
{
  "code": 200,
  "message": "订单创建成功",
  "data": {
    "order_id": "ORD{{faker 'random.number' min=100000 max=999999}}",
    "items": {{body 'items'}},
    "total_amount": {{body 'total_amount'}},
    "status": "pending_payment",
    "payment_deadline": "{{dateChange (now) '+30' 'minutes'}}",
    "created_at": "{{now}}"
  }
}
```

> 💡 **提示**：`{{body 'field'}}` 可以读取 JSON 请求体中的字段。这在测试下单流程时非常有用——前端传什么商品，Mock 就返回什么订单，避免前后端数据不一致。

### 4.5 使用 Data Buckets 模拟购物车状态

Mockoon 的 Data Buckets 可以在请求之间保持状态，类似一个简易内存数据库：

```javascript
// Data Bucket: cart-items（在 Mockoon GUI 中配置）
[
  {
    "product_id": 1001,
    "name": "测试商品A",
    "price": 99.00,
    "quantity": 2
  }
]
```

购物车接口使用 Data Bucket：

```handlebars
// GET /api/v2/cart
{
  "code": 200,
  "data": {
    "items": {{data 'cart-items'}},
    "total_amount": {{dataRaw 'cart-items' | sum 'price'}},
    "item_count": {{dataRaw 'cart-items' | size}}
  }
}
```

## 五、代理转发：Mock 与真实 API 混合使用

这是 Mockoon 最实用的特性之一。**只有需要 Mock 的接口走本地，其他全部转发到真实后端**。

### 5.1 配置代理

在 Mockoon Environment 设置中：

```
Proxy Host: https://api-staging.qilemax.com
Proxy Mode: Proxy all with no mock
```

Mockoon 提供两种代理模式：

| 代理模式 | 行为 | 适用场景 |
|---------|------|---------|
| **Proxy all with no mock** | 未匹配的路由自动转发到代理目标 | 大部分接口已就绪，只 Mock 少数 |
| **Proxy all** | 所有请求都经过代理目标，Mock 路由优先 | 需要录制真实 API 响应 |

> **截图说明**：在 Environment Settings 面板中，找到 "Proxy" 部分。勾选 "Proxy mode"，填写 Proxy Host 为 `https://api-staging.qilemax.com`。下拉选择 "Proxy all with no mock"。这样配置后，只有你在 Mockoon 中手动添加的路由会返回 Mock 数据，其余请求全部透传到 staging 环境。

### 5.2 实战场景

前端开发商品详情页时：
- `/api/v2/products/:id` → 本地 Mock（搜索服务未就绪）
- `/api/v2/cart/add` → 转发到 staging（购物车服务已就绪）
- `/api/v2/user/profile` → 转发到 staging（用户服务已就绪）

```bash
# 前端 .env.development
VITE_API_BASE_URL=http://localhost:3001/api/v2
```

前端代码零改动，只需切换 `VITE_API_BASE_URL` 即可在 Mock 和真实环境间切换。

### 5.3 高级代理配置：路由级别的条件转发

在某些场景下，你可能需要更精细的控制。例如：`/api/v2/products/:id` 在 `id < 1000` 时转发到真实后端（有真实数据），`id >= 1000` 时走 Mock（测试数据）。

Mockoon 的 **Response Rules** 可以实现这种条件逻辑：

```
Route: GET /api/v2/products/:id

Response 1 (Rule: request.params.id < 1000):
  → Proxy to https://api-staging.qilemax.com/api/v2/products/{{urlParam 'id'}}

Response 2 (Default):
  → Mock response with dynamic template
```

> **截图说明**：在路由的 Response 面板中，点击 "Rules" 标签页。添加规则：`request.params.id` → `is less than` → `1000`。满足条件时选择 "Proxy" 响应类型，不满足时选择 "Template" 响应类型。

### 5.4 录制模式：捕获真实 API 响应

代理转发 + 录制模式的组合非常强大：

1. **开启录制**：在 Environment Settings 中勾选 `Recording` → `Auto record new responses`
2. **配置代理**：指向真实后端 `https://api-staging.qilemax.com`
3. **正常使用**：前端应用正常操作，Mockoon 自动录制所有经过代理的响应
4. **离线开发**：断开网络，Mockoon 已经缓存了所有响应，直接使用录制数据

录制的响应会自动保存为 Mock 路由，下次无需代理就能直接返回。这在以下场景特别有用：

- **第三方 API**：Stripe 支付、支付宝回调、微信 OAuth —— 录制一次，永久离线
- **不稳定的服务**：staging 环境经常宕机？录制后本地开发不受影响
- **新同事入职**：不需要连接 staging，导入录制文件即可开始开发

## 六、CLI 模式：集成到开发流程

### 6.1 npm scripts 集成

```json
// package.json
{
  "scripts": {
    "mock": "mockoon-cli start --data ./mock/qile-max-b2c.json --port 3001",
    "mock:watch": "mockoon-cli start --data ./mock/qile-max-b2c.json --port 3001 --log-transaction",
    "dev:mock": "concurrently \"npm run mock\" \"npm run dev\""
  }
}
```

### 6.2 Docker 部署（团队共享）

```dockerfile
# Dockerfile.mock
FROM mockoon/cli:latest
COPY ./mock/qile-max-b2c.json /data/mocks.json
EXPOSE 3001
CMD ["--data", "/data/mocks.json", "--port", "3001", "--hostname", "0.0.0.0"]
```

```yaml
# docker-compose.yml（追加 mock 服务）
services:
  mock-server:
    build:
      context: .
      dockerfile: Dockerfile.mock
    ports:
      - "3001:3001"
    volumes:
      - ./mock:/data  # 热更新 Mock 配置
```

### 6.3 CI/CD 无头模式集成（Headless Mode）

Mockoon CLI 的无头模式（Headless Mode）是 CI/CD 流水线集成的核心能力。在 GitHub Actions、GitLab CI 等自动化环境中，我们不需要 GUI，只需要通过命令行启动 Mock 服务即可。

#### 6.3.1 GitHub Actions 示例

```yaml
# .github/workflows/e2e-test.yml
name: E2E Tests with Mock API

on: [push, pull_request]

jobs:
  e2e-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Mockoon CLI
        run: npm install -g @mockoon/cli

      - name: Start Mock Server (background)
        run: |
          mockoon-cli start \
            --data ./mock/products.json \
            --data ./mock/cart.json \
            --data ./mock/payment.json \
            --port 3001 &
          # 等待 Mock 服务就绪
          npx wait-on http://localhost:3001/api/v2/health --timeout 10000

      - name: Run E2E Tests (Playwright)
        run: |
          VITE_API_BASE_URL=http://localhost:3001/api/v2 npx playwright test
        env:
          CI: true

      - name: Upload Test Report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
```

#### 6.3.2 GitLab CI 示例

```yaml
# .gitlab-ci.yml
stages:
  - test

e2e-test:
  stage: test
  image: node:20
  services:
    - name: mockoon/cli:latest
      alias: mock-server
      command: ["--data", "/data/mocks.json", "--port", "3001", "--hostname", "0.0.0.0"]
  variables:
    VITE_API_BASE_URL: "http://mock-server:3001/api/v2"
  script:
    - npm ci
    - npx playwright test
  artifacts:
    when: failure
    paths:
      - playwright-report/
```

#### 6.3.3 本地 CI 模拟（pre-commit / pre-push）

在本地开发中，也可以用 `husky` 在 push 前自动运行 Mock + E2E 测试：

```json
// package.json
{
  "scripts": {
    "test:e2e": "mockoon-cli start --data ./mock/*.json --port 3001 & sleep 2 && playwright test; kill %1",
    "test:e2e:ci": "start-server-and-test mock http://localhost:3001/api/v2/health test:e2e"
  }
}
```

> 💡 **最佳实践**：在 Mock 配置中添加一个 `/api/v2/health` 端点返回 `{"status": "ok"}`，作为 CI 环境中判断 Mock 服务是否就绪的健康检查接口。

#### 6.3.4 CI 环境中的性能优化

在 CI/CD 流水线中运行 Mockoon 时，有几个性能优化建议：

1. **禁用日志**：生产 CI 环境中不需要 `--log-transaction`，减少 I/O 开销
2. **使用 `--faker-locale`**：如果测试数据需要中文，指定 `--faker-locale zh_CN`
3. **预热请求**：在 E2E 测试开始前，先发一个预热请求让 Mockoon 初始化模板引擎
4. **并行测试**：如果 Playwright 使用多 Worker，确保 Mock 服务能处理并发请求（Mockoon 默认支持）

```bash
# CI 优化启动命令
mockoon-cli start \
  --data ./mock/qile-max-b2c.json \
  --port 3001 \
  --faker-locale zh_CN \
  --disable-admin-api \
  &
```

## 七、真实踩坑记录

### 踩坑 1：CORS 问题

**现象**：前端请求 Mockoon 返回 `CORS error`

**原因**：Mockoon 默认不开启 CORS headers

**解决**：在 Environment Settings → Headers 中添加：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
```

或者在 Mockoon GUI 中勾选 `Automatically add CORS headers`。

### 踩坑 2：Content-Type 不匹配

**现象**：前端用 `axios.post` 发送 JSON，Mockoon 返回 404

**原因**：Mockoon 路由配置了 `Content-Type: application/x-www-form-urlencoded`，但前端发的是 `application/json`

**解决**：确保路由的 `Content-Type` 设置为 `application/json`，或者不设置（Mockoon 会自动识别）。

### 踩坑 3：动态模板语法错误导致空响应

**现象**：请求 Mockoon 返回空页面，无任何内容

**原因**：Handlebars 模板语法写错了，比如 `{{faker 'commerce.productName'` 少了一个 `}}`

**解决**：
1. Mockoon GUI 有语法检查，注意红色提示
2. 用 `--log-transaction` 模式启动可以看到详细错误日志
3. 模板写好后先用简单值测试，再逐步加动态内容

### 踩坑 4：代理转发超时

**现象**：配置代理后，部分请求要等 30 秒才返回

**原因**：Mockoon 代理超时默认 30 秒，staging 环境响应慢

**解决**：在 Environment Settings 中调低超时时间：

```
Proxy timeout: 5000ms
```

同时建议在 Mockoon 中把**已知慢的接口**配置为本地 Mock，不要走代理。

### 踩坑 5：团队协作时 Mock 配置冲突

**现象**：多人同时修改 `qile-max-b2c.json`，git 冲突频繁

**解决**：
1. 按模块拆分 Mock 配置文件：`mock/products.json`、`mock/cart.json`、`mock/payment.json`
2. Mockoon CLI 支持多个 `--data` 参数：

```bash
mockoon-cli start \
  --data ./mock/products.json \
  --data ./mock/cart.json \
  --data ./mock/payment.json \
  --port 3001
```

3. 或者用 Docker Compose 每个模块独立一个 Mock 服务，Nginx 统一入口。

### 踩坑 6：Cookie / Session 处理不当

**现象**：前端登录后，Mockoon 返回的 `Set-Cookie` 无法被浏览器正确保存，后续请求始终返回 401。

**原因**：Mockoon 默认响应头中没有配置 `Set-Cookie`，且前端使用 `withCredentials: true` 时，Mockoon 的 CORS 配置需要显式允许 `credentials`。

**解决**：

1. 在路由响应 Headers 中添加 `Set-Cookie`：

```
Set-Cookie: mock_session=abc123; Path=/; HttpOnly; SameSite=Lax
```

2. CORS 配置中**不能使用通配符** `*`，必须指定具体 Origin：

```
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Credentials: true
```

3. 如果使用 axios，确保配置了 `withCredentials: true`：

```javascript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true, // 关键：允许携带 Cookie
})
```

> ⚠️ **注意**：Mockoon 的 `Access-Control-Allow-Origin: *` 和 `Access-Control-Allow-Credentials: true` 不能同时使用，这是浏览器安全策略的硬性要求。

### 踩坑 7：Data Buckets 状态管理陷阱

**现象**：使用 Data Buckets 模拟购物车，添加商品后查询能返回新数据，但重启 Mockoon 后数据丢失。更严重的是，多开发者共享 Docker Mock 服务时，彼此操作会互相干扰。

**原因**：Data Buckets 的数据存储在内存中，Mockoon 重启即清空。Docker 容器共享同一个 Mock 服务实例时，状态是全局的。

**解决方案**：

1. **单人开发**：接受内存状态的限制，通过 `--log-transaction` 模式记录操作历史，方便回溯。

2. **多人共享**：为每个开发者分配独立的 Mock 服务实例（不同端口），或者使用 Mockoon 的 **Response Rules** 基于请求参数返回不同数据，而不是依赖全局状态。

3. **需要持久化**：结合 `faker` 模板 + 请求参数生成确定性数据，避免依赖全局状态：

```handlebars
{
  "code": 200,
  "data": {
    "cart_items": [
      {{#repeat (queryParam 'count' '3')}}
      {
        "product_id": {{@index}} + 1000,
        "name": "{{faker 'commerce.productName'}}",
        "quantity": {{faker 'random.number' min=1 max=5}},
        "price": {{faker 'commerce.price' min=10 max=999}}
      }
      {{/repeat}}
    ]
  }
}
```

这样即使重启 Mockoon，相同的请求参数也会返回结构一致（内容随机）的数据，前端开发不受影响。

### 踩坑 8：代理转发时 Headers 丢失

**现象**：配置代理转发后，前端请求到 staging 后端的 `Authorization` header 丢失，导致 401。

**原因**：Mockoon 代理默认会转发大部分 Headers，但某些自定义 Headers 可能被过滤。

**解决**：在 Environment Settings → Proxy 中，确保 `Forward all headers` 选项已开启。如果需要添加额外 Headers（如固定的 API Key），可以在代理配置的 `Headers to add` 中添加：

```
X-Mock-Forwarded: true
Authorization: Bearer staging-token-xxx
```

## 八、Mockoon vs 其他 Mock 方案对比

| 特性 | Mockoon | WireMock | MSW (Mock Service Worker) | JSON Server |
|------|---------|----------|---------------------------|-------------|
| **运行方式** | 本地 GUI + CLI | 独立 Java 服务 | 浏览器 Service Worker | Node.js 服务 |
| **GUI 界面** | ✅ 完整桌面应用 | ❌ 无官方 GUI | ❌ 纯代码 | ❌ 纯 CLI |
| **动态模板** | ✅ Handlebars | ✅ Handlebars/JSONata | ✅ JS 代码（完全灵活） | ❌ 静态 JSON |
| **代理转发** | ✅ 内置 | ✅ 内置（强大） | ✅ 通过 `bypass` | ❌ 不支持 |
| **录制/回放** | ✅ 内置 | ✅ 需插件 | ❌ | ❌ |
| **状态管理** | ✅ Data Buckets | ✅ Scenarios | ❌ 需外部状态 | ✅ 自动 CRUD |
| **CLI/CI 集成** | ✅ @mockoon/cli | ✅ Java JAR | ✅ npm 包 | ✅ npm 包 |
| **Docker 支持** | ✅ 官方镜像 | ✅ 官方镜像 | N/A（嵌入测试） | ✅ 社区镜像 |
| **学习成本** | ⭐ 低 | ⭐⭐⭐ 中高 | ⭐⭐ 中 | ⭐ 极低 |
| **语言依赖** | Node.js / 独立 | Java Runtime | Node.js | Node.js |
| **适合场景** | 前后端联调、本地开发 | 微服务测试、契约测试 | 单元/集成测试 | 快速原型 |
| **开源协议** | MIT | Apache 2.0 | MIT | MIT |

**详细对比分析**：

**Mockoon 的优势**：开箱即用的 GUI 对前端开发者最友好，不需要写任何代码就能配置复杂的 Mock 场景。Handlebars 模板语法简单直观，代理转发和录制功能完善。适合**前后端联调**和**本地开发**场景。

**WireMock 的优势**：基于 Java 生态，在微服务架构中广泛使用。支持更复杂的请求匹配规则（正则、JSONPath、XPath），Scenarios 功能可以模拟多步骤的状态转换。适合**后端微服务测试**和**契约测试**，但学习曲线较陡。

**MSW 的优势**：完全在浏览器/Node.js 进程内运行，不启动额外服务器。拦截网络请求的方式最"干净"，对前端单元测试和集成测试最友好。但**不适合前后端联调**——它只能在测试进程内使用。

**JSON Server 的优势**：30 秒启动一个 RESTful API，支持自动 CRUD 操作。适合快速原型验证，但**不支持动态模板和代理转发**，生产级场景力不从心。

**我们的选型策略**：
- **本地开发**：Mockoon（零配置、GUI 直观）
- **团队协作**：Mockoon + Git 版本管理（Mock 配置文件随代码仓库）
- **单元测试**：MSW（集成到 Jest/Vitest）
- **快速原型**：JSON Server（30 秒启动）
- **微服务测试**：WireMock（复杂路由匹配 + 状态机）

## 九、进阶技巧

### 9.1 模拟网络延迟

在路由设置中添加 `latency`，模拟真实网络环境：

```
Route latency: 200ms
```

这能帮前端发现 loading 状态的 bug。很多前端代码在本地 Mock 时一切正常（0ms 响应），上了 staging 就出问题（200-500ms 响应），就是因为没有测试延迟场景。

### 9.2 模拟错误响应

为同一个路由配置多个 Response，通过规则切换：

```
Response 1 (default): 200 OK — 正常响应
Response 2 (rule: header X-Test-Error = "500"): 500 Internal Server Error
Response 3 (rule: header X-Test-Error = "timeout"): 延迟 30 秒后返回
```

前端只需在请求头加 `X-Test-Error: 500` 就能测试错误处理逻辑。

### 9.3 录制真实 API 响应

Mockoon 支持录制模式，把真实 API 的响应保存下来：

1. 开启 `Recording` 模式
2. 配置 Proxy 指向真实后端
3. 正常使用前端应用，Mockoon 自动录制所有响应
4. 断开真实后端，用录制的数据离线开发

这在对接第三方 API（Stripe、支付宝）时特别有用——录制一次，永久离线使用。

## 十、总结

Mockoon 在我们团队的 B2C 电商开发中扮演了重要角色：

1. **前端不再等待后端**：OpenAPI 文档一出，Mockoon 配置 5 分钟就能用
2. **测试更全面**：动态模板覆盖正常/异常/边界场景
3. **联调更高效**：代理转发让 Mock 和真实 API 无缝切换
4. **团队协作顺畅**：Mock 配置文件随代码仓库版本管理

> 💡 **核心建议**：不要等到联调阶段才想到 Mock。在 Sprint Planning 时就把 Mock 配置纳入任务估算，后端出 OpenAPI 文档的同一天，Mock 配置就该到位。

## 相关阅读

- [Vite vs Webpack Laravel Mix 前端构建工具选型对比实战](/categories/Frontend-Laravel/vite-vs-webpack-laravel-mix-vs/)
- [uni-app + Vue 3 + Vite 现代跨平台开发工作流实战踩坑记录](/categories/Frontend/uni-app-vue3-vite/)
- [Charles 实战：HTTPS SSL 代理抓包与 Mock API 调试](/categories/macOS-Tools/charles-guide-sslmock-laravel-api/)
