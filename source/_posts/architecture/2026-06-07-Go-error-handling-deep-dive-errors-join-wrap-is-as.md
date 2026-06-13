---
title: Go error handling 深度实战：errors.Join/Wrap/Is/As 与自定义错误类型——对比 PHP Exception 层级的设计哲学
date: 2026-06-07 10:00:00
tags: [go, error-handling, php, 错误处理, 异常处理, 设计模式]
description: "深入剖析 Go error handling 核心机制——errors.Join 多错误聚合、errors.Is 值比较、errors.As 类型提取、fmt.Errorf %w 错误包装，对比 PHP Exception 异常层级的设计模式哲学。涵盖生产级错误处理中间件、gRPC status codes、自定义错误类型、踩坑案例与最佳实践，帮助开发者掌握从 PHP 异常处理到 Go 显式错误处理的思维转换。"
categories:
  - architecture
cover: /images/covers/go-error-handling-cover.jpg
---

Go 语言自诞生之日起，就以一种"反传统"的方式处理错误——没有 try/catch，没有异常层级树，只有一个极简的 `error` 接口。这让从 PHP、Java、Python 等语言转过来的开发者感到困惑甚至愤怒：为什么要写那么多 `if err != nil`？这不是在制造"面条代码"吗？

然而，经过十余年的发展，Go 的错误处理哲学已经从最初的"朴素"演变为一套成熟、精妙且极具工程价值的体系。从 Go 1.13 的 `errors.Is`/`errors.As`/`%w` 包装，到 Go 1.20 的 `errors.Join` 多错误聚合，Go 正在用自己独特的方式回答"程序应该如何优雅地处理错误"这个古老命题。

本文将深入 Go error handling 的每一个核心机制，并与 PHP 的 Exception 层级体系进行全方位对比，帮助你理解两种截然不同的设计哲学，以及它们各自适用的场景。

---

<!--more-->

## 一、Go error 接口哲学 vs PHP Exception 层级

### Go：错误是值，不是控制流

Go 的 `error` 接口定义极为简洁：

```go
type error interface {
    Error() string
}
```

仅一个方法。这意味着任何实现了 `Error() string` 的类型都是一个 error。Go 的设计哲学强调三个核心原则：

**第一，错误是值（Error is a value）。** 在 Go 中，error 和 int、string 一样，是一种普通的返回值类型。你可以把它存在变量里、放进 slice、通过 channel 传递、甚至塞进 map。它不是某种"特殊流程"，而是函数签名中一个显而易见的部分。

**第二，错误处理是显式的（Explicit error handling）。** 调用者必须显式地检查 `err != nil`，否则编译器会发出警告（`err` 未使用）。Go 不允许你"忽略"错误——至少你得写 `_ = err`，这会暴露你在刻意忽略它。

**第三，错误不用于控制流（Errors are not for control flow）。** Go 用 `panic/recover` 处理真正的异常情况（程序不可恢复的错误），而普通的业务错误（文件不存在、网络超时、参数非法）一律通过返回值传递。这和 PHP 的 Exception 截然不同。

### PHP：异常是控制流，层级是分类

PHP 的异常体系是一棵庞大的继承树：

```
Throwable
├── Exception
│   ├── InvalidArgumentException
│   ├── LogicException
│   │   ├── BadFunctionCallException
│   │   └── DomainException
│   ├── RuntimeException
│   │   ├── OutOfBoundsException
│   │   ├── OverflowException
│   │   ├── UnderflowException
│   │   └── UnexpectedValueException
│   └── 自定义业务异常...
└── Error
    ├── TypeError
    ├── ParseError
    └── ArithmeticError
```

PHP 的设计哲学是：**异常就是控制流的一部分。** 你可以用 try/catch 来"跳出"正常的代码执行路径，catch 块就是你的"备选路径"。这种设计非常适合 Web 开发中"一层层传递，最终在某个地方统一处理"的模式。

PHP 的 exception 层级允许你通过继承关系来"捕获一族异常"：

```php
try {
    // 可能抛出多种异常的操作
    processPayment($order);
} catch (PaymentException $e) {
    // 捕获所有支付相关的异常（无论具体类型）
    logPaymentError($e);
} catch (\Exception $e) {
    // 兜底：捕获所有其他异常
    reportUnexpectedError($e);
}
```

这里的核心差异在于：PHP 的 catch 是基于**类型层级**进行匹配的，而 Go 的错误检查是基于**值比较**或**类型断言**进行的。这两种方式各有优劣，我们后面会详细对比。

---

## 二、Go 1.13+ errors 包的革命性升级

Go 1.13 是 Go error handling 历史上的分水岭。在此之前，Go 的错误处理确实存在明显的不足——最突出的问题是**错误链（error chain）的断裂**。

### 2.1 问题的起源：fmt.Errorf 与错误包装

在 Go 1.13 之前，如果你想在调用链中"附加上下文信息"到一个错误上，通常这样做：

```go
func readConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("读取配置文件失败: %v", err)
    }
    // ...
}
```

这种方式的问题在于：原始错误被"拍扁"成了一个新字符串。你无法再用 `==` 比较它与原始的 sentinel error：

```go
if err == os.ErrNotExist { // 永远不会为 true，因为 err 已经是一个新字符串
    // ...
}
```

### 2.2 %w 动词：错误包装的语法糖

Go 1.13 引入了 `%w` 动词，让 `fmt.Errorf` 可以"包装"原始错误而非"拍平"它：

```go
func readConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("读取配置文件 %s 失败: %w", path, err)
    }
    // ...
}
```

`%w` 的语义是：创建一个新 error，它的 `Error()` 方法返回完整的消息（包含上下文），但内部保留了对原始 error 的引用。这就形成了一条**错误链**。

### 2.3 errors.Is：沿错误链查找特定错误

`errors.Is` 的作用是沿着错误链逐层查找，判断链中是否包含某个特定的错误值：

```go
err := readConfig("/etc/app/config.yaml")

if errors.Is(err, os.ErrNotExist) {
    // 即使 err 是被包装过的，也能正确识别出根因是"文件不存在"
    log.Println("配置文件不存在，使用默认配置")
}
```

`errors.Is` 内部的实现逻辑可以简化理解为：

```go
// 伪代码，展示核心逻辑
func Is(err, target error) bool {
    for err != nil {
        if err == target {
            return true
        }
        // 如果 err 实现了 Unwrap() error，继续沿着链查找
        if u, ok := err.(interface{ Unwrap() error }); ok {
            err = u.Unwrap()
        } else {
            return false
        }
    }
    return false
}
```

对于实现了 `Unwrap() []error` 的多包装错误（如 `errors.Join` 产生的），`errors.Is` 会递归遍历所有分支。

### 2.4 errors.As：沿错误链提取特定类型

`errors.As` 的作用是沿错误链查找第一个匹配目标类型的错误，并将其赋值给目标变量：

```go
var pathErr *os.PathError
if errors.As(err, &pathErr) {
    fmt.Println("路径:", pathErr.Path)
    fmt.Println("操作:", pathErr.Op)
}
```

注意 `errors.As` 的第二个参数必须是一个**非 nil 的指向目标类型的指针**。如果匹配成功，该指针会被赋值为找到的错误。

### 2.5 Wrap/Unwrap 函数：手动构建错误链

除了 `fmt.Errorf("%w", err)`，你也可以手动实现包装：

