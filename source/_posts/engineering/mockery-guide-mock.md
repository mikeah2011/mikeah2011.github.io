---

title: Mockery 实战：外部服务 Mock 与依赖隔离 Laravel B2C API 踩坑记录
keywords: [Mockery, Mock, Laravel B2C API, 外部服务, 与依赖隔离, 踩坑记录]
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
date: 2026-05-16 17:11:05
updated: 2026-05-16 17:16:43
categories:
- engineering
- testing
tags:
- Laravel
- 测试
- Mock
- PHPUnit
- PHP
description: 在 Laravel B2C 电商项目中，外部服务（支付网关、物流API、邮件推送）是测试的重灾区。本文记录了 30+ 仓库中使用 Mockery 进行外部服务 Mock 与依赖隔离的实战经验，涵盖 shouldReceive/shouldNotReceive 基础用法、接口隔离与面向接口编程、Partial Mock 与 protected 方法、Guzzle MockHandler 第三方 SDK Mock、Laravel Fake vs Mockery 选型对比、Expectation 顺序约束与 Spy 事后验证、Singleton 注入与队列测试等高频踩坑场景，附完整代码示例与架构图。
---


# Mockery 实战：外部服务 Mock 与依赖隔离 Laravel B2C API 踩坑记录

## 前言

在 B2C 电商项目中，Service Layer 经常依赖大量外部服务：支付网关（Stripe/AliPay）、物流追踪 API、邮件推送（SendGrid/Mailgun）、短信服务商、搜索引擎（Elasticsearch）等。如果单元测试直接调用这些外部服务，会遇到三大致命问题：

1. **速度慢**：一个 Stripe 回调测试可能要等 3-5 秒
2. **不稳定**：第三方服务偶尔宕机导致 CI 红灯
3. **副作用**：测试会在真实环境创建订单、发送邮件

Mockery 是 PHP 生态中最成熟的 Mock 框架，Laravel 底层的 `Mockery::mock()` 也是其核心依赖。但很多开发者只会 `->shouldReceive()` 这一招，遇到复杂场景就卡壳。

本文记录了我在 30+ 个 Laravel B2C 仓库中使用 Mockery 的真实踩坑经验。

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    Test Layer                         │
│  ┌───────────┐  ┌───────────┐  ┌──────────────┐     │
│  │ Unit Test │  │Feature Test│  │ Integration  │     │
│  │ (Mockery) │  │ (Mockery)  │  │  (Real API)  │     │
│  └─────┬─────┘  └─────┬──────┘  └──────┬───────┘     │
│        │              │                │              │
│  ┌─────▼──────────────▼────────────────▼───────┐     │
│  │          Service Layer (被测对象)             │     │
│  │  OrderService / PaymentService / NotifyService│    │
│  └─────┬──────────┬──────────┬─────────────────┘     │
│        │          │          │                        │
│  ┌─────▼────┐ ┌───▼────┐ ┌──▼──────────┐            │
│  │ Stripe   │ │ SendGrid│ │ Logistics  │            │
│  │ Client   │ │ Client  │ │ API Client │            │
│  └──────────┘ └────────┘ └────────────┘            │
│        ▲          ▲          ▲                        │
│   Mockery Mock  Mockery Mock  Mockery Mock           │
└─────────────────────────────────────────────────────┘
```

核心原则：**单元测试中，所有外部依赖都必须被 Mock；只有集成测试才走真实调用。**

## 一、基础用法：shouldReceive 与 shouldNotReceive

### 1.1 基本 Mock 声明

```php
// tests/Unit/Services/OrderServiceTest.php

use Tests\TestCase;
use App\Services\OrderService;
use App\Contracts\PaymentGatewayInterface;
use Mockery;

class OrderServiceTest extends TestCase
{
    protected function tearDown(): void
    {
        Mockery::close(); // ⚠️ 必须调用，否则内存泄漏 + 残留 expectation
        parent::tearDown();
    }

