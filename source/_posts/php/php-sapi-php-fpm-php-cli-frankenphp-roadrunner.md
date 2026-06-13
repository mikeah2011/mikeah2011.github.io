---

title: PHP SAPI 深度对比：php-fpm vs php-cli vs FrankenPHP vs RoadRunner——进程模型、请求生命周期与内存管理的本质差异
keywords: [PHP SAPI, php, fpm vs php, cli vs FrankenPHP vs RoadRunner, 深度对比, 进程模型, 请求生命周期与内存管理的本质差异]
date: 2026-06-05 10:00:00
tags:
- PHP
- SAPI
- PHP-FPM
- FrankenPHP
- RoadRunner
- 进程模型
- 性能优化
description: 深度对比 PHP 四大 SAPI（php-fpm、php-cli、FrankenPHP、RoadRunner）的进程模型、请求生命周期与内存管理差异，涵盖 OPcache/JIT 行为、常驻内存泄漏陷阱与防范、性能基准及选型决策树，助你在 FastCGI、Go 嵌入式与 Worker 架构间精准选型。
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---



## 引言

在 PHP 生态中，我们每天都在使用各种 SAPI（Server API）来运行 PHP 代码，却很少深入思考它们之间的本质差异。php-fpm 托管了全球绝大多数 PHP Web 应用，php-cli 是我们日常开发的得力工具，FrankenPHP 代表了 PHP 运行时的现代化革新，而 RoadRunner 则开辟了 Go + PHP 混合架构的新路径。

这四种 SAPI 并非简单的"换壳"——它们在进程模型、请求生命周期、内存管理策略上有着根本性的差异。理解这些差异，不仅能帮助你做出更合理的架构选型，还能在性能调优时找到真正的瓶颈所在。

<!-- more -->

---

## 一、SAPI 接口概述：PHP 的"万能插头"

### 1.1 什么是 SAPI

SAPI（Server API）是 PHP 内核与外部宿主环境之间的抽象接口层。可以将其理解为一个"适配器"——PHP 解释器本身并不关心自己运行在 Web 服务器中还是命令行终端里，它只需要通过 SAPI 接口与宿主环境交互即可。

PHP 内核定义了一组 C 结构体 `sapi_module_struct`，每个 SAPI 都需要实现这个结构体中的回调函数：

```c
struct _sapi_module_struct {
    char *name;                   // SAPI 名称（如 "fpm-fcgi", "cli"）
    char *pretty_name;            // 显示名称
    
    // 生命周期回调
    int (*startup)(struct _sapi_module_struct *sapi_module);
    int (*shutdown)(struct _sapi_module_struct *sapi_module);
    int (*activate)(void);
    int (*deactivate)(void);
    
    // 输出与头部处理
    void (*ub_write)(const char *str, size_t str_length);
    int (*send_headers)(sapi_headers_struct *sapi_headers);
    
    // 读取请求数据
    size_t (*read_post)(char *buffer, size_t count_bytes);
    char *(*read_cookies)(void);
    
    // 服务器变量填充
    void (*register_server_variables)(zval *track_vars_array);
    
    // 消息处理器
    void (*log_message)(const char *message, int syslog_type_int);
    double (*get_request_time)(void);
};
```

### 1.2 PHP 如何通过 SAPI 与宿主环境交互

```
┌─────────────────────────────────────────────────────┐
│                  宿主环境 (Host)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Nginx    │  │ Terminal │  │ Go Runtime       │   │
│  │ (FastCGI)│  │          │  │ (FrankenPHP/RR)  │   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │              │                 │              │
│  ─────┴──────────────┴─────────────────┴────────────  │
│                 SAPI 接口层                            │
│  ┌─────────────────────────────────────────────────┐  │
│  │         sapi_module_struct (C 结构体)            │  │
│  │  startup / shutdown / read_post / ub_write ...  │  │
│  └─────────────────────┬───────────────────────────┘  │
│  ───────────────────────┴──────────────────────────── │
│                 PHP 内核 (Zend Engine)                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ 词法分析 │→ │ 语法分析 │→ │ op_array 执行     │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────┘
```

每次 PHP 启动时，根据被调用的方式，会选择加载对应的 SAPI 模块。比如通过 `php-fpm` 命令启动会加载 `fpm-fcgi` SAPI，通过 `php` 命令启动会加载 `cli` SAPI，而 FrankenPHP 和 RoadRunner 则通过各自的 Go 层嵌入 PHP 解释器来注册自定义的 SAPI。

### 1.3 常见 SAPI 类型一览

| SAPI 名称 | 宿主环境 | 主要用途 |
|-----------|---------|---------|
| `cli` | 命令行终端 | 脚本执行、CLI 工具 |
| `fpm-fcgi` | Nginx/Apache | 传统 Web 服务 |
| `apache2handler` | Apache (mod_php) | Apache 模块 |
| `phpdbg` | 调试器 | 断点调试 |
| `embed` | C 程序 | 嵌入式调用 |
| `frankenphp` | Go Runtime | 现代 Web 服务 |
| `roadrunner` | Go (通过 goridge) | 高性能服务 |

---

## 二、php-fpm：成熟的 FastCGI 进程管理器

### 2.1 架构概览

php-fpm（FastCGI Process Manager）是 PHP 官方推荐的生产环境 SAPI。它作为 FastCGI 协议的服务端，接收来自 Web 服务器（如 Nginx）的请求。

