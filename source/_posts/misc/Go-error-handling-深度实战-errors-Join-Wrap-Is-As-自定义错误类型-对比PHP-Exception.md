---
title: 'Go error handling 深度实战：errors.Join/Wrap/Is/As 与自定义错误类型——对比 PHP Exception 层级的设计哲学'
date: 2026-06-07 10:00:00
tags: [Go, error-handling, PHP, 设计模式, 后端开发]
description: "从 PHP 转 Go，最不适应的就是错误处理？本文深入对比 Go error handling 与 PHP Exception 的设计哲学差异。详解 errors.Join 合并多错误、fmt.Errorf + %w 包装错误链、errors.Is 按值匹配、errors.As 按类型提取、以及自定义错误类型的工程实践。通过丰富的代码示例、踩坑案例和对比表格，帮你理解'错误是值'的核心理念，掌握 Go 错误处理的最佳实践。适合 PHP/Go 双栈开发者阅读。"
categories: [后端]
cover: /images/covers/go-error-handling-php-exception-cover.jpg
---

## 前言

如果你从 PHP 转到 Go，最让你不适应的大概率不是语法、不是并发模型，而是错误处理。在 PHP 里，一个 `try-catch` 可以把整段逻辑包裹起来，异常沿着调用栈自动向上传播，直到被某个 `catch` 捕获或者触发全局的 `set_exception_handler`。代码干净利落，逻辑清晰——你只需要关心正常路径，异常路径交给 catch 就好。

而 Go 的世界里，每个函数调用后面都跟着一个 `if err != nil`，代码看起来"又臭又长"。很多从 PHP 转过来的开发者第一反应是："这也太啰嗦了吧？"甚至有人写出了各种 error handling 的"语法糖"库，试图把 Go 的错误处理伪装成 try-catch 的样子。

但当你真正深入 Go 的 error 体系——从最基础的 `error` 接口，到 `errors.Is`/`errors.As` 的类型穿透，再到 Go 1.20 引入的 `errors.Join`——你会发现这套设计背后有着极其清晰的哲学：**错误是值（errors are values），不是控制流的逃逸通道**。

这种哲学选择不是偶然的。Go 的设计者们（Rob Pike、Ken Thompson、Robert Griesemer）在设计这门语言时，仔细审视了当时主流语言的异常处理机制——Java 的 checked exception、Python 的 try-except、C++ 的 throw/catch、PHP 的 Exception 层级——最终做出了一个看似"退化"实则深思熟虑的决定：**不引入异常机制，让错误成为普通的返回值**。

本文将从实战角度，带你深入理解 Go error handling 的方方面面，并与 PHP 的 Exception 层级体系做系统性对比。无论你是从 PHP 转 Go 的开发者，还是想深入理解两种语言设计哲学的工程师，这篇文章都能给你带来启发。

---

## 一、Go error 接口基础与哲学

### 1.1 error 只是一个接口

Go 的 `error` 接口定义极其简洁：

```go
type error interface {
    Error() string
}
```

就这么一行。任何实现了 `Error() string` 方法的类型都是一个 `error`。这种极简设计体现了 Go 的核心哲学：**用最简单的抽象解决最普遍的问题**。

让我们看看 `error` 接口在标准库中的底层实现：

```go
// errors 包中的最简单实现
type errorString struct {
    s string
}

func New(text string) error {
    return &errorString{text}
}

func (e *errorString) Error() string {
    return e.s
}
```

对比 PHP，异常体系要复杂得多。PHP 7 引入了 `Throwable` 接口作为所有可抛出对象的顶层，形成了一个庞大的继承树：

```
Throwable (interface)
├── Error (class)
│   ├── TypeError
│   ├── DivisionByZeroError
│   ├── ParseError
│   ├── ArithmeticError
│   │   └── DivisionByZeroError
│   └── AssertionError
└── Exception (class)
    ├── BadFunctionCallException
    │   └── BadMethodCallException
    ├── InvalidArgumentException
    ├── LengthException
    ├── LogicException
    ├── OutOfRangeException
    ├── RuntimeException
    │   ├── OutOfBoundsException
    │   ├── OverflowException
    │   ├── UnderflowException
    │   └── UnexpectedValueException
    ├── PDOException
    └── ...
```

PHP 用一整棵继承树来分类错误，Go 用一个接口。这不是偷懒，而是刻意的设计选择。Go 的设计者认为，异常继承树会让开发者陷入"我该用哪个基类"的选择困难症，而一个接口就足以表达"这个东西是一个错误"的概念。

### 1.2 显式错误 vs 异常抛出

Go 的错误处理遵循一个核心原则：**错误处理必须是显式的**。

```go
// Go 风格：调用者必须立即处理错误
result, err := doSomething()
if err != nil {
    return fmt.Errorf("doSomething failed: %w", err)
}
use(result)
```

```php
// PHP 风格：异常自动向上传播
try {
    $result = doSomething();
    use($result);
} catch (SomeException $e) {
    // 处理错误
}
```

两种方式的哲学差异在于：

| 维度 | Go (显式错误) | PHP (异常传播) |
|------|-------------|---------------|
| 错误可见性 | 每个可能失败的调用都必须检查 | 可以用一个 try 包裹一大段 |
| 代码量 | 多，但意图清晰 | 少，但可能忽略错误 |
| 控制流 | 正常返回，不中断 | 中断当前执行流，跳到 catch |
| 心智模型 | 错误是值，和其他返回值一样 | 错误是异常情况，需要特殊机制 |
| 编译期检查 | 未使用的 err 会报错（至少 lint 会告警） | 不检查异常的话编译器不报错 |
| 性能 | 零开销（就是普通返回值） | 异常创建有栈展开开销 |
| 可组合性 | 高（值可以自由传递和组合） | 中（受 try-catch 作用域限制） |

Go 的设计哲学来源于 2012 年 Rob Pike 的经典文章 *Errors are values*：error 就是一个普通的值，你对它做什么操作完全由你自己决定，语言不会替你做决定。这个理念贯穿了 Go 语言错误处理的方方面面。

### 1.3 为什么 Go 不引入 try-catch

这是新 Go 开发者最常问的问题之一。答案涉及几个层面：

**第一，显式优于隐式**。try-catch 会让错误处理变得"隐形"——你看到一段代码被 try 包裹，但不知道里面有多少种可能的异常，也不知道哪些行可能抛出异常。Go 的 `if err != nil` 虽然啰嗦，但每一行可能失败的代码都清清楚楚地标注了错误处理逻辑。

