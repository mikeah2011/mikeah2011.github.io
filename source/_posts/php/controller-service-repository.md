---

title: Controller-Service-Repository 三層架構設計與大項目職責分離 - 真實踩坑記錄
keywords: [Controller, Service, Repository, 三層架構設計與大項目職責分離, 真實踩坑記錄]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-03
categories:
- php
tags:
- Laravel
- controller
- service
- repository
- 设计模式
- PHP
- BFF
- 架构
description: Laravel Controller-Service-Repository 三层架构实战指南，详解服务层（Service）业务逻辑聚合、仓储层（Repository）数据访问抽象与接口化设计，覆盖 BFF 聚合场景的事务管理、跨服务补偿策略、Repository Interface 多数据源切换、单元测试策略，以及从小项目到大项目的架构演进路径与踩坑记录。
---



## 一、為什麼大項目需要三層架構？

### 職責分離的必要性

隨著 **KKday B2C API 團隊** 從單人開發成長為 **30+ Laravel 倉庫** 的規模，我們逐漸發現：

| 階段 | 問題現象 | 根本原因 |
|------|----------|----------|
| **小項目（<5K LOC）** | Controller 包羅萬象 | 職責未分離 |
| **中項目（5-10K LOC）** | 單個文件超過 800 行 | 邏輯混雜難維護 |
| **大項目（>10K LOC）** | 新增測試覆蓋率 <60% | 無法定位測試用例 |

**真實案例：**

```php
// ❌ 小項目初期：Controller 包羅萬象
public function index()
{
    $user = Auth::user();
    
    // 🔥 問題 1：業務邏輯混雜
    $items = DB::table('items')
        ->where('user_id', $user->id)
        ->get();
        
    // 🔥 問題 2：事務管理分散
    if ($items->count() > 0) {
        try {
            $totalPrice = $this->calculateTotal($items); // 🔥 計算邏輯
            $orderItems = OrderItem::createMany(
                [
                    (new OrderItem(['item' => $items[0], 'price' => 100, 'quantity' => 1]))
                ]
            );
            
            // 🔥 問題 3：重複代碼
            Event::dispatch('order.created', compact('totalPrice'));
            
        } catch (Exception $e) {
            DB::rollBack(); // 🔥 沒有統一回滾邏輯
            throw new OrderException($e->getMessage());
        }
    }
    
    return view('items.index', [
        'items' => $items,
        'pageTitle' => '我的商品清單'
    ]);
}
```

### 架構模式對比：傳統 MVC vs CSR vs CQRS

| 維度 | 傳統 MVC | Controller-Service-Repository (CSR) | CQRS |
|------|----------|--------------------------------------|------|
| **分層數量** | 3 層（Controller → Model → View） | 3 層（Controller → Service → Repository） | 4+ 層（Command/Query Handler → Read/Write Model） |
| **Controller 職責** | HTTP 入口 + 業務邏輯混雜 | 純 HTTP 入口，僅參數驗證 + Response | 純 HTTP 入口，轉發到 Command Bus |
| **業務邏輯位置** | Controller 或 Model 中散落 | Service 層集中管理 | Command Handler（寫）/ Query Handler（讀） |
| **數據訪問** | Model 直接操作 DB | Repository 抽象，支持多數據源 | Write Model + Read Model 獨立優化 |
| **可測試性** | ⭐⭐ 需啟動 HTTP + DB | ⭐⭐⭐⭐ Service 可 Mock Repository 單元測試 | ⭐⭐⭐⭐⭐ 讀寫分離，各自獨立測試 |
| **適用場景** | 小型項目（<5K LOC） | 中大型項目（5K-100K LOC） | 超大型項目（>100K LOC，讀寫比 >10:1） |
| **Laravel 實現** | 原生路由 + Eloquent | Service + Repository Interface + IoC | Command Bus + Event + ReadModel 投影 |
| **學習成本** | 低 | 中（需理解依賴注入與接口設計） | 高（需理解事件溯源與最終一致性） |

### C-S-R 三層架構的核心優勢

| 優點 | 說明 | 量化收益 |
|------|------|----------|
| **可測試性** | Service 層易於單元測試 | 測試覆蓋率提升至 85%+ |
| **可維護性** | 職責清晰，新人上手快 | Bug 定位時間減少 70% |
| **可擴展性** | 新增功能無需改 Controller | 開發效率提升 40% |

---

## 二、KKday B2C API 的架構實踐

### 標準三層目錄結構

```
app/
├── Controllers/API/          # BFF 層的 HTTP 請求入口
│   ├── ProductController.php
│   └── OrderController.php
├── Services/                 # 業務邏輯核心區
│   ├── ProductService.php
│   ├── OrderService.php
│   └── SearchService.php
├── Repositories/             # 數據訪問抽象層
│   ├── ProductRepository.php
│   ├── OrderRepository.php
│   └── Interfaces/          # Repository Interface 定義
├── Models/                   # Eloquent Model（含 Factory）
│   ├── Product.php
│   ├── Order.php
│   └── Contracts/           # Model Contract 定義
```

### 層級職責邊界

| 層級 | 職責範圍 | 禁止事項 |
|------|----------|----------|
| **Controller** | HTTP 路由、請求參數驗證、Response 格式化 | ❌ 業務邏輯、❌ 數據查詢、❌ 事務管理 |
| **Service** | 核心業務邏輯、事務協調、業務規則判斷 | ❌ 直接 DB 操作、❌ HTTP 調用（除非 BFF 聚合） |
| **Repository** | CRUD 操作、索引優化、批量查詢 | ❌ 業務邏輯、❌ 外部服務調用 |

