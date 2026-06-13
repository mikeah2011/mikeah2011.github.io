---

title: Laravel Action Pattern 实战：用单一职责的 Action 类替代胖 Service 的大型项目重构经验
keywords: [Laravel Action Pattern, Action, Service, 用单一职责的, 类替代胖, 的大型项目重构经验]
date: 2026-06-02 10:00:00
tags:
- Laravel
- action-pattern
- 设计模式
- 重构
- PHP
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 大型 Laravel 项目中胖 Service 的终极解决方案——Action Pattern 实战详解。从 OrderService 上帝类的痛点出发，逐步演示如何将每个业务操作封装为独立的 Action 类，配合 DTO 输入、构造函数注入、事件驱动解耦等最佳实践。附带 30+ 仓库重构经验、测试策略与重构检查清单，提升代码可维护性与团队协作效率。
---



## 引言：胖 Service 的痛点与 Action Pattern 的价值

在 Laravel 项目的演进过程中，一个常见的现象是 Service 类的膨胀。最初，我们创建一个 `OrderService` 来处理订单相关逻辑，它只有几个方法，代码清晰，职责明确。但随着业务的增长，这个 Service 越来越大：

```php
// 典型的胖 Service
class OrderService
{
    public function createOrder() { /* 100 行 */ }
    public function updateOrder() { /* 80 行 */ }
    public function cancelOrder() { /* 60 行 */ }
    public function refundOrder() { /* 120 行 */ }
    public function processPayment() { /* 90 行 */ }
    public function sendNotification() { /* 40 行 */ }
    public function updateInventory() { /* 50 行 */ }
    public function generateInvoice() { /* 70 行 */ }
    public function calculateShipping() { /* 60 行 */ }
    public function applyCoupon() { /* 80 行 */ }
    // ... 还有 20+ 个方法
}
```

这个 `OrderService` 已经变成了一个「上帝类」（God Class），它知道太多、做太多。当我们需要修改退款逻辑时，必须在 1000+ 行的文件中找到相关代码。当两个开发者同时修改不同方法时，冲突不可避免。当写测试时，需要 mock 大量依赖。

Action Pattern 提供了一个优雅的解决方案：**将每个业务操作封装为一个独立的 Action 类**。每个 Action 只做一件事，有明确的输入和输出，可以独立测试、独立修改、独立复用。

## 二、Action Pattern 核心概念

### 2.1 什么是 Action

Action 是一个单一职责的类，代表一个具体的业务操作。它的核心特征：

1. **单一职责**：每个 Action 只做一件事
2. **可调用**：通过 `__invoke` 方法或 `execute` 方法执行
3. **明确的输入输出**：接收参数对象（DTO），返回结果
4. **无状态**：Action 实例不持有状态，可以安全地作为单例使用

```php
// 一个典型的 Action
class CreateOrderAction
{
    public function __construct(
        private OrderRepository $orders,
        private InventoryService $inventory,
        private PaymentGateway $payment,
    ) {}

    public function execute(CreateOrderDTO $dto): Order
    {
        // 1. 验证库存
        $this->inventory->check($dto->items);
        
        // 2. 创建订单
        $order = $this->orders->create($dto->toArray());
        
        // 3. 扣减库存
        $this->inventory->deduct($dto->items);
        
        // 4. 触发事件
        OrderCreated::dispatch($order);
        
        return $order;
    }
}
```

### 2.2 Action vs Service vs Command vs Job

在 Laravel 生态中，有多种组织业务逻辑的方式。让我们对比它们的区别：

| 模式 | 职责 | 粒度 | 是否可队列化 | 适用场景 |
|------|------|------|-------------|----------|
| **Service** | 相关操作的集合 | 粗 | 否 | 一组相关的业务逻辑 |
| **Action** | 单一业务操作 | 细 | 否 | 单个业务操作 |
| **Command (Artisan)** | CLI 操作 | 中 | 否 | 命令行任务 |
| **Job (Queue)** | 异步任务 | 中 | 是 | 需要异步执行的操作 |
| **Controller** | HTTP 请求处理 | 中 | 否 | HTTP 层逻辑编排 |

