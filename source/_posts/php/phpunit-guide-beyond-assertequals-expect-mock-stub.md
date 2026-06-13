---

title: PHPUnit 断言实战：Beyond assertEquals——掌握 expect、mock、stub 踩坑记录
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-05-05 00:20:10
updated: 2026-05-05 00:22:27
categories:
- php
- testing
tags:
- Laravel
- PHPUnit
- 单元测试
- Mock
- stub
- 断言
description: 深入讲解 PHPUnit 断言体系：从 assertEquals 到 expect() 链式行为验证，涵盖 Mock、Stub、数据提供器（Data Provider）在 Laravel 单元测试中的实战用法。对比 PHPUnit Mock 与 Mockery 差异，提供 HTTP API 测试、Event/Listener 测试、Queue Job 测试完整示例，附 mock 不生效的 5 种踩坑场景与断言速查表。
keywords: [PHPUnit, Beyond assertEquals, expect, mock, stub, 断言实战, 掌握, 踩坑记录]
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

### 3.4 Mockery Spy 模式：事后验证调用

当你不关心「方法被调用几次」，而是想事后检查「到底发生了什么」时，Spy 模式比 Mock 更灵活：

```php
use Mockery\SpyInterface;

class NotificationServiceSpyTest extends TestCase
{
    public function test_notification_sent_with_correct_channels(): void
    {
        $spy = Mockery::mock(NotificationService::class)->makePartial();
        // makePartial() 让真实方法正常执行，同时记录调用

        // 也可以用 spy() 代替 mock()
        // $spy = Mockery::spy(NotificationService::class);

        $service = new OrderService(notification: $spy);
        $order = $service->create([...]);

        // 事后验证：检查调用记录
        $spy->shouldHaveReceived('send')
            ->once()
            ->with(
                Mockery::type(OrderCreatedEvent::class),
                ['sms', 'email']  // 验证通知渠道列表
            );

        $spy->shouldNotHaveReceived('send', [
            Mockery::type(OrderCreatedEvent::class),
            ['push'],  // push 渠道不应该被触发
        ]);
    }
}
```

**Spy vs Mock 选择**：
- 用 **Mock**（`shouldReceive`）：确定「一定会调用」，提前定义期望
- 用 **Spy**（`shouldHaveReceived`）：事后检查「实际发生了什么」，适合不确定调用时机的场景

### 3.5 expect() 链式断言详解

PHPUnit 的 `expect()` 是一个强大的链式 API，用于在 Mock 对象上设置行为期望：

```php
$mock->expects($this->once())          // 期望被调用 1 次
    ->method('save')                     // 方法名
    ->with(                              // 参数匹配
        $this->callback(fn($order) =>    // 自定义断言
            $order->status === 'confirmed'
            && $order->total > 0
        )
    )
    ->willReturn($savedOrder)            // 返回值
    ->willReturnOnConsecutiveCalls(      // 多次调用返回不同值
        ['status' => 'pending'],
        ['status' => 'confirmed']
    )
    ->willThrowException(new Exception('DB error'))  // 抛异常
    ->willReturnCallback(fn($order) => [             // 动态返回
        ...$order,
        'saved_at' => now(),
    ]);
```

**踩坑记录**：在测试 B2C 搜索 API 时，我们用了 `Mockery::any()` 匹配所有参数，导致一个参数名从 `keyword` 改成 `query` 的重构没有被测试发现。**建议：对核心业务参数用 `Mockery::on()` 做精确校验，不要偷懒用 `any()`。**

### 3.6 PHPUnit 原生 Mock vs Mockery vs Prophecy 对比

PHPUnit 自带 Mock 框架，也可以集成 Mockery 或使用 Prophecy。三者有什么区别？

| 特性 | PHPUnit Mock | Mockery | Prophecy (phpspec) |
|------|-------------|---------|-------------------|
| **语法风格** | `$mock->method('foo')->willReturn('bar')` | `$mock->shouldReceive('foo')->andReturn('bar')` | `$prophet->reveal()->foo()` |
| **调用次数** | `$this->once()`, `$this->never()` | `->once()`, `->never()`, `->times(n)` | `->shouldBeCalledOnce()` |
| **参数匹配** | `$this->equalTo()`, `$this->anything()` | `Mockery::type()`, `Mockery::on()` | `Argument::type()`, `Argument::any()` |
| **验证时机** | 需要 `$this->addToAssertionCount()` | `Mockery::close()` 或 `shouldHaveReceived` | `->reveal()` 自动验证 |
| **Laravel 集成** | 原生支持 | Laravel 默认推荐 | 需手动配置 |
| **学习曲线** | 低 | 中 | 高 |
| **社区生态** | PHPUnit 官方维护 | 独立维护，Laravel 生态主流 | phpspec 项目维护 |

