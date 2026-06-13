---
title: API 版本控制进阶：URL/Header/MediaType 三种策略的工程实践
date: 2026-06-01 22:45:00
tags: [API, Laravel, RESTful, 版本控制, 版本管理, URL版本控制]
keywords: [API, URL, Header, MediaType, 版本控制进阶, 三种策略的工程实践, PHP]
description: 本文结合 Laravel 工程实践，系统讲解 API 版本控制的三种主流方案：URL版本、Header版本、MediaType 版本，覆盖 RESTful 设计取舍、路由拆分、中间件解析、控制器与资源层实现、缓存配置、Swagger/OpenAPI 文档分版、灰度发布与兼容治理，帮助团队建立可落地、可演进的 API 版本管理体系。
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


在 API 生命周期足够长、客户端足够多、业务变化足够频繁的系统里，版本控制从来不是“要不要做”的问题，而是“什么时候会痛到必须做”。很多团队在系统早期图快，接口路径直接写成 `/api/orders`，移动端、小程序、Web 前端、第三方渠道都接同一套接口；等上线一年后，字段语义发生变化、认证方式升级、排序规则调整、错误码规范重构，这时才发现：原来真正困难的不是写一个 v2，而是在“不打断旧客户端”的前提下，持续、平滑、可观测地演进 API。

我在 Laravel 项目里落地 API 版本控制时，最常被问到的一个问题是：到底该选 URL 版本、Header 版本，还是 Media Type 版本？如果只从教科书视角看，答案往往很简单：URL 版本最直观，Header 版本更“RESTful”，Media Type 版本更标准。但一旦进入工程实践，你会发现问题远不止这些：Nginx 和 CDN 怎么缓存？Laravel 路由怎么拆？中间件要不要动态解析版本？Swagger 文档如何区分？日志和监控如何按版本聚合？灰度期间如何做双栈兼容？

这篇文章我会基于 Laravel 的实际项目组织方式，系统讲清三种版本控制策略的原理、优劣、代码落地、路由配置、中间件设计，以及那些只有在线上被打过脸之后才会记住的坑。你可以把它当作一篇“从概念到实战”的长文，也可以直接按文中的目录结构，把自己的 Laravel API 版本体系搭起来。

<!-- more -->

## 一、为什么 API 版本控制一定会成为工程问题

很多团队第一次意识到 API 版本控制的重要性，通常不是因为架构师在设计评审会上提前规划得多好，而是因为某次改动“动了老接口”，然后线上炸了。

典型场景包括：

1. 字段含义变化
   例如 `status=1` 原来表示“待支付”，后来业务扩展后改成“待确认”，旧客户端逻辑瞬间失效。
2. 响应结构调整
   以前接口直接返回数组，后来为了统一规范改成 `{ code, message, data }`，历史客户端解析失败。
3. 默认排序改变
   商品列表以前按创建时间排序，后来按推荐权重排序，前端以为是“接口抽风”。
4. 认证机制升级
   早期是简单 Token，后期切到 OAuth2 或 JWT，第三方接入方根本没法一起切换。
5. 资源建模重构
   旧接口用 `/order/cancel` 这种动作式设计，新接口改为 `/orders/{id}/cancellation`，URL 和语义都变了。

这些变化有一个共同点：服务端觉得只是“合理重构”，客户端看到的却是“兼容性破坏”。而 API 版本控制本质上就是在解决这个矛盾：允许服务端演进，同时不粗暴打断存量调用方。

从工程角度看，API 版本控制至少解决四类问题：

1. 兼容性管理
   老客户端继续用旧版本，新客户端逐步切换到新版本。
2. 变更隔离
   避免一个版本的逻辑污染另一个版本。
3. 发布节奏控制
   可以灰度、回滚、限流、监控某个特定版本。
4. 废弃治理
   明确哪些版本活跃、哪些版本进入 Sunset、哪些版本应该下线。

所以，版本控制不是简单的路径命名，而是一整套 API 治理机制。

## 二、三种主流版本策略先看全景图

在工程里最常见的 API 版本控制方式有三种：

1. URL Path Versioning
   通过路径体现版本，例如：`/api/v1/users`、`/api/v2/users`
2. Header Versioning
   通过自定义请求头传递版本，例如：`X-API-Version: 2`
3. Media Type Versioning
   通过 `Accept` 头中的媒体类型参数表达版本，例如：`Accept: application/vnd.demo.v2+json`

先给一个总览对比表：

| 维度 | URL 版本 | Header 版本 | Media Type 版本 |
|---|---|---|---|
| 可读性 | 很高 | 中 | 中偏低 |
| 调试友好 | 很高 | 中 | 低于 URL |
| 浏览器直接访问 | 方便 | 一般 | 一般 |
| CDN / 网关缓存 | 容易 | 需要额外配置 | 需要按 Accept 变体缓存 |
| REST 风格纯度 | 一般 | 较好 | 最强 |
| 客户端实现复杂度 | 低 | 中 | 中高 |
| Laravel 路由拆分难度 | 低 | 中 | 中 |
| 文档维护成本 | 中 | 中 | 中高 |
| 第三方接入沟通成本 | 低 | 中 | 高 |
| 常见踩坑概率 | 低 | 中 | 高 |

如果只给结论：

- 面向内部团队、多终端协作、追求效率：URL 版本最稳。
- 想让 URL 长期保持稳定，且客户端具备较强接入能力：Header 版本可用。
- 有强规范诉求、需要更贴近资源协商语义，且团队对 HTTP 细节足够熟：Media Type 版本值得考虑。

但“可用”不代表“适合”。下面我们分开讲。

## 三、URL 版本控制：最务实、最容易落地的策略

### 3.1 原理

URL 版本控制的核心思想非常简单：把版本直接写进路径。

例如：

```text
GET /api/v1/products
GET /api/v2/products
```

服务端通过不同路由前缀将请求分发到不同控制器、服务类、资源转换器。因为版本信息直接出现在 URL 上，所以它对于网关、日志系统、监控平台、浏览器、抓包工具都极其友好。

### 3.2 优点

1. 直观
   看 URL 就知道当前访问的是哪个版本。
2. 易调试
   Postman、curl、浏览器地址栏都能直接使用。
3. 路由隔离清晰
   Laravel 可以天然按 `prefix('v1')`、`prefix('v2')` 分组。
4. 缓存友好
   CDN、反向代理、Nginx 基于路径做缓存策略非常自然。
5. 对第三方最友好
   文档说明成本低，几乎不会理解错。

### 3.3 缺点

1. URL 不够“优雅”
   资源路径包含版本，看起来不如内容协商式方案纯粹。
2. 容易复制粘贴式演进
   很多团队直接把 `v1` 整包复制成 `v2`，久而久之技术债爆炸。
3. 版本分支容易膨胀
   如果缺乏服务层复用设计，控制器和资源类会大量重复。

### 3.4 Laravel 路由配置

在 Laravel 中，URL 版本控制最常见的组织方式是把每个版本的路由独立到单独文件。

项目结构建议如下：

```text
routes/
├── api.php
├── api_v1.php
└── api_v2.php

app/Http/Controllers/Api/
├── V1/
│   ├── ProductController.php
│   └── OrderController.php
└── V2/
    ├── ProductController.php
    └── OrderController.php
```

先看 `routes/api.php`：

```php
<?php

use Illuminate\Support\Facades\Route;

Route::prefix('v1')
    ->middleware(['api', 'api.version:v1'])
    ->group(base_path('routes/api_v1.php'));

Route::prefix('v2')
    ->middleware(['api', 'api.version:v2'])
    ->group(base_path('routes/api_v2.php'));
```

对应的 `routes/api_v1.php`：

```php
<?php

use App\Http\Controllers\Api\V1\ProductController;
use App\Http\Controllers\Api\V1\OrderController;
use Illuminate\Support\Facades\Route;

Route::get('/products', [ProductController::class, 'index']);
Route::get('/products/{id}', [ProductController::class, 'show']);
Route::post('/orders', [OrderController::class, 'store']);
Route::get('/orders/{id}', [OrderController::class, 'show']);
```

`routes/api_v2.php`：

```php
<?php

use App\Http\Controllers\Api\V2\ProductController;
use App\Http\Controllers\Api\V2\OrderController;
use Illuminate\Support\Facades\Route;

Route::get('/products', [ProductController::class, 'index']);
Route::get('/products/{id}', [ProductController::class, 'show']);
Route::post('/orders', [OrderController::class, 'store']);
Route::get('/orders/{id}', [OrderController::class, 'show']);
```

这种方式最大的优点是“稳定”，任何 Laravel 开发者都能快速看懂。

### 3.5 控制器与服务层如何避免复制粘贴

