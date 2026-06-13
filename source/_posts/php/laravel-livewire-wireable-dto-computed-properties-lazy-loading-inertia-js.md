---

title: Laravel Livewire 3 实战：Wireable DTO、Computed Properties、Lazy Loading——对比 Inertia.js
keywords: [Laravel Livewire, Wireable DTO, Computed Properties, Lazy Loading, Inertia.js, PHP]
date: 2026-06-10 05:18:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Livewire
- Inertia.js
- Laravel
- SPA
- 全栈开发
- DTO
description: 深入 Laravel Livewire 3 的 Wireable DTO、Computed Properties、Lazy Loading 三大核心特性，附实战代码与踩坑记录，并与 Inertia.js 进行全面对比，帮你选对全栈交互方案。
---



## 为什么需要这篇文章

Laravel 生态里做前后端交互，长期有两条主流路线：**Livewire**（服务端渲染 + 少量前端魔法）和 **Inertia.js**（SPA 体验 + 服务端路由）。Livewire 3 在 2023 年底发布后，Wireable DTO、Computed Properties、Lazy Loading 三大特性让它的定位发生了根本变化——不再是"写 Ajax 的简化版"，而是一套完整的全栈交互框架。

这篇文章不做泛泛而谈的对比，而是用**真实代码**把这三个特性吃透，最后给出 Livewire vs Inertia.js 的决策框架。

---

## 一、Wireable DTO：让组件间传值告别数组地狱

### 1.1 问题背景

Livewire 2 时代的组件间通信，最常见的做法是往 `$this->emit` 里塞数组：

```php
// Livewire 2：广播一个订单数据
$this->emit('orderCreated', [
    'id' => $order->id,
    'total' => $order->total,
    'items' => $order->items->map(fn($item) => [
        'name' => $item->name,
        'qty' => $item->quantity,
        'price' => $item->price,
    ])->toArray(),
]);
```

接收端呢？拿到的是一个没有任何类型提示的匿名数组，必须手动解构，漏一个 key 就会报错。当组件数量超过 5 个，这些数组就成了维护噩梦。

### 1.2 Wireable DTO 解法

Livewire 3 引入了 `Wireable` 接口和 `#[Wireable]` 属性，让你用 PHP 8.1+ 的原生 DTO 来传递数据：

```php
<?php

namespace App\Livewire\DTOs;

use Livewire\Wireable;

class OrderCreatedEvent implements Wireable
{
    public function __construct(
        public readonly int $orderId,
        public readonly float $total,
        public readonly array $items,
    ) {}

    // 序列化：DTO → 数组
    public function toLivewire(): array
    {
        return [
            'orderId' => $this->orderId,
            'total' => $this->total,
            'items' => $this->items,
        ];
    }

    // 反序列化：数组 → DTO
    public static function fromLivewire($value): self
    {
        return new self(
            orderId: $value['orderId'],
            total: $value['total'],
            items: $value['items'],
        );
    }
}
```

发射端：

```php
// Livewire 3：类型安全的广播
$this->dispatch('orderCreated', new OrderCreatedEvent(
    orderId: $order->id,
    total: $order->total,
    items: $order->items->map(fn($item) => [
        'name' => $item->name,
        'qty' => $item->quantity,
        'price' => $item->price,
    ])->toArray(),
));
```

接收端：

```php
#[On('orderCreated')]
public function handleOrderCreated(OrderCreatedEvent $event): void
{
    // $event->orderId 是 int，$event->total 是 float
    // IDE 自动补全，类型检查，编译期就能发现错误
    $this->notification = "订单 #{$event->orderId} 已创建，总计 ¥{$event->total}";
}
```

### 1.3 进阶：带验证的 Wireable DTO

DTO 里可以直接集成 Laravel 验证逻辑，确保数据到达组件时已经是合法的：

