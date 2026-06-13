---

title: PHP 垃圾回收机制（GC）
keywords: [PHP, GC, 垃圾回收机制]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- 性能优化
- 内存管理
- 垃圾回收
- GC
- WeakMap
- Swoole
categories:
- php
date: 2021-04-10 10:00:00
description: 深入解析PHP垃圾回收机制(GC)：从C层zval结构体、引用计数、写时复制到循环引用检测三色标记算法的完整原理。涵盖Xdebug/Blackfire内存泄漏排查、Swoole协程GC差异、WeakMap实战、gc_collect_cycles调优，对比Java/Go/Python GC，附Laravel队列Worker OOM排查案例。
---



# 一句话

> **PHP GC = 引用计数为主 + 循环引用收集器为辅。** 引用计数归零立刻释放，解决不了的循环引用由后台收集器周期清理。

---

# 一、zval 结构体：PHP 变量的底层容器

PHP 的每个变量在底层都是一个 `zval`（Zend Value）结构体。理解 zval 是理解 GC 的第一步。

## PHP 7/8 的 zval 结构（简化）

```c
// Zend/zend_types.h 简化版
typedef union _zvalue {
    zend_long   lval;      // 整型
    double      dval;      // 浮点型
    zend_string *str;      // 字符串
    zend_array  *arr;      // 数组
    zend_object *obj;      // 对象
    zend_resource *res;    // 资源
    zend_reference *ref;   // 引用（&$a）
    // ...
} zvalue;

typedef struct _zval {
    zvalue  value;         // 值
    union {
        struct {
            zend_uchar type;       // 类型标识 IS_LONG/IS_STRING/IS_OBJECT...
            zend_uchar type_flags; // 类型标志
            zend_uchar const_flags;
            zend_uchar reserved;
        } v;
        uint32_t type_info;
    } u1;
    union {
        uint32_t next;     // 链表下一个（用于符号表）
        uint32_t cache_slot;
        uint32_t opline_num;
    } u2;
} zval;
```

## PHP 7+ 的关键改进：引用计数外置

在 PHP 5 中，refcount 和 is_ref 直接嵌在 zval 里。PHP 7 做了重大重构：

- **普通变量**：zval 直接嵌入栈或数组桶（bucket），没有 refcount
- **引用类型（`&$a`）**：单独分配 `zend_reference` 结构，refcount 存在这里
- **字符串（`zend_string`）**：有自己的 refcount，支持 COW（写时复制）
- **对象（`zend_object`）**：引用计数在对象头部的 `gc` 字段中

```c
// zend_reference 结构
typedef struct _zend_reference {
    zend_refcounted_h gc;    // 引用计数头（refcount + gc_info）
    zval              val;   // 指向的实际值
    // PHP 8: 还有 attributes 等
} zend_reference;

// 引用计数头
typedef struct _zend_refcounted_h {
    uint32_t refcount;       // 引用计数
    union {
        uint32_t type_info;
        struct {
            zend_uchar type;
            zend_uchar flags;
            zend_uchar gc_flags;  // GC 标记：GC_WHITE/GC_BLACK/GC_PURPLE
            zend_uchar reserved;
        } v;
    } u;
} zend_refcounted_h;
```

> **核心变化**：zval 本身变轻量了（16 字节），引用计数只在需要共享的结构上存在。这意味着 PHP 7+ 大量临时变量不会产生额外的 refcount 开销。PHP 5 中每个变量至少 24 字节（zval 自身 16 + 引用计数头 8），而 PHP 7 的临时 zval 只有 16 字节且不需要 refcount 字段。在处理百万级循环变量时，这个改进带来的内存节省是非常可观的。

### zval 类型一览表

| 类型常量 | 说明 | refcount 位置 |
|---------|------|--------------|
| `IS_UNDEF` | 未定义 | 无 |
| `IS_NULL` | null | 无 |
| `IS_FALSE` / `IS_TRUE` | 布尔 | 无 |
| `IS_LONG` | 整型 | 无（值直接嵌入 zval） |
| `IS_DOUBLE` | 浮点型 | 无（值直接嵌入 zval） |
| `IS_STRING` | 字符串 | `zend_string.gc.refcount` |
| `IS_ARRAY` | 数组 | `zend_array.gc.refcount` |
| `IS_OBJECT` | 对象 | `zend_object.gc.refcount` |
| `IS_RESOURCE` | 资源 | `zend_resource.gc.refcount` |
| `IS_REFERENCE` | 引用（`&$a`） | `zend_reference.gc.refcount` |

