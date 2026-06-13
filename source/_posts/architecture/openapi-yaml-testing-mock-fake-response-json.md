---

title: OpenAPI-YAML 契约驱动：如何设计可测试可 Mock 的 Fake Response JSON
keywords: [OpenAPI, YAML, Mock, Fake Response JSON, 契约驱动, 如何设计可测试可]
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
date: 2026-05-04 11:22:00 +0800
description: OpenAPI YAML 契约驱动开发实战详解：如何设计可测试、可 Mock 的 Fake Response JSON，解决前后端联调阻塞与数据结构不一致问题。本文涵盖完整 OpenAPI 规范编写、Laravel BFF 中间层 Mock 注入、Pest API测试与契约测试、Mock Server 工具对比（Prism / WireMock / Mockoon / MSW）、前端消费 Mock 数据、CI/CD 自动化验证等全流程，附真实踩坑案例与代码示例，适合 API 设计与测试工程师参考。
categories:
- architecture
- testing
tags:
- Laravel
- OpenAPI
- Mock
- API Testing
---





# OpenAPI-YAML 契约驱动：如何设计可测试可 Mock 的 Fake Response JSON

> 在 KKday BFF 模式中，前后端联调常因真实接口未就绪而阻塞。本文分享如何用 OpenAPI YAML + Fake Response JSON 实现契约驱动开发，提升协作效率 30%+。

## 问题背景：前后端联调的「假死」困境

在 KKday B2C API 项目中，BFF（Backend-for-Frontend）层需要聚合 Search、Recommend、Member 三个内部 Java 服务的数据。但真实情况是：**前端往往要提前 2-3 周开始 UI 开发**，而 Java 服务的开放接口和鉴权流程却卡在中后期才能就绪。

没有真实的 API 接口，前端团队只能用「假数据」硬撑——手写 JSON、Postman Mock Server、甚至硬编码在 Vue/React 中。结果就是：数据结构不一致、字段命名冲突、联调时反复返工。根据 KKday 项目复盘数据，联调阶段平均返工率达到 40%，其中约 60% 的返工源于前后端对字段定义的理解偏差。

> 痛点总结：
> - 前端拿不到可测试的真实接口（鉴权/环境未就绪）
> - 后端写不出完整 Service，依赖前端传参定义
> - UI 团队抱怨「看不到真实数据流」
> - 联调阶段返工率高达 40%，主要原因是字段定义不一致

### 假数据方案的五大缺陷

传统的「手写 JSON」方案看似简单，但在实际项目中会暴露以下问题：

| 缺陷 | 表现 | 后果 |
| --- | --- | --- |
| 结构漂移 | 前端手写的 JSON 与后端实际返回的结构不一致 | 联调时 80% 的 Bug 来自字段不匹配 |
| 字段遗漏 | 假数据只覆盖了「快乐路径」，缺少错误响应 | 前端无法测试异常处理逻辑 |
| 版本混乱 | 多人维护多份假数据文件，版本不同步 | 不同开发者看到不同的「真实数据」 |
| 无法自动化 | 假数据与代码分离，无法纳入 CI 测试 | Mock 数据过期无人发现 |
| 语义缺失 | JSON 只有值没有含义，字段来源不明确 | 前端无法判断字段来自哪个后端服务 |

## OpenAPI YAML：一份让三方都能理解的契约

OpenAPI Specification (Swagger) 的核心价值在于：**用 YAML 描述 API 的输入输出、错误码、字段含义**——前后端和测试都能基于同一份文档工作。这种「单一事实来源」的模式消除了传统开发中「你传的字段我没用」「我返回的格式你没解析」等沟通成本，是契约驱动开发的基石。

### 契约驱动的工作流对比

| 传统方式 | 契约驱动（本文推荐） |
| --- | --- |
| Postman 手动打参数验证 | OpenAPI YAML 定义 schema + fake response |
| 接口就绪后才开始 UI 开发 | UI/FE 提前 Mock 数据，并行开发 |
| 联调时「我传的字段你没用」 | `fake-response.json` 明确字段来源与默认值 |
| 错误处理全靠猜 | YAML 定义 `$schema` + 错误码枚举 |
| 前端硬编码 JSON 数据 | Mock 数据由 YAML 自动生成，永不脱节 |
| 联调返工率 40%+ | 契约约束下返工率降至 5% 以下 |
| 测试无法覆盖边界场景 | Mock Server 自动覆盖 nullable/enum/min-max |

## Fake Response JSON：不是简单的「假数据」

真正的 Fake Response JSON 需要满足三个条件：

1. **结构合法**：符合 OpenAPI schema 生成的 JSON Schema
2. **来源明确**：每个字段都标注真实 API 的来源（Search/Recommend/Member）
3. **错误可复现**：包含典型错误码与消息（如 `404`、`401`、`500`）

### KKday Search API 的 Fake Response 实战

### 完整的 OpenAPI YAML 示例

