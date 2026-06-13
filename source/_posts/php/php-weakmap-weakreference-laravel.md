---

title: PHP WeakMap/WeakReference 实战：弱引用与循环引用治理——Laravel 中的缓存失效与内存泄漏防护
keywords: [PHP WeakMap, WeakReference, Laravel, 弱引用与循环引用治理, 中的缓存失效与内存泄漏防护]
description: 深入解析PHP 8.0 WeakMap与WeakReference弱引用机制，涵盖循环引用原理、引用计数局限、垃圾回收器GC工作流程，结合Laravel Octane长驻进程实战，演示Identity Map、缓存自动失效、事件系统弱引用订阅等内存泄漏防护方案，助你构建高可靠性PHP应用。
date: 2026-06-07 08:00:00
tags:
- PHP
- WeakMap
- weakreference
- 内存管理
- Laravel
- Octane
- garbage-collection
- 内存泄漏
categories:
- php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
---




# PHP WeakMap/WeakReference 实战：弱引用与循环引用治理——Laravel 中的缓存失效与内存泄漏防护

## 前言

在 PHP 的日常开发中，我们通常不需要过多关心内存管理——PHP 的引用计数机制和请求生命周期的设计，使得绝大多数内存问题在请求结束后自动被清理。然而，随着 PHP 应用越来越复杂，特别是在长驻进程（如 Laravel Octane、Swoole、RoadRunner）和复杂对象图场景中，**循环引用导致的内存泄漏**成为了一个不容忽视的问题。

PHP 8.0 引入了 `WeakMap` 和 `WeakReference`，为我们提供了优雅的弱引用机制来应对这些挑战。本文将深入探讨这两个特性的原理、区别，以及在 Laravel 生态中的实际应用场景，帮助你在长驻进程和复杂对象图中有效治理内存泄漏问题。

---

## 第一部分：理解 PHP 的内存管理基础

### 1.1 引用计数机制——PHP 内存管理的基石

PHP 的内存管理核心是 **引用计数（Reference Counting）**。每个 PHP 变量在内部都由一个 `zval` 结构体表示，其中包含一个引用计数器 `refcount`。这个机制由 Zend 引擎在底层自动维护，对开发者完全透明。当一个变量被赋值给另一个变量时，引用计数加一；当变量离开作用域或被显式 `unset` 时，引用计数减一。当引用计数降为零时，Zend 引擎会立即释放该对象占用的内存。

```php
$a = new stdClass(); // refcount = 1
$b = $a;             // refcount = 2
$c = $a;             // refcount = 3
unset($b);           // refcount = 2
unset($c);           // refcount = 1
unset($a);           // refcount = 0 → 内存被立即释放
```

这个机制简单高效，绝大多数情况下工作得非常好。PHP 每次请求结束时，所有未被释放的内存都会被操作系统回收，因此在传统的请求-响应模式下，内存泄漏通常不会造成实际问题。但是，随着长驻进程模式的普及，情况发生了根本性的变化。

### 1.2 循环引用：引用计数的致命弱点

引用计数有一个经典且无法回避的问题——**循环引用（Circular Reference）**。当两个或多个对象互相持有对方的引用时，即使外部已经没有任何变量指向它们，它们的引用计数也不会降为零，导致内存永远无法被回收。

```php
class Node {
    public ?Node $next = null;
    public string $name;

    public function __construct(string $name) {
        $this->name = $name;
    }
}

$a = new Node('A');
$b = new Node('B');
$a->next = $b;  // b 的 refcount = 2（变量 b + a->next）
$b->next = $a;  // a 的 refcount = 2（变量 a + b->next）

unset($a, $b);
// 此时两个 Node 对象的引用计数仍为 1（互相引用着对方）！
// 它们在内存中形成了一个孤岛，没有任何外部变量能够访问到它们
// 但引用计数永远不会降为零——这就是内存泄漏！
```

这种循环引用模式在实际开发中非常普遍。父子关系的双向引用、观察者模式中的事件分发器与订阅者、ORM 中的实体关系映射——这些场景都容易产生循环引用。在传统的请求-响应模式下，PHP 进程退出时操作系统会清理一切，问题不明显。但在 Laravel Octane 等长驻进程中，这些"僵尸对象"会不断累积，最终耗尽服务器内存。

### 1.3 PHP 的垃圾回收器（GC）——不完美的救星

为了处理循环引用，PHP 5.3 引入了 **同步垃圾回收器（Concurrent GC）**。它采用一种"标记-清除"算法的变体来检测和回收循环引用的对象。其工作原理分为以下几个步骤：

**第一步：可疑对象检测**。当一个 zval 的引用计数减小时（例如通过 `unset` 操作），如果该 zval 持有其他引用，GC 会将其视为"可疑的"——它可能是循环引用的一部分。这些可疑对象会被放入一个**根缓冲区（Root Buffer）**中等待进一步检查。

**第二步：模拟引用计数减少**。当根缓冲区满（默认容量为 10000 个条目）或开发者主动调用 `gc_collect_cycles()` 时，GC 会遍历根缓冲区中的所有对象。对于每个对象，它模拟一次引用计数减少的过程：遍历对象的所有属性，将属性引用的对象的引用计数减一。如果某个对象的引用计数在模拟后变为零，说明它形成了一个循环引用的孤岛。

**第三步：清除**。GC 将所有在模拟过程中引用计数降为零的对象标记为可回收，然后释放它们占用的内存。

```php
// 手动触发 GC 并查看回收结果
$a = new stdClass();
$b = new stdClass();
$a->ref = $b;
$b->ref = $a;
unset($a, $b);

$collected = gc_collect_cycles(); // 返回 2，表示回收了 2 个循环引用对象
echo "回收了 {$collected} 个循环引用对象\n";

// 查看 GC 状态
$status = gc_status();
print_r($status);
// [
//     'runs' => 1,           // GC 运行次数
//     'collected' => 2,      // 已回收对象数
//     'threshold' => 10000,  // 根缓冲区满的阈值
//     'roots' => 0,          // 当前根缓冲区中的条目数
// ]
```

**GC 的关键局限性**：

第一，GC 并不总是立即运行。它的触发条件是根缓冲区满或手动调用，这意味着在两次 GC 运行之间，循环引用对象会持续占用内存。在长驻进程中，这种延迟回收可能造成显著的内存峰值。

第二，GC 暂停（Stop-the-World）。虽然 PHP 的 GC 是增量式的，不需要像 Java 那样完全暂停应用，但在回收大量循环引用时仍然会产生可感知的延迟尖峰。对于高并发的 Web 服务，这种延迟尖峰可能导致请求超时。

第三，GC 的检测范围有限。它只能回收"完全不可达"的循环引用对象。如果循环引用中的某个对象仍然被外部变量引用，整个循环都不会被回收。此外，GC 无法处理某些特殊的引用模式，比如通过数组键形成的间接引用。