**第二，异常有性能开销**。当一个异常被抛出时，运行时需要展开调用栈、查找匹配的 catch 块、执行 finally 块。这个过程比普通的函数返回慢几个数量级。Go 的错误返回就是一个普通的 return，没有任何额外开销。

**第三，异常容易被滥用为控制流**。在很多 PHP 项目中，你经常看到有人用异常来跳出多层嵌套的循环或函数调用——这不是异常的本意，但 try-catch 让这种滥用变得很方便。Go 强制你用正常的控制流来处理逻辑，用 error 来处理真正的错误。

---

## 二、errors.New 与 fmt.Errorf：创建错误的两种姿势

### 2.1 errors.New：最基础的错误创建

```go
var ErrNotFound = errors.New("resource not found")

func GetUser(id int) (*User, error) {
    user, exists := db.Find(id)
    if !exists {
        return nil, ErrNotFound
    }
    return user, nil
}
```

`errors.New` 返回的是一个实现了 `error` 接口的不可变字符串。它的底层类型是 `*errors.errorString`，但你永远不需要关心这个——你只需要知道它是一个 error。

**关键特性**：`errors.New` 返回的是指针类型，这意味着每次调用 `errors.New("not found")` 都会创建一个新的错误实例。但如果你把结果赋给包级变量（如上面的 `ErrNotFound`），它就变成了一个全局唯一的哨兵值。

### 2.2 fmt.Errorf 与 %w：带上下文的错误

```go
func GetUser(id int) (*User, error) {
    user, exists := db.Find(id)
    if !exists {
        return nil, fmt.Errorf("GetUser: user %d not found: %w", id, ErrNotFound)
    }
    return user, nil
}
```

`%w` 动词（Go 1.13+）是关键——它把原始错误"包装"进新的错误中，形成一条链。而普通的 `%v` 或 `%s` 只是把错误转成字符串，丢失了原始错误的信息。

```go
// %w —— 保留错误链（可以被 errors.Is/As 解包）
err := fmt.Errorf("outer: %w", innerErr)

// %v —— 丢失错误链（只能看到字符串，无法解包）
err := fmt.Errorf("outer: %v", innerErr)
```

`fmt.Errorf` 还支持同时包装多个错误（Go 1.20+）：

```go
err := fmt.Errorf("multiple errors: %w %w", err1, err2)
// 底层调用 errors.Join(err1, err2) 进行包装
```

### 2.3 Sentinel Errors：预定义的"哨兵"错误

```go
var (
    ErrNotFound     = errors.New("not found")
    ErrUnauthorized = errors.New("unauthorized")
    ErrForbidden    = errors.New("forbidden")
    ErrConflict     = errors.New("conflict")
)
```

Sentinel errors 就像 PHP 里的预定义异常类，但它们是**值**而不是类型。在 PHP 中你会写 `throw new NotFoundException()`，在 Go 中你会 `return nil, ErrNotFound`。

在 Go 标准库中，sentinel errors 随处可见：

```go
// io 包
var EOF = errors.New("EOF")
var ErrUnexpectedEOF = errors.New("unexpected EOF")
var ErrClosedPipe = errors.New("io: read/write on closed pipe")

// sql 包
var ErrNoRows = errors.New("sql: no rows in result set")
var ErrTxDone = errors.New("sql: transaction has already been committed or rolled back")

// os 包
var ErrNotExist = errors.New("file does not exist")
var ErrExist = errors.New("file already exists")
```

**踩坑记录 1：命名惯例**。Sentinel errors 的命名惯例是以 `Err` 开头，而不是 `Error`。`Error` 前缀通常留给方法名（如 `func (e *MyError) Error() string`）和自定义错误类型名（如 `type NotFoundError struct`）。如果你看到 `var ErrorNotFound` 这种命名，大概率是 PHP/Java 转来的同事写的。Go 社区的惯例是：

```go
// ✅ 哨兵错误：Err + 名词
var ErrNotFound = errors.New("not found")

// ✅ 自定义错误类型：名词 + Error
type NotFoundError struct { ... }

// ❌ 不推荐的命名
var ErrorNotFound = errors.New("not found")  // 混淆了值和类型
```

---

## 三、errors.Wrap/Unwrap：链式错误追踪

### 3.1 错误链的结构

Go 的错误可以一层一层地包装，形成一个链式结构。这是 Go 错误处理中最重要的概念之一——**错误链（error chain）**。用架构图来表示：

```
┌──────────────────────────────────────────────────────────────┐
│  最外层错误 (fmt.Errorf "handle request: %w", err)           │
│  Error() → "handle request: get user: user 123 not found"   │
│  Unwrap() → ↓                                               │
├──────────────────────────────────────────────────────────────┤
│  中间层错误 (fmt.Errorf "get user: %w", err)                │
│  Error() → "get user: user 123 not found"                   │
│  Unwrap() → ↓                                               │
├──────────────────────────────────────────────────────────────┤
│  最内层错误 (ErrNotFound)                                     │
│  Error() → "not found"                                      │
│  Unwrap() → nil                                             │
└──────────────────────────────────────────────────────────────┘
```

每一层都添加了有用的上下文信息。当你在日志中看到 `"handle request: get user: user 123 not found"`，你立刻知道错误是从哪里来的、经过了哪些层。这比 PHP 中常见的 `throw new Exception("not found")` 要有用得多。

### 3.2 手动实现 Unwrap

除了 `fmt.Errorf` 的 `%w`，你也可以在自定义错误类型中手动实现 `Unwrap()` 方法：

```go
type QueryError struct {
    Query string
    Err   error
}

func (e *QueryError) Error() string {
    return "query " + e.Query + ": " + e.Err.Error()
}

func (e *QueryError) Unwrap() error {
    return e.Err
}
```

这个模式在实际项目中非常常见。比如你有一个数据库查询层，可以把 SQL 查询语句和原始错误一起包装：

```go
func (r *UserRepo) FindByEmail(ctx context.Context, email string) (*User, error) {
    var user User
    err := r.db.QueryRowContext(ctx, "SELECT id, name, email FROM users WHERE email = ?", email).
        Scan(&user.ID, &user.Name, &user.Email)
    if err != nil {
        return nil, &QueryError{
            Query: "SELECT ... FROM users WHERE email = ?",
            Err:   err,
        }
    }
    return &user, nil
}
```

### 3.3 多层 Unwrap（Go 1.20+）

