---
title: Laravel Action Job 实战：用 Action 类替代复杂 Job——可测试、可复用、可同步/异步切换的业务逻辑单元
keywords: [Laravel Action Job, Action, Job, 类替代复杂, 可测试, 可复用, 可同步, 异步切换的业务逻辑单元, PHP]
date: 2026-06-09 18:24:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Action
  - Job
  - 设计模式
  - 可测试性
  - 架构
description: 深入解析 Laravel Action 模式，如何将业务逻辑从 Job/Controller/Command 中抽离为独立的 Action 类，实现同步/异步无缝切换、单元测试零依赖、代码复用最大化。包含完整实战代码、测试用例与踩坑记录。
---


## 为什么 Job 越写越臃肿？

在 Laravel 项目中，我们习惯把业务逻辑放在 Job 里：

```php
class ProcessOrderPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle()
    {
        // 1. 验证库存
        // 2. 计算折扣
        // 3. 调用支付网关
        // 4. 更新订单状态
        // 5. 发送通知
        // 6. 记录审计日志
        // ...200 行代码
    }
}
```

问题很快暴露：

- **无法复用**：Controller 里也需要同样的逻辑（比如同步支付回调），只能复制粘贴或 `dispatch_now`
- **测试困难**：要测「计算折扣」得跑整个 Job，包括数据库、队列、外部 API
- **职责混乱**：一个 Job 搞定一切，改一处怕炸另一处
- **同步/异步切换靠猜**：有些场景要同步（API 回调），有些要异步（后台任务），代码里满是 `if ($async)` 判断

**Action 模式的核心思想**：把「做一件事」的逻辑封装成一个独立类，Job/Controller/Command 都只是调用者。

## Action 模式长什么样？

### 基础结构

```php
namespace App\Actions;

class ProcessPaymentAction
{
    public function __construct(
        private readonly PaymentGateway $gateway,
        private readonly InventoryService $inventory,
        private readonly AuditLogger $audit,
    ) {}

    public function execute(Order $order, array $paymentData): PaymentResult
    {
        // 1. 验证库存
        $this->inventory->check($order);

        // 2. 计算折扣
        $discount = $this->calculateDiscount($order);

        // 3. 调用支付网关
        $result = $this->gateway->charge($order, $paymentData, $discount);

        // 4. 更新订单状态
        $order->update([
            'status' => $result->success ? 'paid' : 'failed',
            'paid_at' => $result->success ? now() : null,
        ]);

        // 5. 记录审计日志
        $this->audit->log('payment.processed', $order, $result);

        return $result;
    }

    private function calculateDiscount(Order $order): Money
    {
        // 折扣计算逻辑，纯函数，极易测试
        return $order->user->membership->applyDiscount($order->total);
    }
}
```

### Job 变成薄壳

```php
class ProcessOrderPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private readonly Order $order,
        private readonly array $paymentData,
    ) {}

    public function handle(ProcessPaymentAction $action): void
    {
        $action->execute($this->order, $this->paymentData);
    }
}
```

### Controller 同步调用同一逻辑

```php
class PaymentController extends Controller
{
    public function callback(Request $request, ProcessPaymentAction $action)
    {
        $order = Order::findOrFail($request->input('order_id'));
        $result = $action->execute($order, $request->validated());

        return response()->json($result->toArray());
    }
}
```

**一行代码，同步/异步随意切换。** Job 是壳，Action 是核心。

## 进阶：Action 基类设计

当项目里有几十个 Action 时，需要统一规范。

### 基类

```php
namespace App\Actions\Base;

use Illuminate\Support\Facades\DB;

abstract class Action
{
    /**
     * 执行动作，子类必须实现
     */
    abstract public function handle(...$args): mixed;

    /**
     * 公开入口：支持事务包裹、事件触发、日志记录
     */
    public function execute(...$args): mixed
    {
        $startTime = microtime(true);

        DB::beginTransaction();

        try {
            $result = $this->handle(...$args);

            DB::commit();

            $this->logExecution($args, microtime(true) - $startTime);

            return $result;
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->logFailure($args, $e);
            throw $e;
        }
    }

    /**
     * 不需要事务的场景
     */
    public function run(...$args): mixed
    {
        return $this->handle(...$args);
    }

    private function logExecution(array $args, float $duration): void
    {
        if (app()->has('action-logger')) {
            app('action-logger')->record(static::class, $args, $duration);
        }
    }

    private function logFailure(array $args, \Throwable $e): void
    {
        report($e);
    }
}
```

### 子类实现