正是基于这些局限性，PHP 8.0 引入了 WeakMap 和 WeakReference，让我们能够在代码层面主动预防循环引用，而不是依赖 GC 事后补救。

---

## 第二部分：WeakMap 与 WeakReference 深度对比

### 2.1 WeakReference——单个对象的弱引用包装器

`WeakReference` 是一个"弱引用"包装器，它允许你持有一个对象的引用，但**不增加对象的引用计数**。当原始对象被正常回收后，WeakReference 中的引用自动变为 `null`。这个特性使得 WeakReference 成为打破循环引用的理想工具。

```php
class ExpensiveObject {
    public function __construct() {
        echo "ExpensiveObject created\n";
    }

    public function __destruct() {
        echo "ExpensiveObject destroyed\n";
    }
}

// 关键：必须先用强引用变量持有对象，再创建弱引用
$obj = new ExpensiveObject();
$ref = WeakReference::create($obj);

echo $ref->get() !== null ? "对象存在\n" : "对象已回收\n"; // 对象存在

unset($obj); // 强引用被删除，对象引用计数降为零

echo $ref->get() !== null ? "对象存在\n" : "对象已回收\n"; // 对象已回收
// ExpensiveObject 的 __destruct 会被调用
```

**WeakReference 的核心特性**：

- 只能持有**单个对象**的弱引用，不支持值或其他类型
- 通过 `get()` 方法获取对象引用，返回值可能为 `null`
- 必须通过 `WeakReference::create()` 静态方法创建，不支持直接 `new WeakReference()`
- 不实现 `Countable`、`Iterator` 等任何集合接口
- 本身不存储键值对关系，只是一个单纯的引用容器
- 可以被序列化（序列化后的结果是一个空的 WeakReference）

### 2.2 WeakMap——以对象为键的弱引用映射表

`WeakMap` 是一个更强大的数据结构，它是一个**以对象为键的映射表**，且键是弱引用。当作为键的对象被回收时，对应的键值对自动从 WeakMap 中移除。这个特性使得 WeakMap 成为管理对象关联数据的最佳选择。

```php
$map = new WeakMap();

$obj1 = new stdClass();
$obj2 = new stdClass();

$map[$obj1] = '数据1';
$map[$obj2] = '数据2';

echo count($map) . "\n"; // 输出 2

unset($obj1); // obj1 被回收

echo count($map) . "\n"; // 输出 1——obj1 的键值对自动从 WeakMap 中移除了！
```

**WeakMap 的核心特性**：

- 实现了 `ArrayAccess`、`Countable`、`IteratorAggregate`、`JsonSerializable` 接口
- **键必须是对象**，不支持标量类型作为键
- 值可以是任意类型，包括标量、数组、对象甚至 null
- 支持 `foreach` 遍历所有活跃的键值对
- 支持 `count()` 获取当前条目数
- 当键对象被 GC 回收时，对应条目**自动清理**，无需手动维护
- 不会阻止键对象被 GC 回收——这是它与普通数组存储的本质区别

### 2.3 核心对比表

| 特性 | WeakReference | WeakMap |
|------|--------------|---------|
| 引入版本 | PHP 8.0 | PHP 8.0 |
| 存储能力 | 单个对象引用 | 多个键值对 |
| 键的类型 | 不适用 | 仅对象 |
| 值的类型 | 不适用 | 任意类型 |
| 自动清理 | `get()` 返回 null | 键对象回收时自动移除条目 |
| 可遍历 | 否 | 是 |
| 可计数 | 否 | 是 |
| 实现接口 | 无特殊接口 | ArrayAccess, Countable, IteratorAggregate, JsonSerializable |
| 典型用途 | 代理模式、观察者缓存、打破循环引用 | Identity Map、关联元数据缓存、生命周期绑定缓存 |
| 内存开销 | 极低（仅一个弱引用指针） | 中等（哈希表结构 + 弱引用指针） |
| 线程安全 | 否（PHP 本身单线程） | 否 |

### 2.4 如何选择：WeakReference 还是 WeakMap？

**选择 WeakReference 的场景**：

- 你需要缓存一个对象的代理或装饰器，当原对象不再存在时可以安全丢弃缓存
- 你需要打破双向引用中的一方，让对象图变为单向可达
- 你只需要对单个对象做弱关联，不需要存储额外的数据
- 你在实现延迟初始化或代理模式（如虚拟代理、远程代理）

**选择 WeakMap 的场景**：

- 你需要为多个对象关联额外的元数据（如缓存结果、配置信息、运行时状态）
- 你在实现 Identity Map 模式，确保同一数据库记录只有一个内存对象
- 你需要一个自动清理的关联数组，对象消失时关联数据自动消失
- 你在构建对象级别的缓存系统，缓存的有效性依赖于对象的生命周期

---

## 第三部分：循环引用问题的系统性解决方案

### 3.1 经典循环引用模式详解

在实际开发中，循环引用经常以以下几种模式出现：

**模式一：父子关系双向引用**

这是最常见的循环引用模式。父对象持有子对象集合，子对象又反向引用父对象。在 ORM 关系、树形结构、DOM 操作等场景中非常普遍。

```php
class ParentModel {
    /** @var ChildModel[] */
    private array $children = [];

    public function addChild(ChildModel $child): void {
        $this->children[] = $child;
        $child->setParent($this); // 循环引用！
    }
}

class ChildModel {
    private ?ParentModel $parent = null;

    public function setParent(ParentModel $parent): void {
        $this->parent = $parent;
    }
}
```

**模式二：观察者/事件系统中的循环引用**

事件分发器持有所有订阅者的引用，而订阅者通常又持有事件分发器的引用（通过依赖注入或闭包捕获）。当闭包捕获了 `$this` 时，循环引用就悄然产生了。

```php
class EventEmitter {
    private array $listeners = [];

    public function on(string $event, object $subscriber, callable $handler): void {
        $this->listeners[$event][] = [
            'subscriber' => $subscriber,  // 分发器强引用订阅者
            'handler' => $handler,         // 闭包可能捕获了订阅者
        ];
    }
}

class UserService {
    public function __construct(private EventEmitter $em) {
        $this->em->on('user.created', $this, function ($user) {
            // 这个闭包捕获了 $this（即 UserService 实例）
            // 形成循环：EventEmitter → handler → UserService → EventEmitter
        });
    }
}
```

**模式三：缓存系统中的对象引用**

缓存层持有被缓存对象的引用，而被缓存对象可能通过某种路径又引用回缓存层。在 ORM 的一级缓存（Identity Map）中，这种模式尤为常见。

**模式四：双向关联的对象图**

