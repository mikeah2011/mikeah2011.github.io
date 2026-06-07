---
title: "Rust 错误处理哲学：Result/Option/thiserror/anyhow——对比 PHP Exception 和 Go error 的设计权衡"
date: 2026-06-05 10:00:00
tags: [Rust, 错误处理, PHP, Go, 编程范式]
categories: [架构]
cover: /images/covers/rust-error-handling-cover.jpg
description: "深入解析 Rust 错误处理哲学，涵盖 Result、Option、thiserror、anyhow 的核心用法与设计权衡。对比 PHP Exception 与 Go error 返回值模式，剖析三种语言在类型安全、编译时检查、运行时开销和工程实践上的差异，帮助中高级开发者在架构选型中做出更明智的错误处理决策。"
---

## 前言：错误处理为何如此重要

在软件工程中，"快乐路径"（Happy Path）通常只占代码逻辑的 30%-40%，其余全是错误处理、边界条件和异常恢复。一个系统的健壮程度，往往不取决于它在正常情况下跑得多快，而取决于它在异常情况下能活多久。

不同编程语言对此给出了截然不同的设计哲学：

- **PHP** 选择了 Exception（异常）——依赖运行时的栈展开（Stack Unwinding），灵活但隐式。
- **Go** 选择了 `error` 作为返回值——强制开发者在每个调用点显式检查，显式但冗余。
- **Rust** 选择了 `Result<T, E>` 和 `Option<T>`——将错误编码进类型系统，编译器成为最后一道防线。

这三种方案没有绝对的优劣，但背后的设计权衡值得每一位中高级开发者深入思考。本文将从 Rust 的错误处理体系出发，结合 `thiserror` 和 `anyhow` 两大生态工具，与 PHP Exception 和 Go error 做全面对比，并给出实际工程中的选型建议。

---

## 一、Rust 错误处理的基石：Result 与 Option

### 1.1 为什么 Rust 不用 Exception

Rust 没有传统意义上的异常机制（Exception）。这不是一个疏忽，而是深思熟虑的设计决策。在 C++ 中，Exception 带来了几个棘手问题：

1. **隐式控制流**：阅读代码时，你无法知道哪一行可能抛出异常，必须追溯整个调用链。
2. **性能开销**：即使不抛出异常，零开销异常（Zero-Cost Exception）的实现也需要额外的元数据和栈展开表。
3. **RAII 与异常的安全交互**：C++ 的析构函数在栈展开期间的执行顺序容易引发微妙的 Bug。

Rust 的设计者选择了另一条路：**让错误成为类型的一部分**，而不是控制流的逃逸出口。

### 1.2 Result<T, E>：带类型的错误

`Result` 是 Rust 标准库中最核心的错误处理枚举：

```rust
enum Result<T, E> {
    Ok(T),    // 成功，携带值
    Err(E),   // 失败，携带错误
}
```

任何可能失败的函数都返回 `Result`。调用者**必须**处理这个值，否则编译器会发出警告（或在 `#[must_use]` 标注下直接报错）。

来看一个文件读取的例子：

```rust
use std::fs;
use std::io;

fn read_config(path: &str) -> Result<String, io::Error> {
    let content = fs::read_to_string(path)?;
    Ok(content)
}
```

这里的 `?` 运算符是 Rust 错误处理的"语法糖之王"——它等价于：

```rust
fn read_config(path: &str) -> Result<String, io::Error> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => return Err(e),  // 提前返回错误
    };
    Ok(content)
}
```

`?` 的巧妙之处在于：它让错误传播变得简洁，同时保留了**显式性**——每一步可能失败的操作都清晰可见。这比 Go 的 `if err != nil` 更简洁，比 PHP 的隐式 Exception 更透明。

### 1.3 Option<T>：表示"值可能不存在"

`Option` 处理的是另一种"错误"——值的缺失：

```rust
enum Option<T> {
    Some(T),  // 有值
    None,     // 无值
}
```

