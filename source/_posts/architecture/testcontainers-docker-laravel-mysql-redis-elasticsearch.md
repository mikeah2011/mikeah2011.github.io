---
title: "Testcontainers 实战：Docker 容器化集成测试——Laravel 测试中的真实 MySQL/Redis/Elasticsearch 环境"
keywords: [Testcontainers, Docker, Laravel, MySQL, Redis, Elasticsearch, 容器化集成测试, 测试中的真实, 环境, 架构]
date: 2026-06-10 02:16:00
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
tags:
  - Testcontainers
  - Docker
  - Laravel
  - 集成测试
  - PHPUnit
  - CI/CD
description: "告别 SQLite 内存数据库和 Mock，用 Testcontainers 在 Laravel 测试中拉起真实的 MySQL、Redis、Elasticsearch 容器，实现与生产环境一致的集成测试。"
---


## 为什么需要 Testcontainers

Laravel 开发者写测试时最常见的妥协：

- 用 SQLite 内存库跑 Feature Test，但 MySQL 的 JSON 查询、全文索引、事务隔离级别全对不上
- 用 `Redis::fake()` 测缓存逻辑，但 Pipeline、Lua 脚本、过期策略的真实行为被跳过
- Elasticsearch 直接 Mock 掉，搜索排序逻辑从不真测

结果就是：**本地测试全绿，上线就炸。**

Testcontainers 的思路很简单——测试启动时用 Docker 拉起真实的 MySQL、Redis、ES 容器，跑完自动销毁。环境和生产一致，数据隔离干净。

## 核心概念

Testcontainers 最早是 Java 生态的工具（`testcontainers/testcontainers-java`），PHP 社区的移植版本是 `testcontainers/testcontainers-php`。核心流程：

1. **Before Test** → 启动 Docker 容器（MySQL 8.0、Redis 7、ES 8.x）
2. **获取连接信息** → 容器随机端口映射到 localhost，拿到真实 host:port
3. **跑测试** → 代码连真实服务，行为和生产一致
4. **After Test** → 容器销毁，数据不留

### 与传统方案对比

| 方案 | 真实性 | 速度 | 维护成本 | 数据隔离 |
|------|--------|------|----------|----------|
| SQLite 内存库 | ❌ 差异大 | ⚡ 快 | 低 | 好 |
| 共享测试数据库 | ✅ 真实 | ⚡ 快 | 高（污染风险） | 差 |
| Docker Compose 手动管理 | ✅ 真实 | 🐢 慢 | 中 | 好 |
| **Testcontainers** | ✅ 真实 | ⚡ 快 | 低 | 好 |

## 环境准备

### 前置条件

- Docker Desktop（或 OrbStack / Colima）运行中
- PHP 8.2+
- Laravel 10/11

### 安装依赖

```bash
composer require --dev testcontainers/testcontainers
```

如果你的项目还需要 Elasticsearch 容器：

```bash
composer require --dev elasticsearch/elasticsearch
```

### 确认 Docker 可用

```bash
docker ps
# 确保输出正常，没有报错
```

## 实战一：MySQL 容器化测试

### 创建 MySQL Testcontainer Trait

先创建一个 Trait，让所有需要 MySQL 的测试都能复用：

```php
<?php
// tests/Traits/UsesMySQLContainer.php

namespace Tests\Traits;

use Testcontainers\Container\MySQLContainer;
use Illuminate\Support\Facades\Config;

trait UsesMySQLContainer
{
    protected static ?MySQLContainer $mysqlContainer = null;

    public static function setUpMySQLContainer(): void
    {
        if (self::$mysqlContainer === null) {
            self::$mysqlContainer = (new MySQLContainer('mysql:8.0'))
                ->withDatabase('test_db')
                ->withUser('test_user')
                ->withPassword('test_password')
                ->withEnvironmentVariables([
                    'MYSQL_ROOT_PASSWORD' => 'root_password',
                ]);

            self::$mysqlContainer->start();

            // 等待 MySQL 就绪
            self::$mysqlContainer->waitForReady();
        }

        // 动态覆盖 Laravel 数据库配置
        Config::set('database.connections.mysql.host', '127.0.0.1');
        Config::set('database.connections.mysql.port', self::$mysqlContainer->getMappedPort(3306));
        Config::set('database.connections.mysql.database', 'test_db');
        Config::set('database.connections.mysql.username', 'test_user');
        Config::set('database.connections.mysql.password', 'test_password');
    }

    public static function tearDownMySQLContainer(): void
    {
        // 每次测试后重建 schema，保证隔离
        if (self::$mysqlContainer !== null) {
            $pdo = new \PDO(
                sprintf(
                    'mysql:host=127.0.0.1;port=%d;dbname=test_db',
                    self::$mysqlContainer->getMappedPort(3306)
                ),
                'test_user',
                'test_password'
            );
            $pdo->exec('DROP DATABASE IF EXISTS test_db');
            $pdo->exec('CREATE DATABASE test_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        }
    }

    public static function destroyMySQLContainer(): void
    {
        if (self::$mysqlContainer !== null) {
            self::$mysqlContainer->stop();
            self::$mysqlContainer = null;
        }
    }
}
```

