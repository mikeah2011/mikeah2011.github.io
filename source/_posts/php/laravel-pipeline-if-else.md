---

title: Laravel 12.x Pipeline 实战：复杂业务流程编排与条件分支——从 if-else 地狱到管道模式的重构之路
keywords: [Laravel, Pipeline, if, else, 复杂业务流程编排与条件分支, 地狱到管道模式的重构之路]
date: 2026-06-02 10:00:00
tags:
- Laravel
- Pipeline
- 设计模式
- 重构
- PHP
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: Laravel 12.x Pipeline 模式深度实战：从 if-else 地狱到优雅管道的重构之路。详解 Pipeline 核心原理、条件分支处理、错误策略设计、DTO 数据传递等关键技巧，附带订单处理、支付流程等真实业务场景代码，对比传统写法与 Pipeline 写法的可读性、可测试性、可维护性差异，助你掌握 Laravel 最强大的业务流程编排工具。
---




## 引言：if-else 地狱的真实场景

在 Laravel 项目的开发过程中，你一定见过这样的代码：

```php
public function placeOrder(Request $request)
{
    // 验证用户
    if (!$request->user()) {
        return response()->json(['error' => '未登录'], 401);
    }
    
    if (!$request->user()->is_active) {
        return response()->json(['error' => '账户已禁用'], 403);
    }
    
    if (!$request->user()->hasVerifiedEmail()) {
        return response()->json(['error' => '邮箱未验证'], 403);
    }
    
    // 验证库存
    foreach ($request->items as $item) {
        $product = Product::find($item['product_id']);
        if (!$product) {
            return response()->json(['error' => '商品不存在'], 404);
        }
        if ($product->stock < $item['quantity']) {
            return response()->json(['error' => '库存不足'], 422);
        }
    }
    
    // 验证优惠券
    $discount = 0;
    if ($request->coupon_code) {
        $coupon = Coupon::where('code', $request->coupon_code)->first();
        if (!$coupon) {
            return response()->json(['error' => '优惠券不存在'], 404);
        }
        if ($coupon->is_expired) {
            return response()->json(['error' => '优惠券已过期'], 422);
        }
        if ($coupon->min_amount && $this->calculateSubtotal($request) < $coupon->min_amount) {
            return response()->json(['error' => '未达到最低消费'], 422);
        }
        $discount = $coupon->discount;
    }
    
    // 计算价格
    $subtotal = $this->calculateSubtotal($request);
    $shipping = $this->calculateShipping($request);
    $total = $subtotal - $discount + $shipping;
    
    // 处理支付
    if ($request->payment_method === 'credit_card') {
        $paymentResult = $this->processCreditCard($request, $total);
    } elseif ($request->payment_method === 'alipay') {
        $paymentResult = $this->processAlipay($request, $total);
    } elseif ($request->payment_method === 'wechat') {
        $paymentResult = $this->processWechat($request, $total);
    } else {
        return response()->json(['error' => '不支持的支付方式'], 422);
    }
    
    if (!$paymentResult->success) {
        return response()->json(['error' => '支付失败: ' . $paymentResult->message], 422);
    }
    
    // 创建订单
    $order = Order::create([...]);
    
    // 扣减库存
    foreach ($request->items as $item) {
        Product::find($item['product_id'])->decrement('stock', $item['quantity']);
    }
    
    // 发送通知
    $request->user()->notify(new OrderCreated($order));
    
    return new OrderResource($order);
}
```

这段代码有 60+ 行，包含了 10+ 个 if-else 分支。它的问题显而易见：

1. **可读性差**：需要从头读到尾才能理解整个流程
2. **难以测试**：测试「库存不足」的场景需要 mock 前面所有的验证步骤
3. **难以修改**：增加一个新的验证步骤需要在正确的位置插入代码
4. **职责混乱**：验证、计算、业务逻辑、通知混在一起
5. **重复代码**：类似的 if-else 模式在其他方法中重复出现

这就是「if-else 地狱」——当业务逻辑变得复杂时，嵌套的条件判断让代码变成一团乱麻。

Laravel 的 Pipeline 组件提供了一个优雅的解决方案：**将复杂的业务流程分解为一系列独立的步骤，通过管道串联执行**。每个步骤只负责一件事，可以独立测试、独立修改、独立组合。

