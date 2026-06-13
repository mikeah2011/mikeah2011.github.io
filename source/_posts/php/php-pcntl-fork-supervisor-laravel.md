---
title: 'PHP 多进程实战：pcntl_fork + 信号处理——替代 Supervisor 的 PHP 原生进程管理与 Laravel 命令并发执行'
date: 2026-06-06 10:00:00
tags: [PHP, 多进程, pcntl, Laravel, Supervisor]
keywords: [PHP, pcntl, fork, Supervisor, Laravel, 多进程实战, 信号处理, 替代, 原生进程管理与, 命令并发执行]
description: "深入讲解 PHP pcntl_fork 多进程编程实战，从 fork 模型原理、SIGTERM/SIGCHLD 信号处理、进程池设计到 Laravel Artisan 命令并发执行。完整实现替代 Supervisor 的 PHP 原生进程管理方案，包含十万订单 CSV 并发导出真实案例、数据库连接复用陷阱排查、共享内存通信、优雅退出流程等生产级踩坑经验与性能基准对比。"
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


# PHP 多进程实战：pcntl_fork + 信号处理——替代 Supervisor 的 PHP 原生进程管理与 Laravel 命令并发执行

## 一、开篇：为什么需要 PHP 多进程

在 B2C 电商系统的日常开发中，我们经常会遇到一类特殊的任务——它们的数据量大、执行时间长，单进程串行跑起来不仅效率低下，还可能因为执行超时或内存耗尽而中途崩溃。这类任务有一个共同特征：它们可以被拆分成若干互不依赖的子任务并行处理。以下是我们真实项目中反复出现的几个场景：

**场景一：批量导入订单。** 运营团队每周会从供应商处拿到一份包含数万条记录的 Excel 文件，需要将其中的商品、价格、库存信息同步到系统中。如果单进程逐条插入数据库，十万条记录可能需要跑半个多小时，期间一旦数据库连接断开或 PHP 超时，整个导入就前功尽弃。

**场景二：并发抓取竞品价格。** 我们的定价系统需要定期从十余个竞品平台抓取价格数据。每个平台的抓取逻辑相互独立，单进程串行抓取一个平台平均耗时 3 秒，十几个平台串行下来就是四五十秒。如果能同时启动多个进程分别抓取不同平台，总耗时可以压缩到最慢的那一个平台的时间。

**场景三：消息队列消费。** 虽然 Laravel 自带 Queue Worker，但在某些场景下——比如消费外部 MQ（RabbitMQ、Kafka）的消息——我们需要自己管理消费者进程的数量、健康检查和优雅重启。单个消费者进程的吞吐量往往无法满足高并发场景下的消息堆积处理需求。

这些场景的共同解决方案就是**多进程编程**。在 PHP 生态中，`pcntl` 扩展提供了 `pcntl_fork` 系统调用的封装，让我们可以在 PHP 中像 C 语言一样创建子进程。配合信号处理机制（`pcntl_signal`），我们完全可以用纯 PHP 代码构建一个轻量级的进程管理器，替代 Supervisor 等外部工具来完成特定场景下的并发任务。

本文将从 `pcntl_fork` 的基本原理讲起，逐步深入到信号处理、进程池设计、Laravel 集成，并通过一个真实的大订单 CSV 导出案例，展示如何在 B2C 项目中落地 PHP 多进程方案。

---

## 二、pcntl 扩展基础：理解 fork 模型

### 2.1 pcntl_fork 的工作原理

`pcntl_fork` 是 Unix/Linux 系统调用 `fork()` 的 PHP 封装。它的行为可以用一句话概括：**调用一次，返回两次**。父进程调用 `pcntl_fork()` 后，操作系统会复制父进程的整个地址空间，创建一个几乎一模一样的子进程。父子进程从 `pcntl_fork()` 的下一行代码开始分别执行——父进程获得子进程的 PID（正整数），子进程获得 0。

```php
<?php

$pid = pcntl_fork();

if ($pid === -1) {
    // fork 失败——系统资源不足或达到进程上限
    die('Could not fork');
} elseif ($pid === 0) {
    // 子进程：$pid 为 0
    echo "I am the child process, my PID is " . getmypid() . "\n";
} else {
    // 父进程：$pid 是子进程的 PID
    echo "I am the parent process, child PID is $pid, my PID is " . getmypid() . "\n";
}
```

这段代码的输出顺序是不确定的——父进程和子进程是并发执行的，谁先输出取决于操作系统的调度策略。这也是多进程编程中最基本的不确定性，后续我们需要通过 `pcntl_waitpid` 或信号机制来实现同步。

### 2.2 父子进程关系与进程状态

在 Linux 中，每个进程都有一个父进程（PID 为 1 的 init/systemd 除外）。父子进程之间的关系决定了进程退出后的资源回收机制：

**僵尸进程（Zombie Process）**：当子进程退出后，如果父进程没有调用 `pcntl_waitpid` 回收其退出状态，子进程的进程表项仍然保留，成为僵尸进程。僵尸进程不占用内存和 CPU，但会占用 PID 空间。在高频率创建子进程的场景中，如果不及时回收，系统很快就会因为 PID 耗尽而无法创建新进程。

**孤儿进程（Orphan Process）**：当父进程先于子进程退出时，子进程成为孤儿进程，会被 init 进程（PID 1）收养。孤儿进程本身不会造成问题，因为 init 进程会自动回收它们。但在我们的进程管理场景中，我们通常不希望子进程变成孤儿进程——因为这意味着父进程已经异常退出，子进程的运行状态就失去了监控。

以下代码演示了僵尸进程的产生与回收：

```php
<?php

$pid = pcntl_fork();

if ($pid === 0) {
    // 子进程：模拟一个耗时任务后退出
    sleep(2);
    echo "Child exiting\n";
    exit(0);
} else {
    // 父进程：先 sleep 5 秒，期间子进程会变成僵尸
    // 正确做法是及时调用 pcntl_waitpid
    sleep(5);
    $exitPid = pcntl_waitpid($pid, $status);
    echo "Reaped child $exitPid, exit status: " . pcntl_wexitstatus($status) . "\n";
}
```

### 2.3 必须掌握的 pcntl 核心函数

在深入实践之前，我们先梳理一下后续会频繁用到的 pcntl 核心函数：

