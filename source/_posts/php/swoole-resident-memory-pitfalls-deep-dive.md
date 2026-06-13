---

title: Swoole 常驻内存踩坑深度剖析：全局变量污染、静态属性残留、连接泄漏——PHP-FPM 到 Octane 的思维模式迁移
keywords: [Swoole, PHP, FPM, Octane, 常驻内存踩坑深度剖析, 全局变量污染, 静态属性残留, 连接泄漏, 的思维模式迁移]
date: 2026-06-04 08:00:00
description: 深入剖析 Swoole 驻留内存模型下的常见内存泄漏陷阱，涵盖全局变量污染、静态属性残留、数据库与 Redis 连接池泄漏、协程上下文污染等核心问题。从 PHP-FPM 请求级生命周期迁移到 Swoole 常驻内存模式，系统讲解内存泄漏检测代码、GC 回收策略、Laravel Octane 请求隔离机制，附完整排查工具链与生产环境最佳实践 Checklist，助你建立正确的协程编程思维模式。
tags:
- Swoole
- Laravel Octane
- 常驻内存
- 高并发
- PHP Performance
- 内存泄漏
- 协程
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---




# Swoole 常驻内存踩坑深度剖析：全局变量污染、静态属性残留、连接泄漏——PHP-FPM 到 Octane 的思维模式迁移

## 引言：一次凌晨三点的报警

凌晨三点，手机连续震动把你从梦中惊醒。线上告警系统疯狂刷屏：数据库连接数爆满、Redis 连接超时、用户反馈页面加载缓慢甚至 502。你第一时间登上服务器，发现 Swoole Worker 进程的内存占用从启动时的 50MB 疯涨到 800MB，数据库连接池早已溢出，而这一切仅仅发生在上线后不到 48 小时。

这不是虚构的场景，而是无数从 PHP-FPM 迁移到 Swoole / Laravel Octane 的团队在生产环境中遭遇过的真实噩梦。

问题的根源在于：**PHP-FPM 的"请求即一生"模型在开发者脑中已经根深蒂固，而 Swoole 的"常驻内存"模型要求一种完全不同的编程范式**。许多 PHP 开发者在使用 Swoole 或 Laravel Octane 时，仍然沿用 PHP-FPM 时代的编程习惯，最终在生产环境中付出惨痛代价。

本文将从底层原理出发，结合真实代码示例，系统性地剖析 Swoole 常驻内存模型下最常见的三大类问题——**全局变量污染、静态属性残留、连接泄漏**，并给出完整的排查工具链和最佳实践 Checklist。无论你是正在评估 Swoole 的技术选型者，还是已经在使用 Laravel Octane 的开发者，这篇文章都将帮助你建立正确的"常驻内存思维模式"。

---

## 第一章：PHP-FPM vs Swoole——两种截然不同的生命周期模型

### 1.1 PHP-FPM：请求级生命周期——"生如夏花，死如秋叶"

在传统的 PHP-FPM 模型中，每个 HTTP 请求都经历一个完整的生命周期：

```
Worker 进程启动 → 接收请求 → 引导框架（Bootstrap）→ 处理业务逻辑 → 返回响应 → 释放所有资源 → Worker 空闲等待下一个请求
```

关键特性：**请求结束后，PHP 会释放该请求期间分配的所有内存**。包括：
- 所有局部变量
- 所有全局变量
- 数据库连接
- Redis 连接
- 文件句柄
- 单例对象实例

```php
// PHP-FPM 下这段代码完全没问题
class UserService
{
    private static $currentUser = null;

    public function setUser(User $user): void
    {
        self::$currentUser = $user;
    }

    public function getCurrentUser(): ?User
    {
        return self::$currentUser;
    }
}

// 请求 A 进来，设置 currentUser 为 User_A
// 请求 B 进来——看到的是一个全新的进程，currentUser 是 null
// 因为 PHP-FPM 会在请求结束时重置整个环境
```

在 PHP-FPM 下，上面的代码毫无问题，因为每个请求都在一个相对干净的环境中执行。即使请求结束后 Worker 进程被复用，PHP 也会通过 `request_shutdown` 阶段清理大部分状态。

### 1.2 Swoole：常驻内存模型——"生命不息，状态永存"

Swoole 采用完全不同的架构：

```
Master 进程启动 → Fork Worker 进程 → Worker 启动（仅一次）→ 循环接收请求 → 处理业务逻辑 → 返回响应 → 回到循环等待下一个请求
```

**关键区别：Worker 进程启动后常驻内存，不会在请求结束后退出。** 这意味着：

```php
// Swoole 下这段代码就是定时炸弹！
class UserService
{
    private static $currentUser = null;

    public function setUser(User $user): void
    {
        self::$currentUser = $user;
    }

    public function getCurrentUser(): ?User
    {
        return self::$currentUser;
    }
}

// 请求 A 进来，设置 currentUser 为 User_A（id=1001）
// 请求 A 结束后，$currentUser 依然持有 User_A 的引用！
// 请求 B 进来，调用 getCurrentUser() → 返回的是 User_A！！！
// 这是严重的数据污染！用户 B 看到了用户 A 的数据！
```

这就是常驻内存模型带来的根本性变化：**变量的生命周期不再等于请求的生命周期，而是等于 Worker 进程的生命周期**。一个 Swoole Worker 可能处理数万甚至数十万个请求才会重启，这意味着任何被污染的状态都会在所有后续请求中持续存在。

### 1.3 一张表看懂核心差异

| 维度 | PHP-FPM | Swoole / Octane |
|------|---------|-----------------|
| 进程生命周期 | 请求级（处理完即释放） | 常驻（Worker 启动后持续运行） |
| 变量作用域 | 请求隔离（天然安全） | Worker 级（跨请求共享） |
| 单例对象 | 每请求重建 | 整个 Worker 生命周期共享 |
| 静态属性 | 每请求重置 | 跨请求累积 |
| 数据库连接 | 请求结束自动释放 | 需要手动管理连接池 |
| 全局状态 | 请求结束后清理 | 永久保留直到 Worker 重启 |
| 内存泄漏影响 | 有限（请求结束即回收） | 累积性（随请求数增长） |

理解了这层本质差异，我们就能开始深入分析具体的问题场景。

---

## 第二章：全局变量污染——静默的数据杀手

### 2.1 问题根因：全局变量的"跨请求记忆"

在 Swoole 环境中，任何在 Worker 级别声明或初始化的变量，都会在请求之间共享。这不是 Swoole 的 bug，而是常驻内存模型的固有特性。

```php
// 一个看似无害的辅助函数
$currentUser = null;

function setCurrentUser($user) {
    global $currentUser;
    $currentUser = $user;
}

function getCurrentUser() {
    global $currentUser;
    return $currentUser;
}

// 在 Swoole Worker 中处理请求
$http = new Swoole\Http\Server('0.0.0.0', 9501);

$http->on('request', function ($request, $response) {
    // 请求 A：登录用户是 admin
    setCurrentUser(['id' => 1, 'name' => 'admin']);
    
    // 处理业务逻辑...
    $user = getCurrentUser();
    
    // 注意：请求结束后，$currentUser 依然是 ['id' => 1, 'name' => 'admin']
    // 请求 B 进来时，如果没有调用 setCurrentUser，getCurrentUser() 返回的是上一个用户！
    
    $response->end("Hello " . $user['name']);
});

$http->start();
```

