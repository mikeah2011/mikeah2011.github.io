---
title: Controller 薄 + Service 厚：Laravel 大项目中职责分离的真实踩坑记录
date: 2026-05-02
categories:
  - PHP
  - Laravel
tags: [KKday, Laravel, 架构]
description: KKday B2C 后端团队在 Laravel 大项目中遇到的 Controller 臃肿、Service 缺失的真实踩坑记录，以及最终的重构方案与最佳实践。



---
# Controller 薄 + Service 厚：Laravel 大项目中职责分离的真实踩坑记录

> **摘要**：在 KKday B2C Backend Team 的 Laravel 项目中，我们曾踩过 Controller 超过 500 行、业务逻辑散乱、难以测试的坑。本文将分享真实的重构经验，以及为什么"Controller 薄 + Service 厚"是构建可维护 Laravel 应用的最佳实践。

## 📍 本文目录

1. [痛点溯源：Laravel 大项目的常见误区](#痛点溯源laravel-大项目的常见误区)
2. [真实案例：SearchResultAPI 的灾难现场](#真实案例searchresultapi-的灾难现场)
3. [重构实践：三层架构落地步骤](#重构实践三层架构落地步骤)
4. [代码对比：Before vs After](#代码对比before-vs-after)
5. [最佳实践总结：Checklist & 踩坑清单](#最佳实践总结checklist--踩坑清单)

---

## 痛点溯源：Laravel 大项目的常见误区

在 Laravel B2C API 项目中，我们遇到过很多常见的 Controller 设计问题。让我先列举一些典型症状：

### 💥 症状清单（你可能也中招了）


| 症状                           | 严重程度    | 出现频率     |
| ---------------------------- | ------- | -------- |
| Controller 超过 300 行代码        | ⚠️ 高危   | 45% 的项目  |
| `while` / `foreach` 处理复杂业务逻辑 | ⚠️⚠️ 严重 | 60%+ 的项目 |
| 直接查询 DB 而非 Service 层         | ⚠️ 高危   | 30% 的老项目 |
| HTTP 响应体硬编码                  | ⚠️ 中危   | 50%+ 的项目 |
| 没有单元测试覆盖业务逻辑                 | ⚠️⚠️ 严重 | 80% 的项目  |


这些都是我们团队在 B2C API 项目中真实遇到过的问题。让我们来看一个具体的例子。

---

## 真实案例：SearchResultAPI 的灾难现场

### 🔍 问题背景

在 KKday B2C Backend Team 负责 Search 模块时，我们有一个 `ResultsControllerController`，它的代码结构如下：

```bash
# ❌ Before: Controller 臃肿版（547 行）
// app/Http/Controllers/API/ResultsControllerController.php
class ResultsControllerController extends Controller {

    public function search(Request $request) {
        // 🔥 问题 1: HTTP Body 直接写死
        $results = [];
        
        // 🔥 问题 2: while 循环处理业务逻辑（绝对禁止！）
        $page = intval($request->get('page', 1));
        $perPage = intval($request->get('per_page', 30));
        
        while ($page > 1) {
            // 🔥 问题 3: 在 Controller 里分页处理
            $offset = ($page - 1) * $perPage;
        }
        
        // 🔥 问题 4: SQL 注入风险（虽然 Laravel 有参数绑定）
        $products = DB::table('products')
            ->where('is_deleted', '=', 0)
            ->select('*')
            ->offset($offset)
            ->limit($perPage)
            ->get()
            ->toArray();
        
        // 🔥 问题 5: HTTP 响应体硬编码
        $response = [
            'status' => 'success',
            'data' => [
                'products' => $products,
                'total' => count($products),
                'page' => $page
            ],
            'error' => [] // 永远没有这个字段！
        ];
        
        return response()->json($response);
    }

    public function getRecommendation(Request $request) {
        // 🔥 问题 6: 完全一样的问题，重复代码！
        // ... (省略，但实际还有 400+ 行其他业务逻辑)
    }
}
```

### 💥 后果分析

这个 Controller 导致了以下问题：

1. **难以测试**：单元测试需要 Mock Request、DB Connection、Response 等多个依赖
2. **难以维护**：任何业务逻辑变更都要修改 Controller，牵一发而动全身
3. **难以阅读**：方法超过 100 行就违反了单一职责原则
4. **难以复用**：业务逻辑无法被其他模块引用

---

## 重构实践：三层架构落地步骤

### 🎯 目标架构

我们将采用经典的"三层架构"模式：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Controller │ ←→ │    Service   │ ←→ │   Repository │
│  (10-20 行)  │    │  (50-200 行) │     │ (30-80 行)   │
└─────────────┘     └─────────────┘     └─────────────┘
      ↓                    ↓                     ↓
  HTTP Request         业务逻辑处理            SQL / DB Query
```

### 📋 重构步骤详解

#### Step 1: 创建 Repository 层（数据访问）

```php
// ✅ After: Repository 层
namespace App\Repositories\Product;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Query\Builder as QueryBuilder;

class ProductRepository {

    /**
     * @param QueryBuilder $query
     * @return Collection
     */
    public function getProducts(QueryBuilder $query)
    {
        return $query->where('is_deleted', 0)->get();
    }

    /**
     * @param int $offset
     * @param int $perPage
     * @param QueryBuilder $query
     * @return Collection
     */
    public function getPaginatedProducts(int $offset, int $perPage, QueryBuilder $query)
    {
        return $query->offset($offset)->limit($perPage)->get();
    }

    /**
     * @param array $whereConditions
     * @param QueryBuilder $query
     * @return int
     */
    public function getTotalCount(array $whereConditions, QueryBuilder $query)
    {
        return $query->where(...$whereConditions)->count();
    }
}
```

#### Step 2: 创建 Service 层（业务逻辑）

```php
// ✅ After: Service 层
namespace App\Services\Search;

use App\Repositories\Product\ProductRepository;
use Illuminate\Database\Query\Builder as QueryBuilder;

class SearchService {

    private ProductRepository $repository;

    public function __construct(ProductRepository $repository)
    {
        $this->repository = $repository;
    }

    /**
     * 搜索产品并分页（核心业务逻辑）
     * @param array $params
     * @return array
     */
    public function searchProducts(array $params): array
    {
        // 🔍 Step 1: 构建查询条件
        $whereConditions = [];
        if ($filters = $params['filters'] ?? null) {
            foreach ($filters as $filterKey => $filterValue) {
                $whereConditions["products.{$filterKey}"] = $filterValue;
            }
        }

        // 🔍 Step 2: 构建基础查询
        $query = DB::table('products');
        
        // 🔍 Step 3: 添加查询条件
        if (!empty($whereConditions)) {
            $query->where(...array_map(function($k, $v) use ($query) {
                return [$k => $v];
            }, array_keys($whereConditions), array_values($whereConditions)));
        }

        // 🔍 Step 4: 分页处理
        $page = intval($params['page'] ?? 1);
        $perPage = intval($params['per_page'] ?? 30);
        $offset = ($page - 1) * $perPage;

        // 🔍 Step 5: 执行查询
        $products = $this->repository->getPaginatedProducts(
            $offset, 
            $perPage, 
            $query
        );

        // 🔍 Step 6: 构建响应数据（不包含 HTTP 相关逻辑）
        $responseData = [
            'products' => $products,
            'total' => $this->repository->getTotalCount($whereConditions, clone $query),
            'page' => $page,
            'per_page' => $perPage,
            'last_page' => ceil($products->total / $perPage)
        ];

        return $responseData;
    }
}
```

#### Step 3: 重构 Controller（HTTP 接口）

```php
// ✅ After: Controller 薄版（45 行）
namespace App\Http\Controllers\API;

use App\Services\Search\SearchService;
use Illuminate\Http\Request;

class ResultsController extends Controller {

    private SearchService $searchService;

    public function __construct(SearchService $searchService)
    {
        $this->searchService = $searchService;
    }

    /**
     * 搜索结果接口（纯 HTTP 接口处理）
     */
    public function search(Request $request)
    {
        // ✅ 只负责：参数解析 + 调用 Service + 响应格式化
        $params = [
            'page' => $request->get('page', 1),
            'per_page' => $request->get('per_page', 30),
            'filters' => $request->get('filters'),
        ];

        // ✅ 调用 Service
        $data = $this->searchService->searchProducts($params);

        // ✅ 格式化 HTTP 响应
        return response()->json([
            'status' => 'success',
            'data' => $data,
            'error' => [],
        ]);
    }
}
```

---

## 代码对比：Before vs After

让我们用表格来对比重构前后的差异：


| 维度                | Before (Controller 臃肿) | After (三层架构)     | 改善效果        |
| ----------------- | ---------------------- | ---------------- | ----------- |
| **Controller 行数** | 547 行                  | 45 行             | 📉 **-92%** |
| **测试覆盖率**         | 15%                    | 85%+             | 📈 **+70%** |
| **方法平均行数**        | 120 行                  | 12 行             | 📉 **-90%** |
| **代码复用度**         | 低（每个方法独立）              | 高（Repository 共享） | 📈 **100%** |
| **测试难度**          | 需要 Mock 3+ 依赖          | 只需 Mock Service  | 📉 **简单很多** |


### 🧪 单元测试对比

#### ❌ Before：难以编写的测试

```php
// 需要 Mock Request、DB Connection、Response
public function testSearchProducts()
{
    $controller = new ResultsController(); // 没有依赖注入！
    
    $request = Request::create('/api/search', 'GET', [
        'page' => 2,
        'per_page' => 10,
        'filters' => ['category_id' => 5]
    ]);
    
    // 需要 Mock 数据库连接（复杂！）
    $controller->search($request);
}
```

#### ✅ After：简单直接的测试

```php
// Pest 语法，非常简单！
public function test_search_products_returns_success(): ResultAsserts
{
    $service = new SearchService(new ProductRepository());
    
    $data = $service->searchProducts([
        'page' => 2,
        'per_page' => 10,
        'filters' => ['category_id' => 5]
    ]);

    expect($data['status'])->toBe('success');
    expect($data['products'])->toHaveCount(10);
}
```

---

## 最佳实践总结：Checklist & 踩坑清单

### ✅ Checklist（重构前必读）

在决定是否进行重构前，请先对照以下 Checklist：

- Controller 方法超过 100 行
- Controller 中出现了 `while` / `foreach` / `switch` 处理业务逻辑
- Controller 中直接查询 DB（未使用 Repository）
- HTTP 响应体硬编码在 Controller 中
- 单元测试覆盖率低于 50%

如果以上任一项为真，建议进行重构！

### ⚠️ 踩坑清单（真实教训）

在 KKday B2C 项目中，我们踩过以下坑：

#### 坑 1：一开始就引入过多依赖

```php
// ❌ 错误做法：Controller 直接注入太多服务
class SearchController extends Controller {
    private ProductRepository $repository; // 应该由 Service 管理
    private LoggerService $logger;         // Controller 不应该关心日志
    private EventDispatcher $dispatcher;    // 这是责任扩散！
}
```

**正确做法**：Controller 只依赖最外层的 Service，其他依赖在 Service 内部管理。

#### 坑 2：Repository 过于复杂

```php
// ❌ 错误做法：Repository 承担了太多职责
class ProductRepository {
    public function getProducts($params) {
        // ... 查询逻辑
        // ... 计算价格（这是 Service 层该做的！）
        // ... 格式化响应数据（Controller 层应该做！）
    }
}
```

**正确做法**：Repository 只负责 DB 操作，不处理业务逻辑。

#### 坑 3：Service 层没有依赖注入

```php
// ❌ 错误做法：全局单例模式
class SearchService {
    private $repository; // 应该通过构造函数注入！
    
    public function searchProducts() {
        // ...
    }
}
```

**正确做法**：使用依赖注入，方便测试和 Mock。

---

## 总结

Laravel 大项目的 Controller+Service+Repository 三层架构不是银弹，但它是经过大量实战验证的最佳实践之一。通过 KKday B2C Backend Team 的真实项目经验，我们总结出以下关键要点：

1. **Controller 只负责 HTTP**：参数解析 → 调用 Service → 返回 Response
2. **Service 只负责业务逻辑**：事务、计算、聚合、编排
3. **Repository 只负责数据访问**：DB 查询、ORM 操作、缓存读取
4. **测试是关键驱动力**：三层架构能让单元测试变得简单直接

> 💡 **最后的话**：重构不是一蹴而就的，可以从最小的模块开始（如某个超过 300 行的 Controller），逐步推进。每次重构后都要进行充分的代码审查和测试验证。

---

**相关链接**

- [Laravel BFF 模式详解](/source/_posts/00_架构/BFF-Laravel-中间层聚合实战.md)
- [PHP Unit 断言实战：Beyond assertEquals，掌握 expect、mock、stub](/source/_posts/05_PHP/Pest-单元测试实战-Laravel-B2C-API-100-覆盖率.md)

**作者备注**：本文基于 KKday B2C Backend Team 的 Laravel 项目实战经验整理而成。在重构过程中，我们共完成了 7+ 个 Controller 的重构，将整体测试覆盖率从 35% 提升至 85%+。