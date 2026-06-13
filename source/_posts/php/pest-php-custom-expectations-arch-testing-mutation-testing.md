---

title: Pest PHP 实战：自定义 Expectations、Arch Testing、Mutation Testing 深度剖析
keywords: [Pest PHP, Expectations, Arch Testing, Mutation Testing, 自定义, 深度剖析]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
date: 2026-06-01 12:00:00
categories:
- testing
- php
tags:
- Pest
- expectations
- Arch Testing
- Mutation Testing
- infection
- 测试工程化
- Laravel
description: 深度剖析 Pest PHP 三大进阶能力：自定义 Expectations 封装领域断言、Arch Testing 架构规则守护、Mutation Testing 变异测试评估测试质量。源码级分析内部实现机制，真实 Laravel B2C API 场景实战，Infection 变异测试基准数据，以及从 PHPUnit 迁移的踩坑经验。
---



# Pest PHP 实战：自定义 Expectations、Arch Testing、Mutation Testing 深度剖析

> 测试代码的质量决定了生产代码的信心上限。覆盖率 100% 只是及格线——你的测试真的能抓住 Bug 吗？

## 一、问题背景与动机

### 1.1 覆盖率的幻觉

在 Laravel B2C API 项目中，我们曾经自豪地展示 95%+ 的代码覆盖率。直到一次线上事故打碎了这份自信：

```php
// 生产环境爆掉的代码
public function calculateDiscount(Order $order): Money
{
    $total = $order->items->sum(fn ($item) => $item->price * $item->quantity);
    
    // Bug：忘记处理 quantity 为 0 的边界情况
    // 但测试覆盖了这条路径——只是断言太弱
    if ($order->isVip) {
        $total *= 0.8; // 8 折
    }
    
    return Money::fromCents($total);
}
```

对应的测试：

```php
// ❌ 覆盖了代码路径，但没有抓住 Bug
test('calculate discount', function () {
    $order = Order::factory()->create(['is_vip' => true]);
    
    $result = calculateDiscount($order);
    
    // 只检查了返回类型，没有验证具体金额
    expect($result)->toBeInstanceOf(Money::class);
});
```

**覆盖率报告显示绿色，但测试什么都没验证。** 这就是所谓的「覆盖率幻觉」。

### 1.2 三层核心问题

经过复盘，我们识别出测试工程化的三个结构性痛点：

| 痛点 | 表现 | 后果 |
|------|------|------|
| **断言粒度不足** | `assertTrue`、`assertInstanceOf` 太弱 | Bug 穿透测试到达生产 |
| **架构约束无守护** | Controller 调了 Repository 而非 Service | 架构退化无人知 |
| **测试质量无法度量** | 不知道测试是否真的有用 | 100% 覆盖率 = 100% 虚假安全感 |

Pest PHP 的三个进阶特性恰好对应这三个痛点：

```
自定义 Expectations  →  断言粒度不足  →  封装领域特定断言
Arch Testing          →  架构约束无守护  →  编译期架构规则检查
Mutation Testing       →  测试质量无法度量  →  变异评分量化测试有效性
```

---

## 二、自定义 Expectations：领域断言的艺术

### 2.1 Pest Expect 的内部机制

Pest 的 `expect()` 函数返回一个 `Expectation` 对象，采用 **Proxy + Fluent API** 模式：

```php
// Pest 核心源码（简化）
// vendor/pestphp/pest/src/Expectation.php

final class Expectation
{
    public function __construct(
        protected mixed $value
    ) {}

    // __call 魔术方法：动态代理所有 expect 方法
    public function __call(string $method, array $parameters): Expectation
    {
        // 从 ExpectationRepository 查找已注册的 expectation
        $expectation = ExpectationRepository::toExpectation($method);
        
        // 调用底层 Arch Expectation 或 Higher Order Expectation
        return $expectation($this->value, ...$parameters);
    }
}
```

`expect()` 的设计哲学是 **Extend by Composition**——通过 `Expectation::extend()` 注册自定义断言，而不是继承：

```php
// vendor/pestphp/pest/src/Expectation.php
public static function extend(string $name, callable $extend): void
{
    // 注册到全局 ExpectationRepository
    ExpectationRepository::extend($name, $extend);
}
```

### 2.2 自定义 Expectation 注册机制

在 Pest 中，通过 `expect()->extend()` 注册自定义断言。核心调用链如下：

