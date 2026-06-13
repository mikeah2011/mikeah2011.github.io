---

title: PHP 工作原理：SAPI、FPM、OPcache 与请求生命周期
keywords: [PHP, SAPI, FPM, OPcache, 工作原理, 与请求生命周期]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- FastCGI
- Nginx
- Web服务器
- 性能优化
categories:
- php
date: 2019-03-20 15:05:07
description: 深入解析PHP工作原理，涵盖CGI、FastCGI协议与PHP-FPM进程管理机制。详解Nginx与PHP-FPM的请求处理流程，包括PHP 7/8 JIT编译器、Zend Engine性能改进、OPcache缓存原理与配置优化。对比CLI模式与FPM模式的区别，提供PHP-FPM调优实战参数配置与502 Bad Gateway等常见问题排查方案。
---



## 概述

CGI（通用网关接口）用于 WEB 服务器和应用程序间的交互，定义输入输出规范。用户的请求通过 WEB 服务器转发给 FastCGI 进程，FastCGI 进程再调用应用程序进行处理（如 PHP 解析器），应用程序的处理结果（如 HTML）返回给 FastCGI，FastCGI 返回给 Nginx 进行输出。

假设这里 WEB 服务器是 Nginx，应用程序是 PHP，而 php-fpm 是管理 FastCGI 的，这也就是 php-fpm、FastCGI 和 Nginx 之间的关系。

FastCGI 用来提高 CGI 程序性能，启动一个 master，再启动多个 worker，不需要每次解析 php.ini。而 php-fpm 实现了 FastCGI 协议，是 FastCGI 的进程管理器，支持平滑重启，可以启动的时候预先生成多个进程。

<!-- more -->

## 协议模式

| 协议模式 |                  定义                  |                       用途                        |                             备注                             |
| :------: | :------------------------------------: | :-----------------------------------------------: | :----------------------------------------------------------: |
|   CGI    | 通用网关接口(Common Gateway Interface) | 用于WEB服务器和应用程序间的交互，定义输入输出规范 |          用户的请求通过WEB服务器转发给Fast-CGI进程           |
| Fast-CGI |            CGI模式的升级版             |               用来提高 CGI 程序性能               | 启动一个`master`，再启动多个 `worker`，不需要每次解析 `php.ini` |
| PHP-Cli  |               命令行模式               |                         -                         |            在控制台输入php xx.php 就能执行php代码            |
| PHP-FPM  |                   -                    |               Fast-CGI 的进程管理器               | 实现了 Fast-CGI 协议，支持平滑重启，可以启动的时候预先生成多个进程 |
|   PHP    |                   -                    |                     应用程序                      |                              -                               |
|  NGINX   |                   -                    |                     WEB服务器                     |                              -                               |



## Fast-CGI 的工作原理

1. WEB 服务器启动 Fast-CGI 进程管理器，预先 fork N 个进程
2. 用户请求到达 → WEB 服务器接收请求 → 交给 Fast-CGI 进程管理器
3. 进程管理器将请求分配给一个空闲的 Fast-CGI 进程处理
4. 处理完成，Fast-CGI 进程变为空闲状态，等待下次请求
5. WEB 服务器接收处理结果 → 返回给用户



## PHP-FPM 的工作原理

1. PHP-FPM 启动 → 生成 N 个 Fast-CGI 协议处理进程 → 监听端口等待任务
2. 用户请求 → WEB 服务器接收请求 → 请求转发给 PHP-FPM
3. PHP-FPM 交给一个空闲进程处理 → 进程处理完成
4. PHP-FPM 返回给 WEB 服务器 → WEB 服务器接收数据 → 返回给用户

## Nginx + PHP-FPM 请求处理完整流程

```
用户浏览器
    |
    | HTTP请求 (GET/POST /index.php)
    v
+-----------+
|  Nginx    |  1. 接收TCP连接，解析HTTP请求
| (WEB服务器)|  2. 匹配location规则
+-----------+  3. 判断是否为PHP请求
    |
    | FastCGI协议 (通过Unix Socket或TCP 127.0.0.1:9000)
    v
+-----------+
| PHP-FPM   |  4. Master进程接收请求
| Master    |  5. 分配给空闲的Worker进程
+-----------+
    |
    v
+-----------+
| PHP-FPM   |  6. Worker进程加载php.ini
| Worker    |  7. 词法分析 → 语法分析 → AST
|           |  8. AST编译为opcode (字节码)
|           |  9. 执行opcode (或JIT编译后执行机器码)
|           | 10. 执行业务逻辑 (数据库查询、文件读写等)
|           | 11. 生成HTML响应
+-----------+
    |
    | FastCGI协议 (返回响应)
    v
+-----------+
|  Nginx    | 12. 接收响应，添加HTTP头
|           | 13. 返回给客户端
+-----------+
    |
    v
用户浏览器 (渲染HTML页面)
```

## PHP 7/8 的性能改进

