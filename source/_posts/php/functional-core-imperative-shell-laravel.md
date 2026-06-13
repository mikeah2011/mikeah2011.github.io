---
title: Functional Core Imperative Shell 实战：Laravel 中的函数式核心——纯函数业务逻辑与副作用隔离
date: 2026-06-06 12:00:00
tags: [Functional Programming, Laravel, 架构模式, Clean Architecture]
keywords: [Functional Core Imperative Shell, Laravel, 中的函数式核心, 纯函数业务逻辑与副作用隔离, PHP]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: "深入解析 Functional Core Imperative Shell 架构模式在 Laravel 项目中的实战落地，涵盖纯函数业务逻辑设计、副作用隔离、值对象与 Result 模式、Imperative Shell 编排层实现，以及与 Clean Architecture 和 DDD 的对比与融合，帮助团队告别胖 Service，提升可测试性与可维护性。"
---


## 前言：一次深夜线上事故引发的架构反思

去年某个周五凌晨两点，我被电话叫醒——线上订单系统出现了诡异的 Bug：部分用户的优惠券被重复扣减，库存也出现了不一致。排查了三个小时，最终定位到的原因让人哭笑不得：一个同事在 `OrderService` 里加了一个"小功能"，在计算优惠的同时顺手调用了 `event(new CouponUsed($coupon))`，而事件监听器里又触发了一次扣减。两层副作用叠加，数据就乱了。

这件事让我开始认真思考一个问题：**在 Laravel 项目中，业务逻辑和副作用（数据库写入、事件派发、队列调度、外部 API 调用）是否应该被强制隔离？** 如果计算优惠的逻辑是纯粹的数学运算，不涉及任何 IO，那 Bug 根本不可能发生——因为纯函数不可能"顺手"触发副作用。

这就是 Functional Core Imperative Shell（以下简称 FCIS）模式要解决的核心问题。本文将结合我在 Laravel 项目中的实战经验，详细拆解这个架构模式的落地方法。

---

## 一、什么是 Functional Core Imperative Shell

### 1.1 Gary Bernhardt 的设计哲学

Functional Core Imperative Shell 最早由 Gary Bernhardt 在 2012 年的演讲 "Boundaries" 中提出。其核心思想可以用一句话概括：

> **将系统分为两层：一个纯函数式的"核心"（Functional Core）负责所有业务逻辑计算；一个命令式的"外壳"（Imperative Shell）负责所有副作用（IO、数据库、网络等）。**

用图形来表示：

```
┌─────────────────────────────────────────────────┐
│              Imperative Shell                     │
│  ┌───────────────────────────────────────────┐   │
│  │         Controller / Listener / Job        │   │
│  │   - 接收 HTTP 请求                          │   │
│  │   - 从数据库读取数据                         │   │
│  │   - 调用 Functional Core 计算               │   │
│  │   - 将结果写回数据库                         │   │
│  │   - 派发事件 / 发送通知                      │   │
│  └───────────────────────────────────────────┘   │
│                      │                            │
│                      ▼                            │
│  ┌───────────────────────────────────────────┐   │
│  │         Functional Core (Pure)             │   │
│  │   - 接收不可变数据作为输入                    │   │
│  │   - 纯计算，无 IO                            │   │
│  │   - 返回新的不可变数据                        │   │
│  │   - 可以被 100% 单元测试覆盖                  │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 1.2 两个关键词

- **Functional Core（函数式核心）**：所有输入到输出的映射都是确定性的。给定相同的输入，永远产生相同的输出。没有数据库查询、没有 HTTP 调用、没有时间依赖、没有随机数。它是纯粹的"计算引擎"。

- **Imperative Shell（命令式外壳）**：负责与"真实世界"交互。读数据库、写数据库、发邮件、推队列、调第三方 API——所有有副作用的操作都在这一层。

### 1.3 为什么这个模式很重要

传统 Laravel 项目中，我们经常看到这样的代码：

```php
class OrderService
{
    public function placeOrder(array $data): Order
    {
        // 业务逻辑 + 副作用混在一起
        $user = User::find($data['user_id']);           // 副作用：DB 读
        $coupon = Coupon::find($data['coupon_id']);     // 副作用：DB 读
        
        $total = $this->calculateTotal($data['items']); // 纯计算
        $discount = $this->applyCoupon($coupon, $total); // 纯计算
        
        $order = Order::create([...]);                  // 副作用：DB 写
        $coupon->decrement('usage', 1);                 // 副作用：DB 写
        event(new OrderPlaced($order));                 // 副作用：事件
        Mail::to($user)->send(new OrderConfirmation()); // 副作用：邮件
        
        return $order;
    }
}
```

这段代码的业务逻辑（`calculateTotal`、`applyCoupon`）和副作用（DB 读写、事件、邮件）完全纠缠在一起。任何一处修改都可能引发连锁反应——正如我开头提到的线上事故。

---

## 二、为什么在 Laravel 中引入 FCIS

### 2.1 胖 Service 的真实困境

在 Laravel 项目演进过程中，Controller 逐渐变胖，于是我们学会了提取 Service 层。但很多团队的 Service 层只是换了个地方写代码——`OrderService` 从 200 行涨到 2000 行，里面混杂着：

- 业务规则计算（纯逻辑）
- Eloquent 查询和持久化（副作用）
- 事件派发（副作用）
- 队列调度（副作用）
- 缓存操作（副作用）
- 第三方 API 调用（副作用）

当一个方法同时承担计算和副作用的职责时，它几乎不可能被彻底测试。你必须 Mock 掉所有依赖，测试代码比业务代码还长，而且每次重构都提心吊胆。

### 2.2 副作用蔓延的典型症状

我在多个 Laravel 项目中观察到以下"副作用蔓延"的症状：

**症状一：一个 Service 方法中出现了超过 5 个外部依赖注入**

```php
public function __construct(
    private OrderRepository $orders,
    private CouponRepository $coupons,
    private InventoryService $inventory,
    private PaymentGateway $payment,
    private EventDispatcher $events,
    private NotificationService $notifications,
    private AuditLogger $audit,
) {}
```

当你需要注入这么多依赖才能完成一个业务操作时，说明这个方法做了太多事情——而且大部分是副作用。

**症状二：测试中 Mock 的数量远超断言**

```php
public function test_place_order(): void
{
    $this->mock(OrderRepository::class)->expects('save');
    $this->mock(CouponRepository::class)->expects('find');
    $this->mock(InventoryService::class)->expects('reserve');
    $this->mock(PaymentGateway::class)->expects('charge');
    $this->mock(EventDispatcher::class)->expects('dispatch');
    $this->mock(NotificationService::class)->expects('send');
    
    // 实际断言只有两行...
    $result = $this->service->placeOrder($data);
    $this->assertTrue($result->success);
}
```

**症状三：无法在不连接数据库的情况下测试业务逻辑**

如果我想验证"满 200 减 30"这个规则是否正确，在传统架构下我必须：创建用户、创建商品、创建优惠券、创建订单……整个测试需要 3 秒钟。而实际上，这个规则只是一个数学公式。

### 2.3 FCIS 带来的改变

引入 FCIS 后，上面的问题迎刃而解：

- **业务逻辑**变成纯函数，不需要任何 Mock，测试速度极快
- **副作用**被显式地隔离在 Shell 层，每个副作用都可以单独测试
- **业务规则**可以在任何上下文中复用（HTTP、CLI、Queue、测试），因为它们不依赖框架

---

## 三、Functional Core 层设计

### 3.1 纯函数的本质特征

在 Functional Core 中，所有函数都必须满足以下条件：

1. **确定性**：相同的输入永远产生相同的输出
2. **无副作用**：不修改外部状态（不写数据库、不发请求、不修改全局变量）
3. **不依赖外部状态**：不读取当前时间、不读取环境变量、不依赖随机数

在 PHP 中，我们可以用纯函数或静态方法来实现：

```php
// ✅ 纯函数
function calculateDiscount(float $total, float $rate): float
{
    return round($total * $rate, 2);
}