Go 1.20 扩展了 Unwrap 的能力，允许一个错误同时 unwrap 出多个错误：

```go
// 实现 Unwrap() []error 接口
type MultiError struct {
    Errors []error
}

func (e *MultiError) Error() string {
    msgs := make([]string, len(e.Errors))
    for i, err := range e.Errors {
        msgs[i] = err.Error()
    }
    return strings.Join(msgs, "; ")
}

func (e *MultiError) Unwrap() []error {
    return e.Errors
}
```

这就是 `errors.Join` 的基础，我们后面会详细讲。

### 3.4 错误链在实际调试中的价值

在实际项目中，错误链的价值在调试时体现得淋漓尽致。想象一个微服务架构中的请求处理链路：

```
HTTP Handler → Service Layer → Repository Layer → Database Driver
```

如果每一层都用 `fmt.Errorf` 包装了上下文，最终的错误消息会是这样的：

```
handle POST /api/orders: create order: insert into orders table: 
  pq: duplicate key value violates unique constraint "orders_pkey"
```

你不需要翻日志、不需要看调用栈，光看这条错误消息就知道：这是一个 HTTP POST 请求、要创建订单、插入数据库时遇到了主键冲突。这比 PHP 中常见的 `PDOException: SQLSTATE[23505]` 要友好得多。

---

## 四、errors.Is / errors.As：错误判断的利器

### 4.1 errors.Is：穿透链判断

`errors.Is` 会沿着错误链逐层调用 `Unwrap()`，检查是否有任何一层等于目标错误：

```go
err := GetUser(123)
if errors.Is(err, ErrNotFound) {
    // 返回 404
    w.WriteHeader(http.StatusNotFound)
    return
}
```

这比直接比较 `err == ErrNotFound` 强大得多，因为即使错误被层层包装，`errors.Is` 依然能穿透到最内层。

**对比 PHP**：

```php
// PHP 的做法：用 instanceof 判断异常类型
try {
    $user = $service->getUser(123);
} catch (NotFoundException $e) {
    return response()->json(['error' => 'not found'], 404);
}
```

PHP 用类型层次结构分类错误，Go 用错误链上的值比较。本质上都是在做"这是什么类型的错误"的判断，只是机制不同。

`errors.Is` 的底层实现原理（简化版）：

```go
func Is(err, target error) bool {
    // 直接比较
    if err == target {
        return true
    }
    // 如果 target 实现了 is(error) bool 接口
    if x, ok := target.(interface{ is(error) bool }); ok {
        return x.is(err)
    }
    // 沿着错误链遍历
    for err != nil {
        if err == target {
            return true
        }
        // 支持 Unwrap() error（单错误）
        if u, ok := err.(interface{ Unwrap() error }); ok {
            err = u.Unwrap()
            continue
        }
        // 支持 Unwrap() []error（多错误，Go 1.20+）
        if u, ok := err.(interface{ Unwrap() []error }); ok {
            for _, e := range u.Unwrap() {
                if Is(e, target) {
                    return true
                }
            }
        }
        break
    }
    return false
}
```

### 4.2 errors.As：类型断言穿透

`errors.As` 沿着错误链查找第一个匹配目标类型的错误，并将其赋值给目标变量：

```go
var validationErr *ValidationError
if errors.As(err, &validationErr) {
    // 可以访问 validationErr 的具体字段
    fmt.Printf("字段 %s 验证失败: %s\n", validationErr.Field, validationErr.Message)
}
```

完整示例：

```go
type ValidationError struct {
    Field   string
    Message string
    Code    int
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error on field '%s': %s", e.Field, e.Message)
}

func CreateUser(req CreateUserRequest) error {
    if req.Name == "" {
        return &ValidationError{
            Field:   "name",
            Message: "name is required",
            Code:    1001,
        }
    }
    if req.Email == "" {
        return &ValidationError{
            Field:   "email",
            Message: "email is required",
            Code:    1002,
        }
    }
    return nil
}

func HandleCreateUser(w http.ResponseWriter, r *http.Request) {
    err := CreateUser(parseRequest(r))
    if err != nil {
        var ve *ValidationError
        if errors.As(err, &ve) {
            // 返回结构化的验证错误
            w.WriteHeader(http.StatusBadRequest)
            json.NewEncoder(w).Encode(map[string]interface{}{
                "field":   ve.Field,
                "message": ve.Message,
                "code":    ve.Code,
            })
            return
        }
        // 其他错误，返回 500
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{
            "error": "internal server error",
        })
    }
}
```

### 4.3 Is vs == 的微妙区别

```go
err1 := errors.New("not found")
err2 := errors.New("not found")

fmt.Println(err1 == err2)        // false —— 不同的指针
fmt.Println(errors.Is(err1, err2)) // false —— 不是同一个错误

// 但是，对于实现了 comparable 接口的自定义错误：
type StatusError struct {
    Code int
}

// errors.Is 还会检查 errors 链上是否有任何一层 match
```

**踩坑记录 2：不要用 errors.Is 比较错误消息**。`errors.Is` 比较的是错误值（identity），不是错误内容（equality）。如果你想根据错误消息做判断，应该用自定义错误类型 + `errors.As`。这是一个非常常见的错误，特别是从动态语言转来的开发者。

### 4.4 errors.Is 与 errors.As 的使用时机总结

```
需要判断"这是不是某个特定错误"？ → errors.Is
需要判断"这是不是某种类型的错误，并获取其字段"？ → errors.As
需要判断"错误链中有没有某个特定错误"？ → errors.Is
需要判断"错误链中有没有某种类型的错误"？ → errors.As
```

---

## 五、errors.Join：多错误聚合（Go 1.20+）

### 5.1 为什么需要 errors.Join

在实际项目中，一个操作可能同时触发多个错误。比如表单验证时，用户可能同时填错了多个字段；批量操作时，部分成功部分失败；并发请求时，多个 goroutine 同时返回错误。

Go 1.20 引入的 `errors.Join` 就是解决这个问题的：

```go
func ValidateUser(u *User) error {
    var errs []error

    if u.Name == "" {
        errs = append(errs, fmt.Errorf("name is required"))
    }
    if u.Email == "" {
        errs = append(errs, fmt.Errorf("email is required"))
    }
    if u.Age < 0 || u.Age > 150 {
        errs = append(errs, fmt.Errorf("age must be between 0 and 150"))
    }

    if len(errs) > 0 {
        return errors.Join(errs...)
    }
    return nil
}
```

### 5.2 errors.Join 的内部机制