`Option` 和 `Result` 的区别在于语义：`Result` 表示"操作可能失败"，`Option` 表示"值可能不存在"。这不是语法层面的区别，而是**领域建模**层面的区别。

```rust
fn find_user(users: &[User], id: u64) -> Option<&User> {
    users.iter().find(|u| u.id == id)
    // 找到返回 Some(&user)，没找到返回 None
    // 这不是"错误"，而是"没有结果"
}
```

`Option` 可以方便地转换为 `Result`：

```rust
let user = find_user(&users, 42)
    .ok_or(AppError::UserNotFound)?;
```

### 1.4 组合子方法：优雅的错误链

Rust 为 `Result` 和 `Option` 提供了丰富的组合子方法，使得错误处理链既流畅又类型安全：

```rust
fn parse_port(input: &str) -> Result<u16, AppError> {
    input
        .trim()
        .parse::<u16>()
        .map_err(|_| AppError::InvalidPort(input.to_string()))
        .and_then(|port| {
            if port == 0 {
                Err(AppError::PortCannotBeZero)
            } else {
                Ok(port)
            }
        })
}
```

常用的组合子包括：

| 方法 | 作用 |
|------|------|
| `map` | 对 Ok/Some 中的值进行变换 |
| `map_err` | 对 Err 中的错误进行变换 |
| `and_then` | 链式操作，每一步都可能失败 |
| `unwrap_or` / `unwrap_or_else` | 提供默认值 |
| `ok_or` / `ok_or_else` | Option → Result |
| `transpose` | Result<Option<T>> ↔ Option<Result<T>> |

---

## 二、自定义错误类型：thiserror 登场

### 2.1 为什么需要自定义错误

标准库的 `io::Error`、`ParseIntError` 等类型各自为政。在一个真实项目中，你可能同时遇到数据库错误、网络错误、配置解析错误、业务逻辑错误——这些都需要统一的错误类型来承载。

手动实现 `Display`、`Error` trait 非常繁琐：

```rust
use std::fmt;
use std::io;

#[derive(Debug)]
enum AppError {
    Io(io::Error),
    Database(String),
    NotFound(String),
    ParseInt(std::num::ParseIntError),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(e) => write!(f, "IO error: {}", e),
            AppError::Database(msg) => write!(f, "Database error: {}", msg),
            AppError::NotFound(name) => write!(f, "{} not found", name),
            AppError::ParseInt(e) => write!(f, "Parse error: {}", e),
        }
    }
}

impl std::error::Error for AppError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            AppError::Io(e) => Some(e),
            AppError::ParseInt(e) => Some(e),
            _ => None,
        }
    }
}

impl From<io::Error> for AppError {
    fn from(e: io::Error) -> Self {
        AppError::Io(e)
    }
}
```

这段代码虽然正确，但充满了样板。`thiserror` 的出现就是为了解决这个问题。

### 2.2 thiserror：声明式错误定义

`thiserror` 是一个过程宏（Procedural Macro），通过 `#[derive(thiserror::Error)]` 自动生成 `Display`、`Error`、`From` 等 trait 实现：

```rust
use thiserror::Error;

#[derive(Error, Debug)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database error: {0}")]
    Database(String),

    #[error("{0} not found")]
    NotFound(String),

    #[error("Parse error: {0}")]
    ParseInt(#[from] std::num::ParseIntError),

    #[error("Invalid configuration: {field} = {value}")]
    InvalidConfig { field: String, value: String },
}
```

上面的代码等价于前面手写的数十行样板代码。关键特性：

- `#[error("...")]` 自动生成 `Display` 实现，支持格式化参数。
- `#[from]` 自动生成 `From` 实现，使 `?` 运算符可以无缝转换错误类型。
- `#[source]` 标记错误的"原因链"，支持 `Error::source()` 追溯。

### 2.3 thiserror 的设计哲学

`thiserror` 的核心理念是：**库代码应该暴露精确的错误类型**。当你编写一个库时，调用者需要知道具体是哪种错误发生了，以便做出不同的响应。例如：

