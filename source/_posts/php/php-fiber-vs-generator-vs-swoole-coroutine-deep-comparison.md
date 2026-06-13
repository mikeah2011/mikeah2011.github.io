---

title: PHP Fiber vs Generator vs Swoole Coroutine 深度对比：三种异步模式的底层机制、调度策略与适用场景决策树
keywords: [PHP Fiber vs Generator vs Swoole Coroutine, 深度对比, 三种异步模式的底层机制, 调度策略与适用场景决策树, PHP]
date: 2026-06-10 08:30:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- Fibers
- Generator
- Coroutines
- Swoole
- 异步编程
- PHP 8.1
- PHP 8.5
description: 深入剖析 PHP Fiber、Generator、Swoole Coroutine 三种异步并发模式的底层实现、调度策略与适用场景，附完整代码示例和决策树。
---



PHP 的异步编程一直是个让人头疼的话题。从 Generator 的半协程到 Fiber 的真协程，再到 Swoole 的用户态协程，三种方案各有利弊。本文从底层机制出发，用可运行的代码对比三者的差异，最后给出一个清晰的决策树，帮你选对方案。

<!-- more -->

## 为什么需要关注这三种方案

PHP 8.1 引入 Fiber，PHP 8.5 增强了 Fiber Scheduler，Swoole 的 Coroutine 生态已经成熟。同一个「异步并发」的需求，你有至少三条路可走。选错了，要么代码难维护，要么性能上不去，要么功能受限。

| 特性 | Generator | Fiber | Swoole Coroutine |
|------|-----------|-------|-----------------|
| 引入版本 | PHP 5.5 | PHP 8.1 | Swoole 4.x |
| 恢复方向 | 单向（yield→next） | 双向（suspend/resume） | 内核调度 |
| 能否主动挂起任意层 | ❌ | ✅ | ✅ |
| 自动调度 | ❌ | 需 Scheduler | ✅ 事件循环 |
| I/O 自动切换 | ❌ | ❌ 需手动 | ✅ hook 底层 I/O |
| 依赖 | 无 | 无 | Swoole 扩展 |

## Generator：半协程的优雅与局限

Generator 是 PHP 最早的「异步」方案。它本质上是一个可暂停的迭代器——`yield` 暂停执行，`next()` 恢复。

### 基础用法

```php
<?php
function fetchUsers(): Generator
{
    $users = [
        ['id' => 1, 'name' => 'Alice'],
        ['id' => 2, 'name' => 'Bob'],
        ['id' => 3, 'name' => 'Charlie'],
    ];

    foreach ($users as $user) {
        // 模拟 API 调用延迟
        usleep(100_000);
        yield $user['id'] => $user['name'];
    }
}

// 逐个消费
$generator = fetchUsers();
foreach ($generator as $id => $name) {
    echo "User #{$id}: {$name}\n";
}
```

### 关键限制：单向控制流

Generator 的控制流是单向的——你只能通过 `send()` 往里传值，但无法从 `yield` 点恢复后继续执行深层嵌套的函数调用。

```php
<?php
function outer(): Generator
{
    yield from inner(); // yield from 只是委托，不是真正的协程恢复
    echo "inner done\n";
}

function inner(): Generator
{
    // 一旦 yield，外层无法从这里 resume 并跳回
    yield 'step1';
    yield 'step2';
}

// Generator 无法做到：
// function a() { yield; }
// function b() { a(); } // b 调用了 a，a yield 了，b 能暂停吗？不能。
```

这是 Generator 和 Fiber 的根本区别——Generator 只能在当前函数内 yield，不能让调用链上的任意层暂停。

### 实战：用 Generator 模拟并发

虽然 Generator 不支持真正的并发，但可以用 `yield` 实现协作式任务交替：

```php
<?php
function taskA(): Generator
{
    echo "[A] 开始\n";
    yield; // 让出控制权
    echo "[A] 继续\n";
    yield;
    echo "[A] 完成\n";
}

function taskB(): Generator
{
    echo "[B] 开始\n";
    yield;
    echo "[B] 继续\n";
    yield;
    echo "[B] 完成\n";
}

// 手动调度（伪并发）
$tasks = [taskA(), taskB()];
while (!empty($tasks)) {
    foreach ($tasks as $key => $task) {
        $task->current();
        $task->next();
        if (!$task->valid()) {
            unset($tasks[$key]);
        }
    }
}

// 输出：
// [A] 开始
// [B] 开始
// [A] 继续
// [B] 继续
// [A] 完成
// [B] 完成
```

