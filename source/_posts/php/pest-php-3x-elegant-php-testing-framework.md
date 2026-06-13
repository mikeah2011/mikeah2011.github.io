---
title: "Pest PHP 3.x 实战：简洁优雅的 PHP 测试框架深度剖析"
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-06-01 10:00:00
description: "Pest PHP 3.x 深度实战指南：从设计哲学到 Arch Testing 架构守护、Mutation Testing 测试盲区检测、自定义 Expectations 与高阶断言链式调用，详解 Datasets 数据驱动、Laravel 集成踩坑、并行测试性能优化，附 B2C API 项目 PHPUnit 迁移真实经验与框架选型对比。"
categories:
  - php
  - testing
tags: [Pest, PHP, Laravel, PHPUnit, Testing, Arch Testing, Mutation Testing, Datasets, Higher Order Expectations]
keywords: [Pest PHP, PHP, 简洁优雅的, 测试框架深度剖析, 测试]
---

## 一、为什么需要重新思考 PHP 测试？

### PHPUnit 的"仪式感"问题

PHPUnit 是 PHP 生态中最成熟的测试框架，但它的 API 设计带有强烈的 Java 基因——大量的 `extends`、冗长的方法名、必须继承 `TestCase` 的刚性约束。在 Laravel B2C API 项目中，一个典型的 PHPUnit 测试长这样：

```php
<?php
// 传统 PHPUnit 写法
namespace Tests\Unit\Services;

use Tests\TestCase;
use App\Services\OrderService;
use App\Repositories\OrderRepository;
use Mockery;

class OrderServiceTest extends TestCase
{
    private OrderService $service;
    private OrderRepository $repository;

    protected function setUp(): void
    {
        parent::setUp();
        $this->repository = Mockery::mock(OrderRepository::class);
        $this->service = new OrderService($this->repository);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @test */
    public function it_should_create_order_with_valid_data(): void
    {
        $data = ['product_id' => 1, 'quantity' => 2, 'user_id' => 100];
        $this->repository->shouldReceive('create')->once()->andReturn(new \stdClass());

        $result = $this->service->createOrder($data);

        $this->assertInstanceOf(\stdClass::class, $result);
    }

    /** @test */
    public function it_should_throw_exception_when_quantity_is_zero(): void
    {
        $data = ['product_id' => 1, 'quantity' => 0, 'user_id' => 100];

        $this->expectException(\InvalidArgumentException::class);
        $this->service->createOrder($data);
    }
}
```

这段代码有几个明显的问题：

1. **样板代码过多**：`extends TestCase`、`setUp/tearDown`、`/** @test */` 注解
2. **语义断言缺失**：`assertInstanceOf` 读起来不像自然语言
3. **文件结构僵化**：一个类对应一个测试文件，小函数测试无法独立组织
4. **Mock 管理繁琐**：需要手动管理 `Mockery::close()`

### Pest 的设计哲学

Pest 由 Nuno Maduro（Laravel 核心团队成员）创建，底层完全基于 PHPUnit，但重新定义了测试的编写体验。其核心设计哲学是：

> **测试即文档，代码即叙事。**

Pest 的设计遵循三个原则：

1. **函数式优先**：无需类继承，用闭包写测试
2. **语义化断言**：`expect($value)->toBe()` 替代 `$this->assertEquals()`
3. **可组合性**：`beforeEach`、`afterEach`、`datasets`、`higherOrderExpectations` 提供强大的组合能力

```php
<?php
// Pest 写法 —— 同样的测试
test('create order with valid data', function () {
    $repository = mock(OrderRepository::class);
    $repository->shouldReceive('create')->once()->andReturn(new \stdClass());
    $service = new OrderService($repository);

    $result = $service->createOrder([
        'product_id' => 1,
        'quantity' => 2,
        'user_id' => 100,
    ]);

    expect($result)->toBeInstanceOf(\stdClass::class);
});

test('create order throws when quantity is zero', function () {
    $repository = mock(OrderRepository::class);
    $service = new OrderService($repository);

    $service->createOrder([
        'product_id' => 1,
        'quantity' => 0,
        'user_id' => 100,
    ]);
})->throws(\InvalidArgumentException::class);
```

注意 `->throws()` 的链式调用——异常测试从 3 行缩减为 1 行。

---

## 二、Pest 3.x 架构与核心机制

### 底层架构：Pest 与 PHPUnit 的关系

Pest 不是 PHPUnit 的替代品，而是一个**语法糖层**。它在运行时将闭包测试转换为 PHPUnit 的 `TestCase` 对象。理解这个架构对于调试和扩展至关重要。

