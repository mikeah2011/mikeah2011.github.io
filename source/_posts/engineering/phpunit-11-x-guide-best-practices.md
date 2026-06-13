---

title: PHPUnit 11.x 实战：新特性与最佳实践——从 Laravel B2C API 的断言、属性到测试架构演进踩坑记录
keywords: [PHPUnit, Laravel B2C API, 新特性与最佳实践, 的断言, 属性到测试架构演进踩坑记录]
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
date: 2026-05-17 01:10:23
updated: 2026-05-17 01:14:29
categories:
- php
tags:
- PHPUnit
- Laravel
- 单元测试
- PHP Attributes
- 最佳实践
- KKday
description: PHPUnit 11 升级实战指南：30+ Laravel 仓库踩坑总结，涵盖 Attributes 语法、Expectation API 流式断言、#[TestWith] 数据提供者、Mock/Stub 演进、分层测试架构与并行测试最佳实践，附 12 项升级 Checklist 与踩坑速查表，助你从 PHPUnit 10 平滑升级到 11。
---




# PHPUnit 11.x 实战：新特性与最佳实践——从 Laravel B2C API 的断言、属性到测试架构演进踩坑记录

## 一、为什么这篇不是又一篇"PHPUnit 入门"

在 KKday B2C Backend Team，我们有 30+ 个 Laravel 仓库，测试框架统一用 PHPUnit（部分仓库已迁移到 Pest，但底层仍然是 PHPUnit）。Laravel 11 发布时默认搭载 PHPUnit 11，我们的第一反应是 `composer update` 然后跑一遍测试——结果 CI 绿了，大家就觉得"升级完成"。

直到有人发现新写的测试还在用 `@dataProvider` 注释、`$this->assertEquals()`、`createMock()` 这些 PHPUnit 10 的老写法，而 PHPUnit 11 已经提供了更现代、更安全、更易读的替代方案。更糟糕的是，PHPUnit 11 移除了一批在 10 中标记为 deprecated 的方法，如果你没注意这些 warning，升级到 11.0 之后 CI 会直接炸。

这篇文章只讲**我们在实际升级和日常编写测试中踩过的坑**，不是官方文档的搬运。

## 二、升级路径：PHPUnit 10 → 11 的真实踩坑清单

### 2.1 先跑 deprecated 检查，别直接升

PHPUnit 11 移除了大量在 10.x 中标记为 `@deprecated` 的方法。最稳妥的做法是**先在 PHPUnit 10 上把所有 deprecation warning 消除**，再升级。

```bash
# 先在 PHPUnit 10 环境下跑，关注 deprecation warnings
php artisan test --display-warnings 2>&1 | grep -i "deprecated"
```

我们遇到的高频废弃项：

| 废弃方法 | 替代方案 | 出现频率 |
|---------|---------|---------|
| `@dataProvider` 注释 | `#[DataProvider]` 属性 | 30+ 仓库全中 |
| `@depends` 注释 | `#[Depends]` 属性 | 约 40% 仓库 |
| `expectException()` + `expectExceptionMessage()` 分开写 | `expectExceptionWithMessage()` | 少量 |
| `assertFileNotExists()` | `assertFileDoesNotExist()` | 约 20% 仓库 |
| `at()` 方法对 Mock 的期望 | `with()` + `willReturn()` 组合 | 高频 |

### 2.2 Composer 约束变更

```json
// composer.json
{
    "require-dev": {
        "phpunit/phpunit": "^11.0"  // 从 ^10.0 升级
    }
}
```

**踩坑**：PHPUnit 11 要求 PHP >= 8.2。如果你的 CI 还在跑 PHP 8.1，必须先升 PHP。我们有 3 个老仓库卡在 PHP 8.1，最终是先升 PHP 再升 PHPUnit。

### 2.3 PHPUnit 10 vs 11 关键差异对比

下表汇总了在 30+ 仓库升级过程中遇到的核心差异，建议在升级前逐项检查：