Action 的独特价值在于它的**细粒度**和**可组合性**。一个 Controller 方法可以调用多个 Action，一个 Job 也可以调用 Action：

```php
// Controller 调用 Action
class OrderController extends Controller
{
    public function store(CreateOrderRequest $request, CreateOrderAction $action)
    {
        $order = $action->execute(CreateOrderDTO::from($request));
        return new OrderResource($order);
    }
}

// Job 调用 Action
class ProcessRefundJob implements ShouldQueue
{
    public function handle(RefundOrderAction $action)
    {
        $action->execute(new RefundDTO(
            orderId: $this->orderId,
            reason: $this->reason,
        ));
    }
}
```

### 2.3 Action 的命名规范

Action 的命名应该清晰地表达它做什么：

```php
// ✅ 好的命名：动词 + 名词
CreateOrderAction
RefundOrderAction
SendWelcomeEmailAction
UpdateUserProfileAction
CalculateShippingCostAction

// ❌ 不好的命名
OrderAction          // 太模糊，不知道做什么
OrderService         // Service 不是 Action
DoStuffAction        // 没有意义
```

## 三、Action 类的基本结构

### 3.1 标准 Action 结构

```php
<?php

namespace App\Actions\Order;

use App\DTOs\CreateOrderDTO;
use App\Events\OrderCreated;
use App\Exceptions\InsufficientStockException;
use App\Models\Order;
use App\Repositories\OrderRepository;
use App\Services\InventoryService;

class CreateOrderAction
{
    /**
     * 通过构造函数注入依赖
     * Laravel 会自动解析这些依赖
     */
    public function __construct(
        private OrderRepository $orders,
        private InventoryService $inventory,
    ) {}

    /**
     * 执行创建订单操作
     *
     * @throws InsufficientStockException
     */
    public function execute(CreateOrderDTO $dto): Order
    {
        // 1. 业务验证
        $this->validate($dto);
        
        // 2. 核心业务逻辑
        $order = $this->createOrder($dto);
        
        // 3. 副作用（事件、通知等）
        $this->dispatchEvents($order);
        
        return $order;
    }

    private function validate(CreateOrderDTO $dto): void
    {
        if (!$this->inventory->hasStock($dto->items)) {
            throw new InsufficientStockException();
        }
    }

    private function createOrder(CreateOrderDTO $dto): Order
    {
        return $this->orders->create([
            'user_id' => $dto->userId,
            'items' => $dto->items,
            'total' => $this->calculateTotal($dto),
            'status' => 'pending',
        ]);
    }

    private function calculateTotal(CreateOrderDTO $dto): int
    {
        return collect($dto->items)->sum(fn ($item) => 
            $item->price * $item->quantity
        );
    }

    private function dispatchEvents(Order $order): void
    {
        OrderCreated::dispatch($order);
    }
}
```

### 3.2 使用 DTO 作为输入

DTO（Data Transfer Object）为 Action 提供明确的输入契约：

```php
<?php

namespace App\DTOs;

use App\Http\Requests\CreateOrderRequest;

class CreateOrderDTO
{
    public function __construct(
        public readonly int $userId,
        public readonly array $items,
        public readonly ?string $couponCode = null,
        public readonly ?string $note = null,
    ) {}

    /**
     * 从 HTTP 请求创建 DTO
     */
    public static function from(CreateOrderRequest $request): self
    {
        return new self(
            userId: $request->user()->id,
            items: $request->validated('items'),
            couponCode: $request->validated('coupon_code'),
            note: $request->validated('note'),
        );
    }

    /**
     * 从数组创建 DTO（用于 API、队列等场景）
     */
    public static function fromArray(array $data): self
    {
        return new self(
            userId: $data['user_id'],
            items: $data['items'],
            couponCode: $data['coupon_code'] ?? null,
            note: $data['note'] ?? null,
        );
    }
}
```

### 3.3 使用 Enum 作为输出

对于需要返回多种结果的 Action，使用 Enum 作为返回类型：

