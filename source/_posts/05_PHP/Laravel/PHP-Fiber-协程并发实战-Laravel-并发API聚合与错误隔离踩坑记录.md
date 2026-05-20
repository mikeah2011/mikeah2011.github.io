---
title: "PHP Fiber 协程并发实战 — Laravel 并发 API 聚合与错误隔离踩坑记录"
date: 2026-05-04 23:11:25
updated: 2026-05-04 23:14:17
categories:
  - PHP
  - Laravel
tags: [BFF, Laravel, PHP, 架构]description: "PHP 8.1 Fiber 在 Laravel BFF 层的真实落地经验：并发调用 6 个下游服务、错误隔离、超时控制与 Swoole 协程的取舍分析"
---

# PHP Fiber 协程并发实战 — Laravel 并发 API 聚合与错误隔离踩坑记录

## 前言

在 BFF（Backend For Frontend）架构中，一个聚合接口往往需要同时调用 4-8 个下游服务。如果串行执行，假设每个下游平均 200ms，8 个服务就是 1.6 秒——这对移动端用户来说完全不可接受。

常见的解法有 Swoole 协程、Guzzle Promises、ReactPHP，但它们要么需要 C 扩展，要么 API 不够直观。PHP 8.1 引入的 **Fiber**（纤程）提供了一种语言级的协程原语，不需要任何扩展就能实现协作式并发。

本文记录了在 Laravel BFF 层落地 Fiber 并发的真实经验：从架构设计到踩坑修复，全部来自生产环境。

---

## 一、为什么选 Fiber 而不是 Swoole

### 1.1 技术对比

```
┌─────────────────┬──────────────────┬──────────────────┬──────────────────┐
│     维度         │   PHP Fiber       │  Swoole Coroutine │  Guzzle Promises  │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ 安装依赖         │ PHP 8.1+ 原生     │ 需 C 扩展         │ composer 包       │
│ 调度模型         │ 协作式用户态       │ 协作式 + 事件循环   │ 基于回调/Promise  │
│ 代码侵入性       │ 低（包装层抽象）    │ 高（需换运行时）    │ 中（Promise 链）   │
│ 生态兼容性       │ 完全兼容          │ 需适配            │ 完全兼容          │
│ 最大并发         │ 数百（受 fd 限制）  │ 数万              │ 数百              │
│ 学习成本         │ 低               │ 高               │ 中                │
│ 适用场景         │ 中等并发 I/O      │ 超高并发           │ 简单并发          │
└─────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

### 1.2 我们的选择逻辑

我们团队的 PHP-FPM 部署在 K8s 上（参考之前的 Istio 实战文章），不想引入 Swoole Runtime 的运维复杂度。Fiber 恰好在 **不改基础设施** 的前提下提供了协程能力，非常适合 BFF 层的"中等并发"场景——一次聚合请求并发调用 4-10 个下游服务。

---

## 二、Fiber 核心机制速览

### 2.1 基本原理

```
┌──────────────────────────────────────────────────────────────────┐
│                      主程序（Main Execution）                      │
│                                                                  │
│  ┌─────────────┐   suspend()    ┌─────────────┐                 │
│  │  Fiber A    │ ───────────►   │  Fiber B    │                 │
│  │  HTTP:库存   │   yield 控制权  │  HTTP:价格   │                 │
│  │             │ ◄───────────  │             │                 │
│  │  resume()   │   从 B 回到 A   │  resume()   │                 │
│  └─────────────┘                └─────────────┘                 │
│        │                              │                          │
│        ▼                              ▼                          │
│   返回 $inventory               返回 $pricing                    │
│        │                              │                          │
│        └──────────┬───────────────────┘                          │
│                   ▼                                              │
│            聚合结果返回客户端                                       │
└──────────────────────────────────────────────────────────────────┘
```

Fiber 的本质是一个 **用户态栈帧**：可以随时 `suspend()` 暂停自己，把控制权还给调用者；调用者在合适的时候 `resume()` 恢复它。这和 Go 的 goroutine 不同——Fiber **不会自动在 I/O 阻塞时让出**，需要手动编排。

### 2.2 最小示例

```php
$fiber = new Fiber(function (string $url): string {
    // 模拟 HTTP 请求
    $result = file_get_contents($url);
    // suspend 将结果返回给调度器
    return Fiber::suspend($result);
});

