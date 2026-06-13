---
title: Rust 错误处理进阶实战：自定义 Error 类型、thiserror/anyhow 选型——对比 PHP Exception 和 Go error 的三层设计哲学
keywords: [Rust, Error, thiserror, anyhow, PHP Exception, Go error, 错误处理进阶实战, 自定义, 类型, 的三层设计哲学]
date: 2026-06-07 23:57:00
categories:
  - rust
tags:
  - Rust
  - 错误处理
  - thiserror
  - anyhow
  - PHP
  - Go
  - 设计模式
description: 深入 Rust 错误处理机制，从自定义 Error 类型到 thiserror/anyhow 选型，对比 PHP Exception 和 Go error 的设计哲学，帮助开发者在不同语言间建立统一的错误处理心智模型。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1600&h=900&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1600&h=900&fit=crop
---


## 前言

错误处理是每个开发者绕不开的核心话题。在 PHP 世界里，我们习惯了 `try/catch` + `Exception` 的暴力美学；在 Go 里，我们学会了 `if err != nil` 的显式哲学；而 Rust，则用 `Result<T, E>` 和类型系统，把错误处理提升到了一个新的高度。

这篇文章不是 Rust 错误处理的入门教程——而是一次**进阶实战**。我们会：

- 手把手构建自定义 Error 类型
- 深入对比 `thiserror` 和 `anyhow` 的适用场景
- 用 PHP 和 Go 的视角来理解 Rust 的设计决策
- 给出可直接复用的代码模板

如果你同时在写 PHP、Go 和 Rust，这篇文章会让你在三种语言间建立统一的错误处理心智模型。

---

## 一、三种语言的错误处理哲学

### 1.1 PHP：异常（Exception）—— 隐式跳转

PHP 的错误处理是**异常驱动**的：

```php
try {
    $user = $userService->findById($id);
    if (!$user) {
        throw new UserNotFoundException("User #{$id} not found");
    }
    $order = $orderService->create($user, $data);
} catch (UserNotFoundException $e) {
    return response()->json(['error' => $e->getMessage()], 404);
} catch (OrderException $e) {
    return response()->json(['error' => $e->getMessage()], 500);
} catch (\Exception $e) {
    Log::error($e);
    return response()->json(['error' => 'Internal Error'], 500);
}
```

**特点：**
- 异常可以沿着调用栈**隐式传播**，直到被捕获
- 调用者可以**忽略**异常（不写 catch 也编译通过）
- 性能代价：异常构造时需要收集堆栈信息
- 适合：Web 应用的请求级错误处理

### 1.2 Go：错误值（Error Value）—— 显式返回

Go 用**返回值**代替异常：

```go
user, err := userService.FindByID(id)
if err != nil {
    if errors.Is(err, ErrUserNotFound) {
        return nil, fmt.Errorf("user %d: %w", id, err)
    }
    return nil, fmt.Errorf("find user %d: %w", id, err)
}

order, err := orderService.Create(user, data)
if err != nil {
    return nil, fmt.Errorf("create order: %w", err)
}
```

**特点：**
- 错误是**普通值**，必须显式处理
- 编译器不强制检查（`err` 可以被忽略，但会 lint 报警）
- `fmt.Errorf` + `%w` 实现错误链（Go 1.13+）
- 适合：需要精细控制错误流的系统编程

### 1.3 Rust：Result<T, E> —— 类型系统强制

Rust 用**代数数据类型**把错误编入类型签名：

```rust
fn find_user(id: u64) -> Result<User, AppError> {
    let row = db.query_one("SELECT * FROM users WHERE id = $1", &[&id])
        .map_err(AppError::Database)?;
    
    let user = serde_json::from_value(row)
        .map_err(AppError::Parse)?;
    
    Ok(user)
}
```

**特点：**
- `Result<T, E>` 是类型，**不处理就编译失败**
- `?` 操作符实现自动错误传播
- 错误类型在函数签名中**显式声明**
- 零成本抽象：没有异常的堆栈开销

### 1.4 三者对比速查表

| 特性 | PHP Exception | Go error | Rust Result |
|------|--------------|----------|-------------|
| 错误传播 | 隐式（throw/catch） | 显式（return err） | 显式（? 操作符） |
| 强制处理 | 否（可以不 catch） | 否（可以忽略 err） | **是（编译器强制）** |
| 错误类型 | class 层次 | interface / 值 | 泛型枚举 |
| 性能开销 | 高（堆栈收集） | 低 | **零成本** |
| 错误链 | `$e->getPrevious()` | `%w` 包装 | 源生 `Error::source()` |
| 最佳场景 | Web 请求处理 | 系统/网络编程 | 所有场景（编译期保证） |