```php
enum OrderResult
{
    case Success;
    case InsufficientStock;
    case PaymentFailed;
    case InvalidCoupon;
}

class PlaceOrderAction
{
    public function execute(CreateOrderDTO $dto): OrderResult
    {
        if (!$this->inventory->hasStock($dto->items)) {
            return OrderResult::InsufficientStock;
        }

        $paymentResult = $this->payment->charge($dto);
        if (!$paymentResult->success) {
            return OrderResult::PaymentFailed;
        }

        $this->createOrder($dto);
        return OrderResult::Success;
    }
}
```

## 四、实战：从胖 Service 重构到 Action

### 4.1 重构前的代码

让我们看一个真实的胖 Service 案例：

```php
<?php

namespace App\Services;

class OrderService
{
    public function __construct(
        private PaymentService $payment,
        private InventoryService $inventory,
        private NotificationService $notification,
        private ShippingService $shipping,
        private CouponService $coupon,
        private InvoiceService $invoice,
        private LogService $log,
    ) {}

    public function create(array $data): Order
    {
        // 验证库存
        foreach ($data['items'] as $item) {
            if (!$this->inventory->check($item['product_id'], $item['quantity'])) {
                throw new InsufficientStockException($item['product_id']);
            }
        }

        // 应用优惠券
        $discount = 0;
        if (!empty($data['coupon_code'])) {
            $coupon = $this->coupon->validate($data['coupon_code']);
            if (!$coupon) {
                throw new InvalidCouponException();
            }
            $discount = $this->coupon->calculate($coupon, $data['items']);
        }

        // 计算总价
        $subtotal = collect($data['items'])->sum(fn ($item) => $item['price'] * $item['quantity']);
        $total = $subtotal - $discount;

        // 创建订单
        $order = Order::create([
            'user_id' => $data['user_id'],
            'subtotal' => $subtotal,
            'discount' => $discount,
            'total' => $total,
            'status' => 'pending',
        ]);

        // 创建订单项
        foreach ($data['items'] as $item) {
            $order->items()->create($item);
        }

        // 扣减库存
        foreach ($data['items'] as $item) {
            $this->inventory->deduct($item['product_id'], $item['quantity']);
        }

        // 处理支付
        $paymentResult = $this->payment->charge($order);
        if (!$paymentResult->success) {
            $order->update(['status' => 'payment_failed']);
            throw new PaymentFailedException();
        }

        // 计算运费
        $shippingCost = $this->shipping->calculate($order);
        $order->update(['shipping_cost' => $shippingCost]);

        // 生成发票
        $this->invoice->generate($order);

        // 发送通知
        $this->notification->sendOrderConfirmation($order);

        // 记录日志
        $this->log->info('Order created', ['order_id' => $order->id]);

        return $order;
    }

    public function cancel(int $orderId, string $reason): Order
    {
        $order = Order::findOrFail($orderId);
        
        if (!$order->canCancel()) {
            throw new OrderCannotBeCancelledException();
        }

        // 退款
        if ($order->isPaid()) {
            $this->payment->refund($order);
        }

        // 恢复库存
        foreach ($order->items as $item) {
            $this->inventory->restore($item->product_id, $item->quantity);
        }

        // 更新状态
        $order->update([
            'status' => 'cancelled',
            'cancel_reason' => $reason,
        ]);

        // 发送通知
        $this->notification->sendCancellation($order);

        return $order;
    }

    public function refund(int $orderId, string $reason): Refund
    {
        $order = Order::findOrFail($orderId);
        
        if (!$order->canRefund()) {
            throw new OrderCannotBeRefundedException();
        }

        $refund = $this->payment->refund($order);

        // 恢复库存
        foreach ($order->items as $item) {
            $this->inventory->restore($item->product_id, $item->quantity);
        }

        // 更新状态
        $order->update(['status' => 'refunded']);

        // 发送通知
        $this->notification->sendRefundConfirmation($order, $refund);

        return $refund;
    }

    // ... 还有 15+ 个方法
}
```

这个 Service 有以下问题：

