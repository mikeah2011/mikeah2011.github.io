---

title: Laravel API 文档即代码实战：Scribe + OpenAPI + Postman Collection 三同步
keywords: [Laravel API, Scribe, OpenAPI, Postman Collection, 文档即代码实战, 三同步, PHP]
date: 2026-06-10 02:24:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Laravel
- API
- Scribe
- OpenAPI
- Postman
- 自动化
description: 用 Scribe + OpenAPI + Postman Collection 实现「写一次注解，三端同步」的 API 文档工作流，彻底告别手工维护文档的痛苦。
---



## 概述

写 API 文档是每个后端开发者的噩梦。代码改了文档没改，前端拿着过时的文档调试半天，最后发现参数名都对不上。

传统方案有三条路：

1. **手工维护 Swagger UI** — 代码和文档分离，永远不同步
2. **Postman 手动录入** — 接口多了维护成本爆炸
3. **Swagger/OpenAPI 注解** — 写注解本身就累，而且和文档生成工具耦合

本文要解决的问题是：**能不能只写一份注解，同时生成 Swagger UI 文档、OpenAPI 规范文件、Postman Collection，三端完全同步？**

答案是可以的。工具链是：

- **Scribe**：Laravel 官方推荐的 API 文档生成器，支持从注解自动生成文档
- **OpenAPI 3.0**：业界标准的 API 描述规范
- **Postman Collection**：前端/测试用的接口集合

核心思路：**注解 → Scribe → OpenAPI Spec → Postman Collection**，一条流水线打通。

## 核心概念

### Scribe 是什么

Scribe（`@knuckleswtf/scribe`）是一个 Laravel 包，能从控制器注解自动生成漂亮的 API 文档页面。相比 Swagger（`L5-Swagger` / `DarkaOnline/L5Swagger`），Scribe 的优势在于：

- 注解语法更简洁（用 PHPDoc 而非 OpenAPI 原生注解）
- 支持自动生成请求示例（真的发请求，不是伪代码）
- 支持生成 Postman Collection
- 文档页面更美观，开箱即用

### 为什么需要三同步

| 产物 | 使用者 | 用途 |
|------|--------|------|
| Scribe 文档页面 | 前端开发者 | 在线查看 API 接口 |
| OpenAPI 3.0 Spec | 后端/架构师 | API 规范、代码生成、Mock |
| Postman Collection | 前端/测试 | 接口调试、自动化测试 |

三者从同一份注解生成，改一处全同步，不会出现「文档说 A、实际是 B」的情况。

### 工作流总览

```
┌─────────────┐
│  控制器注解   │  ← 开发者唯一需要维护的地方
│  @bodyParam │
│  @response   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Scribe    │  php artisan docs:generate
└──────┬──────┘
       │
       ├──→ build/docs/         (HTML 文档页面)
       ├──→ build/openapi.json  (OpenAPI 3.0 规范)
       └──→ build/postman.json  (Postman Collection)
```

## 实战代码

### 第一步：安装 Scribe

```bash
composer require knuckleswtf/scribe
php artisan vendor:publish --provider="Knuckles\Scribe\ScribeServiceProvider"
php artisan docs:generate
```

安装后配置文件在 `config/scribe.php`，关键配置项：

```php
// config/scribe.php
return [
    // 文档标题
    'title' => env('APP_NAME', 'API') . ' 文档',

    // 基础 URL
    'base_url' => env('APP_URL', 'http://localhost'),

    // 路由文件
    'routes' => [
        'prefix' => 'docs',
        'middleware' => ['web', 'auth'],
        'domain' => null,
    ],

    // 文档输出路径
    'output' => 'public/docs',

    // 是否生成 Postman Collection
    'postman' => [
        'enabled' => true,
        'endpoint_parameters' => true,
    ],

    // 是否生成 OpenAPI Spec
    'openapi' => [
        'enabled' => true,
    ],

    // 路由扫描（按中间件/控制器/命名空间过滤）
    'routes' => [
        'matching' => [
            'prefixes' => ['api/'],
            // 只扫描带 api middleware 的路由
            'where' => [
                'middleware' => ['api'],
            ],
        ],
    ],
];
```

