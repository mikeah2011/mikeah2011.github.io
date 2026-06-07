# Go 语言知识图谱

> 面向 PHP/Laravel 开发者的 Go 语言 Wiki。覆盖语言基础、并发模型、错误处理、泛型、测试、数据库操作、微服务通信、部署工具链，以及 Go 与 PHP 生态的集成方案。

## 核心概念

### 📘 语言基础
- [Go 语言基础](Go语言基础.md) - 变量、类型、函数、struct、interface、包管理
- [Go 泛型](Go泛型.md) - 类型参数、约束、类型推断（Go 1.18+）

### 🔀 并发编程
- [goroutine 与并发模型](goroutine与并发模型.md) - goroutine、channel、select、sync 原语
- [Go Context 机制](Go-Context机制.md) - 超时控制、取消传播、请求作用域

### ⚠️ 错误处理
- [Go 错误处理](Go错误处理.md) - errors.Join/Wrap/Is/As、自定义错误类型、哲学对比

### 🧪 测试
- [Go 测试体系](Go测试体系.md) - 表驱动测试、Testify 断言、httptest Mock

### 🗄️ 数据层
- [Go 数据库操作](Go数据库操作.md) - database/sql、sqlx、sqlc、连接池、事务控制

### 🌐 微服务与通信
- [Go 微服务与 gRPC](Go微服务与gRPC.md) - Protobuf、gRPC 流式调用、从 Laravel 迁移

### 📦 部署与工具链
- [Go 部署与工具链](Go部署与工具链.md) - embed、单二进制、交叉编译、依赖管理

### 🔗 Go 与 PHP 生态集成
- [Go 与 PHP 生态集成](Go与PHP生态集成.md) - FrankenPHP、RoadRunner、Go 驱动的 PHP 高性能方案

## 实战文章

### Go 语言核心
- [Go for PHP Developers 实战：goroutine/channel 并发模型与 Laravel 队列的思维对比](/2026/06/01/00_架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)
- [Go Context 深度实战：超时控制、取消传播与请求作用域——PHP 开发者的并发思维重塑](/2026/06/01/06_运维/Go-Context-深度实战-超时控制取消传播与请求作用域-PHP开发者的并发思维重塑/)
- [Go error handling 深度实战：errors.Join/Wrap/Is/As 与自定义错误类型](/2026/06/01/10_Go/Go-error-handling-深度实战-errors-Join-Wrap-Is-As-自定义错误类型-对比PHP-Exception设计哲学/)
- [Go Generic 深度实战：类型参数、约束、类型推断——PHP 开发者视角的泛型编程](/2026/06/01/10_Go/Go-Generic-深度实战-类型参数-约束-类型推断-PHP开发者视角泛型编程与Laravel容器对比/)
- [Go 测试实战：表驱动测试、Testify 断言、httptest Mock](/2026/06/01/00_架构/Go-测试实战-表驱动测试-Testify断言-httptest-Mock/)