1. **职责过多**：一个类处理创建、取消、退款、发货等所有操作
2. **依赖过多**：构造函数注入了 7 个依赖
3. **难以测试**：测试 `create` 方法需要 mock 所有依赖
4. **频繁冲突**：多个开发者同时修改这个文件
5. **违反开闭原则**：每增加一个新功能都要修改这个类

### 4.2 重构步骤

**第一步：识别独立操作**

分析 Service 中的方法，识别出独立的业务操作：

| 原方法 | 独立操作 |
|--------|----------|
| `create()` | 创建订单、验证库存、应用优惠券、处理支付、生成发票、发送通知 |
| `cancel()` | 取消订单、退款、恢复库存、发送通知 |
| `refund()` | 退款、恢复库存、发送通知 |

**第二步：创建 Action 类**

```php
<?php
// app/Actions/Order/CreateOrderAction.php

namespace App\Actions\Order;

use App\DTOs\CreateOrderDTO;
use App\Models\Order;

class CreateOrderAction
{
    public function __construct(
        private ValidateStockAction $validateStock,
        private ApplyCouponAction $applyCoupon,
        private ProcessPaymentAction $processPayment,
        private CreateOrderRecordAction $createRecord,
        private DeductInventoryAction $deductInventory,
        private CalculateShippingAction $calculateShipping,
        private GenerateInvoiceAction $generateInvoice,
        private SendOrderConfirmationAction $sendConfirmation,
    ) {}

    public function execute(CreateOrderDTO $dto): Order
    {
        // 1. 验证库存
        $this->validateStock->execute($dto->items);
        
        // 2. 应用优惠券
        $discount = $this->applyCoupon->execute($dto->couponCode, $dto->items);
        
        // 3. 创建订单记录
        $order = $this->createRecord->execute($dto, $discount);
        
        // 4. 扣减库存
        $this->deductInventory->execute($dto->items);
        
        // 5. 处理支付
        $this->processPayment->execute($order);
        
        // 6. 计算运费
        $this->calculateShipping->execute($order);
        
        // 7. 生成发票
        $this->generateInvoice->execute($order);
        
        // 8. 发送确认通知
        $this->sendConfirmation->execute($order);
        
        return $order;
    }
}
```

**第三步：拆分子 Action**

```php
<?php
// app/Actions/Order/ValidateStockAction.php

namespace App\Actions\Order;

use App\Exceptions\InsufficientStockException;
use App\Services\InventoryService;

class ValidateStockAction
{
    public function __construct(
        private InventoryService $inventory,
    ) {}

    /**
     * @throws InsufficientStockException
     */
    public function execute(array $items): void
    {
        foreach ($items as $item) {
            if (!$this->inventory->check($item['product_id'], $item['quantity'])) {
                throw new InsufficientStockException($item['product_id']);
            }
        }
    }
}

<?php
// app/Actions/Order/ApplyCouponAction.php

namespace App\Actions\Order;

use App\Exceptions\InvalidCouponException;
use App\Services\CouponService;

class ApplyCouponAction
{
    public function __construct(
        private CouponService $coupon,
    ) {}

    public function execute(?string $couponCode, array $items): int
    {
        if (empty($couponCode)) {
            return 0;
        }

        $coupon = $this->coupon->validate($couponCode);
        if (!$coupon) {
            throw new InvalidCouponException();
        }

        return $this->coupon->calculate($coupon, $items);
    }
}

<?php
// app/Actions/Order/ProcessPaymentAction.php

namespace App\Actions\Order;

use App\Exceptions\PaymentFailedException;
use App\Models\Order;
use App\Services\PaymentService;

class ProcessPaymentAction
{
    public function __construct(
        private PaymentService $payment,
    ) {}

    /**
     * @throws PaymentFailedException
     */
    public function execute(Order $order): void
    {
        $result = $this->payment->charge($order);
        
        if (!$result->success) {
            $order->update(['status' => 'payment_failed']);
            throw new PaymentFailedException();
        }
    }
}
```

**第四步：更新 Controller**