很多人做版本控制时最大的误区，是把控制器、Request、Resource、Service 全量复制一遍，短期看是快，半年后维护成本极高。

我更推荐一种“薄控制器 + 稳服务层 + 差异资源层”的结构：

```text
app/
├── Http/
│   ├── Controllers/Api/V1/ProductController.php
│   ├── Controllers/Api/V2/ProductController.php
│   ├── Resources/Api/V1/ProductResource.php
│   └── Resources/Api/V2/ProductResource.php
└── Services/ProductService.php
```

服务层尽量复用：

```php
<?php

namespace App\Services;

use App\Models\Product;

class ProductService
{
    public function getProductDetail(int $id): Product
    {
        return Product::query()
            ->with(['brand', 'categories'])
            ->findOrFail($id);
    }

    public function getProductList(array $filters = [])
    {
        return Product::query()
            ->when(isset($filters['keyword']), function ($query) use ($filters) {
                $query->where('name', 'like', '%' . $filters['keyword'] . '%');
            })
            ->where('is_active', true)
            ->paginate($filters['per_page'] ?? 20);
    }
}
```

V1 控制器：

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Api\V1\ProductResource;
use App\Services\ProductService;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function __construct(private ProductService $productService)
    {
    }

    public function index(Request $request)
    {
        $products = $this->productService->getProductList($request->all());

        return ProductResource::collection($products);
    }

    public function show(int $id)
    {
        $product = $this->productService->getProductDetail($id);

        return new ProductResource($product);
    }
}
```

V2 控制器：

```php
<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Resources\Api\V2\ProductResource;
use App\Services\ProductService;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function __construct(private ProductService $productService)
    {
    }

    public function index(Request $request)
    {
        $filters = array_merge($request->all(), [
            'sort' => $request->get('sort', 'recommended'),
        ]);

        $products = $this->productService->getProductList($filters);

        return ProductResource::collection($products);
    }

    public function show(int $id)
    {
        $product = $this->productService->getProductDetail($id);

        return new ProductResource($product);
    }
}
```

V1 / V2 的主要差异，优先放在 Resource 层表达：

```php
<?php

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'price' => $this->price,
            'stock' => $this->stock,
        ];
    }
}
```

```php
<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'price' => [
                'amount' => $this->price,
                'currency' => 'TWD',
            ],
            'inventory' => [
                'available' => $this->stock,
                'status' => $this->stock > 0 ? 'in_stock' : 'sold_out',
            ],
            'summary' => $this->short_description,
        ];
    }
}
```

也就是说：版本差异尽量表现为“输入验证差异、输出契约差异、少量编排逻辑差异”，而不是整个业务逻辑重写。

### 3.6 URL 版本中间件设计

虽然 URL 已经携带版本，但我依然建议设计一个统一版本中间件，原因有三点：

1. 将当前版本写入请求上下文，业务代码可统一获取。
2. 为日志、监控、链路追踪增加版本标签。
3. 将来从 URL 版本扩展到 Header / Media Type 时可以复用入口。

示例中间件：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetApiVersion
{
    public function handle(Request $request, Closure $next, ?string $version = null): Response
    {
        $resolvedVersion = $version ?: 'v1';

        $request->attributes->set('api_version', $resolvedVersion);
        app()->instance('api.version', $resolvedVersion);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set('X-API-Version', $resolvedVersion);

        return $response;
    }
}
```

在 `bootstrap/app.php` 或中间件注册处挂载别名：

```php
->withMiddleware(function ($middleware) {
    $middleware->alias([
        'api.version' => \App\Http\Middleware\SetApiVersion::class,
    ]);
})
```

控制器或服务中获取当前版本：

```php
$version = request()->attributes->get('api_version', 'v1');
```

### 3.7 URL 版本的适用场景

URL 版本控制特别适合以下情况：

- 第三方对接方多，技术水平参差不齐。
- 团队成员变动频繁，需要降低维护理解成本。
- 强依赖网关、CDN、缓存层按路径区分版本。
- 希望文档链接、抓包、监控天然可见版本。
- 系统正处于“先把工程治理建立起来”的阶段。

在大多数 Laravel 中后台、B2C、B2B、开放平台项目中，URL 版本控制通常是默认优选方案。

## 四、Header 版本控制：URL 更稳定，但治理要求更高

### 4.1 原理

Header 版本控制不把版本暴露在路径上，而是通过请求头传递，例如：

```http
GET /api/products HTTP/1.1
Host: example.com
X-API-Version: 2
```

或者使用更语义化的头：

```http
API-Version: 2026-06-01
```

服务端在接收请求后，通过中间件解析 Header，再决定本次请求使用哪一套控制器、资源或服务编排逻辑。

### 4.2 优点

1. URL 相对稳定
   对外资源路径不变，版本细节从 URI 中抽离。
2. 更利于表达“资源不变、表示形式演进”
   即 `/api/products/1` 还是同一个资源，只是表示形式不同。
3. 便于隐藏实现细节
   某些团队不希望把版本号暴露在路径中。

### 4.3 缺点

1. 调试和沟通成本高于 URL 版本
   少一个 Header，请求可能就走错版本。
2. 缓存和网关配置更复杂
   必须明确告诉代理层按指定 Header 做变体缓存。
3. Laravel 路由不能单靠 prefix 直接拆开
   需要动态派发、或在同一路由中根据版本分流。
4. 第三方接入容易漏 Header
   特别是浏览器临时调试、Webhook 回调、低代码平台接入等场景。

### 4.4 Laravel 中的推荐落地方式

Header 版本控制有两种常见做法：

1. 路由保持统一，控制器内部根据版本分发。
2. 中间件解析版本后，动态绑定控制器命名空间或 Handler。

对于 Laravel 而言，我更推荐一种折中方案：

- 路由路径统一；
- 中间件解析版本并写入上下文；
- 控制器尽量保持单一入口；
- 具体输出差异由 Version Resolver + Resource Factory 决定。

路由配置示例：

```php
<?php

use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\OrderController;
use Illuminate\Support\Facades\Route;

Route::middleware(['api', 'resolve.api.version'])->group(function () {
    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/{id}', [ProductController::class, 'show']);
    Route::post('/orders', [OrderController::class, 'store']);
    Route::get('/orders/{id}', [OrderController::class, 'show']);
});
```

解析 Header 的中间件：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveApiVersionFromHeader
{
    private array $supportedVersions = ['v1', 'v2'];

    public function handle(Request $request, Closure $next): Response
    {
        $version = $request->header('X-API-Version', 'v1');
        $version = strtolower(trim($version));

        if (! in_array($version, $this->supportedVersions, true)) {
            return response()->json([
                'message' => 'Unsupported API version.',
                'supported_versions' => $this->supportedVersions,
            ], 400);
        }

        $request->attributes->set('api_version', $version);
        app()->instance('api.version', $version);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set('X-API-Version', $version);
        $response->headers->set('Vary', 'X-API-Version');

        return $response;
    }
}
```

这里最关键的一行不是设置当前版本，而是：

```php
$response->headers->set('Vary', 'X-API-Version');
```

它决定了代理缓存是否会把不同版本的响应错误复用。如果没有 `Vary`，你很可能会遇到“明明请求 v2，结果拿到 v1 缓存”的离谱问题。

### 4.5 版本解析器与资源工厂

为了避免控制器里写很多 `if ($version === 'v2')`，建议把版本分发逻辑抽出来。

先定义版本解析器：

```php
<?php

namespace App\Support\ApiVersioning;

use Illuminate\Http\Request;

class ApiVersionResolver
{
    public function resolve(Request $request): string
    {
        return $request->attributes->get('api_version', 'v1');
    }

    public function is(string $version, Request $request): bool
    {
        return $this->resolve($request) === $version;
    }
}
```

再定义 ProductResource 工厂：

```php
<?php

namespace App\Support\ApiVersioning;

use App\Http\Resources\Api\V1\ProductResource as V1ProductResource;
use App\Http\Resources\Api\V2\ProductResource as V2ProductResource;
use Illuminate\Http\Request;

class ProductResourceFactory
{
    public function make($product, Request $request)
    {
        $version = $request->attributes->get('api_version', 'v1');

        return match ($version) {
            'v2' => new V2ProductResource($product),
            default => new V1ProductResource($product),
        };
    }

    public function collection($products, Request $request)
    {
        $version = $request->attributes->get('api_version', 'v1');

        return match ($version) {
            'v2' => V2ProductResource::collection($products),
            default => V1ProductResource::collection($products),
        };
    }
}
```

控制器就会变得很干净：

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ProductService;
use App\Support\ApiVersioning\ProductResourceFactory;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function __construct(
        private ProductService $productService,
        private ProductResourceFactory $resourceFactory,
    ) {
    }

    public function index(Request $request)
    {
        $products = $this->productService->getProductList($request->all());

        return $this->resourceFactory->collection($products, $request);
    }

    public function show(Request $request, int $id)
    {
        $product = $this->productService->getProductDetail($id);

        return $this->resourceFactory->make($product, $request);
    }
}
```

