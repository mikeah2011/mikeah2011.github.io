---

title: PHP 生命周期与 SAPI
keywords: [PHP, SAPI, 生命周期与]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- SAPI
- FPM
- Swoole
- 性能优化
categories:
- php
date: 2021-04-18 10:00:00
description: 全面深入解析 PHP 生命周期的 5 个核心阶段（MINIT → RINIT → Execute → RSHUTDOWN → MSHUTDOWN），对比 CLI、PHP-FPM、Swoole、FrankenPHP、RoadRunner 五种 SAPI 架构差异与性能表现。涵盖 OPcache 原理与生产配置、JIT 编译优化、预加载机制，以及常驻内存模式下的状态管理与内存泄漏踩坑案例，帮助开发者根据业务场景选择最优运行时架构方案并做好 PHP 性能优化。
---


# 一句话

> **PHP 生命周期 = MINIT → RINIT → 执行 → RSHUTDOWN → MSHUTDOWN。**
> **CLI/CGI 模式**每个请求跑完整 5 步；**FPM 模式**只跑中间 3 步（M 阶段进程启动时跑一次）；**Swoole/Workerman** 更进一步，**只跑 1 步**。

# 五大阶段

| 阶段 | 触发时机 | 典型工作 |
|---|---|---|
| **MINIT** (Module Init) | 进程启动 | 加载扩展、注册类/函数/常量 |
| **RINIT** (Request Init) | 每个请求开始 | 初始化 `$_GET/$_POST/$_SESSION`、扩展请求级状态 |
| **Execute** | RINIT 之后 | 把 PHP 源码编译成 opcode 并执行 |
|| **RSHUTDOWN** | 请求结束 | 调注册的 shutdown 函数、清理临时变量 |
|| **MSHUTDOWN** | 进程退出 | 卸载扩展、释放永久内存 |
## 各阶段详细代码示例

### MINIT —— 扩展级初始化

MINIT 在进程启动时执行一次，通常在扩展的 C 代码中注册常量、类和函数：

```c
// C 扩展代码
PHP_MINIT_FUNCTION(myext) {
    // 注册持久化常量
    REGISTER_STRING_CONSTANT("MYEXT_VERSION", "1.0.0", CONST_CS | CONST_PERSISTENT);
    REGISTER_LONG_CONSTANT("MYEXT_MAX_CONN", 128, CONST_CS | CONST_PERSISTENT);

    // 注册 INI 配置项
    REGISTER_INI_ENTRIES();

    // 注册类和方法（持久化，跨请求共享）
    INIT_CLASS_ENTRY(ce, "MyExt\\Connection", myext_connection_methods);
    myext_connection_ce = zend_register_internal_class(&ce);

    return SUCCESS;
}
```

在用户态，可以通过 `phpinfo()` 查看 MINIT 阶段注册的扩展信息：

```bash
php -i | grep "Module Authors"
# 输出所有在 MINIT 阶段初始化的扩展
```

### RINIT —— 请求级初始化

RINIT 在每个请求开始前执行，适合初始化临时变量和请求级资源：

```c
PHP_RINIT_FUNCTION(myext) {
    // 每个请求重置计数器
    MYEXT_G(request_count) = 0;

    // 初始化请求级哈希表
    zend_hash_init(&MYEXT_G(request_data), 8, NULL, NULL, 0);

    return SUCCESS;
}
```

在用户态，`$_SERVER`、`$_GET`、`$_POST` 等超全局变量就是在 RINIT 阶段被填充的：

```php
// RINIT 之后才能访问这些变量
echo $_SERVER['REQUEST_METHOD'];  // GET
echo $_SERVER['REQUEST_URI'];     // /api/users

// 这也是为什么某些扩展的钩子必须在 RINIT 中注册
register_shutdown_function(function () {
    // 这个函数会在 RSHUTDOWN 阶段执行
});
```

### Execute —— 编译与执行

Execute 阶段是性能关键路径，PHP 引擎会经历以下子步骤：

```
源代码 (.php)
    ↓ 词法分析（Tokenizer）
Token 流
    ↓ 语法分析
抽象语法树（AST）
    ↓ 编译
Opcode 数组
    ↓ Zend VM 执行
结果输出
```

