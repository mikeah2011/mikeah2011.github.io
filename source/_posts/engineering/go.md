---
title: Go
tags: []
categories:
  - Engineering
  - GoLang
date: 2020-03-20 15:05:07
description: 'Go（Golang）是 Google 2009 年开源的静态编译型语言，主打简洁语法 + 原生并发（goroutine） + 编译速度快，是云原生时代的事实标准（Docker / K8s / etcd 全是 Go 写的）。'



---
## 一、为什么是 Go

Go 由 Rob Pike、Ken Thompson 等人在 Google 设计，2009 年开源。诞生背景：**C++ 编译慢、Java 启动慢、Python 性能差**，Google 内部需要一门"既能写系统又能写服务"的语言。

它做对了几件事：

- **极简语法**：关键字只有 25 个，几小时上手
- **原生并发**：`go func()` 一行起协程，channel 解决通信
- **静态编译 + 单二进制**：部署只丢一个文件，不带运行时依赖
- **GC 但够快**：低延迟 GC（< 1ms STW）
- **强大的标准库**：HTTP / JSON / 加密 / 模板全自带

代价：泛型直到 1.18 才有，错误处理啰嗦（`if err != nil` 满屏），没有继承。

> 适合：网络服务、CLI 工具、云基础设施、并发处理。
> 不适合：CPU 密集科学计算（不如 C++/Rust）、桌面 GUI（生态弱）。

---

## 二、Hello World

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello, Go")
}
```

```bash
go run main.go        # 直接跑
go build              # 编译成二进制
./main
```

---

## 三、核心语法速览

```go
// 变量
var x int = 10
y := 20              // 短声明，自动推导类型

// 常量
const Pi = 3.14

// 函数：多返回值（Go 的灵魂）
func divide(a, b int) (int, error) {
    if b == 0 {
        return 0, fmt.Errorf("division by zero")
    }
    return a / b, nil
}

// 错误处理：显式
result, err := divide(10, 0)
if err != nil {
    log.Fatal(err)
}

// struct + 方法
type User struct {
    ID   int
    Name string
}
func (u *User) Greet() string {
    return "Hi, " + u.Name
}

// 接口（鸭子类型，无需 implements 关键字）
type Greeter interface {
    Greet() string
}
```

---

## 四、Goroutine + Channel

```go
package main

import (
    "fmt"
    "time"
)

func worker(id int, jobs <-chan int, results chan<- int) {
    for j := range jobs {
        time.Sleep(time.Second)
        results <- j * 2
    }
}

func main() {
    jobs := make(chan int, 100)
    results := make(chan int, 100)

    // 起 3 个 worker
    for w := 1; w <= 3; w++ {
        go worker(w, jobs, results)
    }

    // 派发 5 个任务
    for j := 1; j <= 5; j++ {
        jobs <- j
    }
    close(jobs)

    // 收结果
    for i := 0; i < 5; i++ {
        fmt.Println(<-results)
    }
}
```

`go` 关键字 + channel 让"生产者-消费者"模型变成几行代码。**Don't communicate by sharing memory; share memory by communicating.**

---

## 五、模块（Go Modules）

```bash
go mod init github.com/me/myapp     # 初始化
go get github.com/gin-gonic/gin     # 加依赖
go mod tidy                         # 清理未使用依赖
go mod vendor                       # 把依赖拷到 vendor/（可选）
```

`go.mod` 声明依赖版本，`go.sum` 锁哈希。

---

## 六、标准库 HTTP 服务

```go
package main

import (
    "encoding/json"
    "net/http"
)

func main() {
    http.HandleFunc("/api/user", func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(map[string]any{
            "id": 1, "name": "Mike",
        })
    })
    http.ListenAndServe(":8080", nil)
}
```

不依赖任何框架，标准库就能写生产级 HTTP 服务。

---

## 七、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **goroutine 泄露** | 起了不会退出 | channel 关闭时 worker 要 `return`；用 `context.Context` 控生命周期 |
| **for-range 闭包变量** | goroutine 拿到的都是最后一个 | Go 1.22 已修；老版本要 `i := i` 拷贝 |
| **map 并发读写 panic** | "concurrent map writes" | 用 `sync.Map` 或加 `sync.Mutex` |
| **interface 判 nil** | 明明赋了 nil 还不等于 nil | interface 内部是 (type, value)，type 不为空就不等于 nil |
| **defer 在循环里** | 文件句柄不释放 | 把循环体抽成函数；或用 `defer file.Close()` 后立即处理 |
| **GOPATH vs Module** | 老代码混乱 | 一律用 Go Modules（1.16+ 默认），告别 GOPATH |

---

## 八、生态推荐

| 类型 | 推荐 |
|------|------|
| Web 框架 | [Gin](https://gin-gonic.com)、[Echo](https://echo.labstack.com)、[Fiber](https://gofiber.io) |
| ORM | [GORM](https://gorm.io)、[ent](https://entgo.io)、[sqlx](https://github.com/jmoiron/sqlx) |
| 微服务 | [go-zero](https://go-zero.dev)、[Kratos](https://go-kratos.dev)、[go-kit](https://gokit.io) |
| CLI | [cobra](https://github.com/spf13/cobra)、[urfave/cli](https://cli.urfave.org) |
| 配置 | [viper](https://github.com/spf13/viper) |

---

## 参考

- 官网：<https://go.dev>
- Go by Example：<https://gobyexample.com>
- Go 圣经（中文）：<https://gopl-zh.github.io>
- Effective Go：<https://go.dev/doc/effective_go>
