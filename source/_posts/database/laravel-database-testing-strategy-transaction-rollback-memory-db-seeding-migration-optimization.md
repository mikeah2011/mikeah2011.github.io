---

title: 数据库测试策略实战：事务回滚、内存数据库、Seeding 策略、迁移速度优化——Laravel 项目的数据库测试最佳实践
date: 2026-06-09 23:25:00
categories:
  - database
keywords: [Seeding, Laravel, 数据库测试策略实战, 事务回滚, 内存数据库, 策略, 迁移速度优化, 项目的数据库测试最佳实践, 数据库]
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
tags:
- Laravel
- PHPUnit
- 数据库
- SQLite
- 测试策略
description: 深入 Laravel 数据库测试的核心策略，涵盖事务回滚机制、内存数据库加速、Seeding 分层设计与迁移速度优化，帮助团队建立快速可靠的数据库测试体系。
---


数据库测试是后端开发中最容易被忽视、也最容易出问题的环节。很多团队的测试套件要么不测数据库（纯 mock），要么测了但慢得离谱（每次跑 10 分钟），要么数据互相污染导致 flaky test。

这篇文章从实战出发，覆盖 Laravel 项目中数据库测试的四大核心策略：

1. **事务回滚**——保证测试间数据隔离
2. **内存数据库**——用 SQLite :memory: 加速测试
3. **Seeding 策略**——分层管理测试数据
4. **迁移速度优化**——从 30 秒降到 3 秒

所有代码基于 Laravel 10+ / PHPUnit 10+，PHP 8.2+。

---

## 一、为什么数据库测试这么难

数据库测试的三大痛点：

**速度**：一次迁移 + seed 可能耗时 5-10 秒，几百个测试跑下来就是几十分钟。

**隔离**：测试 A 插入的数据影响了测试 B 的断言，结果时过时不过。

**复杂度**：外键约束、触发器、存储过程，让 mock 变得不现实。

解决方案不是「不测数据库」，而是「用正确的方式测」。

---

## 二、事务回滚：数据隔离的基石

### 2.1 原理

事务回滚的核心思想：每个测试在一个数据库事务中执行，测试结束后自动回滚，数据库回到初始状态。

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;

abstract class TestCase extends BaseTestCase
{
    use \Illuminate\Foundation\Testing\RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // 每个测试方法开始前开启事务
        DB::beginTransaction();
    }

    protected function tearDown(): void
    {
        // 每个测试方法结束后回滚
        DB::rollBack();
        parent::tearDown();
    }
}
```

### 2.2 Laravel 内置方案对比

Laravel 提供了两个 trait 处理数据库测试：

**`RefreshDatabase`**：
- 每个测试类运行前执行一次 `migrate:fresh`
- 每个测试方法包裹在事务中并回滚
- 适合大多数场景

**`DatabaseMigrations`**：
- 每个测试方法前执行 `migrate:fresh`
- 每个测试方法后执行 `migrate:reset`
- 极慢，但最干净

```php
<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use App\Models\Order;
use App\Models\User;

class OrderTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_create_order(): void
    {
        $user = User::factory()->create();
        $order = Order::factory()->create(['user_id' => $user->id]);

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'user_id' => $user->id,
        ]);
        // 测试结束后，orders 和 users 表自动清空（事务回滚）
    }
}
```

### 2.3 嵌套事务的问题

如果你的业务代码里手动调用了 `DB::beginTransaction()`，测试中的事务回滚会出问题：

```php
<?php

