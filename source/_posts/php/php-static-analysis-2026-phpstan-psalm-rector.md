---

title: 'PHP Static Analysis 2026 选型：PHPStan 2.x vs Psalm vs Rector——泛型推断、条件返回类型与类型体操的三工具联动'
date: 2026-06-09 17:59:00
tags: [PHP, PHPStan, Psalm, Rector, Static Analysis, 泛型, 类型推断, 代码质量, Laravel]
keywords: [PHP, PHPStan, Psalm, Rector, Static Analysis, Static, Analysis]
description: >-
---

# PHP Static Analysis 2026 选型：PHPStan 2.x vs Psalm vs Rector——泛型推断、条件返回类型与类型体操的三工具联动

PHP 静态分析工具在 2024-2026 年经历了翻天覆地的变化。PHPStan 2.x 引入了革命性的泛型推断引擎，Psalm 5.x 在类型体操领域持续深耕，而 Rector 则将自动化重构推向了新高度。对于使用 Laravel 8+ 的团队来说，选型不再是「三选一」，而是如何让这三个工具形成互补的代码质量防线。

本文将从泛型推断、条件返回类型、类型体操三个维度，深入对比三款工具的核心能力，并给出在实际 Laravel 项目中的联动配置方案。

---


## 一、2026 年工具格局总览

### 1.1 PHPStan 2.x：类型推断的王者

PHPStan 2.x（2025 年发布）最大的突破是**全局类型推断引擎**的重写。它不再依赖开发者手动标注 `@param`/`@return`，而是能从函数体、条件分支、模式匹配中自动推断类型。

```php
// PHPStan 2.x 能自动推断的场景
function processValue(mixed $value): string|int
{
    if (is_string($value)) {
        // PHPStan 2.x 知道这里是 string
        return strtoupper($value);
    }

    if (is_int($value) && $value > 0) {
        // PHPStan 2.x 知道这里是 int<1, max>
        return (string) $value;
    }

    throw new InvalidArgumentException('Invalid value');
}
// PHPStan 2.x 自动推断返回类型为 non-empty-string|positive-int
```

**关键特性：**
- 泛型类自动推断（无需 `@template` 标注即可推断 `Collection<T>` 的 T）
- 条件类型支持 `($this is Foo) ? Bar : Baz` 形式
- 与 Laravel 11+ 的 Service Container 深度集成
- 插件生态成熟（larastan、phpstan-laravel）

### 1.2 Psalm 5.x：类型体操的天花板

Psalm 在类型表达力上依然是天花板级别。它的类型系统支持**交叉类型、析取类型、模板约束、类型守卫**等高级特性，在复杂业务建模中无可替代。

```php
// Psalm 独有的交叉类型与模板约束
/**
 * @template T of array{type: string}
 * @param T $config
 * @return ($config['type'] === 'premium' ? PremiumUser : BasicUser)
 */
function createUser(array $config): PremiumUser|BasicUser
{
    if ($config['type'] === 'premium') {
        return new PremiumUser();
    }
    return new BasicUser();
}
// Psalm 能精确推断：createUser(['type' => 'premium']) 返回 PremiumUser
// createUser(['type' => 'basic']) 返回 BasicUser
```

**关键特性：**
- 交叉类型 `A&B`（同时满足两个类型的约束）
- 析取类型 `(int&string)`（PSR 级别的精确类型表达）
- 模板约束 `T of array-key`
- 类型守卫 `assert($x is array{0: int, 1: string})`
- 自定义类型插件（Psalm Plugin API）

### 1.3 Rector：自动化重构的瑞士军刀

Rector 的定位与其他两者不同——它不做类型检查，而是**自动重构代码**。它能将 PHP 5.x/7.x 代码自动升级到 8.x 语法，也能批量应用编码规范。

```php
// Rector 能自动完成的重构
// Before:
$result = array_map(function ($item) {
    return $item['name'];
}, $items);

// After (Rector 自动应用箭头函数):
$result = array_map(fn($item) => $item['name'], $items);

// Before:
if (is_string($value)) {
    $result = strtoupper($value);
} else {
    $result = null;
}

// After (Rector 自动应用 match 表达式):
$result = is_string($value) ? strtoupper($value) : null;
```

