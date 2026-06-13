---
title: Laravel 数据库测试策略实战：事务回滚、内存数据库、Seeding 与迁移速度优化
keywords: [Laravel, Seeding, 数据库测试策略实战, 事务回滚, 内存数据库, 与迁移速度优化, PHP]
date: 2026-06-09 23:15:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - Testing
  - Database
  - PHPUnit
  - Migration
  - Seeding
description: 深入讲解 Laravel 项目中数据库测试的最佳实践，涵盖事务回滚、内存数据库（SQLite in-memory）、Factory Seeding 策略、迁移速度优化，附带可运行的实战代码。
---


## 概述

数据库测试是后端项目中最脆弱也最重要的测试环节。写得好的数据库测试能帮你提前发现 SQL 注入、数据一致性、迁移兼容性等问题；写得差的数据库测试则慢得要命、互相干扰、维护成本高。

本文聚焦 Laravel 项目中的数据库测试策略，解决三个核心痛点：

1. **测试太慢**——每个测试都要重建数据库
2. **测试互相干扰**——测试 A 写的数据影响测试 B
3. **迁移频繁导致测试不稳定**——每次 `artisan migrate:fresh` 耗时过长

我们会从事务回滚讲到内存数据库，再到 Seeding 策略和迁移速度优化，每一步都附带可运行的代码。

---

## 核心概念

### Laravel 测试数据库的三种策略

| 策略 | 原理 | 适用场景 |
|------|------|---------|
| 事务回滚（RefreshDatabase） | 每个测试包在事务中，结束后回滚 | 大多数单体应用 |
| 内存数据库（SQLite in-memory） | 使用 `:memory:` 驱动，测试结束即销毁 | 读多写少、不需要原生 SQL 特性 |
| 独立数据库（DatabaseTransactions） | 每个测试结束后回滚该测试的事务 | 需要真实数据库引擎的场景 |

大多数 Laravel 项目推荐使用 **RefreshDatabase trait**，它在每个测试方法执行前运行迁移，执行后回滚事务。这是官方推荐的默认策略。

---

## 实战代码

### 1. 基础配置：测试数据库环境

首先，确保 `.env.testing` 配置了独立的测试数据库：

```env
# .env.testing
DB_CONNECTION=sqlite
DB_DATABASE=:memory:
```

或者用一个独立的 MySQL 数据库：

```env
# .env.testing
DB_CONNECTION=mysql
DB_DATABASE=your_app_test
DB_USERNAME=testing
DB_PASSWORD=secret
```

在 `phpunit.xml` 中引用测试环境：

```xml
<php>
    <env name="APP_ENV" value="testing"/>
    <env name="DB_CONNECTION" value="sqlite"/>
    <env name="DB_DATABASE" value=":memory:"/>
</php>
```

### 2. 使用 RefreshDatabase Trait

这是 Laravel 数据库测试的基石。在测试类中引入 `RefreshDatabase` trait：

```php
<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use App\Models\User;
use App\Models\Order;

class OrderTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function user_can_create_order(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/orders', [
            'product_id' => 1,
            'quantity' => 2,
        ]);

        $response->assertCreated();
        $this->assertDatabaseHas('orders', [
            'user_id' => $user->id,
            'quantity' => 2,
        ]);
    }

    /** @test */
    public function order_belongs_to_user(): void
    {
        $user = User::factory()->create();
        $order = Order::factory()->for($user)->create();

        $this->assertEquals($user->id, $order->user_id);
    }
}
```

`RefreshDatabase` 的工作原理：

1. 每个测试方法开始前，运行所有 migration
2. 将数据库操作包裹在一个事务中
3. 测试方法结束后，回滚事务，数据库回到干净状态

**关键点**：因为是事务回滚，不是每次重新迁移，所以同一测试类内的多个测试方法共享一次 migration，速度很快。

### 3. 内存数据库（SQLite in-memory）

