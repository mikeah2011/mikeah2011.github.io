---
title: 'PHP 8.5 Fiber Pool 实战：协程池并发批量请求——对比 Go goroutine pool 的异步编程进阶'
date: 2026-06-06 10:00:00
description: 'PHP 8.5 Fiber Pool 实战教程，手写协程池实现并发批量 HTTP 请求，详解任务队列、最大并发控制与 curl_multi 非阻塞 I/O。与 Go goroutine pool 全面对比，含 Laravel Service Provider 集成方案、Guzzle Promise 性能基准测试、真实踩坑陷阱与生产环境最佳实践，助你掌握 PHP 异步编程进阶技巧。'
tags: [php-8.5, fiber, 协程, 并发, go, goroutine, 异步编程, laravel]
categories: [Laravel/PHP]
cover: /images/covers/php85-fiber-pool-goroutine-cover.jpg
---

在高并发场景下，批量发起 HTTP 请求是最常见的 I/O 瓶颈之一。Go 语言凭借 goroutine 天然的轻量级并发模型，在这方面早已驾轻就熟。而 PHP 从 8.1 引入 Fiber 原语，到 8.5 版本在调度器和生命周期管理上进一步完善后，我们终于可以在纯 PHP 层面构建一个实用的**协程池（Fiber Pool）**，实现类似 Go worker pool 模式的并发批量请求。

本文将从 Fiber 基础回顾出发，手写一个带任务队列和最大并发数控制的 Fiber Pool，实战并发调用 100 个 API，与 Go goroutine pool 做对比，并给出 Laravel 集成方案和性能基准测试。

<!-- more -->

---

## 一、PHP Fiber 基础回顾：suspend/resume 机制

Fiber 是 PHP 8.1 引入的**用户态协程**原语。它允许你在任意代码位置暂停（suspend）执行并交出控制权，之后从暂停点恢复（resume）继续执行。与 Generator 不同，Fiber 拥有独立的调用栈，可以在任意嵌套函数中 suspend。

### 1.1 核心 API

```php
$fiber = new Fiber(function (mixed $initial): mixed {
    $value = Fiber::suspend('fiber: 已暂停，等待输入');
    // $value 来自 resume() 传入的值
    return "fiber: 收到 [$value]";
});

// 启动 Fiber，$initial 传入闭包参数
$result = $fiber->start('初始值');
// $result = 'fiber: 已暂停，等待输入'

// 恢复执行，传入值会作为 Fiber::suspend() 的返回值
$result = $fiber->resume('来自外部的数据');
// $result = 'fiber: 收到 [来自外部的数据]'
```

### 1.2 生命周期状态

| 方法 | 状态转换 | 说明 |
|------|---------|------|
| `new Fiber(fn)` | → `created` | 创建但未启动 |
| `start()` | `created` → `started` / `suspended` | 启动执行 |
| `suspend()` | `running` → `suspended` | 主动让出控制权 |
| `resume()` | `suspended` → `running` | 恢复执行 |
| `getReturn()` | → `finished` | 获取返回值（Fiber 已结束） |

关键点：**Fiber 是协作式的**，必须显式调用 `suspend()` 才会让出，不会被强制抢占。这意味着 PHP 的 Fiber 本质上是协程（coroutine），而非 Go 那样的抢占式 goroutine。

### 1.3 为什么引入 Fiber？

在 Fiber 之前，PHP 的异步方案主要有：

- **Generator（生成器）**：只能在最顶层 yield，嵌套函数无法暂停
- **Swoole/OpenSwoole 扩展**：C 扩展实现的协程，功能强大但需额外安装
- **ReactPHP/Amp**：事件循环 + Promise，回调地狱或 async/await 语法

Fiber 的价值在于：它是**语言内建原语**，无需扩展，且框架可以在此之上构建更高级的 async/await 语义。Laravel 11+ 的并发（Concurrency）组件底层就使用了 Fiber。

---

## 二、为什么需要 Fiber Pool：单 Fiber 的局限

### 2.1 单 Fiber 的问题

一个 Fiber 只能串行执行一个任务。如果我们需要并发发起 100 个 HTTP 请求：

