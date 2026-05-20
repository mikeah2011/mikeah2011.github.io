---
title: PHPUnit 断言实战：Beyond assertEquals——掌握 expect、mock、stub 踩坑记录
date: 2026-05-05 00:20:10
updated: 2026-05-05 00:22:27
categories:
  - PHP
  - Testing
tags: [Laravel, 测试]
description: 在 30+ 仓库的 Laravel B2C 项目中，assertEquals 只是起点。本文基于 KKday B2C API 真实测试场景，深入讲解 PHPUnit 的 expect() 链式断言、Mock 对象的行为验证、Stub 的依赖注入测试，以及在实际项目中踩过的坑。
keywords: PHPUnit, assertEquals, expect, mock, stub, 单元测试, Laravel, 断言, 行为验证, 依赖注入
---

## 前言：为什么 assertEquals 远远不够？

在 KKday B2C API 的 30+ 仓库中，我见过太多这样的测试：

```php
public function test_create_order()
{
    $result = $this->service->create($data);
    $this->assertEquals(200, $result['status_code']);
}
```

它通过了。但它没有验证：调用了几次支付接口？Redis 锁是否释放？事件是否派发？日志是否记录？

这种测试叫「Happy Path 测试」，它能告诉你「函数没报错」，但无法告诉你「函数做了该做的事」。在 B2C 订单场景下，这种测试形同虚设。

本文基于我在 KKday B2C API 中的真实测试实践，讲解如何用 PHPUnit 的 `expect()`、Mock、Stub 构建有深度的断言。

---

## 一、架构概览：测试金字塔中的断言层次

```
┌─────────────────────────────────────────────────────┐
│                    E2E / Browser                     │
│              (Laravel Dusk / Cypress)                │
│            验证：用户端到端完整流程                    │
├─────────────────────────────────────────────────────┤
│                    Integration                       │
│           (HTTP 测试 + Database 事务)                 │
│        验证：API 响应、数据库状态、队列入队              │
├─────────────────────────────────────────────────────┤
│                      Unit                            │
│        (expect() + Mock + Stub + Assertion)          │
│    验证：函数行为、依赖交互、边界条件、异常               │
├─────────────────────────────────────────────────────┤
│                   Assertion 层                       │
│      assertEquals │ assertSame │ expect()->once()    │
│      willReturn() │ willThrowException()             │
└─────────────────────────────────────────────────────┘
```

断言从底到顶分三个维度：

| 维度 | 方法 | 关注点 |
|------|------|--------|
| **状态断言** | `assertEquals`, `assertSame`, `assertContains` | 函数返回值 / 对象状态 |
| **行为断言** | `expect('foo')->once()`, `shouldHaveReceived` | 函数是否被调用、调用次数、参数 |
| **异常断言** | `expectException`, `expectExceptionMessage` | 是否抛出了预期的异常 |

大多数开发者只用第一层，这也是「测试写了很多但 bug 照出」的根本原因。

---

## 二、状态断言：从 assertEquals 到精确匹配

### 2.1 assertEquals vs assertSame：类型陷阱

```php
// ❌ 这个测试会通过，但它是错的
$this->assertEquals(1, true);   // 1 == true → pass（松散比较）

// ✅ 应该用 assertSame（严格比较）
$this->assertSame(1, true);     // 1 === true → fail（类型不同）
```

**踩坑记录**：在 KKday 的订单金额计算中，有个 Service 返回的是字符串 `"0"`，`assertEquals(0, $result)` 通过了测试，但下游支付 SDK 需要的是 `int 0`。上线后支付回调解析失败。修复后我们强制规定：**所有金额、状态码的断言必须用 `assertSame`**。

### 2.2 断言集合：assertArraySubset 的替代方案

PHPUnit 9 移除了 `assertArraySubset`，在 Laravel 项目中推荐这样替代：

```php
// ❌ 旧写法（PHPUnit 9+ 已移除）
$this->assertArraySubset(['name' => 'KKday'], $response);

// ✅ 新写法：使用 Laravel 的 fluent JSON 断言
$this->getJson('/api/products/1')
    ->assertJsonFragment(['name' => 'KKday'])
    ->assertJsonMissing(['internal_code' => 'SECRET_001']);
```