```
┌──────────────────────────────────────────────────────┐
│                    Nginx (Master)                     │
│                       │                               │
│          ┌────────────┼────────────┐                  │
│          ▼            ▼            ▼                  │
│      Worker 1     Worker 2    Worker N               │
│          │            │            │                  │
└──────────┼────────────┼────────────┼──────────────────┘
           │ FastCGI    │            │ FastCGI
           ▼            ▼            ▼
┌──────────────────────────────────────────────────────┐
│              php-fpm (Master Process)                 │
│         ┌─────────────┴─────────────┐                │
│         ▼                           ▼                │
│   ┌─────────────┐           ┌─────────────┐         │
│   │ Pool: www   │           │ Pool: api   │         │
│   │             │           │             │         │
│   │ ┌─Worker─┐  │           │ ┌─Worker─┐  │         │
│   │ │Process │  │           │ │Process │  │         │
│   │ └────────┘  │           │ └────────┘  │         │
│   │ ┌─Worker─┐  │           │ ┌─Worker─┐  │         │
│   │ │Process │  │           │ │Process │  │         │
│   │ └────────┘  │           │ └────────┘  │         │
│   │    ...      │           │    ...      │         │
│   └─────────────┘           └─────────────┘         │
└──────────────────────────────────────────────────────┘
```

### 2.2 Worker 进程的生命周期

php-fpm 支持三种进程管理模式：`static`、`dynamic` 和 `ondemand`。

**static 模式**：固定数量的 worker 进程，启动时全部 fork，永不退出。

**dynamic 模式**（最常用）：动态调整 worker 数量，介于 `pm.min_spare_servers` 和 `pm.max_spare_servers` 之间。

**ondemand 模式**：按需创建 worker，空闲超时后回收。

```ini
; php-fpm.conf 配置示例
[www]
pm = dynamic
pm.max_children = 50          ; 最大 worker 数
pm.start_servers = 10         ; 启动时的 worker 数
pm.min_spare_servers = 5      ; 最小空闲 worker
pm.max_spare_servers = 15     ; 最大空闲 worker
pm.max_requests = 1000        ; 每个 worker 处理多少请求后重启
request_terminate_timeout = 30s
```

每个 worker 进程的内部生命周期：

```
┌─────────────────────────────────────────────────┐
│              php-fpm Worker 生命周期              │
│                                                  │
│  [fork] → [MINIT] → [等待请求] ──────────────┐   │
│                           │                    │   │
│                     ┌─────▼─────┐              │   │
│                     │ [RINIT]   │← 请求到达    │   │
│                     │ 初始化请求 │              │   │
│                     └─────┬─────┘              │   │
│                     ┌─────▼─────┐              │   │
│                     │ [执行脚本] │              │   │
│                     └─────┬─────┘              │   │
│                     ┌─────▼──────┐             │   │
│                     │[RSHUTDOWN] │             │   │
│                     │ 清理请求    │             │   │
│                     └─────┬──────┘             │   │
│                           │                    │   │
│                    处理数 < max_requests?       │   │
│                      /          \              │   │
│                    是             否            │   │
│                    │              │             │   │
│              [回到等待]     [MSHUTDOWN→退出]    │   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 2.3 信号处理与 Graceful Reload

php-fpm master 进程通过 Unix 信号来控制 worker 进程：

```bash
# 常用信号
kill -USR2 $(cat /run/php-fpm.pid)     # 平滑重载（graceful reload）
kill -QUIT $(cat /run/php-fpm.pid)     # 优雅退出
kill -INT  $(cat /run/php-fpm.pid)     # 强制退出
kill -USR1 $(cat /run/php-fpm.pid)     # 重新打开日志文件
```

**Graceful Reload 的关键机制**：

当收到 `SIGUSR2` 信号时，php-fpm master 进程不会立即杀掉正在处理请求的 worker，而是：

1. 标记当前所有 worker 为"即将退出"状态
2. fork 新的 worker 进程来接受新请求
3. 旧 worker 在完成当前请求后自行退出
4. 如果旧 worker 一直不退出（如陷入死循环），超过 `process_control_timeout` 后会被强制终止

```c
// php-fpm 源码简化示意 (fpm_signals.c)
static void sig_handler(int signo) {
    static const char sig_chars[NSIG + 1];
    // 将信号写入管道，由主事件循环处理
    write(sig_pipe[1], &sig_chars[signo], 1);
}
```

### 2.4 php-fpm 的内存管理特点

php-fpm worker 的内存策略是 **"每次请求重置"**。在每个请求的 RSHUTDOWN 阶段，Zend Engine 会：

1. 销毁所有用户变量（zval refcount → 0）
2. 关闭打开的文件句柄
3. 断开数据库连接（除非使用持久连接）
4. 重置全局状态

```
内存使用趋势 (单个 php-fpm worker):

内存 (MB)
  │
20├──── ★ MINIT: 加载 PHP 扩展、初始化 Zend Engine
  │
15├──── ★ RINIT: 初始化请求，加载 $_SERVER 等
  │        ╱
12├──────╱──── ★ 脚本执行中：加载框架、路由解析
  │     ╱      ╱╲
10├────╱──────╱──╲──── 处理请求 (峰值)
  │   ╱      ╱    ╲
 8├──╱──────╱──────╲── ★ RSHUTDOWN: 释放内存
  │  ╱                    ↓ 回到 ~15MB
 6├─╱─────────────────────── 等待下一个请求
  │
  └──┬────┬────┬────┬────┬────→ 时间
    req1  req2  req3  req4  req5
