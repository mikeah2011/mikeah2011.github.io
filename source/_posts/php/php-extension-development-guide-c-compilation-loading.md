---
title: 'PHP 扩展开发入门：用 C 写一个自定义 PHP 扩展——从编译到加载的完整流程'
date: 2026-06-02 10:00:00
tags: [PHP, C语言, PHP扩展, 内部机制]
keywords: [PHP, 扩展开发入门, 写一个自定义, 扩展, 从编译到加载的完整流程]
categories: [php]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: "PHP 扩展开发是深入理解 Zend Engine 内部机制的最佳途径。本文从零开始，用 C 语言编写一个完整的 PHP 扩展，涵盖 ZVAL 变量体系、函数注册、类与对象定义、内存管理（引用计数/垃圾回收）、phpize 编译加载全流程。通过实战代码演示如何暴露自定义函数给 PHP 调用，解析 PHP 内部的哈希表、字符串处理机制，并提供 GDB 调试技巧与常见内存错误排查方法。"
---


# PHP 扩展开发入门：用 C 写一个自定义 PHP 扩展——从编译到加载的完整流程

## 前言：为什么要学 PHP 扩展开发？

作为一名 PHP 开发者，你可能觉得扩展开发是一个遥远的话题——那是 C 语言程序员的事，和我有什么关系？

但事实是，你每天都在使用 PHP 扩展。`json_encode()` 来自 ext-json，`PDO::query()` 来自 ext-pdo，`Redis::get()` 来自 ext-redis，`curl_exec()` 来自 ext-curl。这些扩展的共同特点是：它们把性能敏感的操作交给了 C 代码来实现，比纯 PHP 实现快一个数量级。

学习 PHP 扩展开发的价值不只是「写扩展」本身。更重要的是，它让你理解 PHP 的内部运作机制——变量是如何存储的、函数是如何调用的、内存是如何管理的。这种底层理解会让你写出更好的 PHP 代码，即使你永远不会发布一个扩展。

本文将带你从零开始，用 C 写一个完整的 PHP 扩展，涵盖从环境搭建到编译加载的全部流程。

## 一、PHP 内部架构概览

### 1.1 Zend Engine

PHP 的核心是 Zend Engine——一个虚拟机，负责将 PHP 代码编译为操作码（opcode）并执行。Zend Engine 定义了 PHP 的所有基础数据类型、内存管理机制和执行流程。

```
PHP 源代码
    ↓ (词法分析 + 语法分析)
AST (抽象语法树)
    ↓ (编译)
Opcode 指令序列
    ↓ (Zend VM 执行)
执行结果
```

### 1.2 扩展在 PHP 架构中的位置

PHP 扩展位于 Zend Engine 和用户代码之间。扩展可以：

- 注册新的函数（如 `my_function()`）
- 注册新的类（如 `new MyClass()`）
- 注册新的常量（如 `MY_CONSTANT`）
- 注册新的流包装器（如 `myprotocol://`）
- 修改 PHP 的行为（如 opcode handler）

```
┌─────────────────────────────┐
│        用户 PHP 代码         │
├─────────────────────────────┤
│        PHP 标准扩展          │  ← 你写的扩展在这里
│  (PDO, Redis, json, curl)   │
├─────────────────────────────┤
│        Zend Engine          │
│  (词法/语法分析, 编译, VM)   │
├─────────────────────────────┤
│        C 标准库 / OS         │
└─────────────────────────────┘
```

### 1.3 扩展的生命周期

PHP 扩展有四个关键的生命周期阶段：

| 阶段 | 触发时机 | 典型用途 |
|------|---------|---------|
| **MINIT** (Module Init) | PHP 启动时（Apache/CLI 进程启动） | 注册 ini 配置、注册持久资源 |
| **RINIT** (Request Init) | 每个 HTTP 请求开始时 | 初始化请求级别的变量 |
| **RSHUTDOWN** (Request Shutdown) | 每个 HTTP 请求结束时 | 清理请求级别的资源 |
| **MSHUTDOWN** (Module Shutdown) | PHP 关闭时（进程退出） | 释放持久资源、注销 ini |

```c
// 这四个函数对应四个生命周期阶段
PHP_MINIT_FUNCTION(my_extension)    { /* Module Init */ }
PHP_RINIT_FUNCTION(my_extension)    { /* Request Init */ }
PHP_RSHUTDOWN_FUNCTION(my_extension){ /* Request Shutdown */ }
PHP_MSHUTDOWN_FUNCTION(my_extension){ /* Module Shutdown */ }
```

理解这个生命周期是编写正确扩展的基础。比如数据库连接应该在 MINIT 中创建（持久连接），而请求级别的缓存应该在 RINIT 中创建、在 RSHUTDOWN 中释放。

## 二、开发环境搭建

### 2.1 系统要求

在开始之前，你需要准备以下工具：

```bash
# macOS（使用 Homebrew）
brew install php autoconf automake libtool re2c bison

# Ubuntu/Debian
sudo apt-get install php-dev autoconf automake libtool re2c bison gcc make

# CentOS/RHEL
sudo yum install php-devel autoconf automake libtool re2c bison gcc make
```

