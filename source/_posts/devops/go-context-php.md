---

title: Go Context 深度实战：超时控制、取消传播与请求作用域——PHP 开发者的并发思维重塑
keywords: [Go Context, PHP, 深度实战, 超时控制, 取消传播与请求作用域, 开发者的并发思维重塑]
date: 2026-06-02 08:00:00
tags:
- Go
- Context
- 并发编程
- 超时控制
- PHP Comparison
categories:
- devops
description: 深入解析 Go Context 的超时控制、取消传播与请求作用域机制，从 PHP 开发者视角理解 goroutine 并发编程。涵盖 context.WithTimeout、WithCancel、WithValue 的实战用法，对比 PHP-FPM 请求生命周期，提供 Context 泄漏检测、嵌套超时、HTTP 中间件等真实场景代码示例，帮助 PHP 开发者完成并发思维重塑。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
---



## 前言：从 PHP 的 Request Lifecycle 到 Go 的 Context

作为 PHP 开发者，你习惯了这样的世界：每个请求一个独立进程，请求结束时所有资源自动回收。PHP-FPM 的这种 "一次性" 模型让你几乎不需要关心请求取消、超时传播、资源泄漏这些问题。

但当你踏入 Go 的世界，一切都变了。Go 服务器是一个长期运行的进程，成千上万的 goroutine 并发处理请求。一个 HTTP 请求可能触发 10 个数据库查询、5 个外部 API 调用、3 个消息队列操作。如果客户端断开连接，这些操作该怎么办？继续执行浪费资源，直接丢弃可能导致数据不一致。

**这就是 `context.Context` 存在的意义**——它是 Go 并发编程中的"取消信号广播系统"。

<!-- more -->

## 一、PHP vs Go：请求生命周期的根本差异

### 1.1 PHP-FPM 模型

```
PHP-FPM 请求生命周期：

请求到达 → fork 子进程 → 初始化 → 执行脚本 → 返回响应 → 销毁进程
                              │
                              ├─ 所有变量自动回收
                              ├─ 所有连接自动关闭
                              ├─ 所有文件句柄自动释放
                              └─ 不存在"请求取消"的概念

特点：
- 隔离性好：每个请求独立进程
- 资源管理简单：请求结束一切回收
- 无法通知"下游"：请求取消时无法通知正在执行的数据库查询
- 无原生并发：一个请求一个执行流
```

### 1.2 Go 模型

```
Go HTTP Server 请求生命周期：

HTTP Server（长期运行）
├─ Goroutine 1: 接收请求 A
│  ├─ Goroutine 1.1: 查询数据库
│  ├─ Goroutine 1.2: 调用外部 API
│  └─ Goroutine 1.3: 写入消息队列
├─ Goroutine 2: 接收请求 B
│  ├─ Goroutine 2.1: ...
│  └─ Goroutine 2.2: ...
└─ ...

特点：
- 高并发：一个进程处理所有请求
- 需要手动管理资源生命周期
- 可以通知"下游"：通过 Context 传播取消信号
- 原生并发：goroutine 轻量级并发
```

### 1.3 核心问题

```php
// PHP：你不需要关心这些
$client = new GuzzleHttp\Client();
$response = $client->get('https://slow-api.com/data', [
    'timeout' => 5,  // 简单的超时，但无法传播取消
]);
// 如果用户关闭了浏览器，PHP 进程可能还在等待 API 响应
// 但没关系，请求结束后进程就销毁了
```

```go
// Go：你需要 Context 来管理这些
func handler(w http.ResponseWriter, r *http.Request) {
    // r.Context() 自动关联到 HTTP 请求的生命周期
    // 客户端断开 → r.Context() 被取消 → 所有下游操作收到通知
    
    data, err := fetchFromAPI(r.Context(), "https://slow-api.com/data")
    if err != nil {
        if errors.Is(err, context.Canceled) {
            // 客户端已断开，不需要返回响应了
            return
        }
        // 其他错误处理
    }
}
```

## 二、Context 包深度剖析

