---
title: "PHP Fibers 底层剖析：从 Zend Fiber 到协程调度器"
keywords: [PHP Fibers, Zend Fiber, 底层剖析, 到协程调度器, PHP]
date: 2026-06-10 04:34:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - PHP8.1
  - Fibers
  - 协程
  - ZendEngine
  - Swoole
description: "深入剖析 PHP 8.1 Fibers 的 C 层实现，从 Zend Fiber 结构体到上下文切换机制，对比 Swoole 协程的本质差异，手写一个最小协程调度器。"
---


## 概述

PHP 8.1 引入了 Fibers，这是语言层面首次原生支持的协程机制。但很多人用 `async/await` 的思维去理解 Fibers，结果发现它既不能自动调度，也不能并发执行——那它到底解决了什么问题？

本文从 Zend Engine 的 C 源码出发，逐层拆解 Fibers 的实现原理：`zend_fiber` 结构体长什么样、`yield`/`resume` 怎么切换栈、为什么它和 Swoole 协程有本质区别。最后手写一个最小协程调度器，让你真正理解 Fibers 的定位。

## 核心概念：Fiber 不是 async/await

先纠正一个常见误解：**Fiber 不是 Promise，不是 Task，不是协程调度器**。

Fiber 本质上是一个**可暂停的函数调用栈**。它提供的是：
- 一块独立的 C 栈内存
- 两个操作：`suspend()` 暂停、`resume()` 恢复
- 没有调度器，没有事件循环，没有自动切换

类比：Fiber 是一个"可保存/恢复的函数调用帧"，而不是一个"可调度的并发任务"。

```php
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('fiber 暂停，返回这个值');
    echo "恢复后收到: $value\n";
});

// 启动 fiber，执行到 suspend 处暂停
$result = $fiber->start(); // 'fiber 暂停，返回这个值'
echo "主流程拿到: $result\n";

// 恢复 fiber，传入值给 suspend 的返回
$fiber->resume('主流程传入的值');
// 输出: 恢复后收到: 主流程传入的值
```

整个过程是**同步的、单线程的、手动的**。

## Zend Engine 层面的实现

### zend_fiber 结构体

在 PHP 源码 `Zend/zend_fibers.h` 中，`zend_fiber` 的核心结构：

```c
struct _zend_fiber {
    zend_object std;                    // 标准 PHP 对象头
    
    zend_fiber_context *context;        // 上下文（栈、寄存器）
    zend_fiber_context *caller;         // 调用者的上下文
    
    zend_coroutine_context *record;     // boost.context 的上下文记录
    
    zend_vm_stack vm_stack;             // 独立的 VM 栈
    zend_vm_stack *vm_stack_top;        // VM 栈顶指针
    zend_vm_stack *vm_stack_end;        // VM 栈底指针
    
    zval *execute_data;                 // 执行数据（类似调用帧）
    HashTable *record_cache;            // context 缓存池
    
    zend_fiber_status status;           // 状态：INIT/RUNNING/SUSPENDED/DEAD/THROWN
    bool is_finished;
    
    zval *retval;                       // 返回值
    zend_object *exception;             // 异常
};
```

关键点：
1. **独立的 VM 栈**：每个 Fiber 有自己的 Zend VM 栈，和主栈隔离
2. **独立的 execute_data**：相当于独立的调用帧
3. **状态机**：5 种状态，严格的状态转换

### 上下文切换的 C 层实现

PHP Fibers 底层依赖 **boost.context**（或其汇编实现），核心函数：

```c
// 创建上下文
zend_fiber_context *zend_fiber_context_create(void);

// 切换上下文（核心）
void zend_fiber_switch_context(zend_fiber_context *from, zend_fiber_context *to);
```

`zend_fiber_switch_context` 的本质是一个**汇编级的栈切换**：

```c
// 简化版伪代码（实际是汇编）
void zend_fiber_switch_context(from, to) {
    // 1. 保存当前 CPU 寄存器到 from->context
    //    包括：RSP（栈指针）、RBP（基址指针）、RIP（指令指针）、callee-saved 寄存器
    
    // 2. 恢复 to->context 中的寄存器到 CPU
    //    RSP 指向 fiber 的独立栈
    //    RIP 指向 fiber 上次暂停的位置
    
    // 3. 执行 RET 指令 → 跳转到 RIP
    //    从 fiber 的角度看，suspend() 调用"返回"了
}
```

这和操作系统的**线程上下文切换**原理几乎一样，区别是：
- 线程切换由内核调度，Fiber 切换由用户代码手动触发
- 线程有时间片抢占，Fiber 没有

### Fiber::start() 的执行流程