这种方式**没有真正的 I/O 并发**——只是在 CPU 时间片内交替执行。网络 I/O 还是同步阻塞的。

## Fiber：PHP 原生协程

PHP 8.1 的 Fiber 是真正的协程——它可以在调用链的任意层挂起和恢复，无需 `yield from` 委托。

### 核心 API

```php
<?php
$fiber = new Fiber(function (): void {
    echo "Fiber 开始\n";
    $value = Fiber::suspend('挂起并返回值');
    echo "Fiber 收到: {$value}\n";
});

// 启动
$returned = $fiber->start();
echo "主程序收到: {$returned}\n"; // "挂起并返回值"

// 恢复，传入数据
$fiber->resume('你好 Fiber');
// 输出：
// Fiber 开始
// 主程序收到: 挂起并返回值
// Fiber 收到: 你好 Fiber
```

### Fiber vs Generator 的本质区别

**Generator 只能在当前函数内 yield，Fiber 可以在任意嵌套层 suspend：**

```php
<?php
function deepNested(Fiber $fiber): void
{
    echo "深入第 3 层\n";
    $fiber->suspend('从深层挂起'); // Generator 做不到这一点
    echo "从深层恢复\n";
}

$fiber = new Fiber(function () use ($fiber): void {
    echo "第 1 层\n";
    echo "第 2 层\n";
    deepNested($fiber);
    echo "回到顶层\n";
});

$result = $fiber->start();
echo "主程序收到: {$result}\n";
$fiber->resume();
// 输出：
// 第 1 层
// 第 2 层
// 深入第 3 层
// 主程序收到: 从深层挂起
// 从深层恢复
// 回到顶层
```

### Fiber Scheduler（PHP 8.5）

PHP 8.5 引入了 `Fiber\Scheduler`，自动调度挂起的 Fiber，你不需要手动 `resume()`：

```php
<?php
// PHP 8.5 Fiber Scheduler 示例
$scheduler = new Fiber\Scheduler();

$scheduler->add(function (): void {
    echo "任务 1 开始\n";
    // 自动挂起，让其他 Fiber 运行
    // 某些 I/O 操作会自动 yield
    echo "任务 1 完成\n";
});

$scheduler->add(function (): void {
    echo "任务 2 开始\n";
    echo "任务 2 完成\n";
});

$scheduler->run();
```

> **注意**：PHP 8.5 的 Fiber Scheduler 仍需要底层 I/O 层配合才能实现自动切换。纯 PHP Fiber 本身不 hook I/O，所以同步的 `file_get_contents()` 还是会阻塞。

### Fiber 的实战局限

```php
<?php
// ❌ 这不会自动切换——Fiber 不会 hook file_get_contents
$fiber = new Fiber(function (): void {
    $data = file_get_contents('https://api.example.com/users'); // 阻塞！
    echo $data;
});

// ✅ 需要手动检查 I/O 是否就绪，或者用 amphp/reactphp 的事件循环
// Fiber 只是提供了"挂起/恢复"机制，不提供 I/O 多路复用
```

**Fiber 的定位**：底层基础设施。它提供了协程的挂起/恢复原语，但要实现完整的异步 I/O，还需要上层框架（如 amphp/ReactPHP）配合事件循环。

## Swoole Coroutine：开箱即用的异步并发

Swoole 的协程方案在 PHP 8.1 之前就存在了，它的核心优势是**自动 hook I/O**——你写同步风格的代码，Swoole 在底层自动切换协程。

### 基础用法

```php
<?php
use Swoole\Coroutine;

Coroutine::run(function (): void {
    // 三个 HTTP 请求并发执行
    $channels = [];
    
    for ($i = 0; $i < 3; $i++) {
        $ch = Coroutine\Channel::make(1);
        $channels[] = $ch;
        
        Coroutine::create(function () use ($ch, $i): void {
            $cli = new Swoole\Coroutine\Http\Client('api.example.com', 443);
            $cli->set(['ssl' => true]);
            $cli->get("/users/{$i}");
            $ch->push([
                'status' => $cli->statusCode,
                'body' => $cli->body,
            ]);
            $cli->close();
        });
    }
    
    // 等待所有结果
    $results = [];
    foreach ($channels as $ch) {
        $results[] = $ch->pop();
    }
    
    print_r($results);
});
```

