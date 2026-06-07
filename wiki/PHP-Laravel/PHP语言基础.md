# PHP 语言基础

## 定义
PHP 是一门服务端脚本语言，从 LAMP 栈时代进化到支持 Fibers、枚举、只读类等现代特性的语言。博客中覆盖了 OOP、类型系统、GC、并发模型、版本演进等核心主题。

## 核心原理

### 面向对象编程
- 类与对象、继承与多态、接口与抽象类
- Trait 混入、后期静态绑定（Late Static Binding）
- instanceof 与 method_exists 的使用场景

### 类型系统演进
- PHP 7.x：标量类型声明、返回值类型、nullable
- PHP 8.0：Named Arguments、Union Types、Match 表达式、Attributes
- PHP 8.1：Fibers、Enum、Intersection Types、Readonly Properties
- PHP 8.2：Readonly Classes、DNF Types
- PHP 8.3：Typed Class Constants、json_validate
- PHP 8.4：Property Hooks、不对称可见性、新数组函数

### 并发模型
- **进程**：PHP-FPM 每请求一进程/线程，无状态模型
- **协程**：PHP 8.1 Fibers 原生协程，支持 suspend/resume
- **Swoole**：C 扩展级协程，常驻内存，高性能
- 进程、线程、协程的对比

### 垃圾回收（GC）
- 引用计数 + 循环引用收集器
- zval 容器与 refcount
- 根缓冲区与标记清除

### 自动加载
- PSR-4 命名空间与目录映射
- Composer autoload（classmap、PSR-4、files）
- spl_autoload_register 机制

### 设计模式
- 消息幂等性设计模式（去重表、Inbox/Outbox）
- 策略模式、工厂模式、观察者模式
- 依赖注入（DI）与 IoC 容器

### PHP 工作原理
- Zend Engine 编译执行流程
- 词法分析 → 语法分析 → AST → Opcodes → 执行
- SAPI（Server API）：CLI、FPM、CGI 生命周期差异

## 实战案例
来自博客文章：
- [OOP - 面向对象](/categories/PHP/oop/) - 类、继承、多态
- [PHP 生命周期与 SAPI](/categories/PHP/lifecycle/) - CLI/FPM/CGI 差异
- [PHP 8.4 新特性实战](/categories/PHP/php-84/) - 内存管理与性能提升
- [PHP 8.2 readonly Classes](/categories/PHP-Laravel/php-82-readonly-classes-guide/) - 不可变对象
- [PHP 8.1 Fibers 实战](/categories/PHP-Laravel/php-81-fibers-guide/) - 协程并发
- [PHP 8 Trait + Enum 重构](/categories/PHP-Laravel/php-8-trait-enum-laravel-30/) - 30+ 仓库经验
- [PHP Enum 替魔术字符串](/categories/PHP-Laravel/php-enum-30/) - 重构经验
- [PHP 垃圾回收机制](/categories/PHP/gc/) - GC 原理
- [PHP 自动加载类机制](/categories/PHP/autoloading/) - PSR-4 与 Composer
- [依赖注入与 IoC 容器](/categories/PHP/dependency-injection/) - 控制反转
- [PHP 扩展开发入门](/categories/PHP/php-extension-development-guide/) - C 扩展
- [进程、线程和协程](/categories/PHP/vs/) - 并发模型
- [PHP 代码洁癖心得](/categories/PHP/code-optimization/) - 代码规范
- [PHP 5 与 PHP 7](/categories/PHP/php5php7/) - 版本差异
- [PHP 8.3 类型化类常量](/categories/PHP-Laravel/php-83-guide/) - 枚举增强
- [PHP 扩展开发入门](/categories/PHP/php-extension-development-guide/) - 用 C 写扩展

## 相关概念
- [Composer 生态](Composer生态.md) - 自动加载、插件开发、私有仓库
- [Laravel 框架核心](Laravel框架核心.md) - 服务容器、依赖注入的高级应用
- [性能优化](性能优化.md) - OPcache、Swoole、Fiber 并发
- [测试体系](测试体系.md) - Pest、PHPUnit

## 常见问题
- **PHP 是不是只能写 Web？** 不是，CLI 脚本、Swoole 微服务、ReactPHP 异步、PHP 扩展开发都可以
- **Fibers 和 Swoole 协程有什么区别？** Fibers 是语言级原生协程，需要手动调度；Swoole 是 C 扩展级协程，自动调度且常驻内存
- **为什么要做类型声明？** 提前发现 bug、IDE 智能提示、PHPStan 静态分析的基础