## 二、Pipeline 模式原理

### 2.1 管道与过滤器模式

Pipeline（管道）模式源自 Unix 的管道概念：`ls | grep ".php" | wc -l`。每个命令只做一件事，通过管道将输出传递给下一个命令。

在软件设计中，Pipeline 模式将一个复杂的处理过程分解为一系列独立的处理步骤（也叫「过滤器」或「阶段」），数据沿着管道依次流过每个步骤，每个步骤对数据进行处理后传递给下一个步骤。

```
输入 → [验证用户] → [检查库存] → [应用优惠] → [计算价格] → [处理支付] → [创建订单] → 输出
```

### 2.2 责任链模式

Pipeline 模式与责任链模式（Chain of Responsibility）有相似之处，但有一个关键区别：

- **责任链**：每个处理者决定是否继续传递（可以中断）
- **Pipeline**：所有处理者依次执行（除非显式中断）

Laravel 的 Pipeline 结合了两者的优点：默认依次执行所有步骤，但可以通过 `stopOnFailure()` 或抛出异常来中断。

### 2.3 Laravel Pipeline 组件

Laravel 的 Pipeline 组件位于 `Illuminate\Pipeline\Pipeline`，核心接口非常简洁：

```php
$pipeline = app(Pipeline::class)
    ->send($payload)           // 设置输入
    ->through($pipes)          // 设置管道（处理步骤）
    ->thenReturn();            // 执行并返回结果
```

## 三、Laravel Pipeline 源码剖析

### 3.1 核心类

```php
namespace Illuminate\Pipeline;

class Pipeline
{
    protected $passable;    // 传递的数据
    protected $pipes = [];  // 管道（处理步骤）
    protected $method = 'handle';  // 调用的方法名

    public function send($passable)
    {
        $this->passable = $passable;
        return $this;
    }

    public function through($pipes)
    {
        $this->pipes = is_array($pipes) ? $pipes : func_get_args();
        return $this;
    }

    public function then(Closure $destination)
    {
        $pipeline = array_reduce(
            array_reverse($this->pipes),
            $this->carry(),
            $this->prepareDestination($destination)
        );

        return $pipeline($this->passable);
    }

    protected function carry()
    {
        return function ($stack, $pipe) {
            return function ($passable) use ($stack, $pipe) {
                // 如果是闭包，直接调用
                if (is_callable($pipe)) {
                    return $pipe($passable, $stack);
                }

                // 如果是类，解析并调用 handle 方法
                $name = is_string($pipe) ? $pipe : get_class($pipe);
                $parameters = [$passable, $stack];

                return method_exists($pipe, $this->method)
                    ? $pipe->{$this->method}(...$parameters)
                    : $pipe(...$parameters);
            };
        };
    }
}
```

核心逻辑只有 `array_reduce` 一行：从最后一个管道开始，将每个管道包装为一个闭包，形成嵌套的调用链。执行时从最外层开始，依次调用每个管道。

### 3.2 执行流程

```php
// 假设管道是 [A, B, C]
$pipeline = app(Pipeline::class)
    ->send($data)
    ->through([PipeA::class, PipeB::class, PipeC::class])
    ->thenReturn();

// array_reduce 的过程：
// 1. 初始: $stack = destination
// 2. 处理 C: $stack = function($passable) { return C::handle($passable, destination($passable)); }
// 3. 处理 B: $stack = function($passable) { return B::handle($passable, C的闭包); }
// 4. 处理 A: $stack = function($passable) { return A::handle($passable, B的闭包); }

// 执行时：
// A::handle($data, B的闭包)
//   → B::handle($data, C的闭包)
//     → C::handle($data, destination)
//       → destination($data)
```

## 四、实战：将嵌套 if-else 重构为 Pipeline

### 4.1 定义数据传输对象

首先，创建一个 DTO 来承载管道中的数据：

