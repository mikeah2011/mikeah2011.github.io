---
title: "Testcontainers 实战：Docker 容器化集成测试——Laravel 测试中的真实 MySQL/Redis/Elasticsearch 环境"
date: 2026-06-10 01:42:00
categories:
  - CICD
tags:
  - Testcontainers
  - Docker
  - Laravel
  - 集成测试
  - PHPUnit
  - CI/CD
description: "告别 SQLite 内存数据库和 Mock，用 Testcontainers 在 Laravel 测试中拉起真实的 MySQL、Redis、Elasticsearch 容器，让集成测试真正覆盖生产级行为。"
---

## 为什么需要 Testcontainers？

Laravel 开发者写测试时常见的做法：

- 用 SQLite 内存数据库替代 MySQL
- 用 `Redis::fake()` 或 Mock 替代真实 Redis
- Elasticsearch 直接跳过，靠「反正 CI 上跑过了」自我安慰

问题在于：SQLite 和 MySQL 的行为差异无处不在——JSON 字段查询、全文索引、`GROUP BY` 语义、事务隔离级别，甚至 `AUTO_INCREMENT` 的行为都不一样。Mock 更是自欺欺人，你 Mock 的是「你认为 Redis 会做什么」，而不是「Redis 真正会做什么」。

**Testcontainers 的思路很简单**：测试启动时，用 Docker API 拉起一个临时的 MySQL/Redis/Elasticsearch 容器，跑完测试自动销毁。每次都是全新的、隔离的、和生产环境一致的基础设施。

## 核心概念

### Testcontainers 是什么

Testcontainers 最早是 Java 生态的库（由 Richard North 创建），后来移植到了 Go、Node.js、Python、.NET 等语言。核心思路：

1. 测试启动时，通过 Docker API 创建一个容器
2. 等待容器就绪（health check）
3. 把容器的连接信息注入到测试环境
4. 测试结束后，自动清理容器

对于 PHP/Laravel 生态，主要有两个选择：

- **`testcontainers/testcontainers-php`**：原生 PHP 实现
- **`karriere/testcontainers-php`**：另一个流行的 PHP 实现

本文主要用 `testcontainers/testcontainers-php`，因为它更活跃、API 更现代。

## 环境准备

### 安装依赖

```bash
composer require --dev testcontainers/testcontainers
```

确保本机已安装 Docker Desktop 或 OrbStack，且 Docker daemon 正在运行。

### 验证 Docker 可用

```bash
docker ps
docker info
```

## 实战：为 Laravel 集成测试配置真实 MySQL

### 创建 Testcontainers 基础 TestCase

先创建一个基础的集成测试类，封装容器管理逻辑：

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Testcontainers\Container\MySQLContainer;
use Testcontainers\Container\RedisContainer;
use Testcontainers\DockerClientFactory;

abstract class IntegrationTestCase extends BaseTestCase
{
    use CreatesApplication;

    protected static ?MySQLContainer $mysqlContainer = null;
    protected static ?RedisContainer $redisContainer = null;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();

        // MySQL 容器：整个测试类共享一个容器
        if (static::$mysqlContainer === null) {
            static::$mysqlContainer = (new MySQLContainer('mysql:8.0'))
                ->withDatabase('test_db')
                ->withUser('test_user')
                ->withPassword('test_pass')
                ->withExposedPorts(3306)
                ->withWaitTimeout(120);

            static::$mysqlContainer->start();
        }

        // Redis 容器
        if (static::$redisContainer === null) {
            static::$redisContainer = (new RedisContainer('redis:7-alpine'))
                ->withExposedPorts(6379);

            static::$redisContainer->start();
        }
    }

    public static function tearDownAfterClass(): void
    {
        // 容器在进程结束时自动清理，也可以手动 stop
        parent::tearDownAfterClass();
    }

    protected function setUp(): void
    {
        parent::setUp();

        // 动态覆盖数据库配置
        $this->swapMySQLConfig();
        $this->swapRedisConfig();

        // 每个测试前重置数据库
        $this->artisan('migrate:fresh');
    }

    protected function swapMySQLConfig(): void
    {
        $host = static::$mysqlContainer->getHost();
        $port = static::$mysqlContainer->getMappedPort(3306);

        config([
            'database.connections.mysql.host'     => $host,
            'database.connections.mysql.port'      => $port,
            'database.connections.mysql.database'  => 'test_db',
            'database.connections.mysql.username'  => 'test_user',
            'database.connections.mysql.password'  => 'test_pass',
        ]);

        // 重置数据库管理器，让它用新配置
        DB::purge('mysql');
    }

    protected function swapRedisConfig(): void
    {
        $host = static::$redisContainer->getHost();
        $port = static::$redisContainer->getMappedPort(6379);

        config([
            'database.redis.default.host' => $host,
            'database.redis.default.port' => $port,
        ]);

        Redis::connections() && Redis::purge();
    }
}
```

### 编写真实的集成测试

现在写一个真实的测试场景——用户注册后，检查 MySQL 持久化和 Redis 缓存：

```php
<?php

