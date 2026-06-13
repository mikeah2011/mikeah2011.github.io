---
title: Kotlin Coroutines 深度实战：挂起函数、结构化并发、Flow——与 PHP Fibers/Go goroutine 的并发模型对比
date: 2026-06-03 00:00:00
tags: [kotlin, coroutines, concurrency, php fibers, go, goroutine]
categories:
  - architecture
description: "深度对比 Kotlin Coroutines、Go goroutine 与 PHP Fibers 三大并发模型：从挂起函数、结构化并发、Flow 冷热流到底层调度器原理，覆盖 API 设计、异常处理、性能基准测试与适用场景分析。附大量可运行代码示例与方案对比表格，帮助后端开发者在微服务、高吞吐量场景中做出正确的并发技术选型。"
cover: /images/covers/kotlin-coroutines-concurrency-comparison-cover.jpg
---

## 前言

在现代软件开发中，并发编程已经从"高级话题"变成了日常需求。无论是构建高吞吐量的微服务、处理实时数据流，还是优化 I/O 密集型应用，选择合适的并发模型对系统性能和代码可维护性有着深远的影响。

三种主流的并发模型——**Kotlin Coroutines**、**Go goroutine** 和 **PHP Fibers**——分别代表了不同语言社区对并发问题的解答。Kotlin 协程以挂起函数和结构化并发为核心，提供了类型安全且可组合的异步编程范式；Go 的 goroutine 以极低的创建成本和 CSP（Communicating Sequential Processes）模型著称；PHP Fibers 则是 PHP 8.1 引入的轻量级协程，为 PHP 生态带来了原生的并发能力。

本文将从底层原理、API 设计、异常处理、性能特征等多个维度对这三种并发模型进行深度对比，并通过大量真实代码示例帮助读者理解各自的优劣和适用场景。

---

## 一、并发模型的核心哲学

### 1.1 三种模型的设计理念

在深入代码之前，我们有必要理解三种并发模型背后的设计哲学：

**Go goroutine —— "Don't communicate by sharing memory; share memory by communicating"**

Go 语言的并发模型基于 Tony Hoare 提出的 CSP 理论。goroutine 是 Go 运行时管理的绿色线程，通过 channel 进行通信。Go 鼓励开发者将并发单元视为独立的顺序进程，通过消息传递而非共享内存来协调工作。goroutine 的创建成本极低（初始栈仅 2KB），可以轻松创建数十万个并发单元。

**Kotlin Coroutines —— "Structured Concurrency with Suspension"**

Kotlin 协程的核心思想是将异步代码写成同步风格，同时通过结构化并发确保所有协程的生命周期受到严格管控。协程不是线程，而是可以挂起和恢复的计算片段。Kotlin 通过 `suspend` 关键字在编译器层面标记可挂起点，通过 `CoroutineScope` 建立父子关系，确保没有协程会被"泄漏"。

**PHP Fibers —— "Cooperative Multitasking for the Web"**

PHP Fibers 是 PHP 8.1 引入的原生协程机制，设计目标是在 PHP 的同步编程模型基础上引入协作式多任务。Fiber 允许开发者在任意位置挂起执行并在之后恢复，但不提供结构化并发、取消机制或组合操作符。它是构建更高级异步框架（如 ReactPHP、Amphp）的基础原语。

### 1.2 历史演进

| 语言 | 并发机制 | 引入版本 | 年份 |
|------|---------|---------|------|
| Go | goroutine + channel | Go 1.0 | 2012 |
| Kotlin | Coroutines (实验性) | Kotlin 1.1 | 2017 |
| Kotlin | Coroutines (稳定) | Kotlin 1.3 | 2018 |
| PHP | Fibers | PHP 8.1 | 2021 |

---

## 二、挂起函数与协程创建

### 2.1 Kotlin 挂起函数（suspend function）

Kotlin 协程的核心是 `suspend` 关键字。被标记为 `suspend` 的函数只能在协程或其他挂起函数中调用，它可以在不阻塞线程的情况下暂停执行。

```kotlin
import kotlinx.coroutines.*

suspend fun fetchUser(id: String): User {
    delay(1000) // 挂起 1 秒，不阻塞线程
    return User(id, "Alice")
}

suspend fun fetchOrders(userId: String): List<Order> {
    delay(1500)
    return listOf(Order("001"), Order("002"))
}

fun main() = runBlocking {
    val user = fetchUser("u123")
    val orders = fetchOrders(user.id)
    println("User: ${user.name}, Orders: ${orders.size}")
}
```

`suspend` 关键字在编译时会为函数添加一个 `Continuation` 参数（CPS 变换）。编译器将挂起函数转换为状态机，每个挂起点对应一个状态。这与 Go 的 goroutine 有本质区别——Go 的函数不需要任何标记，运行时自动调度所有 goroutine。

Kotlin 协程的挂起是**协作式的**：只有在调用其他挂起函数时才会挂起，开发者可以精确控制挂起点。这一点与 PHP Fiber 类似，但与 Go 的抢占式调度不同。

### 2.2 Go goroutine 创建

Go 中启动一个 goroutine 非常简单，只需在函数调用前加上 `go` 关键字：

```go
package main

import (
    "fmt"
    "time"
)

func fetchUser(id string) string {
    time.Sleep(1 * time.Second)
    return "Alice"
}

func fetchOrders(userId string) []string {
    time.Sleep(1500 * time.Millisecond)
    return []string{"order-001", "order-002"}
}

func main() {
    // 启动 goroutine
    go func() {
        user := fetchUser("u123")
        fmt.Println("User:", user)
    }()

    // 等待完成（实际项目中应使用 sync.WaitGroup 或 channel）
    time.Sleep(3 * time.Second)
}
```

Go 的 goroutine 没有任何语法标记。任何函数调用都可以通过 `go` 关键字变为并发执行。这种低门槛是 Go 并发模型的一大优势，但也带来了管理上的挑战——如何确保所有 goroutine 正确完成？这正是 Go 的 `sync.WaitGroup` 和 context 取消机制要解决的问题。

### 2.3 PHP Fiber 创建

PHP Fiber 提供了一个相对底层的协程原语：

```php
<?php

function fetchUser(string $id): string {
    Fiber::suspend('started fetching user');
    // 模拟异步操作完成后恢复
    return "Alice";
}

function fetchOrders(string $userId): array {
    Fiber::suspend('started fetching orders');
    return ['order-001', 'order-002'];
}

// 创建 Fiber
$fiber = new Fiber(function (): void {
    $user = fetchUser('u123');
    $orders = fetchOrders($user);
    echo "User: $user, Orders: " . count($orders) . "\n";
    Fiber::suspend('done');
});

// 启动 Fiber
$result = $fiber->start(); // 'started fetching user'
echo "Fiber suspended with: $result\n";

// 恢复执行
$result = $fiber->start(); // 'started fetching orders'
echo "Fiber suspended with: $result\n";

// 再次恢复
$result = $fiber->start(); // 'done'
echo "Fiber completed\n";
```