`errors.Join` 返回的错误的 `Error()` 方法会把所有错误消息用 `\n` 连接。更重要的是，它实现了 `Unwrap() []error` 接口，这使得 `errors.Is` 和 `errors.As` 可以遍历所有的子错误：

```go
var err1 = errors.New("error 1")
var err2 = errors.New("error 2")
joined := errors.Join(err1, err2)

fmt.Println(errors.Is(joined, err1)) // true
fmt.Println(errors.Is(joined, err2)) // true
```

`errors.Join` 的内部实现（简化版）：

```go
func Join(errs ...error) error {
    n := 0
    for _, err := range errs {
        if err != nil {
            n++
        }
    }
    if n == 0 {
        return nil
    }
    e := &joinError{
        errs: make([]error, 0, n),
    }
    for _, err := range errs {
        if err != nil {
            e.errs = append(e.errs, err)
        }
    }
    return e
}

type joinError struct {
    errs []error
}

func (e *joinError) Error() string {
    // 所有错误消息用换行连接
    var buf []byte
    for i, err := range e.errs {
        if i > 0 {
            buf = append(buf, '\n')
        }
        buf = append(buf, err.Error()...)
    }
    return string(buf)
}

func (e *joinError) Unwrap() []error {
    return e.errs
}
```

### 5.3 批量操作的错误处理实战

```go
func ImportUsers(users []User) error {
    var (
        importErrs []error
        success    int
    )

    for i, user := range users {
        if err := createUser(user); err != nil {
            importErrs = append(importErrs, fmt.Errorf("row %d: %w", i, err))
            continue
        }
        success++
    }

    if len(importErrs) > 0 {
        return fmt.Errorf("import completed with %d/%d failures: %w",
            len(importErrs), len(users), errors.Join(importErrs...))
    }
    return nil
}
```

### 5.4 并发场景中的错误聚合

`errors.Join` 在并发场景中特别有用。想象你需要同时调用多个外部 API：

```go
func FetchDashboardData(ctx context.Context) (*Dashboard, error) {
    var (
        mu       sync.Mutex
        errs     []error
        dashboard Dashboard
    )

    var wg sync.WaitGroup

    wg.Add(3)
    go func() {
        defer wg.Done()
        orders, err := orderService.GetRecent(ctx)
        if err != nil {
            mu.Lock()
            errs = append(errs, fmt.Errorf("fetch orders: %w", err))
            mu.Unlock()
            return
        }
        mu.Lock()
        dashboard.Orders = orders
        mu.Unlock()
    }()

    go func() {
        defer wg.Done()
        stats, err := analyticsService.GetSummary(ctx)
        if err != nil {
            mu.Lock()
            errs = append(errs, fmt.Errorf("fetch analytics: %w", err))
            mu.Unlock()
            return
        }
        mu.Lock()
        dashboard.Stats = stats
        mu.Unlock()
    }()

    go func() {
        defer wg.Done()
        notifications, err := notifService.GetUnread(ctx)
        if err != nil {
            mu.Lock()
            errs = append(errs, fmt.Errorf("fetch notifications: %w", err))
            mu.Unlock()
            return
        }
        mu.Lock()
        dashboard.Notifications = notifications
        mu.Unlock()
    }()

    wg.Wait()

    if len(errs) > 0 {
        return nil, errors.Join(errs...)
    }
    return &dashboard, nil
}
```

这个模式的核心思想是：**尽可能地获取数据，只在所有数据都失败时才报错**。如果订单数据获取成功但通知数据失败了，用户仍然能看到大部分有用的 dashboard 内容。

### 5.5 errors.Join vs fmt.Errorf + %v

你可能会问：我用 `fmt.Errorf("err1: %v; err2: %v", err1, err2)` 不行吗？

| 特性 | errors.Join | fmt.Errorf + %v |
|------|------------|----------------|
| 保留错误链 | ✅ Unwrap() []error | ❌ 丢失链信息 |
| errors.Is/As 可穿透 | ✅ | ❌ |
| 多错误语义 | ✅ 平等的多个错误 | ❌ 只是一个拼接字符串 |
| 错误消息格式 | 换行分隔 | 自定义 |
| 错误数量 | 可变 | 固定 |

---

## 六、自定义错误类型设计模式

### 6.1 基础模式：带上下文的错误

```go
type AppError struct {
    Code    int    `json:"code"`
    Message string `json:"message"`
    Detail  string `json:"detail,omitempty"`
    Err     error  `json:"-"`
}

func (e *AppError) Error() string {
    if e.Err != nil {
        return fmt.Sprintf("[%d] %s: %s", e.Code, e.Message, e.Err.Error())
    }
    return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

func (e *AppError) Unwrap() error {
    return e.Err
}

// 便捷构造函数
func NewAppError(code int, message string, err error) *AppError {
    return &AppError{Code: code, Message: message, Err: err}
}

// 用法
func GetUser(id int) (*User, error) {
    user, err := db.FindUser(id)
    if err != nil {
        return nil, NewAppError(1001, "failed to get user", err)
    }
    if user == nil {
        return nil, NewAppError(4004, "user not found", nil)
    }
    return user, nil
}
```

### 6.2 进阶模式：错误分类与 HTTP 状态码映射

```go
// 用 iota 定义错误分类
type ErrorKind int

const (
    KindNotFound     ErrorKind = iota // 404
    KindUnauthorized                   // 401
    KindForbidden                      // 403
    KindValidation                     // 400
    KindConflict                       // 409
    KindInternal                       // 500
)

func (k ErrorKind) HTTPStatus() int {
    switch k {
    case KindNotFound:
        return http.StatusNotFound
    case KindUnauthorized:
        return http.StatusUnauthorized
    case KindForbidden:
        return http.StatusForbidden
    case KindValidation:
        return http.StatusBadRequest
    case KindConflict:
        return http.StatusConflict
    default:
        return http.StatusInternalServerError
    }
}

type DomainError struct {
    Kind    ErrorKind
    Message string
    Err     error
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Err }

// 便捷构造函数
func NotFound(msg string) *DomainError {
    return &DomainError{Kind: KindNotFound, Message: msg}
}

func Validation(msg string) *DomainError {
    return &DomainError{Kind: KindValidation, Message: msg}
}

func Internal(msg string, err error) *DomainError {
    return &DomainError{Kind: KindInternal, Message: msg, Err: err}
}
```

### 6.3 错误中间件：统一错误响应

