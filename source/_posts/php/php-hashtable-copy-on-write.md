---
title: PHP 数组底层实现深度剖析：HashTable 结构、Copy-on-Write 与性能调优
keywords: [PHP, HashTable, Copy, Write, 数组底层实现深度剖析, 结构, 与性能调优]
date: 2026-06-10 04:40:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - PHP
  - HashTable
  - 内存优化
  - 性能调优
  - 数据结构
  - 源码分析
description: 深入 PHP 数组底层 HashTable 实现，解析 Bucket 存储、哈希冲突处理、Copy-on-Write 机制，结合 Laravel 实战给出性能调优策略。
---


## 概述

PHP 数组是语言中最常用的数据结构，但它并不是传统意义上的"数组"——它本质上是一个**有序哈希表（Ordered HashTable）**。这一个结构同时承担了数组、字典、列表、集合等多种角色，设计上极其灵活，但也隐藏着不少性能陷阱。

本文从 PHP 8.x 源码层面，拆解 HashTable 的底层结构、哈希冲突解决、迭代顺序保证、Copy-on-Write 机制，并结合 Laravel 生产环境给出可落地的性能调优建议。

## 1. PHP 数组到底是什么

### 1.1 不是数组的"数组"

在 C 语言中，数组是连续内存块；在 Java 中，`ArrayList` 是动态数组。但 PHP 的 `array` 底层是 **HashTable**——一个通过哈希函数将键映射到存储桶的结构。

```php
// 看起来像数组
$arr = [1, 2, 3];

// 也看起来像字典
$dict = ['name' => 'Michael', 'age' => 30];

// 甚至混合用
$mixed = [0 => 'a', 'key' => 'b', 1 => 'c'];
```

这三种写法在底层使用完全相同的 HashTable 结构。

### 1.2 PHP 8.x 的 HashTable 结构体

从 PHP 8.x 源码（`zend_types.h`）中，核心结构如下：

```c
typedef struct _zend_array {
    zend_refcounted_h gc;          // 垃圾回收引用计数
    union {
        struct {
            zend_uchar    flags;
            zend_uchar    _unused;
            zend_uchar    nIteratorsCount;
            zend_uchar    _unused2;
        } v;
        uint32_t flags;
    } u;
    uint32_t          nTableMask;  // 哈希掩码（用于计算 bucket 索引）
    Bucket           *arData;      // 存储桶数组（连续内存）
    uint32_t          nNumUsed;    // 已使用的 bucket 数（含已删除的洞）
    uint32_t          nNumOfElements; // 实际元素数量
    uint32_t          nTableSize;  // 哈希表总大小（2 的幂）
    uint32_t          nInternalPointer;
    zend_long         nNextFreeElement; // 下一个自动分配的整数键
    dtor_func_t       pDestructor; // 元素析构函数
} zend_array;
```

关键字段解读：

| 字段 | 含义 |
|------|------|
| `arData` | 连续的 Bucket 数组，存储实际数据 |
| `nTableMask` | 等于 `-(nTableSize)`，用于将哈希值映射到索引 |
| `nNumUsed` | 已分配的 Bucket 总数（包含标记删除的） |
| `nNumOfElements` | 真实元素数量 |
| `nTableSize` | 哈希表容量，始终为 2 的幂 |

### 1.3 Bucket 结构

每个元素存储在一个 `Bucket` 中：

```c
typedef struct _Bucket {
    zval              val;         // 值（zval 联合体）
    zend_ulong        h;           // 哈希值（整数键直接用键值，字符串键用 hash 函数）
    zend_string      *key;         // 字符串键（整数键为 NULL）
} Bucket;
```

`arData` 是一块连续内存，Bucket 按**插入顺序**依次排列。这就是 PHP 数组能保持插入顺序的根本原因。

## 2. 哈希冲突与解决

### 2.1 哈希计算

```c
// 整数键：直接用键值
h = Z_LVAL_P(key);

// 字符串键：使用 DJBX33A 哈希算法
h = zend_string_hash_val(key);
```

PHP 使用 **DJBX33A** 算法对字符串键计算哈希值，这是一个时间复杂度 O(n) 的算法，n 为字符串长度。

### 2.2 索引映射

```c
// nTableMask = -(nTableSize)
// 哈希值 & nTableMask 得到 arData 中的"冲突链表头"位置
idx = h | nTableMask;  // 实际上是 h & (~nTableMask + 1) 的位运算优化
```

`nTableMask` 的设计非常巧妙——它是 `nTableSize` 的负数，在二进制补码下，`h & nTableMask` 等价于 `h % nTableSize`，但位运算比取模快得多。