```

`pm.max_requests` 配置项的作用是：当一个 worker 处理了 N 个请求后，强制销毁并重新 fork，以防止内存泄漏的累积。

---

## 三、php-cli：命令行模式的本质

### 3.1 单次执行模型

php-cli SAPI 是最简单、最纯粹的 PHP 运行模式。它遵循经典的"一次执行"模型：

```
┌─────────────────────────────────────────┐
│         php-cli 生命周期                 │
│                                          │
│  [启动进程]                              │
│      │                                   │
│      ▼                                   │
│  [模块初始化 MINIT]  ← 加载扩展          │
│      │                                   │
│      ▼                                   │
│  [请求初始化 RINIT]  ← CLI 专有处理      │
│      │                                   │
│      ▼                                   │
│  [执行脚本]           ← 你的 PHP 代码    │
│      │                                   │
│      ▼                                   │
│  [请求关闭 RSHUTDOWN] ← 清理请求资源     │
│      │                                   │
│      ▼                                   │
│  [模块关闭 MSHUTDOWN] ← 卸载扩展        │
│      │                                   │
│      ▼                                   │
│  [进程退出]                              │
└─────────────────────────────────────────┘
```

### 3.2 CLI SAPI 的独特行为

php-cli 与 php-fpm 在 SAPI 层面有若干关键差异：

```php
// CLI 模式下的行为差异
// 1. 没有请求超时（除非手动设置）
set_time_limit(0); // 在 CLI 中默认就是 0

// 2. 错误输出直接到 stderr
ini_set('display_errors', 'stderr');

// 3. 没有 HTTP 头概念
// header('X-Foo: bar');  // CLI 中会直接输出为文本

// 4. 标准输入输出直接可用
$line = fgets(STDIN);
fwrite(STDOUT, "Hello\n");
fwrite(STDERR, "Error\n");

// 5. 脚本执行完成后，PHP 进程直接退出
//    所有内存由操作系统回收
```

### 3.3 CLI 的内存释放机制

CLI SAPI 的内存管理最为"原始"——脚本执行完毕后，操作系统直接回收整个进程的内存，无需 PHP 自己费力清理。

但在长时间运行的 CLI 脚本（如队列消费、定时任务）中，情况就不同了：

```php
// 长时间运行的 CLI 脚本中的内存管理
while (true) {
    $job = $queue->pop();
    
    if ($job === null) {
        sleep(1);
        continue;
    }
    
    // 处理任务
    processJob($job);
    
    // 关键：手动清理变量，避免内存累积
    unset($job);
    
    // 可选：强制触发垃圾回收
    gc_collect_cycles();
    
    // 监控内存使用
    $mem = memory_get_usage(true);
    if ($mem > 128 * 1024 * 1024) { // 超过 128MB
        // 极端情况：退出并由 supervisor 重启
        exit(1);
    }
}
```

---

## 四、FrankenPHP：Go 驱动的现代 SAPI

### 4.1 架构设计

FrankenPHP 由 Symfony 核心开发者 Kévin Dunglas 创建，它是一个用 Go 编写的现代 PHP 应用服务器。它的核心创新在于将 PHP 解释器嵌入到 Go 程序中，通过 C 绑定（cgo）直接调用 PHP 的 C API。

```
┌──────────────────────────────────────────────────────┐
│                  FrankenPHP (Go Runtime)              │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │  HTTP/3     │  │  HTTP/2     │  │  HTTP/1.1    │ │
│  │  (QUIC)     │  │  (h2c/TLS)  │  │  (Keep-Alive)│ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘ │
│         └────────────────┼────────────────┘          │
│                          ▼                            │
│              ┌───────────────────────┐                │
│              │    Go HTTP Router     │                │
│              │   (路由、中间件)       │                │
│              └───────────┬───────────┘                │
│                          ▼                            │
│         ┌────────────────┼────────────────┐           │
│         ▼                ▼                ▼           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ PHP Worker 1│  │ PHP Worker 2│  │ PHP Worker N│  │
│  │ (嵌入式     │  │ (嵌入式     │  │ (嵌入式     │  │
│  │  PHP 解释器)│  │  PHP 解释器)│  │  PHP 解释器)│  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐│
│  │            cgo bindings to libphp                 ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### 4.2 Worker 模式

FrankenPHP 的 worker 模式是其最大的性能亮点。与 php-fpm 的"每个请求一次进程生命周期"不同，FrankenPHP 的 worker 常驻内存，可以跨请求复用：

```php
<?php
// frankenphp worker 模式的入口脚本 (worker.php)
// 该脚本只执行一次（MINIT 阶段）

// 加载框架引导文件（只加载一次！）
require __DIR__ . '/vendor/autoload.php';
$app = require __DIR__ . '/bootstrap/app.php';

// 进入 worker 循环
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

while (frankenphp_handle_request(function () use ($kernel) {
    // 每个请求的处理逻辑
    // frankenphp_handle_request() 内部会：
    // 1. 重置 PHP 超全局变量 ($_GET, $_POST 等)
    // 2. 接收新的 HTTP 请求数据
    // 3. 执行闭包中的代码
    // 4. 发送响应
    // 5. 在返回前清理请求级别的状态
    
    $request = Illuminate\Http\Request::capture();
    $response = $kernel->handle($request);
    $response->send();
    $kernel->terminate($request, $response);
})) {
    // 请求处理完成，继续循环
    // 当 FrankenPHP 决定回收此 worker 时，循环终止
}
```

### 4.3 HTTP/3 支持

FrankenPHP 是第一个原生支持 HTTP/3 的 PHP 运行时。它基于 Go 的 `quic-go` 库实现 QUIC 协议，无需额外配置即可同时监听 HTTP/1.1、HTTP/2 和 HTTP/3：

```dockerfile
# FrankenPHP Dockerfile 示例
FROM dunglas/frankenphp

# HTTP/3 需要 UDP 443 端口
EXPOSE 443/tcp 443/udp 80/tcp

# 自动获得 HTTP/3 支持，只需配置 TLS
```

### 4.4 FrankenPHP 的内存管理

FrankenPHP worker 模式下的内存管理是一个需要特别关注的问题：