### 第二步：给控制器添加注解

Scribe 使用 PHPDoc 注解，语法比原生 OpenAPI 简洁得多。

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreOrderRequest;
use App\Http\Requests\UpdateOrderRequest;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    /**
     * 获取订单列表
     *
     * 获取当前用户的订单列表，支持分页和状态筛选。
     *
     * @authenticated
     *
     * @queryParam status string 订单状态筛选: pending, paid, shipped, completed, cancelled 示例: paid
     * @queryParam per_page int 每页条数 默认 15 示例: 20
     * @queryParam page int 页码 默认 1 示例: 1
     *
     * @response {
     *   "data": [
     *     {
     *       "id": 1,
     *       "order_no": "ORD20260610001",
     *       "status": "paid",
     *       "total_amount": 299.00,
     *       "created_at": "2026-06-10T10:00:00.000000Z"
     *     }
     *   ],
     *   "meta": {
     *     "current_page": 1,
     *     "per_page": 15,
     *     "total": 42
     *   }
     * }
     *
     * @response 401 {
     *   "message": "Unauthenticated."
     * }
     *
     * @return \Illuminate\Http\JsonResponse
     */
    public function index(Request $request): JsonResponse
    {
        $orders = auth()->user()->orders()
            ->when($request->status, fn ($q, $s) => $q->where('status', $s))
            ->paginate($request->get('per_page', 15));

        return response()->json([
            'data' => $orders->items(),
            'meta' => [
                'current_page' => $orders->currentPage(),
                'per_page' => $orders->perPage(),
                'total' => $orders->total(),
            ],
        ]);
    }

    /**
     * 创建订单
     *
     * 创建一个新的订单。创建成功后会返回订单详情，同时触发订单创建事件。
     *
     * @authenticated
     *
     * @bodyParam product_id int required 商品 ID 示例: 42
     * @bodyParam quantity int required 购买数量，必须大于 0 示例: 2
     * @bodyParam coupon_code string 优惠券代码 示例: SAVE20
     * @bodyParam note string 订单备注 示例: 请尽快发货
     *
     * @response {
     *   "data": {
     *     "id": 2,
     *     "order_no": "ORD20260610002",
     *     "product_id": 42,
     *     "quantity": 2,
     *     "total_amount": 598.00,
     *     "status": "pending",
     *     "created_at": "2026-06-10T10:30:00.000000Z"
     *   }
     * }
     *
     * @response 422 {
     *   "message": "The given data was invalid.",
     *   "errors": {
     *     "product_id": ["The product id field is required."]
     *   }
     * }
     *
     * @return \Illuminate\Http\JsonResponse
     */
    public function store(StoreOrderRequest $request): JsonResponse
    {
        $order = Order::create([
            'user_id' => auth()->id(),
            'product_id' => $request->product_id,
            'quantity' => $request->quantity,
            'coupon_code' => $request->coupon_code,
            'note' => $request->note,
            'total_amount' => $this->calculateTotal($request),
            'status' => 'pending',
        ]);

        return response()->json(['data' => $order], 201);
    }

    /**
     * 获取订单详情
     *
     * 根据订单 ID 获取订单详细信息，包含关联的商品和支付信息。
     *
     * @authenticated
     *
     * @response {
     *   "data": {
     *     "id": 1,
     *     "order_no": "ORD20260610001",
     *     "status": "paid",
     *     "total_amount": 299.00,
     *     "product": {
     *       "id": 42,
     *       "name": "Premium T-Shirt",
     *       "price": 299.00
     *     },
     *     "payment": {
     *       "method": "wechat",
     *       "paid_at": "2026-06-10T10:05:00.000000Z"
     *     }
     *   }
     * }
     *
     * @response 404 {
     *   "message": "Order not found."
     * }
     *
     * @return \Illuminate\Http\JsonResponse
     */
    public function show(int $id): JsonResponse
    {
        $order = auth()->user()->orders()
            ->with(['product', 'payment'])
            ->findOrFail($id);

        return response()->json(['data' => $order]);
    }

    /**
     * 更新订单
     *
     * 更新订单的备注和收货地址信息。只有待支付的订单才能修改。
     *
     * @authenticated
     *
     * @bodyParam note string 新的订单备注 示例: 改为公司地址
     * @bodyParam shipping_address string required 收货地址 示例: 上海市普陀区xxx
     *
     * @response {
     *   "data": {
     *     "id": 1,
     *     "order_no": "ORD20260610001",
     *     "note": "改为公司地址",
     *     "shipping_address": "上海市普陀区xxx"
     *   }
     * }
     *
     * @response 403 {
     *   "message": "This order cannot be updated."
     * }
     *
     * @return \Illuminate\Http\JsonResponse
     */
    public function update(UpdateOrderRequest $request, int $id): JsonResponse
    {
        $order = auth()->user()->orders()->findOrFail($id);

        if ($order->status !== 'pending') {
            return response()->json(['message' => 'This order cannot be updated.'], 403);
        }

        $order->update($request->validated());

        return response()->json(['data' => $order]);
    }
}
```

### 第三步：生成三端产物

```bash
# 生成全部产物
php artisan docs:generate

