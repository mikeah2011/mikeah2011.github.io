# goroutine 与并发模型

## 定义

goroutine 是 Go 运行时管理的轻量级协程，初始栈仅 ~2KB（可动态增长），由 Go 调度器（M:N 调度）在 OS 线程上多路复用。channel 是 goroutine 间类型安全的通信管道，遵循 CSP（Communicating Sequential Processes）并发模型。

> "Don't communicate by sharing memory; share memory by communicating." — Go Proverbs

## 核心原理

### goroutine 基础

```go
// 启动一个 goroutine——就这么简单
go func() {
    fmt.Println("Hello from goroutine")
}()

// 带参数
go func(name string) {
    fmt.Println("Hello,", name)
}("World")
```

**goroutine vs 线程 vs PHP Fibers**：

| 维度 | goroutine | OS 线程 | PHP Fibers |
|------|-----------|---------|------------|
| 初始栈大小 | ~2KB | ~1MB | ~8KB |
| 创建开销 | 极低 | 高 | 低 |
| 调度方式 | Go 调度器（M:N） | OS 内核 | PHP 引擎协作式 |
| 并发模型 | CSP（channel 通信） | 共享内存 | 协作式挂起/恢复 |
| 适用场景 | 高并发网络服务 | CPU 密集 | IO 密集异步 |

### Channel

```go
// 无缓冲 channel（同步通信）
ch := make(chan int)

go func() {
    ch <- 42  // 发送——阻塞直到有人接收
}()
value := <-ch  // 接收——阻塞直到有人发送

// 有缓冲 channel（异步通信）
ch := make(chan string, 10)  // 缓冲区大小 10
ch <- "hello"  // 不阻塞（缓冲区未满）
ch <- "world"

// 关闭 channel
close(ch)

// range 遍历 channel（直到关闭）
for msg := range ch {
    fmt.Println(msg)
}
```

### select 多路复用

```go
select {
case msg := <-msgCh:
    fmt.Println("收到消息:", msg)
case err := <-errCh:
    fmt.Println("收到错误:", err)
case <-time.After(5 * time.Second):
    fmt.Println("超时")
default:
    fmt.Println("没有就绪的 channel")
}
```

### sync 原语

```go
// Mutex 互斥锁
var mu sync.Mutex
var counter int

func increment() {
    mu.Lock()
    defer mu.Unlock()
    counter++
}

// WaitGroup 等待一组 goroutine
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        fmt.Println("Worker", id)
    }(i)
}
wg.Wait()

// Once 只执行一次（类似 PHP 的单例初始化）
var once sync.Once
func initDB() {
    once.Do(func() {
        // 只会执行一次
        db = connect()
    })
}

// sync.Map（并发安全 map）
var m sync.Map
m.Store("key", "value")
v, ok := m.Load("key")
```

### 并发模式

**Fan-out / Fan-in**：
```go
func fanOut(input <-chan Job, workers int) []<-chan Result {
    results := make([]<-chan Result, workers)
    for i := 0; i < workers; i++ {
        results[i] = worker(input)
    }
    return results
}

func fanIn(channels ...<-chan Result) <-chan Result {
    var wg sync.WaitGroup
    merged := make(chan Result)
    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan Result) {
            defer wg.Done()
            for r := range c {
                merged <- r
            }
        }(ch)
    }
    go func() { wg.Wait(); close(merged) }()
    return merged
}
```

**Worker Pool**：
```go
func workerPool(jobs <-chan Job, results chan<- Result, workers int) {
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for job := range jobs {
                results <- process(job)
            }
        }(i)
    }
    go func() { wg.Wait(); close(results) }()
}
```

## 实战案例

来自博客文章：
- [Go for PHP Developers 实战：goroutine/channel 并发模型与 Laravel 队列的思维对比](/2026/06/01/00_架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
- [Go Context 深度实战：超时控制、取消传播与请求作用域](/2026/06/01/06_运维/Go-Context-深度实战-超时控制取消传播与请求作用域-PHP开发者的并发思维重塑/)

跨语言对比：
- [PHP 8.5 Fiber Pool 实战：对比 Go goroutine pool](/2026/06/01/05_PHP/PHP-8.5-Fiber-Pool-实战-协程池并发批量请求-对比Go-goroutine-pool的异步编程进阶/)
- [Rust + Tokio 异步运行时——对比 Go goroutine](/2026/06/01/00_架构/Rust-Tokio-异步运行时深度实战-事件循环-任务调度-背压控制-对比PHP-Fibers与Go-goroutine/)

## 相关概念

- [Go Context 机制](Go-Context机制.md) - 请求作用域的超时与取消
- [Go 语言基础](Go语言基础.md) - 函数、struct、interface
- [Go 测试体系](Go测试体系.md) - 并发测试

## 常见问题

**Q: goroutine 泄漏怎么办？**
A: 确保每个 goroutine 都有退出路径：用 Context 取消、channel 关闭、或超时机制。使用 `runtime.NumGoroutine()` 监控。

**Q: channel 和 Mutex 什么时候用哪个？**
A: channel 适合 goroutine 间通信和协调；Mutex 适合保护共享状态。Go 谚语："如果不需要传递数据，用 Mutex；如果需要传递数据或信号，用 channel。"

**Q: GOMAXPROCS 是什么？**
A: 控制同时执行 goroutine 的最大 OS 线程数。默认等于 CPU 核数。一般不需要调整。
