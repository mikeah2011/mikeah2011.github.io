---

title: PHP Process Control 实战：pcntl_signal/pcntl_async_signals 深度——Laravel Queue Worker
keywords: [PHP Process Control, pcntl, signal, async, signals, Laravel Queue Worker, PHP]
date: 2026-06-10 01:03:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- pcntl
- 信号处理
- Queue
- 进程管理
- 优雅停止
- Supervisor
description: 深入剖析 PHP pcntl_signal/pcntl_async_signals 机制，从底层信号分发到 Laravel Queue Worker 的优雅停止实现，详解信号处理链、tick 陷阱、async_signals 最佳实践，以及 Supervisor 停止流程的完整链路。
---



## 概述

当你在生产环境运行 `php artisan queue:work` 时，有没有想过：执行 `queue:restart` 后，正在处理的任务是怎么做到不丢失的？答案藏在 PHP 的进程信号处理机制里。

信号（Signal）是 Unix/Linux 系统中最古老的进程间通信方式。PHP 通过 `pcntl` 扩展提供了完整的信号处理能力，而 Laravel 的 Queue Worker 正是基于这套机制实现了优雅停止（Graceful Stop）。

本文将从底层信号机制讲起，逐步深入到 Laravel Queue Worker 的信号处理链路，带你理解：

- `pcntl_signal` 与 `pcntl_async_signals` 的本质区别
- 为什么 `declare(ticks=1)` 在现代 PHP 中已过时
- Laravel Queue Worker 如何通过信号实现优雅停止
- Supervisor 发送 SIGTERM 后的完整生命周期
- 生产环境中的信号处理最佳实践

## 信号基础：操作系统视角

### 什么是信号

信号是内核发送给进程的异步通知。进程可以选择：

1. **执行默认操作**（通常是终止）
2. **忽略信号**
3. **捕获信号并执行自定义处理函数**

常用的进程信号：

| 信号 | 编号 | 默认行为 | 说明 |
|------|------|----------|------|
| SIGTERM | 15 | 终止 | 礼貌请求终止，可以被捕获 |
| SIGKILL | 9 | 终止 | 强制终止，不可捕获 |
| SIGINT | 2 | 终止 | Ctrl+C |
| SIGHUP | 1 | 终止 | 终端关闭，常用于重新加载配置 |
| SIGUSR1 | 10 | 终止 | 用户自定义 |
| SIGUSR2 | 12 | 终止 | 用户自定义 |
| SIGCHLD | 17 | 忽略 | 子进程状态变化 |
| SIGCONT | 18 | 继续 | 恢复被暂停的进程 |
| SIGSTOP | 19 | 暂停 | 暂停进程，不可捕获 |

### 信号的发送方式

```bash
# 通过 kill 命令
kill -SIGTERM <pid>
kill -15 <pid>

# 通过 PHP
posix_kill($pid, SIGTERM);

# Supervisor 发送停止信号
supervisorctl stop queue-worker
# 内部执行：kill -SIGTERM <pid>
```

## PHP pcntl_signal 基础

### 基本用法

```php
<?php

declare(ticks=1); // 必须！否则信号不会被分发

// 注册信号处理器
pcntl_signal(SIGTERM, function ($signo) {
    echo "收到 SIGTERM，准备退出...\n";
    // 清理工作
    exit(0);
});

pcntl_signal(SIGINT, function ($signo) {
    echo "收到 SIGINT (Ctrl+C)\n";
    exit(0);
});

// 模拟长运行进程
while (true) {
    sleep(1);
    echo "处理中...\n";
}
```

### ticks 的陷阱

`declare(ticks=1)` 的含义是：**每执行 1 条低级语句后，检查是否有待处理的信号**。

这意味着：

```php
declare(ticks=1);

pcntl_signal(SIGTERM, function () {
    echo "SIGTERM received\n";
});

// 这段代码中，信号检查发生在每条语句之后
// 实际上 ticks 机制开销很大
for ($i = 0; $i < 1000000; $i++) {
    $data = process($i); // 每执行一次循环体，都会检查信号
}
```

**问题**：ticks 是全局的，会影响整个进程的性能。在高并发场景下，频繁的信号检查会带来明显的 CPU 开销。

更糟糕的是，如果代码中有 C 扩展执行了长时间的操作（如数据库查询、文件 I/O），信号可能在那个操作期间到达，但要等到 ticks 触发时才会被处理。