    public function test_create_order_should_call_payment_gateway(): void
    {
        // Arrange: Mock 支付网关
        $paymentMock = Mockery::mock(PaymentGatewayInterface::class);
        $paymentMock->shouldReceive('createIntent')
            ->once() // 只调用一次
            ->with(
                Mockery::on(fn ($amount) => $amount > 0), // 参数匹配器
                Mockery::type('string') // 类型匹配器
            )
            ->andReturn([
                'id' => 'pi_test_123',
                'status' => 'requires_payment_method',
            ]);

        // 注入 Mock
        $this->app->instance(PaymentGatewayInterface::class, $paymentMock);

        // Act
        $service = app(OrderService::class);
        $result = $service->createOrder([
            'product_id' => 1,
            'amount' => 19900, // 199.00 TWD
        ]);

        // Assert
        $this->assertEquals('pi_test_123', $result['payment_intent_id']);
    }
}
```

### 1.2 shouldNotReceive：确认某方法不被调用

```php
public function test_cancelled_order_should_not_charge(): void
{
    $paymentMock = Mockery::mock(PaymentGatewayInterface::class);
    $paymentMock->shouldReceive('createIntent')->never();
    $paymentMock->shouldReceive('capture')->never(); // ⚠️ 确保不会误扣款
    $paymentMock->shouldReceive('cancel')->once();

    $this->app->instance(PaymentGatewayInterface::class, $paymentMock);

    $service = app(OrderService::class);
    $service->cancelOrder(123);
}
```

## 二、接口隔离：为什么 Mock 接口比 Mock 类好 10 倍

### 2.1 踩坑：直接 Mock Eloquent Model 会爆炸

```php
// ❌ 错误示范：Mock 一个具体的 Eloquent Model
$orderMock = Mockery::mock(Order::class);
// 报错：Cannot mock final method Order::getAttribute()
```

Eloquent Model 有大量 `final` 方法和 `__call` 魔术方法，直接 Mock 经常失败。

### 2.2 正确做法：面向接口编程 + Mock 接口

```php
// app/Contracts/OrderRepositoryInterface.php
interface OrderRepositoryInterface
{
    public function findById(int $id): ?Order;
    public function create(array $data): Order;
    public function updateStatus(int $id, string $status): bool;
}

// app/Repositories/OrderRepository.php
class OrderRepository implements OrderRepositoryInterface
{
    public function findById(int $id): ?Order
    {
        return Order::find($id);
    }
    // ...
}

// tests/Unit/Services/OrderServiceTest.php
public function test_create_order_persists_data(): void
{
    $repoMock = Mockery::mock(OrderRepositoryInterface::class);
    $repoMock->shouldReceive('create')
        ->once()
        ->andReturn(new Order(['id' => 1, 'status' => 'pending']));

    $this->app->instance(OrderRepositoryInterface::class, $repoMock);

    $service = app(OrderService::class);
    $order = $service->createOrder(['product_id' => 1, 'amount' => 19900]);

    $this->assertEquals('pending', $order->status);
}
```

### 2.3 架构图：接口隔离带来的测试友好性

```
┌─────────────────────────────────────────┐
│          Service Layer                   │
│  ┌──────────────────────────────────┐   │
│  │ OrderService (被测对象)            │   │
│  │ 依赖: OrderRepositoryInterface   │   │
│  │ 依赖: PaymentGatewayInterface    │   │
│  │ 依赖: NotificationInterface      │   │
│  └──────────┬───────────────────────┘   │
│             │                           │
│     ┌───────▼────────┐                  │
│     │  Mockery Mock   │ ← 测试环境注入   │
│     │  接口的假实现    │                  │
│     └────────────────┘                  │
│                                         │
│     ┌────────────────┐                  │
│     │  Real Impl     │ ← 生产环境注入   │
│     │  真正的实现     │                  │
│     └────────────────┘                  │
└─────────────────────────────────────────┘
```

## 三、Partial Mock：只 Mock 一个方法

### 3.1 场景：Service 内部调用自己的私有方法

```php
class ShippingService
{
    public function calculateAndShip(int $orderId): array
    {
        $cost = $this->calculateShippingCost($orderId); // 内部方法
        return $this->callLogisticsApi($orderId, $cost); // 外部调用
    }

    protected function calculateShippingCost(int $orderId): float
    {
        // 复杂的运费计算逻辑...
        return 50.0;
    }