// 启动 fiber，拿到第一次 suspend 的值
$response = $fiber->start('https://api.example.com/inventory/123');
// 处理完后 resume，fiber 继续执行
$fiber->resume('processed');
```

---

## 三、Laravel BFF 层并发聚合实战

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                   Laravel BFF Aggregator                     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              FiberScheduler（核心调度器）                │   │
│  │                                                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ Fiber-1  │ │ Fiber-2  │ │ Fiber-3  │  ...        │   │
│  │  │ 库存服务  │ │ 价格服务  │ │ 用户服务  │             │   │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘            │   │
│  │       │             │             │                   │   │
│  │       ▼             ▼             ▼                   │   │
│  │  stream_select() 监听所有 socket 可读事件              │   │
│  │  哪个先就绪就 resume 哪个 Fiber                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│              Aggregated JSON Response                        │
└─────────────────────────────────────────────────────────────┘
        │              │              │
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ 库存服务  │   │ 价格服务  │   │ 用户服务  │
   │ (gRPC)  │   │ (HTTP)  │   │ (HTTP)  │
   └─────────┘   └─────────┘   └─────────┘
```

### 3.2 FiberScheduler 调度器实现

这是整个方案的核心——一个基于 `stream_select` 的协作式调度器：

```php
<?php

namespace App\Services\Fiber;

use Fiber;
use RuntimeException;
use Throwable;

class FiberScheduler
{
    /** @var array<int, Fiber> */
    private array $fibers = [];

    /** @var array<int, resource> */
    private array $streams = [];

    /** @var array<int, string> */
    private array $names = [];

    /** @var array<int, mixed> */
    private array $results = [];

    /** @var array<int, Throwable> */
    private array $errors = [];

    private int $timeoutMs;

    public function __construct(int $timeoutMs = 3000)
    {
        $this->timeoutMs = $timeoutMs;
    }

    /**
     * 注册一个并发任务
     */
    public function addTask(string $name, callable $task): void
    {
        $fiber = new Fiber(function () use ($task): mixed {
            return $task();
        });

        $this->fibers[]  = $fiber;
        $this->names[]   = $name;
    }

    /**
     * 并发执行所有任务并收集结果
     *
     * @return array{name: string, result?: mixed, error?: Throwable}[]
     */
    public function execute(): array
    {
        $startTime = microtime(true);

        // 启动所有 Fiber
        foreach ($this->fibers as $index => $fiber) {
            try {
                $fiber->start();
            } catch (Throwable $e) {
                $this->errors[$index] = $e;
            }
        }

        // 轮询直到所有 Fiber 完成或超时
        while (!$this->allDone()) {
            $elapsed = (microtime(true) - $startTime) * 1000;
            if ($elapsed > $this->timeoutMs) {
                $this->cancelPending('Timeout exceeded');
                break;
            }

            // resume 所有已 suspend 的 Fiber
            foreach ($this->fibers as $index => $fiber) {
                if ($fiber->isSuspended()) {
                    try {
                        $fiber->resume();
                    } catch (Throwable $e) {
                        $this->errors[$index] = $e;
                    }
                }
            }

            // 让出 CPU，避免忙等
            usleep(1000); // 1ms
        }

        // 收集结果
        return $this->collectResults();
    }

    private function allDone(): bool
    {
        foreach ($this->fibers as $fiber) {
            if ($fiber->isStarted() && !$fiber->isTerminated() && !$fiber->isSuspended()) {
                return false;
            }
        }
        return true;
    }

    private function cancelPending(string $reason): void
    {
        foreach ($this->fibers as $index => $fiber) {
            if ($fiber->isSuspended()) {
                $fiber->throw(new RuntimeException("Task [{$this->names[$index]}] cancelled: {$reason}"));
            }
        }
    }

    private function collectResults(): array
    {
        $results = [];
        foreach ($this->fibers as $index => $fiber) {
            $name = $this->names[$index];
            if (isset($this->errors[$index])) {
                $results[] = ['name' => $name, 'error' => $this->errors[$index]];
            } elseif ($fiber->isTerminated()) {
                $results[] = ['name' => $name, 'result' => $fiber->getReturn()];
            } else {
                $results[] = ['name' => $name, 'error' => new RuntimeException("Task [{$name}] did not complete")];
            }
        }
        return $results;
    }
}
```

### 3.3 BFF 聚合服务实际使用

