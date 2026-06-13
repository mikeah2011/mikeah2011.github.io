---

title: 进程、线程和协程对比：PHP Fibers、Go goroutine 与 Swoole 协程
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- 架构
categories:
  - php
keywords: [PHP Fibers, Go goroutine, Swoole, 进程, 线程和协程对比, 协程]
date: 2019-03-20 15:05:07
description: 本文深入对比进程、线程和协程三大并发模型的核心差异，结合 PHP 生态中的 pcntl 多进程、pthreads 多线程、Swoole 协程及 PHP 8.1 Fiber 等实际代码示例，详解各模型的适用场景、性能对比与常见踩坑问题，帮助 PHP 开发者在高并发场景下做出合理的技术选型。
---




进程、线程和协程是并发编程中三种最核心的执行单元模型。理解它们的区别，是做好 PHP 高并发架构设计的基础。本文将从概念、PHP 代码实践、性能对比、选型指南四个维度进行系统梳理。

<!-- more -->

## 一、基本概念

### 1.1 进程（Process）

进程是**操作系统资源分配的基本单位**。每个进程拥有独立的地址空间、文件描述符表、堆内存等系统资源。进程之间的内存是隔离的，通信需要借助 IPC（进程间通信）机制，如管道、消息队列、共享内存、Socket 等。

### 1.2 线程（Thread）

线程是 **CPU 调度的基本单位**。一个进程内可以包含多个线程，它们共享进程的地址空间和资源，但各自拥有独立的栈和寄存器上下文。线程的创建和切换开销远小于进程。

### 1.3 协程（Coroutine）

协程是一种比线程更加轻量级的存在。协程不由操作系统内核管理，完全在**用户态**由程序自身控制调度。协程的切换不需要陷入内核态，因此切换开销极小（通常仅需几十纳秒）。协程是**非抢占式**的，由开发者主动让出（yield）执行权。

### 1.4 三者核心区别

| 维度 | 进程 | 线程 | 协程 |
| --- | --- | --- | --- |
| 概念 | 资源分配的基本单位 | CPU 调度的基本单位 | 用户态的轻量级执行流 |
| 地址空间 | 独立地址空间 | 共享进程地址空间 | 共享所属线程的地址空间 |
| 资源拥有 | 独立资源（内存、fd 等） | 共享进程资源 | 共享线程资源 |
| 调度方式 | 操作系统内核调度 | 操作系统内核调度 | 用户态程序调度（协作式） |
| 切换开销 | 大（需保存/恢复完整上下文 + TLB 刷新） | 中（需内核态切换） | 极小（用户态寄存器切换） |
| 通信方式 | IPC（管道、Socket、共享内存等） | 共享内存（需同步原语） | 共享内存（单线程内天然安全） |
| 并发能力 | 真正并行（多核） | 真正并行（多核） | 并发不并行（单线程内） |
| 典型内存开销 | 10MB+ / 进程 | 1MB+ / 线程 | 几 KB / 协程 |
| 机制 | 同步 | 同步 | 异步 |

**一个形象的比喻：**

- 进程 → 一个独立的工人，有自己的工具箱（资源），独自干活
- 线程 → 一个工人团队，共享一个工具箱，每个人同时干不同的事
- 协程 → 一个工人轮流干多件事，干到需要等待时就切到下一件

## 二、PHP 中的多进程编程（pcntl 扩展）

PHP 原生通过 `pcntl` 扩展支持多进程编程，这也是 PHP-FPM、Laravel Queue Worker 等基础设施的底层机制。

### 2.1 基本 fork 示例

```php
<?php
$workerCount = 4;
$pids = [];

for ($i = 0; $i < $workerCount; $i++) {
    $pid = pcntl_fork();
    
    if ($pid === -1) {
        die("fork 失败");
    } elseif ($pid === 0) {
        // 子进程逻辑
        $pid = getmypid();
        echo "子进程 {$pid} 开始工作 (worker #{$i})\n";
        sleep(rand(1, 3));
        echo "子进程 {$pid} 工作完成\n";
        exit(0); // 子进程必须 exit，否则会继续 fork
    } else {
        // 父进程记录子进程 PID
        $pids[] = $pid;
    }
}

// 父进程等待所有子进程结束
foreach ($pids as $pid) {
    pcntl_waitpid($pid, $status);
    echo "子进程 {$pid} 已退出，状态: {$status}\n";
}

echo "所有子进程已完成\n";
```