---

## 三、实战一：BFF 層的 Controller-Service 分離

### 場景：ProductController 聚合多個 GraphQL 來源

在 KKday B2C API 中，我們使用 **Laravel BFF 模式**，聚合來自後端 Java/GraphQL 多源數據。

#### ❌ 錯誤做法：Controller 直接調用多個外部服務

```php
// ⚠️ 單個 Controller 文件超過 1000 行！
class ProductSearchController extends Controller
{
    protected $recommendService;
    protected $searchService;
    protected $categoryService;
    
    public function __construct(RecommendService $recommendService, 
                                 SearchService $searchService,
                                 CategoryService $categoryService)
    {
        $this->recommendService = $recommendService;
        $this->searchService = $searchService;
        $this->categoryService = $categoryService;
    }
    
    public function search()
    {
        // 🔥 問題：邏輯混雜，難以測試
        $query = Request::input('q');
        $page = Request::input('page', 1);
        
        // 查詢推薦結果
        $recommendList = $this->recommendService->get(5);
        
        // 查詢搜索結果
        $searchResult = $this->searchService->query($query, $page);
        
        // 查詢分類資訊
        $categories = CategoryService::active()->getCategories();
        
        // 🔥 問題：事務沒包起來，部分更新
        try {
            Event::dispatch('search.started', ['q' => $query]);
            
            // 🔥 問題：業務邏輯在 Controller，測試困難
            $combined = [
                'recommend' => $recommendList,
                'search' => $searchResult['items'],
                'total' => $searchResult['total']
            ];
            
            if (empty($combined)) {
                return Response::json(['message' => '無結果'], 404);
            }
            
            Event::dispatch('search.completed', ['q' => $query]);
            
            // 🔥 問題：Response 格式化在 Controller，無法複用
            return Response::view('products.search', [
                'data' => $combined,
                'page' => $page,
                'title' => Request::input('q')
            ]);
            
        } catch (Exception $e) {
            // 🔥 問題：錯誤處理分散在各處
            return Response::json(['message' => '搜索失敗'], 500);
        }
    }
}
```

#### ✅ 正確做法：三層職責分離

**Step 1: Controller - 只負責 HTTP 入口與 Response 格式化**

```php
// app/Controllers/API/ProductSearchController.php
namespace App\Controllers\API;

use App\Services\ProductSearchService;
use App\Http\Requests\ProductSearchRequest;
use App\Models\SearchResult;

class ProductSearchController extends Controller
{
    protected ProductSearchService $searchService;
    
    public function __construct(ProductSearchService $searchService)
    {
        $this->searchService = $searchService;
    }
    
    /**
     * 搜索商品列表（BFF 層聚合）
     */
    public function search(ProductSearchRequest $request): SearchResult
    {
        // ✅ Controller 只負責：
        // 1. 驗證請求參數（Request validation）
        // 2. 調用 Service 獲取業務邏輯結果
        // 3. 返回格式化 Response
        
        $params = [
            'keyword' => $request->input('q'),
            'page' => $request->input('page', 1),
            'limit' => $request->input('limit', 20)
        ];
        
        // 🔥 核心業務邏輯交給 Service，Controller 只管 HTTP
        return $this->searchService->execute($params);
    }
}
```

**Step 2: Service - 核心業務邏輯聚合**

```php
// app/Services/ProductSearchService.php
namespace App\Services;

use App\Repositories\ProductRepository;
use App\Repositories\RecommendRepository;
use App\Models\SearchResultModel;

class ProductSearchService extends BaseService
{
    protected ProductRepository $productRepo;
    protected RecommendRepository $recommendRepo;
    
    public function __construct(ProductRepository $productRepo,
                                RecommendRepository $recommendRepo)
    {
        $this->productRepo = $productRepo;
        $this->recommendRepo = $recommendRepo;
    }
    
    /**
     * 搜索服務核心邏輯（BFF 層聚合）
     */
    public function execute(array $params): SearchResultModel
    {
        // ✅ Service 負責：
        // 1. 業務規則判斷
        // 2. 協調多個 Repository 查詢
        // 3. 事務管理（如需）
        
        $keyword = trim($params['keyword']);
        
        if (strlen($keyword) < 2) {
            // 搜索關鍵字必須至少 2 個字
            throw new BusinessException('搜索關鍵字不能少於 2 個字', 400);
        }
        
        try {
            // 🔥 第一步：先查詢推薦結果
            $recommendList = $this->recommendRepo->getRecommendations(5, null);
            
            // 🔥 第二步：查詢搜索結果
            $searchResult = $this->productRepo->searchProducts($keyword, $params['page'], $params['limit']);
            
            // 🔥 第三步：業務規則判斷（是否顯示推薦）
            if (empty($recommendList) && empty($searchResult['items'])) {
                // 若兩處皆空，返回空結果而非 404（體驗更好）
                return SearchResultModel::fromData([
                    'recommend' => [],
                    'search' => [],
                    'total' => 0,
                    'show_empty_state' => true,
                ]);
            }
            
            // 🔥 第四步：聚合結果
            $combined = SearchResultModel::fromData([
                'recommend' => $recommendList,
                'search' => $searchResult['items'],
                'total' => $searchResult['total'],
                'show_empty_state' => false,
            ]);
            
            // 發出業務事件（非 HTTP 層）
            \Event::dispatch(new SearchCompleted($keyword, 'BFF_SEARCH'));
            
            return $combined;
            
        } catch (BusinessException $e) {
            // 業務異常，拋出正確狀態碼
            throw $e;
            
        } catch (\Exception $e) {
            // 系統異常，記錄日誌後返回友好錯誤
            \Logger::error('SearchService Error', [
                'keyword' => $keyword,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return SearchResultModel::fromData([
                'recommend' => [],
                'search' => [],
                'total' => 0,
                'show_empty_state' => true,
                'error_message' => '搜尋發生錯誤，請稍後再試',
            ]);
        }
    }
}
```