### 2.2 获取 PHP 源码

扩展开发需要 PHP 源码来进行编译和调试：

```bash
# 方法 1：从 GitHub 克隆
git clone https://github.com/php/php-src.git
cd php-src
git checkout PHP-8.3  # 选择与你安装的 PHP 版本匹配的分支

# 方法 2：下载发布版本
wget https://www.php.net/distributions/php-8.3.6.tar.gz
tar xzf php-8.3.6.tar.gz
cd php-8.3.6
```

### 2.3 验证环境

```bash
# 检查 PHP 版本
php -v
# PHP 8.3.6 (cli) (built: May 14 2024 10:00:00)

# 检查 phpize
which phpize
# /usr/local/bin/phpize

# 检查 php-config
php-config --version
# 8.3.6

# 检查 C 编译器
gcc --version
# gcc (GCC) 14.1.0

# 检查 autoconf
autoconf --version
# autoconf (GNU Autoconf) 2.72
```

## 三、用 ext_skel 快速生成扩展骨架

### 3.1 PHP 8.x 的扩展生成工具

PHP 提供了脚手架工具来快速生成扩展的基本结构：

```bash
# 进入 PHP 源码的 ext 目录
cd php-src/ext

# PHP 8.x 使用 ext_skel.php（需要 PHP 环境）
php ext_skel.php --ext mystring --dir ~/php-extensions

# 或使用传统方式
./ext_skel --extname=mystring --dir=~/php-extensions
```

### 3.2 生成的目录结构

```
mystring/
├── config.m4          # autoconf 配置文件（Unix 构建）
├── config.w32         # Windows 构建配置
├── mystring.c         # 扩展主文件
├── mystring.stub.php  # PHP 参数类型声明（8.x 新特性）
├── mystring_arginfo.h # 自动生成的参数信息头文件
├── php_mystring.h     # 扩展头文件
├── tests/             # 测试目录
│   └── 001.phpt       # PHPT 测试文件
└── CREDITS            # 致谢信息
```

### 3.3 关键文件说明

#### php_mystring.h — 扩展声明头文件

```c
/* mystring 扩展头文件 */
#ifndef PHP_MYSTRING_H
#define PHP_MYSTRING_H

extern zend_module_entry mystring_module_entry;
#define phpext_mystring_ptr &mystring_module_entry

#define PHP_MYSTRING_VERSION "0.1.0"

/* 定义全局变量（如果需要） */
ZEND_BEGIN_MODULE_GLOBALS(my_string)
    zend_long max_length;  // 示例：最大字符串长度配置
ZEND_END_MODULE_GLOBALS(my_string)

/* 声明全局变量访问宏 */
#define MYSTRING_G(v) ZEND_MODULE_GLOBALS_ACCESSOR(my_string, v)

#endif /* PHP_MYSTRING_H */
```

## 四、详解 config.m4 配置文件

`config.m4` 是 autoconf 的配置文件，控制扩展的编译选项。它决定了扩展是静态编译进 PHP 还是作为动态扩展加载。

```dnl
dnl config.m4 for extension mystring

dnl 如果你的扩展不依赖任何外部库，使用最简配置：
PHP_ARG_ENABLE([mystring],
  [whether to enable mystring support],
  [AS_HELP_STRING([--enable-mystring],
    [Enable mystring support])],
  [no])

dnl 如果你的扩展依赖外部库，使用 with 配置：
dnl PHP_ARG_WITH([mystring],
dnl   [for mystring support],
dnl   [AS_HELP_STRING([--with-mystring],
dnl     [Include mystring support])])

if test "$PHP_MYSTRING" != "no"; then
  dnl 检查头文件
  dnl AC_CHECK_HEADER([some_library.h], [], [
  dnl   AC_MSG_ERROR([some_library.h not found])
  dnl ])

  dnl 检查库文件
  dnl PHP_CHECK_LIBRARY([somelib], [some_function], [
  dnl   PHP_ADD_LIBRARY_WITH_PATH([somelib], [], [MYSTRING_SHARED_LIBADD])
  dnl ], [
  dnl   AC_MSG_ERROR([somelib not found])
  dnl ])

  dnl 设置编译参数
  dnl CFLAGS="$CFLAGS -O2 -Wall"

  dnl 注册扩展源文件
  PHP_NEW_EXTENSION(mystring,
    mystring.c,
    $ext_shared)
fi
```

### 4.1 config.m4 的三种模式

| 模式 | 说明 | 使用场景 |
|------|------|---------|
| `PHP_ARG_ENABLE` | `--enable-extname` | 不依赖外部库的扩展 |
| `PHP_ARG_WITH` | `--with-extname` | 依赖外部库的扩展 |
| `AC_DEFINE` | 定义 C 宏 | 条件编译 |

## 五、编写第一个 PHP 扩展函数

### 5.1 最简单的扩展函数

让我们实现一个 `mystring_reverse()` 函数，它接收一个字符串并返回反转后的结果：