```php
<?php

namespace App\Livewire\DTOs;

use Livewire\Wireable;
use Illuminate\Support\Facades\Validator;

class SearchQuery implements Wireable
{
    public function __construct(
        public readonly string $keyword,
        public readonly int $page = 1,
        public readonly int $perPage = 20,
    ) {}

    public static function fromLivewire($value): self
    {
        $validated = Validator::make($value, [
            'keyword' => 'required|string|max:100',
            'page' => 'integer|min:1',
            'perPage' => 'integer|min:1|max:100',
        ])->validate();

        return new self(
            keyword: $validated['keyword'],
            page: $validated['page'] ?? 1,
            perPage: $validated['perPage'] ?? 20,
        );
    }

    public function toLivewire(): array
    {
        return [
            'keyword' => $this->keyword,
            'page' => $this->page,
            'perPage' => $this->perPage,
        ];
    }
}
```

这样在监听端就不需要再写 `validate()`，DTO 本身就是验证边界。

---

## 二、Computed Properties：告别手写缓存逻辑

### 2.1 传统做法的痛点

Livewire 2 里，如果你想在组件里展示一个需要计算的属性（比如购物车总价、用户权限列表），通常会：

```php
// Livewire 2 的典型写法
class ShoppingCart extends Component
{
    public $cartTotal;
    public $itemCount;

    public function mount(): void
    {
        $this->refreshCart();
    }

    public function addItem($productId): void
    {
        // ... 添加逻辑
        $this->refreshCart();  // 每次操作后手动刷新
    }

    public function removeItem($productId): void
    {
        // ... 删除逻辑
        $this->refreshCart();  // 又得手动刷新
    }

    private function refreshCart(): void
    {
        $this->cartTotal = $this->user->cart->sum('price');
        $this->itemCount = $this->user->cart->count();
    }
}
```

问题很明显：每次修改数据后都得记得调 `refreshCart()`，忘了就显示过期数据。

### 2.2 Computed Properties 解法

Livewire 3 的 Computed Properties 用 PHP 8.1 的原生属性特性（Backing Properties）实现自动计算：

```php
<?php

namespace App\Livewire;

use Livewire\Attributes\Computed;
use Livewire\Component;

class ShoppingCart extends Component
{
    #[Computed]
    public function cartTotal(): float
    {
        return $this->user->cart->sum('price');
    }

    #[Computed]
    public function itemCount(): int
    {
        return $this->user->cart->count();
    }

    #[Computed]
    public function discountAmount(): float
    {
        if ($this->cartTotal > 500) {
            return $this->cartTotal * 0.1; // 满 500 打九折
        }
        return 0;
    }

    public function addItem(int $productId): void
    {
        $this->user->cart()->attach($productId);
        // 不需要手动刷新！下次访问 $this->cartTotal 时自动重新计算
    }

    public function removeItem(int $productId): void
    {
        $this->user->cart()->detach($productId);
        // 同上，自动刷新
    }
}
```

Blade 模板里直接使用：

```blade
<div>
    <h2>购物车</h2>
    <p>共 {{ $this->itemCount }} 件商品</p>
    <p>小计：¥{{ number_format($this->cartTotal, 2) }}</p>

    @if($this->discountAmount > 0)
        <p class="text-green-600">
            满减优惠：-¥{{ number_format($this->discountAmount, 2) }}
        </p>
    @endif

    <p class="font-bold">
        应付：¥{{ number_format($this->cartTotal - $this->discountAmount, 2) }}
    </p>
</div>
```

### 2.3 Computed Properties 的缓存机制

Computed Properties 有内置缓存：**同一个请求周期内**，多次访问 `$this->cartTotal` 只会执行一次计算方法。但当组件状态发生变化（比如调用了 `addItem`），缓存会自动失效。

如果需要更精细的缓存控制：

```php
#[Computed]
public function expensiveCalculation(): array
{
    // 这个计算很耗时，需要缓存 60 秒
    return Cache::remember("user_{$this->user->id}_stats", 60, function () {
        return $this->calculateUserStats();
    });
}
```