```
内存使用趋势 (FrankenPHP Worker):

内存 (MB)
  │
60├──── ★ MINIT: 加载框架、初始化所有服务
  │
55├──── ★ 第一个请求 (RINIT → 执行 → RSHUTDOWN)
  │        ↑ 已加载的类和函数仍然保留在内存中
50├──────── ★ 第二个请求
  │
48├────────── ★ 第 N 个请求（内存逐渐趋于稳定）
  │
45├──────────── ★ 稳态
  │
  └──┬────┬────┬────┬────┬────→ 时间
    req1  req2  req3  req4  req5

注意：如果没有正确清理，可能出现内存泄漏！
```

**防范内存泄漏的关键**：

```php
// FrankenPHP worker 中防止内存泄漏的模式

// 1. 使用 FrankenPHP 内置的请求清理机制
// frankenphp_handle_request() 会自动清理超全局变量

// 2. 避免在请求之间共享可变状态
// BAD: 
class UserService {
    private array $cache = []; // 会在请求间累积！
}

// BETTER:
class UserService {
    private static array $requestCache = [];
    
    public static function resetRequestState(): void {
        self::$requestCache = [];
    }
}

// 3. 在 worker 循环中注册清理钩子
frankenphp_handle_request(function () {
    try {
        // 处理请求
        handleRequest();
    } finally {
        // 清理请求级别的单例
        app()->forgetInstance('request');
        app()->forgetInstance('events');
    }
});
```

---

## 五、RoadRunner：Go 应用服务器 + PHP Worker

### 5.1 架构设计

RoadRunner 由 Spiral 公司开发，采用完全不同的架构思路：它是一个 Go 编写的高性能应用服务器，通过自定义二进制协议（goridge）与独立的 PHP worker 进程通信。

```
┌──────────────────────────────────────────────────────┐
│              RoadRunner (Go Application Server)       │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │ HTTP     │  │ gRPC     │  │ TCP / WebSocket    │ │
│  │ Plugin   │  │ Plugin   │  │ Plugin             │ │
│  └────┬─────┘  └────┬─────┘  └────────┬───────────┘ │
│       └──────────────┼─────────────────┘             │
│                      ▼                               │
│           ┌───────────────────┐                      │
│           │  Worker Pool     │                      │
│           │  (连接管理器)     │                      │
│           └────┬──────────┬──┘                      │
│                │          │                          │
│    ┌───────────┘          └───────────┐              │
│    │ goridge (TCP/Unix Socket)        │              │
│    │ 自定义二进制协议                   │              │
└────┼──────────────────────────────────┼──────────────┘
     │                                  │
     ▼                                  ▼
┌─────────────┐              ┌─────────────────┐
│ PHP Worker  │              │ PHP Worker      │
│ (独立进程)   │              │ (独立进程)       │
│             │              │                  │
│ while(true) │              │ while(true) {   │
│   $payload  │              │   $payload =    │
│   = RR->    │              │   RR->wait();   │
│   wait();   │              │   // 处理       │
│   // 处理   │              │ }               │
│ }           │              │                  │
└─────────────┘              └─────────────────┘
```

### 5.2 RoadRunner 的 PHP Worker 模式

```php
<?php
// RoadRunner worker 入口脚本

use Spiral\RoadRunner\Worker;
use Spiral\RoadRunner\Http\HttpWorker;
use Spiral\RoadRunner\Http\PSR7Worker;

require __DIR__ . '/vendor/autoload.php';

// 创建 PSR-7 兼容的 worker
$worker = Worker::create();
$httpWorker = new PSR7Worker($worker);

while ($request = $httpWorker->waitRequest()) {
    try {
        $response = new \Nyholm\Psr7\Response();
        $response->getBody()->write('Hello from RoadRunner!');
        
        $httpWorker->respond($response);
    } catch (\Throwable $e) {
        $httpWorker->getWorker()->error((string)$e);
    }
}
```

### 5.3 RoadRunner vs FrankenPHP 的通信差异

| 特性 | FrankenPHP | RoadRunner |
|------|-----------|------------|
| PHP 进程管理 | Go 直接管理（cgo 嵌入） | 独立 PHP 进程 |
| 通信方式 | 内存共享（cgo 调用） | goridge 二进制协议 |
| 进程模型 | Go goroutine + 嵌入式 PHP | Go 进程 + 独立 PHP 进程 |
| 部署复杂度 | 单一二进制文件 | Go 服务 + PHP worker |
| 协议支持 | HTTP/1.1, HTTP/2, HTTP/3 | HTTP, gRPC, TCP, WebSocket, Jobs |

---

## 六、请求生命周期深度对比

### 6.1 MINIT/MSHUTDOWN 阶段

**MINIT（Module Init）** 是 PHP 扩展模块的初始化阶段，在进程启动时执行一次。

```
┌────────────────────────────────────────────────────────┐
│              MINIT 阶段在不同 SAPI 中的行为              │
├──────────────┬─────────────────────────────────────────┤
│ SAPI         │ MINIT 执行时机与频率                     │
├──────────────┼─────────────────────────────────────────┤
│ php-fpm      │ 每个 worker fork 后执行一次              │
│              │ 可通过 preloading 共享只读内存页          │
├──────────────┼─────────────────────────────────────────┤
│ php-cli      │ 进程启动时执行一次                       │
│              │ 脚本结束后随进程销毁                     │
├──────────────┼─────────────────────────────────────────┤
│ FrankenPHP   │ worker 启动时执行一次                    │
│              │ 在 Go runtime 中通过 cgo 调用            │
│              │ worker 常驻，MINIT 只执行一次            │
├──────────────┼─────────────────────────────────────────┤
│ RoadRunner   │ 每个 PHP worker 进程启动时执行一次       │
│              │ worker 常驻，MINIT 只执行一次            │
└──────────────┴─────────────────────────────────────────┘
```

### 6.2 RINIT/RSHUTDOWN 阶段

**RINIT（Request Init）** 和 **RSHUTDOWN（Request Shutdown）** 是每个请求的初始化和清理阶段。

