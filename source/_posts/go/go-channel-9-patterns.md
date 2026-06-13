---

title: Go 语言并发模式：Channel 的九种实用用法
keywords: [Go, Channel, 语言并发模式, 的九种实用用法]
date: 2026-06-09 14:13:00
categories:
  - go
cover: https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
tags:
- Go
- Channel
- 并发编程
- goroutine
description: Channel 是 Go 并发模型的核心原语，但很多开发者只停留在基本的 send/receive 用法。本文总结 9 种生产级 Channel 模式：Fan-out/Fan-in、Worker Pool、Pipeline、Timeout、Or-Done、Tee、Bridge、Semaphore 和 Done Channel，每种都附带完整可运行代码和真实场景分析。
---



Go 的并发哲学是「不要通过共享内存来通信，而要通过通信来共享内存」。Channel 就是这个哲学的核心载体。

但大多数开发者对 Channel 的认知停留在「一个 goroutine 往里塞，另一个 goroutine 往外取」。实际上，Channel 可以组合出强大的并发模式。本文总结 9 种在生产环境经过验证的用法，每种都附带完整代码。

## 1. Fan-out / Fan-in（扇出扇入）

**场景**：一个任务拆成多份并行处理，最后合并结果。

这是并发编程中最常见的模式之一。想象你有 1000 个 URL 要抓取，单线程太慢，开 10 个 goroutine 并行抓取，最后汇总结果。

```go
package main

import (
	"fmt"
	"sync"
)

func fanOut(input <-chan int, workers int) []<-chan int {
	channels := make([]<-chan int, workers)
	for i := 0; i < workers; i++ {
		channels[i] = process(input)
	}
	return channels
}

func process(input <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range input {
			// 模拟耗时操作
			out <- n * n
		}
	}()
	return out
}

func fanIn(channels ...<-chan int) <-chan int {
	var wg sync.WaitGroup
	merged := make(chan int)

	for _, ch := range channels {
		wg.Add(1)
		go func(c <-chan int) {
			defer wg.Done()
			for v := range c {
				merged <- v
			}
		}(ch)
	}

	go func() {
		wg.Wait()
		close(merged)
	}()

	return merged
}

func main() {
	// 数据源
	input := make(chan int, 10)
	go func() {
		defer close(input)
		for i := 1; i <= 20; i++ {
			input <- i
		}
	}()

	// 3 个 worker 并行处理
	channels := fanOut(input, 3)
	result := fanIn(channels...)

	for r := range result {
		fmt.Print(r, " ")
	}
	// 输出类似：1 4 9 16 25 ... 400（顺序不固定）
}
```

**关键点**：`fanIn` 用 `WaitGroup` 等待所有 channel 关闭后再关闭合并 channel，避免消费者过早退出。

## 2. Worker Pool（工作池）

**场景**：控制并发度，避免 goroutine 爆炸。

Fan-out 模式里每个任务开一个 goroutine，如果任务有 10 万个，goroutine 也 10 万个——这会吃光内存。Worker Pool 用固定数量的 goroutine 消费任务队列。

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type Job struct {
	ID   int
	Data string
}

type Result struct {
	JobID int
	Output string
}

func worker(id int, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
	defer wg.Done()
	for job := range jobs {
		fmt.Printf("Worker %d processing job %d\n", id, job.ID)
		time.Sleep(100 * time.Millisecond) // 模拟耗时
		results <- Result{
			JobID:  job.ID,
			Output: fmt.Sprintf("processed-%s", job.Data),
		}
	}
}