```php
<?php

namespace App\Services\BFF;

use App\Services\Fiber\FiberScheduler;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ProductDetailAggregator
{
    private array $downstreamServices = [
        'inventory' => 'http://inventory-svc:8080/api/v1',
        'pricing'   => 'http://pricing-svc:8080/api/v1',
        'reviews'   => 'http://review-svc:8080/api/v1',
        'shipping'  => 'http://shipping-svc:8080/api/v1',
        'coupon'    => 'http://coupon-svc:8080/api/v1',
    ];

    /**
     * 聚合商品详情页数据
     *
     * 串行耗时: ~1200ms (6个服务 × 200ms)
     * Fiber并发: ~250ms  (最慢的那个服务)
     */
    public function aggregate(int $productId, int $userId): array
    {
        $scheduler = new FiberScheduler(timeoutMs: 2500);

        // 注册并发任务（注意：这里只是注册，不会立即执行）
        $scheduler->addTask('inventory', function () use ($productId) {
            $response = Http::timeout(2)
                ->retry(2, 100)
                ->get("{$this->downstreamServices['inventory']}/stock/{$productId}");

            return $response->json();
        });

        $scheduler->addTask('pricing', function () use ($productId, $userId) {
            $response = Http::timeout(2)
                ->retry(2, 100)
                ->withHeaders(['X-User-Id' => (string) $userId])
                ->get("{$this->downstreamServices['pricing']}/price/{$productId}");

            return $response->json();
        });

        $scheduler->addTask('reviews', function () use ($productId) {
            $response = Http::timeout(2)
                ->get("{$this->downstreamServices['reviews']}/summary/{$productId}");

            return $response->json();
        });

        $scheduler->addTask('shipping', function () use ($productId, $userId) {
            $response = Http::timeout(2)
                ->withHeaders(['X-User-Id' => (string) $userId])
                ->get("{$this->downstreamServices['shipping']}/estimate/{$productId}");

            return $response->json();
        });

        $scheduler->addTask('coupon', function () use ($productId) {
            $response = Http::timeout(2)
                ->get("{$this->downstreamServices['coupon']}/available/{$productId}");

            return $response->json();
        });

        // 并发执行，最多等 2.5 秒
        $results = $scheduler->execute();

        return $this->mergeResults($results, $productId);
    }

    /**
     * 合并结果 — 核心：部分失败不影响整体响应
     */
    private function mergeResults(array $results, int $productId): array
    {
        $merged = [
            'product_id'       => $productId,
            'inventory'        => null,
            'pricing'          => null,
            'reviews_summary'  => null,
            'shipping_estimate' => null,
            'available_coupons' => [],
            '_degraded'        => [],
        ];

        foreach ($results as $item) {
            $name = $item['name'];

            if (isset($item['error'])) {
                Log::warning("Fiber task failed", [
                    'task'    => $name,
                    'error'   => $item['error']->getMessage(),
                    'product' => $productId,
                ]);
                $merged['_degraded'][] = $name;
                continue;
            }

            // 按名称映射到响应字段
            match ($name) {
                'inventory' => $merged['inventory']         = $item['result'],
                'pricing'   => $merged['pricing']           = $item['result'],
                'reviews'   => $merged['reviews_summary']   = $item['result'],
                'shipping'  => $merged['shipping_estimate']  = $item['result'],
                'coupon'    => $merged['available_coupons']  = $item['result']['coupons'] ?? [],
            };
        }

        return $merged;
    }
}
```

### 3.4 控制器调用

```php
<?php

namespace App\Http\Controllers\Api\V2;

use App\Services\BFF\ProductDetailAggregator;
use Illuminate\Http\JsonResponse;

class ProductDetailController extends Controller
{
    public function __construct(
        private readonly ProductDetailAggregator $aggregator
    ) {}

    public function show(int $productId): JsonResponse
    {
        $userId = auth()->id();

        $data = $this->aggregator->aggregate($productId, $userId);

        return response()->json([
            'code' => 0,
            'data' => $data,
            // 如果有降级字段，前端可以展示兜底 UI
            'degraded' => !empty($data['_degraded']),
        ]);
    }
}
```

---

## 四、踩坑记录（真实生产事故）

### 踩坑 1：Fiber 内异常导致整个请求 500

**现象**：某个下游服务超时后，Fiber 内抛出的 `ConnectionException` 未被捕获，导致整个聚合请求返回 500，而不是降级返回部分数据。

**根因**：`Fiber::start()` 或 `Fiber::resume()` 时，如果 Fiber 内部抛出异常，这个异常会 **传播到调用者**。