```php
<?php

namespace App\DTOs\Order;

use App\Models\User;

class OrderContext
{
    public ?User $user = null;
    public array $items = [];
    public ?string $couponCode = null;
    public ?object $coupon = null;
    public int $subtotal = 0;
    public int $discount = 0;
    public int $shipping = 0;
    public int $total = 0;
    public string $paymentMethod = '';
    public ?object $paymentResult = null;
    public ?object $order = null;
    public array $errors = [];

    public function __construct(
        public readonly array $requestData,
    ) {
        $this->items = $requestData['items'] ?? [];
        $this->couponCode = $requestData['coupon_code'] ?? null;
        $this->paymentMethod = $requestData['payment_method'] ?? '';
    }

    public function hasError(): bool
    {
        return !empty($this->errors);
    }

    public function addError(string $message): void
    {
        $this->errors[] = $message;
    }
}
```

### 4.2 定义管道步骤

每个步骤是一个独立的类，实现 `handle` 方法：

```php
<?php

namespace App\Pipelines\Order;

use App\DTOs\Order\OrderContext;
use Closure;

class ValidateUser
{
    public function handle(OrderContext $context, Closure $next)
    {
        $user = $context->requestData['user'];
        
        if (!$user) {
            $context->addError('未登录');
            return response()->json(['error' => '未登录'], 401);
        }
        
        if (!$user->is_active) {
            $context->addError('账户已禁用');
            return response()->json(['error' => '账户已禁用'], 403);
        }
        
        if (!$user->hasVerifiedEmail()) {
            $context->addError('邮箱未验证');
            return response()->json(['error' => '邮箱未验证'], 403);
        }
        
        $context->user = $user;
        
        return $next($context);
    }
}

<?php

namespace App\Pipelines\Order;

use App\DTOs\Order\OrderContext;
use App\Models\Product;
use Closure;

class ValidateStock
{
    public function handle(OrderContext $context, Closure $next)
    {
        foreach ($context->items as $item) {
            $product = Product::find($item['product_id']);
            
            if (!$product) {
                $context->addError("商品 {$item['product_id']} 不存在");
                return response()->json(['error' => '商品不存在'], 404);
            }
            
            if ($product->stock < $item['quantity']) {
                $context->addError("商品 {$product->name} 库存不足");
                return response()->json(['error' => '库存不足'], 422);
            }
            
            // 将商品信息保存到上下文
            $item['product'] = $product;
            $context->items[] = $item;
        }
        
        return $next($context);
    }
}

<?php

namespace App\Pipelines\Order;

use App\DTOs\Order\OrderContext;
use App\Models\Coupon;
use Closure;

class ApplyCoupon
{
    public function handle(OrderContext $context, Closure $next)
    {
        if (empty($context->couponCode)) {
            return $next($context);
        }
        
        $coupon = Coupon::where('code', $context->couponCode)->first();
        
        if (!$coupon) {
            $context->addError('优惠券不存在');
            return response()->json(['error' => '优惠券不存在'], 404);
        }
        
        if ($coupon->is_expired) {
            $context->addError('优惠券已过期');
            return response()->json(['error' => '优惠券已过期'], 422);
        }
        
        if ($coupon->min_amount && $context->subtotal < $coupon->min_amount) {
            $context->addError('未达到最低消费');
            return response()->json(['error' => '未达到最低消费'], 422);
        }
        
        $context->coupon = $coupon;
        $context->discount = $coupon->discount;
        
        return $next($context);
    }
}

<?php

namespace App\Pipelines\Order;

use App\DTOs\Order\OrderContext;
use Closure;

class CalculatePrice
{
    public function handle(OrderContext $context, Closure $next)
    {
        // 计算小计
        $context->subtotal = collect($context->items)->sum(
            fn ($item) => $item['product']->price * $item['quantity']
        );
        
        // 计算运费
        $context->shipping = $this->calculateShipping($context);
        
        // 计算总价
        $context->total = $context->subtotal - $context->discount + $context->shipping;
        
        return $next($context);
    }
    
    private function calculateShipping(OrderContext $context): int
    {
        // 运费计算逻辑
        if ($context->subtotal >= 20000) {
            return 0;  // 满 200 包邮
        }
        return 1000;  // 默认运费 10 元
    }
}

<?php

namespace App\Pipelines\Order;

use App\DTOs\Order\OrderContext;
use Closure;

class ProcessPayment
{
    public function handle(OrderContext $context, Closure $next)
    {
        $paymentMethod = $context->paymentMethod;
        
        $processor = match ($paymentMethod) {
            'credit_card' => new CreditCardProcessor(),
            'alipay' => new AlipayProcessor(),
            'wechat' => new WechatPayProcessor(),
            default => null,
        };
        
        if (!$processor) {
            $context->addError('不支持的支付方式');
            return response()->json(['error' => '不支持的支付方式'], 422);
        }
        
        $result = $processor->charge($context->total, $context->requestData);
        
        if (!$result->success) {
            $context->addError('支付失败: ' . $result->message);
            return response()->json(['error' => '支付失败'], 422);
        }
        
        $context->paymentResult = $result;
        
        return $next($context);
    }
}

<?php

namespace App\Pipelines\Order;

use App\DTOs\Order\OrderContext;
use App\Models\Order;
use Closure;

class CreateOrderRecord
{
    public function handle(OrderContext $context, Closure $next)
    {
        $order = Order::create([
            'user_id' => $context->user->id,
            'subtotal' => $context->subtotal,
            'discount' => $context->discount,
            'shipping' => $context->shipping,
            'total' => $context->total,
            'payment_method' => $context->paymentMethod,
            'payment_id' => $context->paymentResult->transactionId,
            'status' => 'paid',
        ]);
        
        // 创建订单项
        foreach ($context->items as $item) {
            $order->items()->create([
                'product_id' => $item['product_id'],
                'quantity' => $item['quantity'],
                'price' => $item['product']->price,
            ]);
        }
        
        $context->order = $order;
        
        return $next($context);
    }
}

<?php

namespace App\Pipelines\Order;

use App\DTOs\Order\OrderContext;
use Closure;

class DeductStock
{
    public function handle(OrderContext $context, Closure $next)
    {
        foreach ($context->items as $item) {
            $item['product']->decrement('stock', $item['quantity']);
        }
        
        return $next($context);
    }
}

<?php

namespace App\Pipelines\Order;

use App\DTOs\Order\OrderContext;
use App\Notifications\OrderCreated;
use Closure;

class SendNotification
{
    public function handle(OrderContext $context, Closure $next)
    {
        $context->user->notify(new OrderCreated($context->order));
        
        return $next($context);
    }
}
```