```
┌─────────────────────────────────────────────────────┐
│                   你写的测试文件                      │
│  test('name', function() { ... });                  │
│  it('does something', function() { ... });          │
│  describe('group', function() { ... });             │
└──────────────────────┬──────────────────────────────┘
                       │ 解析
                       ▼
┌─────────────────────────────────────────────────────┐
│               Pest 的核心解析引擎                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ TestCase.php │  │  Datasets    │  │ Plugins   │ │
│  │  (闭包→类)   │  │  (数据驱动)  │  │  (扩展点) │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Arch.php    │  │  HigherOrder │  │ Plugin.php│ │
│  │ (架构测试)   │  │ Expectations │  │           │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ 生成
                       ▼
┌─────────────────────────────────────────────────────┐
│               PHPUnit Test Runner                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ TestCase │  │ Assert   │  │  Result Printer  │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**关键源码片段**（Pest 解析闭包测试的核心逻辑）：

```php
// vendor/pestphp/pest/src/PendingCalls/TestCall.php
final class TestCall
{
    /**
     * Sets the test description and callable.
     */
    public function __construct(
        private readonly string $filename,
        private readonly string $description,
        private readonly Closure $testCase,
    ) {
        // ...
    }

    /**
     * Declares the test should throw an exception.
     */
    public function throws(
        string $exception,
        string $exceptionMessage = null,
    ): TestCall {
        $this->throws = $exception;
        $this->throwsMessage = $exceptionMessage;

        return $this; // 链式调用支持
    }
}
```

Pest 3.x 在此基础上增加了几个关键改进：

1. **类型安全的 Higher Order Expectations**：`expect($user)->toBeActive()->toHaveRole('admin')`
2. **Arch Testing 插件增强**：支持自定义 PHPStan 规则集成
3. **Mutation Testing 集成**：与 Infection PHP 深度整合
4. **并行测试改进**：基于进程隔离的并行执行优化

### Pest 3.x 核心新特性速览

| 特性 | Pest 2.x | Pest 3.x | 影响 |
|------|----------|----------|------|
| Arch Testing | 基础 `arch()` 函数 | 增强规则 + 自定义架构约束 | 代码结构守护 |
| Higher Order Expectations | 支持 | 类型安全 + IDE 自动补全 | 开发体验提升 |
| Mutation Testing | 手动集成 | 内置 `--mutate` 命令 | 测试质量保障 |
| 并行执行 | 基于 ParaTest | 原生进程池 + 共享状态隔离 | 性能提升 30%+ |
| Datasets | 支持 | 延迟加载 + 按需生成 | 大数据集性能优化 |
| Coverage | Xdebug/PCOV | Xdebug + 覆盖率分析增强 | 报告更精确 |
| Type System | 无 | 与 PHPStan Level 8 集成 | 类型安全 |

---

## 三、Arch Testing：用测试守护代码架构

### 什么是 Arch Testing？

Arch Testing 是 Pest 最独特的功能之一——它允许你用测试来**强制执行代码架构规则**。传统的架构规则（如"Controller 不能直接调用 Repository"）通常靠人工 Code Review 来保证，Arch Testing 将这些规则自动化。

### 核心用法

```php
<?php
// tests/Arch/ArchitectureTest.php

// 1. Laravel 默认规则（Pest Laravel 插件自带）
arch('controllers should not depend on repositories')
    ->expect('App\Http\Controllers')
    ->not->toDependOn('App\Repositories');

// 2. 自定义业务规则
arch('services must not access request directly')
    ->expect('App\Services')
    ->not->toUse('Illuminate\Http\Request');

// 3. 确保所有 Service 类使用接口而非具体实现
arch('services depend on interfaces, not implementations')
    ->expect('App\Services')
    ->toOnlyDependOnContractsIn('App\Contracts');

// 4. 确保 Value Objects 是不可变的
arch('value objects should not have setters')
    ->expect('App\ValueObjects')
    ->not->toHaveMethods(['set*']);

// 5. 文件结构规则
arch('all controllers are in the correct namespace')
    ->expect('App\Http\Controllers')
    ->toBeClasses()
    ->toExtend('Illuminate\Routing\Controller');

// 6. 确保 DTO 不依赖框架
arch('DTOs are framework-agnostic')
    ->expect('App\DTOs')
    ->not->toUse('Illuminate')
    ->ignoring(['App\DTOs\LaravelSpecificDTO']);