```c
// Zend/zend_fibers.c - 简化
ZEND_METHOD(Fiber, start) {
    zend_fiber *fiber = Z_FIBER_P(ZEND_THIS);
    
    // 1. 分配独立的 VM 栈（默认 4KB 初始大小）
    fiber->vm_stack = zend_vm_stack_new_page(ZEND_FIBER_VM_STACK_SIZE, NULL);
    fiber->vm_stack_top = fiber->vm_stack + 1;
    fiber->vm_stack_end = fiber->vm_stack->top + ZEND_FIBER_VM_STACK_PAGE_SLOTS;
    
    // 2. 创建新的 execute_data
    fiber->execute_data = zend_create_execute_data(fiber->vm_stack, &fiber_func, false);
    
    // 3. 设置调用者上下文为当前主栈
    fiber->caller = EG(active_context);
    
    // 4. 切换到 fiber 的上下文
    fiber->status = ZEND_FIBER_STATUS_RUNNING;
    zend_fiber_switch_context(fiber->caller, fiber->context);
    
    // 5. 切换回来后，检查 fiber 是否有返回值或异常
    // ...
}
```

### Fiber::suspend() 的执行流程

```c
ZEND_METHOD(Fiber, suspend) {
    zend_fiber *fiber = EG(active_fiber);
    
    // 1. 保存返回值
    if (value != NULL) {
        fiber->retval = value;
    }
    
    // 2. 暂停位置：这里就是 RIP 被保存的地方
    fiber->status = ZEND_FIBER_STATUS_SUSPENDED;
    
    // 3. 切换回调用者的上下文
    //    从 fiber 的视角看，suspend() 调用"挂起"了
    //    从主栈的视角看，start() 或 resume() 调用"返回"了
    zend_fiber_switch_context(fiber->context, fiber->caller);
    
    // 4. 当 fiber 被 resume 时，从这里继续执行
    //    检查是否传入了值
    if (fiber->value != NULL) {
        RETURN_COPY(fiber->value);
    }
}
```

### Fiber::resume() 的执行流程

```c
ZEND_METHOD(Fiber, resume) {
    zend_fiber *fiber = Z_FIBER_P(ZEND_THIS);
    
    // 1. 设置调用者上下文为当前栈
    fiber->caller = EG(active_context);
    
    // 2. 如果传入了值，保存到 fiber->value
    if (value != NULL) {
        fiber->value = value;
    }
    
    // 3. 切换到 fiber 的上下文
    //    fiber 从 suspend() 处恢复执行
    fiber->status = ZEND_FIBER_STATUS_RUNNING;
    zend_fiber_switch_context(fiber->caller, fiber->context);
    
    // 4. fiber 再次 suspend 或结束后，回到这里
}
```

## 栈内存模型

Fiber 的栈内存管理是理解其行为的关键：

```
主栈 (Main Stack)
┌─────────────────────────┐
│ 全局变量、主函数调用帧    │
│ ...                     │
│ fiber->start() 调用帧   │ ← RSP (主栈指针)
└─────────────────────────┘

Fiber 栈 (Fiber Stack)
┌─────────────────────────┐
│ fiber 的闭包调用帧       │ ← RSP (fiber 栈指针)
│ local variables         │
│ ...                     │
│ suspend() 调用帧        │ ← suspend 时保存的位置
└─────────────────────────┘
```

切换时：
1. 主栈的 RSP、RBP、RIP 保存到 `caller->context`
2. Fiber 的 RSP、RBP、RIP 从 `fiber->context` 恢复到 CPU
3. CPU 开始在 fiber 的栈上执行

默认栈大小：**PHP 8.1 默认 4KB 初始栈**（可通过 `ini_set('fiber.stack_size', ...)` 调整），按需增长。

## 与 Swoole 协程的本质差异

很多人问："有了 Fibers，还需要 Swoole 吗？" 答案是：**它们解决的问题完全不同**。

### 架构差异对比

| 维度 | PHP Fibers | Swoole 协程 |
|------|-----------|------------|
| **调度方式** | 手动（用户代码调用 suspend/resume） | 自动（调度器 + hook） |
| **并发能力** | 无（单 fiber 运行时阻塞其他 fiber） | 有（多个协程可并发执行） |
| **IO 处理** | 不处理 IO（需要配合事件循环） | 内置 epoll/kqueue，IO 自动挂起/恢复 |
| **栈管理** | Zend VM 栈（用户态） | 独立 C 栈（用户态，栈大小可配） |
| **hook 系统** | 无 | 有（sleep、file_get_contents、PDO 等全部 hook） |
| **适用场景** | 异步原语、生成器替代、中间件 | 高并发网络服务、连接池 |