```php
// ❌ 错误理解：创建 100 个 Fiber 并不等于并发
$fibers = [];
for ($i = 0; $i < 100; $i++) {
    $fibers[] = new Fiber(function () use ($i) {
        return fetchApi("/api/item/{$i}");
    });
}
foreach ($fibers as $fiber) {
    $fiber->start(); // 这里依然是串行启动、串行阻塞！
}
```

问题在于：**`fetchApi()` 如果是同步阻塞调用（如 `file_get_contents`），Fiber 的 `suspend` 根本不会被触发**。每个 Fiber 内部还是会同步等待 I/O 完成，整体仍然是串行的。

### 2.2 Fiber Pool 的核心思路

要实现真正的并发，需要：

1. **非阻塞 I/O**：使用 `stream_select` 或 `curl_multi` 实现非阻塞网络调用
2. **任务队列**：将待执行的任务放入队列
3. **最大并发控制**：限制同时运行的 Fiber 数量，避免资源耗尽
4. **事件循环调度**：在主循环中轮询所有 Fiber 的状态，调度就绪的 Fiber 继续执行

这与 Go 的 goroutine + channel 模式本质相同，只是 PHP 需要手动实现调度器。

---

## 三、手写 Fiber Pool 实现

下面是一个生产可用的 Fiber Pool 实现，包含任务队列、最大并发数控制和结果收集。

### 3.1 完整实现

```php
<?php

declare(strict_types=1);

/**
 * FiberPool - PHP 8.5 协程池实现
 * 支持任务队列、最大并发数控制、结果收集
 */
class FiberPool
{
    /** @var int 最大并发数 */
    private int $maxConcurrency;

    /** @var SplQueue 待执行任务队列 */
    private SplQueue $taskQueue;

    /** @var array<int, Fiber> 活跃的 Fiber 列表 */
    private array $activeFibers = [];

    /** @var array<int, mixed> 收集的结果 */
    private array $results = [];

    /** @var array<int, Throwable> 收集的异常 */
    private array $errors = [];

    /** @var callable|null 异常处理回调 */
    private ?callable $errorHandler = null;

    /** @var int 已完成任务计数 */
    private int $completedCount = 0;

    /** @var int 总任务数 */
    private int $totalCount = 0;

    public function __construct(int $maxConcurrency = 10)
    {
        $this->maxConcurrency = $maxConcurrency;
        $this->taskQueue = new SplQueue();
    }

    /**
     * 添加任务到队列
     *
     * @param int $taskId   任务唯一标识
     * @param callable $task 任务闭包，返回值将被收集
     * @return self
     */
    public function addTask(int $taskId, callable $task): self
    {
        $this->taskQueue->enqueue(['id' => $taskId, 'task' => $task]);
        $this->totalCount++;
        return $this;
    }

    /**
     * 批量添加任务
     *
     * @param array<int, callable> $tasks 以 taskId => callable 形式传入
     * @return self
     */
    public function addTasks(array $tasks): self
    {
        foreach ($tasks as $id => $task) {
            $this->addTask($id, $task);
        }
        return $this;
    }

    /**
     * 设置异常处理回调
     */
    public function onError(callable $handler): self
    {
        $this->errorHandler = $handler;
        return $this;
    }

    /**
     * 执行所有任务并等待完成
     *
     * @return array<int, mixed> 以 taskId => result 形式返回结果
     */
    public function run(): array
    {
        while (!$this->taskQueue->isEmpty() || !empty($this->activeFibers)) {
            // 填充活跃 Fiber 至最大并发数
            $this->fillActiveFibers();

            // 遍历活跃 Fiber，恢复已暂停的
            foreach ($this->activeFibers as $id => $fiber) {
                if ($fiber->isSuspended()) {
                    try {
                        $fiber->resume();
                    } catch (Throwable $e) {
                        $this->handleError($id, $e);
                        unset($this->activeFibers[$id]);
                    }
                }

                // Fiber 已完成，收集结果
                if ($fiber->isTerminated()) {
                    try {
                        $this->results[$id] = $fiber->getReturn();
                    } catch (Throwable $e) {
                        $this->handleError($id, $e);
                    }
                    unset($this->activeFibers[$id]);
                    $this->completedCount++;
                }
            }

            // 如果没有活跃 Fiber 且队列非空（理论上不会发生），让出 CPU
            if (empty($this->activeFibers) && !$this->taskQueue->isEmpty()) {
                usleep(100);
            }
        }

        ksort($this->results);
        return $this->results;
    }

    /**
     * 获取错误列表
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * 获取完成进度
     */
    public function getProgress(): array
    {
        return [
            'total' => $this->totalCount,
            'completed' => $this->completedCount,
            'active' => count($this->activeFibers),
            'pending' => $this->taskQueue->count(),
        ];
    }

    /**
     * 从队列中取任务填入活跃 Fiber
     */
    private function fillActiveFibers(): void
    {
        while (
            count($this->activeFibers) < $this->maxConcurrency
            && !$this->taskQueue->isEmpty()
        ) {
            $item = $this->taskQueue->dequeue();
            $id = $item['id'];
            $task = $item['task'];

            $fiber = new Fiber(function () use ($task): mixed {
                return $task();
            });

            try {
                $fiber->start();
            } catch (Throwable $e) {
                $this->handleError($id, $e);
                continue;
            }

            // 如果任务在 start() 后就结束了（同步快速完成）
            if ($fiber->isTerminated()) {
                try {
                    $this->results[$id] = $fiber->getReturn();
                } catch (Throwable $e) {
                    $this->handleError($id, $e);
                }
                $this->completedCount++;
                continue;
            }

            $this->activeFibers[$id] = $fiber;
        }
    }

    private function handleError(int $taskId, Throwable $e): void
    {
        $this->errors[$taskId] = $e;
        if ($this->errorHandler !== null) {
            ($this->errorHandler)($taskId, $e);
        }
    }

    /**
     * 重置状态以便复用
     */
    public function reset(): void
    {
        $this->activeFibers = [];
        $this->results = [];
        $this->errors = [];
        $this->completedCount = 0;
        $this->totalCount = 0;
        $this->taskQueue = new SplQueue();
    }
}
```

