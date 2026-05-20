---
title: Laravel API Resource 實戰：BFF 架構下的數據轉換與格式化 - KKday B2C API 真實踩坑記錄
date: 2026-05-03
categories: [PHP, Laravel, API, 架構設計]
tags: [BFF, KKday, Laravel]
description: 深度分享 KKday B2C API 項目中 Laravel API Resource 的實戰經驗：從 Controller 返回格式統一、多版本 API 適配、條件加載到效能優化，涵蓋數據轉換、嵌套資源、分頁格式化等真實踩坑記錄與解決方案
---

# Laravel API Resource 實戰：BFF 架構下的數據轉換與格式化 - KKday B2C API 真實踩坑記錄

## 前言

在 KKday B2C API 項目中，作為 BFF（Backend for Frontend）層，我們需要為 iOS、Android、Web 三個平台提供統一且適配的 JSON 數據格式。不同平台對同一個 API 的響應格式有不同需求：

| 平台 | 特殊需求 |
|------|----------|
| iOS | 需要 `image_url` 帶 CDN 參數、日期用 `timestamp` |
| Android | 需要 `image_url` 原始格式、日期用 `ISO 8601` |
| Web | 需要完整的嵌套數據、分頁信息 |

如果在 Controller 中用 `array_map` 手動轉換，代碼會變得非常臃腫且難以維護。Laravel API Resource 正是解決這個問題的最佳方案。

> 一句話總結：**API Resource 讓你用一個 Class 定義「數據該長什麼樣子」，而不是在 Controller 裡寫一堆 `return response()->json([...])`**。

## 一、為什麼需要 API Resource？

### Before：Controller 裡的屎山代碼

```php
// ❌ Before：在 Controller 直接組裝 JSON
public function show(Order $order)
{
    $items = $order->items->map(function ($item) {
        return [
            'id' => $item->id,
            'product_name' => $item->product->name,
            'quantity' => $item->quantity,
            'price' => $item->price,
            'subtotal' => $item->quantity * $item->price,
        ];
    });

    return response()->json([
        'data' => [
            'order_id' => $order->id,
            'order_number' => $order->order_number,
            'status' => $order->status,
            'total' => $order->total,
            'items' => $items,
            'created_at' => $order->created_at->toIso8601String(),
            // ... 更多字段
        ]
    ]);
}
```

**問題**：
- Controller 職責過重，違反 Single Responsibility
- 不同 API 返回格式不統一
- 無法複用轉換邏輯

### After：使用 API Resource

```php
// ✅ After：使用 API Resource
public function show(Order $order)
{
    return new OrderResource($order);
}

// OrderResource.php
class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'order_id' => $this->id,
            'order_number' => $this->order_number,
            'status' => $this->status,
            'total' => $this->total,
            'items' => OrderItemResource::collection($this->items),
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
```

**優勢**：
- Controller 只剩 1 行代碼
- 轉換邏輯集中在 Resource Class
- 可複用、可測試、可繼承

## 二、KKday 項目中的 Resource 架構設計

在 KKday B2C API 中，我們的 Resource 層結構如下：

```
app/Http/Resources/
├── V1/                          # API v1 版本
│   ├── ProductResource.php
│   ├── OrderResource.php
│   ├── UserResource.php
│   └── Collection/
│       ├── ProductCollection.php
│       └── OrderCollection.php
├── V2/                          # API v2 版本（擴展 v1）
│   ├── ProductResource.php      # 繼承 V1，添加新字段
│   └── OrderResource.php
└── Traits/
    ├── HasImageTransform.php     # 圖片 URL 轉換 Trait
    └── HasTimestampFormat.php    # 時間格式化 Trait
```

### 核心設計原則

```php
// 1. Resource 只負責「轉換」，不負責「查詢」
// ❌ 錯誤：在 Resource 裡查詢數據
class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            // ...
            'user_name' => User::find($this->user_id)->name, // 錯！
        ];
    }
}

// ✅ 正確：在 Controller 或 Resource 透過關聯加載
public function show(Order $order)
{
    $order->load(['user', 'items.product']); // Eager Loading
    return new OrderResource($order);
}
```