### 2.2 进程间通信（共享内存）

```php
<?php
// 创建共享内存段
$key = ftok(__FILE__, 'a');
$shmId = shmop_open($key, 'c', 0644, 1024);

$pid = pcntl_fork();

if ($pid === 0) {
    // 子进程写入
    $data = json_encode(['counter' => 100, 'timestamp' => time()]);
    shmop_write($shmId, $data, 0);
    echo "子进程写入: {$data}\n";
    exit(0);
} else {
    // 等待子进程写入完成
    pcntl_waitpid($pid, $status);
    // 父进程读取
    $data = shmop_read($shmId, 0, 1024);
    $data = rtrim($data, "\0");
    echo "父进程读取: {$data}\n";
    shmop_delete($shmId);
    shmop_close($shmId);
}
```

### 2.3 信号处理

```php
<?php
// 父进程优雅退出：收到 SIGTERM 后通知子进程退出
declare(ticks=1);

$children = [];

function handleSignal($signo) {
    global $children;
    echo "收到信号 {$signo}，通知子进程退出...\n";
    foreach ($children as $pid) {
        posix_kill($pid, SIGTERM);
    }
}

pcntl_signal(SIGTERM, 'handleSignal');
pcntl_signal(SIGINT, 'handleSignal');

for ($i = 0; $i < 3; $i++) {
    $pid = pcntl_fork();
    if ($pid === 0) {
        // 子进程也注册信号处理
        pcntl_signal(SIGTERM, function ($signo) {
            echo "子进程 " . getmypid() . " 收到退出信号\n";
            exit(0);
        });
        while (true) {
            sleep(1);
            // 模拟工作
        }
    } else {
        $children[] = $pid;
    }
}

// 父进程等待
while (count($children) > 0) {
    $exitPid = pcntl_waitpid(-1, $status);
    if ($exitPid > 0) {
        $children = array_filter($children, fn($p) => $p !== $exitPid);
    }
}
echo "父进程退出\n";
```

### 2.4 注意事项

- `pcntl_fork()` 只能在 CLI 模式下使用，**Web 环境（PHP-FPM/Apache）不可用**
- 子进程会复制父进程的整个内存空间（COW 写时复制），大内存时 fork 开销不可忽视
- 必须在子进程中调用 `exit()`，否则子进程会继续执行后续的 fork 循环
- 僵尸进程：父进程必须 `pcntl_waitpid()` 回收子进程，否则产生僵尸进程
- MySQL/Redis 等连接资源在 fork 后父子进程共享，可能导致数据混乱，需在子进程中重新建立连接

## 三、PHP 中的线程编程（pthreads）

### 3.1 pthreads 扩展

PHP 的 `pthreads` 扩展（PHP 5.x/7.x）提供了多线程能力，但它有一个致命限制：**必须运行在 CLI 的 ZTS（Zend Thread Safety）版本下**。标准的 PHP-FPM 使用的是 NTS（Non-Thread Safe）版本，因此 pthreads 在 Web 环境中不可用。

```php
<?php
// 需要安装 pthreads 扩展，且 PHP 必须编译为 ZTS 模式
class WorkerThread extends Thread {
    private $workerId;

    public function __construct(int $id) {
        $this->workerId = $id;
    }

    public function run() {
        echo "线程 {$this->workerId} 开始执行 (TID: " . $this->getThreadId() . ")\n";
        // 模拟耗时任务
        $sum = 0;
        for ($i = 0; $i < 1000000; $i++) {
            $sum += $i;
        }
        echo "线程 {$this->workerId} 计算结果: {$sum}\n";
    }
}

$threads = [];
for ($i = 0; $i < 4; $i++) {
    $threads[] = new WorkerThread($i);
}

// 启动所有线程
foreach ($threads as $thread) {
    $thread->start();
}

// 等待所有线程完成
foreach ($threads as $thread) {
    $thread->join();
}
```

### 3.2 parallel 扩展（PHP 7.2+ 推荐）

`pthreads` 作者在 PHP 7.2 之后推出了 `parallel` 扩展，API 更现代，安全性更好：

