---
title: Functional Core Imperative Shell 实战：Laravel 中的函数式核心——纯函数业务逻辑与副作用隔离
date: 2026-06-06 10:00:00
tags: [Laravel, PHP, 函数式编程, FCIS, Clean Architecture]
categories: [Laravel/PHP]
cover: /images/covers/fcis-laravel-cover.jpg
description: '深入讲解 Functional Core Imperative Shell（FCIS）架构模式在 Laravel PHP 项目中的实战落地。从纯函数、值对象到 Result 模式，系统性展示如何将业务计算逻辑与数据库、事件、缓存等副作用物理隔离，实现函数式核心层的可测试性与命令式外壳层的编排灵活性。对比 Clean Architecture 异同，提供完整订单系统案例、五步迁移路径与六大踩坑记录，帮助 Laravel 团队用最简架构显著提升代码质量。'
---

> **TL;DR**：FCIS 是一种将业务逻辑（纯计算）与副作用（IO、数据库、网络）强制分离的架构模式。在 Laravel 中，通过将核心计算抽离为纯函数类和值对象，让 Service / Action / Job 只做编排，可以显著提升可测试性、可维护性，并大幅降低"顺手改出 Bug"的概率。本文从理论到实战，完整覆盖 FCIS 在 Laravel 中的落地方法。

<!-- more -->

## 一、从一次深夜事故说起

去年某个周五凌晨两点，我被电话叫醒——线上订单系统出现了诡异的 Bug：部分用户的优惠券被重复扣减，库存也出现了不一致。排查了三个小时，最终定位到的原因让人哭笑不得：

```php
// 某同事在 OrderService 中添加的"小功能"
public function applyCoupon(Order $order, Coupon $coupon): void
{
    $discount = $coupon->calculateDiscount($order->subtotal);
    $order->discount_amount = $discount;
    $order->total = $order->subtotal - $discount;

    // "顺手"派发了一个事件——这行代码就是 Bug 的根源
    event(new CouponUsed($coupon, $order));
    $order->save();
}
```

事件监听器 `CouponUsedListener` 中又触发了一次扣减。两层副作用叠加，数据就乱了。问题的本质是：**计算折扣和派发事件（副作用）耦合在同一个方法里，导致"计算"这个纯逻辑"顺手"触发了不可预期的 IO 行为。**

如果 `calculateDiscount` 是一个纯函数——只接收数据、返回数据、绝不碰外部世界——这样的 Bug 根本不可能发生。因为纯函数的定义就决定了它不可能"顺手"做任何事，它的输出只取决于输入，不会对外部世界产生任何影响。这就是 Functional Core Imperative Shell（FCIS）模式要解决的核心问题。

类似的事故在很多团队中并不罕见。当一个 Service 类积累到数百行代码，当计算逻辑和数据库操作、事件派发、缓存读写混杂在一起时，代码就变成了一个"黑盒"——你不知道调用一个方法会触发多少隐藏的副作用。而 FCIS 模式的核心理念，就是把这个黑盒拆开，让计算归计算，让 IO 归 IO，让两者的边界变得清晰可见。

---

## 二、FCIS 理论介绍

### 2.1 起源：Gary Bernhardt 的 "Boundaries"

Functional Core Imperative Shell 最早由 Gary Bernhardt 在 2012 年的演讲 "Boundaries" 中提出。这个演讲虽然只有短短三十分钟，但它提出的架构思想影响了无数开发者。其核心思想可以用一句话概括：

> **将系统分为两层：一个纯函数式的"核心"（Functional Core）负责所有业务逻辑计算；一个命令式的"外壳"（Imperative Shell）负责所有副作用（IO、数据库、网络等）。**

这个理念并不复杂，但它的力量在于强制性——通过架构层面的约束，而不是靠开发者的自觉，来保证计算逻辑的纯粹性。

### 2.2 两层的职责划分

**Functional Core（函数式核心）** 是整个系统的"大脑"。它只做一件事：接收输入数据，返回输出数据。它不查询数据库，不调用外部 API，不发送事件，不写日志，甚至不获取当前时间。给定相同的输入，它永远返回相同的输出。这种确定性是它最大的价值——你可以用无数个测试用例来覆盖它的每一条分支路径，而不需要 mock 任何东西。

**Imperative Shell（命令式外壳）** 是整个系统的"手脚"。它负责与外部世界交互：从数据库读取数据、调用 Functional Core 进行计算、将计算结果写回数据库、派发事件、发送通知。Shell 层的代码看起来很"传统"——它就是我们平时写的 Laravel 代码，但它的职责被严格限定在"编排"层面，所有的业务计算都委托给了 Core。

这种划分的哲学含义是：**变化频繁的业务规则应该被放在最容易测试的地方**。业务规则变了，你只需要修改 Core 层的纯函数，然后用单元测试验证。Shell 层很少需要改动，因为它只是在"搬运数据"。

### 2.3 架构总览图

用文字描述 FCIS 的数据流：

```
┌───────────────────────────────────────────────────────┐
│                  Imperative Shell（外壳层）             │
│                                                       │
│  HTTP Request ──► Controller / Job / Listener          │
│                      │                                │
│                      ▼                                │
│              从数据库/API 读取原始数据                    │
│                      │                                │
│                      ▼                                │
│              将原始数据转为不可变值对象（DTO）              │
│                      │                                │
│  ┌───────────────────┼───────────────────────────┐    │
│  │    Functional Core（核心层）                    │    │
│  │                   │                            │    │
│  │           纯函数计算（无IO）                     │    │
│  │                   │                            │    │
│  │         返回新的值对象/Result                    │    │
│  └───────────────────┼───────────────────────────┘    │
│                      │                                │
│                      ▼                                │
│              将结果写回数据库                            │
│              派发事件 / 发送通知 / 调用外部 API            │
│                      │                                │
│                      ▼                                │
│                  HTTP Response                         │
└───────────────────────────────────────────────────────┘
```