```php
// 查看一段代码编译后的 opcode
echo opcache_get_status()['opcache_statistics']['num_cached_scripts'];

// 使用 vld 扩展查看 opcode（需安装）
// php -d vld.active=1 -d vld.execute=0 script.php
// 输出类似：
// line     # *  op                           return          ops
// -------+------------------------------------+---------------+-------
//    1    0  E6 EXT_STMT                                  ~0
//    1    1  E7 INCLUDE_OR_EVAL                          >0
//    3    2  E0 ECHO                                     ~1      'hello'
```

### RSHUTDOWN —— 请求级清理

```c
PHP_RSHUTDOWN_FUNCTION(myext) {
    // 销毁请求级哈希表
    zend_hash_destroy(&MYEXT_G(request_data));

    // 重置计数器
    MYEXT_G(request_count) = 0;

    return SUCCESS;
}
```

```php
// 用户态的 RSHUTDOWN 钩子
register_shutdown_function(function () {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR])) {
        error_log("[FATAL] {$error['message']} in {$error['file']}:{$error['line']}");
    }

    // 写入请求日志
    $duration = microtime(true) - $_SERVER['REQUEST_TIME_FLOAT'];
    file_put_contents('/tmp/php-requests.log',
        date('c') . ' ' . ($_SERVER['REQUEST_URI'] ?? 'CLI') . ' ' . round($duration * 1000, 1) . "ms\n",
        FILE_APPEND
    );
});
```

### MSHUTDOWN —— 进程级清理

MSHUTDOWN 只在进程退出时执行，用于释放全局资源：

```c
PHP_MSHUTDOWN_FUNCTION(myext) {
    // 关闭持久化连接
    myext_close_all_connections();

    // 释放全局内存
    zend_hash_destroy(&MYEXT_G(global_cache));

    // 取消注册的 INI 条目
    UNREGISTER_INI_ENTRIES();

    return SUCCESS;
}
```

# CLI vs FPM vs Swoole

## CLI（每次都完整 5 步）

```bash
php script.php
```

- 启动：MINIT → RINIT → Execute → RSHUTDOWN → MSHUTDOWN → 退出
- **慢** —— 每跑一次都要重新加载扩展、解析 INI、编译 opcode

## FPM（M 步只跑一次）

```
[启动]   MINIT
[请求1]  RINIT → Execute → RSHUTDOWN
[请求2]  RINIT → Execute → RSHUTDOWN
...
[退出]   MSHUTDOWN
```

- worker 进程常驻，处理 N 个请求才退出（`pm.max_requests`）
- 配合 OPcache，opcode 缓存，**编译只发生一次**

## Swoole / Workerman（M+R 都只跑一次）

```
[启动]   MINIT → RINIT → 业务初始化（$app = new Application()）
[请求1]  -> handle($req)
[请求2]  -> handle($req)
...
```

- 全程在内存里，**没有 RINIT/RSHUTDOWN 开销**
- 框架（Hyperf / EasySwoole）启动时就把容器、路由、ORM 全部初始化好
- **代价**：得自己处理状态污染、内存泄漏、协程上下文

## FrankenPHP（基于 Go 嵌入 PHP）

FrankenPHP 是用 Go 写的 PHP 运行时，通过 Go 的 `embed` 机制嵌入 PHP：

```go
package main

import (
    "github.com/dunglas/frankenphp"
)

func main() {
    frankenphp.Start()
}
```

```
[启动]   MINIT → RINIT → 业务初始化（Go 协程 + PHP 混合）
[请求1]  -> Go handler → PHP worker script
[请求2]  -> Go handler → PHP worker script
...
```

- 兼容传统 PHP-FPM 配置，**零迁移成本**
- 利用 Go 的 goroutine 处理并发，HTTP/2 和 HTTP/3 原生支持
- 内建 HTTPS 和 metrics，不需要 Nginx/Caddy
- **代价**：Go + PHP 双栈调试、部分扩展兼容性

# 一个请求里发生的事（FPM）

1. **Nginx** 接到请求，通过 fastcgi 协议把请求转给 PHP-FPM master
2. **FPM master** 派给空闲 worker（或新建）
3. worker 跑 **RINIT**：填 `$_SERVER` `$_GET` `$_POST`，扩展级 hook
4. worker 编译 PHP 文件 → opcode（OPcache 命中则跳过）
5. **执行 opcode**，业务代码跑起来
6. 输出 buffer → fastcgi 回 Nginx
7. **RSHUTDOWN**：执行注册的 `register_shutdown_function`、释放变量
8. worker 回到空闲，等下一个请求；处理够 `max_requests` 后退出

# 性能影响最大的几点