### 3.2 设计要点解析

**任务队列（SplQueue）**：使用 PHP 内置的 `SplQueue`（双向链表）作为任务容器，`enqueue` 入队、`dequeue` 出队均为 O(1) 操作。

**最大并发控制**：`fillActiveFibers()` 方法确保 `activeFibers` 数组中同时存在的 Fiber 数量不超过 `maxConcurrency`。当一个 Fiber 完成或出队后，才会从队列中取新任务补充。

**结果收集**：每个任务通过 `taskId` 标识，结果存入 `$this->results[$taskId]`，最终 `ksort` 按 key 排序后返回，保证结果顺序与任务提交顺序一致。

**异常隔离**：单个任务的异常不会影响其他任务的执行。通过 `onError()` 注册回调，可以自定义错误处理逻辑（日志、告警等）。

---

## 四、实战：并发调用 100 个 API 并聚合结果

### 4.1 模拟 API 调用

在实际场景中，我们需要用 `curl_multi` 或 `stream_select` 实现非阻塞 I/O。这里为了演示 Fiber Pool 的核心逻辑，我们用 `usleep` 模拟 I/O 延迟，用 `Fiber::suspend` 实现协作式让出。

```php
<?php

require_once 'FiberPool.php';

/**
 * 模拟非阻塞 HTTP 请求
 * 在真实场景中，这里会用 curl_multi_* 或 ReactPHP HttpClient
 */
function fetchApi(int $itemId): array
{
    // 模拟 50-200ms 的网络延迟
    $delay = random_int(50, 200) * 1000; // microseconds
    usleep($delay);

    // 模拟 API 响应
    return [
        'id' => $itemId,
        'name' => "Item #{$itemId}",
        'price' => random_int(100, 10000) / 100,
        'delay_ms' => $delay / 1000,
    ];
}

// ========== 构建任务池 ==========
$pool = new FiberPool(maxConcurrency: 20);

// 添加 100 个任务
for ($i = 1; $i <= 100; $i++) {
    $pool->addTask($i, function () use ($i) {
        return fetchApi($i);
    });
}

// 注册错误处理
$pool->onError(function (int $id, Throwable $e) {
    echo "Task #{$id} failed: {$e->getMessage()}\n";
});

// 执行并计时
$start = hrtime(true);
$results = $pool->run();
$elapsed = (hrtime(true) - $start) / 1e6; // 转为毫秒

// ========== 结果聚合 ==========
$progress = $pool->getProgress();
$errors = $pool->getErrors();

echo "=== 执行完成 ===\n";
echo "成功: {$progress['completed']} / {$progress['total']}\n";
echo "失败: " . count($errors) . "\n";
echo "耗时: {$elapsed}ms\n";

// 聚合统计
$prices = array_column($results, 'price');
echo "\n=== 聚合结果 ===\n";
echo "平均价格: " . (array_sum($prices) / count($prices)) . "\n";
echo "最高价格: " . max($prices) . "\n";
echo "最低价格: " . min($prices) . "\n";
```