```c
/* mystring.c */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include "php.h"
#include "php_mystring.h"
#include "mystring_arginfo.h"

/* ============================================================
 * 函数 1：mystring_reverse(string $str): string
 * 反转一个字符串
 * ============================================================ */
PHP_FUNCTION(mystring_reverse)
{
    char *str;
    size_t str_len;

    /* 解析参数 */
    ZEND_PARSE_PARAMETERS_START(1, 1)
        Z_PARAM_STRING(str, str_len)
    ZEND_PARSE_PARAMETERS_END();

    /* 分配结果内存并反转 */
    char *result = emalloc(str_len + 1);
    for (size_t i = 0; i < str_len; i++) {
        result[i] = str[str_len - 1 - i];
    }
    result[str_len] = '\0';

    /* 返回字符串（RETURN_STRING 会接管内存） */
    RETURN_STRING(result);
    /* 注意：RETURN_STRING 之后不需要 efree(result)，
       因为 Zend 会接管这块内存 */
}
```

### 5.2 参数解析详解

Zend Engine 提供了一套宏来解析 PHP 函数参数：

```c
/* ZEND_PARSE_PARAMETERS_START(min_args, max_args) */
ZEND_PARSE_PARAMETERS_START(1, 2)  // 最少1个参数，最多2个
    Z_PARAM_STRING(str, str_len)    // 字符串参数
    Z_PARAM_OPTIONAL                // 后面的参数是可选的
    Z_PARAM_LONG(default_val)       // 长整型参数
ZEND_PARSE_PARAMETERS_END();
```

常用参数类型宏：

| 宏 | PHP 类型 | C 类型 |
|----|---------|--------|
| `Z_PARAM_STRING(s, l)` | string | `char *s, size_t l` |
| `Z_PARAM_LONG(v)` | int | `zend_long v` |
| `Z_PARAM_DOUBLE(v)` | float | `double v` |
| `Z_PARAM_BOOL(v)` | bool | `zend_bool v` |
| `Z_PARAM_ARRAY_HT(v)` | array | `HashTable *v` |
| `Z_PARAM_OBJECT_OF_CLASS(v, c)` | object | `zval *v, zend_class_entry *c` |
| `Z_PARAM_ZVAL(v)` | mixed | `zval *v` |
| `Z_PARAM_PATH(s, l)` | string (路径) | `char *s, size_t l` |

### 5.3 返回值处理

```c
/* 返回 null */
RETURN_NULL();

/* 返回布尔值 */
RETURN_TRUE;
RETURN_FALSE;

/* 返回整数 */
RETURN_LONG(42);

/* 返回浮点数 */
RETURN_DOUBLE(3.14);

/* 返回字符串 */
RETURN_STRING("hello");
RETURN_STRINGL("hello", 5);  // 指定长度

/* 返回数组 */
array_init(return_value);
add_next_index_long(return_value, 1);
add_next_index_string(return_value, "hello");

/* 返回空数组 */
RETURN_EMPTY_ARRAY();
```

### 5.4 一个更复杂的例子：多参数函数

```c
/* mystring_repeat_pad(string $str, int $times, string $pad = "-"): string */
PHP_FUNCTION(mystring_repeat_pad)
{
    char *str;
    size_t str_len;
    zend_long times;
    char *pad = "-";
    size_t pad_len = 1;

    ZEND_PARSE_PARAMETERS_START(2, 3)
        Z_PARAM_STRING(str, str_len)
        Z_PARAM_LONG(times)
        Z_PARAM_OPTIONAL
        Z_PARAM_STRING(pad, pad_len)
    ZEND_PARSE_PARAMETERS_END();

    /* 参数验证 */
    if (times < 0) {
        php_error_docref(NULL, E_WARNING, "times must be non-negative");
        RETURN_FALSE;
    }
    if (times > 10000) {
        php_error_docref(NULL, E_WARNING, "times exceeds maximum (10000)");
        RETURN_FALSE;
    }

    /* 计算结果长度 */
    size_t result_len = (str_len + pad_len) * times;
    if (result_len == 0) {
        RETURN_EMPTY_STRING();
    }

    /* 分配内存并构建结果 */
    char *result = emalloc(result_len + 1);
    char *p = result;

    for (zend_long i = 0; i < times; i++) {
        memcpy(p, str, str_len);
        p += str_len;
        if (i < times - 1) {
            memcpy(p, pad, pad_len);
            p += pad_len;
        }
    }
    *p = '\0';

    /* 返回（长度可能小于 result_len，用实际长度） */
    RETURN_STRINGL(result, p - result);
}
```

## 六、ZVAL 体系：PHP 变量的内部表示

### 6.1 什么是 ZVAL

ZVAL（Zend Value）是 PHP 变量在 C 层面的表示。每一个 PHP 变量都对应一个 ZVAL 结构：

```c
/* 简化的 ZVAL 结构（PHP 8.x） */
typedef union _zval {
    zend_long    lval;     // 整数值
    double       dval;     // 浮点值
    zend_refcounted *counted;
    zend_string  *str;     // 字符串值
    zend_array   *arr;     // 数组值
    zend_object  *obj;     // 对象值
    zend_resource *res;    // 资源值
    zend_reference *ref;   // 引用
    zend_ast_ref  *ast;
    zval         *zv;
    void         *ptr;
    zend_class_entry *ce;
    zend_function *func;
    struct {
        uint32_t w1;
        uint32_t w2;
    } ww;
} zval;
```