```go
type wrappedError struct {
    msg   string
    cause error
}

func (e *wrappedError) Error() string {
    return e.msg + ": " + e.cause.Error()
}

func (e *wrappedError) Unwrap() error {
    return e.cause
}
```

只要你的自定义错误类型实现了 `Unwrap() error` 方法，`errors.Is` 和 `errors.As` 就能正确遍历错误链。

### 2.6 PHP 对比：Exception 的 $previous

PHP 的异常其实也有"错误链"的概念——`Exception` 的构造函数接受一个可选的 `$previous` 参数：

```php
try {
    $data = file_get_contents($path);
} catch (\Exception $e) {
    throw new ConfigException("读取配置文件失败", 0, $e);
    //                                      ↑ $previous 参数
}
```

你可以通过 `$e->getPrevious()` 来获取上一层异常。这和 Go 的 `Unwrap()` 在概念上是完全对应的。区别在于：

- Go 的包装是**默认行为**（`%w` 只需要一个动词），PHP 需要**显式传递** `$previous`
- Go 的 `errors.Is` 做的是**值比较**（链中是否有某个特定错误），PHP 的 catch 做的是**类型匹配**（链中是否有某个特定类型的异常）
- Go 鼓励在每一层都包装错误并附加上下文，PHP 的 `getPrevious()` 在实践中经常被忽略

---

## 三、Go 1.20+ errors.Join：多错误聚合

### 3.1 问题：并行操作中的多个错误

Go 1.20 引入了 `errors.Join`，解决了一个困扰 Go 社区多年的问题：当你同时执行多个操作（比如并发请求多个 API），其中多个操作都失败了，你该如何报告这些错误？

在 `errors.Join` 之前，常见的做法包括：

```go
// 做法 1：只返回第一个错误（丢失信息）
if err1 != nil {
    return err1
}

// 做法 2：手动拼接字符串（丢失结构）
return fmt.Errorf("错误1: %v; 错误2: %v", err1, err2)

// 做法 3：使用第三方库（如 hashicorp/go-multierror）
return multierror.Append(err1, err2)
```

### 3.2 errors.Join 的使用

`errors.Join` 接受多个 error 参数，返回一个聚合了所有非 nil 错误的新 error：

```go
func fetchAll(urls []string) ([]Response, error) {
    var (
        results []Response
        errs    []error
    )

    for _, url := range urls {
        resp, err := fetch(url)
        if err != nil {
            errs = append(errs, fmt.Errorf("fetch %s: %w", url, err))
            continue
        }
        results = append(results, resp)
    }

    if len(errs) > 0 {
        return results, errors.Join(errs...)
    }
    return results, nil
}
```

### 3.3 errors.Join 的独特语义

`errors.Join` 返回的错误有一个重要特性：**它的 `Error()` 方法用换行符连接所有子错误的消息**，而 `Unwrap()` 方法返回 `[]error`（注意是切片，不是单个 error）。

```go
err := errors.Join(
    errors.New("connection refused"),
    errors.New("timeout after 30s"),
)

fmt.Println(err.Error())
// 输出:
// connection refused
// timeout after 30s

// Unwrap 返回 []error
if errs, ok := err.(interface{ Unwrap() []error }); ok {
    for _, e := range errs {
        fmt.Println("  子错误:", e)
    }
}
```

这意味着 `errors.Is` 和 `errors.As` 在遍历 `errors.Join` 产生的错误时，会**递归搜索所有分支**：

```go
var netErr *net.OpError
if errors.As(err, &netErr) {
    // 只要 Join 中任何一个子错误（或其子链）包含 *net.OpError，就会匹配
}
```

### 3.4 PHP 对比：没有原生的多异常聚合

PHP 没有原生的"多异常聚合"机制。在 PHP 中处理多个错误通常的做法是：

```php
$errors = [];
foreach ($tasks as $task) {
    try {
        $task->execute();
    } catch (\Throwable $e) {
        $errors[] = $e;
    }
}

if (!empty($errors)) {
    // 自己实现聚合
    throw new AggregateException("多个任务执行失败", 0, null, $errors);
}
```

一些框架（如 Symfony Validator）会自定义聚合异常类，但语言层面没有统一规范。这是 PHP 作为单线程、同步执行模型的语言，在错误聚合方面天然不那么迫切的体现——因为在 PHP 的典型场景中（Web 请求处理），你通常不需要"同时做多件事"。

---

## 四、自定义错误类型设计

### 4.1 实现 error 接口

Go 的自定义错误类型本质上就是实现 `error` 接口的结构体。但好的自定义错误应该做到：

```go
// AppError 是应用程序级的通用错误类型
type AppError struct {
    Code    ErrorCode      // 机器可读的错误码
    Message string         // 人类可读的错误消息
    Cause   error          // 原始错误（可选）
    Fields  map[string]any // 附加的上下文字段
}

func (e *AppError) Error() string {
    if e.Cause != nil {
        return fmt.Sprintf("[%d] %s: %v", e.Code, e.Message, e.Cause)
    }
    return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

func (e *AppError) Unwrap() error {
    return e.Cause
}

// 实现 fmt.Formatter 以支持 %+v 输出完整堆栈
func (e *AppError) Format(f fmt.State, c rune) {
    if f.Flag('+') && c == 'v' {
        fmt.Fprintf(f, "AppError{Code: %d, Message: %s}\n", e.Code, e.Message)
        for k, v := range e.Fields {
            fmt.Fprintf(f, "  %s: %v\n", k, v)
        }
        if e.Cause != nil {
            fmt.Fprintf(f, "Caused by: %+v", e.Cause)
        }
        return
    }
    fmt.Fprint(f, e.Error())
}

type ErrorCode int

const (
    ErrCodeNotFound     ErrorCode = 1001
    ErrCodeUnauthorized ErrorCode = 1002
    ErrCodeValidation   ErrorCode = 1003
    ErrCodeInternal     ErrorCode = 1004
    ErrCodeConflict     ErrorCode = 1005
)
```

### 4.2 构造函数模式

为自定义错误提供便捷的构造函数：

```go
func NewAppError(code ErrorCode, msg string, cause error) *AppError {
    return &AppError{
        Code:    code,
        Message: msg,
        Cause:   cause,
        Fields:  make(map[string]any),
    }
}

func (e *AppError) WithField(key string, value any) *AppError {
    e.Fields[key] = value
    return e
}

// 使用示例
err := NewAppError(ErrCodeNotFound, "用户不存在", nil).
    WithField("user_id", 42).
    WithField("query_time", time.Since(start))
```

### 4.3 Sentinel Errors：预定义的错误值

Sentinel errors 是 Go 中一种常见的错误处理模式——提前定义好一组错误常量，调用者通过比较来判断错误类型：

```go
var (
    ErrUserNotFound     = errors.New("user not found")
    ErrPermissionDenied = errors.New("permission denied")
    ErrRateLimited      = errors.New("rate limited")
    ErrServiceUnavail   = errors.New("service unavailable")
)

// 业务代码
func GetUser(id int64) (*User, error) {
    user, err := db.FindByID(id)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, ErrUserNotFound
        }
        return nil, fmt.Errorf("查询用户失败: %w", err)
    }
    return user, nil
}

// 调用方
user, err := GetUser(42)
if errors.Is(err, ErrUserNotFound) {
    // 处理"用户不存在"
}
```

Sentinel errors 的优点是简洁、直观、易于测试。缺点是它们是全局变量，可能被意外修改（虽然用 `var` 而非 `const` 但在实践中一般不会去改），而且不能携带额外的上下文信息。

### 4.4 类型断言 vs errors.As