> **关键理解**：标量类型（null、bool、int、float）没有 refcount，因为它们的值直接嵌在 zval 里，赋值就是拷贝值本身，不存在共享。只有字符串、数组、对象、资源和引用这些「堆上分配」的类型才有 refcount。

---

# 二、引用计数（refcount）

PHP 的垃圾回收第一道防线就是引用计数。每当一个 zval 被引用，refcount +1；引用断开，refcount -1；归零时立刻释放。

```php
$a = 'hello';         // zend_string refcount = 1
$b = $a;              // refcount = 2 （写时复制，COW：两个 zval 指向同一个 zend_string）
$c = &$a;             // 创建 zend_reference，$a 和 $c 共享引用

$b = 'world';         // COW 触发：$b 拷贝一份新字符串，原 refcount 回到 2
unset($a);            // zend_reference refcount = 1
unset($c);            // refcount = 0 → 立即释放
```

用 `xdebug_debug_zval()` 或 `debug_zval_refcount()` 可以看到 refcount：

```php
$a = 'hello';
xdebug_debug_zval('a');  // a: (refcount=1, is_ref=0)='hello'
$b = $a;
xdebug_debug_zval('a');  // a: (refcount=2, is_ref=0)='hello'
```

## 引用计数的局限

引用计数无法处理**循环引用**——两个或多个变量互相引用，即使外部已经访问不到它们，refcount 永远不会归零。

```php
$a = [];
$b = [];
$a['b'] = $b;   // $b 的数组 refcount = 2
$b['a'] = $a;   // $a 的数组 refcount = 2
unset($a, $b);  // 两个数组的 refcount 都降到 1，永不为 0 → 内存泄漏！
```

### 写时复制（Copy-on-Write）与 refcount 的协作

写时复制是 PHP 内存优化的核心策略之一。当两个变量共享同一个 zend_string 时，并不会立刻拷贝一份。只有当其中一个变量尝试**修改**时，才会触发真正的拷贝：

```php
$a = str_repeat('x', 1024 * 1024);  // 1MB 字符串，refcount = 1
$b = $a;                              // refcount = 2，不拷贝内容（COW）
// 此时 $a 和 $b 指向同一块 1MB 内存

$b = 'changed';  // 写操作触发 COW：$b 获得新字符串，原字符串 refcount 回到 1
// 如果 $b 只读取而不写入，COW 永远不触发，1MB 内存只有一份
```

这在函数参数传递时尤为重要。PHP 默认按值传递参数，但因为 COW 的存在，大数组传入函数只要不修改就不会产生额外内存开销。理解这个机制可以避免不必要的引用传递（`&`），同时也能预判哪些操作会触发内存翻倍。

### refcount 增减的完整触发条件

| 操作 | refcount 变化 | 说明 |
|------|-------------|------|
| `$b = $a` | +1 | 新变量指向同一值 |
| `unset($a)` | -1 | 变量从符号表移除 |
| 函数参数传入 | +1 | 形参指向实参的值 |
| 函数返回 | +1（调用侧）/ -1（函数内部） | 值传递到调用者 |
| `$a = null` | -1（旧值） | 赋新值时旧值引用断开 |
| 赋值给数组元素 | +1 | 数组桶引用该值 |
| 从数组移除 | -1 | 数组桶引用断开 |
| `$b = &$a` | 创建 zend_reference | 原值被引用包装 |
| `foreach ($arr as $v)` | +1（迭代变量） | PHP 7+ 优化为惰性拷贝 |

---

# 三、循环引用收集器（Cycle Collector）

PHP 5.3 引入了**同步循环引用收集器**，专门解决引用计数搞不定的循环引用。算法基于 IBM 论文 *"Concurrent Cycle Collection in Reference Counted Systems"*（Bacon & Rajan, 2001）。

## 算法核心：三种颜色标记

收集器使用三色标记系统（Purple / White / Black）配合引用计数来判定垃圾：

| 颜色 | 含义 |
|------|------|
| **Purple（紫色）** | 可疑节点：refcount 减少但未归零，可能是循环引用的一部分 |
| **White（白色）** | 候选垃圾：扫描后确认无外部引用 |
| **Black（黑色）** | 安全节点：有外部引用，不会被回收 |

## 逐步算法流程

### 第一步：根缓冲区（Root Buffer）

每当一个 refcounted 类型的值 refcount 减少但不为零时，它被标记为 **Purple** 并加入**根缓冲区**（root buffer）。缓冲区默认大小 **10,000** 个条目。