```php
<?php

namespace App\Http\Controllers;

use App\Actions\Order\CreateOrderAction;
use App\DTOs\CreateOrderDTO;
use App\Http\Requests\CreateOrderRequest;

class OrderController extends Controller
{
    public function store(CreateOrderRequest $request, CreateOrderAction $action)
    {
        $dto = CreateOrderDTO::from($request);
        $order = $action->execute($dto);
        
        return new OrderResource($order);
    }
}
```

### 4.3 重构后的代码结构

```
app/
├── Actions/
│   └── Order/
│       ├── CreateOrderAction.php          # 编排层
│       ├── ValidateStockAction.php        # 子操作
│       ├── ApplyCouponAction.php          # 子操作
│       ├── ProcessPaymentAction.php       # 子操作
│       ├── DeductInventoryAction.php      # 子操作
│       ├── CalculateShippingAction.php    # 子操作
│       ├── GenerateInvoiceAction.php      # 子操作
│       ├── SendOrderConfirmationAction.php # 子操作
│       ├── CancelOrderAction.php          # 编排层
│       ├── RefundOrderAction.php          # 编排层
│       └── ...
├── DTOs/
│   └── Order/
│       ├── CreateOrderDTO.php
│       ├── CancelOrderDTO.php
│       └── ...
├── Enums/
│   └── OrderResult.php
└── ...
```

## 五、Action 的依赖注入与参数对象

### 5.1 依赖注入的最佳实践

Action 的依赖通过构造函数注入，Laravel 的服务容器会自动解析：

```php
class SendOrderConfirmationAction
{
    public function __construct(
        private EmailService $email,
        private SMSService $sms,
        private UserRepository $users,
        private NotificationPreferences $preferences,
    ) {}
}
```

对于可选依赖，使用默认值或 `?` 类型：

```php
class ExportOrdersAction
{
    public function __construct(
        private OrderRepository $orders,
        private ?ExportStorage $storage = null,  // 可选依赖
    ) {
        $this->storage = $storage ?? new LocalExportStorage();
    }
}
```

### 5.2 参数对象（DTO）设计

DTO 应该是不可变的，只包含 Action 需要的数据：

```php
class CreateOrderDTO
{
    public function __construct(
        public readonly int $userId,
        public readonly array $items,
        public readonly ?string $couponCode = null,
        public readonly ?string $note = null,
        public readonly ?string $shippingAddress = null,
    ) {}

    // 验证规则
    public static function rules(): array
    {
        return [
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'coupon_code' => 'nullable|string|max:50',
            'note' => 'nullable|string|max:500',
        ];
    }

    // 从请求创建
    public static function fromRequest(Request $request): self
    {
        return new self(
            userId: $request->user()->id,
            items: $request->validated('items'),
            couponCode: $request->validated('coupon_code'),
            note: $request->validated('note'),
        );
    }

    // 从数组创建（用于 API、队列等）
    public static function fromArray(array $data): self
    {
        return new self(
            userId: $data['user_id'],
            items: $data['items'],
            couponCode: $data['coupon_code'] ?? null,
            note: $data['note'] ?? null,
        );
    }
}
```

## 六、Action 的事务处理与事件触发

### 6.1 事务处理

当 Action 涉及多个数据库操作时，应该使用事务：

```php
class CreateOrderAction
{
    public function __construct(
        private DatabaseManager $db,
        private ValidateStockAction $validateStock,
        private CreateOrderRecordAction $createRecord,
        private DeductInventoryAction $deductInventory,
    ) {}

    public function execute(CreateOrderDTO $dto): Order
    {
        return $this->db->transaction(function () use ($dto) {
            // 验证库存（不涉及数据库写操作，可以放在事务外）
            $this->validateStock->execute($dto->items);
            
            // 创建订单记录
            $order = $this->createRecord->execute($dto);
            
            // 扣减库存
            $this->deductInventory->execute($dto->items);
            
            return $order;
        });
    }
}
```

### 6.2 事件触发

Action 完成后触发事件，让其他组件响应：