核心原则是**数据单向流动**：原始数据从外部世界流入 Shell 层，Shell 层将其转换为不可变的值对象后传入 Core 层，Core 层完成计算后返回新的值对象，Shell 层再将结果"翻译"回外部操作。整个过程中，Core 层永远不碰外部世界。

### 2.4 与传统 MVC 的区别

在典型的 Laravel MVC 架构中，业务逻辑往往散落在 Controller、Model、Service 多个层级中。一个 `OrderService` 类可能同时包含数据查询、业务计算、事件派发、缓存操作。这种"大杂烩"式的写法在项目初期看不出问题，但随着业务复杂度增长，会逐渐变成维护噩梦。

传统做法的核心问题是**副作用和计算逻辑交织在一起**。当你阅读一个方法时，你需要在脑子里同时追踪"它算出了什么"和"它对外部世界做了什么"。这极大地增加了认知负担，也使得单元测试变得困难——你需要 mock 掉所有外部依赖，而这些 mock 本身就可能引入 Bug。

FCIS 模式通过物理隔离解决了这个问题。在 FCIS 中，计算逻辑被放在独立的纯函数类中，这些类不依赖任何框架组件，不引入任何 `Illuminate\*` 命名空间的类。你可以用最简单的 PHPUnit 测试来验证它们，不需要 `TestCase`，不需要 `RefreshDatabase`，不需要任何 Laravel 的测试基础设施。

### 2.5 为什么 PHP 和 Laravel 开发者应该关注 FCIS

很多人会问：FCIS 听起来很"函数式编程"，PHP 作为一门以面向对象为主的语言，真的适合这种模式吗？我的回答是：**非常适合，甚至比很多函数式语言更需要它**。

原因在于 Laravel 的便利性是一把双刃剑。Facade、Eloquent、事件系统、队列——这些强大的工具让开发变得极其高效，但也让"不小心触发副作用"变得极其容易。一个 `User::find()` 背后是数据库查询，一个 `event()` 背后可能触发一系列连锁反应，一个 `now()` 就让你的代码失去了确定性。当这些"方便"的调用散落在业务逻辑的各个角落时，代码的可预测性和可测试性就会急剧下降。

FCIS 不是要你放弃 Laravel 的便利性，而是告诉你在哪里使用它们。在 Shell 层，你可以尽情使用 Eloquent、Facade、事件系统。但在 Core 层，你需要约束自己只写纯 PHP。这种约束带来的收益是巨大的：Core 层的代码可以被 100% 单元测试覆盖，测试运行速度快到令人愉悦（数百个测试几秒内完成），而且测试结果是确定性的——不会因为数据库状态不同而时好时坏。

---

## 三、Laravel 中的 FCIS 实现

### 3.1 值对象（Value Objects）：Functional Core 的数据载体

Functional Core 的输入和输出都应该是不可变的值对象。值对象是 FCIS 架构中最关键的基础设施——它们是 Core 和 Shell 之间的"协议"，定义了两个层之间交换数据的格式。

PHP 8.1 引入的 `readonly` 关键字让值对象的实现变得非常简洁。`readonly` 修饰的类，其所有属性在构造后就不能修改，这天然地保证了不可变性。在 FCIS 中，值对象有两个主要来源：一是从 Eloquent Model 转换而来（作为 Core 的输入），二是由 Core 的计算函数返回（作为 Core 的输出）。

```php
// 值对象：不可变，没有行为（或只有纯计算行为）
readonly class OrderItemData
{
    public function __construct(
        public int $productId,
        public string $productName,
        public int $quantity,
        public float $unitPrice,
    ) {}

    public static function fromModel(OrderItem $item): self
    {
        return new self(
            productId: $item->product_id,
            productName: $item->product->name,
            quantity: $item->quantity,
            unitPrice: (float) $item->unit_price,
        );
    }

    // 纯计算：小计
    public function subtotal(): float
    {
        return $this->quantity * $this->unitPrice;
    }
}

readonly class OrderData
{
    public function __construct(
        public int $id,
        /** @var OrderItemData[] */
        public array $items,
        public ?string $couponCode,
    ) {}

    public function subtotal(): float
    {
        return array_sum(array_map(
            fn(OrderItemData $item) => $item->subtotal(),
            $this->items
        ));
    }
}
```

**值对象的设计要点**：值对象应该包含足够的数据，使得 Core 层的纯函数不需要再回头去查数据库。这要求在 Shell 层做数据准备时就要想到 Core 层需要哪些字段。值对象中的方法应该是纯计算方法——比如上面的 `subtotal()` 方法，它只是对已有数据做数学运算，不涉及任何 IO。

一个常见的错误是值对象中混入了 Eloquent 关联查询。比如在 `OrderItemData` 中写一个 `getProduct()` 方法去查询数据库，这就破坏了值对象的不可变性和确定性。值对象应该是一个"数据快照"——它记录了某个时间点的状态，之后不会再变化。

### 3.2 Result 模式：优雅地处理业务失败

在纯函数中，我们不应该抛出异常。异常本质上是一种副作用——它中断了正常的控制流，强制调用者必须用 try-catch 来处理，而且异常携带的堆栈信息在纯计算场景中毫无意义。更好的方式是使用 Result 模式：让函数返回一个明确的成功或失败结果，调用者通过判断返回值来决定下一步操作。

```php
readonly class Result
{
    private function __construct(
        public bool $success,
        public ?string $error,
        public mixed $data = null,
    ) {}

    public static function ok(mixed $data = null): self
    {
        return new self(success: true, error: null, data: $data);
    }

    public static function fail(string $error): self
    {
        return new self(success: false, error: $error, data: null);
    }
}
```