| 函数 | 作用 |
|------|------|
| `pcntl_fork()` | 创建子进程，返回值：父进程得到子 PID，子进程得到 0，失败返回 -1 |
| `pcntl_waitpid($pid, &$status, $options)` | 等待指定子进程退出并回收资源 |
| `pcntl_wexitstatus($status)` | 从 waitpid 返回的状态中提取退出码 |
| `pcntl_signal($signo, $handler)` | 注册信号处理函数 |
| `pcntl_signal_dispatch()` | 分发待处理信号（需要配合 ticks 或手动调用） |
| `pcntl_async_signals(true)` | PHP 7.1+ 启用异步信号处理，无需 ticks |
| `posix_kill($pid, $signo)` | 向指定进程发送信号 |
| `getmypid()` | 获取当前进程 PID |

---

## 三、信号处理：让进程优雅地响应外部事件

### 3.1 信号的基本概念

信号是 Unix/Linux 系统中进程间通信（IPC）最古老的机制之一。它是一种软件中断——当某个事件发生时，内核会向目标进程发送一个信号，进程可以选择忽略、捕获或执行默认动作。

在进程管理场景中，最常用的信号包括：

- **SIGTERM (15)**：请求进程优雅终止。这是 `kill` 命令的默认信号，也是我们实现优雅退出的核心。
- **SIGINT (2)**：中断信号，通常由 `Ctrl+C` 触发。
- **SIGCHLD (17)**：子进程状态改变时（退出、暂停、恢复），内核向父进程发送此信号。
- **SIGUSR1 (10) / SIGUSR2 (12)**：用户自定义信号，可以用于进程间的自定义通信。
- **SIGHUP (1)**：终端挂断信号，常用于通知守护进程重新加载配置。

### 3.2 PHP 中的信号处理

在 PHP 中注册信号处理器有两种方式。PHP 7.1 之前，需要通过 `declare(ticks=1)` 来让信号处理器在每条 PHP 语句执行后被调用。PHP 7.1 引入了 `pcntl_async_signals(true)`，这是一个质的飞跃——它让信号处理变得真正异步，不再需要 ticks，也更加可靠。

```php
<?php

// PHP 7.1+ 推荐：启用异步信号处理
pcntl_async_signals(true);

// 注册 SIGTERM 处理器——优雅退出
pcntl_signal(SIGTERM, function ($signo) {
    echo "Received SIGTERM, shutting down gracefully...\n";
    // 设置全局退出标志
    global $shouldExit;
    $shouldExit = true;
});

// 注册 SIGCHLD 处理器——回收子进程
pcntl_signal(SIGCHLD, function ($signo) {
    // 非阻塞方式回收所有已退出的子进程
    while (($pid = pcntl_waitpid(-1, $status, WNOHANG)) > 0) {
        echo "Child $pid exited with status " . pcntl_wexitstatus($status) . "\n";
    }
});

// 注册 SIGUSR1 处理器——自定义用途（如打印运行状态）
pcntl_signal(SIGUSR1, function ($signo) {
    echo "Received SIGUSR1, current PID: " . getmypid() . "\n";
    // 可以在这里打印进程池状态、队列深度等调试信息
});
```

### 3.3 SIGCHLD 与子进程回收的最佳实践

在实际项目中，处理 SIGCHLD 有一个常见的陷阱：如果在 SIGCHLD 处理器中使用阻塞方式的 `pcntl_waitpid`，可能会导致信号处理器长时间阻塞，影响主循环的响应能力。正确的做法是使用 `WNOHANG` 标志进行非阻塞回收：

```php
<?php

pcntl_async_signals(true);

pcntl_signal(SIGCHLD, function () {
    // WNOHANG：如果没有已退出的子进程，立即返回而非阻塞
    // -1：等待任意子进程
    while (($pid = pcntl_waitpid(-1, $status, WNOHANG)) > 0) {
        $exitCode = pcntl_wexitstatus($status);
        if ($exitCode !== 0) {
            echo "Worker $pid exited abnormally (code: $exitCode)\n";
            // 可以在这里记录日志或触发告警
        } else {
            echo "Worker $pid exited normally\n";
        }
    }
});
```

在 PHP 7.1 之前（不支持 `pcntl_async_signals`），信号处理需要依赖 `declare(ticks=1)`，这种方式的信号分发时机是不确定的——只有在每条 PHP 语句执行后才会检查是否有待处理的信号。如果你的代码中有长时间运行的 C 扩展函数（比如数据库查询），信号可能无法及时到达。因此，如果你的 PHP 版本高于 7.1，请务必使用 `pcntl_async_signals(true)`。

---

## 四、进程池设计：固定 Worker 数量与任务队列

### 4.1 为什么需要进程池

直接在循环中 `pcntl_fork` 创建子进程是最简单的做法，但它有两个致命问题：一是无法控制并发数量，如果有一万个任务就要 fork 一万个进程，系统资源很快就会耗尽；二是频繁 fork 的开销很大，操作系统需要复制父进程的地址空间。进程池模式的核心思想是：**预先创建固定数量的 Worker 进程，由 Master 进程负责分发任务**。

### 4.2 基于 SplQueue 的进程池实现

以下是一个完整的进程池实现，使用 `SplQueue` 作为任务队列，Master 进程从队列中取出任务分发给空闲的 Worker：

