---
title: "Postman/Apifox 实战：API 测试、Mock、自动化测试 — Laravel B2C API 踩坑记录"
date: 2026-05-17 02:35:29
updated: 2026-05-17 02:37:30
categories:
  - 测试
tags: [Laravel, 测试]description: "在 KKday B2C Backend Team，30+ 个 Laravel 微服务仓库的 API 联调长期依赖手动 Postman 请求。本文记录从 Postman Collection Runner → Apifox 自动化 → CI 集成的完整演进路径，覆盖环境变量管理、Mock Server 配置、Pre-request Script、数据驱动测试、CI/CD 集成等实战内容，以及迁移过程中的真实踩坑。"
---

# Postman/Apifox 实战：API 测试、Mock、自动化测试 — Laravel B2C API 踩坑记录

## 背景：从"手动点 Postman"到自动化 API 测试

在 KKday B2C Backend Team，我们有 30+ 个 Laravel 微服务仓库。长期以来，API 联调的基本流程是：

1. 后端写完接口 → 手动在 Postman 里打几个请求验证
2. 把 Postman Collection 导出 → 丢给前端
3. 前端自己配环境变量 → 遇到问题再来问后端

这个流程有几个致命问题：

- **环境变量不一致**：后端用 localhost:8000，前端用 staging.kkday.com，字段名对不上
- **Mock 数据靠手写**：接口还没上线，前端只能猜数据结构
- **回归测试靠人肉**：每次发版前，QA 手动跑一遍核心接口
- **Collection 越来越脏**：几个月下来，几百个请求混在一起，没人知道哪些是有效的

最终我们决定：**Postman 做探索式测试 + Apifox 做契约驱动自动化测试**，两者互补。

---

## 一、Postman 进阶用法（不只是发请求）

### 1.1 环境变量管理

Postman 的 Environment 是最容易被忽视、也最容易踩坑的功能。

**错误做法**：把 URL 硬编码在每个请求里。

**正确做法**：用 Environment 分层管理。

```
┌─────────────────────────────────────────────────┐
│           Postman Environment 分层               │
├─────────────────────────────────────────────────┤
│                                                 │
│  Global Environment                             │
│  ┌───────────────────────────────────────────┐  │
│  │ api_version: v2                           │  │
│  │ common_headers: {Accept: application/json}│  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  Local   │  │ Staging  │  │   Prod   │      │
│  │ base_url │  │ base_url │  │ base_url │      │
│  │ localhost│  │ staging. │  │ api.     │      │
│  │ :8000    │  │ kkday.com│  │ kkday.com│      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                 │
│  Collection Variables (共享)                    │
│  ┌───────────────────────────────────────────┐  │
│  │ auth_token: {{login后自动写入}}            │  │
│  │ order_id: {{创建订单后自动写入}}            │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**踩坑记录**：Postman 的变量优先级是 `Collection > Environment > Global`。我们曾经在 Collection 里定义了 `base_url=localhost:8000`，切到 Staging 环境后发现还是请求 localhost——排查了半小时才发现是 Collection 变量覆盖了 Environment 变量。

### 1.2 Pre-request Script：自动获取 Token

每次手动粘贴 JWT Token 是最烦的事。用 Pre-request Script 自动化：

```javascript
// Pre-request Script (Collection 级别)
// 每次请求前自动检查 token 是否过期，过期则重新登录

const tokenExpiry = pm.collectionVariables.get("token_expiry");
const now = Date.now();

if (!tokenExpiry || now > parseInt(tokenExpiry)) {
    // Token 过期或不存在，重新登录
    pm.sendRequest({
        url: pm.variables.get("base_url") + "/api/v2/auth/login",
        method: "POST",
        header: { "Content-Type": "application/json" },
        body: {
            mode: "raw",
            raw: JSON.stringify({
                email: "test@example.com",
                password: "test_password"
            })
        }
    }, (err, res) => {
        if (err) {
            console.error("Login failed:", err);
            return;
        }
        
        const token = res.json().data.access_token;
        const expiresIn = res.json().data.expires_in; // 秒
        
        pm.collectionVariables.set("auth_token", token);
        pm.collectionVariables.set("token_expiry", now + (expiresIn * 1000));
        
        console.log("Token refreshed, expires in", expiresIn, "seconds");
    });
}
```

**踩坑记录**：`pm.sendRequest` 是异步的！如果你的请求脚本依赖 token，但 sendRequest 还没返回就执行了后续请求，会拿到旧 token。解决方案是把所有请求都放在回调里，或者用 Collection Runner 的顺序保证。

### 1.3 Tests 断言：不只是状态码

```javascript
// Tests tab — 比检查 200 更有意义的断言