**Laravel 项目推荐使用 Mockery**，因为它与 Laravel TestCase 深度集成，`Mockery::close()` 已在 `tearDown` 中自动调用。

**PHPUnit 原生 Mock 示例**（不使用 Mockery）：

```php
class OrderServiceNativeMockTest extends TestCase
{
    public function test_create_order_with_native_mock(): void
    {
        // 使用 PHPUnit 原生创建 Mock
        $paymentMock = $this->createMock(PaymentService::class);

        // 设置期望：charge 方法被调用 1 次，参数包含 amount=19999
        $paymentMock->expects($this->once())
            ->method('charge')
            ->with($this->callback(fn($arg) =>
                $arg['amount'] === 19999 && $arg['currency'] === 'TWD'
            ))
            ->willReturn(['status' => 'succeeded', 'transaction_id' => 'txn_001']);

        $service = new OrderService($paymentMock);
        $order = $service->create([
            'product_id' => 1,
            'amount' => 19999,
            'currency' => 'TWD',
        ]);

        $this->assertSame('confirmed', $order->status);
    }

    public function test_create_order_with_partial_mock(): void
    {
        // 部分 Mock：只 mock 一个方法，其他方法真实调用
        $paymentMock = $this->getMockBuilder(PaymentService::class)
            ->onlyMethods(['charge'])      // 只 mock charge
            ->getMock();

        $paymentMock->expects($this->once())
            ->method('charge')
            ->willReturn(['status' => 'succeeded']);

        // validateSignature 等其他方法仍然真实执行
        $service = new OrderService($paymentMock);
        $this->assertSame('confirmed', $service->create([...])->status);
    }
}
```

### 3.7 Data Provider：数据驱动测试

当一个方法需要测试多组输入/输出时，用 Data Provider 避免重复代码：

```php
class PriceCalculatorTest extends TestCase
{
    /**
     * @dataProvider discountProvider
     */
    public function test_discount_calculation(float $price, float $discountRate, float $expected): void
    {
        $calculator = new PriceCalculator();
        $result = $calculator->applyDiscount($price, $discountRate);

        $this->assertEqualsWithDelta($expected, $result, 0.01);
    }

    public static function discountProvider(): array
    {
        return [
            '无折扣'       => [100.00, 0.0,  100.00],
            '九折'         => [100.00, 0.1,  90.00],
            '五折'         => [200.00, 0.5,  100.00],
            '满额折扣'     => [500.00, 0.15, 425.00],
            '零元商品'     => [0.00,   0.2,  0.00],
            '边界值：刚好' => [99.99,  0.1,  89.99],
        ];
    }

    /**
     * @dataProvider invalidAmountProvider
     */
    public function test_invalid_amount_throws_exception(int|float $amount): void
    {
        $this->expectException(InvalidAmountException::class);
        $calculator = new PriceCalculator();
        $calculator->applyDiscount($amount, 0.1);
    }

    public static function invalidAmountProvider(): array
    {
        return [
            '负数'  => [-100],
            'NaN'   => [NAN],
            '无穷大' => [INF],
        ];
    }
}
```

**Data Provider 最佳实践**：
- Provider 方法必须是 `public static`
- 方法名描述测试场景，而非数据内容
- 每组数据加字符串 key（如 `'无折扣'`），方便定位失败用例
- 复杂场景用 `#[DataProvider('methodName')]` 属性语法（PHPUnit 10+）

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

### 4.3 HTTP API 测试完整示例（Laravel Feature Test）

Laravel 的 HTTP 测试结合了 Stub 和断言，是最常见的集成测试场景：