### Zend Engine 的演进

PHP 5.x 使用 Zend Engine II，PHP 7.0 引入了 **Zend Engine 3**（也称 PHPNG - PHP Next Generation），对内部数据结构进行了全面重写，核心改进包括：

- **zval 结构优化**：PHP 5 中每个 zval 需要单独堆分配，PHP 7 中 zval 采用值语义，直接嵌入 HashTable 桶中，减少内存分配次数
- **HashTable 重设计**：bucket 数组紧凑排列，消除指针追踪，缓存命中率大幅提升
- **字符串存储优化**：引入 `zend_string` 引用计数结构，相同字符串可共享存储

性能提升幅度：**PHP 7.0 相比 PHP 5.6 性能提升约 2 倍**，内存消耗降低约 50%。

**PHP 8.x 的 JIT 编译器：**

PHP 8.0 引入了 **JIT（Just-In-Time）编译器**，基于 DynASM 实现：

- JIT 将热点 opcode 直接编译为本地机器码，跳过虚拟机解释执行
- 使用 **函数级 + trace-based** 混合编译策略
- 对 CPU 密集型任务（如数学运算、图像处理）性能提升显著（可达 5-10 倍）
- 对 I/O 密集型 Web 请求提升有限（约 3-5%），因为瓶颈在数据库和网络

```ini
; php.ini 中启用 JIT
[opcache]
opcache.enable=1
opcache.jit_buffer_size=256M
opcache.jit=1255
; 1255 含义：1=启用 2=在JIT编译器触发时 5=使用寄存器分配 5=使用AVX2指令集
```

## OPcache 的工作原理与配置

### OPcache 原理

PHP 是解释型语言，每次请求都要经历 **词法分析 → 语法分析 → AST → opcode** 的编译过程。OPcache 将编译后的 opcode 缓存在共享内存中，后续请求直接执行缓存的 opcode，省去重复编译开销。

```
无 OPcache：  源码 → [词法分析] → [语法分析] → [AST] → [编译] → opcode → 执行
有 OPcache：  源码 → 检查缓存 → [命中] 直接执行 opcode
                           → [未命中] 编译 → 存入缓存 → 执行 opcode
```

**推荐配置（生产环境）：**

```ini
[opcache]
opcache.enable=1
opcache.enable_cli=0                ; CLI模式下通常不需要
opcache.memory_consumption=256      ; 共享内存大小(MB)，根据项目大小调整
opcache.interned_strings_buffer=16  ; 驻留字符串内存(MB)
opcache.max_accelerated_files=20000 ; 最大缓存文件数，略大于项目文件总数
opcache.revalidate_freq=60          ; 文件更新检查间隔(秒)，生产环境可设60
opcache.validate_timestamps=1       ; 设为0需手动重启才能更新代码
opcache.save_comments=1             ; 保留注释(某些框架依赖注解)
opcache.max_wasted_percentage=10    ; 浪费内存超过10%时自动重启
```

## PHP-FPM 配置调优实战

PHP-FPM 的进程管理有三种模式：**static**、**dynamic**、**ondemand**。

**dynamic 模式推荐配置：**

```ini
[www]
; 进程管理方式
pm = dynamic

; 最大子进程数（最关键参数）
; 计算公式：pm.max_children = (可用内存 - 系统预留) / 单个PHP进程内存
; 例：服务器4GB内存，每个PHP进程约40MB → (4096-1024)/40 ≈ 75
pm.max_children = 50

; 启动时创建的进程数
pm.start_servers = 10

; 空闲时最少保留的进程数
pm.min_spare_servers = 5

; 空闲时最多保留的进程数
pm.max_spare_servers = 20

; 子进程处理多少请求后自动回收（防止内存泄漏）
pm.max_requests = 500

; 空闲进程超时回收时间(秒)
pm.process_idle_timeout = 10s

; 请求超时时间
request_terminate_timeout = 30s

; 慢请求日志
request_slowlog_timeout = 5s
slowlog = /var/log/php-fpm/www-slow.log

; 单进程内存限制
php_admin_value[memory_limit] = 256M
```

**static 模式**适用于内存充足、流量稳定的高并发场景，进程数固定不变，省去进程创建/销毁开销。

**ondemand 模式**适用于低流量或开发环境，按需创建进程，空闲时自动回收，内存占用最低。

## CLI 模式 vs FPM 模式

|    特性    |           CLI 模式            |              FPM 模式               |
| :--------: | :---------------------------: | :---------------------------------: |
|  运行方式  |    命令行直接执行 php 文件    |     作为守护进程接收 Web 请求       |
|  生命周期  | 执行完即退出，每次重新初始化  | 进程常驻，复用初始化结果            |
|  内存限制  |    默认无限制 (-1)            |         受 php.ini 配置限制         |
| 超时限制   |    默认无超时                 |  受 request_terminate_timeout 限制  |
|  典型场景  | 定时任务、脚本、队列消费、Composer | Web应用、API接口、动态页面        |
| SAPI 接口  |        cli                    |            fpm                      |
| 进程模型   |    单进程                     |   Master-Worker 多进程              |