### Go 工程实践
- [Go 数据库/sql 实战：连接池管理、事务控制与 sqlx/sqlc 代码生成](/2026/06/01/00_架构/Go-数据库-sql-实战-连接池管理-事务控制与-sqlx-sqlc-代码生成/)
- [Go + gRPC 实战：高性能微服务间通信——Proto 定义、流式调用与 Laravel 集成](/2026/06/01/00_架构/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块](/2026/06/01/00_架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
- [Go embed + 单二进制部署实战：静态资源内嵌与零依赖发布](/2026/06/01/10_Go/go-embed-single-binary-deployment-zero-dependency/)

### Go 与 PHP 生态
- [FrankenPHP 实战：Go 驱动的 PHP 应用服务器——替代 PHP-FPM 的现代部署方案](/2026/06/01/06_运维/2026-06-03-FrankenPHP-实战-Go驱动的PHP应用服务器-替代PHP-FPM与Laravel集成/)
- [RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器](/2026/06/01/05_PHP/Laravel/RoadRunner-实战-Go驱动的PHP高性能应用服务器-对比Octane-Swoole-FrankenPHP进程模型与选型决策/)

### 并发模型对比
- [PHP 8.5 Fiber Pool 实战：协程池并发批量请求——对比 Go goroutine pool](/2026/06/01/05_PHP/PHP-8.5-Fiber-Pool-实战-协程池并发批量请求-对比Go-goroutine-pool的异步编程进阶/)
- [Rust + Tokio 异步运行时深度实战——对比 PHP Fibers 与 Go goroutine](/2026/06/01/00_架构/Rust-Tokio-异步运行时深度实战-事件循环-任务调度-背压控制-对比PHP-Fibers与Go-goroutine/)
- [Kotlin Coroutines 深度实战——与 PHP Fibers/Go goroutine 的并发模型对比](/2026/06/01/00_架构/Kotlin-Coroutines-深度实战-挂起函数结构化并发Flow与PHP-Fibers-Go-goroutine并发模型对比/)

## 主题关系图

### 1. Go 的核心优势：简洁 + 并发 + 单二进制
Go 的设计哲学是"少即是多"——25 个关键字、原生并发、静态编译单文件部署。

- 相关页：[Go 语言基础](Go语言基础.md)、[Go 部署与工具链](Go部署与工具链.md)

### 2. goroutine/channel 是 Go 的灵魂
`go func()` 一行起协程，channel 做通信，select 做多路复用。对比 PHP 的 Fibers 和 Node.js 的事件循环。

- 相关页：[goroutine 与并发模型](goroutine与并发模型.md)、[Go Context 机制](Go-Context机制.md)
- 相关文章：[Go for PHP Developers 实战](/2026/06/01/00_架构/Go-for-PHP-Developers-goroutine-channel-Laravel-队列对比/)

### 3. 错误处理是 Go 的争议点
`if err != nil` 满屏是 Go 最被吐槽的地方，但 Go 1.13+ 的 errors.Wrap/Is/As 让错误链更优雅。

- 相关页：[Go 错误处理](Go错误处理.md)
- 相关文章：[Go error handling 深度实战](/2026/06/01/10_Go/Go-error-handling-深度实战-errors-Join-Wrap-Is-As-自定义错误类型-对比PHP-Exception设计哲学/)

### 4. 泛型让 Go 更适合通用编程
Go 1.18 引入泛型，让数据结构和算法不再需要 interface{} 黑魔法。

- 相关页：[Go 泛型](Go泛型.md)
- 相关文章：[Go Generic 深度实战](/2026/06/01/10_Go/Go-Generic-深度实战-类型参数-约束-类型推断-PHP开发者视角泛型编程与Laravel容器对比/)

### 5. Go 是微服务和云原生的首选
Docker、Kubernetes、etcd、Prometheus 全用 Go 写。gRPC + Protobuf 是 Go 微服务的标配通信方式。

- 相关页：[Go 微服务与 gRPC](Go微服务与gRPC.md)、[Go 数据库操作](Go数据库操作.md)
- 相关文章：[Go + gRPC 实战](/2026/06/01/00_架构/Go-gRPC-实战-高性能微服务通信-Proto定义流式调用Laravel集成/)

### 6. Go 可以驱动 PHP 的高性能层
FrankenPHP 和 RoadRunner 用 Go 替代 PHP-FPM，让 PHP 应用获得 Go 级别的并发能力。

- 相关页：[Go 与 PHP 生态集成](Go与PHP生态集成.md)
- 相关文章：[FrankenPHP 实战](/2026/06/01/06_运维/2026-06-03-FrankenPHP-实战-Go驱动的PHP应用服务器-替代PHP-FPM与Laravel集成/)

## 关键概念导航

| 概念 | 说明 | 关联页面 |
|------|------|----------|
| goroutine | 轻量级协程，~2KB 栈 | [goroutine 与并发模型](goroutine与并发模型.md) |
| channel | 类型安全的通信管道 | [goroutine 与并发模型](goroutine与并发模型.md) |
| select | 多路复用 channel 操作 | [goroutine 与并发模型](goroutine与并发模型.md) |
| Context | 请求作用域、超时、取消传播 | [Go Context 机制](Go-Context机制.md) |
| error interface | 显式错误返回，无异常机制 | [Go 错误处理](Go错误处理.md) |
| errors.Wrap/Is/As | Go 1.13+ 错误链 | [Go 错误处理](Go错误处理.md) |
| 泛型 | 类型参数 + 约束（Go 1.18+） | [Go 泛型](Go泛型.md) |
| 表驱动测试 | 用切片组织测试用例 | [Go 测试体系](Go测试体系.md) |
| database/sql | 标准库数据库接口 | [Go 数据库操作](Go数据库操作.md) |
| sqlx/sqlc | 增强型数据库库 | [Go 数据库操作](Go数据库操作.md) |
| gRPC | 高性能 RPC 框架 | [Go 微服务与 gRPC](Go微服务与gRPC.md) |
| embed | 编译时嵌入静态资源 | [Go 部署与工具链](Go部署与工具链.md) |
| FrankenPHP | Go 驱动的 PHP 应用服务器 | [Go 与 PHP 生态集成](Go与PHP生态集成.md) |
| RoadRunner | Go 驱动的 PHP 高性能服务器 | [Go 与 PHP 生态集成](Go与PHP生态集成.md) |

## 学习路径

```
入门 ─────────────────────────────────────────────────────────────── 进阶

1. Go 语言基础（变量、类型、函数、struct、interface）
   │
   ├─→ 2a. goroutine 与并发模型（并发编程核心）
   ├─→ 2b. Go 错误处理（显式错误哲学）
   └─→ 2c. Go 泛型（通用编程）
   │
   ▼
3. Go 测试体系（表驱动、Mock、集成测试）
   │
   ▼
4. Go 数据库操作（database/sql → sqlx → sqlc）
   │
   ▼
5. Go 微服务与 gRPC（Protobuf、流式调用）
   │
   ▼
6. Go 部署与工具链（单二进制、embed、交叉编译）
   │
   ▼
7. Go 与 PHP 生态集成（FrankenPHP、RoadRunner）
```

## 跨领域关联
- → [PHP-Laravel 知识图谱](../PHP-Laravel/index.md)：PHP Fibers 对比 goroutine、Laravel Octane/Swoole 对比 Go 运行时
- → [架构设计知识图谱](../架构设计/index.md)：微服务架构、gRPC 通信、事件驱动
- → [DevOps 知识图谱](../DevOps/index.md)：Docker/K8s/etcd 全是 Go 写的
- → [Redis 知识图谱](../Redis/index.md)：Go Redis 客户端、分布式锁
- → [MySQL 知识图谱](../MySQL/index.md)：Go database/sql 连接池管理