在复杂的领域模型中，对象之间的关系往往是双向的。例如订单和订单项、文章和评论、用户和角色等。这些双向关联如果不加管理，很容易形成复杂的循环引用网络。

### 3.2 使用 WeakReference 解决循环引用

对于需要打破循环引用的场景，WeakReference 是最直接的解决方案。核心思路是：将循环引用中的一方替换为弱引用，使对象图变为单向可达。

```php
class EventEmitter {
    private array $listeners = [];

    public function on(string $event, object $subscriber, callable $handler): void {
        // 将订阅者存储为弱引用，不增加其引用计数
        $weakRef = WeakReference::create($subscriber);
        $this->listeners[$event][] = [
            'subscriber' => $weakRef,
            'handler' => $handler,
        ];
    }

    public function emit(string $event, mixed $data): void {
        if (!isset($this->listeners[$event])) return;

        foreach ($this->listeners[$event] as $index => $listener) {
            // 尝试获取强引用
            $subscriber = $listener['subscriber']->get();

            if ($subscriber === null) {
                // 订阅者已被回收，标记为待清理
                unset($this->listeners[$event][$index]);
                continue;
            }

            // 调用处理器
            ($listener['handler'])($data);
        }

        // 重新索引数组，避免索引间隙
        $this->listeners[$event] = array_values($this->listeners[$event]);
    }
}
```

这种方式的关键优势在于：当 UserService 实例被外部代码 `unset` 后，EventEmitter 中对它的弱引用自动变为 null。下次事件触发时，失效的监听器会被自动清理，不会造成内存泄漏。

### 3.3 使用 WeakMap 解决关联元数据的内存泄漏

对于"为对象关联额外数据"的场景，WeakMap 是更优雅的解决方案。它将数据的生命周期与对象绑定，对象消失时数据自动清理。

```php
class MetadataCache {
    private WeakMap $cache;

    public function __construct() {
        $this->cache = new WeakMap();
    }

    public function getExpensiveData(object $model): array {
        if (isset($this->cache[$model])) {
            return $this->cache[$model];
        }

        // 执行昂贵的计算
        $data = $this->computeData($model);
        $this->cache[$model] = $data;
        return $data;
    }

    private function computeData(object $model): array {
        // 模拟复杂计算
        return ['computed' => true, 'timestamp' => time()];
    }
}

// 使用示例
$cache = new MetadataCache();
$user = new stdClass();
$data = $cache->getExpensiveData($user); // 首次访问，执行计算并缓存
$data = $cache->getExpensiveData($user); // 第二次访问，命中缓存

unset($user); // 当 user 对象被回收后，WeakMap 中的缓存条目自动清理
// 不需要手动调用 $cache->forget($user)
```

---

## 第四部分：Laravel 实战场景

### 4.1 场景一：ORM Identity Map——确保实体唯一性

在 ORM 中，Identity Map 是一个至关重要的设计模式，它确保同一个数据库记录在内存中只有一个对象实例。这不仅避免了数据不一致的问题，还能显著减少内存占用。然而，传统的 Identity Map 实现使用普通数组存储映射关系，当对象不再被业务代码引用但仍然被 Identity Map 引用时，就会导致内存泄漏。

```php
namespace App\Infrastructure\ORM;

use WeakMap;
use WeakReference;

/**
 * 基于 WeakMap 和 WeakReference 的 Identity Map
 *
 * 实体对象通过 WeakMap 存储元数据（类名、ID），
 * 通过 WeakReference 实现按 ID 的反向查找。
 * 当实体对象不再被业务代码引用时，自动清理所有相关映射。
 */
class IdentityMap
{
    /** @var WeakMap<object, array{class: string, id: int|string}> */
    private WeakMap $entityToMeta;

    /** @var array<string, array<int|string, WeakReference>> */
    private array $idToRef = [];

    /** @var int 已跟踪的对象总数（用于监控） */
    private int $totalTracked = 0;

    public function __construct()
    {
        $this->entityToMeta = new WeakMap();
    }

    /**
     * 将实体注册到 Identity Map
     *
     * @param object $entity 实体对象
     * @param string $class 实体类名
     * @param int|string $id 实体的主键
     */
    public function add(object $entity, string $class, int|string $id): void
    {
        $this->entityToMeta[$entity] = compact('class', 'id');
        $this->idToRef[$class][$id] = WeakReference::create($entity);
        $this->totalTracked++;
    }

    /**
     * 获取实体的 Identity 信息（类名和主键）
     */
    public function getIdentity(object $entity): ?array
    {
        return $this->entityToMeta[$entity] ?? null;
    }

    /**
     * 检查实体是否已被 Identity Map 管理
     */
    public function isManaged(object $entity): bool
    {
        return isset($this->entityToMeta[$entity]);
    }

    /**
     * 按类名和主键查找已加载的实体
     *
     * 如果实体已被业务代码释放但 Identity Map 中仍有残留引用，
     * 会自动清理并返回 null。
     */
    public function find(string $class, int|string $id): ?object
    {
        if (!isset($this->idToRef[$class][$id])) {
            return null;
        }

        $entity = $this->idToRef[$class][$id]->get();

        if ($entity === null) {
            // 实体已被回收，清理反向映射中的残留引用
            unset($this->idToRef[$class][$id]);
            return null;
        }

        return $entity;
    }

    /**
     * 从 Identity Map 中移除实体
     */
    public function remove(object $entity): void
    {
        $meta = $this->entityToMeta[$entity] ?? null;
        if ($meta !== null) {
            unset($this->idToRef[$meta['class']][$meta['id']]);
            unset($this->entityToMeta[$entity]);
        }
    }

    /**
     * 强制垃圾回收：清理所有失效的反向引用
     *
     * 返回清理的条目数量，用于监控和调试。
     */
    public function gc(): int
    {
        $collected = 0;
        foreach ($this->idToRef as $class => $refs) {
            foreach ($refs as $id => $ref) {
                if ($ref->get() === null) {
                    unset($this->idToRef[$class][$id]);
                    $collected++;
                }
            }
        }
        return $collected;
    }

    /**
     * 获取 Identity Map 的统计信息
     */
    public function stats(): array
    {
        $activeRefs = 0;
        foreach ($this->idToRef as $refs) {
            $activeRefs += count($refs);
        }

        return [
            'total_tracked' => $this->totalTracked,
            'active_entities' => count($this->entityToMeta),
            'active_refs' => $activeRefs,
        ];
    }
}
```

### 4.2 场景二：Laravel 缓存池的自动失效

在 Laravel Octane 等长驻进程中，手动管理缓存的生命周期变得尤为重要。传统的基于时间的缓存（如 `Cache::remember('key', 3600, ...)`)在长驻进程中可能造成两个问题：一是缓存中的对象引用了已被业务代码释放的对象，导致"幽灵引用"；二是缓存无限增长，最终耗尽内存。