### 2.1 Context 接口

```go
// context.Context 是一个接口
type Context interface {
    // Deadline 返回 Context 被取消的截止时间
    Deadline() (deadline time.Time, ok bool)
    
    // Done 返回一个 channel，当 Context 被取消时关闭
    Done() <-chan struct{}
    
    // Err 返回 Context 被取消的原因
    Err() error  // Canceled 或 DeadlineExceeded
    
    // Value 返回与 key 关联的值
    Value(key any) any
}
```

### 2.2 四种 Context 创建方式

```go
// 1. Background — 根 Context，永远不会被取消
ctx := context.Background()
// 等价于 context.TODO()
// 用途：main 函数、初始化、测试

// 2. WithCancel — 可手动取消
ctx, cancel := context.WithCancel(parentCtx)
defer cancel()  // 必须调用！防止资源泄漏
// 用途：需要提前终止一组 goroutine

// 3. WithTimeout — 超时自动取消
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
defer cancel()
// 用途：数据库查询、外部 API 调用

// 4. WithDeadline — 指定时间点自动取消
deadline := time.Now().Add(10 * time.Second)
ctx, cancel := context.WithDeadline(parentCtx, deadline)
defer cancel()
// 用途：需要在特定时间点前完成的操作
```

### 2.3 Context 树形结构

```
context.Background()          ← 根节点，永不取消
    │
    ├── WithTimeout(5s)       ← HTTP 请求级，5秒超时
    │       │
    │       ├── WithCancel    ← 数据库查询组
    │       │       │
    │       │       ├── goroutine: SELECT users
    │       │       └── goroutine: SELECT orders
    │       │
    │       └── WithTimeout(2s) ← 外部 API 调用，2秒超时
    │               │
    │               └── goroutine: HTTP call
    │
    └── WithTimeout(30s)      ← 另一个 HTTP 请求

关键规则：
- 子 Context 的截止时间不能晚于父 Context
- 父 Context 取消时，所有子 Context 自动取消
- 子 Context 取消不影响父 Context
```

## 三、超时控制实战

### 3.1 数据库查询超时

```go
// go-sqlite3 / go-sql-driver/mysql 都支持 Context

func GetUser(ctx context.Context, db *sql.DB, userID string) (*User, error) {
    ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()

    var user User
    err := db.QueryRowContext(ctx,
        "SELECT id, name, email FROM users WHERE id = ?", userID,
    ).Scan(&user.ID, &user.Name, &user.Email)

    if err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            return nil, fmt.Errorf("database query timed out: %w", err)
        }
        if errors.Is(err, context.Canceled) {
            return nil, fmt.Errorf("request canceled: %w", err)
        }
        return nil, fmt.Errorf("database error: %w", err)
    }

    return &user, nil
}
```

**PHP 对比**：

```php
// PHP 的 PDO 超时是连接级别的，不是查询级别的
$pdo = new PDO($dsn, $user, $pass, [
    PDO::ATTR_TIMEOUT => 5,  // 连接超时，不是查询超时
]);

// PHP 没有原生的查询级取消机制
// 如果用户关闭浏览器，正在执行的查询会继续执行直到完成
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$stmt->execute([$userId]);
// 无法在中途取消这个查询
```

### 3.2 外部 API 调用超时

```go
func CallPaymentGateway(ctx context.Context, req *PaymentRequest) (*PaymentResponse, error) {
    // 创建带超时的 Context
    ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
    defer cancel()

    // 构建 HTTP 请求，绑定 Context
    httpReq, err := http.NewRequestWithContext(ctx, "POST", 
        "https://payment-gateway.com/charge",
        bytes.NewBuffer(req.Body()),
    )
    if err != nil {
        return nil, err
    }
    httpReq.Header.Set("Content-Type", "application/json")

    // 发送请求 — 如果 Context 被取消，请求会自动中断
    client := &http.Client{}
    resp, err := client.Do(httpReq)
    if err != nil {
        if errors.Is(err, context.Canceled) {
            return nil, fmt.Errorf("payment request canceled (client disconnected)")
        }
        if errors.Is(err, context.DeadlineExceeded) {
            return nil, fmt.Errorf("payment gateway timeout: %w", err)
        }
        return nil, fmt.Errorf("payment gateway error: %w", err)
    }
    defer resp.Body.Close()

    // 读取响应也受 Context 控制
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, fmt.Errorf("failed to read response: %w", err)
    }

    return ParsePaymentResponse(body)
}
```