| 优化点 | 提升倍数 | 说明 |
|---|---|---|
| 开 **OPcache** | 2-5x | 没有它每个请求都重新编译，直接砍 60% 性能 |
| `opcache.validate_timestamps=0`（生产） | +10-20% | 不再 stat 文件检查改动 |
| 用 **FPM + 长连接 PDO** | +30% | 比 CLI 模式快得多 |
| 切到 **Swoole / RoadRunner** | 5-10x | 跳过 R 阶段，常驻内存 |
| **预加载（PHP 7.4+ preload）** | +5-10% | MINIT 时就编译好核心类 |

# SAPI 是什么

> **SAPI (Server API)** = PHP 与外部环境对接的抽象层。CLI、FPM、Apache mod_php、Swoole 都各有自己的 SAPI。

```bash
php -r 'echo php_sapi_name();'
# cli
```

写扩展或框架时，常需要 `if (php_sapi_name() === 'cli')` 判断当前模式。

# 生命周期完整流程图

```
                    ┌─────────────────────────────────────────┐
                    │            PHP 进程生命周期              │
                    └─────────────────────────────────────────┘

  CLI 模式（每次完整 5 步）:
  ┌──────┐   ┌──────┐   ┌─────────┐   ┌───────────┐   ┌─────────┐
  │MINIT │──▶│RINIT │──▶│ Execute │──▶│RSHUTDOWN  │──▶│MSHUTDOWN│
  └──────┘   └──────┘   └─────────┘   └───────────┘   └─────────┘
    加载扩展    填超全局变量   编译+执行opcode  清理请求变量   卸载扩展
    注册类/函数  初始化会话     运行业务代码    shutdown函数  释放永久内存
    解析INI     设置$_SERVER               释放临时资源   关闭连接

  FPM 模式（MINIT/MSHUTDOWN 只跑一次）:
  ┌──────┐
  │MINIT │  ← 进程启动时执行一次
  └──┬───┘
     ▼
  ┌──────┐   ┌─────────┐   ┌───────────┐  ← 循环 N 个请求
  │RINIT │──▶│ Execute │──▶│RSHUTDOWN  │
  └──────┘   └─────────┘   └───────────┘
     ▲           ...重复...        │
     └─────────────────────────────┘
                                  max_requests 后退出
  ┌───────────┐
  │MSHUTDOWN  │  ← 进程退出时执行一次
  └───────────┘

  Swoole 模式（MINIT + RINIT 只跑一次）:
  ┌──────┐   ┌──────┐   ┌─────────────────────┐
  │MINIT │──▶│RINIT │──▶│ 业务初始化          │
  └──────┘   └──────┘   │ $app = new App()    │
                         │ 注册路由/中间件/ORM  │
                         └─────────┬───────────┘
                                   ▼
                         ┌──────────────────┐  ← 循环处理
                         │  handle($request)│
                         └──────────────────┘
                                   ▲
                                   │ 协程调度
                                   ▼
                         ┌──────────────────┐
                         │  handle($request)│
                         └──────────────────┘
```

# 各模式详细对比

| 维度 | CLI | FPM | Swoole/RoadRunner |
---|---|---|---|
| MINIT 频率 | 每次 | 进程启动时 1 次 | 启动时 1 次 |
| RINIT 频率 | 每次 | 每请求 1 次 | 启动时 1 次 |
| 编译开销 | 每次重新编译 | OPcache 缓存 | 启动时编译完成 |
| 内存模型 | 用完即释放 | 请求间隔离 | 常驻内存，需手动清理 |
| 全局变量 | 安全（每次重建） | 安全（请求隔离） | ⚠️ 有状态污染风险 |
| 连接复用 | ❌ | PDO 持久连接 | 内建连接池 |
| 适合场景 | 脚本/命令行 | Web 请求 | 高并发 API/WebSocket |
| 典型 QPS | ~100 | ~1000 | ~10,000+ |

# 四大常驻内存运行时横向对比：PHP-FPM vs FrankenPHP vs Swoole vs RoadRunner

