
title: Postman 高级实战：Collection、Environment、Pre-request Script 与 Newman CI 集成踩坑记录
keywords: [Postman]
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
date: 2026-05-17 06:20:30
updated: 2026-05-17 06:22:38
categories:
  - engineering
  - testing
tags:
- CI/CD
- Laravel
- 测试
description: 'Postman API测试高级实战指南：详解集合(Collection)编排与组织策略、多环境变量管理与切换技巧、Pre-request Script实现自动化鉴权与Token刷新机制、Tests断言链路设计（Schema验证与性能断言）及Newman CLI的CI/CD集成方案。涵盖数据驱动测试与六大踩坑场景，助你从手动调试构建完整的自动化API测试工作流，提升团队协作效率。

  '
---

# Postman 高级实战：Collection、Environment、Pre-request Script 与 Newman CI 集成

## 前言

很多开发者对 Postman 的认知停留在「发请求、看响应」的阶段。但在实际的 B2C API 项目中，Postman 可以承担起**接口契约验证、自动化回归测试、CI 质量门禁**等关键角色。

本文基于我在 KKday 30+ Laravel B2C API 仓库中的真实经验，系统整理 Postman 的高级用法——不是「功能介绍」，而是**每一步都有真实踩坑记录**的实战指南。

## 整体架构概览

```
┌─────────────────────────────────────────────────────┐
│                   Postman 工作流                      │
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐ │
│  │Collection│──▶│Environment│──▶│Pre-request Script│ │
│  │  请求编排 │   │ 变量管理  │   │  自动化鉴权      │ │
│  └────┬─────┘   └────┬─────┘   └────────┬─────────┘ │
│       │              │                   │           │
│       ▼              ▼                   ▼           │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐ │
│  │  Tests   │   │ 动态变量  │   │   Newman CLI     │ │
│  │ 断言验证  │   │ 数据驱动  │   │   CI 集成        │ │
│  └──────────┘   └──────────┘   └──────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## 一、Collection 高级组织：不只是文件夹

### 1.1 Collection 层级设计

很多团队把 Collection 当成简单的请求分组，但实际上 Collection 的组织方式直接决定了**可维护性和复用性**。

```
📁 B2C API Collection
├── 📂 Auth（鉴权模块）
│   ├── POST /api/v2/auth/login
│   ├── POST /api/v2/auth/refresh
│   └── POST /api/v2/auth/logout
├── 📂 Products（商品模块）
│   ├── GET /api/v2/products
│   ├── GET /api/v2/products/:id
│   └── POST /api/v2/products/search
├── 📂 Orders（订单模块）
│   ├── POST /api/v2/orders
│   ├── GET /api/v2/orders/:id
│   └── POST /api/v2/orders/:id/pay
└── 📂 Collection-Level Scripts（共享脚本）
    ├── Pre-request: Token 自动获取
    └── Tests: 统一响应格式验证
```

**踩坑 #1：Collection-Level Scripts 的执行顺序**

Postman 的脚本执行顺序是：

```
Collection Pre-request → Folder Pre-request → Request Pre-request
       ↓                                          ↓
  Collection Tests ← Folder Tests ← Request Tests
```

我们曾经在 Request 级别写了 Token 刷新逻辑，但 Collection 级别也有一个 Token 检查，导致**两层脚本互相覆盖**。正确做法是把鉴权逻辑统一放在 Collection 级别，Request 级别只做业务断言。

### 1.2 Collection 变量 vs Environment 变量

```javascript
// Collection 变量：与 Collection 绑定，适合存储 API 版本、基础路径
pm.collectionVariables.set("api_version", "v2");
pm.collectionVariables.set("base_path", "/api/v2");

// Environment 变量：与环境绑定，适合存储 URL、Token、数据库配置
pm.environment.set("base_url", "https://api-staging.kkday.com");
pm.environment.set("access_token", "eyJhbGciOi...");