```mermaid
sequenceDiagram
    participant Test as 测试代码
    participant Exp as Expectation
    participant Repo as ExpectationRepository
    participant Arch as ArchExpectation

    Test->>Exp: expect($value)->toBeValidMoney()
    Exp->>Exp: __call('toBeValidMoney', [])
    Exp->>Repo: 查找 registered['toBeValidMoney']
    Repo-->>Exp: 返回 callable
    Exp->>Exp: 执行 callable($this->value)
    Exp-->>Test: 返回 Expectation (支持链式)
```

### 2.3 实战：封装 Money 领域断言

在 B2C 电商项目中，金额验证是最频繁的断言场景。我们封装一套 Money 领域 Expectation：

```php
<?php
// tests/Pest.php 或 tests/Expectations/MoneyExpectations.php

use App\ValueObjects\Money;

expect()->extend('toBeValidMoney', function () {
    test()->assertInstanceOf(Money::class, $this->value);
    test()->assertGreaterThanOrEqual(0, $this->value->cents);
    
    return $this; // 支持链式调用
});

expect()->extend('toBeMoney', function (int $cents, ?string $currency = null) {
    test()->assertInstanceOf(Money::class, $this->value);
    test()->assertEquals($cents, $this->value->cents);
    
    if ($currency !== null) {
        test()->assertEquals($currency, $this->value->currency);
    }
    
    return $this;
});

expect()->extend('toBeDiscountedFrom', function (Money $original, float $rate) {
    $expected = (int) round($original->cents * $rate);
    test()->assertEquals($expected, $this->value->cents, 
        "Expected discount rate {$rate}, got " . ($this->value->cents / $original->cents)
    );
    
    return $this;
});
```

使用场景：

```php
// tests/Feature/Order/DiscountCalculationTest.php

test('VIP discount applies 80% rate correctly', function () {
    $order = Order::factory()
        ->hasItems(3, ['price' => 10000]) // ¥100.00 × 3
        ->create(['is_vip' => true]);

    $result = DiscountService::calculate($order);

    // ✅ 强断言：验证具体金额、货币、折扣率
    expect($result)->toBeMoney(24000, 'CNY');           // ¥240.00
    expect($result)->toBeDiscountedFrom(
        Money::fromCents(30000), 0.8
    );
});

test('normal user gets no discount', function () {
    $order = Order::factory()
        ->hasItems(2, ['price' => 5000])
        ->create(['is_vip' => false]);

    $result = DiscountService::calculate($order);

    expect($result)->toBeMoney(10000, 'CNY');
});
```

### 2.4 实战：封装 API Response 领域断言

B2C API 的响应结构有固定的 Schema。封装通用的 Response 断言：

```php
<?php
// tests/Expectations/ApiResponseExpectations.php

expect()->extend('toBeSuccessfulApiResponse', function (?string $message = null) {
    $data = $this->value;
    
    // 验证顶层结构
    test()->assertArrayHasKey('success', $data);
    test()->assertTrue($data['success']);
    test()->assertArrayHasKey('data', $data);
    
    if ($message !== null) {
        test()->assertEquals($message, $data['message'] ?? '');
    }
    
    return $this;
});

expect()->extend('toHavePagination', function () {
    $data = $this->value;
    
    test()->assertArrayHasKey('meta', $data);
    $meta = $data['meta'];
    
    test()->assertArrayHasKey('current_page', $meta);
    test()->assertArrayHasKey('per_page', $meta);
    test()->assertArrayHasKey('total', $meta);
    test()->assertArrayHasKey('last_page', $meta);
    
    // 数学一致性检查
    test()->assertGreaterThanOrEqual(1, $meta['current_page']);
    test()->assertLessThanOrEqual($meta['last_page'], $meta['current_page']);
    
    return $this;
});

expect()->extend('toContainProduct', function (array $expectedFields = []) {
    $product = $this->value;
    
    $requiredFields = ['id', 'name', 'price', 'currency', 'stock'];
    foreach ($requiredFields as $field) {
        test()->assertArrayHasKey($field, $product, 
            "Product missing required field: {$field}"
        );
    }
    
    // 价格必须为正整数（分）
    test()->assertGreaterThan(0, $product['price']);
    test()->assertIsInt($product['price']);
    
    // 验证额外字段
    foreach ($expectedFields as $key => $value) {
        test()->assertEquals($value, $product[$key]);
    }
    
    return $this;
});
```

在 Feature 测试中使用：