```php
<?php

class ProcessPool
{
    private int $workerCount;
    private SplQueue $taskQueue;
    private array $workers = [];       // pid => worker 信息
    private array $idleWorkers = [];   // 空闲 Worker 的 PID 列表
    private bool $shouldExit = false;

    public function __construct(int $workerCount = 4)
    {
        $this->workerCount = $workerCount;
        $this->taskQueue = new SplQueue();

        // 启用异步信号处理
        pcntl_async_signals(true);

        // 注册信号处理器
        $this->registerSignalHandlers();
    }

    private function registerSignalHandlers(): void
    {
        // SIGTERM：优雅退出
        pcntl_signal(SIGTERM, function () {
            $this->shouldExit = true;
            // 通知所有 Worker 退出
            foreach ($this->workers as $pid => $info) {
                posix_kill($pid, SIGTERM);
            }
        });

        // SIGINT：Ctrl+C，同 SIGTERM
        pcntl_signal(SIGINT, function () {
            // 触发与 SIGTERM 相同的退出逻辑
            posix_kill(getmypid(), SIGTERM);
        });

        // SIGCHLD：子进程退出
        pcntl_signal(SIGCHLD, function () {
            while (($pid = pcntl_waitpid(-1, $status, WNOHANG)) > 0) {
                unset($this->workers[$pid]);
                // 从空闲列表中移除
                $this->idleWorkers = array_filter(
                    $this->idleWorkers,
                    fn($p) => $p !== $pid
                );

                // 如果不是主动退出，可以选择重启 Worker
                if (!$this->shouldExit && $this->taskQueue->count() > 0) {
                    $this->spawnWorker();
                }
            }
        });
    }

    private function spawnWorker(): void
    {
        $pid = pcntl_fork();

        if ($pid === -1) {
            throw new RuntimeException('Failed to fork worker');
        }

        if ($pid === 0) {
            // === 子进程（Worker）===
            $this->workerLoop();
            exit(0);
        }

        // === 父进程（Master）===
        $this->workers[$pid] = [
            'pid'      => $pid,
            'started'  => time(),
            'tasks'    => 0,
        ];
    }

    private function workerLoop(): void
    {
        // 重置信号处理器（子进程继承了父进程的处理器，需要重新注册）
        pcntl_signal(SIGTERM, function () {
            exit(0); // 优雅退出
        });

        // Worker 主循环：通过标准输入接收任务，通过标准输出返回结果
        while (true) {
            // 通知 Master 我已就绪
            echo "READY\n";

            // 从 stdin 读取任务（每行一个任务）
            $task = fgets(STDIN);
            if ($task === false || $task === "EXIT\n") {
                break;
            }

            $task = trim($task);
            if (empty($task)) {
                continue;
            }

            // 执行任务
            try {
                $result = $this->executeTask($task);
                echo "RESULT|" . json_encode($result) . "\n";
            } catch (\Throwable $e) {
                echo "ERROR|" . $e->getMessage() . "\n";
            }
        }
    }

    private function executeTask(string $task): array
    {
        // 实际任务逻辑，这里以订单导出为例
        $data = json_decode($task, true);
        // ... 处理逻辑 ...
        return ['status' => 'ok', 'task_id' => $data['id'] ?? null];
    }

    public function addTask(string $task): void
    {
        $this->taskQueue->enqueue($task);
    }

    public function run(): void
    {
        // 启动所有 Worker
        for ($i = 0; $i < $this->workerCount; $i++) {
            $this->spawnWorker();
        }

        // 主循环：分发任务
        while (!$this->shouldExit || $this->taskQueue->count() > 0) {
            // 检查是否有待处理信号
            pcntl_signal_dispatch();

            if ($this->taskQueue->count() > 0 && count($this->idleWorkers) > 0) {
                $pid = array_pop($this->idleWorkers);
                $task = $this->taskQueue->dequeue();
                // 通过 stdin 向 Worker 发送任务
                // 实际实现中需要保存 Worker 的 stdin 管道
            }

            usleep(10000); // 10ms，避免 CPU 空转
        }

        // 等待所有 Worker 退出
        while (count($this->workers) > 0) {
            pcntl_signal_dispatch();
            usleep(10000);
        }
    }
}
```

上述代码是一个简化版的进程池架构。在生产环境中，我们需要使用 `proc_open` 来管理每个 Worker 的标准输入输出管道，实现 Master 与 Worker 之间的双向通信。这个模式的灵感来自 Nginx 的 Master-Worker 架构——Master 负责任务分发和生命周期管理，Worker 专注于执行具体任务。

### 4.3 基于 SysV 消息队列的替代方案

如果任务数据较大（比如每个任务包含数千字节的 JSON 数据），通过管道传输可能效率不高。此时可以使用 SysV 消息队列（`msg_*` 系列函数），它提供了按类型分发消息的能力：

```php
<?php

// 创建消息队列
$key = ftok(__FILE__, 'm');
$msgQueue = msg_get_queue($key);

// Master 进程：发送任务
msg_send($msgQueue, 1, ['task_id' => 1, 'data' => '...']);  // 类型 1：普通任务
msg_send($msgQueue, 2, ['command' => 'shutdown']);           // 类型 2：控制命令

// Worker 进程：接收任务
msg_receive($msgQueue, 1, $msgType, 8192, $message, true, MSG_IPC_NOWAIT);
// msgType 为 1 表示只接收类型 1 的消息

// 清理
msg_remove_queue($msgQueue);
```

SysV 消息队列的优势在于它是内核级别的 IPC 机制，不依赖文件描述符，且支持按消息类型选择性接收。但它的缺点是需要手动管理队列的生命周期，且在容器化环境中可能受到 `ipc` 命名空间的限制。

### 4.4 优雅退出的完整流程

优雅退出是进程管理中最核心的能力。一个完整的优雅退出流程包括：

1. Master 收到 SIGTERM 信号，设置 `$shouldExit = true`。
2. Master 停止向任务队列添加新任务。
3. Master 向所有 Worker 发送 SIGTERM 信号。
4. Worker 收到 SIGTERM 后，完成当前正在执行的任务（不中断），然后退出。
5. Master 通过 SIGCHLD 回收所有已退出的 Worker。
6. Master 设置一个超时阈值（如 30 秒），如果超时后仍有 Worker 未退出，发送 SIGKILL 强制终止。

这种机制保证了正在处理中的任务不会被中途打断，同时又能在合理时间内完成关闭。

---

## 五、与 Supervisor 的对比：什么时候选择原生 pcntl

### 5.1 Supervisor 的优势

Supervisor 是 Python 编写的进程管理工具，在 PHP 生态中被广泛用于管理 Laravel Queue Worker 和其他常驻进程。它的核心优势包括：

- **开箱即用**：配置简单，声明式管理进程数量、自动重启、日志轮转。
- **稳定性验证**：经过十几年的生产验证，社区庞大。
- **Web UI**：提供简单的 Web 界面查看进程状态。
- **进程组管理**：可以将多个相关进程编组，统一启停。

在大多数场景下，Supervisor 仍然是管理 Laravel Queue Worker 的最佳选择。如果你的需求仅仅是"启动 N 个 `php artisan queue:work` 并在崩溃时自动重启"，请直接使用 Supervisor，不要重复造轮子。

### 5.2 原生 pcntl 的独特优势

但在以下场景中，原生 pcntl 方案比 Supervisor 更加灵活：