```php
namespace App\Actions\Orders;

use App\Actions\Base\Action;
use App\Models\Order;
use App\DTO\PaymentResult;

class CompleteOrderAction extends Action
{
    public function handle(Order $order, string $transactionId): PaymentResult
    {
        $order->update(['status' => 'completed', 'transaction_id' => $transactionId]);

        event(new OrderCompleted($order));

        return PaymentResult::success($order);
    }
}
```

### 调用方式

```php
// 同步，带事务
$result = app(CompleteOrderAction::class)->execute($order, 'txn_123');

// 同步，不带事务
$result = app(CompleteOrderAction::class)->run($order, 'txn_123');

// 异步：包一层 Job
dispatch(fn () => app(CompleteOrderAction::class)->execute($order, 'txn_123'));
```

## 实战：一个完整的电商下单流程

以「用户下单」为例，展示 Action 如何拆解复杂流程。

### 流程拆解

```
用户下单
  ├── ValidateCartAction       → 验证购物车（库存、价格一致性）
  ├── CalculatePricingAction   → 计算价格（折扣、运费、税费）
  ├── ReserveInventoryAction   → 锁定库存
  ├── CreateOrderAction        → 创建订单
  ├── ProcessPaymentAction     → 执行支付
  └── SendOrderNotification    → 发送通知
```

### Pipeline 编排

```php
namespace App\Actions\Checkout;

use App\Actions\Base\Action;
use App\DTO\CheckoutRequest;
use App\DTO\CheckoutResult;
use App\Actions\Cart\ValidateCartAction;
use App\Actions\Pricing\CalculatePricingAction;
use App\Actions\Inventory\ReserveInventoryAction;
use App\Actions\Orders\CreateOrderAction;
use App\Actions\Payments\ProcessPaymentAction;
use App\Actions\Notifications\SendOrderNotification;

class CheckoutAction extends Action
{
    public function __construct(
        private readonly ValidateCartAction $validateCart,
        private readonly CalculatePricingAction $calculatePricing,
        private readonly ReserveInventoryAction $reserveInventory,
        private readonly CreateOrderAction $createOrder,
        private readonly ProcessPaymentAction $processPayment,
        private readonly SendOrderNotification $sendNotification,
    ) {}

    public function handle(CheckoutRequest $request): CheckoutResult
    {
        // 1. 验证购物车
        $cart = $this->validateCart->execute($request->cartId);

        // 2. 计算价格
        $pricing = $this->calculatePricing->execute($cart, $request->couponCode);

        // 3. 锁定库存（事务内，失败自动回滚）
        $reservation = $this->reserveInventory->execute($cart->items);

        // 4. 创建订单
        $order = $this->createOrder->execute($request->userId, $cart, $pricing);

        // 5. 支付
        $payment = $this->processPayment->execute($order, $request->paymentMethod);

        // 6. 通知（失败不阻断主流程）
        try {
            $this->sendNotification->run($order, 'order_placed');
        } catch (\Throwable $e) {
            report($e);
        }

        return new CheckoutResult($order, $payment, $pricing);
    }
}
```

### Controller 只做 HTTP 适配

```php
class CheckoutController extends Controller
{
    public function store(CheckoutRequest $request, CheckoutAction $checkout)
    {
        $result = $checkout->execute($request->toDTO());

        return response()->json([
            'order_id' => $result->order->id,
            'payment_status' => $result->payment->status,
            'total' => $result->pricing->total->format(),
        ], 201);
    }
}
```

### 异步版本（大批量下单场景）

```php
class BulkCheckoutJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private readonly array $checkoutRequests,
    ) {}

    public function handle(CheckoutAction $checkout): void
    {
        foreach ($this->checkoutRequests as $request) {
            try {
                $checkout->execute($request);
            } catch (\Throwable $e) {
                // 单条失败不影响其他
                report($e);
            }
        }
    }
}
```

## 测试：Action 的真正杀手锏

Action 模式最大的收益在测试。

### 单元测试：零外部依赖