**关键特性：**
- PHP 5.x → 8.2 语法自动升级
- Laravel 项目升级（Laravel 8 → 11）
- 编码规范批量修复
- 自定义规则开发（基于 PHP-Parser）

---

## 二、泛型推断：PHPStan 2.x 的杀手锏

### 2.1 泛型基础：Collection 的自动推断

在 Laravel 项目中，`Collection` 是使用最频繁的泛型类。PHPStan 2.x 能从 `collect()` 函数的参数自动推断泛型类型。

```php
use Illuminate\Support\Collection;

// PHPStan 2.x 能自动推断 T 为 User
$users = collect([new User(), new User()]); // Collection<int, User>

// 自动推断链式调用的返回类型
$names = $users->map(fn(User $user) => $user->name); // Collection<int, string>

// 自动推断 filter 的返回类型
$activeUsers = $users->filter(fn(User $user) => $user->isActive());
// Collection<int, User>（保持泛型）
```

### 2.2 自定义泛型类

对于自定义的泛型类，PHPStan 2.x 支持 `@template` 标注：

```php
/**
 * @template T
 */
class Repository
{
    /** @var array<int, T> */
    private array $items = [];

    /**
     * @param T $item
     * @return void
     */
    public function add(mixed $item): void
    {
        $this->items[] = $item;
    }

    /**
     * @return T|null
     */
    public function find(int $id): ?mixed
    {
        return $this->items[$id] ?? null;
    }

    /**
     * @return Collection<int, T>
     */
    public function all(): Collection
    {
        return collect($this->items);
    }
}

// PHPStan 2.x 自动推断 T 为 User
$repo = new UserRepository();
$repo->add(new User()); // T 被推断为 User
$user = $repo->find(1); // 返回 ?User（不是 ?mixed）
```

### 2.3 Laravel Eloquent 模型的泛型

PHPStan 2.x 通过 larastan 插件，能自动推断 Eloquent 模型的泛型：

```php
// app/Models/User.php
class User extends Authenticatable
{
    // larastan 自动推断 User::query() 返回 Builder<User>
    // 以及 User::all() 返回 Collection<int, User>

    // 自定义关系的泛型推断
    /**
     * @return HasMany<Post, $this>
     */
    public function posts(): HasMany
    {
        return $this->hasMany(Post::class);
    }
}

// 使用时自动推断
$posts = User::find(1)->posts; // Collection<int, Post>（自动推断）
$activePosts = User::find(1)->posts()
    ->where('status', 'published')
    ->get(); // Collection<int, Post>（链式调用保持泛型）
```

---

## 三、条件返回类型：Psalm 的精准推断

### 3.1 条件类型基础

Psalm 的条件返回类型是其最强大的特性之一，能根据输入参数的类型精确推断返回类型：

```php
/**
 * @template T
 * @param class-string<T> $className
 * @param array<string, mixed> $attributes
 * @return T
 */
function make(string $className, array $attributes): object
{
    return new $className($attributes);
}

// Psalm 能精确推断：
$user = make(User::class, ['name' => 'John']); // User（不是 object）
$post = make(Post::class, ['title' => 'Hello']); // Post（不是 object）
```

### 3.2 复杂条件分支

```php
/**
 * @param array{type: 'admin', permissions: string[]} $config
 * @return Admin
 *
 * @param array{type: 'user', role: string} $config
 * @return User
 *
 * @param array{type: 'guest'} $config
 * @return Guest
 */
function createAccount(array $config): Admin|User|Guest
{
    return match ($config['type']) {
        'admin' => new Admin($config['permissions']),
        'user' => new User($config['role']),
        'guest' => new Guest(),
    };
}

// Psalm 精确推断：
$admin = createAccount(['type' => 'admin', 'permissions' => ['edit']]); // Admin
$user = createAccount(['type' => 'user', 'role' => 'editor']); // User
$guest = createAccount(['type' => 'guest']); // Guest
```

