# PHP 高性能运行时

> FrankenPHP、RoadRunner、Swoole/Octane——替代 PHP-FPM 的现代 PHP 运行时选型与性能对比。

## 定义

PHP 传统运行时 PHP-FPM 采用「一请求一进程」模型，每个请求都要经历 MINIT → RINIT → Execute → RSHUTDOWN 的完整生命周期。现代高性能运行时通过**长驻进程**、**协程并发**、**Go 驱动**等方式突破这一限制。

## 核心原理

### 运行时对比

| 特性 | PHP-FPM | Swoole/Octane | FrankenPHP | RoadRunner |
|------|---------|---------------|------------|------------|
| 语言 | C | C（PHP 扩展） | Go + C | Go |
| 进程模型 | 一请求一进程 | 长驻进程 | 长驻进程 | Worker 池 |
| 协程 | 无 | 原生协程 | goroutine | goroutine |
| HTTP/2 | 需 Nginx | 原生支持 | 原生支持 | 原生支持 |
| WebSocket | 不支持 | 原生支持 | 原生支持 | 原生支持 |
| 启动速度 | 快 | 中 | 快 | 中 |
| 内存占用 | 高（多进程） | 中 | 低 | 中 |
| Laravel 集成 | 默认 | Octane | 内置支持 | 内置支持 |

### FrankenPHP

Go 驱动的现代 PHP 应用服务器，由 Symfony/Dunglas 团队开发：

- **Go + C 嵌入**：PHP 解释器嵌入 Go 进程
- **Worker 模式**：PHP 代码常驻内存，避免每次请求重新加载
- **自动 HTTPS**：内置 Let's Encrypt
- **HTTP/2 & HTTP/3**：原生支持
- **Early Hints (103)**：预加载资源

### RoadRunner

Go 编写的高性能应用服务器：

- **Worker 池**：管理多个 PHP Worker 进程
- **gRPC 通信**：Go ↔ PHP 通过 gRPC 通信
- **插件丰富**：HTTP、gRPC、Queue、Cache、KV 等
- **热重载**：代码更新无需重启 Worker

### Swoole / Laravel Octane

PHP C 扩展实现的协程运行时：

- **原生协程**：PHP 层面的协程支持
- **连接池**：MySQL/Redis 连接复用
- **定时器**：毫秒级定时任务
- **Table**：进程间共享内存

## 实战案例

### FrankenPHP + Laravel

来自博客：[FrankenPHP 实战：Go 驱动的 PHP 应用服务器——替代 PHP-FPM 的现代部署方案与 Laravel 集成](/2026/06/03/FrankenPHP-实战-Go驱动的PHP应用服务器-替代PHP-FPM与Laravel集成/)

```dockerfile
# Dockerfile
FROM dunglas/frankenphp:latest

COPY . /app
WORKDIR /app

# Worker 模式：PHP 代码常驻内存
CMD ["php", "artisan", "octane:frankenphp"]
```

### RoadRunner + Laravel

来自博客：[RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器](/2026/06/01/RoadRunner-实战-Go驱动的PHP高性能应用服务器-对比Octane-Swoole-FrankenPHP进程模型与选型决策/)

```yaml
# .rr.yaml
http:
  address: 0.0.0.0:8080
  pool:
    num_workers: 10
    max_jobs: 1000
    allocate_timeout: 60s
    destroy_timeout: 60s
```

### Octane + Swoole 并发 API 调用

```php
use Laravel\Octane\Facades\Octane;

// 并发调用 3 个 API（协程）
[$product, $inventory, $recommend] = Octane::concurrently([
    fn () => Http::get('https://api.products.com/123'),
    fn () => Http::get('https://api.inventory.com/123'),
    fn () => Http::get('https://api.recommend.com/123'),
]);
// 总耗时 = max(200, 300, 150) = 300ms
// 串行需要 650ms
```

### 选型决策

```
需要 WebSocket/长连接？
  ├── 是 → Swoole/Octane 或 FrankenPHP
  └── 否 → 继续判断

需要最大化单机吞吐？
  ├── 是 → FrankenPHP（Go 驱动，最低开销）
  └── 否 → 继续判断

已有 PHP-FPM + Nginx？
  ├── 是 → RoadRunner（迁移成本最低）
  └── 否 → FrankenPHP（最现代）

需要协程并发？
  ├── 是 → Swoole/Octane（原生协程）
  └── 否 → FrankenPHP 或 RoadRunner
```

## 相关概念

- [Octane 与 Swoole](Octane与Swoole.md) - Octane 详细配置
- [OPcache 调优](OPcache调优.md) - 缓存预热
- [进程、线程与协程](进程线程协程.md) - 并发模型
- [PHP8新特性](PHP8新特性.md) - JIT 编译改进
- [并发模型对比](../架构设计/并发模型对比.md) - 跨语言并发模型

## 常见问题

**Q: FrankenPHP 和 RoadRunner 哪个更好？**
A: FrankenPHP 更现代（HTTP/3、Early Hints），RoadRunner 更成熟（插件生态、生产验证）。新项目推荐 FrankenPHP，已有 RoadRunner 的项目无需迁移。

**Q: 长驻进程会导致内存泄漏吗？**
A: 会。需特别注意：静态属性累积、全局数组增长、闭包捕获、事件监听器未注销。Octane 提供 `--max-requests` 参数定期重启 Worker。

**Q: 迁移到 Octane 需要改代码吗？**
A: 大部分代码无需修改。但需注意：全局/静态变量跨请求共享、单例状态残留、数据库连接生命周期。建议先在测试环境验证。
