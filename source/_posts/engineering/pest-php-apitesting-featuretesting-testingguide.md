---
title: "Pest PHP API 测试、Feature 测试、浏览器测试实战：Laravel B2C API 测试金字塔落地踩坑记录"
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
date: 2026-05-17 01:20:17
updated: 2026-05-17 01:49:40
categories:
  - engineering
  - testing
tags: [Laravel, PHP, 测试]
keywords: [Pest PHP API, Feature, Laravel B2C API, 浏览器测试实战, 测试金字塔落地踩坑记录, 工程化, 测试]
description: "Pest PHP 测试指南：详解 Laravel B2C 项目中 API 测试、功能测试与 Dusk 浏览器 E2E 测试实战，涵盖 PHPUnit 迁移 Pest、断言链写法、RefreshDatabase 选型、Http::fake/Queue::fake 三件套、测试金字塔策略与 CI 集成踩坑记录，适用于 PHP Laravel 工程师构建高置信度测试体系。"
---

## 前言：为什么需要完整的测试金字塔？

在之前的 [Pest 单元测试实战](/posts/05_PHP/Pest-单元测试实战-Laravel-B2C-API-100-覆盖率.md) 中，我们聚焦于 Unit 层的高覆盖率。但在实际 B2C 电商项目中，光有单元测试远远不够——

```
        /  E2E  \          ← 少量关键流程（Dusk 浏览器测试）
       / -------- \
      /  Feature   \       ← HTTP 端到端验证（API + DB）
     / ------------ \
    /    Unit Test    \     ← 纯逻辑、无 IO（快速、海量）
   / ------------------ \
```

**真实踩坑**：我们有个订单创建 Service 被 100% 单元测试覆盖，但上线后 API 直接 500——因为 `Middleware` 里的权限检查被 Mock 掉了，测试没走到那一层。

本文记录 KKday B2C Backend Team 在 30+ 个 Laravel 仓库中，用 Pest 构建完整测试金字塔的实战经验。

---

## 一、Pest API 测试：HTTP 端到端断言链

### 1.1 基础结构

```php
// tests/Feature/Api/OrderApiTest.php
uses(RefreshDatabase::class);

describe('POST /api/v2/orders', function () {
    it('creates order with valid payload', function () {
        $user = User::factory()->create();
        $product = Product::factory()->create(['stock' => 10]);

        $response = $this->actingAs($user)
            ->postJson('/api/v2/orders', [
                'product_id' => $product->id,
                'quantity' => 2,
                'payment_method' => 'credit_card',
            ]);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'data' => ['id', 'order_number', 'total_amount', 'status'],
            ])
            ->assertJsonPath('data.status', 'pending_payment');

        // 验证数据库状态
        $this->assertDatabaseHas('orders', [
            'user_id' => $user->id,
            'product_id' => $product->id,
            'quantity' => 2,
        ]);

        // 验证库存扣减
        $product->refresh();
        expect($product->stock)->toBe(8);
    });

    it('rejects order when stock insufficient', function () {
        $user = User::factory()->create();
        $product = Product::factory()->create(['stock' => 1]);

        $response = $this->actingAs($user)
            ->postJson('/api/v2/orders', [
                'product_id' => $product->id,
                'quantity' => 5,
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['quantity']);
    });
});
```

### 1.2 认证与中间件穿透测试

```php
it('rejects unauthenticated request', function () {
    $response = $this->postJson('/api/v2/orders', []);

    $response->assertStatus(401)
        ->assertJson(['message' => 'Unauthenticated.']);
});

it('respects rate limiting on order creation', function () {
    $user = User::factory()->create();

    // 假设限流配置：每分钟最多 5 次
    for ($i = 0; $i < 5; $i++) {
        $this->actingAs($user)
            ->postJson('/api/v2/orders', ['product_id' => 1, 'quantity' => 1]);
    }

    $response = $this->actingAs($user)
        ->postJson('/api/v2/orders', ['product_id' => 1, 'quantity' => 1]);

    $response->assertStatus(429);
});
```