```php
// 通过扩展代码观察 RINIT/RSHUTDOWN (C 扩展示例)
// my_ext.c

PHP_RINIT_FUNCTION(my_ext) {
    // 每个请求开始时调用
    // php-fpm: 每个 HTTP 请求
    // FrankenPHP: 每次 frankenphp_handle_request()
    // RoadRunner: 每次 $worker->waitRequest()
    
    // 初始化请求级别的资源
    MY_G(request_data) = NULL;
    return SUCCESS;
}

PHP_RSHUTDOWN_FUNCTION(my_ext) {
    // 每个请求结束时调用
    // 清理请求级别的资源
    if (MY_G(request_data)) {
        efree(MY_G(request_data));
        MY_G(request_data) = NULL;
    }
    return SUCCESS;
}
```

各 SAPI 在 RINIT/RSHUTDOWN 阶段的关键差异：

```
┌───────────────────────────────────────────────────────────┐
│              RINIT/RSHUTDOWN 行为差异对比                   │
├──────────────┬────────────────────────────────────────────┤
│              │  RINIT 处理                                │
├──────────────┼────────────────────────────────────────────┤
│ php-fpm      │ 解析 FastCGI 参数 → 填充 $_SERVER         │
│              │ 设置请求超时 alarm()                       │
│              │ 初始化 $_GET/$_POST/$_COOKIE               │
├──────────────┼────────────────────────────────────────────┤
│ php-cli      │ 解析命令行参数 → 填充 $argv               │
│              │ 设置 stdin/stdout/stderr                   │
│              │ 无 HTTP 超全局变量                         │
├──────────────┼────────────────────────────────────────────┤
│ FrankenPHP   │ 从 Go 侧获取请求数据                      │
│              │ 通过 SAPI 回调填充 $_SERVER               │
│              │ frankenphp_handle_request() 内部调用       │
├──────────────┼────────────────────────────────────────────┤
│ RoadRunner   │ 从 goridge 读取 PSR-7 请求序列化数据       │
│              │ 手动填充超全局变量或使用 PSR-7 接口         │
├──────────────┼────────────────────────────────────────────┤
│              │  RSHUTDOWN 处理                            │
├──────────────┼────────────────────────────────────────────┤
│ php-fpm      │ 销毁所有用户变量和资源                     │
│              │ 关闭非持久化连接                           │
│              │ 输出缓冲区刷新                             │
├──────────────┼────────────────────────────────────────────┤
│ php-cli      │ 同上，但进程即将退出                       │
│              │ MSHUTDOWN 紧随其后                         │
├──────────────┼────────────────────────────────────────────┤
│ FrankenPHP   │ 清理请求级别的全局变量                     │
│              │ 重置输出缓冲区                             │
│              │ 但不销毁已加载的类/函数定义                 │
├──────────────┼────────────────────────────────────────────┤
│ RoadRunner   │ 类似 FrankenPHP                           │
│              │ 清理请求状态但保持进程存活                  │
└──────────────┴────────────────────────────────────────────┘
```

### 6.3 MSHUTDOWN 阶段

**MSHUTDOWN（Module Shutdown）** 是扩展模块的最终清理阶段。

- **php-fpm**: worker 进程退出时（达到 `max_requests` 或被 master 杀掉时）
- **php-cli**: 脚本执行完毕后立即执行
- **FrankenPHP/RoadRunner**: worker 进程被回收时（可能处理了成千上万个请求后才执行）

---

## 七、内存管理对比：每次请求重置 vs 常驻内存

### 7.1 每次请求重置模型（php-fpm、php-cli）

```
┌───────────────────────────────────────────────────────┐
│            每次请求重置模型 (php-fpm)                  │
│                                                        │
│  请求 1                                                │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                  │
│  │INIT│→│LOAD│→│EXEC│→│FREE│→│EXIT│  ← 完整生命周期   │
│  └────┘ └────┘ └────┘ └────┘ └────┘                  │
│                                                        │
│  请求 2                                                │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                  │
│  │INIT│→│LOAD│→│EXEC│→│FREE│→│EXIT│  ← 完整生命周期   │
│  └────┘ └────┘ └────┘ └────┘ └────┘                  │
│                                                        │
│  每个请求:                                             │
│  ✓ 无状态污染风险                                      │
│  ✓ 天然的内存安全                                      │
│  ✗ 重复加载框架开销大                                  │
│  ✗ 吞吐量受限于 fork + 初始化时间                      │
└───────────────────────────────────────────────────────┘
```

**优势**：
- 天然的请求隔离：一个请求的内存泄漏不会影响下一个请求
- 代码兼容性好：所有 PHP 代码都能直接运行，无需考虑常驻内存的副作用
- 运维简单：`pm.max_requests` 可以兜底处理内存泄漏

**劣势**：
- 每个请求都要重新加载框架、解析配置、建立连接
- 吞吐量天花板明显：每个请求的"固定开销"约为 2-10ms

### 7.2 常驻内存模型（FrankenPHP、RoadRunner）

```
┌───────────────────────────────────────────────────────┐
│            常驻内存模型 (FrankenPHP Worker)            │
│                                                        │
│  启动                                                  │
│  ┌────┐ ┌────┐                                        │
│  │INIT│→│LOAD│← 框架、类定义只加载一次               │
│  └────┘ └────┘                                        │
│      │                                                 │
│      ▼                                                 │
│  请求 1:  ┌────┐ ┌────┐                               │
│           │RINT│→│EXEC│→ 仅处理请求逻辑              │
│           └────┘ └────┘                               │
│               │                                        │
│  请求 2:  ┌────┐ ┌────┐                               │
│           │RINT│→│EXEC│→ 仅处理请求逻辑              │
│           └────┘ └────┘                               │
│               │                                        │
│  请求 N:  ┌────┐ ┌────┐                               │
│           │RINT│→│EXEC│→ 仅处理请求逻辑              │
│           └────┘ └────┘                               │
│               │                                        │
│  退出                                                  │
│  ┌─────┐                                              │
│  │MSDWN│← 框架资源最终清理                            │
│  └─────┘                                              │
│                                                        │
│  优势: 吞吐量提升 5-10x                                │
│  风险: 内存泄漏可能累积                                 │
└───────────────────────────────────────────────────────┘
```

