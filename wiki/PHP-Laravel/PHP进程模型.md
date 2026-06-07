# PHP 进程模型

> PHP-FPM worker 生命周期、信号处理与 graceful reload 的底层机制，以及 CLI/FPM/Swoole 三种运行模式的对比。

## 定义

PHP 进程模型描述了 PHP 代码在不同 SAPI（Server API）下如何被加载、执行和回收。理解进程模型是进行性能调优、部署策略设计和长驻进程开发的基础。

## 核心原理

### PHP-FPM 生命周期

```
Master Process
  ├── fork → Worker 1: RINIT → Execute → RSHUTDOWN → (循环)
  ├── fork → Worker 2: RINIT → Execute → RSHUTDOWN → (循环)
  └── fork → Worker N: ...
```

每个请求经历五个阶段：

| 阶段 | 说明 | 关键操作 |
|------|------|----------|
| MINIT | 模块初始化（进程启动时一次） | 扩展注册、配置读取 |
| RINIT | 请求初始化（每次请求） | 会话启动、全局变量重置 |
| Execute | 执行用户代码 | Controller → Service → Response |
| RSHUTDOWN | 请求关闭 | 输出缓冲刷新、资源释放 |
| MSHUTDOWN | 模块关闭（进程退出时） | 扩展清理 |

### 信号处理

PHP-FPM Master 进程通过 Unix 信号管理 Worker：

| 信号 | 行为 | 用途 |
|------|------|------|
| SIGUSR1 | 重新打开日志文件 | 日志轮转 |
| SIGUSR2 | 平滑重启（graceful reload） | 代码更新 |
| SIGTERM | 强制终止 | 服务停止 |
| SIGQUIT | 优雅终止（处理完当前请求） | 部署更新 |

### Graceful Reload

```bash
# 平滑重启：Worker 处理完当前请求后退出，Master fork 新 Worker
kill -USR2 $(cat /run/php-fpm.pid)
```

**关键细节**：
- 现有 Worker 完成当前请求后退出
- 新请求由新 Worker 处理（加载新代码）
- 零停机时间，但有短暂的容量下降

### 三种运行模式对比

| 特性 | CLI | PHP-FPM | Swoole/Octane |
|------|-----|---------|---------------|
| 生命周期 | 单次执行 | 请求级 | 进程级（长驻） |
| OPcache | 命中率低 | 命中率高 | 常驻内存 |
| 全局状态 | 每次重建 | 每次重建 | 跨请求共享 |
| 协程支持 | 无 | 无 | 原生支持 |
| 内存回收 | 自动 | 自动 | 需手动管理 |

## 实战案例

### PHP-FPM Worker 调优

来自博客：[PHP 进程模型深度剖析：PHP-FPM worker 生命周期、信号处理与 graceful reload 的底层机制](/2026/06/01/php-fpm-worker-lifecycle/)

```ini
; /etc/php/8.x/fpm/pool.d/www.conf
pm = dynamic
pm.max_children = 50          # 最大 Worker 数
pm.start_servers = 10         # 启动时 Worker 数
pm.min_spare_servers = 5      # 最小空闲 Worker
pm.max_spare_servers = 20     # 最大空闲 Worker
pm.max_requests = 1000        # 单 Worker 最大请求数（防内存泄漏）
```

### 部署时 Graceful Reload

```bash
#!/bin/bash
# 部署脚本：代码更新后平滑重启
cp -r /deploy/new-code /app/
kill -USR2 $(cat /run/php-fpm.pid)
sleep 5  # 等待旧 Worker 完成请求
echo "Deploy complete"
```

## 相关概念

- [PHP 生命周期与 SAPI](生命周期与SAPI.md) - MINIT/RINIT/Execute/RSHUTDOWN/MSHUTDOWN
- [OPcache 调优](OPcache调优.md) - 缓存预热与冷启动治理
- [PHP 高性能运行时](PHP高性能运行时.md) - FrankenPHP/RoadRunner/Swoole
- [进程、线程与协程](进程线程协程.md) - 并发模型对比

## 常见问题

**Q: 为什么要设置 pm.max_requests？**
A: 防止长期运行的 Worker 因内存泄漏导致进程膨胀。达到请求数后 Worker 自动退出，Master fork 新 Worker。

**Q: SIGUSR2 和 SIGQUIT 的区别？**
A: SIGUSR2 触发 graceful reload（重新加载代码），SIGQUIT 触发优雅停止（处理完当前请求后退出，不 fork 新 Worker）。

**Q: Swoole/Octane 下需要担心内存泄漏吗？**
A: 需要更加注意。长驻进程中对象不会随请求结束释放，需特别关注全局变量、静态属性、闭包引用的清理。