**Step 3: Repository - 純粹的數據訪問層**

```php
// app/Repositories/ProductRepository.php
namespace App\Repositories;

use App\Models\Product;
use Illuminate\Database\Eloquent\Collection;

class ProductRepository extends BaseRepository
{
    protected Product $model;
    
    public function __construct(Product $model)
    {
        $this->model = $model;
    }
    
    /**
     * 搜索商品（覆蓋索引優化）
     */
    public function searchProducts(string $keyword, int $page, int $limit): array
    {
        // ✅ Repository 負責：
        // 1. 純粹的數據查詢
        // 2. 索引利用
        // 3. 分頁處理
        
        return [
            'items' => $this->model
                ->where('status', 'published')
                ->where('price', '>=', 0)
                ->where(function($query) use ($keyword) {
                    // 🔥 搜索邏輯：標題 + 描述 + 標籤全匹配
                    $query->where(function($q) use ($keyword) {
                        $q->where('name', 'like', "%{$keyword}%")
                          ->orWhere('description', 'like', "%{$keyword}%");
                    })->orWhere(function($q) use ($keyword) {
                        $q->whereHas('tags', function($tagQuery) use ($keyword) {
                            $tagQuery->where('name', 'like', "%{$keyword}%");
                        });
                    })
                })
                ->orderBy('created_at', 'desc')
                ->paginate($limit)
                ->through(fn($item) => [
                    'id' => $item->id,
                    'name' => $item->name,
                    'price' => number_format($item->price, 2),
                    'image_url' => $item->image_url,
                ]),
            'total' => (int)$this->model
                ->where('status', 'published')
                ->where(function($query) use ($keyword) {
                    return $query->where(function($q) use ($keyword) {
                        $q->where('name', 'like', "%{$keyword}%")
                            ->orWhere('description', 'like', "%{$keyword}%");
                    });
                })->count(),
        ];
    }
    
    /**
     * 獲取推薦商品（使用 Redis Cache）
     */
    public function getRecommendations(int $limit, ?int $userId = null): Collection
    {
        // ✅ Repository 可包含緩存邏輯，但業務判斷在 Service
        
        $cacheKey = 'product:recommend:' . ($userId ?: 'anonymous');
        
        $recommendList = cache([
            $cacheKey => function () use ($limit) {
                return Product::where('status', 'published')
                    ->where('featured', true)
                    ->random($limit)
                    ->get();
            }
        ], now()->addMinutes(5)); // 🔥 5 分鐘緩存，減少 Redis 壓力
        
        if (empty($recommendList)) {
            return collect([]);
        }
        
        return $recommendList;
    }
}
```

---

## 四、实战二：Service 層事務管理的真實踩坑

### 坑 1：Controller 錯誤回滾導致業務失敗

#### ❌ 錯誤：在 Controller 中包 Transaction

```php
// ⚠️ 錯誤做法：Controller 包了所有事務邏輯
public function placeOrder(OrderRequest $request)
{
    DB::beginTransaction(); // 🔥 問題 1：事务範圍太大
    
    try {
        // 🔥 問題 2：服務層無法控制回滾
        $product = Product::find($request->input('product_id'));
        
        if (!$product || $product->inventory < $request->input('quantity')) {
            throw new BusinessException('庫存不足');
        }
        
        // 🔥 問題 3：業務邏輯分散在 Controller
        $order = Order::create([
            'user_id' => auth()->id(),
            'product_id' => $request->input('product_id'),
            'quantity' => $request->input('quantity'),
            'total_price' => $product->price * $request->input('quantity')
        ]);
        
        // 🔥 問題 4：Redis 庫存扣減沒有回滾
        OrderInventory::where('product_id', $product->id)
            ->decrement('available_quantity', $request->input('quantity'));
            
        Event::dispatch(new OrderCreated($order));
        
        DB::commit(); // 🔥 問題 5：事務範圍沒封閉
        
    } catch (\Exception $e) {
        DB::rollBack(); // 🔥 問題 6：回滾邏輯在 Controller，無法測試
        throw new BusinessException($e->getMessage());
    }
}
```

#### ✅ 正確：Service 層包事务

```php
// app/Services/OrderService.php
namespace App\Services;

use App\Models\Order;
use App\Models\OrderInventory;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Eloquent\Model;

class OrderService extends BaseService
{
    /**
     * 下單服務（包完整事務）
     */
    public function placeOrder(array $params): Model
    {
        // ✅ Service 層負責完整事務邏輯
        return DB::transaction(function () use ($params) {
            
            try {
                // 🔥 第一步：檢查庫存（讀庫，無鎖）
                $product = Product::with(['category', 'tags'])
                    ->find($params['product_id']);
                
                if (!$product || $product->status !== 'published') {
                    throw new BusinessException('商品已下架或不存在');
                }
                
                // 🔥 第二步：檢查庫存數量（原子性檢查）
                $inventory = OrderInventory::firstOrCreate(
                    ['product_id' => $params['product_id']],
                    ['available_quantity' => $product->inventory]
                );
                
                if ($inventory->available_quantity < $params['quantity']) {
                    throw new BusinessException('庫存不足：需要 ' . $params['quantity'] 
                        . '，僅剩 ' . $inventory->available_quantity);
                }
                
                // 🔥 第三步：扣減庫存（原子操作）
                $inventory->decrement('available_quantity', $params['quantity']);
                
                // 🔥 第四步：創建訂單
                $order = Order::create([
                    'user_id' => $params['user_id'] ?? auth()->id(),
                    'product_id' => $params['product_id'],
                    'quantity' => $params['quantity'],
                    'unit_price' => $product->price,
                    'total_price' => $product->price * $params['quantity'],
                    'status' => 'pending', // 🔥 初始狀態 pending，後續處理中
                ]);
                
                // 🔥 第五步：發出業務事件（非事務範圍）
                Event::dispatch(new OrderCreated($order));
                
                return $order;
                
            } catch (\Exception $e) {
                // 🔥 Service 層统一處理異常，Controller 只接收成功/失敗結果
                throw new BusinessException('下單失敗：' . $e->getMessage());
            }
        });
    }
}
```