PHP Fiber 的设计非常手动——你需要显式地调用 `Fiber::suspend()` 来挂起，调用 `$fiber->start()` 或 `$fiber->resume()` 来恢复。这与 Kotlin 的协程调度器自动管理挂起/恢复形成鲜明对比。

### 2.4 对比分析

| 特性 | Kotlin Coroutines | Go goroutine | PHP Fiber |
|------|------------------|--------------|-----------|
| 创建语法 | `launch { }` / `async { }` | `go func()()` | `new Fiber(fn)` |
| 挂起标记 | `suspend` 关键字 | 无需标记 | `Fiber::suspend()` |
| 调度方式 | 协作式 + Dispatchers | 抢占式（Go 调度器） | 协作式（手动） |
| 初始内存 | ~几百字节 | ~2KB（栈） | ~几KB |
| 是否可取消 | 是（Job.cancel()） | 是（context） | 否（原生不支持） |

---

## 三、结构化并发（Structured Concurrency）

### 3.1 Kotlin 的结构化并发

结构化并发是 Kotlin 协程最独特的特性之一。核心思想是：**每个协程都必须在一个 `CoroutineScope` 中启动，scope 的生命周期决定了协程的生命周期**。

```kotlin
suspend fun loadDashboard() = coroutineScope {
    val user = async { fetchUser("u123") }
    val orders = async { fetchOrders("u123") }
    val notifications = async { fetchNotifications("u123") }

    // 等待所有结果，任一失败则取消其他
    Dashboard(
        user = user.await(),
        orders = orders.await(),
        notifications = notifications.await()
    )
}
```

`coroutineScope` 函数创建一个新的作用域，它有以下保证：
- **等待所有子协程完成**：scope 不会结束，直到所有子协程完成。
- **取消传播**：如果父协程被取消，所有子协程也会被取消。
- **异常传播**：如果任何一个子协程失败，其他子协程会被取消，异常传播到父协程。

```kotlin
fun main() = runBlocking {
    try {
        coroutineScope {
            val job1 = launch {
                delay(1000)
                println("Job 1 done")
            }
            val job2 = launch {
                delay(500)
                throw RuntimeException("Job 2 failed!")
            }
        }
    } catch (e: Exception) {
        println("Caught: ${e.message}")
        // 输出: Caught: Job 2 failed!
        // Job 1 会被自动取消
    }
}
```

这种设计从根本上避免了"协程泄漏"问题。在传统的回调或 Future/Promise 模型中，很容易忘记处理某个异步任务，导致资源泄漏。

### 3.2 Go 的并发管理

Go 没有原生的结构化并发概念。开发者需要手动管理 goroutine 的生命周期：

```go
func loadDashboard(ctx context.Context) (*Dashboard, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    var wg sync.WaitGroup
    var mu sync.Mutex
    var user string
    var orders []string
    var notifications []string
    var firstErr error

    wg.Add(3)

    go func() {
        defer wg.Done()
        u, err := fetchUser(ctx, "u123")
        if err != nil {
            mu.Lock()
            if firstErr == nil {
                firstErr = err
                cancel() // 取消其他 goroutine
            }
            mu.Unlock()
            return
        }
        mu.Lock()
        user = u
        mu.Unlock()
    }()

    go func() {
        defer wg.Done()
        o, err := fetchOrders(ctx, "u123")
        if err != nil {
            mu.Lock()
            if firstErr == nil {
                firstErr = err
                cancel()
            }
            mu.Unlock()
            return
        }
        mu.Lock()
        orders = o
        mu.Unlock()
    }()

    go func() {
        defer wg.Done()
        n, err := fetchNotifications(ctx, "u123")
        if err != nil {
            mu.Lock()
            if firstErr == nil {
                firstErr = err
                cancel()
            }
            mu.Unlock()
            return
        }
        mu.Lock()
        notifications = n
        mu.Unlock()
    }()

    wg.Wait()
    if firstErr != nil {
        return nil, firstErr
    }
    return &Dashboard{User: user, Orders: orders, Notifications: notifications}, nil
}
```

这段 Go 代码的复杂度明显高于 Kotlin 版本。开发者需要手动处理互斥锁、等待组和上下文取消。Go 社区也在通过 `errgroup` 包来简化这种模式：

```go
func loadDashboard(ctx context.Context) (*Dashboard, error) {
    g, ctx := errgroup.WithContext(ctx)

    var user string
    var orders []string
    var notifications []string

    g.Go(func() error {
        var err error
        user, err = fetchUser(ctx, "u123")
        return err
    })

    g.Go(func() error {
        var err error
        orders, err = fetchOrders(ctx, "u123")
        return err
    })

    g.Go(func() error {
        var err error
        notifications, err = fetchNotifications(ctx, "u123")
        return err
    })

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return &Dashboard{User: user, Orders: orders, Notifications: notifications}, nil
}
```

`errgroup` 极大地简化了代码，但它仍然是库级别的解决方案，而非语言级别的保证。

### 3.3 PHP 的并发管理

PHP Fiber 本身不提供结构化并发。你需要自己实现作用域管理或依赖框架（如 Amp v3）：

```php
<?php
// 使用 Amp v3 框架实现类似结构化并发
use Amp\Future;
use function Amp\async;

function loadDashboard(): Dashboard {
    // 并发执行三个异步任务
    $userFuture = async(fn() => fetchUser('u123'));
    $ordersFuture = async(fn() => fetchOrders('u123'));
    $notificationsFuture = async(fn() => fetchNotifications('u123'));

    // 等待所有结果（类似 coroutineScope）
    return new Dashboard(
        user: $userFuture->await(),
        orders: $ordersFuture->await(),
        notifications: $notificationsFuture->await(),
    );
}
```

Amp v3 基于 Fiber 构建了 `Future` 抽象，提供了类似 `coroutineScope` 的语义。但这是框架层面的实现，语言本身不保证结构化。

---

## 四、Flow 与响应式流

### 4.1 Kotlin Flow

Flow 是 Kotlin 的冷流（cold stream）类型，类似于 RxJava 的 Observable，但基于协程构建，API 更简洁：

```kotlin
fun fetchUserUpdates(userId: String): Flow<UserUpdate> = flow {
    while (true) {
        val update = api.fetchLatestUpdate(userId)
        emit(update)
        delay(5000) // 每 5 秒轮询
    }
}

// 使用
fun main() = runBlocking {
    fetchUserUpdates("u123")
        .filter { it.isImportant }
        .map { it.toNotification() }
        .take(10) // 只取前 10 个
        .collect { notification ->
            println("Notification: ${notification.title}")
        }
}
```

Flow 的关键特性：
- **冷流**：只有在 `collect` 时才开始执行。
- **背压支持**：通过挂起机制自然实现背压。
- **取消感知**：Flow 的收集器被取消时自动停止发射。
- **操作符丰富**：`map`、`filter`、`combine`、`flatMapMerge` 等。