## pcntl_async_signals：现代信号处理

### PHP 7.1+ 的革命

从 PHP 7.1 开始，引入了 `pcntl_async_signals()` 函数，彻底取代了 `declare(ticks=1)`。

```php
<?php

// 开启异步信号处理（全局生效）
pcntl_async_signals(true);

pcntl_signal(SIGTERM, function ($signo) {
    echo "收到 SIGTERM\n";
    exit(0);
});

// 不需要 declare(ticks=1)
while (true) {
    // 信号会在系统调用（如 sleep）返回时被检查
    // 不需要每条语句都检查
    sleep(1);
    echo "工作中...\n";
}
```

### 底层机制

`pcntl_async_signals(true)` 做了什么？

在底层，PHP 修改了信号分发方式：

```
# 旧方式 (ticks)
php_execute_script()
  → zend_tick_function()  // 每条语句后调用
    → pcntl_signal_dispatch()  // 检查并分发信号

# 新方式 (async_signals)
sigaction(SIGTERM, &sa)  // 注册信号处理函数
  → 内核直接调用 PHP 的信号处理器
    → 无需 tick 机制
```

**关键区别**：

| 特性 | ticks | async_signals |
|------|-------|---------------|
| PHP 版本 | PHP 4+ | PHP 7.1+ |
| 性能开销 | 高（每条语句检查） | 低（内核级分发） |
| 时机控制 | 语句边界 | 系统调用边界 |
| 全局影响 | 是 | 是 |
| 推荐度 | ❌ 已过时 | ✅ 推荐 |

### 信号处理的时机

即使使用 `pcntl_async_signals`，信号也不是在任意时刻都能被处理的。信号处理发生在 **系统调用的边界**：

```php
pcntl_async_signals(true);

pcntl_signal(SIGTERM, function () {
    echo "SIGTERM!\n";
    exit(0);
});

// 以下情况信号会被及时处理：
sleep(1);          // sleep 是系统调用，返回时检查信号
usleep(100000);    // usleep 同理
stream_select(...); // I/O 多路复用
pcntl_waitpid(...); // 等待子进程

// 以下情况信号可能被延迟：
for ($i = 0; $i < 100000000; $i++) {
    $x = $i * $i;  // 纯 CPU 计算，不涉及系统调用
    // 信号要等到下一次系统调用才会被处理
}
```

## Laravel Queue Worker 的信号处理

### 源码解析

Laravel 的 Queue Worker 是信号处理的经典案例。核心代码在 `Illuminate\Queue\Worker` 和 `Illuminate\Queue\WorkerProcess` 中。

#### Worker::daemon 方法

```php
// Illuminate\Queue\Worker

public function daemon($connectionName, $queue, WorkerOptions $options)
{
    // 关键：在进程启动时注册信号处理器
    if ($this->supportsAsyncSignals()) {
        $this->listenForSignals();
    }

    $lastRestart = $this->getTimestampOfLastQueueRestart();

    while (true) {
        // 检查是否应该停止
        if ($this->shouldQuit) {
            $this->kill();
        }

        // 检查是否需要重启
        if ($this->memoryExceeded($options->memory)) {
            $this->stop(12);
        } elseif ($this->queueShouldRestart($lastRestart)) {
            $this->stop();
        }

        // 从队列中获取并处理任务
        $job = $this->getNextJob(
            $this->manager->connection($connectionName), $queue
        );

        if ($job) {
            $this->runJob($job, $connectionName, $options);
        } else {
            // 没有任务时休眠
            $this->sleep($options->sleep);
        }
    }
}
```

#### listenForSignals 方法

```php
// Illuminate\Queue\Worker

protected function listenForSignals()
{
    pcntl_async_signals(true);  // 开启异步信号

    pcntl_signal(SIGTERM, function () {
        $this->shouldQuit = true;  // 设置退出标志
    });

    pcntl_signal(SIGQUIT, function () {
        $this->shouldQuit = true;
    });

    pcntl_signal(SIGUSR2, function () {
        $this->paused = true;
    });

    pcntl_signal(SIGCONT, function () {
        $this->paused = false;
    });

    pcntl_signal(SIGTSTP, function () {
        $this->paused = true;
    });
}
```

### 信号处理链路

当 Supervisor 发送 `SIGTERM` 时，完整链路如下：