在 Go 1.13 之前，类型断言是唯一的"按类型匹配错误"的方式：

```go
// 旧方式（Go 1.13 之前）
if ae, ok := err.(*AppError); ok {
    fmt.Println(ae.Code)
}

// 新方式（Go 1.13+，推荐）
var ae *AppError
if errors.As(err, &ae) {
    fmt.Println(ae.Code)
}
```

`errors.As` 的优势在于它会沿着错误链查找，而类型断言只检查最外层。在现代 Go 代码中，应始终使用 `errors.As`。

### 4.5 PHP 对比：自定义异常类

PHP 的自定义异常通常通过继承 `Exception` 来实现：

```php
class AppException extends \RuntimeException
{
    private int $errorCode;
    private array $context;

    public function __construct(
        int $errorCode,
        string $message,
        \Throwable $previous = null,
        array $context = []
    ) {
        parent::__construct($message, 0, $previous);
        $this->errorCode = $errorCode;
        $this->context = $context;
    }

    public function getErrorCode(): int { return $this->errorCode; }
    public function getContext(): array { return $this->context; }
}

class UserNotFoundException extends AppException
{
    public function __construct(int $userId, \Throwable $previous = null)
    {
        parent::__construct(
            1001,
            "用户 {$userId} 不存在",
            $previous,
            ['user_id' => $userId]
        );
    }
}
```

PHP 的优势在于类继承天然提供了层级关系，你可以直接 `catch (AppException $e)` 来捕获所有业务异常。Go 中要实现类似的效果，需要自己定义接口：

```go
// 定义一个"可重试"的错误接口
type RetryableError interface {
    error
    IsRetryable() bool
    RetryAfter() time.Duration
}

// 在错误处理中使用
if re, ok := err.(RetryableError); ok && re.IsRetryable() {
    time.Sleep(re.RetryAfter())
    // 重试...
}
```

Go 的接口是隐式实现的，这意味着你不需要显式声明"我的错误实现了某个接口"——只要方法签名对上了就行。这种鸭子类型（duck typing）的风格让 Go 的错误组合比 PHP 的继承更加灵活。

---

## 五、PHP 的 try/catch 与 Exception 层级对比

### 5.1 try/catch 的执行模型

PHP 的 try/catch 是一个控制流结构：

```php
try {
    $result = riskyOperation1();
    $result2 = riskyOperation2($result);  // 如果 1 已经失败，这里不会执行
    $result3 = riskyOperation3($result2);
} catch (SpecificException $e) {
    // 只捕获 SpecificException 类型
    handleSpecific($e);
} catch (\Exception $e) {
    // 捕获所有其他异常
    handleGeneric($e);
} finally {
    // 无论成功失败都会执行
    cleanup();
}
```

try/catch 的核心特征是：**一旦某一行抛出异常，后续的代码立即跳转到 catch 块。** 这种"短路"行为在某些场景下非常方便（比如事务回滚），但也容易导致开发者忽略中间状态。

### 5.2 Go 中的"等价物"

Go 没有 try/catch，但可以用多种方式模拟类似的效果：

**方式 1：逐行检查（最常见）**

```go
result1, err := riskyOperation1()
if err != nil {
    return fmt.Errorf("operation1: %w", err)
}

result2, err := riskyOperation2(result1)
if err != nil {
    return fmt.Errorf("operation2: %w", err)
}
```

**方式 2：错误回调（模拟 try/catch 的"集中处理"）**

```go
func withRecovery(fn func() error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic recovered: %v", r)
        }
    }()
    return fn()
}

err := withRecovery(func() error {
    // 可能 panic 的代码
    return doSomething()
})
```

**方式 3：使用 named return 和 defer**

```go
func processOrder(order *Order) (err error) {
    tx, _ := db.Begin()
    defer func() {
        if err != nil {
            tx.Rollback()
        }
    }()

    // ... 多个操作，任何一步的错误都会触发 defer 中的 Rollback
    if err = tx.Insert(order); err != nil {
        return fmt.Errorf("insert order: %w", err)
    }
    if err = tx.UpdateInventory(order); err != nil {
        return fmt.Errorf("update inventory: %w", err)
    }

    return tx.Commit()
}
```

### 5.3 核心差异：错误传播的方向

PHP 的异常传播方向是**向上抛出（throw up）**：底层代码抛出异常，调用链中间的代码不处理，最终在某个高层的 try/catch 块中被捕获。

Go 的错误传播方向是**向上传递（return up）**：底层代码返回 error，每一层调用者都有机会（也有责任）决定如何处理——是直接返回、包装后返回、还是就地处理。

这种差异导致了两种语言在代码风格上的巨大不同：

- PHP 的代码看起来更"线性"——try 块中的代码不需要任何错误检查逻辑
- Go 的代码看起来更"啰嗦"——每个可能失败的调用都需要检查 `err != nil`

但 Go 的方式有一个被低估的优势：**你被迫在每一层都思考"这个错误该怎么处理"。** 在 PHP 中，开发者经常会在最外层写一个"catch all"，导致中间层的错误处理逻辑被完全跳过——而这些中间层往往是决定错误应该如何被报告、记录或恢复的最佳位置。

---

## 六、实战场景：HTTP 中间件与数据库错误分类

### 6.1 HTTP 中间件错误处理

在构建 Go HTTP 服务时，一个常见的模式是：业务层返回结构化的错误，中间件层统一将其转换为 HTTP 响应。

```go
// 1. 定义错误分类接口
type HTTPStatusError interface {
    error
    HTTPStatusCode() int
}

// 2. 业务错误类型
type APIError struct {
    Status  int    `json:"-"`
    Code    string `json:"code"`
    Message string `json:"message"`
    Detail  string `json:"detail,omitempty"`
}

func (e *APIError) Error() string {
    return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *APIError) HTTPStatusCode() int {
    return e.Status
}

// 3. 便捷构造函数
func NotFound(format string, args ...any) *APIError {
    return &APIError{
        Status:  http.StatusNotFound,
        Code:    "NOT_FOUND",
        Message: fmt.Sprintf(format, args...),
    }
}

func Unauthorized(format string, args ...any) *APIError {
    return &APIError{
        Status:  http.StatusUnauthorized,
        Code:    "UNAUTHORIZED",
        Message: fmt.Sprintf(format, args...),
    }
}

func BadRequest(format string, args ...any) *APIError {
    return &APIError{
        Status:  http.StatusBadRequest,
        Code:    "BAD_REQUEST",
        Message: fmt.Sprintf(format, args...),
    }
}

// 4. 统一错误处理中间件
func ErrorMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 使用自定义 ResponseWriter 来捕获 handler 中的错误
        rw := &responseWriter{ResponseWriter: w}
        next.ServeHTTP(rw, r)

        if rw.err != nil {
            handleErrorResponse(w, r, rw.err)
        }
    })
}

func handleErrorResponse(w http.ResponseWriter, r *http.Request, err error) {
    var apiErr *APIError
    if errors.As(err, &apiErr) {
        writeJSON(w, apiErr.HTTPStatusCode(), apiErr)
        return
    }

    // 未知错误：返回 500，但不暴露内部细节
    log.Error("unhandled error", "err", err, "path", r.URL.Path)
    writeJSON(w, http.StatusInternalServerError, map[string]string{
        "code":    "INTERNAL_ERROR",
        "message": "服务器内部错误",
    })
}

// 5. 业务 handler
func GetUserHandler(w http.ResponseWriter, r *http.Request) error {
    id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
    if err != nil {
        return BadRequest("无效的用户 ID: %s", r.PathValue("id"))
    }

    user, err := userService.GetByID(r.Context(), id)
    if err != nil {
        if errors.Is(err, ErrUserNotFound) {
            return NotFound("用户 %d 不存在", id)
        }
        return fmt.Errorf("查询用户: %w", err) // 内部错误，会被中间件转为 500
    }

    return writeJSON(w, http.StatusOK, user)
}
```