```kotlin
// StateFlow 和 SharedFlow —— 热流
class UserViewModel(private val repository: UserRepository) {
    private val _state = MutableStateFlow(UserUiState.Loading)
    val state: StateFlow<UserUiState> = _state.asStateFlow()

    fun loadUser(id: String) {
        viewModelScope.launch {
            _state.value = UserUiState.Loading
            try {
                val user = repository.fetchUser(id)
                _state.value = UserUiState.Success(user)
            } catch (e: Exception) {
                _state.value = UserUiState.Error(e.message)
            }
        }
    }
}
```

### 4.2 Go 的等价物：Channel + Goroutine

Go 没有内置的 Flow 类型，但可以通过 channel 和 goroutine 实现类似的流式处理：

```go
func fetchUserUpdates(ctx context.Context, userId string) <-chan UserUpdate {
    ch := make(chan UserUpdate)

    go func() {
        defer close(ch)
        for {
            select {
            case <-ctx.Done():
                return
            default:
                update := apiFetchLatestUpdate(ctx, userId)
                select {
                case ch <- update:
                case <-ctx.Done():
                    return
                }
                time.Sleep(5 * time.Second)
            }
        }
    }()

    return ch
}

// 使用
func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
    defer cancel()

    count := 0
    for update := range fetchUserUpdates(ctx, "u123") {
        if update.IsImportant {
            fmt.Printf("Notification: %s\n", update.Title)
            count++
            if count >= 10 {
                break
            }
        }
    }
}
```

Go 的 channel 天然支持背压（无缓冲 channel 会阻塞生产者），但缺乏 Flow 提供的丰富操作符。Go 开发者通常需要借助第三方库（如 `go-streams`）或手动实现 `map`、`filter` 等操作。

### 4.3 PHP 的流处理

PHP Fiber 不提供流式 API，但 Amp v3 和 ReactPHP 提供了 Observable 或 AsyncGenerator：

```php
<?php
// 使用 AsyncGenerator 模拟 Flow
use Amp\AsyncGenerator;

function fetchUserUpdates(string $userId): AsyncGenerator {
    return new AsyncGenerator(function () use ($userId) {
        while (true) {
            $update = apiFetchLatestUpdate($userId);
            yield $update;
            Amp\delay(5000);
        }
    });
}

// 使用
Amp\Loop::run(function () {
    $count = 0;
    foreach (fetchUserUpdates('u123') as $update) {
        if ($update->isImportant) {
            echo "Notification: {$update->title}\n";
            $count++;
            if ($count >= 10) {
                break;
            }
        }
    }
});
```

---

## 五、Channel 与通信机制

### 5.1 Kotlin Channel

Channel 是 Kotlin 协程之间通信的桥梁，类似于 Go 的 channel：

```kotlin
suspend fun producer(channel: Channel<Int>) {
    for (i in 1..10) {
        delay(100)
        channel.send(i)
        println("Sent: $i")
    }
    channel.close()
}

suspend fun consumer(channel: Channel<Int>) {
    for (value in channel) {
        delay(200) // 消费慢于生产
        println("Received: $value")
    }
}

fun main() = runBlocking {
    val channel = Channel<Int>(capacity = 5) // 有缓冲的 channel
    launch { producer(channel) }
    launch { consumer(channel) }
}
```

Kotlin Channel 的类型：

```kotlin
// 1. Rendezvous Channel（默认，容量 0）
val rendezvous = Channel<Int>() // 生产者和消费者必须同时就绪

// 2. Buffered Channel
val buffered = Channel<Int>(capacity = 64)

// 3. Conflated Channel —— 只保留最新值
val conflated = Channel<Int>(Channel.CONFLATED)

// 4. Unlimited Channel —— 无限制缓冲（慎用）
val unlimited = Channel<Int>(Channel.UNLIMITED)
```

### 5.2 Go Channel

Go 的 channel 是语言级的一等公民：

```go
func producer(ch chan<- int) {
    for i := 1; i <= 10; i++ {
        time.Sleep(100 * time.Millisecond)
        ch <- i
        fmt.Printf("Sent: %d\n", i)
    }
    close(ch)
}

func consumer(ch <-chan int) {
    for v := range ch {
        time.Sleep(200 * time.Millisecond)
        fmt.Printf("Received: %d\n", v)
    }
}

func main() {
    ch := make(chan int, 5) // 带缓冲的 channel
    go producer(ch)
    consumer(ch)
}
```

Go 的 `select` 语句是 channel 操作的一大亮点：

```go
select {
case msg := <-ch1:
    fmt.Println("From ch1:", msg)
case msg := <-ch2:
    fmt.Println("From ch2:", msg)
case <-time.After(3 * time.Second):
    fmt.Println("Timeout!")
case <-ctx.Done():
    fmt.Println("Cancelled")
}
```

Kotlin 也有类似的 select：

```kotlin
select<Unit> {
    ch1.onReceive { msg -> println("From ch1: $msg") }
    ch2.onReceive { msg -> println("From ch2: $msg") }
    onTimeout(3000) { println("Timeout!") }
}
```

---

## 六、异常处理

### 6.1 Kotlin 协程异常处理

Kotlin 协程的异常处理是三种模型中最完善的：

```kotlin
fun main() = runBlocking {
    // 1. launch 中的异常会传播到父协程
    val job = launch {
        throw RuntimeException("boom!")
    }

    // 2. async 中的异常在 await() 时抛出
    val deferred = async {
        throw RuntimeException("async boom!")
    }
    try {
        deferred.await()
    } catch (e: Exception) {
        println("Caught: ${e.message}")
    }

    // 3. CoroutineExceptionHandler —— 全局兜底
    val handler = CoroutineExceptionHandler { _, exception ->
        println("Unhandled: ${exception.message}")
    }

    val scope = CoroutineScope(SupervisorJob() + handler)
    scope.launch {
        throw RuntimeException("supervised child fails")
        // 其他兄弟协程不受影响
    }
}
```

**SupervisorJob** 是关键——它改变了异常传播策略：

```kotlin
// 普通 Job：一个子协程失败 → 取消所有兄弟协程
val scope = CoroutineScope(Job())
scope.launch { throw Exception("A fails") }
scope.launch { delay(1000); println("B never runs") } // 被取消

// SupervisorJob：一个子协程失败 → 兄弟协程不受影响
val supervisorScope = CoroutineScope(SupervisorJob())
supervisorScope.launch { throw Exception("A fails") }
supervisorScope.launch { delay(1000); println("B still runs!") } // 正常执行
```

### 6.2 Go 异常处理

Go 没有异常机制，使用返回值传递错误：

```go
func fetchData(ctx context.Context) (string, error) {
    select {
    case <-ctx.Done():
        return "", ctx.Err()
    default:
    }

    resp, err := http.GetWithContext(ctx, "https://api.example.com/data")
    if err != nil {
        return "", fmt.Errorf("fetch failed: %w", err) // 错误包装
    }
    defer resp.Body.Close()

    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return "", fmt.Errorf("read body: %w", err)
    }

    return string(body), nil
}

// goroutine 中的 panic 需要 recover
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("recovered panic: %v", r)
        }
    }()
    // 可能 panic 的代码
}()
```

Go 的 `recover` 只能捕获当前 goroutine 的 panic。一个未被 recover 的 panic 会导致整个程序崩溃。这是一个重要的设计区别——Kotlin 协程的异常默认被 CoroutineExceptionHandler 处理，而 Go 中需要显式地在每个 goroutine 中 defer recover。

