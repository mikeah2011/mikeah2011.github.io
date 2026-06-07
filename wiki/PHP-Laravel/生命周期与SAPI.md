# PHP 生命周期与 SAPI

## 定义

PHP 生命周期 = MINIT → RINIT → Execute → RSHUTDOWN → MSHUTDOWN。不同运行模式（CLI/FPM/Swoole）在各阶段的执行频率不同。

## 五大阶段

| 阶段 | 触发时机 | 典型工作 |
|------|----------|----------|
| **MINIT** (Module Init) | 进程启动 | 加载扩展、注册类/函数/常量 |
| **RINIT** (Request Init) | 每个请求开始 | 初始化 `$_GET/$_POST/$_SESSION`、扩展请求级状态 |
| **Execute** | RINIT 之后 | 把 PHP 源码编译成 opcode 并执行 |
| **RSHUTDOWN** | 请求结束 | 调注册的 shutdown 函数、清理临时变量 |
| **MSHUTDOWN** | 进程退出 | 卸载扩展、释放永久内存 |

## 运行模式对比

### CLI（每次都完整 5 步）
- 启动：MINIT → RINIT → Execute → RSHUTDOWN → MSHUTDOWN → 退出
- **慢**——每次都要重新加载扩展、解析 INI、编译 opcode

### FPM（M 步只跑一次）
```
[启动]   MINIT
[请求1]  RINIT → Execute → RSHUTDOWN
[请求2]  RINIT → Execute → RSHUTDOWN
[退出]   MSHUTDOWN
```
- worker 进程常驻，配合 OPcache，编译只发生一次

### Swoole / Workerman（M+R 都只跑一次）
```
[启动]   MINIT → RINIT → 业务初始化
[请求1]  -> handle($req)
[请求2]  -> handle($req)
```
- 全程在内存里，没有 RINIT/RSHUTDOWN 开销
- **代价**：得自己处理状态污染、内存泄漏、协程上下文

## FPM 请求处理流程

1. Nginx 接到请求，通过 fastcgi 协议转给 FPM master
2. FPM master 派给空闲 worker
3. worker 跑 RINIT：填 `$_SERVER` `$_GET` `$_POST`
4. 编译 PHP 文件 → opcode（OPcache 命中则跳过）
5. 执行 opcode，业务代码跑起来
6. 输出 buffer → fastcgi 回 Nginx
7. RSHUTDOWN：执行 `register_shutdown_function`、释放变量
8. worker 回到空闲，等下一个请求

## 性能优化要点

| 优化点 | 提升倍数 | 说明 |
|--------|----------|------|
| 开 OPcache | 2-5x | 没有它每个请求都重新编译 |
| `opcache.validate_timestamps=0` | +10-20% | 生产环境不再 stat 文件检查改动 |
| 升级 PHP 8.x | +10-30% | JIT 编译、引擎优化 |

## 实战案例

来自博客文章：[PHP 生命周期与 SAPI](/categories/PHP/lifecycle/) | [PHP 工作原理](/categories/PHP/how-it-works/) | [OPcache 配置实战](/categories/PHP/opcache-guide-php-common/)

## 相关概念

- [OPcache 调优](OPcache调优.md) - opcode 缓存与预热
- [Octane 与 Swoole](Octane与Swoole.md) - 常驻进程高性能方案
- [垃圾回收](垃圾回收.md) - Swoole 常驻进程必须关注 GC

## 常见问题

**Q: 为什么 Swoole 比 FPM 快 10 倍？**
A: 省去了每次请求的 RINIT/RSHUTDOWN 开销，容器/路由/ORM 只初始化一次，且支持协程并发。

**Q: FPM worker 数量怎么设？**
A: `pm.max_children` = 可用内存 / 单个请求峰值内存。CPU 密集型可设 CPU 核心数的 1-2 倍。