### 4.6 Header 版本控制的中间件链设计

Header 版本通常不应该只有一个“解析版本”中间件，真正上线时往往需要一组配套中间件：

1. `ResolveApiVersionFromHeader`
   负责解析与校验版本。
2. `RejectDeprecatedVersion`
   当某个版本过了废弃窗口后直接拒绝。
3. `AppendVersionHeaders`
   在响应头中补充版本、废弃信息、Sunset 日期。
4. `TrackApiVersionMetrics`
   写日志、打埋点、上报 Prometheus / DataDog。

例如废弃中间件：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RejectDeprecatedVersion
{
    public function handle(Request $request, Closure $next): Response
    {
        $version = $request->attributes->get('api_version', 'v1');
        $deprecatedVersions = config('api_versioning.deprecated_versions', []);

        if (isset($deprecatedVersions[$version]) && $deprecatedVersions[$version]['blocked'] === true) {
            return response()->json([
                'message' => 'This API version has been retired.',
                'version' => $version,
                'sunset_at' => $deprecatedVersions[$version]['sunset_at'] ?? null,
            ], 410);
        }

        /** @var Response $response */
        $response = $next($request);

        if (isset($deprecatedVersions[$version])) {
            $meta = $deprecatedVersions[$version];
            $response->headers->set('Deprecation', 'true');

            if (! empty($meta['sunset_at'])) {
                $response->headers->set('Sunset', $meta['sunset_at']);
            }
        }

        return $response;
    }
}
```

这类设计会让 Header 版本真正具备“治理能力”，而不是只停留在一个 Header 判断。

### 4.7 Header 版本适合哪些项目

它更适合：

- 内部 API 平台，调用方可控；
- 团队对 HTTP 缓存、网关和文档治理比较成熟；
- 希望 URL 长期稳定，不频繁暴露版本；
- 需要更灵活地做版本切换和灰度。

如果你的对接方很多，而且一堆人平时连 Header 都懒得配，Header 版本大概率会引发大量“为什么请求不对”的沟通成本。

## 五、Media Type 版本控制：概念最优雅，落地最考验团队基本功

### 5.1 原理

Media Type 版本控制本质上是 HTTP 内容协商的一种实践，它不使用自定义 Header，而是把版本放进 `Accept` 头中。例如：

```http
Accept: application/vnd.example.v1+json
Accept: application/vnd.example.v2+json
```

或者加参数形式：

```http
Accept: application/json; version=2
```

从语义上说，它表达的是：客户端请求的是“同一个资源的不同表示”。这比 URL 版本“更 RESTful”，也是很多 API 设计文章喜欢推崇的方式。

### 5.2 优点

1. 贴近 HTTP 标准内容协商思想。
2. URL 保持稳定，资源定位与表示形式解耦。
3. 可以与不同输出格式一起设计，例如 JSON、CSV、HAL、JSON:API。
4. 对长期 API 演进和规范化治理很有吸引力。

### 5.3 缺点

1. 可读性和调试成本高。
2. 很多客户端、代理、测试工具对复杂 `Accept` 头支持不够友好。
3. 团队成员如果对内容协商理解不深，很容易写出半吊子实现。
4. 文档、SDK、日志、缓存体系都需要额外照顾。

### 5.4 Laravel 中的 Media Type 解析中间件

在 Laravel 里，Media Type 版本控制通常由中间件完成。下面给出一个可以实际落地的实现。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveApiVersionFromAcceptHeader
{
    private array $supportedVersions = ['v1', 'v2'];

    public function handle(Request $request, Closure $next): Response
    {
        $accept = $request->header('Accept', 'application/json');
        $version = $this->parseVersion($accept) ?? 'v1';

        if (! in_array($version, $this->supportedVersions, true)) {
            return response()->json([
                'message' => 'Unsupported API media type version.',
                'accept' => $accept,
                'supported_versions' => $this->supportedVersions,
            ], 406);
        }

        $request->attributes->set('api_version', $version);
        app()->instance('api.version', $version);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set('X-API-Version', $version);
        $response->headers->set('Vary', 'Accept');

        return $response;
    }

    private function parseVersion(string $accept): ?string
    {
        if (preg_match('/application\/vnd\.[\w\.-]+\.v(\d+)\+json/i', $accept, $matches)) {
            return 'v' . $matches[1];
        }

        if (preg_match('/application\/json\s*;\s*version=(\d+)/i', $accept, $matches)) {
            return 'v' . $matches[1];
        }

        return null;
    }
}
```

注意这里返回 `406 Not Acceptable` 会比直接 `400` 更符合 Media Type 协商语义。

### 5.5 路由保持不变，输出按版本协商

Media Type 版本控制下，通常路由仍然保持统一：

```php
<?php

use App\Http\Controllers\Api\ProductController;
use Illuminate\Support\Facades\Route;

Route::middleware(['api', 'resolve.api.accept.version'])->group(function () {
    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/{id}', [ProductController::class, 'show']);
});
```

控制器可以沿用前面 Header 版本的 Resource Factory 模式，因此这里不需要重复整个控制器体系。

### 5.6 Media Type 与 Laravel Response 的组合设计

除了请求解析，响应时最好也明确输出服务端选择的内容类型：

```php
<?php

namespace App\Support\ApiVersioning;

class MediaTypeFormatter
{
    public function forVersion(string $version): string
    {
        return match ($version) {
            'v2' => 'application/vnd.demo.v2+json',
            default => 'application/vnd.demo.v1+json',
        };
    }
}
```

在响应中间件或基类控制器里设置：

```php
$response->headers->set('Content-Type', $mediaTypeFormatter->forVersion($version));
```

这样前后协商会更完整，否则你只是“从 Accept 里读了版本”，但响应仍然永远是 `application/json`，语义并不闭环。

### 5.7 Media Type 版本在开放平台中的现实问题

理论上它很优雅，但我在实际项目里见过这些坑：

1. 第三方网关会重写或丢弃 Accept 头。
2. 某些前端封装默认写死 `Accept: application/json`，导致版本信息始终传不过来。
3. CDN 未按 Accept 做 Vary，缓存串版本。
4. Swagger/OpenAPI 文档展示不够直观，测试人员频繁漏配。
5. 某些低代码平台或无代码平台只能配简单 Header，很难表达复杂 Media Type。

所以，Media Type 很适合强约束、成熟平台，不适合“接入方很多但规范执行力一般”的场景。

## 六、三种策略的工程对比：不要只比“优雅”，要比“可运营”

很多文章比较三种版本控制时，停留在“URL 不够 RESTful、Header 更优雅、Media Type 最标准”这一层。但到了工程里，真正决定成败的反而是以下这些维度。

### 6.0 一张更适合做技术选型评审的对比表

如果你要在架构评审会上快速说明为什么某个项目适合 URL、为什么另一个项目更适合 Header，这张表会比“谁更 RESTful”更有说服力：

| 对比维度 | URL 版本 | Header 版本 | MediaType 版本 |
|---|---|---|---|
| 直观性 | 最强，路径里直接可见 `/v1` `/v2` | 中等，需要看 Header | 偏弱，要读 `Accept` 才知道 |
| 缓存兼容性 | 最好，天然按 URL 分缓存键 | 中等，必须配置 `Vary: X-API-Version` | 中等偏低，必须配置 `Vary: Accept` 且变体更多 |
| RESTful 程度 | 一般，版本进入 URI | 较好，资源 URI 稳定 | 最强，最接近内容协商语义 |
| 实现复杂度 | 最低，Laravel 路由天然支持 | 中等，需要中间件 + 资源工厂 | 最高，需要正确处理 `Accept` / `Content-Type` / 协商失败 |
| 客户端兼容性 | 最好，浏览器、Postman、第三方平台都容易调用 | 较好，但容易漏 Header | 一般，部分客户端或网关对复杂 `Accept` 支持不好 |
| 文档表达成本 | 低，只展示不同路径即可 | 中，需要强调 Header 必填 | 高，需要解释媒体类型格式 |
| 灰度发布灵活性 | 中，多依赖路径切换 | 高，可按 Header 定向切流 | 高，但对网关能力要求也更高 |
| 适合团队成熟度 | 初中阶都适合 | 中高阶更合适 | 高成熟度团队更稳妥 |

一个非常实用的经验是：如果你的首要目标是“让更多人少犯错”，优先 URL；如果首要目标是“让 URI 长期稳定”，考虑 Header；如果首要目标是“构建严格的内容协商体系”，再考虑 MediaType。