```php
<?php
// 安装: pecl install parallel
use parallel\Runtime;

$runtime = new Runtime();
$future = $runtime->run(function () {
    $sum = 0;
    for ($i = 0; $i < 1000000; $i++) {
        $sum += $i;
    }
    return $sum;
});

echo "计算结果: " . $future->value() . "\n";
$runtime->close();
```

### 3.3 pthreads/parallel 的局限性

1. **必须使用 ZTS 版本**：绝大多数生产环境的 PHP 都是 NTS 版本，无法使用
2. **PHP 的 GIL 问题**：虽然不像 Python 那样严格，但 PHP 扩展层面大量非线程安全代码导致多线程实际收益有限
3. **生态不成熟**：很多 PHP 扩展不是线程安全的（如 PDO、某些 cURL 用法），在多线程环境下可能崩溃
4. **已被社区边缘化**：pthreads 作者已停止维护，parallel 扩展使用率很低

> **结论**：在 PHP 生态中，**多进程**（pcntl）和**协程**（Swoole/Fiber）才是主流方案，多线程基本不推荐使用。

## 四、PHP 中的协程编程

### 4.1 Swoole 协程

Swoole 是 PHP 生态中最成熟的协程方案。从 Swoole 4.x 开始，全面转向协程模型。

```php
<?php
// Swoole 协程基本用法
Swoole\Coroutine\Run(function () {
    // 并发请求多个 HTTP 接口
    $chan = new Swoole\Coroutine\Channel(3);
    
    // 协程 1：请求 API-A
    go(function () use ($chan) {
        $result = Swoole\Coroutine\Http\Client::get('https://httpbin.org/delay/1');
        $chan->push(['api' => 'A', 'status' => $result->statusCode]);
    });
    
    // 协程 2：请求 API-B
    go(function () use ($chan) {
        $result = Swoole\Coroutine\Http\Client::get('https://httpbin.org/delay/1');
        $chan->push(['api' => 'B', 'status' => $result->statusCode]);
    });
    
    // 协程 3：请求 API-C
    go(function () use ($chan) {
        $result = Swoole\Coroutine\Http\Client::get('https://httpbin.org/delay/1');
        $chan->push(['api' => 'C', 'status' => $result->statusCode]);
    });
    
    // 收集结果（总共只需约 1 秒，而非 3 秒）
    for ($i = 0; $i < 3; $i++) {
        $result = $chan->pop();
        echo "API {$result['api']}: status={$result['status']}\n";
    }
});
```

### 4.2 Swoole 协程 + 协程上下文

```php
<?php
Swoole\Coroutine\Run(function () {
    // 使用 defer 确保资源释放（类似 Go 的 defer）
    go(function () {
        $fp = fopen('/tmp/test.txt', 'w');
        defer(function () use ($fp) {
            fclose($fp);
            echo "文件已关闭\n";
        });
        
        fwrite($fp, "Hello Swoole Coroutine!\n");
        // 协程结束时自动执行 defer，关闭文件
    });
    
    // 协程 Channel 实现生产者-消费者
    $channel = new Swoole\Coroutine\Channel(10);
    
    // 生产者
    go(function () use ($channel) {
        for ($i = 0; $i < 5; $i++) {
            $channel->push("消息 #{$i}");
            echo "生产: 消息 #{$i}\n";
            Swoole\Coroutine::sleep(0.1);
        }
        $channel->close();
    });
    
    // 消费者
    go(function () use ($channel) {
        while (true) {
            $msg = $channel->pop();
            if ($msg === false) break;
            echo "消费: {$msg}\n";
        }
    });
});
```

### 4.3 Hyperf 框架中的协程

Hyperf 是基于 Swoole 的高性能协程框架，是目前 PHP 协程框架中生态最完善的。

```php
<?php
// Hyperf 控制器中使用协程并发查询
namespace App\Controller;

use Hyperf\HttpServer\Annotation\Controller;
use Hyperf\HttpServer\Annotation\RequestMapping;
use Hyperf\Guzzle\ClientFactory;
use Hyperf\Di\Annotation\Inject;

#[Controller]
class DataController
{
    #[Inject]
    private ClientFactory $clientFactory;

    #[RequestMapping(path: "/dashboard")]
    public function dashboard()
    {
        $client = $this->clientFactory->create();
        
        // 使用协程并发请求（类似 Go 的 goroutine + WaitGroup）
        $result = parallel([
            'users' => function () use ($client) {
                return $client->get('http://user-service/api/count')->getBody()->getContents();
            },
            'orders' => function () use ($client) {
                return $client->get('http://order-service/api/count')->getBody()->getContents();
            },
            'products' => function () use ($client) {
                return $client->get('http://product-service/api/count')->getBody()->getContents();
            },
        ]);
        
        return $result; // 总耗时 = max(三个请求的耗时)，而非三者之和
    }
}
```