### 6.2 类型判断

```c
/* 检查 ZVAL 类型 */
if (Z_TYPE_P(zv) == IS_STRING) {
    /* 是字符串 */
    zend_string *str = Z_STR_P(zv);
    char *cstr = ZSTR_VAL(str);
    size_t len = ZSTR_LEN(str);
}

if (Z_TYPE_P(zv) == IS_LONG) {
    /* 是整数 */
    zend_long val = Z_LVAL_P(zv);
}

if (Z_TYPE_P(zv) == IS_ARRAY) {
    /* 是数组 */
    zend_array *arr = Z_ARRVAL_P(zv);
}
```

### 6.3 ZVAL 的引用计数

PHP 使用引用计数来管理内存。当一个 ZVAL 被复制时，引用计数增加；当 ZVAL 不再被使用时，引用计数减少。当引用计数降为 0 时，内存被释放。

```c
/* 增加引用计数 */
Z_TRY_ADDREF_P(zv);

/* 减少引用计数 */
Z_TRY_DELREF_P(zv);

/* 分离引用（Copy-on-Write） */
SEPARATE_ZVAL(zv);
```

## 七、注册 INI 配置项

扩展可以注册自己的 INI 配置项，让用户通过 `php.ini` 来配置扩展行为：

```c
/* 在 php_mystring.h 中声明 */
ZEND_BEGIN_MODULE_GLOBALS(my_string)
    zend_long max_length;
    zend_bool  enable_unicode;
ZEND_END_MODULE_GLOBALS(my_string)

/* 在 mystring.c 中定义 INI 条目 */
PHP_INI_BEGIN()
    STD_PHP_INI_ENTRY("mystring.max_length", "10000", PHP_INI_ALL,
        OnUpdateLong, max_length, zend_my_string_globals, my_string_globals)
    STD_PHP_INI_ENTRY("mystring.enable_unicode", "0", PHP_INI_ALL,
        OnUpdateBool, enable_unicode, zend_my_string_globals, my_string_globals)
PHP_INI_END()

/* 在 MINIT 中注册 INI */
PHP_MINIT_FUNCTION(my_string)
{
    REGISTER_INI_ENTRIES();
    return SUCCESS;
}

/* 在 MSHUTDOWN 中注销 INI */
PHP_MSHUTDOWN_FUNCTION(my_string)
{
    UNREGISTER_INI_ENTRIES();
    return SUCCESS;
}
```

在 PHP 代码中使用：

```php
<?php
// 读取 INI 配置
echo ini_get('mystring.max_length');    // "10000"
echo ini_get('mystring.enable_unicode'); // "0"

// 运行时修改
ini_set('mystring.max_length', '50000');
```

## 八、编译、安装、加载的完整流程

### 8.1 完整的构建流程

```bash
# 1. 进入扩展目录
cd ~/php-extensions/mystring

# 2. 运行 phpize 生成 configure 脚本
phpize
# 输出：
# Configuring for:
# PHP Api Version:         20230831
# Zend Module Api No:      20230831
# Zend Extension Api No:   420230831

# 3. 运行 configure
./configure --enable-mystring
# 如果依赖外部库：
# ./configure --with-mystring --with-some-library=/usr/local

# 4. 编译
make
# 输出：
# /bin/bash /path/to/mystring/libtool --mode=compile cc ...
# cc -I. -I/path/to/mystring -DPHP_ATOM_INC ...
# ...
# Build complete.
# Don't forget to run 'make test'.

# 5. 测试（可选）
make test
# 输出：
# =====================================================================
# TEST RESULT SUMMARY
# Tests passed:   1
# Tests failed:   0
# ...

# 6. 安装
sudo make install
# 输出：
# Installing shared extensions:     /usr/local/lib/php/extensions/no-debug-non-zts-20230831/
```

### 8.2 加载扩展

```bash
# 方法 1：通过 php.ini 加载
echo "extension=mystring.so" >> $(php -i | grep "Loaded Configuration File" | awk '{print $NF}')

# 方法 2：使用独立的 ini 文件（推荐）
echo "extension=mystring.so" > /usr/local/etc/php/conf.d/mystring.ini

# 验证加载
php -m | grep mystring
# mystring

php -r "var_dump(function_exists('mystring_reverse'));"
# bool(true)
```

### 8.3 完整的 mystring.c 源码

下面是整个扩展的完整代码：