### 2.3 拉链法（Separate Chaining）

PHP 的 HashTable 使用**拉链法**解决冲突。每个 Bucket 有一个隐含的 `next` 指针（通过 `val.u2.next` 字段），形成单链表：

```
arData 索引:
  [0] → Bucket_A → Bucket_D → NULL
  [1] → Bucket_B → NULL
  [2] → Bucket_C → Bucket_E → Bucket_F → NULL
  [3] → NULL
```

当多个键哈希到同一个索引时，它们形成一条链。查找时先计算哈希定位到链头，再沿链遍历比较键名。

### 2.4 负载因子与扩容

```c
// 当 nNumOfElements > nTableSize * 0.75 时触发扩容
// 扩容策略：nTableSize 翻倍（始终为 2 的幂）
if (nNumOfElements > nTableSize / 2) {
    // 触发 resize
}
```

PHP 的负载因子阈值是 **0.75**（与 Java HashMap 相同）。当元素数量超过容量的 75% 时，哈希表扩容为原来的 2 倍。

**扩容代价**：需要重新分配内存并重新哈希所有元素。对于大数组（比如 10 万个元素），这是一次显著的 O(n) 操作。

### 2.5 删除与"洞"

删除元素时，PHP 不会立即收缩内存或移动后续元素，而是将该 Bucket 标记为 `IS_UNDEF`：

```php
$arr = ['a', 'b', 'c', 'd', 'e'];
unset($arr[2]); // 标记 $arr[2] 为 IS_UNDEF，但 arData[2] 的内存位置保留

echo count($arr); // 4（nNumOfElements 减 1）
echo $arr[3];     // 'd'（正常访问，不影响其他元素）
```

这就是为什么 `unset` 操作是 O(1) 的——它只修改标记，不移动数据。但代价是内存中存在"洞"，直到下一次 `rehash` 才会被清理。

## 3. 迭代顺序保证

### 3.1 有序哈希表

PHP 7+ 的 HashTable 保证**插入顺序**与迭代顺序一致。这是通过 `arData` 的物理顺序实现的：

```php
$arr = ['b' => 2, 'a' => 1, 'c' => 3];
foreach ($arr as $k => $v) {
    echo "$k: $v\n";
}
// 输出：b: 2, a: 1, c: 3（与插入顺序一致）
```

### 3.2 内部指针与迭代器

每个数组维护一个内部指针（`nInternalPointer`），`foreach` 循环本质上是遍历 `arData`：

```c
// foreach 的底层逻辑（简化）
for (uint32_t i = 0; i < nNumUsed; i++) {
    if (Z_TYPE(arData[i].val) == IS_UNDEF) continue; // 跳过已删除的洞
    // 处理 arData[i]
}
```

注意：如果在 `foreach` 中删除当前元素，内部指针可能失效。PHP 8.x 通过 `nIteratorsCount` 跟踪活跃迭代器数量，在 resize 时正确更新迭代器状态。

## 4. Copy-on-Write 机制

### 4.1 引用计数与分离

PHP 数组的赋值默认是**浅拷贝**——只复制指针，增加引用计数：

```php
$a = [1, 2, 3];
$b = $a;         // 不复制数据，$a 和 $b 共享同一个 zend_array

// 此时 $a->gc.refcount == 2
```

当其中一个变量被修改时，触发 **Copy-on-Write**——先复制一份独立的数组，再修改：

```php
$b[] = 4;        // 触发 COW，$b 得到独立副本
// $a->gc.refcount == 1，$b->gc.refcount == 1
```

### 4.2 COW 的性能影响

COW 机制是一把双刃剑：

**优势**：函数传参、赋值等操作是 O(1) 的，不需要复制整个数组。

**陷阱**：在循环中频繁修改可能触发多次 COW，导致意料之外的内存分配：

```php
// 不推荐：可能触发多次 COW
function processArray(array $arr): array {
    for ($i = 0; $i < 1000; $i++) {
        $arr[] = $i;  // 每次追加可能触发 COW + resize
    }
    return $arr;
}

// 推荐：使用引用避免 COW
function processArrayRef(array &$arr): void {
    for ($i = 0; $i < 1000; $i++) {
        $arr[] = $i;  // 直接修改原数组，无 COW
    }
}
```

### 4.3 COW 与 Laravel Collection

Laravel 的 `Collection` 内部持有一个 `$items` 数组。理解 COW 对 Collection 的性能至关重要：