Result 模式在函数式编程中非常常见，Rust 语言内置了 `Result<T, E>` 类型，Haskell 有 `Either`，Scala 也有类似的机制。在 PHP 中我们虽然没有语言级别的支持，但通过一个简单的 readonly 类就能实现相同的效果。使用 Result 模式后，Core 层的代码读起来会更加清晰——每个可能失败的计算都通过返回值来表达结果，而不是通过异常来"逃逸"。

```php
readonly class OrderPricingEngine
{
    /**
     * 计算订单最终价格——纯函数，无IO
     */
    public static function calculate(
        OrderData $order,
        CustomerData $customer,
        array $coupons,
        array $taxRules,
    ): Result {
        // 基础校验（纯逻辑，不抛异常）
        if (empty($order->items)) {
            return Result::fail('订单商品不能为空');
        }

        $subtotal = $order->subtotal();

        // 计算折扣
        $discountResult = DiscountCalculator::calculate($subtotal, $coupons);
        if (!$discountResult->success) {
            return $discountResult;
        }

        $afterDiscount = $subtotal - $discountResult->data['discount'];

        // 计算税费
        $tax = TaxCalculator::calculate($afterDiscount, $taxRules, $customer->region);

        // 计算运费
        $shipping = ShippingCalculator::calculate(
            $order->items,
            $customer->address,
            $customer->isVip,
        );

        $finalTotal = $afterDiscount + $tax + $shipping->amount;

        return Result::ok(new PricingResult(
            subtotal: $subtotal,
            discountAmount: $discountResult->data['discount'],
            taxAmount: $tax,
            shippingCost: $shipping->amount,
            finalTotal: $finalTotal,
            appliedDiscountRules: $discountResult->data['appliedRules'],
            freeShipping: $shipping->isFree,
        ));
    }
}
```

注意这个函数的签名——它接收的全部是值对象，返回的是 Result。没有 Eloquent Model，没有数据库查询，没有事件派发。如果你把这段代码复制到一个纯 PHPUnit 测试文件中，它可以直接运行，不需要任何 Laravel 基础设施。

Shell 层负责将 Result "翻译"成具体的操作——成功就写数据库，失败就抛异常或返回错误响应：

```php
class PlaceOrderAction
{
    public function execute(PlaceOrderRequest $request): Order
    {
        // Shell 层：从外部世界获取数据
        $items = OrderItem::where('cart_id', $request->cartId)->with('product')->get();
        $customer = Customer::find($request->customerId);
        $coupons = Coupon::whereIn('code', $request->couponCodes)->active()->get();
        $taxRules = TaxRule::where('region', $customer->region)->get();

        // 转换为值对象
        $orderData = new OrderData(
            id: 0, // 尚未创建
            items: $items->map(fn($i) => OrderItemData::fromModel($i))->toArray(),
            couponCode: $request->couponCodes[0] ?? null,
        );
        $customerData = CustomerData::fromModel($customer);

        // Shell 层：调用纯函数计算
        $result = OrderPricingEngine::calculate(
            $orderData,
            $customerData,
            array_map(fn($c) => CouponData::fromModel($c), $coupons->toArray()),
            array_map(fn($r) => TaxRuleData::fromModel($r), $taxRules->toArray()),
        );

        // Shell 层：根据计算结果，执行副作用
        if (!$result->success) {
            throw new BusinessException($result->error);
        }

        $pricing = $result->data;

        return DB::transaction(function () use ($request, $pricing, $items, $customer) {
            $order = Order::create([
                'customer_id' => $customer->id,
                'subtotal' => $pricing->subtotal,
                'discount_amount' => $pricing->discountAmount,
                'tax_amount' => $pricing->taxAmount,
                'shipping_cost' => $pricing->shippingCost,
                'total' => $pricing->finalTotal,
            ]);

            foreach ($items as $item) {
                $order->items()->create([...]);
            }

            event(new OrderPlaced($order));

            return $order;
        });
    }
}
```

Shell 层的代码看起来很"传统"，这正是 FCIS 的设计哲学——Shell 层不需要特殊的写法，它就是正常的 Laravel 代码。关键在于，所有的业务计算都已经被"推"到了 Core 层，Shell 层只是在做数据搬运和编排。

### 3.3 更复杂的纯函数：库存检查与预留

库存分配是电商系统中最典型的复杂业务逻辑之一。在多仓库场景下，需要根据仓库优先级、库存数量、商品种类等多个因素来决定每个商品从哪个仓库发货。这个算法如果和数据库操作混在一起，几乎不可能做到全面的单元测试。但一旦把它抽成纯函数，事情就变得简单了：

```php
readonly class InventoryAllocator
{
    /**
     * 分配库存——纯函数
     *
     * @param  array<int, WarehouseStock>  $warehouses  各仓库库存
     * @param  array<int, OrderItemData>   $orderItems  订单商品
     * @return Result<AllocationPlan>
     */
    public static function allocate(array $warehouses, array $orderItems): Result
    {
        $plan = [];  // warehouse_id => [product_id => quantity]
        $remaining = [];

        // 复制剩余需求（不修改原始数据）
        foreach ($orderItems as $item) {
            $remaining[$item->productId] = $item->quantity;
        }

        // 按仓库优先级分配
        usort($warehouses, fn($a, $b) => $a->priority <=> $b->priority);

        foreach ($warehouses as $warehouse) {
            foreach ($remaining as $productId => $needed) {
                if ($needed <= 0) continue;

                $available = $warehouse->stock[$productId] ?? 0;
                $allocated = min($needed, $available);

                if ($allocated > 0) {
                    $plan[$warehouse->id][$productId] = $allocated;
                    $remaining[$productId] -= $allocated;
                }
            }
        }

        // 检查是否所有商品都已分配
        foreach ($remaining as $productId => $unfulfilled) {
            if ($unfulfilled > 0) {
                return Result::fail("商品 {$productId} 库存不足，缺少 {$unfulfilled} 件");
            }
        }

        return Result::ok(new AllocationPlan($plan));
    }
}
```