// ✅ 纯函数（使用值对象作为输入）
function applyCoupon(CartSnapshot $cart, CouponRule $coupon): DiscountResult
{
    if ($cart->total < $coupon->minimumAmount) {
        return DiscountResult::notApplicable('未达到最低消费金额');
    }
    
    $discount = match ($coupon->type) {
        'percentage' => round($cart->total * $coupon->value / 100, 2),
        'fixed' => min($coupon->value, $cart->total),
    };
    
    return DiscountResult::applied($discount);
}
```

### 3.2 值对象：不可变数据的基石

Functional Core 需要不可变的数据结构。在 PHP 中，我们通过值对象（Value Object）来实现：

```php
final readonly class CartItem
{
    public function __construct(
        public string $productId,
        public string $name,
        public int $quantity,
        public Money $unitPrice,
    ) {}
    
    public function subtotal(): Money
    {
        return $this->unitPrice->multiply($this->quantity);
    }
}

final readonly class CartSnapshot
{
    /** @param CartItem[] $items */
    public function __construct(
        public array $items,
        public string $currency = 'CNY',
    ) {}
    
    public function total(): Money
    {
        $sum = Money::zero($this->currency);
        foreach ($this->items as $item) {
            $sum = $sum->add($item->subtotal());
        }
        return $sum;
    }
    
    public function itemCount(): int
    {
        return array_sum(array_map(
            fn(CartItem $item) => $item->quantity, 
            $this->items
        ));
    }
}
```

使用 `readonly` 修饰符（PHP 8.2+）可以确保值对象创建后不可修改。这是 FCIS 的关键——数据流向是单向的：输入 → 计算 → 新的输出，不会"回流"修改原始数据。

### 3.3 Result/Either 模式：优雅的错误处理

在 Laravel 中，我们习惯用异常来处理业务错误。但在 Functional Core 中，异常是一种副作用（它中断了正常的控制流）。更好的方式是使用 Result 模式：

```php
/** @template T */
final class Result
{
    private function __construct(
        public readonly bool $isSuccess,
        public readonly ?string $error,
        public readonly mixed $value,
    ) {}
    
    /** @return self<T> */
    public static function success(mixed $value): self
    {
        return new self(isSuccess: true, error: null, value: $value);
    }
    
    /** @return self<T> */
    public static function failure(string $error): self
    {
        return new self(isSuccess: false, error: $error, value: null);
    }
    
    /** @template U @param callable(T): U $fn @return self<U> */
    public function map(callable $fn): self
    {
        if (!$this->isSuccess) {
            return self::failure($this->error);
        }
        return self::success($fn($this->value));
    }
    