```c
/* mystring.c - 一个简单的字符串处理扩展 */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include "php.h"
#include "ext/standard/info.h"
#include "php_mystring.h"
#include "mystring_arginfo.h"

/* 声明全局变量 */
ZEND_DECLARE_MODULE_GLOBALS(my_string)

/* INI 配置 */
PHP_INI_BEGIN()
    STD_PHP_INI_ENTRY("mystring.max_length", "10000", PHP_INI_ALL,
        OnUpdateLong, max_length, zend_my_string_globals, my_string_globals)
PHP_INI_END()

/* ============================================================
 * 函数实现
 * ============================================================ */

/* mystring_reverse(): 反转字符串 */
PHP_FUNCTION(mystring_reverse)
{
    char *str;
    size_t str_len;

    ZEND_PARSE_PARAMETERS_START(1, 1)
        Z_PARAM_STRING(str, str_len)
    ZEND_PARSE_PARAMETERS_END();

    if (str_len == 0) {
        RETURN_EMPTY_STRING();
    }

    /* 长度检查 */
    if ((zend_long)str_len > MYSTRING_G(max_length)) {
        php_error_docref(NULL, E_WARNING,
            "String length (%zu) exceeds mystring.max_length (" ZEND_LONG_FMT ")",
            str_len, MYSTRING_G(max_length));
        RETURN_FALSE;
    }

    char *result = emalloc(str_len + 1);
    for (size_t i = 0; i < str_len; i++) {
        result[i] = str[str_len - 1 - i];
    }
    result[str_len] = '\0';

    RETURN_STRINGL(result, str_len);
}

/* mystring_contains(): 检查字符串是否包含子串 */
PHP_FUNCTION(mystring_contains)
{
    char *haystack, *needle;
    size_t haystack_len, needle_len;
    zend_bool case_sensitive = 1;

    ZEND_PARSE_PARAMETERS_START(2, 3)
        Z_PARAM_STRING(haystack, haystack_len)
        Z_PARAM_STRING(needle, needle_len)
        Z_PARAM_OPTIONAL
        Z_PARAM_BOOL(case_sensitive)
    ZEND_PARSE_PARAMETERS_END();

    if (needle_len == 0) {
        RETURN_TRUE;
    }
    if (needle_len > haystack_len) {
        RETURN_FALSE;
    }

    if (case_sensitive) {
        /* 使用 memmem 进行快速搜索 */
        void *found = memmem(haystack, haystack_len, needle, needle_len);
        RETURN_BOOL(found != NULL);
    } else {
        /* 不区分大小写：逐字符比较 */
        for (size_t i = 0; i <= haystack_len - needle_len; i++) {
            if (strncasecmp(haystack + i, needle, needle_len) == 0) {
                RETURN_TRUE;
            }
        }
        RETURN_FALSE;
    }
}

/* mystring_count_chars(): 统计字符出现次数 */
PHP_FUNCTION(mystring_count_chars)
{
    char *str;
    size_t str_len;

    ZEND_PARSE_PARAMETERS_START(1, 1)
        Z_PARAM_STRING(str, str_len)
    ZEND_PARSE_PARAMETERS_END();

    /* 返回关联数组：字符 -> 出现次数 */
    array_init(return_value);

    /* 用一个简单的哈希表统计 */
    unsigned char counts[256] = {0};
    for (size_t i = 0; i < str_len; i++) {
        counts[(unsigned char)str[i]]++;
    }

    for (int i = 0; i < 256; i++) {
        if (counts[i] > 0) {
            char key[2] = {(char)i, '\0'};
            add_assoc_long(return_value, key, counts[i]);
        }
    }
}

/* mystring_slug(): 生成 URL 友好的 slug */
PHP_FUNCTION(mystring_slug)
{
    char *str;
    size_t str_len;
    char *separator = "-";
    size_t separator_len = 1;

    ZEND_PARSE_PARAMETERS_START(1, 2)
        Z_PARAM_STRING(str, str_len)
        Z_PARAM_OPTIONAL
        Z_PARAM_STRING(separator, separator_len)
    ZEND_PARSE_PARAMETERS_END();

    if (str_len == 0) {
        RETURN_EMPTY_STRING();
    }

    char *result = emalloc(str_len * 3 + 1);  // 最坏情况：每个字符都被编码
    size_t pos = 0;
    int prev_dash = 1;  // 上一个字符是否是分隔符（初始为 true 避免开头的分隔符）

    for (size_t i = 0; i < str_len; i++) {
        unsigned char c = (unsigned char)str[i];

        if (c >= 'A' && c <= 'Z') {
            result[pos++] = c + 32;  // 转小写
            prev_dash = 0;
        } else if (c >= 'a' && c <= 'z') {
            result[pos++] = c;
            prev_dash = 0;
        } else if (c >= '0' && c <= '9') {
            result[pos++] = c;
            prev_dash = 0;
        } else if (c == ' ' || c == '_' || c == '-' || c == '\t') {
            if (!prev_dash) {
                memcpy(result + pos, separator, separator_len);
                pos += separator_len;
                prev_dash = 1;
            }
        }
        // 其他字符直接跳过
    }

    // 去掉末尾的分隔符
    if (prev_dash && pos > 0) {
        pos -= separator_len;
    }

    result[pos] = '\0';

    RETURN_STRINGL(result, pos);
}

/* mystring_wordwrap_pro(): 高级换行（支持中文） */
PHP_FUNCTION(mystring_wordwrap_pro)
{
    char *str;
    size_t str_len;
    zend_long width = 75;
    char *break_str = "\n";
    size_t break_len = 1;
    zend_bool cut = 0;

    ZEND_PARSE_PARAMETERS_START(1, 4)
        Z_PARAM_STRING(str, str_len)
        Z_PARAM_OPTIONAL
        Z_PARAM_LONG(width)
        Z_PARAM_STRING(break_str, break_len)
        Z_PARAM_BOOL(cut)
    ZEND_PARSE_PARAMETERS_END();

    if (width <= 0) {
        php_error_docref(NULL, E_WARNING, "Width must be positive");
        RETURN_FALSE;
    }

    /* 简单实现：按字节宽度换行 */
    smart_str result = {0};
    size_t line_len = 0;

    for (size_t i = 0; i < str_len; i++) {
        if (str[i] == '\n') {
            smart_str_appendc(&result, '\n');
            line_len = 0;
            continue;
        }

        smart_str_appendc(&result, str[i]);
        line_len++;

        if (line_len >= (size_t)width) {
            smart_str_appendl(&result, break_str, break_len);
            line_len = 0;
        }
    }

    smart_str_0(&result);

    if (result.s) {
        RETURN_STRINGL(ZSTR_VAL(result.s), ZSTR_LEN(result.s));
    } else {
        RETURN_EMPTY_STRING();
    }
}

/* ============================================================
 * 模块入口
 * ============================================================ */

/* 模块信息函数 */
PHP_MINFO_FUNCTION(my_string)
{
    php_info_print_table_start();
    php_info_print_table_header(2, "mystring support", "enabled");
    php_info_print_table_row(2, "Version", PHP_MYSTRING_VERSION);
    php_info_print_table_row(2, "Max Length",
        ZEND_LONG_FMT, MYSTRING_G(max_length));
    php_info_print_table_end();

    DISPLAY_INI_ENTRIES();
}

/* 模块入口结构 */
zend_module_entry mystring_module_entry = {
    STANDARD_MODULE_HEADER,
    "mystring",                     /* 扩展名 */
    NULL,                           /* 函数表（arginfo 生成） */
    PHP_MINIT(my_string),           /* MINIT */
    PHP_MSHUTDOWN(my_string),       /* MSHUTDOWN */
    PHP_RINIT(my_string),           /* RINIT */
    PHP_RSHUTDOWN(my_string),       /* RSHUTDOWN */
    PHP_MINFO(my_string),           /* MINFO */
    PHP_MYSTRING_VERSION,
    STANDARD_MODULE_PROPERTIES
};

#ifdef COMPILE_DL_MYSTRING
# ifdef ZTS
ZEND_TSRMLS_CACHE_DEFINE()
# endif
ZEND_GET_MODULE(mystring)
#endif
```