```rust
// 调用者可以匹配具体错误类型
match db.get_user(id) {
    Ok(user) => render(user),
    Err(AppError::NotFound(_)) => return_404(),
    Err(AppError::Database(_)) => return_503(),
    Err(_) => return_500(),
}
```

这就是 `thiserror` 的定位——**面向库作者**的错误类型构建工具。

---

## 三、anyhow：应用程序级的错误处理

### 3.1 应用程序 vs 库的不同需求

如果说 `thiserror` 是为库设计的，那 `anyhow` 就是为应用程序（Application）设计的。两者的根本区别在于：

- **库**：需要定义精确的错误类型，让调用者可以匹配和响应。
- **应用程序**：大多数错误只需要记录日志或向用户展示，不需要精确匹配。

### 3.2 anyhow::Error 的工作方式

`anyhow::Error` 是一个"万能错误容器"，它可以容纳任何实现了 `std::error::Error` 的类型：

```rust
use anyhow::{Context, Result, bail, anyhow};

fn load_and_parse_config(path: &str) -> Result<Config> {
    let content = fs::read_to_string(path)
        .context(format!("Failed to read config file: {}", path))?;

    let config: Config = toml::from_str(&content)
        .context("Failed to parse TOML configuration")?;

    if config.port == 0 {
        bail!("Port cannot be zero in configuration");
    }

    if config.workers > 64 {
        return Err(anyhow!("Worker count {} exceeds maximum (64)", config.workers));
    }

    Ok(config)
}
```

`anyhow` 提供了几个关键 API：

| API | 用途 |
|-----|------|
| `anyhow::Result<T>` | 等价于 `Result<T, anyhow::Error>` |
| `.context("...")` | 为错误添加上下文信息，形成错误链 |
| `.with_context(\|\| ...)` | 延迟计算的上下文（避免不必要的格式化） |
| `bail!("...")` | 提前返回一个包含消息的错误 |
| `anyhow!("...")` | 构造一个带消息的错误 |

### 3.3 错误链与上下文

`anyhow` 最强大的特性是**错误链**。每一次 `.context()` 调用都会在错误链上添加一层信息，最终可以通过 `:?` 格式化完整输出：

```rust
// 如果出错，输出类似：
// Error: Failed to load application
//
// Caused by:
//     0: Failed to read config file: /etc/app/config.toml
//     1: No such file or directory (os error 2)
```

这在调试时极其有用——你不仅知道"哪里出了错"，还知道"为什么出错"以及"错误是如何传播的"。

### 3.4 anyhow 的 downcast 机制

虽然 `anyhow::Error` 是类型擦除的，但你仍然可以通过 `downcast_ref` 恢复具体类型：

```rust
use anyhow::Error;

fn handle_error(err: Error) {
    if let Some(io_err) = err.downcast_ref::<std::io::Error>() {
        if io_err.kind() == std::io::ErrorKind::NotFound {
            eprintln!("File not found, using defaults");
            return;
        }
    }
    if let Some(app_err) = err.downcast_ref::<AppError>() {
        match app_err {
            AppError::NotFound(_) => { /* specific handling */ }
            _ => {}
        }
    }
    eprintln!("Unexpected error: {:?}", err);
}
```

但这应该是例外而非规则——如果你频繁 downcast，说明你可能更适合使用 `thiserror`。

### 3.5 thiserror vs anyhow：选型决策树

```
你在写什么？
├── 库（Library）
│   └── 使用 thiserror，暴露精确的错误枚举
└── 应用程序（Application / Binary）
    ├── 大多数错误只需记录/展示
    │   └── 使用 anyhow，快速开发
    └── 需要对部分错误做精确匹配
        └── 组合使用：内部用 thiserror 定义错误，main 函数用 anyhow 统一处理
```

组合使用的经典模式：