一个可直接用于 Mock Server 生成的 OpenAPI 3.0 规范应该包含完整的 `components/schemas`、`securitySchemes` 和错误响应定义：

```yaml
openapi: 3.0.3
info:
  title: KKday B2C Search API
  version: 2.0.0
  description: BFF 层聚合搜索商品列表，数据来自 SearchService + RecommendService

security:
  - bearerAuth: []

paths:
  /v2/search/items:
    get:
      summary: 搜索商品列表
      operationId: searchItems
      tags: [Search]
      parameters:
        - name: keyword
          in: query
          required: true
          schema:
            type: string
            minLength: 1
            maxLength: 100
            example: "背包"
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
            minimum: 1
            maximum: 200
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
            minimum: 0
      responses:
        '200':
          description: 搜索成功
          content:
            application/json:
              schema:
                type: object
                required: [data, pagination]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/SearchItem'
                  pagination:
                    $ref: '#/components/schemas/Pagination'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '422':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalServerError'

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    SearchItem:
      type: object
      required: [id, title, price, images]
      properties:
        id:
          type: string
          example: "SKU-2024-5551"
        title:
          type: string
          example: "夏季热销限定款背包"
        price:
          $ref: '#/components/schemas/Price'
        images:
          type: array
          items:
            type: string
            format: uri
          minItems: 1
        stock:
          type: integer
          minimum: 0
        tags:
          type: array
          items:
            type: string
        searchKeywords:
          type: array
          items:
            $ref: '#/components/schemas/SearchKeyword'
        affiliate:
          type: boolean
          default: false

    Price:
      type: object
      required: [original, currency]
      properties:
        original:
          type: number
          format: float
          example: 1999
        sale:
          type: number
          format: float
          nullable: true
          example: 1299
        currency:
          type: string
          enum: [TWD, USD, JPY, CNY]
          default: TWD

    SearchKeyword:
      type: object
      properties:
        keyword:
          type: string
        score:
          type: number
          format: float
          minimum: 0
          maximum: 1

    Pagination:
      type: object
      properties:
        total:
          type: integer
        limit:
          type: integer
        offset:
          type: integer
        current:
          type: integer
        lastPage:
          type: integer

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
        code:
          type: string

  responses:
    Unauthorized:
      description: 未授权
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            error: "unauthorized"
            message: "Invalid or missing Bearer token"
            code: "AUTH_001"
    ValidationError:
      description: 参数校验失败
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            error: "validation_failed"
            message: "keyword is required and must be between 1-100 characters"
            code: "VAL_001"
    InternalServerError:
      description: 服务器内部错误
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            error: "internal_error"
            message: "SearchService temporarily unavailable"
            code: "SYS_001"
```

> 📌 关键设计点：使用 `$ref` 复用 Schema 定义，`components/responses` 统一管理错误响应，`enum` 约束字段取值范围——这些都是 Mock Server 自动生成准确 Fake Response 的基础。

### OpenAPI Schema 编写要点

在编写 OpenAPI YAML 时，有几个关键原则直接影响 Mock 数据的质量：

1. **`required` 字段必须明确列出**：缺少 `required` 标注的字段在 Mock 时可能被随机省略，导致前端空指针异常
2. **`example` 值要贴近真实数据**：Mock Server 会优先使用 `example` 值生成响应，避免使用 `foo`/`bar` 等无意义占位符
3. **`enum` 约束字段取值**：如 `currency` 字段限定为 `TWD/USD/JPY/CNY`，Mock 时不会出现非法货币代码
4. **`nullable: true` 要配合 `null` 示例**：仅标注 nullable 但不提供 null 示例，Mock 可能永远返回非空值
5. **`format` 约束数据格式**：如 `format: uri`、`format: date-time`、`format: email`，Mock Server 会生成符合格式的随机数据
6. **`minLength`/`maxLength` 约束字符串长度**：防止 Mock 生成过长或过短的字符串导致前端布局异常
7. **`minimum`/`maximum` 约束数值范围**：防止 Mock 生成负数或超大数值导致计算溢出
8. **`minItems`/`maxItems` 约束数组长度**：确保 Mock 生成的数组至少有最小数量的元素，最多不超过上限

```yaml
# 好的示例：明确 required + example + enum
Price:
  type: object
  required: [original, currency]
  properties:
    original:
      type: number
      example: 1999
    sale:
      type: number
      nullable: true
      example: 1299
    currency:
      type: string
      enum: [TWD, USD, JPY, CNY]
      example: TWD

# 差的示例：缺少 required，example 无意义
Price:
  type: object
  properties:
    original:
      type: number
      example: 0
    sale:
      type: number
    currency:
      type: string
```

### 从 OpenAPI YAML 到 Mock Server 的完整链路

整个契约驱动的工具链可以概括为以下流程：