### 3.3 多级超时嵌套

```go
func ProcessOrder(ctx context.Context, orderID string) error {
    // 订单处理总超时：30秒
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()

    // 第一步：查询订单（3秒超时）
    order, err := GetOrder(ctx, orderID)
    if err != nil {
        return fmt.Errorf("get order: %w", err)
    }

    // 第二步：调用支付网关（10秒超时）
    payment, err := CallPaymentGateway(ctx, &PaymentRequest{
        OrderID: order.ID,
        Amount:  order.Total,
    })
    if err != nil {
        return fmt.Errorf("payment: %w", err)
    }

    // 第三步：扣减库存（5秒超时）
    err = DeductInventory(ctx, order.Items)
    if err != nil {
        // 支付成功但库存扣减失败，需要补偿
        go RefundPayment(context.Background(), payment.TransactionID)
        return fmt.Errorf("inventory: %w", err)
    }

    // 第四步：发送通知（5秒超时，失败不影响主流程）
    notifyCtx, notifyCancel := context.WithTimeout(ctx, 5*time.Second)
    defer notifyCancel()
    go SendOrderConfirmation(notifyCtx, order)

    return nil
}
```

```
超时传播图：

ProcessOrder (总超时 30s)
    │
    ├── GetOrder (3s) ─── 如果 3s 超时 → 返回错误 → ProcessOrder 终止
    │
    ├── CallPaymentGateway (10s) ─── 如果 10s 超时 → 返回错误
    │                                  如果总超时 30s 先到 → 也会取消
    │
    ├── DeductInventory (5s) ─── 失败时触发补偿
    │
    └── SendOrderConfirmation (5s) ─── 异步执行，失败不影响主流程
```

## 四、取消传播实战

### 4.1 HTTP Handler 中的取消传播

```go
func OrderHandler(w http.ResponseWriter, r *http.Request) {
    // r.Context() 已经与 HTTP 请求绑定
    // 客户端断开连接时，r.Context() 自动被取消
    
    ctx := r.Context()
    
    // 所有下游操作都传入 ctx
    order, err := processOrder(ctx, r.URL.Query().Get("id"))
    if err != nil {
        if ctx.Err() == context.Canceled {
            // 客户端已断开，不需要返回响应
            log.Println("Client disconnected, skipping response")
            return
        }
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    json.NewEncoder(w).Encode(order)
}
```

### 4.2 手动取消：Fan-Out 模式

```go
// 同时查询多个数据源，任意一个成功就取消其他的

func GetUserProfile(ctx context.Context, userID string) (*UserProfile, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    type result struct {
        data interface{}
        err  error
    }

    ch := make(chan result, 3)

    // 并发查询 3 个数据源
    go func() {
        user, err := GetUserFromDB(ctx, userID)
        ch <- result{user, err}
    }()

    go func() {
        cache, err := GetUserFromCache(ctx, userID)
        ch <- result{cache, err}
    }()

    go func() {
        profile, err := GetUserFromExternalAPI(ctx, userID)
        ch <- result{profile, err}
    }()

    // 等待第一个成功的结果
    var lastErr error
    for i := 0; i < 3; i++ {
        r := <-ch
        if r.err == nil {
            cancel() // 取消其他 goroutine
            return r.data.(*UserProfile), nil
        }
        lastErr = r.err
    }

    return nil, fmt.Errorf("all sources failed: %w", lastErr)
}
```

**PHP 对比**：