SQLite 内存数据库是最简单的提速方案。缺点是某些 MySQL 特有语法不兼容。

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    protected function setUp(): void
    {
        parent::setUp();

        // 强制使用 SQLite 内存数据库
        config(['database.default' => 'sqlite']);
        config(['database.connections.sqlite.database' => ':memory:']);
    }
}
```

如果你需要使用 MySQL 特有语法（如 JSON 字段操作、全文索引），可以按测试类切换：

```php
<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdvancedQueryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // 这些测试需要真实的 MySQL
        config(['database.default' => 'mysql']);
    }

    /** @test */
    public function can_search_with_fulltext_index(): void
    {
        // MySQL 全文搜索测试
        DB::unprepared('ALTER TABLE articles ADD FULLTEXT INDEX idx_ft_content (content)');
        // ...
    }
}
```

### 4. Seeding 策略：测试数据的科学管理

#### 4.1 使用 Model Factory

Laravel 的 Factory 是生成测试数据的核心工具：

```php
<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use App\Models\User;
use App\Models\Product;

class OrderFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'product_id' => Product::factory(),
            'quantity' => $this->faker->numberBetween(1, 10),
            'price' => $this->faker->randomFloat(2, 9.99, 999.99),
            'status' => $this->faker->randomElement(['pending', 'paid', 'shipped']),
            'paid_at' => $this->faker->optional(0.7)->dateTimeThisMonth(),
        ];
    }

    public function paid(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'paid',
            'paid_at' => now(),
        ]);
    }

    public function pending(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'pending',
            'paid_at' => null,
        ]);
    }
}
```

#### 4.2 测试中按需 Seeding

```php
/** @test */
public function paid_orders_appear_in_reports(): void
{
    // 创建 5 个已支付订单
    Order::factory()->paid()->count(5)->create();

    // 创建 3 个待支付订单
    Order::factory()->pending()->count(3)->create();

    $report = new OrderReport(now()->month);

    $this->assertEquals(5, $report->paidCount());
    $this->assertEquals(3, $report->pendingCount());
}
```

#### 4.3 使用 Seed 类进行复杂数据准备

当测试数据有复杂的关联关系时，单独写一个 Seeder：

```php
<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\{User, Product, Order, OrderItem};

class TestOrderSeeder extends Seeder
{
    public function run(): void
    {
        // 创建管理员用户
        $admin = User::factory()->admin()->create([
            'email' => 'admin@example.com',
        ]);

        // 创建普通用户
        $users = User::factory()->count(5)->create();

        // 创建商品
        $products = Product::factory()->count(10)->create();

        // 每个用户随机下单
        foreach ($users as $user) {
            $orderItems = collect();
            $total = 0;

            $itemsCount = rand(1, 3);
            $selectedProducts = $products->random($itemsCount);

            foreach ($selectedProducts as $product) {
                $quantity = rand(1, 3);
                $subtotal = $product->price * $quantity;
                $total += $subtotal;

                $orderItems->push([
                    'product_id' => $product->id,
                    'quantity' => $quantity,
                    'unit_price' => $product->price,
                    'subtotal' => $subtotal,
                ]);
            }

            $order = Order::create([
                'user_id' => $user->id,
                'total' => $total,
                'status' => $this->faker->randomElement(['pending', 'paid', 'shipped']),
            ]);

            foreach ($orderItems as $item) {
                OrderItem::create(array_merge($item, [
                    'order_id' => $order->id,
                ]));
            }
        }
    }
}
```

在测试中使用：

```php
/** @test */
public function can_generate_sales_report(): void
{
    $this->seed(TestOrderSeeder::class);

    $report = new SalesReport();

    $this->assertGreaterThan(0, $report->totalRevenue());
    $this->assertDatabaseCount('orders', 5); // 5 个用户各下了一单
}
```

### 5. 迁移速度优化

#### 5.1 问题分析

`RefreshDatabase` 的默认行为是每个测试类调用一次 `artisan migrate:fresh`，这在有大量 migration 时非常慢。

优化方案对比：

| 方案 | 速度 | 兼容性 | 推荐度 |
|------|------|--------|--------|
| SQLite in-memory | ⚡⚡⚡ 最快 | ⚠️ 不支持所有 MySQL 特性 | 适合简单场景 |
| 事务回滚（默认） | ⚡⚡ 较快 | ✅ 完全兼容 | 默认推荐 |
| Schema::withoutMigrations | ⚡⚡⚡ 最快 | ✅ 完全兼容 | 需要手动管理 |
| 并行测试 | ⚡⚡ 较快 | ✅ 完全兼容 | CI/CD 推荐 |

#### 5.2 使用 WithoutMigrations Trait

如果你的 migration 已经在测试数据库中运行过了（比如开发环境），可以用这个 trait 跳过迁移，只做事务回滚：

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMigrations;
use Tests\TestCase;

class FastOrderTest extends TestCase
{
    use RefreshDatabase, WithoutMigrations;

    /** @test */
    public function can_create_order(): void
    {
        // 不会再执行 migrate:fresh，速度大幅提升
        $user = User::factory()->create();
        $response = $this->actingAs($user)->postJson('/api/orders', [
            'product_id' => 1,
            'quantity' => 2,
        ]);
        $response->assertCreated();
    }
}
```

