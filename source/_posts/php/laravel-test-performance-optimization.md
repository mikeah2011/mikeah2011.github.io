---
title: Laravel 测试性能优化实战：并行测试、数据库内存模式、测试数据共享——从 30 分钟到 3 分钟的测试套件加速
keywords: [Laravel, 测试性能优化实战, 并行测试, 数据库内存模式, 测试数据共享, 分钟到, 分钟的测试套件加速, PHP]
date: 2026-06-09 23:18:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - Laravel
  - PHPUnit
  - 测试优化
  - 并行测试
  - 性能调优
description: 当 Laravel 项目测试套件跑完需要 30 分钟，CI/CD 流水线变成瓶颈时，如何通过并行测试、SQLite 内存数据库、测试数据共享等手段将执行时间压缩到 3 分钟？本文从实际项目出发，手把手拆解每一步优化策略。
---


## 问题背景

一个中型 Laravel 项目，2000+ 测试用例，完整跑完需要 30 分钟。每次提 PR 都要等半小时，开发者开始在 CI 跑完之前合并代码，测试形同虚设。

这不是个例。很多 Laravel 项目在测试数量增长到一定规模后都会遇到这个问题。好消息是，Laravel 生态提供了完整的解决方案，不需要换框架，不需要重写测试，只需要系统性地应用几个优化策略。

本文记录了我们将一个 30 分钟的测试套件压缩到 3 分钟的完整过程。

## 优化策略总览

| 策略 | 耗时缩减 | 实施难度 | 风险 |
|------|----------|----------|------|
| SQLite 内存数据库 | 约 60% | 低 | 低 |
| 并行测试 | 约 70% | 中 | 中 |
| 测试数据共享 | 约 40% | 中 | 中 |
| 浏览器测试分离 | 约 20% | 低 | 低 |

注意：这些百分比不是简单相加，而是叠加效果。最终从 30 分钟降到 3 分钟，整体加速约 10 倍。

## 策略一：SQLite 内存数据库

### 原理

默认配置下，每个测试用例都会执行一次数据库迁移（`RefreshDatabase` 或 `DatabaseMigrations` trait）。如果用 MySQL，每次迁移涉及网络 I/O、磁盘写入，单次迁移可能需要 200-500ms。2000 个测试，每个跑两次迁移（setUp/tearDown），光迁移就消耗 15-20 分钟。

SQLite 内存模式下，数据库完全在 RAM 中运行，迁移速度提升 50-100 倍。

### 配置

创建测试专用配置文件 `phpunit.xml`：

```xml
<phpunit>
    <php>
        <env name="DB_CONNECTION" value="sqlite"/>
        <env name="DB_DATABASE" value=":memory:"/>
        <env name="CACHE_DRIVER" value="array"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="SESSION_DRIVER" value="array"/>
        <env name="MAIL_MAILER" value="array"/>
    </php>
</phpunit>
```

### 处理 SQLite 不兼容的语法

这是最容易踩坑的地方。MySQL 和 SQLite 在 SQL 语法上有差异，最常见的问题：

**1. JSON 查询不兼容**

```php
// MySQL 风格
User::whereJsonContains('tags', 'admin')->get();

// SQLite 3.38+ 支持 json_each，但 Laravel 的 whereJsonContains
// 在 SQLite 上行为可能不同。解决方案：

// 在测试中使用数组断言而非数据库查询
$users = User::all();
$this->assertTrue(
    $users->pluck('tags')->flatten()->contains('admin')
);
```

**2. 枚举类型不兼容**

```php
// MySQL migration
Schema::create('orders', function (Blueprint $table) {
    $table->enum('status', ['pending', 'paid', 'shipped']);
});

// SQLite 不支持 ENUM，改为 string 验证
Schema::create('orders', function (Blueprint $table) {
    $table->string('status', 20);
});

// 或者使用 Laravel 的 enum cast
protected $casts = [
    'status' => OrderStatus::class,
];
```

**3. 外键约束差异**

SQLite 默认关闭外键约束，需要显式开启：

```php
// 在 TestCase setUp 中
protected function setUp(): void
{
    parent::setUp();
    
    if (config('database.default') === 'sqlite') {
        DB::statement('PRAGMA foreign_keys = ON');
    }
}
```

**4. 索引命名冲突**

MySQL 和 SQLite 对索引的处理不同，某些复杂的迁移可能需要条件分支：

```php
// 在 migration 中
if (config('database.default') === 'sqlite') {
    // SQLite 兼容写法
    $table->index(['user_id', 'created_at']);
} else {
    // MySQL 完整写法
    $table->index(['user_id', 'created_at'], 'idx_user_orders_date');
}
```

### 实战效果

切换到 SQLite 内存模式后，单个测试的数据库操作从平均 300ms 降到 5ms。整体迁移时间从 15 分钟降到约 2 分钟。

## 策略二：并行测试

### 原理

PHPUnit 10+ 原生支持并行测试，Laravel 通过 `parallel-testing` 包进一步简化了配置。核心思路：将测试用例分配到多个进程同时执行，充分利用多核 CPU。

### 配置

安装依赖：

