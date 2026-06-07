# Go Context 机制

## 定义

`context.Context` 是 Go 标准库提供的请求作用域管理机制，用于在 goroutine 之间传递**截止时间**、**取消信号**和**请求级值**。它是 Go 并发编程的核心原语，几乎所有涉及 I/O 的 Go 代码都以 `ctx context.Context` 作为第一个参数。

## 核心原理

### Context 的四个创建方式

```go
// 1. Background — 根 Context，永不取消
ctx := context.Background()

// 2. TODO — 占位符，表示"还不知道用哪个 Context"
ctx := context.TODO()

// 3. WithCancel — 可手动取消
ctx, cancel := context.WithCancel(context.Background())
defer cancel()  // 必须调用，否则资源泄漏

// 4. WithTimeout — 超时自动取消
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

// 5. WithDeadline — 指定时间点取消
deadline := time.Now().Add(10 * time.Second)
ctx, cancel := context.WithDeadline(context.Background(), deadline)
defer cancel()
```

### 传递请求级值

```go
type contextKey string
const userIDKey contextKey = "userID"

// 设置值
ctx := context.WithValue(context.Background(), userIDKey, 42)

// 读取值
if userID, ok := ctx.Value(userIDKey).(int); ok {
    fmt.Println("User ID:", userID)
}
```

### 监听取消信号

```go
func longRunningTask(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            // Context 被取消或超时
            return fmt.Errorf("task cancelled: %w", ctx.Err())
        default:
            // 继续工作
            doWork()
        }
    }
}

// 在 HTTP Handler 中使用
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()  // HTTP 请求自带 Context
    result, err := longRunningTask(ctx)
    if err != nil {
        if errors.Is(err, context.Canceled) {
            // 客户端断开连接
            return
        }
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    json.NewEncoder(w).Encode(result)
}
```

### Context 在数据库/gRPC 中的传播

```go
// 数据库查询 — Context 控制超时
ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
defer cancel()
row := db.QueryRowContext(ctx, "SELECT * FROM users WHERE id = ?", 1)

// gRPC 调用 — Context 传播截止时间
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
resp, err := client.GetUser(ctx, &pb.GetUserRequest{Id: 1})
```

### Context 的传播规则

```
context.Background()
  ├── WithTimeout(5s)      → 子 Context 5 秒后自动取消
  │     ├── WithValue(key)  → 继承父的超时
  │     └── WithCancel()    → 继承父的超时
  └── WithCancel()
        └── WithValue(key)  → 继承父的手动取消
```

**规则**：
- 子 Context 的截止时间不能晚于父 Context
- 父 Context 取消时，所有子 Context 自动取消
- 子 Context 取消不影响父 Context

## 与 PHP 的对比

| 维度 | Go Context | PHP |
|------|------------|-----|
| 请求作用域 | 显式 `ctx` 参数传递 | 隐式（`$request` 对象） |
| 超时控制 | `context.WithTimeout` | `set_time_limit()` / Swoole 协程 |
| 取消传播 | 自动传播到所有子 Context | 无原生机制（需手动实现） |
| 值传递 | `context.WithValue`（类型不安全） | Middleware / Request attributes |
| goroutine 取消 | Context 自动取消 | Fibers 需手动取消 |

## 实战案例

来自博客文章：
- [Go Context 深度实战：超时控制、取消传播与请求作用域——PHP 开发者的并发思维重塑](/2026/06/01/06_运维/Go-Context-深度实战-超时控制取消传播与请求作用域-PHP开发者的并发思维重塑/)

## 相关概念

- [goroutine 与并发模型](goroutine与并发模型.md) - goroutine、channel
- [Go 微服务与 gRPC](Go微服务与gRPC.md) - gRPC Context 传播
- [Go 错误处理](Go错误处理.md) - context.Canceled 错误

## 常见问题

**Q: context.WithValue 的 key 用什么类型？**
A: 用自定义类型（如 `type contextKey string`），避免不同包之间的 key 冲突。不要用内置类型（如 `string`、`int`）。

**Q: Context 会不会内存泄漏？**
A: 如果不调用 `cancel()` 函数，WithCancel/WithTimeout/WithDeadline 创建的 Context 不会被 GC 回收。所以必须 `defer cancel()`。

**Q: 为什么 Go 不用异常来做取消？**
A: Go 的哲学是"显式优于隐式"。Context 通过 `select` 监听 `Done()` channel 来实现取消，是协作式的，不会中断正在执行的操作。