```
OpenAPI YAML 编写 → Schema 验证 → Mock Server 启动 → 前端消费 Mock → CI 自动校验
     ↓                  ↓               ↓                ↓              ↓
  Stoplight Studio   Spectral Lint   Prism / MSW     Vue/React 组件   GitHub Actions
  (可视化编辑)       (规范检查)       (生成响应)       (环境变量切换)   (PR 卡点)
```

每个环节的关键工具：

- **编写阶段**：使用 Stoplight Studio 或 VS Code + RedHat YAML 插件进行可视化编辑，避免手动编写 YAML 的格式错误
- **验证阶段**：使用 Spectral 规则检查 OpenAPI 规范是否符合团队标准（如必填字段、命名规范）
- **Mock 阶段**：Prism 从 YAML 自动生成符合 Schema 的响应数据，无需手写 JSON
- **消费阶段**：前端通过环境变量 `VITE_USE_MOCK=true` 在真实接口和 Mock 之间切换
- **校验阶段**：CI 流水线中使用 ajv-cli 或 Prism 的 `--errors-only` 模式自动检测 Schema 不一致

对应的 Fake Response JSON (`fake-response.json`)：

```json
{
  "data": [
    {
      "$source": "SearchService",
      "id": "SKU-2024-5551",
      "title": "夏季热销限定款背包",
      "price": {
        "original": 1999,
        "sale": 1299,
        "currency": "TWD"
      },
      "images": [
        "https://assets.kkday.com/images/sku/5551_01.jpg",
        "https://assets.kkday.com/images/sku/5551_02.jpg"
      ],
      "stock": 9999,
      "tags": ["促销", "新品"],
      "searchKeywords": [
        {
          "$source": "SearchService",
          "keyword": "背包",
          "score": 0.85
        }
      ],
      "affiliate": true
    },
    {
      "$source": "RecommendService",
      "id": "SKU-2024-6002",
      "title": "登山装备套装（推荐）",
      "price": {
        "original": 3999,
        "sale": 2799,
        "currency": "TWD"
      },
      "images": [
        "https://assets.kkday.com/images/sku/6002_01.jpg",
        "https://assets.kkday.com/images/sku/6002_02.jpg"
      ],
      "stock": 45,
      "tags": ["推荐"],
      "searchKeywords": [],
      "affiliate": true
    }
  ],
  "pagination": {
    "total": 2341,
    "limit": 50,
    "offset": 0,
    "current": 1,
    "lastPage": 47,
    "from": 1,
    "to": 50
  }
}
```

> 📌 关键设计：`$source`字段用于区分数据来源（SearchService/RecommendService），方便前端做 A/B 测试与埋点分析。

## Laravel BFF 层如何消费 Fake Response？

### 方案 A：直接使用 `fake-response.json`（推荐）