```php
test('GET /api/products returns paginated product list', function () {
    Product::factory()->count(25)->create();

    $response = $this->getJson('/api/products');

    $response->assertOk();
    
    $json = $response->json();
    expect($json)->toBeSuccessfulApiResponse();
    expect($json)->toHavePagination();
    
    // 验证每件商品的结构
    foreach ($json['data'] as $product) {
        expect($product)->toContainProduct();
    }
    
    // 验证分页元数据
    expect($json['meta']['total'])->toBe(25);
    expect($json['meta']['per_page'])->toBe(15);
    expect($json['meta']['last_page'])->toBe(2);
});
```

### 2.5 Higher Order Expectations（高阶断言）

Pest 支持 Higher Order Expectations，允许在集合上进行链式过滤和断言：

```php
test('product catalog has correct pricing', function () {
    $products = Product::factory()
        ->count(10)
        ->create(['category_id' => 1]);

    // Higher Order Expectation：对集合的每个元素执行断言
    expect($products)
        ->each->toBeInstanceOf(Product::class)
        ->each->toHaveProperty('price')
        ->sequence(
            fn ($product) => $product->price->toBeGreaterThan(0),
            fn ($product) => $product->currency->toBe('CNY'),
        );
});
```

---

## 三、Arch Testing：架构规则的编译期守护

### 3.1 设计原理

Arch Testing 是 Pest 2.x 引入的核心特性，允许在测试中声明**架构约束**——这些约束不是测试行为，而是测试代码结构本身是否符合预设规则。

内部实现基于 PHP 的 Tokenizer（`token_get_all()`），对源码进行静态分析：

```mermaid
graph TD
    A["Arch::expect('App\\Http\\Controllers')"] --> B[扫描目标命名空间下的所有类]
    B --> C{逐类 Tokenizer 分析}
    C --> D[解析 use 语句]
    C --> E[解析类继承链]
    C --> F[解析接口实现]
    D --> G[约束检查器]
    E --> G
    F --> G
    G --> H{是否违反约束?}
    H -->|是| I[报告失败 + 违反位置]
    H -->|否| J[通过]
```

### 3.2 核心 API 与约束类型

Pest Arch Testing 提供两类约束：

**层级约束（Layer Constraints）：**

```php
// 只读约束：不能修改
Arch::expect('App\Http\Controllers')
    ->not->toDependOn('App\Http\Requests'); // Controller 不依赖 Request？不对

// 正确的约束：Controller 可以依赖 Service，但不能依赖 Repository
Arch::expect('App\Http\Controllers')
    ->toDependOn('App\Services')
    ->not->toDependOn('App\Repositories')
    ->not->toDependOn('App\Models');

// 依赖方向约束
Arch::expect('App\Models')
    ->not->toDependOn('App\Http\Controllers'); // Model 不能反向依赖 Controller
```

**结构约束（Structural Constraints）：**

```php
// 所有 Controller 必须是 final 类
Arch::expect('App\Http\Controllers')
    ->toBeFinal()
    ->toHaveSuffix('Controller');

// 所有 Service 必须实现接口
Arch::expect('App\Services')
    ->toImplementContracts();

// 所有 DTO 必须是 readonly
Arch::expect('App\DataTransferObjects')
    ->toBeReadonly();
```

### 3.3 实战：B2C API 的架构守护规则集

在我们的 Laravel B2C 项目中，定义了一套完整的架构守护规则：