### 2.4 实战：Dashboard 统计面板

```php
<?php

namespace App\Livewire\Dashboard;

use Livewire\Attributes\Computed;
use Livewire\Component;

class StatsPanel extends Component
{
    public string $period = 'week'; // week / month / year

    #[Computed]
    public function revenue(): float
    {
        return Order::where('created_at', '>=', $this->periodStart())
            ->sum('total');
    }

    #[Computed]
    public function orderCount(): int
    {
        return Order::where('created_at', '>=', $this->periodStart())
            ->count();
    }

    #[Computed]
    public function averageOrderValue(): float
    {
        $count = $this->orderCount;
        return $count > 0 ? $this->revenue / $count : 0;
    }

    #[Computed]
    public function topProducts(): array
    {
        return OrderItem::where('created_at', '>=', $this->periodStart())
            ->select('product_id', DB::raw('SUM(quantity) as total_qty'))
            ->groupBy('product_id')
            ->orderByDesc('total_qty')
            ->limit(5)
            ->with('product:name,price')
            ->get()
            ->toArray();
    }

    public function setPeriod(string $period): void
    {
        $this->period = $period;
        // Computed Properties 缓存自动失效，因为组件状态变了
    }

    private function periodStart(): Carbon
    {
        return match ($this->period) {
            'week' => Carbon::now()->startOfWeek(),
            'month' => Carbon::now()->startOfMonth(),
            'year' => Carbon::now()->startOfYear(),
        };
    }

    public function render()
    {
        return view('livewire.dashboard.stats-panel');
    }
}
```

对应的 Blade：

```blade
<div class="grid grid-cols-4 gap-4">
    <div class="bg-white p-4 rounded shadow">
        <h3 class="text-sm text-gray-500">营收</h3>
        <p class="text-2xl font-bold">¥{{ number_format($this->revenue, 2) }}</p>
    </div>

    <div class="bg-white p-4 rounded shadow">
        <h3 class="text-sm text-gray-500">订单数</h3>
        <p class="text-2xl font-bold">{{ $this->orderCount }}</p>
    </div>

    <div class="bg-white p-4 rounded shadow">
        <h3 class="text-sm text-gray-500">客单价</h3>
        <p class="text-2xl font-bold">¥{{ number_format($this->averageOrderValue, 2) }}</p>
    </div>

    <div class="bg-white p-4 rounded shadow">
        <h3 class="text-sm text-gray-500">热销商品</h3>
        @foreach($this->topProducts as $item)
            <p class="text-sm">{{ $item['product']['name'] }} × {{ $item['total_qty'] }}</p>
        @endforeach
    </div>

    <div class="col-span-4 flex gap-2">
        @foreach(['week', 'month', 'year'] as $p)
            <button
                wire:click="setPeriod('{{ $p }}')"
                class="px-4 py-2 rounded {{ $period === $p ? 'bg-blue-500 text-white' : 'bg-gray-200' }}"
            >
                {{ match($p) { 'week' => '本周', 'month' => '本月', 'year' => '本年' } }}
            </button>
        @endforeach
    </div>
</div>
```

---

## 三、Lazy Loading：首屏加载从 3 秒到 300 毫秒

### 3.1 问题场景

很多页面有"非首屏"数据，比如：

- 商品详情页底部的"相关推荐"
- 用户主页的"动态列表"
- 仪表盘的"系统日志"

这些数据查询慢（JOIN 多、数据量大），但用户不一定立刻看。在 Livewire 2 里，所有数据都在 `mount()` 里加载，首屏等待时间白白浪费。

### 3.2 Lazy Loading 解法

Livewire 3 的 `#[Lazy]` 属性让组件延迟加载——页面先渲染 HTML 骨架，浏览器空闲时再发请求加载真实数据：