```go
func ErrorHandler(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 使用 recover 捕获 panic
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("PANIC recovered: %v\n%s", rec, debug.Stack())
                w.WriteHeader(http.StatusInternalServerError)
                json.NewEncoder(w).Encode(map[string]string{
                    "error": "internal server error",
                })
            }
        }()

        next.ServeHTTP(w, r)
    })
}

func WriteError(w http.ResponseWriter, err error) {
    var de *DomainError
    if errors.As(err, &de) {
        w.WriteHeader(de.Kind.HTTPStatus())
        json.NewEncoder(w).Encode(map[string]interface{}{
            "error": de.Message,
            "code":  int(de.Kind),
        })
        return
    }
    // 未知错误，返回 500，但不在响应中暴露内部信息
    log.Printf("Unhandled error: %+v", err)
    w.WriteHeader(http.StatusInternalServerError)
    json.NewEncoder(w).Encode(map[string]string{
        "error": "internal server error",
    })
}
```

**对比 PHP Laravel**：

```php
// Laravel 的做法：直接 throw，由异常处理器统一转换
class UserController extends Controller
{
    public function show(int $id)
    {
        $user = $this->service->find($id);
        // NotFoundException 会被框架的异常处理器自动转为 404 JSON 响应
        if (!$user) {
            throw new NotFoundException('User not found');
        }
        return response()->json($user);
    }
}

// Laravel 的 Handler.php
public function render($request, Throwable $e)
{
    if ($e instanceof NotFoundException) {
        return response()->json(['error' => $e->getMessage()], 404);
    }
    if ($e instanceof ValidationException) {
        return response()->json(['errors' => $e->errors()], 422);
    }
    return parent::render($request, $e);
}
```

两者的核心思路一样——**错误类型决定 HTTP 响应**，只是实现机制不同：Go 用类型断言 + 中间件，PHP 用异常继承 + 全局处理器。

---

## 七、error 与 panic/recover 的使用边界

### 7.1 什么时候用 error，什么时候用 panic

Go 社区有一个明确的共识：**panic 用于不可恢复的程序错误，error 用于可预期的业务错误**。

```go
// ✅ 正确：用 error 处理可预期的失败
func ReadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("read config %s: %w", path, err)
    }
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("parse config %s: %w", path, err)
    }
    return &cfg, nil
}

// ✅ 正确：用 panic 处理不可能发生的情况（程序员的 bug）
func Must(err error) {
    if err != nil {
        panic(err) // 程序员保证这里不会出错，如果出了，说明代码有 bug
    }
}

// 标准库中的类似用法：template.Must
var tmpl = template.Must(template.New("main").Parse(`
    <h1>{{.Title}}</h1>
`))
```

### 7.2 panic 的典型使用场景

```go
// 场景 1：程序初始化时的致命错误
func init() {
    if os.Getenv("DATABASE_URL") == "" {
        panic("DATABASE_URL environment variable is required")
    }
}

// 场景 2：不可到达的代码
func handleHTTPMethod(method string) {
    switch method {
    case "GET":
        handleGet()
    case "POST":
        handlePost()
    default:
        panic("unreachable: unexpected HTTP method " + method)
    }
}

// 场景 3：开发时的断言（类似 PHP 的 assert）
func assert(condition bool, msg string) {
    if !condition {
        panic("assertion failed: " + msg)
    }
}
```

### 7.3 recover 的正确使用

```go
// ✅ 正确：在服务器入口处用 recover 防止一个请求的 panic 搞垮整个进程
func RecoverMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic recovered: %v\n%s", rec, debug.Stack())
                w.WriteHeader(http.StatusInternalServerError)
                json.NewEncoder(w).Encode(map[string]string{
                    "error": "internal server error",
                })
            }
        }()
        next.ServeHTTP(w, r)
    })
}

// ✅ 正确：在 goroutine 中用 recover 防止 goroutine 泄漏
func safeGo(fn func()) {
    go func() {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("goroutine panic: %v\n%s", rec, debug.Stack())
            }
        }()
        fn()
    }()
}
```

### 7.4 PHP 对比：Checked vs Unchecked Exception

PHP 没有 checked exception 的概念（不像 Java），但 Laravel 社区有约定俗成的异常分类：

```php
// 业务异常（可预期）→ 返回 HTTP 响应
throw new ValidationException($errors);    // 422
throw new NotFoundException();              // 404
throw new AuthenticationException();        // 401

// 程序异常（不可预期）→ 记录日志，返回 500
throw new \RuntimeException('database connection failed');
throw new \Error('type error');             // PHP 7+ 的 Error 类
```

Go 的 panic/recover 和 PHP 的 Error/Exception 分层本质上是同一思想的不同表达：**把"程序出了 bug"和"业务逻辑失败"分开处理**。

---

## 八、对比 PHP Exception 层级体系

### 8.1 两种设计哲学的根本差异

PHP 的异常体系（PHP 7+）和 Go 的错误体系代表了两种截然不同的设计哲学。

PHP 选择了一种**面向对象的分类法**——通过继承层次来组织错误类型。你可以用 `instanceof` 判断一个异常是否属于某个父类，从而用一个 catch 块捕获一整类异常：

```php
try {
    // 可能抛出多种异常的代码
} catch (LogicException $e) {
    // 捕获所有逻辑异常（InvalidArgumentException、BadMethodCallException 等）
} catch (RuntimeException $e) {
    // 捕获所有运行时异常
}
```

Go 选择了一种**组合式的分类法**——通过接口和值来组织错误。你用 `errors.Is` 判断特定错误，用 `errors.As` 判断错误类型，但没有内置的"错误类层次"概念。

```
PHP 的错误组织方式：
Throwable → Error/Exception → 具体异常类 → 更具体的异常类

Go 的错误组织方式：
error 接口 → 任意实现了 Error() string 的类型
判断方式：errors.Is（值比较） + errors.As（类型断言）
```

### 8.2 try-catch vs if err != nil 的深度对比

让我们用同一个业务场景来对比两种风格。这是一个用户下单的场景，涉及用户验证、库存检查、订单创建、支付扣款等多个步骤。

**PHP（Laravel API）**：