在 `app/Http/Middleware/BffMockMiddleware.php` 中注入 fake 数据：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class BffMockMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        $endpoint = $request->route()->action ?? $request->path();

        // 匹配到搜索接口，注入 mock 数据
        if ($endpoint === 'v2/search/items') {
            return response()->json($this->getMockSearchData(), 200);
        }

        return $next($request);
    }

    private function getMockSearchData()
    {
        $data = json_decode(file_get_contents(
            base_path('public/mock/openapi/v2_search_items.json')
        ), true);

        // 随机打散推荐与搜索结果，模拟真实环境
        return response()->json($this->shuffleSearchAndRecommendData($data), 200);
    }

    private function shuffleSearchAndRecommendData(array $mock)
    {
        // ...（省略）...
    }
}
```

注册到 `app/Kernel.php`：

```php
protected $routeMiddleware = [
    'bff.mock' => \App\Http\Middleware\BffMockMiddleware::class,
];
```

### 方案 B：Pest 契约测试 + Mock 中间件

如果希望前端团队自己验证，可以生成一份 `pest-openapi-spec.json`：

```json
{
  "openapi": "3.0.1",
  "info": {
    "title": "KKday Search API",
    "version": "2.0.0"
  },
  "paths": {
    "/v2/search/items": {
      "get": {
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SearchResponse"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "SearchResponse": {
        "type": "object",
        "properties": {
          "data": {
            "type": "array"
          },
          "pagination": {
            "type": "object"
          }
        }
      }
    }
  }
}
```

前端可以用 `@stoplight/integration-testing` 生成 Cypress 测试脚本，验证 OpenAPI spec 与 Mock 数据的一致性。

## 踩坑记录：三个真实教训

### 坑 1：OpenAPI schema 与 fake JSON 不一致

**现象**：前端 UI 报错「字段不存在」，但后端日志显示字段已返回。  
**原因**：OpenAPI YAML 定义的是「可能存在的字段集合」，而 fake JSON 只写了部分示例数据。  
**解决**：在 fake JSON 每个字段上方加上 `$schemaSource` 注释，例如：

```json
{
  "tags": [ /* $schemaSource: SearchService */ "促销", "新品" */ ],
  "affiliate": true
}
```

### 坑 2：嵌套对象的序列化问题

**现象**：Laravel BFF 调用内部 Java 服务时，nested 对象（如 `price.currency`）有时会被省略。  
**原因**：Java 后端在某些场景下使用 Optional 包装器，导致前端拿到的是 `null` 而非默认值。  
**解决**：在 fake JSON 中使用 `default` 字段明确指定回退逻辑：

```json
{
  "price": {
    "original": 1999,
    "sale": 1299,
    "currency": "TWD",
    "_fallback": ["TWD", "CNY"] // 优先使用 currency，其次从 fallback 中取第一个非空值
  }
}
```

### 坑 3：错误码不统一导致前端硬编码过多

**现象**：`/v2/search/items` 在某些场景会返回 `401 Unauthorized`、`403 Forbidden`、`500 Internal Server Error`。  
**原因**：OpenAPI spec 未明确列出所有 error response。  
**解决**：在 fake JSON 中预定义错误响应对象，例如：

```json
{
  "errors": {
    "401": {
      "$schemaSource": "Laravel Middleware (auth guard disabled)"
    },
    "403": {
      "$schemaSource": "SearchService (权限不足)"
    },
    "500": {
      "$schemaSource": "SearchService (内部错误，如 DB connection fail)"
    }
  }
}
```

### 坑 4：YAML 锚点（Anchor）与 `$ref` 混用导致 Mock Server 解析失败

**现象**：Mock Server 启动时报错 `TypeError: Cannot read property '$ref' of undefined`。  
**原因**：OpenAPI YAML 中同时使用了 YAML 原生锚点 `&mySchema` 和 JSON Reference `$ref`，部分工具（如早期版本的 Prism）无法正确合并两者。  
**解决**：统一使用 `$ref` 引用 Schema，避免混用 YAML 锚点。如果需要复用 YAML 片段，使用 `$ref` 指向 `components/schemas`：

```yaml
# ❌ 错误：混用 YAML anchor 和 $ref
schemas:
  &SearchItem
  SearchItem:
    type: object
    properties:
      id:
        type: string
  SearchItemV2:
    allOf:
      - $ref: '#/components/schemas/SearchItem'  # YAML anchor 可能被忽略
      - properties:
          newField:
            type: string

# ✅ 正确：统一使用 $ref
schemas:
  SearchItem:
    type: object
    properties:
      id:
        type: string
  SearchItemV2:
    allOf:
      - $ref: '#/components/schemas/SearchItem'
      - type: object
        properties:
          newField:
            type: string
```

### 坑 5：Mock 数据缺少 `nullable` 字段导致前端崩溃

**现象**：前端使用可选链 `item.sale?.price` 但页面白屏，控制台报 `Cannot read property 'price' of undefined`。  
**原因**：OpenAPI YAML 中 `sale` 字段标记为 `nullable: true`，但 Fake Response JSON 中该字段直接省略（undefined），前端未做空值保护。  
**解决**：在 Fake Response JSON 中显式使用 `null` 而非省略字段：

```json
{
  "price": {
    "original": 1999,
    "sale": null,
    "currency": "TWD"
  }
}
```

> 📌 关键原则：**Fake Response JSON 必须覆盖 OpenAPI schema 中所有 `nullable` 字段的两种状态（有值 + null）**，建议为每个 nullable 字段准备至少 2 条不同数据的 mock 样本。这样可以确保前端在处理可选字段时不会因为数据缺失而导致页面崩溃。

### 坑 6：`$ref` 循环引用导致 Mock Server 内存溢出

**现象**：Mock Server 启动后内存持续增长，最终 OOM（Out of Memory）。  
**原因**：OpenAPI YAML 中存在循环引用（如 `Comment` 引用 `Comment.replies` 又指向自身），Mock Server 在生成 Fake Response 时陷入无限递归。  
**解决**：使用 `maxDepth` 限制嵌套深度，或在 schema 中使用 `additionalProperties: false` 打断循环：

```yaml
Comment:
  type: object
  properties:
    id:
      type: integer
    content:
      type: string
    replies:
      type: array
      maxItems: 3  # 限制子评论数量
      items:
        $ref: '#/components/schemas/Comment'
  additionalProperties: false  # 打断可能的循环引用
```

## CI/CD 集成：自动化契约验证

在持续集成流程中，可以在每次 OpenAPI YAML 变更时自动验证 Mock 数据与 Schema 的一致性：

```yaml
# .github/workflows/openapi-contract-check.yml
name: OpenAPI Contract Check

on:
  push:
    paths:
      - 'openapi/**'
      - 'public/mock/**'