```rust
// lib.rs — 用 thiserror 定义精确的错误类型
#[derive(Error, Debug)]
pub enum ServiceError {
    #[error("User {0} not found")]
    UserNotFound(u64),
    #[error("Database connection failed: {0}")]
    DbConnection(#[source] sqlx::Error),
    #[error("Rate limit exceeded for {ip}")]
    RateLimitExceeded { ip: String },
}

// main.rs — 用 anyhow 统一处理
use anyhow::Result;

fn main() -> Result<()> {
    let config = load_config()?;              // anyhow::Error
    let service = Service::new(config)?;      // 可能返回 ServiceError，自动转换
    service.run()?;                           // 统一传播到顶层
    Ok(())
}
```

---

## 四、对比 PHP Exception：隐式控制流的代价

### 4.1 PHP Exception 的机制

PHP 5 引入了传统的 try-catch 异常机制：

```php
class UserRepository
{
    public function find(int $id): User
    {
        $result = $this->db->query("SELECT * FROM users WHERE id = ?", [$id]);

        if ($result === false) {
            throw new DatabaseException("Query failed: " . $this->db->error);
        }

        if ($result->num_rows === 0) {
            throw new UserNotFoundException("User {$id} not found");
        }

        return User::fromRow($result->fetch_assoc());
    }
}

// 调用方
try {
    $user = $repo->find(42);
    echo $user->name;
} catch (UserNotFoundException $e) {
    http_response_code(404);
    echo "Not found";
} catch (DatabaseException $e) {
    error_log($e->getMessage());
    http_response_code(500);
    echo "Internal error";
}
```

### 4.2 PHP Exception 的优势

1. **不阻塞快乐路径**：正常情况下代码流畅阅读，错误处理被推迟到 catch 块。
2. **类型层次**：通过 Exception 的继承体系，可以按粒度捕获——`catch (\RuntimeException $e)` 捕获所有运行时异常。
3. **栈追踪**：Exception 自动携带完整的调用栈和文件行号。
4. **生态统一**：PHP 社区已经全面拥抱 Exception，Composer 包之间的异常传播没有障碍。

### 4.3 PHP Exception 的核心问题

**问题一：隐式控制流**

```php
function processOrder(Order $order): Receipt
{
    $inventory = $this->checkInventory($order);   // 可能抛异常
    $payment = $this->chargePayment($order);       // 可能抛异常
    $shipping = $this->createShipment($order);     // 可能抛异常
    return new Receipt($inventory, $payment, $shipping);
}
```

阅读这段代码时，你无法确定哪一行会抛出异常。你必须追溯每个方法的实现，甚至追溯到第三方库的内部逻辑。在大型 PHP 项目中，这会导致**异常成为隐式的"goto"**——控制流突然跳转到数十层之外的 catch 块。

**问题二：checked vs unchecked 的混乱**

PHP 没有 Java 那样的 checked exception 机制。所有异常都是 unchecked 的。这意味着函数签名不传达任何错误信息：

```php
// 这个方法可能抛出几种异常？你不知道。
public function transfer(float $amount, Account $from, Account $to): void
```

相比之下，Rust 的函数签名**就是文档**：

```rust
fn transfer(amount: f64, from: &Account, to: &Account) -> Result<(), TransferError>
```

编译器强制你处理 `TransferError`，或者显式地用 `?` 向上传播。

**问题三：finally 与资源管理**

PHP 的 `finally` 块用于清理资源，但它依赖开发者记得写。而 Rust 的 `Drop` trait 和所有权系统确保资源在离开作用域时**一定**被释放：

```rust
{
    let file = File::open("data.txt")?;  // 打开文件
    // ... 使用 file
}   // file 在这里自动关闭，无论是否发生错误
```

### 4.4 结构化对比