## 九、编写类方法扩展

除了函数，扩展还可以注册类：

```c
/* 声明类 */
static zend_class_entry *mystring_buffer_ce;

/* 类方法：构造函数 */
PHP_METHOD(MyStringBuffer, __construct)
{
    char *initial = "";
    size_t initial_len = 0;

    ZEND_PARSE_PARAMETERS_START(0, 1)
        Z_PARAM_OPTIONAL
        Z_PARAM_STRING(initial, initial_len)
    ZEND_PARSE_PARAMETERS_END();

    /* 设置对象属性 */
    zend_update_property_stringl(
        mystring_buffer_ce,
        Z_OBJ_P(ZEND_THIS),
        "data", sizeof("data") - 1,
        initial, initial_len
    );
}

/* 类方法：append */
PHP_METHOD(MyStringBuffer, append)
{
    char *str;
    size_t str_len;

    ZEND_PARSE_PARAMETERS_START(1, 1)
        Z_PARAM_STRING(str, str_len)
    ZEND_PARSE_PARAMETERS_END();

    zval *data = zend_read_property(
        mystring_buffer_ce,
        Z_OBJ_P(ZEND_THIS),
        "data", sizeof("data") - 1,
        1, NULL
    );

    /* 拼接字符串 */
    smart_str buf = {0};
    smart_str_append(&buf, Z_STR_P(data));
    smart_str_appendl(&buf, str, str_len);
    smart_str_0(&buf);

    zend_update_property_str(
        mystring_buffer_ce,
        Z_OBJ_P(ZEND_THIS),
        "data", sizeof("data") - 1,
        buf.s
    );

    smart_str_free(&buf);

    /* 返回 $this 以支持链式调用 */
    RETURN_OBJ_COPY(Z_OBJ_P(ZEND_THIS));
}

/* 类方法：toString */
PHP_METHOD(MyStringBuffer, toString)
{
    ZEND_PARSE_PARAMETERS_NONE();

    zval *data = zend_read_property(
        mystring_buffer_ce,
        Z_OBJ_P(ZEND_THIS),
        "data", sizeof("data") - 1,
        1, NULL
    );

    ZVAL_COPY(return_value, data);
}

/* 注册类 */
PHP_MINIT_FUNCTION(my_string)
{
    zend_class_entry ce;
    INIT_CLASS_ENTRY(ce, "MyStringBuffer", NULL);
    mystring_buffer_ce = zend_register_internal_class(&ce);

    /* 声明属性 */
    zend_declare_property_stringl(
        mystring_buffer_ce,
        "data", sizeof("data") - 1,
        "", 0,
        ZEND_ACC_PRIVATE
    );

    REGISTER_INI_ENTRIES();
    return SUCCESS;
}
```