这个分配算法完全是纯函数——它不查询数据库，不调用任何外部服务，只根据传入的数据做计算。这意味着你可以写几十个测试用例来验证各种边界情况：单仓库够用、单仓库不够需要拆单、多仓库按优先级分配、所有仓库都不够、刚好够但需要跨三个仓库等。这些测试全部是纯单元测试，运行速度极快，不依赖任何外部资源。

---

## 四、副作用隔离的实践技巧

### 4.1 识别副作用

在 Laravel 中，副作用无处不在，有些很明显，有些则很隐蔽。识别副作用是实践 FCIS 的第一步——你需要知道哪些操作属于 Shell 层，哪些逻辑属于 Core 层。

常见的副作用类型包括：数据库读写（`Model::find()`、`DB::table()`）、事件派发（`event()`、`Event::dispatch()`）、队列调度（`dispatch()`、`Queue::push()`）、HTTP 请求（`Http::get()`、`Guzzle`）、缓存操作（`Cache::get()`、`Cache::put()`）、日志记录（`Log::info()`）、文件系统操作（`Storage::put()`）。此外，还有两个容易被忽视的"隐式副作用"：**时间依赖**（`now()`、`Carbon::now()`）和**随机性**（`rand()`、`Str::random()`）。

识别这些副作用的方法很简单：**如果一个函数的行为受到外部世界的影响，或者它会对外部世界产生影响，那它就包含副作用。** 一个纯函数应该满足：给定相同的输入，永远产生相同的输出，不依赖任何外部状态，也不修改任何外部状态。

### 4.2 时间和随机性的处理

时间和随机性是最容易被忽视的"隐式副作用"。很多开发者在写业务逻辑时会随手调用 `now()` 或 `Str::uuid()`，认为这不算什么副作用。但从纯函数的角度看，`now()` 每次调用都返回不同的值——这违反了"相同输入产生相同输出"的确定性原则。

处理方法很简单——把它们作为参数注入：

```php
// ❌ 错误：Core 里调用了 now()，不再是纯函数
class PromotionEngine
{
    public static function isPromotionActive(PromotionData $promo): bool
    {
        $now = now(); // 副作用！每次调用结果不同
        return $now->between($promo->startDate, $promo->endDate);
    }
}

// ✅ 正确：时间作为参数传入
class PromotionEngine
{
    public static function isPromotionActive(PromotionData $promo, Carbon $currentTime): bool
    {
        return $currentTime->between($promo->startDate, $promo->endDate);
    }
}

// Shell 层传入时间
$isActive = PromotionEngine::isPromotionActive($promo, now());
```

这种做法看起来多此一举，但它带来的测试价值是巨大的。在测试中，你可以传入任意时间点来验证各种场景：促销刚开始、促销快结束、促销已过期、跨时区的边界情况等。如果时间在函数内部硬编码为 `now()`，你就无法在不 mock 底层时间函数的情况下测试这些场景。

同样的方法适用于随机数、UUID 生成、环境变量读取等所有非确定性操作。核心原则是：**让 Shell 层负责获取这些外部值，然后作为参数传递给 Core 层。** Core 层对这些值的来源一无所知，它只知道"我收到了一个时间戳"或"我收到了一个 UUID"。

### 4.3 数据库事务的处理

事务是典型的 Shell 层职责。Core 层不关心事务——它只负责计算，不知道也不需要知道这些计算结果最终会被如何使用。Shell 层负责在适当的时机开启和提交事务，确保多个数据库操作的原子性。

```php
class TransferMoneyAction
{
    public function execute(int $fromAccountId, int $toAccountId, float $amount): TransferResult
    {
        return DB::transaction(function () use ($fromAccountId, $toAccountId, $amount) {
            // Shell：读取数据（使用悲观锁确保并发安全）
            $from = Account::lockForUpdate()->find($fromAccountId);
            $to = Account::lockForUpdate()->find($toAccountId);

            // 转为值对象
            $fromData = AccountData::fromModel($from);
            $toData = AccountData::fromModel($to);

            // Core：纯计算
            $result = TransferCalculator::transfer($fromData, $toData, $amount);

            if (!$result->success) {
                throw new BusinessException($result->error);
            }

            // Shell：写回数据
            $from->update(['balance' => $result->data->fromBalance]);
            $to->update(['balance' => $result->data->toBalance]);

            // Shell：派发事件
            event(new MoneyTransferred($from, $to, $amount));

            return $result;
        });
    }
}

// Core：纯函数
class TransferCalculator
{
    public static function transfer(
        AccountData $from,
        AccountData $to,
        float $amount
    ): Result {
        if ($amount <= 0) {
            return Result::fail('转账金额必须大于零');
        }
        if ($from->balance < $amount) {
            return Result::fail('余额不足');
        }

        return Result::ok(new TransferResult(
            fromBalance: $from->balance - $amount,
            toBalance: $to->balance + $amount,
        ));
    }
}
```

这个转账示例完美展示了 FCIS 的分工：`TransferCalculator::transfer` 只做加减法和条件判断，它不知道什么是"锁"，什么是"事务"，什么是"事件"。所有这些复杂的外部操作都由 Shell 层的 `TransferMoneyAction` 负责。如果你要修改转账的校验规则（比如增加单日限额），你只需要修改 Core 层的纯函数。如果你要修改事务策略（比如从悲观锁改为乐观锁），你只需要修改 Shell 层。