**踩坑记录**：`actingAs($user)` 默认使用 `api` guard。如果你的 API 用的是 `sanctum`，需要指定：

```php
$this->actingAs($user, 'sanctum')
```

否则 middleware 里的 `Auth::id()` 返回 `null`，测试全部 "通过" 但实际场景全挂。

### 1.3 文件上传 API 测试

```php
it('uploads product image successfully', function () {
    $user = User::factory()->create(['role' => 'admin']);
    $file = UploadedFile::fake()->image('product.jpg', 800, 600)->size(1024);

    $response = $this->actingAs($user)
        ->postJson('/api/v2/products/1/images', [
            'image' => $file,
            'sort_order' => 1,
        ]);

    $response->assertStatus(201);
    Storage::disk('s3')->assertExists("products/1/{$file->hashName()}");
});
```

---

## 二、Feature 测试：数据库事务与状态验证

### 2.1 RefreshDatabase vs DatabaseTransactions

```php
// 方案 A：每个测试前重建 Schema（慢但安全）
uses(RefreshDatabase::class);

// 方案 B：每个测试包裹事务（快但要注意多 DB 连接问题）
uses(DatabaseTransactions::class);
```

**真实踩坑**：在 B2C 项目中，订单创建会同时写 MySQL + 发 Redis 消息 + 调外部支付 API。`DatabaseTransactions` 只回滚 MySQL，Redis 和外部调用不会回滚。

我们的解决方案：

```php
// tests/Pest.php
uses(
    RefreshDatabase::class,
    // Mock 掉所有外部 HTTP 调用
)->beforeEach(function () {
    Http::fake([
        'payment.gateway.com/*' => Http::response(['status' => 'success'], 200),
        'sms.provider.com/*' => Http::response(['sent' => true], 200),
    ]);

    // 清理 Redis 测试数据
    Redis::flushdb();
})->in('Feature');
```

### 2.2 订单流程的完整 Feature 测试

```php
describe('Order Creation Flow', function () {
    it('completes full checkout with credit card', function () {
        $user = User::factory()->create();
        $product = Product::factory()->create([
            'stock' => 10,
            'price' => 299.00,
        ]);

        // Step 1: 加入购物车
        $this->actingAs($user)
            ->postJson('/api/v2/cart/items', [
                'product_id' => $product->id,
                'quantity' => 1,
            ])
            ->assertStatus(201);

        // Step 2: 创建订单
        $orderResponse = $this->actingAs($user)
            ->postJson('/api/v2/orders', [
                'payment_method' => 'credit_card',
                'shipping_address' => [
                    'name' => 'Test User',
                    'phone' => '+886912345678',
                    'address' => '台北市信義區信義路五段7號',
                ],
            ])
            ->assertStatus(201);

        $orderId = $orderResponse->json('data.id');

        // Step 3: 模拟支付回调
        $this->postJson('/api/v2/payments/callback', [
            'order_id' => $orderId,
            'transaction_id' => 'txn_test_123',
            'status' => 'success',
        ])->assertStatus(200);

        // 验证最终状态
        $this->assertDatabaseHas('orders', [
            'id' => $orderId,
            'status' => 'paid',
        ]);

        // 验证购物车已清空
        $cartResponse = $this->actingAs($user)
            ->getJson('/api/v2/cart');
        $cartResponse->assertJsonPath('data.items', []);
    });
});
```

### 2.3 队列 Job 的 Feature 测试

```php
it('dispatches SendOrderConfirmationJob after payment', function () {
    Queue::fake();

    $order = Order::factory()->create(['status' => 'pending_payment']);

    $this->postJson('/api/v2/payments/callback', [
        'order_id' => $order->id,
        'transaction_id' => 'txn_123',
        'status' => 'success',
    ]);

    Queue::assertPushed(SendOrderConfirmationJob::class, function ($job) use ($order) {
        return $job->orderId === $order->id;
    });
});
```