### Swoole 的 Hook 机制

Swoole 通过 `Runtime::enableCoroutine()` hook 了 PHP 底层的 socket/stream 函数：

```php
<?php
use Swoole\Coroutine;

// hook 所有 I/O 函数
Coroutine\run(function (): void {
    // 这些原本同步的函数，现在在协程层面自动切换
    $pdo = new PDO('mysql:host=localhost;dbname=test', 'root', '');
    $result = $pdo->query('SELECT SLEEP(1)')->fetch(); // 不会阻塞其他协程
    
    $redis = new Swoole\Coroutine\Redis();
    $redis->connect('127.0.0.1', 6379);
    $redis->set('key', 'value'); // 自动切换
    
    echo "I/O 操作不会互相阻塞\n";
});
```

### Swoole Channel：协程间通信

```php
<?php
use Swoole\Coroutine;
use Swoole\Coroutine\Channel;

Coroutine\run(function (): void {
    $channel = Channel::make(1);
    
    // 生产者
    Coroutine::create(function () use ($channel): void {
        for ($i = 0; $i < 5; $i++) {
            $channel->push("消息 #{$i}");
            echo "生产: 消息 #{$i}\n";
            Coroutine::sleep(0.1);
        }
        $channel->close();
    });
    
    // 消费者
    Coroutine::create(function () use ($channel): void {
        while (!$channel->isEmpty()) {
            $msg = $channel->pop();
            echo "消费: {$msg}\n";
        }
    });
});
```

## 三种方案的真实性能对比

我们用一个简单场景做基准测试：并发执行 100 个模拟 I/O 操作（每个 10ms 延迟）。

### 测试代码

```php
<?php
// === Generator 方案 ===
function generatorBenchmark(): float
{
    $start = microtime(true);
    
    $tasks = [];
    for ($i = 0; $i < 100; $i++) {
        $tasks[] = (function () use ($i) {
            // Generator 无法实现真正的异步 I/O
            // 这里只是计算密集型任务的交错
            usleep(10_000); // 阻塞！
            return $i;
        })();
    }
    
    return microtime(true) - $start;
}

// === Fiber 方案（配合 amphp） ===
function fiberBenchmark(): float
{
    // 需要 amphp/event-loop 配合
    // 纯 Fiber 无法自动切换 I/O
    $start = microtime(true);
    
    $fiber = new Fiber(function (): void {
        for ($i = 0; $i < 100; $i++) {
            // 手动 suspend 来让出控制权
            // 但没有事件循环，无法自动恢复
            Fiber::suspend();
        }
    });
    
    return microtime(true) - $start;
}

// === Swoole Coroutine 方案 ===
// 需在 Swoole 环境中运行
// swoole_http_server.php:
// Swoole\Coroutine\run(function () {
//     $start = microtime(true);
//     $waitGroup = new Swoole\Coroutine\WaitGroup();
//     
//     for ($i = 0; $i < 100; $i++) {
//         Coroutine::create(function () use ($waitGroup, $i) {
//             Swoole\Coroutine::usleep(10_000); // 非阻塞！
//             $waitGroup->done();
//         });
//     }
//     
//     $waitGroup->wait();
//     echo (microtime(true) - $start) . "s\n"; // ~0.01s（并发执行）
// });
```

### 预期结果

| 方案 | 100 × 10ms I/O 耗时 | 原因 |
|------|---------------------|------|
| Generator | ~1000ms（1秒） | 同步阻塞，无法并发 |
| Fiber（无事件循环） | ~1000ms | 无 I/O hook，同步阻塞 |
| Fiber（+ amphp） | ~50-100ms | 事件循环 + 非阻塞 I/O |
| Swoole Coroutine | ~10-20ms | 原生 hook I/O，并发执行 |

## 踩坑记录

### 1. Generator 的 yield from 陷阱