| 维度 | PHPUnit 10 | PHPUnit 11 | 影响范围 |
|------|-----------|------------|---------|
| **PHP 最低版本** | PHP >= 8.1 | PHP >= 8.2 | CI 环境需先升级 |
| **注释语法** | `@dataProvider`、`@depends`、`@group` 等 DocBlock 注释 | `#[DataProvider]`、`#[Depends]`、`#[Group]` 等 Attributes | 全量替换 |
| **`#[Test]` 属性** | 支持但非必须 | 推荐使用，与 `test_` 前缀并存 | 新代码统一风格 |
| **废弃方法** | 标记 `@deprecated`，仍可用 | **已移除**，调用直接报错 | 需提前清理 |
| **`assertFileNotExists()`** | 废弃警告 | 已移除，用 `assertFileDoesNotExist()` | 约 20% 仓库 |
| **Mock 严格模式** | 未设置期望的方法静默返回 null | 发出 deprecation warning（未来变 error） | Mock 密集型测试 |
| **`BackupGlobals` 默认值** | 默认 `true`（备份全局变量） | 默认 `false`（不备份） | 并行测试必查 |
| **数据提供者** | 返回 `array` | 支持返回 `Generator`（懒加载） | 大数据集优化 |
| **Expectation API** | 可用但文档较少 | 官方推荐，文档完善 | 新断言优先使用 |
| **`expectUserDeprecationMessage()`** | 不可用 | **新增**，精确验证 PHP deprecation | 自定义 deprecation 测试 |
| **Test Runner 启动** | 基线 | 快约 15%（延迟加载优化） | CI 反馈提速 |
| **`onlyMethods()` 错误处理** | 方法不存在时 warning | 方法不存在时直接报错 | Mock 安全性提升 |
| **`#[TestWith]` 属性** | 不可用 | **新增**，内联数据集替代简单 `#[DataProvider]` | 简单数据驱动测试简化 |

## 三、Attributes 语法：从注释到类型安全

PHPUnit 11 最明显的变化是用 PHP 8 Attributes 替代了 DocBlock 注释。这不只是"语法糖"——Attributes 是编译时可解析的，IDE 可以静态分析，拼写错误会被立即捕获。

### 3.1 #[DataProvider] 替代 @dataProvider

旧写法：

```php
/**
 * @dataProvider orderStatusProvider
 * @dataProvider paymentMethodProvider
 */
public function test_order_can_be_created_with_valid_data(
    string $status,
    string $paymentMethod
): void {
    // ...
}

public static function orderStatusProvider(): array
{
    return [
        'pending' => ['pending'],
        'confirmed' => ['confirmed'],
    ];
}
```

PHPUnit 11 新写法：

```php
use PHPUnit\Framework\Attributes\DataProvider;

#[DataProvider('orderStatusProvider')]
#[DataProvider('paymentMethodProvider')]
public function test_order_can_be_created_with_valid_data(
    string $status,
    string $paymentMethod
): void {
    // ...
}

public static function orderStatusProvider(): array
{
    return [
        'pending' => ['pending'],
        'confirmed' => ['confirmed'],
    ];
}
```

**关键区别**：`#[DataProvider]` 属性中方法名是字符串，PHPUnit 11 会在运行时验证该方法是否存在且返回可迭代类型。如果方法名拼错，PHPUnit 10 的 `@dataProvider` 只是默默跳过测试（测试标记为 risky），而 PHPUnit 11 会直接报错。

**踩坑**：我们有一个仓库把 `@dataProvider` 写成了 `@dataprovider`（小写），PHPUnit 10 没报错但测试从未真正执行数据集。升级后 PHPUnit 11 直接报错，才发现这个测试跑了两年其实只执行了第一组数据。

### 3.2 #[Depends] 替代 @depends

```php
use PHPUnit\Framework\Attributes\Depends;

public function test_order_creation_returns_id(): int
{
    $order = Order::factory()->create();
    $this->assertGreaterThan(0, $order->id);
    return $order->id;
}

#[Depends('test_order_creation_returns_id')]
public function test_order_can_be_paid(int $orderId): void
{
    $order = Order::find($orderId);
    $this->assertTrue($order->canBePaid());
}
```

**踩坑**：`#[Depends]` 的行为和 `@depends` 完全一致——如果前置测试失败，后续测试标记为 skipped 而不是 failed。但在实际使用中，我们发现**过度使用依赖链会让测试套件变得脆弱**。一条链上 5 个测试，第一个挂了后面全 skip，CI 看起来"只失败了 1 个"，实际上 5 个都没验证。我们的规范是：**依赖链最多 2 层**，超过就拆成独立测试。

### 3.3 #[Test] 替代 test_ 前缀