    /** @template U @param callable(T): self<U> $fn @return self<U> */
    public function flatMap(callable $fn): self
    {
        if (!$this->isSuccess) {
            return self::failure($this->error);
        }
        return $fn($this->value);
    }
}
```

使用 Result 模式的业务逻辑：

```php
final readonly class OrderCalculator
{
    /**
     * 计算订单最终价格
     * 
     * @param CartSnapshot $cart 购物车快照
     * @param CouponRule|null $coupon 优惠券规则
     * @param PricingConfig $config 价格配置
     * @return Result<OrderCalculation>
     */
    public function calculate(
        CartSnapshot $cart,
        ?CouponRule $coupon,
        PricingConfig $config,
    ): Result {
        // 验证购物车不为空
        if ($cart->itemCount() === 0) {
            return Result::failure('购物车为空');
        }
        
        // 验证商品价格合规
        foreach ($cart->items as $item) {
            if ($item->unitPrice->isNegative()) {
                return Result::failure("商品 {$item->name} 价格异常");
            }
        }
        
        $subtotal = $cart->total();
        $discount = Money::zero($cart->currency);
        
        // 应用优惠券
        if ($coupon !== null) {
            $couponResult = $this->applyCoupon($subtotal, $coupon, $config);
            if (!$couponResult->isSuccess) {
                return Result::failure($couponResult->error);
            }
            $discount = $couponResult->value;
        }
        
        // 计算运费
        $shipping = $this->calculateShipping($cart, $config);
        
        // 计算税费
        $tax = $this->calculateTax($subtotal->subtract($discount), $config);
        
        $total = $subtotal->subtract($discount)->add($shipping)->add($tax);
        
        return Result::success(new OrderCalculation(
            subtotal: $subtotal,
            discount: $discount,
            shipping: $shipping,
            tax: $tax,
            total: $total,
            appliedCoupon: $coupon?->code,
        ));
    }
    
    private function applyCoupon(
        Money $subtotal, 
        CouponRule $coupon, 
        PricingConfig $config,
    ): Result {
        if ($subtotal->lessThan($coupon->minimumAmount)) {
            return Result::failure(
                "未达到最低消费 {$coupon->minimumAmount->format()}"
            );
        }
        
        $discount = match ($coupon->type) {
            'percentage' => $subtotal->multiply($coupon->value / 100),
            'fixed' => Money::of($coupon->value, $subtotal->currency),
            'shipping' => Money::zero($subtotal->currency), // 包邮，折扣为0
        };
        
        // 折扣不能超过总额
        if ($discount->greaterThan($subtotal)) {
            $discount = $subtotal;
        }
        
        // 检查最大折扣限制
        if ($coupon->maxDiscount !== null 
            && $discount->greaterThan($coupon->maxDiscount)) {
            $discount = $coupon->maxDiscount;
        }
        
        return Result::success($discount);
    }
    
    private function calculateShipping(
        CartSnapshot $cart, 
        PricingConfig $config,
    ): Money {
        if ($cart->total()->greaterThanOrEqual($config->freeShippingThreshold)) {
            return Money::zero($cart->currency);
        }
        return $config->baseShippingFee;
    }
    
    private function calculateTax(Money $amount, PricingConfig $config): Money
    {
        return $amount->multiply($config->taxRate);
    }
}
```

注意看这段代码的特点：

- **零依赖注入**：不需要任何 Repository、Service 或外部组件
- **完全确定性**：给定相同的 `$cart`、`$coupon`、`$config`，永远产生相同结果
- **错误用 Result 返回**：不抛异常，调用方显式处理每种错误情况
- **易于测试**：直接构造值对象传入，断言输出即可

### 3.4 Functional Core 的目录结构建议

```
app/
├── Domain/                        # Functional Core
│   ├── Order/
│   │   ├── OrderCalculator.php    # 纯计算逻辑
│   │   ├── OrderValidator.php     # 纯验证逻辑
│   │   ├── OrderCalculation.php   # 值对象：计算结果
│   │   └── OrderStatus.php        # 枚举
│   ├── Pricing/
│   │   ├── CartSnapshot.php       # 值对象
│   │   ├── CartItem.php           # 值对象
│   │   ├── CouponRule.php         # 值对象
│   │   ├── PricingConfig.php      # 值对象
│   │   └── DiscountResult.php     # 值对象
│   ├── Inventory/
│   │   ├── StockAllocator.php     # 纯分配算法
│   │   └── AllocationResult.php   # 值对象
│   └── Shared/
│       ├── Money.php              # 通用值对象
│       ├── Result.php             # Result 模式
│       └── Percentage.php         # 通用值对象
├── Infrastructure/                # Imperative Shell
│   └── ...
└── Application/                   # Imperative Shell
    └── ...
```

`Domain` 目录下的所有类都是纯函数和值对象——它们不依赖任何框架组件，甚至不依赖 Laravel。这意味着你可以把整个 `Domain` 目录复制到另一个 PHP 项目中直接使用。

---

## 四、Imperative Shell 层设计

### 4.1 Shell 的职责：编排与副作用

Imperative Shell 是整个系统的"胶水层"。它的职责很明确：

1. 从外部世界收集数据（DB 查询、HTTP 请求参数、配置）
2. 将数据转换为 Functional Core 能理解的值对象
3. 调用 Functional Core 的纯函数进行计算
4. 根据计算结果执行副作用（DB 写入、事件派发、邮件发送等）

### 4.2 Eloquent 只存在于 Shell 层

在 FCIS 架构中，Eloquent Model 只在 Shell 层出现。我们需要在 Shell 层负责 Eloquent Model 和值对象之间的转换：

```php
class OrderService
{
    public function __construct(
        private OrderRepository $orders,
        private CouponRepository $coupons,
        private OrderCalculator $calculator,
    ) {}
    
    public function placeOrder(PlaceOrderRequest $request): OrderResult
    {
        // 1. Shell 职责：从数据库收集数据并转为值对象
        $cartItems = $request->items()->map(fn(array $item) => new CartItem(
            productId: $item['product_id'],
            name: $item['name'],
            quantity: $item['quantity'],
            unitPrice: Money::of($item['price'], 'CNY'),
        ))->all();
        
        $cart = new CartSnapshot(items: $cartItems);
        
        $coupon = $this->coupons->findActiveRule($request->couponCode());
        
        $config = $this->buildPricingConfig();
        
        // 2. Shell 职责：调用 Functional Core 进行纯计算
        $calculation = $this->calculator->calculate($cart, $coupon, $config);
        
        if (!$calculation->isSuccess) {
            return OrderResult::failed($calculation->error);
        }
        
        // 3. Shell 职责：根据计算结果执行副作用
        $order = $this->orders->create(
            userId: $request->userId(),
            items: $cartItems,
            calculation: $calculation->value,
            couponCode: $request->couponCode(),
        );
        
        // 副作用：扣减库存
        $this->inventory->reserve($order->id, $cartItems);
        
        // 副作用：派发事件
        event(new OrderPlaced($order));
        
        return OrderResult::success($order);
    }
    