```php
// 场景：过滤大数据集
$users = User::all(); // 假设有 10 万条记录

// 方式 1：链式调用（每个方法可能触发 COW）
$filtered = $users->filter(fn($u) => $u->active)
                   ->map(fn($u) => $u->name)
                   ->values();

// 方式 2：单次遍历（避免中间 COW）
$result = [];
foreach ($users as $user) {
    if ($user->active) {
        $result[] = $user->name;
    }
}
```

方式 2 在大数据量下显著更优，因为它避免了 `filter` 和 `map` 各自触发的 COW。

### 4.4 zval 的类型与 COW

值类型的 zval（整数、浮点数、布尔值）不参与 COW，因为它们直接存储在 zval 中，不涉及引用计数。只有**引用类型**（字符串、数组、对象）才有 COW 行为：

```php
$a = [1, 2, 3];      // 引用类型，参与 COW
$b = $a;              // 共享
$b[0] = 999;          // 触发 COW，$b 独立

$c = 42;              // 值类型
$d = $c;              // 直接复制值，不涉及引用计数
```

## 5. 实战：内存分析与性能测试

### 5.1 测量数组内存占用

```php
<?php

// 测量不同规模数组的内存占用
function measureArrayMemory(int $size): array {
    $before = memory_get_usage(true);
    
    $arr = [];
    for ($i = 0; $i < $size; $i++) {
        $arr["key_{$i}"] = $i;
    }
    
    $after = memory_get_usage(true);
    $usage = $after - $before;
    
    return [
        'elements' => $size,
        'bytes' => $usage,
        'per_element' => round($usage / $size, 2),
        'kb' => round($usage / 1024, 2),
        'mb' => round($usage / 1024 / 1024, 2),
    ];
}

foreach ([1000, 10000, 100000, 500000] as $size) {
    $result = measureArrayMemory($size);
    echo sprintf(
        "%d 元素: %.2f MB (每元素 %.2f 字节)\n",
        $result['elements'],
        $result['mb'],
        $result['per_element']
    );
}

// 输出示例（PHP 8.4）:
// 1000 元素: 0.19 MB (每元素 196.61 字节)
// 10000 元素: 1.50 MB (每元素 157.29 字节)
// 100000 元素: 16.00 MB (每元素 167.77 字节)
// 500000 元素: 68.00 MB (每元素 142.61 字节)
```

**关键发现**：每个元素的实际内存开销约 **140-200 字节**（包含 Bucket、zval、字符串键等），远高于 C 语言数组的 4 或 8 字节。

### 5.2 哈希冲突密度测试

```php
<?php

// 测试哈希冲突对性能的影响
function benchmarkLookup(int $size, int $iterations = 100000): array {
    $arr = [];
    for ($i = 0; $i < $size; $i++) {
        $arr["user_{$i}_profile"] = $i;
    }
    
    $keys = array_keys($arr);
    $start = hrtime(true);
    
    for ($i = 0; $i < $iterations; $i++) {
        $key = $keys[array_rand($keys)];
        $_ = $arr[$key];
    }
    
    $elapsed = (hrtime(true) - $start) / 1e6; // ms
    
    return [
        'size' => $size,
        'iterations' => $iterations,
        'total_ms' => round($elapsed, 2),
        'per_lookup_ns' => round($elapsed * 1e6 / $iterations, 2),
    ];
}

foreach ([100, 1000, 10000, 100000] as $size) {
    $result = benchmarkLookup($size);
    echo sprintf(
        "大小 %6d: 每次查找 %.0f ns (总 %.2f ms)\n",
        $result['size'],
        $result['per_lookup_ns'],
        $result['total_ms']
    );
}
```

### 5.3 COW 性能对比

```php
<?php

// COW vs 直接修改性能对比
function benchmarkCOW(): void {
    $size = 100000;
    $base = range(0, $size);
    
    // 测试 1：COW 模式（赋值后修改）
    $start = hrtime(true);
    for ($i = 0; $i < 100; $i++) {
        $copy = $base;        // 浅拷贝（共享）
        $copy[] = $i;         // 触发 COW
    }
    $cowTime = (hrtime(true) - $start) / 1e6;
    
    // 测试 2：引用模式（无 COW）
    $start = hrtime(true);
    for ($i = 0; $i < 100; $i++) {
        $ref = &$base;
        $ref[] = $i;          // 直接修改，无 COW
        unset($ref);
    }
    $refTime = (hrtime(true) - $start) / 1e6;
    
    echo "COW 模式:   {$cowTime} ms\n";
    echo "引用模式:   {$refTime} ms\n";
    echo "COW 开销:   " . round($cowTime / $refTime, 2) . "x\n";
}

benchmarkCOW();

// 典型输出：
// COW 模式:   85.32 ms
// 引用模式:   12.45 ms
// COW 开销:   6.85x
```

