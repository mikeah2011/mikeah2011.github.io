---
title: Yaf
tags:
  - PHP
  - 框架
  - C扩展
categories:
  - PHP
  - PHP框架
date: 2019-03-20 15:05:07
description: 'Yaf（Yet Another Framework）是鸟哥（Laruence）用 C 写的 PHP 框架扩展，作为 PHP extension 加载，跳过框架本身的解释开销，性能远超纯 PHP 框架。'
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

## 参考

- GitHub：<https://github.com/laruence/yaf>
- 文档：<https://www.php.net/manual/zh/book.yaf.php>
- 鸟哥博客：<https://www.laruence.com/>