### 坑 2：跨服務事務誤區（BFF 場景）

在 BFF 場景中，我們常需調用外部 Java/GraphQL 服務，**不可使用 DB::transaction**！

#### ❌ 錯誤：嘗試跨語言包事务

```php
// ⚠️ 錯誤做法：BFF 層嘗試對 Java 微服務事務回滾
public function createOrderWithJavaService(OrderRequest $request)
{
    // 🔥 錯誤：Java 服務無法被 DB::transaction 管理
    DB::beginTransaction();
    
    try {
        // 調用本地 Service
        $order = OrderService::place($request->data);
        
        // 🔥 錯誤：嘗試回滾 Java 服務的變更
        DB::rollBack(); 
        
        return $order;
        
    } catch (\Exception $e) {
        DB::rollBack();
        throw new BusinessException('訂單創建失敗');
    }
}
```

#### ✅ 正確：BFF 層的补偿事务策略

```php
// ✅ BFF 層使用「最終一致性」處理跨服務調用
class OrderService extends BaseService
{
    /**
     * BFF 場景：先本地後異步，允許暫時不一致
     */
    public function createOrderWithJavaService(array $params): array
    {
        try {
            // 🔥 第一步：立即扣減本地庫存（Redis）
            Redis::exec(function () use ($params) {
                OrderInventory::where('product_id', $params['product_id'])
                    ->decrement('available_quantity', $params['quantity']);
                
                OrderStatusCache::updatePending($params['product_id'], $params['quantity']);
            });
            
            // 🔥 第二步：異步調用 Java 微服務（非事務範圍）
            \Event::dispatch(new SyncOrderToJavaService(
                'orders/v1/create',
                [
                    'product_id' => $params['product_id'],
                    'quantity' => $params['quantity'],
                ]
            ));
            
            // 🔥 第三步：返回成功（異步處理 Java 服務結果）
            return OrderResponse::success($params['order_id']);
            
        } catch (\Exception $e) {
            // 🔥 補償：Redis 庫存回滾
            Redis::exec(function () use ($params) {
                OrderInventory::where('product_id', $params['product_id'])
                    ->increment('available_quantity', $params['quantity']);
                
                OrderStatusCache::removePending($params['product_id']);
            });
            
            throw new BusinessException('下單失敗，庫存已回滾');
        }
    }
}
```

---

## 五、实战三：Repository 層接口化設計（面向接口編程）

### 為什麼需要 Repository Interface？

在 KKday B2C API 中，我們有多個數據來源：
- 本地 MySQL（主庫）
- Elasticsearch（搜索）
- Redis Cache（熱門商品）

**最佳實踐：Repository Interface + Concrete Implementation**

#### ✅ 正確做法：接口化設計