### 4.4 PHP 8.1 Fiber（原生协程）

PHP 8.1 引入了原生 `Fiber` 类，为框架作者提供了协程基础设施：

```php
<?php
// 基本 Fiber 用法
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('fiber started'); // 暂停，返回值给调用者
    echo "Fiber 收到: {$value}\n";
    
    $value2 = Fiber::suspend('fiber resumed');
    echo "Fiber 最后收到: {$value2}\n";
});

// 启动 fiber
$result = $fiber->start();  // "fiber started"
echo "主程序收到: {$result}\n";

// 恢复 fiber
$result = $fiber->resume('hello');  // "fiber resumed" → "Fiber 收到: hello"
echo "主程序收到: {$result}\n";

// 最后一次恢复
$fiber->resume('world');  // "Fiber 最后收到: world"
```

```php
<?php
// Fiber 实现简易调度器
function scheduler(): void {
    $fibers = [];
    
    // 创建多个 fiber
    for ($i = 0; $i < 3; $i++) {
        $fibers[] = new Fiber(function () use ($i): void {
            for ($j = 0; $j < 3; $j++) {
                echo "Fiber-{$i}: step {$j}\n";
                Fiber::suspend(); // 让出执行权
            }
        });
    }
    
    // 简单轮询调度
    $activeFibers = $fibers;
    while (count($activeFibers) > 0) {
        foreach ($activeFibers as $key => $fiber) {
            $fiber->start(); // 或 $fiber->resume()
            if ($fiber->isSuspended()) {
                $fiber->resume();
            } elseif ($fiber->isTerminated()) {
                unset($activeFibers[$key]);
            }
        }
    }
}

scheduler();
```

**Fiber 的定位**：Fiber 本身是一个底层原语，它不提供异步 I/O 能力。真正要在生产环境使用协程，需要配合事件循环（如 ReactPHP、Swoole、Amphp 等）。Fiber 的意义在于让框架可以用同步写法实现异步逻辑（消除 Callback Hell）。

## 五、性能对比

### 5.1 基准指标对比

| 指标 | 进程（pcntl） | 线程（pthreads） | 协程（Swoole） | 协程（Fiber） |
| --- | --- | --- | --- | --- |
| 创建开销 | 高（~1ms） | 中（~100μs） | 低（~1μs） | 极低（~0.1μs） |
| 内存占用/单元 | 10MB+ | 1-2MB | 10-50KB | 几 KB |
| 上下文切换耗时 | 1-10μs（内核态） | 1-5μs（内核态） | 50-100ns（用户态） | 50-100ns（用户态） |
| 单机并发上限 | 数百 | 数千 | 数万-数十万 | 数万 |
| I/O 并发能力 | 需多进程配合 | 需多线程配合 | 原生异步 I/O | 需配合事件循环 |
| CPU 密集性能 | 好（真正并行） | 好（真正并行） | 一般（单线程） | 一般（单线程） |
| 典型 QPS（HTTP） | 1K-5K | 5K-10K | 50K-200K | 10K-50K（框架依赖） |

### 5.2 实测场景参考

以一个典型的 HTTP 接口（查询数据库 + 返回 JSON）为例，单机 4 核 8G 内存：

| 方案 | QPS | 平均延迟 | P99 延迟 | 内存峰值 |
| --- | --- | --- | --- | --- |
| PHP-FPM（传统进程模型） | ~3,000 | 15ms | 50ms | 2GB（200 worker） |
| Swoole HTTP Server | ~80,000 | 2ms | 8ms | 200MB |
| Hyperf（协程框架） | ~60,000 | 2.5ms | 10ms | 250MB |
| Node.js（参照） | ~50,000 | 3ms | 12ms | 300MB |

> 数据来自社区基准测试，实际性能取决于业务逻辑、数据库、网络等因素。

## 六、场景选型指南

### 6.1 什么时候用多进程？