### 编写一个真实的 Feature Test

```php
<?php
// tests/Feature/OrderCreationTest.php

namespace Tests\Feature;

use Tests\TestCase;
use Tests\Traits\UsesMySQLContainer;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

class OrderCreationTest extends TestCase
{
    use UsesMySQLContainer, RefreshDatabase;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        self::setUpMySQLContainer();
    }

    public static function tearDownAfterClass(): void
    {
        self::destroyMySQLContainer();
        parent::tearDownAfterClass();
    }

    protected function setUp(): void
    {
        parent::setUp();
        self::tearDownMySQLContainer(); // 重建 schema
        $this->artisan('migrate');
    }

    public function test_create_order_with_inventory_check()
    {
        $user = User::factory()->create();
        $product = Product::factory()->create([
            'stock' => 10,
            'price' => 99.90,
        ]);

        $response = $this->actingAs($user)->postJson('/api/orders', [
            'product_id' => $product->id,
            'quantity' => 3,
        ]);

        $response->assertStatus(201);

        // 验证库存扣减（这里测的是真实的 MySQL 事务，不是 SQLite 的模拟）
        $this->assertDatabaseHas('products', [
            'id' => $product->id,
            'stock' => 7,
        ]);

        $order = Order::latest()->first();
        $this->assertEquals(299.70, (float) $order->total_amount);
    }

    public function test_concurrent_order_exceeds_stock()
    {
        // 这个测试在 SQLite 内存库中可能行为不一致
        // 但在真实 MySQL 中，事务隔离级别会正确处理并发
        $user = User::factory()->create();
        $product = Product::factory()->create(['stock' => 1]);

        // 第一单成功
        $this->actingAs($user)->postJson('/api/orders', [
            'product_id' => $product->id,
            'quantity' => 1,
        ])->assertStatus(201);

        // 第二单应因库存不足失败
        $this->actingAs($user)->postJson('/api/orders', [
            'product_id' => $product->id,
            'quantity' => 1,
        ])->assertStatus(422);
    }
}
```

### 关键点：为什么不用 SQLite

上面的 `test_concurrent_order_exceeds_stock` 在 SQLite 内存库中可能有不同表现，因为：

- SQLite 默认 `journal_mode=WAL`，并发写入行为和 MySQL InnoDB 的 `REPEATABLE READ` 不同
- SQLite 没有行级锁的概念，`SELECT ... FOR UPDATE` 语法虽然支持但实现完全不同
- MySQL 的 `AUTO_INCREMENT` 锁机制和 SQLite 的 `ROWID` 自增完全不同

## 实战二：Redis 容器化测试

### Redis Container Trait

```php
<?php
// tests/Traits/UsesRedisContainer.php

namespace Tests\Traits;

use Testcontainers\Container\RedisContainer;
use Illuminate\Support\Facades\Config;

trait UsesRedisContainer
{
    protected static ?RedisContainer $redisContainer = null;

    public static function setUpRedisContainer(): void
    {
        if (self::$redisContainer === null) {
            self::$redisContainer = new RedisContainer('redis:7-alpine');
            self::$redisContainer->start();
            self::$redisContainer->waitForReady();
        }

        Config::set('database.redis.default.host', '127.0.0.1');
        Config::set('database.redis.default.port', self::$redisContainer->getMappedPort(6379));
    }

    public static function destroyRedisContainer(): void
    {
        if (self::$redisContainer !== null) {
            self::$redisContainer->stop();
            self::$redisContainer = null;
        }
    }

    /**
     * 每次测试前清空 Redis，保证隔离
     */
    public function flushRedis(): void
    {
        \Illuminate\Support\Facades\Redis::flushdb();
    }
}
```