对比 PHP 的方式：

```php
// PHP 的典型做法：在 Controller 层抛异常，由全局异常处理器捕获
class UserController
{
    public function show(int $id): JsonResponse
    {
        // 这里的异常会被 Symfony/Laravel 的异常处理器自动转换为 JSON 响应
        $user = $this->userService->findById($id);

        if (!$user) {
            throw new NotFoundHttpException("用户 {$id} 不存在");
        }

        return new JsonResponse($user);
    }
}

// Symfony 的 ExceptionListener 会捕获所有异常并转换为 HTTP 响应
// Laravel 的 Handler::render() 方法起到类似作用
```

PHP 的方式在表面上更简洁，但 Go 的方式更可控——你可以精确控制每一层的错误包装和传播行为，而不需要依赖框架的"魔法"。

### 6.2 数据库错误分类

数据库操作是错误处理的重灾区。Go 中常见的做法是将底层的数据库错误"翻译"为业务错误：

```go
var (
    ErrDuplicateKey   = errors.New("duplicate key")
    ErrRecordNotFound = errors.New("record not found")
    ErrForeignKey     = errors.New("foreign key violation")
)

// 数据库层：翻译底层错误
func (r *UserRepo) Create(ctx context.Context, user *User) error {
    _, err := r.db.ExecContext(ctx,
        "INSERT INTO users (email, name) VALUES (?, ?)",
        user.Email, user.Name,
    )
    if err != nil {
        return r.translateError(err)
    }
    return nil
}

func (r *UserRepo) translateError(err error) error {
    // MySQL 错误码判断
    var mysqlErr *mysql.MySQLError
    if errors.As(err, &mysqlErr) {
        switch mysqlErr.Number {
        case 1062: // Duplicate entry
            return fmt.Errorf("%w: %v", ErrDuplicateKey, err)
        case 1452: // Foreign key constraint fails
            return fmt.Errorf("%w: %v", ErrForeignKey, err)
        }
    }

    // PostgreSQL 错误判断
    var pgErr *pgconn.PgError
    if errors.As(err, &pgErr) {
        switch pgErr.Code {
        case "23505": // unique_violation
            return fmt.Errorf("%w: %v", ErrDuplicateKey, err)
        case "23503": // foreign_key_violation
            return fmt.Errorf("%w: %v", ErrForeignKey, err)
        case "23502": // not_null_violation
            return fmt.Errorf("%w: field %s cannot be null", ErrValidation, pgErr.ColumnName)
        }
    }

    // sql 包的标准错误
    if errors.Is(err, sql.ErrNoRows) {
        return ErrRecordNotFound
    }

    return fmt.Errorf("database error: %w", err)
}

// 业务层：使用数据库层的哨兵错误
func (s *UserService) Create(ctx context.Context, email, name string) (*User, error) {
    user := &User{Email: email, Name: name}

    err := s.repo.Create(ctx, user)
    if err != nil {
        if errors.Is(err, ErrDuplicateKey) {
            return nil, Conflict("邮箱 %s 已被注册", email)
        }
        return nil, fmt.Errorf("创建用户: %w", err)
    }

    return user, nil
}
```

这里体现了 Go 错误处理分层架构的精髓：

- **数据库层**：将底层驱动的错误翻译为与驱动无关的 sentinel errors
- **业务层**：使用 sentinel errors 来做逻辑判断，再翻译为面向用户的 API errors
- **HTTP 层**：将 API errors 转换为 HTTP 响应

PHP 中类似的做法是用 PDOException 的 error code 来判断：

```php
try {
    $this->entityManager->persist($user);
    $this->entityManager->flush();
} catch (UniqueConstraintViolationException $e) {
    throw new DuplicateEmailException($email, 0, $e);
} catch (ForeignKeyConstraintViolationException $e) {
    throw new ReferencedEntityNotFoundException($e->getMessage(), 0, $e);
}
```

PHP 的 Doctrine 等 ORM 已经为你做了"翻译"工作，直接抛出有意义的异常类型。而 Go 中你需要自己来做这个翻译——这是 Go 更"显式"的代价，也是 Go 更"可控"的好处。

---

## 七、错误处理的工程最佳实践

### 7.1 错误信息应该包含"路径"

Go 的错误包装最重要的实践是：**每一层都添加自己的上下文信息**。

```go
// 好的做法
func (s *OrderService) Process(ctx context.Context, orderID string) error {
    order, err := s.repo.FindByID(ctx, orderID)
    if err != nil {
        return fmt.Errorf("OrderService.Process: 查找订单 %s: %w", orderID, err)
    }

    if err := s.payment.Charge(ctx, order); err != nil {
        return fmt.Errorf("OrderService.Process: 支付订单 %s: %w", orderID, err)
    }

    return nil
}

// 错误消息的最终形态：
// "OrderService.Process: 支付订单 ORD-123: payment.Charge: 请求支付网关超时:
//  Post \"https://pay.example.com/charge\": context deadline exceeded"
```

这条错误链从最底层的网络超时，到支付网关调用，到业务层的订单处理，每一层都附加了上下文。当你在日志中看到这条消息时，不需要任何额外的信息就能定位问题。

### 7.2 不要只返回错误，要决定如何处理

```go
// 不好的做法：机械地向上传递
func (s *Service) DoSomething() error {
    result, err := s.repo.Find()
    if err != nil {
        return err  // 丢失了上下文
    }
    // ...
}

// 不好的做法：到处 log + return
func (s *Service) DoSomething() error {
    result, err := s.repo.Find()
    if err != nil {
        log.Error("查找失败", "err", err)
        return err  // 双重日志：这里记一次，调用者可能还会记一次
    }
    // ...
}

// 好的做法：在"边界层"集中记录日志
func (s *Service) DoSomething() error {
    result, err := s.repo.Find()
    if err != nil {
        return fmt.Errorf("Service.DoSomething: %w", err)
    }
    // ...
}
```

日志应该在"错误的最终消费者"那里记录一次——通常是 HTTP handler、消息处理器、定时任务的顶层函数。中间层只需要包装错误、附加上下文。

### 7.3 Sentinel errors 应该放在公开包中

```go
// package user

// 定义在包级别，用户可以直接 errors.Is(err, user.ErrNotFound)
var (
    ErrNotFound     = errors.New("user: not found")
    ErrUnauthorized = errors.New("user: unauthorized")
)

// 为 sentinel errors 添加包前缀是避免冲突的好习惯
```

### 7.4 不要用 error 做业务分支

```go
// 不好的做法：用 error 来表示正常的业务分支
func CheckBalance(userID int64) (bool, error) {
    balance, err := getBalance(userID)
    if err != nil {
        return false, err
    }
    if balance <= 0 {
        return false, ErrInsufficientBalance  // 这不是"错误"，是业务状态
    }
    return true, nil
}

// 更好的做法：让返回值直接反映业务语义
type BalanceCheckResult struct {
    HasSufficient bool
    Balance       float64
    Shortfall     float64
}

func CheckBalance(userID int64) (*BalanceCheckResult, error) {
    balance, err := getBalance(userID)
    if err != nil {
        return nil, err
    }
    return &BalanceCheckResult{
        HasSufficient: balance >= required,
        Balance:       balance,
        Shortfall:     max(0, required-balance),
    }, nil
}
```