| 维度 | PHP Exception | Rust Result/Option |
|------|--------------|-------------------|
| 错误是否在类型中 | 否（签名不反映） | 是（返回值类型即文档） |
| 强制处理 | 否（不 catch 也编译通过） | 是（未处理会编译警告/报错） |
| 控制流 | 隐式（栈展开） | 显式（返回值 + `?` 传播） |
| 性能开销 | 有（栈展开 + trace 构建） | 无（与普通值返回相同） |
| 资源清理 | finally / try-with-resources | Drop trait（自动且确定性） |
| 错误上下文 | 手动在 message 中拼接 | `.context()` 链式累积 |
| 上层匹配粒度 | catch 块 + instanceof | match / if let 精确匹配 |

---

## 五、对比 Go error：显式但冗余的另一种极端

### 5.1 Go error 的机制

Go 的错误处理极为朴素——`error` 是一个内置接口：

```go
type error interface {
    Error() string
}
```

任何实现了 `Error() string` 方法的类型都是 `error`。函数通过多返回值将错误传回：

```go
func ReadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("reading config %s: %w", path, err)
    }

    var config Config
    if err := json.Unmarshal(data, &config); err != nil {
        return nil, fmt.Errorf("parsing config: %w", err)
    }

    return &config, nil
}
```

### 5.2 Go error 的优势

1. **极低的抽象开销**：没有泛型、没有 trait、没有宏——任何 Go 初学者都能理解 `error` 接口。
2. **显式错误流**：每个可能失败的调用都有 `if err != nil`，错误路径一目了然。
3. **兼容性**：`error` 接口是 Go 1.x 承诺的一部分，永远不会变。
4. **简单性**：Go 的哲学是"少即是多"，不提供复杂的错误组合子。

### 5.3 Go error 的核心问题

**问题一：`if err != nil` 的冗余**

这可能是 Go 社区被吐槽最多的模式。在一个典型的 Go 服务中，大量代码都是这个样板：

```go
result, err := doStep1()
if err != nil {
    return nil, err
}

result2, err := doStep2(result)
if err != nil {
    return nil, err
}

result3, err := doStep3(result2)
if err != nil {
    return nil, err
}
```

在 Rust 中，同样的逻辑只需：

```rust
let result = do_step1()?;
let result2 = do_step2(result)?;
let result3 = do_step3(result2)?;
```

Rust 的 `?` 将三行错误检查压缩为零行额外代码，同时保留了显式性（每个 `?` 都是一个潜在的错误传播点）。

**问题二：错误类型的信息丢失**

Go 的 `error` 接口只有 `Error() string`——一个字符串。这意味着：

1. **无法在编译时检查错误处理**：编译器不知道你的函数可能返回哪些错误。
2. **匹配错误类型需要类型断言**：比 Rust 的 `match` 更脆弱。

```go
// Go：需要类型断言来匹配具体错误
var pathErr *os.PathError
if errors.As(err, &pathErr) {
    // 处理路径错误
}
```

对比 Rust：

```rust
// Rust：编译器确保你处理了所有变体
match err {
    AppError::Io(e) if e.kind() == io::ErrorKind::NotFound => { /* ... */ }
    AppError::Io(e) => { /* ... */ }
    AppError::Parse(e) => { /* ... */ }
    AppError::NotFound(name) => { /* ... */ }
}
```

**问题三：`panic` 与 `error` 的二元分裂**

Go 同时存在两种错误机制：

- **`error` 返回值**：用于可恢复的错误。
- **`panic`**：用于不可恢复的"程序员认为不应该发生"的错误。

这个边界是模糊的。什么时候应该 `panic`？什么时候应该返回 `error`？Go 没有强制规则，全靠开发者自觉。常见的困惑：

```go
// 应该 panic 还是返回 error？
func mustParseInt(s string) int {
    v, err := strconv.Atoi(s)
    if err != nil {
        panic(err)  // 如果这里 panic 了，上层 recover 还是有 err？
    }
    return v
}
```

Rust 在这一点上更清晰：
- `Result` 用于可恢复错误。
- `panic!` 用于真正不可恢复的Bug（类似断言失败）。
- `unwrap()` 和 `expect()` 是 `Result → panic` 的显式桥梁，你知道你在做什么。

### 5.4 Go 1.13+ 的改进：errors.Is / errors.As / %w