```php
class ProductApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_list_products_returns_paginated_json(): void
    {
        // Arrange: 创建测试数据
        Product::factory()->count(25)->create(['category_id' => 1]);

        // Act: 发送请求
        $response = $this->getJson('/api/v1/products?category_id=1&page=2&per_page=10');

        // Assert: 验证响应结构
        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'name', 'price', 'category_id']
                ],
                'meta' => ['current_page', 'per_page', 'total'],
            ])
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonCount(10, 'data');
    }

    public function test_create_product_with_validation_errors(): void
    {
        $response = $this->postJson('/api/v1/products', [
            'name' => '',           // 缺少必填字段
            'price' => -100,        // 无效价格
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'price']);
    }

    public function test_create_product_requires_authentication(): void
    {
        // 不带 token 访问
        $response = $this->postJson('/api/v1/products', ['name' => 'Test']);

        $response->assertStatus(401);
    }

    public function test_update_product_authorized_only_by_owner(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $product = Product::factory()->create(['user_id' => $user->id]);

        // 非所有者尝试更新
        $response = $this->actingAs($otherUser)
            ->putJson("/api/v1/products/{$product->id}", ['name' => 'Hacked']);

        $response->assertStatus(403);
    }
}
```

### 4.4 Laravel TestCase 中的容器绑定 Stub

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

### 4.5 Eloquent Model 测试：工厂 + 断言

测试数据层时，结合 `Model::factory()` 和数据库断言是最高效的方式：

```php
class OrderModelTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_creation_with_factory(): void
    {
        $order = Order::factory()->create([
            'amount' => 19999,
            'currency' => 'TWD',
            'status' => 'pending',
        ]);

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'amount' => 19999,
        ]);
    }

    public function test_order_scope_pending_returns_correct_results(): void
    {
        Order::factory()->count(3)->create(['status' => 'pending']);
        Order::factory()->count(2)->create(['status' => 'confirmed']);

        $pendingOrders = Order::pending()->get();

        $this->assertCount(3, $pendingOrders);
        $this->assertEveryItem(fn($order) => $order->status === 'pending', $pendingOrders);
    }

    public function test_order_relationship_user(): void
    {
        $order = Order::factory()
            ->for(User::factory()->create(['name' => 'KKday']))
            ->create();

        $this->assertSame('KKday', $order->user->name);
    }

    public function test_order_soft_deletion(): void
    {
        $order = Order::factory()->create();
        $order->delete();

        $this->assertSoftDeleted('orders', ['id' => $order->id]);
    }
}
```

**工厂最佳实践**：
- 使用 `state()` 定义常用状态：`Order::factory()->cancelled()->create()`
- 避免 N+1 查询：在工厂中用 `for()` 关联依赖模型
- 测试数据独立：每个测试用例使用独立工厂数据，避免测试间干扰

### 4.6 Middleware 测试

中间件是 Laravel 请求管道的关键节点，测试时需要验证认证、权限、频率限制等逻辑：

```php
class ThrottleMiddlewareTest extends TestCase
{
    public function test_rate_limiting_allows_first_request(): void
    {
        $request = Request::create('/api/orders', 'POST', ['amount' => 100]);
        $middleware = new ThrottleRequests(60, 'minute');

        $response = $middleware->handle($request, fn() => response()->json(['ok' => true]));

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_rate_limiting_blocks_after_limit(): void
    {
        // 模拟已达到限制
        Cache::shouldReceive('increment')->andReturn(61); // 超过 60 次/分钟

        $request = Request::create('/api/orders', 'POST');
        $middleware = new ThrottleRequests(60, 'minute');

        $response = $middleware->handle($request, fn() => response()->json(['ok' => true]));

        $this->assertEquals(429, $response->getStatusCode());
    }
}
```

### 4.7 Job / Queue 测试进阶：链式 Job 和延迟调度

```php
class OrderJobChainTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_job_chain_executes_in_order(): void
    {
        Bus::fake();

        $service = app(OrderService::class);
        $service->create(['product_id' => 1, 'amount' => 100, 'use_chain' => true]);

        // 验证 Job 链被正确构建
        Bus::assertChained([
            ReserveInventoryJob::class,
            ProcessPaymentJob::class,
            SendConfirmationEmail::class,
        ]);
    }

    public function test_job_dispatched_with_delay(): void
    {
        Queue::fake();

        $job = new RetryPaymentJob(orderId: 'ORD_001');
        dispatch($job->delay(now()->addMinutes(5)));

        Queue::assertPushed(RetryPaymentJob::class, function ($job) {
            return $job->delay === now()->addMinutes(5);
        });
    }
}
```

---

## 4A、测试策略与最佳实践

在 Laravel B2C 项目中，测试不是越多越好，而是要覆盖关键路径。以下是我们在 KKday 30+ 仓库中总结的测试策略：

### 测试覆盖率的优先级金字塔