### 2.3 断言浮点数：金额比较的正确姿势

```php
// ❌ 直接比较浮点数（精度问题）
$this->assertEquals(199.99, $order->total_amount);

// ✅ 使用 delta 容差
$this->assertEqualsWithDelta(199.99, $order->total_amount, 0.001);

// ✅ 或者存分为单位（int），避免浮点问题
$this->assertSame(19999, $order->total_amount_in_cents);
```

---

## 三、Mock 行为验证：函数被调了几次？参数对不对？

### 3.1 expect() 的核心思想：行为驱动断言

状态断言回答「结果是什么」，行为断言回答「过程对不对」。PHPUnit 的 `expect()` 用于验证 Mock 对象的方法调用：

```php
use App\Services\PaymentService;
use App\Services\OrderService;
use Mockery;

class OrderServiceTest extends TestCase
{
    public function test_create_order_calls_payment_gateway(): void
    {
        // 创建 Mock
        $paymentMock = Mockery::mock(PaymentService::class);
        $paymentMock->shouldReceive('charge')
            ->once()
            ->with(Mockery::on(function ($arg) {
                return $arg['amount'] === 19999
                    && $arg['currency'] === 'TWD';
            }))
            ->andReturn(['status' => 'succeeded', 'transaction_id' => 'txn_123']);

        // 注入 Mock
        $service = new OrderService($paymentMock);
        $result = $service->create([
            'product_id' => 1,
            'amount' => 19999,
            'currency' => 'TWD',
        ]);

        // 验证：charge 确实被调用了 1 次
        $paymentMock->shouldHaveReceived('charge')->once();
    }
}
```

### 3.2 调用次数验证：once / never / twice / times(n)

```php
// 验证：幂等场景下，同一个订单 ID 只会扣一次款
public function test_idempotent_order_creation(): void
{
    $paymentMock = Mockery::mock(PaymentService::class);
    $paymentMock->shouldReceive('charge')->once()->andReturn(['status' => 'succeeded']);

    $service = new OrderService($paymentMock);
    $service->create(['idempotency_key' => 'order_abc', 'amount' => 100]);
    $service->create(['idempotency_key' => 'order_abc', 'amount' => 100]); // 重复请求

    // charge 应该只被调用 1 次，不是 2 次
    $paymentMock->shouldHaveReceived('charge')->once();
}

// 验证：通知发送给多个渠道
public function test_multi_channel_notification(): void
{
    $notifyMock = Mockery::mock(NotificationService::class);
    $notifyMock->shouldReceive('send')->times(3); // SMS + Email + LINE

    $service = new OrderService(payment: $this->mockPayment(), notification: $notifyMock);
    $service->complete(['order_id' => 'ORD_001']);

    $notifyMock->shouldHaveReceived('send')->times(3);
}
```

### 3.3 参数匹配器：精确匹配 vs 模糊匹配

```php
$mock->shouldReceive('process')
    ->once()
    ->with(
        Mockery::type('array'),           // 参数是数组
        Mockery::on(fn($v) => $v > 0),    // 参数 > 0
        Mockery::any()                     // 第三个参数任意
    );
```

**踩坑记录**：在测试 B2C 搜索 API 时，我们用了 `Mockery::any()` 匹配所有参数，导致一个参数名从 `keyword` 改成 `query` 的重构没有被测试发现。**建议：对核心业务参数用 `Mockery::on()` 做精确校验，不要偷懒用 `any()`。**

---

## 四、Stub 依赖注入：控制外部行为

### 4.1 Mock vs Stub 的本质区别

很多开发者分不清 Mock 和 Stub。区别很简单：

| 概念 | 目的 | 验证方式 |
|------|------|----------|
| **Stub** | 控制返回值（输入替换） | 状态断言：`assertEquals` |
| **Mock** | 验证方法是否被调用（输出验证） | 行为断言：`shouldHaveReceived` |

```php
// Stub 用法：只关心返回什么
$cacheStub = Mockery::mock(CacheService::class);
$cacheStub->shouldReceive('get')->andReturn(['hotels' => [...]]);

// Mock 用法：关心是否被调用
$cacheMock = Mockery::mock(CacheService::class);
$cacheMock->shouldReceive('forget')->once()->with('product:123');
```