### 4.3 组装 Pipeline

在 Controller 中组装和执行 Pipeline：

```php
<?php

namespace App\Http\Controllers;

use App\DTOs\Order\OrderContext;
use App\Http\Requests\PlaceOrderRequest;
use App\Pipelines\Order\ApplyCoupon;
use App\Pipelines\Order\CalculatePrice;
use App\Pipelines\Order\CreateOrderRecord;
use App\Pipelines\Order\DeductStock;
use App\Pipelines\Order\ProcessPayment;
use App\Pipelines\Order\SendNotification;
use App\Pipelines\Order\ValidateStock;
use App\Pipelines\Order\ValidateUser;
use Illuminate\Pipeline\Pipeline;

class OrderController extends Controller
{
    public function store(PlaceOrderRequest $request)
    {
        $context = new OrderContext($request->validated());
        $context->requestData['user'] = $request->user();
        
        $result = app(Pipeline::class)
            ->send($context)
            ->through([
                ValidateUser::class,
                ValidateStock::class,
                ApplyCoupon::class,
                CalculatePrice::class,
                ProcessPayment::class,
                CreateOrderRecord::class,
                DeductStock::class,
                SendNotification::class,
            ])
            ->thenReturn();
        
        // 如果管道中某一步返回了 Response（错误情况）
        if ($result instanceof \Symfony\Component\HttpFoundation\Response) {
            return $result;
        }
        
        return new OrderResource($result->order);
    }
}
```

### 4.4 重构前后的对比

| 方面 | 重构前（if-else） | 重构后（Pipeline） |
|------|-------------------|-------------------|
| 代码行数 | 60+ 行在一个方法中 | 8 个独立的类，每个 20-30 行 |
| 可读性 | 需要从头读到尾 | 每个步骤独立可读 |
| 可测试性 | 难以单独测试某个步骤 | 每个步骤独立测试 |
| 可修改性 | 修改需要找到正确位置 | 直接修改对应的类 |
| 可复用性 | 代码难以复用 | 步骤可以在其他管道中复用 |
| 新增功能 | 在正确位置插入 if-else | 添加新的管道步骤 |

