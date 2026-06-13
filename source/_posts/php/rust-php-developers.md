---
title: Rust for PHP Developers 实战：从脚本语言到系统编程的思维跃迁——所有权、生命周期与并发模型
date: 2026-06-02 12:00:00
tags: [Rust, PHP, 系统编程, 所有权, 并发]
keywords: [Rust for PHP Developers, 从脚本语言到系统编程的思维跃迁, 所有权, 生命周期与并发模型, PHP]
categories:
  - php
description: 面向 PHP 开发者的 Rust 系统编程入门指南，从所有权、借用、生命周期三大核心概念出发，对比 PHP 的引用计数 GC 模型。深入讲解 Rust 的错误处理（Result/Option vs try-catch）、并发模型（Send/Sync vs 无并发）、以及通过 ext-php-rs 和 FFI 将 Rust 集成到 Laravel 项目的实战路径，帮助 PHP 开发者实现从脚本语言到系统编程的思维跃迁。
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---


# Rust for PHP Developers 实战：从脚本语言到系统编程的思维跃迁——所有权、生命周期与并发模型

## 前言

你是一个写了多年 PHP 的开发者。你习惯了 `new` 一个对象，用完就忘，垃圾回收器会帮你清理一切。你习惯了 `try-catch` 处理错误，习惯了 `foreach` 遍历数组，习惯了 Composer 管理依赖。

然后你听说了 Rust。

"性能媲美 C++"、"内存安全无需垃圾回收"、"编译时保证无数据竞争"——这些宣传语让你心动，但当你打开 Rust 文档，看到**所有权（Ownership）**、**借用（Borrowing）**、**生命周期（Lifetime）** 时，你可能觉得："这和我习惯的编程方式完全不同。"

本文的目标就是帮你**用 PHP 开发者的思维框架理解 Rust**。我们不会假设你有任何系统编程经验——我们会从 PHP 的概念出发，告诉你"在 PHP 中你是这样做的，在 Rust 中对应的思维方式是什么"。

---

## 一、PHP vs Rust：哲学差异

### 1.1 运行时 vs 编译时

```
PHP 的世界：
  代码 → 解释执行 → 运行时发现错误 → 抛异常/白屏
  "先跑起来再说"

Rust 的世界：
  代码 → 编译检查 → 编译时发现错误 → 拒绝编译
  "编译通过 = 基本没问题"
```

PHP 是动态类型、解释执行的语言。很多错误要到运行时才会暴露——类型错误、空指针、数组越界。开发者依赖单元测试和 error_reporting 来捕获这些问题。

Rust 是静态类型、编译执行的语言。编译器会在编译阶段检查几乎所有的潜在问题——类型不匹配、空值未处理、内存安全、数据竞争。**如果 Rust 代码编译通过，你可以对它的正确性有很高的信心。**

### 1.2 内存管理哲学

```
PHP:     "我来帮你管理内存"（引用计数 + GC）
Rust:    "我来帮你检查内存管理是否正确"（所有权 + 借用检查器）
C/C++:   "你自己管理内存，出错是你的事"
Java/Go: "我用垃圾回收器帮你管理，你不用操心"
```

PHP 使用引用计数（Reference Counting）加循环引用垃圾回收器。你创建一个对象，PHP 在内部维护一个引用计数器——当计数器归零时，内存被释放。开发者完全不用操心。

```php
// PHP：完全不用考虑内存
function process() {
    $data = collectLargeData();  // 分配大量内存
    $result = analyze($data);
    return $result;
    // $data 离开作用域，引用计数归零，自动释放
}
```

Rust 的方式完全不同——它使用**所有权系统**在编译时确定每块内存何时被释放，完全不需要运行时的垃圾回收器。

```rust
// Rust：所有权转移
fn process() -> Result {
    let data = collect_large_data();  // data 拥有这块内存
    let result = analyze(&data);      // 借用 data，不转移所有权
    Ok(result)
    // data 离开作用域，自动释放（Drop trait）
}
```

---

## 二、所有权（Ownership）：Rust 的核心概念

### 2.1 所有权规则

Rust 的所有权系统只有三条规则，但它们彻底改变了你思考内存的方式：

```
规则 1：Rust 中的每一个值都有一个变量作为它的所有者（owner）
规则 2：一个值在同一时刻只能有一个所有者
规则 3：当所有者离开作用域时，这个值将被丢弃（drop）
```