```
┌─────────────────────────────────────────────────────────┐
│ P0 核心业务流程（必须 100% 覆盖）                         │
│ - 订单创建/支付/退款                                       │
│ - 支付回调签名验证                                         │
│ - 库存锁定/释放                                          │
├─────────────────────────────────────────────────────────┤
│ P1 关键边界条件（90%+ 覆盖）                              │
│ - 并发场景：幂等、分布式锁                                  │
│ - 降级逻辑：API 超时、缓存穿透                              │
│ - 权限校验：角色、所有权                                    │
├─────────────────────────────────────────────────────────┤
│ P2 辅助功能（选择性覆盖）                                  │
│ - 日志记录                                                │
│ - 非关键事件派发                                          │
│ - 报表生成                                                │
└─────────────────────────────────────────────────────────┘
```

### 测试命名规范

```php
// ✅ 好的命名：描述行为 + 预期结果
public function test_order_creation_throws_exception_when_amount_is_negative(): void
public function test_payment_gateway_returns_succeeded_for_valid_charge(): void
public function test_inventory_is_released_when_payment_fails(): void

// ❌ 差的命名：只描述操作，不描述预期
public function test_create_order(): void
public function test_payment(): void
public function test_inventory(): void
```

### 测试环境管理

```php
// 使用 trait 管理测试数据和环境
trait RefreshMockState
{
    protected function setUpMocks(): void
    {
        $this->paymentMock = Mockery::mock(PaymentService::class);
        $this->inventoryMock = Mockery::mock(InventoryService::class);
        $this->eventMock = Mockery::mock(EventDispatcher::class);
    }

    protected function tearDownMocks(): void
    {
        Mockery::close();
    }
}

// 在 TestCase 基类中使用
abstract class BaseTestCase extends TestCase
{
    use RefreshDatabase;
    use RefreshMockState;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMocks();
    }

    protected function tearDown(): void
    {
        $this->tearDownMocks();
        parent::tearDown();
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

### 5.1 Event / Listener 测试

在 Laravel 中，Event/Listener 是解耦业务逻辑的核心机制。测试时要验证：事件是否被触发、Listener 是否正确处理。

```php
// 方式一：使用 Event::fake() 验证事件被触发
class OrderEventTest extends TestCase
{
    public function test_order_created_event_is_dispatched(): void
    {
        Event::fake([OrderCreatedEvent::class]);

        // 执行业务逻辑
        $service = app(OrderService::class);
        $service->create(['product_id' => 1, 'amount' => 19999]);

        // 验证事件被触发了 1 次，且携带正确的 order_id
        Event::assertDispatched(OrderCreatedEvent::class, function (OrderCreatedEvent $event) {
            return $event->order->product_id === 1
                && $event->order->amount === 19999;
        });

        Event::assertDispatchedTimes(OrderCreatedEvent::class, 1);
    }

    public function test_order_event_should_not_dispatch_on_failure(): void
    {
        Event::fake([OrderCreatedEvent::class]);

        $paymentMock = Mockery::mock(PaymentService::class);
        $paymentMock->shouldReceive('charge')
            ->andThrow(new PaymentGatewayException('Insufficient funds'));

        try {
            $service = new OrderService($paymentMock);
            $service->create(['amount' => 100]);
        } catch (PaymentGatewayException $e) {
            // 预期异常
        }

        // 验证：支付失败时事件不应该被触发
        Event::assertNotDispatched(OrderCreatedEvent::class);
    }
}

// 方式二：测试 Listener 本身的逻辑
class SendOrderConfirmationListenerTest extends TestCase
{
    public function test_listener_sends_email_on_order_created(): void
    {
        Mail::fake();

        $order = Order::factory()->create(['status' => 'confirmed']);
        $event = new OrderCreatedEvent($order);

        $listener = new SendOrderConfirmationListener();
        $listener->handle($event);

        Mail::assertSent(OrderConfirmationMail::class, function (OrderConfirmationMail $mail) use ($order) {
            return $mail->hasTo($order->user->email);
        });
    }
}
```

### 5.2 Queue Job 测试

异步任务（Job）是 Laravel 处理耗时操作的标准方式。测试 Job 需要验证：是否被 dispatch、是否正确入队、执行逻辑是否正确。

```php
class ProcessPaymentJobTest extends TestCase
{
    public function test_job_is_dispatched_when_order_created(): void
    {
        Queue::fake();

        $service = app(OrderService::class);
        $service->create(['product_id' => 1, 'amount' => 19999, 'queue' => true]);

        // 验证 Job 被推送到指定队列
        Queue::assertPushed(ProcessPaymentJob::class, function (ProcessPaymentJob $job) {
            return $job->amount === 19999;
        });

        Queue::assertPushedOn('payments', ProcessPaymentJob::class);
    }