---

## 三、Laravel Dusk 浏览器测试

### 3.1 为什么还需要浏览器测试？

API 测试验证了后端逻辑，但 B2C 前端有大量 JS 交互——价格实时计算、SKU 选择、地址联动选择器。这些在 API 测试中无法覆盖。

**我们的策略**：只对"核心金钱流程"写 Dusk 测试，数量控制在 10-20 个。

### 3.2 Dusk 配置与 Headless Chrome

```bash
# 安装
composer require --dev laravel/dusk
php artisan dusk:install

# CI 中安装 Chrome
# .github/workflows/tests.yml
- name: Install Chrome
  uses: browser-actions/setup-chrome@latest
  with:
    chrome-version: stable
```

```php
// tests/Browser/CheckoutFlowTest.php
class CheckoutFlowTest extends DuskTestCase
{
    use DatabaseMigrations;

    public function test_user_can_complete_checkout()
    {
        $user = User::factory()->create();
        $product = Product::factory()->create([
            'name' => 'KKday 東京一日遊',
            'price' => 2500,
            'stock' => 5,
        ]);

        $this->browse(function (Browser $browser) use ($user, $product) {
            $browser->loginAs($user)
                ->visit('/products/' . $product->id)
                ->assertSee('KKday 東京一日遊')
                ->assertSee('$2,500')
                ->select('quantity', '2')
                ->press('加入購物車')
                ->waitFor('.cart-count')
                ->assertSeeIn('.cart-count', '2')
                ->click('@checkout-btn')
                ->waitFor('@payment-form')
                ->type('card-number', '4242424242424242')
                ->type('card-expiry', '12/28')
                ->type('card-cvc', '123')
                ->press('確認付款')
                ->waitFor('.order-success', 10)
                ->assertSee('訂單建立成功');
        });
    }
}
```

### 3.3 CI 中的 Dusk 踩坑记录

**坑 1：字体渲染不一致**

```php
// tests/DuskTestCase.php
protected function driver(): RemoteWebDriver
{
    $options = (new ChromeOptions())->addArguments([
        '--disable-gpu',
        '--headless',
        '--no-sandbox',
        '--window-size=1920,1080',
        '--disable-dev-shm-usage', // CI 内存不足时必加
    ]);

    return RemoteWebDriver::create(
        'http://localhost:9515',
        DesiredCapabilities::chrome()->setCapability(
            ChromeOptions::CAPABILITY, $options
        )
    );
}
```

**坑 2：测试间数据库状态互相污染**

```php
// 使用 DatabaseMigrations 而非 RefreshDatabase
// 因为 Dusk 是独立进程，不共享 PHP 内存
use DatabaseMigrations;

public function setUp(): void
{
    parent::setUp();
    $this->artisan('migrate');
    $this->seed(ProductCategorySeeder::class); // 必要的基础数据
}
```

**坑 3：CI 环境变量缺失**

```env
# .env.dusk.ci
APP_URL=http://localhost:8000
DB_CONNECTION=mysql
DB_DATABASE=kkday_test
MAIL_MAILER=log  # 不要真的发邮件
```

---

## 四、测试金字塔的平衡策略

### 4.1 我们的比例分配

| 测试类型 | 数量（典型仓库） | 运行时间 | 覆盖范围 |
|---------|---------------|---------|---------|
| Unit | 200-400 | 10-30s | Service/Model/Helper 纯逻辑 |
| Feature/API | 80-150 | 30-90s | HTTP 端到端 + DB + Queue |
| Dusk E2E | 10-20 | 5-10min | 核心金钱流程 |

### 4.2 什么时候该写哪种测试

```
需要测试什么？
├── 纯函数/计算逻辑 → Unit（Pest it()）
├── API 响应 + 数据库状态 → Feature（Pest + RefreshDatabase）
├── 前端 JS 交互 + 页面渲染 → Dusk（Headless Chrome）
└── 不确定？→ 先写 Feature，性能不够再拆 Unit
```