// 1. 基础断言
pm.test("Status code is 200", () => {
    pm.response.to.have.status(200);
});

// 2. 响应时间断言（SLA 保障）
pm.test("Response time under 500ms", () => {
    pm.expect(pm.response.responseTime).to.be.below(500);
});

// 3. JSON Schema 校验（契约测试核心）
pm.test("Response matches schema", () => {
    const schema = {
        type: "object",
        required: ["code", "message", "data"],
        properties: {
            code: { type: "integer" },
            message: { type: "string" },
            data: {
                type: "object",
                required: ["id", "title", "price", "currency"],
                properties: {
                    id: { type: "integer" },
                    title: { type: "string" },
                    price: { type: "number" },
                    currency: { type: "string", pattern: "^[A-Z]{3}$" }
                }
            }
        }
    };
    pm.response.to.have.jsonSchema(schema);
});

// 4. 业务逻辑断言
pm.test("Price is positive", () => {
    const price = pm.response.json().data.price;
    pm.expect(price).to.be.above(0);
});

// 5. 断言后自动保存变量（链式请求）
if (pm.response.code === 201) {
    pm.collectionVariables.set("order_id", pm.response.json().data.id);
    console.log("Saved order_id:", pm.response.json().data.id);
}
```

---

## 二、Apifox：契约驱动的 API 测试平台

### 2.1 为什么从 Postman 迁移到 Apifox？

| 维度 | Postman | Apifox |
|------|---------|--------|
| **API 文档** | 需要额外导出 | 内置，实时同步 |
| **Mock Server** | 需要开 Mock Server | 内置智能 Mock |
| **数据驱动** | CSV/JSON Runner | 内置数据集 + 动态变量 |
| **团队协作** | 免费版限制 3 人 | 免费版支持更多 |
| **中文支持** | 英文界面 | 原生中文 |
| **CI 集成** | Newman CLI | Apifox CLI + GitHub Action |
| **OpenAPI 同步** | 需要手动导入 | 自动同步 |

**迁移的真实原因**：Postman 在 2024 年开始强制登录 + 云端同步，我们的 API 文档涉及支付密钥等敏感信息，不希望上传到 Postman 的云端。Apifox 支持纯本地运行 + 自建 Git 同步，更符合安全合规要求。

### 2.2 Apifox 智能 Mock 实战

Apifox 的 Mock 能力远超 Postman。它能根据字段名自动生成合理的 Mock 数据：

```
字段名规则              →  自动生成的 Mock 数据
─────────────────────────────────────────
email                  →  "test_823@example.com"
phone                  →  "+886-912-345-678"
name / username        →  "张伟"
price / amount         →  128.50
created_at             →  "2026-05-17T02:35:00Z"
avatar / image_url     →  "https://picsum.photos/200"
status                 →  "active"
id                     →  10001
title                  →  "台北101观景台门票"
```

**配置步骤**：

1. 在 Apifox 中导入 OpenAPI YAML（`api-docs.yaml`）
2. 开启「智能 Mock」→ 自动根据字段名生成数据
3. 对复杂业务字段，添加「自定义 Mock 规则」

```yaml
# 自定义 Mock 规则示例（Apifox 的 Mock 期望配置）
# 路径：项目设置 → Mock → 高级 Mock → 期望

# 场景1：返回不同的产品类型
- match:
    path: "/api/v2/products/{id}"
    method: GET
  expect:
    body:
      data:
        id: 10001
        title: "台北101观景台门票"
        type: "ticket"
        price: 600
        currency: "TWD"
        status: "active"
        
# 场景2：模拟错误响应
- match:
    path: "/api/v2/products/{id}"
    method: GET
    params:
      id: "99999"
  expect:
    status: 404
    body:
      code: 404
      message: "Product not found"