### 6.1 路由组织成本

URL 版本：
- 路由层天然分组，最容易拆分。
- 适合多版本长期并存。
- 容易做 route:list 级别的版本检查。

Header / Media Type：
- 路由层通常统一。
- 版本差异会转移到中间件、工厂、资源层。
- 如果缺少抽象，控制器内 `if/else` 很容易蔓延。

### 6.2 缓存与网关

URL 版本：
- 天然按路径区分缓存 key。
- 对 CDN、WAF、APM 最友好。

Header 版本：
- 必须明确 `Vary: X-API-Version`。
- 网关转发时要确认 Header 不被吃掉。

Media Type 版本：
- 必须明确 `Vary: Accept`。
- Accept 组合复杂时缓存命中率和变体数都会受影响。

### 6.3 日志与监控

URL 版本：
- 日志搜索直接 grep `/api/v2/` 就能定位。
- Nginx access log 级别即可聚合。

Header / Media Type：
- 必须在应用日志中主动打印解析出的版本。
- 如果链路追踪不写 tag，问题排查会很痛苦。

### 6.4 文档与 SDK

URL 版本：
- 文档天然可按路径分组。
- SDK 通常配置 base path 即可。

Header 版本：
- SDK 必须统一封装 Header 注入。
- 文档必须反复强调“每次请求都要带版本头”。

Media Type 版本：
- SDK 和文档都要解释 Accept 格式。
- 接入方如果不是纯后端工程师，理解门槛明显更高。

### 6.5 废弃与迁移治理

三种方案都能做版本废弃，但 URL 版本最容易让人“意识到自己还在旧版本”；Header 和 Media Type 因为版本不在路径上，更依赖响应头提示、监控看板和主动通知机制。

如果团队运维成熟度一般，我通常建议优先 URL 版本，因为它不仅技术上简单，治理上也更容易被看见。

## 七、Laravel 中一套可长期维护的版本化目录设计

不管你选哪种策略，我都建议避免“随版本复制整个 app 目录”的粗暴做法。更好的方式是按“变化频率”拆层。

推荐结构：

```text
app/
├── Domain/
│   ├── Product/
│   │   ├── Actions/
│   │   ├── DTOs/
│   │   └── Services/
│   └── Order/
├── Http/
│   ├── Controllers/
│   │   ├── Api/
│   │   │   ├── V1/
│   │   │   ├── V2/
│   │   │   └── ProductController.php   # Header/MediaType 场景可用统一入口
│   ├── Middleware/
│   ├── Requests/
│   │   ├── Api/
│   │   │   ├── V1/
│   │   │   └── V2/
│   └── Resources/
│       ├── Api/
│       │   ├── V1/
│       │   └── V2/
└── Support/
    └── ApiVersioning/
        ├── ApiVersionResolver.php
        ├── ProductResourceFactory.php
        ├── VersionPolicy.php
        └── MediaTypeFormatter.php
```

设计原则：

1. 领域逻辑尽量不带版本号。
   因为业务规则通常是“真实世界规则”，不应轻易被 API 表达层版本污染。
2. Request / Resource 更容易带版本号。
   输入和输出契约最容易发生版本差异。
3. 控制器是否带版本号，取决于策略。
   URL 版本更适合分目录；Header / Media Type 可统一入口。
4. 版本策略相关的公共逻辑集中到 `Support/ApiVersioning`。
   避免散落在各处。

## 八、路由配置的进一步实践：如何同时支持多策略

在一些项目里，团队会经历一个演进过程：

- 第一期使用 URL 版本；
- 第二期希望新增 Header 版本支持给内部客户端；
- 旧版本仍然保留；
- 新网关策略要求能从 Header 动态切流。

这时候你会发现：真正需要的不是“选一个版本策略”，而是做一个可扩展版本解析入口。

### 8.1 统一版本解析优先级

我建议定义一个统一策略：

1. 路由参数显式版本优先；
2. 再看自定义 Header；
3. 最后看 Accept Media Type；
4. 都没有时回退默认版本。

中间件示例：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveApiVersion
{
    private array $supportedVersions = ['v1', 'v2'];

    public function handle(Request $request, Closure $next): Response
    {
        $version = $this->resolveVersion($request);

        if (! in_array($version, $this->supportedVersions, true)) {
            return response()->json([
                'message' => 'Unsupported API version.',
                'version' => $version,
                'supported_versions' => $this->supportedVersions,
            ], 400);
        }

        $request->attributes->set('api_version', $version);
        app()->instance('api.version', $version);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set('X-API-Version', $version);
        $response->headers->set('Vary', $this->buildVaryHeader($request));

        return $response;
    }

    private function resolveVersion(Request $request): string
    {
        $pathVersion = $request->route('version');
        if ($pathVersion) {
            return strtolower($pathVersion);
        }

        $headerVersion = $request->header('X-API-Version');
        if ($headerVersion) {
            return strtolower(trim($headerVersion));
        }

        $accept = $request->header('Accept', '');
        if (preg_match('/application\/vnd\.[\w\.-]+\.v(\d+)\+json/i', $accept, $matches)) {
            return 'v' . $matches[1];
        }

        return config('api_versioning.default', 'v1');
    }

    private function buildVaryHeader(Request $request): string
    {
        $vary = [];

        if ($request->headers->has('X-API-Version')) {
            $vary[] = 'X-API-Version';
        }

        if ($request->headers->has('Accept')) {
            $vary[] = 'Accept';
        }

        return implode(', ', array_unique($vary));
    }
}
```

如果你已经有统一 API 网关，这个设计会很实用。它允许历史路径版与新式 Header/MediaType 共存，并逐步迁移。

### 8.2 同时支持 URL 与 Header 的路由写法

```php
<?php

use App\Http\Controllers\Api\ProductController;
use Illuminate\Support\Facades\Route;

Route::middleware(['api', 'resolve.api.version'])->group(function () {
    Route::get('/{version}/products', [ProductController::class, 'index'])
        ->where('version', 'v1|v2');

    Route::get('/products', [ProductController::class, 'index']);
});
```

这样旧客户端仍用 `/api/v1/products`，新客户端可以用 `/api/products` + `X-API-Version: v2`。

## 九、中间件设计进阶：版本不仅要“解析出来”，还要“被全链路看见”

真正成熟的 API 版本中间件，至少应该解决以下五件事：

1. 解析版本
2. 校验版本是否合法
3. 设置请求上下文
4. 为响应附加版本/废弃信息
5. 为日志与监控打标签

### 9.1 在日志中记录版本

例如你有一个请求日志中间件：

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class LogApiRequest
{
    public function handle(Request $request, Closure $next): Response
    {
        $start = microtime(true);

        /** @var Response $response */
        $response = $next($request);

        Log::info('api_request', [
            'method' => $request->getMethod(),
            'path' => $request->path(),
            'api_version' => $request->attributes->get('api_version', 'unknown'),
            'status' => $response->getStatusCode(),
            'duration_ms' => round((microtime(true) - $start) * 1000, 2),
            'client' => $request->header('X-Client-Id'),
        ]);

        return $response;
    }
}
```

这看起来普通，但线上排查时极其重要。因为很多版本兼容问题，并不是“接口报错”，而是“返回成功但结构不对”。你必须有能力从日志里快速按版本聚类分析。

### 9.2 在监控中按版本统计

如果你接了 Prometheus，可以做类似埋点：

```php
$counter->inc([
    'route' => $request->route()?->getName() ?? 'unknown',
    'version' => $request->attributes->get('api_version', 'v1'),
    'status' => (string) $response->getStatusCode(),
]);
```

这样你可以看到：

- v1 调用量是否在下降；
- v2 是否出现异常尖峰；
- 某个版本的 5xx 是否明显升高；
- 废弃通知发出后，旧版本是否还在被大量访问。

### 9.3 对废弃版本加提示头

推荐在版本进入废弃阶段后，对响应增加以下头：

```http
Deprecation: true
Sunset: Wed, 31 Dec 2026 23:59:59 GMT
Link: <https://api.example.com/docs/migrate-to-v2>; rel="deprecation"
```

Laravel 中：

```php
$response->headers->set('Deprecation', 'true');
$response->headers->set('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
$response->headers->set('Link', '<https://api.example.com/docs/migrate-to-v2>; rel="deprecation"');
```

这类信息会极大提升版本迁移的可操作性，避免只靠群公告和邮件通知。

## 十、Laravel 代码实现：一套完整可运行的版本控制骨架

下面给出一套更接近生产项目的完整示例，核心目标是：

- 支持 URL / Header / Media Type 三种策略；
- 通过统一中间件解析版本；
- 通过工厂与策略模式隔离版本差异；
- 路由配置清晰；
- 为废弃治理和监控留出扩展点。