### 2.2 真实场景：日志上下文污染

这是一个在生产环境中非常常见的问题。很多日志库允许设置全局上下文：

```php
// 使用 Monolog 的 ProcessableTrait 或自定义日志类
class RequestLogger
{
    private static array $context = [];

    public static function setContext(string $key, $value): void
    {
        self::$context[$key] = $value;
    }

    public static function log(string $message, string $level = 'info'): void
    {
        $logger = app('log');
        $logger->$level($message, self::$context);
    }

    // 注意：这里没有清理机制！
    // 在 Swoole 中，$context 会在请求间累积
}

// 请求 A
RequestLogger::setContext('user_id', 1001);
RequestLogger::setContext('request_id', 'req-abc-001');
RequestLogger::log('User logged in');  // 包含 user_id=1001

// 请求 B（注意：没有重新设置 context）
RequestLogger::log('Processing payment');  // 输出中仍然包含 user_id=1001！
// 日志混入了上一个请求的用户信息，导致审计日志不准确
```

**修复方案：在请求开始时清理状态**

```php
class RequestLogger
{
    private static array $context = [];

    public static function setContext(string $key, $value): void
    {
        self::$context[$key] = $value;
    }

    public static function resetContext(): void
    {
        self::$context = [];
    }

    public static function log(string $message, string $level = 'info'): void
    {
        $logger = app('log');
        $logger->$level($message, self::$context);
    }
}

// 在 Swoole 的 onWorkerStart 或中间件中注册请求生命周期钩子
$http->on('request', function ($request, $response) {
    // 请求开始时清理上一个请求的状态
    RequestLogger::resetContext();
    
    try {
        // 处理请求...
        RequestLogger::setContext('user_id', $request->get['user_id'] ?? 'anonymous');
        RequestLogger::log('Request started');
        
        // ... 业务逻辑 ...
    } finally {
        // 请求结束时也清理
        RequestLogger::resetContext();
    }
    
    $response->end('OK');
});
```

### 2.3 超全局变量的风险

PHP 的超全局变量如 `$_SERVER`、`$_GET`、`$_POST`、`$_SESSION` 等在 Swoole 中也有特殊行为：

```php
// ❌ 危险做法：直接使用 $_SERVER
$http->on('request', function ($request, $response) {
    // Swoole 环境下，$_SERVER 不会自动填充请求信息
    // 如果你手动填充了 $_SERVER，它会在请求间保留
    $_SERVER['HTTP_X_REQUEST_ID'] = $request->header['x-request-id'] ?? uniqid();
    
    // 下一个请求进来时，$_SERVER 仍然包含上一个请求的 x-request-id
    $requestId = $_SERVER['HTTP_X_REQUEST_ID']; // 可能是旧的！
    
    $response->end('OK');
});

// ✅ 正确做法：始终使用 $request 对象
$http->on('request', function ($request, $response) {
    // Swoole 的 $request 对象是每次请求独立创建的
    $requestId = $request->header['x-request-id'] ?? uniqid();
    
    // 如果必须使用 $_SERVER，先清理再填充
    $_SERVER = [];
    $_SERVER['HTTP_X_REQUEST_ID'] = $requestId;
    
    $response->end('OK');
});
```

### 2.4 更隐蔽的陷阱：闭包和匿名函数捕获

```php
// 一个常见的中间件注册模式
$app = new SwooleCoroutine\Http\Server('0.0.0.0', 9501);

$middlewareStack = [];
$currentUser = null;

// 注册一个"认证中间件"
$middlewareStack[] = function ($request, $next) use (&$currentUser) {
    // 闭包通过引用捕获了 $currentUser
    $currentUser = authenticate($request);
    return $next($request);
};

// 处理函数
$handler = function ($request, $response) use (&$currentUser, $middlewareStack) {
    foreach ($middlewareStack as $middleware) {
        $result = $middleware($request, fn($req) => $req);
        if ($result === false) {
            $response->status(401);
            return $response->end('Unauthorized');
        }
    }
    
    // $currentUser 持有认证信息
    // 但如果某个请求的中间件未执行（如跳过认证的路由），
    // $currentUser 仍然指向上一个请求的用户！
    $response->end("Hello, " . ($currentUser['name'] ?? 'Guest'));
};

$app->on('request', $handler);
$app->start();
```

**正确做法：确保每个请求都有独立的状态容器**

```php
class RequestContext
{
    private static ?Context $current = null;

    public static function create(): Context
    {
        self::$current = new Context();
        return self::$current;
    }

    public static function get(): Context
    {
        if (self::$current === null) {
            throw new RuntimeException('Request context not initialized');
        }
        return self::$current;
    }

    public static function destroy(): void
    {
        self::$current = null;
    }
}

class Context
{
    public ?array $user = null;
    public string $requestId;
    public float $startTime;
    private array $data = [];

    public function __construct()
    {
        $this->requestId = uniqid('req-', true);
        $this->startTime = microtime(true);
    }

    public function set(string $key, mixed $value): void
    {
        $this->data[$key] = $value;
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->data[$key] ?? $default;
    }
}

// 使用
$http->on('request', function ($request, $response) {
    // 每个请求创建全新的 Context
    $ctx = RequestContext::create();
    
    try {
        $ctx->user = authenticate($request);
        $ctx->set('ip', $request->server['remote_addr']);
        
        // 业务逻辑中使用 RequestContext::get() 获取上下文
        $response->end("Hello, " . ($ctx->user['name'] ?? 'Guest'));
    } finally {
        // 请求结束销毁上下文
        RequestContext::destroy();
    }
});
```

---

## 第三章：静态属性残留——面向对象时代的隐性炸弹

### 3.1 单例模式的"永生"问题

在 PHP-FPM 时代，单例模式是 PHP 开发者最常用的设计模式之一。在 Swoole 环境中，单例变成了"永生"对象：

```php
// 一个典型的单例缓存管理器
class CacheManager
{
    private static ?CacheManager $instance = null;
    private array $localCache = [];
    private int $hits = 0;
    private int $misses = 0;

    public static function getInstance(): CacheManager
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function get(string $key, mixed $default = null): mixed
    {
        if (isset($this->localCache[$key])) {
            $this->hits++;
            return $this->localCache[$key];
        }
        $this->misses++;
        return $default;
    }

    public function set(string $key, mixed $value, int $ttl = 3600): void
    {
        $this->localCache[$key] = $value;
    }

    // 问题 1：localCache 永远不会过期，内存持续增长
    // 问题 2：hits/misses 统计是全局累积的，失去监控意义
    // 问题 3：没有提供清理机制
}
```