### 7.3 常驻内存的陷阱与应对

```php
// 常见的内存泄漏陷阱

// 1. 静态属性累积
class Cache {
    private static array $store = []; // 会跨请求累积！
    
    // 解决方案：定期清理或使用请求级别缓存
    public static function flush(): void {
        self::$store = [];
    }
}

// 2. 事件监听器重复注册
// 每个请求都注册一次 → 第 N 个请求时有 N 个监听器
// 解决方案：检查是否已注册，或在 RSHUTDOWN 中注销

// 3. 持久化数据库连接中的游标
// PDO 持久连接的 prepared statement 可能在请求间泄漏
// 解决方案：在请求结束时显式关闭游标

// 4. 全局状态污染
$_SERVER['MY_CUSTOM_KEY'] = 'value'; // 可能在下一个请求中残留
// 解决方案：依赖 SAPI 的 RINIT 清理，或手动清理
```

### 7.4 性能数据对比

基于典型 Laravel 应用的基准测试（估算值）：

| 指标 | php-fpm | FrankenPHP (Worker) | RoadRunner |
|------|---------|--------------------|----|
| 请求延迟 (P50) | ~25ms | ~8ms | ~10ms |
| 吞吐量 (req/s) | ~800 | ~3000 | ~2500 |
| 内存/worker | ~30MB | ~50MB | ~45MB |
| 框架加载开销 | 每次 ~5ms | 仅首次 | 仅首次 |
| 冷启动时间 | ~100ms | ~500ms | ~300ms |

> 注意：以上数据为大致估算，实际性能取决于应用复杂度、服务器配置等因素。

---

## 八、OPcache 在不同 SAPI 中的行为差异

### 8.1 OPcache 的基本原理

OPcache 通过将 PHP 脚本编译后的操作码（opcode）缓存在共享内存中，避免重复编译。

```
┌─────────────────────────────────────────────────┐
│              OPcache 工作原理                     │
│                                                  │
│  PHP 源码 → 词法分析 → 语法分析 → op_array       │
│                                    │             │
│                         ┌──────────▼──────────┐ │
│                         │  OPcache 共享内存    │ │
│                         │                      │ │
│                         │  file.php → op_array │ │
│                         │  class.php → op_array│ │
│                         │  ...                 │ │
│                         └──────────────────────┘ │
│                                                  │
│  命中缓存 → 直接执行 op_array                    │
│  未命中   → 编译 → 存入缓存 → 执行              │
└─────────────────────────────────────────────────┘
```

### 8.2 各 SAPI 中 OPcache 的差异

**php-fpm 中的 OPcache**：

```ini
; php.ini - OPcache 配置
opcache.enable=1
opcache.enable_cli=0            ; CLI 模式默认关闭
opcache.memory_consumption=256  ; 共享内存大小
opcache.max_accelerated_files=10000
opcache.validate_timestamps=1   ; 生产环境可设为 0
opcache.revalidate_freq=60      ; 文件检查频率

; php-fpm 特有的关键配置
opcache.preload=/path/to/preload.php  ; 预加载框架
opcache.preload_user=www
```

php-fpm 的每个 worker 进程共享同一个 OPcache 共享内存区域（通过 `mmap` 共享）。这意味着：

1. 第一个请求编译脚本，后续 worker 直接使用缓存的 opcode
2. `opcache_reset()` 会影响所有 worker
3. **共享内存大小需要根据 worker 数量和代码量合理设置**

```
┌──────────────────────────────────────────────┐
│     php-fpm OPcache 共享内存示意              │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │         OPcache Shared Memory            │ │
│  │         (mmap 共享内存区域)               │ │
│  │                                          │ │
│  │  ┌──────────┐ ┌──────────┐ ┌─────────┐ │ │
│  │  │ Script A │ │ Script B │ │ Script C│ │ │
│  │  │ (opcode) │ │ (opcode) │ │ (opcode)│ │ │
│  │  └──────────┘ └──────────┘ └─────────┘ │ │
│  └─────────────────────────────────────────┘ │
│       ↑              ↑              ↑         │
│  ┌────┴──┐      ┌────┴──┐     ┌────┴──┐     │
│  │Worker1│      │Worker2│     │Worker3│     │
│  └───────┘      └───────┘     └───────┘     │
└──────────────────────────────────────────────┘
```

**FrankenPHP 中的 OPcache**：

FrankenPHP 的 OPcache 行为取决于运行模式：

- **CGI 模式**（非 worker）：类似 php-fpm，每个请求重新初始化 OPcache
- **Worker 模式**：OPcache 更加有效，因为：

```php
// FrankenPHP worker 模式下 OPcache 的优势
// 1. 框架代码只编译一次
// 2. 热路径的 opcode 持续缓存
// 3. 配合 preloading 可以实现类级别的常量折叠

// preload.php 示例（同时适用于 FrankenPHP 和 php-fpm）
<?php
opcache_compile_file(__DIR__ . '/vendor/autoload.php');
opcache_compile_file(__DIR__ . '/vendor/laravel/framework/src/Illuminate/Foundation/Application.php');
opcache_compile_file(__DIR__ . '/vendor/laravel/framework/src/Illuminate/Container/Container.php');
// ... 预编译热路径文件
```

**RoadRunner 中的 OPcache**：