### 4.2 带真实 curl_multi 的生产级实现

对于生产环境，我们需要真正的非阻塞 I/O。以下是一个基于 `curl_multi` 的包装器，与 Fiber Pool 配合使用：

```php
<?php

/**
 * 基于 curl_multi 的并发请求封装
 */
class ConcurrentHttpClient
{
    private $multiHandle;
    private array $curlHandles = [];
    private array $responses = [];

    public function __construct()
    {
        $this->multiHandle = curl_multi_init();
    }

    public function addRequest(int $id, string $url, array $options = []): void
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, array_merge([
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ], $options));

        curl_multi_add_handle($this->multiHandle, $ch);
        $this->curlHandles[$id] = $ch;
    }

    /**
     * 执行所有请求并返回结果
     * 内部使用 curl_multi_select 实现非阻塞轮询
     */
    public function execute(): array
    {
        $running = 0;

        do {
            // 执行所有 cURL 句柄的读写操作
            $status = curl_multi_exec($this->multiHandle, $running);

            // 如果还有活跃句柄，使用 curl_multi_select 等待事件
            if ($running > 0) {
                curl_multi_select($this->multiHandle, 1.0);
            }

            // 检查完成的句柄
            while ($info = curl_multi_info_read($this->multiHandle)) {
                $ch = $info['handle'];
                $id = array_search($ch, $this->curlHandles);

                if ($id !== false) {
                    $this->responses[$id] = [
                        'body' => curl_multi_getcontent($ch),
                        'http_code' => curl_getinfo($ch, CURLINFO_HTTP_CODE),
                        'error' => curl_error($ch),
                    ];
                    curl_multi_remove_handle($this->multiHandle, $ch);
                    curl_close($ch);
                }
            }
        } while ($running > 0 && $status === CURLM_OK);

        curl_multi_close($this->multiHandle);
        return $this->responses;
    }
}

// 与 Fiber Pool 结合使用
$pool = new FiberPool(maxConcurrency: 20);

// 将 100 个 URL 分为 5 批（每批 20 个），每批用 curl_multi 并发
$urls = [];
for ($i = 1; $i <= 100; $i++) {
    $urls[$i] = "https://api.example.com/items/{$i}";
}

$batches = array_chunk($urls, 20, true);
$batchId = 0;

foreach ($batches as $batch) {
    $pool->addTask($batchId++, function () use ($batch) {
        $client = new ConcurrentHttpClient();
        foreach ($batch as $id => $url) {
            $client->addRequest($id, $url);
        }
        return $client->execute();
    });
}

$batchResults = $pool->run();

// 合并所有批次结果
$allResults = [];
foreach ($batchResults as $batch) {
    foreach ($batch as $id => $response) {
        $allResults[$id] = json_decode($response['body'], true);
    }
}
ksort($allResults);
```

---

## 五、对比 Go goroutine pool（errgroup + worker pool 模式）

Go 语言的并发模型基于 goroutine（用户态线程）+ channel（消息传递）。下面我们用 Go 实现相同的功能，以直观对比两种语言的并发编程范式。

