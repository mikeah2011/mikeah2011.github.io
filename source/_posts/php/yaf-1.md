---

title: Yaf 框架入门：鸟哥的 C 扩展级 PHP 框架
keywords: [Yaf, PHP, 框架入门, 鸟哥的, 扩展级]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- 架构
- Yaf
- Swoole
- 性能优化
- 框架对比
categories:
- php
date: 2019-03-20 15:05:07
description: Yaf（Yet Another Framework）是鸟哥 Laruence 用 C 编写的高性能 PHP 框架扩展，以 .so 形式加载实现零解释开销，单核 QPS 可达 6000+。本文详解 Yaf 路由系统、插件机制、Swoole 协程化方案、RESTful API 实战及性能调优技巧，并与 Hyperf、Webman 等现代框架进行全面对比，帮你判断 Yaf 是否适合你的项目。
---



## 一、Yaf 是什么

**Yaf = Yet Another Framework**，作者是 Rasmus Lerdorf 的同事、PHP 核心开发者**鸟哥（Xinchen Hui / Laruence）**。

和其他 PHP 框架最大的不同：**Yaf 是 PHP 扩展（C 写的 .so）**，不是 Composer 包。

- 框架自身不被 PHP 解释执行 → 启动 0 开销
- 常驻在 PHP 进程内 → 没有 autoload 成本
- 性能在 PHP-FPM 模式下**比 Laravel/TP 快一个数量级**

代价：

- 学习资料少（黄金时期是 2013-2017）
- 生态弱（没有 Eloquent 这种 ORM，要自己拼）
- 调试不便（C 层面问题）

适合：**对性能敏感、团队 PHP 功底强、不需要花哨 ORM** 的中型项目。

---

## 二、安装

```bash
# pecl 安装
pecl install yaf

# php.ini
extension=yaf.so
yaf.environ=product
yaf.use_namespace=1
yaf.use_spl_autoload=0
```

验证：

```bash
php -m | grep yaf
```

---

## 三、目录结构（约定）

```
project/
├── public/
│   └── index.php           # 入口
├── conf/
│   └── application.ini
└── application/
    ├── Bootstrap.php
    ├── controllers/
    │   └── Index.php
    ├── models/
    ├── views/
    └── library/
```

入口文件：

```php
<?php
define('APP_PATH', dirname(__DIR__));
$app = new Yaf_Application(APP_PATH . "/conf/application.ini");
$app->bootstrap()->run();
```

控制器：

```php
<?php
class IndexController extends Yaf_Controller_Abstract
{
    public function indexAction()
    {
        $this->getView()->assign("name", "Yaf");
        // 自动渲染 application/views/index/index.phtml
    }

    public function jsonAction()
    {
        $this->getView()->display(null);   // 关闭模板
        echo json_encode(['ok' => 1]);
    }
}
```

---

## 四、配置（INI）

```ini
[product]
application.directory = APP_PATH "/application"
application.dispatcher.defaultModule = "Index"
application.dispatcher.defaultController = "Index"
application.dispatcher.defaultAction = "index"

[dev : product]
application.system.debug = 1
```

`dev : product` 表示继承 product 段，调试环境覆盖。

---

## 五、和 PHP 框架的性能对比（参考值）

| 框架 | 简单接口 QPS（单核） |
|------|---------------------|
| Yaf | ~6000 |
| Phalcon（也是 C 扩展） | ~5500 |
| ThinkPHP 6 | ~1200 |
| Laravel | ~600 |
| Symfony | ~500 |

> 数字仅供量级参考，实际取决于硬件、PHP 版本、Opcache 配置。

---

## 六、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **PHP 8 兼容** | 装不上 / 段错误 | 用 `yaf-3.3+`，旧版本不支持 PHP 8 |
| **控制器找不到** | "Could not find class" | 检查文件名大小写、路径，类名必须 `XxxController` |
| **没有 ORM** | 数据库怎么操作 | 自己装 `medoo`、`atlas` 等独立 ORM，或裸 PDO |
| **路由不灵活** | 默认只支持 `/控制器/方法` | 用 `Yaf_Route_Rewrite` 或 `Regex` 自定义 |
| **调试难** | 框架在 C 层 | 多用 `yaf_router->getRoute()` 之类的内省方法 |