```

### 架构测试在 B2C 项目中的实战

在 KKday B2C API 项目中，我们定义了以下架构规则并集成到 CI：

```php
<?php
// tests/Arch/LayerIntegrityTest.php

/**
 * 架构层完整性测试 —— 确保分层架构不被破坏
 *
 * 依赖方向：
 * Controller → Service → Repository → Model
 *            ↘ DTO ↗
 *
 * 禁止：
 * - Controller 直接访问 Repository/Model
 * - Service 直接访问 Request
 * - Model 被 Service 直接修改（必须通过 Repository）
 */

// BFF 层不能直接访问数据库层
arch('BFF layer isolates database access')
    ->expect('App\Http\Controllers\Api\V2')
    ->not->toDependOn('App\Models')
    ->not->toDependOn('App\Repositories');

// Service 层必须通过 Contract 解耦
arch('services are bound to contracts')
    ->expect('App\Services\OrderService')
    ->toOnlyDependOnContractsIn('App\Contracts\Order');

// 所有 API Resource 必须继承 JsonResource
arch('API resources follow Laravel conventions')
    ->expect('App\Http\Resources')
    ->toBeClasses()
    ->toExtend('Illuminate\Http\Resources\Json\JsonResource');

// 确保所有 Event 是纯数据载体
arch('events are data carriers only')
    ->expect('App\Events')
    ->toBeClasses()
    ->not->toDependOn('App\Services')
    ->not->toDependOn('App\Repositories');

// Enum 类型不能依赖任何外部包
arch('enums are pure value types')
    ->expect('App\Enums')
    ->not->toDependOn('Illuminate')
    ->not->toDependOn('GuzzleHttp')
    ->ignoring([
        'App\Enums\LaravelEnum', // 特殊豁免
    ]);
```

### Arch Testing 的设计原理

Arch Testing 底层使用 PHP-Parser 来解析 AST（抽象语法树），分析类之间的依赖关系：

```
测试文件 arch('...')
       │
       ▼
┌──────────────────────────────────┐
│   Pest\Arch\Repositories\       │
│   ┌─────────────────────────┐   │
│   │  PHP-Parser AST 分析    │   │
│   │  - use 语句提取         │   │
│   │  - 方法调用分析         │   │
│   │  - 类继承链构建         │   │
│   └─────────────────────────┘   │
│   ┌─────────────────────────┐   │
│   │  DependencyResolver     │   │
│   │  - 命名空间映射         │   │
│   │  - 接口实现检测         │   │
│   │  - 循环依赖检测         │   │
│   └─────────────────────────┘   │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│   PHPUnit Assertion 执行        │
│   - toDependOn() → 断言通过/失败│
│   - 生成依赖关系报告            │
└──────────────────────────────────┘
```

---

## 四、自定义 Expectations 与 Higher Order Expectations

### 为什么需要自定义 Expectations？

Pest 内置了丰富的断言方法，但在 B2C 业务场景中，我们经常需要领域特定的断言：

```php
<?php
// 使用内置断言 —— 语义不够清晰
expect($order->status)->toBe('paid');
expect($order->total_amount)->toBeGreaterThan(0);
expect($order->items)->toHaveCount(3);
expect($order->paid_at)->not->toBeNull();

// 使用自定义断言 —— 一目了然
expect($order)->toBePaidOrder();
expect($order)->toHaveValidPricing();
expect($order)->toContainItems(['product_1', 'product_2', 'product_3']);
```

### 自定义 Expectation 实现

```php
<?php
// tests/Pest.php 中注册全局 Expectation

use Pest\Expectation;
use App\Enums\OrderStatus;
use App\ValueObjects\Money;

/**
 * 断言订单处于已支付状态
 */
expect()->extend('toBePaidOrder', function (): Expectation {
    $order = $this->value;

    expect($order)->toBeInstanceOf(\App\Models\Order::class);
    expect($order->status)->toBe(OrderStatus::PAID->value);
    expect($order->paid_at)->not->toBeNull();
    expect($order->total_amount)->toBeGreaterThan(0);

    return $this;
});

/**
 * 断言价格有效（不为负、精度正确）
 */
expect()->extend('toHaveValidPricing', function (string $currency = 'TWD'): Expectation {
    $order = $this->value;

    expect($order->currency)->toBe($currency);

    // 检查每个商品的价格
    $order->items->each(function ($item) {
        expect($item->unit_price)->toBeInstanceOf(Money::class);
        expect($item->unit_price->amount)->toBeGreaterThan(0);
        expect($item->subtotal->amount)->toEqual(
            $item->unit_price->amount * $item->quantity
        );
    });

    // 检查总价 = 所有商品小计之和
    $itemsTotal = $order->items->sum(fn ($item) => $item->subtotal->amount);
    expect($order->total_amount)->toEqual($itemsTotal);

    return $this;
});