RoadRunner 的 PHP worker 是独立进程，每个进程有自己的 OPcache 共享内存。如果 worker 数量较多，OPcache 的总内存消耗 = `memory_consumption × worker_count`。

```
┌──────────────────────────────────────────────┐
│     RoadRunner OPcache 内存分布              │
│                                               │
│  ┌─────────────┐  ┌─────────────┐            │
│  │ PHP Worker 1│  │ PHP Worker 2│            │
│  │ OPcache     │  │ OPcache     │            │
│  │ (独立区域)   │  │ (独立区域)   │            │
│  │ 128MB       │  │ 128MB       │            │
│  └─────────────┘  └─────────────┘            │
│                                               │
│  注意：不同 worker 之间的 OPcache 不共享！     │
│  总内存 = 128MB × N (N 为 worker 数)         │
└──────────────────────────────────────────────┘
```

> **重要提示**：RoadRunner 从 v2023.x 开始支持通过 `opcache.consistency_checks` 等配置优化多 worker 场景下的 OPcache 使用。但本质上，独立进程之间的 OPcache 仍然是隔离的。

### 8.3 OPcache JIT 在不同 SAPI 中的表现

PHP 8.0 引入了 OPcache JIT 编译器，它在不同 SAPI 中的表现也有差异：

```ini
; JIT 配置
opcache.jit=1255           ; O=1(开启), C=2(寄存器分配), R=1(寄存器), T=1(类型推测)
opcache.jit_buffer_size=128M
```

- **php-fpm**: JIT 编译的机器码在每个 worker 中独立生成，不共享。worker 重启后 JIT 缓存丢失。
- **FrankenPHP Worker**: JIT 效果最好，因为 worker 常驻，热代码可以持续优化。
- **RoadRunner Worker**: 类似 FrankenPHP，但 JIT 缓存在各 worker 间独立。
- **php-cli**: JIT 通常无意义，因为进程生命周期太短。

---

## 九、选型决策树

### 9.1 决策流程图

```
                         ┌───────────────┐
                         │  你需要什么？   │
                         └───────┬───────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  Web 服务 │ │ CLI 脚本 │ │  特殊需求 │
              └─────┬────┘ └─────┬────┘ └─────┬────┘
                    │            │            │
           ┌────────┼─────┐     │       ┌────┼────┐
           ▼        ▼     ▼     ▼       ▼    ▼    ▼
       ┌───────┐┌───────┐  │  ┌──────┐  │  ┌───┐┌───┐
       │传统部署││现代部署│  │  │php-cli│ │  │gRPC││WS │
       │Nginx+ ││容器化  │  │  └───┬──┘  │  └─┬─┘└─┬─┘
       │FPM    ││K8s    │  │      │      │    │    │
       └───┬───┘└───┬───┘  │      │      │    │    │
           │        │      │      │      │    │    │
           ▼        ▼      ▼      ▼      ▼    ▼    ▼
       ┌───────┐┌────────┐┌─────┐┌─────┐┌───────────┐
       │php-fpm││根据性能││cli  ││需要 ││ 优先考虑   │
       │       ││需求选择││     ││长驻?││ RoadRunner │
       └───────┘└───┬────┘└─────┘└──┬──┘└───────────┘
                    │               │
            ┌───────┼───────┐   ┌───┼───┐
            ▼       ▼       ▼   ▼       ▼
        ┌──────┐┌──────┐┌──────┐┌─────┐┌──────┐
        │低流量││中流量││高流量││ 是  ││  否  │
        │      ││      ││      ││     ││      │
        │fpm   ││fpm/  ││FR/RR ││FR/RR││ fpm  │
        │足够  ││FR均可││首选  ││     ││      │
        └──────┘└──────┘└──────┘└─────┘└──────┘

图例: FR = FrankenPHP, RR = RoadRunner
```

### 9.2 场景推荐矩阵

| 场景 | 推荐 SAPI | 理由 |
|------|----------|------|
| 传统共享主机部署 | php-fpm | 成熟、兼容性好、运维资源丰富 |
| 中小企业内部系统 | php-fpm | 够用、团队熟悉、生态完善 |
| 高并发 API 服务 | FrankenPHP / RoadRunner | 吞吐量提升 3-5x |
| 容器化微服务 | FrankenPHP | 单一二进制、HTTP/3、启动快 |
| gRPC 服务 | RoadRunner | 原生 gRPC 支持 |
| 消息队列消费者 | RoadRunner | 丰富的 Jobs/Queue 插件 |
| 实时 WebSocket | RoadRunner / FrankenPHP | Go 原生 WebSocket 支持 |
| 定时任务 / 脚本 | php-cli | 简单直接 |
| 快速原型验证 | php-cli 内置服务器 | `php -S localhost:8000` |
| 遗留系统迁移 | php-fpm → FrankenPHP | 平滑过渡，性能提升 |

### 9.3 迁移注意事项

**从 php-fpm 迁移到 FrankenPHP 的注意事项**：

```php
// 1. 检查是否有请求级别的全局状态污染
// BAD:
$GLOBALS['request_id'] = uniqid(); // 会跨请求保留

// BETTER:
$request_id = uniqid(); // 局部变量，请求结束后自动清理

// 2. 检查单例模式中的请求级数据
// Laravel 的 app() 容器需要在每个请求重置
// FrankenPHP + Laravel 的 Octane 模式已处理此问题

// 3. 检查静态属性的使用
class MyClass {
    private static $cache = [];
    
    // 需要添加清理方法
    public static function resetForNewRequest(): void {
        self::$cache = [];
    }
}

// 4. 检查数据库持久连接的行为
// PDO::ATTR_PERSISTENT 在 worker 模式下需要特别注意
```

**从 php-fpm 迁移到 RoadRunner 的注意事项**：