```php
use PHPUnit\Framework\Attributes\Test;

// 旧写法：test_ 前缀
public function test_order_total_is_calculated_correctly(): void
{
    // ...
}

// PHPUnit 11 推荐写法：#[Test] 属性 + 方法名不带前缀
#[Test]
public function order_total_is_calculated_correctly(): void
{
    // ...
}
```

**踩坑**：这两种写法在 PHPUnit 11 中都有效，但团队必须统一风格。我们在 Code Review 中发现有人混用，同一个测试类里一半用 `test_` 前缀一半用 `#[Test]`，阅读体验极差。最终写入 PHP-CS-Fixer 规则强制统一。

## 四、Expectation API：PHPUnit 的"现代化"断言

PHPUnit 11 大幅强化了 Expectation API（从 PHPUnit 9.5 开始引入），提供流式（fluent）断言语法。这不是必须使用的，但对可读性提升显著。

### 4.0 Expectation API 断言速查对照表

下表汇总了 Expectation API 与传统断言的完整对照，建议收藏后在日常编码中参考：

| 传统断言 | Expectation API 写法 | 说明 |
|---------|---------------------|------|
| `assertEquals($a, $b)` | `expect($a)->toBe($b)` | 严格相等（===） |
| `assertNotEquals($a, $b)` | `expect($a)->not->toBe($b)` | 严格不等 |
| `assertTrue($val)` | `expect($val)->toBeTrue()` | 布尔真 |
| `assertFalse($val)` | `expect($val)->toBeFalse()` | 布尔假 |
| `assertNull($val)` | `expect($val)->toBeNull()` | 空值 |
| `assertNotNull($val)` | `expect($val)->not->toBeNull()` | 非空 |
| `assertEmpty($val)` | `expect($val)->toBeEmpty()` | 空字符串/空数组/0/false |
| `assertNotEmpty($val)` | `expect($val)->not->toBeEmpty()` | 非空 |
| `assertCount(3, $arr)` | `expect($arr)->toHaveCount(3)` | 数组/集合元素数 |
| `assertContains($item, $arr)` | `expect($arr)->toContain($item)` | 包含某元素 |
| `assertGreaterThan($a, $b)` | `expect($a)->toBeGreaterThan($b)` | 大于 |
| `assertLessThan($a, $b)` | `expect($a)->toBeLessThan($b)` | 小于 |
| `assertInstanceOf(Cls, $obj)` | `expect($obj)->toBeInstanceOf(Cls)` | 类型判断 |
| `assertArrayHasKey('k', $arr)` | `expect($arr)->toHaveKey('k')` | 键存在 |
| `assertStringContainsString($s, $h)` | `expect($h)->toContain($s)` | 字符串包含 |
| `assertMatchesRegularExpression($r, $s)` | `expect($s)->toMatch($r)` | 正则匹配 |
| `assertFileExists($path)` | `expect($path)->toBeFile()` | 文件存在 |
| `assertJson($json)` | `expect($json)->toBeJson()` | 合法 JSON |

> **选择建议**：新测试优先使用 Expectation API 以获得更好的可读性和链式调用能力；已有的传统断言无需强制迁移，两者可共存。在 Code Review 中我们发现，Expectation API 对集合/数组断言的可读性提升尤其明显（`->each->toHaveKeys(...)` 远优于循环 + assertArrayHasKey）。

### 4.1 基本用法对比

```php
// 传统写法
$this->assertEquals('pending', $order->status);
$this->assertGreaterThan(0, $order->total);
$this->assertContains($order->id, $orderIds);
$this->assertNotNull($order->paid_at);

// Expectation API 写法
expect($order->status)->toBe('pending')
    ->and($order->total)->toBeGreaterThan(0)
    ->and($order->id)->toBeIn($orderIds)
    ->and($order->paid_at)->not->toBeNull();
```

### 4.2 在 Laravel API 测试中的实际应用

我们在订单 API 测试中大量使用 Expectation API，因为它能大幅减少断言行数：