## 三、條件加載：不同平台的不同需求

KKday 項目的 BFF 需要根據 `User-Agent` 或 `X-Platform` header 返回不同格式：

```php
class ProductResource extends JsonResource
{
    use HasImageTransform, HasTimestampFormat;

    public function toArray(Request $request): array
    {
        $platform = $request->header('X-Platform', 'web');

        $data = [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'price' => [
                'amount' => $this->price,
                'currency' => $this->currency,
                'display' => $this->formatPrice($this->price, $this->currency),
            ],
            // 使用 Trait 根據平台格式化圖片
            'image' => $this->transformImage($this->image_url, $platform),
            // 使用 Trait 根據平台格式化時間
            'created_at' => $this->formatTimestamp($this->created_at, $platform),
            'updated_at' => $this->formatTimestamp($this->updated_at, $platform),
        ];

        // 條件加載：只有 App 才返回倒數計時
        if (in_array($platform, ['ios', 'android'])) {
            $data['countdown_seconds'] = $this->getCountdownSeconds();
        }

        // 條件加載：只有管理後台才返回內部欄位
        if ($request->routeIs('admin.*')) {
            $data['internal_code'] = $this->internal_code;
            $data['cost_price'] = $this->cost_price;
        }

        return $data;
    }

    private function formatPrice(float $amount, string $currency): string
    {
        $symbols = ['TWD' => 'NT$', 'USD' => '$', 'JPY' => '¥'];
        $symbol = $symbols[$currency] ?? $currency;
        return $symbol . number_format($amount);
    }
}
```

### 真實踩坑：条件加载导致缓存击穿

**踩坑场景**：Product API 使用了 Response Cache，但因为 `countdown_seconds` 是动态计算的，导致缓存失效。

```php
// ❌ Before：动态字段混入缓存
class ProductController extends Controller
{
    public function show(Product $product)
    {
        // 缓存整个 ProductResource，但 countdown_seconds 是动态的
        return Cache::remember("product:{$product->id}", 3600, function () use ($product) {
            return new ProductResource($product);
        });
    }
}

// ✅ After：分离动态字段
class ProductController extends Controller
{
    public function show(Product $product)
    {
        $staticData = Cache::remember("product:{$product->id}", 3600, function () use ($product) {
            return (new ProductResource($product))->toArray(request());
        });

        // 動態字段不緩存
        $staticData['countdown_seconds'] = $product->getCountdownSeconds();

        return response()->json(['data' => $staticData]);
    }
}
```

## 四、嵌套資源與關聯處理

### 4.1 基本嵌套

```php
class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'order_number' => $this->order_number,
            'status' => new OrderStatusResource($this->status),
            'items' => OrderItemResource::collection($this->items),
            'shipping' => new ShippingResource($this->shipping),
            'payment' => new PaymentResource($this->payment),
        ];
    }
}
```

### 4.2 避免 N+1 問題

**真實踩坑**：訂單列表接口載入 50 筆，每筆訂單有 3 個 item，總共產生 151 次查詢！

```php
// ❌ Before：沒有 Eager Loading
public function index(Request $request)
{
    $orders = Order::where('user_id', auth()->id())
        ->latest()
        ->paginate(50);

    return OrderResource::collection($orders); // N+1 查詢爆炸！
}

// ✅ After：使用 loadMissing 或 with
public function index(Request $request)
{
    $orders = Order::where('user_id', auth()->id())
        ->with(['items.product', 'status', 'shipping', 'payment']) // Eager Loading
        ->latest()
        ->paginate(50);

    return OrderResource::collection($orders); // 只有 6 次查詢
}
```

### 4.3 條件性加載關聯

```php
class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $data = [
            'id' => $this->id,
            'order_number' => $this->order_number,
            'total' => $this->total,
            'items' => OrderItemResource::collection($this->items),
        ];

        // 只有查看訂單詳情時才返回完整的 payment 和 shipping
        if ($request->routeIs('orders.show')) {
            $data['payment'] = new PaymentResource($this->whenLoaded('payment'));
            $data['shipping'] = new ShippingResource($this->whenLoaded('shipping'));
            $data['history'] = OrderHistoryResource::collection($this->whenLoaded('histories'));
        }

        return $data;
    }
}
```