```php
<?php

namespace App\Livewire\Product;

use Livewire\Attributes\Lazy;
use Livewire\Component;

class RelatedProducts extends Component
{
    public int $productId;

    public function __construct()
    {
        // 这个属性会在 lazy load 时才被赋值
        $this->beforeMount(function () {
            // 从 URL 或父组件获取 productId
        });
    }

    #[Lazy]
    public function load(): void
    {
        // 这个方法在浏览器空闲时才执行
        // 可以放耗时的查询逻辑
    }

    public function mount(int $productId): void
    {
        $this->productId = $productId;
    }

    #[Computed]
    public function products(): array
    {
        return Product::where('category_id', $this->currentProduct->category_id)
            ->where('id', '!=', $this->productId)
            ->with('images')
            ->limit(8)
            ->get()
            ->toArray();
    }

    public function render()
    {
        return view('livewire.product.related-products');
    }
}
```

父组件使用：

```blade
{{-- 商品详情页 --}}
<div>
    <h1>{{ $product->name }}</h1>
    <p>{{ $product->description }}</p>

    {{-- 相关推荐：lazy load --}}
    <livewire:product.related-products
        :productId="$product->id"
        lazy
    />
</div>
```

### 3.3 Lazy Loading 的 placeholder

延迟加载期间，用户会看到一个 placeholder（默认是空的）。你可以自定义：

```php
#[Lazy(loading: 'livewire/placeholders/skeleton')]
```

或者用占位组件：

```blade
{{-- resources/views/livewire/placeholders/skeleton.blade.php --}}
<div class="animate-pulse space-y-4">
    <div class="h-4 bg-gray-200 rounded w-3/4"></div>
    <div class="h-4 bg-gray-200 rounded w-1/2"></div>
    <div class="grid grid-cols-4 gap-4 mt-6">
        @foreach(range(1, 4) as $_)
            <div class="h-32 bg-gray-200 rounded"></div>
        @endforeach
    </div>
</div>
```

### 3.4 进阶：Hydrate/Emit 事件的 Lazy Loading

更复杂的场景是：组件加载后需要监听其他组件的事件。Livewire 3 支持在 Lazy 组件中使用 `#[On]`：

```php
<?php

namespace App\Livewire\Dashboard;

use Livewire\Attributes\Computed;
use Livewire\Attributes\Lazy;
use Livewire\Attributes\On;
use Livewire\Component;

class ActivityFeed extends Component
{
    #[Lazy]
    #[On('refreshActivity')]
    public function load(): void
    {
        // 当其他组件触发 'refreshActivity' 事件时
        // 这个组件也会重新加载
    }

    #[Computed]
    public function activities(): array
    {
        return Activity::with('user')
            ->latest()
            ->limit(20)
            ->get()
            ->toArray();
    }

    public function render()
    {
        return view('livewire.dashboard.activity-feed');
    }
}
```

### 3.5 实战：电商商品详情页

```php
<?php

namespace App\Livewire\Product;

use Livewire\Attributes\Computed;
use Livewire\Attributes\Lazy;
use Livewire\Component;

class ProductShow extends Component
{
    public int $productId;
    public int $quantity = 1;

    public function mount(int $id): void
    {
        $this->productId = $id;
    }

    #[Computed]
    public function product(): array
    {
        return Product::with(['images', 'variants', 'reviews.user'])
            ->findOrFail($this->productId)
            ->toArray();
    }

    #[Computed]
    public function stock(): int
    {
        return $this->product['variants']->sum('stock');
    }

    public function addToCart(): void
    {
        Cart::add($this->productId, $this->quantity);
        $this->dispatch('cartUpdated');
    }

    public function render()
    {
        return view('livewire.product.product-show');
    }
}
```