## 6. 生产环境性能调优

### 6.1 预分配数组容量

如果你知道数组大约有多少元素，预先分配容量可以避免多次 resize：

```php
<?php

// 不推荐：多次 resize
$users = [];
foreach ($largeDataset as $row) {
    $users[] = $row; // 每次追加可能触发 resize
}

// 推荐：预分配（PHP 8.1+ 使用 SplFixedArray）
$users = new SplFixedArray(count($largeDataset));
foreach ($largeDataset as $i => $row) {
    $users[$i] = $row;
}

// 或者在循环前估算大小，减少 resize 次数
$users = [];
$estimated = count($largeDataset);
// PHP 不支持直接预分配 array 容量，但可以通过初始化键来预占空间
for ($i = 0; $i < $estimated; $i++) {
    $users[$i] = null;
}
$index = 0;
foreach ($largeDataset as $row) {
    $users[$index++] = $row;
}
```

### 6.2 整数键 vs 字符串键

整数键的查找比字符串键快，因为不需要计算哈希：

```php
<?php

// 场景：将 ID 列表映射到用户对象
$users = User::whereIn('id', $ids)->get()->keyBy('id');

// 不推荐：字符串键查找
$user = $users->get("user_{$id}"); // 需要计算字符串哈希

// 推荐：整数键查找
$user = $users->get($id); // 直接用 ID 作为键，查找更快
```

### 6.3 避免大数组的 in_array

```php
<?php

// 不推荐：O(n) 查找
$allowedRoles = ['admin', 'editor', 'moderator', 'viewer', ...]; // 大量角色
if (in_array($user->role, $allowedRoles)) {
    // ...
}

// 推荐：O(1) 查找（利用哈希表特性）
$allowedRoles = array_flip(['admin', 'editor', 'moderator', 'viewer', ...]);
if (isset($allowedRoles[$user->role])) {
    // ...
}
```

### 6.4 Laravel 中的数组优化

#### 6.4.1 Collection 的 lazy 版本

```php
<?php

// 大数据集使用 LazyCollection（基于 Generator，避免内存爆炸）
use Illuminate\Support\LazyCollection;

// 不推荐：一次性加载所有数据到内存
$users = User::all()->filter(fn($u) => $u->active)->map(fn($u) => $u->name);

// 推荐：逐条处理，内存占用 O(1)
$names = User::cursor()
    ->filter(fn($u) => $u->active)
    ->map(fn($u) => $u->name)
    ->all();
```

#### 6.4.2 缓存友好的数据结构

```php
<?php

// 场景：频繁查找的配置数据
// 不推荐：每次请求都解析配置文件
$config = config('app.settings'); // 返回数组

// 推荐：使用 remember 缓存
$settings = Cache::remember('app.settings', 3600, function () {
    return config('app.settings');
});

// 更进一步：如果配置不经常变，用 APCu（进程内缓存，无网络开销）
$settings = apcu_fetch('app.settings') ?: tap(
    config('app.settings'),
    fn($v) => apcu_store('app.settings', $v, 3600)
);
```

### 6.5 内存泄漏排查

PHP 数组的常见内存泄漏模式：

```php
<?php

// 陷阱 1：闭包持有大数组引用
function createProcessor(): Closure {
    $largeData = range(1, 1000000);
    
    // 不推荐：闭包捕获了 $largeData 的引用
    return function () use (&$largeData) {
        return array_pop($largeData); // $largeData 一直驻留内存
    };
}

// 推荐：用完即释放
function createProcessorV2(): Closure {
    $largeData = range(1, 1000000);
    $processed = [];
    
    return function () use (&$largeData, &$processed) {
        if (empty($largeData)) {
            return null;
        }
        $item = array_pop($largeData);
        $processed[] = $item;
        return $item;
    };
}

// 陷阱 2：静态变量持有数组
class Cache {
    private static array $store = [];
    
    public static function set(string $key, mixed $value): void {
        self::$store[$key] = $value; // 永不释放！
    }
}

// 推荐：使用带过期的缓存或 WeakMap
class SafeCache {
    /** @var array<string, array{value: mixed, expires: int}> */
    private static array $store = [];
    
    public static function set(string $key, mixed $value, int $ttl = 3600): void {
        self::$store[$key] = [
            'value' => $value,
            'expires' => time() + $ttl,
        ];
    }
    
    public static function get(string $key): mixed {
        $entry = self::$store[$key] ?? null;
        if (!$entry || $entry['expires'] < time()) {
            unset(self::$store[$key]);
            return null;
        }
        return $entry['value'];
    }
}
```