```php
class OrderService
{
    public function createOrder(CreateOrderDTO $dto): Order
    {
        DB::beginTransaction();
        try {
            $user = $this->userService->findById($dto->userId);
            if (!$user) {
                throw new NotFoundException('User not found');
            }

            $product = $this->productService->findById($dto->productId);
            if (!$product) {
                throw new NotFoundException('Product not found');
            }

            if (!$product->inStock()) {
                throw new OutOfStockException('Product out of stock');
            }

            $order = Order::create([
                'user_id'    => $user->id,
                'product_id' => $product->id,
                'quantity'   => $dto->quantity,
                'total'      => $product->price * $dto->quantity,
            ]);

            $product->decrementStock($dto->quantity);

            // 扣款可能失败
            $this->paymentService->charge($user, $order->total);

            DB::commit();
            return $order;
        } catch (NotFoundException $e) {
            DB::rollBack();
            throw $e;  // 重新抛出，让框架处理
        } catch (OutOfStockException $e) {
            DB::rollBack();
            throw $e;
        } catch (PaymentException $e) {
            DB::rollBack();
            throw $e;
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Create order failed', ['error' => $e->getMessage()]);
            throw new InternalServerErrorException('Failed to create order');
        }
    }
}
```

**Go（API Handler）**：

```go
func (s *OrderService) CreateOrder(ctx context.Context, req CreateOrderRequest) (*Order, error) {
    tx, err := s.db.BeginTx(ctx, nil)
    if err != nil {
        return nil, fmt.Errorf("begin transaction: %w", err)
    }
    defer tx.Rollback() // Commit 后 Rollback 是 no-op

    user, err := s.userService.FindByID(ctx, req.UserID)
    if err != nil {
        return nil, fmt.Errorf("find user: %w", err)
    }
    if user == nil {
        return nil, NotFound("user not found")
    }

    product, err := s.productService.FindByID(ctx, req.ProductID)
    if err != nil {
        return nil, fmt.Errorf("find product: %w", err)
    }
    if product == nil {
        return nil, NotFound("product not found")
    }

    if !product.InStock() {
        return nil, Validation("product out of stock")
    }

    order := &Order{
        UserID:    user.ID,
        ProductID: product.ID,
        Quantity:  req.Quantity,
        Total:     product.Price * float64(req.Quantity),
    }

    if err := s.orderRepo.Create(ctx, tx, order); err != nil {
        return nil, fmt.Errorf("create order: %w", err)
    }

    if err := s.productRepo.DecrementStock(ctx, tx, product.ID, req.Quantity); err != nil {
        return nil, fmt.Errorf("decrement stock: %w", err)
    }

    if err := s.paymentService.Charge(ctx, user, order.Total); err != nil {
        return nil, fmt.Errorf("charge payment: %w", err)
    }

    if err := tx.Commit(); err != nil {
        return nil, fmt.Errorf("commit transaction: %w", err)
    }

    return order, nil
}
```

关键区别总结：

1. **事务管理**：PHP 用 try-catch 包裹整个逻辑块，手动在 catch 中调用 rollback；Go 用 `defer tx.Rollback()` 确保任何路径（包括 panic）都能回滚。Go 的方式更安全，因为 `defer` 保证执行。

2. **错误分支**：PHP 的 catch 块需要按异常类型分别处理，如果新增一个异常类型就需要新增一个 catch 块；Go 的 `if err != nil` 天然就是早返回（early return），不需要额外的分支。

3. **上下文传递**：PHP 的 catch 块中如果想添加上下文信息，需要在重新抛出时包装；Go 的每一层都可以用 `fmt.Errorf` 添加上下文。

4. **代码可读性**：PHP 的代码更紧凑，正常路径和异常路径分离清晰；Go 的代码更冗长，但每一步的错误处理都一目了然。

---

## 九、实际项目中的错误处理最佳实践

### 9.1 Go API 的错误处理分层架构

```
┌─────────────────────────────────────────────┐
│          Handler 层 (HTTP 入口)              │
│  职责：解析请求，调用 Service，转换错误为     │
│  HTTP 响应                                    │
│  工具：errors.As 提取 DomainError             │
│       → HTTP Status + JSON Body              │
│  日志：在这里记录错误日志（只记录一次）        │
├─────────────────────────────────────────────┤
│          Service 层 (业务逻辑)                │
│  职责：编排业务流程，定义业务错误               │
│  工具：DomainError, errors.Is 判断哨兵错误    │
│       fmt.Errorf("context: %w", err)         │
│  日志：不记录日志，只向上传递错误              │
├─────────────────────────────────────────────┤
│          Repository 层 (数据访问)             │
│  职责：数据库操作，返回底层错误                │
│  工具：sql.ErrNoRows → 转为 DomainError       │
│       os.ErrNotExist → 包装为有意义的错误     │
│  日志：不记录日志，只向上传递错误              │
└─────────────────────────────────────────────┘
```

### 9.2 Repository 层：错误转换

```go
func (r *UserRepo) FindByID(ctx context.Context, id int) (*User, error) {
    var user User
    err := r.db.QueryRowContext(ctx, "SELECT id, name, email FROM users WHERE id = ?", id).
        Scan(&user.ID, &user.Name, &user.Email)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, nil // 返回 nil, nil 表示"没找到，但这不是错误"
        }
        return nil, fmt.Errorf("query user %d: %w", id, err)
    }
    return &user, nil
}
```

**踩坑记录 3："记录不存在"的处理方式**。Go 中"记录不存在"有两种常见处理方式。一种是返回 `nil, nil`（调用者自己判断 user == nil），另一种是返回 `nil, ErrNotFound`。我推荐后者，因为它更明确，而且 `errors.Is(err, ErrNotFound)` 的语义比 `user == nil` 更清晰。但在 Repository 层，有时候 `nil, nil` 更简洁——关键是要团队统一约定，不要在一个项目中混用两种风格。

### 9.3 Service 层：错误包装

```go
func (s *UserService) GetUserProfile(ctx context.Context, userID int) (*UserProfile, error) {
    user, err := s.userRepo.FindByID(ctx, userID)
    if err != nil {
        return nil, Internal("failed to fetch user", err)
    }
    if user == nil {
        return nil, NotFound("user not found")
    }

    profile, err := s.profileRepo.FindByUserID(ctx, userID)
    if err != nil {
        return nil, Internal("failed to fetch profile", err)
    }

    return &UserProfile{
        User:    user,
        Profile: profile,
    }, nil
}
```

### 9.4 错误日志的最佳实践

```go
// ❌ 错误：在底层重复记录日志
func (s *Service) GetUser(id int) (*User, error) {
    user, err := s.repo.FindByID(id)
    if err != nil {
        log.Printf("ERROR: GetUser failed: %v", err) // 多个 service 都这样写会重复日志
        return nil, err
    }
    return user, nil
}

// ✅ 正确：在最顶层（Handler/中间件）统一记录日志
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
    user, err := h.service.GetUser(getID(r))
    if err != nil {
        log.Printf("ERROR %s %s: %+v", r.Method, r.URL.Path, err) // %+v 打印完整堆栈（如果有的话）
        WriteError(w, err)
        return
    }
    json.NewEncoder(w).Encode(user)
}
```