```c
// 简化伪代码：refcount 减少时的处理
void gc_remove_from_buffer(zval *z) {
    Z_REFVAL_P(z)->gc.u.v.gc_flags |= GC_PURPLE;  // 标记紫色
    GC_G(root_buffer)[GC_G(root_next)++] = z;      // 加入根缓冲区
    if (GC_G(root_next) >= GC_G(root_threshold)) {  // 缓冲区满？
        gc_collect_cycles();                          // 触发收集
    }
}
```

### 第二步：标记阶段（Mark）——找到真正的循环引用

从根缓冲区中的每个紫色节点出发：

1. 如果节点不是紫色，跳过（已被处理）
2. 将节点标记为**白色**（候选垃圾）
3. 递归遍历该节点引用的所有子节点，将它们的 refcount -1
4. 如果子节点也是紫色，递归处理

### 第三步：扫描阶段（Scan）——区分真垃圾和安全节点

再次遍历白色节点：

- 如果一个白色节点的 refcount **> 0**，说明有外部引用指向它，**不是垃圾** → 标记为黑色，恢复其 refcount
- 如果 refcount **= 0**，说明确实是循环引用孤岛 → 保持白色

### 第四步：收集阶段（Collect）——释放白色节点

遍历所有仍然为白色的节点，调用 `zval_ptr_dtor()` 释放它们占用的内存。

### 完整流程图

```
refcount 减少但 ≠ 0
         ↓
  标记为 Purple，加入 Root Buffer
         ↓
  Root Buffer 满（10,000 个）？
         ↓ 是
  ┌─── Mark 阶段 ───┐
  │ 紫色节点 → 白色   │
  │ 子节点 refcount-- │
  └──────────────────┘
         ↓
  ┌─── Scan 阶段 ────┐
  │ refcount > 0 → 黑 │  （安全，有外部引用）
  │ refcount = 0 → 白 │  （循环引用垃圾）
  └──────────────────┘
         ↓
  ┌─── Collect 阶段 ──┐
  │ 释放所有白色节点    │
  │ 返回释放数量        │
  └──────────────────┘
```

---

# 四、手动控制与 GC 调优

```php
gc_enabled();          // GC 是否开启
gc_enable();           // 开启 GC
gc_disable();          // 关闭 GC
gc_collect_cycles();   // 手动触发收集，返回回收数量
gc_status();           // PHP 7.3+ 查看 GC 统计信息
```

## gc_status() 返回值解读

```php
$status = gc_status();
print_r($status);
// Array (
//     [runs] => 12          // 已触发的 GC 次数
//     [collected] => 3456   // 已回收的变量数
//     [threshold] => 10000  // 根缓冲区触发阈值
//     [roots] => 0          // 当前缓冲区中的条目数
// )
```

## 何时手动调用 gc_collect_cycles()？

| 场景 | 建议 | 原因 |
|------|------|------|
| **CLI 长任务**（队列消费者、Daemon） | 每处理 N 个任务调一次 | 防止根缓冲区慢慢撑爆内存 |
| **处理大数组/大集合后** | `unset()` + `gc_collect_cycles()` | 立即回收，不等缓冲区满 |
| **Swoole / Workerman 常驻进程** | 每个请求结束时或定期调用 | 请求间不自动清理 |
| **内存敏感的批量导入** | 每批次调用 | 避免单次事务中内存暴涨 |
| **高吞吐 API** | 通常不需要 | PHP-FPM 请求结束时自动清理 |

## php.ini 配置

```ini
; php.ini
zend.enable_gc = On          ; 默认开启，不建议关闭
; 无直接配置项调整根缓冲区大小（编译时常量，源码中修改 GC_ROOT_BUFFER_MAX_ENTRIES）
```

> **注意**：关闭 GC（`zend.enable_gc = Off`）意味着循环引用永远不会被回收。在 CLI 长驻进程中关闭 GC 是非常危险的。

---

# 五、内存泄漏检测实战

## 5.1 内置函数打点监控

```php
// 1. 查看当前内存使用
echo "实际分配: " . memory_get_usage(true) . PHP_EOL;       // OS 级分配
echo "PHP 使用: " . memory_get_usage() . PHP_EOL;           // PHP 实际使用的
echo "峰值: " . memory_get_peak_usage(true) . PHP_EOL;

// 2. 在循环中打点，观察内存增长趋势
foreach ($items as $i => $item) {
    process($item);
    if ($i % 1000 === 0) {
        $mem = round(memory_get_usage(true) / 1024 / 1024, 2);
        echo "i={$i} mem={$mem}MB\n";
    }
}

// 3. gc_status 监控回收情况
$status = gc_status();
echo "GC runs: {$status['runs']}, collected: {$status['collected']}\n";
```

## 5.2 Xdebug 内存分析

```bash
# 启用 Xdebug 的内存分析功能
php -dxdebug.mode=profile script.php

# 查看 refcount
php -dxdebug.mode=develop script.php
```