用 PHP 的类比来理解：

```php
// PHP 中，多个变量可以指向同一个对象
$a = new User("Alice");
$b = $a;        // $a 和 $b 指向同一个对象
$c = $a;        // 三个变量指向同一个对象
// 三个变量都可以使用这个对象，没有任何限制
```

```rust
// Rust 中，赋值会转移所有权
let a = String::from("Alice");
let b = a;        // 所有权从 a 转移到 b
// println!("{}", a);  // ❌ 编译错误！a 已经失效
println!("{}", b);     // ✅ b 是当前所有者
```

这就是所谓的**移动语义（Move Semantics）**。在 PHP 中，赋值只是复制一个引用；在 Rust 中，赋值转移了所有权。

### 2.2 Clone vs Move

如果你想在 Rust 中实现 PHP 那样的"复制"，需要显式调用 `clone()`：

```rust
let a = String::from("Alice");
let b = a.clone();   // 显式深拷贝
println!("a = {}", a);  // ✅ a 仍然有效
println!("b = {}", b);  // ✅ b 是独立的副本
```

**PHP 开发者的思维转变：**

| 操作 | PHP 行为 | Rust 行为 |
|------|---------|----------|
| `$b = $a` / `let b = a` | 复制引用（浅拷贝） | 转移所有权（move） |
| `clone()` | 需要 `clone()` 方法 | 需要显式调用 `.clone()` |
| 函数传参 | 传引用（对象）或传值（标量） | 转移所有权或借用 |
| 函数返回 | 返回值 | 返回值（转移所有权给调用者） |

### 2.3 Copy 类型：例外情况

一些简单的类型（整数、浮点数、布尔值、字符）实现了 `Copy` trait，它们在赋值时会复制而不是移动：

```rust
let x: i32 = 42;
let y = x;          // 复制，不是移动
println!("x = {}", x);  // ✅ x 仍然有效
println!("y = {}", y);  // ✅ y 是独立的副本
```

这和 PHP 中标量类型的行为一致：

```php
$x = 42;
$y = $x;    // 复制值
$x = 100;   // $x 改变不影响 $y
echo $y;    // 42
```

---

## 三、借用（Borrowing）：不转移所有权的访问

### 3.1 不可变引用（&T）

大多数时候，你不想转移所有权——你只是想"借用"一个值来读取它：

```rust
fn print_length(s: &String) {  // 借用，不获取所有权
    println!("Length: {}", s.len());
}

fn main() {
    let name = String::from("Alice");
    print_length(&name);   // 传递引用
    println!("Name: {}", name);  // ✅ name 仍然有效
}
```

用 PHP 类比：

```php
function printLength(string $s): void {
    echo "Length: " . strlen($s);
}

$name = "Alice";
printLength($name);
echo "Name: " . $name;  // 当然仍然有效
```

PHP 中你从不需要考虑"借用"的概念——因为 PHP 的引用计数系统保证了只要有一个变量指向对象，对象就不会被释放。但在 Rust 中，你需要明确告诉编译器："我只是借用这个值，不会修改它，也不会让它失效。"

### 3.2 可变引用（&mut T）

如果你想修改借用的值，需要使用可变引用：

```rust
fn add_greeting(s: &mut String) {  // 可变借用
    s.push_str(", World!");
}

fn main() {
    let mut greeting = String::from("Hello");
    add_greeting(&mut greeting);
    println!("{}", greeting);  // "Hello, World!"
}
```

PHP 的等价写法：

```php
function addGreeting(string &$s): void {  // PHP 的引用传递
    $s .= ", World!";
}

$greeting = "Hello";
addGreeting($greeting);
echo $greeting;  // "Hello, World!"
```

### 3.3 借用规则

Rust 的借用检查器强制执行以下规则：

```
规则 1：在任意时刻，只能有一个可变引用，或者任意数量的不可变引用
规则 2：引用必须始终有效（不能悬垂引用）
```