---

## 五、实战案例：完整的订单处理流程

### 5.1 需求描述

一个电商系统的下单流程需要执行以下步骤：验证购物车有效性、计算商品价格（含折扣、满减、会员价）、计算税费、计算运费、检查库存并分配、扣减优惠券、创建订单、派发事件（扣减库存、发送确认邮件、推送通知）。这个流程涉及多个外部系统的交互，但核心的"计算"逻辑其实是完全确定性的。

### 5.2 Functional Core 设计

Core 层被设计为多个独立的纯函数类，每个类负责一个特定的计算领域。它们之间可以相互调用，但都遵循"只接收值对象，只返回值对象或 Result"的原则：

```php
// ===== 值对象定义 =====

readonly class CartItemData
{
    public function __construct(
        public int $productId,
        public string $sku,
        public string $name,
        public int $quantity,
        public float $price,
        public float $weight,
        public bool $taxable,
        public ?float $memberPrice,
    ) {}

    public function effectivePrice(bool $isMember): float
    {
        return ($isMember && $this->memberPrice !== null)
            ? $this->memberPrice
            : $this->price;
    }

    public function subtotal(bool $isMember): float
    {
        return $this->effectivePrice($isMember) * $this->quantity;
    }
}

readonly class CartData
{
    public function __construct(
        public int $customerId,
        public bool $isMember,
        /** @var CartItemData[] */
        public array $items,
        public string $region,
        public ?string $couponCode,
    ) {}
}

// ===== 纯函数计算引擎 =====

readonly class CartValidationEngine
{
    /**
     * 验证购物车——纯函数
     */
    public static function validate(CartData $cart): Result
    {
        if (empty($cart->items)) {
            return Result::fail('购物车为空');
        }

        foreach ($cart->items as $item) {
            if ($item->quantity <= 0) {
                return Result::fail("商品 {$item->name} 数量无效");
            }
            if ($item->price <= 0) {
                return Result::fail("商品 {$item->name} 价格无效");
            }
        }

        $total = array_sum(array_map(
            fn($item) => $item->subtotal($cart->isMember),
            $cart->items
        ));

        if ($total > 50000) {
            return Result::fail('单笔订单金额不能超过 50000 元');
        }

        return Result::ok();
    }
}

readonly class PricingEngine
{
    /**
     * 计算完整订单价格——纯函数
     */
    public static function price(
        CartData $cart,
        array $promotionRules,
        array $taxRules,
        array $shippingRates,
    ): Result {
        $isMember = $cart->isMember;

        // 1. 计算商品小计
        $items = [];
        foreach ($cart->items as $item) {
            $effectivePrice = $item->effectivePrice($isMember);
            $items[] = new PricedItemData(
                productId: $item->productId,
                sku: $item->sku,
                name: $item->name,
                quantity: $item->quantity,
                originalPrice: $item->price,
                effectivePrice: $effectivePrice,
                subtotal: $effectivePrice * $item->quantity,
                taxable: $item->taxable,
            );
        }

        $subtotal = array_sum(array_map(fn($i) => $i->subtotal, $items));

        // 2. 计算促销折扣（取最优折扣）
        $discountResult = PromotionCalculator::calculate($subtotal, $items, $promotionRules);
        $afterDiscount = $subtotal - $discountResult->amount;

        // 3. 计算税费（仅对含税商品按折后比例分摊）
        $taxableAmount = array_sum(array_filter(
            array_map(fn($i) => $i->taxable ? $i->subtotal : 0, $items)
        ));
        $tax = TaxCalculator::compute(
            $taxableAmount * ($afterDiscount / max($subtotal, 1)),
            $taxRules,
            $cart->region
        );

        // 4. 计算运费
        $totalWeight = array_sum(array_map(
            fn($item) => $item->weight * $item->quantity,
            $cart->items
        ));
        $shippingResult = ShippingCalculator::compute(
            $totalWeight,
            $afterDiscount,
            $shippingRates,
            $cart->region
        );

        // 5. 计算最终总价
        $finalTotal = round($afterDiscount + $tax + $shippingResult->cost, 2);

        return Result::ok(new OrderPricingResult(
            items: $items,
            subtotal: $subtotal,
            discountAmount: $discountResult->amount,
            discountDetails: $discountResult->details,
            taxAmount: $tax,
            shippingCost: $shippingResult->cost,
            freeShipping: $shippingResult->isFree,
            finalTotal: $finalTotal,
        ));
    }
}

readonly class PromotionCalculator
{
    /**
     * 计算最优促销折扣——纯函数
     *
     * 遍历所有促销规则，取折扣最大的一条。支持百分比折扣、固定金额、
     * 买赠活动、阶梯满减等多种类型。
     */
    public static function calculate(
        float $subtotal,
        array $items,
        array $rules,
    ): PromotionResult {
        $bestDiscount = 0.0;
        $bestDetails = [];

        foreach ($rules as $rule) {
            $discount = match ($rule->type) {
                'percentage' => $subtotal * ($rule->value / 100),
                'fixed' => $rule->value,
                'buy_x_get_y' => self::calculateBogo($items, $rule),
                'tiered' => self::calculateTiered($subtotal, $rule),
                default => 0.0,
            };

            $discount = min($discount, $rule->maxDiscount ?? PHP_FLOAT_MAX);

            if ($discount > $bestDiscount) {
                $bestDiscount = $discount;
                $bestDetails = ['rule' => $rule->name, 'type' => $rule->type];
            }
        }

        return new PromotionResult(amount: $bestDiscount, details: $bestDetails);
    }

    private static function calculateBogo(array $items, object $rule): float
    {
        $discount = 0.0;
        foreach ($items as $item) {
            if ($item->productId === $rule->productId && $item->quantity >= $rule->buyQuantity) {
                $freeCount = intdiv($item->quantity, $rule->buyQuantity + $rule->getQuantity);
                $freeCount = min($freeCount, $rule->maxFree ?? PHP_INT_MAX);
                $discount += $freeCount * $item->effectivePrice;
            }
        }
        return $discount;
    }

    private static function calculateTiered(float $subtotal, object $rule): float
    {
        $applicableTier = null;
        foreach ($rule->tiers as $tier) {
            if ($subtotal >= $tier->threshold) {
                $applicableTier = $tier;
            }
        }
        return $applicableTier ? $applicableTier->discount : 0.0;
    }
}

readonly class InventoryAllocator
{
    /**
     * 多仓库库存分配——纯函数
     */
    public static function allocate(
        array $requestedItems,
        array $warehouseStocks,
    ): Result {
        $allocation = [];
        $unfulfilled = [];

        foreach ($requestedItems as $item) {
            $remaining = $item->quantity;
            $itemAllocation = [];

            foreach ($warehouseStocks as $warehouse) {
                if ($remaining <= 0) break;

                $available = $warehouse->getStock($item->productId);
                $allocate = min($remaining, $available);

                if ($allocate > 0) {
                    $itemAllocation[] = [
                        'warehouse_id' => $warehouse->id,
                        'product_id' => $item->productId,
                        'quantity' => $allocate,
                    ];
                    $remaining -= $allocate;
                }
            }

            if ($remaining > 0) {
                $unfulfilled[] = [
                    'product_id' => $item->productId,
                    'shortage' => $remaining,
                ];
            } else {
                $allocation = array_merge($allocation, $itemAllocation);
            }
        }

        if (!empty($unfulfilled)) {
            $messages = array_map(
                fn($u) => "商品 {$u['product_id']} 缺少 {$u['shortage']} 件",
                $unfulfilled
            );
            return Result::fail('库存不足: ' . implode(', ', $messages));
        }

        return Result::ok(new AllocationPlan($allocation));
    }
}
```