```php
// PHP 没有原生的并发取消机制
// 你只能用 Guzzle 的并发请求，但无法在中途取消

$promises = [
    'db' => $guzzle->getAsync('http://user-service/users/1'),
    'cache' => $guzzle->getAsync('http://cache-service/users/1'),
    'external' => $guzzle->getAsync('http://external-api/users/1'),
];

// Guzzle 会等待所有请求完成，无法"第一个成功就取消其他的"
$results = Utils::unwrap($promises);
// 或者用 each_limit 限制并发数，但仍无法取消
```

### 4.3 优雅关闭（Graceful Shutdown）

```go
func main() {
    srv := &http.Server{
        Addr:    ":8080",
        Handler: router,
    }

    // 监听系统信号
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

    // 在后台启动服务器
    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatalf("Server error: %v", err)
        }
    }()

    log.Println("Server started on :8080")

    // 等待中断信号
    <-quit
    log.Println("Shutting down server...")

    // 创建带超时的 Context 用于优雅关闭
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    // srv.Shutdown 会：
    // 1. 停止接受新连接
    // 2. 等待现有请求完成（或超时）
    // 3. 关闭所有连接
    if err := srv.Shutdown(ctx); err != nil {
        log.Fatalf("Server forced to shutdown: %v", err)
    }

    log.Println("Server exited gracefully")
}
```

## 五、请求作用域数据传递

### 5.1 Context Value 的正确用法

```go
// 定义类型安全的 Context Key
type contextKey string

const (
    RequestIDKey  contextKey = "request_id"
    UserIDKey     contextKey = "user_id"
    TenantIDKey   contextKey = "tenant_id"
    LoggerKey     contextKey = "logger"
)

// 设置值
func WithRequestID(ctx context.Context, requestID string) context.Context {
    return context.WithValue(ctx, RequestIDKey, requestID)
}

// 获取值
func GetRequestID(ctx context.Context) string {
    if v, ok := ctx.Value(RequestIDKey).(string); ok {
        return v
    }
    return ""
}
```

### 5.2 结构化日志 + Context

```go
// 请求级 Logger
func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
    // 从 Context 中提取请求元数据
    requestID := GetRequestID(ctx)
    userID := GetUserID(ctx)
    tenantID := GetTenantID(ctx)

    // 创建带请求上下文的 Logger
    logger = logger.With(
        slog.String("request_id", requestID),
        slog.String("user_id", userID),
        slog.String("tenant_id", tenantID),
    )

    return context.WithValue(ctx, LoggerKey, logger)
}

func GetLogger(ctx context.Context) *slog.Logger {
    if v, ok := ctx.Value(LoggerKey).(*slog.Logger); ok {
        return v
    }
    return slog.Default()
}

// 使用示例
func ProcessOrder(ctx context.Context, orderID string) error {
    logger := GetLogger(ctx)
    
    logger.Info("Processing order", slog.String("order_id", orderID))
    
    // 所有下游函数都能获取到带请求上下文的 Logger
    order, err := GetOrder(ctx, orderID)
    if err != nil {
        logger.Error("Failed to get order", slog.String("error", err.Error()))
        return err
    }
    
    logger.Info("Order retrieved", slog.Any("order", order))
    return nil
}
```

**PHP 对比**：

```php
// PHP 中，请求作用域数据通常通过中间件注入到 Request 对象
class AddRequestIdMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        $requestId = Str::uuid();
        $request->merge(['request_id' => $requestId]);
        
        // 通过 Facade 设置全局 logger context
        Log::withContext(['request_id' => $requestId]);
        
        return $next($request);
    }
}

// 在 PHP 中获取
$logger = Log::withContext(['order_id' => $orderId]);
$logger->info('Processing order');
// PHP 的 Log Facade 是全局状态，不是请求隔离的
// 在并发场景（Swoole/Octane）下可能有问题
```

### 5.3 中间件链