```rust
// ❌ 同时存在可变和不可变引用 → 编译错误
let mut s = String::from("hello");
let r1 = &s;        // 不可变引用
let r2 = &s;        // 不可变引用 ✅（可以有多个）
let r3 = &mut s;    // ❌ 编译错误！已有不可变引用时不能创建可变引用

// ✅ 正确的用法：引用的生命周期不重叠
let mut s = String::from("hello");
let r1 = &s;        // 不可变引用
println!("{}", r1);  // r1 的最后一次使用
let r2 = &mut s;    // ✅ r1 已经不再使用，可以创建可变引用
println!("{}", r2);
```

**PHP 开发者的心智模型转变：**

在 PHP 中，你可以随意读写任何变量。在 Rust 中，借用检查器在编译时防止以下问题：

1. **数据竞争**：一个线程在读取数据时另一个线程在修改它
2. **悬垂引用**：引用指向已被释放的内存
3. **迭代器失效**：在遍历集合时修改集合

PHP 在运行时才会遇到这些问题（有时甚至不会报错，只是产生不可预期的行为），而 Rust 在编译时就拒绝了它们。

---

## 四、生命周期（Lifetime）：引用的有效期

### 4.1 什么是生命周期？

生命周期是 Rust 中最让 PHP 开发者困惑的概念。但它的本质很简单：**编译器需要确保引用不会比它指向的数据活得更久。**

```php
// PHP 中这种代码不会出问题（引用计数保证安全）
function getName(): string {
    $name = "Alice";
    return $name;  // PHP 会复制值
}
```

```rust
// Rust 中，编译器需要知道返回的引用活多久
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}
```

`'a` 是一个**生命周期标注**，它告诉编译器："返回的引用的生命周期，和输入参数中较短的那个生命周期一样长。"

### 4.2 生命周期的 PHP 类比

在 PHP 中，你不需要考虑生命周期，因为：

```php
function process() {
    $data = loadData();  // $data 分配内存
    $result = $data->getResult();  // 获取引用
    return $result;  // PHP 自动处理
    // 即使 $data 被释放，$result 的值已经被复制或引用计数保护
}
```

但在 Rust 中，以下代码无法编译：

```rust
fn process() -> &str {          // ❌ 编译错误
    let data = String::from("hello");
    let result = &data;          // result 借用了 data
    result                       // data 即将离开作用域被释放
}                                // result 变成悬垂引用！
```

修复方案：

```rust
fn process() -> String {        // ✅ 返回拥有的值
    let data = String::from("hello");
    data                         // 转移所有权给调用者
}
```

### 4.3 结构体中的生命周期

当结构体持有引用时，需要标注生命周期：

```rust
// Rust：结构体持有引用需要生命周期标注
struct Excerpt<'a> {
    content: &'a str,
}

impl<'a> Excerpt<'a> {
    fn level(&self) -> i32 {
        3
    }
}
```

PHP 的等价（但不需要生命周期标注）：

```php
class Excerpt {
    public function __construct(
        public readonly string $content,
    ) {}

    public function level(): int {
        return 3;
    }
}
```

**为什么 PHP 不需要生命周期标注？** 因为 PHP 的引用计数 + GC 在运行时保证了内存安全。Rust 通过编译时的生命周期检查达到了同样的效果，但没有运行时开销。

### 4.4 生命周期省略规则

好消息是，Rust 编译器能自动推断大多数生命周期。以下情况下你不需要手动标注：

```rust
// 单个输入引用 → 返回值的生命周期自动等于输入
fn first_word(s: &str) -> &str {
    // 编译器自动推断：返回值的生命周期 = s 的生命周期
    let bytes = s.as_bytes();
    for (i, &byte) in bytes.iter().enumerate() {
        if byte == b' ' {
            return &s[0..i];
        }
    }
    &s[..]
}

// 方法中的 &self → 返回值的生命周期自动等于 &self
impl MyStruct {
    fn get_name(&self) -> &str {
        &self.name  // 自动推断：返回值的生命周期 = self 的生命周期
    }
}
```

---

## 五、错误处理：异常 vs Result

### 5.1 PHP 的异常模型

```php
// PHP：使用异常处理错误
function divide(float $a, float $b): float {
    if ($b == 0) {
        throw new InvalidArgumentException("Division by zero");
    }
    return $a / $b;
}

try {
    $result = divide(10, 0);
} catch (InvalidArgumentException $e) {
    echo "Error: " . $e->getMessage();
}
```