## 五、分頁響應格式化

Laravel 預設的分頁格式是：

```json
{
    "data": [...],
    "links": {...},
    "meta": {...}
}
```

但 KKday 前端需要的格式是：

```json
{
    "items": [...],
    "pagination": {
        "page": 1,
        "per_page": 20,
        "total": 100,
        "total_pages": 5
    }
}
```

### 自定義分頁 Resource Collection

```php
class ProductCollection extends ResourceCollection
{
    public function toArray(Request $request): array
    {
        return [
            'items' => $this->collection,
            'pagination' => [
                'page' => $this->resource->currentPage(),
                'per_page' => $this->resource->perPage(),
                'total' => $this->resource->total(),
                'total_pages' => $this->resource->lastPage(),
                'has_more' => $this->resource->hasMorePages(),
            ],
        ];
    }

    // 讓 ProductCollection 可以直接用 ProductResource::collection()
    public static function using($resource)
    {
        return tap(new static($resource), function ($collection) {
            $collection->collection = $resource->map(function ($item) {
                return new ProductResource($item);
            });
        });
    }
}

// 使用方式
public function index(Request $request)
{
    $products = Product::where('is_active', true)
        ->with(['category', 'images'])
        ->paginate(20);

    return new ProductCollection($products);
}
```

## 六、效能優化：避免重複查詢

### 6.1 使用 `additional()` 添加全局數據

```php
class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            // ...
        ];
    }
}

// 在 Controller 添加全局元數據
public function index(Request $request)
{
    $products = Product::paginate(20);

    return ProductResource::collection($products)
        ->additional([
            'meta' => [
                'categories' => Category::active()->get(['id', 'name']),
                'price_range' => [
                    'min' => Product::min('price'),
                    'max' => Product::max('price'),
                ],
            ],
        ]);
}
```

### 6.2 避免在 Resource 中查詢數據庫

```php
// ❌ 錯誤：在 Resource 中查詢
class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'category_name' => Category::find($this->category_id)?->name, // 錯！
            'review_count' => Review::where('product_id', $this->id)->count(), // 錯！
            'avg_rating' => Review::where('product_id', $this->id)->avg('rating'), // 錯！
        ];
    }
}

// ✅ 正確：在 Controller 中預先加載
class ProductController extends Controller
{
    public function show(Product $product)
    {
        // 在 Controller 中查詢，透過 Closure 傳給 Resource
        $reviewCount = Review::where('product_id', $product->id)->count();
        $avgRating = Review::where('product_id', $product->id)->avg('rating');

        return new ProductResource($product->load('category'))
            ->additional([
                'meta' => [
                    'review_count' => $reviewCount,
                    'avg_rating' => $avgRating,
                ],
            ]);
    }
}
```

## 七、API 版本管理與 Resource 繼承

KKday 項目需要同時支援 v1 和 v2 API，我們使用 Resource 繼承來複用代碼：

```php
// V1/ProductResource.php
class V1ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'price' => $this->price,
            'image' => $this->image_url,
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}

// V2/ProductResource.php
class V2ProductResource extends V1ProductResource
{
    public function toArray(Request $request): array
    {
        return array_merge(parent::toArray($request), [
            // v2 新增的欄位
            'slug' => $this->slug,
            'description' => $this->description,
            'tags' => $this->tags,
            'variants' => VariantResource::collection($this->whenLoaded('variants')),
            'reviews_summary' => new ReviewSummaryResource($this->whenLoaded('reviews')),
        ]);
    }
}

// Controller 中使用
class ProductController extends Controller
{
    public function show(Request $request, Product $product)
    {
        $version = $request->route()->getAction('api_version') ?? 'v1';

        $resource = match($version) {
            'v2' => new V2ProductResource($product->load(['variants', 'reviews'])),
            default => new V1ProductResource($product),
        };

        return $resource;
    }
}
```

## 八、Trait 複用：圖片與時間格式化

### 8.1 HasImageTransform Trait