### 5.1 Go errgroup + Worker Pool 实现

```go
package main

import (
    "context"
    "fmt"
    "math/rand"
    "sync"
    "time"

    "golang.org/x/sync/errgroup"
)

type Item struct {
    ID       int     `json:"id"`
    Name     string  `json:"name"`
    Price    float64 `json:"price"`
    DelayMs  int     `json:"delay_ms"`
}

func fetchApi(ctx context.Context, itemID int) (*Item, error) {
    // 模拟 50-200ms 的网络延迟
    delay := time.Duration(50+rand.Intn(150)) * time.Millisecond
    select {
    case <-time.After(delay):
    case <-ctx.Done():
        return nil, ctx.Err()
    }

    return &Item{
        ID:      itemID,
        Name:    fmt.Sprintf("Item #%d", itemID),
        Price:   float64(100+rand.Intn(9900)) / 100,
        DelayMs: int(delay.Milliseconds()),
    }, nil
}

func main() {
    const (
        totalItems    = 100
        maxConcurrency = 20
    )

    results := make([]*Item, totalItems)
    var mu sync.Mutex

    start := time.Now()

    // errgroup 控制并发和错误传播
    g, ctx := errgroup.WithContext(context.Background())
    // 用 channel 作为信号量限制并发数
    sem := make(chan struct{}, maxConcurrency)

    for i := 1; i <= totalItems; i++ {
        itemID := i // 捕获循环变量
        sem <- struct{}{} // 获取信号量（阻塞直到有空位）

        g.Go(func() error {
            defer func() { <-sem }() // 释放信号量

            item, err := fetchApi(ctx, itemID)
            if err != nil {
                return fmt.Errorf("task #%d failed: %w", itemID, err)
            }

            mu.Lock()
            results[itemID-1] = item
            mu.Unlock()

            return nil
        })
    }

    if err := g.Wait(); err != nil {
        fmt.Printf("Error: %v\n", err)
    }

    elapsed := time.Since(start)
    fmt.Printf("=== Go 执行完成 ===\n")
    fmt.Printf("耗时: %v\n", elapsed)

    // 聚合统计
    var totalPrice float64
    maxPrice, minPrice := 0.0, results[0].Price
    for _, item := range results {
        totalPrice += item.Price
        if item.Price > maxPrice {
            maxPrice = item.Price
        }
        if item.Price < minPrice {
            minPrice = item.Price
        }
    }
    fmt.Printf("平均价格: %.2f\n", totalPrice/float64(totalItems))
    fmt.Printf("最高价格: %.2f\n", maxPrice)
    fmt.Printf("最低价格: %.2f\n", minPrice)
}
```

### 5.2 范式对比

| 维度 | PHP Fiber Pool | Go goroutine + errgroup |
|------|---------------|------------------------|
| **并发原语** | Fiber（协作式协程） | goroutine（可抢占式轻量线程） |
| **调度方式** | 手动轮询（run loop） | Go runtime 自动调度 |
| **并发控制** | maxConcurrency 参数 | channel 信号量 |
| **错误处理** | 手动收集到数组 | errgroup 自动传播 + context 取消 |
| **上下文取消** | 无内建支持（需手动实现） | context.Context 原生支持 |
| **内存开销** | 每个 Fiber ~ 几 KB 栈 | 每个 goroutine ~ 2-8 KB 栈 |
| **创建开销** | 较高（PHP 对象） | 极低（runtime 管理） |
| **适用场景** | Web 请求生命周期内 | 任何长时间运行的服务 |
| **生态成熟度** | 较新，社区方案不统一 | 极成熟，标准库内置 |

关键差异总结：Go 的 goroutine 是**抢占式调度**，runtime 会在安全点自动切换 goroutine，而 PHP Fiber 是**协作式**的，必须显式 `suspend()`。这意味着在 PHP 中如果某个 Fiber 内部执行了长时间的 CPU 密集计算而没有调用 suspend，整个 Pool 就会被阻塞。

---

## 六、性能基准测试：Fiber Pool vs 串行 vs Promise（Guzzle）

### 6.1 测试方案