```php
// Xdebug 提供的辅助函数
xdebug_debug_zval('varName');      // 查看变量的 zval 信息
xdebug_debug_zval_dump($var);      // 递归 dump
xdebug_memory_usage();              // 当前内存
xdebug_peak_memory_usage();         // 峰值内存
```

## 5.3 Blackfire 性能分析

```bash
# 安装 Blackfire CLI
blackfire run php script.php

# 查看内存分配热点
# Blackfire 会标注每个函数调用的内存分配量，精准定位"吃内存"的代码路径
```

Blackfire 的优势在于**生产环境低开销**（profiling 采样模式），适合在线上直接抓取内存分配热点，而 Xdebug 的 profile 模式会显著拖慢执行速度。

## 5.4 典型泄漏场景速查

| 场景 | 现象 | 修复 |
|------|------|------|
| 单例里挂 listener，listener 反向引用单例 | 长跑后 OOM | 用 `WeakMap`（PHP 8+）或显式 `unset` |
| 全局数组缓存无上限 | 内存稳步上涨 | LRU + 限容 |
| ORM 里 entity 互相 hasMany | 批量处理后没释放 | 处理完一批 `detach` / `detachAll` |
| `static` 局部变量累积 | 每次调用都涨 | 改成实例属性或外部缓存 |
| 事件监听器未解绑 | 每次注册都涨 | `WeakMap` 或 `off()` 解绑 |
| PDO Statement 未 closeCursor | 游标累积 | 显式 `closeCursor()` |

---

# 六、实战案例：Laravel 队列 Worker 内存泄漏排查

这是一个真实场景的排查过程，教你如何从「Worker 跑了 2 小时后 OOM」定位到根因。

## 6.1 问题现象

Laravel Horizon 的队列 Worker 处理邮件发送任务，跑了约 2 小时后报 `Allowed memory size exhausted`。

## 6.2 第一步：确认内存增长曲线

在 `AppServiceProvider` 中注册一个中间件或事件监听器，在每次任务处理后记录内存：

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Queue\Events\JobProcessed;

public function boot()
{
    Queue::after(function (JobProcessed $event) {
        $mem = round(memory_get_usage(true) / 1024 / 1024, 2);
        \Log::info("Job processed", [
            'job' => class_basename($event->job),
            'memory_mb' => $mem,
            'gc_collected' => gc_status()['collected'],
        ]);
    });
}
```

日志输出：
```
[INFO] Job processed {"job":"SendEmailJob","memory_mb":42.5,"gc_collected":0}
[INFO] Job processed {"job":"SendEmailJob","memory_mb":42.5,"gc_collected":0}
...
[INFO] Job processed {"job":"SendEmailJob","memory_mb":128.3,"gc_collected":156}
...
[INFO] Job processed {"job":"SendEmailJob","memory_mb":254.7,"gc_collected":312}
```

**内存持续增长**，即使 GC 在回收，也追不上泄漏速度。

## 6.3 第二步：缩小范围

手动在每个 Job 的 `handle()` 方法前后打点：

```php
public function handle()
{
    $before = memory_get_usage(true);
    $this->doWork();
    $after = memory_get_usage(true);
    $delta = ($after - $before) / 1024;
    \Log::info("Memory delta: {$delta}KB");
}
```

发现每处理一个 Job，内存增长约 **200KB** 且不回落。

## 6.3 第三步：Blackfire 抓取分配热点

```bash
blackfire run --samples=100 php artisan queue:work --once
```

Blackfire 火焰图显示：`Mail::send()` 内部的 `SwiftMailer` 创建了大量 `Swift_Message` 对象，这些对象被 Laravel 的 `Mailer` 单例通过 `events` 属性引用。

## 6.4 第四步：定位循环引用

```php
// 问题代码：在 EventServiceProvider 中注册了监听器
Event::listen(MessageSent::class, function ($event) {
    // $event->message (Swift_Message) 引用了 Mailer
    // Mailer 引用了 $event（通过 dispatcher）
    // 形成：Mailer → Dispatcher → Event → Message → Mailer 循环
    Log::info('Mail sent', ['to' => $event->message->getTo()]);
});
```

`Swift_Message` 对象和 `Mailer` 单例之间形成了循环引用。虽然 GC 最终会回收它们，但在高吞吐下根缓冲区来不及清空。

## 6.5 修复方案

```php
// 方案 1：在 Job 完成后手动 GC
public function handle()
{
    $this->doWork();
    gc_collect_cycles();  // 强制回收
}