在 Swoole 中，这个 `CacheManager` 实例一旦创建就会在整个 Worker 生命周期内存在。`$localCache` 数组会随着请求不断增加，永远不会被 GC 回收。如果每个请求缓存 10 个 key，Worker 处理 10 万个请求后，缓存中就有 100 万个条目，即使这些数据早已过期。

### 3.2 更隐蔽的场景：Eloquent Model 的静态缓存

Laravel 的 Eloquent Model 使用了大量的静态属性来缓存表结构、关系定义等元数据。在 Octane 环境下，这些缓存行为可能会导致意想不到的问题：

```php
// Laravel Eloquent 内部机制（简化）
abstract class Model
{
    // 表结构缓存 - 这个是安全的（结构不变）
    protected static array $columnCache = [];
    
    // 事件监听器 - 这个在 Octane 中需要注意
    protected static array $dispatcher = null;
    
    // 全局作用域 - 这个在 Octane 中有严重隐患
    protected static array $globalScopes = [];
    
    // booted 状态标记
    protected static array $booted = [];
}
```

**一个真实的踩坑场景：动态修改全局作用域**

```php
// 一个订单查询的场景
class OrderController extends Controller
{
    public function index(Request $request)
    {
        // 根据用户角色动态添加全局作用域
        if ($request->user()->isVip()) {
            // ❌ 危险！这个全局作用域会影响所有后续请求的 Order 查询
            Order::addGlobalScope('vip_priority', function (Builder $query) {
                $query->orderBy('priority', 'desc');
            });
        }
        
        return Order::paginate(20);
    }
}

// 请求 A：VIP 用户访问 → 添加了 vip_priority 作用域
// 请求 B：普通用户访问 → Order 查询仍然带有 vip_priority 作用域！
// 因为 addGlobalScope 修改的是静态属性，对整个 Worker 生效
```

**修复方案：使用局部查询构建器而非全局作用域**

```php
class OrderController extends Controller
{
    public function index(Request $request)
    {
        $query = Order::query();
        
        // ✅ 使用局部查询条件，不影响其他请求
        if ($request->user()->isVip()) {
            $query->orderBy('priority', 'desc');
        }
        
        return $query->paginate(20);
    }
}
```

### 3.3 配置类和静态缓存的陷阱

```php
// 一个常见的"优化"：缓存配置到静态属性
class AppConfig
{
    private static array $cache = [];
    private static bool $loaded = false;

    public static function get(string $key, mixed $default = null): mixed
    {
        if (!self::$loaded) {
            self::$cache = config()->all();
            self::$loaded = true;
        }
        
        return data_get(self::$cache, $key, $default);
    }
    
    // ❌ 没有 reload 机制！
    // 如果你在后台修改了配置，这个 Worker 永远不会感知到！
    // 因为 $loaded = true 后就不会再读取配置了
}
```

**修复方案：添加失效机制**

```php
class AppConfig
{
    private static array $cache = [];
    private static bool $loaded = false;
    private static int $loadedAt = 0;
    private static int $ttl = 300; // 5 分钟过期

    public static function get(string $key, mixed $default = null): mixed
    {
        if (!self::$loaded || (time() - self::$loadedAt) > self::$ttl) {
            self::$cache = config()->all();
            self::$loaded = true;
            self::$loadedAt = time();
        }
        
        return data_get(self::$cache, $key, $default);
    }

    public static function invalidate(): void
    {
        self::$loaded = false;
        self::$cache = [];
    }
}
```

### 3.4 静态属性与垃圾回收的交互

在 Swoole 中，Worker 进程的 GC 行为也与 PHP-FPM 不同：

```php
// 这个类在 PHP-FPM 中不会造成内存泄漏，但在 Swoole 中会
class EventCollector
{
    private static array $events = [];

    public static function add(string $event, callable $handler): void
    {
        self::$events[$event][] = $handler;
    }

    public static function dispatch(string $event, mixed $data = null): void
    {
        foreach (self::$events[$event] ?? [] as $handler) {
            $handler($data);
        }
    }
}

// 在请求中注册事件处理器
EventCollector::add('user.created', function ($user) {
    // 这个闭包可能捕获了大量对象引用
    Mail::to($user)->send(new WelcomeMail($user));
});

// ❌ 问题：闭包引用链导致 GC 无法回收相关对象
// 且事件处理器会累积，最终导致内存溢出

// ✅ 修复：使用 WeakMap 或在请求结束时清理
class SafeEventCollector
{
    private static array $events = [];

    public static function add(string $event, callable $handler): void
    {
        self::$events[$event][] = $handler;
    }

    public static function dispatch(string $event, mixed $data = null): void
    {
        foreach (self::$events[$event] ?? [] as $handler) {
            $handler($data);
        }
    }

    public static function flush(string $event = null): void
    {
        if ($event === null) {
            self::$events = [];
        } else {
            unset(self::$events[$event]);
        }
    }
}

// 在请求结束时清理
$http->on('request', function ($request, $response) {
    try {
        // 注册事件处理器...
        EventCollector::add('user.created', function ($user) { /* ... */ });
        
        // 处理请求...
    } finally {
        // ✅ 请求结束时清理所有事件处理器
        SafeEventCollector::flush();
    }
});
```

---

## 第四章：连接泄漏——性能的慢性毒药

### 4.1 数据库连接泄漏：最常见也最致命

在 PHP-FPM 中，数据库连接在请求结束时会自动关闭。但在 Swoole 中，如果你不主动管理连接的生命周期，连接就会"永远"存在。

```php
// ❌ 最常见的错误写法
$http->on('request', function ($request, $response) {
    $pdo = new PDO(
        'mysql:host=127.0.0.1;dbname=myapp',
        'root',
        'password',
        [
            PDO::ATTR_PERSISTENT => true, // 持久连接，以为可以"复用"
        ]
    );
    
    $stmt = $pdo->query('SELECT * FROM users WHERE id = 1');
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    
    $response->end(json_encode($user));
    
    // $pdo 没有被显式关闭！
    // 虽然 PDO 有持久连接，但每次 new PDO() 会创建新的连接
    // Worker 处理 10000 个请求后，就有 10000 个数据库连接！
});
```

**问题分析：为什么持久连接也会泄漏？**

PDO 的持久连接（`PDO::ATTR_PERSISTENT => true`）在 PHP-FPM 中工作良好，因为：
1. FPM Worker 在请求结束后会调用 `request_shutdown`，清理非持久连接
2. 持久连接存储在进程级别的连接池中，后续请求可以复用

但在 Swoole 中：
1. 每次 `new PDO()` 都会尝试创建新连接（即使设置了持久连接标志）
2. 如果在协程环境中，PHP 底层的持久连接池管理可能失效
3. 最终导致连接数不断增长，直到数据库服务端拒绝新连接

### 4.2 正确的连接池实现

**方案一：使用 Laravel Octane 内置的连接管理**

```php
// config/octane.php
return [
    'database' => true, // 启用数据库连接自动管理
    // Octane 会在每个请求开始时重置数据库连接状态
    // 在请求结束时回收连接到连接池
];
```

**方案二：手动实现连接池**

