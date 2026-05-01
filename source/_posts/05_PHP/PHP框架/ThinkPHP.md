---
title: ThinkPHP
tags:
  - PHP
  - 框架
  - ThinkPHP
categories:
  - PHP
  - PHP框架
date: 2019-03-20 15:05:07
description: 'ThinkPHP（TP）是国内使用最广的 PHP MVC 框架，文档全中文、约定优于配置，适合中小项目和后台快速搭建。本文梳理核心特性、目录结构和踩坑要点。'
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

## 参考

- 官网：<https://www.thinkphp.cn>
- 文档：<https://doc.thinkphp.cn>
- GitHub：<https://github.com/top-think/framework>