```
1. Supervisor 执行：kill -SIGTERM <queue-worker-pid>
        ↓
2. 内核将 SIGTERM 加入进程的待处理信号队列
        ↓
3. PHP 的信号处理器被触发（因为 pcntl_async_signals(true)）
        ↓
4. 执行回调：$this->shouldQuit = true
        ↓
5. Worker::daemon() 的 while 循环检查 shouldQuit
        ↓
6. 如果当前有任务正在执行：
   - 等待当前任务完成（不中断！）
   - 任务完成后才会检查 shouldQuit
        ↓
7. 如果当前没有任务：
   - sleep() 返回后立即检查 shouldQuit
   - 退出循环
        ↓
8. $this->kill() 被调用
        ↓
9. 进程退出
```

### 优雅停止的关键细节

#### 当前任务不会被中断

```php
// 这是最重要的设计决策
public function runJob($job, $connectionName, $options)
{
    try {
        // 任务执行期间不会被 SIGTERM 中断
        // 因为信号只设置了 shouldQuit 标志
        // 要等 runJob 返回后才会检查
        return $this->process($connectionName, $job, $options);
    } catch (Throwable $e) {
        $this->exceptions->report($e);
        $this->stopWorkerIfLostConnection($e);
    }
}
```

#### 任务超时保护

如果一个任务执行时间过长（比如死循环），Worker 永远等不到退出。Laravel 提供了 `--timeout` 参数：

```bash
php artisan queue:work --timeout=60
```

底层实现：

```php
// Illuminate\Queue\WorkerProcess

public function run($connection, $queue, WorkerOptions $options)
{
    $process = new Process([
        $this->command,
        'queue:work',
        $connection,
        '--queue=' . $queue,
        '--timeout=' . $options->timeout,  // 关键
        // ...
    ]);

    $process->setTimeout($options->timeout + 60); // 多给 60 秒余量
    $process->run();
}
```

当超时发生时，Supervisor 会先发 SIGTERM，等待一段时间后再发 SIGKILL：

```ini
; supervisor.conf
[program:queue-worker]
command=php artisan queue:work --timeout=60
stopwaitsecs=70          ; 比 timeout 多 10 秒
stopsignal=TERM
```

## 完整生命周期：从 Supervisor 到任务完成

### 配置 Supervisor

```ini
[program:laravel-queue]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/app/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
user=www-data
numprocs=4
redirect_stderr=true
stdout_logfile=/var/log/supervisor/queue.log
stopwaitsecs=70
stopsignal=TERM
```

### 停止流程时序图

```
时间轴 →

Supervisor:  supervisorctl stop laravel-queue
               │
               ▼
Supervisor:  kill -SIGTERM (×4个Worker进程)
               │
               ├── Worker 1: 正在执行任务
               │   └── 设置 shouldQuit = true
               │   └── 等待任务完成 (假设耗时 20s)
               │   └── 任务完成 → 检查 shouldQuit → 退出
               │
               ├── Worker 2: 正在 sleep
               │   └── sleep 被信号中断
               │   └── 检查 shouldQuit → 退出 (立即)
               │
               ├── Worker 3: 正在执行任务 (耗时 40s)
               │   └── 设置 shouldQuit = true
               │   └── 等待任务完成
               │   └── 如果 70s 内未完成...
               │
               ▼ (70秒后)
Supervisor:  kill -SIGKILL Worker 3  (强制终止)
               │
               ▼
Supervisor:  所有 Worker 已停止
```

### queue:restart 的实现

```bash
php artisan queue:restart
```

内部做了什么：

```php
// Illuminate\Queue\Console\RestartCommand

public function handle()
{
    // 只是写了一个时间戳到缓存
    $this->laravel['cache']->forever(
        'illuminate:queue:restart', 
        $time = time()
    );

    // 所有 Worker 在 daemon 循环中会检查这个时间戳
    // 发现变化后自行退出
    // Supervisor 检测到退出后自动重启新进程
    $this->info('Broadcasting queue restart signal.');
}
```

Worker 侧的检查：

```php
// Worker::daemon 循环中
if ($this->queueShouldRestart($lastRestart)) {
    $this->stop();  // 优雅退出
}

protected function queueShouldRestart($lastRestart)
{
    return $this->getTimestampOfLastQueueRestart() != $lastRestart;
}
```

## 实战：自定义进程管理器的信号处理

### 基础框架