```php
// app/Repositories/ProductRepositoryInterface.php
namespace App\Repositories\Interfaces;

use Illuminate\Database\Eloquent\Collection;

interface ProductRepositoryInterface
{
    /**
     * 獲取單個商品詳情
     */
    public function findById(int $id): ?array;
    
    /**
     * 批量獲取商品（支持索引優化）
     */
    public function batchFind(array $ids): Collection;
    
    /**
     * 搜索商品
     */
    public function search(string $keyword, int $page, int $limit): array;
    
    /**
     * 按庫存狀態篩選
     */
    public function withLowStock(int $minQuantity = 0): Collection;
    
    /**
     * 熱門商品（Redis Cache）
     */
    public function getHotProducts(int $limit): Collection;
}

// app/Repositories/ProductRepository.php
namespace App\Repositories;

use App\Models\Product;
use App\Repositories\Interfaces\ProductRepositoryInterface;
use Illuminate\Support\Facades\Cache;

class ProductRepository implements ProductRepositoryInterface
{
    protected Product $model;
    
    public function __construct(Product $model)
    {
        $this->model = $model;
    }
    
    /**
     * 獲取單個商品詳情（帶關聯）
     */
    public function findById(int $id): ?array
    {
        // ✅ Repository Interface：純粹的數據訪問方法
        return Cache::remember(
            "product:detail:{$id}", // 🔥 10 分鐘緩存熱門商品
            now()->addMinutes(10),
            function () use ($id) {
                return [
                    'id' => $this->model->where('id', $id)->firstOrFail()->id,
                    'name' => $this->model->where('id', $id)->firstOrFail()->name,
                    'price' => $this->model->where('id', $id)->firstOrFail()->price,
                    // ... 其他字段
                ];
            }
        );
    }
    
    /**
     * 批量獲取商品（索引優化）
     */
    public function batchFind(array $ids): Collection
    {
        // ✅ 利用 MySQL INDEX(id) 進行批量查詢
        return Product::whereIn('id', $ids)
            ->with(['category', 'tags'])
            ->get()
            ->map(fn($item) => [
                'id' => $item->id,
                'name' => $item->name,
                'price' => number_format($item->price, 2),
            ]);
    }
    
    /**
     * 搜索（索引覆蓋查詢）
     */
    public function search(string $keyword, int $page, int $limit): array
    {
        // ✅ Repository 專注數據訪問，複雜邏輯在 Service
        
        return [
            'items' => Product::where('status', 'published')
                ->where(function($query) use ($keyword) {
                    $query->where('name', 'like', "%{$keyword}%")
                          ->orWhere('description', 'like', "%{$keyword}%");
                })
                ->paginate($limit)
                ->through(fn($item) => [
                    'id' => $item->id,
                    'name' => $item->name,
                    'price' => number_format($item->price, 2),
                ]),
            'total' => (int)$this->model
                ->where('status', 'published')
                ->where(function($query) use ($keyword) {
                    return $query->where('name', 'like', "%{$keyword}%")
                        ->orWhere('description', 'like', "%{$keyword}%");
                })
                ->count(),
        ];
    }
    
    /**
     * 熱門商品（Redis）
     */
    public function getHotProducts(int $limit): Collection
    {
        // ✅ Redis Cache + Repository 結合
        return Cache::remember(
            'product:hot',
            now()->addMinutes(5),
            function () use ($limit) {
                return Product::where('status', 'published')
                    ->random($limit)
                    ->get()
                    ->map(fn($item) => [
                        'id' => $item->id,
                        'name' => $item->name,
                        'image_url' => $item->image_url,
                    ]);
            }
        );
    }
}

// app/Services/ProductService.php
namespace App\Services;

use App\Repositories\Interfaces\ProductRepositoryInterface;

class ProductService extends BaseService
{
    protected ProductRepositoryInterface $productRepo; // ✅ 依賴 Interface，非 Concrete
    
    public function __construct(ProductRepositoryInterface $productRepo)
    {
        $this->productRepo = $productRepo;
    }
    
    /**
     * Service 可以根據場景選擇不同的 Repository Implementation
     */
    public function getProductsBySource(string $source): Collection
    {
        // 🔥 Service 層可以切換數據源：MySQL / Elasticsearch / Redis
        return match($source) {
            'mysql' => $this->productRepo->getFromMysql(),
            'es' => $this->productRepo->getFromElasticsearch(),
            default => $this->productRepo->getFromMysql()
        };
    }
}
```

---

## 六、实战四：三層架構的測試策略

### Controller 層測試（Integration Test）

```php
// tests/Feature/ProductSearchControllerTest.php
namespace Tests\Feature;

use App\Controllers\API\ProductSearchController;
use App\Http\Requests\ProductSearchRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;

class ProductSearchControllerTest extends TestCase
{
    use RefreshDatabase;
    
    protected ProductSearchController $controller;
    
    public function setUp(): void
    {
        parent::setUp();
        
        // 🔥 Controller 測試：模擬 HTTP Request + Response
        $this->controller = new ProductSearchController(
            new ProductSearchService(
                app(ProductRepositoryInterface::class),
                app(RecommendRepositoryInterface::class)
            )
        );
    }
    
    public function test_search_returns_200_when_keyword_valid()
    {
        // ✅ Controller 測試：驗證 HTTP Response
        $request = ProductSearchRequest::create(['q' => '露营']);
        
        $response = $this->controller->search($request);
        
        expect($response->status())->toBe(200)
            ->json('data.search.total')->toBeGreaterThan(0);
    }
    
    public function test_search_returns_400_when_keyword_empty()
    {
        // ✅ Controller 測試：驗證請求參數驗證
        $request = ProductSearchRequest::create(['q' => '']);
        
        $response = $this->controller->search($request);
        
        expect($response->status())->toBe(422)
            ->json('message')->toContain('搜索關鍵字不能少於 2 個字');
    }
}
```

### Service 層測試（Unit Test）

```php
// tests/Unit/ProductSearchServiceTest.php
namespace Tests\Unit\Services;

use App\Services\ProductSearchService;
use App\Repositories\Interfaces\ProductRepositoryInterface;
use App\Repositories\ProductRepository; // 🔥 Mock Concrete Implementation
use Illuminate\Foundation\Testing\RefreshDatabase;

class ProductSearchServiceTest extends TestCase
{
    use RefreshDatabase;
    
    public function test_search_aggregates_recommend_and_search_results()
    {
        // ✅ Service 測試：驗證業務邏輯
        $productRepoMock = Mockery::mock(ProductRepositoryInterface::class)
            ->makePartial();
        
        $recommendRepoMock = Mockery::mock(RecommendRepositoryInterface::class)
            ->makePartial();
        
        $service = new ProductSearchService(
            $productRepoMock,
            $recommendRepoMock
        );
        
        // 設定 Mock 返回數據
        $productRepoMock->shouldReceive('searchProducts')
            ->with('露营', 1, 20)
            ->andReturn([
                'items' => [['id' => 1, 'name' => '帳篷 A']],
                'total' => 5
            ]);
            
        $recommendRepoMock->shouldReceive('getRecommendations')
            ->with(5, null)
            ->andReturn(['id' => 100, 'name' => '热门推荐']);
        
        $result = $service->execute([
            'keyword' => '露营',
            'page' => 1,
            'limit' => 20
        ]);
        
        expect($result['search'])->toContainEqual(['name' => '帳篷 A'])
            ->toHaveKey('recommend');
    }
}
```