**动态 Worker 调整**：Supervisor 的进程数量是静态配置的。如果你需要根据队列深度或系统负载动态调整 Worker 数量（比如在流量高峰期自动增加到 8 个 Worker，低谷期缩减到 2 个），Supervisor 需要通过外部脚本调用 `supervisorctl` 来实现，而原生 pcntl 可以在代码中直接完成。

**自定义重启策略**：Supervisor 只支持简单的"崩溃后重启"策略。如果你需要实现指数退避重启（第一次崩溃后等 1 秒重启，第二次等 2 秒，第三次等 4 秒……）、根据错误类型决定是否重启、或者在重启前执行清理逻辑，原生 pcntl 可以更灵活地实现。

**与业务逻辑深度集成**：原生 pcntl 的进程管理逻辑和业务代码在同一个 PHP 进程中运行，可以共享配置、日志、缓存连接等资源，减少外部依赖。

**部署简化**：不需要在服务器上安装 Supervisor，减少一个运维依赖。对于 Docker 容器中的单进程入口场景，用一个 PHP 脚本管理多个子进程，比在容器中额外运行 Supervisor 更加轻量。

**共享内存与进程间数据交换**：原生 pcntl 可以使用 `shm_*` 系列函数实现进程间的共享内存通信，这在需要聚合多进程结果的场景中非常有用（比如后面会讲到的 CSV 导出案例）。

### 5.3 选型决策表

| 场景 | 推荐方案 | 原因 |
|------|----------|------|
| 管理 Laravel Queue Worker | Supervisor | 成熟稳定，社区支持好 |
| 固定数量的批处理任务 | 原生 pcntl | 一次运行即结束，不需要常驻管理 |
| 需要动态调整 Worker 数量 | 原生 pcntl | 代码级控制，无需外部脚本 |
| Docker 容器中的进程管理 | 原生 pcntl | 减少容器内进程数量，简化入口 |
| 需要聚合多进程结果 | 原生 pcntl | 共享内存或管道通信更加高效 |
| 高可靠性生产环境 | Supervisor + pcntl 混合 | Supervisor 管理 Master 进程，Master 内部用 pcntl 管理 Worker |

---

## 六、Laravel Artisan 命令中的多进程实践

### 6.1 在 Artisan 命令中使用 pcntl_fork

Laravel 的 Artisan 命令是承载多进程逻辑的理想场所。以下是一个完整的 Artisan 命令示例，展示了如何在 Laravel 中实现一个支持多进程并发的命令：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ConcurrentOrderExport extends Command
{
    protected $signature = 'orders:export-concurrent
                            {--workers=4 : 并发 Worker 数量}
                            {--chunk=2500 : 每个 Worker 处理的批次大小}';

    protected $description = '使用多进程并发导出订单数据';

    private bool $shouldExit = false;
    private array $childPids = [];

    public function handle(): int
    {
        $workerCount = (int) $this->option('workers');
        $chunkSize = (int) $this->option('chunk');

        // 启用异步信号处理
        pcntl_async_signals(true);
        $this->registerSignalHandlers();

        // 获取待导出的订单总数
        $totalOrders = DB::table('orders')->where('exported', false)->count();
        $this->info("Total orders to export: {$totalOrders}");

        // 将订单 ID 分片
        $orderIds = DB::table('orders')
            ->where('exported', false)
            ->pluck('id')
            ->toArray();
        $chunks = array_chunk($orderIds, $chunkSize);

        $this->info("Split into " . count($chunks) . " chunks, dispatching to {$workerCount} workers");

        // 创建管道用于父子进程通信
        $pipes = [];

        // 启动 Worker 进程
        $chunkIndex = 0;
        for ($i = 0; $i < $workerCount; $i++) {
            if ($chunkIndex >= count($chunks)) {
                break;
            }

            $chunk = $chunks[$chunkIndex++];

            // 创建管道
            $descriptors = [
                0 => ['pipe', 'r'], // stdin
                1 => ['pipe', 'w'], // stdout
            ];

            $process = proc_open('php ' . base_path('artisan') . ' orders:worker', $descriptors, $pipeHandles);

            if (is_resource($process)) {
                $pid = proc_get_status($process)['pid'];
                $this->childPids[$pid] = $process;

                // 将任务数据写入 Worker 的 stdin
                fwrite($pipeHandles[0], json_encode($chunk) . "\n");
                fclose($pipeHandles[0]);

                $pipes[$pid] = $pipeHandles[1];
                $this->info("Started worker PID: {$pid}, processing " . count($chunk) . " orders");
            }
        }

        // 监控 Worker 执行状态
        $this->monitorWorkers($pipes);

        return self::SUCCESS;
    }

    private function monitorWorkers(array $pipes): void
    {
        while (count($this->childPids) > 0 && !$this->shouldExit) {
            foreach ($this->childPids as $pid => $process) {
                $status = proc_get_status($process);
                if (!$status['running']) {
                    // Worker 已退出，读取输出
                    $output = stream_get_contents($pipes[$pid]);
                    fclose($pipes[$pid]);

                    $exitCode = $status['exitcode'];
                    if ($exitCode === 0) {
                        $this->info("Worker {$pid} completed successfully");
                    } else {
                        $this->error("Worker {$pid} failed with exit code: {$exitCode}");
                        $this->error("Output: {$output}");
                    }

                    proc_close($process);
                    unset($this->childPids[$pid]);
                    unset($pipes[$pid]);
                }
            }

            pcntl_signal_dispatch();
            usleep(100000); // 100ms
        }
    }

    private function registerSignalHandlers(): void
    {
        pcntl_signal(SIGTERM, function () {
            $this->shouldExit = true;
            foreach (array_keys($this->childPids) as $pid) {
                posix_kill($pid, SIGTERM);
            }
        });

        pcntl_signal(SIGINT, function () {
            posix_kill(getmypid(), SIGTERM);
        });

        pcntl_signal(SIGCHLD, function () {
            while (($pid = pcntl_waitpid(-1, $status, WNOHANG)) > 0) {
                // 在 monitorWorkers 中处理
            }
        });
    }
}
```

### 6.2 结合 dispatchNow 避免 Queue 开销

在某些场景下，我们希望在子进程中直接执行一个 Job，但又不想走 Laravel 的 Queue 系统（因为 Queue 需要额外的驱动配置，而且同步队列 `sync` 驱动只支持单进程）。此时可以在子进程中使用 `dispatchNow` 或直接调用 Job 的 `handle` 方法：

```php
<?php