namespace Tests\Feature;

use Tests\IntegrationTestCase;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class UserRegistrationTest extends IntegrationTestCase
{
    /** @test */
    public function 用户注册后数据写入真实MySQL()
    {
        $response = $this->postJson('/api/register', [
            'name'     => '张三',
            'email'    => 'zhangsan@example.com',
            'password' => 'secret123',
        ]);

        $response->assertStatus(201);

        // 直接查真实数据库，不是 SQLite
        $this->assertDatabaseHas('users', [
            'email' => 'zhangsan@example.com',
        ]);

        // 验证 JSON 字段存储（MySQL 特有行为）
        $user = User::where('email', 'zhangsan@example.com')->first();
        $this->assertNotNull($user);

        // 验证密码是 bcrypt 加密的
        $this->assertTrue(
            password_verify('secret123', $user->password)
        );
    }

    /** @test */
    public function 登录后token存入真实Redis()
    {
        // 先注册
        $this->postJson('/api/register', [
            'name'     => '李四',
            'email'    => 'lisi@example.com',
            'password' => 'secret123',
        ]);

        // 登录
        $response = $this->postJson('/api/login', [
            'email'    => 'lisi@example.com',
            'password' => 'secret123',
        ]);

        $response->assertStatus(200);
        $token = $response->json('token');

        // 验证 token 确实存在 Redis 中
        $this->assertTrue(
            Cache::store('redis')->has("token:{$token}")
        );
    }

    /** @test */
    public function 并发注册不会产生重复数据()
    {
        // 模拟并发请求，测试真实 MySQL 的唯一索引约束
        $promises = [];
        for ($i = 0; $i < 5; $i++) {
            $promises[] = $this->postJson('/api/register', [
                'name'     => '并发用户',
                'email'    => 'concurrent@example.com',
                'password' => 'secret123',
            ]);
        }

        // 只有第一个应该成功
        $successCount = collect($promises)->filter(
            fn($r) => $r->getStatusCode() === 201
        )->count();

        $this->assertEquals(1, $successCount);
        $this->assertEquals(
            1,
            DB::table('users')->where('email', 'concurrent@example.com')->count()
        );
    }
}
```

## 实战：Elasticsearch 容器集成

### 配置 Elasticsearch 容器

```php
<?php

namespace Tests;

use Testcontainers\Container\GenericContainer;
use Testcontainers\Wait\WaitForHttp;

abstract class ElasticsearchTestCase extends IntegrationTestCase
{
    protected static ?GenericContainer $esContainer = null;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();

        if (static::$esContainer === null) {
            static::$esContainer = (new GenericContainer('elasticsearch:8.12.0'))
                ->withExposedPorts(9200)
                ->withEnvironment('discovery.type', 'single-node')
                ->withEnvironment('xpack.security.enabled', 'false')
                ->withEnvironment('ES_JAVA_OPTS', '-Xms512m -Xmx512m')
                ->withWait(new WaitForHttp(
                    port: 9200,
                    path: '/_cluster/health',
                    statusCode: 200,
                    timeout: 120
                ));

            static::$esContainer->start();
        }
    }

    protected function setUp(): void
    {
        parent::setUp();

        $host = static::$esContainer->getHost();
        $port = static::$esContainer->getMappedPort(9200);

        config([
            'scout.driver'                => 'elasticsearch',
            'scout.elasticsearch.hosts'   => ["http://{$host}:{$port}"],
        ]);
    }

    protected function tearDown(): void
    {
        // 清理 ES 索引
        $this->artisan('scout:flush', ['model' => 'App\\Models\\Product']);
        parent::tearDown();
    }
}
```

### 搜索集成测试

```php
<?php

namespace Tests\Feature;

use Tests\ElasticsearchTestCase;
use App\Models\Product;
use Laravel\Scout\Searchable;