```php
class DatabasePool
{
    private static array $pool = [];
    private static int $maxConnections = 20;
    private static array $config = [];

    public static function configure(array $config, int $maxConnections = 20): void
    {
        self::$config = $config;
        self::$maxConnections = $maxConnections;
    }

    public static function getConnection(): PDO
    {
        // 尝试从池中获取空闲连接
        foreach (self::$pool as $index => $info) {
            if ($info['in_use'] === false) {
                // 检查连接是否还活着
                try {
                    $info['connection']->query('SELECT 1');
                    self::$pool[$index]['in_use'] = true;
                    return $info['connection'];
                } catch (PDOException $e) {
                    // 连接已死，移除
                    unset(self::$pool[$index]);
                }
            }
        }

        // 池中没有可用连接，创建新的
        if (count(self::$pool) < self::$maxConnections) {
            $pdo = new PDO(
                self::$config['dsn'],
                self::$config['username'],
                self::$config['password'],
                self::$config['options'] ?? []
            );
            
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $pdo->setAttribute(PDO::ATTR_TIMEOUT, 5);
            
            $index = spl_object_id($pdo);
            self::$pool[$index] = [
                'connection' => $pdo,
                'in_use' => true,
                'created_at' => time(),
            ];
            
            return $pdo;
        }

        // 连接池已满，等待或抛出异常
        throw new RuntimeException('Database connection pool exhausted');
    }

    public static function release(PDO $connection): void
    {
        $index = spl_object_id($connection);
        if (isset(self::$pool[$index])) {
            self::$pool[$index]['in_use'] = false;
        }
    }

    public static function closeAll(): void
    {
        foreach (self::$pool as $info) {
            $info['connection'] = null; // 触发析构
        }
        self::$pool = [];
    }

    public static function stats(): array
    {
        $total = count(self::$pool);
        $inUse = count(array_filter(self::$pool, fn($info) => $info['in_use']));
        
        return [
            'total' => $total,
            'in_use' => $inUse,
            'idle' => $total - $inUse,
            'max' => self::$maxConnections,
        ];
    }
}
```

### 4.3 Redis 连接泄漏

Redis 连接泄漏是另一类常见问题，尤其在使用 `predis/predis` 库时：

```php
// ❌ 每次请求都创建新的 Redis 连接
$http->on('request', function ($request, $response) {
    $redis = new Predis\Client([
        'scheme' => 'tcp',
        'host'   => '127.0.0.1',
        'port'   => 6379,
    ]);
    
    $redis->set('key:' . $request->get['id'], 'value');
    $result = $redis->get('key:' . $request->get['id']);
    
    $response->end($result);
    
    // $redis 没有显式关闭
    // 虽然 PHP 的 __destruct 会尝试关闭连接
    // 但在 Swoole 中，对象的析构时机不确定
});

// ✅ 正确做法：使用单例连接或连接池
class RedisManager
{
    private static ?Predis\Client $client = null;
    private static int $lastUsed = 0;
    private static int $maxIdleTime = 300; // 5 分钟空闲后重建连接

    public static function getClient(): Predis\Client
    {
        $now = time();
        
        // 检查连接是否需要重建
        if (self::$client !== null && ($now - self::$lastUsed) > self::$maxIdleTime) {
            try {
                self::$client->ping(); // 测试连接是否还活着
            } catch (Exception $e) {
                // 连接已死，重建
                self::$client = null;
            }
        }
        
        if (self::$client === null) {
            self::$client = new Predis\Client([
                'scheme' => 'tcp',
                'host'   => config('database.redis.default.host'),
                'port'   => config('database.redis.default.port'),
                'password' => config('database.redis.default.password'),
            ]);
        }
        
        self::$lastUsed = $now;
        return self::$client;
    }

    public static function close(): void
    {
        if (self::$client !== null) {
            self::$client->disconnect();
            self::$client = null;
        }
    }
}
```

### 4.4 协程环境下的连接问题

在 Swoole 协程模式下，连接管理变得更加复杂：

```php
// Swoole 协程模式下的连接问题
use Swoole\Coroutine;
use Swoole\Coroutine\MySQL;

$http = new Swoole\Http\Server('0.0.0.0', 9501);
$http->set([
    'worker_num' => 4,
    'task_worker_num' => 2,
]);

// ❌ 在 Worker 级别创建连接，协程间共享
$sharedMysql = new MySQL();
$sharedMysql->connect([
    'host' => '127.0.0.1',
    'port' => 3306,
    'user' => 'root',
    'password' => 'password',
    'database' => 'myapp',
]);

$http->on('request', function ($request, $response) use ($sharedMysql) {
    // ❌ 多个协程可能同时使用同一个连接！
    // MySQL 协议不是多路复用的，会导致数据混乱
    $result = $sharedMysql->query('SELECT * FROM users WHERE id = ' . $request->get['id']);
    
    $response->end(json_encode($result));
});

// ✅ 正确做法：每个协程使用独立连接
$http->on('request', function ($request, $response) {
    // 协程内创建连接
    $mysql = new MySQL();
    $connected = $mysql->connect([
        'host' => '127.0.0.1',
        'port' => 3306,
        'user' => 'root',
        'password' => 'password',
        'database' => 'myapp',
    ]);
    
    if (!$connected) {
        $response->status(500);
        $response->end('Database connection failed');
        return;
    }
    
    try {
        $result = $mysql->query('SELECT * FROM users WHERE id = ' . intval($request->get['id']));
        $response->end(json_encode($result));
    } finally {
        // ✅ 协程结束前关闭连接
        $mysql->close();
    }
});
```

更优雅的方案是使用 `Swoole\Coroutine\Channel` 实现协程连接池：

```php
use Swoole\Coroutine\Channel;

class CoroutineMySQLPool
{
    private Channel $pool;
    private array $config;
    private int $size;

    public function __construct(array $config, int $size = 10)
    {
        $this->config = $config;
        $this->size = $size;
        $this->pool = new Channel($size);
        
        // 预创建连接
        for ($i = 0; $i < $size; $i++) {
            $this->pool->push($this->createConnection());
        }
    }

    private function createConnection(): MySQL
    {
        $mysql = new MySQL();
        $connected = $mysql->connect($this->config);
        if (!$connected) {
            throw new RuntimeException("MySQL connect failed: {$mysql->connect_error}");
        }
        return $mysql;
    }

    public function get(): MySQL
    {
        $conn = $this->pool->pop(5.0); // 最多等待 5 秒
        if ($conn === false) {
            throw new RuntimeException('Connection pool exhausted');
        }
        
        // 检查连接是否还活着
        if (!$conn->connected) {
            $conn = $this->createConnection();
        }
        
        return $conn;
    }

    public function put(MySQL $conn): void
    {
        if ($conn->connected) {
            $this->pool->push($conn);
        }
        // 连接已断开则丢弃，不放回池中
    }

    public function close(): void
    {
        while (!$this->pool->isEmpty()) {
            $conn = $this->pool->pop(0.1);
            if ($conn && $conn->connected) {
                $conn->close();
            }
        }
    }
}
```