- **CLI 命令行任务**：Laravel Queue Worker、定时任务（Cron）、数据迁移脚本
- **CPU 密集型计算**：图片处理、视频转码、大量数据聚合（利用多核并行）
- **传统 Web 服务**：PHP-FPM 本身就是多进程模型，每个请求一个进程
- **需要隔离性的场景**：进程崩溃不影响其他进程，天然故障隔离

```
推荐方案：
├── Laravel Horizon（Redis Queue 多进程消费）
├── Supervisor 管理多进程 Worker
└── pcntl_fork 实现并行数据处理
```

### 6.2 什么时候用协程？

- **高并发 I/O 密集型**：API 网关、微服务、长连接服务（WebSocket）
- **并发 HTTP 请求**：同时调用多个下游服务（聚合接口）
- **数据库连接池**：大量并发数据库查询
- **实时通信**：聊天服务、推送服务、游戏服务器

```
推荐方案：
├── Swoole + Hyperf（最成熟的 PHP 协程生态）
├── Swoole + 自定义 Server
└── ReactPHP / Amphp（纯 PHP 事件驱动方案）
```

### 6.3 什么时候用线程？

坦率地说，在 PHP 生态中**几乎不推荐**多线程方案。原因：

1. 生产环境没有 ZTS 版本的 PHP
2. 扩展的线程安全性无法保证
3. 多进程和协程已经能覆盖绝大多数场景

唯一的例外是 **FFI（Foreign Function Interface）** 调用 C 库中的多线程代码。

### 6.4 混合方案

实际生产中，往往是多种模型混合使用：

```
┌─────────────────────────────────────────────┐
│  Swoole Server（协程模型）                    │
│  ├── Worker 进程 1（多个协程处理请求）        │
│  ├── Worker 进程 2（多个协程处理请求）        │
│  ├── Task Worker 进程（处理异步任务）         │
│  └── Manager 进程（管理所有 Worker）          │
└─────────────────────────────────────────────┘

这里同时用了：多进程（Worker 进程级并行）+ 协程（每个进程内并发处理）
```

## 七、踩坑案例与注意事项

### 7.1 Swoole 协程中使用阻塞函数

这是最常见的踩坑点。在 Swoole 协程环境中，**不能使用 PHP 原生的阻塞 I/O 函数**，否则会阻塞整个 Worker 进程，导致其他协程饿死。

```php
<?php
// ❌ 错误：在协程中使用 file_get_contents
go(function () {
    $html = file_get_contents('https://example.com'); // 阻塞！会卡住整个 Worker
    echo strlen($html);
});

// ❌ 错误：在协程中使用 sleep
go(function () {
    sleep(1); // 阻塞！应使用 Swoole\Coroutine::sleep(1)
    echo "done";
});

// ❌ 错误：在协程中使用 MySQL/Redis 扩展
go(function () {
    $redis = new Redis();       // phpredis 扩展是阻塞的
    $redis->connect('127.0.0.1', 6379);
    $redis->get('key');         // 阻塞！
});

// ✅ 正确：使用 Swoole 协程版客户端
go(function () {
    $http = new Swoole\Coroutine\Http\Client('example.com', 443, true);
    $http->get('/');
    echo $http->body;
});

go(function () {
    Swoole\Coroutine::sleep(1); // 协程级 sleep，不阻塞其他协程
    echo "done";
});

go(function () {
    $redis = new Swoole\Coroutine\Redis(); // Swoole 协程版 Redis
    $redis->connect('127.0.0.1', 6379);
    $redis->get('key');
});
```

**Swoole 协程中应替换的函数对照表：**

| 阻塞函数 | 协程替代方案 |
| --- | --- |
| `sleep()` | `Swoole\Coroutine::sleep()` |
| `usleep()` | `Swoole\Coroutine::usleep()` |
| `file_get_contents()` | `Swoole\Coroutine\Http\Client` 或 `Co::curl()` |
| `fopen()/fread()/fwrite()` | `Swoole\Coroutine::readFile()` / `writeFile()` |
| `mysqli` / `PDO` | `Swoole\Coroutine\MySQL` 或连接池 |
| `Redis` 扩展 | `Swoole\Coroutine\Redis` 或连接池 |
| `curl` 扩展 | `Swoole\Coroutine\Http\Client` 或 `Co::curl()` |
| `stream_socket_client()` | `Swoole\Coroutine\Client` |
| `socket_*` 系列 | `Swoole\Coroutine\Socket` |