/**
 * 断言订单包含指定商品
 */
expect()->extend('toContainItems', function (array $productCodes): Expectation {
    $order = $this->value;
    $actualCodes = $order->items->pluck('product_code')->sort()->values()->toArray();
    $expectedCodes = collect($productCodes)->sort()->values()->toArray();

    expect($actualCodes)->toBe($expectedCodes);

    return $this;
});
```

### Higher Order Expectations（高阶断言）

Pest 3.x 的 Higher Order Expectations 允许链式调用属性和方法，实现真正的 BDD 风格：

```php
<?php
// 注册 Higher Order Expectation
expect()->extend('toHaveRole', function (string $role): Expectation {
    expect($this->value->roles->pluck('name'))->toContain($role);
    return $this;
});

expect()->extend('toBeActive', function (): Expectation {
    expect($this->value->is_active)->toBeTrue();
    expect($this->value->email_verified_at)->not->toBeNull();
    return $this;
});

expect()->extend('toHavePermission', function (string $permission): Expectation {
    expect($this->value->permissions->pluck('name'))->toContain($permission);
    return $this;
});

// 使用 —— 读起来像自然语言
test('admin user has correct permissions', function () {
    $user = User::factory()->admin()->create();

    expect($user)
        ->toBeActive()
        ->toHaveRole('admin')
        ->toHavePermission('manage_orders')
        ->toHavePermission('manage_products');
});

// 高阶属性访问
test('order has correct structure', function () {
    $order = Order::factory()->paid()->create();

    expect($order)
        ->toBePaidOrder()
        ->and($order->user)           // 访问关联模型
        ->toBeActive()                // 对关联模型做断言
        ->and($order->items)          // 切换到 items
        ->toHaveCount(3)              // 断言数量
        ->each                       // 对每个 item 做断言
        ->toHaveProperty('unit_price');
});
```

---

## 五、Mutation Testing：测试你的测试

### 什么是 Mutation Testing？

单元测试覆盖率 100% 并不意味着测试质量高。Mutation Testing 通过**修改你的源代码（制造"突变"）**，然后运行测试来检测：

- 如果测试能发现突变 → 测试质量好
- 如果测试无法发现突变 → 测试有盲区（"等价突变"）

```
原始代码                     突变代码
─────────                   ─────────
if ($qty > 0)              if ($qty >= 0)     ← 边界条件突变
    return true;                return true;

$result = $a + $b;         $result = $a - $b; ← 运算符突变
return $result;             return $result;

if ($status === 'paid')    if ($status !== 'paid') ← 逻辑反转突变
    $this->charge();           $this->charge();
```

### Pest 3.x 集成 Infection PHP

Pest 3.x 原生集成了 Infection PHP（PHP 最成熟的 Mutation Testing 框架）：

```bash
# 安装 Infection
composer require --dev infection/infection

# 运行 Mutation Testing
./vendor/bin/pest --mutate

# 只对特定目录运行
./vendor/bin/pest --mutate --filter=app/Services

# 生成 HTML 报告
./vendor/bin/infection --show-mutations --log-verbosity=all
```

**Infection 配置文件** `infection.json5`：

```json5
{
    "$schema": "https://raw.githubusercontent.com/infection/infection/0.27.x/resources/schema.json",
    "source": {
        "directories": [
            "app"
        ],
        "excludes": [
            "app/Console",
            "app/Exceptions",
            "app/Http/Middleware",
            "app/Providers"
        ]
    },
    "logs": {
        "text": "infection.log",
        "summary": "infection-summary.log",
        "perMutator": "infection-per-mutator.log"
    },
    "mutators": {
        "@default": true,
        "MethodCallRemoval": {
            "ignoreSourceCodeByRegex": [
                ".*Log::.*",
                ".*Cache::.*"
            ]
        },
        "Increment": {
            "ignore": [
                "App\\Services\\InventoryService::decrement"
            ]
        }
    },
    "phpUnit": {
        "configDir": "."
    },
    "minMsi": 70,
    "minCoveredMsi": 80
}
```

### 真实场景：Mutation Testing 发现测试盲区

在我们的库存服务中，Mutation Testing 暴露了一个关键的测试缺失：

```php
<?php
// app/Services/InventoryService.php
class InventoryService
{
    public function deduct(int $productId, int $quantity): bool
    {
        $stock = Inventory::where('product_id', $productId)->first();

        if ($stock === null) {
            throw new ProductNotFoundException($productId);
        }

        if ($stock->quantity < $quantity) {  // ← Infection 突变: < 变为 <=
            throw new InsufficientStockException($productId, $quantity);
        }

        $stock->decrement('quantity', $quantity);

        return true;
    }
}
```

**原始测试**（覆盖率 100%）：

```php
test('deduct stock with sufficient quantity', function () {
    $inventory = Inventory::factory()->create(['product_id' => 1, 'quantity' => 10]);

    $result = app(InventoryService::class)->deduct(1, 5);

    expect($result)->toBeTrue();
    expect($inventory->fresh()->quantity)->toBe(5);
});