```

**踩坑记录**：Apifox 的智能 Mock 会把 `description` 字段生成很长的随机文本。如果你的前端组件有字数限制（比如卡片只显示 50 字），会发现 Mock 环境正常但生产环境截断了。解决方案：在 Mock 规则里加 `maxLength` 约束。

### 2.3 数据驱动测试

手动改参数跑 100 遍是最无聊的事。Apifox 支持数据驱动：

```csv
# test-data/products.csv
product_id,expected_status,expected_currency
10001,200,TWD
10002,200,USD
99999,404,
0,400,
-1,400,
```

在 Apifox 的「自动化测试」中选择这个 CSV 作为数据集，每个请求会自动遍历所有行。

**真实场景**：我们用数据驱动测试覆盖了「搜索接口」的 30+ 种筛选条件组合：

```javascript
// Apifox 测试脚本
pm.test("搜索结果符合筛选条件", () => {
    const body = pm.response.json();
    
    // 如果有 category 参数，验证结果都属于该分类
    if (pm.variables.get("category")) {
        body.data.items.forEach(item => {
            pm.expect(item.category).to.equal(pm.variables.get("category"));
        });
    }
    
    // 如果有 min_price 参数，验证价格下限
    if (pm.variables.get("min_price")) {
        body.data.items.forEach(item => {
            pm.expect(item.price).to.be.at.least(
                parseFloat(pm.variables.get("min_price"))
            );
        });
    }
    
    // 分页验证
    pm.expect(body.data.current_page).to.be.a("number");
    pm.expect(body.data.per_page).to.be.at.most(100); // API 限制每页最多 100
});
```

---

## 三、CI/CD 集成：让 API 测试自动化

### 3.1 Postman + Newman CLI

Newman 是 Postman 的命令行运行器，可以集成到 CI：

```yaml
# .github/workflows/api-test.yml
name: API Tests

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: test_root
          MYSQL_DATABASE: kkday_test
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
      
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']

    steps:
      - uses: actions/checkout@v4
      
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, mysql, redis
          
      - name: Install Dependencies
        run: |
          composer install --no-progress --prefer-dist
          php artisan key:generate
          php artisan migrate --force
          
      - name: Start Laravel Server
        run: php artisan serve --port=8000 &
        
      - name: Wait for Server
        run: |
          for i in $(seq 1 30); do
            curl -s http://localhost:8000/api/health && break
            sleep 1
          done
          
      - name: Run Newman Tests
        uses: matt-ball/newman-action@v1
        with:
          collection: postman/collections/b2c-api.postman_collection.json
          environment: postman/environments/local.postman_environment.json
          iterationData: postman/data/test-cases.csv
          reporters: cli,htmlextra
          reporterHtmlextraExport: newman/report.html
          
      - name: Upload Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: newman-report
          path: newman/report.html
```

**踩坑记录**：Newman 默认不会加载 `pm.sendRequest` 的异步回调——它在一个隔离的沙箱里运行。如果你的 Pre-request Script 用了 `pm.sendRequest` 获取 token，在 Newman 里会静默失败。解决方案：改用 `--env-var` 传入 token，或者用 `newman-reporter-htmextra` 插件的异步支持。

### 3.2 Apifox CLI 集成

Apifox 提供了更简洁的 CLI 工具：

```yaml
# .github/workflows/apifox-test.yml
      - name: Run Apifox Tests
        run: |
          npx apifox run \
            --project-id ${{ secrets.APIFOX_PROJECT_ID }} \
            --token ${{ secrets.APIFOX_TOKEN }} \
            --env "Staging" \
            --reporter html \
            --output apifox-report.html
```

**与 Newman 的关键差异**：Apifox CLI 直接从云端拉取最新的测试用例，不需要手动导出 JSON 文件。这意味着你修改了 Apifox 里的测试用例，CI 会自动用最新版本，不需要 commit collection 文件。

---

## 四、真实踩坑记录汇总

### 踩坑 1：Postman Collection 膨胀问题

**问题**：30+ 仓库的 Collection 合并后超过 5000 个请求，打开都要等 10 秒。

**解决**：按模块拆分 Collection，用 Folder 组织：

```
📁 B2C API Collection
├── 📂 Auth（认证模块）
│   ├── POST /login
│   ├── POST /register
│   ├── POST /refresh-token
│   └── POST /logout
├── 📂 Products（产品模块）
│   ├── GET /products（列表）
│   ├── GET /products/{id}（详情）
│   ├── GET /products/search（搜索）
│   └── POST /products/{id}/favorite（收藏）
├── 📂 Orders（订单模块）
│   ├── POST /orders（创建）
│   ├── GET /orders/{id}（详情）
│   └── POST /orders/{id}/pay（支付）
└── 📂 Health（健康检查）
    └── GET /health
```

### 踩坑 2：Mock 数据与真实数据不一致

**问题**：前端用 Mock 数据开发的页面，上线后字段名对不上。

**根因**：Mock 数据是手动维护的，接口改了但 Mock 没更新。

**解决**：用 OpenAPI YAML 作为 Single Source of Truth，Mock 从 Schema 自动生成：

```yaml
# openapi.yaml — Mock 的唯一来源
paths:
  /api/v2/products/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  code: { type: integer, example: 0 }
                  data:
                    type: object
                    required: [id, title, price, currency]
                    properties:
                      id: { type: integer, example: 10001 }
                      title: { type: string, example: "台北101观景台门票" }
                      price: { type: number, example: 600.00 }
                      currency: { type: string, example: "TWD", pattern: "^[A-Z]{3}$" }
                      images:
                        type: array
                        items:
                          type: string
                          format: uri
                        example: ["https://cdn.kkday.com/product/10001/main.jpg"]