---

## 七、什么时候选 Yaf

✅ **选**：性能敏感、团队懂 PHP 内核、有人维护配套代码（DAO 层等）
❌ **别选**：业务复杂、需要丰富生态、新人多 —— 选 Laravel / TP / Hyperf 更合适

如果你想要**协程 + 性能**，更现代的答案是 **Hyperf** 或 **Webman**，Yaf 是「老一代性能流派」的代表作。

---

## 八、路由系统详解

Yaf 默认使用「模块/控制器/动作」的 URL 映射（`Yaf_Router`），但实际项目中往往需要更灵活的路由。Yaf 提供了四种内置路由实现。

### 8.1 Yaf_Route_Static（静态路由）

最简单的路由，直接将 URL 映射到控制器和动作：

```php
<?php
// Bootstrap.php 中注册
public function _initRoute(Yaf_Dispatcher $dispatcher)
{
    $router = $dispatcher->getRouter();
    // /product/detail/123 → ProductController::detailAction(id=123)
    $route = new Yaf_Route_Static(
        '/product/detail/:id',
        'Product',
        'detail'
    );
    $router->addRoute('product_detail', $route);
}
```

### 8.2 Yaf_Route_Rewrite（重写路由）

基于正则匹配的路由重写，支持参数捕获：

```php
<?php
// /blog/2024/01/hello-world → BlogController::viewAction(year=2024, month=01, slug=hello-world)
$route = new Yaf_Route_Rewrite(
    '/blog/:year/:month/:slug',
    [
        'controller' => 'Blog',
        'action'     => 'view',
    ]
);
$router->addRoute('blog_view', $route);
```

### 8.3 Yaf_Route_Regex（正则路由）

完全自定义正则表达式匹配：

```php
<?php
// /api/v2/users/42 → ApiController::usersAction(version=2, id=42)
$route = new Yaf_Route_Regex(
    '#^/api/v(\d+)/users/(\d+)$#',
    [
        'controller' => 'Api',
        'action'     => 'users',
    ],
    [
        'version' => 1,  // 正则子组 1
        'id'      => 2,  // 正则子组 2
    ]
);
$router->addRoute('api_users', $route);
```

### 8.4 Yaf_Route_Simple（简单路由）

按 URL 查询参数来指定模块/控制器/动作：

```php
<?php
// /index.php?c=User&a=profile&id=5
$route = new Yaf_Route_Simple('c', 'a', 'm'); // 控制器参数名, 动作参数名, 模块参数名
$router->addRoute('simple', $route);
```

### 8.5 路由优先级与链式注册

路由按注册顺序匹配，先注册的优先级更高：

```php
<?php
public function _initRoute(Yaf_Dispatcher $dispatcher)
{
    $router = $dispatcher->getRouter();
    // 高优先级：精确匹配放前面
    $router->addRoute('api_regex', $apiRegexRoute);
    $router->addRoute('blog_rewrite', $blogRoute);
    // 低优先级：兜底路由
    $router->addRoute('default', new Yaf_Route_Static());
}
```

---

## 九、插件系统（Plugin）

Yaf 的插件机制通过生命周期钩子实现请求处理各阶段的拦截与扩展。

### 9.1 可用钩子列表

| 钩子（Hook） | 触发时机 | 典型用途 |
|---|---|---|
| `routerStartup` | 路由开始前 | 日志、权限预检、CORS 头 |
| `routerShutdown` | 路由完成后 | 获取路由结果、参数校验 |
| `dispatchLoopStartup` | 分发循环开始 | 全局初始化 |
| `preDispatch` | 控制器动作执行前 | 鉴权、中间件逻辑 |
| `postDispatch` | 控制器动作执行后 | 响应包装、日志记录 |
| `dispatchLoopShutdown` | 分发循环结束后 | 资源清理、输出缓冲 |
| `preResponse` | 响应发送前 | 响应头注入、压缩 |

### 9.2 编写插件