### 10.1 配置文件

创建 `config/api_versioning.php`：

```php
<?php

return [
    'default' => 'v1',

    'supported' => ['v1', 'v2'],

    'deprecated_versions' => [
        'v1' => [
            'deprecated' => true,
            'blocked' => false,
            'sunset_at' => 'Wed, 31 Dec 2026 23:59:59 GMT',
            'migration_doc' => 'https://api.example.com/docs/migrate-v2',
        ],
    ],

    'media_types' => [
        'v1' => 'application/vnd.demo.v1+json',
        'v2' => 'application/vnd.demo.v2+json',
    ],
];
```

### 10.2 统一版本解析中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveApiVersion
{
    public function handle(Request $request, Closure $next): Response
    {
        $version = $this->resolve($request);
        $supported = config('api_versioning.supported', ['v1']);

        if (! in_array($version, $supported, true)) {
            return response()->json([
                'message' => 'Unsupported API version.',
                'requested_version' => $version,
                'supported_versions' => $supported,
            ], 400);
        }

        $request->attributes->set('api_version', $version);
        app()->instance('api.version', $version);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set('X-API-Version', $version);

        $varyHeaders = $this->varyHeaders($request);
        if ($varyHeaders !== '') {
            $response->headers->set('Vary', $varyHeaders);
        }

        return $response;
    }

    private function resolve(Request $request): string
    {
        if ($routeVersion = $request->route('version')) {
            return strtolower(trim($routeVersion));
        }

        if ($headerVersion = $request->header('X-API-Version')) {
            return strtolower(trim($headerVersion));
        }

        $accept = $request->header('Accept', '');

        if (preg_match('/application\/vnd\.[\w\.-]+\.v(\d+)\+json/i', $accept, $matches)) {
            return 'v' . $matches[1];
        }

        if (preg_match('/application\/json\s*;\s*version=(\d+)/i', $accept, $matches)) {
            return 'v' . $matches[1];
        }

        return config('api_versioning.default', 'v1');
    }

    private function varyHeaders(Request $request): string
    {
        $headers = [];

        if ($request->headers->has('X-API-Version')) {
            $headers[] = 'X-API-Version';
        }

        if ($request->headers->has('Accept')) {
            $headers[] = 'Accept';
        }

        return implode(', ', array_unique($headers));
    }
}
```

### 10.3 废弃版本提示中间件

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AppendApiVersionDeprecationHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        /** @var Response $response */
        $response = $next($request);

        $version = $request->attributes->get('api_version', config('api_versioning.default', 'v1'));
        $deprecatedVersions = config('api_versioning.deprecated_versions', []);

        if (! isset($deprecatedVersions[$version])) {
            return $response;
        }

        $meta = $deprecatedVersions[$version];

        if (($meta['deprecated'] ?? false) === true) {
            $response->headers->set('Deprecation', 'true');
        }

        if (! empty($meta['sunset_at'])) {
            $response->headers->set('Sunset', $meta['sunset_at']);
        }

        if (! empty($meta['migration_doc'])) {
            $response->headers->set('Link', sprintf('<%s>; rel="deprecation"', $meta['migration_doc']));
        }

        return $response;
    }
}
```

### 10.4 路由示例

```php
<?php

use App\Http\Controllers\Api\ProductController;
use Illuminate\Support\Facades\Route;

Route::middleware([
    'api',
    'resolve.api.version',
    'append.api.version.deprecation.headers',
])->group(function () {
    // URL 版本策略
    Route::get('/{version}/products', [ProductController::class, 'index'])
        ->where('version', 'v1|v2');

    Route::get('/{version}/products/{id}', [ProductController::class, 'show'])
        ->where('version', 'v1|v2');

    // Header / MediaType 策略
    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/{id}', [ProductController::class, 'show']);
});
```

### 10.5 版本化 Resource

V1：

```php
<?php

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'price' => $this->price,
            'thumbnail' => $this->thumbnail,
        ];
    }
}
```

V2：

```php
<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'price' => [
                'amount' => $this->price,
                'currency' => 'TWD',
                'formatted' => 'NT$' . number_format($this->price),
            ],
            'media' => [
                'thumbnail' => $this->thumbnail,
                'gallery' => $this->gallery_urls,
            ],
            'flags' => [
                'is_preorder' => $this->is_preorder,
                'is_hot' => $this->is_hot,
            ],
        ];
    }
}
```

### 10.6 Resource 工厂

```php
<?php

namespace App\Support\ApiVersioning;

use App\Http\Resources\Api\V1\ProductResource as V1ProductResource;
use App\Http\Resources\Api\V2\ProductResource as V2ProductResource;
use Illuminate\Contracts\Pagination\Paginator;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

class VersionedProductPresenter
{
    public function one(Model $product, Request $request)
    {
        return match ($request->attributes->get('api_version', 'v1')) {
            'v2' => new V2ProductResource($product),
            default => new V1ProductResource($product),
        };
    }

    public function many(Paginator $products, Request $request)
    {
        return match ($request->attributes->get('api_version', 'v1')) {
            'v2' => V2ProductResource::collection($products),
            default => V1ProductResource::collection($products),
        };
    }
}
```

### 10.7 控制器

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ProductService;
use App\Support\ApiVersioning\VersionedProductPresenter;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    public function __construct(
        private ProductService $productService,
        private VersionedProductPresenter $presenter,
    ) {
    }

    public function index(Request $request)
    {
        $filters = $this->normalizeFilters($request);
        $products = $this->productService->getProductList($filters);

        return $this->presenter->many($products, $request);
    }

    public function show(Request $request, int $id)
    {
        $product = $this->productService->getProductDetail($id);

        return $this->presenter->one($product, $request);
    }

    private function normalizeFilters(Request $request): array
    {
        $version = $request->attributes->get('api_version', 'v1');

        return [
            'keyword' => $request->get('keyword'),
            'per_page' => $request->integer('per_page', 20),
            'sort' => $version === 'v2'
                ? $request->get('sort', 'recommended')
                : $request->get('sort', 'created_at_desc'),
        ];
    }
}
```

这套结构已经足够支撑大多数 Laravel API 版本演进场景。

### 10.8 Order 模块的完整版本化示例

很多文章只给 `ProductController`，但真实项目里版本演进更容易出现在订单、支付、结算这种高变更模块。下面补一套 `Order` 示例，分别展示 URL 版本的独立控制器，以及 Header / MediaType 场景下如何通过统一控制器承接。

`routes/api_v1.php`：

```php
<?php

use App\Http\Controllers\Api\V1\OrderController;
use Illuminate\Support\Facades\Route;

Route::post('/orders', [OrderController::class, 'store']);
Route::get('/orders/{id}', [OrderController::class, 'show']);
Route::post('/orders/{id}/cancel', [OrderController::class, 'cancel']);
```

`routes/api_v2.php`：

```php
<?php

use App\Http\Controllers\Api\V2\OrderController;
use Illuminate\Support\Facades\Route;

Route::post('/orders', [OrderController::class, 'store']);
Route::get('/orders/{id}', [OrderController::class, 'show']);
Route::post('/orders/{id}/cancellation', [OrderController::class, 'cancel']);
```

V1 控制器：

```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Api\V1\OrderResource;
use App\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function __construct(private OrderService $orderService)
    {
    }

    public function store(Request $request): JsonResponse
    {
        $order = $this->orderService->create([
            'user_id' => $request->user()->id,
            'product_id' => $request->integer('product_id'),
            'quantity' => $request->integer('quantity', 1),
            'coupon_code' => $request->get('coupon_code'),
        ]);

        return response()->json([
            'message' => 'Order created.',
            'data' => new OrderResource($order),
        ], 201);
    }

    public function show(int $id): OrderResource
    {
        return new OrderResource($this->orderService->detail($id));
    }

    public function cancel(int $id): JsonResponse
    {
        $this->orderService->cancel($id, 'user_requested');

        return response()->json([
            'message' => 'Order cancelled.',
        ]);
    }
}
```

V2 控制器：

```php
<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Resources\Api\V2\OrderResource;
use App\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function __construct(private OrderService $orderService)
    {
    }

    public function store(Request $request): JsonResponse
    {
        $order = $this->orderService->create([
            'user_id' => $request->user()->id,
            'product_id' => $request->integer('product_id'),
            'quantity' => $request->integer('quantity', 1),
            'coupon_code' => $request->get('coupon_code'),
            'source' => $request->get('source', 'app'),
            'idempotency_key' => $request->header('Idempotency-Key'),
        ]);

        return response()->json([
            'message' => 'Order created.',
            'data' => new OrderResource($order),
            'meta' => [
                'version' => 'v2',
            ],
        ], 201);
    }

    public function show(int $id): OrderResource
    {
        return new OrderResource($this->orderService->detail($id));
    }

    public function cancel(int $id): JsonResponse
    {
        $this->orderService->cancel($id, 'user_requested');

        return response()->json([
            'message' => 'Cancellation accepted.',
            'status' => 'processing',
        ]);
    }
}
```

统一服务层：

```php
<?php

