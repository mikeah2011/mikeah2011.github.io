---

title: ThinkPHP 框架入门：国内主流 PHP 框架快速上手
keywords: [ThinkPHP, PHP, 框架入门, 国内主流, 框架快速上手]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- ThinkPHP
- 架构
categories:
- php
date: 2019-03-20 15:05:07
description: ThinkPHP（TP）是国内使用最广的 PHP 框架，基于 MVC 架构，以全中文文档和约定优于配置著称。本文深入讲解 TP6/TP8 核心特性、ORM、中间件、事件系统、队列、验证器、缓存配置，并对比 TP6 与 TP8 差异及 ThinkPHP 与 Laravel 选型，附实战踩坑与安全防护经验，是国内 PHP 开发者的实用参考指南。
---



## 一、ThinkPHP 简介

ThinkPHP 由顶想科技维护，2006 年首发，至今主流版本 **TP6 / TP8**。它在国内 PHP 项目里占有率极高，原因很现实：

- **文档全中文**，社区活跃，遇到问题搜得到
- **约定优于配置**，新人一上手能跑业务
- **生态完整**：ORM、模板引擎、验证器、命令行、多应用、微服务套件齐全
- **学习成本低**：CRUD 后台一两天就能搭起来

不适合极致性能场景（用 Hyperf / EasySwoole），但**做后台、内部系统、中小型 SaaS** 性价比极高。

---

## 二、目录结构（TP6）

```
├── app/                  # 应用目录
│   ├── controller/       # 控制器
│   ├── model/            # 模型
│   ├── middleware/       # 中间件
│   └── view/             # 视图
├── config/               # 配置
├── extend/               # 扩展类库
├── public/               # 入口（web 根目录指这里）
├── route/                # 路由定义
├── runtime/              # 缓存、日志（要可写）
├── vendor/               # composer 依赖
└── think                 # 命令行入口
```

---

## 三、快速开始

```bash
composer create-project topthink/think tp
cd tp
php think run             # 内置服务器，访问 http://localhost:8000
```

控制器：

```php
<?php
namespace app\controller;

use think\facade\Db;

class User
{
    public function info(int $id)
    {
        $user = Db::name('user')->find($id);
        return json($user);
    }
}
```

路由：

```php
// route/app.php
use think\facade\Route;

Route::get('user/:id', 'User/info');
Route::group('api', function () {
    Route::get('users', 'User/list');
    Route::post('users', 'User/create');
})->middleware(\app\middleware\Auth::class);
```

---

## 四、模型 & ORM

```php
<?php
namespace app\model;

use think\Model;

class Order extends Model
{
    protected $table = 'orders';
    protected $autoWriteTimestamp = true;   // 自动维护 create_time / update_time

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}

// 查询
$orders = Order::with('user')->where('status', 1)->paginate(20);
```

---

## 五、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **runtime 不可写** | 500 / 模板缓存失败 | `chmod -R 755 runtime/ && chown www-data:www-data runtime/` |
| **public 没指对** | 访问首页 404 / 暴露源码 | nginx root 必须是 `public/` 而不是项目根 |
| **路由不生效** | 提示控制器未定义 | TP6 默认开启路由，URL 必须命中 route 文件；想用伪静态 PATH_INFO 要关掉 `url_route_must` |
| **多应用模式** | 切到多应用后 URL 变了 | 装 `topthink/think-multi-app`，URL 变 `/应用/控制器/方法` |
| **跨域** | 前端拿不到响应 | 装 `topthink/think-cors` 或自己写中间件 |
| **Db 查询日志写爆** | runtime/log 几个 G | 生产 `app_debug=false`、`log.level=['error']` |

---

## 六、版本选择

| 版本 | 状态 | 建议 |
|------|------|------|
| TP3.2 | EOL | 老项目维护，新项目别用 |
| TP5.x | 长期不再更新 | 老项目维护 |
| TP6 | 维护中 | 稳定项目可继续 |
| **TP8** | **主推** | 新项目首选，PHP 8.0+，性能优化、严格类型 |

---

## 七、中间件

中间件用于在请求前后执行通用逻辑，如认证、日志、CORS 等。

### 7.1 定义中间件

```bash
php think make:middleware Check
```

```php
<?php
namespace app\middleware;

class Check
{
    // 前置中间件
    public function handle($request, \Closure $next)
    {
        if (!$request->header('token')) {
            return json(['code' => 401, 'msg' => '未登录'], 401);
        }
        $response = $next($request);
        // 后置逻辑
        $response->header('X-App', 'ThinkPHP');
        return $response;
    }
}
```

### 7.2 CORS 中间件