```php
use App\Actions\Pricing\CalculatePricingAction;
use App\Models\Cart;
use App\Models\Coupon;
use Mockery;

class CalculatePricingActionTest extends TestCase
{
    private CalculatePricingAction $action;
    private $discountService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->discountService = Mockery::mock(DiscountService::class);
        $this->app->instance(DiscountService::class, $this->discountService);
        $this->action = app(CalculatePricingAction::class);
    }

    public function test_calculates_total_without_coupon(): void
    {
        $cart = Cart::factory()->create(['subtotal' => 10000]); // 100.00 元

        $this->discountService
            ->shouldReceive('calculate')
            ->once()
            ->andReturn(Money::cents(0));

        $result = $this->action->execute($cart, null);

        $this->assertEquals(10000, $result->total->cents());
        $this->assertEquals(0, $result->discount->cents());
    }

    public function test_applies_coupon_discount(): void
    {
        $cart = Cart::factory()->create(['subtotal' => 10000]);
        $coupon = Coupon::factory()->create(['type' => 'percent', 'value' => 10]);

        $this->discountService
            ->shouldReceive('calculate')
            ->once()
            ->andReturn(Money::cents(1000));

        $result = $this->action->execute($cart, $coupon->code);

        $this->assertEquals(9000, $result->total->cents());
        $this->assertEquals(1000, $result->discount->cents());
    }

    public function test_throws_on_expired_coupon(): void
    {
        $cart = Cart::factory()->create();
        $coupon = Coupon::factory()->expired()->create();

        $this->expectException(InvalidCouponException::class);

        $this->action->execute($cart, $coupon->code);
    }
}
```

### Feature 测试：端到端验证

```php
class CheckoutActionTest extends TestCase
{
    use RefreshDatabase;

    public function test_full_checkout_flow(): void
    {
        $user = User::factory()->create();
        $product = Product::factory()->create(['price' => 5000, 'stock' => 10]);
        $cart = Cart::factory()->for($user)->create();
        $cart->items()->create(['product_id' => $product->id, 'quantity' => 2]);

        // Mock 支付网关
        $this->mock(PaymentGateway::class, function ($mock) {
            $mock->shouldReceive('charge')
                ->once()
                ->andReturn(PaymentResult::success('txn_test_123'));
        });

        $request = new CheckoutRequest(
            userId: $user->id,
            cartId: $cart->id,
            paymentMethod: 'alipay',
            couponCode: null,
        );

        $result = app(CheckoutAction::class)->execute($request);

        // 断言订单创建
        $this->assertDatabaseHas('orders', [
            'user_id' => $user->id,
            'status' => 'paid',
        ]);

        // 断言库存扣减
        $this->assertEquals(8, $product->fresh()->stock);

        // 断言返回值
        $this->assertEquals('paid', $result->payment->status);
    }
}
```

**对比测试 Job 的痛苦**：需要 Queue::fake()、assertDispatched、处理序列化、mock 整个 handle 方法……Action 测试直接 `new` 出来就能跑。

## Action 的几种变体

### 1. 带 DTO 输入输出的 Action

```php
namespace App\Actions\Users;

use App\DTO\UserRegistrationData;
use App\DTO\UserRegistrationResult;

class RegisterUserAction extends Action
{
    public function handle(UserRegistrationData $data): UserRegistrationResult
    {
        $user = User::create([
            'name' => $data->name,
            'email' => $data->email,
            'password' => Hash::make($data->password),
        ]);

        event(new UserRegistered($user));

        return new UserRegistrationResult($user, true);
    }
}
```

### 2. 带权限检查的 Action

```php
class DeleteArticleAction extends Action
{
    public function handle(User $user, Article $article): void
    {
        if ($user->cannot('delete', $article)) {
            throw new UnauthorizedException('无权删除此文章');
        }

        $article->delete();
    }
}
```

### 3. 带 Pipeline 的链式 Action

```php
use Illuminate\Pipeline\Pipeline;

class ProcessImageAction extends Action
{
    public function handle(UploadedFile $file): ProcessedImage
    {
        return app(Pipeline::class)
            ->send(new ImageData($file))
            ->through([
                ValidateImageAction::class,
                ResizeImageAction::class,
                CompressImageAction::class,
                AddWatermarkAction::class,
                UploadToS3Action::class,
            ])
            ->thenReturn();
    }
}
```

### 4. 可取消的 Action（Saga 模式）

```php
class TransferFundsAction extends Action
{
    public function handle(Account $from, Account $to, Money $amount): TransferResult
    {
        $from->debit($amount);
        $to->credit($amount);

        try {
            event(new FundsTransferred($from, $to, $amount));
        } catch (\Throwable $e) {
            // 补偿：回滚
            $from->credit($amount);
            $to->debit($amount);
            throw $e;
        }

        return new TransferResult($from, $to, $amount);
    }
}
```

## 与 Laravel 原生组件的集成

### Action + Event/Listener

```php
// Event 触发 Action
class OrderPaidListener
{
    public function __construct(
        private readonly SendInvoiceAction $sendInvoice,
        private readonly UpdateInventoryAction $updateInventory,
    ) {}

    public function handle(OrderPaid $event): void
    {
        $this->sendInvoice->execute($event->order);
        $this->updateInventory->execute($event->order);
    }
}
```

### Action + FormRequest