### 6.3 PHP 异常处理

PHP Fiber 的异常处理相对简单：

```php
<?php
$fiber = new Fiber(function (): void {
    throw new RuntimeException("Something went wrong");
});

try {
    $fiber->start();
} catch (RuntimeException $e) {
    echo "Caught: " . $e->getMessage() . "\n";
}

// 也可以通过 Fiber::throw() 注入异常
$fiber2 = new Fiber(function (): void {
    try {
        $value = Fiber::suspend('waiting');
    } catch (RuntimeException $e) {
        echo "Fiber caught: " . $e->getMessage() . "\n";
    }
});

$fiber2->start();
$fiber2->throw(new RuntimeException("injected error"));
```

PHP Fiber 没有类似 Kotlin 的 SupervisorJob 或取消传播机制。在大规模并发场景下，开发者需要自行实现错误处理和资源清理逻辑。

---

## 七、Dispatcher 与调度策略

### 7.1 Kotlin Dispatchers

Kotlin 通过 Dispatcher 控制协程在哪个线程（池）上执行：

```kotlin
fun main() = runBlocking {
    // Dispatchers.Default —— CPU 密集型任务
    launch(Dispatchers.Default) {
        // 使用共享线程池，线程数 = CPU 核心数
        heavyComputation()
    }

    // Dispatchers.IO —— I/O 密集型任务
    launch(Dispatchers.IO) {
        // 使用弹性线程池，最多 64 个线程
        val data = readFileFromDisk()
    }

    // Dispatchers.Main —— UI 线程（Android/JVM with UI 框架）
    launch(Dispatchers.Main) {
        updateUI()
    }

    // 自定义 Dispatcher
    val myDispatcher = newSingleThreadContext("MyThread")
    launch(myDispatcher) {
        println("Running on: ${Thread.currentThread().name}")
    }

    // 协程内部切换 Dispatcher
    launch(Dispatchers.Default) {
        val result = heavyComputation()
        withContext(Dispatchers.IO) {
            saveToDatabase(result)
        }
    }
}
```

`withContext` 是 Kotlin 协程中切换上下文的惯用方式，它不会创建新的协程，只是在当前协程中切换执行线程：

```kotlin
suspend fun fetchAndSave() {
    val data = withContext(Dispatchers.IO) {
        httpClient.get("https://api.example.com/data")
    }
    val processed = withContext(Dispatchers.Default) {
        processData(data)
    }
    withContext(Dispatchers.IO) {
        database.save(processed)
    }
}
```

### 7.2 Go 的 GMP 调度模型

Go 使用 GMP（Goroutine-Machine-Processor）模型进行调度：

- **G (Goroutine)**：用户级线程
- **M (Machine)**：操作系统线程
- **P (Processor)**：逻辑处理器，维护本地运行队列

Go 开发者通常不需要关心调度细节，但可以通过以下方式影响行为：

```go
// 设置逻辑处理器数量（默认为 CPU 核心数）
runtime.GOMAXPROCS(4)

// 让出当前 goroutine 的执行权
runtime.Gosched()

// 锁定 goroutine 到当前 OS 线程（用于 CGO 等场景）
runtime.LockOSThread()
defer runtime.UnlockOSThread()
```

Go 的调度器会自动在系统调用、函数调用等时机检查点进行抢占。从 Go 1.14 开始，Go 引入了基于信号的异步抢占，解决了长时间计算的 goroutine 饿死其他 goroutine 的问题。

### 7.3 PHP 的调度

PHP 是单线程的，没有 Dispatcher 概念。Fiber 的调度完全是协作式的——只有在显式调用 `Fiber::suspend()` 时才会切换：

```php
<?php
// PHP 没有 Dispatcher，Fiber 调度完全由事件循环控制
// 典型的事件循环实现（简化版）
class SimpleEventLoop {
    private array $fibers = [];
    private array $timers = [];

    public function addFiber(Fiber $fiber): void {
        $this->fibers[] = $fiber;
    }

    public function run(): void {
        while (!empty($this->fibers) || !empty($this->timers)) {
            foreach ($this->fibers as $i => $fiber) {
                if ($fiber->isSuspended()) {
                    $fiber->resume();
                }
                if ($fiber->isTerminated()) {
                    unset($this->fibers[$i]);
                }
            }
            // 处理定时器...
        }
    }
}
```

---

## 八、并发原语与模式

### 8.1 Semaphore（信号量）

**Kotlin：**
```kotlin
val semaphore = Semaphore(permits = 3)

suspend fun limitedAccess(id: Int) {
    semaphore.withPermit {
        println("Task $id entering (available: ${semaphore.availablePermits})")
        delay(1000)
        println("Task $id leaving")
    }
}

fun main() = runBlocking {
    (1..10).map { i ->
        launch { limitedAccess(i) }
    }.joinAll()
}
```

**Go：**
```go
func main() {
    sem := make(chan struct{}, 3) // 用 buffered channel 模拟信号量
    var wg sync.WaitGroup

    for i := 1; i <= 10; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            sem <- struct{}{} // 获取许可
            defer func() { <-sem }() // 释放许可

            fmt.Printf("Task %d entering\n", id)
            time.Sleep(1 * time.Second)
            fmt.Printf("Task %d leaving\n", id)
        }(i)
    }
    wg.Wait()
}
```

**PHP：**
```php
<?php
// 使用 Amp v3 的 Semaphore
use Amp\Sync\Semaphore;

$semaphore = new Semaphore(3);

$tasks = [];
for ($i = 1; $i <= 10; $i++) {
    $tasks[] = async(function () use ($semaphore, $i) {
        $semaphore->acquire();
        try {
            echo "Task $i entering\n";
            delay(1000);
            echo "Task $i leaving\n";
        } finally {
            $semaphore->release();
        }
    });
}

awaitAll($tasks);
```

### 8.2 Mutex（互斥锁）

**Kotlin：**
```kotlin
val mutex = Mutex()
var counter = 0

fun main() = runBlocking {
    (1..1000).map {
        launch {
            repeat(1000) {
                mutex.withLock {
                    counter++
                }
            }
        }
    }.joinAll()
    println("Counter: $counter") // 1000000
}
```

**Go：**
```go
func main() {
    var mu sync.Mutex
    var counter int64
    var wg sync.WaitGroup

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1000; j++ {
                mu.Lock()
                counter++
                mu.Unlock()
            }
        }()
    }
    wg.Wait()
    fmt.Printf("Counter: %d\n", counter) // 1000000
}
```

### 8.3 选择模式（Select/Race）

**Kotlin：**
```kotlin
fun main() = runBlocking {
    val ch1 = Channel<String>()
    val ch2 = Channel<String>()

    launch {
        delay(1000)
        ch1.send("from ch1")
    }
    launch {
        delay(500)
        ch2.send("from ch2")
    }

    // 竞争接收
    val result = select<String> {
        ch1.onReceive { it }
        ch2.onReceive { it }
    }
    println("First result: $result") // "from ch2"
}
```