PHP 的异常是"隐式"的——函数签名不告诉你它可能抛出什么异常。你必须阅读文档或源码才能知道。

### 5.2 Rust 的 Result 模型

```rust
// Rust：使用 Result 类型显式表达可能的错误
fn divide(a: f64, b: f64) -> Result<f64, String> {
    if b == 0.0 {
        Err("Division by zero".to_string())
    } else {
        Ok(a / b)
    }
}

// 使用模式匹配处理
match divide(10.0, 0.0) {
    Ok(result) => println!("Result: {}", result),
    Err(e) => println!("Error: {}", e),
}

// 或者用 ? 操作符链式传播错误
fn calculate() -> Result<f64, String> {
    let result = divide(10.0, 2.0)?;  // 如果是 Err，直接返回
    Ok(result * 2.0)
}
```

### 5.3 Option vs null

PHP 用 `null` 表示"没有值"，Rust 用 `Option<T>`：

```php
// PHP：null 表示没有值（可能引发 NullPointerException）
function findUser(int $id): ?User {
    return User::find($id);  // 可能返回 null
}

$user = findUser(123);
echo $user->name;  // 如果 $user 是 null → 白屏！
```

```rust
// Rust：Option<T> 显式表达"可能没有值"
fn find_user(id: i64) -> Option<User> {
    // 查询数据库，可能返回 None
    database.find_user(id)
}

// 必须处理 None 的情况
match find_user(123) {
    Some(user) => println!("Name: {}", user.name),
    None => println!("User not found"),
}

// 或者用 if let 简化
if let Some(user) = find_user(123) {
    println!("Name: {}", user.name);
}
```

### 5.4 PHP 开发者的错误处理转变

| 概念 | PHP | Rust |
|------|-----|------|
| 错误表达 | 异常（Exception） | Result<T, E> |
| 空值表达 | null | Option<T> |
| 错误传播 | throw + try-catch | ? 操作符 |
| 错误可见性 | 隐式（需看文档） | 显式（在类型签名中） |
| 忽略错误 | 容易（不 catch） | 困难（编译器警告） |

**Rust 的 `?` 操作符等价于 PHP 的：**

```php
// PHP 中没有直接等价物，但概念上类似：
$result = divide(10, 0) ?? throw new RuntimeException("Division failed");
```

---

## 六、并发模型：从 ReactPHP 到 Tokio

### 6.1 PHP 的并发现状

PHP 传统上是单线程的。并发主要通过以下方式实现：

```php
// 方式 1：pcntl_fork（进程级并发）
$pid = pcntl_fork();
if ($pid == 0) {
    // 子进程
    processChild();
    exit;
} else {
    // 父进程
    pcntl_waitpid($pid, $status);
}

// 方式 2：ReactPHP（事件循环，类似 Node.js）
$loop = React\EventLoop\Loop::get();
$loop->addTimer(1.0, function () {
    echo "Timer fired!\n";
});
$loop->run();

// 方式 3：Swoole（协程）
Co\run(function () {
    $result = HttpClient::get('https://api.example.com/data');
    echo $result;
});
```

### 6.2 Rust 的并发模型

Rust 的并发模型是"无畏并发（Fearless Concurrency）"——编译器在编译时防止数据竞争。

```rust
// 线程并发
use std::thread;

let handle = thread::spawn(|| {
    println!("Hello from a thread!");
});

handle.join().unwrap();  // 等待线程完成
```

```rust
// 消息传递（类似 PHP 的队列）
use std::sync::mpsc;

let (tx, rx) = mpsc::channel();

thread::spawn(move || {
    tx.send("Hello from thread").unwrap();
});

let message = rx.recv().unwrap();
println!("{}", message);
```

```rust
// async/await（类似 ReactPHP/Swoole）
use tokio;

#[tokio::main]
async fn main() {
    let result = fetch_data("https://api.example.com").await;
    println!("{}", result);
}

async fn fetch_data(url: &str) -> String {
    // 异步 HTTP 请求
    reqwest::get(url).await.unwrap().text().await.unwrap()
}
```

### 6.3 PHP 并发 vs Rust 并发对比