### 测试缓存和限流逻辑

```php
<?php
// tests/Feature/ApiRateLimitTest.php

namespace Tests\Feature;

use Tests\TestCase;
use Tests\Traits\UsesRedisContainer;
use Illuminate\Support\Facades\Cache;

class ApiRateLimitTest extends TestCase
{
    use UsesRedisContainer;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        self::setUpRedisContainer();
    }

    public static function tearDownAfterClass(): void
    {
        self::destroyRedisContainer();
        parent::tearDownAfterClass();
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->flushRedis();
    }

    public function test_rate_limit_blocks_after_threshold()
    {
        $user = \App\Models\User::factory()->create();

        // 前 60 次请求正常
        for ($i = 0; $i < 60; $i++) {
            $response = $this->actingAs($user)->getJson('/api/products');
            $response->assertStatus(200);
        }

        // 第 61 次被限流
        $response = $this->actingAs($user)->getJson('/api/products');
        $response->assertStatus(429);
    }

    public function test_cache_warmer_sets_correct_ttl()
    {
        // 测试缓存预热逻辑
        $this->artisan('cache:warm-products');

        // 这里测的是真实 Redis，TTL 是精确的秒数
        $ttl = Cache::store('redis')->ttl('products:all');
        $this->assertGreaterThan(0, $ttl);
        $this->assertLessThanOrEqual(3600, $ttl);
    }
}
```

## 实战三：Elasticsearch 容器化测试

### ES Container Trait

```php
<?php
// tests/Traits/UsesElasticsearchContainer.php

namespace Tests\Traits;

use Testcontainers\Container\GenericContainer;
use Elasticsearch\ClientBuilder;
use Illuminate\Support\Facades\Config;

trait UsesElasticsearchContainer
{
    protected static ?GenericContainer $esContainer = null;
    protected static ?\Elasticsearch\Client $esClient = null;

    public static function setUpElasticsearchContainer(): void
    {
        if (self::$esContainer === null) {
            self::$esContainer = (new GenericContainer('elasticsearch:8.13.0'))
                ->withEnvironmentVariables([
                    'discovery.type' => 'single-node',
                    'xpack.security.enabled' => 'false',
                    'ES_JAVA_OPTS' => '-Xms512m -Xmx512m',
                ])
                ->withExposedPorts(9200);

            self::$esContainer->start();
            self::$esContainer->waitForReady();

            // ES 启动较慢，额外等待
            sleep(5);
        }

        $port = self::$esContainer->getMappedPort(9200);
        $host = sprintf('http://127.0.0.1:%d', $port);

        Config::set('services.elasticsearch.host', $host);

        self::$esClient = ClientBuilder::create()
            ->setHosts([$host])
            ->build();
    }

    public static function destroyElasticsearchContainer(): void
    {
        if (self::$esContainer !== null) {
            self::$esContainer->stop();
            self::$esContainer = null;
            self::$esClient = null;
        }
    }

    protected function getEsClient(): \Elasticsearch\Client
    {
        return self::$esClient;
    }
}
```

### 测试搜索功能