```php
use PHPUnit\Framework\Attributes\Test;

#[Test]
public function order_list_api_returns_paginated_orders(): void
{
    Order::factory()->count(25)->create(['user_id' => $this->user->id]);

    $response = $this->getJson('/api/v2/orders');

    $response->assertOk();

    $data = $response->json('data');

    expect($data)
        ->toBeArray()
        ->toHaveCount(15)  // 默认分页 15 条
        ->each
        ->toHaveKeys(['id', 'status', 'total', 'created_at']);
}

#[Test]
public function order_detail_api_includes_items_and_payment(): void
{
    $order = Order::factory()
        ->hasItems(3)
        ->hasPayment()
        ->create(['user_id' => $this->user->id]);

    $response = $this->getJson("/api/v2/orders/{$order->id}");

    $response->assertOk();

    $body = $response->json();

    expect($body['data'])
        ->id->toBe($order->id)
        ->status->toBe($order->status)
        ->items->toHaveCount(3)
        ->payment->status->toBe('pending');
}
```

### 4.3 Expectation API 的踩坑点

**踩坑 1：链式调用中的 `and()` 不是逻辑 AND**

```php
// ❌ 错误理解：status 是 'pending' AND status 是 'confirmed'
expect($order->status)->toBe('pending')->and($order->status)->toBe('confirmed');

// ✅ 这是两个独立断言，不是逻辑组合
// 第一个检查 status == 'pending'，第二个检查 status == 'confirmed'
// 如果两个条件都要满足，用 assertTrue + 逻辑运算
```

**踩坑 2：`->not` 的位置**

```php
// ❌ 语法错误
expect($value)->toBeNot(null);

// ✅ 正确写法
expect($value)->not->toBeNull();
```

**踩坑 3：Expectation API 与 Laravel TestCase 的兼容性**

在 Laravel 的 `TestCase` 中（继承 `Illuminate\Foundation\Testing\TestCase`），`expect()` 函数是全局可用的，不需要额外引入。但在纯 PHPUnit 测试类中（不继承 Laravel TestCase），需要确保 `expect()` 函数已被 autoload。PHPUnit 11 自带这个函数，不需要额外配置。

## 五、新增断言方法与实用特性

### 5.1 assertArrayIsList()

PHPUnit 11 新增了 `assertArrayIsList()`，用于验证数组是 0-indexed 连续的列表（而非关联数组）：

```php
#[Test]
public function product_categories_api_returns_list(): void
{
    $response = $this->getJson('/api/v2/categories');

    $response->assertOk();

    $this->assertArrayIsList($response->json('data'));

    // 确保前端可以直接用 array[index] 访问
    $first = $response->json('data')[0];
    $this->assertArrayHasKey('id', $first);
}
```

### 5.2 assertThat() 与约束组合

PHPUnit 11 强化了 Hamcrest 约束的集成，允许更灵活的组合断言：

```php
use PHPUnit\Framework\Assert;

#[Test]
public function order_total_is_within_expected_range(): void
{
    $order = Order::factory()->create(['total' => 15000]); // 150.00 TWD

    Assert::assertThat(
        $order->total,
        Assert::logicalAnd(
            Assert::greaterThan(0),
            Assert::lessThan(1000000)
        )
    );
}
```

### 5.3 #[TestWith] 属性：替代数据提供者的轻量级替代方案

PHPUnit 11 引入了 `#[TestWith]` 属性，允许直接在测试方法上声明内联数据集，无需单独定义数据提供者方法。对于简单的多组输入测试，这比 `#[DataProvider]` 更简洁：

```php
use PHPUnit\Framework\Attributes\TestWith;

// 旧写法：需要单独的 provider 方法
/**
 * @dataProvider statusProvider
 */
public function test_order_status_is_valid(string $status): void
{
    $this->assertTrue(in_array($status, ['pending', 'confirmed', 'shipped']));
}

public static function statusProvider(): array
{
    return [
        ['pending'],
        ['confirmed'],
        ['shipped'],
    ];
}

// PHPUnit 11 新写法：#[TestWith] 内联数据集
#[TestWith(['pending'])]
#[TestWith(['confirmed'])]
#[TestWith(['shipped'])]
public function test_order_status_is_valid(string $status): void
{
    $this->assertTrue(in_array($status, ['pending', 'confirmed', 'shipped']));
}
```

**踩坑**：`#[TestWith]` 的参数必须是数组，且每个数组元素对应测试方法的一个参数。如果你的测试方法有 3 个参数，每个 `#[TestWith]` 必须提供恰好 3 个值：

```php
#[TestWith(['order_001', 'TWD', 15000])]
#[TestWith(['order_002', 'JPY', 1000])]
public function test_order_currency_amount(string $orderId, string $currency, int $amount): void
{
    // ...
}
```