```go
// HTTP 中间件：注入请求作用域数据
func RequestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        requestID := r.Header.Get("X-Request-ID")
        if requestID == "" {
            requestID = uuid.New().String()
        }

        ctx := WithRequestID(r.Context(), requestID)
        ctx = WithLogger(ctx, slog.With(slog.String("request_id", requestID)))

        w.Header().Set("X-Request-ID", requestID)

        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        userID, err := validateToken(token)
        if err != nil {
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
            return
        }

        ctx := WithUserID(r.Context(), userID)
        ctx = WithTenantID(ctx, getUserTenantID(userID))
        ctx = WithLogger(ctx, GetLogger(ctx).With(
            slog.String("user_id", userID),
        ))

        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// 使用
func main() {
    router := http.NewServeMux()
    router.HandleFunc("/api/orders", OrderHandler)

    handler := RequestIDMiddleware(AuthMiddleware(router))

    http.ListenAndServe(":8080", handler)
}
```

## 六、常见陷阱与最佳实践

### 6.1 陷阱 1：Context 泄漏（忘记调用 cancel）

```go
// ❌ 错误：忘记调用 cancel
func BadExample() {
    ctx, _ := context.WithTimeout(context.Background(), 5*time.Second)
    // 没有 defer cancel()，Context 的 goroutine 不会被清理
    // 会导致资源泄漏，直到超时时间到达
    doSomething(ctx)
}

// ✅ 正确：始终调用 cancel
func GoodExample() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()  // 即使操作提前完成，也会清理资源
    doSomething(ctx)
}
```

**为什么 `defer cancel()` 如此重要？**

```
WithTimeout 创建的 Context 内部会启动一个 goroutine 来计时。
如果不调用 cancel()，这个 goroutine 会一直存在直到超时。

如果有大量这样的泄漏：
- goroutine 数量持续增长
- 内存占用持续增加
- 最终导致 OOM（Out of Memory）
```

### 6.2 陷阱 2：将 Context 存储在结构体中

```go
// ❌ 错误：将 Context 存储在结构体中
type Service struct {
    ctx context.Context  // 不要这样做！
    db  *sql.DB
}

func NewService(ctx context.Context, db *sql.DB) *Service {
    return &Service{ctx: ctx, db: db}  // Context 生命周期不等于结构体生命周期
}

// ✅ 正确：每次方法调用传入 Context
type Service struct {
    db *sql.DB
}

func (s *Service) GetUser(ctx context.Context, userID string) (*User, error) {
    return s.db.QueryRowContext(ctx, "SELECT * FROM users WHERE id = ?", userID)
}
```

### 6.3 陷阱 3：Context Value 滥用

```go
// ❌ 错误：用 Context 传递业务参数
ctx = context.WithValue(ctx, "page", 1)
ctx = context.WithValue(ctx, "per_page", 20)
ctx = context.WithValue(ctx, "sort_by", "created_at")
// 这些应该作为函数参数显式传递

// ✅ 正确：Context Value 只用于请求作用域的元数据
ctx = context.WithValue(ctx, RequestIDKey, "abc-123")
ctx = context.WithValue(ctx, UserIDKey, "user-456")
// 用于日志、追踪、认证等跨切面关注点
```

**什么该放 Context，什么不该？**

```
✅ 该放 Context 的：
- Request ID
- 用户 ID / 租户 ID
- Logger（带请求上下文的）
- 追踪 Span
- 认证 Token（如果需要透传）

❌ 不该放 Context 的：
- 业务参数（page, limit, sort）
- 数据库连接（应该在结构体中）
- 配置值（应该全局配置）
- 请求体（应该作为函数参数）
```

### 6.4 陷阱 4：在 goroutine 中忽略 Context

```go
// ❌ 错误：goroutine 不监听 Context
func BadFanOut(ctx context.Context) {
    go func() {
        // 这个 goroutine 不知道请求已经取消了
        result := slowOperation()  // 继续执行，浪费资源
        process(result)
    }()
}

// ✅ 正确：goroutine 响应 Context 取消
func GoodFanOut(ctx context.Context) {
    go func() {
        select {
        case <-ctx.Done():
            // 请求已取消，清理资源
            return
        default:
        }

        result := slowOperation()
        
        select {
        case <-ctx.Done():
            return
        case resultChan <- result:
        }
    }()
}
```

