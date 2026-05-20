---
title: "Mockoon 实战：本地 Mock 服务器快速搭建与 Laravel B2C 前后端联调踩坑记录"
date: 2026-05-17 05:55:11
updated: 2026-05-17 05:58:47
categories:
  - HTML
tags: [BFF, Laravel, 测试]
description: "在 Laravel B2C 电商项目中，后端接口未就绪时如何让前端不阻塞？Mockoon 作为本地 Mock 服务器的深度实战：从安装配置到动态模板、代理转发、团队协作，附真实踩坑记录。"
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

### 3.2 创建第一个 Mock 环境

打开 Mockoon GUI，点击 `File → New Environment`，配置：

- **Environment Name**：`qile-max-b2c-mock`
- **Hostname**：`localhost`
- **Port**：`3001`

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

### 4.3 使用 Data Buckets 模拟购物车状态

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

这意味着：
- 有 Mock 路由的请求 → 返回 Mock 数据
- 没有 Mock 路由的请求 → 转发到 staging 环境

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

## 八、Mockoon vs 其他 Mock 方案对比

| 特性 | Mockoon | JSON Server | Apifox Mock | MSW |
|------|---------|-------------|-------------|-----|
| 本地运行 | ✅ | ✅ | ❌（云端） | ✅ |
| GUI 界面 | ✅ | ❌ | ✅ | ❌ |
| 动态模板 | ✅ Handlebars | ❌ | ✅ | ✅ JS 代码 |
| 代理转发 | ✅ | ❌ | ❌ | ✅ |
| CLI 集成 | ✅ | ✅ | ✅ | ✅ |
| 学习成本 | 低 | 极低 | 中 | 中高 |
| 适用场景 | 前后端联调 | 快速原型 | 团队协作 | 单元测试 |

**我们的选型策略**：
- **本地开发**：Mockoon（零配置、GUI 直观）
- **团队协作**：Apifox Mock（云端共享、OpenAPI 同步）
- **单元测试**：MSW（集成到 Jest/Vitest）
- **快速原型**：JSON Server（30 秒启动）

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