### 5.3 Imperative Shell 编排

Shell 层是整个流程的"指挥官"——它知道从哪里获取数据，知道什么时候调用哪个 Core 函数，知道如何将计算结果转化为实际的外部操作：

```php
class PlaceOrderAction
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly CouponService $coupons,
        private readonly PromotionService $promotions,
        private readonly EventDispatcher $events,
    ) {}

    public function execute(PlaceOrderRequest $request): Order
    {
        // ========== Shell：从外部世界获取数据 ==========
        $customer = Customer::with('membership')->findOrFail($request->customerId);
        $cartItems = CartItem::where('customer_id', $customer->id)
            ->with('product')
            ->get();

        $cartData = new CartData(
            customerId: $customer->id,
            isMember: $customer->membership?->isActive() ?? false,
            items: $cartItems->map(fn($ci) => new CartItemData(
                productId: $ci->product_id,
                sku: $ci->product->sku,
                name: $ci->product->name,
                quantity: $ci->quantity,
                price: (float) $ci->product->price,
                weight: (float) $ci->product->weight,
                taxable: $ci->product->taxable,
                memberPrice: $ci->product->member_price,
            ))->toArray(),
            region: $customer->address->region,
            couponCode: $request->couponCode,
        );

        $promotionRules = $this->promotions->getActiveRules();
        $taxRules = TaxRule::where('region', $cartData->region)->get()->toArray();
        $shippingRates = ShippingRate::where('region', $cartData->region)->get()->toArray();
        $warehouseStocks = $this->inventory->getAllWarehouseStocks();

        // ========== Shell：调用 Functional Core 计算 ==========

        // 1. 验证购物车
        $validation = CartValidationEngine::validate($cartData);
        if (!$validation->success) {
            throw new BusinessException($validation->error);
        }

        // 2. 计算价格
        $pricingResult = PricingEngine::price(
            $cartData, $promotionRules, $taxRules, $shippingRates
        );
        if (!$pricingResult->success) {
            throw new BusinessException($pricingResult->error);
        }
        $pricing = $pricingResult->data;

        // 3. 分配库存
        $allocResult = InventoryAllocator::allocate($cartData->items, $warehouseStocks);
        if (!$allocResult->success) {
            throw new BusinessException($allocResult->error);
        }

        // ========== Shell：将计算结果写回外部世界 ==========

        return DB::transaction(function () use ($customer, $pricing, $allocResult, $request) {
            $order = Order::create([
                'customer_id' => $customer->id,
                'status' => 'pending',
                'subtotal' => $pricing->subtotal,
                'discount_amount' => $pricing->discountAmount,
                'tax_amount' => $pricing->taxAmount,
                'shipping_cost' => $pricing->shippingCost,
                'total' => $pricing->finalTotal,
            ]);

            foreach ($pricing->items as $item) {
                $order->items()->create([
                    'product_id' => $item->productId,
                    'sku' => $item->sku,
                    'name' => $item->name,
                    'quantity' => $item->quantity,
                    'price' => $item->effectivePrice,
                    'subtotal' => $item->subtotal,
                ]);
            }

            foreach ($allocResult->data->allocations as $allocation) {
                $this->inventory->decrement(
                    $allocation['warehouse_id'],
                    $allocation['product_id'],
                    $allocation['quantity'],
                );
            }

            if ($request->couponCode) {
                $this->coupons->consume($request->couponCode, $customer->id);
            }

            $this->events->dispatch(new OrderPlaced($order));
            $this->events->dispatch(new NotifyCustomer($customer, $order));
            $this->events->dispatch(new UpdateSalesStats($order));

            return $order;
        });
    }
}
```

### 5.4 架构数据流图（文字描述）

整个下单流程的数据流可以用以下方式描述：

