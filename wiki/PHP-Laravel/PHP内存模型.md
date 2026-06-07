# PHP 内存模型

> 引用计数、写时复制（Copy-on-Write）与垃圾回收的底层机制，以及生产环境的内存调优实践。

## 定义

PHP 内存模型基于 zval（Zend Value）容器，通过引用计数管理变量生命周期，辅以写时复制优化数组/字符串传递效率，并通过循环引用收集器处理引用计数无法解决的循环依赖。

## 核心原理

### zval 容器

每个 PHP 变量底层都是一个 zval 结构：

```
zval {
    type:    IS_STRING / IS_ARRAY / IS_OBJECT / ...
    value:   实际数据（或指向 zend_string/zend_array 的指针）
    refcount: 引用计数
    is_ref:   是否为引用（&）
}
```

### 引用计数

```php
$a = "hello";      // refcount = 1
$b = $a;           // refcount = 2（同一 zend_string，不复制）
unset($a);         // refcount = 1
unset($b);         // refcount = 0 → 释放内存
```

### 写时复制（Copy-on-Write）

```php
$a = str_repeat("x", 1000000);  // 分配 1MB
$b = $a;                         // 不复制，refcount = 2
$b[0] = 'y';                     // 触发 COW：复制一份，各自 refcount = 1
```

**关键**：赋值不复制数据，只有修改时才复制。这使得函数参数传递和数组复制非常高效。

### 循环引用问题

```php
$a = [];
$b = [];
$a['b'] = $b;  // $a 引用 $b
$b['a'] = $a;  // $b 引用 $a → 循环引用
unset($a, $b); // refcount 都不为 0 → 内存泄漏！
```

### 垃圾回收器（Zend GC）

PHP 的 GC 是**同步的、分代的、增量的**：

1. **根缓冲区**：收集可能涉及循环引用的 zval（数组、对象）
2. **标记阶段**：从根缓冲区出发，标记所有可达的 zval
3. **清除阶段**：释放不可达的 zval（refcount = 0 的循环引用）
4. **增量执行**：每次请求最多处理一定数量的根缓冲区条目

### 内存限制

```ini
memory_limit = 256M  ; 单个请求最大内存
```

**注意**：CLI 命令行模式下默认 `-1`（无限制），需手动设置。

## 实战案例

### 大数组内存优化

来自博客：[PHP 内存模型深度剖析：引用计数、写时复制、垃圾回收的底层机制与性能调优](/2026/06/01/PHP-内存模型深度剖析-引用计数-写时复制-垃圾回收的底层机制与性能调优/)

```php
// ❌ 错误：一次性加载所有数据
$users = User::all(); // 10万条记录 → OOM

// ✅ 正确：使用 chunk 分块处理
User::chunk(1000, function ($users) {
    foreach ($users as $user) {
        // 处理后自动释放
    }
});

// ✅ 正确：使用 cursor 游标（逐条加载）
foreach (User::cursor() as $user) {
    // 每次只加载一条，内存占用极低
}
```

### 避免隐式复制

```php
// ❌ 触发 COW：$data 被复制
function process(array $data) {
    $data[] = 'new item'; // 修改参数 → 触发复制
    return $data;
}

// ✅ 传引用：避免复制
function process(array &$data) {
    $data[] = 'new item';
}

// ✅ 或使用 Generator 惰性生成
function process(): Generator {
    yield 'item1';
    yield 'item2';
}
```

### 内存泄漏排查

```php
// 检查当前内存使用
echo memory_get_usage(true);       // 当前分配
echo memory_get_peak_usage(true);  // 峰值分配

// 强制触发 GC
gc_collect_cycles();

// 查看 GC 状态
print_r(gc_status());
```

## 相关概念

- [垃圾回收机制](垃圾回收.md) - 引用计数 + 循环引用收集器
- [面向对象编程](面向对象.md) - 对象引用与生命周期
- [OPcache 调优](OPcache调优.md) - 共享内存与预加载
- [Octane 与 Swoole](Octane与Swoole.md) - 长驻进程内存管理

## 常见问题

**Q: 为什么 PHP 不用分代 GC？**
A: PHP 是请求级生命周期，大部分对象在请求结束时自动释放。循环引用收集器只需处理少数循环引用场景，同步 GC 已足够高效。

**Q: 写时复制什么时候触发？**
A: 当两个变量共享同一数据（refcount > 1），其中一个尝试修改时触发。对象是例外——对象赋值传递的是引用，不触发 COW。

**Q: Swoole/Octane 下内存泄漏更严重？**
A: 是的。长驻进程中变量不会随请求结束释放，需特别注意：静态属性累积、全局数组增长、闭包捕获外部变量、事件监听器未注销。