---

## 第五章：Laravel Octane 的 Worker 生命周期与请求隔离

### 5.1 Octane 的架构概览

Laravel Octane 是 Laravel 官方推出的高性能服务器方案，它底层支持 Swoole 和 RoadRunner。Octane 的核心思想是：**将 Laravel 应用"热加载"到 Worker 进程中，避免每次请求都重新引导框架**。

```
Octane Master Process
├── Worker Process 1 (完整的 Laravel App)
│   ├── 接收请求 1
│   ├── 处理请求 1（使用已加载的 App 实例）
│   ├── 返回响应 1
│   ├── 【清理请求状态】
│   ├── 接收请求 2
│   └── ...
├── Worker Process 2
└── ...
```

### 5.2 Octane 的请求隔离机制

Octane 通过 `RequestTerminated` 事件和专门的"状态清理器"来实现请求间的隔离：

```php
// Octane 的核心清理逻辑（简化版）
class DispatchesEvents
{
    public function terminate(Request $request, Response $response): void
    {
        // 1. 触发 RequestTerminated 事件
        $this->app->make('events')->dispatch(
            new RequestTerminated($request, $response)
        );
        
        // 2. 清理服务容器中的绑定
        // Octane 会在每个请求后重置部分容器绑定
        
        // 3. 重置应用状态
        // 包括清除已解析的服务实例、事件监听器等
    }
}
```

### 5.3 Octane 会自动清理什么？

Octane 在每个请求后会自动处理：

```php
// Octane 的 WorkerState 和 ApplicationState 会重置以下内容：

// ✅ 自动清理：
// - 请求实例（Request）
// - 响应实例（Response）
// - Session 数据
// - 认证状态（Auth）
// - 部分容器绑定

// ⚠️ 不会自动清理（需要开发者自行处理）：
// - 通过 app()->singleton() 注册的自定义单例
// - 使用 static 属性缓存的数据
// - 全局变量
// - 文件句柄和数据库连接（如果手动创建）
```

### 5.4 Octane 的 StatefulClasses 配置

Octane 允许你指定哪些类在请求间"保持状态"，哪些需要"重置"：

```php
// config/octane.php
return [
    // 这些类的实例会在每个请求后被"踢出"容器
    // 下次请求时重新创建
    'warm' => [
        // 每个请求都应全新的类
    ],
    
    // 这些类在请求间保持不变
    // （通常是无状态服务或全局配置）
    'cache' => [
        // 哪些编译资源应该被缓存
    ],
];
```

### 5.5 自定义 Octane 的请求清理逻辑

你可以通过 `RequestTerminated` 事件来添加自定义清理逻辑：

```php
// app/Listeners/CleanRequestState.php
namespace App\Listeners;

use Laravel\Octane\Events\RequestTerminated;
use Illuminate\Support\Facades\Facade;

class CleanRequestState
{
    public function handle(RequestTerminated $event): void
    {
        // 清理自定义的全局状态
        RequestContext::destroy();
        
        // 清理静态属性缓存
        AppConfig::invalidate();
        
        // 重置事件收集器
        SafeEventCollector::flush();
        
        // 清理临时文件
        $this->cleanTempFiles();
        
        // 记录 Worker 的内存使用情况（用于监控）
        $this->logMemoryUsage();
    }

    private function cleanTempFiles(): void
    {
        $tempDir = storage_path('app/temp');
        if (is_dir($tempDir)) {
            $files = glob($tempDir . '/octane-*');
            foreach ($files as $file) {
                if (filemtime($file) < time() - 3600) { // 1小时前的临时文件
                    @unlink($file);
                }
            }
        }
    }

    private function logMemoryUsage(): void
    {
        $memory = memory_get_usage(true);
        $peak = memory_get_peak_usage(true);
        
        if ($memory > 100 * 1024 * 1024) { // 超过 100MB 报警
            logger()->warning('Worker memory usage is high', [
                'current' => round($memory / 1024 / 1024, 2) . 'MB',
                'peak' => round($peak / 1024 / 1024, 2) . 'MB',
                'worker_pid' => getmypid(),
            ]);
        }
    }
}
```

注册这个监听器：

```php
// app/Providers/EventServiceProvider.php
protected $listen = [
    \Laravel\Octane\Events\RequestTerminated::class => [
        \App\Listeners\CleanRequestState::class,
    ],
];
```

---

## 第六章：常见踩坑场景全解析

### 6.1 中间件状态残留

Laravel 中间件在 Octane 中的行为需要特别注意：

```php
// ❌ 有状态的中间件——Swoole 中的定时炸弹
class ThrottleRequestsMiddleware
{
    private array $requestCounts = []; // 存储在中间件实例中
    private int $maxAttempts;
    private int $decayMinutes;

    public function __construct(int $maxAttempts = 60, int $decayMinutes = 1)
    {
        $this->maxAttempts = $maxAttempts;
        $this->decayMinutes = $decayMinutes;
    }

    public function handle($request, Closure $next)
    {
        $key = $this->resolveRequestSignature($request);
        
        // ❌ $requestCounts 在整个 Worker 生命周期内累积
        if (!isset($this->requestCounts[$key])) {
            $this->requestCounts[$key] = [
                'count' => 0,
                'first_at' => time(),
            ];
        }
        
        $this->requestCounts[$key]['count']++;
        
        // 检查是否超限
        if ($this->requestCounts[$key]['count'] > $this->maxAttempts) {
            return response('Too Many Requests', 429);
        }
        
        return $next($request);
    }

    // ... 其他方法
}

// ✅ 正确做法：使用 Redis 或缓存存储限流数据
class ThrottleRequestsMiddleware
{
    public function handle($request, Closure $next, $maxAttempts = '60', $decayMinutes = '1')
    {
        $key = $this->resolveRequestSignature($request);
        
        // 使用 Laravel Cache（后端是 Redis），自动处理过期
        $count = cache()->get("throttle:{$key}", 0);
        
        if ($count >= (int) $maxAttempts) {
            return response('Too Many Requests', 429);
        }
        
        cache()->put(
            "throttle:{$key}",
            $count + 1,
            now()->addMinutes((int) $decayMinutes)
        );
        
        return $next($request);
    }
}
```

### 6.2 服务容器污染

```php
// ❌ 在 ServiceProvider 中绑定可变数据
class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 这个 singleton 在整个 Worker 生命周期内只创建一次
        $this->app->singleton(CurrentUserService::class, function ($app) {
            return new CurrentUserService();
        });
        
        // 如果 CurrentUserService 内部持有用户状态...
    }
}

class CurrentUserService
{
    private ?User $user = null;

    public function setUser(User $user): void
    {
        $this->user = $user;
    }

    public function getUser(): ?User
    {
        return $this->user;
    }
    
    // ❌ 因为是 singleton，$user 不会在请求间重置
    // 请求 A 设置的用户会泄漏到请求 B
}
```

**修复方案一：使用请求绑定**