// 方案 2：升级到 Symfony Mailer（Laravel 9+ 默认），减少循环引用
// 方案 3：让 Mailer 不持有事件引用
```

修复后，Worker 内存稳定在 **45MB** 左右，运行 24 小时无 OOM。

## 6.6 总结：Laravel 队列 Worker 内存排查清单

在排查 Laravel 队列 Worker 的内存问题时，建议按以下顺序逐步排查：

1. **确认是否真的有内存泄漏**：在 `Queue::after` 事件中记录内存使用，观察是否随任务数线性增长。如果内存稳定在某个值附近波动，说明 GC 正常工作，不需要干预。
2. **缩小范围**：在每个 Job 的 `handle()` 方法前后打点，计算内存增量（delta）。如果某个 Job 的 delta 持续为正且不回落，说明该 Job 有泄漏。
3. **检查 ORM 使用**：Eloquent 的 `Model` 对象之间容易形成循环引用（`belongsTo` + `hasMany`）。在批量处理中，每处理完一批应该调用 `Model::unsetRelations()` 或手动 `unset()`。
4. **检查事件监听器**：如果在 EventServiceProvider 中注册了监听器，确保监听器不会持有 Mailer、Dispatcher 等单例的引用。
5. **使用 Blackfire 抓取火焰图**：定位内存分配热点，找到「吃内存」最多的代码路径。
6. **定期调用 `gc_collect_cycles()`**：在 Worker 的 `daemon` 模式下，建议在每次 `sleep()` 前或每处理 N 个任务后调用一次。

---

# 七、Swoole 协程环境下的 GC 差异

Swoole 是 PHP 的常驻内存模型，与 PHP-FPM 的「请求结束即销毁」有本质区别，GC 行为也因此不同。

## 7.1 核心差异

| 维度 | PHP-FPM | Swoole |
|------|---------|--------|
| 生命周期 | 每个请求独立，请求结束自动清理 | 常驻内存，Worker 进程永不退出 |
| 全局变量 | 每次请求重新初始化 | 跨请求累积（内存泄漏风险） |
| GC 触发时机 | 请求结束时隐式清理 + 系统触发 | 只有缓冲区满或手动调用 |
| 静态属性 | 每次请求重建 | 跨请求保留（可能污染） |
| 连接对象 | 请求结束自动关闭 | 必须手动管理连接池 |

## 7.2 Swoole 中的 GC 最佳实践

```php
// ❌ 错误：全局缓存无限制增长
class Cache {
    protected static array $data = [];
    public static function set($key, $value) {
        self::$data[$key] = $value;  // 永远增长！
    }
}

// ✅ 正确：使用 Swoole\Table（共享内存，固定大小）
$table = new \Swoole\Table(1024);
$table->column('value', \Swoole\Table::TYPE_STRING, 256);
$table->create();

// ✅ 正确：协程上下文隔离
\Swoole\Coroutine\Run(function () {
    $db = new PDO(...);  // 协程内局部变量，协程结束自动释放
});
```

## 7.3 协程环境下的 GC 注意事项

```php
// 每个协程有独立的执行栈
go(function () {
    $a = [];
    $b = [];
    $a['ref'] = $b;
    $b['ref'] = $a;
    unset($a, $b);
    // 循环引用仍然存在！
    // Swoole 不会自动调用 gc_collect_cycles()
    // 需要在协程末尾手动调用或依赖缓冲区满触发
    gc_collect_cycles();
});
```

> **关键点**：Swoole 的 Worker 进程中，gc_collect_cycles() 不会在协程结束后自动调用。如果协程中创建了大量循环引用，必须手动触发 GC。

## 7.4 Swoole 协程上下文与 GC 的交互细节

Swoole 的协程模型与 PHP-FPM 有根本区别。在 PHP-FPM 中，每个请求有独立的执行环境，请求结束时 Zend Engine 会调用 `php_request_shutdown()`，这个函数内部会：

1. 销毁所有局部变量和全局变量
2. 调用 `gc_collect_cycles()` 回收循环引用
3. 关闭所有打开的资源（文件句柄、数据库连接等）
4. 释放 Zend Engine 的内存池

但在 Swoole 中，Worker 进程**不会**调用 `php_request_shutdown()`，而是通过协程切换来处理并发请求。这意味着：

```php
// Swoole Worker 处理请求的简化流程
Swoole\Runtime::enableCoroutine();  // 开启协程 Hook