Go 1.13 引入了错误包装（Error Wrapping）机制：

```go
if err != nil {
    return fmt.Errorf("database query failed: %w", err)
}
```

`%w` 会保留原始错误，使得上层可以用 `errors.Is` 和 `errors.As` 进行匹配：

```go
if errors.Is(err, sql.ErrNoRows) {
    // 处理无结果的情况
}
```

这比以前好了很多，但相比 Rust 的 `thiserror` + `#[source]` + `#[from]` 的组合，仍然缺乏编译时保证和自动化的错误转换。

### 5.5 结构化对比

| 维度 | Go error | Rust Result/Option |
|------|----------|-------------------|
| 错误类型 | 接口（`error`）——只含字符串 | 泛型枚举 `Result<T, E>`——类型精确 |
| 强制处理 | 是（返回值必须接收） | 是（未处理编译报错） |
| 样板代码量 | 高（`if err != nil` 反复出现） | 低（`?` 一行传播） |
| 编译时安全 | 弱（只检查是否处理了 error，不检查具体类型） | 强（枚举穷举匹配） |
| 错误链 | `%w` + `errors.Is`/`errors.As` | `thiserror #[source]` + `anyhow .context()` |
| 学习曲线 | 极低 | 中等（需要理解泛型、trait、生命周期） |
| panic/recover | 存在且边界模糊 | panic 存在但语义明确（不可恢复的 Bug） |
| 社区工具 | `pkg/errors`、`errgroup`、`multierror` | `thiserror`、`anyhow`、`eyre`、`snafu` |

---

## 六、三种哲学的设计光谱

将三种语言放在一条光谱上，可以更直观地理解它们的设计选择：

```
隐式 ←————————————————————————————→ 显式

PHP Exception          Go error          Rust Result
(隐式控制流)         (显式但类型弱)      (显式且类型强)
```

```
低编译时保证 ←————————————————————→ 高编译时保证

PHP                    Go                 Rust
(运行时类型检查)     (编译时检查 error)   (编译时检查 Result<T,E>)
```

```
低冗余 ←————————————————————————→ 高冗余

Rust (thiserror)     PHP                Go
(? + 宏自动生成)     (try-catch 简洁)    (if err != nil 冗余)
```

一个有趣的观察：**Go 选择了最显式的方案，但在实践中反而产生了最多的样板代码；Rust 通过类型系统和 `?` 运算符，同时实现了显式性和简洁性**。这是 Rust 设计哲学的精髓——用类型系统的表达力来消除样板代码，而不是用隐式机制来隐藏复杂性。

---

## 七、实际工程中的选型建议

### 7.1 Rust 项目结构推荐

对于一个中大型 Rust 项目，推荐以下错误处理分层：

```
my-project/
├── crates/
│   ├── core/          // 库代码：使用 thiserror
│   │   └── error.rs   // 定义 CoreError 枚举
│   ├── api/           // 库代码：使用 thiserror
│   │   └── error.rs   // 定义 ApiError 枚举
│   └── cli/           // 二进制入口：使用 anyhow
│       └── main.rs    // Result<()> 统一处理
└── Cargo.toml
```

**核心库的错误定义**：

```rust
// crates/core/src/error.rs
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CoreError {
    #[error("user not found: {0}")]
    UserNotFound(u64),

    #[error("insufficient balance: have {have}, need {need}")]
    InsufficientBalance { have: f64, need: f64 },

    #[error("database error")]
    Database(#[from] sqlx::Error),

    #[error("redis error")]
    Redis(#[from] redis::RedisError),
}
```

**API 层的错误映射**：

```rust
// crates/api/src/handlers.rs
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

impl IntoResponse for CoreError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            CoreError::UserNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            CoreError::InsufficientBalance { .. } => (StatusCode::BAD_REQUEST, self.to_string()),
            CoreError::Database(_) | CoreError::Redis(_) => {
                tracing::error!("Internal error: {:?}", self);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
            }
        };
        (status, message).into_response()
    }
}
```