// Global 变量：跨 Collection 共享，慎用
pm.globals.set("company_id", "KKDAY");
```

**踩坑 #2：变量优先级陷阱**

Postman 变量优先级：`Local > Data > Environment > Collection > Global`

我们在一个测试中用 `pm.variables.get("user_id")` 获取用户 ID，但 Environment 和 Collection 都定义了 `user_id`，结果取到的是 Collection 的值（因为 Environment 被覆盖了）。后来统一规范：**Collection 变量存模板路径，Environment 变存环境数据，不混用**。

## 二、Environment 管理：多环境无缝切换

### 2.1 环境分层设计

```json
// Staging Environment
{
  "id": "env-staging-001",
  "name": "B2C Staging",
  "values": [
    { "key": "base_url", "value": "https://api-staging.kkday.com", "type": "default" },
    { "key": "admin_email", "value": "admin@kkday-staging.com", "type": "default" },
    { "key": "stripe_key", "value": "sk_test_xxx", "type": "secret" },
    { "key": "db_host", "value": "staging-db.internal", "type": "default" }
  ]
}

// Production Environment
{
  "id": "env-prod-001",
  "name": "B2C Production",
  "values": [
    { "key": "base_url", "value": "https://api.kkday.com", "type": "default" },
    { "key": "admin_email", "value": "admin@kkday.com", "type": "default" },
    { "key": "stripe_key", "value": "sk_live_xxx", "type": "secret" },
    { "key": "db_host", "value": "prod-db.internal", "type": "default" }
  ]
}
```

**踩坑 #3：secret 类型变量的导出问题**

Postman 中标记为 `secret` 的变量在导出 Collection/Environment 时**默认不包含值**。我们团队曾因此丢失了 staging 的 API Key，导致 CI 跑不起来。解决方案：

```bash
# 导出时勾选 "Export with secrets" 选项
# 或者在 CI 中通过环境变量注入
newman run collection.json \
  --env-var "stripe_key=$STRIPE_KEY" \
  --env-var "access_token=$ACCESS_TOKEN"
```

### 2.2 动态环境变量

```javascript
// 在 Pre-request Script 中动态生成环境变量
// 场景：根据当前时间选择不同的 API 端点
const hour = new Date().getHours();
if (hour >= 0 && hour < 6) {
  pm.environment.set("api_endpoint", "https://api-maintenance.kkday.com");
} else {
  pm.environment.set("api_endpoint", pm.environment.get("base_url"));
}

// 场景：动态生成唯一订单号
const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
pm.environment.set("order_id", orderId);
```

## 三、Pre-request Script：自动化鉴权的利器

### 3.1 Token 自动获取与刷新

这是 Postman 高级用法中**最实用**的场景。在 B2C API 中，几乎每个请求都需要 Bearer Token，手动复制粘贴效率极低。

```javascript
// Collection-Level Pre-request Script
// 场景：Laravel B2C API 的 JWT Token 自动管理

const tokenValid = () => {
  const token = pm.environment.get("access_token");
  if (!token) return false;

  try {
    // JWT Token 解码检查过期时间
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expTimestamp = payload.exp * 1000;
    const now = Date.now();
    // 提前 60 秒刷新，避免边界情况
    return expTimestamp - now > 60000;
  } catch (e) {
    return false;
  }
};

if (!tokenValid()) {
  // Token 不存在或已过期，自动获取新 Token
  const refreshToken = pm.environment.get("refresh_token");

  if (refreshToken) {
    // 有 refresh_token，走刷新流程
    pm.sendRequest({
      url: `${pm.environment.get("base_url")}/api/v2/auth/refresh`,
      method: "POST",
      header: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: {
        mode: "raw",
        raw: JSON.stringify({ refresh_token: refreshToken })
      }
    }, (err, res) => {
      if (err || res.code !== 200) {
        console.error("Token refresh failed:", err || res.json());
        // 刷新失败，回退到登录
        doLogin();
      } else {
        const data = res.json().data;
        pm.environment.set("access_token", data.access_token);
        pm.environment.set("refresh_token", data.refresh_token);
        console.log("Token refreshed successfully");
      }
    });
  } else {
    // 没有 refresh_token，走登录流程
    doLogin();
  }
}

function doLogin() {
  pm.sendRequest({
    url: `${pm.environment.get("base_url")}/api/v2/auth/login`,
    method: "POST",
    header: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: {
      mode: "raw",
      raw: JSON.stringify({
        email: pm.environment.get("admin_email"),
        password: pm.environment.get("admin_password"),
        device_id: "postman-test-device"
      })
    }
  }, (err, res) => {
    if (err || res.code !== 200) {
      console.error("Login failed:", err || res.json());
      throw new Error("无法获取 Token，测试终止");
    }
    const data = res.json().data;
    pm.environment.set("access_token", data.access_token);
    pm.environment.set("refresh_token", data.refresh_token);
    console.log("Login successful, token set");
  });
}
```

**踩坑 #4：`pm.sendRequest` 的异步问题**

`pm.sendRequest` 是异步的，但 Pre-request Script 执行完成后才会发实际请求。如果 Token 刷新的 `pm.sendRequest` 还没返回，实际请求就已经发出去了——**拿到的还是旧 Token**。

解决方案：对于同步场景，改用 `pm.execution.setNextRequest()` 控制流程，或者确保 Token 刷新在 Collection 级别的 Pre-request 中完成（Postman 会等待 Collection 级别的异步请求完成）。

### 3.2 请求签名生成

很多第三方 API（支付宝、微信支付）需要请求签名：

```javascript
// 支付宝 API 请求签名
const crypto = require('crypto-js');