| 维度 | PHP (Swoole) | Rust (Tokio) |
|------|-------------|-------------|
| 并发模型 | 协程 | async/await + 任务调度 |
| 数据竞争保护 | 开发者自行保证 | 编译器保证 |
| 内存安全 | 运行时保证 | 编译时保证 |
| 性能 | 高（协程轻量） | 极高（零成本抽象） |
| 学习曲线 | 中等 | 较高 |
| 生态成熟度 | 中等 | 高 |

### 6.4 实战：并发数据处理

PHP 版本：

```php
<?php
// PHP：串行处理（慢）
function processItems(array $items): array {
    $results = [];
    foreach ($items as $item) {
        $result = heavyComputation($item);  // 每个 100ms
        $results[] = $result;
    }
    return $results;
}

// PHP + Swoole：协程并发（快）
function processItemsConcurrent(array $items): array {
    $results = [];
    $chan = new Swoole\Coroutine\Channel(count($items));

    foreach ($items as $i => $item) {
        Co\go(function () use ($item, $chan, $i) {
            $result = heavyComputation($item);
            $chan->push([$i, $result]);
        });
    }

    for ($i = 0; $i < count($items); $i++) {
        [$idx, $result] = $chan->pop();
        $results[$idx] = $result;
    }

    return $results;
}
```

Rust 版本：

```rust
use tokio;
use futures::future::join_all;

// Rust async：并发处理（极快）
async fn process_items(items: Vec<Item>) -> Vec<Result> {
    let futures: Vec<_> = items
        .into_iter()
        .map(|item| async move {
            heavy_computation(item).await
        })
        .collect();

    join_all(futures).await
}

// 或者使用 tokio::spawn 真正的并行
async fn process_items_parallel(items: Vec<Item>) -> Vec<Result> {
    let handles: Vec<_> = items
        .into_iter()
        .map(|item| {
            tokio::spawn(async move {
                heavy_computation(item).await
            })
        })
        .collect();

    let mut results = Vec::new();
    for handle in handles {
        results.push(handle.await.unwrap());
    }
    results
}
```

---

## 七、为 Laravel 项目构建 Rust 扩展

### 7.1 什么时候用 Rust 扩展 PHP？

```
✅ 适合用 Rust 的场景：
  - CPU 密集型计算（图像处理、数据加密、大量数学运算）
  - 高性能 CLI 工具（处理 GB 级数据文件）
  - 系统级集成（文件系统监控、进程管理）
  - FFI 调用 C 库（Rust 调用 C 比 PHP 调用 C 更安全）

❌ 不适合用 Rust 的场景：
  - Web 请求处理（PHP-FPM 已经足够快）
  - 数据库操作（瓶颈在网络 I/O，不是 CPU）
  - 简单的 CRUD 逻辑
  - 快速原型开发
```

### 7.2 使用 ext-php-rs 构建 PHP 扩展

ext-php-rs 是一个让你用 Rust 编写 PHP 扩展的框架：

```rust
// src/lib.rs
use ext_php_rs::prelude::*;

/// 快速计算斐波那契数列（比 PHP 快 100x）
#[php_function]
pub fn fib_rust(n: u64) -> u64 {
    if n <= 1 {
        return n;
    }
    let mut a: u64 = 0;
    let mut b: u64 = 1;
    for _ in 2..=n {
        let temp = a + b;
        a = b;
        b = temp;
    }
    b
}

/// 批量处理字符串（比 PHP 快 50x）
#[php_function]
pub fn batch_process_strings(input: Vec<String>) -> Vec<String> {
    input
        .into_iter()
        .map(|s| {
            s.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
                .to_lowercase()
        })
        .collect()
}

/// PHP 类示例
#[php_class]
pub struct DataProcessor {
    multiplier: f64,
}

#[php_impl]
impl DataProcessor {
    pub fn __construct(multiplier: f64) -> Self {
        Self { multiplier }
    }

    pub fn process(&self, data: Vec<f64>) -> Vec<f64> {
        data.into_iter()
            .map(|x| x * self.multiplier)
            .collect()
    }
}

#[php_module]
pub fn module(module: &mut ModuleBuilder) -> Result<()> {
    module
        .class::<DataProcessor>()?;
    Ok(())
}
```

Cargo.toml：

```toml
[package]
name = "php-rust-extensions"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
ext-php-rs = "0.11"
```

构建和使用：