func main() {
	const numWorkers = 3
	const numJobs = 10

	jobs := make(chan Job, numJobs)
	results := make(chan Result, numJobs)

	var wg sync.WaitGroup

	// 启动固定数量的 worker
	for w := 1; w <= numWorkers; w++ {
		wg.Add(1)
		go worker(w, jobs, results, &wg)
	}

	// 投递任务
	for j := 1; j <= numJobs; j++ {
		jobs <- Job{ID: j, Data: fmt.Sprintf("task-%d", j)}
	}
	close(jobs)

	// 等待所有 worker 完成后关闭 results
	go func() {
		wg.Wait()
		close(results)
	}()

	// 收集结果
	for r := range results {
		fmt.Printf("Job %d done: %s\n", r.JobID, r.Output)
	}
}
```

**实际应用**：HTTP 请求池、数据库连接池消费、日志批量写入。`numWorkers` 通常设为 `runtime.NumCPU()` 或根据外部资源限制（如 API 限流）调整。

## 3. Pipeline（流水线）

**场景**：数据经过多个处理阶段，每个阶段可以并行。

流水线模式把处理逻辑拆成独立阶段，每个阶段从上游 channel 读取、处理后写入下游 channel。类似 Unix 管道 `cat file | grep error | sort | uniq`。

```go
package main

import (
	"fmt"
	"strings"
)

// 阶段1：生成数据
func generate(nums ...int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for _, n := range nums {
			out <- n
		}
	}()
	return out
}

// 阶段2：乘以2
func double(in <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range in {
			out <- n * 2
		}
	}()
	return out
}

// 阶段3：过滤大于10的
func filterGreaterThan(in <-chan int, threshold int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range in {
			if n > threshold {
				out <- n
			}
		}
	}()
	return out
}

// 阶段4：格式化输出
func format(in <-chan int) <-chan string {
	out := make(chan string)
	go func() {
		defer close(out)
		for n := range in {
			out <- fmt.Sprintf("result=%d", n)
		}
	}()
	return out
}

func main() {
	// 组装流水线：1,2,3,4,5 → double → filter >10 → format
	pipeline := format(filterGreaterThan(double(generate(1, 2, 3, 4, 5)), 10))

	for result := range pipeline {
		fmt.Println(result)
	}
	// 输出：result=12, result=14, result=10（取决于顺序）
}
```

**生产建议**：每个阶段可以启动多个 goroutine 并行处理（用 Fan-out 加速瓶颈阶段），通过带缓冲的 channel 控制上下游速率。

## 4. Timeout 模式（超时控制）

**场景**：调用外部服务，需要设置超时。

这是生产环境中必须考虑的模式。没有超时的 Channel 操作可能永远阻塞，拖垮整个服务。

```go
package main

import (
	"fmt"
	"time"
)

func slowService() <-chan string {
	out := make(chan string)
	go func() {
		time.Sleep(3 * time.Second) // 模拟慢服务
		out <- "response from service"
	}()
	return out
}

func main() {
	// 方式1：select + time.After
	select {
	case result := <-slowService():
		fmt.Println("Got:", result)
	case <-time.After(2 * time.Second):
		fmt.Println("Timeout after 2s")
	}

	// 方式2：context.WithTimeout（推荐）
	// ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	// defer cancel()
	// select {
	// case result := <-slowServiceWithContext(ctx):
	//     fmt.Println("Got:", result)
	// case <-ctx.Done():
	//     fmt.Println("Timeout:", ctx.Err())
	// }
}
```

**注意**：`time.After` 每次调用都会创建一个 timer，高频场景下有内存泄漏风险。推荐用 `context.WithTimeout`，可以复用和取消。

```go
// 高频场景下的正确做法
func callWithTimeout(timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ch := slowServiceWithContext(ctx)

	select {
	case result := <-ch:
		return result, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}
```

## 5. Or-Done Channel（中断读取）

**场景**：从 channel 读取数据，但需要在某个条件满足时停止。

典型的消费场景：从 channel 读取直到收到停止信号，或者 channel 自然关闭。

```go
package main

import (
	"fmt"
	"time"
)

func orDone(done <-chan struct{}, c <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for {
			select {
			case <-done:
				return
			case v, ok := <-c:
				if !ok {
					return
				}
				out <- v
			}
		}
	}()
	return out
}