const appId = pm.environment.get("alipay_app_id");
const privateKey = pm.environment.get("alipay_private_key");

const params = {
  app_id: appId,
  method: "alipay.trade.query",
  format: "JSON",
  return_url: "https://api.kkday.com/callback",
  charset: "utf-8",
  sign_type: "RSA2",
  timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
  version: "1.0",
  biz_content: JSON.stringify({ out_trade_no: pm.environment.get("order_id") })
};

// 参数排序拼接
const sortedKeys = Object.keys(params).sort();
const signStr = sortedKeys
  .filter(key => params[key] !== "" && params[key] !== undefined)
  .map(key => `${key}=${params[key]}`)
  .join("&");

// RSA2 签名（SHA256WithRSA）
const sign = crypto.SHA256(signStr, privateKey).toString();

pm.environment.set("alipay_sign", sign);
pm.environment.set("alipay_params", JSON.stringify(params));
```

### 3.3 数据清理与状态重置

```javascript
// 在测试脚本（Tests）中清理测试数据
// 场景：创建订单测试完成后，自动取消订单避免脏数据

if (pm.response.code === 201) {
  const orderId = pm.response.json().data.order_id;
  pm.environment.set("cleanup_order_id", orderId);

  // 注册集合运行结束后的清理任务
  // 注意：这个只能在 Collection Runner 中生效
  pm.collectionVariables.set("pending_cleanup", "true");
}
```

## 四、Tests 断言进阶：超越 Status Code

### 4.1 结构化响应验证

```javascript
// 统一响应格式验证（Laravel API Resources 格式）
pm.test("Response has standard structure", () => {
  const json = pm.response.json();

  // 验证顶层结构
  pm.expect(json).to.have.property("success");
  pm.expect(json).to.have.property("data");
  pm.expect(json).to.have.property("message");

  // 验证 success 字段类型
  pm.expect(json.success).to.be.a("boolean");
});

// 分页响应验证
pm.test("Paginated response has correct structure", () => {
  const json = pm.response.json();

  pm.expect(json.data).to.have.property("items");
  pm.expect(json.data).to.have.property("meta");
  pm.expect(json.data.meta).to.have.all.keys(
    "current_page", "last_page", "per_page", "total"
  );
  pm.expect(json.data.items).to.be.an("array");
  pm.expect(json.data.meta.current_page).to.be.a("number");
});
```

### 4.2 契约测试（Schema Validation）

```javascript
// 使用 Ajv 进行 JSON Schema 验证
const productSchema = {
  type: "object",
  required: ["id", "name", "price", "currency", "status"],
  properties: {
    id: { type: "integer" },
    name: { type: "string", minLength: 1 },
    price: { type: "number", minimum: 0 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    status: { type: "string", enum: ["active", "inactive", "sold_out"] },
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          sort_order: { type: "integer" }
        }
      }
    }
  }
};

pm.test("Product schema is valid", () => {
  const data = pm.response.json().data;
  const items = Array.isArray(data) ? data : [data];

  items.forEach(item => {
    pm.expect(tv4.validate(item, productSchema)).to.be.true;
  });
});
```

### 4.3 性能断言

```javascript
// 响应时间断言
pm.test("Response time is acceptable", () => {
  // GET 请求 < 500ms
  if (pm.request.method === "GET") {
    pm.expect(pm.response.responseTime).to.be.below(500);
  }
  // POST 请求 < 1000ms
  if (pm.request.method === "POST") {
    pm.expect(pm.response.responseTime).to.be.below(1000);
  }
});

