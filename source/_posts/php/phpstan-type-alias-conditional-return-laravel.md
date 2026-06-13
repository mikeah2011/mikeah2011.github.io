---
title: PHPStan 2.x 实战：泛型推断增强、Type Alias 与 Conditional Return Type——Laravel 项目的类型安全新高度
keywords: [PHPStan, Type Alias, Conditional Return Type, Laravel, 泛型推断增强, 项目的类型安全新高度, PHP]
date: 2026-06-09 14:04:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
  - PHPStan
  - 类型系统
  - 泛型
  - Laravel
  - 静态分析
description: 深入 PHPStan 2.x 的泛型推断增强、Type Alias 与 Conditional Return Type，结合 Laravel 项目实战，用静态分析在运行前消灭类型相关的 Bug。
---


PHPStan 2.x 带来了类型系统层面的重大升级。泛型推断更智能、Type Alias 让复杂类型有了可读的名字、Conditional Return Type 让返回值类型可以根据输入参数动态推断。这三个特性组合在一起，让 Laravel 项目的类型安全从「锦上添花」变成了「真正的防线」。

本文不讲安装配置，直接上干货：这三个特性是什么、怎么用、在 Laravel 项目里能解决什么问题。

## 泛型推断增强：PHPStan 终于能「看懂」你的泛型了

PHPStan 1.x 对泛型的支持已经不错，但在嵌套场景下经常「失忆」。2.x 重写了泛型推断引擎，核心改进有三点：

### 1. 嵌套泛型自动展开

```php
/**
 * @template T
 * @param array<T> $items
 * @return array<T>
 */
function duplicate(array $items): array
{
    return array_merge($items, $items);
}

// PHPStan 1.x: 返回 array<int|string>（丢失精确类型）
// PHPStan 2.x: 返回 array<string>（保留精确类型）
$strings = duplicate(['a', 'b', 'c']);
```

在 1.x 中，一旦泛型经过 `array_merge` 之类的函数，类型信息就会退化为宽泛的父类型。2.x 通过追踪每个泛型参数在函数体内的流向，保留了完整的类型信息。

### 2. 条件泛型约束推断

```php
/**
 * @template T of array|object
 * @param T $data
 * @return T is array ? array-key : string
 */
function getKey(mixed $data): string|int
{
    if (is_array($data)) {
        return array_key_first($data);
    }
    return get_class($data);
}

$result = getKey(['name' => 'PHPStan']); // 推断为 array-key
$result2 = getKey(new stdClass());       // 推断为 string
```

这个例子展示了 PHPStan 2.x 能根据泛型约束 `T of array|object` 来推断返回值类型。传入数组时返回 `array-key`，传入对象时返回 `string`。

### 3. 闭包泛型自动绑定

这是 Laravel 项目中最有用的改进：

```php
// PHPStan 2.x 能自动推断 $query 的泛型类型
$users = User::query()
    ->where('active', true)
    ->get()
    ->map(fn(User $user) => $user->name)
    ->filter(fn(string $name) => strlen($name) > 3);

// $users 的类型：Collection<int, string>
// 在 1.x 中可能退化为 Collection<int, mixed>
```

`Collection::map()` 返回的新集合类型取决于闭包的返回值。2.x 能沿着 `->map()` → `fn(User $user) => $user->name` 这条链路追踪下去，得出 `string` 类型。

## Type Alias：给复杂类型起个好名字

Type Alias 是 PHPStan 2.x 引入的「类型别名」机制。它的作用很简单：把冗长的类型定义压缩成一个可读的名字。

### 基本语法

```php
/** @phpstan-type UserId int<1, max> */
/** @phpstan-type UserRow array{id: UserId, name: string, email: string} */
/** @phpstan-type UserCollection array<int, UserRow> */

class UserRepository
{
    /**
     * @param UserId $id
     * @return UserRow|null
     */
    public function find(int $id): ?array
    {
        return DB::table('users')->find($id);
    }

    /**
     * @return UserCollection
     */
    public function all(): array
    {
        return DB::table('users')->get()->toArray();
    }
}
```

没有 Type Alias 之前，`find()` 的返回值要写成 `array{id: int<1, max>, name: string, email: string}|null`，每次使用都要重复一遍。有了 Type Alias，一个 `UserRow` 搞定。

### 跨类共享 Type Alias

Type Alias 定义在类上，但可以在其他类中引用：

```php
/** @phpstan-import-type UserRow from UserRepository */

class UserService
{
    public function __construct(private UserRepository $repo) {}

    /**
     * @return UserRow|null
     */
    public function getProfile(int $id): ?array
    {
        return $this->repo->find($id);
    }
}
```