---

## 二、Rust 自定义 Error 类型：从零构建

### 2.1 基础：用枚举定义错误

Rust 的错误处理核心是**枚举**。我们先从最基础的自定义 Error 开始：

```rust
use std::fmt;
use std::io;
use std::num::ParseIntError;

/// 应用级错误枚举
#[derive(Debug)]
pub enum AppError {
    /// 数据库错误
    Database(String),
    /// 配置错误
    Config(String),
    /// 解析错误
    Parse(String),
    /// 业务逻辑错误
    Business { code: u16, message: String },
    /// IO 错误
    Io(io::Error),
    /// 数字解析错误
    ParseInt(ParseIntError),
    /// 未知错误
    Unknown(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Database(msg) => write!(f, "数据库错误: {}", msg),
            AppError::Config(msg) => write!(f, "配置错误: {}", msg),
            AppError::Parse(msg) => write!(f, "解析错误: {}", msg),
            AppError::Business { code, message } => {
                write!(f, "业务错误 [{}]: {}", code, message)
            }
            AppError::Io(err) => write!(f, "IO 错误: {}", err),
            AppError::ParseInt(err) => write!(f, "数字解析错误: {}", err),
            AppError::Unknown(msg) => write!(f, "未知错误: {}", msg),
        }
    }
}

// 实现 std::error::Error trait
impl std::error::Error for AppError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            AppError::Io(err) => Some(err),
            AppError::ParseInt(err) => Some(err),
            _ => None,
        }
    }
}

// 从 io::Error 自动转换
impl From<io::Error> for AppError {
    fn from(err: io::Error) -> Self {
        AppError::Io(err)
    }
}

// 从 ParseIntError 自动转换
impl From<ParseIntError> for AppError {
    fn from(err: ParseIntError) -> Self {
        AppError::ParseInt(err)
    }
}
```

### 2.2 使用 `?` 操作符传播错误

有了 `From` 实现，`?` 操作符就能自动转换和传播错误：

```rust
fn read_config(path: &str) -> Result<Config, AppError> {
    // io::Error 会自动转为 AppError::Io
    let content = std::fs::read_to_string(path)?;
    
    let port_str = content
        .lines()
        .find(|line| line.starts_with("port="))
        .ok_or_else(|| AppError::Config("缺少 port 配置".into()))?;
    
    let port: u16 = port_str
        .strip_prefix("port=")
        .ok_or_else(|| AppError::Config("port 格式错误".into()))?
        .parse()?;  // ParseIntError 会自动转为 AppError::ParseInt
    
    Ok(Config { port })
}
```

### 2.3 对比 PHP 的异常层次

在 PHP 中，我们通常用类继承构建错误层次：

```php
abstract class AppException extends \RuntimeException {}
class DatabaseException extends AppException {}
class ConfigException extends AppException {}
class BusinessException extends AppException {
    public function __construct(
        private int $code,
        string $message
    ) {
        parent::__construct($message, $code);
    }
}
```

Rust 的枚举比 PHP 的类层次更**紧凑**：

- 所有变体在一个类型里，不需要 `instanceof` 检查
- 模式匹配强制你处理每种情况（exhaustive matching）
- 没有"该 catch 哪个异常"的困惑

---

## 三、thiserror vs anyhow：选型指南

手写 `Display`、`Error`、`From` 实现太繁琐？社区提供了两个主流方案。

### 3.1 thiserror —— 给库作者用的派生宏