```php
<?php
namespace app\middleware;

class Cors
{
    public function handle($request, \Closure $next)
    {
        $response = $next($request);
        $response->header([
            'Access-Control-Allow-Origin'  => '*',
            'Access-Control-Allow-Headers' => 'Content-Type,Authorization,Token',
            'Access-Control-Allow-Methods' => 'GET,POST,PUT,DELETE,OPTIONS',
        ]);
        return $response;
    }
}
```

### 7.3 限流中间件

```php
<?php
namespace app\middleware;

use think\facade\Cache;

class RateLimit
{
    public function handle($request, \Closure $next)
    {
        $ip  = $request->ip();
        $key = "rate:{$ip}";
        $count = Cache::get($key, 0);
        if ($count >= 60) {
            return json(['msg' => '请求过于频繁'], 429);
        }
        Cache::set($key, $count + 1, 60); // 60 秒 60 次
        return $next($request);
    }
}
```

在路由中使用中间件：

```php
Route::group('api', function () {
    Route::get('users', 'User/list');
})->middleware([
    \app\middleware\Cors::class,
    \app\middleware\RateLimit::class,
    \app\middleware\Auth::class,
]);
```

---

## 八、事件系统

TP8 内置事件组件，支持事件定义、监听器和订阅者模式。

### 8.1 定义事件与监听器

```php
<?php
namespace app\event;

class UserLogin
{
    public $user;
    public function __construct($user) { $this->user = $user; }
}

namespace app\listener;

class LoginLog
{
    public function handle(\app\event\UserLogin $event)
    {
        trace("用户 {$event->user['name']} 登录");
    }
}
```

### 8.2 事件订阅者

```php
<?php
namespace app\subscriber;

class UserSubscriber
{
    public function onLogin(\app\event\UserLogin $event) { /* ... */ }
    public function onLogout($event) { /* ... */ }

    public function subscribe(): array
    {
        return [
            'UserLogin'  => 'onLogin',
            'UserLogout' => 'onLogout',
        ];
    }
}
```

注册监听器和订阅者可在 `app/event.php` 中配置：

```php
return [
    'listen'     => ['UserLogin' => [\app\listener\LoginLog::class]],
    'subscribe'  => [\app\subscriber\UserSubscriber::class],
];
```

触发事件：

```php
event(new \app\event\UserLogin($user));
```

---

## 九、队列与异步任务

安装 `topthink/think-queue` 后可将耗时任务（发邮件、生成报表）异步处理。

### 9.1 配置与使用

```php
// config/queue.php
return [
    'default' => 'redis',
    'connections' => [
        'redis' => [
            'type'  => 'redis',
            'queue' => 'default',
        ],
    ],
];
```

生产消息：

```php
use think\facade\Queue;

Queue::push(\app\job\SendEmail::class, ['to' => 'a@b.com', 'content' => 'Hi']);
```

消费任务：

```php
<?php
namespace app\job;

class SendEmail
{
    public function fire($job, $data)
    {
        mail($data['to'], '通知', $data['content']);
        $job->delete(); // 完成后删除
    }
}
```

启动消费者：

```bash
php think queue:work --queue=default
```

---

## 十、验证器

### 10.1 内置验证规则

```php
<?php
namespace app\validate;

use think\Validate;

class User extends Validate
{
    protected $rule = [
        'name'  => 'require|max:25|token',
        'email' => 'require|email|unique:user',
        'age'   => 'number|between:1,120',
    ];

    protected $message = [
        'name.require' => '用户名必填',
        'email.email'  => '邮箱格式不对',
        'age.between'  => '年龄须在 1-120 之间',
    ];
}
```

控制器中使用：

```php
$this->validate($data, \app\validate\User::class);
```

### 10.2 自定义验证规则

```php
protected function checkPhone($value, $rule, $data)
{
    return preg_match('/^1[3-9]\d{9}$/', $value) ? true : '手机号格式不正确';
}
```

在 `$rule` 中引用：`'phone' => 'require|checkPhone'`。

---

## 十一、缓存

### 11.1 文件缓存（默认）

```php
use think\facade\Cache;

Cache::set('key', 'value', 3600);     // 写入，有效期 1 小时
Cache::get('key');                     // 读取
Cache::delete('key');                  // 删除
Cache::remember('count', function () {
    return Db::name('article')->count();
});                                    // 不存在时自动计算并缓存
```

### 11.2 Redis 缓存配置

```php
// config/cache.php
return [
    'default' => 'redis',
    'stores'  => [
        'file' => ['type' => 'File', 'path' => runtime_path('cache')],
        'redis' => [
            'type'       => 'Redis',
            'host'       => '127.0.0.1',
            'port'       => 6379,
            'password'   => '',
            'select'     => 0,
            'prefix'     => 'tp:',
            'expire'     => 3600,
        ],
    ],
];
```