**Go：**
```go
func main() {
    ch1 := make(chan string, 1)
    ch2 := make(chan string, 1)

    go func() {
        time.Sleep(1 * time.Second)
        ch1 <- "from ch1"
    }()
    go func() {
        time.Sleep(500 * time.Millisecond)
        ch2 <- "from ch2"
    }()

    select {
    case msg := <-ch1:
        fmt.Println("First result:", msg)
    case msg := <-ch2:
        fmt.Println("First result:", msg)
    }
    // "First result: from ch2"
}
```

---

## 九、实际应用场景对比

### 9.1 HTTP 并发请求

这是一个非常常见的场景：并发调用多个 API 并聚合结果。

**Kotlin（使用 Ktor Client）：**
```kotlin
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.request.*
import kotlinx.coroutines.*
import kotlin.system.measureTimeMillis

val client = HttpClient(CIO)

suspend fun fetchPrice(exchange: String): Double {
    return client.get("https://api.$exchange.com/price") {
        parameter("symbol", "BTC-USD")
    }.body()
}

fun main() = runBlocking {
    val exchanges = listOf("binance", "coinbase", "kraken", "bitfinex", "okx")

    val time = measureTimeMillis {
        val prices = exchanges.map { exchange ->
            async(Dispatchers.IO) {
                try {
                    fetchPrice(exchange)
                } catch (e: Exception) {
                    println("$exchange failed: ${e.message}")
                    null
                }
            }
        }.awaitAll().filterNotNull()

        println("Average price: ${prices.average()}")
    }
    println("Took: ${time}ms") // 远小于顺序执行的时间
}
```

**Go：**
```go
func fetchPrice(ctx context.Context, exchange string) (float64, error) {
    url := fmt.Sprintf("https://api.%s.com/price?symbol=BTC-USD", exchange)
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return 0, err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return 0, err
    }
    defer resp.Body.Close()
    var result struct{ Price float64 }
    json.NewDecoder(resp.Body).Decode(&result)
    return result.Price, nil
}

func main() {
    exchanges := []string{"binance", "coinbase", "kraken", "bitfinex", "okx"}
    start := time.Now()

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)
    prices := make([]float64, len(exchanges))

    for i, exchange := range exchanges {
        i, exchange := i, exchange
        g.Go(func() error {
            price, err := fetchPrice(ctx, exchange)
            if err != nil {
                log.Printf("%s failed: %v", exchange, err)
                return nil // 不终止其他请求
            }
            prices[i] = price
            return nil
        })
    }

    g.Wait()
    // 计算平均值...
    fmt.Printf("Took: %v\n", time.Since(start))
}
```

**PHP（使用 Amp v3）：**
```php
<?php
use Amp\Http\Client\HttpClientBuilder;
use function Amp\async;
use function Amp\Future\awaitAll;

$client = HttpClientBuilder::buildDefault();

function fetchPrice(string $exchange): ?float {
    global $client;
    try {
        $response = $client->request(
            new \Amp\Http\Client\Request("https://api.$exchange.com/price?symbol=BTC-USD")
        );
        $data = json_decode($response->getBody()->toString(), true);
        return $data['price'] ?? null;
    } catch (\Throwable $e) {
        echo "$exchange failed: {$e->getMessage()}\n";
        return null;
    }
}

$exchanges = ['binance', 'coinbase', 'kraken', 'bitfinex', 'okx'];
$start = microtime(true);

$futures = [];
foreach ($exchanges as $exchange) {
    $futures[] = async(fn() => fetchPrice($exchange));
}

$results = awaitAll($futures);
$prices = array_filter($results, fn($p) => $p !== null);
echo "Average price: " . (array_sum($prices) / count($prices)) . "\n";
echo "Took: " . round((microtime(true) - $start) * 1000) . "ms\n";
```

### 9.2 生产者-消费者模式

**Kotlin：**
```kotlin
fun main() = runBlocking {
    val channel = Channel<Int>(capacity = 10)

    // 多个生产者
    repeat(3) { id ->
        launch {
            for (i in 1..20) {
                delay((50..200).random().toLong())
                channel.send(id * 100 + i)
                println("Producer $id sent: ${id * 100 + i}")
            }
        }
    }

    // 多个消费者
    repeat(2) { id ->
        launch {
            for (value in channel) {
                delay((100..300).random().toLong())
                println("Consumer $id processed: $value")
            }
        }
    }

    delay(5000) // 运行 5 秒
    channel.close()
}
```

**Go：**
```go
func main() {
    ch := make(chan int, 10)

    // 多个生产者
    for id := 0; id < 3; id++ {
        go func(id int) {
            for i := 1; i <= 20; i++ {
                time.Sleep(time.Duration(50+rand.Intn(150)) * time.Millisecond)
                val := id*100 + i
                ch <- val
                fmt.Printf("Producer %d sent: %d\n", id, val)
            }
        }(id)
    }

    // 多个消费者
    for id := 0; id < 2; id++ {
        go func(id int) {
            for val := range ch {
                time.Sleep(time.Duration(100+rand.Intn(200)) * time.Millisecond)
                fmt.Printf("Consumer %d processed: %d\n", id, val)
            }
        }(id)
    }

    time.Sleep(5 * time.Second)
    close(ch)
}
```

---

## 十、性能基准测试与内存对比

### 10.1 创建大量并发单元

我们比较创建 10 万个并发单元的内存消耗和启动时间：

**Kotlin 基准测试：**
```kotlin
fun main() = runBlocking {
    val startMemory = Runtime.getRuntime().let { it.totalMemory() - it.freeMemory() }
    val startTime = System.nanoTime()

    val jobs = (1..100_000).map { i ->
        launch {
            delay(Long.MAX_VALUE) // 保持存活
        }
    }

    val elapsed = (System.nanoTime() - startTime) / 1_000_000
    val endMemory = Runtime.getRuntime().let { it.totalMemory() - it.freeMemory() }
    val memoryPerCoroutine = (endMemory - startMemory) / 100_000

    println("Created 100K coroutines in ${elapsed}ms")
    println("Memory per coroutine: ~${memoryPerCoroutine} bytes")

    jobs.forEach { it.cancel() }
}
// 典型结果：创建时间 < 500ms，每个协程约 200-400 字节
```

**Go 基准测试：**
```go
func main() {
    var m1 runtime.MemStats
    runtime.ReadMemStats(&m1)
    start := time.Now()

    done := make(chan struct{})
    for i := 0; i < 100000; i++ {
        go func() {
            <-done // 保持存活
        }()
    }

    elapsed := time.Since(start)
    var m2 runtime.MemStats
    runtime.ReadMemStats(&m2)
    memPerGoroutine := (m2.Sys - m1.Sys) / 100000

    fmt.Printf("Created 100K goroutines in %v\n", elapsed)
    fmt.Printf("Memory per goroutine: ~%d bytes\n", memPerGoroutine)
    close(done)
}
// 典型结果：创建时间 < 100ms，每个 goroutine 约 2-8KB
```