```

### 踩坑 3：CI 环境下数据库状态污染

**问题**：CI 中多个 API 测试用例共享同一个数据库，前一个用例创建的订单影响了后面的断言。

**解决**：每个测试场景前重置数据库：

```bash
# 在 CI 的 setup 步骤中
php artisan migrate:fresh --seed --force

# 或者用 DatabaseTransactions（Laravel 测试自带）
# 但 Postman/Apifox 是外部请求，无法使用 Laravel 的事务回滚
# 所以需要在 CI 脚本中手动处理
```

**更好的方案**：为 API 测试创建独立的测试数据库，每次 CI 运行前 `migrate:fresh`：

```yaml
      - name: Setup Test Database
        env:
          DB_DATABASE: kkday_api_test
          DB_HOST: 127.0.0.1
        run: |
          mysql -h 127.0.0.1 -u root -ptest_root -e "CREATE DATABASE IF NOT EXISTS kkday_api_test;"
          php artisan migrate:fresh --seed --force --database=mysql
```

### 踩坑 4：Apifox 的 Mock 端口冲突

**问题**：本地同时运行 Laravel（:8000）和 Apifox Mock Server（:4523），前端 `.env` 配置混乱。

**解决**：统一用环境变量管理 API 基地址：

```bash
# .env.development — 前端项目
# 使用真实后端
VITE_API_BASE_URL=http://localhost:8000/api/v2

# 切换到 Mock
# VITE_API_BASE_URL=http://localhost:4523/api/v2
```

---

## 五、选型建议：Postman vs Apifox vs 其他

```
┌──────────────────────────────────────────────────────────────┐
│                    API 测试工具选型决策树                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  需求：API 探索式调试                                         │
│  └──→ Postman（生态最成熟，插件最丰富）                        │
│                                                              │
│  需求：团队协作 + API 文档 + Mock 一体化                       │
│  └──→ Apifox（中文友好，开箱即用，免费版够用）                  │
│                                                              │
│  需求：纯 CLI 自动化 + CI 集成                                │
│  └──→ Newman（Postman） / Apifox CLI / Karate DSL            │
│                                                              │
│  需求：契约测试（OpenAPI Schema 驱动）                        │
│  └──→ Schemathesis / Dredd / Apifox Schema Validation       │
│                                                              │
│  需求：性能测试                                               │
│  └──→ k6 / Artillery / Postman Collection Runner（轻量）     │
│                                                              │
│  预算有限 + 纯本地运行                                        │
│  └──→ Apifox（免费版支持本地 Git 同步）                       │
│                                                              │
│  已有 Postman 生态 + 付费版                                   │
│  └──→ 继续用 Postman（迁移成本 > 收益）                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 六、我们的最终工作流

```
                    OpenAPI YAML
                   (Single Source of Truth)
                         │
           ┌─────────────┼─────────────┐
           │             │             │
           ▼             ▼             ▼
      API 文档       Mock Server    契约测试
    (Apifox 自动    (智能 Mock     (Schema
     生成文档页)     自动生成)      Validation)
           │             │             │
           └─────────────┼─────────────┘
                         │
                         ▼
                   CI/CD Pipeline
              (Apifox CLI / Newman)
                         │
                   ┌─────┼─────┐
                   │     │     │
                   ▼     ▼     ▼
                 Slack  PR    测试
                通知   Comment 报告
```

**关键原则**：

1. **OpenAPI YAML 是唯一的真相来源**——任何字段变更必须先改 YAML
2. **Mock 从 Schema 自动生成**——不手动维护 Mock 数据
3. **API 测试在 CI 中自动运行**——PR 合并前必须通过所有 API 测试
4. **测试结果自动通知**——失败时 Slack 通知 + PR Comment

---

## 总结

| 阶段 | 工具 | 痛点 |
|------|------|------|
| 探索式调试 | Postman | 环境变量混乱、Collection 膨胀 |
| 契约驱动 | Apifox + OpenAPI | Mock 与真实数据不一致 |
| 自动化测试 | CI + Newman/Apifox CLI | 数据库状态污染 |
| 持续集成 | GitHub Actions | 异步脚本在 CLI 中失效 |

API 测试的核心不是工具选哪个，而是**建立契约优先的工作流**。工具会变，但「先定义 Schema → 再 Mock → 再实现 → 最后验证」的流程不会变。