### 7.5 测试中的错误断言

```go
func TestUserRepo_Create_DuplicateEmail(t *testing.T) {
    repo := setupTestRepo(t)

    // 第一次创建应该成功
    err := repo.Create(ctx, &User{Email: "test@example.com"})
    require.NoError(t, err)

    // 第二次创建相同邮箱应该报重复错误
    err = repo.Create(ctx, &User{Email: "test@example.com"})
    require.Error(t, err)
    assert.True(t, errors.Is(err, ErrDuplicateKey),
        "期望 ErrDuplicateKey，实际得到: %v", err)

    // 如果是自定义错误类型，也可以断言字段
    var apiErr *APIError
    if errors.As(err, &apiErr) {
        assert.Equal(t, "DUPLICATE", apiErr.Code)
    }
}
```

---

## 八、哲学总结：显式 vs 隐式、值 vs 控制流

### 8.1 显式 vs 隐式

| 维度 | Go (显式) | PHP (隐式) |
|------|----------|-----------|
| 错误检查 | 每次调用后必须检查 `err != nil` | 不检查则向上抛出，直到被捕获 |
| 错误传播 | 通过返回值逐层传递 | 通过异常栈自动向上传播 |
| 错误忽略 | 必须用 `_ = err` 显式忽略 | 不 catch 就忽略了（或者触发全局处理器） |
| 上下文添加 | 每一层用 `%w` 包装 | 用 `$previous` 参数链接（但经常被省略） |

Go 的显式方式让代码更"长"，但每一层的错误处理意图都是**一目了然**的。你看到 `if err != nil` 就知道"这里可能发生错误，开发者已经考虑过了"。

PHP 的隐式方式让代码更"短"，但你无法确定开发者是否真的考虑过错误情况——他可能只是忘了处理，或者依赖全局的"catch all"来兜底。

### 8.2 值 vs 控制流

Go 的 error 是**值**：它和 int、string 一样，可以被存储、传递、比较、组合。这让你可以非常灵活地对错误做各种操作：

```go
// 错误可以被聚合
err := errors.Join(err1, err2, err3)

// 错误可以被比较
if errors.Is(err, sql.ErrNoRows) { ... }

// 错误可以被提取类型
var pathErr *os.PathError
if errors.As(err, &pathErr) { ... }

// 错误可以被序列化
json.Marshal(err)
```

PHP 的 Exception 是**控制流**：它改变代码的执行路径，从 try 块直接跳到 catch 块。这让 PHP 的错误处理更像是"中断"——你设置了一个"陷阱"（try/catch），任何掉进去的异常都会被导向特定的处理逻辑。

### 8.3 各自的代价

**Go 的代价：**
- 代码冗长——每个可能失败的调用都有 2-3 行的错误检查
- 容易忘记包装上下文——直接 `return err` 会丢失调用路径信息
- 错误检查比较弱——`errors.Is` 只能做值比较，无法像 PHP 那样优雅地按类型分支

**PHP 的代价：**
- 异常可能被意外"吞掉"——空的 catch 块是 PHP 项目中最常见的 bug 来源之一
- 异常的性能开销——构造异常对象需要收集堆栈信息，在高频路径上可能成为瓶颈
- 层级设计的刚性——一旦异常类继承关系确定，修改起来就是"牵一发动全身"

### 8.4 最终观点

Go 和 PHP 的错误处理哲学，本质上反映了两种不同的编程世界观：

**Go 的世界观：** 程序是显式的、可预测的。每一行代码的意图都应该清晰可见，包括错误处理。"看起来笨拙"不等于"设计不好"——恰恰相反，Go 的 error 接口用极简的设计实现了极高的灵活性。

**PHP 的世界观：** 程序是分层的、可中断的。底层代码专注于"做什么"，中间层专注于"怎么传递"，顶层专注于"怎么处理"。异常机制让每一层都可以专注于自己的职责，而不用担心错误如何传播。

两种方式都是优秀的工程实践。关键是理解它们各自适用的场景：

- 在**高并发、高可靠**的后端系统中，Go 的显式错误处理让你更难犯错
- 在**快速迭代、多层抽象**的 Web 应用中，PHP 的异常层级让你的代码更简洁
- 在**微服务架构**中，Go 的 error 值可以方便地跨服务传递（序列化、gRPC status codes）
- 在**复杂业务逻辑**中，PHP 的 try/catch/finally 提供了更自然的事务管理

最终，好的错误处理不是关于选择哪种语言或哪种机制，而是关于**在每一层都做出正确的决策**：这个错误应该被记录、被忽略、被重试，还是被传递给调用者？无论你用 Go 还是 PHP，这个问题的答案都是一样的——只是表达方式不同罢了。

---

## 九、Go error handling vs PHP Exception 全维度对比

为了让你更直观地理解两种错误处理范式的差异，下面用一张表格进行系统性对比：

| 对比维度 | Go error | PHP Exception |
|---------|----------|---------------|
| **错误表达** | 值（实现了 `error` 接口的类型） | 对象（继承 `Throwable` 的类实例） |
| **错误检查** | 显式 `if err != nil`，编译器强制 | 隐式 try/catch，遗漏不报错 |
| **错误传播** | 返回值逐层传递，每一层可包装 | 异常栈自动向上传播 |
| **错误链** | `%w` 包装 + `Unwrap()` 接口 | `$previous` 参数 + `getPrevious()` |
| **类型匹配** | `errors.As` 沿错误链查找 | `catch (SpecificException $e)` 类型层级匹配 |
| **值比较** | `errors.Is` 沿错误链查找 sentinel | 无直接等价物 |
| **多错误聚合** | `errors.Join`（Go 1.20+）原生支持 | 需自定义 `AggregateException` 或第三方库 |
| **堆栈跟踪** | 需要第三方库（如 `pkg/errors`）或实现 `Format` | 原生 `getTraceAsString()`，每次抛出自动收集 |
| **代码冗余度** | 高（每个调用点 2-3 行检查） | 低（try 块内无需检查） |
| **错误忽略** | 必须写 `_ = err`，代码审查可见 | 空 catch 块或不 catch，难以发现 |
| **性能开销** | 极低（值返回，无堆栈收集） | 较高（构造异常时收集调用栈，高频路径有性能影响） |
| **并发友好** | 天然支持（错误可存入 channel、slice） | 需在 goroutine/coroutine 边界捕获，否则会崩溃 |
| **微服务集成** | 可直接映射到 gRPC status codes | 需在网关层手动转换 |
| **可测试性** | `errors.Is`/`errors.As` 断言，简洁明确 | `expectException`/`expectExceptionMessage`，需匹配异常类 |
| **学习曲线** | 简单但啰嗦，初期不适应 | 直觉自然，但高级用法（异常层级设计）复杂 |

### 核心取舍

从这张表可以看出，Go 和 PHP 在错误处理上各有权衡：

- **Go 选择了"显式冗余"来换取"可预测性和可控性"**：你总能在代码中清楚地看到错误在哪里被处理，不存在"魔法"般的隐式传播。
- **PHP 选择了"隐式简洁"来换取"开发效率和表达力"**：try/catch/finally 让你能在一处集中处理多种错误，异常层级让 catch 更加语义化。