| 维度 | PHP-FPM | FrankenPHP | Swoole | RoadRunner |
|---|---|---|---|---|
| **语言** | C | Go + C | C++ | Go + C |
| **进程模型** | prefork (master + workers) | goroutine 协程 | 事件循环 + 协程 | goroutine + worker 进程 |
| **PHP 扩展兼容** | ✅ 全部 | ⚠️ 大部分（无 ZTS 限制） | ⚠️ 非协程安全的不兼容 | ⚠️ 需要 PSR 接口适配 |
| **Nginx 依赖** | 必须 | ❌ 内建 HTTP/HTTPS | ❌ 内建 HTTP Server | ❌ 内建 HTTP Server |
| **HTTP/2 & HTTP/3** | ❌ | ✅ 原生支持 | ⚠️ 需配合 Nginx | ⚠️ 需配合 Nginx |
| **Laravel 兼容** | ✅ 开箱即用 | ✅ 兼容 FPM 配置 | ⚠️ 需 Laravel Octane | ⚠️ 需 Laravel RoadRunner 包 |
| **内存占用** | 高（每个 worker 独立） | 中（Go runtime + PHP） | 低（单进程多协程） | 中（Go runtime + worker） |
| **调试难度** | ⭐ 容易 | ⭐⭐⭐ 需了解 Go | ⭐⭐ 协程栈追踪难 | ⭐⭐ 需了解 Go |
| **热重载** | ❌ 重启 FPM | ✅ Go 热编译 | ✅ reload 信号 | ✅ reload 信号 |
| **生产稳定性** | ⭐⭐⭐⭐⭐ 20+ 年 | ⭐⭐ 较新 | ⭐⭐⭐⭐ 成熟 | ⭐⭐⭐ 逐步成熟 |
| **典型 QPS (4C8G)** | ~3,000 | ~8,000 | ~15,000 | ~12,000 |
| **学习成本** | 低 | 中（Go + PHP） | 中（协程思维） | 中（Go + PSR） |
| **适合场景** | 传统 Web、兼容性优先 | 现代 API、需要 HTTP/3 | 高并发 WebSocket/RPC | 微服务、gRPC |

> **选型建议**：
> - **追求稳定 + 兼容性** → PHP-FPM（不会出错的选择）
> - **新项目 + 不想依赖 Nginx** → FrankenPHP（开箱即用，兼容 FPM 配置）
> - **极高并发 + WebSocket** → Swoole（协程模型性能天花板最高）
> - **微服务 + gRPC** → RoadRunner（Go 原生支持 gRPC，worker 模式灵活）

# 扩展开发者视角：MINIT vs RINIT

写 PHP 扩展时，选择在哪注册资源很关键：

```c
// MINIT：进程级初始化，只执行一次
PHP_MINIT_FUNCTION(myext) {
    // 注册类、常量、INI 条目
    REGISTER_LONG_CONSTANT("MYEXT_VERSION", 1, CONST_CS | CONST_PERSISTENT);
    return SUCCESS;
}

// RINIT：请求级初始化，每个请求执行一次
PHP_RINIT_FUNCTION(myext) {
    // 初始化请求级资源（数据库连接、临时变量）
    // 这里分配的内存会在 RSHUTDOWN 自动释放
    MYEXT_G(request_count) = 0;
    return SUCCESS;
}
```

**经验法则**：
- 注册类/函数/常量 → `MINIT`
- 初始化请求级状态（计数器、临时缓存）→ `RINIT`
- 清理请求级资源 → `RSHUTDOWN`
- 释放持久资源（数据库连接池）→ `MSHUTDOWN`

# OPcache 与生命周期的关系

```
         没有 OPcache                      有 OPcache
         ──────────                        ──────────
请求1:   读文件 → 词法分析 → 编译 → 执行    读文件 → 缓存未命中 → 编译 → 执行 → 存缓存
请求2:   读文件 → 词法分析 → 编译 → 执行    从缓存直接取 opcode → 执行（跳过编译）
请求3:   读文件 → 词法分析 → 编译 → 执行    从缓存直接取 opcode → 执行（跳过编译）
...
```

OPcache 的配置直接影响性能：

```ini
; 生产环境推荐
opcache.enable=1
opcache.memory_consumption=256          ; 共享内存大小(MB)
opcache.validate_timestamps=0           ; 不检查文件修改（部署时手动清除）
opcache.jit=1255                        ; PHP 8.0+ JIT 模式
opcache.preload=/path/to/preload.php    ; 7.4+ 预加载核心类
```

> **注意**：`validate_timestamps=0` 后，每次部署必须 `opcache_reset()` 或重启 FPM，否则改动不生效。

## OPcache 与各阶段的交互细节

OPcache 的生命周期管理是理解 PHP 性能的关键：