```php
class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // ✅ 使用 transient 每次解析都创建新实例
        $this->app->bind(CurrentUserService::class, function ($app) {
            return new CurrentUserService();
        });
        
        // 或者使用 request 生命周期绑定
        $this->app->bind('request.user', function ($app) {
            return $app['request']->user();
        });
    }
}
```

**修复方案二：在请求结束后重置**

```php
class CurrentUserService
{
    private ?User $user = null;

    public function setUser(User $user): void
    {
        $this->user = $user;
    }

    public function getUser(): ?User
    {
        return $this->user;
    }

    public function reset(): void
    {
        $this->user = null;
    }
}

// 在 CleanRequestState 监听器中
public function handle(RequestTerminated $event): void
{
    app(CurrentUserService::class)->reset();
}
```

### 6.3 文件句柄泄漏

```php
// ❌ 文件句柄泄漏
class CsvExporter
{
    public function export(array $data): string
    {
        $path = tempnam(sys_get_temp_dir(), 'csv_');
        $handle = fopen($path, 'w');
        
        foreach ($data as $row) {
            fputcsv($handle, $row);
        }
        
        // ❌ 忘记关闭文件句柄
        // 在 Swoole 中，文件描述符是有限的系统资源
        // 不关闭会导致 Worker 最终耗尽文件描述符
        
        return $path;
    }
}

// ✅ 正确做法：确保资源被释放
class CsvExporter
{
    public function export(array $data): string
    {
        $path = tempnam(sys_get_temp_dir(), 'csv_');
        $handle = fopen($path, 'w');
        
        if ($handle === false) {
            throw new RuntimeException("Cannot open file: {$path}");
        }
        
        try {
            foreach ($data as $row) {
                fputcsv($handle, $row);
            }
        } finally {
            // ✅ 无论是否异常，都关闭句柄
            fclose($handle);
        }
        
        return $path;
    }
}
```

**更隐蔽的文件句柄泄漏：`file_get_contents` 和 `file_put_contents`**

```php
// ❌ curl 资源泄漏
class HttpClient
{
    public function get(string $url): string
    {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $result = curl_exec($ch);
        
        // ❌ 没有 curl_close($ch)
        // curl 句柄会一直占用内存和 socket
        
        return $result;
    }
}

// ✅ 正确做法
class HttpClient
{
    public function get(string $url): string
    {
        $ch = curl_init($url);
        try {
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);
            $result = curl_exec($ch);
            
            if (curl_errno($ch)) {
                throw new RuntimeException('Curl error: ' . curl_error($ch));
            }
            
            return $result;
        } finally {
            curl_close($ch);
        }
    }
}
```

### 6.4 定时器泄漏

Swoole 提供了 `Timer` 用于创建定时任务，但定时器如果管理不当也会导致资源泄漏：

```php
// ❌ 定时器泄漏
$http->on('workerStart', function ($server, $workerId) {
    // 每个 Worker 启动时创建定时器
    Swoole\Timer::tick(1000, function () {
        // 清理过期缓存...
    });
    
    // ❌ 如果 Worker 因某种原因重启，旧的定时器可能不会被清理
    // 或者在 onWorkerStart 中重复注册定时器
});

// ✅ 正确做法：管理定时器 ID
$http->on('workerStart', function ($server, $workerId) {
    $timerIds = [];
    
    // 创建定时器并保存 ID
    $timerIds[] = Swoole\Timer::tick(1000, function () {
        // 每秒清理过期缓存...
    });
    
    $timerIds[] = Swoole\Timer::tick(60000, function () use ($server) {
        // 每分钟报告 Worker 状态...
        $memory = memory_get_usage(true);
        echo "Worker {$server->worker_id} memory: " . round($memory / 1024 / 1024, 2) . "MB\n";
    });
    
    // 在 Worker 停止时清理所有定时器
    $server->on('workerStop', function ($server, $workerId) use (&$timerIds) {
        foreach ($timerIds as $timerId) {
            Swoole\Timer::clear($timerId);
        }
        $timerIds = [];
    });
});
```

---

## 第七章：生产环境排查工具与监控方案

### 7.1 内存监控：实时追踪 Worker 内存使用

```php
// 内存监控中间件
class MemoryMonitorMiddleware
{
    private static array $memoryBaseline = [];

    public function handle($request, Closure $next)
    {
        $startMemory = memory_get_usage();
        $startRealMemory = memory_get_usage(true);
        $startPeakMemory = memory_get_peak_usage(true);
        
        // 执行请求
        $response = $next($request);
        
        $endMemory = memory_get_usage();
        $endRealMemory = memory_get_usage(true);
        $endPeakMemory = memory_get_peak_usage(true);
        
        // 记录内存变化
        $memoryDelta = $endMemory - $startMemory;
        
        // 如果内存增长超过阈值，记录详细信息
        if ($memoryDelta > 1024 * 1024) { // 超过 1MB
            logger()->warning('High memory increase detected', [
                'url' => $request->url(),
                'method' => $request->method(),
                'memory_delta' => $this->formatBytes($memoryDelta),
                'current_usage' => $this->formatBytes($endMemory),
                'real_usage' => $this->formatBytes($endRealMemory),
                'peak_usage' => $this->formatBytes($endPeakMemory),
                'worker_pid' => getmypid(),
                'request_count' => $this->getRequestCount(),
            ]);
        }
        
        // 追踪内存泄漏趋势
        $this->trackMemoryTrend($endRealMemory);
        
        return $response;
    }

    private function trackMemoryTrend(int $currentMemory): void
    {
        $pid = getmypid();
        if (!isset(self::$memoryBaseline[$pid])) {
            self::$memoryBaseline[$pid] = $currentMemory;
            return;
        }
        
        // 如果内存持续增长超过 50%，发出警报
        $growth = ($currentMemory - self::$memoryBaseline[$pid]) / self::$memoryBaseline[$pid];
        if ($growth > 0.5) {
            logger()->critical('Potential memory leak detected', [
                'worker_pid' => $pid,
                'baseline' => $this->formatBytes(self::$memoryBaseline[$pid]),
                'current' => $this->formatBytes($currentMemory),
                'growth' => round($growth * 100, 2) . '%',
            ]);
            
            // 更新基线
            self::$memoryBaseline[$pid] = $currentMemory;
        }
    }

    private function formatBytes(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . $units[$i];
    }

    private function getRequestCount(): int
    {
        static $count = 0;
        return ++$count;
    }
}
```

### 7.2 连接数监控