```php
<?php
// application/plugins/Auth.php
class AuthPlugin extends Yaf_Plugin_Abstract
{
    public function preDispatch(Yaf_Request_Abstract $request, Yaf_Response_Abstract $response)
    {
        $token = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (empty($token)) {
            // 拦截请求，重定向到登录
            $request->setControllerName('Auth');
            $request->setActionName('login');
        }
    }

    public function postDispatch(Yaf_Request_Abstract $request, Yaf_Response_Abstract $response)
    {
        $response->setHeader('X-Powered-By', 'Yaf/3.3');
    }
}
```

注册插件：

```php
<?php
// Bootstrap.php
public function _initPlugin(Yaf_Dispatcher $dispatcher)
{
    $dispatcher->registerPlugin(new AuthPlugin());
}
```

---

## 十、Yaf + Swoole 协程化

传统 Yaf 运行在 PHP-FPM 模式下，每个请求一个进程。结合 Swoole 可以实现常驻内存 + 协程并发，大幅提升吞吐。

### 10.1 方案一：Swoole 适配器（推荐）

使用 `Swoole\Http\Server` 托管 Yaf 应用：

```php
<?php
// server.php
$http = new Swoole\Http\Server('0.0.0.0', 9501);

$http->set([
    'worker_num'       => 4,
    'enable_coroutine' => true,
]);

$http->on('workerStart', function ($server, $workerId) {
    // 每个 Worker 进程初始化一次 Yaf 应用
    define('APP_PATH', __DIR__);
    $GLOBALS['app'] = new Yaf_Application(APP_PATH . '/conf/application.ini');
    $GLOBALS['app']->bootstrap();
});

$http->on('request', function (Swoole\Http\Request $request, Swoole\Http\Response $response) {
    // 将 Swoole 请求转换为 Yaf 请求
    $yafRequest = Yaf_Dispatcher::getInstance()->getRequest();
    $yafRequest->setRequestUri($request->server['request_uri']);
    $yafRequest->setMethod($request->server['request_method']);

    ob_start();
    $GLOBALS['app']->getDispatcher()->dispatch($yafRequest);
    $body = ob_get_clean();

    $response->end($body);
});

$http->start();
```

### 10.2 性能提升参考

| 模式 | 简单接口 QPS（4 Worker） |
|---|---|
| Yaf + PHP-FPM | ~6000 |
| Yaf + Swoole | ~25000+ |
| Yaf + Swoole 协程 | ~40000+（含 IO 并发） |

> 注意：Swoole 模式下需注意全局变量污染、静态属性跨请求残留等问题。

---

## 十一、RESTful API 完整示例

### 11.1 基础控制器封装

```php
<?php
// application/controllers/Api.php
class ApiController extends Yaf_Controller_Abstract
{
    // 禁用视图渲染
    public function init()
    {
        $this->getView()->display(null);
    }

    protected function jsonResponse(array $data, int $code = 200): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
    }

    protected function errorResponse(string $message, int $code = 400): void
    {
        $this->jsonResponse(['error' => $message, 'code' => $code], $code);
    }
}
```

### 11.2 用户资源控制器

```php
<?php
// application/controllers/User.php
class UserController extends ApiController
{
    // GET /user/42
    public function getAction()
    {
        $id = (int) $this->getRequest()->getParam('id');

        try {
            $pdo = new PDO('mysql:host=localhost;dbname=test', 'root', '');
            $stmt = $pdo->prepare('SELECT id, name, email FROM users WHERE id = ?');
            $stmt->execute([$id]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$user) {
                return $this->errorResponse('用户不存在', 404);
            }

            return $this->jsonResponse(['data' => $user]);
        } catch (PDOException $e) {
            return $this->errorResponse('数据库错误: ' . $e->getMessage(), 500);
        }
    }

    // POST /user/create
    public function createAction()
    {
        $body = json_decode(file_get_contents('php://input'), true);
        if (empty($body['name']) || empty($body['email'])) {
            return $this->errorResponse('缺少必要字段: name, email');
        }

        // 插入逻辑 ...
        return $this->jsonResponse(['message' => '创建成功', 'id' => 1], 201);
    }
}
```

### 11.3 异常处理中间件模拟