```
┌───────────────────────────────────────────────────────────────┐
│                      OPcache 内存布局                          │
├───────────────────────────────────────────────────────────────┤
│  Shared Memory (opcache.memory_consumption)                  │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────────┐    │
│  │ Script Cache │ │ String Intern│ │ File timestamps    │    │
│  │ (opcode 索引) │ │ (字符串池)   │ │ (修改时间记录)      │    │
│  └─────────────┘ └──────────────┘ └────────────────────┘    │
├───────────────────────────────────────────────────────────────┤
│  JIT Buffer (opcache.jit_buffer_size)                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ JIT compiled native code (热点函数机器码)              │    │
│  └──────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

**OPcache 在各阶段的行为**：

| 阶段 | OPcache 行为 | 说明 |
|---|---|---|
| **MINIT** | 加载 OPcache 共享内存 | 从磁盘恢复缓存的 script 目录 |
| **RINIT** | 无操作 | OPcache 不参与请求级初始化 |
| **Execute** | 命中缓存 → 直接执行 opcode | 未命中 → 编译后写入共享内存 |
| **RSHUTDOWN** | 无操作 | 脚本 opcode 不会被清除 |
| **MSHUTDOWN** | 刷新元数据到磁盘 | 可选：将缓存持久化到磁盘 |

```php
// 查看 OPcache 状态（需要 opcache.get_status=1）
$status = opcache_get_status(false);

echo "缓存脚本数: " . $status['opcache_statistics']['num_cached_scripts'] . "\n";
echo "命中率: " . $status['opcache_statistics']['opcache_hit_rate'] . "%\n";
echo "内存使用: " . $status['memory_usage']['used_memory'] / 1024 / 1024 . "MB\n";
echo "可用内存: " . $status['memory_usage']['free_memory'] / 1024 / 1024 . "MB\n";

// 手动触发 OPcache 重新编译（部署后使用）
opcache_reset();                          // 清空所有缓存
opcache_invalidate('/path/to/script.php'); // 清空单个文件
```

**OPcache + JIT 与生命周期的关系**：

```
请求流程中的 JIT 编译路径：
                                                    
RINIT → Execute                                     
          ↓                                         
     脚本已编译？──Yes──▶ 执行 opcode               
          │                                         
          No                                        
          ↓                                         
     词法分析 → AST → Opcode 编译 → 存入缓存        
                          ↓                         
                 JIT 分析热点函数                    
                          ↓                         
              生成机器码 → 存入 JIT buffer           
                          ↓                         
                    执行机器码（最快路径）             