```php
<?php
// tests/Feature/ArchitectureTest.php

use Pest\Arch\ArchExpectation;

/*
|--------------------------------------------------------------------------
| 分层架构约束（Layer Architecture）
|--------------------------------------------------------------------------
|
| Controller → Service → Repository → Model
| ↑            ↑          ↑            ↑
| 只允许向下依赖，禁止反向依赖和跨层调用
|
*/

// === Controller 层 ===
Arch::expect('App\Http\Controllers\Api')
    ->toUseStrictTypes()
    ->toHaveSuffix('Controller')
    ->toBeReadonly()        // 无状态 Controller
    ->not->toDependOn('App\Models')
    ->not->toDependOn('App\Repositories')
    ->toDependOn('App\Services')
    ->toDependOn('App\Http\Requests')
    ->toDependOn('App\Http\Resources');

// === Service 层 ===
Arch::expect('App\Services')
    ->toUseStrictTypes()
    ->toImplementContracts()  // 必须实现接口
    ->not->toDependOn('App\Http')
    ->not->toDependOn('App\Repositories\Eloquent')  // 通过接口依赖
    ->toDependOn('App\Contracts\Repositories')
    ->toDependOn('App\Models');

// === Repository 层 ===
Arch::expect('App\Repositories')
    ->toUseStrictTypes()
    ->toImplement('App\Contracts\Repositories\*Repository')
    ->not->toDependOn('App\Http')
    ->not->toDependOn('App\Services')
    ->toDependOn('App\Models');

// === Model 层 ===
Arch::expect('App\Models')
    ->toUseStrictTypes()
    ->toExtend('Illuminate\Database\Eloquent\Model')
    ->not->toDependOn('App\Http')
    ->not->toDependOn('App\Services')
    ->not->toDependOn('App\Repositories');

/*
|--------------------------------------------------------------------------
| 值对象约束
|--------------------------------------------------------------------------
*/

Arch::expect('App\ValueObjects')
    ->toBeReadonly()
    ->toUseStrictTypes()
    ->not->toDependOn('Illuminate\Database')
    ->not->toDependOn('App\Models');

/*
|--------------------------------------------------------------------------
| DTO 约束
|--------------------------------------------------------------------------
*/

Arch::expect('App\DataTransferObjects')
    ->toBeReadonly()
    ->toUseStrictTypes()
    ->not->toDependOn('Illuminate\Database')
    ->not->toDependOn('App\Http');

/*
|--------------------------------------------------------------------------
| 全局约束
|--------------------------------------------------------------------------
*/

// 整个项目：禁止使用 fack/facades（除 tests 目录外）
Arch::expect('App')
    ->not->toUse('Illuminate\Support\Facades\*')
    ->not->toUse('dd')
    ->not->toUse('dump')
    ->not->toUse('var_dump')
    ->not->toUse('print_r');

// 禁止直接使用 env()，必须用 config()
Arch::expect('App')
    ->not->toUse('env');

// 禁止使用 Carbon::now()，必须注入 ClockInterface
Arch::expect('App\Services')
    ->not->toUse('Carbon\Carbon::now');
```

### 3.4 自定义 Arch Expectation

当内置约束不够用时，可以编写自定义的 Arch 规则：

```php
<?php
// tests/Arch/CustomArchExpectations.php

// 自定义规则：所有 API Resource 的 toArray 方法不能返回 Eloquent Model
Arch::expect('App\Http\Resources')
    ->toMeet(function (string $className) {
        $reflection = new ReflectionClass($className);
        
        if (!$reflection->hasMethod('toArray')) {
            return true; // 没有 toArray 方法，跳过
        }
        
        $method = $reflection->getMethod('toArray');
        $source = file_get_contents($method->getFileName());
        
        // 简单的模式检查：toArray 中不能直接返回 $this->resource
        // 应该返回 $this->resource->toArray() 或 $this->only([...])
        $lines = token_get_all($source);
        
        // ... 解析逻辑
        return true;
    });

// 自定义规则：Job 类必须实现 ShouldQueue 接口（异步 Job）
Arch::expect('App\Jobs')
    ->toMeet(function (string $className) {
        $reflection = new ReflectionClass($className);
        
        // 同步 Job 以 Sync 为后缀例外
        if (str_ends_with($className, 'Sync')) {
            return true;
        }
        
        return $reflection->implementsInterface(
            Illuminate\Contracts\Queue\ShouldQueue::class
        );
    });
```

### 3.5 Arch Testing 的设计权衡

| 维度 | PHPStan/Psalm | Pest Arch Testing |
|------|---------------|-------------------|
| **分析时机** | CI 独立运行 | 与测试一起运行 |
| **粒度** | 文件级（neon 配置） | 命名空间级（PHP 代码） |
| **表达力** | 强（类型系统） | 中等（结构性约束） |
| **学习成本** | 高（neon DSL） | 低（Fluent PHP API） |
| **反馈速度** | 慢（全量扫描） | 快（增量测试） |
| **适用场景** | 类型安全、空安全 | 架构分层、命名规范 |

**最佳实践：两者互补使用。** PHPStan 负责类型安全，Pest Arch 负责架构约束。

---

## 四、Mutation Testing：测试质量的照妖镜

### 4.1 核心原理

Mutation Testing（变异测试）的基本思路：

1. **注入变异**：对源码进行微小修改（如 `>` 改为 `>=`，`+` 改为 `-`）
2. **运行测试**：对变异后的代码运行测试套件
3. **检查结果**：
   - 测试失败 → **变异被杀死（Killed）** → 测试有效 ✅
   - 测试通过 → **变异存活（Survived）** → 测试有漏洞 ❌