```blade
{{-- resources/views/livewire/product/product-show.blade.php --}}
<div class="max-w-6xl mx-auto">
    <div class="grid grid-cols-2 gap-8">
        {{-- 主图区域 --}}
        <div>
            <img
                src="{{ $this->product['images'][0]['url'] }}"
                alt="{{ $this->product['name'] }}"
                class="w-full rounded-lg"
            />
        </div>

        {{-- 信息区域 --}}
        <div>
            <h1 class="text-3xl font-bold">{{ $this->product['name'] }}</h1>
            <p class="text-2xl text-red-600 mt-4">
                ¥{{ number_format($this->product['price'], 2) }}
            </p>

            <div class="mt-6">
                <label>数量</label>
                <input type="number" wire:model.live="quantity" min="1" max="{{ $this->stock }}" />
            </div>

            <button
                wire:click="addToCart"
                class="mt-6 bg-blue-600 text-white px-8 py-3 rounded-lg"
                {{ $this->stock <= 0 ? 'disabled' : '' }}
            >
                {{ $this->stock > 0 ? '加入购物车' : '已售罄' }}
            </button>
        </div>
    </div>

    {{-- Lazy Loading: 相关推荐（页面加载后再加载） --}}
    <div class="mt-12">
        <h2 class="text-2xl font-bold mb-6">相关推荐</h2>
        <livewire:product.related-products
            :productId="$this->productId"
            lazy
            loading="livewire.placeholders.product-grid"
        />
    </div>

    {{-- Lazy Loading: 用户评价 --}}
    <div class="mt-12">
        <h2 class="text-2xl font-bold mb-6">
            用户评价 ({{ $this->product['reviews_count'] }})
        </h2>
        <livewire:product.reviews
            :productId="$this->productId"
            lazy
            loading="livewire.placeholders/reviews-skeleton"
        />
    </div>
</div>
```

---

## 四、踩坑记录

### 4.1 Wireable DTO 的序列化陷阱

**坑：** DTO 里有 Carbon 或 Eloquent Model 属性时，`toLivewire()` 会报错。

```php
// ❌ 错误：Carbon 不是简单的可序列化类型
class OrderEvent implements Wireable
{
    public function __construct(
        public readonly Carbon $createdAt,  // 序列化会失败
    ) {}
}

// ✅ 正确：手动转换为时间戳或字符串
class OrderEvent implements Wireable
{
    public function __construct(
        public readonly string $createdAt,  // ISO 8601 字符串
    ) {}

    public static function fromLivewire($value): self
    {
        return new self(
            createdAt: Carbon::parse($value['createdAt'])->toISOString(),
        );
    }
}
```

### 4.2 Computed Properties 的 N+1 问题

**坑：** Computed Properties 每次访问都会执行查询（在同一个请求内有缓存，但跨组件没有）。

```php
// ❌ 问题：如果有 10 个 ProductCard 组件，每个都访问 $this->product->category->name
#[Computed]
public function categoryName(): string
{
    return $this->product->category->name;  // 每个组件都触发一次查询
}

// ✅ 解法：在父组件预加载，通过属性传递
class ProductList extends Component
{
    public function mount(): void
    {
        // 预加载关联数据
        $this->products = Product::with('category')->get();
    }
}
```

### 4.3 Lazy Loading 的闪烁问题

**坑：** Lazy 组件加载完成后，页面布局会跳动（从 placeholder 到真实内容的尺寸差异）。

```blade
{{-- ❌ 问题：placeholder 和真实内容高度不同 --}}
<livewire:product.related-products lazy loading="livewire/placeholders/small-skeleton" />

{{-- ✅ 解法：placeholder 保持和真实内容相同高度 --}}
<div style="min-height: 400px;">
    <livewire:product.related-products
        lazy
        loading="livewire/placeholders/same-height-skeleton"
    />
</div>
```

### 4.4 Livewire 3 的事件命名变更

**坑：** Livewire 2 的 `$this->emit()` 在 Livewire 3 中改为 `$this->dispatch()`，但 Blade 里的 `wire:poll` 等指令有些变化。