**踩坑记录 4：不要在每一层都记日志**。在 Go 中，错误链上的每一层都用 `fmt.Errorf` 包装了上下文，所以最终的错误消息会很长但很有用。不要在每一层都 `log.Printf`，否则你的日志里会出现同一条错误的 5 个不同版本。**只在顶层记一次日志，利用错误链的上下文信息**。

### 9.5 错误与上下文信息

```go
// 携带请求级上下文
func (s *Service) ProcessOrder(ctx context.Context, orderID string) error {
    traceID := middleware.GetTraceID(ctx) // 从 context 提取 trace ID

    if err := s.validate(orderID); err != nil {
        return fmt.Errorf("[trace=%s] validate order %s: %w", traceID, orderID, err)
    }

    if err := s.reserve(orderID); err != nil {
        return fmt.Errorf("[trace=%s] reserve order %s: %w", traceID, orderID, err)
    }

    return nil
}
```

### 9.6 Go vs Laravel：API 错误响应的完整对比

**Laravel 的方式**：

```php
// 定义异常类
class ApiException extends Exception
{
    protected int $statusCode;
    protected int $errorCode;

    public function render(): JsonResponse
    {
        return response()->json([
            'error' => [
                'code'    => $this->errorCode,
                'message' => $this->getMessage(),
            ],
        ], $this->statusCode);
    }
}

class UserNotFoundException extends ApiException
{
    protected $statusCode = 404;
    protected $errorCode = 1001;
    protected $message = 'User not found';
}

// 控制器中
public function show(int $id)
{
    $user = $this->userService->find($id);
    if (!$user) {
        throw new UserNotFoundException();
    }
    return response()->json($user);
}
```

**Go 的方式**：

```go
// 定义错误类型
type APIError struct {
    StatusCode int    `json:"-"`
    ErrorCode  int    `json:"code"`
    Message    string `json:"message"`
}

func (e *APIError) Error() string { return e.Message }

func NewAPIError(statusCode, errorCode int, message string) *APIError {
    return &APIError{
        StatusCode: statusCode,
        ErrorCode:  errorCode,
        Message:    message,
    }
}

var ErrUserNotFound = NewAPIError(404, 1001, "User not found")

// Handler 中
func (h *Handler) ShowUser(w http.ResponseWriter, r *http.Request) {
    id := getID(r)
    user, err := h.userService.FindByID(r.Context(), id)
    if err != nil {
        var apiErr *APIError
        if errors.As(err, &apiErr) {
            w.WriteHeader(apiErr.StatusCode)
            json.NewEncoder(w).Encode(apiErr)
            return
        }
        // 未知错误
        w.WriteHeader(500)
        json.NewEncoder(w).Encode(map[string]interface{}{
            "code":    5000,
            "message": "internal server error",
        })
        return
    }
    json.NewEncoder(w).Encode(user)
}
```

两种方式最终达到的效果一模一样——客户端收到的都是一个带有错误码和消息的 JSON 响应。区别在于内部实现机制：Laravel 靠框架的异常处理器自动转换，Go 靠开发者手动在 Handler 中处理。

---

## 十、踩坑记录汇总

### 踩坑 5：errors.Is 对值接收者 vs 指针接收者的敏感性

```go
type NotFoundError struct {
    Name string
}

// 如果用值接收者实现 Error()
func (e NotFoundError) Error() string { return "not found: " + e.Name }

var sentinel = NotFoundError{Name: "sentinel"}

// 创建错误时：
err := fmt.Errorf("wrap: %w", sentinel)      // 值类型
errors.Is(err, sentinel)                       // ✅ true

err2 := fmt.Errorf("wrap: %w", &NotFoundError{Name: "sentinel"}) // 指针类型
errors.Is(err2, sentinel)                      // ❌ false! 类型不同
errors.Is(err2, &sentinel)                     // ❌ false! 不同指针
```

**教训**：Sentinel errors 用 `errors.New()` 创建（返回的是指针类型 `*errorString`），自定义错误类型统一用指针传递。不要混用值接收者和指针接收者。

### 踩坑 6：fmt.Errorf 的 %w 会创建新的错误对象

```go
original := errors.New("original")
wrapped := fmt.Errorf("wrapped: %w", original)

// wrapped 和 original 是不同的对象
fmt.Println(wrapped == original) // false

// 但 errors.Is 可以穿透
fmt.Println(errors.Is(wrapped, original)) // true
```

这意味着你不能用 `==` 来判断包装过的错误，**必须用 `errors.Is`**。

### 踩坑 7：errors.Join 的错误消息是换行分隔的

```go
err := errors.Join(errors.New("err1"), errors.New("err2"))
fmt.Println(err.Error())
// 输出：
// err1
// err2
```

如果你的日志系统按行切割日志，这可能会把一条错误拆成两条日志。解决方案：在记录日志前把换行替换掉，或者用自定义的 Join 实现。推荐的做法是在日志中间件中统一处理：

```go
func logError(err error) {
    // 把换行替换为分号，确保一条错误在日志中只占一行
    msg := strings.ReplaceAll(err.Error(), "\n", "; ")
    log.Printf("ERROR: %s", msg)
}
```

### 踩坑 8：不要忽略 error

```go
// ❌ 永远不要这样做
json.NewEncoder(w).Encode(data) // 忽略了返回的 error
db.Exec("DELETE FROM ...")      // 忽略了返回的 error

// ✅ 如果真的不关心错误，显式忽略
_ = json.NewEncoder(w).Encode(data) // 至少让 linter 满意
```

在 Go 中，`golangci-lint` 的 `errcheck` 检查器会自动标记所有未处理的 error 返回值。建议在 CI 中开启这个检查。

### 踩坑 9：不要在循环中创建错误

```go
// ❌ 每次循环都创建新错误对象
for i := 0; i < 1000; i++ {
    err := errors.New("some error") // 每次都分配内存
    // ...
}

// ✅ 预定义哨兵错误
var errSomething = errors.New("some error")
for i := 0; i < 1000; i++ {
    // 复用 errSomething
}
```

### 踩坑 10：注意 errors.As 的目标必须是指针