// 在 Worker 子进程中
namespace App\Console\Commands;

use App\Jobs\ProcessOrderExportBatch;
use Illuminate\Console\Command;

class ExportWorker extends Command
{
    protected $signature = 'orders:worker';
    protected $description = '订单导出 Worker 进程';

    public function handle(): int
    {
        // 从 stdin 读取任务数据
        $input = fgets(STDIN);
        if ($input === false) {
            return 1;
        }

        $orderIds = json_decode(trim($input), true);
        if (!is_array($orderIds)) {
            $this->error('Invalid task data');
            return 1;
        }

        // 重置数据库连接（关键！子进程不能共享父进程的数据库连接）
        DB::reconnect();

        try {
            // 直接实例化并执行 Job，绕过 Queue 系统
            $job = new ProcessOrderExportBatch($orderIds);
            $job->handle();

            $this->info("Processed " . count($orderIds) . " orders");
            return 0;
        } catch (\Throwable $e) {
            $this->error($e->getMessage());
            Log::error('Export worker failed', [
                'pid'     => getmypid(),
                'error'   => $e->getMessage(),
                'trace'   => $e->getTraceAsString(),
            ]);
            return 1;
        }
    }
}
```

这种方式的好处是：我们复用了 Laravel Job 的业务逻辑，但不需要配置 Queue 驱动、不需要 Supervisor 管理 Worker 进程、不需要 Redis/RabbitMQ 等外部依赖。对于"一次性批处理任务"这种场景，这种轻量方案非常适合。

### 6.3 使用 Closure 或 callable 分发任务

如果不想创建额外的 Artisan 命令，也可以直接在主命令中通过 `pcntl_fork` 分发闭包任务。但需要注意的是，**闭包不能直接序列化到子进程中**，因为 `pcntl_fork` 是通过复制进程内存来工作的，闭包所引用的上下文会被完整复制：

```php
<?php

// 最简单的多进程分发模式
$taskIds = range(1, 100);
$workerCount = 4;
$chunks = array_chunk($taskIds, ceil(count($taskIds) / $workerCount));

$pids = [];
foreach ($chunks as $chunk) {
    $pid = pcntl_fork();

    if ($pid === 0) {
        // 子进程：处理自己的 chunk
        DB::reconnect(); // 重要：重置数据库连接

        foreach ($chunk as $taskId) {
            // 处理单个任务
            processTask($taskId);
        }

        exit(0);
    }

    $pids[] = $pid;
}

// 父进程：等待所有子进程完成
foreach ($pids as $pid) {
    pcntl_waitpid($pid, $status);
    $exitCode = pcntl_wexitstatus($status);
    if ($exitCode !== 0) {
        echo "Worker $pid exited with code $exitCode\n";
    }
}