```yaml
# .rr.yaml - RoadRunner 配置
version: "3"
http:
  address: "0.0.0.0:8080"
  pool:
    num_workers: 8         # 根据 CPU 核心数调整
    max_jobs: 1000         # 每个 worker 处理的最大请求数
    allocate_timeout: 60s  # worker 分配超时
    destroy_timeout: 60s   # worker 销毁超时

# 注意：
# 1. $_SERVER 变量可能不完整，建议使用 PSR-7 请求对象
# 2. echo/print 输出不会直接发送到客户端
# 3. 需要使用 Worker::create() 和 PSR-7 接口
```

---

## 十、总结与展望

### 10.1 四种 SAPI 的本质差异总结

```
┌──────────┬────────────┬────────────┬──────────────┬──────────────┐
│  特性     │  php-fpm   │  php-cli   │ FrankenPHP   │ RoadRunner   │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ 进程模型  │ Master-    │ 单进程     │ Go goroutine │ Go + 独立    │
│          │ Worker     │ 单次执行   │ + 嵌入式PHP  │ PHP Worker   │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ 请求生命周期│每次完整   │一次完整    │ Worker常驻   │ Worker常驻   │
│          │ MINIT→     │ MINIT→     │ 只执行       │ 只执行       │
│          │ MSDOWN     │ MSDOWN     │ RINIT/RDOWN  │ RINIT/RDOWN  │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ 内存管理  │ 请求级别   │ 进程级别   │ 请求级别清理 │ 请求级别清理 │
│          │ 完全重置   │ OS回收     │ 但类定义保留 │ 但进程保留   │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ OPcache  │ 多worker   │ 默认关闭   │ Worker模式   │ 每worker     │
│          │ 共享内存   │            │ 效果最佳     │ 独立缓存     │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ JIT      │ 独立生成   │ 无意义     │ 持续优化     │ 独立生成     │
│          │ worker重启 │            │ 效果最好     │              │
│          │ 后丢失     │            │              │              │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ 部署方式  │ Nginx+     │ 命令行     │ 单一二进制   │ Go服务+PHP   │
│          │ php-fpm    │ 直接执行   │ 或容器       │ worker       │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ 学习曲线  │ 低         │ 最低       │ 中           │ 中高         │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ 生态成熟度│ ⭐⭐⭐⭐⭐│ ⭐⭐⭐⭐⭐│ ⭐⭐⭐       │ ⭐⭐⭐⭐     │
├──────────┼────────────┼────────────┼──────────────┼──────────────┤
│ 性能潜力  │ ⭐⭐⭐     │ ⭐⭐       │ ⭐⭐⭐⭐⭐  │ ⭐⭐⭐⭐⭐  │
└──────────┴────────────┴────────────┴──────────────┴──────────────┘
```

### 10.2 未来趋势

PHP SAPI 的演进方向正朝着以下趋势发展：

1. **长驻进程成为主流**：FrankenPHP 和 RoadRunner 证明了 worker 模式的可行性和性能优势，预计未来会有更多的 PHP 框架原生支持 worker 模式。

2. **Go 成为"最佳伴侣"**：Go 的高并发模型天然适合做 PHP 的前端代理/进程管理器，FrankenPHP 和 RoadRunner 都选择了 Go 作为宿主语言。

3. **协议层面的升级**：HTTP/3 (QUIC) 的普及、gRPC 的广泛应用，都要求 PHP 运行时能够支持更现代的网络协议。

4. **容器化优先**：单一二进制、无状态、快速启动——这些都是容器化部署的需求，FrankenPHP 在这方面具有天然优势。

5. **传统模式不会消亡**：php-fpm 仍然是绝大多数 PHP 应用的最佳选择。不要为了"追新"而盲目迁移——**先测量，再优化**。

### 10.3 最终建议

```
选择 SAPI 的核心原则：

1. 稳定性优先：没有特殊需求 → php-fpm 是最安全的选择
2. 性能有瓶颈：高并发场景 → 优先评估 FrankenPHP
3. 多协议需求：需要 gRPC/WebSocket → 优先评估 RoadRunner
4. 团队能力：考虑团队的运维能力和学习成本
5. 渐进式迁移：不要一次性全面切换，从非核心服务开始试点
```

理解 SAPI 的本质差异，不仅是为了做技术选型，更是为了在遇到性能问题时，能从底层原理出发找到真正的瓶颈。PHP 的 SAPI 架构是其"可嵌入、可扩展"设计理念的集中体现——正是这种灵活性，让 PHP 在诞生近 30 年后，依然能够不断进化，适应新的技术潮流。

---

*参考资源*：
- [PHP 内部：SAPI 详解](https://www.phpinternalsbook.com/)
- [php-fpm 官方文档](https://www.php.net/manual/zh/install.fpm.php)
- [FrankenPHP 官方文档](https://frankenphp.dev/docs/)
- [RoadRunner 官方文档](https://docs.roadrunner.dev/)
- [PHP 源码：sapi/ 目录](https://github.com/php/php-src/tree/master/sapi)

## 相关阅读

- [PHP 进程模型深度剖析：PHP-FPM Worker 生命周期、信号处理与 Graceful Reload 的底层机制](/05_PHP/Laravel/php-fpm-worker-lifecycle-signal-graceful-reload/)
- [RoadRunner 实战：Go 驱动的 PHP 高性能应用服务器——对比 Octane/Swoole/FrankenPHP 的进程模型与选型决策](/05_PHP/Laravel/RoadRunner-实战-Go驱动的PHP高性能应用服务器-对比Octane-Swoole-FrankenPHP进程模型与选型决策/)
- [Swoole 常驻内存踩坑深度剖析：全局变量污染、静态属性残留、连接泄漏——PHP-FPM 到 Octane 的思维模式迁移](/05_PHP/Laravel/swoole-resident-memory-pitfalls-deep-dive/)
