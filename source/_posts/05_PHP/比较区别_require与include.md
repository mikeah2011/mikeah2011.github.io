---
title: require 与 include 的区别（含 _once）
tags: [JavaScript, PHP]categories:
  - PHP
date: 2021-04-15 10:00:00
description: require / include 在 PHP 里加载文件的核心区别只有一个 —— 失败时是 Fatal Error 还是 Warning。本文加上 _once 变体、性能、autoload 时代的"几乎不再用"语义对比。
---

# 一句话

> **`require` 失败 → Fatal Error（脚本停）；`include` 失败 → Warning（脚本继续）。**
> 加 `_once` 后缀都能保证「只加载一次」。

# 核心对比

| 语句 | 找不到/解析失败 | 适用 |
|---|---|---|
| `require`      | E_COMPILE_ERROR，**脚本中止** | 必须加载的核心文件（配置、入口） |
| `require_once` | 同上，且**多次调用只执行一次** | 函数/类定义（防重复声明报错） |
| `include`      | E_WARNING，**继续执行** | 可选模板片段（如可选侧栏） |
| `include_once` | 同上，且**只加载一次** | 可选函数库 |

```php
require 'config.php';      // 没了直接死，应该死
include 'sidebar.html';    // 没了页面少个边栏，能接受
require_once 'User.php';   // class User 二次 require 会报 "Cannot redeclare"
```

# 一个最小验证

```php
// a.php
echo "before\n";
require 'not_exist.php';   // 换成 include 看差别
echo "after\n";            // require: 不会执行；include: 会执行
```

# `_once` 是怎么做到的

PHP 内核维护一个"已加载文件 realpath 表"，`_once` 加载前先查表：

- 命中 → 跳过
- 未命中 → 加载并写表

> **坑**：用相对路径或符号链接可能让 PHP 认为是不同文件而重复加载。**永远用 `__DIR__ . '/path'`**。

# 性能：`_once` 比普通慢吗？

历史上 `_once` 因为 realpath 比较略慢，PHP 5.3 起优化后差距 < 5%。**现代代码不需要为此做选择**，可读性优先。

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

# autoload 时代：require 几乎只在入口出现

PHP 5.3+ 的 SPL autoload + Composer 之后：

```php
// 整个项目通常只有一处 require
require __DIR__ . '/vendor/autoload.php';

$user = new App\Domain\User();   // 自动加载
```

**业务代码里不应该再出现 `require` 加载类**，那是 PHP 4 时代的写法。

# 速查表

| 想做的事 | 用 |
|---|---|
| 加载入口/配置 | `require` |
| 加载类（极少数手动场景） | `require_once` |
| 嵌入模板片段 | `include` |
| 现代项目加载类 | **autoload，不要手写 require** |

# 参考

- PHP 手册 - require: <https://www.php.net/manual/zh/function.require.php>
- PHP 手册 - include: <https://www.php.net/manual/zh/function.include.php>
- Composer Autoload: <https://getcomposer.org/doc/04-schema.md#autoload>