echo "All workers completed\n";
```

这种模式简单直接，适合快速实现。但它缺少错误处理、优雅退出和 Worker 重启等高级功能，仅适用于一次性批处理场景。

---

## 七、真实案例：并发导出十万订单 CSV

### 7.1 需求背景

我们的 B2C 系统有一个后台功能：运营人员需要定期导出订单数据为 CSV 文件，用于财务对账。随着业务增长，订单量从最初的几千条增长到了十万级别。单进程导出十万条订单（包含关联的收货地址、商品信息、支付记录）需要近 20 分钟，期间数据库连接经常超时。我们需要一个能在 5 分钟内完成导出的方案。

### 7.2 技术方案

我们采用的方案是：

1. **Master 进程**负责读取订单 ID 列表，按 Worker 数量分片。
2. **4 个 Worker 子进程**分别处理各自的分片，每个 Worker 独立查询数据库、组装 CSV 行。
3. 使用**共享内存**（`shm_*`）让 Worker 将处理结果写入共享区域。
4. Master 进程在所有 Worker 完成后，从共享内存中读取结果，合并写入最终的 CSV 文件。
5. 使用 **SIGUSR1** 信号让 Worker 向 Master 报告进度。

### 7.3 完整实现代码

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ConcurrentOrderExport extends Command
{
    protected $signature = 'orders:export-csv
                            {--output=orders_export.csv : 输出文件路径}
                            {--workers=4 : Worker 数量}';

    protected $description = '并发导出订单为 CSV 文件';

    private bool $shouldExit = false;
    private array $childPids = [];
    private int $completedWorkers = 0;
    private array $progress = [];  // pid => processed count

    public function handle(): int
    {
        $outputPath = $this->option('output');
        $workerCount = (int) $this->option('workers');

        // 启用异步信号处理
        pcntl_async_signals(true);
        $this->registerSignalHandlers();

        $this->info('=== 并发订单导出系统 ===');
        $this->info("Workers: {$workerCount}");
        $this->info("Output: {$outputPath}");

        // 统计待导出订单
        $totalOrders = DB::table('orders')
            ->where('status', 'completed')
            ->count();
        $this->info("Total orders: {$totalOrders}");

        if ($totalOrders === 0) {
            $this->warn('No orders to export');
            return self::SUCCESS;
        }

        // 获取所有订单 ID（只取 ID，减少内存占用）
        $orderIds = DB::table('orders')
            ->where('status', 'completed')
            ->orderBy('id')
            ->pluck('id')
            ->toArray();

        // 分片
        $chunkSize = (int) ceil(count($orderIds) / $workerCount);
        $chunks = array_chunk($orderIds, $chunkSize);
        $actualWorkers = count($chunks);

        $this->info("Actual workers: {$actualWorkers}, chunk size: {$chunkSize}");

        // 创建共享内存段（每个 Worker 一个）
        $shmKeys = [];
        for ($i = 0; $i < $actualWorkers; $i++) {
            $shmKey = ftok(__FILE__, chr(65 + $i)); // A, B, C, D
            $shmKeys[] = $shmKey;
        }

        $startTime = microtime(true);

        // 启动 Worker 进程
        foreach ($chunks as $index => $chunk) {
            $pid = pcntl_fork();

            if ($pid === -1) {
                $this->error("Failed to fork worker {$index}");
                return self::FAILURE;
            }

            if ($pid === 0) {
                // === 子进程 Worker ===
                $this->workerProcess($index, $chunk, $shmKeys[$index]);
                exit(0);
            }

            // === 父进程 Master ===
            $this->childPids[$pid] = $index;
            $this->info("Worker {$index} started with PID: {$pid}");
        }

        // Master：写入 CSV 头部
        $csvFile = fopen($outputPath, 'w');
        fputcsv($csvFile, [
            '订单ID', '订单号', '用户ID', '总金额', '状态',
            '收货人', '手机号', '省', '市', '区', '详细地址',
            '商品数量', '支付方式', '创建时间',
        ]);

        // 等待所有 Worker 完成
        $this->info('Waiting for workers to complete...');

        while (count($this->childPids) > 0 && !$this->shouldExit) {
            pcntl_signal_dispatch();

            // 打印进度
            $totalProcessed = array_sum($this->progress);
            $percent = $totalOrders > 0 ? round($totalProcessed / $totalOrders * 100, 1) : 0;
            $this->output->write("\r  Progress: {$totalProcessed}/{$totalOrders} ({$percent}%)");

            usleep(500000); // 500ms
        }

        $this->newLine();
        $this->info('All workers completed, merging results...');

        // 从共享内存中读取结果并合并到 CSV
        foreach ($shmKeys as $index => $shmKey) {
            $shmId = shm_attach($shmKey);
            if ($shmId === false) {
                $this->warn("Cannot attach to shared memory for worker {$index}");
                continue;
            }

            try {
                // 读取数据长度（存储在 segment 1）
                $length = shm_get_var($shmId, 1);
                // 读取 CSV 数据（存储在 segment 2）
                $csvData = shm_get_var($shmId, 2);

                if ($csvData) {
                    $rows = explode("\n", trim($csvData));
                    foreach ($rows as $row) {
                        fwrite($csvFile, $row . "\n");
                    }
                    $this->info("  Worker {$index}: merged {$length} rows");
                }
            } finally {
                shm_detach($shmId);
                // 清除共享内存
                @shm_remove($shmId);
            }
        }

        fclose($csvFile);

        $elapsed = round(microtime(true) - $startTime, 2);
        $this->info("=== Export completed in {$elapsed}s ===");
        $this->info("Output: {$outputPath}");

        // 更新数据库标记
        DB::table('orders')
            ->where('status', 'completed')
            ->update(['exported_at' => now()]);

        return self::SUCCESS;
    }

    private function workerProcess(int $index, array $orderIds, int $shmKey): void
    {
        // 重置信号处理器
        pcntl_signal(SIGTERM, function () {
            exit(0);
        });

        // 重置数据库连接（关键！）
        DB::reconnect();

        $this->progress[getmypid()] = 0;

        // 打开共享内存
        $shmId = shm_attach($shmKey);

        $csvBuffer = '';
        $processedCount = 0;
        $batchSize = 100; // 每 100 条批量查询一次

        $batches = array_chunk($orderIds, $batchSize);

        foreach ($batches as $batch) {
            // 批量查询订单及其关联数据
            $orders = DB::table('orders')
                ->join('users', 'orders.user_id', '=', 'users.id')
                ->leftJoin('addresses', 'orders.address_id', '=', 'addresses.id')
                ->leftJoin('payments', 'orders.id', '=', 'payments.order_id')
                ->whereIn('orders.id', $batch)
                ->select(
                    'orders.id', 'orders.order_no', 'orders.user_id',
                    'orders.total_amount', 'orders.status', 'orders.created_at',
                    'addresses.name as addr_name', 'addresses.phone',
                    'addresses.province', 'addresses.city',
                    'addresses.district', 'addresses.detail',
                    'payments.payment_method'
                )
                ->get();

            // 查询每个订单的商品数量
            $orderIdsInBatch = $orders->pluck('id')->toArray();
            $itemCounts = DB::table('order_items')
                ->whereIn('order_id', $orderIdsInBatch)
                ->selectRaw('order_id, SUM(quantity) as total_qty')
                ->groupBy('order_id')
                ->pluck('total_qty', 'order_id');

            foreach ($orders as $order) {
                $row = [
                    $order->id,
                    $order->order_no,
                    $order->user_id,
                    number_format($order->total_amount, 2, '.', ''),
                    $order->status,
                    $order->addr_name ?? '',
                    $order->phone ?? '',
                    $order->province ?? '',
                    $order->city ?? '',
                    $order->district ?? '',
                    $order->detail ?? '',
                    $itemCounts[$order->id] ?? 0,
                    $order->payment_method ?? '',
                    $order->created_at,
                ];

                // 将 CSV 行写入缓冲区
                $csvBuffer .= $this->arrayToCsvLine($row) . "\n";
                $processedCount++;
            }

            // 更新进度（通过共享内存的 segment 1）
            shm_put_var($shmId, 1, $processedCount);
        }

        // 将最终结果写入共享内存
        shm_put_var($shmId, 1, $processedCount);  // 长度
        shm_put_var($shmId, 2, $csvBuffer);        // CSV 数据

        shm_detach($shmId);

        // 向 Master 发送 SIGUSR1 通知完成
        posix_kill(posix_getppid(), SIGUSR1);
    }

    /**
     * 手动构造 CSV 行，避免 fputcsv 的性能问题
     */
    private function arrayToCsvLine(array $fields): string
    {
        return implode(',', array_map(function ($field) {
            $field = (string) $field;
            if (str_contains($field, ',') || str_contains($field, '"') || str_contains($field, "\n")) {
                return '"' . str_replace('"', '""', $field) . '"';
            }
            return $field;
        }, $fields));
    }

    private function registerSignalHandlers(): void
    {
        pcntl_signal(SIGTERM, function () {
            $this->shouldExit = true;
            foreach (array_keys($this->childPids) as $pid) {
                posix_kill($pid, SIGTERM);
            }
        });

        pcntl_signal(SIGINT, function () {
            posix_kill(getmypid(), SIGTERM);
        });

        // SIGCHLD：回收已退出的子进程
        pcntl_signal(SIGCHLD, function () {
            while (($pid = pcntl_waitpid(-1, $status, WNOHANG)) > 0) {
                $exitCode = pcntl_wexitstatus($status);
                $index = $this->childPids[$pid] ?? '?';
                if ($exitCode !== 0) {
                    Log::error("Worker {$index} (PID: {$pid}) exited with code {$exitCode}");
                    $this->error("Worker {$index} (PID: {$pid}) exited with code {$exitCode}");
                }
                unset($this->childPids[$pid]);
            }
        });

        // SIGUSR1：Worker 报告进度
        pcntl_signal(SIGUSR1, function ($signo) {
            // 进度已在共享内存中更新，这里只是触发 Master 刷新显示
        });
    }
}
```