// 响应体大小断言
pm.test("Response size is reasonable", () => {
  const sizeInKB = pm.response.responseSize / 1024;
  // 列表接口不应超过 500KB
  if (pm.request.url.toString().includes("list") || 
      pm.request.url.toString().includes("search")) {
    pm.expect(sizeInKB).to.be.below(500);
  }
});
```

## 五、Collection Runner 与数据驱动测试

### 5.1 CSV 数据驱动

```csv
email,password,expected_status,expected_message
admin@kkday.com,correct_pass,200,Login successful
admin@kkday.com,wrong_pass,401,Invalid credentials
,correct_pass,422,Email is required
invalid-email,correct_pass,422,Email must be a valid email
admin@kkday.com,,422,Password is required
```

在 Collection Runner 中选择 CSV 文件，每个请求会自动替换 `{{email}}`、`{{password}}` 等变量。

### 5.2 JSON 数据驱动

```json
[
  {
    "product_id": 1001,
    "quantity": 2,
    "expected_total": 598.00,
    "test_case": "正常购买"
  },
  {
    "product_id": 1001,
    "quantity": 0,
    "expected_status": 422,
    "test_case": "数量为零"
  },
  {
    "product_id": 99999,
    "quantity": 1,
    "expected_status": 404,
    "test_case": "商品不存在"
  }
]
```

```javascript
// 在 Tests 中引用数据文件
pm.test(`Test case: ${data.test_case}`, () => {
  if (data.expected_status) {
    pm.expect(pm.response.code).to.equal(data.expected_status);
  }
  if (data.expected_total) {
    pm.expect(pm.response.json().data.total).to.equal(data.expected_total);
  }
});
```

**踩坑 #5：数据文件编码问题**

在 Windows 上导出的 CSV 文件默认是 GBK 编码，Postman 只支持 UTF-8。中文注释会导致解析失败。解决：统一用 UTF-8 with BOM 编码保存。

## 六、Newman CLI：CI/CD 集成

### 6.1 Newman 基础用法

```bash
# 安装 Newman
npm install -g newman
npm install -g newman-reporter-html

# 运行 Collection
newman run ./postman/B2C-API.postman_collection.json \
  --environment ./postman/Staging.postman_environment.json \
  --iteration-data ./postman/test-data.csv \
  --reporters cli,html \
  --reporter-html-export ./reports/api-test-report.html \
  --timeout-request 10000 \
  --delay-request 100
```

### 6.2 GitHub Actions 集成

```yaml
# .github/workflows/api-tests.yml
name: API Integration Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Newman
        run: |
          npm install -g newman
          npm install -g newman-reporter-htmlextra

      - name: Run API Tests
        env:
          API_BASE_URL: ${{ secrets.API_STAGING_URL }}
          ADMIN_EMAIL: ${{ secrets.ADMIN_EMAIL }}
          ADMIN_PASSWORD: ${{ secrets.ADMIN_PASSWORD }}
        run: |
          newman run ./postman/B2C-API.postman_collection.json \
            --environment ./postman/Staging.postman_environment.json \
            --env-var "base_url=$API_BASE_URL" \
            --env-var "admin_email=$ADMIN_EMAIL" \
            --env-var "admin_password=$ADMIN_PASSWORD" \
            --reporters cli,htmlextra \
            --reporter-htmlextra-export ./reports/report.html \
            --reporter-htmlextra-title "B2C API Test Report" \
            --timeout-request 15000 \
            --suppress-exit-code

      - name: Upload Test Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: api-test-report
          path: ./reports/report.html

      - name: Comment PR with Results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            // 解析 Newman 摘要输出
            const summary = fs.readFileSync('./newman-summary.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## 🧪 API Test Results\n\n\`\`\`\n${summary}\n\`\`\``
            });