**选择建议**：简单数据集（3-5 组，每组 1-3 个参数）用 `#[TestWith]`，复杂数据集（需要动态生成、大量参数）用 `#[DataProvider]`。

### 5.4 #[WithoutErrorHandler] 属性

PHPUnit 11 引入了 `#[WithoutErrorHandler]` 属性，用于禁用 PHPUnit 的错误处理器，让 PHP 原生错误处理生效。在测试 Laravel 的 `set_error_handler` 行为时非常有用：

```php
use PHPUnit\Framework\Attributes\WithoutErrorHandler;

#[Test]
#[WithoutErrorHandler]
public function custom_error_handler_is_invoked(): void
{
    // 测试自定义错误处理器的行为
    // PHPUnit 的错误处理器不会拦截
}
```

### 5.5 expectUserDeprecationMessage()：精确验证 PHP Deprecation

PHPUnit 11 新增了 `expectUserDeprecationMessage()` 方法，用于精确断言代码触发了特定的 PHP deprecation 警告。这在升级 PHP 版本或第三方包时尤其有用——你可以确保"已知的 deprecation"被正确触发，而不是默默忽略。

```php
use PHPUnit\\Framework\\Attributes\\Test;

#[Test]
public function deprecated_order_method_triggers_warning(): void
{
    // 假设 Order::getTotal() 在新版本中标记为 deprecated
    // 使用新的 getTotalAmount() 替代
    $this->expectUserDeprecationMessage('Order::getTotal() is deprecated, use getTotalAmount() instead');

    $order = Order::factory()->create(['total' => 15000]);
    $order->getTotal(); // 触发 deprecation
}

#[Test]
public function legacy_payment_adapter_triggers_php_deprecation(): void
{
    // 验证使用了 PHP 8.2 已废弃的动态属性
    $this->expectUserDeprecationMessageMatches('/Dynamic property .* is deprecated/');

    $adapter = new LegacyPaymentAdapter();
    $adapter->customField = 'value'; // 触发 PHP deprecation
}
```

**踩坑**：`expectUserDeprecationMessage()` 只匹配用户级别的 deprecation（通过 `trigger_error(..., E_USER_DEPRECATED)` 触发的），不匹配 PHP 引擎自身的 deprecation。如果你需要匹配 PHP 引擎 deprecation，使用 `expectDeprecationMessage()`（注意没有 `User`）。两者在实际升级中经常搞混。

```php
// ❌ 搞混了：PHP 引擎 deprecation 用 expectDeprecationMessage()
$this->expectUserDeprecationMessage('...');  // 不会匹配 PHP 引擎 deprecation

// ✅ 正确区分
$this->expectDeprecationMessage('...');      // PHP 引擎 deprecation
$this->expectUserDeprecationMessage('...');  // 用户级 trigger_error deprecation
```

## 六、分层测试架构：在 30+ 仓库中统一规范

### 6.1 测试金字塔在 Laravel B2C API 中的落地

```text
                     ┌─────────────┐
                     │  E2E 测试    │  ← Dusk / Cypress（少量核心流程）
                    ─┤             ├─
                   / └─────────────┘ \
                  /    ┌─────────┐    \
                 /     │集成测试  │     \  ← Feature Tests（API 完整链路）
                ─┤     │         │     ├─
               / └─────┴─────────┴─────┘ \
              /      ┌───────────┐        \
             /       │ 单元测试   │         \  ← Unit Tests（Service/Model 逻辑）
            ─┤       │           │         ├─
           / └───────┴───────────┴─────────┘ \
```

在 PHPUnit 11 中，我们用目录结构来体现这个金字塔：

```
tests/
├── Unit/                    # 单元测试
│   ├── Services/
│   │   ├── OrderServiceTest.php
│   │   └── PaymentServiceTest.php
│   └── Models/
│       └── OrderTest.php
├── Feature/                 # 集成测试（API 测试）
│   ├── Api/
│   │   ├── V2/
│   │   │   ├── OrderControllerTest.php
│   │   │   └── ProductControllerTest.php
│   │   └── V3/
│   │       └── OrderControllerTest.php
│   └── Jobs/
│       └── ProcessPaymentJobTest.php
├── E2E/                     # 端到端测试（少量）
│   └── CheckoutFlowTest.php
└── Pest.php                 # 如果用 Pest 则在此配置
```

### 6.2 PHPUnit 11 的 Group 功能用于分层执行

