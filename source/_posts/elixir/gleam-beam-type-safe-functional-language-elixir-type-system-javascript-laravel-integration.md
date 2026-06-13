---
title: "Gleam 实战：BEAM VM 上的类型安全函数式语言——对比 Elixir 的类型系统、编译到 JS 与 Laravel 集成方案"
keywords: [Gleam, BEAM VM, Elixir, JS, Laravel, 上的类型安全函数式语言, 的类型系统, 编译到, 集成方案]
date: 2026-06-10 03:30:00
categories:
  - elixir
cover: https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1516259762381-2247580d4b89?w=1200&h=630&fit=crop
tags:
  - Gleam
  - BEAM
  - 函数式编程
  - 类型安全
  - Elixir
  - Erlang
  - Laravel
  - WebAssembly
description: "Gleam 是 BEAM 虚拟机上的新语言，用 Hindley-Milner 类型系统为 Erlang/Elixir 生态带来静态类型。本文从 PHP/Laravel 开发者视角深入 Gleam 语法、类型系统、JS 编译、与 Laravel 集成的完整实战路径。"
---


# Gleam 实战：BEAM VM 上的类型安全函数式语言

## 为什么要关注 Gleam？

Erlang 在 1986 年诞生于爱立信，Elixir 在 2012 年让 BEAM VM 重新流行。2024 年，Gleam 正式发布 1.0——它是 BEAM 上第三门主流语言，也是第一门提供**完整静态类型系统**的语言。

对 Laravel 开发者来说，Gleam 最大的价值不是替换 PHP，而是：

1. **类型安全的微服务层**：用 Gleam 写高性能、类型安全的微服务，通过 HTTP/gRPC 与 Laravel 通信
2. **边缘计算**：Gleam 可编译到 JavaScript，在 Cloudflare Workers/边缘节点运行
3. **消息处理**：利用 BEAM 的 Actor 模型处理高并发消息流（订单状态变更、实时推送等）

## Gleam 语言基础

### 安装与项目初始化

```bash
# macOS
brew install gleam

# 或者用 asdf
asdf plugin add gleam
asdf install gleam 1.0.0

# 创建新项目
gleam new my_service
cd my_service

# 项目结构
my_service/
├── gleam.toml          # 项目配置（类似 composer.json）
├── src/
│   └── my_service.gleam
├── test/
│   └── my_service_test.gleam
└── build/
```

### 基础语法

Gleam 的语法对 PHP 开发者来说既熟悉又陌生：

```gleam
// src/app/user.gleam

// 导入模块
import gleam/io
import gleam/string

// 类型定义
pub type User {
  User(id: Int, name: String, email: String)
}

// 函数定义——必须声明类型（但编译器会推断）
pub fn greet(user: User) -> String {
  "Hello, " <> user.name <> "!"
}

// 模式匹配——Gleam 没有 null，用 Result 类型处理错误
pub fn find_user(id: Int) -> Result(User, String) {
  case id {
    1 -> Ok(User(id: 1, name: "Michael", email: "test@example.com"))
    _ -> Error("User not found")
  }
}

// main 函数
pub fn main() {
  let user = User(id: 1, name: "Michael", email: "test@example.com")
  io.println(greet(user))
  
  // 模式匹配处理 Result
  case find_user(1) {
    Ok(user) -> io.println(greet(user))
    Error(msg) -> io.println("Error: " <> msg)
  }
}
```

### 类型系统深度

Gleam 使用 **Hindley-Milner 类型推断**，这是函数式编程中最强大的类型系统之一：

```gleam
// src/app/types.gleam

// 泛型类型
pub type Result(value, error) {
  Ok(value)
  Error(error)
}

// 枚举类型——Gleam 没有 null，用 Option 替代
pub type Option(value) {
  Some(value)
  None
}

// 代数数据类型（ADT）——用类型编码业务逻辑
pub type OrderStatus {
  Pending
  Paid(amount: Int)
  Shipped(tracking: String)
  Delivered
  Cancelled(reason: String)
}

// 模式匹配自动穷举——编译器保证所有情况都被处理
pub fn describe_order(status: OrderStatus) -> String {
  case status {
    Pending -> "Order is pending payment"
    Paid(amount) -> "Order paid: $" <> int.to_string(amount)
    Shipped(tracking) -> "Shipped: " <> tracking
    Delivered -> "Order delivered"
    Cancelled(reason) -> "Cancelled: " <> reason
  }
}

// 泛型函数
pub fn map_option(option: Option(a), f: fn(a) -> b) -> Option(b) {
  case option {
    Some(value) -> Some(f(value))
    None -> None
  }
}
```