`thiserror` 用宏自动生成 `Display` 和 `Error` 实现：

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),
    
    #[error("配置错误: {0}")]
    Config(String),
    
    #[error("解析错误: {0}")]
    Parse(#[from] serde_json::Error),
    
    #[error("业务错误 [{code}]: {message}")]
    Business { code: u16, message: String },
    
    #[error("IO 错误")]
    Io(#[from] std::io::Error),
    
    #[error("用户不存在: {id}")]
    UserNotFound { id: u64 },
}
```

**关键特性：**
- `#[error("...")]` 自动生成 `Display`
- `#[from]` 自动生成 `From` 实现
- `#[source]` 指定错误链的源
- 支持格式化字符串和结构化字段

### 3.2 anyhow —— 给应用开发者用的错误库

`anyhow` 提供了一个类型擦除的错误容器：

```rust
use anyhow::{Context, Result, bail, anyhow};

fn load_user_config(path: &str) -> Result<UserConfig> {
    let content = std::fs::read_to_string(path)
        .context(format!("读取配置文件失败: {}", path))?;
    
    let config: UserConfig = serde_json::from_str(&content)
        .context("解析配置文件 JSON 失败")?;
    
    if config.name.is_empty() {
        bail!("配置文件中 name 字段不能为空");
    }
    
    if config.timeout > 3600 {
        return Err(anyhow!("timeout {} 超出合理范围", config.timeout));
    }
    
    Ok(config)
}
```

**关键特性：**
- `Result<T>` = `Result<T, anyhow::Error>`，省去类型参数
- `.context()` 添加上下文信息（类似 Go 的 `%w` 包装）
- `bail!()` 快速返回错误
- `anyhow!()` 构造临时错误
- 自动保留错误链，支持 `backtrace`

### 3.3 选型决策树

```
你在写什么？
│
├── 库（library）
│   └── 用 thiserror
│       - 定义明确的错误枚举
│       - 让调用者决定如何处理
│       - 支持 match 和 downcast
│
└── 应用（application）
    │
    ├── 需要 match 错误类型？
    │   ├── 是 → 用 thiserror（在应用层定义自己的错误枚举）
    │   └── 否 → 用 anyhow
    │       - 快速开发，不纠结错误类型
    │       - 日志/上报时自动保留完整错误链
    │       - 适合 CLI 工具、微服务
    │
    └── 混合使用？
        └── 库用 thiserror，应用层用 anyhow
            - 库导出 `thiserror::Error` 枚举
            - 应用层用 `anyhow::Result` 包装一切
            - 用 `downcast_ref()` 在需要时提取具体错误
```

### 3.4 混合使用实战

这是**最推荐**的模式——库用 `thiserror`，应用用 `anyhow`：

```rust
// === 库 crate: my_lib ===
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("网络请求失败: {0}")]
    Network(#[from] reqwest::Error),
    
    #[error("JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    
    #[error("API 返回错误: {status} - {message}")]
    Api { status: u16, message: String },
}

pub async fn fetch_user(id: u64) -> Result<User, ApiError> {
    let resp = reqwest::get(format!("https://api.example.com/users/{}", id))
        .await?
        .error_for_status()?;
    
    let user: User = resp.json().await?;
    Ok(user)
}

// === 应用层: main.rs ===
use anyhow::{Context, Result};
use my_lib::{fetch_user, ApiError};

async fn run() -> Result<()> {
    let user = fetch_user(42)
        .await
        .context("获取用户信息失败")?;
    
    println!("用户: {}", user.name);
    Ok(())
}

// 需要具体匹配时，用 downcast_ref
async fn run_with_retry(id: u64) -> Result<User> {
    match fetch_user(id).await {
        Ok(user) => Ok(user),
        Err(err) => {
            if let Some(api_err) = err.downcast_ref::<ApiError>() {
                match api_err {
                    ApiError::Network(_) => {
                        // 网络错误，重试
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        fetch_user(id).await.context("重试失败")
                    }
                    _ => Err(err),
                }
            } else {
                Err(err)
            }
        }
    }
}
```

---

## 四、进阶模式

### 4.1 错误上下文链（对比 Go 的 `%w`）

Go 1.13 引入了错误链：

```go
// Go
return fmt.Errorf("load config: %w", err)
// 检查：errors.Is(err, os.ErrNotExist)
```

Rust 的 `anyhow` 提供了类似但更强大的 `.context()`：

```rust
// Rust + anyhow
let config = load_config(path)
    .context("加载配置失败")?;  // 自动保留原始错误

// 检查错误链
if let Some(io_err) = err.downcast_ref::<std::io::Error>() {
    if io_err.kind() == std::io::ErrorKind::NotFound {
        // 处理文件不存在
    }
}
```

### 4.2 业务错误码（对标 PHP）

在 PHP 中，我们经常用错误码：

```php
class ErrorCode {
    const USER_NOT_FOUND = 1001;
    const ORDER_EXPIRED = 2001;
    const PAYMENT_FAILED = 3001;
}

throw new BusinessException(ErrorCode::USER_NOT_FOUND, '用户不存在');
```

在 Rust 中，用枚举天然更安全：

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(u16)]
pub enum BizCode {
    UserNotFound = 1001,
    OrderExpired = 2001,
    PaymentFailed = 3001,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("业务错误 [{:?}]: {}", .code, .message)]
    Business { code: BizCode, message: String },
}