func main() {
	done := make(chan struct{})
	data := make(chan int)

	// 生产者：每 100ms 产生一个数
	go func() {
		defer close(data)
		for i := 0; ; i++ {
			select {
			case data <- i:
			case <-done:
				return
			}
		}
	}()

	// 500ms 后发出停止信号
	go func() {
		time.Sleep(500 * time.Millisecond)
		close(done)
	}()

	// 用 orDone 安全消费
	for v := range orDone(done, data) {
		fmt.Print(v, " ")
	}
	// 输出类似：0 1 2 3 4
}
```

**价值**：封装了 `done` 信号检查，消费者不需要每次都写 `select`，代码更清晰。

## 6. Tee Channel（分流）

**场景**：一个数据流同时写入两个目的地，类似 Unix 的 `tee` 命令。

比如从数据库读取变更事件，一份写入 ElasticSearch 做搜索，一份写入 S3 做归档。

```go
package main

import "fmt"

func tee(done <-chan struct{}, in <-chan int) (<-chan int, <-chan int) {
	out1 := make(chan int)
	out2 := make(chan int)
	go func() {
		defer close(out1)
		defer close(out2)
		for v := range in {
			// 用局部变量防止无限循环
			o1, o2 := out1, out2
			for i := 0; i < 2; i++ {
				select {
				case o1 <- v:
					o1 = nil // 第一次写入后禁用
				case o2 <- v:
					o2 = nil // 第二次写入后禁用
				case <-done:
					return
				}
			}
		}
	}()
	return out1, out2
}

func main() {
	done := make(chan struct{})
	defer close(done)

	source := make(chan int, 5)
	go func() {
		defer close(source)
		for i := 0; i < 10; i++ {
			source <- i
		}
	}()

	out1, out2 := tee(done, source)

	fmt.Print("Stream 1: ")
	for v := range out1 {
		fmt.Print(v, " ")
	}
	fmt.Println()

	fmt.Print("Stream 2: ")
	for v := range out2 {
		fmt.Print(v, " ")
	}
	fmt.Println()
}
```

**实现技巧**：先把 `o1` 和 `o2` 赋值给局部变量，每次写入成功后置为 `nil`，这样 `select` 就不会再选中它。

## 7. Bridge Channel（Channel 扁平化）

**场景**：Channel 的 Channel（`<-chan <-chan T`）需要扁平化成单层 Channel。

在 pipeline 的 Fan-out 场景中，每个 worker 返回一个 channel，消费者需要统一读取所有 worker 的输出。

```go
package main

import "fmt"

// Bridge 将 <-chan <-chan int 扁平化为 <-chan int
func bridge(done <-chan struct{}, inCh <-chan <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for {
			select {
			case <-done:
				return
			case stream, ok := <-inCh:
				if !ok {
					return
				}
				// 消费当前 stream 的所有值
				for v := range stream {
					select {
					case out <- v:
					case <-done:
						return
					}
				}
			}
		}
	}()
	return out
}

func genVals() <-chan <-chan int {
	streams := make(chan (<-chan int), 3)
	for i := 0; i < 3; i++ {
		stream := make(chan int, 5)
		go func(s chan<- int, id int) {
			defer close(s)
			for j := 0; j < 5; j++ {
				s <- id*100 + j
			}
		}(stream, i)
		streams <- stream
	}
	close(streams)
	return streams
}

func main() {
	done := make(chan struct{})
	defer close(done)

	for v := range bridge(done, genVals()) {
		fmt.Print(v, " ")
	}
	// 输出所有 stream 的值（顺序不固定）
}
```

## 8. Semaphore（信号量/限流器）

**场景**：控制同时运行的 goroutine 数量，保护有限资源。

数据库连接池、API 限流、文件句柄限制都适用这个模式。用带缓冲的 channel 作为信号量，容量就是最大并发数。

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	const maxConcurrent = 3
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup

	tasks := []string{"alpha", "bravo", "charlie", "delta", "echo", "foxtrot"}

	for _, task := range tasks {
		wg.Add(1)
		sem <- struct{}{} // 获取令牌（满了就阻塞）

		go func(t string) {
			defer wg.Done()
			defer func() { <-sem }() // 释放令牌

			fmt.Printf("[%s] start\n", t)
			time.Sleep(1 * time.Second) // 模拟耗时操作
			fmt.Printf("[%s] done\n", t)
		}(task)
	}

	wg.Wait()
	fmt.Println("All tasks completed")
	// 输出：最多 3 个任务同时运行
}
```