```

### 6.3 Jenkins Pipeline 集成

```groovy
// Jenkinsfile
pipeline {
    agent any
    
    environment {
        NEWMAN_REPORT_DIR = "${WORKSPACE}/newman-reports"
    }
    
    stages {
        stage('API Integration Tests') {
            steps {
                sh '''
                    mkdir -p ${NEWMAN_REPORT_DIR}
                    newman run postman/B2C-API.postman_collection.json \
                        -e postman/Staging.postman_environment.json \
                        --env-var "base_url=${API_STAGING_URL}" \
                        --reporters cli,junit \
                        --reporter-junit-export ${NEWMAN_REPORT_DIR}/results.xml \
                        --timeout-request 15000
                '''
            }
            post {
                always {
                    junit "${NEWMAN_REPORT_DIR}/results.xml"
                }
            }
        }
    }
}
```

**踩坑 #6：Newman 的 `--suppress-exit-code` 陷阱**

Newman 默认在测试失败时返回非零退出码，这会导致 CI 流水线失败。但如果你用了 `--suppress-exit-code`，**所有测试失败都不会阻断流水线**——这在某些场景下很危险。

正确做法：**不用 `--suppress-exit-code`**，让测试失败自然阻断流水线。如果某些测试允许失败，用 `pm.test` 的条件逻辑处理，而不是全局压制退出码。

## 七、实战踩坑汇总

| # | 踩坑场景 | 根因 | 解决方案 |
|---|---------|------|---------|
| 1 | Collection-Level 和 Request-Level 脚本互相覆盖 | Postman 脚本执行顺序理解错误 | 鉴权放 Collection 级别，业务断言放 Request 级别 |
| 2 | 变量取值不符合预期 | Collection 和 Environment 同名变量优先级冲突 | 统一命名规范：Collection 存模板，Environment 存数据 |
| 3 | 导出丢失 secret 变量 | Postman 默认不导出 secret 类型变量 | 导出时勾选 "Export with secrets" 或 CI 环境变量注入 |
| 4 | Token 刷新后仍用旧 Token | `pm.sendRequest` 异步未等待完成 | 放在 Collection 级别 Pre-request 中（Postman 会等待） |
| 5 | CSV 数据文件解析失败 | Windows GBK 编码 vs Postman UTF-8 要求 | 统一使用 UTF-8 with BOM 编码 |
| 6 | 测试失败被静默吞掉 | `--suppress-exit-code` 全局压制退出码 | 不使用该选项，用条件断言处理预期失败 |

## 八、最佳实践总结

1. **Collection 组织**：按业务模块分组，共享脚本放 Collection 级别
2. **环境管理**：至少分 Development / Staging / Production 三套，secret 变量用 CI 注入
3. **鉴权自动化**：Token 获取和刷新统一放在 Collection Pre-request Script
4. **断言设计**：结构验证 + Schema 验证 + 性能断言，三层保障
5. **数据驱动**：边界值、异常值用 CSV/JSON 数据文件驱动
6. **CI 集成**：Newman + Reporter，测试结果集成到 PR 评论和流水线报告

## 总结

Postman 远不止是一个 API 调试工具。通过合理使用 Collection 组织、Environment 管理、Pre-request Script 自动化、Tests 断言链路和 Newman CI 集成，它可以成为你 API 质量保障体系中**不可或缺的一环**。

关键认知转变：**从「手动发请求」到「自动化 API 契约验证」**。当你把 Postman 的 Collection 当成一份「活的 API 文档 + 自动化测试套件」来维护时，前后端联调效率和 API 质量都会有质的提升。

## 相关阅读

- [Postman/Apifox 实战：API 测试、Mock、自动化测试 — Laravel B2C API 踩坑记录](/engineering/postman-apifox-guide-apitesting-mock-automationtesting/)
- [Apifox 实战：API 设计、Mock、自动化测试一体化 — Laravel B2C API 踩坑记录](/engineering/apifox-guide-api-mock-automationtesting/)
- [Apifox vs Postman vs ApiPost vs Mockoon 四件套对比实战](/php/apifoxpostman-apipost-mockoonvs/)
- [OpenAPI-YAML 契约驱动：如何设计可测试可 Mock 的 Fake Response JSON](/architecture/openapi-yaml-testing-mock-fake-response-json/)
- [Pest PHP API 测试、Feature 测试、浏览器测试实战：Laravel 测试金字塔落地踩坑记录](/engineering/pest-php-apitesting-featuretesting-testingguide/)
- [API 契约测试实战：Pact/Schemathesis 前后端接口一致性保障](/engineering/2026-06-01-api-contract-testing-pact-schemathesis-frontend-backend-consistency/)
- [Snapshot Testing 实战：API 响应快照回归测试——用「拍快照」守护接口契约](/php/Laravel/2026-06-01-snapshot-testing-api-response-regression-testing/)
- [压测实战：k6/Locust/Laravel API 性能基线与瓶颈定位](/engineering/2026-06-01-load-testing-k6-locust-laravel-api-performance-baseline/)
- [API 生命周期管理实战：设计、版本控制、废弃通知、客户端迁移](/00_架构/API生命周期管理实战-设计版本控制废弃通知客户端迁移-Sunset-Header与Deprecation标准/)