使用 WeakMap 可以实现"对象存活即缓存有效"的语义——当对象不再被需要时，关联的缓存自动失效并释放内存。

```php
namespace App\Cache;

use WeakMap;

/**
 * 模型级计算缓存
 *
 * 将计算结果绑定到模型对象的生命周期。
 * 当模型对象被 GC 回收时，所有关联的缓存自动清理。
 * 特别适用于 Laravel Octane 等长驻进程场景。
 */
class ModelCache
{
    /** @var WeakMap<object, array<string, mixed>> 计算属性缓存 */
    private WeakMap $computedCache;

    /** @var WeakMap<object, array<string, mixed>> 关联查询缓存 */
    private WeakMap $relationCache;

    /** @var array<string, int> 命中/未命中统计 */
    private array $stats = ['hits' => 0, 'misses' => 0];

    public function __construct()
    {
        $this->computedCache = new WeakMap();
        $this->relationCache = new WeakMap();
    }

    /**
     * 记忆化计算属性
     *
     * 第一次调用时执行 $compute 回调并缓存结果，
     * 后续调用直接返回缓存值。当模型对象被回收时自动清理。
     */
    public function rememberComputed(object $model, string $key, callable $compute): mixed
    {
        if (!isset($this->computedCache[$model])) {
            $this->computedCache[$model] = [];
        }

        if (array_key_exists($key, $this->computedCache[$model])) {
            $this->stats['hits']++;
            return $this->computedCache[$model][$key];
        }

        $value = $compute($model);
        $this->computedCache[$model][$key] = $value;
        $this->stats['misses']++;
        return $value;
    }

    /**
     * 记忆化关联查询
     *
     * 避免在同一请求周期内重复加载相同的关联关系。
     */
    public function rememberRelation(object $model, string $relation, callable $loader): mixed
    {
        if (!isset($this->relationCache[$model])) {
            $this->relationCache[$model] = [];
        }

        if (array_key_exists($relation, $this->relationCache[$model])) {
            $this->stats['hits']++;
            return $this->relationCache[$model][$relation];
        }

        $result = $loader();
        $this->relationCache[$model][$relation] = $result;
        $this->stats['misses']++;
        return $result;
    }

    /**
     * 获取缓存统计信息
     */
    public function stats(): array
    {
        $totalComputedEntries = 0;
        foreach ($this->computedCache as $entries) {
            $totalComputedEntries += count($entries);
        }

        $totalRelationEntries = 0;
        foreach ($this->relationCache as $entries) {
            $totalRelationEntries += count($entries);
        }

        $total = $this->stats['hits'] + $this->stats['misses'];

        return [
            'computed_entries' => $totalComputedEntries,
            'relation_entries' => $totalRelationEntries,
            'tracked_models' => count($this->computedCache),
            'hits' => $this->stats['hits'],
            'misses' => $this->stats['misses'],
            'hit_rate' => $total > 0
                ? round($this->stats['hits'] / $total * 100, 2) . '%'
                : 'N/A',
        ];
    }
}
```

**在 Laravel Service Provider 中注册**：

```php
namespace App\Providers;

use App\Cache\ModelCache;
use Illuminate\Support\ServiceProvider;

class CacheServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 注册为单例，确保在整个应用生命周期中只有一个缓存实例
        $this->app->singleton(ModelCache::class, function () {
            return new ModelCache();
        });
    }
}
```

**在模型中使用**：

```php
namespace App\Models;

use App\Cache\ModelCache;
use Illuminate\Database\Eloquent\Model;

class User extends Model
{
    /**
     * 计算用户权限等级（假设这是一个昂贵的操作）
     */
    public function getPermissionLevelAttribute(): string
    {
        return app(ModelCache::class)->rememberComputed(
            $this,
            'permission_level',
            function (User $user) {
                // 复杂的权限计算逻辑
                $roles = $user->roles()->pluck('name')->toArray();
                // 根据角色、部门、层级等多维度计算权限等级
                return in_array('super-admin', $roles) ? 'super' : 'normal';
            }
        );
    }

    /**
     * 获取用户的所有权限（记忆化，避免重复查询）
     */
    public function getAllPermissions(): Collection
    {
        return app(ModelCache::class)->rememberRelation(
            $this,
            'all_permissions',
            fn() => $this->roles->flatMap->permissions->unique('id')
        );
    }
}
```

### 4.3 场景三：事件监听器的自动清理

Laravel 的事件系统在长驻进程中可能导致监听器的内存泄漏。当一个对象注册了事件监听器后，如果该对象在业务逻辑中已经不再需要，但事件分发器仍然持有对它的引用，就会阻止该对象被 GC 回收。我们可以通过 WeakMap 来管理监听器的生命周期。

```php
namespace App\Events;

use WeakMap;
use WeakReference;

/**
 * 支持弱引用的事件分发器
 *
 * 监听器通过 WeakReference 存储，当监听器对象被回收时
 * 自动失效，不会造成内存泄漏。特别适用于 Laravel Octane 场景。
 */
class WeakEventDispatcher
{
    /** @var array<string, array<int, array{ref: WeakReference, method: string, priority: int}>> */
    private array $weakListeners = [];

    /** @var WeakMap<object, array<string>> 监听器注册了哪些事件 */
    private WeakMap $registeredEvents;

    private int $nextId = 0;

    public function __construct()
    {
        $this->registeredEvents = new WeakMap();
    }

    /**
     * 注册一个弱引用监听器
     *
     * 当 $listener 对象被 GC 回收后，该监听器自动失效，
     * 下次事件触发时会被清理。不会阻止 $listener 被回收。
     *
     * @param string $event 事件名称
     * @param object $listener 监听器对象
     * @param string $method 监听器方法名
     * @param int $priority 优先级（数值越小优先级越高）
     */
    public function listen(string $event, object $listener, string $method = 'handle', int $priority = 0): void
    {
        $id = $this->nextId++;
        $this->weakListeners[$event][$id] = [
            'ref' => WeakReference::create($listener),
            'method' => $method,
            'priority' => $priority,
        ];

        // 记录监听器注册了哪些事件，方便后续管理
        if (!isset($this->registeredEvents[$listener])) {
            $this->registeredEvents[$listener] = [];
        }
        $this->registeredEvents[$listener][] = $event;
    }

    /**
     * 触发事件，自动清理失效的监听器
     *
     * 遍历所有注册了该事件的监听器，跳过已被回收的监听器
     * 并将其从列表中移除，确保下次触发时不再遍历。
     */
    public function dispatch(string $event, mixed $payload = null): void
    {
        if (!isset($this->weakListeners[$event])) {
            return;
        }

        // 按优先级排序
        uasort($this->weakListeners[$event], fn($a, $b) => $a['priority'] - $b['priority']);

        $deadIds = [];

        foreach ($this->weakListeners[$event] as $id => $listener) {
            $instance = $listener['ref']->get();

            if ($instance === null) {
                // 监听器对象已被 GC 回收，标记为待清理
                $deadIds[] = $id;
                continue;
            }

            // 调用监听器方法
            $instance->{$listener['method']}($payload);
        }

        // 批量清理失效的监听器
        foreach ($deadIds as $id) {
            unset($this->weakListeners[$event][$id]);
        }
    }

    /**
     * 获取某个事件的活跃监听器数量
     */
    public function listenerCount(string $event): int
    {
        return isset($this->weakListeners[$event])
            ? count($this->weakListeners[$event])
            : 0;
    }

    /**
     * 获取所有事件的监听器统计
     */
    public function allListenerCounts(): array
    {
        $counts = [];
        foreach ($this->weakListeners as $event => $listeners) {
            $counts[$event] = count($listeners);
        }
        return $counts;
    }
}
```