**使用建议：**

- **CLI 模式**适合：artisan 命令、crontab 定时任务、消息队列消费者（`php artisan queue:work`）、数据迁移脚本
- **FPM 模式**适合：所有 HTTP 请求处理、REST API、Web 页面渲染
- 两者读取的 `php.ini` 可能不同（CLI 用 `/etc/php/8.x/cli/php.ini`，FPM 用 `/etc/php/8.x/fpm/php.ini`），配置修改时需注意

## 实际踩坑案例

### 案例一：502 Bad Gateway 排查

症状：Nginx 返回 502 Bad Gateway，错误日志出现 `connect() failed (111: Connection refused)` 或 `upstream prematurely closed connection`。

排查步骤：

```bash
# 1. 检查 PHP-FPM 是否在运行
systemctl status php8.2-fpm
# 如果没运行 → 启动它
systemctl start php8.2-fpm

# 2. 检查 Socket 文件是否存在
ls -la /run/php/php8.2-fpm.sock
# 如果不存在 → FPM 启动失败，查看错误日志
tail -50 /var/log/php8.2-fpm.log

# 3. 检查 Nginx 配置中的 socket 路径是否匹配
grep "fastcgi_pass" /etc/nginx/sites-enabled/*
# 确保路径与 FPM 配置一致

# 4. 检查 Socket 文件权限
# Nginx 用户(www-data)需要有读写权限
chown www-data:www-data /run/php/php8.2-fpm.sock
chmod 660 /run/php/php8.2-fpm.sock

# 5. 如果是 TCP 模式，检查端口监听
ss -tlnp | grep 9000
```

常见原因：

1. **PHP-FPM 进程崩溃**：段错误(Segfault)导致，检查日志中的 `SIGSEGV` 错误
2. **Socket 权限不足**：Nginx worker 用户与 Socket 文件权限不匹配
3. **资源耗尽**：`pm.max_children` 设置过小，所有 worker 忙碌时新请求被拒绝
4. **PHP 致命错误**：`php.ini` 配置错误导致 FPM 无法启动

### 案例二：进程数不够导致请求阻塞

症状：高峰期页面响应时间从 200ms 飙升到 10s+，部分请求超时，Nginx 错误日志出现 `upstream timed out (110: Connection timed out)`。

根因分析：

```bash
# 查看当前活跃进程数
curl http://127.0.0.1/status  # 需先启用 pm.status_path
# 或
ps aux | grep php-fpm | grep -v grep | wc -l

# 关键指标
# active processes = pm.max_children 时 → 所有进程都在忙
# idle processes = 0 → 没有空闲进程可处理新请求
# slow requests 数量持续增长 → 存在慢查询或阻塞操作
```

解决方案：

```ini
; 方案1: 增大最大进程数（需确保内存充足）
pm.max_children = 80   ; 从50调整到80

; 方案2: 排查慢请求根因
request_slowlog_timeout = 3s
slowlog = /var/log/php-fpm/www-slow.log

; 方案3: 设置请求超时，避免单个请求无限占用进程
request_terminate_timeout = 30s

; 方案4: 增加空闲进程数
pm.min_spare_servers = 10
pm.max_spare_servers = 30
```

### 案例三：内存泄漏导致 FPM 周期性重启

症状：每隔几小时出现一波 502，FPM 日志显示 `server reached pm.max_requests setting`。

这是正常行为——`pm.max_requests` 达到阈值后 worker 自动回收再重建。如果频率过高：

```ini
; 增大单进程请求数（治标）
pm.max_requests = 1000   ; 从500调整到1000

; 真正治本：排查代码中的内存泄漏
; 常见原因：全局变量累积、未关闭数据库连接、大数组未释放
```

启用内存监控：

```php
// 在入口文件添加内存监控
register_shutdown_function(function() {
    $mem = memory_get_peak_usage(true);
    if ($mem > 128 * 1024 * 1024) { // 超过128MB
        error_log("High memory: " . ($mem / 1024 / 1024) . "MB - " . $_SERVER['REQUEST_URI']);
    }
});
```

## 总结

理解 PHP 工作原理的关键在于把握请求的完整链路：**Nginx → FastCGI协议 → PHP-FPM Master → Worker进程 → Zend Engine (词法分析→AST→opcode→执行)**。性能优化的核心是让这条链路的每个环节都高效运转：OPcache 减少编译开销、JIT 提升执行效率、合理配置 FPM 进程参数避免资源瓶颈。

---

## 相关阅读

- [PHP版本区别](/categories/PHP/vs-php/)
- [PHP生命周期](/categories/PHP/lifecycle/)
- [进程线程协程](/categories/PHP/vs/)
- [PHP垃圾回收](/categories/PHP/gc/)