# 查看生成的文件
ls -la public/docs/
# index.html       ← Scribe 文档页面
# openapi.json     ← OpenAPI 3.0 规范
# collection.json  ← Postman Collection
```

生成的 `openapi.json` 结构：

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "KKday API 文档",
    "version": "1.0.0"
  },
  "paths": {
    "/api/orders": {
      "get": {
        "summary": "获取订单列表",
        "parameters": [
          {
            "name": "status",
            "in": "query",
            "schema": { "type": "string" },
            "description": "订单状态筛选: pending, paid, shipped, completed, cancelled"
          }
        ],
        "responses": {
          "200": {
            "description": "成功",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/OrderList" }
              }
            }
          }
        }
      }
    }
  }
}
```

生成的 Postman Collection 结构：

```json
{
  "info": {
    "name": "KKday API",
    "_postman_id": "auto-generated"
  },
  "item": [
    {
      "name": "获取订单列表",
      "request": {
        "method": "GET",
        "url": "{{base_url}}/api/orders?status=paid",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{token}}"
          }
        ]
      }
    },
    {
      "name": "创建订单",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/orders",
        "body": {
          "mode": "raw",
          "raw": "{\"product_id\": 42, \"quantity\": 2}"
        }
      }
    }
  ]
}
```

### 第四步：集成到 CI/CD

在 `composer.json` 中添加脚本，每次代码提交自动生成文档：

```json
{
  "scripts": {
    "post-autoload-dump": [
      "Illuminate\\Foundation\\ComposerScripts::postAutoloadDump",
      "@php artisan package:discover --ansi"
    ],
    "docs": [
      "@php artisan docs:generate --force"
    ],
    "docs:check": [
      "php artisan docs:generate --force --no-examples",
      "git diff --exit-code public/docs/openapi.json || (echo '❌ OpenAPI spec changed, please commit updated docs' && exit 1)"
    ]
  }
}
```

CI 流程（`.github/workflows/docs.yml`）：

```yaml
name: API Docs

on:
  push:
    branches: [main]
    paths:
      - 'app/Http/Controllers/Api/**'
      - 'routes/api.php'
      - 'config/scribe.php'

jobs:
  generate-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Install dependencies
        run: composer install --no-progress

      - name: Generate docs
        run: php artisan docs:generate --force

      - name: Check for changes
        run: |
          if ! git diff --quiet public/docs/; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add public/docs/
            git commit -m "docs: auto-update API documentation"
            git push
          fi
```

这样每次改了控制器代码并推送到 main 分支，CI 会自动生成并提交最新的文档。

### 第五步：Mock Server 配置

前端开发者不需要后端跑起来也能调试接口。用 Scribe 生成的 OpenAPI Spec 配合 Prism 做 Mock Server：