class ProductSearchTest extends ElasticsearchTestCase
{
    /** @test */
    public function 商品搜索在真实ES中正常工作()
    {
        // 创建测试数据
        Product::factory()->count(50)->create();

        // 等待 ES 索引同步
        sleep(2);

        // 执行搜索
        $results = Product::search('iPhone')->get();

        $this->assertTrue($results->count() > 0);

        // 验证搜索结果排序
        $results->each(function ($product) {
            $this->assertStringContainsString(
                'iPhone',
                $product->name . ' ' . $product->description
            );
        });
    }

    /** @test */
    public function ES分词器正确处理中文()
    {
        Product::create([
            'name'        => '苹果 iPhone 15 Pro Max',
            'description' => '全新钛金属设计，A17 Pro 芯片',
            'price'       => 9999,
        ]);

        sleep(2);

        // 中文分词测试
        $results = Product::search('钛金属')->get();
        $this->assertTrue($results->count() > 0);
    }
}
```

## GitHub Actions CI 配置

Testcontainers 在 CI 环境中需要 Docker 支持。GitHub Actions 的 Ubuntu runner 已预装 Docker：

```yaml
# .github/workflows/tests.yml
name: Integration Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  integration-tests:
    runs-on: ubuntu-latest

    services:
      # 传统方式：用 services 定义容器
      # 但 Testcontainers 方式更灵活，可以动态端口
      # 这里留空，让 Testcontainers 自己管理

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          extensions: dom, curl, libxml, mbstring, zip, pcntl, pdo, sqlite, pdo_mysql
          coverage: none

      - name: Install Dependencies
        run: composer install --no-progress --prefer-dist

      - name: Verify Docker is available
        run: |
          docker info
          docker ps

      - name: Run Integration Tests
        env:
          DB_CONNECTION: mysql
          CACHE_DRIVER: redis
          SCOUT_DRIVER: elasticsearch
        run: |
          php artisan test --testsuite=Integration --parallel

      - name: Cleanup
        if: always()
        run: |
          # 清理可能残留的测试容器
          docker ps -a --filter "label=org.testcontainers" -q | xargs -r docker rm -f
```

## 性能优化：容器复用策略

每次测试都启动新容器太慢了。优化方案：

### 1. 进程级容器共享

```php
<?php

namespace Tests;

use Testcontainers\Container\MySQLContainer;

/**
 * 容器管理器：整个测试进程共享同一组容器
 * 用 PHPUnit 的 --process-isolation 或 parallel 进程时，
 * 每个进程会各自创建容器
 */
class ContainerManager
{
    private static array $containers = [];

    public static function getMySQL(): MySQLContainer
    {
        if (!isset(self::$containers['mysql'])) {
            self::$containers['mysql'] = (new MySQLContainer('mysql:8.0'))
                ->withDatabase('test_db')
                ->withUser('test_user')
                ->withPassword('test_pass');

            self::$containers['mysql']->start();

            register_shutdown_function(function () {
                self::$containers['mysql']?->stop();
            });
        }

        return self::$containers['mysql'];
    }

    public static function getRedis(): RedisContainer
    {
        if (!isset(self::$containers['redis'])) {
            self::$containers['redis'] = (new RedisContainer('redis:7-alpine'));
            self::$containers['redis']->start();

            register_shutdown_function(function () {
                self::$containers['redis']?->stop();
            });
        }

        return self::$containers['redis'];
    }

    public static function cleanup(): void
    {
        foreach (self::$containers as $container) {
            $container?->stop();
        }
        self::$containers = [];
    }
}
```

### 2. 使用 Reuse 策略

Testcontainers 支持容器复用（需要 Docker 环境变量）：

```bash
# .env.test
TESTCONTAINERS_RYUK_DISABLED=true
# 或者设置 reuse
TESTCONTAINERS_REUSE_ENABLE=true
```

```php
// 在创建容器时启用复用
$container = (new MySQLContainer('mysql:8.0'))
    ->withReuse()  // 相同配置的容器会被复用
    ->withDatabase('test_db')
    ->withUser('test_user')
    ->withPassword('test_pass');
```

## 踩坑记录

### 1. macOS 上 Docker Desktop 的性能问题

**现象**：测试启动慢，`migrate:fresh` 要 10 秒以上。

**原因**：Docker Desktop 在 macOS 上用虚拟机运行，文件系统挂载有性能损失。

**解决**：

```bash
# 用 OrbStack 替代 Docker Desktop（性能好很多）
brew install orbstack