`@phpstan-import-type` 从 `UserRepository` 导入 `UserRow`，保持类型定义的单一来源。

### 泛型 Type Alias

Type Alias 也可以是泛型的：

```php
/**
 * @template T
 * @phpstan-type ApiResponse array{code: int, message: string, data: T|null}
 */
class Api
{
    /**
     * @template R
     * @param ApiResponse<R> $response
     * @return R|null
     */
    public function extractData(array $response): mixed
    {
        return $response['data'];
    }
}

// 使用时：
/** @var array{code: int, message: string, data: UserRow|null} $resp */
$user = $api->extractData($resp); // 推断为 UserRow|null
```

这在 Laravel 的 API 封装中非常实用。定义一次 `ApiResponse<T>`，所有接口的返回值类型自动关联。

## Conditional Return Type：根据输入决定输出

这是 PHPStan 2.x 最强大的特性。它允许返回值类型依赖于输入参数的值或类型。

### 基本用法

```php
/**
 * @param string $key
 * @return ($key is 'name' ? string : ($key is 'age' ? int : mixed))
 */
function getConfig(string $key): mixed
{
    return match ($key) {
        'name' => 'PHPStan',
        'age' => 5,
        default => null,
    };
}

$name = getConfig('name'); // string
$age = getConfig('age');   // int
$other = getConfig('foo'); // mixed
```

`($key is 'name' ? string : ...)` 是条件返回类型的语法。PHPStan 根据传入的字符串字面量 `'name'` 推断出返回值是 `string`。

### Laravel Model 实战：`getAttribute` 的精确类型

这是 Laravel 项目中最经典的例子。Eloquent 的 `getAttribute` 返回值类型一直是类型安全的痛点：

```php
/**
 * @template T of string
 * @param T $key
 * @return (
 *     T is 'id' ? int :
 *     (T is 'name' ? string :
 *     (T is 'email' ? string :
 *     (T is 'created_at' ? Carbon :
 *     mixed)))
 * )
 */
public function getAttribute(string $key): mixed
{
    return parent::getAttribute($key);
}
```

现在：

```php
$user = User::find(1);
$id = $user->getAttribute('id');           // int
$name = $user->getAttribute('name');       // string
$created = $user->getAttribute('created_at'); // Carbon
$unknown = $user->getAttribute('foo');     // mixed
```

### 实战：Builder 的 `when()` 方法精确推断

Laravel Query Builder 的 `when()` 方法返回 `$this`，但条件闭包内的 `$query` 类型经常丢失：

```php
/**
 * @template TCondition
 * @param TCondition $value
 * @param callable($this, TCondition): void $callback
 * @param callable($this): void|null $default
 * @return $this
 */
public function when(
    mixed $value,
    callable $callback,
    ?callable $default = null
): static
{
    if ($value) {
        $callback($this, $value);
    } elseif ($default) {
        $default($this);
    }
    return $this;
}
```

配合 `TCondition` 泛型，PHPStan 2.x 能在闭包内精确推断 `$value` 的类型：

```php
User::query()
    ->when(request('role'), function (Builder $query, string $role) {
        // PHPStan 知道 $role 是 string，不需要手动断言
        $query->where('role', $role);
    })
    ->get();
```

## Laravel 项目完整实战：类型安全的 Repository 模式

把三个特性组合起来，在一个 Repository 中实现完整的类型安全：

```php
<?php

declare(strict_types=1);

namespace App\Repositories;

use Illuminate\Support\Collection;

/**
 * @phpstan-type UserData array{id: int, name: string, email: string, role: UserRole}
 * @phpstan-type UserRole 'admin'|'editor'|'viewer'
 * @phpstan-type UserFilter array{name?: string, role?: UserRole, active?: bool}
 *
 * @template T of UserData
 */
class UserRepository
{
    /**
     * @phpstan-return Collection<int, T>
     */
    public function all(): Collection
    {
        return collect([
            ['id' => 1, 'name' => 'Alice', 'email' => 'alice@example.com', 'role' => 'admin'],
            ['id' => 2, 'name' => 'Bob', 'email' => 'bob@example.com', 'role' => 'editor'],
        ]);
    }

    /**
     * @param UserFilter $filters
     * @phpstan-return Collection<int, T>
     */
    public function search(array $filters = []): Collection
    {
        return $this->all()->filter(function (array $user) use ($filters) {
            if (isset($filters['name']) && !str_contains($user['name'], $filters['name'])) {
                return false;
            }
            if (isset($filters['role']) && $user['role'] !== $filters['role']) {
                return false;
            }
            return true;
        })->values();
    }

    /**
     * 根据字段名返回精确类型
     *
     * @param T $user
     * @param K $field
     * @template K of key-of<T>
     * @return T[K]
     */
    public function getField(array $user, string $field): mixed
    {
        return $user[$field];
    }
}

// 使用
$repo = new UserRepository();
$users = $repo->search(['role' => 'admin']);

foreach ($users as $user) {
    // PHPStan 知道 $user 是 UserData
    $name = $user['name'];   // string
    $role = $user['role'];   // 'admin'|'editor'|'viewer'

    // 通过 getField 也能精确推断
    $id = $repo->getField($user, 'id');     // int
    $email = $repo->getField($user, 'email'); // string
}
```