```php
// Livewire 2
$this->emit('orderCreated', $data);

// Livewire 3
$this->dispatch('orderCreated', new OrderCreatedEvent($data));
```

```blade
{{-- Livewire 2 --}}
<div wire:poll="refresh">

{{-- Livewire 3：使用 wire:poll.5s 或 wire:poll --}}
<div wire:poll="refresh">
```

### 4.5 Computed Properties 不能有参数

**坑：** Computed Properties 不支持传参，如果你需要根据参数计算，得用普通方法。

```php
// ❌ 错误：Computed Properties 不支持参数
#[Computed]
public function discount(float $amount): float
{
    return $amount * 0.9;
}

// ✅ 正确：用普通方法
public function discount(float $amount): float
{
    return $amount * 0.9;
}
```

---

## 五、Livewire vs Inertia.js：决策框架

### 5.1 核心差异

| 维度 | Livewire | Inertia.js |
|------|----------|------------|
| 渲染模式 | 服务端渲染（每次交互都走服务端） | SPA（首次加载后走前端路由） |
| 前端复杂度 | 极低（写 Blade 就行） | 需要 Vue/React 知识 |
| 页面切换 | 无（同一个页面内更新） | 完整的 SPA 体验 |
| 状态管理 | 组件自己的 `public` 属性 | Pinia/Vuex/Redux |
| 离线支持 | 无 | 可以加 Service Worker |
| 学习曲线 | 低 | 中（需要前端框架基础） |

### 5.2 选 Livewire 的场景

- **内部管理系统**：用户不需要 SPA 体验，优先开发速度
- **团队后端强、前端弱**：不想学 Vue/React，但需要交互性
- **快速 MVP**：需要 3 天出一个带 CRUD 的管理后台
- **已有 Blade 模板**：不想重写前端，只想加交互
- **表单密集型应用**：Livewire 的 `wire:model` 比 Axios + API + 前端验证简洁太多

### 5.3 选 Inertia.js 的场景

- **面向用户的产品**：需要流畅的页面切换体验
- **复杂前端交互**：拖拽、实时编辑、复杂动画
- **移动端适配**：PWA 或需要离线缓存
- **团队前端强**：已经有 Vue/React 技术栈
- **微前端架构**：需要前端独立部署、独立迭代

### 5.4 混合使用

实际上两者可以共存。Livewire 3 支持 `wire:navigate`，可以实现类似 SPA 的页面切换：

```blade
{{-- Livewire 3 的 SPA 模式 --}}
<nav>
    <a href="/" wire:navigate>首页</a>
    <a href="/products" wire:navigate>商品</a>
    <a href="/cart" wire:navigate>购物车</a>
</nav>
```

这意味着你可以在一个项目里，核心页面用 Livewire，个别复杂页面用 Inertia + Vue，实现混合架构。

---

## 六、总结

Livewire 3 的三大新特性，本质上解决了三个核心问题：

1. **Wireable DTO** → 组件间通信的类型安全
2. **Computed Properties** → 计算属性的声明式缓存
3. **Lazy Loading** → 非首屏数据的按需加载

这些特性让 Livewire 从"写 Ajax 的工具"进化成了"写全栈应用的框架"。如果你的团队是 PHP/Laravel 背景，Livewire 3 的投入产出比已经非常接近 Inertia.js 了。

选型建议：**先问自己"需不需要前端路由"**。如果不需要，Livewire 3 是更优解；如果需要，Inertia.js + Vue/React 仍然是更自然的选择。两者不是非此即彼，混合架构才是大中型项目的务实选择。

---

**参考资源：**

- [Livewire 3 官方文档](https://livewire.laravel.com/docs)
- [Inertia.js 官方文档](https://inertiajs.com/)
- [Laravel 官方文档](https://laravel.com/docs)
- [Livewire 3 发布公告](https://laravel-news.com/livewire-3)