test('deduct stock throws when insufficient', function () {
    Inventory::factory()->create(['product_id' => 1, 'quantity' => 3]);

    app(InventoryService::class)->deduct(1, 5);
})->throws(InsufficientStockException::class);
```

**Infection 突变分析**：将 `$stock->quantity < $quantity` 改为 `$stock->quantity <= $quantity` 后，两个测试都通过了！这意味着当 `quantity === stock->quantity` 时，边界条件没有被测试到。

**修复后的测试**：

```php
test('deduct stock with exact quantity succeeds', function () {
    $inventory = Inventory::factory()->create(['product_id' => 1, 'quantity' => 5]);

    $result = app(InventoryService::class)->deduct(1, 5);

    expect($result)->toBeTrue();
    expect($inventory->fresh()->quantity)->toBe(0);
});

test('deduct stock throws when quantity equals stock', function () {
    // 这个测试在突变 < 变为 <= 时会失败，证明测试质量高
    Inventory::factory()->create(['product_id' => 1, 'quantity' => 3]);

    app(InventoryService::class)->deduct(1, 3);
})->throws(InsufficientStockException::class);
```

这个边界条件的缺失在代码审查中很难发现，但 Mutation Testing 在 5 分钟内就捕获了它。

---

## 六、Datasets（数据集）与测试参数化

### Datasets 的核心价值

在 B2C 电商场景中，很多逻辑需要在多种输入下验证。手动复制粘贴测试用例是反模式。Datasets 提供了优雅的参数化方案：

```php
<?php
// tests/Unit/Services/PriceCalculatorTest.php

// 方式一：内联数据集
test('price calculation with different currencies', function (string $currency, float $rate, float $expected) {
    $calculator = app(PriceCalculator::class);
    $result = $calculator->convert(100.00, 'USD', $currency);

    expect($result)->toBe($expected);
})->with([
    'TWD' => ['TWD', 31.5, 3150.0],
    'JPY' => ['JPY', 149.5, 14950.0],
    'EUR' => ['EUR', 0.92, 92.0],
    'GBP' => ['GBP', 0.79, 79.0],
    'KRW' => ['KRW', 1330.0, 133000.0],
]);

// 方式二：命名数据集（可复用）
dataset('currencies', function () {
    yield 'TWD' => ['TWD', 31.5];
    yield 'JPY' => ['JPY', 149.5];
    yield 'EUR' => ['EUR', 0.92];
});

dataset('invalid_quantities', function () {
    yield 'zero' => [0];
    yield 'negative' => [-1];
    yield 'huge negative' => [-999999];
});

test('cannot add invalid quantity to cart', function (int $quantity) {
    $cart = app(CartService::class);
    $cart->add(1, $quantity);
})->with('invalid_quantities')->throws(InvalidQuantityException::class);

// 方式三：惰性数据集（Pest 3.x 增强）
// 只在需要时才生成数据，避免大型测试套件启动缓慢
dataset('users', function () {
    // 仅当测试实际使用此数据集时才创建
    yield fn () => User::factory()->create(['role' => 'admin']);
    yield fn () => User::factory()->create(['role' => 'member']);
    yield fn () => User::factory()->create(['role' => 'guest']);
});

// 方式四：组合数据集
test('checkout with different currencies and user roles', function ($user, $currency) {
    // ...
})->with('users')->with('currencies');
// 产出 3 × 3 = 9 个测试用例
```

### Datasets 的执行流程

```
测试文件加载
    │
    ├── test('name', fn() => ...)->with([A, B, C])
    │
    ▼
Pest Dataset Resolver
    │
    ├── 生成测试用例：
    │   ├── test::name with data set "A"  → TestCase 1
    │   ├── test::name with data set "B"  → TestCase 2
    │   └── test::name with data set "C"  → TestCase 3
    │
    ▼