namespace App\Services;

use App\Models\Order;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function create(array $payload): Order
    {
        return DB::transaction(function () use ($payload) {
            return Order::query()->create([
                'user_id' => $payload['user_id'],
                'product_id' => $payload['product_id'],
                'quantity' => $payload['quantity'],
                'coupon_code' => $payload['coupon_code'] ?? null,
                'source' => $payload['source'] ?? 'web',
                'status' => 'pending',
            ]);
        });
    }

    public function detail(int $id): Order
    {
        return Order::query()->with(['items', 'user'])->findOrFail($id);
    }

    public function cancel(int $id, string $reason): void
    {
        $order = Order::query()->findOrFail($id);
        $order->update([
            'status' => 'cancelled',
            'cancel_reason' => $reason,
        ]);
    }
}
```

V1 `OrderResource`：

```php
<?php

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'amount' => $this->amount,
            'created_at' => $this->created_at?->toDateTimeString(),
        ];
    }
}
```

V2 `OrderResource`：

```php
<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => [
                'code' => $this->status,
                'label' => str($this->status)->headline()->value(),
            ],
            'amount' => [
                'total' => $this->amount,
                'currency' => 'TWD',
            ],
            'created_at' => $this->created_at?->toIso8601String(),
            'links' => [
                'self' => url('/api/orders/' . $this->id),
            ],
        ];
    }
}
```

如果你选的是 Header / MediaType 策略，可以保留统一 `App\Http\Controllers\Api\OrderController`，然后像 `ProductController` 一样通过 Presenter 或 Resource Factory 分派 V1/V2 输出；路由层保持 `/api/orders` 不变，中间件负责把版本写入 `Request` 上下文即可。

### 10.9 一个更完整的版本解析中间件：支持来源标记、强制声明与回退策略

前面已经给出基础版 `ResolveApiVersion`，但生产环境里我更推荐下面这种“增强版”，因为它额外解决了三个常见问题：

1. 当前版本到底来自 URL、Header 还是 MediaType；
2. 某些新客户端是否必须显式声明版本；
3. 默认回退时是否需要打告警或附加调试头。

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveApiVersion
{
    public function handle(Request $request, Closure $next): Response
    {
        [$version, $source] = $this->resolveVersion($request);
        $supported = config('api_versioning.supported', ['v1']);

        if (($request->header('X-Require-Version') === 'true') && $source === 'default') {
            return response()->json([
                'message' => 'API version must be declared explicitly.',
                'supported_versions' => $supported,
            ], 400);
        }

        if (! in_array($version, $supported, true)) {
            return response()->json([
                'message' => 'Unsupported API version.',
                'requested_version' => $version,
                'detected_from' => $source,
                'supported_versions' => $supported,
            ], 400);
        }

        $request->attributes->set('api_version', $version);
        $request->attributes->set('api_version_source', $source);
        app()->instance('api.version', $version);

        /** @var Response $response */
        $response = $next($request);

        $response->headers->set('X-API-Version', $version);
        $response->headers->set('X-API-Version-Source', $source);

        if ($vary = $this->buildVaryHeader($request)) {
            $response->headers->set('Vary', $vary);
        }

        if ($source === 'default') {
            $response->headers->set('Warning', '199 - "API version fallback applied"');
        }

        return $response;
    }

    private function resolveVersion(Request $request): array
    {
        if ($routeVersion = $request->route('version')) {
            return [strtolower(trim($routeVersion)), 'url'];
        }

        if ($headerVersion = $request->header('X-API-Version')) {
            return [strtolower(trim($headerVersion)), 'header'];
        }

        $accept = $request->header('Accept', '');

        if (preg_match('/application\/vnd\.[\w\.-]+\.v(\d+)\+json/i', $accept, $matches)) {
            return ['v' . $matches[1], 'media_type'];
        }

        if (preg_match('/application\/json\s*;\s*version=(\d+)/i', $accept, $matches)) {
            return ['v' . $matches[1], 'media_type'];
        }

        return [config('api_versioning.default', 'v1'), 'default'];
    }

    private function buildVaryHeader(Request $request): string
    {
        $headers = [];

        if ($request->headers->has('X-API-Version')) {
            $headers[] = 'X-API-Version';
        }

        if ($request->headers->has('Accept')) {
            $headers[] = 'Accept';
        }

        return implode(', ', array_unique($headers));
    }
}
```

这个版本的价值很大：线上排查时你不只知道“走的是 v2”，还知道“为什么走到了 v2”。当你在做双栈兼容、灰度发布或者客户端升级追踪时，这个细节会非常关键。

## 十一、Nginx/CDN 缓存与网关配置：版本控制真正上线时最容易出事的地方

很多团队文章只讲 Laravel 代码，但实际把 API 放到 Nginx、Ingress、CDN、API Gateway 后，版本控制是否稳定很大程度取决于缓存层是否理解你的版本策略。

### 11.1 URL 版本的 Nginx 缓存示例

URL 版本最好配，因为路径本身就能区分缓存 key：

```nginx
proxy_cache_path /var/cache/nginx/api levels=1:2 keys_zone=api_cache:100m inactive=30m max_size=2g;

server {
    listen 80;
    server_name api.example.com;

    location /api/ {
        proxy_pass http://laravel_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_cache api_cache;
        proxy_cache_methods GET HEAD;
        proxy_cache_key "$scheme$request_method$host$request_uri";
        proxy_cache_valid 200 5m;

        add_header X-Cache-Status $upstream_cache_status always;
    }
}
```

这种情况下 `/api/v1/products` 和 `/api/v2/products` 天然是两个缓存键，几乎不需要额外解释。

### 11.2 Header 版本的 Nginx 缓存示例

Header 版本的关键点是：缓存键必须显式包含版本头，否则一定会串缓存。

```nginx
proxy_cache_path /var/cache/nginx/api levels=1:2 keys_zone=api_cache:100m inactive=30m max_size=2g;

map $http_x_api_version $api_version_header {
    default $http_x_api_version;
    "" "v1";
}

server {
    listen 80;
    server_name api.example.com;

    location /api/ {
        proxy_pass http://laravel_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-API-Version $api_version_header;

        proxy_cache api_cache;
        proxy_cache_methods GET HEAD;
        proxy_cache_key "$scheme$request_method$host$request_uri:$api_version_header";
        proxy_cache_valid 200 3m;

        add_header Vary "X-API-Version" always;
        add_header X-Cache-Status $upstream_cache_status always;
    }
}
```

这个配置比单纯依赖上游返回 `Vary` 更稳，因为它直接把 Header 纳入了 Nginx 缓存键。对于高流量接口，我一般建议“应用层返回 `Vary` + 网关层显式缓存键”双保险。

### 11.3 MediaType 版本的 Nginx 缓存示例

MediaType 版本常见做法是把 `Accept` 头纳入缓存键：

```nginx
proxy_cache_path /var/cache/nginx/api levels=1:2 keys_zone=api_cache:100m inactive=30m max_size=2g;

server {
    listen 80;
    server_name api.example.com;

    location /api/ {
        proxy_pass http://laravel_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Accept $http_accept;

        proxy_cache api_cache;
        proxy_cache_methods GET HEAD;
        proxy_cache_key "$scheme$request_method$host$request_uri:$http_accept";
        proxy_cache_valid 200 3m;

        add_header Vary "Accept" always;
        add_header X-Cache-Status $upstream_cache_status always;
    }
}
```

但这里有个现实问题：`Accept` 头往往比 `X-API-Version` 更复杂，同一路径会出现更多缓存变体，命中率可能下降。所以 MediaType 不是不能缓存，而是需要评估缓存空间、命中率和上游负载的平衡。

### 11.4 CDN 配置要点

如果你前面还有 Cloudflare、CloudFront、Fastly 或自建 CDN，建议至少检查以下事项：

1. URL 版本：确认缓存规则按完整路径区分；
2. Header 版本：确认 CDN 支持把 `X-API-Version` 纳入 cache key；
3. MediaType 版本：确认 CDN 支持按 `Accept` 建立变体；
4. 不要假设 CDN 会自动尊重所有 `Vary`，不少平台需要手动开启；
5. 灰度发布期间要确认回源命中与边缘缓存命中是否按版本隔离。

例如 CloudFront 的思路通常是：

- 创建独立 Cache Policy；
- 在 Header 白名单里加入 `X-API-Version` 或 `Accept`；
- 对 `/api/*` 单独挂行为策略；
- 用实时日志验证不同版本是否命中不同缓存键。