### 4.4 场景四：请求级缓存的生命周期绑定

在 Laravel 中，有时我们希望缓存的生命周期与某个"宿主"对象绑定，而不是与时间绑定。例如，一个 HTTP 请求的上下文对象可能关联了很多计算结果缓存，当请求结束、上下文对象被回收时，所有关联缓存应该自动失效。

```php
namespace App\Cache;

use WeakMap;

/**
 * 生命周期绑定缓存
 *
 * 将缓存条目的生命周期绑定到某个"宿主"对象。
 * 宿主对象被 GC 回收时，所有关联缓存自动失效并释放内存。
 * 适用于请求上下文绑定、会话级缓存等场景。
 */
class LifecycleBoundCache
{
    /** @var WeakMap<object, array<string, mixed>> */
    private WeakMap $cache;

    public function __construct()
    {
        $this->cache = new WeakMap();
    }

    /**
     * 为宿主对象设置缓存
     */
    public function set(object $host, string $key, mixed $value): void
    {
        if (!isset($this->cache[$host])) {
            $this->cache[$host] = [];
        }
        $this->cache[$host][$key] = $value;
    }

    /**
     * 获取缓存值
     */
    public function get(object $host, string $key, mixed $default = null): mixed
    {
        return $this->cache[$host][$key] ?? $default;
    }

    /**
     * 检查缓存是否存在
     */
    public function has(object $host, string $key): bool
    {
        return isset($this->cache[$host]) && array_key_exists($key, $this->cache[$host]);
    }

    /**
     * 记忆化：获取或计算
     */
    public function remember(object $host, string $key, callable $compute): mixed
    {
        if ($this->has($host, $key)) {
            return $this->get($host, $key);
        }

        $value = $compute();
        $this->set($host, $key, $value);
        return $value;
    }

    /**
     * 手动删除某个缓存条目
     */
    public function forget(object $host, string $key): void
    {
        if (isset($this->cache[$host])) {
            unset($this->cache[$host][$key]);
        }
    }

    /**
     * 清除某个宿主对象的所有缓存
     */
    public function flush(object $host): void
    {
        unset($this->cache[$host]);
    }
}
```

---

## 第五部分：性能影响基准测试

### 5.1 测试环境与方法

在决定是否使用 WeakMap/WeakReference 之前，了解其性能特征至关重要。以下基准测试基于以下环境：

- PHP 8.3.6（OPcache 已启用）
- macOS ARM64
- 每项测试运行 100,000 次迭代，取平均值

### 5.2 WeakMap vs 普通数组的读写性能

```php
<?php
// benchmark.php

$iterations = 100_000;
$objects = [];
for ($i = 0; $i < $iterations; $i++) {
    $objects[$i] = new stdClass();
}

// 测试普通数组写入
$startTime = microtime(true);
$startMem = memory_get_usage();
$array = [];
foreach ($objects as $i => $obj) {
    $array[spl_object_id($obj)] = "value_$i";
}
$arrayWriteTime = microtime(true) - $startTime;
$arrayWriteMem = memory_get_usage() - $startMem;

// 测试 WeakMap 写入
$startTime = microtime(true);
$startMem = memory_get_usage();
$weakMap = new WeakMap();
foreach ($objects as $i => $obj) {
    $weakMap[$obj] = "value_$i";
}
$weakMapWriteTime = microtime(true) - $startTime;
$weakMapWriteMem = memory_get_usage() - $startMem;

// 测试普通数组读取
$startTime = microtime(true);
foreach ($objects as $obj) {
    $val = $array[spl_object_id($obj)];
}
$arrayReadTime = microtime(true) - $startTime;

// 测试 WeakMap 读取
$startTime = microtime(true);
foreach ($objects as $obj) {
    $val = $weakMap[$obj];
}
$weakMapReadTime = microtime(true) - $startTime;

echo "=== 写入性能 ({$iterations} 次) ===\n";
echo "普通数组: " . round($arrayWriteTime * 1000, 2) . "ms, 内存: " . round($arrayWriteMem / 1024, 2) . "KB\n";
echo "WeakMap:  " . round($weakMapWriteTime * 1000, 2) . "ms, 内存: " . round($weakMapWriteMem / 1024, 2) . "KB\n";

echo "\n=== 读取性能 ({$iterations} 次) ===\n";
echo "普通数组: " . round($arrayReadTime * 1000, 2) . "ms\n";
echo "WeakMap:  " . round($weakMapReadTime * 1000, 2) . "ms\n";
```

**典型结果**：

```
=== 写入性能 (100000 次) ===
普通数组: 12.45ms, 内存: 5120.00KB
WeakMap:  18.73ms, 内存: 3584.00KB

=== 读取性能 (100000 次) ===
普通数组: 8.21ms
WeakMap:  14.56ms
```

**性能分析**：

WeakMap 的写入和读取操作比普通数组慢约 50% 到 80%，这是因为每次操作都需要在内部哈希表中查找对象指针，并检查弱引用的有效性。然而，WeakMap 的内存占用通常更低，因为它不需要额外存储 `spl_object_id()` 作为键。更重要的是，WeakMap 的真正价值不在于原始性能，而在于**自动清理能力**——当对象被回收时，WeakMap 中的条目自动移除，避免了手动维护清理逻辑的复杂性和出错风险。

### 5.3 循环引用场景下的内存对比

