# Laravel Octane 与 Swoole

## 定义

- **Octane**：Laravel 的高性能扩展，利用 Swoole/RoadRunner 常驻进程消除请求级开销
- **Swoole**：PHP 的协程网络框架，提供高性能异步 IO

## 核心优势

```
传统 FPM：
Request → MINIT → RINIT → Execute → RSHUTDOWN → 退出
（每次请求都重复初始化）

Octane/Swoole：
启动 → MINIT → RINIT → 初始化框架
Request1 → handle
Request2 → handle
（初始化只做一次）
```

## 安装配置

```bash
composer require laravel/octane
php artisan octane:install --server=swoole
php artisan octane:start --host=0.0.0.0 --port=8000 --workers=4
```

## 协程并发

```php
use Laravel\Octane\Facades\Octane;

// 并发请求多个外部服务
[$users, $orders, $products] = Octane::concurrently([
    fn () => Http::get('https://api.example.com/users'),
    fn () => Http::get('https://api.example.com/orders'),
    fn () => Http::get('https://api.example.com/products'),
]);
```

## 状态管理

### 常驻进程的陷阱

```php
// ❌ 全局变量在请求间共享
$counter = 0;  // 不安全！

// ✅ 每次请求重置
class Counter {
    private int $count = 0;  // 请求级实例安全
}
```

### 请求级清理

```php
// AppServiceProvider
public function register(): void {
    $this->app->singleton(Counter::class);  // ⚠️ singleton 跨请求共享
}
```

## 性能对比

| 指标 | FPM | Octane/Swoole |
|------|-----|---------------|
| 启动开销 | 每次 50-200ms | 0ms |
| 内存占用 | 每请求 10-50MB | 共享 200-500MB |
| QPS | 500-2000 | 3000-10000 |
| 并发能力 | 有限（进程数） | 高（协程数） |

## 踩坑记录

- **内存泄漏**：singleton 对象持续增长 → 定期 `Octane::terminate()`
- **状态污染**：上一个请求的全局变量影响下一个 → 严格使用请求级实例
- **数据库连接池**：Swoole 协程不能直接用 PDO → 用连接池组件
- **第三方包兼容**：部分包假设每次请求都是新进程 → 测试后上线

## 实战案例

来自博客文章：[Laravel Octane + Swoole 高性能架构](/categories/PHP/laravel-octane-swoole-high-performancephparchitecture/) | [Octane 性能优化](/categories/PHP/laravel-octane-swoole-roadrunner-performanceguide-high-concurrency/) | [PHP-FPM 与 Swoole](/categories/PHP/swoole/)

## 相关概念

- [生命周期与 SAPI](生命周期与SAPI.md) - FPM vs Swoole 的生命周期差异
- [OPcache 调优](OPcache调优.md) - 常驻进程的缓存策略
- [进程线程协程](进程线程协程.md) - Swoole 协程原理

## 常见问题

**Q: Octane 适合所有 Laravel 项目吗？**
A: 不适合。简单项目 FPM 足够。Octane 适合高并发、低延迟的 API 服务。

**Q: Swoole 和 RoadRunner 选哪个？**
A: Swoole 性能更高但需要 PHP 扩展；RoadRunner 用 Go 实现，无需 PHP 扩展。