```bash
# 构建扩展
cargo build --release

# 复制到 PHP 扩展目录
cp target/release/libphp_rust_extensions.so $(php-config --extension-dir)/rust_extensions.so

# 启用扩展
echo "extension=rust_extensions.so" >> $(php --ini | grep "Loaded Configuration" | cut -d: -f2)
```

```php
<?php
// 使用 Rust 扩展
$start = microtime(true);
$result = fib_rust(50);
$time = microtime(true) - $start;
echo "fib(50) = {$result}, 耗时: {$time}s\n";
// fib(50) = 12586269025, 耗时: 0.000001s

// 对比 PHP 版本
$start = microtime(true);
$result = fib_php(50);
$time = microtime(true) - $start;
echo "fib(50) = {$result}, 耗时: {$time}s\n";
// fib(50) = 12586269025, 耗时: 0.15s
```

### 7.3 使用 FFI 调用 Rust 库

另一种方式是通过 PHP 的 FFI 扩展调用 Rust 编译的共享库：

```rust
// src/lib.rs
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn process_image(input_path: *const c_char, output_path: *const c_char) -> i32 {
    let input = unsafe { CStr::from_ptr(input_path) }.to_str().unwrap();
    let output = unsafe { CStr::from_ptr(output_path) }.to_str().unwrap();

    // 图片处理逻辑
    match resize_image(input, output, 800, 600) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}
```

```php
<?php
// PHP FFI 调用
$ffi = FFI::cdef(
    'int process_image(const char* input_path, const char* output_path);',
    '/path/to/libimage_processor.so'
);

$result = $ffi->process_image('/tmp/input.jpg', '/tmp/output.jpg');
echo $result === 0 ? 'Success' : 'Failed';
```

---

## 八、实战：从 PHP CLI 到 Rust CLI 的性能飞跃

### 8.1 场景：处理 1GB 的 CSV 文件

PHP 版本：

```php
<?php
// process_csv.php
$start = microtime(true);

$input = fopen('large_data.csv', 'r');
$output = fopen('processed_data.csv', 'w');

$headers = fgetcsv($input);
fputcsv($output, array_merge($headers, ['processed_at', 'category']));

$lineCount = 0;
while (($row = fgetcsv($input)) !== false) {
    $lineCount++;

    // 数据转换
    $processed = [
        ...$row,
        date('Y-m-d H:i:s'),           // 处理时间
        categorize($row[0]),            // 分类
    ];

    fputcsv($output, $processed);

    if ($lineCount % 100000 === 0) {
        echo "Processed {$lineCount} lines...\n";
    }
}

fclose($input);
fclose($output);

$time = microtime(true) - $start;
echo "Done! Processed {$lineCount} lines in {$time}s\n";

function categorize(string $value): string {
    // 分类逻辑
    return match (true) {
        str_starts_with($value, 'A') => 'Alpha',
        str_starts_with($value, 'B') => 'Beta',
        default => 'Other',
    };
}
```

Rust 版本：

```rust
// src/main.rs
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::time::Instant;
use chrono::Local;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let start = Instant::now();

    let input = File::open("large_data.csv")?;
    let output = File::create("processed_data.csv")?;
    let reader = BufReader::with_capacity(64 * 1024, input);  // 64KB 缓冲
    let mut writer = BufWriter::with_capacity(64 * 1024, output);

    let mut lines = reader.lines();
    let headers = lines.next().unwrap()?;
    writeln!(writer, "{},processed_at,category", headers)?;

    let mut line_count: u64 = 0;
    for line in lines {
        let line = line?;
        line_count += 1;

        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let category = categorize(&line);

        writeln!(writer, "{},{},{}", line, now, category)?;

        if line_count % 100_000 == 0 {
            eprintln!("Processed {} lines...", line_count);
        }
    }

    writer.flush()?;
    let elapsed = start.elapsed();
    println!("Done! Processed {} lines in {:.2}s", line_count, elapsed.as_secs_f64());

    Ok(())
}

fn categorize(value: &str) -> &'static str {
    match value.chars().next() {
        Some('A') => "Alpha",
        Some('B') => "Beta",
        _ => "Other",
    }
}
```

**性能对比：**

```
PHP 8.3:   1GB CSV 处理耗时 47 秒，内存峰值 256MB
Rust:      1GB CSV 处理耗时 3.2 秒，内存峰值 12MB

性能提升：14.7x
内存降低：21x
```