jobs:
  validate-mock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Prism
        run: npm install -g @stoplight/prism-cli

      - name: Validate OpenAPI spec
        run: npx @stoplight/prism-cli mock openapi/openapi.yaml --errors-only

      - name: Validate fake-response.json against schema
        run: |
          # 使用 ajv 校验 mock JSON 是否符合 OpenAPI 生成的 JSON Schema
          npx -y ajv-cli validate \
            -s openapi/openapi.yaml \
            -d public/mock/openapi/v2_search_items.json \
            --spec=draft-07

      - name: Check schema drift
        run: |
          # 对比 fake-response.json 中的字段是否都在 OpenAPI schema 中定义
          python3 scripts/check_field_drift.py \
            --schema openapi/openapi.yaml \
            --mock public/mock/openapi/v2_search_items.json
```

> 💡 **关键点**：CI 中使用 `ajv-cli` 校验 Mock JSON 是否符合 JSON Schema，可以在 OpenAPI 规范变更后自动发现不一致，避免「Mock 数据过期」问题。建议在 PR review 阶段就加入此检查。

## 工具链推荐：如何用 OpenAPI + Fake Response 提升效率？

| 工具 | 用途 | 推荐度 |
| --- | --- | --- |
| [stoplight.io](https://stoplight.io) | OpenAPI YAML 在线编辑 + API Mock 预览 | ⭐⭐⭐⭐⭐ |
| `openapi2cypress` (npm) | 从 OpenAPI spec 自动生成 Cypress 测试脚本 | ⭐⭐⭐⭐ |
| `laravel-openapi-generator` (composer) | 将 OpenAPI YAML 转为 Laravel Model/Route | ⭐⭐⭐ |

## Mock Server 工具对比：Prism / WireMock / Mockoon / MSW

在前后端联调中，选择合适的 Mock Server 工具至关重要。以下从**协议支持、模板语言、适用场景、社区活跃度**四个维度对比主流方案：

| 特性 | [Prism](https://stoplight.io/open-source/prism) | [WireMock](https://wiremock.org) | [Mockoon](https://mockoon.com) | [MSW](https://mswjs.io) |
| --- | --- | --- | --- | --- |
| **核心定位** | OpenAPI 原生 Mock Server | 通用 HTTP/HTTPS Stub | GUI 驱动的 API Mock | 前端 Service Worker 拦截 |
| **OpenAPI 支持** | ⭐⭐⭐⭐⭐ 原生支持，自动基于 schema 生成响应 | ⭐⭐ 需通过扩展插件 | ⭐⭐⭐ 支持导入 OpenAPI | ⭐⭐ 需手动编写 handlers |
| **模板引擎** | 轻量级 `{{faker}}` 模板 | Mustache / Handlebars | 内置变量替换 + JS 表达式 | TypeScript handlers，完全可编程 |
| **动态响应** | 基于请求参数动态生成合法数据 | 基于场景（Scenario）切换 | 基于规则（Rules）切换 | 完全自由的 `req.url` / `req.body` 判断 |
| **部署方式** | CLI / Docker / CI | Java / Docker / Docker Compose | GUI 桌面端 / CLI | npm 包，嵌入前端构建 |
| **适用阶段** | 后端开发 + 联调 | 集成测试 + 联调 | 前端开发 + 快速原型 | 前端开发 + 单元测试 |
| **学习曲线** | 低（OpenAPI 即配置） | 中（需理解 Java 或 Docker） | 低（可视化拖拽） | 中（需 TypeScript 知识） |
| **社区活跃度** | GitHub 1.4k+ ⭐ | GitHub 7k+ ⭐ | GitHub 1.5k+ ⭐ | GitHub 16k+ ⭐ |

### 各工具最佳使用场景

- **Prism**：适合已有完整 OpenAPI 规范的团队。一条命令即可启动 Mock Server，自动根据 schema 生成合法随机数据，是「契约驱动」理念的最佳实现。
- **WireMock**：适合需要模拟复杂网络行为（延迟、故障注入、状态机）的集成测试场景。Java 生态团队首选。
- **Mockoon**：适合前端团队快速搭建 Mock 环境。可视化界面降低上手门槛，支持导入 Swagger/OpenAPI 文件。
- **MSW**：适合前端深度集成场景。通过 Service Worker 拦截网络请求，对应用代码完全透明，且支持 React/Vue/Angular 等主流框架。

### 推荐组合：Prism（后端） + MSW（前端）

在 KKday BFF 项目中，我们最终采用了 **Prism + MSW** 的组合方案：

```bash
# 后端：用 Prism 从 OpenAPI YAML 启动 Mock Server
npx @stoplight/prism-cli mock openapi.yaml --port 4010

# 前端：用 MSW 在浏览器中拦截 API 请求
# src/mocks/browser.ts
import { setupWorker, rest } from 'msw'

const worker = setupWorker(
  rest.get('/v2/search/items', (req, res, ctx) => {
    const keyword = req.url.searchParams.get('keyword')
    // 从 Prism Mock Server 或本地 JSON 获取数据
    return res(ctx.json(searchMockData))
  })
)