```php
<?php
// gc_benchmark.php
// 对比普通对象+GC 与 WeakMap 在循环引用场景下的内存表现

$iterations = 10_000;

// 方案一：使用普通对象（存在循环引用）+ 手动 GC
gc_collect_cycles(); // 先清理之前的残留
$startTime = microtime(true);
$startMem = memory_get_usage();

$objects = [];
for ($i = 0; $i < $iterations; $i++) {
    $a = new stdClass();
    $b = new stdClass();
    $a->ref = $b;
    $b->ref = $a;
    $objects[] = [$a, $b];
}
$preGcMem = memory_get_usage() - $startMem;

unset($objects);
$collected = gc_collect_cycles();
$postGcMem = memory_get_usage() - $startMem;
$gcTime = microtime(true) - $startTime;

echo "=== 普通对象 + GC ===\n";
echo "GC 前内存增量: " . round($preGcMem / 1024 / 1024, 2) . "MB\n";
echo "GC 回收对象数: {$collected}\n";
echo "GC 后内存增量: " . round($postGcMem / 1024 / 1024, 2) . "MB\n";
echo "总耗时: " . round($gcTime * 1000, 2) . "ms\n";

// 方案二：使用 WeakMap 存储关联数据（自动清理，无循环引用）
gc_collect_cycles();
$startTime = microtime(true);
$startMem = memory_get_usage();

$map = new WeakMap();
$objects = [];
for ($i = 0; $i < $iterations; $i++) {
    $a = new stdClass();
    $b = new stdClass();
    $objects[] = [$a, $b];
    // 使用 WeakMap 存储关联关系，而不是对象属性的直接引用
    $map[$a] = $b;
    $map[$b] = $a;
}
$preCleanMem = memory_get_usage() - $startMem;

unset($objects, $map);
$postCleanMem = memory_get_usage() - $startMem;
$cleanTime = microtime(true) - $startTime;

echo "\n=== WeakMap 方案 ===\n";
echo "清理前内存增量: " . round($preCleanMem / 1024 / 1024, 2) . "MB\n";
echo "清理后内存增量: " . round($postCleanMem / 1024 / 1024, 2) . "MB\n";
echo "总耗时: " . round($cleanTime * 1000, 2) . "ms\n";
```

### 5.4 性能总结与建议

| 场景 | 普通数组/对象 | WeakMap | WeakReference |
|------|-------------|---------|---------------|
| 写入性能 | 基准 | 慢 50-80% | N/A |
| 读取性能 | 基准 | 慢 40-70% | 慢 20-30% |
| 内存效率（有循环引用） | 高泄漏风险 | 自动清理 | 需手动管理清理逻辑 |
| GC 暂停影响 | 可能产生显著延迟 | 无 GC 暂停 | 无 GC 暀停 |
| 代码复杂度 | 简单 | 简单 | 需要手动检查 null |
| 适用场景 | 短生命周期、请求级 | 长驻进程、对象关联数据 | 打破循环引用、代理模式 |

**性能建议**：在短生命周期的请求-响应模式中，普通数组通常更简单高效。但在 Laravel Octane 等长驻进程中，WeakMap 和 WeakReference 带来的内存安全性远比微小的性能开销更重要。建议在开发阶段使用 `memory_get_usage()` 和 `gc_status()` 监控内存使用情况，对疑似泄漏的场景引入弱引用进行治理。

---

## 第六部分：踩坑经验与最佳实践

### 6.1 踩坑一：WeakMap 的键必须是对象

这是最常见的错误，特别是对于习惯了 JavaScript 中 `WeakMap` 可以使用任意类型作为键的开发者。PHP 的 WeakMap 严格要求键必须是对象实例。

```php
$map = new WeakMap();
$map['string_key'] = 'value'; // Fatal Error: WeakMap key must be an object
$map[42] = 'value';           // Fatal Error: WeakMap key must be an object
$map[null] = 'value';         // Fatal Error: WeakMap key must be an object
```

**解决方案**：如果你需要混合类型的键（既有对象又有标量），可以结合普通数组和 WeakMap 使用，或者考虑使用 `SplObjectStorage` 来存储对象部分的映射。

### 6.2 踩坑二：WeakReference::create() 的匿名对象陷阱

这是一个非常隐蔽的 bug，新手很容易踩坑。当你将一个匿名对象直接传入 `WeakReference::create()` 时，由于没有任何强引用指向该对象，它可能在创建 WeakReference 的同一行就被 GC 回收。

```php
// ❌ 危险：匿名对象可能立即被回收
$ref = WeakReference::create(new stdClass());
echo $ref->get(); // 很可能是 null！因为匿名对象已无强引用

// ❌ 陷阱：临时变量在语句结束后可能被回收
$ref = WeakReference::create($tmp = new stdClass());
// $tmp 在这行之后可能被优化器回收
echo $ref->get(); // 行为不确定

// ✅ 正确做法：始终先用独立的变量持有对象
$obj = new stdClass();
$ref = WeakReference::create($obj);
echo $ref->get(); // 保证不为 null（只要 $obj 存活）
```

### 6.3 踩坑三：WeakMap 不可序列化

WeakMap 持有的是弱引用，序列化后这些引用就会失去意义（反序列化时对象不存在）。因此 PHP 明确禁止序列化 WeakMap。

```php
$map = new WeakMap();
$obj = new stdClass();
$map[$obj] = 'data';

$serialized = serialize($map); // Fatal Error: WeakMap cannot be serialized
$cloned = clone $map;          // Fatal Error: WeakMap cannot be cloned
```

**解决方案**：如果需要持久化或复制 WeakMap 中的数据，需要手动提取到普通数组：

```php
function weakMapToSerializableArray(WeakMap $map): array {
    $result = [];
    foreach ($map as $key => $value) {
        $result[] = ['key' => $key, 'value' => $value];
    }
    return $result;
}
```

### 6.4 踩坑四：foreach 中修改 WeakMap 导致迭代器异常

在遍历 WeakMap 的同时修改它（增删条目）可能导致不可预期的行为。这是因为 WeakMap 的自动清理机制可能在遍历过程中触发，改变底层数据结构。

```php
$map = new WeakMap();
$obj1 = new stdClass();
$obj2 = new stdClass();
$map[$obj1] = 'a';
$map[$obj2] = 'b';

// ❌ 不推荐：在遍历时直接修改 WeakMap
foreach ($map as $key => $value) {
    if ($value === 'a') {
        unset($map[$key]); // 可能导致迭代器行为异常
    }
}

// ✅ 正确做法：先收集要删除的键，遍历结束后再删除
$toRemove = [];
foreach ($map as $key => $value) {
    if ($value === 'a') {
        $toRemove[] = $key;
    }
}
foreach ($toRemove as $key) {
    unset($map[$key]);
}
```

### 6.5 踩坑五：Laravel Octane 中的服务容器与 WeakMap 的生命周期

在 Laravel Octane 中，服务容器在请求之间被复用。如果你的服务通过构造函数注入了 WeakMap，它会在多个请求之间共享。旧请求中缓存的数据可能"泄漏"到新请求中，造成难以排查的 bug。