生产环境建议使用 Redis，文件缓存在高并发下 I/O 瓶颈明显。

---

## 十二、TP6 vs TP8 对比

| 维度 | TP6 | TP8 |
|------|-----|-----|
| PHP 最低版本 | 7.2+ | 8.0+ |
| 类型系统 | 部分类型声明 | 全面严格类型（declare(strict_types=1)） |
| 性能 | 基准 QPS 约 8000 | 比 TP6 提升 20%-30%，启动更快 |
| 路由 | 基础路由 + 中间件 | 支持路由缓存、闭包延迟解析 |
| ORM | 成熟 | 新增模型属性、枚举支持 |
| 事件系统 | 扩展包实现 | 内置事件组件 |
| 多应用 | 扩展包 `think-multi-app` | 内置支持 |
| 容器 | PSR-11 基础 | 完整 DI 容器，自动注入更完善 |
| 模板引擎 | Think/Blade 可选 | 默认 Blade，原生支持 |
| 命令行 | 基础 | 增强 Artisan 风格命令 |
| 官方维护 | 安全补丁 | 活跃开发 |

> **结论**：新项目强烈建议直接使用 TP8，享受 PHP 8 新特性（属性、枚举、联合类型）和更好的性能。

---

## 十三、ThinkPHP vs Laravel 选型对比

| 维度 | ThinkPHP | Laravel |
|------|----------|---------|
| 社区 | 国内为主，中文资料丰富 | 全球化，英文资料为主 |
| 学习曲线 | 低，约定优于配置，1-2 天上手 | 中等，概念多（Service Provider、Facade） |
| 文档 | 全中文，示例多 | 英文官方文档质量极高 |
| ORM | 内置，类似 Eloquent，上手快 | Eloquent，功能更强大、生态更广 |
| 中间件 | 内置，够用 | 内置，功能更丰富 |
| 队列 | 扩展包 | 内置完整队列系统（支持 Redis/SQS/Database） |
| 缓存 | 内置 | 内置，Driver 更丰富 |
| 微服务 | 官方微服务套件（RPC、网关） | Lumen 轻量框架或 Octane 高性能方案 |
| 性能 | 启动快、开销小，QPS 约 8000-12000 | 启动稍重，QPS 约 5000-8000 |
| 适用场景 | 国内项目、快速开发、中小后台 | 国际化项目、中大型应用、复杂业务 |
| 招聘 | 国内认可度高 | 全球认可，薪资普遍更高 |

> **选型建议**：国内快速开发选 ThinkPHP；追求架构规范、团队成长、国际化选 Laravel。两者可并行学习。

---

## 十四、踩坑笔记（扩展）

| 坑 | 现象 | 解法 |
|----|------|------|
| **runtime 不可写** | 500 / 模板缓存失败 | `chmod -R 755 runtime/ && chown www-data:www-data runtime/` |
| **public 没指对** | 访问首页 404 / 暴露源码 | nginx root 必须是 `public/` 而不是项目根 |
| **路由不生效** | 提示控制器未定义 | TP6 默认开启路由，URL 必须命中 route 文件；想用伪静态 PATH_INFO 要关掉 `url_route_must` |
| **多应用模式** | 切到多应用后 URL 变了 | 装 `topthink/think-multi-app`，URL 变 `/应用/控制器/方法` |
| **跨域** | 前端拿不到响应 | 装 `topthink/think-cors` 或自己写中间件 |
| **Db 查询日志写爆** | runtime/log 几个 G | 生产 `app_debug=false`、`log.level=['error']` |
| **SQL 注入** | 拼接字符串导致注入 | 始终用参数绑定：`where('id', $id)` 而非 `where("id = {$id}")` |
| **N+1 查询** | 列表页接口超时 | `Model::with('relation')` 预加载关联，避免循环查询 |
| **队列死信** | 消费失败任务丢失 | 配置 `maxTries` + 失败写入死信队列表，定期人工排查 |
| **Redis 连接池耗尽** | 高并发下报连接错误 | 设置 `pconnect=false`，用完即释放；或使用连接池组件 |
| **Session 跨域丢失** | 前后端分离 Session 不共享 | 前端携带 Cookie，或改用 JWT Token 鉴权 |

---

## 参考

- 官网：<https://www.thinkphp.cn>
- 文档：<https://doc.thinkphp.cn>
- GitHub：<https://github.com/top-think/framework>

---

## 相关阅读

- [Yii2：高性能PHP框架](/categories/PHP/yii2-1/)
- [Laravel服务容器深度解析](/categories/PHP/Laravel/laravel-container/)
- [PHP设计模式实践](/categories/PHP/design-patterns/)
- [Composer自动加载原理](/categories/PHP/Laravel/composer-autoload/)