### 3.3 类型守卫与 assert

```php
/**
 * @param mixed $data
 * @return array{0: int, 1: string}
 */
function parseTuple(mixed $data): array
{
    assert(is_array($data) && count($data) === 2);
    assert(is_int($data[0]));
    assert(is_string($data[1]));

    return [$data[0], $data[1]];
}

// Psalm 能精确推断：
$tuple = parseTuple([1, 'hello']); // array{0: int, 1: string}
$id = $tuple[0]; // int（不是 mixed）
$name = $tuple[1]; // string（不是 mixed）
```

---

## 四、类型体操：Psalm 的高级特性

### 4.1 交叉类型

交叉类型 `A&B` 表示同时满足 A 和 B 的类型约束：

```php
/**
 * @param string $name
 * @return array{name: string, age: int}
 */
function getUserInfo(string $name): array
{
    return ['name' => $name, 'age' => 25];
}

/**
 * @param int $id
 * @return array{id: int, created_at: string}
 */
function getUserMeta(int $id): array
{
    return ['id' => $id, 'created_at' => '2024-01-01'];
}

// 交叉类型：同时拥有两个数组的所有键
/**
 * @return array{name: string, age: int} & array{id: int, created_at: string}
 */
function getFullUserInfo(string $name, int $id): array
{
    return array_merge(
        getUserInfo($name),
        getUserMeta($id)
    );
}

// Psalm 精确推断：
$user = getFullUserInfo('John', 1);
// $user 的类型是 array{name: string, age: int, id: int, created_at: string}
// 既能访问 $user['name']，也能访问 $user['id']
```

### 4.2 析取类型

析取类型用于表示「只能是其中一个」的类型：

```php
/**
 * @param (int&string) $value
 * @return string
 */
function processValue(int&string $value): string
{
    // $value 同时是 int 和 string（比如 JSON 解析后的数字字符串）
    return (string) (int) $value;
}

// Psalm 能精确推断：
$result = processValue('123'); // string
$result = processValue(123); // string
```

### 4.3 模板约束

```php
/**
 * @template T of array-key
 * @param T $key
 * @return array{T: mixed}
 */
function wrapKey(array-key $key): array
{
    return [$key => null];
}

// Psalm 精确推断：
$result = wrapKey('name'); // array{name: mixed}
$result = wrapKey(42); // array{42: mixed}
```

---

## 五、Rector：自动化重构的实战

### 5.1 Laravel 项目升级

Rector 能自动将 Laravel 8 项目升级到 Laravel 11：

```php
// rector.php
use Rector\Config\RectorConfig;
use Rector\Laravel\Set\LaravelLevelSetList;
use Rector\Laravel\Set\LaravelSetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/config',
        __DIR__ . '/database',
        __DIR__ . '/routes',
    ])
    ->withSets([
        LaravelLevelSetList::Laravel_80,
        LaravelLevelSetList::Laravel_90,
        LaravelLevelSetList::Laravel_100,
        LaravelLevelSetList::Laravel_110,
        LaravelSetList::LARAVEL_COLLECTION,
        LaravelSetList::LARAVEL_CODESTYLE,
        LaravelSetList::LARAVEL_DEPRECATED,
    ])
    ->withPhpSets(php82: true);
```

### 5.2 自定义 Rector 规则

```php
// src/Rector/AddReturnTypeDeclarationRector.php
use PhpParser\Node;
use PhpParser\Node\Stmt\ClassMethod;
use PHPStan\Analyser\Scope;
use Rector\Rector\AbstractScopeAwareRector;
use Symplify\RuleDocGenerator\ValueObject\RuleDefinition;

class AddReturnTypeDeclarationRector extends AbstractScopeAwareRector
{
    public function getRuleDefinition(): RuleDefinition
    {
        return new RuleDefinition(
            'Add return type declaration to methods',
            []
        );
    }

    public function getNodeTypes(): array
    {
        return [ClassMethod::class];
    }

    public function refactorWithScope(Node $node, Scope $scope): ?Node
    {
        if ($node->returnType !== null) {
            return null;
        }

        // 根据方法名推断返回类型
        $methodName = $this->getName($node);
        if ($methodName === null) {
            return null;
        }

        if (str_starts_with($methodName, 'get')) {
            $node->returnType = new Node\Identifier('mixed');
            return $node;
        }

        if (str_starts_with($methodName, 'is') || str_starts_with($methodName, 'has')) {
            $node->returnType = new Node\Identifier('bool');
            return $node;
        }

        return null;
    }
}
```