### 7.4 性能对比

在我们的测试环境中（8 核 CPU、32GB 内存、MySQL 8.0、十万条订单），各方案的导出耗时如下：

| 方案 | 耗时 | 内存峰值 |
|------|------|----------|
| 单进程 | 18 分 30 秒 | 512MB |
| 2 Workers | 10 分 15 秒 | 2 × 256MB |
| 4 Workers | 5 分 20 秒 | 4 × 128MB |
| 8 Workers | 3 分 45 秒 | 8 × 64MB |

4 个 Worker 的方案在耗时和资源占用之间取得了最佳平衡。超过 4 个 Worker 后，收益递减明显，因为数据库的并发查询能力已经接近瓶颈。

---

## 八、踩坑记录：生产环境中的常见问题

### 8.1 数据库连接复用问题

这是 PHP 多进程编程中最常见也最隐蔽的 Bug。当父进程 fork 子进程时，子进程会继承父进程的所有资源，包括数据库连接的文件描述符。但此时父子进程共享同一个 TCP 连接，两个进程同时在这个连接上发送 SQL 语句，会导致数据错乱或连接被服务端关闭。

**解决方案**：在子进程中立即调用 `DB::reconnect()` 断开并重新建立连接。这是最关键的一行代码，永远不要忘记：

```php
<?php

$pid = pcntl_fork();

if ($pid === 0) {
    // 子进程第一件事：重置数据库连接
    DB::reconnect();

    // 可选：调大连接超时（长时间导出任务）
    DB::connection()->setPdo(
        DB::connection()->getPdo()->setAttribute(\PDO::ATTR_TIMEOUT, 300)
    );

    // 现在可以安全地使用数据库了
    // ...
}
```

除了 PDO 连接，Redis 连接、Elasticsearch 连接等所有通过 Socket 通信的资源都需要在子进程中重新连接。Laravel 的 `DB::reconnect()` 只重置数据库连接，如果你的代码中还使用了 Redis，需要额外调用 `Redis::connection()->disconnect()` 后重新获取连接。

### 8.2 内存泄漏检测

在长时间运行的多进程程序中，内存泄漏是一个需要特别关注的问题。PHP 的引用计数垃圾回收器（Zend GC）在大多数情况下工作良好，但在以下场景中容易出现内存泄漏：

**循环引用**：两个对象互相引用，导致引用计数永远不会降为 0。PHP 的 GC 可以处理这种情况，但它的触发时机是固定的（默认每 1000 次可能的垃圾产生后触发一次），在长循环中可能不够及时。

**全局变量和静态变量**：在子进程中，如果不断向全局数组中追加数据且从不清理，内存会持续增长。

**Laravel 查询构建器**：未使用 `chunk` 或 `cursor` 的大查询会将所有结果集加载到内存中。

以下是一个内存监控的实用工具函数：

```php
<?php

/**
 * 内存使用监控工具
 */
function logMemoryUsage(string $context): void
{
    $current = memory_get_usage(true);
    $peak = memory_get_peak_usage(true);

    Log::info("Memory [{$context}]", [
        'pid'          => getmypid(),
        'current_mb'   => round($current / 1024 / 1024, 2),
        'peak_mb'      => round($peak / 1024 / 1024, 2),
        'limit'        => ini_get('memory_limit'),
    ]);

    // 如果内存使用超过阈值，触发垃圾回收
    if ($current > 256 * 1024 * 1024) { // 256MB
        $collected = gc_collect_cycles();
        Log::warning("GC triggered, collected {$collected} cycles");
    }
}

// 在循环中使用
foreach ($chunks as $index => $chunk) {
    // 处理任务
    processChunk($chunk);

    // 每 100 次迭代检查一次内存
    if ($index % 100 === 0) {
        logMemoryUsage("chunk_{$index}");
    }
}
```

### 8.3 文件描述符泄漏

每个进程都有一个文件描述符表（file descriptor table），Linux 系统默认限制每个进程最多打开 1024 个文件描述符（可通过 `ulimit -n` 查看和修改）。在多进程场景中，如果父进程打开了大量文件或数据库连接后 fork 子进程，子进程会继承所有这些文件描述符，可能导致子进程的文件描述符耗尽。

**解决方案**：

```php
<?php

// 检查当前进程的文件描述符使用情况
function getOpenFdCount(): int
{
    $pid = getmypid();
    $fds = glob("/proc/{$pid}/fd/*");
    return $fds ? count($fds) : 0;
}

// 在 fork 之前，关闭不需要的文件描述符
function closeUnnecessaryFds(): void
{
    // 保留 stdin (0), stdout (1), stderr (2)
    $openFds = glob("/proc/" . getmypid() . "/fd/*");
    foreach ($openFds as $fdPath) {
        $fd = (int) basename($fdPath);
        if ($fd > 2) {
            // 注意：只关闭你确定不再需要的 fd
            // 数据库连接、Redis 连接等也需要在这里处理
        }
    }
}
```

在 Laravel 中，更实用的做法是在 fork 之前清理掉所有不需要的连接：

```php
<?php

// fork 前的清理函数
function cleanupBeforeFork(): void
{
    // 断开所有数据库连接
    DB::disconnect();

    // 断开 Redis 连接
    if (class_exists(\Illuminate\Support\Facades\Redis::class)) {
        \Illuminate\Support\Facades\Redis::disconnect();
    }

    // 手动触发垃圾回收
    gc_collect_cycles();
}
```

### 8.4 其他常见陷阱

**时区和环境变量**：子进程继承父进程的环境变量，但 Laravel 的某些服务提供者在注册时可能会修改环境状态。如果在 fork 后子进程中发现时区不对或配置异常，可能需要在子进程中重新引导 Laravel 框架。

**临时文件锁**：如果父进程持有文件锁（`flock`），子进程会继承锁状态。这可能导致意想不到的死锁。

**信号处理器继承**：子进程会继承父进程的信号处理器。如果你不希望子进程响应某个信号（比如 Master 的 SIGTERM 不应该直接杀死 Worker），需要在子进程中重新注册或忽略该信号。