### Repository 層測試（Repository Test）

```php
// tests/Repositories/ProductRepositoryTest.php
namespace Tests\\Repositories;

use App\\Models\\Product;
use App\\Repositories\\ProductRepository;

class ProductRepositoryTest extends TestCase
{
    public function test_search_uses_index_optimization()
    {
        // ✅ Repository 測試：驗證數據庫查詢優化
        $repository = new ProductRepository(Product::query());
        
        // 🔥 模擬外部數據來源（真實數據庫環境）
        Product::create(['id' => 1, 'name' => '帳篷 A', 'status' => 'published']);
        Product::create(['id' => 2, 'name' => '睡袋 B', 'status' => 'draft']);
        
        $result = $repository->search('帳篷', 1, 10);
        
        expect($result['items'][0]['name'])->toBe('帳篷 A'); // ✅ 正確匹配
        expect(count($result['items']))->toBe(1); // ✅ 已下架的不顯示
    }
}
```

### Repository 層的進階測試策略

#### 策略一：Mock Repository（隔離 Service 層測試）

當測試 Service 層業務邏輯時，**不需要啟動真實數據庫**，透過 Mock Repository 依賴注入實現：

```php
// tests/Unit/Services/OrderServiceWithMockTest.php
namespace Tests\\Unit\\Services;

use App\\Services\\OrderService;
use App\\Repositories\\Interfaces\\OrderRepositoryInterface;
use App\\Repositories\\Interfaces\\InventoryRepositoryInterface;
use Mockery;

class OrderServiceWithMockTest extends TestCase
{
    public function test_place_order_reduces_inventory_when_stock_available()
    {
        // 🔥 Mock 所有 Repository 依賴，Service 層業務邏輯隔離測試
        $orderRepoMock = Mockery::mock(OrderRepositoryInterface::class);
        $inventoryRepoMock = Mockery::mock(InventoryRepositoryInterface::class);

        $service = new OrderService($orderRepoMock, $inventoryRepoMock);

        // 設定 Mock 行為：庫存充足
        $inventoryRepoMock->shouldReceive('getAvailableQuantity')
            ->with(1001)
            ->andReturn(50);

        $inventoryRepoMock->shouldReceive('decrement')
            ->with(1001, 3)
            ->andReturn(true);

        $orderRepoMock->shouldReceive('create')
            ->with(Mockery::on(fn($data) => $data['product_id'] === 1001 && $data['quantity'] === 3))
            ->andReturn(new \App\Models\Order(['id' => 1, 'status' => 'pending']));

        $result = $service->placeOrder([
            'product_id' => 1001,
            'quantity' => 3,
        ]);

        expect($result->status)->toBe('pending');
        // ✅ 驗證業務規則是否正確調用了 Repository 方法
    }

    public function test_place_order_throws_when_stock_insufficient()
    {
        $orderRepoMock = Mockery::mock(OrderRepositoryInterface::class);
        $inventoryRepoMock = Mockery::mock(InventoryRepositoryInterface::class);

        $service = new OrderService($orderRepoMock, $inventoryRepoMock);

        // 🔥 設定庫存不足的場景
        $inventoryRepoMock->shouldReceive('getAvailableQuantity')
            ->with(1001)
            ->andReturn(2);

        $this->expectException(BusinessException::class);
        $this->expectExceptionMessage('庫存不足');

        $service->placeOrder([
            'product_id' => 1001,
            'quantity' => 5, // 需要 5，僅剩 2
        ]);
    }
}
```

**Mock Repository 的優勢：**

| 面向 | 真實 Repository | Mock Repository |
|------|----------------|-----------------|
| 測試速度 | 慢（需啟動 DB） | ⚡ 極快（純 PHP 計算） |
| 適用場景 | Repository 自身方法正確性 | Service 業務邏輯正確性 |
| 依賴 | MySQL / SQLite | 無外部依賴 |
| 覆蓋目標 | 數據層 CRUD | 業務規則、異常處理 |

#### 策略二：SQLite 內存數據庫測試（Repository 集成測試）

Repository 層需要驗證真實 SQL 查詢正確性，此時使用 **SQLite 內存數據庫** 替代 MySQL，兼顧速度與真實性：

```php
// tests/Repositories/ProductRepositorySQLiteTest.php
namespace Tests\\Repositories;

use Tests\\TestCase;
use Illuminate\\Foundation\\Testing\\RefreshDatabase;
use App\\Repositories\\ProductRepository;
use App\\Models\\Product;

class ProductRepositorySQLiteTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // 🔥 關鍵：使用 SQLite 內存模式替代 MySQL
        config(['database.default' => 'sqlite_testing']);
        config(['database.connections.sqlite_testing' => [
            'driver'   => 'sqlite',
            'database' => ':memory:',  // 🔥 純內存，每次測試自動重置
            'prefix'   => '',
        ]]);

        // 🔥 自動建表（使用 Laravel Migration）
        $this->artisan('migrate');
    }

    public function test_search_filters_by_status_and_keyword()
    {
        // 真實寫入數據庫（SQLite 內存）
        Product::create(['id' => 1, 'name' => '帳篷 A', 'status' => 'published', 'price' => 299]);
        Product::create(['id' => 2, 'name' => '帳篷 B', 'status' => 'draft', 'price' => 399]);
        Product::create(['id' => 3, 'name' => '睡袋 C', 'status' => 'published', 'price' => 199]);

        $repo = new ProductRepository(new Product());
        $result = $repo->search('帳篷', 1, 10);

        // ✅ 驗證：只返回 published 狀態且關鍵字匹配的商品
        expect(count($result['items']))->toBe(1);
        expect($result['items'][0]['name'])->toBe('帳篷 A');
        expect($result['total'])->toBe(1);
    }

    public function test_batch_find_useswhereIn_optimization()
    {
        Product::create(['id' => 10, 'name' => '背包', 'status' => 'published']);
        Product::create(['id' => 20, 'name' => '水壺', 'status' => 'published']);
        Product::create(['id' => 30, 'name' => '營燈', 'status' => 'draft']);

        $repo = new ProductRepository(new Product());
        $result = $repo->batchFind([10, 20, 30]);

        // ✅ 批量查詢返回所有狀態的商品（Repository 不做業務過濾）
        expect(count($result))->toBe(3);
    }
}
```