## 五、条件分支：通过闭包和 when() 实现动态管道

### 5.1 动态管道

有时候我们需要根据条件决定是否执行某个步骤：

```php
$pipes = [
    ValidateUser::class,
    ValidateStock::class,
];

// VIP 用户不需要验证邮箱
if (!$user->is_vip) {
    $pipes[] = ValidateEmail::class;
}

// 有优惠券时才执行优惠券验证
if ($context->couponCode) {
    $pipes[] = ApplyCoupon::class;
}

$pipes[] = CalculatePrice::class;
$pipes[] = ProcessPayment::class;

$result = app(Pipeline::class)
    ->send($context)
    ->through($pipes)
    ->thenReturn();
```

### 5.2 使用闭包作为管道

对于简单的逻辑，可以使用闭包而不是创建类：

```php
$pipes = [
    // 类管道
    ValidateUser::class,
    ValidateStock::class,
    
    // 闭包管道
    function (OrderContext $context, Closure $next) {
        // 额外的验证逻辑
        if ($context->total > 100000) {
            // 大额订单需要额外验证
            if (!$context->user->is_verified) {
                return response()->json(['error' => '大额订单需要实名认证'], 422);
            }
        }
        return $next($context);
    },
    
    // 继续类管道
    ProcessPayment::class,
];
```

### 5.3 条件性执行

在管道步骤内部实现条件逻辑：

```php
class ConditionalValidation
{
    public function handle(OrderContext $context, Closure $next)
    {
        // 条件执行：只在特定条件下执行某些逻辑
        if ($context->paymentMethod === 'credit_card') {
            // 信用卡支付需要额外验证
            $this->validateCreditCard($context);
        }
        
        if ($context->total > 50000) {
            // 大额订单需要人工审核
            $this->requireManualReview($context);
        }
        
        return $next($context);
    }
}
```

## 六、短路与中断：stopOnFailure() 与异常处理

### 6.1 stopOnFailure()

默认情况下，即使某个管道步骤失败，后续步骤仍会执行。使用 `stopOnFailure()` 可以在失败时中断：

```php
$result = app(Pipeline::class)
    ->send($context)
    ->through([
        ValidateUser::class,
        ValidateStock::class,
        ApplyCoupon::class,
        ProcessPayment::class,
    ])
    ->stopOnFailure()  // 任何一步失败就中断
    ->thenReturn();
```

### 6.2 通过返回值中断

在管道步骤中返回非 `$next($context)` 的值即可中断：

```php
class ValidateUser
{
    public function handle(OrderContext $context, Closure $next)
    {
        if (!$context->user) {
            // 返回 Response 中断管道
            return response()->json(['error' => '未登录'], 401);
        }
        
        // 继续执行
        return $next($context);
    }
}
```

### 6.3 通过异常中断

抛出异常也是一种中断方式，可以在全局异常处理器中统一处理：

```php
class ValidateStock
{
    public function handle(OrderContext $context, Closure $next)
    {
        foreach ($context->items as $item) {
            if ($item['product']->stock < $item['quantity']) {
                throw new InsufficientStockException($item['product']->name);
            }
        }
        
        return $next($context);
    }
}

// 异常处理器
class Handler extends ExceptionHandler
{
    public function register(): void
    {
        $this->renderable(function (InsufficientStockException $e) {
            return response()->json([
                'error' => '库存不足',
                'product' => $e->getProductName(),
            ], 422);
        });
    }
}
```

## 七、Pipeline 与 FormRequest、DTO 的配合

### 7.1 FormRequest 负责输入验证

```php
class PlaceOrderRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'payment_method' => 'required|in:credit_card,alipay,wechat',
            'coupon_code' => 'nullable|string|max:50',
        ];
    }
}
```

### 7.2 DTO 负责数据传输

```php
class OrderContext
{
    // ... 属性定义 ...
    
    public static function fromRequest(PlaceOrderRequest $request): self
    {
        $context = new self($request->validated());
        $context->user = $request->user();
        return $context;
    }
}
```

### 7.3 Pipeline 负责业务逻辑