$http = new Swoole\Http\Server('0.0.0.0', 9501);
$http->on('request', function ($req, $resp) {
    // 每个请求在独立协程中执行
    // 但 Worker 进程的全局状态不会重置
    static $counter = 0;  // 跨请求累积！
    $counter++;
    $resp->end("Request #{$counter}");
});
$http->start();
```

### 常驻内存下的 GC 策略建议

```php
// 方案 1：定时器触发 GC（推荐）
$server->tick(60000, function () {  // 每分钟
    $collected = gc_collect_cycles();
    $status = gc_status();
    \Swoole\Coroutine\System::writeFile('/tmp/gc.log',
        sprintf("[%s] collected=%d runs=%d memory=%dMB\n",
            date('Y-m-d H:i:s'),
            $collected,
            $status['runs'],
            round(memory_get_usage(true) / 1024 / 1024, 2)
        )
    );
});

// 方案 2：每个请求结束后触发（更及时但开销稍大）
$http->on('request', function ($req, $resp) {
    // 处理请求...
    $resp->end($body);
    gc_collect_cycles();  // 请求结束立刻回收
});

// 方案 3：内存阈值触发（智能策略）
$server->tick(10000, function () {  // 每 10 秒检查
    $mem = memory_get_usage(true);
    $limit = 256 * 1024 * 1024;  // 256MB 阈值
    if ($mem > $limit) {
        gc_collect_cycles();
        \Log::warning("GC triggered: memory exceeded threshold", [
            'memory_mb' => round($mem / 1024 / 1024, 2),
        ]);
    }
});
```

### Swoole Table 与共享内存的 GC 特性

`Swoole\Table` 是基于共享内存的高性能哈希表，它的内存是**预分配**的，不受 PHP GC 管理：

```php
$table = new \Swoole\Table(1024);  // 预分配 1024 行
$table->column('name', \Swoole\Table::TYPE_STRING, 64);
$table->column('score', \Swoole\Table::TYPE_INT, 4);
$table->create();

$table->set('player1', ['name' => 'Alice', 'score' => 100]);
$table->del('player1');  // 立即释放该行，不经过 GC

// Swoole\Table 的优势：
// 1. 固定大小，不会无限增长
// 2. 跨进程共享（fork 后的 Worker 可以共享访问）
// 3. 操作是原子的，不需要锁
// 4. 不受 PHP GC 影响，del 立即释放
```

---

# 八、PHP 8 新特性：WeakMap 与 WeakReference

## 8.1 WeakMap（PHP 8.0+）

`WeakMap` 是解决缓存/装饰器场景中内存泄漏的利器。它的键是**对象**，且**不增加对象的引用计数**。当键对象被销毁后，对应的条目自动从 WeakMap 中移除。

```php
$cache = new WeakMap();

$obj = new stdClass();
$cache[$obj] = 'cached metadata';  // 不影响 $obj 的 refcount

echo $cache[$obj];  // 'cached metadata'

unset($obj);        // $obj refcount → 0，对象销毁
echo count($cache); // 0 —— 条目自动消失了！
```

### 实际应用：Entity 缓存

```php
class EntityManager {
    private WeakMap $metadata = new WeakMap();

    public function getMetadata(object $entity): array {
        if (!isset($this->metadata[$entity])) {
            $this->metadata[$entity] = $this->computeMetadata($entity);
        }
        return $this->metadata[$entity];
    }

    // 不需要手动清理！当 $entity 被 GC 回收后，metadata 自动消失
}
```

### 实际应用：Decorator 模式

```php
class CacheDecorator {
    private WeakMap $cache;

    public function __construct() {
        $this->cache = new WeakMap();
    }

    public function wrap(object $service): object {
        if (!isset($this->cache[$service])) {
            $this->cache[$service] = new CachedService($service);
        }
        return $this->cache[$service];
    }
    // 当原始 $service 不再被引用时，缓存的包装对象也自动清理
}
```

## 8.2 WeakReference（PHP 8.0+）

`WeakReference` 比 `WeakMap` 更轻量，只持有一个对象的弱引用，不阻止 GC 回收。

```php
$obj = new stdClass();
$ref = WeakReference::create($obj);

echo $ref->get() !== null;  // true —— 对象还活着

unset($obj);
echo $ref->get();            // null —— 对象已被回收
```

### 实际应用：Observer 防泄漏

```php
class EventDispatcher {
    /** @var WeakReference[] */
    private array $listeners = [];

    public function addListener(object $listener): void {
        $this->listeners[] = WeakReference::create($listener);
    }