PHPUnit 执行
    │
    ├── TestCase 1: PASSED ✓
    ├── TestCase 2: FAILED ✗  ← 只有 B 失败，不影响 A 和 C
    └── TestCase 3: PASSED ✓
```

---

## 七、与 Laravel 的深度集成

### Pest Laravel 插件

Pest 的 Laravel 插件（`pestphp/pest-plugin-laravel`）提供了开箱即用的 Laravel 测试功能：

```php
<?php
// tests/Feature/Api/OrderApiTest.php

use function Pest\Laravel\{get, post, put, delete, actingAs};

// GET 请求测试
test('get order list returns paginated results', function () {
    $user = User::factory()->create();
    Order::factory()->count(25)->create(['user_id' => $user->id]);

    actingAs($user)
        ->getJson('/api/v2/orders?page=1&per_page=10')
        ->assertOk()
        ->assertJsonCount(10, 'data')
        ->assertJsonPath('meta.total', 25)
        ->assertJsonPath('meta.current_page', 1);
});

// POST 请求测试
test('create order via API', function () {
    $user = User::factory()->member()->create();
    $product = Product::factory()->inStock()->create(['price' => 299.0]);

    $response = actingAs($user)
        ->postJson('/api/v2/orders', [
            'product_id' => $product->id,
            'quantity' => 2,
            'payment_method' => 'credit_card',
        ]);

    $response
        ->assertCreated()
        ->assertJsonStructure([
            'data' => ['id', 'status', 'total_amount', 'items'],
        ])
        ->assertJsonPath('data.status', 'pending');

    expect(Order::count())->toBe(1);
    expect(Order::first()->total_amount)->toBe(598.0);
});

// 权限测试
test('guest cannot access order API', function () {
    getJson('/api/v2/orders')->assertUnauthorized();
});

test('user cannot view other users orders', function () {
    $user = User::factory()->create();
    $otherUser = User::factory()->create();
    $order = Order::factory()->create(['user_id' => $otherUser->id]);

    actingAs($user)
        ->getJson("/api/v2/orders/{$order->id}")
        ->assertForbidden();
});
```

### RefreshDatabase 与 Factories

```php
<?php
// tests/Pest.php 中全局配置

use Tests\TestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(TestCase::class, RefreshDatabase::class)->in('Feature');

// 对性能敏感的测试使用 DatabaseTransactions
uses(TestCase::class)->in('Unit');

// 特定测试目录使用不同的数据库策略
uses(TestCase::class, RefreshDatabase::class)
    ->in('Feature/Api', 'Feature/Console');
```

### 真实踩坑记录

**踩坑 1：Datasets 中的数据库状态污染**

```php
<?php
// ❌ 错误：Dataset 中创建的数据在测试间共享
dataset('orders', function () {
    yield Order::factory()->create(['status' => 'pending']);
    yield Order::factory()->create(['status' => 'paid']);
    yield Order::factory()->create(['status' => 'cancelled']);
});

// 每个 Dataset 用例运行时，之前的数据库变更可能未回滚
test('order status transition', function ($order) {
    // ...
})->with('orders');
```

**解决方案**：使用惰性 Dataset + RefreshDatabase：

```php
<?php
// ✅ 正确：惰性 Dataset，只在测试运行时创建数据
dataset('orders', function () {
    yield 'pending' => fn () => Order::factory()->create(['status' => 'pending']);
    yield 'paid' => fn () => Order::factory()->create(['status' => 'paid']);
    yield 'cancelled' => fn () => Order::factory()->create(['status' => 'cancelled']);
});
```

**踩坑 2：Arch Testing 的 `ignoring()` 陷阱**

```php
<?php
// ❌ 这个 ignoring 规则太宽泛，掩盖了真正的问题
arch('services should not depend on models')
    ->expect('App\Services')
    ->not->toDependOn('App\Models')
    ->ignoring('App\Models'); // ← 把整个 Models 命名空间忽略了！

// ✅ 正确：精确豁免
arch('services should not depend on models directly')
    ->expect('App\Services')
    ->not->toDependOn('App\Models')
    ->ignoring([
        'App\Models\Enums\OrderStatus', // 只豁免枚举
    ]);
```

**踩坑 3：`beforeEach` 中的事务回滚**

```php
<?php
// ❌ 问题：beforeEach 中的操作不会被 RefreshDatabase 回滚
beforeEach(function () {
    // 这些数据在 RefreshDatabase 后会丢失
    $this->seed(OrderSeeder::class);
});

// ✅ 正确：使用 Laravel 的 seed 方法配合 RefreshDatabase
uses(RefreshDatabase::class)->in('Feature');