这一段经常被忽略，但它决定了你的版本控制是“代码层面成立”，还是“链路层面也成立”。

## 十二、Swagger / OpenAPI 文档如何做版本区分

API 一旦有多个版本，文档如果不分版，很快就会出现“示例能看、请求打不通、字段对不上”的混乱局面。Laravel 常见是配合 `l5-swagger` 或直接维护 OpenAPI YAML/JSON 文件。

### 12.1 最稳妥的方案：每个活跃版本一份独立 spec

目录示例：

```text
openapi/
├── v1.yaml
├── v2.yaml
└── components/
    ├── schemas/
    └── responses/
```

优点非常明显：

- 文档与版本边界一致；
- 前端、测试、第三方都容易理解；
- 下线某个版本时，可以直接冻结该 spec；
- 更利于做版本迁移 diff。

### 12.2 URL 版本的 OpenAPI 示例

```yaml
openapi: 3.0.3
info:
  title: Demo API v1
  version: v1
servers:
  - url: https://api.example.com/api/v1
paths:
  /products:
    get:
      summary: 获取商品列表
      responses:
        '200':
          description: ok
```

V2 只要把 `servers.url` 改成 `/api/v2`，并替换对应 schema 即可。

### 12.3 Header 版本的 OpenAPI 示例

Header 版本不改路径，但必须显式声明请求头参数：

```yaml
openapi: 3.0.3
info:
  title: Demo API Header Versioning
  version: v2
servers:
  - url: https://api.example.com/api
paths:
  /products:
    get:
      summary: 获取商品列表
      parameters:
        - in: header
          name: X-API-Version
          required: true
          schema:
            type: string
            enum: [v1, v2]
          example: v2
      responses:
        '200':
          description: ok
```

如果你在 Swagger UI 中展示 Header 版本，记得把它写成公共参数或 Security Scheme 的一部分，否则测试人员经常只点“Try it out”却忘了带 Header。

### 12.4 MediaType 版本的 OpenAPI 示例

MediaType 版本更适合在 `responses` 的 `content` 中表达：

```yaml
openapi: 3.0.3
info:
  title: Demo API Media Type Versioning
  version: v2
servers:
  - url: https://api.example.com/api
paths:
  /products:
    get:
      summary: 获取商品列表
      responses:
        '200':
          description: ok
          content:
            application/vnd.demo.v2+json:
              schema:
                $ref: '#/components/schemas/ProductV2Collection'
```

这种写法语义最完整，但对很多团队来说阅读门槛更高，因此我通常会在文档首页补一个“如何携带 Accept 头”的显式说明。

### 12.5 Laravel 项目中的文档分发实践

如果你使用 `l5-swagger`，可以考虑为每个版本生成独立文档入口，例如：

- `/api/docs/v1`
- `/api/docs/v2`

配套思路是：

1. 扫描不同命名空间或不同注解目录；
2. 生成独立的 JSON/YAML 输出文件；
3. 在文档首页标记版本状态：active / deprecated / sunset；
4. 为每个废弃版本附迁移文档链接。

如果你的接口版本差异明显，我更推荐完全拆成两个 spec，而不是在一个 spec 里硬塞大量 `oneOf`、`deprecated: true` 和条件说明。因为对阅读者来说，“两份清楚的文档”往往比“一份极其复杂的总文档”更友好。

## 十一、实际踩坑记录：真正让团队吃亏的，往往不是版本策略本身

下面这些坑，基本都是真实项目里高频出现的。很多不是“版本方法选错了”，而是“工程细节没跟上”。

### 坑 1：只做了路由版本，没做响应契约版本

很多团队以为路径从 `/v1/` 改到 `/v2/` 就叫版本控制，但实际上控制器里还是同一套返回结构。结果后面为了给 v2 改字段，又偷偷影响了 v1。

正确做法是：

- 路由版本只是入口；
- 真正的契约版本要在 Request / Resource 层落实；
- 最好有版本化测试保障响应结构不回归。

### 坑 2：v2 是复制 v1 后改出来的，三个月后没人敢动

这是 URL 版本项目里最常见的坑。上线 v2 时为了赶时间，整个 `V1` 目录复制为 `V2`，控制器、FormRequest、Resource、Service 全部复制。短期上线很快，长期却会出现：

- 同一个 bug 要修两遍；
- 同一个业务规则在两个版本里逐渐漂移；
- 新人根本看不出哪些是真差异，哪些只是历史复制。

解决思路：

- 领域服务尽量复用；
- 差异集中在 Resource / Request / Presenter；
- 做差异审查，避免“无差别复制”。

### 坑 3：Header 版本没配 Vary，CDN 缓存串版本

这是最隐蔽也最恶心的坑之一。客户端 A 请求：

```http
GET /api/products/1
X-API-Version: v1
```

CDN 缓存了响应。客户端 B 再请求：

```http
GET /api/products/1
X-API-Version: v2
```

如果 CDN 没按 `X-API-Version` 区分缓存 key，B 很可能直接拿到 v1 的缓存内容。应用本身日志看起来又一切正常，因为压根没打到 Laravel。

所以 Header 版本一定要：

- 响应 `Vary: X-API-Version`；
- 确认 CDN / Nginx / API Gateway 真的尊重它；
- 在测试环境模拟缓存链路验证。

### 坑 4：Media Type 版本只解析请求，不设置响应 Content-Type

这会导致服务端逻辑上识别了版本，但响应始终是：

```http
Content-Type: application/json
```

从协商语义上是不完整的，也会让调试人员误以为根本没走 Media Type 版本。比较严谨的做法是根据版本设置对应的 `Content-Type`。

### 坑 5：只靠默认版本回退，导致客户端版本错误长期不暴露

比如团队为了“兼容性友好”，规定 Header / Accept 没传时默认走 v1。问题是如果客户端本来应该走 v2，但因为代码 bug 没带版本头，服务端也不会报错，只会悄悄回到 v1，导致：

- 接口看似可用；
- 但字段结构和新逻辑都不对；
- 错误很久才被发现。

更稳妥的策略是：

- 对公开 API 可以保留默认回退；
- 对内部新接入客户端，必须强制显式带版本；
- 在灰度期对“未显式声明版本”的请求打告警。

### 坑 6：版本废弃只发公告，不在接口层表达

很多团队发一封邮件说“v1 将于下个月下线”，结果真正到下线当天还有大量调用方完全不知道。因为调用方开发者可能根本没看邮件。

应该把废弃信息直接打进响应里：

- `Deprecation: true`
- `Sunset: xxx`
- `Link: 迁移文档`

并在监控里观察哪些 client_id 还在持续使用旧版。

### 坑 7：版本测试没做隔离，回归时互相污染

如果测试只覆盖“接口能返回 200”，而不检查不同版本的契约差异，那很容易出现：

- 改了 v2 的字段；
- 不小心把 v1 的结构也改了；
- CI 依然绿。

建议至少为每个活跃版本维护一套契约测试。

例如：

```php
public function test_v1_product_response_shape(): void
{
    $this->getJson('/api/v1/products/1')
        ->assertOk()
        ->assertJsonStructure([
            'data' => [
                'id',
                'title',
                'price',
                'thumbnail',
            ],
        ]);
}

public function test_v2_product_response_shape(): void
{
    $this->getJson('/api/v2/products/1')
        ->assertOk()
        ->assertJsonStructure([
            'data' => [
                'id',
                'title',
                'price' => ['amount', 'currency', 'formatted'],
                'media' => ['thumbnail', 'gallery'],
                'flags' => ['is_preorder', 'is_hot'],
            ],
        ]);
}
```

### 坑 8：版本号和发布日期混用，没有治理规则

有些团队今天用 `v1` / `v2`，明天又想用 `2026-06-01` 这种日期版号，后面文档和代码到处混杂。其实两种方式都可以，但要统一规则。

常见建议：

- 对公众开放、长期维护的 API：使用 `v1`、`v2` 更直观；
- 对内部迭代非常快的 API：可考虑日期版本，但必须有明确废弃政策。

最怕的是规则混搭，导致所有地方都需要额外解释。

### 坑 9：版本回退没有预案，紧急发布时只能硬回滚整站

很多团队做了 v2 上线，却没做“回到 v1”的预案。真正出问题时，要么整个应用回滚，要么仓促在控制器里加 `if/else`。这说明系统根本没有把“版本回退”当成工程能力设计。

比较稳的做法是：

- 保留版本到路由/中间件/配置的独立开关；
- 新版本功能通过 Feature Flag 或版本白名单启用；
- 保证 v1 / v2 至少有一段时间双栈可用；
- 关键客户端可单独降级到旧版本，而不是全量回滚。

例如配置层可以这样做：