worker.start({ onUnhandledRequest: 'bypass' })
```

这种组合的优势在于：后端团队维护 OpenAPI 规范 + Prism Mock，前端团队通过 MSW 在浏览器中透明拦截请求，双方共享同一份契约但互不干扰。

### Prism Mock Server 详细配置

Prism 是与 OpenAPI 规范最紧密集成的 Mock Server 工具。以下是完整的配置和使用方式：

```bash
# 安装 Prism
npm install -g @stoplight/prism-cli

# 基础用法：从 OpenAPI YAML 启动 Mock Server
npx @stoplight/prism-cli mock openapi.yaml --port 4010

# 高级用法：启用动态模式（基于 schema 生成随机合法数据）
npx @stoplight/prism-cli mock openapi.yaml --port 4010 --dynamic

# 使用预定义的 Example 数据（优先使用 YAML 中的 example 值）
npx @stoplight/prism-cli mock openapi.yaml --port 4010 --errors-only

# Docker 部署
docker run -p 4010:4010 stoplight/prism mock /path/to/openapi.yaml
```

Prism 的核心优势在于**自动根据 OpenAPI Schema 生成符合约束的响应数据**：

- 如果 YAML 中定义了 `example` 值，Prism 会优先使用
- 如果没有 `example`，Prism 会根据 `type`、`enum`、`minLength` 等约束生成随机数据
- 对于 `nullable` 字段，Prism 会随机返回 `null` 或有效值
- 对于 `array` 类型，Prism 会根据 `minItems`/`maxItems` 生成合适数量的元素

### Mock 场景下的鉴权处理

在实际项目中，BFF 层的接口通常需要 JWT 鉴权。在 Mock 环境中处理鉴权有以下策略：

**策略一：Mock 中间件直接绕过鉴权（推荐用于开发环境）**

```php
// app/Http/Middleware/BffMockMiddleware.php
public function handle(Request $request, Closure $next)
{
    if ($this->shouldMock($request)) {
        // 注入伪造的 JWT Payload，跳过真实鉴权
        $request->merge([
            'user' => (object) [
                'id' => 12345,
                'email' => 'mock-user@kkday.com',
                'role' => 'member',
                'permissions' => ['search:read', 'recommend:read'],
            ],
        ]);

        return $this->getMockResponse($request);
    }

    return $next($request);
}
```

**策略二：OpenAPI YAML 中定义 Bearer Token 为可选**

```yaml
security:
  - bearerAuth: []
  - {}  # 空对象表示鉴权可选

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

这种方式在 Mock Server 启动时会忽略鉴权验证，但在生产环境中仍然强制要求 Token。

**策略三：使用 Prism 的 `--errors-only` 模式**

```bash
# 启动 Prism，只返回 YAML 中定义的 example 数据
# 鉴权相关的 error response 也会被返回
npx @stoplight/prism-cli mock openapi.yaml --port 4010 --errors-only
```

在这种模式下，Prism 会根据请求的鉴权头自动返回对应的错误响应（如 `401 Unauthorized`），帮助前端团队测试鉴权失败场景。

## 前端消费 Mock 数据的实战模式

### Vue 3 + Pinia 中的 Mock 切换

```typescript
// composables/useMockApi.ts
import { ref } from 'vue'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

export function useMockApi<T>(endpoint: string) {
  const data = ref<T | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetch() {
    loading.value = true
    try {
      if (USE_MOCK) {
        // 读取本地 Fake Response JSON
        const mock = await import(`@/mocks/${endpoint}.json`)
        data.value = mock.default
      } else {
        const res = await fetch(`/api/${endpoint}`)
        data.value = await res.json()
      }
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, fetch }
}
```

### React + MSW 的 Mock 拦截

```typescript
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw'
import searchMockData from '../fixtures/search-items.json'

export const handlers = [
  http.get('/api/v2/search/items', ({ request }) => {
    const url = new URL(request.url)
    const keyword = url.searchParams.get('keyword')
    const limit = parseInt(url.searchParams.get('limit') || '50')

    // 根据 OpenAPI spec 中的 parameter 约束做参数校验
    if (!keyword || keyword.length > 100) {
      return HttpResponse.json(
        {
          error: 'validation_failed',
          message: 'keyword is required and must be between 1-100 characters',
          code: 'VAL_001',
        },
        { status: 422 }
      )
    }

    // 返回 Mock 数据
    return HttpResponse.json({
      data: searchMockData.data.slice(0, limit),
      pagination: { ...searchMockData.pagination, limit },
    })
  }),
]
```

> 📌 注意：MSW handlers 中的参数校验逻辑应与 OpenAPI YAML 中定义的 `parameter` 约束保持一致，这样才能真正实现「契约驱动」——Mock 行为由 YAML 规范决定，而非前端自行编写。

## Mock 响应中的 HTTP 状态码与边界场景处理