    public function test_job_execution_reserves_inventory(): void
    {
        // 不 fake Queue，直接测试 Job 的 handle() 方法
        $inventoryMock = Mockery::mock(InventoryService::class);
        $inventoryMock->shouldReceive('reserve')
            ->once()
            ->with('SKU_001', 2)
            ->andReturn(true);

        $this->app->instance(InventoryService::class, $inventoryMock);

        $job = new ProcessPaymentJob(
            orderId: 'ORD_001',
            sku: 'SKU_001',
            quantity: 2,
            amount: 19999,
        );
        $job->handle();

        $inventoryMock->shouldHaveReceived('reserve')->once();
    }

    public function test_job_retries_on_transient_failure(): void
    {
        // 验证 Job 配置了正确的重试次数和超时
        $job = new ProcessPaymentJob(orderId: 'ORD_001', sku: 'SKU_001', quantity: 1, amount: 100);

        $this->assertSame(3, $job->tries);
        $this->assertSame(60, $job->backoff);
        $this->assertSame(120, $job->timeout);
    }
}
```

**Job 测试最佳实践**：
- 验证 Job 是否被 dispatch → 用 `Queue::fake()` + `Queue::assertPushed()`
- 验证 Job 内部逻辑 → 直接调用 `handle()` 方法，mock 其依赖
- 验证 Job 配置 → 检查 `tries`、`timeout`、`backoff` 等属性
- 使用 `Bus::fake()` 替代 `Queue::fake()` 测试 `dispatch()` 而非 `dispatchSync()`

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

---

## 九、常见踩坑：Mock 不生效的 5 种场景

在 Laravel 项目中，Mock 配置了但测试不生效是最常见的困惑。以下是 5 种典型场景：

**场景 1：Mock 注入时机晚于对象创建**

```php
// ❌ 错误：先创建对象，再创建 Mock（Mock 没有被注入）
$service = new OrderService();
$paymentMock = Mockery::mock(PaymentService::class);
// 此时 $service 内部的 payment 是真实对象，不是 Mock

// ✅ 正确：先创建 Mock，再注入
$paymentMock = Mockery::mock(PaymentService::class);
$paymentMock->shouldReceive('charge')->once();
$service = new OrderService($paymentMock);
```

**场景 2：Facade 调用绕过了 Mock**

```php
// ❌ 错误：服务内部用 Facade 调用 Cache，但你 Mock 了类
$this->app->bind(CacheService::class, $cacheMock);
$result = $service->getFromCache('key'); // 内部用 Cache::get() 而非 app(CacheService::class)

// ✅ 正确：用 Cache::fake() 或确保注入的是同一个实例
Cache::fake();
$result = $service->getFromCache('key');
```

**场景 3：Mock 的方法名拼写错误**

```php
// ❌ 方法名拼错，不会报错，Mock 不生效
$mock->shouldReceive('cretaeCharge')->once(); // 拼写错误

// ✅ 启用严格模式：未调用的 Mock 会报错
Mockery::close(); // 在 tearDown 中调用，会自动检查所有未调用的 shouldReceive
```

**场景 4：`andReturn()` 返回值类型不匹配**

```php
// ❌ Mock 返回 string，但调用方期望 array
$mock->shouldReceive('getUser')->andReturn('john');
$user = $mock->getUser();
dd($user['name']); // 报错：Cannot access offset of string

// ✅ 确保返回值与真实方法一致
$mock->shouldReceive('getUser')->andReturn(['name' => 'john', 'email' => 'j@test.com']);
```

**场景 5：在 `withTransaction` 中 Mock 数据库操作**

```php
// ❌ 事务中 Mock 可能被 Laravel 的数据库事务覆盖
DB::shouldReceive('insert')->once();
$this->app->call([OrderService::class, 'create'], $data);

// ✅ 用 RefreshDatabase trait + 真实数据库断言，而非 Mock DB
use Illuminate\Foundation\Testing\RefreshDatabase;

class OrderServiceTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_saved_to_database(): void
    {
        // 直接验证数据库状态，而不是 Mock DB 层
        $service = app(OrderService::class);
        $service->create(['amount' => 100, 'user_id' => 1]);

        $this->assertDatabaseHas('orders', [
            'amount' => 100,
            'user_id' => 1,
            'status' => 'confirmed',
        ]);
    }
}
```

### expect vs assertEquals 选择指南

| 场景 | 推荐断言 | 原因 |
|------|---------|------|
| 验证函数返回值 | `assertSame()` | 严格类型比较，避免松散比较陷阱 |
| 验证 JSON 响应结构 | `assertJsonFragment()` | Laravel 提供链式调用，可读性高 |
| 验证方法被调用 | `expect()->once()` | 行为断言，明确期望调用次数 |
| 验证方法参数 | `expect()->with()` | 精确匹配参数，防止重构遗漏 |
| 验证未调用方法 | `expect()->never()` | 确保不该发生的调用确实没有发生 |
| 验证异常 | `expectException()` | 比 try-catch 更安全，自动 fail |
| 验证时间复杂度/性能 | 手动计时 + `assertLessThan()` | 确保性能回归 |
| 验证多个对象交互 | `shouldHaveReceived()` | 事后验证，可读性更好 |

---

## 十、断言速查表

| 验证目标 | 断言方法 | 示例 |
|---------|---------|------|
| 值相等（松散） | `assertEquals($expected, $actual)` | `assertEquals(200, $response['code'])` |
| 值相等（严格） | `assertSame($expected, $actual)` | `assertSame(0, $order->status)` |
| 值不相等 | `assertNotEquals($expected, $actual)` | `assertNotEquals(null, $order->id)` |
| 布尔值 | `assertTrue($condition)` / `assertFalse()` | `assertTrue($order->isPaid())` |
| 值为空 | `assertNull($value)` / `assertNotNull()` | `assertNull($error)` |
| 值在范围内 | `assertGreaterThan($min, $value)` | `assertGreaterThan(0, $order->total)` |
| 值为数组键 | `assertArrayHasKey($key, $array)` | `assertArrayHasKey('id', $data)` |
| 字符串包含 | `assertStringContainsString($needle, $haystack)` | `assertStringContainsString('成功', $response)` |
| 浮点数比较 | `assertEqualsWithDelta($e, $a, $delta)` | `assertEqualsWithDelta(199.99, $total, 0.01)` |
| 异常被抛出 | `expectException($class)` | `expectException(InvalidAmountException::class)` |
| 异常消息 | `expectExceptionMessage($msg)` | `expectExceptionMessage('金额必须大于零')` |
| 数据库记录存在 | `assertDatabaseHas($table, $data)` | `assertDatabaseHas('orders', ['id' => 1])` |
| 数据库记录不存在 | `assertDatabaseMissing($table, $data)` | `assertDatabaseMissing('orders', ['id' => 999])` |
| 方法被调用 1 次 | `shouldHaveReceived('method')->once()` | `$mock->shouldHaveReceived('charge')->once()` |
| 方法未被调用 | `shouldNotHaveReceived('method')` | `$mock->shouldNotHaveReceived('charge')` |
| 方法被调用 N 次 | `times(n)` | `->shouldReceive('send')->times(3)` |
| 参数精确匹配 | `Mockery::on(fn($arg) => ...)` | `->with(Mockery::on(fn($a) => $a > 0))` |
| 参数类型匹配 | `Mockery::type('array')` | `->with(Mockery::type('string'))` |
| HTTP 状态码 | `assertStatus($code)` | `$response->assertStatus(200)` |
| JSON 结构 | `assertJsonStructure([...])` | `->assertJsonStructure(['data' => ['id']])` |
| JSON 片段 | `assertJsonFragment([...])` | `->assertJsonFragment(['name' => 'KKday'])` |
| 事件被触发 | `Event::assertDispatched($class)` | `Event::assertDispatched(OrderCreatedEvent::class)` |
| Job 被入队 | `Queue::assertPushed($class)` | `Queue::assertPushed(ProcessPaymentJob::class)` |
| 邮件已发送 | `Mail::assertSent($class)` | `Mail::assertSent(OrderConfirmationMail::class)` |

---

## 相关阅读

- [快照测试：API 响应回归测试](/categories/PHP/2026-06-01-snapshot-testing-api-response-regression-testing/)
- [AI 辅助测试：Pest + AI Testing](/categories/Engineering/ai-testingguide-pest-ai-testing/)
- [PHPUnit + Jenkins 自动化测试](/categories/DevOps/phpunit-jenkins-xml-guide-laravel-automationtesting/)