    private function buildPricingConfig(): PricingConfig
    {
        return new PricingConfig(
            taxRate: config('shop.tax_rate', 0.0),
            freeShippingThreshold: Money::of(
                config('shop.free_shipping_threshold', 199), 'CNY'
            ),
            baseShippingFee: Money::of(
                config('shop.shipping_fee', 10), 'CNY'
            ),
        );
    }
}
```

### 4.3 HTTP 层（Controller）也是 Shell 的一部分

```php
class OrderController extends Controller
{
    public function store(PlaceOrderRequest $request, OrderService $service)
    {
        $result = $service->placeOrder($request);
        
        if (!$result->isSuccess) {
            return response()->json([
                'message' => $result->error,
            ], 422);
        }
        
        return response()->json([
            'message' => '下单成功',
            'order' => new OrderResource($result->order),
        ], 201);
    }
}
```

Controller 本身不做任何业务逻辑判断——它只是把 HTTP 请求转交给 Service（Shell），然后把结果转为 HTTP 响应。

### 4.4 队列和事件也是 Shell

```php
class SendOrderConfirmation implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    
    public function __construct(public Order $order) {}
    
    public function handle(OrderEmailRenderer $renderer): void
    {
        // Shell：从数据库加载数据
        $user = $this->order->user;
        $items = $this->order->items;
        
        // Shell：调用 Functional Core 渲染邮件内容（纯函数）
        $emailContent = $renderer->render(
            userName: $user->name,
            orderNumber: $this->order->number,
            items: $this->mapToLineItems($items),
            total: Money::of($this->order->total, 'CNY'),
        );
        
        // Shell：执行副作用——发送邮件
        Mail::to($user->email)->send(new OrderConfirmationMail($emailContent));
    }
    
    private function mapToLineItems(Collection $items): array
    {
        return $items->map(fn($item) => new EmailLineItem(
            name: $item->product_name,
            quantity: $item->quantity,
            price: Money::of($item->unit_price, 'CNY'),
        ))->all();
    }
}
```

邮件的**内容渲染逻辑**（标题怎么写、折扣怎么展示、排版规则）是纯函数；**发送邮件**是副作用。两者在 Shell 中被编排在一起。

---

## 五、Laravel 实战：订单处理 FCIS 重构前后对比

### 5.1 重构前：一个典型的胖 Service

这是我们项目中真实存在的代码（已脱敏简化）：

```php
class OrderService
{
    public function __construct(
        private PaymentGateway $payment,
        private InventoryService $inventory,
    ) {}
    
    public function createOrder(array $data): Order
    {
        // 1. 验证用户
        $user = User::findOrFail($data['user_id']);
        if ($user->is_banned) {
            throw new \Exception('用户已被封禁');
        }
        
        // 2. 验证商品
        $products = Product::whereIn('id', array_column($data['items'], 'product_id'))
            ->get();
        
        if ($products->count() !== count($data['items'])) {
            throw new \Exception('部分商品不存在');
        }
        
        // 3. 计算价格
        $subtotal = 0;
        $orderItems = [];
        foreach ($data['items'] as $item) {
            $product = $products->firstWhere('id', $item['product_id']);
            if ($product->stock < $item['quantity']) {
                throw new \Exception("{$product->name} 库存不足");
            }
            $price = $product->price;
            $subtotal += $price * $item['quantity'];
            $orderItems[] = [
                'product_id' => $product->id,
                'name' => $product->name,
                'quantity' => $item['quantity'],
                'unit_price' => $price,
                'subtotal' => $price * $item['quantity'],
            ];
        }
        
        // 4. 优惠券
        $discount = 0;
        if (!empty($data['coupon_code'])) {
            $coupon = Coupon::where('code', $data['coupon_code'])
                ->where('is_active', true)
                ->first();
            
            if (!$coupon) {
                throw new \Exception('优惠券无效');
            }
            
            if ($coupon->expires_at->isPast()) {
                throw new \Exception('优惠券已过期');
            }
            
            if ($coupon->used_count >= $coupon->total_count) {
                throw new \Exception('优惠券已领完');
            }
            
            if ($subtotal < $coupon->min_amount) {
                throw new \Exception('未达到最低消费');
            }
            
            if ($coupon->type === 'percentage') {
                $discount = $subtotal * $coupon->value / 100;
                if ($coupon->max_discount && $discount > $coupon->max_discount) {
                    $discount = $coupon->max_discount;
                }
            } else {
                $discount = min($coupon->value, $subtotal);
            }
        }
        
        // 5. 运费
        $shipping = $subtotal >= 199 ? 0 : 10;
        
        // 6. 税费
        $taxable = $subtotal - $discount;
        $tax = $taxable * 0.06;
        
        // 7. 总价
        $total = $subtotal - $discount + $shipping + $tax;
        
        // 8. 创建订单
        $order = Order::create([
            'user_id' => $user->id,
            'number' => 'ORD' . date('YmdHis') . rand(1000, 9999),
            'subtotal' => $subtotal,
            'discount' => $discount,
            'shipping' => $shipping,
            'tax' => $tax,
            'total' => $total,
            'coupon_code' => $data['coupon_code'] ?? null,
            'status' => 'pending',
        ]);
        
        foreach ($orderItems as $orderItem) {
            $order->items()->create($orderItem);
        }
        
        // 9. 扣库存
        foreach ($data['items'] as $item) {
            $this->inventory->decrement($item['product_id'], $item['quantity']);
        }
        
        // 10. 扣优惠券
        if (!empty($data['coupon_code']) && isset($coupon)) {
            $coupon->increment('used_count');
        }
        
        // 11. 支付
        $paymentResult = $this->payment->charge($user, $total);
        if (!$paymentResult['success']) {
            // 回滚库存...
            foreach ($data['items'] as $item) {
                $this->inventory->increment($item['product_id'], $item['quantity']);
            }
            $order->update(['status' => 'payment_failed']);
            throw new \Exception('支付失败: ' . $paymentResult['message']);
        }
        
        $order->update(['status' => 'paid', 'paid_at' => now()]);
        
        // 12. 事件
        event(new OrderPlaced($order));
        
        return $order;
    }
}
```

这段代码有 12 个步骤混在一起，其中：

- **纯业务逻辑**：步骤 3-7（价格计算、优惠规则、运费规则、税费计算）
- **副作用**：步骤 1-2（DB 查询）、步骤 8-10（DB 写入）、步骤 11（支付）、步骤 12（事件）

### 5.2 重构后：FCIS 架构

**Functional Core：**

```php
// app/Domain/Order/OrderCalculator.php
final readonly class OrderCalculator
{
    public function calculate(
        CartSnapshot $cart,
        ?CouponRule $coupon,
        PricingConfig $config,
    ): Result {
        // 纯验证
        foreach ($cart->items as $item) {
            if ($item->quantity <= 0) {
                return Result::failure("商品 {$item->name} 数量必须大于 0");
            }
        }
        
        $subtotal = $cart->total();
        $discount = Money::zero('CNY');
        
        // 纯优惠券逻辑
        if ($coupon !== null) {
            $discountResult = $this->calculateDiscount($subtotal, $coupon);
            if (!$discountResult->isSuccess) {
                return Result::failure($discountResult->error);
            }
            $discount = $discountResult->value;
        }
        
        // 纯运费逻辑
        $shipping = $this->calculateShipping($subtotal, $config);
        
        // 纯税费逻辑
        $tax = $subtotal->subtract($discount)->multiply($config->taxRate);
        $total = $subtotal->subtract($discount)->add($shipping)->add($tax);
        
        return Result::success(new OrderCalculation(
            subtotal: $subtotal,
            discount: $discount,
            shipping: $shipping,
            tax: $tax,
            total: $total,
            lineItems: $this->buildLineItems($cart),
        ));
    }
    
    private function calculateDiscount(Money $subtotal, CouponRule $coupon): Result
    {
        if ($subtotal->lessThan($coupon->minimumAmount)) {
            return Result::failure("未达到最低消费 {$coupon->minimumAmount}");
        }
        
        $discount = match ($coupon->type) {
            'percentage' => $subtotal->multiply($coupon->value / 100),
            'fixed' => Money::of($coupon->value, 'CNY'),
            default => Money::zero('CNY'),
        };
        
        if ($coupon->maxDiscount !== null 
            && $discount->greaterThan($coupon->maxDiscount)) {
            $discount = $coupon->maxDiscount;
        }
        
        return Result::success($discount->lessThan($subtotal) 
            ? $discount 
            : $subtotal
        );
    }
    
    private function calculateShipping(Money $subtotal, PricingConfig $config): Money
    {
        return $subtotal->greaterThanOrEqual($config->freeShippingThreshold)
            ? Money::zero('CNY')
            : $config->baseShippingFee;
    }
    
    private function buildLineItems(CartSnapshot $cart): array
    {
        return array_map(fn(CartItem $item) => new OrderLineItem(
            productId: $item->productId,
            name: $item->name,
            quantity: $item->quantity,
            unitPrice: $item->unitPrice,
            subtotal: $item->subtotal(),
        ), $cart->items);
    }
}
```

**Imperative Shell：**

```php
// app/Application/Services/OrderService.php
class OrderService
{
    public function __construct(
        private OrderCalculator $calculator,
        private PaymentGateway $payment,
        private InventoryService $inventory,
    ) {}
    