### Swoole 协程的调度器

Swoole 的协程调度器核心逻辑：

```c
// swoole 协程调度器（简化）
while (1) {
    // 1. 从就绪队列取一个协程
    coroutine = ready_queue.pop();
    
    // 2. 切换到协程上下文
    switch_context(main_ctx, coroutine->ctx);
    
    // 3. 协程遇到 IO 时：
    //    - 调用 epoll_ctl 注册事件
    //    - 调用 yield，回到调度器
    //    - 调度器继续取下一个协程
    
    // 4. IO 事件就绪时：
    //    - epoll_wait 返回
    //    - 将对应协程放回就绪队列
}
```

Swoole 是**抢占式调度 + 事件驱动**，Fibers 是**协作式手动切换**。

### 代码层面的差异

**Fibers（手动调度）：**
```php
$fiber = new Fiber(function () {
    echo "开始执行\n";
    $result = Fiber::suspend('暂停'); // 手动暂停
    echo "恢复: $result\n";
});

$fiber->start();        // 手动启动
$fiber->resume('hello'); // 手动恢复
```

**Swoole（自动调度）：**
```php
Co\run(function () {
    // 这些 IO 操作会被 hook，自动挂起/恢复
    $html = file_get_contents('https://example.com'); // 自动挂起，让出 CPU
    $data = $redis->get('key');                        // 自动挂起，让出 CPU
    echo $html; // 自动恢复
});
// 多个协程可以并发执行，调度器自动管理
```

## 实战：手写最小协程调度器

理解了 Fibers 的本质后，我们可以用它手写一个最小的协程调度器：

```php
<?php

/**
 * 最小协程调度器
 * 展示 Fibers 如何被用于构建更高级的抽象
 */
class SimpleScheduler
{
    /** @var \SplQueue 待执行队列 */
    private \SplQueue $queue;
    
    /** @var int 当前时间（虚拟时钟） */
    private int $time = 0;
    
    /** @var array 延迟任务 [wake_time => [fiber, ...]] */
    private array $sleeping = [];

    public function __construct()
    {
        $this->queue = new \SplQueue();
    }

    /**
     * 添加一个任务（闭包）
     */
    public function addTask(Closure $task): void
    {
        $fiber = new Fiber($task);
        $this->queue->enqueue($fiber);
    }

    /**
     * 让出 CPU，延迟指定时间后恢复
     */
    public function sleep(int $ms): void
    {
        $fiber = Fiber::suspend(null);
        // suspend 返回后说明被 resume 了
    }

    /**
     * 调度循环
     */
    public function run(): void
    {
        while (!$this->queue->isEmpty() || !empty($this->sleeping)) {
            // 处理延迟任务
            $this->wakeSleepingTasks();
            
            if ($this->queue->isEmpty()) {
                // 没有可执行任务，推进虚拟时钟
                if (!empty($this->sleeping)) {
                    $this->time = min(array_keys($this->sleeping));
                    $this->wakeSleepingTasks();
                }
                continue;
            }
            
            $fiber = $this->queue->dequeue();
            
            if (!$fiber->isStarted()) {
                $fiber->start();
            } elseif ($fiber->isSuspended()) {
                $fiber->resume();
            }
            
            if ($fiber->isSuspended()) {
                // fiber 还活着，重新入队
                $this->queue->enqueue($fiber);
            }
            // isTerminated 的 fiber 自然丢弃
        }
    }

    /**
     * 唤醒到期的延迟任务
     */
    private function wakeSleepingTasks(): void
    {
        foreach ($this->sleeping as $wakeTime => $fibers) {
            if ($wakeTime <= $this->time) {
                foreach ($fibers as $fiber) {
                    $this->queue->enqueue($fiber);
                }
                unset($this->sleeping[$wakeTime]);
            }
        }
    }

    /**
     * 带延迟的任务包装
     */
    public function delayedTask(Closure $task, int $delayMs): void
    {
        $this->addTask(function () use ($task, $delayMs) {
            $task();
            // 模拟延迟
            $this->sleeping[$this->time + $delayMs][] = Fiber::suspend(null);
        });
    }
}

// === 使用示例 ===

$scheduler = new SimpleScheduler();

$scheduler->addTask(function () use ($scheduler) {
    echo "[{$scheduler->time}ms] 任务A: 开始\n";
    Fiber::suspend(null);
    echo "[{$scheduler->time}ms] 任务A: 第二次执行\n";
    Fiber::suspend(null);
    echo "[{$scheduler->time}ms] 任务A: 完成\n";
});

$scheduler->addTask(function () use ($scheduler) {
    echo "[{$scheduler->time}ms] 任务B: 开始\n";
    Fiber::suspend(null);
    echo "[{$scheduler->time}ms] 任务B: 完成\n";
});

$scheduler->run();

// 输出：
// [0ms] 任务A: 开始
// [0ms] 任务B: 开始
// [0ms] 任务A: 第二次执行
// [0ms] 任务B: 完成
// [0ms] 任务A: 完成
```