**PHP 基准测试：**
```php
<?php
$memBefore = memory_get_usage(true);
$start = microtime(true);

$fibers = [];
for ($i = 0; $i < 100000; $i++) {
    $fiber = new Fiber(function () {
        Fiber::suspend();
    });
    $fiber->start();
    $fibers[] = $fiber;
}

$elapsed = (microtime(true) - $start) * 1000;
$memAfter = memory_get_usage(true);
$memPerFiber = ($memAfter - $memBefore) / 100000;

echo "Created 100K fibers in {$elapsed}ms\n";
echo "Memory per fiber: ~{$memPerFiber} bytes\n";

// PHP 的内存消耗显著更高，通常每个 Fiber 约 1-2KB+，
// 且创建 10 万个 Fiber 可能导致内存问题
```

### 10.2 性能对比总结

| 指标 | Kotlin Coroutines | Go goroutine | PHP Fiber |
|------|------------------|--------------|-----------|
| 创建延迟 | ~几微秒 | ~0.3微秒 | ~几微秒 |
| 内存开销 | ~200-400 bytes | ~2-8 KB | ~1-2 KB+ |
| 最大并发数（推荐） | 数十万 | 数百万 | 数万 |
| 调度开销 | 极低 | 极低 | 低 |
| 上下文切换 | 用户态 | 用户态 | 用户态 |
| GC 压力 | 中等（JVM GC） | 低（GC 优化） | 高（PHP GC） |

**关键观察：**

1. **Go goroutine 创建成本最低**，但每个 goroutine 的初始栈较大（2KB，可增长）。Go 的运行时调度器经过高度优化，能高效管理数百万 goroutine。

2. **Kotlin 协程的内存开销最小**，因为它们本质上是编译器生成的状态机对象。但受限于 JVM 的线程模型和 GC 特性，在极端高并发场景下可能不如 Go。

3. **PHP Fiber 的性能最差**，主要受限于 PHP 解释器的性能和内存管理。但对于典型的 Web 应用场景（几千并发），完全可以胜任。

### 10.3 吞吐量基准

以下是一个模拟 Web 服务器处理并发请求的基准测试：

```
场景：1000 个并发客户端，每个发送 100 个请求

Kotlin + Ktor:     ~150,000 req/s (单机)
Go + net/http:     ~180,000 req/s (单机)
PHP + AMPHP v3:    ~30,000 req/s  (单机)

（数据为参考值，实际取决于具体场景和硬件配置）
```

Go 在原始吞吐量方面通常领先，因为它的运行时开销最低，GC 延迟最可控。Kotlin 的性能与 Go 接近，特别是在长期运行的服务中，JIT 编译能显著提升性能。PHP 的差距主要来自解释器开销。

---

## 十一、高级话题

### 11.1 协程与线程的关系

**Kotlin：** 协程运行在线程之上，通过 Dispatchers 映射到线程池。

```kotlin
// 查看协程运行的线程
fun main() = runBlocking {
    launch(Dispatchers.Default) {
        println("Default: ${Thread.currentThread().name}")
    }
    launch(Dispatchers.IO) {
        println("IO: ${Thread.currentThread().name}")
    }
    launch(newSingleThreadContext("MyThread")) {
        println("Custom: ${Thread.currentThread().name}")
    }
}
// 输出：
// Default: DefaultDispatcher-worker-1
// IO: DefaultDispatcher-worker-2
// Custom: MyThread
```

**Go：** goroutine 由 Go 运行时调度到 OS 线程上，开发者通常不直接控制。

```go
func main() {
    runtime.GOMAXPROCS(4) // 最多使用 4 个 OS 线程
    for i := 0; i < 10; i++ {
        go func(id int) {
            fmt.Printf("Goroutine %d on OS thread %d\n", id, getGID())
        }(i)
    }
    time.Sleep(time.Second)
}
```

**PHP：** 单线程模型，所有 Fiber 在同一个线程中协作调度。

### 11.2 取消与超时

**Kotlin 的取消机制：**
```kotlin
fun main() = runBlocking {
    val job = launch {
        try {
            repeat(1000) { i ->
                println("Working: $i")
                delay(500) // 取消检查点
            }
        } catch (e: CancellationException) {
            println("Cancelled!")
        } finally {
            println("Cleaning up...")
            // 注意：此处不应调用挂起函数（除非使用 withContext(NonCancellable)）
            withContext(NonCancellable) {
                delay(100) // 在 NonCancellable 上下文中可以安全挂起
                println("Cleanup done")
            }
        }
    }

    delay(2000)
    job.cancelAndStop()
    println("Main: done")
}
```

**Kotlin 超时：**
```kotlin
fun main() = runBlocking {
    try {
        withTimeout(3000) {
            repeat(100) { i ->
                delay(500)
                println("Step $i")
            }
        }
    } catch (e: TimeoutCancellationException) {
        println("Timed out!")
    }
}
```

**Go 的取消与超时：**
```go
func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    go worker(ctx)
    <-ctx.Done()
    fmt.Println("Timed out or cancelled:", ctx.Err())
}

func worker(ctx context.Context) {
    for i := 0; ; i++ {
        select {
        case <-ctx.Done():
            fmt.Printf("Worker cancelled at step %d\n", i)
            return
        case <-time.After(500 * time.Millisecond):
            fmt.Printf("Step %d\n", i)
        }
    }
}
```

**PHP 的超时处理：**
```php
<?php
// PHP Fiber 没有原生取消/超时机制
// 需要自行实现或使用框架

$fiber = new Fiber(function () {
    for ($i = 0; $i < 100; $i++) {
        // 检查是否应该取消
        if (Fiber::suspend($i) === 'cancel') {
            echo "Cancelled at step $i\n";
            return;
        }
        usleep(500000); // 500ms
    }
});

$result = $fiber->start();
$start = time();
while (!$fiber->isTerminated()) {
    if (time() - $start >= 3) {
        echo "Timeout!\n";
        $fiber->resume('cancel');
        break;
    }
    $result = $fiber->resume();
}
```

### 11.3 热流与状态管理

**Kotlin StateFlow/SharedFlow：**
```kotlin
class StockPriceViewModel {
    private val _prices = MutableStateFlow<Map<String, Double>>(emptyMap())
    val prices: StateFlow<Map<String, Double>> = _prices.asStateFlow()

    private val _events = MutableSharedFlow<StockEvent>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val events: SharedFlow<StockEvent> = _events.asSharedFlow()

    init {
        // 启动价格更新流
        viewModelScope.launch {
            stockRepository.observePrices()
                .collect { newPrices ->
                    _prices.update { current -> current + newPrices }
                }
        }
    }

    suspend fun onStockPurchased(symbol: String, quantity: Int) {
        _events.emit(StockEvent.Purchased(symbol, quantity))
    }
}

// UI 层收集
@Composable
fun StockScreen(viewModel: StockPriceViewModel) {
    val prices by viewModel.prices.collectAsState()
    // 自动响应状态变化
    StockPriceList(prices)
}
```

---

## 十二、生态与工具链

### 12.1 Kotlin 协程生态

Kotlin 协程拥有丰富的生态支持：