---

## 六、三工具联动配置

### 6.1 项目安装

```bash
# 安装 PHPStan
composer require --dev phpstan/phpstan larastan/larastan

# 安装 Psalm
composer require --dev vimeo/psalm

# 安装 Rector
composer require --dev rector/rector rector/rector-laravel
```

### 6.2 PHPStan 配置（phpstan.neon）

```yaml
includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    paths:
        - app
        - config
        - database
        - routes

    level: 8

    treatPhpDocTypesAsCertain: false

    stubFiles:
        - stubs/Laravel.stub

    ignoreErrors:
        - '#Call to an undefined method Illuminate\\Database\\Eloquent\\Builder::[a-zA-Z]+#'
        - '#Parameter .+ of type .+ is not subtype of .+#'

    checkMissingIterableValueType: true
    checkGenericClassInNonGenericObjectType: true
    checkUnionType: true
    checkAlwaysTrueAlwaysUsed: true
```

### 6.3 Psalm 配置（psalm.xml）

```xml
<?xml version="1.0"?>
<psalm
    errorLevel="1"
    resolveFromConfigFile="true"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns="https://getpsalm.org/schema/config"
    xsi:schemaLocation="https://getpsalm.org/schema/config vendor/vimeo/psalm/config.xsd"
    findUnusedBaselineEntry="true"
>
    <projectFiles>
        <directory name="app" />
        <directory name="config" />
        <directory name="database" />
        <directory name="routes" />

        <ignoreFiles>
            <directory name="vendor" />
            <directory name="node_modules" />
        </ignoreFiles>
    </projectFiles>

    <plugins>
        <pluginClass class="Psalm\LaravelPlugin\Plugin" />
    </plugins>

    <issueHandlers>
        <MixedAssignment>
            <errorLevel type="suppress">
                <file name="app/Http/Controllers/*.php" />
            </errorLevel>
        </MixedAssignment>

        <MixedArgument>
            <errorLevel type="suppress">
                <file name="app/Services/*.php" />
            </errorLevel>
        </MixedArgument>
    </issueHandlers>
</psalm>
```

### 6.4 Rector 配置（rector.php）

```php
<?php

declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Laravel\Set\LaravelLevelSetList;
use Rector\Laravel\Set\LaravelSetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/config',
        __DIR__ . '/database',
        __DIR__ . '/routes',
    ])
    ->withSkip([
        __DIR__ . '/vendor',
        __DIR__ . '/node_modules',
        __DIR__ . '/app/Http/Kernel.php',
        __DIR__ . '/app/Console/Kernel.php',
    ])
    ->withSets([
        LaravelLevelSetList::Laravel_80,
        LaravelLevelSetList::Laravel_90,
        LaravelLevelSetList::Laravel_100,
        LaravelLevelSetList::Laravel_110,
        LaravelSetList::LARAVEL_COLLECTION,
        LaravelSetList::LARAVEL_CODESTYLE,
        LaravelSetList::LARAVEL_DEPRECATED,
    ])
    ->withPhpSets(php82: true);
```

---

## 七、CI/CD 集成

### 7.1 GitHub Actions 配置

```yaml
# .github/workflows/static-analysis.yml
name: Static Analysis

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  phpstan:
    name: PHPStan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          coverage: none
      - run: composer install --no-progress --prefer-dist
      - run: vendor/bin/phpstan analyse --no-progress --error-format=github

  psalm:
    name: Psalm
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          coverage: none
      - run: composer install --no-progress --prefer-dist
      - run: vendor/bin/psalm --no-progress --output-format=github

  rector:
    name: Rector
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          coverage: none
      - run: composer install --no-progress --prefer-dist
      - run: vendor/bin/rector process --dry-run
```