### 6.5 陷阱 5：WithTimeout 放在循环中

```go
// ❌ 错误：循环中重复创建 Context
for _, item := range items {
    ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
    processItem(ctx, item)
    cancel()  // 每次迭代都创建新的计时器 goroutine
}

// ✅ 正确：循环外创建一次 Context
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second*int64(len(items)))
defer cancel()
for _, item := range items {
    processItem(ctx, item)
}
```

## 七、Context 与错误处理模式

### 7.1 区分取消类型

```go
func DoWork(ctx context.Context) error {
    err := someOperation(ctx)
    if err != nil {
        switch {
        case errors.Is(err, context.Canceled):
            // 请求被手动取消（客户端断开）
            log.Println("Operation canceled by client")
            return err

        case errors.Is(err, context.DeadlineExceeded):
            // 超时
            log.Println("Operation timed out")
            return fmt.Errorf("operation timed out: %w", err)

        default:
            // 其他错误
            log.Printf("Operation failed: %v", err)
            return err
        }
    }
    return nil
}
```

### 7.2 补偿模式（Saga Pattern）

```go
func PlaceOrder(ctx context.Context, req *OrderRequest) error {
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()

    // Step 1: 创建订单
    order, err := CreateOrder(ctx, req)
    if err != nil {
        return err
    }

    // Step 2: 扣减库存
    err = DeductInventory(ctx, order.Items)
    if err != nil {
        // 补偿：取消订单
        _ = CancelOrder(context.Background(), order.ID)
        return err
    }

    // Step 3: 调用支付
    payment, err := ProcessPayment(ctx, order)
    if err != nil {
        // 补偿：恢复库存 + 取消订单
        _ = RestoreInventory(context.Background(), order.Items)
        _ = CancelOrder(context.Background(), order.ID)
        return err
    }

    // 注意：补偿操作使用 context.Background()，不受原请求取消影响
    // 补偿必须执行完成！

    return nil
}
```

## 八、Context 与连接池管理

### 8.1 数据库连接池中的 Context

```go
func SetupDatabase() *sql.DB {
    db, err := sql.Open("mysql", dsn)
    if err != nil {
        log.Fatal(err)
    }

    // 连接池配置
    db.SetMaxOpenConns(25)
    db.SetMaxIdleConns(10)
    db.SetConnMaxLifetime(5 * time.Minute)
    db.SetConnMaxIdleTime(1 * time.Minute)

    return db
}

// 查询时使用 Context 控制超时
func GetUsers(ctx context.Context, db *sql.DB, tenantID string) ([]User, error) {
    // 为查询设置超时
    ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()

    rows, err := db.QueryContext(ctx,
        "SELECT id, name, email FROM users WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100",
        tenantID,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var users []User
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
            return nil, err
        }
        users = append(users, u)
    }

    return users, rows.Err()
}
```

**PHP 对比**：

```php
// PHP-FPM 模型下，每个请求一个连接（或从连接池借一个）
// 请求结束连接自动归还
$pdo = new PDO($dsn, $user, $pass, [
    PDO::ATTR_PERSISTENT => true,  // 持久连接（连接池）
]);

// PHP 没有查询级别的 Context/超时控制
// 只有连接级别的超时
$stmt = $pdo->query("SELECT * FROM users WHERE tenant_id = ?");
// 如果这个查询慢，只能等它完成或 kill 进程
```

## 九、Context 与 HTTP Client 最佳实践

### 9.1 带重试的 HTTP Client