**CLI 入口的统一处理**：

```rust
// crates/cli/src/main.rs
use anyhow::Result;

fn main() -> Result<()> {
    let config = load_config()?;
    tracing_subscriber::init();

    let db = Database::connect(&config.database_url)?;
    let app = App::new(db, config);

    // 任何 CoreError / ApiError 都会被自动转换为 anyhow::Error
    app.run()?;

    Ok(())
}
```

### 7.2 何时使用 unwrap()

`unwrap()` 在 Rust 社区中名声不太好，但它在特定场景下完全合理：

1. **测试代码**：`unwrap()` 和 `expect()` 在测试中使用是完全可以的——失败了就是测试失败。
2. **你比编译器更了解的情况**：

```rust
let port: u16 = "8080".parse().expect("literal is always valid");
```

3. **原型开发**：快速迭代时先 `unwrap()`，后续再替换为 proper error handling。

**绝不要在库代码的公共 API 中使用 `unwrap()`**。

### 7.3 常见反模式

**反模式一：吞掉错误**

```rust
// ❌ 永远不要这样做
let _ = fs::write("output.txt", data);
```

```rust
// ❌ PHP 等价物
try {
    file_put_contents('output.txt', $data);
} catch (\Exception $e) {
    // 什么？你就这样吞掉了？？
}
```

**反模式二：过于宽泛的错误类型**

```rust
// ❌ 所有函数都返回同一个 String 错误
fn do_everything() -> Result<(), String> {
    // ...
}
```

```rust
// ✅ 精确的错误枚举
fn do_something() -> Result<(), SpecificError> {
    // ...
}
```

**反模式三：过度使用 anyhow（在库代码中）**

```rust
// ❌ 库代码中使用 anyhow，调用者无法精确匹配
pub fn parse_input(input: &str) -> anyhow::Result<Data> { /* ... */ }

// ✅ 库代码中使用 thiserror
#[derive(Error, Debug)]
pub enum ParseError {
    #[error("invalid format at line {0}")]
    InvalidFormat(usize),
    #[error("missing required field: {0}")]
    MissingField(String),
}

pub fn parse_input(input: &str) -> Result<Data, ParseError> { /* ... */ }
```

### 7.4 错误处理与可观测性

在生产环境中，错误处理不仅仅是"返回错误"，还涉及日志、监控和告警。Rust 生态在这方面有成熟的方案：

```rust
use tracing::{error, warn, info};

async fn handle_request(req: Request) -> Response {
    match process(req).await {
        Ok(resp) => {
            info!("Request processed successfully");
            resp
        }
        Err(e) => {
            // 根据错误级别决定日志级别
            match &e {
                AppError::NotFound(_) => warn!(error = %e, "Resource not found"),
                AppError::Auth(_) => warn!(error = %e, "Authentication failed"),
                AppError::Internal(_) => error!(error = ?e, "Internal error"),
            }
            e.into_response()
        }
    }
}
```

对比 PHP 的 Monolog + Sentry 方案，Rust 的 `tracing` crate 提供了结构化的日志和 span 追踪，与错误处理的集成更加自然。

### 7.5 与 PHP/Go 生态的互通场景

在实际工程中，你可能需要在不同语言之间协调错误处理：

**Rust + PHP（通过 FFI 或 WebAssembly）**：

如果 Rust 模块通过 FFI 为 PHP 提供服务，错误码通常是桥梁：

```rust
#[no_mangle]
pub extern "C" fn process_data(input: *const u8, len: usize) -> i32 {
    let result = catch_unwind(|| {
        // 处理逻辑
        match internal_process(input, len) {
            Ok(_) => 0,
            Err(AppError::InvalidInput(_)) => -1,
            Err(AppError::Timeout) => -2,
            Err(_) => -99,
        }
    });
    result.unwrap_or(-100)  // panic 被捕获
}
```

**Rust + Go（通过 gRPC / HTTP）**：