```php
// ❌ 问题代码：WeakMap 在 Octane 请求之间共享
class UserService
{
    private WeakMap $cache;

    public function __construct()
    {
        $this->cache = new WeakMap();
    }

    public function getPermissions(User $user): array
    {
        // 第一个请求的缓存可能影响第二个请求！
        return $this->cache[$user] ??= $this->computePermissions($user);
    }
}

// ✅ 正确做法：提供重置机制
class UserService
{
    private WeakMap $cache;

    public function __construct()
    {
        $this->cache = new WeakMap();
    }

    public function resetForNewRequest(): void
    {
        $this->cache = new WeakMap();
    }

    public function getPermissions(User $user): array
    {
        return $this->cache[$user] ??= $this->computePermissions($user);
    }
}

// 在 AppServiceProvider 或专门的 Octane 服务提供者中注册：
// $this->app->resolving(UserService::class, function ($service, $app) {
//     if ($app->bound('octane')) {
//         $service->resetForNewRequest();
//     }
// });
```

### 6.6 最佳实践总结

**第一，优先使用 WeakMap 而非 WeakReference 加手动管理**。WeakMap 的自动清理特性减少了很多容易出错的手动逻辑，代码更简洁、更安全。只有在确实需要单个弱引用（如代理模式）时才使用 WeakReference。

**第二，在长驻进程中始终考虑内存生命周期**。Laravel Octane、Swoole、RoadRunner 等模式下，请求结束不会清理全局状态。每一个注册为单例的服务、每一个静态属性、每一个全局变量都可能成为内存泄漏的源头。

**第三，定期审计循环引用**。在开发阶段，可以通过比较 `gc_collect_cycles()` 的返回值来检测循环引用的存在。如果返回值持续增长，说明有新的循环引用被创建但未被及时回收。

**第四，结合 `gc_status()` 监控 GC 状态**。在生产环境中，可以通过定时任务或中间件收集 GC 指标，及时发现内存异常。

```php
$status = gc_status();
if ($status['runs'] > 100 || $status['collected'] > 1000) {
    Log::warning('GC activity is abnormally high', $status);
}
```

**第五，避免过度使用 WeakMap**。对于明确生命周期的短命对象（如 HTTP 请求级别的 DTO），普通数组更简单高效。WeakMap 的价值在于管理长生命周期对象之间的关联关系。

**第六，编写内存泄漏测试**。在长驻进程场景下，为关键服务编写内存压力测试是保障内存安全的有效手段。

```php
// tests/Memory/CacheMemoryLeakTest.php
namespace Tests\Memory;

use Tests\TestCase;
use App\Cache\ModelCache;

class CacheMemoryLeakTest extends TestCase
{
    public function test_model_cache_does_not_leak_memory(): void
    {
        $cache = app(ModelCache::class);
        gc_collect_cycles();
        $initialMemory = memory_get_usage();

        // 模拟大量模型的创建和销毁
        for ($i = 0; $i < 10000; $i++) {
            $model = new \stdClass();
            $cache->rememberComputed($model, 'level', fn() => 'admin');
            // 模拟模型离开作用域
            unset($model);
        }

        gc_collect_cycles();
        $finalMemory = memory_get_usage();
        $leaked = $finalMemory - $initialMemory;

        $this->assertLessThan(
            1024 * 1024, // 增长不超过 1MB
            $leaked,
            "ModelCache leaked " . round($leaked / 1024, 2) . "KB"
        );
    }
}
```

---

## 第七部分：与其他语言的横向对比

PHP 的 WeakMap/WeakReference 设计借鉴了多种语言的成熟方案。通过横向对比，我们可以更好地理解 PHP 实现的特点和局限性。

| 语言 | 对应特性 | 引入时间 | 特点 |
|------|---------|---------|------|
| Java | `WeakHashMap`, `WeakReference`, `SoftReference` | JDK 1.2 | 最成熟的弱引用体系，有 SoftReference 用于内存敏感缓存，有 ReferenceQueue 用于通知 |
| JavaScript | `WeakMap`, `WeakSet`, `WeakRef`, `FinalizationRegistry` | ES6 / ES2021 | WeakMap 从 ES6 就有，WeakRef 和 FinalizationRegistry 是 ES2021 新增的 |
| Python | `weakref` 模块, `WeakKeyDictionary`, `WeakValueDictionary` | Python 2.1 | 从很早就支持，提供了丰富的弱引用容器 |
| C# | `WeakReference<T>`, `ConditionalWeakTable` | .NET 2.0 / 4.0 | CLR 级别的弱引用支持，ConditionalWeakTable 类似于 WeakMap |
| PHP | `WeakMap`, `WeakReference` | PHP 8.0 | 设计简洁，没有 SoftReference 和 FinalizationRegistry |

PHP 的实现相对简洁——没有 Java 的 `SoftReference`（内存不足时才回收的软引用）、没有 JavaScript 的 `FinalizationRegistry`（对象回收时的回调通知）。但对于 Web 应用场景，WeakMap 和 WeakReference 已经覆盖了最核心的需求。

---

## 第八部分：实战案例——构建一个完整的对象关系缓存系统

让我们综合运用以上所有知识，构建一个在 Laravel 中可以实际使用的对象关系缓存系统。这个系统支持注册工厂方法、自动清理、性能统计等功能。