```php
use PHPUnit\Framework\Attributes\Group;

#[Group('unit')]
class OrderServiceTest extends TestCase
{
    // ...
}

#[Group('integration')]
#[Group('api')]
class OrderControllerTest extends TestCase
{
    // ...
}

#[Group('e2e')]
class CheckoutFlowTest extends TestCase
{
    // ...
}
```

执行时可以按组筛选：

```bash
# 只跑单元测试（CI 快速反馈）
php artisan test --group=unit

# 只跑 API 集成测试
php artisan test --group=api

# 跑所有测试
php artisan test
```

**踩坑**：PHPUnit 11 的 `--group` 过滤器在 Laravel 的 `artisan test` 命令中有兼容性问题。我们最初用 `php artisan test --group=unit` 发现不起作用，改用 `vendor/bin/phpunit --group=unit` 就正常了。原因是 Laravel 的 `test` 命令有自己的参数解析逻辑，不一定透传所有 PHPUnit 原生选项。

### 6.3 数据提供者的改进

PHPUnit 11 的数据提供者现在支持返回 `Generator`，可以懒加载大量测试数据：

```php
use PHPUnit\Framework\Attributes\DataProvider;
use Generator;

public static function multi_currency_provider(): Generator
{
    $currencies = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'THB', 'SGD', 'MYR'];

    foreach ($currencies as $currency) {
        yield "currency: {$currency}" => [
            $currency,
            Money::of(1000, $currency),
        ];
    }
}

#[DataProvider('multi_currency_provider')]
public function test_order_total_currency_conversion(
    string $currency,
    Money $amount
): void {
    $order = Order::factory()->create([
        'currency' => $currency,
        'total' => $amount->getAmount(),
    ]);

    $this->assertEquals($currency, $order->currency);
}
```

## 七、Mock 与 Stub 的演进

### 7.1 createStub() vs createMock()

PHPUnit 11 继续推荐 `createStub()` 用于 stub（只设置返回值），`createMock()` 用于 mock（验证交互）。但在实际使用中，很多开发者混用这两个方法：

```php
// Stub：只关心返回值，不关心是否被调用
$paymentGateway = $this->createStub(PaymentGateway::class);
$paymentGateway->method('charge')->willReturn(new PaymentResult(true));

// Mock：关心是否被调用了特定方法
$notificationService = $this->createMock(NotificationService::class);
$notificationService->expects($this->once())
    ->method('sendOrderConfirmation')
    ->with($this->equalTo($order));
```

**踩坑**：PHPUnit 11 对 `createMock()` 的严格模式更敏感。如果你 mock 了一个接口但没有设置所有被调用方法的期望，PHPUnit 11 会发出 deprecation warning（未来版本会变成 error）。我们的解决方案是：**对不需要验证的方法用 `createStub()`，只有在验证交互时才用 `createMock()`**。

### 7.2 PHPUnit 11 的 MockBuilder 改进

```php
$mock = $this->getMockBuilder(OrderRepository::class)
    ->disableOriginalConstructor()
    ->onlyMethods(['findById', 'save'])  // 只 mock 这两个方法
    ->getMock();

// otherMethod() 仍然调用原始实现
$mock->method('findById')->willReturn($order);
```

**踩坑**：`onlyMethods()` 只能 mock 类中实际存在的方法。如果你写了一个不存在的方法名，PHPUnit 10 只是 warning，PHPUnit 11 直接报错。这其实是好事——之前我们有测试 mock 了一个已被重命名的方法，测试"通过"但实际上什么都没验证。

## 八、性能优化：大型测试套件的执行策略

### 8.1 PHPUnit 11 的 Test Runner 改进

PHPUnit 11 的 test runner 启动速度比 10 快约 15%（得益于延迟加载和 autoloader 优化）。但在 30+ 仓库的 CI 中，单个仓库的测试时间仍然在 3-8 分钟。

### 8.2 与 ParaTest 的集成

对于大型 Laravel 项目，我们使用 ParaTest 进行并行测试：

```bash
# 安装
composer require --dev brianium/paratest

# 并行执行（4 个进程）
vendor/bin/paratest --processes=4 --runner=WrapperRunner

# 指定 PHPUnit 11 配置
vendor/bin/paratest --processes=4 --phpunit=vendor/bin/phpunit
```