```php
<?php
// tests/Feature/ProductSearchTest.php

namespace Tests\Feature;

use Tests\TestCase;
use Tests\Traits\UsesElasticsearchContainer;
use App\Models\Product;

class ProductSearchTest extends TestCase
{
    use UsesElasticsearchContainer;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        self::setUpElasticsearchContainer();
    }

    public static function tearDownAfterClass(): void
    {
        self::destroyElasticsearchContainer();
        parent::tearDownAfterClass();
    }

    protected function setUp(): void
    {
        parent::setUp();

        // 删除并重建索引
        $client = $this->getEsClient();
        if ($client->indices()->exists(['index' => 'products'])) {
            $client->indices()->delete(['index' => 'products']);
        }

        $client->indices()->create([
            'index' => 'products',
            'body' => [
                'mappings' => [
                    'properties' => [
                        'name' => ['type' => 'text', 'analyzer' => 'standard'],
                        'description' => ['type' => 'text'],
                        'price' => ['type' => 'float'],
                        'category' => ['type' => 'keyword'],
                    ],
                ],
            ],
        ]);
    }

    public function test_full_text_search_returns_relevant_results()
    {
        // 写入测试数据到 ES
        $client = $this->getEsClient();

        $products = [
            ['name' => 'MacBook Pro 14寸 M3芯片', 'description' => 'Apple 笔记本电脑', 'price' => 14999, 'category' => 'laptop'],
            ['name' => 'ThinkPad X1 Carbon', 'description' => '商务轻薄笔记本', 'price' => 9999, 'category' => 'laptop'],
            ['name' => 'iPhone 15 Pro Max', 'description' => 'Apple 智能手机', 'price' => 9999, 'category' => 'phone'],
        ];

        foreach ($products as $i => $product) {
            $client->index([
                'index' => 'products',
                'id' => $i + 1,
                'body' => $product,
            ]);
        }

        $client->indices()->refresh(['index' => 'products']);

        // 测试搜索 API
        $response = $this->getJson('/api/search?q=Apple+笔记本');
        $response->assertStatus(200);
        $response->assertJsonCount(1, 'data'); // 应该只返回 MacBook
    }
}
```

## 完整的 BaseTestCase 封装

把所有容器逻辑封装到一个基类里，让测试代码更干净：

```php
<?php
// tests/BaseTestCase.php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTC;
use Tests\Traits\UsesMySQLContainer;
use Tests\Traits\UsesRedisContainer;
use Tests\Traits\UsesElasticsearchContainer;

abstract class ContainerTestCase extends BaseTC
{
    use UsesMySQLContainer, UsesRedisContainer, UsesElasticsearchContainer;

    /**
     * 子类覆盖这个方法来声明需要哪些容器
     * @return string[] ['mysql', 'redis', 'elasticsearch']
     */
    protected function requiredContainers(): array
    {
        return ['mysql'];
    }

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();

        $instance = new static();
        $containers = $instance->requiredContainers();

        if (in_array('mysql', $containers)) {
            self::setUpMySQLContainer();
        }
        if (in_array('redis', $containers)) {
            self::setUpRedisContainer();
        }
        if (in_array('elasticsearch', $containers)) {
            self::setUpElasticsearchContainer();
        }
    }

    public static function tearDownAfterClass(): void
    {
        $instance = new static();
        $containers = $instance->requiredContainers();

        if (in_array('elasticsearch', $containers)) {
            self::destroyElasticsearchContainer();
        }
        if (in_array('redis', $containers)) {
            self::destroyRedisContainer();
        }
        if (in_array('mysql', $containers)) {
            self::destroyMySQLContainer();
        }

        parent::tearDownAfterClass();
    }
}
```

使用时：

```php
<?php

class OrderTest extends ContainerTestCase
{
    protected function requiredContainers(): array
    {
        return ['mysql', 'redis'];
    }

    // 测试方法...
}
```

## CI/CD 集成

### GitHub Actions 配置

```yaml
# .github/workflows/tests.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      # 不需要手动定义 services，Testcontainers 自己管理
      # 但需要确保 Docker 可用
    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: mbstring, xml, ctype, json, bcmath, pdo, mysql, redis
          coverage: none

      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Run Tests with Testcontainers
        run: php artisan test --parallel
        env:
          DB_CONNECTION: mysql
          # Testcontainers 会动态覆盖这些值
```

### GitLab CI 配置

```yaml
# .gitlab-ci.yml
test:
  image: php:8.3-cli
  services:
    - docker:dind
  variables:
    DOCKER_HOST: tcp://docker:2375
  before_script:
    - apt-get update && apt-get install -y libpq-dev libzip-dev unzip
    - curl -sS https://getcomposer.org/installer | php
    - php composer.phar install
  script:
    - php artisan test
```

**关键点：** CI 环境中必须启用 Docker-in-Docker（dind），因为 Testcontainers 需要调用 Docker API 来创建和销毁容器。

## 踩坑记录

### 1. 容器启动慢，测试套件跑 5 分钟

**问题：** 每个测试类都启动一套容器，ES 容器尤其慢（30-60 秒）。

**解决：** 用 `static` 属性复用容器，整个测试套件只启动一次。上面的 Trait 已经用了这个模式。但要注意：