    public function createOrder(PlaceOrderRequest $request): OrderResult
    {
        // Shell: 收集数据
        $user = User::findOrFail($request->userId());
        if ($user->is_banned) {
            return OrderResult::failed('用户已被封禁');
        }
        
        $cart = $this->buildCart($request->items());
        $coupon = $this->resolveCoupon($request->couponCode());
        $config = PricingConfig::fromConfig();
        
        // Shell: 调用 Functional Core
        $calculation = $this->calculator->calculate($cart, $coupon, $config);
        if (!$calculation->isSuccess) {
            return OrderResult::failed($calculation->error);
        }
        
        // Shell: 执行副作用
        return DB::transaction(function () use ($user, $cart, $coupon, $calculation, $request) {
            $order = Order::create([...]);
            
            foreach ($calculation->value->lineItems as $lineItem) {
                $order->items()->create([...]);
            }
            
            $this->inventory->reserve($order->id, $cart->items);
            
            if ($coupon) {
                $coupon->increment('used_count');
            }
            
            $paymentResult = $this->payment->charge($user, $calculation->value->total);
            
            if (!$paymentResult['success']) {
                $this->inventory->release($order->id);
                $order->update(['status' => 'payment_failed']);
                return OrderResult::failed('支付失败');
            }
            
            $order->update(['status' => 'paid', 'paid_at' => now()]);
            event(new OrderPlaced($order));
            
            return OrderResult::success($order);
        });
    }
    
    private function buildCart(array $items): CartSnapshot
    {
        $cartItems = [];
        foreach ($items as $item) {
            $product = Product::findOrFail($item['product_id']);
            if ($product->stock < $item['quantity']) {
                throw new InsufficientStockException($product->name);
            }
            $cartItems[] = new CartItem(
                productId: $product->id,
                name: $product->name,
                quantity: $item['quantity'],
                unitPrice: Money::of($product->price, 'CNY'),
            );
        }
        return new CartSnapshot(items: $cartItems);
    }
    
    private function resolveCoupon(?string $code): ?CouponRule
    {
        if (empty($code)) return null;
        
        $coupon = Coupon::where('code', $code)
            ->where('is_active', true)
            ->first();
        
        if (!$coupon) return null;
        if ($coupon->expires_at->isPast()) return null;
        if ($coupon->used_count >= $coupon->total_count) return null;
        
        return new CouponRule(
            code: $coupon->code,
            type: $coupon->type,
            value: $coupon->value,
            minimumAmount: Money::of($coupon->min_amount, 'CNY'),
            maxDiscount: $coupon->max_discount 
                ? Money::of($coupon->max_discount, 'CNY') 
                : null,
        );
    }
}
```

### 5.3 重构效果对比

| 维度 | 重构前 | 重构后 |
|------|--------|--------|
| 核心计算逻辑可测试性 | 需要 Mock 数据库 | 纯单元测试，零 Mock |
| 测试速度 | ~3 秒/用例 | ~3 毫秒/用例 |
| 业务逻辑可复用性 | 仅限 Service 调用 | 可在 CLI、Queue、测试中复用 |
| 错误处理 | 异常，调用方不清晰 | Result 模式，错误类型显式 |
| 新增业务规则 | 在 120 行大方法中找位置 | 独立纯函数，职责清晰 |
| 副作用可见性 | 隐式散布 | Shell 层一目了然 |

---

## 六、与 Clean Architecture / DDD 的关系和互补

### 6.1 FCIS 与 Clean Architecture

很多人问我：FCIS 和 Clean Architecture 是不是互斥的？答案是否定的——它们是互补的。

Clean Architecture 强调**依赖方向**：外层依赖内层，内层不依赖外层。FCIS 强调**计算与副作用的分离**。两者的交集在于：

```
Clean Architecture 的 Entity 层 ≈ FCIS 的 Functional Core
Clean Architecture 的 Use Case 层 ≈ FCIS 的 Imperative Shell（编排层）
Clean Architecture 的 Interface Adapter ≈ FCIS 的 Imperative Shell（适配层）
```

一个典型的做法是：在 Clean Architecture 的 Entity 和 Use Case 层引入 FCIS 的思想：

```
app/
├── Domain/                    # Clean Architecture 的 Entity + FCIS 的 Functional Core
│   ├── Order/
│   │   ├── OrderCalculator.php   # 纯函数
│   │   └── OrderCalculation.php  # 值对象
│   └── Shared/
│       ├── Money.php
│       └── Result.php
├── Application/               # Clean Architecture 的 Use Case + FCIS 的 Shell
│   ├── PlaceOrderUseCase.php     # Shell 编排
│   └── CancelOrderUseCase.php    # Shell 编排
├── Infrastructure/            # Clean Architecture 的 Framework + FCIS 的 Shell
│   ├── Persistence/
│   │   └── EloquentOrderRepository.php
│   └── Messaging/
│       └── LaravelEventDispatcher.php
└── Http/                      # FCIS 的 Shell（最外层）
    └── Controllers/