```php
<?php
function inner(): Generator
{
    yield 'a';
    yield 'b';
    throw new \RuntimeException('inner error');
}

function outer(): Generator
{
    try {
        yield from inner(); // 错误会传播到 outer
    } catch (\RuntimeException $e) {
        echo "Caught: " . $e->getMessage() . "\n";
        yield 'recovered'; // 可以恢复
    }
}

// Generator 的异常处理需要手动 try-catch
// 但 Fiber 的异常处理更自然——通过 throw() 方法
```

### 2. Fiber 的堆栈开销

```php
<?php
// ❌ 创建大量 Fiber 会消耗内存
$fibers = [];
for ($i = 0; $i < 10000; $i++) {
    $fibers[] = new Fiber(function () {
        Fiber::suspend();
    });
}
// 每个 Fiber 默认 8MB 栈空间（可通过栈大小参数调整）
// 创建 10000 个可能 OOM

// ✅ Swoole 协程的内存开销更小
// 每个协程默认 8KB 栈空间
```

### 3. Swoole 的兼容性问题

```php
<?php
// Swoole hook 了底层 I/O，可能导致某些扩展不兼容
// 例如：
// - swoole 的 PDO hook 可能与某些 PDO 驱动冲突
// - swoole 的 curl hook 可能导致某些 curl 选项异常
// - 同步的 usleep() 变成了 Coroutine::usleep()，行为不同

// 建议：在 Swoole 环境中始终使用 Swoole 提供的客户端
// 而不是原生 PDO/curl/socket
```

### 4. Fiber 不是银弹

```php
<?php
// 常见误解："用了 Fiber 就能异步"
// 事实：Fiber 只提供挂起/恢复机制，不提供 I/O 多路复用

// ❌ 错误用法
$fiber = new Fiber(function (): void {
    $data = file_get_contents('https://example.com'); // 同步阻塞！
    echo $data;
});

// ✅ 正确用法：配合事件循环
// $loop = React\EventLoop\Factory::create();
// $loop->addTimer(0, function () use ($fiber) {
//     $fiber->start();
// });
// $loop->run();
```

## 适用场景决策树

```
需要异步/并发？
│
├─ 只是生成器惰性求值 → Generator
│  └─ 适合：大数据分批处理、无限序列、内存优化
│
├─ 需要协程级别的控制 → Fiber
│  ├─ 配合 amphp/ReactPHP → PHP 原生异步生态
│  ├─ 需要 PHP 8.5 Scheduler → 等待生态成熟
│  └─ 适合：库/框架开发者、需要可移植的异步代码
│
├─ 需要开箱即用的高并发 → Swoole Coroutine
│  ├─ HTTP API 服务 → Swoole HTTP Server
│  ├─ WebSocket 长连接 → Swoole WebSocket Server
│  ├─ 微服务/RPC → Swoole + Hyperf/Swoft
│  └─ 适合：业务开发、追求性能、团队有 Swoole 经验
│
└─ 混合方案
   ├─ Fiber 作为底层，Swoole 作为运行时
   └─ 例如：在 Swoole 环境中使用 Fiber 实现自定义调度
```

## 总结

| 维度 | Generator | Fiber | Swoole Coroutine |
|------|-----------|-------|-----------------|
| 学习成本 | 低 | 中 | 高 |
| 真正并发 | ❌ | ❌（需事件循环） | ✅ |
| 生态成熟度 | 高 | 中（成长中） | 高 |
| 性能上限 | 低 | 中 | 高 |
| 部署复杂度 | 无 | 无 | 高（需 Swoole 扩展） |
| 适用场景 | 惰性求值 | 异步基础设施 | 高并发服务 |

**一句话建议**：

- **日常业务**：直接用 Swoole Coroutine，同步写法 + 异步性能。
- **库/框架开发**：基于 Fiber 构建，可移植性更好。
- **纯数据处理**：Generator 够用，别过度设计。

三者不是替代关系，而是不同层次的抽象。Generator 解决惰性求值，Fiber 提供协程原语，Swoole 把一切打包成开箱即用的高性能方案。理解它们的层次关系，才能选对工具。

---

*本文基于 PHP 8.1 Fiber、PHP 8.5 Fiber Scheduler、Swoole 5.x 编写。具体 API 可能随版本演进有所变化。*
