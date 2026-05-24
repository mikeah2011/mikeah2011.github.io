---
title: Opcache
tags: [PHP, 性能优化]
categories:
  - PHP
  - Runtime
date: 2019-03-20 15:05:07
description: 'OPcache 通过把 PHP 编译产物（opcode）缓存到共享内存，省掉每次请求的「读源码 → 词法 → 语法 → 编译」过程，是 PHP 生产环境性能优化的第一道关卡。'



---
## 一、为什么需要 OPcache

PHP 是脚本语言，**每次请求**默认都要走完整流程：

```
.php 源码 → 词法分析(Lexer) → 语法分析(Parser) → 编译(Compiler) → opcode → Zend VM 执行
                                                                         │
                                                                  ◀──────┘ 输出结果
```

在没有缓存的情况下，**只有最后一步是真正在做业务**，前面四步每个请求都重复跑一遍 —— 极其浪费。

**OPcache 把编译产物（opcode）缓存在共享内存（SHM）里**，下次同一个文件请求直接从内存拿编译好的 opcode 给 Zend VM 执行，跳过前四步。

> 性能提升：典型业务 QPS 提升 **2-3 倍**，CPU 使用率显著下降。PHP 5.5 起内置，开箱可用。

---

## 二、工作原理

```
请求 1：/index.php
  ├─ OPcache 查共享内存 → MISS
  ├─ 编译生成 opcode
  └─ 存入共享内存 + 执行

请求 2：/index.php
  ├─ OPcache 查共享内存 → HIT ✓
  └─ 直接执行（少了编译步骤）
```

**缓存 key**：通常是脚本的完整路径 + mtime。文件改了 mtime 变了，缓存自动失效（`validate_timestamps=1` 时）。

**存储**：mmap 出来的共享内存段，所有 PHP-FPM worker 进程共享，无需重复缓存。

---

## 三、生产环境推荐配置

`php.ini` 关键参数：

```ini
[opcache]
; 开关
opcache.enable=1
opcache.enable_cli=0                    ; CLI 通常不需要

; 内存大小：根据项目代码量调整，128M 起步，大项目 256-512M
opcache.memory_consumption=256

; 字符串内存（interned strings）
opcache.interned_strings_buffer=16

; 缓存的最大文件数：找一个比项目实际 .php 数量大的质数
opcache.max_accelerated_files=20000

; 【生产环境关键】不每次都检查文件 mtime
opcache.validate_timestamps=0

; 如果 validate_timestamps=1，多久检查一次（秒）
opcache.revalidate_freq=60

; 启用快速关闭（PHP-FPM 推荐）
opcache.fast_shutdown=1

; 缓存注释（Doctrine、Swagger 等用注解的框架必开）
opcache.save_comments=1

; JIT（PHP 8+，CPU 密集型有用，纯 IO 提升不大）
opcache.jit_buffer_size=128M
opcache.jit=tracing
```

### 开发环境差异

```ini
opcache.validate_timestamps=1     ; 改了文件立即生效
opcache.revalidate_freq=0
```

---

## 四、`validate_timestamps=0` 的部署陷阱

生产环境为了省 stat 系统调用，通常设 `validate_timestamps=0`。**带来的问题**：你部署了新代码，OPcache 还在用旧的 opcode，新代码不生效。

**3 种解法**：

| 方案 | 做法 | 适用场景 |
|------|------|----------|
| **重启 FPM** | `systemctl reload php-fpm` | 简单，但有短暂中断 |
| **运行时 reset** | `opcache_reset()` 或 `cachetool opcache:reset --fcgi=...` | 无中断，需要触发机制 |
| **原子部署** | 部署到新目录，软链切换 + reset | 大型项目最稳 |

推荐 [cachetool](https://github.com/gordalina/cachetool)：

```bash
cachetool opcache:reset --fcgi=/var/run/php-fpm.sock
```

---

## 五、监控与状态

### CLI 看状态

```bash
php -i | grep opcache
```

### 运行时看状态

```php
<?php
print_r(opcache_get_status(false));   // false = 不要文件列表，否则巨长
```

关键指标：

```
hits          # 命中次数
misses        # 未命中次数（越接近 0 越好，正常应 < 1%）
hit_rate      # 命中率，生产 > 99%
memory_usage  # 内存占用，free_memory 太低需要扩容
num_cached_keys / max_cached_keys   # 接近上限要调大 max_accelerated_files
```

### 可视化面板

- [opcache-gui](https://github.com/amnuts/opcache-gui)：一个 PHP 文件，扔到 web 目录就能看
- [opcache-status](https://github.com/rlerdorf/opcache-status)：Rasmus Lerdorf（PHP 之父）写的轻量版

---

## 六、常见问题

**Q: OPcache 和 APCu 冲突吗？**
A: 不冲突。OPcache 缓存 opcode，APCu 缓存用户数据（key-value），各管各的。

**Q: 用了 OPcache，注解还能用吗？**
A: 必须 `opcache.save_comments=1`，否则 Doctrine、Symfony、Swagger 等基于注解的框架会全部失效。

**Q: PHP 8 的 JIT 值得开吗？**
A: 看场景。**纯 Web 业务（数据库 + 渲染）提升 < 5%**，因为瓶颈在 IO；**计算密集（图像处理、数学运算）能提升 30%+**。先压测再决定。

**Q: 为什么 `opcache.max_accelerated_files` 推荐质数？**
A: OPcache 内部用哈希表存缓存，质数能减少哈希冲突。常用值：`16229 / 20011 / 32531 / 65407`。

---

## 参考

- PHP 官方文档：<https://www.php.net/manual/zh/book.opcache.php>
- 配置详解：<https://www.php.net/manual/zh/opcache.configuration.php>
- cachetool：<https://github.com/gordalina/cachetool>