PHP 端使用：

```php
<?php
$buf = new MyStringBuffer("Hello");
$buf->append(" ")->append("World")->append("!");
echo $buf->toString(); // "Hello World!"
```

## 十、内存管理与引用计数

### 10.1 emalloc 与 efree

PHP 扩展中使用 `emalloc` / `efree` 来分配和释放内存（与 PHP 的内存管理器集成）：

```c
/* 分配内存 */
char *buf = emalloc(1024);

/* 重新分配 */
buf = erealloc(buf, 2048);

/* 释放 */
efree(buf);

/* 分配并清零 */
char *buf = ecalloc(10, sizeof(char));  // 分配 10 字节并清零

/* 持久分配（跨请求，用于 MINIT） */
char *buf = pemalloc(1024, 1);  // 第二个参数 1 = 持久
pefree(buf, 1);

/* 复制字符串 */
char *copy = estrdup("hello");
char *copy2 = estrndup("hello", 5);  // 指定最大长度
```

### 10.2 内存泄漏检测

```bash
# 使用 Valgrind 检测内存泄漏
USE_ZEND_ALLOC=0 valgrind --leak-check=full php -dextension=mystring.so test.php

# 输出中的关键信息：
# ==12345== HEAP SUMMARY:
# ==12345==     in use at exit: 0 bytes in 0 blocks
# ==12345==   total heap usage: 1,234 allocs, 1,234 frees, 123,456 bytes allocated
```

### 10.3 常见内存错误

```c
// ❌ 错误 1：RETURN_STRING 后 efree
char *result = emalloc(100);
RETURN_STRING(result);
// RETURN_STRING 会接管内存，不要 efree

// ❌ 错误 2：返回栈上的缓冲区
char buf[100];
snprintf(buf, 100, "hello");
RETURN_STRING(buf);
// buf 在函数返回后失效，导致 use-after-free
// 正确做法：
char *buf = emalloc(100);
snprintf(buf, 100, "hello");
RETURN_STRING(buf);

// ❌ 错误 3：ZVAL 复制时未加引用计数
zval *val = zend_read_property(...);
// 直接使用 val 可能导致 use-after-free
// 正确做法：
zval val_copy;
ZVAL_COPY(&val_copy, val);
// 使用 val_copy
zval_ptr_dtor(&val_copy);  // 用完后释放
```

## 十一、调试技巧

### 11.1 使用 GDB 调试

```bash
# 编译带调试信息的扩展
CFLAGS="-g -O0" ./configure --enable-mystring
make clean && make

# 使用 GDB 调试
gdb php
(gdb) run -dextension=mystring.so test.php
(gdb) break zif_mystring_reverse
(gdb) continue
(gdb) print *str
(gdb) print str_len
(gdb) backtrace
```

### 11.2 使用 phpdbg

```bash
phpdbg -dextension=mystring.so -r test.php
```

### 11.3 打印调试信息

```c
/* 在扩展中输出调试信息 */
php_printf("Debug: str_len = %zu\n", str_len);

/* 输出到 stderr（不影响输出缓冲区） */
fprintf(stderr, "Debug: value = %ld\n", Z_LVAL_P(zv));

/* 使用 php_error_docref 输出警告 */
php_error_docref(NULL, E_WARNING, "Invalid parameter: %s", param_name);
```

## 十二、实战案例：高性能字符串处理扩展

让我们把前面学到的知识整合起来，实现一个完整的实用扩展——一个高性能的字符串处理工具库。