    protected function callLogisticsApi(int $orderId, float $cost): array
    {
        // 调用第三方物流 API...
    }
}
```

### 3.2 Partial Mock 实现

```php
public function test_shipping_calculation_uses_real_method_but_mock_api(): void
{
    $service = Mockery::mock(ShippingService::class)->makePartial();

    // 只 mock callLogisticsApi，calculateShippingCost 用真实实现
    $service->shouldReceive('callLogisticsApi')
        ->once()
        ->with(1, 50.0)
        ->andReturn(['tracking_no' => 'TW123456789']);

    $result = $service->calculateAndShip(1);

    $this->assertEquals('TW123456789', $result['tracking_no']);
}
```

### 3.3 踩坑记录：Partial Mock 的 shouldAllowMockingProtectedMethods

```php
// ❌ 默认不能 mock protected 方法
$service = Mockery::mock(ShippingService::class)->makePartial();
$service->shouldReceive('calculateShippingCost'); // 报错！

// ✅ 需要显式允许
$service = Mockery::mock(ShippingService::class)
    ->shouldAllowMockingProtectedMethods()
    ->makePartial();
$service->shouldReceive('calculateShippingCost')
    ->andReturn(80.0); // 覆盖运费计算
```

> **踩坑**：过度使用 `shouldAllowMockingProtectedMethods` 是设计问题的信号。如果你发现自己频繁 mock protected 方法，说明这个类的职责太重了，应该拆分。

## 四、第三方 SDK Mock：Stripe/Guzzle 实战

### 4.1 Mock Guzzle HTTP Client（最常见场景）

第三方 SDK 底层基本都是 Guzzle，直接 Mock HttpClient 是最通用的方案：

```php
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;

public function test_stripe_payment_callback(): void
{
    // 创建 Guzzle Mock Handler
    $mockHandler = new MockHandler([
        new Response(200, [], json_encode([
            'id' => 'pi_test_456',
            'status' => 'succeeded',
            'amount' => 19900,
        ])),
    ]);

    $handlerStack = HandlerStack::create($mockHandler);
    $mockClient = new Client(['handler' => $handlerStack]);

    // 注入 Mock 的 HTTP Client
    $this->app->instance(Client::class, $mockClient);

    // 执行测试
    $service = app(StripePaymentService::class);
    $result = $service->confirmPayment('pi_test_456');

    $this->assertEquals('succeeded', $result['status']);
}
```

### 4.2 多次请求的不同响应（重试场景）

```php
public function test_payment_retry_on_timeout(): void
{
    $mockHandler = new MockHandler([
        // 第一次：超时
        new ConnectException('Connection timed out', new Request('POST', '/')),
        // 第二次：成功
        new Response(200, [], json_encode([
            'id' => 'pi_test_789',
            'status' => 'succeeded',
        ])),
    ]);

    $handlerStack = HandlerStack::create($mockHandler);
    $mockClient = new Client(['handler' => $handlerStack]);

    $this->app->instance(Client::class, $mockClient);

    $service = app(StripePaymentService::class);
    $result = $service->confirmWithRetry('pi_test_789', maxRetries: 3);

    $this->assertEquals('succeeded', $result['status']);
}
```

### 4.3 架构图：Guzzle Mock 与 Service 的关系

```
┌────────────────────────────────────────┐
│              测试环境                    │
│                                         │
│  ┌──────────────┐    ┌──────────────┐  │
│  │ PaymentService│───▶│ Guzzle Client│  │
│  └──────────────┘    └──────┬───────┘  │
│                             │           │
│                    ┌────────▼────────┐  │
│                    │  MockHandler    │  │
│                    │  ├─ Response 1  │  │
│                    │  ├─ Timeout     │  │
│                    │  └─ Response 2  │  │
│                    └─────────────────┘  │
└────────────────────────────────────────┘
```

## 五、Laravel Fake vs Mockery：何时用哪个

### 5.1 Laravel 内置 Fake

Laravel 提供了一系列 `Fake` 实现，专门用于测试：

```php
// Mail Fake
Mail::fake();
Mail::assertSent(OrderConfirmationMail::class, 1);

// Queue Fake
Queue::fake();
Queue::assertPushed(ProcessOrderJob::class);

// Event Fake
Event::fake();
Event::assertDispatched(OrderCreated::class);