```bash
composer require --dev brianium/paratest
```

在 `phpunit.xml` 中配置：

```xml
<phpunit>
    <php>
        <!-- 之前 SQLite 的配置保留 -->
        <env name="PARATEST" value="1"/>
    </php>
</phpunit>
```

运行并行测试：

```bash
# 自动检测 CPU 核数
php artisan test --parallel

# 指定进程数（推荐 CPU 核数的 1-2 倍）
php artisan test --parallel --processes=8

# 结合 SQLite 内存模式（每个进程独立内存数据库）
php artisan test --parallel --processes=8 --recreate-databases
```

### 并行测试的陷阱

**1. 数据库隔离问题**

并行测试最大的挑战是数据库隔离。每个进程需要独立的数据库，否则测试之间会互相污染。

```php
// Laravel 的 --parallel 会自动为每个进程创建独立数据库
// 数据库命名规则：{原数据库名}_test_{进程号}

// 但如果你用了自定义的数据库名，需要处理：
// config/database.php
'connections' => [
    'testing' => [
        'driver' => 'sqlite',
        'database' => env('DB_DATABASE', ':memory:'),
        // 并行时每个进程自动获得独立内存数据库
    ],
]
```

**2. 文件系统冲突**

多个进程同时写文件（日志、缓存、上传）会导致冲突：

```php
// 解决方案：使用进程隔离的临时目录
protected function setUp(): void
{
    parent::setUp();
    
    // 每个测试进程使用独立的存储目录
    $processId = getenv('TEST_TOKEN') ?: getmypid();
    $this->app['config']->set(
        'filesystems.disks.local.root',
        storage_path("app/test_{$processId}")
    );
}
```

**3. 端口冲突**

如果测试涉及 HTTP 服务器或 WebSocket，需要确保端口不冲突：

```php
// 使用 Laravel Dusk 浏览器测试时
protected function setUp(): void
{
    parent::setUp();
    
    $processId = getenv('TEST_TOKEN') ?: 0;
    $port = 9500 + $processId; // 每个进程使用不同端口
    $this->app['config']->set('dusk.port', $port);
}
```

**4. 测试顺序依赖**

并行测试天然打乱执行顺序。如果你的测试有依赖关系（A 依赖 B 的结果），这是设计缺陷，必须修复：

```php
// 错误：测试之间有依赖
public function test_create_user(): void
{
    $user = User::create(['name' => 'test']);
    // 写入文件让下一个测试读取
    file_put_contents('/tmp/user_id', $user->id);
}

public function test_update_user(): void
{
    $userId = file_get_contents('/tmp/user_id'); // 依赖上一个测试
    // ...
}

// 正确：每个测试自包含
public function test_create_user(): void
{
    $user = User::create(['name' => 'test']);
    $this->assertDatabaseHas('users', ['name' => 'test']);
}

public function test_update_user(): void
{
    $user = User::factory()->create(); // 自己创建数据
    $user->update(['name' => 'updated']);
    $this->assertDatabaseHas('users', ['name' => 'updated']);
}
```

### 实战效果

8 核机器上，并行测试将执行时间从约 15 分钟降到约 4 分钟。加上 SQLite 内存模式，总时间约 5 分钟。

## 策略三：测试数据共享（Test Hooks）

### 原理

很多测试的 setUp 阶段都在做相同的事情：创建用户、设置权限、准备基础数据。如果 2000 个测试中有 1500 个需要创建用户，每个用户创建耗时 10ms，仅这一项就消耗 15 秒。

`beforeAll` / `afterAll` 允许在整个测试类（甚至整个测试套件）运行前/后执行一次操作。

### 实现

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Cache;

abstract class TestCase extends BaseTestCase
{
    /**
     * 测试套件级别的共享数据
     * 注意：并行模式下每个进程有独立的共享数据
     */
    protected static bool $sharedDataInitialized = false;
    protected static array $sharedUserIds = [];

    protected function setUp(): void
    {
        parent::setUp();
        
        if (!self::$sharedDataInitialized) {
            $this->initializeSharedData();
            self::$sharedDataInitialized = true;
        }
    }

    protected function initializeSharedData(): void
    {
        // 一次性创建所有测试需要的基础数据
        // 这些数据在整个测试类中共享
        $admin = \App\Models\User::create([
            'name' => 'Admin User',
            'email' => 'admin@test.com',
            'password' => bcrypt('password'),
        ]);
        $admin->assignRole('admin');
        self::$sharedUserIds['admin'] = $admin->id;

        $regularUser = \App\Models\User::create([
            'name' => 'Regular User',
            'email' => 'user@test.com',
            'password' => bcrypt('password'),
        ]);
        self::$sharedUserIds['user'] = $regularUser->id;
    }

    /**
     * 获取共享的管理员用户
     */
    protected function getAdminUser(): \App\Models\User
    {
        return \App\Models\User::find(self::$sharedUserIds['admin']);
    }

    /**
     * 获取共享的普通用户
     */
    protected function getRegularUser(): \App\Models\User
    {
        return \App\Models\User::find(self::$sharedUserIds['user']);
    }
}
```

在具体测试中使用：

```php
<?php