```php
// ❌ 每个测试方法都启动容器
protected function setUp(): void
{
    $this->container = new MySQLContainer();
    $this->container->start();
}

// ✅ 整个类共享一个容器
protected static ?MySQLContainer $mysqlContainer = null;
public static function setUpBeforeClass(): void
{
    if (self::$mysqlContainer === null) {
        self::$mysqlContainer = new MySQLContainer();
        self::$mysqlContainer->start();
    }
}
```

### 2. 端口冲突：容器映射端口被占用

**问题：** 偶尔报 `port already in use`。

**解决：** Testcontainers 默认使用随机端口映射，不应该出现这个问题。如果出现，检查是否有代码硬编码了端口：

```php
// ❌ 硬编码端口
Config::set('database.connections.mysql.port', 3306);

// ✅ 使用容器的映射端口
Config::set('database.connections.mysql.port', self::$mysqlContainer->getMappedPort(3306));
```

### 3. macOS 上 Docker Desktop 内存不够

**问题：** 同时跑 MySQL + Redis + ES，Docker 内存爆了。

**解决：** 在 Docker Desktop 设置中至少分配 4GB 内存。或者用 OrbStack（更轻量）：

```bash
brew install orbstack
# OrbStack 默认资源限制更宽松
```

### 4. RefreshDatabase 和容器冲突

**问题：** `RefreshDatabase` trait 会尝试在 `setUp` 中迁移，但容器还没启动。

**解决：** 确保容器在 `setUpBeforeClass` 中启动（类级别），迁移在 `setUp` 中执行（方法级别）：

```php
public static function setUpBeforeClass(): void
{
    self::setUpMySQLContainer(); // 容器启动
}

protected function setUp(): void
{
    parent::setUp();
    $this->artisan('migrate'); // 然后迁移
}
```

### 5. ES 容器健康检查超时

**问题：** ES 启动后需要时间初始化，直接写入会报 `ClusterBlockException`。

**解决：** 加显式等待：

```php
self::$esContainer->waitForReady();

// 额外轮询 ES 集群状态
$client = ClientBuilder::create()
    ->setHosts([$host])
    ->build();

$retries = 0;
while ($retries < 30) {
    try {
        $health = $client->cluster()->health();
        if ($health['status'] === 'green' || $health['status'] === 'yellow') {
            break;
        }
    } catch (\Exception $e) {
        // 还没就绪
    }
    sleep(1);
    $retries++;
}
```

## 性能优化

### 容器复用策略

```php
// 用一个全局的 ContainerManager 管理所有容器生命周期
class ContainerManager
{
    private static array $containers = [];

    public static function get(string $type): mixed
    {
        if (!isset(self::$containers[$type])) {
            self::$containers[$type] = self::create($type);
        }
        return self::$containers[$type];
    }

    public static function shutdownAll(): void
    {
        foreach (self::$containers as $container) {
            $container->stop();
        }
        self::$containers = [];
    }
}
```

### 并行测试支持

Laravel 的 `--parallel` 选项会创建多个测试进程。每个进程需要自己的容器实例：

```php
// 用进程 ID 隔离容器
$pid = getmypid();
$containerName = "test_mysql_{$pid}";
```

## 总结

Testcontainers 解决了集成测试的核心矛盾：**想要真实环境，又不想维护复杂的测试基础设施。**

关键收益：

- **环境一致性**：测试跑在和生产相同的 MySQL/Redis/ES 版本上
- **零配置隔离**：每个测试套件有自己的容器，数据互不干扰
- **CI 友好**：GitHub Actions / GitLab CI 中直接可用，不需要额外配置 services
- **类型安全**：容器连接信息是代码生成的，不是配置文件里写死的

什么时候该用 Testcontainers：

- 项目有数据库事务、锁、JSON 查询等 MySQL 特性依赖
- 需要测 Redis Pipeline、Lua 脚本、过期策略
- 有 Elasticsearch 搜索排序逻辑
- 团队多人协作，测试环境不一致导致「我本地没问题」

什么时候不需要：

- 纯单元测试（Mock 就够了）
- 项目用 SQLite 就能满足所有数据库需求
- 测试量很小，手动管理 Docker Compose 也能接受

从今天开始，把「本地全绿、上线就炸」变成历史。