## 与 Elixir 的类型系统对比

### Elixir 的动态类型 vs Gleam 的静态类型

```elixir
# Elixir——动态类型，运行时才报错
defmodule User do
  defstruct [:id, :name, :email]
end

def greet(%User{name: name}), do: "Hello, #{name}"
# 如果传入的不是 User struct，运行时才会崩溃
# greet(%{name: "Michael"})  # 这也能运行！
```

```gleam
// Gleam——静态类型，编译时就捕获错误
pub type User {
  User(id: Int, name: String, email: String)
}

pub fn greet(user: User) -> String {
  "Hello, " <> user.name
}
// greet(42)  # 编译错误！类型不匹配
```

### 类型推断对比

| 特性 | Elixir | Gleam |
|------|--------|-------|
| 类型系统 | 动态类型 | 静态类型（Hindley-Milner） |
| 空值处理 | `nil` | `Option(value)` |
| 错误处理 | `{:ok, value} / {:error, reason}` | `Ok(value) / Error(reason)` |
| 模式匹配 | 运行时匹配 | 编译时穷举检查 |
| 泛型 | 有限支持 | 完整泛型 |
| 编译检查 | 无 | 严格类型检查 |

### BEAM 上的类型安全

Gleam 的类型系统是**擦除式**的——类型信息在编译后消失，运行时没有开销：

```gleam
// 这个函数编译后变成纯 BEAM 字节码
pub fn add(a: Int, b: Int) -> Int {
  a + b
}

// 编译后的 Erlang（近似）
// add(A, B) -> A + B.
// 类型信息完全被擦除，零运行时开销
```

## 实战：Laravel + Gleam 微服务

### 架构设计

```
┌─────────────────┐     HTTP/gRPC     ┌─────────────────┐
│  Laravel 12.x   │ ◄──────────────► │  Gleam Service   │
│  (Web/API 层)   │                   │  (核心计算层)    │
│                 │                   │                  │
│  - 用户管理     │                   │  - 订单状态机    │
│  - 权限控制     │                   │  - 支付回调处理  │
│  - 模板渲染     │                   │  - 消息路由      │
└────────┬────────┘                   └────────┬────────┘
         │                                      │
         ▼                                      ▼
┌─────────────────┐                   ┌─────────────────┐
│     MySQL       │                   │     Redis       │
└─────────────────┘                   └─────────────────┘
```

### Gleam HTTP 服务

```toml
# gleam.toml
name = "order_service"
version = "1.0.0"
target = "erlang"

[dependencies]
gleam_stdlib = ">= 0.34.0 and < 2.0.0"
gleam_http = ">= 3.5.0 and < 4.0.0"
gleam_json = ">= 1.0.0 and < 2.0.0"
mist = ">= 1.0.0 and < 2.0.0"
wisp = ">= 0.14.0 and < 1.0.0"
```

```gleam
// src/order_service/router.gleam
import wisp
import wisp.{type Request, type Response}
import gleam/http
import gleam/json
import gleam/result

pub fn handle_request(req: Request) -> Response {
  case wisp.path_segments(req) {
    // GET /orders/:id
    ["orders", order_id] -> handle_order(req, order_id)
    // POST /orders
    ["orders"] -> handle_create_order(req)
    // GET /health
    ["health"] -> wisp.ok() |> wisp.json_body(health_json())
    _ -> wisp.not_found()
  }
}

fn handle_order(req: Request, order_id: String) -> Response {
  case order_id |> int.parse {
    Ok(id) -> {
      let order = get_order(id)
      wisp.ok() |> wisp.json_body(order_to_json(order))
    }
    Error(_) -> wisp.bad_request() |> wisp.json_body(error_json("Invalid order ID"))
  }
}

fn handle_create_order(req: Request) -> Response {
  use body <- wisp.require_string(req)
  
  case json.parse(body, order_decoder) {
    Ok(order_data) -> {
      let order = create_order(order_data)
      wisp.ok() |> wisp.json_body(order_to_json(order))
    }
    Error(_) -> wisp.bad_request() |> wisp.json_body(error_json("Invalid JSON"))
  }
}
```