在**微服务架构**中，Go 的错误值可以被序列化为 gRPC status codes 并跨服务传递，这使得错误在服务边界处的处理更加标准化。而 PHP 的异常通常需要在 API 网关层统一转换为 HTTP 响应，中间可能丢失类型信息。

在**性能敏感**场景中，Go 的 error 返回值几乎零开销，而 PHP 每次 `throw` 都会构造堆栈信息——在每秒数万次调用的热路径上，这个差异可能非常显著。

---

## 十、踩坑案例：Go 错误处理的常见陷阱

理论再多不如看几个真实的踩坑案例。以下是 Go 开发者在错误处理中最常犯的错误，以及它们可能引发的严重后果。

### 10.1 忽略错误（最常见、最危险）

```go
// ❌ 危险：完全忽略错误
func processFile(path string) {
    data, _ := os.ReadFile(path)  // 如果读取失败，data 是 nil
    // 后续使用 data 时会 panic！
    process(data)
}

// ❌ 危险：吞掉错误但不处理
func updateUser(user *User) error {
    err := db.Save(user)
    _ = err  // 开发者说"我知道这里可能出错，但我不想处理"
    // 数据可能没有被保存，但调用者以为成功了
    return nil
}

// ✅ 正确：检查并处理错误
func processFile(path string) error {
    data, err := os.ReadFile(path)
    if err != nil {
        return fmt.Errorf("读取文件 %s: %w", path, err)
    }
    return process(data)
}
```

在 PHP 中，不 catch 异常至少会触发全局错误处理器并记录日志。但在 Go 中，`_ = err` 会静默地吞掉错误，调用者完全不知道发生了什么。这是 Go 代码中 bug 的主要来源之一。

### 10.2 使用 panic 处理正常业务流程

```go
// ❌ 反模式：用 panic 代替 error 返回
func divide(a, b float64) float64 {
    if b == 0 {
        panic("除数不能为零")  // 这不是 panic 的用法！
    }
    return a / b
}

// 调用者被迫写 recover
func safeDivide(a, b float64) (result float64, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("除法错误: %v", r)
        }
    }()
    return divide(a, b), nil
}

// ✅ 正确：返回 error
func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("除数不能为零")
    }
    return a / b, nil
}
```

Go 中 `panic` 应该**仅用于真正的不可恢复错误**，比如：程序初始化失败、关键依赖不可用、检测到内部 bug（invariant violation）。业务逻辑中的"参数非法""用户不存在"等场景，应该返回 error。

### 10.3 错误包装信息丢失

```go
// ❌ 直接 return err，丢失了调用上下文
func (s *UserService) GetByID(id int64) (*User, error) {
    user, err := s.repo.FindByID(id)
    if err != nil {
        return nil, err  // 调用者看到的错误只有 "record not found"
    }
    return user, nil
}

// ✅ 包装错误并附加上下文
func (s *UserService) GetByID(id int64) (*User, error) {
    user, err := s.repo.FindByID(id)
    if err != nil {
        return nil, fmt.Errorf("UserService.GetByID(%d): %w", id, err)
    }
    return user, nil
}
// 现在错误链是: "UserService.GetByID(42): record not found"
// 调用者既能 errors.Is(err, ErrRecordNotFound) 做判断，又能从消息中定位调用路径
```

### 10.4 重复日志（Double Logging）

```go
// ❌ 中间层和顶层都打日志，导致一条错误在日志中出现两次
func (s *OrderService) Process(ctx context.Context, orderID string) error {
    order, err := s.repo.FindByID(ctx, orderID)
    if err != nil {
        log.Error("查找订单失败", "order_id", orderID, "err", err)  // 第一次
        return fmt.Errorf("Process: %w", err)
    }
    // ...
}

// 调用方
err := orderService.Process(ctx, "ORD-123")
if err != nil {
    log.Error("订单处理失败", "order_id", "ORD-123", "err", err)  // 第二次
}

// ✅ 正确：只在错误的最终消费者处记录日志
func (s *OrderService) Process(ctx context.Context, orderID string) error {
    order, err := s.repo.FindByID(ctx, orderID)
    if err != nil {
        return fmt.Errorf("OrderService.Process: 查找订单 %s: %w", orderID, err)
        // 中间层只包装，不打日志
    }
    // ...
}
```

### 10.5 错误比较陷阱：`==` vs `errors.Is`

```go
var ErrNotFound = errors.New("not found")

func findUser() error {
    return fmt.Errorf("user query: %w", ErrNotFound)
}

err := findUser()

// ❌ 错误：== 比较的是包装后的 error，不是里面的 ErrNotFound
if err == ErrNotFound {
    // 永远不会执行到这里！
}

// ✅ 正确：errors.Is 会沿错误链查找
if errors.Is(err, ErrNotFound) {
    // 正确匹配
}
```

### 10.6 errors.Is 与 errors.As 的进阶用法

`errors.Is` 不仅可以查找 sentinel errors，还可以配合自定义错误的 `Is()` 方法实现更灵活的匹配逻辑：

```go
// 自定义错误实现 Is 方法
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on field '%s': %s", e.Field, e.Message)
}

// 实现 Is 方法：只要目标也是 ValidationError，就按字段名匹配
func (e *ValidationError) Is(target error) bool {
    if t, ok := target.(*ValidationError); ok {
        return e.Field == t.Field
    }
    return false
}

// 使用
err := &ValidationError{Field: "email", Message: "invalid format"}

// 这里 target 不需要完全匹配，只要 Field 相同就行
if errors.Is(err, &ValidationError{Field: "email"}) {
    fmt.Println("邮箱格式错误！")  // ✅ 匹配成功
}
```

`errors.As` 同样可以配合自定义逻辑提取复杂的错误信息：

```go
// 批量操作中收集所有特定类型的错误
func collectValidationErrors(err error) []ValidationError {
    var validationErrs []ValidationError
    var ve *ValidationError

    // 使用 errors.As 的函数形式来遍历所有匹配的错误
    for {
        if errors.As(err, &ve) {
            validationErrs = append(validationErrs, *ve)
            // 继续查找下一个
        }
        break  // 简化示例，实际中需实现错误链遍历
    }
    return validationErrs
}
```

### 10.7 errors.Join 与 errors.Is/As 的协同工作

`errors.Join` 产生的错误支持 `Unwrap() []error` 接口，这使得 `errors.Is` 和 `errors.As` 会**递归搜索所有分支**。这在并行操作中非常有用：

```go
func fetchAllData(urls []string) (map[string][]byte, error) {
    var errs []error
    results := make(map[string][]byte)

    var mu sync.Mutex
    var wg sync.WaitGroup

    for _, url := range urls {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            data, err := http.Get(u)
            if err != nil {
                mu.Lock()
                errs = append(errs, fmt.Errorf("fetch %s: %w", u, err))
                mu.Unlock()
                return
            }
            mu.Lock()
            results[u] = data
            mu.Unlock()
        }(url)
    }
    wg.Wait()

    if len(errs) > 0 {
        return results, errors.Join(errs...)
    }
    return results, nil
}

// 调用方可以精准地检查特定类型的错误
combinedErr := fetchAllData([]string{"url1", "url2", "url3"})
if combinedErr != nil {
    // 检查是否包含超时错误
    var netErr net.Error
    if errors.As(combinedErr, &netErr) && netErr.Timeout() {
        log.Println("至少有一个请求超时，考虑增加超时时间或重试")
    }

    // 检查是否包含连接拒绝
    if errors.Is(combinedErr, syscall.ECONNREFUSED) {
        log.Println("至少有一个服务连接被拒绝，请检查服务状态")
    }

    // 打印所有错误
    fmt.Println(combinedErr.Error())
}
```

