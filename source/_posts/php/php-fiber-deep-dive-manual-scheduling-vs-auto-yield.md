---
title: "PHP Fiber 深度实战进阶：手动调度 vs 自动让出——从 yield 到 Fibers 的协程演化与 Swoole 协程对比"
date: 2026-06-10 00:57:00
categories:
  - php
tags:
  - PHP Fiber
  - 协程
  - 并发编程
  - Swoole
  - yield
  - Generator
description: "深入探讨 PHP Fiber 的调度机制，从 Generator yield 到 Fiber 的演化历程，对比手动调度与自动让出模式，并与 Swoole 协程进行实战对比分析。"
---

PHP 8.1 引入的 Fiber 并非凭空出现——它是 PHP 社区十余年协程探索的最终形态。从 Generator 的 `yield` 到 async/await 的提案，再到 Fiber 的轻量级绿色线程，PHP 的并发模型经历了多次蜕变。

本文不讲基础用法，而是深入三个核心问题：

1. 手动调度和自动让出的本质区别是什么？
2. Fiber 与 Generator 协程的演化关系如何？
3. Fiber 和 Swoole 协程在实际项目中如何选择？

## 一、协程演化史：从 yield 到 Fiber

### 1.1 Generator 时代（PHP 5.5+）

Generator 是 PHP 协程的起点。它通过 `yield` 关键字实现函数的暂停与恢复：

```php
<?php
function simpleGenerator(): Generator {
    echo "开始执行\n";
    yield 1;
    echo "第一次恢复\n";
    yield 2;
    echo "第二次恢复\n";
    yield 3;
    echo "结束\n";
}

$gen = simpleGenerator();
echo $gen->current() . "\n"; // 输出: 开始执行\n1
$gen->next();                // 输出: 第一次恢复
echo $gen->current() . "\n"; // 输出: 2
$gen->next();                // 输出: 第二次恢复
echo $gen->current() . "\n"; // 输出: 3
```

Generator 的 `yield` 是**手动调度**——调用方必须显式调用 `next()` 或 `send()` 来恢复执行。这意味着调度逻辑完全由开发者控制。

### 1.2 Generator 实现协程调度器

在 Fiber 出现之前，社区通过 Generator 构建协程调度器：

```php
<?php
class CoroutineScheduler
{
    private SplQueue $queue;

    public function __construct()
    {
        $this->queue = new SplQueue();
    }

    public function add(Generator $coroutine): void
    {
        $this->queue->enqueue($coroutine);
    }

    public function run(): void
    {
        while (!$this->queue->isEmpty()) {
            $coroutine = $this->queue->dequeue();

            if ($coroutine->valid()) {
                $coroutine->current(); // 执行到下一个 yield
                $this->queue->enqueue($coroutine); // 重新入队
            }
        }
    }
}

// 模拟三个"并发"任务
function taskA(): Generator {
    for ($i = 0; $i < 3; $i++) {
        echo "[A] 步骤 {$i}\n";
        yield; // 主动让出
    }
}

function taskB(): Generator {
    for ($i = 0; $i < 3; $i++) {
        echo "[B] 步骤 {$i}\n";
        yield;
    }
}

$scheduler = new CoroutineScheduler();
$scheduler->add(taskA());
$scheduler->add(taskB());
$scheduler->run();
```

输出交替执行 A 和 B 的步骤——这就是**协作式调度**的核心：每个任务主动 `yield` 让出控制权。

**关键限制**：Generator 无法在任意位置暂停。你不能在一个深层嵌套的函数调用中间 `yield`——`yield` 必须直接出现在 Generator 函数体内。

### 1.3 Fiber 的突破（PHP 8.1+）

Fiber 解决了 Generator 的根本限制：**可以在调用栈的任意深度暂停**。

```php
<?php
function deepFunction(): string {
    // 这个函数不知道自己被 Fiber 调用
    $result = doSomeWork();
    return $result;
}

function doSomeWork(): string {
    // 在这里暂停——Generator 做不到
    Fiber::suspend('中间结果');
    return '最终结果';
}

$fiber = new Fiber(function () {
    echo deepFunction() . "\n";
});

// 第一次 suspend，返回 '中间结果'
$value = $fiber->start();
echo "Fiber 暂停，返回: {$value}\n";

// 恢复执行
$fiber->resume('继续');
```