```php
class CreateOrderAction
{
    public function execute(CreateOrderDTO $dto): Order
    {
        // ... 创建订单逻辑 ...
        
        // 触发事件
        OrderCreated::dispatch($order, $dto);
        
        return $order;
    }
}

// 事件监听器处理副作用
class OrderCreatedListener
{
    public function handle(OrderCreated $event): void
    {
        // 发送确认邮件
        app(SendOrderConfirmationAction::class)->execute($event->order);
        
        // 生成发票
        app(GenerateInvoiceAction::class)->execute($event->order);
        
        // 记录日志
        app(LogOrderCreationAction::class)->execute($event->order);
    }
}
```

## 七、Action 的测试策略

### 7.1 单元测试

每个 Action 都应该有独立的单元测试：

```php
<?php

namespace Tests\Unit\Actions;

use App\Actions\Order\ValidateStockAction;
use App\Exceptions\InsufficientStockException;
use App\Services\InventoryService;
use Mockery;
use Tests\TestCase;

class ValidateStockActionTest extends TestCase
{
    private $inventory;
    private $action;

    protected function setUp(): void
    {
        parent::setUp();
        
        $this->inventory = Mockery::mock(InventoryService::class);
        $this->action = new ValidateStockAction($this->inventory);
    }

    public function test_throws_when_insufficient_stock(): void
    {
        $this->expectException(InsufficientStockException::class);

        $this->inventory
            ->shouldReceive('check')
            ->once()
            ->with(1, 5)
            ->andReturn(false);

        $this->action->execute([
            ['product_id' => 1, 'quantity' => 5],
        ]);
    }

    public function test_passes_when_sufficient_stock(): void
    {
        $this->inventory
            ->shouldReceive('check')
            ->once()
            ->with(1, 5)
            ->andReturn(true);

        $this->action->execute([
            ['product_id' => 1, 'quantity' => 5],
        ]);

        $this->assertTrue(true); // 没有抛异常就是成功
    }
}
```

### 7.2 集成测试

测试多个 Action 的协作：

```php
<?php

namespace Tests\Feature\Actions;

use App\Actions\Order\CreateOrderAction;
use App\DTOs\CreateOrderDTO;
use Tests\TestCase;

class CreateOrderActionTest extends TestCase
{
    public function test_creates_order_with_valid_data(): void
    {
        $action = $this->app->make(CreateOrderAction::class);
        
        $dto = new CreateOrderDTO(
            userId: $this->user->id,
            items: [
                ['product_id' => $this->product->id, 'quantity' => 2],
            ],
        );
        
        $order = $action->execute($dto);
        
        $this->assertDatabaseHas('orders', [
            'user_id' => $this->user->id,
            'status' => 'pending',
        ]);
        $this->assertEquals(1, $order->items()->count());
    }
}
```

### 7.3 测试优势

与胖 Service 相比，Action 的测试有明显优势：

| 方面 | 胖 Service | Action |
|------|-----------|--------|
| 依赖数量 | 需要 mock 7+ 个依赖 | 只需 mock 2-3 个依赖 |
| 测试范围 | 一个方法测试多个逻辑 | 每个 Action 测试一个逻辑 |
| 测试速度 | 慢（需要 mock 大量依赖） | 快（依赖少） |
| 测试维护 | 修改一个逻辑可能影响其他测试 | 每个测试独立 |

## 八、30+ 仓库的重构经验与踩坑记录

### 8.1 踩坑一：过度拆分

**问题**：有些团队将 Action 拆分得过于细粒度，导致一个简单的操作需要调用 10+ 个 Action。

**教训**：Action 的粒度应该以「业务操作」为单位，而不是「代码行」为单位。一个 Action 可以包含 20-50 行代码，只要它代表一个完整的业务操作。

**经验法则**：如果你需要给 Action 起一个很长的名字才能描述它做什么，说明它可能太大了。如果你需要在另一个 Action 中调用它 5 次，说明它可能太小了。

### 8.2 踩坑二：循环依赖

**问题**：Action A 调用 Action B，Action B 又调用 Action A，形成循环依赖。