### 4.3 Pest 的 `todo()` 和 `defer()`

```php
// 标记待写的测试
it('handles concurrent stock deduction', function () {
    // TODO: 需要 Pcntl 扩展才能模拟并发
})->todo();

// 延迟断言（Pest v3+）
it('sends webhook after order paid', function () {
    $order = createPaidOrder();

    defer(function () use ($order) {
        // 测试结束后验证
        Event::assertDispatched(OrderPaid::class);
    });
});
```

---

## 五、常见陷阱总结

### 陷阱 1：Feature 测试假装通过

```php
// ❌ 错误：断言 200 但没有检查响应内容
$response->assertStatus(200);

// ✅ 正确：验证具体业务状态
$response->assertStatus(200)
    ->assertJsonPath('data.status', 'paid')
    ->assertJsonCount(3, 'data.items');
```

### 陷阱 2：测试间依赖

```php
// ❌ 错误：测试 B 依赖测试 A 的数据库状态
test('create user', function () { ... });
test('login with created user', function () { ... });

// ✅ 正确：每个测试独立准备数据
test('login with valid credentials', function () {
    $user = User::factory()->create(['password' => 'secret']);
    // ...
});
```

### 陷阱 3：Mock 过度导致测试失真

```php
// ❌ 错误：Mock 了太多层，测试通过但实际业务逻辑不对
$this->mock(OrderService::class, function ($mock) {
    $mock->shouldReceive('create')->andReturn(true);
});

// ✅ 正确：只 Mock 外部依赖（HTTP、Queue、第三方 SDK）
Http::fake(['payment.api.com/*' => Http::response(['status' => 'ok'], 200)]);
```

---

## 总结

1. **API 测试是 B2C 项目的主力**：Pest 的 `actingAs` + `postJson` + 断言链，比 PHPUnit 代码量减少 40%
2. **Feature 测试要管好数据库**：`RefreshDatabase` + `Http::fake` + `Queue::fake` 是标准三件套
3. **Dusk 浏览器测试只覆盖核心流程**：10-20 个用例足够，CI 中用 Headless Chrome
4. **测试金字塔不是教条**：B2C API 项目可以 Feature > Unit，关键是测试能发现真实 Bug

---

## 六、CI/CD 集成：GitHub Actions 实战配置

### 6.1 完整的测试工作流

```yaml
# .github/workflows/tests.yml
name: Tests
on: [push, pull_request]

jobs:
  unit-and-feature:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: ['8.2', '8.3']
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          extensions: mbstring, dom, fileinfo
          coverage: xdebug

      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Run Unit & Feature Tests
        run: |
          php artisan test --parallel --coverage --min=80
        env:
          DB_CONNECTION: sqlite
          DB_DATABASE: ":memory:"

  dusk-e2e:
    runs-on: ubuntu-latest
    needs: unit-and-feature
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'

      - name: Install Chrome
        uses: browser-actions/setup-chrome@latest
        with:
          chrome-version: stable

      - name: Run Dusk Tests
        run: |
          php artisan serve &
          sleep 3
          php artisan dusk --parallel=4
        env:
          APP_URL: http://127.0.0.1:8000
          DB_CONNECTION: sqlite
          DB_DATABASE: ":memory:"
```

### 6.2 测试覆盖率报告集成

```bash
# 生成 HTML 覆盖率报告并上传
php artisan test --coverage --min=80 --coverage-html=coverage

# 集成 Coveralls
vendor/bin/phpunit --coverage-clover=coverage.xml
COVERALLS_REPO_TOKEN=*** php vendor/bin/php-coveralls
```

### 6.3 性能基准：Parallel Testing 加速

```bash
# Pest 并行测试（Laravel 11+）
php artisan test --parallel=8

# 自定义并行进程数
php artisan test --parallel=16 --processes=8
```