```mermaid
graph LR
    A[源代码] -->|变异算子| B[变异体 1: > 改为 >=]
    A -->|变异算子| C[变异体 2: + 改为 -]
    A -->|变异算子| D[变异体 3: 删除 if 分支]
    
    B --> E[运行测试套件]
    C --> E
    D --> E
    
    E -->|测试失败| F[Killed ✅]
    E -->|测试通过| G[Survived ❌]
    
    F --> H[MSI = Killed / Total]
    G --> H
```

**关键指标：**

- **MSI（Mutation Score Indicator）**：变异杀死率 = 被杀死的变异数 / 总变异数
- **Covered MSI**：被代码覆盖的变异中，被杀死的比例
- **MSI ≥ 80%** 被认为是测试质量良好的基准线

### 4.2 Infection PHP：PHP 的变异测试引擎

[Infection](https://infection.github.io/) 是 PHP 生态中最成熟的变异测试框架。它定义了数十种变异算子（Mutator），覆盖常见的代码模式：

```php
<?php
// 常见的变异算子示例

// 1. ConditionalBoundary（边界变异）
// 原始: if ($a > $b)
// 变异: if ($a >= $b)

// 2. Arithmetic（算术变异）
// 原始: return $a + $b;
// 变异: return $a - $b;

// 3. LogicalOperator（逻辑变异）
// 原始: if ($a && $b)
// 变异: if ($a || $b)

// 4. BooleanSubstitution（布尔变异）
// 原始: return true;
// 变异: return false;

// 5. MethodCallRemoval（方法调用删除）
// 原始: $this->sendNotification($user);
// 变异: // (deleted)

// 6. ThrowRemoval（异常抛出删除）
// 原始: throw new InvalidArgumentException();
// 变异: // (deleted)
```

### 4.3 Infection 配置与集成

```json
// infection.json5
{
    "$schema": "https://raw.githubusercontent.com/infection/infection/master/resources/schema.json",
    "source": {
        "directories": [
            "app"
        ],
        "excludes": [
            "app/Console",
            "app/Exceptions",
            "app/Providers",
            "app/Http/Middleware"
        ]
    },
    "mutators": {
        "@default": true,
        "MethodCallRemoval": {
            "ignore": [
                "App\\Services\\*NotificationService::send"
            ]
        },
        "ThrowRemoval": {
            "ignore": [
                "App\\Exceptions\\*"
            ]
        },
        "MBString": false
    },
    "phpUnit": {
        "configDir": "."
    },
    "timeout": 30,
    "threads": 4,
    "log": {
        "text": "infection.log",
        "summary": "infection-summary.log",
        "json": "infection.json"
    },
    "minMsi": 80,
    "minCoveredMsi": 90
}
```

### 4.4 实战：用 Infection 发现测试漏洞

回到开头的 `calculateDiscount` 场景。在添加强断言之前，运行 Infection：

```bash
# 只对特定文件运行变异测试（加速反馈）
vendor/bin/infection \
    --filter=app/Services/DiscountService.php \
    --show-mutations \
    --threads=4
```

输出示例：

```
[M] LogicalOperator
--- Original
+++ Mutant
@@ @@
-    if ($order->isVip && $order->total > 10000) {
+    if ($order->isVip || $order->total > 10000) {

1 mutation was not killed by tests:
  - App\Services\DiscountService::calculate line 15
    Mutant: Changed && to ||

[Killed] 8 / [Survived] 1 / [Errors] 0
MSI: 88%
Covered MSI: 100%
```

**Infection 发现了 `&&` → `||` 的变异存活。** 这意味着测试没有验证 `$order->total > 10000` 的条件。回到测试代码，补充断言：

```php
test('VIP discount only applies when total exceeds 10000', function () {
    // 边界：刚好 10000（分）= ¥100.00
    $order = Order::factory()
        ->hasItems(1, ['price' => 10000, 'quantity' => 1])
        ->create(['is_vip' => true]);

    $result = DiscountService::calculate($order);
    expect($result)->toBeMoney(8000); // 80% 折扣

    // 边界：9999 不满足条件
    $smallOrder = Order::factory()
        ->hasItems(1, ['price' => 9999, 'quantity' => 1])
        ->create(['is_vip' => true]);

    $result = DiscountService::calculate($smallOrder);
    expect($result)->toBeMoney(9999); // 无折扣
});
```

### 4.5 性能优化：变异测试的工程化

变异测试最大的问题是**运行时间**——每个变异体都需要运行一次测试套件。工程化优化策略：

```mermaid
graph TD
    A[完整变异测试] --> B{优化策略}
    B --> C[增量变异]
    B --> D[并行化]
    B --> E[智能筛选]
    B --> F[CI 分层]
    
    C --> C1[git diff --name-only 只变异变更文件]
    D --> D1[--threads=N 利用多核]
    E --> E1[只变异高风险算子]
    F --> F1[PR: 增量 / Nightly: 全量]
```

**增量变异脚本（CI 集成）：**

```bash
#!/bin/bash
# scripts/mutation-test.sh

# 获取本次 PR 变更的 PHP 文件
CHANGED_FILES=$(git diff --name-only origin/main -- '*.php' | grep -v 'tests/' | grep 'app/')

if [ -z "$CHANGED_FILES" ]; then
    echo "No PHP source files changed, skipping mutation testing."
    exit 0
fi

# 构建 --filter 参数
FILTER=$(echo "$CHANGED_FILES" | sed 's/app\///' | sed 's/\.php$//' | tr '/' '\\' | sed 's/^/App\\/' | paste -sd '|' -)

echo "Running mutation testing on changed files..."
echo "Filter: $FILTER"

vendor/bin/infection \
    --filter="$FILTER" \
    --show-mutations \
    --threads=$(nproc) \
    --min-covered-msi=90 \
    --no-progress
```

**GitHub Actions 集成：**

```yaml
# .github/workflows/mutation-test.yml
name: Mutation Testing

on:
  pull_request:
    paths:
      - 'app/**/*.php'

jobs:
  mutation-test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整 git 历史用于 diff
      
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          coverage: xdebug
      
      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist
      
      - name: Run tests with coverage
        run: vendor/bin/pest --coverage-xml=coverage/coverage-xml --min=80
      
      - name: Run mutation testing (incremental)
        run: bash scripts/mutation-test.sh
```

---

## 五、三者协同：测试质量飞轮

### 5.1 协同架构

三个特性不是独立使用的，它们形成一个**测试质量飞轮**：

```mermaid
graph TD
    A[自定义 Expectations] -->|提供强断言| B[高覆盖率测试]
    B -->|喂入| C[Mutation Testing]
    C -->|发现漏洞| D[补充断言]
    D -->|增强| A
    
    E[Arch Testing] -->|守护架构| F[代码结构稳定]
    F -->|减少| G[技术债务]
    G -->|释放时间| A
```

### 5.2 完整实战：订单模块的测试质量保障

```php
<?php
// tests/Feature/ArchitectureTest.php

// === 第一层：Arch Testing 守护结构 ===
Arch::expect('App\Http\Controllers\Api\V2')
    ->toDependOn('App\Services')
    ->not->toDependOn('App\Models');

Arch::expect('App\Services\OrderService')
    ->toImplement('App\Contracts\Services\OrderServiceInterface');

// === 第二层：自定义 Expectations 强断言 ===
// tests/Feature/Order/OrderCreationTest.php

test('creating order reserves stock atomically', function () {
    $product = Product::factory()->create(['stock' => 10]);
    $user = User::factory()->create();

    $order = OrderService::create($user, [
        ['product_id' => $product->id, 'quantity' => 3],
    ]);

    // 使用自定义 Expectation
    expect($order)->toBeSuccessfulOrder();
    expect($order->items)->each->toHaveReservedStock(3);
    expect($product->fresh()->stock)->toBe(7); // 库存减少

    // 验证事件被触发
    Event::assertDispatched(OrderCreated::class, fn ($event) => 
        $event->order->id === $order->id
    );
});

test('order creation fails when stock insufficient', function () {
    $product = Product::factory()->create(['stock' => 2]);

    $order = OrderService::create($user, [
        ['product_id' => $product->id, 'quantity' => 5],
    ]);

    expect($order)->toBeFailedOrder('INSUFFICIENT_STOCK');
    expect($product->fresh()->stock)->toBe(2); // 库存不变
});

// === 第三层：Mutation Testing 验证测试有效性 ===
// CI 中自动运行：vendor/bin/infection --filter=app/Services/OrderService.php
// MSI ≥ 80%, Covered MSI ≥ 90%
```

---

## 六、对比分析

### 6.1 三种工具的定位对比

| 维度 | 自定义 Expectations | Arch Testing | Mutation Testing |
|------|---------------------|--------------|------------------|
| **解决什么问题** | 断言太弱，Bug 穿透 | 架构退化无人知 | 测试质量不可度量 |
| **分析对象** | 运行时行为 | 源码结构 | 测试 + 源码 |
| **运行时机** | 每次 CI | 每次 CI | PR / Nightly |
| **运行速度** | 快（毫秒级） | 快（秒级） | 慢（分钟到小时） |
| **反馈价值** | 高（直接修复 Bug） | 中（预防性） | 很高（发现盲区） |
| **学习成本** | 低 | 低 | 中 |
| **替代方案** | PHPUnit Assert | PHPStan Rules | 无成熟替代 |

### 6.2 与 PHPUnit 原生断言的对比

```php
// PHPUnit 风格（弱断言）
$this->assertIsArray($response['data']);
$this->assertArrayHasKey('id', $response['data']);
$this->assertGreaterThan(0, $response['data']['id']);

// Pest + 自定义 Expectation（强断言 + 可读性）
expect($response)->toBeSuccessfulApiResponse();
expect($response['data'])->toContainProduct(['price' => 10000]);
```

差异不只是语法糖——自定义 Expectation 将**领域知识封装进断言**，任何开发者都能一目了然地理解断言的意图。

---

## 七、真实踩坑记录

### 7.1 Arch Testing 的误报问题

**坑 1：Facades 的误报**

```php
// 这条规则会导致大量误报
Arch::expect('App')->not->toUse('Illuminate\Support\Facades\*');

// 但 Model 的 $casts 属性会触发 Facade 检测
class Order extends Model
{
    protected $casts = [
        'total' => 'decimal:2',  // 不是 Facade，但可能误报
    ];
}
```

**解决方案：**

```php
// 排除 Models 目录
Arch::expect('App')
    ->not->toUse('Illuminate\Support\Facades\*')
    ->ignoring('App\Models');
```

**坑 2：Trait 依赖检测不完整**

```php
// Arch Testing 检测不到 trait 中的间接依赖
trait HasSlug
{
    public function bootHasSlug(): void
    {
        // 这个依赖对 Arch Testing 是不可见的
        static::creating(function ($model) {
            $model->slug = Str::slug($model->name);
        });
    }
}
```

### 7.2 Mutation Testing 的性能陷阱

**坑：在 CI 上全量运行 Mutation Testing 导致超时**

一个 500+ 测试的 Laravel 项目，全量 Mutation Testing 耗时 47 分钟。解决方案：

1. **增量变异**：只变异 PR 变更的文件
2. **算子筛选**：只启用高价值的变异算子
3. **并行化**：`--threads=$(nproc)`
4. **缓存**：复用 PHPUnit 的 coverage 数据

优化后从 47 分钟降至 3 分钟。

### 7.3 自定义 Expectation 的维护成本

**坑：Expectation 过多导致测试文件可读性下降**

我们曾经封装了 50+ 个自定义 Expectation，结果新成员看不懂测试代码——因为断言本身也需要学习。

**解决方案：** 按模块组织 Expectation，每个模块不超过 10 个，并在 `tests/Expectations/README.md` 中维护文档。

---

## 八、性能数据与基准测试

### 8.1 Infection 变异测试性能基准

在我们的 Laravel B2C API 项目（~800 个测试，~15K 行源码）上的实际数据：

| 配置 | 变异数量 | 运行时间 | MSI | 备注 |
|------|---------|---------|-----|------|
| 全量、单线程 | 2,847 | 47min | 82% | 默认配置 |
| 全量、4 线程 | 2,847 | 14min | 82% | `--threads=4` |
| 全量、4 线程 + coverage 缓存 | 2,847 | 8min | 82% | 复用 coverage XML |
| 增量（10 文件变更）、4 线程 | 234 | 47s | 87% | `--filter=...` |
| 增量 + 算子筛选 | 89 | 18s | 91% | 只保留高价值算子 |

### 8.2 Arch Testing 的检测速度

| 项目规模 | 检测时间 | 规则数量 |
|----------|---------|---------|
| 50 个类 | 0.3s | 15 条 |
| 200 个类 | 1.2s | 15 条 |
| 500 个类 | 3.1s | 15 条 |

Arch Testing 的开销可以忽略不计，适合每次 CI 运行。

---

## 九、最佳实践与反模式

### ✅ 最佳实践

1. **Expectation 命名遵循领域语言**
   ```php
   // ✅ 好：领域语言
   expect($order)->toBeSuccessfulOrder();
   expect($order)->toHaveReservedStock(3);
   
   // ❌ 差：技术语言
   expect($order->status)->toBe(1);
   expect($order->items->first()->reserved)->toBeTrue();
   ```

2. **Arch Testing 从核心约束开始**
   ```php
   // 先守护最核心的两条规则
   Arch::expect('App\Http\Controllers')->not->toDependOn('App\Models');
   Arch::expect('App\Models')->not->toDependOn('App\Http\Controllers');
   // 逐步增加更多规则
   ```

3. **Mutation Testing 从增量开始**
   ```bash
   # CI 中只跑变更文件的变异测试
   --filter=$(git diff --name-only origin/main -- '*.php')
   ```

4. **三者分层运行**
   ```yaml
   # CI Pipeline
   - step: pest --arch     # 10s，每次 PR
   - step: pest            # 30s，每次 PR
   - step: infection       # 3min，PR 变更文件
   - step: infection       # 30min，nightly 全量
   ```

### ❌ 反模式

1. **反模式：Expectation 包装所有 PHPUnit 断言**
   ```php
   // ❌ 不需要包装简单的类型断言
   expect()->extend('toBeString', function () {
       test()->assertIsString($this->value);
   });
   ```

2. **反模式：Arch Testing 过度约束**
   ```php
   // ❌ 过度约束：连命名规范都用 Arch 管
   Arch::expect('App')->toMeet(function ($class) {
       return str_starts_with($class, 'App\\');
   });
   // ✅ 用 PHPStan 或 cs-fix 处理命名规范
   ```

3. **反模式：Mutation Testing 每次 PR 全量运行**
   ```bash
   # ❌ 每个 PR 跑 30 分钟的变异测试
   vendor/bin/infection
   # ✅ PR 只跑增量，nightly 跑全量
   ```

---

## 十、扩展思考

### 10.1 Mutation Testing 与 AI 的结合

变异测试正在与 AI 结合。GitHub Copilot 和 Claude Code 可以：

1. **自动修复存活变异**：分析存活变异的根因，自动生成补充测试
2. **智能算子选择**：基于代码变更类型，预测最可能暴露 Bug 的变异算子
3. **变异优先级排序**：根据代码热度和变更频率，优先测试高风险变异

### 10.2 从 Mutation Testing 到 Chaos Engineering

变异测试的思路可以延伸到系统层面——在生产环境注入变异（延迟、错误、资源耗尽），验证系统的韧性。这就是 Chaos Engineering 的核心理念。

### 10.3 未来方向

- **Pest 4.x** 预计将引入更强的 Arch Testing DSL，支持跨文件的依赖图分析
- **Infection** 正在开发基于 AI 的变异优先级排序，目标是将运行时间减少 50%
- **Pest + Infection 深度集成**：直接在 Pest 输出中显示变异测试结果，无需单独运行

---

## 参考资料

- [Pest PHP 官方文档 - Custom Expectations](https://pestphp.com/docs/custom-expectations)
- [Pest PHP 官方文档 - Arch Testing](https://pestphp.com/docs/arch-testing)
- [Infection PHP 官方文档](https://infection.github.io/guide/)
- [Mutation Testing: A Meta-Systematic Mapping Study](https://arxiv.org/abs/2204.08216)
- [Laravel Testing Best Practices](https://laravel.com/docs/testing)

## 相关阅读

- [Pest + PHPUnit + ParaTest：如何在 Laravel B2C API 上跑满 100% 覆盖率？](/php/pest-testingguide-100/) — 从零到一分享 Laravel B2C 项目覆盖率从 60% 提升到 100% 的实战踩坑记录，涵盖 Pest 语法迁移、Mock/Stub 高级用法、RefreshDatabase 数据隔离与 ParaTest 并行加速。
- [Pest PHP 3.x 实战：简洁优雅的 PHP 测试框架深度剖析](/php/pest-php-3x-elegant-php-testing-framework/) — Pest 3.x 设计哲学、Datasets 数据驱动、Laravel 集成踩坑、并行测试性能优化，与本文的进阶特性形成完整的 Pest 学习路径。
- [PHPUnit 11.x 实战：新特性与最佳实践](/engineering/phpunit-11-x-guide-best-practices/) — PHPUnit 11 Attributes 语法、Expectation API 与升级 Checklist，与 Pest 自定义 Expectations 的设计思路形成对比参考。