```php
<?php
// application/plugins/ErrorHandler.php
class ErrorHandlerPlugin extends Yaf_Plugin_Abstract
{
    public function routerStartup(Yaf_Request_Abstract $req, Yaf_Response_Abstract $res)
    {
        set_exception_handler(function (\Throwable $e) {
            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode([
                'error'   => $e->getMessage(),
                'code'    => $e->getCode(),
                'file'    => $e->getFile(),
                'line'    => $e->getLine(),
            ]);
        });
    }

    public function postDispatch(Yaf_Request_Abstract $req, Yaf_Response_Abstract $res)
    {
        // 模拟中间件：为所有 API 响应添加请求耗时
        header('X-Request-Time: ' . round(microtime(true) - YAF_REQUEST_START, 4) . 's');
    }
}
```

---

## 十二、Yaf vs 现代 PHP 框架对比

| 特性 | Yaf | Hyperf | Webman | Laravel | ThinkPHP 6 |
|---|---|---|---|---|---|
| **底层语言** | C 扩展 | PHP + Swoole | PHP + Workerman | PHP | PHP |
| **运行模式** | FPM / Swoole | Swoole 常驻 | Workerman 常驻 | FPM | FPM / Swoole |
| **协程支持** | ❌（需 Swoole 适配） | ✅ 原生 | ✅ 原生 | ❌ | ❌（Swoole 版支持） |
| **QPS 量级** | ~6000(FPM) / ~40000(Swoole) | ~30000 | ~35000 | ~600 | ~1200 |
| **ORM** | ❌ 无（需第三方） | ✅ Model + PDO | ❌（可用 ThinkORM） | ✅ Eloquent | ✅ 自带 ORM |
| **中间件** | ❌（插件模拟） | ✅ PSR-15 | ✅ PSR-15 | ✅ 完善 | ✅ 完善 |
| **学习曲线** | 中（文档少） | 高 | 低 | 中 | 低 |
| **社区活跃度** | ⭐⭐ 低 | ⭐⭐⭐⭐ 高 | ⭐⭐⭐ 中 | ⭐⭐⭐⭐⭐ 极高 | ⭐⭐⭐⭐ 高 |
| **适用场景** | 高性能 API、内部服务 | 微服务、高并发 | 高并发、快速迁移 | 全栈 Web | 中小型项目 |

---

## 十三、性能调优技巧

### 13.1 Opcache 配置（必做）

```ini
; php.ini
opcache.enable=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=10000
opcache.revalidate_freq=0          ; 生产环境关闭文件检查
opcache.validate_timestamps=0      ; 生产环境不检查时间戳
opcache.save_comments=0            ; 不保存注释，减少内存
opcache.enable_file_override=1
```

### 13.2 Yaf 配置项优化

```ini
[product]
application.directory = APP_PATH "/application"
; 关闭命名空间自动加载（自己管理更高效）
yaf.use_spl_autoload = 0
; 开启命名空间（推荐）
yaf.use_namespace = 1
; 关闭低参数（Yaf 3.2+）
yaf.lowcase_path = 1
; 关闭视图渲染（纯 API 项目）
application.view.ext = ""
; 预加载常用库
application.library = APP_PATH "/application/library"
```

### 13.3 PHP 运行时优化

```ini
; 关闭不需要的扩展
disable_functions = exec,passthru,shell_exec,system,proc_open,popen
; 调整内存和执行时间
memory_limit = 256M
max_execution_time = 30
; 实时编译优化
opcache.jit = 1255
opcache.jit_buffer_size = 128M
```

### 13.4 代码层面优化

- 使用 `Yaf_Registry` 缓存频繁访问的配置和对象
- 避免在控制器中 `new PDO`，复用数据库连接
- 关闭自动渲染（`$this->getView()->display(null)`），API 项目直接 `echo`
- 使用 `Yaf_Session` 管理会话，避免原生 `$_SESSION` 超全局变量

---

## 参考

- GitHub：<https://github.com/laruence/yaf>
- 文档：<https://www.php.net/manual/zh/book.yaf.php>
- 鸟哥博客：<https://www.laruence.com/>

---

## 相关阅读

- [Hyperf 框架](/categories/PHP/php/frameworks/hyperf-1/)
- [ThinkPHP](/categories/PHP/php/frameworks/thinkphp-1/)
- [Lumen 基础](/categories/PHP/php/frameworks/lumen-1/)
- [PHP 生命周期与 SAPI](/categories/PHP/php/lifecycle/)