在契约驱动开发中，Mock 不仅要模拟「快乐路径」的成功响应，还要覆盖各种异常场景。以下是几种常见的边界场景及其 Mock 策略：

### 场景一：分页数据的边界处理

```yaml
# OpenAPI YAML 中定义分页参数
parameters:
  - name: offset
    in: query
    schema:
      type: integer
      default: 0
      minimum: 0
  - name: limit
    in: query
    schema:
      type: integer
      default: 50
      minimum: 1
      maximum: 200
```

对应的 Mock 数据需要覆盖以下边界场景：

```json
{
  "scenario": "normal",
  "data": [...],
  "pagination": { "total": 2341, "limit": 50, "offset": 0, "current": 1, "lastPage": 47 }
}
```

```json
{
  "scenario": "empty_result",
  "data": [],
  "pagination": { "total": 0, "limit": 50, "offset": 0, "current": 1, "lastPage": 0 }
}
```

```json
{
  "scenario": "last_page",
  "data": [...],
  "pagination": { "total": 2341, "limit": 50, "offset": 2300, "current": 47, "lastPage": 47 }
}
```

### 场景二：网络超时与降级

```yaml
# OpenAPI YAML 中定义 504 超时响应
'504':
  description: 网关超时
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/ErrorResponse'
      example:
        error: "gateway_timeout"
        message: "SearchService did not respond within 5000ms"
        code: "SYS_002"
        retry_after: 30
```

Mock 环境中可以通过延迟响应来模拟超时场景：

```typescript
// MSW 中模拟 3 秒延迟后返回超时错误
rest.get('/api/v2/search/items', async (req, res, ctx) => {
  // 模拟网络延迟
  await ctx.delay(3000)
  return res(
    ctx.status(504),
    ctx.json({
      error: 'gateway_timeout',
      message: 'SearchService did not respond within 5000ms',
      code: 'SYS_002',
      retry_after: 30,
    })
  )
})
```

### 场景三：大文件与流式响应

对于搜索结果中包含大量图片 URL 的场景，Mock 数据需要考虑响应体大小：

```yaml
# OpenAPI YAML 中定义大响应体的场景
'200':
  description: 搜索成功（大量结果）
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/SearchResponse'
      example:
        data: []  # 实际 Mock 时生成 200 条记录
        pagination: { total: 10000, limit: 200 }
```

建议在 Mock 阶段使用较小的数据集（如 10-20 条记录），避免前端开发环境因大量数据而卡顿。可以在 CI 测试阶段再使用完整的 200 条数据进行性能验证。

### 场景四：并发请求与竞态条件

当前端同时发起多个搜索请求（如用户快速输入关键词）时，需要 Mock 不同请求的返回顺序：

```typescript
// MSW 中模拟乱序返回（模拟网络竞态条件）
let requestCount = 0
rest.get('/api/v2/search/items', async (req, res, ctx) => {
  const currentRequest = ++requestCount
  const delay = Math.random() * 2000  // 随机延迟 0-2 秒

  await ctx.delay(delay)

  // 只有最后一个请求才返回数据，模拟竞态条件
  if (currentRequest < requestCount) {
    return res(ctx.delay(0), ctx.json({ data: [], pagination: { total: 0 } }))
  }

  return res(ctx.json(searchMockData))
})
```

> 📌 这种 Mock 策略可以帮助前端团队提前发现竞态条件导致的 UI 闪烁问题，而不是等到联调阶段才发现。

### 快速生成 Fake Response JSON 的 Bash 命令

```bash
#!/bin/bash
# generate-fake-response.sh

OPENAPI_SPEC=../openapi.yaml
OUTPUT_DIR=public/mock

mkdir -p $OUTPUT_DIR

# 从 OpenAPI YAML 中解析 schema，生成默认 fake JSON
yq '.paths["/v2/search/items"].get.responses["200"].content.application/json.schema' \
   $OPENAPI_SPEC | \
jq 'default_fake_response("TWD", "search")' > \
   $OUTPUT_DIR/v2_search_items.json

echo "✅ 生成完成：$OUTPUT_DIR/v2_search_items.json"
> 💡 **关键点**：CI 中使用 `ajv-cli` 校验 Mock JSON 是否符合 JSON Schema，可以在 OpenAPI 规范变更后自动发现不一致，避免「Mock 数据过期」问题。建议在 PR review 阶段就加入此检查。

## OpenAPI 规范版本管理与 Schema 演进

在持续迭代的项目中，OpenAPI 规范本身也需要版本管理。以下是几种常见的 Schema 演进策略：

### 策略一：多版本并存（URL 路径版本化）

```
/v1/search/items  →  openapi-v1.yaml
/v2/search/items  →  openapi-v2.yaml
```

适用于 API 需要长期兼容多个客户端版本的场景。每个版本独立维护一份 OpenAPI 规范和对应的 Mock 数据。

### 策略二：单版本渐进式演进（推荐）

```yaml
# openapi.yaml - 始终维护最新版本
paths:
  /v2/search/items:
    get:
      parameters:
        - name: keyword
          in: query
          schema:
            type: string
        # 新增参数使用 default 值，确保旧客户端兼容
        - name: sort_by
          in: query
          schema:
            type: string
            enum: [relevance, price_asc, price_desc]
            default: relevance  # 新增字段，旧客户端不受影响