关键点：
- `@phpstan-type` 把 `array{id: int, name: string, ...}` 压缩成 `UserData`
- `@template K of key-of<T>` 让 `getField()` 的返回值根据 `$field` 参数精确推断
- 整个链路从数据库查询到业务逻辑，类型信息不丢失

## 踩坑记录

### 坑 1：Type Alias 作用域限制

Type Alias 只在定义它的类及其直接使用者中可见。如果 A 定义了 Type Alias，B 用了 A，C 用了 B，C 看不到 A 的 Type Alias。

```php
// A.php - 定义 Type Alias
/** @phpstan-type UserData array{id: int, name: string} */
class A {}

// B.php - 导入后可用
/** @phpstan-import-type UserData from A */
class B {
    /** @return UserData */
    public function get(): array { return ['id' => 1, 'name' => 'x']; }
}

// C.php - 无法直接用 UserData，必须再次 import
/** @phpstan-import-type UserData from A */  // 从 A 导入，不是从 B
class C {
    public function __construct(private B $b) {}
}
```

### 坑 2：Conditional Return Type 不支持复杂表达式

目前 Conditional Return Type 只支持简单的 `($param is Type ? A : B)` 形式，不支持逻辑运算：

```php
// ❌ 不支持
@return ($a is string && $b is int ? string : mixed)

// ✅ 改用嵌套
@return ($a is string ? ($b is int ? string : mixed) : mixed)
```

### 坑 3：泛型推断与 `collect()` 的冲突

Laravel 的 `collect()` 辅助函数没有泛型注解，PHPStan 无法推断集合元素类型：

```php
// PHPStan 推断为 Collection<int, mixed>
$items = collect([1, 2, 3]);

// 解决方案 1：用 @var 注解
/** @var Collection<int, int> $items */
$items = collect([1, 2, 3]);

// 解决方案 2：直接用 new Collection
$items = new Collection([1, 2, 3]); // 推断为 Collection<int, int>
```

### 坑 4：PHPStan 2.x 与 Larastan 兼容性

Larastan 对 PHPStan 2.x 的支持需要升级到 Larastan 3.x。如果项目同时使用了 Larastan 和自定义的 Type Alias，可能会出现冲突。解决方法是先升级 Larastan，再逐步添加自定义类型注解。

```bash
composer require --dev nunomaduro/larastan:^3.0
```

### 坑 5：`@phpstan-type` 和 `@phpstan-import-type` 不能在同一行

```php
// ❌ 错误
/** @phpstan-type A string @phpstan-type B int */

// ✅ 正确：每个 Type Alias 单独一行
/** @phpstan-type A string */
/** @phpstan-type B int */
```

## 性能影响

PHPStan 2.x 的泛型推断增强意味着更多的类型计算。在大型 Laravel 项目中，全量分析时间可能增加 10-20%。优化建议：

```neon
# phpstan.neon
parameters:
    # 只分析变更文件，增量模式
    level: 6
    
    # 排除不需要分析的目录
    excludePaths:
        - tests/*
        - database/migrations/*
    
    # 限制泛型推断深度，避免组合爆炸
    genericMaximumIterators: 5
```

增量分析（`--memory-limit` + 缓存）在 CI/CD 中效果显著，能将分析时间从 2 分钟压缩到 15 秒。

## 总结

PHPStan 2.x 的三个核心特性各有分工：

| 特性 | 解决的问题 | Laravel 典型场景 |
|------|-----------|-----------------|
| 泛型推断增强 | 泛型经过函数后类型丢失 | Collection 链式调用保持精确类型 |
| Type Alias | 复杂类型定义冗长难读 | Eloquent Model 的 attribute 类型定义 |
| Conditional Return Type | 返回值类型依赖输入参数 | `getAttribute`、`when()`、`config()` |

实际落地建议：先从 Type Alias 开始，把项目中出现 3 次以上的复杂类型定义提取成别名；然后给核心的 `getAttribute`、`scope` 方法加上 Conditional Return Type；最后在 Collection 操作密集的地方补上泛型注解。渐进式改进，不要一次性重构所有代码。