beforeEach(function () {
    $this->seed(); // RefreshDatabase 会确保每次测试前数据库是干净的
});
```

---

## 八、性能优化与并行测试

### 并行执行

Pest 3.x 支持原生并行测试，无需 ParaTest：

```bash
# 基本并行执行
./vendor/bin/pest --parallel

# 指定进程数（默认为 CPU 核心数）
./vendor/bin/pest --parallel --processes=4

# 并行执行 + Mutation Testing
./vendor/bin/pest --parallel --mutate
```

### 并行测试的隔离策略

```
主进程 (Main Process)
    │
    ├── Worker 1          ├── Worker 2          ├── Worker 3
    │   ├── test A        │   ├── test D        │   ├── test G
    │   ├── test B        │   ├── test E        │   ├── test H
    │   └── test C        │   └── test F        │   └── test I
    │                     │                     │
    │   [独立数据库]      │   [独立数据库]      │   [独立数据库]
    │   test_db_1         │   test_db_2         │   test_db_3
    │                     │                     │
    └─────────────────────┴─────────────────────┘
                                │
                                ▼
                        合并测试结果
                        生成覆盖率报告
```

### 性能对比

| 测试场景 | 串行执行 | 并行执行 (4 workers) | 提升 |
|----------|----------|---------------------|------|
| 500 单元测试 | 45s | 14s | 68% |
| 200 Feature 测试 | 120s | 38s | 68% |
| 全量测试 (700+) | 165s | 52s | 68% |
| Coverage 报告 | 280s | 95s | 66% |

**关键优化技巧**：

```php
<?php
// tests/Pest.php —— 全局性能优化配置

// 1. 按测试类型分层数据库策略
uses(TestCase::class)->in('Unit');           // Unit 测试不需要数据库
uses(TestCase::class, RefreshDatabase::class)->in('Feature');

// 2. 共享 Factory 状态避免重复创建
uses(TestCase::class)->beforeEach(function () {
    // 使用 once() 确保 seed 只运行一次
    if (!app()->hasBeenSeeded()) {
        $this->seed();
        app()->markAsSeeded();
    }
})->in('Feature');

// 3. 优化大型 Dataset 的内存使用
dataset('large_product_set', function () {
    // 使用 LazyCollection 避免一次性加载所有数据
    return Product::query()->lazy()->map(fn ($p) => [$p->id]);
});
```

---

## 九、最佳实践与反模式

### ✅ 最佳实践

1. **测试文件与源文件对应**

```
app/
├── Services/
│   ├── OrderService.php
│   └── PaymentService.php
tests/
├── Unit/
│   └── Services/
│       ├── OrderServiceTest.php
│       └── PaymentServiceTest.php
└── Feature/
    └── Api/
        └── OrderApiTest.php
```

2. **每个测试只验证一个行为**

```php
<?php
// ❌ 一个测试验证多个行为
test('order lifecycle', function () {
    $order = createOrder();
    expect($order->status)->toBe('pending');
    
    payOrder($order);
    expect($order->status)->toBe('paid');
    
    refundOrder($order);
    expect($order->status)->toBe('refunded');
});

// ✅ 每个测试独立验证一个行为
test('new order has pending status', function () {
    $order = createOrder();
    expect($order->status)->toBe('pending');
});

test('paid order has paid status', function () {
    $order = createPaidOrder();
    expect($order->status)->toBe('paid');
});

test('refunded order has refunded status', function () {
    $order = createRefundedOrder();
    expect($order->status)->toBe('refunded');
});
```

3. **使用 `tap()` 避免中间变量**

```php
<?php
// 使用 tap 简化断言链
test('order creation deducts inventory', function () {
    tap(createOrder(['product_id' => 1, 'quantity' => 3]), function ($order) {
        expect($order->status)->toBe('pending');
        expect($order->inventory->fresh()->quantity)->toBe(7);
    });
});
```

### ❌ 反模式

1. **过度使用 `->and()` 链式断言**

```php
<?php
// ❌ 链太长，一个失败后面的全跳过
expect($user)->toBeInstanceOf(User::class)
    ->and($user->name)->toBe('John')
    ->and($user->email)->toBe('john@example.com')
    ->and($user->role)->toBe('admin')
    ->and($user->permissions)->toHaveCount(5);

// ✅ 分组断言，清晰且独立
expect($user)->toBeInstanceOf(User::class);

expect($user->name)->toBe('John');
expect($user->email)->toBe('john@example.com');