```

### 6.2 FCIS 与 DDD

在 DDD 中，我们有聚合根（Aggregate Root）、实体（Entity）和值对象（Value Object）。FCIS 与 DDD 的结合点在于：

- **值对象**天然就是 Functional Core 的一部分（不可变、无副作用）
- **聚合根的业务规则方法**可以改造为纯函数风格
- **领域服务（Domain Service）**如果只做计算，就是纯函数

但要注意：DDD 中的聚合根需要维护不变量（invariants），这通常涉及状态变更——在 FCIS 中，状态变更应该通过"返回新的不可变对象"来实现，而不是修改当前对象。

```php
// 传统 DDD 风格（有状态修改）
class Order
{
    public function applyDiscount(Money $discount): void
    {
        $this->total = $this->total->subtract($discount);
    }
}

// FCIS 风格（不可变，返回新对象）
class Order
{
    public function withDiscount(Money $discount): self
    {
        return new self(
            ...,
            total: $this->total->subtract($discount),
        );
    }
}
```

### 6.3 三者的协同架构

在我实际项目中，最终的架构是三者的融合：

```
┌──────────────────────────────────────────────────────┐
│                    HTTP / CLI / Queue                  │  ← Imperative Shell
│  ┌────────────────────────────────────────────────┐   │
│  │              Use Case / Application Service     │   │  ← Imperative Shell
│  │  ┌──────────────────────────────────────────┐  │   │
│  │  │         Domain Service (Pure)             │  │   │  ← Functional Core
│  │  │   ┌──────────────────────────────────┐   │  │   │
│  │  │   │    Value Objects + Pure Functions  │   │  │   │  ← Functional Core
│  │  │   └──────────────────────────────────┘   │  │   │
│  │  └──────────────────────────────────────────┘  │   │
│  └────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────┐   │
│  │        Infrastructure (Repositories, APIs)      │   │  ← Imperative Shell
│  └────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

---

## 七、测试优势：纯函数的单元测试 vs 集成测试

### 7.1 纯函数测试：极致简洁

这是 `OrderCalculator` 的完整测试——注意不需要任何 Mock、数据库或 Laravel 框架：

```php
class OrderCalculatorTest extends TestCase
{
    private OrderCalculator $calculator;
    
    protected function setUp(): void
    {
        parent::setUp();
        $this->calculator = new OrderCalculator();
    }
    
    public function test_calculate_basic_order(): void
    {
        $cart = new CartSnapshot(items: [
            new CartItem('P001', 'Laravel 实战', 2, Money::of(99, 'CNY')),
        ]);
        
        $result = $this->calculator->calculate(
            cart: $cart,
            coupon: null,
            config: PricingConfig::default(),
        );
        
        $this->assertTrue($result->isSuccess);
        $this->assertEquals(Money::of(198, 'CNY'), $result->value->subtotal);
        $this->assertEquals(Money::of(0, 'CNY'), $result->value->shipping); // 满199包邮边界
    }
    
    public function test_free_shipping_when_above_threshold(): void
    {
        $cart = new CartSnapshot(items: [
            new CartItem('P001', '商品A', 3, Money::of(100, 'CNY')),
        ]);
        
        $result = $this->calculator->calculate(
            cart: $cart,
            coupon: null,
            config: new PricingConfig(
                taxRate: 0,
                freeShippingThreshold: Money::of(199, 'CNY'),
                baseShippingFee: Money::of(10, 'CNY'),
            ),
        );
        
        $this->assertTrue($result->isSuccess);
        $this->assertEquals(Money::zero('CNY'), $result->value->shipping);
    }
    
    public function test_percentage_coupon_with_max_discount(): void
    {
        $cart = new CartSnapshot(items: [
            new CartItem('P001', '商品A', 1, Money::of(1000, 'CNY')),
        ]);
        
        $coupon = new CouponRule(
            code: 'VIP20',
            type: 'percentage',
            value: 20,
            minimumAmount: Money::of(100, 'CNY'),
            maxDiscount: Money::of(100, 'CNY'), // 最多减100
        );
        
        $result = $this->calculator->calculate(
            cart: $cart,
            coupon: $coupon,
            config: PricingConfig::default(),
        );
        
        $this->assertTrue($result->isSuccess);
        // 20% of 1000 = 200, but max is 100
        $this->assertEquals(Money::of(100, 'CNY'), $result->value->discount);
        $this->assertEquals(Money::of(900, 'CNY'), $result->value->total);
    }
    
    public function test_coupon_below_minimum_amount(): void
    {
        $cart = new CartSnapshot(items: [
            new CartItem('P001', '小商品', 1, Money::of(50, 'CNY')),
        ]);
        
        $coupon = new CouponRule(
            code: 'SAVE10',
            type: 'fixed',
            value: 10,
            minimumAmount: Money::of(100, 'CNY'),
            maxDiscount: null,
        );
        
        $result = $this->calculator->calculate(
            cart: $cart,
            coupon: $coupon,
            config: PricingConfig::default(),
        );
        
        $this->assertFalse($result->isSuccess);
        $this->assertStringContainsString('最低消费', $result->error);
    }
    
    public function test_empty_cart_fails(): void
    {
        $cart = new CartSnapshot(items: []);
        
        $result = $this->calculator->calculate(
            cart: $cart,
            coupon: null,
            config: PricingConfig::default(),
        );
        
        $this->assertFalse($result->isSuccess);
    }
}
```