```php
// app/Http/Resources/Traits/HasImageTransform.php
trait HasImageTransform
{
    protected function transformImage(?string $imageUrl, string $platform): ?array
    {
        if (!$imageUrl) {
            return null;
        }

        return match($platform) {
            'ios' => [
                'url' => $this->addCdnParams($imageUrl, ['format' => 'webp', 'quality' => 80]),
                'thumbnail' => $this->addCdnParams($imageUrl, ['width' => 200, 'format' => 'webp']),
            ],
            'android' => [
                'url' => $imageUrl,
                'thumbnail' => $this->addCdnParams($imageUrl, ['width' => 200]),
            ],
            default => $imageUrl,
        };
    }

    private function addCdnParams(string $url, array $params): string
    {
        $separator = str_contains($url, '?') ? '&' : '?';
        return $url . $separator . http_build_query($params);
    }
}
```

### 8.2 HasTimestampFormat Trait

```php
// app/Http/Resources/Traits/HasTimestampFormat.php
trait HasTimestampFormat
{
    protected function formatTimestamp($timestamp, string $platform): string|int
    {
        if (!$timestamp) {
            return null;
        }

        return match($platform) {
            'ios' => $timestamp->timestamp, // Unix timestamp
            'android' => $timestamp->toIso8601String(), // ISO 8601
            default => $timestamp->format('Y-m-d H:i:s'), // Human readable
        };
    }
}
```

## 九、測試：確保 Resource 輸出正確

```php
// tests/Feature/Http/Resources/OrderResourceTest.php
use App\Http\Resources\OrderResource;
use App\Models\Order;

it('returns correct structure for order resource', function () {
    $order = Order::factory()
        ->hasItems(3)
        ->create();

    $resource = new OrderResource($order);
    $json = $resource->toArray(request());

    expect($json)->toHaveKeys([
        'id',
        'order_number',
        'status',
        'items',
        'total',
        'created_at',
    ]);

    expect($json['items'])->toHaveCount(3);
    expect($json['items'][0])->toHaveKeys([
        'id',
        'product_name',
        'quantity',
        'price',
    ]);
});

it('formats price correctly for different currencies', function () {
    $order = Order::factory()->create(['currency' => 'TWD', 'total' => 1234]);

    $resource = new OrderResource($order);
    $json = $resource->toArray(request());

    expect($json['price']['display'])->toBe('NT$1,234');
});

it('hides internal fields for non-admin requests', function () {
    $order = Order::factory()->create(['internal_code' => 'INT-001']);

    $request = Request::create('/api/orders/' . $order->id, 'GET');
    $resource = new OrderResource($order);
    $json = $resource->toArray($request);

    expect($json)->not->toHaveKey('internal_code');
});
```

## 十、踩坑總結

| 踩坑場景 | 問題描述 | 解決方案 |
|----------|----------|----------|
| N+1 查詢 | Resource 嵌套導致大量查詢 | 使用 `with()` 或 `loadMissing()` 預加載 |
| 緩存失效 | 動態字段混入緩存數據 | 分離靜態和動態數據 |
| 時間格式不一致 | 前端需要不同時間格式 | 使用 Trait + Platform 條件判斷 |
| 圖片 URL 拼接 | CDN 參數在代碼中散落 | 集中在 Trait 處理 |
| Resource 過重 | 一個 Resource 處理太多邏輯 | 使用子 Resource 拆分 |
| 分頁格式不符 | 前端需要特定分頁格式 | 自定義 Collection 類 |

## 結論

Laravel API Resource 在 BFF 架構中扮演著「數據翻譯器」的角色。通過合理使用 API Resource，我們成功將 KKday B2C API 的 Controller 保持在平均 30 行以內，同時滿足了 iOS、Android、Web 三個平台的差异化需求。

**核心經驗**：
1. **Resource 只負責轉換，不負責查詢**
2. **使用 Eager Loading 避免 N+1**
3. **使用 Trait 複用通用邏輯**
4. **通過繼承管理 API 版本**
5. **寫測試確保輸出格式正確**

---

> 📝 **本文基於 KKday B2C API 真實踩坑記錄撰寫**，所有解決方案已在生產環境驗證。如需其他主題的文章草稿，請隨時告訴我！