```
用户请求 (PlaceOrderRequest)
    │
    ▼
[Shell] 读取 Customer, CartItem, PromotionRule, TaxRule, ShippingRate, WarehouseStock
    │
    ▼
[Shell] 转换为值对象: CartData, CustomerData, ...
    │
    ├──────────────────────────────────────────────┐
    │                                              │
    ▼                                              ▼
[Core] CartValidationEngine::validate()    [Core] PricingEngine::price()
    │                                              │
    │                                              ▼
    │                                      [Core] PromotionCalculator::calculate()
    │                                              │
    │                                              ▼
    │                                      [Core] TaxCalculator::compute()
    │                                              │
    │                                              ▼
    │                                      [Core] ShippingCalculator::compute()
    │                                              │
    ▼                                              ▼
[Core] InventoryAllocator::allocate()
    │
    ▼
[Shell] DB::transaction {
           Order::create()
           OrderItem::create()
           Inventory::decrement()
           Coupon::consume()
           event(OrderPlaced)
           event(NotifyCustomer)
        }
    │
    ▼
返回 Order
```

可以看到，Core 层的多个计算引擎可以并行或串行调用，它们之间只通过值对象传递数据，不共享任何可变状态。Shell 层负责协调这些调用的顺序和结果的持久化。

---

## 六、与 Clean Architecture 的对比

### 6.1 相似之处

FCIS 和 Clean Architecture 都强调依赖方向的正确性——核心业务逻辑不应该依赖外部细节。两者都追求可测试性，都试图通过架构约束来减少"意外的副作用"。如果你已经熟悉 Clean Architecture 的分层思想，理解 FCIS 会非常容易。

### 6.2 关键区别

FCIS 的最大特点是**极简**——它只有两层（Core 和 Shell），没有 Clean Architecture 那样的四层（Entity、UseCase、Interface Adapter、Framework）。这种极简性使得 FCIS 的学习成本非常低，团队成员几乎不需要额外的架构培训就能上手。

Clean Architecture 通过接口（Port/Adapter）来实现依赖反转，这在大型项目中是必要的——当多个模块需要协作时，接口定义了它们之间的契约。但在中小型项目中，这种抽象层次可能过度了。FCIS 不需要定义接口，Core 层的纯函数直接被 Shell 层调用，减少了间接层。

从 PHP 生态的角度看，FCIS 更加契合 Laravel 的开发风格。Laravel 本身就是一个"约定优于配置"的框架，而 FCIS 的两层结构简单到几乎不需要额外的约定。你不需要学习什么 UseCase、Gateway、Presenter——你只需要知道"计算放 Core，IO 放 Shell"。

### 6.3 可以结合使用

在实际项目中，FCIS 和 Clean Architecture 并不是互斥的。我倾向于在**模块内部**使用 FCIS，在**模块之间**使用 Clean Architecture 的分层思想。具体来说，每个业务模块（订单、支付、物流等）内部使用 FCIS 来组织代码，而模块之间的协作通过接口和事件来实现。这样既保持了模块内部的简洁性，又保证了模块之间的松耦合。

---

## 七、从胖 Service 到 FCIS 的迁移路径

很多团队面对的是一个已经存在的"胖 Service"代码库，而不是从零开始的新项目。在这种情况下，如何逐步引入 FCIS 呢？我的经验是采用"绞杀者模式"——不要一次性重构所有代码，而是从最复杂的计算逻辑开始，逐步将它们迁移到 Core 层。

第一步是**识别"纯计算"**。打开你的 Service 类，逐行审查每个方法，标记出哪些行是纯计算，哪些行是副作用。你会发现，很多看起来很复杂的方法，实际上纯计算部分和副作用部分是明显分离的——通常前半部分在读取数据和做计算，后半部分在写回数据和派发事件。

第二步是**提取值对象**。将纯计算部分依赖的数据结构定义为 `readonly` 值对象，写一个 `fromModel` 静态工厂方法来做转换。这一步是安全的，不会改变任何现有行为。

第三步是**提取纯函数**。将纯计算逻辑从 Service 方法中移到独立的纯函数类中，修改 Service 方法来调用这些纯函数。这一步同样是安全的——只要你的提取是正确的，系统的外部行为不会有任何变化。

第四步是**补充单元测试**。现在纯函数已经独立出来了，你可以为它们编写大量的单元测试。这些测试运行速度快、编写简单，可以在几分钟内覆盖几十种场景。

第五步是**清理 Shell 层**。随着 Core 层越来越完善，Shell 层的方法会变得越来越薄——它们只剩下数据获取、值对象转换、Core 调用、结果持久化这几个步骤。这时候你可以考虑将 Shell 层的方法进一步简化，比如使用 Action 模式将每个操作封装为独立的类。

---

## 八、踩坑记录与最佳实践

### 踩坑 1：值对象转换的性能问题

在大型订单中，将每个 Eloquent Model 转为值对象会有明显的性能开销，特别是当需要 eager load 多层关联时。我的经验是：在 Shell 层做好数据预加载，使用 `with()` 避免 N+1 查询，然后在转换时批量处理而不是逐个处理。如果值对象的字段很多，可以考虑使用 `symfony/serializer` 或自定义的批量转换方法来减少代码量。

### 踩坑 2：纯函数中的对象状态陷阱

PHP 对象是引用传递的，不小心就会在 Core 中修改了传入的数据。`readonly` 类可以防止这种情况，但你还需要注意数组中的对象——PHP 的 `array_map` 不会深拷贝数组元素。如果数组中包含可变对象，你需要在纯函数中手动创建新对象而不是修改原对象。**最佳实践是：Core 层只使用 `readonly` 类和基本类型（string、int、float、bool、array），避免使用可变对象。**

### 踩坑 3：过度拆分导致"类爆炸"