```php
// config/database.php — 在 phpunit.xml 中切換測試驅動
// .env.testing
DB_CONNECTION=sqlite_testing
DB_DATABASE=:memory:
```

**SQLite 內存測試 vs MySQL 測試：**

| 面向 | SQLite :memory: | MySQL (真實) |
|------|----------------|-------------|
| 啟動速度 | ⚡ <100ms | 500ms+ |
| 事務支援 | ✅ 基本支援 | ✅ 完整支援 |
| JSON 函數 | ⚠️ 有限 | ✅ 完整 |
| 索引行為 | 基本一致 | 完全一致 |
| 生產模擬度 | 85% | 100% |

> **最佳實踐建議**：Repository 層使用 SQLite 內存測試覆蓋核心 CRUD 路徑（80%），保留少量 MySQL 真實測試驗證特殊索引和 JSON 查詢（20%）。

---架构演进路徑 ---
## 九、從 C-S-R 演進到 CQRS 的路徑

當項目從三層架構繼續增長，遇到**讀寫不對稱**（查詢遠多於寫入）、**查詢性能瓶頸**、**領域複雜度爆炸**時，可以考慮演進到 **CQRS（Command Query Responsibility Segregation）**。

### 觸發演進的信號

| 信號 | C-S-R 架構的瓶頸 | CQRS 的解決方案 |
|------|-------------------|-----------------|
| **讀取延遲** | Repository 返回完整 Model，查詢慢 | 獨立的 Read Model（投影/物化視圖） |
| **寫入複雜** | Service 層同時處理讀寫，事務混雜 | Command Handler 專注寫入，Event 負責同步 |
| **團隊協作** | 讀寫在同一倉庫衝突多 | 讀寫分離倉庫/分支，並行開發 |
| **審計需求** | Service 層難以追蹤完整操作軌跡 | Command 自帶事件溯源（Event Sourcing） |

### 演進路徑（三步走）

#### Step 1：引入 Read Model（最小侵入）

不改變現有 C-S-R 結構，為**熱點查詢**添加專用的 Read Model：

```php
// 🔥 新增：Read Model（不改變現有 Repository）
class OrderReadModel
{
    /**
     * 專用查詢方法（物化視圖/寬表查詢）
     * 不走 Eloquent ORM，直接 SQL 查詢優化性能
     */
    public function getOrderSummary(int $userId): array
    {
        return DB::select('
            SELECT o.id, o.status, o.total_price, p.name as product_name
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
            LIMIT 20
        ', [$userId]);
    }
}

// Service 層切換：查詢走 ReadModel，寫入走 Repository
class OrderService extends BaseService
{
    public function getOrderHistory(int $userId): array
    {
        // 🔥 讀取：走 Read Model（高性能）
        return $this->orderReadModel->getOrderSummary($userId);
    }

    public function placeOrder(array $params): Order
    {
        // 🔥 寫入：走原有 Repository（不變）
        return DB::transaction(fn() => $this->orderRepo->create($params));
    }
}
```

#### Step 2：引入 Command / Query 分離

將 Service 層的方法明確分為 **Command**（寫入）和 **Query**（讀取）：

```php
// 🔥 Commands（寫入操作）
class PlaceOrderCommand
{
    public function __construct(
        public int $userId,
        public int $productId,
        public int $quantity,
    ) {}
}

class PlaceOrderHandler
{
    public function __construct(
        protected OrderRepositoryInterface $orderRepo,
        protected InventoryRepositoryInterface $inventoryRepo,
    ) {}

    public function handle(PlaceOrderCommand $command): Order
    {
        return DB::transaction(function () use ($command) {
            $inventory = $this->inventoryRepo->get($command->productId);
            if ($inventory->available < $command->quantity) {
                throw new BusinessException('庫存不足');
            }
            $this->inventoryRepo->decrement($command->productId, $command->quantity);
            return $this->orderRepo->create([...]);
        });
    }
}

// 🔥 Queries（讀取操作）
class GetOrderHistoryQuery
{
    public function __construct(public int $userId) {}
}

class GetOrderHistoryHandler
{
    public function __construct(protected OrderReadModel $readModel) {}

    public function handle(GetOrderHistoryQuery $query): array
    {
        return $this->readModel->getOrderSummary($query->userId);
    }
}
```

#### Step 3：事件驅動的讀寫同步（最終一致性）

```php
// 🔥 事件發布（Command Handler 內）
class PlaceOrderHandler
{
    public function handle(PlaceOrderCommand $command): Order
    {
        return DB::transaction(function () use ($command) {
            $order = $this->orderRepo->create([...]);

            // 🔥 寫入完成後，發布事件同步 Read Model
            event(new OrderCreated(
                orderId: $order->id,
                userId: $command->userId,
                total: $order->total_price,
            ));

            return $order;
        });
    }
}

// 🔥 Read Model 由事件自動更新（投影器）
class OrderProjection
{
    public function handleOrderCreated(OrderCreated $event): void
    {
        DB::table('order_read_models')->insert([
            'order_id'    => $event->orderId,
            'user_id'     => $event->userId,
            'total_price' => $event->total,
            'status'      => 'pending',
            'created_at'  => now(),
        ]);
    }
}
```