// 业务代码
class OrderService
{
    public function createOrder(array $data): Order
    {
        DB::beginTransaction();
        try {
            $order = Order::create($data);
            $this->processPayment($order);
            DB::commit();
            return $order;
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }
}
```

测试中的 `DB::beginTransaction()` 是外层事务，业务代码的 `DB::commit()` 只是提交了内层事务（savepoint），数据并没有真正写入。测试结束后外层回滚，一切如常。

但如果你的业务代码使用了 `DB::rollBack()`，它会回滚到外层事务的起点，**测试的事务也会被回滚**，导致后续断言失败。

**解决方案**：使用 `DatabaseTransactions` trait，它处理了嵌套事务的情况：

```php
<?php

use Illuminate\Foundation\Testing\DatabaseTransactions;

class OrderTest extends TestCase
{
    use DatabaseTransactions;
}
```

### 2.4 多数据库连接的事务回滚

如果你的项目有多个数据库连接（比如读写分离、分库），需要确保所有连接都在事务中：

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        foreach (['mysql', 'mysql_read'] as $connection) {
            DB::connection($connection)->beginTransaction();
        }
    }

    protected function tearDown(): void
    {
        foreach (['mysql', 'mysql_read'] as $connection) {
            DB::connection($connection)->rollBack();
        }
        parent::tearDown();
    }
}
```

---

## 三、内存数据库：SQLite :memory: 加速测试

### 3.1 为什么用 SQLite

MySQL 的 I/O 是测试慢的主要原因。SQLite `:memory:` 模式下，所有数据存在内存中，没有磁盘 I/O，速度提升 5-10 倍。

### 3.2 配置

```php
// phpunit.xml
<php>
    <env name="DB_CONNECTION" value="sqlite"/>
    <env name="DB_DATABASE" value=":memory:"/>
</php>
```

或者在 `config/database.php` 中专门配置测试连接：

```php
// config/database.php
'connections' => [
    'testing' => [
        'driver' => 'sqlite',
        'database' => ':memory:',
        'prefix' => '',
        'foreign_key_constraints' => true, // 重要！SQLite 默认关闭外键约束
    ],
],
```

```php
// phpunit.xml
<env name="DB_CONNECTION" value="testing"/>
```

### 3.3 SQLite 与 MySQL 的差异处理

SQLite 和 MySQL 有一些 SQL 语法差异，需要特别处理：

**1. JSON 查询差异**

```php
// MySQL: WHERE JSON_EXTRACT(data, '$.name') = 'test'
// SQLite: WHERE json_extract(data, '$.name') = 'test'

// Laravel 的 Eloquent 已经帮你处理了：
User::where('data->name', 'test')->get(); // 两种数据库都支持
```

**2. 默认值差异**

```php
// MySQL: TIMESTAMP 列默认 CURRENT_TIMESTAMP
// SQLite: 需要显式设置

// 解决方案：在 migration 中显式声明默认值
$table->timestamp('created_at')->useCurrent();
$table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
```

**3. ENUM 类型**

SQLite 不支持 ENUM，但 Laravel 的 migration 会自动转为 VARCHAR：

```php
// 这在 SQLite 测试中也能工作
$table->enum('status', ['pending', 'active', 'inactive']);
```

**4. 存储过程和触发器**

如果你的项目依赖存储过程或触发器，SQLite 测试方案不可行，需要回退到 MySQL 测试库。

### 3.4 混合策略

很多团队采用混合策略：大部分测试用 SQLite（快），涉及 MySQL 特性的测试用 MySQL 测试库（准）：

```php
<?php

namespace Tests;

// 基础测试类：SQLite 内存数据库
abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;
}

// 需要 MySQL 的测试类
abstract class MySQLTestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        // 覆盖为 MySQL 测试连接
        config(['database.default' => 'mysql_testing']);
        parent::setUp();
    }
}
```

```php
<?php

// 大部分测试：用 SQLite，快
class UserTest extends TestCase
{
    public function test_user_creation(): void
    {
        $user = User::factory()->create();
        $this->assertNotNull($user->id);
    }
}

// 涉及 JSON 查询、存储过程的测试：用 MySQL
class ComplexQueryTest extends MySQLTestCase
{
    public function test_json_query(): void
    {
        // 使用 MySQL 原生 JSON 函数
        DB::statement("INSERT INTO users (name, meta) VALUES ('test', '{\"score\": 95}')");
        $result = DB::selectOne("SELECT * FROM users WHERE JSON_EXTRACT(meta, '$.score') > 90");
        $this->assertNotNull($result);
    }
}
```

---

## 四、Seeding 策略：分层管理测试数据

### 4.1 三层数据架构

测试数据管理的核心原则：**不要在每个测试里手动创建所有数据**。

```
┌─────────────────────────────────────────┐
│           Layer 3: Test Data            │  ← 每个测试独有的数据
│         (在测试方法中创建)               │
├─────────────────────────────────────────┤
│         Layer 2: Scenario Seed          │  ← 特定场景的基础数据
│         (ScenarioSeeder)                │
├─────────────────────────────────────────┤
│         Layer 1: Base Seed              │  ← 全局基础数据
│         (BaseSeeder)                    │
└─────────────────────────────────────────┘
```

### 4.2 Layer 1: Base Seed

全局基础数据，每个测试都需要：

```php
<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class BaseSeeder extends Seeder
{
    public function run(): void
    {
        // 系统配置
        $this->call([
            PermissionSeeder::class,
            RoleSeeder::class,
            SystemConfigSeeder::class,
        ]);
    }
}
```

### 4.3 Layer 2: Scenario Seed

特定业务场景的数据：

```php
<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class EcommerceScenarioSeeder extends Seeder
{
    public function run(): void
    {
        // 创建商品分类
        $categories = Category::factory()->count(5)->create();

        // 创建商品
        foreach ($categories as $category) {
            Product::factory()
                ->count(20)
                ->create(['category_id' => $category->id]);
        }

        // 创建用户
        $users = User::factory()->count(10)->create();

        // 创建订单
        foreach ($users as $user) {
            Order::factory()
                ->count(rand(1, 5))
                ->create(['user_id' => $user->id]);
        }
    }
}
```

### 4.4 Layer 3: Test Data

测试方法中用 Factory 创建：

```php
<?php

class OrderTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Layer 1 + 2：场景数据
        $this->seed([BaseSeeder::class, EcommerceScenarioSeeder::class]);
    }

    public function test_create_order_with_discount(): void
    {
        // Layer 3：测试独有的数据
        $user = User::factory()->create();
        $product = Product::factory()->create(['price' => 100]);
        $coupon = Coupon::factory()->create([
            'type' => 'percentage',
            'value' => 20, // 20% 折扣
        ]);

        $order = app(OrderService::class)->create([
            'user_id' => $user->id,
            'product_id' => $product->id,
            'coupon_id' => $coupon->id,
        ]);

        $this->assertEquals(80.0, $order->total); // 100 * 0.8
    }
}
```

### 4.5 Factory 高级用法

```php
<?php

namespace Database\Factories;

use App\Models\Order;
use Illuminate\Database\Eloquent\Factories\Factory;

class OrderFactory extends Factory
{
    protected $model = Order::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'status' => fake()->randomElement(['pending', 'paid', 'shipped', 'completed']),
            'total' => fake()->randomFloat(2, 10, 1000),
            'created_at' => fake()->dateTimeBetween('-30 days', 'now'),
        ];
    }

    // 状态方法
    public function pending(): static
    {
        return $this->state(fn (array $attributes) => ['status' => 'pending']);
    }

    public function paid(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'paid',
            'paid_at' => now(),
        ]);
    }

    // 关联方法
    public function withItems(int $count = 3): static
    {
        return $this->afterCreating(function (Order $order) use ($count) {
            OrderItem::factory()
                ->count($count)
                ->create(['order_id' => $order->id]);
        });
    }
}

// 使用
$order = Order::factory()
    ->paid()
    ->withItems(5)
    ->create(['user_id' => $user->id]);
```

### 4.6 避免 Factory 的 N+1 问题

Factory 创建关联数据时容易产生 N+1：

```php
// ❌ 慢：每个 Order 都创建一个新的 User
Order::factory()->count(100)->create();

// ✅ 快：共享一个 User
$user = User::factory()->create();
Order::factory()->count(100)->create(['user_id' => $user->id]);

// ✅ 更好的写法：使用 for()
$user = User::factory()->create();
Order::factory()
    ->count(100)
    ->for($user)
    ->create();
```

---

## 五、迁移速度优化：从 30 秒到 3 秒

### 5.1 问题根源

`migrate:fresh` 的流程：
1. 删除所有表
2. 执行所有 migration 文件
3. 执行 seeder

一个中型 Laravel 项目可能有 200+ migration 文件，每次执行需要 5-15 秒。

### 5.2 方案一：Schema Dump

Laravel 的 `schema:dump` 命令将当前数据库结构导出为单个 SQL 文件，后续测试直接导入这个文件，跳过逐个 migration 的过程：

```bash
# 导出当前数据库结构
php artisan schema:dump

# 生成 database/schema/mysql-schema.sql
# 这个文件包含了 CREATE TABLE 语句
```

配置 PHPUnit：

```xml
<!-- phpunit.xml -->
<php>
    <env name="DB_CONNECTION" value="mysql_testing"/>
    <env name="DB_DUMP_FILE_PATH" value="database/schema/mysql-schema.sql"/>
</php>
```

使用 `RefreshDatabase` trait 时，Laravel 会检测到 dump 文件，直接导入 SQL 而不是逐个执行 migration。

**效果**：200 个 migration 从 10 秒降到 1-2 秒。

### 5.3 方案二：SQLite 内存数据库 + Schema Dump

结合 SQLite 和 Schema Dump，双倍加速：

```bash
# 先用 SQLite 生成 schema dump
DB_CONNECTION=sqlite DB_DATABASE=:memory: php artisan migrate
php artisan schema:dump --database=sqlite

# 生成 database/schema/sqlite-schema.sql
```

```xml
<!-- phpunit.xml -->
<php>
    <env name="DB_CONNECTION" value="sqlite"/>
    <env name="DB_DATABASE" value=":memory:"/>
    <env name="DB_DUMP_FILE_PATH" value="database/schema/sqlite-schema.sql"/>
</php>
```

### 5.4 方案三：并行测试

Laravel 的 `parallel` 选项让测试在多个进程中并行执行：

```bash
php artisan test --parallel
```

每个进程有自己的数据库，避免数据冲突：

```php
// phpunit.xml
<php>
    <env name="DB_CONNECTION" value="mysql_testing"/>
    <!-- 并行测试时，每个进程使用不同的数据库 -->
    <!-- Laravel 会自动创建 test_1, test_2, test_3... -->
</php>
```

并行测试的数据库命名规则：

```php
// config/database.php
'mysql_testing' => [
    'driver' => 'mysql',
    'host' => env('DB_HOST', '127.0.0.1'),
    'database' => env('DB_DATABASE', 'test') . '_' . env('TEST_TOKEN', ''),
    // 进程 1: test_1, 进程 2: test_2, ...
],
```

### 5.5 方案四：Migration Squash

对于老项目，migration 文件可能有几百个。Laravel 11+ 支持 `squash`：

```bash
php artisan migrate --squash
```

将多个 migration 合并为一个 SQL 文件，删除原始文件。

### 5.6 方案五：跳过不必要的 Migration

有些 migration 只是为了添加索引或修改列，在测试中可以跳过：

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\RefreshDatabase;

trait OptimizedRefreshDatabase
{
    use RefreshDatabase;