```php
<?php

declare(strict_types=1);

pcntl_async_signals(true);

class ProcessManager
{
    private array $workers = [];
    private bool $shuttingDown = false;
    private int $gracefulTimeout = 30;

    public function run(): void
    {
        $this->registerSignalHandlers();
        $this->forkWorkers(4);

        // 主进程等待子进程
        while (!$this->shuttingDown || !empty($this->workers)) {
            $status = 0;
            $pid = pcntl_waitpid(-1, $status, WNOHANG);

            if ($pid > 0) {
                unset($this->workers[$pid]);
                echo "[Manager] Worker {$pid} 退出，状态: {$status}\n";

                // 如果不是关闭期间，自动重启
                if (!$this->shuttingDown) {
                    $this->forkOneWorker();
                }
            }

            usleep(100000); // 100ms
        }

        echo "[Manager] 所有 Worker 已退出\n";
    }

    private function registerSignalHandlers(): void
    {
        // SIGTERM: 优雅关闭
        pcntl_signal(SIGTERM, function () {
            echo "[Manager] 收到 SIGTERM，开始优雅关闭...\n";
            $this->gracefulShutdown();
        });

        // SIGINT: Ctrl+C
        pcntl_signal(SIGINT, function () {
            echo "[Manager] 收到 SIGINT\n";
            $this->gracefulShutdown();
        });

        // SIGUSR1: 打印状态
        pcntl_signal(SIGUSR1, function () {
            echo "[Manager] 当前 Worker 数量: " . count($this->workers) . "\n";
            foreach ($this->workers as $pid => $info) {
                echo "  - PID {$pid}: started at {$info}\n";
            }
        });

        // SIGHUP: 重启所有 Worker
        pcntl_signal(SIGHUP, function () {
            echo "[Manager] 收到 SIGHUP，重启所有 Worker...\n";
            $this->restartAllWorkers();
        });
    }

    private function forkWorkers(int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            $this->forkOneWorker();
        }
    }

    private function forkOneWorker(): int
    {
        $pid = pcntl_fork();

        if ($pid === -1) {
            throw new RuntimeException('fork 失败');
        }

        if ($pid === 0) {
            // 子进程
            $this->workerLoop();
            exit(0);
        }

        // 父进程记录子进程
        $this->workers[$pid] = date('Y-m-d H:i:s');
        echo "[Manager] 启动 Worker {$pid}\n";

        return $pid;
    }

    private function workerLoop(): void
    {
        $shouldQuit = false;

        // 子进程也要注册自己的信号处理器
        pcntl_signal(SIGTERM, function () use (&$shouldQuit) {
            $shouldQuit = true;
        });

        pcntl_signal(SIGQUIT, function () use (&$shouldQuit) {
            $shouldQuit = true;
        });

        while (!$shouldQuit) {
            // 模拟从队列获取任务
            $job = $this->fetchJob();

            if ($job) {
                $this->processJob($job);
            } else {
                // 没有任务时休眠，信号可以在这里被处理
                sleep(3);
            }
        }

        echo "[Worker " . getmypid() . "] 优雅退出\n";
    }

    private function fetchJob(): ?array
    {
        // 模拟：80% 概率没有任务
        if (random_int(1, 100) <= 80) {
            return null;
        }

        return [
            'id' => uniqid(),
            'payload' => 'task_' . random_int(1, 1000),
        ];
    }

    private function processJob(array $job): void
    {
        $pid = getmypid();
        echo "[Worker {$pid}] 处理任务 {$job['id']}\n";

        // 模拟任务耗时
        sleep(random_int(1, 5));

        echo "[Worker {$pid}] 任务 {$job['id']} 完成\n";
    }

    private function gracefulShutdown(): void
    {
        $this->shuttingDown = true;

        // 向所有子进程发送 SIGTERM
        foreach ($this->workers as $pid => $info) {
            echo "[Manager] 向 Worker {$pid} 发送 SIGTERM\n";
            posix_kill($pid, SIGTERM);
        }

        // 等待一段时间让子进程自行退出
        $deadline = time() + $this->gracefulTimeout;

        while (!empty($this->workers) && time() < $deadline) {
            $status = 0;
            $pid = pcntl_waitpid(-1, $status, WNOHANG);

            if ($pid > 0) {
                unset($this->workers[$pid]);
                echo "[Manager] Worker {$pid} 已优雅退出\n";
            }

            usleep(100000);
        }

        // 超时的子进程强制终止
        foreach ($this->workers as $pid => $info) {
            echo "[Manager] Worker {$pid} 超时，发送 SIGKILL\n";
            posix_kill($pid, SIGKILL);
        }

        // 回收剩余子进程
        while (($pid = pcntl_waitpid(-1, $status, WNOHANG)) > 0) {
            unset($this->workers[$pid]);
        }
    }

    private function restartAllWorkers(): void
    {
        // 发送 SIGQUIT 让子进程优雅退出
        foreach ($this->workers as $pid => $info) {
            posix_kill($pid, SIGQUIT);
        }

        // 等待退出后重新启动
        while (!empty($this->workers)) {
            $status = 0;
            $pid = pcntl_waitpid(-1, $status, WNOHANG);

            if ($pid > 0) {
                unset($this->workers[$pid]);
            }

            usleep(100000);
        }

        $this->forkWorkers(4);
    }
}

// 启动
$manager = new ProcessManager();
$manager->run();
```