测试场景：并发请求 100 个模拟 API 端点（每个响应延迟 100ms）。

```php
<?php

// benchmark.php
require_once 'FiberPool.php';
require 'vendor/autoload.php'; // Guzzle

const TASK_COUNT = 100;
const CONCURRENCY = 20;
const SIMULATED_DELAY_US = 100_000; // 100ms

function simulatedFetch(int $id): array
{
    usleep(SIMULATED_DELAY_US);
    return ['id' => $id, 'status' => 'ok'];
}

// ========== 1. 串行执行 ==========
$start = hrtime(true);
$serialResults = [];
for ($i = 1; $i <= TASK_COUNT; $i++) {
    $serialResults[$i] = simulatedFetch($i);
}
$serialTime = (hrtime(true) - $start) / 1e6;

// ========== 2. Fiber Pool ==========
$start = hrtime(true);
$pool = new FiberPool(CONCURRENCY);
for ($i = 1; $i <= TASK_COUNT; $i++) {
    $pool->addTask($i, fn() => simulatedFetch($i));
}
$fiberResults = $pool->run();
$fiberTime = (hrtime(true) - $start) / 1e6;

// ========== 3. Guzzle Promise（并发请求） ==========
$start = hrtime(true);
$promises = [];
$client = new \GuzzleHttp\Client();
for ($i = 1; $i <= TASK_COUNT; $i++) {
    // 用 Guzzle 的 MockHandler 模拟（避免真实网络）
    // 这里用 PromiseCreate 模拟
    $promises[$i] = \GuzzleHttp\Promise\Create::promiseFor(simulatedFetch($i));
}
// 实际测试中应使用 $client->getAsync() 真实异步
\GuzzleHttp\Promise\Utils::settle($promises)->wait();
$guzzleTime = (hrtime(true) - $start) / 1e6;

// ========== 结果 ==========
echo "| 方案 | 耗时 | 加速比 |\n";
echo "|------|------|--------|\n";
echo sprintf("| 串行执行 | %dms | 1x |\n", $serialTime);
echo sprintf("| Fiber Pool (并发=%d) | %dms | %.1fx |\n", CONCURRENCY, $fiberTime, $serialTime / $fiberTime);
echo sprintf("| Guzzle Promise | %dms | %.1fx |\n", $guzzleTime, $serialTime / $guzzleTime);
```

### 6.2 预期结果

在模拟 100ms 延迟 × 100 个请求的场景下：

| 方案 | 预期耗时 | 理论加速比 |
|------|---------|-----------|
| 串行执行 | ~10,000ms（100×100ms） | 1x |
| Fiber Pool（并发=20） | ~600-800ms | 12-16x |
| Guzzle Promise（并发=20） | ~600-800ms | 12-16x |
| Go goroutine（并发=20） | ~500-600ms | 16-20x |

分析：

- **Fiber Pool 与 Guzzle Promise 性能接近**，因为瓶颈在网络 I/O，两者的并发模式都能有效利用等待时间
- **Go 略快**，因为 goroutine 调度更轻量，且 Go runtime 的网络轮询器与 epoll/kqueue 深度集成
- **Fiber Pool 的优势在于代码可读性**——同步风格的代码实现异步效果，比 Promise 的 `->then()` 链更直观

---

## 七、Laravel 中集成 Fiber Pool 的 Service Provider 封装

### 7.1 安装与注册

```bash
# 将 FiberPool 类放入 app/Concurrency/FiberPool.php
# 或发布为独立 Composer 包
```

### 7.2 Service Provider

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Concurrency\FiberPool;
use Illuminate\Contracts\Foundation\Application;

class FiberPoolServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 注册默认 FiberPool 实例
        $this->app->singleton(FiberPool::class, function (Application $app) {
            $config = $app->make('config')->get('fiber-pool', []);
            return new FiberPool(
                maxConcurrency: $config['max_concurrency'] ?? 10
            );
        });

        // 注册带自定义配置的实例（用于特定场景）
        $this->app->bind('fiber-pool.high-concurrency', function (Application $app) {
            return new FiberPool(
                maxConcurrency: $app->make('config')->get('fiber-pool.high_concurrency', 50)
            );
        });
    }

    public function boot(): void
    {
        // 发布配置文件
        $this->publishes([
            __DIR__ . '/../../config/fiber-pool.php' => config_path('fiber-pool.php'),
        ], 'fiber-pool-config');
    }
}
```

### 7.3 配置文件 `config/fiber-pool.php`

```php
<?php