```php
class StoreArticleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Article::class);
    }

    public function rules(): array
    {
        return ['title' => 'required|string|max:255', 'body' => 'required|string'];
    }

    public function toDTO(): CreateArticleData
    {
        return new CreateArticleData(...$this->validated(), authorId: $this->user()->id);
    }
}

class ArticleController extends Controller
{
    public function store(StoreArticleRequest $request, CreateArticleAction $action)
    {
        $article = $action->execute($request->toDTO());
        return ArticleResource::make($article);
    }
}
```

### Action + Artisan Command

```php
class SyncProductsCommand extends Command
{
    protected $signature = 'products:sync {--force}';

    public function handle(SyncProductsAction $sync): int
    {
        $result = $sync->execute($this->option('force'));

        $this->info("同步完成：新增 {$result->created}，更新 {$result->updated}");

        return self::SUCCESS;
    }
}
```

## 踩坑记录

### 坑 1：Action 之间循环依赖

```php
// ❌ Bad：A 依赖 B，B 依赖 A
class ActionA extends Action {
    public function __construct(private ActionB $b) {}
}
class ActionB extends Action {
    public function __construct(private ActionA $a) {}
}

// ✅ Fix：提取共享逻辑到 Service
class SharedService { /* 共享逻辑 */ }
class ActionA extends Action {
    public function __construct(private SharedService $svc) {}
}
class ActionB extends Action {
    public function __construct(private SharedService $svc) {}
}
```

### 坑 2：Action 里发 Job 导致测试爆炸

```php
// ❌ Bad：Action 里直接 dispatch
public function handle(Order $order): void
{
    dispatch(new SendInvoiceJob($order)); // 测试时队列状态不可控
}

// ✅ Fix：通过事件解耦，或注入 Dispatcher
public function __construct(private Dispatcher $dispatcher) {}

public function handle(Order $order): void
{
    $this->dispatcher->dispatch(new SendInvoiceJob($order));
}
```

### 坑 3：事务嵌套

```php
// ❌ Bad：Action.execute() 开了事务，内部又调用 Action.execute()
// 外层回滚不会回滚内层已 commit 的事务

// ✅ Fix：用 DB::transactionLevel() 判断
public function execute(...$args): mixed
{
    $inTransaction = DB::transactionLevel() > 0;

    if (!$inTransaction) {
        DB::beginTransaction();
    }

    try {
        $result = $this->handle(...$args);

        if (!$inTransaction) {
            DB::commit();
        }

        return $result;
    } catch (\Throwable $e) {
        if (!$inTransaction) {
            DB::rollBack();
        }
        throw $e;
    }
}
```

### 坑 4：Action 参数膨胀

```php
// ❌ Bad：8 个参数
public function handle(string $name, string $email, string $phone, string $address, string $city, string $zip, string $country, string $note): void

// ✅ Fix：用 DTO
public function handle(CreateCustomerData $data): void
```

### 坑 5：过度拆分

不是所有逻辑都需要 Action。简单的 CRUD 操作直接在 Controller 里做就行：

```php
// ❌ 过度设计
class ShowArticleAction extends Action {
    public function handle(int $id): Article {
        return Article::findOrFail($id);
    }
}

// ✅ 直接写
public function show(int $id) {
    return ArticleResource::make(Article::findOrFail($id));
}
```

**判断标准**：如果这段逻辑只在一个地方用，且不超过 10 行，不需要 Action。超过 15 行、或多处复用、或需要测试——就该抽了。

## 总结

| 维度 | 传统 Job | Action 模式 |
|------|---------|------------|
| 复用性 | 差，Job 是一次性容器 | 好，Action 可被任何调用者使用 |
| 可测试性 | 差，需要 mock 队列 | 好，直接 new 出来测试 |
| 同步/异步 | 需要 dispatch_now 或条件判断 | Job 是壳，Action 是核，随意切换 |
| 职责 | 混杂（业务+调度+重试） | 清晰（Action 只管业务） |
| 事务控制 | 分散在 Job.handle() 里 | 集中在 Action 基类 |
| 代码量 | Job 越来越胖 | 每个 Action 20-50 行 |

**适用场景**：

- 业务逻辑超过 15 行
- 同一逻辑需要在 Controller/Job/Command 中复用
- 需要写单元测试
- 团队协作，需要明确的代码边界

**不适用**：

- 简单 CRUD
- 只在一个地方用的 5 行代码
- 原型阶段（先跑起来再说）

Action 模式不是银弹，但它解决了 Laravel 项目中最常见的痛点：**业务逻辑无处安放**。当你发现 Job 超过 100 行、Controller 里开始复制代码、测试越来越难写——就是该引入 Action 的时候。