### 7.2 进程中的数据库连接复用

```php
<?php
// ❌ 错误：fork 前建立的 MySQL 连接在子进程中共享，导致数据混乱
$pdo = new PDO('mysql:host=localhost;dbname=test', 'root', '');
$pid = pcntl_fork();

if ($pid === 0) {
    // 子进程直接使用父进程的 $pdo —— 危险！
    $pdo->query('SELECT ...'); // 可能与父进程的查询交错
    exit(0);
}

// ✅ 正确：子进程中重新建立连接
$pid = pcntl_fork();
if ($pid === 0) {
    $pdo = new PDO('mysql:host=localhost;dbname=test', 'root', '');
    $pdo->query('SELECT ...');
    exit(0);
}
```

### 7.3 协程环境下的全局变量与静态变量

```php
<?php
// ❌ 危险：协程切换时全局状态可能被污染
$requestCount = 0;
go(function () use (&$requestCount) {
    $requestCount++;
    Swoole\Coroutine::sleep(1); // 让出执行权
    echo $requestCount; // 可能已经被其他协程修改！
});

// ✅ 正确：使用 Swoole 协程上下文（Coroutine Context）
go(function () {
    $ctx = Swoole\Coroutine::getContext();
    $ctx['requestCount'] = 0;
    $ctx['requestCount']++;
    Swoole\Coroutine::sleep(1);
    echo $ctx['requestCount']; // 安全，隔离在当前协程
});
```

### 7.4 Swoole 与 Laravel 的兼容性

```php
<?php
// Laravel + Swoole 常见问题：
// 1. 不能使用 Laravel 的单例中保存请求状态
// 2. 不能使用 $_GET/$_POST/$_SERVER 等超全局变量
// 3. 中间件中的状态会跨请求泄漏

// 解决方案：
// 使用 laravel-s (https://github.com/hhxsv5/laravel-s) 或
// 使用 Hyperf（原生支持协程的框架）

// 在 Swoole 中使用 Laravel 需要注意：
// 每次请求重置 App 容器中的状态
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$response = $kernel->handle(
    $request = Illuminate\Http\Request::capture()
);
$response->send();
$kernel->terminate($request, $response);
// 但很多第三方包并不考虑协程安全性
```

### 7.5 常见误区

1. **协程 ≠ 多线程**：协程运行在单线程上，不能利用多核。要利用多核需要多进程 + 协程
2. **Swoole 不兼容所有 PHP 扩展**：部分 C 扩展在 Swoole 环境下有内存泄漏或段错误风险
3. **pcntl_fork 在 Web 下不可用**：PHP-FPM 的 worker 进程中调用 fork 会导致不可预期的问题
4. **协程不是银弹**：CPU 密集型任务用协程没有优势，反而因为单线程而更慢
5. **declare(ticks=1) 已过时**：PHP 7.0 以后信号处理更推荐使用 `pcntl_async_signals(true)`

## 八、总结

| 你的场景 | 推荐方案 |
| --- | --- |
| 传统 Web 应用 | PHP-FPM（多进程）即可 |
| CLI 队列/任务 | pcntl_fork + Supervisor |
| 高并发 API 服务 | Swoole / Hyperf（协程） |
| 聚合接口（并发调多个服务） | Swoole 协程并发 |
| CPU 密集型计算 | 多进程（pcntl）或 Shell 多进程 |
| WebSocket / 长连接 | Swoole |
| 微服务架构 | Hyperf + 协程 + 连接池 |

PHP 从一个「只能跑 Web」的语言，已经进化到可以支撑高并发、高性能服务。理解进程、线程和协程的本质区别，才能在正确的场景选择正确的工具。

## 相关阅读

- [PHP 生命周期与 SAPI](/categories/PHP/php/lifecycle/) — 了解 PHP 从启动到请求处理的完整生命周期
- [PHP 工作原理](/categories/PHP/php/how-it-works/) — 深入理解 PHP 引擎的执行机制
- [PHP 垃圾回收机制（GC）](/categories/PHP/php/gc/) — 协程环境下的内存管理与 GC 注意事项
- [Hyperf 框架](/categories/PHP/php/frameworks/hyperf-1/) — 基于 Swoole 的高性能协程框架实践