**解决方案**：
1. 提取共同逻辑到第三个 Action
2. 使用事件驱动解耦
3. 重新审视职责划分

```php
// ❌ 循环依赖
class CreateOrderAction {
    public function execute() {
        app(UpdateInventoryAction::class)->execute();
    }
}
class UpdateInventoryAction {
    public function execute() {
        app(CreateOrderAction::class)->execute(); // 循环！
    }
}

// ✅ 通过事件解耦
class CreateOrderAction {
    public function execute() {
        OrderCreated::dispatch($order); // 触发事件
    }
}
class OrderCreatedListener {
    public function handle() {
        app(UpdateInventoryAction::class)->execute();
    }
}
```

### 8.3 踩坑三：Action 中混入 HTTP 逻辑

**问题**：在 Action 中直接访问 `request()` 或返回 Response。

**教训**：Action 应该是纯业务逻辑，不依赖 HTTP 层。HTTP 相关的逻辑应该在 Controller 或 DTO 中处理。

```php
// ❌ Action 中混入 HTTP 逻辑
class CreateOrderAction {
    public function execute() {
        $userId = auth()->id(); // 依赖 HTTP 层
        $data = request()->all(); // 依赖 HTTP 层
    }
}

// ✅ 通过 DTO 传入数据
class CreateOrderAction {
    public function execute(CreateOrderDTO $dto) {
        $userId = $dto->userId; // 纯数据
    }
}
```

### 8.4 踩坑四：Action 的返回值不一致

**问题**：有的 Action 返回 Model，有的返回 bool，有的返回 void，不一致导致调用方困惑。

**解决方案**：建立统一的返回值规范：

```php
// 规范：
// - 创建操作：返回创建的 Model
// - 更新操作：返回更新后的 Model
// - 删除操作：返回 bool
// - 查询操作：返回 Collection 或 Model
// - 验证操作：返回 void（失败则抛异常）
// - 可能失败的操作：返回 Enum

class CreateOrderAction {
    public function execute(CreateOrderDTO $dto): Order { /* ... */ }
}

class UpdateOrderAction {
    public function execute(UpdateOrderDTO $dto): Order { /* ... */ }
}

class DeleteOrderAction {
    public function execute(int $orderId): bool { /* ... */ }
}

class PlaceOrderAction {
    public function execute(CreateOrderDTO $dto): OrderResult { /* ... */ }
}
```

### 8.5 踩坑五：Action 的命名冲突

**问题**：不同模块有同名的 Action，比如 `UserService\CreateUserAction` 和 `AdminService\CreateUserAction`。

**解决方案**：使用命名空间区分：

```php
namespace App\Actions\User;
class CreateAction { /* 用户自助注册 */ }

namespace App\Actions\Admin;
class CreateUserAction { /* 管理员创建用户 */ }

namespace App\Actions\Import;
class CreateUserAction { /* 批量导入用户 */ }
```

## 九、Action Pattern 在大型项目中的组织结构

### 9.1 目录结构

```
app/Actions/
├── Order/
│   ├── CreateOrderAction.php
│   ├── CancelOrderAction.php
│   ├── RefundOrderAction.php
│   ├── CreateOrderRecordAction.php    # 子操作
│   ├── ValidateStockAction.php        # 子操作
│   ├── ApplyCouponAction.php          # 子操作
│   └── Subscriptions/
│       ├── CreateSubscriptionAction.php
│       └── RenewSubscriptionAction.php
├── User/
│   ├── RegisterAction.php
│   ├── UpdateProfileAction.php
│   └── ChangePasswordAction.php
├── Payment/
│   ├── ProcessPaymentAction.php
│   ├── RefundPaymentAction.php
│       ┌─────── 
│       └── ...
└── Shared/                            # 跨模块共享的 Action
    ├── SendNotificationAction.php
    ├── GeneratePDFAction.php
    └── LogActivityAction.php
```

### 9.2 Action 的复用模式