    protected function shouldSkipMigration(object $migration): bool
    {
        // 跳过只修改索引的 migration
        return str_contains(get_class($migration), 'AddIndex') ||
               str_contains(get_class($migration), 'DropIndex');
    }
}
```

⚠️ 这个方案需要谨慎使用，确保跳过的 migration 不影响测试结果。

### 5.7 速度对比

| 方案 | 200 个 Migration | 500 个 Migration |
|------|------------------|------------------|
| 原始 migrate:fresh | 10s | 25s |
| Schema Dump | 2s | 3s |
| Schema Dump + SQLite | 0.5s | 1s |
| 并行测试（4 进程） | 3s | 7s |
| Schema Dump + SQLite + 并行 | 0.2s | 0.3s |

---

## 六、实战：完整的测试基类

综合以上所有策略，一个生产级的测试基类：

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    /**
     * 是否使用内存数据库
     */
    protected bool $useInMemoryDatabase = true;

    /**
     * 需要的 seeders
     */
    protected array $seeders = [];

    protected function setUp(): void
    {
        parent::setUp();

        // 执行 seeders
        if (!empty($this->seeders)) {
            $this->seed($this->seeders);
        }
    }

    /**
     * 断言表存在
     */
    protected function assertTableExists(string $table): void
    {
        $this->assertTrue(
            Schema::hasTable($table),
            "Table [{$table}] does not exist."
        );
    }

    /**
     * 断言记录数
     */
    protected function assertRecordCount(string $table, int $expected, array $conditions = []): void
    {
        $query = DB::table($table);
        foreach ($conditions as $column => $value) {
            $query->where($column, $value);
        }
        $this->assertEquals($expected, $query->count(), "Record count mismatch in table [{$table}].");
    }

    /**
     * 执行 SQL 并返回影响行数
     */
    protected function executeSql(string $sql, array $bindings = []): int
    {
        return DB::affectingStatement($sql, $bindings);
    }
}

// 使用示例
class OrderServiceTest extends TestCase
{
    protected array $seeders = [
        \Database\Seeders\BaseSeeder::class,
        \Database\Seeders\EcommerceScenarioSeeder::class,
    ];

    public function test_order_creation_flow(): void
    {
        $user = User::factory()->create();
        $product = Product::factory()->create(['price' => 100]);

        $order = app(OrderService::class)->create([
            'user_id' => $user->id,
            'product_id' => $product->id,
        ]);

        $this->assertRecordCount('orders', 1, ['user_id' => $user->id]);
        $this->assertRecordCount('order_items', 1, ['order_id' => $order->id]);
    }
}
```

---

## 七、常见踩坑与解决方案

### 7.1 清除缓存

内存数据库没有持久化，`config:cache` 和 `route:cache` 可能导致问题：

```php
protected function setUp(): void
{
    // 清除缓存
    $this->afterApplicationCreated(function () {
        \Illuminate\Support\Facades\Artisan::call('cache:clear');
        \Illuminate\Support\Facades\Artisan::call('config:clear');
    });
    parent::setUp();
}
```

### 7.2 测试间共享数据

有些数据（如系统配置）需要在所有测试间共享，不要放在事务回滚中：

```php
// 在 TestCase 中使用 beforeApplicationDestroyed 回调
protected function setUp(): void
{
    parent::setUp();
    // 在 setUp 中不要创建需要跨测试保留的数据
    // 改用 RefreshDatabase 的 seed 方法
    $this->seed(BaseSeeder::class);
}
```

### 7.3 事务回滚与事件监听

`afterCommit` 事件在事务回滚中不会触发，可能导致测试行为与生产不一致：

```php
<?php

// 业务代码
class OrderObserver
{
    public function created(Order $order): void
    {
        // 这个事件在测试中不会触发（因为事务被回滚了）
        dispatch(new SendOrderNotification($order));
    }
}

// 解决方案：在测试中手动触发事件
class OrderTest extends TestCase
{
    public function test_order_notification(): void
    {
        // 使用 fake 替代
        Queue::fake();

        $order = Order::factory()->create();

        // 手动触发事件
        event(new OrderCreated($order));

        Queue::assertPushed(SendOrderNotification::class);
    }
}
```

### 7.4 SQLite 不支持的 SQL

遇到 SQLite 不支持的 SQL 语法时，可以用条件判断：

```php
<?php

public function test_raw_query(): void
{
    if (config('database.default') === 'sqlite') {
        $this->markTestSkipped('SQLite does not support this query.');
    }

    // MySQL 原生 SQL
    DB::statement('ALTER TABLE orders ADD INDEX idx_status (status)');
}
```

---

## 八、总结

| 策略 | 适用场景 | 复杂度 | 效果 |
|------|----------|--------|------|
| 事务回滚 | 所有数据库测试 | 低 | 数据隔离 |
| SQLite :memory: | 无 MySQL 特性依赖 | 低 | 速度 5-10x |
| 分层 Seeding | 复杂业务场景 | 中 | 维护性提升 |
| Schema Dump | Migration 文件多 | 低 | 速度 5-10x |
| 并行测试 | 测试数量大 | 中 | 总时间 /N |

**最佳实践清单**：

1. 使用 `RefreshDatabase` trait，不要手动管理事务
2. 测试配置用 SQLite :memory:，除非需要 MySQL 特性
3. 使用 `schema:dump` 加速迁移
4. Factory 创建测试数据，不要硬编码 SQL
5. 分层管理 Seed：Base → Scenario → Test
6. 使用 `--parallel` 并行执行
7. 外键约束在 SQLite 中默认关闭，记得开启

数据库测试不是可选项，而是项目的安全网。投入时间建立好的测试基础设施，会在长期回报巨大的开发信心和速度。

---

> 参考文档
> - [Laravel Testing: Database](https://laravel.com/docs/10.x/database-testing)
> - [PHPUnit Database Testing](https://phpunit.readthedocs.io/en/10.0/fixtures.html)
> - [SQLite vs MySQL Compatibility](https://www.sqlite.org/omitted.html)