## 7. PHP 8.x 的改进

### 7.1 数组解构增强

```php
// PHP 8.1+：数组解构支持字符串键
$data = ['name' => 'Michael', 'age' => 30, 'city' => 'Shanghai'];
['name' => $name, 'city' => $city] = $data;

// PHP 8.1+：readonly 属性与数组结合
class User {
    public function __construct(
        public readonly string $name,
        public readonly int $age,
    ) {}
}

// 从数组构造对象
$user = new User(...['name' => 'Michael', 'age' => 30]);
```

### 7.2 Fibers 与数组

PHP 8.1 的 Fibers 虽然不直接改变数组的底层实现，但在异步场景中，理解数组的 COW 行为尤为重要：

```php
<?php

// Fiber 中修改数组可能触发意外的 COW
$shared = ['count' => 0];

$fiber = new Fiber(function () use ($shared) {
    // 这里的 $shared 是 COW 副本
    $shared['count']++; // 修改的是副本，不影响外部
    Fiber::suspend($shared['count']);
});

$result = $fiber->start();
echo $shared['count']; // 0（未变！）

// 如果需要共享状态，使用引用
$fiber2 = new Fiber(function () use (&$shared) {
    $shared['count']++;
    Fiber::suspend($shared['count']);
});

$result = $fiber2->start();
echo $shared['count']; // 1
```

## 8. 踩坑记录

### 坑 1：foreach 中修改数组导致跳过元素

```php
$arr = [1, 2, 3, 4, 5];

// 不推荐：在 foreach 中 unset
foreach ($arr as $key => $value) {
    if ($value === 3) {
        unset($arr[$key]); // 可能跳过下一个元素
    }
}
// 结果可能不是预期的 [1, 2, 4, 5]

// 推荐：array_filter 或先收集要删除的键
$arr = array_filter($arr, fn($v) => $v !== 3);
```

### 坑 2：array_merge 在循环中的性能

```php
// 不推荐：每次循环都 merge（O(n²)）
$result = [];
foreach ($datasets as $data) {
    $result = array_merge($result, $data); // 每次都复制
}

// 推荐：用展开运算符或一次性 merge
$result = [];
foreach ($datasets as $data) {
    foreach ($data as $item) {
        $result[] = $item; // 直接追加，O(1) 摊销
    }
}

// PHP 8.1+：更优雅
$result = array_merge(...$datasets); // 一次性 merge
```

### 坑 3：大数组的序列化开销

```php
// Laravel 队列任务中传递大数组
class ProcessData implements ShouldQueue {
    public function __construct(
        public array $largeDataset, // 序列化/反序列化开销巨大
    ) {}
}

// 推荐：传递 ID，运行时查询
class ProcessDataV2 implements ShouldQueue {
    public function __construct(
        public array $ids, // 只传递 ID 列表
    ) {}
    
    public function handle(): void {
        $records = Model::whereIn('id', $this->ids)->get();
        // ...
    }
}
```

## 总结

PHP 数组的 HashTable 实现是工程上的一个折中典范：

| 维度 | PHP 数组 | 纯数组（C） | HashMap（Java） |
|------|----------|-------------|-----------------|
| 查找 | O(1) 平均 | O(n) 或 O(log n) | O(1) 平均 |
| 插入 | O(1) 摊销 | O(1) 尾部 | O(1) 摊销 |
| 内存开销 | 高（~150 字节/元素） | 低（4-8 字节/元素） | 中（~40 字节/元素） |
| 顺序保证 | 插入顺序 | 物理顺序 | 无保证 |
| 灵活性 | 极高（混合键类型） | 低 | 中 |

**核心调优原则**：

1. **预估大小**：大数组提前用 `SplFixedArray` 或预初始化减少 resize
2. **整数优先**：能用整数键就不用字符串键
3. **避免 in_array**：用 `isset` + `array_flip` 替代
4. **Lazy 处理**：大数据集用 `LazyCollection` 或 Generator
5. **理解 COW**：函数传参、赋值是免费的，但修改时可能触发昂贵的复制
6. **控制生命周期**：大数组用完及时 `unset`，闭包不要捕获不必要的引用

理解底层实现不是为了炫技，而是为了在 10 万行代码的 Laravel 项目中，避免那些"看起来没问题但就是慢"的性能陷阱。