```php
// 连接监控器
class ConnectionMonitor
{
    public static function getDatabaseConnections(): array
    {
        try {
            $processlist = DB::select('SHOW PROCESSLIST');
            return [
                'total' => count($processlist),
                'active' => count(array_filter($processlist, fn($p) => $p->Command !== 'Sleep')),
                'sleeping' => count(array_filter($processlist, fn($p) => $p->Command === 'Sleep')),
                'details' => array_map(fn($p) => [
                    'id' => $p->Id,
                    'user' => $p->User,
                    'db' => $p->db,
                    'command' => $p->Command,
                    'time' => $p->Time,
                    'state' => $p->State,
                ], $processlist),
            ];
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }

    public static function getRedisConnections(): array
    {
        try {
            $redis = Redis::connection()->client();
            $info = $redis->info('clients');
            return [
                'connected_clients' => $info['connected_clients'] ?? 'N/A',
                'blocked_clients' => $info['blocked_clients'] ?? 'N/A',
                'tracking_clients' => $info['tracking_clients'] ?? 'N/A',
                'total_connections_received' => $info['total_connections_received'] ?? 'N/A',
            ];
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }

    public static function getSystemConnections(): array
    {
        $pid = getmypid();
        
        // Linux: 获取进程的 socket 文件描述符数量
        $cmd = "ls -la /proc/{$pid}/fd 2>/dev/null | grep socket | wc -l";
        $socketCount = (int) shell_exec($cmd);
        
        return [
            'pid' => $pid,
            'socket_fds' => $socketCount,
            'open_fds' => (int) shell_exec("ls /proc/{$pid}/fd 2>/dev/null | wc -l"),
        ];
    }
}

// 在监控路由中使用
Route::get('/octane/health', function () {
    return response()->json([
        'status' => 'ok',
        'timestamp' => now()->toIso8601String(),
        'workers' => [
            'pid' => getmypid(),
            'memory' => [
                'current' => memory_get_usage(true),
                'peak' => memory_get_peak_usage(true),
            ],
            'uptime' => defined('WORKER_START_TIME') ? time() - WORKER_START_TIME : null,
        ],
        'database' => ConnectionMonitor::getDatabaseConnections(),
        'redis' => ConnectionMonitor::getRedisConnections(),
        'system' => ConnectionMonitor::getSystemConnections(),
    ]);
});
```

### 7.3 使用 Prometheus + Grafana 进行长期监控

```php
// app/Providers/OctaneMetricsServiceProvider.php
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Prometheus\CollectorRegistry;
use Prometheus\Storage\Redis as PrometheusRedis;

class OctaneMetricsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(CollectorRegistry::class, function () {
            return new CollectorRegistry(new PrometheusRedis([
                'host' => config('database.redis.default.host'),
                'port' => config('database.redis.default.port'),
            ]));
        });
    }

    public function boot(): void
    {
        if (!$this->app->runningOctane()) {
            return;
        }

        // 注册 Octane 事件监听器收集指标
        $this->app['events']->listen(
            \Laravel\Octane\Events\RequestTerminated::class,
            function ($event) {
                $this->recordRequestMetrics($event);
            }
        );
    }

    private function recordRequestMetrics($event): void
    {
        $registry = app(CollectorRegistry::class);
        
        // 请求计数器
        $counter = $registry->registerCounter(
            'octane',
            'requests_total',
            'Total number of requests',
            ['method', 'status', 'worker']
        );
        $counter->incBy(1, [
            $event->request->method(),
            $event->response->getStatusCode(),
            (string) getmypid(),
        ]);
        
        // 请求耗时直方图
        $histogram = $registry->registerHistogram(
            'octane',
            'request_duration_seconds',
            'Request duration in seconds',
            ['method'],
            [.01, .05, .1, .25, .5, 1, 2.5, 5, 10]
        );
        $histogram->observe(
            microtime(true) - LARAVEL_START,
            [$event->request->method()]
        );
        
        // Worker 内存 Gauge
        $gauge = $registry->registerGauge(
            'octane',
            'worker_memory_bytes',
            'Worker memory usage in bytes',
            ['worker', 'type']
        );
        $gauge->set(memory_get_usage(), [(string) getmypid(), 'used']);
        $gauge->set(memory_get_usage(true), [(string) getmypid(), 'real']);
        $gauge->set(memory_get_peak_usage(true), [(string) getmypid(), 'peak']);
    }
}
```

### 7.4 Swoole 自带的监控能力

```php
// 在 Swoole 的 onWorkerStart 中启用内部统计
$http->on('workerStart', function ($server, $workerId) {
    // 每 10 秒打印 Worker 统计信息
    Swoole\Timer::tick(10000, function () use ($server) {
        $stats = $server->stats();
        $workerStats = $server->getWorkerStatus($workerId);
        
        echo sprintf(
            "[Worker %d] Memory: %s | Peak: %s | Requests: %d | Coroutine: %d\n",
            $workerId,
            formatBytes(memory_get_usage(true)),
            formatBytes(memory_get_peak_usage(true)),
            $stats['request_count'] ?? 0,
            Swoole\Coroutine::stats()['coroutine_num'] ?? 0
        );
    });
});

// Swoole Server stats 输出
// tasking_num      - 正在排队的异步任务数
// request_count    - 已处理的请求总数
// worker_request_count - 当前 Worker 处理的请求数
// coroutine_num    - 当前协程数
```

### 7.5 PHP 内置的垃圾回收调试

```php
// 在 onWorkerStart 中配置 GC
$http->on('workerStart', function ($server, $workerId) {
    // 启用 GC 循环收集器的详细日志
    gc_enable();
    
    // 每 1000 个请求后强制执行 GC
    Swoole\Timer::tick(1000, function () use ($server, $workerId) {
        $collected = gc_collect_cycles();
        $gcStatus = gc_status();
        
        if ($collected > 100) {
            logger()->info('GC collected significant cycles', [
                'worker' => $workerId,
                'collected' => $collected,
                'runs' => $gcStatus['runs'],
                'collected_cycles' => $gcStatus['collected'],
                'threshold' => $gcStatus['threshold'],
                'roots' => $gcStatus['roots'],
            ]);
        }
    });
});

// 获取详细的 GC 信息
$gcStatus = gc_status();
// runs          - GC 运行次数
// collected     - 已回收的循环引用数
// threshold     - 触发 GC 的阈值
// roots         - 当前根缓冲区中的元素数
```

---

## 第八章：最佳实践 Checklist

在从 PHP-FPM 迁移到 Swoole / Laravel Octane 之前和之后，请逐项检查以下最佳实践：

### 8.1 代码审查 Checklist

**静态属性和全局变量**
- [ ] 搜索代码中所有 `static $` 属性，评估是否会在请求间产生状态残留
- [ ] 搜索所有 `global $` 关键字，确认是否需要在请求开始时重置
- [ ] 检查所有 Singleton 模式，确认持有状态的单例是否有 reset 机制
- [ ] 审查所有 `$_SERVER`、`$_GET`、`$_POST` 等超全局变量的使用

**连接管理**
- [ ] 确认所有数据库连接使用 Laravel 的 DB Facade 或连接池，而非手动 `new PDO()`
- [ ] 确认 Redis 连接使用 Laravel 的 Redis Facade，而非手动 `new Predis\Client()`
- [ ] 检查所有 `curl_init()`、`fopen()`、`socket_create()` 等资源创建是否有对应的 `close` 操作
- [ ] 审查是否有 HTTP 客户端（Guzzle 等）在请求间持有连接