```php
// 跨模块复用
class CreateOrderAction
{
    public function __construct(
        private CreateOrderRecordAction $createRecord,
        private SendNotificationAction $sendNotification,  // 共享 Action
        private LogActivityAction $logActivity,            // 共享 Action
    ) {}
}

class CreateUserAction
{
    public function __construct(
        private CreateUserRecordAction $createRecord,
        private SendNotificationAction $sendNotification,  // 同一个共享 Action
        private LogActivityAction $logActivity,            // 同一个共享 Action
    ) {}
}
```

## 十、与 Queued Jobs、Events、Listeners 的协作

### 10.1 Action + Job

对于耗时操作，将 Action 包装为 Job：

```php
class ProcessLargeExportJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private int $userId,
        private array $filters,
    ) {}

    public function handle(ExportOrdersAction $action): void
    {
        $action->execute(new ExportOrdersDTO(
            userId: $this->userId,
            filters: $this->filters,
            format: 'csv',
        ));
    }
}
```

### 10.2 Action + Event + Listener

使用事件驱动解耦 Action：

```php
// Action 触发事件
class CreateOrderAction
{
    public function execute(CreateOrderDTO $dto): Order
    {
        $order = $this->createRecord($dto);
        
        OrderCreated::dispatch($order);
        
        return $order;
    }
}

// Listener 调用其他 Action
class OrderCreatedListener
{
    public function handle(OrderCreated $event): void
    {
        // 异步发送通知
        SendOrderConfirmationJob::dispatch($event->order->id);
        
        // 同步更新统计
        app(UpdateOrderStatsAction::class)->execute($event->order);
    }
}
```

## 十一、总结与最佳实践

### 11.1 何时使用 Action Pattern

| 场景 | 是否使用 Action |
|------|----------------|
| 独立的业务操作 | ✅ 是 |
| 需要复用的逻辑 | ✅ 是 |
| 需要独立测试的逻辑 | ✅ 是 |
| 简单的 CRUD（没有业务逻辑） | ❌ 直接用 Repository |
| 纯数据转换 | ❌ 用 Transformer/Resource |
| 异步任务 | ❌ 用 Job（但 Job 内部可以调用 Action） |

### 11.2 Action Pattern 的最佳实践

1. **一个 Action 一件事**：每个 Action 代表一个完整的业务操作
2. **使用 DTO 作为输入**：明确的输入契约，方便测试和文档化
3. **通过构造函数注入依赖**：利用 Laravel 的服务容器
4. **保持 Action 无状态**：Action 实例可以安全地作为单例使用
5. **编排层只做编排**：顶层 Action 只负责调用子 Action，不包含业务逻辑
6. **事件驱动解耦**：使用事件而不是直接调用来处理副作用
7. **统一返回值规范**：创建返回 Model，操作返回 Enum
8. **命名清晰**：动词 + 名词，一看就知道做什么

### 11.3 重构检查清单

在将胖 Service 重构为 Action 时，按以下步骤进行：

1. [ ] 识别 Service 中的独立操作
2. [ ] 为每个操作创建 Action 类
3. [ ] 提取 DTO 作为输入
4. [ ] 拆分子操作为子 Action
5. [ ] 更新 Controller 调用 Action
6. [ ] 更新测试
7. [ ] 删除旧的 Service（确认没有其他引用后）

Action Pattern 不是银弹，但在大型 Laravel 项目中，它提供了一种清晰、可测试、可维护的方式来组织业务逻辑。通过 30+ 仓库的实践，我们证明了 Action Pattern 在团队协作、代码质量和开发效率方面的显著优势。从今天开始，用 Action 替代你的胖 Service 吧。


## 相关阅读

- [Laravel 12.x Pipeline 实战：从 if-else 地狱到管道模式的重构之路](/categories/Laravel/PHP/Laravel-12x-Pipeline-重构实战/)
- [Laravel Batch Job 实战：大数据量批量处理的内存治理、分块策略与进度追踪](/categories/Laravel/PHP/Laravel-Batch-Job-实战/)
- [ETL 实战：Laravel + Apache Airflow 数据管道构建](/categories/Laravel/PHP/ETL-实战-Laravel-Airflow-数据管道构建/)