    public function dispatch(string $event): void {
        foreach ($this->listeners as $i => $ref) {
            $listener = $ref->get();
            if ($listener === null) {
                unset($this->listeners[$i]);  // 清理已销毁的监听器
                continue;
            }
            $listener->handle($event);
        }
    }
}
```

## 8.3 WeakMap vs WeakReference 对比

| 特性 | WeakMap | WeakReference |
|------|---------|---------------|
| 用途 | 对象→数据的映射缓存 | 持有对象的弱引用 |
| 键/目标 | 多个对象 | 单个对象 |
| 自动清理 | ✅ 键销毁时自动移除条目 | ❌ 需要手动检查 `get() === null` |
| 内存开销 | 较高（存储键值对） | 极低 |
| 典型场景 | Eloquent 缓存、Decorator 缓存 | Observer、连接池引用 |

---

# 九、GC 调优参数速查

| 配置/函数 | 说明 | 建议 |
|-----------|------|------|
| `zend.enable_gc = On` | 全局开关 | 生产环境必须开启 |
| `gc_collect_cycles()` | 手动触发 | CLI 长任务每 N 次操作调一次 |
| `gc_status()` | 查看 GC 统计 | PHP 7.3+，监控 `roots` 是否持续增长 |
| `gc_disable()` | 临时关闭 | 仅在确定无循环引用的性能关键路径使用 |
| `gc_enable()` | 重新开启 | 配对使用 |
| 根缓冲区大小（编译时常量） | 默认 10,000 | 需改 Zend Engine 源码重新编译 |

---

# 十、PHP GC vs Java GC vs Go GC vs Python GC

| 维度 | PHP | Java | Go | Python |
|------|-----|------|-----|--------|
| **主要策略** | 引用计数 + 循环收集器 | 分代 GC（G1/ZGC/Shenandoah） | 并发三色标记清除 | 引用计数 + 分代循环收集器 |
| **循环引用处理** | 同步 Cycle Collector | GC 根可达性分析自动处理 | 三色标记自动处理 | `gc` 模块循环收集器 |
| **STW（Stop-the-World）** | 极短（仅收集时） | 存在但 ZGC < 1ms | < 1ms（写屏障） | 存在（gc.freeze 等） |
| **分代收集** | ❌ 不分代 | ✅ Young/Old | ❌ 不分代 | ✅ 三代（0/1/2） |
| **调优手段** | 几乎无（缓冲区大小编译时常量） | GC 算法选择 + 参数调优 | `GOGC` + `GOMEMLIMIT` | `gc.set_threshold()` |
| **适用场景** | 短生命周期请求 | 大型企业应用 | 高并发服务 | 通用脚本 |
| **内存开销** | 低（请求级） | 高（堆空间预留） | 中等 | 中等 |
| **并发 GC** | ❌ 单线程 | ✅ 并发标记 | ✅ 并发标记 | ❌ 单线程 |
| **手动触发** | `gc_collect_cycles()` | `System.gc()`（建议） | `runtime.GC()` | `gc.collect()` |
| **内存泄漏风险** | 循环引用 + 常驻进程 | 静态引用 + 缓存无上限 | goroutine 泄漏 | 循环引用 + 全局缓存 |

### 各语言 GC 设计哲学

- **PHP**：「请求级」思维——大多数情况下不需要考虑 GC，因为请求结束一切归零。只有 CLI/Swoole 常驻进程才需要关注。PHP 的 GC 设计哲学是「简单高效」，以引用计数为主，辅以一个相对简单的循环收集器。这种设计在 Web 请求场景下表现优秀，因为大多数 PHP 脚本的生命周期很短（通常几十到几百毫秒），不需要复杂的分代或并发 GC。但如果在常驻内存场景下使用 PHP，就需要特别注意 GC 的局限性。
- **Java**：「分代假设」——大多数对象是短命的，所以年轻代用复制算法，老年代用标记清除。经过多年演进，ZGC 已经可以做到亚毫秒 STW。Java 的 GC 是所有语言中最复杂的，从最初的 Serial GC 到 Parallel GC，再到 CMS、G1、ZGC、Shenandoah，每一代都在追求更低的延迟和更高的吞吐量。对于大型企业应用来说，选择合适的 GC 算法和调优参数是性能优化的关键。
- **Go**：「低延迟优先」——并发三色标记 + 写屏障，配合 `GOMEMLIMIT`（Go 1.19+）实现软内存上限控制。适合微服务和高并发场景。Go 的 GC 设计非常激进，目标是保持 STW 时间在毫秒级甚至亚毫秒级，即使牺牲一些吞吐量。Go 1.19 引入的 `GOMEMLIMIT` 是一个重要改进，允许开发者设置软内存上限，避免在容器环境中被 OOM Killer 杀掉。
- **Python**：「引用计数为主，循环收集为辅」——和 PHP 最像，但 Python 的 GIL 让 GC 更简单但也限制了多线程性能。Python 的 GC 有三代（generation 0/1/2），新创建的对象在第 0 代，如果经过一次 GC 还存活就移到下一代。这种分代策略基于「大多数对象是短命的」的经验法则。Python 3.4 引入的分代 GC 改进了循环引用的检测效率，但在高并发场景下仍然是性能瓶颈。

### GC 选型建议

| 场景 | 推荐语言/方案 | 原因 |
|------|-------------|------|
| **Web API（PHP-FPM）** | PHP 原生 GC | 请求级生命周期，GC 不是瓶颈 |
| **队列 Worker（PHP CLI）** | PHP + 定时 gc_collect_cycles() | 防止内存累积 |
| **高并发微服务** | Go 或 Java（ZGC） | 低延迟 GC，适合常驻进程 |
| **数据处理脚本** | Python + gc.collect() | 简单易用，分代 GC 够用 |
| **企业级大型应用** | Java（G1/ZGC） | 成熟的 GC 调优生态 |

---

# 十一、常见 GC 误区与陷阱

## 误区 1：unset() 一定会释放内存

```php
$a = new stdClass();
$b = $a;           // refcount = 2
unset($a);         // refcount = 1，对象还活着！
// $b 仍然引用该对象，内存不会释放
```

`unset()` 只是断开变量名与值的关联，如果还有其他引用存在，值不会被释放。只有当 refcount 降为 0 时，内存才会被真正回收。

## 误区 2：gc_collect_cycles() 总是能回收内存

```php
$a = str_repeat('x', 1024 * 1024);  // 1MB 字符串
$b = $a;
unset($a, $b);  // refcount = 0，立刻释放
gc_collect_cycles();  // 返回 0，没有循环引用需要回收
```

`gc_collect_cycles()` 只回收**循环引用**导致的内存泄漏。普通的 refcount 归零释放是即时的，不需要 GC 介入。如果你的代码没有循环引用，调用这个函数是多余的。

## 误区 3：关闭 GC 能提升性能

```php
gc_disable();  // 不推荐！
```

关闭 GC 确实能省去一些标记和扫描的开销，但在常驻进程中会导致循环引用永远不会被回收，最终 OOM。只有在**完全确定没有循环引用**的短期脚本中，关闭 GC 才有意义。

## 误区 4：PHP 8 的 WeakMap 能解决所有内存问题

```php
$cache = new WeakMap();
$obj = new stdClass();
$cache[$obj] = str_repeat('x', 1024 * 1024);  // 1MB
unset($obj);  // WeakMap 条目自动消失，1MB 被释放
```

WeakMap 只解决**对象键**的引用计数问题。如果你的缓存键是字符串或整数，WeakMap 不适用。此外，WeakMap 本身也有遍历和查找的开销，不适合存储大量数据。

## 误区 5：循环引用一定导致内存泄漏

循环引用只有在**外部无法访问**时才是泄漏。如果循环引用的对象仍然被外部变量引用，它们不会被 GC 回收（因为有外部引用），也不会造成内存问题。GC 只关心那些「既互相引用又无法从外部访问」的孤岛。

```php
$a = new stdClass();
$b = new stdClass();
$a->ref = $b;
$b->ref = $a;  // 循环引用