**进阶**：如果需要动态调整并发数，可以用 `golang.org/x/sync/semaphore` 包的 `Weighted` semaphore。

## 9. Done Channel（优雅退出）

**场景**：通知所有 goroutine 停止工作，实现优雅关闭。

这是所有并发模式的基础模式。生产环境的服务在收到 SIGTERM 后需要优雅关闭：停止接收新请求、等待正在处理的请求完成、关闭数据库连接。

```go
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func worker(done <-chan struct{}, id int) {
	for {
		select {
		case <-done:
			fmt.Printf("Worker %d: shutting down\n", id)
			return
		default:
			// 正常工作
			fmt.Printf("Worker %d: working...\n", id)
			time.Sleep(500 * time.Millisecond)
		}
	}
}

func main() {
	done := make(chan struct{})

	// 启动 3 个 worker
	for i := 1; i <= 3; i++ {
		go worker(done, i)
	}

	// 等待系统信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	fmt.Println("\nReceived shutdown signal, gracefully stopping...")
	close(done)

	// 给 worker 时间清理
	time.Sleep(1 * time.Second)
	fmt.Println("All workers stopped")
}
```

**注意**：`done` channel 关闭后，所有监听它的 goroutine 都会收到零值。如果你有多个清理步骤，用 `sync.WaitGroup` 配合确保全部完成。

## 踩坑记录

### 1. Channel 未关闭导致 goroutine 泄漏

```go
// ❌ 错误：consumer 永远阻塞
func leaky() <-chan int {
	out := make(chan int)
	go func() {
		for i := 0; i < 5; i++ {
			out <- i
		}
		// 忘记 close(out)，consumer 的 range 永远不退出
	}()
	return out
}

// ✅ 正确：defer close(out)
func fixed() <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for i := 0; i < 5; i++ {
			out <- i
		}
	}()
	return out
}
```

**检测方法**：用 `runtime.NumGoroutine()` 或 `pprof` 观察 goroutine 数量是否持续增长。

### 2. 向已关闭的 channel 发送数据

```go
ch := make(chan int)
close(ch)
ch <- 1 // panic: send on closed channel
```

**防御**：用 recover 或者加一个 `done` channel 控制写入生命周期。

### 3. select 中 time.After 的内存问题

```go
// ❌ 高频循环中每次创建新 timer
for {
    select {
    case v := <-ch:
        process(v)
    case <-time.After(time.Second):
        // 每次循环创建新的 timer，旧的不会被 GC 直到触发
        break
    }
}

// ✅ 复用 timer
timer := time.NewTimer(time.Second)
defer timer.Stop()
for {
    select {
    case v := <-ch:
        process(v)
        if !timer.Stop() {
            <-timer.C
        }
        timer.Reset(time.Second)
    case <-timer.C:
        // timeout
    }
}
```

### 4. Buffered channel 的零值陷阱

```go
ch := make(chan int, 5)
// ch 中的零值是 0，和「发送了 0」无法区分
// 用 struct{} 或者自定义类型解决
ch2 := make(chan struct{}, 5)
```

## 总结

| 模式 | 核心场景 | 关键代码 |
|------|---------|---------|
| Fan-out/Fan-in | 任务并行 + 结果合并 | 多个 goroutine 写同一 channel |
| Worker Pool | 控制并发度 | 固定 goroutine 消费 jobs channel |
| Pipeline | 多阶段处理 | channel 串联 |
| Timeout | 超时保护 | `select` + `time.After` / `context` |
| Or-Done | 条件停止读取 | 双 `select` 监听 done + data |
| Tee | 数据分流 | 同一值写入两个 channel |
| Bridge | Channel 扁平化 | 消费 `<-chan <-chan T` |
| Semaphore | 限流 | 带缓冲 channel 做令牌桶 |
| Done Channel | 优雅退出 | `close(done)` 广播信号 |

Channel 不是银弹。如果你的场景是简单的数据传递，用 buffered channel 就够了。但如果涉及复杂的并发协调，这些模式能让你的代码更清晰、更安全。

Go 的 Channel 设计精妙之处在于：它不只是数据管道，更是一种同步原语。理解这一点，就能组合出各种并发模式来解决实际问题。