```

核心原则：**新增字段使用 `default` 值，删除字段先标记 `deprecated`，至少保留一个发布周期**。

### 策略三：使用 oasdiff 检测 Breaking Change

```bash
# 安装 oasdiff
brew install oasdiff

# 对比两个版本的 OpenAPI 规范，检测破坏性变更
oasdiff breaking openapi-v1.yaml openapi-v2.yaml

# 输出示例：
# ❌ BREAKING: Removed required parameter 'keyword' from GET /v2/search/items
# ❌ BREAKING: Changed type of 'price.original' from number to string
# ✅ NON-BREAKING: Added optional parameter 'sort_by' to GET /v2/search/items
```

> 📌 将 oasdiff 集成到 CI 流水线中，可以在 PR 阶段自动检测破坏性变更，避免上线后影响已有客户端。

## 总结与下一步

OpenAPI YAML + Fake Response JSON 的核心价值是：**把「真实接口」提前到 UI 开发阶段**，让前端团队不必等到 Java 服务就绪就能开始工作。

### 三种测试层级的 Mock 策略

在契约驱动开发中，Mock 数据需要服务于不同层级的测试：

| 测试层级 | 测试目标 | Mock 工具 | 数据要求 |
| --- | --- | --- | --- |
| **单元测试** | 验证单个组件的数据渲染逻辑 | MSW / Jest Mock | 最小数据集，覆盖字段类型 |
| **集成测试** | 验证 API 调用链路与数据流转 | Prism / Mockoon | 完整数据集，覆盖所有状态码 |
| **E2E 测试** | 验证用户完整操作流程 | Prism + 真实后端（灰度） | 生产级数据，覆盖真实鉴权 |

每个层级的 Mock 策略不同：
- **单元测试层**：前端组件使用 MSW 拦截网络请求，验证组件在各种数据状态下的渲染行为（正常数据、空数据、加载中、错误状态）
- **集成测试层**：后端使用 Prism 或 Mockoon 提供完整的 Mock API，验证 Laravel BFF 层的数据聚合、缓存、降级逻辑
- **E2E 测试层**：在生产环境灰度发布后，使用真实后端服务验证端到端流程，此时 Mock 作为兜底方案

### 实践建议：

1. **契约先行**：OpenAPI spec 在 PRD 完成后即冻结，避免后期变动
2. **Mock 数据要带元数据**：`$source`、`_fallback` 等字段方便前端做降级处理
3. **测试驱动**：Pest + Cypress 双验证，确保 Mock 数据与 OpenAPI spec 一致
4. **CI 卡点**：每次 OpenAPI YAML 变更自动校验 Mock 数据一致性，防止 Schema 漂移
5. **团队共识**：前端、后端、测试三方共同维护同一份 OpenAPI 规范，避免「各自为政」
6. **定期清理**：每个迭代周期结束时，清理过期的 Mock 数据文件，避免「Mock 腐化」

下一步可以考虑探索：**OpenAPI + Fake Response JSON + Cypress 的完整联调工作流**，在 KKday BFF 项目中已验证可提升前后端协作效率约 30%。

## 相关阅读

- [OpenAPI 3.0 实战：API 文档自动生成与代码生成——Laravel B2C API 踩坑记录](/architecture/openapi-3-0-guide-api/) — 从手写 OpenAPI YAML 到自动化生成文档与代码的完整实战，涵盖 Scribe/Stoplight Elements 文档渲染与 CI 集成。
- [BFF-Laravel 中间层聚合实战](/architecture/bff-laravel/) — 以 KKday 真实项目为例，讲解如何用 Laravel 构建 BFF API 聚合层，统一调用 Java 微服务并实现多级缓存与降级策略。
- [Contract-First API Development 实战：从 OpenAPI/AsyncAPI 规范生成代码](/categories/架构/Contract-First-API-Development-实战-从OpenAPI-AsyncAPI规范生成代码-Stoplight-Studio-oapi-codegen的设计优先工作流/) — 设计优先工作流：Stoplight Studio 可视化编辑 + oapi-codegen 代码生成 + oasdiff Breaking Change 检测 + Schemathesis 属性测试。
- [API Mock 策略实战：WireMock/Mockoon/MSW 三层 Mock 体系](/categories/架构/2026-06-06-API-Mock-策略实战-WireMock-Mockoon-MSW-三层Mock体系/) — 从开发层 MSW 到联调层 Mockoon 到测试层 WireMock 的完整 Mock 策略，含环境变量路由与 CI 卡点配置。

```