**中间件和服务**
- [ ] 检查所有中间件是否有实例属性会被跨请求修改
- [ ] 审查 ServiceProvider 中的 `singleton` 绑定，确认是否应该是 `bind` 或 `scoped`
- [ ] 检查所有 Cache Facade 的使用，确认 TTL 设置合理
- [ ] 审查 Session 和 Cookie 的处理逻辑

### 8.2 配置 Checklist

**Octane 配置**
- [ ] 启用 `config/octane.php` 中的 `database` 选项（自动管理数据库连接）
- [ ] 配置合理的 `max_request` 参数（建议 500-1000，防止内存泄漏累积）
- [ ] 配置 `warm` 和 `flush` 数组，明确哪些服务需要在请求间重置
- [ ] 设置合理的 Worker 数量（通常为 CPU 核心数）

**Swoole 配置**
- [ ] 设置 `max_request` 参数限制 Worker 处理的最大请求数
- [ ] 配置 `task_worker_num` 处理异步任务
- [ ] 启用 `reload_async` 实现平滑重启
- [ ] 配置 `max_connection` 限制最大并发连接数

### 8.3 运维 Checklist

**监控告警**
- [ ] 部署 Worker 内存使用监控（建议阈值：200MB）
- [ ] 部署数据库连接数监控（建议阈值：80% 最大连接数）
- [ ] 部署 Redis 连接数监控
- [ ] 配置 Worker 自动重启策略（内存超过阈值时重启）

**日志记录**
- [ ] 记录每个 Worker 的启动和停止事件
- [ ] 记录 Worker 的内存使用趋势
- [ ] 记录异常和错误，包含 Worker PID 信息
- [ ] 配置 GC 日志（生产环境可降低采样频率）

**部署策略**
- [ ] 使用 `--max-requests` 限制 Worker 生命周期
- [ ] 配置健康检查端点
- [ ] 实现蓝绿部署或滚动更新
- [ ] 准备快速回滚方案

### 8.4 测试 Checklist

**压力测试**
- [ ] 执行长时间（至少 2 小时）的压力测试
- [ ] 监控内存使用是否随时间线性增长
- [ ] 检查数据库连接数是否稳定
- [ ] 验证 GC 是否正常工作

**功能测试**
- [ ] 测试并发请求间的数据隔离（不同用户同时访问）
- [ ] 测试长时间运行后的功能正确性
- [ ] 测试 Worker 重启后服务是否正常恢复
- [ ] 测试配置热更新是否生效

### 8.5 代码模板：请求生命周期管理器

```php
// 通用的请求生命周期管理器
namespace App\Octane;

use Swoole\Http\Request as SwooleRequest;
use Swoole\Http\Response as SwooleResponse;

class RequestLifecycleManager
{
    private array $beforeRequestCallbacks = [];
    private array $afterRequestCallbacks = [];
    private array $cleanupCallbacks = [];

    public function onBeforeRequest(callable $callback): void
    {
        $this->beforeRequestCallbacks[] = $callback;
    }

    public function onAfterRequest(callable $callback): void
    {
        $this->afterRequestCallbacks[] = $callback;
    }

    public function onCleanup(callable $callback): void
    {
        $this->cleanupCallbacks[] = $callback;
    }

    public function beforeRequest(): void
    {
        foreach ($this->beforeRequestCallbacks as $callback) {
            $callback();
        }
    }

    public function afterRequest(): void
    {
        foreach ($this->afterRequestCallbacks as $callback) {
            $callback();
        }
    }

    public function cleanup(): void
    {
        foreach ($this->cleanupCallbacks as $callback) {
            try {
                $callback();
            } catch (\Throwable $e) {
                logger()->error('Cleanup callback failed', [
                    'error' => $e->getMessage(),
                    'trace' => $e->getTraceAsString(),
                ]);
            }
        }
    }
}

// 注册到 AppServiceProvider
$this->app->singleton(RequestLifecycleManager::class, function ($app) {
    $manager = new RequestLifecycleManager();
    
    // 注册默认清理逻辑
    $manager->onCleanup(function () {
        // 重置请求上下文
        RequestContext::destroy();
    });
    
    $manager->onCleanup(function () {
        // 清理静态缓存
        AppConfig::invalidate();
    });
    
    $manager->onCleanup(function () {
        // 强制 GC（可选）
        if (memory_get_usage(true) > 100 * 1024 * 1024) {
            gc_collect_cycles();
        }
    });
    
    return $manager;
});
```

---

## 总结：从"请求级思维"到"常驻内存思维"的转变

从 PHP-FPM 迁移到 Swoole / Laravel Octane 不仅仅是换一个服务器那么简单，它需要开发者从根本上转变编程思维：

1. **生命周期意识**：时刻意识到变量、对象、连接的生命周期不再等于请求的生命周期。每个创建的资源都需要你显式管理它的释放。

2. **状态隔离意识**：任何可能在请求间产生副作用的状态（静态属性、全局变量、单例实例中的可变数据）都需要在请求开始时重置或在请求结束时清理。

3. **资源管理意识**：数据库连接、Redis 连接、文件句柄、Curl 句柄等系统资源不再是"用完即弃"的，需要通过连接池或显式释放来管理。

4. **内存意识**：常驻内存意味着内存泄漏是累积性的。一个请求泄漏 1KB，10 万个请求就是 100MB。必须在开发阶段就养成内存友好的编码习惯。

5. **监控意识**：PHP-FPM 时代，重启 Worker 就能"自愈"。Swoole 中，你需要完善的监控体系来发现和预防问题。

最后，记住一个简单的原则：**如果一个变量、对象或连接，不应该在下一个请求中被看到，那么你就有责任在当前请求结束时清理它。** PHP-FPM 帮你做了这件事，但 Swoole 不会——这不是 Swoole 的缺陷，而是它带来高性能的同时，要求你承担的"代价"。

掌握了这些，你就能真正享受到 Swoole / Laravel Octane 带来的数倍性能提升，而不是在凌晨三点被报警电话惊醒。

---

> **参考资源**
> - [Swoole 官方文档 - 生命周期](https://wiki.swoole.com/#/life_cycle)
> - [Laravel Octane 官方文档](https://laravel.com/docs/octane)
> - [PHP-FPM 进程管理详解](https://www.php.net/manual/en/install.fpm.php)
> - [Swoole 协程连接池实现](https://wiki.swoole.com/#/coroutine/connection_pool)

---

## 相关阅读

- [PHP 进程模型深度剖析：PHP-FPM worker 生命周期、信号处理与 graceful reload 的底层机制](/05_PHP/Laravel/php-fpm-worker-lifecycle-signal-graceful-reload/)
- [Elixir OTP 实战：Supervisor 树、GenServer 与分布式进程——对比 PHP-FPM 无状态模型的并发哲学](/00_架构/Elixir-OTP-实战-Supervisor树-GenServer-分布式进程-对比PHP-FPM无状态模型的并发哲学/)
- [Go 微服务实战：重写 Laravel 高性能模块——PHP-FPM 到 Go 迁移](/00_架构/Go-微服务实战-重写Laravel高性能模块-PHP-FPM到Go迁移/)