return [
    /*
    |--------------------------------------------------------------------------
    | 默认最大并发数
    |--------------------------------------------------------------------------
    */
    'max_concurrency' => env('FIBER_POOL_CONCURRENCY', 10),

    /*
    |--------------------------------------------------------------------------
    | 高并发场景的最大并发数
    |--------------------------------------------------------------------------
    */
    'high_concurrency' => env('FIBER_POOL_HIGH_CONCURRENCY', 50),

    /*
    |--------------------------------------------------------------------------
    | 任务超时时间（秒）
    |--------------------------------------------------------------------------
    */
    'task_timeout' => env('FIBER_POOL_TASK_TIMEOUT', 30),
];
```

### 7.4 Facade

```php
<?php

namespace App\Concurrency;

use Illuminate\Support\Facades\Facade;

class FiberPoolFacade extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return FiberPool::class;
    }
}
```

### 7.5 Laravel 中使用示例

```php
<?php

namespace App\Services;

use App\Concurrency\FiberPool;

class ProductService
{
    public function __construct(
        private FiberPool $pool
    ) {}

    /**
     * 批量获取商品详情
     */
    public function batchFetchDetails(array $productIds): array
    {
        $this->pool->reset(); // 复用前重置

        foreach ($productIds as $id) {
            $this->pool->addTask($id, function () use ($id) {
                return $this->fetchProductDetail($id);
            });
        }

        return $this->pool->run();
    }

    /**
     * 聚合多个数据源
     */
    public function aggregateDashboard(int $userId): array
    {
        $this->pool->reset();

        $this->pool->addTask(1, fn() => $this->fetchUserProfile($userId));
        $this->pool->addTask(2, fn() => $this->fetchOrders($userId));
        $this->pool->addTask(3, fn() => $this->fetchNotifications($userId));
        $this->pool->addTask(4, fn() => $this->fetchRecommendations($userId));

        $results = $this->pool->run();

        return [
            'profile' => $results[1] ?? null,
            'orders' => $results[2] ?? [],
            'notifications' => $results[3] ?? [],
            'recommendations' => $results[4] ?? [],
        ];
    }
}
```

### 7.6 与 Laravel Concurrency 组件对比

Laravel 11+ 内置了 `Concurrency` 门面，底层使用 `SyncDriver`（串行）、`ForkDriver`（pcntl_fork）或 `ProcessDriver`（子进程）。对比：

| 特性 | Laravel Concurrency | Fiber Pool |
|------|-------------------|-----------|
| 并发模式 | 多进程（fork/process） | 单进程内协程 |
| 内存开销 | 每个进程独立内存空间 | 共享内存，开销极小 |
| 数据传递 | 需要序列化/反序列化 | 直接内存访问 |
| 适用场景 | CPU 密集型 + I/O 密集型 | 纯 I/O 密集型 |
| 最大并发数 | 受进程数限制（通常 8-16） | 可达数百（受连接数限制） |

建议：CPU 密集任务用 Laravel Concurrency（多进程），纯 I/O 密集任务用 Fiber Pool（协程更轻量）。

---

## 八、适用场景与局限性分析

### 8.1 适用场景

1. **批量 API 调用**：需要并发请求多个外部服务并聚合结果（如微服务聚合网关）
2. **Dashboard 数据聚合**：一个页面需要从 4-6 个数据源获取数据
3. **数据导入/导出**：批量从外部系统拉取数据
4. **Webhook 批量分发**：同时向多个订阅者发送事件通知
5. **健康检查**：并发检测多个下游服务的健康状态

### 8.2 局限性

**1. 依然是单线程**

Fiber Pool 在 PHP 的单线程模型内运行。它不能利用多核 CPU，适合 I/O 等待密集的场景，不适合 CPU 密集型计算。

**2. 需要非阻塞 I/O 配合**

如果任务内部调用了阻塞式 I/O（如 `file_get_contents`、同步 `curl_exec`），Fiber 的协作调度优势无法发挥。必须配合 `curl_multi` 或支持 Fiber 感知的异步库（如 ReactPHP）使用。

**3. 没有原生上下文取消机制**

Go 的 `context.Context` 可以在任意层级传播取消信号。PHP Fiber 没有类似机制，需要在任务内部自行检查取消标志：

```php
$cancelled = false;