```go
var ve ValidationError // 值类型
errors.As(err, &ve)    // ❌ 不会工作！目标必须是指针

var ve *ValidationError // 指针类型
errors.As(err, &ve)     // ✅ 正确
```

这是因为 `errors.As` 内部需要用指针来修改目标变量。如果你传的是值的地址，它无法把找到的错误赋值给目标。

### 踩坑 11：自定义错误的 JSON 序列化

```go
type AppError struct {
    Code    int    `json:"code"`
    Message string `json:"message"`
    Err     error  `json:"-"` // 注意：error 接口不能直接序列化为 JSON
}

// 如果不加 json:"-"，json.Marshal 会报错或产生意外输出
// 解决方案：用 json:"-" 忽略内部 error，或者自定义 MarshalJSON
func (e *AppError) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Code    int    `json:"code"`
        Message string `json:"message"`
        Detail  string `json:"detail,omitempty"`
    }{
        Code:    e.Code,
        Message: e.Message,
        Detail: func() string {
            if e.Err != nil {
                return e.Err.Error()
            }
            return ""
        }(),
    })
}
```

---

## 十一、性能考量

### 11.1 error 创建的开销

```go
// 基准测试对比
func BenchmarkErrorsNew(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = errors.New("test error")
    }
}

func BenchmarkFmtErrorf(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("test error: %w", errors.New("inner"))
    }
}

func BenchmarkCustomError(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = &AppError{Code: 500, Message: "test error"}
    }
}
```

大致性能排序：`errors.New` < 自定义错误类型 < `fmt.Errorf`。

`fmt.Errorf` 最慢是因为它需要解析格式化字符串并处理 `%w` 动词。但除非你在热路径上每秒创建数万个错误，否则这个开销完全可以忽略。在真实的 HTTP 服务中，一次数据库查询的耗时（通常 1-10ms）远远超过一次 `fmt.Errorf` 的耗时（通常 < 1μs）。

### 11.2 errors.Is/As 的遍历深度

```go
// 错误链越长，errors.Is/As 的遍历越慢
// 最坏情况：链式 10 层包装
err := ErrBase
for i := 0; i < 10; i++ {
    err = fmt.Errorf("layer %d: %w", i, err)
}
errors.Is(err, ErrBase) // 需要遍历 10 层
```

在实际项目中，错误链通常不超过 3-5 层，性能完全不是问题。但如果你发现自己包装了 10 层以上的错误，说明你的架构可能需要重新审视——也许应该在某个中间层就处理掉错误，而不是一直往上传递。

### 11.3 与 PHP 异常的性能对比

PHP 的异常机制在抛出时需要展开调用栈（stack unwinding），这是一个相对昂贵的操作。在高并发场景下，频繁抛出异常会影响性能。Go 的 error 返回就是一个普通的 return，没有任何额外开销。

根据社区基准测试，Go 的 `errors.New` + `errors.Is` 的组合比 PHP 的 `throw` + `catch` 快约 10-100 倍（取决于调用栈深度）。当然，在真实的业务场景中，这个差异通常可以忽略不计。

---

## 十二、总结：两种设计哲学的思考

| 维度 | Go error | PHP Exception |
|------|----------|---------------|
| 核心接口 | `error` (1 个方法) | `Throwable` (2 个方法) |
| 分类方式 | 按值（sentinel）或按类型（自定义结构体） | 按继承层次 |
| 错误传播 | 显式返回，调用者必须处理 | 自动向上传播，可被任意上层 catch |
| 控制流影响 | 不影响（正常返回） | 中断当前执行流 |
| 代码量 | 多（每个调用点都要检查） | 少（一个 try 包裹多行） |
| 错误可见性 | 高（每个可能失败的地方都可见） | 低（可能被意外吞掉） |
| 灵活性 | 极高（error 就是值，随意组合） | 高（但受制于类层次结构） |
| 学习曲线 | 初期不适应，后期简洁 | 初期直观，后期容易滥用 |
| 性能 | 零开销（普通返回值） | 有栈展开开销 |
| 工具支持 | golangci-lint errcheck | IDE 自动提示 catch |

**Go 的哲学核心**：错误是普通的返回值，不是特殊的控制流机制。你对错误的处理方式应该和对其他返回值一样——检查它、包装它、返回它。这种设计强制你思考每一个可能出错的地方，让你的代码在面对错误时更加健壮。

**PHP 的哲学核心**：错误是一种特殊的信号，它应该被优雅地"抛出"并被"捕获"。这种设计让你可以用更少的代码处理错误，但也容易让你忽略那些没有被 catch 的异常。

两种哲学没有绝对的优劣，只有适用场景的不同。但理解它们的差异，能帮助你在两种语言之间切换时，写出更地道、更健壮的代码。

最后，分享一个我在实际项目中总结出的 Go 错误处理口诀：

> **创建用 New/Errorf，判断用 Is/As，聚合用 Join，包装用 %w，日志只记一次，panic 留给程序 bug。**

---

## 参考资料

- [Go Blog: Errors are values](https://go.dev/blog/errors-are-values) - Rob Pike 关于 Go 错误处理哲学的经典文章
- [Go Blog: Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors) - errors.Is/As 和 %w 的引入背景
- [Go 1.20 Release Notes: errors.Join](https://go.dev/doc/go1.20#errors) - errors.Join 的官方文档
- [Go Standard Library: errors package](https://pkg.go.dev/errors) - errors 包的完整 API 文档
- [PHP: Throwable interface](https://www.php.net/manual/en/class.throwable.php) - PHP 异常体系的顶层接口
- [PHP: Exception class hierarchy](https://www.php.net/manual/en/class.exception.php) - PHP 异常类层次结构
- [Dave Cheney: Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) - Go 错误处理的最佳实践

---

## 相关阅读

- [Rust 错误处理哲学：Result/Option/thiserror/anyhow——对比 PHP Exception 和 Go error 的设计权衡](/categories/后端/rust-error-handling-philosophy/)
- [Go for PHP Developers 实战：goroutine/channel 并发模型与 Laravel 队列的思维对比](/categories/后端/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
- [Swift Structured Concurrency 实战：async/await、TaskGroup、Actor 模型——与 PHP Fibers/Go goroutine 的并发模型对比](/categories/Swift/Swift-Structured-Concurrency-async-await-TaskGroup-Actor-PHP-Fibers-Go-goroutine/)
- [The Go Programming Language (Donovan & Kernighan)](https://www.gopl.io/) - Go 语言圣经中关于错误处理的章节