### 4.2 Stub 外部 API 调用：HTTP Client Mock

在 Laravel B2C 项目中，外部 API（支付、酒店、机票）是最大的不确定性来源。用 Stub 隔离：

```php
use Illuminate\Support\Facades\Http;

public function test_hotel_search_fallback_on_api_timeout(): void
{
    // Stub：模拟 API 超时
    Http::fake([
        'api.hotel-provider.com/*' => Http::response([], 408),
    ]);

    $service = app(HotelSearchService::class);
    $result = $service->search(['city' => 'TPE', 'checkin' => '2026-06-01']);

    // 验证：超时时应该返回降级结果，而不是抛异常
    $this->assertSame('degraded', $result['mode']);
    $this->assertNotEmpty($result['cached_results']);
}

public function test_payment_webhook_signature_validation(): void
{
    // Stub：模拟 Stripe webhook payload
    $payload = json_encode(['type' => 'payment_intent.succeeded', 'data' => [...]]);
    $signature = 't=1234567890,v1=abc123...';

    // 验证签名验证逻辑（不真正调用 Stripe API）
    $verifier = new StripeWebhookVerifier(secret: 'whsec_test_123');
    $this->assertTrue($verifier->verify($payload, $signature));
}
```

### 4.3 Laravel TestCase 中的容器绑定 Stub

```php
class ProductSearchTest extends TestCase
{
    public function test_search_with_caching(): void
    {
        // 用 Laravel 容器替换真实 Cache
        $this->app->bind(CacheService::class, function () {
            $stub = Mockery::mock(CacheService::class);
            $stub->shouldReceive('remember')
                ->once()
                ->andReturn(['products' => ['iPhone', 'MacBook']]);
            return $stub;
        });

        $response = $this->getJson('/api/products?keyword=Apple');

        $response->assertOk();
        $response->assertJsonFragment(['products' => ['iPhone', 'MacBook']]);
    }
}
```

---

## 五、异常断言：测试「该报错时报错」

```php
// 基础异常断言
public function test_order_creation_fails_with_invalid_amount(): void
{
    $this->expectException(InvalidAmountException::class);
    $this->expectExceptionMessage('金额必须大于零');

    $service = new OrderService($this->mockPayment());
    $service->create(['amount' => -100]);
}

// 带异常码断言
public function test_payment_timeout_throws_specific_error(): void
{
    $this->expectException(PaymentGatewayException::class);
    $this->expectExceptionCode(408);

    $paymentMock = Mockery::mock(PaymentService::class);
    $paymentMock->shouldReceive('charge')
        ->andThrow(new PaymentGatewayException('Gateway timeout', 408));

    $service = new OrderService($paymentMock);
    $service->create(['amount' => 100]);
}

// 验证异常后数据库状态不变（事务回滚）
public function test_order_rollback_on_payment_failure(): void
{
    try {
        $this->service->create(['amount' => 100, 'user_id' => 1]);
    } catch (PaymentGatewayException $e) {
        // 验证：订单应该被回滚
        $this->assertDatabaseMissing('orders', ['user_id' => 1]);
    }
}
```

**踩坑记录**：在测试退款 Service 时，团队用了 `try-catch` 捕获异常后做了断言，但没有 `fail()`。当异常「没有」被抛出时，测试依然通过了。**正确写法是用 `$this->expectException()`**，它在异常未抛出时会自动 fail。

---

## 六、真实场景：一个完整的订单 Service 测试

把上面的知识点串起来，以下是一个接近生产质量的测试案例：