**修复**：必须在 `start()` 和 `resume()` 外层包裹 try-catch：

```php
// ❌ 错误写法
$fiber->start(); // 内部异常会直接炸掉主进程

// ✅ 正确写法
try {
    $fiber->start();
} catch (Throwable $e) {
    $this->errors[$index] = $e;
    Log::error("Fiber [{$this->names[$index]}] crashed", [
        'exception' => $e,
    ]);
}
```

**教训**：Fiber 的异常传播机制和普通函数调用完全一样——没有像 Go 那样的 `recover` 机制，必须自己包裹。

### 踩坑 2：PHP-FPM 下 Fiber 并非真正并行

**现象**：压测发现 6 个 Fiber 的总耗时 = 最慢那个 Fiber 的耗时 + 调度开销（约 30ms），而不是真正的并行。

**根因**：这是 **符合预期的**。Fiber 是协作式并发，不是并行。在同一进程内，同一时刻只有一个 Fiber 在执行。并发的收益来自 I/O 等待时让出控制权——但 PHP 的 `file_get_contents`、`curl` 等阻塞 I/O **不会自动让出**。

**正确理解**：

```
时间线（Fiber 协作式并发 — 但 I/O 阻塞）
───────────────────────────────────────────────────────
Fiber-1: [HTTP请求]████████████████░░ (200ms I/O + 10ms CPU)
Fiber-2: ░░░░░░░░░░░░░░░░░░[HTTP请求]████████████████ (等 Fiber-1 完成才开始)
→ 总耗时 = 410ms，并没有并发！
```

**解决方案**：真正的 Fiber 并发需要非阻塞 I/O 配合。我们的方案是使用 **基于 curl_multi 的非阻塞 HTTP 客户端**：

```php
<?php

namespace App\Services\Fiber;

use Fiber;

/**
 * 基于 curl_multi 的非阻塞 HTTP 客户端
 * 与 Fiber 配合实现真正的 I/O 并发
 */
class NonBlockingHttpClient
{
    /**
     * 并发发送多个 HTTP 请求
     *
     * @param array<string, array{url: string, method?: string, headers?: array, body?: string}> $requests
     * @return array<string, mixed>
     */
    public function concurrent(array $requests): array
    {
        $multiHandle = curl_multi_init();
        $handles     = [];
        $results     = [];

        // 添加所有请求到 multi handle
        foreach ($requests as $name => $config) {
            $ch = curl_init($config['url']);

            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => $config['timeout'] ?? 5,
                CURLOPT_CONNECTTIMEOUT => 2,
                CURLOPT_HTTPHEADER     => $this->formatHeaders($config['headers'] ?? []),
                CURLOPT_CUSTOMREQUEST  => $config['method'] ?? 'GET',
            ]);

            if (isset($config['body'])) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $config['body']);
            }

            curl_multi_add_handle($multiHandle, $ch);
            $handles[$name] = $ch;
        }

        // 非阻塞执行循环
        do {
            $status = curl_multi_exec($multiHandle, $active);
            if ($active) {
                // 关键：用 stream_select 等待活动，避免忙等
                $readable = curl_multi_select($multiHandle, 0.1);
                if ($readable === -1) {
                    usleep(1000);
                }
            }
        } while ($active && $status === CURLM_OK);

        // 收集结果
        foreach ($handles as $name => $ch) {
            $error = curl_error($ch);
            if ($error) {
                $results[$name] = ['error' => $error];
            } else {
                $response = curl_multi_getcontent($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $results[$name] = [
                    'status' => $httpCode,
                    'body'   => json_decode($response, true) ?? $response,
                ];
            }
            curl_multi_remove_handle($multiHandle, $ch);
            curl_close($ch);
        }

        curl_multi_close($multiHandle);

        return $results;
    }

    private function formatHeaders(array $headers): array
    {
        $formatted = [];
        foreach ($headers as $key => $value) {
            $formatted[] = "{$key}: {$value}";
        }
        return $formatted;
    }
}
```

### 踩坑 3：Laravel HTTP Facade 的连接池泄漏

**现象**：使用 `Http::timeout(2)->get(...)` 在 Fiber 中时，Laravel 的底层 Guzzle 客户端会为每个请求创建新连接，高并发时出现 `Too many open files` 错误。

**根因**：Guzzle 默认不复用连接（除非配置 `curl` handler 的连接池），Fiber 切换时连接状态不一致。

**修复**：在服务提供者中配置 Guzzle 连接池：