Fiber 本质上是一个**有栈协程**（stackful coroutine），而 Generator 是**无栈协程**（stackless coroutine）。这个区别决定了 Fiber 可以在任意深度暂停。

## 二、手动调度 vs 自动让出

### 2.1 手动调度：开发者控制一切

手动调度意味着你明确知道什么时候暂停、什么时候恢复：

```php
<?php
class ManualFiberScheduler
{
    private array $fibers = [];
    private array $suspended = [];

    public function add(callable $task): void
    {
        $fiber = new Fiber($task);
        $this->fibers[] = $fiber;
    }

    public function run(): void
    {
        while (!empty($this->fibers)) {
            $fiber = array_shift($this->fibers);

            if (!$fiber->isStarted()) {
                $result = $fiber->start();
                if ($result !== null) {
                    $this->suspended[$result] = $fiber;
                }
            }

            if ($fiber->isSuspended()) {
                $this->fibers[] = $fiber;
            }
        }
    }

    public function resolve(string $key, mixed $value): void
    {
        if (isset($this->suspended[$key])) {
            $fiber = $this->suspended[$key];
            unset($this->suspended[$key]);
            $fiber->resume($value);
            if ($fiber->isSuspended()) {
                $this->fibers[] = $fiber;
            }
        }
    }
}

// 使用示例
$scheduler = new ManualFiberScheduler();

$scheduler->add(function () {
    echo "[任务1] 开始\n";
    $data = Fiber::suspend('waiting:db');
    echo "[任务1] 收到数据: {$data}\n";
    echo "[任务1] 结束\n";
});

$scheduler->add(function () {
    echo "[任务2] 开始\n";
    $data = Fiber::suspend('waiting:http');
    echo "[任务2] 收到响应: {$data}\n";
    echo "[任务2] 结束\n";
});

// 模拟异步事件触发
$scheduler->run();
$scheduler->resolve('waiting:db', '{"user": "michael"}');
$scheduler->resolve('waiting:http', '{"status": 200}');
$scheduler->run();
```

手动调度的优势在于**完全可控**——你知道每个 Fiber 的状态，可以精确控制恢复时机。缺点是需要自己管理状态和调度逻辑。

### 2.2 自动让出：事件驱动的调度

自动让出模式下，Fiber 在遇到 I/O 阻塞时自动暂停，由事件循环决定何时恢复。这需要与事件循环（如 ReactPHP、Revolt）配合：

```php
<?php
// 使用 Revolt（PHP 官方推荐的事件循环库）
// composer require revolt/event-loop

require 'vendor/autoload.php';

use Revolt\EventLoop;

$suspensionMap = [];

// 模拟异步 I/O
function asyncQuery(string $sql): mixed
{
    $key = uniqid('query_');

    // 注册一个定时器模拟数据库查询延迟
    EventLoop::delay(0.1, function () use ($key, $sql) {
        // 模拟查询结果
        $result = "SELECT * FROM users => [{id: 1, name: 'Michael'}]";
        global $suspensionMap;
        if (isset($suspensionMap[$key])) {
            $suspensionMap[$key]->resume($result);
        }
    });

    // 自动让出——开发者不需要手动管理恢复
    $suspensionMap[$key] = Fiber::suspend($key);
    return null; // 实际值通过 resume 传入
}

// 启动事件循环
EventLoop::defer(function () {
    $fiber = new Fiber(function () {
        echo "[查询1] 开始\n";
        $result = asyncQuery("SELECT * FROM users");
        echo "[查询1] 结果: {$result}\n";

        echo "[查询2] 开始\n";
        $result = asyncQuery("SELECT * FROM orders");
        echo "[查询2] 结果: {$result}\n";
    });

    $fiber->start();
});

EventLoop::run();
```

这里的关键区别：`asyncQuery` 内部调用了 `Fiber::suspend`，但调用方（主逻辑）并不知道暂停发生了。这就是**自动让出**——底层 I/O 库负责暂停和恢复，业务代码保持同步写法。