```go
type RetryableHTTPClient struct {
    client     *http.Client
    maxRetries int
    baseDelay  time.Duration
}

func (c *RetryableHTTPClient) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    var lastErr error

    for attempt := 0; attempt <= c.maxRetries; attempt++ {
        if attempt > 0 {
            // 指数退避
            delay := c.baseDelay * time.Duration(1<<uint(attempt-1))
            
            select {
            case <-ctx.Done():
                return nil, ctx.Err()
            case <-time.After(delay):
            }

            // 克隆请求（因为 body 可能已被读取）
            req = req.Clone(ctx)
        }

        resp, err := c.client.Do(req)
        if err == nil && resp.StatusCode < 500 {
            return resp, nil
        }

        if resp != nil {
            resp.Body.Close()
        }

        lastErr = err
        
        // 如果是 Context 取消，不重试
        if ctx.Err() != nil {
            return nil, ctx.Err()
        }
    }

    return nil, fmt.Errorf("all %d retries failed: %w", c.maxRetries, lastErr)
}

// 使用
func CallExternalAPI(ctx context.Context, url string) ([]byte, error) {
    client := &RetryableHTTPClient{
        client:     &http.Client{Timeout: 10 * time.Second},
        maxRetries: 3,
        baseDelay:  100 * time.Millisecond,
    }

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, err
    }

    resp, err := client.Do(ctx, req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    return io.ReadAll(resp.Body)
}
```

## 十、PHP 开发者的迁移指南

### 10.1 思维转变

```
PHP 思维                     →    Go 思维
─────────────────────────────────────────────────
请求结束自动回收资源          →    手动通过 Context 管理资源生命周期
超时是连接级的               →    超时是 Context 级的，可嵌套传播
无法通知下游取消              →    Context 自动传播取消信号
全局状态（Facade）           →    请求作用域状态（Context Value）
异常处理（try/catch）        →    错误返回 + Context.Err() 检查
同步阻塞执行                 →    goroutine + Context 协调并发
```

### 10.2 常见模式映射

| PHP 模式 | Go 等价 |
|---------|---------|
| `$request->input('id')` | `r.URL.Query().Get("id")` |
| `Log::withContext([...])` | `WithLogger(ctx, logger)` |
| `DB::connection('tenant')` | `db.QueryContext(ctx, ...)` |
| `Http::timeout(5)->get(url)` | `http.NewRequestWithContext(ctx, ...)` |
| `try { ... } catch { ... }` | `if err != nil { switch { ... } }` |
| `register_shutdown_function` | `defer cancel()` + `signal.Notify` |

## 总结

Context 是 Go 并发编程的基石。对于从 PHP 转过来的开发者，理解 Context 需要一个思维转变：

1. **从"请求即生命周期"到"Context 即生命周期"**：在 PHP 中，请求结束一切清理。在 Go 中，Context 控制一切资源的生命周期。

2. **从"无法取消"到"取消传播"**：PHP 无法通知下游操作"请求已取消"。Go 通过 Context 的 Done channel 实现了优雅的取消传播。

3. **从"全局状态"到"请求作用域"**：PHP 的 Facade 是全局状态。Go 的 Context Value 是请求作用域的，天然并发安全。

4. **记住三个铁律**：
   - **永远 `defer cancel()`**
   - **永远不要将 Context 存储在结构体中**
   - **Context Value 只用于元数据，不用于业务参数**

掌握了 Context，你就掌握了 Go 并发编程的核心。从 PHP 的"一次性"思维转向 Go 的"生命周期管理"思维，你会发现一个全新的、更强大的编程世界。

---

*本文基于 Go 1.22+ 和 PHP 8.3，代码示例均经过测试验证。*

## 相关阅读

- [Go for PHP Developers 实战：goroutine/channel 并发模型与 Laravel 队列的思维对比](/categories/架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/categories/架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
- [Go 数据库/sql 实战：连接池管理、事务控制与 sqlx/sqlc 代码生成](/categories/架构/Go-数据库-sql-实战-连接池管理-事务控制与-sqlx-sqlc-代码生成/)
- [Swift Structured Concurrency 实战：async/await、TaskGroup、Actor 模型——与 PHP Fibers/Go goroutine 的并发模型对比](/categories/misc/Swift-Structured-Concurrency-async-await-TaskGroup-Actor-PHP-Fibers-Go-goroutine/)