impl AppError {
    pub fn business(code: BizCode, message: impl Into<String>) -> Self {
        AppError::Business {
            code,
            message: message.into(),
        }
    }
    
    pub fn user_not_found(id: u64) -> Self {
        Self::business(BizCode::UserNotFound, format!("用户 {} 不存在", id))
    }
}

// 使用
fn get_user(id: u64) -> Result<User, AppError> {
    db.find_user(id)
        .ok_or_else(|| AppError::user_not_found(id))
}
```

### 4.3 异步错误处理

Rust 异步场景下的错误处理：

```rust
use tokio::try_join;

async fn load_dashboard(user_id: u64) -> Result<Dashboard, AppError> {
    // 并发加载多个数据源，任一失败则整体失败
    let (user, orders, notifications) = try_join!(
        fetch_user(user_id),
        fetch_orders(user_id),
        fetch_notifications(user_id),
    )?;
    
    Ok(Dashboard { user, orders, notifications })
}

// 带超时的错误处理
async fn fetch_with_timeout(url: &str) -> Result<String, AppError> {
    tokio::time::timeout(
        Duration::from_secs(5),
        reqwest::get(url)
    )
    .await
    .map_err(|_| AppError::Business {
        code: BizCode::NetworkTimeout,
        message: "请求超时".into(),
    })??
    .text()
    .await
    .map_err(AppError::Network)
}
```

### 4.4 对比 Go 的多返回值模式

Go 用多返回值返回结果和错误：

```go
func Divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, fmt.Errorf("division by zero")
    }
    return a / b, nil
}
```

Rust 用 `Result` 统一表达：

```rust
fn divide(a: f64, b: f64) -> Result<f64, AppError> {
    if b == 0.0 {
        return Err(AppError::Business {
            code: BizCode::DivisionByZero,
            message: "除数不能为零".into(),
        });
    }
    Ok(a / b)
}

// 使用 match
match divide(10.0, 0.0) {
    Ok(result) => println!("结果: {}", result),
    Err(AppError::Business { code, message }) => {
        println!("业务错误 [{:?}]: {}", code, message);
    }
    Err(err) => println!("其他错误: {}", err),
}
```

---

## 五、踩坑记录

### 5.1 坑 1：`?` 操作符的类型推断失败

```rust
// ❌ 错误：编译器无法推断错误类型
fn parse_config(s: &str) -> Result<Config> {
    let value: Value = serde_json::from_str(s)?;  // 错误类型不匹配
    Ok(Config::from(value))
}

// ✅ 正确：明确错误类型
fn parse_config(s: &str) -> Result<Config, AppError> {
    let value: Value = serde_json::from_str(s)?;
    Ok(Config::from(value))
}

// ✅ 或者用 anyhow
fn parse_config(s: &str) -> anyhow::Result<Config> {
    let value: Value = serde_json::from_str(s)?;
    Ok(Config::from(value))
}
```

### 5.2 坑 2：忘记实现 `Display`

```rust
// ❌ 错误：没有实现 Display，不能用 println!("{}", err)
#[derive(Debug)]
pub enum AppError { ... }

// ✅ 正确：必须实现 Display
impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // 每个变体都要处理
    }
}

// ✅ 或者用 thiserror 自动派生
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Database(String),
}
```

### 5.3 坑 3：错误类型过大导致性能问题

```rust
// ❌ 不推荐：每个变体都存储 String
#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(String),
    #[error("网络错误: {0}")]
    Network(String),
    // ... 很多 String 变体
}