#### 5.3 跳过某些 Migration

有些 migration 在测试中用不到（如创建搜索索引），可以按需跳过：

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\RefreshDatabase as RefreshDatabaseTrait;
use Illuminate\Database\Migrations\Migrator;

trait SelectiveRefreshDatabase
{
    use RefreshDatabaseTrait;

    protected function refreshTestDatabase(): void
    {
        if (! $this->refreshRunDatabase) {
            return;
        }

        $this->refreshRefreshedTraitTraits();

        $migrator = $this->app->make(Migrator::class);

        // 跳过不需要的 migration
        $migrator->usingConnection($this->databaseConnection, function () use ($migrator) {
            $migrator->run([
                database_path('migrations'),
            ], [
                'ignore' => [
                    'create_search_indexes',  // 跳过搜索索引
                    'create_fulltext_indexes', // 跳过全文索引
                ],
            ]);
        });

        $this->beginDatabaseTransaction();
    }
}
```

#### 5.4 并行测试

Laravel 8+ 原生支持并行测试。每个 worker 使用独立的数据库：

```bash
# 4 个并行 worker
php artisan test --parallel --process=4
```

在 `phpunit.xml` 中配置并行测试数据库：

```xml
<php>
    <env name="DB_DATABASE" value="testing_${TEST_TOKEN}"/>
</php>
```

每个 worker 会自动创建独立的数据库 `testing_1`、`testing_2` 等，测试结束后销毁。

### 6. 高级技巧

#### 6.1 测试性能监控

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    protected function setUp(): void
    {
        parent::setUp();

        if (env('TEST_PERFORMANCE_LOG')) {
            $start = microtime(true);

            register_shutdown_function(function () use ($start) {
                $time = round((microtime(true) - $start) * 1000, 2);
                $test = $this->getName();

                if ($time > 1000) { // 超过 1 秒的测试
                    file_put_contents(
                        storage_path('logs/slow-tests.log'),
                        sprintf("[%s] %s: %sms\n", date('Y-m-d H:i:s'), $test, $time),
                        FILE_APPEND
                    );
                }
            });
        }
    }
}
```

#### 6.2 数据库快照恢复

对于需要复杂数据状态的测试，可以用数据库快照：