### Gleam 订单状态机

```gleam
// src/order_service/order.gleam
import gleam/dynamic

pub type Order {
  Order(
    id: Int,
    status: OrderStatus,
    amount: Int,
    items: List(OrderItem),
  )
}

pub type OrderItem {
  OrderItem(product_id: Int, quantity: Int, price: Int)
}

// 订单状态机——编译器保证状态转换的合法性
pub type OrderStatus {
  Pending
  Paid(amount: Int, paid_at: String)
  Shipped(tracking: String, shipped_at: String)
  Delivered(delivered_at: String)
  Cancelled(reason: String, cancelled_at: String)
}

// 状态转换函数——类型系统防止非法转换
pub fn transition_to(order: Order, new_status: OrderStatus) -> Result(Order, String) {
  case order.status, new_status {
    // 只有 Pending 状态可以转为 Paid
    Pending, Paid(amount, paid_at) -> {
      Ok(Order(..order, status: Paid(amount, paid_at)))
    }
    // 只有 Paid 状态可以转为 Shipped
    Paid(_, _), Shipped(tracking, shipped_at) -> {
      Ok(Order(..order, status: Shipped(tracking, shipped_at)))
    }
    // 只有 Shipped 状态可以转为 Delivered
    Shipped(_, _), Delivered(delivered_at) -> {
      Ok(Order(..order, status: Delivered(delivered_at)))
    }
    // 任何状态都可以取消（但需要理由）
    _, Cancelled(reason, cancelled_at) -> {
      Ok(Order(..order, status: Cancelled(reason, cancelled_at)))
    }
    // 其他转换都是非法的
    current, _ -> {
      Error("Invalid transition from " <> describe_status(current))
    }
  }
}

fn describe_status(status: OrderStatus) -> String {
  case status {
    Pending -> "Pending"
    Paid(_, _) -> "Paid"
    Shipped(_, _) -> "Shipped"
    Delivered(_) -> "Delivered"
    Cancelled(_, _) -> "Cancelled"
  }
}
```

### Laravel 调用 Gleam 服务

```php
<?php
// app/Services/OrderService.php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class OrderService
{
    private string $gleamServiceUrl;

    public function __construct()
    {
        $this->gleamServiceUrl = config('services.gleam.order_url', 'http://localhost:8080');
    }

    /**
     * 调用 Gleam 微服务创建订单
     */
    public function createOrder(array $orderData): array
    {
        $response = Http::timeout(5)
            ->post("{$this->gleamServiceUrl}/orders", [
                'user_id' => $orderData['user_id'],
                'items' => $orderData['items'],
                'amount' => $orderData['amount'],
            ]);

        if ($response->failed()) {
            throw new \RuntimeException(
                'Gleam service error: ' . $response->body()
            );
        }

        return $response->json();
    }

    /**
     * 调用 Gleam 微服务获取订单状态
     */
    public function getOrderStatus(int $orderId): array
    {
        $response = Http::timeout(3)
            ->get("{$this->gleamServiceUrl}/orders/{$orderId}");

        if ($response->failed()) {
            throw new \RuntimeException(
                'Gleam service error: ' . $response->body()
            );
        }

        return $response->json();
    }

    /**
     * 调用 Gleam 微服务处理支付回调
     */
    public function handlePaymentCallback(array $payload): array
    {
        $response = Http::timeout(10)
            ->post("{$this->gleamServiceUrl}/payments/callback", $payload);

        return $response->json();
    }
}
```

## Gleam 编译到 JavaScript

Gleam 有两个编译目标：**Erlang（默认）** 和 **JavaScript**。

### 编译到 JS 的配置

```toml
# gleam.toml
name = "edge_service"
version = "1.0.0"
target = "javascript"  # 编译到 JS

[dependencies]
gleam_stdlib = ">= 0.34.0 and < 2.0.0"
gleam_http = ">= 3.5.0 and < 4.0.0"
gleam_json = ">= 1.0.0 and < 2.0.0"
```

### 编译到 JS 的代码

```bash
# 编译到 JavaScript
gleam build

# 输出：build/dev/javascript/edge_service.mjs
```

```gleam
// src/edge_service.gleam
import gleam/io
import gleam/int
import gleam/string

pub fn main() {
  // 这段代码同时可以在 BEAM 和 JS 上运行
  let result = calculate(10, 20)
  io.println("Result: " <> int.to_string(result))
}

pub fn calculate(a: Int, b: Int) -> Int {
  a + b
}
```