当 Rust 微服务与 Go 微服务交互时，错误映射到 HTTP 状态码或 gRPC 状态码是标准做法：

```rust
impl From<CoreError> for tonic::Status {
    fn from(err: CoreError) -> Self {
        match err {
            CoreError::UserNotFound(_) => tonic::Status::not_found(err.to_string()),
            CoreError::InvalidInput(_) => tonic::Status::invalid_argument(err.to_string()),
            _ => tonic::Status::internal("Internal error"),
        }
    }
}
```

---

## 八、展望：Rust 错误处理的未来

Rust 社区在错误处理方面仍在持续演进：

1. **`std::error::Error` 的 `provide()` 方法**（不稳定特性）：允许错误类型提供结构化的诊断信息，不仅仅是字符串。
2. **`eyre` crate**：`anyhow` 的一个分支，支持自定义的错误报告格式，在 CLI 工具中很受欢迎。
3. **`snafu` crate**：另一种错误派生宏，支持上下文选择器（Context Selector），在某些场景下比 `thiserror` 更灵活。
4. **`error-stack`（by Hash）**：引入了"报告"（Report）概念，将错误、警告、建议分层管理。

随着 Rust 在 Web 后端（Axum、Actix）、嵌入式（Embassy）、游戏引擎（Bevy）等领域的渗透，错误处理的模式也在不断丰富。但核心理念始终不变：**错误是数据，不是控制流的逃逸口**。

---

## 总结

回到文章开头的问题：为什么错误处理如此重要？

因为错误处理的设计选择，反映了一种编程语言对"程序员应该在哪里思考"这个问题的回答：

| 语言 | 回答 | 核心机制 | 代价 |
|------|------|---------|------|
| PHP | "运行时再想" | Exception + try/catch | 隐式控制流，运行时才发现遗漏 |
| Go | "每一步都必须想" | error 返回值 + if err != nil | 大量样板代码，信息丢失 |
| Rust | "编译器帮你想到" | Result/Option + `?` + 类型匹配 | 学习曲线，编译时间 |

Rust 的方案不是"没有代价"的——你需要学习泛型、trait、生命周期，你需要理解 `thiserror` 和 `anyhow` 的适用场景，你需要在编译器的严格要求下编写更多的类型注解。但换来的是：

1. **编译时错误检查**：遗漏的错误处理在编译阶段就被发现。
2. **零运行时开销**：`Result` 和 `Option` 的运行时成本与手写 if-else 完全相同。
3. **自文档化的代码**：函数签名就是错误处理的完整契约。
4. **可组合的错误处理**：`?` 运算符和组合子方法让错误传播既简洁又显式。

最终，选择哪种错误处理哲学取决于你的项目需求和团队背景。但理解这三种方案的设计权衡，将帮助你在任何语言中写出更健壮的代码。正如 Rust 社区的那句名言：

> **"If it compiles, it works."**

虽然这句话有些理想化，但在错误处理方面，Rust 确实比任何主流语言都更接近这个目标。

---

## 相关阅读

- [Rust Axum 实战：用 Rust 构建高性能 HTTP API——路由、中间件、数据库连接池与 Laravel 对比](/categories/架构/Rust-Axum-实战-用Rust构建高性能HTTP-API-路由中间件数据库连接池与Laravel对比/)
- [Rust 异步生态对比：Tokio / async-std / Smol 运行时选型](/categories/架构/2026-06-05-Rust-异步生态对比-Tokio-async-std-Smol-运行时选型/)
- [Elixir OTP 实战：Supervisor 树、GenServer、分布式进程——对比 PHP-FPM 无状态模型的并发哲学](/categories/架构/Elixir-OTP-实战-Supervisor树-GenServer-分布式进程-对比PHP-FPM无状态模型的并发哲学/)
- [Swift Structured Concurrency：async/await、TaskGroup、Actor——对比 PHP Fibers / Go goroutine](/categories/架构/Swift-Structured-Concurrency-async-await-TaskGroup-Actor-PHP-Fibers-Go-goroutine/)