这个测试文件运行时间：**不到 50 毫秒**。没有任何数据库操作、没有任何 Mock、没有任何框架依赖。你甚至可以在 `composer.json` 中把 Laravel 移除，这些测试依然能跑。

### 7.2 集成测试：只测试 Shell 层的副作用

集成测试专注于验证 Shell 层是否正确地与外部系统交互：

```php
class PlaceOrderIntegrationTest extends TestCase
{
    use DatabaseMigrations;
    
    public function test_order_is_persisted_and_event_is_dispatched(): void
    {
        Event::fake();
        
        $user = User::factory()->create();
        $product = Product::factory()->create(['price' => 99, 'stock' => 10]);
        
        $response = $this->actingAs($user)->postJson('/api/orders', [
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ]);
        
        $response->assertStatus(201);
        
        // 验证数据库
        $this->assertDatabaseHas('orders', [
            'user_id' => $user->id,
            'status' => 'paid',
        ]);
        
        // 验证库存扣减
        $product->refresh();
        $this->assertEquals(8, $product->stock);
        
        // 验证事件
        Event::assertDispatched(OrderPlaced::class);
    }
}
```

### 7.3 测试金字塔的实践

```
        /\
       /  \        E2E 测试（少量，验证关键流程）
      /    \
     /──────\      集成测试（中量，验证 Shell 层副作用）
    /        \
   /──────────\    单元测试（大量，验证 Functional Core 业务逻辑）
```

在 FCIS 架构下，**单元测试覆盖了大部分业务逻辑**，这些测试极快且极其稳定。集成测试只需验证"壳"是否正确工作——数量可以大幅减少。整体测试套件从原来的 5 分钟跑完缩短到 30 秒。

---

## 八、踩坑记录：实战中的权衡与教训

### 8.1 踩坑一：性能权衡——值对象的创建开销

在高并发场景下，每次请求创建大量不可变值对象会产生 GC 压力。我们做过压测，在每秒 5000 请求的场景下，值对象创建的开销大约增加了 3-5% 的内存使用。

**解决方案：**

- 对于大部分业务系统，这点开销完全可以接受
- 在极端性能敏感的路径（如支付回调处理），可以适当放宽不可变约束
- 使用 `readonly` class 而不是完整的 immutable library，减少框架开销

```php
// 轻量级值对象，比完整的 Money 库快 10x
final readonly class Price
{
    public function __construct(
        public int $cents,  // 用分存储，避免浮点精度问题
        public string $currency = 'CNY',
    ) {}
    
    public static function of(float $amount, string $currency = 'CNY'): self
    {
        return new self((int) round($amount * 100), $currency);
    }
    
    public function add(self $other): self
    {
        return new self($this->cents + $other->cents, $this->currency);
    }
    
    public function toFloat(): float
    {
        return $this->cents / 100;
    }
}
```

### 8.2 踩坑二：团队接受度——思维转变的阵痛

引入 FCIS 最大的阻力不是技术，而是人。

**典型反对声音：**

> "为什么要写这么多值对象？直接传数组不就行了？"
> "纯函数写起来太啰嗦了，以前一个 Service 方法就搞定了。"
> "这不就是过度设计吗？"

**我的应对策略：**

1. **不要一次性全面改造**。选择一个独立的、业务逻辑最复杂的功能模块做试点。我选择的是"价格计算"模块——它有 20 多种优惠规则组合，之前 Bug 频发。

2. **用数据说话**。试点模块引入 FCIS 后，线上 Bug 从每月 3-4 个降到 0 个；测试覆盖率从 40% 提升到 90%；新规则开发时间从 2 天缩短到 2 小时（因为可以在纯函数级别快速迭代和验证）。

3. **渐进式迁移**。先从纯计算逻辑开始，不要求团队一步到位。很多同事是在看到 FCIS 测试的简洁性后，主动开始在自己的模块中使用的。

### 8.3 踩坑三：时间依赖的处理

纯函数不能依赖当前时间，但订单需要时间戳。解决方案是将时间作为参数传入：

```php
// ❌ 不纯——依赖当前时间
public function isCouponValid(CouponRule $coupon): bool
{
    return $coupon->expiresAt->isAfter(now());
}

// ✅ 纯函数——时间作为参数
public function isCouponValid(CouponRule $coupon, DateTimeImmutable $now): bool
{
    return $coupon->expiresAt > $now;
}
```

Shell 层负责提供当前时间：

```php
// Shell 层
$isValid = $this->couponValidator->isCouponValid($coupon, new DateTimeImmutable());
```

这个模式一开始团队觉得很别扭，但很快就习惯了。好处是明显的：你可以轻松测试"优惠券刚好在过期前一秒"和"刚好过期后一秒"的边界情况。

### 8.4 踩坑四：与 Eloquent 的边界划分

最常见的问题是：Eloquent Model 到底算 Functional Core 还是 Imperative Shell？

答案是：**Eloquent Model 一定是 Imperative Shell**。因为：

- Eloquent Model 继承了 `Model` 基类，带有大量框架依赖
- Eloquent Model 的属性是可变的（可以通过 `fill()` 修改）
- Eloquent Model 携带了数据库连接、表名等运行时信息

正确做法是在 Shell 层做转换：

```php
// Shell 层：Eloquent Model → 值对象
function orderToSnapshot(Order $order): OrderSnapshot
{
    return new OrderSnapshot(
        id: $order->id,
        number: $order->number,
        total: Money::of($order->total, 'CNY'),
        items: $order->items->map(fn($item) => new OrderItemSnapshot(
            name: $item->name,
            quantity: $item->quantity,
            price: Money::of($item->unit_price, 'CNY'),
        ))->all(),
    );
}
```

### 8.5 踩坑五：渐进式迁移的实际路径

如果你有一个现有的 Laravel 项目，不可能一夜之间全部改成 FCIS。以下是我们实际采用的迁移路径：

**第一阶段（1-2 周）：提取值对象**

把项目中散落的 `array` 数据结构替换为值对象。这是最容易做的，也是风险最低的。

