# Go 与 PHP 生态集成

## 定义

Go 与 PHP 生态的集成主要有两种路径：**Go 驱动的 PHP 应用服务器**（FrankenPHP、RoadRunner）和**Go 重写 PHP 热点模块**（微服务迁移）。这两种方案让 PHP 应用在不完全重写的情况下获得 Go 级别的并发能力和部署优势。

## 核心原理

### FrankenPHP — Go 驱动的现代 PHP 应用服务器

FrankenPHP 是用 Go 编写的 PHP 应用服务器，基于 Caddy Web 服务器，内置支持 HTTP/2、HTTP/3、Early Hints、Worker 模式。

**架构**：
```
客户端 → FrankenPHP (Go/Caddy) → PHP Worker（常驻内存）
                                  ├── Laravel 应用
                                  └── 静态资源（Go 直接服务）
```

**核心特性**：
- **Worker 模式**：PHP 进程常驻内存，避免每次请求的启动开销
- **HTTP/3 原生支持**：基于 Caddy 的 QUIC 实现
- **Early Hints (103)**：提前推送 CSS/JS 资源
- **内置 HTTPS**：自动 Let's Encrypt 证书
- **单二进制部署**：Go embed 将 PHP 应用打包为一个可执行文件

```bash
# 启动 FrankenPHP
frankenphp php-server --root ./public

# Worker 模式（推荐生产环境）
frankenphp php-server --root ./public --worker artisan octane:start
```

**Dockerfile 示例**：
```dockerfile
FROM dunglas/frankenphp

COPY . /app
WORKDIR /app

RUN composer install --no-dev --optimize-autoloader
RUN php artisan config:cache
RUN php artisan route:cache

EXPOSE 80 443
```

### RoadRunner — Go 驱动的高性能 PHP 应用服务器

RoadRunner 是用 Go 编写的高性能 PHP 应用服务器，通过 Goridge 协议与 PHP Worker 通信。

**架构**：
```
客户端 → RoadRunner (Go HTTP Server) → PHP Worker Pool
                                        ├── Laravel 应用
                                        └── 通过 Goridge/gRPC 通信
```

**核心特性**：
- **多协议支持**：HTTP、gRPC、TCP、WebSocket、Queue
- **Worker Pool**：Go 管理 PHP Worker 进程池
- **插件系统**：Job Queue、KV Storage、Cache、Centrifugo
- **自动重启**：Worker 崩溃自动恢复

```yaml
# .rr.yaml
http:
  address: 0.0.0.0:8080
  pool:
    num_workers: 10
    max_jobs: 1000
    allocate_timeout: 60s

jobs:
  pool:
    num_workers: 5
  pipelines:
    orders:
      driver: memory
```

### FrankenPHP vs RoadRunner vs Octane/Swoole

| 维度 | FrankenPHP | RoadRunner | Octane/Swoole |
|------|------------|------------|---------------|
| 语言 | Go (Caddy) | Go | PHP (C 扩展) |
| HTTP/3 | 原生支持 | 不支持 | 不支持 |
| Worker 管理 | Go 进程管理 | Go 进程管理 | Swoole 协程 |
| 静态资源 | Go 直接服务 | 需要 Nginx | 需要 Nginx |
| 部署复杂度 | 极低（单二进制） | 低（Go 二进制 + PHP） | 中（需要 Swoole 扩展） |
| Laravel 集成 | Artisan 命令 | Laravel Octane | Laravel Octane |
| 适用场景 | 全栈、边缘计算 | 微服务、队列 | 高并发 API |

### Go 重写 Laravel 热点模块

典型的迁移策略：

```
Laravel 单体应用
  │
  ├── 识别性能热点（Profiler/监控）
  │     └── 订单处理、库存扣减、支付回调
  │
  ├── 用 Go 重写热点模块
  │     └── gRPC 服务
  │
  ├── Laravel 作为 BFF/API Gateway
  │     └── 调用 Go gRPC 服务
  │
  └── 逐步迁移更多模块
```

**Go 微服务示例**：
```go
// 订单服务
type OrderServer struct {
    pb.UnimplementedOrderServiceServer
    repo OrderRepository
}

func (s *OrderServer) CreateOrder(ctx context.Context, req *pb.CreateOrderRequest) (*pb.Order, error) {
    // 业务逻辑
    order, err := s.repo.Create(ctx, fromProto(req))
    if err != nil {
        return nil, status.Errorf(codes.Internal, "create order: %v", err)
    }
    return toProto(order), nil
}
```

**Laravel 调用 Go 服务**：
```php
// Laravel 通过 gRPC 调用 Go 服务
$order = $grpcClient->createOrder([
    'user_id' => $user->id,
    'items' => $items,
]);
```

## 实战案例

来自博客文章：
- [FrankenPHP 实战：Go 驱动的 PHP 应用服务器——替代 PHP-FPM 的现代部署方案与 Laravel 集成](/2026/06/01/06_运维/2026-06-03-FrankenPHP-实战-Go驱动的PHP应用服务器-替代PHP-FPM与Laravel集成/)
- [RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器——对比 Octane/Swoole/FrankenPHP 的进程模型与选型决策](/2026/06/01/05_PHP/Laravel/RoadRunner-实战-Go驱动的PHP高性能应用服务器-对比Octane-Swoole-FrankenPHP进程模型与选型决策/)
- [Go 微服务实战：用 Go 重写 Laravel 高性能热点模块](/2026/06/01/00_架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)

## 相关概念

- [Go 微服务与 gRPC](Go微服务与gRPC.md) - gRPC 通信
- [Go 部署与工具链](Go部署与工具链.md) - 单二进制部署
- [goroutine 与并发模型](goroutine与并发模型.md) - Go 的并发能力

## 常见问题

**Q: FrankenPHP 可以完全替代 Nginx + PHP-FPM 吗？**
A: 可以，尤其适合新项目。FrankenPHP 内置了 HTTPS、HTTP/3、静态资源服务，不需要反向代理。但已有 Nginx 配置的项目迁移成本需要评估。

**Q: RoadRunner 和 Laravel Octane 的关系？**
A: Laravel Octane 支持 Swoole 和 RoadRunner 作为驱动。选择 RoadRunner 驱动时，Go 负责 HTTP 接收和 Worker 管理，PHP Worker 常驻内存处理请求。

**Q: 什么时候应该用 Go 重写 PHP 模块？**
A: 当 Profiler 显示某个模块的 CPU/内存/并发成为瓶颈，且无法通过优化 PHP 代码解决时。典型的场景：高并发订单处理、实时库存扣减、大规模数据处理。

**Q: Go 微服务和 Laravel 之间怎么通信？**
A: 内部服务间用 gRPC（高性能、类型安全）；对外 API 用 REST/GraphQL（浏览器兼容）。Laravel 可以作为 BFF 层聚合多个 Go 微服务。