一开始学习 FCIS 时，很容易犯"过度拆分"的错误——把每个小计算都抽成独立的类，结果一个模块有 30 多个 Engine/Calculator。我的建议是遵循"同一变化原因"原则：如果几个计算总是一起修改（比如折扣计算和满减计算），就放在同一个类里；如果它们的变化原因不同（比如价格计算和库存分配），就分开。不要为了"纯粹"而拆分，要为了"可维护"而拆分。

### 踩坑 4：Result 模式 vs 异常的选择

业务校验失败是"预期的结果"，应该用 Result 模式在 Core 层处理。数据库连接失败、外部 API 超时才是"异常情况"，应该在 Shell 层用异常处理。不要在 Core 层抛异常，因为异常会破坏纯函数的确定性——调用者无法通过函数签名知道它会抛什么异常，但 Result 类型明确地告诉调用者"这个函数可能失败"。

### 踩坑 5：与 Laravel 特性的兼容性

Laravel 的 Model Events、Observer、SoftDeletes 等特性本质上都是副作用。在 Shell 层中使用这些特性是完全可以的，因为 Shell 层本身就是处理副作用的。关键约束是：**Core 层不应该引入任何 `Illuminate\*` 命名空间的依赖。** 如果你发现一个 Core 类 import 了 Laravel 的 Facade 或 Service，那就是架构违反的信号，需要重构。

### 踩坑 6：测试策略的分层

Core 层和 Shell 层的测试策略完全不同。Core 层的测试继承自 `PHPUnit\Framework\TestCase`，不需要 Laravel 的测试基础设施，运行速度极快。Shell 层的测试继承自 `Illuminate\Foundation\Testing\TestCase`，使用 `RefreshDatabase` trait，需要数据库和完整的 Laravel 应用环境。这种分层测试策略的好处是：大多数业务逻辑变更只需要运行 Core 层的快速测试，只有涉及数据库操作或外部集成的变更才需要运行较慢的 Shell 层测试。

---

## 九、FCIS 的适用场景与局限性

### 适用场景

FCIS 最适合以下场景：**复杂的价格计算**（折扣、满减、税费、运费等多维度计算）、**复杂的库存逻辑**（多仓库分配、预售、预留等）、**业务规则校验**（订单校验、权限判断、流程状态机）、**数据转换和报表**（数据聚合、格式转换、统计分析）。简单来说，任何"给定输入、计算输出"的场景都是 FCIS 的用武之地。

### 不太适用的场景

如果业务逻辑就是简单的增删改查，没必要引入 FCIS——纯粹的 CRUD 操作本身就很清晰，不需要额外的架构抽象。实时数据处理（WebSocket、SSE 等需要持续 IO 的场景）也不适合 FCIS。快速原型阶段同样不建议引入——过早优化架构会拖慢验证速度。

### 什么时候开始引入

我的经验法则是：**当一个 Service 方法超过 50 行，且同时包含计算逻辑和副作用时，就是引入 FCIS 的时机。** 不需要重构整个项目，从最复杂的那个方法开始，把它拆成"计算"和"编排"两部分，然后逐步推广。

---

## 十、总结

Functional Core Imperative Shell 不是一个银弹，但它确实是我在 Laravel 项目中使用过的、最有效地提升代码可测试性和可维护性的架构模式。回顾核心要点：

1. **Functional Core 负责计算**：纯函数、值对象、Result 模式，可 100% 单元测试覆盖，运行速度快到令人愉悦
2. **Imperative Shell 负责编排**：读取数据、调用 Core、写回数据、派发事件，可以自由使用 Laravel 的所有便利特性
3. **值对象是桥梁**：将 Eloquent Model 转为不可变值对象，作为 Core 的输入输出，确保 Core 不依赖任何框架组件
4. **Result 优于异常**：在 Core 中用 Result 处理业务失败，保留异常给 Shell 层的真正错误
5. **时间和随机性要注入**：不要在 Core 中直接调用 `now()` 或 `rand()`，让 Shell 层传入这些值
6. **不必追求完美**：从最复杂的计算逻辑开始拆分，逐步推广，不要试图一次性重构所有代码

如果你正在维护一个 Laravel 项目，且经常因为"顺手加了一行代码"而引发 Bug，不妨试试 FCIS。从一个计算最复杂的 Service 方法开始，把它拆成"计算"和"编排"两部分。你可能会惊讶地发现：原来业务逻辑可以这么容易测试，原来代码可以这么清晰地表达意图。

---

> **参考资源**：
> - Gary Bernhardt, "Boundaries" (2012): https://www.destroyallsoftware.com/talks/boundaries
> - Mark Seemann, "Functional Architecture with F#": https://blog.ploeh.dk/
> - Scott Wlaschin, "Domain Modeling Made Functional": https://fsharpforfunandprofit.com/

---

## 相关阅读

- [六边形架构实战：Laravel 中的端口与适配器模式落地踩坑记录](/2026/06/01/六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/) —— 同为架构隔离思想，六边形架构通过 Port/Adapter 实现依赖反转，与 FCIS 的 Core/Shell 两层划分互补参考
- [PHP 8.5 Pipe Operator 实战：链式数据处理管道——告别嵌套回调的函数式编程新范式](/2026/06/04/PHP-8.5-Pipe-Operator-实战-链式数据处理管道-告别嵌套回调的函数式编程新范式/) —— 函数式编程在 PHP 中的另一项实践，Pipe Operator 与 FCIS 的纯函数组合理念一脉相承
- [Event Notification vs Event-Carried State Transfer 实战：Laravel 事件驱动的两种模式](/2026/06/06/event-notification-vs-event-carried-state-transfer/) —— FCIS 中 Shell 层事件派发的设计选择，深入对比两种事件驱动模式的解耦程度与数据传递策略