- **Ktor**：协程原生的 HTTP 客户端和服务端框架
- **Room / Exposed**：数据库访问层对协程的支持
- **Retrofit**：支持 `suspend` 函数的 HTTP 客户端
- **Spring WebFlux**：Spring 对 Kotlin 协程的一流支持
- **Compose**：Jetpack Compose 与 StateFlow 深度集成

```kotlin
// Ktor 服务端示例
fun Application.module() {
    routing {
        get("/users/{id}") {
            val id = call.parameters["id"]!!
            val user = withContext(Dispatchers.IO) {
                userRepository.findById(id)
            }
            call.respond(user)
        }

        // WebSocket
        webSocket("/ws") {
            val stockUpdates = stockService.streamUpdates()
            stockUpdates.collect { update ->
                send(Frame.Text(Json.encodeToString(update)))
            }
        }
    }
}
```

### 12.2 Go 并发生态

- **net/http**：标准库 HTTP 服务器，每个请求一个 goroutine
- **gRPC-Go**：支持并发流处理
- **GORM / sqlx**：数据库操作
- **gorilla/websocket**：WebSocket 支持
- **errgroup**：并发错误处理

```go
// Go 标准库 HTTP 服务器
func main() {
    http.HandleFunc("/users/", func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        id := strings.TrimPrefix(r.URL.Path, "/users/")

        g, ctx := errgroup.WithContext(ctx)
        var user User
        var orders []Order

        g.Go(func() error {
            var err error
            user, err = fetchUser(ctx, id)
            return err
        })
        g.Go(func() error {
            var err error
            orders, err = fetchOrders(ctx, id)
            return err
        })

        if err := g.Wait(); err != nil {
            http.Error(w, err.Error(), 500)
            return
        }
        json.NewEncoder(w).Encode(map[string]any{"user": user, "orders": orders})
    })
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

### 12.3 PHP 并发生态

- **Amp v3**：基于 Fiber 的异步框架
- **ReactPHP**：事件驱动的异步 I/O 框架
- **Swoole**：PHP 扩展，提供协程和异步 I/O
- **RoadRunner**：高性能 PHP 应用服务器

```php
<?php
// Amp v3 HTTP 服务器
use Amp\Http\Server\RequestHandler\CallableRequestHandler;
use Amp\Http\Server\HttpServer;
use Amp\Http\Server\Response;
use Amp\Http\Status;
use Amp\Socket\SocketServer;

$sockets = SocketServer::listen("0.0.0.0:8080");
$server = new HttpServer($sockets, new CallableRequestHandler(
    function ($request) {
        $id = trim($request->getUri()->getPath(), '/users/');

        // 并发获取数据
        $userFuture = async(fn() => fetchUser($id));
        $ordersFuture = async(fn() => fetchOrders($id));

        return new Response(Status::OK, [
            'content-type' => 'application/json',
        ], json_encode([
            'user' => $userFuture->await(),
            'orders' => $ordersFuture->await(),
        ]));
    }
));

$server->start();
```

---

## 十三、选择指南

### 13.1 何时选择 Kotlin Coroutines

- **Android 开发**：协程是 Google 推荐的异步方案，与 Jetpack 深度集成。
- **Spring Boot 服务**：Spring 对 Kotlin 协程有原生支持，性能优秀。
- **需要类型安全的并发**：`suspend` 关键字在编译期强制约束。
- **复杂的数据流处理**：Flow 提供了丰富的操作符和背压支持。
- **团队熟悉 Kotlin/Java 生态**：迁移成本低。

### 13.2 何时选择 Go goroutine

- **基础设施/云原生工具**：Docker、Kubernetes 等用 Go 构建不是没有原因。
- **极高并发的网络服务**：Go 的 runtime 调度器针对网络 I/O 高度优化。
- **需要极低的延迟抖动**：Go 的 GC 经过高度优化，暂停时间可控。
- **简洁的并发模型**：Go 的并发原语简单直观，学习曲线较低。
- **跨平台编译**：Go 编译为单一二进制文件，部署简单。

### 13.3 何时选择 PHP Fiber

- **现有 PHP 项目的渐进升级**：不需要重写，可以逐步引入异步。
- **Web 后端 API**：PHP 的 Web 生态成熟，Fiber 可以提升 I/O 并发能力。
- **团队熟悉 PHP 生态**：学习成本最低。
- **与现有 PHP 框架集成**：Laravel、Symfony 等开始支持 Fiber。
- **不需要极高并发**：对于中小规模应用完全足够。

### 13.4 决策矩阵

| 需求 | 推荐方案 | 理由 |
|------|---------|------|
| Android 客户端 | Kotlin Coroutines | 平台原生支持 |
| 高并发网关/代理 | Go goroutine | 性能最优 |
| 企业级 API 服务 | Kotlin/Go | 生态成熟 |
| 快速原型/脚本 | Go 或 PHP | 开发效率 |
| 现有 PHP 项目优化 | PHP Fiber | 最小迁移成本 |
| 实时数据流处理 | Kotlin Flow | 最佳流操作符 |
| 微服务架构 | Go 或 Kotlin | 两者都适合 |
| CPU 密集型计算 | Go | 更好的多核利用 |

---

## 十四、未来趋势

### 14.1 Kotlin 协程的演进

Kotlin 协程持续演进，关注方向包括：

- **K2 编译器优化**：更高效的协程字节码生成。
- **多平台协程**：Kotlin Multiplatform 的协程支持持续完善。
- **新的操作符**：Flow API 不断丰富，如 `stateIn`、`shareIn` 的优化。
- **与虚拟线程集成**：Project Loom 的虚拟线程可能影响 Kotlin 协程的 Dispatcher 实现。

### 14.2 Go 的持续优化

- **Go 1.22+ 的 range-over-func**：新的迭代器模式，简化流处理。
- **调度器持续优化**：更低的调度延迟和更好的 NUMA 感知。
- **GC 改进**：亚毫秒级的 GC 暂停时间。

### 14.3 PHP 的并发未来

- **PHP Fiber 的增强**：社区讨论添加取消、超时等原生支持。
- **Swoole/OpenSwoole**：提供更完整的协程体验。
- **AMPHP v4**：可能引入更高级的并发抽象。

---

## 十五、实战：构建一个并发爬虫

最后，我们通过一个完整的实战案例——并发网页爬虫——展示三种语言的并发模型在真实场景中的表现。

### 15.1 Kotlin 版本

```kotlin
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*

class WebCrawler(
    private val maxConcurrency: Int = 10,
    private val maxDepth: Int = 3
) {
    private val client = HttpClient()
    private val visited = ConcurrentHashMap.newKeySet<String>()
    private val semaphore = Semaphore(maxConcurrency)

    suspend fun crawl(startUrl: String): List<Page> = coroutineScope {
        val results = Channel<Page>(Channel.UNLIMITED)

        fun crawlUrl(url: String, depth: Int) {
            if (depth > maxDepth || !visited.add(url)) return

            launch {
                semaphore.withPermit {
                    try {
                        val html = client.get(url).bodyAsText()
                        val links = extractLinks(html, url)
                        val page = Page(url, html.length, links.size)
                        results.send(page)

                        // 递归爬取子链接
                        links.forEach { link ->
                            launch { crawlUrl(link, depth + 1) }
                        }
                    } catch (e: Exception) {
                        println("Error crawling $url: ${e.message}")
                    }
                }
            }
        }

        launch { crawlUrl(startUrl, 0) }

        // 等待足够时间收集结果
        delay(60_000)
        results.close()

        results.toList()
    }
}