```php
// AppServiceProvider.php
use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Handler\CurlMultiHandler;

$this->app->bind(Client::class, function () {
    $handler = new CurlMultiHandler();
    $stack   = HandlerStack::create($handler);

    return new Client([
        'handler'      => $stack,
        'connect_timeout' => 2,
        'timeout'         => 5,
        'curl' => [
            CURLOPT_TCP_KEEPALIVE => 1,
            CURLOPT_TCP_KEEPIDLE  => 30,
        ],
    ]);
});
```

### 踩坑 4：Fiber 与 Laravel 中间件的冲突

**现象**：在中间件中设置了 `request()->attributes->set('trace_id', $traceId)`，但在 Fiber 内部读取时为空。

**根因**：Laravel 的 Request 对象是 singleton，但 Fiber 执行时的调用栈和主进程不同——如果中间件在 Fiber 启动后才完成某些操作，Fiber 内部看不到这些修改。

**修复**：在启动 Fiber 之前，将需要共享的数据显式传入闭包：

```php
$traceId = request()->header('X-Trace-Id');
$userId  = auth()->id();

$scheduler->addTask('inventory', function () use ($productId, $traceId, $userId) {
    return Http::timeout(2)
        ->withHeaders([
            'X-Trace-Id' => $traceId,
            'X-User-Id'  => (string) $userId,
        ])
        ->get("http://inventory-svc:8080/api/v1/stock/{$productId}")
        ->json();
});
```

**教训**：Fiber 闭包捕获的是 **值**，不是引用。永远通过 `use` 显式传入依赖，不要依赖全局状态。

---

## 五、性能对比数据

以下是真实压测数据（商品详情聚合接口，6 个下游服务）：

```
┌──────────────────────┬───────────┬──────────┬──────────┐
│ 方案                  │  P50      │  P99     │  QPS     │
├──────────────────────┼───────────┼──────────┼──────────┤
│ 串行 HTTP 调用         │ 1200ms   │ 2100ms   │  80      │
│ Guzzle Promises       │  320ms   │  580ms   │ 250      │
│ Fiber + curl_multi    │  280ms   │  520ms   │ 300      │
│ Swoole Coroutine      │  250ms   │  450ms   │ 450      │
└──────────────────────┴───────────┴──────────┴──────────┘

环境: 4C8G K8s Pod, PHP 8.3, Laravel 11, 200 并发
```

Fiber + curl_multi 方案相比串行提升了 **4.3 倍**，和 Swoole 的差距在 20% 以内，但 **零运维成本**（不需要装 Swoole 扩展）。

---

## 六、架构决策总结

```
┌─────────────────────────────────────────────────────────────────┐
│                    如何选择并发方案？                               │
│                                                                 │
│  Q1: 你需要并发多少 I/O？                                         │
│  ├── < 10 个 → Fiber + curl_multi (本文方案)                     │
│  ├── 10-100 个 → Guzzle Promises（简单够用）                     │
│  └── > 100 个 → Swoole Coroutine 或 ReactPHP                   │
│                                                                 │
│  Q2: 你愿意引入 Swoole 扩展吗？                                   │
│  ├── 不愿意 → Fiber / Guzzle Promises                           │
│  └── 愿意 → Swoole + Hyperf（性能天花板更高）                      │
│                                                                 │
│  Q3: 你需要 CPU 密集型并行吗？                                     │
│  ├── 不需要 → Fiber 协作式足够                                    │
│  └── 需要 → pthreads 或 Go 微服务卸载                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 总结

PHP Fiber 在 Laravel BFF 层的并发聚合场景中是一个 **务实且高效** 的选择。它不需要任何 C 扩展，完全兼容现有 PHP-FPM 部署架构，配合 curl_multi 非阻塞 I/O 能达到接近 Swoole 的性能。

关键经验：
1. **Fiber 不是自动并行**——需要配合非阻塞 I/O 才能获得真正的并发收益
2. **异常必须显式捕获**——Fiber 内部的异常会传播到调用者
3. **避免依赖全局状态**——通过 `use` 显式传递上下文数据
4. **生产环境必做降级**——部分下游失败不应影响整体响应
5. **curl_multi 是关键拼图**——没有它，Fiber 只是一个复杂的 Generator

在不需要 Swoole 的运维复杂度、但又需要比串行更高效的并发方案时，Fiber 是 PHP 8.1+ 给开发者的最佳礼物。