// 只要 $a 或 $b 仍然在作用域中，就不会被回收
// 只有当两者都离开作用域时，GC 才会介入
```

---

# 十二、参考

- [PHP 手册 - GC](https://www.php.net/manual/zh/features.gc.php)
- *Concurrent Cycle Collection in Reference Counted Systems*: <https://researcher.watson.ibm.com/researcher/files/us-bacon/Bacon01Concurrent.pdf>
- [PHP 内部：zval 结构](https://www.phpinternalsbook.com/php7/zvals.html)
- [WeakMap RFC](https://wiki.php.net/rfc/weakmap)
- [WeakReference RFC](https://wiki.php.net/rfc/weakrefs)

---

## 相关阅读

- [PHP 内存模型深度剖析：引用计数、写时复制、垃圾回收的底层机制与性能调优](/categories/PHP/PHP-内存模型深度剖析-引用计数-写时复制-垃圾回收的底层机制与性能调优/)
- [PHP GC 深度剖析：循环引用检测、根缓冲区、同步/异步垃圾回收](/categories/PHP/php-gc-deep-dive/)
- [Swoole 常驻内存踩坑深度剖析：全局变量污染、静态属性残留、连接泄漏](/categories/PHP/swoole-resident-memory-pitfalls-deep-dive/)
- [PHP 生命周期与 SAPI](/categories/PHP/lifecycle/)
- [PHP-FPM Worker 生命周期、信号处理与 Graceful Reload](/categories/PHP/php-fpm-worker-lifecycle/)