### 与 Laravel Queue 集成

```php
<?php

// app/Console/Commands/CustomQueueWorker.php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Queue\Worker;
use Illuminate\Queue\WorkerOptions;

class CustomQueueWorker extends Command
{
    protected $signature = 'custom:queue:work 
                            {connection? : 队列连接名}
                            {--queue= : 要处理的队列}
                            {--sleep=3 : 无任务时休眠秒数}
                            {--timeout=60 : 任务超时秒数}
                            {--tries=3 : 最大重试次数}
                            {--max-jobs=0 : 最大处理任务数}
                            {--max-time=0 : 最大运行时间}';

    protected $description = '自定义队列 Worker，演示信号处理';

    public function handle(Worker $worker): int
    {
        $connection = $this->argument('connection') ?? 'redis';
        $queue = $this->option('queue') ?: null;

        $options = new WorkerOptions(
            sleep: (int) $this->option('sleep'),
            maxJobs: (int) $this->option('max-jobs'),
            maxTime: (int) $this->option('max-time'),
            tries: (int) $this->option('tries'),
            timeout: (int) $this->option('timeout'),
        );

        // Laravel Worker 内部已经处理了信号
        $worker->daemon($connection, $queue, $options);

        return 0;
    }
}
```

## 踩坑记录

### 坑 1：pcntl_signal 在 CLI 模式外不可用

`pcntl` 扩展默认只在 CLI SAPI 下可用。在 PHP-FPM 或 Apache 模块中调用会得到 `undefined function` 错误。

```php
// 正确的做法
if (function_exists('pcntl_signal')) {
    pcntl_signal(SIGTERM, $handler);
}

// 或者在 composer.json 中声明
{
    "require": {
        "ext-pcntl": "*"
    }
}
```

### 坑 2：信号处理器中的变量作用域

```php
// ❌ 错误：匿名函数的变量绑定问题
$shouldQuit = false;
pcntl_signal(SIGTERM, function () {
    $shouldQuit = true;  // 这是局部变量，外面看不到！
});

// ✅ 正确：使用引用
$shouldQuit = false;
pcntl_signal(SIGTERM, function () use (&$shouldQuit) {
    $shouldQuit = true;  // 修改的是外部变量
});
```

### 坑 3：信号处理器中不能调用非异步安全函数

信号处理器中的代码在信号到达时被"插入"执行，某些函数在信号处理器中调用可能导致死锁或未定义行为。

```php
// ❌ 危险：在信号处理器中使用这些函数
pcntl_signal(SIGTERM, function () {
    echo "退出\n";           // echo 是安全的
    file_put_contents(...);  // 文件 I/O 可能不安全
    $db->query(...);         // 数据库操作不安全！
    header('Location: ...'); // HTTP 输出不安全
});

// ✅ 安全：只设置标志
pcntl_signal(SIGTERM, function () use (&$shouldQuit) {
    $shouldQuit = true;  // 只做最简单的操作
});
```

### 坑 4：pcntl_waitpid 的 WNOHANG

```php
// ❌ 阻塞等待：进程会卡在这里
$pid = pcntl_waitpid(-1, $status);

// ✅ 非阻塞：立即返回
$pid = pcntl_waitpid(-1, $status, WNOHANG);
if ($pid === 0) {
    // 没有子进程状态变化
} elseif ($pid > 0) {
    // 子进程 pid 已退出
} elseif ($pid === -1) {
    // 没有子进程
}
```