```bash
# 安装 Prism
npm install -g @stoplight/prism-cli

# 启动 Mock Server
prism mock public/docs/openapi.json --port 4010

# 前端直接请求 Mock Server
curl http://localhost:4010/api/orders?status=paid \
  -H "Authorization: Bearer test-token"
```

Prism 会根据 OpenAPI Spec 自动返回符合 schema 的 mock 数据，前端可以并行开发。

### 第六步：自定义 Scribe 输出

如果默认的文档页面不够用，可以通过自定义 Markdown 文件补充内容：

```bash
# 创建自定义文档文件
mkdir -p resources/docs
```

`resources/docs/index.md`：

```markdown
## 认证方式

所有 API 请求需要在 Header 中携带 Bearer Token：

```
Authorization: Bearer <your-token>
```

获取 Token：
1. 调用 `POST /api/auth/login` 获取 token
2. 将 token 放入后续请求的 Authorization header

## 通用错误码

| HTTP 状态码 | 含义 | 说明 |
|------------|------|------|
| 401 | Unauthorized | 未登录或 token 过期 |
| 403 | Forbidden | 无权限访问 |
| 404 | Not Found | 资源不存在 |
| 422 | Validation Error | 参数验证失败 |
| 429 | Too Many Requests | 请求过于频繁 |
| 500 | Server Error | 服务器内部错误 |

## 速率限制

- 普通接口：60 次/分钟
- 写入接口：30 次/分钟
- 查询接口：120 次/分钟

响应头会返回限制信息：
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1718006400
```
```

这些自定义内容会出现在 Scribe 文档页面的「Introduction」部分。

### 高级：自定义 Postman 环境变量

Postman Collection 可以配合 Environment 使用，让前端开发者一键切换环境：

```json
{
  "name": "Dev Environment",
  "values": [
    { "key": "base_url", "value": "http://localhost:8000" },
    { "key": "token", "value": "" }
  ]
}

{
  "name": "SIT Environment",
  "values": [
    { "key": "base_url", "value": "https://sit.api.example.com" },
    { "key": "token", "value": "" }
  ]
}
```

## 踩坑记录

### 坑 1：注解中的 `@response` 必须是合法 JSON

Scribe 会解析 `@response` 中的内容作为示例响应。如果 JSON 格式有误，生成的文档会显示空的示例。

**错误示例：**

```php
// ❌ 缺少逗号
@response {
  "data": {
    "id": 1
    "name": "test"
  }
}
```

**正确示例：**

```php
// ✅ 格式正确
@response {
  "data": {
    "id": 1,
    "name": "test"
  }
}
```

**建议：** 写完 `@response` 后用 `json_decode` 验证一下，或者让 IDE 的 JSON 插件帮你检查。

### 坑 2：`@bodyParam` 和实际验证规则不一致

Scribe 会展示 `@bodyParam` 注解的内容，但它不会自动和 FormRequest 的验证规则同步。

**解决方案：** 从 FormRequest 的 `rules()` 方法中提取字段信息，用脚本自动生成 `@bodyParam`：

```php
// app/Console/Commands/GenerateBodyParams.php
class GenerateBodyParams extends Command
{
    protected $signature = 'docs:body-params {controller}';

    public function handle(): int
    {
        $controller = $this->argument('controller');
        $requestClass = "App\\Http\\Requests\\{$controller}Request";
        $rules = (new $requestClass())->rules();

        foreach ($rules as $field => $rule) {
            $this->line("@bodyParam {$field} string required {$field} description");
        }

        return 0;
    }
}
```

不过更实际的做法是：**养成习惯，改了验证规则就同步更新注解**。可以用 CI 的 `docs:check` 脚本来检测是否遗漏。

### 坑 3：Scribe 文档页面缓存

Scribe 默认会在 `storage/app/scribe/` 下缓存生成的文档。如果修改了注解但文档没更新，可能是缓存问题。

```bash
# 清除缓存
rm -rf storage/app/scribe/
php artisan docs:generate --force
```

### 坑 4：OpenAPI Spec 版本兼容性

Scribe 生成的 OpenAPI 3.0 Spec 在某些工具中可能不完全兼容。比如：

- **Swagger UI** 通常没问题
- **Redoc** 需要检查 schema 格式
- **Postman** 导入时可能有字段丢失

**解决方案：** 生成后手动检查一次 `openapi.json`，确认各工具都能正常解析。

### 坑 5：Postman Collection 的变量引用

Scribe 生成的 Postman Collection 默认使用硬编码的 URL，不支持环境变量。需要手动修改或用脚本处理：

```php
// app/Console/Commands/FixPostmanCollection.php
class FixPostmanCollection extends Command
{
    protected $signature = 'docs:fix-postman';