namespace Tests\Feature;

use Tests\TestCase;

class OrderTest extends TestCase
{
    public function test_user_can_create_order(): void
    {
        $user = $this->getRegularUser();
        
        $response = $this->actingAs($user)
            ->post('/api/orders', [
                'product_id' => 1,
                'quantity' => 2,
            ]);

        $response->assertStatus(201);
    }

    public function test_admin_can_view_all_orders(): void
    {
        $admin = $this->getAdminUser();
        
        $response = $this->actingAs($admin)
            ->get('/api/orders');

        $response->assertStatus(200);
    }
}
```

### 更激进的优化：全局共享数据

如果项目足够大，可以在 `tests/GlobalSetup.php` 中实现全局数据共享：

```php
<?php

namespace Tests;

use PHPUnit\Runner\BeforeFirstTestHook;

class GlobalSetup implements BeforeFirstTestHook
{
    public function executeBeforeFirstTest(): void
    {
        // 仅在非并行模式下使用
        // 并行模式下每个进程会独立执行
        if (env('PARATEST')) {
            return;
        }

        // 创建全局种子数据
        \App\Models\Category::insert([
            ['name' => 'Electronics', 'slug' => 'electronics'],
            ['name' => 'Books', 'slug' => 'books'],
            ['name' => 'Clothing', 'slug' => 'clothing'],
        ]);
    }
}
```

在 `phpunit.xml` 中注册：

```xml
<phpunit>
    <extensions>
        <bootstrap class="Tests\GlobalSetup"/>
    </extensions>
</phpunit>
```

### 注意事项

1. **共享数据是只读的**：不要在测试中修改共享数据，否则会影响其他测试
2. **并行模式需要独立副本**：`beforeAll` 在并行模式下每个进程执行一次，不是全局一次
3. **不要过度共享**：只共享创建成本高、使用频率高的数据

### 实战效果

测试数据共享将 setUp 阶段的耗时从约 3 分钟降到约 40 秒。

## 策略四：浏览器测试分离

### 原理

Dusk / Laravel 浏览器测试是最慢的测试类型，每个测试需要启动浏览器、渲染页面、等待 JavaScript。将它们从主测试套件中分离，单独运行或并行运行。

### 配置

```php
// phpunit.xml 中排除浏览器测试
<testsuites>
    <testsuite name="Unit">
        <directory>tests/Unit</directory>
    </testsuite>
    <testsuite name="Feature">
        <directory>tests/Feature</directory>
        <exclude>tests/Feature/Browser</exclude>
    </testsuite>
</testsuites>
```

单独运行浏览器测试：

```bash
# 主测试套件（快速）
php artisan test --parallel --processes=8

# 浏览器测试（单独跑，可以更少并行）
php artisan dusk --parallel --processes=2
```

### CI 配置

```yaml
# .github/workflows/tests.yml
jobs:
  tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        test-suite: ['feature', 'unit']
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
      - name: Install Dependencies
        run: composer install --no-progress
      - name: Run Tests
        run: php artisan test --parallel --processes=4 --testsuite=${{ matrix.test-suite }}

  browser-tests:
    runs-on: ubuntu-latest
    needs: tests
    steps:
      - uses: actions/checkout@v4
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
      - name: Install Dependencies
        run: composer install --no-progress
      - name: Run Dusk
        run: php artisan dusk --parallel --processes=2
```

## 综合效果

将所有策略组合后的效果：

| 阶段 | 优化前 | 优化后 |
|------|--------|--------|
| 数据库迁移 | 15 分钟 | 2 分钟 |
| 测试执行 | 12 分钟 | 3 分钟 |
| 数据准备 | 3 分钟 | 40 秒 |
| **总计** | **30 分钟** | **约 5 分钟** |

进一步优化（更激进的数据共享、更多并行进程）可以压缩到 3 分钟。

## 监控与度量

优化后需要持续监控，防止性能回退：

```php
// 在 TestCase 中添加性能监控
protected function tearDown(): void
{
    $time = microtime(true) - $this->startTime;
    
    if ($time > 2.0) { // 超过 2 秒的测试记录警告
        logger()->warning("Slow test detected", [
            'test' => $this->getName(),
            'time' => round($time, 2),
        ]);
    }
    
    parent::tearDown();
}
```

在 CI 中生成测试耗时报告：

```bash
php artisan test --parallel --processes=8 --log-junit=test-results.xml
```

然后用 `phpunit-coverage-badge` 或 CI 自带的报告功能分析哪些测试最慢。

## 总结

测试性能优化不是一次性工作，而是一个持续的过程。核心策略：

1. **SQLite 内存数据库**：消除磁盘 I/O 瓶颈，收益最大，风险最低
2. **并行测试**：充分利用多核 CPU，需要注意数据隔离
3. **测试数据共享**：减少重复的数据创建工作，但要小心状态污染
4. **浏览器测试分离**：将最慢的测试类型独立管理

最重要的是：先度量，再优化。不要盲目优化，用数据说话。

最后，不要为了追求速度而牺牲测试的可靠性。如果某个优化导致测试变得不稳定（随机失败），宁可慢一点也要保证可靠。
