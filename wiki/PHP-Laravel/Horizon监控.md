# Laravel Horizon 队列监控

## 定义

Horizon 是 Laravel 的 Redis 队列监控面板，提供实时指标、多队列优先级配置和自动恢复能力。

## 安装与配置

```bash
composer require laravel/horizon
php artisan horizon:install
php artisan horizon
```

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-1' => [
            'connection' => 'redis',
            'queue' => ['high', 'default', 'low'],
            'balance' => 'auto',         // 自动负载均衡
            'maxProcesses' => 10,
            'maxTime' => 3600,
            'maxJobs' => 1000,
            'memory' => 128,
            'tries' => 3,
            'timeout' => 60,
            'nice' => 0,
        ],
    ],
],
```

## 多队列优先级

```php
'queue' => ['critical', 'high', 'default', 'low']
```

Worker 优先处理 `critical`，只有高优先级队列空了才处理低优先级。

## 自动负载均衡

```php
'balance' => 'auto',
'autoScalingStrategy' => 'time',  // 基于任务耗时自动扩缩容
```

Horizon 根据队列积压自动调整 worker 数量。

## 监控指标

- **任务吞吐量**：每分钟处理的任务数
- **队列等待时间**：任务从入队到开始执行的延迟
- **失败率**：失败任务占比
- **运行时间**：单个任务的执行时间分布

## 踩坑记录

- **Horizon 不是 daemon manager**：生产环境用 Supervisor 管理 Horizon 进程
- **内存泄漏**：长时间运行的 Horizon worker 内存增长 → 设置 `maxJobs` 或 `maxTime`
- **多实例部署**：多个 Horizon 实例会互相竞争 → 用 `horizon:terminate` 优雅重启

## 实战案例

来自博客文章：[Horizon 队列监控](/categories/PHP/laravel-horizon-monitoringguide/) | [Redis Queue 实战](/categories/PHP/laravel-redis-queue-horizon-guide-monitoring/)

## 相关概念

- [队列深度实战](队列深度实战.md) - Job 定义与调度
- [失败任务处理](失败任务处理.md) - 失败策略与死信队列
- [Redis 高可用](../Redis/高可用架构.md) - Horizon 底层依赖 Redis

## 常见问题

**Q: Horizon 和 Supervisor 什么关系？**
A: Horizon 是 Laravel 的队列管理器，Supervisor 是进程管理器。生产环境用 Supervisor 来守护 Horizon 进程。

**Q: 如何实现队列的水平扩展？**
A: 多台机器各跑一个 Horizon 实例，连同一个 Redis，Horizon 自动协调。