### 坑 5：Supervisor 的 stopwaitsecs

如果 Worker 处理的任务耗时长，Supervisor 的 `stopwaitsecs` 必须大于任务的最大执行时间：

```ini
; 假设任务最长 60 秒
stopwaitsecs=70  ; 最好留 10 秒余量

; 如果不够，Supervisor 会发 SIGKILL
; 正在执行的任务会丢失！
```

### 坑 6：子进程继承父进程的信号处理器

`pcntl_fork()` 后，子进程会继承父进程的信号处理器。如果父进程注册了信号处理器但子进程不需要，要在子进程中重置：

```php
$pid = pcntl_fork();

if ($pid === 0) {
    // 子进程：重置信号处理器
    pcntl_signal(SIGTERM, SIG_DFL);  // 恢复默认行为
    // 或者注册自己的处理器
    pcntl_signal(SIGTERM, function () { /* ... */ });
}
```

## 生产环境最佳实践

### 1. 始终使用 pcntl_async_signals

```php
// 在应用入口处（artisan 或自定义脚本）
if (function_exists('pcntl_async_signals')) {
    pcntl_async_signals(true);
}
```

### 2. 信号处理器只做最少的事

```php
// 最佳模式：只设置标志
class Worker
{
    private bool $shouldQuit = false;
    private bool $shouldRestart = false;

    public function registerSignals(): void
    {
        pcntl_async_signals(true);

        pcntl_signal(SIGTERM, [$this, 'handleSignal']);
        pcntl_signal(SIGQUIT, [$this, 'handleSignal']);
        pcntl_signal(SIGHUP, [$this, 'handleSignal']);
        pcntl_signal(SIGUSR1, [$this, 'handleSignal']);
    }

    public function handleSignal(int $signo): void
    {
        match ($signo) {
            SIGTERM, SIGQUIT => $this->shouldQuit = true,
            SIGHUP => $this->shouldRestart = true,
            SIGUSR1 => $this->dumpStatus(),
            default => null,
        };
    }

    public function shouldQuit(): bool
    {
        return $this->shouldQuit;
    }
}
```

### 3. 监控与告警

```bash
# 监控 Worker 进程数量
#!/bin/bash
EXPECTED_WORKERS=4
ACTUAL_WORKERS=$(pgrep -c 'queue:work')

if [ "$ACTUAL_WORKERS" -lt "$EXPECTED_WORKERS" ]; then
    echo "Worker 数量不足: $ACTUAL_WORKERS/$EXPECTED_WORKERS"
    # 发送告警
fi

# 监控 Worker 是否在处理任务
# 通过 SIGUSR1 获取状态
pgrep -f 'queue:work' | while read pid; do
    kill -SIGUSR1 $pid
done
```

### 4. 日志记录

```php
pcntl_signal(SIGTERM, function () use ($logger) {
    $logger->info('Worker 收到 SIGTERM', [
        'pid' => getmypid(),
        'memory' => memory_get_usage(true),
        'jobs_processed' => $this->jobsProcessed,
    ]);
    $this->shouldQuit = true;
});
```

## 总结

| 概念 | 关键点 |
|------|--------|
| `pcntl_signal` | 注册信号处理器，但需要 ticks 或 async_signals |
| `pcntl_async_signals` | PHP 7.1+ 推荐方式，取代 ticks |
| `declare(ticks=1)` | 已过时，性能差 |
| 信号处理器 | 只设置标志，不做复杂操作 |
| 优雅停止 | SIGTERM → 设置标志 → 等待当前任务完成 → 退出 |
| 超时保护 | Supervisor 的 stopwaitsecs 必须大于任务超时 |
| queue:restart | 写时间戳缓存，Worker 检测变化后自行退出 |

信号处理看似简单，但涉及操作系统、PHP 运行时、进程管理等多个层面。理解这些底层机制，才能在生产环境构建可靠的队列处理系统。

Laravel 的 Queue Worker 设计堪称优雅：通过信号标志（而非中断任务）实现停止，通过缓存时间戳实现重启，通过 Supervisor 实现自动恢复。这套机制保证了任务不丢失、进程可管理、部署可自动化。

**下一篇预告**：我们将深入 Supervisor 的配置优化，以及如何用 systemd 替代 Supervisor 管理 Laravel 队列。