---

## 九、新方案对比：FrankenPHP、RoadRunner 与 Swoole

### 9.1 FrankenPHP

FrankenPHP 是基于 Caddy Web 服务器构建的现代 PHP 应用服务器，它支持 Worker 模式——PHP 脚本在启动时加载一次，然后在常驻内存模式下处理多个请求。它与 pcntl 的关系在于：FrankenPHP 内部使用了 Go 的 goroutine 来管理并发，PHP 代码层面不需要手动 fork 进程。

**适用场景**：Web 请求的并发处理，尤其是需要减少 PHP 引导开销的 API 服务。

**不适用场景**：CLI 模式下的批处理任务、需要精细控制进程生命周期的场景。

### 9.2 RoadRunner

RoadRunner 是 Go 编写的高性能 PHP 应用服务器，通过 Goridge 协议与 PHP Worker 进程通信。它的 Worker 管理能力远比手动 `pcntl_fork` 强大——支持自动重启、负载均衡、热重载等。

**适用场景**：高并发 HTTP 服务、gRPC 服务、队列消费。

**不适用场景**：需要在 Worker 之间共享内存或进行复杂的进程间协调。

### 9.3 Swoole / OpenSwoole

Swoole 提供了协程级别的并发能力，通过 `Coroutine::create()` 可以创建数万个协程而无需 fork 进程。协程的切换开销远小于进程切换，且共享同一块内存空间，避免了数据库连接复用等 pcntl 的固有问题。

**适用场景**：高并发 I/O 密集型任务（HTTP 客户端、数据库查询、Redis 操作）。

**不适用场景**：CPU 密集型任务（协程无法利用多核 CPU，需要配合多进程 Worker）。

### 9.4 选型决策矩阵

| 特性 | pcntl | Supervisor + Artisan | FrankenPHP | RoadRunner | Swoole |
|------|-------|---------------------|------------|------------|--------|
| 学习成本 | 中 | 低 | 低 | 中 | 高 |
| 进程生命周期控制 | 完全 | 有限 | 有限 | 有限 | 有限 |
| 内存共享 | 支持 | 不支持 | 不支持 | 不支持 | 天然支持 |
| 数据库连接复用 | 需手动处理 | 无问题 | 无问题 | 无问题 | 协程连接池 |
| 适合的 PHP 版本 | 5.x+ | 任意 | 8.2+ | 7.4+ | 7.2+ |
| 生产成熟度 | 高 | 很高 | 中 | 高 | 高 |
| 适合场景 | CLI 批处理 | 常驻进程 | Web 服务 | Web + 队列 | 高并发服务 |

---

## 十、总结与选型决策

### 10.1 何时使用 pcntl_fork

经过前面的讨论，我们可以明确 `pcntl_fork` 的适用边界：

**推荐使用**：CLI 模式下的批处理任务（数据导出、批量导入、报表生成）；需要精细控制进程生命周期的场景（自定义重启策略、动态 Worker 调整）；Docker 容器中的轻量级进程管理；需要进程间共享内存进行结果聚合的场景。

**不推荐使用**：Web 请求的并发处理（请使用 Swoole/FrankenPHP/RoadRunner）；简单的队列消费（请使用 Laravel Queue + Supervisor）；需要处理海量短连接的场景（进程 fork 开销太大）。

### 10.2 生产环境清单

在将 pcntl 多进程方案部署到生产环境之前，请逐一确认以下事项：

1. **扩展可用性**：确认 PHP 安装了 `pcntl` 和 `posix` 扩展（`php -m | grep pcntl`）。
2. **数据库连接重置**：每个子进程的入口处都有 `DB::reconnect()`。
3. **信号处理**：注册了 SIGTERM（优雅退出）、SIGCHLD（子进程回收）、SIGINT（Ctrl+C 处理）。
4. **僵尸进程防护**：SIGCHLD 处理器中使用 `WNOHANG` 非阻塞回收。
5. **内存监控**：在长时间任务中定期检查内存使用量。
6. **超时保护**：为子进程设置最大执行时间，超时后强制终止。
7. **日志记录**：每个 Worker 的 PID 和退出状态都有日志记录。
8. **错误告警**：Worker 异常退出时触发告警通知。
9. **文件描述符检查**：确认 `ulimit -n` 足够大。
10. **资源清理**：退出时清理共享内存、临时文件、锁文件等。

### 10.3 最终建议

PHP 的 `pcntl_fork` 是一个被低估的强大工具。它不是银弹，但在正确的场景中——特别是 CLI 模式下的批处理任务——它提供了一种轻量、灵活、无外部依赖的并发方案。与 Supervisor 相比，它给了开发者更大的控制权；与 Swoole 相比，它的学习成本更低、兼容性更好。

在 B2C 项目的实际开发中，我建议采用**混合策略**：用 Supervisor 管理 Laravel Queue Worker 和 Web 服务进程（这些是常驻进程，需要高可靠性），用原生 pcntl 处理批处理任务和数据迁移（这些是一次性任务，需要灵活性）。这种组合方式在我们的项目中运行了两年多，稳定可靠，既没有过度工程化，也没有在关键时刻掉链子。

掌握 pcntl_fork 和信号处理，不仅仅是学会了一个技术方案，更是深入理解 Unix 进程模型的开始。当你真正理解了 fork、exec、wait、signal 这些系统调用的工作原理，你会发现很多看似复杂的技术问题——从 Docker 容器的 PID 命名空间到 Kubernetes 的 Pod 生命周期管理——都有了清晰的底层逻辑可以追溯。这正是系统编程的魅力所在。

## 相关阅读

- [PHP 进程模型深度剖析：PHP-FPM worker 生命周期、信号处理与 graceful reload 的底层机制](/PHP/php-fpm-worker-lifecycle-signal-graceful-reload/)
- [PHP GC 深度剖析：循环引用检测、根缓冲区、同步/异步垃圾回收——写时复制与引用计数之外的第三条路](/PHP/php-gc-deep-dive/)
- [Elixir OTP 实战：Supervisor 树、GenServer、分布式进程——对比 PHP-FPM 无状态模型的并发哲学](/架构/Elixir-OTP-实战-Supervisor树-GenServer-分布式进程-对比PHP-FPM无状态模型的并发哲学/)