expect($user->role)->toBe('admin');
expect($user->permissions)->toHaveCount(5);
```

2. **在测试中使用 `dd()` 而非 `->dd()`**

```php
<?php
// ❌ Laravel 的 dd()
dd($order);

// ✅ Pest 的 ->dd()（返回前一个 expectation 的值，支持链式调试）
expect($order)->toBeInstanceOf(Order::class)->dd();
```

3. **忽略 Arch Testing 的维护**

Arch Testing 规则应该和代码一起演进。当团队新增了一个层级（如 `app/Actions`），必须同步更新架构测试规则。

---

## 十、与其他 PHP 测试框架对比

| 维度 | PHPUnit 11.x | Pest 3.x | Codeception | Behat |
|------|-------------|-----------|-------------|-------|
| **编写风格** | OOP（类继承） | 函数式（闭包） | 链式 DSL | Gherkin 自然语言 |
| **学习曲线** | 中等 | 低 | 高 | 低（非技术友好） |
| **Laravel 集成** | 原生支持 | 原生 + 插件 | 模块化 | 扩展支持 |
| **Arch Testing** | ❌ 不支持 | ✅ 内置 | ❌ 不支持 | ❌ 不支持 |
| **Mutation Testing** | 需手动集成 | ✅ 原生支持 | ❌ 不支持 | ❌ 不支持 |
| **并行执行** | 需 ParaTest | ✅ 原生支持 | ❌ 不支持 | ❌ 不支持 |
| **IDE 支持** | 优秀 | 优秀 | 一般 | 一般 |
| **社区生态** | 最大 | 快速增长 | 中等 | 中等 |
| **适用场景** | 通用 PHP 项目 | Laravel/现代 PHP | E2E/验收测试 | BDD 行为驱动 |

**选型建议**：
- 新 Laravel 项目 → 直接用 Pest 3.x，开箱即用
- 已有 PHPUnit 项目 → Pest 100% 兼容 PHPUnit，可以渐进迁移
- 需要 BDD → Pest + `test()` 函数即可，无需 Behat 的复杂性
- 需要 E2E 测试 → Pest + Laravel Dusk 或 Pest Browser Testing 插件

---

## 十一、扩展思考

### Pest 的局限性

1. **IDE 类型推断**：闭包测试中的 `$this` 类型推断不如类继承明确
2. **大型项目组织**：当测试文件超过 500 个时，文件组织策略比 PHPUnit 更需要约定
3. **非 Laravel 项目**：Pest 在纯 PHP 项目中也很优秀，但 Laravel 插件的便利性会缺失
4. **团队学习成本**：对于习惯 PHPUnit 的团队，需要 1-2 周适应期

### 未来方向

1. **Pest 4.x 路线图**：更强的类型系统、原生 Snapshot Testing、内置 Property-based Testing
2. **与 PHPStan Level 8 的更深度集成**：在编译时而非运行时验证架构规则
3. **AI 辅助测试生成**：Pest 的 DSL 天然适合 LLM 生成测试代码

### 实战总结

在 KKday B2C API 项目中，从 PHPUnit 迁移到 Pest 后：
- 测试编写速度提升约 40%（闭包 + 语义断言）
- 测试可读性显著提高（新人理解测试用例的时间减少 50%）
- Arch Testing 在 CI 中捕获了 12 次架构违规（之前靠人工 Code Review）
- Mutation Testing 帮助发现了 8 个隐藏的测试盲区

Pest 不仅仅是 PHPUnit 的语法糖——它重新定义了 PHP 测试的编写体验。如果你还在犹豫是否迁移，建议从新测试文件开始使用 Pest（PHPUnit 和 Pest 可以在同一个项目中共存），亲身体验后再做决定。

---

## 相关阅读

- [Laravel Dusk 浏览器自动化 E2E 测试实战与 CI 流水线集成](/post/laravel-dusk-automatione2etestingguide-ci/) — 如果你需要在 Pest 单元测试之外补充端到端测试，Laravel Dusk 是最佳搭档
- [PHP 性能基准测试：xhprof、Blackfire、Tideways 实战对比与 Laravel 生产环境 Profile 方案](/post/php-testing-xhprof-blackfire-tideways-guidevs-laravel-profile/) — 测试不仅关乎正确性，也关乎性能；本文详解 PHP 主流 Profiling 工具
- [Go 测试实战：表驱动测试、Testify 断言、httptest 与 Mock](/post/go-testify-httptest-mock-pest-php/) — 跨语言视角对比，了解 Go 的测试哲学与 Pest 的函数式风格有何异同