| 并行策略 | 仓库规模 | 耗时优化 | 注意事项 |
|---------|---------|---------|---------|
| 串行（默认） | 300 测试 | ~120s | 无数据库冲突 |
| `--parallel=4` | 300 测试 | ~35s | 需要独立 DB 或 SQLite |
| `--parallel=8` | 300 测试 | ~20s | CI runner 需 4GB+ 内存 |
| ParaTest | 300 测试 | ~15s | 需额外安装 `brianium/paratest` |

### 6.4 Mock 策略速查表

| 外部依赖 | 推荐 Mock 方式 | 代码示例 |
|---------|--------------|---------|
| HTTP API | `Http::fake()` | `Http::fake(['api.com/*' => Http::response([...], 200)])` |
| Queue Jobs | `Queue::fake()` | `Queue::fake(); ... Queue::assertPushed(Job::class)` |
| Event | `Event::fake()` | `Event::fake(); ... Event::assertDispatched(Event::class)` |
| Mail | `Mail::fake()` | `Mail::fake(); ... Mail::assertSent(Mailable::class)` |
| Storage | `Storage::fake()` | `Storage::fake('s3'); ... Storage::disk('s3')->assertExists(...)` |
| Time | `Carbon::setTestNow()` | `Carbon::setTestNow('2026-01-01'); ... Carbon::setTestNow(null)` |

---
> 本文基于 KKday B2C Backend Team 的 30+ 个 Laravel 仓库实践，覆盖 Pest v2/v3、Laravel 10/11、GitHub Actions CI 环境。如有问题欢迎在评论区讨论。

---

## 相关阅读

- [Pest + PHPUnit + ParaTest：如何在 Laravel B2C API 上跑满 100% 覆盖率？](/posts/php/pest-testingguide-100) — Unit 测试层的完整实战，覆盖 Pest 基础语法、ParaTest 并行测试配置与覆盖率提升策略
- [Pest PHP 3.x 实战：简洁优雅的 PHP 测试框架深度剖析](/posts/php/2026-06-01-pest-php-3x-elegant-php-testing-framework) — 从设计哲学到 Arch Testing、Mutation Testing、Datasets 数据驱动与并行测试性能优化
- [Pest PHP 实战：自定义 Expectations、Arch Testing、Mutation Testing 深度剖析](/posts/php/2026-06-01-pest-php-custom-expectations-arch-testing-mutation-testing) — 自定义断言扩展、架构守护测试与变异测试的系统化实践
- [Pest 并发测试与 PHPUnit 对比：Laravel B2C API 测试踩坑记录](/posts/php/Laravel/pest-testingguide-concurrencytesting) — 数据驱动测试、并发防超卖、异步队列 Wait 插件与工厂模式批量创建
- [PHPUnit 断言实战：Beyond assertEquals——掌握 expect、mock、stub 踩坑记录](/posts/php/Laravel/phpunit-guide-beyond-assertequals-expect-mock-stub) — PHPUnit 高级断言与 Mock/Stub 深度用法，为迁移 Pest 打好基础
- [Laravel Dusk 浏览器自动化 E2E 测试实战：CI 流水线集成与动态等待治理](/posts/php/Laravel/laravel-dusk-automatione2etestingguide-ci) — Dusk 浏览器测试的深入配置，包括 Headless Chrome 调试与 CI 最佳实践
- [Mockery 实战：外部服务 Mock 与依赖隔离 Laravel B2C API 踩坑记录](/posts/engineering/mockery-guide-mock) — Mock 策略的系统化讲解，解决测试中外部依赖隔离的常见痛点
- [AI 驱动测试生成实战：Pest + AI 自动生成单元测试的最佳实践](/posts/engineering/ai-testingguide-pest-ai-testing) — 利用 AI 自动生成 Pest 测试代码，提升测试覆盖率的工程化方案
- [Snapshot Testing 实战：API 响应快照回归测试](/posts/php/Laravel/2026-06-01-snapshot-testing-api-response-regression-testing) — 用快照守护接口契约，与 Pest API 测试互补的回归测试策略