**踩坑**：PHPUnit 11 的某些全局状态管理行为与 ParaTest 有冲突。具体表现是：单跑测试通过，并行跑随机失败。原因是 PHPUnit 11 的 `#[BackupGlobals]` 属性默认行为变了——PHPUnit 11 默认**不备份全局变量**，而 PHPUnit 10 默认备份。在并行环境中，如果测试修改了 `$_ENV` 或静态变量且没有 `#[BackupGlobals(true)]`，就会出现竞态。

```php
use PHPUnit\Framework\Attributes\BackupGlobals;

#[BackupGlobals(true)]  // PHPUnit 11 中必须显式声明
class GlobalConfigTest extends TestCase
{
    public function test_env_override(): void
    {
        // 修改全局状态
        $_ENV['FEATURE_FLAG'] = 'new_checkout';
        // ...
    }
}
```

## 九、与 Pest 的关系：何时用 PHPUnit，何时用 Pest

在我们的 30+ 仓库中，约 1/3 已迁移到 Pest，2/3 仍然使用 PHPUnit。选择标准：

| 场景 | 推荐 | 原因 |
|------|------|------|
| 新项目、新测试文件 | Pest | 语法更简洁，学习成本低 |
| 已有大量 PHPUnit 测试 | PHPUnit | 迁移成本 > 收益 |
| 需要精细控制 Mock 交互 | PHPUnit | Pest 的 Mock 语法不如 PHPUnit 原生灵活 |
| 数据驱动测试 | Pest | Pest 的 `dataset()` 比 `#[DataProvider]` 更直观 |
| 团队 PHPUnit 经验丰富 | PHPUnit | 不要为了"新"而换 |

**重要**：Pest 底层就是 PHPUnit，任何 PHPUnit 11 的新特性在 Pest 中都可以使用。例如 Pest 测试中也可以用 `expect()` API，因为 Pest 的 `expect()` 和 PHPUnit 11 的 `expect()` 是同一个。

## 十、升级 Checklist（可直接复制使用）

在 30+ 仓库升级 PHPUnit 11 的过程中，我们总结了以下 checklist：

```text
□ 1. 确认 PHP 版本 >= 8.2
□ 2. composer.json 中 phpunit/phpunit 改为 ^11.0
□ 3. 运行现有测试，记录所有 deprecation warnings
□ 4. 批量替换 @dataProvider → #[DataProvider]
□ 5. 批量替换 @depends → #[Depends]
□ 6. 批量替换 @group → #[Group]
□ 7. 检查所有 createMock() 调用，不需要验证交互的改为 createStub()
□ 8. 检查 assertFileNotExists() → assertFileDoesNotExist()
□ 9. 检查并行测试中的 #[BackupGlobals] 使用
□ 10. CI 跑完整测试套件，确认无 regression
□ 11. 更新团队编码规范文档
□ 12. 更新 PHP-CS-Fixer 规则（强制 Attributes 语法）
```

## 附：PHPUnit 11 升级高频坑速查表

以下汇总了我们在 30+ 仓库升级过程中最常遇到的问题，按出现频率排序，建议升级前逐条排查：

| # | 坑点 | 症状 | 解决方案 | 出现频率 |
|---|------|------|---------|---------|
| 1 | `@dataProvider` 小写拼写 | PHPUnit 10 静默跳过，11 直接报错 | 全量替换为 `#[DataProvider]` 属性 | ★★★★★ |
| 2 | PHP 版本 < 8.2 | `composer install` 直接失败 | 先升 PHP 再升 PHPUnit | ★★★★★ |
| 3 | `createMock()` 未设定期望的方法 | PHPUnit 11 发出 deprecation warning | 不需要验证的改用 `createStub()` | ★★★★ |
| 4 | `BackupGlobals` 默认值变更 | 并行测试随机失败 | 显式声明 `#[BackupGlobals(true)]` | ★★★★ |
| 5 | `--group` 参数通过 `artisan test` 不生效 | 过滤器无效，跑全量测试 | 直接用 `vendor/bin/phpunit --group=` | ★★★ |
| 6 | `expectUserDeprecationMessage()` vs `expectDeprecationMessage()` 搞混 | 断言永远不匹配 | 区分「用户级 trigger_error」和「PHP 引擎级 deprecation」 | ★★★ |
| 7 | 依赖链过长（`#[Depends]` 超过 2 层） | 一个失败全链 skip，CI 误判 | 依赖链最多 2 层，超过拆独立测试 | ★★ |
| 8 | `test_` 前缀与 `#[Test]` 混用 | 同一类中风格不一致 | PHP-CS-Fixer 规则强制统一 | ★★ |
| 9 | `assertFileNotExists()` 未替换 | 调用不存在的方法直接报错 | 替换为 `assertFileDoesNotExist()` | ★★ |
| 10 | `onlyMethods()` 传入已重命名的方法 | PHPUnit 11 直接报错（10 只是 warning） | 检查 mock 的方法名是否与接口一致 | ★ |