    public function handle(): int
    {
        $path = public_path('docs/collection.json');
        $collection = json_decode(file_get_contents($path), true);

        // 将所有 URL 替换为变量引用
        $this->replaceUrl($collection);

        file_put_contents($path, json_encode($collection, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        $this->info('Postman Collection updated with environment variables.');
        return 0;
    }

    private function replaceUrl(&$item): void
    {
        if (isset($item['request']['url'])) {
            $url = &$item['request']['url'];
            if (is_string($url)) {
                $url = str_replace(
                    config('app.url'),
                    '{{base_url}}',
                    $url
                );
            } elseif (isset($url['raw'])) {
                $url['raw'] = str_replace(
                    config('app.url'),
                    '{{base_url}}',
                    $url['raw']
                );
            }
        }

        if (isset($item['item'])) {
            foreach ($item['item'] as &$child) {
                $this->replaceUrl($child);
            }
        }
    }
}
```

把这个命令加到 `docs` 脚本中：

```json
"docs": [
  "@php artisan docs:generate --force",
  "@php artisan docs:fix-postman"
]
```

## 完整工作流总结

### 日常开发流程

```
1. 写控制器 + 注解（唯一需要维护的地方）
        │
        ▼
2. 本地运行 docs:generate
        │
        ├──→ 浏览器打开 /docs 检查文档
        ├──→ 导入 Postman 测试接口
        └──→ 前端用 Mock Server 并行开发
        │
        ▼
3. 提交代码 → CI 自动生成 → 自动 commit 文档更新
        │
        ▼
4. 前端拉取最新 Postman Collection → 同步环境
```

### 团队协作约定

| 角色 | 行为 |
|------|------|
| 后端 | 改控制器时同步更新注解 |
| CI | 自动检测文档是否过期 |
| 前端 | 从 Postman Collection 导入接口 |
| 测试 | 用 OpenAPI Spec 生成测试用例 |

### 项目结构

```
project/
├── app/Http/Controllers/Api/   ← 控制器（含注解）
├── app/Http/Requests/          ← FormRequest 验证
├── config/scribe.php           ← Scribe 配置
├── resources/docs/             ← 自定义文档内容
├── public/docs/                ← 生成产物
│   ├── index.html              ← 文档页面
│   ├── openapi.json            ← OpenAPI Spec
│   └── collection.json         ← Postman Collection
├── .github/workflows/docs.yml  ← CI 自动化
└── composer.json               ← docs 脚本
```

## 总结

这套方案的核心价值是：**单一事实源（Single Source of Truth）**。

开发者只需要在控制器注解中维护一次 API 描述，就能自动同步到三个地方：
1. **在线文档**（Scribe 页面）— 给前端看
2. **OpenAPI Spec** — 给架构师和工具链用
3. **Postman Collection** — 给前端和测试用

配合 CI 自动化，文档永远不会过期。前端开发者不用等后端跑起来就能用 Mock Server 开发，测试团队可以用 OpenAPI Spec 自动生成测试用例。

**最后一点建议：** 注解是给机器读的，也是给人读的。写清楚、写完整，比写得花哨更重要。一个写得好的 `@description` 比十页 README 都有用。

---

**相关工具版本：**
- Laravel 10.x / 11.x
- Scribe `^5.0`
- PHP 8.2+
- Node.js 18+（Prism Mock Server）