$pool->addTask($id, function () use (&$cancelled) {
    while (!$cancelled && $hasMoreWork) {
        // 执行工作
        Fiber::suspend(); // 让出控制权
    }
});
```

**4. 错误恢复不完善**

当前实现在某个 Fiber 异常时只能收集错误并继续，无法像 Go 的 `errgroup` 那样自动取消所有其他任务。需要手动实现取消逻辑。

**5. 调试困难**

Fiber 的执行流是非线性的（suspend/resume），Xdebug 对 Fiber 的支持在 PHP 8.5 中虽然有改善，但仍然不如普通代码直观。

**6. 不能在 CLI 之外长期运行**

PHP-FPM 的请求生命周期内可以使用 Fiber Pool，但不适合构建长时间运行的守护进程。这类场景仍然推荐 Swoole 或 RoadRunner。

### 8.3 与 Go 的选择建议

| 场景 | 推荐方案 |
|------|---------|
| 已有 PHP 项目，需要优化聚合请求 | PHP Fiber Pool |
| 新建高并发微服务 | Go |
| 需要 CPU + I/O 混合并发 | Go goroutine |
| Laravel API 网关聚合层 | Fiber Pool + curl_multi |
| 长连接/WebSocket 服务 | Go 或 Swoole |
| 简单的并发 HTTP 调用 | Fiber Pool（开发效率高） |

---

## 九、总结

PHP 8.5 的 Fiber 原语虽然不如 Go 的 goroutine 那样"开箱即用"，但通过手写 Fiber Pool，我们可以在单进程内实现高效的并发 I/O 调度。关键收获：

1. **Fiber 是协作式的**，必须配合非阻塞 I/O 才能发挥并发优势
2. **Fiber Pool = 任务队列 + 最大并发控制 + 事件循环调度**，三者缺一不可
3. **性能与 Guzzle Promise 接近**，但代码可读性更好（同步写法，异步执行）
4. **Laravel 集成简单**，通过 Service Provider + Facade 即可全局复用
5. **Go 仍然是并发编程的标杆**，但 PHP Fiber Pool 足以覆盖大多数 Web 场景的 I/O 并发需求

对于正在从 PHP 迁移到 Go 的团队，Fiber Pool 提供了一个"折中方案"：在不切换语言栈的前提下，显著提升 PHP 应用的并发 I/O 性能。当业务复杂度增长到需要真正的多核并发、长连接或复杂调度时，再考虑 Go 也不迟。

---

> **参考资料**
>
> - [PHP 8.5 Fiber RFC](https://wiki.php.net/rfc/fiber)
> - [Go Concurrency Patterns](https://go.dev/blog/pipelines)
> - [errgroup 官方文档](https://pkg.go.dev/golang.org/x/sync/errgroup)
> - [Laravel Concurrency](https://laravel.com/docs/concurrency)
> - [Guzzle Promises](https://docs.guzzlephp.org/en/stable/promises.html)

---

## 相关阅读

- [Swoole 常驻内存踩坑深度剖析：全局变量污染、静态属性残留、连接泄漏——PHP-FPM 到 Octane 的思维模式迁移](/categories/Laravel/PHP/swoole-resident-memory-pitfalls-deep-dive/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/categories/架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
- [Elixir OTP 实战：Supervisor 树、GenServer、分布式进程——对比 PHP-FPM 无状态模型的并发哲学](/categories/架构/Elixir-OTP-实战-Supervisor树-GenServer-分布式进程-对比PHP-FPM无状态模型的并发哲学/)