```php
<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ComplexScenarioTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // 创建基础数据并保存快照
        $this->seed(CompleteTestDataSeeder::class);

        // 手动创建快照（Laravel 10+）
        $this->artisan('db:snapshot create test_base_state');
    }

    /** @test */
    public function test_scenario_a(): void
    {
        // 这个测试会修改数据
        Order::factory()->count(10)->create();
        // ...
    }

    protected function tearDown(): void
    {
        // 恢复快照
        if (file_exists(database_path('snapshots/test_base_state.sql'))) {
            $this->artisan('db:snapshot restore test_base_state');
        }

        parent::tearDown();
    }
}
```

#### 6.3 Mock 数据库连接

当你只想测试业务逻辑而不关心实际数据库操作时：

```php
<?php

namespace Tests\Unit\Services;

use Tests\TestCase;
use App\Services\OrderCalculator;
use App\Models\Order;
use Illuminate\Support\Facades\DB;

class OrderCalculatorTest extends TestCase
{
    /** @test */
    public function calculates_total_with_discount(): void
    {
        // Mock 数据库查询
        DB::shouldReceive('table')
            ->with('orders')
            ->andReturnSelf();
        DB::shouldReceive('where')
            ->with('user_id', 1)
            ->andReturnSelf();
        DB::shouldReceive('sum')
            ->with('total')
            ->andReturn(1000);

        $calculator = new OrderCalculator();
        $total = $calculator->getUserTotal(1);

        $this->assertEquals(1000, $total);
    }
}
```

---

## 踩坑记录

### 坑 1：SQLite 不支持 JSON 列操作

```php
// ❌ 这段代码在 SQLite 内存数据库中会报错
$this->assertDatabaseHas('products', [
    'metadata->color' => 'red',  // JSON 路径语法
]);

// ✅ 改用原生查询或使用真实 MySQL
$this->assertDatabaseHas('products', [
    'metadata' => json_encode(['color' => 'red']),
]);
```

### 坑 2：事务嵌套导致测试失败

```php
/** @test */
public function transaction_inside_transaction_fails(): void
{
    // RefreshDatabase 已经开启事务
    // 再开一个事务会导致死锁
    DB::transaction(function () {
        // 这里会报错
    });
}

// ✅ 使用 DB::withoutRollback() 或者调整事务层级
```

### 坑 3：Seeding 时外键约束失败

```php
// ❌ 按顺序创建数据时，外键可能报错
$user = User::factory()->create();
$order = Order::factory()->create(['user_id' => $user->id]); // 有时报错

// ✅ 确保 Factory 中的关联使用闭包延迟创建
class OrderFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(), // 使用 Factory 延迟创建
            // ...
        ];
    }
}
```

### 坑 4：测试间数据泄漏

```php
// ❌ 在测试间共享静态数据
class OrderTest extends TestCase
{
    public static ?User $sharedUser;

    /** @test */
    public function test_a(): void
    {
        self::$sharedUser = User::factory()->create(); // 泄漏到下一个测试
    }
}

// ✅ 每个测试独立创建数据
class OrderTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function test_a(): void
    {
        $user = User::factory()->create(); // 局部变量，安全
    }
}
```

---

## 总结

数据库测试策略的核心原则：

1. **默认用 RefreshDatabase**——它平衡了速度和兼容性，是大多数项目的最佳选择
2. **SQLite in-memory 提速明显**——只要你的代码没有用到 MySQL 特有语法
3. **Factory 是你的朋友**——用状态方法（`->paid()`、`->pending()`）让测试数据语义清晰
4. **Seeding 按需执行**——不要在每个测试中都跑完整 Seeder
5. **监控测试速度**——超过 1 秒的测试方法要优化
6. **并行测试是 CI 的终极方案**——但需要确保测试间没有共享状态

记住：测试不是写完就不管了。定期运行 `php artisan test --parallel` 看看哪些测试拖慢了你的 CI，然后针对性优化。好的数据库测试应该在 10 秒内跑完整个测试套件。

---

*下一篇：Laravel API 测试策略——HTTP 测试、Mock 外部服务、JSON Schema 验证*