### 2.3 对比总结

| 维度 | 手动调度（Generator/Fiber） | 自动让出（事件驱动） |
|------|---------------------------|---------------------|
| 调度控制 | 开发者显式调用 next/resume | 事件循环自动管理 |
| 暂停深度 | Generator 仅函数体内；Fiber 任意深度 | Fiber 任意深度 |
| 代码风格 | 需要感知异步流程 | 同步写法，底层透明 |
| 适用场景 | 状态机、生产者-消费者、自定义调度 | I/O 密集型 Web 服务 |
| 复杂度 | 低（但需要管理状态） | 低（依赖成熟框架） |

## 三、Fiber 在 Laravel 中的实战

### 3.1 Laravel 的 Fiber 集成

Laravel 10+ 在底层使用了 Fiber 来实现 Context（上下文管理）。这使得在请求生命周期内的任何深度都能访问请求级别的状态：

```php
<?php
// Laravel 内部的 Context 实现（简化版）
namespace Illuminate\Support;

class Context
{
    protected static ?Fiber $fiber = null;
    protected static array $context = [];

    public static function set(string $key, mixed $value): void
    {
        $fiberId = self::getFiberId();
        self::$context[$fiberId][$key] = $value;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $fiberId = self::getFiberId();
        return self::$context[$fiberId][$key] ?? $default;
    }

    protected static function getFiberId(): string
    {
        // 在 Fiber 内用 Fiber 对象 ID，否则用 'main'
        return Fiber::isFiber()
            ? spl_object_id(Fiber::getCurrent())
            : 'main';
    }
}
```

### 3.2 用 Fiber 实现并发 HTTP 请求

在 Laravel 项目中，有时需要并发调用多个外部 API。Fiber 可以在不引入完整异步框架的情况下实现简单的并发：

```php
<?php

namespace App\Services;

use Fiber;
use Illuminate\Support\Facades\Http;

class ConcurrentHttpClient
{
    /**
     * 并发执行多个 HTTP 请求
     *
     * @param array<string, array{url: string, method?: string, data?: array}> $requests
     * @return array<string, mixed>
     */
    public function concurrent(array $requests): array
    {
        $fibers = [];
        $results = [];

        foreach ($requests as $name => $config) {
            $fibers[$name] = new Fiber(function () use ($config) {
                $method = $config['method'] ?? 'get';
                $url = $config['url'];
                $data = $config['data'] ?? [];

                $response = Http::timeout(5)->$method($url, $data);

                Fiber::suspend($response->json());
            });
        }

        // 启动所有 Fiber
        foreach ($fibers as $name => $fiber) {
            $result = $fiber->start();
            $results[$name] = $result;
        }

        return $results;
    }
}

// 在 Controller 中使用
class DashboardController extends Controller
{
    public function index(ConcurrentHttpClient $client)
    {
        $data = $client->concurrent([
            'users' => [
                'url' => config('services.user_api.url') . '/stats',
            ],
            'orders' => [
                'url' => config('services.order_api.url') . '/today',
            ],
            'notifications' => [
                'url' => config('services.notify_api.url') . '/unread',
                'method' => 'post',
                'data' => ['user_id' => auth()->id()],
            ],
        ]);

        return view('dashboard', [
            'userStats' => $data['users'],
            'todayOrders' => $data['orders'],
            'unreadCount' => $data['notifications']['count'] ?? 0,
        ]);
    }
}
```

**注意**：上面的示例中，`Http::get()` 等调用本身是同步阻塞的。真正的并发需要底层 I/O 库支持 Fiber（如 amphp v3）。这里展示的是 Fiber 的调度模式，实际并发效果取决于底层实现。