> **注意：** `errors.Join` 返回的错误中，`errors.Is` 和 `errors.As` 会遍历所有分支。这意味着只要 Join 中的**任何一个**子错误（或其包装链）匹配目标，就会返回 true。这在某些场景下可能不是你期望的行为——如果你需要"所有子错误都匹配"的语义，需要手动实现。

```go
var ErrNotFound = errors.New("not found")

func findUser() error {
    return fmt.Errorf("user query: %w", ErrNotFound)
}

err := findUser()

// ❌ 错误：== 比较的是包装后的 error，不是里面的 ErrNotFound
if err == ErrNotFound {
    // 永远不会执行到这里！
}

// ✅ 正确：errors.Is 会沿错误链查找
if errors.Is(err, ErrNotFound) {
    // 正确匹配
}
```

### 10.6 errors.As 的常见误用

```go
// ❌ 错误：target 参数必须是指针
var pe os.PathError
if errors.As(err, pe) {  // 编译错误！
    // ...
}

// ✅ 正确：传指针
var pe *os.PathError
if errors.As(err, &pe) {
    fmt.Println(pe.Path)
}

// ❌ 错误：target 是 nil
if errors.As(err, nil) {  // 运行时 panic！
    // ...
}

// ❌ 错误：target 指向的是一个已有值的变量
var pe2 = &os.PathError{Path: "old"}  // 不要用已有值的变量
if errors.As(err, &pe2) {
    // pe2 会被覆盖，但语义上容易混淆
}
```

---

## 十一、生产级错误处理模式

### 11.1 HTTP 中间件统一错误处理（完整实现）

在生产环境中，一个优雅的 Go HTTP 错误处理模式是：业务 handler 返回 `error`，中间件统一拦截并转换为合适的 HTTP 响应。

```go
// HandlerFunc 是一个返回 error 的 HTTP handler
type HandlerFunc func(http.ResponseWriter, *http.Request) error

// ServeHTTP 实现 http.Handler 接口，自动处理错误
func (fn HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    err := fn(w, r)
    if err == nil {
        return
    }

    // 1. 识别已知的业务错误
    var apiErr *APIError
    if errors.As(err, &apiErr) {
        writeJSON(w, apiErr.HTTPStatusCode(), map[string]any{
            "code":    apiErr.Code,
            "message": apiErr.Message,
            "detail":  apiErr.Detail,
        })
        return
    }

    // 2. 识别 context 相关错误
    if errors.Is(err, context.Canceled) {
        writeJSON(w, 499, map[string]string{"code": "CLIENT_CLOSED"})
        return
    }
    if errors.Is(err, context.DeadlineExceeded) {
        writeJSON(w, 504, map[string]string{"code": "GATEWAY_TIMEOUT"})
        return
    }

    // 3. 未知错误：记录完整错误信息，返回 500
    slog.Error("unhandled error",
        "method", r.Method,
        "path", r.URL.Path,
        "err", err,
        "request_id", r.Header.Get("X-Request-ID"),
    )
    writeJSON(w, 500, map[string]string{
        "code":    "INTERNAL_ERROR",
        "message": "服务器内部错误，请稍后重试",
    })
}

// 路由注册
func setupRoutes() http.Handler {
    mux := http.NewServeMux()
    mux.Handle("GET /api/users/{id}", HandlerFunc(GetUserHandler))
    mux.Handle("POST /api/orders", HandlerFunc(CreateOrderHandler))
    return LoggingMiddleware(mux)
}
```

### 11.2 gRPC 错误状态码映射

在微服务架构中，Go 的 error 需要映射到 gRPC status codes。`google.golang.org/grpc/status` 包提供了标准的错误映射机制：

```go
import (
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

// 将业务错误映射到 gRPC status codes
func toGRPCError(err error) error {
    if err == nil {
        return nil
    }

    var apiErr *APIError
    if errors.As(err, &apiErr) {
        switch apiErr.Status {
        case http.StatusBadRequest:
            return status.Error(codes.InvalidArgument, apiErr.Message)
        case http.StatusNotFound:
            return status.Error(codes.NotFound, apiErr.Message)
        case http.StatusConflict:
            return status.Error(codes.AlreadyExists, apiErr.Message)
        case http.StatusUnauthorized:
            return status.Error(codes.Unauthenticated, apiErr.Message)
        case http.StatusForbidden:
            return status.Error(codes.PermissionDenied, apiErr.Message)
        case http.StatusTooManyRequests:
            return status.Error(codes.ResourceExhausted, apiErr.Message)
        default:
            return status.Error(codes.Internal, apiErr.Message)
        }
    }

    // context 错误映射
    if errors.Is(err, context.Canceled) {
        return status.Error(codes.Canceled, "请求被取消")
    }
    if errors.Is(err, context.DeadlineExceeded) {
        return status.Error(codes.DeadlineExceeded, "请求超时")
    }

    return status.Error(codes.Internal, "内部错误")
}

// gRPC service 实现
type UserService struct {
    pb.UnimplementedUserServiceServer
    svc *domain.UserService
}

func (s *UserService) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.User, error) {
    user, err := s.svc.GetByID(ctx, req.Id)
    if err != nil {
        return nil, toGRPCError(err)  // 统一转换
    }
    return &pb.User{
        Id:    user.ID,
        Email: user.Email,
        Name:  user.Name,
    }, nil
}

// 客户端调用
func GetUserFromGRPC(client pb.UserServiceClient, id int64) (*pb.User, error) {
    user, err := client.GetUser(ctx, &pb.GetUserRequest{Id: id})
    if err != nil {
        // 可以根据 gRPC status code 做不同的处理
        st := status.Convert(err)
        switch st.Code() {
        case codes.NotFound:
            return nil, ErrUserNotFound
        case codes.InvalidArgument:
            return nil, fmt.Errorf("无效参数: %w", err)
        default:
            return nil, fmt.Errorf("gRPC 调用失败: %w", err)
        }
    }
    return user, nil
}
```

### 11.3 错误中间件的测试策略

```go
func TestErrorHandler(t *testing.T) {
    tests := []struct {
        name       string
        handler    HandlerFunc
        wantStatus int
        wantCode   string
    }{
        {
            name: "business error - not found",
            handler: func(w http.ResponseWriter, r *http.Request) error {
                return NotFound("用户不存在")
            },
            wantStatus: 404,
            wantCode:   "NOT_FOUND",
        },
        {
            name: "business error - unauthorized",
            handler: func(w http.ResponseWriter, r *http.Request) error {
                return Unauthorized("需要登录")
            },
            wantStatus: 401,
            wantCode:   "UNAUTHORIZED",
        },
        {
            name: "unknown error",
            handler: func(w http.ResponseWriter, r *http.Request) error {
                return fmt.Errorf("database connection lost: %w", errors.New("timeout"))
            },
            wantStatus: 500,
            wantCode:   "INTERNAL_ERROR",
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            req := httptest.NewRequest("GET", "/test", nil)
            rec := httptest.NewRecorder()

            HandlerFunc(tt.handler).ServeHTTP(rec, req)

            assert.Equal(t, tt.wantStatus, rec.Code)

            var resp map[string]string
            json.Unmarshal(rec.Body.Bytes(), &resp)
            assert.Equal(t, tt.wantCode, resp["code"])
        })
    }
}
```