### 7.2 Composer Scripts

```json
{
    "scripts": {
        "analyse": [
            "@phpstan",
            "@psalm",
            "@rector:check"
        ],
        "phpstan": "phpstan analyse --no-progress",
        "psalm": "psalm --no-progress",
        "rector": "rector process",
        "rector:check": "rector process --dry-run",
        "fix": [
            "@rector",
            "@cs-fix"
        ],
        "cs-fix": "php-cs-fixer fix --allow-risky=yes"
    }
}
```

---

## 八、踩坑记录

### 8.1 PHPStan 与 Laravel 的类型冲突

Laravel 的 Service Container 在解析依赖时会返回 `mixed` 类型，导致 PHPStan 无法精确推断：

```php
// 问题代码
$user = app(UserRepository::class)->find(1);
// PHPStan 推断 $user 为 mixed

// 解决方案 1：使用泛型标注
/**
 * @return UserRepository
 */
function getUserRepository(): UserRepository
{
    return app(UserRepository::class);
}

$user = getUserRepository()->find(1); // User|null

// 解决方案 2：使用 larastan 的泛型支持
$user = app(UserRepository::class)->find(1); // larastan 自动推断为 ?User
```

### 8.2 Psalm 与 PHPStan 的类型系统差异

两个工具的类型系统有细微差异，可能导致同一段代码在两个工具中报错不同：

```php
// Psalm 能识别的类型
/**
 * @param array{0: int, 1: string} $tuple
 */
function processTuple(array $tuple): string
{
    return $tuple[1]; // Psalm: OK, string
}

// PHPStan 也能识别，但对数组形状的检查更严格
// 如果数组可能有额外键，PHPStan 会报错
```

### 8.3 Rector 的误重构

Rector 有时会误重构代码，导致运行时错误：

```php
// Rector 自动重构的代码
$result = match ($type) {
    'admin' => new Admin(),
    'user' => new User(),
    default => new Guest(),
};

// 问题：如果 $type 可能是 null，match 会抛出 TypeError
// 解决：在 rector.php 中跳过特定文件
->withSkip([
    __DIR__ . '/app/Services/AccountService.php',
])
```

---

## 九、总结与选型建议

### 9.1 工具定位

| 工具 | 定位 | 核心能力 | 适用场景 |
|------|------|----------|----------|
| **PHPStan 2.x** | 类型检查 | 泛型推断、条件返回类型 | 日常开发、CI/CD |
| **Psalm 5.x** | 类型检查 | 类型体操、交叉类型 | 复杂业务建模 |
| **Rector** | 自动重构 | 代码升级、批量修复 | 项目升级、规范统一 |

### 9.2 推荐配置

**小型项目（< 10k 行）：**
- PHPStan level 6 + Rector（基础规则）

**中型项目（10k-100k 行）：**
- PHPStan level 7 + Psalm（关键模块） + Rector

**大型项目（> 100k 行）：**
- PHPStan level 8 + Psalm（全项目） + Rector（自定义规则）

### 9.3 三工具联动策略

1. **Rector 先行**：自动重构代码，统一编码规范
2. **PHPStan 检查**：静态分析类型错误，确保类型安全
3. **Psalm 补充**：对复杂业务模块进行深度类型检查

通过三个工具的联动，可以构建完整的代码质量防线：Rector 负责「代码长什么样」，PHPStan 负责「代码对不对」，Psalm 负责「代码精不精」。

---

## 十、参考资源

- [PHPStan 2.x 官方文档](https://phpstan.org/)
- [Psalm 5.x 官方文档](https://psalm.dev/)
- [Rector 官方文档](https://getrector.org/)
- [Larastan GitHub](https://github.com/larastan/larastan)
- [PHPStan vs Psalm 对比](https://phpstan.org/blog/phpstan-vs-psalm)
- [Rector Laravel Set](https://github.com/rectorphp/rector-laravel)