```php
class OrderController extends Controller
{
    public function store(PlaceOrderRequest $request)
    {
        // FormRequest 已经完成了输入验证
        // DTO 将请求数据转换为上下文
        $context = OrderContext::fromRequest($request);
        
        // Pipeline 执行业务逻辑
        return app(Pipeline::class)
            ->send($context)
            ->through($this->getOrderPipes($context))
            ->thenReturn();
    }
    
    private function getOrderPipes(OrderContext $context): array
    {
        return [
            ValidateUser::class,
            ValidateStock::class,
            ApplyCoupon::class,
            CalculatePrice::class,
            ProcessPayment::class,
            CreateOrderRecord::class,
            DeductStock::class,
            SendNotification::class,
        ];
    }
}
```

## 八、实战：支付流程的多步骤编排

### 8.1 支付管道

```php
class PaymentPipeline
{
    public function process(Order $order, array $paymentData): PaymentResult
    {
        return app(Pipeline::class)
            ->send(new PaymentContext($order, $paymentData))
            ->through([
                ValidatePaymentData::class,      // 验证支付数据
                CheckPaymentLimits::class,        // 检查支付限额
                ApplyPaymentDiscounts::class,     // 应用支付优惠
                SelectPaymentChannel::class,      // 选择支付通道
                CreatePaymentRecord::class,       // 创建支付记录
                CallPaymentGateway::class,        // 调用支付网关
                HandlePaymentCallback::class,     // 处理支付回调
                UpdateOrderStatus::class,         // 更新订单状态
            ])
            ->thenReturn();
    }
}
```

### 8.2 支付通道选择

```php
class SelectPaymentChannel
{
    private array $channels = [
        'credit_card' => CreditCardChannel::class,
        'alipay' => AlipayChannel::class,
        'wechat' => WechatChannel::class,
        'paypal' => PaypalChannel::class,
    ];

    public function handle(PaymentContext $context, Closure $next)
    {
        $channelClass = $this->channels[$context->paymentMethod] ?? null;
        
        if (!$channelClass) {
            throw new UnsupportedPaymentMethodException($context->paymentMethod);
        }
        
        $context->channel = app($channelClass);
        
        // 根据通道特性调整后续流程
        if ($context->channel->requiresRedirect()) {
            $context->needsRedirect = true;
        }
        
        return $next($context);
    }
}
```

## 九、实战：用户注册流程的条件分支

### 9.1 注册管道

```php
class RegistrationPipeline
{
    public function register(array $data): User
    {
        $context = new RegistrationContext($data);
        
        return app(Pipeline::class)
            ->send($context)
            ->through($this->getPipes($context))
            ->thenReturn();
    }
    
    private function getPipes(RegistrationContext $context): array
    {
        $pipes = [
            ValidateRegistrationData::class,
            CheckDuplicateEmail::class,
            CreateUserRecord::class,
            AssignDefaultRole::class,
        ];
        
        // 根据注册方式添加不同的管道
        if ($context->isEmailRegistration()) {
            $pipes[] = SendVerificationEmail::class;
        }
        
        if ($context->isPhoneRegistration()) {
            $pipes[] = SendVerificationSMS::class;
        }
        
        if ($context->hasReferralCode()) {
            $pipes[] = ApplyReferralBonus::class;
        }
        
        // 所有注册都需要
        $pipes[] = SendWelcomeNotification::class;
        $pipes[] = LogRegistrationEvent::class;
        
        return $pipes;
    }
}
```

### 9.2 条件管道示例

```php
class ApplyReferralBonus
{
    public function handle(RegistrationContext $context, Closure $next)
    {
        $referral = ReferralCode::where('code', $context->referralCode)->first();
        
        if (!$referral) {
            // 无效的推荐码不中断注册，只是跳过
            return $next($context);
        }
        
        // 给新用户添加积分
        $context->user->points()->create([
            'amount' => 100,
            'reason' => 'referral_bonus',
        ]);
        
        // 给推荐人添加积分
        $referral->user->points()->create([
            'amount' => 50,
            'reason' => 'referral_reward',
        ]);
        
        return $next($context);
    }
}
```

## 十、测试策略：Pipeline 各阶段的单元测试

### 10.1 测试单个管道步骤