```php
class CreateOrderServiceTest extends TestCase
{
    private OrderService $service;
    private MockInterface $paymentMock;
    private MockInterface $inventoryMock;
    private MockInterface $eventMock;

    protected function setUp(): void
    {
        parent::setUp();

        $this->paymentMock = Mockery::mock(PaymentService::class);
        $this->inventoryMock = Mockery::mock(InventoryService::class);
        $this->eventMock = Mockery::mock(EventDispatcher::class);

        $this->service = new OrderService(
            payment: $this->paymentMock,
            inventory: $this->inventoryMock,
            events: $this->eventMock,
        );
    }

    public function test_create_order_happy_path(): void
    {
        // Arrange: 所有依赖返回成功
        $this->inventoryMock
            ->shouldReceive('reserve')
            ->once()
            ->with('SKU_001', 2)
            ->andReturn(true);

        $this->paymentMock
            ->shouldReceive('charge')
            ->once()
            ->with(Mockery::on(fn($arg) =>
                $arg['amount'] === 39998 && $arg['currency'] === 'TWD'
            ))
            ->andReturn([
                'status' => 'succeeded',
                'transaction_id' => 'txn_KKday_20260505',
            ]);

        $this->eventMock
            ->shouldReceive('dispatch')
            ->once()
            ->with(Mockery::type(OrderCreatedEvent::class));

        // Act
        $order = $this->service->create([
            'product_id' => 1,
            'sku' => 'SKU_001',
            'quantity' => 2,
            'amount' => 39998,
            'currency' => 'TWD',
        ]);

        // Assert 状态
        $this->assertSame('confirmed', $order->status);
        $this->assertSame('txn_KKday_20260505', $order->transaction_id);

        // Assert 行为
        $this->inventoryMock->shouldHaveReceived('reserve')->once();
        $this->paymentMock->shouldHaveReceived('charge')->once();
        $this->eventMock->shouldHaveReceived('dispatch')->once();
    }

    public function test_create_order_inventory_insufficient(): void
    {
        // Arrange: 库存不足
        $this->inventoryMock
            ->shouldReceive('reserve')
            ->once()
            ->andThrow(new InsufficientStockException('SKU_001 库存不足'));

        // 付款和事件不应该被调用
        $this->paymentMock->shouldReceive('charge')->never();
        $this->eventMock->shouldReceive('dispatch')->never();

        // Assert: 抛出业务异常
        $this->expectException(OrderCreationFailedException::class);
        $this->expectExceptionMessage('库存不足');

        $this->service->create([
            'product_id' => 1,
            'sku' => 'SKU_001',
            'quantity' => 100,
            'amount' => 1999900,
        ]);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
```

这个测试覆盖了三个维度：状态（订单状态）、行为（支付/库存/事件的调用关系）、异常（库存不足场景）。

---

## 七、踩坑总结

| # | 坑 | 解决方案 |
|---|-----|----------|
| 1 | `assertEquals(0, "")` 通过 | 改用 `assertSame` 严格比较 |
| 2 | `Mockery::any()` 掩盖参数名重构 | 核心参数用 `Mockery::on()` 精确匹配 |
| 3 | `try-catch` 测试异常时忘记 `fail()` | 统一用 `$this->expectException()` |
| 4 | Mock 对象忘记 `tearDown` 中 `Mockery::close()` | 写入 TestCase 基类 `setUp/tearDown` |
| 5 | Stub 返回类型不一致导致下游 bug | 用 `andReturn()` 时加上 PHPDoc 类型提示 |
| 6 | `shouldHaveReceived` 放在 Act 之前 | **顺序必须是 Arrange → Act → Assert** |
| 7 | 浮点金额比较精度丢失 | 存分（int）或用 `assertEqualsWithDelta` |

---

## 八、总结

| 你想验证什么 | 用什么 |
|-------------|--------|
| 函数返回值 | `assertSame`, `assertEqualsWithDelta` |
| 数组/JSON 结构 | `assertJsonFragment`, `assertArrayHasKey` |
| 外部依赖是否被调用 | `shouldHaveReceived('method')->once()` |
| 外部依赖应该返回什么 | `shouldReceive('method')->andReturn(...)` |
| 应该抛出异常 | `$this->expectException()` |
| 异常消息内容 | `$this->expectExceptionMessage()` |

测试不是写完就扔的代码，它是系统的活文档。好的断言能让三个月后的你看一眼就知道：「这个函数做了什么、依赖了什么、在异常时会怎样」。

> 下次写测试时问自己三个问题：
> 1. 结果对不对？（状态断言）
> 2. 该调用的都调用了吗？（行为断言）
> 3. 异常场景覆盖了吗？（异常断言）

三个都答「是」，这个测试才值得提交。