### 3.3 用 Fiber 实现中间件级别的请求追踪

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Fiber;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class RequestTracing
{
    public function handle(Request $request, Closure $next): Response
    {
        $traceId = $request->header('X-Trace-Id', Str::uuid()->toString());

        // 在 Fiber 上下文中存储追踪信息
        // 无论后续代码嵌套多深，都能通过 Context 获取
        app()->instance('trace.id', $traceId);
        app()->instance('trace.start', microtime(true));

        $response = $next($request);

        $elapsed = round((microtime(true) - app('trace.start')) * 1000, 2);
        $response->headers->set('X-Trace-Id', $traceId);
        $response->headers->set('X-Response-Time', "{$elapsed}ms");

        return $response;
    }
}
```

## 四、Fiber vs Swoole 协程

这是实际选型时最常遇到的问题。两者解决的问题相似，但设计理念完全不同。

### 4.1 架构差异

```php
<?php
// Fiber：PHP 层面的协程，依赖 PHP 的执行模型
$fiber = new Fiber(function () {
    // 这里是 PHP 用户态代码
    // 暂停和恢复都在 PHP VM 内完成
    Fiber::suspend('pause');
    echo "resumed\n";
});

// Swoole 协程：C 层面的协程，接管了 PHP 的 I/O
go(function () {
    // Swoole 重写了 PHP 的 stream/socket 扩展
    // 所以 file_get_contents('http://...') 也是非阻塞的
    $html = file_get_contents('https://example.com');
    echo strlen($html) . "\n";
});
```

### 4.2 核心区别对比

| 维度 | PHP Fiber | Swoole 协程 |
|------|-----------|-------------|
| 实现层 | PHP 用户态 | C 扩展层 |
| I/O 支持 | 需要库适配（amphp v3 等） | 内置，重写了 PHP I/O 函数 |
| Hook 机制 | 无 | 自动 Hook PHP 原生函数 |
| 调度器 | 外部事件循环（Revolt 等） | 内置协程调度器 |
| 学习成本 | 低，纯 PHP API | 中，需要理解 Swoole 运行模型 |
| 生态兼容 | 完全兼容 PHP 生态 | 部分 PHP 扩展不兼容 |
| 进程模型 | 传统 FPM | 常驻内存，多 Worker |
| 适用场景 | 库/框架底层、轻量并发 | 高性能 HTTP 服务、WebSocket |

### 4.3 实战代码对比

**场景：并发查询数据库和缓存**

```php
<?php

// ========== Fiber 版本（需要 amphp v3 + amp-mysql）==========
use Amp\Future;
use function Amp\async;

// composer require amphp/amp amphp/mysql
function fiberConcurrentQuery(): array
{
    // 并发执行
    $userFuture = async(function () {
        return db()->query('SELECT * FROM users WHERE id = ?', [1]);
    });

    $cacheFuture = async(function () {
        return cache()->get('user:1:profile');
    });

    // 等待结果（非阻塞）
    $user = $userFuture->await();
    $profile = $cacheFuture->await();

    return ['user' => $user, 'profile' => $profile];
}

// ========== Swoole 协程版本 ==========
use Swoole\Coroutine\Channel;

function swooleConcurrentQuery(): array
{
    $channel = new Channel(2);

    go(function () use ($channel) {
        // Swoole Hook 了 PDO，所以原生 PDO 查询是非阻塞的
        $pdo = new PDO('mysql:host=localhost;dbname=test', 'root', '');
        $stmt = $pdo->query('SELECT * FROM users WHERE id = 1');
        $channel->push(['user' => $stmt->fetch()]);
    });

    go(function () use ($channel) {
        // Swoole Hook 了 Redis 扩展
        $redis = new Redis();
        $redis->connect('127.0.0.1', 6379);
        $channel->push(['profile' => $redis->get('user:1:profile')]);
    });

    $result = [];
    for ($i = 0; $i < 2; $i++) {
        $data = $channel->pop();
        $result = array_merge($result, $data);
    }

    return $result;
}
```

### 4.4 选型建议

**选 Fiber 的场景**：
- 你在用 Laravel/Symfony 等传统框架，不想迁移
- 需要的是库层面的并发能力（如 amphp 的 HTTP 客户端）
- 团队对 Swoole 不熟悉，学习成本是瓶颈
- 部署环境限制（共享主机等无法装 Swoole 扩展）

**选 Swoole 的场景**：
- 构建高性能 API 服务，QPS 要求 > 5000
- 需要 WebSocket、TCP 长连接
- 已有 Swoole 生态积累（Hyperf、Swoft 等）
- 需要原生 I/O Hook，不想改写现有代码

**混合使用**：
Laravel Octane 就是典型——用 Swoole 作为运行时，同时兼容 Laravel 的 Fiber Context。两者并不冲突。

## 五、踩坑记录

### 5.1 Fiber 内不能使用 `global`

```php
<?php
$globalVar = 'outside';