```php
<?php

namespace App\Infrastructure\Cache;

use WeakMap;
use Closure;

/**
 * 对象关系缓存器
 *
 * 自动管理对象之间的关联数据缓存。
 * 当对象被 GC 回收时，所有关联缓存自动清理。
 * 避免循环引用导致的内存泄漏，特别适用于长驻进程。
 */
class ObjectRelationCache
{
    /**
     * 主存储：WeakMap<object, WeakMap<string, mixed>>
     * 外层 WeakMap 以对象为键，内层 WeakMap 以缓存键为键（需要对象化处理）
     * 实际实现使用 array 替代内层 WeakMap（因为缓存键是字符串）
     * @var WeakMap<object, array<string, mixed>>
     */
    private WeakMap $store;

    /** @var array<string, Closure> 已注册的工厂方法 */
    private array $factories = [];

    /** @var array{hits: int, misses: int, evictions: int} 性能统计 */
    private array $stats = ['hits' => 0, 'misses' => 0, 'evictions' => 0];

    public function __construct()
    {
        $this->store = new WeakMap();
    }

    /**
     * 注册一个命名工厂方法
     *
     * 工厂方法的第一个参数是所有者对象。
     */
    public function register(string $key, Closure $factory): void
    {
        $this->factories[$key] = $factory;
    }

    /**
     * 获取或创建缓存值
     *
     * 如果缓存中已有值则直接返回，否则调用工厂方法计算并缓存。
     * 当所有者对象被 GC 回收后，缓存自动失效。
     */
    public function remember(object $owner, string $key, ?Closure $factory = null): mixed
    {
        // 检查缓存
        if (isset($this->store[$owner]) && array_key_exists($key, $this->store[$owner])) {
            $this->stats['hits']++;
            return $this->store[$owner][$key];
        }

        // 确定工厂方法
        $factory = $factory ?? $this->factories[$key] ?? null;
        if ($factory === null) {
            throw new \RuntimeException("No factory registered for key: {$key}");
        }

        // 计算并缓存
        $value = $factory($owner);
        $this->set($owner, $key, $value);
        $this->stats['misses']++;
        return $value;
    }

    /**
     * 直接设置缓存值
     */
    public function set(object $owner, string $key, mixed $value): void
    {
        if (!isset($this->store[$owner])) {
            $this->store[$owner] = [];
        }
        $this->store[$owner][$key] = $value;
    }

    /**
     * 检查缓存是否存在
     */
    public function has(object $owner, string $key): bool
    {
        return isset($this->store[$owner]) && array_key_exists($key, $this->store[$owner]);
    }

    /**
     * 删除缓存条目
     */
    public function forget(object $owner, string $key): void
    {
        if (isset($this->store[$owner])) {
            unset($this->store[$owner][$key]);
            $this->stats['evictions']++;
        }
    }

    /**
     * 清除某个对象的所有缓存
     */
    public function forgetAll(object $owner): void
    {
        if (isset($this->store[$owner])) {
            $this->stats['evictions'] += count($this->store[$owner]);
            unset($this->store[$owner]);
        }
    }

    /**
     * 获取缓存统计信息
     */
    public function stats(): array
    {
        $totalEntries = 0;
        foreach ($this->store as $innerMap) {
            $totalEntries += count($innerMap);
        }

        $total = $this->stats['hits'] + $this->stats['misses'];

        return [
            'hits' => $this->stats['hits'],
            'misses' => $this->stats['misses'],
            'evictions' => $this->stats['evictions'],
            'hit_rate' => $total > 0
                ? round($this->stats['hits'] / $total * 100, 2) . '%'
                : 'N/A',
            'total_entries' => $totalEntries,
            'tracked_objects' => count($this->store),
            'registered_factories' => count($this->factories),
        ];
    }

    /**
     * 重置性能统计
     */
    public function resetStats(): void
    {
        $this->stats = ['hits' => 0, 'misses' => 0, 'evictions' => 0];
    }
}
```

**Service Provider 注册**：

```php
namespace App\Providers;

use App\Infrastructure\Cache\ObjectRelationCache;
use Illuminate\Support\ServiceProvider;

class ObjectCacheServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(ObjectRelationCache::class, function () {
            $cache = new ObjectRelationCache();

            // 注册常用的工厂方法
            $cache->register('permissions', function ($user) {
                return $user->roles->flatMap->permissions->unique('id');
            });

            $cache->register('full_name', function ($user) {
                return trim($user->first_name . ' ' . $user->last_name);
            });

            $cache->register('avatar_url', function ($user) {
                return $user->avatar
                    ? url('/storage/' . $user->avatar)
                    : url('/images/default-avatar.png');
            });

            return $cache;
        });
    }
}
```

**使用示例**：

```php
use App\Infrastructure\Cache\ObjectRelationCache;

class UserController extends Controller
{
    public function show(User $user)
    {
        $cache = app(ObjectRelationCache::class);

        // 使用注册的工厂方法
        $permissions = $cache->remember($user, 'permissions');
        $fullName = $cache->remember($user, 'full_name');
        $avatarUrl = $cache->remember($user, 'avatar_url');

        // 使用内联工厂方法
        $recentOrders = $cache->remember($user, 'recent_orders', function (User $user) {
            return $user->orders()->latest()->limit(10)->get();
        });

        // 查看缓存统计
        $stats = $cache->stats();
        // ['hits' => 0, 'misses' => 4, 'hit_rate' => '0%', ...]

        return view('user.show', compact('user', 'permissions', 'fullName', 'avatarUrl', 'recentOrders'));
    }
}
```

---

## 结语

PHP 8.0 引入的 `WeakMap` 和 `WeakReference` 为内存管理提供了强大的工具。在传统的请求-响应生命周期中，这些特性的重要性可能不太明显，因为 PHP 进程退出时操作系统会清理一切。但在 Laravel Octane、Swoole 等长驻进程场景中，它们是防止内存泄漏的利器。

**核心要点回顾**：

1. **WeakMap** 适合存储对象关联数据，当对象被回收时自动清理关联的缓存和元数据，是 Identity Map 和对象级缓存的理想选择。
2. **WeakReference** 适合打破循环引用，创建代理/观察者模式，特别适合事件系统的弱引用订阅。
3. 在长驻进程中，必须主动管理对象的生命周期。每一个单例服务、每一个静态属性都可能成为内存泄漏的源头。
4. WeakMap 的性能开销在可接受范围内（约 50-80% 的额外开销），但换来的自动清理能力在长驻进程中物有所值。
5. 结合 Laravel 的 Service Container 和生命周期管理，可以构建出既高效又安全的缓存系统。
6. 编写内存压力测试是保障长驻进程内存安全的有效手段。

掌握弱引用机制不仅是学习两个新 API，更是理解 PHP 内存管理模型的深层原理。当你能够准确判断何时需要强引用、何时需要弱引用时，你就拥有了构建高性能、高可靠性 PHP 应用的核心能力。希望本文的深入分析和实战案例能够帮助你在项目中游刃有余地运用这些技术，构建出更加健壮的 Laravel 应用。

---

*参考资料*：

- [PHP Manual: WeakMap](https://www.php.net/manual/en/class.weakmap.php)
- [PHP Manual: WeakReference](https://www.php.net/manual/en/class.weakreference.php)
- [PHP RFC: WeakMaps](https://wiki.php.net/rfc/weakmaps)
- [PHP RFC: Weak References](https://wiki.php.net/rfc/weakreferences)
- [Laravel Octane Documentation](https://laravel.com/docs/octane)
- [PHP Garbage Collection](https://www.php.net/manual/en/features.gc.php)

## 相关阅读

- [PHP GC 深度剖析：垃圾回收机制与循环引用检测原理](/categories/Laravel/PHP/php-gc-deep-dive)
- [Laravel 缓存预热实战：缓存预热策略与自动化](/categories/Laravel/PHP/Laravel-Cache-Warming-实战-缓存预热策略与自动化)
- [PHP JIT 实战：Tracing JIT 在 Laravel 高吞吐场景的真实性能提升](/categories/Laravel/PHP/PHP-JIT-实战-Tracing-JIT-在Laravel高吞吐场景的真实性能提升测量)