### C-S-R → CQRS 演進檢查表

| 檢查項 | ✅ 可以演進 | ❌ 暫不需要 |
|--------|-----------|-----------|
| 項目 LOC | >50K，多團隊協作 | <20K，單團隊 |
| 讀寫比 | 讀取:寫入 > 10:1 | 讀寫均衡 |
| 查詢延遲 | 熱點查詢 P99 > 500ms | 查詢均 < 200ms |
| 事件驅動 | 已有事件系統（Laravel Event） | 無事件需求 |
| 領域複雜度 | 多聚合根交互 | 單一聚合 |

> **建議**：先走 Step 1（Read Model），觀察效果。Step 2/3 只在讀寫分離真正帶來收益時才引入，避免過度設計。

---

## 七、架構演進路徑：從小項目到大項目

### 階段一：小項目（<5K LOC）- 兩層即可

```php
// ⚠️ 小項目初期：Controller + Model
class ProductController extends Controller
{
    public function index()
    {
        // 🔥 初期沒問題，但隨著項目增長會變難維護
        return view('products.index', [
            'items' => Product::all() // ❌ 沒有分層
        ]);
    }
}
```

### 階段二：中項目（5-10K LOC）- 引入 Service

```php
// ✅ 中期：Controller + Service + Model
class ProductController extends Controller
{
    public function index()
    {
        $items = ProductService::getPublishedProducts()->paginate(20); // ✅ 業務邏輯移走
        return view('products.index', ['items' => $items]);
    }
}

class ProductService extends BaseService
{
    public function getPublishedProducts()
    {
        return Product::where('status', 'published')->paginate(20);
    }
}
```

### 階段三：大項目（>10K LOC）- 完整 C-S-R 三層

```php
// ✅ 大項目：Controller + Service + Repository Interface + Model
class ProductController extends Controller
{
    public function index(ProductSearchService $service): SearchResult
    {
        return $service->getPublishedProducts(); // ✅ HTTP 入口
    }
}

class ProductSearchService extends BaseService
{
    protected ProductRepositoryInterface $productRepo;
    
    public function getPublishedProducts()
    {
        // ✅ 業務邏輯在 Service
        return ProductRepositoryInterface::getPublished()->paginate(20);
    }
}

class ProductRepository implements ProductRepositoryInterface
{
    protected Product $model;
    
    public function __construct(Product $model)
    {
        $this->model = $model;
    }
    
    public function getPublished(): Collection
    {
        // ✅ 數據訪問在 Repository
        return Product::where('status', 'published')->get();
    }
}
```

---

## 八、總結：三層架構的核心原則

### 職責邊界檢查表

| 層級 | ✅ 應該做的事 | ❌ 不應該做的事 |
|------|--------------|----------------|
| **Controller** | HTTP 路由、請求驗證、Response 格式化 | 業務邏輯、數據查詢、事務管理 |
| **Service** | 核心業務邏輯、事務協調、規則判斷 | 直接 DB 操作、HTTP 調用（BFF 除外）、重複代碼 |
| **Repository** | CRUD 操作、索引優化、批量查詢 | 業務邏輯、外部服務調用、事件處理 |

### KKday B2C API 的核心建議

1. **Controller 文件不超過 200 行** → 若超過，拆分成多個 Controller
2. **Service 層是核心** → 單元測試覆蓋率必須 ≥95%
3. **Repository 接口化** → 支持多數據源切換（MySQL/ES/Redis）
4. **事務管理統一在 Service** → Controller 不做 Transaction
5. **跨語言事務用补偿策略** → BFF 層處理異步同步

### TL;DR - 踩坑合集

- ✅ **Controller 只做 HTTP 層** → 減少文件行數至 200 行內
- ✅ **Service 是單元測試核心** → 覆蓋率目標 ≥95%
- ✅ **Repository Interface 優先** → 支持數據源切換
- ❌ **不要在 Controller 中包事务** → Service 層統一管理
- ❌ **避免 Repository 中的業務邏輯** → 保持純粹的數據訪問

---

*本文基於 KKday B2C API 團隊在多個 Laravel 倉庫中的實際實踐經驗，持續更新中。*  
*如需 SA/SD 模板或更多細節，請參考 [KKday 內網文檔](https://wiki.kkday.com/knowledge-center) 或 [Confluence 開發指南](../docs/architecture.md)。*

---

## 相关阅读

- [Laravel 事务管理实战](/categories/PHP/laravel-transaction/) — 深入 DB::transaction、嵌套事务与 Savepoint 在 Service 层的最佳实践
- [Laravel CQRS 实战：订单查询模型拆分、投影同步与后台列表性能治理](/categories/PHP/laravel-cqrs-guide-query/) — 从 Controller-Service-Repository 演进到 CQRS 的完整路径与实战案例
- [Laravel API Resource 实战：BFF 架构下的数据转换与格式化](/categories/PHP/laravel-api-resource-bff-architectureguide/) — KKday B2C API 多端适配、嵌套资源与 N+1 优化的真实踩坑记录
- [Controller 薄 + Service 厚：Laravel 大项目中职责分离的真实踩坑记录](/categories/PHP/controller-service-laravel/) — 从单文件 Controller 拆分到 Service 层的演进步骤与代码模板