```php
<?php

namespace Tests\Unit\Pipelines;

use App\DTOs\Order\OrderContext;
use App\Models\User;
use App\Pipelines\Order\ValidateUser;
use Tests\TestCase;

class ValidateUserTest extends TestCase
{
    private ValidateUser $pipe;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pipe = new ValidateUser();
    }

    public function test_passes_with_valid_user(): void
    {
        $user = User::factory()->create(['is_active' => true]);
        $context = new OrderContext([]);
        $context->requestData['user'] = $user;
        
        $nextCalled = false;
        $next = function ($ctx) use (&$nextCalled) {
            $nextCalled = true;
            return $ctx;
        };
        
        $result = $this->pipe->handle($context, $next);
        
        $this->assertTrue($nextCalled);
        $this->assertEquals($user, $context->user);
    }

    public function test_returns_401_when_not_logged_in(): void
    {
        $context = new OrderContext([]);
        $context->requestData['user'] = null;
        
        $result = $this->pipe->handle($context, fn ($ctx) => $ctx);
        
        $this->assertInstanceOf(\Illuminate\Http\JsonResponse::class, $result);
        $this->assertEquals(401, $result->getStatusCode());
    }

    public function test_returns_403_when_account_disabled(): void
    {
        $user = User::factory()->create(['is_active' => false]);
        $context = new OrderContext([]);
        $context->requestData['user'] = $user;
        
        $result = $this->pipe->handle($context, fn ($ctx) => $ctx);
        
        $this->assertInstanceOf(\Illuminate\Http\JsonResponse::class, $result);
        $this->assertEquals(403, $result->getStatusCode());
    }
}
```

### 10.2 测试整个 Pipeline

```php
<?php

namespace Tests\Feature\Pipelines;

use App\DTOs\Order\OrderContext;
use Tests\TestCase;

class OrderPipelineTest extends TestCase
{
    public function test_full_order_pipeline(): void
    {
        $user = User::factory()->create();
        $product = Product::factory()->create(['stock' => 10, 'price' => 1000]);
        
        $context = new OrderContext([
            'user' => $user,
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
            'payment_method' => 'credit_card',
        ]);
        
        $result = app(Pipeline::class)
            ->send($context)
            ->through([
                ValidateUser::class,
                ValidateStock::class,
                CalculatePrice::class,
                // 使用 Mock 替代真实支付
                MockPaymentSuccess::class,
                CreateOrderRecord::class,
            ])
            ->thenReturn();
        
        $this->assertNotNull($result->order);
        $this->assertEquals('paid', $result->order->status);
        $this->assertEquals(2000, $result->order->total);
    }
}
```

### 10.3 测试优势

| 方面 | if-else | Pipeline |
|------|---------|----------|
| 测试范围 | 一个方法包含所有逻辑 | 每个步骤独立测试 |
| Mock 复杂度 | 需要 mock 所有依赖 | 只 mock 当前步骤的依赖 |
| 测试速度 | 慢 | 快 |
| 测试覆盖 | 难以覆盖所有分支 | 每个步骤的每个分支都可测试 |

## 十一、性能考量

### 11.1 Pipeline 的开销

Pipeline 模式引入了一些额外的开销：

1. **对象创建**：每个管道步骤需要实例化一个类
2. **闭包嵌套**：`array_reduce` 创建嵌套闭包
3. **方法调用**：每个步骤需要调用 `handle` 方法

在大多数场景下，这些开销可以忽略不计。但在极端性能敏感的场景（每秒处理数千请求），需要考虑优化。

### 11.2 优化策略

```php
// 1. 使用单例减少对象创建
$this->app->singleton(ValidateUser::class);

// 2. 使用闭包替代简单类
$pipes = [
    function (OrderContext $context, Closure $next) {
        // 简单逻辑用闭包
        if (!$context->user) {
            return response()->json(['error' => '未登录'], 401);
        }
        return $next($context);
    },
];

// 3. 缓存管道配置
class OrderPipelineCache
{
    private static ?array $cachedPipes = null;
    
    public static function getPipes(): array
    {
        return self::$cachedPipes ??= [
            ValidateUser::class,
            ValidateStock::class,
            // ...
        ];
    }
}
```

## 十二、与 Action Pattern 的结合

Pipeline 和 Action Pattern 可以完美结合：