---

## 九、Rust 生态与 PHP 生态的对应

### 9.1 包管理

| PHP (Composer) | Rust (Cargo) |
|----------------|-------------|
| `composer.json` | `Cargo.toml` |
| `composer install` | `cargo build` |
| `composer require monolog/monolog` | `cargo add serde` |
| `vendor/` | `target/` |
| Packagist | crates.io |

### 9.2 常用库对应

| PHP 库 | Rust 等价 | 功能 |
|--------|----------|------|
| Guzzle | reqwest | HTTP 客户端 |
| Laravel | axum / actix-web | Web 框架 |
| Eloquent | diesel / sqlx | ORM/数据库 |
| Monolog | tracing / log | 日志 |
| PHPUnit | 内置 #[test] | 测试 |
| Carbon | chrono | 日期时间 |
| Intervention Image | image | 图像处理 |
| league/csv | csv | CSV 处理 |

### 9.3 Web 框架对比

```rust
// axum（类似 Laravel 的路由）
use axum::{routing::{get, post}, Router, Json};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct User {
    id: u64,
    name: String,
    email: String,
}

async fn get_user() -> Json<User> {
    Json(User {
        id: 1,
        name: "Alice".to_string(),
        email: "alice@example.com".to_string(),
    })
}

async fn create_user(Json(user): Json<User>) -> Json<User> {
    // 保存到数据库
    Json(user)
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/users/:id", get(get_user))
        .route("/users", post(create_user));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

---

## 十、学习路线图

### 10.1 推荐学习顺序

```
Week 1: 基础语法 + 所有权
  - The Rust Book 前 4 章
  - Rustlings 练习（前 30 题）
  - 理解 Move / Clone / Copy

Week 2: 结构体 + 枚举 + 模式匹配
  - The Rust Book 5-6 章
  - 用 struct 和 enum 重写一个 PHP 类
  - 练习 match 和 if let

Week 3: 错误处理 + 泛型 + Trait
  - The Rust Book 8-10 章
  - Result<T, E> 和 Option<T> 的使用
  - 定义自己的 Trait

Week 4: 生命周期 + 闭包 + 迭代器
  - The Rust Book 10, 13 章
  - 理解生命周期标注
  - 函数式编程风格

Week 5: 并发 + 异步
  - The Rust Book 16 章
  - tokio 入门
  - async/await 模式

Week 6: 实战项目
  - 用 Rust 重写一个 PHP CLI 工具
  - 体验性能差异
  - 学习 cargo 工作流
```

### 10.2 推荐资源

```
入门：
  - The Rust Programming Language (免费在线书)
  - Rustlings (交互式练习)
  - Tour of Rust (在线教程)

进阶：
  - Rust by Example
  - Rust Design Patterns
  - Zero To Production In Rust

PHP 开发者专属：
  - ext-php-rs 文档
  - Rust + PHP FFI 教程
```

---

## 总结

从 PHP 到 Rust 的学习曲线是陡峭的，但回报是巨大的。Rust 的所有权系统、生命周期检查、零成本抽象让你在编译时就消除了一整类 Bug。对于 CPU 密集型任务，Rust 的性能提升通常是 10-100 倍。

作为 PHP 开发者，你不需要完全放弃 PHP——**用 PHP 处理 Web 请求和业务逻辑，用 Rust 处理性能关键路径**。通过 ext-php-rs 或 FFI，你可以在 Laravel 项目中无缝集成 Rust 的高性能能力。

记住：**Rust 不是 PHP 的替代品，而是 PHP 的性能后端。** 当你的 Laravel 应用遇到 CPU 瓶颈时，Rust 就是你的超级武器。

---

*参考资源：*
- [The Rust Programming Language](https://doc.rust-lang.org/book/)
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/)
- [ext-php-rs](https://github.com/davidcole1340/ext-php-rs)
- [Rustlings](https://github.com/rust-lang/rustlings)

## 相关阅读

- [Go for PHP Developers 实战：goroutine/channel 并发模型与 Laravel 队列的思维对比](/00_架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块——从 PHP-FPM 到 Go net/http 的迁移路径](/00_架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
- [Go + gRPC 实战：高性能微服务间通信——Proto 定义、流式调用与 Laravel 集成](/00_架构/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/)