```

> **最佳实践**：生产环境 `opcache.jit=1255`（tracing JIT）配合 `opcache.jit_buffer_size=128M`，
> 可在热循环中获得接近 C 语言的执行速度。

# 实战：利用生命周期做请求级监控

```php
<?php
// 在 RINIT 阶段记录开始时间
register_shutdown_function(function () {
    $mem = memory_get_peak_usage(true);
    $time = (microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']) * 1000;

    // 写入监控日志
    error_log(sprintf(
        '[PERF] %s %s | %.1fms | %s',
        $_SERVER['REQUEST_METHOD'] ?? 'CLI',
        $_SERVER['REQUEST_URI'] ?? $_SERVER['argv'][1] ?? '-',
        $time,
        $this->formatBytes($mem)
    ));
});
```

# 调试小技巧

```php
// 把 RSHUTDOWN 阶段的执行打印出来
register_shutdown_function(function () {
    echo "请求结束，内存峰值：" . memory_get_peak_usage(true) . "\n";
});
```

# 踩坑案例：生命周期引发的真实问题

## 案例 1：FPM 全局变量状态泄漏

```php
<?php
// ❌ 危险：全局变量在 FPM worker 复用时不会自动清理
global $userCache;

// 第一个请求设置了用户信息
$userCache = ['name' => '张三', 'role' => 'admin'];

// 如果 worker 处理第二个请求时没有重新初始化 $userCache
// 第二个请求会读到第一个请求的数据！
echo $userCache['name']; // 意外输出 "张三"
```

**修复方案**：

```php
<?php
// ✅ 在 register_shutdown_function 中清理
register_shutdown_function(function () {
    global $userCache;
    $userCache = null;  // 确保每个请求结束后清理
});

// ✅ 更好的方案：使用静态变量而非全局变量
class UserService {
    private static ?array $cache = null;

    public static function reset(): void {
        self::$cache = null;
    }
}

// 在请求开始时重置
UserService::reset();
```

## 案例 2：Swoole 协程中的数据库连接泄漏

```php
<?php
// ❌ Swoole 协程中直接使用 PDO 会阻塞整个进程
$pdo = new PDO('mysql:host=db;dbname=test', 'root', 'pass');
// 这个 PDO 连接会阻塞当前协程，影响其他协程的执行

// 一个慢查询会导致所有协程卡住
$pdo->query('SELECT * FROM large_table'); // 阻塞 5 秒
```

**修复方案**：

```php
<?php
// ✅ 使用 Swoole 协程客户端
use Swoole\Coroutine\MySQL;

 Coroutine\run(function () {
    $db = new MySQL();
    $db->connect([
        'host' => 'db',
        'user' => 'root',
        'password' => 'pass',
        'database' => 'test',
    ]);

    // 协程非阻塞，其他协程可以继续执行
    $result = $db->query('SELECT * FROM users WHERE id = 1');
    echo $result[0]['name'];
});

// ✅ 或使用 Swoole 连接池
$pool = new Swoole\Coroutine\Channel(10);
for ($i = 0; $i < 10; $i++) {
    $pool->push(new MySQL($dbConfig));
}
```

## 案例 3：OPcache 导致代码更新不生效

```php
<?php
// 生产环境 opcache.validate_timestamps=0
// 部署新代码后，用户看到的还是旧代码！

// ❌ 错误：只更新了文件，没有清除 OPcache
// scp -r ./src/* /var/www/html/

// ✅ 正确：部署后必须清除 OPcache
// 方案 1：重启 FPM
system('systemctl restart php-fpm');

// 方案 2：调用 opcache_reset()（需要 opcache.get_status=1）
opcache_reset();

// 方案 3：CI/CD 中加入清除步骤
// deployment.sh
opcache_invalidate('/var/www/html/config/app.php');
```

## 案例 4：持久连接导致内存无限增长

```php
<?php
// ❌ 持久连接在 FPM 中可能造成内存泄漏
$pdo = new PDO(
    'mysql:host=db;dbname=test',
    'root',
    'pass',
    [PDO::ATTR_PERSISTENT => true]  // 连接不会在 RSHUTDOWN 时关闭
);

// 如果连接池管理不当，worker 内存会持续增长
// 特别是在使用 ORM 时，实体管理器可能持有大量引用
```

**修复方案**：

```php
<?php
// ✅ 监控持久连接数
$status = $pdo->getAttribute(PDO::ATTR_SERVER_INFO);
// 检查 "Threads_connected" 值

// ✅ 在 FPM 配置中限制最大请求数
// /etc/php-fpm.d/www.conf
// pm.max_requests = 1000  ← 每个 worker 处理 1000 个请求后重启

// ✅ 设置内存限制
// php.ini
// memory_limit = 128M
```

## 案例 5：Swoole 中 require/include 的缓存问题

```php
<?php
// ❌ 在 Swoole 常驻内存模式中，require 的文件会被缓存
// 如果文件修改后没有重启，新代码不会生效

// 传统 PHP-FPM：每个请求重新加载文件
require 'config.php';  // 每次请求都会重新读取

// Swoole 模式：require 只执行一次
require 'config.php';  // 只在启动时加载一次
```

**修复方案**：

```php
<?php
// ✅ 使用 opcache_invalidate() 强制重新加载
function reloadConfig(): void {
    $configPath = __DIR__ . '/config.php';
    opcache_invalidate($configPath, true);
    return require $configPath;
}

// ✅ 或使用文件监控（开发环境）
Swoole\Coroutine::create(function () {
    $watcher = new Swoole\FileSystem\Monitor('/config');
    $watcher->watch(function ($event) {
        echo "Config file changed: {$event['path']}\n";
        // 重新加载配置
    });
});
```

## 相关阅读

- [PHP 版本区别](/categories/PHP/vs-php/)
- [OPcache 深度实战](/categories/PHP/opcache-1/)
- [PHP 依赖注入（DI）与 IoC 容器](/categories/PHP/dependency-injection/)
- [进程、线程和协程](/categories/PHP/vs/)
- [高性能 PHP-FPM 与 Swoole 深度实战](/categories/PHP/Runtime/swoole/)
- [PHP OPcache JIT 联合调优实战](/categories/PHP/PHP-OPcache-JIT-联合调优实战-JIT-buffer预热-opcache.jit参数组合与生产环境性能基准/)

# 参考

- PHP 手册 - 生命周期: <https://www.php.net/manual/zh/internals2.structure.php>
- Swoole 文档: <https://wiki.swoole.com/>
- 鸟哥（Laruence）博客: <https://www.laruence.com/>