### Cloudflare Workers 集成

```javascript
// wrangler.toml
name = "edge-service"
main = "build/dev/javascript/edge_service.mjs"
compatibility_date = "2026-06-01"

[env.production]
routes = [
  { pattern = "api.yourdomain.com/edge/*", zone_name = "yourdomain.com" }
]
```

## 踩坑记录

### 1. BEAM 和 JS 编译目标的差异

```gleam
// 这个函数在 BEAM 上能编译，在 JS 上也能编译
// 但某些库只有 BEAM 版本
import gleam/erlang/process  // ❌ 这个模块只在 BEAM 上可用

// 解决方案：使用条件导入
pub fn main() {
  // Gleam 没有条件编译，需要分别维护两个版本
  // 或者用 FFI 调用平台特定代码
}
```

### 2. 类型系统的限制

```gleam
// Gleam 的类型系统不支持可变状态
// 这在写状态机时需要适应
pub type State {
  State(counter: Int)
}

// ❌ 不能直接修改状态
// pub fn increment(state: State) -> State {
//   state.counter = state.counter + 1  // 编译错误
// }

// ✅ 创建新状态（不可变更新）
pub fn increment(state: State) -> State {
  State(counter: state.counter + 1)
}
```

### 3. 与 Laravel 的通信性能

```php
<?php
// ❌ 每次请求都新建 HTTP 连接（慢）
public function callGleam(array $data): array
{
    $response = Http::post('http://localhost:8080/api', $data);
    return $response->json();
}

// ✅ 使用连接池（Laravel 11+ 默认支持）
public function callGleam(array $data): array
{
    // Laravel 的 HTTP 客户端底层使用 Guzzle
    // 默认就有连接池管理
    return Http::retry(3, 100)
        ->timeout(5)
        ->post('http://localhost:8080/api', $data)
        ->json();
}
```

### 4. 错误处理的差异

```gleam
// Gleam 使用 Result 类型，没有异常
pub fn parse_int(input: String) -> Result(Int, String) {
  case int.parse(input) {
    Ok(n) -> Ok(n)
    Error(_) -> Error("Invalid integer: " <> input)
  }
}

// 调用时必须处理两种情况
pub fn process_value(input: String) -> String {
  case parse_int(input) {
    Ok(n) -> "Parsed: " <> int.to_string(n)
    Error(msg) -> "Error: " <> msg
  }
}
```

```php
<?php
// PHP 使用异常，两种风格都可以
public function parseInt(string $input): int
{
    $result = filter_var($input, FILTER_VALIDATE_INT);
    
    if ($result === false) {
        throw new \InvalidArgumentException("Invalid integer: {$input}");
    }
    
    return $result;
}

// Laravel 中两种风格都常见
// 1. 抛异常（Laravel 默认风格）
// 2. 返回 Result/Option（更函数式）
```

### 5. 包管理差异

```bash
# Gleam 使用 Hex 包管理（Elixir/Erlang 生态）
gleam add gleam_json
gleam add mist      # HTTP 服务器
gleam add wisp      # Web 框架

# 依赖锁定在 manifest.toml
# 类似 composer.lock
```

## 总结

Gleam 为 Laravel 开发者提供了几个独特的价值：

1. **类型安全的微服务层**：用 Gleam 写核心计算逻辑，通过 HTTP/gRPC 与 Laravel 通信
2. **边缘计算能力**：编译到 JavaScript，在 Cloudflare Workers 等边缘环境运行
3. **BEAM 的并发模型**：利用 Actor 模型处理高并发消息流
4. **函数式思维**：学习不可变数据、模式匹配、代数数据类型

**不建议**把整个 Laravel 项目迁移到 Gleam——PHP 生态的成熟度和 Laravel 的开发效率是不可替代的。但在特定场景（高并发消息处理、类型安全的计算层、边缘函数）下，Gleam 是一个值得考虑的选择。

---

> **参考资源**
> - [Gleam 官方文档](https://gleam.run/documentation/)
> - [Gleam 语言规范](https://gleam.run specification/)
> - [Erlang/Elixir 生态](https://hex.pm/)
> - [BEAM VM 架构](https://www.erlang-solutions.com/resources/downloadables/beams/)