这个调度器虽然简单，但展示了 Fibers 的核心价值：**它是构建更高级并发抽象的基础设施**。

## 踩坑记录

### 1. 不能在 Fiber 外部调用 suspend

```php
$fiber = new Fiber(function () {
    // 正确：在 fiber 内部 suspend
    Fiber::suspend('ok');
});

// 错误：在 fiber 外部 suspend
Fiber::suspend('error'); // Fatal error: Cannot suspend outside of a fiber
```

### 2. 不能嵌套 start

```php
$fiber1 = new Fiber(function () {
    $fiber2 = new Fiber(function () {
        echo "inner\n";
    });
    // 这是可以的：在 fiber1 内部启动 fiber2
    $fiber2->start(); // OK
});

$fiber1->start(); // OK

// 但不能在已经 suspend 的 fiber 外部 resume 另一个 fiber 的 caller
```

### 3. 栈溢出风险

```php
// Fiber 的默认栈很小（4KB），深度递归会溢出
$fiber = new Fiber(function () {
    // 这个递归会爆栈
    $recursive = function (int $n) use (&$recursive) {
        if ($n <= 0) return 0;
        return $recursive($n - 1) + 1;
    };
    return $recursive(10000); // 可能 Fatal error: Allowed memory size exhausted
});
```

解决方案：增大栈大小或改用迭代。

### 4. 异常传播

```php
$fiber = new Fiber(function () {
    throw new RuntimeException('fiber 内部异常');
});

try {
    $fiber->start();
} catch (RuntimeException $e) {
    echo $e->getMessage(); // 'fiber 内部异常'
    // 异常会从 start() 调用处抛出
}

// 同样，resume 时的异常会从 suspend 处抛出
$fiber = new Fiber(function () {
    try {
        Fiber::suspend('pause');
    } catch (RuntimeException $e) {
        echo "fiber 捕获: " . $e->getMessage(); // 'resume 传入的异常'
    }
});

$fiber->start();
$fiber->throw(new RuntimeException('resume 传入的异常'));
```

### 5. return 值获取

```php
$fiber = new Fiber(function (): string {
    return 'fiber 的返回值';
});

$fiber->start();
echo $fiber->getReturn(); // 'fiber 的返回值'
// 注意：getReturn() 只能在 fiber 终止后调用
```

## 适用场景与选型建议

### 适合用 Fibers 的场景

1. **异步原语封装**：Promise、Future 的底层实现
2. **生成器的替代**：需要双向传值的场景
3. **中间件管道**：PSR-15 中间件的栈式执行
4. **测试框架**：模拟异步行为
5. **配合 AMPHP/v3**：PHP 异步生态的底层

### 不适合用 Fibers 的场景

1. **高并发网络服务**：用 Swoole 或 ReactPHP
2. **CPU 密集型并行**：用 `pcntl_fork` 或多进程
3. **简单的迭代器**：用 Generator 更简洁

### 生态中的 Fibers 应用

```
AMPHP v3        ──→ 用 Fibers 实现 async/await 语义
Pest v2         ──→ 用 Fibers 实现异步测试
Laravel Octane  ──→ Swoole + Fiber 混合模式
ReactPHP v3     ──→ 计划用 Fibers 替代回调
```

## 总结

PHP Fibers 的本质是一个**可暂停的函数调用栈**，它提供了比 Generator 更通用的协程原语，但不提供调度能力。理解它的 C 层实现后，你会发现：

1. **Fiber 不是 Swoole 的替代品**：Swoole 解决并发 IO，Fiber 解决抽象原语
2. **Fiber 是构建块**：它是 AMPHP v3 等异步框架的底层基础
3. **手动调度是特性，不是缺陷**：这让框架可以自由设计调度策略
4. **栈切换的开销极小**：用户态切换，没有内核态开销

下次当你用 `async/await` 写 PHP 时，记住底层是两个 `zend_fiber_switch_context` 调用——一次 suspend，一次 resume。

## 参考资料

- [PHP RFC: Fibers](https://wiki.php.net/rfc/fibers)
- [PHP 源码: Zend/zend_fibers.c](https://github.com/php/php-src/blob/master/Zend/zend_fibers.c)
- [Boost.Context 文档](https://www.boost.org/doc/libs/release/libs/context/)
- [AMPHP v3 文档](https://amphp.org/)