```php
// Pipeline 负责流程编排
class CreateOrderPipeline
{
    public function execute(OrderContext $context): OrderContext
    {
        return app(Pipeline::class)
            ->send($context)
            ->through([
                ValidateOrderAction::class,    // Action 作为管道步骤
                CalculatePriceAction::class,
                ProcessPaymentAction::class,
                PersistOrderAction::class,
            ])
            ->thenReturn();
    }
}

// Action 负责具体业务逻辑
class ValidateOrderAction
{
    public function handle(OrderContext $context, Closure $next)
    {
        // 调用更细粒度的 Action
        app(ValidateUserAction::class)->execute($context->user);
        app(ValidateStockAction::class)->execute($context->items);
        
        return $next($context);
    }
}
```

## 十三、踩坑记录与最佳实践

### 13.1 踩坑一：管道步骤的顺序很重要

**问题**：错误地将计算价格放在验证库存之前，导致计算了无效订单的价格。

**教训**：管道步骤的顺序应该遵循业务逻辑的依赖关系。验证 → 计算 → 执行 → 通知。

### 13.2 踩坑二：管道步骤之间的隐式依赖

**问题**：步骤 B 依赖步骤 A 设置的上下文属性，但没有明确的契约。

**解决方案**：使用 DTO 的类型提示明确每个步骤需要的输入和输出：

```php
class OrderContext
{
    // 步骤输入（可选）
    public ?User $user = null;
    
    // 步骤输出（必填，由特定步骤设置）
    public int $subtotal = 0;  // 由 CalculatePrice 设置
    public ?Order $order = null;  // 由 CreateOrderRecord 设置
}
```

### 13.3 踩坑三：异常处理不一致

**问题**：有的步骤返回 Response，有的抛异常，有的设置错误到上下文。

**解决方案**：统一错误处理策略：

```php
// 方案一：统一使用异常
class ValidateStock
{
    public function handle(OrderContext $context, Closure $next)
    {
        if ($this->hasInsufficientStock($context)) {
            throw new OrderValidationException('库存不足');
        }
        return $next($context);
    }
}

// 方案二：统一使用上下文错误
class ValidateStock
{
    public function handle(OrderContext $context, Closure $next)
    {
        if ($this->hasInsufficientStock($context)) {
            $context->addError('库存不足');
            return $context;  // 中断管道
        }
        return $next($context);
    }
}
```

### 13.4 最佳实践

1. **每个步骤只做一件事**：保持步骤的单一职责
2. **使用 DTO 承载数据**：不要在步骤之间传递裸数组
3. **明确步骤顺序**：验证 → 计算 → 执行 → 通知
4. **统一错误处理**：选择一种错误处理策略并坚持使用
5. **保持步骤无状态**：步骤不应该持有状态，所有状态都在 DTO 中
6. **编写独立测试**：每个步骤都应该有独立的单元测试
7. **使用闭包处理简单逻辑**：不需要为每个小逻辑创建类

## 总结

Laravel Pipeline 是处理复杂业务流程的强大工具。它将 if-else 地狱转化为清晰、可测试、可维护的管道结构。

核心价值：

1. **可读性**：流程一目了然，每个步骤独立可读
2. **可测试性**：每个步骤独立测试，Mock 简单
3. **可维护性**：修改某个步骤不影响其他步骤
4. **可复用性**：步骤可以在不同的管道中复用
5. **可扩展性**：添加新步骤只需要添加一个类

从 if-else 地狱到 Pipeline 的重构，不仅仅是代码结构的变化，更是思维方式的转变：从「一次性写完所有逻辑」到「将逻辑分解为独立的步骤」。这种思维方式让代码更加清晰、更加健壮、更加易于维护。

下次当你面对一个充满 if-else 的复杂业务逻辑时，试试 Laravel Pipeline 吧。


## 相关阅读

- [Laravel Action Pattern 实战：用单一职责的 Action 类替代胖 Service](/categories/Laravel/PHP/Laravel-Action-Pattern-实战/)
- [Laravel Batch Job 实战：大数据量批量处理的内存治理、分块策略与进度追踪](/categories/Laravel/PHP/Laravel-Batch-Job-实战/)
- [Laravel 数据导入导出实战：Excel/CSV 大文件处理与队列化踩坑记录](/categories/Laravel/PHP/Laravel-数据导入导出实战-Excel-CSV-大文件处理与队列化踩坑记录/)