// Notification Fake
Notification::fake();
Notification::assertSentTo($user, OrderPaidNotification::class);
```

### 5.2 什么时候用 Mockery 而不是 Fake

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| Mail/Queue/Event/Notification | Laravel Fake | 官方支持，断言更丰富 |
| 自定义 Service/Repository | Mockery | 灵活性更强 |
| 第三方 SDK (Stripe/物流) | Mockery + Guzzle Mock | 无法用 Laravel Fake |
| Eloquent Model | Laravel Factory + 真实 Model | 不要 Mock Model |
| HTTP 外部调用 | Laravel Http::fake() | Laravel 7+ 内置 |

### 5.3 Laravel Http::fake() 替代 Guzzle Mock

```php
use Illuminate\Support\Facades\Http;

public function test_call_logistics_api(): void
{
    Http::fake([
        'api.logistics.com/*' => Http::response([
            'tracking_no' => 'TW987654321',
            'status' => 'shipped',
        ], 200),
    ]);

    $service = app(LogisticsService::class);
    $result = $service->trackShipment('order_123');

    $this->assertEquals('shipped', $result['status']);

    // 断言发出了正确的请求
    Http::assertSent(function ($request) {
        return $request->url() === 'https://api.logistics.com/track'
            && $request->hasHeader('Authorization');
    });
}
```

> **经验法则**：能用 Laravel Fake 就用 Laravel Fake，只在 Fake 覆盖不到的场景才用 Mockery。

## 六、高级技巧

### 6.1 Mock 的返回值基于参数动态生成

```php
$repoMock = Mockery::mock(OrderRepositoryInterface::class);
$repoMock->shouldReceive('findById')
    ->andReturnUsing(function (int $id) {
        return match ($id) {
            1 => new Order(['id' => 1, 'status' => 'paid']),
            2 => new Order(['id' => 2, 'status' => 'pending']),
            default => null,
        };
    });
```

### 6.2 Expectation 顺序约束

```php
public function test_order_lifecycle_must_follow_sequence(): void
{
    $gateway = Mockery::mock(PaymentGatewayInterface::class);

    // 必须先 createIntent 再 capture，顺序不能错
    $gateway->shouldReceive('createIntent')->once()->ordered();
    $gateway->shouldReceive('capture')->once()->ordered();

    $service = app(OrderService::class);
    $service->processPayment(1);
}
```

### 6.3 Spy：事后验证而非事前声明

```php
public function test_spy_catches_unexpected_calls(): void
{
    $spy = Mockery::spy(NotificationInterface::class);

    $this->app->instance(NotificationInterface::class, $spy);

    $service = app(OrderService::class);
    $service->completeOrder(1);

    // 事后验证：确认发了通知，但不关心具体参数
    $spy->shouldHaveReceived('send')
        ->with(Mockery::on(fn ($order) => $order->id === 1))
        ->once();
}
```

Spy 与 Mock 的区别：**Mock 事前声明期望，Spy 事后验证调用**。Spy 适合你不确定具体调用参数的场景。

### 6.4 全局 Mock 容器：避免重复注入

```php
// tests/Concerns/MocksExternalServices.php
trait MocksExternalServices
{
    protected function mockPaymentGateway(): Mockery\MockInterface
    {
        $mock = Mockery::mock(PaymentGatewayInterface::class);
        $this->app->instance(PaymentGatewayInterface::class, $mock);
        return $mock;
    }

    protected function mockNotificationService(): Mockery\MockInterface
    {
        $mock = Mockery::mock(NotificationInterface::class);
        $this->app->instance(NotificationInterface::class, $mock);
        return $mock;
    }

    protected function mockLogisticsClient(): Mockery\MockInterface
    {
        $mock = Mockery::mock(LogisticsClientInterface::class);
        $this->app->instance(LogisticsClientInterface::class, $mock);
        return $mock;
    }
}

// 使用
class OrderServiceTest extends TestCase
{
    use MocksExternalServices;

    public function test_full_order_flow(): void
    {
        $payment = $this->mockPaymentGateway();
        $payment->shouldReceive('createIntent')->andReturn(['id' => 'pi_1']);

        $notify = $this->mockNotificationService();
        $notify->shouldReceive('send')->once();

        $service = app(OrderService::class);
        $service->processOrder(['product_id' => 1, 'amount' => 9900]);
    }
}
```

## 七、踩坑记录

### 踩坑 1：忘记 Mockery::close() 导致内存泄漏

```php
// ❌ 忘记 close
protected function tearDown(): void
{
    parent::tearDown();
}