**第二阶段（2-4 周）：提取纯计算函数**

从 Service 层中识别出纯计算逻辑（通常是那些不调用 `DB::`、`Cache::`、`Mail::`、`event()` 的方法），提取到独立的类中。

**第三阶段（4-8 周）：重构 Service 为 Shell**

将原来的 Service 重构为 Shell 编排层：收集数据 → 调用纯函数 → 执行副作用。

**第四阶段（持续）：新功能采用 FCIS**

所有新功能默认采用 FCIS 架构。旧代码在有机会（重构、修 Bug）时逐步迁移。

### 8.6 踩坑六：Result 模式 vs 异常的取舍

并不是所有错误都需要用 Result 模式。我的经验法则是：

- **业务规则验证**（如"库存不足"、"未达最低消费"）→ 使用 Result
- **编程错误**（如"参数类型错误"、"不应该出现的状态"）→ 使用异常
- **基础设施错误**（如"数据库连接失败"）→ 使用异常

```php
// 业务规则验证 → Result
$result = $calculator->calculate($cart, $coupon, $config);
if (!$result->isSuccess) {
    return response()->json(['error' => $result->error], 422);
}

// 编程错误 → 异常
$product = Product::find($id);
if (!$product) {
    throw new ModelNotFoundException(); // 404
}
```

---

## 九、进阶技巧

### 9.1 命令模式 + FCIS

将 Shell 层的操作封装为 Command 对象，可以进一步提升可测试性和可组合性：

```php
// Command（Shell 层）
final readonly class PlaceOrderCommand
{
    public function __construct(
        public int $userId,
        public array $items,
        public ?string $couponCode = null,
    ) {}
}

// Handler（Shell 编排）
class PlaceOrderHandler
{
    public function __construct(
        private OrderCalculator $calculator,
        private OrderRepository $orders,
        private InventoryService $inventory,
    ) {}
    
    public function handle(PlaceOrderCommand $command): OrderResult
    {
        $cart = $this->buildCart($command->items);
        $coupon = $this->resolveCoupon($command->couponCode);
        
        // 调用 Functional Core
        $calculation = $this->calculator->calculate($cart, $coupon, PricingConfig::fromConfig());
        
        if (!$calculation->isSuccess) {
            return OrderResult::failed($calculation->error);
        }
        
        // 执行副作用
        $order = $this->orders->create($command, $calculation->value);
        $this->inventory->reserve($order, $cart);
        
        return OrderResult::success($order);
    }
}
```

### 9.2 管道模式（Pipeline）组合纯函数

Laravel 的 Pipeline 可以用来组合多个纯函数验证器：

```php
class OrderValidationPipeline
{
    /** @var array<class-string> */
    private array $validators = [
        ValidateCartNotEmpty::class,
        ValidateProductPrices::class,
        ValidateStockAvailability::class,
        ValidateCouponEligibility::class,
    ];
    
    public function validate(CartSnapshot $cart, ?CouponRule $coupon): Result
    {
        $result = Result::success($cart);
        
        foreach ($this->validators as $validator) {
            $result = $result->flatMap(
                fn(CartSnapshot $cart) => (new $validator)($cart, $coupon)
            );
            if (!$result->isSuccess) {
                return $result;
            }
        }
        
        return $result;
    }
}

// 每个验证器都是纯函数
final readonly class ValidateCartNotEmpty
{
    public function __invoke(CartSnapshot $cart, ?CouponRule $coupon): Result
    {
        return $cart->itemCount() > 0
            ? Result::success($cart)
            : Result::failure('购物车为空');
    }
}
```

### 9.3 使用 PHPStan 保证纯度

虽然 PHP 本身没有"纯函数"的类型系统，但可以通过 PHPStan 规则来检查：

```php
// phpstan-rules.neon
rules:
    - App\PHPStan\Rules\NoSideEffectsInDomainRule
```

自定义规则可以检查 `Domain/` 目录下的类不包含 `DB::`、`Cache::`、`Mail::`、`event()` 等调用。在 CI 中强制执行，防止副作用"侵入"Functional Core。

---

## 十、总结

Functional Core Imperative Shell 不是一个银弹，但它确实是我在 Laravel 项目中使用过的、最有效地提升代码可测试性和可维护性的架构模式。回顾核心要点：

1. **Functional Core 负责纯计算**：值对象 + 纯函数 + Result 模式，零依赖、零副作用、100% 可测试
2. **Imperative Shell 负责副作用**：Eloquent、HTTP、Queue、Event、Cache 等一切 IO 操作
3. **Shell 调用 Core，而非反过来**：数据从 Shell 流入 Core，计算结果从 Core 流回 Shell
4. **与 Clean Architecture / DDD 互补**：FCIS 解决的是计算与副作用的分离，不与现有架构冲突
5. **渐进式迁移**：从值对象开始，逐步提取纯函数，最终重构 Shell 编排层

如果你正在维护一个复杂的 Laravel 项目，且深受"胖 Service"和"测试地狱"的困扰，强烈建议尝试 FCIS。从一个独立的计算模块开始——比如价格计算、权限校验、表单验证——你很快就会感受到纯函数带来的简洁与安心。

---

## 相关阅读

- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/) —— FCIS 的 Imperative Shell 层天然契合六边形架构的端口与适配器思想，两者结合可进一步解耦基础设施
- [CQRS + Event Sourcing 完整实战：从事件存储到读模型投影——Laravel 订单系统的端到端实现](/categories/架构/CQRS-Event-Sourcing-完整实战-从事件存储到读模型投影-Laravel订单系统的端到端实现/) —— 当 Functional Core 的计算结果需要持久化为领域事件时，CQRS + ES 提供了完整的读写分离方案
- [Laravel Modular Monolith 实战：模块化单体架构](/categories/架构/2026-06-04-Laravel-Modular-Monolith-实战-模块化单体架构-介于单体与微服务之间的最佳平衡点/) —— 在模块化单体中，每个模块内部都可以采用 FCIS 模式来组织业务逻辑，实现模块级别的高内聚低耦合

---

*本文代码示例基于 PHP 8.2+ 和 Laravel 10+，部分简化了生产环境中的边界处理。完整的示例项目将在后续文章中分享。*