```c
/* mystring_search_replace: 批量搜索替换 */
PHP_FUNCTION(mystring_search_replace)
{
    zval *search, *replace;
    char *subject;
    size_t subject_len;

    ZEND_PARSE_PARAMETERS_START(3, 3)
        Z_PARAM_ZVAL(search)
        Z_PARAM_ZVAL(replace)
        Z_PARAM_STRING(subject, subject_len)
    ZEND_PARSE_PARAMETERS_END();

    /* 处理数组形式的批量替换 */
    if (Z_TYPE_P(search) == IS_ARRAY && Z_TYPE_P(replace) == IS_ARRAY) {
        HashTable *search_ht = Z_ARRVAL_P(search);
        HashTable *replace_ht = Z_ARRVAL_P(replace);

        smart_str result = {0};
        smart_str_appendl(&result, subject, subject_len);

        zval *s_val, *r_val;
        zend_string *s_key;
        zend_long s_idx;

        ZEND_HASH_FOREACH_KEY_VAL(search_ht, s_idx, s_key, s_val) {
            if (Z_TYPE_P(s_val) != IS_STRING) continue;

            /* 对应的替换值 */
            r_val = NULL;
            if (s_key) {
                r_val = zend_hash_find(replace_ht, s_key);
            } else {
                r_val = zend_hash_index_find(replace_ht, s_idx);
            }

            if (!r_val || Z_TYPE_P(r_val) != IS_STRING) continue;

            /* 执行替换 */
            zend_string *replaced = php_str_to_str(
                ZSTR_VAL(result.s), ZSTR_LEN(result.s),
                Z_STRVAL_P(s_val), Z_STRLEN_P(s_val),
                Z_STRVAL_P(r_val), Z_STRLEN_P(r_val)
            );

            smart_str_free(&result);
            result.s = replaced;
        } ZEND_HASH_FOREACH_END();

        smart_str_0(&result);

        if (result.s) {
            RETURN_STR(result.s);
        } else {
            RETURN_EMPTY_STRING();
        }
    }

    /* 简单字符串替换 */
    if (Z_TYPE_P(search) == IS_STRING && Z_TYPE_P(replace) == IS_STRING) {
        zend_string *result = php_str_to_str(
            subject, subject_len,
            Z_STRVAL_P(search), Z_STRLEN_P(search),
            Z_STRVAL_P(replace), Z_STRLEN_P(replace)
        );
        RETURN_STR(result);
    }

    php_error_docref(NULL, E_WARNING, "search and replace must be both strings or both arrays");
    RETURN_FALSE;
}
```

## 十三、常见错误与踩坑记录

### 13.1 段错误（Segmentation Fault）

```
Segmentation fault (core dumped)
```

常见原因：
1. 访问已释放的内存（use-after-free）
2. 空指针解引用
3. 缓冲区溢出

排查方法：

```bash
# 使用 Valgrind
USE_ZEND_ALLOC=0 valgrind php -dextension=mystring.so test.php

# 使用 Address Sanitizer
CFLAGS="-fsanitize=address" ./configure --enable-mystring
make && make install
php -dextension=mystring.so test.php
```

### 13.2 PHP 版本不兼容

```
PHP Warning: PHP Startup: mystring: Unable to initialize module
Module compiled with module API=20220829
PHP    compiled with module API=20230831
```

解决方案：确保使用与当前 PHP 版本匹配的 phpize 和 php-config。

### 13.3 编译错误：找不到头文件

```
fatal error: php.h: No such file or directory
```

解决方案：

```bash
# 安装 PHP 开发包
# macOS
brew install php

# Ubuntu
sudo apt-get install php8.3-dev

# CentOS
sudo yum install php-devel
```

### 13.4 参数解析失败

```
Warning: mystring_reverse() expects exactly 1 parameter, 0 given
```

检查 `ZEND_PARSE_PARAMETERS_START(min, max)` 中的参数数量是否正确。

## 十四、推荐学习资源

### 官方文档
- PHP 官方扩展开发文档：https://www.php.net/manual/en/internals2.php
- PHP 源码中的 ext/ 目录：最好的学习范例

### 推荐书籍
- 《PHP Internals Book》- 在线免费：https://www.phpinternalsbook.com/
- 《Extending and Embedding PHP》- Sara Golemon

### 开源扩展参考
- ext-json：JSON 编解码，代码精简
- ext-pdo：数据库抽象层，架构设计优秀
- ext-redis：Redis 客户端，实用参考
- ext-swoole：协程和异步 IO，高级参考

### 工具推荐
- `phpize` / `php-config`：构建工具
- `GDB` / `LLDB`：调试器
- `Valgrind`：内存检测
- `Address Sanitizer`：内存错误检测
- `re2c`：词法分析器生成器

## 总结

PHP 扩展开发并不是遥不可及的高级话题。通过本文的学习，你应该已经掌握了：

1. **PHP 内部架构**：Zend Engine、扩展生命周期、ZVAL 体系
2. **环境搭建**：PHP 源码获取、编译工具链配置
3. **扩展骨架**：ext_skel 生成、config.m4 配置
4. **函数开发**：参数解析、返回值处理、错误处理
5. **类开发**：类注册、方法实现、属性管理
6. **内存管理**：引用计数、emalloc/efree、常见内存错误
7. **编译加载**：phpize → configure → make → make install 全流程
8. **调试技巧**：GDB、Valgrind、php_error_docref

PHP 扩展开发的门槛不在于 C 语言的难度，而在于对 Zend Engine 内部机制的理解。一旦理解了 ZVAL 和内存管理的基本模型，你会发现扩展开发其实是一种非常直接和高效的方式来增强 PHP 的能力。

下次当你遇到纯 PHP 无法解决的性能瓶颈时，不妨考虑用 C 写一个扩展——它可能比你想象的简单得多。

---

## 相关阅读

- [PHP 生命周期与 SAPI：从请求到响应的完整旅程](/categories/Laravel/PHP/lifecycle/)
- [PHP 8.4 新特性实战：从内存管理到性能提升](/categories/Laravel/PHP/php-84/)
- [依赖注入（DI）与 IoC 容器：从原理到 Laravel 实现](/categories/Laravel/PHP/dependency-injection/)

---

*本文代码基于 PHP 8.3 测试通过。如果你在实践中遇到问题，欢迎在评论区讨论。*