# 或者用 VirtioFS 挂载（Docker Desktop 4.x 支持）
# Docker Desktop → Settings → General → Use VirtioFS
```

### 2. 容器端口冲突

**现象**：`Bind for 0.0.0.0:3306 failed: port is already allocated`

**原因**：本机已经运行了 MySQL 服务。

**解决**：Testcontainers 默认用随机端口映射，不应该冲突。检查是否在代码里硬编码了 `->withExposedPorts(3306)` 而非让容器自动分配端口：

```php
// ❌ 错误：强制映射到主机 3306
->withPortBinding(3306, 3306)

// ✅ 正确：让 Docker 自动分配主机端口
->withExposedPorts(3306)
// 然后用 $container->getMappedPort(3306) 获取实际端口
```

### 3. CI 环境内存不足

**现象**：ES 容器启动后 OOM 被杀。

**解决**：

```php
// 限制 ES 内存
->withEnvironment('ES_JAVA_OPTS', '-Xms256m -Xmx256m')

// 或者在 CI 中只跑 MySQL/Redis 测试，ES 单独跑
if (env('CI')) {
    $this->markTestSkipped('ES tests skipped in CI due to memory constraints');
}
```

### 4. 等待容器就绪的竞态条件

**现象**：偶尔 `Connection refused`，但重跑就过了。

**原因**：容器启动了但服务还没完全就绪。

**解决**：用 health check 等待：

```php
use Testcontainers\Wait\WaitForLog;
use Testcontainers\Wait\WaitForHttp;

// MySQL：等日志出现 "ready for connections"
->withWait(new WaitForLog(
    regex: '/ready for connections/',
    timeout: 60
))

// Redis：等日志出现 "Ready to accept connections"
->withWait(new WaitForLog(
    regex: '/Ready to accept connections/',
    timeout: 30
))

// Elasticsearch：等 HTTP 接口返回 200
->withWait(new WaitForHttp(
    port: 9200,
    path: '/_cluster/health?wait_for_status=yellow',
    statusCode: 200,
    timeout: 120
))
```

### 5. 测试并行化时的数据库隔离

**现象**：`--parallel` 跑测试时数据互相污染。

**原因**：多个测试进程共享同一个 MySQL 容器，但用同一个数据库。

**解决**：为每个进程创建独立的数据库：

```php
protected function setUp(): void
{
    parent::setUp();

    $dbName = 'test_db_' . getmypid();

    DB::statement("CREATE DATABASE IF NOT EXISTS `{$dbName}`");
    config(['database.connections.mysql.database' => $dbName]);
    DB::purge('mysql');

    $this->artisan('migrate:fresh', [
        '--database' => 'mysql',
    ]);
}
```

## 与传统方案对比

| 维度 | SQLite 内存库 | Mock/假数据 | Testcontainers |
|------|--------------|-------------|----------------|
| 与生产一致性 | ❌ 低 | ❌ 无 | ✅ 高 |
| 测试速度 | ⚡ 极快 | ⚡ 极快 | 🐢 中等（首次启动慢） |
| 覆盖真实行为 | ❌ 部分 | ❌ 无 | ✅ 完整 |
| CI 配置复杂度 | ✅ 简单 | ✅ 简单 | 🟡 需要 Docker |
| 并行测试支持 | ✅ 好 | ✅ 好 | 🟡 需要隔离 |

**建议的混合策略**：

- **单元测试**：SQLite 内存库 + Mock，追求速度
- **集成测试**：Testcontainers，追求真实性
- **E2E 测试**：Docker Compose 全栈环境

## 总结

Testcontainers 把「测试环境」从一个需要手动维护的基础设施，变成了测试代码的一部分。核心价值：

1. **环境一致性**：测试跑的 MySQL 版本和生产一样
2. **隔离性**：每个测试类/进程有独立的数据库
3. **可重复**：不管在本机还是 CI，结果一致
4. **自文档化**：测试代码本身就描述了它需要什么基础设施

对于 Laravel 项目，推荐的做法是：

- 新项目从一开始就用 Testcontainers 写集成测试
- 老项目逐步把「SQLite 跑不过」的测试迁移到 Testcontainers
- CI 中用 `--parallel` + 独立数据库 来平衡速度和真实性

容器化测试不是银弹，但它解决了集成测试中最痛的问题——「我本地跑过了啊」。