// ✅ 正确做法
protected function tearDown(): void
{
    Mockery::close();
    parent::tearDown();
}
```

Laravel 的 TestCase 已经内置了 `Mockery::close()`，但如果你自定义了 tearDown，顺序很重要：**先 close Mockery，再调 parent::tearDown()**。

### 踩坑 2：Mock Singleton 时的坑

```php
// ❌ Singleton 只创建一次，Mock 注入太晚
$this->app->singleton(PaymentService::class, function ($app) {
    return new PaymentService($app->make(Client::class));
});

// 在测试中：
$this->app->instance(Client::class, $mockClient);
// 如果 PaymentService 已经被解析过，注入无效！

// ✅ 解决方案：用 refreshApplication trait 或者在 setUp 中注入
protected function setUp(): void
{
    parent::setUp();
    // 在任何 resolve 之前注入 Mock
    $this->app->instance(Client::class, $this->createMockClient());
}
```

### 踩坑 3：shouldHaveReceived 在异步队列中失效

```php
// ❌ 队列任务在测试中被 sync driver 执行，但 Mock 已经被 close
Queue::fake(); // 用 Fake 而不是 Mockery
Queue::assertPushed(SendEmailJob::class);

// ✅ 队列任务用 Laravel Queue::fake()，不要用 Mockery
```

### 踩坑 4：Mock 了错误的类型导致静默失败

```php
// ❌ Mock 了具体类而不是接口
$mock = Mockery::mock(StripeClient::class);
// 如果 Service 依赖的是 StripeClient 的一个子类或 wrapper，这个 Mock 不会被注入

// ✅ 始终 Mock 接口
$mock = Mockery::mock(PaymentGatewayInterface::class);
$this->app->instance(PaymentGatewayInterface::class, $mock);
```

## 八、总结

| 技术 | 适用场景 | 优势 | 劣势 |
|------|---------|------|------|
| Mockery shouldReceive | 自定义 Service/Repository | 灵活、表达力强 | 需要手动 close |
| Mockery Partial Mock | 只 Mock 部分方法 | 保留真实逻辑 | 耦合实现细节 |
| Laravel Fake | Mail/Queue/Event/Notification | 官方支持、断言丰富 | 只覆盖 Laravel 组件 |
| Laravel Http::fake | 外部 HTTP 调用 | 简洁、语法优雅 | 不适合非 HTTP 场景 |
| Guzzle MockHandler | 底层 HTTP 行为控制 | 最灵活 | 代码量大 |
| Mockery Spy | 事后验证调用 | 适合探索性测试 | 不会提前拦截 |

**核心原则**：

1. **面向接口编程**：Mock 接口，不要 Mock 具体类
2. **能用 Laravel Fake 就用 Fake**：官方支持的场景不要重复造轮子
3. **Mock 外部边界**：支付网关、物流 API、邮件服务是 Mock 的主要对象
4. **不要 Mock 框架内部**：Eloquent Model、Cache、Session 用 Laravel 内置的测试工具
5. **每次 tearDown 必须 Mockery::close()**：否则残留 expectation 会影响后续测试

在 30+ 仓库的实践中，遵循这些原则让我们的单元测试从平均 30 秒跑完缩短到 8 秒，CI 红灯率从 15% 降到 2%（且几乎都是真实的 bug 而非环境问题）。Mock 不是目的，**可信的快速反馈**才是。

## 相关阅读

- [API Mock 策略实战：WireMock/Mockoon/MSW 三层 Mock 体系](/categories/架构/2026-06-06-API-Mock-策略实战-WireMock-Mockoon-MSW-三层Mock体系/) — 从开发到测试到生产的完整 API Mock 方案，与本文的单元级 Mock 互补
- [Data Contract 实战：Pact-style 数据契约——Laravel 微服务数据契约版本化与 Breaking Change 检测](/categories/架构/2026-06-05-Data-Contract-Pact-style-Laravel微服务数据契约版本化验证Breaking-Change检测/) — 契约测试视角，关注服务间数据格式的自动化守护
- [六边形架构实战：Laravel 端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/) — 本文 Mock 的接口隔离策略正是六边形架构的核心实践