data class Page(val url: String, val size: Int, val links: Int)
```

### 15.2 Go 版本

```go
type Page struct {
    URL   string
    Size  int
    Links int
}

type WebCrawler struct {
    maxConcurrency int
    maxDepth       int
    client         *http.Client
    visited        sync.Map
    sem            chan struct{}
    results        []Page
    mu             sync.Mutex
}

func NewWebCrawler(maxConcurrency, maxDepth int) *WebCrawler {
    return &WebCrawler{
        maxConcurrency: maxConcurrency,
        maxDepth:       maxDepth,
        client:         &http.Client{Timeout: 10 * time.Second},
        sem:            make(chan struct{}, maxConcurrency),
    }
}

func (c *WebCrawler) Crawl(ctx context.Context, startURL string) []Page {
    var wg sync.WaitGroup
    wg.Add(1)
    go c.crawlURL(ctx, startURL, 0, &wg)

    // 设置全局超时
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()

    select {
    case <-done:
    case <-time.After(60 * time.Second):
    }

    c.mu.Lock()
    defer c.mu.Unlock()
    return c.results
}

func (c *WebCrawler) crawlURL(ctx context.Context, url string, depth int, wg *sync.WaitGroup) {
    defer wg.Done()

    if depth > c.maxDepth {
        return
    }
    if _, loaded := c.visited.LoadOrStore(url, true); loaded {
        return
    }

    c.sem <- struct{}{}        // 获取并发许可
    defer func() { <-c.sem }() // 释放许可

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return
    }
    resp, err := c.client.Do(req)
    if err != nil {
        return
    }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    links := extractLinks(string(body), url)
    page := Page{URL: url, Size: len(body), Links: len(links)}

    c.mu.Lock()
    c.results = append(c.results, page)
    c.mu.Unlock()

    for _, link := range links {
        wg.Add(1)
        go c.crawlURL(ctx, link, depth+1, wg)
    }
}
```

### 15.3 PHP 版本

```php
<?php
use Amp\Http\Client\HttpClientBuilder;
use Amp\Http\Client\Request;
use function Amp\async;
use function Amp\Future\awaitAll;

class WebCrawler {
    private int $maxConcurrency;
    private int $maxDepth;
    private HttpClient $client;
    private array $visited = [];
    private array $results = [];

    public function __construct(int $maxConcurrency = 10, int $maxDepth = 3) {
        $this->maxConcurrency = $maxConcurrency;
        $this->maxDepth = $maxDepth;
        $this->client = HttpClientBuilder::buildDefault();
    }

    public function crawl(string $startUrl): array {
        $this->crawlUrl($startUrl, 0);
        return $this->results;
    }

    private function crawlUrl(string $url, int $depth): void {
        if ($depth > $this->maxDepth || isset($this->visited[$url])) {
            return;
        }
        $this->visited[$url] = true;

        try {
            $request = new Request($url);
            $response = $this->client->request($request);
            $body = $response->getBody()->toString();
            $links = $this->extractLinks($body, $url);

            $this->results[] = new Page($url, strlen($body), count($links));

            // 并发爬取子链接
            $futures = [];
            foreach ($links as $link) {
                $futures[] = async(fn() => $this->crawlUrl($link, $depth + 1));
            }
            awaitAll($futures);
        } catch (\Throwable $e) {
            echo "Error crawling $url: {$e->getMessage()}\n";
        }
    }
}
```

这个爬虫示例展示了三种语言处理同一问题的不同方式。Kotlin 的版本最为简洁，利用 `coroutineScope` 自动管理所有子协程的生命周期；Go 版本需要手动管理 WaitGroup 和互斥锁，但代码直接且性能优秀；PHP 版本利用 Amp v3 的 `async/awaitAll` 简化了并发管理。

---

## 十六、总结

通过本文的深度对比，我们可以看到三种并发模型各有千秋：

**Kotlin Coroutines** 提供了最完善的编程模型：
- `suspend` 关键字在编译期保证安全性。
- 结构化并发防止协程泄漏。
- Flow 提供了类型安全的流处理。
- Dispatcher 灵活控制线程使用。
- 取消和超时机制内建且完善。
- 缺点是学习曲线较陡，概念较多。

**Go goroutine** 提供了最简洁高效的并发原语：
- `go` 关键字零门槛启动并发。
- GMP 调度器高度优化，调度开销极低。
- channel 作为一等公民，通信模型清晰。
- `select` 提供灵活的多路复用。
- 缺点是没有结构化并发，需要手动管理生命周期。
- 错误处理方式增加了代码冗余。

**PHP Fiber** 为 PHP 生态带来了协程能力：
- 学习成本最低，与 PHP 现有代码兼容性好。
- 作为构建高级框架的基础原语足够。
- 缺点是功能最弱，缺乏取消、超时、结构化并发等特性。
- 性能在三者中最差。
- 需要依赖第三方框架（如 Amp）才能发挥最大价值。

最终的选择应该基于：
1. **团队技术栈**——选择团队最熟悉的语言通常是最务实的决策。
2. **性能需求**——对延迟和吞吐量有极致要求时，Go 通常是首选。
3. **生态需求**——Android 开发选 Kotlin，云原生选 Go，Web 后端选 PHP 或 Kotlin。
4. **项目规模**——大型项目受益于 Kotlin 的类型安全和结构化并发。

无论选择哪种模型，理解其底层原理和设计哲学都是写出高质量并发代码的前提。希望本文能为读者在技术选型和实际开发中提供有价值的参考。

## 相关阅读

- [Data Mesh 深度实践篇：Laravel 微服务数据产品化、联邦治理与自助查询层的工程落地](/categories/架构/Data-Mesh-深度实践篇-Laravel微服务数据产品化联邦治理与自助查询层的工程落地/) — 如果你对并发在微服务数据治理场景中的应用感兴趣，Data Mesh 的联邦治理策略设计值得一读。
- [SSE vs WebSocket vs HTTP Streaming：实时通信方案工程选型](/categories/架构/2026-06-03-SSE-vs-WebSocket-vs-HTTP-Streaming-实时通信方案工程选型/) — 并发模型的选择与实时通信协议密切相关，本文提供三种方案的深度对比。
- [六边形架构实战：Laravel 端口与适配器模式落地踩坑记录](/categories/架构/2026-06-01-六边形架构实战-Laravel-端口与适配器模式落地踩坑记录/) — 并发代码的可测试性离不开良好的架构设计，六边形架构是并发隔离的最佳实践。

---

*本文代码示例基于 Kotlin 1.9+、Go 1.22+、PHP 8.2+ 编写。所有基准测试数据基于特定环境，实际表现可能因硬件和工作负载而异。*