// ✅ 推荐：用 Box 包装大错误类型
#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误")]
    Database(#[from] Box<sqlx::Error>),
    #[error("网络错误")]
    Network(#[from] Box<reqwest::Error>),
}
```

### 5.4 坑 4：在库中暴露 `anyhow::Error`

```rust
// ❌ 库不应该用 anyhow
pub fn my_lib_function() -> anyhow::Result<Data> { ... }

// ✅ 库应该用 thiserror 定义明确的错误类型
#[derive(Debug, Error)]
pub enum MyLibError {
    #[error("...")]
    ...
}

pub fn my_lib_function() -> Result<Data, MyLibError> { ... }
```

### 5.5 坑 5：`unwrap()` 和 `expect()` 滥用

```rust
// ❌ 生产代码中使用 unwrap
let config = load_config().unwrap();  // panic!

// ✅ 正确处理
let config = load_config().context("加载配置失败")?;

// ✅ 或者在确定不会失败时使用 expect（注明原因）
let home = std::env::var("HOME").expect("HOME 环境变量必须存在");
```

---

## 六、实战模板：Laravel 风格的错误处理

如果你习惯了 Laravel 的异常处理，这个模板可以帮你平滑过渡到 Rust：

```rust
// === errors.rs ===
use actix_web::{HttpResponse, ResponseError};
use std::fmt;

#[derive(Debug)]
pub enum ApiError {
    NotFound(String),
    BadRequest(String),
    Unauthorized,
    Forbidden,
    Internal(String),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(msg) => write!(f, "Not Found: {}", msg),
            Self::BadRequest(msg) => write!(f, "Bad Request: {}", msg),
            Self::Unauthorized => write!(f, "Unauthorized"),
            Self::Forbidden => write!(f, "Forbidden"),
            Self::Internal(msg) => write!(f, "Internal Error: {}", msg),
        }
    }
}

// 实现 actix-web 的 ResponseError
impl ResponseError for ApiError {
    fn error_response(&self) -> HttpResponse {
        match self {
            Self::NotFound(_) => HttpResponse::NotFound().json(serde_json::json!({
                "error": self.to_string()
            })),
            Self::BadRequest(_) => HttpResponse::BadRequest().json(serde_json::json!({
                "error": self.to_string()
            })),
            Self::Unauthorized => HttpResponse::Unauthorized().json(serde_json::json!({
                "error": "Unauthorized"
            })),
            Self::Forbidden => HttpResponse::Forbidden().json(serde_json::json!({
                "error": "Forbidden"
            })),
            Self::Internal(_) => {
                // 内部错误不暴露详情
                log::error!("{}", self);
                HttpResponse::InternalServerError().json(serde_json::json!({
                    "error": "Internal Server Error"
                }))
            }
        }
    }
}

// === handlers.rs ===
async fn get_user(
    path: web::Path<u64>,
    db: web::Data<DbPool>,
) -> Result<HttpResponse, ApiError> {
    let user_id = path.into_inner();
    
    let user = sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", user_id)
        .fetch_optional(db.get_ref())
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound(format!("User #{} not found", user_id)))?;
    
    Ok(HttpResponse::Ok().json(user))
}
```

---

## 七、总结

| 维度 | 推荐做法 |
|------|---------|
| **库开发** | `thiserror` 定义枚举，暴露明确错误类型 |
| **应用开发** | `anyhow` 快速开发，`.context()` 添加上下文 |
| **混合架构** | 库 `thiserror` + 应用 `anyhow`，用 `downcast_ref` 提取 |
| **Web API** | 自定义错误枚举 + `ResponseError`，对外隐藏内部细节 |
| **CLI 工具** | `anyhow` + `std::process::exit(1)` |

**核心心法：**

1. **Rust 的错误处理是编译器驱动的**——类型系统会告诉你哪里需要处理错误
2. **`?` 操作符是 Rust 的杀手锏**——比 Go 的 `if err != nil` 简洁，比 PHP 的 try/catch 安全
3. **thiserror 和 anyhow 不是对立的**——它们解决不同层次的问题
4. **错误是 API 的一部分**——库应该暴露明确的错误类型，应用可以选择类型擦除

从 PHP 到 Go 到 Rust，错误处理的设计哲学在不断进化：

- PHP：「信任开发者会 catch」→ 容易遗漏
- Go：「强制开发者检查 err」→ 但可以忽略
- Rust：「编译器不让你忽略」→ 最高安全性

选择 Rust，就是选择**让编译器帮你做 Code Review**。

---

> 参考资料：
> - [The Rust Programming Language - Error Handling](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html)
> - [thiserror 官方文档](https://docs.rs/thiserror)
> - [anyhow 官方文档](https://docs.rs/anyhow)
> - [Error Handling in Rust - Andrew Gallant](https://blog.burntsushi.net/rust-error-handling/)
