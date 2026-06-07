# Go 语言基础

## 定义

Go（Golang）是 Google 2009 年开源的静态编译型语言，由 Rob Pike、Ken Thompson、Robert Griesemer 设计。主打**简洁语法 + 原生并发 + 编译速度快**，是云原生时代的事实标准语言。

## 核心特性

### 变量与类型

```go
// 显式声明
var x int = 10
var name string = "hello"

// 短声明（函数内）
y := 20
msg := "world"

// 常量
const Pi = 3.14
const (
    StatusOK    = 200
    StatusError = 500
)
```

**基本类型**：`bool`、`int/int8/int16/int32/int64`、`uint`、`float32/float64`、`string`、`byte`（uint8 别名）、`rune`（int32 别名，Unicode 码点）

**复合类型**：`array`（固定长度）、`slice`（动态切片）、`map`（哈希表）、`struct`（结构体）、`interface`（接口）、`func`（函数类型）

### 函数

```go
// 多返回值（Go 的灵魂设计）
func divide(a, b int) (int, error) {
    if b == 0 {
        return 0, fmt.Errorf("division by zero")
    }
    return a / b, nil
}

// 命名返回值
func swap(a, b int) (x, y int) {
    x = b
    y = a
    return // 裸返回
}

// 可变参数
func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}
```

### Struct（结构体）

```go
type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email,omitempty"`
}

// 方法（值接收者）
func (u User) DisplayName() string {
    return fmt.Sprintf("%s <%s>", u.Name, u.Email)
}

// 方法（指针接收者——可修改原值）
func (u *User) SetName(name string) {
    u.Name = name
}
```

### Interface（接口）

```go
// 隐式实现——不需要 implements 关键字
type Writer interface {
    Write([]byte) (int, error)
}

// 任何实现了 Write 方法的类型都满足 Writer 接口
type FileWriter struct { /* ... */ }
func (fw FileWriter) Write(data []byte) (int, error) { /* ... */ }

// 空接口（类似 PHP 的 mixed）
func printAny(v interface{}) {
    fmt.Printf("%v\n", v)
}

// 类型断言
func process(v interface{}) {
    if s, ok := v.(string); ok {
        fmt.Println("string:", s)
    }
}
```

### 包管理与模块

```bash
# 初始化模块
go mod init github.com/user/project

# 添加依赖
go get github.com/gin-gonic/gin

# 整理依赖
go mod tidy
```

```go
// 包的导入
import (
    "fmt"
    "github.com/user/project/internal/service"
)

// 包的可见性：大写开头 = 导出，小写开头 = 包内私有
func ExportedFunc() {}   // 外部可见
func privateFunc() {}    // 仅包内可见
```

### 控制流

```go
// if 无括号
if x > 0 {
    fmt.Println("positive")
} else if x == 0 {
    fmt.Println("zero")
} else {
    fmt.Println("negative")
}

// switch 自动 break
switch day {
case "Mon":
    fmt.Println("Monday")
case "Tue", "Wed":
    fmt.Println("Midweek")
default:
    fmt.Println("Other")
}

// for 是唯一的循环
for i := 0; i < 10; i++ { /* ... */ }

// range 遍历
for i, v := range slice { /* ... */ }
for k, v := range myMap { /* ... */ }
for _, ch := range "Hello, 世界" { /* rune 遍历 */ }
```

## 与 PHP 的关键差异

| 维度 | Go | PHP |
|------|-----|-----|
| 类型系统 | 静态强类型，编译时检查 | 动态弱类型，运行时检查 |
| 并发模型 | goroutine + channel | Fibers（PHP 8.1+）/Swoole 协程 |
| 错误处理 | 显式返回 error，无异常 | try/catch 异常机制 |
| 面向对象 | struct + interface，无继承 | class + interface + trait + 继承 |
| 内存管理 | GC（< 1ms STW） | 引用计数 + GC |
| 部署 | 单二进制，无运行时依赖 | 需要 PHP-FPM/Swoole 运行时 |
| 泛型 | Go 1.18+ 支持 | PHP 8.0+ 部分支持 |
| 依赖管理 | go mod | Composer |

## 实战案例

来自博客文章：
- [Go for PHP Developers 实战：goroutine/channel 并发模型与 Laravel 队列的思维对比](/2026/06/01/00_架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
- [Go Generic 深度实战：类型参数、约束、类型推断——PHP 开发者视角](/2026/06/01/10_Go/Go-Generic-深度实战-类型参数-约束-类型推断-PHP开发者视角泛型编程与Laravel容器对比/)

## 相关概念

- [goroutine 与并发模型](goroutine与并发模型.md) - Go 的并发编程核心
- [Go 错误处理](Go错误处理.md) - 显式错误哲学
- [Go 泛型](Go泛型.md) - 类型参数与约束
- [Go 部署与工具链](Go部署与工具链.md) - 单二进制部署

## 常见问题

**Q: Go 没有类和继承，怎么做面向对象？**
A: 用 struct 组合（composition）替代继承，用 interface 做多态。Go 的哲学是"偏好组合胜过继承"。

**Q: Go 的 := 和 var 有什么区别？**
A: `:=` 是短声明，只能在函数内使用，自动推导类型。`var` 可以在包级别使用，可以显式指定类型。

**Q: 为什么 Go 没有 while 循环？**
A: Go 只有 `for`，但 `for` 可以替代所有循环：`for {}` = 无限循环，`for condition {}` = while 循环。