```php
return [
    'default' => env('API_DEFAULT_VERSION', 'v1'),
    'force_version_for_clients' => [
        'ios-legacy' => 'v1',
        'partner-a' => 'v1',
    ],
];
```

中间件里根据 `X-Client-Id` 决定是否强制回退到指定版本，这样线上止血速度会快很多。

### 坑 10：灰度发布只做流量切分，没做版本观测

灰度并不只是“10% 走 v2”。如果你看不到以下指标，灰度本身就没有意义：

- 不同版本的成功率、错误率、延迟；
- 灰度用户的客户端类型、地区、渠道；
- 回退到旧版本的比例；
- 哪些接口在 v2 出现字段兼容性问题。

建议在灰度期至少把以下字段写进日志：

```php
Log::info('api_version_rollout', [
    'api_version' => $request->attributes->get('api_version'),
    'api_version_source' => $request->attributes->get('api_version_source'),
    'client_id' => $request->header('X-Client-Id'),
    'user_id' => optional($request->user())->id,
    'route' => $request->route()?->uri(),
]);
```

只有这样，你才知道“是版本策略有问题”，还是“某个特定客户端没按规范升级”。

### 坑 11：双栈兼容只保留接口，不保留语义映射

双栈兼容并不是简单地让 `/v1/orders` 和 `/orders + X-API-Version: v2` 同时可用。真正困难的是：

- 字段名是否有映射表；
- 错误码是否保持兼容；
- 旧客户端依赖的默认值是否还成立；
- 排序、筛选、分页规则是否发生隐式变化。

比较推荐在迁移文档里补一张“语义映射表”，例如：

| v1 字段/行为 | v2 字段/行为 | 说明 |
|---|---|---|
| `price: 100` | `price.amount: 100` | 基础数值拆分为金额对象 |
| `status: pending` | `status.code: pending` | 兼容机器读取，新增 label |
| 默认按创建时间倒序 | 默认按推荐权重排序 | 客户端如依赖旧排序，需显式传参 |

这张表对前后端联调、测试回归、第三方迁移都非常有帮助。

## 十二、三种策略如何选：给 Laravel 团队的实用决策建议

如果你让我在大多数 Laravel 项目里给一个务实建议，我会这样分：

### 12.1 优先选 URL 版本的情况

- 团队规模不大，但业务变化很快；
- 第三方、前端、客户端对接方很多；
- 需要快速建立清晰的版本治理边界；
- 希望监控、日志、路由、缓存都尽量简单。

一句话：先把版本治理做对，比把版本设计做“优雅”更重要。

### 12.2 可以选 Header 版本的情况

- 调用方主要是内部系统；
- 团队对中间件、网关、缓存、SDK 封装比较熟练；
- 想保持 URL 长期稳定；
- 版本差异主要体现在输出字段而不是资源路径重构。

### 12.3 适合尝试 Media Type 版本的情况

- API 设计规范要求高；
- 团队熟悉 HTTP 内容协商；
- 有能力维护清晰的文档、SDK、网关缓存策略；
- 对接方也愿意遵守规范。

### 12.4 一个非常现实的建议

对于 80% 的 Laravel 业务系统：

- 对外开放 API：优先 URL 版本；
- 内部平台 API：可以考虑 Header 版本；
- 强规范平台或实验性架构：再考虑 Media Type。

工程里最贵的不是“方案不够优雅”，而是“方案超出了团队的执行能力”。

## 十三、版本控制之外，还要建立哪些配套机制

只做版本路由还远远不够。要让版本控制真正成为可持续工程能力，还需要以下配套：

### 13.1 API 变更分级制度

把变更分成：

1. 非破坏性变更
   新增字段、增加可选参数。
2. 弱破坏性变更
   默认排序变化、枚举含义调整。
3. 强破坏性变更
   字段删除、字段类型变更、认证方式变化。

只有强破坏性变更强制升主版本，弱破坏性变更也要评审确认是否需要版本隔离。

### 13.2 版本生命周期管理

建议每个版本都定义：

- 发布日期
- 当前状态：active / deprecated / sunset / retired
- 计划下线日期
- 迁移文档地址
- 当前调用量
- 主要调用方名单

这个信息最好不只写在 Confluence，而是和代码配置、监控看板对应起来。

### 13.3 自动化测试矩阵

对活跃版本建立独立测试矩阵：

- 契约测试
- 授权测试
- 错误码测试
- 分页/排序/筛选测试
- 回归测试

如果没有测试兜底，版本越多，越容易在重构时互相踩踏。

### 13.4 文档同步机制

版本控制一旦上线，文档必须和代码同步，否则对接方第一反应一定是“你们接口到底哪个才是准的”。

建议：

- 每个版本一套独立文档章节；
- 明确标记 deprecated / sunset；
- 给出 v1 → v2 的迁移映射表；
- 在示例请求中清楚展示 URL/Header/Accept 的写法。

## 十四、一个完整的迁移案例：从 URL v1 平滑演进到 Header v2

假设你有一个 Laravel 老项目，当前所有接口都是：

```text
/api/v1/products
/api/v1/orders
```

现在你希望给内部客户端提供不带版本路径的新地址：

```text
/api/products
/api/orders
```

同时通过 `X-API-Version: v2` 驱动新版本。这时最稳妥的做法不是直接替换，而是三步走。

### 第一步：统一版本解析中间件

让老 URL 和新 Header 都走同一个 `ResolveApiVersion` 中间件，形成唯一版本入口。

### 第二步：统一控制器入口，版本差异沉到 Presenter/Resource

即使保留 `/v1/` 路径，也尽量让核心业务逻辑统一，减少双栈维护成本。

### 第三步：对 v1 开启废弃头与监控

通过监控确认调用量下降，再决定 Sunset 节点。

如果你还要进一步做灰度，可以在 API Gateway 或应用层增加按客户端切分的逻辑，例如：

- `X-Client-Id in [ios-beta, android-beta]` 时允许 Header `v2`；
- 非白名单客户端即使带了 `v2` 也先回退到 `v1`；
- 对白名单客户端单独观察错误率和响应结构投诉。

这类灰度方式最大的好处是：版本切换不是一次性切全量，而是一个可观测、可回退的过程。

这类渐进迁移的最大价值是：你不是“重写一套新 API”，而是在原有体系上逐步引入更高阶的版本治理能力。

## 十五、我在 Laravel 里最终形成的一套经验结论

写到这里，其实可以把核心结论收一收。

第一，API 版本控制本质上是兼容性治理，不是路径命名游戏。

第二，三种策略没有绝对优劣，只有团队是否驾驭得住。

第三，在 Laravel 这种以工程效率见长的框架里，URL 版本通常是最稳的起点；Header 版本适合作为内部增强；Media Type 版本更像是高成熟度团队的高级玩法。

第四，真正决定版本控制质量的，不是你把版本放在 URL、Header 还是 Accept，而是你有没有把这些配套一起做好：

- 路由组织
- 中间件解析
- Request/Resource 契约隔离
- 日志监控
- 缓存 Vary
- 废弃治理
- 自动化测试

如果这些都没有，哪怕用了最“标准”的 Media Type 版本，线上一样会出事故；反过来，如果这些都扎实，哪怕你用的是最朴素的 URL 版本，也完全可以支撑很长时间的业务演进。

## 十六、结语

API 的版本控制从来不是一次性设计，而是一套会随着系统一起成长的机制。早期你可能只需要一个 `/v1`，中期你会发现需要中间件统一管理版本上下文，后期你会开始关心废弃头、Sunset、Vary、缓存一致性、按版本监控、迁移看板与契约测试。也就是说，版本控制不是某个“选项”，它最终会成为 API 工程治理的一部分。

如果你现在正在做 Laravel API，而且还没有明确版本策略，我的建议很简单：先选一个团队最能稳定执行的方案，通常就是 URL 版本；然后把中间件、资源层、监控和废弃治理一步一步补起来。等这些基础能力齐了，再考虑 Header 或 Media Type 这种更抽象的表达。因为在真正的工程实践里，能持续维护十个版本迭代周期的，从来不是最花哨的设计，而是最清楚、最可控、最不容易出错的设计。

## 相关阅读

- [OAuth 2.0 实战：Laravel Passport 自定义 Grant Type 与第三方登录](/categories/Laravel/Laravel-Passport-OAuth2-自定义-Grant-Type-与第三方登录实战/)
- [敏感数据保护实战：加密存储、脱敏展示、审计日志合规](/categories/Laravel/敏感数据保护实战-加密存储脱敏展示审计日志合规-Laravel-B2C-API踩坑记录/)
- [ETL 实战：Laravel + Apache Airflow 数据管道构建](/categories/Laravel/ETL-实战-Laravel-Airflow-数据管道构建/)