### 11.4 结构化日志中的错误字段

在生产环境中，错误日志应该包含足够的上下文信息以便快速定位问题：

```go
import "log/slog"

func processOrder(ctx context.Context, orderID string) error {
    // 从 context 中提取请求 ID
    requestID := ctx.Value("request_id").(string)
    userID := ctx.Value("user_id").(int64)

    order, err := orderService.GetByID(ctx, orderID)
    if err != nil {
        // 使用 slog 的结构化日志，错误信息一目了然
        slog.Error("订单查询失败",
            "request_id", requestID,
            "user_id", userID,
            "order_id", orderID,
            "error", err,
        )
        return fmt.Errorf("processOrder: 查询订单 %s: %w", orderID, err)
    }
    // ...
}

// 输出的 JSON 日志：
// {"time":"...","level":"ERROR","msg":"订单查询失败",
//  "request_id":"req-abc123","user_id":42,"order_id":"ORD-123",
//  "error":"UserService.GetByID: record not found"}
```

### 11.5 错误恢复（Panic Recovery）在生产环境中的实践

尽管 Go 不鼓励用 panic 处理业务错误，但在某些场景下（如第三方库可能 panic），你需要一个全局的 panic recovery 机制：

```go
// RecoveryMiddleware 捕获所有 panic 并返回 500
func RecoveryMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if r := recover(); r != nil {
                // 记录完整的 panic 信息
                stack := debug.Stack()
                slog.Error("panic recovered",
                    "method", r.Method,
                    "path", r.URL.Path,
                    "panic", r,
                    "stack", string(stack),
                )

                writeJSON(w, 500, map[string]string{
                    "code":    "INTERNAL_ERROR",
                    "message": "服务器内部错误",
                })
            }
        }()
        next.ServeHTTP(w, r)
    })
}

// 中间件链：Recovery 放在最外层
func NewServer() http.Handler {
    mux := setupRoutes()
    return RecoveryMiddleware(LoggingMiddleware(mux))
}
```

> **踩坑提醒：** RecoveryMiddleware 必须放在中间件链的**最外层**（最先执行、最后返回）。如果你把 Recovery 放在 Logging 中间件里面，当 Logging 中间件本身 panic 时，Recovery 无法捕获。

---

## 十二、踩坑案例续：Go 错误处理的进阶陷阱

### 12.1 errors.Join 的 nil 陷阱

```go
// errors.Join 会忽略 nil 的 error，这很方便：
err := errors.Join(nil, errors.New("first error"), nil, errors.New("second error"))
// err.Error() == "first error\nsecond error"

// 但要注意：如果你把 nil error 传入 fmt.Errorf 的 %w，它不会 panic，但会得到一个意外的包装：
err := fmt.Errorf("wrapped: %w", nil)  // 这不会 panic，但 err.Error() == "wrapped: <nil>"
// 而 errors.Is(err, nil) == false
```

### 12.2 自定义 Unwrap 的递归问题

```go
// ❌ 错误：循环引用导致 errors.Is/errors.As 无限递归
type BadError struct {
    cause error
}

func (e *BadError) Error() string { return e.cause.Error() }
func (e *BadError) Unwrap() error { return e }  // 返回自己！

// errors.Is(err, target) 会无限循环，直到栈溢出

// ✅ 正确：Unwrap 返回真正的内部错误
type GoodError struct {
    cause error
}

func (e *GoodError) Error() string { return e.cause.Error() }
func (e *GoodError) Unwrap() error { return e.cause }  // 返回内部错误
```

### 12.3 并发环境下的错误处理

```go
// ❌ 危险：多个 goroutine 同时写入同一个 error 变量
var sharedErr error

for _, item := range items {
    go func(item Item) {
        if err := process(item); err != nil {
            sharedErr = err  // 竞态条件！多个 goroutine 可能同时写入
        }
    }(item)
}

// ✅ 正确：使用 channel 或 errors.Join
func processAll(items []Item) error {
    errs := make(chan error, len(items))

    var wg sync.WaitGroup
    for _, item := range items {
        wg.Add(1)
        go func(item Item) {
            defer wg.Done()
            if err := process(item); err != nil {
                errs <- fmt.Errorf("process %s: %w", item.ID, err)
            }
        }(item)
    }

    // 等待所有 goroutine 完成
    go func() {
        wg.Wait()
        close(errs)
    }()

    // 收集所有错误
    var allErrors []error
    for err := range errs {
        allErrors = append(allErrors, err)
    }

    if len(allErrors) > 0 {
        return errors.Join(allErrors...)
    }
    return nil
}
```

### 12.4 错误断言的性能考量

```go
// errors.As 和 errors.Is 在错误链较长时可能有性能开销
// 在热路径上，可以考虑缓存断言结果或使用更高效的数据结构

// ❌ 在循环中反复对同一错误做断言
for i := 0; i < 10000; i++ {
    if errors.Is(err, ErrNotFound) {  // 每次都遍历错误链
        // ...
    }
}

// ✅ 提前断言，避免重复遍历
isNotFound := errors.Is(err, ErrNotFound)
for i := 0; i < 10000; i++ {
    if isNotFound {
        // ...
    }
}
```

### 12.5 错误包装的最佳实践总结

经过以上踩坑案例的分析，我们可以总结出 Go 错误处理的几条黄金法则。这些原则不仅是代码规范，更是团队协作的工程契约——当每个人都在遵循同样的错误处理范式时，代码的可维护性和可调试性会大幅提升。

1. **永远不要忽略错误**，即使你确定它不会出错，也要写 `_ = err` 并加上注释说明原因
2. **在每一层都用 `%w` 包装错误**，附加上下文信息，让错误链成为"自文档化"的调用路径
3. **不要用 panic 处理业务错误**，panic 只用于真正的不可恢复场景
4. **只在错误的最终消费者处打日志**，中间层只负责包装和传递
5. **使用 errors.Is 和 errors.As 做错误匹配**，不要用 `==` 或类型断言
6. **在并发场景中使用 channel 或 errors.Join 收集错误**，避免竞态条件
7. **为自定义错误实现 Is 方法**，提供更灵活的匹配逻辑

这些原则不仅适用于 Go，对任何需要处理错误的系统都有参考价值。错误处理的质量往往决定了一个系统在生产环境中的可靠性——它不是"锦上添花"，而是"基础工程"。

---

## 相关阅读

- [Rust 错误处理哲学：Result/Option/thiserror/anyhow——对比 PHP Exception 和 Go error 的设计权衡](/categories/架构/rust-error-handling-philosophy-result-option-thiserror-anyhow/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/categories/架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
- [Go + gRPC 实战：高性能微服务间通信——Proto 定义、流式调用与 Laravel 集成](/categories/架构/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/)
- [Elixir OTP 实战：Supervisor 树、GenServer、分布式进程——对比 PHP-FPM 无状态模型的并发哲学](/categories/架构/Elixir-OTP-实战-Supervisor树-GenServer-分布式进程-对比PHP-FPM无状态模型的并发哲学/)

---

> **参考资源：**
> - [Go Blog: Error handling and Go](https://go.dev/blog/error-handling-and-go)
> - [Go Blog: Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
> - [Go 1.20 Release Notes: errors.Join](https://go.dev/doc/go1.20#errors)
> - [PHP: Exception 类](https://www.php.net/manual/zh/class.exception.php)
> - [PHP: Throwable 接口](https://www.php.net/manual/zh/class.throwable.php)