$fiber = new Fiber(function () {
    global $globalVar; // ⚠️ 这在 Fiber 内可以工作，但不推荐
    echo $globalVar . "\n";
});

$fiber->start();
```

Fiber 有自己的调用栈，`global` 虽然能工作，但在并发场景下会产生竞争条件。推荐通过闭包的 `use` 或依赖注入传递数据。

### 5.2 Fiber::suspend 的返回值陷阱

```php
<?php
$fiber = new Fiber(function () {
    $value = Fiber::suspend('paused');
    echo "收到: {$value}\n"; // 收到: hello
    return 'done';
});

// start() 返回 suspend 传入的值
$result = $fiber->start(); // 'paused'

// resume() 返回 Fiber 体的 return 值（如果 Fiber 结束）
// 或者下一次 suspend 传入的值
$result = $fiber->resume('hello'); // 'done'
```

容易混淆的点：`start()` 和 `resume()` 的返回值含义不同。`start()` 返回第一次 `suspend()` 的参数；`resume()` 返回下一次 `suspend()` 的参数或 Fiber 的 `return` 值。

### 5.3 异常传播

```php
<?php
$fiber = new Fiber(function () {
    try {
        Fiber::suspend('waiting');
    } catch (\Throwable $e) {
        echo "Fiber 内捕获: {$e->getMessage()}\n";
        throw $e; // 必须重新抛出，否则 Fiber 静默结束
    }
});

$fiber->start();

// 通过 throw 在 Fiber 内抛异常
try {
    $fiber->throw(new \RuntimeException('something broke'));
} catch (\RuntimeException $e) {
    echo "外部捕获: {$e->getMessage()}\n";
}
```

`Fiber::throw()` 会在 Fiber 暂停点抛出异常。如果 Fiber 内部没有 catch，异常会传播到调用方。这个机制与 Generator 的 `throw()` 一致。

### 5.4 Swoole 环境下 Fiber 与协程冲突

在 Swoole 环境中，如果你同时使用 Swoole 协程和 PHP Fiber，需要注意调度冲突。Swoole 4.6+ 已经支持 Fiber，但低版本中混用可能导致不可预期的行为：

```php
<?php
// ❌ 错误：在 Swoole 协程内手动创建 Fiber（Swoole < 4.6）
go(function () {
    $fiber = new Fiber(function () {
        // 可能与 Swoole 调度器冲突
    });
});

// ✅ 正确：使用 Swoole 协程或升级到 Swoole 4.6+
go(function () {
    // 直接使用协程即可
    $result = Co::sleep(0.1);
});
```

## 六、总结

PHP 的协程之路走了十余年，从 Generator 的 `yield` 到 Fiber 的绿色线程，核心思想始终是**协作式调度**——任务主动让出控制权，而非被抢占。

**关键要点**：

1. **手动调度**适合精细控制流程的场景（状态机、生产者-消费者），开发者对每个暂停点了如指掌。
2. **自动让出**适合 I/O 密集型业务，底层库自动处理暂停和恢复，业务代码保持同步风格。
3. **Fiber vs Swoole** 不是二选一——Fiber 是 PHP 语言层面的原语，Swoole 是运行时层面的增强。Laravel Octane 已经证明两者可以共存。
4. **选择标准**：如果你在写库/框架，用 Fiber；如果你在写高性能服务，用 Swoole；如果你在用 Laravel，两者都了解一下。

协程不是银弹，它解决的是 I/O 等待时的 CPU 浪费问题。对于 CPU 密集型任务，多进程/多线程仍然是更好的选择。理解这一点，才能在实际项目中做出正确的架构决策。