> **实战技巧**：升级前先在 PHPUnit 10 上跑 `--display-warnings` 并收集所有 deprecation warning，逐条修完后再升 11，可以避免 90% 以上的升级问题。我们在 30+ 仓库中用这个策略，平均每仓库升级耗时从 2 天降到 4 小时。

## 总结

PHPUnit 11.x 不是一次"革命性"升级，但它推动了 PHP 测试向更现代、更类型安全的方向演进。Attributes 语法让测试元数据从"文本注释"变成了"编译时可检查的代码"，Expectation API 让断言更流畅，而对 Mock 行为的收紧则倒逼我们写出更严谨的测试。

在 Laravel B2C API 的实战中，最关键的认知是：**升级 PHPUnit 版本只是第一步，真正有价值的是借此机会重新审视测试架构**——分层是否合理、Mock 是否过度、数据提供者是否覆盖了边界条件。技术债往往藏在"测试也能跑"的假象里。

## 相关阅读

- [Pest PHP API 测试、Feature 测试、浏览器测试实战：Laravel B2C API 测试金字塔落地踩坑记录](/categories/engineering/pest-php-apitesting-featuretesting-testingguide/) — Pest PHP 在 Laravel API 测试中的完整实践，与本文 PHPUnit 11 写法形成互补参考
- [Mockery 实战：外部服务 Mock 与依赖隔离 Laravel B2C API 踩坑记录](/categories/engineering/mockery-guide-mock/) — 深入 Mockery Mock 与依赖隔离，补充本文第七章 PHPUnit Mock/Stub 的高级用法
- [代码覆盖率实战：Xdebug Coveralls 集成与报告 Laravel 踩坑记录](/categories/engineering/guide-xdebug-coveralls-laravel/) — 从 PHPUnit 测试到覆盖率报告的完整 CI 链路，是测试工程化的最后一环
- [PHPUnit 断言实战：Beyond assertEquals——掌握 expect、mock、stub 踩坑记录](/categories/php/laravel/phpunit-guide-beyond-assertequals-expect-mock-stub/) — 深入 PHPUnit 断言体系与 Mock/Stub 实战，是本文 Expectation API 与 Mock 演进的前置基础
- [Pest PHP 3.x 实战：简洁优雅的 PHP 测试框架深度剖析](/categories/php/2026-06-01-pest-php-3x-elegant-php-testing-framework/) — Pest 3.x 深度剖析与 PHPUnit 迁移实战，与本文第九章 PHPUnit vs Pest 选型互补
- [Pest 单元测试实战：Laravel B2C API 数据驱动与并发测试踩坑记录](/categories/php/laravel/pest-testingguide-concurrencytesting/) — Pest 数据驱动测试与并发测试实战，补充本文数据提供者与并行测试章节
- [phpunit.jenkins.xml 实战：Laravel 项目自动化测试流水线配置](/categories/devops/phpunit-jenkins-xml-guide-laravel-automationtesting/) — PHPUnit 在 Jenkins CI 中的 XML 配置与 Laravel 自动化测试流水线落地实践
- [Snapshot Testing 实战：API 响应快照回归测试](/categories/php/laravel/2026-06-01-snapshot-testing-api-response-regression-testing/) — 用 PHPUnit Snapshot 断言守护接口契约，与本文 Expectation API 形成互补的回归测试策略
- [PHPStan Level 8 实战：静态分析类型安全与渐进式升级](/categories/php/laravel/phpstan-level-8-guide/) — 静态分析与 PHPUnit 测试双管齐下，构建代码质量防线
- [GitHub Actions CI/CD 优化实战：Laravel 单体仓库矩阵拆分与缓存命中](/categories/php/laravel/github-actions-ci-cd-optimizationguide-laravel-cache/) — 将 PHPUnit 测试套件融入 CI/CD 流水线的完整优化方案
